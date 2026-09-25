import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/message-templates", async (_req, res): Promise<void> => {
  const result = await db.execute(sql`
    SELECT id, key, name, channel, subject, body, variables, notes, updated_at
    FROM message_templates
    ORDER BY channel, name
  `);
  res.json(result.rows);
});

router.get("/message-templates/:key", async (req, res): Promise<void> => {
  const result = await db.execute(sql`
    SELECT id, key, name, channel, subject, body, variables, notes, updated_at
    FROM message_templates
    WHERE key = ${req.params.key}
    LIMIT 1
  `);
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  res.json(result.rows[0]);
});

router.patch("/message-templates/:key", async (req, res): Promise<void> => {
  const { name, subject, body } = req.body ?? {};

  const current = await db.execute(sql`
    SELECT name, subject, body FROM message_templates WHERE key = ${req.params.key} LIMIT 1
  `);
  if (current.rows.length === 0) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  const row = current.rows[0] as any;

  await db.execute(sql`
    UPDATE message_templates
    SET name    = ${name    !== undefined ? name    : row.name},
        subject = ${subject !== undefined ? subject : row.subject},
        body    = ${body    !== undefined ? body    : row.body},
        updated_at = now()
    WHERE key = ${req.params.key}
  `);

  const updated = await db.execute(sql`
    SELECT id, key, name, channel, subject, body, variables, notes, updated_at
    FROM message_templates WHERE key = ${req.params.key} LIMIT 1
  `);
  res.json(updated.rows[0]);
});

export default router;
