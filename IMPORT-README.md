# Source import into an existing Replit project

This ZIP contains the **contents** of `sanitised-transfer-work/` at its root,
not an additional nested working copy. It contains source, package files,
the lockfile, schema-only migrations, scripts, frontend and API code,
source assets, and installation documentation. It does **not** contain
dependencies, compiled bundles, databases, uploaded files, or secrets.

1. In the destination project, create a checkpoint or otherwise protect any
   existing source. Upload the ZIP to its Files panel and extract its contents
   into the project root. Review any file-name conflicts before replacing
   files. Replit's ZIP **import** flow creates a new app, so use file upload
   and extraction for an already-existing project instead.
2. Run `pnpm install --frozen-lockfile` in the destination project. Set up
   four services there for the included packages: the shop at `/`, the staff
   order system at `/order-system/`, the customer portal at
   `/customer-portal/`, and the API at `/api`. Their source packages live
   in `artifacts/`. Each frontend's `BASE_PATH` must match its route;
   services must bind their own `PORT`. Project-specific Replit workflow and
   artifact registrations are **not** carried over from the original
   installation; configure them in the destination project.
3. Provision an entirely **new, empty** PostgreSQL database and separate
   storage for this installation. Apply the six schema-only SQL migrations
   in `lib/db/drizzle/` in numeric order. Add newly generated credentials
   and the new database URL through that project's Secrets, not a `.env`
   file or a copied source project's settings. Follow `TRANSFER-STATUS.md`
   for the required fresh-install guard, first-admin setup and activation.
   Keep all optional integrations and background jobs off until their own
   resources are configured and tested.

Do not restore an old database or storage bucket, reuse an original
installation credential, or assume an absent setting should fall back to
the source application. This archive is not a production deployment.