import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { inspectFreshDatabase } from "../src/setup/fresh-database-guard.js";

const testDatabaseUrl = process.env.FRESH_DATABASE_GUARD_TEST_DATABASE_URL;
const migrationsDirectory = new URL("../../../lib/db/drizzle/", import.meta.url);
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort();
const require = createRequire(import.meta.url);
const { Pool } = require("../../../lib/db/node_modules/pg") as {
  Pool: new (options: { connectionString: string }) => {
    connect(): Promise<{ query(text: string): Promise<unknown>; release(): void }>;
    query(text: string): Promise<unknown>;
    end(): Promise<void>;
  };
};

function safeTestDatabaseUrl(value: string): URL {
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
    || !(/^(clean_template_.*|.*_test)$/i.test(databaseName))) {
    throw new Error("Fresh database guard tests only allow 127.0.0.1:55438 databases named clean_template_* or *_test.");
  }
  return parsed;
}

if (!testDatabaseUrl) {
  describe.skip("fresh database startup guard (isolated loopback Postgres)", () => {
    it("requires FRESH_DATABASE_GUARD_TEST_DATABASE_URL for disposable loopback Postgres tests", () => {});
  });
} else {
describe("fresh database startup guard (isolated loopback Postgres)", () => {
  const sourceUrl = safeTestDatabaseUrl(testDatabaseUrl);
  const adminPool = new Pool({ connectionString: sourceUrl.toString() });
  let databaseSequence = 0;
  afterAll(async () => adminPool.end());

  async function withFreshDatabase(run: (pool: InstanceType<typeof Pool>) => Promise<void>): Promise<void> {
    const databaseName = `clean_template_guard_${process.pid}_${databaseSequence++}`;
    const databaseUrl = new URL(sourceUrl);
    databaseUrl.pathname = `/${databaseName}`;
    await adminPool.query(`CREATE DATABASE "${databaseName}"`);
    const databasePool = new Pool({ connectionString: databaseUrl.toString() });
    try {
      await run(databasePool);
    } finally {
      await databasePool.end();
      await adminPool.query(`DROP DATABASE "${databaseName}"`);
    }
  }

  async function applyMigrations(pool: InstanceType<typeof Pool>): Promise<void> {
    const client = await pool.connect();
    try {
      for (const migrationFile of migrationFiles) {
        const migrationPath = new URL(migrationFile, migrationsDirectory);
        await client.query(readFileSync(migrationPath, "utf8"));
      }
    } finally {
      client.release();
    }
  }

  it("accepts a blank database after all application migrations", async () => {
    await withFreshDatabase(async (pool) => {
      await applyMigrations(pool);
      await expect(inspectFreshDatabase(pool)).resolves.toBeUndefined();
    });
  }, 60_000);

  it("rejects an unmarked populated migrated database", async () => {
    await withFreshDatabase(async (pool) => {
      await applyMigrations(pool);
      await pool.query("INSERT INTO public.settings (key, value) VALUES ('guard_test_data', 'present')");
      await expect(inspectFreshDatabase(pool)).rejects.toThrow(
        "Refusing to start: an unmarked database must be empty before first setup.",
      );
    });
  }, 60_000);

  it("accepts a marked populated database on restart", async () => {
    await withFreshDatabase(async (pool) => {
      await applyMigrations(pool);
      await pool.query(
        "INSERT INTO public.settings (key, value) VALUES ('sanitised_transfer_template_instance', 'true'), ('guard_test_data', 'present')",
      );
      await expect(inspectFreshDatabase(pool)).resolves.toBeUndefined();
    });
  }, 60_000);

  it("rejects an incomplete schema", async () => {
    await withFreshDatabase(async (pool) => {
      await pool.query("CREATE TABLE public.settings (key text, value text)");
      await expect(inspectFreshDatabase(pool)).rejects.toThrow(
        "Refusing to start: the database does not contain the expected application schema.",
      );
    });
  }, 60_000);

});
}