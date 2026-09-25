import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { generateQuotePdf, fetchLogoBuffer, fetchLogoDataUrl, buildQuoteEmail, sendEmail, isEmailConfigured, type QuotePdfItem } from "../services/email.js";
import { assertIntegrationOutboundAllowed } from "../setup/outbound-gate.js";

const router = Router();

const DEFAULT_COVER_TEXT = `Hi {firstName},

Thank you for the opportunity to quote for {businessName}.

We've put together a quote based on our initial conversation, featuring the products and quantities we discussed.

Simply click the link below to view your items, adjust any quantities to suit your team's needs, and place your order when you're ready.

Please note: our garment pricing by default includes a left chest logo in print or embroidery. Should your logo require converting to stitches then a set-up cost of £35 will apply. Should you decide print is your preferred option then there is no set-up cost, as long as you are able to supply a hi-res file in EPS or PDF format.

Your branded workwear is a great opportunity to showcase your brand and we can enhance your workwear with additional logo applications. For example, a large rear logo up to A4 size can be applied for just £6 per garment.

Standard lead time is 7 days. All prices are subject to carriage and VAT.

If you have any questions or would like to make any changes before ordering, please don't hesitate to get in touch — we're always happy to help.

Kind regards,

 The {businessName} Team
 T: {businessPhone}
 E: {businessEmail}
 W: {businessWebsite}`;

// ─── camelCase helpers ────────────────────────────────────────────────────────
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
function rowToCamel(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [snakeToCamel(k), v]));
}
function quoteToCamel(row: any, items?: any[]) {
  const r = rowToCamel(row);
  if (items !== undefined) r.items = items.map(rowToCamel);
  return r;
}

// ─── List quotes ──────────────────────────────────────────────────────────────
router.get("/quotes", async (_req, res: Response): Promise<void> => {
  const rows = await db.execute(sql`
    SELECT
      q.id, q.quote_number, q.customer_id, q.customer_name, q.status,
      q.notes, q.expires_at, q.token, q.created_at, q.updated_at,
      COUNT(qi.id)::int AS item_count,
      COALESCE(SUM(qi.quantity * qi.unit_price), 0)::numeric AS total_ex_vat
    FROM quotes q
    LEFT JOIN quote_items qi ON qi.quote_id = q.id
    GROUP BY q.id
    ORDER BY q.created_at DESC
  `);
  res.json((rows.rows as any[]).map(rowToCamel));
});

// ─── Create quote ─────────────────────────────────────────────────────────────
const CreateSchema = z.object({
  customerId: z.number().int().positive().nullable().optional(),
  enquiryId: z.number().int().positive().nullable().optional(),
  wcEnquiryId: z.number().int().positive().nullable().optional(),
  customerName: z.string().min(1),
  notes: z.string().optional().nullable(),
  expiresAt: z.string().optional().nullable(),
});

router.post("/quotes", async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { customerId, enquiryId, wcEnquiryId, customerName, notes, expiresAt } = parsed.data;

  // Auto-fill logo from linked customer
  let customerLogoUrl: string | null = null;
  if (customerId) {
    const custRows = await db.execute(sql`SELECT logo_url FROM customers WHERE id = ${customerId}`);
    customerLogoUrl = (custRows.rows[0] as any)?.logo_url ?? null;
  }

  // Auto-fill contact email from linked wc_enquiry
  let wcEnquiryEmail: string | null = null;
  if (wcEnquiryId) {
    const enqRows = await db.execute(sql`SELECT email FROM wc_enquiries WHERE id = ${wcEnquiryId}`);
    wcEnquiryEmail = (enqRows.rows[0] as any)?.email ?? null;
  }

  const seqRows = await db.execute(sql`SELECT nextval('quote_number_seq') AS n`);
  const n = Number((seqRows.rows[0] as any).n);
  const quoteNumber = `Q${String(n).padStart(3, "0")}`;

  const result = await db.execute(sql`
    INSERT INTO quotes (quote_number, customer_id, enquiry_id, wc_enquiry_id, customer_name, notes, cover_text, expires_at, customer_logo_url, contact_email)
    VALUES (${quoteNumber}, ${customerId ?? null}, ${enquiryId ?? null}, ${wcEnquiryId ?? null}, ${customerName}, ${notes ?? null}, ${DEFAULT_COVER_TEXT}, ${expiresAt ? new Date(expiresAt) : null}, ${customerLogoUrl}, ${wcEnquiryEmail})
    RETURNING *
  `);
  res.status(201).json(quoteToCamel(result.rows[0] as any));
});

// ─── Get quote detail ─────────────────────────────────────────────────────────
router.get("/quotes/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const quoteRows = await db.execute(sql`
    SELECT q.*,
      c.contact_first_name AS cust_first_name, c.contact_last_name AS cust_last_name,
      c.phone AS customer_phone, c.email AS customer_email,
      c.high_level_contact_id
    FROM quotes q
    LEFT JOIN customers c ON c.id = q.customer_id
    WHERE q.id = ${id}
  `);
  const quote = quoteRows.rows[0] as any;
  if (!quote) { res.status(404).json({ error: "Quote not found" }); return; }

  // Merge: prefer the quote's own persisted name (from a previous HL sync),
  // fall back to the linked customer's stored name.
  quote.contact_first_name = (quote.contact_first_name as string | null) || (quote.cust_first_name as string | null) || null;
  quote.contact_last_name  = (quote.contact_last_name  as string | null) || (quote.cust_last_name  as string | null) || null;

  // Fetch contact details from High Level if any field is missing.
  // Strategy A: quote is linked to a customer that has a HL contact ID → fetch by ID.
  // Strategy B: no HL contact ID (or quote is unlinked) → search HL by company name.
  const missingContactFields =
    !quote.contact_first_name || !quote.contact_last_name || !quote.customer_phone || !quote.customer_email;

  const canFetchByHlId  = quote.high_level_contact_id && missingContactFields;
  const canSearchByName = !quote.high_level_contact_id && missingContactFields && quote.customer_name;

  if (canFetchByHlId || canSearchByName) {
    try {
      const settingsRows = await db.execute(sql`
        SELECT key, value FROM settings
        WHERE key IN ('high_level_api_key', 'high_level_location_id')
      `);
      const settingsMap = Object.fromEntries(
        (settingsRows.rows as any[]).map((r: any) => [r.key, r.value])
      );
      const apiKey: string | undefined = settingsMap["high_level_api_key"];
      const locationId: string | undefined = settingsMap["high_level_location_id"];
      if (apiKey) {
        let hlContact: any = null;
        let foundHlContactId: string | null = null;

        if (canFetchByHlId) {
          // Strategy A: direct fetch by HL contact ID
          await assertIntegrationOutboundAllowed("highlevel");
          const hlRes = await fetch(
            `https://services.leadconnectorhq.com/contacts/${quote.high_level_contact_id}`,
            { headers: { "Authorization": `Bearer ${apiKey}`, "Version": "2021-07-28" } }
          );
          if (hlRes.ok) {
            const hlData = await hlRes.json() as any;
            hlContact = hlData?.contact ?? null;
            foundHlContactId = hlContact?.id ?? null;
          }
        } else if (canSearchByName && locationId) {
          // Strategy B: search HL by company/contact name using the same endpoint as enquiries
          // First try the duplicate-search endpoint (faster, more precise)
          const url1 = `https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${encodeURIComponent(locationId)}&name=${encodeURIComponent(quote.customer_name)}`;
          await assertIntegrationOutboundAllowed("highlevel");
          const hlRes1 = await fetch(url1, {
            headers: { "Authorization": `Bearer ${apiKey}`, "Version": "2021-07-28" },
          });
          if (hlRes1.ok) {
            const data1 = await hlRes1.json() as any;
            if (data1?.contact) {
              hlContact = data1.contact;
              foundHlContactId = hlContact?.id ?? null;
            }
          }
          // Fallback: general contacts query
          if (!hlContact) {
            const url2 = `https://services.leadconnectorhq.com/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(quote.customer_name)}&limit=5`;
            await assertIntegrationOutboundAllowed("highlevel");
            const hlRes2 = await fetch(url2, {
              headers: { "Authorization": `Bearer ${apiKey}`, "Version": "2021-07-28" },
            });
            if (hlRes2.ok) {
              const data2 = await hlRes2.json() as any;
              const contacts: any[] = data2?.contacts ?? [];
              // Pick the best match: prefer exact company name match, else first result
              const nameLower = quote.customer_name.toLowerCase().trim();
              hlContact =
                contacts.find((c: any) => (c.companyName ?? "").toLowerCase().trim() === nameLower) ??
                contacts[0] ??
                null;
              foundHlContactId = hlContact?.id ?? null;
            }
          }
        }

        if (hlContact) {
          quote.contact_first_name = hlContact.firstName ?? null;
          quote.contact_last_name  = hlContact.lastName  ?? null;
          quote.customer_phone     = hlContact.phone      ?? null;
          quote.customer_email     = hlContact.email      ?? null;

          // Persist the resolved first/last name directly on the quote so the
          // send endpoint can always find it, even for quotes with no customer_id.
          await db.execute(sql`
            UPDATE quotes SET
              contact_first_name = ${hlContact.firstName ?? null},
              contact_last_name  = ${hlContact.lastName  ?? null},
              contact_email      = COALESCE(contact_email, ${hlContact.email ?? null})
            WHERE id = ${id}
          `);

          // Also persist back to the linked customer record (if any)
          if (quote.customer_id) {
            await db.execute(sql`
              UPDATE customers SET
                contact_first_name    = ${hlContact.firstName ?? null},
                contact_last_name     = ${hlContact.lastName  ?? null},
                phone                 = ${hlContact.phone      ?? null},
                email                 = COALESCE(email, ${hlContact.email ?? null}),
                high_level_contact_id = COALESCE(high_level_contact_id, ${foundHlContactId})
              WHERE id = ${quote.customer_id}
            `);
          }
          console.log(`[quotes/:id] HL contact resolved for quote ${id} (${quote.customer_name}):`, hlContact.firstName, hlContact.lastName);
        }
      }
    } catch (err: any) {
      console.error("[quotes/:id] HL contact fetch failed:", err.message);
    }
  }

  const itemRows = await db.execute(sql`
    SELECT qi.*, p.sku AS product_sku
    FROM quote_items qi
    LEFT JOIN products p ON p.id = qi.product_id
      OR (qi.product_id IS NULL AND p.sku IS NOT NULL AND qi.product_name LIKE (p.sku || ' %'))
    WHERE qi.quote_id = ${id}
    ORDER BY qi.sort_order, qi.id
  `);

  // Delivery address attached to this quote
  let deliveryAddress: any = null;
  if (quote.delivery_address_id) {
    const daRows = await db.execute(sql`SELECT * FROM customer_delivery_addresses WHERE id = ${quote.delivery_address_id}`);
    if (daRows.rows[0]) deliveryAddress = rowToCamel(daRows.rows[0] as any);
  }

  // All delivery addresses for the linked customer (for the selector)
  let customerDeliveryAddresses: any[] = [];
  if (quote.customer_id) {
    const daList = await db.execute(sql`
      SELECT * FROM customer_delivery_addresses WHERE customer_id = ${quote.customer_id} ORDER BY is_default DESC, label ASC
    `);
    customerDeliveryAddresses = (daList.rows as any[]).map(rowToCamel);
  }

  const base = quoteToCamel(quote, itemRows.rows as any[]);
  res.json({
    ...base,
    contactFirstName: quote.contact_first_name ?? null,
    contactLastName:  quote.contact_last_name  ?? null,
    customerPhone:    quote.customer_phone      ?? null,
    customerEmail:    quote.customer_email      ?? null,
    deliveryAddress,
    customerDeliveryAddresses,
  });
});

// ─── Update quote ─────────────────────────────────────────────────────────────
const UpdateSchema = z.object({
  customerName: z.string().min(1).optional(),
  customerId: z.number().int().positive().nullable().optional(),
  status: z.enum(["draft", "sent", "viewed", "ordered", "expired"]).optional(),
  notes: z.string().nullable().optional(),
  coverText: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  customerLogoUrl: z.string().nullable().optional(),
  deliveryAddressId: z.number().int().positive().nullable().optional(),
});

router.patch("/quotes/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const existing = (await db.execute(sql`SELECT * FROM quotes WHERE id = ${id}`)).rows[0] as any;
  if (!existing) { res.status(404).json({ error: "Quote not found" }); return; }

  const d = parsed.data;
  const result = await db.execute(sql`
    UPDATE quotes SET
      customer_name        = ${d.customerName ?? existing.customer_name},
      customer_id          = ${d.customerId !== undefined ? d.customerId : existing.customer_id},
      status               = ${d.status ?? existing.status},
      notes                = ${d.notes !== undefined ? d.notes : existing.notes},
      cover_text           = ${d.coverText !== undefined ? d.coverText : existing.cover_text},
      expires_at           = ${d.expiresAt !== undefined ? (d.expiresAt ? new Date(d.expiresAt) : null) : existing.expires_at},
      customer_logo_url    = ${d.customerLogoUrl !== undefined ? d.customerLogoUrl : existing.customer_logo_url},
      delivery_address_id  = ${d.deliveryAddressId !== undefined ? d.deliveryAddressId : existing.delivery_address_id},
      updated_at           = now()
    WHERE id = ${id}
    RETURNING *
  `);
  res.json(quoteToCamel(result.rows[0] as any));
});

// ─── Delete quote ─────────────────────────────────────────────────────────────
router.delete("/quotes/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.execute(sql`DELETE FROM quotes WHERE id = ${id}`);
  res.json({ ok: true });
});

// ─── Add item ─────────────────────────────────────────────────────────────────
const ItemSchema = z.object({
  parentItemId: z.number().int().positive().nullable().optional(),
  productId: z.number().int().positive().nullable().optional(),
  productName: z.string().default(""),
  colour: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  finishId: z.number().int().positive().nullable().optional(),
  finishName: z.string().nullable().optional(),
  quantity: z.number().int().min(0).default(1),
  unitPrice: z.number().min(0).default(0),
  vatRate: z.number().min(0).max(1).default(0.20),
  notes: z.string().nullable().optional(),
  productUrl: z.string().nullable().optional(),
});

router.post("/quotes/:id/items", async (req: Request, res: Response): Promise<void> => {
  const quoteId = parseInt(req.params.id);
  if (isNaN(quoteId)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const parsed = ItemSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;

  const result = await db.execute(sql`
    INSERT INTO quote_items (quote_id, parent_item_id, product_id, product_name, colour, size, finish_id, finish_name, quantity, unit_price, vat_rate, notes, product_url)
    VALUES (${quoteId}, ${d.parentItemId ?? null}, ${d.productId ?? null}, ${d.productName}, ${d.colour ?? null}, ${d.size ?? null},
            ${d.finishId ?? null}, ${d.finishName ?? null}, ${d.quantity}, ${d.unitPrice}, ${d.vatRate}, ${d.notes ?? null}, ${d.productUrl ?? null})
    RETURNING *
  `);
  await db.execute(sql`UPDATE quotes SET updated_at = now() WHERE id = ${quoteId}`);
  res.status(201).json(rowToCamel(result.rows[0] as any));
});

// ─── Update item ──────────────────────────────────────────────────────────────
router.patch("/quotes/:id/items/:itemId", async (req: Request, res: Response): Promise<void> => {
  const quoteId = parseInt(req.params.id);
  const itemId = parseInt(req.params.itemId);
  if (isNaN(quoteId) || isNaN(itemId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = ItemSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const existing = (await db.execute(sql`SELECT * FROM quote_items WHERE id = ${itemId} AND quote_id = ${quoteId}`)).rows[0] as any;
  if (!existing) { res.status(404).json({ error: "Item not found" }); return; }

  const d = parsed.data;
  const result = await db.execute(sql`
    UPDATE quote_items SET
      product_name = ${d.productName ?? existing.product_name},
      colour       = ${d.colour !== undefined ? d.colour : existing.colour},
      size         = ${d.size !== undefined ? d.size : existing.size},
      finish_name  = ${d.finishName !== undefined ? d.finishName : existing.finish_name},
      quantity     = ${d.quantity ?? existing.quantity},
      unit_price   = ${d.unitPrice ?? existing.unit_price},
      notes        = ${d.notes !== undefined ? d.notes : existing.notes}
    WHERE id = ${itemId} AND quote_id = ${quoteId}
    RETURNING *
  `);
  await db.execute(sql`UPDATE quotes SET updated_at = now() WHERE id = ${quoteId}`);
  res.json(rowToCamel(result.rows[0] as any));
});

// ─── Delete item ──────────────────────────────────────────────────────────────
router.delete("/quotes/:id/items/:itemId", async (req: Request, res: Response): Promise<void> => {
  const quoteId = parseInt(req.params.id);
  const itemId = parseInt(req.params.itemId);
  if (isNaN(quoteId) || isNaN(itemId)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.execute(sql`DELETE FROM quote_items WHERE id = ${itemId} AND quote_id = ${quoteId}`);
  await db.execute(sql`UPDATE quotes SET updated_at = now() WHERE id = ${quoteId}`);
  res.json({ ok: true });
});

// ─── Quote PDF ────────────────────────────────────────────────────────────────
router.get("/quotes/:id/pdf", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const quoteRows = await db.execute(sql`SELECT * FROM quotes WHERE id = ${id}`);
  const quote = quoteRows.rows[0] as any;
  if (!quote) { res.status(404).json({ error: "Quote not found" }); return; }

  // Fetch items joined with products for image_url, description, sku.
  // LATERAL JOIN with LIMIT 1 ensures exactly one product per item row and
  // handles four naming conventions in priority order:
  //   0 – direct product_id match
  //   1 – quote item name starts with product SKU  ("UC122 Ladies Classic Polo")
  //   2 – product name = SKU + " " + quote item name ("UC122" + " " + "Ladies Classic Polo")
  //   3 – exact product name match
  const itemRows = await db.execute(sql`
    SELECT
      qi.id, qi.product_name, qi.product_url, qi.colour, qi.size, qi.finish_name,
      qi.quantity, qi.unit_price, qi.vat_rate, qi.notes,
      p.sku         AS product_sku,
      p.description AS product_description,
      p.image_url   AS product_image_url,
      p.permalink   AS product_permalink
    FROM quote_items qi
    LEFT JOIN LATERAL (
      SELECT p2.sku, p2.description, p2.image_url, p2.permalink, p2.price_breaks,
             CASE
               WHEN p2.id = qi.product_id                                                              THEN 0
               WHEN qi.product_id IS NULL AND p2.sku IS NOT NULL
                    AND qi.product_name ILIKE (p2.sku || ' %')                                         THEN 1
               WHEN qi.product_id IS NULL AND p2.sku IS NOT NULL
                    AND LOWER(p2.name) = LOWER(p2.sku || ' ' || qi.product_name)                      THEN 2
               WHEN qi.product_id IS NULL
                    AND LOWER(p2.name) = LOWER(qi.product_name)                                        THEN 3
               ELSE 99
             END AS match_rank
      FROM products p2
      WHERE p2.id = qi.product_id
         OR (qi.product_id IS NULL AND p2.sku IS NOT NULL AND qi.product_name ILIKE (p2.sku || ' %'))
         OR (qi.product_id IS NULL AND p2.sku IS NOT NULL
             AND LOWER(p2.name) = LOWER(p2.sku || ' ' || qi.product_name))
         OR (qi.product_id IS NULL AND LOWER(p2.name) = LOWER(qi.product_name))
      ORDER BY match_rank ASC
      LIMIT 1
    ) p ON true
    WHERE qi.quote_id = ${id}
    ORDER BY qi.sort_order, qi.id
  `);
  const rows = itemRows.rows as any[];

  // Fetch all product images in parallel (deduplicated by URL)
  const uniqueUrls = [...new Set(rows.map((r) => r.product_image_url).filter(Boolean))] as string[];
  const imageMap = new Map<string, Buffer | null>();
  await Promise.all(uniqueUrls.map(async (url) => {
    imageMap.set(url, await fetchLogoBuffer(url));
  }));

  const items: QuotePdfItem[] = rows.map((r) => ({
    productName:  r.product_name,
    productUrl:   r.product_url ?? r.product_permalink ?? null,
    sku:          r.product_sku ?? null,
    description:  r.product_description ?? null,
    colour:       r.colour ?? null,
    size:         r.size ?? null,
    finishName:   r.finish_name ?? null,
    quantity:     Number(r.quantity),
    unitPrice:    Number(r.unit_price),
    vatRate:      Number(r.vat_rate ?? 0.20),
    imageBuffer:  r.product_image_url ? (imageMap.get(r.product_image_url) ?? null) : null,
    priceBreaks:  r.price_breaks ?? null,
  }));

  // Resolve logo: use what's stored on the quote, otherwise fall back to the
  // customer's current logo (handles quotes created before logo was set).
  let resolvedLogoUrl: string | null = quote.customer_logo_url ?? null;
  if (!resolvedLogoUrl && quote.customer_id) {
    const custLogo = await db.execute(sql`SELECT logo_url FROM customers WHERE id = ${quote.customer_id}`);
    resolvedLogoUrl = (custLogo.rows[0] as any)?.logo_url ?? null;
  }
  const customerLogoBuffer = await fetchLogoBuffer(resolvedLogoUrl);

  const pdf = await generateQuotePdf({
    quoteNumber:        quote.quote_number,
    customerName:       quote.customer_name,
    quoteDate:          quote.created_at,
    expiresAt:          quote.expires_at ?? null,
    notes:              quote.notes ?? null,
    items,
    customerLogoBuffer,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="Quote-${quote.quote_number}.pdf"`);
  res.send(pdf);
});

// ─── Send quote email ─────────────────────────────────────────────────────────
router.post("/quotes/:id/send", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const body = z.object({
    toEmail: z.string().optional(),
    previewOnly: z.boolean().optional(),
  }).safeParse(req.body);

  const quoteRows = await db.execute(sql`
    SELECT q.*,
      q.contact_email      AS contact_email,
      c.contact_first_name AS cust_first_name,
      c.contact_last_name  AS cust_last_name,
      c.email              AS customer_email
    FROM quotes q
    LEFT JOIN customers c ON c.id = q.customer_id
    WHERE q.id = ${id}
  `);
  const quote = quoteRows.rows[0] as any;
  if (!quote) { res.status(404).json({ error: "Quote not found" }); return; }

  // Fetch items joined with products (same LATERAL match strategy as PDF route)
  const itemRows = await db.execute(sql`
    SELECT qi.product_name, qi.colour, qi.size, qi.finish_name, qi.quantity, qi.unit_price, qi.vat_rate,
           p.sku AS product_sku, p.description AS product_description, p.image_url AS product_image_url,
           p.permalink AS product_permalink
    FROM quote_items qi
    LEFT JOIN LATERAL (
      SELECT p2.sku, p2.description, p2.image_url, p2.permalink, p2.price_breaks,
             CASE
               WHEN p2.id = qi.product_id                                                              THEN 0
               WHEN qi.product_id IS NULL AND p2.sku IS NOT NULL
                    AND qi.product_name ILIKE (p2.sku || ' %')                                         THEN 1
               WHEN qi.product_id IS NULL AND p2.sku IS NOT NULL
                    AND LOWER(p2.name) = LOWER(p2.sku || ' ' || qi.product_name)                      THEN 2
               WHEN qi.product_id IS NULL
                    AND LOWER(p2.name) = LOWER(qi.product_name)                                        THEN 3
               ELSE 99
             END AS match_rank
      FROM products p2
      WHERE p2.id = qi.product_id
         OR (qi.product_id IS NULL AND p2.sku IS NOT NULL AND qi.product_name ILIKE (p2.sku || ' %'))
         OR (qi.product_id IS NULL AND p2.sku IS NOT NULL
             AND LOWER(p2.name) = LOWER(p2.sku || ' ' || qi.product_name))
         OR (qi.product_id IS NULL AND LOWER(p2.name) = LOWER(qi.product_name))
      ORDER BY match_rank ASC
      LIMIT 1
    ) p ON true
    WHERE qi.quote_id = ${id}
    ORDER BY qi.sort_order, qi.id
  `);
  const items = (itemRows.rows as any[]).map(r => ({
    productName: r.product_sku ? `${r.product_sku} ${r.product_name}` : r.product_name,
    colour: r.colour ?? null,
    size: r.size ?? null,
    finishName: r.finish_name ?? null,
    quantity: Number(r.quantity),
    unitPrice: Number(r.unit_price),
    vatRate: Number(r.vat_rate ?? 0.20),
    priceBreaks: r.price_breaks ?? null,
  }));

  // Resolve customer email
  let toEmail: string | undefined = body.success ? body.data.toEmail : undefined;
  // Prefer the quote's own persisted first name (written by GET /quotes/:id when HL
  // contact is resolved), then fall back to the linked customer's stored name.
  let contactFirstName: string | null =
    (quote.contact_first_name as string | null) ||
    (quote.cust_first_name   as string | null) ||
    null;

  // 1. Quote's own persisted contact email (most reliable — written during HL sync)
  if (!toEmail && quote.contact_email) {
    toEmail = quote.contact_email as string;
  }
  // 2. Linked customer's email (from JOIN)
  if (!toEmail && quote.customer_email) {
    toEmail = quote.customer_email as string;
  }

  if (!toEmail && quote.customer_id) {
    // Prefer manager/dept_manager portal users
    const managerRows = await db.execute(sql`
      SELECT email FROM customer_portal_users
      WHERE customer_id = ${quote.customer_id}
        AND portal_role IN ('manager', 'dept_manager')
        AND email IS NOT NULL
      ORDER BY portal_role = 'manager' DESC, status = 'active' DESC, id ASC
    `);
    const managerEmails = (managerRows.rows as Array<{ email: string }>).map(r => r.email).filter(Boolean);
    if (managerEmails.length > 0) {
      toEmail = managerEmails.join(", ");
    } else {
      const custRows = await db.execute(sql`SELECT email, contact_first_name FROM customers WHERE id = ${quote.customer_id}`);
      const cust = custRows.rows[0] as any;
      toEmail = cust?.email ?? undefined;
      contactFirstName = cust?.contact_first_name ?? null;
    }
  }

  // Resolve contact first name if still unknown — match first email against customer_contacts
  if (!contactFirstName && quote.customer_id && toEmail) {
    const firstEmail = toEmail.split(",")[0].trim();
    const ccRows = await db.execute(sql`
      SELECT first_name FROM customer_contacts
      WHERE customer_id = ${quote.customer_id} AND LOWER(email) = LOWER(${firstEmail})
      LIMIT 1
    `);
    contactFirstName = (ccRows.rows[0] as any)?.first_name ?? null;
  }
  // Also check customer_portal_users by the target email (they have a real first_name)
  if (!contactFirstName && toEmail) {
    const firstEmail = toEmail.split(",")[0].trim();
    const puRows = await db.execute(sql`
      SELECT first_name FROM customer_portal_users
      WHERE LOWER(email) = LOWER(${firstEmail}) AND first_name IS NOT NULL AND first_name <> ''
      LIMIT 1
    `);
    contactFirstName = (puRows.rows[0] as any)?.first_name ?? null;
  }
  // Fallback: any active portal manager for this customer
  if (!contactFirstName && quote.customer_id) {
    const puRows2 = await db.execute(sql`
      SELECT first_name FROM customer_portal_users
      WHERE customer_id = ${quote.customer_id}
        AND portal_role IN ('manager', 'dept_manager')
        AND first_name IS NOT NULL AND first_name <> ''
      ORDER BY portal_role = 'manager' DESC, status = 'active' DESC
      LIMIT 1
    `);
    contactFirstName = (puRows2.rows[0] as any)?.first_name ?? null;
  }
  // Final fallback: customers.contact_first_name
  if (!contactFirstName && quote.customer_id) {
    const cfRows = await db.execute(sql`SELECT contact_first_name FROM customers WHERE id = ${quote.customer_id}`);
    contactFirstName = (cfRows.rows[0] as any)?.contact_first_name ?? null;
  }

  if (!toEmail && !body.data?.previewOnly) {
    res.status(400).json({ error: "No customer email address found — enter one manually." }); return;
  }

  // Build portal link
  const host = req.get("x-forwarded-host") ?? req.get("host");
  if (!host) { res.status(400).json({ error: "Installation domain is not configured." }); return; }
  const protocol = (req.get("x-forwarded-proto") ?? req.protocol ?? "https").split(",")[0].trim();
  const portalLink = `${protocol}://${host}/customer-portal/orders/new?quote=${quote.token}`;

  const coverText = (quote.cover_text as string | null) ?? DEFAULT_COVER_TEXT;

  // Resolve logo URL (quote's own field, else customer record fallback)
  let emailLogoUrl: string | null = quote.customer_logo_url ?? null;
  if (!emailLogoUrl && quote.customer_id) {
    const custLogo = await db.execute(sql`SELECT logo_url FROM customers WHERE id = ${quote.customer_id}`);
    emailLogoUrl = (custLogo.rows[0] as any)?.logo_url ?? null;
  }
  const customerLogoDataUrl = await fetchLogoDataUrl(emailLogoUrl);

  const { subject, html, text } = buildQuoteEmail({
    quoteNumber: quote.quote_number,
    customerName: quote.customer_name ?? null,
    contactFirstName,
    customerLogoDataUrl,
    quoteDate: quote.created_at,
    expiresAt: quote.expires_at ?? null,
    notes: null, // internal notes — not sent to customer
    coverText,
    portalLink,
    items,
  });

  // Generate PDF attachment
  let attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
  try {
    const pdfRows = itemRows.rows as any[];
    const uniqueImageUrls = [...new Set(pdfRows.map(r => r.product_image_url).filter(Boolean))] as string[];
    const imageMap = new Map<string, Buffer | null>();
    await Promise.all(uniqueImageUrls.map(async (url) => {
      imageMap.set(url, await fetchLogoBuffer(url));
    }));
    const pdfItems: QuotePdfItem[] = pdfRows.map(r => ({
      productName:  r.product_name,
      productUrl:   r.product_permalink ?? null,
      sku:          r.product_sku ?? null,
      description:  r.product_description ?? null,
      colour:       r.colour ?? null,
      size:         r.size ?? null,
      finishName:   r.finish_name ?? null,
      quantity:     Number(r.quantity),
      unitPrice:    Number(r.unit_price),
      vatRate:      Number(r.vat_rate ?? 0.20),
      imageBuffer:  r.product_image_url ? (imageMap.get(r.product_image_url) ?? null) : null,
      priceBreaks:  r.price_breaks ?? null,
    }));
    let sendLogoUrl: string | null = quote.customer_logo_url ?? null;
    if (!sendLogoUrl && quote.customer_id) {
      const custLogo = await db.execute(sql`SELECT logo_url FROM customers WHERE id = ${quote.customer_id}`);
      sendLogoUrl = (custLogo.rows[0] as any)?.logo_url ?? null;
    }
    const customerLogoBuffer = await fetchLogoBuffer(sendLogoUrl);
    const pdfBuffer = await generateQuotePdf({
      quoteNumber: quote.quote_number,
      customerName: quote.customer_name ?? "",
      quoteDate: quote.created_at,
      expiresAt: quote.expires_at ?? null,
      notes: null,
      items: pdfItems,
      customerLogoBuffer,
    });
    attachments = [{ filename: `Quote-${quote.quote_number}.pdf`, content: pdfBuffer, contentType: "application/pdf" }];
  } catch (_err) {
    // Non-fatal — email sends without attachment
  }

  const previewOnly = body.success ? (body.data.previewOnly ?? false) : false;
  const result = previewOnly
    ? { sent: false as const, error: null as string | null }
    : await sendEmail({ to: toEmail!, subject, html, text, attachments });

  // Update status to "sent" if still draft (and not preview)
  if (!previewOnly && result.sent && quote.status === "draft") {
    await db.execute(sql`UPDATE quotes SET status = 'sent', updated_at = now() WHERE id = ${id}`);
  }

  res.json({
    sent: result.sent,
    error: result.error,
    subject,
    html,
    text,
    to: toEmail ?? "",
    emailConfigured: isEmailConfigured,
    portalLink,
  });
});

// ─── Create order from quote (staff shortcut) ─────────────────────────────────
// Staff can confirm an order on behalf of a customer without going through the
// customer portal, e.g. when the customer accepts verbally or by email.
router.post("/quotes/:id/create-order", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const quoteRows = await db.execute(sql`SELECT * FROM quotes WHERE id = ${id}`);
  const quote = quoteRows.rows[0] as any;
  if (!quote) { res.status(404).json({ error: "Quote not found" }); return; }

  const itemRows = await db.execute(sql`
    SELECT * FROM quote_items WHERE quote_id = ${id} AND parent_item_id IS NULL ORDER BY sort_order, id
  `);
  const items = itemRows.rows as any[];
  if (items.length === 0) { res.status(400).json({ error: "Quote has no items" }); return; }

  // Generate next O-series order number
  const seqRows = await db.execute(sql`
    SELECT order_number FROM orders
    WHERE order_number ~ '^O[0-9]+$'
    ORDER BY LENGTH(order_number) DESC, order_number DESC
    LIMIT 1
  `);
  const lastNum = (seqRows.rows[0] as any)?.order_number as string | undefined;
  const nextNum = lastNum ? parseInt(lastNum.slice(1), 10) + 1 : 100;
  const orderNumber = `O${nextNum}`;

  const itemsTotal = items.reduce((s: number, i: any) => s + parseFloat(i.unit_price ?? "0") * (i.quantity ?? 1), 0);

  const orderResult = await db.execute(sql`
    INSERT INTO orders (order_number, customer_id, customer_name, status, source, total_amount, notes, order_date, quote_id)
    VALUES (${orderNumber}, ${quote.customer_id ?? null}, ${quote.customer_name}, 'new', 'quote', ${itemsTotal.toFixed(2)}, ${quote.notes ?? null}, now(), ${id})
    RETURNING id
  `);
  const orderId = (orderResult.rows[0] as any).id as number;

  for (const item of items) {
    const lineTotal = parseFloat(item.unit_price ?? "0") * (item.quantity ?? 1);
    await db.execute(sql`
      INSERT INTO order_items (order_id, product_id, product_name, colour, size, finish_name, quantity, unit_price, line_total)
      VALUES (${orderId}, ${item.product_id ?? null}, ${item.product_name}, ${item.colour ?? null}, ${item.size ?? null}, ${item.finish_name ?? null}, ${item.quantity ?? 1}, ${item.unit_price ?? "0"}, ${lineTotal.toFixed(2)})
    `);
  }

  // Mark quote as ordered
  await db.execute(sql`UPDATE quotes SET status = 'ordered', updated_at = now() WHERE id = ${id}`);

  res.status(201).json({ orderId, orderNumber });
});

export default router;
