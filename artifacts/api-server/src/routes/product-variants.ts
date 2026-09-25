import { Router, type IRouter } from "express";
import { eq, and, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, productVariantsTable, productsTable, productAttributesTable } from "@workspace/db";
import { getWooSettings } from "./woo.js";
import { wooRequest } from "../services/woo-outbound.js";

const router: IRouter = Router();

const productIdParam = z.object({ productId: z.coerce.number().int().positive() });
const subIdParam = z.object({ productId: z.coerce.number().int().positive(), id: z.coerce.number().int().positive() });

const variantBody = z.object({
  colour: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  sleeve: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  price: z.number().positive().optional().nullable(),
  vatRate: z.number().min(0).max(1).optional().nullable(),
  stockQuantity: z.number().int().min(0).default(0),
  imageUrl: z.string().optional().nullable(),
  primarySupplierId: z.number().int().positive().optional().nullable(),
  supplierCode: z.string().optional().nullable(),
  supplierPrice: z.number().optional().nullable(),
  secondarySupplierId: z.number().int().positive().optional().nullable(),
  secondarySupplierCode: z.string().optional().nullable(),
  secondarySupplierPrice: z.number().optional().nullable(),
  isAvailable: z.boolean().optional(),
});

async function getProduct(id: number) {
  const [p] = await db.select().from(productsTable).where(eq(productsTable.id, id));
  return p;
}

/** Roll up the sum of all variant stock quantities to the parent product's stock_quantity. */
async function rollupProductStock(productId: number) {
  await db.execute(sql`
    UPDATE products
    SET stock_quantity = (
      SELECT COALESCE(SUM(stock_quantity), 0)
      FROM product_variants
      WHERE product_id = ${productId}
    )
    WHERE id = ${productId}
  `);
}

async function pushVariantSkuToWoo(productId: number, wooVariationId: number | null, sku: string | null) {
  if (!wooVariationId) return;
  try {
    const product = await getProduct(productId);
    if (!product?.wooCommerceId || product.wooStatus !== "publish") return;
    const settings = await getWooSettings();
    if (!settings) return;

    const wooBase = settings.baseUrl.replace(/\/$/, "").replace(/^http:\/\//i, "https://");
    const url = new URL(`${wooBase}/wp-json/wc/v3/products/${product.wooCommerceId}/variations/${wooVariationId}`);
    url.searchParams.set("consumer_key", settings.ck);
    url.searchParams.set("consumer_secret", settings.cs);
    const response = await wooRequest(url.toString(), {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ sku: sku ?? "" }),
    });
    if (!response.ok) {
      console.error(`[woo] variant SKU push ${wooVariationId} failed: ${response.status} ${await response.text()}`);
    }
  } catch (error) {
    console.error(`[woo] variant SKU push failed for product ${productId}:`, error);
  }
}

// List variants for a product
router.get("/products/:productId/variants", async (req, res): Promise<void> => {
  const p = productIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getProduct(p.data.productId)) { res.status(404).json({ error: "Product not found" }); return; }
  const rows = await db.select().from(productVariantsTable)
    .where(eq(productVariantsTable.productId, p.data.productId))
    .orderBy(productVariantsTable.colour, productVariantsTable.sleeve, productVariantsTable.size);
  res.json(rows.map(r => ({
    ...r,
    price: r.price != null ? parseFloat(r.price) : null,
    vatRate: r.vatRate != null ? parseFloat(r.vatRate) : null,
    supplierPrice: r.supplierPrice != null ? parseFloat(r.supplierPrice) : null,
    secondarySupplierPrice: r.secondarySupplierPrice != null ? parseFloat(r.secondarySupplierPrice) : null,
  })));
});

// Create a variant
router.post("/products/:productId/variants", async (req, res): Promise<void> => {
  const p = productIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getProduct(p.data.productId)) { res.status(404).json({ error: "Product not found" }); return; }
  const body = variantBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.insert(productVariantsTable)
    .values({ ...body.data, productId: p.data.productId })
    .returning();
  await rollupProductStock(p.data.productId);
  res.status(201).json(row);
});

// Bulk-update supplier + price + code across multiple variants of the same product
// IMPORTANT: this must be registered BEFORE the /:id route so Express doesn't match "bulk" as an id param
router.patch("/products/:productId/variants/bulk", async (req, res): Promise<void> => {
  const p = productIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const bodySchema = z.object({
    ids: z.array(z.number().int().positive()).min(1),
    primarySupplierId: z.number().int().positive().optional().nullable(),
    supplierPrice: z.number().optional().nullable(),
    supplierCode: z.string().optional().nullable(),
    price: z.number().positive().optional().nullable(),
    vatRate: z.number().min(0).max(1).optional().nullable(),
  });
  const body = bodySchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const updates: Record<string, any> = { updatedAt: new Date() };
  if ("primarySupplierId" in req.body) updates.primarySupplierId = body.data.primarySupplierId ?? null;
  if ("supplierPrice" in req.body) updates.supplierPrice = body.data.supplierPrice != null ? body.data.supplierPrice : null;
  if ("supplierCode" in req.body) updates.supplierCode = body.data.supplierCode ?? null;
  if ("price" in req.body) updates.price = body.data.price != null ? body.data.price : null;
  if ("vatRate" in req.body) updates.vatRate = body.data.vatRate != null ? body.data.vatRate : null;

  await db.update(productVariantsTable)
    .set(updates)
    .where(and(
      eq(productVariantsTable.productId, p.data.productId),
      inArray(productVariantsTable.id, body.data.ids),
    ));

  res.json({ updated: body.data.ids.length });
});

// Update a single variant (stock, suppliers)
router.patch("/products/:productId/variants/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = variantBody.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.update(productVariantsTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(
      eq(productVariantsTable.id, p.data.id),
      eq(productVariantsTable.productId, p.data.productId),
    ))
    .returning();
  if (!row) { res.status(404).json({ error: "Variant not found" }); return; }
  await rollupProductStock(p.data.productId);
  if ("sku" in req.body) {
    void pushVariantSkuToWoo(p.data.productId, row.wooVariationId, row.sku);
  }
  res.json(row);
});

// POST /products/:productId/variants/generate-matrix
// Creates all colour × size combinations from product attributes.
// Products without a colour choice use a single blank-colour dimension.
// Existing colour-only (size=null) variants with 0 stock are removed after expansion.
router.post("/products/:productId/variants/generate-matrix", async (req, res): Promise<void> => {
  const p = productIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const productId = p.data.productId;
  const product = await getProduct(productId);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  const productSku = product.sku ?? null;

  // 1. Load attributes
  const attrs = await db.select().from(productAttributesTable)
    .where(eq(productAttributesTable.productId, productId));
  const colourAttrs = attrs.filter(a => a.type === "colour");
  const sizeAttrs = attrs.filter(a => a.type === "size");
  const sleeveAttrs = attrs.filter(a => a.type === "sleeve");

  if (sizeAttrs.length === 0) {
    res.status(400).json({ error: "Product must have sizes defined as attributes" });
    return;
  }

  // 2. Load existing variants
  const existing = await db.select().from(productVariantsTable)
    .where(eq(productVariantsTable.productId, productId));

  // 3. Build colour → properties map from existing colour-only (size=null, sleeve=null) variants
  type ColourProps = {
    imageUrl: string | null;
    primarySupplierId: number | null;
    secondarySupplierId: number | null;
    supplierCode: string | null;
    supplierPrice: string | null;
    secondarySupplierCode: string | null;
    secondarySupplierPrice: string | null;
    sku: string | null;
  };
  const colourProps = new Map<string | null, ColourProps>();
  for (const v of existing) {
    if (v.size === null && !colourProps.has(v.colour)) {
      colourProps.set(v.colour, {
        imageUrl: v.imageUrl,
        primarySupplierId: v.primarySupplierId,
        secondarySupplierId: v.secondarySupplierId,
        supplierCode: v.supplierCode,
        supplierPrice: v.supplierPrice,
        secondarySupplierCode: v.secondarySupplierCode,
        secondarySupplierPrice: v.secondarySupplierPrice,
        sku: v.sku,
      });
    }
  }

  // 4. Create colour × size (× sleeve) variants that don't already exist
  const hasSleeve = sleeveAttrs.length > 0;
  // When sleeve is active, treat colour×size without a sleeve as expandable (like old colour-only logic)
  let created = 0;
  const colourDimensions = colourAttrs.length > 0
    ? colourAttrs
    : [{ value: null, imageUrl: null }];
  for (const colAttr of colourDimensions) {
    const colour = colAttr.value;
    const props = colourProps.get(colour) ?? {
      imageUrl: colAttr.imageUrl,
      primarySupplierId: null,
      secondarySupplierId: null,
      supplierCode: null,
      supplierPrice: null,
      secondarySupplierCode: null,
      secondarySupplierPrice: null,
      sku: productSku,
    };
    if (!props.sku) props.sku = productSku;
    if (!props.primarySupplierId) props.primarySupplierId = product.supplierId ?? null;
    if (!props.secondarySupplierId) props.secondarySupplierId = product.secondarySupplierId ?? null;

    for (const sizeAttr of sizeAttrs) {
      const size = sizeAttr.value;

      if (!hasSleeve) {
        // Original colour × size logic
        const alreadyExists = existing.some(v => v.colour === colour && v.size === size);
        if (!alreadyExists) {
          await db.insert(productVariantsTable).values({
            productId, colour, size,
            imageUrl: props.imageUrl,
            primarySupplierId: props.primarySupplierId,
            secondarySupplierId: props.secondarySupplierId,
            supplierCode: props.supplierCode,
            supplierPrice: props.supplierPrice,
            secondarySupplierCode: props.secondarySupplierCode,
            secondarySupplierPrice: props.secondarySupplierPrice,
            stockQuantity: 0,
          });
          created++;
        }
      } else {
        // Three-way: colour × size × sleeve
        for (const sleeveAttr of sleeveAttrs) {
          const sleeve = sleeveAttr.value;
          const alreadyExists = existing.some(v => v.colour === colour && v.size === size && v.sleeve === sleeve);
          if (!alreadyExists) {
            await db.insert(productVariantsTable).values({
              productId, colour, size, sleeve,
              imageUrl: props.imageUrl,
              primarySupplierId: props.primarySupplierId,
              secondarySupplierId: props.secondarySupplierId,
              supplierCode: props.supplierCode,
              supplierPrice: props.supplierPrice,
              secondarySupplierCode: props.secondarySupplierCode,
              secondarySupplierPrice: props.secondarySupplierPrice,
              stockQuantity: 0,
            });
            created++;
          }
        }
      }
    }
  }

  // 5. Delete old colour-only (size=null) variants that have 0 stock
  const toDeleteIds: number[] = [];
  existing.forEach(v => {
    if (v.size === null && (v.stockQuantity ?? 0) === 0) toDeleteIds.push(v.id);
    // When sleeve is now active, also clean up old sleeve-less colour×size variants with 0 stock
    if (hasSleeve && v.sleeve === null && v.size !== null && (v.stockQuantity ?? 0) === 0) toDeleteIds.push(v.id);
  });
  let deleted = 0;
  if (toDeleteIds.length > 0) {
    await db.delete(productVariantsTable)
      .where(and(
        eq(productVariantsTable.productId, productId),
        inArray(productVariantsTable.id, toDeleteIds),
      ));
    deleted = toDeleteIds.length;
  }

  await rollupProductStock(productId);
  res.json({ created, deleted, skipped: existing.filter(v => hasSleeve ? v.sleeve !== null : v.size !== null).length });
});

// Push availability (isAvailable) for all WooCommerce-linked variants to WooCommerce
router.post("/products/:productId/push-woo-availability", async (req, res): Promise<void> => {
  const p = productIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }

  const product = await getProduct(p.data.productId);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  if (!product.wooCommerceId) { res.status(400).json({ error: "This product has no WooCommerce ID — it cannot be synced." }); return; }

  const settings = await getWooSettings();
  if (!settings) { res.status(400).json({ error: "WooCommerce not configured. Check Settings → WooCommerce." }); return; }

  const variants = await db.select().from(productVariantsTable)
    .where(and(
      eq(productVariantsTable.productId, p.data.productId),
      isNotNull(productVariantsTable.wooVariationId),
    ));

  if (variants.length === 0) {
    res.json({ pushed: 0, total: 0, errors: [] });
    return;
  }

  let pushed = 0;
  const errors: string[] = [];

  for (const variant of variants) {
    const stockStatus = variant.isAvailable !== false ? "instock" : "outofstock";
    const url = new URL(
      `${settings.baseUrl.replace(/\/$/, "")}/wp-json/wc/v3/products/${product.wooCommerceId}/variations/${variant.wooVariationId}`
    );
    url.searchParams.set("consumer_key", settings.ck);
    url.searchParams.set("consumer_secret", settings.cs);
    try {
      const wooRes = await wooRequest(url.toString(), {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ stock_status: stockStatus }),
      });
      if (!wooRes.ok) {
        const text = await wooRes.text().catch(() => wooRes.status.toString());
        errors.push(`Variation ${variant.wooVariationId}: ${text}`);
      } else {
        pushed++;
      }
    } catch (e: any) {
      errors.push(`Variation ${variant.wooVariationId}: ${e.message}`);
    }
  }

  res.json({ pushed, total: variants.length, errors });
});

// Delete a variant
// Bulk delete variants by IDs — DELETE /products/:productId/variants/bulk
router.delete("/products/:productId/variants/bulk", async (req, res): Promise<void> => {
  const p = productIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }

  const parsed = z.object({ ids: z.array(z.number().int().positive()).min(1) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const deleted = await db.delete(productVariantsTable)
    .where(and(
      eq(productVariantsTable.productId, p.data.productId),
      inArray(productVariantsTable.id, parsed.data.ids),
    ))
    .returning();

  await rollupProductStock(p.data.productId);
  res.json({ deleted: deleted.length });
});

router.delete("/products/:productId/variants/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.delete(productVariantsTable)
    .where(and(
      eq(productVariantsTable.id, p.data.id),
      eq(productVariantsTable.productId, p.data.productId),
    ))
    .returning();
  if (!row) { res.status(404).json({ error: "Variant not found" }); return; }
  await rollupProductStock(p.data.productId);
  res.sendStatus(204);
});

export default router;
