# Sanitised installation working copy

This directory is the **separate sanitised source copy**, not the original
application. No files, database, object storage, credentials, customer records,
or integration state from the original installation are included. A source-only
archive of this copy is authorised for import into the separate Curvy-Rails
project. **Never point the new installation at the original application's
database, storage, secrets or integrations.** See `IMPORT-README.md` for the
source import handoff; this is not authorisation to publish it.

## What is implemented

- Schema-only migrations `lib/db/drizzle/0000` through `0005` create 77 public
  tables without business rows, seed accounts, credentials, or integration
  configuration. `0005` holds immutable, server-priced checkout intent snapshots.
- The staged API refuses a remote database unless
  `TEMPLATE_FRESH_INSTALL=true` is explicitly set. It checks the expected
  schema and requires an empty, unmarked database on first start. First-admin
  creation marks the new instance; a marked instance may restart. The special
  `TEMPLATE_LOCAL_TEST=true` mode only accepts a named loopback test database.
- Before activation, operational routes return 423. First-run setup creates
  an administrator using a separate bootstrap credential, records business
  name/contact/address, and activates only after the required setup is valid.
  Activation writes explicit **disabled** integration and automation settings.
  Secret presence alone cannot enable outbound operations or background jobs.
- The shop, customer portal, staff application, storage, outbound writers,
  widgets, and scheduled tasks retain their architecture but use installation
  configuration and role/ownership checks. Public checkout recalculates
  authoritative prices before payment and saves the validated basket and
  shipping terms for idempotent paid-order finalization. Collection and local
  delivery require explicit installation settings; old locations and public
  widget identifiers are not defaults.

## Isolated verification performed

- Applied all six migrations to a newly created disposable PostgreSQL database
  on `127.0.0.1:55438`: 77 tables and **zero settings or business rows** before
  setup. A separate local test database was used for earlier route checks.
- Started only a manually launched staged API against the disposable database
  with an environment cleared of project credentials. Verified setup-only 423,
  first administrator, business configuration, activation, disabled
  integrations/jobs, staff sign-in, and post-activation 401 for anonymous staff
  access. Created only synthetic local customer/order/portal records. A member
  could read their own linked order but received 404 for another member's
  order and PO edit; a portal token was denied staff access.
- Four disposable-database guard tests covered blank schema acceptance,
  unmarked populated rejection, marked restart, and incomplete schema
  rejection. Twenty-three focused pricing, shipping, portal-visibility and
  configured-identity tests passed. A further route-level checkout test used
  another disposable database, mocked Stripe and blocked all external fetches:
  it rejected underpayment and unavailable delivery before creating an intent,
  then recorded exactly one paid order from the saved price after a catalogue
  change and reused it on retry. The staged API, shop, staff app and customer
  portal production bundles have built successfully. The shared libraries
  typecheck.
- No real payment, email, courier, CRM, storage bucket, remote database or
  third-party API was contacted for verification. Provider-specific flows
  remain disabled until a future installation supplies its *own* resources
  and opts in. The full API typecheck still reports approximately 230 errors
  in historical routes; the production bundle and focused changed-flow tests
  pass. Real provider credentials and end-to-end external integrations were
  intentionally not exercised.

## Fresh installation procedure

1. Provision a **new, empty, independent** PostgreSQL database and storage
   resources. Do not copy any old database, bucket, settings, files, logs or
   credentials. Apply `lib/db/drizzle/0000` through `0005` in filename order.
2. Supply that database's `DATABASE_URL`, a new `PORTAL_JWT_SECRET`, and a
   distinct new `INSTALLATION_BOOTSTRAP_TOKEN` of at least 32 characters.
   Set `TEMPLATE_FRESH_INSTALL=true` only after checking the database is the
   new instance. For isolated loopback tests, use `TEMPLATE_LOCAL_TEST=true`
   with a database name containing `test` or `template` instead.
3. Start the API and applications for that installation. Complete the staff
   first-run screen with the bootstrap credential, create the administrator,
   enter the installation's business details, then activate. Do not enable
   integrations, scheduled jobs, public widgets, or location-dependent shipping
   until their new installation-specific settings and resources are configured.

The disposable local databases and test credentials used above are **not**
part of this source copy. This is a tested local fresh-install path, **not**
a production deployment or a claim that every historical provider route has
been exercised. See
`lib/db/BOOTSTRAP-STATUS.md` and `SECRETS-MANIFEST.md` for schema and handle
details.