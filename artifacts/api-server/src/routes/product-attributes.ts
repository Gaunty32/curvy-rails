import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db, productAttributesTable, productVariantsTable, productsTable } from "@workspace/db";

const router: IRouter = Router();

const productIdParam = z.object({ productId: z.coerce.number().int().positive() });
const subIdParam = z.object({ productId: z.coerce.number().int().positive(), id: z.coerce.number().int().positive() });

const attributeBody = z.object({
  type: z.string().min(1),
  value: z.string().min(1),
  sortOrder: z.number().int().optional().nullable(),
});

async function getProduct(id: number) {
  const [p] = await db.select().from(productsTable).where(eq(productsTable.id, id));
  return p;
}

router.get("/products/:productId/attributes", async (req, res): Promise<void> => {
  const p = productIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getProduct(p.data.productId)) { res.status(404).json({ error: "Product not found" }); return; }
  const rows = await db.select().from(productAttributesTable)
    .where(eq(productAttributesTable.productId, p.data.productId))
    .orderBy(productAttributesTable.type, productAttributesTable.sortOrder);
  res.json(rows);
});

router.post("/products/:productId/attributes", async (req, res): Promise<void> => {
  const p = productIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getProduct(p.data.productId)) { res.status(404).json({ error: "Product not found" }); return; }
  const body = attributeBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.insert(productAttributesTable)
    .values({ ...body.data, productId: p.data.productId })
    .returning();
  res.status(201).json(row);
});

router.patch("/products/:productId/attributes/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = z.object({ value: z.string().trim().min(1).max(100) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [existing] = await db.select().from(productAttributesTable).where(and(
    eq(productAttributesTable.id, p.data.id),
    eq(productAttributesTable.productId, p.data.productId),
  ));
  if (!existing) { res.status(404).json({ error: "Attribute not found" }); return; }
  if (existing.value === body.data.value) { res.json(existing); return; }

  const row = await db.transaction(async tx => {
    const [updated] = await tx.update(productAttributesTable)
      .set({ value: body.data.value })
      .where(and(
        eq(productAttributesTable.id, p.data.id),
        eq(productAttributesTable.productId, p.data.productId),
      ))
      .returning();

    if (existing.type === "size") {
      await tx.update(productVariantsTable)
        .set({ size: body.data.value })
        .where(and(
          eq(productVariantsTable.productId, p.data.productId),
          eq(productVariantsTable.size, existing.value),
        ));
    } else if (existing.type === "colour") {
      await tx.update(productVariantsTable)
        .set({ colour: body.data.value })
        .where(and(
          eq(productVariantsTable.productId, p.data.productId),
          eq(productVariantsTable.colour, existing.value),
        ));
    } else if (existing.type === "sleeve") {
      await tx.update(productVariantsTable)
        .set({ sleeve: body.data.value })
        .where(and(
          eq(productVariantsTable.productId, p.data.productId),
          eq(productVariantsTable.sleeve, existing.value),
        ));
    }
    return updated;
  });

  res.json(row);
});

router.delete("/products/:productId/attributes/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.delete(productAttributesTable)
    .where(and(
      eq(productAttributesTable.id, p.data.id),
      eq(productAttributesTable.productId, p.data.productId),
    ))
    .returning();
  if (!row) { res.status(404).json({ error: "Attribute not found" }); return; }
  res.sendStatus(204);
});

export default router;
