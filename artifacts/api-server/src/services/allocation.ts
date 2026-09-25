/**
 * Smart stock allocation service.
 *
 * When a purchase order is delivered, this service:
 *  1. Finds the order items that were waiting for this stock.
 *  2. Groups them by order and sorts by required date (soonest first) so that
 *     complete, on-time orders are prioritised when stock is short.
 *  3. All fully-delivered items are placed on the picking list (stockStatus = 'allocated').
 *  4. Production worksheets are created later, at pick time, for items with a finish.
 *
 * Fallback: when a PO line has orderId set but no orderItemId / sourceOrderItemIds,
 * the service matches order items by orderId + productName + colour + size.
 * This covers POs that were created without wiring up individual item IDs.
 */

import { eq, inArray, and } from "drizzle-orm";
import {
  db,
  orderItemsTable,
  ordersTable,
  purchaseOrderItemsTable,
  worksheetItemsTable,
} from "@workspace/db";

export interface AllocationResult {
  ordersAffected: number;
  worksheetsCreated: number;
  worksheetsUpdated: number;
  pickingItems: number;
  summary: Array<{
    orderId: number;
    orderNumber: string;
    customerName: string | null;
    worksheetNumber: string | null;
    pickingCount: number;
    worksheetCount: number;
  }>;
}


export async function allocatePODelivery(poId: number): Promise<AllocationResult> {
  const poItems = await db
    .select()
    .from(purchaseOrderItemsTable)
    .where(eq(purchaseOrderItemsTable.poId, poId));
  const garmentPoItems = poItems.filter((item) => item.processStockId == null);

  // ── Direct links (legacy orderItemId + consolidated sourceOrderItemIds) ─────
  const directLinkedIds = [
    ...new Set([
      ...garmentPoItems.map((i) => i.orderItemId).filter((id): id is number => id != null),
      ...garmentPoItems.flatMap((i) => (i.sourceOrderItemIds as number[] | null) ?? []),
    ]),
  ];

  // ── Fallback: match by orderId + productName + colour + size ──────────────
  // Used when a PO line has orderId set but no direct order item link.
  // Only applies to fully-delivered lines.
  const fallbackIds = new Set<number>();
  const unlinkedPoItems = garmentPoItems.filter(poi =>
    poi.orderId != null &&
    poi.quantityOrdered > 0 &&
    poi.quantityDelivered >= poi.quantityOrdered &&
    poi.orderItemId == null &&
    ((poi.sourceOrderItemIds as number[] | null)?.length ?? 0) === 0
  );

  if (unlinkedPoItems.length > 0) {
    const orderIds = [...new Set(unlinkedPoItems.map(p => p.orderId as number))];
    for (const orderId of orderIds) {
      const candidates = await db
        .select({ id: orderItemsTable.id, productName: orderItemsTable.productName, colour: orderItemsTable.colour, size: orderItemsTable.size })
        .from(orderItemsTable)
        .where(and(
          eq(orderItemsTable.orderId, orderId),
          eq(orderItemsTable.purchaseRequired, true),
        ));

      for (const poi of unlinkedPoItems.filter(p => p.orderId === orderId)) {
        const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
        const matched = candidates.filter(oi =>
          norm(oi.productName) === norm(poi.productName) &&
          norm(oi.colour) === norm(poi.colour) &&
          norm(oi.size) === norm(poi.size)
        );
        if (matched.length === 1) {
          fallbackIds.add(matched[0].id);
        } else if (matched.length > 1) {
          // A PO line without a direct order-item link is unsafe when more than
          // one identical-looking line exists. Do not allocate or mutate stock.
          console.warn(
            `[allocation] Ambiguous fallback for PO ${poId}, order ${orderId}, product "${poi.productName}", ` +
            `${poi.colour ?? "no colour"}/${poi.size ?? "no size"}: ${matched.length} candidates`,
          );
        }
      }
    }

    // Clear purchaseRequired on fallback items — the calling route handles this
    // for direct-linked items, but fallback items need it done here.
    const fallbackArr = [...fallbackIds];
    if (fallbackArr.length > 0) {
      await db.update(orderItemsTable)
        .set({ purchaseRequired: false, purchaseQuantity: null })
        .where(inArray(orderItemsTable.id, fallbackArr));
    }
  }

  const linkedOrderItemIds = [...new Set([...directLinkedIds, ...fallbackIds])];

  if (linkedOrderItemIds.length === 0) {
    return { ordersAffected: 0, worksheetsCreated: 0, worksheetsUpdated: 0, pickingItems: 0, summary: [] };
  }

  // Build a map: orderItemId → the PO line that covers it.
  // Fallback items are treated as fully delivered (already filtered above).
  const poItemByOrderItemId = new Map<number, typeof garmentPoItems[0]>();
  for (const poi of garmentPoItems) {
    const allIds: number[] = [
      ...((poi.sourceOrderItemIds as number[] | null) ?? []),
      ...(poi.orderItemId != null ? [poi.orderItemId] : []),
    ];
    for (const id of allIds) {
      if (!poItemByOrderItemId.has(id)) poItemByOrderItemId.set(id, poi);
    }
  }

  // Fetch the linked order items and their orders
  const rows = await db
    .select({ item: orderItemsTable, order: ordersTable })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .where(inArray(orderItemsTable.id, linkedOrderItemIds));

  const rowByItemId = new Map(rows.map(({ item }) => [item.id, item]));
  const coveredOrderItemIds = new Set<number>(fallbackIds);
  for (const poi of garmentPoItems) {
    const orderedLinkedIds = [
      ...new Set([
        ...((poi.sourceOrderItemIds as number[] | null) ?? []),
        ...(poi.orderItemId != null ? [poi.orderItemId] : []),
      ]),
    ];
    if (poi.quantityOrdered > 0 && poi.quantityDelivered >= poi.quantityOrdered) {
      for (const id of orderedLinkedIds) coveredOrderItemIds.add(id);
      continue;
    }

    const savedQuantities = (poi.sourceOrderItemQuantities as Array<{ orderItemId: number; quantity: number }> | null) ?? [];
    const savedQuantityTotal = savedQuantities.reduce((total, source) => total + Math.max(0, source.quantity), 0);
    const inferredQuantities = orderedLinkedIds.map((id) => ({
      orderItemId: id,
      quantity: Math.max(0, rowByItemId.get(id)?.quantity ?? 0),
    }));
    const inferredQuantityTotal = inferredQuantities.reduce((total, source) => total + source.quantity, 0);
    const sourceQuantities = savedQuantities.length > 0 && savedQuantityTotal === poi.quantityOrdered
      ? savedQuantities
      : inferredQuantityTotal === poi.quantityOrdered
        ? inferredQuantities
        : [];

    let receivedRemaining = Math.max(0, poi.quantityDelivered);
    for (const source of sourceQuantities) {
      const requiredQuantity = Math.max(0, source.quantity);
      if (requiredQuantity > 0 && receivedRemaining >= requiredQuantity) {
        coveredOrderItemIds.add(source.orderItemId);
      }
      receivedRemaining = Math.max(0, receivedRemaining - requiredQuantity);
    }
  }

  // A consolidated PO line can cover several sales-order lines. Release each
  // complete line as soon as the cumulative receipt covers its full quantity;
  // the following linked lines remain pending until later receipts.
  const fullyDelivered = rows.filter(({ item }) => {
    const poi = poItemByOrderItemId.get(item.id);
    if (!poi) return fallbackIds.has(item.id);
    return coveredOrderItemIds.has(item.id);
  });

  const notYetCovered = rows
    .map(({ item }) => item)
    .filter((item) => poItemByOrderItemId.has(item.id) && !coveredOrderItemIds.has(item.id) && !item.dispatchedAt);
  for (const item of notYetCovered) {
    const allocationOwnedStatus =
      item.stockStatus === "allocated" ||
      (item.finishId == null && item.stockStatus === "complete");
    if (allocationOwnedStatus) {
      await db.update(orderItemsTable)
        .set({ stockStatus: null, stockAllocatedAt: null })
        .where(eq(orderItemsTable.id, item.id));
    }
  }

  // Group by order, sort by requiredDate (soonest first)
  const orderGroups = new Map<
    number,
    { order: typeof ordersTable.$inferSelect; items: typeof orderItemsTable.$inferSelect[] }
  >();
  for (const { item, order } of fullyDelivered) {
    if (!orderGroups.has(order.id)) orderGroups.set(order.id, { order, items: [] });
    orderGroups.get(order.id)!.items.push(item);
  }

  const sortedOrders = [...orderGroups.values()].sort((a, b) => {
    if (!a.order.requiredDate) return 1;
    if (!b.order.requiredDate) return -1;
    return new Date(a.order.requiredDate).getTime() - new Date(b.order.requiredDate).getTime();
  });

  let worksheetsCreated = 0;
  let worksheetsUpdated = 0;
  let pickingItems = 0;
  const summary: AllocationResult["summary"] = [];

  for (const { order, items } of sortedOrders) {
    let wsPickCount = 0;

    for (const item of items) {
      if (item.stockStatus === "allocated" || item.stockStatus === "in_production" || item.stockStatus === "complete") {
        // Already progressed past picking. If more units for this line arrived on
        // a later (topped-up) delivery — e.g. a backorder was booked in after the
        // item was already sent to production — the worksheet item created earlier
        // can be left short of the true required quantity. Top it up so the extra
        // units actually reach production/picking instead of silently vanishing.
        const [wsItem] = await db
          .select()
          .from(worksheetItemsTable)
          .where(eq(worksheetItemsTable.orderItemId, item.id));
        const requiredQty = item.quantity ?? 0;
        if (wsItem && wsItem.quantity < requiredQty) {
          await db
            .update(worksheetItemsTable)
            .set({ quantity: requiredQty })
            .where(eq(worksheetItemsTable.id, wsItem.id));
          worksheetsUpdated++;
        }
        // Items already on the picking list ('allocated') were pre-allocated by
        // the safety-net before the PO was formally booked in.  Count them so
        // the book-in still triggers picking-slip printing.
        // 'in_production' and 'complete' are past picking — don't re-print.
        if (item.stockStatus === "allocated") {
          wsPickCount++;
          pickingItems++;
        }
        continue;
      }
      // Plain items (no decoration) skip the picking list and go straight to complete;
      // decorated items land on the picking list as 'allocated' until physically picked.
      const isPlain = item.finishId == null;
      await db
        .update(orderItemsTable)
        .set({ stockStatus: isPlain ? "complete" : "allocated", stockAllocatedAt: new Date() })
        .where(eq(orderItemsTable.id, item.id));
      pickingItems++;
      wsPickCount++;
    }

    summary.push({
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerName: order.customerName ?? null,
      worksheetNumber: null,
      pickingCount: wsPickCount,
      worksheetCount: 0,
    });
  }

  return { ordersAffected: sortedOrders.length, worksheetsCreated, worksheetsUpdated, pickingItems, summary };
}
