import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sendEmail } from "../services/email.js";
import { portalAuth } from "./portal.js";
import { decodeStaffJwt } from "./staff-auth.js";

const router: IRouter = Router();

const OWNER_EMAIL = process.env.FEEDBACK_OWNER_EMAIL;
const TYPE_LABELS: Record<string, string> = {
  critical: "🚨 Critical Issue",
  minor: "⚠️ Minor Issue",
  feature: "💡 Feature Request",
};

function feedbackEmailHtml(type: string, title: string, description: string, submittedBy: string, source: string) {
  const isCritical = type === "critical";
  const accent = isCritical ? "#dc2626" : type === "minor" ? "#d97706" : "#2563eb";
  const pale = isCritical ? "#fef2f2" : type === "minor" ? "#fffbeb" : "#eff6ff";
  const dark = isCritical ? "#991b1b" : type === "minor" ? "#92400e" : "#1e40af";
  const label = TYPE_LABELS[type] ?? "Feedback";
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;padding:24px;margin:0">
  <div style="max-width:540px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
    <div style="background:${accent};padding:20px 28px">
      <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#fff;opacity:.75">New Feedback</p>
      <h1 style="margin:6px 0 0;font-size:20px;color:#fff;font-weight:800">${label}</h1>
    </div>
    <div style="padding:28px">
      <p style="margin:0 0 16px;font-size:15px;font-weight:700;color:#0f172a">${title}</p>
      ${description ? `<p style="margin:0 0 20px;font-size:14px;color:#334155;white-space:pre-wrap;background:#f8fafc;border-left:3px solid ${accent};padding:12px 16px;border-radius:0 6px 6px 0">${description}</p>` : ""}
      <table style="font-size:13px;color:#475569;border-collapse:collapse">
        <tr><td style="padding:3px 12px 3px 0;font-weight:600;color:#94a3b8;text-transform:uppercase;font-size:11px;letter-spacing:.05em">Reported by</td><td>${submittedBy || "Unknown"}</td></tr>
        <tr><td style="padding:3px 12px 3px 0;font-weight:600;color:#94a3b8;text-transform:uppercase;font-size:11px;letter-spacing:.05em">Source</td><td>${source === "portal" ? "Customer Portal" : "Staff System"}</td></tr>
        <tr><td style="padding:3px 12px 3px 0;font-weight:600;color:#94a3b8;text-transform:uppercase;font-size:11px;letter-spacing:.05em">Time</td><td>${new Date().toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" })}</td></tr>
      </table>
    </div>
    <div style="padding:16px 28px;background:${pale};border-top:1px solid ${accent}22">
      <p style="margin:0;font-size:12px;color:${dark}">${isCritical ? "Please review this issue in the production system as soon as possible." : "Review this item in Feedback & Issues in the production system."}</p>
    </div>
  </div>
</body>
</html>`;
}

// POST /feedback — staff submits feedback
router.post("/feedback", async (req, res): Promise<void> => {
  const staff = decodeStaffJwt(req);
  if (!staff) {
    res.status(401).json({ error: "Staff login required" });
    return;
  }
  const staffEmail = typeof staff.email === "string" ? staff.email.trim() : "";
  const staffName = typeof staff.name === "string" ? staff.name.trim() : "";
  if (!staffEmail) {
    res.status(403).json({ error: "Please sign in with your individual staff account before submitting feedback." });
    return;
  }

  const parsed = z.object({
    type: z.enum(["critical", "minor", "feature"]),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).default(""),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { type, title, description } = parsed.data;
  const submittedBy = staffName ? `${staffName} (${staffEmail})` : staffEmail;

  const result = await db.execute(sql`
    INSERT INTO feedback_items (type, title, description, submitted_by, source, status)
    VALUES (${type}, ${title}, ${description}, ${submittedBy}, 'staff', 'open')
    RETURNING id
  `);

  sendEmail({
    to: OWNER_EMAIL,
    subject: `${TYPE_LABELS[type]}: ${title}`,
    html: feedbackEmailHtml(type, title, description, submittedBy, "staff"),
    text: `${TYPE_LABELS[type]}\n\n${title}\n\n${description}\n\nReported by: ${submittedBy}\nSource: Staff System`,
  }).catch(() => {});

  res.json({ id: (result.rows[0] as any).id });
});

// GET /feedback — list all feedback (staff admin)
router.get("/feedback", async (_req, res): Promise<void> => {
  const result = await db.execute(sql`
    SELECT id, type, title, description, submitted_by, source, status, admin_note, note_by, note_at, created_at, updated_at
    FROM feedback_items
    ORDER BY
      CASE WHEN status = 'open' THEN 0 WHEN status = 'in_progress' THEN 1 ELSE 2 END,
      CASE WHEN type = 'critical' THEN 0 WHEN type = 'minor' THEN 1 ELSE 2 END,
      created_at DESC
  `);
  res.json(result.rows);
});

// PATCH /feedback/:id — update status and/or admin note
router.patch("/feedback/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = z.object({
    status: z.enum(["open", "in_progress", "resolved"]).optional(),
    admin_note: z.string().max(2000).optional(),
    note_by: z.string().max(100).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const sets: string[] = ["updated_at = NOW()"];
  if (parsed.data.status !== undefined) sets.push(`status = '${parsed.data.status}'`);
  if (parsed.data.admin_note !== undefined) {
    sets.push(`admin_note = '${parsed.data.admin_note.replace(/'/g, "''")}'`);
    sets.push(`note_at = NOW()`);
    const noteBy = parsed.data.note_by ?? "";
    sets.push(`note_by = '${noteBy.replace(/'/g, "''")}'`);
  }

  await db.execute(sql.raw(`UPDATE feedback_items SET ${sets.join(", ")} WHERE id = ${id}`));
  res.json({ ok: true });
});

// POST /portal/feedback — customer portal feedback
router.post("/portal/feedback", portalAuth, async (req, res): Promise<void> => {
  const parsed = z.object({
    type: z.enum(["critical", "minor", "feature"]),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).default(""),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { type, title, description } = parsed.data;
  const customerId: number = (req as any).portalCustomerId;
  const custRow = await db.execute(sql`SELECT name FROM customers WHERE id = ${customerId} LIMIT 1`);
  const customerName: string = (custRow.rows[0] as any)?.name ?? "Portal user";

  const result = await db.execute(sql`
    INSERT INTO feedback_items (type, title, description, submitted_by, source, status)
    VALUES (${type}, ${title}, ${description}, ${customerName}, 'portal', 'open')
    RETURNING id
  `);

  sendEmail({
    to: OWNER_EMAIL,
    subject: `${TYPE_LABELS[type]} (Portal — ${customerName}): ${title}`,
    html: feedbackEmailHtml(type, title, description, customerName, "portal"),
    text: `${TYPE_LABELS[type]} from Customer Portal\n\n${title}\n\n${description}\n\nReported by: ${customerName}\nSource: Customer Portal`,
  }).catch(() => {});

  res.json({ id: (result.rows[0] as any).id });
});

export default router;
