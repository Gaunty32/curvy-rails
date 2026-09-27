import { Router, type IRouter } from "express";
import { eq, desc, asc, sql, inArray, and, ne, isNotNull, lt, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  db, ordersTable, orderItemsTable, orderLogsTable, orderLabelPrintsTable, orderEmailLogsTable, customersTable, productsTable,
  worksheetsTable, worksheetItemsTable, customerEmployeesTable, customerTeamsTable,
  customerDeliveryAddressesTable, customerEmployeeSizesTable, suppliersTable,
  purchaseOrdersTable, purchaseOrderItemsTable,
  customerProcessesTable, customerFinishProcessesTable, processStockTable,
  productVariantsTable, customerFinishedItemsTable,
} from "@workspace/db";
import { buildAcknowledgementEmail, generateOrderAcknowledgementPdf, sendEmail, isEmailConfigured, fetchLogoBuffer, fetchLogoDataUrl } from "../services/email";
import { fireWorkflow } from "../services/workflow-engine.js";
import { buildInviteEmail } from "./portal.js";
import { SBS_LOGO_DATA_URL } from "../assets/logo-data.js";
import { logOrderAction, getActor } from "../services/orderLog";
import { sendOrderConfirmationContentAlert } from "../services/orderConfirmationContentAlert.js";
import { requireConfiguredBusinessIdentity } from "../lib/business-config.js";
import { getUncachableStripeClient } from "../services/stripeClient.js";
import { getManagerPackingCustomerIds, isManagerPackingEnabled } from "../lib/customer-dispatch-settings.js";
import { createManufacturingAvailabilityService } from "../services/manufacturing-availability.js";
import { staffAuthorization } from "./staff-auth.js";
import {
  UpdateOrderBody,
  GetOrderParams,
  UpdateOrderParams,
  DeleteOrderParams,
  ListOrdersQueryParams,
  AddOrderItemParams,
  AddOrderItemBody,
  UpdateOrderItemParams,
  UpdateOrderItemBody,
  DeleteOrderItemParams,
} from "@workspace/api-zod";

// Custom schema — generated CreateOrderBody uses zod.date() which rejects ISO strings from JSON
const CreateOrderBodyFixed = z.object({
  customerId: z.number().int().positive().optional().nullable(),
  notes: z.string().optional().nullable(),
  orderDate: z.string().optional().nullable(),
  items: z.array(z.object({
    productId: z.number().optional().nullable(),
    productName: z.string(),
    quantity: z.number(),
    unitPrice: z.number(),
  })).optional(),
});

const router: IRouter = Router();
const componentAvailability = createManufacturingAvailabilityService(db);

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, character =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character));
}

function applyBusinessIdentityToAcknowledgement<T extends { html: string; text?: string }>(
  content: T,
  business: { name: string; email: string; phone: string },
): T {
  const businessNameHtml = escapeHtml(business.name);
  const businessContactHtml = `${escapeHtml(business.email)} &bull; ${escapeHtml(business.phone)}`;
  return {
    ...content,
    html: content.html.replace(/Configured[ \u00a0]+organisation/g, businessNameHtml)
      .replace("</body>", `<p style="text-align:center;color:#64748b;font-size:11px;padding:16px;">${businessNameHtml} &bull; ${businessContactHtml}</p></body>`),
    ...(content.text !== undefined ? { text: content.text.replace(/Configured[ \u00a0]+organisation/g, business.name)
      + `\n\n${business.name} | ${business.email} | ${business.phone}` } : {}),
  };
}

async function getDefaultSavedDeliveryAddress(customerId: number | null) {
  if (!customerId) return null;
  const [address] = await db.select().from(customerDeliveryAddressesTable)
    .where(eq(customerDeliveryAddressesTable.customerId, customerId))
    .orderBy(desc(customerDeliveryAddressesTable.isDefault), asc(customerDeliveryAddressesTable.id))
    .limit(1);
  return address ?? null;
}

async function generateOrderNumber(): Promise<string> {
  const rows = await db.execute(sql`
    SELECT order_number FROM orders
    WHERE order_number ~ '^O[0-9]+$'
    ORDER BY LENGTH(order_number) DESC, order_number DESC
    LIMIT 1
  `);
  const last = (rows.rows[0] as any)?.order_number as string | undefined;
  const maxNum = last ? parseInt(last.slice(1), 10) : 99;
  return `O${maxNum + 1}`;
}

async function createStripePaymentLink(opts: {
  orderNumber: string;
  totalAmount: number;
  stripeCustomerId?: string | null;
  baseUrl: string;
}): Promise<string | null> {
  const business = await requireConfiguredBusinessIdentity();
  try {
    const stripe = await getUncachableStripeClient();
    const amountPence = Math.round(opts.totalAmount * 100);
    if (amountPence <= 0) return null;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "gbp",
          product_data: {
            name: `Order Payment – Ref: ${opts.orderNumber}`,
            description: business.name,
          },
          unit_amount: amountPence,
        },
        quantity: 1,
      }],
      ...(opts.stripeCustomerId ? { customer: opts.stripeCustomerId } : {}),
      success_url: `${opts.baseUrl}/customer-portal/`,
      cancel_url: `${opts.baseUrl}/customer-portal/`,
      metadata: { sbs_order_number: opts.orderNumber },
    });
    return session.url;
  } catch {
    return null;
  }
}

function numericToFloat(val: string | null | undefined): number {
  return val ? parseFloat(val) : 0;
}

async function recalcOrderTotal(orderId: number): Promise<void> {
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  // Exclude bundle component rows — their price is already included in the bundle header's line_total.
  // A component row has bundle_ref set AND is_bundle_header = false/null.
  const total = items
    .filter((item) => !(item.bundleRef && !item.isBundleHeader))
    .reduce((sum, item) => sum + numericToFloat(item.lineTotal), 0);
  await db
    .update(ordersTable)
    .set({ totalAmount: String(total), updatedAt: new Date() })
    .where(eq(ordersTable.id, orderId));
}

const ORDER_NUM_SORT = [sql`NULLIF(REGEXP_REPLACE(${ordersTable.orderNumber}, '[^0-9]', '', 'g'), '')::integer DESC NULLS LAST`] as const;

router.get("/orders", async (req, res): Promise<void> => {
  const query = ListOrdersQueryParams.safeParse(req.query);
  // Exclude portal_draft orders (awaiting customer manager approval),
  // portal_pending orders (awaiting confirmation — shown in the dedicated panel instead),
  // and cancelled orders (not needed in the orders view).
  // Do NOT filter by portal_status='rejected' here — orders that went through the portal flow
  // can end up confirmed/cancelled with that flag set, and should still appear in the list.
  const baseCondition = sql`(
    ${ordersTable.status} IS DISTINCT FROM 'portal_draft'
    AND ${ordersTable.status} IS DISTINCT FROM 'portal_pending'
    AND ${ordersTable.status} IS DISTINCT FROM 'website_pending'
    AND NOT (${ordersTable.source} = 'shop' AND ${ordersTable.status} = 'processing')
    AND ${ordersTable.status} IS DISTINCT FROM 'cancelled'
  )`;
  let orders;
  if (query.success) {
    const conditions = [baseCondition];
    if (query.data.status === "active") {
      // Hide orders that are fully done: shipped + (invoiced to Xero OR zero-value — £0 orders can never get a Xero invoice)
      conditions.push(sql`NOT (${ordersTable.status} = 'shipped' AND (${ordersTable.xeroInvoiceId} IS NOT NULL OR COALESCE(${ordersTable.totalAmount}::numeric, 0) = 0))`);
    } else if (query.data.status) {
      conditions.push(eq(ordersTable.status, query.data.status));
    }
    if (query.data.customerId) conditions.push(eq(ordersTable.customerId, query.data.customerId));
    orders = await db.select().from(ordersTable).where(and(...conditions)).orderBy(...ORDER_NUM_SORT);
  } else {
    orders = await db.select().from(ordersTable).where(baseCondition).orderBy(...ORDER_NUM_SORT);
  }
  // Attach per-order GP margin — only when EVERY non-service line item has a supplier price.
  // Variant-level supplier_price takes precedence over product-level (COALESCE pv → p).
  // If any item is missing a cost we return null so the UI shows "—" rather than a false 100%.
  const orderIds = orders.map(o => o.id);
  type CostRow = { orderId: number; cost: number; missingCost: number };
  const costByOrderId = new Map<number, CostRow>();
  type SupplierChaseSummary = {
    orderId: number;
    overdueSupplierItemCount: number;
    unchasedSupplierItemCount: number;
    missingSupplierEmailCount: number;
    supplierChaseSentAt: string | null;
  };
  const supplierChaseByOrderId = new Map<number, SupplierChaseSummary>();
  if (orderIds.length > 0) {
    const costRows = await db.execute(sql`
      SELECT
        oi.order_id AS "orderId",
        COALESCE(SUM(oi.quantity * resolved.supplier_price), 0)::float AS cost,
        COUNT(*) FILTER (
          WHERE oi.product_id IS NOT NULL
            AND oi.is_bundle_header IS NOT TRUE
            AND p.is_service IS NOT TRUE
            AND (resolved.supplier_price IS NULL OR resolved.supplier_price = 0)
        )::int AS "missingCost"
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      -- LATERAL ensures at most one variant row per order item, preventing cost multiplication.
      -- Shirt/blouse order sizes may combine collar and sleeve while variants store them separately.
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          (SELECT pv.supplier_price
           FROM product_variants pv
           WHERE pv.product_id = oi.product_id
             AND (pv.colour IS NOT DISTINCT FROM oi.colour)
             AND (
               (pv.size IS NOT DISTINCT FROM oi.size)
               OR (
                 oi.size LIKE '%/%'
                 AND pv.size = split_part(oi.size, '/', 1)
                 AND pv.sleeve = split_part(oi.size, '/', 2)
               )
             )
           ORDER BY CASE WHEN pv.size IS NOT DISTINCT FROM oi.size THEN 0 ELSE 1 END
           LIMIT 1),
          p.supplier_price
        ) AS supplier_price
      ) resolved ON true
      WHERE oi.order_id = ANY(ARRAY[${sql.raw(orderIds.join(","))}])
      GROUP BY oi.order_id
    `);
    for (const row of costRows.rows as CostRow[]) {
      if (row.orderId != null) costByOrderId.set(Number(row.orderId), row);
    }

    const chaseRows = await db.execute(sql`
      SELECT
        o.id AS "orderId",
        COUNT(poi.id)::integer AS "overdueSupplierItemCount",
        COUNT(poi.id) FILTER (WHERE scl.id IS NULL)::integer AS "unchasedSupplierItemCount",
        COUNT(poi.id) FILTER (
          WHERE COALESCE(NULLIF(BTRIM(po.supplier_email), ''), NULLIF(BTRIM(s.email), '')) IS NULL
        )::integer AS "missingSupplierEmailCount",
        MAX(scl.sent_at) AS "supplierChaseSentAt"
      FROM orders o
      JOIN purchase_order_items poi ON poi.order_id = o.id
        OR EXISTS (
          SELECT 1
          FROM order_items linked_oi
          WHERE linked_oi.id = poi.order_item_id
            AND linked_oi.order_id = o.id
        )
      JOIN purchase_orders po ON po.id = poi.po_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN supplier_chase_logs scl
        ON scl.purchase_order_item_id = poi.id
       AND scl.effective_due_date = COALESCE(
         (poi.estimated_due_date AT TIME ZONE 'Europe/London')::date,
         (o.required_date AT TIME ZONE 'Europe/London')::date
       )
      WHERE o.id = ANY(ARRAY[${sql.raw(orderIds.join(","))}])
        AND po.status NOT IN ('draft', 'delivered', 'cancelled')
        AND poi.quantity_delivered < poi.quantity_ordered
        AND COALESCE(
          (poi.estimated_due_date AT TIME ZONE 'Europe/London')::date,
          (o.required_date AT TIME ZONE 'Europe/London')::date
        ) < (NOW() AT TIME ZONE 'Europe/London')::date
      GROUP BY o.id
    `);
    for (const row of chaseRows.rows as SupplierChaseSummary[]) {
      supplierChaseByOrderId.set(Number(row.orderId), {
        ...row,
        orderId: Number(row.orderId),
        overdueSupplierItemCount: Number(row.overdueSupplierItemCount),
        unchasedSupplierItemCount: Number(row.unchasedSupplierItemCount),
        missingSupplierEmailCount: Number(row.missingSupplierEmailCount),
      });
    }
  }
  res.json(orders.map((o) => {
    const revenue = numericToFloat(o.totalAmount);
    const row = costByOrderId.get(o.id);
    // Only compute GP when all non-service items have a supplier price
    const gpMargin = (revenue > 0 && row && row.missingCost === 0)
      ? ((revenue - row.cost) / revenue) * 100
      : null;
    const chase = supplierChaseByOrderId.get(o.id);
    const supplierChaseStatus = !chase
      ? null
      : chase.missingSupplierEmailCount > 0 && chase.unchasedSupplierItemCount > 0
        ? "missing_email"
        : chase.unchasedSupplierItemCount > 0
          ? "needed"
          : chase.supplierChaseSentAt
            ? "sent"
            : null;
    return {
      ...o,
      totalAmount: revenue,
      gpMargin,
      supplierChaseStatus,
      overdueSupplierItemCount: chase?.overdueSupplierItemCount ?? 0,
      supplierChaseSentAt: chase?.supplierChaseSentAt ?? null,
    };
  }));
});

router.get("/orders/weekly-stats", async (req, res): Promise<void> => {
  const rows = await db.execute(sql`
    SELECT
      date_trunc('week', order_date AT TIME ZONE 'UTC')::date AS week_start,
      COUNT(*)::int AS order_count,
      COALESCE(SUM(total_amount), 0)::float AS total_value
    FROM orders
    WHERE order_date >= NOW() - INTERVAL '12 weeks'
      AND status != 'cancelled'
    GROUP BY date_trunc('week', order_date AT TIME ZONE 'UTC')
    ORDER BY week_start ASC
  `);
  res.json(rows.rows);
});

router.get("/dashboard/profit-stats", async (_req, res): Promise<void> => {
  const notCancelled = `o.status NOT IN ('cancelled', 'portal_draft')`;

  // Revenue is pulled from orders alone (to avoid multiplying by item count),
  // cost is aggregated from order_items separately, then the two are joined.
  const weekly = await db.execute(sql`
    SELECT
      rev.week_start,
      rev.order_count,
      rev.revenue,
      COALESCE(cst.cost, 0)::float AS cost
    FROM (
      SELECT
        date_trunc('week', o.order_date AT TIME ZONE 'UTC')::date AS week_start,
        COUNT(o.id)::int AS order_count,
        COALESCE(SUM(o.total_amount), 0)::float AS revenue
      FROM orders o
      WHERE o.order_date >= NOW() - INTERVAL '13 weeks'
        AND o.status NOT IN ('cancelled', 'portal_draft')
      GROUP BY week_start
    ) rev
    LEFT JOIN (
      SELECT
        date_trunc('week', o.order_date AT TIME ZONE 'UTC')::date AS week_start,
        COALESCE(SUM(oi.quantity * COALESCE(pv.supplier_price, p.supplier_price)), 0)::float AS cost
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN product_variants pv
        ON pv.product_id = oi.product_id
        AND (pv.colour IS NOT DISTINCT FROM oi.colour)
        AND (pv.size IS NOT DISTINCT FROM oi.size)
      WHERE o.order_date >= NOW() - INTERVAL '13 weeks'
        AND o.status NOT IN ('cancelled', 'portal_draft')
      GROUP BY week_start
    ) cst ON cst.week_start = rev.week_start
    ORDER BY rev.week_start ASC
  `);

  const monthly = await db.execute(sql`
    SELECT
      rev.month_start,
      rev.order_count,
      rev.revenue,
      COALESCE(cst.cost, 0)::float AS cost
    FROM (
      SELECT
        date_trunc('month', o.order_date AT TIME ZONE 'UTC')::date AS month_start,
        COUNT(o.id)::int AS order_count,
        COALESCE(SUM(o.total_amount), 0)::float AS revenue
      FROM orders o
      WHERE o.order_date >= NOW() - INTERVAL '12 months'
        AND o.status NOT IN ('cancelled', 'portal_draft')
      GROUP BY month_start
    ) rev
    LEFT JOIN (
      SELECT
        date_trunc('month', o.order_date AT TIME ZONE 'UTC')::date AS month_start,
        COALESCE(SUM(oi.quantity * COALESCE(pv.supplier_price, p.supplier_price)), 0)::float AS cost
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN product_variants pv
        ON pv.product_id = oi.product_id
        AND (pv.colour IS NOT DISTINCT FROM oi.colour)
        AND (pv.size IS NOT DISTINCT FROM oi.size)
      WHERE o.order_date >= NOW() - INTERVAL '12 months'
        AND o.status NOT IN ('cancelled', 'portal_draft')
      GROUP BY month_start
    ) cst ON cst.month_start = rev.month_start
    ORDER BY rev.month_start ASC
  `);

  const jobs = await db.execute(sql`
    SELECT
      o.id,
      o.order_number,
      o.customer_name,
      o.order_date,
      o.status,
      COALESCE(o.total_amount, 0)::float AS revenue,
      COALESCE(SUM(oi.quantity * COALESCE(pv.supplier_price, p.supplier_price)), 0)::float AS cost
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN product_variants pv
      ON pv.product_id = oi.product_id
      AND (pv.colour IS NOT DISTINCT FROM oi.colour)
      AND (pv.size IS NOT DISTINCT FROM oi.size)
    WHERE o.status NOT IN ('cancelled', 'portal_draft')
    GROUP BY o.id, o.order_number, o.customer_name, o.order_date, o.status, o.total_amount
    ORDER BY o.order_date DESC
    LIMIT 25
  `);

  const enrich = (r: any) => ({
    ...r,
    gross_profit: (r.revenue ?? 0) - (r.cost ?? 0),
    gp_margin: r.revenue > 0 ? (((r.revenue - r.cost) / r.revenue) * 100) : null,
  });

  res.json({
    weekly: (weekly.rows as any[]).map(enrich),
    monthly: (monthly.rows as any[]).map(enrich),
    jobs: (jobs.rows as any[]).map(enrich),
  });
});

router.post("/orders", async (req, res): Promise<void> => {
  const parsed = CreateOrderBodyFixed.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { items, customerId, notes, orderDate } = parsed.data;

  let customerName: string | null = null;
  let customerAccountAddress: { address: string | null; city: string | null; postcode: string | null } | null = null;
  if (customerId) {
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, customerId));
    customerName = customer?.name ?? null;
    customerAccountAddress = customer
      ? { address: customer.address, city: customer.city, postcode: customer.postcode }
      : null;
  }

  const orderNumber = await generateOrderNumber();
  const [order] = await db
    .insert(ordersTable)
    .values({
      orderNumber,
      customerId: customerId ?? null,
      customerName,
      status: "draft",
      totalAmount: "0",
      notes: notes ?? null,
      orderDate: orderDate ? new Date(orderDate) : new Date(),
    })
    .returning();

  if (items && items.length > 0) {
    const itemValues = items.map((item) => ({
      orderId: order.id,
      productId: item.productId ?? null,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: String(item.unitPrice),
      lineTotal: String(item.quantity * item.unitPrice),
    }));
    await db.insert(orderItemsTable).values(itemValues);
    await recalcOrderTotal(order.id);
  }

  // Auto-set the customer's account address. A delivery address marked
  // is_default may be a different depot, so it must not override the account.
  if (customerId) {
    const defaultAddr = await db.select().from(customerDeliveryAddressesTable)
      .where(eq(customerDeliveryAddressesTable.customerId, customerId))
      .limit(20);
    const normalise = (value: string | null | undefined) =>
      (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    let def = customerAccountAddress?.address
      ? defaultAddr.find(a =>
          normalise(a.line1) === normalise(customerAccountAddress?.address) &&
          normalise(a.city) === normalise(customerAccountAddress?.city) &&
          normalise(a.postcode) === normalise(customerAccountAddress?.postcode)
        ) ?? null
      : null;
    if (!def && customerAccountAddress?.address) {
      const [createdAddress] = await db.insert(customerDeliveryAddressesTable).values({
        customerId,
        label: "Main Address",
        line1: customerAccountAddress.address,
        city: customerAccountAddress.city,
        postcode: customerAccountAddress.postcode,
        isDefault: true,
      }).returning();
      def = createdAddress ?? null;
    }
    def ??= defaultAddr.find(a => a.isDefault) ?? defaultAddr[0] ?? null;
    if (def) {
      await db.update(ordersTable).set({ deliveryAddressId: def.id }).where(eq(ordersTable.id, order.id));
    }
  }

  const [updatedOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, order.id));

  await logOrderAction(order.id, "Order created", getActor(req), `Order ${order.orderNumber} created${customerName ? ` for ${customerName}` : ""}`);

  // Fire workflow automation (non-blocking)
  fireWorkflow("order_created", {
    order_number: order.orderNumber,
    customer_name: customerName ?? "",
  }).catch(() => {});

  res.status(201).json({ ...updatedOrder, totalAmount: numericToFloat(updatedOrder.totalAmount) });
});

// ── Confirm preflight: check for finishes with no processes assigned ─────────
router.get("/orders/:id/confirm-preflight", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid order id" }); return; }

  const rows = await db.execute(sql`
    SELECT DISTINCT cf.id, cf.name
    FROM order_items oi
    JOIN customer_finishes cf ON cf.id = oi.finish_id
    WHERE oi.order_id = ${params.data.id}
      AND NOT EXISTS (
        SELECT 1 FROM customer_finish_processes cfp WHERE cfp.finish_id = cf.id
      )
  `);
  const finishesWithNoProcesses = (rows.rows as Array<{ id: number; name: string }>).map(r => r.name);
  res.json({ ok: finishesWithNoProcesses.length === 0, finishesWithNoProcesses });
});

router.get("/orders/:id", async (req, res): Promise<void> => {
  const params = GetOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.id));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  // Join product_variants to get variant-level supplier price (COALESCE variant → product).
  // Size matching handles two formats:
  //   1. Direct: variant.size = oi.size (most products)
  //   2. Split: order item stores "collar/sleeve" (e.g. "17.0/Short Sleeve") but the variant
  //      has size = "17.0" and sleeve = "Short Sleeve" as separate columns (shirts).
  // Prefer the direct match; fall back to the split match.
  const itemRowsRaw = await db.execute(sql`
    SELECT
      oi.*,
      p.name         AS catalogue_product_name,
      p.sku          AS product_sku,
      p.price_breaks AS price_breaks,
      p.is_service   AS p_is_service,
      COALESCE(pv.supplier_price, p.supplier_price) AS resolved_supplier_price
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN LATERAL (
      SELECT supplier_price
      FROM product_variants
      WHERE product_id = oi.product_id
        AND (colour IS NOT DISTINCT FROM oi.colour)
        AND (
          (size IS NOT DISTINCT FROM oi.size)
          OR (
            oi.size LIKE '%/%'
            AND size = split_part(oi.size, '/', 1)
            AND sleeve = split_part(oi.size, '/', 2)
          )
        )
      ORDER BY CASE WHEN size IS NOT DISTINCT FROM oi.size THEN 0 ELSE 1 END
      LIMIT 1
    ) pv ON true
    WHERE oi.order_id = ${order.id}
  `);
  type RawItemRow = typeof orderItemsTable.$inferSelect & {
    catalogue_product_name: string | null;
    product_sku: string | null;
    resolved_supplier_price: string | null;
    price_breaks: { qty: number; price: number }[] | null;
    p_is_service: boolean | null;
  };
  const itemRows = (itemRowsRaw.rows as RawItemRow[]).map(r => ({
    item: r as typeof orderItemsTable.$inferSelect,
    catalogueProductName: r.catalogue_product_name,
    productSku: r.product_sku,
    supplierPrice: r.resolved_supplier_price,
    priceBreaks: (r.price_breaks as { qty: number; price: number }[] | null) ?? null,
    isService: r.p_is_service ?? false,
  }));

  // Sum total quantity per product across all lines — price break tier is per-product total, not per-size
  const totalQtyByProductId = new Map<number, number>();
  for (const r of itemRows) {
    const pid = (r.item as any).product_id as number | null;
    if (pid != null) {
      totalQtyByProductId.set(pid, (totalQtyByProductId.get(pid) ?? 0) + ((r.item as any).quantity ?? 1));
    }
  }

  // ── PO numbers (+ status) per order item (direct link + consolidated source_order_item_ids) ─
  const orderItemIds = itemRows.map(r => r.item.id);
  const poByItemId = new Map<number, string[]>();
  const poInfoByItemId = new Map<number, Array<{ poNumber: string; status: string; poId: number }>>();
  if (orderItemIds.length > 0) {
    const idsStr = orderItemIds.join(",");
    const poRows = await db.execute(sql`
      SELECT oi_id, po_number, po_status, po_id FROM (
        SELECT poi.order_item_id AS oi_id, po.po_number, po.status AS po_status, po.id AS po_id
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.po_id
        WHERE poi.order_item_id IN (${sql.raw(idsStr)})
          AND poi.process_stock_id IS NULL
          AND po.status != 'cancelled'
        UNION
        SELECT elem::int AS oi_id, po.po_number, po.status AS po_status, po.id AS po_id
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.po_id,
        jsonb_array_elements_text(COALESCE(poi.source_order_item_ids, '[]'::jsonb)) AS elem
        WHERE jsonb_array_length(COALESCE(poi.source_order_item_ids, '[]'::jsonb)) > 0
          AND poi.process_stock_id IS NULL
          AND po.status != 'cancelled'
          AND elem::int IN (${sql.raw(idsStr)})
      ) t
    `);
    for (const row of poRows.rows as Array<{ oi_id: number; po_number: string; po_status: string; po_id: number }>) {
      const id = Number(row.oi_id);
      const existing = poByItemId.get(id) ?? [];
      existing.push(row.po_number);
      poByItemId.set(id, existing);
      const existingInfo = poInfoByItemId.get(id) ?? [];
      existingInfo.push({ poNumber: row.po_number, status: row.po_status, poId: Number(row.po_id) });
      poInfoByItemId.set(id, existingInfo);
    }
  }

  // ── Process stock cost per finish ID ──────────────────────────────────────
  const finishIds = [...new Set(itemRows.map(r => (r.item as any).finish_id as number | null).filter((id): id is number => id != null))];
  const processCostByFinishId = new Map<number, number>();
  if (finishIds.length > 0) {
    const costRows = await db.execute(sql`
      SELECT cfp.finish_id, COALESCE(SUM(ps.unit_cost), 0)::float AS process_cost
      FROM customer_finish_processes cfp
      JOIN customer_processes cp ON cp.id = cfp.process_id
      JOIN process_stock ps ON ps.id = cp.process_stock_id
      WHERE cfp.finish_id IN (${sql.raw(finishIds.join(","))})
      GROUP BY cfp.finish_id
    `);
    for (const row of costRows.rows as Array<{ finish_id: number; process_cost: number }>) {
      processCostByFinishId.set(row.finish_id, row.process_cost);
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  let deliveryAddress: Record<string, unknown> | null = null;
  if (order.deliveryAddressId) {
    const [addr] = await db.select().from(customerDeliveryAddressesTable)
      .where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    deliveryAddress = addr ?? null;
  }

  // Fallback: include customer's main address if no delivery address is linked
  let customerMainAddress: { line1: string; city: string | null; postcode: string | null } | null = null;
  let customerEmail: string | null = null;
  if (order.customerId) {
    const [cust] = await db.select({ address: customersTable.address, city: customersTable.city, postcode: customersTable.postcode, email: customersTable.email })
      .from(customersTable).where(eq(customersTable.id, order.customerId));
    if (!deliveryAddress && cust?.address) {
      customerMainAddress = { line1: cust.address, city: cust.city ?? null, postcode: cust.postcode ?? null };
    }
    // Use customer main email; if missing fall back to portal manager/dept_manager emails
    if (cust?.email) {
      customerEmail = cust.email;
    } else {
      const managerRows = await db.execute(sql`
        SELECT email FROM customer_portal_users
        WHERE customer_id = ${order.customerId}
          AND portal_role IN ('manager', 'dept_manager')
          AND email IS NOT NULL
        ORDER BY portal_role = 'manager' DESC, status = 'active' DESC, id ASC
      `);
      const emails = (managerRows.rows as Array<{ email: string }>).map(r => r.email).filter(Boolean);
      if (emails.length > 0) customerEmail = emails.join(", ");
    }
  }

  // Compute per-address groupings when employees have different delivery addresses
  let addressGroups: Array<{ address: Record<string, unknown>; itemIds: number[] }> = [];
  {
    const itemEmpRows = (await db.execute(sql`
      SELECT oi.id, e.delivery_address_id AS emp_addr_id
      FROM order_items oi
      LEFT JOIN customer_employees e ON e.id = oi.recipient_employee_id
      WHERE oi.order_id = ${order.id}
    `)).rows as Array<{ id: number; emp_addr_id: number | null }>;

    const effectiveAddrMap = new Map<number, number[]>();
    for (const r of itemEmpRows) {
      const effId = r.emp_addr_id ?? order.deliveryAddressId ?? -1;
      if (!effectiveAddrMap.has(effId)) effectiveAddrMap.set(effId, []);
      effectiveAddrMap.get(effId)!.push(r.id);
    }
    if (effectiveAddrMap.size > 1) {
      const addrIds = [...effectiveAddrMap.keys()].filter(id => id > 0);
      if (addrIds.length > 0) {
        const addrs = await db.select().from(customerDeliveryAddressesTable)
          .where(inArray(customerDeliveryAddressesTable.id, addrIds));
        const addrMap = new Map(addrs.map(a => [a.id, a as Record<string, unknown>]));
        for (const [effId, itemIds] of effectiveAddrMap) {
          const addr = addrMap.get(effId);
          if (addr) addressGroups.push({ address: addr, itemIds });
        }
      }
    } else if (effectiveAddrMap.size === 1) {
      // Single effective address — if it's an employee address, override the order-level one
      const [singleEffId] = [...effectiveAddrMap.keys()];
      if (singleEffId > 0 && singleEffId !== (order.deliveryAddressId ?? -1)) {
        const [empAddr] = await db.select().from(customerDeliveryAddressesTable)
          .where(eq(customerDeliveryAddressesTable.id, singleEffId));
        if (empAddr) deliveryAddress = empAddr as Record<string, unknown>;
      }
    }
  }

  res.json({
    ...order,
    totalAmount: numericToFloat(order.totalAmount),
    deliveryAddress,
    customerEmail,
    customerMainAddress,
    addressGroups,
    items: itemRows.map(({ item, catalogueProductName, productSku, supplierPrice, priceBreaks, isService: itemIsService }) => {
      const raw = item as any;
      const qty = raw.quantity ?? 1;
      const finishId: number | null = raw.finish_id ?? null;
      // Cost is always the supplier price (variant level preferred, falls back to product level).
      // price_breaks stores SELL price tiers — never use them as cost.
      const effectiveUnitCost: number | null = supplierPrice != null ? parseFloat(String(supplierPrice)) : null;
      const garmentCost = effectiveUnitCost != null ? effectiveUnitCost * qty : null;
      const processCostPerItem = finishId != null ? (processCostByFinishId.get(finishId) ?? 0) : 0;
      const processCost = processCostPerItem * qty;
      return {
        ...item,
        id: raw.id,
        orderId: raw.order_id,
        productId: raw.product_id,
        productName: catalogueProductName ?? raw.product_name,
        productSku: productSku ?? null,
        finishId: raw.finish_id ?? null,
        finishName: raw.finish_name ?? null,
        colour: raw.colour ?? null,
        size: raw.size ?? null,
        quantity: qty,
        recipientType: raw.recipient_type ?? null,
        recipientName: raw.recipient_name ?? null,
        notes: raw.notes ?? null,
        unitPrice: numericToFloat(raw.unit_price),
        lineTotal: numericToFloat(raw.line_total),
        vatRate: parseFloat(String(raw.vat_rate ?? 0.20)),
        purchaseRequired: raw.purchase_required ?? false,
        purchaseQuantity: raw.purchase_quantity ?? null,
        supplierId: raw.supplier_id ?? null,
        supplierName: raw.supplier_name ?? null,
        isService: itemIsService ?? false,
        garmentCost,
        processCost,
        poNumbers: poByItemId.get(raw.id) ?? [],
        poInfo: poInfoByItemId.get(raw.id) ?? [],
      };
    }),
  });
});

// Local extension: adds 'part_shipped' which the generated schema omits
// (part_shipped is set internally by the dispatch flow but also needs to be
// settable directly when correcting a premature full-dispatch).
const UpdateOrderBodyExtended = UpdateOrderBody.extend({
  status: z.enum(["draft", "confirmed", "shipped", "delivered", "cancelled", "part_shipped"]).optional(),
});

router.patch("/orders/:id", async (req, res): Promise<void> => {
  const params = UpdateOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateOrderBodyExtended.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };

  // Cancellation is the one staff-order mutation that releases Phase 2
  // allocations. Keep the historical authentication behavior for every other
  // PATCH operation unchanged.
  const isCancellationRequest = parsed.data.status === "cancelled";
  if (isCancellationRequest && !(await staffAuthorization(req)).authenticated) {
    res.status(401).json({ error: "Staff authentication required" });
    return;
  }

  if (parsed.data.status === "draft") {
    const componentAllocationHistory = await db.execute(sql`
      SELECT 1
      FROM manufacturing_confirmed_allocations
      WHERE order_id = ${params.data.id}
      LIMIT 1
    `);
    if (componentAllocationHistory.rows.length > 0) {
      res.status(409).json({
        error: "Orders with Phase 2 component allocation history cannot be reverted to draft. Cancel through the authenticated staff order route instead.",
      });
      return;
    }
  }

  if (parsed.data.status === "confirmed") {
    const manualReviewAllocation = await db.execute(sql`
      SELECT 1
      FROM manufacturing_confirmed_allocations
      WHERE order_id = ${params.data.id}
        AND manual_review_required = true
      LIMIT 1
    `);
    if (manualReviewAllocation.rows.length > 0) {
      res.status(409).json({
        error: "This Phase 2 order requires manual review before it can be confirmed. Resolve the component allocation review first.",
      });
      return;
    }
  }

  if (parsed.data.customerId) {
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, parsed.data.customerId));
    if (customer) {
      updateData.customerName = customer.name;
    }
  }

  if (parsed.data.orderDate) {
    updateData.orderDate = new Date(parsed.data.orderDate);
  }
  if (req.body.requiredDate !== undefined) {
    updateData.requiredDate = req.body.requiredDate ? new Date(req.body.requiredDate) : null;
  }
  if (req.body.shippingMethod !== undefined) {
    updateData.shippingMethod = req.body.shippingMethod ?? null;
  }
  if (req.body.carriageAmount !== undefined && req.body.carriageAmount !== null) {
    const v = parseFloat(req.body.carriageAmount);
    if (!isNaN(v) && v >= 0) updateData.carriageAmount = v.toFixed(2);
  }
  if (req.body.deliveryAddressId !== undefined) {
    updateData.deliveryAddressId = req.body.deliveryAddressId ?? null;
  }
  if (req.body.invoiceAddressId !== undefined) {
    updateData.invoiceAddressId = req.body.invoiceAddressId ?? null;
  }

  let order: typeof ordersTable.$inferSelect | undefined;
  if (isCancellationRequest) {
    // Lock order rows before the availability service locks component rows.
    // Payment/allocation flows must use the same order -> component lock order
    // to avoid deadlocks. Status and allocation release commit or roll back
    // together. The pre-update status check makes a repeated cancellation a
    // no-op for allocations, while a later status reversal never recreates them.
    order = await db.transaction(async (tx) => {
      const lockedRows = await tx.execute(sql`
        SELECT status
        FROM orders
        WHERE id = ${params.data.id}
        FOR UPDATE
      `);
      const lockedOrder = lockedRows.rows[0] as { status: string } | undefined;
      if (!lockedOrder) return undefined;

      const [updatedOrder] = await tx
        .update(ordersTable)
        .set(updateData)
        .where(eq(ordersTable.id, params.data.id))
        .returning();
      if (lockedOrder.status !== "cancelled") {
        // Lock only components with live Phase 2 allocations, in ascending
        // component-id order, before changing allocation status.
        await tx.execute(sql`
          SELECT c.id
          FROM manufacturing_components c
          JOIN manufacturing_confirmed_allocations a ON a.component_id = c.id
          WHERE a.order_id = ${params.data.id}
            AND a.status = 'CONFIRMED'
          ORDER BY c.id
          FOR UPDATE OF c
        `);
        await componentAvailability.releaseOrderAllocations(tx, params.data.id);
      }
      return updatedOrder;
    });
  } else {
    [order] = await db
      .update(ordersTable)
      .set(updateData)
      .where(eq(ordersTable.id, params.data.id))
      .returning();
  }
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  // ── Re-generate Stripe payment link when carriage changes ─────────────────
  // The link amount is (totalAmount + carriageAmount) × 1.2, so it goes stale
  // whenever shipping is added/changed after the link was first created.
  if (!isCancellationRequest && req.body.carriageAmount !== undefined && order.stripePaymentLinkId) {
    const business = await requireConfiguredBusinessIdentity();
    try {
      const stripe = await getUncachableStripeClient();
      await stripe.paymentLinks.update(order.stripePaymentLinkId, { active: false });
      const tAmt = parseFloat(String(order.totalAmount ?? 0));
      const cAmt = parseFloat(String(order.carriageAmount ?? 0));
      const newPrice = await stripe.prices.create({
        unit_amount: Math.round((tAmt + cAmt) * 100 * 1.2),
        currency: "gbp",
        product_data: { name: `Order ${order.orderNumber} — ${business.name}` },
      });
      const newLink = await stripe.paymentLinks.create({
        line_items: [{ price: newPrice.id, quantity: 1 }],
        metadata: { order_id: String(order.id), order_number: order.orderNumber },
        after_completion: {
          type: "hosted_confirmation",
          hosted_confirmation: { custom_message: `Payment received for order ${order.orderNumber}. Thank you — ${business.name}` },
        },
      });
      await db.update(ordersTable)
        .set({ stripePaymentLinkUrl: newLink.url, stripePaymentLinkId: newLink.id })
        .where(eq(ordersTable.id, order.id));
    } catch {
      // Non-fatal — Stripe may not be configured; carry on
    }
  }

  // ── Stock allocation on confirmation ──────────────────────────────────────
  if (parsed.data.status === "confirmed") {
    // Block confirmation if any finish on this order has no processes assigned
    const emptyFinishRows = await db.execute(sql`
      SELECT DISTINCT cf.name
      FROM order_items oi
      JOIN customer_finishes cf ON cf.id = oi.finish_id
      WHERE oi.order_id = ${params.data.id}
        AND NOT EXISTS (
          SELECT 1 FROM customer_finish_processes cfp WHERE cfp.finish_id = cf.id
        )
    `);
    const emptyFinishNames = (emptyFinishRows.rows as Array<{ name: string }>).map(r => r.name);
    if (emptyFinishNames.length > 0) {
      res.status(400).json({
        error: `Cannot confirm: the following finish${emptyFinishNames.length > 1 ? 'es have' : ' has'} no processes assigned — ${emptyFinishNames.join(", ")}. Go to the customer's Finishes tab and add processes before confirming.`,
      });
      return;
    }

    const phase2AllocationRows = await db.execute(sql`
      SELECT DISTINCT order_item_id
      FROM manufacturing_confirmed_allocations
      WHERE order_id = ${params.data.id}
    `);
    const phase2ManagedItemIds = new Set(
      (phase2AllocationRows.rows as Array<{ order_item_id: number }>).map(row => Number(row.order_item_id)),
    );
    const allOrderItems = await db
      .select({
        id: orderItemsTable.id,
        productId: orderItemsTable.productId,
        productName: orderItemsTable.productName,
        colour: orderItemsTable.colour,
        size: orderItemsTable.size,
        quantity: orderItemsTable.quantity,
        unitPrice: orderItemsTable.unitPrice,
        lineTotal: orderItemsTable.lineTotal,
        recipientName: orderItemsTable.recipientName,
        finishId: orderItemsTable.finishId,
      })
      .from(orderItemsTable)
      .where(eq(orderItemsTable.orderId, params.data.id));
    // Phase 2 allocations (including RELEASED rows after cancellation) are the
    // authoritative stock handling for these lines. Keep them out of every
    // legacy stock, shortfall, purchasing, and worksheet calculation; other
    // legacy lines in the same order continue through the existing path.
    const items = allOrderItems.filter(item => !phase2ManagedItemIds.has(item.id));

    const productIds = [...new Set(items.map(i => i.productId).filter(Boolean))] as number[];

    let allocatedLines = 0;
    let purchaseLines = 0;
    let serviceItemCount = 0;
    const allocatedItemIds: number[] = [];
    const shortfallDetails: Array<{
      id: number; productName: string; colour: string | null; size: string | null;
      purchaseQuantity: number; supplierId: number | null; supplierName: string | null; supplierEmail: string | null;
    }> = [];

    // Items with no product link have no stock to allocate — they go straight to production
    const noProductItemIds: number[] = [];
    for (const item of items) {
      if (!item.productId) {
        allocatedItemIds.push(item.id);
        noProductItemIds.push(item.id);
      }
    }
    if (noProductItemIds.length > 0) {
      await db.update(orderItemsTable)
        .set({ purchaseRequired: false, purchaseQuantity: null, stockStatus: "allocated", stockAllocatedAt: new Date() })
        .where(inArray(orderItemsTable.id, noProductItemIds));
    }

    if (productIds.length > 0) {
      // Fetch supplier info keyed by product id
      const productInfoRows = await db
        .select({
          id: productsTable.id,
          supplierId: productsTable.supplierId,
          supplierName: suppliersTable.name,
          supplierEmail: suppliersTable.email,
          isService: productsTable.isService,
        })
        .from(productsTable)
        .leftJoin(suppliersTable, eq(productsTable.supplierId, suppliersTable.id))
        .where(inArray(productsTable.id, productIds));
      const supplierMap = new Map(productInfoRows.map(p => [p.id, p]));

      // Fetch variant-level stock for all relevant products.
      // For plain products (no variants), fall back to product.stock_quantity.
      // Order items store size as either a plain value ("17.0") or, for split products
      // like shirts, a combined "size/sleeve" string ("17.0/Short Sleeve") — while the
      // variant keeps size and sleeve in separate columns. Build the lookup key using the
      // same combined format so both shapes match correctly (instead of only ever matching
      // plain-size products and silently treating split products as having zero stock).
      const variantStockRows = await db.execute(sql`
        SELECT pv.id, pv.product_id, pv.colour, pv.size, pv.sleeve, pv.stock_quantity
        FROM product_variants pv
        WHERE pv.product_id IN (${sql.join(productIds.map(id => sql`${id}`), sql`, `)})
      `);

      // Fetch variant-level supplier overrides so colour-specific suppliers are respected
      const variantSupplierAlias = alias(suppliersTable, "vs");
      const variantSupplierRows = await db
        .select({
          variantId: productVariantsTable.id,
          productId: productVariantsTable.productId,
          colour: productVariantsTable.colour,
          size: productVariantsTable.size,
          sleeve: productVariantsTable.sleeve,
          supplierId: productVariantsTable.primarySupplierId,
          supplierName: variantSupplierAlias.name,
          supplierEmail: variantSupplierAlias.email,
        })
        .from(productVariantsTable)
        .innerJoin(variantSupplierAlias, eq(productVariantsTable.primarySupplierId, variantSupplierAlias.id))
        .where(inArray(productVariantsTable.productId, productIds));
      // Key: "productId|colour|size" — colour/size normalised to lower-case for matching.
      // Size uses the combined "size/sleeve" form so split products key the same way order
      // items store them.
      const variantSupplierMap = new Map(
        variantSupplierRows.map(r => [
          r.variantId,
          { supplierId: r.supplierId!, supplierName: r.supplierName, supplierEmail: r.supplierEmail },
        ])
      );
      // Some products don't split stock/supplier by size at all — they have a single
      // variant per colour with size/sleeve left blank (e.g. "Charcoal" covering all sizes).
      // Order items for those products still record a real size ("Large", "Medium", ...),
      // so the exact-key lookup above never matches and the variant supplier was silently
      // ignored in favour of the product-level default. Add a colour-only fallback keyed off
      // those blank-size variants (only when the colour has no other size-specific variant
      // rows, so this stays unambiguous) for the size-specific lookup to fall back to.
      const variantSupplierColourMap = new Map(
        variantSupplierRows
          .filter(r => !r.size && !r.sleeve)
          .map(r => [
            r.variantId,
            { supplierId: r.supplierId!, supplierName: r.supplierName, supplierEmail: r.supplierEmail },
          ])
      );
      const plainStockRows = await db.execute(sql`
        SELECT p.id AS product_id, NULL::text AS colour, NULL::text AS size, p.stock_quantity
        FROM products p
        WHERE p.id IN (${sql.join(productIds.map(id => sql`${id}`), sql`, `)})
          AND NOT EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id)
      `);

      // Build mutable stock pool keyed by "productId|colour|size" (combined size/sleeve form).
      // Also track the raw pv.size/pv.sleeve pieces per key so the later persistence step
      // can write back to the correct variant columns instead of re-splitting the combined key.
      const remainingStock = new Map<number, number>();
      const touchedVariantIds = new Set<number>();
      const remainingPlainStock = new Map<number, number>();
      const variantRows = variantStockRows.rows as Array<{ id: number; product_id: number; colour: string | null; size: string | null; sleeve: string | null; stock_quantity: number | null }>;
      for (const r of variantRows) {
        remainingStock.set(Number(r.id), Number(r.stock_quantity) || 0);
      }
      for (const r of plainStockRows.rows as Array<{ product_id: number; colour: string | null; size: string | null; stock_quantity: number | null }>) {
        remainingPlainStock.set(r.product_id, Number(r.stock_quantity) || 0);
      }

      for (const item of items) {
        if (!item.productId) continue;
        const sup = supplierMap.get(item.productId);

        // Service products need no purchasing — treat as fully allocated
        if (sup?.isService) {
          allocatedLines++;
          serviceItemCount++;
          allocatedItemIds.push(item.id);
          await db.update(orderItemsTable)
            .set({ purchaseRequired: false, purchaseQuantity: null, stockStatus: "allocated", stockAllocatedAt: new Date() })
            .where(eq(orderItemsTable.id, item.id));
          continue;
        }

        // Resolve one concrete variant row. Duplicate identities are unsafe: do not
        // choose arbitrarily or deduct every matching row.
        const direct = variantRows.filter(r => r.product_id === item.productId &&
          (r.colour ?? null) === (item.colour ?? null) &&
          (r.size ?? null) === (item.size ?? null));
        const split = item.size?.includes("/")
          ? variantRows.filter(r => r.product_id === item.productId &&
              (r.colour ?? null) === (item.colour ?? null) &&
              r.size === item.size!.split("/")[0] && r.sleeve === item.size!.split("/")[1])
          : [];
        const blank = variantRows.filter(r => r.product_id === item.productId &&
          (r.colour ?? null) === (item.colour ?? null) && r.size == null && r.sleeve == null);
        const matches = direct.length > 0 ? direct : split.length > 0 ? split : blank;
        if (matches.length > 1) {
          res.status(400).json({
            error: `Cannot confirm order: item "${item.productName}" matches duplicate product variants (${matches.map(v => v.id).join(", ")}). Resolve the duplicate variant identity before confirming.`,
          });
          return;
        }
        const variant = matches[0];
        const available = variant ? (remainingStock.get(Number(variant.id)) ?? 0)
          : (remainingPlainStock.get(item.productId) ?? 0);

        const qty = item.quantity ?? 0;
        const allocatedQty = Math.min(available, qty);
        const shortfall = qty - allocatedQty;

        if (variant) {
          remainingStock.set(Number(variant.id), available - allocatedQty);
          if (allocatedQty > 0) touchedVariantIds.add(Number(variant.id));
        }
        else remainingPlainStock.set(item.productId, available - allocatedQty);

        // Prefer colour+size-specific variant supplier; fall back to a colour-only variant
        // supplier (products with a single blank-size variant per colour), then finally to
        // the product-level supplier.
        const varSup = variant
          ? (variantSupplierMap.get(Number(variant.id)) ?? variantSupplierColourMap.get(Number(variant.id)))
          : undefined;
        const resolvedSupplierId = varSup?.supplierId ?? sup?.supplierId ?? null;
        const resolvedSupplierName = varSup?.supplierName ?? sup?.supplierName ?? null;
        const resolvedSupplierEmail = varSup?.supplierEmail ?? sup?.supplierEmail ?? null;

        // Items with shortfall=0 and no finish go straight to the picking list.
        // Items with a finish still go through the worksheet → in_production → complete
        // production flow, so leave their stockStatus null for the worksheet to manage.
        const itemStockStatus = shortfall > 0 ? null : (!item.finishId ? "allocated" : null);
        await db.update(orderItemsTable).set({
          purchaseRequired: shortfall > 0,
          purchaseQuantity: shortfall > 0 ? shortfall : null,
          supplierId: shortfall > 0 ? resolvedSupplierId : null,
          supplierName: shortfall > 0 ? resolvedSupplierName : null,
          ...(itemStockStatus ? { stockStatus: itemStockStatus, stockAllocatedAt: new Date() } : {}),
        }).where(eq(orderItemsTable.id, item.id));

        if (shortfall > 0) {
          purchaseLines++;
          shortfallDetails.push({
            id: item.id, productName: item.productName, colour: item.colour ?? null,
            size: item.size ?? null, purchaseQuantity: shortfall,
            supplierId: resolvedSupplierId, supplierName: resolvedSupplierName, supplierEmail: resolvedSupplierEmail,
          });
        } else {
          allocatedLines++;
          allocatedItemIds.push(item.id);
        }
      }

      // Persist deductions: update variant stock (+ rollup) or plain product stock.
      // Use the tracked raw size/sleeve pieces (not a re-split of the combined key) so
      // split-format products (e.g. shirts) write back to the correct variant row.
      for (const [variantId, remaining] of remainingStock.entries()) {
        if (!touchedVariantIds.has(variantId)) continue;
        const variant = variantRows.find(r => Number(r.id) === variantId);
        if (variant) {
          // Variant row — update directly then roll up to product
          await db.execute(sql`
            UPDATE product_variants
            SET stock_quantity = ${remaining}
            WHERE id = ${variantId}
          `);
          await db.execute(sql`
            UPDATE products
            SET stock_quantity = (
              SELECT COALESCE(SUM(stock_quantity), 0)
              FROM product_variants WHERE product_id = ${variant.product_id}
            )
            WHERE id = ${variant.product_id}
          `);
        }
      }
      for (const [productId, remaining] of remainingPlainStock.entries()) {
        await db.execute(sql`UPDATE products SET stock_quantity = ${remaining} WHERE id = ${productId}`);
      }
    }

    // ── Process stock shortfall calculation ───────────────────────────────────
    // For each order item that has a finish, walk: finish → processes → processStockId
    // and check whether enough consumable stock (e.g. DTF sheets) is available.
    const processShortfallMap = new Map<number, {
      processStockId: number; name: string; sku: string | null;
      shortfall: number; supplierId: number | null; supplierName: string | null;
      supplierEmail: string | null; orderItemIds: number[];
    }>();

    const finishIds = [...new Set(items.map(i => i.finishId).filter(Boolean))] as number[];
    if (finishIds.length > 0) {
      const finishProcessLinks = await db
        .select({ finishId: customerFinishProcessesTable.finishId, processId: customerFinishProcessesTable.processId })
        .from(customerFinishProcessesTable)
        .where(inArray(customerFinishProcessesTable.finishId, finishIds));

      const processIds = [...new Set(finishProcessLinks.map(fp => fp.processId))];
      if (processIds.length > 0) {
        const processes = await db
          .select({ id: customerProcessesTable.id, processStockId: customerProcessesTable.processStockId })
          .from(customerProcessesTable)
          .where(inArray(customerProcessesTable.id, processIds));

        const psIds = [...new Set(processes.map(p => p.processStockId).filter(Boolean))] as number[];
        if (psIds.length > 0) {
          const psRows = await db
            .select({
              id: processStockTable.id, name: processStockTable.name, sku: processStockTable.sku,
              stockQuantity: processStockTable.stockQuantity,
              supplierId: processStockTable.supplierId, supplierName: suppliersTable.name,
              supplierEmail: suppliersTable.email,
            })
            .from(processStockTable)
            .leftJoin(suppliersTable, eq(processStockTable.supplierId, suppliersTable.id))
            .where(inArray(processStockTable.id, psIds));

          const psMap = new Map(psRows.map(ps => [ps.id, ps]));
          const remainingPs = new Map(psRows.map(ps => [ps.id, ps.stockQuantity ?? 0]));
          const processToPs = new Map(processes.filter(p => p.processStockId).map(p => [p.id, p.processStockId!]));
          const finishToProcesses = new Map<number, number[]>();
          for (const fp of finishProcessLinks) {
            if (!finishToProcesses.has(fp.finishId)) finishToProcesses.set(fp.finishId, []);
            finishToProcesses.get(fp.finishId)!.push(fp.processId);
          }

          for (const item of items) {
            if (!item.finishId) continue;
            const qty = item.quantity ?? 0;
            for (const pid of (finishToProcesses.get(item.finishId) ?? [])) {
              const psId = processToPs.get(pid);
              if (!psId) continue;
              const available = remainingPs.get(psId) ?? 0;
              const used = Math.min(available, qty);
              const shortfall = qty - used;
              remainingPs.set(psId, available - used);
              if (shortfall > 0) {
                const existing = processShortfallMap.get(psId);
                const ps = psMap.get(psId);
                processShortfallMap.set(psId, {
                  processStockId: psId,
                  name: ps?.name ?? "Unknown",
                  sku: ps?.sku ?? null,
                  shortfall: (existing?.shortfall ?? 0) + shortfall,
                  supplierId: ps?.supplierId ?? null,
                  supplierName: ps?.supplierName ?? null,
                  supplierEmail: (ps as any)?.supplierEmail ?? null,
                  orderItemIds: [...(existing?.orderItemIds ?? []), item.id],
                });
              }
            }
          }

          // Deduct used process stock
          for (const [psId, remaining] of remainingPs.entries()) {
            const original = psMap.get(psId);
            if (!original) continue;
            if ((original.stockQuantity ?? 0) - remaining > 0) {
              await db.update(processStockTable).set({ stockQuantity: remaining }).where(eq(processStockTable.id, psId));
            }
          }
        }
      }
    }

    // ── Auto-create draft process stock POs (e.g. DTF prints to Raptor) ───────
    // Group shortfall entries by supplier and keep one process-only draft PO per
    // supplier, with one PO line per (process_stock × order_item) combination.
    // Garment lines are never added to these POs.
    const autoCreatedProcessStockPos: string[] = [];
    if (processShortfallMap.size > 0) {
      // Group by supplier
      const psPoMap = new Map<string, {
        supplierId: number | null; supplierName: string; supplierEmail: string | null;
        entries: Array<{ processStockId: number; name: string; sku: string | null; shortfall: number; orderItemIds: number[] }>;
      }>();
      for (const entry of processShortfallMap.values()) {
        const key = String(entry.supplierId ?? "unknown");
        if (!psPoMap.has(key)) {
          psPoMap.set(key, { supplierId: entry.supplierId, supplierName: entry.supplierName ?? "Unknown Supplier", supplierEmail: entry.supplierEmail, entries: [] });
        }
        psPoMap.get(key)!.entries.push(entry);
      }

      for (const group of psPoMap.values()) {
        // Reuse an existing process-only draft for this supplier. The NOT EXISTS
        // guard is the hard boundary that prevents garment and process lines from
        // ever sharing a PO.
        const existing = await db.execute(sql`
          SELECT po.id, po.po_number, po.attachments
          FROM purchase_orders po
          WHERE po.supplier_id ${group.supplierId != null ? sql`= ${group.supplierId}` : sql`IS NULL`}
            AND po.status = 'draft'
            AND EXISTS (
              SELECT 1 FROM purchase_order_items poi
              WHERE poi.po_id = po.id AND poi.process_stock_id IS NOT NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM purchase_order_items poi
              WHERE poi.po_id = po.id AND poi.process_stock_id IS NULL
            )
          ORDER BY po.created_at, po.id
          LIMIT 1
        `);
        let psPo: { id: number; poNumber: string; attachments: unknown };
        if ((existing.rows as any[]).length > 0) {
          const row = (existing.rows as any[])[0];
          psPo = { id: Number(row.id), poNumber: String(row.po_number), attachments: row.attachments };
        } else {
          const now = new Date();
          const poNumber = `PO-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${Math.floor(Math.random() * 9000) + 1000}`;
          const [created] = await db.insert(purchaseOrdersTable).values({
            poNumber,
            supplierId: group.supplierId,
            supplierName: group.supplierName,
            supplierEmail: group.supplierEmail ?? null,
            status: "draft",
            notes: `Auto-created process-material draft; first order ${order.orderNumber}`,
          }).returning();
          psPo = { id: created.id, poNumber: created.poNumber, attachments: created.attachments };
        }

        const existingLines = await db.execute(sql`
          SELECT process_stock_id, order_item_id
          FROM purchase_order_items
          WHERE po_id = ${psPo.id}
            AND process_stock_id IS NOT NULL
            AND order_item_id IS NOT NULL
        `);
        const existingLineKeys = new Set(
          (existingLines.rows as any[]).map(row => `${row.process_stock_id}:${row.order_item_id}`),
        );

        // One PO line per order_item × process_stock combination
        for (const entry of group.entries) {
          for (const orderItemId of entry.orderItemIds) {
            const lineKey = `${entry.processStockId}:${orderItemId}`;
            if (existingLineKeys.has(lineKey)) continue;
            const orderItem = items.find(i => i.id === orderItemId);
            await db.insert(purchaseOrderItemsTable).values({
              poId: psPo.id,
              processStockId: entry.processStockId,
              orderItemId,
              orderId: params.data.id,
              orderNumber: order.orderNumber,
              productName: entry.name,
              supplierCode: entry.sku ?? null,
              quantityOrdered: orderItem?.quantity ?? 1,
              quantityDelivered: 0,
              sourceOrderItemIds: [orderItemId],
            });
            existingLineKeys.add(lineKey);
          }
        }

        // Attach print files from process_stock records
        const psIds2 = group.entries.map(e => e.processStockId);
        const psFileRows = await db.execute(sql`
          SELECT id, name, file_url FROM process_stock
          WHERE id = ANY(ARRAY[${sql.raw(psIds2.join(","))}]::integer[])
            AND file_url IS NOT NULL
        `);
        const attachments = (psFileRows.rows as any[])
          .filter(r => r.file_url)
          .map(r => ({ name: `${r.name} - Print File`, objectPath: r.file_url as string }));
        if (attachments.length > 0) {
          const currentAttachments = Array.isArray(psPo.attachments) ? psPo.attachments as Array<{ name: string; objectPath: string }> : [];
          const mergedAttachments = [...currentAttachments];
          for (const attachment of attachments) {
            if (!mergedAttachments.some(existingAttachment => existingAttachment.objectPath === attachment.objectPath)) {
              mergedAttachments.push(attachment);
            }
          }
          await db.update(purchaseOrdersTable).set({ attachments: mergedAttachments }).where(eq(purchaseOrdersTable.id, psPo.id));
        }

        autoCreatedProcessStockPos.push(psPo.poNumber);
      }
    }
    // ──────────────────────────────────────────────────────────────────────────

    // Group process shortfalls by supplier
    const psGroupMap = new Map<string, { supplierName: string; supplierId: number | null; items: Array<{ name: string; sku: string | null; shortfall: number }> }>();
    for (const s of processShortfallMap.values()) {
      const key = s.supplierName ?? "Unknown Supplier";
      if (!psGroupMap.has(key)) psGroupMap.set(key, { supplierName: key, supplierId: s.supplierId, items: [] });
      psGroupMap.get(key)!.items.push({ name: s.name, sku: s.sku, shortfall: s.shortfall });
    }
    const processShortfallGroups = [...psGroupMap.values()];
    // ─────────────────────────────────────────────────────────────────────────

    // Build shortfall groups for the Purchasing queue. PO selection happens
    // there, where current draft eligibility is known; confirmation must not
    // expose historical or completed POs.
    const groupMap = new Map<string, typeof shortfallDetails[0] & { itemIds: number[]; items: typeof shortfallDetails }>();
    for (const s of shortfallDetails) {
      const key = s.supplierName ?? "Unknown Supplier";
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          ...s,
          supplierName: key, // use the resolved key so supplierName is never null
          itemIds: [], items: [],
        });
      }
      const g = groupMap.get(key)!;
      g.itemIds.push(s.id);
      g.items.push(s);
    }
    const shortfallGroups = [...groupMap.values()];

    // ── Auto-create production worksheet ──────────────────────────────────────
    // If there are items ready for production (no purchase required), auto-create
    // a worksheet so the order flows into production automatically on confirmation.
    if (allocatedItemIds.length > 0) {
      const existingWs = await db
        .select({ id: worksheetsTable.id })
        .from(worksheetsTable)
        .where(eq(worksheetsTable.orderId, params.data.id))
        .limit(1);

      if (existingWs.length === 0) {
        // Generate next worksheet number
        const wsRows = await db.execute(sql`
          SELECT worksheet_number FROM worksheets
          WHERE worksheet_number ~ '^F[0-9]+$'
          ORDER BY LENGTH(worksheet_number) DESC, worksheet_number DESC
          LIMIT 1
        `);
        const lastWsNum = (wsRows.rows[0] as any)?.worksheet_number as string | undefined;
        const worksheetNumber = `F${(lastWsNum ? parseInt(lastWsNum.slice(1), 10) : 99) + 1}`;

        const [ws] = await db
          .insert(worksheetsTable)
          .values({
            worksheetNumber,
            status: "wip",
            orderId: params.data.id,
            orderNumber: order.orderNumber,
            customerId: order.customerId ?? null,
            customerName: order.customerName ?? null,
          })
          .returning();

        const wsOrderItemsRaw = await db
          .select()
          .from(orderItemsTable)
          .where(inArray(orderItemsTable.id, allocatedItemIds));

        // Exclude service items — they don't go through production
        const serviceProductIdSet = new Set<number>();
        const linkedProductIds = wsOrderItemsRaw.map(i => i.productId).filter((id): id is number => id != null);
        if (linkedProductIds.length > 0) {
          const serviceRows = await db
            .select({ id: productsTable.id })
            .from(productsTable)
            .where(and(eq(productsTable.isService, true), inArray(productsTable.id, linkedProductIds)));
          serviceRows.forEach(r => serviceProductIdSet.add(r.id));
        }
        const wsOrderItems = wsOrderItemsRaw.filter(oi => !oi.productId || !serviceProductIdSet.has(oi.productId));

        // Nothing left to produce — remove the worksheet and skip
        if (wsOrderItems.length === 0) {
          await db.delete(worksheetsTable).where(eq(worksheetsTable.id, ws.id));
        } else await Promise.all(
          wsOrderItems.map(async (oi) => {
            let processesSnapshot: string | null = null;
            if (oi.finishId && order.customerId) {
              const finishProcessLinks = await db
                .select()
                .from(customerFinishProcessesTable)
                .where(eq(customerFinishProcessesTable.finishId, oi.finishId));
              const processIds = finishProcessLinks.map((fp) => fp.processId);
              if (processIds.length > 0) {
                const processes = await db
                  .select()
                  .from(customerProcessesTable)
                  .where(inArray(customerProcessesTable.id, processIds));
                processesSnapshot = JSON.stringify(
                  processes.map((p) => ({ id: p.id, name: p.name, type: p.type, placement: p.placement, price: p.price ? parseFloat(p.price as any) : null, notes: p.notes }))
                );
              }
            }
            return db.insert(worksheetItemsTable).values({
              worksheetId: ws.id,
              orderItemId: oi.id,
              productName: oi.productName,
              colour: oi.colour ?? null,
              size: oi.size ?? null,
              quantity: oi.quantity ?? 1,
              recipientType: oi.recipientType ?? "stock",
              recipientName: oi.recipientName ?? null,
              finishId: oi.finishId ?? null,
              finishName: oi.finishName ?? null,
              processesSnapshot,
            });
          })
        );
      }
    }
    // ──────────────────────────────────────────────────────────────────────────

    // ── Service-only order: skip purchasing & production, go straight to dispatch
    // If every item with a product link is a service product (no purchasing, no
    // worksheet), leave the order at 'confirmed' — service items are always
    // "ready" (see dispatch.ts readiness logic), so it will immediately appear
    // in the Dispatch queue where a delivery note can be produced before the
    // order is marked shipped. (Previously this auto-promoted straight to
    // 'shipped', which skipped the dispatch screen and its delivery note.)
    const linkedItemCount = items.filter(i => i.productId != null).length;
    if (linkedItemCount > 0 && serviceItemCount === linkedItemCount && purchaseLines === 0) {
      await logOrderAction(params.data.id, "Ready for dispatch", getActor(req),
        "All items are service products — skipped purchasing and production, sent straight to dispatch");
    }
    // ──────────────────────────────────────────────────────────────────────────

    const unlinkedItems = items.filter(i => !i.productId).length;

    // ── Stripe: charge most recently added saved card on confirmation ──────────
    let stripeCharge: { success: boolean; paymentIntentId?: string; cardLast4?: string; error?: string } | null = null;
    const orderTotal = parseFloat(String(order.totalAmount ?? 0));
    if (order.customerId && orderTotal > 0) {
      try {
        const business = await requireConfiguredBusinessIdentity();
        const [customerRow] = await db
          .select({ stripeCustomerId: customersTable.stripeCustomerId })
          .from(customersTable)
          .where(eq(customersTable.id, order.customerId));

        if (customerRow?.stripeCustomerId) {
          const stripe = await getUncachableStripeClient();
          // Stripe returns payment methods newest-first — take the first one
          const pms = await stripe.paymentMethods.list({
            customer: customerRow.stripeCustomerId,
            type: "card",
            limit: 1,
          });
          const pm = pms.data[0];
          if (pm) {
            const amountPence = Math.round(orderTotal * 100);
            const intent = await stripe.paymentIntents.create({
              amount: amountPence,
              currency: "gbp",
              customer: customerRow.stripeCustomerId,
              payment_method: pm.id,
              confirm: true,
              off_session: true,
              description: `Order ${order.orderNumber} — ${business.name}`,
            });
            stripeCharge = {
              success: true,
              paymentIntentId: intent.id,
              cardLast4: pm.card?.last4,
            };
            await logOrderAction(order.id, "Payment taken", getActor(req),
              `Charged £${orderTotal.toFixed(2)} to card ending ${pm.card?.last4} (${intent.id})`);
          }
        }
      } catch (err: any) {
        stripeCharge = { success: false, error: err.message };
        await logOrderAction(order.id, "Payment failed", getActor(req),
          `Stripe charge failed: ${err.message}`);
      }
    }
    // ──────────────────────────────────────────────────────────────────────────

    await logOrderAction(order.id, "Order confirmed", getActor(req),
      `Allocated ${allocatedLines} line(s); ${purchaseLines} line(s) raised to PO; ${unlinkedItems} unlinked line(s)`);
    await sendOrderConfirmationContentAlert(order.id, getActor(req)).catch((err) => {
      console.error(`[confirmationContentAlert] Order ${order.id}:`, err);
    });

    res.json({
      ...order, totalAmount: numericToFloat(order.totalAmount),
      allocation: { allocated: allocatedLines, purchaseRequired: purchaseLines },
      shortfallGroups,
      processShortfallGroups,
      autoCreatedProcessStockPos,
      unlinkedItems,
      emailConfigured: isEmailConfigured,
      stripeCharge,
    });
    return;
  }
  // ── Purchase-flag cleanup when reverting to draft ─────────────────────────
  // If the order is being set back to draft (from confirmed or any active state),
  // clear purchase_required/purchase_quantity on all items and restore any stock
  // that was deducted during the prior confirmation.
  if (parsed.data.status === "draft") {
    const itemRows = await db.execute(sql`
      SELECT id, product_id, quantity, purchase_required, purchase_quantity
      FROM order_items WHERE order_id = ${params.data.id} AND product_id IS NOT NULL
    `);
    const items = itemRows.rows as Array<{
      id: number; product_id: number; quantity: number;
      purchase_required: boolean | null; purchase_quantity: number | null;
    }>;

    // Restore stock that was deducted during confirmation
    const stockRestore = new Map<number, number>();
    for (const item of items) {
      const qty = Number(item.quantity ?? 0);
      const purchaseQty = Number(item.purchase_quantity ?? 0);
      // Stock decremented = quantity - purchase_quantity (items fulfilled from stock)
      const allocated = item.purchase_required ? qty - purchaseQty : qty;
      if (allocated > 0) {
        stockRestore.set(item.product_id, (stockRestore.get(item.product_id) ?? 0) + allocated);
      }
    }
    for (const [productId, restoreQty] of stockRestore.entries()) {
      await db.execute(sql`
        UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) + ${restoreQty}
        WHERE id = ${productId}
      `);
    }

    // Clear all purchase and stock-allocation flags
    await db.execute(sql`
      UPDATE order_items
      SET purchase_required = false, purchase_quantity = NULL,
          supplier_id = NULL, supplier_name = NULL,
          stock_status = NULL, stock_allocated_at = NULL
      WHERE order_id = ${params.data.id}
    `);

    // Also delete any pre_wip worksheets that were auto-created on confirmation
    await db.execute(sql`
      DELETE FROM worksheet_items
      WHERE worksheet_id IN (
        SELECT id FROM worksheets WHERE order_id = ${params.data.id} AND status = 'pre_wip'
      )
    `);
    await db.execute(sql`
      DELETE FROM worksheets WHERE order_id = ${params.data.id} AND status = 'pre_wip'
    `);
  }

  // ── Worksheet cleanup on cancellation / archiving ─────────────────────────
  if (parsed.data.status === "cancelled" || parsed.data.status === "archived") {
    const linkedWorksheets = await db
      .select({ id: worksheetsTable.id, status: worksheetsTable.status })
      .from(worksheetsTable)
      .where(eq(worksheetsTable.orderId, order.id));

    const wsToDelete = linkedWorksheets
      .filter(ws => ws.status !== "complete")
      .map(ws => ws.id);

    if (wsToDelete.length > 0) {
      await db.delete(worksheetsTable).where(inArray(worksheetsTable.id, wsToDelete));
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  res.json({ ...order, totalAmount: numericToFloat(order.totalAmount) });
});

// ── Update order attachments ───────────────────────────────────────────────
router.patch("/orders/:id/attachments", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = z.object({
    attachments: z.array(z.object({ name: z.string(), objectPath: z.string() })),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [order] = await db
    .update(ordersTable)
    .set({ attachments: parsed.data.attachments, updatedAt: new Date() })
    .where(eq(ordersTable.id, id))
    .returning({ id: ordersTable.id, attachments: ordersTable.attachments });
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  res.json(order);
});

router.delete("/orders/:id", async (req, res): Promise<void> => {
  const params = DeleteOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const result = await db.transaction(async (tx) => {
    // Serialize deletion against status/payment updates and retain the
    // allocation audit trail. Released allocations still identify a
    // component-managed order whose legacy stock must not be restored here.
    const lockedRows = await tx.execute(sql`
      SELECT id FROM orders WHERE id = ${params.data.id} FOR UPDATE
    `);
    if (!lockedRows.rows.length) return "missing" as const;

    const allocationRows = await tx.execute(sql`
      SELECT id FROM manufacturing_confirmed_allocations
      WHERE order_id = ${params.data.id}
      LIMIT 1
    `);
    if (allocationRows.rows.length) return "component-managed" as const;

    const [order] = await tx.select().from(ordersTable).where(eq(ordersTable.id, params.data.id));
    if (!order) return "missing" as const;

    const items = await tx.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
    const itemIds = items.map(i => i.id);

    // Preserve legacy stock restoration for orders without Phase 2 allocations.
    const NO_STOCK_YET = ["draft", "portal_draft", "portal_pending"];
    const ALREADY_GONE = ["dispatched", "delivered"];
    const shouldRestoreStock = !NO_STOCK_YET.includes(order.status) && !ALREADY_GONE.includes(order.status);
    if (shouldRestoreStock) {
      for (const item of items) {
        if (!item.purchaseRequired && item.productId && item.quantity) {
          await tx.execute(sql`
            UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) + ${item.quantity}
            WHERE id = ${item.productId}
          `);
        }
      }
    }

    if (itemIds.length > 0) {
      await tx.delete(purchaseOrderItemsTable)
        .where(inArray(purchaseOrderItemsTable.orderItemId, itemIds));
    }
    await tx.delete(purchaseOrderItemsTable)
      .where(eq(purchaseOrderItemsTable.orderId, order.id));

    const draftPurchaseOrders = await tx.select({ id: purchaseOrdersTable.id })
      .from(purchaseOrdersTable)
      .where(eq(purchaseOrdersTable.status, "draft"));
    const emptyDraftPoIds: number[] = [];
    for (const po of draftPurchaseOrders) {
      const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` })
        .from(purchaseOrderItemsTable)
        .where(eq(purchaseOrderItemsTable.poId, po.id));
      if (count === 0) emptyDraftPoIds.push(po.id);
    }
    if (emptyDraftPoIds.length > 0) {
      await tx.delete(purchaseOrdersTable).where(inArray(purchaseOrdersTable.id, emptyDraftPoIds));
    }

    const linkedWorksheets = await tx
      .select({ id: worksheetsTable.id, status: worksheetsTable.status })
      .from(worksheetsTable)
      .where(eq(worksheetsTable.orderId, order.id));
    const worksheetIdsToDelete = linkedWorksheets
      .filter(ws => ws.status !== "complete")
      .map(ws => ws.id);
    if (worksheetIdsToDelete.length > 0) {
      await tx.delete(worksheetsTable).where(inArray(worksheetsTable.id, worksheetIdsToDelete));
    }

    await tx.insert(orderLogsTable).values({
      orderId: order.id,
      action: "Order deleted",
      actor: getActor(req) || "System",
      details: `Order ${order.orderNumber} deleted (was ${order.status})`,
    });
    await tx.delete(ordersTable).where(eq(ordersTable.id, order.id));
    return "deleted" as const;
  });

  if (result === "missing") {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (result === "component-managed") {
    res.status(409).json({
      error: "This order has Phase 2 component allocations and cannot be deleted. Cancel it through the authenticated staff order route first.",
    });
    return;
  }
  res.sendStatus(204);
});

// ─── Order Acknowledgement Email ──────────────────────────────────────────────
router.post("/orders/:id/send-acknowledgement", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [order] = await db
    .select({
      id: ordersTable.id, orderNumber: ordersTable.orderNumber,
      customerId: ordersTable.customerId, customerName: ordersTable.customerName,
      orderDate: ordersTable.orderDate, requiredDate: ordersTable.requiredDate,
      notes: ordersTable.notes, totalAmount: ordersTable.totalAmount,
      poNumber: ordersTable.poNumber,
      deliveryAddressId: ordersTable.deliveryAddressId,
      stripePaymentLinkUrl: ordersTable.stripePaymentLinkUrl,
      shippingMethod: ordersTable.shippingMethod,
      carriageAmount: ordersTable.carriageAmount,
      portalSubmittedByName: ordersTable.portalSubmittedByName,
      portalSubmittedByEmail: ordersTable.portalSubmittedByEmail,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, params.data.id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  const itemRows2Raw = await db.execute(sql`
    SELECT
      COALESCE(p.name, oi.product_name) AS product_name,
      COALESCE(p.sku, b.sku)            AS sku,
      oi.colour, oi.size, oi.quantity, oi.unit_price, oi.line_total, oi.vat_rate,
      oi.recipient_name, oi.finish_name,
      oi.bundle_ref, oi.is_bundle_header,
      e.delivery_address_id AS emp_delivery_address_id
    FROM order_items oi
    LEFT JOIN products          p ON p.id = oi.product_id
    LEFT JOIN bundles           b ON b.id = oi.bundle_def_id
    LEFT JOIN customer_employees e ON e.id = oi.recipient_employee_id
    WHERE oi.order_id = ${params.data.id}
    ORDER BY oi.id
  `);
  const items = ((itemRows2Raw.rows ?? itemRows2Raw) as any[]).map(r => ({
    productName: r.product_name,
    sku: r.sku ?? null,
    colour: r.colour ?? null,
    size: r.size ?? null,
    quantity: r.quantity ?? 1,
    unitPrice: parseFloat(String(r.unit_price ?? 0)),
    lineTotal: parseFloat(String(r.line_total ?? 0)),
    vatRate: parseFloat(String(r.vat_rate ?? 0.20)),
    recipientName: r.recipient_name ?? null,
    finishName: r.finish_name ?? null,
    bundleRef: r.bundle_ref ?? null,
    isBundleHeader: r.is_bundle_header ?? false,
    empDeliveryAddressId: r.emp_delivery_address_id ? Number(r.emp_delivery_address_id) : null,
  }));

  // Build per-address delivery groups for the PDF when employees have distinct delivery addresses
  type AckItem = {
    productName: string; sku: string | null; colour: string | null; size: string | null;
    quantity: number; unitPrice: number; lineTotal: number; vatRate: number;
    recipientName: string | null; finishName: string | null;
    bundleRef: string | null; isBundleHeader: boolean;
  };
  let ackDeliveryGroups: Array<{ addressLabel: string; addressText: string; items: AckItem[] }> | undefined;
  let empSingleDeliveryAddressText: string | null = null;
  const getEffAddrId = (item: typeof items[0]) =>
    item.empDeliveryAddressId ?? (order.deliveryAddressId ? order.deliveryAddressId : null);
  const uniqueAddrIds = [...new Set(items.map(i => getEffAddrId(i)))];
  if (uniqueAddrIds.length > 1 || (uniqueAddrIds.length === 1 && uniqueAddrIds[0] !== null)) {
    const addrIds = uniqueAddrIds.filter((id): id is number => id !== null);
    const addrRows = addrIds.length > 0
      ? await db.select().from(customerDeliveryAddressesTable).where(inArray(customerDeliveryAddressesTable.id, addrIds))
      : [];
    const addrMap = new Map(addrRows.map(a => [a.id, a]));
    if (uniqueAddrIds.length > 1) {
      const groupMap = new Map<string | null, AckItem[]>();
      for (const item of items) {
        const effId = getEffAddrId(item);
        const key = effId !== null ? String(effId) : "null";
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key)!.push(item);
      }
      ackDeliveryGroups = [];
      for (const [key, gItems] of groupMap) {
        const addrId = key !== "null" ? Number(key) : null;
        const addr = addrId !== null ? addrMap.get(addrId) : null;
        const addressText = addr
          ? [addr.line1, addr.line2, addr.city, addr.postcode].filter(Boolean).join(", ")
          : (order.deliveryAddressId ? "Order delivery address" : "—");
        ackDeliveryGroups.push({
          addressLabel: addr?.label ?? "",
          addressText,
          items: gItems,
        });
      }
    } else {
      // Single effective address from employee — will override order-level address in PDF
      const singleId = uniqueAddrIds[0];
      const addr = singleId !== null ? addrMap.get(singleId) : null;
      if (addr) empSingleDeliveryAddressText = [addr.line1, addr.line2, addr.city, addr.postcode].filter(Boolean).join(", ");
    }
  }

  // Resolve customer email and address
  const body = z.object({ toEmail: z.string().optional(), previewOnly: z.boolean().optional() }).safeParse(req.body);
  let toEmail = body.success ? body.data.toEmail : undefined;
  let contactFirstName: string | null = null;
  let customerAddress: string | null = null;
  let customerCity: string | null = null;
  let customerPostcode: string | null = null;

  let customerLogoUrl: string | null = null;
  let customerLogoDataUrl: string | null = null;
  let customerLogoBuffer: Buffer | null = null;
  let sendAckZeroVat = false;

  if (order.customerId) {
    const [customer] = await db.select({
      email: customersTable.email,
      contactFirstName: customersTable.contactFirstName,
      address: customersTable.address,
      city: customersTable.city,
      postcode: customersTable.postcode,
      logoUrl: customersTable.logoUrl,
      zeroVat: customersTable.zeroVat,
    }).from(customersTable).where(eq(customersTable.id, order.customerId));
    contactFirstName = customer?.contactFirstName ?? null;
    customerAddress = customer?.address ?? null;
    customerCity = customer?.city ?? null;
    customerPostcode = customer?.postcode ?? null;
    customerLogoUrl = customer?.logoUrl ?? null;
    sendAckZeroVat = customer?.zeroVat ?? false;

    if (!toEmail) {
      // For portal orders, prefer the email of the person who placed the order
      if (order.portalSubmittedByEmail) {
        toEmail = order.portalSubmittedByEmail;
      } else {
        // Fall back to manager/dept_manager portal users' emails (any status — we just want a valid contact)
        const managerRows = await db.execute(sql`
          SELECT email FROM customer_portal_users
          WHERE customer_id = ${order.customerId}
            AND portal_role IN ('manager', 'dept_manager')
            AND email IS NOT NULL
          ORDER BY portal_role = 'manager' DESC, status = 'active' DESC, id ASC
        `);
        const managerEmails = (managerRows.rows as Array<{ email: string }>)
          .map(r => r.email)
          .filter(Boolean);
        if (managerEmails.length > 0) {
          toEmail = managerEmails.join(", ");
        } else {
          toEmail = customer?.email ?? undefined;
        }
      }
    }
  }
  if (!toEmail) {
    if (body.success && body.data.previewOnly) {
      // Preview mode — no email yet, return preview with empty to so dialog can display it
      toEmail = "";
    } else {
      res.status(400).json({ error: "No customer email address found" }); return;
    }
  }

  // Read customer logo directly from storage (URL is a relative object-storage path, not a public URL)
  if (customerLogoUrl) {
    [customerLogoBuffer, customerLogoDataUrl] = await Promise.all([
      fetchLogoBuffer(customerLogoUrl),
      fetchLogoDataUrl(customerLogoUrl),
    ]);
  }

  // Resolve delivery address if linked
  let deliveryAddressText: string | null = null;
  if (order.deliveryAddressId) {
    const [da] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    if (da) {
      deliveryAddressText = [da.line1, da.line2, da.city, da.postcode].filter(Boolean).join(", ");
    }
  }

  const mappedItems = items.map(i => ({
    productName: i.productName,
    sku: i.sku ?? null,
    colour: i.colour ?? null,
    size: i.size ?? null,
    quantity: i.quantity ?? 1,
    unitPrice: parseFloat(String(i.unitPrice ?? 0)),
    lineTotal: parseFloat(String(i.lineTotal ?? 0)),
    vatRate: parseFloat(String(i.vatRate ?? 0.20)),
    recipientName: i.recipientName ?? null,
    finishName: i.finishName ?? null,
    bundleRef: i.bundleRef ?? null,
    isBundleHeader: i.isBundleHeader ?? false,
  }));

  // Generate a fresh Stripe payment link for the acknowledgement so it doesn't
  // share a link with the invoice (which would make it stale if the invoice is
  // resent). Errors here are non-fatal — email still sends without a payment link.
  let ackStripeLink: string | null = order.stripePaymentLinkUrl ?? null;
  if (!order.paidAt) {
    const business = await requireConfiguredBusinessIdentity();
    try {
      const stripeForAck = await getUncachableStripeClient();
      const totalAmt = numericToFloat(order.totalAmount);
      const carriageAmt = numericToFloat(order.carriageAmount);
      if (totalAmt > 0) {
        const amountPence = Math.round((totalAmt + carriageAmt) * 100 * 1.2);
        const ackPrice = await stripeForAck.prices.create({
          unit_amount: amountPence,
          currency: "gbp",
          product_data: { name: `Order ${order.orderNumber} — ${business.name}` },
        });
        const ackLink = await stripeForAck.paymentLinks.create({
          line_items: [{ price: ackPrice.id, quantity: 1 }],
          metadata: { order_id: String(order.id), order_number: order.orderNumber },
          after_completion: {
            type: "hosted_confirmation",
            hosted_confirmation: {
              custom_message: `Payment received for order ${order.orderNumber}. Thank you — ${business.name}`,
            },
          },
        });
        ackStripeLink = ackLink.url;
        // Store as the canonical link so the invoice can also see it
        await db.update(ordersTable)
          .set({ stripePaymentLinkUrl: ackLink.url, stripePaymentLinkId: ackLink.id })
          .where(eq(ordersTable.id, order.id));
      }
    } catch {
      // Stripe not configured or API error — continue without a payment link
    }
  }

  const ackBusiness = await requireConfiguredBusinessIdentity();
  const { subject, html, text } = applyBusinessIdentityToAcknowledgement(buildAcknowledgementEmail({
    orderNumber: order.orderNumber,
    customerName: order.customerName ?? null,
    portalSubmittedByName: order.portalSubmittedByName ?? null,
    contactFirstName,
    customerLogoDataUrl,
    shippingMethod: order.shippingMethod ?? null,
    orderDate: order.orderDate ?? null,
    requiredDate: order.requiredDate ?? null,
    notes: order.notes ?? null,
    totalAmount: numericToFloat(order.totalAmount),
    carriageAmount: numericToFloat(order.carriageAmount),
    items: mappedItems,
    stripePaymentLink: ackStripeLink,
  }), ackBusiness);

  // Generate PDF attachment
  let attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
  try {
    const pdfBuffer = await generateOrderAcknowledgementPdf({
      orderNumber: order.orderNumber,
      orderDate: order.orderDate ?? null,
      requiredDate: order.requiredDate ?? null,
      poNumber: order.poNumber ?? null,
      customerName: order.customerName ?? null,
      customerAddress,
      customerCity,
      customerPostcode,
      deliveryAddress: ackDeliveryGroups ? null : (empSingleDeliveryAddressText ?? deliveryAddressText),
      shippingMethod: order.shippingMethod ?? null,
      customerLogoBuffer,
      totalAmount: numericToFloat(order.totalAmount),
      shippingAmount: numericToFloat(order.carriageAmount),
      zeroVat: sendAckZeroVat,
      items: mappedItems,
      deliveryGroups: ackDeliveryGroups,
    });
    attachments = [{ filename: `Order-Acknowledgement-${order.orderNumber}.pdf`, content: pdfBuffer, contentType: "application/pdf" }];
  } catch (_err) {
    // PDF failure is non-fatal — email still sends without attachment
  }

  // Always return the PDF as base64 so the client can build a .eml file
  const pdfBase64 = attachments.length > 0 ? attachments[0].content.toString("base64") : null;
  const pdfFilename = attachments.length > 0 ? attachments[0].filename : null;

  const previewOnly = body.success ? (body.data.previewOnly ?? false) : false;
  const result = previewOnly
    ? { sent: false as const, error: null as string | null }
    : await sendEmail({ to: toEmail, subject, html, text, attachments });

  if (!previewOnly) {
    await logOrderAction(order.id, "Acknowledgement sent", getActor(req),
      result.sent ? `Email sent to ${toEmail}` : `Email not sent (${result.error ?? "unconfigured"}); VBS/EML download`);
    await db.insert(orderEmailLogsTable).values({
      orderId: order.id,
      emailType: "acknowledgement",
      toEmail,
      subject,
      sentBy: getActor(req),
      success: result.sent,
      error: result.sent ? null : (result.error ?? "not configured"),
    }).catch((err) => console.error("[orderEmailLog] Failed to log:", err));
  }

  // ── Portal promo email ─────────────────────────────────────────────────────
  // After a non-portal ack, if the customer has no portal users set up,
  // send a one-off intro email (max once every 120 days).
  if (!previewOnly && result.sent && order.customerId) {
    (async () => {
      try {
        // Is this a portal order?
        const sourceRow = await db.execute(sql`SELECT source FROM orders WHERE id = ${order.id} LIMIT 1`);
        const orderSource = (sourceRow.rows[0] as any)?.source ?? null;
        if (orderSource === "portal") return;

        // Does this customer already have any portal users?
        const portalUserRows = await db.execute(sql`
          SELECT id FROM customer_portal_users WHERE customer_id = ${order.customerId} LIMIT 1
        `);
        if (portalUserRows.rows.length > 0) return;

        // 120-day throttle — stored per customer in settings table
        const throttleKey = `portal_promo_sent_${order.customerId}`;
        const throttleRow = await db.execute(sql`
          SELECT value FROM settings WHERE key = ${throttleKey} LIMIT 1
        `);
        const lastSentStr = (throttleRow.rows[0] as any)?.value ?? null;
        const daysSinceLast = lastSentStr
          ? (Date.now() - new Date(lastSentStr).getTime()) / 86_400_000
          : Infinity;
        if (daysSinceLast < 120) return;

        // Build and send the promo email using the invite template
        const business = await requireConfiguredBusinessIdentity();
        const promoCtaUrl = `mailto:${business.email}?subject=${encodeURIComponent(`Portal Access Enquiry — ${order.customerName ?? ""}`)}`;
        const { html: promoHtml, text: promoText } = buildInviteEmail(
          toEmail!,
          promoCtaUrl,
          order.customerName ?? "your business",
          customerLogoDataUrl,
          business,
        );
        const promoSubject = `${order.customerName ?? "Your business"} — manage your workwear online with the customer portal`;
        const promoResult = await sendEmail({ to: toEmail!, subject: promoSubject, html: promoHtml, text: promoText });
        if (promoResult.sent) {
          await db.execute(sql`
            INSERT INTO settings (key, value)
            VALUES (${throttleKey}, ${new Date().toISOString()})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
          `);
          console.log(`[portal-promo] Sent to customer ${order.customerId} (${toEmail})`);
        }
      } catch (err) {
        console.error("[portal-promo] Non-fatal error:", err);
      }
    })();
  }

  res.json({
    sent: result.sent,
    error: result.error,
    subject,
    html,
    text,
    to: toEmail,
    emailConfigured: isEmailConfigured,
    pdfBase64,
    pdfFilename,
    orderNumber: order.orderNumber,
    stripePaymentLinkUrl: order.stripePaymentLinkUrl ?? null,
  });
});

// ─── GET email send log for an order ─────────────────────────────────────────

router.get("/orders/:id/email-logs", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const logs = await db
    .select()
    .from(orderEmailLogsTable)
    .where(eq(orderEmailLogsTable.orderId, params.data.id))
    .orderBy(desc(orderEmailLogsTable.sentAt));

  res.json(logs);
});

// ─── GET acknowledgement as PDF ──────────────────────────────────────────────

router.get("/orders/:id/acknowledgement-pdf", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [order] = await db
    .select({
      id: ordersTable.id, orderNumber: ordersTable.orderNumber,
      customerId: ordersTable.customerId, customerName: ordersTable.customerName,
      orderDate: ordersTable.orderDate, requiredDate: ordersTable.requiredDate,
      notes: ordersTable.notes, totalAmount: ordersTable.totalAmount,
      poNumber: ordersTable.poNumber,
      deliveryAddressId: ordersTable.deliveryAddressId,
      shippingMethod: ordersTable.shippingMethod,
      carriageAmount: ordersTable.carriageAmount,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, params.data.id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  const itemRowsRaw = await db.execute(sql`
    SELECT
      COALESCE(p.name, oi.product_name) AS product_name,
      COALESCE(p.sku, b.sku)            AS sku,
      oi.colour, oi.size, oi.quantity, oi.unit_price, oi.line_total, oi.vat_rate,
      oi.recipient_name, oi.finish_name,
      oi.bundle_ref, oi.is_bundle_header
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN bundles  b ON b.id = oi.bundle_def_id
    WHERE oi.order_id = ${params.data.id}
    ORDER BY oi.id
  `);
  const items = ((itemRowsRaw.rows ?? itemRowsRaw) as any[]).map(r => ({
    productName: r.product_name,
    sku: r.sku ?? null,
    colour: r.colour ?? null,
    size: r.size ?? null,
    quantity: r.quantity ?? 1,
    unitPrice: parseFloat(String(r.unit_price ?? 0)),
    lineTotal: parseFloat(String(r.line_total ?? 0)),
    vatRate: parseFloat(String(r.vat_rate ?? 0.20)),
    recipientName: r.recipient_name ?? null,
    finishName: r.finish_name ?? null,
    bundleRef: r.bundle_ref ?? null,
    isBundleHeader: r.is_bundle_header ?? false,
  }));

  let customerAddress: string | null = null;
  let customerCity: string | null = null;
  let customerPostcode: string | null = null;
  let customerLogoBuffer: Buffer | null = null;

  let customerZeroVat = false;
  if (order.customerId) {
    const [customer] = await db.select({
      address: customersTable.address,
      city: customersTable.city,
      postcode: customersTable.postcode,
      logoUrl: customersTable.logoUrl,
      zeroVat: customersTable.zeroVat,
    }).from(customersTable).where(eq(customersTable.id, order.customerId));
    customerAddress = customer?.address ?? null;
    customerCity = customer?.city ?? null;
    customerPostcode = customer?.postcode ?? null;
    customerZeroVat = customer?.zeroVat ?? false;
    if (customer?.logoUrl) {
      customerLogoBuffer = await fetchLogoBuffer(customer.logoUrl);
    }
  }

  let deliveryAddressText: string | null = null;
  if (order.deliveryAddressId) {
    const [da] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    if (da) deliveryAddressText = [da.line1, da.line2, da.city, da.postcode].filter(Boolean).join(", ");
  }
  // Employee delivery address takes priority — override if all items share one employee address
  {
    const empAddrRows = (await db.execute(sql`
      SELECT DISTINCT e.delivery_address_id
      FROM order_items oi
      JOIN customer_employees e ON e.id = oi.recipient_employee_id
      WHERE oi.order_id = ${order.id} AND e.delivery_address_id IS NOT NULL
    `)).rows as Array<{ delivery_address_id: number }>;
    if (empAddrRows.length === 1) {
      const [empAddr] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, empAddrRows[0].delivery_address_id));
      if (empAddr) deliveryAddressText = [empAddr.line1, empAddr.line2, empAddr.city, empAddr.postcode].filter(Boolean).join(", ");
    }
  }

  try {
    const pdf = await generateOrderAcknowledgementPdf({
      orderNumber: order.orderNumber,
      orderDate: order.orderDate ?? null,
      requiredDate: order.requiredDate ?? null,
      poNumber: order.poNumber ?? null,
      customerName: order.customerName ?? null,
      customerAddress,
      customerCity,
      customerPostcode,
      deliveryAddress: deliveryAddressText,
      shippingMethod: order.shippingMethod ?? null,
      customerLogoBuffer,
      totalAmount: items.reduce((s, i) => s + i.lineTotal, 0),
      shippingAmount: numericToFloat(order.carriageAmount),
      zeroVat: customerZeroVat,
      items,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="Order-Acknowledgement-${order.orderNumber}.pdf"`);
    res.send(pdf);
  } catch (e: any) {
    res.status(500).json({ error: `PDF generation failed: ${e.message}` });
  }
});

// ─── GET acknowledgement as .eml (opens Outlook directly) ────────────────────

router.get("/orders/:id/acknowledgement.eml", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [order] = await db
    .select({
      id: ordersTable.id, orderNumber: ordersTable.orderNumber,
      customerId: ordersTable.customerId, customerName: ordersTable.customerName,
      orderDate: ordersTable.orderDate, requiredDate: ordersTable.requiredDate,
      notes: ordersTable.notes, totalAmount: ordersTable.totalAmount,
      carriageAmount: ordersTable.carriageAmount,
      shippingMethod: ordersTable.shippingMethod,
      poNumber: ordersTable.poNumber,
      deliveryAddressId: ordersTable.deliveryAddressId,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, params.data.id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  const emlItemRowsRaw = await db.execute(sql`
    SELECT
      COALESCE(p.name, oi.product_name) AS product_name,
      COALESCE(p.sku, b.sku)            AS sku,
      oi.colour, oi.size, oi.quantity, oi.unit_price, oi.line_total, oi.vat_rate,
      oi.recipient_name, oi.finish_name,
      oi.bundle_ref, oi.is_bundle_header
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN bundles  b ON b.id = oi.bundle_def_id
    WHERE oi.order_id = ${params.data.id}
    ORDER BY oi.id
  `);
  const items = ((emlItemRowsRaw.rows ?? emlItemRowsRaw) as any[]).map(r => ({
    productName: r.product_name,
    sku: r.sku ?? null,
    colour: r.colour ?? null,
    size: r.size ?? null,
    quantity: r.quantity ?? 1,
    unitPrice: parseFloat(String(r.unit_price ?? 0)),
    lineTotal: parseFloat(String(r.line_total ?? 0)),
    vatRate: parseFloat(String(r.vat_rate ?? 0.20)),
    recipientName: r.recipient_name ?? null,
    finishName: r.finish_name ?? null,
    bundleRef: r.bundle_ref ?? null,
    isBundleHeader: r.is_bundle_header ?? false,
  }));

  let toEmail = "";
  let contactFirstName: string | null = null;
  let customerAddress: string | null = null;
  let customerCity: string | null = null;
  let customerPostcode: string | null = null;
  let stripeCustomerId: string | null = null;

  let emlZeroVat = false;
  if (order.customerId) {
    const [customer] = await db.select({
      email: customersTable.email,
      contactFirstName: customersTable.contactFirstName,
      address: customersTable.address,
      city: customersTable.city,
      postcode: customersTable.postcode,
      stripeCustomerId: customersTable.stripeCustomerId,
      zeroVat: customersTable.zeroVat,
    }).from(customersTable).where(eq(customersTable.id, order.customerId));
    toEmail = customer?.email ?? "";
    contactFirstName = customer?.contactFirstName ?? null;
    customerAddress = customer?.address ?? null;
    customerCity = customer?.city ?? null;
    customerPostcode = customer?.postcode ?? null;
    stripeCustomerId = customer?.stripeCustomerId ?? null;
    emlZeroVat = customer?.zeroVat ?? false;
  }

  let deliveryAddressText: string | null = null;
  if (order.deliveryAddressId) {
    const [da] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    if (da) deliveryAddressText = [da.line1, da.line2, da.city, da.postcode].filter(Boolean).join(", ");
  }
  // Employee delivery address takes priority — override if all items share one employee address
  {
    const empAddrRows = (await db.execute(sql`
      SELECT DISTINCT e.delivery_address_id
      FROM order_items oi
      JOIN customer_employees e ON e.id = oi.recipient_employee_id
      WHERE oi.order_id = ${order.id} AND e.delivery_address_id IS NOT NULL
    `)).rows as Array<{ delivery_address_id: number }>;
    if (empAddrRows.length === 1) {
      const [empAddr] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, empAddrRows[0].delivery_address_id));
      if (empAddr) deliveryAddressText = [empAddr.line1, empAddr.line2, empAddr.city, empAddr.postcode].filter(Boolean).join(", ");
    }
  }

  const mappedItems = items.map(i => ({
    productName: i.productName,
    sku: i.sku ?? null,
    colour: i.colour ?? null,
    size: i.size ?? null,
    quantity: i.quantity ?? 1,
    unitPrice: parseFloat(String(i.unitPrice ?? 0)),
    lineTotal: parseFloat(String(i.lineTotal ?? 0)),
    vatRate: parseFloat(String(i.vatRate ?? 0.20)),
    recipientName: i.recipientName ?? null,
    finishName: i.finishName ?? null,
    bundleRef: i.bundleRef ?? null,
    isBundleHeader: i.isBundleHeader ?? false,
  }));

  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const orderTotal = numericToFloat(order.totalAmount);
  const stripePaymentLink = await createStripePaymentLink({
    orderNumber: order.orderNumber,
    totalAmount: orderTotal,
    stripeCustomerId,
    baseUrl,
  });

  const ackBusiness = await requireConfiguredBusinessIdentity();
  const { subject, html, text } = applyBusinessIdentityToAcknowledgement(buildAcknowledgementEmail({
    orderNumber: order.orderNumber,
    customerName: order.customerName ?? null,
    portalSubmittedByName: order.portalSubmittedByName ?? null,
    contactFirstName,
    orderDate: order.orderDate ?? null,
    requiredDate: order.requiredDate ?? null,
    notes: order.notes ?? null,
    totalAmount: orderTotal,
    carriageAmount: numericToFloat(order.carriageAmount),
    stripePaymentLink,
    items: mappedItems,
  }), ackBusiness);

  // Generate PDF
  let pdfBase64 = "";
  let pdfFilename = `Order-Acknowledgement-${order.orderNumber}.pdf`;
  try {
    const pdfBuffer = await generateOrderAcknowledgementPdf({
      orderNumber: order.orderNumber,
      orderDate: order.orderDate ?? null,
      requiredDate: order.requiredDate ?? null,
      poNumber: order.poNumber ?? null,
      customerName: order.customerName ?? null,
      customerAddress,
      customerCity,
      customerPostcode,
      deliveryAddress: deliveryAddressText,
      totalAmount: numericToFloat(order.totalAmount),
      shippingAmount: numericToFloat(order.carriageAmount),
      shippingMethod: order.shippingMethod ?? null,
      zeroVat: emlZeroVat,
      items: mappedItems,
    });
    pdfBase64 = pdfBuffer.toString("base64");
  } catch (_) { /* non-fatal */ }

  // Build MIME .eml
  const boundary = `----=_SBS_ACK_${Date.now()}`;
  const htmlB64 = Buffer.from(html, "utf8").toString("base64");
  const dateStr = new Date().toUTCString();

  const emlBusiness = await requireConfiguredBusinessIdentity();
  let eml = [
    `MIME-Version: 1.0`,
    `X-Unsent: 1`,
    `From: "${emlBusiness.name.replace(/["\r\n]/g, "")}" <${emlBusiness.email}>`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    `Date: ${dateStr}`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="utf-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    ...chunkBase64(htmlB64),
    ``,
  ].join("\r\n");

  if (pdfBase64) {
    eml += [
      `--${boundary}`,
      `Content-Type: application/pdf; name="${pdfFilename}"`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${pdfFilename}"`,
      ``,
      ...chunkBase64(pdfBase64),
      ``,
    ].join("\r\n");
  }

  eml += `--${boundary}--`;

  const filename = `Acknowledgement-${order.orderNumber}.eml`;
  res
    .status(200)
    .header("Content-Type", "message/rfc822")
    .header("Content-Disposition", `attachment; filename="${filename}"`)
    .header("X-Order-Number", order.orderNumber)
    .send(eml);
});

// ─── GET acknowledgement as .vbs (opens Outlook compose window via COM) ───────

router.get("/orders/:id/acknowledgement.vbs", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [order] = await db
    .select({
      id: ordersTable.id, orderNumber: ordersTable.orderNumber,
      customerId: ordersTable.customerId, customerName: ordersTable.customerName,
      orderDate: ordersTable.orderDate, requiredDate: ordersTable.requiredDate,
      notes: ordersTable.notes, totalAmount: ordersTable.totalAmount,
      carriageAmount: ordersTable.carriageAmount,
      shippingMethod: ordersTable.shippingMethod,
      poNumber: ordersTable.poNumber, deliveryAddressId: ordersTable.deliveryAddressId,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, params.data.id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  const vbsItemRowsRaw = await db.execute(sql`
    SELECT
      COALESCE(p.name, oi.product_name) AS product_name,
      COALESCE(p.sku, b.sku)            AS sku,
      oi.colour, oi.size, oi.quantity, oi.unit_price, oi.line_total, oi.vat_rate,
      oi.recipient_name, oi.finish_name,
      oi.bundle_ref, oi.is_bundle_header
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN bundles  b ON b.id = oi.bundle_def_id
    WHERE oi.order_id = ${params.data.id}
    ORDER BY oi.id
  `);
  const items = ((vbsItemRowsRaw.rows ?? vbsItemRowsRaw) as any[]).map(r => ({
    productName: r.product_name,
    sku: r.sku ?? null,
    colour: r.colour ?? null,
    size: r.size ?? null,
    quantity: r.quantity ?? 1,
    unitPrice: parseFloat(String(r.unit_price ?? 0)),
    lineTotal: parseFloat(String(r.line_total ?? 0)),
    vatRate: parseFloat(String(r.vat_rate ?? 0.20)),
    recipientName: r.recipient_name ?? null,
    finishName: r.finish_name ?? null,
    bundleRef: r.bundle_ref ?? null,
    isBundleHeader: r.is_bundle_header ?? false,
  }));

  let toEmail = "";
  let contactFirstName: string | null = null;
  let customerAddress: string | null = null;
  let customerCity: string | null = null;
  let customerPostcode: string | null = null;
  let stripeCustomerId2: string | null = null;
  let vbsZeroVat = false;

  if (order.customerId) {
    const [customer] = await db.select({
      email: customersTable.email,
      contactFirstName: customersTable.contactFirstName,
      address: customersTable.address,
      city: customersTable.city,
      postcode: customersTable.postcode,
      stripeCustomerId: customersTable.stripeCustomerId,
      zeroVat: customersTable.zeroVat,
    }).from(customersTable).where(eq(customersTable.id, order.customerId));
    toEmail = customer?.email ?? "";
    contactFirstName = customer?.contactFirstName ?? null;
    customerAddress = customer?.address ?? null;
    customerCity = customer?.city ?? null;
    customerPostcode = customer?.postcode ?? null;
    stripeCustomerId2 = customer?.stripeCustomerId ?? null;
    vbsZeroVat = customer?.zeroVat ?? false;
  }

  let deliveryAddressText: string | null = null;
  if (order.deliveryAddressId) {
    const [da] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    if (da) deliveryAddressText = [da.line1, da.line2, da.city, da.postcode].filter(Boolean).join(", ");
  }
  // Employee delivery address takes priority — override if all items share one employee address
  {
    const empAddrRows = (await db.execute(sql`
      SELECT DISTINCT e.delivery_address_id
      FROM order_items oi
      JOIN customer_employees e ON e.id = oi.recipient_employee_id
      WHERE oi.order_id = ${order.id} AND e.delivery_address_id IS NOT NULL
    `)).rows as Array<{ delivery_address_id: number }>;
    if (empAddrRows.length === 1) {
      const [empAddr] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, empAddrRows[0].delivery_address_id));
      if (empAddr) deliveryAddressText = [empAddr.line1, empAddr.line2, empAddr.city, empAddr.postcode].filter(Boolean).join(", ");
    }
  }

  const mappedItems = items.map(i => ({
    productName: i.productName,
    sku: i.sku ?? null,
    colour: i.colour ?? null,
    size: i.size ?? null,
    quantity: i.quantity ?? 1,
    unitPrice: parseFloat(String(i.unitPrice ?? 0)),
    lineTotal: parseFloat(String(i.lineTotal ?? 0)),
    vatRate: parseFloat(String(i.vatRate ?? 0.20)),
    recipientName: i.recipientName ?? null,
    finishName: i.finishName ?? null,
    bundleRef: i.bundleRef ?? null,
    isBundleHeader: i.isBundleHeader ?? false,
  }));

  const baseUrl2 = `${req.protocol}://${req.get("host")}`;
  const orderTotal2 = numericToFloat(order.totalAmount);
  const stripePaymentLink2 = await createStripePaymentLink({
    orderNumber: order.orderNumber,
    totalAmount: orderTotal2,
    stripeCustomerId: stripeCustomerId2,
    baseUrl: baseUrl2,
  });

  const ackBusiness = await requireConfiguredBusinessIdentity();
  const { subject, html } = applyBusinessIdentityToAcknowledgement(buildAcknowledgementEmail({
    orderNumber: order.orderNumber,
    customerName: order.customerName ?? null,
    portalSubmittedByName: order.portalSubmittedByName ?? null,
    contactFirstName,
    orderDate: order.orderDate ?? null,
    requiredDate: order.requiredDate ?? null,
    notes: order.notes ?? null,
    totalAmount: orderTotal2,
    carriageAmount: numericToFloat(order.carriageAmount),
    stripePaymentLink: stripePaymentLink2,
    items: mappedItems,
  }), ackBusiness);

  let pdfBase64 = "";
  const pdfFilename = `Order-Acknowledgement-${order.orderNumber}.pdf`;
  try {
    const pdfBuffer = await generateOrderAcknowledgementPdf({
      orderNumber: order.orderNumber,
      orderDate: order.orderDate ?? null,
      requiredDate: order.requiredDate ?? null,
      poNumber: order.poNumber ?? null,
      customerName: order.customerName ?? null,
      customerAddress,
      customerCity,
      customerPostcode,
      deliveryAddress: deliveryAddressText,
      totalAmount: numericToFloat(order.totalAmount),
      shippingAmount: numericToFloat(order.carriageAmount),
      shippingMethod: order.shippingMethod ?? null,
      zeroVat: vbsZeroVat,
      items: mappedItems,
    });
    pdfBase64 = pdfBuffer.toString("base64");
  } catch (_) { /* non-fatal */ }

  // Encode HTML and PDF as base64 chunks for embedding in VBScript
  const htmlB64 = Buffer.from(html, "utf8").toString("base64");

  function vbsChunks(b64: string): string {
    const size = 60;
    const lines: string[] = [];
    for (let i = 0; i < b64.length; i += size) {
      lines.push(JSON.stringify(b64.slice(i, i + size)));
    }
    if (lines.length === 0) return '""';
    return lines.join(" & _\r\n    ");
  }

  const escapedSubject = subject.replace(/"/g, '""');
  const escapedToEmail = toEmail.replace(/"/g, '""');
  const escapedPdfFilename = pdfFilename.replace(/"/g, '""');
  const senderEmail = (await requireConfiguredBusinessIdentity()).email.replace(/"/g, '""');

  const vbs = `Option Explicit

' ── Base64 decode helper (via MSXML2) ───────────────────────────────────────
Function B64ToBytes(b64)
  Dim doc, node
  Set doc = CreateObject("MSXML2.DOMDocument")
  Set node = doc.createElement("b64")
  node.DataType = "bin.base64"
  node.Text = b64
  B64ToBytes = node.NodeTypedValue
End Function

Function B64ToString(b64)
  Dim st
  Set st = CreateObject("ADODB.Stream")
  st.Type = 1
  st.Open
  st.Write B64ToBytes(b64)
  st.Position = 0
  st.Type = 2
  st.Charset = "utf-8"
  B64ToString = st.ReadText
  st.Close
End Function

' ── Embedded data ────────────────────────────────────────────────────────────
Dim toEmail, subj, pdfFile, senderEmail, htmlB64, pdfB64
toEmail  = "${escapedToEmail}"
subj     = "${escapedSubject}"
pdfFile  = "${escapedPdfFilename}"
senderEmail = "${senderEmail}"

htmlB64 = ${vbsChunks(htmlB64)}

${pdfBase64 ? `pdfB64 = ${vbsChunks(pdfBase64)}` : `pdfB64 = ""`}

' ── Write PDF to temp file ───────────────────────────────────────────────────
Dim fso, tmpPdf
Set fso = CreateObject("Scripting.FileSystemObject")
tmpPdf = fso.GetSpecialFolder(2) & "\\" & pdfFile

If Len(pdfB64) > 0 Then
  Dim pdfStream
  Set pdfStream = CreateObject("ADODB.Stream")
  pdfStream.Type = 1
  pdfStream.Open
  pdfStream.Write B64ToBytes(pdfB64)
  pdfStream.SaveToFile tmpPdf, 2
  pdfStream.Close
End If

' ── Create Outlook compose window ────────────────────────────────────────────
Dim olApp, mail
Set olApp = CreateObject("Outlook.Application")
Set mail = olApp.CreateItem(0)

' ── Set sending account so email saves to correct Sent Items ─────────────────
On Error Resume Next
Dim ns, accts, j
Set ns = olApp.GetNamespace("MAPI")
Set accts = ns.Accounts
For j = 1 To accts.Count
  If LCase(accts.Item(j).SmtpAddress) = LCase(senderEmail) Then
    Set mail.SendUsingAccount = accts.Item(j)
    Exit For
  End If
Next
On Error GoTo 0

mail.To       = toEmail
mail.Subject  = subj
mail.HTMLBody = B64ToString(htmlB64)

If Len(pdfB64) > 0 And fso.FileExists(tmpPdf) Then
  mail.Attachments.Add tmpPdf
End If

mail.Display

' Clean up temp PDF after Outlook has loaded it
WScript.Sleep 5000
If fso.FileExists(tmpPdf) Then fso.DeleteFile tmpPdf
`;

  await logOrderAction(order.id, "Acknowledgement prepared", getActor(req),
    `VBS script downloaded for ${order.orderNumber} — to be sent via Outlook`);

  const filename = `SendAck-${order.orderNumber}.vbs`;
  res
    .status(200)
    .header("Content-Type", "application/octet-stream")
    .header("Content-Disposition", `attachment; filename="${filename}"`)
    .send(vbs);
});

function chunkBase64(b64: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += 76) chunks.push(b64.slice(i, i + 76));
  return chunks;
}

router.post("/orders/:id/items", async (req, res): Promise<void> => {
  try {
  const params = AddOrderItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.id));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const addItemSchema = z.object({
    productId: z.number().int().positive().optional().nullable(),
    productName: z.string(),
    colour: z.string().optional().nullable(),
    size: z.string().optional().nullable(),
    finishId: z.number().int().positive().optional().nullable(),
    finishName: z.string().optional().nullable(),
    recipientType: z.enum(["stock", "person"]).default("stock"),
    recipientName: z.string().optional().nullable(),
    recipientEmployeeId: z.number().int().positive().optional().nullable(),
    quantity: z.number().int().positive(),
    unitPrice: z.number().min(0),
    vatRate: z.number().min(0).max(1).optional(),
    purchaseRequired: z.boolean().optional().default(false),
    purchaseQuantity: z.number().int().min(0).optional().nullable(),
    supplierId: z.number().int().positive().optional().nullable(),
    supplierName: z.string().optional().nullable(),
  });

  const parsed = addItemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Resolve VAT rate: use client-supplied value if given, otherwise look up from product
  let effectiveVatRate = parsed.data.vatRate;
  if (effectiveVatRate === undefined && parsed.data.productId) {
    const [prod] = await db
      .select({ vatRate: productsTable.vatRate })
      .from(productsTable)
      .where(eq(productsTable.id, parsed.data.productId))
      .limit(1);
    effectiveVatRate = prod ? parseFloat(String(prod.vatRate ?? 0.20)) : 0.20;
  }
  effectiveVatRate = effectiveVatRate ?? 0.20;
  // Override to zero-rated if the customer is Channel Islands / zero-VAT
  if (order.customerId) {
    const [cust] = await db
      .select({ zeroVat: customersTable.zeroVat })
      .from(customersTable)
      .where(eq(customersTable.id, order.customerId))
      .limit(1);
    if (cust?.zeroVat) effectiveVatRate = 0;
  }

  // For active orders, run a real stock check rather than trusting the
  // client-supplied purchaseRequired flag (which defaults to false).
  let resolvedPurchaseRequired = parsed.data.purchaseRequired ?? false;
  let resolvedPurchaseQuantity = parsed.data.purchaseQuantity ?? null;
  let resolvedSupplierId = parsed.data.supplierId ?? null;
  let resolvedSupplierName = parsed.data.supplierName ?? null;

  if ((order.status === "confirmed" || order.status === "part_shipped") && parsed.data.productId) {
    const productId = parsed.data.productId;
    const qty = parsed.data.quantity;
    const colour = parsed.data.colour ?? null;
    const size = parsed.data.size ?? null;

    // Look up variant or plain product stock.
    // Size matching handles two stored formats: direct (pv.size = size) and split
    // ("size/sleeve" order item value vs pv.size + pv.sleeve columns), preferring a
    // direct match when both are present.
    const variantCandidates = await db.execute(sql`
      WITH matches AS (
        SELECT pv.id,
          CASE
            WHEN pv.size IS NOT DISTINCT FROM ${size} THEN 0
            WHEN ${size}::text LIKE '%/%' AND pv.size = split_part(${size}, '/', 1)
              AND pv.sleeve = split_part(${size}, '/', 2) THEN 1
            ELSE 2
          END AS rank
        FROM product_variants pv
        WHERE pv.product_id = ${productId}
          AND (pv.colour IS NOT DISTINCT FROM ${colour})
          AND (
            pv.size IS NOT DISTINCT FROM ${size}
            OR (${size}::text LIKE '%/%' AND pv.size = split_part(${size}, '/', 1)
                AND pv.sleeve = split_part(${size}, '/', 2))
            OR (pv.size IS NULL AND pv.sleeve IS NULL)
          )
      )
      SELECT id FROM matches
      WHERE rank = (SELECT MIN(rank) FROM matches)
      ORDER BY id
    `);
    if (variantCandidates.rows.length > 1) {
      throw new Error(`Cannot add item to confirmed order: colour ${colour ?? "blank"}, size ${size ?? "blank"} matches duplicate product variants (${variantCandidates.rows.map((r: any) => r.id).join(", ")}). Resolve the duplicate variant identity before adding stock.`);
    }
    const resolvedVariantId = variantCandidates.rows[0]
      ? Number((variantCandidates.rows[0] as any).id)
      : null;
    const stockRows = await db.execute(sql`
      SELECT
         COALESCE(
           (SELECT pv.stock_quantity
           FROM product_variants pv
           WHERE pv.product_id = ${productId}
             AND (pv.colour IS NOT DISTINCT FROM ${colour})
             AND (
                  (pv.size IS NOT DISTINCT FROM ${size})
                  OR (${size}::text LIKE '%/%' AND pv.size = split_part(${size}, '/', 1) AND pv.sleeve = split_part(${size}, '/', 2))
                  OR (pv.size IS NULL AND pv.sleeve IS NULL)
             )
           ORDER BY CASE WHEN pv.size IS NOT DISTINCT FROM ${size} THEN 0 ELSE 1 END
            LIMIT 1),
          CASE WHEN NOT EXISTS (
                 SELECT 1 FROM product_variants pv WHERE pv.product_id = ${productId}
               )
               THEN p.stock_quantity
               ELSE 0
          END
        ) AS available_stock,
        -- Orphaned on-order: ordered PO lines for this variant whose linked order items
        -- were all deleted. Goods are still incoming → treat as available supply.
        COALESCE((
          SELECT SUM(poi2.quantity_ordered - COALESCE(poi2.quantity_delivered, 0))
          FROM purchase_order_items poi2
          JOIN purchase_orders po2 ON poi2.po_id = po2.id
          WHERE po2.status = 'ordered'
            AND poi2.quantity_ordered > COALESCE(poi2.quantity_delivered, 0)
            AND poi2.product_id = ${productId}
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
        ), 0) AS orphaned_on_order,
        COALESCE(
          (SELECT pv.primary_supplier_id
           FROM product_variants pv
           WHERE pv.product_id = ${productId}
             AND (pv.colour IS NOT DISTINCT FROM ${colour})
             AND (
                  (pv.size IS NOT DISTINCT FROM ${size})
                  OR (${size}::text LIKE '%/%' AND pv.size = split_part(${size}, '/', 1) AND pv.sleeve = split_part(${size}, '/', 2))
                  OR (pv.size IS NULL AND pv.sleeve IS NULL)
             )
           ORDER BY CASE WHEN pv.size IS NOT DISTINCT FROM ${size} THEN 0 ELSE 1 END
           LIMIT 1),
          p.supplier_id
        ) AS supplier_id,
        COALESCE(
          (SELECT vs.name
           FROM product_variants pv
           JOIN suppliers vs ON vs.id = pv.primary_supplier_id
           WHERE pv.product_id = ${productId}
             AND (pv.colour IS NOT DISTINCT FROM ${colour})
             AND (
                  (pv.size IS NOT DISTINCT FROM ${size})
                  OR (${size}::text LIKE '%/%' AND pv.size = split_part(${size}, '/', 1) AND pv.sleeve = split_part(${size}, '/', 2))
                  OR (pv.size IS NULL AND pv.sleeve IS NULL)
             )
           ORDER BY CASE WHEN pv.size IS NOT DISTINCT FROM ${size} THEN 0 ELSE 1 END
           LIMIT 1),
          s.name
        ) AS supplier_name
      FROM products p
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id = ${productId}
    `);
    const stockRow = stockRows.rows[0] as any;
    const available = Number(stockRow?.available_stock ?? 0) + Number(stockRow?.orphaned_on_order ?? 0);
    const allocatedQty = Math.min(available, qty);
    const shortfall = qty - allocatedQty;

    resolvedPurchaseRequired = shortfall > 0;
    resolvedPurchaseQuantity = shortfall > 0 ? shortfall : null;
    resolvedSupplierId = shortfall > 0 ? (stockRow?.supplier_id ?? null) : null;
    resolvedSupplierName = shortfall > 0 ? (stockRow?.supplier_name ?? null) : null;

    // Deduct the same concrete variant row used by the stock/supplier lookup.
    // Same direct-or-split size matching as the stock lookup above.
    if (allocatedQty > 0) {
      if (resolvedVariantId != null) {
        await db.execute(sql`
        UPDATE product_variants
        SET stock_quantity = GREATEST(0, stock_quantity - ${allocatedQty})
        WHERE id = ${resolvedVariantId}
        `);
      } else {
        await db.execute(sql`
          UPDATE products SET stock_quantity = GREATEST(0, stock_quantity - ${allocatedQty})
          WHERE id = ${productId}
        `);
      }
      // Roll up to parent product
      await db.execute(sql`
        UPDATE products
        SET stock_quantity = (
          SELECT COALESCE(SUM(stock_quantity), 0) FROM product_variants WHERE product_id = ${productId}
        )
        WHERE id = ${productId}
      `);
    }
  }

  // For active orders where stock was fully allocated (no shortfall) and the item
  // has no finish (no production step), mark it ready immediately.
  // Items with a finish go through a worksheet → in_production → complete flow instead.
  const resolvedStockStatus =
    (order.status === "confirmed" || order.status === "part_shipped") && !resolvedPurchaseRequired && !parsed.data.finishId
      ? "complete"
      : null;
  const resolvedStockAllocatedAt = resolvedStockStatus === "complete" ? new Date() : null;

  const lineTotal = parsed.data.quantity * parsed.data.unitPrice;
  const [item] = await db
    .insert(orderItemsTable)
    .values({
      orderId: params.data.id,
      productId: parsed.data.productId ?? null,
      productName: parsed.data.productName,
      colour: parsed.data.colour ?? null,
      size: parsed.data.size ?? null,
      finishId: parsed.data.finishId ?? null,
      finishName: parsed.data.finishName ?? null,
      recipientType: parsed.data.recipientType,
      recipientName: parsed.data.recipientName ?? null,
      recipientEmployeeId: parsed.data.recipientEmployeeId ?? null,
      quantity: parsed.data.quantity,
      unitPrice: String(parsed.data.unitPrice),
      lineTotal: String(lineTotal),
      vatRate: String(effectiveVatRate),
      purchaseRequired: resolvedPurchaseRequired,
      purchaseQuantity: resolvedPurchaseQuantity,
      supplierId: resolvedSupplierId,
      supplierName: resolvedSupplierName,
      stockStatus: resolvedStockStatus,
      stockAllocatedAt: resolvedStockAllocatedAt,
    })
    .returning();

  await recalcOrderTotal(params.data.id);

  // Save the size against the employee so it can be suggested on reorder
  if (parsed.data.recipientEmployeeId && parsed.data.size && parsed.data.productName) {
    const empId = parsed.data.recipientEmployeeId;
    const label = parsed.data.productName;
    const sizeVal = parsed.data.size;
    const allSizes = await db.select().from(customerEmployeeSizesTable)
      .where(eq(customerEmployeeSizesTable.employeeId, empId));
    const match = allSizes.find(s => s.label === label);
    if (match) {
      await db.update(customerEmployeeSizesTable)
        .set({ size: sizeVal, updatedAt: new Date() })
        .where(eq(customerEmployeeSizesTable.id, match.id));
    } else {
      await db.insert(customerEmployeeSizesTable)
        .values({ employeeId: empId, label, size: sizeVal });
    }
  }

  res.status(201).json({
    ...item,
    unitPrice: numericToFloat(item.unitPrice),
    lineTotal: numericToFloat(item.lineTotal),
    vatRate: parseFloat(String(item.vatRate ?? 0.20)),
  });
  } catch (err: any) {
    console.error("[POST /orders/:id/items] Unhandled error:", err?.message ?? err, "body:", JSON.stringify(req.body));
    res.status(500).json({ error: err?.message ?? "Internal server error" });
  }
});

// Explicit correction for a plain, undelivered line wrongly marked ready.
// Current stock is not evidence that an older allocation was wrong: it may
// already have been deducted. Never run this as an automatic stock rescan.
router.post("/orders/:id/items/:itemId/send-to-purchasing", async (req, res): Promise<void> => {
  const orderId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || !Number.isSafeInteger(itemId) || itemId <= 0) {
    res.status(400).json({ error: "Invalid order or item" });
    return;
  }
  try {
    const updated = await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        SELECT oi.id, oi.quantity, oi.product_id, oi.product_name, oi.colour, oi.size,
               COALESCE(
                 (SELECT pv.primary_supplier_id FROM product_variants pv
                  WHERE pv.product_id = oi.product_id
                    AND pv.colour IS NOT DISTINCT FROM oi.colour
                    AND (pv.size IS NOT DISTINCT FROM oi.size OR (pv.size IS NULL AND pv.sleeve IS NULL))
                    AND pv.primary_supplier_id IS NOT NULL
                  ORDER BY CASE WHEN pv.size IS NOT DISTINCT FROM oi.size THEN 0 ELSE 1 END
                  LIMIT 1),
                 p.supplier_id
               ) AS supplier_id
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        WHERE o.id = ${orderId} AND oi.id = ${itemId}
          AND o.status = 'part_shipped'
          AND oi.stock_status = 'complete'
          AND oi.purchase_required = false
          AND oi.dispatched_at IS NULL
          AND oi.finish_id IS NULL
          AND p.is_service IS NOT TRUE
          AND NOT EXISTS (
            SELECT 1 FROM purchase_order_items poi
            JOIN purchase_orders po ON po.id = poi.po_id
            WHERE po.status IN ('draft', 'ordered')
              AND (poi.order_item_id = oi.id
                OR COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> to_jsonb(oi.id))
          )
        FOR UPDATE OF oi
      `);
      const line = rows.rows[0] as any;
      if (!line) return null;
      const supplier = line.supplier_id
        ? (await tx.execute(sql`SELECT name FROM suppliers WHERE id = ${line.supplier_id}`)).rows[0] as any
        : null;
      await tx.execute(sql`
        UPDATE order_items SET purchase_required = true,
          purchase_quantity = ${line.quantity}, supplier_id = ${line.supplier_id},
          supplier_name = ${supplier?.name ?? null},
          stock_status = NULL, stock_allocated_at = NULL
        WHERE id = ${itemId}
      `);
      await tx.execute(sql`
        INSERT INTO order_logs (order_id, action, actor, details, created_at)
        VALUES (${orderId}, 'Returned line to Purchasing', 'Staff',
          ${`Item ${itemId}: ${line.product_name} (${line.colour ?? "no colour"} / ${line.size ?? "no size"}) ×${line.quantity}. Staff confirmed physical stock is unavailable; no stock was restored.`},
          now())
      `);
      return { id: itemId };
    });
    if (!updated) {
      res.status(409).json({ error: "Only an undelivered, ready, plain item on a part-shipped order without an open PO can be returned to Purchasing." });
      return;
    }
    res.json(updated);
  } catch (error) {
    req.log.error({ err: error, orderId, itemId }, "Could not return order item to Purchasing");
    res.status(500).json({ error: "Could not return item to Purchasing" });
  }
});

const UpdateOrderItemBodyExtended = z.object({
  quantity: z.number().int().positive().optional(),
  unitPrice: z.number().min(0).optional(),
  vatRate: z.number().min(0).max(1).optional(),
  purchaseRequired: z.boolean().optional(),
  purchaseQuantity: z.number().int().min(0).nullable().optional(),
  supplierId: z.number().int().positive().nullable().optional(),
  supplierName: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  colour: z.string().nullable().optional(),
  stockStatus: z.string().nullable().optional(),
  stockAllocatedAt: z.string().nullable().optional(),
  dispatchedAt: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

router.patch("/orders/:id/items/bulk-price", async (req, res): Promise<void> => {
  const orderId = parseInt(req.params.id);
  if (isNaN(orderId)) { res.status(400).json({ error: "Invalid order id" }); return; }

  const body = z.object({
    productId: z.number().int().positive(),
    unitPrice: z.number().positive(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { productId, unitPrice } = body.data;

  const updated = await db.execute(sql`
    UPDATE order_items
    SET unit_price = ${String(unitPrice)},
        line_total = (quantity::numeric * ${String(unitPrice)})::numeric
    WHERE order_id = ${orderId}
      AND product_id = ${productId}
      AND is_bundle_header IS NOT TRUE
    RETURNING id
  `);

  await recalcOrderTotal(orderId);

  res.json({ updated: (updated.rows ?? updated).length });
});

router.patch("/orders/:id/items/:itemId", async (req, res): Promise<void> => {
  const params = UpdateOrderItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateOrderItemBodyExtended.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existingItem] = await db.select().from(orderItemsTable).where(eq(orderItemsTable.id, params.data.itemId));
  if (!existingItem) {
    res.status(404).json({ error: "Order item not found" });
    return;
  }

  const quantity = parsed.data.quantity ?? existingItem.quantity;
  const unitPrice = parsed.data.unitPrice ?? numericToFloat(existingItem.unitPrice);
  const lineTotal = quantity * unitPrice;

  const updateData: Record<string, unknown> = {
    quantity,
    unitPrice: String(unitPrice),
    lineTotal: String(lineTotal),
  };

  if (parsed.data.vatRate !== undefined) updateData.vatRate = String(parsed.data.vatRate);
  if (parsed.data.purchaseRequired !== undefined) updateData.purchaseRequired = parsed.data.purchaseRequired;
  if (parsed.data.purchaseQuantity !== undefined) updateData.purchaseQuantity = parsed.data.purchaseQuantity;
  if (parsed.data.supplierId !== undefined) updateData.supplierId = parsed.data.supplierId;
  if (parsed.data.supplierName !== undefined) updateData.supplierName = parsed.data.supplierName;
  if (parsed.data.size !== undefined) updateData.size = parsed.data.size;
  if (parsed.data.colour !== undefined) updateData.colour = parsed.data.colour;
  if (parsed.data.stockStatus !== undefined) updateData.stockStatus = parsed.data.stockStatus;
  if (parsed.data.stockAllocatedAt !== undefined) updateData.stockAllocatedAt = parsed.data.stockAllocatedAt ? new Date(parsed.data.stockAllocatedAt) : null;
  if (parsed.data.dispatchedAt !== undefined) updateData.dispatchedAt = parsed.data.dispatchedAt ? new Date(parsed.data.dispatchedAt) : null;
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;

  const [item] = await db
    .update(orderItemsTable)
    .set(updateData)
    .where(eq(orderItemsTable.id, params.data.itemId))
    .returning();

  await recalcOrderTotal(params.data.id);

  res.json({
    ...item,
    unitPrice: numericToFloat(item.unitPrice),
    lineTotal: numericToFloat(item.lineTotal),
    vatRate: parseFloat(String(item.vatRate ?? 0.20)),
  });
});

router.delete("/orders/:id/items/:itemId", async (req, res): Promise<void> => {
  const params = DeleteOrderItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const removeFromPo = req.query.removeFromPo === "true";

  // Optionally remove from any draft POs before deleting the item
  if (removeFromPo) {
    await db.execute(sql`
      DELETE FROM purchase_order_items poi
      USING purchase_orders po
      WHERE poi.po_id = po.id
        AND po.status = 'draft'
        AND (
          poi.order_item_id = ${params.data.itemId}
          OR COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> to_jsonb(${params.data.itemId}::int)
        )
    `);
  }

  const [item] = await db.delete(orderItemsTable).where(eq(orderItemsTable.id, params.data.itemId)).returning();
  if (!item) {
    res.status(404).json({ error: "Order item not found" });
    return;
  }

  await recalcOrderTotal(params.data.id);
  res.sendStatus(204);
});

router.get("/dashboard/stats", async (_req, res): Promise<void> => {
  // Exclude portal_draft orders (not yet in the fulfilment workflow) and cancelled orders
  const visibleOrders = sql`(${ordersTable.status} IS DISTINCT FROM 'portal_draft' AND ${ordersTable.status} IS DISTINCT FROM 'cancelled')`;

  const [{ count: totalOrders }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ordersTable)
    .where(visibleOrders);

  const [{ total: totalRevenue }] = await db
    .select({ total: sql<number>`coalesce(sum(total_amount), 0)::float` })
    .from(ordersTable)
    .where(and(eq(ordersTable.status, "delivered"), visibleOrders));

  const [{ count: totalCustomers }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customersTable);

  const [{ count: totalProducts }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(productsTable);

  const statusCounts = await db
    .select({
      status: ordersTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(ordersTable)
    .where(visibleOrders)
    .groupBy(ordersTable.status);

  const ordersByStatus = { draft: 0, confirmed: 0, shipped: 0, delivered: 0 };
  for (const row of statusCounts) {
    const key = row.status as keyof typeof ordersByStatus;
    if (key in ordersByStatus) {
      ordersByStatus[key] = row.count;
    }
  }

  const recentOrders = await db
    .select()
    .from(ordersTable)
    .where(visibleOrders)
    .orderBy(desc(ordersTable.createdAt))
    .limit(10);

  res.json({
    totalOrders,
    totalRevenue,
    totalCustomers,
    totalProducts,
    ordersByStatus,
    recentOrders: recentOrders.map((o) => ({ ...o, totalAmount: numericToFloat(o.totalAmount) })),
  });
});

router.get("/orders/:id/pack-status", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const orderId = parsed.data.id;

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  if (items.length === 0) { res.json({ recipients: [] }); return; }

  const itemIds = items.map((i) => i.id);
  const wsItems = await db
    .select({ wsItem: worksheetItemsTable, ws: worksheetsTable })
    .from(worksheetItemsTable)
    .innerJoin(worksheetsTable, eq(worksheetItemsTable.worksheetId, worksheetsTable.id))
    .where(inArray(worksheetItemsTable.orderItemId, itemIds));

  const employeeIds = [...new Set(items.filter((i) => i.recipientEmployeeId).map((i) => i.recipientEmployeeId!))];
  const employees = employeeIds.length > 0
    ? await db.select().from(customerEmployeesTable).where(inArray(customerEmployeesTable.id, employeeIds))
    : [];
  const empMap = new Map(employees.map((e) => [e.id, e]));

  const wsItemMap = new Map<number, { worksheetNumber: string; status: string }>();
  for (const { wsItem, ws } of wsItems) {
    if (wsItem.orderItemId) wsItemMap.set(wsItem.orderItemId, { worksheetNumber: ws.worksheetNumber, status: ws.status });
  }

  const stockItems: {
    orderItemId: number; productName: string; colour: string | null; size: string | null;
    quantity: number; isComplete: boolean; worksheetNumber: string | null;
  }[] = [];

  type PersonGroup = {
    recipientName: string;
    employeeId: number | null;
    jobTitle: string | null;
    department: string | null;
    allComplete: boolean;
    items: { orderItemId: number; productName: string; colour: string | null; size: string | null; quantity: number; isComplete: boolean; worksheetNumber: string | null; }[];
  };

  const personMap = new Map<string, PersonGroup>();

  for (const oi of items) {
    const wsInfo = wsItemMap.get(oi.id);
    // Decorated items: complete when worksheet is done. Plain items (no worksheet): complete when stockStatus = 'complete'.
    const isComplete = wsInfo ? wsInfo.status === "complete" : oi.stockStatus === "complete";
    const entry = { orderItemId: oi.id, productName: oi.productName, colour: oi.colour, size: oi.size, quantity: oi.quantity, isComplete, worksheetNumber: wsInfo?.worksheetNumber ?? null };

    if (oi.recipientType === "person" && oi.recipientName) {
      const key = oi.recipientName;
      if (!personMap.has(key)) {
        const emp = oi.recipientEmployeeId ? empMap.get(oi.recipientEmployeeId) : undefined;
        personMap.set(key, { recipientType: "person" as const, recipientName: key, employeeId: oi.recipientEmployeeId ?? null, jobTitle: emp?.jobTitle ?? null, department: emp?.department ?? null, allComplete: true, items: [] });
      }
      const group = personMap.get(key)!;
      group.items.push(entry);
      if (!isComplete) group.allComplete = false;
    } else {
      stockItems.push(entry);
    }
  }

  const stockAllComplete = stockItems.length > 0 && stockItems.every((i) => i.isComplete);

  res.json({
    orderId,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    recipients: [
      ...(stockItems.length > 0 ? [{ recipientType: "stock", recipientName: null, employeeId: null, jobTitle: null, department: null, allComplete: stockAllComplete, items: stockItems }] : []),
      ...[...personMap.values()],
    ],
  });
});

// ── Consolidation candidates: other open orders for the same customer that could be merged ──
router.get("/orders/:id/consolidation-candidates", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const orderId = parsed.data.id;

  const [order] = await db.select({
    id: ordersTable.id,
    status: ordersTable.status,
    customerId: ordersTable.customerId,
    deliveryAddressId: ordersTable.deliveryAddressId,
    poNumber: ordersTable.poNumber,
  }).from(ordersTable).where(eq(ordersTable.id, orderId));

  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  // Only suggest consolidation for draft orders
  if (order.status !== "draft") { res.json([]); return; }

  // Normalise PO number: treat blank/null the same
  const normPo = (v: string | null | undefined) => (v ?? "").trim() || null;
  const thisPo = normPo(order.poNumber);

  // Find other open orders for the same customer
  const candidates = await db.execute(sql`
    SELECT
      o.id,
      o.order_number  AS "orderNumber",
      o.status,
      o.total_amount  AS "totalAmount",
      o.po_number     AS "poNumber",
      COUNT(oi.id)::int AS "itemCount"
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.customer_id = ${order.customerId}
      AND o.id != ${orderId}
      AND o.status IN ('draft', 'confirmed')
      AND (o.delivery_address_id IS NOT DISTINCT FROM ${order.deliveryAddressId ?? null})
      AND (NULLIF(TRIM(COALESCE(o.po_number, '')), '') IS NOT DISTINCT FROM ${thisPo})
    GROUP BY o.id, o.order_number, o.status, o.total_amount, o.po_number
    ORDER BY o.id DESC
  `);

  res.json(candidates.rows);
});

// ── Merge a draft order into a target order ────────────────────────────────────
// Moves all order_items from the source (draft) order into the target order,
// records the source order number in the target's absorbed_order_numbers,
// recalculates the target total, then deletes the now-empty source order.
router.post("/orders/:id/merge-into/:targetId", async (req, res): Promise<void> => {
  const parsed = z.object({
    id: z.coerce.number().int().positive(),
    targetId: z.coerce.number().int().positive(),
  }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { id: sourceId, targetId } = parsed.data;

  if (sourceId === targetId) { res.status(400).json({ error: "Cannot merge an order into itself." }); return; }

  const [sourceOrder] = await db.select({
    id: ordersTable.id,
    orderNumber: ordersTable.orderNumber,
    status: ordersTable.status,
    customerId: ordersTable.customerId,
  }).from(ordersTable).where(eq(ordersTable.id, sourceId));

  if (!sourceOrder) { res.status(404).json({ error: "Source order not found." }); return; }
  if (sourceOrder.status !== "draft") { res.status(400).json({ error: "Only draft orders can be merged." }); return; }
  const componentAllocations = await db.execute(sql`
    SELECT id FROM manufacturing_confirmed_allocations
    WHERE order_id = ${sourceId}
    LIMIT 1
  `);
  if (componentAllocations.rows.length) {
    res.status(409).json({
      error: "This order has Phase 2 component allocations and cannot be merged or deleted.",
    });
    return;
  }

  const [targetOrder] = await db.select({
    id: ordersTable.id,
    customerId: ordersTable.customerId,
    absorbedOrderNumbers: ordersTable.absorbedOrderNumbers,
  }).from(ordersTable).where(eq(ordersTable.id, targetId));

  if (!targetOrder) { res.status(404).json({ error: "Target order not found." }); return; }
  if (targetOrder.customerId !== sourceOrder.customerId) {
    res.status(400).json({ error: "Orders must belong to the same customer." }); return;
  }

  // Move all items from source → target
  await db.update(orderItemsTable)
    .set({ orderId: targetId })
    .where(eq(orderItemsTable.orderId, sourceId));

  // Record the absorbed order number on the target
  const existing = targetOrder.absorbedOrderNumbers ?? [];
  await db.update(ordersTable)
    .set({ absorbedOrderNumbers: [...existing, sourceOrder.orderNumber], updatedAt: new Date() })
    .where(eq(ordersTable.id, targetId));

  // Recalculate target total, then delete the (now-empty) source order
  await recalcOrderTotal(targetId);
  await db.delete(ordersTable).where(eq(ordersTable.id, sourceId));

  res.json({ targetId });
});

// ── Order backorders: PO lines linked to this order that are still pending ─────
router.get("/orders/:id/backorders", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const orderId = parsed.data.id;

  const rows = await db
    .select({
      id: purchaseOrderItemsTable.id,
      poId: purchaseOrderItemsTable.poId,
      poNumber: purchaseOrdersTable.poNumber,
      supplierName: purchaseOrdersTable.supplierName,
      productName: purchaseOrderItemsTable.productName,
      colour: purchaseOrderItemsTable.colour,
      size: purchaseOrderItemsTable.size,
      supplierCode: purchaseOrderItemsTable.supplierCode,
      quantityOrdered: purchaseOrderItemsTable.quantityOrdered,
      quantityDelivered: purchaseOrderItemsTable.quantityDelivered,
      estimatedDueDate: purchaseOrderItemsTable.estimatedDueDate,
      orderItemId: purchaseOrderItemsTable.orderItemId,
    })
    .from(purchaseOrderItemsTable)
    .innerJoin(purchaseOrdersTable, eq(purchaseOrderItemsTable.poId, purchaseOrdersTable.id))
    .innerJoin(orderItemsTable, eq(purchaseOrderItemsTable.orderItemId, orderItemsTable.id))
    .where(and(
      eq(orderItemsTable.orderId, orderId),
      ne(purchaseOrdersTable.status, "delivered"),
      sql`${purchaseOrderItemsTable.processStockId} IS NULL`,
      lt(purchaseOrderItemsTable.quantityDelivered, purchaseOrderItemsTable.quantityOrdered),
    ))
    .orderBy(purchaseOrderItemsTable.estimatedDueDate);

  res.json(rows.map((r) => ({ ...r, remaining: r.quantityOrdered - r.quantityDelivered })));
});

// ── Delivery Note HTML ────────────────────────────────────────────────────────
router.get("/orders/:id/delivery-note", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).send("Bad request"); return; }

  const orderId = parsed.data.id;
  const isDraft = req.query.draft === "1";
  const dispatchedIdsRaw = req.query.dispatchedItemIds ? String(req.query.dispatchedItemIds) : null;
  const dispatchedIds: number[] | null = dispatchedIdsRaw
    ? dispatchedIdsRaw.split(",").map(Number).filter(n => !isNaN(n) && n > 0)
    : null;

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) { res.status(404).send("Order not found"); return; }
  const business = await requireConfiguredBusinessIdentity({ address: true });
  // ── Guard: all production worksheets must be complete before issuing a delivery note ──
  // Skip the guard when:
  //   • isDraft is set (preview mode)
  //   • dispatchedIds are provided (explicit partial dispatch — API already validated readiness)
  //   • order is already part_shipped, shipped, or delivered (items were validated at dispatch time)
  const skipGuard = isDraft || dispatchedIds !== null || ["part_shipped", "shipped", "delivered"].includes(order.status);
  if (!skipGuard) {
    const incompleteWs = await db
      .select({ worksheetNumber: worksheetsTable.worksheetNumber, status: worksheetsTable.status })
      .from(worksheetsTable)
      .where(and(
        eq(worksheetsTable.orderId, orderId),
        inArray(worksheetsTable.status, ["pre_wip", "wip"]),
      ));

    if (incompleteWs.length > 0) {
      const wsDetails = incompleteWs
        .map(w => `${w.worksheetNumber} — ${w.status === "pre_wip" ? "Awaiting Production" : "In Production"}`)
        .join("<br>");
      res.status(409).send(`<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Delivery Note Blocked — ${order.orderNumber}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f7fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #fff; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,.1); max-width: 480px; width: 90%; padding: 2rem; }
    .icon { font-size: 2.5rem; margin-bottom: 1rem; }
    h1 { margin: 0 0 .5rem; font-size: 1.25rem; color: #1e3a5f; }
    p { margin: 0 0 1rem; color: #444; font-size: .95rem; line-height: 1.5; }
    .ws-list { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: .75rem 1rem; font-size: .875rem; color: #92400e; line-height: 1.8; }
    button { margin-top: 1.25rem; background: #1e3a5f; color: #fff; border: none; border-radius: 6px; padding: .6rem 1.25rem; font-size: .9rem; cursor: pointer; }
    button:hover { background: #16304f; }
  </style>
</head><body>
  <div class="card">
    <div class="icon">🚫</div>
    <h1>Cannot Generate Delivery Note</h1>
    <p>The delivery note for <strong>${order.orderNumber}</strong> cannot be produced until all production worksheets are marked as <strong>Complete</strong>.</p>
    <div class="ws-list"><strong>Incomplete worksheets:</strong><br>${wsDetails}</div>
    <p style="margin-top:1rem;margin-bottom:0;font-size:.85rem;color:#666;">Mark each worksheet as complete on the Production tab, then try again.</p>
    <button id="btn-close" type="button">Close</button>
  </div>
  <script src="/api/print-controls.js" defer></script>
</body></html>`);
      return;
    }
  }

  const itemRows = await db
    .select({ item: orderItemsTable, employee: customerEmployeesTable, productSku: productsTable.sku })
    .from(orderItemsTable)
    .leftJoin(customerEmployeesTable, eq(orderItemsTable.recipientEmployeeId, customerEmployeesTable.id))
    .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(eq(orderItemsTable.orderId, orderId));

  const allItems = itemRows.map(r => ({
    ...r.item,
    unitPrice: parseFloat(String(r.item.unitPrice ?? "0")),
    lineTotal: parseFloat(String(r.item.lineTotal ?? "0")),
    employee: r.employee ?? null,
    productSku: r.productSku ?? null,
  }));

  // Split into dispatched-now vs to-follow:
  //   1. Explicit dispatchedItemIds param → use those IDs
  //   2. part_shipped order with no explicit IDs → use dispatchedAt field on items
  //   3. Fully dispatched / normal → all items dispatched, none pending
  const dispatchedItems = dispatchedIds
    ? allItems.filter(i => dispatchedIds.includes(i.id))
    : order.status === "part_shipped"
      ? allItems.filter(i => i.dispatchedAt != null)
      : allItems;
  const pendingItems = dispatchedIds
    // When explicit IDs are given (fresh partial dispatch), exclude both the current
    // batch AND any items already dispatched in a prior shipment — only truly
    // outstanding (never-dispatched) items should appear in "To Follow".
    ? allItems.filter(i => !dispatchedIds.includes(i.id) && i.dispatchedAt == null)
    : order.status === "part_shipped"
      ? allItems.filter(i => i.dispatchedAt == null)
      : [];

  let customerLogoDataUrl: string | null = null;
  let customerPostalAddress: string | null = null;
  let customerPostalCity: string | null = null;
  let customerPostalPostcode: string | null = null;
  let customerContactName: string | null = null;
  let customerPhone: string | null = null;
  if (order.customerId) {
    const [cust] = await db.select({ logoUrl: customersTable.logoUrl, address: customersTable.address, city: customersTable.city, postcode: customersTable.postcode, contactFirstName: customersTable.contactFirstName, contactLastName: customersTable.contactLastName, phone: customersTable.phone })
      .from(customersTable).where(eq(customersTable.id, order.customerId));
    if (cust?.logoUrl) {
      customerLogoDataUrl = await fetchLogoDataUrl(cust.logoUrl).catch(() => null);
    }
    customerPostalAddress = cust?.address ?? null;
    customerPostalCity = cust?.city ?? null;
    customerPostalPostcode = cust?.postcode ?? null;
    customerContactName = [cust?.contactFirstName, cust?.contactLastName].filter(Boolean).join(" ") || null;
    customerPhone = cust?.phone ?? null;
  }

  let deliveryAddress: { line1: string | null; line2: string | null; city: string | null; county: string | null; postcode: string | null; country: string | null } | null = null;
  if (order.deliveryAddressId) {
    const [addr] = await db.select().from(customerDeliveryAddressesTable)
      .where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    deliveryAddress = addr ?? null;
  }
  if (!deliveryAddress) {
    // Fall back to employee-level delivery address if all employees share the same one
    const empAddrIds = [...new Set(allItems.map(i => (i.employee as any)?.deliveryAddressId as number | null).filter((id): id is number => id != null))];
    if (empAddrIds.length === 1) {
      const [addr] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, empAddrIds[0]));
      deliveryAddress = addr ?? null;
    }
  }
  deliveryAddress ??= await getDefaultSavedDeliveryAddress(order.customerId);

  // Multi-address: group items by their effective delivery address ID
  const getEffAddrId = (item: typeof allItems[0]): number | null =>
    (item.employee as any)?.deliveryAddressId ?? order.deliveryAddressId ?? null;

  const addrGroupMap = new Map<number | null, { dispItems: typeof allItems; pendItems: typeof allItems }>();
  for (const item of [...dispatchedItems, ...pendingItems]) {
    const id = getEffAddrId(item);
    if (!addrGroupMap.has(id)) addrGroupMap.set(id, { dispItems: [], pendItems: [] });
  }
  for (const item of dispatchedItems) { addrGroupMap.get(getEffAddrId(item))!.dispItems.push(item); }
  for (const item of pendingItems) { addrGroupMap.get(getEffAddrId(item))!.pendItems.push(item); }
  const isMultiAddr = addrGroupMap.size > 1;

  // Fetch all delivery addresses referenced across all groups
  const dnAddrById = new Map<number, typeof deliveryAddress>();
  {
    const idsNeeded = [...new Set([...addrGroupMap.keys()].filter((id): id is number => id != null && id > 0))];
    if (idsNeeded.length > 0) {
      const fetched = await db.select().from(customerDeliveryAddressesTable).where(inArray(customerDeliveryAddressesTable.id, idsNeeded));
      for (const a of fetched) dnAddrById.set(a.id, a as typeof deliveryAddress);
    }
  }
  if (deliveryAddress && order.deliveryAddressId) dnAddrById.set(order.deliveryAddressId, deliveryAddress);

  const backorderMap = new Map<number, { estimatedDueDate: string | null }>();
  if (pendingItems.length > 0) {
    const pendingIds = pendingItems.map(i => i.id);
    const boRows = await db
      .select({
        orderItemId: purchaseOrderItemsTable.orderItemId,
        estimatedDueDate: purchaseOrderItemsTable.estimatedDueDate,
        quantityOrdered: purchaseOrderItemsTable.quantityOrdered,
        quantityDelivered: purchaseOrderItemsTable.quantityDelivered,
      })
      .from(purchaseOrderItemsTable)
      .innerJoin(purchaseOrdersTable, eq(purchaseOrderItemsTable.poId, purchaseOrdersTable.id))
      .where(and(
        inArray(purchaseOrderItemsTable.orderItemId, pendingIds),
        ne(purchaseOrdersTable.status, "delivered"),
        sql`${purchaseOrderItemsTable.processStockId} IS NULL`,
        lt(purchaseOrderItemsTable.quantityDelivered, purchaseOrderItemsTable.quantityOrdered),
      ));
    for (const bo of boRows) {
      if (bo.orderItemId != null) backorderMap.set(bo.orderItemId, { estimatedDueDate: bo.estimatedDueDate });
    }
  }

  const SHIPPING_LABELS: Record<string, string> = {
    free_local: "Free Local Delivery", local_delivery: "Local Delivery",
    office_collection: "Office Collection", warehouse_collection: "Warehouse Collection",
    courier: "Courier", dpd: "DPD Courier",
  };
  const shippingLabel = order.shippingMethod ? (SHIPPING_LABELS[order.shippingMethod] ?? order.shippingMethod) : null;

  const fmtDate = (d: Date | string | null | undefined) =>
    d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

  const empName = (item: typeof allItems[0]) => {
    if (item.employee) return [item.employee.firstName, item.employee.lastName].filter(Boolean).join(" ");
    return item.recipientName ?? null;
  };

  const isNamed = (item: typeof allItems[0]) =>
    item.recipientType === "person" && !!(item.recipientName || item.recipientEmployeeId);

  const renderRow = (item: typeof allItems[0]) =>
    `<tr>
      <td style="padding:5px 10px;border-bottom:1px solid #e5e7eb;font-size:10pt;">${item.productName}${item.finishName ? ` <span style="color:#4f46e5;font-size:8.5pt;">(${item.finishName})</span>` : ""}${item.productSku ? `<br><span style="font-family:monospace;font-size:8pt;color:#4338ca;">${item.productSku}</span>` : ""}</td>
      <td style="padding:5px 10px;border-bottom:1px solid #e5e7eb;font-size:10pt;">${item.colour ?? "—"}</td>
      <td style="padding:5px 10px;border-bottom:1px solid #e5e7eb;font-size:10pt;">${item.size ?? "—"}</td>
      <td style="padding:5px 10px;border-bottom:1px solid #e5e7eb;font-size:10pt;text-align:center;font-weight:700;">${item.quantity}</td>
    </tr>`;

  // Per-address sheet builder (used for both single and multi-address modes)
  const buildSheetHtml = (effAddrId: number | null, dispItems: typeof allItems, pendItems: typeof allItems): string => {
    const addrObj = effAddrId != null ? dnAddrById.get(effAddrId) : null;
    const effAddrLines = addrObj
      ? [addrObj.line1, addrObj.line2, addrObj.city, (addrObj as any).county ?? null, addrObj.postcode, addrObj.country].filter((x): x is string => !!x)
      : [customerPostalAddress, customerPostalCity, customerPostalPostcode].filter((x): x is string => !!x);
    const addrLabelLine = addrObj && (addrObj as any).label ? `<br><em style="color:#6b7280;font-size:9pt;">${(addrObj as any).label}</em>` : "";
    const dtBlock = `<strong>${order.customerName ?? ""}</strong>${effAddrLines.length > 0 ? "<br>" + effAddrLines.join("<br>") + addrLabelLine : `<br><em style="color:#aaa">No delivery address</em>`}`;

    const rGroups = new Map<string, { name: string; jobTitle: string | null; items: typeof allItems }>();
    const sItems: typeof allItems = [];
    for (const item of dispItems) {
      if (isNamed(item)) {
        const name = empName(item) ?? "Unknown";
        if (!rGroups.has(name)) rGroups.set(name, { name, jobTitle: item.employee?.jobTitle ?? null, items: [] });
        rGroups.get(name)!.items.push(item);
      } else { sItems.push(item); }
    }
    const gRows = [...rGroups.values()].map(g =>
      `<tr style="background:#e8edf5;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
        <td colspan="4" style="padding:5px 10px;font-size:10pt;border-bottom:1px solid #ccd5e0;font-weight:700;">${g.name}${g.jobTitle ? ` <span style="font-weight:normal;font-size:9pt;color:#555;"> — ${g.jobTitle}</span>` : ""}</td>
      </tr>
      ${g.items.map(renderRow).join("")}`
    ).join("");
    const sRows = sItems.length > 0
      ? `<tr style="background:#e8edf5;-webkit-print-color-adjust:exact;print-color-adjust:exact;"><td colspan="4" style="padding:5px 10px;font-size:10pt;border-bottom:1px solid #ccd5e0;font-weight:700;">General Stock</td></tr>${sItems.map(renderRow).join("")}`
      : "";
    const totQty = dispItems.reduce((s, i) => s + i.quantity, 0);
    const isPart = dispatchedIds !== null || pendItems.length > 0;

    const toFollow = pendItems.length > 0 ? `
      <div style="margin-top:22px;border:2px solid #f59e0b;border-radius:6px;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact;page-break-inside:avoid;break-inside:avoid;">
        <div style="background:#f59e0b;padding:8px 14px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
          <span style="font-size:11pt;font-weight:900;color:#fff;letter-spacing:.06em;text-transform:uppercase;">Items To Follow</span>
          <span style="font-size:9pt;color:#fff;opacity:.9;margin-left:12px;">Outstanding items — will be dispatched as soon as they are available</span>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#fffbeb;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
              <th style="padding:6px 10px;text-align:left;font-size:8pt;color:#92400e;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #fde68a;">Item</th>
              <th style="padding:6px 10px;text-align:left;font-size:8pt;color:#92400e;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #fde68a;">Colour</th>
              <th style="padding:6px 10px;text-align:left;font-size:8pt;color:#92400e;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #fde68a;">Size</th>
              <th style="padding:6px 10px;text-align:center;font-size:8pt;color:#92400e;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #fde68a;">Qty O/S</th>
              <th style="padding:6px 10px;text-align:left;font-size:8pt;color:#92400e;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #fde68a;">Est. Due</th>
              <th style="padding:6px 10px;text-align:left;font-size:8pt;color:#92400e;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #fde68a;">Named Wearer</th>
            </tr>
          </thead>
          <tbody>
            ${pendItems.map(item => {
              const bo = backorderMap.get(item.id);
              const recipient = empName(item);
              return `<tr>
                <td style="padding:5px 10px;border-bottom:1px solid #fef3c7;font-size:10pt;">${item.productName}${item.finishName ? ` <span style="color:#4f46e5;font-size:8.5pt;">(${item.finishName})</span>` : ""}${(item as any).productSku ? `<br><span style="font-family:monospace;font-size:8pt;color:#4338ca;">${(item as any).productSku}</span>` : ""}</td>
                <td style="padding:5px 10px;border-bottom:1px solid #fef3c7;font-size:10pt;">${item.colour ?? "—"}</td>
                <td style="padding:5px 10px;border-bottom:1px solid #fef3c7;font-size:10pt;">${item.size ?? "—"}</td>
                <td style="padding:5px 10px;border-bottom:1px solid #fef3c7;font-size:10pt;text-align:center;font-weight:700;">${item.quantity}</td>
                <td style="padding:5px 10px;border-bottom:1px solid #fef3c7;font-size:10pt;">${bo?.estimatedDueDate ? fmtDate(bo.estimatedDueDate) : "<em style='color:#aaa'>TBC</em>"}</td>
                <td style="padding:5px 10px;border-bottom:1px solid #fef3c7;font-size:10pt;">${recipient ?? "—"}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>` : "";

    return `
      ${isDraft ? `<div style="background:#dc2626;color:white;text-align:center;font-size:11pt;font-weight:900;letter-spacing:.14em;padding:7px 0;-webkit-print-color-adjust:exact;print-color-adjust:exact;">DRAFT — PARTIAL DISPATCH — NOT ALL ITEMS INCLUDED</div>` : ""}
      <div style="background:#1e293b;padding:16px 28px;display:flex;align-items:center;justify-content:space-between;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
        ${sbsLogoHtml}
        <div style="text-align:center;">
          <div style="font-size:14pt;font-weight:900;color:white;letter-spacing:.08em;text-transform:uppercase;">Delivery Note</div>
          <div style="font-size:9pt;color:#94a3b8;margin-top:2px;font-family:monospace;">${order.orderNumber}</div>
        </div>
        ${custLogoHtml}
      </div>
      <div style="background:#1e3a5f;padding:10px 0 10px 18px;display:flex;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
        ${infoStripCols}
      </div>
      <div style="padding:18px 28px 0;">
        <div style="display:flex;gap:32px;margin-bottom:16px;">
          <div style="flex:1;">
            <div style="font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:5px;">Deliver To</div>
            <p style="font-size:10pt;line-height:1.6;">${dtBlock}</p>
          </div>
          <div style="flex:1;">
            <div style="font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:5px;">${escapeHtml(business.name)}</div>
            <p style="font-size:9pt;line-height:1.6;color:#555;">${escapeHtml(business.address)}<br>${escapeHtml(business.email)}<br>${escapeHtml(business.phone)}</p>
          </div>
        </div>
        ${isPart ? `<div style="background:#1e293b;padding:7px 10px;margin-bottom:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;"><span style="font-size:10.5pt;font-weight:900;color:white;letter-spacing:.04em;text-transform:uppercase;">Items Delivered Now</span></div>` : ""}
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#1e293b;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
              <th style="padding:7px 10px;text-align:left;font-size:8.5pt;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;">Item</th>
              <th style="padding:7px 10px;text-align:left;font-size:8.5pt;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;">Colour</th>
              <th style="padding:7px 10px;text-align:left;font-size:8.5pt;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;">Size</th>
              <th style="padding:7px 10px;text-align:center;font-size:8.5pt;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;">Qty</th>
            </tr>
          </thead>
          <tbody>
            ${gRows}
            ${sRows}
            <tr style="border-top:2px solid #1e293b;">
              <td colspan="3" style="padding:7px 10px;text-align:right;font-weight:700;font-size:10pt;">Total Items</td>
              <td style="padding:7px 10px;text-align:center;font-weight:900;font-size:13pt;">${totQty}</td>
            </tr>
          </tbody>
        </table>
        ${toFollow}
        <div style="margin-top:22px;display:flex;gap:40px;">
          <div style="flex:1;border-top:1px solid #999;padding-top:5px;font-size:9pt;color:#555;">Packed by: ______________________</div>
          <div style="flex:1;border-top:1px solid #999;padding-top:5px;font-size:9pt;color:#555;">Checked by: ______________________</div>
          <div style="flex:1;border-top:1px solid #999;padding-top:5px;font-size:9pt;color:#555;">Date: ______________________</div>
        </div>
        ${shippingLabel ? `
        <div style="margin-top:18px;background:#0f172a;border-radius:6px;padding:10px 18px;display:flex;align-items:center;gap:16px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
          <span style="font-size:7pt;font-weight:900;text-transform:uppercase;letter-spacing:.12em;color:#64748b;flex-shrink:0;">Delivery Method</span>
          <span style="font-size:15pt;font-weight:900;color:#fff;letter-spacing:.02em;">${shippingLabel}</span>
        </div>` : ""}
        <div style="margin-top:14px;margin-bottom:20px;font-size:8pt;color:#aaa;border-top:1px solid #e5e7eb;padding-top:8px;text-align:center;">
          Please check contents carefully. Any discrepancies should be reported within 48 hours of receipt.${pendItems.length > 0 ? " Outstanding items will be dispatched as soon as they become available." : ""}<br>
          ${escapeHtml(business.name)} · ${escapeHtml(business.address)} · ${escapeHtml(business.email)} · ${escapeHtml(business.phone)}
        </div>
      </div>`;
  };

  const infoCols: { label: string; value: string }[] = [
    { label: "Order Date", value: fmtDate(order.orderDate) },
    { label: "Required By", value: fmtDate(order.requiredDate) },
    { label: "Dispatched",  value: fmtDate(new Date()) },
    { label: "Order Ref",   value: order.orderNumber },
  ];
  if (order.poNumber) infoCols.push({ label: "PO Number", value: order.poNumber });
  if (shippingLabel) infoCols.push({ label: "Delivery", value: shippingLabel });
  if (order.trackingNumber && order.shippingMethod === "dpd") infoCols.push({ label: "Tracking", value: order.trackingNumber });

  const infoStripCols = infoCols.map(col =>
    `<div style="flex:1;padding:0 10px;border-right:1px solid rgba(255,255,255,.15);">
      <div style="font-size:7pt;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;">${col.label}</div>
      <div style="font-size:9.5pt;font-weight:700;color:white;margin-top:2px;">${col.value}</div>
    </div>`
  ).join("");

  const sbsLogoHtml = SBS_LOGO_DATA_URL
    ? `<img src="${SBS_LOGO_DATA_URL}" alt="${escapeHtml(business.name)}" style="height:44px;width:auto;display:block;" />`
    : `<span style="font-size:15pt;font-weight:900;color:white;">${escapeHtml(business.name)}</span>`;

  const custLogoHtml = customerLogoDataUrl
    ? `<img src="${customerLogoDataUrl}" alt="${(order.customerName ?? "").replace(/"/g, "&quot;")}" style="height:44px;width:auto;max-width:130px;display:block;" />`
    : `<span></span>`;

  // Build sheet(s): one per address group (single sheet for single-address orders)
  // For single-address: use the effective address id from the map (may be an employee address)
  const singleEffAddrId: number | null = !isMultiAddr
    ? (([...addrGroupMap.keys()][0] as number | null | undefined) ?? null)
    : null;
  const sheetsHtml = isMultiAddr
    ? [...addrGroupMap.entries()].map(([effId, { dispItems, pendItems }]) =>
        `<div style="background:white;width:210mm;box-shadow:0 4px 24px rgba(0,0,0,.15);">${buildSheetHtml(effId as number | null, dispItems, pendItems)}</div>`
      ).join("")
    : `<div id="sheet">${buildSheetHtml(
        singleEffAddrId !== null && singleEffAddrId > 0 ? singleEffAddrId : null,
        dispatchedItems, pendingItems
      )}</div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${isDraft ? "DRAFT " : ""}Delivery Note — ${order.orderNumber}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{margin:0;background:#e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#111827}
    #toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:12px;padding:10px 24px;background:#1e293b;color:white;box-shadow:0 2px 8px rgba(0,0,0,.3)}
    #toolbar .title{flex:1;font-size:14px;font-weight:600}
    #toolbar button{padding:7px 22px;border:none;border-radius:5px;font-size:13px;font-weight:700;cursor:pointer}
    #btn-print{background:#22c55e;color:white}
    #btn-close{background:rgba(255,255,255,.15);color:white}
    #page{display:flex;flex-direction:column;align-items:center;gap:24px;padding:28px 0 48px}
    #sheet{background:white;width:210mm;box-shadow:0 4px 24px rgba(0,0,0,.15)}
    @media print{
      #toolbar{display:none}
      body{background:white}
      #page{padding:0;gap:0}
      #sheet,#page>div{box-shadow:none;width:100%;page-break-after:always}
      #sheet:last-child,#page>div:last-child{page-break-after:avoid}
      @page{size:A4;margin:12mm}
      *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    }
  </style>
</head>
<body>
  <div id="toolbar">
    <span class="title">📄 ${isDraft ? "DRAFT — " : ""}Delivery Note · ${order.orderNumber} · ${(order.customerName ?? "").replace(/</g, "&lt;")}${isMultiAddr ? ` · ${addrGroupMap.size} addresses` : ""}</span>
    <button id="btn-box" data-label-url="/api/orders/${orderId}/shipping-label" style="background:#f59e0b;color:white">🏷 Print Box Label</button>
    <button id="btn-print">🖨 Print Delivery Note</button>
    <button id="btn-close">✕ Close</button>
  </div>
  <div id="page">
    ${sheetsHtml}
  </div>
  <script src="/api/print-controls.js" defer></script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(html);
});

const WEARER_LOGO_HTML = `<span style="font-weight:700">Order document</span>`;

function renderWearerItemTable(items: Array<{
  productName: string; colour: string | null; size: string | null;
  quantity: number; finishName: string | null; productSku?: string | null;
}>) {
  return `
    <table class="items-table">
      <thead><tr>
        <th class="col-product">Item</th>
        <th class="col-code">SKU</th>
        <th class="col-colour">Colour</th>
        <th class="col-size">Size</th>
        <th class="col-qty">Qty</th>
      </tr></thead>
      <tbody>
        ${items.map(item => `<tr>
          <td class="col-product">${item.productName}${item.finishName ? `<br><span class="finish-sub">${item.finishName}</span>` : ""}</td>
          <td class="col-code">${item.productSku ?? "\u2014"}</td>
          <td class="col-colour">${item.colour ?? "\u2014"}</td>
          <td class="col-size">${item.size ?? "\u2014"}</td>
          <td class="col-qty">${item.quantity}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

// ── Standalone box / shipping label (4×3 in) ─────────────────────────────────
router.get("/orders/:id/shipping-label", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).send("Bad request"); return; }

  const orderId = parsed.data.id;
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) { res.status(404).send("Order not found"); return; }

  const SHIPPING_LABELS: Record<string, string> = {
    free_local: "Free Local Delivery", local_delivery: "Local Delivery",
    office_collection: "Office Collection", warehouse_collection: "Warehouse Collection",
    courier: "Courier", dpd: "DPD Courier",
  };
  const shippingMethodLabel = order.shippingMethod ? (SHIPPING_LABELS[order.shippingMethod] ?? order.shippingMethod) : "Not specified";
  const isDpd = !!order.shippingMethod?.toLowerCase().includes("dpd");

  let deliveryAddress: { line1: string | null; line2: string | null; city: string | null; postcode: string | null; country: string | null; notes: string | null } | null = null;
  let customerContact: { contactFirstName: string | null; contactLastName: string | null; phone: string | null; address: string | null; city: string | null; postcode: string | null } | null = null;

  if (order.deliveryAddressId) {
    const [addr] = await db.select().from(customerDeliveryAddressesTable)
      .where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    deliveryAddress = addr ?? null;
  }
  if (!deliveryAddress) {
    const empRows = await db.select({ deliveryAddressId: (customerEmployeesTable as any).deliveryAddressId })
      .from(orderItemsTable)
      .innerJoin(customerEmployeesTable, eq(orderItemsTable.recipientEmployeeId, customerEmployeesTable.id))
      .where(eq(orderItemsTable.orderId, orderId));
    const empAddrIds = [...new Set(empRows.map((e: any) => e.deliveryAddressId as number | null).filter((id): id is number => id != null))];
    if (empAddrIds.length === 1) {
      const [addr] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, empAddrIds[0]));
      deliveryAddress = addr ?? null;
    }
  }
  deliveryAddress ??= await getDefaultSavedDeliveryAddress(order.customerId);
  if (order.customerId) {
    const [cust] = await db.select({
      contactFirstName: customersTable.contactFirstName,
      contactLastName: customersTable.contactLastName,
      phone: customersTable.phone,
      address: customersTable.address,
      city: customersTable.city,
      postcode: customersTable.postcode,
    }).from(customersTable).where(eq(customersTable.id, order.customerId));
    customerContact = cust ?? null;
  }

  const addrLines = deliveryAddress
    ? [deliveryAddress.line1, deliveryAddress.line2, deliveryAddress.city, deliveryAddress.postcode, deliveryAddress.country].filter(Boolean)
    : [customerContact?.address, customerContact?.city, customerContact?.postcode].filter(Boolean);

  const contactName = [customerContact?.contactFirstName, customerContact?.contactLastName].filter(Boolean).join(" ") || null;
  const contactPhone = customerContact?.phone || null;

  const numBoxes = Math.max(1, order.numberOfBoxes ?? 1);

  const buildLabel = (boxNum: number) => `<div class="label delivery-label">
    <div class="dl-header">
      <span class="dl-badge">BOX LABEL${numBoxes > 1 ? ` · ${boxNum} of ${numBoxes}` : ""}</span>
      <span class="dl-order">${order.orderNumber}</span>
    </div>
    <div class="dl-customer">${order.customerName ?? ""}</div>
    <div class="dl-divider"></div>
    <div class="dl-row"><span class="dl-key">Delivery</span><span class="dl-val">${shippingMethodLabel}</span></div>
    ${isDpd && order.trackingNumber ? `<div class="dl-row"><span class="dl-key">DPD</span><span class="dl-val dl-tracking">${order.trackingNumber}</span></div>` : ""}
    ${order.poNumber ? `<div class="dl-row"><span class="dl-key">PO Ref</span><span class="dl-val">${order.poNumber}</span></div>` : ""}
    ${contactName ? `<div class="dl-row"><span class="dl-key">Contact</span><span class="dl-val">${contactName}</span></div>` : ""}
    ${contactPhone ? `<div class="dl-row"><span class="dl-key">Phone</span><span class="dl-val">${contactPhone}</span></div>` : ""}
    ${addrLines.length > 0 ? `<div class="dl-addr-block">${addrLines.map(l => `<div>${l}</div>`).join("")}</div>` : ""}
  </div>`;

  const labelHtml = Array.from({ length: numBoxes }, (_, i) => buildLabel(i + 1)).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Box Label — ${order.orderNumber}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;background:#e5e7eb;color:#000}
    #toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:16px;padding:10px 20px;background:#1e3a5f;color:white;box-shadow:0 2px 6px rgba(0,0,0,.3)}
    #toolbar-text{flex:1}
    #toolbar-title{font-size:14px;font-weight:700}
    #toolbar-sub{font-size:12px;opacity:.8;margin-top:2px}
    #toolbar button{padding:7px 20px;border:none;border-radius:5px;font-size:13px;font-weight:700;cursor:pointer}
    #btn-print{background:#22c55e;color:white}
    #btn-close{background:rgba(255,255,255,.15);color:white;margin-left:4px}
    #page{padding:20px;display:flex;flex-direction:column;gap:16px;align-items:center}
    .label{width:4in;height:3in;background:white;border:1px solid #999;border-radius:3px;box-shadow:0 2px 6px rgba(0,0,0,.15);overflow:hidden}
    .delivery-label{display:flex;flex-direction:column;padding:0}
    .dl-header{background:white;color:#000;padding:0.1in 0.2in 0.08in;display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #000}
    .dl-badge{font-size:8pt;font-weight:900;letter-spacing:.08em;text-transform:uppercase}
    .dl-order{font-size:11pt;font-weight:900;font-family:monospace}
    .dl-customer{font-size:18pt;font-weight:900;color:#000;padding:0.08in 0.2in 0.04in;line-height:1.1;word-break:break-word}
    .dl-divider{border-top:1.5px solid #000;margin:0 0.2in 0.06in}
    .dl-row{display:flex;align-items:baseline;gap:8px;padding:0.03in 0.2in}
    .dl-key{font-size:7pt;color:#000;text-transform:uppercase;letter-spacing:.06em;width:0.7in;flex-shrink:0;font-weight:700}
    .dl-val{font-size:10pt;font-weight:600;color:#000}
    .dl-tracking{font-family:monospace;font-size:10pt}
    .dl-addr-block{font-size:9pt;color:#000;font-weight:600;padding:0.06in 0.2in 0;line-height:1.4}
    @media print{
      @page{size:4in 3in landscape;margin:0mm}
      html,body{margin:0!important;padding:0!important;width:4in}
      #toolbar{display:none}
      body{background:white}
      #page{padding:0;gap:0;margin:0;align-items:flex-start}
      .label{width:4in;min-height:3in;height:auto;border:none;border-radius:0;box-shadow:none;page-break-after:always;overflow:visible}
    }
  </style>
</head>
<body>
  <div id="toolbar">
    <div id="toolbar-text">
      <div id="toolbar-title">📦 Box Label${numBoxes > 1 ? ` (${numBoxes} copies)` : ""} · ${(order.customerName ?? order.orderNumber).replace(/</g, "&lt;")} · ${order.orderNumber}</div>
      <div id="toolbar-sub">⚠️ Paper: <strong>User defined 4×3 in</strong> · Orientation: <strong>Landscape</strong> · Margins: None (GC420d)</div>
    </div>
    <button id="btn-print" type="button">🖨 Print Label</button>
    <button id="btn-close" type="button">✕ Close</button>
  </div>
  <div id="page">${labelHtml}</div>
  <script src="/api/print-controls.js" defer></script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(html);
});

// ── Wearer Labels HTML ────────────────────────────────────────────────────────
router.get("/orders/:id/wearer-labels", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).send("Bad request"); return; }

  const orderId = parsed.data.id;
  const dispatchedIdsRaw = req.query.dispatchedItemIds ? String(req.query.dispatchedItemIds) : null;
  const dispatchedIds: number[] | null = dispatchedIdsRaw
    ? dispatchedIdsRaw.split(",").map(Number).filter(n => !isNaN(n) && n > 0)
    : null;
  const includeDeliveryLabel = req.query.includeDeliveryLabel === "1";
  const recipientFilter = req.query.recipient ? String(req.query.recipient).trim() : null;
  const allowWearerReprint = req.query.reprint === "1";

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) { res.status(404).send("Order not found"); return; }
  const useDepartmentOnLabels = order.customerId != null && await isManagerPackingEnabled(order.customerId);

  const itemRows = await db
    .select({ item: orderItemsTable, employee: customerEmployeesTable, productSku: productsTable.sku, isService: productsTable.isService })
    .from(orderItemsTable)
    .leftJoin(customerEmployeesTable, eq(orderItemsTable.recipientEmployeeId, customerEmployeesTable.id))
    .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(eq(orderItemsTable.orderId, orderId));

  const allItems = itemRows.map(r => ({
    ...r.item,
    unitPrice: parseFloat(String(r.item.unitPrice ?? "0")),
    lineTotal:  parseFloat(String(r.item.lineTotal ?? "0")),
    employee: r.employee ?? null,
    productSku: r.productSku ?? null,
    isService: r.isService ?? false,
  }));

  const dispatchedItems = dispatchedIds ? allItems.filter(i => dispatchedIds.includes(i.id)) : allItems;
  // Service items (e.g. "Logo Conversion to Stitches") are never physical goods — exclude them
  // from "Items to Follow" as they cannot be delivered separately.
  const pendingItems    = dispatchedIds ? allItems.filter(i => !dispatchedIds.includes(i.id) && !i.isService) : [];

  let deliveryAddress: { line1: string | null; line2: string | null; city: string | null; postcode: string | null; country: string | null; notes: string | null } | null = null;
  let customerContact: { contactFirstName: string | null; contactLastName: string | null; phone: string | null; address: string | null; city: string | null; postcode: string | null } | null = null;
  if (includeDeliveryLabel && order.deliveryAddressId) {
    const [addr] = await db.select().from(customerDeliveryAddressesTable)
      .where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    deliveryAddress = addr ?? null;
  }
  if (includeDeliveryLabel && !deliveryAddress) {
    const empAddrIds = [...new Set(
      allItems
        .map(item => (item.employee as any)?.deliveryAddressId as number | null)
        .filter((id): id is number => id != null),
    )];
    if (empAddrIds.length === 1) {
      const [addr] = await db.select().from(customerDeliveryAddressesTable)
        .where(eq(customerDeliveryAddressesTable.id, empAddrIds[0]));
      deliveryAddress = addr ?? null;
    }
  }
  if (includeDeliveryLabel) {
    deliveryAddress ??= await getDefaultSavedDeliveryAddress(order.customerId);
  }
  if (includeDeliveryLabel && order.customerId) {
    const [cust] = await db.select({
      contactFirstName: customersTable.contactFirstName,
      contactLastName: customersTable.contactLastName,
      phone: customersTable.phone,
      address: customersTable.address,
      city: customersTable.city,
      postcode: customersTable.postcode,
    }).from(customersTable).where(eq(customersTable.id, order.customerId));
    customerContact = cust ?? null;
  }

  const SHIPPING_LABELS: Record<string, string> = {
    free_local: "Free Local Delivery", local_delivery: "Local Delivery",
    office_collection: "Office Collection", warehouse_collection: "Warehouse Collection",
    courier: "Courier", dpd: "DPD Courier",
  };
  const shippingMethodLabel = order.shippingMethod ? (SHIPPING_LABELS[order.shippingMethod] ?? order.shippingMethod) : "Not specified";
  const isDpd = !!order.shippingMethod?.toLowerCase().includes("dpd");

  const empName = (item: typeof allItems[0]) => {
    if (item.employee) return [item.employee.firstName, item.employee.lastName].filter(Boolean).join(" ");
    return item.recipientName ?? null;
  };
  const isNamed = (item: typeof allItems[0]) =>
    item.recipientType === "person" && !!(item.recipientName || item.recipientEmployeeId);

  // Group dispatched items by a stable wearer key so employees with the same
  // display name retain separate labels and print histories.
  const wearerMap = new Map<string, { wearerKey: string; name: string; jobTitle: string | null; department: string | null; items: typeof allItems }>();
  for (const item of dispatchedItems.filter(isNamed)) {
    const name = empName(item) ?? "Unknown";
    const wearerKey = item.recipientEmployeeId != null
      ? `employee:${item.recipientEmployeeId}`
      : `name:${name.trim().toLowerCase().replace(/\s+/g, " ")}`;
    if (!wearerMap.has(wearerKey)) wearerMap.set(wearerKey, { wearerKey, name, jobTitle: item.employee?.jobTitle ?? null, department: item.employee?.department ?? null, items: [] });
    wearerMap.get(wearerKey)!.items.push(item);
  }

  // Group pending items by the same wearer key (for "Items to Follow").
  const pendingWearerMap = new Map<string, typeof allItems>();
  for (const item of pendingItems.filter(isNamed)) {
    const name = empName(item) ?? "Unknown";
    const wearerKey = item.recipientEmployeeId != null
      ? `employee:${item.recipientEmployeeId}`
      : `name:${name.trim().toLowerCase().replace(/\s+/g, " ")}`;
    if (!pendingWearerMap.has(wearerKey)) pendingWearerMap.set(wearerKey, []);
    pendingWearerMap.get(wearerKey)!.push(item);
  }

  // Filter to a single recipient when ?recipient= is provided
  if (recipientFilter) {
    for (const [key, wearer] of wearerMap) {
      if (wearer.name !== recipientFilter) wearerMap.delete(key);
    }
    if (wearerMap.size === 0) {
      res.status(400).send(`No label found for recipient "${recipientFilter}".`);
      return;
    }
  }

  if (!allowWearerReprint && wearerMap.size > 0) {
    const priorPrints = await db.execute(sql`
      SELECT DISTINCT wearer_key
      FROM order_label_prints
      WHERE order_id = ${orderId}
        AND label_type = 'wearer'
    `);
    const printedKeys = new Set((priorPrints.rows as Array<{ wearer_key: string }>).map((row) => row.wearer_key));
    for (const key of wearerMap.keys()) {
      if (printedKeys.has(key)) wearerMap.delete(key);
    }
  }

  if (wearerMap.size === 0 && !includeDeliveryLabel) {
    res.status(400).send("No named recipients found for wearer labels.");
    return;
  }

  const logoHtml = WEARER_LOGO_HTML;

  const renderItemTable = (items: typeof allItems) => renderWearerItemTable(items as any);

  const labels: string[] = [];

  // ── Delivery label (first, when requested) ────────────────────────────────
  if (includeDeliveryLabel) {
    const addrLines = deliveryAddress
      ? [deliveryAddress.line1, deliveryAddress.line2, deliveryAddress.city, deliveryAddress.postcode, deliveryAddress.country].filter(Boolean)
      : [customerContact?.address, customerContact?.city, customerContact?.postcode].filter(Boolean);
    const contactName = [customerContact?.contactFirstName, customerContact?.contactLastName].filter(Boolean).join(" ") || null;
    const contactPhone = customerContact?.phone || null;
    labels.push(`<div class="label delivery-label">
      <div class="dl-header">
        <span class="dl-badge">DELIVERY LABEL</span>
        <span class="dl-order">${order.orderNumber}</span>
      </div>
      <div class="dl-customer">${order.customerName ?? ""}</div>
      <div class="dl-divider"></div>
      <div class="dl-row"><span class="dl-key">Delivery method</span><span class="dl-val">${shippingMethodLabel}</span></div>
      ${isDpd ? `<div class="dl-row"><span class="dl-key">DPD tracking</span><span class="dl-val dl-tracking">${order.trackingNumber ?? "To be assigned"}</span></div>` : ""}
      ${contactName ? `<div class="dl-row"><span class="dl-key">Contact</span><span class="dl-val">${contactName}</span></div>` : ""}
      ${contactPhone ? `<div class="dl-row"><span class="dl-key">Phone</span><span class="dl-val">${contactPhone}</span></div>` : ""}
      ${addrLines.length > 0 ? `<div class="dl-addr-block">${addrLines.map(l => `<div>${l}</div>`).join("")}</div>` : ""}
    </div>`);
  }

  // ── One label per named wearer ────────────────────────────────────────────
  for (const [wearerKey, wearer] of wearerMap) {
    const pending = pendingWearerMap.get(wearerKey);
    const followSection = pending?.length
      ? `<div class="follow-section">
          <div class="follow-heading">Items to Follow:-</div>
          ${renderItemTable(pending)}
        </div>`
      : "";
    labels.push(`<div class="label wearer-label">
      <div class="wearer-name-row">
        <div class="wearer-name">${wearer.name}</div>
      </div>
      <div class="label-sub-row">
        ${useDepartmentOnLabels ? `<strong class="job-title">${escapeHtml(wearer.department || "Department not set")}</strong>` : logoHtml}
        ${wearer.jobTitle ? `<span class="job-title">${wearer.jobTitle}</span>` : ""}
      </div>
      ${renderItemTable(wearer.items)}
      ${followSection}
      <div class="label-footer">
        <span class="footer-customer">${order.customerName ?? ""}</span>
        <span class="footer-order">${order.orderNumber}</span>
      </div>
    </div>`);
  }

  const totalCount = labels.length;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Wearer Labels — ${order.orderNumber}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;background:#e5e7eb;color:#000}
    #toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:16px;padding:10px 20px;background:#1e3a5f;color:white;box-shadow:0 2px 6px rgba(0,0,0,.3)}
    #toolbar-text{flex:1}
    #toolbar-title{font-size:14px;font-weight:700}
    #toolbar-sub{font-size:12px;opacity:.8;margin-top:2px}
    #toolbar button{padding:7px 20px;border:none;border-radius:5px;font-size:13px;font-weight:700;cursor:pointer}
    #btn-print{background:#22c55e;color:white}
    #btn-dl{background:#3b82f6;color:white;margin-left:4px}
    #btn-close{background:rgba(255,255,255,.15);color:white;margin-left:4px}
    #page{padding:20px;display:flex;flex-direction:column;gap:16px;align-items:center}

    /* ── Label shell (4×3 in) ── */
    .label{width:4in;height:3in;background:white;border:1px solid #999;border-radius:3px;box-shadow:0 2px 6px rgba(0,0,0,.15);overflow:hidden}

    /* ── Wearer label inner layout ── */
    .wearer-label{display:flex;flex-direction:column;padding:0.12in 0.18in 0.1in}
    .wearer-name-row{border-bottom:2px solid #000;padding-bottom:3px;margin-bottom:4px;width:100%}
    .wearer-name{font-size:12pt;font-weight:900;color:#000;line-height:1.2;white-space:normal;word-break:break-word;display:block;width:100%}
    .label-sub-row{display:flex;align-items:center;gap:10px;margin-bottom:4px}
    .sbs-logo{height:0.42in;width:auto;flex-shrink:0;filter:grayscale(100%) contrast(200%)}
    .job-title{font-size:8pt;color:#333}
    .follow-section{margin-top:3px}
    .follow-heading{font-size:6pt;font-weight:700;color:#000;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px;border-top:1px dashed #000;padding-top:3px}

    /* ── Items table ── */
    .items-table{width:100%;border-collapse:collapse}
    .items-table thead tr{border-bottom:1.5px solid #000}
    .items-table th{color:#000;font-size:6pt;text-transform:uppercase;letter-spacing:.04em;padding:2px 4px;text-align:left;font-weight:700}
    .items-table td{padding:2px 4px;border-bottom:0.5px solid #ccc;font-size:8pt;vertical-align:middle;color:#000}
    .col-product{width:42%}.col-code{width:13%}.col-colour{width:19%}.col-size{width:13%}
    .col-qty{width:9%;text-align:center;font-weight:700}
    .finish-sub{font-size:6pt;color:#000;font-style:italic}

    /* ── Label footer (customer + order number) ── */
    .label-footer{display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:4px;border-top:1px solid #ccc}
    .footer-customer{font-size:8pt;font-weight:700;color:#000;letter-spacing:.02em}
    .footer-order{font-size:8pt;font-weight:600;color:#555;font-family:monospace}

    /* ── Delivery label ── */
    .delivery-label{display:flex;flex-direction:column;padding:0}
    .dl-header{background:white;color:#000;padding:0.07in 0.18in 0.06in;display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #000}
    .dl-badge{font-size:7.5pt;font-weight:900;letter-spacing:.08em;text-transform:uppercase}
    .dl-order{font-size:10pt;font-weight:900;font-family:monospace}
    .dl-customer{font-size:15pt;font-weight:900;color:#000;padding:0.05in 0.18in 0.03in;line-height:1.15;word-break:break-word}
    .dl-divider{border-top:1.5px solid #000;margin:0 0.18in 0.04in}
    .dl-row{display:flex;align-items:baseline;gap:8px;padding:0.025in 0.18in}
    .dl-key{font-size:6.5pt;color:#000;text-transform:uppercase;letter-spacing:.06em;width:0.9in;flex-shrink:0;font-weight:700}
    .dl-val{font-size:9.5pt;font-weight:600;color:#000}
    .dl-tracking{font-family:monospace;font-size:9.5pt;color:#000}
    .dl-addr-block{font-size:8.5pt;color:#000;font-weight:600;padding:0.04in 0.18in 0;line-height:1.35}

    @media print{
      @page{size:4in 3in landscape;margin:0mm}
      html,body{margin:0!important;padding:0!important;width:4in}
      #toolbar{display:none}
      body{background:white}
      #page{padding:0;gap:0;margin:0;align-items:flex-start}
      .label{width:4in;height:3in;border:none;border-radius:0;box-shadow:none;overflow:hidden;page-break-after:always;break-after:page}
    }
  </style>
</head>
<body data-auto-qz="true">
  <div id="toolbar">
    <div id="toolbar-text">
      <div id="toolbar-title">🏷️ ${totalCount} Label${totalCount !== 1 ? "s" : ""} · ${(order.customerName ?? order.orderNumber).replace(/</g, "&lt;")}</div>
      <div id="toolbar-sub"><span id="_qz_status" style="font-style:italic;opacity:.85">Starting…</span></div>
    </div>
    <button id="btn-print" type="button">🖨 Print manually</button>
    <button id="btn-dl" type="button">💾 Download PDF</button>
    <button id="btn-close" type="button">✕ Close</button>
  </div>
  <div id="page">${labels.join("\n")}</div>
  <script src="/api/print-controls.js" defer></script>
</body>
</html>`;

  if (wearerMap.size > 0) {
    await db.insert(orderLabelPrintsTable).values(
      Array.from(wearerMap.values()).map((wearer) => ({
        orderId,
        labelType: "wearer",
        wearerKey: wearer.wearerKey,
        wearerName: wearer.name,
        itemIds: wearer.items.map((item) => item.id),
        actor: "Staff",
      })),
    );
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(html);
});


// ── Bulk Wearer Labels HTML (by customer name or order number) ──────────────
router.get("/wearer-labels/bulk", async (req, res): Promise<void> => {
  const customerQ = req.query.customer ? String(req.query.customer).trim() : null;
  const orderNumberQ = req.query.orderNumber ? String(req.query.orderNumber).trim() : null;

  if (!customerQ && !orderNumberQ) {
    res.status(400).send("Provide ?customer= or ?orderNumber= query parameter.");
    return;
  }

  // Find matching orders (confirmed or dispatched)
  let orderRows: typeof ordersTable.$inferSelect[] = [];
  if (orderNumberQ) {
    orderRows = await db.select().from(ordersTable)
      .where(and(
        sql`LOWER(${ordersTable.orderNumber}) = LOWER(${orderNumberQ})`,
        inArray(ordersTable.status, ["confirmed", "dispatched"]),
      ));
  } else if (customerQ) {
    orderRows = await db.select().from(ordersTable)
      .where(and(
        sql`LOWER(${ordersTable.customerName}) LIKE ${'%' + customerQ.toLowerCase() + '%'}`,
        inArray(ordersTable.status, ["confirmed", "dispatched"]),
      ));
  }

  if (orderRows.length === 0) {
    res.status(404).send(`<!DOCTYPE html><html><head><title>No Orders Found</title>
<style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f7fa}
.card{background:#fff;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.1);padding:2rem;max-width:400px;text-align:center}
h1{color:#1e3a5f;font-size:1.2rem}p{color:#555}button{margin-top:1rem;background:#1e3a5f;color:#fff;border:none;border-radius:6px;padding:.6rem 1.2rem;cursor:pointer;font-size:.9rem}</style></head>
<body><div class="card"><h1>No orders found</h1><p>No confirmed or dispatched orders matched <strong>${
  orderNumberQ ?? customerQ
}</strong>.</p><button id="btn-close" type="button">Close</button></div><script src="/api/print-controls.js" defer></script></body></html>`);
    return;
  }

  const allLabels: string[] = [];
  const orderSummaries: string[] = [];
  const managerPackingCustomerIds = new Set(await getManagerPackingCustomerIds());

  for (const order of orderRows) {
    const itemRows = await db
      .select({ item: orderItemsTable, employee: customerEmployeesTable, productSku: productsTable.sku })
      .from(orderItemsTable)
      .leftJoin(customerEmployeesTable, eq(orderItemsTable.recipientEmployeeId, customerEmployeesTable.id))
      .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
      .where(eq(orderItemsTable.orderId, order.id));

    const allItems = itemRows.map(r => ({
      ...r.item,
      unitPrice: parseFloat(String(r.item.unitPrice ?? "0")),
      lineTotal:  parseFloat(String(r.item.lineTotal ?? "0")),
      employee: r.employee ?? null,
      productSku: r.productSku ?? null,
    }));

    const empName = (item: typeof allItems[0]) => {
      if (item.employee) return [item.employee.firstName, item.employee.lastName].filter(Boolean).join(" ");
      return item.recipientName ?? null;
    };
    const isNamed = (item: typeof allItems[0]) =>
      item.recipientType === "person" && !!(item.recipientName || item.recipientEmployeeId);

    const wearerMap = new Map<string, { name: string; jobTitle: string | null; department: string | null; items: typeof allItems }>();
    for (const item of allItems.filter(isNamed)) {
      const name = empName(item) ?? "Unknown";
      if (!wearerMap.has(name)) wearerMap.set(name, { name, jobTitle: item.employee?.jobTitle ?? null, department: item.employee?.department ?? null, items: [] });
      wearerMap.get(name)!.items.push(item);
    }

    if (wearerMap.size === 0) continue;

    orderSummaries.push(`${order.orderNumber} (${wearerMap.size} wearer${wearerMap.size !== 1 ? "s" : ""})`);

    for (const [, wearer] of wearerMap) {
      allLabels.push(`<div class="label wearer-label">
      <div class="wearer-name-row">
        <div class="wearer-name">${wearer.name}</div>
      </div>
      <div class="label-sub-row">
        ${order.customerId != null && managerPackingCustomerIds.has(order.customerId)
          ? `<strong class="job-title">${escapeHtml(wearer.department || "Department not set")}</strong>`
          : WEARER_LOGO_HTML}
        ${wearer.jobTitle ? `<span class="job-title">${wearer.jobTitle}</span>` : ""}
      </div>
      ${renderWearerItemTable(wearer.items as any)}
      <div class="label-footer">
        <span class="footer-customer">${order.customerName ?? ""}</span>
        <span class="footer-order">${order.orderNumber}</span>
      </div>
    </div>`);
    }
  }

  if (allLabels.length === 0) {
    res.status(400).send("No named recipients found across the matched orders.");
    return;
  }

  const totalCount = allLabels.length;
  const summaryText = orderSummaries.join(", ");
  const titleText = orderNumberQ ?? customerQ ?? "Bulk";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Wearer Labels — ${titleText}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;background:#e5e7eb;color:#000}
    #toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:16px;padding:10px 20px;background:#1e3a5f;color:white;box-shadow:0 2px 6px rgba(0,0,0,.3)}
    #toolbar-text{flex:1}
    #toolbar-title{font-size:14px;font-weight:700}
    #toolbar-sub{font-size:12px;opacity:.8;margin-top:2px}
    #toolbar button{padding:7px 20px;border:none;border-radius:5px;font-size:13px;font-weight:700;cursor:pointer}
    #btn-print{background:#22c55e;color:white}
    #btn-close{background:rgba(255,255,255,.15);color:white;margin-left:4px}
    #page{padding:20px;display:flex;flex-direction:column;gap:16px;align-items:center}
    .label{width:4in;min-height:3in;background:white;border:1px solid #999;border-radius:3px;box-shadow:0 2px 6px rgba(0,0,0,.15);overflow:hidden}
    .wearer-label{display:flex;flex-direction:column;padding:0.12in 0.18in 0.1in}
    .wearer-name-row{border-bottom:2px solid #000;padding-bottom:3px;margin-bottom:4px;width:100%}
    .wearer-name{font-size:12pt;font-weight:900;color:#000;line-height:1.2;white-space:normal;word-break:break-word;display:block;width:100%}
    .label-sub-row{display:flex;align-items:center;gap:10px;margin-bottom:4px}
    .sbs-logo{height:0.42in;width:auto;flex-shrink:0;filter:grayscale(100%) contrast(200%)}
    .job-title{font-size:8pt;color:#333}
    .items-table{width:100%;border-collapse:collapse}
    .items-table thead tr{border-bottom:1.5px solid #000}
    .items-table th{color:#000;font-size:6pt;text-transform:uppercase;letter-spacing:.04em;padding:2px 4px;text-align:left;font-weight:700}
    .items-table td{padding:2px 4px;border-bottom:0.5px solid #ccc;font-size:8pt;vertical-align:middle;color:#000}
    .col-product{width:42%}.col-code{width:13%}.col-colour{width:19%}.col-size{width:13%}
    .col-qty{width:9%;text-align:center;font-weight:700}
    .finish-sub{font-size:6pt;color:#000;font-style:italic}
    .label-footer{display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:4px;border-top:1px solid #ccc}
    .footer-customer{font-size:8pt;font-weight:700;color:#000;letter-spacing:.02em}
    .footer-order{font-size:8pt;font-weight:600;color:#555;font-family:monospace}
    @media print{
      @page{size:4in 3in landscape;margin:0mm}
      html,body{margin:0!important;padding:0!important;width:4in}
      #toolbar{display:none}
      body{background:white}
      #page{padding:0;gap:0;margin:0;align-items:flex-start}
      .label{width:4in;height:3in;border:none;border-radius:0;box-shadow:none;overflow:hidden;page-break-after:always;break-after:page}
    }
  </style>
</head>
<body>
  <div id="toolbar">
    <div id="toolbar-text">
      <div id="toolbar-title">🏷️ ${totalCount} Label${totalCount !== 1 ? "s" : ""} · ${titleText}</div>
      <div id="toolbar-sub">⚠️ Paper: <strong>User defined 4×3 in</strong> · Orientation: <strong>Landscape</strong> · Margins: <strong>None</strong> &nbsp;·&nbsp; ${summaryText}</div>
    </div>
    <button id="btn-print" type="button">🖨 Print All Labels</button>
    <button id="btn-close" type="button">✕ Close</button>
  </div>
  <div id="page">${allLabels.join("\n")}</div>
  <script src="/api/print-controls.js" defer></script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(html);
});

// ─── Order Activity Log ───────────────────────────────────────────────────────
router.get("/orders/:id/logs", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const logs = await db
    .select()
    .from(orderLogsTable)
    .where(eq(orderLogsTable.orderId, params.data.id))
    .orderBy(asc(orderLogsTable.createdAt));

  res.json(logs);
});

// ── Label data JSON (for Zebra Browser Print / ZPL generation) ───────────────
router.get("/orders/:id/label-data", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Bad request" }); return; }

  const orderId = parsed.data.id;
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  const SHIPPING_LABELS: Record<string, string> = {
    free_local: "Free Local Delivery", local_delivery: "Local Delivery",
    office_collection: "Office Collection", warehouse_collection: "Warehouse Collection",
    courier: "Courier", dpd: "DPD Courier",
  };

  let deliveryAddress: { line1: string | null; line2: string | null; city: string | null; postcode: string | null; country: string | null } | null = null;
  let customerContact: { contactFirstName: string | null; contactLastName: string | null; phone: string | null; address: string | null; city: string | null; postcode: string | null } | null = null;

  if (order.deliveryAddressId) {
    const [addr] = await db.select().from(customerDeliveryAddressesTable)
      .where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    deliveryAddress = addr ?? null;
  }
  if (!deliveryAddress) {
    const empRows = await db.select({ deliveryAddressId: (customerEmployeesTable as any).deliveryAddressId })
      .from(orderItemsTable)
      .innerJoin(customerEmployeesTable, eq(orderItemsTable.recipientEmployeeId, customerEmployeesTable.id))
      .where(eq(orderItemsTable.orderId, orderId));
    const empAddrIds = [...new Set(empRows.map((e: any) => e.deliveryAddressId as number | null).filter((id): id is number => id != null))];
    if (empAddrIds.length === 1) {
      const [addr] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, empAddrIds[0]));
      deliveryAddress = addr ?? null;
    }
  }
  deliveryAddress ??= await getDefaultSavedDeliveryAddress(order.customerId);
  if (order.customerId) {
    const [cust] = await db.select({
      contactFirstName: customersTable.contactFirstName,
      contactLastName: customersTable.contactLastName,
      phone: customersTable.phone,
      address: customersTable.address,
      city: customersTable.city,
      postcode: customersTable.postcode,
    }).from(customersTable).where(eq(customersTable.id, order.customerId));
    customerContact = cust ?? null;
  }

  const addrLines = deliveryAddress
    ? [deliveryAddress.line1, deliveryAddress.line2, deliveryAddress.city, deliveryAddress.postcode, deliveryAddress.country].filter(Boolean) as string[]
    : [customerContact?.address, customerContact?.city, customerContact?.postcode].filter(Boolean) as string[];

  const contactName = [customerContact?.contactFirstName, customerContact?.contactLastName].filter(Boolean).join(" ") || null;

  // Wearer labels data
  const itemRows = await db
    .select({ item: orderItemsTable, employee: customerEmployeesTable })
    .from(orderItemsTable)
    .leftJoin(customerEmployeesTable, eq(orderItemsTable.recipientEmployeeId, customerEmployeesTable.id))
    .where(eq(orderItemsTable.orderId, orderId));

  const allItems = itemRows.map(r => ({
    ...r.item,
    employee: r.employee ?? null,
  }));

  const empName = (item: typeof allItems[0]) => {
    if (item.employee) return [item.employee.firstName, item.employee.lastName].filter(Boolean).join(" ");
    return item.recipientName ?? null;
  };
  const isNamed = (item: typeof allItems[0]) =>
    item.recipientType === "person" && !!(item.recipientName || item.recipientEmployeeId);

  // Fetch team names for any employees that have a teamId
  const teamIds = [...new Set(allItems.map(i => (i.employee as any)?.teamId as number | null | undefined).filter((id): id is number => id != null))];
  const teamMap = new Map<number, string>();
  if (teamIds.length > 0) {
    const teams = await db.select({ id: customerTeamsTable.id, name: customerTeamsTable.name })
      .from(customerTeamsTable)
      .where(inArray(customerTeamsTable.id, teamIds));
    for (const t of teams) teamMap.set(t.id, t.name);
  }

  const wearerMap = new Map<string, {
    wearerKey: string;
    name: string;
    jobTitle: string | null;
    employeeNumber: string | null;
    team: string | null;
    department: string | null;
    itemIds: number[];
    items: Array<{ productName: string; colour: string | null; size: string | null; quantity: number; finishName: string | null }>;
  }>();
  for (const item of allItems.filter(isNamed)) {
    const name = empName(item) ?? "Unknown";
    const wearerKey = item.recipientEmployeeId != null
      ? `employee:${item.recipientEmployeeId}`
      : `name:${name.trim().toLowerCase().replace(/\s+/g, " ")}`;
    if (!wearerMap.has(wearerKey)) {
      const teamId = (item.employee as any)?.teamId as number | null | undefined;
      wearerMap.set(wearerKey, {
        wearerKey,
        name,
        jobTitle: item.employee?.jobTitle ?? null,
        employeeNumber: (item.employee as any)?.employeeNumber ?? null,
        team: teamId ? (teamMap.get(teamId) ?? null) : null,
        department: item.employee?.department ?? null,
        itemIds: [],
        items: [],
      });
    }
    wearerMap.get(wearerKey)!.itemIds.push(item.id);
    wearerMap.get(wearerKey)!.items.push({
      productName: item.productName,
      colour: item.colour ?? null,
      size: item.size ?? null,
      quantity: item.quantity,
      finishName: item.finishName ?? null,
    });
  }

  const printRows = await db.execute(sql`
    SELECT wearer_key, MAX(printed_at) AS printed_at, COUNT(*)::int AS print_count
    FROM order_label_prints
    WHERE order_id = ${orderId}
      AND label_type = 'wearer'
    GROUP BY wearer_key
  `);
  const printMap = new Map(
    (printRows.rows as Array<{ wearer_key: string; printed_at: Date | string; print_count: number }>)
      .map((row) => [row.wearer_key, row]),
  );

  res.json({
    orderNumber: order.orderNumber,
    customerName: order.customerName ?? "",
    managerPackingEnabled: order.customerId != null && await isManagerPackingEnabled(order.customerId),
    shippingMethod: SHIPPING_LABELS[order.shippingMethod ?? ""] ?? order.shippingMethod ?? "",
    isDpd: !!order.shippingMethod?.toLowerCase().includes("dpd"),
    trackingNumber: order.trackingNumber ?? null,
    poNumber: order.poNumber ?? null,
    contactName,
    phone: customerContact?.phone ?? null,
    addressLines: addrLines,
    wearers: Array.from(wearerMap.values()).map((wearer) => {
      const print = printMap.get(wearer.wearerKey);
      return {
        ...wearer,
        printedAt: print?.printed_at ?? null,
        printCount: print?.print_count ?? 0,
      };
    }),
  });
});

router.post("/orders/:id/wearer-labels/print-events", async (req, res): Promise<void> => {
  const parsed = z.object({
    id: z.coerce.number().int().positive(),
  }).safeParse(req.params);
  const body = z.object({
    wearers: z.array(z.object({
      wearerKey: z.string().min(1).max(300),
      wearerName: z.string().min(1).max(300),
      itemIds: z.array(z.number().int().positive()).default([]),
    })).min(1).max(200),
  }).safeParse(req.body);
  if (!parsed.success || !body.success) {
    res.status(400).json({ error: "Invalid label print event" });
    return;
  }
  const [order] = await db.select({ id: ordersTable.id }).from(ordersTable).where(eq(ordersTable.id, parsed.data.id));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  await db.insert(orderLabelPrintsTable).values(body.data.wearers.map((wearer) => ({
    orderId: order.id,
    labelType: "wearer",
    wearerKey: wearer.wearerKey,
    wearerName: wearer.wearerName,
    itemIds: wearer.itemIds,
    actor: "Staff",
  })));
  res.json({ ok: true });
});

// ── Return to Stock ──────────────────────────────────────────────────────────
const returnToStockBodySchema = z.object({
  items: z.array(z.object({
    orderItemId: z.number().int().positive(),
    quantity: z.number().int().positive(),
    type: z.enum(["plain", "finished"]),
    /** Required when type === "finished": price per unit for the customer wardrobe entry */
    unitPrice: z.number().nonnegative().optional(),
    notes: z.string().optional(),
  })).min(1),
});

router.post("/:id/return-to-stock", async (req, res): Promise<void> => {
  const orderId = parseInt(req.params.id, 10);
  if (isNaN(orderId)) { res.status(400).json({ error: "Invalid order id" }); return; }

  const [order] = await db.select({
    id: ordersTable.id,
    status: ordersTable.status,
    customerId: ordersTable.customerId,
    orderNumber: ordersTable.orderNumber,
  }).from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);

  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (!["shipped", "part_shipped", "delivered"].includes(order.status ?? "")) {
    res.status(400).json({ error: "Stock can only be returned on shipped, part shipped, or delivered orders." });
    return;
  }
  if (!order.customerId) {
    res.status(400).json({ error: "Order has no customer — cannot allocate finished stock." });
    return;
  }

  const body = returnToStockBodySchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const results: Array<{ orderItemId: number; ok: boolean; message: string }> = [];

  for (const entry of body.data.items) {
    const [orderItem] = await db.select().from(orderItemsTable)
      .where(and(eq(orderItemsTable.id, entry.orderItemId), eq(orderItemsTable.orderId, orderId)))
      .limit(1);

    if (!orderItem) {
      results.push({ orderItemId: entry.orderItemId, ok: false, message: "Order item not found" });
      continue;
    }
    if (entry.quantity > orderItem.quantity) {
      results.push({ orderItemId: entry.orderItemId, ok: false, message: `Cannot return more than the ordered quantity (${orderItem.quantity})` });
      continue;
    }

    if (entry.type === "plain") {
      if (!orderItem.productId) {
        results.push({ orderItemId: entry.orderItemId, ok: false, message: "No product linked — cannot return plain stock" });
        continue;
      }

      // Try exact colour+size match first; then split size by "/" for size/sleeve combined items
      let variant: typeof productVariantsTable.$inferSelect | undefined;

      const exactRows = await db.select().from(productVariantsTable)
        .where(and(
          eq(productVariantsTable.productId, orderItem.productId),
          orderItem.colour ? eq(productVariantsTable.colour, orderItem.colour) : isNull(productVariantsTable.colour),
          orderItem.size   ? eq(productVariantsTable.size,   orderItem.size)   : isNull(productVariantsTable.size),
        )).limit(1);
      variant = exactRows[0];

      if (!variant && orderItem.size && orderItem.size.includes("/")) {
        const [sizePart, sleevePart] = orderItem.size.split("/");
        const splitRows = await db.select().from(productVariantsTable)
          .where(and(
            eq(productVariantsTable.productId, orderItem.productId),
            orderItem.colour ? eq(productVariantsTable.colour, orderItem.colour) : isNull(productVariantsTable.colour),
            eq(productVariantsTable.size,   sizePart),
            eq(productVariantsTable.sleeve, sleevePart),
          )).limit(1);
        variant = splitRows[0];
      }

      if (!variant) {
        results.push({ orderItemId: entry.orderItemId, ok: false, message: `No matching variant found for ${orderItem.productName} ${orderItem.colour ?? ""} ${orderItem.size ?? ""}`.trim() });
        continue;
      }

      await db.update(productVariantsTable)
        .set({ stockQuantity: sql`${productVariantsTable.stockQuantity} + ${entry.quantity}`, updatedAt: new Date() })
        .where(eq(productVariantsTable.id, variant.id));

      results.push({ orderItemId: entry.orderItemId, ok: true, message: `Plain stock +${entry.quantity} (variant id ${variant.id})` });

    } else {
      // Finished stock — goes into customer_finished_items, tied to this customer
      if (!orderItem.productId) {
        results.push({ orderItemId: entry.orderItemId, ok: false, message: "No product linked — cannot create a finished stock entry" });
        continue;
      }
      if (entry.unitPrice == null) {
        results.push({ orderItemId: entry.orderItemId, ok: false, message: "Unit price is required for finished stock" });
        continue;
      }

      // Size: if combined "SIZE/SLEEVE", store just size part in size, sleeve in sleeve
      let stockSize = orderItem.size ?? null;
      let stockSleeve: string | null = null;
      if (stockSize && stockSize.includes("/")) {
        [stockSize, stockSleeve] = stockSize.split("/");
      }

      // Check for existing matching wardrobe entry
      const [existing] = await db.select({ id: customerFinishedItemsTable.id, stockQty: customerFinishedItemsTable.stockQuantity })
        .from(customerFinishedItemsTable)
        .where(and(
          eq(customerFinishedItemsTable.customerId, order.customerId),
          eq(customerFinishedItemsTable.productId, orderItem.productId),
          orderItem.finishId != null
            ? eq(customerFinishedItemsTable.finishId, orderItem.finishId)
            : isNull(customerFinishedItemsTable.finishId),
          orderItem.colour  ? eq(customerFinishedItemsTable.colour,  orderItem.colour)  : isNull(customerFinishedItemsTable.colour),
          stockSize         ? eq(customerFinishedItemsTable.size,    stockSize)         : isNull(customerFinishedItemsTable.size),
          stockSleeve       ? eq(customerFinishedItemsTable.sleeve,  stockSleeve)       : isNull(customerFinishedItemsTable.sleeve),
          isNull(customerFinishedItemsTable.roleId),
        )).limit(1);

      if (existing) {
        await db.update(customerFinishedItemsTable)
          .set({ stockQuantity: sql`${customerFinishedItemsTable.stockQuantity} + ${entry.quantity}`, updatedAt: new Date() })
          .where(eq(customerFinishedItemsTable.id, existing.id));
        results.push({ orderItemId: entry.orderItemId, ok: true, message: `Finished stock +${entry.quantity} on existing entry (id ${existing.id})` });
      } else {
        const [inserted] = await db.insert(customerFinishedItemsTable).values({
          customerId: order.customerId,
          productId: orderItem.productId,
          finishId: orderItem.finishId ?? null,
          name: orderItem.finishName ? `${orderItem.productName} — ${orderItem.finishName}` : orderItem.productName,
          colour: orderItem.colour ?? null,
          size: stockSize,
          sleeve: stockSleeve,
          unitPrice: String(entry.unitPrice),
          stockQuantity: entry.quantity,
          notes: entry.notes ?? `Returned from order ${order.orderNumber}`,
        }).returning({ id: customerFinishedItemsTable.id });
        results.push({ orderItemId: entry.orderItemId, ok: true, message: `Finished stock created (id ${inserted.id})` });
      }
    }
  }

  const actor = getActor(req);
  const successLines = results.filter(r => r.ok).map(r => r.message);
  if (successLines.length > 0) {
    await logOrderAction(orderId, actor, "return_to_stock", `Returned to stock: ${successLines.join("; ")}`);
  }

  const anyFailed = results.some(r => !r.ok);
  res.status(anyFailed ? 207 : 200).json({ results });
});

export default router;
