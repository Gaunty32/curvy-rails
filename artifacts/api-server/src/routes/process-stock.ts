import { Router, type IRouter } from "express";
import { eq, ilike, or, and, sql, inArray } from "drizzle-orm";
import {
  db, processStockTable, suppliersTable, customersTable, settingsTable,
  ordersTable, orderItemsTable, customerFinishProcessesTable, customerProcessesTable,
  purchaseOrderItemsTable, purchaseOrdersTable,
} from "@workspace/db";
import { z } from "zod";

async function generateNextPsSku(): Promise<string> {
  const rows = await db
    .select({ sku: processStockTable.sku })
    .from(processStockTable)
    .where(sql`${processStockTable.sku} ~* '^PS[0-9]+'`);

  let max = 0;
  for (const { sku } of rows) {
    if (!sku) continue;
    const num = parseInt(sku.replace(/^PS0*/i, ""), 10);
    if (!isNaN(num) && num > max) max = num;
  }
  return "PS" + String(max + 1).padStart(4, "0");
}

const router: IRouter = Router();

const processStockBody = z.object({
  name: z.string().min(1),
  sku: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  unitCost: z.number().min(0).default(0),
  stockQuantity: z.number().int().default(0),
  supplierId: z.number().int().positive().optional().nullable(),
  supplierCode: z.string().optional().nullable(),
  customerId: z.number().int().positive().optional().nullable(),
  notes: z.string().optional().nullable(),
  fileUrl: z.string().url().optional().nullable(),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

function toFloat(val: string | null | undefined): number {
  if (val == null) return 0;
  return parseFloat(val);
}

router.get("/process-stock/suggest-sku", async (_req, res): Promise<void> => {
  const suggested = await generateNextPsSku();
  res.json({ sku: suggested });
});

router.get("/process-stock", async (req, res): Promise<void> => {
  const search = typeof req.query.search === "string" ? req.query.search : null;
  const customerIdParam = typeof req.query.customerId === "string" ? parseInt(req.query.customerId, 10) : null;

  const conditions = [];
  if (search) {
    const term = `%${search}%`;
    conditions.push(or(ilike(processStockTable.name, term), ilike(processStockTable.sku, term)));
  }
  if (customerIdParam && !isNaN(customerIdParam)) {
    conditions.push(eq(processStockTable.customerId, customerIdParam));
  }

  const rows = await db
    .select({ ps: processStockTable, supplierName: suppliersTable.name, customerName: customersTable.name })
    .from(processStockTable)
    .leftJoin(suppliersTable, eq(processStockTable.supplierId, suppliersTable.id))
    .leftJoin(customersTable, eq(processStockTable.customerId, customersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(processStockTable.sku, processStockTable.name);

  res.json(rows.map(r => ({
    ...r.ps,
    unitCost: toFloat(r.ps.unitCost),
    supplierName: r.supplierName ?? null,
    customerName: r.customerName ?? null,
  })));
});

router.post("/process-stock", async (req, res): Promise<void> => {
  const parsed = processStockBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const supplierCode = parsed.data.supplierCode?.trim() || null;
  let sku = parsed.data.sku?.trim() || null;

  if (!sku) {
    const [skuSetting] = await db.select({ value: settingsTable.value })
      .from(settingsTable).where(eq(settingsTable.key, "product_sku_prefix"));
    const configuredPrefix = skuSetting?.value?.trim().toUpperCase() ?? "";
    const prefix = /^[A-Z][A-Z0-9]{1,7}$/.test(configuredPrefix) ? configuredPrefix : "SKU";
    if (supplierCode && new RegExp(`^${prefix}[0-9]+$`, "i").test(supplierCode)) {
      sku = supplierCode.toUpperCase();
    } else {
      sku = await generateNextPsSku();
    }
  }

  const [existing] = await db
    .select({ id: processStockTable.id })
    .from(processStockTable)
    .where(eq(processStockTable.sku, sku));
  if (existing) {
    res.status(409).json({ error: `Product code "${sku}" is already in use. Please choose a different code.` });
    return;
  }

  const [row] = await db
    .insert(processStockTable)
    .values({ ...parsed.data, sku, unitCost: String(parsed.data.unitCost) })
    .returning();
  res.status(201).json({ ...row, unitCost: toFloat(row.unitCost) });
});

router.get("/process-stock/:id", async (req, res): Promise<void> => {
  const parsed = idParam.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.select().from(processStockTable).where(eq(processStockTable.id, parsed.data.id));
  if (!row) { res.status(404).json({ error: "Process stock item not found" }); return; }
  res.json({ ...row, unitCost: toFloat(row.unitCost) });
});

router.patch("/process-stock/:id", async (req, res): Promise<void> => {
  const parsed = idParam.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const body = processStockBody.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const updateData: Record<string, unknown> = { ...body.data, updatedAt: new Date() };
  if (body.data.unitCost !== undefined) updateData.unitCost = String(body.data.unitCost);
  const [row] = await db
    .update(processStockTable)
    .set(updateData)
    .where(eq(processStockTable.id, parsed.data.id))
    .returning();
  if (!row) { res.status(404).json({ error: "Process stock item not found" }); return; }
  res.json({ ...row, unitCost: toFloat(row.unitCost) });
});

router.delete("/process-stock/:id", async (req, res): Promise<void> => {
  const parsed = idParam.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.delete(processStockTable).where(eq(processStockTable.id, parsed.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Process stock item not found" }); return; }
  res.sendStatus(204);
});

// Book in received stock — increments stock_quantity by the given amount
router.post("/process-stock/:id/book-in", async (req, res): Promise<void> => {
  const parsed = idParam.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const body = z.object({ quantity: z.number().int().positive() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "quantity (positive integer) required" }); return; }
  const [row] = await db
    .update(processStockTable)
    .set({ stockQuantity: sql`${processStockTable.stockQuantity} + ${body.data.quantity}`, updatedAt: new Date() })
    .where(eq(processStockTable.id, parsed.data.id))
    .returning();
  if (!row) { res.status(404).json({ error: "Process stock item not found" }); return; }
  res.json({ id: row.id, stockQuantity: row.stockQuantity });
});

// ── Process stock requirements for all confirmed orders ───────────────────────
// Walks: confirmed order items → finish → processes → process stock
// and returns total needed vs. available, grouped by process stock item.
router.get("/purchasing/process-stock-requirements", async (_req, res): Promise<void> => {
  // 1. All confirmed order items that have a finish
  const confirmedItems = await db
    .select({
      orderId: ordersTable.id,
      orderNumber: ordersTable.orderNumber,
      customerName: ordersTable.customerName,
      requiredDate: ordersTable.requiredDate,
      itemId: orderItemsTable.id,
      quantity: orderItemsTable.quantity,
      finishId: orderItemsTable.finishId,
    })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .where(and(
      // Include both confirmed and part-shipped orders — undispatched items in
      // part-shipped orders still need process stock even though the order is
      // partially complete.
      inArray(ordersTable.status, ["confirmed", "part_shipped"]),
      sql`${orderItemsTable.dispatchedAt} IS NULL`,
    ));

  const itemsWithFinish = confirmedItems.filter(i => i.finishId != null);
  if (itemsWithFinish.length === 0) { res.json([]); return; }

  // 2. Finish → process links
  const finishIds = [...new Set(itemsWithFinish.map(i => i.finishId!))] as number[];
  const finishProcessLinks = await db
    .select({ finishId: customerFinishProcessesTable.finishId, processId: customerFinishProcessesTable.processId })
    .from(customerFinishProcessesTable)
    .where(inArray(customerFinishProcessesTable.finishId, finishIds));

  // 3. Processes that have a process stock item
  const processIds = [...new Set(finishProcessLinks.map(fp => fp.processId))];
  if (processIds.length === 0) { res.json([]); return; }

  const processes = await db
    .select({ id: customerProcessesTable.id, processStockId: customerProcessesTable.processStockId })
    .from(customerProcessesTable)
    .where(inArray(customerProcessesTable.id, processIds));

  const processToPs = new Map(
    processes.filter(p => p.processStockId).map(p => [p.id, p.processStockId!])
  );
  if (processToPs.size === 0) { res.json([]); return; }

  // 4. Process stock items with supplier
  const psIds = [...new Set([...processToPs.values()])];
  const psRows = await db
    .select({
      id: processStockTable.id,
      name: processStockTable.name,
      sku: processStockTable.sku,
      stockQuantity: processStockTable.stockQuantity,
      supplierId: processStockTable.supplierId,
      supplierName: suppliersTable.name,
      fileUrl: processStockTable.fileUrl,
    })
    .from(processStockTable)
    .leftJoin(suppliersTable, eq(processStockTable.supplierId, suppliersTable.id))
    .where(inArray(processStockTable.id, psIds));

  const psMap = new Map(psRows.map(ps => [ps.id, ps]));

  // 5. Build finish → processStockIds lookup
  const finishToPs = new Map<number, number[]>();
  for (const fp of finishProcessLinks) {
    const psId = processToPs.get(fp.processId);
    if (!psId) continue;
    if (!finishToPs.has(fp.finishId)) finishToPs.set(fp.finishId, []);
    finishToPs.get(fp.finishId)!.push(psId);
  }

  // 6. Aggregate required quantities per process stock item, with per-order breakdown
  type OrderLine = { orderId: number; orderNumber: string; customerName: string | null; requiredDate: Date | null; qty: number };
  const requireMap = new Map<number, { totalNeeded: number; orders: Map<number, OrderLine> }>();

  for (const item of itemsWithFinish) {
    // Deduplicate: a finish can link to multiple processes that share the same
    // process stock item — without this, the qty would be counted once per process.
    const psIds = [...new Set(finishToPs.get(item.finishId!) ?? [])];
    const qty = item.quantity ?? 0;
    for (const psId of psIds) {
      if (!requireMap.has(psId)) requireMap.set(psId, { totalNeeded: 0, orders: new Map() });
      const entry = requireMap.get(psId)!;
      entry.totalNeeded += qty;
      const existing = entry.orders.get(item.orderId);
      if (existing) {
        existing.qty += qty;
      } else {
        entry.orders.set(item.orderId, {
          orderId: item.orderId, orderNumber: item.orderNumber,
          customerName: item.customerName, requiredDate: item.requiredDate, qty,
        });
      }
    }
  }

  // 7. Check how much of each process stock item is still due on a draft or
  //    ordered PO so the same requirement is not purchased twice.
  const poRows = await db
    .select({
      processStockId: purchaseOrderItemsTable.processStockId,
      quantityOnPo: sql<number>`SUM(GREATEST(0, ${purchaseOrderItemsTable.quantityOrdered} - ${purchaseOrderItemsTable.quantityDelivered}))`,
    })
    .from(purchaseOrderItemsTable)
    .innerJoin(purchaseOrdersTable, eq(purchaseOrderItemsTable.poId, purchaseOrdersTable.id))
    .where(
      and(
        inArray(purchaseOrderItemsTable.processStockId, psIds),
        inArray(purchaseOrdersTable.status, ["draft", "ordered"]),
      )
    )
    .groupBy(purchaseOrderItemsTable.processStockId);

  const onPoMap = new Map<number, number>();
  for (const row of poRows) {
    if (row.processStockId != null) onPoMap.set(row.processStockId, Number(row.quantityOnPo));
  }

  // 8. Build response, sorted by shortfall severity
  const result = [...requireMap.entries()].map(([psId, { totalNeeded, orders }]) => {
    const ps = psMap.get(psId)!;
    const stockQuantity = ps.stockQuantity ?? 0;
    const onPo = onPoMap.get(psId) ?? 0;
    const shortfall = Math.max(0, totalNeeded - stockQuantity - onPo);
    return {
      processStockId: psId,
      name: ps.name,
      sku: ps.sku,
      stockQuantity,
      onPo,
      supplierId: ps.supplierId,
      supplierName: ps.supplierName,
      fileUrl: ps.fileUrl ?? null,
      totalNeeded,
      shortfall,
      orders: [...orders.values()].sort((a, b) =>
        (a.requiredDate?.getTime() ?? Infinity) - (b.requiredDate?.getTime() ?? Infinity)
      ),
    };
  }).sort((a, b) => b.shortfall - a.shortfall);

  res.json(result);
});

export default router;
