import { Router, type IRouter, type RequestHandler } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { z } from "zod";
import { OAuth2Client } from "google-auth-library";
import { fetchKnowledgeBaseRss } from "../services/rss-feed.js";

const router: IRouter = Router();
const mayaV1: IRouter = Router();
const windows = new Map<string, number[]>();
const excludedStatuses = ["draft", "portal_draft", "portal_pending", "cancelled", "archived"];
let lastRequest: string | null = null, lastSuccessful: string | null = null, lastFailed: string | null = null;
let statusWriteAt = 0;

const auth: RequestHandler = (req, res, next) => {
  const expected = process.env.MAYA_API_KEY;
  const supplied = (req.get("authorization") ?? "").startsWith("Bearer ") ? (req.get("authorization") ?? "").slice(7) : "";
  if (!expected || !supplied) { res.status(401).json({ error: "Unauthorized" }); return; }
  const a = createHash("sha256").update(expected).digest(), b = createHash("sha256").update(supplied).digest();
  if (!timingSafeEqual(a, b)) { res.status(401).json({ error: "Unauthorized" }); return; }
  next();
};
const limit: RequestHandler = (req, res, next) => {
  const now = Date.now(), key = req.ip ?? "unknown";
  const recent = (windows.get(key) ?? []).filter((x) => now - x < 60_000);
  if (recent.length >= 60) { res.status(429).json({ error: "Rate limit exceeded" }); return; }
  recent.push(now); windows.set(key, recent); lastRequest = new Date(now).toISOString(); next();
};
mayaV1.use(auth, limit);
function rows(result: unknown): any[] { return ((result as { rows?: any[] }).rows ?? result) as any[]; }
// GSC egress at /api/maya/v1/analytics/search-console uses
// GOOGLE_SEARCH_CONSOLE_CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN/SITE_URL and requires
// installation_activated=true plus integration_enabled.google_search_console=true.
async function assertMayaIntegrationEnabled(provider: string): Promise<void> {
  const result = await db.execute(sql`
    SELECT key, value FROM settings
    WHERE key IN ('installation_activated', 'integration_enabled')
  `);
  const settings = new Map<string, string>(
    rows(result).map((row) => [row.key, row.value ?? ""]),
  );
  if (settings.get("installation_activated") !== "true") {
    throw new Error(`Outbound ${provider} request blocked until installation activation.`);
  }
  let integrations: unknown;
  try { integrations = JSON.parse(settings.get("integration_enabled") ?? "null"); } catch {
    throw new Error("Outbound integration capability state is invalid; requests are blocked.");
  }
  if (!integrations || typeof integrations !== "object" || Array.isArray(integrations)
    || (integrations as Record<string, unknown>)[provider] !== true) {
    throw new Error(`${provider} integration is not explicitly enabled.`);
  }
}

function page(req: { query: Record<string, unknown> }) {
  const p = z.object({ page: z.coerce.number().int().min(1).max(10_000).default(1), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
  return { page: p.page, limit: p.limit, offset: (p.page - 1) * p.limit };
}
const dateQuery = z.object({ from: z.string().date().optional(), to: z.string().date().optional() }).superRefine((v, c) => {
  if (v.from && v.to && v.from > v.to) c.addIssue({ code: "custom", message: "from must not be after to", path: ["from"] });
});
function dateSql(q: Record<string, unknown>) {
  const d = dateQuery.parse(q);
  return { ...d, clause: d.from && d.to ? sql` AND o.order_date >= ${d.from}::date AND o.order_date < (${d.to}::date + interval '1 day')` :
    d.from ? sql` AND o.order_date >= ${d.from}::date` : d.to ? sql` AND o.order_date < (${d.to}::date + interval '1 day')` : sql`` };
}
async function mark(kind: "success" | "failure") {
  const now = new Date().toISOString();
  if (kind === "success") lastSuccessful = now; else lastFailed = now;
  if (Date.now() - statusWriteAt < 60_000) return;
  statusWriteAt = Date.now();
  const key = kind === "success" ? "maya_last_successful_request" : "maya_last_failed_request";
  try { await db.execute(sql`INSERT INTO settings (key,value) VALUES (${key},${now}) ON CONFLICT (key) DO UPDATE SET value=${now}, updated_at=now()`); } catch { /* status remains process-visible */ }
}
function ok(res: any, value: unknown) { void mark("success"); res.json(value); }
function fail(res: any, err: unknown) { void mark("failure"); const message = err instanceof Error ? err.message : "Request failed"; res.status(400).json({ error: message }); }
async function stored(key: string) { try { return rows(await db.execute(sql`SELECT value FROM settings WHERE key=${key}`))[0]?.value ?? null; } catch { return null; } }
async function writeAccessEnabled(): Promise<boolean> {
  if (process.env.MAYA_WRITE_API_ENABLED !== "true") return false;
  try {
    const result = await db.execute(sql`SELECT value FROM settings WHERE key = 'maya_write_access_enabled'`);
    return rows(result)[0]?.value === "true";
  } catch {
    return false;
  }
}

mayaV1.get("/status", async (_req, res) => {
  try {
    const [p, c, o, rss] = await Promise.all([db.execute(sql`SELECT count(*)::int AS count FROM products WHERE is_archived=false`), db.execute(sql`SELECT count(*)::int AS count FROM product_categories`), db.execute(sql`SELECT max(order_date) AS last_order FROM orders`), fetchKnowledgeBaseRss().catch(() => null)]);
    ok(res, { connection: "connected", applicationVersion: process.env.APP_VERSION ?? "unknown", apiVersion: "v1", websiteUrl: process.env.PUBLIC_WEBSITE_URL ?? null, timestamp: new Date().toISOString(), productCount: rows(p)[0]?.count ?? 0, categoryCount: rows(c)[0]?.count ?? 0, indexedPageCount: null, knowledgeCentreArticleCount: rss ? rss.length : null, knowledgeCentreArticleCountReason: rss ? null : "RSS unavailable", lastOrderTimestamp: rows(o)[0]?.last_order ?? null, capabilities: capabilities() });
  } catch (e) { fail(res, e); }
});
function capabilities() { return ["/api/maya/v1/status", "/api/maya/v1/products", "/api/maya/v1/categories", "/api/maya/v1/articles", "/api/maya/v1/pages", "/api/maya/v1/site-health", "/api/maya/v1/internal-links", "/api/maya/v1/customers", "/api/maya/v1/orders", "/api/maya/v1/analytics/traffic", "/api/maya/v1/analytics/funnel", "/api/maya/v1/analytics/attribution", "/api/maya/v1/analytics/products", "/api/maya/v1/analytics/categories", "/api/maya/v1/analytics/search-console", "/api/maya/v1/analytics/commerce/summary", "/api/maya/v1/analytics/commerce/products", "/api/maya/v1/analytics/commerce/categories", "/api/maya/v1/analytics/commerce/order-role", "/api/maya/v1/analytics/commerce/refunds-cancellations", "/api/maya/v1/analytics/orders", "/api/maya/v1/analytics/customers", "/api/maya/v1/integration/status", "/api/maya/v1/integration-status", "/api/maya/v1/webhooks", "/api/maya/v1/webhook-contract"]; }

const analyticsDates = z.object({ from: z.string().date().optional(), to: z.string().date().optional() }).superRefine((v, c) => {
  const to = v.to ? new Date(`${v.to}T00:00:00Z`) : new Date();
  const from = v.from ? new Date(`${v.from}T00:00:00Z`) : new Date(to.getTime() - 27 * 86400000);
  if (from > to || to.getTime() - from.getTime() > 366 * 86400000) c.addIssue({ code: "custom", message: "Invalid analytics date range" });
});
function analyticsWindow(q: Record<string, unknown>) {
  const d = analyticsDates.parse(q); const to = d.to ?? new Date().toISOString().slice(0, 10);
  const from = d.from ?? new Date(Date.now() - 27 * 86400000).toISOString().slice(0, 10);
  return { from, to, clause: sql`occurred_at >= ${from}::date AND occurred_at < (${to}::date + interval '1 day')` };
}

const commerceQuery = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(1_000).default(100),
}).superRefine((value, context) => {
  if (value.from && value.to && value.from > value.to) {
    context.addIssue({ code: "custom", message: "from must not be after to", path: ["from"] });
  }
});
const COMMERCE_EXCLUDED_STATUSES = ["cancelled", "draft", "portal_draft", "archived"] as const;
const COMMERCE_REVENUE_DEFINITION = "Stored physical-merchandise line revenue excluding VAT and carriage. Cancelled, draft, portal-draft and archived orders are excluded. Refunds and discounts are not inferred.";
const COMMERCE_HISTORY_LIMITATION = "First/repeat means first-known/repeat-within-stored-history, not lifetime acquisition. Stored production history currently begins in May 2026 and may omit earlier WooCommerce or legacy orders.";
const COMMERCE_PRIMARY_CATEGORY_RULE = "The first canonical WooCommerce category ID in the product's stored category array is used. Missing or unmatched IDs are grouped as uncategorised so revenue is never duplicated.";
const PHYSICAL_BUNDLE_HEADER = sql`(
  oi.is_bundle_header=true
  AND EXISTS (SELECT 1 FROM order_items bc WHERE bc.order_id=oi.order_id AND bc.bundle_ref=oi.bundle_ref AND bc.is_bundle_header IS NOT TRUE)
  AND NOT EXISTS (
    SELECT 1 FROM order_items bc LEFT JOIN products bp ON bp.id=bc.product_id
    WHERE bc.order_id=oi.order_id AND bc.bundle_ref=oi.bundle_ref AND bc.is_bundle_header IS NOT TRUE
      AND (bp.id IS NULL OR bp.is_service IS DISTINCT FROM false)
  )
)`;
const SERVICE_BUNDLE_HEADER = sql`(
  oi.is_bundle_header=true
  AND EXISTS (SELECT 1 FROM order_items bc WHERE bc.order_id=oi.order_id AND bc.bundle_ref=oi.bundle_ref AND bc.is_bundle_header IS NOT TRUE)
  AND NOT EXISTS (
    SELECT 1 FROM order_items bc LEFT JOIN products bp ON bp.id=bc.product_id
    WHERE bc.order_id=oi.order_id AND bc.bundle_ref=oi.bundle_ref AND bc.is_bundle_header IS NOT TRUE
      AND (bp.id IS NULL OR bp.is_service IS DISTINCT FROM true)
  )
)`;
const HISTORY_EXCLUDED_STATUSES = ["draft", "portal_draft", "portal_pending", "archived"] as const;
const HISTORY_LIMITATION = "History excludes unfinished/internal statuses draft, portal_draft, portal_pending and archived; cancelled orders are included. Stored history may not represent lifetime history.";
const HISTORY_REVENUE_DEFINITION = "Values are stored ex-VAT. Merchandise is physical products or all-physical bundle headers; service is service products or all-service bundle headers. Bundle components are excluded when the header carries revenue. Unresolved or mixed bundle headers and unlinked product lines are unclassified. Carriage is stored separately.";
function commerceWindow(q: Record<string, unknown>) {
  const input = commerceQuery.parse(q);
  const clause = input.from && input.to ? sql` AND o.order_date >= ${input.from}::date AND o.order_date < (${input.to}::date + interval '1 day')` :
    input.from ? sql` AND o.order_date >= ${input.from}::date` :
    input.to ? sql` AND o.order_date < (${input.to}::date + interval '1 day')` : sql``;
  return { ...input, offset: (input.page - 1) * input.limit, clause };
}
async function commerceHistoryStart(): Promise<string | null> {
  const result = await db.execute(sql`SELECT min(order_date)::date AS date FROM orders WHERE status NOT IN ('cancelled','draft','portal_draft','archived')`);
  return rows(result)[0]?.date ?? null;
}
function numericRecord(record: Record<string, any>, fields: string[]): Record<string, any> {
  const copy: Record<string, any> = { ...record };
  for (const field of fields) copy[field] = Number(copy[field] ?? 0);
  return copy;
}

const SEARCH_CONSOLE_READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const searchConsoleQuery = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  view: z.enum(["query", "page", "date", "query_page", "query_date", "page_date"]).default("query_page"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(1_000).default(250),
}).superRefine((value, context) => {
  const to = value.to ? new Date(`${value.to}T00:00:00Z`) : new Date();
  const from = value.from ? new Date(`${value.from}T00:00:00Z`) : new Date(to.getTime() - 27 * 86_400_000);
  if (from > to || to.getTime() - from.getTime() > 500 * 86_400_000) {
    context.addIssue({ code: "custom", message: "Invalid Search Console date range" });
  }
});
const searchConsoleDimensions = {
  query: ["query"],
  page: ["page"],
  date: ["date"],
  query_page: ["query", "page"],
  query_date: ["query", "date"],
  page_date: ["page", "date"],
} as const;
let searchConsoleVerification: { property: string; permissionLevel: string; verifiedAt: number } | null = null;

function searchConsoleConfig() {
  const clientId = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN;
  const property = process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL;
  if (!clientId || !clientSecret || !refreshToken || !property) {
    throw new Error("Search Console is not fully configured");
  }
  if (process.env.PUBLIC_WEBSITE_URL && property !== `sc-domain:${new URL(process.env.PUBLIC_WEBSITE_URL).hostname}`) {
    throw new Error("Search Console property configuration is invalid");
  }
  return { clientId, clientSecret, refreshToken, property };
}

async function searchConsoleAccess() {
  await assertMayaIntegrationEnabled("google_search_console");
  const config = searchConsoleConfig();
  const client = new OAuth2Client(config.clientId, config.clientSecret);
  client.setCredentials({ refresh_token: config.refreshToken });
  let accessToken: string;
  try {
    const token = await client.getAccessToken();
    accessToken = token.token ?? "";
    if (!accessToken) throw new Error("No access token");
    const tokenInfo = await client.getTokenInfo(accessToken);
    const scopes = tokenInfo.scopes ?? [];
    if (!scopes.includes(SEARCH_CONSOLE_READONLY_SCOPE) ||
        scopes.includes("https://www.googleapis.com/auth/webmasters")) {
      throw new Error("Unexpected OAuth scope");
    }
  } catch {
    throw new Error("Search Console authentication failed");
  }

  if (!searchConsoleVerification ||
      searchConsoleVerification.property !== config.property ||
      Date.now() - searchConsoleVerification.verifiedAt > 15 * 60_000) {
    let response: Response;
    try {
      response = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      throw new Error("Search Console property verification failed");
    }
    if (!response.ok) throw new Error("Search Console property verification failed");
    const result = await response.json() as { siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }> };
    const property = result.siteEntry?.find((entry) => entry.siteUrl === config.property);
    if (!property || !["siteRestrictedUser", "siteFullUser", "siteOwner"].includes(property.permissionLevel ?? "")) {
      throw new Error("Configured Search Console property is not accessible");
    }
    searchConsoleVerification = {
      property: config.property,
      permissionLevel: property.permissionLevel ?? "unknown",
      verifiedAt: Date.now(),
    };
  }
  return { accessToken, verification: searchConsoleVerification };
}
mayaV1.get("/analytics/traffic", async (req,res) => { try { const d=analyticsWindow(req.query); const r=await db.execute(sql`SELECT date_trunc('day',occurred_at)::date AS date,channel,landing_path AS "landingPath",referrer_domain AS "referringDomain",device_category AS device,count(*)::int AS events,count(DISTINCT session_id)::int AS sessions FROM analytics_events WHERE ${d.clause} GROUP BY 1,2,3,4,5 ORDER BY 1`); ok(res,{available:true,filters:{from:d.from,to:d.to},items:rows(r)}); } catch(e){fail(res,e);} });
mayaV1.get("/analytics/funnel", async (req,res) => { try { const d=analyticsWindow(req.query); const r=await db.execute(sql`SELECT event_type AS event,count(*)::int AS events,count(DISTINCT session_id)::int AS sessions FROM analytics_events WHERE ${d.clause} GROUP BY event_type ORDER BY event_type`); const items=rows(r); const n=(x:string)=>Number(items.find(i=>i.event===x)?.sessions??0); const pv=n("PAGE_VIEW"); ok(res,{available:true,filters:{from:d.from,to:d.to},steps:items.map(x=>({...x,rateFromPageView:pv?Number(x.sessions)/pv:0})),definitions:"Rates use distinct sessions; step counts are not ordered-path conversion."}); } catch(e){fail(res,e);} });
mayaV1.get("/analytics/attribution", async (req,res) => { try { const model=req.query.model==="last_touch"?"last":"first"; if(req.query.model && !["first_touch","last_touch"].includes(String(req.query.model))) throw new Error("model must be first_touch or last_touch"); const d=analyticsWindow(req.query); const r=await db.execute(sql`SELECT ${sql.raw(model)}_channel AS channel,${sql.raw(model)}_landing_path AS "landingPath",count(*)::int AS orders,coalesce(sum(revenue),0)::numeric AS revenue,count(*) FILTER(WHERE repeat_order=false)::int AS new,count(*) FILTER(WHERE repeat_order=true)::int AS repeat FROM order_attribution WHERE created_at >= ${d.from}::date AND created_at < (${d.to}::date + interval '1 day') GROUP BY 1,2 ORDER BY orders DESC`); ok(res,{available:true,model:req.query.model==="last_touch"?"last_touch":"first_touch",filters:{from:d.from,to:d.to},items:rows(r)}); } catch(e){fail(res,e);} });
mayaV1.get("/analytics/products", async (req,res) => { try { const d=analyticsWindow(req.query); const r=await db.execute(sql`WITH measured AS (SELECT product_id,count(*) FILTER(WHERE event_type='PRODUCT_VIEW')::int AS views,count(*) FILTER(WHERE event_type='ADD_TO_BASKET')::int AS baskets,count(*) FILTER(WHERE event_type IN ('BEGIN_CHECKOUT','CHECKOUT_COMPLETED'))::int AS checkouts FROM analytics_events WHERE ${d.clause} AND product_id IS NOT NULL GROUP BY product_id), sold AS (SELECT oi.product_id,sum(oi.quantity)::int AS "unitsSold",sum(oi.line_total)::numeric AS revenue FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.order_date >= ${d.from}::date AND o.order_date < (${d.to}::date + interval '1 day') AND o.status NOT IN ('draft','cancelled','archived') GROUP BY oi.product_id) SELECT m.product_id AS "productId",p.name AS "productName",m.views,m.baskets,m.checkouts,coalesce(s."unitsSold",0) AS "unitsSold",coalesce(s.revenue,0) AS revenue FROM measured m LEFT JOIN products p ON p.id::text=m.product_id LEFT JOIN sold s ON s.product_id::text=m.product_id ORDER BY m.views DESC LIMIT 1000`); ok(res,{available:true,filters:{from:d.from,to:d.to},items:rows(r),dataAvailability:{measured:"anonymous events",sold:"order items; may include historical non-attributed orders"}}); } catch(e){fail(res,e);} });
mayaV1.get("/analytics/categories", async (req,res) => { try { const d=analyticsWindow(req.query); const r=await db.execute(sql`WITH measured AS (SELECT category_id,count(*) FILTER(WHERE event_type='CATEGORY_VIEW')::int AS views,count(*) FILTER(WHERE event_type='ADD_TO_BASKET')::int AS baskets,count(*) FILTER(WHERE event_type IN ('BEGIN_CHECKOUT','CHECKOUT_COMPLETED'))::int AS checkouts FROM analytics_events WHERE ${d.clause} AND category_id IS NOT NULL GROUP BY category_id), sold AS (SELECT pc.woo_id AS category,sum(oi.quantity)::int AS "unitsSold",sum(oi.line_total)::numeric AS revenue FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN products p ON p.id=oi.product_id JOIN product_categories pc ON p.product_category_ids @> jsonb_build_array(pc.woo_id) WHERE o.order_date >= ${d.from}::date AND o.order_date < (${d.to}::date + interval '1 day') AND o.status NOT IN ('draft','cancelled','archived') GROUP BY pc.woo_id) SELECT m.category_id AS category,m.views,m.baskets,m.checkouts,coalesce(s."unitsSold",0) AS "unitsSold",coalesce(s.revenue,0) AS revenue FROM measured m LEFT JOIN sold s ON s.category::text=m.category_id ORDER BY m.views DESC LIMIT 1000`); ok(res,{available:true,filters:{from:d.from,to:d.to},items:rows(r),dataAvailability:{sold:"order items mapped through canonical product category IDs"}}); } catch(e){fail(res,e);} });

mayaV1.get("/analytics/commerce/summary", async (req, res) => {
  try {
    const d = commerceWindow(req.query);
    const [orderResult, lineResult, roleResult, historyStart] = await Promise.all([
      db.execute(sql`
        SELECT count(*)::int AS orders,
          count(DISTINCT customer_id)::int AS "uniqueCustomers",
          count(*) FILTER (WHERE customer_id IS NOT NULL)::int AS "linkedOrders",
          coalesce(sum(carriage_amount),0)::numeric AS "carriageExVat"
        FROM orders o
        WHERE o.status NOT IN ('cancelled','draft','portal_draft','archived')${d.clause}`),
      db.execute(sql`
        SELECT
          coalesce(sum(CASE WHEN p.is_service=false AND (oi.bundle_ref IS NULL OR oi.is_bundle_header IS NOT TRUE) THEN oi.quantity ELSE 0 END),0)::int AS "physicalUnits",
          coalesce(sum(CASE WHEN (p.is_service=false OR ${PHYSICAL_BUNDLE_HEADER}) AND NOT (oi.bundle_ref IS NOT NULL AND oi.is_bundle_header IS NOT TRUE) THEN oi.line_total ELSE 0 END),0)::numeric AS "merchandiseRevenueExVat",
          coalesce(sum(CASE WHEN (p.is_service=true OR ${SERVICE_BUNDLE_HEADER}) AND NOT (oi.bundle_ref IS NOT NULL AND oi.is_bundle_header IS NOT TRUE) THEN oi.line_total ELSE 0 END),0)::numeric AS "serviceRevenueExVat",
          coalesce(sum(CASE WHEN oi.is_bundle_header=true AND NOT ${PHYSICAL_BUNDLE_HEADER} AND NOT ${SERVICE_BUNDLE_HEADER} THEN oi.line_total ELSE 0 END),0)::numeric AS "unclassifiedBundleRevenueExVat",
          coalesce(sum(CASE WHEN p.id IS NULL AND oi.is_bundle_header IS NOT TRUE AND NOT (oi.bundle_ref IS NOT NULL AND oi.is_bundle_header IS NOT TRUE) THEN oi.line_total ELSE 0 END),0)::numeric AS "unclassifiedRevenueExVat"
        FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN products p ON p.id=oi.product_id
        WHERE o.status NOT IN ('cancelled','draft','portal_draft','archived')${d.clause}`),
      db.execute(sql`
        WITH ranked AS (
          SELECT o.id,o.customer_id,o.order_date,
            row_number() OVER (PARTITION BY o.customer_id ORDER BY o.order_date,o.id) AS known_order_number
          FROM orders o
          WHERE o.status NOT IN ('cancelled','draft','portal_draft','archived') AND o.customer_id IS NOT NULL
        )
        SELECT count(*) FILTER (WHERE known_order_number=1)::int AS "firstKnownOrders",
          count(*) FILTER (WHERE known_order_number>1)::int AS "repeatOrders"
        FROM ranked o WHERE true${d.clause}`),
      commerceHistoryStart(),
    ]);
    const order = numericRecord(rows(orderResult)[0] ?? {}, ["orders","uniqueCustomers","linkedOrders","carriageExVat"]);
    const line = numericRecord(rows(lineResult)[0] ?? {}, ["physicalUnits","merchandiseRevenueExVat","serviceRevenueExVat","unclassifiedBundleRevenueExVat","unclassifiedRevenueExVat"]);
    const role = numericRecord(rows(roleResult)[0] ?? {}, ["firstKnownOrders","repeatOrders"]);
    ok(res, {
      available: true,
      filters: { from: d.from ?? null, to: d.to ?? null, excludedStatuses: COMMERCE_EXCLUDED_STATUSES },
      availableHistoryStartDate: historyStart,
      orders: order.orders,
      physicalUnits: line.physicalUnits,
      uniqueCustomers: order.uniqueCustomers,
      linkedCustomerCoverage: order.orders ? order.linkedOrders / order.orders : 0,
      merchandiseRevenueExVat: line.merchandiseRevenueExVat,
      serviceRevenueExVat: line.serviceRevenueExVat,
      unclassifiedBundleRevenueExVat: line.unclassifiedBundleRevenueExVat,
      unclassifiedRevenueExVat: line.unclassifiedRevenueExVat,
      carriageExVat: order.carriageExVat,
      combinedStoredRevenueExVat: line.merchandiseRevenueExVat + line.serviceRevenueExVat + line.unclassifiedBundleRevenueExVat + line.unclassifiedRevenueExVat + order.carriageExVat,
      averageMerchandiseOrderValueExVat: order.orders ? line.merchandiseRevenueExVat / order.orders : 0,
      orderRole: role,
      revenueDefinition: COMMERCE_REVENUE_DEFINITION,
      historyLimitation: COMMERCE_HISTORY_LIMITATION,
      refundDataAvailable: false,
    });
  } catch (e) { fail(res, e); }
});

mayaV1.get("/analytics/commerce/products", async (req, res) => {
  try {
    const d = commerceWindow(req.query);
    const [result, coverageResult, historyStart] = await Promise.all([
      db.execute(sql`
        WITH product_metrics AS (
          SELECT CASE WHEN oi.is_bundle_header=true OR p.id IS NULL OR p.is_bespoke=true THEN NULL ELSE p.id END AS "productId",
            CASE WHEN ${PHYSICAL_BUNDLE_HEADER} THEN 'Physical bundles' WHEN ${SERVICE_BUNDLE_HEADER} THEN 'Service bundles' WHEN oi.is_bundle_header=true THEN 'Mixed or unclassified bundles' WHEN p.is_bespoke=true THEN 'Bespoke products' WHEN p.id IS NULL THEN 'Unclassified' ELSE p.name END AS "productName",
            CASE WHEN ${PHYSICAL_BUNDLE_HEADER} THEN 'bundle_physical' WHEN ${SERVICE_BUNDLE_HEADER} THEN 'bundle_service' WHEN oi.is_bundle_header=true THEN 'bundle_unclassified' WHEN p.id IS NULL THEN 'unclassified' WHEN p.is_bespoke=true AND p.is_service=false THEN 'bespoke_physical' WHEN p.is_service THEN 'service' ELSE 'physical' END AS classification,
            count(DISTINCT o.id)::int AS orders,
            count(DISTINCT o.customer_id)::int AS "uniqueCustomers",
            coalesce(sum(CASE WHEN p.is_service=false AND (oi.bundle_ref IS NULL OR oi.is_bundle_header IS NOT TRUE) THEN oi.quantity ELSE 0 END),0)::int AS "physicalUnits",
            coalesce(sum(CASE WHEN NOT (oi.bundle_ref IS NOT NULL AND oi.is_bundle_header IS NOT TRUE) THEN oi.line_total ELSE 0 END),0)::numeric AS "revenueExVat"
          FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN products p ON p.id=oi.product_id
          WHERE o.status NOT IN ('cancelled','draft','portal_draft','archived')${d.clause}
          GROUP BY 1,2,3
        ), included AS (
          SELECT * FROM product_metrics WHERE "physicalUnits"<>0 OR "revenueExVat"<>0
        ), metadata AS (
          SELECT count(*)::int AS "totalRows" FROM included
        ), paged AS (
          SELECT * FROM included ORDER BY "revenueExVat" DESC,"productName"
          LIMIT ${d.limit} OFFSET ${d.offset}
        )
        SELECT paged.*,metadata."totalRows" FROM metadata LEFT JOIN paged ON true`),
      db.execute(sql`
        SELECT count(*)::int AS lines,
          count(*) FILTER (WHERE oi.product_id IS NOT NULL AND p.id IS NOT NULL)::int AS "linkedLines",
          coalesce(sum(CASE WHEN p.is_service=false AND (oi.bundle_ref IS NULL OR oi.is_bundle_header IS NOT TRUE) THEN oi.quantity ELSE 0 END),0)::int AS "physicalUnits",
          coalesce(sum(CASE WHEN (p.is_service=false OR ${PHYSICAL_BUNDLE_HEADER}) AND NOT (oi.bundle_ref IS NOT NULL AND oi.is_bundle_header IS NOT TRUE) THEN oi.line_total ELSE 0 END),0)::numeric AS "merchandiseRevenueExVat",
          coalesce(sum(CASE WHEN (p.is_service=true OR ${SERVICE_BUNDLE_HEADER}) AND NOT (oi.bundle_ref IS NOT NULL AND oi.is_bundle_header IS NOT TRUE) THEN oi.line_total ELSE 0 END),0)::numeric AS "serviceRevenueExVat",
          coalesce(sum(CASE WHEN oi.is_bundle_header=true AND NOT ${PHYSICAL_BUNDLE_HEADER} AND NOT ${SERVICE_BUNDLE_HEADER} THEN oi.line_total ELSE 0 END),0)::numeric AS "unclassifiedBundleRevenueExVat",
          coalesce(sum(CASE WHEN p.id IS NULL AND oi.is_bundle_header IS NOT TRUE AND NOT (oi.bundle_ref IS NOT NULL AND oi.is_bundle_header IS NOT TRUE) THEN oi.line_total ELSE 0 END),0)::numeric AS "unclassifiedRevenueExVat"
        FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN products p ON p.id=oi.product_id
        WHERE o.status NOT IN ('cancelled','draft','portal_draft','archived')${d.clause}`),
      commerceHistoryStart(),
    ]);
    const resultRows = rows(result);
    const items = resultRows.filter((item) => item.productName != null).map((item) => {
      const mapped = numericRecord(item, ["orders","uniqueCustomers","physicalUnits","revenueExVat","totalRows"]);
      return {
        productId: mapped.productId ?? null,
        productName: mapped.productName,
        classification: mapped.classification,
        orders: mapped.orders,
        uniqueCustomers: mapped.uniqueCustomers,
        physicalUnits: mapped.physicalUnits,
        revenueExVat: mapped.revenueExVat,
      };
    });
    const coverage = numericRecord(rows(coverageResult)[0] ?? {}, ["lines","linkedLines","physicalUnits","merchandiseRevenueExVat","serviceRevenueExVat","unclassifiedBundleRevenueExVat","unclassifiedRevenueExVat"]);
    const total = Number(resultRows[0]?.totalRows ?? 0);
    ok(res, {
      available: true,
      filters: { from: d.from ?? null, to: d.to ?? null, excludedStatuses: COMMERCE_EXCLUDED_STATUSES },
      availableHistoryStartDate: historyStart,
      page: d.page, limit: d.limit, total, nextPage: d.offset + items.length < total ? d.page + 1 : null,
      items,
      totals: {
        physicalUnits: coverage.physicalUnits,
        merchandiseRevenueExVat: coverage.merchandiseRevenueExVat,
        serviceRevenueExVat: coverage.serviceRevenueExVat,
        unclassifiedBundleRevenueExVat: coverage.unclassifiedBundleRevenueExVat,
        unclassifiedRevenueExVat: coverage.unclassifiedRevenueExVat,
      },
      productLinkCoverage: coverage.lines ? coverage.linkedLines / coverage.lines : 0,
      bundleRule: "Bundle headers carry revenue; bundle components carry physical units. Header revenue is classified as physical or service only when every resolvable component agrees; mixed or unresolved bundles remain explicitly unclassified.",
      classificationLimitation: "Decoration and setup charges are not split separately. Lines without a resolvable product are unclassified. Customer-specific bespoke products are combined under a neutral label.",
      revenueDefinition: COMMERCE_REVENUE_DEFINITION,
    });
  } catch (e) { fail(res, e); }
});

mayaV1.get("/analytics/commerce/categories", async (req, res) => {
  try {
    const d = commerceWindow(req.query);
    const [result, historyStart] = await Promise.all([
      db.execute(sql`
        WITH line_metrics AS (
          SELECT o.id AS order_id,o.customer_id,
            CASE WHEN jsonb_typeof(p.product_category_ids)='array' AND jsonb_array_length(p.product_category_ids)>0
              THEN (p.product_category_ids->>0)::int ELSE NULL END AS primary_category_id,
            CASE WHEN p.is_service=false AND (oi.bundle_ref IS NULL OR oi.is_bundle_header IS NOT TRUE) THEN oi.quantity ELSE 0 END AS physical_units,
            CASE WHEN (p.is_service=false OR ${PHYSICAL_BUNDLE_HEADER}) AND NOT (oi.bundle_ref IS NOT NULL AND oi.is_bundle_header IS NOT TRUE) THEN oi.line_total ELSE 0 END AS revenue
          FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN products p ON p.id=oi.product_id
          WHERE o.status NOT IN ('cancelled','draft','portal_draft','archived')${d.clause}
        ), resolved AS (
          SELECT lm.*,pc.woo_id,pc.name,
            CASE WHEN pc.woo_id IS NULL THEN false ELSE true END AS categorised
          FROM line_metrics lm LEFT JOIN product_categories pc ON pc.woo_id=lm.primary_category_id
          WHERE lm.physical_units<>0 OR lm.revenue<>0
        ), grouped AS (
          SELECT woo_id AS "categoryId",coalesce(name,'Uncategorised') AS "categoryName",
            coalesce(sum(physical_units),0)::int AS "physicalUnits",
            coalesce(sum(revenue),0)::numeric AS "merchandiseRevenueExVat",
            count(DISTINCT order_id)::int AS orders,
            count(DISTINCT customer_id)::int AS "uniqueCustomers",
            bool_or(categorised) AS categorised
          FROM resolved GROUP BY woo_id,name
        ), metadata AS (
          SELECT count(*)::int AS "totalRows",
            coalesce(sum("physicalUnits"),0)::numeric AS "allUnits",
            coalesce(sum("physicalUnits") FILTER (WHERE categorised),0)::numeric AS "categorisedUnits",
            coalesce(sum("merchandiseRevenueExVat"),0)::numeric AS "allRevenue",
            coalesce(sum("merchandiseRevenueExVat") FILTER (WHERE categorised),0)::numeric AS "categorisedRevenue"
          FROM grouped
        ), paged AS (
          SELECT * FROM grouped ORDER BY "merchandiseRevenueExVat" DESC,"categoryName"
          LIMIT ${d.limit} OFFSET ${d.offset}
        )
        SELECT paged.*,metadata.* FROM metadata LEFT JOIN paged ON true`),
      commerceHistoryStart(),
    ]);
    const raw = rows(result);
    const items = raw.filter((item) => item.categoryName != null).map((item) => {
      const mapped = numericRecord(item, ["physicalUnits","merchandiseRevenueExVat","orders","uniqueCustomers"]);
      return {
        categoryId: mapped.categoryId ?? null,
        categoryName: mapped.categoryName,
        physicalUnits: mapped.physicalUnits,
        merchandiseRevenueExVat: mapped.merchandiseRevenueExVat,
        orders: mapped.orders,
        uniqueCustomers: mapped.uniqueCustomers,
      };
    });
    const total = Number(raw[0]?.totalRows ?? 0);
    const allUnits = Number(raw[0]?.allUnits ?? 0), categorisedUnits = Number(raw[0]?.categorisedUnits ?? 0);
    const allRevenue = Number(raw[0]?.allRevenue ?? 0), categorisedRevenue = Number(raw[0]?.categorisedRevenue ?? 0);
    ok(res, {
      available: true,
      filters: { from: d.from ?? null, to: d.to ?? null, excludedStatuses: COMMERCE_EXCLUDED_STATUSES },
      availableHistoryStartDate: historyStart,
      page: d.page, limit: d.limit, total, nextPage: d.offset + items.length < total ? d.page + 1 : null,
      items,
      coverage: {
        units: allUnits ? categorisedUnits / allUnits : 0,
        revenue: allRevenue ? categorisedRevenue / allRevenue : 0,
        uncategorisedUnits: allUnits - categorisedUnits,
        uncategorisedRevenueExVat: allRevenue - categorisedRevenue,
      },
      primaryCategoryRule: COMMERCE_PRIMARY_CATEGORY_RULE,
      revenueDefinition: COMMERCE_REVENUE_DEFINITION,
    });
  } catch (e) { fail(res, e); }
});

mayaV1.get("/analytics/commerce/order-role", async (req, res) => {
  try {
    const d = commerceWindow(req.query);
    const [roleResult, concentrationResult, historyStart] = await Promise.all([
      db.execute(sql`
        WITH order_merchandise AS (
          SELECT o.id,o.customer_id,o.order_date,o.created_at,
            coalesce(sum(CASE WHEN (p.is_service=false OR ${PHYSICAL_BUNDLE_HEADER}) AND NOT (oi.bundle_ref IS NOT NULL AND oi.is_bundle_header IS NOT TRUE) THEN oi.line_total ELSE 0 END),0)::numeric AS merchandise_revenue
          FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id LEFT JOIN products p ON p.id=oi.product_id
          WHERE o.status NOT IN ('cancelled','draft','portal_draft','archived') AND o.customer_id IS NOT NULL
          GROUP BY o.id,o.customer_id,o.order_date,o.created_at
        ), ranked AS (
          SELECT o.*,
            row_number() OVER (PARTITION BY o.customer_id ORDER BY o.order_date,o.id) AS known_order_number
          FROM order_merchandise o
        )
        SELECT CASE WHEN known_order_number=1 THEN 'first_known' ELSE 'repeat_within_stored_history' END AS role,
          count(*)::int AS orders,count(DISTINCT customer_id)::int AS customers,
          coalesce(sum(merchandise_revenue),0)::numeric AS "merchandiseRevenueExVat"
        FROM ranked o WHERE true${d.clause}
        GROUP BY 1 ORDER BY 1`),
      db.execute(sql`
        WITH selected_orders AS (
          SELECT o.id,o.customer_id,
            coalesce(sum(CASE WHEN (p.is_service=false OR ${PHYSICAL_BUNDLE_HEADER}) AND NOT (oi.bundle_ref IS NOT NULL AND oi.is_bundle_header IS NOT TRUE) THEN oi.line_total ELSE 0 END),0)::numeric AS merchandise_revenue
          FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id LEFT JOIN products p ON p.id=oi.product_id
          WHERE o.status NOT IN ('cancelled','draft','portal_draft','archived') AND o.customer_id IS NOT NULL${d.clause}
          GROUP BY o.id,o.customer_id
        ), selected AS (
          SELECT customer_id,sum(merchandise_revenue)::numeric AS revenue,count(*)::int AS orders
          FROM selected_orders GROUP BY customer_id
        ), ranked AS (
          SELECT *,row_number() OVER (ORDER BY revenue DESC,customer_id) AS rank,count(*) OVER() AS customers,
            sum(revenue) OVER() AS total_revenue
          FROM selected
        )
        SELECT count(*)::int AS "linkedCustomers",
          count(*) FILTER (WHERE orders=1)::int AS "oneOrderCustomers",
          count(*) FILTER (WHERE orders>1)::int AS "multiOrderCustomers",
          coalesce(sum(revenue) FILTER (WHERE rank<=greatest(1,ceil(customers*0.01))),0)::numeric / nullif(max(total_revenue),0) AS "topOnePercentRevenueShare",
          coalesce(sum(revenue) FILTER (WHERE rank<=greatest(1,ceil(customers*0.05))),0)::numeric / nullif(max(total_revenue),0) AS "topFivePercentRevenueShare",
          coalesce(sum(revenue) FILTER (WHERE rank<=greatest(1,ceil(customers*0.10))),0)::numeric / nullif(max(total_revenue),0) AS "topTenPercentRevenueShare"
        FROM ranked`),
      commerceHistoryStart(),
    ]);
    const roles = rows(roleResult).map((item) => numericRecord(item, ["orders","customers","merchandiseRevenueExVat"]));
    const concentration = numericRecord(rows(concentrationResult)[0] ?? {}, ["linkedCustomers","oneOrderCustomers","multiOrderCustomers","topOnePercentRevenueShare","topFivePercentRevenueShare","topTenPercentRevenueShare"]);
    ok(res, {
      available: true,
      filters: { from: d.from ?? null, to: d.to ?? null, excludedStatuses: COMMERCE_EXCLUDED_STATUSES },
      availableHistoryStartDate: historyStart,
      roles,
      customerConcentration: concentration,
      customerMatching: "Orders are linked internally only by non-null customer_id. No customer identifiers or PII are returned.",
      historyLimitation: COMMERCE_HISTORY_LIMITATION,
      revenueDefinition: COMMERCE_REVENUE_DEFINITION,
    });
  } catch (e) { fail(res, e); }
});

mayaV1.get("/analytics/commerce/refunds-cancellations", async (req, res) => {
  try {
    const d = commerceWindow(req.query);
    const [cancelledResult, normalResult, historyStart] = await Promise.all([
      db.execute(sql`
        SELECT count(DISTINCT o.id)::int AS "cancelledOrders",
          coalesce(sum(CASE WHEN (p.is_service=false OR ${PHYSICAL_BUNDLE_HEADER}) AND NOT (oi.bundle_ref IS NOT NULL AND oi.is_bundle_header IS NOT TRUE) THEN oi.line_total ELSE 0 END),0)::numeric AS "cancelledMerchandiseValueExVat",
          coalesce(sum(CASE WHEN p.is_service=false AND (oi.bundle_ref IS NULL OR oi.is_bundle_header IS NOT TRUE) THEN oi.quantity ELSE 0 END),0)::int AS "cancelledPhysicalUnits"
        FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id LEFT JOIN products p ON p.id=oi.product_id
        WHERE o.status='cancelled'${d.clause}`),
      db.execute(sql`
        SELECT count(DISTINCT o.id)::int AS orders,
          coalesce(sum(CASE WHEN (p.is_service=false OR ${PHYSICAL_BUNDLE_HEADER}) AND NOT (oi.bundle_ref IS NOT NULL AND oi.is_bundle_header IS NOT TRUE) THEN oi.line_total ELSE 0 END),0)::numeric AS "merchandiseRevenueExVat"
        FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id LEFT JOIN products p ON p.id=oi.product_id
        WHERE o.status NOT IN ('cancelled','draft','portal_draft','archived')${d.clause}`),
      commerceHistoryStart(),
    ]);
    const cancelled = numericRecord(rows(cancelledResult)[0] ?? {}, ["cancelledOrders","cancelledMerchandiseValueExVat","cancelledPhysicalUnits"]);
    const normal = numericRecord(rows(normalResult)[0] ?? {}, ["orders","merchandiseRevenueExVat"]);
    const orderDenominator = normal.orders + cancelled.cancelledOrders;
    const valueDenominator = normal.merchandiseRevenueExVat + cancelled.cancelledMerchandiseValueExVat;
    ok(res, {
      available: true,
      filters: { from: d.from ?? null, to: d.to ?? null },
      availableHistoryStartDate: historyStart,
      cancellations: {
        ...cancelled,
        shareOfOrders: orderDenominator ? cancelled.cancelledOrders / orderDenominator : 0,
        shareOfMerchandiseValue: valueDenominator ? cancelled.cancelledMerchandiseValueExVat / valueDenominator : 0,
        timestampAvailable: false,
        limitation: "Cancellation is the order's current status. No cancellation date or reason is stored.",
      },
      refundDataAvailable: false,
      refunds: null,
      refundLimitation: "No local refund or credit transactions are stored. Refunds are never inferred from cancellation, payment or invoice status.",
      revenueDefinition: COMMERCE_REVENUE_DEFINITION,
    });
  } catch (e) { fail(res, e); }
});
mayaV1.get("/analytics/search-console", async (req, res) => {
  try {
    const input = searchConsoleQuery.parse(req.query);
    const to = input.to ?? new Date().toISOString().slice(0, 10);
    const from = input.from ?? new Date(Date.now() - 27 * 86_400_000).toISOString().slice(0, 10);
    const dimensions = [...searchConsoleDimensions[input.view]];
    const { accessToken, verification } = await searchConsoleAccess();
    const response = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(verification.property)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: from,
          endDate: to,
          dimensions,
          type: "web",
          aggregationType: "auto",
          startRow: (input.page - 1) * input.limit,
          rowLimit: input.limit,
        }),
      },
    );
    if (!response.ok) throw new Error("Search Console query failed");
    const result = await response.json() as {
      rows?: Array<{ keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }>;
      responseAggregationType?: string;
    };
    const items = (result.rows ?? []).map((row) => {
      const values = Object.fromEntries(dimensions.map((dimension, index) => [dimension, row.keys?.[index] ?? null]));
      return {
        query: values.query ?? null,
        page: values.page ?? null,
        date: values.date ?? null,
        clicks: Number(row.clicks ?? 0),
        impressions: Number(row.impressions ?? 0),
        ctr: Number(row.ctr ?? 0),
        averagePosition: Number(row.position ?? 0),
      };
    });
    ok(res, {
      available: true,
      connectionStatus: "connected",
      property: verification.property,
      permissionLevel: verification.permissionLevel,
      scope: SEARCH_CONSOLE_READONLY_SCOPE,
      filters: { from, to, searchType: "web" },
      view: input.view,
      dimensions,
      page: input.page,
      limit: input.limit,
      items,
      nextPage: items.length === input.limit ? input.page + 1 : null,
      responseAggregationType: result.responseAggregationType ?? null,
      limitations: "Google Search Console retains a limited history and may omit low-volume anonymised queries.",
    });
  } catch (error) {
    fail(res, error);
  }
});

mayaV1.get("/products", async (req, res) => { try { const { limit, offset } = page(req); const r = await db.execute(sql`SELECT id,name,lower(regexp_replace(name,'[^a-zA-Z0-9]+','-','g')) AS slug,CASE WHEN website_published THEN 'published' ELSE 'draft' END AS status,category,description,image_url AS "imageUrl",created_at AS "createdAt",updated_at AS "updatedAt" FROM products WHERE is_archived=false ORDER BY id LIMIT ${limit} OFFSET ${offset}`); ok(res, { page: Math.floor(offset / limit) + 1, limit, items: rows(r).map(p => ({ ...p, url: `/product/${p.slug}`, metaTitle: null, metaDescription: null, h1: null, images: p.imageUrl ? [{ url: p.imageUrl, altText: null }] : [], canonicalUrl: null })) }); } catch (e) { fail(res, e); } });
mayaV1.get("/products/:id", async (req, res) => { try { const r = await db.execute(sql`SELECT id,name,category,description,image_url AS "imageUrl",website_published,created_at AS "createdAt",updated_at AS "updatedAt" FROM products WHERE id=${Number(req.params.id)} AND is_archived=false`); const p = rows(r)[0]; if (!p) { res.status(404).json({ error: "Product not found" }); return; } ok(res, { ...p, status: p.website_published ? "published" : "draft", seo: { metaTitle: null, metaDescription: null, h1: null, canonicalUrl: null }, images: p.imageUrl ? [{ url: p.imageUrl, altText: null }] : [] }); } catch (e) { fail(res, e); } });
mayaV1.get("/categories", async (req, res) => { try { const { limit, offset } = page(req); const r = await db.execute(sql`SELECT id,name,slug,product_count AS "productCount",parent_woo_id AS "parentId" FROM product_categories ORDER BY id LIMIT ${limit} OFFSET ${offset}`); ok(res, { page: Math.floor(offset / limit) + 1, limit, items: rows(r).map(c => ({ ...c, url: `/category/${c.slug ?? c.id}`, description: null, metaTitle: null, metaDescription: null, h1: null, canonicalUrl: null })) }); } catch (e) { fail(res, e); } });

const routeManifest = [{ id: "home", url: "/", slug: null, pageType: "home" }, { id: "products", url: "/products", slug: null, pageType: "listing" }, { id: "categories", url: "/category/:slug", slug: ":slug", pageType: "category" }, { id: "products-detail", url: "/product/:slug", slug: ":slug", pageType: "product" }, ...["about","contact","faq","bulk-buy-bundles","reviews","knowledge-centre","personalisation","on-site-measuring","uniform-management","order-workwear","logo-conversions","terms","privacy","cookie-policy"].map(x => ({ id: x, url: `/${x}`, slug: null, pageType: "page" }))];
mayaV1.get("/pages", (req, res) => { try { const { limit, offset } = page(req); ok(res, { page: Math.floor(offset / limit) + 1, limit, total: routeManifest.length, items: routeManifest.slice(offset, offset + limit).map(x => ({ ...x, title: null, h1: null, content: null, metaTitle: null, metaDescription: null, canonical: null, published: true, createdDate: null, modifiedDate: null, fieldAvailability: ["url","slug","pageType","published"], limitations: "SPA route manifest; page-specific rendered SEO fields are not authoritative in the server." })) }); } catch (e) { fail(res, e); } });
mayaV1.get("/articles", async (req, res) => { try { const { limit, offset } = page(req); const articles = await fetchKnowledgeBaseRss(); ok(res, { page: Math.floor(offset / limit) + 1, limit, total: articles.length, items: articles.slice(offset, offset + limit).map(a => ({ id: a.id, url: a.link, title: a.title, content: a.content, excerpt: a.excerpt, publishedDate: a.date, modifiedDate: a.date, metaTitle: null, metaDescription: null })) }); } catch (e) { fail(res, e); } });

const customerHistoryQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  customerId: z.coerce.number().int().positive().optional(),
}).strict();
const historyQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  customerId: z.coerce.number().int().positive().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
}).strict().superRefine((v, c) => { if (v.from && v.to && v.from > v.to) c.addIssue({ code: "custom", message: "from must not be after to", path: ["from"] }); });
function historyWindow(q: Record<string, unknown>) {
  const d = historyQuery.parse(q);
  const dates = d.from && d.to ? sql` AND o.order_date >= ${d.from}::date AND o.order_date < (${d.to}::date + interval '1 day')` :
    d.from ? sql` AND o.order_date >= ${d.from}::date` : d.to ? sql` AND o.order_date < (${d.to}::date + interval '1 day')` : sql``;
  return { ...d, offset: (d.page - 1) * d.limit, dates };
}
function customerWindow(q: Record<string, unknown>) {
  const d = customerHistoryQuery.parse(q);
  return { ...d, offset: (d.page - 1) * d.limit };
}

mayaV1.get("/customers", async (req, res) => {
  try {
    const d = customerWindow(req.query);
    const customerFilter = d.customerId ? sql` AND c.id=${d.customerId}` : sql``;
    const [r, countResult] = await Promise.all([db.execute(sql`
      WITH qualifying AS (
        SELECT o.customer_id, min(o.order_date)::date AS first_order_date, max(o.order_date)::date AS last_order_date, count(*)::int AS order_count
        FROM orders o WHERE o.status NOT IN ('draft','portal_draft','portal_pending','archived') AND o.customer_id IS NOT NULL
        GROUP BY o.customer_id
      )
        SELECT c.id AS "customerId", c.name AS "businessName", c.email, c.billing_email AS "billingEmail", c.phone AS telephone,
          c.portal_suspended AS "portalSuspended",
          CASE WHEN c.portal_suspended THEN 'portal_suspended' ELSE 'active' END AS "accountStatus",
          'customers.portal_suspended' AS "statusBasis",
          q.first_order_date AS "firstOrderDate", q.last_order_date AS "lastOrderDate", coalesce(q.order_count,0)::int AS "totalOrderCount"
        FROM customers c LEFT JOIN qualifying q ON q.customer_id=c.id
        WHERE true${customerFilter}
      ORDER BY "customerId" ASC LIMIT ${d.limit} OFFSET ${d.offset}`), db.execute(sql`SELECT count(*)::int AS total FROM customers c WHERE true${customerFilter}`)]);
    const items = rows(r).map((x) => ({ ...x, customerId: Number(x.customerId), portalSuspended: Boolean(x.portalSuspended), totalOrderCount: Number(x.totalOrderCount) }));
    const total = Number(rows(countResult)[0]?.total ?? 0);
    ok(res, { available: true, page: d.page, limit: d.limit, total, nextPage: d.page * d.limit < total ? d.page + 1 : null, pagination: { orderBy: "id_asc" }, filters: { customerId: d.customerId ?? null, excludedStatuses: HISTORY_EXCLUDED_STATUSES }, items, limitations: HISTORY_LIMITATION });
  } catch (e) { fail(res, e); }
});

mayaV1.get("/orders", async (req, res) => {
  try {
    const d = historyWindow(req.query);
    const customerFilter = d.customerId ? sql` AND o.customer_id=${d.customerId}` : sql``;
    const [r, countResult] = await Promise.all([db.execute(sql`
      WITH line_values AS (
        SELECT oi.order_id,
          coalesce(sum(CASE
            WHEN oi.is_bundle_header=true AND ${PHYSICAL_BUNDLE_HEADER} THEN oi.line_total
            WHEN oi.is_bundle_header IS NOT TRUE AND oi.bundle_ref IS NULL AND p.is_service=false THEN oi.line_total
            ELSE 0 END),0)::numeric AS merchandise,
          coalesce(sum(CASE
            WHEN oi.is_bundle_header=true AND ${SERVICE_BUNDLE_HEADER} THEN oi.line_total
            WHEN oi.is_bundle_header IS NOT TRUE AND oi.bundle_ref IS NULL AND p.is_service=true THEN oi.line_total
            ELSE 0 END),0)::numeric AS service,
          coalesce(sum(CASE
            WHEN oi.is_bundle_header=true AND NOT ${PHYSICAL_BUNDLE_HEADER} AND NOT ${SERVICE_BUNDLE_HEADER} THEN oi.line_total
            WHEN oi.is_bundle_header IS NOT TRUE AND oi.bundle_ref IS NULL AND p.id IS NULL THEN oi.line_total
            ELSE 0 END),0)::numeric AS unclassified
        FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id GROUP BY oi.order_id
      ), selected AS (
        SELECT o.id AS "orderId", o.order_number AS "orderNumber", o.customer_id AS "customerId",
          coalesce(c.name, CASE WHEN c.id IS NULL THEN o.customer_name ELSE NULL END) AS "customerName",
          o.order_date AS "orderDate", o.status, (o.status='cancelled') AS "isCancelled",
          coalesce(l.merchandise,0)::numeric AS "merchandiseExVat", coalesce(l.service,0)::numeric AS "serviceExVat",
          coalesce(l.unclassified,0)::numeric AS "unclassifiedExVat", coalesce(o.carriage_amount,0)::numeric AS "carriageExVat",
          (coalesce(l.merchandise,0)+coalesce(l.service,0)+coalesce(l.unclassified,0)+coalesce(o.carriage_amount,0))::numeric AS "totalExVat"
        FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN line_values l ON l.order_id=o.id
        WHERE o.status NOT IN ('draft','portal_draft','portal_pending','archived')${customerFilter}${d.dates}
      )
      SELECT * FROM selected ORDER BY "orderId" ASC LIMIT ${d.limit} OFFSET ${d.offset}`), db.execute(sql`SELECT count(*)::int AS total FROM orders o WHERE o.status NOT IN ('draft','portal_draft','portal_pending','archived')${customerFilter}${d.dates}`)]);
    const fields = ["merchandiseExVat", "serviceExVat", "unclassifiedExVat", "carriageExVat", "totalExVat"];
    const items = rows(r).map((x) => {
      const item: any = {
        ...x,
        orderId: Number(x.orderId),
        customerId: x.customerId == null ? null : Number(x.customerId),
        orderDate: new Date(x.orderDate).toISOString(),
        isCancelled: Boolean(x.isCancelled),
        refundDataAvailable: false,
        refundedExVat: null,
      };
      for (const f of fields) item[f] = Number(x[f] ?? 0);
      return item;
    });
    const total = Number(rows(countResult)[0]?.total ?? 0);
    ok(res, { available: true, page: d.page, limit: d.limit, total, nextPage: d.page * d.limit < total ? d.page + 1 : null, pagination: { orderBy: "id_asc" }, filters: { customerId: d.customerId ?? null, from: d.from ?? null, to: d.to ?? null, excludedStatuses: HISTORY_EXCLUDED_STATUSES }, items, limitations: HISTORY_LIMITATION, revenueDefinition: HISTORY_REVENUE_DEFINITION, refundDataAvailable: false });
  } catch (e) { fail(res, e); }
});

mayaV1.get("/analytics/orders", async (req, res) => { try { const d = dateSql(req.query); const base = sql`o.status NOT IN ('draft','portal_draft','portal_pending','cancelled','archived')${d.clause}`; const [daily, products, categories, kinds, frequency] = await Promise.all([
  db.execute(sql`SELECT date_trunc('day',o.order_date)::date AS date,count(*)::int AS orders,coalesce(sum(o.total_amount),0)::numeric AS revenue,coalesce(avg(o.total_amount),0)::numeric AS aov FROM orders o WHERE ${base} GROUP BY 1 ORDER BY 1`),
  db.execute(sql`SELECT oi.product_id AS "productId",oi.product_name AS "productName",sum(oi.quantity)::int AS "unitsSold" FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE ${base} GROUP BY 1,2 ORDER BY "unitsSold" DESC LIMIT 1000`),
  db.execute(sql`SELECT p.category,sum(oi.quantity)::int AS "unitsSold" FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN products p ON p.id=oi.product_id WHERE ${base} AND p.category IS NOT NULL GROUP BY p.category ORDER BY "unitsSold" DESC`),
  db.execute(sql`WITH x AS (SELECT o.customer_id,row_number() OVER (PARTITION BY o.customer_id ORDER BY o.order_date,o.id) AS n FROM orders o WHERE ${base} AND o.customer_id IS NOT NULL) SELECT CASE WHEN n=1 THEN 'first' ELSE 'repeat' END AS type,count(*)::int AS orders FROM x GROUP BY 1`),
  db.execute(sql`WITH x AS (SELECT o.customer_id,count(*) n FROM orders o WHERE ${base} AND o.customer_id IS NOT NULL GROUP BY o.customer_id) SELECT n AS orders,count(*)::int AS customers FROM x GROUP BY n ORDER BY n`),
 ]); ok(res, { available: true, filters: { from: d.from ?? null, to: d.to ?? null, excludedStatuses }, daily: rows(daily), productsSold: rows(products), categoriesSold: rows(categories), firstVsRepeat: rows(kinds), orderFrequency: rows(frequency), customerDetails: "intentionally omitted" }); } catch (e) { fail(res, e); } });
mayaV1.get("/analytics/customers", async (req, res) => { try { const d = dateSql(req.query); const base = sql`o.status NOT IN ('draft','portal_draft','portal_pending','cancelled','archived')${d.clause}`; const r = await db.execute(sql`WITH ordered AS (SELECT o.customer_id,o.order_date,lag(o.order_date) OVER (PARTITION BY o.customer_id ORDER BY o.order_date,o.id) AS previous_order FROM orders o WHERE ${base} AND o.customer_id IS NOT NULL), per_customer AS (SELECT customer_id,count(*)::int AS n,avg(order_date-previous_order) FILTER (WHERE previous_order IS NOT NULL) AS average_gap FROM ordered GROUP BY customer_id) SELECT count(*) FILTER(WHERE n=1)::int AS "newCustomers",count(*) FILTER(WHERE n>1)::int AS "repeatCustomers",count(*)::int AS "customers",coalesce(sum(n),0)::int AS "orders",avg(average_gap) AS "averageTimeBetweenOrders" FROM per_customer`); const x=rows(r)[0]??{}; ok(res, { available:true, filters:{from:d.from??null,to:d.to??null,excludedStatuses}, newCustomers:x.newCustomers??0, repeatCustomers:x.repeatCustomers??0, repeatPurchaseRate:x.customers ? Number(x.repeatCustomers??0)/Number(x.customers) : 0, averageOrdersPerCustomer:x.customers ? Number(x.orders??0)/Number(x.customers) : 0, averageTimeBetweenOrders:x.averageTimeBetweenOrders??null, limitations:"New means one qualifying order in the selected period; repeat means more than one. Customers are identified only by customer_id, and no PII is returned." }); } catch(e) { fail(res,e); } });
mayaV1.get("/analytics", async (req,res) => { try { const d=dateSql(req.query); const base=sql`o.status NOT IN ('draft','portal_draft','portal_pending','cancelled','archived')${d.clause}`; const [daily,summary]=await Promise.all([db.execute(sql`SELECT date_trunc('day',o.order_date)::date AS date,count(*)::int AS orders,coalesce(sum(o.total_amount),0)::numeric AS revenue,coalesce(avg(o.total_amount),0)::numeric AS aov FROM orders o WHERE ${base} GROUP BY 1 ORDER BY 1`),db.execute(sql`SELECT count(*)::int AS orders,count(DISTINCT o.customer_id)::int AS customers,count(DISTINCT o.customer_id) FILTER(WHERE o.customer_id IS NOT NULL AND o.customer_id IN(SELECT customer_id FROM orders WHERE customer_id IS NOT NULL GROUP BY customer_id HAVING count(*)>1))::int AS repeat_customers FROM orders o WHERE ${base}`)]); ok(res,{available:true,filters:{from:d.from??null,to:d.to??null,excludedStatuses},orders:{daily:rows(daily)},customers:rows(summary)[0]??{}}); } catch(e){fail(res,e);} });
mayaV1.get(["/integration/status", "/integration-status"], async (_req,res) => {
  try {
    const [storedSuccess, storedFailure, writeEnabled] = await Promise.all([stored("maya_last_successful_request"), stored("maya_last_failed_request"), writeAccessEnabled()]);
    ok(res, { connectionEnabled: Boolean(process.env.MAYA_API_KEY), readApiEnabled: Boolean(process.env.MAYA_API_KEY), writeApiEnabled: writeEnabled, lastApiRequest: lastRequest, lastSuccessfulRequest: lastSuccessful ?? storedSuccess, lastFailedRequest: lastFailed ?? storedFailure, apiVersion: "v1", availableCapabilities: capabilities(), credentialControlsWrite: false, webhook: { configured: false } });
  } catch(e) { fail(res,e); }
});
const webhookEvents = ["ORDER_COMPLETED","NEW_CUSTOMER","REPEAT_CUSTOMER_ORDER","PRODUCT_CREATED","PRODUCT_UPDATED","ARTICLE_PUBLISHED","PAGE_UPDATED"];
mayaV1.get("/webhooks", (_req,res) => { ok(res, { configured:false, deliveryStatus:"not_configured", direction:"future outbound", events:webhookEvents, payloadPolicy:"Aggregated event metadata only; no names, emails, addresses or phone numbers.", authentication:"No signing or delivery is enabled.", transmits:false }); });
mayaV1.get("/webhook-contract", (_req,res) => { ok(res, { configured:false, deliveryStatus:"not_configured", direction:"future outbound", events:webhookEvents, payloadPolicy:"Aggregated event metadata only; no names, emails, addresses or phone numbers.", authentication:"No signing or delivery is enabled.", transmits:false }); });

mayaV1.get("/internal-links", async (req,res) => {
  try {
    const { limit, offset } = page(req); const articles = await fetchKnowledgeBaseRss(); const links: any[] = [];
    for (const a of articles) {
      const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
      while ((m = re.exec(a.content))) { try { const dest = new URL(m[1], a.link); const source = new URL(a.link); if (dest.hostname === source.hostname) links.push({ source: a.link, destination: dest.toString(), anchorText: m[2].replace(/<[^>]+>/g,"").replace(/\s+/g," ").trim(), scope:"knowledge-centre article HTML" }); } catch { /* ignore malformed author HTML */ } }
    }
    ok(res,{ page:Math.floor(offset/limit)+1, limit, total:links.length, items:links.slice(offset,offset+limit), scope:"Only authoritative Knowledge Centre RSS article HTML links are calculable." });
  } catch(e) { fail(res,e); }
});
mayaV1.get("/site-health", async (_req,res) => {
  try {
    const articles = await fetchKnowledgeBaseRss(); const titleCounts = new Map<string, number>();
    for (const a of articles) titleCounts.set(a.title, (titleCounts.get(a.title) ?? 0)+1);
    const duplicateTitles = articles.filter(a => (titleCounts.get(a.title) ?? 0)>1).map(a => ({ url:a.link, title:a.title }));
    ok(res,{ available:true, scope:"Knowledge Centre RSS article records only", checks:{ missingTitles:articles.filter(a=>!a.title).map(a=>a.link), duplicateTitles, missingContent:articles.filter(a=>!a.content).map(a=>a.link) }, unavailable:[{ check:"brokenInternalLinks", reason:"No crawler or link verifier is available." },{ check:"redirects",reason:"Redirect responses are not exposed by authoritative records." },{ check:"metaDescriptions",reason:"RSS does not contain page meta descriptions." },{ check:"h1s",reason:"RSS content is not a rendered page." },{ check:"imageAltText",reason:"Rendered image attributes are unavailable." },{ check:"canonicalIssues",reason:"Canonical metadata is unavailable." },{ check:"orphanPages",reason:"Complete site graph is unavailable." },{ check:"schemaIssues",reason:"Rendered schema is unavailable." }] });
  } catch(e) { fail(res,e); }
});
mayaV1.post("/webhooks/events", (req,res) => { const parsed=z.object({event:z.enum(webhookEvents as [string,...string[]]),occurredAt:z.string().datetime({offset:true}),objectId:z.string().max(100).optional(),data:z.record(z.string(),z.unknown()).default({})}).strict().safeParse(req.body); if(!parsed.success){res.status(400).json({error:"Invalid webhook event structure"});return;} res.status(202).json({accepted:false,configured:false,event:parsed.data.event,occurredAt:parsed.data.occurredAt}); });
for (const path of ["/products/:id/seo","/pages/:id/seo","/pages/:id/content"]) mayaV1.patch(path, async (_req,res) => { if(!(await writeAccessEnabled())){res.status(423).json({error:"Maya write access is disabled"});return;} res.status(501).json({error:"This v1 write adapter is not available", existingWorkflow:{preview:"POST /api/maya-seo/preview",staffApproval:"POST /api/maya-seo/approve",apply:"POST /api/maya-seo/apply"}}); });
mayaV1.post("/drafts/pages", (_req,res)=>res.status(501).json({error:"Draft pages are not supported by the current CMS"}));
mayaV1.post("/drafts/articles", (_req,res)=>res.status(501).json({error:"Draft articles are not supported by the current CMS"}));
router.use("/maya/v1", mayaV1);
export default router;