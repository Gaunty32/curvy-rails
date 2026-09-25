import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export const RSS_KNOWLEDGE_CENTRE_URL_DEFAULT = "";

export interface KnowledgeBasePost {
  id: number;
  title: string;
  excerpt: string;
  date: string;
  link: string;
  slug: string;
  featuredImageUrl: string | null;
  content: string;
}

function xmlText(xml: string, tag: string): string {
  const open = new RegExp(`<${tag}[^>]*>`, "i");
  const close = new RegExp(`</${tag}>`, "i");
  const match = open.exec(xml);
  if (!match) return "";
  const start = match.index + match[0].length;
  const end = close.exec(xml.slice(start));
  if (!end) return "";
  const raw = xml.slice(start, start + end.index);
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1].trim() : raw.trim();
}

function xmlAttr(xml: string, tag: string, attr: string): string {
  return new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["']`, "i").exec(xml)?.[1] ?? "";
}

function decodeXml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "–")
    .replace(/&#8230;/g, "…")
    .replace(/&hellip;/g, "…")
    .replace(/&nbsp;/g, " ");
}

function stripHtml(html: string): string {
  return decodeXml(html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
}

function extractImage(itemXml: string): string | null {
  const media = xmlAttr(itemXml, "media:content", "url") ||
    xmlAttr(itemXml, "media:thumbnail", "url");
  if (media) return decodeXml(media);

  const enclosure = /<enclosure[^>]+type=["']image\/[^"']*["'][^>]*url=["']([^"']+)["']/i.exec(itemXml)?.[1]
    ?? /<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']image\/[^"']*["']/i.exec(itemXml)?.[1];
  if (enclosure) return decodeXml(enclosure);

  const image = /<img[^>]+src=["']([^"']+)["']/i.exec(itemXml)?.[1];
  return image ? decodeXml(image) : null;
}

function stableId(value: string): number {
  return Math.abs([...value].reduce((hash, char) => (
    Math.imul(31, hash) + char.charCodeAt(0)
  ) | 0, 0));
}

export function knowledgeCentreUrl(link: string): string {
  try {
    const url = new URL(link);
    const slug = url.pathname.split("/").filter(Boolean).pop();
    return link;
  } catch {
    return link;
  }
}

export function parseKnowledgeBaseRss(xml: string): KnowledgeBasePost[] {
  if (stripHtml(xml).toLowerCase() === "feed is disabled") {
    throw new Error("RSS feed is disabled — enable it in Trysoro settings");
  }

  const itemMatches = [...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)];
  return itemMatches.map((match, index) => {
    const item = match[1];
    const title = stripHtml(xmlText(item, "title"));
    const rawLink = decodeXml(stripHtml(xmlText(item, "link")) || xmlText(item, "guid"));
    const link = knowledgeCentreUrl(rawLink);
    const content = xmlText(item, "content:encoded") || xmlText(item, "description");
    const description = xmlText(item, "description") || content;
    const plainDescription = stripHtml(description);
    const pubDate = xmlText(item, "pubDate") || xmlText(item, "dc:date");
    const parsedDate = pubDate ? new Date(pubDate) : new Date();
    const date = Number.isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString();
    const guid = decodeXml(xmlText(item, "guid") || link);
    const slug = new URL(link).pathname.split("/").filter(Boolean).pop() || String(index);

    return {
      id: stableId(guid),
      title,
      excerpt: plainDescription.slice(0, 280) + (plainDescription.length > 280 ? "…" : ""),
      date,
      link,
      slug,
      featuredImageUrl: extractImage(item),
      content,
    };
  });
}

export async function fetchKnowledgeBaseRss(
  url?: string,
): Promise<KnowledgeBasePost[]> {
  // Callers supplying the configured RSS URL still require installation activation
  // and integration_enabled.rss; setup status must never trigger feed egress.
  if (!url?.trim()) throw new Error("Knowledge Centre RSS URL is not configured.");
  const result = await db.execute(sql`
    SELECT key, value FROM settings
    WHERE key IN ('installation_activated', 'integration_enabled')
  `);
  const settings = new Map<string, string>(
    ((result.rows ?? result) as Array<{ key: string; value: string | null }>)
      .map((row) => [row.key, row.value ?? ""]),
  );
  if (settings.get("installation_activated") !== "true") {
    throw new Error("Outbound RSS request blocked until installation activation.");
  }
  let integrations: unknown;
  try { integrations = JSON.parse(settings.get("integration_enabled") ?? "null"); } catch {
    throw new Error("Outbound integration capability state is invalid; RSS fetch is blocked.");
  }
  if (!integrations || typeof integrations !== "object" || Array.isArray(integrations)
    || (integrations as Record<string, unknown>).rss !== true) {
    throw new Error("RSS integration is not explicitly enabled.");
  }
  let feedUrl: URL;
  try { feedUrl = new URL(url); } catch { throw new Error("Knowledge Centre RSS URL is invalid."); }
  const host = feedUrl.hostname.toLowerCase();
  if (feedUrl.protocol !== "https:" || feedUrl.username || feedUrl.password || !host.includes(".")
    || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")
    || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) {
    throw new Error("Knowledge Centre RSS URL must be a public HTTPS URL.");
  }
  const response = await fetch(feedUrl.toString(), { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`RSS fetch error ${response.status}`);
  return parseKnowledgeBaseRss(await response.text());
}