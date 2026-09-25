import { Router, type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { db, settingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { sendEmail } from "../services/email.js";

const router = Router();

const JWT_SECRET: string = process.env.SESSION_SECRET ?? "";
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be configured with at least 32 characters.");
}
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ─── Helpers ─────────────────────────────────────────────────────────────────

function otpKey(email: string) {
  return `shop_otp_${email.toLowerCase().trim()}`;
}

function hashCode(code: string) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]!);
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export interface ShopAuthRequest extends Request {
  shopCustomerId?: number;
  shopEmail?: string;
}

export function shopAuth(
  req: ShopAuthRequest,
  res: Response,
  next: NextFunction
): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as Record<
      string,
      unknown
    >;
    if (payload.role !== "shop_customer") {
      res.status(401).json({ error: "Invalid token type" });
      return;
    }
    req.shopCustomerId = payload.sub as number;
    req.shopEmail = payload.email as string;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ─── POST /shop/auth/request-otp ─────────────────────────────────────────────

router.post(
  "/shop/auth/request-otp",
  async (req: Request, res: Response): Promise<void> => {
    const { email } = req.body ?? {};
    if (!email || typeof email !== "string" || !email.includes("@")) {
      res.status(400).json({ error: "Valid email required" });
      return;
    }
    const normEmail = email.trim().toLowerCase();

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const hash = hashCode(code);
    const expires = new Date(Date.now() + OTP_TTL_MS).toISOString();

    // Store in settings table
    const key = otpKey(normEmail);
    await db
      .insert(settingsTable)
      .values({ key, value: JSON.stringify({ hash, expires }) })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: {
          value: JSON.stringify({ hash, expires }),
          updatedAt: new Date(),
        },
      });

    // Send email
    try {
      await sendEmail({
        to: normEmail,
        subject: "Your shop login code",
        text: `Your one-time login code is: ${code}\n\nThis code expires in 10 minutes. If you didn't request this, you can safely ignore this email.`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
            <h2 style="color:#1e3a5f;margin:0 0 16px;">Your login code</h2>
            <p style="color:#374151;margin:0 0 24px;">
              Use the code below to sign in to your organisation account.
              It expires in <strong>10 minutes</strong>.
            </p>
            <div style="background:#f3f4f6;border-radius:8px;padding:24px;text-align:center;margin:0 0 24px;">
              <span style="font-size:36px;font-weight:700;letter-spacing:0.2em;color:#1e3a5f;">${code}</span>
            </div>
            <p style="color:#6b7280;font-size:13px;margin:0;">
              If you didn't request this code, you can safely ignore this email.
            </p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
          </div>
        `,
      });
    } catch (err) {
      console.error("[shop-auth] Failed to send OTP email:", err);
      res.status(502).json({ error: "Failed to send login email. Please try again." });
      return;
    }

    res.json({ ok: true });
  }
);

// ─── POST /shop/auth/verify-otp ──────────────────────────────────────────────

router.post(
  "/shop/auth/verify-otp",
  async (req: Request, res: Response): Promise<void> => {
    const { email, code } = req.body ?? {};
    if (!email || !code) {
      res.status(400).json({ error: "Email and code required" });
      return;
    }
    const normEmail = (email as string).trim().toLowerCase();
    const key = otpKey(normEmail);

    // Fetch stored OTP
    const [row] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, key));
    if (!row?.value) {
      res.status(400).json({ error: "No code found for this email. Please request a new one." });
      return;
    }

    let stored: { hash: string; expires: string };
    try {
      stored = JSON.parse(row.value);
    } catch {
      res.status(400).json({ error: "Invalid stored code. Please request a new one." });
      return;
    }

    if (new Date(stored.expires) < new Date()) {
      await db.delete(settingsTable).where(eq(settingsTable.key, key));
      res.status(400).json({ error: "Code has expired. Please request a new one." });
      return;
    }

    if (hashCode(String(code).trim()) !== stored.hash) {
      res.status(400).json({ error: "Incorrect code. Please check and try again." });
      return;
    }

    // Consume the OTP
    await db.delete(settingsTable).where(eq(settingsTable.key, key));

    // Find or create shop customer
    const existing = await db.execute(
      sql`SELECT id, email, first_name, last_name, company, phone,
                 address_1, address_2, city, county, postcode, country
          FROM shop_customers WHERE email = ${normEmail} LIMIT 1`
    );

    let customer: Record<string, unknown>;
    if ((existing.rows as any[]).length > 0) {
      customer = existing.rows[0] as Record<string, unknown>;
    } else {
      const inserted = await db.execute(
        sql`INSERT INTO shop_customers (email, created_at, updated_at)
            VALUES (${normEmail}, now(), now())
            RETURNING id, email, first_name, last_name, company, phone,
                      address_1, address_2, city, county, postcode, country`
      );
      customer = inserted.rows[0] as Record<string, unknown>;
    }

    const token = jwt.sign(
      { role: "shop_customer", sub: (customer as any).id, email: normEmail },
      JWT_SECRET,
      { expiresIn: "90d" }
    );

    res.json({ token, customer });
  }
);

// ─── GET /shop/auth/me ────────────────────────────────────────────────────────

router.get(
  "/shop/auth/me",
  shopAuth,
  async (req: ShopAuthRequest, res: Response): Promise<void> => {
    const result = await db.execute(
      sql`SELECT id, email, first_name, last_name, company, phone,
                 address_1, address_2, city, county, postcode, country,
                 created_at
          FROM shop_customers WHERE id = ${req.shopCustomerId} LIMIT 1`
    );
    if (!(result.rows as any[]).length) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    res.json({ customer: result.rows[0] });
  }
);

// ─── GET /shop/customer/logo ─────────────────────────────────────────────────
// Shop accounts are separate from the internal customer table. Resolve the
// saved logo through the authenticated account's email/company only; never
// accept a customer id from the browser for this lookup.
router.get(
  "/shop/customer/logo",
  shopAuth,
  async (req: ShopAuthRequest, res: Response): Promise<void> => {
    const result = await db.execute(
      sql`
        SELECT matched.logo_url
        FROM shop_customers sc
        LEFT JOIN LATERAL (
          SELECT c.logo_url
          FROM customers c
          WHERE (
            sc.email IS NOT NULL
            AND c.email IS NOT NULL
            AND LOWER(BTRIM(c.email)) = LOWER(BTRIM(sc.email))
          ) OR (
            NULLIF(BTRIM(sc.company), '') IS NOT NULL
            AND LOWER(REGEXP_REPLACE(BTRIM(c.name), '[[:space:]]+', ' ', 'g')) =
                LOWER(REGEXP_REPLACE(BTRIM(sc.company), '[[:space:]]+', ' ', 'g'))
          )
          ORDER BY CASE
            WHEN sc.email IS NOT NULL
              AND c.email IS NOT NULL
              AND LOWER(BTRIM(c.email)) = LOWER(BTRIM(sc.email)) THEN 0
            ELSE 1
          END, c.id
          LIMIT 1
        ) matched ON TRUE
        WHERE sc.id = ${req.shopCustomerId}
        LIMIT 1
      `,
    );
    const logoUrl = (result.rows[0] as any)?.logo_url ?? null;
    res.json({
      logo: logoUrl ? { name: "Logo on file", url: logoUrl } : null,
    });
  }
);

// ─── PATCH /shop/customer/profile ────────────────────────────────────────────

router.patch(
  "/shop/customer/profile",
  shopAuth,
  async (req: ShopAuthRequest, res: Response): Promise<void> => {
    const {
      firstName, lastName, company, phone,
      address1, address2, city, county, postcode,
    } = req.body ?? {};

    await db.execute(sql`
      UPDATE shop_customers SET
        first_name = COALESCE(${firstName ?? null}, first_name),
        last_name  = COALESCE(${lastName  ?? null}, last_name),
        company    = COALESCE(${company   ?? null}, company),
        phone      = COALESCE(${phone     ?? null}, phone),
        address_1  = COALESCE(${address1  ?? null}, address_1),
        address_2  = COALESCE(${address2  ?? null}, address_2),
        city       = COALESCE(${city      ?? null}, city),
        county     = COALESCE(${county    ?? null}, county),
        postcode   = COALESCE(${postcode  ?? null}, postcode),
        updated_at = now()
      WHERE id = ${req.shopCustomerId}
    `);

    const result = await db.execute(
      sql`SELECT id, email, first_name, last_name, company, phone,
                 address_1, address_2, city, county, postcode, country
          FROM shop_customers WHERE id = ${req.shopCustomerId} LIMIT 1`
    );
    res.json({ customer: result.rows[0] });
  }
);

// ─── POST /shop/auth/send-activation-emails ──────────────────────────────────
// One-shot (24-hour rate-limited) bulk invite: emails every shop_customer
// directing them to log in via OTP. Returns { sent, failed, errors, sentAt }.

const ACTIVATION_SENT_AT_KEY = "shop_activation_emails_sent_at";
const ACTIVATION_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

router.post(
  "/shop/auth/send-activation-emails",
  async (req: Request, res: Response): Promise<void> => {
    // ── Rate-limit check ────────────────────────────────────────────────────
    const [sentAtRow] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, ACTIVATION_SENT_AT_KEY));

    const lastSentAt: string | null = sentAtRow?.value ?? null;
    if (lastSentAt) {
      const elapsed = Date.now() - new Date(lastSentAt).getTime();
      if (elapsed < ACTIVATION_COOLDOWN_MS && req.body?.force !== true) {
        res.status(429).json({
          error: "Activation emails were already sent recently. Wait 24 hours or pass force:true.",
          sentAt: lastSentAt,
        });
        return;
      }
    }

    // ── Fetch all shop customers with an email ───────────────────────────────
    const customersResult = await db.execute(
      sql`SELECT id, email, first_name FROM shop_customers WHERE email IS NOT NULL AND email <> '' ORDER BY id`
    );
    const customers = customersResult.rows as { id: number; email: string; first_name: string | null }[];

    if (customers.length === 0) {
      res.json({ sent: 0, failed: 0, errors: [], sentAt: null, message: "No shop customers found." });
      return;
    }

    // ── Build the shop login URL ─────────────────────────────────────────────
    // Use the host from the request so it works in both dev and production.
    const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
    const host = req.headers["x-forwarded-host"] || req.get("host") || "";
    let shopLoginUrl: string;
    try {
      const publicOrigin = new URL(`${proto}://${host}`);
      const publicHost = publicOrigin.hostname.toLowerCase();
      if (publicOrigin.protocol !== "https:" || publicOrigin.username || publicOrigin.password
        || publicOrigin.pathname !== "/" || !publicHost.includes(".")
        || publicHost === "localhost" || publicHost.endsWith(".localhost") || publicHost.endsWith(".local")
        || /^127\./.test(publicHost) || /^10\./.test(publicHost) || /^192\.168\./.test(publicHost)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(publicHost)) {
        throw new Error("untrusted public host");
      }
      shopLoginUrl = new URL("/login", publicOrigin.origin).toString();
    } catch {
      res.status(503).json({ error: "Shop sign-in URL is unavailable; configure the public shop host first." });
      return;
    }
    // The shop is mounted at the root path "/"

    // ── Send emails ──────────────────────────────────────────────────────────
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const customer of customers) {
      const firstName = customer.first_name?.trim() || "there";
      try {
        await sendEmail({
          to: customer.email,
          subject: "Activate your organisation account",
          text: [
            `Hi ${firstName},`,
            "",
            "Good news — your organisation account is now active on the shop.",
            "",
            "You can sign in at any time using the link below. No password needed — just enter your email and we'll send you a one-time login code.",
            "",
            `Sign in here: ${shopLoginUrl}`,
            "",
            "If you have any questions, reply to this email and we'll be happy to help.",
            "",
          ].join("\n"),
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="color:#1e3a5f;margin:0 0 16px;">Your account is ready</h2>
              <p style="color:#374151;margin:0 0 12px;">Hi ${escapeHtml(firstName)},</p>
              <p style="color:#374151;margin:0 0 12px;">
                Good news — your organisation account is now active on the shop.
              </p>
              <p style="color:#374151;margin:0 0 24px;">
                No password needed. Just enter your email address and we'll send you a one-time code to sign in.
              </p>
              <a href="${escapeHtml(shopLoginUrl)}"
                 style="display:inline-block;background:#1e3a5f;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">
                Sign in to your account
              </a>
              <p style="color:#6b7280;font-size:13px;margin:24px 0 0;">
                Or copy this link: <a href="${escapeHtml(shopLoginUrl)}" style="color:#1e3a5f;">${escapeHtml(shopLoginUrl)}</a>
              </p>
            </div>
          `,
        });
        sent++;
      } catch (err: any) {
        failed++;
        errors.push(`${customer.email}: ${err?.message ?? "Unknown error"}`);
        console.error(`[shop-auth] Failed to send activation email to ${customer.email}:`, err);
      }
    }

    // ── Record the send timestamp ────────────────────────────────────────────
    const sentAt = new Date().toISOString();
    await db
      .insert(settingsTable)
      .values({ key: ACTIVATION_SENT_AT_KEY, value: sentAt })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value: sentAt, updatedAt: new Date() },
      });

    res.json({ sent, failed, errors: errors.slice(0, 20), sentAt, total: customers.length });
  }
);

// ─── GET /shop/auth/activation-email-status ───────────────────────────────────

router.get(
  "/shop/auth/activation-email-status",
  async (_req: Request, res: Response): Promise<void> => {
    const [row] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, ACTIVATION_SENT_AT_KEY));

    const countResult = await db.execute(
      sql`SELECT COUNT(*) AS count FROM shop_customers WHERE email IS NOT NULL AND email <> ''`
    );
    const customerCount = Number((countResult.rows[0] as any)?.count ?? 0);

    res.json({
      sentAt: row?.value ?? null,
      customerCount,
      cooldownMs: ACTIVATION_COOLDOWN_MS,
    });
  }
);

// ─── GET /shop/customer/orders ────────────────────────────────────────────────

router.get(
  "/shop/customer/orders",
  shopAuth,
  async (req: ShopAuthRequest, res: Response): Promise<void> => {
    const orders = await db.execute(sql`
      SELECT o.id, o.order_number, o.status, o.total_amount, o.carriage_amount,
             o.order_date, o.notes
      FROM orders o
      WHERE o.shop_customer_id = ${req.shopCustomerId}
      ORDER BY o.order_date DESC
      LIMIT 50
    `);

    // Fetch items for each order
    const orderIds = (orders.rows as any[]).map((o) => o.id);
    let items: any[] = [];
    if (orderIds.length) {
      const itemsResult = await db.execute(sql`
        SELECT order_id, product_name, quantity, unit_price, line_total, colour, size
        FROM order_items
        WHERE order_id = ANY(${orderIds as any})
        ORDER BY id
      `);
      items = itemsResult.rows as any[];
    }

    const itemsByOrder = items.reduce<Record<number, any[]>>((acc, item) => {
      if (!acc[item.order_id]) acc[item.order_id] = [];
      acc[item.order_id].push(item);
      return acc;
    }, {});

    res.json({
      orders: (orders.rows as any[]).map((o) => ({
        ...o,
        items: itemsByOrder[o.id] ?? [],
      })),
    });
  }
);

export default router;
