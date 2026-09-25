import { Router, type IRouter } from "express";
import { eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { db, suppliersTable } from "@workspace/db";
import { pushSupplierToXero } from "../services/xero.js";

const router: IRouter = Router();

const priceBreakItem = z.object({ qty: z.number().int().positive(), price: z.number().nonnegative() });

const supplierBody = z.object({
  name: z.string().min(1),
  contactName: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  county: z.string().optional().nullable(),
  postcode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  currency: z.enum(["GBP", "USD", "EUR"]).optional().default("GBP"),
  defaultPriceBreaks: z.array(priceBreakItem).nullable().optional(),
  logoUrl: z.string().optional().nullable(),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });
const searchQuery = z.object({ search: z.string().optional() });

router.get("/suppliers", async (req, res): Promise<void> => {
  const q = searchQuery.safeParse(req.query);
  let suppliers;
  if (q.success && q.data.search) {
    const term = `%${q.data.search}%`;
    suppliers = await db.select().from(suppliersTable)
      .where(or(
        ilike(suppliersTable.name, term),
        ilike(suppliersTable.contactName, term),
        ilike(suppliersTable.email, term),
      ))
      .orderBy(suppliersTable.name);
  } else {
    suppliers = await db.select().from(suppliersTable).orderBy(suppliersTable.name);
  }
  res.json(suppliers);
});

router.post("/suppliers", async (req, res): Promise<void> => {
  const body = supplierBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.insert(suppliersTable).values(body.data).returning();
  res.status(201).json(row);
  // Best-effort push to Xero — don't await so the response is immediate
  pushSupplierToXero(row.id).catch(() => {});
});

router.get("/suppliers/:id", async (req, res): Promise<void> => {
  const p = idParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, p.data.id));
  if (!row) { res.status(404).json({ error: "Supplier not found" }); return; }
  res.json(row);
});

router.patch("/suppliers/:id", async (req, res): Promise<void> => {
  const p = idParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = supplierBody.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.update(suppliersTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(suppliersTable.id, p.data.id))
    .returning();
  if (!row) { res.status(404).json({ error: "Supplier not found" }); return; }
  res.json(row);
  // Best-effort sync to Xero — don't await so the response is immediate
  pushSupplierToXero(p.data.id).catch(() => {});
});

router.delete("/suppliers/:id", async (req, res): Promise<void> => {
  const p = idParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.delete(suppliersTable).where(eq(suppliersTable.id, p.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Supplier not found" }); return; }
  res.sendStatus(204);
});

export default router;
