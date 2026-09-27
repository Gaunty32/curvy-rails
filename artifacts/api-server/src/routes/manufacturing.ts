import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  CreateManufacturingComponentBody,
  UpdateManufacturingComponentBody,
  RecordManufacturingOpeningBalanceBody,
  CreateManufacturingStocktakeBody,
  CreateManufacturingVariantBomBody,
  UpdateManufacturingVariantAvailabilityPolicyBody,
  UpdateManufacturingAvailabilityPolicyBody,
} from "@workspace/api-zod";
import {
  db, manufacturingComponentsTable, manufacturingMovementsTable,
  manufacturingStocktakesTable, manufacturingBomsTable,
  manufacturingBomComponentsTable, manufacturingBomOperationsTable,
  productVariantsTable,
  productsTable,
  manufacturingCheckoutHoldsTable,
  manufacturingAllocationsTable,
  manufacturingAvailabilityPoliciesTable,
  ordersTable,
} from "@workspace/db";
import { decodeStaffJwt, staffAuthorization } from "./staff-auth.js";
import { createManufacturingService } from "../services/manufacturing.js";
import { createManufacturingAvailabilityService } from "../services/manufacturing-availability.js";

const router: IRouter = Router();
const manufacturingService = createManufacturingService(db);
const availabilityService = createManufacturingAvailabilityService(db);
const idParam = z.object({ id: z.coerce.number().int().positive() });
const variantParam = z.object({ variantId: z.coerce.number().int().positive() });
const variantClassificationBody = z.object({
  classification: z.enum(["LEGACY_REVIEW", "FINISHED_STOCK", "COMPONENT_STOCK"]),
}).strict();
const componentUpdate = UpdateManufacturingComponentBody.refine((value) => Object.keys(value).length > 0, "At least one field is required");
const bomInput = CreateManufacturingVariantBomBody.superRefine((value, context) => {
  const componentIds = value.components.map((line) => line.componentId);
  if (new Set(componentIds).size !== componentIds.length) {
    context.addIssue({ code: "custom", message: "Component lines must have distinct component IDs" });
  }
});

router.use("/manufacturing", async (req, res, next): Promise<void> => {
  if (!(await staffAuthorization(req)).authenticated) {
    res.status(401).json({ error: "Staff authentication required." });
    return;
  }
  next();
});

function actorFor(req: Parameters<typeof decodeStaffJwt>[0]): string {
  const claims = decodeStaffJwt(req);
  if (!claims) throw new Error("Staff authentication required.");
  return typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "legacy-staff-session";
}

function statusForError(error: unknown): number {
  const code = (error as { code?: string })?.code;
  return code === "23505" ? 409 : code === "23503" ? 400 : 500;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Manufacturing request failed.";
}

router.get("/manufacturing/components", async (_req, res): Promise<void> => {
  const components = await db.select().from(manufacturingComponentsTable).orderBy(manufacturingComponentsTable.sku);
  res.json(components.map((row) => ({ ...row, costGbp: Number(row.costGbp) })));
});

router.post("/manufacturing/components", async (req, res): Promise<void> => {
  const parsed = CreateManufacturingComponentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    const [component] = await db.insert(manufacturingComponentsTable).values({
      ...parsed.data,
      costGbp: String(parsed.data.costGbp),
    }).returning();
    res.status(201).json({ ...component, costGbp: Number(component.costGbp) });
  } catch (error) {
    res.status(statusForError(error)).json({ error: statusForError(error) === 409 ? "Component SKU already exists." : errorMessage(error) });
  }
});

router.patch("/manufacturing/components/:id", async (req, res): Promise<void> => {
  const params = idParam.safeParse(req.params);
  const parsed = componentUpdate.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: params.error?.message ?? parsed.error?.message }); return;
  }
  const updateValues = {
    ...parsed.data,
    ...(parsed.data.costGbp === undefined ? {} : { costGbp: String(parsed.data.costGbp) }),
    updatedAt: new Date(),
  } as Partial<typeof manufacturingComponentsTable.$inferInsert>;
  try {
    const [component] = await db.update(manufacturingComponentsTable).set(updateValues)
      .where(eq(manufacturingComponentsTable.id, params.data.id)).returning();
    if (!component) { res.status(404).json({ error: "Component not found." }); return; }
    res.json({ ...component, costGbp: Number(component.costGbp) });
  } catch (error) {
    const status = statusForError(error);
    res.status(status).json({ error: status === 409 ? "Component SKU already exists." : errorMessage(error) });
  }
});

router.get("/manufacturing/components/:id/movements", async (req, res): Promise<void> => {
  const params = idParam.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [component] = await db.select({ id: manufacturingComponentsTable.id }).from(manufacturingComponentsTable)
    .where(eq(manufacturingComponentsTable.id, params.data.id));
  if (!component) { res.status(404).json({ error: "Component not found." }); return; }
  const movements = await db.select().from(manufacturingMovementsTable)
    .where(eq(manufacturingMovementsTable.componentId, params.data.id))
    .orderBy(desc(manufacturingMovementsTable.occurredAt), desc(manufacturingMovementsTable.id));
  res.json(movements);
});

router.post("/manufacturing/components/:id/opening-balance", async (req, res): Promise<void> => {
  const params = idParam.safeParse(req.params);
  const parsed = RecordManufacturingOpeningBalanceBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: params.error?.message ?? parsed.error?.message }); return;
  }
  const actor = actorFor(req);
  try {
    const movement = await manufacturingService.recordOpeningBalance(
      params.data.id, parsed.data.countedQuantity, actor, parsed.data.note ?? null,
    );
    res.status(201).json(movement);
  } catch (error) {
    const status = (error as { status?: number })?.status ?? statusForError(error);
    res.status(status).json({ error: errorMessage(error) });
  }
});

router.get("/manufacturing/components/:id/stocktakes", async (req, res): Promise<void> => {
  const params = idParam.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [component] = await db.select({ id: manufacturingComponentsTable.id }).from(manufacturingComponentsTable)
    .where(eq(manufacturingComponentsTable.id, params.data.id));
  if (!component) { res.status(404).json({ error: "Component not found." }); return; }
  const stocktakes = await db.select().from(manufacturingStocktakesTable)
    .where(eq(manufacturingStocktakesTable.componentId, params.data.id))
    .orderBy(desc(manufacturingStocktakesTable.createdAt), desc(manufacturingStocktakesTable.id));
  res.json(stocktakes);
});

router.post("/manufacturing/components/:id/stocktakes", async (req, res): Promise<void> => {
  const params = idParam.safeParse(req.params);
  const parsed = CreateManufacturingStocktakeBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: params.error?.message ?? parsed.error?.message }); return;
  }
  const actor = actorFor(req);
  try {
    const stocktake = await manufacturingService.createStocktake(
      params.data.id, parsed.data.countedQuantity, actor, parsed.data.note ?? null,
    );
    res.status(201).json(stocktake);
  } catch (error) {
    res.status((error as { status?: number })?.status ?? 500).json({ error: errorMessage(error) });
  }
});

router.post("/manufacturing/stocktakes/:id/approve", async (req, res): Promise<void> => {
  const params = idParam.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const actor = actorFor(req);
  try {
    const result = await manufacturingService.approveStocktake(params.data.id, actor);
    res.json(result);
  } catch (error) {
    res.status((error as { status?: number })?.status ?? 500).json({ error: errorMessage(error) });
  }
});

router.patch("/manufacturing/variants/:variantId/classification", async (req, res): Promise<void> => {
  if (!(await staffAuthorization(req)).authenticated) {
    res.status(401).json({ error: "Staff authentication required." });
    return;
  }
  const params = variantParam.safeParse(req.params);
  const parsed = variantClassificationBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: params.error?.message ?? parsed.error?.message });
    return;
  }
  const variant = await manufacturingService.updateVariantClassification(
    params.data.variantId,
    parsed.data.classification,
  );
  if (!variant) {
    res.status(404).json({ error: "Sellable variant not found." });
    return;
  }
  res.json(variant);
});

router.get("/manufacturing/variants/:variantId/boms", async (req, res): Promise<void> => {
  const params = variantParam.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [variant] = await db.select({ id: productVariantsTable.id }).from(productVariantsTable)
    .where(eq(productVariantsTable.id, params.data.variantId));
  if (!variant) { res.status(404).json({ error: "Sellable variant not found." }); return; }
  const boms = await db.select().from(manufacturingBomsTable)
    .where(eq(manufacturingBomsTable.variantId, params.data.variantId)).orderBy(desc(manufacturingBomsTable.version));
  const result = await Promise.all(boms.map(async (bom) => {
    const [components, operations] = await Promise.all([
      db.select().from(manufacturingBomComponentsTable).where(eq(manufacturingBomComponentsTable.bomId, bom.id)),
      db.select().from(manufacturingBomOperationsTable).where(eq(manufacturingBomOperationsTable.bomId, bom.id))
        .orderBy(manufacturingBomOperationsTable.sortOrder, manufacturingBomOperationsTable.id),
    ]);
    return {
      ...bom,
      components: components.map((component) => ({
        ...component,
        unitCostGbpSnapshot: Number(component.unitCostGbpSnapshot),
      })),
      operations: operations.map((operation) => ({ ...operation, labourAllowance: Number(operation.labourAllowance) })),
    };
  }));
  res.json(result);
});

router.post("/manufacturing/variants/:variantId/boms", async (req, res): Promise<void> => {
  const params = variantParam.safeParse(req.params);
  const parsed = bomInput.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: params.error?.message ?? parsed.error?.message }); return;
  }
  const actor = actorFor(req);
  try {
    const bom = await manufacturingService.createBomVersion(params.data.variantId, parsed.data, actor);
    res.status(201).json(bom);
  } catch (error) {
    res.status((error as { status?: number })?.status ?? statusForError(error)).json({ error: errorMessage(error) });
  }
});

// Public, read-only component availability is deliberately scoped to published,
// currently sellable variants. Disabled/legacy variants keep their old stock path.
router.get("/shop/variants/:variantId/availability", async (req, res): Promise<void> => {
  const params = variantParam.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [published] = await db.select({
    id: productVariantsTable.id,
    manufacturingEnabled: productVariantsTable.manufacturingEnabled,
  }).from(productVariantsTable)
    .innerJoin(productsTable, eq(productsTable.id, productVariantsTable.productId))
    .where(and(
      eq(productVariantsTable.id, params.data.variantId),
      eq(productVariantsTable.isAvailable, true),
      eq(productVariantsTable.manufacturingEnabled, true),
      eq(productsTable.websitePublished, true),
    ));
  if (!published) { res.status(404).json({ error: "Published variant not found." }); return; }
  try {
    const availability = await availabilityService.availability(published.id);
    res.json({ variantId: published.id, manufacturingEnabled: true, status: availability.status });
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: errorMessage(error) });
  }
});

router.get("/manufacturing/variants/:variantId/availability", async (req, res): Promise<void> => {
  const params = variantParam.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  try { res.json(await availabilityService.availability(params.data.variantId)); }
  catch (error) { res.status((error as { status?: number }).status ?? 500).json({ error: errorMessage(error) }); }
});

router.patch("/manufacturing/variants/:variantId/availability-policy", async (req, res): Promise<void> => {
  const params = variantParam.safeParse(req.params);
  const parsed = UpdateManufacturingVariantAvailabilityPolicyBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    const error = !params.success ? params.error.message : !parsed.success ? parsed.error.message : "Invalid request.";
    res.status(400).json({ error }); return;
  }
  try {
    const updated = await availabilityService.configureVariantAvailabilityPolicy(params.data.variantId, parsed.data);
    res.json(updated);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: errorMessage(error) });
  }
});

router.get("/manufacturing/policy", async (req, res): Promise<void> => {
  const [policy] = await db.select().from(manufacturingAvailabilityPoliciesTable)
    .where(eq(manufacturingAvailabilityPoliciesTable.id, 1));
  res.json(policy ?? { id: 1, lowStockThreshold: 3, holdDurationMinutes: 20 });
});

router.patch("/manufacturing/policy", async (req, res): Promise<void> => {
  const parsed = UpdateManufacturingAvailabilityPolicyBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  res.json(await availabilityService.updateAvailabilityPolicy(parsed.data));
});

router.get("/manufacturing/components/:id/balances", async (req, res): Promise<void> => {
  const params = idParam.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  try {
    const [balance, holds, allocations] = await Promise.all([
      availabilityService.componentBalances(params.data.id),
      db.select().from(manufacturingCheckoutHoldsTable)
        .where(and(eq(manufacturingCheckoutHoldsTable.componentId, params.data.id),
          eq(manufacturingCheckoutHoldsTable.status, "ACTIVE"),
          sql`${manufacturingCheckoutHoldsTable.expiresAt} > now()`)),
      db.select().from(manufacturingAllocationsTable)
        .where(and(eq(manufacturingAllocationsTable.componentId, params.data.id),
          eq(manufacturingAllocationsTable.status, "CONFIRMED"))),
    ]);
    res.json({ ...balance, holds, allocations });
  } catch (error) { res.status((error as { status?: number }).status ?? 500).json({ error: errorMessage(error) }); }
});

router.get("/manufacturing/orders/:id/readiness", async (req, res): Promise<void> => {
  const params = idParam.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [order] = await db.select({ id: ordersTable.id }).from(ordersTable)
    .where(eq(ordersTable.id, params.data.id));
  if (!order) { res.status(404).json({ error: "Order not found." }); return; }
  res.json(await availabilityService.orderReadiness(params.data.id));
});

export default router;