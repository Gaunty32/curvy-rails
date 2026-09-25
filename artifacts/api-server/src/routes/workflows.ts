/**
 * Workflow Automation — CRUD routes
 *
 * GET    /workflows                — list all workflows
 * POST   /workflows                — create a workflow
 * GET    /workflows/:id            — get workflow + steps
 * PATCH  /workflows/:id            — update workflow name/trigger/is_active
 * DELETE /workflows/:id            — delete workflow + steps + executions
 * GET    /workflows/:id/steps      — list steps
 * POST   /workflows/:id/steps      — add a step
 * PATCH  /workflows/:id/steps/:sid — update a step
 * DELETE /workflows/:id/steps/:sid — delete a step
 * POST   /workflows/:id/steps/reorder — set positions
 * GET    /workflows/:id/executions — list recent executions
 * DELETE /workflows/executions/:eid — delete one execution record
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import jwt from "jsonwebtoken";

const router: IRouter = Router();

const JWT_SECRET = process.env.PORTAL_JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("PORTAL_JWT_SECRET must be configured with at least 32 characters.");
}

/** Require a valid staff JWT on all workflow routes */
function requireStaffAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as Record<string, unknown>;
    if (payload.role !== "staff") {
      res.status(403).json({ error: "Staff access required" });
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

router.use("/workflows", requireStaffAuth);

// ── List workflows ─────────────────────────────────────────────────────────────
router.get("/workflows", async (_req, res): Promise<void> => {
  const rows = await db.execute(sql`
    SELECT w.id, w.name, w.trigger_type, w.is_active, w.created_at, w.updated_at,
           COUNT(ws.id)::int AS step_count
    FROM workflows w
    LEFT JOIN workflow_steps ws ON ws.workflow_id = w.id
    GROUP BY w.id
    ORDER BY w.created_at DESC
  `);
  res.json(rows.rows);
});

// ── Create workflow ────────────────────────────────────────────────────────────
const CreateWorkflowBody = z.object({
  name: z.string().min(1).max(200),
  trigger_type: z.enum([
    "order_dispatched",
    "order_created",
    "portal_order_submitted",
    "enquiry_received",
  ]),
  is_active: z.boolean().default(false),
});

router.post("/workflows", async (req, res): Promise<void> => {
  const parsed = CreateWorkflowBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { name, trigger_type, is_active } = parsed.data;
  const rows = await db.execute(sql`
    INSERT INTO workflows (name, trigger_type, is_active, created_at, updated_at)
    VALUES (${name}, ${trigger_type}, ${is_active}, now(), now())
    RETURNING *
  `);
  res.status(201).json(rows.rows[0]);
});

// ── Get single workflow with steps ─────────────────────────────────────────────
router.get("/workflows/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const [wfRows, stepRows] = await Promise.all([
    db.execute(sql`SELECT * FROM workflows WHERE id = ${id}`),
    db.execute(sql`
      SELECT * FROM workflow_steps WHERE workflow_id = ${id} ORDER BY position ASC
    `),
  ]);

  const wf = wfRows.rows[0];
  if (!wf) { res.status(404).json({ error: "Workflow not found" }); return; }
  res.json({ ...wf, steps: stepRows.rows });
});

// ── Update workflow ────────────────────────────────────────────────────────────
const UpdateWorkflowBody = z.object({
  name: z.string().min(1).max(200).optional(),
  trigger_type: z.enum([
    "order_dispatched",
    "order_created",
    "portal_order_submitted",
    "enquiry_received",
  ]).optional(),
  is_active: z.boolean().optional(),
});

router.patch("/workflows/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateWorkflowBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;

  const rows = await db.execute(sql`
    UPDATE workflows SET
      name         = COALESCE(${d.name ?? null}, name),
      trigger_type = COALESCE(${d.trigger_type ?? null}, trigger_type),
      is_active    = COALESCE(${d.is_active ?? null}, is_active),
      updated_at   = now()
    WHERE id = ${id}
    RETURNING *
  `);
  if (rows.rows.length === 0) { res.status(404).json({ error: "Workflow not found" }); return; }
  res.json(rows.rows[0]);
});

// ── Delete workflow ────────────────────────────────────────────────────────────
router.delete("/workflows/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.execute(sql`DELETE FROM workflow_executions WHERE workflow_id = ${id}`);
  await db.execute(sql`DELETE FROM workflow_steps WHERE workflow_id = ${id}`);
  await db.execute(sql`DELETE FROM workflows WHERE id = ${id}`);
  res.json({ ok: true });
});

// ── Steps ──────────────────────────────────────────────────────────────────────
const StepBody = z.object({
  step_type: z.enum(["wait", "send_email", "send_whatsapp"]),
  config: z.record(z.any()).default({}),
  position: z.number().int().optional(),
});

router.post("/workflows/:id/steps", async (req, res): Promise<void> => {
  const workflowId = Number(req.params.id);
  if (!workflowId) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = StepBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { step_type, config } = parsed.data;

  // Auto-assign position = max + 1
  const posRow = await db.execute(sql`
    SELECT COALESCE(MAX(position), -1)::int AS maxpos
    FROM workflow_steps WHERE workflow_id = ${workflowId}
  `);
  const position = ((posRow.rows[0] as any)?.maxpos ?? -1) + 1;

  const rows = await db.execute(sql`
    INSERT INTO workflow_steps (workflow_id, position, step_type, config)
    VALUES (${workflowId}, ${position}, ${step_type}, ${JSON.stringify(config)}::jsonb)
    RETURNING *
  `);
  res.status(201).json(rows.rows[0]);
});

router.patch("/workflows/:id/steps/:sid", async (req, res): Promise<void> => {
  const workflowId = Number(req.params.id);
  const stepId = Number(req.params.sid);
  if (!workflowId || !stepId) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = StepBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;

  const configJson = d.config != null ? JSON.stringify(d.config) : null;
  const rows = await db.execute(sql`
    UPDATE workflow_steps SET
      step_type = COALESCE(${d.step_type ?? null}, step_type),
      config    = CASE WHEN ${configJson}::text IS NOT NULL
                       THEN ${configJson}::jsonb
                       ELSE config END,
      position  = COALESCE(${d.position ?? null}, position)
    WHERE id = ${stepId} AND workflow_id = ${workflowId}
    RETURNING *
  `);
  if (rows.rows.length === 0) { res.status(404).json({ error: "Step not found" }); return; }
  res.json(rows.rows[0]);
});

router.delete("/workflows/:id/steps/:sid", async (req, res): Promise<void> => {
  const workflowId = Number(req.params.id);
  const stepId = Number(req.params.sid);
  if (!workflowId || !stepId) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.execute(sql`DELETE FROM workflow_steps WHERE id = ${stepId} AND workflow_id = ${workflowId}`);
  res.json({ ok: true });
});

// Reorder — body: [{ id, position }]
router.post("/workflows/:id/steps/reorder", async (req, res): Promise<void> => {
  const workflowId = Number(req.params.id);
  if (!workflowId) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = z.array(z.object({ id: z.number(), position: z.number() })).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  for (const item of parsed.data) {
    await db.execute(sql`
      UPDATE workflow_steps SET position = ${item.position}
      WHERE id = ${item.id} AND workflow_id = ${workflowId}
    `);
  }
  res.json({ ok: true });
});

// ── Executions ─────────────────────────────────────────────────────────────────
router.get("/workflows/:id/executions", async (req, res): Promise<void> => {
  const workflowId = Number(req.params.id);
  if (!workflowId) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.execute(sql`
    SELECT id, contact_email, contact_name, current_step, status,
           next_run_at, started_at, completed_at, error
    FROM workflow_executions
    WHERE workflow_id = ${workflowId}
    ORDER BY started_at DESC
    LIMIT 100
  `);
  res.json(rows.rows);
});

router.delete("/workflows/executions/:eid", async (req, res): Promise<void> => {
  const eid = Number(req.params.eid);
  if (!eid) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.execute(sql`DELETE FROM workflow_executions WHERE id = ${eid}`);
  res.json({ ok: true });
});

export default router;
