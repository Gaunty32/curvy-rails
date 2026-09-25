import { Router, type Request } from "express";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { and, eq, gte, desc, ne, sql } from "drizzle-orm";
import { db, callbackRequestsTable, settingsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import {
  defaultCallbackHours,
  isCallbackRateLimited,
  isOpenAt,
  londonMidnight,
  normalisePhone,
  parseHours,
  type CallbackHours,
} from "../lib/callback.js";
import { upsertHighLevelContact, addHighLevelWorkflow } from "../lib/highlevel-callback.js";

const router = Router();
const SOURCE = "Website Callback";
const setting = async (key: string) => (await db.select().from(settingsTable).where(eq(settingsTable.key,key)))[0]?.value;
function originAllowed(req: Request) {
  const origin = req.get("origin");
  if (!origin) return true;
  try {
    if (new URL(origin).host === req.get("host")) return true;
  } catch {
    return false;
  }
  const configured = (process.env.ALLOWED_ORIGINS ?? "").split(",").map(x=>x.trim()).filter(Boolean);
  return configured.includes(origin) || (process.env.NODE_ENV !== "production" && /^https:\/\/[a-z0-9-]+\.replit\.dev$/i.test(origin));
}
function clientIp(req: Request) { return req.ip || req.socket.remoteAddress || "unknown"; }
async function businessOpen(now = new Date()) {
  const configured = await setting("callback_hours");
  let hours: CallbackHours = defaultCallbackHours;
  if (configured) {
    try {
      const parsed = parseHours(JSON.parse(configured));
      const legacyDefault = Object.entries(parsed).every(([day, value]) =>
        day === "saturday" || day === "sunday"
          ? value === null
          : value?.open === "09:30" && value?.close === "16:00"
      );
      hours = legacyDefault ? defaultCallbackHours : parsed;
    } catch { /* safe defaults */ }
  }
  return isOpenAt(now, hours);
}
function staff(req: Request) {
  const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
  const secret = process.env.PORTAL_JWT_SECRET;
  if (!secret || secret.length < 32) return null;
  try { return jwt.verify(token, secret) as { role?: string }; } catch { return null; }
}
function clean(value: unknown, max=500) { return typeof value === "string" ? value.trim().slice(0,max) || null : null; }
async function limits() {
  const value = await setting("callback_limits");
  if (value) { try { const parsed = JSON.parse(value); return {ip:Number(parsed.ip),phone:Number(parsed.phone)}; } catch {} }
  return {ip:Number(process.env.CALLBACK_IP_LIMIT ?? 5), phone:Number(process.env.CALLBACK_PHONE_LIMIT ?? 3)};
}
type CallbackRequestLog = {
  error: (obj: object, msg: string) => void;
  info: (obj: object, msg: string) => void;
};
async function sendHighLevel(row: typeof callbackRequestsTable.$inferSelect, requestLog: CallbackRequestLog) {
  const attemptAt = new Date();
  await db.update(callbackRequestsTable).set({ highlevelAttemptCount: sql`coalesce(${callbackRequestsTable.highlevelAttemptCount}, 0) + 1`, highlevelLastAttemptAt: attemptAt }).where(eq(callbackRequestsTable.id,row.id));
  try {
    const normalisedFromSubmittedPhone = normalisePhone(row.phone);
    if (!normalisedFromSubmittedPhone || normalisedFromSubmittedPhone !== row.phoneNormalised) {
      const error = "Callback phone integrity check failed; HighLevel handoff was blocked";
      requestLog.error({
        callbackRequestId: row.callbackRequestId,
        submitted_phone: row.phone,
        normalised_phone: normalisedFromSubmittedPhone,
        phone_sent_to_highlevel: null,
      }, error);
      await db.update(callbackRequestsTable).set({
        status: "highlevel_failed",
        highlevelContactSucceeded: false,
        highlevelContactError: error,
        highlevelWorkflowStatus: "not_attempted",
        errorMessage: error,
      }).where(eq(callbackRequestsTable.id,row.id));
      return false;
    }
    requestLog.info({
      callbackRequestId: row.callbackRequestId,
      submitted_phone: row.phone,
      normalised_phone: normalisedFromSubmittedPhone,
      phone_sent_to_highlevel: normalisedFromSubmittedPhone,
    }, "HighLevel callback phone trace");

    let contactId = row.highlevelContactId;
    if (!contactId) {
      const contact = await upsertHighLevelContact(normalisedFromSubmittedPhone, row);
      const contactLog = {
        callbackRequestId: row.callbackRequestId,
        step: "highlevel_contact_upsert",
        httpStatus: contact.status,
        succeeded: contact.ok,
        contactId: contact.ok ? contact.contactId : null,
        responseBody: contact.bodyText,
        error: contact.ok ? null : contact.error,
      };
      if (contact.ok) requestLog.info(contactLog, "HighLevel step 1 - contact upsert");
      else requestLog.error(contactLog, "HighLevel step 1 - contact upsert");
      await db.update(callbackRequestsTable).set({
        highlevelContactHttpStatus: contact.status,
        highlevelContactSucceeded: contact.ok,
        highlevelContactResponseBody: contact.bodyText || null,
        highlevelContactError: contact.ok ? null : contact.error,
        ...(contact.ok ? { highlevelContactId: contact.contactId } : {}),
      }).where(eq(callbackRequestsTable.id,row.id));
      if (!contact.ok) {
        await db.update(callbackRequestsTable).set({
          status: "highlevel_failed",
          highlevelWorkflowStatus: "not_attempted",
          errorMessage: contact.error,
        }).where(eq(callbackRequestsTable.id,row.id));
        return false;
      }
      contactId = contact.contactId;
    } else {
      requestLog.info({
        callbackRequestId: row.callbackRequestId,
        step: "highlevel_contact_upsert",
        succeeded: true,
        contactId,
        reused: true,
      }, "HighLevel step 1 - reusing saved contact");
    }
    const workflow = await addHighLevelWorkflow(contactId);
    const workflowLog = {
      callbackRequestId: row.callbackRequestId,
      step: "highlevel_workflow_enrolment",
      httpStatus: workflow.status,
      succeeded: workflow.succeeded,
      responseBody: workflow.bodyText,
      error: workflow.ok ? null : workflow.error,
    };
    if (workflow.ok) requestLog.info(workflowLog, "HighLevel step 2 - workflow enrolment");
    else requestLog.error(workflowLog, "HighLevel step 2 - workflow enrolment");
    if (!workflow.ok) {
      const uncertain = "uncertain" in workflow && workflow.uncertain === true;
      const responseStatus = "status" in workflow ? workflow.status : undefined;
      await db.update(callbackRequestsTable).set({
        status: uncertain ? "highlevel_uncertain" : "highlevel_failed",
        highlevelResponseStatus: responseStatus ?? null,
        highlevelWorkflowId: process.env.HIGHLEVEL_CALLBACK_WORKFLOW_ID2 || null,
        highlevelWorkflowStatus: uncertain ? "enrolment_uncertain" : "failed",
        highlevelWorkflowHttpStatus: workflow.status,
        highlevelWorkflowSucceeded: workflow.succeeded,
        highlevelWorkflowResponseBody: workflow.bodyText || null,
        highlevelWorkflowError: workflow.error,
        errorMessage: workflow.error,
      }).where(eq(callbackRequestsTable.id,row.id));
      return false;
    }
    await db.update(callbackRequestsTable).set({
      status: "sent_to_highlevel", highlevelSentAt: new Date(), highlevelResponseStatus: workflow.status ?? null,
      highlevelWorkflowId: workflow.workflowId, highlevelWorkflowStatus: "enrolled",
      highlevelWorkflowHttpStatus: workflow.status, highlevelWorkflowSucceeded: workflow.succeeded,
      highlevelWorkflowResponseBody: workflow.bodyText || null, highlevelWorkflowError: null, errorMessage: null,
    }).where(eq(callbackRequestsTable.id,row.id));
    return true;
  } catch (error) {
    requestLog.error({ err:error, callbackRequestId:row.callbackRequestId }, "HighLevel callback failed");
    await db.update(callbackRequestsTable).set({ status:"highlevel_failed", highlevelWorkflowStatus:"failed", errorMessage:error instanceof Error ? error.message : "HighLevel request failed" }).where(eq(callbackRequestsTable.id,row.id));
    return false;
  }
}
router.post("/callback", async (req,res):Promise<void> => {
  if (!originAllowed(req)) { res.status(403).json({error:"Origin not authorised"}); return; }
  const body = req.body ?? {};
  if (typeof body.phone !== "string" || !body.phone.trim()) { res.status(400).json({error:"Phone number is required"}); return; }
  const normalised = normalisePhone(body.phone);
  if (!normalised) { res.status(400).json({error:"That number doesn't look quite right. Have another look."}); return; }
  req.log.info({
    submitted_phone: body.phone.trim(),
    normalised_phone: normalised,
    phone_sent_to_highlevel: normalised,
  }, "Callback phone accepted");
  const hashSecret = process.env.IP_HASH_SECRET || process.env.SESSION_SECRET;
  if (!hashSecret) { req.log.error("Callback IP hash secret is not configured"); res.status(503).json({error:"Callback service is temporarily unavailable"}); return; }
  const ipHash = crypto.createHmac("sha256", hashSecret).update(clientIp(req)).digest("hex");
  const now = new Date();
  const ipSince = new Date(now.getTime()-10*60_000), phoneSince = new Date(now.getTime()-30*60_000);
  const configuredLimits = await limits();
  const [ipCount] = await db.select({count:sql<number>`count(*)`}).from(callbackRequestsTable).where(and(
    gte(callbackRequestsTable.createdAt,ipSince),
    eq(callbackRequestsTable.ipHash,ipHash),
    ne(callbackRequestsTable.status,"blocked_rate_limit"),
  ));
  const [phoneCount] = await db.select({count:sql<number>`count(*)`}).from(callbackRequestsTable).where(and(
    gte(callbackRequestsTable.createdAt,phoneSince),
    eq(callbackRequestsTable.phoneNormalised,normalised),
    ne(callbackRequestsTable.status,"blocked_rate_limit"),
  ));
  if (
    isCallbackRateLimited(Number(ipCount?.count ?? 0), configuredLimits.ip) ||
    isCallbackRateLimited(Number(phoneCount?.count ?? 0), configuredLimits.phone)
  ) {
    await db.insert(callbackRequestsTable).values({ callbackRequestId:crypto.randomUUID(), phone:body.phone.trim(), phoneNormalised:normalised, status:"blocked_rate_limit", callbackType:"immediate", businessOpen:false, ipHash, userAgent:clean(req.get("user-agent"),1000) });
    res.status(429).json({error:"Please try again later."}); return;
  }
  const open = await businessOpen(now), id = crypto.randomUUID();
  if (body.website_url || body.form_started_at && Date.now() - Number(body.form_started_at) < 1000) { res.status(400).json({error:"Unable to process callback request"}); return; }
  const [row] = await db.insert(callbackRequestsTable).values({ callbackRequestId:id, phone:body.phone.trim(), phoneNormalised:normalised, status:open ? "received":"closed_callback_requested", callbackType:open?"immediate":"scheduled", businessOpen:open, source:SOURCE, ipHash, userAgent:clean(req.get("user-agent"),1000), deviceType:clean(body.device_type,40), sessionId:clean(body.session_id,200), pageUrl:clean(body.page_url,2000), pageTitle:clean(body.page_title), referrer:clean(body.referrer,2000), utmSource:clean(body.utm_source), utmMedium:clean(body.utm_medium), utmCampaign:clean(body.utm_campaign), utmContent:clean(body.utm_content), utmTerm:clean(body.utm_term), gclid:clean(body.gclid), fbclid:clean(body.fbclid) }).returning();
  if (!row) { res.status(500).json({error:"Unable to save callback request"}); return; }
  const sent = await sendHighLevel(row, req.log ?? logger);
  if (!sent) { res.status(502).json({success:false,callback_request_id:id,status:"highlevel_failed",business_open:open,callback_type:row.callbackType}); return; }
  res.status(200).json({
    success: true,
    callback_request_id: id,
    status: "sent_to_highlevel",
    business_open: open,
    callback_type: row.callbackType,
  });
});
router.get("/callback/availability", async (_req, res): Promise<void> => {
  const open = await businessOpen();
  res.json({ business_open: open, callback_type: open ? "immediate" : "scheduled", timezone: "Europe/London" });
});
router.get("/callback/staff-photo", async (_req, res): Promise<void> => {
  const result = await db.execute(sql`
    SELECT profile_image_url
    FROM staff_members
    WHERE profile_image_url IS NOT NULL
      AND (
        profile_image_url LIKE '/objects/%'
        OR profile_image_url LIKE '/storage/objects/%'
        OR profile_image_url LIKE '/api/storage/objects/%'
      )
    ORDER BY random()
    LIMIT 1
  `);
  const storedUrl = (result.rows[0] as { profile_image_url?: string } | undefined)?.profile_image_url;
  if (!storedUrl) {
    res.status(404).json({ error: "No staff photo available" });
    return;
  }
  const imageUrl = storedUrl.startsWith("/api/storage/")
    ? storedUrl.slice("/api".length)
    : storedUrl.startsWith("/storage/")
      ? storedUrl
      : `/storage${storedUrl}`;
  res.json({ image_url: imageUrl });
});
router.get("/callback/:id", async (req,res):Promise<void> => {
  const [row] = await db.select({ callbackRequestId:callbackRequestsTable.callbackRequestId, status:callbackRequestsTable.status, callbackType:callbackRequestsTable.callbackType, businessOpen:callbackRequestsTable.businessOpen, createdAt:callbackRequestsTable.createdAt }).from(callbackRequestsTable).where(eq(callbackRequestsTable.callbackRequestId,req.params.id));
  if (!row) { res.status(404).json({error:"Callback request not found"}); return; } res.json(row);
});
router.use("/admin/callbacks", (req,res,next) => { if (!staff(req)?.role || staff(req)?.role !== "staff") { res.status(401).json({error:"Not authenticated"}); return; } next(); });
router.get("/admin/callbacks", async (req,res):Promise<void> => {
  const period = typeof req.query.period === "string" ? req.query.period : "30";
  if (!["today","7","30"].includes(period)) { res.status(400).json({error:"period must be today, 7, or 30"}); return; }
  const conditions = [gte(callbackRequestsTable.createdAt, period === "today" ? londonMidnight() : new Date(Date.now() - Number(period) * 86400000))];
  if (typeof req.query.status === "string" && req.query.status) conditions.push(eq(callbackRequestsTable.status, req.query.status));
  if (typeof req.query.source === "string" && req.query.source) conditions.push(eq(callbackRequestsTable.source, req.query.source));
  const rows = await db.select().from(callbackRequestsTable).where(and(...conditions)).orderBy(desc(callbackRequestsTable.createdAt)).limit(500);
  res.json(rows);
});
router.get("/admin/callbacks/stats", async (_req,res):Promise<void> => {
  const [row] = await db.select({
    total: sql<number>`count(*)::int`,
    immediate: sql<number>`count(*) filter (where callback_type='immediate')::int`,
    closed: sql<number>`count(*) filter (where callback_type='scheduled')::int`,
    failures: sql<number>`count(*) filter (where status='highlevel_failed')::int`,
    blocked: sql<number>`count(*) filter (where status='blocked_rate_limit')::int`,
  }).from(callbackRequestsTable).where(gte(callbackRequestsTable.createdAt,londonMidnight()));
  res.json(row);
});
router.get("/admin/callbacks/settings", async (_req,res):Promise<void> => {
  const value = await setting("callback_hours"); let hours = defaultCallbackHours;
  try {
    if (value) {
      const parsed = parseHours(JSON.parse(value));
      const legacyDefault = Object.entries(parsed).every(([day, entry]) =>
        day === "saturday" || day === "sunday"
          ? entry === null
          : entry?.open === "09:30" && entry?.close === "16:00"
      );
      hours = legacyDefault ? defaultCallbackHours : parsed;
    }
  } catch {}
  const configured = await limits();
  res.json({timezone:"Europe/London",hours,ip_limit:configured.ip,phone_limit:configured.phone});
});
router.patch("/admin/callbacks/settings", async (req,res):Promise<void> => {
  let hours: CallbackHours;
  try { hours = parseHours(req.body?.hours); } catch (error) { res.status(400).json({error:error instanceof Error ? error.message : "Invalid hours"}); return; }
  const ip = req.body?.ip_limit, phone = req.body?.phone_limit;
  if (!Number.isInteger(ip) || ip < 1 || ip > 100 || !Number.isInteger(phone) || phone < 1 || phone > 100) { res.status(400).json({error:"Limits must be integers from 1 to 100"}); return; }
  for (const [key,value] of [["callback_hours",JSON.stringify(hours)],["callback_limits",JSON.stringify({ip,phone})] as const]) await db.insert(settingsTable).values({key,value}).onConflictDoUpdate({target:settingsTable.key,set:{value,updatedAt:new Date()}});
  res.json({timezone:"Europe/London",hours,ip_limit:ip,phone_limit:phone});
});
router.post("/admin/callbacks/:id/retry", async (req,res):Promise<void> => {
  const [row] = await db.select().from(callbackRequestsTable).where(eq(callbackRequestsTable.callbackRequestId,req.params.id));
  if (!row) { res.status(404).json({error:"Callback request not found"}); return; }
  const [claimed] = await db.update(callbackRequestsTable).set({ status:"highlevel_retrying", highlevelWorkflowStatus:"retrying" })
    .where(and(eq(callbackRequestsTable.id,row.id), eq(callbackRequestsTable.status,"highlevel_failed"))).returning();
  if (!claimed) { res.status(409).json({error:"Only failed requests can be retried"}); return; }
  const ok=await sendHighLevel(claimed,req.log??logger);
  if (!ok) { res.status(502).json({success:false,status:"highlevel_failed"}); return; }
  res.json({success:true,status:"sent_to_highlevel"});
});
export default router;