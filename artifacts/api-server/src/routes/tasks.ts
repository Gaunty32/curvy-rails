import { Router, type IRouter } from "express";
import { eq, and, or, desc } from "drizzle-orm";
import { z } from "zod";
import { db, tasksTable } from "@workspace/db";
import { createCheckInReminders } from "../services/scheduler.js";

const router: IRouter = Router();

const taskBody = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  status: z.enum(["open", "in_progress", "done"]).default("open"),
  customerId: z.number().int().positive().optional().nullable(),
  customerName: z.string().optional().nullable(),
  dueDate: z.string().datetime({ offset: true }).optional().nullable(),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

const listQuery = z.object({
  status: z.string().optional(),
  priority: z.string().optional(),
});

router.get("/tasks", async (req, res): Promise<void> => {
  const q = listQuery.safeParse(req.query);
  const filters = [];
  if (q.success) {
    if (q.data.status) filters.push(eq(tasksTable.status, q.data.status));
    if (q.data.priority) filters.push(eq(tasksTable.priority, q.data.priority));
  }

  const tasks = await db.select().from(tasksTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(
      // Sort: high → medium → low, then newest first
      desc(tasksTable.priority),
      desc(tasksTable.createdAt)
    );

  res.json(tasks);
});

router.post("/tasks", async (req, res): Promise<void> => {
  const body = taskBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.insert(tasksTable).values({
    ...body.data,
    dueDate: body.data.dueDate ? new Date(body.data.dueDate) : null,
  }).returning();
  res.status(201).json(row);
});

router.get("/tasks/:id", async (req, res): Promise<void> => {
  const p = idParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.select().from(tasksTable).where(eq(tasksTable.id, p.data.id));
  if (!row) { res.status(404).json({ error: "Task not found" }); return; }
  res.json(row);
});

router.patch("/tasks/:id", async (req, res): Promise<void> => {
  const p = idParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = taskBody.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const updates: Record<string, unknown> = {
    ...body.data,
    updatedAt: new Date(),
  };
  if (body.data.dueDate !== undefined) {
    updates.dueDate = body.data.dueDate ? new Date(body.data.dueDate) : null;
  }
  // Auto-set completedAt when marking done
  if (body.data.status === "done") {
    updates.completedAt = new Date();
  } else if (body.data.status && body.data.status !== "done") {
    updates.completedAt = null;
  }

  const [row] = await db.update(tasksTable).set(updates).where(eq(tasksTable.id, p.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Task not found" }); return; }
  res.json(row);
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const p = idParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.delete(tasksTable).where(eq(tasksTable.id, p.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Task not found" }); return; }
  res.sendStatus(204);
});

// Manually trigger the check-in reminder scan
router.post("/tasks/run-check-in-scan", async (_req, res): Promise<void> => {
  try {
    const result = await createCheckInReminders();
    res.json({ message: `Created ${result.created} new check-in task(s).`, created: result.created });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
