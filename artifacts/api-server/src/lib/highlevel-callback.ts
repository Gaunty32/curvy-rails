import { assertIntegrationOutboundAllowed } from "../setup/outbound-gate.js";

export type HighLevelFetcher = (url: string, init: RequestInit) => Promise<Response>;

export type CallbackAttribution = {
  pageUrl?: string | null; pageTitle?: string | null; referrer?: string | null;
  utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null;
  utmContent?: string | null; utmTerm?: string | null; gclid?: string | null; fbclid?: string | null;
  callbackRequestId?: string | null; callbackType?: string | null; businessOpen?: boolean | null;
};

export function buildHighLevelContactPayload(
  phone: string,
  locationId: string,
  customFields: Array<{ id: string; fieldValue: string }> = [],
  assignedTo?: string,
) {
  return {
    phone,
    locationId,
    source: "Website Callback",
    createNewIfDuplicateAllowed: false,
    ...(assignedTo ? { assignedTo } : {}),
    ...(customFields.length ? { customFields } : {}),
  };
}

const endpoint = "https://services.leadconnectorhq.com";
const headers = (token: string) => ({
  authorization: `Bearer ${token}`, version: "v3",
  accept: "application/json",
  "content-type": "application/json",
});
const json = async (response: Response): Promise<{ body: Record<string, unknown>; bodyText: string }> => {
  const text = await response.text();
  if (!text) return { body: {}, bodyText: "" };
  try { return { body: JSON.parse(text) as Record<string, unknown>, bodyText: text }; }
  catch { return { body: {}, bodyText: text }; }
};
function errorMessage(body: Record<string, unknown>, bodyText: string, status: number) {
  const detail = body.message ?? body.error ?? body.msg;
  return `HighLevel API error (${status})${typeof detail === "string" ? `: ${detail}` : bodyText ? `: ${bodyText}` : ""}`;
}

export function highLevelEventStartTime(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    }).formatToParts(date).map(part => [part.type, part.value]),
  );
  const offset = parts.timeZoneName.replace("GMT", "") || "+00:00";
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

export async function upsertHighLevelContact(
  phone: string, attribution: CallbackAttribution, fetcher: HighLevelFetcher = fetch,
) {
  const token = process.env.HIGHLEVEL_API_TOKEN2;
  const locationId = process.env.HIGHLEVEL_LOCATION_ID2;
  const assignedTo = process.env.HIGHLEVEL_CALLBACK_ASSIGNED_USER_ID2;
  if (!token || !locationId) return { ok: false as const, status: null, bodyText: "", error: "HIGHLEVEL_API_TOKEN2 or HIGHLEVEL_LOCATION_ID2 is not configured" };
  const customFields: Array<{ id: string; fieldValue: string }> = [];
  const fields: Record<string, string | null | undefined> = {
    pageUrl: attribution.pageUrl, pageTitle: attribution.pageTitle, referrer: attribution.referrer,
    utmSource: attribution.utmSource, utmMedium: attribution.utmMedium, utmCampaign: attribution.utmCampaign,
    utmContent: attribution.utmContent, utmTerm: attribution.utmTerm, gclid: attribution.gclid, fbclid: attribution.fbclid,
    callbackRequestId: attribution.callbackRequestId, callbackType: attribution.callbackType,
    businessOpen: attribution.businessOpen == null ? null : String(attribution.businessOpen),
  };
  for (const [name, value] of Object.entries(fields)) {
    const envName = name.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
    const id = process.env[`HIGHLEVEL_ATTRIBUTION_${envName}_CUSTOM_FIELD_ID`];
    if (id && value) customFields.push({ id, fieldValue: value });
  }
  try {
    await assertIntegrationOutboundAllowed("highlevel");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const response = await fetcher(`${endpoint}/contacts/upsert`, {
      method: "POST", headers: headers(token), signal: controller.signal,
      body: JSON.stringify(buildHighLevelContactPayload(phone, locationId, customFields, assignedTo)),
    });
    clearTimeout(timer);
    const { body, bodyText } = await json(response);
    if (!response.ok) return { ok: false as const, status: response.status, bodyText, error: errorMessage(body, bodyText, response.status) };
    const contact = (body.contact ?? body) as Record<string, unknown>;
    const contactId = typeof contact.id === "string" ? contact.id : null;
    if (!contactId) return { ok: false as const, status: response.status, bodyText, error: "HighLevel response did not include a contact id" };
    return { ok: true as const, status: response.status, contactId, bodyText };
  } catch (error) {
    return { ok: false as const, status: null, bodyText: "", error: error instanceof Error ? error.message : "HighLevel contact request failed" };
  }
}

export async function addHighLevelWorkflow(contactId: string, fetcher: HighLevelFetcher = fetch) {
  const token = process.env.HIGHLEVEL_API_TOKEN2;
  const workflowId = process.env.HIGHLEVEL_CALLBACK_WORKFLOW_ID2;
  if (!token || !workflowId) return { ok: false as const, status: null, succeeded: null, bodyText: "", error: "HIGHLEVEL_API_TOKEN2 or HIGHLEVEL_CALLBACK_WORKFLOW_ID2 is not configured" };
  try {
    await assertIntegrationOutboundAllowed("highlevel");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const response = await fetcher(`${endpoint}/contacts/${encodeURIComponent(contactId)}/workflow/${encodeURIComponent(workflowId)}`, {
      method: "POST",
      headers: headers(token), signal: controller.signal,
      body: JSON.stringify({ eventStartTime: highLevelEventStartTime() }),
    });
    clearTimeout(timer);
    const { body, bodyText } = await json(response);
    const resultProvided = Object.prototype.hasOwnProperty.call(body, "succeeded")
      || Object.prototype.hasOwnProperty.call(body, "succeded");
    const succeeded = body.succeeded === true || body.succeded === true;
    if (!response.ok || !resultProvided || !succeeded) {
      return {
        ok: false as const,
        status: response.status,
        succeeded: resultProvided ? succeeded : null,
        bodyText,
        error: response.ok ? `HighLevel workflow response did not return succeeded=true: ${bodyText || "(empty body)"}` : errorMessage(body, bodyText, response.status),
      };
    }
    return { ok: true as const, status: response.status, succeeded: true as const, workflowId, bodyText };
  } catch (error) {
    return {
      ok: false as const,
      status: null,
      succeeded: null,
      bodyText: "",
      uncertain: true as const,
      error: error instanceof Error ? error.message : "HighLevel workflow response was not received; check HighLevel before retrying",
    };
  }
}