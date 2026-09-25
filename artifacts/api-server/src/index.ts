/**
 * Fail-closed entry point for the sanitised transfer.
 *
 * Local testing remains explicitly limited to isolated loopback databases.
 * A newly provisioned remote database must be explicitly acknowledged and
 * inspected before any application router or service is imported.
 */
import { inspectFreshDatabase } from "./setup/fresh-database-guard.js";

function parseDatabaseUrl(): URL {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for setup-only mode.");

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("Refusing to start: DATABASE_URL must identify a PostgreSQL database.");
  }
  return parsed;
}

function assertLocalTemplateDatabase(parsed: URL): void {
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!loopbackHosts.has(hostname)) {
    throw new Error("Refusing to start: only a loopback PostgreSQL database is allowed in local-test mode.");
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!/(?:test|template|saniti[sz]ed-transfer)/i.test(databaseName)) {
    throw new Error("Refusing to start: the local database name must identify an isolated test or template database.");
  }
}

const parsedDatabaseUrl = parseDatabaseUrl();
if (process.env.TEMPLATE_LOCAL_TEST === "true") {
  assertLocalTemplateDatabase(parsedDatabaseUrl);
} else {
  if (process.env.TEMPLATE_FRESH_INSTALL !== "true") {
    throw new Error("Refusing to start: set TEMPLATE_FRESH_INSTALL=true only after confirming DATABASE_URL points to a newly provisioned database.");
  }
  const hostname = parsedDatabaseUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (new Set(["localhost", "127.0.0.1", "::1"]).has(hostname)) {
    throw new Error("Refusing to start: fresh-install mode requires a remote PostgreSQL database; use TEMPLATE_LOCAL_TEST=true for isolated local tests.");
  }
  // The explicit acknowledgement is checked before inspection. The shared DB
  // package only creates a lazy pool on import, and app modules remain unloaded.
  const { pool } = await import("@workspace/db");
  await inspectFreshDatabase(pool);
}

// Dynamic import is intentional: no router, service, scheduler, or application
// module is evaluated until the startup database safety guard has passed.
const { default: app } = await import("./app.js");
const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";
app.listen(port, host, () => {
  console.info(`Sanitised-transfer API listening on ${host}:${port}; setup-only mode remains enforced.`);
});

export {};