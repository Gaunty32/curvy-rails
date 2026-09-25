import { Router, type IRouter } from "express";
import { eq, inArray, and, notInArray, desc, asc, or, ilike, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db, ordersTable, orderItemsTable, worksheetsTable, worksheetItemsTable,
  customerEmployeesTable, customerDeliveryAddressesTable, customersTable, productsTable,
  customerTeamsTable,
  purchaseOrdersTable, purchaseOrderItemsTable,
} from "@workspace/db";
import { bookDpdConsignment, reprrintDpdLabel, isDpdConfigured, isChannelIslandsPostcode } from "../services/dpd.js";
import { logOrderAction, getActor } from "../services/orderLog";
import { notifyAllPortalUsers } from "../services/notifications.js";
import { fireWorkflow } from "../services/workflow-engine.js";
import { getWooSettings, wooUpdateOrderStatus } from "./woo.js";
import { resolveDispatchAddress } from "../lib/dispatch-address.js";
import {
  getManagerPackingCustomerIds,
  isManagerPackingEnabled,
  setManagerPackingEnabled,
} from "../lib/customer-dispatch-settings.js";

const router: IRouter = Router();

function htmlEscape(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] ?? ch));
}

async function getOutstandingPoItemIds(itemIds: number[]): Promise<Set<number>> {
  if (!itemIds.length) return new Set();
  const result = await db.execute(sql`
    SELECT DISTINCT oi.id
    FROM order_items oi
    WHERE oi.id IN (${sql.join(itemIds.map(id => sql`${id}`), sql`, `)})
      AND oi.dispatched_at IS NULL
      AND (
        EXISTS (
          SELECT 1 FROM purchase_order_items poi
          JOIN purchase_orders po ON po.id = poi.po_id
          WHERE po.status <> 'cancelled'
            AND poi.quantity_delivered < poi.quantity_ordered
            AND poi.quantity_ordered > 0
            AND (poi.order_item_id = oi.id OR COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> jsonb_build_array(oi.id))
        )
        OR EXISTS (
          SELECT 1 FROM purchase_order_items poi
          JOIN purchase_orders po ON po.id = poi.po_id
          WHERE po.status <> 'cancelled'
            AND poi.quantity_delivered < poi.quantity_ordered
            AND poi.quantity_ordered > 0
            AND poi.order_id = oi.order_id
            AND poi.order_item_id IS NULL
            AND (poi.source_order_item_ids IS NULL OR poi.source_order_item_ids = '[]'::jsonb)
            AND LOWER(TRIM(COALESCE(poi.product_name,''))) = LOWER(TRIM(COALESCE(oi.product_name,'')))
            AND LOWER(TRIM(COALESCE(poi.colour,''))) = LOWER(TRIM(COALESCE(oi.colour,'')))
            AND LOWER(TRIM(COALESCE(poi.size,''))) = LOWER(TRIM(COALESCE(oi.size,'')))
        )
      )
  `);
  return new Set((result.rows as any[]).map(row => Number(row.id)));
}

/**
 * Builds the customs value + goods description DPD requires for Channel
 * Islands deliveries (Jersey/Guernsey) — see isChannelIslandsPostcode. Not
 * needed (and left undefined) for mainland UK addresses.
 */
async function getCustomsInfoIfNeeded(
  orderId: number,
  orderTotal: string | number | null,
  postcode: string | null | undefined
): Promise<{ customsValue?: number; parcelDescription?: string }> {
  if (!isChannelIslandsPostcode(postcode)) return {};

  const items = await db.select({
    productName: orderItemsTable.productName,
    lineTotal: orderItemsTable.lineTotal,
  }).from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));

  // Customs declarations require a genuine non-zero value — fall back to a
  // nominal £1 if the order (or every line) is priced at £0 (e.g. internal
  // transfers, samples), since DPD rejects a zero/blank customs value.
  const totalFromOrder = parseFloat(String(orderTotal ?? "0")) || 0;
  const totalFromItems = items.reduce((sum, i) => sum + (parseFloat(String(i.lineTotal ?? "0")) || 0), 0);
  const customsValue = Math.max(totalFromOrder, totalFromItems, 1);

  const description = [...new Set(items.map(i => i.productName).filter(Boolean))].join(", ").slice(0, 100)
    || "Branded clothing / merchandise";

  return { customsValue, parcelDescription: description };
}

type DispatchableItem = typeof orderItemsTable.$inferSelect;

async function getDpdDeliveryAddress(
  order: typeof ordersTable.$inferSelect,
  items: DispatchableItem[],
): Promise<
  | { ok: true; address: { line1: string; line2?: string; town: string; postcode: string; countryCode: string }; auditLabel: string }
  | { ok: false; error: string }
> {
  const employeeIds = [...new Set(
    items.map(item => item.recipientEmployeeId).filter((id): id is number => id != null),
  )];
  const employeeRows = employeeIds.length > 0
    ? await db.select({
        id: customerEmployeesTable.id,
        deliveryAddressId: (customerEmployeesTable as any).deliveryAddressId,
      }).from(customerEmployeesTable).where(inArray(customerEmployeesTable.id, employeeIds))
    : [];
  const employeeAddressById = new Map(
    employeeRows.map(row => [row.id, row.deliveryAddressId as number | null]),
  );

  const resolution = resolveDispatchAddress(
    order.deliveryAddressId,
    items.map(item => ({
      employeeAddressId: item.recipientEmployeeId != null
        ? employeeAddressById.get(item.recipientEmployeeId) ?? null
        : null,
    })),
  );

  if (resolution.kind === "conflict") {
    const addressRows = await db.select()
      .from(customerDeliveryAddressesTable)
      .where(inArray(customerDeliveryAddressesTable.id, resolution.addressIds));
    const destinations = addressRows.map(address =>
      `${address.label || address.line1 || `Address ${address.id}`} (${address.postcode || "no postcode"})`
    );
    return {
      ok: false,
      error: `DPD booking blocked: the items in this shipment have multiple delivery addresses${destinations.length ? ` — ${destinations.join("; ")}` : ""}. Split them into separate orders before dispatching.`,
    };
  }

  if (resolution.kind === "single") {
    const [address] = await db.select()
      .from(customerDeliveryAddressesTable)
      .where(eq(customerDeliveryAddressesTable.id, resolution.addressId));
    if (!address?.line1 || !address.postcode) {
      return { ok: false, error: "DPD booking blocked: the resolved delivery address is missing an address line or postcode." };
    }
    return {
      ok: true,
      address: {
        line1: address.line1,
        line2: address.line2 ?? undefined,
        town: address.city ?? "",
        postcode: address.postcode,
        countryCode: address.country === "United Kingdom" || !address.country ? "GB" : address.country,
      },
      auditLabel: `${address.label || address.line1}, ${address.postcode}`,
    };
  }

  if (order.customerId) {
    const [savedAddress] = await db.select().from(customerDeliveryAddressesTable)
      .where(eq(customerDeliveryAddressesTable.customerId, order.customerId))
      .orderBy(desc(customerDeliveryAddressesTable.isDefault), asc(customerDeliveryAddressesTable.id))
      .limit(1);
    if (savedAddress?.line1 && savedAddress.postcode) {
      return {
        ok: true,
        address: {
          line1: savedAddress.line1,
          line2: savedAddress.line2 ?? undefined,
          town: savedAddress.city ?? "",
          postcode: savedAddress.postcode,
          countryCode: savedAddress.country === "United Kingdom" || !savedAddress.country ? "GB" : savedAddress.country,
        },
        auditLabel: `${savedAddress.label || savedAddress.line1}, ${savedAddress.postcode}`,
      };
    }
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, order.customerId));
    if (customer?.address && customer.postcode) {
      return {
        ok: true,
        address: {
          line1: customer.address,
          town: customer.city ?? "",
          postcode: customer.postcode,
          countryCode: "GB",
        },
        auditLabel: `customer account address, ${customer.postcode}`,
      };
    }
  }

  return { ok: false, error: "DPD booking blocked: no complete delivery address could be resolved for these items." };
}

router.get("/dispatch/orders", async (req, res): Promise<void> => {
  const excludedStatuses = ["draft", "cancelled", "shipped", "delivered"];
  const managerPackingCustomerIds = await getManagerPackingCustomerIds();

  const fetchedOrders = await db
    .select()
    .from(ordersTable)
    .where(notInArray(ordersTable.status, excludedStatuses))
    .orderBy(ordersTable.requiredDate, ordersTable.createdAt);
  // Opted-in customers are handled in manager groups to avoid offering items twice.
  const orders = fetchedOrders.filter(order => !order.customerId || !managerPackingCustomerIds.includes(order.customerId));

  if (orders.length === 0) { res.json([]); return; }

  const orderIds = orders.map((o) => o.id);

  const worksheets = await db
    .select()
    .from(worksheetsTable)
    .where(inArray(worksheetsTable.orderId, orderIds));

  const wsIds = worksheets.map((w) => w.id);
  const wsItems = wsIds.length > 0
    ? await db.select().from(worksheetItemsTable).where(inArray(worksheetItemsTable.worksheetId, wsIds))
    : [];

  const orderItemRows = await db
    .select({ item: orderItemsTable, productSku: productsTable.sku, isService: productsTable.isService })
    .from(orderItemsTable)
    .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(inArray(orderItemsTable.orderId, orderIds));
  const orderItems = orderItemRows.map(r => ({ ...r.item, productSku: r.productSku ?? null, isService: r.isService ?? false }));

  // Item IDs that are still on outstanding PO lines — treat as "not ready" even if
  // stock_status='complete', because physical stock hasn't arrived yet.
  const blockedByPoItemIds = new Set<number>();
  if (orderItems.length > 0) {
    const blocked = await db.execute(sql`
      SELECT DISTINCT oi.id
      FROM order_items oi
      WHERE oi.order_id IN (${sql.join(orderIds.map(id => sql`${id}`), sql`, `)})
        AND oi.dispatched_at IS NULL
        AND (
          EXISTS (
            SELECT 1 FROM purchase_order_items poi
            JOIN purchase_orders po ON po.id = poi.po_id
            WHERE po.status <> 'cancelled'
              AND poi.quantity_delivered < poi.quantity_ordered
              AND poi.quantity_ordered > 0
              AND (
                poi.order_item_id = oi.id
                OR COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> jsonb_build_array(oi.id)
              )
          )
          OR EXISTS (
            SELECT 1 FROM purchase_order_items poi
            JOIN purchase_orders po ON po.id = poi.po_id
            WHERE po.status <> 'cancelled'
              AND poi.quantity_delivered < poi.quantity_ordered
              AND poi.quantity_ordered > 0
              AND poi.order_id = oi.order_id
              AND poi.order_item_id IS NULL
              AND (poi.source_order_item_ids IS NULL OR poi.source_order_item_ids = '[]'::jsonb)
              AND LOWER(TRIM(COALESCE(poi.product_name,''))) = LOWER(TRIM(COALESCE(oi.product_name,'')))
              AND LOWER(TRIM(COALESCE(poi.colour,'')))       = LOWER(TRIM(COALESCE(oi.colour,'')))
              AND LOWER(TRIM(COALESCE(poi.size,'')))         = LOWER(TRIM(COALESCE(oi.size,'')))
          )
        )
    `);
    for (const row of blocked.rows as any[]) {
      blockedByPoItemIds.add(Number(row.id));
    }
  }

  const employeeIds = [...new Set(orderItems.map((i) => i.recipientEmployeeId).filter((id): id is number => id != null))];
  const employees = employeeIds.length > 0
    ? await db.select().from(customerEmployeesTable).where(inArray(customerEmployeesTable.id, employeeIds))
    : [];

  const deliveryAddressIds = [...new Set(orders.map((o) => o.deliveryAddressId).filter((id): id is number => id != null))];
  // Also collect delivery addresses assigned at employee level (orders with no order-level address)
  const employeeDeliveryAddrIds = [...new Set(employees.map(e => (e as any).deliveryAddressId).filter((id): id is number => id != null))];
  const allAddrIds = [...new Set([...deliveryAddressIds, ...employeeDeliveryAddrIds])];
  const addresses = allAddrIds.length > 0
    ? await db.select().from(customerDeliveryAddressesTable).where(inArray(customerDeliveryAddressesTable.id, allAddrIds))
    : [];

  const result = orders
    .map((order) => {
      const orderWs = worksheets.filter((w) => w.orderId === order.id);
      const items = orderItems.filter((i) => i.orderId === order.id);

      const hasDecoratedItems = items.some(i => i.finishId != null);
      const hasIncompleteWorksheets = orderWs.some(w => w.status !== "complete");
      const isPartShipped = order.status === "part_shipped";

      // part_shipped: check only remaining (undispatched) items are ready for follow-up
      // confirmed: check all items are ready using the decoration-aware logic
      const remainingItems = isPartShipped ? items.filter(i => !i.dispatchedAt) : items;

      // Item IDs that are covered by a completed worksheet
      const wsCompleteItemIdsForOrder = new Set(
        orderWs.filter(w => w.status === "complete")
          .flatMap(w => wsItems.filter(wi => wi.worksheetId === w.id).map(wi => wi.orderItemId))
      );

      // Service items (e.g. logo digitising fees) have no physical stock and are never
      // on a worksheet — they must be ignored for all readiness checks.
      const isServiceItem = (i: typeof items[0]) => i.isService === true;

      // Items NOT on a completed worksheet that are not yet in a ready state —
      // e.g. plain items still in purchasing (ordered, purchaseRequired, etc.)
      // Items blocked by an outstanding PO are treated as outstanding UNLESS they
      // are already on a completed worksheet — if physical goods went through
      // production they have arrived, regardless of any secondary open POs.
      // Service items are never outstanding — they carry no stock obligation.
      const hasOutstandingItems = items.some(i =>
        !isServiceItem(i) &&
        !wsCompleteItemIdsForOrder.has(i.id) &&
        i.stockStatus !== "complete"
      );

      let allComplete: boolean;
      if (isPartShipped) {
        allComplete = remainingItems.length > 0 && remainingItems.every(i =>
          isServiceItem(i) ||
          wsCompleteItemIdsForOrder.has(i.id) ||
          i.stockStatus === "complete"
        );
      } else {
        // An order is complete when all items are done — either via a completed
        // worksheet, or directly (stock_status='complete' with no outstanding PO).
        // For decorated orders we normally require worksheets, but if every item is
        // already stock_status='complete' (e.g. service charges auto-completed) we
        // treat the order as ready without needing worksheets.
        // Service items are treated as always-complete — they have no stock or worksheet.
        const allItemsDirectlyComplete = items.every(
          i => isServiceItem(i) || i.stockStatus === "complete"
        );
        allComplete = items.length > 0 && !hasOutstandingItems && (
          hasDecoratedItems
            ? (orderWs.length > 0 && !hasIncompleteWorksheets) || allItemsDirectlyComplete
            : allItemsDirectlyComplete
        );
      }

      // Items that ARE ready to dispatch right now (complete worksheet, picked/plain-complete,
      // or a service item with no physical stock obligation).
      // 'allocated' means "in the picking list for production" — not ready for dispatch yet.
      // Items on a completed worksheet are always ready — the goods physically went through
      // production, so any secondary open PO is irrelevant for readiness.
      const hasAnyReadyItems = items.some(i =>
        isServiceItem(i) ||
        wsCompleteItemIdsForOrder.has(i.id) ||
        i.stockStatus === "complete"
      );

      // Show in dispatch queue if:
      //  • part_shipped (follow-up needed), OR
      //  • all items complete (full dispatch), OR
      //  • at least some items are ready (partial dispatch — remaining will follow)
      if (!isPartShipped && !allComplete && !hasAnyReadyItems) return null;

      const addressItems = remainingItems.filter(i =>
        isServiceItem(i) ||
        wsCompleteItemIdsForOrder.has(i.id) ||
        i.stockStatus === "complete"
      );
      const addressResolution = resolveDispatchAddress(
        order.deliveryAddressId,
        addressItems.map(item => {
          const employee = item.recipientEmployeeId
            ? employees.find(candidate => candidate.id === item.recipientEmployeeId)
            : null;
          return { employeeAddressId: employee ? (employee as any).deliveryAddressId as number | null : null };
        }),
      );
      const address = addressResolution.kind === "single"
        ? addresses.find(candidate => candidate.id === addressResolution.addressId) ?? null
        : null;

      const enrichedItems = items.map((item) => {
        const employee = item.recipientEmployeeId ? employees.find((e) => e.id === item.recipientEmployeeId) ?? null : null;
        return {
          ...item,
          unitPrice: parseFloat(item.unitPrice ?? "0"),
          lineTotal: parseFloat(item.lineTotal ?? "0"),
          blockedByPo: blockedByPoItemIds.has(item.id),
          employee: employee ? {
            id: employee.id,
            firstName: employee.firstName,
            lastName: employee.lastName,
            jobTitle: employee.jobTitle,
            department: employee.department,
          } : null,
        };
      });

      return {
        ...order,
        totalAmount: parseFloat(order.totalAmount ?? "0"),
        worksheets: orderWs.map((w) => ({
          ...w,
          items: wsItems.filter((i) => i.worksheetId === w.id),
        })),
        items: enrichedItems,
        productionComplete: allComplete,
        deliveryAddress: address,
        deliveryAddressConflict: addressResolution.kind === "conflict",
      };
    })
    .filter(Boolean);

  res.json(result);
});

router.get("/dispatch/customers/:customerId/manager-packing", async (req, res): Promise<void> => {
  const customerId = Number(req.params.customerId);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    res.status(400).json({ error: "Invalid customer id" }); return;
  }
  res.json({ enabled: await isManagerPackingEnabled(customerId) });
});

router.patch("/dispatch/customers/:customerId/manager-packing", async (req, res): Promise<void> => {
  const customerId = Number(req.params.customerId);
  const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    res.status(400).json({ error: "Invalid customer id" }); return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message }); return;
  }
  const [customer] = await db.select({ id: customersTable.id }).from(customersTable)
    .where(eq(customersTable.id, customerId));
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  await setManagerPackingEnabled(customerId, parsed.data.enabled);
  res.json({ enabled: parsed.data.enabled });
});

// Manager-grouped packing is enabled only for customers who opt in.
router.get("/dispatch/manager-groups", async (_req, res): Promise<void> => {
  const customerIds = await getManagerPackingCustomerIds();
  if (!customerIds.length) { res.json([]); return; }
  const orders = await db.select().from(ordersTable).where(and(
    inArray(ordersTable.customerId, customerIds),
    inArray(ordersTable.status, ["confirmed", "part_shipped"]),
  ));
  if (orders.length === 0) { res.json([]); return; }
  const customers = await db.select().from(customersTable).where(inArray(customersTable.id, customerIds));
  const customerById = new Map(customers.map(customer => [customer.id, customer]));
  const orderIds = orders.map(o => o.id);
  const ws = await db.select().from(worksheetsTable).where(inArray(worksheetsTable.orderId, orderIds));
  const wsIds = ws.map(w => w.id);
  const wsItems = wsIds.length ? await db.select().from(worksheetItemsTable).where(inArray(worksheetItemsTable.worksheetId, wsIds)) : [];
  const completeItemIds = new Set(ws.filter(w => w.status === "complete")
    .flatMap(w => wsItems.filter(i => i.worksheetId === w.id).map(i => i.orderItemId)));
  const rows = await db.select({ item: orderItemsTable, isService: productsTable.isService })
    .from(orderItemsTable)
    .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(inArray(orderItemsTable.orderId, orderIds));
  const items = rows.map(r => ({ ...r.item, isService: r.isService === true }));
  const blockedByPoItemIds = await getOutstandingPoItemIds(items.map(i => i.id));
  const employeeIds = [...new Set(items.map(i => i.recipientEmployeeId).filter((id): id is number => id != null))];
  const employees = employeeIds.length ? await db.select().from(customerEmployeesTable).where(inArray(customerEmployeesTable.id, employeeIds)) : [];
  const teamIds = [...new Set(employees.map(e => e.teamId).filter((id): id is number => id != null))];
  const teams = teamIds.length ? await db.select().from(customerTeamsTable).where(inArray(customerTeamsTable.id, teamIds)) : [];
  const employeeById = new Map(employees.map(e => [e.id, e]));
  const teamById = new Map(teams.map(t => [t.id, t]));
  const managerIds = [...new Set(employees.map(e => e.managerId).filter((id): id is number => id != null))];
  const managers = managerIds.length ? await db.select().from(customerEmployeesTable)
    .where(and(inArray(customerEmployeesTable.customerId, customerIds), eq(customerEmployeesTable.isActive, true), inArray(customerEmployeesTable.id, managerIds))) : [];
  const managerById = new Map(managers.map(m => [m.id, m]));
  const groups = new Map<string, any>();
  const isReady = (i: typeof items[number]) => !i.dispatchedAt && !i.isService && (
    completeItemIds.has(i.id) || (i.stockStatus === "complete" && !blockedByPoItemIds.has(i.id))
  );
  for (const item of items.filter(isReady)) {
    const employee = item.recipientEmployeeId ? employeeById.get(item.recipientEmployeeId) : null;
    const team = employee?.teamId ? teamById.get(employee.teamId) : null;
    const customerId = orders.find(o => o.id === item.orderId)?.customerId;
    if (customerId == null) continue;
    // Employee-level supervisor is authoritative for packing; never silently
    // route an unassigned employee to a team default.
    const managerId = employee?.managerId && managerById.get(employee.managerId)?.customerId === customerId
      ? employee.managerId
      : null;
    const key = `${customerId}:${managerId == null ? "unassigned" : managerId}`;
    if (!groups.has(key)) groups.set(key, {
      customerId, customerName: customerById.get(customerId)?.name ?? "",
      managerId, manager: managerId ? managerById.get(managerId) ?? null : null,
      teams: new Set<string>(), employees: new Set<string>(), orderNumbers: new Set<string>(), itemIds: [], items: [],
      deliveryAddressId: orders.find(o => o.id === item.orderId)?.deliveryAddressId ?? null,
    });
    const group = groups.get(key);
    if (team?.name) group.teams.add(team.name);
    if (employee) group.employees.add([employee.firstName, employee.lastName].filter(Boolean).join(" "));
    const order = orders.find(o => o.id === item.orderId);
    if (order) group.orderNumbers.add(order.orderNumber);
    group.itemIds.push(item.id);
    group.items.push({
      id: item.id, orderId: item.orderId, orderNumber: order?.orderNumber ?? "",
      productName: item.productName, colour: item.colour, size: item.size, quantity: item.quantity,
      employeeName: employee ? [employee.firstName, employee.lastName].filter(Boolean).join(" ") : item.recipientName,
      teamName: team?.name ?? null, department: employee?.department ?? null,
    });
  }
  const addressIds = [...new Set([...groups.values()].map(g => g.deliveryAddressId).filter((id): id is number => id != null))];
  const addresses = addressIds.length ? await db.select().from(customerDeliveryAddressesTable).where(inArray(customerDeliveryAddressesTable.id, addressIds)) : [];
  res.json([...groups.values()].map(g => ({
    ...g, teams: [...g.teams].sort(), employees: [...g.employees].sort(), orderNumbers: [...g.orderNumbers].sort(),
    deliveryAddress: addresses.find(a => a.id === g.deliveryAddressId) ?? null,
  })));
});

const ManagerDispatchBody = z.object({
  itemIds: z.array(z.number().int().positive()).min(1),
  numberOfParcels: z.number().int().positive().optional(),
  packedForManager: z.literal(true).optional(),
});

router.post("/dispatch/customers/:customerId/manager-groups/:managerId/dispatch", async (req, res): Promise<void> => {
  const customerId = Number(req.params.customerId);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    res.status(400).json({ error: "Invalid customer id" }); return;
  }
  const managerParam = String(req.params.managerId);
  const managerId = managerParam === "unassigned" ? null : Number(managerParam);
  if (managerParam !== "unassigned" && (managerId == null || !Number.isInteger(managerId) || managerId <= 0)) {
    res.status(400).json({ error: "Invalid manager" }); return;
  }
  const parsed = ManagerDispatchBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  if (managerId == null) {
    res.status(409).json({ error: "Assign a supervisor in each employee's details before packing or dispatching these items." }); return;
  }
  if (!(await isManagerPackingEnabled(customerId))) { res.status(404).json({ error: "Manager-grouped packing is not enabled for this customer" }); return; }
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, customerId));
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  const orders = await db.select().from(ordersTable).where(and(eq(ordersTable.customerId, customer.id), inArray(ordersTable.status, ["confirmed", "part_shipped"])));
  const orderById = new Map(orders.map(o => [o.id, o]));
  const itemRows = await db.select().from(orderItemsTable).where(inArray(orderItemsTable.id, parsed.data.itemIds));
  const productIds = [...new Set(itemRows.map(i => i.productId).filter((id): id is number => id != null))];
  const serviceProducts = productIds.length
    ? await db.select({ id: productsTable.id, isService: productsTable.isService }).from(productsTable).where(inArray(productsTable.id, productIds))
    : [];
  const serviceProductIds = new Set(serviceProducts.filter(p => p.isService).map(p => p.id));
  const employeeIds = [...new Set(itemRows.map(i => i.recipientEmployeeId).filter((id): id is number => id != null))];
  const employees = employeeIds.length ? await db.select().from(customerEmployeesTable).where(inArray(customerEmployeesTable.id, employeeIds)) : [];
  const employeeById = new Map(employees.map(e => [e.id, e]));
  const [manager] = await db.select({ id: customerEmployeesTable.id }).from(customerEmployeesTable)
    .where(and(eq(customerEmployeesTable.id, managerId), eq(customerEmployeesTable.customerId, customer.id), eq(customerEmployeesTable.isActive, true)));
  if (!manager) { res.status(409).json({ error: "The assigned supervisor is not an active employee of this customer." }); return; }
  const validOrderIds = [...new Set(itemRows.map(i => i.orderId))];
  const validWs = validOrderIds.length ? await db.select().from(worksheetsTable).where(inArray(worksheetsTable.orderId, validOrderIds)) : [];
  const validWsIds = validWs.map(w => w.id);
  const validWsItems = validWsIds.length ? await db.select().from(worksheetItemsTable).where(inArray(worksheetItemsTable.worksheetId, validWsIds)) : [];
  const readyByWorksheet = new Set(validWs.filter(w => w.status === "complete")
    .flatMap(w => validWsItems.filter(i => i.worksheetId === w.id).map(i => i.orderItemId)));
  const blockedByPoItemIds = await getOutstandingPoItemIds(itemRows.map(i => i.id));
  const valid = itemRows.filter(item => {
    const order = orderById.get(item.orderId);
    const employee = item.recipientEmployeeId ? employeeById.get(item.recipientEmployeeId) : null;
    const resolvedManager = employee?.customerId === customer.id ? employee.managerId : null;
    return !!order && !item.dispatchedAt && !serviceProductIds.has(item.productId ?? -1) &&
      !!employee && resolvedManager === managerId &&
      (readyByWorksheet.has(item.id) || (item.stockStatus === "complete" && !blockedByPoItemIds.has(item.id)));
  });
  if (valid.length !== parsed.data.itemIds.length) {
    res.status(409).json({ error: "The manager group has changed or contains items that are no longer ready. Refresh and try again." }); return;
  }
  const deliveryAddresses = new Set(valid.map(i => orderById.get(i.orderId)?.deliveryAddressId ?? null));
  if (deliveryAddresses.size > 1) {
    res.status(409).json({ error: "These items have different delivery addresses and cannot be packed in one supervisor delivery." }); return;
  }
  const now = new Date();
  await db.update(orderItemsTable).set({ dispatchedAt: now }).where(inArray(orderItemsTable.id, valid.map(i => i.id)));
  const affectedIds = [...new Set(valid.map(i => i.orderId))];
  const affected: any[] = [];
  for (const orderId of affectedIds) {
    const all = await db.select({ id: orderItemsTable.id, dispatchedAt: orderItemsTable.dispatchedAt, isService: productsTable.isService })
      .from(orderItemsTable).leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
      .where(eq(orderItemsTable.orderId, orderId));
    const remainingPhysical = all.filter(i => !i.isService && !i.dispatchedAt);
    const newStatus = remainingPhysical.length ? "part_shipped" : "shipped";
    const sourceOrder = orderById.get(orderId);
    const orderDate = sourceOrder?.orderDate ? new Date(sourceOrder.orderDate) : null;
    const crossMonth = !!orderDate && (
      orderDate.getMonth() !== now.getMonth() ||
      orderDate.getFullYear() !== now.getFullYear()
    );
    const invoiceDate = crossMonth ? orderDate : now;
    const [updated] = await db.update(ordersTable).set({
      status: newStatus, dispatchedAt: now, invoiceDate, updatedAt: now,
    }).where(eq(ordersTable.id, orderId)).returning();
    affected.push(updated);
    await logOrderAction(orderId, newStatus === "shipped" ? "Order dispatched by manager group" : "Order part-shipped by manager group", getActor(req), `Manager-grouped customer delivery (${valid.filter(i => i.orderId === orderId).length} item line(s))`);

    if (updated.customerId && updated.source === "portal") {
      const partial = newStatus === "part_shipped";
      notifyAllPortalUsers({
        customerId: updated.customerId,
        title: partial ? `Order ${updated.orderNumber} partly dispatched` : `Order ${updated.orderNumber} has been dispatched`,
        body: partial
          ? "Part of your order is on its way; the remaining items will follow when ready."
          : "Your order has been dispatched.",
        link: "/orders",
        type: "dispatched",
      }).catch(() => {});
    }

    // Match the normal dispatch automation, but omit integrations not supported
    // by this grouped packing flow.
    if (updated.customerId) {
      db.select({ email: customersTable.email, phone: (customersTable as any).phone })
        .from(customersTable)
        .where(eq(customersTable.id, updated.customerId))
        .then(([cust]) => {
          fireWorkflow("order_dispatched", {
            order_number: updated.orderNumber,
            customer_name: updated.customerName ?? "",
            contact_email: (cust as any)?.email ?? null,
            contact_phone: (cust as any)?.phone ?? null,
            tracking_number: null,
          }).catch(() => {});
        }).catch(() => {});
    } else {
      fireWorkflow("order_dispatched", {
        order_number: updated.orderNumber,
        customer_name: updated.customerName ?? "",
        tracking_number: null,
      }).catch(() => {});
    }
  }
  const notePath = `/api/dispatch/customers/${customerId}/manager-groups/${managerParam}/packing-print?itemIds=${valid.map(i => i.id).join(",")}&parcels=${parsed.data.numberOfParcels ?? 1}`;
  res.json({ dispatchedItemIds: valid.map(i => i.id), affectedOrders: affected, deliveryNoteUrl: notePath });
});

router.get("/dispatch/customers/:customerId/manager-groups/:managerId/packing-print", async (req, res): Promise<void> => {
  const customerId = Number(req.params.customerId);
  if (!Number.isInteger(customerId) || customerId <= 0) { res.status(400).send("Invalid customer id"); return; }
  const itemIds = [...new Set(String(req.query.itemIds ?? "").split(",").map(Number).filter(n => Number.isInteger(n) && n > 0))];
  if (!itemIds.length) { res.status(400).send("No items supplied for packing"); return; }
  const parcels = Number(req.query.parcels ?? 1);
  if (!Number.isInteger(parcels) || parcels < 1 || parcels > 50) { res.status(400).send("Invalid parcel count"); return; }
  const labelsOnly = req.query.labels === "1";
  if (!(await isManagerPackingEnabled(customerId))) { res.status(404).send("Manager-grouped packing is not enabled for this customer"); return; }
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, customerId));
  if (!customer) { res.status(404).send("Customer not found"); return; }
  const rows = await db.select({ item: orderItemsTable, order: ordersTable, employee: customerEmployeesTable })
    .from(orderItemsTable).innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .leftJoin(customerEmployeesTable, eq(orderItemsTable.recipientEmployeeId, customerEmployeesTable.id))
    .where(and(inArray(orderItemsTable.id, itemIds), eq(ordersTable.customerId, customer.id)));
  if (!rows.length || rows.length !== itemIds.length) { res.status(404).send("One or more items were not found"); return; }
  const orderNumbers = [...new Set(rows.map(r => r.order.orderNumber))].join(", ");
  const managerId = String(req.params.managerId) === "unassigned" ? null : Number(req.params.managerId);
  if (!managerId || !Number.isInteger(managerId)) { res.status(409).send("A supervisor must be assigned before packing."); return; }
  const manager = (await db.select().from(customerEmployeesTable)
    .where(and(eq(customerEmployeesTable.id, managerId), eq(customerEmployeesTable.customerId, customer.id))))[0];
  if (!manager) { res.status(409).send("Supervisor not found for this customer"); return; }
  const invalidManagerItem = rows.find(row => {
    const resolvedManager = row.employee?.customerId === customer.id ? row.employee.managerId : null;
    return resolvedManager !== managerId;
  });
  if (invalidManagerItem) {
    res.status(409).send("The delivery note items no longer belong to this manager. Refresh the manager dispatch queue and try again.");
    return;
  }
  const destinationIds = new Set(rows.map(r => r.order.deliveryAddressId ?? null));
  if (destinationIds.size > 1) { res.status(409).send("Items with different delivery addresses cannot share a supervisor package."); return; }
  const addressId = rows[0].order.deliveryAddressId;
  const address = addressId ? (await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, addressId)))[0] : null;
  const supervisorName = [manager.firstName, manager.lastName].filter(Boolean).join(" ");
  const departments = [...new Set(rows.map(r => r.employee?.department?.trim()).filter((v): v is string => !!v))].sort();
  const departmentLabel = departments.length ? departments.join(", ") : "Department not set";
  const addressLines = address
    ? [address.line1, address.line2, address.city, address.postcode].filter(Boolean).join(", ")
     : [customer.address, customer.city, customer.postcode].filter(Boolean).join(", ") || "Customer delivery address not set";
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) { const name = row.employee ? [row.employee.firstName, row.employee.lastName].filter(Boolean).join(" ") : row.item.recipientName ?? "Unassigned"; if (!grouped.has(name)) grouped.set(name, []); grouped.get(name)!.push(row); }
  const sections = [...grouped.entries()].map(([name, lines]) => `<h3>${htmlEscape(name)} — ${htmlEscape(lines[0].employee?.department || "Department not set")}</h3><table><tr><th>Order</th><th>Item</th><th>Colour</th><th>Size</th><th>Qty</th></tr>${lines.map(r => `<tr><td>${htmlEscape(r.order.orderNumber)}</td><td>${htmlEscape(r.item.productName)}</td><td>${htmlEscape(r.item.colour || "—")}</td><td>${htmlEscape(r.item.size || "—")}</td><td>${r.item.quantity}</td></tr>`).join("")}</table>`).join("");
  const labels = Array.from({ length: parcels }, (_, index) => `<section class="parcel-label"><div class="kicker">${htmlEscape(customer.name)} · Supervisor delivery</div><div class="supervisor">${htmlEscape(supervisorName)}</div><div class="department">${htmlEscape(departmentLabel)}</div><p>${htmlEscape(addressLines)}</p><div class="parcel-number">Package ${index + 1} of ${parcels}</div><div class="kicker">Collect for ${htmlEscape(supervisorName)}<br>Keep supervisor groups separate</div></section>`).join("");
  const sheet = `<h1>Packing sheet — ${htmlEscape(customer.name)}</h1><div class="meta"><strong>Pack for supervisor:</strong> ${htmlEscape(supervisorName)}<br><strong>Department(s):</strong> ${htmlEscape(departmentLabel)}<br><strong>Deliver to:</strong> ${htmlEscape(addressLines)}<br><strong>Source orders:</strong> ${htmlEscape(orderNumbers)}<br><strong>Date:</strong> ${new Date().toLocaleDateString("en-GB")}</div><p class="instructions">Pack only the people listed below into ${parcels} separately labelled bag${parcels === 1 ? "" : "s"} or box${parcels === 1 ? "" : "es"} for this supervisor. Print and attach one matching package label to each. Keep other supervisors’ items separate.</p>${sections}`;
  const css = labelsOnly
    ? `@page{size:4in 6in;margin:0}body{font:12pt Arial;color:#172033;margin:0}.parcel-label{box-sizing:border-box;width:4in;height:6in;padding:7mm;border:3px solid #172033;display:flex;flex-direction:column;justify-content:center;gap:13px;overflow:hidden}.parcel-label:not(:first-child){break-before:page;page-break-before:always}.kicker{font-size:10pt;text-transform:uppercase;font-weight:700}.supervisor{font-size:26pt;font-weight:900;overflow-wrap:anywhere}.department{font-size:15pt;font-weight:700;overflow-wrap:anywhere}.parcel-number{font-size:18pt;font-weight:800}@media print{button{display:none}}`
    : `body{font:14px Arial;color:#172033;margin:35px}h1{margin-bottom:4px}h3{background:#e8edf5;padding:8px;margin:22px 0 0}table{width:100%;border-collapse:collapse;margin-bottom:14px}th,td{border:1px solid #ccd5e0;padding:7px;text-align:left}th{background:#1e293b;color:white}.meta{color:#475569;line-height:1.6}.instructions{background:#eff6ff;padding:12px;margin:15px 0}@media print{button{display:none}body{margin:16mm}}`;
  res.type("html").send(`<!doctype html><html><head><title>${htmlEscape(customer.name)} — ${htmlEscape(supervisorName)} ${labelsOnly ? "package labels" : "packing sheet"}</title><style>${css}</style></head><body>${labelsOnly ? labels : sheet}<button id="btn-print" type="button">Print ${labelsOnly ? "package labels" : "packing sheet"}</button><script src="/api/print-controls.js" defer></script></body></html>`);
});

// ── Dispatched/shipped order history ──────────────────────────────────────────
router.get("/dispatch/shipped", async (req, res): Promise<void> => {
  const { customer, search } = req.query as { customer?: string; search?: string };

  const conditions = [inArray(ordersTable.status, ["shipped", "delivered"])];

  if (customer && customer.trim()) {
    conditions.push(ilike(ordersTable.customerName, `%${customer.trim()}%`));
  }
  if (search && search.trim()) {
    conditions.push(
      or(
        ilike(ordersTable.orderNumber, `%${search.trim()}%`),
        ilike(ordersTable.trackingNumber, `%${search.trim()}%`),
        ilike(ordersTable.dpdConsignmentId, `%${search.trim()}%`),
      )!
    );
  }

  const orders = await db
    .select()
    .from(ordersTable)
    .where(and(...conditions))
    .orderBy(desc(ordersTable.dispatchedAt))
    .limit(200);

  if (orders.length === 0) { res.json([]); return; }

  const orderIds = orders.map((o) => o.id);

  const orderItemRows = await db
    .select({ item: orderItemsTable })
    .from(orderItemsTable)
    .where(inArray(orderItemsTable.orderId, orderIds));
  const orderItems = orderItemRows.map(r => r.item);

  const employeeIds = [...new Set(orderItems.map((i) => i.recipientEmployeeId).filter((id): id is number => id != null))];
  const employees = employeeIds.length > 0
    ? await db.select().from(customerEmployeesTable).where(inArray(customerEmployeesTable.id, employeeIds))
    : [];

  const deliveryAddressIds = [...new Set(orders.map((o) => o.deliveryAddressId).filter((id): id is number => id != null))];
  const addresses = deliveryAddressIds.length > 0
    ? await db.select().from(customerDeliveryAddressesTable).where(inArray(customerDeliveryAddressesTable.id, deliveryAddressIds))
    : [];

  const result = orders.map((order) => {
    const items = orderItems.filter((i) => i.orderId === order.id);
    const address = order.deliveryAddressId ? addresses.find((a) => a.id === order.deliveryAddressId) ?? null : null;
    const enrichedItems = items.map((item) => {
      const employee = item.recipientEmployeeId ? employees.find((e) => e.id === item.recipientEmployeeId) ?? null : null;
      return {
        ...item,
        unitPrice: parseFloat(item.unitPrice ?? "0"),
        lineTotal: parseFloat(item.lineTotal ?? "0"),
        employee: employee ? {
          id: employee.id, firstName: employee.firstName, lastName: employee.lastName,
          jobTitle: employee.jobTitle, department: employee.department,
        } : null,
      };
    });
    return {
      ...order,
      totalAmount: parseFloat(order.totalAmount ?? "0"),
      items: enrichedItems,
      deliveryAddress: address,
    };
  });

  res.json(result);
});

// ── Check if a single order is fully complete & return all document data ───────
router.get("/dispatch/orders/:id/ready", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const orderId = parsed.data.id;
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  const worksheets = await db.select().from(worksheetsTable).where(eq(worksheetsTable.orderId, orderId));
  const wsIds = worksheets.map((w) => w.id);
  const wsItems = wsIds.length > 0
    ? await db.select().from(worksheetItemsTable).where(inArray(worksheetItemsTable.worksheetId, wsIds))
    : [];

  const wsCompleteItemIds = new Set(
    worksheets.filter((w) => w.status === "complete")
      .flatMap((w) => wsItems.filter((wi) => wi.worksheetId === w.id).map((wi) => wi.orderItemId))
  );

  const hasDecoratedItems = items.some(i => i.finishId != null);
  const hasIncompleteWorksheets = worksheets.some(w => w.status !== "complete");
  const isPartShipped = order.status === "part_shipped";

  // For part_shipped: check remaining (undispatched) items; for confirmed: all items
  const remainingItems = isPartShipped ? items.filter(i => !i.dispatchedAt) : items;

  // Items NOT on a completed worksheet that are not yet in a ready state —
  // e.g. plain items still in purchasing (ordered, purchaseRequired, etc.)
  // 'allocated' = decorated item in the picking list (not yet picked for production).
  // Plain items are now auto-completed on allocation so they are never 'allocated'.
  const hasOutstandingItems = items.some(i =>
    !wsCompleteItemIds.has(i.id) &&
    i.stockStatus !== "complete"
  );

  let isComplete: boolean;
  if (isPartShipped) {
    isComplete = remainingItems.length > 0 && remainingItems.every(i =>
      i.stockStatus === "complete" || wsCompleteItemIds.has(i.id)
    );
  } else {
    const allItemsDirectlyComplete = items.every(i => i.stockStatus === "complete");
    isComplete = items.length > 0 && !hasOutstandingItems && (
      hasDecoratedItems
        ? (worksheets.length > 0 && !hasIncompleteWorksheets) || allItemsDirectlyComplete
        : allItemsDirectlyComplete
    );
  }

  const incompleteItemIds = remainingItems
    .filter((i) => i.stockStatus !== "complete" && !wsCompleteItemIds.has(i.id))
    .map((i) => i.id);

  let customer = null;
  if (order.customerId) {
    const [c] = await db.select().from(customersTable).where(eq(customersTable.id, order.customerId));
    customer = c ?? null;
  }

  const employeeIds = [...new Set(items.map((i) => i.recipientEmployeeId).filter((id): id is number => id != null))];
  const employees = employeeIds.length > 0
    ? await db.select().from(customerEmployeesTable).where(inArray(customerEmployeesTable.id, employeeIds))
    : [];

  // Resolve delivery address: order-level first, then fall back to employee location
  let address = null;
  if (order.deliveryAddressId) {
    const [a] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    address = a ?? null;
  }
  if (!address) {
    const empAddrIds = [...new Set(employees.map(e => (e as any).deliveryAddressId as number | null).filter((id): id is number => id != null))];
    if (empAddrIds.length === 1) {
      const [a] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, empAddrIds[0]));
      address = a ?? null;
    }
  }

  const enrichedItems = items.map((item) => {
    const emp = item.recipientEmployeeId ? employees.find((e) => e.id === item.recipientEmployeeId) ?? null : null;
    return {
      ...item,
      unitPrice: parseFloat(item.unitPrice ?? "0"),
      lineTotal: parseFloat(item.lineTotal ?? "0"),
      employee: emp ? { id: emp.id, firstName: emp.firstName, lastName: emp.lastName, jobTitle: emp.jobTitle, department: emp.department } : null,
    };
  });

  res.json({
    isComplete,
    incompleteItemIds,
    order: {
      ...order,
      totalAmount: parseFloat(order.totalAmount ?? "0"),
      customer,
      deliveryAddress: address,
      worksheets,
      items: enrichedItems,
    },
  });
});

const DispatchBody = z.object({
  numberOfParcels: z.number().int().positive().optional(),
  totalWeightKg: z.number().positive().optional(),
  bookDpd: z.boolean().optional(),
  networkCode: z.string().optional(),
});

router.patch("/dispatch/orders/:id/dispatch", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const body = DispatchBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { numberOfParcels, totalWeightKg, bookDpd, networkCode } = body.data;

  // Fetch the order + delivery address before dispatching
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, parsed.data.id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  // Determine the exact item lines in this shipment before resolving its
  // destination. This prevents a generic order address from hiding named-wearer
  // destinations and ensures partial dispatches are checked independently.
  const allOrderItems = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, parsed.data.id));
  const allWs = await db.select().from(worksheetsTable).where(eq(worksheetsTable.orderId, parsed.data.id));
  const allWsIds = allWs.map(w => w.id);
  const allWsItems = allWsIds.length > 0
    ? await db.select().from(worksheetItemsTable).where(inArray(worksheetItemsTable.worksheetId, allWsIds))
    : [];
  const wsCompleteItemIds = new Set(
    allWs.filter(w => w.status === "complete")
      .flatMap(w => allWsItems.filter(wi => wi.worksheetId === w.id).map(wi => wi.orderItemId))
  );
  const undispatchedItems = allOrderItems.filter(i => !i.dispatchedAt);
  const blockedByPoItemIds = new Set<number>();
  if (undispatchedItems.length > 0) {
    const blocked = await db.execute(sql`
      SELECT DISTINCT oi.id
      FROM order_items oi
      WHERE oi.order_id = ${parsed.data.id}
        AND oi.dispatched_at IS NULL
        AND (
          EXISTS (
            SELECT 1
            FROM purchase_order_items poi
            JOIN purchase_orders po ON po.id = poi.po_id
            WHERE po.status <> 'cancelled'
              AND poi.quantity_delivered < poi.quantity_ordered
              AND poi.quantity_ordered > 0
              AND (
                poi.order_item_id = oi.id
                OR COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> jsonb_build_array(oi.id)
              )
          )
          OR EXISTS (
            SELECT 1
            FROM purchase_order_items poi
            JOIN purchase_orders po ON po.id = poi.po_id
            WHERE po.status <> 'cancelled'
              AND poi.quantity_delivered < poi.quantity_ordered
              AND poi.quantity_ordered > 0
              AND poi.order_id = oi.order_id
              AND poi.order_item_id IS NULL
              AND (poi.source_order_item_ids IS NULL OR poi.source_order_item_ids = '[]'::jsonb)
              AND LOWER(TRIM(COALESCE(poi.product_name,''))) = LOWER(TRIM(COALESCE(oi.product_name,'')))
              AND LOWER(TRIM(COALESCE(poi.colour,''))) = LOWER(TRIM(COALESCE(oi.colour,'')))
              AND LOWER(TRIM(COALESCE(poi.size,''))) = LOWER(TRIM(COALESCE(oi.size,'')))
          )
        )
    `);
    for (const row of blocked.rows as any[]) {
      blockedByPoItemIds.add(Number(row.id));
    }
  }
  const isServiceLine = (i: typeof allOrderItems[0]) => !i.size && !i.colour && i.stockStatus == null;
  const itemsToDispatch = undispatchedItems.filter(i =>
    wsCompleteItemIds.has(i.id) ||
    isServiceLine(i) ||
    i.stockStatus === "complete"
  );
  const remainingAfter = undispatchedItems.filter(i => !itemsToDispatch.some(d => d.id === i.id));

  if (itemsToDispatch.length === 0) {
    res.status(409).json({ error: "There are no newly completed items ready for this follow-up shipment." });
    return;
  }

  let dpdResult: { consignmentNumber: string; shipmentId: number; trackingUrl: string; labelHtml: string | null } | null = null;
  let dpdError: string | null = null;
  let dpdAddressAuditLabel: string | null = null;

  if (bookDpd && numberOfParcels && totalWeightKg) {
    if (itemsToDispatch.length === 0) {
      res.status(409).json({ error: "DPD booking blocked: there are no ready items in this shipment." });
      return;
    }
    const destination = await getDpdDeliveryAddress(order, itemsToDispatch);
    if (!destination.ok) {
      res.status(409).json({ error: destination.error });
      return;
    }
    dpdAddressAuditLabel = destination.auditLabel;
    const resolvedAddress = destination.address;
      try {
        const customsInfo = await getCustomsInfoIfNeeded(order.id, order.totalAmount, resolvedAddress.postcode);
        dpdResult = await bookDpdConsignment({
          orderNumber: order.orderNumber,
          delivery: {
            contactName: order.customerName ?? "Recipient",
            organisation: order.customerName ?? undefined,
            ...resolvedAddress,
          },
          numberOfParcels,
          totalWeightKg,
          networkCode,
          ...customsInfo,
        });
      } catch (err: unknown) {
        dpdError = err instanceof Error ? err.message : "DPD booking failed";
      }
  }

  // ── Compute invoice date with cross-month logic ───────────────────────────
  // Default: dispatch date. Exception: if the order was placed in a different
  // month/year, use the order date so sales & purchase invoices stay in the
  // same reporting period.
  const now = new Date();
  const orderDate = order.orderDate ? new Date(order.orderDate) : null;
  const crossMonth = orderDate && (
    orderDate.getMonth() !== now.getMonth() ||
    orderDate.getFullYear() !== now.getFullYear()
  );
  const invoiceDate = crossMonth ? orderDate! : now;

  // ── Mark per-item dispatched_at and determine full vs partial shipment ────────
  if (itemsToDispatch.length > 0) {
    await db.update(orderItemsTable)
      .set({ dispatchedAt: now })
      .where(inArray(orderItemsTable.id, itemsToDispatch.map(i => i.id)));

    // Items that were still 'allocated' (picked directly from stock without a
    // production worksheet) must be marked 'complete' so they leave the picking list.
    const allocatedIds = itemsToDispatch.filter(i => i.stockStatus === "allocated").map(i => i.id);
    if (allocatedIds.length > 0) {
      await db.update(orderItemsTable)
        .set({ stockStatus: "complete" })
        .where(inArray(orderItemsTable.id, allocatedIds));
    }
  }

  const isPartialShipment = remainingAfter.length > 0;
  const newStatus = isPartialShipment ? "part_shipped" : "shipped";

  const updateFields: Partial<typeof ordersTable.$inferInsert> = {
    status: newStatus,
    dispatchedAt: now,
    invoiceDate,
    updatedAt: now,
    ...(numberOfParcels != null ? { dpdParcelCount: numberOfParcels } : {}),
    ...(dpdResult ? {
      trackingNumber: dpdResult.consignmentNumber,
      dpdConsignmentId: dpdResult.consignmentNumber,
      dpdJobId: dpdResult.shipmentId,
    } : {}),
  };

  // Saving the DPD result must never undo a booking that already succeeded with
  // the courier. If persisting the DPD-specific fields fails for any reason
  // (e.g. an unexpected data shape), fall back to saving the dispatch itself
  // without those fields so the order still dispatches and the despatch note
  // can still be produced — surface the save failure via dpdError instead of
  // crashing the whole request.
  let updated: typeof ordersTable.$inferSelect;
  try {
    [updated] = await db
      .update(ordersTable)
      .set(updateFields)
      .where(eq(ordersTable.id, parsed.data.id))
      .returning();
  } catch (err) {
    console.error("Dispatch order update failed, retrying without dpdJobId:", err);
    if (dpdResult) {
      // Most likely cause: dpdJobId exceeds the integer column range in production.
      // Try a middle fallback: save everything except dpdJobId so tracking is still stored.
      try {
        const { dpdJobId: _j, ...fieldsWithoutJobId } = updateFields;
        [updated] = await db
          .update(ordersTable)
          .set(fieldsWithoutJobId)
          .where(eq(ordersTable.id, parsed.data.id))
          .returning();
        console.warn(`[DPD] dpdJobId could not be stored (integer overflow likely) but tracking number saved for consignment ${dpdResult.consignmentNumber}`);
      } catch (err2) {
        console.error("Dispatch order update failed even without dpdJobId:", err2);
        dpdError = `DPD booked (consignment ${dpdResult.consignmentNumber}) but saving the result failed — record the tracking number manually. ${err2 instanceof Error ? err2.message : ""}`;
        const { trackingNumber: _t, dpdConsignmentId: _c, dpdJobId: _j, ...safeFields } = updateFields;
        [updated] = await db
          .update(ordersTable)
          .set(safeFields)
          .where(eq(ordersTable.id, parsed.data.id))
          .returning();
      }
    } else {
      const { trackingNumber: _t, dpdConsignmentId: _c, dpdJobId: _j, ...safeFields } = updateFields;
      [updated] = await db
        .update(ordersTable)
        .set(safeFields)
        .where(eq(ordersTable.id, parsed.data.id))
        .returning();
    }
  }

  await logOrderAction(parsed.data.id,
    isPartialShipment ? "Order part-shipped" : "Order dispatched",
    getActor(req),
    dpdResult
      ? `DPD consignment ${dpdResult.consignmentNumber}, ${numberOfParcels ?? 1} parcel(s), sent to ${dpdAddressAuditLabel}${isPartialShipment ? ` — ${remainingAfter.length} item line(s) to follow` : ""}`
      : `${isPartialShipment ? "Partial dispatch" : "Local/manual dispatch"}, ${numberOfParcels ?? 1} box(es)${isPartialShipment ? ` — ${remainingAfter.length} item line(s) to follow` : ""}${dpdError ? ` (DPD error: ${dpdError})` : ""}`);

  // Notify all portal users for this customer that their order has been dispatched
  if (updated.customerId && updated.source === "portal") {
    const trackingInfo = dpdResult ? ` Tracking: ${dpdResult.consignmentNumber}.` : "";
    notifyAllPortalUsers({
      customerId: updated.customerId,
      title: `Order ${updated.orderNumber} has been dispatched`,
      body: `Your order is on its way!${trackingInfo}`,
      link: "/orders",
      type: "dispatched",
    }).catch(() => {});
  }

  // ── Auto-book stock into customer Stores when add_to_stores is set ─────────
  try {
    const orderMeta = await db.execute(sql`
      SELECT add_to_stores, customer_id, order_number FROM orders WHERE id = ${updated.id} LIMIT 1
    `);
    const meta = orderMeta.rows[0] as any;
    if (meta?.add_to_stores && meta?.customer_id) {
      const stockOrderItems = await db.execute(sql`
        SELECT id, product_id, product_name, colour, size, quantity, unit_price, finish_id
        FROM order_items
        WHERE order_id = ${updated.id} AND recipient_type = 'stock' AND product_id IS NOT NULL
      `);
      for (const si of stockOrderItems.rows as any[]) {
        const qty = Number(si.quantity ?? 0);
        if (qty <= 0) continue;
        const existing = await db.execute(sql`
          SELECT id FROM customer_finished_items
          WHERE customer_id = ${meta.customer_id}
            AND product_id = ${si.product_id}
            AND (colour IS NOT DISTINCT FROM ${si.colour ?? null})
            AND (size IS NOT DISTINCT FROM ${si.size ?? null})
          LIMIT 1
        `);
        let stockItemId: number;
        if (existing.rows.length > 0) {
          stockItemId = (existing.rows[0] as any).id;
          await db.execute(sql`
            UPDATE customer_finished_items
            SET stock_quantity = stock_quantity + ${qty}, updated_at = now()
            WHERE id = ${stockItemId}
          `);
        } else {
          const inserted = await db.execute(sql`
            INSERT INTO customer_finished_items
              (customer_id, product_id, finish_id, name, colour, size, stock_quantity, unit_price, created_at, updated_at)
            VALUES
              (${meta.customer_id}, ${si.product_id}, ${si.finish_id ?? null}, ${si.product_name},
               ${si.colour ?? null}, ${si.size ?? null}, ${qty}, ${si.unit_price ?? "0.00"}, now(), now())
            RETURNING id
          `);
          stockItemId = (inserted.rows[0] as any).id;
        }
        await db.execute(sql`
          INSERT INTO customer_stock_movements
            (customer_id, stock_item_id, movement_type, quantity, reference, notes, created_by_name, created_at)
          VALUES
            (${meta.customer_id}, ${stockItemId}, 'in', ${qty}, ${meta.order_number},
             'Received — dispatched', 'Order system', now())
        `);
      }
    }
  } catch (err) {
    console.error("add_to_stores dispatch hook failed:", err);
    // Non-fatal — dispatch already succeeded
  }

  // ── Auto-complete WooCommerce order when despatched ─────────────────────
  if (updated.source === "woocommerce" && updated.wooOrderId) {
    try {
      const wooSettings = await getWooSettings();
      if (wooSettings) {
        await wooUpdateOrderStatus(wooSettings, updated.wooOrderId, "completed");
        console.log(`[dispatch] Marked WooCommerce order #${updated.wooOrderId} as completed`);
      }
    } catch (err) {
      console.error("WooCommerce auto-complete hook failed:", err);
      // Non-fatal — dispatch already succeeded
    }
  }

  // Fire workflow automation (non-blocking) — look up customer email/phone
  if (updated.customerId) {
    db.select({ email: customersTable.email, phone: (customersTable as any).phone })
      .from(customersTable)
      .where(eq(customersTable.id, updated.customerId))
      .then(([cust]) => {
        fireWorkflow("order_dispatched", {
          order_number: updated.orderNumber,
          customer_name: updated.customerName ?? "",
          contact_email: (cust as any)?.email ?? null,
          contact_phone: (cust as any)?.phone ?? null,
          tracking_number: dpdResult?.consignmentNumber ?? null,
        }).catch(() => {});
      }).catch(() => {});
  } else {
    fireWorkflow("order_dispatched", {
      order_number: updated.orderNumber,
      customer_name: updated.customerName ?? "",
      tracking_number: dpdResult?.consignmentNumber ?? null,
    }).catch(() => {});
  }

  res.json({
    order: updated,
    dispatchedItemIds: itemsToDispatch.map(i => i.id),
    dpd: dpdResult ? {
      consignmentNumber: dpdResult.consignmentNumber,
      trackingUrl: dpdResult.trackingUrl,
      labelHtml: dpdResult.labelHtml,
    } : null,
    dpdError,
    dpdConfigured: isDpdConfigured(),
    // Invoice sending is deliberately staff-controlled from the Invoices screen.
    // Keep these response fields for the existing UI contract; dispatch never sends.
    invoiceEmailSentTo: null,
    invoiceEmailError: null,
  });
});

// ── Return an order from the dispatch queue back to purchasing ─────────────────
// Resets plain items (stockStatus='complete', no completed worksheet) so they
// leave dispatch and re-enter the purchasing/production flow.
router.post("/dispatch/orders/:id/return", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const orderId = parsed.data.id;

  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  const worksheets = await db.select().from(worksheetsTable).where(eq(worksheetsTable.orderId, orderId));
  const wsIds = worksheets.map(w => w.id);
  const wsItems = wsIds.length > 0
    ? await db.select().from(worksheetItemsTable).where(inArray(worksheetItemsTable.worksheetId, wsIds))
    : [];

  const wsCompleteItemIds = new Set(
    worksheets.filter(w => w.status === "complete")
      .flatMap(w => wsItems.filter(wi => wi.worksheetId === w.id).map(wi => wi.orderItemId))
  );

  // Only reset items that are "complete" without a completed worksheet backing them
  const itemsToReset = items.filter(i =>
    i.stockStatus === "complete" && !wsCompleteItemIds.has(i.id)
  );

  if (itemsToReset.length === 0) {
    res.status(400).json({ error: "All complete items are backed by completed worksheets — nothing to return." });
    return;
  }

  for (const item of itemsToReset) {
    await db.update(orderItemsTable)
      .set({ stockStatus: null, purchaseRequired: true, stockAllocatedAt: null })
      .where(eq(orderItemsTable.id, item.id));
    // Restore the stock that was decremented when this item was allocated from
    // product stock. We're saying "this allocation was wrong — the stock is
    // still available (or needs to be re-purchased)."
    if (item.productId != null) {
      await db.execute(sql`
        UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) + ${item.quantity}
        WHERE id = ${item.productId}
      `);
    }
  }

  res.json({ returned: itemsToReset.length });
});

// ── Reduce an item quantity and create a backorder for the difference ──────────
// Used when stock is unavailable (damaged/lost). The item is updated to the new
// quantity (keeping its status so it can still be dispatched); a new sibling item
// is created for the shortfall with purchaseRequired=true so it flows back through
// the purchasing and picking pipeline automatically.
router.post("/dispatch/orders/:orderId/items/:itemId/reduce", async (req, res): Promise<void> => {
  const params = z.object({
    orderId: z.coerce.number().int().positive(),
    itemId: z.coerce.number().int().positive(),
  }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Bad request" }); return; }

  const body = z.object({ newQuantity: z.number().int().positive() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { orderId, itemId } = params.data;
  const { newQuantity } = body.data;

  const [item] = await db.select().from(orderItemsTable).where(
    and(eq(orderItemsTable.id, itemId), eq(orderItemsTable.orderId, orderId)),
  );
  if (!item) { res.status(404).json({ error: "Order item not found" }); return; }
  if (item.dispatchedAt) { res.status(400).json({ error: "Cannot edit a dispatched item" }); return; }
  if (newQuantity >= item.quantity) { res.status(400).json({ error: "New quantity must be less than current quantity" }); return; }

  const diff = item.quantity - newQuantity;
  const unitPrice = parseFloat(String(item.unitPrice ?? "0"));
  const now = new Date();

  // Reduce the existing item quantity — keep its stockStatus/worksheetStatus intact
  // so it remains ready-to-dispatch at the new lower quantity.
  await db.update(orderItemsTable)
    .set({ quantity: newQuantity, lineTotal: String(newQuantity * unitPrice) })
    .where(eq(orderItemsTable.id, itemId));

  // Create a new sibling item for the shortfall in purchasing state
  await db.insert(orderItemsTable).values({
    orderId,
    productId: item.productId,
    productName: item.productName,
    colour: item.colour,
    size: item.size,
    finishId: item.finishId,
    finishName: item.finishName,
    recipientType: item.recipientType,
    recipientName: item.recipientName,
    recipientEmployeeId: item.recipientEmployeeId,
    quantity: diff,
    unitPrice: item.unitPrice,
    lineTotal: String(diff * unitPrice),
    vatRate: item.vatRate,
    supplierId: item.supplierId,
    supplierName: item.supplierName,
    purchaseRequired: true,
    purchaseQuantity: diff,
    stockStatus: null,
    purchasingQueuedAt: now,
    notes: item.notes ? `${item.notes} [backorder — ${diff} unit(s) short on dispatch]` : `Backorder — ${diff} unit(s) short on dispatch`,
  });

  // Recalculate order total
  const allItems = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  const total = allItems.reduce((sum, i) => sum + parseFloat(String(i.lineTotal ?? "0")), 0);
  await db.update(ordersTable).set({ totalAmount: String(total), updatedAt: now }).where(eq(ordersTable.id, orderId));

  const variantStr = [item.colour, item.size].filter(Boolean).join("/") || "no variant";
  await logOrderAction(orderId, "Item quantity reduced — backorder created", getActor(req),
    `${item.productName} (${variantStr}): ${item.quantity} → ${newQuantity}; backorder of ${diff} unit(s) returned to purchasing queue`);

  res.json({ ok: true });
});

// ── Book DPD for an already-dispatched order (retry after API failure) ────────
router.post("/dispatch/orders/:id/retry-dpd", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const body = z.object({
    numberOfParcels: z.number().int().positive(),
    totalWeightKg: z.number().positive(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, parsed.data.id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (!order.dispatchedAt) { res.status(400).json({ error: "Order has not been dispatched yet" }); return; }
  if (order.dpdConsignmentId) { res.status(400).json({ error: "DPD consignment already booked" }); return; }

  const allItems = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
  const dispatchedItems = allItems.filter(item => {
    if (!item.dispatchedAt) return false;
    return order.dispatchedAt
      ? item.dispatchedAt.getTime() === order.dispatchedAt.getTime()
      : true;
  });
  const retryItems = dispatchedItems.length > 0 ? dispatchedItems : allItems.filter(item => !!item.dispatchedAt);
  const destination = await getDpdDeliveryAddress(order, retryItems);
  if (!destination.ok) { res.status(409).json({ error: destination.error }); return; }

  const { numberOfParcels, totalWeightKg } = body.data;
  const resolvedAddress = destination.address;
  const customsInfo = await getCustomsInfoIfNeeded(order.id, order.totalAmount, resolvedAddress.postcode);
  const dpdResult = await bookDpdConsignment({
    orderNumber: order.orderNumber,
    delivery: {
      contactName: order.customerName ?? "Recipient",
      organisation: order.customerName ?? undefined,
      ...resolvedAddress,
    },
    numberOfParcels,
    totalWeightKg,
    ...customsInfo,
  });

  await db.update(ordersTable).set({
    trackingNumber: dpdResult.consignmentNumber,
    dpdConsignmentId: dpdResult.consignmentNumber,
    dpdJobId: dpdResult.shipmentId,
    dpdParcelCount: numberOfParcels,
    updatedAt: new Date(),
  }).where(eq(ordersTable.id, parsed.data.id));

  await logOrderAction(parsed.data.id, "DPD booked (retry)", getActor(req),
    `Consignment ${dpdResult.consignmentNumber}, ${numberOfParcels} parcel(s), sent to ${destination.auditLabel}`);

  res.json({ consignmentNumber: dpdResult.consignmentNumber, trackingUrl: dpdResult.trackingUrl, labelHtml: dpdResult.labelHtml });
});

// ── Reprint DPD label for a dispatched order ──────────────────────────────────
router.get("/dispatch/orders/:id/dpd-label", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, parsed.data.id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (!order.dpdJobId) { res.status(404).json({ error: "No DPD label on record for this order" }); return; }

  const labelHtml = await reprrintDpdLabel(order.dpdJobId);
  if (!labelHtml) { res.status(502).json({ error: "Could not fetch DPD label" }); return; }

  res.json({ labelHtml });
});

export default router;
