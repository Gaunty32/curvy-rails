import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import pino from "pino";

const logger = pino({ name: "category-management" });
const router = Router();

// ── GET /category-management — all categories (including 0-count) ─────────────
router.get("/category-management", async (_req: Request, res: Response) => {
  try {
    const rows = await db.execute(sql`
      SELECT id, woo_id, name, slug, image_url, parent_woo_id, product_count, display_order
      FROM product_categories
      ORDER BY display_order ASC, name ASC
    `);
    res.json((rows.rows as any[]).map((r) => ({
      id: r.id,
      wooId: r.woo_id,
      name: r.name,
      slug: r.slug,
      imageUrl: r.image_url,
      parentWooId: r.parent_woo_id,
      productCount: Number(r.product_count),
      displayOrder: Number(r.display_order),
    })));
  } catch (e: any) {
    logger.error({ err: e }, "[category-management] GET error");
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /category-management/reorder ───────────────────────────────────────
router.patch("/category-management/reorder", async (req: Request, res: Response) => {
  const parsed = z.array(z.object({ id: z.number(), displayOrder: z.number() })).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  try {
    for (const { id, displayOrder } of parsed.data) {
      await db.execute(sql`UPDATE product_categories SET display_order = ${displayOrder} WHERE id = ${id}`);
    }
    res.json({ ok: true });
  } catch (e: any) {
    logger.error({ err: e }, "[category-management] reorder error");
    res.status(500).json({ error: e.message });
  }
});

// ── POST /category-management/bulk-reassign ───────────────────────────────────
// Note: must be before /:id routes to avoid id matching "bulk-reassign"
router.post("/category-management/bulk-reassign", async (req: Request, res: Response) => {
  const parsed = z.object({
    productIds: z.array(z.number()).min(1),
    targetCategory: z.string().min(1),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const { productIds, targetCategory } = parsed.data;
  try {
    // Verify target category exists
    const catCheck = await db.execute(sql`SELECT id FROM product_categories WHERE name = ${targetCategory}`);
    if (!catCheck.rows.length) { res.status(400).json({ error: "Target category not found" }); return; }

    // Update products.category for each id individually to stay safe
    for (const pid of productIds) {
      await db.execute(sql`UPDATE products SET category = ${targetCategory} WHERE id = ${pid}`);
    }

    // Refresh product_count for ALL categories (simple full refresh)
    await db.execute(sql`
      UPDATE product_categories pc
      SET product_count = (
        SELECT COUNT(*) FROM products p
        WHERE TRIM(p.category) = TRIM(pc.name) AND p.is_archived = false AND p.is_service = false
      )
    `);

    res.json({ ok: true, moved: productIds.length });
  } catch (e: any) {
    logger.error({ err: e }, "[category-management] bulk-reassign error");
    res.status(500).json({ error: e.message });
  }
});

// ── GET /category-management/:id/products ─────────────────────────────────────
router.get("/category-management/:id/products", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    const catRows = await db.execute(sql`SELECT name FROM product_categories WHERE id = ${id}`);
    if (!catRows.rows.length) { res.status(404).json({ error: "Category not found" }); return; }
    const catName = (catRows.rows[0] as any).name;
    const prods = await db.execute(sql`
      SELECT id, name, sku, category, image_url
      FROM products
      WHERE TRIM(category) = TRIM(${catName}) AND is_archived = false AND is_service = false
      ORDER BY name ASC
    `);
    res.json(prods.rows);
  } catch (e: any) {
    logger.error({ err: e }, "[category-management] get products error");
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /category-management/:id ───────────────────────────────────────────
router.patch("/category-management/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const parsed = z.object({
    name: z.string().min(1).optional(),
    slug: z.string().optional(),
    parentWooId: z.number().nullable().optional(),
    imageUrl: z.string().nullable().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const { name, slug, parentWooId, imageUrl } = parsed.data;
  try {
    if (name !== undefined) {
      const oldNameRow = await db.execute(sql`SELECT name FROM product_categories WHERE id = ${id}`);
      const oldName = (oldNameRow.rows[0] as any)?.name;
      await db.execute(sql`UPDATE product_categories SET name = ${name} WHERE id = ${id}`);
      if (oldName && oldName !== name) {
        await db.execute(sql`UPDATE products SET category = ${name} WHERE TRIM(category) = TRIM(${oldName})`);
      }
    }
    if (slug !== undefined) await db.execute(sql`UPDATE product_categories SET slug = ${slug} WHERE id = ${id}`);
    if (parentWooId !== undefined) await db.execute(sql`UPDATE product_categories SET parent_woo_id = ${parentWooId} WHERE id = ${id}`);
    if (imageUrl !== undefined) await db.execute(sql`UPDATE product_categories SET image_url = ${imageUrl} WHERE id = ${id}`);
    res.json({ ok: true });
  } catch (e: any) {
    logger.error({ err: e }, "[category-management] PATCH error");
    res.status(500).json({ error: e.message });
  }
});

// ── POST /category-management ─────────────────────────────────────────────────
router.post("/category-management", async (req: Request, res: Response) => {
  const parsed = z.object({
    name: z.string().min(1),
    slug: z.string().optional(),
    parentWooId: z.number().nullable().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const { name, parentWooId } = parsed.data;
  const slug = parsed.data.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  try {
    const result = await db.execute(sql`
      INSERT INTO product_categories (name, slug, parent_woo_id, product_count, display_order)
      VALUES (
        ${name}, ${slug}, ${parentWooId ?? null}, 0,
        (SELECT COALESCE(MAX(display_order), 0) + 1 FROM product_categories)
      )
      RETURNING id, name, slug, parent_woo_id AS "parentWooId", product_count AS "productCount", display_order AS "displayOrder"
    `);
    res.status(201).json(result.rows[0]);
  } catch (e: any) {
    logger.error({ err: e }, "[category-management] POST error");
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /category-management/:id ──────────────────────────────────────────
router.delete("/category-management/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    const row = await db.execute(sql`SELECT name, product_count FROM product_categories WHERE id = ${id}`);
    if (!row.rows.length) { res.status(404).json({ error: "Not found" }); return; }
    const cat = row.rows[0] as any;
    if (Number(cat.product_count) > 0) {
      res.status(400).json({ error: `Move the ${cat.product_count} product(s) to another category first.` });
      return;
    }
    await db.execute(sql`DELETE FROM product_categories WHERE id = ${id}`);
    res.json({ ok: true });
  } catch (e: any) {
    logger.error({ err: e }, "[category-management] DELETE error");
    res.status(500).json({ error: e.message });
  }
});

export default router;
