# Clean database bootstrap status

> **Current verification:** migrations `0000` through `0005` were applied in
> order to a new isolated loopback PostgreSQL database: 77 public tables and
> zero settings/business rows before first setup. `0005_checkout_intent_snapshots.sql`
> adds `shop_checkout_intents` for immutable server-priced payment snapshots.
> The fresh-install startup guard was tested against four disposable databases
> (blank migrated, populated unmarked, populated marked, incomplete schema).
> The older 76-table statements and limitations below describe the earlier
> `0000`–`0004` checkpoint, not the current migration count. These tests did
> not contact a live database or Stripe.

`drizzle/0000_clean_bootstrap_v1.sql` and its generated metadata are a
deterministic, schema-only baseline generated from the staged Drizzle schema as
it stood when the baseline was generated. The later route-derived chat schema
is represented separately in `src/schema/chat.ts` and migration `0002`.
The generation used a deliberately invalid, non-routable placeholder URL only
to satisfy Drizzle configuration loading; no database connection was made.

The baseline contains 44 `CREATE TABLE` statements, foreign keys, unique
constraints, and indexes derived from the then-current `src/schema/index.ts`.
It contains no `INSERT`, production rows, settings values, users, credentials,
`_migration_flags` table, or historical migration state. It must be applied
only to a newly provisioned, isolated database after independent review.

## Reviewed schema drift

The historical `artifacts/api-server/src/services/startup-migrations.ts`
creates additional tables that are not represented in the staged Drizzle
schema baseline. The missing tables are:

- `order_confirmation_content_alerts`
- `knowledge_email_campaigns`
- `wc_enquiries`
- `supplier_chase_logs`
- `customer_portal_users`
- `customer_enquiries`
- `customer_enquiry_items`
- `demo_leads`
- `customer_stock_movements`
- `portal_notifications`
- `portal_baskets`
- `select_extra_offers`
- `select_extra_claims`
- `customer_finish_stock`
- `quotes`
- `quote_items`
- `enquiries`
- `bundles`
- `bundle_components`
- `feedback_items`
- `manual_purchase_requirements`
- `social_posts`
- `chat_message_reads`
- `message_templates`
- `linkedin_shared_posts`
- `workflows`
- `workflow_steps`
- `workflow_executions`

`drizzle/0001_reviewed_missing_tables.sql` adds 27 of these tables as
schema-only objects, with the foreign keys and indexes that can be established
from the staged schema and current route contracts. It deliberately excludes
all historical seed rows, repair updates, business defaults, and credentials.
The additions are:

- `order_confirmation_content_alerts`
- `knowledge_email_campaigns`
- `wc_enquiries`
- `supplier_chase_logs`
- `customer_portal_users`
- `customer_enquiries`
- `customer_enquiry_items`
- `demo_leads`
- `customer_stock_movements`
- `portal_notifications`
- `portal_baskets`
- `select_extra_offers`
- `select_extra_claims`
- `customer_finish_stock`
- `quotes`
- `quote_items`
- `enquiries`
- `bundles`
- `bundle_components`
- `feedback_items`
- `manual_purchase_requirements`
- `social_posts`
- `message_templates`
- `linkedin_shared_posts`
- `workflows`
- `workflow_steps`
- `workflow_executions`

The migration keeps compatibility table/column names required by the staged
routes (including the historical `select_extra_*` names), but does not imply
that those names are suitable product branding. The quote token default uses
PostgreSQL's `gen_random_uuid()` function. It is available in PostgreSQL 13 and
later without an extension; on earlier versions, `pgcrypto` must be installed
and enabled before applying `0001`. This draft does not execute
`CREATE EXTENSION`: installation can require elevated privileges and must be
approved for the target.

## Staged chat-route schema

Static review of `artifacts/api-server/src/routes/chat.ts` found five chat
tables queried by the staged routes but absent from the original Drizzle
baseline: `chat_conversations`, `chat_messages`, `chat_participants`,
`chat_message_reads`, and `chat_notification_prefs`. These are now represented
in `src/schema/chat.ts` and added by `drizzle/0002_reviewed_chat_schema.sql`.
The columns cover the routes' selected, inserted, updated, joined, and
conflict-target fields; parent-child foreign keys and participant/read/
preference uniqueness requirements are included. `live_chat_sessions` remains
a distinct website live-chat feature and is not treated as the staff
conversation/message model.

The chat migration is schema-only: it creates no conversations, messages,
participants, notification preferences, or read receipts. The table layout is
a reviewed route-contract draft, not proof that all consumers or historical
variants have been audited.

## Application order and dependencies

For a newly provisioned, isolated, blank PostgreSQL database, the proposed
manual file order is:

1. `0000_clean_bootstrap_v1.sql` — staged Drizzle baseline and its referenced
   core tables.
2. `0001_reviewed_missing_tables.sql` — compatibility tables; depends on
   baseline objects such as customers, products, purchase orders, and customer
   employees. Its `quotes` foreign keys are added only after `enquiries` and
   `wc_enquiries` exist.
3. `0002_reviewed_chat_schema.sql` — route-derived chat objects; depends on
   baseline `orders` and `customers`, then creates conversation children in
   dependency order.
4. `0003_reviewed_route_columns.sql` — staged quote/portal-route columns;
   depends on tables from `0000` and `0001`.
5. `0004_reviewed_first_run_route_columns.sql` — common customer/order/portal/
   shop compatibility columns; depends on tables from `0000`.

The UUID prerequisite for `0001` is described above; `0002`, `0003`, and
`0004` need no extension.

## Unresolved gaps

The route-derived chat tables address the previously missing
`chat_messages` parent and `chat_message_reads` dependency. They do not close
the wider application/schema compatibility gap. The reviewed route-specific
additions in `0003` are `orders.portal_submitted_by_employee_id`,
`orders.portal_submitted_at`, `orders.add_to_stores`, `orders.quote_id`,
`order_items.bundle_ref`, `order_items.is_bundle_header`,
`order_items.bundle_def_id`, `products.issue_snoozed_until`, and
`quotes.delivery_address_id`. These address observed portal order submission,
dispatch, bundle order, product issue-snooze, and quote flows. Additional
historical order/product columns still need an occurrence-by-occurrence audit
against staged raw SQL. Existing identifiers such as `sbs_stock_allocated_qty`
are retained as compatibility names and remain subject to application review.
This work does not claim all raw SQL routes are covered.

`0004` adds `customers.default_shipping_option`;
`customer_finished_items.location`, `min_quantity`, and `reorder_quantity`
(and makes `product_id` nullable, as expected by the stock-item route);
`orders.portal_approved_at`; and the shop catalogue fields
`products.regular_price`, `on_sale`, `permalink`, `gallery_images`,
`size_guide_html`, and `guidance_staff_recommendation`. These were found by
read-only inspection of startup migration DDL and common customer/order/portal/
shop route queries. `gallery_images` is also directly selected by shop routes
but is not ensured by startup migrations. Startup-only data repair, seeding,
and unrelated fields were not copied into the reviewed SQL migrations.

The proposed table count is 44 baseline tables + 27 additions in `0001` + 5
chat tables in `0002` = 76 tables across the draft files; `0003` adds columns
only, as does `0004`. This is not a verified full application schema.

The only Drizzle snapshot currently present is the original `0000` baseline
snapshot. The follow-on SQL migrations are reviewed hand-authored migrations,
not generated snapshots for the expanded schema. Future Drizzle generation or
push workflows must reconcile this metadata state before use; those workflows
are not covered by this bootstrap review.

## Verification limits

All five SQL files were applied in order with `ON_ERROR_STOP` to a newly created
database, `route_schema_first_run_verify2_20260922`, on the isolated local
PostgreSQL server at `127.0.0.1:55438`. PostgreSQL accepted the sequence and
reported 76 public tables. A check found all eleven added `0004` columns and
confirmed the stock item `product_id` is nullable. A scan across every public
table confirmed zero retained rows. The check did not insert test or business
rows. PostgreSQL emitted only identifier-truncation notices from two long
foreign-key names in `0000`.

This is a fresh-install SQL execution check, not application/runtime coverage.
It does **not** verify all route SQL, startup-migration compatibility, or
Drizzle generation/push behavior against the hand-authored follow-on migrations.
The staged raw SQL review was targeted, not exhaustive; additional compatibility
columns and route-schema mismatches may remain. Do not declare full route
coverage or full application-schema compatibility based on this check.