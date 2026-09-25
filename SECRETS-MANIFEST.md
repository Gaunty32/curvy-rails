# Installation secret and integration manifest

This manifest contains **handle names only**. It does not contain secret
values, database values, credentials, tokens, URLs, or installation-specific
configuration. Every integration is **DISCONNECTED by default** in a new
installation. Setup status may report whether a handle is present, but handle
presence must not enable an integration or permit an external write.

## Environment secret/configuration handles

The table includes both credentials and non-secret installation configuration.
Endpoint/site URL handles describe destinations, not credentials; treat any URL
that embeds authentication material (including a database connection URL) as
sensitive secret material. Runtime/platform variables are listed separately
below and are not integration credentials.

| Handle | Purpose | Required | Feature dependency | Default |
|---|---|---:|---|---|
| `DATABASE_URL` | Isolated PostgreSQL connection | Yes | database/bootstrap | DISCONNECTED |
| `PORTAL_JWT_SECRET` | Staff and portal session signing | Yes | authentication/setup | DISCONNECTED |
| `SESSION_SECRET` | Session encryption/signing where enabled | Optional | authentication | DISCONNECTED |
| `INSTALLATION_BOOTSTRAP_TOKEN` | One-time first-administrator setup authorization | Yes | secure setup | DISCONNECTED |
| `JWT_SECRET` | Legacy/demo token signing path, permitted only through the activated integration gate | Optional | legacy demo authentication | DISCONNECTED |
| `STAFF_RECOVERY_KEY` | Staff recovery flow | Optional | staff authentication | DISCONNECTED |
| `FEEDBACK_OWNER_EMAIL` | Configured feedback notification recipient | Optional | feedback notifications | DISCONNECTED |
| `SMTP_HOST` | SMTP server hostname | Optional | transactional email | DISCONNECTED |
| `SMTP_PORT` | SMTP server port | Optional | transactional email | DISCONNECTED |
| `SMTP_USER` | SMTP authentication username | Optional | transactional email | DISCONNECTED |
| `SMTP_PASS` | SMTP authentication password | Optional | transactional email | DISCONNECTED |
| `SMTP_SECURE` | SMTP transport security mode | Optional | transactional email | DISCONNECTED |
| `RESEND_API_KEY` | Resend email provider credential | Optional | transactional email | DISCONNECTED |
| `STRIPE_SECRET_KEY` | Stripe server credential | Optional | payments | DISCONNECTED |
| `STRIPE_PUBLISHABLE_KEY` | Stripe browser publishable key | Optional | payments | DISCONNECTED |
| `WOOCOMMERCE_URL` | WooCommerce store endpoint | Optional | commerce synchronisation | DISCONNECTED |
| `WOOCOMMERCE_CONSUMER_KEY` | WooCommerce consumer credential | Optional | commerce synchronisation | DISCONNECTED |
| `WOOCOMMERCE_CONSUMER_SECRET` | WooCommerce consumer credential | Optional | commerce synchronisation | DISCONNECTED |
| `DPD_USERNAME` | DPD account username | Optional | courier booking | DISCONNECTED |
| `DPD_PASSWORD` | DPD account password | Optional | courier booking | DISCONNECTED |
| `DPD_ACCOUNT_NUMBER` | DPD account identifier | Optional | courier booking | DISCONNECTED |
| `DPD_NETWORK_CODE` | DPD network configuration | Optional | courier booking | DISCONNECTED |
| `DPD_SENDER_LINE1` | Configured sender address component | Optional | courier booking | DISCONNECTED |
| `DPD_SENDER_NAME` | Configured sender name | Optional | courier booking | DISCONNECTED |
| `DPD_SENDER_POSTCODE` | Configured sender postcode | Optional | courier booking | DISCONNECTED |
| `DPD_SENDER_TOWN` | Configured sender town | Optional | courier booking | DISCONNECTED |
| `HIGHLEVEL_API_TOKEN2` | HighLevel API credential | Optional | CRM synchronisation | DISCONNECTED |
| `HIGHLEVEL_LOCATION_ID2` | HighLevel installation/location identifier | Optional | CRM synchronisation | DISCONNECTED |
| `HIGHLEVEL_CALLBACK_WORKFLOW_ID2` | HighLevel callback workflow identifier | Optional | CRM callbacks | DISCONNECTED |
| `HIGHLEVEL_CALLBACK_ASSIGNED_USER_ID2` | HighLevel callback assignee identifier | Optional | CRM callbacks | DISCONNECTED |
| `HIGHLEVEL_ATTRIBUTION_PAGE_URL_CUSTOM_FIELD_ID` | HighLevel custom-field mapping identifier for callback page URL attribution | Optional | CRM callback attribution | DISCONNECTED |
| `HIGHLEVEL_ATTRIBUTION_PAGE_TITLE_CUSTOM_FIELD_ID` | HighLevel custom-field mapping identifier for callback page-title attribution | Optional | CRM callback attribution | DISCONNECTED |
| `HIGHLEVEL_ATTRIBUTION_REFERRER_CUSTOM_FIELD_ID` | HighLevel custom-field mapping identifier for callback referrer attribution | Optional | CRM callback attribution | DISCONNECTED |
| `HIGHLEVEL_ATTRIBUTION_UTM_SOURCE_CUSTOM_FIELD_ID` | HighLevel custom-field mapping identifier for callback UTM source attribution | Optional | CRM callback attribution | DISCONNECTED |
| `HIGHLEVEL_ATTRIBUTION_UTM_MEDIUM_CUSTOM_FIELD_ID` | HighLevel custom-field mapping identifier for callback UTM medium attribution | Optional | CRM callback attribution | DISCONNECTED |
| `HIGHLEVEL_ATTRIBUTION_UTM_CAMPAIGN_CUSTOM_FIELD_ID` | HighLevel custom-field mapping identifier for callback UTM campaign attribution | Optional | CRM callback attribution | DISCONNECTED |
| `HIGHLEVEL_ATTRIBUTION_UTM_CONTENT_CUSTOM_FIELD_ID` | HighLevel custom-field mapping identifier for callback UTM content attribution | Optional | CRM callback attribution | DISCONNECTED |
| `HIGHLEVEL_ATTRIBUTION_UTM_TERM_CUSTOM_FIELD_ID` | HighLevel custom-field mapping identifier for callback UTM term attribution | Optional | CRM callback attribution | DISCONNECTED |
| `HIGHLEVEL_ATTRIBUTION_GCLID_CUSTOM_FIELD_ID` | HighLevel custom-field mapping identifier for callback Google click attribution | Optional | CRM callback attribution | DISCONNECTED |
| `HIGHLEVEL_ATTRIBUTION_FBCLID_CUSTOM_FIELD_ID` | HighLevel custom-field mapping identifier for callback Facebook click attribution | Optional | CRM callback attribution | DISCONNECTED |
| `HIGHLEVEL_ATTRIBUTION_CALLBACK_REQUEST_ID_CUSTOM_FIELD_ID` | HighLevel custom-field mapping identifier for callback request attribution | Optional | CRM callback attribution | DISCONNECTED |
| `HIGHLEVEL_ATTRIBUTION_CALLBACK_TYPE_CUSTOM_FIELD_ID` | HighLevel custom-field mapping identifier for callback type attribution | Optional | CRM callback attribution | DISCONNECTED |
| `HIGHLEVEL_ATTRIBUTION_BUSINESS_OPEN_CUSTOM_FIELD_ID` | HighLevel custom-field mapping identifier for business-open callback attribution | Optional | CRM callback attribution | DISCONNECTED |
| `MAYA_API_KEY` | AI assistant credential | Optional | AI workflows | DISCONNECTED |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | OpenAI-compatible AI credential | Optional | AI/audio workflows | DISCONNECTED |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | OpenAI-compatible service endpoint | Optional | AI/audio workflows | DISCONNECTED |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | Anthropic AI credential | Optional | AI workflows | DISCONNECTED |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | Anthropic-compatible service endpoint | Optional | AI workflows | DISCONNECTED |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | New installation App Storage bucket identifier | Optional | object storage | DISCONNECTED |
| `GOOGLE_SEARCH_CONSOLE_CLIENT_ID` | Search Console OAuth client identifier | Optional | SEO/Search Console | DISCONNECTED |
| `GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET` | Search Console OAuth client credential | Optional | SEO/Search Console | DISCONNECTED |
| `GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN` | Search Console OAuth refresh credential | Optional | SEO/Search Console | DISCONNECTED |
| `GOOGLE_SEARCH_CONSOLE_SITE_URL` | Installation Search Console site | Optional | SEO/Search Console | DISCONNECTED |
| `PUBLIC_WEBSITE_URL` | Installation public website URL | Optional | links, callbacks, campaign content | DISCONNECTED |
| `WORDPRESS_BASE_URL` | WooCommerce/WordPress endpoint | Optional | legacy commerce synchronisation | DISCONNECTED |
| `KNOWLEDGE_RSS_URL` | Configured knowledge feed endpoint | Optional | knowledge content | DISCONNECTED |
| `MAYA_WRITE_API_ENABLED` | AI write capability feature flag | Optional | AI/SEO writes | DISCONNECTED |
| `SELECT_INTELLIGENCE_SEO_API_SECRET` | Authorization credential for the SEO management API | Optional | SEO management API | DISCONNECTED |
| `SBS_SEO_APPROVAL_SECRET` | Approval credential for SEO management writes | Optional | SEO management writes | DISCONNECTED |
| `IP_HASH_SECRET` | Secret key for hashing callback IP identifiers | Optional | callback privacy/rate limiting | DISCONNECTED |
| `VITE_PUBLIC_IMAGE_HOST` | Public image-host URL used by the shop image proxy | Optional | shop image delivery | DISCONNECTED |

The following are runtime/platform configuration rather than secrets. They
must still be supplied per installation and must not contain source-project
values: `PORT`, `NODE_ENV`, `ALLOWED_ORIGINS`, `TRUST_PROXY`, `APP_VERSION`,
`LOG_LEVEL`, `REPL_IDENTITY`, `REPLIT_CONNECTORS_HOSTNAME`,
`REPLIT_DEPLOYMENT`, `REPLIT_DEV_DOMAIN`, `REPLIT_DOMAINS`, `PUBLIC_OBJECT_SEARCH_PATHS`,
`PRIVATE_OBJECT_DIR`, `CALLBACK_IP_LIMIT`, `CALLBACK_PHONE_LIMIT`, and
`BASE_PATH`, `REPL_ID`, and `WEB_REPL_RENEWAL`. `BASE_URL` is Vite-provided
build/base-path configuration (not a credential or independently supplied
secret).

## Legacy database-stored integration settings

Historical routes still read some integration configuration from the generic
`settings` table. These are **not approved defaults** and must begin absent in
a clean database:

| Stored key | Purpose | Required | Feature dependency | Default |
|---|---|---:|---|---|
| `smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass` | Installation SMTP configuration | Optional | transactional email | DISCONNECTED |
| `smtp_from_email`, `smtp_from_name` | Installation sender identity | Optional | transactional email | DISCONNECTED |
| `woo_url`, `woo_consumer_key`, `woo_consumer_secret` | WooCommerce credentials and endpoint | Optional | commerce synchronisation | DISCONNECTED |
| `high_level_webhook_url`, `local_delivery_ghl_webhook_url` | CRM/webhook destinations | Optional | CRM/callbacks | DISCONNECTED |
| `xero_client_id`, `xero_client_secret`, `xero_refresh_token`, `xero_access_token` | Xero OAuth client and token credentials | Optional | accounting synchronisation | DISCONNECTED |
| `facebook_page_access_token`, `facebook_page_id`, `facebook_app_secret` | Facebook Page credential, identifier, and app credential | Optional | social publishing | DISCONNECTED |
| `gbp_client_id`, `gbp_client_secret`, `gbp_refresh_token`, `gbp_access_token`, `gbp_location_name` | Google Business Profile OAuth credentials and location | Optional | social publishing | DISCONNECTED |
| `linkedin_access_token`, `linkedin_refresh_token`, `linkedin_person_urn`, `linkedin_org_urn` | LinkedIn API credentials and publishing identity | Optional | social publishing | DISCONNECTED |
| `enquiry_notification_email`, `weekly_campaign_prompt_email` | Installation notification recipients | Optional | staff notifications/campaign prompts | DISCONNECTED |
| `rss_knowledge_centre_url` | Knowledge feed endpoint | Optional | knowledge content | DISCONNECTED |
| `maya_write_access_enabled` | AI write capability flag | Optional | AI/SEO writes | DISCONNECTED |
| `checkin_email_enabled` | Check-in email automation flag | Optional | transactional email | DISCONNECTED |
| `woo_sync_schedule` | Commerce sync schedule | Optional | commerce automation | DISCONNECTED |
| `public_leadconnector_chat_widget_id`, `public_leadconnector_chat_location_id` | Installation-owned public chat embed identifiers (not credentials) | Optional | LeadConnector chat widget | DISCONNECTED |
| `public_endorsal_widget_id`, `public_endorsal_embed_id` | Installation-owned public review embed identifiers (not credentials) | Optional | Endorsal review widget | DISCONNECTED |

The following stored keys are installation state, not credentials, and must
also be absent from a blank database: `installation_activated`,
`automation_enabled`, `business_config`, `staff_accounts`,
`staff_password_hash`, `tv_display_token`, `gbp_locations_cache`, and
`size_order`.

Optional browser widgets use per-provider booleans in the existing
`integration_enabled` JSON setting: `leadconnector_chat` and
`endorsal_reviews`. Both are disabled unless explicitly set to boolean `true`.
Their scripts are requested only after activation and only when all relevant
public embed IDs are configured. Administrators configure these settings and
the four public ID handles through the administrator-only `/api/settings`
PATCH endpoint on an authorized full server; IDs are public embed configuration
and must never be used for credentials.

## Audit gaps (not claims of coverage)

1. The staged API entry point intentionally throws before importing services.
   No runtime check has established that every external write uses a central
   gate.
2. The setup registry covers the outbound-gate provider IDs and their primary
   credential handles, but is not an exhaustive inventory of handles above,
   including Resend, Search Console, callback/webhook destinations,
   OpenAI-compatible integrations, and several DPD/HighLevel settings.
3. Legacy database-stored credentials and destinations are discovered by
   source inspection only. No database was accessed or provisioned; a clean
   installation must prove these keys are absent.
4. No environment values were read, configured, tested, or copied. No
   integration is approved for connection to an existing system.
5. Scheduler import side effects and direct SDK/fetch calls remain blocked
   work for the isolated test installation.
