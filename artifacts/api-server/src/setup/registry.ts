export type IntegrationStatus = "NOT_CONFIGURED" | "DISCONNECTED" | "ENABLED" | "CONNECTED" | "ERROR" | "DISABLED";

export type SecretHandle = {
  handle: string;
  purpose: string;
  required: boolean;
  feature: string;
  source: "environment" | "settings";
};

export type IntegrationDefinition = {
  id: string;
  name: string;
  purpose: string;
  secrets: SecretHandle[];
  capabilities: readonly ("read" | "write")[];
  optional: boolean;
};

export const integrationRegistry: readonly IntegrationDefinition[] = [
  { id: "smtp", name: "Email delivery", purpose: "Transactional email", secrets: [
    { handle: "SMTP_HOST", purpose: "SMTP hostname", required: true, feature: "email", source: "environment" },
    { handle: "SMTP_USER", purpose: "SMTP username", required: true, feature: "email", source: "environment" },
    { handle: "SMTP_PASS", purpose: "SMTP password", required: true, feature: "email", source: "environment" },
  ], capabilities: ["write"], optional: true },
  { id: "stripe", name: "Stripe", purpose: "Payment processing", secrets: [
    { handle: "STRIPE_SECRET_KEY", purpose: "Stripe server credential", required: true, feature: "payments", source: "environment" },
  ], capabilities: ["read", "write"], optional: true },
  { id: "woocommerce", name: "WooCommerce", purpose: "Catalogue and order synchronisation", secrets: [
    { handle: "WOOCOMMERCE_URL", purpose: "Store URL", required: true, feature: "commerce", source: "environment" },
    { handle: "WOOCOMMERCE_CONSUMER_KEY", purpose: "Consumer key", required: true, feature: "commerce", source: "environment" },
    { handle: "WOOCOMMERCE_CONSUMER_SECRET", purpose: "Consumer secret", required: true, feature: "commerce", source: "environment" },
  ], capabilities: ["read", "write"], optional: true },
  { id: "dpd", name: "Courier", purpose: "Delivery booking", secrets: [
    { handle: "DPD_USERNAME", purpose: "Courier username", required: true, feature: "delivery", source: "environment" },
    { handle: "DPD_PASSWORD", purpose: "Courier password", required: true, feature: "delivery", source: "environment" },
    { handle: "DPD_ACCOUNT_NUMBER", purpose: "Courier account", required: true, feature: "delivery", source: "environment" },
  ], capabilities: ["write"], optional: true },
  { id: "xero", name: "Xero", purpose: "Accounting synchronisation", secrets: [
    { handle: "xero_client_id", purpose: "OAuth client identifier", required: true, feature: "accounting", source: "settings" },
    { handle: "xero_client_secret", purpose: "OAuth client credential", required: true, feature: "accounting", source: "settings" },
    { handle: "xero_refresh_token", purpose: "OAuth refresh credential", required: true, feature: "accounting", source: "settings" },
  ], capabilities: ["read", "write"], optional: true },
  { id: "highlevel", name: "CRM", purpose: "Contact and campaign synchronisation", secrets: [
    { handle: "HIGHLEVEL_API_TOKEN2", purpose: "CRM API token", required: true, feature: "crm", source: "environment" },
    { handle: "HIGHLEVEL_LOCATION_ID2", purpose: "CRM location", required: true, feature: "crm", source: "environment" },
  ], capabilities: ["read", "write"], optional: true },
  { id: "facebook", name: "Facebook", purpose: "Page publishing", secrets: [
    { handle: "facebook_page_access_token", purpose: "Page access credential", required: true, feature: "social", source: "settings" },
    { handle: "facebook_page_id", purpose: "Page identifier", required: true, feature: "social", source: "settings" },
  ], capabilities: ["write"], optional: true },
  { id: "google_business", name: "Google Business Profile", purpose: "Business profile publishing", secrets: [
    { handle: "gbp_client_id", purpose: "OAuth client identifier", required: true, feature: "social", source: "settings" },
    { handle: "gbp_client_secret", purpose: "OAuth client credential", required: true, feature: "social", source: "settings" },
    { handle: "gbp_refresh_token", purpose: "OAuth refresh credential", required: true, feature: "social", source: "settings" },
    { handle: "gbp_location_name", purpose: "Business location identifier", required: true, feature: "social", source: "settings" },
  ], capabilities: ["write"], optional: true },
  { id: "linkedin", name: "LinkedIn", purpose: "Organisation and professional publishing", secrets: [
    { handle: "linkedin_access_token", purpose: "API access credential", required: true, feature: "social", source: "settings" },
    { handle: "linkedin_person_urn", purpose: "Profile identifier", required: false, feature: "social", source: "settings" },
    { handle: "linkedin_org_urn", purpose: "Organisation identifier", required: false, feature: "social", source: "settings" },
  ], capabilities: ["read", "write"], optional: true },
  { id: "invoco", name: "Call tracking", purpose: "Callback requests", secrets: [
    { handle: "INVOCO_API_KEY", purpose: "Call tracking credential", required: true, feature: "callbacks", source: "environment" },
  ], capabilities: ["write"], optional: true },
  { id: "webhook", name: "Workflow webhooks", purpose: "Send explicitly configured workflow callbacks", secrets: [],
    capabilities: ["write"], optional: true },
];

export type AutomationDefinition = {
  id: string;
  name: string;
  purpose: string;
  dependencies: string[];
  integrationIds: string[];
};

export const automationRegistry: readonly AutomationDefinition[] = [
  { id: "email", name: "Transactional email", purpose: "Send application notifications", dependencies: ["smtp"], integrationIds: ["smtp"] },
  { id: "crm-sync", name: "CRM synchronisation", purpose: "Synchronise contacts and campaigns", dependencies: ["highlevel"], integrationIds: ["highlevel"] },
  { id: "commerce-sync", name: "Commerce synchronisation", purpose: "Synchronise catalogue and orders", dependencies: ["woocommerce"], integrationIds: ["woocommerce"] },
  { id: "courier-booking", name: "Courier booking", purpose: "Create delivery bookings", dependencies: ["dpd"], integrationIds: ["dpd"] },
  { id: "payments", name: "Payment processing", purpose: "Create or confirm payments", dependencies: ["stripe"], integrationIds: ["stripe"] },
];

type IntegrationStatusOptions = {
  activated?: boolean;
  enabled?: Record<string, boolean>;
  configuredSettings?: ReadonlySet<string>;
};

function configured(secret: SecretHandle, configuredSettings: ReadonlySet<string>): boolean {
  return secret.source === "environment"
    ? typeof process.env[secret.handle] === "string" && process.env[secret.handle]!.trim().length > 0
    : configuredSettings.has(secret.handle);
}

export function integrationStatuses(options: IntegrationStatusOptions = {}) {
  const configuredSettings = options.configuredSettings ?? new Set<string>();
  return integrationRegistry.map((integration) => {
    const missing = integration.secrets.filter((secret) => secret.required && !configured(secret, configuredSettings));
    const explicitlyEnabled = options.enabled?.[integration.id] === true;
    const active = options.activated === true && explicitlyEnabled;
    return {
      id: integration.id,
      name: integration.name,
      purpose: integration.purpose,
      optional: integration.optional,
      capabilities: integration.capabilities,
      status: missing.length
        ? "NOT_CONFIGURED" as const
        : active ? "ENABLED" as const : "DISCONNECTED" as const,
      missingHandles: missing.map((secret) => secret.handle),
      secrets: integration.secrets.map(({ handle, purpose, required, feature }) => ({ handle, purpose, required, feature })),
    };
  });
}

export function automationStatuses(enabled: Record<string, boolean> = {}, options: IntegrationStatusOptions = {}) {
  const statuses = integrationStatuses(options);
  return automationRegistry.map((automation) => {
    const dependenciesReady = automation.dependencies.every((id) => statuses.find((item) => item.id === id)?.status === "ENABLED");
    return { ...automation, enabled: enabled[automation.id] === true && dependenciesReady, dependenciesReady };
  });
}