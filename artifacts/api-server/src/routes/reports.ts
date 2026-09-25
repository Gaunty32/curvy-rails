import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

// ─── Portal pending orders report ────────────────────────────────────────────
// Returns customers that have portal orders not yet confirmed by fulfilment,
// grouped by customer with summary counts, total value, and per-order detail.

router.get("/reports/portal-pending", async (req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT
      o.id,
      o.order_number,
      o.customer_id,
      o.customer_name,
      o.status,
      o.portal_status,
      o.total_amount,
      o.order_date,
      o.created_at,
      o.required_date,
      o.portal_submitted_by_name,
      o.portal_submitted_by_email,
      o.notes,
      o.portal_notes,
      c.email       AS customer_email,
      c.phone       AS customer_phone,
      (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.source = 'portal'
      AND o.portal_status NOT IN ('confirmed', 'rejected')
    ORDER BY o.created_at ASC
  `);

  // Group by customer
  const byCustomer: Record<string, {
    customerId: number;
    customerName: string;
    customerEmail: string | null;
    customerPhone: string | null;
    orders: any[];
    totalValue: number;
    oldestOrderDate: string;
  }> = {};

  for (const row of rows.rows as any[]) {
    const key = String(row.customer_id ?? row.customer_name);
    if (!byCustomer[key]) {
      byCustomer[key] = {
        customerId: row.customer_id,
        customerName: row.customer_name,
        customerEmail: row.customer_email ?? null,
        customerPhone: row.customer_phone ?? null,
        orders: [],
        totalValue: 0,
        oldestOrderDate: row.created_at,
      };
    }
    byCustomer[key].orders.push({
      id: row.id,
      orderNumber: row.order_number,
      status: row.status,
      portalStatus: row.portal_status,
      totalAmount: parseFloat(row.total_amount ?? "0"),
      orderDate: row.order_date,
      createdAt: row.created_at,
      requiredDate: row.required_date,
      submittedByName: row.portal_submitted_by_name,
      submittedByEmail: row.portal_submitted_by_email,
      itemCount: parseInt(row.item_count ?? "0"),
      notes: row.portal_notes || row.notes || null,
    });
    byCustomer[key].totalValue += parseFloat(row.total_amount ?? "0");
    // keep the oldest created_at (not order_date — order_date is user-editable and can be backdated)
    if (row.created_at < byCustomer[key].oldestOrderDate) {
      byCustomer[key].oldestOrderDate = row.created_at;
    }
  }

  const result = Object.values(byCustomer).sort(
    (a, b) => new Date(a.oldestOrderDate).getTime() - new Date(b.oldestOrderDate).getTime()
  );

  res.json({ customers: result, totalOrders: rows.rows.length });
});

// ─── Active portal baskets ───────────────────────────────────────────────────
// Returns customers who have items in their basket but haven't submitted yet.

router.get("/reports/portal-baskets", async (req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT
      pb.id,
      pb.portal_user_id,
      pb.customer_id,
      pb.customer_name,
      pb.user_email,
      pb.item_count,
      pb.estimated_total,
      pb.mode,
      pb.step,
      pb.updated_at,
      pb.created_at,
      c.phone       AS customer_phone,
      cpu.email     AS portal_email
    FROM portal_baskets pb
    LEFT JOIN customers c  ON c.id  = pb.customer_id
    LEFT JOIN customer_portal_users cpu ON cpu.id = pb.portal_user_id
    WHERE pb.item_count > 0
    ORDER BY pb.updated_at DESC
  `);

  const baskets = (rows.rows as any[]).map(r => ({
    id: r.id,
    portalUserId: r.portal_user_id,
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerPhone: r.customer_phone ?? null,
    userEmail: r.portal_email ?? r.user_email ?? null,
    userDisplayName: r.portal_email ?? r.user_email ?? "Unknown",
    itemCount: parseInt(r.item_count ?? "0"),
    estimatedTotal: parseFloat(r.estimated_total ?? "0"),
    mode: r.mode ?? null,
    step: r.step ?? 1,
    updatedAt: r.updated_at,
    createdAt: r.created_at,
  }));

  res.json({ baskets, total: baskets.length });
});

// ─── GP summary by order ─────────────────────────────────────────────────────
// Returns active orders with garment cost, process cost, and calculated GP%.
// Only includes orders where at least one item has a known supplier price.

router.get("/reports/gp-summary", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT
      o.id,
      o.order_number,
      o.customer_name,
      o.order_date,
      o.required_date,
      o.status,
      o.total_amount::float AS revenue,
      COALESCE(garment.cost, 0)::float AS garment_cost,
      COALESCE(proc.cost, 0)::float   AS process_cost
    FROM orders o
    LEFT JOIN (
      SELECT oi.order_id, SUM(oi.quantity * p.supplier_price) AS cost
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      WHERE p.supplier_price IS NOT NULL
      GROUP BY oi.order_id
    ) garment ON garment.order_id = o.id
    LEFT JOIN (
      SELECT oi.order_id, SUM(ps.unit_cost * oi.quantity) AS cost
      FROM order_items oi
      JOIN customer_finish_processes cfp ON cfp.finish_id = oi.finish_id
      JOIN customer_processes cp ON cp.id = cfp.process_id
      JOIN process_stock ps ON ps.id = cp.process_stock_id
      WHERE oi.finish_id IS NOT NULL
      GROUP BY oi.order_id
    ) proc ON proc.order_id = o.id
    WHERE o.status NOT IN ('cancelled', 'portal_draft', 'archived')
      AND o.total_amount > 0
      AND garment.cost IS NOT NULL
    ORDER BY o.required_date ASC NULLS LAST, o.order_date DESC
    LIMIT 200
  `);

  const orders = (rows.rows as any[]).map(r => {
    const revenue = parseFloat(r.revenue ?? "0");
    const garmentCost = parseFloat(r.garment_cost ?? "0");
    const processCost = parseFloat(r.process_cost ?? "0");
    const totalCost = garmentCost + processCost;
    const gp = revenue > 0 ? ((revenue - totalCost) / revenue) * 100 : null;
    return {
      id: r.id,
      orderNumber: r.order_number,
      customerName: r.customer_name,
      orderDate: r.order_date,
      requiredDate: r.required_date,
      status: r.status,
      revenue,
      garmentCost,
      processCost,
      totalCost,
      gp,
    };
  });

  res.json({ orders });
});

// ─── Weekly sales ─────────────────────────────────────────────────────────────
// Week = Monday 00:00 → Sunday 23:59 (UK local time via AT TIME ZONE).
// Excludes: draft, portal_draft, cancelled, archived orders.

router.get("/reports/weekly-sales", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    WITH
      week_start AS (
        SELECT date_trunc('week', NOW() AT TIME ZONE 'Europe/London')::date AS mon
      ),
      params AS (
        SELECT
          mon                     AS this_mon,
          (mon - interval '7 days')::date  AS last_mon
        FROM week_start
      ),
      -- this week per-day totals (Mon=0 … Sun=6)
      this_days AS (
        SELECT
          (o.order_date AT TIME ZONE 'Europe/London')::date AS day,
          COALESCE(SUM(o.total_amount), 0)::float           AS total,
          COUNT(*)                                          AS cnt
        FROM orders o, params
        WHERE (o.order_date AT TIME ZONE 'Europe/London')::date
              BETWEEN params.this_mon AND (params.this_mon + interval '6 days')::date
          AND o.status NOT IN ('cancelled','draft','portal_draft','archived')
        GROUP BY 1
      ),
      -- last week totals
      last_week AS (
        SELECT
          COALESCE(SUM(o.total_amount), 0)::float AS total,
          COUNT(*)                                AS cnt
        FROM orders o, params
        WHERE (o.order_date AT TIME ZONE 'Europe/London')::date
              BETWEEN params.last_mon AND (params.last_mon + interval '6 days')::date
          AND o.status NOT IN ('cancelled','draft','portal_draft','archived')
      ),
      -- 8-week rolling totals (oldest first)
      trend AS (
        SELECT
          date_trunc('week', o.order_date AT TIME ZONE 'Europe/London')::date AS week_mon,
          COALESCE(SUM(o.total_amount), 0)::float AS total,
          COUNT(*) AS cnt
        FROM orders o, params
        WHERE o.order_date >= (params.this_mon - interval '7 weeks')
          AND o.status NOT IN ('cancelled','draft','portal_draft','archived')
        GROUP BY 1
        ORDER BY 1
      )
    SELECT
      (SELECT mon FROM week_start)                    AS this_mon,
      (SELECT last_mon FROM params)                   AS last_mon,
      (SELECT total FROM last_week)                   AS last_week_total,
      (SELECT cnt   FROM last_week)                   AS last_week_cnt,
      (SELECT json_agg(json_build_object('day', day, 'total', total, 'cnt', cnt) ORDER BY day)
       FROM this_days)                                AS daily,
      (SELECT json_agg(json_build_object('weekMon', week_mon, 'total', total, 'cnt', cnt) ORDER BY week_mon)
       FROM trend)                                    AS trend
  `);

  const r = (rows.rows as any[])[0];

  const daily: { day: string; total: number; cnt: number }[] = r.daily ?? [];
  const trend: { weekMon: string; total: number; cnt: number }[] = r.trend ?? [];

  // Compute this-week total from daily breakdown
  const thisWeekTotal = daily.reduce((s: number, d: any) => s + (d.total ?? 0), 0);
  const thisWeekCnt   = daily.reduce((s: number, d: any) => s + (d.cnt ?? 0), 0);
  const lastWeekTotal = parseFloat(r.last_week_total ?? "0");
  const lastWeekCnt   = parseInt(r.last_week_cnt ?? "0");

  res.json({
    thisWeekTotal,
    thisWeekCnt,
    lastWeekTotal,
    lastWeekCnt,
    thisWeekStart: r.this_mon,   // ISO date string e.g. "2025-06-02"
    lastWeekStart: r.last_mon,
    daily,
    trend,
  });
});

export default router;
