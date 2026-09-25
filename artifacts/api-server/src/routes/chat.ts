import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sendEmail } from "../services/email.js";

const router: IRouter = Router();

function actorName(req: Request): string {
  return (req.headers["x-actor"] as string | undefined) || "Unknown";
}

// ─── GET /chat/conversations ────────────────────────────────────────────────
router.get("/chat/conversations", async (_req: Request, res: Response): Promise<void> => {
  const rows = await db.execute(sql`
    SELECT
      c.id,
      c.type,
      c.order_id,
      c.customer_id,
      c.subject,
      c.created_by,
      c.created_at,
      c.last_message_at,
      (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id) AS message_count,
      (SELECT m2.content FROM chat_messages m2 WHERE m2.conversation_id = c.id ORDER BY m2.created_at DESC LIMIT 1) AS last_message,
      (SELECT m2.sender_name FROM chat_messages m2 WHERE m2.conversation_id = c.id ORDER BY m2.created_at DESC LIMIT 1) AS last_sender,
      o.order_number,
      cust.name AS customer_name,
      COALESCE(
        (SELECT json_agg(p.user_name ORDER BY p.added_at) FROM chat_participants p WHERE p.conversation_id = c.id),
        '[]'::json
      ) AS participants
    FROM chat_conversations c
    LEFT JOIN orders o ON o.id = c.order_id
    LEFT JOIN customers cust ON cust.id = c.customer_id
    ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
  `);
  res.json(rows.rows);
});

// ─── POST /chat/conversations ────────────────────────────────────────────────
router.post("/chat/conversations", async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({
    type: z.enum(["general", "order", "customer", "custom", "direct"]),
    order_id: z.number().int().optional().nullable(),
    customer_id: z.number().int().optional().nullable(),
    subject: z.string().max(200).optional().nullable(),
    participant_names: z.array(z.string().min(1).max(100)).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const actor = actorName(req);
  const d = parsed.data;

  if (d.type === "order" && d.order_id) {
    const existing = await db.execute(sql`SELECT id FROM chat_conversations WHERE type='order' AND order_id=${d.order_id} LIMIT 1`);
    if (existing.rows.length) { res.json(existing.rows[0]); return; }
  }
  if (d.type === "customer" && d.customer_id) {
    const existing = await db.execute(sql`SELECT id FROM chat_conversations WHERE type='customer' AND customer_id=${d.customer_id} LIMIT 1`);
    if (existing.rows.length) { res.json(existing.rows[0]); return; }
  }

  if (d.type === "direct") {
    const names = (d.participant_names ?? []).map(n => n.trim()).filter(Boolean);
    if (names.length === 0) { res.status(400).json({ error: "At least one recipient is required" }); return; }
    const allParticipants = Array.from(new Set([actor, ...names])).sort((a, b) => a.localeCompare(b));
    const participantsKey = allParticipants.join("||");

    const existing = await db.execute(sql`
      SELECT id FROM chat_conversations WHERE type = 'direct' AND participants_key = ${participantsKey} LIMIT 1
    `);
    if (existing.rows.length) { res.json(existing.rows[0]); return; }

    const result = await db.execute(sql`
      INSERT INTO chat_conversations (type, subject, created_by, participants_key)
      VALUES ('direct', ${d.subject ?? null}, ${actor}, ${participantsKey})
      RETURNING *
    `);
    const conv = result.rows[0] as any;

    for (const name of allParticipants) {
      await db.execute(sql`
        INSERT INTO chat_participants (conversation_id, user_name, added_by)
        VALUES (${conv.id}, ${name}, ${actor})
        ON CONFLICT DO NOTHING
      `);
    }

    res.status(201).json(conv);
    return;
  }

  const result = await db.execute(sql`
    INSERT INTO chat_conversations (type, order_id, customer_id, subject, created_by)
    VALUES (${d.type}, ${d.order_id ?? null}, ${d.customer_id ?? null}, ${d.subject ?? null}, ${actor})
    RETURNING *
  `);
  const conv = result.rows[0] as any;

  // Auto-add creator as a participant
  await db.execute(sql`
    INSERT INTO chat_participants (conversation_id, user_name, added_by)
    VALUES (${conv.id}, ${actor}, ${actor})
    ON CONFLICT DO NOTHING
  `);

  res.status(201).json(conv);
});

// ─── GET /chat/conversations/:id/messages ────────────────────────────────────
router.get("/chat/conversations/:id/messages", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const since = req.query.since as string | undefined;

  const rows = await db.execute(
    since
      ? sql`SELECT * FROM chat_messages WHERE conversation_id = ${id} AND created_at > ${since}::timestamptz ORDER BY created_at ASC`
      : sql`SELECT * FROM chat_messages WHERE conversation_id = ${id} ORDER BY created_at ASC LIMIT 200`
  );
  res.json(rows.rows);
});

// ─── POST /chat/conversations/:id/messages ───────────────────────────────────
router.post("/chat/conversations/:id/messages", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = z.object({
    content: z.string().min(1).max(4000),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const actor = actorName(req);

  const msg = await db.execute(sql`
    INSERT INTO chat_messages (conversation_id, sender_name, content)
    VALUES (${id}, ${actor}, ${parsed.data.content})
    RETURNING *
  `);

  await db.execute(sql`UPDATE chat_conversations SET last_message_at = NOW() WHERE id = ${id}`);

  // Auto-add sender as participant if not already
  await db.execute(sql`
    INSERT INTO chat_participants (conversation_id, user_name, added_by)
    VALUES (${id}, ${actor}, ${actor})
    ON CONFLICT DO NOTHING
  `);

  const conv = await db.execute(sql`
    SELECT c.*, o.order_number, cust.name AS customer_name
    FROM chat_conversations c
    LEFT JOIN orders o ON o.id = c.order_id
    LEFT JOIN customers cust ON cust.id = c.customer_id
    WHERE c.id = ${id}
  `);
  const convRow = conv.rows[0] as any;

  const prefs = await db.execute(sql`
    SELECT user_name, email FROM chat_notification_prefs
    WHERE conversation_id = ${id} AND notify_email = true AND email IS NOT NULL AND email != '' AND user_name != ${actor}
  `);

  if (prefs.rows.length > 0) {
    let chatTitle = convRow?.subject || "General";
    if (convRow?.type === "order" && convRow?.order_number) chatTitle = `Order ${convRow.order_number}`;
    else if (convRow?.type === "customer" && convRow?.customer_name) chatTitle = `Customer: ${convRow.customer_name}`;

    for (const pref of prefs.rows as any[]) {
      sendEmail({
        to: pref.email,
        subject: `New message in ${chatTitle} — Order system`,
        html: `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#f8fafc;padding:24px;border-radius:10px">
  <p style="margin:0 0 8px;font-size:13px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Order chat · ${chatTitle}</p>
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin-bottom:16px">
    <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#1e293b">${actor}</p>
    <p style="margin:0;font-size:14px;color:#334155;white-space:pre-wrap">${parsed.data.content.replace(/</g, "&lt;")}</p>
  </div>
  <p style="margin:0;font-size:12px;color:#94a3b8">Reply in the order system. To stop receiving these emails, turn off notifications for this chat.</p>
</div>`,
        text: `${actor} in ${chatTitle}:\n\n${parsed.data.content}`,
      }).catch(() => {});
    }
  }

  res.status(201).json(msg.rows[0]);
});

// ─── GET /chat/conversations/:id/participants ────────────────────────────────
router.get("/chat/conversations/:id/participants", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.execute(sql`
    SELECT user_name, added_by, added_at FROM chat_participants
    WHERE conversation_id = ${id}
    ORDER BY added_at ASC
  `);
  res.json(rows.rows);
});

// ─── POST /chat/conversations/:id/participants ───────────────────────────────
router.post("/chat/conversations/:id/participants", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = z.object({ user_name: z.string().min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const actor = actorName(req);
  await db.execute(sql`
    INSERT INTO chat_participants (conversation_id, user_name, added_by)
    VALUES (${id}, ${parsed.data.user_name}, ${actor})
    ON CONFLICT DO NOTHING
  `);
  res.json({ ok: true });
});

// ─── DELETE /chat/conversations/:id/participants/:userName ───────────────────
router.delete("/chat/conversations/:id/participants/:userName", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const userName = decodeURIComponent(req.params.userName);
  await db.execute(sql`
    DELETE FROM chat_participants WHERE conversation_id = ${id} AND user_name = ${userName}
  `);
  res.json({ ok: true });
});

// ─── GET /chat/unread-count ───────────────────────────────────────────────────
// Returns unread message count for the requesting actor
router.get("/chat/unread-count", async (req: Request, res: Response): Promise<void> => {
  const actor = actorName(req);
  if (!actor || actor === "Unknown") { res.json({ count: 0 }); return; }
  const rows = await db.execute(sql`
    SELECT COUNT(*) AS count
    FROM chat_messages m
    JOIN chat_participants p ON p.conversation_id = m.conversation_id AND p.user_name = ${actor}
    WHERE m.sender_name != ${actor}
    AND NOT EXISTS (
      SELECT 1 FROM chat_message_reads r WHERE r.message_id = m.id AND r.user_name = ${actor}
    )
  `);
  const count = parseInt((rows.rows[0] as any)?.count ?? "0", 10);
  res.json({ count });
});

// ─── POST /chat/conversations/:id/mark-read ───────────────────────────────────
router.post("/chat/conversations/:id/mark-read", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const actor = actorName(req);
  if (!actor || actor === "Unknown") { res.json({ ok: true }); return; }
  await db.execute(sql`
    INSERT INTO chat_message_reads (message_id, user_name)
    SELECT m.id, ${actor}
    FROM chat_messages m
    WHERE m.conversation_id = ${id}
    ON CONFLICT DO NOTHING
  `);
  res.json({ ok: true });
});

// ─── GET /chat/known-users ────────────────────────────────────────────────────
// Returns distinct sender names from recent messages (for the add-member typeahead)
router.get("/chat/known-users", async (_req: Request, res: Response): Promise<void> => {
  const rows = await db.execute(sql`
    SELECT DISTINCT sender_name AS user_name
    FROM chat_messages
    ORDER BY sender_name
    LIMIT 50
  `);
  res.json(rows.rows);
});

// ─── GET /chat/conversations/by-order/:orderId ───────────────────────────────
router.get("/chat/conversations/by-order/:orderId", async (req: Request, res: Response): Promise<void> => {
  const orderId = parseInt(req.params.orderId, 10);
  const rows = await db.execute(sql`SELECT * FROM chat_conversations WHERE type='order' AND order_id=${orderId} LIMIT 1`);
  if (rows.rows.length) { res.json(rows.rows[0]); return; }
  res.status(404).json({ error: "Not found" });
});

// ─── GET /chat/conversations/by-customer/:customerId ─────────────────────────
router.get("/chat/conversations/by-customer/:customerId", async (req: Request, res: Response): Promise<void> => {
  const customerId = parseInt(req.params.customerId, 10);
  const rows = await db.execute(sql`SELECT * FROM chat_conversations WHERE type='customer' AND customer_id=${customerId} LIMIT 1`);
  if (rows.rows.length) { res.json(rows.rows[0]); return; }
  res.status(404).json({ error: "Not found" });
});

// ─── GET /chat/notification-prefs/:convId ────────────────────────────────────
router.get("/chat/notification-prefs/:convId", async (req: Request, res: Response): Promise<void> => {
  const convId = parseInt(req.params.convId, 10);
  const actor = actorName(req);
  const rows = await db.execute(sql`
    SELECT * FROM chat_notification_prefs WHERE conversation_id = ${convId} AND user_name = ${actor}
  `);
  res.json(rows.rows[0] ?? { conversation_id: convId, user_name: actor, email: null, notify_email: false });
});

// ─── POST /chat/notification-prefs ───────────────────────────────────────────
router.post("/chat/notification-prefs", async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({
    conversation_id: z.number().int(),
    notify_email: z.boolean(),
    email: z.string().email().optional().nullable(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const actor = actorName(req);
  const { conversation_id, notify_email, email } = parsed.data;

  await db.execute(sql`
    INSERT INTO chat_notification_prefs (conversation_id, user_name, notify_email, email)
    VALUES (${conversation_id}, ${actor}, ${notify_email}, ${email ?? null})
    ON CONFLICT (conversation_id, user_name)
    DO UPDATE SET notify_email = EXCLUDED.notify_email, email = COALESCE(EXCLUDED.email, chat_notification_prefs.email)
  `);
  res.json({ ok: true });
});

export default router;
