import { and, eq, inArray, desc } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import {
  manufacturingComponentsTable, manufacturingMovementsTable,
  manufacturingStocktakesTable, manufacturingBomsTable,
  manufacturingBomComponentsTable, manufacturingBomOperationsTable,
  productVariantsTable,
} from "@workspace/db/schema";
import { assertOpeningBalanceAvailable, nextBomVersion, stocktakeVariance } from "./manufacturing-rules.js";

type ManufacturingDatabase = NodePgDatabase<typeof schema>;
export type BomDefinition = {
  components: Array<{ componentId: number; quantity: number }>;
  operations?: Array<{
    method: string;
    designRef?: string | null;
    position?: string | null;
    instructions?: string | null;
    labourAllowance: number;
    thumbnail?: string | null;
    sortOrder: number;
  }>;
};
export type InventoryClassification = "LEGACY_REVIEW" | "FINISHED_STOCK" | "COMPONENT_STOCK";

function httpError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

export function createManufacturingService(database: ManufacturingDatabase) {
  return {
    async recordOpeningBalance(componentId: number, countedQuantity: number, actor: string, note: string | null) {
      return database.transaction(async (tx) => {
        const [component] = await tx.select().from(manufacturingComponentsTable)
          .where(eq(manufacturingComponentsTable.id, componentId)).for("update");
        if (!component) throw httpError("Component not found.", 404);
        const [[priorMovement], [priorStocktake]] = await Promise.all([
          tx.select({ id: manufacturingMovementsTable.id }).from(manufacturingMovementsTable)
            .where(eq(manufacturingMovementsTable.componentId, component.id)).limit(1),
          tx.select({ id: manufacturingStocktakesTable.id }).from(manufacturingStocktakesTable)
            .where(eq(manufacturingStocktakesTable.componentId, component.id)).limit(1),
        ]);
        assertOpeningBalanceAvailable(component.physicalBalance, Boolean(priorMovement || priorStocktake));
        await tx.update(manufacturingComponentsTable).set({ physicalBalance: countedQuantity, updatedAt: new Date() })
          .where(eq(manufacturingComponentsTable.id, component.id));
        const [created] = await tx.insert(manufacturingMovementsTable).values({
          componentId: component.id,
          quantityChange: countedQuantity,
          reason: "OPENING_BALANCE",
          actor,
          reference: null,
          note,
          resultingBalance: countedQuantity,
        }).returning();
        return created;
      });
    },

    async createStocktake(componentId: number, countedQuantity: number, actor: string, note: string | null) {
      return database.transaction(async (tx) => {
        const [component] = await tx.select().from(manufacturingComponentsTable)
          .where(eq(manufacturingComponentsTable.id, componentId)).for("update");
        if (!component) throw httpError("Component not found.", 404);
        const [openingMovement] = await tx.select({ id: manufacturingMovementsTable.id })
          .from(manufacturingMovementsTable)
          .where(and(
            eq(manufacturingMovementsTable.componentId, component.id),
            eq(manufacturingMovementsTable.reason, "OPENING_BALANCE"),
          )).limit(1);
        if (!openingMovement) {
          throw httpError("Record an opening balance before creating a stocktake.", 409);
        }
        const [latestMovement] = await tx.select({ id: manufacturingMovementsTable.id })
          .from(manufacturingMovementsTable)
          .where(eq(manufacturingMovementsTable.componentId, component.id))
          .orderBy(desc(manufacturingMovementsTable.id)).limit(1);
        if (!latestMovement) throw httpError("Component has no stock movement revision.", 409);
        const [created] = await tx.insert(manufacturingStocktakesTable).values({
          componentId: component.id,
          expectedQuantity: component.physicalBalance,
          countedQuantity,
          movementRevision: latestMovement.id,
          createdBy: actor,
          note,
        }).returning();
        return created;
      });
    },

    async approveStocktake(stocktakeId: number, actor: string) {
      return database.transaction(async (tx) => {
        const [stocktake] = await tx.select().from(manufacturingStocktakesTable)
          .where(eq(manufacturingStocktakesTable.id, stocktakeId)).for("update");
        if (!stocktake) throw httpError("Stocktake not found.", 404);
        if (stocktake.status !== "draft") throw httpError("Stocktake has already been approved.", 409);
        const [component] = await tx.select().from(manufacturingComponentsTable)
          .where(eq(manufacturingComponentsTable.id, stocktake.componentId)).for("update");
        if (!component) throw httpError("Component not found.", 404);
        const [latestMovement] = await tx.select({ id: manufacturingMovementsTable.id })
          .from(manufacturingMovementsTable)
          .where(eq(manufacturingMovementsTable.componentId, component.id))
          .orderBy(desc(manufacturingMovementsTable.id)).limit(1);
        const variance = stocktakeVariance(
          stocktake.expectedQuantity,
          component.physicalBalance,
          stocktake.countedQuantity,
          stocktake.movementRevision,
          latestMovement?.id ?? -1,
        );
        let movement = null;
        if (variance !== 0) {
          await tx.update(manufacturingComponentsTable).set({ physicalBalance: stocktake.countedQuantity, updatedAt: new Date() })
            .where(eq(manufacturingComponentsTable.id, component.id));
          [movement] = await tx.insert(manufacturingMovementsTable).values({
            componentId: component.id,
            quantityChange: variance,
            reason: "STOCKTAKE_ADJUSTMENT",
            actor,
            reference: `stocktake:${stocktake.id}`,
            note: stocktake.note,
            resultingBalance: stocktake.countedQuantity,
          }).returning();
        }
        const [approved] = await tx.update(manufacturingStocktakesTable).set({
          status: "approved",
          approvedBy: actor,
          approvedAt: new Date(),
        }).where(eq(manufacturingStocktakesTable.id, stocktake.id)).returning();
        return { stocktake: approved, movement };
      });
    },

    async updateVariantClassification(variantId: number, classification: InventoryClassification) {
      const [variant] = await database.update(productVariantsTable)
        .set({ inventoryClassification: classification })
        .where(eq(productVariantsTable.id, variantId))
        .returning({
          variantId: productVariantsTable.id,
          classification: productVariantsTable.inventoryClassification,
          stockQuantity: productVariantsTable.stockQuantity,
        });
      return variant ?? null;
    },

    async createBomVersion(variantId: number, definition: BomDefinition, actor: string) {
      return database.transaction(async (tx) => {
        const [variant] = await tx.select({ id: productVariantsTable.id }).from(productVariantsTable)
          .where(eq(productVariantsTable.id, variantId)).for("update");
        if (!variant) throw httpError("Sellable variant not found.", 404);
        const componentIds = definition.components.map((line) => line.componentId);
        if (new Set(componentIds).size !== componentIds.length) {
          throw httpError("Component lines must have distinct component IDs.", 400);
        }
        const components = await tx.select({
          id: manufacturingComponentsTable.id,
          sku: manufacturingComponentsTable.sku,
          name: manufacturingComponentsTable.name,
          costGbp: manufacturingComponentsTable.costGbp,
          active: manufacturingComponentsTable.active,
        }).from(manufacturingComponentsTable)
          .where(inArray(manufacturingComponentsTable.id, componentIds))
          .for("share");
        if (components.length !== componentIds.length) throw httpError("Every BOM component must exist.", 400);
        if (components.some((component) => !component.active)) {
          throw httpError("Inactive components cannot be added to a BOM.", 400);
        }
        const componentById = new Map(components.map((component) => [component.id, component]));
        const [latest] = await tx.select({ version: manufacturingBomsTable.version }).from(manufacturingBomsTable)
          .where(eq(manufacturingBomsTable.variantId, variant.id))
          .orderBy(desc(manufacturingBomsTable.version)).limit(1);
        const version = nextBomVersion(latest?.version ?? null);
        await tx.update(manufacturingBomsTable).set({ isCurrent: false })
          .where(and(eq(manufacturingBomsTable.variantId, variant.id), eq(manufacturingBomsTable.isCurrent, true)));
        const [created] = await tx.insert(manufacturingBomsTable).values({
          variantId: variant.id, version, isCurrent: true, createdBy: actor,
        }).returning();
        const componentLines = await tx.insert(manufacturingBomComponentsTable).values(definition.components.map((line) => {
          const component = componentById.get(line.componentId)!;
          return {
            bomId: created.id,
            componentId: line.componentId,
            quantity: line.quantity,
            componentSkuSnapshot: component.sku,
            componentNameSnapshot: component.name,
            unitCostGbpSnapshot: component.costGbp,
          };
        })).returning();
        const operations = definition.operations ?? [];
        const operationLines = operations.length
          ? await tx.insert(manufacturingBomOperationsTable).values(operations.map((operation) => ({
            bomId: created.id,
            ...operation,
            labourAllowance: String(operation.labourAllowance),
            designRef: operation.designRef ?? null,
            position: operation.position ?? null,
            instructions: operation.instructions ?? null,
            thumbnail: operation.thumbnail ?? null,
          }))).returning()
          : [];
        return {
          ...created,
          components: componentLines.map((line) => ({
            ...line,
            unitCostGbpSnapshot: Number(line.unitCostGbpSnapshot),
          })),
          operations: operationLines.map((operation) => ({ ...operation, labourAllowance: Number(operation.labourAllowance) })),
        };
      });
    },
  };
}