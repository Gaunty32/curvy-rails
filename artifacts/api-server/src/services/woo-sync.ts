import { eq, inArray, isNotNull, and, sql } from "drizzle-orm";
import { db, productsTable, productAttributesTable, productVariantsTable, settingsTable, syncLogsTable, productCategoriesTable } from "@workspace/db";
import { isStoredProductImageUrl, persistProductImage } from "./product-image-storage.js";
import { extractBundlePriceBreaks } from "./woo-price-breaks.js";
import { assertWooIntegrationAllowed, wooRequest } from "./woo-outbound.js";

interface WooCategory {
  id: number;
  name: string;
  slug: string;
  parent: number;
  count: number;
  image: { id: number; src: string; alt: string } | null;
}

interface WooProduct {
  id: number;
  name: string;
  /** WooCommerce lifecycle state, e.g. publish, draft, pending, or private. */
  status: string;
  sku: string;
  price: string;
  regular_price: string;
  sale_price: string;
  on_sale: boolean;
  permalink: string;
  description: string;
  short_description: string;
  stock_quantity: number | null;
  manage_stock: boolean;
  type: "simple" | "variable" | "yith_bundle" | string;
  /** WooCommerce virtual flag — true for services/setup fees with no physical fulfilment */
  virtual: boolean;
  tax_status: "taxable" | "shipping" | "none" | string;
  tax_class: string;
  categories: { id: number; name: string; slug: string }[];
  images: { id: number; src: string; alt: string; position: number }[];
  attributes: { id: number; name: string; options: string[]; variation: boolean }[];
  variations: number[];
  meta_data: { key: string; value: unknown }[];
}

interface WooVariation {
  id: number;
  sku: string;
  price: string;
  regular_price: string;
  manage_stock: boolean;
  stock_quantity: number | null;
  image: { id: number; src: string; alt: string } | null;
  attributes: { id: number; name: string; option: string }[];
}

function decodeWooHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#038;|&#x26;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&#x27;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

async function getSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(settingsTable);
  return Object.fromEntries(rows.filter((r) => r.value != null).map((r) => [r.key, r.value as string]));
}

async function localiseWooImage(
  sourceUrl: string | null | undefined,
  existingUrl: string | null | undefined,
  context: string,
  errors: string[],
): Promise<string | null> {
  if (!sourceUrl) return existingUrl ?? null;
  try {
    return await persistProductImage(sourceUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`${context}: ${message}`);
    // Preserve a previously migrated image rather than replacing it with a
    // WordPress URL when a source download temporarily fails. A remote URL
    // would make the product depend on the retired site again.
    return existingUrl ?? null;
  }
}

async function wooFetch<T>(baseUrl: string, path: string, consumerKey: string, consumerSecret: string): Promise<T> {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/wp-json/wc/v3${path}`);
  url.searchParams.set("consumer_key", consumerKey);
  url.searchParams.set("consumer_secret", consumerSecret);
  const res = await wooRequest(url.toString(), { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`WooCommerce API error ${res.status}: ${await res.text()}`);
  return res.json() as T;
}

async function fetchAllProducts(baseUrl: string, ck: string, cs: string, since?: Date): Promise<WooProduct[]> {
  const all: WooProduct[] = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    // Include non-published products so an item that is later changed to draft
    // is also hidden in the local catalogue. New drafts are deliberately not
    // imported as products; existing records retain their operational history
    // but have their website visibility updated.
    let path = `/products?per_page=${perPage}&page=${page}&status=any`;
    if (since) path += `&modified_after=${since.toISOString()}`;
    const batch = await wooFetch<WooProduct[]>(baseUrl, path, ck, cs);
    all.push(...batch);
    if (batch.length < perPage) break;
    page++;
  }
  return all;
}

/** Fetch only yith_bundle products (small set) with meta_data to extract price breaks */
async function fetchBundleProducts(baseUrl: string, ck: string, cs: string): Promise<WooProduct[]> {
  const all: WooProduct[] = [];
  let page = 1;
  while (true) {
    const batch = await wooFetch<WooProduct[]>(
      baseUrl,
      `/products?per_page=100&page=${page}&status=publish&type=yith_bundle`,
      ck, cs
    );
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

/**
 * Sync YITH bundle products → local `bundles` + `bundle_components` tables.
 * Matches bundles by woo_id; creates new rows on first sync, replaces components on re-sync.
 */
export async function syncBundleDefinitions(bundleProducts: WooProduct[]): Promise<{ created: number; updated: number; errors: string[] }> {
  let created = 0; let updated = 0; const errors: string[] = [];

  for (const p of bundleProducts) {
    if (p.type !== "yith_bundle") continue;
    try {
      const bundleDataMeta = p.meta_data?.find(m => m.key === "_yith_wcpb_bundle_data");
      const rawBundleData = bundleDataMeta?.value as Record<string, {
        product_id?: string;
        quantity?: string;
        bp_min_qty?: string;
        optional?: string;
      }> | null;

      if (!rawBundleData || typeof rawBundleData !== "object") continue;

      const bundlePrice = parseFloat(
        (p.on_sale && p.sale_price) ? p.sale_price : (p.price || p.regular_price || "0")
      ) || 0;

      // Upsert the bundle header by woo_id
      const existing = await db.execute(sql`SELECT id FROM bundles WHERE woo_id = ${p.id}`);
      let bundleId: number;
      if ((existing.rows as any[]).length > 0) {
        bundleId = (existing.rows as any[])[0].id;
        await db.execute(sql`
          UPDATE bundles
          SET name = ${p.name}, sku = ${p.sku || null}, price = ${String(bundlePrice)},
              description = ${stripHtml(p.short_description || p.description) || null}
          WHERE id = ${bundleId}
        `);
        updated++;
      } else {
        const ins = await db.execute(sql`
          INSERT INTO bundles (name, sku, description, price, woo_id, is_active)
          VALUES (${p.name}, ${p.sku || null},
                  ${stripHtml(p.short_description || p.description) || null},
                  ${String(bundlePrice)}, ${p.id}, true)
          RETURNING id
        `);
        bundleId = (ins.rows as any[])[0].id;
        created++;
      }

      // Build component list from bundle data items
      const components: { wooProductId: number; quantity: number }[] = [];
      for (const item of Object.values(rawBundleData)) {
        const wooProductId = item.product_id ? parseInt(item.product_id, 10) : null;
        // Per-bundle quantity; fall back to bp_min_qty if quantity not set
        const qty = item.quantity ? parseInt(item.quantity, 10)
          : item.bp_min_qty ? parseInt(item.bp_min_qty, 10) : 1;
        if (!wooProductId || isNaN(qty) || qty < 1) continue;
        components.push({ wooProductId, quantity: qty });
      }

      if (components.length === 0) continue;

      // Resolve local product IDs from WooCommerce product IDs
      const wooIds = [...new Set(components.map(c => c.wooProductId))];
      const productRows = await db.execute(sql`
        SELECT id, name, woo_commerce_id FROM products
        WHERE woo_commerce_id = ANY(${wooIds}::int[])
      `);
      const productByWooId = new Map<number, { id: number; name: string }>(
        (productRows.rows as any[]).map(r => [r.woo_commerce_id, { id: r.id, name: r.name }])
      );

      // Replace components — delete WooCommerce-sourced ones (notes = '__wc_sync'), re-insert
      await db.execute(sql`
        DELETE FROM bundle_components
        WHERE bundle_id = ${bundleId} AND (notes = '__wc_sync' OR notes IS NULL)
      `);

      for (const comp of components) {
        const product = productByWooId.get(comp.wooProductId);
        const productName = product?.name ?? `WC Product #${comp.wooProductId}`;
        const productId = product?.id ?? null;
        await db.execute(sql`
          INSERT INTO bundle_components (bundle_id, product_id, product_name, quantity, notes)
          VALUES (${bundleId}, ${productId}, ${productName}, ${comp.quantity}, '__wc_sync')
        `);
      }
    } catch (err: any) {
      errors.push(`Bundle woo_id=${p.id} (${p.name}): ${err.message}`);
    }
  }
  return { created, updated, errors };
}

async function fetchAllCategories(baseUrl: string, ck: string, cs: string): Promise<Map<number, WooCategory>> {
  const all: WooCategory[] = [];
  let page = 1;
  while (true) {
    const batch = await wooFetch<WooCategory[]>(baseUrl, `/products/categories?per_page=100&page=${page}`, ck, cs);
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return new Map(all.map((c) => [c.id, c]));
}

/**
 * Given a product's assigned categories, return the most specific (deepest) one.
 * WooCommerce assigns both parent and child categories to products — we want the leaf.
 */
function pickBestCategory(
  productCats: { id: number; name: string; slug: string }[],
  allCats: Map<number, WooCategory>
): string | null {
  if (!productCats.length) return null;
  if (productCats.length === 1) return productCats[0].name;

  // Find leaf categories — ones that are not a parent of any other product category
  const productCatIds = new Set(productCats.map((c) => c.id));
  const leaves = productCats.filter((cat) => {
    const isParentOfAnother = productCats.some((other) => {
      const full = allCats.get(other.id);
      return full && full.parent === cat.id;
    });
    return !isParentOfAnother;
  });

  // If we found leaves, return the first (or only) leaf name
  if (leaves.length > 0) return leaves[0].name;

  // Fallback: return deepest by traversing parent chain
  let deepest = productCats[0];
  let maxDepth = 0;
  for (const cat of productCats) {
    let depth = 0;
    let current = allCats.get(cat.id);
    while (current && current.parent !== 0) {
      depth++;
      current = allCats.get(current.parent);
      if (depth > 20) break; // safety
    }
    if (depth > maxDepth) { maxDepth = depth; deepest = cat; }
  }
  return deepest.name;
}

async function fetchVariations(baseUrl: string, ck: string, cs: string, productId: number): Promise<WooVariation[]> {
  const all: WooVariation[] = [];
  let page = 1;
  while (true) {
    const batch = await wooFetch<WooVariation[]>(baseUrl, `/products/${productId}/variations?per_page=100&page=${page}`, ck, cs);
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

function isColourAttr(name: string): boolean {
  return /colou?r|pa_colou?r/i.test(name);
}
function isSizeAttr(name: string): boolean {
  // Match size, waist, chest, bust, hip — the primary "size" dimension
  // but exclude colour and length/leg/sleeve attributes
  return /size|waist|chest|bust|hip/i.test(name) && !/colou?r|length|leg|sleeve|inseam|fit/i.test(name);
}
function isLengthAttr(name: string): boolean {
  // Match leg length, sleeve length, inseam, fit — stored in the sleeve column
  return /leg.?length|sleeve.?length|leg|inseam|\blength\b|fit/i.test(name) && !/colou?r|size|waist|chest|bust|hip/i.test(name);
}

/** Strip HTML tags and normalise whitespace */
function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const stripped = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return stripped || null;
}

export async function runWooSync(options?: { full?: boolean }): Promise<{ created: number; updated: number; errors: string[]; mode: string }> {
  await assertWooIntegrationAllowed();
  const settings = await getSettings();
  const baseUrl = settings["woo_url"];
  const ck = settings["woo_consumer_key"];
  const cs = settings["woo_consumer_secret"];

  if (!baseUrl || !ck || !cs) throw new Error("WooCommerce credentials not configured.");

  // Record start time before fetching — used as the next sync's cutoff
  const syncStartedAt = new Date();

  // Determine sync mode
  let since: Date | undefined;
  if (!options?.full && settings["woo_last_sync_at"]) {
    since = new Date(settings["woo_last_sync_at"]);
  }
  const mode = since ? "incremental" : "full";

  const [log] = await db.insert(syncLogsTable).values({ type: "woocommerce", status: "running", startedAt: syncStartedAt }).returning();

  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  /** Write progress to the log row, throttled to at most one DB write per 5% step */
  let lastReportedPct = 0;
  async function reportProgress(done: number, total: number): Promise<void> {
    if (total === 0) return;
    const pct = Math.min(99, Math.floor((done / total) * 100));
    if (pct >= lastReportedPct + 5) {
      lastReportedPct = pct;
      await db.update(syncLogsTable).set({ progressPct: pct }).where(eq(syncLogsTable.id, log.id));
    }
  }

  try {
    // Fetch full category hierarchy (small dataset, always refresh)
    const allCategories = await fetchAllCategories(baseUrl, ck, cs);
    const existingCategoryRows = await db.execute(sql`
      SELECT woo_id, image_url
      FROM product_categories
    `);
    const existingCategoryImages = new Map<number, string | null>(
      (existingCategoryRows.rows as Array<{ woo_id: number; image_url: string | null }>)
        .map((row) => [Number(row.woo_id), row.image_url]),
    );

    // Persist categories (upsert by woo_id so images and counts stay current)
    for (const cat of allCategories.values()) {
      const existingImageUrl = existingCategoryImages.get(cat.id) ?? null;
      // Category artwork is curated media. Once it has been migrated to Object
      // Storage, keep it authoritative instead of replacing it from a Woo sync.
      const imageUrl = isStoredProductImageUrl(existingImageUrl)
        ? existingImageUrl
        : await localiseWooImage(
            cat.image?.src ?? null,
            existingImageUrl,
            `Category ${cat.id} image`,
            errors,
          );
      await db.insert(productCategoriesTable).values({
        wooId: cat.id,
        name: cat.name,
        slug: cat.slug,
        imageUrl,
        parentWooId: cat.parent || null,
        productCount: cat.count,
      }).onConflictDoUpdate({
        target: productCategoriesTable.wooId,
        set: {
          name: cat.name,
          slug: cat.slug,
          imageUrl,
          parentWooId: cat.parent || null,
          productCount: cat.count,
          updatedAt: new Date(),
        },
      });
    }

    // Fetch products — incremental uses modified_after to get only changed products
    const products = await fetchAllProducts(baseUrl, ck, cs, since);

    // Mark 5% once we know how many products to process
    await db.update(syncLogsTable).set({ progressPct: 5 }).where(eq(syncLogsTable.id, log.id));

    for (const [index, wooProduct] of products.entries()) {
      try {
        // Bundle products (yith_bundle) are used only for extracting price breaks —
        // they are not orderable products in their own right and must not appear in
        // the catalogue. Price break data is applied separately below.
        if (wooProduct.type === "yith_bundle") {
          await reportProgress(index + 1, products.length);
          continue;
        }

        const wooId = wooProduct.id;
        const category = pickBestCategory(wooProduct.categories ?? [], allCategories);
        const wooCategoryIds = [...new Set(
          (wooProduct.categories ?? [])
            .map((productCategory) => Number(productCategory.id))
            .filter((id) => Number.isInteger(id) && id > 0),
        )];
        // Use the current active price (sale_price when on sale, otherwise price).
        // Fall back to regular_price last — it's the non-discounted price.
        const priceStr = (wooProduct.on_sale && wooProduct.sale_price)
          ? wooProduct.sale_price
          : (wooProduct.price || wooProduct.regular_price || "0");
        const price = parseFloat(priceStr) || 0;
        const regularPrice = wooProduct.regular_price ? String(parseFloat(wooProduct.regular_price) || 0) : null;
        const onSale = wooProduct.on_sale ?? false;
        const stockQty = wooProduct.manage_stock ? (wooProduct.stock_quantity ?? null) : null;
        const sourceImageUrl = wooProduct.images?.[0]?.src ?? null;
        // Build a gallery map: alt-text (lowercased) → image src, for colour fallback
        const galleryByAlt = new Map<string, string>();
        for (const img of wooProduct.images ?? []) {
          if (img.alt) galleryByAlt.set(img.alt.toLowerCase().trim(), img.src);
        }

        const existingRows = await db.execute(sql`
          SELECT id, COALESCE(is_archived, false) AS is_archived, image_url, gallery_images
          FROM products WHERE woo_commerce_id = ${wooId} LIMIT 1
        `);
        const existingRow = (existingRows.rows[0] as any) ?? null;

        // Skip archived products entirely — preserve their archived state and
        // do not overwrite any manually-entered data.
        if (existingRow?.is_archived) continue;

        const wooStatus = typeof wooProduct.status === "string" && wooProduct.status.trim()
          ? wooProduct.status.trim().toLowerCase()
          : "draft";

        // Retain an existing product for staff/order history but never import a
        // new non-published WooCommerce item into the configured catalogue.
        if (wooStatus !== "publish") {
          if (existingRow) {
            await db.execute(sql`
              UPDATE products
              SET woo_status = ${wooStatus}, updated_at = NOW()
              WHERE id = ${existingRow.id}
            `);
            updated++;
          }
          await reportProgress(index + 1, products.length);
          continue;
        }

        const imageUrl = await localiseWooImage(
          sourceImageUrl,
          existingRow?.image_url ?? null,
          `Product ${wooId} primary image`,
          errors,
        );
        let galleryImages: string[] | null = null;
        try {
          galleryImages = (await Promise.all(
            (wooProduct.images ?? []).map((image) => persistProductImage(image.src))
          )).filter((url): url is string => Boolean(url));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`Product ${wooId} gallery image: ${message}`);
        }

        let productId: number;

        const taxStatus = wooProduct.tax_status || null;
        // WooCommerce uses empty string for "Standard Rate" — normalise to null for clarity
        const taxClass = wooProduct.tax_class || null;
        // Map WooCommerce tax class to UK VAT rate
        // "zero-rate" = children's clothing, books, food etc. → 0%
        // "reduced-rate" = energy, mobility aids etc. → 5%
        // "" / null = standard → 20%
        const vatRate = taxClass === "zero-rate" ? "0.0000"
          : taxClass === "reduced-rate" ? "0.0500"
          : "0.2000";

        // Virtual WooCommerce products (setup fees, digitising, etc.) map to service products
        const isVirtual = wooProduct.virtual === true;

        if (existingRow) {
          productId = existingRow.id;
          await db.execute(sql`
            UPDATE products SET
              name         = ${decodeWooHtmlEntities(wooProduct.name)},
              sku          = ${wooProduct.sku || null},
              category     = ${category},
              product_category_ids = ${wooCategoryIds.length ? JSON.stringify(wooCategoryIds) : null}::jsonb,
              image_url    = ${imageUrl},
               gallery_images = COALESCE(${galleryImages ? JSON.stringify(galleryImages) : null}::jsonb, gallery_images),
              permalink    = ${wooProduct.permalink || null},
              description  = ${stripHtml(wooProduct.short_description || wooProduct.description)},
              unit_price   = ${String(price)},
              regular_price = ${regularPrice},
              on_sale      = ${onSale},
              stock_quantity = COALESCE(${stockQty}, stock_quantity),
              tax_status   = ${taxStatus},
              tax_class    = ${taxClass},
              vat_rate     = ${vatRate},
               woo_status   = ${wooStatus},
              is_service   = CASE WHEN ${isVirtual} THEN true ELSE is_service END
            WHERE id = ${productId}
          `);
          updated++;
        } else {
          const [inserted] = await db.insert(productsTable).values({
            wooCommerceId: wooId,
            name: decodeWooHtmlEntities(wooProduct.name),
            sku: wooProduct.sku || null,
            category,
            wooCategoryIds: wooCategoryIds.length ? wooCategoryIds : null,
            imageUrl,
            description: stripHtml(wooProduct.short_description || wooProduct.description),
            unitPrice: String(price),
            stockQuantity: stockQty,
            taxStatus,
            taxClass,
            vatRate,
            isService: isVirtual,
            wooStatus,
          } as any).returning();
          productId = inserted.id;
          created++;
        }

        if (!existingRow && galleryImages) {
          await db.execute(sql`
            UPDATE products
            SET gallery_images = ${JSON.stringify(galleryImages)}::jsonb
            WHERE id = ${productId}
          `);
        }

        const existingWooVariants = await db
          .select({
            id: productVariantsTable.id,
            wooVariationId: productVariantsTable.wooVariationId,
            imageUrl: productVariantsTable.imageUrl,
          })
          .from(productVariantsTable)
          .where(and(
            eq(productVariantsTable.productId, productId),
            isNotNull(productVariantsTable.wooVariationId)
          ));
        const imageByWooId = new Map<number, string | null>();
        for (const existingVariant of existingWooVariants) {
          if (existingVariant.wooVariationId != null) {
            imageByWooId.set(existingVariant.wooVariationId, existingVariant.imageUrl);
          }
        }

        const colours = new Set<string>();
        const sizes = new Set<string>();
        const sleeves = new Set<string>();
        // Maps colour name → first variation image URL found for that colour
        const colourImages = new Map<string, string>();

        // Fetch variations for variable products and upsert product_variants
        const variantRows: {
          productId: number; wooVariationId: number; colour: string | null; size: string | null;
          sleeve: string | null; sku: string | null; price: string | null; imageUrl: string | null; stockQuantity: number;
          variantAttributes: { id: number | string | null; name: string; option: string }[];
        }[] = [];

        if (wooProduct.type === "variable" && wooProduct.variations?.length > 0) {
          const variations = await fetchVariations(baseUrl, ck, cs, wooId);
          const mainImageSrc = wooProduct.images?.[0]?.src ?? null;
          const incomingIds = new Set<number>();

          for (const v of variations) {
            if (incomingIds.has(v.id)) {
              throw new Error(`Duplicate incoming Woo variation ID ${v.id} for product ${wooId}; no variants written`);
            }
            incomingIds.add(v.id);
            let vColour: string | null = null;
            let vSize: string | null = null;
            let vSleeve: string | null = null;
            for (const attr of v.attributes) {
              if (isColourAttr(attr.name)) vColour = attr.option;
              else if (isSizeAttr(attr.name)) vSize = attr.option;
              else if (isLengthAttr(attr.name)) vSleeve = attr.option;
            }

            // Resolve variation image
            let vImageSource: string | null = null;
            const varImg = v.image?.src;
            if (varImg && varImg !== mainImageSrc) {
              vImageSource = varImg;
            } else if (vColour) {
              const colourKey = vColour.toLowerCase().trim();
              vImageSource = galleryByAlt.get(colourKey) ??
                [...galleryByAlt.entries()].find(([alt]) => alt.includes(colourKey) || colourKey.includes(alt))?.[1] ?? null;
            }
            const vImageUrl = await localiseWooImage(
              vImageSource,
              imageByWooId.get(v.id) ?? null,
              `Product ${wooId} variation ${v.id} image`,
              errors,
            );

            if (vColour) colours.add(vColour);
            if (vSize) sizes.add(vSize);
            if (vSleeve) sleeves.add(vSleeve);
            if (vColour && vImageUrl && !colourImages.has(vColour)) colourImages.set(vColour, vImageUrl);

            const vPrice = v.price || v.regular_price || null;
            variantRows.push({
              productId,
              wooVariationId: v.id,
              colour: vColour,
              size: vSize,
              sleeve: vSleeve,
              sku: v.sku || null,
              price: vPrice ? String(parseFloat(vPrice)) : null,
              imageUrl: vImageUrl,
              stockQuantity: v.manage_stock ? (v.stock_quantity ?? 0) : 0,
              variantAttributes: (v.attributes ?? []).map(attr => ({
                id: attr.id ?? null,
                name: String(attr.name ?? ""),
                option: String(attr.option ?? ""),
              })),
            });
          }
        } else {
          for (const attr of wooProduct.attributes) {
            if (isColourAttr(attr.name)) attr.options.forEach((o) => colours.add(o));
            else if (isSizeAttr(attr.name)) attr.options.forEach((o) => sizes.add(o));
            else if (isLengthAttr(attr.name)) attr.options.forEach((o) => sleeves.add(o));
          }
        }

        // Always also scan product-level attributes for sizes and lengths — variable products that
        // vary only by colour won't have sizes in the variation attributes, but the
        // product itself may declare a Size/Length attribute with all available options.
        for (const attr of (wooProduct.attributes ?? [])) {
          if (isSizeAttr(attr.name)) (attr.options ?? []).forEach((o: string) => sizes.add(o));
          else if (isLengthAttr(attr.name)) (attr.options ?? []).forEach((o: string) => sleeves.add(o));
        }

        // Reconcile by stable identity. Updates only source-owned fields; local
        // stock, bins, minimums and supplier overrides are operational data.
        for (const r of variantRows) {
          const matches = await db.select({ id: productVariantsTable.id })
            .from(productVariantsTable)
            .where(and(eq(productVariantsTable.productId, productId), eq(productVariantsTable.wooVariationId, r.wooVariationId)));
          if (matches.length > 1) {
            throw new Error(`Ambiguous local Woo variation ${r.wooVariationId} for product ${productId}; no stock changed`);
          }
          const sourceFields = {
            colour: r.colour, size: r.size, sleeve: r.sleeve, sku: r.sku,
            price: r.price, imageUrl: r.imageUrl, variantAttributes: r.variantAttributes,
          };
          if (matches.length === 1) {
            await db.update(productVariantsTable).set(sourceFields).where(eq(productVariantsTable.id, matches[0].id));
          } else {
            await db.insert(productVariantsTable).values({
              ...sourceFields, productId: r.productId, wooVariationId: r.wooVariationId,
              stockQuantity: r.stockQuantity,
            });
          }
        }

        // Update product_attributes colour/size/sleeve palette from synced data.
        // Only replace a type when WooCommerce actually provided values for it — this
        // preserves manually-added sizes for colour-only variable products where
        // WooCommerce has no Size attribute defined (e.g. polo shirts, t-shirts).
        const attrValues: { productId: number; type: string; value: string; imageUrl: string | null; sortOrder: number }[] = [];
        let i = 0;
        if (colours.size > 0) {
          await db.delete(productAttributesTable).where(
            and(eq(productAttributesTable.productId, productId), eq(productAttributesTable.type, "colour"))
          );
          for (const c of colours) attrValues.push({ productId, type: "colour", value: c, imageUrl: colourImages.get(c) ?? null, sortOrder: i++ });
        }
        if (sizes.size > 0) {
          await db.delete(productAttributesTable).where(
            and(eq(productAttributesTable.productId, productId), eq(productAttributesTable.type, "size"))
          );
          for (const s of sizes) attrValues.push({ productId, type: "size", value: s, imageUrl: null, sortOrder: i++ });
        }
        if (sleeves.size > 0) {
          await db.delete(productAttributesTable).where(
            and(eq(productAttributesTable.productId, productId), eq(productAttributesTable.type, "sleeve"))
          );
          for (const sl of sleeves) attrValues.push({ productId, type: "sleeve", value: sl, imageUrl: null, sortOrder: i++ });
        }
        if (attrValues.length > 0) await db.insert(productAttributesTable).values(attrValues);

      } catch (err) {
        errors.push(`Product ${wooProduct.id} (${wooProduct.name}): ${err instanceof Error ? err.message : String(err)}`);
      }

      await reportProgress(index + 1, products.length);
    }

    // Reconcile quantity breaks from homogeneous bulk packs. Mixed wearer
    // packs cannot define a component's unit price because their total covers
    // several different garments.
    const bundleProducts = await fetchBundleProducts(baseUrl, ck, cs);
    const extractedBreaks = extractBundlePriceBreaks(bundleProducts);
    const extractedWooIds = [...extractedBreaks.keys()];
    const priceRows = extractedWooIds.length > 0
      ? await db.execute(sql`
          SELECT woo_commerce_id, unit_price
          FROM products
          WHERE woo_commerce_id = ANY(${extractedWooIds}::int[])
        `)
      : { rows: [] };
    const unitPriceByWooId = new Map<number, number>(
      (priceRows.rows as any[]).map((row) => [
        Number(row.woo_commerce_id),
        Number(row.unit_price),
      ]),
    );
    const reconciledBreaks = Object.fromEntries(
      [...extractedBreaks.entries()]
        .map(([wooProductId, breaks]) => {
          const unitPrice = unitPriceByWooId.get(wooProductId) ?? 0;
          return [
            String(wooProductId),
            breaks.filter((priceBreak) =>
              unitPrice > 0 &&
              priceBreak.price > 0 &&
              priceBreak.price < unitPrice
            ),
          ] as const;
        })
        .filter(([, breaks]) => breaks.length > 0),
    );
    const reconciledWooIds = Object.keys(reconciledBreaks).map(Number);
    const reconciledJson = JSON.stringify(reconciledBreaks);

    // Remove malformed tiers left by earlier mixed-bundle imports while
    // preserving legitimate manually managed discounts.
    await db.execute(sql`
      UPDATE products
      SET price_breaks = (
        SELECT CASE
          WHEN COUNT(*) = 0 THEN NULL
          ELSE jsonb_agg(tier ORDER BY (tier->>'qty')::numeric)
        END
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(COALESCE(products.price_breaks, '[]'::jsonb)) = 'array'
              THEN products.price_breaks
            ELSE '[]'::jsonb
          END
        ) AS tier
        WHERE COALESCE(tier->>'qty', '') ~ '^[0-9]+([.][0-9]+)?$'
          AND COALESCE(tier->>'price', '') ~ '^[0-9]+([.][0-9]+)?$'
          AND (tier->>'qty')::numeric > 0
          AND (tier->>'price')::numeric > 0
          AND (tier->>'price')::numeric < products.unit_price
      )
      WHERE price_breaks IS NOT NULL
    `);

    if (reconciledWooIds.length > 0) {
      await db.execute(sql`
        UPDATE products
        SET price_breaks = ${reconciledJson}::jsonb -> woo_commerce_id::text
        WHERE woo_commerce_id = ANY(${reconciledWooIds}::int[])
      `);
    }

    // Sync bundle definitions (name, price, components) from WooCommerce into local bundles table
    const bundleSyncResult = await syncBundleDefinitions(bundleProducts);
    errors.push(...bundleSyncResult.errors);

    // Save sync start time so next incremental sync can use it as its cutoff
    await db.insert(settingsTable)
      .values({ key: "woo_last_sync_at", value: syncStartedAt.toISOString() })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: syncStartedAt.toISOString(), updatedAt: new Date() } });

    const modeLabel = mode === "incremental" ? `Incremental — ${products.length} changed` : `Full — ${products.length} total`;
    await db.update(syncLogsTable).set({
      status: errors.length > 0 ? "completed_with_errors" : "completed",
      message: `${modeLabel} across ${allCategories.size} categories`,
      itemsCreated: String(created),
      itemsUpdated: String(updated),
      errors: errors.length > 0 ? errors.slice(0, 20).join("\n") : null,
      completedAt: new Date(),
    }).where(eq(syncLogsTable.id, log.id));

    return { created, updated, errors, mode };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(syncLogsTable).set({ status: "failed", message: msg, completedAt: new Date() }).where(eq(syncLogsTable.id, log.id));
    throw err;
  }
}

export async function runWooSyncFull(): Promise<ReturnType<typeof runWooSync>> {
  return runWooSync({ full: true });
}

/** Standalone bundle sync — fetches yith_bundle products from WooCommerce and upserts local bundle definitions. */
export async function runBundleSync(): Promise<{ created: number; updated: number; errors: string[] }> {
  await assertWooIntegrationAllowed();
  const settings = await getSettings();
  const baseUrl = settings["woo_base_url"] ?? "";
  const ck      = settings["woo_consumer_key"] ?? "";
  const cs      = settings["woo_consumer_secret"] ?? "";
  if (!baseUrl || !ck || !cs) throw new Error("WooCommerce not configured");

  const bundleProducts = await fetchBundleProducts(baseUrl, ck, cs);
  return syncBundleDefinitions(bundleProducts);
}
