import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db, settingsTable, syncLogsTable } from "@workspace/db";
import { runWooSync } from "../services/woo-sync";
import { testDpdConnection, isDpdConfigured } from "../services/dpd.js";
import { staffAuthorization } from "./staff-auth.js";
import { reconcileOperationalAutomations } from "../setup/operational-access.js";


const router: IRouter = Router();

const SECRET_KEY = /(secret|password|token|api.?key|credential|private.?key|hash|otp|authorization|_key$|^key$)/i;
const ADMIN_ONLY_KEYS = new Set([
  "installation_activated",
  "integration_enabled",
  "staff_accounts",
  "staff_password_hash",
]);
const ADMIN_ONLY_PATTERN = /(integration|automation|_enabled$)/i;

function requiresAdmin(key: string): boolean {
  return ADMIN_ONLY_KEYS.has(key) || ADMIN_ONLY_PATTERN.test(key) || SECRET_KEY.test(key);
}

function isSecret(key: string): boolean {
  return SECRET_KEY.test(key);
}

router.get("/settings", async (req, res): Promise<void> => {
  const authorization = await staffAuthorization(req);
  if (!authorization.authenticated) { res.status(401).json({ error: "Staff authentication required" }); return; }
  const rows = await db.select().from(settingsTable);
  const result: Record<string, string | null> = {};
  for (const row of rows) {
    if (requiresAdmin(row.key) && !authorization.admin) continue;
    result[row.key] = isSecret(row.key) && row.value ? "••••••••" : row.value;
  }
  res.json(result);
});

router.get("/settings/raw", async (req, res): Promise<void> => {
  const authorization = await staffAuthorization(req);
  if (!authorization.authenticated) { res.status(401).json({ error: "Staff authentication required" }); return; }
  if (!authorization.admin) { res.status(403).json({ error: "Administrator access required" }); return; }
  const rows = await db.select().from(settingsTable);
  const result: Record<string, string | null> = {};
  // Keep this legacy endpoint non-secret even for administrators.
  for (const row of rows) {
    if (!requiresAdmin(row.key)) result[row.key] = row.value;
  }
  res.json(result);
});

router.patch("/settings", async (req, res): Promise<void> => {
  const authorization = await staffAuthorization(req);
  if (!authorization.authenticated) { res.status(401).json({ error: "Staff authentication required" }); return; }
  const parsed = z.record(z.string(), z.string().nullable()).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  for (const key of Object.keys(parsed.data)) {
    if (!/^[a-zA-Z0-9_.-]{1,120}$/.test(key)) {
      res.status(400).json({ error: `Invalid setting key: ${key}` }); return;
    }
    if (key === "installation_activated") {
      res.status(403).json({ error: "Installation activation is controlled exclusively by /setup/activate." }); return;
    }
    if (requiresAdmin(key) && !authorization.admin) {
      res.status(403).json({ error: `Administrator access required to change ${key}` }); return;
    }
  }

  for (const [key, value] of Object.entries(parsed.data)) {
    await db.insert(settingsTable)
      .values({ key, value })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
  }

  try {
    await reconcileOperationalAutomations();
  } catch {
    res.status(503).json({ error: "Settings were saved, but scheduled automations could not be reconciled safely." });
    return;
  }
  res.json({ ok: true });
});

router.get("/woo-sync/logs", async (req, res): Promise<void> => {
  if (!(await staffAuthorization(req)).authenticated) { res.status(401).json({ error: "Staff authentication required" }); return; }
  const logs = await db.select().from(syncLogsTable).orderBy(desc(syncLogsTable.startedAt)).limit(20);
  res.json(logs);
});

router.post("/woo-sync/run", async (req, res): Promise<void> => {
  if (!(await staffAuthorization(req)).authenticated) { res.status(401).json({ error: "Staff authentication required" }); return; }
  const full = req.query.full === "true";

  // Check whether a sync is already running
  const [running] = await db.select().from(syncLogsTable)
    .where(eq(syncLogsTable.status, "running"))
    .limit(1);
  if (running) {
    res.status(409).json({ error: "A sync is already in progress" });
    return;
  }

  // Respond immediately — the sync runs entirely in the background
  res.status(202).json({ message: "Sync started" });

  runWooSync({ full }).catch(async (err) => {
    console.error("[sync] Background sync failed:", err);
  });
});

router.get("/settings/dpd-test", async (req, res): Promise<void> => {
  if (!(await staffAuthorization(req)).authenticated) { res.status(401).json({ error: "Staff authentication required" }); return; }
  if (!isDpdConfigured()) {
    res.json({ ok: false, configured: false, message: "DPD credentials not set (DPD_USERNAME, DPD_PASSWORD, DPD_ACCOUNT_NUMBER environment variables required)" });
    return;
  }
  const result = await testDpdConnection();
  res.json({ ...result, configured: true });
});

export default router;
