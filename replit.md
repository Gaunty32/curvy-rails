# Curvy Rails

Curvy Rails is a demo-first British clothing shop and community where real product experiences help people shop with confidence.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/curvy-rails` — customer-facing web prototype and visual theme.
- `artifacts/api-server/src/routes/curvy-rails` — read-only fictional demo data.
- `lib/api-spec/openapi.yaml` — source of truth for demo API contracts.
- `docs/curvy-rails-architecture.md` — proposed persistent data model and safety boundaries (not a migration).

## Architecture decisions

- First build is a reviewable demo: no live customer accounts, payments, database writes, uploads or outbound communications.
- Curvy Rails routes are grouped under `/api/curvy-rails`; keep other API and canvas functionality intact.
- Account, admin, reward and commerce previews use fictional data; later server-side ownership and ledger rules are described in `docs/curvy-rails-architecture.md`.

## Product

- Homepage, demo catalogue, product detail with community experiences and questions, community page, sample My Rail, demo bag and admin preview.

## User preferences

- Keep the supplied Curvy Rails logo. Build a warm, independent, community-led UK experience without stereotypical plus-size branding.
- Do not publish or connect Stripe, email, HighLevel, Whatnot or real customer data until explicitly approved.

## Gotchas

- Demo API content is fictional and read-only. It does not establish real verified ownership, consent, account access or moderator powers.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
