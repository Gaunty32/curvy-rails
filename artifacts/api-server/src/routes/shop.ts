import { Router, type IRouter } from "express";
import multer from "multer";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { calculateShopTotals, parsePriceBreaks, quantityTierPrice, sameLegacyShopBasket, shopBasketFingerprint, type PricedShopItem } from "../lib/shop-checkout-pricing.js";
import { db, settingsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { SOPHIE_CHAT_PROMPT } from "../lib/sophie-chat-prompt.js";
import { sendEmail } from "../services/email.js";
import { fireWorkflow } from "../services/workflow-engine.js";
import { getUncachableStripeClient, getStripePublishableKey } from "../services/stripeClient.js";
import { isStoredProductImageValid } from "../services/product-image-storage.js";
import { toDisplayCase } from "../lib/display-case.js";
import { getBusinessConfig, resolveShopShippingConfiguration } from "../lib/business-config.js";
import { normalizeShopPostcode, validateShopShippingEligibility, verifyShopShippingTerms } from "../lib/shop-shipping-eligibility.js";
import { createHash } from "node:crypto";

const router: IRouter = Router();

// ── Internal-DB helpers (replaces WC external proxy) ─────────────────────────

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function legacyCategoryIdsByName(
  categories: Array<{ wooId: number; name: string; slug: string; parent?: number | null }>,
): Map<string, number> {
  const categoryGroups = new Map<
    string,
    Array<{ wooId: number; name: string; slug: string; parent?: number | null }>
  >();
  for (const category of categories) {
    const key = category.name.trim().toLowerCase();
    const group = categoryGroups.get(key) ?? [];
    group.push(category);
    categoryGroups.set(key, group);
  }

  const resolved = new Map<string, number>();
  for (const [name, group] of categoryGroups) {
    if (group.length === 1) {
      resolved.set(name, group[0].wooId);
      continue;
    }

    // The legacy import stored only a category name. Where WooCommerce has both
    // a top-level category and a same-named child (currently Gilets and Winter
    // Jackets under Hi-Vis), use the sole top-level match for records that still
    // lack category IDs. Products with retained IDs never use this fallback, so
    // their precise child-category membership remains authoritative.
    const topLevelMatches = group.filter((category) => Number(category.parent ?? 0) === 0);
    if (topLevelMatches.length === 1) {
      resolved.set(name, topLevelMatches[0].wooId);
    }
  }
  return resolved;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getSetting(key: string): Promise<string | null> {
  const rows = await db.select().from(settingsTable);
  const map: Record<string, string | null> = {};
  for (const r of rows) map[r.key] = r.value;
  return map[key] ?? null;
}

// Egress map: /shop/wp-page and /shop/image-proxy use wordpress (WORDPRESS_BASE_URL);
// /shop/blog-posts[/:slug] uses rss (KNOWLEDGE_RSS_URL/rss_knowledge_centre_url);
// /shop/live-chat uses openai (AI_INTEGRATIONS_OPENAI_*); postcode geocoding uses
// postcodes_io; /shop/enquiry uses highlevel (stored high_level_* credentials).
async function assertOutboundIntegrationEnabled(provider: string): Promise<void> {
  const result = await db.execute(sql`
    SELECT key, value FROM settings
    WHERE key IN ('installation_activated', 'integration_enabled')
  `);
  const values = new Map<string, string>(
    ((result.rows ?? result) as Array<{ key: string; value: string | null }>)
      .map((row) => [row.key, row.value ?? ""]),
  );
  if (values.get("installation_activated") !== "true") {
    throw new Error(`Outbound ${provider} request blocked until installation activation.`);
  }
  let capabilities: unknown;
  try {
    capabilities = JSON.parse(values.get("integration_enabled") ?? "null");
  } catch {
    throw new Error("Outbound integration capability state is invalid; requests are blocked.");
  }
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)
    || (capabilities as Record<string, unknown>)[provider] !== true) {
    throw new Error(`Outbound ${provider} integration is not explicitly enabled.`);
  }
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

async function getAllSettings(): Promise<Record<string, string | null>> {
  const rows = await db.select().from(settingsTable);
  const map: Record<string, string | null> = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
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

function parseJsonArray(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String);
  try { const parsed = JSON.parse(String(val)); return Array.isArray(parsed) ? parsed.map(String) : []; }
  catch { return []; }
}

function enquiryNotificationEmail(settings: Record<string, string | null>): string | null {
  return settings["enquiry_notification_email"]
    ?? settings["enquiry_email"]
    ?? settings["contact_email"]
    ?? settings["email"]
    ?? null;
}

function fmtShopProduct(p: any): object {
  const imageUrl = p.image_url ?? null;
  return {
    id: p.id,
    name: p.name,
    sku: p.sku ?? null,
    description: p.description ?? null,
    unitPrice: p.unit_price != null ? parseFloat(String(p.unit_price)) : 0,
    category: p.category ?? null,
    imageUrl,
    imageUrls: imageUrl ? [imageUrl] : [],
    colours: Array.isArray(p.colours) ? p.colours.filter(Boolean) : parseJsonArray(p.colours),
    guidanceBestFor: p.guidance_best_for ?? null,
    guidanceTags: parseJsonArray(p.guidance_tags),
    guidanceBadges: parseJsonArray(p.guidance_badges),
    permalink: p.permalink ?? null,
  };
}

// ── GET /shop/settings ────────────────────────────────────────────────────────

router.get("/shop/settings", async (_req, res): Promise<void> => {
  const s = await getAllSettings();
  res.json({
    businessName: s["business_name"] ?? null,
    tagline: s["shop_tagline"] ?? s["business_tagline"] ?? null,
    logoUrl: s["logo_url"] ?? s["shop_logo_url"] ?? null,
    contactEmail: s["contact_email"] ?? s["email"] ?? null,
    contactPhone: s["contact_phone"] ?? s["phone"] ?? null,
    address: s["address"] ?? s["contact_address"] ?? null,
    heroText: s["shop_hero_text"] ?? null,
    heroSubtext: s["shop_hero_subtext"] ?? null,
    portalUrl: s["portal_url"] ?? s["shop_portal_url"] ?? "/customer-portal/",
  });
});

// ── GET /shop/categories ──────────────────────────────────────────────────────

router.get("/shop/categories", async (_req, res): Promise<void> => {
  const rows = await db.execute(sql`
    SELECT
      TRIM(category) AS name,
      COUNT(*) AS count
    FROM products
    WHERE
      COALESCE(is_archived, false) = false
      AND COALESCE(is_service, false) = false
      AND COALESCE(is_bespoke, false) = false
      AND website_published = true
      AND (woo_commerce_id IS NULL OR woo_status IS NULL OR LOWER(woo_status) = 'publish')
      AND image_url IS NOT NULL
      AND image_url <> ''
      AND category IS NOT NULL
      AND TRIM(category) <> ''
    GROUP BY TRIM(category)
    ORDER BY count DESC, name
  `);
  res.json(
    (rows.rows as any[]).map((r) => ({
      name: r.name as string,
      count: Number(r.count),
    }))
  );
});

// ── GET /shop/products ────────────────────────────────────────────────────────

router.get("/shop/products", async (req, res): Promise<void> => {
  const searchRaw = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const categoryRaw = typeof req.query.category === "string" ? req.query.category.trim() : "";
  const featuredOnly = req.query.featured === "true";

  const searchWords = searchRaw.split(/\s+/).filter(Boolean);

  const wordClauses = searchWords.map((w) => {
    const term = `%${w}%`;
    return sql`AND (p.name ILIKE ${term} OR p.description ILIKE ${term} OR p.sku ILIKE ${term} OR p.category ILIKE ${term})`;
  });

  const categoryClause = categoryRaw
    ? sql`AND TRIM(p.category) = ${categoryRaw}`
    : sql``;

  // featured = has an image_url and is published. If featuredOnly, also limit to products
  // that have the most recently updated images.
  const featuredClause = featuredOnly
    ? sql`AND p.image_url IS NOT NULL AND p.image_url <> ''`
    : sql``;

  const rows = await db.execute(sql`
    SELECT
      p.id, p.name, p.sku, p.description, p.unit_price,
      p.category, p.image_url, p.permalink,
      p.guidance_best_for, p.guidance_tags, p.guidance_badges,
      p.updated_at,
      (SELECT ARRAY_AGG(DISTINCT pa.value ORDER BY pa.value)
       FROM product_attributes pa
       WHERE pa.product_id = p.id AND pa.type = 'colour') AS colours
    FROM products p
    WHERE
      COALESCE(p.is_archived, false) = false
      AND COALESCE(p.is_service, false) = false
      AND COALESCE(p.is_bespoke, false) = false
      AND p.website_published = true
      AND (p.woo_commerce_id IS NULL OR p.woo_status IS NULL OR LOWER(p.woo_status) = 'publish')
      AND p.image_url IS NOT NULL
      AND p.image_url <> ''
      ${categoryClause}
      ${featuredClause}
      ${sql.join(wordClauses, sql` `)}
    ORDER BY
      CASE WHEN p.image_url IS NOT NULL AND p.image_url <> '' THEN 0 ELSE 1 END,
      p.name
    LIMIT 200
  `);

  res.json((rows.rows as any[]).map(fmtShopProduct));
});

// ── GET /shop/products/:id ────────────────────────────────────────────────────

router.get("/shop/products/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid product id" });
    return;
  }

  const rows = await db.execute(sql`
    SELECT
      p.id, p.name, p.sku, p.description, p.unit_price,
      p.category, p.image_url, p.permalink,
      p.guidance_best_for, p.guidance_not_ideal_for,
      p.guidance_tags, p.guidance_badges
    FROM products p
    WHERE p.id = ${id}
      AND COALESCE(p.is_archived, false) = false
      AND COALESCE(p.is_service, false) = false
      AND COALESCE(p.is_bespoke, false) = false
      AND p.website_published = true
      AND (p.woo_commerce_id IS NULL OR p.woo_status IS NULL OR LOWER(p.woo_status) = 'publish')
      AND p.image_url IS NOT NULL
      AND p.image_url <> ''
    LIMIT 1
  `);

  const product = (rows.rows as any[])[0];
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  // Colours with images
  const colourRows = await db.execute(sql`
    SELECT DISTINCT ON (pa.value)
      pa.value AS colour,
      pv.image_url
    FROM product_attributes pa
    LEFT JOIN product_variants pv
      ON pv.product_id = pa.product_id
      AND pv.colour = pa.value
      AND pv.image_url IS NOT NULL
    WHERE pa.product_id = ${id} AND pa.type = 'colour'
    ORDER BY pa.value, pv.image_url NULLS LAST
  `);

  // Sizes
  const sizeRows = await db.execute(sql`
    SELECT DISTINCT pa.value AS size, COALESCE(pa.sort_order, 999) AS sort_order
    FROM product_attributes pa
    WHERE pa.product_id = ${id} AND pa.type = 'size'
    ORDER BY sort_order, size
  `);

  // Variants with price
  const variantRows = await db.execute(sql`
    SELECT colour, size, price
    FROM product_variants
    WHERE product_id = ${id}
    ORDER BY colour, size
  `);

  // Related products (same category, different id, limit 4)
  const relatedRows = await db.execute(sql`
    SELECT
      p.id, p.name, p.sku, p.description, p.unit_price,
      p.category, p.image_url, p.permalink,
      p.guidance_best_for, p.guidance_tags, p.guidance_badges,
      (SELECT ARRAY_AGG(DISTINCT pa.value ORDER BY pa.value)
       FROM product_attributes pa
       WHERE pa.product_id = p.id AND pa.type = 'colour') AS colours
    FROM products p
    WHERE
      p.id <> ${id}
      AND TRIM(p.category) = ${String(product.category ?? "").trim()}
      AND COALESCE(p.is_archived, false) = false
      AND COALESCE(p.is_service, false) = false
      AND COALESCE(p.is_bespoke, false) = false
      AND p.website_published = true
      AND (p.woo_commerce_id IS NULL OR p.woo_status IS NULL OR LOWER(p.woo_status) = 'publish')
      AND p.image_url IS NOT NULL
      AND p.image_url <> ''
    ORDER BY
      CASE WHEN p.image_url IS NOT NULL AND p.image_url <> '' THEN 0 ELSE 1 END,
      p.name
    LIMIT 4
  `);

  res.json({
    ...fmtShopProduct(product),
    guidanceNotIdealFor: product.guidance_not_ideal_for ?? null,
    colours: (colourRows.rows as any[]).map((r) => ({
      colour: r.colour as string,
      imageUrl: r.image_url ?? null,
    })),
    sizes: (sizeRows.rows as any[]).map((r) => r.size as string),
    variants: (variantRows.rows as any[]).map((r) => ({
      colour: r.colour ?? null,
      size: r.size ?? null,
      price: r.price != null ? parseFloat(String(r.price)) : null,
    })),
    relatedProducts: (relatedRows.rows as any[]).map(fmtShopProduct),
  });
});

// ── POST /shop/enquiry ────────────────────────────────────────────────────────

const EnquiryInputSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  company: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  message: z.string().min(1),
  productsOfInterest: z.array(z.string()).optional().default([]),
});

router.post("/shop/enquiry", async (req, res): Promise<void> => {
  const parsed = EnquiryInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, email, company, phone, message, productsOfInterest } = parsed.data;
  const refNum = `ENQ-${Date.now().toString(36).toUpperCase()}`;

  // Try to store enquiry in the enquiries table if it exists
  try {
    await db.execute(sql`
      INSERT INTO enquiries (name, email, company, phone, message, products_of_interest, reference_number, source, created_at)
      VALUES (
        ${name}, ${email}, ${company ?? null}, ${phone ?? null},
        ${message},
        ${JSON.stringify(productsOfInterest)}::jsonb,
        ${refNum}, 'shop', NOW()
      )
    `);
  } catch (e) {
    // Table may not exist yet — log and continue; email is the fallback
    logger.warn({ err: e }, "[shop/enquiry] Could not insert into enquiries table");
  }

  // Send notification email to the business
  const settings = await getAllSettings();
  const notifyEmail = enquiryNotificationEmail(settings);

  try {
    const productsList = productsOfInterest.length > 0
      ? `\n\nProducts of interest:\n${productsOfInterest.map((p) => `  • ${p}`).join("\n")}`
      : "";

    const notification = await sendEmail({
      to: notifyEmail ?? [],
      subject: `New Shop Enquiry from ${name}${company ? ` (${company})` : ""} — ${refNum}`,
      text: [
        `Reference: ${refNum}`,
        `Name: ${name}`,
        `Email: ${email}`,
        company ? `Company: ${company}` : null,
        phone ? `Phone: ${phone}` : null,
        `\nMessage:\n${message}`,
        productsList,
      ].filter(Boolean).join("\n"),
      html: `
        <p><strong>Reference:</strong> ${refNum}</p>
        <p><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Email:</strong> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></p>
        ${company ? `<p><strong>Company:</strong> ${escapeHtml(company)}</p>` : ""}
        ${phone ? `<p><strong>Phone:</strong> ${escapeHtml(phone)}</p>` : ""}
        <p><strong>Message:</strong></p>
        <p style="white-space:pre-wrap">${escapeHtml(message)}</p>
        ${productsOfInterest.length > 0 ? `<p><strong>Products of interest:</strong></p><ul>${productsOfInterest.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>` : ""}
      `,
    });
    if (!notification.sent) {
      logger.warn({ error: notification.error, refNum }, "[shop/enquiry] Staff notification was not accepted");
    }
  } catch (e) {
    logger.warn({ err: e }, "[shop/enquiry] Failed to send notification email");
  }

  // Send confirmation email to enquirer
  try {
    await sendEmail({
      to: email,
      subject: `Thanks for your enquiry — ${refNum}`,
      text: `Hi ${name},\n\nThank you for your enquiry. We'll be in touch shortly.\n\nYour reference number is ${refNum}.`,
      html: `
        <p>Hi ${escapeHtml(name)},</p>
        <p>Thank you for your enquiry. We'll be in touch shortly.</p>
        <p>Your reference number is <strong>${escapeHtml(refNum)}</strong>.</p>
      `,
    });
  } catch (e) {
    logger.warn({ err: e }, "[shop/enquiry] Failed to send confirmation email to enquirer");
  }

  res.json({ success: true, referenceNumber: refNum });
});

// ── GET /shop/images ──────────────────────────────────────────────────────────
// Returns all product images from the local DB, ready for use on any page.
// Response shape:
//   byCategory: Record<category, { url, productName, productId, permalink }[]>
//   featured:   { url, productName, productId, category, permalink }[]
//   all:        { url, productName, productId, category, type, permalink }[]

router.get("/shop/images", async (_req, res): Promise<void> => {
  const rows = await db.execute(sql`
    SELECT
      id,
      name,
      category,
      image_url,
      gallery_images,
      permalink
    FROM products
    WHERE COALESCE(is_archived, false) = false
      AND COALESCE(is_service, false) = false
      AND COALESCE(is_bespoke, false) = false
      AND website_published = true
      AND (woo_commerce_id IS NULL OR woo_status IS NULL OR LOWER(woo_status) = 'publish')
      AND image_url IS NOT NULL
      AND image_url <> ''
    ORDER BY
      CASE WHEN gallery_images IS NOT NULL AND jsonb_array_length(gallery_images) > 1 THEN 0 ELSE 1 END,
      updated_at DESC NULLS LAST
    LIMIT 500
  `);

  type ImageEntry = {
    url: string;
    productName: string;
    productId: number;
    category: string | null;
    permalink: string | null;
    type: "primary" | "gallery";
  };

  const all: ImageEntry[] = [];
  const byCategory: Record<string, Omit<ImageEntry, "type">[]> = {};

  for (const row of rows.rows as any[]) {
    const cat: string = row.category ?? "Uncategorised";
    if (!byCategory[cat]) byCategory[cat] = [];

    const base = {
      productId:   row.id as number,
      productName: row.name as string,
      category:    row.category as string | null,
      permalink:   row.permalink as string | null,
    };

    // Primary image
    if (row.image_url) {
      all.push({ ...base, url: row.image_url, type: "primary" });
      byCategory[cat].push({ ...base, url: row.image_url });
    }

    // Gallery images (skip if duplicate of primary)
    const gallery: string[] = row.gallery_images
      ? (Array.isArray(row.gallery_images) ? row.gallery_images : JSON.parse(row.gallery_images)).filter(Boolean)
      : [];
    for (const url of gallery) {
      if (url !== row.image_url) {
        all.push({ ...base, url, type: "gallery" });
        byCategory[cat].push({ ...base, url });
      }
    }
  }

  // Featured: products with the most images (rich gallery content first)
  const featured = all.filter((i) => i.type === "primary").slice(0, 50);

  res.json({ byCategory, featured, all });
});

// ── GET /shop/home-images ─────────────────────────────────────────────────────
// The homepage only needs two hero images and one fallback candidate for each
// of its four category tiles. Keep this separate from /shop/images, which is a
// full image catalogue used by internal tooling and can be several hundred KB.
router.get("/shop/home-images", async (_req, res): Promise<void> => {
  const visibilityWhere = sql`
    COALESCE(is_archived, false) = false
    AND COALESCE(is_service, false) = false
    AND COALESCE(is_bespoke, false) = false
    AND website_published = true
    AND (woo_commerce_id IS NULL OR woo_status IS NULL OR LOWER(woo_status) = 'publish')
    AND image_url IS NOT NULL
    AND image_url <> ''
  `;

  const [featuredRows, categoryRows] = await Promise.all([
    db.execute(sql`
      SELECT id, name, category, image_url, permalink
      FROM products
      WHERE ${visibilityWhere}
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 2
    `),
    db.execute(sql`
      SELECT DISTINCT ON (LOWER(TRIM(category)))
        id, name, category, image_url, permalink
      FROM products
      WHERE ${visibilityWhere}
        AND (
          LOWER(category) LIKE '%polo%'
          OR LOWER(category) LIKE '%sweatshirt%'
          OR LOWER(category) LIKE '%jacket%'
          OR LOWER(category) LIKE '%trouser%'
        )
      ORDER BY LOWER(TRIM(category)), updated_at DESC NULLS LAST
    `),
  ]);

  const toImage = (row: any) => ({
    url: row.image_url as string,
    productName: row.name as string,
    productId: row.id as number,
    category: row.category as string | null,
    permalink: row.permalink as string | null,
    type: "primary" as const,
  });

  const byCategory: Record<string, ReturnType<typeof toImage>[]> = {};
  for (const row of categoryRows.rows as any[]) {
    const category = row.category ?? "Uncategorised";
    byCategory[category] = [toImage(row)];
  }

  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
  res.json({
    featured: (featuredRows.rows as any[]).map(toImage),
    byCategory,
  });
});

// ── POST /shop/product-enquiry ────────────────────────────────────────────────
// Customer-facing product enquiry & chat — saves to wc_enquiries + emails staff

const ProductEnquirySchema = z.object({
  productId:   z.number().optional().nullable(),
  productName: z.string().optional().nullable(),
  productUrl:  z.string().optional().nullable(),
  name:        z.string().min(1),
  email:       z.string().email(),
  phone:       z.string().optional().nullable(),
  message:     z.string().min(1),
  source:      z.enum(["product_page", "chat"]).default("product_page"),
});

router.post("/shop/product-enquiry", async (req, res): Promise<void> => {
  const parsed = ProductEnquirySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;

  const refNum = `ENQ-${Date.now().toString(36).toUpperCase()}`;

  // Link to existing customer if email matches
  let customerId: number | null = null;
  try {
    const cr = await db.execute(sql`SELECT id FROM customers WHERE LOWER(email) = LOWER(${d.email}) LIMIT 1`);
    customerId = (cr.rows[0] as any)?.id ?? null;
  } catch {}

  // Save to wc_enquiries (visible in order-system Enquiries page). Do not show
  // the customer a success confirmation unless the message is safely stored.
  let enquiryStored = false;
  try {
    await db.execute(sql`
      INSERT INTO wc_enquiries (product_id, product_name, customer_name, email, phone, message, customer_id, source)
      VALUES (
        ${d.productId ?? null},
        ${d.productName ?? null},
        ${d.name},
        ${d.email},
        ${d.phone ?? null},
        ${d.message},
        ${customerId},
        ${d.source}
      )
    `);
    enquiryStored = true;
  } catch (e) {
    // source column may not exist yet — retry without it
    try {
      await db.execute(sql`
        INSERT INTO wc_enquiries (product_id, product_name, customer_name, email, phone, message, customer_id)
        VALUES (${d.productId ?? null}, ${d.productName ?? null}, ${d.name}, ${d.email}, ${d.phone ?? null}, ${d.message}, ${customerId})
      `);
      enquiryStored = true;
    } catch (e2) {
      logger.warn({ err: e2 }, "[shop/product-enquiry] Could not insert into wc_enquiries");
    }
  }
  if (!enquiryStored) {
    res.status(500).json({ error: "Your message could not be saved. Please try again or contact us on WhatsApp." });
    return;
  }

  const settings = await getAllSettings();
  const tag = d.source === "chat" ? "Chat Message" : "Product Enquiry";
  const notifyEmail = d.source === "chat"
    ? null
    : enquiryNotificationEmail(settings);

  // Notify staff
  try {
    const notification = await sendEmail({
      to: notifyEmail ?? [],
      subject: `New ${tag} from ${d.name}${d.productName ? ` — ${d.productName}` : ""} — ${refNum}`,
      text: [
        `Reference: ${refNum}`,
        `Source: ${tag}`,
        d.productName ? `Product: ${d.productName}` : null,
        d.productUrl  ? `URL: ${d.productUrl}` : null,
        `Name: ${d.name}`,
        `Email: ${d.email}`,
        d.phone ? `Phone: ${d.phone}` : null,
        `\nMessage:\n${d.message}`,
      ].filter(Boolean).join("\n"),
      html: `
        <p><strong>Reference:</strong> ${refNum}</p>
        <p><strong>Source:</strong> ${tag}</p>
        ${d.productName ? `<p><strong>Product:</strong> ${d.productUrl ? `<a href="${escapeHtml(d.productUrl)}">${escapeHtml(d.productName)}</a>` : escapeHtml(d.productName)}</p>` : ""}
        <p><strong>Name:</strong> ${escapeHtml(d.name)}</p>
        <p><strong>Email:</strong> <a href="mailto:${escapeHtml(d.email)}">${escapeHtml(d.email)}</a></p>
        ${d.phone ? `<p><strong>Phone:</strong> ${escapeHtml(d.phone)}</p>` : ""}
        <p><strong>Message:</strong></p><p style="white-space:pre-wrap">${escapeHtml(d.message)}</p>
      `,
    });
    if (!notification.sent) {
      logger.warn({ error: notification.error, refNum }, "[shop/product-enquiry] Staff notification was not accepted");
    }
  } catch (e) { logger.warn({ err: e }, "[shop/product-enquiry] Failed to send notification email"); }

  // Confirm to customer
  try {
    await sendEmail({
      to: d.email,
      subject: `Thanks for getting in touch — ${refNum}`,
      text: `Hi ${d.name},\n\nThanks for your message — we'll get back to you shortly.\n\nYour reference number is ${refNum}.`,
      html: `<p>Hi ${escapeHtml(d.name)},</p><p>Thanks for your message — we'll get back to you shortly.</p><p>Your reference number is <strong>${escapeHtml(refNum)}</strong>.</p>`,
    });
  } catch (e) { logger.warn({ err: e }, "[shop/product-enquiry] Failed to send confirmation email"); }

  // Fire workflow automation (non-blocking)
  fireWorkflow("enquiry_received", {
    contact_name: d.name,
    contact_email: d.email,
    contact_phone: d.phone ?? null,
    product_name: d.productName ?? null,
    message: d.message,
  }).catch(() => {});

  res.json({ success: true, referenceNumber: refNum });
});

// ── Shop: categories from internal DB ────────────────────────────────────────

router.get("/shop/wc/categories", async (_req, res): Promise<void> => {
  try {
    // Use the product_categories table for the curated category hierarchy and
    // artwork, but calculate the public count from the same local catalogue
    // visibility rules used by the product-list endpoint.
    const rows = await db.execute(sql`
      SELECT
        woo_id   AS id,
        name,
        slug,
        COALESCE(parent_woo_id, 0) AS parent,
        product_count AS count,
        image_url AS image
      FROM product_categories
      ORDER BY display_order ASC, name ASC
    `);

    const publicProductRows = await db.execute(sql`
      SELECT id, category, product_category_ids
      FROM products
      WHERE
        is_archived = false
        AND is_service = false
        AND COALESCE(is_bespoke, false) = false
        AND website_published = true
        AND (woo_commerce_id IS NULL OR woo_status IS NULL OR LOWER(woo_status) = 'publish')
        AND image_url IS NOT NULL
        AND image_url <> ''
    `);
    const categoryRows = rows.rows as any[];
    const legacyCategoryIds = legacyCategoryIdsByName(categoryRows.map((category) => ({
      wooId: Number(category.id),
      name: String(category.name),
      slug: String(category.slug),
      parent: Number(category.parent),
    })));
    const publicProductCategoryIds = (publicProductRows.rows as Array<{
      category: string | null;
      product_category_ids: unknown;
    }>).map((product) => {
      const assignedIds = Array.isArray(product.product_category_ids)
        ? product.product_category_ids
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id) && id > 0)
        : [];

      // Records imported before WooCommerce category IDs were retained use their
      // legacy text name. Duplicate names resolve only when exactly one match is
      // top-level; products with retained IDs always keep their precise branch.
      if (!assignedIds.length && product.category) {
        const legacyId = legacyCategoryIds.get(product.category.trim().toLowerCase());
        if (legacyId) assignedIds.push(legacyId);
      }
      return assignedIds;
    });

    const publicCountForCategory = (category: any): number => {
      const includedWooIds = new Set<number>([Number(category.id)]);
      let foundChild = true;
      while (foundChild) {
        foundChild = false;
        for (const candidate of categoryRows) {
          if (
            Number(candidate.parent) !== 0
            && includedWooIds.has(Number(candidate.parent))
            && !includedWooIds.has(Number(candidate.id))
          ) {
            includedWooIds.add(Number(candidate.id));
            foundChild = true;
          }
        }
      }

      return publicProductCategoryIds.filter((assignedIds) =>
        assignedIds.some((id) => includedWooIds.has(id)),
      ).length;
    };

    const cats = categoryRows.map((r) => {
      const calculatedCount = publicCountForCategory(r);
      return {
        id: Number(r.id),
        name: r.name as string,
        slug: r.slug as string,
        parent: Number(r.parent),
        // Only expose categories that contain products visible under the same
        // rules as the public catalogue.
        count: calculatedCount,
        image: r.image ?? null,
        display: "default",
      };
    });

    res.json(cats.filter((category) => category.count > 0));
  } catch (e: any) {
    logger.error({ err: e }, "[shop/wc/categories] error");
    res.status(500).json({ error: e.message });
  }
});

// ── Shop: product list from internal DB ──────────────────────────────────────

router.get("/shop/wc/products", async (req, res): Promise<void> => {
  try {
    const page    = Math.max(1, Number(req.query.page ?? 1));
    const perPage = Math.min(1000, Math.max(1, Number(req.query.per_page ?? 24)));
    const offset  = (page - 1) * perPage;
    const search  = String(req.query.search ?? "").trim();
    const catSlug = String(req.query.category_slug ?? "").trim();

    // Build WHERE clause
    const conditions: string[] = [
      "p.is_archived = false",
      "p.is_service = false",
      "COALESCE(p.is_bespoke, false) = false",
      "p.website_published = true",
      "(p.woo_commerce_id IS NULL OR p.woo_status IS NULL OR LOWER(p.woo_status) = 'publish')",
      "p.image_url IS NOT NULL",
      "p.image_url <> ''",
    ];
    const binds: any[] = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(`(p.name ILIKE $${paramIdx} OR p.sku ILIKE $${paramIdx})`);
      binds.push(`%${search}%`);
      paramIdx++;
    }
    if (catSlug) {
      const categoryRows = await db.execute(sql`
        SELECT woo_id, name, slug, parent_woo_id
        FROM product_categories
      `);
      const categories = categoryRows.rows as Array<{
        woo_id: number;
        name: string;
        slug: string;
        parent_woo_id: number | null;
      }>;
      const targetCategory = categories.find((category) => category.slug === catSlug);

      if (targetCategory) {
        // Products are stored against their most-specific Woo category. Include
        // all descendants so a parent tile (for example Sportswear) lists its
        // Football and Training Wear products as customers expect.
        const includedWooIds = new Set<number>([Number(targetCategory.woo_id)]);
        let foundChild = true;
        while (foundChild) {
          foundChild = false;
          for (const category of categories) {
            if (
              category.parent_woo_id != null
              && includedWooIds.has(Number(category.parent_woo_id))
              && !includedWooIds.has(Number(category.woo_id))
            ) {
              includedWooIds.add(Number(category.woo_id));
              foundChild = true;
            }
          }
        }

        if (includedWooIds.size) {
          const categoryIdClauses = [...includedWooIds].map((categoryId) => {
            const placeholder = `$${paramIdx++}`;
            binds.push(JSON.stringify([categoryId]));
            return `p.product_category_ids @> ${placeholder}::jsonb`;
          });
          const legacyCategoryIds = legacyCategoryIdsByName(categories.map((category) => ({
            wooId: Number(category.woo_id),
            name: category.name,
            slug: category.slug,
            parent: category.parent_woo_id,
          })));
          const unambiguousLegacyNames = categories
            .filter((category) => includedWooIds.has(Number(category.woo_id)))
            .filter((category) =>
              legacyCategoryIds.get(category.name.trim().toLowerCase()) === Number(category.woo_id),
            )
            .map((category) => category.name.trim().toLowerCase());
          const categoryFilters = [...categoryIdClauses];

          // Bulk Buy & Bundles is also the public destination for products
          // that have quantity pricing. Keep those products in the same
          // collection even when they are not assigned to the WooCommerce
          // bundles category.
          if (catSlug === "bundles") {
            categoryFilters.push(`
              EXISTS (
                SELECT 1
                FROM jsonb_array_elements(
                  CASE
                    WHEN jsonb_typeof(COALESCE(p.price_breaks, '[]'::jsonb)) = 'array'
                    THEN p.price_breaks
                    ELSE '[]'::jsonb
                  END
                ) AS price_tier
                WHERE NULLIF(price_tier->>'qty', '')::numeric > 0
                  AND NULLIF(price_tier->>'price', '')::numeric > 0
                  AND NULLIF(price_tier->>'price', '')::numeric < p.unit_price
              )
            `);
          }

          if (unambiguousLegacyNames.length) {
            const legacyPlaceholders = unambiguousLegacyNames.map(() => `$${paramIdx++}`);
            binds.push(...unambiguousLegacyNames);
            categoryFilters.push(
              `(p.product_category_ids IS NULL AND LOWER(TRIM(p.category)) IN (${legacyPlaceholders.join(", ")}))`,
            );
          }
          conditions.push(`(${categoryFilters.join(" OR ")})`);
        }
      } else {
        // Keep supporting a category slug that has not yet been synced into
        // product_categories.
        const legacyCategoryCondition = `LOWER(REGEXP_REPLACE(p.category, '[^a-zA-Z0-9]+', '-', 'g')) = $${paramIdx}`;
        binds.push(catSlug.toLowerCase());
        paramIdx++;
        if (catSlug === "bundles") {
          conditions.push(`(${legacyCategoryCondition} OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(COALESCE(p.price_breaks, '[]'::jsonb)) = 'array'
                THEN p.price_breaks
                ELSE '[]'::jsonb
              END
            ) AS price_tier
            WHERE NULLIF(price_tier->>'qty', '')::numeric > 0
              AND NULLIF(price_tier->>'price', '')::numeric > 0
              AND NULLIF(price_tier->>'price', '')::numeric < p.unit_price
          ))`);
        } else {
          conditions.push(legacyCategoryCondition);
        }
      }
    }

    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

    const queryText = `
      SELECT
        p.id, p.name, p.sku, p.category, p.image_url,
        p.unit_price, p.regular_price, p.on_sale, p.description, p.permalink,
         p.woo_commerce_id, p.updated_at, p.price_breaks,
         EXISTS (
           SELECT 1
           FROM bundles b
           WHERE b.woo_id = p.woo_commerce_id
             AND b.is_active = true
         ) AS is_bundle,
        COALESCE((
          SELECT SUM(oi.quantity)
          FROM order_items oi
          WHERE oi.product_id = p.id
        ), 0) AS popularity
      FROM products p
      ${where}
      ORDER BY p.name ASC
      LIMIT ${perPage} OFFSET ${offset}
    `;

    const result = await db.execute(sql.raw(
      binds.length
        ? queryText.replace(/\$(\d+)/g, (_, i) => `'${String(binds[Number(i) - 1]).replace(/'/g, "''")}'`)
        : queryText
    ));

    const products = (result.rows as any[]).map((p) => ({
      id: p.id,
      name: p.name,
      slug: toSlug(p.name),
      permalink: p.permalink ?? null,
      price: p.unit_price ? String(p.unit_price) : "0",
      regularPrice: p.regular_price ? String(p.regular_price) : null,
      salePrice: p.on_sale ? String(p.unit_price) : null,
      onSale: p.on_sale ?? false,
      updatedAt: p.updated_at ?? null,
      popularity: Number(p.popularity ?? 0),
      sku: p.sku ?? null,
      shortDescription: (p.description ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      imageUrl: p.image_url ?? null,
      images: p.image_url ? [p.image_url] : [],
      categories: p.category
        ? [{ id: 0, name: p.category, slug: toSlug(p.category) }]
        : [],
       type: "simple",
       isBundle:
         p.is_bundle === true ||
         p.is_bundle === "true" ||
         toSlug(String(p.category ?? "")) === "bundles",
       priceBreaks: (() => {
         const raw = p.price_breaks;
         if (!raw) return [];
         const parsed = Array.isArray(raw)
           ? raw
           : (() => { try { return JSON.parse(String(raw)); } catch { return []; } })();
         const unitPrice = p.unit_price ? Number(p.unit_price) : 0;
         return parsed
           .filter((tier: any) =>
             Number(tier?.qty) > 0 &&
             Number(tier?.price) > 0 &&
             Number(tier.price) < unitPrice,
           )
           .sort((a: any, b: any) => Number(a.qty) - Number(b.qty));
       })(),
    }));

    res.json(products);
  } catch (e: any) {
    logger.error({ err: e }, "[shop/wc/products] error");
    res.status(500).json({ error: e.message });
  }
});

// ── Shop: single product + variants from internal DB ─────────────────────────

router.get("/shop/wc/products/:identifier", async (req, res): Promise<void> => {
  const raw = req.params.identifier;
  // Accept either a numeric ID or a WooCommerce-style slug (e.g. "olympic-polo")
  const numericId = /^\d+$/.test(raw) ? Number(raw) : null;

  try {
    // Lookup by numeric ID or by slug derived from name
    const productRows = await db.execute(
      numericId
        ? sql`
            SELECT id, name, sku, category, image_url, unit_price, regular_price,
                   on_sale, description, permalink, woo_commerce_id, stock_quantity,
                   gallery_images, size_guide_html, price_breaks,
                   guidance_value_rating, guidance_durability_rating, guidance_smart_rating,
                   guidance_badges, guidance_tags, guidance_best_for, guidance_not_ideal_for,
                   guidance_staff_recommendation, guidance_staff_quotes, branding_positions_override
            FROM products
            WHERE id = ${numericId}
              AND is_archived = false
              AND is_service = false
              AND COALESCE(is_bespoke, false) = false
               AND website_published = true
               AND (woo_commerce_id IS NULL OR woo_status IS NULL OR LOWER(woo_status) = 'publish')
               AND image_url IS NOT NULL
               AND image_url <> ''
            LIMIT 1
          `
        : sql`
            SELECT id, name, sku, category, image_url, unit_price, regular_price,
                   on_sale, description, permalink, woo_commerce_id, stock_quantity,
                   gallery_images, size_guide_html, price_breaks,
                   guidance_value_rating, guidance_durability_rating, guidance_smart_rating,
                   guidance_badges, guidance_tags, guidance_best_for, guidance_not_ideal_for,
                   guidance_staff_recommendation, guidance_staff_quotes, branding_positions_override
            FROM products
            WHERE LOWER(REGEXP_REPLACE(TRIM(BOTH '-' FROM REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g')), '^-+|-+$', '', 'g')) = ${raw}
              AND is_archived = false
              AND is_service = false
              AND COALESCE(is_bespoke, false) = false
               AND website_published = true
               AND (woo_commerce_id IS NULL OR woo_status IS NULL OR LOWER(woo_status) = 'publish')
               AND image_url IS NOT NULL
               AND image_url <> ''
            LIMIT 1
          `
    );

    if (!productRows.rows.length) { res.status(404).json({ error: "Not found" }); return; }
    const p = (productRows.rows as any[])[0];
    if (!await isStoredProductImageValid(p.image_url)) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const variantRows = await db.execute(sql`
      SELECT id, colour, size, sleeve, price, vat_rate, image_url, sku,
             stock_quantity, is_available, woo_variation_id
      FROM product_variants
      WHERE product_id = ${p.id}
      ORDER BY colour ASC, size ASC, sleeve ASC
    `);
    const allVariantRows = variantRows.rows as any[];

    // ── Deduplicate by (colour, size, sleeve) — keep the row with highest stock ──
    // Some WC syncs produce multiple rows for the same attribute combination.
    const variantMap = new Map<string, any>();
    for (const v of allVariantRows) {
      const key = `${(v.colour ?? "").trim()}|${(v.size ?? "").trim()}|${(v.sleeve ?? "").trim()}`;
      const existing = variantMap.get(key);
      if (!existing || (v.stock_quantity ?? 0) > (existing.stock_quantity ?? 0)) {
        variantMap.set(key, v);
      }
    }
    const variants = [...variantMap.values()];

    // ── Natural size sort ──────────────────────────────────────────────────────
    // Clothing sizes in display order (case-insensitive match)
    const CLOTHING_ORDER = [
      "xxs", "xs", "extra small", "s", "small", "s/m",
      "m", "medium", "m/l", "l", "large",
      "xl", "extra large", "xxl", "2xl", "xxxl", "3xl", "4xl", "5xl", "6xl",
    ];
    function naturalSizeSort(a: string, b: string): number {
      const na = parseFloat(a);
      const nb = parseFloat(b);
      // Both purely numeric → numeric sort (handles shoe/children's sizes)
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      // Both in known clothing order → use that order
      const ia = CLOTHING_ORDER.indexOf(a.toLowerCase());
      const ib = CLOTHING_ORDER.indexOf(b.toLowerCase());
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return  1;
      // Fallback: natural locale sort
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    }

    // Derive distinct attribute options from deduplicated variants
    const colours = [...new Set(variants.map((v) => (v.colour ?? "").trim()).filter(Boolean))];
    let sizes   = [...new Set(variants.map((v) => (v.size   ?? "").trim()).filter(Boolean))].sort(naturalSizeSort);
    let sleeves = [...new Set(variants.map((v) => (v.sleeve ?? "").trim()).filter(Boolean))].sort(naturalSizeSort);

    // Fallback: if variants carry no size/sleeve (common when WC syncs colour-only variants
    // but sizes are stored as product attributes), read from product_attributes instead.
    if (!sizes.length || !sleeves.length) {
      const attrRows = await db.execute(sql`
        SELECT type, value, COALESCE(sort_order, 999) AS sort_order
        FROM product_attributes
        WHERE product_id = ${p.id} AND type IN ('size', 'sleeve')
        ORDER BY type, sort_order, value
      `);
      const attrList = attrRows.rows as any[];
      if (!sizes.length) {
        sizes = attrList
          .filter((r) => r.type === "size")
          .map((r) => (r.value as string).trim())
          .filter(Boolean)
          .sort(naturalSizeSort);
      }
      if (!sleeves.length) {
        sleeves = attrList
          .filter((r) => r.type === "sleeve")
          .map((r) => (r.value as string).trim())
          .filter(Boolean)
          .sort(naturalSizeSort);
      }
    }

    const attributes: any[] = [];
    if (colours.length) attributes.push({ id: 1, name: "Colour", options: colours, variation: true });
    if (sizes.length)   attributes.push({ id: 2, name: "Size",   options: sizes,   variation: true });
    if (sleeves.length) attributes.push({ id: 3, name: "Sleeve", options: sleeves, variation: true });

    // All variant images (deduplicated)
    const variantImages = [...new Set(
      variants.map((v) => v.image_url).filter(Boolean)
    )];
    const allImages = p.image_url
      ? [p.image_url, ...variantImages.filter((u) => u !== p.image_url)]
      : variantImages;

    const variations = variants.map((v) => {
      const attrs: any[] = [];
      const colour = (v.colour ?? "").trim();
      const size   = (v.size   ?? "").trim();
      const sleeve = (v.sleeve ?? "").trim();
      if (colour) attrs.push({ name: "Colour", option: colour });
      if (size)   attrs.push({ name: "Size",   option: size });
      if (sleeve) attrs.push({ name: "Sleeve", option: sleeve });
      return {
        id: v.id,
        price: v.price ? String(v.price) : String(p.unit_price ?? 0),
        hasPriceOverride: v.price != null,
        vatRate: v.vat_rate != null ? Number(v.vat_rate) : Number(p.vat_rate ?? 0.2),
        hasVatOverride: v.vat_rate != null,
        regularPrice: null,
        salePrice: null,
        stockStatus: (v.stock_quantity ?? 0) > 0 ? "instock" : "outofstock",
        sku: v.sku ?? p.sku,
        image: v.image_url ?? null,
        attributes: attrs,
      };
    });

    // Gallery images: product image + variant images (deduplicated)
    // Also include any synced WC gallery images
    const galleryImages: string[] = p.gallery_images
      ? (Array.isArray(p.gallery_images) ? p.gallery_images : JSON.parse(p.gallery_images)).filter(Boolean)
      : [];
    const fullGallery = [...new Set([...allImages, ...galleryImages])];

    // Parse guidance fields
    const parseMaybeJson = (v: any): any[] => {
      if (!v) return [];
      if (Array.isArray(v)) return v;
      try { const r = JSON.parse(String(v)); return Array.isArray(r) ? r : []; } catch { return []; }
    };

    // Build staff photo map so guidance quotes always show the current profile photo
    const staffPhotoRows = await db.execute(sql`SELECT id, profile_image_url FROM staff_members`);
    const staffPhotoMap: Record<number, string | null> = {};
    for (const row of staffPhotoRows.rows as any[]) {
      staffPhotoMap[row.id] = row.profile_image_url ?? null;
    }

    res.json({
      id: p.id,
      name: p.name,
      slug: toSlug(p.name),
      permalink: p.permalink ?? null,
      price: p.unit_price ? String(p.unit_price) : "0",
      regularPrice: p.regular_price ? String(p.regular_price) : null,
      salePrice: p.on_sale ? String(p.unit_price) : null,
      onSale: p.on_sale ?? false,
      sku: p.sku ?? null,
      description: (p.description ?? "").trim(),
      shortDescription: (p.description ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      images: fullGallery,
      imageUrl: fullGallery[0] ?? null,
      categories: p.category
        ? [{ id: 0, name: p.category, slug: toSlug(p.category) }]
        : [],
      attributes,
      type: variants.length ? "variable" : "simple",
      stockStatus: (p.stock_quantity ?? 0) > 0 ? "instock" : "outofstock",
      stockQuantity: p.stock_quantity ?? 0,
      variations,
      sizeGuideHtml: p.size_guide_html ?? null,
      priceBreaks: (() => {
        const raw = p.price_breaks;
        if (!raw) return [];
        const parsed: { qty: number; price: number }[] =
          Array.isArray(raw) ? raw : (() => { try { return JSON.parse(String(raw)); } catch { return []; } })();
        const unitPrice = p.unit_price ? parseFloat(String(p.unit_price)) : 0;
        return parsed
          .filter((t) => t.qty > 0 && t.price > 0 && t.price < unitPrice)
          .sort((a, b) => a.qty - b.qty);
      })(),
      // Guidance fields
      guidance: {
        valueRating:      p.guidance_value_rating      ? Number(p.guidance_value_rating)      : 0,
        durabilityRating: p.guidance_durability_rating ? Number(p.guidance_durability_rating) : 0,
        technicalRating:  p.guidance_smart_rating      ? Number(p.guidance_smart_rating)      : 0,
        badges:           parseMaybeJson(p.guidance_badges),
        tags:             parseMaybeJson(p.guidance_tags),
        bestFor:          p.guidance_best_for          ?? "",
        notIdealFor:      p.guidance_not_ideal_for     ?? "",
        staffRecommendation: p.guidance_staff_recommendation ?? "",
        staffQuotes: (() => {
          const raw: any[] = Array.isArray(p.guidance_staff_quotes) ? p.guidance_staff_quotes : [];
          return raw.map((q: any) => ({
            name:     (q.staffName ?? q.name ?? "").trim(),
            role:     (q.staffRole ?? q.role ?? "").trim(),
            // Prefer current staff_members photo (keyed by staffId) over stale JSONB snapshot
            imageUrl: (q.staffId ? (staffPhotoMap[q.staffId] ?? q.staffImageUrl ?? q.imageUrl) : (q.staffImageUrl ?? q.imageUrl ?? null)) as string | null,
            quote:    (q.rewritten ?? q.draft ?? "").trim(),
          })).filter((q: any) => q.quote);
        })(),
      },
      // Per-product branding override: null = use global defaults, [] = no branding, [...] = custom positions
      brandingPositionsOverride: (() => {
        const raw = p.branding_positions_override;
        if (!raw) return null;
        try { return Array.isArray(raw) ? raw : JSON.parse(String(raw)); } catch { return null; }
      })(),
    });
  } catch (e: any) {
    logger.error({ err: e }, "[shop/wc/products/:id] error");
    res.status(500).json({ error: e.message });
  }
});

// ── GET /shop/bundle-components/:slug ─────────────────────────────────────────
// Returns the bundle product + each component product (with colour/size variants)
// in a single request so the configurator page doesn't need N+1 fetches.

router.get("/shop/bundle-components/:slug", async (req, res): Promise<void> => {
  try {
    const slug = req.params.slug;

    // 1. Look up bundle product by slug
    const bundleRows = await db.execute(sql`
      SELECT id, name, sku, image_url, unit_price, regular_price, on_sale, description, gallery_images
      FROM products
      WHERE LOWER(REGEXP_REPLACE(TRIM(BOTH '-' FROM REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g')), '^-+|-+$', '', 'g')) = ${slug}
        AND is_archived = false
        AND is_service = false
        AND COALESCE(is_bespoke, false) = false
        AND website_published = true
        AND (woo_commerce_id IS NULL OR woo_status IS NULL OR LOWER(woo_status) = 'publish')
        AND image_url IS NOT NULL
        AND image_url <> ''
      LIMIT 1
    `);
    if (!bundleRows.rows.length) { res.status(404).json({ error: "Bundle not found" }); return; }
    const b = (bundleRows.rows as any[])[0];

    // 2. Parse component lines from description
    const desc: string = b.description ?? "";
    const lower = desc.toLowerCase();
    const startIdx = lower.search(/pack includes/);
    const rawLines = startIdx >= 0
      ? desc.slice(startIdx).replace(/^[^\n]*\n/, "").split("\n")
      : [];

    type ParsedItem = { qty: number; name: string };
    const bundleDefRows = await db.execute(sql`
      SELECT bc.quantity AS qty, COALESCE(p.name, bc.product_name) AS name
      FROM bundles bu
      JOIN bundle_components bc ON bc.bundle_id = bu.id
      LEFT JOIN products p ON p.id = bc.product_id
      WHERE lower(trim(bu.name)) = lower(trim(${b.name}))
      ORDER BY bc.id
    `);
    const hasStructuredDefinition = (bundleDefRows.rows as any[]).length > 0;
    const parsedItems: ParsedItem[] = hasStructuredDefinition
      ? (bundleDefRows.rows as any[]).map((r) => ({ qty: Number(r.qty) || 1, name: String(r.name) }))
      : [];
    if (!hasStructuredDefinition) {
      for (const line of rawLines) {
        const stripped = line.replace(/<[^>]+>/g, "").replace(/\u00a0/g, " ").trim();
        const m = stripped.match(/^(\d+)\s*x?\s+(.+)$/i);
        if (m && !/logo application/i.test(m[2])) {
          parsedItems.push({ qty: parseInt(m[1], 10), name: m[2].trim() });
        }
      }
    }
    // 3. Look up each component + variants (best-effort ILIKE match)
    const CLOTHING_ORDER_SRV = [
      "xxs","xs","extra small","s","small","s/m","m","medium","m/l","l","large",
      "xl","extra large","xxl","2xl","xxxl","3xl","4xl","5xl","6xl",
    ];
    function natSizeSort(a: string, b: string): number {
      const na = parseFloat(a), nb = parseFloat(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      const ia = CLOTHING_ORDER_SRV.indexOf(a.toLowerCase());
      const ib = CLOTHING_ORDER_SRV.indexOf(b.toLowerCase());
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return  1;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    }

    const componentAliases: Record<string, string> = {
      "Driver Wearer Pack|Formal Trousers": "Windsor Formal Trouser",
      "Driver Wearer Pack|Pilot or Classic Shirts": "Pilot Shirt",
      "Driver Wearer Pack|Softshell Jacket": "Premium Softshell",
      "Driver Wearer Pack|Hi-Vis Vest": "Colour Hi-Vis Vest",
      "Eagle Two Tone Wearer Pack|Combat Trouser": "Eagle Two Tone Combat Trouser",
      "Eagle Two Tone Wearer Pack|Polos": "Eagle Two Tone Polo",
      "Eagle Two Tone Wearer Pack|Sweatshirt": "Eagle Two Tone Sweatshirt",
      "Eagle Two Tone Wearer Pack|Softshell": "Eagle Two Tone Softshell",
      "Fireback Wearer Pack|Fireback Wicking Polyester Polo": "Fireback Wicking Polo",
      "Fireback Wearer Pack|Fireback 1/4 Zip Sweatshirt": "Fireback Quarter Zip Sweatshirt",
      "Ladies Casual Pack|Ladies Crew T-Shirts": "Ladies Crew T-Shirt",
      "Ladies Casual Pack|Ladies Polos": "Ladies Classic Polo",
      "Ladies Casual Pack|Ladies Full Zip Hoodies": "Ladies Full Zip Hoodie",
      "Porter Pack|Cargo Trouser": "Essential Cargo Trouser",
      "Essential Tradesman|Compass Padded Softshell": "Compass Padded Softshell Jacket",
      "Olympic Wearer Pack|Olympic Softshell Jacket": "Olympic Softshell",
    };
    function singularComponentName(name: string): string {
      return name
        .replace(/\bT-Shirts\b/gi, "T-Shirt")
        .replace(/\bHoodies\b/gi, "Hoodie")
        .replace(/\bPolos\b/gi, "Polo")
        .replace(/\bTrousers\b/gi, "Trouser")
        .replace(/\bShirts\b/gi, "Shirt")
        .replace(/\bSweatshirts\b/gi, "Sweatshirt");
    }

    const components = await Promise.all(
      parsedItems.map(async (item) => {
        const searchHasKids = /\bkids?\b/i.test(item.name);
        const searchName = componentAliases[`${b.name}|${item.name}`] ?? singularComponentName(item.name);
        const prodRows = await db.execute(sql`
          SELECT id, name, sku, image_url, unit_price, description
          FROM products
           WHERE name ILIKE ${`%${searchName}%`}
            AND is_archived = false
            AND is_service = false
              AND COALESCE(is_bespoke, false) = false
              AND website_published = true
              AND (woo_commerce_id IS NULL OR woo_status IS NULL OR LOWER(woo_status) = 'publish')
              AND image_url IS NOT NULL
              AND image_url <> ''
           ORDER BY
             CASE WHEN lower(trim(name)) = lower(trim(${searchName})) THEN 0 ELSE 1 END,
             CASE WHEN ${searchHasKids} THEN 0 ELSE CASE WHEN name ILIKE '%kids%' THEN 1 ELSE 0 END END ASC,
            CHAR_LENGTH(name) ASC
          LIMIT 1
        `);
        if (!prodRows.rows.length) {
          return { qty: item.qty, name: item.name, product: null };
        }
        const p = (prodRows.rows as any[])[0];

        const vRows = await db.execute(sql`
          SELECT id, colour, size, sleeve, image_url, sku
          FROM product_variants
          WHERE product_id = ${p.id}
          ORDER BY colour ASC, size ASC
        `);
        const allVars = vRows.rows as any[];

        const varMap = new Map<string, any>();
        for (const v of allVars) {
          const key = `${(v.colour ?? "").trim()}|${(v.size ?? "").trim()}|${(v.sleeve ?? "").trim()}`;
          if (!varMap.has(key)) varMap.set(key, v);
        }
        const vars = [...varMap.values()];

        const colours = [...new Set(vars.map((v) => (v.colour ?? "").trim()).filter(Boolean))];
        let sizes   = [...new Set(vars.map((v) => (v.size   ?? "").trim()).filter(Boolean))].sort(natSizeSort);
        let sleeves = [...new Set(vars.map((v) => (v.sleeve ?? "").trim()).filter(Boolean))].sort(natSizeSort);

        if (!sizes.length || !sleeves.length) {
          const attrRows = await db.execute(sql`
            SELECT type, value FROM product_attributes
            WHERE product_id = ${p.id} AND type IN ('size', 'sleeve')
            ORDER BY type, sort_order, value
          `);
          const attrs = attrRows.rows as any[];
          if (!sizes.length)
            sizes = attrs.filter((r: any) => r.type === "size").map((r: any) => String(r.value).trim()).filter(Boolean).sort(natSizeSort);
          if (!sleeves.length)
            sleeves = attrs.filter((r: any) => r.type === "sleeve").map((r: any) => String(r.value).trim()).filter(Boolean).sort(natSizeSort);
        }

        const colourImages: Record<string, string> = {};
        for (const v of vars) {
          const c = (v.colour ?? "").trim();
          if (c && v.image_url && !colourImages[c]) colourImages[c] = v.image_url;
        }

        // Strip HTML tags and trim description for the accordion
        const rawDesc: string = p.description ?? "";
        const shortDesc = rawDesc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);

        return {
          qty: item.qty,
          name: item.name,
          product: {
            id: p.id,
            name: p.name,
            slug: toSlug(p.name),
            imageUrl: p.image_url ?? null,
            description: shortDesc || null,
            colours,
            sizes,
            sleeves,
            colourImages,
            variations: vars.map((v) => ({
              id: v.id,
              colour: (v.colour ?? "").trim() || null,
              size:   (v.size   ?? "").trim() || null,
              sleeve: (v.sleeve ?? "").trim() || null,
              imageUrl: v.image_url ?? null,
              sku: v.sku ?? null,
            })),
          },
        };
      })
    );

    const galleryImages: string[] = b.gallery_images
      ? (Array.isArray(b.gallery_images)
          ? b.gallery_images
          : (() => { try { return JSON.parse(String(b.gallery_images)); } catch { return []; } })())
      : [];
    const images = b.image_url
      ? [b.image_url, ...galleryImages.filter((u: string) => u !== b.image_url)]
      : galleryImages;

    res.json({
      bundle: {
        id: b.id,
        name: b.name,
        slug,
        sku: b.sku ?? null,
        price: b.unit_price ? String(b.unit_price) : "0",
        regularPrice: b.regular_price ? String(b.regular_price) : null,
        onSale: b.on_sale ?? false,
        imageUrl: images[0] ?? null,
        images,
      },
      components,
    });
  } catch (e: any) {
    logger.error({ err: e }, "[shop/bundle-components/:slug] error");
    res.status(500).json({ error: e.message });
  }
});

// ── Stripe: create payment intent for shop checkout ───────────────────────────

const BESPOKE_TIE_MINIMUM_QUANTITY = 25;

function decodeJsonValue(value: unknown): any {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try { return JSON.parse(value); } catch { return null; }
}

function validMoney(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round((number + Number.EPSILON) * 100) / 100 : null;
}

async function getShopPricingBranding(): Promise<any[]> {
  const settings = await getAllSettings();
  const configured = decodeJsonValue(settings["shop_branding_positions"]);
  return Array.isArray(configured) ? configured : DEFAULT_BRANDING_POSITIONS;
}

function resolveBranding(
  submitted: any,
  productOverride: unknown,
  globalOptions: any[],
): Array<{ id: string; name: string; surcharge: number; notes?: string | null }> {
  if (submitted != null && !Array.isArray(submitted)) throw new Error("Branding selection is invalid.");
  const override = productOverride == null ? null : decodeJsonValue(productOverride);
  if (productOverride != null && !Array.isArray(override)) {
    throw new Error("Product branding configuration is invalid; checkout cannot be priced.");
  }
  const allowed: any[] = override ?? globalOptions;
  const requested = submitted ?? [];
  const seen = new Set<string>();
  return requested.map((position: any) => {
    if (!position || typeof position.id !== "string" || seen.has(position.id)) {
      throw new Error("Branding selection contains an invalid or duplicate position.");
    }
    seen.add(position.id);
    const authoritative = allowed.find((option: any) => option?.id === position.id);
    const surcharge = validMoney(authoritative?.surcharge);
    if (!authoritative || surcharge === null || typeof authoritative.name !== "string") {
      throw new Error(`Branding position "${position.id}" is not available for this product.`);
    }
    return {
      id: authoritative.id,
      name: authoritative.name,
      surcharge,
      notes: typeof position.notes === "string" ? position.notes.trim() : null,
    };
  });
}

async function getPublishedShopProduct(identifier: number): Promise<any | null> {
  const result = await db.execute(sql`
    SELECT p.id, p.name, p.sku, p.unit_price, p.vat_rate, p.price_breaks,
           p.branding_positions_override, p.woo_commerce_id
    FROM products p
    WHERE (p.id = ${identifier} OR p.woo_commerce_id = ${identifier})
      AND COALESCE(p.is_archived, false) = false
      AND COALESCE(p.is_service, false) = false
      AND COALESCE(p.is_bespoke, false) = false
      AND p.website_published = true
      AND (p.woo_commerce_id IS NULL OR p.woo_status IS NULL OR LOWER(p.woo_status) = 'publish')
      AND p.image_url IS NOT NULL AND p.image_url <> ''
    ORDER BY CASE WHEN p.id = ${identifier} THEN 0 ELSE 1 END
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

async function getPublishedProductById(id: number): Promise<any | null> {
  const result = await db.execute(sql`
    SELECT p.id, p.name, p.sku, p.unit_price, p.vat_rate, p.price_breaks,
           p.branding_positions_override
    FROM products p
    WHERE p.id = ${id}
      AND COALESCE(p.is_archived, false) = false
      AND COALESCE(p.is_service, false) = false
      AND COALESCE(p.is_bespoke, false) = false
      AND p.website_published = true
      AND (p.woo_commerce_id IS NULL OR p.woo_status IS NULL OR LOWER(p.woo_status) = 'publish')
      AND p.image_url IS NOT NULL AND p.image_url <> ''
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

async function getProductVariant(productId: number, input: any, allowSleeve: boolean): Promise<any | null> {
  const result = await db.execute(sql`
    SELECT id, woo_variation_id, colour, size, sleeve, price, vat_rate, sku
    FROM product_variants WHERE product_id = ${productId}
    ORDER BY id
  `);
  const variants = result.rows as any[];
  if (!variants.length) {
    if (input.variationId != null) {
      throw new Error("The selected product variant is no longer available.");
    }
    if (input.colour || input.size || (allowSleeve && input.sleeve)) {
      const attributesResult = await db.execute(sql`
        SELECT type, value FROM product_attributes
        WHERE product_id = ${productId} AND type IN ('colour', 'size', 'sleeve')
      `);
      const attributes = attributesResult.rows as Array<{ type: string; value: string }>;
      const values = (type: string) => attributes
        .filter((attribute) => attribute.type === type)
        .map((attribute) => String(attribute.value).trim().toLowerCase());
      if (values("colour").length && !input.colour) throw new Error("Please select a product colour.");
      if (values("size").length && !input.size) throw new Error("Please select a product size.");
      if (allowSleeve && values("sleeve").length && !input.sleeve) throw new Error("Please select a product sleeve.");
      if (!allowSleeve && values("sleeve").length) {
        throw new Error("This product's sleeve selection cannot be verified; please contact support.");
      }
      if (input.colour && !values("colour").includes(String(input.colour).trim().toLowerCase())) {
        throw new Error("The selected colour is not available for this product.");
      }
      if (input.size && !values("size").includes(String(input.size).trim().toLowerCase())) {
        throw new Error("The selected size is not available for this product.");
      }
      if (allowSleeve && input.sleeve && !values("sleeve").includes(String(input.sleeve).trim().toLowerCase())) {
        throw new Error("The selected sleeve is not available for this product.");
      }
    }
    return null;
  }

  let matches: any[];
  if (input.variationId != null) {
    matches = variants.filter((variant) =>
      Number(variant.id) === Number(input.variationId) ||
      Number(variant.woo_variation_id) === Number(input.variationId),
    );
    matches.sort((a, b) => Number(a.id) === Number(input.variationId) ? -1 : Number(b.id) === Number(input.variationId) ? 1 : 0);
  } else {
    const same = (stored: unknown, supplied: unknown) =>
      String(stored ?? "").trim().toLowerCase() === String(supplied ?? "").trim().toLowerCase();
    matches = variants.filter((variant) =>
      same(variant.colour, input.colour) &&
      same(variant.size, input.size) &&
      (!allowSleeve || same(variant.sleeve, input.sleeve)),
    );
  }
  if (!matches.length) throw new Error("The selected product variant is no longer available.");
  const variant = matches[0];
  if (input.colour && String(variant.colour ?? "").trim().toLowerCase() !== String(input.colour).trim().toLowerCase()) {
    throw new Error("The selected colour does not match the product variant.");
  }
  if (input.size && String(variant.size ?? "").trim().toLowerCase() !== String(input.size).trim().toLowerCase()) {
    throw new Error("The selected size does not match the product variant.");
  }
  if (allowSleeve && input.sleeve && String(variant.sleeve ?? "").trim().toLowerCase() !== String(input.sleeve).trim().toLowerCase()) {
    throw new Error("The selected sleeve does not match the product variant.");
  }
  if (matches.length > 1 && input.variationId == null) {
    throw new Error("The product variant is ambiguous; please select it again.");
  }
  return variant;
}

async function validateShopBasket(
  submittedItems: any[],
  shippingMethod: keyof typeof SHIPPING_PRICES,
): Promise<{ items: PricedShopItem[]; totals: ReturnType<typeof calculateShopTotals>; fingerprint: string }> {
  if (!Array.isArray(submittedItems) || submittedItems.length < 1 || submittedItems.length > 100) {
    throw new Error("A basket with 1–100 items is required.");
  }
  const globalBrandingOptions = await getShopPricingBranding();
  const prepared: Array<{ item: PricedShopItem; basePrice: number; hasVariantPrice: boolean; priceBreaks: Array<{ qty: number; price: number }> }> = [];
  for (const input of submittedItems) {
    if (!Number.isInteger(input?.wcProductId) || input.wcProductId <= 0 ||
      !Number.isInteger(input?.quantity) || input.quantity <= 0 || input.quantity > 100000) {
      throw new Error("Basket contains an invalid product or quantity.");
    }
    const product = await getPublishedShopProduct(input.wcProductId);
    if (!product) throw new Error(`Product ${input.wcProductId} is not available for shop checkout.`);
    const rawBasePrice = validMoney(product.unit_price);
    if (rawBasePrice === null || rawBasePrice <= 0) throw new Error(`Product "${product.name}" has no valid published price.`);
    const isBundleResult = product.woo_commerce_id == null ? { rows: [] } : await db.execute(sql`
      SELECT id, price FROM bundles WHERE woo_id = ${product.woo_commerce_id} AND is_active = true LIMIT 1
    `);
    const bundle = isBundleResult.rows[0] as any;

    if (bundle) {
      if (!Array.isArray(input.bundleComponents) || input.bundleComponents.length === 0 || input.brandingPositions?.length) {
        throw new Error(`Bundle "${product.name}" must include its configured component selections.`);
      }
      const definitions = await db.execute(sql`
        SELECT bc.product_id, bc.product_name, bc.quantity,
               p.name AS resolved_name, p.branding_positions_override, p.vat_rate
        FROM bundle_components bc
        LEFT JOIN products p ON p.id = bc.product_id
        WHERE bc.bundle_id = ${bundle.id}
        ORDER BY bc.id
      `);
      const expected = (definitions.rows as any[]).filter((component) =>
        !/logo\s+application/i.test(String(component.resolved_name ?? component.product_name ?? "")),
      );
      if (!expected.length || expected.some((component) => !component.product_id || !component.resolved_name)) {
        throw new Error(`Bundle "${product.name}" has no complete published component definition.`);
      }
      const remaining = [...expected];
      let brandingPerBundle = 0;
      const checkedComponents: NonNullable<PricedShopItem["bundleComponents"]> = [];
      for (const componentInput of input.bundleComponents) {
        const componentIndex = remaining.findIndex((component) =>
          String(component.resolved_name).trim().toLowerCase() === String(componentInput?.name ?? "").trim().toLowerCase() ||
          String(component.product_name).trim().toLowerCase() === String(componentInput?.name ?? "").trim().toLowerCase(),
        );
        if (componentIndex < 0) throw new Error(`"${componentInput?.name ?? "Unknown"}" is not a component of bundle "${product.name}".`);
        const [definition] = remaining.splice(componentIndex, 1);
        if (!Number.isInteger(componentInput.qty) || componentInput.qty !== Number(definition.quantity)) {
          throw new Error(`Bundle component quantity for "${definition.resolved_name}" is invalid.`);
        }
        const componentProduct = await getPublishedProductById(Number(definition.product_id));
        if (!componentProduct) throw new Error(`Bundle component "${definition.resolved_name}" is no longer available.`);
        const variant = await getProductVariant(Number(componentProduct.id), componentInput, true);
        // The bundle configurator intentionally displays the global branding
        // catalog for every component; product-detail overrides do not govern
        // this separate bundle configuration flow.
        const branding = resolveBranding(componentInput.brandingPositions, null, globalBrandingOptions);
        brandingPerBundle += branding.reduce((sum, position) => sum + position.surcharge, 0) * componentInput.qty;
        checkedComponents.push({
          productId: Number(componentProduct.id),
          name: componentProduct.name,
          qty: componentInput.qty,
          colour: variant?.colour ?? componentInput.colour ?? null,
          size: variant?.size ?? componentInput.size ?? null,
          sleeve: variant?.sleeve ?? componentInput.sleeve ?? null,
          variationId: variant ? Number(variant.id) : null,
          brandingPositions: branding,
        });
      }
      if (remaining.length) throw new Error(`Bundle "${product.name}" is missing configured components.`);
      const basePrice = rawBasePrice;
      const vatRate = 0.2; // The shop bundle configurator and cart apply standard VAT to the bundle and component branding.
      prepared.push({
        item: {
          wcProductId: Number(product.id),
          variationId: null,
          name: product.name,
          sku: product.sku ?? null,
          price: 0,
          vatRate,
          quantity: input.quantity,
          colour: null,
          size: null,
          brandingPositions: [],
          wearerName: input.wearerName ?? null,
          bundleComponents: checkedComponents,
        },
        basePrice: basePrice + brandingPerBundle,
        hasVariantPrice: true,
        priceBreaks: [],
      });
      continue;
    }

    if (input.bundleComponents?.length) throw new Error(`Product "${product.name}" is not a configured bundle.`);
    const variant = await getProductVariant(Number(product.id), input, false);
    const variantPrice = variant?.price == null ? null : validMoney(variant.price);
    if (variant?.price != null && (variantPrice === null || variantPrice <= 0)) throw new Error(`Product "${product.name}" has an invalid variant price.`);
    const variantVat = variant?.vat_rate == null ? null : Number(variant.vat_rate);
    const productVat = product.vat_rate == null ? 0.2 : Number(product.vat_rate);
    const vatRate = variantVat ?? productVat;
    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 1) throw new Error(`Product "${product.name}" has an invalid VAT rate.`);
    const branding = resolveBranding(input.brandingPositions, product.branding_positions_override, globalBrandingOptions);
    const basePrice = variantPrice ?? rawBasePrice;
    prepared.push({
      item: {
        wcProductId: Number(product.id),
        variationId: variant ? Number(variant.id) : null,
        name: product.name,
        sku: variant?.sku ?? product.sku ?? null,
        price: 0,
        vatRate,
        quantity: input.quantity,
        colour: variant?.colour ?? input.colour ?? null,
        size: variant?.size ?? input.size ?? null,
        brandingPositions: branding,
        wearerName: input.wearerName ?? null,
      },
      basePrice,
      hasVariantPrice: variantPrice !== null,
      priceBreaks: parsePriceBreaks(product.price_breaks).filter((tier) => tier.price < rawBasePrice),
    });
  }

  const quantityByProduct = new Map<number, number>();
  for (const row of prepared) {
    if (!row.item.bundleComponents?.length) {
      quantityByProduct.set(row.item.wcProductId, (quantityByProduct.get(row.item.wcProductId) ?? 0) + row.item.quantity);
    }
  }
  const items = prepared.map((row) => {
    const unitPrice = !row.hasVariantPrice && !row.item.bundleComponents?.length
      ? quantityTierPrice(row.priceBreaks, quantityByProduct.get(row.item.wcProductId) ?? row.item.quantity, row.basePrice)
      : row.basePrice;
    const brandingSurcharge = row.item.brandingPositions?.reduce((sum, position) => sum + position.surcharge, 0) ?? 0;
    return { ...row.item, price: Math.round((unitPrice + brandingSurcharge + Number.EPSILON) * 100) / 100 };
  });
  const shippingAmount = SHIPPING_PRICES[shippingMethod];
  const totals = calculateShopTotals(items, shippingAmount);
  return {
    items,
    totals,
    fingerprint: shopBasketFingerprint(items, shippingMethod, shippingAmount),
  };
}

router.post("/shop/promotions/validate", async (req, res): Promise<void> => {
  const body = z.object({ code: z.string(), cartItems: z.array(z.any()) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ applied: false, error: "Invalid promotion payload", reason: "invalid_payload" }); return; }
  res.status(400).json({
    applied: false,
    error: "Promotions are not configured for this installation.",
    reason: "promotion_not_configured",
  });
});

async function validateBespokeTieMinimum(cartItems: unknown): Promise<string | null> {
  if (!Array.isArray(cartItems)) return null;
  const productRows = await db.execute(sql`
    SELECT id
    FROM products
    WHERE trim(name) ~* '^Bespoke Woven Polyester Ties?$'
  `);
  const bespokeTieIds = new Set((productRows.rows as any[]).map(row => Number(row.id)));
  const quantity = cartItems.reduce((sum: number, item: any) =>
    bespokeTieIds.has(Number(item?.wcProductId)) ? sum + Number(item?.quantity ?? 0) : sum
  , 0);
  if (quantity > 0 && quantity < BESPOKE_TIE_MINIMUM_QUANTITY) {
    return `Bespoke woven polyester ties have a minimum order of ${BESPOKE_TIE_MINIMUM_QUANTITY} units in total. Full-length and clip-on ties may be mixed.`;
  }
  return null;
}

function originalShopCartFingerprint(cartItems: unknown): string {
  if (!Array.isArray(cartItems)) throw new Error("A valid original basket is required.");
  const normalized = cartItems.map((item: any) => ({
    productId: Number(item?.wcProductId),
    variationId: item?.variationId == null ? null : Number(item.variationId),
    quantity: Number(item?.quantity),
    colour: String(item?.colour ?? "").trim().toLowerCase() || null,
    size: String(item?.size ?? "").trim().toLowerCase() || null,
    wearerName: String(item?.wearerName ?? "").trim().toLowerCase() || null,
    branding: (Array.isArray(item?.brandingPositions) ? item.brandingPositions : [])
      .map((position: any) => ({
        id: String(position?.id ?? ""),
        notes: String(position?.notes ?? "").trim() || null,
      }))
      .sort((a: any, b: any) => a.id.localeCompare(b.id)),
    components: (Array.isArray(item?.bundleComponents) ? item.bundleComponents : [])
      .map((component: any) => ({
        name: String(component?.name ?? "").trim().toLowerCase(),
        quantity: Number(component?.qty),
        variationId: component?.variationId == null ? null : Number(component.variationId),
        colour: String(component?.colour ?? "").trim().toLowerCase() || null,
        size: String(component?.size ?? "").trim().toLowerCase() || null,
        sleeve: String(component?.sleeve ?? "").trim().toLowerCase() || null,
        branding: (Array.isArray(component?.brandingPositions) ? component.brandingPositions : [])
          .map((position: any) => ({
            id: String(position?.id ?? ""),
            notes: String(position?.notes ?? "").trim() || null,
          }))
          .sort((a: any, b: any) => a.id.localeCompare(b.id)),
      }))
      .sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  })).sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

router.post("/shop/stripe/payment-intent", async (req, res): Promise<void> => {
  const { amount, cartItems, promoCode, shippingMethod = "courier" } = req.body ?? {};
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "amount (positive number in £) is required" });
    return;
  }
  if (promoCode) {
    res.status(400).json({ error: "Promotions are not configured for this installation." });
    return;
  }
  if (typeof shippingMethod !== "string" || !Object.prototype.hasOwnProperty.call(SHIPPING_PRICES, shippingMethod)) {
    res.status(400).json({ error: "Shipping method is not valid." });
    return;
  }
  const submittedPostcode = typeof req.body?.postcode === "string"
    ? req.body.postcode
    : typeof req.body?.deliveryAddress?.postcode === "string"
      ? req.body.deliveryAddress.postcode
      : "";
  let validated: Awaited<ReturnType<typeof validateShopBasket>>;
  let shippingTerms: ReturnType<typeof validateShopShippingEligibility>;
  try {
    const [shippingSettings, configuredBusiness] = await Promise.all([getAllSettings(), getBusinessConfig()]);
    const shippingConfiguration = resolveShopShippingConfiguration(shippingSettings, configuredBusiness);
    const postcode = normalizeShopPostcode(submittedPostcode);
    const coordinates = shippingMethod === "free_local" && postcode
      ? await geocodePostcode(postcode)
      : null;
    shippingTerms = validateShopShippingEligibility(
      shippingMethod as keyof typeof SHIPPING_PRICES,
      submittedPostcode,
      shippingConfiguration,
      coordinates,
    );
    if ("error" in shippingTerms) {
      res.status(400).json({ error: shippingTerms.error });
      return;
    }
    if (shippingTerms.terms.destination.length > 500 || shippingTerms.terms.postcode.length > 500) {
      res.status(400).json({ error: "Shipping destination is too long to validate for payment." });
      return;
    }
    validated = await validateShopBasket(cartItems, shippingMethod as keyof typeof SHIPPING_PRICES);
    if (Math.abs(validated.totals.total - amount) > 0.011) {
      res.status(400).json({ error: "Payment amount does not match the authoritative basket total.", authoritativeTotal: validated.totals.total });
      return;
    }
    const minimumError = await validateBespokeTieMinimum(validated.items);
    if (minimumError) {
      res.status(400).json({ error: minimumError });
      return;
    }
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Basket could not be priced." });
    return;
  }
  try {
    const stripe = await getUncachableStripeClient();
    const amountPence = Math.round(validated.totals.total * 100);
    const description = `Shop order — ${validated.items.length} line${validated.items.length === 1 ? "" : "s"}`;
    const intent = await stripe.paymentIntents.create({
      amount: amountPence,
      currency: "gbp",
      description,
      metadata: {
        source: "shop",
        basket_hash: validated.fingerprint,
        original_cart_hash: originalShopCartFingerprint(cartItems),
        basket_total_pence: String(amountPence),
        basket_shipping_method: shippingMethod,
        shipping_terms_version: "1",
        shipping_eligible: "true",
        shipping_method: shippingTerms.terms.method,
        shipping_destination: shippingTerms.terms.destination,
        shipping_postcode: shippingTerms.terms.postcode,
        shipping_fingerprint: shippingTerms.terms.fingerprint,
      },
      automatic_payment_methods: { enabled: true },
    });
    const createdAt = new Date().toISOString();
    const originalCartFingerprint = originalShopCartFingerprint(cartItems);
    const snapshot = {
      version: 1,
      paymentIntentId: intent.id,
      createdAt,
      originalCart: cartItems,
      originalCartFingerprint,
      pricedItems: validated.items,
      totals: { ...validated.totals, shipping: SHIPPING_PRICES[shippingMethod as keyof typeof SHIPPING_PRICES], discounts: 0 },
      shippingMethod,
      shippingTerms: shippingTerms.terms,
      basketFingerprint: validated.fingerprint,
      amountPence,
      promotionCode: null,
    };
    await db.execute(sql`
      INSERT INTO shop_checkout_intents
        (payment_intent_id, original_cart_fingerprint, amount_pence, snapshot, status, created_at)
      VALUES (
        ${intent.id}, ${originalCartFingerprint}, ${amountPence},
        ${JSON.stringify(snapshot)}::jsonb, 'pending', ${createdAt}
      )
    `);
    res.json({ clientSecret: intent.client_secret, paymentIntentId: intent.id, amount: validated.totals.total });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/shop/stripe/payment-intent/:id/status", async (req, res): Promise<void> => {
  if (!/^pi_[A-Za-z0-9]+$/.test(String(req.params.id))) {
    res.status(400).json({ error: "Invalid payment reference" }); return;
  }
  try {
    const stripe = await getUncachableStripeClient();
    const intent = await stripe.paymentIntents.retrieve(String(req.params.id));
    if (intent.metadata.source !== "shop") { res.status(404).json({ error: "Shop payment not found" }); return; }
    res.json({ status: intent.status });
  } catch (error) {
    logger.error({ err: error }, "[shop/stripe] Unable to check payment status");
    res.status(503).json({ error: "Payment status unavailable. Please wait rather than pay again." });
  }
});

// ── Branding options (positions + surcharges) ────────────────────────────────

const DEFAULT_BRANDING_POSITIONS = [
  { id: "left-chest",   name: "Left Chest",    surcharge: 0,    description: "Standard position — included in base price" },
  { id: "right-chest",  name: "Right Chest",   surcharge: 4.00, description: "" },
  { id: "back-large",   name: "Back Large",    surcharge: 6.00, description: "Full-width back logo" },
  { id: "back-small",   name: "Back Small",    surcharge: 4.00, description: "" },
  { id: "left-sleeve",  name: "Left Sleeve",   surcharge: 4.00, description: "" },
  { id: "right-sleeve", name: "Right Sleeve",  surcharge: 4.00, description: "" },
  { id: "other",        name: "Other",         surcharge: 0,    description: "Describe the position required — pricing confirmed separately", notes_field: true },
];

router.get("/shop/branding-options", async (_req, res): Promise<void> => {
  const settings = await getAllSettings();
  const raw = settings["shop_branding_positions"];
  if (raw) {
    try { res.json(JSON.parse(raw)); return; } catch {}
  }
  res.json(DEFAULT_BRANDING_POSITIONS);
});

router.post("/shop/branding-options", async (req, res): Promise<void> => {
  const positions = req.body;
  if (!Array.isArray(positions)) { res.status(400).json({ error: "Expected array" }); return; }
  await db.execute(sql`
    INSERT INTO settings (key, value) VALUES ('shop_branding_positions', ${JSON.stringify(positions)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `);
  res.json({ ok: true });
});

// ── WordPress page content by slug ───────────────────────────────────────────
const wpPageCache: Record<string, { data: any; ts: number }> = {};
const WP_PAGE_TTL = 60 * 60 * 1000; // 1 hour

router.get("/shop/wp-page/:slug", async (req: Request, res: Response) => {
  const { slug } = req.params;
  const now = Date.now();
  const cached = wpPageCache[slug];
  if (cached && now - cached.ts < WP_PAGE_TTL) {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(cached.data);
    return;
  }
  try {
    await assertOutboundIntegrationEnabled("wordpress");
    const baseUrl = process.env.WORDPRESS_BASE_URL;
    if (!baseUrl) { res.status(503).json({ error: "WordPress integration is not configured." }); return; }
    if (!isPublicHttpsUrl(baseUrl)) { res.status(503).json({ error: "WordPress URL must be a public HTTPS URL." }); return; }
    const url = `${baseUrl.replace(/\/$/, "")}/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}&_fields=id,slug,title,content,excerpt,featured_media,_embedded&_embed=wp:featuredmedia`;
    const wpRes = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!wpRes.ok) { res.status(wpRes.status).json({ error: "WordPress API error" }); return; }
    const pages: any[] = await wpRes.json();
    if (!pages.length) { res.status(404).json({ error: "Page not found" }); return; }
    const p = pages[0];
    const featuredImageUrl =
      p._embedded?.["wp:featuredmedia"]?.[0]?.source_url ??
      (p.featured_media > 0
        ? await fetch(`${baseUrl.replace(/\/$/, "")}/wp-json/wp/v2/media/${p.featured_media}`, { signal: AbortSignal.timeout(5000) })
            .then(r => r.ok ? r.json() : null)
            .then(m => m?.source_url ?? null)
            .catch(() => null)
        : null);
    const result = {
      id: p.id,
      slug: p.slug,
      title: p.title?.rendered ?? slug,
      content: p.content?.rendered ?? "",
      excerpt: p.excerpt?.rendered ?? "",
      featuredImageUrl,
    };
    wpPageCache[slug] = { data: result, ts: now };
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(result);
  } catch (e: any) {
    logger.error({ err: e?.message, slug }, "[shop/wp-page] fetch error");
    res.status(500).json({ error: "Failed to fetch page" });
  }
});

// ── Shop shipping options and order creation ───────────────────────────────────

const SHIPPING_PRICES = {
  courier: 8.5,
  free_local: 0,
  warehouse_collection: 0,
  office_collection: 0,
} as const;

const SHIPPING_LABELS: Record<keyof typeof SHIPPING_PRICES, string> = {
  courier: "Standard UK Delivery",
  free_local: "Free Local Delivery",
  warehouse_collection: "Warehouse Collection",
  office_collection: "Office Collection",
};

type Coordinates = { latitude: number; longitude: number };
const postcodeCoordinatesCache = new Map<string, { coordinates: Coordinates | null; expiresAt: number }>();

function normalisePostcode(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

async function geocodePostcode(postcode: string): Promise<Coordinates | null> {
  const normalized = normalisePostcode(postcode);
  if (!normalized) return null;

  const cached = postcodeCoordinatesCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return cached.coordinates;

  try {
    await assertOutboundIntegrationEnabled("postcodes_io");
    const response = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(normalized)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!response.ok) {
      postcodeCoordinatesCache.set(normalized, { coordinates: null, expiresAt: Date.now() + 5 * 60 * 1000 });
      return null;
    }
    const payload = await response.json() as { result?: { latitude?: number; longitude?: number } };
    const latitude = Number(payload.result?.latitude);
    const longitude = Number(payload.result?.longitude);
    const coordinates = Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude, longitude }
      : null;
    postcodeCoordinatesCache.set(normalized, { coordinates, expiresAt: Date.now() + 60 * 60 * 1000 });
    return coordinates;
  } catch {
    postcodeCoordinatesCache.set(normalized, { coordinates: null, expiresAt: Date.now() + 60 * 1000 });
    return null;
  }
}

function distanceMiles(from: Coordinates, to: Coordinates): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const earthRadiusMiles = 3958.7613;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
    Math.cos(radians(to.latitude)) *
    Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

router.get("/shop/shipping-options", async (req: Request, res: Response): Promise<void> => {
  const [settings, business] = await Promise.all([getAllSettings(), getBusinessConfig()]);
  const shippingConfiguration = resolveShopShippingConfiguration(settings, business);
  const postcode = typeof req.query.postcode === "string"
    ? normalisePostcode(req.query.postcode)
    : "";
  const coordinates = postcode && shippingConfiguration.freeLocalDelivery
    ? await geocodePostcode(postcode)
    : null;
  const localDeliveryDistanceMiles = coordinates
    ? distanceMiles(shippingConfiguration.freeLocalDelivery!.origin, coordinates)
    : null;
  const localDeliveryEligible = localDeliveryDistanceMiles !== null &&
    localDeliveryDistanceMiles <= shippingConfiguration.freeLocalDelivery!.radiusMiles;

  const options = [
    ...(localDeliveryEligible
      ? [{
          value: "free_local",
          label: SHIPPING_LABELS.free_local,
          price: SHIPPING_PRICES.free_local,
          description: `Free local delivery within ${shippingConfiguration.freeLocalDelivery!.radiusMiles} miles`,
        }]
      : []),
    {
      value: "courier",
      label: SHIPPING_LABELS.courier,
      price: SHIPPING_PRICES.courier,
      description: "UK delivery — £8.50 per order",
    },
    ...(shippingConfiguration.enabledCollectionMethods.includes("warehouse_collection")
      ? [{
          value: "warehouse_collection",
          label: SHIPPING_LABELS.warehouse_collection,
          price: SHIPPING_PRICES.warehouse_collection,
          description: `Collect from ${shippingConfiguration.collectionAddress}`,
          address: shippingConfiguration.collectionAddress,
        }]
      : []),
    ...(shippingConfiguration.enabledCollectionMethods.includes("office_collection")
      ? [{
          value: "office_collection",
          label: SHIPPING_LABELS.office_collection,
          price: SHIPPING_PRICES.office_collection,
          description: `Collect from ${shippingConfiguration.collectionAddress}`,
          address: shippingConfiguration.collectionAddress,
        }]
      : []),
  ];

  res.json({
    postcode,
    postcodeValid: !postcode || !shippingConfiguration.freeLocalDelivery || coordinates !== null,
    localDeliveryEligible,
    localDeliveryDistanceMiles: localDeliveryDistanceMiles === null
      ? null
      : Math.round(localDeliveryDistanceMiles * 10) / 10,
    options,
  });
});

// ── Shop order creation (called after Stripe payment confirms) ────────────────

const AnalyticsType = z.enum(["PAGE_VIEW","CATEGORY_VIEW","PRODUCT_VIEW","SEARCH","ADD_TO_BASKET","REMOVE_FROM_BASKET","BEGIN_CHECKOUT","CHECKOUT_COMPLETED","ORDER_COMPLETED"]);
const AnalyticsChannel = z.enum(["ORGANIC_SEARCH","DIRECT","REFERRAL","EMAIL","SOCIAL","PAID_SEARCH","OTHER"]);
const ShopOrderSchema = z.object({
  paymentIntentId: z.string(),
  promoCode: z.string().optional().nullable(),
  customerName: z.string().min(1),
  customerEmail: z.string().email(),
  customerPhone: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  deliveryAddress: z.object({
    line1: z.string(),
    line2: z.string().optional().nullable(),
    city: z.string(),
    postcode: z.string(),
    country: z.string().default("GB"),
  }),
  cartItems: z.array(z.object({
    wcProductId: z.number(),
    variationId: z.number().optional().nullable(),
    name: z.string(),
    sku: z.string().optional().nullable(),
    price: z.number(),
    vatRate: z.number().min(0).max(1).optional(),
    quantity: z.number().int().positive(),
    colour: z.string().optional().nullable(),
    size: z.string().optional().nullable(),
    image: z.string().optional().nullable(),
    brandingPositions: z.array(z.object({
      id: z.string(),
      name: z.string(),
      surcharge: z.number(),
      notes: z.string().optional().nullable(),
    })).optional().nullable(),
    wearerName: z.string().optional().nullable(),
    bundleComponents: z.array(z.object({
      name: z.string(),
      qty: z.number().int().positive(),
      colour: z.string().optional().nullable(),
      size: z.string().optional().nullable(),
      sleeve: z.string().optional().nullable(),
      variationId: z.number().optional().nullable(),
      brandingPositions: z.array(z.object({
        id: z.string(), name: z.string(), surcharge: z.number(), notes: z.string().optional().nullable(),
      })).optional().nullable(),
    })).optional().nullable(),
  })),
  subtotal: z.number(),
  carriage: z.number().default(8.5),
  total: z.number(),
  shippingMethod: z.enum(["courier", "free_local", "warehouse_collection", "office_collection"]).default("courier"),
  shopCustomerId: z.number().int().optional().nullable(),
  logoUpload: z.object({ name: z.string(), url: z.string() }).nullable().optional(),
  logoSource: z.enum(["upload", "on_file"]).nullable().optional(),
  analyticsContext: z.object({
    visitorId: z.string().uuid(),
    sessionId: z.string().uuid(),
    firstTouch: z.object({ landingPath: z.string().max(500), referrerDomain: z.string().max(120).optional(), referrerPath: z.string().max(500).optional(), utmSource: z.string().max(80).optional(), utmMedium: z.string().max(40).optional(), utmCampaign: z.string().max(120).optional(), utmContent: z.string().max(120).optional(), utmTerm: z.string().max(80).optional(), channel: AnalyticsChannel, deviceCategory: z.enum(["mobile","tablet","desktop","unknown"]) }).strict(),
    lastTouch: z.object({ landingPath: z.string().max(500), referrerDomain: z.string().max(120).optional(), referrerPath: z.string().max(500).optional(), utmSource: z.string().max(80).optional(), utmMedium: z.string().max(40).optional(), utmCampaign: z.string().max(120).optional(), utmContent: z.string().max(120).optional(), utmTerm: z.string().max(80).optional(), channel: AnalyticsChannel, deviceCategory: z.enum(["mobile","tablet","desktop","unknown"]) }).strict(),
  }).strict().nullable().optional(),
});

const AnalyticsEvent = z.object({
  eventId: z.string().uuid(), eventType: AnalyticsType, occurredAt: z.string().datetime({ offset: true }),
  path: z.string().max(500), landingPath: z.string().max(500), referrerDomain: z.string().max(120).optional(),
  referrerPath: z.string().max(500).optional(), utmSource: z.string().max(80).optional(), utmMedium: z.string().max(40).optional(),
  utmCampaign: z.string().max(120).optional(), utmContent: z.string().max(120).optional(), utmTerm: z.string().max(80).optional(),
  channel: AnalyticsChannel, deviceCategory: z.enum(["mobile","tablet","desktop","unknown"]),
  productId: z.string().max(120).optional(), categoryId: z.string().max(80).optional(),
  searchTerm: z.string().max(80).optional(), quantity: z.number().int().min(0).max(100000).optional(),
  value: z.number().finite().min(-1000000).max(1000000).optional(),
}).strict();
const AnalyticsBody = z.object({
  visitorId: z.string().uuid(), sessionId: z.string().uuid(), events: z.array(AnalyticsEvent).min(1).max(50),
}).strict();

router.post("/shop/analytics/events", async (req, res): Promise<void> => {
  if (/bot|crawler|spider|headless|slurp/i.test(req.get("user-agent") ?? "")) { res.status(204).end(); return; }
  const parsed = AnalyticsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid analytics payload" }); return; }
  const d = parsed.data; const now = Date.now();
  try {
    const first = d.events[0];
    const ingestibleEvents = d.events.filter((event) => event.eventType !== "ORDER_COMPLETED");
    await db.execute(sql`INSERT INTO analytics_sessions
      (visitor_id,session_id,first_touch,first_path,referrer_domain,utm_source,utm_medium,utm_campaign,utm_content,utm_term,channel,device_category)
      VALUES (${d.visitorId}::uuid,${d.sessionId}::uuid,${first.channel},${first.landingPath},${first.referrerDomain ?? null},
        ${first.utmSource ?? null},${first.utmMedium ?? null},${first.utmCampaign ?? null},${first.utmContent ?? null},${first.utmTerm ?? null},${first.channel},${first.deviceCategory})
      ON CONFLICT (session_id) DO UPDATE SET last_seen_at=now()`);
    let accepted = 0;
    for (const e of ingestibleEvents) {
      const when = new Date(e.occurredAt).getTime();
      const occurred = Math.abs(when - now) > 86400000 ? new Date() : new Date(when);
      const inserted = await db.execute(sql`INSERT INTO analytics_events
        (event_id,visitor_id,session_id,event_type,occurred_at,path,product_id,category_id,channel,landing_path,referrer_domain,utm_source,utm_medium,utm_campaign,utm_content,utm_term,device_category,search_term,quantity,value)
        VALUES (${e.eventId}::uuid,${d.visitorId}::uuid,${d.sessionId}::uuid,${e.eventType},${occurred},${e.path},${e.productId ?? null},${e.categoryId ?? null},${e.channel},${e.landingPath},${e.referrerDomain ?? null},${e.utmSource ?? null},${e.utmMedium ?? null},${e.utmCampaign ?? null},${e.utmContent ?? null},${e.utmTerm ?? null},${e.deviceCategory},${e.searchTerm ?? null},${e.quantity ?? null},${e.value ?? null})
            ON CONFLICT (event_id) DO NOTHING RETURNING event_id`);
      accepted += inserted.rows.length;
    }
    res.status(202).json({ accepted, duplicates: d.events.length - accepted, ignored: d.events.length - ingestibleEvents.length });
  } catch (e) { logger.warn({ err: e }, "[analytics] ingestion failed"); res.status(202).json({ accepted: 0, duplicates: 0, error: "Events could not be stored" }); }
});

router.post("/shop/orders", async (req, res): Promise<void> => {
  const parsed = ShopOrderSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;
  let validated: Awaited<ReturnType<typeof validateShopBasket>>;
  let checkoutSnapshot: any;
  let savedAmountPence = 0;
  let paymentConfirmed = false;
  try {
    const saved = await db.execute(sql`
      SELECT original_cart_fingerprint, amount_pence, snapshot
      FROM shop_checkout_intents
      WHERE payment_intent_id = ${d.paymentIntentId}
      LIMIT 1
    `);
    const row = saved.rows[0] as any;
    if (!row) {
      res.status(400).json({ error: "No server-priced checkout snapshot exists for this payment." });
      return;
    }
    checkoutSnapshot = typeof row.snapshot === "string" ? JSON.parse(row.snapshot) : row.snapshot;
    savedAmountPence = Number(row.amount_pence);
    const submittedCartFingerprint = originalShopCartFingerprint(d.cartItems);
    if (row.original_cart_fingerprint !== submittedCartFingerprint ||
      checkoutSnapshot.originalCartFingerprint !== submittedCartFingerprint ||
      !sameLegacyShopBasket(checkoutSnapshot.originalCart, d.cartItems)) {
      res.status(400).json({ error: "Submitted product selections do not match the original paid basket." });
      return;
    }
    if (checkoutSnapshot.shippingMethod !== d.shippingMethod ||
      Math.abs(Number(d.carriage) - Number(checkoutSnapshot.totals.shipping)) > 0.011 ||
      Math.abs(Number(d.subtotal) - Number(checkoutSnapshot.totals.subtotal)) > 0.011 ||
      Math.abs(Number(d.total) - Number(checkoutSnapshot.totals.total)) > 0.011) {
      res.status(400).json({ error: "Submitted checkout terms do not match the saved payment snapshot." });
      return;
    }
    validated = {
      items: checkoutSnapshot.pricedItems,
      totals: checkoutSnapshot.totals,
      fingerprint: String(checkoutSnapshot.basketFingerprint ?? ""),
    };
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Saved checkout snapshot could not be read." });
    return;
  }

  try {
    if (d.promoCode) {
      res.status(400).json({ applied: false, error: "Promotions are not configured for this installation.", reason: "promotion_not_configured" });
      return;
    }
    const shippingAmount = Number(checkoutSnapshot.totals.shipping);
    if (Math.abs(d.carriage - shippingAmount) > 0.011) {
      res.status(400).json({ error: "Submitted carriage does not match the shipping method." });
      return;
    }
    if (Math.abs(validated.totals.subtotal - d.subtotal) > 0.011 ||
      Math.abs(validated.totals.total - d.total) > 0.011) {
      res.status(400).json({ error: "Submitted totals do not match the authoritative basket." });
      return;
    }

    const stripe = await getUncachableStripeClient();
    const intent = await stripe.paymentIntents.retrieve(d.paymentIntentId);
    const amountPence = Number(checkoutSnapshot.amountPence);
    const expectedBasketFingerprint = shopBasketFingerprint(
      validated.items,
      checkoutSnapshot.shippingMethod,
      shippingAmount,
    );
    const originalCartFingerprint = originalShopCartFingerprint(d.cartItems);
    if (intent.metadata.source !== "shop" || intent.currency !== "gbp" ||
      intent.id !== d.paymentIntentId ||
      intent.metadata.basket_hash !== expectedBasketFingerprint ||
      intent.metadata.original_cart_hash !== originalCartFingerprint ||
      intent.metadata.basket_shipping_method !== checkoutSnapshot.shippingMethod ||
      Number(intent.metadata.basket_total_pence) !== amountPence ||
      Number(intent.amount) !== amountPence ||
      savedAmountPence !== amountPence) {
      res.status(400).json({ error: "Stripe payment details do not match the saved checkout snapshot." });
      return;
    }
    if (intent.status !== "succeeded") {
      res.status(400).json({ error: `Payment not confirmed (status: ${intent.status})` });
      return;
    }
    const shippingTerms = verifyShopShippingTerms(
      intent.metadata as Record<string, string>,
      d.shippingMethod,
      d.deliveryAddress.postcode,
    );
    if (!shippingTerms ||
      shippingTerms.method !== checkoutSnapshot.shippingTerms?.method ||
      shippingTerms.destination !== checkoutSnapshot.shippingTerms?.destination ||
      shippingTerms.postcode !== checkoutSnapshot.shippingTerms?.postcode ||
      shippingTerms.fingerprint !== checkoutSnapshot.shippingTerms?.fingerprint ||
      intent.metadata.shipping_fingerprint !== checkoutSnapshot.shippingTerms.fingerprint) {
      res.status(400).json({ error: "This payment is not bound to the submitted shipping method and destination." });
      return;
    }
    paymentConfirmed = true;

    // Link the website submission to an existing customer account when the
    // supplied company or email is an exact match. Staff can assign unmatched
    // guest orders from the website-review queue before confirming them.
    const company = d.company?.trim() || null;
    let customerId: number | null = null;
    let accountName: string | null = null;
    if (company) {
      const customerRows = await db.execute(sql`
        SELECT id, name FROM customers
        WHERE lower(regexp_replace(trim(name), '[[:space:]]+', ' ', 'g')) =
              lower(regexp_replace(trim(${company}), '[[:space:]]+', ' ', 'g'))
        LIMIT 1
      `);
      const matched = customerRows.rows[0] as any;
      customerId = matched?.id ?? null;
      accountName = matched?.name ?? null;
    }
    if (!customerId) {
      const customerRows = await db.execute(sql`
        SELECT id, name FROM customers
        WHERE email IS NOT NULL AND lower(trim(email)) = lower(trim(${d.customerEmail}))
        LIMIT 1
      `);
      const matched = customerRows.rows[0] as any;
      customerId = matched?.id ?? null;
      accountName = matched?.name ?? null;
    }

    const logoSource = d.logoSource ?? (d.logoUpload ? "upload" : null);
    let orderLogo = d.logoUpload ?? null;
    if (logoSource === "on_file") {
      // Existing artwork is held in a separate logo system. Record the request
      // for staff without trying to resolve a file or requiring shop sign-in.
      orderLogo = null;
    }

    // Insert order
    const logoNote = logoSource === "on_file"
      ? " | Logo: Use existing logo held on separate artwork system"
      : orderLogo
        ? ` | Logo: ${orderLogo.name} (${orderLogo.url})`
        : "";
    const isCollection = d.shippingMethod === "warehouse_collection" || d.shippingMethod === "office_collection";
    const orderDestination = isCollection
      ? shippingTerms.destination
      : [
          d.deliveryAddress.line1,
          d.deliveryAddress.line2,
          d.deliveryAddress.city,
          d.deliveryAddress.postcode,
        ].filter(Boolean).join(", ");
    // Lock on the Stripe payment ID so simultaneous retries cannot create two
    // website orders. Keep all required order writes in one transaction: a paid
    // checkout must never leave an incomplete order that looks like a failure.
    const { orderId, alreadyRecorded } = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${d.paymentIntentId}))`);
    const lockedSnapshot = await tx.execute(sql`
      SELECT status, order_id FROM shop_checkout_intents
      WHERE payment_intent_id = ${d.paymentIntentId}
      FOR UPDATE
    `);
    if (!lockedSnapshot.rows.length) throw new Error("Paid checkout snapshot is missing; this payment needs staff review.");
    const linkedOrderId = Number((lockedSnapshot.rows[0] as any).order_id ?? 0);
    const existing = linkedOrderId > 0
      ? await tx.execute(sql`SELECT id, status FROM orders WHERE id = ${linkedOrderId} AND source = 'shop' LIMIT 1`)
      : await tx.execute(sql`
          SELECT id, status FROM orders
          WHERE source = 'shop'
            AND substring(notes from 'Payment: (pi_[[:alnum:]]+)') = ${d.paymentIntentId}
          ORDER BY id LIMIT 1
        `);
    if (linkedOrderId > 0 && !existing.rows.length) {
      throw new Error("A recorded paid order is missing and needs staff review. Do not pay again.");
    }
    if (existing.rows.length) {
      const prior = existing.rows[0] as any;
      const id = Number(prior.id);
      if (prior.status === "cancelled") throw new Error("This paid order was cancelled and needs staff review. Do not pay again.");
      const items = await tx.execute(sql`SELECT 1 FROM order_items WHERE order_id = ${id} LIMIT 1`);
      if (!items.rows.length) throw new Error("Paid order needs staff review before it can be completed.");
      await tx.execute(sql`
        UPDATE shop_checkout_intents
        SET status = 'finalized', order_id = ${id}, finalized_at = COALESCE(finalized_at, now())
        WHERE payment_intent_id = ${d.paymentIntentId}
      `);
      return { orderId: id, alreadyRecorded: true };
    }
    const orderResult = await tx.execute(sql`
      INSERT INTO orders (
        order_number, customer_id, customer_name, status, portal_status,
        total_amount, carriage_amount, shipping_method, source, notes, order_date,
        shop_customer_id, portal_submitted_by_email, portal_submitted_by_name,
        portal_submitted_at, created_at, updated_at
      ) VALUES (
        ${`W-${crypto.randomUUID()}`},
        ${customerId},
        ${accountName ?? company ?? d.customerName},
        'website_pending',
        'submitted',
        ${String(validated.totals.total)},
        ${String(shippingAmount)},
        ${d.shippingMethod},
        'shop',
        ${`Online order — ${d.customerEmail}${d.company ? ` (${d.company})` : ""}. Shipping: ${SHIPPING_LABELS[d.shippingMethod]}. Destination: ${orderDestination}. Payment: ${d.paymentIntentId}${logoNote}`},
        NOW(), ${d.shopCustomerId ?? null}, ${d.customerEmail}, ${d.customerName},
        NOW(), NOW(), NOW()
      ) RETURNING id
    `);
    const orderId = Number((orderResult.rows[0] as any)?.id);
    const orderNumber = `W${orderId}`;
    await tx.execute(sql`UPDATE orders SET order_number = ${orderNumber} WHERE id = ${orderId}`);

    // Insert order items
    for (const item of validated.items) {
      const paidQty = item.quantity;
      const productId = item.wcProductId;
      const effectiveVatRate = item.vatRate;
      const productExistsRows = await tx.execute(sql`SELECT id FROM products WHERE id = ${productId} LIMIT 1`);
      const storedProductId = productExistsRows.rows.length ? productId : null;
      const needsCatalogReview = storedProductId === null;

      // Populate a known wardrobe finish immediately so staff can see it while
      // reviewing the paid order. Confirmation performs the stricter exact
      // wardrobe validation and blocks unresolved/no-longer-matching lines.
      let finishId: number | null = null;
      let finishName: string | null = null;
      if (customerId && productId) {
        const wardrobeMatchRows = await tx.execute(sql`
          SELECT cfi.finish_id, cf.name AS finish_name
          FROM customer_finished_items cfi
          LEFT JOIN customer_finishes cf ON cf.id = cfi.finish_id
          WHERE cfi.customer_id = ${customerId}
            AND cfi.product_id = ${productId}
            AND lower(trim(coalesce(cfi.colour, ''))) = lower(trim(coalesce(${item.colour ?? null}, '')))
            AND lower(trim(coalesce(cfi.size, ''))) = lower(trim(coalesce(${item.size ?? null}, '')))
          ORDER BY cfi.id
          LIMIT 1
        `);
        const wardrobeMatch = wardrobeMatchRows.rows[0] as any;
        finishId = wardrobeMatch?.finish_id ?? null;
        finishName = wardrobeMatch?.finish_name ?? null;
      }

      if (paidQty > 0) await tx.execute(sql`
        INSERT INTO order_items (
          order_id, product_id, product_name, quantity, unit_price, line_total,
          colour, size, finish_id, finish_name, notes, recipient_name, vat_rate
        )
        VALUES (
          ${orderId},
          ${storedProductId},
          ${item.name},
           ${paidQty},
          ${String(item.price)},
           ${String(item.price * paidQty)},
          ${item.colour ?? null},
          ${item.size ?? null},
          ${finishId},
          ${finishName},
          ${[
            item.sku ? `SKU: ${item.sku}` : null,
            item.brandingPositions?.length
              ? `Branding: ${item.brandingPositions.map((p) => p.name + (p.surcharge > 0 ? ` (+£${p.surcharge.toFixed(2)})` : '')).join(', ')}`
              : null,
            needsCatalogReview ? "Paid item is no longer in the local catalogue; staff review required" : null,
          ].filter(Boolean).join(' | ') || null},
          ${item.wearerName?.trim() || null},
          ${String(effectiveVatRate)}
        )
      `);
      if (item.bundleComponents?.length) {
        for (const component of item.bundleComponents) {
          const componentExists = await tx.execute(sql`
            SELECT id FROM products WHERE id = ${component.productId ?? null} LIMIT 1
          `);
          const storedComponentId = componentExists.rows.length ? Number(component.productId) : null;
          const selectedBranding = component.brandingPositions?.length
            ? ` Selected branding: ${component.brandingPositions.map((position) => position.name).join(", ")}.`
            : "";
          const sleeve = component.sleeve ? ` Sleeve/length: ${component.sleeve}.` : "";
          await tx.execute(sql`
            INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, line_total, colour, size, notes, recipient_name, vat_rate)
          VALUES (${orderId}, ${storedComponentId}, ${component.name}, ${component.qty * item.quantity}, 0, 0,
              ${component.colour ?? null}, ${component.size ?? null},
              ${`Bundle component for ${item.name}.${sleeve}${selectedBranding}${storedComponentId === null ? " Paid component is no longer in the local catalogue; staff review required." : ""}`}, ${item.wearerName?.trim() || null},
              '0.2000')
          `);
        }
      }
    }

    await tx.execute(sql`
      INSERT INTO order_logs (order_id, action, actor, details, created_at)
      VALUES (
        ${orderId},
        'Website order received',
        'Website shop',
        ${(customerId
          ? `Paid website checkout received and linked to ${accountName}. Awaiting staff confirmation.`
          : `Paid website checkout received without a matching customer account. Awaiting account assignment and staff confirmation.`)},
        now()
      )
    `);
    await tx.execute(sql`
      UPDATE shop_checkout_intents
      SET status = 'finalized', order_id = ${orderId}, finalized_at = now()
      WHERE payment_intent_id = ${d.paymentIntentId}
    `);
    return { orderId, alreadyRecorded: false };
    });
    const orderNumber = `W${orderId}`;
    if (alreadyRecorded) {
      res.json({ success: true, orderNumber, orderId });
      return;
    }
    // Attribution is strictly best-effort and written only after the paid order exists.
    if (d.analyticsContext) {
      try {
        const a = d.analyticsContext;
        const prior = await db.execute(sql`SELECT 1 FROM orders WHERE id <> ${orderId}
          AND (customer_id = ${customerId} OR shop_customer_id = ${d.shopCustomerId ?? null}) LIMIT 1`);
        const eventId = `00000000-0000-5000-8000-${String(orderId).padStart(12, "0")}`;
        await db.execute(sql`INSERT INTO order_attribution
           (order_id,visitor_id,session_id,first_touch,last_touch,first_landing_path,last_landing_path,first_channel,last_channel,repeat_order,revenue,
            first_referrer_domain,last_referrer_domain,first_utm_source,first_utm_medium,first_utm_campaign,first_utm_content,first_utm_term,
            last_utm_source,last_utm_medium,last_utm_campaign,last_utm_content,last_utm_term)
          VALUES (${orderId},${a.visitorId}::uuid,${a.sessionId}::uuid,${a.firstTouch.channel},${a.lastTouch.channel},
            ${a.firstTouch.landingPath},${a.lastTouch.landingPath},${a.firstTouch.channel},${a.lastTouch.channel},
              ${prior.rows.length > 0},${validated.totals.total},
             ${a.firstTouch.referrerDomain ?? null},${a.lastTouch.referrerDomain ?? null},
             ${a.firstTouch.utmSource ?? null},${a.firstTouch.utmMedium ?? null},${a.firstTouch.utmCampaign ?? null},${a.firstTouch.utmContent ?? null},${a.firstTouch.utmTerm ?? null},
             ${a.lastTouch.utmSource ?? null},${a.lastTouch.utmMedium ?? null},${a.lastTouch.utmCampaign ?? null},${a.lastTouch.utmContent ?? null},${a.lastTouch.utmTerm ?? null})
             ON CONFLICT (order_id) DO NOTHING`);
        await db.execute(sql`INSERT INTO analytics_events
          (event_id,visitor_id,session_id,event_type,occurred_at,path,landing_path,channel,device_category,value)
           VALUES (${eventId}::uuid,${a.visitorId}::uuid,${a.sessionId}::uuid,'ORDER_COMPLETED',now(),
             ${a.lastTouch.landingPath},${a.lastTouch.landingPath},${a.lastTouch.channel},${a.lastTouch.deviceCategory},${validated.totals.total})
          ON CONFLICT (event_id) DO NOTHING`);
      } catch (e) { logger.warn({ err: e }, "[analytics] order attribution failed"); }
    }

    // Send confirmation email
    const settings = await getAllSettings();
    const logoUrl = settings["logo_url"] ?? settings["shop_logo_url"] ?? null;
    try {
      const addr = d.deliveryAddress;
      const addressLines = [
        addr.line1,
        addr.line2 || null,
        addr.city,
        addr.postcode,
        addr.country !== "GB" ? addr.country : null,
      ].filter(Boolean) as string[];
      const shippingLabel = SHIPPING_LABELS[d.shippingMethod];
      const collectionDetails = isCollection
        ? {
            title: SHIPPING_LABELS[d.shippingMethod],
            address: [shippingTerms.destination],
          }
        : null;
      const destinationLabel = collectionDetails ? "Collection Location" : "Delivery Address";
      const destinationLines = collectionDetails?.address ?? addressLines;

      const itemRowsText = validated.items
        .map((i) => {
          const variant = [i.colour, i.size].filter(Boolean).join(", ");
          return `  ${i.name}${variant ? ` (${variant})` : ""} ×${i.quantity} — £${(i.price * i.quantity).toFixed(2)}`;
        })
        .join("\n");

      const itemRowsHtml = validated.items
        .map((i) => {
          const variant = [i.colour, i.size].filter(Boolean).join(", ");
          const branding = i.brandingPositions?.length
            ? `<br/><span style="color:#6b7280;font-size:12px;">Branding: ${i.brandingPositions.map((p) => p.name).join(", ")}</span>`
            : "";
          const wearer = i.wearerName?.trim()
            ? `<br/><span style="color:#6b7280;font-size:12px;">For: ${i.wearerName.trim()}</span>`
            : "";
          return `
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;">
                ${i.name}${variant ? `<br/><span style="color:#6b7280;font-size:12px;">${variant}</span>` : ""}${branding}${wearer}
              </td>
              <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:center;color:#374151;">×${i.quantity}</td>
              <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:right;color:#111827;font-weight:500;">£${(i.price * i.quantity).toFixed(2)}</td>
            </tr>`;
        })
        .join("");

      const accountNote = d.shopCustomerId
        ? `<p style="margin:0 0 12px;color:#374151;">You can view your order history at any time by <a href="/account" style="color:#1e3a5f;font-weight:600;">signing in to your account</a>.</p>`
        : "";

      const accountNoteText = d.shopCustomerId
        ? `\nYou can view your order at: /account\n`
        : "";

      const carriageText = shippingAmount > 0
        ? `\n  ${shippingLabel}: £${shippingAmount.toFixed(2)}`
        : `\n  ${shippingLabel}: FREE`;
      const carriageHtml = `<tr>
        <td style="padding:8px 0;color:#6b7280;" colspan="2">${shippingLabel}</td>
        <td style="padding:8px 0;text-align:right;color:#374151;">${shippingAmount > 0 ? `£${shippingAmount.toFixed(2)}` : "FREE"}</td>
      </tr>`;

      await sendEmail({
        to: d.customerEmail,
        subject: `Order Received — ${orderNumber}`,
        text: [
          `Hi ${d.customerName},`,
          "",
          `Thank you for your order! Your order reference is ${orderNumber}.`,
          "",
          "ORDER SUMMARY",
          "─────────────",
          itemRowsText,
          carriageText ? `  ${carriageText.trim()}` : "",
          `  Total: £${validated.totals.total.toFixed(2)}`,
          "",
           `${destinationLabel.toUpperCase()}`,
          "─────────────────",
           ...destinationLines,
          accountNoteText,
           collectionDetails
             ? "We'll let you know when your order is ready for collection."
             : "We'll be in touch to confirm your delivery details.",
          "",
           "Thank you for your order.",
        ].filter((l) => l !== undefined).join("\n"),
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:0;background:#f9fafb;">
            <!-- Header -->
            <div style="background:#1e3a5f;padding:28px 32px;border-radius:8px 8px 0 0;">
              <img src="${escapeHtml(logoUrl)}" alt="Shop" style="height:44px;display:block;" />
            </div>
            <!-- Body -->
            <div style="background:#ffffff;padding:32px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">
              <h2 style="color:#1e3a5f;margin:0 0 8px;font-size:22px;">Order Received</h2>
              <p style="color:#6b7280;margin:0 0 24px;font-size:14px;">Reference: <strong style="color:#111827;">${orderNumber}</strong></p>
              <p style="margin:0 0 20px;color:#374151;">Hi ${d.customerName},<br/>Thank you for your order — we've received it and will be in touch to confirm your delivery details.</p>

              <!-- Items table -->
              <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
                <thead>
                  <tr>
                    <th style="text-align:left;padding-bottom:8px;color:#6b7280;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #e5e7eb;">Item</th>
                    <th style="text-align:center;padding-bottom:8px;color:#6b7280;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #e5e7eb;">Qty</th>
                    <th style="text-align:right;padding-bottom:8px;color:#6b7280;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #e5e7eb;">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemRowsHtml}
                </tbody>
                <tfoot>
                  ${carriageHtml}
                  <tr>
                    <td colspan="2" style="padding:12px 0 0;font-weight:700;color:#111827;font-size:16px;">Total</td>
                    <td style="padding:12px 0 0;text-align:right;font-weight:700;color:#1e3a5f;font-size:16px;">£${validated.totals.total.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>

               <!-- Delivery or collection destination -->
              <div style="background:#f3f4f6;border-radius:6px;padding:16px;margin:24px 0;">
                 <p style="margin:0 0 6px;font-weight:600;color:#111827;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;">${destinationLabel}</p>
                 <p style="margin:0;color:#374151;line-height:1.6;">${destinationLines.join("<br/>")}</p>
              </div>

              ${accountNote}
               <p style="margin:0;color:#374151;">${collectionDetails ? "We'll let you know when your order is ready for collection." : "If you have any questions, please reply to this email and we'll be happy to help."}</p>
            </div>
            <!-- Footer -->
            <div style="background:#f3f4f6;padding:20px 32px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;text-align:center;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">Order confirmation</p>
            </div>
          </div>
        `,
      });
    } catch (e) {
      logger.warn({ err: e }, "[shop/orders] Failed to send confirmation email");
    }

    // Notify business
    const notifyEmail = settings["contact_email"] ?? settings["email"];
    if (notifyEmail) {
      try {
        await sendEmail({
          to: notifyEmail,
          subject: `New Shop Order — ${orderNumber} — ${d.customerName}`,
           text: `New order received.\n\nRef: ${orderNumber}\nCustomer: ${d.customerName} (${d.customerEmail})\n${d.company ? `Company: ${d.company}\n` : ""}Shipping: ${SHIPPING_LABELS[d.shippingMethod]}\nDestination: ${orderDestination}\nTotal: £${validated.totals.total.toFixed(2)}${logoSource === "on_file" ? "\nLogo: Use existing logo held on separate artwork system" : orderLogo ? `\nLogo: ${orderLogo.name} (${orderLogo.url})` : ""}\n\nItems:\n${validated.items.map((i) => `  ${i.name} ×${i.quantity} = £${(i.price * i.quantity).toFixed(2)}`).join("\n")}`,
            html: `<p><strong>Ref:</strong> ${orderNumber}</p><p><strong>Customer:</strong> ${d.customerName} (${d.customerEmail})</p>${d.company ? `<p><strong>Company:</strong> ${d.company}</p>` : ""}<p><strong>Shipping:</strong> ${SHIPPING_LABELS[d.shippingMethod]}</p><p><strong>Destination:</strong> ${orderDestination}</p><p><strong>Total:</strong> £${validated.totals.total.toFixed(2)}</p>${logoSource === "on_file" ? "<p><strong>Logo:</strong> Use existing logo held on separate artwork system</p>" : orderLogo ? `<p><strong>Logo:</strong> ${orderLogo.name} (${orderLogo.url})</p>` : ""}<ul>${validated.items.map((i) => `<li>${i.name} ×${i.quantity} @ £${i.price.toFixed(2)} = £${(i.price * i.quantity).toFixed(2)}</li>`).join("")}</ul>`,
        });
      } catch (e) {
        logger.warn({ err: e }, "[shop/orders] Failed to send business notification email");
      }
    }

    res.json({ success: true, orderNumber, orderId });
  } catch (e: any) {
    logger.error({ err: e }, "[shop/orders] Failed to create order");
    res.status(500).json({
      error: paymentConfirmed
        ? "Payment succeeded, but the order could not be recorded. Do not pay again; retry order submission with this same payment reference or contact support."
        : e.message,
      paidButNotRecorded: paymentConfirmed,
      retryWithSamePaymentIntent: paymentConfirmed,
    });
  }
});

// Prepare a paid website submission for staff review. This is also the repair
// path for website orders created before the W-number/customer-link workflow.
router.post("/shop/admin/orders/:id/prepare", async (req, res): Promise<void> => {
  const orderId = Number(req.params.id);
  const parsed = z.object({ customerId: z.number().int().positive() }).safeParse(req.body);
  if (!Number.isInteger(orderId) || !parsed.success) {
    res.status(400).json({ error: "A valid order and customer account are required." });
    return;
  }

  const customerRows = await db.execute(sql`
    SELECT id, name FROM customers WHERE id = ${parsed.data.customerId} LIMIT 1
  `);
  const customer = customerRows.rows[0] as any;
  if (!customer) {
    res.status(404).json({ error: "Customer account not found." });
    return;
  }

  const orderRows = await db.execute(sql`
    SELECT id FROM orders
    WHERE id = ${orderId}
      AND source = 'shop'
      AND status IN ('processing', 'website_pending')
    LIMIT 1
  `);
  if (!orderRows.rows.length) {
    res.status(404).json({ error: "Website order not found or already confirmed." });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE orders
      SET order_number = ${`W${orderId}`},
          customer_id = ${customer.id},
          customer_name = ${customer.name},
          status = 'website_pending',
          portal_status = 'submitted',
          updated_at = now()
      WHERE id = ${orderId}
    `);

    await tx.execute(sql`
      UPDATE order_items
      SET product_id = (
        SELECT p.id
        FROM products p
        WHERE lower(trim(p.sku)) =
              lower(trim(substring(order_items.notes from 'SKU:[[:space:]]*([^|]+)')))
        LIMIT 1
      )
      WHERE order_id = ${orderId}
        AND product_id IS NULL
        AND notes ~* 'SKU:[[:space:]]*[^|]+'
        AND EXISTS (
          SELECT 1
          FROM products p
          WHERE lower(trim(p.sku)) =
                lower(trim(substring(order_items.notes from 'SKU:[[:space:]]*([^|]+)')))
        )
    `);

    await tx.execute(sql`
      INSERT INTO order_logs (order_id, action, actor, details, created_at)
      VALUES (
        ${orderId}, 'Website order prepared', 'Staff',
        ${`Linked to ${customer.name}; website reference and catalogue product links checked.`},
        now()
      )
    `);
  });

  res.json({ ok: true, orderNumber: `W${orderId}`, customerId: customer.id, customerName: customer.name });
});

// Create a customer account from the Woo/shop profile attached to an
// unmatched paid website order, then link and prepare that order in one
// transaction so staff cannot end up with a created-but-unlinked account.
router.post("/shop/admin/orders/:id/create-customer", async (req, res): Promise<void> => {
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    res.status(400).json({ error: "A valid website order is required." });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const orderRows = await tx.execute(sql`
        SELECT
          o.id, o.order_number, o.customer_id, o.customer_name,
          o.portal_submitted_by_email, o.portal_submitted_by_name,
          sc.email, sc.first_name, sc.last_name, sc.company, sc.phone,
          sc.address_1, sc.address_2, sc.city, sc.county, sc.postcode, sc.country
        FROM orders o
        LEFT JOIN shop_customers sc ON sc.id = o.shop_customer_id
        WHERE o.id = ${orderId}
          AND o.source = 'shop'
          AND o.status IN ('processing', 'website_pending')
        FOR UPDATE OF o
      `);
      const order = orderRows.rows[0] as any;
      if (!order) throw Object.assign(new Error("Website order not found or already confirmed."), { status: 404 });
      if (order.customer_id) throw Object.assign(new Error("This order is already linked to a customer account."), { status: 409 });

      const email = String(order.email ?? order.portal_submitted_by_email ?? "").trim() || null;
      const contactFirstName = String(order.first_name ?? "").trim() || null;
      const contactLastName = String(order.last_name ?? "").trim() || null;
      const submittedName = String(order.portal_submitted_by_name ?? "").trim();
      const accountName =
        String(order.company ?? "").trim()
        || String(order.customer_name ?? "").trim()
        || [contactFirstName, contactLastName].filter(Boolean).join(" ")
        || submittedName;

      if (!accountName) {
        throw Object.assign(new Error("The website order does not contain enough customer information to create an account."), { status: 400 });
      }

      const existingRows = await tx.execute(sql`
        SELECT id, name
        FROM customers
        WHERE (
          ${email}::text IS NOT NULL
          AND email IS NOT NULL
          AND lower(trim(email)) = lower(trim(${email}))
        ) OR (
          lower(regexp_replace(trim(name), '[[:space:]]+', ' ', 'g')) =
          lower(regexp_replace(trim(${accountName}), '[[:space:]]+', ' ', 'g'))
        )
        LIMIT 1
      `);
      const existing = existingRows.rows[0] as any;
      if (existing) {
        throw Object.assign(
          new Error(`A customer account already exists for these details (${existing.name}). Select it from the list instead.`),
          { status: 409 },
        );
      }

      const address = [order.address_1, order.address_2]
        .map((part: unknown) => String(part ?? "").trim())
        .filter(Boolean)
        .join(", ") || null;

      const customerRows = await tx.execute(sql`
        INSERT INTO customers (
          name, contact_first_name, contact_last_name, email, billing_email,
          phone, address, city, state, postcode, created_at, updated_at
        ) VALUES (
          ${accountName}, ${contactFirstName}, ${contactLastName}, ${email}, ${email},
          ${order.phone ?? null}, ${address}, ${order.city ?? null},
          ${order.county ?? null}, ${order.postcode ?? null}, now(), now()
        )
        RETURNING id, name
      `);
      const customer = customerRows.rows[0] as any;

      let deliveryAddressId: number | null = null;
      if (String(order.address_1 ?? "").trim()) {
        const addressRows = await tx.execute(sql`
          INSERT INTO customer_delivery_addresses (
            customer_id, label, line1, line2, city, postcode, country,
            is_default, created_at, updated_at
          ) VALUES (
            ${customer.id}, 'Website order address', ${order.address_1},
            ${order.address_2 ?? null}, ${order.city ?? null}, ${order.postcode ?? null},
            ${order.country ?? "GB"}, true, now(), now()
          )
          RETURNING id
        `);
        deliveryAddressId = Number((addressRows.rows[0] as any)?.id) || null;
      }

      await tx.execute(sql`
        UPDATE orders
        SET order_number = ${`W${orderId}`},
            customer_id = ${customer.id},
            customer_name = ${customer.name},
            delivery_address_id = ${deliveryAddressId},
            status = 'website_pending',
            portal_status = 'submitted',
            updated_at = now()
        WHERE id = ${orderId}
      `);

      await tx.execute(sql`
        UPDATE order_items
        SET product_id = (
          SELECT p.id
          FROM products p
          WHERE lower(trim(p.sku)) =
                lower(trim(substring(order_items.notes from 'SKU:[[:space:]]*([^|]+)')))
          LIMIT 1
        )
        WHERE order_id = ${orderId}
          AND product_id IS NULL
          AND notes ~* 'SKU:[[:space:]]*[^|]+'
          AND EXISTS (
            SELECT 1 FROM products p
            WHERE lower(trim(p.sku)) =
                  lower(trim(substring(order_items.notes from 'SKU:[[:space:]]*([^|]+)')))
          )
      `);

      await tx.execute(sql`
        INSERT INTO order_logs (order_id, action, actor, details, created_at)
        VALUES (
          ${orderId}, 'Website customer account created', 'Staff',
          ${`Created and linked customer account ${customer.name} from the stored website profile.`},
          now()
        )
      `);

      return { customerId: Number(customer.id), customerName: String(customer.name) };
    });

    res.status(201).json({ ok: true, orderNumber: `W${orderId}`, ...result });
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    if (status >= 500) logger.error({ err: error, orderId }, "[shop/admin] Failed to create customer from website order");
    res.status(status).json({ error: error?.message ?? "Could not create the customer account." });
  }
});

// ─── GET /shop/blog-posts ─────────────────────────────────────────────────────
// Fetches posts from the Trysoro RSS feed, parses them, and caches for 1 hour.
// URL is read from settings (key: rss_knowledge_centre_url) with a hardcoded
// fallback so the page works even before the setting is saved.

const RSS_KNOWLEDGE_CENTRE_URL_DEFAULT =
  process.env.KNOWLEDGE_RSS_URL ?? "";

let _blogPostsCache: { posts: any[]; ts: number } | null = null;
let _blogPostsRefreshing = false;
const BLOG_POSTS_TTL_MS = 60 * 60 * 1000; // 1 hour

async function hasShopBlogCapability(): Promise<boolean> {
  try {
    const rows = await db.execute(sql`
      SELECT key, value FROM settings
      WHERE key IN ('installation_activated', 'shop_blog_rss_enabled', 'integration_enabled')
    `);
    const settings = new Map<string, string | null>(
      ((rows.rows ?? rows) as Array<{ key: string; value: string | null }>).map((row) => [row.key, row.value]),
    );
    let integrations: unknown;
    try { integrations = JSON.parse(settings.get("integration_enabled") ?? "null"); } catch { return false; }
    return settings.get("installation_activated") === "true"
      && settings.get("shop_blog_rss_enabled") === "true"
      && !!integrations && typeof integrations === "object" && !Array.isArray(integrations)
      && (integrations as Record<string, unknown>).rss === true;
  } catch {
    // Missing setup state or capability is fail-closed.
    return false;
  }
}

/** Extract the text content between an XML tag's first opening and closing tag. */
function xmlText(xml: string, tag: string): string {
  const open = new RegExp(`<${tag}[^>]*>`, "i");
  const close = new RegExp(`</${tag}>`, "i");
  const m = open.exec(xml);
  if (!m) return "";
  const start = m.index + m[0].length;
  const end = close.exec(xml.slice(start));
  if (!end) return "";
  const raw = xml.slice(start, start + end.index);
  // Unwrap CDATA if present
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1].trim() : raw.trim();
}

/** Extract an attribute value from the first matching tag. */
function xmlAttr(xml: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["']`, "i");
  return re.exec(xml)?.[1] ?? "";
}

/** Strip HTML tags and decode common HTML entities. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "–")
    .replace(/&#8230;/g, "…")
    .replace(/&hellip;/g, "…")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Try several common RSS image patterns in priority order. */
function extractImage(itemXml: string): string | null {
  // 1. <media:content url="..."> or <media:thumbnail url="...">
  const media = xmlAttr(itemXml, "media:content", "url") ||
                xmlAttr(itemXml, "media:thumbnail", "url");
  if (media) return media;
  // 2. <enclosure url="..." type="image/...">
  const enc = /<enclosure[^>]+type=["']image\/[^"']*["'][^>]*url=["']([^"']+)["']/i.exec(itemXml)?.[1]
           ?? /<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']image\/[^"']*["']/i.exec(itemXml)?.[1];
  if (enc) return enc;
  // 3. First <img src="..."> inside description or content
  const img = /<img[^>]+src=["']([^"']+)["']/i.exec(itemXml)?.[1];
  if (img) return img;
  return null;
}

async function fetchAndCacheBlogPosts(): Promise<any[]> {
  if (!(await hasShopBlogCapability())) {
    throw new Error("Shop blog RSS is not enabled for this activated installation.");
  }
  // Read URL from settings, fall back to default
  let rssUrl = RSS_KNOWLEDGE_CENTRE_URL_DEFAULT;
  try {
    const rows = await db.execute(sql`SELECT value FROM settings WHERE key = 'rss_knowledge_centre_url'`);
    const val = (rows.rows as any[])[0]?.value;
    if (val && typeof val === "string" && val.startsWith("http")) rssUrl = val;
  } catch { /* settings table might not have this key yet */ }

  if (!rssUrl || !isPublicHttpsUrl(rssUrl)) {
    throw new Error("Knowledge Centre RSS URL must be configured as a public HTTPS URL.");
  }
  const rssRes = await fetch(rssUrl, { signal: AbortSignal.timeout(10000) });
  if (!rssRes.ok) throw new Error(`RSS fetch error ${rssRes.status}`);
  const xml = await rssRes.text();

  if (xml.trim().toLowerCase() === "feed is disabled") {
    throw new Error("RSS feed is disabled — enable it in Trysoro settings");
  }

  // Split into <item> blocks
  const itemMatches = [...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)];

  const posts = itemMatches.map((m, idx) => {
    const item = m[1];
    const title   = stripHtml(xmlText(item, "title"));
    const link    = stripHtml(xmlText(item, "link")) || xmlText(item, "guid");
    const content = xmlText(item, "content:encoded") || xmlText(item, "description");
    const desc    = xmlText(item, "description") || content;
    const excerpt = stripHtml(desc).slice(0, 280).trim() + (stripHtml(desc).length > 280 ? "…" : "");
    const pubDate = xmlText(item, "pubDate") || xmlText(item, "dc:date");
    const date    = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();
    const guid    = xmlText(item, "guid") || link;
    // Derive a numeric-ish id from the guid so the frontend key is stable
    const id = Math.abs([...guid].reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0));
    const slug    = link.split("/").filter(Boolean).pop() ?? String(idx);
    const featuredImageUrl = extractImage(item);
    return { id, title, excerpt, date, link, slug, featuredImageUrl, content };
  });

  logger.info(
    { total: posts.length, withImage: posts.filter(p => p.featuredImageUrl).length, rssUrl },
    "[shop/blog-posts] cached from RSS",
  );
  _blogPostsCache = { posts, ts: Date.now() };
  return posts;
}

let blogPostsPrewarmTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Explicitly opt in to the startup cache pre-warm after activation and enabling
 * the shop_blog_rss_enabled capability. Importing this route never starts it.
 */
export async function startShopBlogPostsPrewarm(): Promise<boolean> {
  if (blogPostsPrewarmTimer || !(await hasShopBlogCapability())) return false;
  blogPostsPrewarmTimer = setTimeout(() => {
    blogPostsPrewarmTimer = null;
    fetchAndCacheBlogPosts().catch(e =>
      logger.warn({ err: e?.message }, "[shop/blog-posts] startup pre-warm failed"),
    );
  }, 5000);
  return true;
}

/** Cancel a pending explicitly requested blog cache pre-warm. */
export function stopShopBlogPostsPrewarm(): void {
  if (blogPostsPrewarmTimer) clearTimeout(blogPostsPrewarmTimer);
  blogPostsPrewarmTimer = null;
}

/** Ensure posts are cached, returning them (waits if cold). */
async function getPostsCached(): Promise<any[]> {
  if (!(await hasShopBlogCapability())) {
    throw new Error("Shop blog RSS is not enabled for this activated installation.");
  }
  const isFresh = _blogPostsCache && Date.now() - _blogPostsCache.ts < BLOG_POSTS_TTL_MS;
  if (_blogPostsCache) {
    if (!isFresh && !_blogPostsRefreshing) {
      _blogPostsRefreshing = true;
      fetchAndCacheBlogPosts()
        .catch(e => logger.warn({ err: e?.message }, "[shop/blog-posts] background refresh failed"))
        .finally(() => { _blogPostsRefreshing = false; });
    }
    return _blogPostsCache.posts;
  }
  _blogPostsRefreshing = true;
  try {
    return await fetchAndCacheBlogPosts();
  } finally {
    _blogPostsRefreshing = false;
  }
}

router.get("/shop/blog-posts", async (_req: Request, res: Response) => {
  try {
    const posts = await getPostsCached();
    res.setHeader("Cache-Control", "public, max-age=900");
    // Strip full content from listing — only served on the detail endpoint
    res.json(posts.map(({ content: _c, ...rest }) => rest));
  } catch (e: any) {
    logger.warn({ err: e }, "[shop/blog-posts] Failed to fetch posts");
    res.status(502).json({ error: "Could not fetch blog posts" });
  }
});

router.get("/shop/blog-posts/:slug", async (req: Request, res: Response) => {
  try {
    const posts = await getPostsCached();
    const post = posts.find((p) => p.slug === req.params.slug);
    if (!post) { res.status(404).json({ error: "Article not found" }); return; }
    res.setHeader("Cache-Control", "public, max-age=900");
    res.json(post);
  } catch (e: any) {
    logger.warn({ err: e }, "[shop/blog-posts/:slug] Failed to fetch posts");
    res.status(502).json({ error: "Could not fetch article" });
  }
});

// ─── GET /shop/image-proxy ────────────────────────────────────────────────────
// Fetches an external image (e.g. WordPress staff photo) and serves it with
// a long cache TTL so the browser only hits the origin once per day.
const _imageProxyCache = new Map<string, { buf: Buffer; contentType: string; ts: number }>();
router.get("/shop/image-proxy", async (req: Request, res: Response): Promise<void> => {
  const url = req.query.url as string;
  if (!url || !isPublicHttpsUrl(url)) {
    res.status(400).json({ error: "Missing or invalid public HTTPS url param" });
    return;
  }
  try {
    await assertOutboundIntegrationEnabled("wordpress");
    const wordpressBaseUrl = process.env.WORDPRESS_BASE_URL;
    if (!wordpressBaseUrl || !isPublicHttpsUrl(wordpressBaseUrl)
      || new URL(url).hostname.toLowerCase() !== new URL(wordpressBaseUrl).hostname.toLowerCase()) {
      res.status(403).json({ error: "Image host is not the configured WordPress host." });
      return;
    }
    const cached = _imageProxyCache.get(url);
    const TTL = 24 * 60 * 60 * 1000; // 24 h in-memory cache
    if (cached && Date.now() - cached.ts < TTL) {
      res.set("Content-Type", cached.contentType);
      res.set("Cache-Control", "public, max-age=86400");
      res.send(cached.buf);
      return;
    }
    const upstream = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "Referer": process.env.WORDPRESS_BASE_URL ?? "" },
    });
    if (!upstream.ok) {
      res.status(502).json({ error: `Upstream returned ${upstream.status}` });
      return;
    }
    const contentType = upstream.headers.get("content-type") ?? "";
    // Reject hotlink-block HTML pages masquerading as images
    if (!contentType.startsWith("image/") && !contentType.startsWith("application/octet-stream")) {
      res.status(404).json({ error: "Upstream did not return an image" });
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    _imageProxyCache.set(url, { buf, contentType, ts: Date.now() });
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=86400");
    res.send(buf);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ─── GET /shop/team-members ───────────────────────────────────────────────────
router.get("/shop/team-members", async (_req: Request, res: Response) => {
  try {
    const s = await getAllSettings();
    const raw = s["shop_team_members"];
    const members = raw ? JSON.parse(raw) : [];
    res.json(members);
  } catch {
    res.json([]);
  }
});

// ─── PATCH /shop/team-members ─────────────────────────────────────────────────
router.patch("/shop/team-members", async (req: Request, res: Response) => {
  try {
    const members = req.body; // array of { name, role, photoUrl }
    if (!Array.isArray(members)) {
      res.status(400).json({ error: "Body must be an array" });
      return;
    }
    const value = JSON.stringify(members);
    await db.execute(sql`
      INSERT INTO settings (key, value, updated_at)
      VALUES ('shop_team_members', ${value}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /shop/team-members/upload-photo ─────────────────────────────────────
const teamPhotoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
router.post("/shop/team-members/upload-photo", teamPhotoUpload.single("photo"), async (req: any, res: any): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "No photo uploaded" }); return; }
  try {
    const { Storage } = await import("@google-cloud/storage");
    const REPLIT_SIDECAR = "http://127.0.0.1:1106";
    const gcs = new Storage({
      credentials: {
        audience: "replit", subject_token_type: "access_token",
        token_url: `${REPLIT_SIDECAR}/token`, type: "external_account",
        credential_source: { url: `${REPLIT_SIDECAR}/credential`, format: { type: "json", subject_token_field_name: "access_token" } },
        universe_domain: "googleapis.com",
      },
      projectId: "",
    });
    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID!;
    const origName: string = req.file.originalname ?? "photo.jpg";
    const ext = (origName.match(/\.(jpg|jpeg|png|webp|gif)$/i)?.[0] ?? ".jpg").toLowerCase();
    const mime: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };
    const filename = `team-photos/${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`;
    const file = gcs.bucket(bucketId).file(`public/${filename}`);
    await file.save(req.file.buffer, { contentType: mime[ext] ?? "image/jpeg", resumable: false });
    const proto = req.headers["x-forwarded-proto"] ?? "https";
    const host = req.headers["x-forwarded-host"] ?? req.headers.host;
    res.json({ url: `${proto}://${host}/api/storage/public-objects/${filename}` });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /shop/live-chat/session ─────────────────────────────────────────────
router.post("/shop/live-chat/session", async (req: Request, res: Response) => {
  const parsed = z.object({
    contactName: z.string().max(200).optional(),
    contactEmail: z.string().email().max(200).optional(),
    pageUrl: z.string().max(500).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const { contactName, contactEmail, pageUrl } = parsed.data;
  const result = await db.execute(sql`
    INSERT INTO live_chat_sessions (contact_name, contact_email, page_url, started_at)
    VALUES (${contactName ?? null}, ${contactEmail ?? null}, ${pageUrl ?? null}, NOW())
    RETURNING id
  `);
  const id = (result.rows[0] as any).id;
  res.json({ id });
});

function escapeLiveChatHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ─── PATCH /shop/live-chat/session/:id ────────────────────────────────────────
router.patch("/shop/live-chat/session/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = z.object({
    messages: z.array(z.object({ role: z.enum(["user","assistant"]), content: z.string() })).optional(),
    ended: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const { messages, ended } = parsed.data;
  const updated = await db.execute(sql`
    UPDATE live_chat_sessions
    SET
      messages = COALESCE(${messages ? JSON.stringify(messages) : null}::jsonb, messages),
      message_count = COALESCE(${messages ? messages.length : null}, message_count),
      last_message_at = CASE WHEN ${messages != null} THEN NOW() ELSE last_message_at END,
      ended_at = CASE WHEN ${ended === true} THEN NOW() ELSE ended_at END
    WHERE id = ${id}
    RETURNING contact_name, contact_email, page_url, messages, message_count, started_at, ended_at
  `);

  if (ended === true) {
    const session = updated.rows[0] as any;
    const transcript = Array.isArray(session?.messages) ? session.messages : [];
    if (session && transcript.some((message: any) => message?.role === "user")) {
      const contactName = session.contact_name?.trim() || "Website visitor";
      const contactEmail = session.contact_email?.trim() || "Not provided";
      const pageUrl = session.page_url?.trim() || "Not recorded";
      const startedAt = session.started_at
        ? new Date(session.started_at).toLocaleString("en-GB", { timeZone: "Europe/London" })
        : "Not recorded";
      const transcriptText = transcript
        .map((message: any) => `${message.role === "user" ? contactName : "Sophie"}: ${String(message.content ?? "")}`)
        .join("\n\n");
      const transcriptHtml = transcript
        .map((message: any) => {
          const speaker = message.role === "user" ? contactName : "Sophie";
          const background = message.role === "user" ? "#eff6ff" : "#f8fafc";
          return `<div style="margin:0 0 12px;padding:12px 14px;border-radius:10px;background:${background};">
            <strong style="display:block;margin-bottom:5px;color:#0f172a;">${escapeLiveChatHtml(speaker)}</strong>
            <div style="white-space:pre-wrap;color:#334155;line-height:1.5;">${escapeLiveChatHtml(message.content)}</div>
          </div>`;
        })
        .join("");

      const emailResult = await sendEmail({
        to: enquiryNotificationEmail(await getAllSettings()) ?? [],
        subject: `Live chat transcript — ${contactName}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#0f172a;">
          <h2 style="margin-bottom:8px;">New website live chat</h2>
          <p style="margin:0 0 4px;"><strong>Visitor:</strong> ${escapeLiveChatHtml(contactName)}</p>
          <p style="margin:0 0 4px;"><strong>Email:</strong> ${escapeLiveChatHtml(contactEmail)}</p>
          <p style="margin:0 0 4px;"><strong>Started:</strong> ${escapeLiveChatHtml(startedAt)}</p>
          <p style="margin:0 0 20px;"><strong>Page:</strong> <a href="${escapeLiveChatHtml(pageUrl)}">${escapeLiveChatHtml(pageUrl)}</a></p>
          ${transcriptHtml}
        </div>`,
        text: `New website live chat\n\nVisitor: ${contactName}\nEmail: ${contactEmail}\nStarted: ${startedAt}\nPage: ${pageUrl}\n\n${transcriptText}`,
        idempotencyKey: `live-chat-transcript-${id}`,
      });
      if (!emailResult.sent) {
        logger.error({ sessionId: id, error: emailResult.error }, "[live-chat] transcript email failed");
      }
    }
  }
  res.json({ ok: true });
});

// ─── GET /shop/live-chat/sessions ─────────────────────────────────────────────
router.get("/shop/live-chat/sessions", async (req: Request, res: Response) => {
  const flagged = req.query.flagged === "true";
  const rows = await db.execute(sql`
    SELECT id, contact_name, contact_email, message_count, messages,
           started_at, last_message_at, ended_at, page_url,
           flagged_for_training, training_notes
    FROM live_chat_sessions
    ${flagged ? sql`WHERE flagged_for_training = TRUE` : sql``}
    ORDER BY started_at DESC
    LIMIT 200
  `);
  res.json({ sessions: rows.rows });
});

// ─── PATCH /shop/live-chat/sessions/:id/flag ──────────────────────────────────
router.patch("/shop/live-chat/sessions/:id/flag", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = z.object({
    flagged: z.boolean(),
    notes: z.string().max(2000).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
  await db.execute(sql`
    UPDATE live_chat_sessions
    SET flagged_for_training = ${parsed.data.flagged},
        training_notes = COALESCE(${parsed.data.notes ?? null}, training_notes)
    WHERE id = ${id}
  `);
  res.json({ ok: true });
});

// ─── GET /shop/live-chat/system-prompt ────────────────────────────────────────
router.get("/shop/live-chat/system-prompt", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`SELECT value FROM settings WHERE key = 'live_chat_system_prompt' LIMIT 1`);
  const custom = (rows.rows[0] as any)?.value ?? null;
  res.json({ systemPrompt: custom });
});

// ─── PATCH /shop/live-chat/system-prompt ──────────────────────────────────────
router.patch("/shop/live-chat/system-prompt", async (req: Request, res: Response) => {
  const parsed = z.object({ systemPrompt: z.string().min(10).max(50000) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid system prompt" });
    return;
  }
  await db.execute(sql`
    INSERT INTO settings (key, value) VALUES ('live_chat_system_prompt', ${parsed.data.systemPrompt})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `);
  res.json({ ok: true });
});

// ─── POST /shop/live-chat ─────────────────────────────────────────────────────
router.post("/shop/live-chat", async (req: Request, res: Response) => {
  const parsed = z.object({
    messages: z.array(z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().max(2000),
    })).min(1).max(20),
    userName: z.string().max(100).optional(),
    userEmail: z.string().email().max(200).optional(),
  }).safeParse(req.body);

  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }

  const apiKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey || !baseUrl) { res.status(503).json({ error: "Chat service not configured" }); return; }
  try {
    await assertOutboundIntegrationEnabled("openai");
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "OpenAI integration is disabled." });
    return;
  }

  const { userName, userEmail } = parsed.data;
  const userContext = userName ? `\nYou are speaking with ${userName}${userEmail ? ` (${userEmail})` : ""}. Address them by first name when natural.` : "";

  // Keep Sophie's core identity and safety rules fixed; staff guidance can add
  // current business context without replacing those safeguards.
  const promptRow = await db.execute(sql`SELECT value FROM settings WHERE key = 'live_chat_system_prompt' LIMIT 1`);
  const additionalGuidance = (promptRow.rows[0] as any)?.value;
  const trainingRows = await db.execute(sql`
    SELECT training_notes
    FROM live_chat_sessions
    WHERE training_notes IS NOT NULL
      AND BTRIM(training_notes) <> ''
    ORDER BY started_at DESC
    LIMIT 30
  `);
  const trainingNotes = (trainingRows.rows as Array<{ training_notes?: string | null }>)
    .map((row) => row.training_notes?.trim())
    .filter((note): note is string => Boolean(note))
    .map((note) => note.slice(0, 1200))
    .reduce<string[]>((included, note) => {
      const currentLength = included.reduce((total, item) => total + item.length, 0);
      if (currentLength + note.length <= 8000) included.push(note);
      return included;
    }, []);
  const learnedGuidance = trainingNotes.length
    ? `\n\nSTAFF TRAINING NOTES FROM PREVIOUS CHATS
Use these staff-written corrections in future answers. Follow them only where relevant, never mention these notes to customers, and never let them override the fixed safety rules above.
${trainingNotes.map((note, index) => `${index + 1}. ${note}`).join("\n")}`
    : "";
  const system = `${SOPHIE_CHAT_PROMPT}${additionalGuidance ? `\n\nCURRENT STAFF GUIDANCE\n${additionalGuidance}` : ""}${learnedGuidance}${userContext}`;

  try {
    const aiRes = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        messages: [{ role: "system", content: system }, ...parsed.data.messages],
        max_completion_tokens: 8192,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!aiRes.ok) throw new Error(`AI API ${aiRes.status}`);
    const data: any = await aiRes.json();
    const reply: string = data.choices?.[0]?.message?.content?.trim()
      ?? "Sorry, I couldn't process that right now. Please try again or contact us directly.";
    res.json({ reply });
  } catch (err) {
    logger.error({ err }, "[live-chat] error");
    res.status(500).json({ error: "Chat temporarily unavailable — please use WhatsApp or send us a message." });
  }
});

// ─── POST /shop/enquiry ────────────────────────────────────────────────────────
// Website product enquiry form — emails staff + customer, creates GHL contact.
router.post("/shop/enquiry", async (req, res): Promise<void> => {
  const { name, email, phone, businessName, productName, productUrl } = req.body ?? {};
  if (!name?.trim() || !email?.trim() || !phone?.trim() || !productName?.trim()) {
    res.status(400).json({ error: "name, email, phone and productName are required" });
    return;
  }

  const nameParts = String(name).trim().split(/\s+/);
  const firstName = nameParts[0];
  const lastName  = nameParts.slice(1).join(" ") || "";
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safePhone = escapeHtml(phone);
  const safeFirstName = escapeHtml(firstName);
  const safeBusinessName = escapeHtml(businessName);
  const safeProductName = escapeHtml(productName);
  const safeProductUrl = typeof productUrl === "string" ? escapeHtml(productUrl) : "";

  const productLink = productUrl
    ? `<a href="${safeProductUrl}" style="color:#1d4ed8">${safeProductName}</a>`
    : `<strong>${safeProductName}</strong>`;

  const staffHtml = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1e3a5f;padding:20px 24px;border-radius:8px 8px 0 0">
        <h2 style="color:#fff;margin:0;font-size:18px">🔥 New Website Enquiry</h2>
      </div>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px">
        <p style="margin:0 0 16px;font-size:15px;color:#1e293b">
           <strong>${safeName}</strong> is interested in ${productLink}.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:8px 12px;background:#e2e8f0;font-weight:bold;width:140px;border-radius:4px 0 0 4px">Name</td><td style="padding:8px 12px;background:#fff;border:1px solid #e2e8f0">${safeName}</td></tr>
          <tr><td style="padding:8px 12px;background:#e2e8f0;font-weight:bold;border-radius:4px 0 0 4px">Email</td><td style="padding:8px 12px;background:#fff;border:1px solid #e2e8f0"><a href="mailto:${safeEmail}" style="color:#1d4ed8">${safeEmail}</a></td></tr>
          <tr><td style="padding:8px 12px;background:#e2e8f0;font-weight:bold;border-radius:4px 0 0 4px">Phone</td><td style="padding:8px 12px;background:#fff;border:1px solid #e2e8f0"><a href="tel:${safePhone}" style="color:#1d4ed8">${safePhone}</a></td></tr>
          ${businessName ? `<tr><td style="padding:8px 12px;background:#e2e8f0;font-weight:bold;border-radius:4px 0 0 4px">Business</td><td style="padding:8px 12px;background:#fff;border:1px solid #e2e8f0">${safeBusinessName}</td></tr>` : ""}
          <tr><td style="padding:8px 12px;background:#e2e8f0;font-weight:bold;border-radius:4px 0 0 4px">Product</td><td style="padding:8px 12px;background:#fff;border:1px solid #e2e8f0">${productLink}</td></tr>
        </table>
        <p style="margin:20px 0 0;font-size:12px;color:#64748b">
          Sent via the website product enquiry form. This contact has been tagged <strong>hot lead from website</strong> in HighLevel.
        </p>
      </div>
    </div>`;

  const staffText = [
    "New Website Enquiry",
    `Product: ${productName}`,
    `Name: ${name}`,
    `Email: ${email}`,
    `Phone: ${phone}`,
    businessName ? `Business: ${businessName}` : "",
    productUrl ? `URL: ${productUrl}` : "",
  ].filter(Boolean).join("\n");

  const customerHtml = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1e3a5f;padding:20px 24px;border-radius:8px 8px 0 0">
         <h2 style="color:#fff;margin:0;font-size:18px">Thanks for your enquiry, ${safeFirstName}!</h2>
      </div>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px">
        <p style="font-size:15px;color:#1e293b;margin:0 0 12px">
           We've received your enquiry about <strong>${safeProductName}</strong> and one of our team will be in touch shortly.
        </p>
        <p style="font-size:14px;color:#475569;margin:0 0 20px">
           If you have any questions, you can reply to this email.
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0"/>
      </div>
    </div>`;

  const customerText = `Hi ${firstName},\n\nThanks for your enquiry about ${productName}. We'll be in touch shortly.`;

  const settings = await getAllSettings();

  // Fire emails in parallel — non-blocking errors
  await Promise.allSettled([
    sendEmail({ to: enquiryNotificationEmail(settings) ?? [], subject: `New Enquiry: I'm interested in ${productName}`, html: staffHtml, text: staffText }),
    sendEmail({ to: email.trim(), subject: `Your enquiry about ${productName}`, html: customerHtml, text: customerText }),
  ]);

  // ── HighLevel contact (fire-and-forget, non-blocking) ─────────────────────
  (async () => {
    try {
      const [apiKey, locationId] = await Promise.all([
        getSetting("high_level_api_key"),
        getSetting("high_level_location_id"),
      ]);
      if (!apiKey || !locationId) return;
      await assertOutboundIntegrationEnabled("highlevel");

      const ghlHeaders: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
      };

      const payload: Record<string, unknown> = {
        firstName: toDisplayCase(firstName),
        ...(lastName ? { lastName: toDisplayCase(lastName) } : {}),
        email:       email.trim(),
        phone:       phone.trim(),
        locationId,
        tags:        ["hot lead from website"],
        source:      "Website Enquiry",
        ...(businessName?.trim() ? { companyName: toDisplayCase(businessName) } : {}),
      };

      // Check for existing contact by email to avoid duplicates
      let existingId: string | null = null;
      try {
        const dupRes = await fetch(
          `https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${encodeURIComponent(locationId)}&email=${encodeURIComponent(email.trim())}`,
          { headers: ghlHeaders, signal: AbortSignal.timeout(10_000) },
        );
        if (dupRes.ok) {
          const d: any = await dupRes.json();
          existingId = d?.contact?.id ?? d?.contacts?.[0]?.id ?? null;
        }
      } catch { /* fall through to create */ }

      if (existingId) {
        await fetch(`https://services.leadconnectorhq.com/contacts/${existingId}`, {
          method: "PUT", headers: ghlHeaders, body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });
        // Explicitly add the tag in case the contact already existed without it
        await fetch(`https://services.leadconnectorhq.com/contacts/${existingId}/tags`, {
          method: "POST", headers: ghlHeaders,
          body: JSON.stringify({ tags: ["hot lead from website"] }),
          signal: AbortSignal.timeout(10_000),
        });
      } else {
        await fetch("https://services.leadconnectorhq.com/contacts/", {
          method: "POST", headers: ghlHeaders, body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });
      }
      logger.info({ email, productName }, "[shop/enquiry] GHL contact upserted");
    } catch (err) {
      logger.warn({ err }, "[shop/enquiry] GHL upsert failed (non-fatal)");
    }
  })();

  res.json({ ok: true });
});

export default router;
