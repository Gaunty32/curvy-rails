const TEMPLATE_MARKER_KEY = "sanitised_transfer_template_instance";
const EXPECTED_PUBLIC_TABLES = [
  "analytics_events",
  "analytics_sessions",
  "bundle_components",
  "bundles",
  "callback_requests",
  "chat_conversations",
  "chat_message_reads",
  "chat_messages",
  "chat_notification_prefs",
  "chat_participants",
  "customer_contacts",
  "customer_delivery_addresses",
  "customer_enquiries",
  "customer_enquiry_items",
  "customer_employees",
  "customer_employee_sizes",
  "customer_files",
  "customer_finish_stock",
  "customer_finished_items",
  "customer_finishes",
  "customer_finish_processes",
  "customer_finish_products",
  "customer_invoice_addresses",
  "customer_open_pos",
  "customer_portal_users",
  "customer_processes",
  "customer_references",
  "customer_roles",
  "customer_stock_movements",
  "customers",
  "customer_teams",
  "demo_leads",
  "enquiries",
  "feedback_items",
  "knowledge_email_campaigns",
  "live_chat_sessions",
  "linkedin_shared_posts",
  "manual_purchase_requirements",
  "message_templates",
  "order_attribution",
  "order_email_logs",
  "order_items",
  "order_label_prints",
  "order_logs",
  "order_message_reads",
  "order_messages",
  "order_confirmation_content_alerts",
  "orders",
  "portal_baskets",
  "portal_notifications",
  "process_stock",
  "product_attributes",
  "product_categories",
  "product_variants",
  "products",
  "purchase_order_items",
  "purchase_orders",
  "quote_items",
  "quotes",
  "select_extra_claims",
  "select_extra_offers",
  "settings",
  "shop_customers",
  "shop_checkout_intents",
  "staff_members",
  "stock_bins",
  "suppliers",
  "sync_logs",
  "tasks",
  "social_posts",
  "supplier_chase_logs",
  "wc_enquiries",
  "workflow_executions",
  "workflows",
  "workflow_steps",
  "worksheet_items",
  "worksheets",
] as const;

type QueryResult<Row = Record<string, unknown>> = { rows: Row[] };
type Queryable = {
  query: (...args: any[]) => Promise<QueryResult<any>>;
};
type ReleasableClient = Queryable & { release: () => void };
type PoolLike = Queryable & { connect: () => Promise<ReleasableClient> };

/**
 * Verify a newly provisioned database before application modules are loaded.
 * Accepts either a pg Pool (which this function checks out and releases) or a
 * pg client (whose lifetime remains owned by the caller).
 */
export async function inspectFreshDatabase(database: PoolLike | ReleasableClient): Promise<void> {
  let client: Queryable;
  let releaseClient = false;
  try {
    if ("connect" in database && typeof database.connect === "function") {
      client = await database.connect();
      releaseClient = true;
    } else {
      client = database;
    }

    try {
      await client.query("BEGIN READ ONLY");
      const catalog = await client.query(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      const catalogRows = catalog.rows as { table_name: string }[];
      const tables = new Set(catalogRows.map(({ table_name }) => table_name));
      const missingTables = EXPECTED_PUBLIC_TABLES.filter((table) => !tables.has(table));
      if (missingTables.length) {
        throw new Error("Refusing to start: the database does not contain the expected application schema.");
      }

      const marker = await client.query(
        `SELECT value FROM public.settings WHERE key = $1 LIMIT 1`,
        [TEMPLATE_MARKER_KEY],
      );
      const markerRows = marker.rows as { value: string | null }[];
      if (markerRows.length) {
        if (markerRows[0].value !== "true") {
          throw new Error("Refusing to start: the template-instance marker is invalid.");
        }
        await client.query("ROLLBACK");
        return;
      }

      for (const table of catalogRows.map(({ table_name }) => table_name)) {
        // Identifiers are safely quoted; names came from information_schema.
        const quotedTable = `"${table.replace(/"/g, '""')}"`;
        if (table === "__drizzle_migrations" || table === "drizzle_migrations") continue;
        const populated = await client.query(
          `SELECT EXISTS (SELECT 1 FROM public.${quotedTable} LIMIT 1) AS populated`,
        );
        if (populated.rows[0]?.populated) {
          throw new Error("Refusing to start: an unmarked database must be empty before first setup.");
        }
      }
      await client.query("ROLLBACK");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* Preserve the original inspection error. */ }
      throw error;
    } finally {
      if (releaseClient) (client as ReleasableClient).release();
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Refusing to start:")) throw error;
    // Driver errors can contain connection details, so never echo them.
    throw new Error("Refusing to start: the PostgreSQL database could not be safely inspected.");
  }
}