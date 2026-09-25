import { Router, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sendEmail } from "../services/email";
import { configuredBusinessName, getBusinessConfig } from "../lib/business-config";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? "";
const PORTAL_JWT_SECRET = process.env.PORTAL_JWT_SECRET ?? "";
const DEMO_ENABLED = process.env.DEMO_ENABLED === "true";
if (DEMO_ENABLED && (JWT_SECRET.length < 32 || PORTAL_JWT_SECRET.length < 32)) {
  throw new Error("Enable the demo only after configuring separate JWT_SECRET and PORTAL_JWT_SECRET credentials.");
}

const DEMO_TOKEN_TTL = "48h";
const SYNTHETIC_PORTAL_PREVIEW_ENABLED =
  process.env.DEMO_SYNTHETIC_PORTAL_PREVIEW === "true" && process.env.NODE_ENV === "test";

function demoAuth(req: Request, res: Response, next: () => void) {
  if (!DEMO_ENABLED) { res.status(404).json({ error: "Demo is disabled" }); return; }
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any;
    if (!payload.isDemo) { res.status(403).json({ error: "Demo token required" }); return; }
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired demo token" });
  }
}

async function sendDemoEmail(lead: { firstName: string; email: string; company: string }) {
  const installation = await getBusinessConfig();
  if (!installation?.email?.trim()) return { sent: false, error: "Installation email is not configured." };
  const configuredName = installation.tradingName?.trim() || installation.name?.trim();
  if (!configuredName) return { sent: false, error: "Installation business name is not configured." };

  let demoUrl: string;
  try {
    const websiteUrl = new URL(installation.website?.trim() ?? "");
    if (!["http:", "https:"].includes(websiteUrl.protocol) || !websiteUrl.hostname || websiteUrl.username || websiteUrl.password) {
      return { sent: false, error: "A valid installation website URL is required to send demo email." };
    }
    demoUrl = new URL("/demo", websiteUrl).toString();
  } catch {
    return { sent: false, error: "A valid installation website URL is required to send demo email." };
  }

  const escapeHtml = (value: string) => value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  const businessName = configuredBusinessName(installation);
  const safeBusinessName = escapeHtml(businessName);
  const safeFirstName = escapeHtml(lead.firstName);
  const safeCompany = escapeHtml(lead.company);
  const safeDemoUrl = escapeHtml(demoUrl);
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f8fafc;color:#1e293b;">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:8px;overflow:hidden;">
    <div style="background:#1e3a5f;padding:28px 32px;">
      <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;">${safeBusinessName}</p>
      <p style="margin:4px 0 0;font-size:13px;color:#93c5fd;">Effortless uniform management, from order to delivery</p>
    </div>
    <div style="padding:32px;">
      <p>Hi ${safeFirstName},</p>
      <p>Your demo access is ready. Use the link below to return to the demo.</p>
      <p><a href="${safeDemoUrl}">Return to the demo</a></p>
      <p>Our team will be in touch to discuss a tailored demo for <strong>${safeCompany}</strong>.</p>
      <p>Warm regards,<br>${safeBusinessName}</p>
    </div>
  </div>
</body>
</html>`;
  const text = `Hi ${lead.firstName},\n\nYour demo access is ready.\n\nReturn to the demo: ${demoUrl}\n\nOur team will be in touch to discuss how we can support ${lead.company}.\n\nWarm regards,\n${businessName}`;
  try {
    return await sendEmail({ to: lead.email, subject: `Your demo access is ready, ${lead.firstName}`, html, text });
  } catch (err: any) {
    return { sent: false, error: err.message };
  }
}

router.post("/demo/register", async (req: Request, res: Response) => {
  if (!DEMO_ENABLED) { res.status(404).json({ error: "Demo is disabled" }); return; }
  const body = z.object({
    firstName: z.string().min(1).max(80),
    lastName: z.string().min(1).max(80),
    email: z.string().email(),
    company: z.string().min(1).max(120),
  }).safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "Please fill in all fields correctly." });
    return;
  }

  const { firstName, lastName, email, company } = body.data;
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket?.remoteAddress ?? null;
  await db.execute(sql`
    INSERT INTO demo_leads (first_name, last_name, email, company, ip)
    VALUES (${firstName}, ${lastName}, ${email}, ${company}, ${ip})
  `);
  sendDemoEmail({ firstName, email, company }).catch(() => {});

  const token = jwt.sign({ isDemo: true, firstName, company }, JWT_SECRET, { expiresIn: DEMO_TOKEN_TTL });
  res.json({ token, firstName, company });
});

router.get("/demo/stats", demoAuth, async (_req: Request, res: Response) => {
  res.json({
    summary: {
      total_orders: "0", active_orders: "0", dispatched: "0",
      portal_pending: "0", month_value: "0", total_value: "0",
    },
    byStatus: [],
    seeded: false,
  });
});

router.get("/demo/orders", demoAuth, async (_req: Request, res: Response) => {
  res.json({ orders: [], total: 0, seeded: false });
});

router.get("/demo/orders/:id", demoAuth, async (req: Request, res: Response) => {
  if (!/^\d+$/.test(req.params.id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  res.status(404).json({ error: "Not found" });
});

router.get("/demo/products", demoAuth, async (_req: Request, res: Response) => {
  res.json({ products: [], total: 0 });
});

router.get("/demo/customers", demoAuth, async (_req: Request, res: Response) => {
  res.json({ customers: [] });
});

router.get("/demo/portal-preview", demoAuth, async (_req: Request, res: Response) => {
  if (!SYNTHETIC_PORTAL_PREVIEW_ENABLED) {
    res.status(404).json({ error: "Portal preview is unavailable without synthetic test fixtures" });
    return;
  }

  const customerName = "Synthetic Demo Customer";
  const token = jwt.sign(
    { sub: "synthetic-demo-customer", isStaffPreview: true, syntheticDemo: true, customerName },
    PORTAL_JWT_SECRET,
    { expiresIn: "2h" },
  );
  const previewUrl = `/customer-portal/preview-login?token=${token}`;
  res.json({ previewUrl, customerName, expiresIn: "2h" });
});

export default router;