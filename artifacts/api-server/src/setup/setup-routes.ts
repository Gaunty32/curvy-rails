import { Router, type Request } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { db, settingsTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { automationStatuses, integrationRegistry, integrationStatuses } from "./registry.js";

const router = Router();
const JWT_SECRET = process.env.PORTAL_JWT_SECRET;
const BOOTSTRAP_SECRET_HANDLE = "INSTALLATION_BOOTSTRAP_TOKEN";

function requireJwtSecret(): string {
  if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error("PORTAL_JWT_SECRET must be configured with at least 32 characters.");
  return JWT_SECRET;
}

async function setting(key: string): Promise<string | null> {
  const [row] = await db.select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}

async function activated(): Promise<boolean> {
  return (await setting("installation_activated")) === "true";
}

async function integrationStatusOptions(isActivated: boolean) {
  const settingsHandles = integrationRegistry.flatMap((integration) =>
    integration.secrets.filter((secret) => secret.source === "settings").map((secret) => secret.handle));
  const storedCredentials = settingsHandles.length
    ? await db.select({ key: settingsTable.key, value: settingsTable.value })
      .from(settingsTable).where(inArray(settingsTable.key, settingsHandles))
    : [];
  const configuredSettings = new Set(storedCredentials
    .filter(({ value }) => typeof value === "string" && value.trim().length > 0)
    .map(({ key }) => key));
  let enabled: Record<string, boolean> = {};
  try {
    const raw = await setting("integration_enabled");
    const parsed: unknown = JSON.parse(raw ?? "null");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      enabled = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, true] => entry[1] === true));
    }
  } catch {
    // Malformed capability state is treated as no integrations enabled.
  }
  return { activated: isActivated, enabled, configuredSettings };
}

function validWhatsAppNumber(value: unknown): value is string {
  return typeof value === "string" && /^\+[1-9]\d{7,14}$/.test(value.trim());
}

function publicBusinessConfig(raw: string | null, isActivated: boolean) {
  if (!isActivated || !raw) return { name: null, tradingName: null, website: null, email: null, phone: null, whatsapp: null, address: null, logoUrl: null, setupMode: true };
  try {
    const config = JSON.parse(raw) as Record<string, unknown>;
    return {
      name: typeof config.name === "string" ? config.name : null,
      tradingName: typeof config.tradingName === "string" ? config.tradingName : null,
      website: typeof config.website === "string" ? config.website : null,
      email: typeof config.email === "string" ? config.email : null,
      phone: typeof config.phone === "string" ? config.phone : null,
      whatsapp: validWhatsAppNumber(config.whatsapp) ? config.whatsapp.trim() : null,
      address: typeof config.address === "string" ? config.address : null,
      logoUrl: typeof config.logoUrl === "string" ? config.logoUrl : null,
      setupMode: false,
    };
  } catch { return { name: null, tradingName: null, website: null, email: null, phone: null, whatsapp: null, address: null, logoUrl: null, setupMode: true }; }
}

const publicWidgetSettingHandles = {
  leadConnectorChat: {
    enabledKey: "leadconnector_chat",
    widgetId: "public_leadconnector_chat_widget_id",
    locationId: "public_leadconnector_chat_location_id",
  },
  endorsalReviews: {
    enabledKey: "endorsal_reviews",
    widgetId: "public_endorsal_widget_id",
    embedId: "public_endorsal_embed_id",
  },
} as const;

async function publicWidgets(isActivated: boolean) {
  if (!isActivated) return { leadConnectorChat: null, endorsalReviews: null };
  const [rawEnabled, chatWidgetIdValue, chatLocationIdValue, endorsalWidgetIdValue, endorsalEmbedIdValue] = await Promise.all([
    setting("integration_enabled"),
    setting(publicWidgetSettingHandles.leadConnectorChat.widgetId),
    setting(publicWidgetSettingHandles.leadConnectorChat.locationId),
    setting(publicWidgetSettingHandles.endorsalReviews.widgetId),
    setting(publicWidgetSettingHandles.endorsalReviews.embedId),
  ]);
  let enabled: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(rawEnabled ?? "null");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) enabled = parsed as Record<string, unknown>;
  } catch {
    // Invalid integration state is fail-closed.
  }
  const publicHandle = (value: string | null): string | null => {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };
  const leadConnector = publicWidgetSettingHandles.leadConnectorChat;
  const endorsal = publicWidgetSettingHandles.endorsalReviews;
  const chatWidgetId = publicHandle(chatWidgetIdValue);
  const chatLocationId = publicHandle(chatLocationIdValue);
  const endorsalWidgetId = publicHandle(endorsalWidgetIdValue);
  const endorsalEmbedId = publicHandle(endorsalEmbedIdValue);
  return {
    leadConnectorChat: enabled[leadConnector.enabledKey] === true && chatWidgetId && chatLocationId
      ? { widgetId: chatWidgetId, locationId: chatLocationId } : null,
    endorsalReviews: enabled[endorsal.enabledKey] === true && endorsalWidgetId && endorsalEmbedId
      ? { widgetId: endorsalWidgetId, embedId: endorsalEmbedId } : null,
  };
}

function validEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

function setupAdministrator(request: Request): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  try {
    const payload = jwt.verify(header.slice(7), requireJwtSecret()) as { role?: string; setup?: boolean; email?: string; bootstrapFingerprint?: string };
    const bootstrapSecret = process.env[BOOTSTRAP_SECRET_HANDLE];
    if (!bootstrapSecret || bootstrapSecret.length < 32) return false;
    const currentFingerprint = crypto.createHash("sha256").update(bootstrapSecret).digest("hex");
    return payload.role === "staff"
      && payload.setup === true
      && Boolean(payload.email)
      && payload.bootstrapFingerprint === currentFingerprint;
  } catch { return false; }
}

function completeBusinessConfig(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const config = JSON.parse(raw) as Record<string, unknown>;
    return typeof config.name === "string" && config.name.trim().length > 0
      && validEmail(config.email)
      && typeof config.phone === "string" && config.phone.trim().length > 0
      && typeof config.address === "string" && config.address.trim().length > 0;
  } catch {
    return false;
  }
}

function requiredSetupCredentialsReady(): boolean {
  const bootstrapSecret = process.env[BOOTSTRAP_SECRET_HANDLE];
  return Boolean(
    JWT_SECRET && JWT_SECRET.length >= 32
      && bootstrapSecret
      && bootstrapSecret.length >= 32
      && bootstrapSecret !== JWT_SECRET,
  );
}

router.get("/public-config", async (_request, response) => {
  response.setHeader("Cache-Control", "no-store");
  const isActivated = await activated();
  response.json({
    ...publicBusinessConfig(await setting("business_config"), isActivated),
    widgets: await publicWidgets(isActivated),
  });
});

router.get("/setup/status", async (_request, response) => {
  const isActivated = await activated();
  const hasAdmin = Boolean(await setting("first_admin_password_hash"));
  const integrationOptions = await integrationStatusOptions(isActivated);
  response.json({
    setupMode: !isActivated,
    activated: isActivated,
    applicationReady: isActivated,
    administratorConfigured: hasAdmin,
    integrations: integrationStatuses(integrationOptions),
    automations: automationStatuses({}, integrationOptions),
    requiredSecrets: [
      { handle: "DATABASE_URL", configured: Boolean(process.env.DATABASE_URL) },
      { handle: "PORTAL_JWT_SECRET", configured: Boolean(JWT_SECRET && JWT_SECRET.length >= 32 && JWT_SECRET !== process.env[BOOTSTRAP_SECRET_HANDLE]) },
      { handle: BOOTSTRAP_SECRET_HANDLE, configured: Boolean(process.env[BOOTSTRAP_SECRET_HANDLE] && process.env[BOOTSTRAP_SECRET_HANDLE]!.length >= 32 && process.env[BOOTSTRAP_SECRET_HANDLE] !== JWT_SECRET) },
    ],
  });
});

router.post("/setup/admin", async (request, response) => {
  if (await activated()) { response.status(409).json({ error: "Installation is already activated." }); return; }
  const expectedBootstrapSecret = process.env[BOOTSTRAP_SECRET_HANDLE];
  const suppliedBootstrapSecret = request.header("X-Setup-Bootstrap-Token");
  if (!expectedBootstrapSecret || expectedBootstrapSecret.length < 32) {
    response.status(503).json({ error: `${BOOTSTRAP_SECRET_HANDLE} must be configured before administrator setup.` }); return;
  }
  if (!suppliedBootstrapSecret) {
    response.status(403).json({ error: "Invalid setup authorization." }); return;
  }
  const expectedDigest = crypto.createHash("sha256").update(expectedBootstrapSecret).digest();
  const suppliedDigest = crypto.createHash("sha256").update(suppliedBootstrapSecret).digest();
  if (!crypto.timingSafeEqual(expectedDigest, suppliedDigest)) {
    response.status(403).json({ error: "Invalid setup authorization." }); return;
  }
  const body = request.body as { name?: unknown; email?: unknown; password?: unknown };
  if (typeof body.name !== "string" || !body.name.trim() || !validEmail(body.email) || typeof body.password !== "string" || body.password.length < 12) {
    response.status(400).json({ error: "Name, valid email, and a password of at least 12 characters are required." }); return;
  }
  let secret: string;
  try {
    secret = requireJwtSecret();
  } catch (error) {
    response.status(503).json({ error: error instanceof Error ? error.message : "Setup signing credential is unavailable." });
    return;
  }
  if (secret === expectedBootstrapSecret) {
    response.status(503).json({ error: "PORTAL_JWT_SECRET and INSTALLATION_BOOTSTRAP_TOKEN must be distinct credentials." });
    return;
  }
  const passwordHash = await bcrypt.hash(body.password, 12);
  let account = { name: body.name.trim(), email: body.email.trim().toLowerCase(), is_superuser: true, allowed_nav: null as string[] | null };
  let resumeDenied = false;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('sanitised-transfer-first-admin'))`);
    const existing = await tx.select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, "first_admin_password_hash"));
    if (existing.length) {
      const [firstAdminEmail] = await tx.select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, "first_admin_email"));
      const [staffAccounts] = await tx.select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, "staff_accounts"));
      let accounts: unknown = [];
      try { accounts = JSON.parse(staffAccounts?.value ?? "[]"); } catch { accounts = []; }
      const existingAccount = Array.isArray(accounts)
        ? accounts.find((candidate): candidate is typeof account => Boolean(candidate && typeof candidate === "object"
          && "email" in candidate && typeof candidate.email === "string"
          && candidate.email.trim().toLowerCase() === account.email
          && "is_superuser" in candidate && candidate.is_superuser === true
          && candidate.name && typeof candidate.name === "string"))
        : undefined;
      const storedAdminHash = existing[0]?.value;
      const validResume = typeof storedAdminHash === "string"
        && firstAdminEmail?.value?.trim().toLowerCase() === account.email
        && Boolean(existingAccount)
        && await bcrypt.compare(body.password as string, storedAdminHash);
      if (validResume && existingAccount) account = existingAccount;
      else resumeDenied = true;
      return;
    }
    await tx.insert(settingsTable).values({ key: "first_admin_password_hash", value: passwordHash });
    await tx.insert(settingsTable).values({ key: "first_admin_email", value: account.email });
    await tx.insert(settingsTable).values({ key: "staff_accounts", value: JSON.stringify([account]) });
    if (process.env.TEMPLATE_FRESH_INSTALL === "true") {
      await tx.insert(settingsTable)
        .values({ key: "sanitised_transfer_template_instance", value: "true" })
        .onConflictDoNothing({ target: settingsTable.key });
    }
  });
  if (resumeDenied) { response.status(403).json({ error: "That bootstrap token or first administrator email/password is invalid." }); return; }
  const bootstrapFingerprint = crypto.createHash("sha256").update(expectedBootstrapSecret).digest("hex");
  const token = jwt.sign({ role: "staff", email: account.email, name: account.name, setup: true, bootstrapFingerprint, nonce: crypto.randomUUID() }, secret, { expiresIn: "1h" });
  response.status(201).json({ ok: true, token, administrator: { name: account.name, email: account.email } });
});

router.post("/setup/business", async (request, response) => {
  if (!setupAdministrator(request)) { response.status(401).json({ error: "First administrator authentication required." }); return; }
  if (await activated()) { response.status(409).json({ error: "Installation is already activated." }); return; }
  const body = request.body as Record<string, unknown>;
  if (body.whatsapp !== undefined && body.whatsapp !== null && body.whatsapp !== "" && !validWhatsAppNumber(body.whatsapp)) {
    response.status(400).json({ error: "WhatsApp number must be a valid international number beginning with +." }); return;
  }
  const safe = Object.fromEntries(["name", "tradingName", "website", "email", "phone", "address", "logoUrl"].map((key) => [key, typeof body[key] === "string" ? body[key]!.trim() : null]));
  safe.whatsapp = validWhatsAppNumber(body.whatsapp) ? body.whatsapp.trim() : null;
  await db.insert(settingsTable).values({ key: "business_config", value: JSON.stringify(safe) }).onConflictDoUpdate({ target: settingsTable.key, set: { value: JSON.stringify(safe), updatedAt: new Date() } });
  response.json({ ok: true, config: safe });
});

router.post("/setup/automations/:id", async (request, response) => {
  if (!setupAdministrator(request)) { response.status(401).json({ error: "First administrator authentication required." }); return; }
  if (await activated()) { response.status(409).json({ error: "Automation changes are managed after activation." }); return; }
  if (request.body?.enabled === true) {
    response.status(423).json({ error: "Outbound automations are disabled until integration safety verification is complete." });
    return;
  }
  const current: Record<string, boolean> = {};
  for (const automation of automationStatuses()) current[automation.id] = false;
  await db.insert(settingsTable).values({ key: "automation_enabled", value: JSON.stringify(current) }).onConflictDoUpdate({ target: settingsTable.key, set: { value: JSON.stringify(current), updatedAt: new Date() } });
  response.json({ automations: automationStatuses() });
});

router.post("/setup/activate", async (request, response) => {
  if (!setupAdministrator(request)) { response.status(401).json({ error: "First administrator authentication required." }); return; }
  if (await activated()) { response.status(409).json({ error: "Installation is already activated." }); return; }
  if (!(await setting("first_admin_password_hash"))) { response.status(400).json({ error: "Create the first administrator before activation." }); return; }
  if (!completeBusinessConfig(await setting("business_config"))) {
    response.status(400).json({ error: "Complete business configuration with a name, valid email, phone, and address before activation." }); return;
  }
  if (!requiredSetupCredentialsReady()) {
    response.status(400).json({ error: "Fresh, distinct setup credentials are required: configure PORTAL_JWT_SECRET and INSTALLATION_BOOTSTRAP_TOKEN with at least 32 characters each, then create a new administrator setup session." }); return;
  }
  const disabled = Object.fromEntries(automationStatuses().map(({ id }) => [id, false]));
  const disabledIntegrations = Object.fromEntries(integrationRegistry.map(({ id }) => [id, false]));
  await db.transaction(async (tx) => {
    await tx.insert(settingsTable).values({ key: "automation_enabled", value: JSON.stringify(disabled) }).onConflictDoUpdate({ target: settingsTable.key, set: { value: JSON.stringify(disabled), updatedAt: new Date() } });
    await tx.insert(settingsTable).values({ key: "integration_enabled", value: JSON.stringify(disabledIntegrations) }).onConflictDoUpdate({ target: settingsTable.key, set: { value: JSON.stringify(disabledIntegrations), updatedAt: new Date() } });
    await tx.insert(settingsTable).values({ key: "installation_activated", value: "true" }).onConflictDoUpdate({ target: settingsTable.key, set: { value: "true", updatedAt: new Date() } });
  });
  response.json({ ok: true, activated: true, applicationReady: true, automations: automationStatuses() });
});

export async function setupState(_request: Request) {
  const isActivated = await activated();
  return { setupMode: !isActivated, activated: isActivated };
}

export default router;