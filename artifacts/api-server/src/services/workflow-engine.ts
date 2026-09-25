/**
 * Workflow Automation Engine
 *
 * fireWorkflow(triggerType, context) — called at trigger points to create
 * execution records for all matching active workflows.
 *
 * processWorkflowExecutions() — called every minute by the scheduler to
 * advance pending executions through their steps.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sendEmail, isEmailConfigured } from "./email.js";
import { assertIntegrationOutboundAllowed } from "../setup/outbound-gate.js";

// ── Merge-tag substitution ────────────────────────────────────────────────────
function applyMergeTags(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => ctx[key] ?? "");
}

function buildCtxMap(contextData: Record<string, any>): Record<string, string> {
  const m: Record<string, string> = {};
  for (const [k, v] of Object.entries(contextData)) {
    if (v != null) m[k] = String(v);
  }
  return m;
}

// ── Fire workflow ─────────────────────────────────────────────────────────────
/**
 * Creates workflow_execution records for every active workflow whose
 * trigger_type matches. Non-blocking — callers should not await this unless
 * they care about errors.
 */
export async function fireWorkflow(
  triggerType: string,
  context: {
    contact_email?: string | null;
    contact_name?: string | null;
    contact_phone?: string | null;
    [key: string]: any;
  }
): Promise<void> {
  try {
    const rows = await db.execute(sql`
      SELECT id FROM workflows
      WHERE trigger_type = ${triggerType}
        AND is_active = true
    `);
    if (rows.rows.length === 0) return;

    const now = new Date();
    let fired = 0;
    const errors: string[] = [];

    for (const row of rows.rows as any[]) {
      try {
        // Check whether the workflow has any steps before creating an execution
        const stepsCheck = await db.execute(sql`
          SELECT COUNT(*)::int AS cnt FROM workflow_steps WHERE workflow_id = ${row.id}
        `);
        const cnt = (stepsCheck.rows[0] as any)?.cnt ?? 0;
        if (cnt === 0) {
          console.warn(`[workflow-engine] Skipping workflow ${row.id} — no steps defined`);
          continue;
        }

        await db.execute(sql`
          INSERT INTO workflow_executions
            (workflow_id, contact_email, contact_name, contact_phone, context_data,
             current_step, status, next_run_at, started_at)
          VALUES
            (${row.id},
             ${context.contact_email ?? null},
             ${context.contact_name ?? null},
             ${context.contact_phone ?? null},
             ${JSON.stringify(context)}::jsonb,
             0, 'running', ${now.toISOString()}, ${now.toISOString()})
        `);
        fired++;
      } catch (rowErr: any) {
        const msg = `workflow ${row.id}: ${rowErr?.message ?? String(rowErr)}`;
        errors.push(msg);
        console.error(`[workflow-engine] fireWorkflow failed to create execution for ${msg}`);
      }
    }

    if (fired > 0) {
      console.log(`[workflow-engine] Fired ${fired} execution(s) for trigger "${triggerType}" (contact: ${context.contact_email ?? context.contact_name ?? "unknown"})`);
    }
    if (errors.length > 0) {
      console.error(`[workflow-engine] ${errors.length} trigger creation failure(s) for "${triggerType}":`, errors);
    }
  } catch (err: any) {
    console.error(`[workflow-engine] fireWorkflow("${triggerType}") top-level error — trigger may have fired but executions not created:`, err?.message ?? err);
  }
}

// ── Process pending executions ────────────────────────────────────────────────
export async function processWorkflowExecutions(): Promise<void> {
  try {
    const due = await db.execute(sql`
      SELECT we.id, we.workflow_id, we.current_step, we.context_data,
             we.contact_email, we.contact_name, we.contact_phone
      FROM workflow_executions we
      WHERE we.status = 'running'
        AND we.next_run_at IS NOT NULL
        AND we.next_run_at <= now()
      ORDER BY we.next_run_at
      LIMIT 50
    `);

    for (const exec of due.rows as any[]) {
      await processExecution(exec);
    }
  } catch (err) {
    console.error("[workflow-engine] processWorkflowExecutions error:", err);
  }
}

async function processExecution(exec: any): Promise<void> {
  // Atomically claim this execution tick to prevent double-firing in a
  // multi-instance setup: only proceed if we can set next_run_at = NULL.
  const claimed = await db.execute(sql`
    UPDATE workflow_executions
    SET next_run_at = NULL
    WHERE id = ${exec.id}
      AND status = 'running'
      AND next_run_at IS NOT NULL
    RETURNING id
  `);
  if (claimed.rows.length === 0) return; // Another process already claimed it

  try {
    // Fetch steps for this workflow, ordered by position
    const stepsResult = await db.execute(sql`
      SELECT id, position, step_type, config
      FROM workflow_steps
      WHERE workflow_id = ${exec.workflow_id}
      ORDER BY position ASC
    `);
    const steps = stepsResult.rows as any[];

    if (exec.current_step >= steps.length) {
      // No more steps — mark complete
      await db.execute(sql`
        UPDATE workflow_executions
        SET status = 'completed', completed_at = now(), next_run_at = NULL
        WHERE id = ${exec.id}
      `);
      return;
    }

    const step = steps[exec.current_step];
    const config = step.config ?? {};
    const contextData: Record<string, any> = exec.context_data ?? {};
    const ctx = buildCtxMap(contextData);

    const nextStep = exec.current_step + 1;
    const isLastStep = nextStep >= steps.length;
    const now = new Date();

    if (step.step_type === "wait") {
      const delayHours = Number(config.delay_hours ?? 1);
      const nextRunAt = new Date(now.getTime() + delayHours * 60 * 60 * 1000);
      await db.execute(sql`
        UPDATE workflow_executions
        SET current_step = ${nextStep},
            next_run_at = ${isLastStep ? null : nextRunAt.toISOString()},
            status = ${isLastStep ? 'completed' : 'running'},
            completed_at = ${isLastStep ? now.toISOString() : null}
        WHERE id = ${exec.id}
      `);
      return;
    }

    if (step.step_type === "send_email") {
      const toEmail = ctx.contact_email ?? null;
      if (toEmail && isEmailConfigured) {
        const subject = applyMergeTags(config.subject ?? "(No subject)", ctx);
        const bodyHtml = applyMergeTags(config.body ?? "", ctx);
        const bodyText = bodyHtml.replace(/<[^>]+>/g, "");
        try {
          await assertIntegrationOutboundAllowed("smtp");
          await sendEmail({ to: toEmail, subject, html: bodyHtml, text: bodyText });
          console.log(`[workflow-engine] Sent email to ${toEmail} (execution ${exec.id}, step ${exec.current_step})`);
        } catch (emailErr) {
          console.error(`[workflow-engine] Email send failed (execution ${exec.id}):`, emailErr);
          // Still advance the step — don't retry indefinitely on email failure
        }
      } else if (!toEmail) {
        console.warn(`[workflow-engine] Skipping send_email — no contact_email in context (execution ${exec.id})`);
      } else {
        console.warn(`[workflow-engine] Skipping send_email — email not configured (execution ${exec.id})`);
      }
    }

    if (step.step_type === "condition") {
      // Evaluate condition against context; if false, skip steps or stop
      const field   = config.field   ?? "";
      const op      = config.operator ?? "is_not_empty";
      const value   = config.value   ?? "";
      const rawVal  = ctx[field] ?? "";

      let condResult = false;
      switch (op) {
        case "equals":       condResult = rawVal.toLowerCase() === value.toLowerCase(); break;
        case "not_equals":   condResult = rawVal.toLowerCase() !== value.toLowerCase(); break;
        case "contains":     condResult = rawVal.toLowerCase().includes(value.toLowerCase()); break;
        case "not_contains": condResult = !rawVal.toLowerCase().includes(value.toLowerCase()); break;
        case "is_empty":     condResult = rawVal.trim() === ""; break;
        case "is_not_empty": condResult = rawVal.trim() !== ""; break;
        default:             condResult = true;
      }

      if (condResult) {
        // TRUE — fall through to the normal "advance to next step" below
      } else {
        // FALSE — either stop or skip N steps
        const onFalse = config.on_false ?? "stop";
        if (onFalse === "stop") {
          await db.execute(sql`
            UPDATE workflow_executions
            SET status = 'completed', completed_at = now(), next_run_at = NULL
            WHERE id = ${exec.id}
          `);
          return;
        }
        const skipCount = parseInt(String(onFalse), 10);
        const jumpTo = isNaN(skipCount) ? nextStep : nextStep + skipCount;
        const afterJump = jumpTo >= steps.length;
        await db.execute(sql`
          UPDATE workflow_executions
          SET current_step = ${jumpTo},
              next_run_at = ${afterJump ? null : now.toISOString()},
              status = ${afterJump ? 'completed' : 'running'},
              completed_at = ${afterJump ? now.toISOString() : null}
          WHERE id = ${exec.id}
        `);
        return;
      }
    }

    if (step.step_type === "send_whatsapp") {
      // Determine webhook URL: step config overrides the global GHL setting
      let webhookUrl: string | null = config.webhook_url || null;
      if (!webhookUrl) {
        const settingRow = await db.execute(sql`
          SELECT value FROM settings WHERE key = 'local_delivery_ghl_webhook_url' LIMIT 1
        `);
        webhookUrl = (settingRow.rows[0] as any)?.value ?? null;
      }

      if (webhookUrl) {
        await assertIntegrationOutboundAllowed("webhook");
        const message = applyMergeTags(config.message ?? "", ctx);
        const contactId = ctx.high_level_contact_id ?? ctx.contact_id ?? null;
        const payload: Record<string, any> = {
          eventType: "workflow_automation",
          workflowExecutionId: exec.id,
          contactEmail: exec.contact_email,
          contactName: exec.contact_name,
          message,
        };
        if (contactId) payload.contactId = contactId;

        fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).catch((e: any) => {
          console.error(`[workflow-engine] WhatsApp webhook failed (execution ${exec.id}):`, e?.message);
        });
        console.log(`[workflow-engine] Fired WhatsApp webhook (execution ${exec.id}, step ${exec.current_step})`);
      } else {
        console.warn(`[workflow-engine] Skipping send_whatsapp — no webhook URL configured (execution ${exec.id})`);
      }
    }

    if (step.step_type === "stop") {
      await db.execute(sql`
        UPDATE workflow_executions
        SET status = 'completed', completed_at = now(), next_run_at = NULL
        WHERE id = ${exec.id}
      `);
      return;
    }

    // Advance to next step
    await db.execute(sql`
      UPDATE workflow_executions
      SET current_step = ${nextStep},
          next_run_at = ${isLastStep ? null : now.toISOString()},
          status = ${isLastStep ? 'completed' : 'running'},
          completed_at = ${isLastStep ? now.toISOString() : null}
      WHERE id = ${exec.id}
    `);
  } catch (err: any) {
    console.error(`[workflow-engine] Execution ${exec.id} failed:`, err?.message ?? err);
    await db.execute(sql`
      UPDATE workflow_executions
      SET status = 'failed', error = ${err?.message ?? String(err)},
          next_run_at = NULL, completed_at = now()
      WHERE id = ${exec.id}
    `).catch(() => {});
  }
}
