import { db, settingsTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

const HIGHLEVEL_BASE_URL = "https://services.leadconnectorhq.com";
const LEGACY_VERSION = "2021-07-28";

async function assertIntegrationWriteAllowed(integrationId: string): Promise<void> {
  const [activation, capabilities] = await Promise.all([
    db.select({ value: settingsTable.value }).from(settingsTable)
      .where(eq(settingsTable.key, "installation_activated")),
    db.select({ value: settingsTable.value }).from(settingsTable)
      .where(eq(settingsTable.key, "integration_enabled")),
  ]);
  if (activation[0]?.value !== "true") {
    throw new Error(`Outbound ${integrationId} write blocked: installation is not activated.`);
  }
  let enabled: unknown;
  try {
    enabled = JSON.parse(capabilities[0]?.value ?? "null");
  } catch {
    throw new Error("Outbound integration capability state is invalid; writes are blocked.");
  }
  if (!enabled || typeof enabled !== "object" || Array.isArray(enabled)
    || (enabled as Record<string, unknown>)[integrationId] !== true) {
    throw new Error(`Outbound ${integrationId} integration is not explicitly enabled.`);
  }
}

export interface HighLevelConfig {
  apiKey: string;
  locationId: string;
  userId: string;
  userName: string;
}

async function getSettings(keys: string[]): Promise<Record<string, string>> {
  const rows = await db.select().from(settingsTable).where(inArray(settingsTable.key, keys));
  return Object.fromEntries(
    rows
      .filter((row) => !!row.value)
      .map((row) => [row.key, row.value as string]),
  );
}

function apiError(status: number, body: string): Error {
  const detail = body.trim().slice(0, 500);
  return new Error(`HighLevel API error ${status}${detail ? `: ${detail}` : ""}`);
}

async function highLevelFetch(
  path: string,
  apiKey: string,
  init: RequestInit = {},
  version = LEGACY_VERSION,
): Promise<any> {
  if (["POST", "PUT", "PATCH", "DELETE"].includes((init.method ?? "GET").toUpperCase())) {
    await assertIntegrationWriteAllowed("highlevel");
  }
  const response = await fetch(`${HIGHLEVEL_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: version,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) throw apiError(response.status, text);
  return text ? JSON.parse(text) : {};
}

async function resolveUser(
  apiKey: string,
  locationId: string,
  configuredUserId?: string,
  configuredUserName?: string,
): Promise<{ id: string; name: string }> {
  if (configuredUserId) {
    return { id: configuredUserId, name: configuredUserName || "Configured campaign user" };
  }

  try {
    const data = await highLevelFetch(
      `/users/?locationId=${encodeURIComponent(locationId)}`,
      apiKey,
    );
    const users: any[] = data.users ?? data.data ?? [];
    const user = users.find((candidate) => candidate?.id || candidate?._id);
    if (user) {
      return {
        id: String(user.id ?? user._id),
        name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.name || "Configured campaign user",
      };
    }
  } catch (error) {
    console.warn("[campaigns] Could not auto-resolve HighLevel user:", (error as Error).message);
  }

  throw new Error(
    "HighLevel campaign user is not configured. Add a high_level_user_id setting or grant users.readonly to the HighLevel private integration.",
  );
}

export async function getHighLevelConfig(): Promise<HighLevelConfig> {
  const settings = await getSettings([
    "high_level_api_key",
    "high_level_location_id",
    "high_level_user_id",
    "high_level_user_name",
  ]);
  if (!settings.high_level_api_key || !settings.high_level_location_id) {
    throw new Error("HighLevel API key and Location ID must be configured in Settings.");
  }
  const user = await resolveUser(
    settings.high_level_api_key,
    settings.high_level_location_id,
    settings.high_level_user_id,
    settings.high_level_user_name,
  );
  return {
    apiKey: settings.high_level_api_key,
    locationId: settings.high_level_location_id,
    userId: user.id,
    userName: user.name,
  };
}

export async function listHighLevelTags(): Promise<Array<{ id: string; name: string }>> {
  const settings = await getSettings(["high_level_api_key", "high_level_location_id"]);
  if (!settings.high_level_api_key || !settings.high_level_location_id) {
    throw new Error("HighLevel API key and Location ID must be configured in Settings.");
  }
  const data = await highLevelFetch(
    `/locations/${encodeURIComponent(settings.high_level_location_id)}/tags`,
    settings.high_level_api_key,
  );
  const tags: any[] = data.tags ?? data.data ?? [];
  return tags
    .filter((tag) => tag?.id && tag?.name)
    .map((tag) => ({ id: String(tag.id), name: String(tag.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type HighLevelAudienceRule = {
  mode: "tags" | "all";
  tagIds: string[];
  excludedTagIds: string[];
};

export async function previewHighLevelAudience(rule: HighLevelAudienceRule): Promise<{
  count: number;
  contacts: Array<{ id: string; name: string; email: string; tags: string[] }>;
  recipientIds: string[];
  scanIncomplete: boolean;
  truncated: boolean;
}> {
  const settings = await getSettings(["high_level_api_key", "high_level_location_id"]);
  if (!settings.high_level_api_key || !settings.high_level_location_id) {
    throw new Error("HighLevel API key and Location ID must be configured in Settings.");
  }
  const tags = await listHighLevelTags();
  const selectedNames = new Set(
    tags.filter((tag) => rule.tagIds.includes(tag.id)).map((tag) => tag.name.toLowerCase()),
  );
  const excludedNames = new Set(
    tags.filter((tag) => rule.excludedTagIds.includes(tag.id)).map((tag) => tag.name.toLowerCase()),
  );
  if (selectedNames.size !== new Set(rule.tagIds).size || excludedNames.size !== new Set(rule.excludedTagIds).size) {
    throw new Error("One or more selected HighLevel tags no longer exist.");
  }

  const matches = new Map<string, { id: string; name: string; email: string; tags: string[] }>();
  const seenContactIds = new Set<string>();
  const visitedPageUrls = new Set<string>();
  const visitedCursors = new Set<string>();
  const pageLimit = 100;
  let nextUrl: string | null =
    `${HIGHLEVEL_BASE_URL}/contacts/?locationId=${encodeURIComponent(settings.high_level_location_id)}&limit=${pageLimit}`;
  let pages = 0;
  const maxPages = 250;
  let advertisedTotal: number | null = null;
  let paginationFailed = false;

  while (nextUrl && pages < maxPages) {
    if (visitedPageUrls.has(nextUrl)) {
      paginationFailed = true;
      break;
    }
    visitedPageUrls.add(nextUrl);
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${settings.high_level_api_key}`,
        Version: LEGACY_VERSION,
      },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    if (!response.ok) throw apiError(response.status, text);
    const data = text ? JSON.parse(text) : {};
    const pageContacts: any[] = data.contacts ?? [];
    const pageTotal = Number(data.meta?.total);
    if (Number.isFinite(pageTotal) && pageTotal >= 0) {
      advertisedTotal = Math.max(advertisedTotal ?? 0, pageTotal);
    }
    for (const contact of pageContacts) {
      const contactId = String(contact.id ?? contact._id ?? "");
      if (contactId) seenContactIds.add(contactId);
      const contactTags = (contact.tags ?? []).map((tag: unknown) => String(tag));
      const normalizedTags = contactTags.map((tag: string) => tag.toLowerCase());
      // A tags-mode rule with no included tags but at least one exclusion means
      // "all eligible contacts except the excluded tags".
      const includeAll = rule.mode === "all" || (rule.mode === "tags" && selectedNames.size === 0);
      const isIncluded = includeAll || normalizedTags.some((tag: string) => selectedNames.has(tag));
      const isExcluded = normalizedTags.some((tag: string) => excludedNames.has(tag));
      if (!isIncluded || isExcluded || !contact.email || !contactId) continue;
      const normalizedEmail = String(contact.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || matches.has(normalizedEmail)) continue;
      matches.set(normalizedEmail, {
        id: contactId,
        name: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email,
        email: normalizedEmail,
        tags: contactTags,
      });
    }

    const suppliedNextPageUrl = data.meta?.nextPageUrl;
    if (suppliedNextPageUrl) {
      nextUrl = new URL(String(suppliedNextPageUrl), HIGHLEVEL_BASE_URL).toString();
    } else if (
      pageContacts.length > 0
      && (
        pageContacts.length >= pageLimit
        || (advertisedTotal !== null && seenContactIds.size < advertisedTotal)
      )
    ) {
      const lastContact = pageContacts[pageContacts.length - 1];
      const lastContactId = String(lastContact?.id ?? lastContact?._id ?? "");
      const rawCursorTime = lastContact?.dateAdded ?? lastContact?.dateUpdated;
      const cursorTime = typeof rawCursorTime === "number"
        ? rawCursorTime
        : Date.parse(String(rawCursorTime ?? ""));
      if (lastContactId && Number.isFinite(cursorTime)) {
        const cursorKey = `${cursorTime}:${lastContactId}`;
        if (visitedCursors.has(cursorKey)) {
          paginationFailed = true;
          nextUrl = null;
          pages += 1;
          continue;
        }
        visitedCursors.add(cursorKey);
        const cursorUrl = new URL("/contacts/", HIGHLEVEL_BASE_URL);
        cursorUrl.searchParams.set("locationId", settings.high_level_location_id);
        cursorUrl.searchParams.set("limit", String(pageLimit));
        cursorUrl.searchParams.set("startAfter", String(cursorTime));
        cursorUrl.searchParams.set("startAfterId", lastContactId);
        nextUrl = cursorUrl.toString();
      } else {
        paginationFailed = true;
        nextUrl = null;
      }
    } else {
      nextUrl = null;
    }
    pages += 1;
  }

  const contacts = [...matches.values()];
  const scanIncomplete = paginationFailed
    || !!nextUrl
    || (advertisedTotal !== null && seenContactIds.size < advertisedTotal);
  return {
    count: contacts.length,
    contacts: contacts.slice(0, 100),
    recipientIds: contacts.map((contact) => contact.id),
    scanIncomplete,
    truncated: scanIncomplete || contacts.length > 100,
  };
}

export async function createHighLevelCampaign(input: {
  name: string;
  htmlContent: string;
}): Promise<{ id: string }> {
  const config = await getHighLevelConfig();
  const existing = await highLevelFetch(
    `/emails/locations/${encodeURIComponent(config.locationId)}/campaigns/emails?limit=20&search=${encodeURIComponent(input.name)}`,
    config.apiKey,
    {},
    "v3",
  );
  const existingCampaign = (existing.campaigns ?? []).find(
    (campaign: any) => campaign?.name === input.name && campaign?.id && !campaign?.deleted,
  );
  if (existingCampaign) return { id: String(existingCampaign.id) };

  const data = await highLevelFetch(
    `/emails/locations/${encodeURIComponent(config.locationId)}/campaigns/emails`,
    config.apiKey,
    {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        editorType: "html",
        editorContent: input.htmlContent,
        timeZone: "Europe/London",
        userId: config.userId,
        userName: config.userName,
      }),
    },
    "v3",
  );
  if (!data.id) throw new Error("HighLevel created the campaign without returning an ID.");
  return { id: String(data.id) };
}

export async function scheduleHighLevelCampaign(input: {
  campaignId: string;
  subject: string;
  previewText: string;
  fromName: string;
  fromEmail: string;
  contactIds: string[];
  sendAt: string;
  batchSize: number;
  batchIntervalMinutes: number;
  onScheduleRequestStart?: () => void;
}): Promise<{ campaignId: string; sourceId: string | null }> {
  const config = await getHighLevelConfig();
  let data: any;
  try {
    await assertIntegrationWriteAllowed("highlevel");
    input.onScheduleRequestStart?.();
    data = await highLevelFetch(
      `/emails/locations/${encodeURIComponent(config.locationId)}/campaigns/emails/${encodeURIComponent(input.campaignId)}/schedule`,
      config.apiKey,
      {
        method: "POST",
        body: JSON.stringify({
          scheduleType: "batch",
          timeZone: "Europe/London",
          userId: config.userId,
          userName: config.userName,
          emailMeta: {
            subject: input.subject,
            previewText: input.previewText,
            fromName: input.fromName,
            fromEmail: input.fromEmail,
          },
          recipients: {
            type: "contact",
            contactIds: input.contactIds,
            freezeList: true,
          },
          sendDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
          scheduleConfig: {
            sendAt: input.sendAt,
            batch: {
              batchSize: input.batchSize,
              interval: input.batchIntervalMinutes,
              intervalUnit: "minutes",
            },
            tracking: { clickTracking: true, utmTracking: true },
            resend: { enabled: false },
          },
        }),
      },
      "v3",
    );
  } catch (error) {
    if (/^HighLevel API error 4\d\d\b/.test((error as Error).message)) {
      throw new Error(
        `${(error as Error).message} Exact-contact targeting was rejected, so this campaign was not scheduled and no broader audience was used.`,
      );
    }
    throw error;
  }
  return {
    campaignId: String(data.campaignId ?? input.campaignId),
    sourceId: data.sourceId ? String(data.sourceId) : null,
  };
}

export async function getHighLevelCampaignStatus(campaignId: string): Promise<string> {
  const config = await getHighLevelConfig();
  const data = await highLevelFetch(
    `/emails/locations/${encodeURIComponent(config.locationId)}/campaigns/emails/${encodeURIComponent(campaignId)}`,
    config.apiKey,
    {},
    "v3",
  );
  return String(data.status ?? "").toLowerCase();
}

export type HighLevelCampaignStats = {
  sent: number;
  accepted: number;
  delivered: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  complained: number;
  permanentFail: number;
  temporaryFail: number;
  rejected: number;
  failed: number;
  replied: number;
  openRate: number;
  clickRate: number;
  unsubscribeRate: number;
  complaintRate: number;
  bounceRate: number;
  replyRate: number;
};

function numericStat(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

export async function getHighLevelCampaignStats(campaignId: string): Promise<HighLevelCampaignStats> {
  const settings = await getSettings(["high_level_api_key", "high_level_location_id"]);
  if (!settings.high_level_api_key || !settings.high_level_location_id) {
    throw new Error("HighLevel API key and Location ID must be configured in Settings.");
  }
  const data = await highLevelFetch(
    `/emails/locations/${encodeURIComponent(settings.high_level_location_id)}/campaigns/stats/email-campaigns/${encodeURIComponent(campaignId)}`,
    settings.high_level_api_key,
    {},
    "v3",
  );
  const stats = data.stats ?? {};
  return {
    sent: numericStat(stats.sent),
    accepted: numericStat(stats.accepted),
    delivered: numericStat(stats.delivered),
    opened: numericStat(stats.opened),
    clicked: numericStat(stats.clicked),
    unsubscribed: numericStat(stats.unsubscribed),
    complained: numericStat(stats.complained),
    permanentFail: numericStat(stats.permanentFail),
    temporaryFail: numericStat(stats.temporaryFail),
    rejected: numericStat(stats.rejected),
    failed: numericStat(stats.failed),
    replied: numericStat(stats.replied),
    openRate: numericStat(stats.openRate),
    clickRate: numericStat(stats.clickRate),
    unsubscribeRate: numericStat(stats.unsubscribeRate),
    complaintRate: numericStat(stats.complaintRate),
    bounceRate: numericStat(stats.bounceRate),
    replyRate: numericStat(stats.replyRate),
  };
}

export async function reconcileKnowledgeEmailCampaigns(): Promise<{
  checked: number;
  updated: number;
}> {
  const pending = await db.execute(sql`
    SELECT id, status, high_level_campaign_id, updated_at
    FROM knowledge_email_campaigns
    WHERE high_level_campaign_id IS NOT NULL
      AND status IN ('scheduled', 'processing', 'created_in_highlevel', 'handoff_in_progress', 'handoff_uncertain')
    ORDER BY updated_at ASC
    LIMIT 50
  `);
  if (!pending.rows.length) return { checked: 0, updated: 0 };

  let config: HighLevelConfig;
  try {
    config = await getHighLevelConfig();
  } catch {
    return { checked: 0, updated: 0 };
  }

  let updated = 0;
  for (const row of pending.rows as Array<{ id: number; status: string; high_level_campaign_id: string; updated_at: string | Date }>) {
    try {
      const remote = await highLevelFetch(
        `/emails/locations/${encodeURIComponent(config.locationId)}/campaigns/emails/${encodeURIComponent(row.high_level_campaign_id)}`,
        config.apiKey,
        {},
        "v3",
      );
      const remoteStatus = String(remote.status ?? "").toLowerCase();
      const nextStatus =
        remoteStatus === "sent" ? "sent" :
        remoteStatus === "processing" ? "processing" :
        ["failed", "cancelled", "archived"].includes(remoteStatus) ? "failed" :
        remoteStatus === "scheduled" ? "scheduled" :
        null;
      if (!nextStatus || nextStatus === row.status) continue;

      const detail = nextStatus === "failed"
          ? `HighLevel campaign status: ${remoteStatus || "failed"}`
          : null;
      await db.execute(sql`
        UPDATE knowledge_email_campaigns
        SET status = ${nextStatus}, error_message = ${detail}, updated_at = now()
        WHERE id = ${row.id}
      `);
      updated += 1;
    } catch (error) {
      console.warn(`[campaigns] Reconciliation failed for campaign ${row.id}:`, (error as Error).message);
    }
  }

  return { checked: pending.rows.length, updated };
}