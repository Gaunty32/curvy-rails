import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { portalAuth } from "./portal.js";
import { z } from "zod";

const router: IRouter = Router();

// ── Portal: get current month's offer + this customer's claim status ──────────

router.get("/portal/select-extra/current", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  try {
    const rows = await db.execute(sql`
      SELECT
        o.id, o.year, o.month, o.title, o.product_name, o.description,
        o.image_url, o.product_url, o.quantity, o.min_spend, o.is_active,
        c.id AS claim_id, c.claimed_at, c.order_number AS claim_order_number
      FROM select_extra_offers o
      LEFT JOIN select_extra_claims c ON c.offer_id = o.id AND c.customer_id = ${customerId}
      WHERE o.year = ${year} AND o.month = ${month}
        AND o.is_active = true
      LIMIT 1
    `);

    if (!rows.rows.length) {
      res.json({ offer: null, claimed: false });
      return;
    }

    const row = rows.rows[0] as any;
    res.json({
      offer: {
        id: row.id,
        year: row.year,
        month: row.month,
        title: row.title,
        productName: row.product_name,
        description: row.description,
        imageUrl: row.image_url,
        productUrl: row.product_url,
        quantity: Number(row.quantity),
        minSpend: parseFloat(row.min_spend),
      },
      claimed: row.claim_id !== null,
      claimOrderNumber: row.claim_order_number ?? null,
    });
  } catch (err: any) {
    console.error("select-extra/current error:", err);
    res.status(500).json({ error: "Failed to load offer" });
  }
});

// ── Staff: list all offers ────────────────────────────────────────────────────

router.get("/select-extra/offers", async (_req: Request, res: Response) => {
  try {
    const rows = await db.execute(sql`
      SELECT o.*,
        (SELECT COUNT(*) FROM select_extra_claims WHERE offer_id = o.id)::int AS claim_count
      FROM select_extra_offers o
      ORDER BY o.year DESC, o.month DESC
    `);
    res.json(rows.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Staff: create or update offer for a given month ───────────────────────────

router.post("/select-extra/offers", async (req: Request, res: Response) => {
  const parsed = z.object({
    year: z.number().int().min(2024).max(2035),
    month: z.number().int().min(1).max(12),
    title: z.string().min(1),
    productName: z.string().min(1),
    description: z.string().optional(),
    imageUrl: z.string().optional(),
    productUrl: z.string().optional(),
    quantity: z.number().int().positive().default(1),
    minSpend: z.number().positive().default(250),
    isActive: z.boolean().default(true),
  }).safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const d = parsed.data;
  try {
    await db.execute(sql`
      INSERT INTO select_extra_offers (year, month, title, product_name, description, image_url, product_url, quantity, min_spend, is_active)
      VALUES (${d.year}, ${d.month}, ${d.title}, ${d.productName}, ${d.description ?? null}, ${d.imageUrl ?? null}, ${d.productUrl ?? null}, ${d.quantity}, ${d.minSpend}, ${d.isActive})
      ON CONFLICT (year, month) DO UPDATE SET
        title = EXCLUDED.title,
        product_name = EXCLUDED.product_name,
        description = EXCLUDED.description,
        image_url = EXCLUDED.image_url,
        product_url = EXCLUDED.product_url,
        quantity = EXCLUDED.quantity,
        min_spend = EXCLUDED.min_spend,
        is_active = EXCLUDED.is_active
    `);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Portal: library of past offers ───────────────────────────────────────────

router.get("/portal/select-extra/library", portalAuth, async (req: Request, res: Response) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  try {
    const rows = await db.execute(sql`
      SELECT id, year, month, title, product_name, description, image_url, product_url, quantity, min_spend
      FROM select_extra_offers
      WHERE (year < ${year} OR (year = ${year} AND month < ${month}))
        AND product_name IS NOT NULL AND product_name != ''
      ORDER BY year DESC, month DESC
      LIMIT 24
    `);
    res.json(rows.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Staff: toggle offer active/inactive ───────────────────────────────────────

router.patch("/select-extra/offers/:id/active", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const rows = await db.execute(sql`
      UPDATE select_extra_offers SET is_active = NOT is_active WHERE id = ${id}
      RETURNING id, is_active
    `);
    if (!rows.rows.length) { res.status(404).json({ error: "Not found" }); return; }
    res.json(rows.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Staff: list claims (optionally filtered by year/month) ────────────────────

router.get("/select-extra/claims", async (req: Request, res: Response) => {
  const now = new Date();
  const year = parseInt(req.query.year as string) || now.getFullYear();
  const month = parseInt(req.query.month as string) || (now.getMonth() + 1);

  try {
    const rows = await db.execute(sql`
      SELECT
        c.id, c.claimed_at, c.order_number, c.customer_name,
        cu.name AS customer_display_name,
        o.title AS offer_title, o.product_name, o.quantity
      FROM select_extra_claims c
      JOIN select_extra_offers o ON o.id = c.offer_id
      JOIN customers cu ON cu.id = c.customer_id
      WHERE o.year = ${year} AND o.month = ${month}
      ORDER BY c.claimed_at DESC
    `);
    res.json(rows.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
