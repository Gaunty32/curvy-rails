# Static identity and contact audit — historical checkpoint

> This is an earlier source-only audit, retained for its file classifications.
> Its claims that the API cannot start, activation is hard-locked, no build or
> database test exists, or another project may be used for testing are **out of
> date**. `TRANSFER-STATUS.md` is the current status and scope. No transfer,
> access to another project, or provider test is authorized by this report.

**Scope:** staged source under `sanitised-transfer-work/`, reviewed without
starting a server, importing application modules, connecting to a database,
calling an external service, or running a build. Separate staged-only passes
also reviewed email, schema, promotion, portal wording and secret handles.

This report deliberately does not reproduce any business email address,
domain, phone number, postal address, account ID, token, webhook, or other
production value. Generic examples are described by purpose only.

## File-by-file findings and actions

### Changed in this pass

| File | Classification | Action |
|---|---|---|
| `artifacts/api-server/src/routes/demo.ts` | D — outbound email / installation identity | Removed the demo route's direct SMTP send path. Demo mail now uses the centrally gated `sendEmail` service and requires installation-owned business email configuration; neutral organization branding is resolved from `business_config`. |
| `src/components/video/video_scenes/Scene1.tsx` | C — staged business content | Replaced the former company mark and name with generic workwear wording. |
| `src/components/video/video_scenes/Scene3.tsx` | C — staged business content | Replaced the former company portal host and order example with a reserved documentation host and generic order number. |
| `src/components/video/video_scenes/Scene6.tsx` | C — staged business content | Replaced the former company mark/name with generic configured-installation wording. |
| `artifacts/customer-portal/src/pages/OrderHistory.tsx` | B — UI status wording | Replaced the former supplier/company abbreviation with a generic supplier status. |
| `artifacts/customer-portal/src/pages/OrderDetail.tsx` | B — UI status wording | Replaced the former supplier/company abbreviation in status and confirmation text. |
| `artifacts/customer-portal/src/pages/Dashboard.tsx` | B — UI status wording | Replaced the former supplier/company abbreviation with a generic supplier status. |
| `artifacts/shop/src/pages/Reviews.tsx` | D — third-party review widget | Removed original Endorsal widget/embed identifiers and inert review-link placeholders. Reviews load only from configured public IDs when explicitly enabled; otherwise a generic empty state is shown. |

### Reviewed and retained as generic or configuration-dependent

| File/group | Classification | Finding |
|---|---|---|
| `artifacts/api-server/src/lib/business-config.ts` | A/B | Central business identity accessor; values are runtime configuration, not literals. |
| `artifacts/*/src/lib/publicConfig.ts` and customer-facing layouts/pages | A/B | Read-only public configuration consumers; no current business values found. |
| `artifacts/customer-portal/src/pages/SelectBusiness.tsx` and its route in `App.tsx` | A — application logic | Multi-business account selection is generic despite the historical filename/route wording. No business name or contact value is embedded. Rename can be considered later if route compatibility is no longer required. |
| Customer portal and shop form pages containing email placeholders (`Login`, `Team`, `ProductDetail`, `ChatWidget`, `ContactUs`, account/invite pages) | B — input guidance | All addresses are non-delivery examples/placeholders. They are not recipients or credentials. |
| Order-system customer, supplier, purchasing, campaign, quote, acknowledgement, invoice, chat, and settings pages | B — input guidance | All addresses are user-entered fields or generic examples. No current recipient was retained. |
| `artifacts/api-server/src/routes/orders.ts`, `portal.ts`, `social-posts.ts` | B — generated/configured messaging | Sender/support values are safe reserved configuration placeholders. They must remain unset or be supplied through installation configuration; they are not production contacts. |
| `artifacts/api-server/src/routes/portal.ts` | A/D | A historical comment and internal route terminology mention business selection. No identity-bearing value remains; the endpoint is application logic. |
| `artifacts/api-server/src/services/highlevel-campaigns.ts`, `dpd.ts`, `xero.ts`, `seo-check.ts`, routes for WooCommerce, reviews, social, Maya and integrations | A — generic third-party integration logic | Provider endpoints and API paths are generic vendor destinations. Credentials, account IDs and destination values must remain absent until a new installation configures them. |
| `artifacts/customer-portal/index.html` | A — third-party widget loader | LeadConnector chat loads only from installation-configured public widget/location IDs returned by the activation- and enable-gated public config endpoint. |
| `artifacts/order-system/src/utils/printWorksheet.ts`, `printDpdLabel.ts`, `ZebraLabels.tsx` | A — local integration logic | Printer keys and the QZ Tray library URL are compatibility/runtime details, not business identity. |
| `artifacts/shop/src/pages/Reviews.tsx` | B/D | Generic review widget code retained; widget and embed IDs are installation configuration and disabled unless explicitly enabled. |
| `artifacts/shop/index.html` and shop marketing pages | B — business content/configuration | Descriptions are generic workwear/uniform service copy. No current business contact, locality, or opening hours remain; legal and marketing copy still needs owner review before activation. |
| `artifacts/api-server/src/setup/*` and `TRANSFER-STATUS.md` | A — safety documentation/setup | Explicitly fail-closed/setup-only. No production identity or secret value added. |
| `lib/api-spec/openapi.yaml`, generated client packages, shared UI libraries | A — application/tooling | URLs are schema/tooling/provider references or local API paths; no business destination found. |

## Remaining prefixed identifiers

The staged source retains compatibility-prefixed identifiers such as
`sbs_*` in local-storage keys, printer keys, metadata keys, integration
fields, and historical comments. These are **namespaced software
identifiers**, not business data, account IDs, domains, or credentials. They
must be classified in the final compatibility review before publishing a
reusable master template; renaming them now could break stored browser state,
WooCommerce metadata compatibility, or existing API contracts.

The API also retains generic provider-specific integration code. It is not
proof that any provider is connected. A separate runtime audit must verify
that every write path reaches the central outbound gate and that all
integration settings start empty/disabled.

## Email, URL, phone, address and account review

- No current business email recipient, phone number, postal address, domain,
  webhook destination, OAuth callback value, storage identifier, account ID,
  access token, or database connection value was intentionally copied into
  this report.
- Remaining email-looking strings outside the excluded email service are
  placeholder input hints, reserved `example.invalid` configuration values,
  or provider/library documentation values.
- Remaining URLs are generic provider endpoints, local development/proxy
  targets, reserved example hosts, documentation links, or user-entered URL
  placeholders. The known current-business review URL was removed.
- No static scan can establish that runtime settings, storage, database rows,
  logs, caches, or generated output are clean; those require the isolated
  Curvy-Rails checks authorised by the owner.

## Unresolved risks and blocked work

1. The API entry point intentionally throws before imports. No runtime or
   scheduler claim was made.
2. A separate pass parameterised the staged email service; direct SMTP
   verification, provider SDKs and caller-initiated writes are still not
   centrally gated.
3. A separate pass drafted 27 additional clean schema-only tables, but the
   chat read table and historical columns remain unresolved.
4. Provider integrations contain possible external write routes. Central
   outbound-gate coverage, scheduler import side effects, and disabled
   integration defaults require isolated runtime tests.
5. No generated build output, database, storage, cache, or logs were included
   or tested here. A post-build remnant scan remains mandatory.
6. The generic video/demo source is now free of the specifically identified
   company name/domain, but video content remains staged-only and should not
   be treated as approved production marketing material.
7. `artifacts/api-server/src/routes/demo.ts` still contains a sizable static
   order fixture set and demo routes that can query installation data. The
   fixture names/contacts and demo route data exposure need a dedicated
   source-only review/removal pass; no claim is made that this fixture content
   is clean. The demo-email bypass was closed in this pass, but other demo
   routes were not changed.

## Subsequent staged-only changes

- Removed the previous installation's hard-coded shop promotion from both
  API and shop UI. Promotions are disabled until an installation configures
  its own policy; checkout must not silently discount an old saved basket.
- Replaced additional staff/customer-facing company abbreviations and
  business-specific email subjects. Kept database and API compatibility
  identifiers rather than renaming them blindly.
- Removed an embedded image from the order-document source and supplied an
  empty logo module; only a new installation may supply a logo.
- A source-only scan currently finds no matches for the known exact company
  names, former shop name, former promotion code or embedded base64 images.
  This does not establish a clean build, database or storage.

**Static result:** known current-business UI/video strings and the known
current review destination were removed or parameterised in this pass. The
working copy remains inert, non-runnable, and not ready for activation,
packaging, or production handoff.

## Optional public widgets

The public config endpoint returns widget IDs only when
`installation_activated=true`, the matching key in `integration_enabled` is
exactly boolean `true`, and every provider-specific public ID setting is
non-empty. It never returns provider credentials. Both browser clients make no
provider script request unless that gated configuration is present.

The administrator-only settings API configures the JSON value of
`integration_enabled` with `leadconnector_chat: true` and/or
`endorsal_reviews: true`; each provider is absent/disabled by default. The
installation-specific public settings handles are
`public_leadconnector_chat_widget_id`,
`public_leadconnector_chat_location_id`,
`public_endorsal_widget_id`, and `public_endorsal_embed_id`. These are public
embed identifiers, not credentials. Configuration is made through the
administrator-only `/api/settings` PATCH endpoint on an authorized full
installation. This staged setup-only shell does not expose that settings
route, and activation remains locked; no database or external service was
accessed for this change.