import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, describe, expect, it, vi } from "vitest";

const stripeState = vi.hoisted(() => ({
  creates: [] as Array<Record<string, any>>,
  intents: new Map<string, Record<string, any>>(),
  retrieves: [] as string[],
}));

vi.mock("../src/services/stripeClient.js", () => ({
  getStripePublishableKey: vi.fn(async () => "pk_test_clean_template_synthetic"),
  getUncachableStripeClient: vi.fn(async () => ({
    paymentIntents: {
      create: vi.fn(async (params: Record<string, any>) => {
        stripeState.creates.push(structuredClone(params));
        const id = `pi_clean_template_${stripeState.creates.length}`;
        const intent = {
          id,
          client_secret: `${id}_secret_synthetic`,
          amount: params.amount,
          currency: params.currency,
          metadata: structuredClone(params.metadata),
          status: "requires_payment_method",
        };
        stripeState.intents.set(id, intent);
        return intent;
      }),
      retrieve: vi.fn(async (id: string) => {
        stripeState.retrieves.push(id);
        const intent = stripeState.intents.get(id);
        if (!intent) throw new Error(`Unknown mocked PaymentIntent ${id}`);
        return intent;
      }),
    },
  })),
}));

vi.mock("../src/services/email.js", () => ({
  sendEmail: vi.fn(async () => ({ sent: true })),
}));

const testDatabaseUrl = process.env.FRESH_DATABASE_GUARD_TEST_DATABASE_URL;
const migrationsDirectory = new URL("../../../lib/db/drizzle/", import.meta.url);
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((file) => /^000[0-8]_.*\.sql$/.test(file))
  .sort();
const require = createRequire(import.meta.url);
const { Pool } = require("../../../lib/db/node_modules/pg") as {
  Pool: new (options: { connectionString: string }) => {
    connect(): Promise<{ query(text: string): Promise<unknown>; release(): void }>;
    query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
    end(): Promise<void>;
  };
};

function safeDisposableDatabaseUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("FRESH_DATABASE_GUARD_TEST_DATABASE_URL must be a PostgreSQL URL.");
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1"
    || parsed.port !== "55438"
    || !/^(clean_template_.*|.*_test)$/i.test(databaseName)) {
    throw new Error(
      "Shop payment flow tests only allow 127.0.0.1:55438 databases named clean_template_* or *_test.",
    );
  }
  return parsed;
}

if (!testDatabaseUrl) {
  describe.skip("offline shop payment flow (disposable loopback PostgreSQL)", () => {
    it("requires FRESH_DATABASE_GUARD_TEST_DATABASE_URL for 127.0.0.1:55438", () => {});
  });
} else {
  describe("offline shop payment flow (disposable loopback PostgreSQL)", () => {
    const sourceUrl = safeDisposableDatabaseUrl(testDatabaseUrl);
    const adminPool = new Pool({ connectionString: sourceUrl.toString() });
    let sequence = 0;

    afterAll(async () => adminPool.end());

    async function withFreshDatabase(
      run: (databaseUrl: URL, pool: InstanceType<typeof Pool>) => Promise<void>,
    ): Promise<void> {
      const databaseName = `clean_template_shop_flow_${process.pid}_${sequence++}`;
      const databaseUrl = new URL(sourceUrl);
      databaseUrl.pathname = `/${databaseName}`;
      await adminPool.query(`CREATE DATABASE "${databaseName}"`);
      const databasePool = new Pool({ connectionString: databaseUrl.toString() });
      try {
        await run(databaseUrl, databasePool);
      } finally {
        await databasePool.end();
        await adminPool.query(`DROP DATABASE "${databaseName}"`);
      }
    }

    async function applySchemaOnly(pool: InstanceType<typeof Pool>): Promise<void> {
      expect(migrationFiles).toEqual([
        "0000_clean_bootstrap_v1.sql",
        "0001_reviewed_missing_tables.sql",
        "0002_reviewed_chat_schema.sql",
        "0003_reviewed_route_columns.sql",
        "0004_reviewed_first_run_route_columns.sql",
        "0005_checkout_intent_snapshots.sql",
        "0006_manufacturing_phase1.sql",
        "0007_manufacturing_stocktake_revision.sql",
        "0008_manufacturing_availability_reservations.sql",
      ]);
      const client = await pool.connect();
      try {
        for (const file of migrationFiles) {
          await client.query(readFileSync(new URL(file, migrationsDirectory), "utf8"));
        }
      } finally {
        client.release();
      }
    }

    it("rejects invalid charges before Stripe, then records and reuses one snapshot-priced paid order", async () => {
      stripeState.creates.length = 0;
      stripeState.intents.clear();
      stripeState.retrieves.length = 0;

      await withFreshDatabase(async (databaseUrl, seedPool) => {
        await applySchemaOnly(seedPool);
        await seedPool.query(
          `INSERT INTO settings (key, value) VALUES
            ('installation_activated', 'true'),
            ('integration_enabled', '{"stripe":true,"postcodes_io":true}'),
            ('business_config', '{"name":"Clean Template Test Business","tradingName":"Clean Template Test Business","email":"orders@example.invalid","phone":"0000000000","address":"1 Synthetic Road, Testville"}'),
            ('shop_warehouse_collection_enabled', 'false'),
            ('shop_free_local_delivery_enabled', 'true'),
            ('shop_free_local_delivery_latitude', '51.5074'),
            ('shop_free_local_delivery_longitude', '-0.1278'),
            ('shop_free_local_delivery_radius_miles', '10'),
            ('stripe_secret_key', 'sk_test_clean_template_synthetic')`,
        );
        await seedPool.query(
          "INSERT INTO staff_members (name, role) VALUES ('Synthetic Test Administrator', 'admin')",
        );
        const customerResult = await seedPool.query(
          "INSERT INTO customers (name, email) VALUES ('Clean Example Ltd', 'buyer@example.invalid') RETURNING id",
        );
        const productResult = await seedPool.query(
          `INSERT INTO products
            (name, sku, category, unit_price, image_url, website_published, is_archived, is_service, is_bespoke, vat_rate)
           VALUES ('Synthetic Shop Polo', 'CLEAN-POLO', 'Test Clothing', 25, 'https://images.invalid/clean-template-polo.png',
             true, false, false, false, 0.2)
           RETURNING id`,
        );
        const productId = Number(productResult.rows[0].id);
        const componentProductResult = await seedPool.query(
          `INSERT INTO products
            (name, sku, category, unit_price, image_url, website_published, is_archived, is_service, is_bespoke, vat_rate)
           VALUES ('Synthetic Component Hoodie', 'CLEAN-HOODIE', 'Test Clothing', 25, 'https://images.invalid/clean-template-hoodie.png',
             true, false, false, false, 0.2)
           RETURNING id`,
        );
        const componentProductId = Number(componentProductResult.rows[0].id);
        const variantResult = await seedPool.query(
          `INSERT INTO product_variants (product_id, colour, size, sku, manufacturing_enabled)
           VALUES ($1, 'Black', 'M', 'CLEAN-HOODIE-BLACK-M', true)
           RETURNING id`,
          [componentProductId],
        );
        const componentVariantId = Number(variantResult.rows[0].id);
        await seedPool.query(
          `INSERT INTO product_variants (product_id, colour, size, sku)
           VALUES ($1, 'White', 'M', 'CLEAN-HOODIE-WHITE-M')`,
          [componentProductId],
        );
        const componentResult = await seedPool.query(
          `INSERT INTO manufacturing_components (sku, name, type, physical_balance)
           VALUES ('CLEAN-BLANK-M', 'Synthetic Hoodie Blank M', 'garment', 20)
           RETURNING id`,
        );
        const manufacturingComponentId = Number(componentResult.rows[0].id);
        const bomResult = await seedPool.query(
          `INSERT INTO manufacturing_boms (variant_id, version, is_current, created_by)
           VALUES ($1, 1, true, 'offline test')
           RETURNING id`,
          [componentVariantId],
        );
        await seedPool.query(
          `INSERT INTO manufacturing_bom_components
            (bom_id, component_id, quantity, component_sku_snapshot, component_name_snapshot, unit_cost_gbp_snapshot)
           VALUES ($1, $2, 1, 'CLEAN-BLANK-M', 'Synthetic Hoodie Blank M', 5)`,
          [Number(bomResult.rows[0].id), manufacturingComponentId],
        );
        const bundleWooId = 987654;
        const bundleProductResult = await seedPool.query(
          `INSERT INTO products
            (name, sku, category, unit_price, image_url, website_published, is_archived, is_service, is_bespoke, vat_rate, woo_commerce_id)
           VALUES ('Synthetic Managed Bundle', 'CLEAN-MANAGED-BUNDLE', 'Test Clothing', 25, 'https://images.invalid/clean-template-bundle.png',
             true, false, false, false, 0.2, $1)
           RETURNING id`,
          [bundleWooId],
        );
        const bundleProductId = Number(bundleProductResult.rows[0].id);
        const bundleDefinitionResult = await seedPool.query(
          `INSERT INTO bundles (name, sku, price, is_active, woo_id)
           VALUES ('Synthetic Managed Bundle', 'CLEAN-MANAGED-BUNDLE', 25, true, $1)
           RETURNING id`,
          [bundleWooId],
        );
        await seedPool.query(
          `INSERT INTO bundle_components (bundle_id, product_id, product_name, quantity)
           VALUES ($1, $2, 'Synthetic Component Hoodie', 1)`,
          [Number(bundleDefinitionResult.rows[0].id), componentProductId],
        );
        expect(Number(customerResult.rows[0].id)).toBeGreaterThan(0);

        const previousDatabaseUrl = process.env.DATABASE_URL;
        const previousSecret = process.env.STRIPE_SECRET_KEY;
        const previousPublishable = process.env.STRIPE_PUBLISHABLE_KEY;
        const nativeFetch = globalThis.fetch;
        let geocodeStubCalls = 0;
        const actualFetchHosts: string[] = [];
        process.env.DATABASE_URL = databaseUrl.toString();
        process.env.STRIPE_SECRET_KEY = "sk_test_clean_template_synthetic";
        process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_clean_template_synthetic";
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
          const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
          if (target.hostname === "api.postcodes.io") {
            geocodeStubCalls += 1;
            return new Response(JSON.stringify({
              result: { latitude: 55.9533, longitude: -3.1883 },
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          if (target.hostname !== "127.0.0.1") {
            actualFetchHosts.push(target.hostname);
            throw new Error(`Unexpected outbound request in isolated checkout test: ${target.hostname}`);
          }
          return nativeFetch(input, init);
        }) as typeof fetch;

        let server: Server | undefined;
        let routePool: { end(): Promise<void> } | undefined;
        try {
          vi.resetModules();
          const shopRouter = (await import("../src/routes/shop.js")).default;
          const { pool } = await import("@workspace/db");
          routePool = pool;

          const app = express();
          app.use(express.json());
          app.use(shopRouter);
          server = createServer(app);
          await new Promise<void>((resolve, reject) => {
            server!.once("error", reject);
            server!.listen(0, "127.0.0.1", resolve);
          });
          const address = server.address();
          if (!address || typeof address === "string") throw new Error("Test server did not bind.");
          const baseUrl = `http://127.0.0.1:${address.port}`;
          const originalCart = [{
            wcProductId: productId,
            name: "Browser display name",
            sku: "UNTRUSTED-SKU",
            quantity: 2,
            price: 999,
            brandingPositions: [],
          }];
          const componentCart = [{
            wcProductId: componentProductId,
            variationId: componentVariantId,
            name: "Browser hoodie display name",
            colour: "Black",
            size: "M",
            sku: "UNTRUSTED-HOODIE-SKU",
            quantity: 2,
            price: 999,
            brandingPositions: [],
          }];
          const componentBundleCart = [{
            wcProductId: bundleProductId,
            name: "Synthetic Managed Bundle",
            quantity: 1,
            price: 999,
            brandingPositions: [],
            bundleComponents: [{
              productId: componentProductId,
              name: "Synthetic Component Hoodie",
              qty: 1,
              variationId: componentVariantId,
              colour: "Black",
              size: "M",
              brandingPositions: [],
            }],
          }];
          const requestPaymentIntent = async (body: Record<string, unknown>) => {
            const response = await fetch(`${baseUrl}/shop/stripe/payment-intent`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            return { response, body: await response.json() as Record<string, any> };
          };
          const productResponse = await fetch(`${baseUrl}/shop/wc/products/${componentProductId}`);
          const productPayload = await productResponse.json() as Record<string, any>;
          expect(productResponse.status).toBe(200);
          expect(productPayload.variations.find((variation: any) => variation.id === componentVariantId)?.manufacturingEnabled).toBe(true);
          expect(productPayload.variations.find((variation: any) => variation.attributes.some((attribute: any) => attribute.option === "White"))?.manufacturingEnabled).toBe(false);
          const rightTotal = 70.2;

          expect(process.env.STRIPE_SECRET_KEY).toBe("sk_test_clean_template_synthetic");
          const unsupportedBundle = await requestPaymentIntent({
            amount: 40.2,
            cartItems: componentBundleCart,
            shippingMethod: "courier",
            postcode: "SW1A 1AA",
          });
          expect(unsupportedBundle.response.status).toBe(409);
          expect(unsupportedBundle.body.error).toBe("Component-managed bundle checkout is not yet supported.");
          expect(stripeState.creates).toHaveLength(0);
          const bundleSnapshots = await seedPool.query(
            "SELECT payment_intent_id FROM shop_checkout_intents",
          );
          expect(bundleSnapshots.rows).toHaveLength(0);

          const underpaid = await requestPaymentIntent({
            amount: rightTotal - 1,
            cartItems: originalCart,
            shippingMethod: "courier",
            postcode: "SW1A 1AA",
          });
          expect(underpaid.response.status).toBe(400);
          expect(underpaid.body.error).toMatch(/authoritative basket total/i);
          expect(stripeState.creates).toHaveLength(0);

          const tamperedBasket = await requestPaymentIntent({
            amount: rightTotal,
            cartItems: [{ ...originalCart[0], wcProductId: productId + 999 }],
            shippingMethod: "courier",
            postcode: "SW1A 1AA",
          });
          expect(tamperedBasket.response.status).toBe(400);
          expect(tamperedBasket.body.error).toMatch(/not available/i);
          expect(stripeState.creates).toHaveLength(0);

          const disabledShipping = await requestPaymentIntent({
            amount: rightTotal,
            cartItems: originalCart,
            shippingMethod: "warehouse_collection",
          });
          expect(disabledShipping.response.status).toBe(400);
          expect(disabledShipping.body.error).toMatch(/not currently available/i);
          expect(stripeState.creates).toHaveLength(0);

          const ineligiblePostcode = await requestPaymentIntent({
            amount: 61.7,
            cartItems: originalCart,
            shippingMethod: "free_local",
            postcode: "EH1 1YZ",
          });
          expect(ineligiblePostcode.response.status).toBe(400);
          expect(ineligiblePostcode.body.error).toMatch(/only available within/i);
          expect(geocodeStubCalls).toBe(1);
          expect(stripeState.creates).toHaveLength(0);

          const intentResponse = await requestPaymentIntent({
            amount: rightTotal,
            cartItems: originalCart,
            shippingMethod: "courier",
            postcode: "SW1A 1AA",
          });
          expect(intentResponse.response.status).toBe(200);
          expect(intentResponse.body.amount).toBe(rightTotal);
          expect(stripeState.creates).toHaveLength(1);
          const paymentIntentId = intentResponse.body.paymentIntentId as string;
          const intent = stripeState.intents.get(paymentIntentId)!;
          intent.status = "succeeded";

          // Catalog price/publication may change after payment; finalization must
          // honor the durable price snapshot and accept the already-paid order.
          await seedPool.query(
            "UPDATE products SET unit_price = 999, website_published = false WHERE id = $1",
            [productId],
          );
          const orderBody = {
            paymentIntentId,
            customerName: "Synthetic Buyer",
            customerEmail: "buyer@example.invalid",
            company: "Clean Example Ltd",
            deliveryAddress: {
              line1: "10 Example Street",
              city: "London",
              postcode: "SW1A 1AA",
              country: "GB",
            },
            cartItems: originalCart,
            subtotal: 50,
            carriage: 8.5,
            total: rightTotal,
            shippingMethod: "courier",
          };
          const submitOrder = async (body: Record<string, unknown> = orderBody) => {
            const response = await fetch(`${baseUrl}/shop/orders`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            return { response, body: await response.json() as Record<string, any> };
          };

          const firstOrder = await submitOrder();
          expect(firstOrder.response.status, JSON.stringify(firstOrder.body)).toBe(200);
          expect(firstOrder.body.success).toBe(true);
          const retry = await submitOrder();
          expect(retry.response.status).toBe(200);
          expect(retry.body.orderId).toBe(firstOrder.body.orderId);
          expect(retry.body.orderNumber).toBe(firstOrder.body.orderNumber);

          const storedOrder = await seedPool.query(
            "SELECT total_amount, source FROM orders WHERE id = $1",
            [firstOrder.body.orderId],
          );
          const storedLines = await seedPool.query(
            "SELECT product_name, quantity, unit_price, line_total FROM order_items WHERE order_id = $1",
            [firstOrder.body.orderId],
          );
          const intentSnapshot = await seedPool.query(
            "SELECT status, order_id FROM shop_checkout_intents WHERE payment_intent_id = $1",
            [paymentIntentId],
          );
          const orderCount = await seedPool.query(
            "SELECT count(*)::int AS count FROM orders WHERE source = 'shop'",
          );
          expect(orderCount.rows[0].count).toBe(1);
          expect(storedOrder.rows[0]).toMatchObject({ total_amount: "70.20", source: "shop" });
          expect(storedLines.rows).toHaveLength(1);
          expect(storedLines.rows[0]).toMatchObject({
            product_name: "Synthetic Shop Polo",
            quantity: 2,
            unit_price: "25.00",
            line_total: "50.00",
          });
          expect(intentSnapshot.rows[0]).toMatchObject({
            status: "finalized",
            order_id: firstOrder.body.orderId,
          });
          // A product without an explicitly enabled BOM variant preserves the
          // legacy path and never creates component holds or allocations.
          const legacyHolds = await seedPool.query(
            "SELECT id FROM manufacturing_checkout_holds WHERE payment_intent_id = $1",
            [paymentIntentId],
          );
          const legacyAllocations = await seedPool.query(
            "SELECT id FROM manufacturing_confirmed_allocations WHERE payment_intent_id = $1",
            [paymentIntentId],
          );
          expect(legacyHolds.rows).toHaveLength(0);
          expect(legacyAllocations.rows).toHaveLength(0);
          const statusIntentId = "pi_cleantemplatestatus";
          stripeState.intents.set(statusIntentId, {
            id: statusIntentId,
            metadata: { source: "shop" },
            status: "requires_payment_method",
          });
          const retryableStatus = await fetch(`${baseUrl}/shop/stripe/payment-intent/${statusIntentId}/status`);
          expect((await retryableStatus.json()).status).toBe("requires_payment_method");
          stripeState.intents.get(statusIntentId)!.status = "canceled";
          const canceledStatus = await fetch(`${baseUrl}/shop/stripe/payment-intent/${statusIntentId}/status`);
          expect((await canceledStatus.json()).status).toBe("canceled");

          const componentIntentResponse = await requestPaymentIntent({
            amount: rightTotal,
            cartItems: componentCart,
            shippingMethod: "courier",
            postcode: "SW1A 1AA",
          });
          expect(componentIntentResponse.response.status, JSON.stringify(componentIntentResponse.body)).toBe(200);
          const componentPaymentIntentId = componentIntentResponse.body.paymentIntentId as string;
          const pendingHolds = await seedPool.query(
            `SELECT line_index, variant_id, required_quantity, held_quantity, shortfall_quantity, status
             FROM manufacturing_checkout_holds WHERE payment_intent_id = $1`,
            [componentPaymentIntentId],
          );
          expect(pendingHolds.rows).toHaveLength(1);
          expect(pendingHolds.rows[0]).toMatchObject({
            line_index: 0,
            variant_id: componentVariantId,
            required_quantity: 2,
            held_quantity: 2,
            shortfall_quantity: 0,
            status: "ACTIVE",
          });

          stripeState.intents.get(componentPaymentIntentId)!.status = "succeeded";
          const componentOrderBody = {
            ...orderBody,
            paymentIntentId: componentPaymentIntentId,
            cartItems: componentCart,
          };
          const componentOrder = await submitOrder(componentOrderBody);
          expect(componentOrder.response.status, JSON.stringify(componentOrder.body)).toBe(200);
          const componentOrderRetry = await submitOrder(componentOrderBody);
          expect(componentOrderRetry.response.status).toBe(200);
          expect(componentOrderRetry.body.orderId).toBe(componentOrder.body.orderId);

          const confirmedHold = await seedPool.query(
            "SELECT status FROM manufacturing_checkout_holds WHERE payment_intent_id = $1",
            [componentPaymentIntentId],
          );
          const allocations = await seedPool.query(
            `SELECT order_id, order_item_id, line_index, variant_id, component_id,
                    required_quantity, allocated_quantity, shortfall_quantity, status
             FROM manufacturing_confirmed_allocations WHERE payment_intent_id = $1`,
            [componentPaymentIntentId],
          );
          const componentStock = await seedPool.query(
            "SELECT physical_balance FROM manufacturing_components WHERE id = $1",
            [manufacturingComponentId],
          );
          const finalOrderCount = await seedPool.query(
            "SELECT count(*)::int AS count FROM orders WHERE source = 'shop'",
          );
          expect(confirmedHold.rows).toEqual([{ status: "CONVERTED" }]);
          expect(allocations.rows).toHaveLength(1);
          expect(allocations.rows[0]).toMatchObject({
            order_id: componentOrder.body.orderId,
            line_index: 0,
            variant_id: componentVariantId,
            component_id: manufacturingComponentId,
            required_quantity: 2,
            allocated_quantity: 2,
            shortfall_quantity: 0,
            status: "CONFIRMED",
          });
          const allocatedOrderLine = await seedPool.query(
            "SELECT id FROM order_items WHERE order_id = $1 AND product_name = $2",
            [componentOrder.body.orderId, "Synthetic Component Hoodie"],
          );
          expect(Number(allocations.rows[0].order_item_id)).toBe(Number(allocatedOrderLine.rows[0].id));
          expect(componentStock.rows[0].physical_balance).toBe(20);
          expect(finalOrderCount.rows[0].count).toBe(2);

          const expiredIntentResponse = await requestPaymentIntent({
            amount: rightTotal,
            cartItems: componentCart,
            shippingMethod: "courier",
            postcode: "SW1A 1AA",
          });
          expect(expiredIntentResponse.response.status).toBe(200);
          const expiredPaymentIntentId = expiredIntentResponse.body.paymentIntentId as string;
          await seedPool.query(
            `UPDATE manufacturing_checkout_holds
             SET expires_at = now() - interval '1 minute'
             WHERE payment_intent_id = $1`,
            [expiredPaymentIntentId],
          );
          // Leave only the two units already allocated by the first paid order;
          // the expired paid checkout therefore cannot reclaim component stock.
          await seedPool.query(
            "UPDATE manufacturing_components SET physical_balance = 2 WHERE id = $1",
            [manufacturingComponentId],
          );
          stripeState.intents.get(expiredPaymentIntentId)!.status = "succeeded";
          const expiredOrderBody = {
            ...componentOrderBody,
            paymentIntentId: expiredPaymentIntentId,
          };
          const expiredOrder = await submitOrder(expiredOrderBody);
          expect(expiredOrder.response.status, JSON.stringify(expiredOrder.body)).toBe(200);
          expect(expiredOrder.body.requiresStaffReview).toBe(true);
          expect(expiredOrder.body.fulfillmentStatus).toBe("component_review_required");
          expect(expiredOrder.body.ready).toBe(false);
          expect(expiredOrder.body.allocationShortfalls).toMatchObject([{
            component: "Synthetic Hoodie Blank M",
            required: 2,
            allocated: 0,
            shortfall: 2,
          }]);
          const expiredOrderRetry = await submitOrder(expiredOrderBody);
          expect(expiredOrderRetry.response.status).toBe(200);
          expect(expiredOrderRetry.body.orderId).toBe(expiredOrder.body.orderId);
          expect(expiredOrderRetry.body.requiresStaffReview).toBe(true);
          expect(expiredOrderRetry.body.ready).toBe(false);

          const expiredAllocationRows = await seedPool.query(
            `SELECT required_quantity, allocated_quantity, shortfall_quantity
             FROM manufacturing_confirmed_allocations WHERE payment_intent_id = $1`,
            [expiredPaymentIntentId],
          );
          const reviewOrder = await seedPool.query(
            "SELECT notes, portal_notes FROM orders WHERE id = $1",
            [expiredOrder.body.orderId],
          );
          const reviewLogCount = await seedPool.query(
            `SELECT count(*)::int AS count FROM order_logs
             WHERE order_id = $1 AND action = 'Paid order requires component review'`,
            [expiredOrder.body.orderId],
          );
          const orderCountAfterReview = await seedPool.query(
            "SELECT count(*)::int AS count FROM orders WHERE source = 'shop'",
          );
          expect(expiredAllocationRows.rows).toEqual([{
            required_quantity: 2,
            allocated_quantity: 0,
            shortfall_quantity: 2,
          }]);
          expect(reviewOrder.rows[0].notes).toMatch(/COMPONENT REVIEW REQUIRED/);
          expect(reviewOrder.rows[0].portal_notes).toMatch(/COMPONENT REVIEW REQUIRED/);
          expect(reviewLogCount.rows[0].count).toBe(1);
          expect(orderCountAfterReview.rows[0].count).toBe(3);
          expect(stripeState.creates).toHaveLength(3);
          expect(stripeState.retrieves).toEqual([
            paymentIntentId,
            paymentIntentId,
            statusIntentId,
            statusIntentId,
            componentPaymentIntentId,
            componentPaymentIntentId,
            expiredPaymentIntentId,
            expiredPaymentIntentId,
          ]);
          expect(actualFetchHosts.every((host) => host === "127.0.0.1")).toBe(true);
        } finally {
          if (server?.listening) {
            await new Promise<void>((resolve, reject) =>
              server!.close((error) => error ? reject(error) : resolve()),
            );
          }
          await routePool?.end();
          globalThis.fetch = nativeFetch;
          if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
          else process.env.DATABASE_URL = previousDatabaseUrl;
          if (previousSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
          else process.env.STRIPE_SECRET_KEY = previousSecret;
          if (previousPublishable === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
          else process.env.STRIPE_PUBLISHABLE_KEY = previousPublishable;
        }
      });
    }, 120_000);
  });
}