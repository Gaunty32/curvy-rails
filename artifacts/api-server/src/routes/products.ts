import { Router, type IRouter } from "express";
import { eq, ilike, or, sql, and } from "drizzle-orm";
import { db, productsTable, productAttributesTable, productVariantsTable, settingsTable } from "@workspace/db";
import { z } from "zod";
import { getWooSettings } from "./woo.js";
import { wooRequest } from "../services/woo-outbound.js";
import { persistProductImage } from "../services/product-image-storage.js";
import {
  CreateProductBody,
  UpdateProductBody,
  GetProductParams,
  UpdateProductParams,
  DeleteProductParams,
  ListProductsQueryParams,
} from "@workspace/api-zod";

const BESPOKE_TIES_CATEGORY = "Bespoke Ties";

function normaliseColourKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase();
}

function normaliseWooCategoryIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0),
  )];
}

function isLegacyWordPressImage(value: string | null | undefined): boolean {
  return typeof value === "string" && value.includes("/wp-content/uploads/");
}

/**
 * Fire-and-forget helper: push one or more fields to WooCommerce for a product
 * that is already published. Silently no-ops if WooCommerce is not configured or the
 * product has no woo_commerce_id. Errors are logged to stderr only — the caller's HTTP
 * response is never blocked or failed by this call.
 */
async function pushFieldsToWoo(productId: number, fields: Record<string, unknown>): Promise<void> {
  try {
    const [product] = await db.execute(sql`
      SELECT woo_commerce_id, woo_status FROM products WHERE id = ${productId}
    `).then(r => (r.rows ?? r) as any[]);
    if (!product?.woo_commerce_id || product.woo_status !== "publish") return;

    const settings = await getWooSettings();
    if (!settings) return;

    const wooBase = settings.baseUrl.replace(/\/$/, "").replace(/^http:\/\//i, "https://");
    const url = new URL(`${wooBase}/wp-json/wc/v3/products/${product.woo_commerce_id}`);
    url.searchParams.set("consumer_key", settings.ck);
    url.searchParams.set("consumer_secret", settings.cs);

    const res = await wooRequest(url.toString(), {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.status.toString());
      console.error(`[woo] pushFieldsToWoo product ${productId} error ${res.status}: ${text}`);
    } else {
      console.log(`[woo] pushed ${Object.keys(fields).join(", ")} for product ${productId}`);
    }
  } catch (err) {
    console.error(`[woo] pushFieldsToWoo product ${productId}:`, err);
  }
}

async function pushVariantSkusToWoo(
  productId: number,
  wooVariationIds: number[],
  sku: string | null,
): Promise<void> {
  if (wooVariationIds.length === 0) return;
  try {
    const [product] = await db.execute(sql`
      SELECT woo_commerce_id, woo_status FROM products WHERE id = ${productId}
    `).then(r => (r.rows ?? r) as any[]);
    if (!product?.woo_commerce_id || product.woo_status !== "publish") return;

    const settings = await getWooSettings();
    if (!settings) return;
    const wooBase = settings.baseUrl.replace(/\/$/, "").replace(/^http:\/\//i, "https://");

    await Promise.all(wooVariationIds.map(async (variationId) => {
      const url = new URL(`${wooBase}/wp-json/wc/v3/products/${product.woo_commerce_id}/variations/${variationId}`);
      url.searchParams.set("consumer_key", settings.ck);
      url.searchParams.set("consumer_secret", settings.cs);
      const response = await wooRequest(url.toString(), {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ sku: sku ?? "" }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => response.status.toString());
        console.error(`[woo] variant SKU push ${variationId} error ${response.status}: ${text}`);
      }
    }));
  } catch (err) {
    console.error(`[woo] variant SKU push failed for product ${productId}:`, err);
  }
}

/**
 * Fire-and-forget helper: push an updated unit price to WooCommerce for a product
 * that is already published. Silently no-ops if WooCommerce is not configured or the
 * product has no woo_commerce_id. Errors are logged to stderr only — the caller's HTTP
 * response is never blocked or failed by this call.
 */
async function pushPriceToWoo(productId: number, priceStr: string): Promise<void> {
  try {
    const [product] = await db.execute(sql`
      SELECT woo_commerce_id, woo_status FROM products WHERE id = ${productId}
    `).then(r => (r.rows ?? r) as any[]);
    if (!product?.woo_commerce_id || product.woo_status !== "publish") return;

    const settings = await getWooSettings();
    if (!settings) return;

    const wooBase = settings.baseUrl.replace(/\/$/, "").replace(/^http:\/\//i, "https://");
    const wooProductId = product.woo_commerce_id;

    const parentUrl = new URL(`${wooBase}/wp-json/wc/v3/products/${wooProductId}`);
    parentUrl.searchParams.set("consumer_key", settings.ck);
    parentUrl.searchParams.set("consumer_secret", settings.cs);

    await wooRequest(parentUrl.toString(), {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ regular_price: priceStr }),
    });

    // For variable products: push to every variation as well
    const varRows = await db.execute(sql`
      SELECT woo_variation_id FROM product_variants
      WHERE product_id = ${productId} AND woo_variation_id IS NOT NULL
    `).then(r => (r.rows ?? r) as any[]);

    if (varRows.length > 0) {
      await Promise.all(varRows.map(async (v: any) => {
        const varUrl = new URL(`${wooBase}/wp-json/wc/v3/products/${wooProductId}/variations/${v.woo_variation_id}`);
        varUrl.searchParams.set("consumer_key", settings.ck);
        varUrl.searchParams.set("consumer_secret", settings.cs);
        await wooRequest(varUrl.toString(), {
          method: "PUT",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ regular_price: priceStr }),
        });
      }));
    }
  } catch (err) {
    console.error("[woo-price-push] failed:", err instanceof Error ? err.message : err);
  }
}

const BESPOKE_TIE_SIZES: { label: string; suffix: string; sortOrder: number }[] = [
  { label: "Full Length Tie", suffix: "FLT", sortOrder: 0 },
  { label: "Clip-On Tie",     suffix: "COT", sortOrder: 1 },
  { label: "Clip-on Cravat",  suffix: "COC", sortOrder: 2 },
];

// Renames applied when old short names are found in the DB
const BESPOKE_TIE_RENAMES: Record<string, string> = {
  "Full Length": "Full Length Tie",
  "Clip-On":     "Clip-On Tie",
};

type ProductSupplierInfo = {
  supplierId?: number | null;
  supplierCode?: string | null;
  supplierPrice?: string | number | null;
};

async function ensureBespokeTieSizes(
  productId: number,
  productSku?: string | null,
  supplierInfo?: ProductSupplierInfo,
): Promise<void> {
  // Rename any legacy short values first
  for (const [oldVal, newVal] of Object.entries(BESPOKE_TIE_RENAMES)) {
    await db.execute(sql`
      UPDATE product_attributes
      SET value = ${newVal}
      WHERE product_id = ${productId} AND type = 'size' AND value = ${oldVal}
    `);
  }

  // Ensure all three size attributes exist
  const existing = await db.select().from(productAttributesTable)
    .where(and(
      eq(productAttributesTable.productId, productId),
      eq(productAttributesTable.type, "size"),
    ));
  const existingValues = new Set(existing.map((a) => a.value));
  for (const s of BESPOKE_TIE_SIZES) {
    if (!existingValues.has(s.label)) {
      await db.insert(productAttributesTable).values(
        { productId, type: "size", value: s.label, sortOrder: s.sortOrder }
      );
    }
  }

  // Auto-create size-only variant rows with SKUs (if product has a SKU)
  if (productSku) {
    const existingVariants = await db.select().from(productVariantsTable)
      .where(eq(productVariantsTable.productId, productId));
    const existingSizes = new Set(existingVariants.map((v) => v.size).filter(Boolean));

    const primarySupplierId = supplierInfo?.supplierId ?? null;
    const supplierCode = supplierInfo?.supplierCode ?? null;
    const supplierPrice = supplierInfo?.supplierPrice != null
      ? String(supplierInfo.supplierPrice) : null;

    // Insert each missing variant individually so one failure doesn't block the others
    for (const s of BESPOKE_TIE_SIZES) {
      if (!existingSizes.has(s.label)) {
        await db.insert(productVariantsTable).values({
          productId,
          size: s.label,
          sku: `${productSku}-${s.suffix}`,
          stockQuantity: 0,
          primarySupplierId,
          supplierCode,
          supplierPrice,
        });
      }
    }

    // Back-fill supplier info on any existing variants that are missing it
    if (primarySupplierId) {
      for (const v of existingVariants) {
        if (!v.primarySupplierId) {
          await db.update(productVariantsTable)
            .set({ primarySupplierId, supplierCode, supplierPrice })
            .where(eq(productVariantsTable.id, v.id));
        }
      }
    }
  }
}

const router: IRouter = Router();

function fmtProduct(p: any) {
  return {
    ...p,
    unitPrice: p.unitPrice != null ? parseFloat(p.unitPrice) : 0,
    supplierPrice: p.supplierPrice != null ? parseFloat(p.supplierPrice) : null,
    secondarySupplierPrice: p.secondarySupplierPrice != null ? parseFloat(p.secondarySupplierPrice) : null,
    supplierCurrency: p.supplierCurrency ?? "GBP",
    minOrderQty: p.minOrderQty ?? null,
    priceBreaks: p.priceBreaks ?? null,
    isService: p.isService ?? false,
    isArchived: p.isArchived ?? p.is_archived ?? false,
    wooStatus: p.wooStatus ?? p.woo_status ?? null,
    websitePublished: p.websitePublished ?? p.website_published ?? false,
  };
}

router.get("/products", async (req, res): Promise<void> => {
  const query = ListProductsQueryParams.safeParse(req.query);
  const searchWords = query.success && query.data.search
    ? query.data.search.trim().split(/\s+/).filter(Boolean)
    : [];
  const includeArchived = req.query.include_archived === "true" || req.query.include_archived === "1";

  const wordClauses = searchWords.map(word => {
    const term = `%${word}%`;
    return sql`AND (p.name ILIKE ${term} OR p.sku ILIKE ${term} OR p.description ILIKE ${term} OR p.supplier_code ILIKE ${term})`;
  });

  const rows = await db.execute(sql`
    SELECT p.*,
           c.name AS customer_name,
           CASE
             WHEN EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id)
             THEN (SELECT COALESCE(SUM(pv.stock_quantity), 0) FROM product_variants pv WHERE pv.product_id = p.id)
             ELSE COALESCE(p.stock_quantity, 0)
           END AS computed_stock
    FROM products p
    LEFT JOIN customers c ON c.id = p.customer_id
    WHERE (${includeArchived} OR COALESCE(p.is_archived, false) = false)
      ${sql.join(wordClauses, sql` `)}
    ORDER BY p.name
  `);

  res.json(rows.rows.map((p: any) => ({
    ...p,
    unitPrice: p.unit_price != null ? parseFloat(p.unit_price) : 0,
    supplierPrice: p.supplier_price != null ? parseFloat(p.supplier_price) : null,
    secondarySupplierPrice: p.secondary_supplier_price != null ? parseFloat(p.secondary_supplier_price) : null,
    customerName: p.customer_name ?? null,
    isBespoke: p.is_bespoke ?? false,
    isService: p.is_service ?? false,
    isArchived: p.is_archived ?? false,
    customerId: p.customer_id ?? null,
    wooCommerceId: p.woo_commerce_id ?? null,
    wooStatus: p.woo_status ?? null,
    websitePublished: p.website_published ?? false,
    imageUrl: p.image_url ?? null,
    permalink: p.permalink ?? null,
    supplierId: p.supplier_id ?? null,
    supplierCode: p.supplier_code ?? null,
    wooCategoryIds: Array.isArray(p.product_category_ids)
      ? p.product_category_ids.map(Number).filter((id: number) => Number.isInteger(id) && id > 0)
      : null,
    stockQuantity: p.computed_stock != null ? Number(p.computed_stock) : (p.stock_quantity ?? null),
    vatRate: p.vat_rate != null ? parseFloat(String(p.vat_rate)) : 0.20,
    taxClass: p.tax_class ?? null,
  })));
});

router.post("/products", async (req, res): Promise<void> => {
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Enforce SKU uniqueness before insert to return a clear error
  if (parsed.data.sku) {
    const existing = await db.execute(sql`SELECT id, name FROM products WHERE sku = ${parsed.data.sku} AND is_archived = false LIMIT 1`);
    if ((existing.rows as any[]).length > 0) {
      const clash = existing.rows[0] as { id: number; name: string };
      res.status(409).json({ error: `SKU "${parsed.data.sku}" is already used by "${clash.name}" (product #${clash.id}). Please choose a different SKU.` });
      return;
    }
  }
  const category = typeof req.body.category === "string" ? req.body.category.trim() || null : null;
  const wooCategoryIds = "wooCategoryIds" in req.body
    ? normaliseWooCategoryIds(req.body.wooCategoryIds)
    : null;
  const customerId = req.body.customerId != null ? Number(req.body.customerId) || null : null;
  const isBespoke = customerId != null ? true : (req.body.isBespoke === true);
  const isService = req.body.isService === true;
  const websitePublished = !isBespoke
    && !isService
    && (req.body.websitePublished === true || parsed.data.websiteStatus === "publish");
  const [product] = await db
    .insert(productsTable)
    .values({
      ...parsed.data,
      category,
      wooCategoryIds: wooCategoryIds?.length ? wooCategoryIds : null,
      unitPrice: String(parsed.data.unitPrice),
      customerId,
      isBespoke,
      isService,
      websitePublished,
    })
    .returning();
  if (category === BESPOKE_TIES_CATEGORY) await ensureBespokeTieSizes(product.id, product.sku, product);
  res.status(201).json(fmtProduct(product));
});

async function nextBspSku(): Promise<string> {
  const result = await db.execute(sql`
    SELECT COALESCE(MAX(CAST(SUBSTRING(sku FROM 4) AS INTEGER)), 0) AS max_num
    FROM products WHERE sku ~ '^BSP[0-9]+$'
  `);
  const maxNum = (result.rows[0] as any)?.max_num ?? 0;
  return `BSP${String(Number(maxNum) + 1).padStart(3, "0")}`;
}

async function nextSku(): Promise<string> {
  const [setting] = await db.select({ value: settingsTable.value })
    .from(settingsTable).where(eq(settingsTable.key, "product_sku_prefix"));
  const proposed = setting?.value?.trim().toUpperCase() ?? "";
  const prefix = /^[A-Z][A-Z0-9]{1,7}$/.test(proposed) ? proposed : "SKU";
  const result = await db.execute(sql`
    SELECT COALESCE(MAX(CAST(SUBSTRING(sku FROM ${prefix.length + 1}) AS BIGINT)), 0) AS max_num
    FROM products WHERE sku ~ ${`^${prefix}[0-9]+$`}
  `);
  const maxNum = (result.rows[0] as any)?.max_num ?? 0;
  return `${prefix}${String(Number(maxNum) + 1).padStart(4, "0")}`;
}

router.get("/products/next-bsp-sku", async (_req, res): Promise<void> => {
  res.json({ sku: await nextBspSku() });
});

router.get("/products/next-sku", async (_req, res): Promise<void> => {
  res.json({ sku: await nextSku() });
});

router.get("/products/category-names", async (_req, res): Promise<void> => {
  const result = await db.execute(sql`
    SELECT DISTINCT TRIM(category) AS name
    FROM products
    WHERE category IS NOT NULL AND TRIM(category) <> ''
    ORDER BY name
  `);
  res.json((result.rows as any[]).map((r) => r.name as string));
});

router.post("/products/:id/duplicate", async (req, res): Promise<void> => {
  const params = GetProductParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [original] = await db.select().from(productsTable).where(eq(productsTable.id, params.data.id));
  if (!original) { res.status(404).json({ error: "Product not found" }); return; }

  const isBespoke = original.isBespoke ?? false;
  let newSku: string;
  if (isBespoke) {
    newSku = await nextBspSku();
  } else {
    const base = original.sku ? original.sku.replace(/-COPY\d*$/, "") : "";
    newSku = base ? `${base}-COPY` : "";
  }

  const [originalAttributes, originalVariants] = await Promise.all([
    db.select().from(productAttributesTable).where(eq(productAttributesTable.productId, original.id)),
    db.select().from(productVariantsTable).where(eq(productVariantsTable.productId, original.id)),
  ]);

  const { id: _id, createdAt: _ca, updatedAt: _ua, wooCommerceId: _woo, ...fields } = original;
  const created = await db.transaction(async (tx) => {
    const [copy] = await tx.insert(productsTable).values({
      ...fields,
      sku: newSku,
      name: `${original.name} (Copy)`,
      stockQuantity: 0,
      // A duplicate starts as a local product, not another link to the source
      // WooCommerce product.
      wooCommerceId: null,
      wooStatus: null,
    }).returning();

    if (originalAttributes.length > 0) {
      await tx.insert(productAttributesTable).values(
        originalAttributes.map(({ id: _attributeId, productId: _productId, createdAt: _attributeCreatedAt, ...attribute }) => ({
          ...attribute,
          productId: copy.id,
        })),
      );
    }

    if (originalVariants.length > 0) {
      await tx.insert(productVariantsTable).values(
        originalVariants.map(({
          id: _variantId,
          productId: _productId,
          createdAt: _variantCreatedAt,
          updatedAt: _variantUpdatedAt,
          wooVariationId: _wooVariationId,
          ...variant
        }) => ({
          ...variant,
          productId: copy.id,
          // Do not duplicate live stock or the source's Woo variation link.
          stockQuantity: 0,
          wooVariationId: null,
          // Variants that inherited the source SKU should inherit the new one;
          // preserve deliberately colour-specific codes.
          sku: !variant.sku || variant.sku === original.sku ? newSku : variant.sku,
        })),
      );
    }

    return copy;
  });
  if (created.category === BESPOKE_TIES_CATEGORY) await ensureBespokeTieSizes(created.id, created.sku, created);
  res.status(201).json(fmtProduct(created));
});

router.get("/products/issues", async (req, res): Promise<void> => {
  const rows = await db.execute(sql`
    SELECT
      p.id, p.name, p.sku, p.image_url, p.woo_commerce_id,
      p.unit_price, p.supplier_price,
      p.issue_no_image, p.issue_low_gp, p.issues_checked_at,
      s.name AS supplier_name,
      CASE
        WHEN p.supplier_price IS NOT NULL
          AND p.unit_price IS NOT NULL
          AND CAST(p.unit_price AS float) > 0
        THEN ROUND(
          ((CAST(p.unit_price AS float) - CAST(p.supplier_price AS float))
           / CAST(p.unit_price AS float) * 100)::numeric, 1)
        ELSE NULL
      END AS gp_pct,
      NULL::numeric AS suggested_price
    FROM products p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE (p.issue_no_image = true OR p.issue_low_gp = true)
      AND p.is_archived = false
      AND (p.issue_snoozed_until IS NULL OR p.issue_snoozed_until < NOW())
    ORDER BY p.issue_no_image DESC, gp_pct ASC NULLS LAST, p.name
  `);
  const products = ((rows.rows ?? rows) as any[]).map(r => ({
    id: r.id,
    name: r.name,
    sku: r.sku,
    imageUrl: r.image_url ?? null,
    supplierName: r.supplier_name ?? null,
    unitPrice: r.unit_price != null ? parseFloat(r.unit_price) : null,
    supplierPrice: r.supplier_price != null ? parseFloat(r.supplier_price) : null,
    gpPct: r.gp_pct != null ? parseFloat(r.gp_pct) : null,
    suggestedPrice: r.suggested_price != null ? parseFloat(r.suggested_price) : null,
    issueNoImage: r.issue_no_image,
    issueLowGp: r.issue_low_gp,
    wooCommerceId: r.woo_commerce_id ?? null,
    lastChecked: r.issues_checked_at ?? null,
  }));
  res.json({ products, total: products.length, lastChecked: products[0]?.lastChecked ?? null });
});

// ── Push a new sell price to the installation database + WooCommerce ─────────
router.post("/products/:id/push-woo-price", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const body = z.object({ newPrice: z.number().positive() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { id } = parsed.data;
  const { newPrice } = body.data;

  res.status(410).json({
    error: "Price publishing to WooCommerce has been retired. Save the product to update its local website price.",
  });
  return;

  // Update sell price in local DB
  await db.execute(sql`
    UPDATE products SET unit_price = ${newPrice.toFixed(2)} WHERE id = ${id}
  `);

  // Refresh issue flags for this product
  await db.execute(sql`
    UPDATE products SET
      issue_low_gp = (
        supplier_price IS NOT NULL AND unit_price IS NOT NULL
        AND CAST(unit_price AS float) > 0
        AND (CAST(unit_price AS float) - CAST(supplier_price AS float))
            / CAST(unit_price AS float) * 100 < 80
      ),
      issues_checked_at = NOW()
    WHERE id = ${id}
  `);

  // Push to WooCommerce if configured
  let [product] = await db.execute(sql`SELECT woo_commerce_id, sku FROM products WHERE id = ${id}`).then(r => (r.rows ?? r) as any[]);

  const settings = await getWooSettings();
  if (!settings) {
    res.json({ ok: true, wooPushed: false, message: "Price updated locally (WooCommerce not configured)" });
    return;
  }

  // Auto-discover WooCommerce ID by SKU if not yet linked
  if (!product?.woo_commerce_id && product?.sku) {
    try {
      const wooBase0 = settings.baseUrl.replace(/\/$/, "").replace(/^http:\/\//i, "https://");
      const searchUrl = new URL(`${wooBase0}/wp-json/wc/v3/products`);
      searchUrl.searchParams.set("consumer_key", settings.ck);
      searchUrl.searchParams.set("consumer_secret", settings.cs);
      searchUrl.searchParams.set("sku", product.sku);
      searchUrl.searchParams.set("per_page", "5");
      const searchRes = await wooRequest(searchUrl.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
      if (searchRes.ok) {
        const hits = await searchRes.json() as Array<{ id: number; sku: string }>;
        const match = hits.find((h) => h.sku === product.sku);
        if (match) {
          await db.execute(sql`UPDATE products SET woo_commerce_id = ${String(match.id)} WHERE id = ${id}`);
          product = { ...product, woo_commerce_id: String(match.id) };
        }
      }
    } catch { /* fall through — will respond with wooPushed: false below */ }
  }

  if (!product?.woo_commerce_id) {
    res.json({ ok: true, wooPushed: false, message: "Price updated locally (product not found in WooCommerce — publish it first)" });
    return;
  }

  const wooBase = settings.baseUrl.replace(/\/$/, "").replace(/^http:\/\//i, "https://");
  const priceStr = newPrice.toFixed(2);

  // Push to parent product
  const url = new URL(`${wooBase}/wp-json/wc/v3/products/${product.woo_commerce_id}`);
  url.searchParams.set("consumer_key", settings.ck);
  url.searchParams.set("consumer_secret", settings.cs);

  const wooRes = await wooRequest(url.toString(), {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ regular_price: priceStr }),
  });

  if (!wooRes.ok) {
    const text = await wooRes.text().catch(() => wooRes.status.toString());
    res.status(502).json({ error: `Price updated locally but WooCommerce returned ${wooRes.status}: ${text}` });
    return;
  }

  // For variable products: WooCommerce ignores the parent regular_price — the displayed
  // price comes from each variation. Push to every variation so the price range updates.
  let varRows = await db.execute(sql`
    SELECT id, sku, woo_variation_id FROM product_variants
    WHERE product_id = ${id} AND woo_variation_id IS NOT NULL
  `).then(r => (r.rows ?? r) as any[]);

  // Discover WooCommerce variations — fetch all pages
  const discoverWooVariations = async (): Promise<Array<{ id: number; sku: string }>> => {
    const all: Array<{ id: number; sku: string }> = [];
    let page = 1;
    while (true) {
      const listUrl = new URL(`${wooBase}/wp-json/wc/v3/products/${product.woo_commerce_id}/variations`);
      listUrl.searchParams.set("consumer_key", settings.ck);
      listUrl.searchParams.set("consumer_secret", settings.cs);
      listUrl.searchParams.set("per_page", "100");
      listUrl.searchParams.set("page", String(page));
      const listRes = await wooRequest(listUrl.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      if (!listRes.ok) break;
      const batch = await listRes.json() as Array<{ id: number; sku: string }>;
      if (batch.length === 0) break;
      all.push(...batch);
      if (batch.length < 100) break;
      page++;
    }
    return all;
  };

  // If no variation IDs are stored locally, discover them from WooCommerce
  if (varRows.length === 0) {
    try {
      const allWooVars = await discoverWooVariations();

      if (allWooVars.length > 0) {
        const localVars = await db.execute(sql`
          SELECT id, sku FROM product_variants WHERE product_id = ${id}
        `).then(r => (r.rows ?? r) as any[]);

        // Match by SKU where possible; fall back to positional match if no SKUs on WooCommerce variations
        const hasSku = allWooVars.some((wv) => !!wv.sku);
        if (hasSku) {
          for (const lv of localVars) {
            const match = allWooVars.find((wv) => wv.sku && lv.sku && wv.sku === lv.sku);
            if (match) {
              await db.execute(sql`UPDATE product_variants SET woo_variation_id = ${String(match.id)} WHERE id = ${lv.id}`);
            }
          }
        }

        // Reload saved IDs
        varRows = await db.execute(sql`
          SELECT id, sku, woo_variation_id FROM product_variants
          WHERE product_id = ${id} AND woo_variation_id IS NOT NULL
        `).then(r => (r.rows ?? r) as any[]);

        // If SKU matching found nothing (blank WooCommerce SKUs), push directly using discovered IDs
        if (varRows.length === 0 && allWooVars.length > 0) {
          // Push price to all discovered WooCommerce variation IDs
          let variationsPushed = 0;
          const errors: string[] = [];
          await Promise.all(allWooVars.map(async (wv) => {
            const varUrl = new URL(`${wooBase}/wp-json/wc/v3/products/${product.woo_commerce_id}/variations/${wv.id}`);
            varUrl.searchParams.set("consumer_key", settings.ck);
            varUrl.searchParams.set("consumer_secret", settings.cs);
            const r = await wooRequest(varUrl.toString(), {
              method: "PUT",
              headers: { "Content-Type": "application/json", "Accept": "application/json" },
              body: JSON.stringify({ regular_price: priceStr }),
            });
            if (r.ok) variationsPushed++;
            else {
              const txt = await r.text().catch(() => r.status.toString());
              errors.push(`var ${wv.id}: ${txt.slice(0, 120)}`);
            }
          }));
          res.json({ ok: true, wooPushed: true, newPrice, variationsPushed, variationsTotal: allWooVars.length, note: "Pushed by WooCommerce variation ID (no SKU match)", errors: errors.length ? errors : undefined });
          return;
        }
      }
    } catch (e) { /* fall through */ }
  }

  let variationsPushed = 0;
  const varErrors: string[] = [];
  if (varRows.length > 0) {
    await Promise.all(varRows.map(async (v: any) => {
      const varUrl = new URL(`${wooBase}/wp-json/wc/v3/products/${product.woo_commerce_id}/variations/${v.woo_variation_id}`);
      varUrl.searchParams.set("consumer_key", settings.ck);
      varUrl.searchParams.set("consumer_secret", settings.cs);
      const r = await wooRequest(varUrl.toString(), {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ regular_price: priceStr }),
      });
      if (r.ok) variationsPushed++;
      else {
        const txt = await r.text().catch(() => r.status.toString());
        varErrors.push(`var ${v.woo_variation_id}: ${txt.slice(0, 120)}`);
      }
    }));
  }

  res.json({ ok: true, wooPushed: true, newPrice, variationsPushed, variationsTotal: varRows.length, errors: varErrors.length ? varErrors : undefined });
});

// ── Refresh WooCommerce status + price from live WooCommerce ─────────────────
router.get("/products/:id/woo-refresh", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { id } = parsed.data;

  const [product] = await db.execute(sql`SELECT woo_commerce_id, sku FROM products WHERE id = ${id}`).then(r => (r.rows ?? r) as any[]);
  const settings = await getWooSettings();
  if (!settings) { res.json({ ok: false, message: "WooCommerce not configured" }); return; }

  let wooId = product?.woo_commerce_id;

  // Auto-discover if no woo_commerce_id yet
  if (!wooId && product?.sku) {
    const wooBase0 = settings.baseUrl.replace(/\/$/, "").replace(/^http:\/\//i, "https://");
    const searchUrl = new URL(`${wooBase0}/wp-json/wc/v3/products`);
    searchUrl.searchParams.set("consumer_key", settings.ck);
    searchUrl.searchParams.set("consumer_secret", settings.cs);
    searchUrl.searchParams.set("sku", product.sku);
    searchUrl.searchParams.set("per_page", "5");
    const sr = await wooRequest(searchUrl.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (sr?.ok) {
      const hits = await sr.json() as Array<{ id: number; sku: string }>;
      const match = hits.find((h) => h.sku === product.sku);
      if (match) {
        wooId = String(match.id);
        await db.execute(sql`UPDATE products SET woo_commerce_id = ${wooId} WHERE id = ${id}`);
      }
    }
  }

  if (!wooId) { res.json({ ok: false, message: "Product not found in WooCommerce" }); return; }

  const wooBase = settings.baseUrl.replace(/\/$/, "").replace(/^http:\/\//i, "https://");
  const url = new URL(`${wooBase}/wp-json/wc/v3/products/${wooId}`);
  url.searchParams.set("consumer_key", settings.ck);
  url.searchParams.set("consumer_secret", settings.cs);

  const r = await wooRequest(url.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!r?.ok) {
    const txt = await r?.text().catch(() => "") ?? "";
    res.json({ ok: false, message: `WooCommerce returned ${r?.status ?? "error"}: ${txt.slice(0, 200)}` });
    return;
  }

  const wooProduct = await r.json() as { id: number; status: string; regular_price: string; price: string };
  // Save status back to local DB
  await db.execute(sql`UPDATE products SET woo_status = ${wooProduct.status}, woo_commerce_id = ${String(wooProduct.id)}, updated_at = NOW() WHERE id = ${id}`);

  res.json({ ok: true, status: wooProduct.status, regularPrice: wooProduct.regular_price || wooProduct.price, wooId: wooProduct.id });
});

// ── Pull image + permalink from WooCommerce for social post composer ─────────
router.get("/products/:id/pull-woo-media", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { id } = parsed.data;

  const [product] = await db.execute(sql`SELECT woo_commerce_id FROM products WHERE id = ${id}`).then(r => (r.rows ?? r) as any[]);
  if (!product?.woo_commerce_id) { res.status(400).json({ error: "No WooCommerce ID linked to this product." }); return; }

  const settings = await getWooSettings();
  if (!settings) { res.status(400).json({ error: "WooCommerce not configured." }); return; }

  const wooBase = settings.baseUrl.replace(/\/$/, "").replace(/^http:\/\//i, "https://");
  const url = new URL(`${wooBase}/wp-json/wc/v3/products/${product.woo_commerce_id}`);
  url.searchParams.set("consumer_key", settings.ck);
  url.searchParams.set("consumer_secret", settings.cs);

  const r = await wooRequest(url.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!r?.ok) {
    const txt = await r?.text().catch(() => "") ?? "";
    res.status(502).json({ error: `WooCommerce returned ${r?.status ?? "error"}: ${txt.slice(0, 200)}` });
    return;
  }

  const woo = await r.json() as { images?: Array<{ src: string }>; permalink?: string };
  const remoteImageUrl: string | null = woo.images?.[0]?.src ?? null;
  const imageUrl = remoteImageUrl
    ? await persistProductImage(remoteImageUrl).catch(() => null)
    : null;
  const permalink: string | null = woo.permalink ?? null;

  // Save only an image whose bytes have been validated and stored locally.
  // This legacy action remains available for social content, but must not
  // restore a dependency on the retired WordPress media host.
  await db.execute(sql`
    UPDATE products SET
      image_url = COALESCE(${imageUrl}, image_url),
      permalink = COALESCE(${permalink}, permalink),
      updated_at = NOW()
    WHERE id = ${id}
  `);

  // Also pull variation images from WooCommerce and save to product_variants
  const varUrl = new URL(`${wooBase}/wp-json/wc/v3/products/${product.woo_commerce_id}/variations`);
  varUrl.searchParams.set("consumer_key", settings.ck);
  varUrl.searchParams.set("consumer_secret", settings.cs);
  varUrl.searchParams.set("per_page", "100");
  const varR = await wooRequest(varUrl.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const variantImages: Array<{ colour: string; imageUrl: string }> = [];
  if (varR?.ok) {
    const variations = await varR.json() as Array<{
      attributes?: Array<{ name: string; option: string }>;
      image?: { src?: string };
    }>;
    for (const v of variations) {
      const imgSrc = v.image?.src;
      if (!imgSrc) continue;
      const storedImageUrl = await persistProductImage(imgSrc).catch(() => null);
      if (!storedImageUrl) continue;
      const colourAttr = v.attributes?.find(a =>
        ["colour", "color", "pa_colour", "pa_color"].includes(a.name.toLowerCase())
      );
      const colour = colourAttr?.option;
      if (!colour) continue;
      // Update matching variants in our DB (match by product_id + colour, case-insensitive)
      await db.execute(sql`
        UPDATE product_variants
        SET image_url = ${storedImageUrl}
        WHERE product_id = ${id}
          AND LOWER(colour) = LOWER(${colour})
          AND (image_url IS NULL OR image_url = '')
      `);
      variantImages.push({ colour, imageUrl: storedImageUrl });
    }
  }

  res.json({ imageUrl, permalink, variantImages });
});

// ── Push WooCommerce publish status (draft ↔ publish) ──────────────────────
router.post("/products/:id/push-woo-status", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const body = z.object({ status: z.enum(["draft", "publish"]), unitPrice: z.number().positive().optional() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { id } = parsed.data;
  res.status(410).json({
    error: "WooCommerce publication has been retired. Use the shop publication toggle instead.",
  });
  return;

  const { status, unitPrice } = body.data;

  // If the caller supplies unitPrice (i.e. the form has unsaved changes), persist it now
  // so the WooCommerce push always reflects the latest value — not a stale DB value.
  if (unitPrice !== undefined) {
    await db.execute(sql`UPDATE products SET unit_price = ${unitPrice.toFixed(2)}, updated_at = NOW() WHERE id = ${id}`);
  }

  await db.execute(sql`UPDATE products SET woo_status = ${status} WHERE id = ${id}`);

  let [product] = await db.execute(sql`SELECT woo_commerce_id, unit_price, sku FROM products WHERE id = ${id}`).then(r => (r.rows ?? r) as any[]);

  const settings = await getWooSettings();
  if (!settings) {
    res.json({ ok: true, wooPushed: false, status, message: "Status saved locally (WooCommerce not configured)" });
    return;
  }

  // Auto-discover WooCommerce ID by SKU if not yet linked
  if (!product?.woo_commerce_id && product?.sku) {
    try {
      const wooBase0 = settings.baseUrl.replace(/\/$/, "").replace(/^http:\/\//i, "https://");
      const searchUrl = new URL(`${wooBase0}/wp-json/wc/v3/products`);
      searchUrl.searchParams.set("consumer_key", settings.ck);
      searchUrl.searchParams.set("consumer_secret", settings.cs);
      searchUrl.searchParams.set("sku", product.sku);
      searchUrl.searchParams.set("per_page", "5");
      const searchRes = await wooRequest(searchUrl.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
      if (searchRes.ok) {
        const hits = await searchRes.json() as Array<{ id: number; sku: string }>;
        const match = hits.find((h) => h.sku === product.sku);
        if (match) {
          await db.execute(sql`UPDATE products SET woo_commerce_id = ${String(match.id)} WHERE id = ${id}`);
          product = { ...product, woo_commerce_id: String(match.id) };
        }
      }
    } catch { /* fall through */ }
  }

  if (!product?.woo_commerce_id) {
    res.json({ ok: true, wooPushed: false, status, message: "Status saved locally (product not found in WooCommerce — publish it first)" });
    return;
  }

  // Force HTTPS — WordPress HTTP→HTTPS 301 redirects silently downgrade PUT to GET
  const wooBase = settings.baseUrl.replace(/\/$/, "").replace(/^http:\/\//i, "https://");
  const wooProductId = product.woo_commerce_id;
  const priceStr = product.unit_price != null ? parseFloat(product.unit_price).toFixed(2) : null;

  // ── Update parent product (status + regular_price) ────────────────────────
  const parentUrl = new URL(`${wooBase}/wp-json/wc/v3/products/${wooProductId}`);
  parentUrl.searchParams.set("consumer_key", settings.ck);
  parentUrl.searchParams.set("consumer_secret", settings.cs);

  const wooPayload: Record<string, string> = { status };
  if (priceStr != null) wooPayload.regular_price = priceStr;

  const wooRes = await wooRequest(parentUrl.toString(), {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(wooPayload),
  });

  if (!wooRes.ok) {
    const text = await wooRes.text().catch(() => wooRes.status.toString());
    res.status(502).json({ error: `Status saved locally but WooCommerce returned ${wooRes.status}: ${text}` });
    return;
  }

  // ── For variable products: also push price to every variation ─────────────
  // WooCommerce ignores parent-level regular_price for variable products;
  // the price shown is controlled entirely by each variation record.
  let variationsPushed = 0;
  if (priceStr != null) {
    const varRows = await db.execute(sql`
      SELECT woo_variation_id FROM product_variants
      WHERE product_id = ${id} AND woo_variation_id IS NOT NULL
    `).then(r => (r.rows ?? r) as any[]);

    if (varRows.length > 0) {
      await Promise.all(varRows.map(async (v: any) => {
        const varUrl = new URL(`${wooBase}/wp-json/wc/v3/products/${wooProductId}/variations/${v.woo_variation_id}`);
        varUrl.searchParams.set("consumer_key", settings.ck);
        varUrl.searchParams.set("consumer_secret", settings.cs);
        const r = await wooRequest(varUrl.toString(), {
          method: "PUT",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ regular_price: priceStr }),
        });
        if (r.ok) variationsPushed++;
      }));
    }
  }

  res.json({ ok: true, wooPushed: true, status, pricePushed: priceStr != null, variationsPushed });
});

router.get("/products/analytics", async (req, res): Promise<void> => {
  const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };

  const rows = await db.execute(sql`
    SELECT
      p.id,
      p.sku,
      p.name,
      p.unit_price,
      p.supplier_price,
      p.supplier_currency,
      s.name AS supplier_name,
      COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN oi.quantity ELSE 0 END), 0) AS qty_sold,
      COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN oi.line_total::numeric ELSE 0 END), 0) AS revenue
    FROM products p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN order_items oi ON oi.product_id = p.id
    LEFT JOIN orders o ON o.id = oi.order_id
      AND o.status NOT IN ('cancelled', 'portal_draft', 'draft')
      ${dateFrom ? sql`AND o.order_date >= ${dateFrom}::date` : sql``}
      ${dateTo ? sql`AND o.order_date < ${dateTo}::date + interval '1 day'` : sql``}
    GROUP BY p.id, p.sku, p.name, p.unit_price, p.supplier_price, p.supplier_currency, s.name
    ORDER BY p.name
  `);

  res.json((rows.rows as any[]).map((r) => {
    const price = r.unit_price != null ? parseFloat(r.unit_price) : 0;
    const cost = r.supplier_price != null ? parseFloat(r.supplier_price) : null;
    const gp = cost != null && price > 0 ? ((price - cost) / price) * 100 : null;
    return {
      id: r.id,
      sku: r.sku ?? "",
      name: r.name,
      supplierName: r.supplier_name ?? null,
      price,
      supplierCost: cost,
      supplierCurrency: r.supplier_currency ?? "GBP",
      grossProfitPct: gp != null ? Math.round(gp * 10) / 10 : null,
      qtySold: Number(r.qty_sold),
      revenue: parseFloat(r.revenue ?? "0"),
    };
  }));
});

router.get("/products/:id", async (req, res): Promise<void> => {
  const params = GetProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, params.data.id));
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.json(fmtProduct(product));
});

// ── Local shop publication ──────────────────────────────────────────────────
router.patch("/products/:id/website-publication", async (req, res): Promise<void> => {
  const params = UpdateProductParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = z.object({ published: z.boolean() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [product] = await db.execute(sql`
    SELECT id, is_archived, is_service, is_bespoke, image_url
    FROM products WHERE id = ${params.data.id} LIMIT 1
  `).then(r => (r.rows ?? r) as any[]);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  if (body.data.published) {
    if (product.is_archived || product.is_service || product.is_bespoke) {
      res.status(400).json({ error: "Only active standard products can be published to the website." });
      return;
    }
    if (!product.image_url || !String(product.image_url).trim()) {
      res.status(400).json({ error: "Add a main product image before publishing this product to the website." });
      return;
    }
  }

  const [updated] = await db.update(productsTable)
    .set({ websitePublished: body.data.published, updatedAt: new Date() })
    .where(eq(productsTable.id, params.data.id))
    .returning();
  res.json(fmtProduct(updated));
});

router.patch("/products/:id", async (req, res): Promise<void> => {
  const params = UpdateProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Enforce SKU uniqueness when SKU is being changed
  if (parsed.data.sku !== undefined && parsed.data.sku !== null) {
    const existing = await db.execute(sql`
      SELECT id, name FROM products
      WHERE sku = ${parsed.data.sku} AND id <> ${params.data.id} AND is_archived = false
      LIMIT 1
    `);
    if ((existing.rows as any[]).length > 0) {
      const clash = existing.rows[0] as { id: number; name: string };
      res.status(409).json({ error: `SKU "${parsed.data.sku}" is already used by "${clash.name}" (product #${clash.id}). Please choose a different SKU.` });
      return;
    }
  }
  const [previousProduct] = await db
    .select({ id: productsTable.id, sku: productsTable.sku })
    .from(productsTable)
    .where(eq(productsTable.id, params.data.id));
  if (!previousProduct) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  const updateData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if ("wooCategoryIds" in req.body) {
    const categoryIds = normaliseWooCategoryIds(req.body.wooCategoryIds);
    updateData.wooCategoryIds = categoryIds.length ? categoryIds : null;
  }
  if (parsed.data.unitPrice !== undefined) {
    updateData.unitPrice = String(parsed.data.unitPrice);
  }
  if ("category" in req.body) {
    updateData.category = typeof req.body.category === "string" ? req.body.category.trim() || null : null;
  }
  if ("customerId" in req.body) {
    const cid = req.body.customerId != null ? Number(req.body.customerId) || null : null;
    updateData.customerId = cid;
    if (cid != null) updateData.isBespoke = true;
  }
  if ("isBespoke" in req.body) {
    updateData.isBespoke = req.body.isBespoke === true;
    if (req.body.isBespoke === false) updateData.customerId = null;
  }
  if ("isService" in req.body) {
    updateData.isService = req.body.isService === true;
  }
  if ("websitePublished" in req.body) {
    updateData.websitePublished = req.body.websitePublished === true;
  } else if ("websiteStatus" in req.body) {
    // Backwards-compatible form input; it is now a local shop setting.
    updateData.websitePublished = req.body.websiteStatus === "publish";
  }
  if ("isArchived" in req.body) {
    updateData.isArchived = req.body.isArchived === true;
  }
  // Bespoke and service products must never be exposed in the public shop.
  if (updateData.isBespoke === true || updateData.isService === true) {
    updateData.websitePublished = false;
  }
  if ("supplierCurrency" in req.body) {
    updateData.supplierCurrency = typeof req.body.supplierCurrency === "string" ? req.body.supplierCurrency : "GBP";
  }
  if ("minOrderQty" in req.body) {
    updateData.minOrderQty = req.body.minOrderQty != null ? Number(req.body.minOrderQty) || null : null;
  }
  if ("priceBreaks" in req.body) {
    updateData.priceBreaks = Array.isArray(req.body.priceBreaks) ? req.body.priceBreaks : null;
  }
  if ("supplierPrice" in req.body) {
    updateData.supplierPrice = req.body.supplierPrice != null && req.body.supplierPrice !== "" ? String(req.body.supplierPrice) : null;
  }
  if ("secondarySupplierPrice" in req.body) {
    updateData.secondarySupplierPrice = req.body.secondarySupplierPrice != null && req.body.secondarySupplierPrice !== "" ? String(req.body.secondarySupplierPrice) : null;
  }
  if ("supplierCode" in req.body) {
    updateData.supplierCode = req.body.supplierCode || null;
  }
  if ("secondarySupplierCode" in req.body) {
    updateData.secondarySupplierCode = req.body.secondarySupplierCode || null;
  }
  if ("guidanceBestFor" in req.body) {
    updateData.guidanceBestFor = req.body.guidanceBestFor || null;
  }
  if ("guidanceNotIdealFor" in req.body) {
    updateData.guidanceNotIdealFor = req.body.guidanceNotIdealFor || null;
  }
  if ("guidanceTags" in req.body) {
    updateData.guidanceTags = Array.isArray(req.body.guidanceTags) ? req.body.guidanceTags : null;
  }
  if ("guidanceBadges" in req.body) {
    updateData.guidanceBadges = Array.isArray(req.body.guidanceBadges) ? req.body.guidanceBadges : null;
  }
  if ("guidanceStaffQuotes" in req.body) {
    updateData.guidanceStaffQuotes = Array.isArray(req.body.guidanceStaffQuotes) ? req.body.guidanceStaffQuotes : null;
  }
  if ("brandingPositionsOverride" in req.body) {
    // null = use global defaults, [] = no branding, [...] = custom list
    updateData.brandingPositionsOverride =
      req.body.brandingPositionsOverride === null ? null
      : Array.isArray(req.body.brandingPositionsOverride) ? req.body.brandingPositionsOverride
      : null;
  }
  const [product] = await db
    .update(productsTable)
    .set(updateData)
    .where(eq(productsTable.id, params.data.id))
    .returning();
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  if (parsed.data.sku !== undefined && product.sku !== previousProduct.sku) {
    const inheritedVariants = await db.execute(sql`
      SELECT woo_variation_id
      FROM product_variants
      WHERE product_id = ${product.id}
        AND (
          sku IS NULL
          OR TRIM(sku) = ''
          OR sku IS NOT DISTINCT FROM ${previousProduct.sku}
        )
    `).then(r => (r.rows ?? r) as Array<{ woo_variation_id: number | null }>);

    await db.execute(sql`
      UPDATE product_variants
      SET sku = ${product.sku}, updated_at = NOW()
      WHERE product_id = ${product.id}
        AND (
          sku IS NULL
          OR TRIM(sku) = ''
          OR sku IS NOT DISTINCT FROM ${previousProduct.sku}
        )
    `);

    const wooVariationIds = inheritedVariants
      .map((variant) => Number(variant.woo_variation_id))
      .filter((id) => Number.isInteger(id) && id > 0);
    void pushFieldsToWoo(product.id, { sku: product.sku ?? "" });
    void pushVariantSkusToWoo(product.id, wooVariationIds, product.sku);
  }
  // Cascade supplier price changes to variants so order GP% reflects the new cost.
  // Variant-level supplier_price acts as an override; updating the product price resets
  // all variants to inherit the new product price (they can be individually overridden after).
  if ("supplierPrice" in req.body) {
    const newPrice = updateData.supplierPrice != null ? String(updateData.supplierPrice) : null;
    await db.execute(sql`
      UPDATE product_variants
      SET supplier_price = ${newPrice}
      WHERE product_id = ${params.data.id}
    `);
  }
  if ("secondarySupplierPrice" in req.body) {
    const newPrice = updateData.secondarySupplierPrice != null ? String(updateData.secondarySupplierPrice) : null;
    await db.execute(sql`
      UPDATE product_variants
      SET secondary_supplier_price = ${newPrice}
      WHERE product_id = ${params.data.id}
    `);
  }
  if (product.category === BESPOKE_TIES_CATEGORY) await ensureBespokeTieSizes(product.id, product.sku, product);

  // Refresh issue flags whenever price-relevant fields change
  if (parsed.data.unitPrice !== undefined || "supplierPrice" in req.body || "imageUrl" in req.body) {
    await db.execute(sql`
      UPDATE products SET
        issue_no_image = (image_url IS NULL OR TRIM(image_url) = '' OR image_url LIKE 'blob:%'),
        issue_low_gp = (
          supplier_price IS NOT NULL AND unit_price IS NOT NULL
          AND CAST(unit_price AS float) > 0
          AND (CAST(unit_price AS float) - CAST(supplier_price AS float))
              / CAST(unit_price AS float) * 100 < 80
        ),
        issues_checked_at = NOW()
      WHERE id = ${params.data.id}
    `);
  }

  // Names and categories may still be maintained in WooCommerce, but prices
  // are now owned by the installation and are never written back to WooCommerce.
  if (parsed.data.name !== undefined && parsed.data.name) {
    void pushFieldsToWoo(product.id, { name: parsed.data.name });
  }
  // Push the complete category selection to WooCommerce. Prefer retained category
  // IDs; the legacy category name is only a fallback for older product records.
  if ("wooCategoryIds" in req.body || "category" in req.body) {
    void (async () => {
      try {
        let categoryIds = Array.isArray(product.wooCategoryIds)
          ? product.wooCategoryIds
            .map(Number)
            .filter((id: number) => Number.isInteger(id) && id > 0)
          : [];

        if (categoryIds.length === 0 && product.category) {
          const [catRow] = await db.execute(sql`
            SELECT woo_id FROM product_categories
            WHERE LOWER(TRIM(name)) = LOWER(TRIM(${product.category}))
            LIMIT 1
          `).then(r => (r.rows ?? r) as any[]);
          if (catRow?.woo_id) categoryIds = [Number(catRow.woo_id)];
        }

        void pushFieldsToWoo(product.id, {
          categories: [...new Set(categoryIds)].map((id) => ({ id })),
        });
      } catch (err) {
        console.error("[woo] category push lookup failed:", err);
      }
    })();
  }

  res.json(fmtProduct(product));
});

// ── Snooze product issue warnings for 30 days ──────────────────────────────
router.post("/products/:id/snooze-issue", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  await db.execute(sql`
    UPDATE products SET issue_snoozed_until = NOW() + INTERVAL '30 days' WHERE id = ${parsed.data.id}
  `);
  res.json({ ok: true });
});

router.delete("/products/:id", async (req, res): Promise<void> => {
  const params = DeleteProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [product] = await db.delete(productsTable).where(eq(productsTable.id, params.data.id)).returning();
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.sendStatus(204);
});

// ── Push guidance data to WooCommerce as product meta ─────────────────────────
router.post("/products/:id/push-woo-guidance", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Resolve a public base URL so relative /api/storage/... image paths become
  // absolute URLs that WooCommerce can fetch from outside our server.
  const publicBase = (() => {
    const domains = process.env.REPLIT_DOMAINS ?? "";
    const first = domains.split(",")[0]?.trim();
    if (first) return `https://${first}`;
    const fwdHost = req.headers["x-forwarded-host"] as string | undefined;
    const host = fwdHost ?? req.headers.host ?? "";
    return host ? `${req.protocol}://${host}` : "";
  })();
  const toAbsolute = (url: string | null | undefined): string | null => {
    if (!url) return null;
    return url.startsWith("/") ? `${publicBase}${url}` : url;
  };

  const rows = await db.execute(sql`
    SELECT woo_commerce_id,
           guidance_value_rating, guidance_durability_rating, guidance_smart_rating,
           guidance_badges, guidance_tags, guidance_best_for, guidance_not_ideal_for,
           guidance_staff_quotes
    FROM products WHERE id = ${parsed.data.id}
  `);
  const product = (rows.rows ?? rows)[0] as any;
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  if (!product.woo_commerce_id) { res.status(400).json({ error: "This product has no WooCommerce ID — it cannot be synced." }); return; }

  const settings = await getWooSettings();
  if (!settings) { res.status(400).json({ error: "WooCommerce not configured. Check Settings → WooCommerce." }); return; }

  // Convert a numeric rating (1–5) to a unicode star string e.g. "★★★★☆"
  function toStars(rating: any, max = 5): string {
    const n = Math.min(Math.max(parseInt(String(rating ?? 0), 10) || 0, 0), max);
    return "★".repeat(n) + "☆".repeat(max - n);
  }

  const valRating  = parseInt(String(product.guidance_value_rating       ?? 0), 10) || 0;
  const durRating  = parseInt(String(product.guidance_durability_rating   ?? 0), 10) || 0;
  const techRating = parseInt(String(product.guidance_smart_rating        ?? 0), 10) || 0;

  // ── Ratings — card grid with large amber stars ─────────────────────────────
  const ratingItems = [
    { label: "Value for Money",    n: valRating  },
    { label: "Durability",         n: durRating  },
    { label: "Technical Features", n: techRating },
  ].filter(r => r.n > 0);

  const ratingsHtml = ratingItems.length === 0 ? "" :
    `<div style="display:flex;flex-wrap:wrap;gap:12px;padding:16px 20px;background:linear-gradient(135deg,#1e3a5f 0%,#2d5491 100%);border-radius:14px;margin-bottom:20px">` +
    ratingItems.map(r =>
      `<div style="flex:1;min-width:110px;text-align:center">` +
        `<div style="font-size:0.65em;font-weight:700;color:#93c5fd;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px">${r.label}</div>` +
        `<div style="color:#fbbf24;font-size:1.7em;letter-spacing:2px;line-height:1">${"★".repeat(r.n)}${"☆".repeat(5 - r.n)}</div>` +
        `<div style="font-size:0.7em;color:#bfdbfe;margin-top:4px;font-weight:600">${r.n} / 5</div>` +
      `</div>`
    ).join("") +
    `</div>`;

  // ── Badge pills — bold coloured with shadow ───────────────────────────────
  const BADGE_STYLES: Record<string, { icon: string; bg: string; color: string; shadow: string }> = {
    "Most Popular":      { icon: "🏆", bg: "linear-gradient(135deg,#1e3a5f,#2d5491)", color: "#ffffff", shadow: "rgba(30,58,95,0.4)"  },
    "Best Value":        { icon: "💰", bg: "linear-gradient(135deg,#15803d,#16a34a)", color: "#ffffff", shadow: "rgba(21,128,61,0.4)"  },
    "Premium Choice":    { icon: "💎", bg: "linear-gradient(135deg,#6d28d9,#7c3aed)", color: "#ffffff", shadow: "rgba(109,40,217,0.4)" },
    "New Arrival":       { icon: "🆕", bg: "linear-gradient(135deg,#0369a1,#0ea5e9)", color: "#ffffff", shadow: "rgba(3,105,161,0.4)"  },
    "Best Seller":       { icon: "⭐", bg: "linear-gradient(135deg,#b45309,#d97706)", color: "#ffffff", shadow: "rgba(180,83,9,0.4)"   },
    "Eco Friendly":      { icon: "🌿", bg: "linear-gradient(135deg,#166534,#22c55e)", color: "#ffffff", shadow: "rgba(22,101,52,0.4)"  },
    "Award Winner":      { icon: "🏅", bg: "linear-gradient(135deg,#92400e,#f59e0b)", color: "#ffffff", shadow: "rgba(146,64,14,0.4)"  },
    "Exclusive":         { icon: "✨", bg: "linear-gradient(135deg,#831843,#db2777)", color: "#ffffff", shadow: "rgba(131,24,67,0.4)"  },
    "Sale":              { icon: "🏷️", bg: "linear-gradient(135deg,#991b1b,#ef4444)", color: "#ffffff", shadow: "rgba(153,27,27,0.4)"  },
    "Staff Pick":        { icon: "⭐", bg: "linear-gradient(135deg,#92400e,#b45309)", color: "#ffffff", shadow: "rgba(146,64,14,0.4)"  },
    "Bulk Buy Discount": { icon: "📦", bg: "linear-gradient(135deg,#075985,#0369a1)", color: "#ffffff", shadow: "rgba(7,89,133,0.4)"   },
  };

  const TAG_STYLES: Record<string, { icon: string; bg: string; color: string; border: string }> = {
    "Everyday Workwear": { icon: "👕", bg: "#eff6ff", color: "#1d4ed8", border: "#3b82f6" },
    "Smart Uniform":     { icon: "👔", bg: "#fdf4ff", color: "#7e22ce", border: "#a855f7" },
    "Heavy Duty":        { icon: "💪", bg: "#fff7ed", color: "#c2410c", border: "#f97316" },
    "Budget Friendly":   { icon: "💲", bg: "#f0fdf4", color: "#15803d", border: "#22c55e" },
    "Premium":           { icon: "💎", bg: "#f5f3ff", color: "#6d28d9", border: "#8b5cf6" },
  };

  const badges: string[] = Array.isArray(product.guidance_badges) ? product.guidance_badges : [];
  const tags: string[]   = Array.isArray(product.guidance_tags)   ? product.guidance_tags   : [];

  const badgesHtml = badges.length === 0 ? "" :
    `<div style="margin-bottom:16px">` +
    badges.map(b => {
      const s = BADGE_STYLES[b] ?? { icon: "✔", bg: "linear-gradient(135deg,#1e3a5f,#2d5491)", color: "#ffffff", shadow: "rgba(30,58,95,0.4)" };
      return `<span style="display:inline-flex;align-items:center;gap:6px;padding:7px 16px;border-radius:999px;font-size:0.88em;font-weight:700;margin:4px;line-height:1.3;white-space:nowrap;background:${s.bg};color:${s.color};box-shadow:0 3px 10px ${s.shadow}">${s.icon} ${b}</span>`;
    }).join("") +
    `</div>`;

  const tagsHtml = tags.length === 0 ? "" :
    `<div style="margin-bottom:16px">` +
    tags.map(t => {
      const s = TAG_STYLES[t] ?? { icon: "🏷", bg: "#f1f5f9", color: "#334155", border: "#94a3b8" };
      return `<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:999px;font-size:0.85em;font-weight:600;margin:4px;line-height:1.3;white-space:nowrap;background:${s.bg};color:${s.color};border:2px solid ${s.border}">${s.icon} ${t}</span>`;
    }).join("") +
    `</div>`;

  // ── Best For / Not Ideal For ───────────────────────────────────────────────
  function sectionHtml(
    icon: string, label: string, headerBg: string, headerColor: string, accentColor: string, text: string
  ): string {
    if (!text?.trim()) return "";
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    const listItems = lines.map(l =>
      `<li style="margin-bottom:6px;padding-left:4px">${l}</li>`
    ).join("");
    return `<div style="margin-bottom:18px;border-radius:12px;overflow:hidden;border:1.5px solid ${accentColor}20">` +
      `<div style="background:${headerBg};color:${headerColor};padding:8px 14px;font-weight:700;font-size:0.88em;display:flex;align-items:center;gap:6px">${icon} ${label}</div>` +
      `<div style="padding:12px 16px;background:#fff"><ul style="margin:0;padding-left:18px;color:#374151;font-size:0.92em;line-height:1.7">${listItems}</ul></div>` +
      `</div>`;
  }

  const bestForHtml     = sectionHtml("✅", "Best For",      "#15803d", "#ffffff", "#16a34a", product.guidance_best_for      ?? "");
  const notIdealForHtml = sectionHtml("⚠️",  "Not Ideal For", "#c2410c", "#ffffff", "#f97316", product.guidance_not_ideal_for ?? "");

  // ── Staff quotes ───────────────────────────────────────────────────────────
  // Fetch current profile photos so they're always up to date regardless of when the quote was saved
  const staffRows = await db.execute(sql`SELECT id, profile_image_url FROM staff_members`);
  const staffPhotoMap: Record<number, string | null> = {};
  for (const row of ((staffRows.rows ?? staffRows) as any[])) {
    staffPhotoMap[row.id] = row.profile_image_url ?? null;
  }

  const rawQuotes: any[] = Array.isArray(product.guidance_staff_quotes) ? product.guidance_staff_quotes : [];
  const staffQuotesClean = rawQuotes.map((q: any) => {
    const name     = q.staffName   ?? q.name      ?? "";
    const role     = q.staffRole   ?? q.role      ?? "";
    // Always prefer the live DB photo over the cached JSONB value, then make absolute
    const imageUrl = toAbsolute((q.staffId ? staffPhotoMap[q.staffId] : null) ?? q.staffImageUrl ?? q.imageUrl ?? null);
    const quote    = q.rewritten   ?? q.draft     ?? "";
    return {
      name,
      role, title: role, job_title: role, position: role,
      imageUrl, image_url: imageUrl, image: imageUrl, avatar: imageUrl, photo: imageUrl,
      quote, text: quote,
      aiPolished: !!(q.rewritten),
    };
  });

  const staffQuotesHtml = staffQuotesClean.length === 0 ? "" :
    `<div style="margin-bottom:8px">` +
    `<div style="font-size:0.7em;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px">&#128172; Staff Recommendations</div>` +
    staffQuotesClean.map(q => {
      const initial = (q.name || "?")[0].toUpperCase();
      const avatarImg = q.imageUrl
        ? `<img src="${q.imageUrl}" alt="${q.name}" style="width:160px;height:160px;border-radius:50%;object-fit:cover;object-position:center top;border:3px solid #1e3a5f;box-shadow:0 2px 8px rgba(30,58,95,0.25);display:block;image-rendering:auto" />`
        : `<div style="width:160px;height:160px;border-radius:50%;background:linear-gradient(135deg,#1e3a5f,#2d5491);color:#fff;display:flex;align-items:center;justify-content:center;font-size:3em;font-weight:700;box-shadow:0 2px 8px rgba(30,58,95,0.3)">${initial}</div>`;
      return `<div style="border:1.5px solid #e2e8f0;border-radius:14px;padding:18px 20px;margin-bottom:14px;background:linear-gradient(135deg,#f8fafc,#fff);box-shadow:0 2px 12px rgba(0,0,0,0.06)">` +
        `<div style="display:flex;align-items:flex-start;gap:24px">` +
          `<div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;text-align:center;width:160px">` +
            avatarImg +
            `<div style="font-weight:700;color:#1e3a5f;font-size:1.05em;line-height:1.3;margin-top:10px">${q.name}</div>` +
            `${q.role ? `<div style="color:#64748b;font-size:0.82em;font-weight:500;margin-top:3px">${q.role}</div>` : ''}` +
          `</div>` +
          `<div style="flex:1;min-width:0;display:flex;align-items:center;min-height:160px">` +
            `<p style="margin:0;font-style:italic;color:#374151;font-size:0.95em;line-height:1.7;border-left:4px solid #1e3a5f;padding:10px 14px;border-radius:0 8px 8px 0;background:#f0f4ff;width:100%">&ldquo;${q.quote}&rdquo;</p>` +
          `</div>` +
        `</div>` +
      `</div>`;
    }).join("") +
    `</div>`;

  const meta_data = [
    // Numeric values (for plugin logic)
    { key: "_sbs_value_rating",           value: String(valRating)  },
    { key: "_sbs_durability_rating",       value: String(durRating)  },
    { key: "_sbs_technical_rating",        value: String(techRating) },
    // Unicode star strings (one per rating, for simple display)
    { key: "_sbs_value_stars",             value: toStars(valRating)  },
    { key: "_sbs_durability_stars",        value: toStars(durRating)  },
    { key: "_sbs_technical_stars",         value: toStars(techRating) },
    // Combined HTML block (all three ratings in one field)
    { key: "_sbs_ratings_html",            value: ratingsHtml },
    // Badges — plain comma-separated string (theme wraps each in its own pill);
    //          JSON array and pre-built HTML pills available as alternate keys
    { key: "_sbs_badges",                  value: badges.join(",") },
    { key: "_sbs_badges_json",             value: JSON.stringify(badges) },
    { key: "_sbs_badges_html",             value: badgesHtml },
    // Guidance tags — plain comma-separated string; JSON and HTML as alternate keys
    { key: "_sbs_tags",                    value: tags.join(",") },
    { key: "_sbs_tags_json",               value: JSON.stringify(tags) },
    { key: "_sbs_tags_html",               value: tagsHtml },
    // Best For — plain text for theme rendering; pre-built HTML section as _html variant
    { key: "_sbs_best_for",                value: product.guidance_best_for               ?? "" },
    { key: "_sbs_best_for_html",           value: bestForHtml },
    // Not Ideal For — plain text for theme rendering; pre-built HTML section as _html variant
    { key: "_sbs_not_ideal_for",           value: product.guidance_not_ideal_for          ?? "" },
    { key: "_sbs_not_ideal_for_html",      value: notIdealForHtml },
    // Staff quotes — clean JSON for theme rendering; pre-built HTML cards as _html variant
    { key: "_sbs_staff_quotes",            value: JSON.stringify(staffQuotesClean) },
    { key: "_sbs_staff_quotes_html",       value: staffQuotesHtml },
  ];

  const url = new URL(`${settings.baseUrl.replace(/\/$/, "")}/wp-json/wc/v3/products/${product.woo_commerce_id}`);
  url.searchParams.set("consumer_key", settings.ck);
  url.searchParams.set("consumer_secret", settings.cs);

  const wooRes = await wooRequest(url.toString(), {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ meta_data }),
  });

  if (!wooRes.ok) {
    const text = await wooRes.text().catch(() => wooRes.status.toString());
    res.status(502).json({ error: `WooCommerce returned ${wooRes.status}: ${text}` });
    return;
  }

  res.json({ ok: true, pushed: meta_data.length });
});

router.get("/products/:id/attributes", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [attributes, variants] = await Promise.all([
    db
      .select()
      .from(productAttributesTable)
      .where(eq(productAttributesTable.productId, parsed.data.id))
      .orderBy(productAttributesTable.type, productAttributesTable.value),
    db
      .select()
      .from(productVariantsTable)
      .where(eq(productVariantsTable.productId, parsed.data.id))
      .orderBy(productVariantsTable.colour, productVariantsTable.size, productVariantsTable.sleeve),
  ]);

  // The shop chooses the first image-bearing variant for each colour. Return
  // that same local image with the editable colour attributes so staff see the
  // exact palette their customers see, rather than stale WordPress URLs that
  // may remain on historic attribute rows.
  const colourImages = new Map<string, string>();
  for (const variant of variants) {
    const key = normaliseColourKey(variant.colour);
    if (key && variant.imageUrl && !isLegacyWordPressImage(variant.imageUrl) && !colourImages.has(key)) {
      colourImages.set(key, variant.imageUrl);
    }
  }

  res.json(attributes.map((attribute) => {
    if (attribute.type !== "colour") return attribute;
    const variantImage = colourImages.get(normaliseColourKey(attribute.value));
    return {
      ...attribute,
      imageUrl: variantImage ?? (isLegacyWordPressImage(attribute.imageUrl) ? null : attribute.imageUrl),
    };
  }));
});

router.get("/products/:id/variants", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const variants = await db
    .select()
    .from(productVariantsTable)
    .where(eq(productVariantsTable.productId, parsed.data.id));
  res.json(variants.map(v => ({ ...v, price: v.price ? parseFloat(v.price) : null })));
});

export default router;
