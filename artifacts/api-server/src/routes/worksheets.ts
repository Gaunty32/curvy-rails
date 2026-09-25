import { Router, type IRouter } from "express";
import { eq, desc, inArray, and, sql, notExists, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  worksheetsTable,
  worksheetItemsTable,
  orderItemsTable,
  ordersTable,
  productsTable,
  customerProcessesTable,
  customerFinishesTable,
  customerFinishProcessesTable,
  processStockTable,
} from "@workspace/db";
import { logOrderAction, getActor } from "../services/orderLog";

const router: IRouter = Router();

async function generateWorksheetNumber(): Promise<string> {
  const rows = await db.execute(sql`
    SELECT worksheet_number FROM worksheets
    WHERE worksheet_number ~ '^F[0-9]+$'
    ORDER BY LENGTH(worksheet_number) DESC, worksheet_number DESC
    LIMIT 1
  `);
  const last = (rows.rows[0] as any)?.worksheet_number as string | undefined;
  const maxNum = last ? parseInt(last.slice(1), 10) : 99;
  return `F${maxNum + 1}`;
}

// ── Picking list: items allocated from stock, ready to be picked ──────────────
router.get("/picking-list", async (req, res): Promise<void> => {
  // Defensive filter: exclude items still linked to an outstanding PO
  // (quantity_delivered < quantity_ordered on any non-cancelled PO line).
  // These items may have been marked 'allocated' by a migration or edge-case
  // but the physical stock hasn't arrived yet.
  const rawRows = await db.execute(sql`
    SELECT
      oi.id          AS "itemId",
      o.id           AS "orderId",
      o.order_number AS "orderNumber",
      o.customer_name AS "customerName",
      o.customer_id  AS "customerId",
      o.required_date AS "requiredDate",
      oi.product_name AS "productName",
      oi.product_id  AS "productId",
      p.sku          AS "productSku",
      p.supplier_code AS "supplierCode",
      oi.supplier_name AS "supplierName",
      oi.colour,
      oi.size,
      oi.quantity,
      oi.recipient_type AS "recipientType",
      oi.recipient_name AS "recipientName",
      oi.finish_id   AS "finishId",
      oi.finish_name AS "finishName",
      oi.stock_status AS "stockStatus",
      oi.stock_allocated_at AS "stockAllocatedAt",
      pv.bin_location AS "binLocation"
    FROM order_items oi
    INNER JOIN orders o ON o.id = oi.order_id
    LEFT  JOIN products p ON p.id = oi.product_id
    LEFT  JOIN product_variants pv
           ON  pv.product_id = oi.product_id
           AND (pv.colour = oi.colour OR (pv.colour IS NULL AND oi.colour IS NULL))
           AND (
                (pv.size = oi.size OR (pv.size IS NULL AND oi.size IS NULL))
                OR (oi.size LIKE '%/%' AND pv.size = split_part(oi.size, '/', 1) AND pv.sleeve = split_part(oi.size, '/', 2))
           )
    WHERE
        -- Only decorated items awaiting production pick (plain items go straight to Dispatch)
        oi.stock_status = 'allocated'
        AND oi.finish_id IS NOT NULL
        -- Exclude completed / shipped / cancelled orders
        AND o.status NOT IN (
          'shipped', 'delivered', 'completed', 'invoiced',
          'cancelled', 'archived', 'draft', 'portal_draft', 'portal_pending'
        )
        AND oi.dispatched_at IS NULL
        -- Exclude service products (LEFT JOIN: NULL product_id items are excluded too)
        AND (oi.product_id IS NULL OR COALESCE(p.is_service, false) = false)
        AND NOT EXISTS (
          -- Exclude items still waiting for PO delivery (direct link)
          SELECT 1 FROM purchase_order_items poi
          INNER JOIN purchase_orders po ON po.id = poi.po_id
          WHERE po.status NOT IN ('cancelled', 'delivered')
            AND poi.process_stock_id IS NULL
            AND poi.quantity_delivered < poi.quantity_ordered
            AND poi.order_item_id = oi.id
        )
        AND NOT EXISTS (
          -- Exclude items still waiting for PO delivery (consolidated source link)
          SELECT 1 FROM purchase_order_items poi
          INNER JOIN purchase_orders po ON po.id = poi.po_id
          WHERE po.status NOT IN ('cancelled', 'delivered')
            AND poi.process_stock_id IS NULL
            AND poi.quantity_delivered < poi.quantity_ordered
            AND COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> to_jsonb(oi.id)
        )
        -- Exclude items that have PO lines but none has delivered any stock yet
        -- (covers the case where a PO was marked 'delivered' before goods arrived,
        -- or a Correct Book-in zeroed the qty after allocation already ran)
        AND (
          NOT EXISTS (
            SELECT 1 FROM purchase_order_items poi
            WHERE poi.process_stock_id IS NULL
              AND (
                poi.order_item_id = oi.id
                OR COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> to_jsonb(oi.id)
              )
          )
          OR EXISTS (
            SELECT 1 FROM purchase_order_items poi
            WHERE poi.process_stock_id IS NULL
              AND (poi.order_item_id = oi.id
                   OR COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> to_jsonb(oi.id))
              AND poi.quantity_delivered > 0
          )
        )
    ORDER BY o.required_date NULLS LAST, o.id
  `);

  const rows = rawRows.rows as Array<{
    itemId: number; orderId: number; orderNumber: string; customerName: string | null;
    customerId: number | null; requiredDate: Date | null; productName: string;
    productId: number | null; productSku: string | null; supplierCode: string | null;
    supplierName: string | null; colour: string | null; size: string | null;
    quantity: number; recipientType: string | null; recipientName: string | null;
    finishId: number | null; finishName: string | null;
    stockStatus: string | null; stockAllocatedAt: Date | null;
    binLocation: string | null;
  }>;

  const orderMap = new Map<number, {
    orderId: number; orderNumber: string; customerName: string | null;
    customerId: number | null; requiredDate: Date | null;
    items: typeof rows;
  }>();
  for (const row of rows) {
    if (!orderMap.has(row.orderId)) {
      orderMap.set(row.orderId, {
        orderId: row.orderId, orderNumber: row.orderNumber,
        customerName: row.customerName, customerId: row.customerId,
        requiredDate: row.requiredDate, items: [],
      });
    }
    orderMap.get(row.orderId)!.items.push(row);
  }
  res.json(Array.from(orderMap.values()));
});

// Mark picking list items as picked.
// Plain items (no finish) → stockStatus = 'complete'
// Items with a finish → create/update production worksheet → stockStatus = 'in_production'
router.post("/picking-list/pick", async (req, res): Promise<void> => {
  const parsed = z.object({
    itemIds: z.array(z.number().int().positive()),
    qtyOverrides: z.record(z.string(), z.number().int().min(1)).optional(),
    bypassProcessStockCheck: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const items = await db
    .select({
      id: orderItemsTable.id,
      orderId: orderItemsTable.orderId,
      productId: orderItemsTable.productId,
      productName: orderItemsTable.productName,
      colour: orderItemsTable.colour,
      size: orderItemsTable.size,
      quantity: orderItemsTable.quantity,
      unitPrice: orderItemsTable.unitPrice,
      vatRate: orderItemsTable.vatRate,
      recipientType: orderItemsTable.recipientType,
      recipientName: orderItemsTable.recipientName,
      recipientEmployeeId: orderItemsTable.recipientEmployeeId,
      finishId: orderItemsTable.finishId,
      finishName: orderItemsTable.finishName,
      supplierId: orderItemsTable.supplierId,
      supplierName: orderItemsTable.supplierName,
      orderNumber: ordersTable.orderNumber,
      customerId: ordersTable.customerId,
      customerName: ordersTable.customerName,
    })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .where(inArray(orderItemsTable.id, parsed.data.itemIds));

  // ── Partial pick: split items where fewer units were found than required ──
  const overrides = parsed.data.qtyOverrides ?? {};
  for (const item of items) {
    const pickedQty = overrides[String(item.id)];
    if (pickedQty == null || pickedQty >= item.quantity) continue;

    const shortfallQty = item.quantity - pickedQty;
    const unitPriceNum = parseFloat(item.unitPrice ?? "0");

    // Reduce original item to the picked quantity
    await db.update(orderItemsTable).set({
      quantity: pickedQty,
      lineTotal: String((pickedQty * unitPriceNum).toFixed(2)),
    }).where(eq(orderItemsTable.id, item.id));

    // Insert shortfall item — goes straight to purchasing requirements
    await db.insert(orderItemsTable).values({
      orderId: item.orderId,
      productId: item.productId ?? null,
      productName: item.productName,
      colour: item.colour ?? null,
      size: item.size ?? null,
      finishId: item.finishId ?? null,
      finishName: item.finishName ?? null,
      recipientType: item.recipientType,
      recipientName: item.recipientName ?? null,
      recipientEmployeeId: item.recipientEmployeeId ?? null,
      quantity: shortfallQty,
      unitPrice: item.unitPrice ?? "0",
      lineTotal: String((shortfallQty * unitPriceNum).toFixed(2)),
      vatRate: item.vatRate ?? "0.2000",
      purchaseRequired: true,
      purchaseQuantity: shortfallQty,
      supplierId: item.supplierId ?? null,
      supplierName: item.supplierName ?? null,
      stockStatus: null,
      stockAllocatedAt: null,
    });

    // Decrement product stock by shortfall (those units aren't actually in stock)
    if (item.productId != null) {
      await db.execute(
        sql`UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) - ${shortfallQty} WHERE id = ${item.productId}`
      );
    }

    // Update in-memory quantity so the pick logic below uses the reduced amount
    item.quantity = pickedQty;
  }

  const plainItems = items.filter((i) => i.finishId == null);
  const finishItems = items.filter((i) => i.finishId != null);

  // Plain items → complete (ready for dispatch, no decoration needed)
  if (plainItems.length > 0) {
    await db
      .update(orderItemsTable)
      .set({ stockStatus: "complete" })
      .where(inArray(orderItemsTable.id, plainItems.map((i) => i.id)));
  }

  // ── Guard: all required process stock must have been delivered (stockQuantity > 0) ──
  // Skipped when bypassProcessStockCheck is true — allows picking garments into pre_wip
  // while awaiting process stock delivery (e.g. embroidery threads, DTF transfers).
  if (finishItems.length > 0 && !parsed.data.bypassProcessStockCheck) {
    const finishIds = [...new Set(finishItems.map(i => i.finishId!))] as number[];

    const finishProcessLinks = await db
      .select({ finishId: customerFinishProcessesTable.finishId, processId: customerFinishProcessesTable.processId })
      .from(customerFinishProcessesTable)
      .where(inArray(customerFinishProcessesTable.finishId, finishIds));

    if (finishProcessLinks.length > 0) {
      const processIds = [...new Set(finishProcessLinks.map(fp => fp.processId))];

      const processes = await db
        .select({ id: customerProcessesTable.id, processStockId: customerProcessesTable.processStockId })
        .from(customerProcessesTable)
        .where(inArray(customerProcessesTable.id, processIds));

      const psIds = [...new Set(processes.filter(p => p.processStockId != null).map(p => p.processStockId!))] as number[];

      if (psIds.length > 0) {
        const missingStock = await db
          .select({ id: processStockTable.id, name: processStockTable.name, sku: processStockTable.sku })
          .from(processStockTable)
          .where(and(inArray(processStockTable.id, psIds), eq(processStockTable.stockQuantity, 0)));

        if (missingStock.length > 0) {
          const names = missingStock.map(p => p.name + (p.sku ? ` (${p.sku})` : "")).join(", ");
          res.status(409).json({
            error: `Process stock not yet delivered — cannot send to production. Missing: ${names}`,
            missingProcessStock: missingStock,
          });
          return;
        }
      }
    }
  }

  // Finish items → create/append production worksheet per order
  const touchedWorksheetIds: number[] = [];

  if (finishItems.length > 0) {
    const byOrder = new Map<number, typeof finishItems>();
    for (const item of finishItems) {
      if (!byOrder.has(item.orderId)) byOrder.set(item.orderId, []);
      byOrder.get(item.orderId)!.push(item);
    }

    for (const [orderId, orderItems] of byOrder) {
      const firstItem = orderItems[0];

      // Find existing open worksheet for this order
      const [existingWs] = await db
        .select()
        .from(worksheetsTable)
        .where(and(eq(worksheetsTable.orderId, orderId), eq(worksheetsTable.status, "pre_wip")));

      let worksheetId: number;
      if (existingWs) {
        worksheetId = existingWs.id;
      } else {
        const wsNum = await generateWorksheetNumber();
        const [ws] = await db
          .insert(worksheetsTable)
          .values({
            worksheetNumber: wsNum,
            status: "wip",
            orderId,
            orderNumber: firstItem.orderNumber,
            customerId: firstItem.customerId ?? null,
            customerName: firstItem.customerName ?? null,
          })
          .returning();
        worksheetId = ws.id;
      }
      touchedWorksheetIds.push(worksheetId);

      for (const item of orderItems) {
        // Avoid duplicates — but still ensure stockStatus is updated even if the
        // worksheet item already exists (e.g. item was returned to picking but the
        // worksheet item row was not deleted).
        const [existing] = await db
          .select()
          .from(worksheetItemsTable)
          .where(and(eq(worksheetItemsTable.worksheetId, worksheetId), eq(worksheetItemsTable.orderItemId, item.id)));
        if (existing) {
          await db
            .update(orderItemsTable)
            .set({ stockStatus: "in_production", purchaseRequired: false, purchaseQuantity: null })
            .where(eq(orderItemsTable.id, item.id));
          continue;
        }

        // Build processes snapshot from customer finish config
        let processesSnapshot: string | null = null;
        if (item.finishId && item.customerId) {
          const links = await db
            .select()
            .from(customerFinishProcessesTable)
            .where(eq(customerFinishProcessesTable.finishId, item.finishId));
          if (links.length > 0) {
            const processes = await db
              .select()
              .from(customerProcessesTable)
              .where(inArray(customerProcessesTable.id, links.map((l) => l.processId)));
            processesSnapshot = JSON.stringify(
              processes.map((p) => ({
                id: p.id, name: p.name, type: p.type,
                placement: p.placement,
                price: p.price ? parseFloat(p.price) : null,
                notes: p.notes,
              }))
            );
          }
        }

        await db.insert(worksheetItemsTable).values({
          worksheetId,
          orderItemId: item.id,
          productName: item.productName,
          colour: item.colour ?? null,
          size: item.size ?? null,
          quantity: item.quantity,
          recipientType: item.recipientType,
          recipientName: item.recipientName ?? null,
          finishId: item.finishId ?? null,
          finishName: item.finishName ?? null,
          processesSnapshot,
        });

        await db
          .update(orderItemsTable)
          .set({ stockStatus: "in_production", purchaseRequired: false, purchaseQuantity: null })
          .where(eq(orderItemsTable.id, item.id));
      }
    }
  }

  // Build full worksheet payloads for the frontend to auto-print
  const worksheetPayloads = await Promise.all(
    touchedWorksheetIds.map(async (wsId) => {
      const [ws] = await db.select().from(worksheetsTable).where(eq(worksheetsTable.id, wsId));
      const wsItems = await db.select().from(worksheetItemsTable).where(eq(worksheetItemsTable.worksheetId, wsId));
      const order = ws?.orderId
        ? (await db.select({ requiredDate: ordersTable.requiredDate }).from(ordersTable).where(eq(ordersTable.id, ws.orderId)))[0]
        : null;
      return {
        ...ws,
        requiredDate: order?.requiredDate ? order.requiredDate.toISOString() : null,
        items: wsItems.map((i) => ({
          ...i,
          processes: i.processesSnapshot ? JSON.parse(i.processesSnapshot) : [],
        })),
      };
    })
  );

  res.json({ ok: true, plainPicked: plainItems.length, worksheetItems: finishItems.length, worksheets: worksheetPayloads });
});

// Return picking list items back to purchasing requirements.
// Resets stockStatus → null and purchaseRequired → true.
// Stock was already deducted when the item was allocated, so it must not be deducted again.
// If a draft PO already contains the item's earlier partial shortfall, increase that line too.
router.post("/picking-list/return", async (req, res): Promise<void> => {
  const parsed = z.object({ itemIds: z.array(z.number().int().positive()) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const items = await db
    .select({
      id: orderItemsTable.id,
      quantity: orderItemsTable.quantity,
      purchaseQuantity: orderItemsTable.purchaseQuantity,
    })
    .from(orderItemsTable)
    .where(inArray(orderItemsTable.id, parsed.data.itemIds));

  for (const item of items) {
    const previousRequirement = item.purchaseQuantity ?? 0;
    const addedRequirement = Math.max(0, item.quantity - previousRequirement);

    await db.transaction(async (tx) => {
      await tx
        .update(orderItemsTable)
        .set({
          stockStatus: null,
          purchaseRequired: true,
          purchaseQuantity: item.quantity,
          stockAllocatedAt: null,
        })
        .where(eq(orderItemsTable.id, item.id));

      if (addedRequirement > 0) {
        await tx.execute(sql`
          UPDATE purchase_order_items poi
          SET quantity_ordered = quantity_ordered + ${addedRequirement},
              updated_at = NOW()
          FROM purchase_orders po
          WHERE poi.po_id = po.id
            AND po.status = 'draft'
            AND (
              poi.order_item_id = ${item.id}
              OR COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> ${JSON.stringify([item.id])}::jsonb
            )
        `);
      }
    });
  }

  res.json({ ok: true, returned: items.length });
});

// ── Pending production: confirmed orders awaiting stock ───────────────────────
router.get("/production/pending", async (req, res): Promise<void> => {
  // CTE identifies order_items that are allocated but still on an outstanding PO
  // (quantity_delivered < quantity_ordered on any non-cancelled/delivered PO line).
  // These must be counted as "still purchasing" even though purchase_required = false.
  const orderStatsRes = await db.execute(sql`
    WITH outstanding_po_items AS (
      SELECT DISTINCT item_id FROM (
        SELECT poi.order_item_id::integer AS item_id
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.po_id
        WHERE po.status <> 'cancelled'
          AND poi.quantity_delivered < poi.quantity_ordered
          AND poi.order_item_id IS NOT NULL
        UNION ALL
        SELECT (elem.value)::integer AS item_id
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.po_id,
        jsonb_array_elements_text(COALESCE(poi.source_order_item_ids,'[]'::jsonb)) AS elem(value)
        WHERE po.status <> 'cancelled'
          AND poi.quantity_delivered < poi.quantity_ordered
      ) sub
    )
    SELECT
      o.id, o.order_number, o.customer_id, o.customer_name, o.required_date, o.total_amount,
      COUNT(*) FILTER (
        WHERE (
          oi.purchase_required = true
          OR oi.id IN (SELECT item_id FROM outstanding_po_items)
        )
        AND COALESCE(p.is_service, false) = false
        AND oi.finish_id IS NOT NULL
        AND COALESCE(oi.stock_status, '') NOT IN ('in_production', 'complete', 'allocated')
      )::integer AS purchase_count,
      COUNT(*) FILTER (
        WHERE oi.purchase_required = false
          AND oi.stock_status NOT IN ('in_production', 'complete')
          AND oi.id NOT IN (SELECT item_id FROM outstanding_po_items)
          AND oi.finish_id IS NOT NULL
      )::integer AS ready_count,
      EXISTS(SELECT 1 FROM worksheets WHERE order_id = o.id) AS has_worksheet
    FROM orders o
    INNER JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE o.status = 'confirmed'
    GROUP BY o.id, o.order_number, o.customer_id, o.customer_name, o.required_date, o.total_amount
    ORDER BY o.required_date NULLS LAST, o.id
  `);

  const stats = orderStatsRes.rows as Array<{
    id: number; order_number: string; customer_id: number | null; customer_name: string | null;
    required_date: Date | null; total_amount: string | null;
    purchase_count: number; ready_count: number; has_worksheet: boolean;
  }>;

  // Categorise: allReady = all items in stock, no worksheet yet
  //             partInStock = some items in stock, some still on purchase (with or without ws)
  //             allAwaiting = every item still on purchase order
  const allReadyStats    = stats.filter(o => Number(o.purchase_count) === 0 && Number(o.ready_count) > 0 && !o.has_worksheet);
  const partInStockStats = stats.filter(o => Number(o.purchase_count) > 0  && Number(o.ready_count) > 0);
  const allAwaitingStats = stats.filter(o => Number(o.purchase_count) > 0  && Number(o.ready_count) === 0);

  // ── Ready items for allReady + partInStock orders ─────────────────────────
  const readyOrderIds = [...allReadyStats, ...partInStockStats].map(o => Number(o.id));
  const readyItemsByOrderId = new Map<number, any[]>();

  if (readyOrderIds.length > 0) {
    const rows = await db.execute(sql`
      SELECT oi.id, oi.order_id, oi.product_name, oi.colour, oi.size, oi.quantity,
             oi.finish_name, oi.finish_id, p.name AS catalogue_name
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ANY(ARRAY[${sql.raw(readyOrderIds.join(","))}]::integer[])
        AND oi.purchase_required = false
        AND oi.finish_id IS NOT NULL
        AND oi.stock_status NOT IN ('in_production', 'complete')
        AND (
          oi.stock_status = 'allocated'
          OR (
        NOT EXISTS (
          SELECT 1 FROM purchase_order_items poi
          JOIN purchase_orders po ON po.id = poi.po_id
          WHERE po.status <> 'cancelled'
            AND poi.quantity_delivered < poi.quantity_ordered
            AND poi.order_item_id = oi.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM purchase_order_items poi
          JOIN purchase_orders po ON po.id = poi.po_id
          WHERE po.status <> 'cancelled'
            AND poi.quantity_delivered < poi.quantity_ordered
            AND COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> to_jsonb(oi.id)
        )
          )
        )
      ORDER BY oi.id
    `);
    for (const row of rows.rows as any[]) {
      const oid = Number(row.order_id);
      if (!readyItemsByOrderId.has(oid)) readyItemsByOrderId.set(oid, []);
      readyItemsByOrderId.get(oid)!.push({
        id: Number(row.id),
        productName: (row.catalogue_name ?? row.product_name) as string,
        colour: row.colour as string | null,
        size: row.size as string | null,
        quantity: Number(row.quantity),
        finishName: row.finish_name as string | null,
        finishId: row.finish_id ? Number(row.finish_id) : null,
      });
    }
  }

  // ── Pending items with PO status for partInStock + allAwaiting orders ─────
  const pendingOrderIds = [...partInStockStats, ...allAwaitingStats].map(o => Number(o.id));
  const pendingItemsByOrderId = new Map<number, any[]>();

  if (pendingOrderIds.length > 0) {
    const pendingRows = await db.execute(sql`
      SELECT oi.id, oi.order_id, oi.product_name, oi.colour, oi.size,
             oi.purchase_quantity, oi.supplier_name, p.name AS catalogue_name,
             oi.quantity, p.sku AS product_sku, p.supplier_code AS supplier_code
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ANY(ARRAY[${sql.raw(pendingOrderIds.join(","))}]::integer[])
        AND COALESCE(p.is_service, false) = false
        AND oi.finish_id IS NOT NULL
        AND COALESCE(oi.stock_status, '') NOT IN ('allocated', 'in_production', 'complete')
        AND (
          oi.purchase_required = true
          OR (
              EXISTS (
                SELECT 1 FROM purchase_order_items poi
                JOIN purchase_orders po ON po.id = poi.po_id
                WHERE po.status <> 'cancelled'
                  AND poi.quantity_delivered < poi.quantity_ordered
                  AND poi.order_item_id = oi.id
              )
              OR EXISTS (
                SELECT 1 FROM purchase_order_items poi
                JOIN purchase_orders po ON po.id = poi.po_id
                WHERE po.status <> 'cancelled'
                  AND poi.quantity_delivered < poi.quantity_ordered
                  AND COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> to_jsonb(oi.id)
              )
          )
        )
      ORDER BY oi.id
    `);
    const itemIds = (pendingRows.rows as any[]).map((r: any) => Number(r.id));

    const poStatusMap = new Map<number, { poNumber: string; poStatus: string; estimatedDelivery: Date | null; supplierName: string | null }>();
    if (itemIds.length > 0) {
      const poRows = await db.execute(sql`
        SELECT oi_id, po_number, po_status, estimated_delivery_date, supplier_name FROM (
          SELECT poi.order_item_id::integer AS oi_id,
                 po.po_number, po.status AS po_status, po.estimated_delivery_date, po.supplier_name
          FROM purchase_order_items poi INNER JOIN purchase_orders po ON poi.po_id = po.id
          WHERE po.status IN ('draft','ordered','delivered')
            AND poi.quantity_delivered < poi.quantity_ordered
            AND poi.order_item_id = ANY(ARRAY[${sql.raw(itemIds.join(","))}]::integer[])
          UNION ALL
          SELECT (elem.value)::integer AS oi_id,
                 po.po_number, po.status AS po_status, po.estimated_delivery_date, po.supplier_name
          FROM purchase_order_items poi INNER JOIN purchase_orders po ON poi.po_id = po.id,
          jsonb_array_elements_text(COALESCE(poi.source_order_item_ids,'[]'::jsonb)) AS elem(value)
          WHERE po.status IN ('draft','ordered','delivered')
            AND poi.quantity_delivered < poi.quantity_ordered
            AND jsonb_array_length(COALESCE(poi.source_order_item_ids,'[]'::jsonb)) > 0
            AND (elem.value)::integer = ANY(ARRAY[${sql.raw(itemIds.join(","))}]::integer[])
        ) t
      `);
      for (const row of poRows.rows as any[]) {
        const id = Number(row.oi_id);
        if (!poStatusMap.has(id)) {
          poStatusMap.set(id, {
            poNumber: row.po_number as string,
            poStatus: row.po_status === "delivered" ? "backorder" : row.po_status as string,
            estimatedDelivery: row.estimated_delivery_date ? new Date(row.estimated_delivery_date) : null,
            supplierName: row.supplier_name as string | null,
          });
        }
      }
    }

    for (const row of pendingRows.rows as any[]) {
      const oid = Number(row.order_id);
      if (!pendingItemsByOrderId.has(oid)) pendingItemsByOrderId.set(oid, []);
      const po = poStatusMap.get(Number(row.id)) ?? null;
      pendingItemsByOrderId.get(oid)!.push({
        id: Number(row.id),
        productName: (row.catalogue_name ?? row.product_name) as string,
        colour: row.colour as string | null,
        size: row.size as string | null,
        purchaseQuantity: Number(row.purchase_quantity ?? row.quantity ?? 1),
        supplierName: po?.supplierName ?? row.supplier_name as string | null,
        supplierCode: (row.supplier_code as string | null) ?? null,
        productSku: (row.product_sku as string | null) ?? null,
        poNumber: po?.poNumber ?? null,
        poStatus: po?.poStatus ?? null,
        estimatedDelivery: po?.estimatedDelivery ?? null,
      });
    }
  }

  const buildBase = (o: typeof stats[0]) => ({
    id: Number(o.id),
    orderNumber: o.order_number,
    customerId: o.customer_id ? Number(o.customer_id) : null,
    customerName: o.customer_name,
    requiredDate: o.required_date,
    totalAmount: o.total_amount ? parseFloat(o.total_amount) : 0,
  });

  res.json({
    allReady: allReadyStats.map(o => ({
      ...buildBase(o),
      items: readyItemsByOrderId.get(Number(o.id)) ?? [],
    })),
    partInStock: partInStockStats.map(o => ({
      ...buildBase(o),
      readyItems: readyItemsByOrderId.get(Number(o.id)) ?? [],
      pendingItems: pendingItemsByOrderId.get(Number(o.id)) ?? [],
    })),
    allAwaitingStock: allAwaitingStats.map(o => ({
      orderId: Number(o.id),
      orderNumber: o.order_number,
      customerName: o.customer_name,
      requiredDate: o.required_date,
      items: pendingItemsByOrderId.get(Number(o.id)) ?? [],
    })),
  });
});

// ── Daily Work Plan ───────────────────────────────────────────────────────────
// Returns all active production work grouped by finish type so staff can
// batch identical processes together and prioritise by required date.
function addWorkingDays(from: Date, days: number): Date {
  const result = new Date(from);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

router.get("/production/daily-plan", async (req, res): Promise<void> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // End of 2nd working day from today (cutoff for "Today's Plan")
  const twoDaysCutoff = addWorkingDays(today, 2);

  // 1. Picking list items that need decoration (finish set)
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

  // 2. All active worksheet items (pre_wip + wip)
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

    // Earliest required date across every item in this finish group
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

    // Sub-group by order + stage so each worksheet / picking batch is one row
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
        requiredDate:    first.required_date ? new Date(first.required_date).toISOString() : null,
        qty:             taskRows.reduce((s: number, r: any) => s + Number(r.quantity), 0),
        items:           taskRows.map((r: any) => ({
          productName: r.product_name    as string,
          colour:      r.colour          as string | null,
          size:        r.size            as string | null,
          qty:         Number(r.quantity),
          recipient:   (r.recipient_name ?? r.recipient_type) as string | null,
        })),
      };
    });

    // Within each group: wip first → pre_wip → picking; then by required date
    const stageOrder: Record<string, number> = { wip: 0, pre_wip: 1, picking: 2 };
    tasks.sort((a, b) => {
      const sa = stageOrder[a.type] ?? 3;
      const sb = stageOrder[b.type] ?? 3;
      if (sa !== sb) return sa - sb;
      if (a.requiredDate && b.requiredDate)
        return new Date(a.requiredDate).getTime() - new Date(b.requiredDate).getTime();
      return 0;
    });

    return {
      finishName,
      customerName: finishName,
      finishes,
      totalQty,
      orderCount: new Set(rows.map((r: any) => r.order_id).filter(Boolean)).size,
      overallStatus,
      urgency,
      daysUntilDue,
      earliestRequired: earliestDate?.toISOString() ?? null,
      tasks,
    };
  });

  // Sort groups: overdue → today → soon → this_week → upcoming
  const urgencyOrder: Record<string, number> = {
    overdue: 0, today: 1, soon: 2, this_week: 3, upcoming: 4,
  };
  taskGroups.sort((a, b) => {
    const ua = urgencyOrder[a.urgency] ?? 5;
    const ub = urgencyOrder[b.urgency] ?? 5;
    if (ua !== ub) return ua - ub;
    if (a.daysUntilDue !== null && b.daysUntilDue !== null)
      return a.daysUntilDue - b.daysUntilDue;
    return 0;
  });

  const urgentCount = taskGroups.filter(
    (g) => g.urgency === "overdue" || g.urgency === "today" || g.urgency === "soon"
  ).length;

  res.json({
    generatedAt: new Date().toISOString(),
    taskGroups,
    summary: {
      overdue:    taskGroups.filter((g) => g.urgency === "overdue").length,
      today:      taskGroups.filter((g) => g.urgency === "today").length,
      soon:       taskGroups.filter((g) => g.urgency === "soon").length,
      thisWeek:   taskGroups.filter((g) => g.urgency === "this_week").length,
      upcoming:   taskGroups.filter((g) => g.urgency === "upcoming").length,
      urgentCount,
      urgentItems: taskGroups
        .filter((g) => g.urgency === "overdue" || g.urgency === "today" || g.urgency === "soon")
        .reduce((s, g) => s + g.totalQty, 0),
      totalItems: taskGroups.reduce((s, g) => s + g.totalQty, 0),
    },
  });
});

router.get("/worksheets", async (req, res): Promise<void> => {
  const parsed = z.object({ status: z.string().optional() }).safeParse(req.query);
  const statusFilter = parsed.success ? parsed.data.status : undefined;

  const rows = statusFilter
    ? await db.select().from(worksheetsTable).where(eq(worksheetsTable.status, statusFilter)).orderBy(desc(worksheetsTable.createdAt))
    : await db.select().from(worksheetsTable).orderBy(desc(worksheetsTable.createdAt));

  const wsIds = rows.map((w) => w.id);
  const items = wsIds.length > 0
    ? await db.select().from(worksheetItemsTable).where(inArray(worksheetItemsTable.worksheetId, wsIds))
    : [];

  // Fetch requiredDate + invoice/dispatch status from orders
  const orderIds = [...new Set(rows.filter((w) => w.orderId != null).map((w) => w.orderId!))];
  const orderDates = orderIds.length > 0
    ? await db.select({
        id: ordersTable.id,
        requiredDate: ordersTable.requiredDate,
        orderStatus: ordersTable.status,
        dispatchedAt: ordersTable.dispatchedAt,
        invoiceEmailSentAt: ordersTable.invoiceEmailSentAt,
        xeroInvoiceId: ordersTable.xeroInvoiceId,
      })
        .from(ordersTable).where(inArray(ordersTable.id, orderIds))
    : [];
  const orderDateMap = new Map(orderDates.map((o) => [o.id, o]));

  const result = rows.map((ws) => {
    const orderRow = ws.orderId ? (orderDateMap.get(ws.orderId) ?? null) : null;
    return {
      ...ws,
      requiredDate: orderRow?.requiredDate ?? null,
      orderStatus: orderRow?.orderStatus ?? null,
      dispatchedAt: orderRow?.dispatchedAt ?? null,
      invoiceEmailSentAt: orderRow?.invoiceEmailSentAt ?? null,
      xeroInvoiceId: orderRow?.xeroInvoiceId ?? null,
      items: items.filter((i) => i.worksheetId === ws.id).map((i) => ({
        ...i,
        processes: i.processesSnapshot ? JSON.parse(i.processesSnapshot) : [],
      })),
    };
  });

  // Sort by F-number numerically ascending (F102 → F103 → F106), falling back to createdAt asc
  const fNum = (n: string | null | undefined) => {
    if (n && /^F[0-9]+$/.test(n)) return parseInt(n.slice(1), 10);
    return Infinity;
  };
  result.sort((a, b) => {
    const fa = fNum(a.worksheetNumber);
    const fb = fNum(b.worksheetNumber);
    if (fa !== fb) return fa - fb;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  res.json(result);
});

router.get("/worksheets/:id", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [ws] = await db.select().from(worksheetsTable).where(eq(worksheetsTable.id, parsed.data.id));
  if (!ws) { res.status(404).json({ error: "Worksheet not found" }); return; }

  const items = await db.select().from(worksheetItemsTable).where(eq(worksheetItemsTable.worksheetId, ws.id));

  // Look up the product SKU for each item via its linked order item.
  const orderItemIds = items.map(i => i.orderItemId).filter((id): id is number => id != null);
  const skuMap = new Map<number, string | null>();
  if (orderItemIds.length > 0) {
    const skuRows = await db.execute(sql`
      SELECT oi.id, p.sku
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.id = ANY(ARRAY[${sql.raw(orderItemIds.join(","))}]::integer[])
    `);
    for (const row of skuRows.rows as any[]) {
      skuMap.set(Number(row.id), (row.sku as string | null) ?? null);
    }
  }

  res.json({
    ...ws,
    items: items.map((i) => ({
      ...i,
      processes: i.processesSnapshot ? JSON.parse(i.processesSnapshot) : [],
      productSku: i.orderItemId ? (skuMap.get(i.orderItemId) ?? null) : null,
    })),
  });
});

router.post("/worksheets", async (req, res): Promise<void> => {
  const bodySchema = z.object({
    orderId: z.number().int().positive(),
    orderNumber: z.string(),
    customerId: z.number().int().positive().optional().nullable(),
    customerName: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    itemIds: z.array(z.number().int().positive()),
    returnItemIds: z.array(z.number().int().positive()).optional(),
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Return excluded items to purchasing (de-allocate from stock)
  if (parsed.data.returnItemIds && parsed.data.returnItemIds.length > 0) {
    const returnItems = await db.select().from(orderItemsTable)
      .where(inArray(orderItemsTable.id, parsed.data.returnItemIds));
    for (const item of returnItems) {
      await db.update(orderItemsTable)
        .set({ stockStatus: null, purchaseRequired: true, stockAllocatedAt: null })
        .where(eq(orderItemsTable.id, item.id));
      if (item.productId != null) {
        await db.execute(
          sql`UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) - ${item.quantity} WHERE id = ${item.productId}`
        );
      }
    }
  }

  const requestedOrderItems = await db
    .select()
    .from(orderItemsTable)
    .where(and(
      inArray(orderItemsTable.id, parsed.data.itemIds),
      eq(orderItemsTable.orderId, parsed.data.orderId),
    ));

  if (requestedOrderItems.length === 0) {
    res.status(400).json({ error: "No valid order items found" });
    return;
  }

  // Worksheet history is authoritative. Stock status can be reset by allocation
  // and correction flows, so it is not sufficient as a duplicate guard.
  const existingWorksheetRows = await db.execute(sql`
    SELECT DISTINCT wi.order_item_id, w.worksheet_number
    FROM worksheet_items wi
    INNER JOIN worksheets w ON w.id = wi.worksheet_id
    WHERE wi.order_item_id IN (${sql.join(requestedOrderItems.map(item => sql`${item.id}`), sql`, `)})
  `);
  const existingWorksheetByItemId = new Map<number, string>(
    (existingWorksheetRows.rows as Array<{ order_item_id: number; worksheet_number: string }>)
      .map(row => [Number(row.order_item_id), row.worksheet_number]),
  );
  const orderItems = requestedOrderItems.filter(item => !existingWorksheetByItemId.has(item.id));

  if (orderItems.length === 0) {
    const worksheetNumbers = [...new Set(existingWorksheetByItemId.values())].join(", ");
    res.status(409).json({
      error: `These items are already on ${worksheetNumbers || "an existing worksheet"}. Refresh the page to see it.`,
    });
    return;
  }

  // Plain items (no finish) go straight to dispatch — no worksheet needed
  const plainItems = orderItems.filter(oi => oi.finishId == null);
  const decoratedItems = orderItems.filter(oi => oi.finishId != null);

  // Look up supplier codes for decorated items
  const productIds = decoratedItems.map(i => i.productId).filter((id): id is number => id != null);
  const productRows = productIds.length > 0
    ? await db.select({ id: productsTable.id, supplierCode: productsTable.supplierCode })
        .from(productsTable).where(inArray(productsTable.id, productIds))
    : [];
  const supplierCodeMap = new Map(productRows.map(p => [p.id, p.supplierCode ?? null]));

  if (plainItems.length > 0) {
    await db.update(orderItemsTable)
      .set({ stockStatus: "complete" })
      .where(inArray(orderItemsTable.id, plainItems.map(i => i.id)));
  }

  // If nothing needs decoration, skip worksheet creation entirely
  if (decoratedItems.length === 0) {
    res.status(200).json({ worksheetNumber: null, plainCompleted: plainItems.length, items: [] });
    return;
  }

  const worksheetNumber = await generateWorksheetNumber();
  const [ws] = await db
    .insert(worksheetsTable)
    .values({
      worksheetNumber,
      status: "wip",
      orderId: parsed.data.orderId,
      orderNumber: parsed.data.orderNumber,
      customerId: parsed.data.customerId ?? null,
      customerName: parsed.data.customerName ?? null,
      notes: parsed.data.notes ?? null,
    })
    .returning();

  const wsItems = await Promise.all(
    decoratedItems.map(async (oi) => {
      let processesSnapshot: string | null = null;

      if (oi.finishId && parsed.data.customerId) {
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
            processes.map((p) => ({
              id: p.id,
              name: p.name,
              type: p.type,
              placement: p.placement,
              price: p.price ? parseFloat(p.price) : null,
              notes: p.notes,
            }))
          );
        }
      }

      return db.insert(worksheetItemsTable).values({
        worksheetId: ws.id,
        orderItemId: oi.id,
        productName: oi.productName,
        colour: oi.colour ?? null,
        size: oi.size ?? null,
        quantity: oi.quantity - (oi.purchaseQuantity ?? 0),
        recipientType: oi.recipientType,
        recipientName: oi.recipientName ?? null,
        finishId: oi.finishId ?? null,
        finishName: oi.finishName ?? null,
        processesSnapshot,
        supplierCode: oi.productId != null ? (supplierCodeMap.get(oi.productId) ?? null) : null,
      }).returning();
    })
  );

  // Move decorated items to in_production and clear any stale purchase_required flag
  await db
    .update(orderItemsTable)
    .set({ stockStatus: "in_production", purchaseRequired: false, purchaseQuantity: null })
    .where(inArray(orderItemsTable.id, decoratedItems.map(i => i.id)));

  if (ws.orderId) {
    await logOrderAction(ws.orderId, "Production worksheet created", getActor(req),
      `Worksheet ${ws.worksheetNumber} created with ${wsItems.flat().length} item(s)`);
  }

  // Fetch requiredDate from the order so the print window can show it immediately
  let requiredDate: string | null = null;
  if (ws.orderId) {
    const [orderRow] = await db
      .select({ requiredDate: ordersTable.requiredDate })
      .from(ordersTable)
      .where(eq(ordersTable.id, ws.orderId));
    requiredDate = orderRow?.requiredDate ? orderRow.requiredDate.toISOString() : null;
  }

  res.status(201).json({
    ...ws,
    requiredDate,
    skippedExistingItems: requestedOrderItems.length - orderItems.length,
    items: wsItems.flat().map((i) => ({
      ...i,
      processes: i.processesSnapshot ? JSON.parse(i.processesSnapshot) : [],
    })),
  });
});

router.patch("/worksheets/:id", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const bodySchema = z.object({
    status: z.enum(["pre_wip", "wip", "complete"]).optional(),
    notes: z.string().optional().nullable(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const updateData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.status === "complete") {
    updateData.completedAt = new Date();
  }

  const [ws] = await db
    .update(worksheetsTable)
    .set(updateData)
    .where(eq(worksheetsTable.id, params.data.id))
    .returning();

  if (!ws) { res.status(404).json({ error: "Worksheet not found" }); return; }

  // When marking complete, move all linked order items to 'complete' so they
  // leave the picking list and don't appear as outstanding work.
  if (parsed.data.status === "complete") {
    const wsItems = await db
      .select({ orderItemId: worksheetItemsTable.orderItemId })
      .from(worksheetItemsTable)
      .where(eq(worksheetItemsTable.worksheetId, ws.id));
    const orderItemIds = wsItems.map((i) => i.orderItemId).filter((id): id is number => id != null);
    if (orderItemIds.length > 0) {
      await db
        .update(orderItemsTable)
        .set({ stockStatus: "complete" })
        .where(inArray(orderItemsTable.id, orderItemIds));
    }
  }

  if (ws.orderId && parsed.data.status) {
    const statusLabels: Record<string, string> = { pre_wip: "Production started (pre-WIP)", wip: "Production in progress (WIP)", complete: "Production completed" };
    await logOrderAction(ws.orderId, statusLabels[parsed.data.status] ?? `Worksheet status: ${parsed.data.status}`, getActor(req),
      `Worksheet ${ws.worksheetNumber}`);
  }

  res.json(ws);
});

// PATCH /worksheets/:wsId/items/:itemId — adjust quantity on a single worksheet item.
// If qty reaches 0 the item is deleted from the worksheet.
router.patch("/worksheets/:wsId/items/:itemId", async (req, res): Promise<void> => {
  const params = z.object({
    wsId: z.coerce.number().int().positive(),
    itemId: z.coerce.number().int().positive(),
  }).safeParse(req.params);
  const body = z.object({ quantity: z.number().int().min(0) }).safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid parameters" }); return; }

  const { wsId, itemId } = params.data;
  const { quantity } = body.data;

  if (quantity <= 0) {
    await db.delete(worksheetItemsTable)
      .where(and(eq(worksheetItemsTable.id, itemId), eq(worksheetItemsTable.worksheetId, wsId)));
  } else {
    const [updated] = await db.update(worksheetItemsTable)
      .set({ quantity })
      .where(and(eq(worksheetItemsTable.id, itemId), eq(worksheetItemsTable.worksheetId, wsId)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Worksheet item not found" }); return; }
  }

  res.json({ ok: true });
});

// Return all items in a worksheet back to the picking list (stockStatus → 'allocated')
// then delete the worksheet.
router.post("/worksheets/:id/return-to-picking", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const wsId = parsed.data.id;

  // Get all worksheet items so we know which order items to reset
  const items = await db
    .select({ orderItemId: worksheetItemsTable.orderItemId })
    .from(worksheetItemsTable)
    .where(eq(worksheetItemsTable.worksheetId, wsId));

  const orderItemIds = items.map((i) => i.orderItemId).filter((id): id is number => id != null);

  // Reset order items back to allocated (returns them to the picking list)
  if (orderItemIds.length > 0) {
    await db
      .update(orderItemsTable)
      .set({ stockStatus: "allocated", stockAllocatedAt: new Date() })
      .where(inArray(orderItemsTable.id, orderItemIds));
  }

  // Delete the worksheet (cascade deletes worksheet_items)
  const [ws] = await db.delete(worksheetsTable).where(eq(worksheetsTable.id, wsId)).returning();
  if (!ws) { res.status(404).json({ error: "Worksheet not found" }); return; }

  res.json({ ok: true, resetItems: orderItemIds.length });
});

router.delete("/worksheets/:id", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [ws] = await db.delete(worksheetsTable).where(eq(worksheetsTable.id, parsed.data.id)).returning();
  if (!ws) { res.status(404).json({ error: "Worksheet not found" }); return; }
  res.sendStatus(204);
});

// Force-clear purchasing flags for a stuck order.
// Used when stock has physically arrived but the system hasn't automatically
// detected it (e.g. PO link broken, quantity_delivered not recorded).
// Plain items (no finish) → stock_status='complete' (go to dispatch).
// Decorated items (with finish) → stock_status='allocated' (go to picking list).
router.post("/production/orders/:id/force-clear-stock", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const orderId = parsed.data.id;

  const result = await db.execute(sql`
    UPDATE order_items oi
    SET purchase_required  = false,
        purchase_quantity  = NULL,
        stock_status       = CASE WHEN oi.finish_id IS NULL THEN 'complete' ELSE 'allocated' END,
        stock_allocated_at = NOW()
    FROM orders o
    WHERE oi.order_id = o.id
      AND oi.order_id = ${orderId}
      AND oi.dispatched_at IS NULL
      AND COALESCE(oi.stock_status, 'pending') NOT IN ('in_production', 'complete')
      AND o.status NOT IN ('shipped', 'completed', 'delivered', 'invoiced', 'cancelled', 'archived')
      AND NOT EXISTS (
        SELECT 1 FROM products p
        WHERE p.id = oi.product_id AND COALESCE(p.is_service, false) = true
      )
      AND NOT EXISTS (
        SELECT 1 FROM worksheet_items wi WHERE wi.order_item_id = oi.id
      )
  `);

  res.json({ ok: true, updated: result.rowCount ?? 0 });
});

export default router;
