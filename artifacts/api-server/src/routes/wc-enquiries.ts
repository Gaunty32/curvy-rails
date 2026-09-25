import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sendEmail } from "../services/email.js";
import { fireWorkflow } from "../services/workflow-engine.js";
import jwt from "jsonwebtoken";

const router = Router();

const JWT_SECRET = process.env.PORTAL_JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("PORTAL_JWT_SECRET must be configured with at least 32 characters.");
}

/** Returns true when the request carries a valid staff JWT. */
function isStaffRequest(req: Request): boolean {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return false;
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as Record<string, unknown>;
    return payload.role === "staff";
  } catch {
    return false;
  }
}

function requireStaff(req: Request, res: Response): boolean {
  if (!isStaffRequest(req)) {
    res.status(401).json({ error: "Staff authentication required" });
    return false;
  }
  return true;
}

// ─── POST /wc-enquiries  (webhook called by the WooCommerce plugin) ───────────
router.post("/wc-enquiries", async (req: Request, res: Response): Promise<void> => {
  // Optional shared-secret check
  const settingsRows = await db.execute(sql`
    SELECT key, value FROM settings
    WHERE key IN ('wc_enquiry_webhook_secret', 'enquiry_notification_email')
  `);

  const settingsMap = Object.fromEntries(
    (settingsRows.rows as any[]).map((r: any) => [r.key, r.value])
  );
  const storedSecret: string | null = settingsMap["wc_enquiry_webhook_secret"] ?? null;
  const notificationEmail: string | null = settingsMap["enquiry_notification_email"] ?? null;

  if (storedSecret && storedSecret.trim() !== "") {
    const provided =
      (req.headers["x-sbs-secret"] as string | undefined) ?? "";
    if (provided !== storedSecret.trim()) {
      res.status(401).json({ error: "Invalid webhook secret" });
      return;
    }
  }

  const {
    product_id,
    product_name,
    customer_name,
    email,
    phone,
    message,
  } = req.body as Record<string, string>;

  if (!customer_name || !email || !message) {
    res.status(400).json({ error: "Missing required fields: customer_name, email, message" });
    return;
  }

  // Try to link to an existing customer by email
  const custRows = await db.execute(sql`
    SELECT id FROM customers WHERE LOWER(email) = LOWER(${email ?? ""}) LIMIT 1
  `);
  const customerId: number | null = (custRows.rows[0] as any)?.id ?? null;

  await db.execute(sql`
    INSERT INTO wc_enquiries
      (product_id, product_name, customer_name, email, phone, message, customer_id)
    VALUES (
      ${product_id ? Number(product_id) : null},
      ${product_name ?? null},
      ${customer_name},
      ${email},
      ${phone ?? null},
      ${message},
      ${customerId}
    )
  `);

  // ── Send staff notification email (if configured) ─────────────────────────
  if (notificationEmail && notificationEmail.trim() !== "") {
    const productLine = product_name
      ? `<p><strong>Product:</strong> ${product_name}</p>`
      : "";
    const phoneLine = phone
      ? `<p><strong>Phone:</strong> ${phone}</p>`
      : "";

    sendEmail({
      to: notificationEmail.trim(),
      subject: `New product enquiry from ${customer_name}`,
      html: `
        <h2 style="margin:0 0 16px">New Product Enquiry</h2>
        <p><strong>Name:</strong> ${customer_name}</p>
        <p><strong>Email:</strong> ${email}</p>
        ${phoneLine}
        ${productLine}
        <p><strong>Message:</strong></p>
        <blockquote style="border-left:3px solid #ccc;padding-left:12px;margin:8px 0">${message.replace(/\n/g, "<br>")}</blockquote>
        <hr style="margin:24px 0">
        <p style="font-size:12px;color:#666">View all enquiries in the order system.</p>
      `,
      text: `New Product Enquiry\n\nName: ${customer_name}\nEmail: ${email}${phone ? `\nPhone: ${phone}` : ""}${product_name ? `\nProduct: ${product_name}` : ""}\n\nMessage:\n${message}`,
    }).catch((err: any) => {
      console.error("[wc-enquiries] Failed to send notification email:", err?.message);
    });
  }

  // Fire workflow automation (non-blocking)
  fireWorkflow("enquiry_received", {
    contact_name: customer_name,
    contact_email: email,
    contact_phone: phone ?? null,
    product_name: product_name ?? null,
    message,
  }).catch(() => {});

  res.json({ ok: true });
});

// ─── GET /wc-enquiries/unread-count  (badge count for nav — staff only) ───────
router.get("/wc-enquiries/unread-count", async (req: Request, res: Response): Promise<void> => {
  if (!requireStaff(req, res)) return;
  const rows = await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM wc_enquiries WHERE is_read = false
  `);
  const count: number = (rows.rows[0] as any)?.count ?? 0;
  res.json({ count });
});

// ─── PATCH /wc-enquiries/mark-all-read  (mark all enquiries as read — staff only) ─
router.patch("/wc-enquiries/mark-all-read", async (req: Request, res: Response): Promise<void> => {
  if (!requireStaff(req, res)) return;
  await db.execute(sql`
    UPDATE wc_enquiries SET is_read = true WHERE is_read = false
  `);
  res.json({ ok: true });
});

// ─── PATCH /wc-enquiries/:id/mark-read  (mark a single enquiry as read — staff only) ─
router.patch("/wc-enquiries/:id/mark-read", async (req: Request, res: Response): Promise<void> => {
  if (!requireStaff(req, res)) return;
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.execute(sql`
    UPDATE wc_enquiries SET is_read = true WHERE id = ${id}
  `);
  res.json({ ok: true });
});

// ─── GET /wc-enquiries  (order system list view — staff only) ─────────────────
router.get("/wc-enquiries", async (req: Request, res: Response): Promise<void> => {
  if (!requireStaff(req, res)) return;
  const rows = await db.execute(sql`
    SELECT
      e.id,
      e.product_id,
      e.product_name,
      e.customer_name,
      e.email,
      e.phone,
      e.message,
      e.customer_id,
      e.is_read,
      e.source,
      e.created_at,
      c.name AS linked_customer_name
    FROM wc_enquiries e
    LEFT JOIN customers c ON c.id = e.customer_id
    ORDER BY e.created_at DESC
    LIMIT 500
  `);
  res.json(rows.rows);
});

export default router;
