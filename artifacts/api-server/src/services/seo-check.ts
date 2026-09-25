/**
 * Weekly SEO & Performance Health Check
 *
 * Fetches the live shop, inspects the HTML shell, pings key API endpoints,
 * and emails a plain-English report to the notification address.
 *
 * Because the shop is a React SPA, per-page titles are client-rendered and
 * can't be verified with a plain HTTP fetch. We check:
 *   1. Shop HTML shell  — loads fast, correct static meta tags, schema.org data
 *   2. Key API routes   — products, categories, settings all respond promptly
 *   3. Structured data  — ClothingStore schema present in index.html
 *   4. useSEO coverage  — grep source files to catch any page missing the hook
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendEmail, isEmailConfigured } from "./email.js";

const API_BASE = `http://localhost:${process.env.PORT ?? 8080}`;

// ─── helpers ──────────────────────────────────────────────────────────────────

async function fetchTimed(url: string): Promise<{ ok: boolean; status: number; ms: number; body: string }> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const body = await res.text();
    return { ok: res.ok, status: res.status, ms: Date.now() - t0, body };
  } catch (err: any) {
    return { ok: false, status: 0, ms: Date.now() - t0, body: err.message ?? "error" };
  }
}

function extractMeta(html: string, attr: string, value: string): string {
  // e.g. extractMeta(html, 'name', 'description')
  const m = html.match(new RegExp(`<meta[^>]+${attr}=["']${value}["'][^>]*content=["']([^"']+)["']`, "i"))
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*${attr}=["']${value}["']`, "i"));
  return m?.[1] ?? "";
}

function checkIcon(ok: boolean) {
  return ok ? "✅" : "❌";
}

function isPublicHttpsUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password
      && host.includes(".") && host !== "localhost"
      && !host.endsWith(".localhost") && !host.endsWith(".local")
      && !/^127\./.test(host) && !/^10\./.test(host)
      && !/^192\.168\./.test(host) && !/^169\.254\./.test(host)
      && !/^172\.(1[6-9]|2\d|3[01])\./.test(host)
      && host !== "::1" && !host.startsWith("fc") && !host.startsWith("fd")
      && !host.startsWith("fe80:");
  } catch {
    return false;
  }
}

function msLabel(ms: number) {
  if (ms < 300) return `${ms}ms 🟢`;
  if (ms < 800) return `${ms}ms 🟡`;
  return `${ms}ms 🔴`;
}

// ─── source-file coverage check ───────────────────────────────────────────────

const PAGES_DIR = join(
  process.cwd(),
  // When running from dist/, walk up two levels to reach the repo root
  "../../artifacts/shop/src/pages"
);

function checkUseSEOCoverage(): { covered: string[]; missing: string[] } {
  const covered: string[] = [];
  const missing: string[] = [];

  if (!existsSync(PAGES_DIR)) {
    // Running from dist in production — skip source check
    return { covered: [], missing: [] };
  }

  const ignore = ["not-found.tsx", "OrderComplete.tsx", "Login.tsx", "Account.tsx", "Cart.tsx", "Checkout.tsx"];

  const files = readFileSync(PAGES_DIR + "/../../App.tsx", "utf8")
    .match(/import\('@\/pages\/([^']+)'\)/g)
    ?.map((m) => m.replace(/.*@\/pages\//, "").replace(/'\)/, "") + ".tsx") ?? [];

  for (const file of files) {
    if (ignore.some((i) => file.endsWith(i))) continue;
    const filePath = join(PAGES_DIR, file);
    if (!existsSync(filePath)) continue;
    const src = readFileSync(filePath, "utf8");
    if (src.includes("useSEO(")) {
      covered.push(file.replace(".tsx", ""));
    } else {
      missing.push(file.replace(".tsx", ""));
    }
  }
  return { covered, missing };
}

// ─── main check ───────────────────────────────────────────────────────────────

export async function runSeoHealthCheck(): Promise<void> {
  console.log("[seo-check] Starting weekly SEO health check");

  // 1. Get shop URL and notification email from settings
  const rows = await db.select().from(settingsTable);
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.key] = r.value as string;

  // SEO egress uses integration_enabled.external_url for HTTP checks and
  // integration_enabled.smtp for the report; shop_public_url is the target URL.
  if (settings["installation_activated"] !== "true") {
    console.warn("[seo-check] Installation is not activated — skipping outbound checks");
    return;
  }
  let integrations: unknown;
  try { integrations = JSON.parse(settings["integration_enabled"] ?? "null"); } catch {
    console.warn("[seo-check] Integration capability state is invalid — skipping outbound checks");
    return;
  }
  if (!integrations || typeof integrations !== "object" || Array.isArray(integrations)
    || (integrations as Record<string, unknown>).external_url !== true
    || (integrations as Record<string, unknown>).smtp !== true) {
    console.warn("[seo-check] External URL and SMTP integrations must be explicitly enabled — skipping outbound checks");
    return;
  }

  // Shop URL: prefer an explicit setting, fall back to dev domain
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  const shopUrl = (settings["shop_public_url"] ?? (devDomain ? `https://${devDomain}/shop` : "")).replace(/\/$/, "");
  const notifyEmail = settings["enquiry_email"] ?? settings["contact_email"] ?? settings["email"] ?? "";

  if (!shopUrl) {
    console.warn("[seo-check] No shop URL available — skipping HTTP checks");
    return;
  }
  if (!isPublicHttpsUrl(shopUrl)) {
    console.warn("[seo-check] Shop URL must be a public HTTPS URL — skipping outbound checks");
    return;
  }
  if (!notifyEmail) {
    console.warn("[seo-check] No notification email configured — skipping report");
    return;
  }
  if (!isEmailConfigured) {
    console.warn("[seo-check] Email not configured — skipping report");
    return;
  }

  // 2. Fetch shop HTML shell
  const shell = await fetchTimed(shopUrl + "/");
  const htmlOk          = shell.ok;
  const titleTag        = (shell.body.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "").trim();
  const metaDesc        = extractMeta(shell.body, "name", "description");
  const ogTitle         = extractMeta(shell.body, "property", "og:title");
  const ogDesc          = extractMeta(shell.body, "property", "og:description");
  const schemaPresent   = shell.body.includes('"@type":"ClothingStore"') || shell.body.includes('"@type": "ClothingStore"');
  const viewportOk      = shell.body.includes("maximum-scale=5") || shell.body.includes("maximum-scale=");
  const preconnectOk    = shell.body.includes('rel="preconnect"');

  // 3. Ping key API endpoints
  const [products, categories, shopSettings] = await Promise.all([
    fetchTimed(`${API_BASE}/api/shop/products?per_page=1`),
    fetchTimed(`${API_BASE}/api/shop/categories`),
    fetchTimed(`${API_BASE}/api/shop/settings`),
  ]);

  // 4. Check useSEO coverage in source files
  const { covered, missing } = checkUseSEOCoverage();

  // 5. Build report
  const now = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const allGreen =
    htmlOk && shell.ms < 800 &&
    titleTag.length > 10 &&
    metaDesc.length > 20 &&
    ogTitle.length > 5 &&
    schemaPresent &&
    products.ok && categories.ok && shopSettings.ok &&
    missing.length === 0;

  const statusLine = allGreen
    ? "✅ All checks passed — shop is healthy."
    : "⚠️ One or more checks need attention (see details below).";

  const rows2 = [
    ["", "Check", "Result"],
    ["─────────────────", "──────────────────────────────", "───────────────────────"],
    ["🌐 HTML shell",     "HTTP status",                   `${checkIcon(htmlOk)} ${shell.status}`],
    ["",                  "Response time",                 msLabel(shell.ms)],
    ["📄 Meta tags",      "<title>",                       `${checkIcon(titleTag.length > 10)} ${titleTag || "(missing)"}`],
    ["",                  "meta description",              `${checkIcon(metaDesc.length > 20)} ${metaDesc ? metaDesc.slice(0, 80) + (metaDesc.length > 80 ? "…" : "") : "(missing)"}`],
    ["",                  "og:title",                      `${checkIcon(ogTitle.length > 5)} ${ogTitle || "(missing)"}`],
    ["",                  "og:description",                `${checkIcon(ogDesc.length > 20)} ${ogDesc ? ogDesc.slice(0, 80) + (ogDesc.length > 80 ? "…" : "") : "(missing)"}`],
    ["🏷️ Structured data","ClothingStore schema",          `${checkIcon(schemaPresent)}`],
    ["📱 Mobile",         "viewport meta",                 `${checkIcon(viewportOk)}`],
    ["⚡ Performance",   "preconnect hints",              `${checkIcon(preconnectOk)}`],
    ["🔌 API",            "/shop/products",               `${checkIcon(products.ok)} ${msLabel(products.ms)}`],
    ["",                  "/shop/categories",             `${checkIcon(categories.ok)} ${msLabel(categories.ms)}`],
    ["",                  "/shop/settings",               `${checkIcon(shopSettings.ok)} ${msLabel(shopSettings.ms)}`],
  ];

  let tableHtml = `<table style="border-collapse:collapse;width:100%;font-size:13px;font-family:monospace">`;
  for (const [cat, check, result] of rows2) {
    const isHeader = cat === "";
    const bg = isHeader ? "#f8fafc" : "transparent";
    tableHtml += `<tr style="border-bottom:1px solid #e2e8f0;background:${bg}">
      <td style="padding:6px 12px;color:#64748b;white-space:nowrap">${cat}</td>
      <td style="padding:6px 12px;white-space:nowrap">${check}</td>
      <td style="padding:6px 12px">${result}</td>
    </tr>`;
  }
  tableHtml += "</table>";

  let seoSection = "";
  if (covered.length || missing.length) {
    seoSection = `
      <h3 style="margin:24px 0 8px;font-size:14px">Per-page useSEO coverage</h3>
      ${missing.length
        ? `<p style="color:#dc2626;margin:4px 0">❌ Missing useSEO on: <strong>${missing.join(", ")}</strong></p>`
        : `<p style="color:#16a34a;margin:4px 0">✅ All ${covered.length} page(s) have unique titles &amp; descriptions</p>`
      }`;
  }

  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;color:#1e293b;max-width:680px;margin:0 auto;padding:24px">
  <h1 style="font-size:20px;margin-bottom:4px">Weekly SEO &amp; Performance Report</h1>
  <p style="color:#64748b;margin-top:0">${now} · <a href="${shopUrl}" style="color:#2563eb">${shopUrl}</a></p>
  <p style="font-size:15px;font-weight:600">${statusLine}</p>
  ${tableHtml}
  ${seoSection}
  <p style="font-size:12px;color:#94a3b8;margin-top:32px">
    Response times measured server-to-server. For real-user Core Web Vitals, run
    <a href="https://pagespeed.web.dev/" style="color:#94a3b8">PageSpeed Insights</a>
    on the live URL.
  </p>
</body></html>`;

  const text = [
    `Weekly SEO & Performance Report — ${now}`,
    `Shop: ${shopUrl}`,
    "",
    statusLine,
    "",
    `HTML shell: ${htmlOk ? "OK" : "FAILED"} (${shell.ms}ms)`,
    `<title>: ${titleTag || "(missing)"}`,
    `meta description: ${metaDesc ? "present" : "MISSING"}`,
    `ClothingStore schema: ${schemaPresent ? "present" : "MISSING"}`,
    `API /shop/products: ${products.ok ? "OK" : "FAILED"} (${products.ms}ms)`,
    `API /shop/categories: ${categories.ok ? "OK" : "FAILED"} (${categories.ms}ms)`,
    `API /shop/settings: ${shopSettings.ok ? "OK" : "FAILED"} (${shopSettings.ms}ms)`,
    ...(missing.length ? [`useSEO missing on: ${missing.join(", ")}`] : []),
  ].join("\n");

  await sendEmail({
    to: notifyEmail,
    subject: `${allGreen ? "✅" : "⚠️"} Weekly SEO Report`,
    html,
    text,
  });

  console.log(`[seo-check] Report sent to ${notifyEmail} — ${allGreen ? "all green" : "issues found"}`);
}
