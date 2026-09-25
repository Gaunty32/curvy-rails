import { Router, type IRouter } from "express";
import { eq, and, sql, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  customerInvoiceAddressesTable,
  customerDeliveryAddressesTable,
  customerContactsTable,
  customerProcessesTable,
  customerFinishesTable,
  customerFinishProcessesTable,
  customerFinishProductsTable,
  customerFinishedItemsTable,
  customerRolesTable,
  customerTeamsTable,
  customerEmployeesTable,
  customerEmployeeSizesTable,
  customerReferencesTable,
  customerFilesTable,
  customersTable,
  ordersTable,
  orderItemsTable,
  productsTable,
  productVariantsTable,
  settingsTable,
} from "@workspace/db";

const router: IRouter = Router();

const customerIdParam = z.object({ customerId: z.coerce.number().int().positive() });
const subIdParam = z.object({ customerId: z.coerce.number().int().positive(), id: z.coerce.number().int().positive() });
const finishProcessParam = z.object({
  customerId: z.coerce.number().int().positive(),
  finishId: z.coerce.number().int().positive(),
  processId: z.coerce.number().int().positive(),
});
const finishProductParam = z.object({
  customerId: z.coerce.number().int().positive(),
  finishId: z.coerce.number().int().positive(),
  productId: z.coerce.number().int().positive(),
});
const employeeSizeParam = z.object({
  customerId: z.coerce.number().int().positive(),
  employeeId: z.coerce.number().int().positive(),
  sizeId: z.coerce.number().int().positive(),
});
const employeeSubParam = z.object({
  customerId: z.coerce.number().int().positive(),
  employeeId: z.coerce.number().int().positive(),
});

async function getCustomer(id: number) {
  const [c] = await db.select().from(customersTable).where(eq(customersTable.id, id));
  return c;
}

// ─── Invoice Addresses ───────────────────────────────────────────────────────

const invoiceAddressBody = z.object({
  label: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  line2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  postcode: z.string().optional().nullable(),
  billingEmail: z.string().optional().nullable(),
  isDefault: z.boolean().optional().nullable(),
});

router.get("/customers/:customerId/invoice-addresses", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const rows = await db.select().from(customerInvoiceAddressesTable)
    .where(eq(customerInvoiceAddressesTable.customerId, p.data.customerId))
    .orderBy(customerInvoiceAddressesTable.createdAt);
  res.json(rows);
});

router.post("/customers/:customerId/invoice-addresses", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const body = invoiceAddressBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.insert(customerInvoiceAddressesTable).values({ ...body.data, customerId: p.data.customerId }).returning();
  res.status(201).json(row);
});

router.patch("/customers/:customerId/invoice-addresses/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = invoiceAddressBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.update(customerInvoiceAddressesTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(customerInvoiceAddressesTable.id, p.data.id), eq(customerInvoiceAddressesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Invoice address not found" }); return; }
  res.json(row);
});

router.delete("/customers/:customerId/invoice-addresses/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.delete(customerInvoiceAddressesTable)
    .where(and(eq(customerInvoiceAddressesTable.id, p.data.id), eq(customerInvoiceAddressesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Invoice address not found" }); return; }
  res.sendStatus(204);
});

// ─── Delivery Addresses ──────────────────────────────────────────────────────

const addressBody = z.object({
  label: z.string().optional().nullable(),
  line1: z.string().optional().nullable(),
  line2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  county: z.string().optional().nullable(),
  postcode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  isDefault: z.boolean().optional().nullable(),
  notes: z.string().optional().nullable(),
  invoiceAddressId: z.number().int().positive().optional().nullable(),
});

router.get("/customers/:customerId/addresses", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const rows = await db.execute(sql`
    SELECT
      da.*,
      ia.id        AS ia_id,
      ia.label     AS ia_label,
      ia.name      AS ia_name,
      ia.address   AS ia_address,
      ia.city      AS ia_city,
      ia.postcode  AS ia_postcode
    FROM customer_delivery_addresses da
    LEFT JOIN customer_invoice_addresses ia ON ia.id = da.invoice_address_id
    WHERE da.customer_id = ${p.data.customerId}
    ORDER BY da.created_at
  `);
  res.json((rows.rows as any[]).map(r => ({
    id: r.id,
    customerId: r.customer_id,
    label: r.label,
    line1: r.line1,
    line2: r.line2,
    city: r.city,
    postcode: r.postcode,
    country: r.country,
    isDefault: r.is_default,
    notes: r.notes,
    invoiceAddressId: r.invoice_address_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    invoiceAddress: r.ia_id ? {
      id: r.ia_id,
      label: r.ia_label,
      name: r.ia_name,
      address: r.ia_address,
      city: r.ia_city,
      postcode: r.ia_postcode,
    } : null,
  })));
});

router.post("/customers/:customerId/addresses", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const body = addressBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.insert(customerDeliveryAddressesTable).values({ ...body.data, customerId: p.data.customerId }).returning();
  res.status(201).json(row);
});

router.patch("/customers/:customerId/addresses/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = addressBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.update(customerDeliveryAddressesTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(customerDeliveryAddressesTable.id, p.data.id), eq(customerDeliveryAddressesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Address not found" }); return; }
  res.json(row);
});

router.delete("/customers/:customerId/addresses/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.delete(customerDeliveryAddressesTable)
    .where(and(eq(customerDeliveryAddressesTable.id, p.data.id), eq(customerDeliveryAddressesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Address not found" }); return; }
  res.sendStatus(204);
});

// ─── Contacts ────────────────────────────────────────────────────────────────

const contactBody = z.object({
  firstName: z.string().min(1),
  lastName: z.string().optional().nullable(),
  jobTitle: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.get("/customers/:customerId/contacts", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const rows = await db.select().from(customerContactsTable)
    .where(eq(customerContactsTable.customerId, p.data.customerId))
    .orderBy(customerContactsTable.lastName);
  res.json(rows);
});

router.post("/customers/:customerId/contacts", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const body = contactBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.insert(customerContactsTable).values({ ...body.data, customerId: p.data.customerId }).returning();
  res.status(201).json(row);
});

router.patch("/customers/:customerId/contacts/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = contactBody.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.update(customerContactsTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(customerContactsTable.id, p.data.id), eq(customerContactsTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Contact not found" }); return; }
  res.json(row);
});

router.delete("/customers/:customerId/contacts/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.delete(customerContactsTable)
    .where(and(eq(customerContactsTable.id, p.data.id), eq(customerContactsTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Contact not found" }); return; }
  res.sendStatus(204);
});

// ─── Processes ───────────────────────────────────────────────────────────────

const processBody = z.object({
  name: z.string().min(1),
  type: z.enum(["embroidery", "print", "DTF", "other"]),
  placement: z.string().optional().nullable(),
  price: z.number().min(0).optional().nullable(),
  processStockId: z.number().int().positive().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  fileUrl: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

function processToJson(row: Record<string, unknown>) {
  return { ...row, price: row.price != null ? parseFloat(row.price as string) : null };
}

router.get("/customers/:customerId/processes", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const rows = await db.select().from(customerProcessesTable)
    .where(eq(customerProcessesTable.customerId, p.data.customerId))
    .orderBy(customerProcessesTable.name);
  res.json(rows.map(processToJson));
});

router.post("/customers/:customerId/processes", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const body = processBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const insertData: Record<string, unknown> = { ...body.data, customerId: p.data.customerId };
  if (body.data.price != null) insertData.price = String(body.data.price);
  const [inserted] = await db.insert(customerProcessesTable).values(insertData).returning();
  const code = `P${String(inserted.id).padStart(3, "0")}`;
  const [row] = await db.update(customerProcessesTable).set({ code }).where(eq(customerProcessesTable.id, inserted.id)).returning();
  res.status(201).json(processToJson(row as Record<string, unknown>));
});

router.patch("/customers/:customerId/processes/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = processBody.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const updateData: Record<string, unknown> = { ...body.data, updatedAt: new Date() };
  if (body.data.price != null) updateData.price = String(body.data.price);
  const [row] = await db.update(customerProcessesTable)
    .set(updateData)
    .where(and(eq(customerProcessesTable.id, p.data.id), eq(customerProcessesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Process not found" }); return; }
  res.json(processToJson(row as Record<string, unknown>));
});

router.delete("/customers/:customerId/processes/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.delete(customerProcessesTable)
    .where(and(eq(customerProcessesTable.id, p.data.id), eq(customerProcessesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Process not found" }); return; }
  res.sendStatus(204);
});

// ─── Finishes ────────────────────────────────────────────────────────────────

const finishBody = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  roleId: z.number().int().positive().optional().nullable(),
});

router.get("/customers/:customerId/finishes", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const finishes = await db.select().from(customerFinishesTable)
    .where(eq(customerFinishesTable.customerId, p.data.customerId))
    .orderBy(customerFinishesTable.name);

  const result = await Promise.all(finishes.map(async (finish) => {
    const fps = await db.select({
      id: customerFinishProcessesTable.id,
      processId: customerFinishProcessesTable.processId,
      name: customerProcessesTable.name,
      type: customerProcessesTable.type,
      placement: customerProcessesTable.placement,
      price: customerProcessesTable.price,
    })
      .from(customerFinishProcessesTable)
      .innerJoin(customerProcessesTable, eq(customerFinishProcessesTable.processId, customerProcessesTable.id))
      .where(eq(customerFinishProcessesTable.finishId, finish.id));

    const processes = fps.map(fp => ({ ...fp, price: fp.price != null ? parseFloat(fp.price) : null }));
    const totalCost = processes.reduce((sum, fp) => sum + (fp.price ?? 0), 0);

    const garmentRows = await db.select({
      id: customerFinishProductsTable.id,
      productId: customerFinishProductsTable.productId,
      colour: customerFinishProductsTable.colour,
      name: productsTable.name,
      sku: productsTable.sku,
    })
      .from(customerFinishProductsTable)
      .innerJoin(productsTable, eq(customerFinishProductsTable.productId, productsTable.id))
      .where(eq(customerFinishProductsTable.finishId, finish.id));

    return { ...finish, processes, totalCost, garments: garmentRows };
  }));

  res.json(result);
});

router.post("/customers/:customerId/finishes", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const body = finishBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [inserted] = await db.insert(customerFinishesTable).values({ ...body.data, customerId: p.data.customerId }).returning();
  const code = `F${String(inserted.id).padStart(3, "0")}`;
  const [row] = await db.update(customerFinishesTable).set({ code }).where(eq(customerFinishesTable.id, inserted.id)).returning();
  res.status(201).json({ ...row, processes: [] });
});

router.patch("/customers/:customerId/finishes/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = finishBody.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.update(customerFinishesTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(customerFinishesTable.id, p.data.id), eq(customerFinishesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Finish not found" }); return; }
  res.json(row);
});

router.delete("/customers/:customerId/finishes/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.delete(customerFinishesTable)
    .where(and(eq(customerFinishesTable.id, p.data.id), eq(customerFinishesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Finish not found" }); return; }
  res.sendStatus(204);
});

router.post("/customers/:customerId/finishes/:finishId/processes/:processId", async (req, res): Promise<void> => {
  const p = finishProcessParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.insert(customerFinishProcessesTable)
    .values({ finishId: p.data.finishId, processId: p.data.processId })
    .returning();
  res.status(201).json(row);
});

router.delete("/customers/:customerId/finishes/:finishId/processes/:processId", async (req, res): Promise<void> => {
  const p = finishProcessParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  await db.delete(customerFinishProcessesTable)
    .where(and(
      eq(customerFinishProcessesTable.finishId, p.data.finishId),
      eq(customerFinishProcessesTable.processId, p.data.processId)
    ));
  res.sendStatus(204);
});

router.post("/customers/:customerId/finishes/:finishId/products/:productId", async (req, res): Promise<void> => {
  const p = finishProductParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const colour: string | null = req.body?.colour ?? null;
  const conditions = [
    eq(customerFinishProductsTable.finishId, p.data.finishId),
    eq(customerFinishProductsTable.productId, p.data.productId),
    colour ? eq(customerFinishProductsTable.colour, colour) : sql`${customerFinishProductsTable.colour} IS NULL`,
  ];
  const existing = await db.select().from(customerFinishProductsTable).where(and(...conditions));
  if (existing.length > 0) { res.status(409).json({ error: "This colour is already assigned to this finish" }); return; }
  const [row] = await db.insert(customerFinishProductsTable)
    .values({ finishId: p.data.finishId, productId: p.data.productId, colour })
    .returning();
  res.status(201).json(row);
});

router.delete("/customers/:customerId/finishes/:finishId/products/:productId", async (req, res): Promise<void> => {
  const p = finishProductParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  await db.delete(customerFinishProductsTable)
    .where(and(
      eq(customerFinishProductsTable.finishId, p.data.finishId),
      eq(customerFinishProductsTable.productId, p.data.productId)
    ));
  res.sendStatus(204);
});

router.delete("/customers/:customerId/finishes/:finishId/garments/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  await db.delete(customerFinishProductsTable).where(eq(customerFinishProductsTable.id, p.data.id));
  res.sendStatus(204);
});

// ─── Roles ────────────────────────────────────────────────────────────────────

const roleBody = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  annualAllowance: z.number().min(0).optional().nullable(),
});

router.get("/customers/:customerId/roles", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const rows = await db.execute(sql`
    SELECT id, customer_id, name, description, annual_allowance, created_at, updated_at
    FROM customer_roles
    WHERE customer_id = ${p.data.customerId}
    ORDER BY name
  `);
  res.json(rows.rows);
});

router.post("/customers/:customerId/roles", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const body = roleBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const d = body.data;
  const rows = await db.execute(sql`
    INSERT INTO customer_roles (customer_id, name, description, annual_allowance)
    VALUES (${p.data.customerId}, ${d.name}, ${d.description ?? null}, ${d.annualAllowance ?? null})
    RETURNING id, customer_id, name, description, annual_allowance, created_at, updated_at
  `);
  res.status(201).json(rows.rows[0]);
});

router.patch("/customers/:customerId/roles/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = roleBody.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const d = body.data;
  const sets: string[] = ["updated_at = now()"];
  if (d.name !== undefined) sets.push(`name = '${d.name.replace(/'/g, "''")}'`);
  if (d.description !== undefined) sets.push(`description = ${d.description === null ? "NULL" : `'${d.description.replace(/'/g, "''")}'`}`);
  if (d.annualAllowance !== undefined) sets.push(`annual_allowance = ${d.annualAllowance === null ? "NULL" : d.annualAllowance}`);
  const rows = await db.execute(sql`
    UPDATE customer_roles SET ${sql.raw(sets.join(", "))}
    WHERE id = ${p.data.id} AND customer_id = ${p.data.customerId}
    RETURNING id, customer_id, name, description, annual_allowance, created_at, updated_at
  `);
  if (rows.rows.length === 0) { res.status(404).json({ error: "Role not found" }); return; }
  res.json(rows.rows[0]);
});

router.delete("/customers/:customerId/roles/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.delete(customerRolesTable)
    .where(and(eq(customerRolesTable.id, p.data.id), eq(customerRolesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Role not found" }); return; }
  res.sendStatus(204);
});

// ─── Teams ────────────────────────────────────────────────────────────────────

const teamBody = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  managerId: z.number().int().positive().optional().nullable(),
  deliveryAddressId: z.number().int().positive().optional().nullable(),
});

async function teamAddressBelongsToCustomer(customerId: number, deliveryAddressId: number | null | undefined) {
  if (deliveryAddressId == null) return true;
  const rows = await db.execute(sql`
    SELECT id FROM customer_delivery_addresses
    WHERE id = ${deliveryAddressId} AND customer_id = ${customerId}
    LIMIT 1
  `);
  return rows.rows.length > 0;
}

router.get("/customers/:customerId/teams", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const rows = await db.execute(sql`
    SELECT t.id, t.customer_id, t.name, t.description, t.manager_id, t.delivery_address_id,
      CASE WHEN e.id IS NOT NULL THEN TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) ELSE NULL END AS manager_name,
      da.label AS delivery_address_label, da.line1 AS delivery_address_line1,
      da.line2 AS delivery_address_line2, da.city AS delivery_address_city,
      da.postcode AS delivery_address_postcode,
      t.created_at, t.updated_at
    FROM customer_teams t
    LEFT JOIN customer_employees e ON e.id = t.manager_id
    LEFT JOIN customer_delivery_addresses da
      ON da.id = t.delivery_address_id AND da.customer_id = t.customer_id
    WHERE t.customer_id = ${p.data.customerId}
    ORDER BY t.name
  `);
  res.json(rows.rows.map((r: any) => ({
    id: r.id, customerId: r.customer_id, name: r.name, description: r.description,
    managerId: r.manager_id ?? null, managerName: r.manager_name ?? null,
    deliveryAddressId: r.delivery_address_id ?? null,
    deliveryAddressLabel: r.delivery_address_label ?? null,
    deliveryAddressLine1: r.delivery_address_line1 ?? null,
    deliveryAddressLine2: r.delivery_address_line2 ?? null,
    deliveryAddressCity: r.delivery_address_city ?? null,
    deliveryAddressPostcode: r.delivery_address_postcode ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  })));
});

router.post("/customers/:customerId/teams", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const body = teamBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const { name, description, managerId, deliveryAddressId } = body.data;
  if (!await teamAddressBelongsToCustomer(p.data.customerId, deliveryAddressId)) {
    res.status(400).json({ error: "Delivery address does not belong to this customer" }); return;
  }
  const rows = await db.execute(sql`
    INSERT INTO customer_teams (customer_id, name, description, manager_id, delivery_address_id)
    VALUES (${p.data.customerId}, ${name}, ${description ?? null}, ${managerId ?? null}, ${deliveryAddressId ?? null})
    RETURNING *
  `);
  res.status(201).json(rows.rows[0]);
});

router.patch("/customers/:customerId/teams/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = teamBody.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  // Fetch existing row first so unset fields retain their value
  const existing = await db.execute(sql`SELECT * FROM customer_teams WHERE id = ${p.data.id} AND customer_id = ${p.data.customerId}`);
  if (!existing.rows[0]) { res.status(404).json({ error: "Team not found" }); return; }
  const cur = existing.rows[0] as any;
  const name = body.data.name ?? cur.name;
  const description = "description" in body.data ? (body.data.description ?? null) : cur.description;
  const managerId = "managerId" in body.data ? (body.data.managerId ?? null) : cur.manager_id;
  const deliveryAddressId = "deliveryAddressId" in body.data ? (body.data.deliveryAddressId ?? null) : cur.delivery_address_id;
  if (!await teamAddressBelongsToCustomer(p.data.customerId, deliveryAddressId)) {
    res.status(400).json({ error: "Delivery address does not belong to this customer" }); return;
  }
  const rows = await db.execute(sql`
    UPDATE customer_teams
    SET name = ${name}, description = ${description}, manager_id = ${managerId},
        delivery_address_id = ${deliveryAddressId}, updated_at = NOW()
    WHERE id = ${p.data.id} AND customer_id = ${p.data.customerId}
    RETURNING *
  `);
  res.json(rows.rows[0]);
});

router.delete("/customers/:customerId/teams/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.delete(customerTeamsTable)
    .where(and(eq(customerTeamsTable.id, p.data.id), eq(customerTeamsTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Team not found" }); return; }
  res.sendStatus(204);
});

// ─── Employees ───────────────────────────────────────────────────────────────

const employeeBody = z.object({
  firstName: z.string().min(1),
  lastName: z.string().optional().nullable(),
  employeeNumber: z.string().optional().nullable(),
  jobTitle: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  roleId: z.number().int().positive().optional().nullable(),
  teamId: z.number().int().positive().optional().nullable(),
  managerId: z.number().int().positive().optional().nullable(),
  deliveryAddressId: z.number().int().positive().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

router.get("/customers/:customerId/employees", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }

  const showInactive = req.query.showInactive === "true";

  const allEmployees = await db.select({
    id: customerEmployeesTable.id,
    customerId: customerEmployeesTable.customerId,
    firstName: customerEmployeesTable.firstName,
    lastName: customerEmployeesTable.lastName,
    employeeNumber: customerEmployeesTable.employeeNumber,
    jobTitle: customerEmployeesTable.jobTitle,
    department: customerEmployeesTable.department,
    roleId: customerEmployeesTable.roleId,
    teamId: customerEmployeesTable.teamId,
    managerId: customerEmployeesTable.managerId,
    email: customerEmployeesTable.email,
    phone: customerEmployeesTable.phone,
    deliveryAddressId: customerEmployeesTable.deliveryAddressId,
    isActive: customerEmployeesTable.isActive,
    notes: customerEmployeesTable.notes,
    createdAt: customerEmployeesTable.createdAt,
    updatedAt: customerEmployeesTable.updatedAt,
  })
    .from(customerEmployeesTable)
    .where(eq(customerEmployeesTable.customerId, p.data.customerId))
    .orderBy(customerEmployeesTable.lastName);

  const [roles, teams] = await Promise.all([
    db.select().from(customerRolesTable).where(eq(customerRolesTable.customerId, p.data.customerId)),
    db.select().from(customerTeamsTable).where(eq(customerTeamsTable.customerId, p.data.customerId)),
  ]);
  const roleMap = new Map(roles.map(r => [r.id, r.name]));
  const teamMap = new Map(teams.map(t => [t.id, t.name]));
  // Self-referencing manager map: id -> full name
  const managerNameMap = new Map(allEmployees.map(e => [e.id, [e.firstName, e.lastName].filter(Boolean).join(' ')]));

  const filtered = showInactive ? allEmployees : allEmployees.filter(e => e.isActive);

  // Batch-fetch all sizes in one query instead of N+1 per employee
  const employeeIds = filtered.map(e => e.id);
  const allSizes = employeeIds.length > 0
    ? await db.select().from(customerEmployeeSizesTable)
        .where(inArray(customerEmployeeSizesTable.employeeId, employeeIds))
        .orderBy(customerEmployeeSizesTable.label)
    : [];
  const sizesByEmployee = new Map<number, typeof allSizes>();
  for (const s of allSizes) {
    const arr = sizesByEmployee.get(s.employeeId) ?? [];
    arr.push(s);
    sizesByEmployee.set(s.employeeId, arr);
  }

  const withMeta = filtered.map((emp) => ({
    ...emp,
    roleName: emp.roleId ? (roleMap.get(emp.roleId) ?? null) : null,
    teamName: emp.teamId ? (teamMap.get(emp.teamId) ?? null) : null,
    managerName: emp.managerId ? (managerNameMap.get(emp.managerId) ?? null) : null,
    sizes: sizesByEmployee.get(emp.id) ?? [],
  }));

  res.json(withMeta);
});

router.post("/customers/:customerId/employees", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const body = employeeBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  if (body.data.roleId != null) {
    const [role] = await db.select({ id: customerRolesTable.id }).from(customerRolesTable)
      .where(and(eq(customerRolesTable.id, body.data.roleId), eq(customerRolesTable.customerId, p.data.customerId)));
    if (!role) { res.status(400).json({ error: "Selected grade does not belong to this customer." }); return; }
  }
  if (body.data.managerId != null) {
    const [manager] = await db.select({ id: customerEmployeesTable.id }).from(customerEmployeesTable)
      .where(and(eq(customerEmployeesTable.id, body.data.managerId), eq(customerEmployeesTable.customerId, p.data.customerId), eq(customerEmployeesTable.isActive, true)));
    if (!manager) { res.status(400).json({ error: "Supervisor must be an active employee of this customer." }); return; }
  }
  if (body.data.deliveryAddressId != null) {
    const [address] = await db.select({ id: customerDeliveryAddressesTable.id }).from(customerDeliveryAddressesTable)
      .where(and(eq(customerDeliveryAddressesTable.id, body.data.deliveryAddressId), eq(customerDeliveryAddressesTable.customerId, p.data.customerId)));
    if (!address) { res.status(400).json({ error: "Selected delivery address does not belong to this customer." }); return; }
  }
  const [row] = await db.insert(customerEmployeesTable).values({ ...body.data, customerId: p.data.customerId }).returning();
  res.status(201).json({ ...row, roleName: null, teamName: null, managerName: null, sizes: [] });
});

router.patch("/customers/:customerId/employees/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = employeeBody.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  if (body.data.managerId != null) {
    const [manager] = await db.select({ id: customerEmployeesTable.id }).from(customerEmployeesTable)
      .where(and(eq(customerEmployeesTable.id, body.data.managerId), eq(customerEmployeesTable.customerId, p.data.customerId), eq(customerEmployeesTable.isActive, true)));
    if (!manager || manager.id === p.data.id) { res.status(400).json({ error: "Supervisor must be another active employee of this customer." }); return; }
  }
  if (body.data.roleId != null) {
    const [role] = await db.select({ id: customerRolesTable.id }).from(customerRolesTable)
      .where(and(eq(customerRolesTable.id, body.data.roleId), eq(customerRolesTable.customerId, p.data.customerId)));
    if (!role) { res.status(400).json({ error: "Selected grade does not belong to this customer." }); return; }
  }
  if (body.data.deliveryAddressId != null) {
    const [address] = await db.select({ id: customerDeliveryAddressesTable.id }).from(customerDeliveryAddressesTable)
      .where(and(eq(customerDeliveryAddressesTable.id, body.data.deliveryAddressId), eq(customerDeliveryAddressesTable.customerId, p.data.customerId)));
    if (!address) { res.status(400).json({ error: "Selected delivery address does not belong to this customer." }); return; }
  }
  const [row] = await db.update(customerEmployeesTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(customerEmployeesTable.id, p.data.id), eq(customerEmployeesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Employee not found" }); return; }
  if (body.data.email !== undefined) {
    const normalised = body.data.email ? body.data.email.toLowerCase().trim() : body.data.email;
    if (normalised) {
      const conflict = await db.execute(
        sql`SELECT id FROM customer_portal_users WHERE email = ${normalised} AND linked_employee_id != ${p.data.id} LIMIT 1`
      );
      if ((conflict.rows ?? []).length > 0) {
        res.status(409).json({ error: "This email address is already linked to another portal account. Each portal account must have a unique email." });
        return;
      }
    }
    try {
      await db.execute(sql`UPDATE customer_portal_users SET email = ${normalised}, updated_at = now() WHERE linked_employee_id = ${p.data.id}`);
    } catch (err: any) {
      if (err.message?.includes("unique") || err.code === "23505") {
        res.status(409).json({ error: "This email address is already linked to another portal account." });
        return;
      }
      throw err;
    }
  }
  res.json(row);
});

router.delete("/customers/:customerId/employees/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.delete(customerEmployeesTable)
    .where(and(eq(customerEmployeesTable.id, p.data.id), eq(customerEmployeesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Employee not found" }); return; }
  res.sendStatus(204);
});

// ─── Batch Employee Import ────────────────────────────────────────────────────

const importRowSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().optional().nullable(),
  employeeNumber: z.string().optional().nullable(),
  jobTitle: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  teamName: z.string().optional().nullable(),
  managerName: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  sizes: z.array(z.object({ label: z.string(), size: z.string() })).optional(),
  roleName: z.string().optional().nullable(),
  deliveryAddressLabel: z.string().optional().nullable(),
});

const importBodySchema = z.object({
  rows: z.array(importRowSchema),
  orderOptions: z.object({
    finishId: z.number().int().positive(),
    sizeLabel: z.string(),
  }).optional().nullable(),
});

router.post("/customers/:customerId/employees/import", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }

  const body = importBodySchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const customerId = p.data.customerId;
  const { rows } = body.data;

  // Load existing employees, teams, roles and delivery addresses once upfront
  const existingEmployees = await db.select().from(customerEmployeesTable)
    .where(eq(customerEmployeesTable.customerId, customerId));

  const existingTeams = await db.execute(
    sql`SELECT id, name FROM customer_teams WHERE customer_id = ${customerId}`
  );
  const teamMap = new Map<string, number>();
  for (const t of existingTeams.rows as any[]) {
    teamMap.set((t.name as string).toLowerCase(), t.id as number);
  }

  const existingRoles = await db.execute(
    sql`SELECT id, name FROM customer_roles WHERE customer_id = ${customerId}`
  );
  const roleNameMap = new Map<string, number>();
  for (const r of existingRoles.rows as any[]) {
    roleNameMap.set((r.name as string).toLowerCase(), r.id as number);
  }

  const existingAddresses = await db.execute(
    sql`SELECT id, label FROM customer_delivery_addresses WHERE customer_id = ${customerId}`
  );
  const addressLabelMap = new Map<string, number>();
  for (const a of existingAddresses.rows as any[]) {
    if (a.label) addressLabelMap.set((a.label as string).toLowerCase(), a.id as number);
  }

  let created = 0, updated = 0, skipped = 0;
  const errors: { row: number; error: string }[] = [];
  const managerResolutions: { employeeId: number; managerName: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      // ── Find or create team ─────────────────────────────────────────────────
      let teamId: number | null = null;
      if (row.teamName?.trim()) {
        const key = row.teamName.trim().toLowerCase();
        if (teamMap.has(key)) {
          teamId = teamMap.get(key)!;
        } else {
          const newTeam = await db.execute(sql`
            INSERT INTO customer_teams (customer_id, name)
            VALUES (${customerId}, ${row.teamName.trim()})
            RETURNING id
          `);
          teamId = (newTeam.rows[0] as any).id as number;
          teamMap.set(key, teamId);
        }
      }

      // ── Resolve role name → roleId ──────────────────────────────────────────
      let roleId: number | null = null;
      if (row.roleName?.trim()) {
        const roleName = row.roleName.trim();
        const key = roleName.toLowerCase();
        if (roleNameMap.has(key)) {
          roleId = roleNameMap.get(key)!;
        } else {
          // Spreadsheet imports commonly contain role names that have not
          // been set up in the customer's Roles tab yet. Create them just as
          // we do for new teams, then reuse the id for the remaining rows.
          const newRole = await db.execute(sql`
            INSERT INTO customer_roles (customer_id, name)
            VALUES (${customerId}, ${roleName})
            RETURNING id
          `);
          roleId = (newRole.rows[0] as any).id as number;
          roleNameMap.set(key, roleId);
        }
      }

      // ── Resolve delivery address label → deliveryAddressId ──────────────────
      let deliveryAddressId: number | null = null;
      // Apparel exports commonly use Department for both the team and the
      // employee's depot/address. An explicitly mapped delivery address wins;
      // otherwise use the team name as the address label.
      const explicitDeliveryAddressLabel = row.deliveryAddressLabel?.trim();
      const deliveryAddressLabel = explicitDeliveryAddressLabel || row.teamName?.trim();
      if (deliveryAddressLabel) {
        const key = deliveryAddressLabel.toLowerCase();
        if (addressLabelMap.has(key)) {
          deliveryAddressId = addressLabelMap.get(key)!;
        } else if (explicitDeliveryAddressLabel) {
          // Create a new delivery address with just the label
          const newAddr = await db.execute(sql`
            INSERT INTO customer_delivery_addresses (customer_id, label)
            VALUES (${customerId}, ${deliveryAddressLabel})
            RETURNING id
          `);
          deliveryAddressId = (newAddr.rows[0] as any).id as number;
          addressLabelMap.set(key, deliveryAddressId);
        }
      }

      // ── Find or create employee ─────────────────────────────────────────────
      const firstName = row.firstName.trim();
      const lastName = row.lastName?.trim() || null;
      const fullNameLower = [firstName, lastName].filter(Boolean).join(" ").toLowerCase();

      // Employee Number is the canonical unique key — match on it first.
      // Fall back to full-name matching only when no number is supplied.
      const empNum = row.employeeNumber?.trim() || null;
      const match = empNum
        ? existingEmployees.find((e) => e.employeeNumber === empNum)
        : existingEmployees.find((e) =>
            [e.firstName, e.lastName].filter(Boolean).join(" ").toLowerCase() === fullNameLower
          );

      let employeeId: number;

      if (match) {
        const updates: Record<string, any> = { updatedAt: new Date() };
        if (teamId !== null) updates.teamId = teamId;
        if (row.employeeNumber !== undefined) updates.employeeNumber = row.employeeNumber;
        if (row.jobTitle !== undefined) updates.jobTitle = row.jobTitle;
        if (row.email !== undefined) updates.email = row.email;
        if (row.phone !== undefined) updates.phone = row.phone;
        if (row.notes !== undefined) updates.notes = row.notes;
        if (roleId !== null) updates.roleId = roleId;
        if (deliveryAddressId !== null) updates.deliveryAddressId = deliveryAddressId;
        await db.update(customerEmployeesTable).set(updates).where(eq(customerEmployeesTable.id, match.id));
        employeeId = match.id;
        updated++;
      } else {
        const [newEmp] = await db.insert(customerEmployeesTable).values({
          customerId,
          firstName,
          lastName,
          teamId,
          employeeNumber: row.employeeNumber || null,
          jobTitle: row.jobTitle || null,
          email: row.email || null,
          phone: row.phone || null,
          notes: row.notes || null,
          roleId: roleId ?? null,
          deliveryAddressId: deliveryAddressId ?? null,
          isActive: true,
        }).returning();
        employeeId = newEmp.id;
        existingEmployees.push(newEmp);
        created++;
      }

      // ── Create or update sizes ──────────────────────────────────────────────
      if (row.sizes?.length) {
        for (const s of row.sizes) {
          if (!s.label?.trim() || !s.size?.trim()) continue;
          const existing = await db.select().from(customerEmployeeSizesTable)
            .where(and(
              eq(customerEmployeeSizesTable.employeeId, employeeId),
              sql`lower(${customerEmployeeSizesTable.label}) = lower(${s.label.trim()})`
            ));
          if (existing.length > 0) {
            await db.update(customerEmployeeSizesTable)
              .set({ size: s.size.trim(), updatedAt: new Date() })
              .where(eq(customerEmployeeSizesTable.id, existing[0].id));
          } else {
            await db.insert(customerEmployeeSizesTable).values({
              employeeId,
              label: s.label.trim(),
              size: s.size.trim(),
            });
          }
        }
      }

      // Track manager name for second pass
      if (row.managerName?.trim()) {
        managerResolutions.push({ employeeId, managerName: row.managerName.trim() });
      }
    } catch (err: any) {
      errors.push({ row: i + 1, error: err.message ?? "Unknown error" });
      skipped++;
    }
  }

  // ── Second pass: resolve manager names → IDs ─────────────────────────────
  // All employees (including newly created ones) are now in existingEmployees.
  for (const { employeeId, managerName } of managerResolutions) {
    const nameLower = managerName.toLowerCase();
    const manager = existingEmployees.find(
      (e) => [e.firstName, e.lastName].filter(Boolean).join(" ").toLowerCase() === nameLower
        && e.id !== employeeId
    );
    if (manager) {
      await db.update(customerEmployeesTable)
        .set({ managerId: manager.id, updatedAt: new Date() })
        .where(eq(customerEmployeesTable.id, employeeId));
    }
  }

  // ── Optional: Create a draft order from the imported sizes ────────────────
  let createdOrder: { id: number; orderNumber: string } | null = null;
  if (body.data.orderOptions) {
    const { finishId, sizeLabel } = body.data.orderOptions;

    // Aggregate size → count from all imported rows
    const sizeCounts = new Map<string, number>();
    for (const row of rows) {
      const entry = row.sizes?.find(s => s.label === sizeLabel);
      if (entry?.size?.trim()) {
        const s = entry.size.trim();
        sizeCounts.set(s, (sizeCounts.get(s) ?? 0) + 1);
      }
    }

    if (sizeCounts.size > 0) {
      // Fetch finish items for the chosen finish
      const finishRows = await db.execute(sql`
        SELECT cfi.id, cfi.name, cfi.product_id, p.name AS product_name, cfi.colour,
               cfi.unit_price, cfi.special_price, p.unit_price AS product_unit_price,
               COALESCE((
                 SELECT SUM(COALESCE(cp.price, 0)) -
                   COALESCE(MIN(CASE
                     WHEN ABS(COALESCE(cp.price, 0) - 4) < 0.005 THEN 4
                   END), 0)
                 FROM customer_finish_processes cfp
                 JOIN customer_processes cp ON cp.id = cfp.process_id
                 WHERE cfp.finish_id = cf.id
               ), 0) AS finish_extra,
               cf.name AS finish_name, cf.id AS finish_id
        FROM customer_finished_items cfi
        LEFT JOIN products p ON p.id = cfi.product_id
        JOIN customer_finishes cf ON cf.id = cfi.finish_id
        WHERE cfi.finish_id = ${finishId} AND cfi.customer_id = ${customerId}
      `);

      if ((finishRows.rows as any[]).length > 0) {
        const [cust] = await db.select({ name: customersTable.name }).from(customersTable).where(eq(customersTable.id, customerId));

        // Generate unique order number
        const numRows = await db.execute(sql`
          SELECT order_number FROM orders WHERE order_number ~ '^O[0-9]+$'
          ORDER BY LENGTH(order_number) DESC, order_number DESC LIMIT 1
        `);
        const lastNum = (numRows.rows[0] as any)?.order_number as string | undefined;
        const orderNum = `O${(lastNum ? parseInt(lastNum.slice(1), 10) : 99) + 1}`;

        const [order] = await db.insert(ordersTable).values({
          orderNumber: orderNum,
          customerId,
          customerName: cust?.name ?? null,
          status: "draft",
          totalAmount: "0",
          notes: `Created from employee spreadsheet import`,
          orderDate: new Date(),
        }).returning();

        // Create one order item per finish item × size
        const itemValues: any[] = [];
        for (const fi of finishRows.rows as any[]) {
          for (const [size, qty] of sizeCounts) {
            // Try to get a colour-matched variant price
            const variantRow = await db.execute(sql`
              SELECT price FROM product_variants
              WHERE product_id = ${fi.product_id ?? 0}
                AND lower(colour) = lower(${fi.colour ?? ""})
                AND lower(size) = lower(${size})
              LIMIT 1
            `);
            const variantPrice = (variantRow.rows[0] as any)?.price;
            const currentGarmentPrice = variantPrice != null
              ? parseFloat(variantPrice)
              : fi.product_unit_price != null
                ? parseFloat(fi.product_unit_price)
                : null;
            const unitPrice = fi.special_price != null
              ? parseFloat(fi.special_price)
              : currentGarmentPrice != null
                ? currentGarmentPrice + Math.max(0, parseFloat(fi.finish_extra ?? "0"))
                : fi.unit_price != null
                  ? parseFloat(fi.unit_price)
                  : 0;

            itemValues.push({
              orderId: order.id,
              productId: fi.product_id ?? null,
              productName: fi.product_name ?? fi.name,
              colour: fi.colour ?? null,
              size,
              finishId: fi.finish_id,
              finishName: fi.finish_name,
              quantity: qty,
              unitPrice: String(unitPrice),
              lineTotal: String(unitPrice * qty),
            });
          }
        }

        if (itemValues.length > 0) {
          await db.insert(orderItemsTable).values(itemValues);
        }

        const total = itemValues.reduce((s, i) => s + parseFloat(i.lineTotal), 0);
        await db.update(ordersTable).set({ totalAmount: String(total) }).where(eq(ordersTable.id, order.id));

        createdOrder = { id: order.id, orderNumber: orderNum };
      }
    }
  }

  res.json({ created, updated, skipped, errors, order: createdOrder });
});

// ─── Bulk Role Assignment ─────────────────────────────────────────────────────

const bulkRoleBody = z.object({
  employeeIds: z.array(z.number().int().positive()).min(1),
  roleId: z.number().int().positive().optional().nullable(),
});

router.post("/customers/:customerId/employees/bulk-role", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = bulkRoleBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { employeeIds, roleId } = body.data;
  await db.update(customerEmployeesTable)
    .set({ roleId: roleId ?? null, updatedAt: new Date() })
    .where(and(
      eq(customerEmployeesTable.customerId, p.data.customerId),
      sql`${customerEmployeesTable.id} = ANY(${sql`ARRAY[${sql.join(employeeIds.map(id => sql`${id}`), sql`, `)}]::int[]`})`
    ));

  res.json({ updated: employeeIds.length });
});

// ─── Employee Sizes ───────────────────────────────────────────────────────────

const sizeBody = z.object({
  label: z.string().min(1),
  size: z.string().min(1),
});

router.get("/customers/:customerId/employees/:employeeId/sizes", async (req, res): Promise<void> => {
  const p = employeeSubParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const rows = await db.select().from(customerEmployeeSizesTable)
    .where(eq(customerEmployeeSizesTable.employeeId, p.data.employeeId))
    .orderBy(customerEmployeeSizesTable.label);
  res.json(rows);
});

router.post("/customers/:customerId/employees/:employeeId/sizes", async (req, res): Promise<void> => {
  const p = employeeSubParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = sizeBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.insert(customerEmployeeSizesTable)
    .values({ ...body.data, employeeId: p.data.employeeId })
    .returning();
  res.status(201).json(row);
});

router.patch("/customers/:customerId/employees/:employeeId/sizes/:sizeId", async (req, res): Promise<void> => {
  const p = employeeSizeParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = sizeBody.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.update(customerEmployeeSizesTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(customerEmployeeSizesTable.id, p.data.sizeId))
    .returning();
  if (!row) { res.status(404).json({ error: "Size not found" }); return; }
  res.json(row);
});

router.delete("/customers/:customerId/employees/:employeeId/sizes/:sizeId", async (req, res): Promise<void> => {
  const p = employeeSizeParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  await db.delete(customerEmployeeSizesTable).where(eq(customerEmployeeSizesTable.id, p.data.sizeId));
  res.sendStatus(204);
});

// ─── Employee last-ordered sizes (from order history) ─────────────────────────

router.get("/customers/:customerId/employees/:employeeId/last-sizes", async (req, res): Promise<void> => {
  const p = employeeSubParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }

  const rows = await db.execute(sql`
    SELECT DISTINCT ON (COALESCE(oi.product_id::text, oi.product_name))
      oi.product_id,
      oi.product_name,
      oi.colour,
      oi.size
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE oi.recipient_employee_id = ${p.data.employeeId}
      AND o.status NOT IN ('cancelled', 'void')
      AND oi.size IS NOT NULL AND oi.size != ''
    ORDER BY COALESCE(oi.product_id::text, oi.product_name), o.created_at DESC
  `);

  const byProductId: Record<string, { size: string; colour: string | null; productName: string }> = {};
  const byProductName: Record<string, { size: string; colour: string | null; productId: number | null }> = {};
  for (const row of rows.rows as any[]) {
    if (row.product_id) byProductId[row.product_id] = { size: row.size, colour: row.colour ?? null, productName: row.product_name };
    if (row.product_name) byProductName[row.product_name] = { size: row.size, colour: row.colour ?? null, productId: row.product_id ?? null };
  }
  res.json({ byProductId, byProductName });
});

// ─── Finished Items (Wardrobe) ────────────────────────────────────────────────

const finishedItemBody = z.object({
  name: z.string().min(1),
  roleId: z.number().int().positive().optional().nullable(),
  productId: z.number().int().positive(),
  finishId: z.number().int().positive().optional().nullable(),
  colour: z.string().optional().nullable(),
  sleeve: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  unitPrice: z.number().min(0),
  specialPrice: z.number().min(0).optional().nullable(),
  stockQuantity: z.number().int().min(0).optional().default(0),
  notes: z.string().optional().nullable(),
});

router.get("/customers/:customerId/finished-items", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }

  const rows = await db.select({
    id: customerFinishedItemsTable.id,
    customerId: customerFinishedItemsTable.customerId,
    roleId: customerFinishedItemsTable.roleId,
    name: customerFinishedItemsTable.name,
    productId: customerFinishedItemsTable.productId,
    productName: productsTable.name,
    productSku: productsTable.sku,
    productUnitPrice: productsTable.unitPrice,
    finishId: customerFinishedItemsTable.finishId,
    colour: customerFinishedItemsTable.colour,
    sleeve: customerFinishedItemsTable.sleeve,
    size: customerFinishedItemsTable.size,
    unitPrice: customerFinishedItemsTable.unitPrice,
    specialPrice: customerFinishedItemsTable.specialPrice,
    stockQuantity: customerFinishedItemsTable.stockQuantity,
    notes: customerFinishedItemsTable.notes,
    createdAt: customerFinishedItemsTable.createdAt,
  })
    .from(customerFinishedItemsTable)
    .leftJoin(productsTable, eq(customerFinishedItemsTable.productId, productsTable.id))
    .where(eq(customerFinishedItemsTable.customerId, p.data.customerId))
    .orderBy(customerFinishedItemsTable.name);

  const finishes = await db.select({ id: customerFinishesTable.id, name: customerFinishesTable.name })
    .from(customerFinishesTable)
    .where(eq(customerFinishesTable.customerId, p.data.customerId));
  const finishMap = new Map(finishes.map(f => [f.id, f.name]));

  const roles = await db.select({ id: customerRolesTable.id, name: customerRolesTable.name })
    .from(customerRolesTable)
    .where(eq(customerRolesTable.customerId, p.data.customerId));
  const roleMap = new Map(roles.map(r => [r.id, r.name]));

  res.json(rows.map(r => ({
    ...r,
    unitPrice: r.unitPrice != null ? parseFloat(r.unitPrice) : 0,
    productUnitPrice: r.productUnitPrice != null ? parseFloat(r.productUnitPrice) : null,
    specialPrice: r.specialPrice != null ? parseFloat(r.specialPrice) : null,
    stockQuantity: r.stockQuantity ?? 0,
    finishName: r.finishId ? (finishMap.get(r.finishId) ?? null) : null,
    roleName: r.roleId ? (roleMap.get(r.roleId) ?? null) : null,
  })));
});

router.get("/customers/:customerId/wardrobe-data", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const { customerId } = p.data;

  // Rich item data — de-duplicated by product+finish+colour+role, with images
  const items = await db.execute(sql`
    SELECT DISTINCT ON (COALESCE(cf.id, 0), COALESCE(cfi.product_id, 0), COALESCE(lower(cfi.colour), ''), COALESCE(cfi.role_id, cf.role_id, 0))
      cf.id   AS finish_id,
      cf.name AS finish_name,
      cfi.id,
      cfi.name,
      cfi.product_id,
      p.name        AS product_name,
      p.sku         AS product_sku,
      p.image_url   AS product_image_url,
      p.price_breaks,
      p.unit_price  AS product_unit_price,
      cfi.colour,
      cfi.unit_price,
      cfi.special_price,
      cfi.role_id,
      COALESCE(cfi.role_id, cf.role_id) AS effective_role_id,
      cr.name AS role_name,
      (SELECT pv.image_url
         FROM product_variants pv
        WHERE pv.product_id = cfi.product_id
          AND lower(pv.colour) = lower(cfi.colour)
          AND pv.image_url IS NOT NULL
        LIMIT 1
      ) AS variant_image_url
    FROM customer_finished_items cfi
    LEFT JOIN customer_finishes  cf  ON cf.id = cfi.finish_id
    LEFT JOIN products           p   ON p.id = cfi.product_id
    LEFT JOIN customer_roles     cr  ON cr.id = COALESCE(cfi.role_id, cf.role_id)
    WHERE cfi.customer_id = ${customerId}
    ORDER BY COALESCE(cf.id, 0), COALESCE(cfi.product_id, 0), COALESCE(lower(cfi.colour), ''), COALESCE(cfi.role_id, cf.role_id, 0), cfi.updated_at DESC
  `);

  // Decoration processes per finish
  const processes = await db.execute(sql`
    SELECT
      cfp.finish_id,
      cp.id        AS process_id,
      cp.name      AS item_finish_name,
      cp.type      AS process_type,
      cp.placement,
      cp.price
    FROM customer_finish_processes cfp
    JOIN customer_processes cp ON cp.id = cfp.process_id
    JOIN customer_finishes  cf ON cf.id = cfp.finish_id
    WHERE cf.customer_id = ${customerId}
    ORDER BY cp.name
  `);

  // Build sizesMap: { [productId]: { [colour]: string[] } }
  const sizesMap: Record<string, Record<string, string[]>> = {};
  const variantRows = await db.execute(sql`
    SELECT DISTINCT pv.product_id, pv.colour, pv.size
    FROM product_variants pv
    WHERE pv.product_id IN (
      SELECT DISTINCT cfi.product_id
      FROM customer_finished_items cfi
      WHERE cfi.customer_id = ${customerId} AND cfi.product_id IS NOT NULL
    )
    AND pv.size IS NOT NULL AND pv.size != ''
    ORDER BY pv.product_id, pv.colour, pv.size
  `);
  for (const row of variantRows.rows as any[]) {
    const pid = String(row.product_id);
    if (!sizesMap[pid]) sizesMap[pid] = {};
    const col = row.colour ?? "__any__";
    if (!sizesMap[pid][col]) sizesMap[pid][col] = [];
    sizesMap[pid][col].push(row.size);
  }
  // Merge product_attributes sizes (covers colour-only variable products)
  try {
    const attrRows = await db.execute(sql`
      SELECT DISTINCT pa.product_id, pa.value AS size
      FROM product_attributes pa
      WHERE pa.type = 'size' AND pa.value IS NOT NULL AND pa.value != ''
        AND pa.product_id IN (
          SELECT DISTINCT cfi.product_id FROM customer_finished_items cfi
          WHERE cfi.customer_id = ${customerId} AND cfi.product_id IS NOT NULL
        )
    `);
    for (const row of attrRows.rows as any[]) {
      const pid = String(row.product_id);
      if (!sizesMap[pid]) sizesMap[pid] = {};
      if (!sizesMap[pid]["__any__"]) sizesMap[pid]["__any__"] = [];
      sizesMap[pid]["__any__"].push(row.size);
    }
  } catch { /* best-effort */ }
  // Sort sizes using saved size_order setting
  try {
    const [sizeOrderRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, "size_order"));
    if (sizeOrderRow?.value) {
      const sizeOrder: string[] = JSON.parse(sizeOrderRow.value);
      const sortFn = (a: string, b: string) => {
        const ai = sizeOrder.indexOf(a), bi = sizeOrder.indexOf(b);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return a.localeCompare(b);
      };
      for (const pid of Object.keys(sizesMap))
        for (const col of Object.keys(sizesMap[pid]))
          sizesMap[pid][col] = [...new Set(sizesMap[pid][col])].sort(sortFn);
    }
  } catch { /* best-effort */ }

  // Build sleevesMap: { [productId]: string[] } from product_attributes type='sleeve'
  const sleevesMap: Record<string, string[]> = {};
  try {
    const sleeveRows = await db.execute(sql`
      SELECT product_id, sleeve
      FROM (
        SELECT pa.product_id, pa.value AS sleeve
        FROM product_attributes pa
        WHERE pa.type = 'sleeve' AND pa.value IS NOT NULL AND pa.value != ''
          AND pa.product_id IN (
            SELECT DISTINCT cfi.product_id FROM customer_finished_items cfi
            WHERE cfi.customer_id = ${customerId} AND cfi.product_id IS NOT NULL
          )
        UNION
        SELECT pv.product_id, pv.sleeve AS sleeve
        FROM product_variants pv
        WHERE pv.sleeve IS NOT NULL AND pv.sleeve != ''
          AND pv.product_id IN (
            SELECT DISTINCT cfi.product_id FROM customer_finished_items cfi
            WHERE cfi.customer_id = ${customerId} AND cfi.product_id IS NOT NULL
          )
        UNION
        SELECT cfi.product_id, cfi.sleeve AS sleeve
        FROM customer_finished_items cfi
        WHERE cfi.customer_id = ${customerId}
          AND cfi.sleeve IS NOT NULL AND cfi.sleeve != ''
          AND cfi.product_id IS NOT NULL
      ) t
      ORDER BY product_id,
        CASE WHEN sleeve ~ '^-?[0-9]+(\.[0-9]+)?$' THEN sleeve::numeric ELSE NULL END NULLS LAST,
        sleeve
    `);
    for (const row of sleeveRows.rows as any[]) {
      const pid = String(row.product_id);
      if (!sleevesMap[pid]) sleevesMap[pid] = [];
      sleevesMap[pid].push(row.sleeve as string);
    }
    for (const pid of Object.keys(sleevesMap)) {
      sleevesMap[pid] = [...new Set(sleevesMap[pid])].sort((a, b) => {
        const an = parseInt(a, 10), bn = parseInt(b, 10);
        if (!isNaN(an) && !isNaN(bn)) return an - bn;
        if (!isNaN(an)) return -1;
        if (!isNaN(bn)) return 1;
        return a.localeCompare(b);
      });
    }
  } catch { /* best-effort */ }

  const custRow = await db.execute(sql`SELECT default_shipping_option, default_shipping_service FROM customers WHERE id = ${customerId} LIMIT 1`);
  const row0 = custRow.rows[0] as any;

  // Prefer the portal-specific default_shipping_option; fall back to mapping default_shipping_service
  function mapShippingService(svc: string | null): string | null {
    if (!svc) return null;
    const v = svc.toLowerCase();
    if (v.startsWith("dpd") || v === "courier") return "courier";
    if (v.startsWith("local")) return "local_delivery";
    if (v.startsWith("office")) return "office_collection";
    if (v.startsWith("warehouse")) return "warehouse_collection";
    return null;
  }
  const defaultShippingOption: string | null =
    row0?.default_shipping_option ?? mapShippingService(row0?.default_shipping_service ?? null);

  res.json({ items: items.rows, processes: processes.rows, sizesMap, sleevesMap, defaultShippingOption });
});

router.post("/customers/:customerId/finished-items", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const body = finishedItemBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [product] = await db.select({ id: productsTable.id }).from(productsTable)
    .where(eq(productsTable.id, body.data.productId));
  if (!product) { res.status(400).json({ error: "Selected catalogue product no longer exists." }); return; }
  if (body.data.roleId != null) {
    const [role] = await db.select({ id: customerRolesTable.id }).from(customerRolesTable)
      .where(and(eq(customerRolesTable.id, body.data.roleId), eq(customerRolesTable.customerId, p.data.customerId)));
    if (!role) { res.status(400).json({ error: "Selected wardrobe role does not belong to this customer." }); return; }
  }
  if (body.data.finishId != null) {
    const [finish] = await db.select({ id: customerFinishesTable.id }).from(customerFinishesTable)
      .where(and(eq(customerFinishesTable.id, body.data.finishId), eq(customerFinishesTable.customerId, p.data.customerId)));
    if (!finish) { res.status(400).json({ error: "Selected finish does not belong to this customer." }); return; }
  }

  // Duplicate check: exact same product + finish + colour + role + size already exists
  const [existing] = await db.select({ id: customerFinishedItemsTable.id })
    .from(customerFinishedItemsTable)
    .where(and(
      eq(customerFinishedItemsTable.customerId, p.data.customerId),
      eq(customerFinishedItemsTable.productId, body.data.productId),
      body.data.finishId != null ? eq(customerFinishedItemsTable.finishId, body.data.finishId) : isNull(customerFinishedItemsTable.finishId),
      body.data.colour   ? eq(customerFinishedItemsTable.colour,  body.data.colour)   : isNull(customerFinishedItemsTable.colour),
      body.data.roleId   != null ? eq(customerFinishedItemsTable.roleId,  body.data.roleId)   : isNull(customerFinishedItemsTable.roleId),
      body.data.size     ? eq(customerFinishedItemsTable.size,    body.data.size)     : isNull(customerFinishedItemsTable.size),
      body.data.sleeve   ? eq(customerFinishedItemsTable.sleeve,  body.data.sleeve)   : isNull(customerFinishedItemsTable.sleeve),
    ))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "A wardrobe item with the same product, finish, colour, role, size and sleeve already exists." });
    return;
  }

  const [row] = await db.insert(customerFinishedItemsTable)
    .values({
      ...body.data,
      customerId: p.data.customerId,
      unitPrice: String(body.data.unitPrice),
      specialPrice: body.data.specialPrice != null ? String(body.data.specialPrice) : null,
      stockQuantity: body.data.stockQuantity ?? 0,
    })
    .returning();
  res.status(201).json({ ...row, unitPrice: parseFloat(row.unitPrice!), specialPrice: row.specialPrice != null ? parseFloat(row.specialPrice) : null, stockQuantity: row.stockQuantity ?? 0 });
});

router.patch("/customers/:customerId/finished-items/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = finishedItemBody.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const updateData: Record<string, unknown> = { ...body.data, updatedAt: new Date() };
  if (body.data.unitPrice != null) updateData.unitPrice = String(body.data.unitPrice);
  if ("specialPrice" in body.data) updateData.specialPrice = body.data.specialPrice != null ? String(body.data.specialPrice) : null;
  const [row] = await db.update(customerFinishedItemsTable)
    .set(updateData)
    .where(and(eq(customerFinishedItemsTable.id, p.data.id), eq(customerFinishedItemsTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Finished item not found" }); return; }

  // Cascade price changes to all sibling rows (same product + finish + role, any size/colour).
  // This ensures that partial UI saves (e.g. filtered views) never leave some sizes on stale prices.
  const priceChanged = body.data.unitPrice != null || "specialPrice" in body.data;
  if (priceChanged) {
    const siblingUpdate: Record<string, unknown> = { updatedAt: new Date() };
    if (body.data.unitPrice != null) siblingUpdate.unitPrice = String(body.data.unitPrice);
    if ("specialPrice" in body.data) siblingUpdate.specialPrice = body.data.specialPrice != null ? String(body.data.specialPrice) : null;
    await db.update(customerFinishedItemsTable)
      .set(siblingUpdate)
      .where(and(
        eq(customerFinishedItemsTable.customerId, p.data.customerId),
        eq(customerFinishedItemsTable.productId, row.productId),
        row.finishId != null ? eq(customerFinishedItemsTable.finishId, row.finishId) : isNull(customerFinishedItemsTable.finishId),
        row.roleId  != null ? eq(customerFinishedItemsTable.roleId,   row.roleId)   : isNull(customerFinishedItemsTable.roleId),
        ne(customerFinishedItemsTable.id, row.id),
      ));
  }

  res.json({ ...row, unitPrice: parseFloat(row.unitPrice!), specialPrice: row.specialPrice != null ? parseFloat(row.specialPrice) : null, stockQuantity: row.stockQuantity ?? 0 });
});

router.delete("/customers/:customerId/finished-items/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.delete(customerFinishedItemsTable)
    .where(and(eq(customerFinishedItemsTable.id, p.data.id), eq(customerFinishedItemsTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Finished item not found" }); return; }
  res.sendStatus(204);
});

// ─── Order History ───────────────────────────────────────────────────────────

router.get("/customers/:customerId/orders", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const rows = await db.select().from(ordersTable)
    .where(eq(ordersTable.customerId, p.data.customerId))
    .orderBy(ordersTable.createdAt);
  res.json(rows.map(o => ({ ...o, totalAmount: o.totalAmount ? parseFloat(o.totalAmount) : 0 })));
});

// ─── Bespoke Products ─────────────────────────────────────────────────────────

const bespokeProductSchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  unitPrice: z.number().min(0),
  category: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  supplierId: z.number().int().positive().optional().nullable(),
  supplierCode: z.string().optional().nullable(),
  supplierPrice: z.number().optional().nullable(),
  stockQuantity: z.number().int().optional().nullable(),
});

function fmtProduct(p: any) {
  return {
    ...p,
    unitPrice: p.unitPrice ? parseFloat(p.unitPrice) : 0,
    supplierPrice: p.supplierPrice ? parseFloat(p.supplierPrice) : null,
  };
}

router.get("/customers/:customerId/bespoke-products", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const products = await db
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.customerId, p.data.customerId), eq(productsTable.isBespoke, true)));
  res.json(products.map(fmtProduct));
});

router.post("/customers/:customerId/bespoke-products", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }

  const body = bespokeProductSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [product] = await db.insert(productsTable).values({
    ...body.data,
    unitPrice: String(body.data.unitPrice),
    supplierPrice: body.data.supplierPrice != null ? String(body.data.supplierPrice) : null,
    customerId: p.data.customerId,
    isBespoke: true,
  }).returning();

  res.status(201).json(fmtProduct(product));
});

router.patch("/customers/:customerId/bespoke-products/:productId", async (req, res): Promise<void> => {
  const p = z.object({ customerId: z.coerce.number().int().positive(), productId: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }

  const body = bespokeProductSchema.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const updateData: Record<string, unknown> = { ...body.data, updatedAt: new Date() };
  if (body.data.unitPrice !== undefined) updateData.unitPrice = String(body.data.unitPrice);
  if (body.data.supplierPrice !== undefined) updateData.supplierPrice = body.data.supplierPrice != null ? String(body.data.supplierPrice) : null;

  const [product] = await db
    .update(productsTable)
    .set(updateData)
    .where(and(eq(productsTable.id, p.data.productId), eq(productsTable.customerId, p.data.customerId), eq(productsTable.isBespoke, true)))
    .returning();

  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  res.json(fmtProduct(product));
});

router.delete("/customers/:customerId/bespoke-products/:productId", async (req, res): Promise<void> => {
  const p = z.object({ customerId: z.coerce.number().int().positive(), productId: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }

  await db.delete(productsTable)
    .where(and(eq(productsTable.id, p.data.productId), eq(productsTable.customerId, p.data.customerId), eq(productsTable.isBespoke, true)));

  res.sendStatus(204);
});

// ─── Bespoke Product Variants ─────────────────────────────────────────────────

router.get("/customers/:customerId/bespoke-products/:productId/variants", async (req, res): Promise<void> => {
  const p = z.object({ customerId: z.coerce.number().int().positive(), productId: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const variants = await db
    .select()
    .from(productVariantsTable)
    .where(eq(productVariantsTable.productId, p.data.productId));
  res.json(variants.map(v => ({ ...v, price: v.price ? parseFloat(v.price) : null })));
});

const variantSchema = z.object({
  colour: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  price: z.number().optional().nullable(),
  stockQty: z.number().int().optional().nullable(),
});

router.post("/customers/:customerId/bespoke-products/:productId/variants", async (req, res): Promise<void> => {
  const p = z.object({ customerId: z.coerce.number().int().positive(), productId: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }

  const body = variantSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [variant] = await db.insert(productVariantsTable).values({
    productId: p.data.productId,
    colour: body.data.colour ?? null,
    size: body.data.size ?? null,
    price: body.data.price != null ? String(body.data.price) : null,
    stockQty: body.data.stockQty ?? null,
  }).returning();

  res.status(201).json({ ...variant, price: variant.price ? parseFloat(variant.price) : null });
});

router.delete("/customers/:customerId/bespoke-products/:productId/variants/:variantId", async (req, res): Promise<void> => {
  const p = z.object({
    customerId: z.coerce.number().int().positive(),
    productId: z.coerce.number().int().positive(),
    variantId: z.coerce.number().int().positive(),
  }).safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }

  await db.delete(productVariantsTable)
    .where(and(eq(productVariantsTable.id, p.data.variantId), eq(productVariantsTable.productId, p.data.productId)));

  res.sendStatus(204);
});

// ─── References ───────────────────────────────────────────────────────────────

const referenceBody = z.object({
  title: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
});

router.get("/customers/:customerId/references", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const rows = await db.select().from(customerReferencesTable)
    .where(eq(customerReferencesTable.customerId, p.data.customerId))
    .orderBy(customerReferencesTable.createdAt);
  res.json(rows);
});

router.post("/customers/:customerId/references", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const body = referenceBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.insert(customerReferencesTable).values({ ...body.data, customerId: p.data.customerId }).returning();
  res.status(201).json(row);
});

router.patch("/customers/:customerId/references/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = referenceBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.update(customerReferencesTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(customerReferencesTable.id, p.data.id), eq(customerReferencesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Reference not found" }); return; }
  res.json(row);
});

router.delete("/customers/:customerId/references/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.delete(customerReferencesTable)
    .where(and(eq(customerReferencesTable.id, p.data.id), eq(customerReferencesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Reference not found" }); return; }
  res.sendStatus(204);
});

// ─── Finish Stock ─────────────────────────────────────────────────────────────

const finishStockBody = z.object({
  productName: z.string().min(1),
  colour: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  quantity: z.number().int().min(0),
  notes: z.string().optional().nullable(),
});

router.get("/customers/:customerId/finish-stock", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const rows = await db.execute(sql`
    SELECT * FROM customer_finish_stock
    WHERE customer_id = ${p.data.customerId}
    ORDER BY product_name, colour, size, id
  `);
  res.json(rows.rows);
});

router.post("/customers/:customerId/finish-stock", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = finishStockBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const [row] = await db.execute(sql`
    INSERT INTO customer_finish_stock (customer_id, product_name, colour, size, sku, quantity, notes)
    VALUES (${p.data.customerId}, ${body.data.productName}, ${body.data.colour ?? null},
            ${body.data.size ?? null}, ${body.data.sku ?? null}, ${body.data.quantity}, ${body.data.notes ?? null})
    RETURNING *
  `);
  res.status(201).json(row);
});

router.patch("/customers/:customerId/finish-stock/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = finishStockBody.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const result = await db.execute(sql`
    UPDATE customer_finish_stock
    SET product_name = COALESCE(${body.data.productName ?? null}, product_name),
        colour       = COALESCE(${body.data.colour ?? null}, colour),
        size         = COALESCE(${body.data.size ?? null}, size),
        sku          = COALESCE(${body.data.sku ?? null}, sku),
        quantity     = COALESCE(${body.data.quantity ?? null}, quantity),
        notes        = COALESCE(${body.data.notes ?? null}, notes),
        updated_at   = NOW()
    WHERE id = ${p.data.id} AND customer_id = ${p.data.customerId}
    RETURNING *
  `);
  if (!result.rows[0]) { res.status(404).json({ error: "Item not found" }); return; }
  res.json(result.rows[0]);
});

router.delete("/customers/:customerId/finish-stock/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const result = await db.execute(sql`
    DELETE FROM customer_finish_stock
    WHERE id = ${p.data.id} AND customer_id = ${p.data.customerId}
    RETURNING id
  `);
  if (!result.rows[0]) { res.status(404).json({ error: "Item not found" }); return; }
  res.sendStatus(204);
});

// ─── Customer Files ───────────────────────────────────────────────────────────

const customerFileBody = z.object({
  fileName: z.string().min(1),
  fileUrl: z.string().min(1),
  fileSize: z.number().int().optional().nullable(),
  contentType: z.string().optional().nullable(),
  category: z.enum(["embroidery", "print", "other"]).default("other"),
  notes: z.string().optional().nullable(),
});

router.get("/customers/:customerId/files", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const rows = await db.select().from(customerFilesTable)
    .where(eq(customerFilesTable.customerId, p.data.customerId))
    .orderBy(customerFilesTable.createdAt);
  res.json(rows);
});

router.post("/customers/:customerId/files", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const body = customerFileBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.insert(customerFilesTable).values({ ...body.data, customerId: p.data.customerId }).returning();
  res.status(201).json(row);
});

router.patch("/customers/:customerId/files/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = z.object({ notes: z.string().optional().nullable(), category: z.enum(["embroidery", "print", "other"]).optional() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.update(customerFilesTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(customerFilesTable.id, p.data.id), eq(customerFilesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "File not found" }); return; }
  res.json(row);
});

router.delete("/customers/:customerId/files/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.delete(customerFilesTable)
    .where(and(eq(customerFilesTable.id, p.data.id), eq(customerFilesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "File not found" }); return; }
  res.sendStatus(204);
});

export default router;
