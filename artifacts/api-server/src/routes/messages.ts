import { Router, type IRouter } from "express";
import { eq, desc, and, sql, notExists } from "drizzle-orm";
import { z } from "zod";
import { db, ordersTable, orderMessagesTable, orderMessageReadsTable } from "@workspace/db";
import { getActor } from "../services/orderLog.js";

const router: IRouter = Router();

// GET /orders/:id/messages — list messages for an order, mark them read
router.get("/orders/:id/messages", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const actor = getActor(req);

  const messages = await db
    .select({
      id: orderMessagesTable.id,
      orderId: orderMessagesTable.orderId,
      orderNumber: orderMessagesTable.orderNumber,
      authorName: orderMessagesTable.authorName,
      body: orderMessagesTable.body,
      createdAt: orderMessagesTable.createdAt,
    })
    .from(orderMessagesTable)
    .where(eq(orderMessagesTable.orderId, params.data.id))
    .orderBy(orderMessagesTable.createdAt);

  // Mark all unread messages as read for this actor (if named)
  if (actor && actor !== "Unknown") {
    const unreadIds = messages.filter(m => true).map(m => m.id);
    if (unreadIds.length > 0) {
      await db.execute(sql`
        INSERT INTO order_message_reads (message_id, reader_name)
        SELECT unnest(${unreadIds}::int[]), ${actor}
        ON CONFLICT (message_id, reader_name) DO NOTHING
      `);
    }
  }

  res.json(messages);
});

// POST /orders/:id/messages — post a new message
router.post("/orders/:id/messages", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const body = z.object({ body: z.string().min(1).max(5000), authorName: z.string().min(1).max(200) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [order] = await db.select({ id: ordersTable.id, orderNumber: ordersTable.orderNumber }).from(ordersTable).where(eq(ordersTable.id, params.data.id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  const [message] = await db.insert(orderMessagesTable).values({
    orderId: order.id,
    orderNumber: order.orderNumber,
    authorName: body.data.authorName,
    body: body.data.body,
  }).returning();

  // Mark as read by the author immediately
  await db.execute(sql`
    INSERT INTO order_message_reads (message_id, reader_name)
    VALUES (${message.id}, ${body.data.authorName})
    ON CONFLICT (message_id, reader_name) DO NOTHING
  `);

  res.status(201).json(message);
});

// GET /messages/inbox — global inbox: recent messages across all orders + unread count per actor
router.get("/messages/inbox", async (req, res): Promise<void> => {
  const query = z.object({ reader: z.string().min(1).optional() }).safeParse(req.query);
  const reader = query.success ? query.data.reader : undefined;

  const rows = await db.execute(sql`
    SELECT
      m.id,
      m.order_id,
      m.order_number,
      m.author_name,
      m.body,
      m.created_at,
      o.customer_name,
      o.status AS order_status,
      CASE WHEN r.id IS NOT NULL THEN true ELSE false END AS is_read
    FROM order_messages m
    JOIN orders o ON o.id = m.order_id
    LEFT JOIN order_message_reads r ON r.message_id = m.id AND r.reader_name = ${reader ?? ""}
    ORDER BY m.created_at DESC
    LIMIT 100
  `);

  const unreadCount = reader
    ? await db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM order_messages m
        WHERE NOT EXISTS (
          SELECT 1 FROM order_message_reads r
          WHERE r.message_id = m.id AND r.reader_name = ${reader}
        )
      `).then(r => Number((r.rows[0] as any)?.count ?? 0))
    : 0;

  res.json({ messages: rows.rows, unreadCount });
});

// PATCH /messages/:id/read — mark a single message read
router.patch("/messages/:id/read", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = z.object({ readerName: z.string().min(1) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  await db.execute(sql`
    INSERT INTO order_message_reads (message_id, reader_name)
    VALUES (${params.data.id}, ${body.data.readerName})
    ON CONFLICT (message_id, reader_name) DO NOTHING
  `);
  res.json({ ok: true });
});

export default router;
