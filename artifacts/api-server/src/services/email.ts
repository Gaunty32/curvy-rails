import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";
import { db, settingsTable, ordersTable, orderItemsTable, customersTable, customerEmployeesTable, customerDeliveryAddressesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { getResendClient } from "./resend-client.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { getUncachableStripeClient } from "./stripeClient.js";
import { getTemplate, applyVars } from "./template-engine.js";
import { getBusinessConfig, configuredBusinessName, requireConfiguredBusinessIdentity, type ConfiguredBusinessIdentity } from "../lib/business-config.js";
import { assertIntegrationOutboundAllowed } from "../setup/outbound-gate.js";

// Logo bytes are never bundled in the transfer. A future installation may
// provide a logo through business_config.logoUrl and fetchLogoBuffer.
// Contact details and branding are installation configuration, never source
// defaults. These empty values intentionally keep generated messages safe until
// the configured installation supplies them.
const BUSINESS_LOGO_BUFFER: Buffer | null = null;
const BUSINESS_LOGO_DATA_URL = "";
const BUSINESS_LOGO_COLOUR_DATA_URL = "";
const BUSINESS_PHONE_DISPLAY = "";
const BUSINESS_PHONE_HREF = "";
const BUSINESS_WHATSAPP_URL = "";
const BUSINESS_CHAT_URL = "";
const BUSINESS_EMAIL_LOGO_URL = "";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]!);
}

function businessTelephoneHref(phone: string): string {
  const safe = phone.replace(/[^\d+]/g, "");
  return `tel:${safe}`;
}

/** Replace the legacy source placeholders at the last async boundary before delivery. */
export function applyBusinessIdentityToEmail<T extends { html: string; text: string }>(
  message: T,
  identity: ConfiguredBusinessIdentity,
): T {
  const needsIdentity = /Configured organisation|configured organisation|Contact details configured|Contact details are configured|available from the installation settings|configured payment provider|Not configured/i.test(`${message.html}\n${message.text}`);
  if (!needsIdentity) return message;

  const businessNameHtml = escapeHtml(identity.name);
  const businessEmailHtml = escapeHtml(identity.email);
  const businessPhoneHtml = escapeHtml(identity.phone);
  const businessContactHtml = `<a href="mailto:${businessEmailHtml}">${businessEmailHtml}</a> · <a href="${escapeHtml(businessTelephoneHref(identity.phone))}">${businessPhoneHtml}</a>`;
  let html = message.html
    .replace(/Contact details configured per installation/gi, () => businessContactHtml)
    .replace(/Contact details are configured per installation/gi, () => businessContactHtml)
    .replace(/Contact details: available from the installation settings/gi, () => `Email: ${businessEmailHtml}; Phone: ${businessPhoneHtml}`)
    .replace(/Payment details: available from the configured payment provider/gi, () => "For bank transfer details, please contact us using the details below.")
    .replace(/The configured organisation team/gi, () => `The ${businessNameHtml} team`)
    .replace(/From the configured organisation/gi, () => `From ${businessNameHtml}`)
    .replace(/Questions\? Contact the configured organisation\./gi, () => `Questions? Contact ${businessNameHtml}.`)
    .replace(/Configured organisation/gi, () => businessNameHtml);
  html = html.replace(/<a href="" style="([^"]*)">\s*<\/a>/gi, (_match, style: string) =>
    `<a href="${escapeHtml(businessTelephoneHref(identity.phone))}" style="${style}">${businessPhoneHtml}</a>`);
  // These legacy acknowledgement rows imply bank data exists when it does not.
  html = html.replace(/<tr[^>]*>\s*<td[^>]*>Sort code<\/td>[\s\S]*?<\/tr>\s*<tr[^>]*>\s*<td[^>]*>Account number<\/td>[\s\S]*?<\/tr>/i, "");
  html = html.replace(/(<td[^>]*>Account name<\/td>\s*<td[^>]*>)[\s\S]*?(<\/td>)/i, `$1${businessNameHtml}$2`);
  const text = message.text
    .replace(/Contact details configured per installation/gi, () => `${identity.email} · ${identity.phone}`)
    .replace(/Contact details are configured per installation/gi, () => `${identity.email} · ${identity.phone}`)
    .replace(/Contact details: available from the installation settings/gi, () => `Email: ${identity.email}; Phone: ${identity.phone}`)
    .replace(/Payment details: available from the configured payment provider/gi, "For bank transfer details, please contact us using the details below.")
    .replace(/The configured organisation team/gi, () => `The ${identity.name} team`)
    .replace(/Questions\? Contact the configured organisation\./gi, () => `Questions? Contact ${identity.name}.`)
    .replace(/configured organisation/gi, () => identity.name)
    .replace(/Configured organisation/g, () => identity.name);
  return { ...message, html, text };
}

async function applyConfiguredIdentityToEmail<T extends { html: string; text: string }>(message: T): Promise<T> {
  const needsIdentity = /Configured organisation|configured organisation|Contact details configured|Contact details are configured|available from the installation settings|configured payment provider|Not configured/i.test(`${message.html}\n${message.text}`);
  return needsIdentity
    ? applyBusinessIdentityToEmail(message, await requireConfiguredBusinessIdentity())
    : message;
}

// ── Logo fetch helpers ────────────────────────────────────────────────────────
/** Resolve a potentially-relative storage path to an absolute URL the server can fetch. */
function toAbsoluteUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const port = process.env.PORT ?? 8080;
  return `http://localhost:${port}${url.startsWith("/") ? "" : "/"}${url}`;
}

/**
 * Normalise a logo URL to the internal `/objects/…` form expected by
 * ObjectStorageService.getObjectEntityFile(), or return null if the URL is
 * not a Replit object-storage path.
 */
function toObjectStoragePath(url: string): string | null {
  if (url.startsWith("/objects/")) return url;
  if (url.startsWith("/api/storage/objects/")) return url.replace("/api/storage/objects/", "/objects/");
  return null;
}

async function readObjectStorageBuffer(objectPath: string): Promise<Buffer | null> {
  try {
    const svc = new ObjectStorageService();
    const file = await svc.getObjectEntityFile(objectPath);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = file.createReadStream();
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    return Buffer.concat(chunks);
  } catch { return null; }
}

export async function fetchLogoBuffer(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const objectPath = toObjectStoragePath(url);
    if (objectPath) return await readObjectStorageBuffer(objectPath);
    const resp = await fetch(toAbsoluteUrl(url), {
      signal: AbortSignal.timeout(8000),
      headers: {
        "Accept": "image/webp,image/jpeg,image/png,image/*,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; ConfiguredOrganisation/1.0)",
      },
    });
    if (!resp.ok) return null;
    return Buffer.from(await resp.arrayBuffer());
  } catch { return null; }
}

export async function fetchLogoDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const objectPath = toObjectStoragePath(url);
    if (objectPath) {
      const buf = await readObjectStorageBuffer(objectPath);
      if (!buf) return null;
      const ext = url.split(".").pop()?.toLowerCase() ?? "png";
      const mimeMap: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };
      const mime = mimeMap[ext] ?? "image/png";
      return `data:${mime};base64,${buf.toString("base64")}`;
    }
    const resp = await fetch(toAbsoluteUrl(url), {
      signal: AbortSignal.timeout(8000),
      headers: {
        "Accept": "image/webp,image/jpeg,image/png,image/*,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; ConfiguredOrganisation/1.0)",
      },
    });
    if (!resp.ok) return null;
    const ct = resp.headers.get("content-type") ?? "image/png";
    return `data:${ct};base64,${Buffer.from(await resp.arrayBuffer()).toString("base64")}`;
  } catch { return null; }
}

function toFirstName(name: string | null | undefined): string {
  if (!name?.trim()) return "there";
  const first = name.trim().split(/\s+/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

// Resend is available when the Replit Connectors proxy is present
const isResendAvailable = !!(process.env.REPLIT_CONNECTORS_HOSTNAME);

const isSmtpConfigured = !!(
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
);

// isEmailConfigured = true if either Resend or SMTP is available
export const isEmailConfigured = isResendAvailable || isSmtpConfigured;

const smtpTransporter = isSmtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT ?? "587"),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

export async function sendEmail(opts: {
  to: string | string[];
  cc?: string | string[];
  subject: string;
  html: string;
  text: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
  idempotencyKey?: string;
}): Promise<{ sent: boolean; messageId?: string; provider?: string; error?: string }> {
  try {
    await assertIntegrationOutboundAllowed("smtp");
  } catch (error) {
    return { sent: false, error: error instanceof Error ? error.message : "Email outbound capability state is unavailable." };
  }
  // Email is an external write. It is disabled until this installation is
  // explicitly active and the transactional-email automation is enabled.
  const [activation, automation] = await Promise.all([
    db.select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, "installation_activated")),
    db.select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, "automation_enabled")),
  ]);
  if (activation[0]?.value !== "true") {
    return { sent: false, error: "Email delivery is blocked until installation activation." };
  }
  let automations: Record<string, boolean> = {};
  try { automations = JSON.parse(automation[0]?.value ?? "{}") as Record<string, boolean>; } catch {}
  if (automations.email !== true) {
    return { sent: false, error: "Transactional email automation is disabled." };
  }
  let outgoing: { html: string; text: string };
  try {
    outgoing = await applyConfiguredIdentityToEmail(opts);
  } catch (error) {
    return { sent: false, error: error instanceof Error ? error.message : "Business identity is not configured." };
  }

  // Normalise `to` into a clean array (handles "a@b.com, c@d.com" or arrays)
  const toArr = (Array.isArray(opts.to)
    ? opts.to
    : opts.to.split(",").map(e => e.trim())
  ).filter(Boolean);

  // ── Resend (preferred) ──────────────────────────────────────────────────────
  if (isResendAvailable) {
    try {
      const { client } = await getResendClient();
      const config = await getBusinessConfig();
      const fromEmail = config?.email?.trim();
      if (!fromEmail) return { sent: false, provider: "resend", error: "Business sender email is not configured." };
      const from = `${configuredBusinessName(config)} <${fromEmail}>`;
      const ccArr = opts.cc
        ? (Array.isArray(opts.cc) ? opts.cc : [opts.cc])
        : undefined;
      let requestOptions: { headers: Headers } | undefined;
      if (opts.idempotencyKey) {
        const headers = new Headers((client as any).headers);
        headers.set("Idempotency-Key", opts.idempotencyKey);
        requestOptions = { headers };
      }
      await assertIntegrationOutboundAllowed("smtp");
      const { data, error } = await (client.emails.send as any)(
        {
          from,
          to: toArr,
          ...(ccArr?.length ? { cc: ccArr } : {}),
          subject: opts.subject,
          html: outgoing.html,
          text: outgoing.text,
          attachments: opts.attachments?.map((a) => ({
            filename: a.filename,
            content: a.content,
          })),
        },
        requestOptions,
      );
      if (error) {
        if (opts.idempotencyKey) {
          return { sent: false, provider: "resend", error: error.message };
        }
        console.error("[email] Resend error:", error.message, "— trying SMTP fallback");
      } else {
        return { sent: true, messageId: (data as any)?.id, provider: "resend" };
      }
    } catch (err: any) {
      if (opts.idempotencyKey) {
        return { sent: false, provider: "resend", error: err.message };
      }
      // If connector fails for any reason, fall through to SMTP
      console.error("[email] Resend failed, trying SMTP fallback:", err.message);
    }
  }

  // ── SMTP fallback ───────────────────────────────────────────────────────────
  if (opts.idempotencyKey) {
    return { sent: false, error: "Idempotent email delivery requires Resend" };
  }
  if (!smtpTransporter) return { sent: false, error: "Email not configured (no Resend and no SMTP)" };
  try {
    const config = await getBusinessConfig();
    const from = config?.email ? `${configuredBusinessName(config)} <${config.email}>` : undefined;
    if (!from) return { sent: false, error: "Business sender email is not configured." };
    await assertIntegrationOutboundAllowed("smtp");
    const info = await smtpTransporter.sendMail({ from, ...opts, ...outgoing });
    return { sent: true, messageId: info.messageId, provider: "smtp" };
  } catch (err: any) {
    return { sent: false, error: err.message };
  }
}

export function buildAcknowledgementEmail(order: {
  orderNumber: string;
  customerName: string | null;
  /** Name of the person who placed the order (e.g. portal submitter) — highest priority for greeting */
  portalSubmittedByName?: string | null;
  contactFirstName?: string | null;
  customerLogoDataUrl?: string | null;
  shippingMethod?: string | null;
  orderDate: Date | null;
  requiredDate?: Date | null;
  notes?: string | null;
  totalAmount?: number | null;
  carriageAmount?: number | null;
  stripePaymentLink?: string | null;
  items: Array<{
    productName: string;
    colour?: string | null;
    size?: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    recipientName?: string | null;
  }>;
}): { subject: string; html: string; text: string } {
  const subject = `Order Acknowledged — Ref ${order.orderNumber}`;

  const stripeLink = order.stripePaymentLink ?? null;
  const firstName = toFirstName(order.portalSubmittedByName ?? order.contactFirstName ?? order.customerName);

  const itemRows = order.items
    .map(
      (i) =>
        `<tr>
          <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#1e293b;">${i.productName}${i.finishName ? `<br><span style="font-size:11px;color:#6366f1;font-weight:600;">Finish: ${i.finishName}</span>` : ""}${i.recipientName ? `<br><span style="font-size:11px;color:#94a3b8;">For: ${i.recipientName}</span>` : ""}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;">${[i.colour, i.size].filter(Boolean).join(" / ") || "—"}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:center;font-size:13px;font-weight:600;color:#1e293b;">${i.quantity}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;color:#64748b;">£${i.unitPrice.toFixed(2)}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;font-weight:700;color:#1e293b;">£${i.lineTotal.toFixed(2)}</td>
        </tr>`
    )
    .join("\n");

  const subtotal = order.totalAmount ?? order.items.reduce((s, i) => s + i.lineTotal, 0);
  const emailCarriage = order.carriageAmount ?? 0;
  const vatAmount = order.items.reduce((s, i) => s + i.lineTotal * (i.vatRate ?? 0.20), 0) + emailCarriage * 0.20;
  const totalIncVat = subtotal + emailCarriage + vatAmount;
  const uniqueVatRates = [...new Set(order.items.map(i => i.vatRate ?? 0.20))];
  const vatLabel = uniqueVatRates.length === 1
    ? `VAT (${Math.round(uniqueVatRates[0] * 100)}%)`
    : "VAT";

  const customerLogoBlock = order.customerLogoDataUrl
    ? `<td style="vertical-align:middle;text-align:right;">
        <p style="margin:0 0 6px;color:#64748b;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Prepared for</p>
        <img src="${order.customerLogoDataUrl}" alt="${order.customerName ?? "Customer"}" height="38" style="display:block;height:38px;width:auto;max-width:130px;margin-left:auto;" />
      </td>`
    : `<td style="vertical-align:middle;text-align:right;">
        <p style="margin:0;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Order Acknowledgement</p>
        <p style="margin:4px 0 0;color:#fff;font-size:17px;font-weight:700;">Ref: ${order.orderNumber}</p>
      </td>`;

  const orderRefSubBar = order.customerLogoDataUrl
    ? `<tr><td style="background:#0f172a;padding:10px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><p style="margin:0;color:#64748b;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Order Acknowledgement</p>
          <p style="margin:2px 0 0;color:#fff;font-size:15px;font-weight:700;">Ref: ${order.orderNumber}</p></td>
        </tr></table>
      </td></tr>`
    : "";

  const SHIPPING_LABELS: Record<string, string> = {
    free_local: "Free Local Delivery",
    dpd: "DPD Courier", royal_mail: "Royal Mail", local_delivery: "Local Delivery",
    office_collection: "Office Collection", warehouse_collection: "Collection from our warehouse", courier: "Courier",
    dpd_next_day: "Courier",
  };
  const shippingLabel = order.shippingMethod ? (SHIPPING_LABELS[order.shippingMethod] ?? order.shippingMethod) : null;
  const isFreeLocal = order.shippingMethod === "free_local";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.10);">

        <!-- Header: installed business identity + customer logo or order ref -->
        <tr><td style="background:#1e293b;padding:22px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;">
              <span>Configured organisation</span>
            </td>
            ${customerLogoBlock}
          </tr></table>
        </td></tr>
        ${orderRefSubBar}

        <!-- Greeting band: solid navy (gradients unreliable in email) -->
        <tr><td style="background:#1e3a5f;padding:24px 32px;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;line-height:1.3;">Thank you, ${firstName}!</p>
          <p style="margin:6px 0 0;font-size:14px;color:#93c5fd;line-height:1.5;">We're delighted to have received your order and can't wait to get started.</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:28px 32px 0;">
          <p style="margin:0 0 12px;font-size:14px;color:#374151;line-height:1.7;">
            We've put together the details below for your records. Please check everything looks right — particularly the garments, colours, sizes and any finishes. If anything needs adjusting, just get in touch and we'll sort it straight away.
          </p>
          <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.7;">
            If you would prefer to see a summary of the order rather than the full details you can check the attached PDF.
          </p>
        </td></tr>

        <!-- Items table -->
        <tr><td style="padding:0 32px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;overflow:hidden;">
            <thead>
              <tr style="background:#1e293b;">
                <th style="padding:10px 12px;text-align:left;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Product</th>
                <th style="padding:10px 12px;text-align:left;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Colour / Size</th>
                <th style="padding:10px 12px;text-align:center;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Qty</th>
                <th style="padding:10px 12px;text-align:right;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Unit</th>
                <th style="padding:10px 12px;text-align:right;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Total</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
            <tfoot>
              <tr style="background:#f8fafc;">
                <td colspan="4" style="padding:10px 12px;text-align:right;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;">Subtotal (exc. VAT)</td>
                <td style="padding:10px 12px;text-align:right;font-size:13px;font-weight:600;color:#1e293b;border-top:1px solid #e2e8f0;">£${subtotal.toFixed(2)}</td>
              </tr>
              ${emailCarriage > 0 ? `<tr style="background:#f8fafc;">
                <td colspan="4" style="padding:6px 12px;text-align:right;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;">Shipping &amp; Handling</td>
                <td style="padding:6px 12px;text-align:right;font-size:13px;color:#64748b;border-top:1px solid #e2e8f0;">£${emailCarriage.toFixed(2)}</td>
              </tr>` : ""}
              <tr style="background:#f8fafc;">
                <td colspan="4" style="padding:6px 12px;text-align:right;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;">${vatLabel}</td>
                <td style="padding:6px 12px;text-align:right;font-size:13px;color:#64748b;border-top:1px solid #e2e8f0;">£${vatAmount.toFixed(2)}</td>
              </tr>
              <tr style="background:#1e293b;">
                <td colspan="4" style="padding:12px;text-align:right;font-size:13px;font-weight:700;color:#ffffff;letter-spacing:0.3px;">Total (inc. VAT)</td>
                <td style="padding:12px;text-align:right;font-size:15px;font-weight:800;color:#ffffff;">£${totalIncVat.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </td></tr>

        ${order.notes ? `<tr><td style="padding:0 32px 16px;"><div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:12px 16px;"><p style="margin:0;font-size:13px;color:#92400e;"><strong>Order notes:</strong> ${order.notes}</p></div></td></tr>` : ""}

        <!-- Payment section -->
        <tr><td style="padding:0 32px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;overflow:hidden;">
            <tr><td style="background:#f8fafc;padding:14px 18px;border-bottom:1px solid #e2e8f0;">
              <p style="margin:0;font-size:13px;font-weight:700;color:#1e293b;text-transform:uppercase;letter-spacing:0.5px;">Payment Options</p>
              <p style="margin:4px 0 0;font-size:13px;color:#64748b;">Pay securely by card online or by BACS transfer.</p>
            </td></tr>
            <tr><td style="padding:16px 18px;">
              <!-- Pay by card button: solid background (gradients unreliable in email) -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
                <tr><td style="background:#1e3a5f;border-radius:6px;">
                  <a href="${stripeLink}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.3px;">
                    Pay by Card Online &#8594;
                  </a>
                </td></tr>
              </table>
              <!-- BACS details -->
              <table cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;border-collapse:collapse;min-width:260px;">
                <tr style="background:#f1f5f9;">
                  <td colspan="2" style="padding:8px 12px;font-size:10px;font-weight:700;color:#64748b;letter-spacing:0.8px;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">BACS Bank Transfer</td>
                </tr>
                <tr>
                  <td style="padding:7px 12px;font-size:12px;color:#64748b;white-space:nowrap;">Account name</td>
                  <td style="padding:7px 12px;font-size:12px;font-weight:600;color:#1e293b;">Configured organisation</td>
                </tr>
                <tr style="background:#f8fafc;">
                  <td style="padding:7px 12px;font-size:12px;color:#64748b;white-space:nowrap;">Sort code</td>
                  <td style="padding:7px 12px;font-size:12px;font-weight:600;color:#1e293b;font-family:monospace;">Not configured</td>
                </tr>
                <tr>
                  <td style="padding:7px 12px;font-size:12px;color:#64748b;white-space:nowrap;">Account number</td>
                  <td style="padding:7px 12px;font-size:12px;font-weight:600;color:#1e293b;font-family:monospace;">Not configured</td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td></tr>

        <!-- Shipping method -->
        ${shippingLabel ? `<tr><td style="padding:0 32px 12px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;overflow:hidden;">
            <tr><td style="background:#f8fafc;padding:10px 18px;border-bottom:1px solid #e2e8f0;">
              <p style="margin:0;font-size:13px;font-weight:700;color:#1e293b;text-transform:uppercase;letter-spacing:0.5px;">Shipping &amp; Collection</p>
            </td></tr>
            <tr><td style="padding:10px 18px;">
              <p style="margin:0;font-size:13px;font-weight:600;color:#374151;">${shippingLabel}</p>
              ${isFreeLocal ? `<p style="margin:6px 0 0;font-size:12px;color:#4b5563;line-height:1.6;">As you are local to us we offer free delivery to your postcode on a <strong>Tuesday</strong> and a <strong>Friday</strong>. We will let you know on the morning of your delivery and you can expect to see Tim with your order before lunchtime!</p>` : ""}
            </td></tr>
          </table>
        </td></tr>` : ""}

        <!-- Contact details -->
        <tr><td style="padding:0 32px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dbeafe;border-radius:8px;border-collapse:collapse;overflow:hidden;">
            <tr><td style="background:#eff6ff;padding:12px 18px;border-bottom:1px solid #dbeafe;">
              <p style="margin:0;font-size:13px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.5px;">Need Help? We're Here For You</p>
            </td></tr>
            <tr><td style="padding:14px 18px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:5px 0;width:50%;vertical-align:top;">
                    <p style="margin:0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Email</p>
                    <span>Contact details configured per installation</span>
                  </td>
                  <td style="padding:5px 0;width:50%;vertical-align:top;">
                    <p style="margin:0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Phone</p>
                    <a href="${BUSINESS_PHONE_HREF}" style="font-size:13px;color:#1e293b;text-decoration:none;font-weight:500;">${BUSINESS_PHONE_DISPLAY}</a>
                  </td>
                </tr>
                <tr>
                  <td style="padding:5px 0;vertical-align:top;">
                    <p style="margin:0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">WhatsApp</p>
                    <a href="${BUSINESS_WHATSAPP_URL}" style="font-size:13px;color:#16a34a;text-decoration:none;font-weight:500;">Message us on WhatsApp</a>
                  </td>
                  <td style="padding:5px 0;vertical-align:top;">
                    <p style="margin:0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Live Chat</p>
                    <a href="${BUSINESS_CHAT_URL}" style="font-size:13px;color:#1d4ed8;text-decoration:none;font-weight:500;">Chat on our website</a>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td></tr>

        <!-- Closing -->
        <tr><td style="padding:0 32px 28px;">
          <p style="font-size:14px;color:#374151;margin:0 0 16px;line-height:1.7;">
            Our team will keep you updated as your order progresses. Please don't hesitate to contact us any time — we're always happy to help.
          </p>
          <p style="font-size:14px;color:#374151;margin:0;line-height:1.6;">
            With warm regards,<br>
            <strong style="color:#1e293b;font-size:15px;">The configured organisation team</strong>
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f8fafc;padding:14px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;line-height:1.8;">
            Contact details configured per installation<br>
            &middot; <a href="${BUSINESS_PHONE_HREF}" style="color:#94a3b8;text-decoration:none;">${BUSINESS_PHONE_DISPLAY}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `Order Acknowledged — Ref ${order.orderNumber}`,
    ``,
    `Hi ${firstName},`,
    ``,
    `Thank you so much for your order — we're delighted to be working with you!`,
    ``,
    `Your order reference is ${order.orderNumber}. Please take a moment to check everything below looks right — garments, colours, sizes and finishes. If anything needs adjusting, just say the word.`,
    ``,
    `ITEMS:`,
    ...order.items.map(
      (i) =>
        `  ${i.productName}${[i.colour, i.size].filter(Boolean).length ? ` (${[i.colour, i.size].filter(Boolean).join(", ")})` : ""}${i.recipientName ? ` — For: ${i.recipientName}` : ""} – Qty: ${i.quantity} @ £${i.unitPrice.toFixed(2)} = £${i.lineTotal.toFixed(2)}`
    ),
    ``,
    ``,
    `Subtotal (exc. VAT): £${subtotal.toFixed(2)}`,
    `VAT (20%):           £${vatAmount.toFixed(2)}`,
    `Total (inc. VAT):    £${totalIncVat.toFixed(2)}`,
    ``,
    `PAYMENT OPTIONS:`,
    `  Pay by card online: ${stripeLink}`,
    ``,
    `  BACS Transfer:`,
    `    Payment details: available from the configured payment provider`,
    ``,
    order.notes ? `Order notes: ${order.notes}\n` : null,
    `CONTACT US:`,
    `  Contact details: available from the installation settings`,
    ``,
    `Our team will keep you updated as your order progresses. Please reach out any time — we're always happy to help.`,
    ``,
    `With warm regards,`,
    `The configured organisation team`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  return { subject, html, text };
}

// ─── Order Acknowledgement PDF ────────────────────────────────────────────────

export interface AckOrderItem {
  productName: string;
  sku?: string | null;
  colour?: string | null;
  size?: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  /** VAT rate as a decimal. 0.20 = 20%, 0 = zero-rated. Defaults to 0.20 if omitted. */
  vatRate?: number;
  recipientName?: string | null;
  finishName?: string | null;
  /** Groups items that belong to the same bundle instance in an order. */
  bundleRef?: string | null;
  /** True for the header row that carries the bundle price; false for component rows (price £0). */
  isBundleHeader?: boolean;
}

export interface AckOrderData {
  orderNumber: string;
  orderDate: Date | string | null;
  requiredDate?: Date | string | null;
  poNumber?: string | null;
  customerRef?: string | null;
  customerName: string | null;
  customerAddress?: string | null;
  customerCity?: string | null;
  customerPostcode?: string | null;
  deliveryAddress?: string | null;
  shippingMethod?: string | null;
  customerLogoBuffer?: Buffer | null;
  totalAmount?: number | null;
  shippingAmount?: number | null;
  vatRate?: number;
  /** When true all VAT is suppressed on the PDF (Channel Islands / zero-rated customers) */
  zeroVat?: boolean;
  items: AckOrderItem[];
  /** When set (multi-address orders), items are grouped and rendered under per-address section headers */
  deliveryGroups?: Array<{ addressLabel: string; addressText: string; items: AckOrderItem[] }>;
}

export async function generateOrderAcknowledgementPdf(order: AckOrderData): Promise<Buffer> {
  const identity = await requireConfiguredBusinessIdentity();
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 32, size: "A4", autoFirstPage: true, compress: false });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const margin = 32;
    const contentW = pageW - margin * 2;

    const fmtDate = (d: Date | string | null | undefined) =>
      d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";

    // ── Header bar (with logos) ───────────────────────────────────────────────
    const hdrH = 52;
    doc.rect(margin, margin, contentW, hdrH).fill("#1e293b");

    // Installation logo (left side of header)
    if (BUSINESS_LOGO_BUFFER) {
      try { doc.image(BUSINESS_LOGO_BUFFER, margin + 8, margin + 6, { fit: [110, 40], valign: "center" }); } catch {}
    }

    // "Order Acknowledgement" title centred in remaining space
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#ffffff")
      .text("Order Acknowledgement", margin + 130, margin + 13, { width: contentW - 260, align: "center" });

    // Customer logo (right side of header)
    if (order.customerLogoBuffer) {
      try { doc.image(order.customerLogoBuffer, margin + contentW - 100, margin + 6, { fit: [92, 40], align: "right", valign: "center" }); } catch {}
    }

    // ── Customer address + installation contact (two columns) ─────────────
    const addrY = margin + hdrH + 8;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111827").text(order.customerName ?? "", margin, addrY);
    const addrLines = [order.customerAddress, order.customerCity, order.customerPostcode].filter(Boolean) as string[];
    doc.font("Helvetica").fontSize(8).fillColor("#444444");
    addrLines.forEach((line, i) => doc.text(line, margin, addrY + 11 + i * 10));

    const sbsX = margin + contentW - 170;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#111827").text(identity.name, sbsX, addrY, { width: 170, align: "right" });
    doc.font("Helvetica").fontSize(7.5).fillColor("#555555");
    doc.text(identity.email, sbsX, addrY + 11, { width: 170, align: "right" });
    doc.text(identity.phone, sbsX, addrY + 21, { width: 170, align: "right" });

    // ── Divider ───────────────────────────────────────────────────────────────
    const divY = addrY + 11 + Math.max(addrLines.length, 2) * 10 + 8;
    doc.moveTo(margin, divY).lineTo(margin + contentW, divY).strokeColor("#d1d5db").lineWidth(0.5).stroke();

    // ── Order info strip ──────────────────────────────────────────────────────
    const infoY = divY + 5;
    const SHIP_LABELS_HDR: Record<string, string> = {
      free_local: "Free Local", local_delivery: "Local Delivery",
      office_collection: "Office Collection", warehouse_collection: "Warehouse Collection",
      courier: "Courier", dpd: "DPD Courier", dpd_next_day: "Courier",
    };
    const infoCols = [
      { label: "Order Date", value: fmtDate(order.orderDate) },
      { label: "Account No", value: order.customerRef ?? "—" },
      { label: "Required By", value: fmtDate(order.requiredDate) },
      { label: "Cust PO Ref", value: order.poNumber ?? "—" },
      { label: "Order Ref",   value: order.orderNumber },
      { label: "Shipping",    value: order.shippingMethod ? (SHIP_LABELS_HDR[order.shippingMethod] ?? order.shippingMethod) : "—" },
    ];
    const colW = contentW / infoCols.length;
    infoCols.forEach(({ label, value }, i) => {
      const x = margin + i * colW;
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#6b7280").text(label, x, infoY, { width: colW - 4 });
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#111827").text(value, x, infoY + 9, { width: colW - 4 });
    });

    // ── Items table ───────────────────────────────────────────────────────────
    type Group = {
      productName: string;
      sku: string | null;
      finishName: string | null;
      recipientName: string | null;
      unitPrice: number;
      colours: string[];
      sizes: string[];
      qty: Map<string, Map<string, number>>;
      lineTotal: number;
      vatRate: number;
      bundleRef: string | null;
      isBundleHeader: boolean;
    };

    // Collect all items across all delivery groups (or fall back to order.items)
    const allItemsFlat: AckOrderItem[] = order.deliveryGroups?.length
      ? order.deliveryGroups.flatMap(g => g.items)
      : order.items;

    const allSizes: string[] = [];
    for (const item of allItemsFlat) {
      const s = normalizeSize(item.size ?? "One Size");
      if (!item.isBundleHeader && !allSizes.includes(s)) allSizes.push(s);
    }
    allSizes.sort((a, b) => {
      const ai = SIZE_ORDER.indexOf(a); const bi = SIZE_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1; if (bi !== -1) return 1;
      return a.localeCompare(b);
    });

    const tableStartY = infoY + 26;
    const rowH = 13;
    const tblHdrH = 22;
    const colourW    = 76;
    const unitPriceW = 44;
    const totalW     = 48;
    const qtyW       = 28;
    const sizeColW   = allSizes.length > 0 ? Math.min(36, Math.floor((contentW * 0.28) / allSizes.length)) : 36;
    const sizeW      = sizeColW * Math.max(allSizes.length, 1);
    const itemNameW  = contentW - colourW - sizeW - qtyW - unitPriceW - totalW;
    const tableW     = contentW;

    const drawTableHeader = (ty: number) => {
      doc.rect(margin, ty, tableW, tblHdrH).fill("#1e293b");
      doc.fillColor("#94a3b8").fontSize(6.5).font("Helvetica-Bold");
      let hx = margin;
      doc.text("ITEM", hx + 3, ty + 4, { width: itemNameW - 3 }); hx += itemNameW;
      doc.text("COLOUR", hx + 3, ty + 4, { width: colourW - 3 }); hx += colourW;
      for (const sz of allSizes) {
        doc.text(sz, hx + 2, ty + 4, { width: sizeColW - 2, align: "center" }); hx += sizeColW;
      }
      doc.text("QTY", hx + 2, ty + 4, { width: qtyW - 2, align: "center" }); hx += qtyW;
      doc.text("UNIT", hx + 2, ty + 4, { width: unitPriceW - 2, align: "right" }); hx += unitPriceW;
      doc.text("TOTAL", hx + 2, ty + 4, { width: totalW - 2, align: "right" });
    };

    drawTableHeader(tableStartY);
    let y = tableStartY + tblHdrH;
    let rowAlt = false;

    // Helper: build groups from an item list and render them into the table
    const renderItems = (itemList: AckOrderItem[]) => {
      const rGroupKeys: string[] = [];
      const rGroups = new Map<string, Group>();
      const sortedGItems = [...itemList].sort((a, b) => {
        const aB = !!(a.bundleRef), bB = !!(b.bundleRef);
        if (aB !== bB) return aB ? -1 : 1;
        if (aB && bB) {
          const rc = (a.bundleRef ?? "").localeCompare(b.bundleRef ?? "");
          if (rc !== 0) return rc;
          if (a.isBundleHeader !== b.isBundleHeader) return a.isBundleHeader ? -1 : 1;
        }
        return ((a.sku ?? a.productName ?? "").toLowerCase()).localeCompare(((b.sku ?? b.productName ?? "").toLowerCase()));
      });
      for (const item of sortedGItems) {
        const gk = item.bundleRef
          ? (item.isBundleHeader
              ? `__BDL_HDR__:${item.bundleRef}`
              : `__BDL_CMP__:${item.bundleRef}:${item.productName}||${item.finishName ?? ""}`)
          : `${item.productName}||${item.finishName ?? ""}||${item.recipientName ?? ""}||${item.unitPrice}`;
        if (!rGroups.has(gk)) {
          rGroupKeys.push(gk);
          rGroups.set(gk, { productName: item.productName, sku: item.sku ?? null, finishName: item.finishName ?? null, recipientName: item.recipientName ?? null, unitPrice: item.unitPrice, colours: [], sizes: [], qty: new Map(), lineTotal: 0, vatRate: item.vatRate ?? 0.20, bundleRef: item.bundleRef ?? null, isBundleHeader: item.isBundleHeader ?? false });
        }
        const g = rGroups.get(gk)!;
        const c = item.colour ?? "—";
        const s = normalizeSize(item.size ?? "One Size");
        if (!g.colours.includes(c)) g.colours.push(c);
        if (!g.sizes.includes(s)) g.sizes.push(s);
        if (!g.qty.has(c)) g.qty.set(c, new Map());
        g.qty.get(c)!.set(s, (g.qty.get(c)!.get(s) ?? 0) + item.quantity);
        g.lineTotal += item.lineTotal;
      }

      for (const gk of rGroupKeys) {
        const g = rGroups.get(gk)!;

        if (g.isBundleHeader) {
          const bundleQty = [...g.qty.values()].reduce((s, m) => s + [...m.values()].reduce((a, b) => a + b, 0), 0);
          doc.rect(margin, y, tableW, rowH + 3).fill("#1e3a5f");
          doc.fillColor("#94a3b8").fontSize(6.5).font("Helvetica-Bold").text("BUNDLE", margin + 6, y + 4);
          const bundleLabel = g.sku ? `${g.sku}  ${g.productName}` : g.productName;
          doc.fillColor("#ffffff").fontSize(7).font("Helvetica-Bold")
            .text(bundleLabel, margin + 52, y + 4, { width: tableW - 52 - totalW - unitPriceW - qtyW - 6 });
          doc.fillColor("#94a3b8").font("Helvetica").fontSize(7)
            .text(`× ${bundleQty}`, margin + tableW - totalW - unitPriceW - qtyW, y + 4, { width: qtyW - 2, align: "center" });
          doc.text(`£${g.unitPrice.toFixed(2)}`, margin + tableW - totalW - unitPriceW, y + 4, { width: unitPriceW - 2, align: "right" });
          doc.fillColor("#ffffff").font("Helvetica-Bold")
            .text(`£${g.lineTotal.toFixed(2)}`, margin + tableW - totalW, y + 4, { width: totalW - 3, align: "right" });
          y += rowH + 3;
          if (y > pageH - 120) { doc.addPage(); y = margin; drawTableHeader(y); y += tblHdrH; rowAlt = false; }
          continue;
        }

        const isBundleComp = !!(g.bundleRef);
        const hasVatNote = g.vatRate !== 0.20;
        const hasSubLine = !!(g.finishName || g.recipientName || hasVatNote);
      const productRowH = hasSubLine ? rowH + 9 : rowH;
      doc.rect(margin, y, tableW, productRowH).fill(isBundleComp ? "#f5f7fa" : "#f0f4f8");
      doc.fillColor("#111827").fontSize(7).font("Helvetica-Bold");
      const productPrefix = isBundleComp ? "    " : "";
      const productLabel = g.sku ? `${productPrefix}${g.sku}  ${g.productName}` : `${productPrefix}${g.productName}`;
      doc.text(productLabel, margin + 3, y + 3, { width: tableW - totalW - 6 });
      if (isBundleComp) {
        doc.fillColor("#9ca3af").font("Helvetica").fontSize(6.5)
          .text("incl.", margin + tableW - totalW, y + 3, { width: totalW - 3, align: "right" });
      } else {
        doc.text(`£${g.lineTotal.toFixed(2)}`, margin + tableW - totalW, y + 3, { width: totalW - 3, align: "right" });
      }
      const subLineY = y + 12;
      let subLineX = margin + 3;
      if (g.finishName) {
        doc.fillColor("#4f46e5").fontSize(6.5).font("Helvetica-Oblique")
          .text(`Finish: ${g.finishName}`, subLineX, subLineY, { width: tableW - totalW - 6 });
        subLineX += 140;
      }
      if (g.recipientName) {
        doc.fillColor("#0369a1").fontSize(6.5).font("Helvetica-Oblique")
          .text(`For: ${g.recipientName}`, subLineX, subLineY, { width: tableW - totalW - subLineX + margin - 6 });
        subLineX += 100;
      }
      if (hasVatNote) {
        const vatPct = Math.round(g.vatRate * 100);
        const vatNote = vatPct === 0 ? "Zero-rated (0% VAT)" : `VAT: ${vatPct}%`;
        doc.fillColor("#6b7280").fontSize(6.5).font("Helvetica-Oblique")
          .text(vatNote, subLineX, subLineY, { width: tableW - totalW - subLineX + margin - 6 });
      }
      y += productRowH;

      // Colour rows
      for (const colour of g.colours) {
        const rowTotal = allSizes.reduce((s, sz) => s + (g.qty.get(colour)?.get(sz) ?? 0), 0);
        doc.rect(margin, y, tableW, rowH).fill(rowAlt ? "#f9fafb" : "#ffffff").stroke("#e5e7eb");
        doc.fillColor("#374151").fontSize(7).font("Helvetica");
        let rx = margin;
        doc.text("", rx + 3, y + 3, { width: itemNameW - 3 }); rx += itemNameW;
        doc.text(colour === "—" && isBundleComp ? "" : colour, rx + 3, y + 3, { width: colourW - 3 }); rx += colourW;
        for (const sz of allSizes) {
          const q = g.qty.get(colour)?.get(sz) ?? 0;
          doc.text(q > 0 ? String(q) : "", rx + 2, y + 3, { width: sizeColW - 2, align: "center" });
          rx += sizeColW;
        }
        doc.font("Helvetica-Bold").text(String(rowTotal), rx + 2, y + 3, { width: qtyW - 2, align: "center" }); rx += qtyW;
        doc.font("Helvetica").text(isBundleComp ? "" : `£${g.unitPrice.toFixed(2)}`, rx + 2, y + 3, { width: unitPriceW - 2, align: "right" }); rx += unitPriceW;
        doc.text("", rx + 2, y + 3, { width: totalW - 3, align: "right" });
        y += rowH;
        rowAlt = !rowAlt;
      }

      // Page break — re-draw header on new page
      if (y > pageH - 120) {
        doc.addPage();
        y = margin;
        drawTableHeader(y);
        y += tblHdrH;
        rowAlt = false;
      }
    }
    };  // end renderItems

    if (order.deliveryGroups && order.deliveryGroups.length > 1) {
      for (const dg of order.deliveryGroups) {
        const dgLabel = dg.addressLabel ? `${dg.addressLabel}  ·  ${dg.addressText}` : dg.addressText;
        doc.rect(margin, y, tableW, rowH + 3).fill("#78350f");
        doc.fillColor("#fef3c7").fontSize(6).font("Helvetica-Bold").text("DELIVER TO", margin + 6, y + 4, { width: 62 });
        doc.fillColor("#fffbeb").fontSize(7).font("Helvetica").text(dgLabel, margin + 68, y + 4, { width: tableW - 74 });
        y += rowH + 3;
        renderItems(dg.items);
      }
    } else {
      renderItems(order.items);
    }

    // ── Totals ────────────────────────────────────────────────────────────────
    const pdfSubtotal = order.items.reduce((s, i) => s + i.lineTotal, 0);
    const pdfShipping = order.shippingAmount ?? 0;
    // Zero-rated customers: suppress all VAT (Channel Islands etc.)
    const effectiveZeroVat = order.zeroVat || order.items.every(i => (i.vatRate ?? 0.20) === 0);
    const pdfItemVat  = effectiveZeroVat ? 0 : order.items.reduce((s, i) => s + i.lineTotal * (i.vatRate ?? 0.20), 0);
    const pdfVat      = effectiveZeroVat ? 0 : pdfItemVat + pdfShipping * 0.20;
    const pdfGrand    = pdfSubtotal + pdfShipping + pdfVat;

    const totalsX = margin + tableW - 195;
    const totalsW = 195;
    y += 6;

    const totalsRows: { label: string; value: string; bold?: boolean; big?: boolean }[] = effectiveZeroVat
      ? [
          { label: "Subtotal:", value: `£${pdfSubtotal.toFixed(2)}` },
          ...(pdfShipping > 0 ? [{ label: "Shipping & Handling:", value: `£${pdfShipping.toFixed(2)}` }] : []),
          { label: "TOTAL:", value: `£${pdfGrand.toFixed(2)}`, bold: true, big: true },
        ]
      : [
          { label: "Subtotal (exc. VAT):", value: `£${pdfSubtotal.toFixed(2)}` },
          ...(pdfShipping > 0 ? [{ label: "Shipping & Handling:", value: `£${pdfShipping.toFixed(2)}` }] : []),
          { label: "VAT:", value: `£${pdfVat.toFixed(2)}` },
          { label: "TOTAL (inc. VAT):", value: `£${pdfGrand.toFixed(2)}`, bold: true, big: true },
        ];

    doc.fontSize(7.5);
    for (const row of totalsRows) {
      const rowBg = row.big ? "#1e293b" : "#f8fafc";
      const fg    = row.big ? "#ffffff" : "#111827";
      const rH    = row.big ? 16 : 13;
      doc.rect(totalsX, y, totalsW, rH).fill(rowBg).stroke("#e5e7eb");
      doc.fillColor(fg).font(row.bold ? "Helvetica-Bold" : "Helvetica");
      doc.text(row.label, totalsX + 4, y + (row.big ? 4 : 3), { width: 120 });
      doc.font("Helvetica-Bold").text(row.value, totalsX + 124, y + (row.big ? 4 : 3), { width: totalsW - 128, align: "right" });
      y += rH;
    }

    // ── Shipping / delivery section ───────────────────────────────────────────
    const SHIP_LABELS: Record<string, string> = {
      free_local: "Free Local Delivery",
      dpd: "DPD Courier", royal_mail: "Royal Mail", local_delivery: "Local Delivery",
      office_collection: "Office Collection", warehouse_collection: "Collection from our warehouse", courier: "Courier",
      dpd_next_day: "Courier",
    };
    const isCollection = order.shippingMethod
      ? ["office_collection", "warehouse_collection"].includes(order.shippingMethod)
      : false;
    const shipLabel = order.shippingMethod ? (SHIP_LABELS[order.shippingMethod] ?? order.shippingMethod) : null;

    if (shipLabel) {
      y += 10;
      doc.fillColor("#555555").fontSize(7.5).font("Helvetica-Bold").text("Shipping / Collection:", margin, y);
      y += 10;
      doc.font("Helvetica").fontSize(7.5).fillColor("#374151").text(shipLabel, margin, y, { width: 250 });
      if (order.shippingMethod === "free_local") {
        y += 11;
        const freeLocalNote = "As you are local to us we offer free delivery to your postcode on a Tuesday and a Friday. We will let you know on the morning of your delivery and you can expect to see Tim with your order before lunchtime!";
        doc.font("Helvetica").fontSize(7).fillColor("#4b5563").text(freeLocalNote, margin, y, { width: 280 });
        y += doc.heightOfString(freeLocalNote, { width: 280, fontSize: 7 });
      } else {
        y += 11;
      }
    }

    if (order.deliveryAddress && !isCollection) {
      y += (shipLabel ? 10 : 10);
      doc.fillColor("#555555").fontSize(7.5).font("Helvetica-Bold").text("Delivery Address:", margin, y);
      y += 10;
      doc.font("Helvetica").fontSize(7.5).fillColor("#374151").text(order.deliveryAddress, margin, y, { width: 220 });
    }

    // ── Footer (within printable area) ────────────────────────────────────────
    const footY = pageH - margin - 16;
    doc.fontSize(6.5).fillColor("#9ca3af").font("Helvetica")
      .text(
        `${identity.name} · ${identity.email} · ${identity.phone}`,
        margin, footY, { align: "center", width: contentW, lineBreak: false }
      );

    doc.end();
  });
}

// ─── Quote PDF ────────────────────────────────────────────────────────────────

export interface QuotePdfItem {
  productName: string;
  productUrl: string | null;
  sku: string | null;
  description: string | null;
  colour: string | null;
  size: string | null;
  finishName: string | null;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  imageBuffer: Buffer | null;
  priceBreaks?: { qty: number; price: number }[] | null;
}

export interface QuotePdfData {
  quoteNumber: string;
  customerName: string;
  quoteDate: Date | string;
  expiresAt: Date | string | null;
  notes: string | null;
  items: QuotePdfItem[];
  customerLogoBuffer: Buffer | null;
}

/** Strip HTML tags and collapse whitespace for plain-text display */
function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function generateQuotePdf(data: QuotePdfData): Promise<Buffer> {
  const identity = await requireConfiguredBusinessIdentity();
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 32, size: "A4", autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const margin = 32;
    const contentW = pageW - margin * 2;

    const fmtDate = (d: Date | string | null | undefined) =>
      d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

    // ── Header bar ────────────────────────────────────────────────────────────
    const hdrH = 52;
    doc.rect(margin, margin, contentW, hdrH).fill("#1e293b");

    if (BUSINESS_LOGO_BUFFER) {
      try { doc.image(BUSINESS_LOGO_BUFFER, margin + 8, margin + 6, { fit: [110, 40], valign: "center" }); } catch {}
    }
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#ffffff")
      .text("Quotation", margin + 130, margin + 19, { width: contentW - 360, align: "center" });
    if (data.customerLogoBuffer) {
      const lx = margin + contentW - 110;
      const ly = margin + 6;
      // White backing so dark logos remain visible on the dark header
      doc.roundedRect(lx - 4, ly - 3, 110, 46, 3).fill("#ffffff");
      try { doc.image(data.customerLogoBuffer, lx, ly, { fit: [102, 40], valign: "center" }); } catch {}
    }

    // ── Customer name + installation contact ────────────────────────────────
    const addrY = margin + hdrH + 8;
    const nameY = addrY;

    doc.font("Helvetica-Bold").fontSize(9).fillColor("#111827").text(data.customerName, margin, nameY);

    const sbsX = margin + contentW - 170;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#111827").text(identity.name, sbsX, addrY, { width: 170, align: "right" });
    doc.font("Helvetica").fontSize(7.5).fillColor("#555555");
    doc.text(identity.email, sbsX, addrY + 11, { width: 170, align: "right" });
    doc.text(identity.phone, sbsX, addrY + 21, { width: 170, align: "right" });

    // ── Divider ───────────────────────────────────────────────────────────────
    const divY = Math.max(addrY + 32, nameY + 14);
    doc.moveTo(margin, divY).lineTo(margin + contentW, divY).strokeColor("#d1d5db").lineWidth(0.5).stroke();

    // ── Quote info strip ──────────────────────────────────────────────────────
    const infoY = divY + 6;
    const infoCols = [
      { label: "Quote Number", value: data.quoteNumber },
      { label: "Quote Date",   value: fmtDate(data.quoteDate) },
      { label: "Valid Until",  value: fmtDate(data.expiresAt) },
    ];
    const infoColW = contentW / infoCols.length;
    infoCols.forEach(({ label, value }, i) => {
      const x = margin + i * infoColW;
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#6b7280").text(label, x, infoY, { width: infoColW - 4 });
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111827").text(value, x, infoY + 9, { width: infoColW - 4 });
    });

    // ── Items table ───────────────────────────────────────────────────────────
    const tableStartY = infoY + 28;
    const tblHdrH = 14;
    const ROW_H   = 58; // fixed height — fits 50px thumbnail + two text lines

    const imgW     = 54;
    const colourW  = 68;
    const qtyW     = 30;
    const priceW   = 52;
    const totalW   = 58;
    const productW = contentW - imgW - colourW - qtyW - priceW - totalW;

    const drawTableHeader = (ty: number) => {
      doc.rect(margin, ty, contentW, tblHdrH).fill("#1e293b");
      doc.fillColor("#94a3b8").fontSize(6.5).font("Helvetica-Bold");
      let hx = margin + imgW;
      doc.text("ITEM",   hx + 3,  ty + 4, { width: productW - 3 }); hx += productW;
      doc.text("COLOUR", hx + 2,  ty + 4, { width: colourW - 2 }); hx += colourW;
      doc.text("QTY",    hx + 2,  ty + 4, { width: qtyW - 2,  align: "center" }); hx += qtyW;
      doc.text("UNIT",   hx + 2,  ty + 4, { width: priceW - 2, align: "right" }); hx += priceW;
      doc.text("TOTAL",  hx + 2,  ty + 4, { width: totalW - 2, align: "right" });
    };

    drawTableHeader(tableStartY);
    let y = tableStartY + tblHdrH;
    let rowAlt = false;

    for (const item of data.items) {
      const lineTotal = item.quantity * item.unitPrice;
      const desc = stripHtml(item.description);

      // Price-break savings: tiers above current qty that are cheaper
      const applicableBreaks = (item.priceBreaks ?? [])
        .filter(b => b.qty > item.quantity && b.price < item.unitPrice)
        .sort((a, b) => a.qty - b.qty)
        .slice(0, 3);
      const STRIP_H = applicableBreaks.length > 0 ? 13 : 0;

      doc.rect(margin, y, contentW, ROW_H).fill(rowAlt ? "#f9fafb" : "#ffffff").stroke("#e5e7eb");
      rowAlt = !rowAlt;

      // Thumbnail
      if (item.imageBuffer) {
        try { doc.image(item.imageBuffer, margin + 3, y + 4, { fit: [48, 50] }); } catch {}
      } else {
        // Placeholder box
        doc.rect(margin + 3, y + 4, 48, 50).fill("#f3f4f6").stroke("#e5e7eb");
        doc.fillColor("#d1d5db").fontSize(7).font("Helvetica")
          .text("No image", margin + 3, y + 25, { width: 48, align: "center" });
      }

      // Product name (hyperlink if URL available)
      const px = margin + imgW;
      const productLabel = item.sku ? `${item.sku}  ${item.productName}` : item.productName;
      doc.fillColor(item.productUrl ? "#1d4ed8" : "#111827").fontSize(7.5).font("Helvetica-Bold")
        .text(productLabel, px + 3, y + 5, {
          width: productW - 6, lineBreak: false, ellipsis: true,
          ...(item.productUrl ? { link: item.productUrl, underline: true } : {}),
        });

      // Description (up to 2 lines)
      if (desc) {
        doc.fillColor("#4b5563").fontSize(6.5).font("Helvetica")
          .text(desc, px + 3, y + 16, { width: productW - 6, height: 22, ellipsis: true });
      }

      // Finish (italic, indigo)
      if (item.finishName) {
        doc.fillColor("#4f46e5").fontSize(6.5).font("Helvetica-Oblique")
          .text(`Finish: ${item.finishName}`, px + 3, y + 40, { width: productW - 6, lineBreak: false, ellipsis: true });
      }

      // Colour / size / qty / price / total — vertically centred
      const midY = y + (ROW_H - 8) / 2;
      doc.fillColor("#374151").fontSize(7).font("Helvetica");
      doc.text(item.colour ?? "—",         margin + imgW + productW + 2,             midY, { width: colourW - 4, lineBreak: false, ellipsis: true });
      doc.font("Helvetica-Bold")
        .text(String(item.quantity),       margin + imgW + productW + colourW + 2,  midY, { width: qtyW - 4, align: "center" });
      doc.font("Helvetica")
        .text(`£${item.unitPrice.toFixed(2)}`, margin + imgW + productW + colourW + qtyW + 2, midY, { width: priceW - 4, align: "right" });
      doc.font("Helvetica-Bold")
        .text(`£${lineTotal.toFixed(2)}`,  margin + imgW + productW + colourW + qtyW + priceW + 2, midY, { width: totalW - 4, align: "right" });

      y += ROW_H;

      // Savings strip — amber band showing higher price tiers
      if (applicableBreaks.length > 0) {
        const savingsText = applicableBreaks
          .map(b => `Buy ${b.qty}+ for £${b.price.toFixed(2)}/unit (save £${(item.unitPrice - b.price).toFixed(2)} each)`)
          .join("   ·   ");
        doc.rect(margin, y, contentW, STRIP_H).fill("#fffbeb").stroke("#fde68a");
        doc.fillColor("#92400e").fontSize(6).font("Helvetica-Bold")
          .text(`\u26A1 Order more, save more:  ${savingsText}`, margin + imgW + 3, y + 3, {
            width: contentW - imgW - 6, lineBreak: false, ellipsis: true,
          });
        y += STRIP_H;
      }

      // Page break
      if (y > pageH - 140) {
        doc.addPage();
        y = margin;
        drawTableHeader(y);
        y += tblHdrH;
        rowAlt = false;
      }
    }

    // ── Totals ────────────────────────────────────────────────────────────────
    const subtotal = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const vat      = data.items.reduce((s, i) => s + i.quantity * i.unitPrice * (i.vatRate ?? 0.20), 0);
    const grand    = subtotal + vat;

    const totalsX = margin + contentW - 200;
    const totalsW = 200;
    y += 8;

    const totalsRows: { label: string; value: string; bold?: boolean; big?: boolean }[] = [
      { label: "Subtotal (exc. VAT):", value: `£${subtotal.toFixed(2)}` },
      { label: "VAT:",                 value: `£${vat.toFixed(2)}` },
      { label: "TOTAL (inc. VAT):",    value: `£${grand.toFixed(2)}`, bold: true, big: true },
    ];
    for (const row of totalsRows) {
      const rowBg = row.big ? "#1e293b" : "#f8fafc";
      const fg    = row.big ? "#ffffff" : "#111827";
      const rH    = row.big ? 16 : 13;
      doc.rect(totalsX, y, totalsW, rH).fill(rowBg).stroke("#e5e7eb");
      doc.fillColor(fg).font(row.bold ? "Helvetica-Bold" : "Helvetica").fontSize(7.5);
      doc.text(row.label, totalsX + 4, y + (row.big ? 4 : 3), { width: 124 });
      doc.font("Helvetica-Bold").text(row.value, totalsX + 128, y + (row.big ? 4 : 3), { width: totalsW - 132, align: "right" });
      y += rH;
    }

    // ── Notes ─────────────────────────────────────────────────────────────────
    if (data.notes?.trim()) {
      y += 14;
      doc.fillColor("#555555").fontSize(7.5).font("Helvetica-Bold").text("Notes:", margin, y);
      y += 10;
      doc.font("Helvetica").fontSize(7.5).fillColor("#374151")
        .text(data.notes.trim(), margin, y, { width: contentW - 210 });
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    const footY = pageH - margin - 16;
    doc.fontSize(6.5).fillColor("#9ca3af").font("Helvetica")
      .text(
        `${identity.name} · ${identity.email} · ${identity.phone}`,
        margin, footY, { align: "center", width: contentW, lineBreak: false }
      );

    doc.end();
  });
}

// ─── Quote Email ──────────────────────────────────────────────────────────────

export function buildQuoteEmail(data: {
  quoteNumber: string;
  customerName: string | null;
  contactFirstName?: string | null;
  customerLogoDataUrl?: string | null;
  quoteDate: Date | string | null;
  expiresAt?: Date | string | null;
  notes?: string | null;
  coverText: string;
  portalLink: string;
  items: Array<{
    productName: string;
    colour?: string | null;
    size?: string | null;
    finishName?: string | null;
    quantity: number;
    unitPrice: number;
    vatRate?: number;
    priceBreaks?: { qty: number; price: number }[] | null;
  }>;
}): { subject: string; html: string; text: string } {
  const subject = `Your Quotation – ${data.quoteNumber}`;
  // Use the contact's first name when available; null means no personal name known
  const firstName = data.contactFirstName ? toFirstName(data.contactFirstName) : null;
  const fmtDate = (d: Date | string | null | undefined) =>
    d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

  const subtotal = data.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const vatAmount = data.items.reduce((s, i) => s + i.unitPrice * i.quantity * (i.vatRate ?? 0.20), 0);
  const totalIncVat = subtotal + vatAmount;

  const itemRows = data.items.map(i => {
    const applicableBreaks = (i.priceBreaks ?? [])
      .filter(b => b.qty > i.quantity && b.price < i.unitPrice)
      .sort((a, b) => a.qty - b.qty)
      .slice(0, 3);
    const savingsRow = applicableBreaks.length > 0
      ? `\n<tr><td colspan="5" style="padding:4px 14px 7px;background:#fffbeb;border-bottom:1px solid #fde68a;font-size:11.5px;color:#92400e;font-weight:600;">&#9889;&nbsp; Order more, save more: &nbsp;${applicableBreaks.map(b => `Buy ${b.qty}+ for <strong>£${b.price.toFixed(2)}/unit</strong> (save £${(i.unitPrice - b.price).toFixed(2)} each)`).join("&nbsp; &middot; &nbsp;")}</td></tr>`
      : "";
    return `<tr>
      <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#1e293b;">${i.productName}${i.finishName ? `<br><span style="font-size:11px;color:#6366f1;font-weight:600;">Finish: ${i.finishName}</span>` : ""}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;">${[i.colour, i.size].filter(Boolean).join(" / ") || "—"}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:center;font-size:13px;font-weight:600;color:#1e293b;">${i.quantity}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;color:#64748b;">£${i.unitPrice.toFixed(2)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;font-weight:700;color:#1e293b;">£${(i.unitPrice * i.quantity).toFixed(2)}</td>
    </tr>${savingsRow}`;
  }).join("\n");

  const customerLogoBlock = data.customerLogoDataUrl
    ? `<td style="vertical-align:middle;text-align:right;">
        <p style="margin:0 0 6px;color:#64748b;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Prepared for</p>
        <img src="${data.customerLogoDataUrl}" alt="${data.customerName ?? "Customer"}" height="38" style="display:block;height:38px;width:auto;max-width:130px;margin-left:auto;" />
      </td>`
    : `<td style="vertical-align:middle;text-align:right;">
        <p style="margin:0;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Quotation</p>
        <p style="margin:4px 0 0;color:#fff;font-size:17px;font-weight:700;">${data.quoteNumber}</p>
      </td>`;

  const quoteRefSubBar = data.customerLogoUrl
    ? `<tr><td style="background:#0f172a;padding:10px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><p style="margin:0;color:#64748b;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Quotation</p>
          <p style="margin:2px 0 0;color:#fff;font-size:15px;font-weight:700;">${data.quoteNumber}</p></td>
        </tr></table>
      </td></tr>`
    : "";

  // Resolve placeholders — also patch legacy literal phrases from old saved cover texts
  const greetingName = firstName ?? null;
  const resolvedCoverText = data.coverText
    .replace(/^Hi there,/m, greetingName ? `Hi ${greetingName},` : `Hi,`)
    .replace(/^Hi \{firstName\},/m, greetingName ? `Hi ${greetingName},` : "Hi,")
    .replace(/Thank you for your enquiry with the configured organisation\./g,
      `Thank you for the opportunity to quote for ${data.customerName ?? "your organisation"}.`)
    .replace(/\{firstName\}/g, firstName ?? "")
    .replace(/\{businessName\}/g, data.customerName ?? "your organisation");

  const coverHtml = resolvedCoverText.split(/\n\n+/).map(p =>
    `<p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.7;">${p.replace(/\n/g, "<br>")}</p>`
  ).join("\n");

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.10);">

        <tr><td style="background:#1e293b;padding:22px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;">
              <span>Configured organisation</span>
            </td>
            ${customerLogoBlock}
          </tr></table>
        </td></tr>
        ${quoteRefSubBar}

        <tr><td style="background:#1e3a5f;padding:24px 32px;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;line-height:1.3;">Your quote for ${data.customerName ?? "you"} is ready!</p>
          <p style="margin:6px 0 0;font-size:14px;color:#93c5fd;line-height:1.5;">We've put together a personalised quote — review the items and place your order when you're ready.</p>
        </td></tr>

        <tr><td style="padding:28px 32px 4px;">${coverHtml}</td></tr>

        <tr><td style="padding:16px 32px 24px;text-align:center;">
          <a href="${data.portalLink}" style="display:inline-block;background:#1e3a5f;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 32px;border-radius:8px;letter-spacing:0.3px;">View Quote &amp; Place Order →</a>
          <p style="margin:12px 0 0;font-size:12px;color:#94a3b8;">Or copy this link: <a href="${data.portalLink}" style="color:#3b82f6;text-decoration:none;">${data.portalLink}</a></p>
        </td></tr>

        <tr><td style="padding:0 32px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:12px 16px;border-right:1px solid #e2e8f0;">
                <p style="margin:0;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Quote Number</p>
                <p style="margin:4px 0 0;font-size:14px;font-weight:700;color:#1e293b;">${data.quoteNumber}</p>
              </td>
              <td style="padding:12px 16px;border-right:1px solid #e2e8f0;">
                <p style="margin:0;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Date</p>
                <p style="margin:4px 0 0;font-size:14px;font-weight:700;color:#1e293b;">${fmtDate(data.quoteDate)}</p>
              </td>
              <td style="padding:12px 16px;">
                <p style="margin:0;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Valid Until</p>
                <p style="margin:4px 0 0;font-size:14px;font-weight:700;color:#1e293b;">${fmtDate(data.expiresAt)}</p>
              </td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 32px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;overflow:hidden;">
            <thead>
              <tr style="background:#1e293b;">
                <th style="padding:10px 12px;text-align:left;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Product</th>
                <th style="padding:10px 12px;text-align:left;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Colour / Size</th>
                <th style="padding:10px 12px;text-align:center;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Qty</th>
                <th style="padding:10px 12px;text-align:right;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Unit</th>
                <th style="padding:10px 12px;text-align:right;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Total</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
            <tfoot>
              <tr style="background:#f8fafc;">
                <td colspan="4" style="padding:10px 12px;text-align:right;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;">Subtotal (exc. VAT)</td>
                <td style="padding:10px 12px;text-align:right;font-size:13px;font-weight:600;color:#1e293b;border-top:1px solid #e2e8f0;">£${subtotal.toFixed(2)}</td>
              </tr>
              <tr style="background:#f8fafc;">
                <td colspan="4" style="padding:6px 12px;text-align:right;font-size:12px;color:#64748b;">VAT (20%)</td>
                <td style="padding:6px 12px;text-align:right;font-size:12px;color:#64748b;">£${vatAmount.toFixed(2)}</td>
              </tr>
              <tr style="background:#1e293b;">
                <td colspan="4" style="padding:12px;text-align:right;font-size:13px;font-weight:700;color:#f1f5f9;">Total (inc. VAT)</td>
                <td style="padding:12px;text-align:right;font-size:15px;font-weight:700;color:#ffffff;">£${totalIncVat.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </td></tr>

        ${data.notes ? `
        <tr><td style="padding:0 32px 24px;">
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;">
            <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.5px;">Notes</p>
            <p style="margin:0;font-size:13px;color:#78350f;line-height:1.6;">${data.notes}</p>
          </div>
        </td></tr>` : ""}

        <tr><td style="background:#0f172a;padding:24px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:5px 0;width:50%;vertical-align:top;">
                <p style="margin:0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Phone</p>
                <a href="${BUSINESS_PHONE_HREF}" style="font-size:13px;color:#e2e8f0;text-decoration:none;font-weight:500;">${BUSINESS_PHONE_DISPLAY}</a>
              </td>
              <td style="padding:5px 0;width:50%;vertical-align:top;">
                <p style="margin:0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Email</p>
                <span>Contact details configured per installation</span>
              </td>
            </tr>
            <tr>
              <td colspan="2" style="padding-top:16px;border-top:1px solid #1e293b;">
                <p style="margin:0;font-size:11px;color:#475569;text-align:center;">Contact details configured per installation</p>
              </td>
            </tr>
          </table>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    subject,
    "=".repeat(60),
    "",
    resolvedCoverText,
    "",
    "─".repeat(40),
    `View your quote and place your order:`,
    data.portalLink,
    "─".repeat(40),
    "",
    `Quote Number: ${data.quoteNumber}`,
    `Date:         ${fmtDate(data.quoteDate)}`,
    `Valid Until:  ${fmtDate(data.expiresAt)}`,
    "",
    "Items:",
    ...data.items.map(i =>
      `  ${i.productName}${[i.colour, i.size].filter(Boolean).length ? ` (${[i.colour, i.size].filter(Boolean).join(" / ")})` : ""}  ·  Qty: ${i.quantity}  ·  £${i.unitPrice.toFixed(2)} each  ·  £${(i.unitPrice * i.quantity).toFixed(2)}`
    ),
    "",
    `Subtotal (exc. VAT): £${subtotal.toFixed(2)}`,
    `VAT (20%):           £${vatAmount.toFixed(2)}`,
    `Total (inc. VAT):    £${totalIncVat.toFixed(2)}`,
    ...(data.notes ? ["", `Notes: ${data.notes}`] : []),
    "",
    "─".repeat(40),
    `Contact details configured per installation`,
    "Configured organisation",
  ].join("\n");

  return { subject, html, text };
}

// ─── Purchase Order PDF + Email ───────────────────────────────────────────────

interface POItemData {
  supplierCode: string | null;
  productSku: string | null;
  productName: string;
  colour: string | null;
  size: string | null;
  supplierPrice: number | null;
  quantityOrdered: number;
}

interface POData {
  poNumber: string;
  supplierName: string;
  supplierEmail: string | null;
  supplierContactName?: string | null;
  supplierPhone?: string | null;
  supplierAddress?: string | null;
  createdAt: Date | string;
  notes: string | null;
  items: POItemData[];
}

const SIZE_NORMALIZE: Record<string, string> = {
  "one size": "One Size", "os": "One Size", "o/s": "One Size", "onesize": "One Size",
  "x-small": "XS", "xsmall": "XS", "extra small": "XS",
  "small": "S",
  "medium": "M",
  "large": "L",
  "x-large": "XL", "xlarge": "XL", "extra large": "XL", "extra-large": "XL",
  "xxl": "2XL", "xx-large": "2XL", "2x-large": "2XL",
  "xxxl": "3XL", "xxx-large": "3XL", "3x-large": "3XL",
  "xxxxl": "4XL", "xxxx-large": "4XL", "4x-large": "4XL",
  "xxxxxl": "5XL", "5x-large": "5XL",
  // Youth / children sizes — normalise to short labels that fit a 36pt PDF column
  "extra small youth": "XS Yth", "xs youth": "XS Yth", "youth xs": "XS Yth", "xsmall youth": "XS Yth",
  "small youth": "S Youth", "s youth": "S Youth", "youth s": "S Youth",
  "medium youth": "M Youth", "m youth": "M Youth", "youth m": "M Youth",
  "large youth": "L Youth", "l youth": "L Youth", "youth l": "L Youth",
  "extra large youth": "XL Youth", "xl youth": "XL Youth", "youth xl": "XL Youth",
  "xlarge youth": "XL Youth", "x-large youth": "XL Youth", "extra-large youth": "XL Youth",
  "xxl youth": "2XL Yth", "youth xxl": "2XL Yth", "youth 2xl": "2XL Yth",
  // Common child/youth shorthand
  "xs yth": "XS Yth", "s yth": "S Youth", "m yth": "M Youth",
  "l yth": "L Youth", "xl yth": "XL Youth", "2xl yth": "2XL Yth",
};
const SIZE_ORDER = [
  "One Size",
  "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL",
  "XS Yth", "S Youth", "M Youth", "L Youth", "XL Youth", "2XL Yth",
];
function normalizeSize(s: string): string { return SIZE_NORMALIZE[s.toLowerCase().trim()] ?? s; }
function sortSizes(sizes: string[]): string[] {
  return [...sizes].sort((a, b) => {
    const ai = SIZE_ORDER.indexOf(a); const bi = SIZE_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1; if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

/** Build a matrix: groups by (supplierCode|productName), rows = colours, cols = sizes */
function buildMatrix(items: POItemData[]) {
  const groupKeys: string[] = [];
  const groups = new Map<string, { code: string | null; sbsCode: string | null; productName: string; price: number | null; colours: string[]; sizes: string[]; qty: Map<string, Map<string, number>> }>();

  for (const item of items) {
    const gk = item.supplierCode ?? item.productName;
    if (!groups.has(gk)) {
      groupKeys.push(gk);
      groups.set(gk, { code: item.supplierCode, sbsCode: item.productSku ?? null, productName: item.productName, price: item.supplierPrice, colours: [], sizes: [], qty: new Map() });
    }
    const g = groups.get(gk)!;
    const c = item.colour ?? "—";
    const s = normalizeSize(item.size ?? "—");
    if (!g.colours.includes(c)) g.colours.push(c);
    if (!g.sizes.includes(s)) g.sizes.push(s);
    if (!g.qty.has(c)) g.qty.set(c, new Map());
    g.qty.get(c)!.set(s, item.quantityOrdered);
    if (item.supplierPrice != null && g.price == null) g.price = item.supplierPrice;
  }
  // Sort sizes within each group
  for (const g of groups.values()) g.sizes = sortSizes(g.sizes);
  return { groupKeys, groups };
}

export async function generatePOPdf(po: POData): Promise<Buffer> {
  const identity = await requireConfiguredBusinessIdentity({ address: true });
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margins: { top: 0, left: 0, right: 0, bottom: 0 }, size: "A4", autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const MARGIN = 50;
    const PAGE_W = 595.28; // A4 points
    const PAGE_H = 841.89;
    const W = PAGE_W - MARGIN * 2;
    const CONTENT_BOTTOM = PAGE_H - 60; // content must stay above this

    // Draw the footer on the CURRENT page using absolute coordinates
    const drawFooter = () => {
      doc.save();
      doc.fillColor("#9ca3af").fontSize(8).font("Helvetica")
        .text("Effortless uniform management from order to delivery.", MARGIN, PAGE_H - 32, { align: "center", width: W });
      doc.restore();
    };

    // Add a new page: draw the footer on the outgoing page first, then add the new page
    const newPage = (outY: number): number => {
      drawFooter();
      doc.addPage();
      return MARGIN;
    };

    doc.addPage(); // first page — no footer on outgoing page needed
    const dateStr = new Date(po.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const logoBuffer = BUSINESS_LOGO_BUFFER;

    // ── Header ────────────────────────────────────────────────────────────────
    const headerH = 88;
    doc.rect(MARGIN, MARGIN, W, headerH).fill("#1e293b");
    doc.image(logoBuffer, 65, 63, { fit: [155, 55], align: "left", valign: "center" });
    const rightX = MARGIN + W - 190;
    doc.fillColor("#94a3b8").fontSize(9).font("Helvetica")
      .text("Purchase Order", rightX, 65, { width: 185, align: "right" });
    doc.fillColor("#ffffff").fontSize(13).font("Helvetica-Bold")
      .text(po.poNumber, rightX, 79, { width: 185, align: "right" });
    doc.fillColor("#cbd5e1").fontSize(9).font("Helvetica")
      .text(dateStr, rightX, 96, { width: 185, align: "right" });

    // ── Supplier block (left) + Deliver To block (right) ─────────────────────
    let y = MARGIN + headerH + 16;
    const colW2 = (W - 16) / 2; // two equal columns with a gap
    const rightColX = MARGIN + colW2 + 16;

    const supRow = (label: string, value: string, col: "left" | "right" = "left") => {
      const x = col === "left" ? MARGIN : rightColX;
      const valueX = col === "left" ? MARGIN + 75 : rightColX + 75;
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#374151")
        .text(label, x, y, { width: 70, lineBreak: false });
      doc.font("Helvetica").fontSize(9).fillColor("#111827")
        .text(value, valueX, y, { width: colW2 - 80, lineBreak: false });
      y += 14;
    };

    // Left column: supplier details
    const leftStart = y;
    supRow("Supplier:", po.supplierName);
    if (po.supplierContactName) supRow("Attention:", po.supplierContactName);
    if (po.supplierAddress)     supRow("Address:",   po.supplierAddress);
    if (po.supplierPhone)       supRow("Phone:",     po.supplierPhone);
    if (po.supplierEmail)       supRow("Email:",     po.supplierEmail);
    if (po.notes)               supRow("Notes:",     po.notes);
    const afterLeft = y;

    // Right column: deliver to (installed business address)
    y = leftStart;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#374151")
      .text("Deliver To:", rightColX, y, { width: colW2, lineBreak: false });
    y += 14;
    const deliverLines = [
      identity.name,
      identity.address!,
      identity.phone,
      identity.email,
    ];
    for (const line of deliverLines) {
      doc.font("Helvetica").fontSize(9).fillColor("#111827")
        .text(line, rightColX + 75, y, { width: colW2 - 80, lineBreak: false });
      y += 14;
    }

    y = Math.max(afterLeft, y) + 10;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + W, y).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
    y += 14;

    // ── Instruction notice ────────────────────────────────────────────────────
    const noticeText = "Please process and despatch at your earliest convenience. Should any items be out of stock please advise your estimated due date prior to despatch.";
    // Measure the notice text to get the correct height
    const noticeTextH = doc.heightOfString(noticeText, { width: W - 20, font: "Helvetica-Bold", size: 8.5 });
    const noticeH = noticeTextH + 14;
    doc.rect(MARGIN, y, W, noticeH).fill("#fefce8").stroke("#fde68a");
    doc.fillColor("#92400e").fontSize(8.5).font("Helvetica-Bold")
      .text(noticeText, MARGIN + 10, y + 7, { width: W - 20, align: "center" });
    y += noticeH + 12;

    // ── Split items into "matrix" (have colour/size) and "simple" (process-stock, no colour/size) ──
    const matrixItems = po.items.filter(i => i.colour != null || i.size != null);
    const simpleItems = po.items.filter(i => i.colour == null && i.size == null);

    // ── Simple items section (process stock artworks) ─────────────────────────
    if (simpleItems.length > 0) {
      const LIST_ROW_H = 22;
      const HDR_H = 24;

      // Right-side column widths for simple list: unit price | qty | value
      const S_PRICE_W = 62;
      const S_QTY_W   = 38;
      const S_VALUE_W = 65;
      const S_RIGHT   = S_PRICE_W + S_QTY_W + S_VALUE_W; // 165

      // Section header
      if (y + HDR_H + LIST_ROW_H > CONTENT_BOTTOM) y = newPage(y);
      doc.rect(MARGIN, y, W, HDR_H).fill("#0f172a");
      doc.fillColor("#f1f5f9").fontSize(10).font("Helvetica-Bold")
        .text("Print Files / Artworks", MARGIN + 8, y + 7, { width: W - S_RIGHT - 16, lineBreak: false });
      doc.fillColor("#94a3b8").fontSize(8).font("Helvetica")
        .text("Unit Price", MARGIN + W - S_RIGHT, y + 8, { width: S_PRICE_W, align: "right", lineBreak: false });
      doc.fillColor("#94a3b8").fontSize(8).font("Helvetica")
        .text("Qty", MARGIN + W - S_QTY_W - S_VALUE_W, y + 8, { width: S_QTY_W, align: "right", lineBreak: false });
      doc.fillColor("#94a3b8").fontSize(8).font("Helvetica")
        .text("Value", MARGIN + W - S_VALUE_W, y + 8, { width: S_VALUE_W - 4, align: "right", lineBreak: false });
      y += HDR_H;

      let simpleGrandTotal = 0;
      let simpleGrandValue = 0;
      let rowAltS = false;
      for (const item of simpleItems) {
        if (y + LIST_ROW_H > CONTENT_BOTTOM) y = newPage(y);
        const rowBg = rowAltS ? "#f8fafc" : "#ffffff";
        doc.rect(MARGIN, y, W, LIST_ROW_H).fill(rowBg).stroke("#e2e8f0");

        // Supplier code
        const code = item.supplierCode ?? null;
        let nameX = MARGIN + 8;
        if (code) {
          doc.fillColor("#4f46e5").fontSize(8.5).font("Helvetica-Bold")
            .text(code, MARGIN + 8, y + 6, { width: 55, lineBreak: false });
          nameX = MARGIN + 68;
        }
        doc.fillColor("#111827").fontSize(9).font("Helvetica")
          .text(item.productName, nameX, y + 6, { width: W - (nameX - MARGIN) - S_RIGHT - 4, lineBreak: false });

        // Unit price
        const lineValue = item.supplierPrice != null ? item.quantityOrdered * item.supplierPrice : null;
        if (item.supplierPrice != null) {
          doc.fillColor("#374151").fontSize(8.5).font("Helvetica")
            .text(`£${item.supplierPrice.toFixed(2)}`, MARGIN + W - S_RIGHT, y + 6, { width: S_PRICE_W, align: "right", lineBreak: false });
        } else {
          doc.fillColor("#cbd5e1").fontSize(8.5).font("Helvetica")
            .text("—", MARGIN + W - S_RIGHT, y + 6, { width: S_PRICE_W, align: "right", lineBreak: false });
        }

        // Qty
        doc.fillColor("#1e293b").fontSize(9).font("Helvetica-Bold")
          .text(String(item.quantityOrdered), MARGIN + W - S_QTY_W - S_VALUE_W, y + 6, { width: S_QTY_W, align: "right", lineBreak: false });

        // Line value
        if (lineValue != null) {
          doc.fillColor("#1e293b").fontSize(8.5).font("Helvetica-Bold")
            .text(`£${lineValue.toFixed(2)}`, MARGIN + W - S_VALUE_W, y + 6, { width: S_VALUE_W - 4, align: "right", lineBreak: false });
          simpleGrandValue += lineValue;
        } else {
          doc.fillColor("#cbd5e1").fontSize(8.5).font("Helvetica")
            .text("—", MARGIN + W - S_VALUE_W, y + 6, { width: S_VALUE_W - 4, align: "right", lineBreak: false });
        }

        simpleGrandTotal += item.quantityOrdered;
        y += LIST_ROW_H;
        rowAltS = !rowAltS;
      }

      // Simple totals row
      if (y + LIST_ROW_H > CONTENT_BOTTOM) y = newPage(y);
      doc.rect(MARGIN, y, W, LIST_ROW_H).fill("#dde3ea").stroke("#c8d0da");
      doc.fillColor("#1e293b").fontSize(8).font("Helvetica-Bold")
        .text("TOTAL", MARGIN + 8, y + 7, { width: W - S_RIGHT - 4, lineBreak: false });
      doc.fillColor("#1e293b").fontSize(9).font("Helvetica-Bold")
        .text(String(simpleGrandTotal), MARGIN + W - S_QTY_W - S_VALUE_W, y + 7, { width: S_QTY_W, align: "right", lineBreak: false });
      if (simpleGrandValue > 0) {
        doc.fillColor("#1e293b").fontSize(8.5).font("Helvetica-Bold")
          .text(`£${simpleGrandValue.toFixed(2)}`, MARGIN + W - S_VALUE_W, y + 7, { width: S_VALUE_W - 4, align: "right", lineBreak: false });
      }
      y += LIST_ROW_H + 16;
    }

    // ── Matrix sections (products with colour/size) ────────────────────────────
    if (matrixItems.length > 0) {
      const { groupKeys, groups } = buildMatrix(matrixItems);
      const ROW_H = 20;
      const PROD_HDR_H = 24;
      const COL_HDR_H = 28;
      let grandTotal = 0;
      let grandValue = 0;

      for (const gk of groupKeys) {
        const g = groups.get(gk)!;
        const productSizes = g.sizes;
        const numCols = productSizes.length;

        // Column layout: Colour | size… | Total
        const COLOUR_W = 115;
        const TOTAL_W  = 48;
        const SIZE_W   = Math.min(60, Math.max(36, Math.floor((W - COLOUR_W - TOTAL_W) / Math.max(numCols, 1))));
        const TABLE_W  = COLOUR_W + SIZE_W * numCols + TOTAL_W;
        const tX       = MARGIN;

        // Estimate space needed: product header + col header + rows + totals row
        const sectionH = PROD_HDR_H + COL_HDR_H + (g.colours.length + 1) * ROW_H + 14;
        if (y + sectionH > CONTENT_BOTTOM) y = newPage(y);

        // ── Product heading band ──
        const code       = g.code ?? null; // supplier's product code only — never show our internal SKU
        const priceLabel = g.price != null ? `£${g.price.toFixed(2)} / unit` : null;
        const PRICE_LBL_W = priceLabel ? 88 : 0;
        doc.rect(MARGIN, y, W, PROD_HDR_H).fill("#0f172a");
        if (code) {
          doc.fillColor("#fbbf24").fontSize(10).font("Helvetica-Bold")
            .text(code, MARGIN + 8, y + 7, { width: 120, lineBreak: false });
          doc.fillColor("#f1f5f9").fontSize(10).font("Helvetica-Bold")
            .text(`  ${g.productName}`, MARGIN + 10 + 120, y + 7, { width: W - 148 - PRICE_LBL_W, lineBreak: false });
        } else {
          doc.fillColor("#f1f5f9").fontSize(10).font("Helvetica-Bold")
            .text(g.productName, MARGIN + 8, y + 7, { width: W - 16 - PRICE_LBL_W, lineBreak: false });
        }
        if (priceLabel) {
          doc.fillColor("#94a3b8").fontSize(8.5).font("Helvetica")
            .text(priceLabel, MARGIN + W - PRICE_LBL_W - 4, y + 8, { width: PRICE_LBL_W, align: "right", lineBreak: false });
        }
        y += PROD_HDR_H;

        // ── Column header row ──
        doc.rect(tX, y, TABLE_W, COL_HDR_H).fill("#334155");
        doc.fillColor("#e2e8f0").fontSize(8).font("Helvetica-Bold");
        doc.text("Colour / Style", tX + 6, y + 9, { width: COLOUR_W - 6, lineBreak: false });
        let sx = tX + COLOUR_W;
        for (const sz of productSizes) {
          doc.text(sz, sx, y + 3, { width: SIZE_W, align: "center" });
          sx += SIZE_W;
        }
        doc.text("Total", sx, y + 9, { width: TOTAL_W, align: "center", lineBreak: false });
        y += COL_HDR_H;

        // ── Colour rows ──
        let rowAlt = false;
        const sizeTotals = new Map<string, number>();
        let groupTotal = 0;

        for (const colour of g.colours) {
          if (y + ROW_H > CONTENT_BOTTOM) y = newPage(y);
          const rowTotal = productSizes.reduce((s, sz) => s + (g.qty.get(colour)?.get(sz) ?? 0), 0);
          groupTotal += rowTotal;

          doc.rect(tX, y, TABLE_W, ROW_H)
            .fill(rowAlt ? "#f1f5f9" : "#ffffff")
            .stroke("#e2e8f0");

          doc.fillColor("#111827").fontSize(9).font("Helvetica")
            .text(colour, tX + 6, y + 6, { width: COLOUR_W - 6, lineBreak: false });

          sx = tX + COLOUR_W;
          for (const sz of productSizes) {
            const qty = g.qty.get(colour)?.get(sz) ?? 0;
            if (qty > 0) sizeTotals.set(sz, (sizeTotals.get(sz) ?? 0) + qty);
            if (qty > 0) {
              doc.fillColor("#111827").fontSize(9).font("Helvetica-Bold")
                .text(String(qty), sx, y + 6, { width: SIZE_W, align: "center", lineBreak: false });
            } else {
              doc.fillColor("#cbd5e1").fontSize(9).font("Helvetica")
                .text("—", sx, y + 6, { width: SIZE_W, align: "center", lineBreak: false });
            }
            sx += SIZE_W;
          }

          doc.fillColor("#1e293b").fontSize(9).font("Helvetica-Bold")
            .text(String(rowTotal), sx, y + 6, { width: TOTAL_W, align: "center", lineBreak: false });

          y += ROW_H;
          rowAlt = !rowAlt;
        }

        // ── Size-totals row ──
        if (y + ROW_H > CONTENT_BOTTOM) y = newPage(y);
        doc.rect(tX, y, TABLE_W, ROW_H).fill("#dde3ea").stroke("#c8d0da");
        doc.fillColor("#1e293b").fontSize(8).font("Helvetica-Bold")
          .text("TOTAL", tX + 6, y + 6, { width: COLOUR_W - 6, lineBreak: false });
        sx = tX + COLOUR_W;
        for (const sz of productSizes) {
          const t = sizeTotals.get(sz) ?? 0;
          doc.fillColor("#1e293b").fontSize(9).font("Helvetica-Bold")
            .text(t > 0 ? String(t) : "—", sx, y + 6, { width: SIZE_W, align: "center", lineBreak: false });
          sx += SIZE_W;
        }
        doc.fillColor("#1e293b").fontSize(9).font("Helvetica-Bold")
          .text(String(groupTotal), sx, y + 6, { width: TOTAL_W, align: "center", lineBreak: false });
        y += ROW_H;

        grandTotal += groupTotal;
        if (g.price != null) grandValue += groupTotal * g.price;

        // ── Line value annotation ──
        if (g.price != null && groupTotal > 0) {
          const lineValue = groupTotal * g.price;
          doc.fillColor("#64748b").fontSize(7.5).font("Helvetica")
            .text(`£${g.price.toFixed(2)} × ${groupTotal} = `, tX + COLOUR_W, y + 3, { width: SIZE_W * numCols, align: "right", lineBreak: false });
          doc.fillColor("#1e293b").fontSize(8).font("Helvetica-Bold")
            .text(`£${lineValue.toFixed(2)}`, sx, y + 3, { width: TOTAL_W, align: "center", lineBreak: false });
          y += 13;
        }
        y += 16;
      }

      // ── Grand total bar ───────────────────────────────────────────────────────
      if (y + 26 > CONTENT_BOTTOM) y = newPage(y);
      doc.rect(MARGIN, y, W, 26).fill("#1e293b");
      const gtText = grandValue > 0
        ? `Total order: ${grandTotal} units  ·  Est. value: £${grandValue.toFixed(2)}`
        : `Total order: ${grandTotal} units`;
      doc.fillColor("#ffffff").fontSize(11).font("Helvetica-Bold")
        .text(gtText, MARGIN + 8, y + 8, { width: W - 16, align: "right", lineBreak: false });
      y += 38;
    }

    drawFooter(); // draw footer on final page
    doc.end();
  });
}

export function buildPOEmail(po: POData, extraNotes: string): { subject: string; html: string; text: string } {
  const dateStr = new Date(po.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const subject = `Purchase Order ${po.poNumber}`;
  const supplierFirstName = toFirstName(po.supplierContactName ?? po.supplierName);
  const totalUnits = po.items.reduce((s, i) => s + i.quantityOrdered, 0);
  const allNotes = [po.notes, extraNotes].filter(Boolean).join(" — ");

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.10);">

        <!-- Header -->
        <tr><td style="background:#1e293b;padding:22px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;">
               <span>Configured organisation</span>
            </td>
            <td style="vertical-align:middle;text-align:right;">
              <p style="margin:0;color:#64748b;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Purchase Order</p>
              <p style="margin:4px 0 0;color:#fff;font-size:17px;font-weight:700;">${po.poNumber}</p>
              <p style="margin:3px 0 0;color:#cbd5e1;font-size:11px;">${dateStr}</p>
            </td>
          </tr></table>
        </td></tr>

        <!-- Greeting band -->
        <tr><td style="background:#1e3a5f;padding:24px 32px;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;line-height:1.3;">Dear ${supplierFirstName},</p>
          <p style="margin:6px 0 0;font-size:14px;color:#93c5fd;line-height:1.5;">Please find purchase order <strong style="color:#ffffff;">${po.poNumber}</strong> attached — ${totalUnits} unit${totalUnits !== 1 ? "s" : ""} in total.</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:28px 32px;">
          <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.7;">
            All order details are in the PDF attached. Could you please confirm receipt at your earliest convenience? If you have any questions, don't hesitate to get in touch.
          </p>

          ${allNotes ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:12px 16px;margin-bottom:20px;">
            <p style="margin:0;font-size:13px;color:#92400e;"><strong>Notes:</strong> ${allNotes}</p>
          </div>` : ""}

          <p style="font-size:14px;color:#374151;margin:0;line-height:1.6;">
            Kind regards,<br>
             <strong style="color:#1e293b;font-size:15px;">The configured organisation team</strong>
          </p>
        </td></tr>

        <!-- Contact details -->
        <tr><td style="padding:0 32px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dbeafe;border-radius:8px;border-collapse:collapse;overflow:hidden;">
            <tr><td style="background:#eff6ff;padding:12px 18px;border-bottom:1px solid #dbeafe;">
              <p style="margin:0;font-size:13px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.5px;">Questions? We're Here For You</p>
            </td></tr>
            <tr><td style="padding:14px 18px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:5px 0;width:50%;vertical-align:top;">
                    <p style="margin:0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Email</p>
                     <span>Contact details configured per installation</span>
                  </td>
                  <td style="padding:5px 0;width:50%;vertical-align:top;">
                    <p style="margin:0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Phone</p>
                    <a href="${BUSINESS_PHONE_HREF}" style="font-size:13px;color:#1e293b;text-decoration:none;font-weight:500;">${BUSINESS_PHONE_DISPLAY}</a>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f8fafc;padding:14px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;line-height:1.8;">
             Contact details configured per installation<br>
            &middot; <a href="${BUSINESS_PHONE_HREF}" style="color:#94a3b8;text-decoration:none;">${BUSINESS_PHONE_DISPLAY}</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `Purchase Order ${po.poNumber}`,
    ``,
    `Dear ${supplierFirstName},`,
    ``,
    `Please find purchase order ${po.poNumber} attached — ${totalUnits} unit${totalUnits !== 1 ? "s" : ""} in total.`,
    ``,
    `All order details are in the PDF attached. Could you please confirm receipt at your earliest convenience?`,
    allNotes ? `\nNotes: ${allNotes}` : null,
    ``,
    `Questions? Contact the configured organisation.`,
    ``,
    `Kind regards,`,
    `The configured organisation team`,
  ].filter((l) => l !== null).join("\n");

  return { subject, html, text };
}

export interface SupplierChaseItem {
  orderNumber: string;
  productName: string;
  supplierCode: string | null;
  colour: string | null;
  size: string | null;
  remaining: number;
  dueDate: string;
}

export function buildSupplierChaseEmail(params: {
  poNumber: string;
  supplierName: string;
  supplierContactName?: string | null;
  items: SupplierChaseItem[];
}): { subject: string; html: string; text: string } {
  const { poNumber, supplierName, supplierContactName, items } = params;
  const supplierFirstName = toFirstName(supplierContactName ?? supplierName);
  const subject = `Delivery update required — purchase order ${poNumber}`;
  const escapeHtml = (value: string) => value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const formatDueDate = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London",
  });
  const itemRows = items.map((item) => {
    const details = [item.colour, item.size].filter(Boolean).join(" / ");
    return `<tr>
      <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;">${escapeHtml(item.orderNumber)}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#0f172a;">
        <strong>${escapeHtml(item.supplierCode ? `${item.supplierCode} — ${item.productName}` : item.productName)}</strong>
        ${details ? `<br><span style="color:#64748b;font-size:12px;">${escapeHtml(details)}</span>` : ""}
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:center;color:#0f172a;font-weight:700;">${item.remaining}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#b91c1c;white-space:nowrap;">${escapeHtml(formatDueDate(item.dueDate))}</td>
    </tr>`;
  }).join("");
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:32px 16px;">
    <table width="680" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.10);">
      <tr><td style="background:#1e293b;padding:22px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="color:#ffffff;font-size:14px;font-weight:700;">
            <span>Configured organisation</span>
          </td>
          <td style="text-align:right;color:#fff;"><div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Delivery chase</div><div style="font-size:18px;font-weight:700;margin-top:4px;">${escapeHtml(poNumber)}</div></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:28px 32px;">
        <p style="margin:0 0 14px;font-size:18px;font-weight:700;color:#0f172a;">Dear ${escapeHtml(supplierFirstName)},</p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#334155;">The items below from purchase order <strong>${escapeHtml(poNumber)}</strong> are still outstanding and have passed their expected delivery date. Please reply with an updated delivery date for each item.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #cbd5e1;border-radius:8px;border-collapse:collapse;overflow:hidden;">
          <thead><tr style="background:#f8fafc;">
            <th style="padding:9px 8px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;">Our order</th>
            <th style="padding:9px 8px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;">Outstanding item</th>
            <th style="padding:9px 8px;text-align:center;font-size:11px;color:#64748b;text-transform:uppercase;">Qty</th>
            <th style="padding:9px 8px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;">Due</th>
          </tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        <p style="margin:22px 0 0;font-size:14px;line-height:1.6;color:#334155;">Kind regards,<br><strong>The configured organisation team</strong></p>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:14px 32px;border-top:1px solid #e2e8f0;text-align:center;font-size:11px;color:#94a3b8;">Contact details configured per installation</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  const textItems = items.map((item) => {
    const details = [item.supplierCode, item.productName, item.colour, item.size].filter(Boolean).join(" — ");
    return `• ${item.orderNumber}: ${details}; ${item.remaining} outstanding; due ${formatDueDate(item.dueDate)}`;
  }).join("\n");
  const text = `Dear ${supplierFirstName},

The following items from purchase order ${poNumber} are still outstanding and have passed their expected delivery date. Please reply with an updated delivery date for each item.

${textItems}

Kind regards,
The configured organisation team`;
  return { subject, html, text };
}

// ─── Invoice Email Builder ────────────────────────────────────────────────────

export function buildDpdDispatchEmail(params: {
  orderNumber: string;
  customerName: string | null;
  contactFirstName?: string | null;
  trackingNumber: string;
}): { subject: string; html: string; text: string; trackingUrl: string } {
  const safe = (value: string) => value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  const firstName = toFirstName(params.contactFirstName ?? params.customerName) || "there";
  const orderNumber = safe(params.orderNumber);
  const trackingNumber = safe(params.trackingNumber);
  const trackingUrl = `https://track.dpd.co.uk/parcels/${encodeURIComponent(params.trackingNumber)}`;
  const subject = `Your order ${params.orderNumber} has been despatched`;
  const html = `<!doctype html>
<html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center" style="padding:32px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:620px;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#0f172a;padding:24px 32px;">
        <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">Your order is on its way</p>
        <p style="margin:6px 0 0;color:#cbd5e1;font-size:13px;">Order reference ${orderNumber}</p>
      </td></tr>
      <tr><td style="padding:30px 32px;">
        <p style="margin:0 0 16px;font-size:15px;">Hi ${safe(firstName)},</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Your order has now been processed and despatched with DPD.</p>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:18px 20px;margin:20px 0;">
          <p style="margin:0 0 6px;color:#1e40af;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;">DPD tracking number</p>
          <p style="margin:0 0 14px;color:#1e3a8a;font-size:16px;font-family:monospace;font-weight:700;">${trackingNumber}</p>
          <a href="${trackingUrl}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:11px 18px;border-radius:6px;">Track your parcel with DPD</a>
        </div>
        <p style="margin:20px 0 0;font-size:15px;line-height:1.6;">Thank you for your order.</p>
        <p style="margin:16px 0 0;font-size:15px;line-height:1.6;">Kind regards,<br><strong>The configured organisation team</strong></p>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:14px 32px;border-top:1px solid #e2e8f0;text-align:center;font-size:11px;color:#94a3b8;">Contact details configured per installation</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  const text = `Hi ${firstName},

Your order ${params.orderNumber} has now been processed and despatched with DPD.

DPD tracking number: ${params.trackingNumber}
Track your parcel: ${trackingUrl}

Thank you for your order.

Kind regards,
The configured organisation team`;
  return { subject, html, text, trackingUrl };
}

export async function sendDpdDispatchEmailAfterXeroPost(
  orderId: number,
  xeroInvoiceId: string,
): Promise<{ sent: boolean; skippedReason?: string; sentTo?: string }> {
  const [row] = await db
    .select({
      orderNumber: ordersTable.orderNumber,
      customerName: ordersTable.customerName,
      shippingMethod: ordersTable.shippingMethod,
      trackingNumber: ordersTable.trackingNumber,
      customerEmail: customersTable.email,
      billingEmail: customersTable.billingEmail,
      contactFirstName: customersTable.contactFirstName,
    })
    .from(ordersTable)
    .leftJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
    .where(eq(ordersTable.id, orderId));

  if (!row) return { sent: false, skippedReason: "order_not_found" };
  if (!row.shippingMethod?.toLowerCase().includes("dpd")) {
    return { sent: false, skippedReason: "not_dpd" };
  }
  if (!row.trackingNumber?.trim()) {
    return { sent: false, skippedReason: "missing_tracking_number" };
  }
  const to = firstNonBlankEmail(row.customerEmail, row.billingEmail);
  if (!to) return { sent: false, skippedReason: "missing_customer_email" };

  const message = buildDpdDispatchEmail({
    orderNumber: row.orderNumber,
    customerName: row.customerName,
    contactFirstName: row.contactFirstName,
    trackingNumber: row.trackingNumber.trim(),
  });
  const result = await sendEmail({
    to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    idempotencyKey: `dpd-despatch-${orderId}-${xeroInvoiceId}`,
  });
  if (!result.sent) throw new Error(result.error ?? "Failed to send DPD despatch email");
  return { sent: true, sentTo: to };
}

export function buildInvoiceEmail(params: {
  orderNumber: string;
  xeroInvoiceNumber?: string | null;
  customerName: string | null;
  contactFirstName?: string | null;
  customerLogoDataUrl?: string | null;
  customerAddress?: string | null;
  customerCity?: string | null;
  customerPostcode?: string | null;
  deliveryAddressLines?: string[] | null;
  deliveryLabel?: string | null;
  invoiceDate: Date | null;
  shippingMethod?: string | null;
  trackingNumber?: string | null;
  notes?: string | null;
  paidAt?: Date | null;
  stripePaymentLinkUrl?: string | null;
  poNumber?: string | null;
  carriageAmount?: number | null;
  zeroVat?: boolean;
  subjectOverride?: string | null;
  introLines?: string[] | null;
  items: Array<{
    productName: string;
    colour?: string | null;
    size?: string | null;
    finishName?: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    vatRate?: number;
  }>;
}): { subject: string; html: string; text: string } {
  const xeroInvoiceNumber = params.xeroInvoiceNumber?.trim() || null;
  const baseSubject = params.subjectOverride || `Invoice ${params.orderNumber}`;
  const subject = xeroInvoiceNumber && !baseSubject.includes(xeroInvoiceNumber)
    ? `${baseSubject} · Xero ${xeroInvoiceNumber}`
    : baseSubject;
  const firstName = toFirstName(params.contactFirstName ?? params.customerName);
  const isPaid = !!params.paidAt;
  const isCollection = params.shippingMethod
    ? ["office_collection", "warehouse_collection"].includes(params.shippingMethod)
    : false;
  const isWarehouseCollection = params.shippingMethod === "warehouse_collection";
  const isOfficeCollection = params.shippingMethod === "office_collection";

  const fmtDate = (d: Date) =>
    new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });

  const invoiceDateStr = params.invoiceDate ? fmtDate(params.invoiceDate) : fmtDate(new Date());
  const paymentDueDate = params.invoiceDate
    ? new Date(new Date(params.invoiceDate).getTime() + 14 * 86400000)
    : new Date(Date.now() + 14 * 86400000);
  const paymentDueStr = fmtDate(paymentDueDate);

  const carriageVatRate = params.zeroVat ? 0 : 0.2;
  const subtotal = params.items.reduce((s, i) => s + i.lineTotal, 0);
  const carriage = params.carriageAmount ?? 0;
  const vatAmount = params.zeroVat ? 0 : (params.items.reduce((s, i) => s + i.lineTotal * (i.vatRate ?? 0.2), 0) + carriage * carriageVatRate);
  const totalIncVat = subtotal + carriage + vatAmount;
  const effectiveVatRate = vatAmount > 0 ? (vatAmount / (subtotal + carriage)) : 0;
  const vatLabel = params.zeroVat ? "VAT (0%)" : (Math.abs(effectiveVatRate - 0.2) < 0.001 ? "VAT (20%)" : "VAT");

  const itemRows = params.items
    .map(
      (i) => `<tr>
      <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#1e293b;">${i.productName}${i.finishName ? `<br><span style="font-size:11px;color:#6366f1;font-weight:600;">Finish: ${i.finishName}</span>` : ""}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;">${[i.colour, i.size].filter(Boolean).join(" / ") || "—"}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:center;font-size:13px;font-weight:600;color:#1e293b;">${i.quantity}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;color:#64748b;">£${i.unitPrice.toFixed(2)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;font-weight:700;color:#1e293b;">£${i.lineTotal.toFixed(2)}</td>
    </tr>`
    )
    .join("\n");

  const customerLogoBlock = params.customerLogoDataUrl
    ? `<td style="vertical-align:middle;text-align:right;">
        <p style="margin:0 0 6px;color:#64748b;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Billed to</p>
        <img src="${params.customerLogoDataUrl}" alt="${params.customerName ?? "Customer"}" height="38" style="display:block;height:38px;width:auto;max-width:130px;margin-left:auto;" />
      </td>`
    : `<td style="vertical-align:middle;text-align:right;">
        <p style="margin:0;color:#94a3b8;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">${xeroInvoiceNumber ? "Xero invoice" : "Invoice"}</p>
        <p style="margin:4px 0 0;color:#fff;font-size:17px;font-weight:700;">${xeroInvoiceNumber ?? params.orderNumber}</p>
        ${xeroInvoiceNumber ? `<p style="margin:4px 0 0;color:#cbd5e1;font-size:11px;">Our reference: <strong>${params.orderNumber}</strong></p>` : ""}
      </td>`;

  const deliveryAddressBlock = params.deliveryAddressLines?.length
    ? `<tr><td style="padding:0 32px 16px;">
        <p style="margin:0 0 3px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.8px;">Deliver To</p>
        ${params.deliveryLabel ? `<p style="margin:0;font-size:14px;font-weight:700;color:#1e293b;">${params.deliveryLabel}</p>` : ""}
        <p style="margin:4px 0 0;font-size:12px;color:#64748b;line-height:1.6;">${params.deliveryAddressLines.join("<br>")}</p>
      </td></tr>`
    : "";

  const orderRefSubBar = params.customerLogoDataUrl
    ? `<tr><td style="background:#0f172a;padding:10px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><p style="margin:0;color:#64748b;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Our reference</p>
          <p style="margin:2px 0 0;color:#fff;font-size:15px;font-weight:700;">${params.orderNumber}</p></td>
          ${xeroInvoiceNumber ? `<td style="text-align:right;"><p style="margin:0;color:#64748b;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Xero invoice</p>
          <p style="margin:2px 0 0;color:#fff;font-size:15px;font-weight:700;">${xeroInvoiceNumber}</p></td>` : ""}
        </tr></table>
      </td></tr>`
    : "";

  const collectionHtml = isWarehouseCollection
    ? `<tr><td style="padding:0 32px 16px;">
        <div style="background:#dcfce7;border:1px solid #86efac;border-radius:8px;padding:16px 20px;">
          <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#15803d;">Your order is ready for collection!</p>
          <p style="margin:0;font-size:13px;color:#166534;line-height:1.6;">Collection details are configured per installation. Please bring a copy of this invoice or quote your order reference <strong>${params.orderNumber}</strong>.</p>
        </div>
      </td></tr>`
    : isOfficeCollection
    ? `<tr><td style="padding:0 32px 16px;">
        <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:16px 20px;">
          <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#854d0e;">Your order is ready for collection!</p>
          <p style="margin:0;font-size:13px;color:#713f12;line-height:1.6;">Please collect from our office at <strong>3rd Floor, Albion Mills Business Centre, Albion Mills, Apperley Bridge, BD10 9TQ</strong>. Collection hours: <strong>9:30am–4pm, Monday–Friday</strong>. Please bring a copy of this invoice or quote your order reference <strong>${params.orderNumber}</strong>.</p>
        </div>
      </td></tr>`
    : "";

  const trackingHtml = params.trackingNumber
    ? `<tr><td style="padding:0 32px 16px;">
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px 20px;">
          <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#1e40af;">Your order is on its way!</p>
          <p style="margin:0 0 6px;font-size:13px;color:#1e3a8a;">DPD Tracking: <strong style="font-family:monospace;">${params.trackingNumber}</strong></p>
          <a href="https://track.dpd.co.uk/parcels/${params.trackingNumber}" style="font-size:13px;color:#1d4ed8;font-weight:600;text-decoration:none;">Track your parcel on DPD &rarr;</a>
        </div>
      </td></tr>`
    : "";

  const statusRow = isPaid
    ? `<tr style="background:#dcfce7;">
        <td style="padding:10px 16px;font-size:12px;color:#15803d;border-bottom:1px solid #86efac;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Status</td>
        <td style="padding:10px 16px;font-size:13px;font-weight:700;color:#15803d;border-bottom:1px solid #86efac;text-align:right;">&#10003; PAID</td>
      </tr>`
    : `<tr>
        <td style="padding:10px 16px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Payment Due</td>
        <td style="padding:10px 16px;font-size:13px;color:#b45309;font-weight:600;border-bottom:1px solid #e2e8f0;text-align:right;">${paymentDueStr}</td>
      </tr>`;

  const paymentSectionHtml = isPaid
    ? `<tr><td style="padding:0 32px 24px;">
        <div style="background:#dcfce7;border:1px solid #86efac;border-radius:8px;padding:18px 24px;text-align:center;">
          <p style="margin:0;font-size:16px;font-weight:700;color:#15803d;">&#10003; Payment Received — Thank You!</p>
          <p style="margin:6px 0 0;font-size:13px;color:#166534;">This invoice is for your records. No further payment is required.</p>
        </div>
      </td></tr>`
    : `<tr><td style="padding:0 32px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;overflow:hidden;">
          <tr><td style="background:#f8fafc;padding:14px 18px;border-bottom:1px solid #e2e8f0;">
            <p style="margin:0;font-size:13px;font-weight:700;color:#1e293b;text-transform:uppercase;letter-spacing:0.5px;">Payment Details</p>
            <p style="margin:4px 0 0;font-size:13px;color:#64748b;">Payment is due within 14 days. Please quote <strong>${params.orderNumber}</strong> as your reference.</p>
          </td></tr>
          <tr><td style="padding:16px 18px;">
            ${params.stripePaymentLinkUrl
              ? `<table cellpadding="0" cellspacing="0" style="margin-bottom:16px;"><tr><td style="background:#1e3a5f;border-radius:6px;">
                  <a href="${params.stripePaymentLinkUrl}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">Pay by Card Online &rarr;</a>
                </td></tr></table>`
              : ""}
            <table cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;border-collapse:collapse;min-width:260px;">
              <tr style="background:#f1f5f9;"><td colspan="2" style="padding:8px 12px;font-size:10px;font-weight:700;color:#64748b;letter-spacing:0.8px;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">BACS Bank Transfer</td></tr>
              <tr><td style="padding:7px 12px;font-size:12px;color:#64748b;white-space:nowrap;">Payment details</td><td style="padding:7px 12px;font-size:12px;font-weight:600;color:#1e293b;">Configured per installation</td></tr>
              <tr style="background:#f8fafc;"><td style="padding:7px 12px;font-size:12px;color:#64748b;white-space:nowrap;">Reference</td><td style="padding:7px 12px;font-size:12px;font-weight:600;color:#1e293b;font-family:monospace;">${params.orderNumber}</td></tr>
            </table>
          </td></tr>
        </table>
      </td></tr>`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.10);">

        <tr><td style="background:#1e293b;padding:22px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;"><span>Configured organisation</span></td>
            ${customerLogoBlock}
          </tr></table>
        </td></tr>
        ${orderRefSubBar}

        <tr><td style="background:#1e3a5f;padding:24px 32px;">
          ${params.introLines && params.introLines.length > 0
            ? params.introLines.map((line, i) =>
                i === 0
                  ? `<p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;line-height:1.3;">${line}</p>`
                  : `<p style="margin:6px 0 0;font-size:14px;color:#93c5fd;line-height:1.5;">${line}</p>`
              ).join("\n          ")
            : `<p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;line-height:1.3;">Hi ${firstName},</p>
          <p style="margin:6px 0 0;font-size:14px;color:#93c5fd;line-height:1.5;">Please find your invoice attached for order <strong style="color:#ffffff;">${params.orderNumber}</strong>.</p>`
          }
        </td></tr>

        <tr><td style="padding:20px 32px 0;">
          <p style="margin:0 0 3px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.8px;">Billed To</p>
          <p style="margin:0;font-size:14px;font-weight:700;color:#1e293b;">${params.customerName ?? ""}</p>
          ${[params.customerAddress, params.customerCity, params.customerPostcode].filter(Boolean).length
            ? `<p style="margin:4px 0 0;font-size:12px;color:#64748b;line-height:1.6;">${[params.customerAddress, params.customerCity, params.customerPostcode].filter(Boolean).join("<br>")}</p>`
            : ""}
        </td></tr>
        ${deliveryAddressBlock}

        <tr><td style="padding:16px 32px 16px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;overflow:hidden;">
            <tr style="background:#f8fafc;"><td style="padding:10px 16px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Our Reference</td><td style="padding:10px 16px;font-size:13px;font-weight:700;color:#1e293b;border-bottom:1px solid #e2e8f0;text-align:right;">${params.orderNumber}</td></tr>
            ${xeroInvoiceNumber ? `<tr><td style="padding:10px 16px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Xero Invoice Number</td><td style="padding:10px 16px;font-size:13px;font-weight:700;color:#1e293b;border-bottom:1px solid #e2e8f0;text-align:right;">${xeroInvoiceNumber}</td></tr>` : ""}
            <tr><td style="padding:10px 16px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Invoice Date</td><td style="padding:10px 16px;font-size:13px;color:#1e293b;border-bottom:1px solid #e2e8f0;text-align:right;">${invoiceDateStr}</td></tr>
            ${params.poNumber ? `<tr style="background:#fffbeb;"><td style="padding:10px 16px;font-size:12px;color:#92400e;border-bottom:1px solid #fde68a;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Customer PO Ref</td><td style="padding:10px 16px;font-size:14px;font-weight:800;color:#92400e;border-bottom:1px solid #fde68a;text-align:right;font-family:monospace;">${params.poNumber}</td></tr>` : ""}
            ${statusRow}
          </table>
        </td></tr>

        <tr><td style="padding:0 32px 16px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;overflow:hidden;">
            <thead><tr style="background:#1e293b;">
              <th style="padding:10px 14px;text-align:left;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Product</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Colour / Size</th>
              <th style="padding:10px 14px;text-align:center;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Qty</th>
              <th style="padding:10px 14px;text-align:right;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Unit</th>
              <th style="padding:10px 14px;text-align:right;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Total</th>
            </tr></thead>
            <tbody>${itemRows}</tbody>
            <tfoot>
              <tr style="background:#f8fafc;"><td colspan="4" style="padding:10px 14px;text-align:right;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;">Subtotal (exc. VAT)</td><td style="padding:10px 14px;text-align:right;font-size:13px;font-weight:600;color:#1e293b;border-top:1px solid #e2e8f0;">£${subtotal.toFixed(2)}</td></tr>
              ${carriage > 0 ? `<tr style="background:#f8fafc;"><td colspan="4" style="padding:6px 14px;text-align:right;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;">Shipping &amp; Handling</td><td style="padding:6px 14px;text-align:right;font-size:13px;color:#64748b;border-top:1px solid #e2e8f0;">£${carriage.toFixed(2)}</td></tr>` : ""}
              <tr style="background:#f8fafc;"><td colspan="4" style="padding:6px 14px;text-align:right;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;">${vatLabel}</td><td style="padding:6px 14px;text-align:right;font-size:13px;color:#64748b;border-top:1px solid #e2e8f0;">£${vatAmount.toFixed(2)}</td></tr>
              <tr style="background:#1e293b;"><td colspan="4" style="padding:12px 14px;text-align:right;font-size:13px;font-weight:700;color:#ffffff;">Total (inc. VAT)</td><td style="padding:12px 14px;text-align:right;font-size:15px;font-weight:800;color:#ffffff;">£${totalIncVat.toFixed(2)}</td></tr>
            </tfoot>
          </table>
        </td></tr>

        ${collectionHtml}
        ${trackingHtml}
        ${paymentSectionHtml}
        ${params.notes ? `<tr><td style="padding:0 32px 16px;"><div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:12px 16px;"><p style="margin:0;font-size:13px;color:#92400e;"><strong>Order notes:</strong> ${params.notes}</p></div></td></tr>` : ""}

        <tr><td style="padding:0 32px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dbeafe;border-radius:8px;border-collapse:collapse;overflow:hidden;">
            <tr><td style="background:#eff6ff;padding:12px 18px;border-bottom:1px solid #dbeafe;"><p style="margin:0;font-size:13px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.5px;">Questions? We're Here For You</p></td></tr>
            <tr><td style="padding:14px 18px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:5px 0;width:50%;vertical-align:top;"><p style="margin:0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Contact</p><span>Configured per installation</span></td>
                  <td style="padding:5px 0;width:50%;vertical-align:top;"><p style="margin:0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Phone</p><a href="${BUSINESS_PHONE_HREF}" style="font-size:13px;color:#1e293b;text-decoration:none;font-weight:500;">${BUSINESS_PHONE_DISPLAY}</a></td>
                </tr>
                <tr>
                  <td style="padding:5px 0;vertical-align:top;"><p style="margin:0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">WhatsApp</p><a href="${BUSINESS_WHATSAPP_URL}" style="font-size:13px;color:#16a34a;font-weight:500;text-decoration:none;">Message us on WhatsApp</a></td>
                  <td style="padding:5px 0;vertical-align:top;"><p style="margin:0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Live Chat</p><a href="${BUSINESS_CHAT_URL}" style="font-size:13px;color:#1d4ed8;text-decoration:none;font-weight:500;">Chat on our website</a></td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 32px 28px;">
          <p style="font-size:14px;color:#374151;margin:0;line-height:1.6;">Kind regards,<br><strong style="color:#1e293b;font-size:15px;">The configured organisation team</strong></p>
        </td></tr>

        <tr><td style="background:#f8fafc;padding:14px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;line-height:1.8;">
            Contact details configured per installation<br>
            &middot; <a href="${BUSINESS_PHONE_HREF}" style="color:#94a3b8;text-decoration:none;">${BUSINESS_PHONE_DISPLAY}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    subject, ``,
    ...(params.introLines && params.introLines.length > 0
      ? params.introLines.flatMap((line, i) => i === 0 ? [line, ``] : [line, ``])
      : [`Hi ${firstName},`, ``, `Please find your invoice attached for order ${params.orderNumber}.`, ``]
    ),
    `Our Reference: ${params.orderNumber}`,
    xeroInvoiceNumber ? `Xero Invoice Number: ${xeroInvoiceNumber}` : null,
    `Invoice Date: ${invoiceDateStr}`,
    isPaid
      ? `Status: PAID — This invoice is for your records.`
      : `Payment Due: ${paymentDueStr}`,
    ``,
    params.deliveryAddressLines?.length
      ? `DELIVER TO${params.deliveryLabel ? `: ${params.deliveryLabel}` : ""}:\n${params.deliveryAddressLines.join("\n")}`
      : null,
    params.deliveryAddressLines?.length ? `` : null,
    isWarehouseCollection ? `Your order is ready for collection. Collection details are configured per installation.\n` : null,
    isOfficeCollection ? `Your order is ready for collection at:\n3rd Floor, Albion Mills Business Centre, Albion Mills, Apperley Bridge, BD10 9TQ\nCollection hours: 9:30am–4pm, Monday–Friday\n` : null,
    params.trackingNumber ? `Your order is on its way! Tracking: ${params.trackingNumber}\nhttps://track.dpd.co.uk/parcels/${params.trackingNumber}\n` : null,
    `ITEMS:`,
    ...params.items.map(
      (i) =>
        `  ${i.productName}${[i.colour, i.size].filter(Boolean).length ? ` (${[i.colour, i.size].filter(Boolean).join(", ")})` : ""}${i.finishName ? ` [${i.finishName}]` : ""} – Qty: ${i.quantity} @ £${i.unitPrice.toFixed(2)} = £${i.lineTotal.toFixed(2)}`
    ),
    ``,
    `Subtotal (exc. VAT): £${subtotal.toFixed(2)}`,
    `${vatLabel}:${" ".repeat(Math.max(1, 20 - vatLabel.length))}£${vatAmount.toFixed(2)}`,
    `Total (inc. VAT):    £${totalIncVat.toFixed(2)}`,
    ``,
    !isPaid
      ? [
          `PAYMENT:`,
          params.stripePaymentLinkUrl ? `  Pay by card: ${params.stripePaymentLinkUrl}` : null,
          `  Payment details are not configured for this installation.`,
        ]
          .filter(Boolean)
          .join("\n")
      : null,
    params.notes ? `\nOrder notes: ${params.notes}` : null,
    ``,
    `Questions? Contact the configured organisation.`,
    ``,
    `Kind regards,`,
    `The configured organisation team`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  return { subject, html, text };
}

// ─── DB-backed SMTP config (for invoice emails) ───────────────────────────────

async function getDbSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}

async function setDbSetting(key: string, value: string | null): Promise<void> {
  await db.insert(settingsTable).values({ key, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromEmail: string;
  fromName: string;
}

export async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const host = await getDbSetting("smtp_host");
  const port = await getDbSetting("smtp_port");
  const user = await getDbSetting("smtp_user");
  const pass = await getDbSetting("smtp_pass");
  const fromEmail = await getDbSetting("smtp_from_email");
  const fromName = await getDbSetting("smtp_from_name");
  if (!host || !user || !pass || !fromEmail) return null;
  return {
    host,
    port: port ? parseInt(port, 10) : 587,
    secure: port === "465",
    user,
    pass,
    fromEmail,
    fromName,
  };
}

export async function testSmtpConnection(): Promise<{ ok: boolean; error?: string }> {
  const config = await getSmtpConfig();
  if (!config) return { ok: false, error: "SMTP not configured." };
  const t = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    tls: { rejectUnauthorized: false },
  });
  try {
    await t.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Invoice PDF generation ───────────────────────────────────────────────────

interface InvoiceLineItem {
  productName: string;
  colour?: string | null;
  size?: string | null;
  finishName?: string | null;
  recipientName?: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  vatRate?: number;
  /** Used in consolidated invoices to group rows under their originating order ref */
  orderRef?: string | null;
}

interface InvoiceToFollowItem {
  productName: string;
  colour?: string | null;
  size?: string | null;
  finishName?: string | null;
  quantity: number;
  orderRef?: string | null;
  estimatedDueDate?: string | null;
}

interface InvoiceData {
  orderNumber: string;
  xeroInvoiceNumber?: string | null;
  customerName: string;
  customerEmail?: string | null;
  customerAddress?: string | null;
  customerCity?: string | null;
  customerPostcode?: string | null;
  invoiceDate?: Date | null;
  shippingMethod?: string | null;
  trackingNumber?: string | null;
  paidAt?: Date | null;
  stripePaymentLinkUrl?: string | null;
  items: InvoiceLineItem[];
  totalAmount: string;
  carriageAmount?: number | null;
  zeroVat?: boolean;
  notes?: string | null;
  /** Customer purchase-order reference — printed on the invoice */
  poNumber?: string | null;
  /** Items not yet dispatched — shown in an amber "To Follow" section, NOT included in totals */
  toFollowItems?: InvoiceToFollowItem[];
  /** When set, a delivery address breakdown is appended after the To-Follow section */
  deliveryGroups?: Array<{ addressLabel: string; addressText: string; items: InvoiceLineItem[] }>;
  /** Delivery address lines — printed below BILL TO only when different from billing address */
  deliveryAddressLines?: string[] | null;
  /** Delivery location label, e.g. "Head Office" */
  deliveryLabel?: string | null;
}

export async function generateInvoicePDF(data: InvoiceData): Promise<Buffer> {
  const identity = await requireConfiguredBusinessIdentity();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const MARGIN = 50;
    const doc = new PDFDocument({ margin: MARGIN, size: "A4" });
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const PAGE_W = doc.page.width;
    const PAGE_H = doc.page.height;
    const W = PAGE_W - MARGIN * 2;
    const DARK = "#1e293b";
    const NAVY = "#1e3a5f";
    const MID = "#334155";
    const LIGHT = "#f1f5f9";
    const ALT = "#f8fafc";
    const BORDER = "#e2e8f0";
    const DIM = "#64748b";
    const TEXT = "#1e293b";

    const isPaid = !!data.paidAt;
    const isCollection = data.shippingMethod
      ? ["office_collection", "warehouse_collection"].includes(data.shippingMethod)
      : false;
    const isWarehouseCollection = data.shippingMethod === "warehouse_collection";
    const isOfficeCollection = data.shippingMethod === "office_collection";

    const fmtDate = (d: Date | string) =>
      new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });

    const invoiceDateStr = data.invoiceDate ? fmtDate(data.invoiceDate) : fmtDate(new Date());
    const paymentDueDate = data.invoiceDate
      ? new Date(new Date(data.invoiceDate).getTime() + 14 * 86400000)
      : new Date(Date.now() + 14 * 86400000);
    const paymentDueStr = fmtDate(paymentDueDate);

    // ── Header band ──────────────────────────────────────────────────────────
    const HEADER_H = 80;
    doc.rect(0, 0, PAGE_W, HEADER_H).fill(DARK);

    if (BUSINESS_LOGO_BUFFER) {
      doc.image(BUSINESS_LOGO_BUFFER, MARGIN, 18, { height: 36, fit: [200, 36] });
    } else {
      doc.fillColor("white").fontSize(18).font("Helvetica-Bold")
        .text(identity.name, MARGIN, 28);
    }

    // Invoice identifiers top-right
    doc.fillColor("#94a3b8").fontSize(9).font("Helvetica-Bold")
      .text(data.xeroInvoiceNumber ? "XERO INVOICE" : "INVOICE", MARGIN, 18, { width: W, align: "right" });
    doc.fillColor("white").fontSize(20).font("Helvetica-Bold")
      .text(data.xeroInvoiceNumber ?? data.orderNumber, MARGIN, 31, { width: W, align: "right" });
    if (data.xeroInvoiceNumber) {
      doc.fillColor("#cbd5e1").fontSize(8).font("Helvetica")
        .text(`Our reference: ${data.orderNumber}`, MARGIN, 57, { width: W, align: "right" });
    }

    // ── Sub-header band ──────────────────────────────────────────────────────
    const SUB_H = 28;
    doc.rect(0, HEADER_H, PAGE_W, SUB_H).fill(MID);
    doc.fillColor("#cbd5e1").fontSize(8).font("Helvetica")
      .text(`Invoice Date: ${invoiceDateStr}`, MARGIN, HEADER_H + 9, { width: W / 2, lineBreak: false });
    if (isPaid) {
      doc.fillColor("#86efac").fontSize(9).font("Helvetica-Bold")
        .text("✓  PAID", MARGIN, HEADER_H + 8, { width: W, align: "right" });
    } else {
      doc.fillColor("#fde68a").fontSize(8).font("Helvetica")
        .text(`Payment Due: ${paymentDueStr}`, MARGIN, HEADER_H + 9, { width: W, align: "right" });
    }

    // ── Bill To / Details block ───────────────────────────────────────────────
    let y = HEADER_H + SUB_H + 20;
    const HALF = W / 2 - 8;

    doc.fillColor(NAVY).fontSize(8).font("Helvetica-Bold")
      .text("BILL TO", MARGIN, y);
    doc.fillColor(TEXT).fontSize(10).font("Helvetica-Bold")
      .text(data.customerName, MARGIN, y + 14);

    const billToLines: string[] = [];
    if (data.customerAddress) billToLines.push(data.customerAddress);
    if (data.customerCity) billToLines.push(data.customerCity);
    if (data.customerPostcode) billToLines.push(data.customerPostcode);

    doc.fillColor(DIM).fontSize(8.5).font("Helvetica");
    billToLines.forEach((line, i) => {
      doc.text(line, MARGIN, y + 28 + i * 12);
    });

    let leftY = y + 28 + billToLines.length * 12;

    // ── Deliver To (only when different from billing) ─────────────────────────
    if (data.deliveryAddressLines?.length) {
      leftY += 14;
      doc.fillColor(NAVY).fontSize(8).font("Helvetica-Bold")
        .text("DELIVER TO", MARGIN, leftY);
      leftY += 12;
      if (data.deliveryLabel) {
        doc.fillColor(TEXT).fontSize(9).font("Helvetica-Bold")
          .text(data.deliveryLabel, MARGIN, leftY);
        leftY += 13;
      }
      doc.fillColor(DIM).fontSize(8.5).font("Helvetica");
      data.deliveryAddressLines.forEach((line) => {
        doc.text(line, MARGIN, leftY);
        leftY += 12;
      });
    }

    // Right side: invoice metadata
    const RX = MARGIN + HALF + 16;
    const metaRows: [string, string, boolean?][] = [
      ["Our Reference", data.orderNumber],
      ...(data.xeroInvoiceNumber ? [["Xero Invoice Number", data.xeroInvoiceNumber] as [string, string]] : []),
      ["Invoice Date", invoiceDateStr],
      isPaid ? ["Status", "PAID — for your records", true] : ["Payment Due", paymentDueStr],
    ];
    if (data.poNumber) metaRows.push(["Customer PO Ref", data.poNumber]);
    if (data.trackingNumber) metaRows.push(["DPD Tracking", data.trackingNumber]);
    if (isCollection) metaRows.push(["Collection", "Ready to collect"]);

    let my = y;
    for (const [label, val, highlight] of metaRows) {
      doc.fillColor(DIM).fontSize(8).font("Helvetica-Bold")
        .text(label, RX, my, { width: HALF / 2, lineBreak: false });
      doc.fillColor(highlight ? "#16a34a" : TEXT).fontSize(8.5).font(highlight ? "Helvetica-Bold" : "Helvetica")
        .text(val, RX + HALF / 2, my, { width: HALF / 2, align: "right", lineBreak: false });
      my += 16;
    }

    y = Math.max(leftY + 8, my) + 16;

    // ── Items table ──────────────────────────────────────────────────────────
    const COL_DESC_W = Math.floor(W * 0.45);
    const COL_CS_W   = Math.floor(W * 0.2);
    const COL_QTY_W  = Math.floor(W * 0.08);
    const COL_UNIT_W = Math.floor(W * 0.12);
    const COL_TOT_W  = W - COL_DESC_W - COL_CS_W - COL_QTY_W - COL_UNIT_W;

    const HDR_H = 22;
    doc.rect(MARGIN, y, W, HDR_H).fill(DARK);
    doc.fillColor("#94a3b8").fontSize(8).font("Helvetica-Bold");
    let cx = MARGIN + 6;
    doc.text("Description",   cx,              y + 7, { width: COL_DESC_W - 6, lineBreak: false });
    doc.text("Colour / Size", cx + COL_DESC_W, y + 7, { width: COL_CS_W,       lineBreak: false });
    doc.text("Qty",           cx + COL_DESC_W + COL_CS_W, y + 7, { width: COL_QTY_W, align: "right", lineBreak: false });
    doc.text("Unit",          cx + COL_DESC_W + COL_CS_W + COL_QTY_W, y + 7, { width: COL_UNIT_W, align: "right", lineBreak: false });
    doc.text("Total",         cx + COL_DESC_W + COL_CS_W + COL_QTY_W + COL_UNIT_W, y + 7, { width: COL_TOT_W - 6, align: "right", lineBreak: false });
    y += HDR_H;

    const ROW_H = 20;
    const SECTION_H = 18;
    let rowAlt = false;
    let subtotalCalc = 0;
    let vatCalc = 0;
    let lastOrderRef: string | null | undefined = undefined;

    for (const item of data.items) {
      // Section header when items are grouped by order ref (consolidated invoices)
      if (item.orderRef !== undefined && item.orderRef !== lastOrderRef) {
        lastOrderRef = item.orderRef;
        if (y + SECTION_H > PAGE_H - 120) { doc.addPage(); y = MARGIN; }
        doc.rect(MARGIN, y, W, SECTION_H).fill("#f1f5f9");
        doc.fillColor("#475569").fontSize(8).font("Helvetica-Bold")
          .text(`Order: ${item.orderRef ?? "—"}`, MARGIN + 6, y + 5, { width: W - 12, lineBreak: false });
        doc.rect(MARGIN, y + SECTION_H - 1, W, 1).fill(BORDER);
        y += SECTION_H;
        rowAlt = false;
      }

      if (y + ROW_H > PAGE_H - 120) {
        doc.addPage();
        y = MARGIN;
      }
      if (rowAlt) doc.rect(MARGIN, y, W, ROW_H).fill(ALT);
      const desc = item.productName + (item.finishName ? ` [${item.finishName}]` : "") + (item.recipientName ? ` — ${item.recipientName}` : "");
      const cs   = [item.colour, item.size].filter(Boolean).join(" / ") || "—";
      const qty  = item.quantity;
      const unit = parseFloat(item.unitPrice);
      const tot  = parseFloat(item.lineTotal);
      const vatR = data.zeroVat ? 0 : (item.vatRate ?? 0.2);
      subtotalCalc += tot;
      vatCalc += tot * vatR;

      cx = MARGIN + 6;
      doc.fillColor(TEXT).fontSize(8.5).font("Helvetica")
        .text(desc, cx, y + 6, { width: COL_DESC_W - 6, lineBreak: false, ellipsis: true, height: ROW_H - 8 });
      doc.fillColor(DIM)
        .text(cs, cx + COL_DESC_W, y + 6, { width: COL_CS_W, lineBreak: false, ellipsis: true, height: ROW_H - 8 });
      doc.fillColor(TEXT).font("Helvetica-Bold")
        .text(String(qty), cx + COL_DESC_W + COL_CS_W, y + 6, { width: COL_QTY_W, align: "right", lineBreak: false });
      doc.font("Helvetica").fillColor(DIM)
        .text(`£${unit.toFixed(2)}`, cx + COL_DESC_W + COL_CS_W + COL_QTY_W, y + 6, { width: COL_UNIT_W, align: "right", lineBreak: false });
      doc.fillColor(TEXT).font("Helvetica-Bold")
        .text(`£${tot.toFixed(2)}`, cx + COL_DESC_W + COL_CS_W + COL_QTY_W + COL_UNIT_W, y + 6, { width: COL_TOT_W - 6, align: "right", lineBreak: false });

      doc.rect(MARGIN, y + ROW_H - 1, W, 1).fill(BORDER);
      y += ROW_H;
      rowAlt = !rowAlt;
    }

    // ── Totals block ─────────────────────────────────────────────────────────
    y += 12;
    if (y + 90 > PAGE_H - 80) { doc.addPage(); y = MARGIN; }

    const totX = MARGIN + W - 200;
    const totW = 200;

    const drawTotRow = (label: string, val: string, bold = false, bg?: string) => {
      if (bg) doc.rect(totX, y, totW, 20).fill(bg);
      doc.fillColor(bold ? TEXT : DIM).fontSize(bold ? 10 : 9).font(bold ? "Helvetica-Bold" : "Helvetica")
        .text(label, totX + 6, y + 5, { width: totW / 2, lineBreak: false });
      doc.fillColor(bold ? TEXT : DIM).fontSize(bold ? 11 : 9).font(bold ? "Helvetica-Bold" : "Helvetica")
        .text(val, totX, y + 5, { width: totW - 6, align: "right", lineBreak: false });
      y += 20;
    };

    const pdfCarriage = data.carriageAmount ?? 0;
    const pdfCarriageVatRate = data.zeroVat ? 0 : 0.2;
    vatCalc += pdfCarriage * pdfCarriageVatRate;
    const pdfVatLabel = data.zeroVat ? "VAT (0%)" : "VAT (20%)";
    drawTotRow("Subtotal (exc. VAT)", `£${subtotalCalc.toFixed(2)}`, false, ALT);
    if (pdfCarriage > 0) drawTotRow("Shipping & Handling", `£${pdfCarriage.toFixed(2)}`, false, ALT);
    drawTotRow(pdfVatLabel, `£${vatCalc.toFixed(2)}`, false, ALT);

    doc.rect(totX, y, totW, 28).fill(DARK);
    doc.fillColor("white").fontSize(10).font("Helvetica-Bold")
      .text("TOTAL (inc. VAT)", totX + 6, y + 8, { width: totW / 2, lineBreak: false });
    doc.fillColor("white").fontSize(12).font("Helvetica-Bold")
      .text(`£${(subtotalCalc + pdfCarriage + vatCalc).toFixed(2)}`, totX, y + 7, { width: totW - 6, align: "right", lineBreak: false });
    y += 36;

    // ── Payment status / terms ────────────────────────────────────────────────
    y += 16;
    if (y + 60 > PAGE_H - 80) { doc.addPage(); y = MARGIN; }

    if (isPaid) {
      doc.rect(MARGIN, y, W, 40).fill("#dcfce7");
      doc.rect(MARGIN, y, W, 40).stroke("#86efac");
      doc.fillColor("#15803d").fontSize(13).font("Helvetica-Bold")
        .text("✓  PAYMENT RECEIVED — THANK YOU", MARGIN, y + 13, { width: W, align: "center" });
      y += 56;
      doc.fillColor(DIM).fontSize(8.5).font("Helvetica")
        .text("This is your VAT invoice for your records. No further payment is required.", MARGIN, y, { width: W, align: "center" });
      y += 20;
    } else {
      const paymentBodyText = `Payment is due within 14 days (by ${paymentDueStr}). Payment details are available from the configured payment provider. Reference ${data.orderNumber}`;
      doc.font("Helvetica").fontSize(8.5);
      const paymentBodyH = doc.heightOfString(paymentBodyText, { width: W - 20 });
      const paymentBoxH = 24 + paymentBodyH + 12; // 24 = title area, 12 = bottom padding
      doc.rect(MARGIN, y, W, paymentBoxH).fill(LIGHT);
      doc.rect(MARGIN, y, W, paymentBoxH).stroke(BORDER);
      doc.fillColor(NAVY).fontSize(9).font("Helvetica-Bold").text("Payment Terms", MARGIN + 10, y + 8);
      doc.fillColor(TEXT).fontSize(8.5).font("Helvetica")
        .text(paymentBodyText, MARGIN + 10, y + 24, { width: W - 20 });
      y += paymentBoxH + 16;
    }

    if (isWarehouseCollection && !isPaid) {
      y += 8;
      doc.rect(MARGIN, y, W, 40).fill("#dcfce7");
      doc.rect(MARGIN, y, W, 40).stroke("#86efac");
      doc.fillColor("#15803d").fontSize(9).font("Helvetica-Bold")
        .text("Ready for collection — Warehouse", MARGIN + 10, y + 8, { width: W - 20 });
      doc.fillColor("#166534").fontSize(8.5).font("Helvetica")
        .text("Collection address and hours are configured per installation.", MARGIN + 10, y + 22, { width: W - 20 });
      y += 52;
    } else if (isOfficeCollection && !isPaid) {
      y += 8;
      doc.rect(MARGIN, y, W, 40).fill("#fefce8");
      doc.rect(MARGIN, y, W, 40).stroke("#fde68a");
      doc.fillColor("#854d0e").fontSize(9).font("Helvetica-Bold")
        .text("Ready for collection — Office", MARGIN + 10, y + 8, { width: W - 20 });
      doc.fillColor("#713f12").fontSize(8.5).font("Helvetica")
        .text("3rd Floor, Albion Mills Business Centre, Albion Mills, Apperley Bridge, BD10 9TQ  ·  9:30am–4pm, Monday–Friday", MARGIN + 10, y + 22, { width: W - 20 });
      y += 52;
    }

    if (data.notes) {
      y += 8;
      doc.rect(MARGIN, y, W, 32).fill("#fffbeb");
      doc.rect(MARGIN, y, W, 32).stroke("#fde68a");
      doc.fillColor("#92400e").fontSize(8.5).font("Helvetica-Bold").text("Notes: ", MARGIN + 10, y + 11, { continued: true });
      doc.font("Helvetica").text(data.notes, { width: W - 20 });
      y += 44;
    }

    // ── To Follow section (items not yet dispatched — shown for reference, not in totals) ──
    if (data.toFollowItems && data.toFollowItems.length > 0) {
      y += 12;
      if (y + 60 > PAGE_H - 80) { doc.addPage(); y = MARGIN; }

      const TF_HDR_H = 24;
      doc.rect(MARGIN, y, W, TF_HDR_H).fill("#f59e0b");
      doc.fillColor("white").fontSize(9).font("Helvetica-Bold")
        .text("ITEMS TO FOLLOW", MARGIN + 8, y + 7, { width: W / 2, lineBreak: false });
      doc.fillColor("white").fontSize(8).font("Helvetica")
        .text("Outstanding items — not included in the above total. Will be invoiced upon dispatch.", MARGIN + 8, y + 8, { width: W - 16, align: "right", lineBreak: false });
      y += TF_HDR_H;

      // Column header for to-follow
      const TF_COL_DESC = Math.floor(W * 0.42);
      const TF_COL_CS   = Math.floor(W * 0.18);
      const TF_COL_QTY  = Math.floor(W * 0.08);
      const TF_COL_REF  = Math.floor(W * 0.18);
      const TF_COL_DUE  = W - TF_COL_DESC - TF_COL_CS - TF_COL_QTY - TF_COL_REF;

      doc.rect(MARGIN, y, W, 18).fill("#fffbeb");
      doc.fillColor("#92400e").fontSize(7.5).font("Helvetica-Bold");
      doc.text("Item",           MARGIN + 6, y + 5, { width: TF_COL_DESC - 6, lineBreak: false });
      doc.text("Colour / Size",  MARGIN + 6 + TF_COL_DESC, y + 5, { width: TF_COL_CS, lineBreak: false });
      doc.text("Qty",            MARGIN + 6 + TF_COL_DESC + TF_COL_CS, y + 5, { width: TF_COL_QTY, align: "right", lineBreak: false });
      doc.text("Order Ref",      MARGIN + 6 + TF_COL_DESC + TF_COL_CS + TF_COL_QTY, y + 5, { width: TF_COL_REF, lineBreak: false });
      doc.text("Est. Due",       MARGIN + 6 + TF_COL_DESC + TF_COL_CS + TF_COL_QTY + TF_COL_REF, y + 5, { width: TF_COL_DUE - 6, lineBreak: false });
      y += 18;

      let tfAlt = false;
      const fmtTfDate = (d: string | null | undefined) =>
        d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "TBC";

      for (const tf of data.toFollowItems) {
        if (y + ROW_H > PAGE_H - 80) { doc.addPage(); y = MARGIN; }
        if (tfAlt) doc.rect(MARGIN, y, W, ROW_H).fill("#fffbeb");
        const tfCs = [tf.colour, tf.size].filter(Boolean).join(" / ") || "—";
        const tfDesc = tf.productName + (tf.finishName ? ` [${tf.finishName}]` : "");
        doc.fillColor("#92400e").fontSize(8.5).font("Helvetica")
          .text(tfDesc, MARGIN + 6, y + 6, { width: TF_COL_DESC - 6, lineBreak: false, ellipsis: true });
        doc.text(tfCs, MARGIN + 6 + TF_COL_DESC, y + 6, { width: TF_COL_CS, lineBreak: false, ellipsis: true });
        doc.font("Helvetica-Bold")
          .text(String(tf.quantity), MARGIN + 6 + TF_COL_DESC + TF_COL_CS, y + 6, { width: TF_COL_QTY, align: "right", lineBreak: false });
        doc.font("Helvetica")
          .text(tf.orderRef ?? "—", MARGIN + 6 + TF_COL_DESC + TF_COL_CS + TF_COL_QTY, y + 6, { width: TF_COL_REF, lineBreak: false });
        doc.text(fmtTfDate(tf.estimatedDueDate), MARGIN + 6 + TF_COL_DESC + TF_COL_CS + TF_COL_QTY + TF_COL_REF, y + 6, { width: TF_COL_DUE - 6, lineBreak: false });
        doc.rect(MARGIN, y + ROW_H - 1, W, 1).fill("#fde68a");
        y += ROW_H;
        tfAlt = !tfAlt;
      }
      y += 8;
    }

    // ── Per-address delivery breakdown (multi-address orders) ────────────────
    if (data.deliveryGroups && data.deliveryGroups.length > 1) {
      y += 12;
      if (y + 60 > PAGE_H - 80) { doc.addPage(); y = MARGIN; }

      const DA_HDR_H = 24;
      doc.rect(MARGIN, y, W, DA_HDR_H).fill("#1e3a5f");
      doc.fillColor("white").fontSize(9).font("Helvetica-Bold")
        .text("DELIVERY ADDRESS BREAKDOWN", MARGIN + 8, y + 7, { width: W / 2, lineBreak: false });
      doc.fillColor("#94a3b8").fontSize(8).font("Helvetica")
        .text("Items grouped by delivery address for this order.", MARGIN + 8, y + 8, { width: W - 16, align: "right", lineBreak: false });
      y += DA_HDR_H;

      const DA_COL_DESC = Math.floor(W * 0.42);
      const DA_COL_CS   = Math.floor(W * 0.2);
      const DA_COL_QTY  = Math.floor(W * 0.08);
      const DA_COL_TOT  = W - DA_COL_DESC - DA_COL_CS - DA_COL_QTY;

      for (const dg of data.deliveryGroups) {
        if (y + 50 > PAGE_H - 80) { doc.addPage(); y = MARGIN; }
        const dgLabel = dg.addressLabel ? `${dg.addressLabel}  ·  ${dg.addressText}` : dg.addressText;
        doc.rect(MARGIN, y, W, 20).fill("#fffbeb");
        doc.fillColor("#78350f").fontSize(8).font("Helvetica-Bold")
          .text(dgLabel, MARGIN + 6, y + 6, { width: W - 12, lineBreak: false, ellipsis: true });
        y += 20;

        doc.rect(MARGIN, y, W, 16).fill("#fef3c7");
        doc.fillColor("#92400e").fontSize(7).font("Helvetica-Bold");
        doc.text("Item",           MARGIN + 6, y + 4, { width: DA_COL_DESC - 6, lineBreak: false });
        doc.text("Colour / Size",  MARGIN + 6 + DA_COL_DESC, y + 4, { width: DA_COL_CS, lineBreak: false });
        doc.text("Qty",            MARGIN + 6 + DA_COL_DESC + DA_COL_CS, y + 4, { width: DA_COL_QTY, align: "right", lineBreak: false });
        doc.text("Total",          MARGIN + 6 + DA_COL_DESC + DA_COL_CS + DA_COL_QTY, y + 4, { width: DA_COL_TOT - 6, align: "right", lineBreak: false });
        y += 16;

        let daAlt = false;
        for (const item of dg.items) {
          if (item.orderRef !== undefined) continue;
          if (y + ROW_H > PAGE_H - 80) { doc.addPage(); y = MARGIN; }
          if (daAlt) doc.rect(MARGIN, y, W, ROW_H).fill("#fffbeb");
          const daDesc = item.productName + (item.finishName ? ` [${item.finishName}]` : "") + (item.recipientName ? ` — ${item.recipientName}` : "");
          const daCs   = [item.colour, item.size].filter(Boolean).join(" / ") || "—";
          doc.fillColor(TEXT).fontSize(8).font("Helvetica")
            .text(daDesc, MARGIN + 6, y + 6, { width: DA_COL_DESC - 6, lineBreak: false, ellipsis: true });
          doc.fillColor(DIM)
            .text(daCs, MARGIN + 6 + DA_COL_DESC, y + 6, { width: DA_COL_CS, lineBreak: false, ellipsis: true });
          doc.fillColor(TEXT).font("Helvetica-Bold")
            .text(String(item.quantity), MARGIN + 6 + DA_COL_DESC + DA_COL_CS, y + 6, { width: DA_COL_QTY, align: "right", lineBreak: false });
          doc.font("Helvetica")
            .text(`£${parseFloat(item.lineTotal).toFixed(2)}`, MARGIN + 6 + DA_COL_DESC + DA_COL_CS + DA_COL_QTY, y + 6, { width: DA_COL_TOT - 6, align: "right", lineBreak: false });
          doc.rect(MARGIN, y + ROW_H - 1, W, 1).fill("#fde68a");
          y += ROW_H;
          daAlt = !daAlt;
        }
        y += 8;
      }
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    // Two deliberate lines so the long text fits comfortably on A4 (595pt wide).
    const FOOTER_H = 46;
    doc.rect(0, PAGE_H - FOOTER_H, PAGE_W, FOOTER_H).fill(DARK);
    // Zero the bottom margin so PDFKit doesn't auto-insert a new page for text
    // drawn in the absolute footer zone (below the normal content boundary).
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fillColor("#64748b").fontSize(8).font("Helvetica")
      .text(
        `${identity.name} · ${identity.email} · ${identity.phone}`,
        0, PAGE_H - FOOTER_H + 10, { align: "center", width: PAGE_W, lineBreak: false }
      );
    doc.fillColor("#475569").fontSize(7.5).font("Helvetica")
      .text(
        identity.address ?? "",
        0, PAGE_H - FOOTER_H + 23, { align: "center", width: PAGE_W, lineBreak: false }
      );
    doc.page.margins.bottom = savedBottom;

    doc.end();
  });
}

// ─── Send Invoice Email ───────────────────────────────────────────────────────

function firstNonBlankEmail(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const email = value?.trim();
    if (email) return email;
  }
  return null;
}

// Helper to build invoice data from the DB (shared between send + preview)
export async function buildInvoiceDataForOrder(orderId: number): Promise<{
  order: typeof ordersTable.$inferSelect;
  items: (typeof orderItemsTable.$inferSelect & { employeeName: string | null; empDeliveryAddressId: number | null })[];
  customerEmail: string | null;
  contactFirstName: string | null;
  customerLogoDataUrl: string | null;
  invoiceCustomerName: string | null;
  customerAddress: string | null;
  customerCity: string | null;
  customerPostcode: string | null;
  invoiceDeliveryGroups: Array<{ addressLabel: string; addressText: string; items: InvoiceLineItem[] }> | undefined;
  zeroVat: boolean;
  deliveryAddressLines: string[] | null;
  deliveryLabel: string | null;
}> {
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) throw new Error("Order not found.");

  // For part-shipped orders only invoice the items that have actually been dispatched
  const allItemRows = await db
    .select({ item: orderItemsTable, employee: customerEmployeesTable })
    .from(orderItemsTable)
    .leftJoin(customerEmployeesTable, eq(orderItemsTable.recipientEmployeeId, customerEmployeesTable.id))
    .where(eq(orderItemsTable.orderId, orderId));

  const allItems = allItemRows.map(r => ({
    ...r.item,
    employeeName: r.employee
      ? [r.employee.firstName, r.employee.lastName].filter(Boolean).join(" ") || null
      : (r.item.recipientName ?? null),
    empDeliveryAddressId: r.employee?.deliveryAddressId ?? null,
  }));

  const items = order.status === "part_shipped"
    ? allItems.filter(i => i.dispatchedAt != null)
    : allItems;

  let customerEmail: string | null = null;
  let contactFirstName: string | null = null;
  let customerLogoDataUrl: string | null = null;
  let invoiceCustomerName: string | null = null;
  let customerAddress: string | null = null;
  let customerCity: string | null = null;
  let customerPostcode: string | null = null;

  if (order.customerId) {
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, order.customerId));
    contactFirstName = customer?.contactFirstName ?? null;
    if (customer?.logoUrl) customerLogoDataUrl = await fetchLogoDataUrl(customer.logoUrl);

    // Prefer an explicit invoice address record on the order; fall back to the
    // customer's legacy single invoice fields; then fall back to main address.
    const invoiceAddrId = (order as any).invoiceAddressId as number | null | undefined;
    if (invoiceAddrId) {
      const { customerInvoiceAddressesTable } = await import("@workspace/db");
      const [ia] = await db.select().from(customerInvoiceAddressesTable).where(eq(customerInvoiceAddressesTable.id, invoiceAddrId));
      if (ia) {
        invoiceCustomerName = ia.name ?? customer?.invoiceName ?? null;
        customerAddress     = ia.address ?? customer?.invoiceAddress ?? customer?.address ?? null;
        customerCity        = ia.city ?? customer?.invoiceCity ?? customer?.city ?? null;
        customerPostcode    = ia.postcode ?? customer?.invoicePostcode ?? customer?.postcode ?? null;
        customerEmail       = firstNonBlankEmail(ia.billingEmail, customer?.billingEmail, customer?.email);
      } else {
        invoiceCustomerName = customer?.invoiceName ?? null;
        customerAddress     = customer?.invoiceAddress ?? customer?.address ?? null;
        customerCity        = customer?.invoiceCity ?? customer?.city ?? null;
        customerPostcode    = customer?.invoicePostcode ?? customer?.postcode ?? null;
        customerEmail       = firstNonBlankEmail(customer?.billingEmail, customer?.email);
      }
    } else {
      // billingEmail overrides the general contact email for all invoice sends
      customerEmail       = firstNonBlankEmail(customer?.billingEmail, customer?.email);
      // Centralised invoicing: use group/official name + address when set
      invoiceCustomerName = customer?.invoiceName ?? null;
      customerAddress     = customer?.invoiceAddress ?? customer?.address ?? null;
      customerCity        = customer?.invoiceCity ?? customer?.city ?? null;
      customerPostcode    = customer?.invoicePostcode ?? customer?.postcode ?? null;
    }
  }

  // Compute per-address delivery groups when employees have distinct delivery addresses
  const getEffAddrId = (item: typeof items[0]) =>
    item.empDeliveryAddressId ?? (order.deliveryAddressId ?? null);
  const uniqueAddrIds = [...new Set(items.map(i => getEffAddrId(i)))];
  // Keep the invoice's headline delivery address consistent with the order
  // detail and delivery-note routes. A single employee-address assignment is
  // more specific than the order-level fallback; multiple addresses must be
  // shown only in the per-address breakdown.
  const headlineDeliveryAddressId = uniqueAddrIds.length === 1
    ? uniqueAddrIds[0]
    : null;
  let invoiceDeliveryGroups: Array<{ addressLabel: string; addressText: string; items: InvoiceLineItem[] }> | undefined;

  if (uniqueAddrIds.length > 1) {
    const addrIds = uniqueAddrIds.filter((id): id is number => id !== null);
    const addrRows = addrIds.length > 0
      ? await db.select().from(customerDeliveryAddressesTable).where(inArray(customerDeliveryAddressesTable.id, addrIds))
      : [];
    const addrMap = new Map(addrRows.map(a => [a.id, a]));

    const groupMap = new Map<string, typeof items>();
    for (const item of items) {
      const effId = getEffAddrId(item);
      const key = effId !== null ? String(effId) : "null";
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(item);
    }
    invoiceDeliveryGroups = [];
    for (const [key, gItems] of groupMap) {
      const addrId = key !== "null" ? Number(key) : null;
      const addr = addrId !== null ? addrMap.get(addrId) : null;
      const addressText = addr
        ? [addr.line1, addr.line2, addr.city, addr.postcode].filter(Boolean).join(", ")
        : "—";
      invoiceDeliveryGroups.push({
        addressLabel: addr?.label ?? "",
        addressText,
        items: gItems.map(i => ({
          productName: i.productName,
          colour: i.colour,
          size: i.size,
          finishName: i.finishName,
          recipientName: i.employeeName,
          quantity: i.quantity,
          unitPrice: i.unitPrice as string,
          lineTotal: i.lineTotal as string,
          vatRate: parseFloat(i.vatRate as string),
        })),
      });
    }
  }

  const zeroVat = (order.customerId
    ? await db.select({ zeroVat: customersTable.zeroVat }).from(customersTable).where(eq(customersTable.id, order.customerId)).then(r => r[0]?.zeroVat ?? false)
    : false);

  // Fetch the effective delivery address — show on the invoice only when it
  // differs from billing. For multiple addresses the breakdown below is the
  // authoritative display, so do not print one misleading headline address.
  let deliveryAddressLines: string[] | null = null;
  let deliveryLabel: string | null = null;
  if (headlineDeliveryAddressId) {
    const [delivAddr] = await db.select().from(customerDeliveryAddressesTable)
      .where(eq(customerDeliveryAddressesTable.id, headlineDeliveryAddressId));
    if (delivAddr) {
      const delivLines = [delivAddr.line1, delivAddr.line2, delivAddr.city, delivAddr.postcode]
        .filter((l): l is string => !!l);
      const billLines = [customerAddress, customerCity, customerPostcode]
        .filter((l): l is string => !!l);
      if (delivLines.join("|").toLowerCase() !== billLines.join("|").toLowerCase()) {
        deliveryAddressLines = delivLines;
        deliveryLabel = delivAddr.label ?? null;
      }
    }
  }

  return { order, items, customerEmail, contactFirstName, customerLogoDataUrl, invoiceCustomerName, customerAddress, customerCity, customerPostcode, invoiceDeliveryGroups, zeroVat, deliveryAddressLines, deliveryLabel };
}

export async function sendInvoiceEmail(orderId: number, toEmailOverride?: string): Promise<{ sentTo: string }> {
  if (!isEmailConfigured) throw new Error("Email not configured. Go to Settings → Email to set up.");

  const { order, items, customerEmail: resolvedEmail, contactFirstName, customerLogoDataUrl, invoiceCustomerName, customerAddress, customerCity, customerPostcode, invoiceDeliveryGroups, zeroVat, deliveryAddressLines, deliveryLabel } = await buildInvoiceDataForOrder(orderId);
  const customerEmail = toEmailOverride?.trim() || resolvedEmail;
  if (!customerEmail) throw new Error("Customer has no email address on record.");

  // Post first when possible so the customer-facing email and PDF can show
  // Xero's invoice number as well as the internal order reference. Xero remains
  // non-blocking: a disconnected account or API failure must not stop email.
  let xeroInvoiceNumber = order.xeroInvoiceNumber?.trim() || null;
  if (!xeroInvoiceNumber) {
    try {
      const { postInvoiceToXero } = await import("./xero.js");
      const xeroResult = await postInvoiceToXero(orderId);
      xeroInvoiceNumber = xeroResult.invoiceNumber?.trim() || null;
    } catch (err) {
      console.warn(`[invoice-email] Could not obtain Xero invoice number for ${order.orderNumber}; sending with internal reference only:`, err);
    }
  }

  // Always regenerate the Stripe payment link before sending so the amount
  // reflects the current order total + carriage (the cached link may be stale).
  // Use order.totalAmount directly (same as the PATCH handler) so the figure is
  // always consistent with what is stored on the order record.
  let freshPaymentLinkUrl: string | null = order.stripePaymentLinkUrl;
  if (!order.paidAt) {
    const totalAmount = parseFloat(String(order.totalAmount ?? 0));
    const carriageAmount = parseFloat(String(order.carriageAmount ?? 0));
    if (totalAmount > 0) {
      // Separate "Stripe not configured" (swallow silently) from "Stripe API error"
      // (let propagate — so the caller knows the link amount may be wrong).
      let stripeClient: Awaited<ReturnType<typeof getUncachableStripeClient>> | null = null;
      try { stripeClient = await getUncachableStripeClient(); } catch { /* not configured — skip */ }

      if (stripeClient) {
        // Do NOT deactivate the old link — it may already have been shared with the customer
        // in an acknowledgement email and we don't want to invalidate it. The webhook handles
        // payment regardless of which link the customer uses.
        const price = await stripeClient.prices.create({
          unit_amount: Math.round((totalAmount + carriageAmount) * 100 * 1.2),
          currency: "gbp",
          product_data: { name: `Order ${order.orderNumber}` },
        });
        const link = await stripeClient.paymentLinks.create({
          line_items: [{ price: price.id, quantity: 1 }],
          metadata: { order_id: String(orderId), order_number: order.orderNumber },
          after_completion: {
            type: "hosted_confirmation",
            hosted_confirmation: {
          custom_message: `Payment received for order ${order.orderNumber}. Thank you.`,
            },
          },
        });
        freshPaymentLinkUrl = link.url;
        await db.update(ordersTable)
          .set({ stripePaymentLinkUrl: link.url, stripePaymentLinkId: link.id })
          .where(eq(ordersTable.id, orderId));
      }
    }
  }

  const mappedItems = items.map((i) => ({
    productName: i.productName,
    colour: i.colour,
    size: i.size,
    finishName: i.finishName,
    recipientName: i.employeeName,
    quantity: i.quantity,
    unitPrice: parseFloat(i.unitPrice as string),
    lineTotal: parseFloat(i.lineTotal as string),
    vatRate: parseFloat(i.vatRate as string),
  }));

  // Pull subject + intro copy from the editable invoice_email message template.
  // Falls back gracefully to the hardcoded defaults if the template is missing.
  let subjectOverride: string | undefined;
  let introLines: string[] | undefined;
  try {
    const tpl = await getTemplate("invoice_email");
    if (tpl) {
      const carriageAmt = parseFloat(String(order.carriageAmount ?? 0));
      const subtotal = mappedItems.reduce((s, i) => s + i.lineTotal, 0);
      const vatAmt = zeroVat ? 0 : mappedItems.reduce((s, i) => s + i.lineTotal * (i.vatRate ?? 0.2), 0) + carriageAmt * (zeroVat ? 0 : 0.2);
      const totalIncVat = subtotal + carriageAmt + vatAmt;
      const tplVars = {
        firstName: contactFirstName ?? toFirstName(order.customerName) ?? "there",
        orderNumber: order.orderNumber,
        customerName: order.customerName ?? "",
        totalIncVat: `£${totalIncVat.toFixed(2)}`,
      };
      if (tpl.subject) subjectOverride = applyVars(tpl.subject, tplVars);
      if (tpl.body) introLines = applyVars(tpl.body, tplVars).split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    }
  } catch {
    // Non-fatal — fall back to defaults
  }

  const { subject, html, text } = buildInvoiceEmail({
    orderNumber: order.orderNumber,
    xeroInvoiceNumber,
    customerName: invoiceCustomerName ?? order.customerName,
    contactFirstName,
    customerLogoDataUrl,
    customerAddress,
    customerCity,
    customerPostcode,
    deliveryAddressLines,
    deliveryLabel,
    invoiceDate: order.invoiceDate,
    shippingMethod: order.shippingMethod,
    trackingNumber: order.trackingNumber,
    notes: order.notes,
    paidAt: order.paidAt,
    stripePaymentLinkUrl: freshPaymentLinkUrl,
    poNumber: order.poNumber,
    carriageAmount: parseFloat(String(order.carriageAmount ?? 0)),
    zeroVat,
    subjectOverride,
    introLines,
    items: mappedItems,
  });

  const pdfBuffer = await generateInvoicePDF({
    orderNumber: order.orderNumber,
    xeroInvoiceNumber,
    customerName: invoiceCustomerName ?? order.customerName ?? "Customer",
    customerEmail,
    customerAddress,
    customerCity,
    customerPostcode,
    invoiceDate: order.invoiceDate,
    shippingMethod: order.shippingMethod,
    trackingNumber: order.trackingNumber,
    paidAt: order.paidAt,
    stripePaymentLinkUrl: freshPaymentLinkUrl,
    poNumber: order.poNumber,
    carriageAmount: parseFloat(String(order.carriageAmount ?? 0)),
    zeroVat,
    items: items.map((i) => ({
      productName: i.productName,
      colour: i.colour,
      size: i.size,
      finishName: i.finishName,
      recipientName: i.employeeName,
      quantity: i.quantity,
      unitPrice: i.unitPrice as string,
      lineTotal: i.lineTotal as string,
      vatRate: parseFloat(i.vatRate as string),
    })),
    totalAmount: order.totalAmount as string,
    notes: order.notes,
    deliveryGroups: invoiceDeliveryGroups,
    deliveryAddressLines,
    deliveryLabel,
  });

  const result = await sendEmail({
    to: customerEmail,
    subject,
    html,
    text,
    attachments: [{ filename: `Invoice-${order.orderNumber}.pdf`, content: pdfBuffer, contentType: "application/pdf" }],
    // Concurrent attempts see the same previous successful-send timestamp and
    // therefore use the same provider key. Once a send is recorded, a later
    // deliberate resend receives a new key.
    idempotencyKey: `invoice-${orderId}-${order.invoiceEmailSentAt?.toISOString() ?? "initial"}`,
  });

  if (!result.sent) throw new Error(result.error ?? "Failed to send invoice email");

  const now = new Date();
  const isLocalDelivery = ["free_local", "local_delivery"].includes(order.shippingMethod ?? "");
  await db.update(ordersTable)
    .set({
      invoiceEmailSentAt: now,
      invoiceEmailSentTo: customerEmail,
      updatedAt: now,
      // Schedule 48-hour review follow-up for all non-local-delivery orders.
      // Local delivery orders use the separate local_delivery_followup_due_at system.
      ...(!isLocalDelivery ? { invoiceFollowupDueAt: new Date(now.getTime() + 48 * 60 * 60 * 1000) } : {}),
    })
    .where(eq(ordersTable.id, orderId));

  return { sentTo: customerEmail };
}

// ─── Customer re-engagement ("checking in") email ─────────────────────────────

export function buildCheckInEmail(opts: {
  customerName: string;
  firstName: string;
  portalUrl?: string | null;
  customerLogoDataUrl?: string | null;
}): { html: string; text: string } {
  const { customerName, firstName, portalUrl, customerLogoDataUrl } = opts;

  const ctaUrl = portalUrl ?? "#";
  const ctaLabel = portalUrl ? "Browse Your Wardrobe" : "Get in Touch";

  const promptCards: Array<{ icon: string; title: string; body: string }> = [
    { icon: "🌦️", title: "Seasonal refresh", body: "As the weather changes, it's worth checking your team has the right layers and outerwear to stay comfortable and on-brand." },
    { icon: "👕", title: "Replace tired items", body: "Worn garments can let your brand down. Swapping them out is a quick win for keeping your team looking sharp." },
    { icon: "✨", title: "Something new?", body: "New team members, new roles, new products — we can add anything to your wardrobe quickly and easily." },
  ];

  const cardHtml = promptCards.map(c => `
        <td width="33.33%" valign="top" style="padding:0 8px 16px;">
          <div style="background:#f8fafc;border:1px solid #e6ebf2;border-radius:12px;padding:18px 14px;height:100%;">
            <div style="font-size:22px;line-height:1;margin-bottom:10px;">${c.icon}</div>
            <div style="color:#0f172a;font-size:13.5px;font-weight:700;margin:0 0 4px;">${c.title}</div>
            <div style="color:#64748b;font-size:12px;line-height:1.5;margin:0;">${c.body}</div>
          </div>
        </td>`).join("");

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#eef2f8;padding:32px 12px;margin:0;">
  <div style="max-width:600px;margin:0 auto;">

    <!-- Header banner -->
    <div style="background-color:#1e3a8a;background-image:linear-gradient(135deg,#0f172a 0%,#1e3a8a 100%);border-radius:16px 16px 0 0;padding:36px 40px 32px;text-align:center;">
      <table role="presentation" align="center" style="margin:0 auto 20px;border-collapse:collapse;">
        <tr>
          <td style="padding:10px 18px;background:#ffffff;border-radius:10px;vertical-align:middle;">
            <span style="font-weight:700;">Configured organisation</span>
          </td>
          ${customerLogoDataUrl ? `
          <td style="padding:0 14px;color:#94a3b8;font-size:20px;vertical-align:middle;">&times;</td>
          <td style="padding:10px 18px;background:#ffffff;border-radius:10px;vertical-align:middle;">
            <img src="${customerLogoDataUrl}" alt="${customerName}" style="height:36px;max-width:140px;display:block;object-fit:contain;" />
          </td>` : ""}
        </tr>
      </table>
      <p style="color:#93c5fd;font-size:12.5px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 10px;">From the configured organisation</p>
      <h1 style="color:#ffffff;font-size:24px;font-weight:800;margin:0;line-height:1.3;">Just checking in — is your wardrobe still working for you?</h1>
    </div>

    <!-- Body -->
    <div style="background:#ffffff;padding:36px 40px;border-left:1px solid #e6ebf2;border-right:1px solid #e6ebf2;">
      <p style="color:#334155;font-size:15.5px;line-height:1.7;margin:0 0 16px;">
        Hi ${firstName},
      </p>
      <p style="color:#334155;font-size:15.5px;line-height:1.7;margin:0 0 16px;">
        We just wanted to check in and make sure all is ok. It's been a little while since your last order, so we thought it was worth a quick note.
      </p>
      <p style="color:#334155;font-size:15.5px;line-height:1.7;margin:0 0 28px;">
        As the seasons change, it's always a good time to see if there are any extra items you'd like to add to your wardrobe — or if any pieces are looking a little tired and could do with replacing. Keeping your team's look fresh is one of the simplest ways to keep your brand looking smart.
      </p>

      <table role="presentation" width="100%" style="border-collapse:collapse;margin-bottom:8px;">
        <tr>${cardHtml}</tr>
      </table>

      <div style="text-align:center;margin:28px 0 32px;">
        <a href="${ctaUrl}" style="display:inline-block;background:#1e3a8a;color:#ffffff;text-decoration:none;padding:16px 44px;border-radius:10px;font-size:16px;font-weight:700;box-shadow:0 4px 14px rgba(30,58,138,0.35);">${ctaLabel}</a>
      </div>

      <div style="background:#f0f7ff;border:1px solid #dbeafe;border-radius:12px;padding:20px 22px;margin:0 0 24px;">
        <p style="color:#1e3a8a;font-size:13.5px;font-weight:700;margin:0 0 6px;">Not sure what you need?</p>
        <p style="color:#475569;font-size:13.5px;line-height:1.6;margin:0;">Just give us a call or drop us an email — we're always happy to help you refresh your range, check sizing, or explore new products that might suit your team.</p>
      </div>

      <div style="border-top:1px dashed #e2e8f0;padding-top:18px;text-align:center;">
        <p style="color:#94a3b8;font-size:12.5px;margin:0;">If you've already been in touch with your account manager recently, please ignore this message.</p>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#0f172a;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center;">
      <p style="color:#93c5fd;font-size:13px;font-weight:700;margin:0 0 4px;">Your uniform. Your people. Your brand.</p>
      <p style="color:#64748b;font-size:11.5px;margin:8px 0 0;">Contact details are configured per installation</p>
    </div>

  </div>
</body>
</html>`;

  const text = `Hi ${firstName},\n\nWe just wanted to check in and make sure all is ok. It's been a little while since your last order, so we thought it was worth a quick note.\n\nAs the seasons change, it's always a good time to check whether your team needs anything new or replacement items.\n\n${portalUrl ? `Browse your wardrobe here:\n${portalUrl}\n\n` : ""}Please contact the configured organisation if you need help.\n\nConfigured organisation`;

  return { html, text };
}

// ─── Local delivery out-for-delivery notification email ───────────────────────
export function buildLocalDeliveryNotificationEmail(opts: {
  customerName: string;
  orderNumber: string;
  customerLogoDataUrl?: string | null;
}): { html: string; text: string } {
  const { customerName, orderNumber, customerLogoDataUrl } = opts;
  const firstName = customerName.split(/\s/)[0] || "there";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#eef2f8;padding:32px 12px;margin:0;">
  <div style="max-width:600px;margin:0 auto;">
    <div style="background-color:#1e3a8a;background-image:linear-gradient(135deg,#0f172a 0%,#1e3a8a 100%);border-radius:16px 16px 0 0;padding:36px 40px 32px;text-align:center;">
      <table role="presentation" align="center" style="margin:0 auto 20px;border-collapse:collapse;"><tr>
        <td style="padding:10px 18px;background:#ffffff;border-radius:10px;vertical-align:middle;">
          <span>Configured organisation</span>
        </td>
        ${customerLogoDataUrl ? `<td style="padding:0 14px;color:#94a3b8;font-size:20px;vertical-align:middle;">&times;</td>
        <td style="padding:10px 18px;background:#ffffff;border-radius:10px;vertical-align:middle;">
          <img src="${customerLogoDataUrl}" alt="${customerName}" style="height:36px;max-width:140px;display:block;object-fit:contain;" />
        </td>` : ""}
      </tr></table>
      <div style="font-size:48px;margin:0 0 12px;">🚚</div>
      <h1 style="color:#ffffff;font-size:26px;font-weight:800;margin:0;line-height:1.3;">Your order is out for delivery today!</h1>
    </div>
    <div style="background:#ffffff;padding:36px 40px;border-left:1px solid #e6ebf2;border-right:1px solid #e6ebf2;">
      <p style="color:#334155;font-size:15.5px;line-height:1.7;margin:0 0 20px;">Hi ${firstName},</p>
      <p style="color:#334155;font-size:15.5px;line-height:1.7;margin:0 0 20px;">
        Great news — your order <strong>${orderNumber}</strong> is on its way to you today!
      </p>
      <div style="background:#f0f7ff;border:1px solid #dbeafe;border-radius:12px;padding:20px 24px;margin:0 0 24px;">
        <div style="display:flex;align-items:flex-start;gap:14px;">
          <span style="font-size:32px;flex-shrink:0;">🧑‍✈️</span>
          <div>
            <p style="color:#1e3a8a;font-size:14.5px;font-weight:700;margin:0 0 6px;">Your delivery</p>
            <p style="color:#475569;font-size:14px;line-height:1.6;margin:0;">Your parcel is being delivered according to the configured delivery schedule.</p>
          </div>
        </div>
      </div>
      <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 24px;">
        If you have any questions or there's anything you need, please don't hesitate to get in touch — we're always happy to help.
      </p>
      <div style="text-align:center;margin:0 0 8px;">
        <a href="#" style="display:inline-block;background:#1e3a8a;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:10px;font-size:15px;font-weight:700;box-shadow:0 4px 14px rgba(30,58,138,0.35);">Get in Touch</a>
      </div>
    </div>
    <div style="background:#0f172a;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center;">
      <p style="color:#93c5fd;font-size:13px;font-weight:700;margin:0 0 4px;">Your uniform. Your people. Your brand.</p>
      <p style="color:#64748b;font-size:11.5px;margin:8px 0 0;">Contact details configured per installation</p>
    </div>
  </div>
</body>
</html>`;

  const text = `Hi ${firstName},\n\nYour order ${orderNumber} is out for delivery today!\n\nYour parcel is being delivered according to the configured delivery schedule.\n\nContact details configured per installation\n\nConfigured organisation`;
  return { html, text };
}

// ─── 48-hour delivery follow-up / review request email ────────────────────────
export function buildDeliveryFollowupEmail(opts: {
  customerName: string;
  orderNumber: string;
  actorName?: string | null;
  googleReviewUrl?: string | null;
  facebookReviewUrl?: string | null;
  customerLogoDataUrl?: string | null;
}): { html: string; text: string } {
  const { customerName, orderNumber, actorName, googleReviewUrl, facebookReviewUrl, customerLogoDataUrl } = opts;
  const firstName = customerName.split(/\s/)[0] || "there";
  const hasReview = googleReviewUrl || facebookReviewUrl;

  const reviewButtons = hasReview ? `
      <div style="text-align:center;margin:20px 0;">
        ${googleReviewUrl ? `<a href="${googleReviewUrl}" style="display:inline-block;background:#4285F4;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:10px;font-size:14px;font-weight:700;margin:4px;box-shadow:0 3px 10px rgba(66,133,244,0.35);">⭐ Review on Google</a>` : ""}
        ${facebookReviewUrl ? `<a href="${facebookReviewUrl}" style="display:inline-block;background:#1877F2;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:10px;font-size:14px;font-weight:700;margin:4px;box-shadow:0 3px 10px rgba(24,119,242,0.35);">👍 Review on Facebook</a>` : ""}
      </div>` : "";

  const actorBlock = `
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:18px 22px;margin:0 0 24px;">
        <p style="color:#15803d;font-size:13.5px;font-weight:700;margin:0 0 6px;">⭐ Mention your team member by name</p>
        <p style="color:#374151;font-size:13.5px;line-height:1.6;margin:0;">${
          actorName
            ? `If <strong>${actorName}</strong> went above and beyond for you, please do mention them by name in your review — it means the world to the team and really makes a difference to a small business like ours.`
            : `If anyone in our team went above and beyond for you, please do mention them by name in your review — it means the world to the team and really makes a difference.`
        }</p>
      </div>`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#eef2f8;padding:32px 12px;margin:0;">
  <div style="max-width:600px;margin:0 auto;">
    <div style="background-color:#1e3a8a;background-image:linear-gradient(135deg,#0f172a 0%,#1e3a8a 100%);border-radius:16px 16px 0 0;padding:36px 40px 32px;text-align:center;">
      <table role="presentation" align="center" style="margin:0 auto 20px;border-collapse:collapse;"><tr>
        <td style="padding:10px 18px;background:#ffffff;border-radius:10px;vertical-align:middle;">
          <span>Configured organisation</span>
        </td>
        ${customerLogoDataUrl ? `<td style="padding:0 14px;color:#94a3b8;font-size:20px;vertical-align:middle;">&times;</td>
        <td style="padding:10px 18px;background:#ffffff;border-radius:10px;vertical-align:middle;">
          <img src="${customerLogoDataUrl}" alt="${customerName}" style="height:36px;max-width:140px;display:block;object-fit:contain;" />
        </td>` : ""}
      </tr></table>
      <div style="font-size:48px;margin:0 0 12px;">📦</div>
      <h1 style="color:#ffffff;font-size:26px;font-weight:800;margin:0;line-height:1.3;">How did your order arrive?</h1>
    </div>
    <div style="background:#ffffff;padding:36px 40px;border-left:1px solid #e6ebf2;border-right:1px solid #e6ebf2;">
      <p style="color:#334155;font-size:15.5px;line-height:1.7;margin:0 0 20px;">Hi ${firstName},</p>
      <p style="color:#334155;font-size:15.5px;line-height:1.7;margin:0 0 20px;">
        We just wanted to check in and make sure your order <strong>${orderNumber}</strong> arrived safely and everything is just as you expected. We hope you and your team are delighted with it!
      </p>
      <p style="color:#334155;font-size:15.5px;line-height:1.7;margin:0 0 24px;">
        If anything wasn't quite right, please let us know straight away — we'll always put it right.
      </p>
      ${hasReview ? `
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:20px 22px;margin:0 0 16px;">
        <p style="color:#92400e;font-size:14px;font-weight:700;margin:0 0 8px;">💛 Happy with your order? We'd love a review!</p>
        <p style="color:#374151;font-size:13.5px;line-height:1.6;margin:0;">Reviews make a huge difference to a small business like ours. If you have a spare moment, a few words on Google or Facebook would mean so much.</p>
      </div>
      ${reviewButtons}` : ""}
      ${actorBlock}
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px;">
        <p style="color:#374151;font-size:13.5px;font-weight:600;margin:0 0 4px;">Any questions or issues?</p>
        <p style="color:#64748b;font-size:13px;margin:0 0 6px;">Get in touch — we're always happy to help.</p>
        <p style="color:#1e3a8a;font-size:13.5px;font-weight:700;margin:0;">Contact details configured per installation</p>
      </div>
    </div>
    <div style="background:#0f172a;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center;">
      <p style="color:#93c5fd;font-size:13px;font-weight:700;margin:0 0 4px;">Your uniform. Your people. Your brand.</p>
      <p style="color:#64748b;font-size:11.5px;margin:8px 0 0;">Contact details configured per installation</p>
    </div>
  </div>
</body>
</html>`;

  const reviewText = hasReview
    ? `\nWe'd love it if you could leave us a review:\n${googleReviewUrl ? `Google: ${googleReviewUrl}\n` : ""}${facebookReviewUrl ? `Facebook: ${facebookReviewUrl}\n` : ""}${actorName ? `\nIf ${actorName} went above and beyond, please mention them by name — it means so much to the team.\n` : "\nIf anyone in our team went above and beyond, please mention them by name.\n"}`
    : "";

  const text = `Hi ${firstName},\n\nWe just wanted to check in and make sure your order ${orderNumber} arrived safely and everything is as expected.\n\nIf there is anything that was not quite right, please contact the configured organisation.\n${reviewText}\n\nConfigured organisation`;
  return { html, text };
}
