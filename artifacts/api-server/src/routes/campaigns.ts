import { Router, type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { fetchKnowledgeBaseRss } from "../services/rss-feed.js";
import {
  createHighLevelCampaign,
  getHighLevelCampaignStatus,
  getHighLevelCampaignStats,
  listHighLevelTags,
  previewHighLevelAudience,
  scheduleHighLevelCampaign,
} from "../services/highlevel-campaigns.js";
import { sendEmail } from "../services/email.js";

const router = Router();
const JWT_SECRET: string = process.env.PORTAL_JWT_SECRET ?? "";
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("PORTAL_JWT_SECRET must be configured with at least 32 characters.");
}

function requireStaffAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Staff authentication required" });
    return;
  }
  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as Record<string, unknown>;
    if (payload.role !== "staff") {
      res.status(403).json({ error: "Staff access required" });
      return;
    }
    (req as Request & { staff?: Record<string, unknown> }).staff = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired staff session" });
  }
}

router.use("/campaigns", requireStaffAuth);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

function stripUnsafeEmailHtml(html: string): string {
  const allowedTags = new Set([
    "a", "b", "blockquote", "br", "center", "div", "em", "h1", "h2", "h3",
    "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "span", "strong",
    "style", "table", "tbody", "td", "th", "thead", "tr", "u", "ul",
  ]);
  const decodeEntities = (value: string) => value
    .replace(/&#(\d+);?/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);?/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&colon;?/gi, ":")
    .replace(/&tab;?/gi, "\t")
    .replace(/&newline;?/gi, "\n");
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<(?:iframe|object|embed|svg|math|form|input|button|textarea|select|option|meta|link|base)\b[\s\S]*?<\/(?:iframe|object|embed|svg|math|form|button|textarea|select)>/gi, "")
    .replace(/<(?:iframe|object|embed|svg|math|form|input|button|textarea|select|option|meta|link|base)\b[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:href|src|background|action|xlink:href)\s*=\s*(["'])\s*(?:javascript|vbscript|data):[\s\S]*?\1/gi, "")
    .replace(/\s(href|src|background|action|xlink:href)\s*=\s*(["'])([\s\S]*?)\2/gi, (attribute, name, quote, value) => {
      const decoded = decodeEntities(value).replace(/[\u0000-\u0020]+/g, "").toLowerCase();
      return /^(?:javascript|vbscript|data):/.test(decoded) ? "" : ` ${name}=${quote}${value}${quote}`;
    })
    .replace(/\sstyle\s*=\s*(["'])[\s\S]*?(?:expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:)[\s\S]*?\1/gi, "")
    .replace(/(?:javascript|vbscript)\s*:/gi, "")
    .replace(/<\/?([a-z0-9-]+)\b[^>]*>/gi, (tag, name: string) =>
      allowedTags.has(name.toLowerCase()) ? tag : "",
    );
}

function stripHtml(html: string): string {
  return html.replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCampaignHtml(html: string): string {
  // Keep legacy drafts usable without leaking their installation placeholder
  // domain into a customer-facing campaign.
  return html
    .replace(/\{\{\s*unsubscribe_link\s*\}\}/g, "{{email.unsubscribe_link}}")
    .replace(
      /https:\/\/(?:www\.)?configured-installation\.example\/([^"'<>\s?#]+)/gi,
      (_match, slug: string) => `/knowledge-centre/${slug.replace(/\/+$/, "")}`,
    );
}

function campaignRow(row: any): any {
  return {
    ...row,
    html_content: typeof row.html_content === "string" ? normalizeCampaignHtml(row.html_content) : row.html_content,
    audience_mode: row.audience_mode === "all" ? "all" : "tags",
    tag_ids: Array.isArray(row.tag_ids) ? row.tag_ids : [],
    excluded_tag_ids: Array.isArray(row.excluded_tag_ids) ? row.excluded_tag_ids : [],
  };
}

function londonLocalToUtc(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Schedule time must be a valid local date and time.");
  const desired = match.slice(1).map(Number);
  let utc = Date.UTC(desired[0], desired[1] - 1, desired[2], desired[3], desired[4]);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utc));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const rendered = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
  );
  utc -= rendered - Date.UTC(desired[0], desired[1] - 1, desired[2], desired[3], desired[4]);
  return new Date(utc);
}

function toHighLevelLocal(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Schedule time must be a valid local date and time.");
  const hour24 = Number(match[4]);
  const hour12 = hour24 % 12 || 12;
  return `${match[1]}-${match[2]}-${match[3]} ${String(hour12).padStart(2, "0")}:${match[5]} ${hour24 >= 12 ? "PM" : "AM"}`;
}

function nextLondonSundayAtFive(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const currentLondonDate = new Date(Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    12,
  ));
  const daysUntilNextSunday = 7 - currentLondonDate.getUTCDay();
  currentLondonDate.setUTCDate(currentLondonDate.getUTCDate() + daysUntilNextSunday);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${currentLondonDate.getUTCFullYear()}-${pad(currentLondonDate.getUTCMonth() + 1)}-${pad(currentLondonDate.getUTCDate())}T17:00`;
}

router.get("/campaigns/articles", async (_req, res): Promise<void> => {
  try {
    const articles = await fetchKnowledgeBaseRss();
    res.json({
      articles: articles.map((article) => ({
        id: String(article.id),
        title: article.title,
        link: article.link,
        excerpt: article.excerpt,
        content: article.content,
        imageUrl: article.featuredImageUrl,
        publishedAt: article.date,
        author: "Knowledge Centre",
      })),
    });
  } catch (error) {
    res.status(502).json({ error: errorMessage(error) });
  }
});

router.get("/campaigns/tags", async (_req, res): Promise<void> => {
  try {
    res.json({ tags: await listHighLevelTags() });
  } catch (error) {
    res.status(502).json({ error: errorMessage(error) });
  }
});

const AudienceBody = z.object({
  mode: z.enum(["tags", "all"]).default("tags"),
  tagIds: z.array(z.string().min(1)).max(50).default([]),
  excludedTagIds: z.array(z.string().min(1)).max(50).default([]),
}).superRefine((value, context) => {
  if (value.mode === "tags" && value.tagIds.length === 0 && value.excludedTagIds.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Choose at least one included or excluded HighLevel tag.", path: ["tagIds"] });
  }
  const overlap = value.tagIds.find((id) => value.excludedTagIds.includes(id));
  if (overlap) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A tag cannot be both included and excluded.", path: ["excludedTagIds"] });
  }
});
router.post("/campaigns/audience-preview", async (req, res): Promise<void> => {
  const parsed = AudienceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Choose a valid HighLevel audience." });
    return;
  }
  try {
    const { recipientIds: _recipientIds, ...preview } =
      await previewHighLevelAudience(parsed.data);
    res.json(preview);
  } catch (error) {
    res.status(502).json({ error: errorMessage(error) });
  }
});

router.get("/campaigns", async (_req, res): Promise<void> => {
  const rows = await db.execute(sql`
    SELECT id, article_id, article_link, title, subject, preheader, from_name, from_email,
           audience_mode, tag_ids, excluded_tag_ids, html_content, status, audience_count, scheduled_at, high_level_campaign_id,
           high_level_source_id, error_message, created_at, updated_at
    FROM knowledge_email_campaigns
    ORDER BY created_at DESC
    LIMIT 100
  `);
  res.json({ campaigns: (rows.rows as any[]).map(campaignRow) });
});

const CreateCampaignBody = z.object({
  articleId: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(250),
  subject: z.string().trim().min(1).max(250),
  preheader: z.string().trim().max(250).default(""),
  fromName: z.string().trim().min(1).max(120),
  fromEmail: z.string().email().max(250),
  mode: z.enum(["tags", "all"]).default("tags"),
  tagIds: z.array(z.string().min(1)).max(50).default([]),
  excludedTagIds: z.array(z.string().min(1)).max(50).default([]),
  htmlContent: z.string().min(50).max(500_000),
}).superRefine((value, context) => {
  if (value.mode === "tags" && value.tagIds.length === 0 && value.excludedTagIds.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Choose at least one included or excluded HighLevel tag.", path: ["tagIds"] });
  }
  if (value.tagIds.some((id) => value.excludedTagIds.includes(id))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A tag cannot be both included and excluded.", path: ["excludedTagIds"] });
  }
});

router.post("/campaigns", async (req, res): Promise<void> => {
  const parsed = CreateCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid campaign draft." });
    return;
  }
  try {
    const articles = await fetchKnowledgeBaseRss();
    const article = articles.find((item) => String(item.id) === parsed.data.articleId);
    if (!article) {
      res.status(400).json({ error: "That Knowledge Centre article is no longer available in the feed." });
      return;
    }
    const staff = (req as Request & { staff?: Record<string, unknown> }).staff;
    const rows = await db.execute(sql`
      INSERT INTO knowledge_email_campaigns (
        article_id, article_link, title, subject, preheader, from_name, from_email,
        audience_mode, tag_ids, excluded_tag_ids, html_content, status, created_by
      ) VALUES (
        ${parsed.data.articleId}, ${article.link}, ${parsed.data.title}, ${parsed.data.subject},
        ${parsed.data.preheader}, ${parsed.data.fromName}, ${parsed.data.fromEmail},
        ${parsed.data.mode}, ${JSON.stringify(parsed.data.tagIds)}::jsonb,
        ${JSON.stringify(parsed.data.excludedTagIds)}::jsonb, ${stripUnsafeEmailHtml(parsed.data.htmlContent)},
        'draft', ${String(staff?.email ?? staff?.name ?? "staff")}
      )
      RETURNING *
    `);
    res.status(201).json({ campaign: campaignRow(rows.rows[0]) });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

router.patch("/campaigns/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = CreateCampaignBody.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid campaign ID." : (parsed.error.issues[0]?.message ?? "Invalid campaign draft.") });
    return;
  }
  try {
    const articles = await fetchKnowledgeBaseRss();
    const article = articles.find((item) => String(item.id) === parsed.data.articleId);
    if (!article) {
      res.status(400).json({ error: "That Knowledge Centre article is no longer available in the feed." });
      return;
    }
    const rows = await db.execute(sql`
      UPDATE knowledge_email_campaigns
      SET article_id = ${parsed.data.articleId}, article_link = ${article.link},
          title = ${parsed.data.title}, subject = ${parsed.data.subject},
          preheader = ${parsed.data.preheader}, from_name = ${parsed.data.fromName},
          from_email = ${parsed.data.fromEmail},
           audience_mode = ${parsed.data.mode},
          tag_ids = ${JSON.stringify(parsed.data.tagIds)}::jsonb,
           excluded_tag_ids = ${JSON.stringify(parsed.data.excludedTagIds)}::jsonb,
          html_content = ${stripUnsafeEmailHtml(parsed.data.htmlContent)},
          error_message = NULL, updated_at = now()
      WHERE id = ${id}
        AND status IN ('draft', 'handoff_failed')
        AND high_level_campaign_id IS NULL
      RETURNING *
    `);
    if (!rows.rows[0]) {
      res.status(409).json({ error: "This campaign can no longer be edited because it has already been handed to HighLevel." });
      return;
    }
    res.json({ campaign: campaignRow(rows.rows[0]) });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

const TestBody = z.object({ email: z.string().email() });
router.post("/campaigns/:id/test", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = TestBody.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    res.status(400).json({ error: "A valid campaign and test email address are required." });
    return;
  }
  const rows = await db.execute(sql`
    SELECT subject, html_content FROM knowledge_email_campaigns WHERE id = ${id} LIMIT 1
  `);
  const campaign = rows.rows[0] as any;
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found." });
    return;
  }
  const htmlContent = normalizeCampaignHtml(campaign.html_content);
  const result = await sendEmail({
    to: parsed.data.email,
    subject: `[TEST] ${campaign.subject}`,
    html: htmlContent,
    text: stripHtml(htmlContent),
  });
  if (!result.sent) {
    res.status(502).json({ error: result.error ?? "Test email could not be sent." });
    return;
  }
  res.json({ ok: true, sentTo: parsed.data.email, provider: result.provider });
});

router.get("/campaigns/:id/stats", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "A valid campaign ID is required." });
    return;
  }
  const rows = await db.execute(sql`
    SELECT high_level_campaign_id
    FROM knowledge_email_campaigns
    WHERE id = ${id}
    LIMIT 1
  `);
  const campaign = rows.rows[0] as { high_level_campaign_id?: string | null } | undefined;
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found." });
    return;
  }
  if (!campaign.high_level_campaign_id) {
    res.status(409).json({ error: "This campaign has not been handed to HighLevel yet." });
    return;
  }
  try {
    res.json({ stats: await getHighLevelCampaignStats(campaign.high_level_campaign_id) });
  } catch (error) {
    res.status(502).json({ error: errorMessage(error) });
  }
});

const ScheduleBody = z.object({});

router.post("/campaigns/:id/schedule", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = ScheduleBody.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    res.status(400).json({ error: "A valid campaign is required." });
    return;
  }

  const scheduledLocal = nextLondonSundayAtFive();
  const scheduledAt = londonLocalToUtc(scheduledLocal);
  if (scheduledAt.getTime() < Date.now() + 10 * 60_000) {
    res.status(400).json({ error: "Schedule the campaign at least 10 minutes in the future." });
    return;
  }

  const preliminary = await db.execute(sql`
    SELECT * FROM knowledge_email_campaigns WHERE id = ${id} LIMIT 1
  `);
  const pendingCampaign = preliminary.rows[0] as any;
  if (!pendingCampaign) {
    res.status(404).json({ error: "Campaign not found." });
    return;
  }
  if (!["draft", "handoff_failed", "created_in_highlevel"].includes(pendingCampaign.status)) {
    res.status(409).json({ error: "This campaign is already being handed to HighLevel or has already been scheduled." });
    return;
  }

  let remoteScheduleAttempted = false;
  try {
    const selected = await db.execute(sql`
    UPDATE knowledge_email_campaigns
    SET status = 'handoff_in_progress', error_message = NULL, updated_at = now()
    WHERE id = ${id}
      AND status IN ('draft', 'handoff_failed', 'created_in_highlevel')
    RETURNING *
    `);
    const campaign = selected.rows[0] as any;
    if (!campaign) {
      res.status(409).json({ error: "Another request is already handing this campaign to HighLevel." });
      return;
    }

    const audienceMode = campaign.audience_mode === "all" ? "all" : "tags";
    const tagIds: string[] = Array.isArray(campaign.tag_ids) ? campaign.tag_ids : [];
    const excludedTagIds: string[] = Array.isArray(campaign.excluded_tag_ids) ? campaign.excluded_tag_ids : [];
    const audience = await previewHighLevelAudience({
      mode: audienceMode,
      tagIds,
      excludedTagIds,
    });
    if (audience.scanIncomplete) {
      throw new Error("HighLevel has more contacts than the system could safely scan. The campaign was not scheduled.");
    }
    if (audience.count < 1) throw new Error("No email contacts match the saved audience rules.");

    let highLevelCampaignId: string | null = campaign.high_level_campaign_id;

    if (highLevelCampaignId) {
      const remoteStatus = await getHighLevelCampaignStatus(highLevelCampaignId);
      if (["scheduled", "processing", "sent"].includes(remoteStatus)) {
        const alreadyScheduled = await db.execute(sql`
          UPDATE knowledge_email_campaigns
          SET status = ${remoteStatus}, audience_count = ${audience.count},
              scheduled_at = COALESCE(scheduled_at, ${scheduledAt}),
              error_message = NULL, updated_at = now()
          WHERE id = ${id} AND status = 'handoff_in_progress'
          RETURNING *
        `);
        res.json({ campaign: campaignRow(alreadyScheduled.rows[0]) });
        return;
      }
    }
    if (!highLevelCampaignId) {
      const created = await createHighLevelCampaign({
        name: `${campaign.title} [campaign-${id}]`,
        htmlContent: normalizeCampaignHtml(campaign.html_content),
      });
      highLevelCampaignId = created.id;
      await db.execute(sql`
        UPDATE knowledge_email_campaigns
        SET high_level_campaign_id = ${highLevelCampaignId}, status = 'created_in_highlevel',
            error_message = NULL, updated_at = now()
        WHERE id = ${id} AND status = 'handoff_in_progress'
      `);
    }

    const scheduled = await scheduleHighLevelCampaign({
      campaignId: highLevelCampaignId,
      subject: campaign.subject,
      previewText: campaign.preheader ?? "",
      fromName: campaign.from_name,
      fromEmail: campaign.from_email,
      contactIds: audience.recipientIds,
      sendAt: toHighLevelLocal(scheduledLocal),
      batchSize: Math.max(1, audience.recipientIds.length),
      batchIntervalMinutes: 1,
      onScheduleRequestStart: () => {
        remoteScheduleAttempted = true;
      },
    });
    const updated = await db.execute(sql`
      UPDATE knowledge_email_campaigns
      SET status = 'scheduled', audience_count = ${audience.count},
          scheduled_at = ${scheduledAt}, high_level_campaign_id = ${scheduled.campaignId},
          high_level_source_id = ${scheduled.sourceId}, error_message = NULL, updated_at = now()
      WHERE id = ${id} AND status IN ('handoff_in_progress', 'created_in_highlevel')
      RETURNING *
    `);
    if (!updated.rows[0]) {
      const reconciled = await db.execute(sql`
        SELECT * FROM knowledge_email_campaigns WHERE id = ${id} LIMIT 1
      `);
      const row = reconciled.rows[0] as any;
      if (row && ["scheduled", "processing", "sent"].includes(row.status)) {
        res.json({ campaign: campaignRow(row) });
        return;
      }
      throw new Error("Campaign schedule was accepted but the local record could not be updated.");
    }
    res.json({ campaign: campaignRow(updated.rows[0]) });
  } catch (error) {
    const message = errorMessage(error);
    const definiteRejection = /^HighLevel API error 4\d\d\b/.test(message);
    const current = await db.execute(sql`
      SELECT high_level_campaign_id, status FROM knowledge_email_campaigns WHERE id = ${id} LIMIT 1
    `);
    const currentRow = current.rows[0] as any;
    const failureStatus = remoteScheduleAttempted && currentRow?.high_level_campaign_id && !definiteRejection
      ? "handoff_uncertain"
      : "handoff_failed";
    const detail = failureStatus === "handoff_uncertain"
      ? `HighLevel may have accepted the schedule, but the local system did not receive confirmation. Automatic reconciliation will check before retry is allowed. ${message}`
      : message;
    await db.execute(sql`
      UPDATE knowledge_email_campaigns
      SET status = ${failureStatus}, error_message = ${detail}, updated_at = now()
      WHERE id = ${id} AND status IN ('handoff_in_progress', 'created_in_highlevel')
    `);
    res.status(502).json({ error: detail });
  }
});

const ResolveUncertainBody = z.object({
  confirmedNotScheduled: z.literal(true),
});

router.post("/campaigns/:id/resolve-uncertain", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = ResolveUncertainBody.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    res.status(400).json({ error: "Explicit confirmation that HighLevel did not schedule the campaign is required." });
    return;
  }
  const rows = await db.execute(sql`
    SELECT * FROM knowledge_email_campaigns
    WHERE id = ${id} AND status = 'handoff_uncertain'
    LIMIT 1
  `);
  const campaign = rows.rows[0] as any;
  if (!campaign?.high_level_campaign_id) {
    res.status(409).json({ error: "This campaign is not awaiting an uncertain HighLevel resolution." });
    return;
  }
  try {
    const remoteStatus = await getHighLevelCampaignStatus(campaign.high_level_campaign_id);
    if (remoteStatus !== "draft") {
      res.status(409).json({
        error: `HighLevel currently reports this campaign as ${remoteStatus || "unknown"}. The system will not enable a retry.`,
      });
      return;
    }
    const updated = await db.execute(sql`
      UPDATE knowledge_email_campaigns
      SET status = 'handoff_failed',
          error_message = 'Staff verified in HighLevel that the campaign was not scheduled. Scheduling can now be retried.',
          updated_at = now()
      WHERE id = ${id} AND status = 'handoff_uncertain'
      RETURNING *
    `);
    res.json({ campaign: campaignRow(updated.rows[0]) });
  } catch (error) {
    res.status(502).json({ error: `HighLevel status could not be verified: ${errorMessage(error)}` });
  }
});

export default router;