# Installation boundary

The API imports setup routes first. The historical router and schedulers are
not loaded until activation. Operational routes return 423 before activation.
Remote startup requires an explicit `TEMPLATE_FRESH_INSTALL=true`, a complete
schema and an empty, unmarked database; first-admin creation marks that
database for subsequent restarts. A remote database belonging to another
installation must never be substituted. `TEMPLATE_LOCAL_TEST=true` bypasses
the remote check **only** for a loopback database whose name identifies an
isolated test/template database.

Set distinct `INSTALLATION_BOOTSTRAP_TOKEN` and `PORTAL_JWT_SECRET` values of
at least 32 characters each. Setup JWTs are bound to the current bootstrap
credential. First-admin setup saves an administrator; business setup requires
name, valid email, phone and address. Activation then creates explicit
disabled `integration_enabled` and `automation_enabled` settings and opens
operational routes. Status reports `applicationReady: true` only after
activation. Activation cannot be repeated.

Outbound writers must pass the installation/integration gate immediately
before contacting a provider. Scheduler registration and reconciliation happen
after activation and require individual opt-in; an environment credential
alone does not activate a job. Public widget IDs are returned only after
activation and explicit integration opt-in. Setup/status responses expose
secret **handles and configured booleans**, never values.

See the top-level `TRANSFER-STATUS.md` for isolated verification and the
six-file schema bootstrap order. Do not point this copy at the original
application's database, storage or provider credentials.