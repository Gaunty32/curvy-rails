import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "@workspace/db/schema";
import {
  manufacturingBomsTable,
  manufacturingBomComponentsTable,
  manufacturingBomOperationsTable,
  manufacturingCheckoutHoldsTable, manufacturingComponentsTable,
  manufacturingMovementsTable, manufacturingStocktakesTable,
  ordersTable, orderItemsTable, productsTable, productVariantsTable,
} from "@workspace/db/schema";
import { createManufacturingService } from "../src/services/manufacturing.js";
import { createManufacturingAvailabilityService } from "../src/services/manufacturing-availability.js";

const databaseUrl = process.env.MANUFACTURING_PHASE2_TEST_DATABASE_URL;
const require = createRequire(import.meta.url);
const { Pool } = require("../../../lib/db/node_modules/pg") as {
  Pool: new (options: { connectionString: string }) => {
    connect(): Promise<{ query(text: string): Promise<{ rows: Array<Record<string, unknown>> }>; release(): void }>;
    end(): Promise<void>;
  };
};

function validateIsolatedDatabaseUrl(value: string): URL {
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error("MANUFACTURING_PHASE2_TEST_DATABASE_URL must be a PostgreSQL URL."); }
  const name = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !/^manufacturing_phase2_test_[a-z0-9_]+$/i.test(name)) {
    throw new Error("Phase 2 integration tests only allow a dedicated manufacturing_phase2_test_* PostgreSQL database.");
  }
  return parsed;
}

if (!databaseUrl) {
  describe.skip("manufacturing Phase 2 isolated PostgreSQL invariants", () => {
    it("requires MANUFACTURING_PHASE2_TEST_DATABASE_URL and manually applied migration 0008", () => {});
  });
} else {
  describe("manufacturing Phase 2 isolated PostgreSQL invariants", () => {
    const pool = new Pool({ connectionString: validateIsolatedDatabaseUrl(databaseUrl).toString() });
    const db = drizzle(pool as never, { schema });
    const manufacturing = createManufacturingService(db);
    const availability = createManufacturingAvailabilityService(db);
    let verifiedEmpty = false;

    async function rollback(run: (tx: any) => Promise<void>) {
      const signal = new Error("rollback phase 2 test fixture");
      try {
        await db.transaction(async (tx) => { await run(tx); throw signal; });
        throw new Error("Expected test fixture transaction rollback.");
      } catch (error) { if (error !== signal) throw error; }
    }

    async function fixture(tx: any, label: string, physical: Array<{ name: string; quantity: number; replenishable?: boolean; leadDays?: number | null }>) {
      const components = [];
      for (const item of physical) {
        const [component] = await tx.insert(manufacturingComponentsTable).values({
          sku: `P2-${label}-${randomUUID()}`,
          name: item.name,
          type: "garment",
          replenishable: item.replenishable ?? false,
          leadDays: item.leadDays ?? null,
        }).returning();
        await createManufacturingService(tx as never).recordOpeningBalance(component.id, item.quantity, "phase2-integration", null);
        components.push(component);
      }
      const [product] = await tx.insert(productsTable).values({ name: `Phase 2 ${label}` }).returning();
      const [variant] = await tx.insert(productVariantsTable).values({
        productId: product.id,
        stockQuantity: 71,
      }).returning();
      return { components, product, variant };
    }

    async function activate(tx: any, variantId: number, components: Array<{ id: number; quantity: number }>) {
      await createManufacturingService(tx as never).createBomVersion(variantId, {
        components: components.map(({ id, quantity }) => ({ componentId: id, quantity })),
      }, "phase2-integration");
      await createManufacturingAvailabilityService(tx as never).setVariantManufacturingEnabled(variantId, true);
    }

    async function insertPaidOrder(tx: any, variantId: number, quantity: number) {
      const [order] = await tx.insert(ordersTable).values({
        orderNumber: `P2-${randomUUID()}`,
        status: "confirmed",
      }).returning();
      const [item] = await tx.insert(orderItemsTable).values({
        orderId: order.id,
        productName: "Phase 2 test order item",
        quantity,
      }).returning();
      return { order, item, variantId };
    }

    beforeAll(async () => {
      const client = await pool.connect();
      try {
        const required = await client.query(`
          SELECT to_regclass('public.manufacturing_checkout_holds') AS holds,
                 to_regclass('public.manufacturing_confirmed_allocations') AS allocations,
                 EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'product_variants'
                     AND column_name = 'manufacturing_enabled') AS enabled_column,
                 EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'manufacturing_confirmed_allocations'
                     AND column_name = 'manual_review_required') AS manual_review_column,
                 (SELECT count(*)::int FROM information_schema.table_constraints tc
                   JOIN information_schema.referential_constraints rc
                     ON rc.constraint_catalog = tc.constraint_catalog
                     AND rc.constraint_schema = tc.constraint_schema
                     AND rc.constraint_name = tc.constraint_name
                   WHERE tc.table_schema = 'public'
                     AND tc.table_name = 'manufacturing_confirmed_allocations'
                     AND tc.constraint_type = 'FOREIGN KEY'
                     AND tc.constraint_name IN (
                       'manufacturing_confirmed_allocations_order_id_fkey',
                       'manufacturing_confirmed_allocations_order_item_id_fkey'
                     )
                     AND rc.delete_rule = 'RESTRICT') AS restrict_foreign_keys
        `);
        if (!required.rows[0]?.holds || !required.rows[0]?.allocations
          || required.rows[0]?.enabled_column !== true
          || required.rows[0]?.manual_review_column !== true
          || required.rows[0]?.restrict_foreign_keys !== 2) {
          throw new Error("Apply final manual migration lib/db/drizzle/0008_manufacturing_availability_reservations.sql before Phase 2 tests.");
        }
        const counts = await client.query(`
          SELECT (SELECT count(*)::int FROM manufacturing_components) AS components,
                 (SELECT count(*)::int FROM manufacturing_boms) AS boms,
                 (SELECT count(*)::int FROM manufacturing_stock_movements) AS movements,
                 (SELECT count(*)::int FROM manufacturing_checkout_holds) AS holds,
                 (SELECT count(*)::int FROM manufacturing_confirmed_allocations) AS allocations
        `);
        if (Object.values(counts.rows[0] ?? {}).some((count) => count !== 0)) {
          throw new Error("Phase 2 integration tests require an empty, dedicated database.");
        }
        verifiedEmpty = true;
      } finally { client.release(); }
    });

    afterAll(async () => {
      if (verifiedEmpty) {
        // Safe only after the dedicated database was verified empty above.
        const client = await pool.connect();
        try {
          await client.query(`TRUNCATE TABLE manufacturing_confirmed_allocations, manufacturing_checkout_holds,
            manufacturing_bom_operations, manufacturing_bom_components, manufacturing_stocktakes,
            manufacturing_stock_movements, manufacturing_boms, manufacturing_components,
            order_items, orders, product_variants, products RESTART IDENTITY CASCADE`);
        } finally { client.release(); }
      }
      await pool.end();
    });

    it("demonstrates shared blank competition and preserves physical balances through paid allocation", async () => {
      await rollback(async (tx) => {
        const txAvailability = createManufacturingAvailabilityService(tx as never);
        const blank = await fixture(tx, "SHARED", [{ name: "Black hoodie 22", quantity: 10 }]);
        const [gvTransfer] = await tx.insert(manufacturingComponentsTable).values({
          sku: `P2-GV-${randomUUID()}`, name: "Good Vibes transfer", type: "transfer",
        }).returning();
        const [crTransfer] = await tx.insert(manufacturingComponentsTable).values({
          sku: `P2-CR-${randomUUID()}`, name: "Curvy Rails transfer", type: "transfer",
        }).returning();
        await createManufacturingService(tx as never).recordOpeningBalance(gvTransfer.id, 30, "phase2-integration", null);
        await createManufacturingService(tx as never).recordOpeningBalance(crTransfer.id, 30, "phase2-integration", null);
        const [crProduct] = await tx.insert(productsTable).values({ name: `Phase 2 Curvy Rails ${randomUUID()}` }).returning();
        const [gv] = await tx.insert(productVariantsTable).values({
          productId: blank.product.id, colour: "Good Vibes", stockQuantity: 71,
        }).returning();
        const [cr] = await tx.insert(productVariantsTable).values({
          productId: crProduct.id, colour: "Curvy Rails", stockQuantity: 19,
        }).returning();
        await activate(tx, gv.id, [{ id: blank.components[0].id, quantity: 1 }, { id: gvTransfer.id, quantity: 1 }]);
        await activate(tx, cr.id, [{ id: blank.components[0].id, quantity: 1 }, { id: crTransfer.id, quantity: 1 }]);
        expect((await txAvailability.availability(gv.id, tx)).producibleQuantity).toBe(10);
        expect((await txAvailability.availability(cr.id, tx)).producibleQuantity).toBe(10);
        await txAvailability.holdCheckout(`intent-${randomUUID()}`, [{ variantId: gv.id, quantity: 6, lineIndex: 0 }]);
        expect((await txAvailability.componentBalances(blank.components[0].id, tx)).available).toBe(4);
        expect((await txAvailability.componentBalances(blank.components[0].id, tx)))
          .toMatchObject({ physical: 10, held: 6, available: 4 });
        expect((await txAvailability.componentBalances(gvTransfer.id, tx)))
          .toMatchObject({ physical: 30, held: 6, available: 24 });
        expect((await txAvailability.availability(gv.id, tx)).producibleQuantity).toBe(4);
        expect((await txAvailability.availability(cr.id, tx)).producibleQuantity).toBe(4);

        const intent = `intent-${randomUUID()}`;
        await txAvailability.holdCheckout(intent, [{ variantId: cr.id, quantity: 4, lineIndex: 0 }]);
        const { order, item } = await insertPaidOrder(tx, cr.id, 4);
        const converted = await txAvailability.convertPaidCheckout(tx, intent, order.id, (lineIndex) => lineIndex === 0 ? item.id : undefined);
        expect(converted).toHaveLength(2);
        expect(await txAvailability.convertPaidCheckout(tx, intent, order.id, { 0: item.id })).toEqual(converted);
        expect((await txAvailability.componentBalances(blank.components[0].id, tx))).toMatchObject({
          physical: 10, held: 6, allocated: 4, available: 0,
        });
        expect((await txAvailability.availability(gv.id, tx)).producibleQuantity).toBe(0);
        expect((await txAvailability.availability(cr.id, tx)).producibleQuantity).toBe(0);
        const [unchanged] = await tx.select().from(productVariantsTable).where(eq(productVariantsTable.id, gv.id));
        expect(unchanged.stockQuantity).toBe(71);
        const physical = await tx.select().from(manufacturingComponentsTable)
          .where(eq(manufacturingComponentsTable.id, blank.components[0].id));
        expect(physical[0].physicalBalance).toBe(10);
      });
    });

    it("calculates 20 blanks and 7 transfers, floors multi-quantity BOMs, and ignores operation-only entries", async () => {
      await rollback(async (tx) => {
        const txManufacturing = createManufacturingService(tx as never);
        const txAvailability = createManufacturingAvailabilityService(tx as never);
        const tenTwenty = await fixture(tx, "TEN-TWENTY", [
          { name: "Ten blanks", quantity: 10 },
          { name: "Twenty transfers", quantity: 20 },
        ]);
        await txManufacturing.createBomVersion(tenTwenty.variant.id, {
          components: tenTwenty.components.map((component) => ({ componentId: component.id, quantity: 1 })),
          operations: [{
            method: "PRINT",
            position: "front",
            instructions: "Non-stock operation with a deliberately large labour allowance.",
            labourAllowance: 999999,
            sortOrder: 0,
          }],
        }, "phase2-integration");
        await txAvailability.setVariantManufacturingEnabled(tenTwenty.variant.id, true);
        const tenTwentyAvailability = await txAvailability.availability(tenTwenty.variant.id, tx);
        expect(tenTwentyAvailability.producibleQuantity).toBe(10);
        expect(tenTwentyAvailability.components).toHaveLength(2);
        expect((await tx.select().from(manufacturingBomOperationsTable)
          .where(eq(manufacturingBomOperationsTable.bomId, tenTwentyAvailability.bomId!))).length).toBe(1);

        const stock = await fixture(tx, "FLOOR-OPERATIONS", [
          { name: "Twenty blanks", quantity: 20 },
          { name: "Seven transfers", quantity: 7 },
        ]);
        await tx.update(productVariantsTable).set({ colour: "Unit ratio" })
          .where(eq(productVariantsTable.id, stock.variant.id));
        const [floorVariant] = await tx.insert(productVariantsTable).values({
          productId: stock.product.id,
          colour: "Multi-quantity ratio",
        }).returning();
        await txManufacturing.createBomVersion(stock.variant.id, {
          components: stock.components.map((component) => ({ componentId: component.id, quantity: 1 })),
        }, "phase2-integration");
        await txManufacturing.createBomVersion(floorVariant.id, {
          components: [
            { componentId: stock.components[0].id, quantity: 3 },
            { componentId: stock.components[1].id, quantity: 2 },
          ],
        }, "phase2-integration");
        await txAvailability.setVariantManufacturingEnabled(stock.variant.id, true);
        await txAvailability.setVariantManufacturingEnabled(floorVariant.id, true);

        expect((await txAvailability.availability(stock.variant.id, tx)).producibleQuantity).toBe(7);
        expect((await txAvailability.availability(floorVariant.id, tx)).producibleQuantity).toBe(3);
      });
    });

    it("expires holds by SQL time, creates bounded shortages, converts once, and leaves legacy stock alone", async () => {
      await rollback(async (tx) => {
        const txAvailability = createManufacturingAvailabilityService(tx as never);
        const stock = await fixture(tx, "SHORT", [
          { name: "Replenishable blank", quantity: 2, replenishable: true, leadDays: 2 },
          { name: "Transfer", quantity: 30 },
        ]);
        const [variant] = await tx.select().from(productVariantsTable).where(eq(productVariantsTable.id, stock.variant.id));
        await activate(tx, variant.id, stock.components.map((component) => ({ id: component.id, quantity: 1 })));
        await tx.update(productVariantsTable).set({
          allowOrderToReplenish: true, maxOutstandingReplenishmentUnits: 4, promisedReplenishmentDays: 3,
        }).where(eq(productVariantsTable.id, variant.id));
        const intent = `partial-${randomUUID()}`;
        const holds = await txAvailability.holdCheckout(intent, [{ variantId: variant.id, quantity: 4, lineIndex: 0 }]);
        expect(holds.find((hold: any) => hold.componentId === stock.components[0].id)?.shortfallQuantity).toBe(2);
        expect(holds.find((hold: any) => hold.componentId === stock.components[1].id)?.shortfallQuantity).toBe(0);
        const { order, item } = await insertPaidOrder(tx, variant.id, 4);
        const allocation = await txAvailability.convertPaidCheckout(tx, intent, order.id, { 0: item.id });
        expect(allocation.find((line: any) => line.componentId === stock.components[0].id))
          .toMatchObject({ requiredQuantity: 4, allocatedQuantity: 2, shortfallQuantity: 2 });
        expect(allocation.find((line: any) => line.componentId === stock.components[1].id))
          .toMatchObject({ requiredQuantity: 4, allocatedQuantity: 4, shortfallQuantity: 0 });
        expect((await txAvailability.orderReadiness(order.id, tx)).readiness).toBe("PARTIALLY_ALLOCATED");
        expect((await txAvailability.componentBalances(stock.components[0].id, tx)).physical).toBe(2);

        const transferAvailable = (await txAvailability.componentBalances(stock.components[1].id, tx)).available;
        const releaseIntent = `release-${randomUUID()}`;
        await txAvailability.holdCheckout(releaseIntent, [{ variantId: variant.id, quantity: 1, lineIndex: 0 }]);
        expect((await txAvailability.componentBalances(stock.components[1].id, tx)).held).toBe(1);
        await txAvailability.releaseCheckout(releaseIntent);
        expect((await txAvailability.componentBalances(stock.components[1].id, tx)).available).toBe(transferAvailable);

        await txAvailability.releaseOrderAllocations(tx, order.id);
        expect((await txAvailability.componentBalances(stock.components[0].id, tx)))
          .toMatchObject({ physical: 2, allocated: 0, available: 2 });
        expect((await txAvailability.componentBalances(stock.components[1].id, tx)).physical).toBe(30);
        expect((await tx.select().from(productVariantsTable)
          .where(eq(productVariantsTable.id, variant.id)))[0].stockQuantity).toBe(71);
        expect((await txAvailability.orderReadiness(order.id, tx)).readiness).toBe("WAITING_FOR_COMPONENTS");

        const expiring = await txAvailability.holdCheckout(`expire-${randomUUID()}`, [
          { variantId: variant.id, quantity: 1, lineIndex: 0 },
        ]);
        await tx.update(manufacturingCheckoutHoldsTable).set({ expiresAt: new Date(0) })
          .where(eq(manufacturingCheckoutHoldsTable.id, expiring[0].id));
        expect((await txAvailability.componentBalances(stock.components[0].id, tx)).held).toBe(0);
        expect((await txAvailability.componentBalances(stock.components[0].id, tx)).available).toBe(2);
        const legacy = await fixture(tx, "LEGACY", [{ name: "Unmigrated stock", quantity: 9 }]);
        const legacyAvailability = await txAvailability.availability(legacy.variant.id, tx);
        expect(legacyAvailability).toMatchObject({ manufacturingEnabled: false, status: "LEGACY", producibleQuantity: null });
        expect(legacy.variant.stockQuantity).toBe(71);
      });
    });

    it("keeps a failed manufacturing enable from partially saving replenishment policy", async () => {
      await rollback(async (tx) => {
        const stock = await fixture(tx, "ATOMIC-POLICY", [{ name: "Not yet BOM-configured", quantity: 5 }]);
        const txAvailability = createManufacturingAvailabilityService(tx as never);
        await expect(txAvailability.configureVariantAvailabilityPolicy(stock.variant.id, {
          manufacturingEnabled: true,
          allowOrderToReplenish: true,
          maxOutstandingReplenishmentUnits: 12,
          promisedReplenishmentDays: 8,
        })).rejects.toMatchObject({ status: 409 });
        const [unchanged] = await tx.select().from(productVariantsTable)
          .where(eq(productVariantsTable.id, stock.variant.id));
        expect(unchanged).toMatchObject({
          manufacturingEnabled: false,
          allowOrderToReplenish: false,
          maxOutstandingReplenishmentUnits: 0,
          promisedReplenishmentDays: 0,
        });
      });
    });

    it("rejects manufacturing activation for sibling variants the shop selector cannot distinguish", async () => {
      await rollback(async (tx) => {
        const stock = await fixture(tx, "DUPLICATE-VARIANT", [{ name: "Duplicate selection blank", quantity: 5 }]);
        await tx.update(productVariantsTable).set({
          colour: "Black",
          size: "M",
          sleeve: "Short",
          variantAttributes: [{ id: 9, name: "Material", option: "Cotton" }],
        }).where(eq(productVariantsTable.id, stock.variant.id));
        await tx.insert(productVariantsTable).values({
          productId: stock.product.id,
          colour: "Black",
          size: "M",
          sleeve: "Short",
          variantAttributes: [{ id: 9, name: "Material", option: "Cotton" }],
        });
        await createManufacturingService(tx as never).createBomVersion(stock.variant.id, {
          components: [{ componentId: stock.components[0].id, quantity: 1 }],
        }, "phase2-integration");

        const txAvailability = createManufacturingAvailabilityService(tx as never);
        await expect(txAvailability.configureVariantAvailabilityPolicy(stock.variant.id, {
          manufacturingEnabled: true,
          allowOrderToReplenish: true,
          maxOutstandingReplenishmentUnits: 3,
          promisedReplenishmentDays: 2,
        })).rejects.toMatchObject({
          status: 409,
          message: expect.stringContaining("current checkout cannot distinguish"),
        });
        const [unchanged] = await tx.select().from(productVariantsTable)
          .where(eq(productVariantsTable.id, stock.variant.id));
        expect(unchanged).toMatchObject({
          manufacturingEnabled: false,
          allowOrderToReplenish: false,
          maxOutstandingReplenishmentUnits: 0,
          promisedReplenishmentDays: 0,
        });
      });
    });

    it("returns structured component shortage details when strict checkout cannot reserve", async () => {
      await rollback(async (tx) => {
        const stock = await fixture(tx, "STRICT-SHORTAGE", [{ name: "Strict blank", quantity: 1 }]);
        const txAvailability = createManufacturingAvailabilityService(tx as never);
        await activate(tx, stock.variant.id, [{ id: stock.components[0].id, quantity: 1 }]);
        expect(stock.variant).toMatchObject({
          allowOrderToReplenish: false,
          maxOutstandingReplenishmentUnits: 0,
          promisedReplenishmentDays: 0,
        });
        const intent = `strict-${randomUUID()}`;
        await expect(txAvailability.holdCheckout(intent, [
          { variantId: stock.variant.id, quantity: 2, lineIndex: 4 },
        ])).rejects.toMatchObject({
          status: 409,
          shortfall: {
            variantId: stock.variant.id,
            lineIndex: 4,
            missingFinishedUnits: 1,
            components: [{ componentId: stock.components[0].id, required: 2, available: 1, shortfall: 1 }],
          },
        });
        expect(await tx.select().from(manufacturingCheckoutHoldsTable)
          .where(eq(manufacturingCheckoutHoldsTable.paymentIntentId, intent))).toHaveLength(0);
        expect(await txAvailability.componentBalances(stock.components[0].id, tx))
          .toMatchObject({ physical: 1, held: 0, available: 1 });
      });
    });

    it("releases an active checkout hold after a failed checkout without changing physical stock", async () => {
      await rollback(async (tx) => {
        const stock = await fixture(tx, "FAILED-CHECKOUT", [{ name: "Failed checkout blank", quantity: 4 }]);
        const txAvailability = createManufacturingAvailabilityService(tx as never);
        await activate(tx, stock.variant.id, [{ id: stock.components[0].id, quantity: 1 }]);
        const before = await txAvailability.componentBalances(stock.components[0].id, tx);
        const intent = `failed-checkout-${randomUUID()}`;
        const hold = await txAvailability.holdCheckout(intent, [
          { variantId: stock.variant.id, quantity: 2, lineIndex: 0 },
        ]);
        expect(await txAvailability.componentBalances(stock.components[0].id, tx)).toMatchObject({
          physical: 4, held: 2, available: 2,
        });
        const released = await txAvailability.releaseCheckout(intent);
        expect(released).toHaveLength(1);
        expect(await txAvailability.componentBalances(stock.components[0].id, tx)).toMatchObject({
          physical: before.physical, held: 0, available: before.available,
        });
        expect(hold[0].status).toBe("ACTIVE");
      });
    });

    it("keeps a paid hold bound to its original BOM after a later current BOM is authored", async () => {
      await rollback(async (tx) => {
        const txManufacturing = createManufacturingService(tx as never);
        const txAvailability = createManufacturingAvailabilityService(tx as never);
        const stock = await fixture(tx, "BOM-HISTORY", [
          { name: "Original BOM blank", quantity: 8 },
          { name: "Later BOM blank", quantity: 20 },
        ]);
        const firstBom = await txManufacturing.createBomVersion(stock.variant.id, {
          components: [{ componentId: stock.components[0].id, quantity: 1 }],
        }, "phase2-integration");
        await txAvailability.setVariantManufacturingEnabled(stock.variant.id, true);
        const intent = `original-bom-${randomUUID()}`;
        const holds = await txAvailability.holdCheckout(intent, [
          { variantId: stock.variant.id, quantity: 2, lineIndex: 0 },
        ]);

        const laterBom = await txManufacturing.createBomVersion(stock.variant.id, {
          components: [{ componentId: stock.components[1].id, quantity: 1 }],
        }, "phase2-integration");
        expect((await txAvailability.availability(stock.variant.id, tx)).bomId).toBe(laterBom.id);
        const { order, item } = await insertPaidOrder(tx, stock.variant.id, 2);
        const allocations = await txAvailability.convertPaidCheckout(tx, intent, order.id, { 0: item.id });
        expect(holds.every((hold: any) => hold.bomId === firstBom.id)).toBe(true);
        expect(allocations).toHaveLength(1);
        expect(allocations[0]).toMatchObject({
          bomId: firstBom.id,
          componentId: stock.components[0].id,
          requiredQuantity: 2,
          allocatedQuantity: 2,
          shortfallQuantity: 0,
        });
        expect((await txAvailability.componentBalances(stock.components[0].id, tx)).physical).toBe(8);
        expect((await txAvailability.componentBalances(stock.components[1].id, tx)).physical).toBe(20);
      });
    });

    it("records independent shortfalls for two missing components", async () => {
      await rollback(async (tx) => {
        const txAvailability = createManufacturingAvailabilityService(tx as never);
        const stock = await fixture(tx, "MULTI-SHORTFALL", [
          { name: "Short component A", quantity: 1, replenishable: true, leadDays: 2 },
          { name: "Short component B", quantity: 2, replenishable: true, leadDays: 2 },
        ]);
        await activate(tx, stock.variant.id, stock.components.map((component) => ({ id: component.id, quantity: 1 })));
        await txAvailability.configureVariantAvailabilityPolicy(stock.variant.id, {
          allowOrderToReplenish: true,
          maxOutstandingReplenishmentUnits: 2,
          promisedReplenishmentDays: 3,
        });
        const intent = `multi-shortfall-${randomUUID()}`;
        const holds = await txAvailability.holdCheckout(intent, [
          { variantId: stock.variant.id, quantity: 3, lineIndex: 0 },
        ]);
        expect(holds).toHaveLength(2);
        expect(holds.find((row: any) => row.componentId === stock.components[0].id))
          .toMatchObject({ requiredQuantity: 3, heldQuantity: 1, shortfallQuantity: 2 });
        expect(holds.find((row: any) => row.componentId === stock.components[1].id))
          .toMatchObject({ requiredQuantity: 3, heldQuantity: 2, shortfallQuantity: 1 });

        const { order, item } = await insertPaidOrder(tx, stock.variant.id, 3);
        const allocations = await txAvailability.convertPaidCheckout(tx, intent, order.id, { 0: item.id });
        expect(allocations.find((row: any) => row.componentId === stock.components[0].id))
          .toMatchObject({ allocatedQuantity: 1, shortfallQuantity: 2 });
        expect(allocations.find((row: any) => row.componentId === stock.components[1].id))
          .toMatchObject({ allocatedQuantity: 2, shortfallQuantity: 1 });
      });
    });

    it("marks an expired paid hold with lost stock for manual review, not normal replenishment", async () => {
      await rollback(async (tx) => {
        const stock = await fixture(tx, "EXPIRED-PAID", [{ name: "Single strict-hold component", quantity: 1 }]);
        const txAvailability = createManufacturingAvailabilityService(tx as never);
        await activate(tx, stock.variant.id, [{ id: stock.components[0].id, quantity: 1 }]);
        const expiredIntent = `expired-paid-${randomUUID()}`;
        const [expiredHold] = await txAvailability.holdCheckout(expiredIntent, [
          { variantId: stock.variant.id, quantity: 1, lineIndex: 0 },
        ]);
        await tx.update(manufacturingCheckoutHoldsTable).set({ expiresAt: new Date(0) })
          .where(eq(manufacturingCheckoutHoldsTable.id, expiredHold.id));

        const liveIntent = `live-paid-${randomUUID()}`;
        await txAvailability.holdCheckout(liveIntent, [
          { variantId: stock.variant.id, quantity: 1, lineIndex: 0 },
        ]);
        const liveOrder = await insertPaidOrder(tx, stock.variant.id, 1);
        await txAvailability.convertPaidCheckout(tx, liveIntent, liveOrder.order.id, { 0: liveOrder.item.id });

        const expiredOrder = await insertPaidOrder(tx, stock.variant.id, 1);
        const allocations = await txAvailability.convertPaidCheckout(
          tx, expiredIntent, expiredOrder.order.id, { 0: expiredOrder.item.id },
        );
        expect(allocations[0]).toMatchObject({
          requiredQuantity: 1,
          allocatedQuantity: 0,
          shortfallQuantity: 1,
          manualReviewRequired: true,
          manualReviewReason: "HOLD_EXPIRED_STOCK_UNAVAILABLE",
        });
        const readiness = await txAvailability.orderReadiness(expiredOrder.order.id, tx);
        expect(readiness).toMatchObject({
          readiness: "WAITING_FOR_COMPONENTS",
          manualReviewRequired: true,
        });
      });
    });

    it("serializes two checkouts competing for the final physical component", async () => {
      const fixtureId = randomUUID();
      const [product] = await db.insert(productsTable).values({ name: `Concurrent ${fixtureId}` }).returning();
      const [component] = await db.insert(manufacturingComponentsTable).values({
        sku: `P2-CONCURRENT-${fixtureId}`, name: "Final component", type: "garment",
      }).returning();
      await manufacturing.recordOpeningBalance(component.id, 1, "phase2-integration", null);
      const [variant] = await db.insert(productVariantsTable).values({ productId: product.id }).returning();
      await manufacturing.createBomVersion(variant.id, { components: [{ componentId: component.id, quantity: 1 }] }, "phase2-integration");
      await availability.setVariantManufacturingEnabled(variant.id, true);
      const intentA = `concurrent-a-${fixtureId}`;
      const intentB = `concurrent-b-${fixtureId}`;
      const attempts = await Promise.allSettled([
        availability.holdCheckout(intentA, [{ variantId: variant.id, quantity: 1, lineIndex: 0 }]),
        availability.holdCheckout(intentB, [{ variantId: variant.id, quantity: 1, lineIndex: 0 }]),
      ]);
      expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
      expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
      expect((await availability.componentBalances(component.id)).available).toBe(0);
    });
  });
}