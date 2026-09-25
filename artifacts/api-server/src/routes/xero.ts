import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, settingsTable, customersTable, suppliersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  generateAuthUrl,
  handleCallback,
  disconnectXero,
  getXeroStatus,
  syncContacts,
  getContactBalance,
  getOverdueBalance,
  postInvoiceToXero,
} from "../services/xero";

const router: IRouter = Router();

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}

async function setSetting(key: string, value: string | null): Promise<void> {
  await db.insert(settingsTable).values({ key, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}

/**
 * Auto-detect the redirect URI from the environment.
 * Uses REPLIT_DOMAINS when available (reliable in both dev and deployed).
 */
function autoRedirectUri(req: import("express").Request): string {
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) {
    const domain = replitDomains.split(",")[0].trim();
    return `https://${domain}/api/xero/callback`;
  }
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost";
  return `${proto}://${host}/api/xero/callback`;
}

/**
 * Return the effective redirect URI — user override if saved, else auto-detected.
 */
async function getEffectiveRedirectUri(req: import("express").Request): Promise<string> {
  const override = await getSetting("xero_redirect_uri");
  return override || autoRedirectUri(req);
}

// Get current redirect URI (override if saved, otherwise auto-detected)
router.get("/xero/redirect-uri", async (req, res): Promise<void> => {
  const uri = await getEffectiveRedirectUri(req);
  res.json({ redirectUri: uri, isOverride: !!(await getSetting("xero_redirect_uri")) });
});

// Save Xero client credentials (and optionally a custom redirect URI)
router.post("/xero/credentials", async (req, res): Promise<void> => {
  const body = z.object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    redirectUri: z.string().url().optional(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  await setSetting("xero_client_id", body.data.clientId);
  await setSetting("xero_client_secret", body.data.clientSecret);
  if (body.data.redirectUri) {
    await setSetting("xero_redirect_uri", body.data.redirectUri);
  }
  res.json({ ok: true });
});

// Get connection status
router.get("/xero/status", async (_req, res): Promise<void> => {
  try {
    const status = await getXeroStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// Generate the Xero OAuth URL and redirect the browser to it
router.get("/xero/connect", async (req, res): Promise<void> => {
  try {
    const redirectUri = await getEffectiveRedirectUri(req);
    const url = await generateAuthUrl(redirectUri);
    res.redirect(url);
  } catch (err) {
    res.status(400).send(`<h2>Xero Connect Error</h2><p>${err instanceof Error ? err.message : "Unknown error"}</p>`);
  }
});

// OAuth callback — Xero redirects here after user authorises
router.get("/xero/callback", async (req, res): Promise<void> => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    res.redirect(`/?xero=error&msg=${encodeURIComponent(error)}`);
    return;
  }

  if (!code || !state) {
    res.redirect("/?xero=error&msg=Missing+code+or+state");
    return;
  }

  try {
    await handleCallback(code, state);
    res.redirect("/settings?xero=connected");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.redirect(`/?xero=error&msg=${encodeURIComponent(msg)}`);
  }
});

// Disconnect from Xero
router.post("/xero/disconnect", async (_req, res): Promise<void> => {
  try {
    await disconnectXero();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// Sync contacts (both ways)
router.post("/xero/sync/contacts", async (_req, res): Promise<void> => {
  try {
    const result = await syncContacts();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Sync failed" });
  }
});

// Get customer balance from Xero
router.get("/xero/balance/customer/:id", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!idParse.success) { res.status(400).json({ error: "Invalid customer ID" }); return; }

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, idParse.data));
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  if (!customer.xeroContactId) { res.status(404).json({ error: "Customer not linked to Xero" }); return; }

  try {
    const balance = await getContactBalance(customer.xeroContactId);
    res.json(balance);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Balance fetch failed" });
  }
});

// Get supplier balance from Xero
router.get("/xero/balance/supplier/:id", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!idParse.success) { res.status(400).json({ error: "Invalid supplier ID" }); return; }

  const [supplier] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, idParse.data));
  if (!supplier) { res.status(404).json({ error: "Supplier not found" }); return; }
  if (!supplier.xeroContactId) { res.status(404).json({ error: "Supplier not linked to Xero" }); return; }

  try {
    const balance = await getContactBalance(supplier.xeroContactId);
    res.json(balance);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Balance fetch failed" });
  }
});

// Check whether a customer has a Xero balance overdue by more than N days (default 30)
router.get("/xero/overdue-check/customer/:id", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!idParse.success) { res.status(400).json({ error: "Invalid customer ID" }); return; }
  const daysThreshold = z.coerce.number().int().positive().safeParse(req.query.days).data ?? 30;

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, idParse.data));
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  if (!customer.xeroContactId) { res.json({ isOverdue: false, overdueAmount: 0, totalDue: 0, oldestDueDate: null, invoiceCount: 0, notLinked: true }); return; }

  try {
    const overdue = await getOverdueBalance(customer.xeroContactId, daysThreshold);
    res.json(overdue);
  } catch (err) {
    // Never block order confirmation because Xero is unreachable — report as unknown instead of erroring the flow.
    res.json({ isOverdue: false, overdueAmount: 0, totalDue: 0, oldestDueDate: null, invoiceCount: 0, checkFailed: true, error: err instanceof Error ? err.message : "Overdue check failed" });
  }
});

// Post a sales order as a draft invoice to Xero
router.post("/xero/invoices/:orderId", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.orderId);
  if (!idParse.success) { res.status(400).json({ error: "Invalid order ID" }); return; }

  try {
    const result = await postInvoiceToXero(idParse.data);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Invoice posting failed" });
  }
});

export default router;
