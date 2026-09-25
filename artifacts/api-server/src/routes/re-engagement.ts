import { Router, type Request, type Response } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { sendCheckInEmails } from "../services/scheduler.js";
import { buildCheckInEmail } from "../services/email.js";

const router = Router();

// ─── GET /reengagement/settings ──────────────────────────────────────────────

router.get("/reengagement/settings", async (_req: Request, res: Response) => {
  const rows = await db.select().from(settingsTable).where(
    sql`${settingsTable.key} IN ('checkin_email_enabled', 'checkin_email_last_run')`
  );

  const byKey: Record<string, string> = {};
  for (const row of rows) byKey[row.key] = row.value ?? "";

  res.json({
    enabled: byKey["checkin_email_enabled"] === "true",
    lastRun: byKey["checkin_email_last_run"] ?? null,
  });
});

// ─── POST /reengagement/settings ─────────────────────────────────────────────

router.post("/reengagement/settings", async (req: Request, res: Response) => {
  const { enabled } = req.body as { enabled: boolean };
  await db.execute(sql`
    INSERT INTO settings (key, value, updated_at)
    VALUES ('checkin_email_enabled', ${enabled ? "true" : "false"}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `);
  res.json({ ok: true });
});

// ─── POST /reengagement/send-now ─────────────────────────────────────────────

router.post("/reengagement/send-now", async (_req: Request, res: Response) => {
  try {
    const result = await sendCheckInEmails();
    res.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[reengagement] Manual send-now failed:", err);
    res.status(500).json({ ok: false, error: err?.message ?? "Unknown error" });
  }
});

// ─── GET /reengagement/preview ───────────────────────────────────────────────
// Returns the HTML of the check-in email with sample data so staff can review it.

router.get("/reengagement/preview", async (_req: Request, res: Response) => {
  const { html } = buildCheckInEmail({
    customerName: "Acme Workwear Ltd",
    firstName: "Sarah",
    portalUrl: null,
    customerLogoDataUrl: null,
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// ─── GET /reengagement/eligible-count ────────────────────────────────────────
// Returns the number of customers who would receive an email if run now.

router.get("/reengagement/eligible-count", async (_req: Request, res: Response) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 120);

  const result = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id
    WHERE c.email IS NOT NULL AND c.email <> ''
    GROUP BY c.id, c.checkin_email_sent_at
    HAVING
      (MAX(o.order_date) < ${cutoff} OR MAX(o.order_date) IS NULL)
      AND (c.checkin_email_sent_at IS NULL OR c.checkin_email_sent_at < ${cutoff})
  `);

  res.json({ count: result.rows.length });
});

export default router;
