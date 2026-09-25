import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { timingSafeEqual } from "crypto";
import { db, settingsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

function addWorkingDays(date: Date, days: number): Date {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

async function getStoredToken(): Promise<string | null> {
  const [row] = await db
    .select({ value: settingsTable.value })
    .from(settingsTable)
    .where(eq(settingsTable.key, "tv_display_token"));
  return row?.value ?? null;
}

function tokensMatch(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

router.get("/tv/daily-plan", async (req, res): Promise<void> => {
  const provided = typeof req.query.token === "string" ? req.query.token : null;
  if (!provided) {
    res.status(401).json({ error: "Missing token" });
    return;
  }

  const stored = await getStoredToken();
  if (!stored || !tokensMatch(provided, stored)) {
    res.status(403).json({ error: "Invalid token" });
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const twoDaysCutoff = addWorkingDays(today, 2);

  const pickingRows = await db.execute(sql`
    SELECT
      'picking'          AS work_type,
      oi.id              AS item_id,
      COALESCE(oi.finish_name, 'Plain') AS finish_name,
      oi.finish_id,
      oi.quantity,
      oi.product_name,
      oi.colour,
      oi.size,
      oi.recipient_name,
      oi.recipient_type,
      o.id               AS order_id,
      o.order_number,
      o.customer_name,
      o.required_date,
      NULL::int          AS worksheet_id,
      NULL::text         AS worksheet_number,
      NULL::text         AS ws_status
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.stock_status = 'allocated' AND oi.finish_id IS NOT NULL
      AND o.status NOT IN ('cancelled', 'archived', 'dispatched', 'shipped')
    ORDER BY o.required_date ASC NULLS LAST
  `);

  const wsRows = await db.execute(sql`
    SELECT
      'worksheet'        AS work_type,
      wi.id              AS item_id,
      COALESCE(wi.finish_name, 'Plain') AS finish_name,
      wi.finish_id,
      wi.quantity,
      wi.product_name,
      wi.colour,
      wi.size,
      wi.recipient_name,
      wi.recipient_type,
      o.id               AS order_id,
      o.order_number,
      o.customer_name,
      o.required_date,
      w.id               AS worksheet_id,
      w.worksheet_number,
      w.status           AS ws_status
    FROM worksheet_items wi
    JOIN worksheets w ON w.id = wi.worksheet_id
    LEFT JOIN orders o ON o.id = w.order_id
    WHERE w.status IN ('pre_wip', 'wip')
      AND (o.id IS NULL OR o.status NOT IN ('cancelled', 'archived', 'dispatched', 'shipped'))
    ORDER BY o.required_date ASC NULLS LAST
  `);

  const allRows = [...(pickingRows.rows as any[]), ...(wsRows.rows as any[])];

  // Group by order; worksheets with no linked order fall back to worksheet number
  const orderGroups = new Map<string, any[]>();
  for (const row of allRows) {
    const key = row.order_id != null
      ? `order:${row.order_id}`
      : `ws:${row.worksheet_id ?? row.finish_name ?? "unknown"}`;
    if (!orderGroups.has(key)) orderGroups.set(key, []);
    orderGroups.get(key)!.push(row);
  }

  const taskGroups = Array.from(orderGroups.values()).map((rows) => {
    const first = rows[0];
    const finishName: string =
      (first.customer_name as string | null) ??
      (first.order_number  as string | null) ??
      (first.worksheet_number as string | null) ??
      (first.finish_name   as string | null) ??
      "Unknown";
    const totalQty = rows.reduce((sum: number, r: any) => sum + Number(r.quantity), 0);

    const dates = rows
      .map((r: any) => (r.required_date ? new Date(r.required_date) : null))
      .filter((d): d is Date => d != null);
    const earliestDate = dates.length > 0
      ? new Date(Math.min(...dates.map((d) => d.getTime())))
      : null;

    const daysUntilDue = earliestDate
      ? Math.floor((earliestDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    let urgency: "overdue" | "today" | "soon" | "this_week" | "upcoming";
    if (daysUntilDue === null)   urgency = "upcoming";
    else if (daysUntilDue < 0)  urgency = "overdue";
    else if (daysUntilDue === 0) urgency = "today";
    else if (earliestDate != null && earliestDate <= twoDaysCutoff) urgency = "soon";
    else if (daysUntilDue <= 7) urgency = "this_week";
    else                        urgency = "upcoming";

    const hasWip     = rows.some((r: any) => r.ws_status === "wip");
    const hasPreWip  = rows.some((r: any) => r.ws_status === "pre_wip");
    const hasPicking = rows.some((r: any) => r.work_type === "picking");

    let overallStatus: "in_progress" | "ready" | "pick_first" | "mixed";
    if      (hasWip && !hasPreWip && !hasPicking) overallStatus = "in_progress";
    else if (hasPreWip && !hasPicking && !hasWip) overallStatus = "ready";
    else if (hasPicking && !hasWip && !hasPreWip) overallStatus = "pick_first";
    else                                          overallStatus = "mixed";

    // Per-finish breakdown (for display as pills)
    const byFinish = new Map<string, any[]>();
    for (const row of rows) {
      const fk = (row.finish_name as string) ?? "Plain";
      if (!byFinish.has(fk)) byFinish.set(fk, []);
      byFinish.get(fk)!.push(row);
    }
    const finishes = Array.from(byFinish.entries()).map(([fn, fRows]) => ({
      finishName: fn,
      qty: fRows.reduce((s: number, r: any) => s + Number(r.quantity), 0),
      worksheetNumber: (fRows.find((r: any) => r.worksheet_number != null)?.worksheet_number as string | null) ?? null,
      type: fRows[0].work_type === "picking" ? "picking" : ((fRows[0].ws_status as string) ?? "pre_wip"),
    }));

    const byTask = new Map<string, any[]>();
    for (const row of rows) {
      const key = `${row.order_id ?? "none"}:${row.ws_status ?? "picking"}:${row.worksheet_id ?? ""}`;
      if (!byTask.has(key)) byTask.set(key, []);
      byTask.get(key)!.push(row);
    }

    const tasks = Array.from(byTask.values()).map((taskRows) => {
      const first = taskRows[0];
      return {
        type:            first.work_type === "picking" ? "picking" : (first.ws_status as string),
        finishName:      (first.finish_name as string | null) ?? null,
        worksheetId:     first.worksheet_id    as number | null,
        worksheetNumber: first.worksheet_number as string | null,
        orderId:         first.order_id         as number | null,
        orderNumber:     first.order_number     as string | null,
        customerName:    first.customer_name    as string | null,
        requiredDate:    first.required_date    ? new Date(first.required_date).toISOString() : null,
        qty:             taskRows.reduce((s: number, r: any) => s + Number(r.quantity), 0),
        items:           taskRows.map((r: any) => ({
          productName: r.product_name  as string,
          colour:      r.colour        as string | null,
          size:        r.size          as string | null,
          qty:         Number(r.quantity),
          recipient:   r.recipient_name as string | null,
        })),
      };
    });

    const orderIds = new Set(rows.map((r: any) => r.order_id).filter(Boolean));

    return {
      finishName,
      customerName: finishName,
      finishes,
      totalQty,
      orderCount: orderIds.size,
      overallStatus,
      urgency,
      daysUntilDue,
      earliestRequired: earliestDate ? earliestDate.toISOString() : null,
      tasks,
    };
  });

  const urgencyOrder = { overdue: 0, today: 1, soon: 2, this_week: 3, upcoming: 4 };
  taskGroups.sort((a, b) => {
    const uDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    if (uDiff !== 0) return uDiff;
    if (a.daysUntilDue === null && b.daysUntilDue === null) return 0;
    if (a.daysUntilDue === null) return 1;
    if (b.daysUntilDue === null) return -1;
    return a.daysUntilDue - b.daysUntilDue;
  });

  const summary = {
    overdue:   taskGroups.filter((g) => g.urgency === "overdue").length,
    today:     taskGroups.filter((g) => g.urgency === "today").length,
    soon:      taskGroups.filter((g) => g.urgency === "soon").length,
    thisWeek:  taskGroups.filter((g) => g.urgency === "this_week").length,
    upcoming:  taskGroups.filter((g) => g.urgency === "upcoming").length,
    urgentCount: taskGroups.filter((g) => ["overdue","today","soon"].includes(g.urgency)).length,
    urgentItems: taskGroups
      .filter((g) => ["overdue","today","soon"].includes(g.urgency))
      .reduce((s, g) => s + g.totalQty, 0),
    totalItems: taskGroups.reduce((s, g) => s + g.totalQty, 0),
  };

  res.json({ generatedAt: new Date().toISOString(), taskGroups, summary });
});

export default router;
