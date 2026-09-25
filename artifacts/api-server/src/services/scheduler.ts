import { schedule, type ScheduledTask } from "node-cron";
import { db, settingsTable, customersTable, ordersTable, tasksTable } from "@workspace/db";
import { processWorkflowExecutions } from "./workflow-engine.js";
import { eq, sql, and, or, isNull, lt, lte, isNotNull } from "drizzle-orm";
import { runWooSync } from "./woo-sync";
import { runSeoHealthCheck } from "./seo-check.js";
import { sendInvoiceEmail, buildCheckInEmail, sendEmail, isEmailConfigured, fetchLogoDataUrl, buildDeliveryFollowupEmail, buildSupplierChaseEmail } from "./email.js";
import { getTemplate, applyVars } from "./template-engine.js";
import { postInvoiceToXero } from "./xero.js";
import { getWooSettings } from "../routes/woo.js";
import { reconcileKnowledgeEmailCampaigns } from "./highlevel-campaigns.js";
import { fetchKnowledgeBaseRss } from "./rss-feed.js";
import { getBusinessConfig } from "../lib/business-config.js";
import { assertIntegrationOutboundAllowed } from "../setup/outbound-gate.js";

type CronCallback = Exclude<Parameters<typeof schedule>[1], string>;

let currentTask: ScheduledTask | null = null;
let schedulerRegistrationAllowed = false;
const registeredTasks: ScheduledTask[] = [];
const startupTimers: Array<ReturnType<typeof setTimeout>> = [];
let registrationSignature: string | null = null;
const SCHEDULER_AUTOMATIONS = [
  "campaign-reconciliation",
  "guidance-sync",
  "customer-normalisation",
  "check-in-reminders",
  "weekly-campaign-prompt",
  "check-in-emails",
  "scheduled-invoices",
  "local-delivery-followup",
  "invoice-followup",
  "workflow-execution",
  "weekly-seo-check",
  "supplier-chase",
  "woocommerce-sync",
] as const;

export type SchedulerRegistrationOptions = {
  /** Must be explicitly true; scheduler activation is never the default. */
  enabled: boolean;
  /** True while the installation is in setup mode. */
  setupMode: boolean;
  /** Must be true only after the installation is activated. */
  activated: boolean;
};

type OverdueSupplierLine = {
  poId: number;
  poNumber: string;
  supplierName: string;
  supplierEmail: string;
  supplierContactName: string | null;
  poItemId: number;
  orderId: number;
  orderNumber: string;
  productName: string;
  supplierCode: string | null;
  colour: string | null;
  size: string | null;
  remaining: number;
  effectiveDueDate: string;
};

export async function chaseOverdueSupplierItems(): Promise<{ emailsSent: number; linesChased: number; failures: number }> {
  if (!isEmailConfigured) {
    console.warn("[supplier-chase] Email is not configured; skipping overdue supplier chases");
    return { emailsSent: 0, linesChased: 0, failures: 0 };
  }

  const result = await db.execute(sql`
    SELECT
      po.id AS "poId",
      po.po_number AS "poNumber",
      po.supplier_name AS "supplierName",
      COALESCE(NULLIF(BTRIM(po.supplier_email), ''), NULLIF(BTRIM(s.email), '')) AS "supplierEmail",
      s.contact_name AS "supplierContactName",
      poi.id AS "poItemId",
      o.id AS "orderId",
      o.order_number AS "orderNumber",
      poi.product_name AS "productName",
      poi.supplier_code AS "supplierCode",
      poi.colour,
      poi.size,
      (poi.quantity_ordered - poi.quantity_delivered)::integer AS remaining,
      COALESCE(
        (poi.estimated_due_date AT TIME ZONE 'Europe/London')::date,
        (o.required_date AT TIME ZONE 'Europe/London')::date
      )::text AS "effectiveDueDate"
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.po_id
    LEFT JOIN suppliers s ON s.id = po.supplier_id
    LEFT JOIN order_items oi ON oi.id = poi.order_item_id
    JOIN orders o ON o.id = COALESCE(poi.order_id, oi.order_id)
    WHERE po.status NOT IN ('draft', 'delivered', 'cancelled')
      AND o.status IN ('confirmed', 'part_shipped')
      AND poi.quantity_delivered < poi.quantity_ordered
      AND COALESCE(
        (poi.estimated_due_date AT TIME ZONE 'Europe/London')::date,
        (o.required_date AT TIME ZONE 'Europe/London')::date
      ) < (NOW() AT TIME ZONE 'Europe/London')::date
      AND COALESCE(NULLIF(BTRIM(po.supplier_email), ''), NULLIF(BTRIM(s.email), '')) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM supplier_chase_logs scl
        WHERE scl.purchase_order_item_id = poi.id
          AND scl.effective_due_date = COALESCE(
            (poi.estimated_due_date AT TIME ZONE 'Europe/London')::date,
            (o.required_date AT TIME ZONE 'Europe/London')::date
          )
      )
    ORDER BY po.id, o.order_number, poi.id
  `);

  const groups = new Map<string, OverdueSupplierLine[]>();
  for (const row of result.rows as OverdueSupplierLine[]) {
    const key = `${row.poId}:${row.supplierEmail.toLowerCase()}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  let emailsSent = 0;
  let linesChased = 0;
  let failures = 0;

  for (const candidates of groups.values()) {
    const claimed: Array<OverdueSupplierLine & { chaseLogId: number }> = [];
    for (const line of candidates) {
      const claim = await db.execute(sql`
        INSERT INTO supplier_chase_logs (
          purchase_order_id, purchase_order_item_id, order_id,
          effective_due_date, supplier_email
        )
        VALUES (
          ${line.poId}, ${line.poItemId}, ${line.orderId},
          ${line.effectiveDueDate}::date, ${line.supplierEmail}
        )
        ON CONFLICT (purchase_order_item_id, effective_due_date) DO NOTHING
        RETURNING id
      `);
      const chaseLogId = Number((claim.rows[0] as any)?.id);
      if (chaseLogId) claimed.push({ ...line, chaseLogId });
    }
    if (claimed.length === 0) continue;

    const first = claimed[0];
    const email = buildSupplierChaseEmail({
      poNumber: first.poNumber,
      supplierName: first.supplierName,
      supplierContactName: first.supplierContactName,
      items: claimed.map((line) => ({
        orderNumber: line.orderNumber,
        productName: line.productName,
        supplierCode: line.supplierCode,
        colour: line.colour,
        size: line.size,
        remaining: line.remaining,
        dueDate: line.effectiveDueDate,
      })),
    });
    const businessConfig = await getBusinessConfig();
    const notificationRecipients = Array.isArray(businessConfig?.notificationRecipients)
      ? businessConfig.notificationRecipients.filter((value): value is string => typeof value === "string")
      : [];
    const sendResult = await sendEmail({
      to: first.supplierEmail,
      ...(notificationRecipients.length ? { cc: notificationRecipients } : {}),
      ...email,
    });

    const claimIds = claimed.map((line) => line.chaseLogId);
    if (!sendResult.sent) {
      await db.execute(sql`DELETE FROM supplier_chase_logs WHERE id = ANY(${claimIds}::integer[])`);
      failures += 1;
      console.error(`[supplier-chase] Failed to chase ${first.poNumber} at ${first.supplierEmail}: ${sendResult.error ?? "Unknown email error"}`);
      continue;
    }

    await db.execute(sql`
      UPDATE supplier_chase_logs
      SET message_id = ${sendResult.messageId ?? null},
          provider = ${sendResult.provider ?? null},
          sent_at = NOW()
      WHERE id = ANY(${claimIds}::integer[])
    `);

    const orderGroups = new Map<number, OverdueSupplierLine[]>();
    for (const line of claimed) {
      const orderLines = orderGroups.get(line.orderId) ?? [];
      orderLines.push(line);
      orderGroups.set(line.orderId, orderLines);
    }
    for (const [orderId, orderLines] of orderGroups) {
      await db.execute(sql`
        INSERT INTO order_logs (order_id, action, actor, details)
        VALUES (
          ${orderId},
          'Supplier chased',
          'System',
          ${`Emailed ${first.supplierName} (${first.supplierEmail}) about ${orderLines.length} overdue item${orderLines.length === 1 ? "" : "s"} on ${first.poNumber}.`}
        )
      `);
    }

    emailsSent += 1;
    linesChased += claimed.length;
    console.log(`[supplier-chase] Chased ${claimed.length} overdue line(s) on ${first.poNumber} with ${first.supplierName}`);
  }

  return { emailsSent, linesChased, failures };
}

function escapeEmailHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[character] ?? character));
}

const SCHEDULES: Record<string, string> = {
  hourly: "0 * * * *",
  every6hours: "0 */6 * * *",
  daily: "0 2 * * *",
};

function registerCron(expression: string, callback: CronCallback, options?: Parameters<typeof schedule>[2]): ScheduledTask {
  const task = schedule(expression, callback, options);
  registeredTasks.push(task);
  return task;
}

async function isAutomationEnabled(id: string): Promise<boolean> {
  try {
    const [activation, automationSetting] = await Promise.all([
      db.select({ value: settingsTable.value }).from(settingsTable)
        .where(eq(settingsTable.key, "installation_activated")),
      db.select({ value: settingsTable.value }).from(settingsTable)
        .where(eq(settingsTable.key, "automation_enabled")),
    ]);
    if (activation[0]?.value !== "true") return false;
    const enabled: unknown = JSON.parse(automationSetting[0]?.value ?? "null");
    return !!enabled && typeof enabled === "object" && !Array.isArray(enabled)
      && (enabled as Record<string, unknown>)[id] === true;
  } catch {
    return false;
  }
}

function registerAutomationCron(
  automationId: string,
  expression: string,
  callback: CronCallback,
  options?: Parameters<typeof schedule>[2],
): ScheduledTask {
  return registerCron(expression, async (...args) => {
    if (!schedulerRegistrationAllowed || !(await isAutomationEnabled(automationId))) {
      console.info(`[scheduler] Skipping ${automationId}: installation is not activated or automation is not enabled`);
      return;
    }
    await callback(...args);
  }, options);
}

export function stopScheduler(): void {
  schedulerRegistrationAllowed = false;
  for (const task of registeredTasks.splice(0)) task.stop();
  for (const timer of startupTimers.splice(0)) clearTimeout(timer);
  currentTask = null;
  registrationSignature = null;
}

export async function registerScheduler(options: SchedulerRegistrationOptions): Promise<boolean> {
  if (options?.enabled !== true || options.setupMode !== false || options.activated !== true) {
    stopScheduler();
    return false;
  }
  const [activation, automationSetting] = await Promise.all([
    db.select({ value: settingsTable.value }).from(settingsTable)
      .where(eq(settingsTable.key, "installation_activated")),
    db.select({ value: settingsTable.value }).from(settingsTable)
      .where(eq(settingsTable.key, "automation_enabled")),
  ]);
  if (activation[0]?.value !== "true") {
    console.info("[scheduler] Skipping scheduler start: durable installation activation is not enabled");
    stopScheduler();
    return false;
  }
  let enabled: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(automationSetting[0]?.value ?? "null");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      enabled = parsed as Record<string, unknown>;
    }
  } catch {
    console.warn("[scheduler] Automation settings are invalid; all scheduled jobs are skipped");
  }

  const enabledAutomations = SCHEDULER_AUTOMATIONS.filter((id) => enabled[id] === true);
  const syncSchedule = enabled["woocommerce-sync"] === true ? await getSyncSchedule() : null;
  const signature = JSON.stringify([enabledAutomations, syncSchedule]);
  if (signature === registrationSignature) return true;

  stopScheduler();
  schedulerRegistrationAllowed = true;
  registrationSignature = signature;
  try {
    const jobs: Array<[typeof SCHEDULER_AUTOMATIONS[number], () => void]> = [
      ["campaign-reconciliation", registerCampaignReconciliationJob],
      ["guidance-sync", registerGuidanceSyncJob],
      ["customer-normalisation", registerCustomerNormalisationJob],
      ["check-in-reminders", registerCheckInRemindersJob],
      ["weekly-campaign-prompt", registerWeeklyCampaignPromptJob],
      ["check-in-emails", registerCheckInEmailsJob],
      ["scheduled-invoices", registerScheduledInvoiceJob],
      ["local-delivery-followup", registerLocalDeliveryFollowupJob],
      ["invoice-followup", registerInvoiceFollowupJob],
      ["workflow-execution", registerWorkflowExecutionJob],
      ["weekly-seo-check", registerWeeklySeoCheckJob],
      ["supplier-chase", registerSupplierChaseJob],
    ];
    for (const [automationId, register] of jobs) {
      if (enabled[automationId] === true) register();
      else console.info(`[scheduler] Skipping ${automationId}: automation is not explicitly enabled`);
    }
    if (enabled["campaign-reconciliation"] === true) registerCampaignStartupReconciliation();
    if (enabled["woocommerce-sync"] === true) await initScheduler();
    else console.info("[scheduler] Skipping woocommerce-sync: automation is not explicitly enabled");
    return true;
  } catch (error) {
    stopScheduler();
    throw error;
  }
}

function registerCampaignReconciliationJob(): void {
registerAutomationCron("campaign-reconciliation", "*/15 * * * *", async () => {
  try {
    await assertIntegrationOutboundAllowed("highlevel");
    const result = await reconcileKnowledgeEmailCampaigns();
    if (result.checked > 0) {
      console.log(`[campaigns] Reconciled ${result.checked} campaign(s); ${result.updated} status update(s)`);
    }
  } catch (error) {
    console.error("[campaigns] Scheduled reconciliation failed:", error);
  }
});
}

function registerCampaignStartupReconciliation(): void {
startupTimers.push(setTimeout(() => {
  if (!schedulerRegistrationAllowed) return;
  isAutomationEnabled("campaign-reconciliation").then((enabled) => {
    if (!enabled) {
      console.info("[scheduler] Skipping campaign-reconciliation startup run: automation is not enabled");
      return;
    }
    return assertIntegrationOutboundAllowed("highlevel").then(() => {
      return reconcileKnowledgeEmailCampaigns();
    });
  }).catch((error) => {
    console.error("[campaigns] Startup reconciliation failed:", error);
  });
}, 15_000));
startupTimers[startupTimers.length - 1].unref();
}

async function getSyncSchedule(): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, "woo_sync_schedule"));
  return row?.value ?? null;
}

async function hasCredentials(): Promise<boolean> {
  const [urlRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, "woo_url"));
  const [ckRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, "woo_consumer_key"));
  const [csRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, "woo_consumer_secret"));
  return !!(urlRow?.value && ckRow?.value && csRow?.value);
}

export async function initScheduler(): Promise<void> {
  if (!schedulerRegistrationAllowed) return;
  if (currentTask) { currentTask.stop(); currentTask = null; }
  if (!(await isAutomationEnabled("woocommerce-sync"))) {
    console.info("[scheduler] Skipping woocommerce-sync: installation is not activated or automation is not enabled");
    return;
  }

  const scheduleKey = await getSyncSchedule();
  if (!scheduleKey || !SCHEDULES[scheduleKey]) return;

  const credentialsOk = await hasCredentials();
  if (!credentialsOk) return;

  const cronExpr = SCHEDULES[scheduleKey];
  currentTask = registerAutomationCron("woocommerce-sync", cronExpr, async () => {
    console.log(`[scheduler] Running WooCommerce sync (${scheduleKey})`);
    try {
      await assertIntegrationOutboundAllowed("woocommerce");
      const result = await runWooSync();
      console.log(`[scheduler] Sync complete: +${result.created} created, ~${result.updated} updated, ${result.errors.length} errors`);
    } catch (err) {
      console.error("[scheduler] Sync failed:", err);
    }
  });

  console.log(`[scheduler] WooCommerce sync scheduled: ${scheduleKey} (${cronExpr})`);
}

export async function reschedule(): Promise<void> {
  await initScheduler();
}

// ─── Product guidance sync ─────────────────────────────────────────────────────

/**
 * Fetches _sbs_* meta fields and gallery images from WooCommerce for every
 * product that has a woo_commerce_id, then updates the local DB.
 * Called both by the daily cron and (via HTTP endpoint) from the Settings UI.
 */
export async function runGuidanceSyncJob(): Promise<{ synced: number; errors: string[] }> {
  const settings = await getWooSettings();
  if (!settings) {
    console.log("[guidance-sync] WooCommerce not configured — skipping");
    return { synced: 0, errors: [] };
  }

  const totalRows = await db.execute(sql`
    SELECT COUNT(*) as n FROM products WHERE woo_commerce_id IS NOT NULL AND is_archived = false
  `);
  const total = Number((totalRows.rows[0] as any)?.n ?? 0);
  if (total === 0) {
    console.log("[guidance-sync] No linked products found — skipping");
    return { synced: 0, errors: [] };
  }

  const parseMeta = (metaData: any[], key: string): string =>
    (metaData ?? []).find((m: any) => m.key === key)?.value ?? "";

  const limit = 50;
  let offset = 0;
  let synced = 0;
  const errors: string[] = [];

  while (offset < total) {
    const productRows = await db.execute(sql`
      SELECT id, woo_commerce_id FROM products
      WHERE woo_commerce_id IS NOT NULL AND is_archived = false
      ORDER BY id
      LIMIT ${limit} OFFSET ${offset}
    `);
    const products = productRows.rows as any[];
    if (!products.length) break;

    for (const p of products) {
      try {
        const wcUrl = `${settings.baseUrl.replace(/\/$/, "")}/wp-json/wc/v3/products/${p.woo_commerce_id}?_fields=id,images,meta_data`;
        const wcFullUrl = new URL(wcUrl);
        wcFullUrl.searchParams.set("consumer_key", settings.ck);
        wcFullUrl.searchParams.set("consumer_secret", settings.cs);
        await assertIntegrationOutboundAllowed("woocommerce");
        const res = await fetch(wcFullUrl.toString(), {
          headers: { "Accept": "application/json" },
          signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) throw new Error(`WooCommerce API error ${res.status}`);
        const woo = await res.json() as any;
        const meta: any[] = woo.meta_data ?? [];

        const valueRating      = parseInt(parseMeta(meta, "_sbs_value_rating"))      || 0;
        const durabilityRating = parseInt(parseMeta(meta, "_sbs_durability_rating")) || 0;
        const technicalRating  = parseInt(parseMeta(meta, "_sbs_technical_rating"))  || 0;
        const bestFor          = parseMeta(meta, "_sbs_best_for");
        const notIdealFor      = parseMeta(meta, "_sbs_not_ideal_for");

        let badges: string[] = [];
        try { badges = JSON.parse(parseMeta(meta, "_sbs_badges_json") || "[]"); } catch {}
        let tags: string[] = [];
        try { tags = JSON.parse(parseMeta(meta, "_sbs_tags_json") || "[]"); } catch {}

        const galleryImages = (woo.images ?? []).map((img: any) => img.src).filter(Boolean);

        await db.execute(sql`
          UPDATE products SET
            guidance_value_rating      = ${valueRating || null},
            guidance_durability_rating = ${durabilityRating || null},
            guidance_smart_rating      = ${technicalRating || null},
            guidance_best_for          = ${bestFor || null},
            guidance_not_ideal_for     = ${notIdealFor || null},
            guidance_badges            = ${badges.length ? JSON.stringify(badges) : null}::jsonb,
            guidance_tags              = ${tags.length ? JSON.stringify(tags) : null}::jsonb,
            gallery_images             = ${galleryImages.length ? JSON.stringify(galleryImages) : null}::jsonb,
            updated_at                 = now()
          WHERE id = ${p.id}
        `);
        synced++;
      } catch (err: any) {
        errors.push(`Product ${p.id} (WC ${p.woo_commerce_id}): ${err.message}`);
      }
    }

    offset += limit;
  }

  return { synced, errors };
}

// Run guidance sync every day at 3am (one hour after the product sync at 2am)
function registerGuidanceSyncJob(): void {
registerAutomationCron("guidance-sync", "0 3 * * *", async () => {
  console.log("[guidance-sync] Running daily product guidance sync");
  try {
    const result = await runGuidanceSyncJob();
    console.log(`[guidance-sync] Done — synced: ${result.synced}, errors: ${result.errors.length}`);
    if (result.errors.length > 0) {
      console.warn("[guidance-sync] First error:", result.errors[0]);
    }
  } catch (err) {
    console.error("[guidance-sync] Daily sync failed:", err);
  }
});
}

// ─── Customer check-in reminders ──────────────────────────────────────────────

/**
 * For every customer whose most recent order is older than 90 days (or who has
 * never placed an order), create a high-priority task — unless an open or
 * in-progress check-in task already exists for them.
 */
export async function createCheckInReminders(): Promise<{ created: number }> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  // Find customers with no recent orders using raw SQL for the aggregation
  const staleCustomers = await db.execute<{ id: number; name: string; last_order: Date | null }>(sql`
    SELECT c.id, c.name, MAX(o.order_date) AS last_order
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id
    GROUP BY c.id, c.name
    HAVING MAX(o.order_date) < ${cutoff} OR MAX(o.order_date) IS NULL
  `);

  let created = 0;
  for (const customer of staleCustomers.rows) {
    // Skip if there's already an open/in_progress check-in task for this customer
    const existing = await db.select({ id: tasksTable.id }).from(tasksTable).where(
      and(
        eq(tasksTable.customerId, customer.id),
        or(eq(tasksTable.status, "open"), eq(tasksTable.status, "in_progress")),
        sql`${tasksTable.title} LIKE ${"Check in with%"}`
      )
    );

    if (existing.length > 0) continue;

    const daysSince = customer.last_order
      ? Math.floor((Date.now() - new Date(customer.last_order).getTime()) / 86_400_000)
      : null;

    const description = daysSince != null
      ? `No order placed in the last ${daysSince} days. Consider reaching out to maintain the relationship.`
      : "This customer has never placed an order. Consider making initial contact.";

    await db.insert(tasksTable).values({
      title: `Check in with ${customer.name}`,
      description,
      priority: "high",
      status: "open",
      customerId: customer.id,
      customerName: customer.name,
    });
    created++;
  }

  console.log(`[reminders] Created ${created} customer check-in task(s)`);
  return { created };
}

// ─── Customer data normalisation ──────────────────────────────────────────────

/**
 * Converts all-caps customer text fields to proper title case / lowercase
 * using PostgreSQL's built-in initcap() and lower() functions.
 * Only touches fields that are detectably all-uppercase (have letters and
 * equal their own upper() value).
 */
export async function normalizeCustomerCasing(): Promise<{ updated: number }> {
  const result = await db.execute<{ count: string }>(sql`
    WITH updated AS (
      UPDATE customers SET
        name             = CASE WHEN name ~ '[A-Za-z]' AND name = upper(name)
                                THEN initcap(name) ELSE name END,
        contact_first_name = CASE WHEN contact_first_name IS NOT NULL
                                       AND contact_first_name ~ '[A-Za-z]'
                                       AND contact_first_name = upper(contact_first_name)
                                  THEN initcap(contact_first_name) ELSE contact_first_name END,
        contact_last_name  = CASE WHEN contact_last_name IS NOT NULL
                                       AND contact_last_name ~ '[A-Za-z]'
                                       AND contact_last_name = upper(contact_last_name)
                                  THEN initcap(contact_last_name) ELSE contact_last_name END,
        email            = CASE WHEN email IS NOT NULL THEN lower(email) ELSE email END,
        address          = CASE WHEN address IS NOT NULL
                                     AND address ~ '[A-Za-z]'
                                     AND address = upper(address)
                                THEN initcap(address) ELSE address END,
        city             = CASE WHEN city IS NOT NULL
                                     AND city ~ '[A-Za-z]'
                                     AND city = upper(city)
                                THEN initcap(city) ELSE city END,
        state            = CASE WHEN state IS NOT NULL
                                     AND state ~ '[A-Za-z]'
                                     AND state = upper(state)
                                THEN initcap(state) ELSE state END
      RETURNING 1
    )
    SELECT count(*)::text AS count FROM updated
  `);
  const updated = parseInt(result.rows[0]?.count ?? "0", 10);
  console.log(`[normalise] Updated ${updated} customer record(s)`);
  return { updated };
}

// Run customer casing normalisation every Sunday at 3am
function registerCustomerNormalisationJob(): void {
registerAutomationCron("customer-normalisation", "0 3 * * 0", async () => {
  console.log("[normalise] Running weekly customer casing normalisation");
  try {
    await normalizeCustomerCasing();
  } catch (err) {
    console.error("[normalise] Normalisation job failed:", err);
  }
});
}

// Run check-in reminders every day at 9am
function registerCheckInRemindersJob(): void {
registerAutomationCron("check-in-reminders", "0 9 * * *", async () => {
  console.log("[reminders] Running daily customer check-in check");
  try {
    await createCheckInReminders();
  } catch (err) {
    console.error("[reminders] Check-in reminder job failed:", err);
  }
});
}

// Every Friday morning, prompt the configured editor to choose the week's
// Knowledge Centre article. The prompt never schedules or sends a campaign.
export async function sendWeeklyCampaignPrompt(): Promise<{ sent: boolean; reason?: string }> {
  if (!isEmailConfigured) return { sent: false, reason: "email_not_configured" };

  const settings = await db.select().from(settingsTable).where(
    or(
      eq(settingsTable.key, "weekly_campaign_prompt_email"),
      eq(settingsTable.key, "enquiry_notification_email"),
      eq(settingsTable.key, "rss_knowledge_centre_url"),
    ),
  );
  const settingMap = Object.fromEntries(settings.map((row) => [row.key, row.value ?? ""]));
  const recipient = settingMap.weekly_campaign_prompt_email?.trim() || settingMap.enquiry_notification_email?.trim();
  if (!recipient) return { sent: false, reason: "recipient_not_configured" };

  const feed = await fetchKnowledgeBaseRss(settingMap.rss_knowledge_centre_url || undefined);
  const now = new Date();
  const day = now.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const weekStart = new Date(now);
  weekStart.setUTCDate(now.getUTCDate() - daysSinceMonday);
  weekStart.setUTCHours(0, 0, 0, 0);
  const thisWeek = feed.filter((article) => new Date(article.date).getTime() >= weekStart.getTime()).slice(0, 10);
  const articles = thisWeek.length ? thisWeek : feed.slice(0, 10);
  const businessConfig = await getBusinessConfig();
  const configuredWebsite = typeof businessConfig?.website === "string"
    ? businessConfig.website.replace(/\/$/, "")
    : "";
  const campaignUrl = configuredWebsite
    ? `${configuredWebsite}/order-system/campaigns?weeklyPrompt=true`
    : "/order-system/campaigns?weeklyPrompt=true";
  const rows = articles.map((article) => `
    <li style="margin:0 0 14px">
      <a href="${escapeEmailHtml(article.link)}" style="color:#1B2B48;font-weight:700">${escapeEmailHtml(article.title)}</a>
      <div style="color:#64748b;margin-top:3px">${escapeEmailHtml(article.excerpt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220))}</div>
    </li>`).join("");
  const result = await sendEmail({
    to: recipient,
    subject: "Choose this week's Knowledge Centre email",
    html: `<div style="font-family:Arial,sans-serif;max-width:640px;color:#1e293b">
      <div style="background:#1B2B48;color:#fff;padding:24px;border-radius:10px 10px 0 0">
        <h1 style="margin:0;font-size:22px">Choose this week's article</h1>
        <p style="margin:8px 0 0;color:#cbd5e1">Pick one Knowledge Centre story for the Sunday 5pm email.</p>
      </div>
      <div style="padding:24px;border:1px solid #e2e8f0;border-top:0">
        <p>Choose a suitable article from the week's shortlist. Campaigns will open with a taste of the content and send readers back to the website to read more and browse the shop.</p>
        <ul style="padding-left:20px">${rows || "<li>No new articles were found this week — browse the latest articles in Campaigns.</li>"}</ul>
        <p style="margin-top:24px"><a href="${campaignUrl}" style="display:inline-block;background:#6FA8D3;color:#fff;padding:12px 18px;border-radius:7px;text-decoration:none;font-weight:700">Open Campaigns and choose an article</a></p>
        <p style="font-size:12px;color:#64748b">The campaign will not be scheduled until you review and confirm it.</p>
      </div>
    </div>`,
    text: `Choose this week's Knowledge Centre article for the Sunday 5pm email.\n\n${articles.map((article) => `${article.title}\n${article.excerpt.slice(0, 220)}\n${article.link}`).join("\n\n")}\n\nOpen Campaigns: ${campaignUrl}\n\nThe campaign will not be scheduled until you review and confirm it.`,
  });
  if (!result.sent) return { sent: false, reason: result.error ?? "send_failed" };
  return { sent: true };
}

function registerWeeklyCampaignPromptJob(): void {
registerAutomationCron("weekly-campaign-prompt", "0 9 * * 5", async () => {
  try {
    const recipientSettings = await db.select().from(settingsTable).where(
      or(
        eq(settingsTable.key, "weekly_campaign_prompt_email"),
        eq(settingsTable.key, "enquiry_notification_email"),
      ),
    );
    const recipientMap = Object.fromEntries(recipientSettings.map((row) => [row.key, row.value ?? ""]));
    if (!(recipientMap.weekly_campaign_prompt_email?.trim() || recipientMap.enquiry_notification_email?.trim())) {
      console.log("[campaigns] Weekly Friday prompt skipped (recipient_not_configured)");
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const claimed = await db.execute(sql`
      INSERT INTO settings (key, value, updated_at)
      VALUES ('weekly_campaign_prompt_last_sent', ${today}, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      WHERE settings.value IS DISTINCT FROM EXCLUDED.value
      RETURNING key
    `);
    if (!claimed.rows.length) return;
    const result = await sendWeeklyCampaignPrompt();
    console.log(`[campaigns] Weekly Friday prompt: ${result.sent ? "sent" : `skipped (${result.reason})`}`);
  } catch (err) {
    console.error("[campaigns] Weekly Friday prompt failed:", err);
  }
}, { timezone: "Europe/London" });
}

// ─── Customer re-engagement emails ────────────────────────────────────────────

/**
 * Sends a friendly "checking in" email to customers who haven't placed an order
 * in the last 4 months (120 days) and haven't received a check-in email in the
 * last 120 days either. Controlled by the `checkin_email_enabled` setting.
 */
export async function sendCheckInEmails(): Promise<{ sent: number; skipped: number; errors: number }> {
  // Check if feature is enabled
  const [enabledRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, "checkin_email_enabled"));
  if (enabledRow?.value !== "true") {
    console.log("[checkin-email] Feature disabled — skipping");
    return { sent: 0, skipped: 0, errors: 0 };
  }

  if (!isEmailConfigured) {
    console.log("[checkin-email] No email provider configured — skipping");
    return { sent: 0, skipped: 0, errors: 0 };
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 120);

  // Find customers with email, no order in 120 days, and no check-in email in 120 days
  const eligible = await db.execute<{
    id: number;
    name: string;
    email: string;
    contact_first_name: string | null;
    contact_last_name: string | null;
    logo_url: string | null;
    last_order: Date | null;
    checkin_email_sent_at: Date | null;
  }>(sql`
    SELECT
      c.id,
      c.name,
      c.email,
      c.contact_first_name,
      c.contact_last_name,
      c.logo_url,
      c.checkin_email_sent_at,
      MAX(o.order_date) AS last_order
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id
    WHERE c.email IS NOT NULL AND c.email <> ''
    GROUP BY c.id, c.name, c.email, c.contact_first_name, c.contact_last_name, c.logo_url, c.checkin_email_sent_at
    HAVING
      (MAX(o.order_date) < ${cutoff} OR MAX(o.order_date) IS NULL)
      AND (c.checkin_email_sent_at IS NULL OR c.checkin_email_sent_at < ${cutoff})
  `);

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const customer of eligible.rows) {
    try {
      const firstName = customer.contact_first_name?.trim() || customer.name;
      const logoDataUrl = await fetchLogoDataUrl(customer.logo_url).catch(() => null);

      const { html, text } = buildCheckInEmail({
        customerName: customer.name,
        firstName,
        portalUrl: null,
        customerLogoDataUrl: logoDataUrl,
      });

      const result = await sendEmail({
        to: customer.email,
        subject: `Just checking in — ${customer.name}`,
        html,
        text,
      });

      if (result.sent) {
        await db.execute(sql`
          UPDATE customers SET checkin_email_sent_at = now() WHERE id = ${customer.id}
        `);
        console.log(`[checkin-email] Sent to ${customer.email} (${customer.name})`);
        sent++;
      } else {
        console.error(`[checkin-email] Failed for ${customer.email}: ${result.error}`);
        errors++;
      }
    } catch (err: any) {
      console.error(`[checkin-email] Error for customer ${customer.id}:`, err?.message ?? err);
      errors++;
    }
  }

  // Record last run time
  await db.execute(sql`
    INSERT INTO settings (key, value, updated_at)
    VALUES ('checkin_email_last_run', ${new Date().toISOString()}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `).catch(() => {});

  console.log(`[checkin-email] Done — sent: ${sent}, skipped: ${skipped}, errors: ${errors}`);
  return { sent, skipped, errors };
}

// Run re-engagement emails every Monday at 10am
function registerCheckInEmailsJob(): void {
registerAutomationCron("check-in-emails", "0 10 * * 1", async () => {
  console.log("[checkin-email] Running weekly re-engagement email check");
  try {
    await sendCheckInEmails();
  } catch (err) {
    console.error("[checkin-email] Re-engagement email job failed:", err);
  }
});
}

// ─── Scheduled invoice sends ──────────────────────────────────────────────────
// Every minute: find orders with a scheduled send time that has now passed
// and fire off the invoice email + Xero post, then clear the schedule.
function registerScheduledInvoiceJob(): void {
registerAutomationCron("scheduled-invoices", "* * * * *", async () => {
  try {
    const due = await db
      .select({ id: ordersTable.id, orderNumber: ordersTable.orderNumber, invoiceScheduledSendAt: ordersTable.invoiceScheduledSendAt, invoiceScheduleToEmail: ordersTable.invoiceScheduleToEmail })
      .from(ordersTable)
      .where(
        and(
          isNotNull(ordersTable.invoiceScheduledSendAt),
          lte(ordersTable.invoiceScheduledSendAt, new Date()),
          isNull(ordersTable.invoiceEmailSentAt),
        )
      );

    for (const order of due) {
      // Atomically claim this exact scheduled send. Overlapping cron callbacks
      // may have selected the same row, but only one can clear the unchanged
      // timestamp while invoice_email_sent_at is still null.
      const claimed = await db.update(ordersTable)
        .set({ invoiceScheduledSendAt: null, updatedAt: new Date() })
        .where(and(
          eq(ordersTable.id, order.id),
          eq(ordersTable.invoiceScheduledSendAt, order.invoiceScheduledSendAt!),
          isNull(ordersTable.invoiceEmailSentAt),
        ))
        .returning({ id: ordersTable.id });
      if (claimed.length === 0) continue;

      try {
        await sendInvoiceEmail(order.id, order.invoiceScheduleToEmail ?? undefined);
        console.log(`[invoice-scheduler] Sent scheduled invoice for ${order.orderNumber}`);

        try {
          await postInvoiceToXero(order.id);
        } catch {
          // Xero not connected — non-fatal; order will appear in "To Post to Xero"
        }
      } catch (err) {
        console.error(`[invoice-scheduler] Failed to send invoice for ${order.orderNumber}:`, err);
        // Restore the original scheduled time so the job retries on the next tick.
        // Leave a short delay (2 min) to avoid hammering a broken service.
        const retryAt = new Date(Date.now() + 2 * 60 * 1000);
        await db.update(ordersTable)
          .set({ invoiceScheduledSendAt: retryAt, updatedAt: new Date() })
          .where(eq(ordersTable.id, order.id))
          .catch((restoreErr: unknown) => {
            console.error(`[invoice-scheduler] Could not restore schedule for ${order.orderNumber}:`, restoreErr);
          });
      }
    }
  } catch (err) {
    console.error("[invoice-scheduler] Scheduled invoice job failed:", err);
  }
});
}

// ─── Local delivery 48-hour follow-up sends ───────────────────────────────────
// Every minute: find orders whose follow-up window has elapsed and fire the
// review-request email + GHL WhatsApp webhook, then mark as sent.
function registerLocalDeliveryFollowupJob(): void {
registerAutomationCron("local-delivery-followup", "* * * * *", async () => {
  try {
    const due = await db.execute(sql`
      SELECT o.id, o.order_number, o.customer_name, o.local_delivery_actor_name,
             c.email, c.logo_url, c.high_level_contact_id
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.local_delivery_followup_due_at <= now()
        AND o.local_delivery_followup_due_at IS NOT NULL
        AND o.local_delivery_followup_sent_at IS NULL
        AND (c.has_reviewed IS NULL OR c.has_reviewed = false)
    `);

    for (const row of due.rows as any[]) {
      // Atomically claim — prevents double-fire if two server instances run
      const claimed = await db.execute(sql`
        UPDATE orders
        SET local_delivery_followup_sent_at = now(), updated_at = now()
        WHERE id = ${row.id} AND local_delivery_followup_sent_at IS NULL
        RETURNING id
      `);
      if (claimed.rows.length === 0) continue;

      try {
        const settingsRows = await db.execute(sql`
          SELECT key, value FROM settings
          WHERE key IN ('google_review_url', 'facebook_review_url', 'local_delivery_ghl_webhook_url')
        `);
        const sm: Record<string, string> = {};
        for (const s of settingsRows.rows as any[]) sm[s.key] = s.value;

        // Resolve follow-up templates from DB
        const firstName = (row.customer_name ?? "there").split(/\s/)[0];
        const tplVars = {
          firstName,
          orderNumber: row.order_number,
          customerName: row.customer_name ?? "",
          actorName: row.local_delivery_actor_name ?? "",
          googleReviewUrl: sm["google_review_url"] ?? "",
          facebookReviewUrl: sm["facebook_review_url"] ?? "",
        };
        const [emailTpl, waTpl] = await Promise.all([
          getTemplate("delivery_followup_email"),
          getTemplate("delivery_followup_whatsapp"),
        ]);

        // Send follow-up email
        if (row.email) {
          const logoDataUrl = row.logo_url ? await fetchLogoDataUrl(row.logo_url) : null;
          const { html, text } = buildDeliveryFollowupEmail({
            customerName: row.customer_name ?? "there",
            orderNumber: row.order_number,
            actorName: row.local_delivery_actor_name ?? null,
            googleReviewUrl: sm["google_review_url"] ?? null,
            facebookReviewUrl: sm["facebook_review_url"] ?? null,
            customerLogoDataUrl: logoDataUrl,
          });
          const subject = emailTpl?.subject
            ? applyVars(emailTpl.subject, tplVars)
            : `How did your ${row.order_number} order arrive?`;
          await sendEmail({ to: row.email, subject, html, text });
        }

        // Fire GHL follow-up webhook (WhatsApp)
        if (sm["local_delivery_ghl_webhook_url"] && row.high_level_contact_id) {
          const messageText = waTpl?.body ? applyVars(waTpl.body, tplVars) : undefined;
          await assertIntegrationOutboundAllowed("highlevel");
          fetch(sm["local_delivery_ghl_webhook_url"], {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              eventType: "delivery_followup",
              contactId: row.high_level_contact_id,
              orderNumber: row.order_number,
              customerName: row.customer_name,
              actorName: row.local_delivery_actor_name ?? null,
              ...(messageText ? { messageText } : {}),
            }),
          }).catch((e) => console.error("[delivery-followup] GHL webhook failed:", e));
        }

        console.log(`[delivery-followup] Sent for ${row.order_number}`);
      } catch (err) {
        console.error(`[delivery-followup] Failed for ${row.order_number}:`, err);
        // Restore so the next tick retries
        await db.execute(sql`
          UPDATE orders SET local_delivery_followup_sent_at = NULL, updated_at = now()
          WHERE id = ${row.id}
        `).catch(() => {});
      }
    }
  } catch (err) {
    console.error("[delivery-followup] Job failed:", err);
  }
});
}

// ─── Invoice 48-hour follow-up sends (all non-local-delivery orders) ───────────
// Every minute: find orders whose invoice follow-up window has elapsed, fire the
// review-request email + GHL WhatsApp webhook, then mark as sent.
// Skips customers who have already left a review (has_reviewed = true).
function registerInvoiceFollowupJob(): void {
registerAutomationCron("invoice-followup", "* * * * *", async () => {
  try {
    const due = await db.execute(sql`
      SELECT o.id, o.order_number, o.customer_name,
             c.email, c.logo_url, c.high_level_contact_id
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.invoice_followup_due_at <= now()
        AND o.invoice_followup_due_at IS NOT NULL
        AND o.invoice_followup_sent_at IS NULL
        AND (c.has_reviewed IS NULL OR c.has_reviewed = false)
    `);

    for (const row of due.rows as any[]) {
      // Atomically claim — prevents double-fire if two server instances run
      const claimed = await db.execute(sql`
        UPDATE orders
        SET invoice_followup_sent_at = now(), updated_at = now()
        WHERE id = ${row.id} AND invoice_followup_sent_at IS NULL
        RETURNING id
      `);
      if (claimed.rows.length === 0) continue;

      try {
        const settingsRows = await db.execute(sql`
          SELECT key, value FROM settings
          WHERE key IN ('google_review_url', 'facebook_review_url', 'local_delivery_ghl_webhook_url')
        `);
        const sm: Record<string, string> = {};
        for (const s of settingsRows.rows as any[]) sm[s.key] = s.value;

        const firstName = (row.customer_name ?? "there").split(/\s/)[0];
        const tplVars = {
          firstName,
          orderNumber: row.order_number,
          customerName: row.customer_name ?? "",
          actorName: "",
          googleReviewUrl: sm["google_review_url"] ?? "",
          facebookReviewUrl: sm["facebook_review_url"] ?? "",
        };
        const [emailTpl, waTpl] = await Promise.all([
          getTemplate("invoice_followup_email"),
          getTemplate("invoice_followup_whatsapp"),
        ]);

        // Send follow-up email (falls back to delivery_followup_email template if not configured)
        if (row.email) {
          const logoDataUrl = row.logo_url ? await fetchLogoDataUrl(row.logo_url) : null;
          const fallbackTpl = emailTpl ?? await getTemplate("delivery_followup_email");
          const { html, text } = buildDeliveryFollowupEmail({
            customerName: row.customer_name ?? "there",
            orderNumber: row.order_number,
            actorName: null,
            googleReviewUrl: sm["google_review_url"] ?? null,
            facebookReviewUrl: sm["facebook_review_url"] ?? null,
            customerLogoDataUrl: logoDataUrl,
          });
          const subject = fallbackTpl?.subject
            ? applyVars(fallbackTpl.subject, tplVars)
            : `How was your ${row.order_number} order?`;
          await sendEmail({ to: row.email, subject, html, text });
        }

        // Fire GHL webhook (WhatsApp)
        if (sm["local_delivery_ghl_webhook_url"] && row.high_level_contact_id) {
          const messageText = waTpl?.body ? applyVars(waTpl.body, tplVars) : undefined;
          await assertIntegrationOutboundAllowed("highlevel");
          fetch(sm["local_delivery_ghl_webhook_url"], {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              eventType: "invoice_followup",
              contactId: row.high_level_contact_id,
              orderNumber: row.order_number,
              customerName: row.customer_name,
              ...(messageText ? { messageText } : {}),
            }),
          }).catch((e) => console.error("[invoice-followup] GHL webhook failed:", e));
        }

        console.log(`[invoice-followup] Sent for ${row.order_number}`);
      } catch (err) {
        console.error(`[invoice-followup] Failed for ${row.order_number}:`, err);
        // Restore so the next tick retries
        await db.execute(sql`
          UPDATE orders SET invoice_followup_sent_at = NULL, updated_at = now()
          WHERE id = ${row.id}
        `).catch(() => {});
      }
    }
  } catch (err) {
    console.error("[invoice-followup] Job failed:", err);
  }
});
}

// ─── Workflow automation engine ───────────────────────────────────────────────
// Every minute: advance any pending workflow_execution records through their steps.
function registerWorkflowExecutionJob(): void {
registerAutomationCron("workflow-execution", "* * * * *", async () => {
  try {
    await processWorkflowExecutions();
  } catch (err) {
    console.error("[workflow-engine] Per-minute processor failed:", err);
  }
});
}

// ─── Weekly SEO & Performance Health Check ────────────────────────────────────
// Every Monday at 8:00 AM — fetches the live shop, verifies meta tags,
// structured data, API response times, and emails a report to staff.
function registerWeeklySeoCheckJob(): void {
registerAutomationCron("weekly-seo-check", "0 8 * * 1", async () => {
  console.log("[seo-check] Weekly SEO health check triggered");
  try {
    await runSeoHealthCheck();
  } catch (err) {
    console.error("[seo-check] Weekly check failed:", err);
  }
});
}

// Recheck during working hours so a restart or outage cannot miss the daily
// run. The persistent per-line due-date claim prevents repeat emails.
function registerSupplierChaseJob(): void {
registerAutomationCron("supplier-chase", "15 8-17 * * 1-5", async () => {
  try {
    await chaseOverdueSupplierItems();
  } catch (err) {
    console.error("[supplier-chase] Scheduled chase failed:", err);
  }
}, { timezone: "Europe/London" });
}
