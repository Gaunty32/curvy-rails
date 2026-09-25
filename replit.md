# Curvy Rails — fresh source import

The uploaded clean-source ZIP is the authoritative application source. This is a separate installation, not the previous demo or the original live installation. Preserve the imported shop, staff order system, customer portal, and API rather than recreating or redesigning them.

## Services

- Shop: `artifacts/shop` at `/`
- Staff order system and first-run setup: `artifacts/order-system` at `/order-system/`
- Customer portal: `artifacts/customer-portal` at `/customer-portal/`
- API: `artifacts/api-server` at `/api`

Use the existing managed artifact workflows. The imported package files and `pnpm-lock.yaml` define dependencies; the lockfile also accounts for this project's separate mockup sandbox.

## Fresh-install safety

- The project's development PostgreSQL database has the six imported schema-only migrations (`lib/db/drizzle/0000`–`0005`) applied in order. Do not use `drizzle push` to replace this migration sequence or copy data from another installation.
- This project's own App Storage was provisioned. Never copy the original database, bucket, uploads, credentials, administrator, URLs, integration settings, or webhooks.
- The API requires `TEMPLATE_FRESH_INSTALL=true` for this remote development database and checks the installation schema before loading the application. Before activation it exposes setup/status routes and locks operational routes.
- First-admin setup additionally requires distinct, newly generated `PORTAL_JWT_SECRET` and `INSTALLATION_BOOTSTRAP_TOKEN`, each at least 32 characters, supplied via Replit Secrets. Do not put these values in source or chat. The administrator enters their own password and business details in the first-run screen.
- Leave optional integrations, background jobs, live payments, email, and external requests disabled until the user explicitly approves and configures resources for this installation. Do not publish without explicit approval.

Read `IMPORT-README.md`, `TRANSFER-STATUS.md`, `ISOLATION-READINESS.md`, and `SECRETS-MANIFEST.md` before changing installation behavior. The source's full API typecheck has known historical errors; the imported packages' production builds were verified separately.