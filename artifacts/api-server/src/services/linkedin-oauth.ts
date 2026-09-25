/**
 * LinkedIn OAuth 2.0 service.
 *
 * Handles the full 3-legged OAuth flow, automatic token refresh,
 * and organisation discovery for company-page posting.
 *
 * Scopes requested in one flow:
 *   openid profile email         — profile info + person URN
 *   w_member_social              — post to personal profile
 *   w_organization_social        — post to company page
 *   r_organization_social        — list organisation pages the user admins
 */

import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const LI_AUTH_URL   = "https://www.linkedin.com/oauth/v2/authorization";
const LI_TOKEN_URL  = "https://www.linkedin.com/oauth/v2/accessToken";
const LI_API        = "https://api.linkedin.com/v2";

const SCOPES = [
  "openid", "profile", "email",
  "w_member_social",
  "w_organization_social",
  "r_organization_social",
];

// ── DB helpers ────────────────────────────────────────────────────────────────

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}

async function setSetting(key: string, value: string | null): Promise<void> {
  await db.insert(settingsTable).values({ key, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}

async function assertIntegrationWriteAllowed(integrationId: string): Promise<void> {
  const [activation, capabilities] = await Promise.all([
    db.select({ value: settingsTable.value }).from(settingsTable)
      .where(eq(settingsTable.key, "installation_activated")),
    db.select({ value: settingsTable.value }).from(settingsTable)
      .where(eq(settingsTable.key, "integration_enabled")),
  ]);
  if (activation[0]?.value !== "true") {
    throw new Error(`Outbound ${integrationId} write blocked: installation is not activated.`);
  }
  let enabled: unknown;
  try {
    enabled = JSON.parse(capabilities[0]?.value ?? "null");
  } catch {
    throw new Error("Outbound integration capability state is invalid; writes are blocked.");
  }
  if (!enabled || typeof enabled !== "object" || Array.isArray(enabled)
    || (enabled as Record<string, unknown>)[integrationId] !== true) {
    throw new Error(`Outbound ${integrationId} integration is not explicitly enabled.`);
  }
}

// ── Redirect URI ──────────────────────────────────────────────────────────────

export function autoLinkedInRedirectUri(req: import("express").Request): string {
  // In Replit, REPLIT_DOMAINS is the canonical deployed/dev domain list
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) {
    const domain = replitDomains.split(",")[0].trim();
    return `https://${domain}/api/linkedin/oauth/callback`;
  }
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  const host  = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost";
  return `${proto}://${host}/api/linkedin/oauth/callback`;
}

// ── Start OAuth flow ──────────────────────────────────────────────────────────

export async function generateLinkedInAuthUrl(redirectUri: string): Promise<string> {
  const clientId = await getSetting("linkedin_client_id");
  if (!clientId) throw new Error("LinkedIn Client ID not saved — add it in Settings → Social Media first.");
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  await setSetting("linkedin_oauth_state", state);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: SCOPES.join(" "),
  });
  return `${LI_AUTH_URL}?${params}`;
}

// ── Handle callback ───────────────────────────────────────────────────────────

export async function handleLinkedInCallback(
  code: string,
  state: string,
  redirectUri: string,
): Promise<void> {
  const [clientId, clientSecret, savedState] = await Promise.all([
    getSetting("linkedin_client_id"),
    getSetting("linkedin_client_secret"),
    getSetting("linkedin_oauth_state"),
  ]);
  if (!clientId || !clientSecret) throw new Error("LinkedIn credentials not configured");
  if (savedState && savedState !== state) throw new Error("Invalid OAuth state — possible CSRF attack");
  await assertIntegrationWriteAllowed("linkedin");
  await setSetting("linkedin_oauth_state", null);

  // Exchange code for tokens
  const tokenRes = await fetch(LI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const tokenData: any = await tokenRes.json();
  if (!tokenRes.ok) {
    throw new Error(tokenData.error_description ?? tokenData.error ?? `Token exchange failed (${tokenRes.status})`);
  }

  await setSetting("linkedin_access_token", tokenData.access_token);
  await setSetting("linkedin_token_expires_at", String(Date.now() + (tokenData.expires_in ?? 5_184_000) * 1000));
  if (tokenData.refresh_token) {
    await setSetting("linkedin_refresh_token", tokenData.refresh_token);
  }
  if (tokenData.refresh_token_expires_in) {
    await setSetting("linkedin_refresh_token_expires_at", String(Date.now() + tokenData.refresh_token_expires_in * 1000));
  }

  // Get profile (person URN + display name)
  const meRes = await fetch(`${LI_API}/userinfo`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (meRes.ok) {
    const me: any = await meRes.json();
    await setSetting("linkedin_person_urn", `urn:li:person:${me.sub}`);
    const name = [me.given_name, me.family_name].filter(Boolean).join(" ") || me.name || "Unknown";
    await setSetting("linkedin_person_name", name);
  }

  // Try to discover organisation pages the user administers
  // (requires r_organization_social — may not be approved yet, non-fatal)
  try {
    const aclRes = await fetch(
      `${LI_API}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR`,
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "X-Restli-Protocol-Version": "2.0.0",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (aclRes.ok) {
      const aclData: any = await aclRes.json();
      const elements: any[] = aclData.elements ?? [];
      const orgs: { urn: string; name: string }[] = [];
      for (const el of elements.slice(0, 10)) {
        const orgUrn: string = el.organization ?? "";
        if (!orgUrn) continue;
        const orgId = orgUrn.replace("urn:li:organization:", "");
        let orgName = `Organization ${orgId}`;
        try {
          const detailRes = await fetch(
            `${LI_API}/organizations/${orgId}?projection=(id,localizedName)`,
            {
              headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
                "X-Restli-Protocol-Version": "2.0.0",
              },
              signal: AbortSignal.timeout(5_000),
            },
          );
          if (detailRes.ok) {
            const d: any = await detailRes.json();
            orgName = d.localizedName ?? orgName;
          }
        } catch { /* non-fatal */ }
        orgs.push({ urn: orgUrn, name: orgName });
      }
      if (orgs.length > 0) {
        await setSetting("linkedin_orgs", JSON.stringify(orgs));
        // Auto-select the first org if none was already configured
        const existing = await getSetting("linkedin_org_urn");
        if (!existing) {
          await setSetting("linkedin_org_urn", orgs[0].urn);
          await setSetting("linkedin_org_name", orgs[0].name);
        }
      }
    }
  } catch (err) {
    console.warn("[linkedin-oauth] Organisation discovery skipped:", err instanceof Error ? err.message : err);
  }

  // Default posting preferences: profile ON, page OFF (user can change in Settings)
  const existingProfile = await getSetting("linkedin_post_to_profile");
  if (existingProfile === null) await setSetting("linkedin_post_to_profile", "true");
  const existingPage = await getSetting("linkedin_post_to_page");
  if (existingPage === null) await setSetting("linkedin_post_to_page", "false");
}

// ── Get valid access token (refresh if needed) ────────────────────────────────

export async function getLinkedInAccessToken(): Promise<string | null> {
  const accessToken = await getSetting("linkedin_access_token");
  if (!accessToken) return null;

  const expiresAt = parseInt(await getSetting("linkedin_token_expires_at") ?? "0");
  // Return cached token if still valid (5-min buffer)
  if (Date.now() < expiresAt - 300_000) return accessToken;

  // Try to refresh
  const [clientId, clientSecret, refreshToken] = await Promise.all([
    getSetting("linkedin_client_id"),
    getSetting("linkedin_client_secret"),
    getSetting("linkedin_refresh_token"),
  ]);
  if (!clientId || !clientSecret || !refreshToken) {
    // Old manually-pasted token with no refresh — return it and hope for the best
    return accessToken;
  }

  const refreshExpiresAt = parseInt(await getSetting("linkedin_refresh_token_expires_at") ?? "0");
  if (refreshExpiresAt > 0 && Date.now() > refreshExpiresAt - 300_000) {
    console.warn("[linkedin-oauth] Refresh token expired — user must reconnect via Settings");
    return null;
  }

  await assertIntegrationWriteAllowed("linkedin");
  const res = await fetch(LI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const data: any = await res.json();
  if (!res.ok) {
    console.error("[linkedin-oauth] Refresh failed:", data);
    return null;
  }
  await setSetting("linkedin_access_token", data.access_token);
  await setSetting("linkedin_token_expires_at", String(Date.now() + (data.expires_in ?? 5_184_000) * 1000));
  if (data.refresh_token) await setSetting("linkedin_refresh_token", data.refresh_token);
  return data.access_token;
}

// ── Status ────────────────────────────────────────────────────────────────────

export interface LinkedInStatus {
  connected: boolean;
  personName?: string;
  personUrn?: string;
  orgUrn?: string;
  orgName?: string;
  orgs?: { urn: string; name: string }[];
  postToProfile: boolean;
  postToPage: boolean;
  tokenExpiresAt?: number;
  hasRefreshToken: boolean;
}

export async function getLinkedInStatus(): Promise<LinkedInStatus> {
  const [
    accessToken, refreshToken, personName, personUrn,
    orgUrn, orgName, orgsJson, postToProfile, postToPage, expiresAtStr,
  ] = await Promise.all([
    getSetting("linkedin_access_token"),
    getSetting("linkedin_refresh_token"),
    getSetting("linkedin_person_name"),
    getSetting("linkedin_person_urn"),
    getSetting("linkedin_org_urn"),
    getSetting("linkedin_org_name"),
    getSetting("linkedin_orgs"),
    getSetting("linkedin_post_to_profile"),
    getSetting("linkedin_post_to_page"),
    getSetting("linkedin_token_expires_at"),
  ]);

  let orgs: { urn: string; name: string }[] | undefined;
  try { if (orgsJson) orgs = JSON.parse(orgsJson); } catch { /* ignore */ }

  return {
    connected: !!(accessToken),
    personName:      personName ?? undefined,
    personUrn:       personUrn ?? undefined,
    orgUrn:          orgUrn ?? undefined,
    orgName:         orgName ?? undefined,
    orgs,
    postToProfile:   postToProfile !== "false",     // default true
    postToPage:      postToPage === "true",          // default false
    tokenExpiresAt:  expiresAtStr ? parseInt(expiresAtStr) : undefined,
    hasRefreshToken: !!refreshToken,
  };
}

// ── Disconnect ────────────────────────────────────────────────────────────────

export async function disconnectLinkedIn(): Promise<void> {
  for (const key of [
    "linkedin_access_token", "linkedin_refresh_token",
    "linkedin_token_expires_at", "linkedin_refresh_token_expires_at",
    "linkedin_person_urn", "linkedin_person_name",
    "linkedin_org_urn", "linkedin_org_name", "linkedin_orgs",
    "linkedin_oauth_state", "linkedin_post_to_profile", "linkedin_post_to_page",
  ]) {
    await setSetting(key, null);
  }
}
