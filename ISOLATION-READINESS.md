# Historical isolation-readiness checkpoint — superseded

> This source-only checkpoint predates the isolated PostgreSQL tests, startup
> guard, first-run activation and outbound gates. Its blocked-state and
> proposed-transfer statements no longer describe the working copy and do not
> authorize work in another project. Read `TRANSFER-STATUS.md` instead.

This is a source-only checkpoint, **not** the final 20-point isolation report,
an activation recommendation, or permission to package or deploy. The API
entry point still throws before importing the historical server. No transfer
to Curvy-Rails has occurred.

## Static sanitisation and proposed transfer scope

- The working directory contains 518 files at this checkpoint. All staged
  paths were included in source-only searches; this is **not** a claim of
  individual human review of every line. 44 previously staged files changed
  in this pass; one business-specific promotion module was removed. The
  working copy was created from an allowlist rather than by archiving the
  live project. The original tracked application was unchanged.
- Known exact company names, former shop name, business-specific promotion
  code, and embedded base64 image yield zero matches in the staged non-report
  source. Empty module contracts stand in for excluded logo assets; no
  installation logo is shipped. Original-business promotional logic is
  disabled rather than transferred.
- Earlier copying excluded attachments, public media/uploads, customer
  artwork, logs, historical scripts, exports, generated output, caches,
  `.git`, `.replit`, and environment files. The staged copy currently has
  zero image/PDF/archive files and no `node_modules` or built `dist` directory.
  Its migration files contain schema statements, not data seeds.
- A file-group identity/email/URL classification is in `STATIC-AUDIT.md`.
  19 source files still have email-shaped text and 50 have URLs, including
  examples and generic provider endpoints. A more exhaustive per-occurrence
  review, known-identifier inventory and post-build scan are still required;
  zero matches for a shortlist is **not** a clean-transfer certificate.
- Historical `sbs_*` and `select_extra_*` names remain in schema, API
  contracts, browser keys, and feature routes for compatibility. These
  names do not themselves contain a credential or destination but still need
  explicit classification before a reusable master is approved. Currency,
  tax, locale, shipping policy, marketing content and brand colours also
  need per-installation configuration or approval.
- `SECRETS-MANIFEST.md` lists secret **handle names only**, their purposes,
  dependencies, and disconnected defaults. No existing secret value was
  read or copied. The draft integration registry does not yet cover every
  provider, and handle presence must never mean an integration is enabled.

**Allowed future transfer:** inert source only, for completing the work and
testing within Curvy-Rails. **Deliberately excluded:** this project's database,
App Storage, settings, staff/customer/order rows, credentials, OAuth/session
tokens, assets, uploads, logs, webhooks, caches and build output. A project
URL alone does not give this workspace file-system access to Curvy-Rails.
No intermediate or reusable archive has been created.

## Database, storage, setup and first administrator

- `0000_clean_bootstrap_v1.sql` defines 44 schema-only tables;
  `0001_reviewed_missing_tables.sql` drafts 27 additional tables; and
  `0002_reviewed_chat_schema.sql` adds five route-derived chat tables, for 76
  proposed objects total. None has been applied. Static route review informed
  the chat conversation/message/read/participant/notification-preference
  definitions, but historical compatibility columns (including the known
  `orders.quote_id` gap) and complete raw SQL coverage remain unresolved.
  `0001`'s `gen_random_uuid()` requires PostgreSQL 13+ or `pgcrypto` enabled
  beforehand on an older server. The documented order is 0000, 0001, 0002.
  See `lib/db/BOOTSTRAP-STATUS.md`; 76 is **not** a verified application schema.
- No separate database or bucket has been created; no query or object-listing
  has been run. Consequently there is no evidence yet of zero customers,
  orders, staff, settings or original storage contents in a new installation.
- The setup-only server shell and `/api/public-config`, status, first-admin
  and business-configuration handlers are drafts. First-admin creation
  requires a new `INSTALLATION_BOOTSTRAP_TOKEN` and a new JWT signing secret,
  but it has not been integration-tested against a fresh database. The
  installation-state progression and complete setup wizard are unfinished.
  Activation is hard-locked. Curvy-Rails business identity has **not** been
  inserted into source or setup data.

## Integration, automation, scheduler and outbound safety

- The descriptive registry names some providers and five automation groups,
  but does not enforce capabilities. All integrations must stay unconfigured
  or disabled in the test installation. No test/sandbox connection has been
  requested or made.
- Scheduler cron and startup-timer registration now has no import-time
  activation and is explicitly opt-in: it refuses absent/false enablement,
  setup mode, or an inactive installation, and exposes a stop operation.
  This is only a registration boundary, not a complete job capability gate.
  Exported scheduler job functions can still be invoked directly, and
  `initScheduler`/`reschedule` only rely on the in-process registration flag.
  There is not yet an authorized caller, durable installation-state binding,
  or per-job integration capability check.
- The draft Express outbound guard covers HTTP mutation methods, not direct
  SDK calls, email transport, remote reads that use POST, direct service/job
  invocations, or every background side effect. Several routes/services use
  Stripe, DPD, WooCommerce, HighLevel, Xero, social APIs, webhooks and other
  outbound SDK/fetch calls that remain ungated by this scheduler change.
  The original router is intentionally **not** imported by the staged shell.
- No scheduler-safety, first-run, no-external-write, first-admin, empty-storage
  or integration test has run. Do not unlock the API entry point, import the
  historical router, or mark the installation ACTIVE until direct job calls,
  all remaining outbound side-effect paths, and the explicit scheduler opt-in
  are covered by isolated tests and installation-state/capability enforcement.

## Outstanding final-report evidence

The user-requested 20-point report remains pending. It will require:
independent Curvy-Rails database and empty-bucket evidence; migration and
route/schema tests; setup/first-admin tests; complete registry and scheduler
coverage; outbound denial tests; remnant scans of source, database, storage,
generated output, configuration, logs and cache; an external-route inventory;
and a clear unresolved-risk/readiness decision. Current result: **NOT READY
to run, activate, deploy, or package**.