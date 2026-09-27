import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "@workspace/db/schema";
import {
  manufacturingBomComponentsTable, manufacturingComponentsTable,
  manufacturingMovementsTable, manufacturingStocktakesTable,
  productsTable, productVariantsTable,
} from "@workspace/db/schema";
import { createManufacturingService } from "../src/services/manufacturing.js";

const databaseUrl = process.env.MANUFACTURING_PHASE1_TEST_DATABASE_URL;
const require = createRequire(import.meta.url);
const { Pool } = require("../../../lib/db/node_modules/pg") as {
  Pool: new (options: { connectionString: string }) => {
    connect(): Promise<{ query(text: string): Promise<{ rows: Array<Record<string, unknown>> }>; release(): void }>;
    query(text: string): Promise<{ rows: Array<Record<string, unknown>> }>;
    end(): Promise<void>;
  };
};

function validateIsolatedDatabaseUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("MANUFACTURING_PHASE1_TEST_DATABASE_URL must be a PostgreSQL URL.");
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || !/^manufacturing_phase1_test_[a-z0-9_]+$/i.test(databaseName)) {
    throw new Error("Manufacturing integration tests only allow an isolated PostgreSQL database named manufacturing_phase1_test_*.");
  }
  return parsed;
}

if (!databaseUrl) {
  describe.skip("manufacturing database invariants (isolated migrated PostgreSQL)", () => {
    it("requires MANUFACTURING_PHASE1_TEST_DATABASE_URL", () => {});
  });
} else {
  describe("manufacturing database invariants (isolated migrated PostgreSQL)", () => {
    const safeUrl = validateIsolatedDatabaseUrl(databaseUrl).toString();
    const pool = new Pool({ connectionString: safeUrl });
    const testDb = drizzle(pool as never, { schema });
    const service = createManufacturingService(testDb);
    const rollbackSignal = new Error("rollback isolated manufacturing test transaction");
    let databaseWasVerifiedEmpty = false;

    async function withRollback(run: (tx: unknown) => Promise<void>): Promise<void> {
      try {
        await testDb.transaction(async (tx) => {
          await run(tx);
          throw rollbackSignal;
        });
        throw new Error("Expected test transaction to roll back.");
      } catch (error) {
        if (error !== rollbackSignal) throw error;
      }
    }

    async function assertMigratedAndEmpty(): Promise<void> {
      const client = await pool.connect();
      try {
        const result = await client.query(`
          SELECT to_regclass('public.manufacturing_components') AS components,
                 to_regclass('public.manufacturing_bom_components') AS bom_lines,
                 EXISTS (
                   SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public'
                     AND table_name = 'manufacturing_bom_components'
                     AND column_name = 'component_sku_snapshot'
                  ) AS snapshots,
                  EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'manufacturing_stocktakes'
                      AND column_name = 'movement_revision'
                  ) AS movement_revision
        `);
        if (!result.rows[0]?.components || !result.rows[0]?.bom_lines
          || result.rows[0]?.snapshots !== true || result.rows[0]?.movement_revision !== true) {
          throw new Error("Manufacturing Phase 1 migration 0006 must be applied to the isolated test database.");
        }
        const counts = await client.query(`
          SELECT
            (SELECT count(*)::int FROM manufacturing_components) AS components,
            (SELECT count(*)::int FROM manufacturing_stock_movements) AS movements,
            (SELECT count(*)::int FROM manufacturing_stocktakes) AS stocktakes,
            (SELECT count(*)::int FROM manufacturing_boms) AS boms,
            (SELECT count(*)::int FROM manufacturing_bom_components) AS bom_lines
        `);
        if (Object.values(counts.rows[0] ?? {}).some((count) => count !== 0)) {
          throw new Error("Manufacturing integration tests require an empty, dedicated test database.");
        }
        databaseWasVerifiedEmpty = true;
      } finally {
        client.release();
      }
    }

    beforeAll(assertMigratedAndEmpty);
    afterAll(async () => {
      if (databaseWasVerifiedEmpty) {
        await pool.query(`
          TRUNCATE TABLE manufacturing_bom_components, manufacturing_stocktakes,
            manufacturing_stock_movements, manufacturing_components RESTART IDENTITY
        `);
      }
      await pool.end();
    });

    it("records one opening movement exactly once and rolls all fixture rows back", async () => {
      let sku = "";
      await withRollback(async (tx) => {
        const txService = createManufacturingService(tx as never);
        const [component] = await tx.insert(manufacturingComponentsTable).values({
          sku: `PH1-${randomUUID()}`,
          name: "Opening balance test",
          type: "garment",
        }).returning();
        sku = component.sku;

        await expect(txService.createStocktake(component.id, 0, "phase1-integration-test", null))
          .rejects.toMatchObject({ status: 409 });
        const opening = await txService.recordOpeningBalance(component.id, 0, "phase1-integration-test", null);
        expect(opening.reason).toBe("OPENING_BALANCE");
        expect(opening.quantityChange).toBe(0);
        await expect(txService.recordOpeningBalance(component.id, 5, "phase1-integration-test", null))
          .rejects.toMatchObject({ status: 409 });

        const [updated] = await tx.select().from(manufacturingComponentsTable)
          .where(eq(manufacturingComponentsTable.id, component.id));
        expect(updated?.physicalBalance).toBe(0);
        const movements = await tx.select().from(manufacturingMovementsTable)
          .where(eq(manufacturingMovementsTable.componentId, component.id));
        expect(movements).toHaveLength(1);
      });
      const remaining = await testDb.select({ id: manufacturingComponentsTable.id }).from(manufacturingComponentsTable)
        .where(eq(manufacturingComponentsTable.sku, sku));
      expect(remaining).toHaveLength(0);
    });

    it("serializes concurrent opening attempts and rejects the loser with 409", async () => {
      const [component] = await testDb.insert(manufacturingComponentsTable).values({
        sku: `PH1-CONCURRENT-${randomUUID()}`,
        name: "Concurrent opening test",
        type: "garment",
      }).returning();
      const results = await Promise.allSettled([
        service.recordOpeningBalance(component.id, 4, "phase1-integration-test", null),
        service.recordOpeningBalance(component.id, 6, "phase1-integration-test", null),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected?.status === "rejected" ? rejected.reason : null).toMatchObject({ status: 409 });
      const [stored] = await testDb.select().from(manufacturingComponentsTable)
        .where(eq(manufacturingComponentsTable.id, component.id));
      const movements = await testDb.select().from(manufacturingMovementsTable)
        .where(eq(manufacturingMovementsTable.componentId, component.id));
      expect([4, 6]).toContain(stored.physicalBalance);
      expect(movements).toHaveLength(1);
    });

    it("applies stocktake variance once and rejects stale drafts", async () => {
      await withRollback(async (tx) => {
        const txService = createManufacturingService(tx as never);
        const [component] = await tx.insert(manufacturingComponentsTable).values({
          sku: `PH1-STOCKTAKE-${randomUUID()}`,
          name: "Stocktake test",
          type: "transfer",
        }).returning();
        await txService.recordOpeningBalance(component.id, 10, "phase1-integration-test", null);
        const first = await txService.createStocktake(component.id, 7, "phase1-integration-test", "counted");
        const approved = await txService.approveStocktake(first.id, "phase1-integration-test");
        expect(approved.movement?.quantityChange).toBe(-3);
        expect(approved.movement?.resultingBalance).toBe(7);

        const stale = await txService.createStocktake(component.id, 6, "phase1-integration-test", null);
        const newer = await txService.createStocktake(component.id, 9, "phase1-integration-test", null);
        await txService.approveStocktake(newer.id, "phase1-integration-test");
        await expect(txService.approveStocktake(stale.id, "phase1-integration-test"))
          .rejects.toMatchObject({ status: 409 });

        const [stored] = await tx.select().from(manufacturingComponentsTable)
          .where(eq(manufacturingComponentsTable.id, component.id));
        expect(stored.physicalBalance).toBe(9);
        const history = await tx.select().from(manufacturingStocktakesTable)
          .where(eq(manufacturingStocktakesTable.componentId, component.id));
        expect(history).toHaveLength(3);
      });
    });

    it("rejects an ABA stock change even when the balance returns to the draft quantity", async () => {
      await withRollback(async (tx) => {
        const txService = createManufacturingService(tx as never);
        const [component] = await tx.insert(manufacturingComponentsTable).values({
          sku: `PH1-ABA-${randomUUID()}`,
          name: "Stocktake ABA test",
          type: "transfer",
        }).returning();
        await txService.recordOpeningBalance(component.id, 5, "phase1-integration-test", null);

        const stale = await txService.createStocktake(component.id, 4, "phase1-integration-test", "original count");
        const up = await txService.createStocktake(component.id, 7, "phase1-integration-test", "first movement");
        await txService.approveStocktake(up.id, "phase1-integration-test");
        const down = await txService.createStocktake(component.id, 5, "phase1-integration-test", "second movement");
        await txService.approveStocktake(down.id, "phase1-integration-test");

        const [stored] = await tx.select().from(manufacturingComponentsTable)
          .where(eq(manufacturingComponentsTable.id, component.id));
        expect(stored.physicalBalance).toBe(stale.expectedQuantity);
        await expect(txService.approveStocktake(stale.id, "phase1-integration-test"))
          .rejects.toMatchObject({ status: 409 });
      });
    });

    it("changes a variant classification label without changing legacy stock quantity", async () => {
      await withRollback(async (tx) => {
        const txService = createManufacturingService(tx as never);
        const [product] = await tx.insert(productsTable).values({ name: "Classification label test product" }).returning();
        const [variant] = await tx.insert(productVariantsTable).values({
          productId: product.id,
          stockQuantity: 23,
        }).returning();

        for (const classification of ["FINISHED_STOCK", "COMPONENT_STOCK", "LEGACY_REVIEW"] as const) {
          const updated = await txService.updateVariantClassification(variant.id, classification);
          expect(updated).toEqual({
            variantId: variant.id,
            classification,
            stockQuantity: 23,
          });
        }
        const [unchanged] = await tx.select().from(productVariantsTable)
          .where(eq(productVariantsTable.id, variant.id));
        expect(unchanged?.stockQuantity).toBe(23);
        expect(unchanged?.inventoryClassification).toBe("LEGACY_REVIEW");
      });
    });

    it("freezes component SKU, name, and unit cost into immutable BOM lines", async () => {
      await withRollback(async (tx) => {
        const txService = createManufacturingService(tx as never);
        const [product] = await tx.insert(productsTable).values({ name: "BOM snapshot test product" }).returning();
        const [variant] = await tx.insert(productVariantsTable).values({ productId: product.id }).returning();
        const [component] = await tx.insert(manufacturingComponentsTable).values({
          sku: `PH1-BOM-${randomUUID()}`,
          name: "Original garment label",
          type: "garment",
          costGbp: "4.25",
        }).returning();
        const bom = await txService.createBomVersion(variant.id, {
          components: [{ componentId: component.id, quantity: 1 }],
          operations: [{ method: "press", labourAllowance: 1, sortOrder: 0 }],
        }, "phase1-integration-test");
        await tx.update(manufacturingComponentsTable).set({
          sku: `PH1-RENAMED-${randomUUID()}`,
          name: "Renamed current component",
          costGbp: "9.75",
        }).where(eq(manufacturingComponentsTable.id, component.id));
        expect(bom.components[0]).toMatchObject({
          componentSkuSnapshot: component.sku,
          componentNameSnapshot: "Original garment label",
          unitCostGbpSnapshot: 4.25,
        });

        const mutationFailure = await tx.transaction(async (savepoint) => {
          await savepoint.update(manufacturingBomComponentsTable)
            .set({ componentNameSnapshot: "tampered" })
            .where(eq(manufacturingBomComponentsTable.id, bom.components[0]!.id));
        }).then(() => null, (error: unknown) => error as { cause?: { code?: string; message?: string } });
        expect(mutationFailure).not.toBeNull();
        expect(mutationFailure?.cause?.code).toBe("P0001");
        expect(mutationFailure?.cause?.message).toMatch(/manufacturing records are immutable/);
        const [unchanged] = await tx.select().from(manufacturingBomComponentsTable)
          .where(eq(manufacturingBomComponentsTable.id, bom.components[0]!.id));
        expect(unchanged?.componentNameSnapshot).toBe("Original garment label");
      });
    });
  });
}