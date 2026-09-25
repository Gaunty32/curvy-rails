import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { z } from "zod";
import { randomUUID } from "crypto";

const router = Router();

// ── List all bundles ──────────────────────────────────────────────────────────
router.get("/bundles", async (_req, res): Promise<void> => {
  try {
    const rows = await db.execute(sql`
      SELECT b.id, b.name, b.sku, b.description, b.price, b.is_active, b.notes, b.created_at,
        COUNT(bc.id)::int AS component_count,
        SUM(bc.quantity * COALESCE(p.supplier_price, 0))::numeric(10,2) AS total_cost,
        COUNT(CASE WHEN p.supplier_price IS NOT NULL THEN 1 END)::int AS components_priced
      FROM bundles b
      LEFT JOIN bundle_components bc ON bc.bundle_id = b.id
      LEFT JOIN products p ON p.id = bc.product_id
      GROUP BY b.id
      ORDER BY b.name
    `);
    res.json(rows.rows ?? rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Get single bundle with components ─────────────────────────────────────────
router.get("/bundles/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const bundleRows = await db.execute(sql`SELECT * FROM bundles WHERE id = ${id}`);
    const bundle = (bundleRows.rows ?? bundleRows)[0];
    if (!bundle) { res.status(404).json({ error: "Bundle not found" }); return; }
    const compRows = await db.execute(sql`
      SELECT bc.*, COALESCE(p.name, bc.product_name) AS resolved_name, p.sku AS product_sku,
        p.is_service AS p_is_service,
        (SELECT json_agg(DISTINCT jsonb_build_object('colour', pv.colour, 'size', pv.size) ORDER BY jsonb_build_object('colour', pv.colour, 'size', pv.size))
         FROM product_variants pv WHERE pv.product_id = bc.product_id AND pv.colour IS NOT NULL) AS variants
      FROM bundle_components bc
      LEFT JOIN products p ON p.id = bc.product_id
      WHERE bc.bundle_id = ${id}
      ORDER BY bc.id
    `);
    res.json({ ...bundle, components: compRows.rows ?? compRows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Create bundle ─────────────────────────────────────────────────────────────
const BundleSchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  price: z.number().min(0),
  notes: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
});

router.post("/bundles", async (req, res): Promise<void> => {
  const parsed = BundleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { name, sku, description, price, notes, isActive } = parsed.data;
  try {
    const rows = await db.execute(sql`
      INSERT INTO bundles (name, sku, description, price, notes, is_active)
      VALUES (${name}, ${sku ?? null}, ${description ?? null}, ${price}, ${notes ?? null}, ${isActive})
      RETURNING *
    `);
    res.status(201).json((rows.rows ?? rows)[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Update bundle ─────────────────────────────────────────────────────────────
router.put("/bundles/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = BundleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { name, sku, description, price, notes, isActive } = parsed.data;
  try {
    const rows = await db.execute(sql`
      UPDATE bundles
      SET name = ${name}, sku = ${sku ?? null}, description = ${description ?? null},
          price = ${price}, notes = ${notes ?? null}, is_active = ${isActive}
      WHERE id = ${id}
      RETURNING *
    `);
    res.json((rows.rows ?? rows)[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Delete bundle ─────────────────────────────────────────────────────────────
router.delete("/bundles/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.execute(sql`DELETE FROM bundles WHERE id = ${id}`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Add component ─────────────────────────────────────────────────────────────
const ComponentSchema = z.object({
  productId: z.number().int().positive().optional().nullable(),
  productName: z.string().min(1),
  quantity: z.number().int().positive(),
  finishId: z.number().int().positive().optional().nullable(),
  finishName: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.post("/bundles/:id/components", async (req, res): Promise<void> => {
  const bundleId = parseInt(req.params.id);
  if (isNaN(bundleId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = ComponentSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { productId, productName, quantity, finishId, finishName, notes } = parsed.data;
  try {
    const rows = await db.execute(sql`
      INSERT INTO bundle_components (bundle_id, product_id, product_name, quantity, finish_id, finish_name, notes)
      VALUES (${bundleId}, ${productId ?? null}, ${productName}, ${quantity}, ${finishId ?? null}, ${finishName ?? null}, ${notes ?? null})
      RETURNING *
    `);
    const comp = (rows.rows ?? rows)[0] as any;
    if (productId) {
      const pRows = await db.execute(sql`SELECT name, sku FROM products WHERE id = ${productId}`);
      const p = (pRows.rows ?? pRows)[0] as any;
      if (p) { comp.resolved_name = p.name; comp.product_sku = p.sku; }
    }
    if (!comp.resolved_name) comp.resolved_name = productName;
    res.status(201).json(comp);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Update component ──────────────────────────────────────────────────────────
router.put("/bundles/:id/components/:compId", async (req, res): Promise<void> => {
  const bundleId = parseInt(req.params.id);
  const compId = parseInt(req.params.compId);
  if (isNaN(bundleId) || isNaN(compId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = ComponentSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { productId, productName, quantity, finishId, finishName, notes } = parsed.data;
  try {
    const rows = await db.execute(sql`
      UPDATE bundle_components
      SET product_id = ${productId ?? null}, product_name = ${productName}, quantity = ${quantity},
          finish_id = ${finishId ?? null}, finish_name = ${finishName ?? null}, notes = ${notes ?? null}
      WHERE id = ${compId} AND bundle_id = ${bundleId}
      RETURNING *
    `);
    res.json((rows.rows ?? rows)[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Delete component ──────────────────────────────────────────────────────────
router.delete("/bundles/:id/components/:compId", async (req, res): Promise<void> => {
  const bundleId = parseInt(req.params.id);
  const compId = parseInt(req.params.compId);
  if (isNaN(bundleId) || isNaN(compId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.execute(sql`DELETE FROM bundle_components WHERE id = ${compId} AND bundle_id = ${bundleId}`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Expand bundle into an order ───────────────────────────────────────────────
// Creates one header row (with the bundle price) and one component row per
// bundle component (price £0 — cost is captured by the header).
router.post("/bundles/:bundleId/add-to-order/:orderId", async (req, res): Promise<void> => {
  const bundleId = parseInt(req.params.bundleId);
  const orderId  = parseInt(req.params.orderId);
  if (isNaN(bundleId) || isNaN(orderId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = z.object({
    wearerName: z.string().optional().nullable(),
    componentOverrides: z.array(z.object({
      componentId: z.number().int(),
      colour: z.string().optional().nullable(),
      size: z.string().optional().nullable(),
      finishId: z.number().int().optional().nullable(),
      finishName: z.string().optional().nullable(),
      quantity: z.number().int().positive().optional(),
    })).optional(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const { wearerName = null, componentOverrides = [] } = body.data;
  const qty = 1; // bundles are always added one at a time

  try {
    const bundleRows = await db.execute(sql`SELECT * FROM bundles WHERE id = ${bundleId}`);
    const bundle = (bundleRows.rows ?? bundleRows)[0] as any;
    if (!bundle) { res.status(404).json({ error: "Bundle not found" }); return; }

    const compRows = await db.execute(sql`
      SELECT bc.*,
        COALESCE(p.name, bc.product_name) AS resolved_name,
        p.vat_rate  AS p_vat_rate,
        p.is_service AS p_is_service
      FROM bundle_components bc
      LEFT JOIN products p ON p.id = bc.product_id
      WHERE bc.bundle_id = ${bundleId}
      ORDER BY bc.id
    `);
    const components = (compRows.rows ?? compRows) as any[];

    const orderRows = await db.execute(sql`
      SELECT o.id, c.zero_vat
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.id = ${orderId}
    `);
    const order = (orderRows.rows ?? orderRows)[0] as any;
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }
    const zeroVat = order.zero_vat === true;

    const bundleRef  = `bundle-${randomUUID()}`;
    const unitPrice  = parseFloat(String(bundle.price));
    const lineTotal  = unitPrice * qty;

    // Header row — pricing container only; not a physical item, so no stock_status
    await db.execute(sql`
      INSERT INTO order_items
        (order_id, product_id, product_name, quantity, unit_price, line_total, vat_rate,
         purchase_required, stock_status, bundle_ref, is_bundle_header, bundle_def_id, recipient_type, recipient_name)
      VALUES
        (${orderId}, NULL, ${bundle.name}, ${qty}, ${unitPrice}, ${lineTotal},
         ${zeroVat ? 0 : 0.20}, false, NULL, ${bundleRef}, true, ${bundleId}, 'stock', ${wearerName ?? null})
    `);

    // Build a map of override rows per componentId (multiple rows allowed for size splits)
    const overrideRowsByComp = new Map<number, typeof componentOverrides>();
    for (const ov of componentOverrides) {
      const cid = Number(ov.componentId);
      if (!overrideRowsByComp.has(cid)) overrideRowsByComp.set(cid, []);
      overrideRowsByComp.get(cid)!.push(ov);
    }

    // Component rows — price £0
    // For physical (non-service) components we check actual variant stock to decide
    // whether the item needs purchasing (shortfall > 0) or can go straight to allocated.
    // Service items: stock_status=NULL — nothing to pick, no purchase needed.
    for (const comp of components) {
      const defaultQty   = qty * (parseInt(String(comp.quantity)) || 1);
      const compVat      = zeroVat ? 0 : parseFloat(String(comp.p_vat_rate ?? 0.20));
      const isService    = comp.p_is_service === true;
      const recipType    = isService ? "service" : "stock";

      // Each override row becomes a separate order_item; if no overrides, one default row
      const compRows = overrideRowsByComp.get(Number(comp.id)) ?? [null];

      for (const ov of compRows) {
        const compQty    = ov?.quantity ?? defaultQty;
        const colour     = (ov?.colour || null);
        const size       = (ov?.size || null);
        const finishId   = ov && ov.finishId  !== undefined ? ov.finishId  : (comp.finish_id   ?? null);
        const finishName = ov && ov.finishName !== undefined ? ov.finishName : (comp.finish_name ?? null);

        let purchaseRequired = false;
        let purchaseQuantity: number | null = null;
        let stockStatus: string | null = isService ? null : "allocated";

        if (!isService && comp.product_id) {
          const stockRows = await db.execute(sql`
            SELECT
              COALESCE(
                (SELECT pv.stock_quantity FROM product_variants pv
                 WHERE pv.product_id = ${comp.product_id}
                   AND pv.colour IS NOT DISTINCT FROM ${colour}
                   AND (
                     pv.size IS NOT DISTINCT FROM ${size}
                     OR (${size} LIKE '%/%'
                         AND pv.size = split_part(${size}, '/', 1)
                         AND pv.sleeve = split_part(${size}, '/', 2))
                     OR (pv.size IS NULL AND pv.sleeve IS NULL)
                   )
                 ORDER BY CASE WHEN pv.size IS NOT DISTINCT FROM ${size} THEN 0 ELSE 1 END
                 LIMIT 1),
                CASE WHEN NOT EXISTS (SELECT 1 FROM product_variants pv2 WHERE pv2.product_id = ${comp.product_id})
                     THEN (SELECT stock_quantity FROM products WHERE id = ${comp.product_id})
                     ELSE 0 END,
                0
              ) AS available_stock,
              COALESCE((
                SELECT SUM(poi2.quantity_ordered - COALESCE(poi2.quantity_delivered, 0))
                FROM purchase_order_items poi2
                JOIN purchase_orders po2 ON poi2.po_id = po2.id
                WHERE po2.status = 'ordered'
                  AND poi2.quantity_ordered > COALESCE(poi2.quantity_delivered, 0)
                  AND poi2.product_id = ${comp.product_id}
                  AND poi2.colour IS NOT DISTINCT FROM ${colour}
                  AND (poi2.size IS NOT DISTINCT FROM ${size}
                       OR (${size}::text LIKE '%/%' AND poi2.size = split_part(${size}, '/', 1))
                       OR poi2.size IS NULL)
                  AND (poi2.order_item_id IS NULL
                       OR NOT EXISTS (SELECT 1 FROM order_items oi_chk WHERE oi_chk.id = poi2.order_item_id))
                  AND (jsonb_array_length(COALESCE(poi2.source_order_item_ids, '[]'::jsonb)) = 0
                       OR NOT EXISTS (
                         SELECT 1 FROM order_items oi3
                         WHERE oi3.id IN (
                           SELECT (elem.value)::integer
                           FROM jsonb_array_elements_text(poi2.source_order_item_ids) AS elem(value)
                         )
                       ))
              ), 0) AS orphaned_on_order
          `);
          const stockRow0 = (stockRows.rows ?? stockRows)[0] as any;
          const availableStock = parseInt(String(stockRow0?.available_stock ?? 0))
                               + parseInt(String(stockRow0?.orphaned_on_order ?? 0));
          const shortfall = Math.max(0, compQty - availableStock);
          if (shortfall > 0) {
            purchaseRequired = true;
            purchaseQuantity = shortfall;
            stockStatus = null;
          }
        }

        await db.execute(sql`
          INSERT INTO order_items
            (order_id, product_id, product_name, quantity, unit_price, line_total, vat_rate,
             purchase_required, purchase_quantity, stock_status, bundle_ref, is_bundle_header, bundle_def_id, recipient_type,
             finish_id, finish_name, colour, size, recipient_name)
          VALUES
            (${orderId}, ${comp.product_id ?? null}, ${comp.resolved_name}, ${compQty},
             0, 0, ${compVat},
             ${purchaseRequired}, ${purchaseQuantity}, ${stockStatus}, ${bundleRef}, false, ${bundleId}, ${recipType},
             ${finishId}, ${finishName}, ${colour}, ${size}, ${wearerName ?? null})
        `);
      }
    }

    // Recalculate order total from all line items
    await db.execute(sql`
      UPDATE orders
      SET total_amount = (SELECT COALESCE(SUM(line_total), 0) FROM order_items WHERE order_id = ${orderId})
      WHERE id = ${orderId}
    `);

    res.json({ ok: true, bundleRef });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
