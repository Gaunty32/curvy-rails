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
  .filter((file) => /^000[0-5]_.*\.sql$/.test(file))
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
          const requestPaymentIntent = async (body: Record<string, unknown>) => {
            const response = await fetch(`${baseUrl}/shop/stripe/payment-intent`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            return { response, body: await response.json() as Record<string, any> };
          };
          const rightTotal = 70.2;

          expect(process.env.STRIPE_SECRET_KEY).toBe("sk_test_clean_template_synthetic");
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
          const submitOrder = async () => {
            const response = await fetch(`${baseUrl}/shop/orders`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(orderBody),
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
          expect(stripeState.creates).toHaveLength(1);
          expect(stripeState.retrieves).toEqual([paymentIntentId, paymentIntentId]);
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