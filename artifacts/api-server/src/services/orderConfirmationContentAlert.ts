import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sendEmail } from "./email.js";
import { getBusinessConfig } from "../lib/business-config.js";

const ALERT_ACTION = "Confirmation content alert sent";
async function getAlertRecipients(): Promise<string[]> {
  const config = await getBusinessConfig();
  const recipients = config?.notificationRecipients;
  return Array.isArray(recipients)
    ? recipients.filter((value): value is string => typeof value === "string" && value.includes("@"))
    : [];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function attachmentNames(value: unknown): string[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const name = (item as { name?: unknown }).name;
      return typeof name === "string" && name.trim() ? name.trim() : "Attached file";
    })
    .filter((name): name is string => Boolean(name));
}

export async function sendOrderConfirmationContentAlert(
  orderId: number,
  actor = "System",
): Promise<{ sent: boolean; skipped?: boolean; error?: string }> {
  const result = await db.execute(sql`
    SELECT
      o.order_number,
      o.customer_name,
      o.notes,
      o.portal_notes,
      o.attachments,
      COALESCE(
        json_agg(
          json_build_object('productName', oi.product_name, 'notes', oi.notes)
        ) FILTER (WHERE NULLIF(BTRIM(oi.notes), '') IS NOT NULL),
        '[]'::json
      ) AS item_notes,
      true AS found
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.id = ${orderId}
    GROUP BY o.id
  `);

  const order = result.rows[0] as any;
  if (!order) return { sent: false, skipped: true };

  const orderNotes = typeof order.notes === "string" ? order.notes.trim() : "";
  const portalNotes = typeof order.portal_notes === "string" ? order.portal_notes.trim() : "";
  const itemNotes = Array.isArray(order.item_notes)
    ? order.item_notes.filter((item: any) => typeof item?.notes === "string" && item.notes.trim())
    : [];
  const files = attachmentNames(order.attachments);

  if (!orderNotes && !portalNotes && itemNotes.length === 0 && files.length === 0) {
    return { sent: false, skipped: true };
  }

  const claim = await db.execute(sql`
    WITH inserted AS (
      INSERT INTO order_confirmation_content_alerts (order_id)
      VALUES (${orderId})
      ON CONFLICT (order_id) DO NOTHING
      RETURNING order_id
    ), reclaimed AS (
      UPDATE order_confirmation_content_alerts
      SET status = 'pending',
          attempts = attempts + 1,
          last_error = NULL,
          updated_at = now()
      WHERE order_id = ${orderId}
        AND NOT EXISTS (SELECT 1 FROM inserted)
        AND (
          status = 'failed'
          OR (status = 'pending' AND updated_at < now() - interval '5 minutes')
        )
      RETURNING order_id
    )
    SELECT order_id FROM inserted
    UNION ALL
    SELECT order_id FROM reclaimed
  `);
  if (claim.rows.length === 0) return { sent: false, skipped: true };

  const reasons = [
    orderNotes || portalNotes || itemNotes.length > 0 ? "notes" : null,
    files.length > 0 ? `${files.length} file attachment${files.length === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" and ");

  const noteText = [
    orderNotes ? `Order note:\n${orderNotes}` : null,
    portalNotes ? `Portal note:\n${portalNotes}` : null,
    ...itemNotes.map((item: any) =>
      `Item note${item.productName ? ` — ${item.productName}` : ""}:\n${item.notes.trim()}`),
  ].filter(Boolean).join("\n\n");

  const fileText = files.length > 0
    ? `File attachment${files.length === 1 ? "" : "s"}:\n${files.map(name => `- ${name}`).join("\n")}`
    : "";

  const subject = `Order ${order.order_number} confirmed with ${reasons}`;
  const text = [
    `Order ${order.order_number} has been confirmed and contains ${reasons}.`,
    order.customer_name ? `Customer: ${order.customer_name}` : null,
    noteText || null,
    fileText || null,
    "Please open the order in the Sales Order System to review it.",
  ].filter(Boolean).join("\n\n");
  const html = `
    <p>Order <strong>${escapeHtml(String(order.order_number))}</strong> has been confirmed and contains ${escapeHtml(reasons)}.</p>
    ${order.customer_name ? `<p><strong>Customer:</strong> ${escapeHtml(String(order.customer_name))}</p>` : ""}
    ${noteText ? `<h3>Notes</h3><pre style="white-space:pre-wrap;font-family:Arial,sans-serif">${escapeHtml(noteText)}</pre>` : ""}
    ${files.length > 0 ? `<h3>File attachments</h3><ul>${files.map(name => `<li>${escapeHtml(name)}</li>`).join("")}</ul>` : ""}
    <p>Please open the order in the Sales Order System to review it.</p>
  `;

  const alertRecipients = await getAlertRecipients();
  if (alertRecipients.length === 0) return { sent: false, skipped: true, error: "No notification recipients configured." };
  const emailResult = await sendEmail({
    to: alertRecipients,
    subject,
    html,
    text,
    idempotencyKey: `order-confirmation-content-${orderId}`,
  });

  if (!emailResult.sent) {
    await db.execute(sql`
      UPDATE order_confirmation_content_alerts
      SET status = 'failed',
          last_error = ${emailResult.error ?? "Email not sent"},
          updated_at = now()
      WHERE order_id = ${orderId}
    `);
    console.error(`[confirmationContentAlert] Order ${orderId}: ${emailResult.error ?? "email not sent"}`);
    return { sent: false, error: emailResult.error ?? "Email not sent" };
  }

  await db.execute(sql`
    UPDATE order_confirmation_content_alerts
    SET status = 'sent',
        provider_message_id = ${emailResult.messageId ?? null},
        sent_at = now(),
        updated_at = now()
    WHERE order_id = ${orderId}
  `);
  await db.execute(sql`
    INSERT INTO order_logs (order_id, action, actor, details)
    SELECT
      ${orderId},
      ${ALERT_ACTION},
      ${actor || "System"},
       ${`Sent to configured notification recipients via ${emailResult.provider ?? "email"}`}
    WHERE NOT EXISTS (
      SELECT 1 FROM order_logs
      WHERE order_id = ${orderId} AND action = ${ALERT_ACTION}
    )
  `);

  return { sent: true };
}