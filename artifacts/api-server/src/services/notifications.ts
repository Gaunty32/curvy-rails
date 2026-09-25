import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sendEmail, isEmailConfigured } from "./email.js";
import { configuredBusinessName, getBusinessConfig } from "../lib/business-config.js";

/**
 * Create an in-app portal notification.
 * If portalUserId is null the notification is addressed to the individual user (broadcast).
 */
export async function createPortalNotification(opts: {
  customerId: number;
  portalUserId?: number | null;
  title: string;
  body?: string;
  link?: string;
  type?: string;
}): Promise<void> {
  const { customerId, portalUserId = null, title, body = null, link = null, type = "info" } = opts;
  await db.execute(sql`
    INSERT INTO portal_notifications (customer_id, portal_user_id, title, body, link, type)
    VALUES (${customerId}, ${portalUserId}, ${title}, ${body}, ${link}, ${type})
  `);
}

/** Notify all active managers for a customer (used when an order needs approval). */
export async function notifyCustomerManagers(opts: {
  customerId: number;
  title: string;
  body?: string;
  link?: string;
  type?: string;
}): Promise<void> {
  const managerRows = await db.execute(sql`
    SELECT id FROM customer_portal_users
    WHERE customer_id = ${opts.customerId} AND portal_role = 'manager' AND status = 'active'
  `);
  for (const row of managerRows.rows as any[]) {
    await createPortalNotification({ ...opts, portalUserId: row.id });
  }
}

/** Notify the portal user whose email matches (used to notify the submitter on approval). */
export async function notifyPortalUserByEmail(opts: {
  customerId: number;
  email: string;
  title: string;
  body?: string;
  link?: string;
  type?: string;
}): Promise<void> {
  const userRows = await db.execute(sql`
    SELECT id FROM customer_portal_users
    WHERE customer_id = ${opts.customerId} AND email = ${opts.email} AND status = 'active'
  `);
  for (const row of userRows.rows as any[]) {
    await createPortalNotification({ ...opts, portalUserId: row.id });
  }
}

/** Notify ALL active portal users of a customer (used for dispatch). */
export async function notifyAllPortalUsers(opts: {
  customerId: number;
  title: string;
  body?: string;
  link?: string;
  type?: string;
}): Promise<void> {
  const userRows = await db.execute(sql`
    SELECT id FROM customer_portal_users WHERE customer_id = ${opts.customerId} AND status = 'active'
  `);
  for (const row of userRows.rows as any[]) {
    await createPortalNotification({ ...opts, portalUserId: row.id });
  }
}

// ─── Mobile "Save to Home Screen" instructions email ─────────────────────────

export async function buildMobileInstructionsEmail(opts: {
  recipientName: string;
  portalUrl: string;
  customerName?: string;
}): Promise<{ subject: string; html: string; text: string }> {
  const { recipientName, portalUrl, customerName } = opts;
  const firstName = recipientName.split(" ")[0] || recipientName;
  const subject = "Access Your Ordering Portal — Save to Home Screen";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subject}</title>
<style>
  body { margin:0; padding:0; background:#f4f4f5; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#18181b; }
  .wrapper { max-width:600px; margin:0 auto; padding:32px 16px; }
  .card { background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.08); }
  .header { background:#1a1a2e; padding:32px 40px; text-align:center; }
  .header h1 { color:#ffffff; margin:0; font-size:22px; font-weight:700; letter-spacing:-0.3px; }
  .body { padding:36px 40px; }
  .body p { margin:0 0 16px; font-size:15px; line-height:1.6; color:#3f3f46; }
  .step-block { background:#f8fafc; border-left:4px solid #6366f1; border-radius:6px; padding:16px 20px; margin:20px 0; }
  .step-block h3 { margin:0 0 12px; font-size:15px; font-weight:700; color:#18181b; }
  .step { display:flex; align-items:flex-start; gap:12px; margin-bottom:10px; }
  .step-num { background:#6366f1; color:#fff; border-radius:50%; min-width:24px; height:24px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; }
  .step-text { font-size:14px; line-height:1.5; color:#52525b; padding-top:3px; }
  .cta { display:block; margin:24px 0; background:#6366f1; color:#ffffff; text-align:center; padding:14px 28px; border-radius:8px; font-weight:600; font-size:15px; text-decoration:none; }
  .url-box { background:#f4f4f5; border:1px solid #e4e4e7; border-radius:6px; padding:10px 14px; font-family:monospace; font-size:13px; color:#52525b; word-break:break-all; margin:12px 0 24px; }
  .divider { border:none; border-top:1px solid #e4e4e7; margin:28px 0; }
  .footer { text-align:center; padding:20px; font-size:12px; color:#a1a1aa; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="card">
    <div class="header">
      <h1>&#128241; Add to Your Home Screen</h1>
    </div>
    <div class="body">
      <p>Hi ${firstName},</p>
      <p>You can use the ${customerName ? `<strong>${customerName}</strong> ` : ""}ordering portal just like a mobile app &mdash; no app store needed. Simply save it to your home screen and it will open full-screen like a native app, with notification support on Android and iPhone.</p>

      <a href="${portalUrl}" class="cta">Open the Portal</a>
      <div class="url-box">${portalUrl}</div>

      <div class="step-block">
        <h3>&#127822; iPhone / iPad (Safari)</h3>
        <div class="step"><span class="step-num">1</span><span class="step-text">Open the link above in <strong>Safari</strong> (not Chrome or Firefox).</span></div>
        <div class="step"><span class="step-num">2</span><span class="step-text">Tap the <strong>Share</strong> button at the bottom of the screen (the square with an arrow pointing up &#8679;).</span></div>
        <div class="step"><span class="step-num">3</span><span class="step-text">Scroll down and tap <strong>&ldquo;Add to Home Screen&rdquo;</strong>.</span></div>
        <div class="step"><span class="step-num">4</span><span class="step-text">Tap <strong>Add</strong> in the top-right corner. The icon will appear on your home screen.</span></div>
      </div>

      <div class="step-block">
        <h3>&#129302; Android (Chrome)</h3>
        <div class="step"><span class="step-num">1</span><span class="step-text">Open the link above in <strong>Chrome</strong>.</span></div>
        <div class="step"><span class="step-num">2</span><span class="step-text">Tap the <strong>three-dot menu</strong> (&#8942;) in the top-right corner.</span></div>
        <div class="step"><span class="step-num">3</span><span class="step-text">Tap <strong>&ldquo;Add to Home screen&rdquo;</strong> or <strong>&ldquo;Install app&rdquo;</strong>.</span></div>
        <div class="step"><span class="step-num">4</span><span class="step-text">Tap <strong>Add</strong> or <strong>Install</strong>. The app will appear on your home screen.</span></div>
      </div>

      <hr class="divider" />
      <p>Once added, the portal opens in full-screen mode with no browser bar &mdash; just like a native app. You&rsquo;ll also be able to receive push notifications for new orders and approvals directly on your device.</p>
      <p>If you have any trouble, please contact us and we&rsquo;ll be happy to help.</p>
      <p>Best regards,<br><strong>${configuredBusinessName(await getBusinessConfig())}</strong></p>
    </div>
  </div>
  <div class="footer">&copy; ${new Date().getFullYear()} ${configuredBusinessName(await getBusinessConfig())}. All rights reserved.</div>
</div>
</body>
</html>`;

  const text = `Hi ${firstName},

You can access the ${customerName ?? "ordering"} portal as a mobile app by saving it to your home screen.

Portal URL: ${portalUrl}

IPHONE / IPAD (Safari):
1. Open the link in Safari.
2. Tap the Share button (square with arrow pointing up).
3. Tap "Add to Home Screen".
4. Tap Add.

ANDROID (Chrome):
1. Open the link in Chrome.
2. Tap the three-dot menu.
3. Tap "Add to Home screen" or "Install app".
4. Tap Add / Install.

Best regards,
${configuredBusinessName(await getBusinessConfig())}`;

  return { subject, html, text };
}

export async function sendMobileInstructionsEmail(opts: {
  toEmail: string;
  toName: string;
  portalUrl: string;
  customerName?: string;
}): Promise<void> {
  if (!isEmailConfigured) throw new Error("SMTP not configured");
  const { subject, html, text } = await buildMobileInstructionsEmail({
    recipientName: opts.toName,
    portalUrl: opts.portalUrl,
    customerName: opts.customerName,
  });
  await sendEmail({ to: opts.toEmail, subject, html, text });
}
