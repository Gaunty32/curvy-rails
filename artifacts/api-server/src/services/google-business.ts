import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GBP_ACCOUNT_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const GBP_INFO_API = "https://mybusinessbusinessinformation.googleapis.com/v1";
const GBP_LEGACY_API = "https://mybusiness.googleapis.com/v4"; // account/location listing only (v4 still works for read)
const GBP_POST_API = "https://mybusinesspostingapi.googleapis.com/v1"; // local posts — migrated from deprecated v4
const SCOPE = "https://www.googleapis.com/auth/business.manage";

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

export function autoGbpRedirectUri(req: import("express").Request): string {
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) {
    const domain = replitDomains.split(",")[0].trim();
    return `https://${domain}/api/gbp/callback`;
  }
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost";
  return `${proto}://${host}/api/gbp/callback`;
}

export async function generateGbpAuthUrl(redirectUri: string): Promise<string> {
  const clientId = await getSetting("gbp_client_id");
  if (!clientId) throw new Error("Google Client ID not configured — add it in Settings → Social Media");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

export async function handleGbpCallback(code: string, redirectUri: string): Promise<void> {
  const clientId = await getSetting("gbp_client_id");
  const clientSecret = await getSetting("gbp_client_secret");
  if (!clientId || !clientSecret) throw new Error("Google credentials not configured");
  await assertIntegrationWriteAllowed("google_business");
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || "Token exchange failed");
  if (data.refresh_token) await setSetting("gbp_refresh_token", data.refresh_token);
  await setSetting("gbp_access_token", data.access_token);
  await setSetting("gbp_token_expires_at", String(Date.now() + (data.expires_in ?? 3600) * 1000));

  // ── Immediately resolve the full canonical location path ──────────────────
  // Strategy 0: for personal GBP accounts the Google user ID (OAuth sub) IS the
  // account ID — test it first since it needs zero GBP API quota.
  // Strategy 1: Account Management API + Business Information API (rate-limited).
  // If none work the user can enter the path manually in Settings.
  try {
    const resolvedName = await resolveGbpLocationName(data.access_token);
    if (resolvedName) {
      const accountPart = resolvedName.split("/locations/")[0];
      await setSetting("gbp_location_name", resolvedName);
      await setSetting("gbp_account_name", accountPart);
      await setSetting("gbp_location_resolve_retry_after", "0");
      console.log(`[GBP] Auto-saved location at connect time: ${resolvedName}`);
    }
  } catch (err) {
    console.warn("[GBP] Could not auto-discover location at connect time:", (err as Error).message);
  }
}

/**
 * Try every available strategy to turn the stored partial location path into
 * the full accounts/{accountId}/locations/{locationId} form.
 * Returns the resolved name, or null if all strategies fail.
 */
export async function resolveGbpLocationName(accessToken: string): Promise<string | null> {
  const stored = await getSetting("gbp_location_name") ?? "";
  const bareId = stored.includes("/locations/")
    ? stored.split("/locations/").pop()!
    : stored.replace(/^locations\//, "");
  if (!bareId) return null;

  // ── Strategy 0: userinfo sub ────────────────────────────────────────────
  // For personal GBP accounts the Google user sub == account ID.
  // Uses the OpenID Connect userinfo endpoint — no GBP quota consumed at all.
  try {
    const uiRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (uiRes.ok) {
      const uiData: any = await uiRes.json();
      const sub: string = uiData?.sub ?? "";
      if (sub) {
        const candidate = `accounts/${sub}/locations/${bareId}`;
        const probe = await fetch(
          `https://mybusinessreviews.googleapis.com/v1/${candidate}/reviews?pageSize=1`,
          { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000) },
        );
        if (probe.ok) {
          console.log(`[GBP] resolveLocation: resolved via userinfo sub → ${candidate}`);
          return candidate;
        }
        console.log(`[GBP] resolveLocation: userinfo sub ${sub} did not match (probe ${probe.status}) — trying account APIs`);
      }
    }
  } catch (e) {
    console.warn("[GBP] resolveLocation: userinfo strategy error:", (e as Error).message);
  }

  // ── Strategy 1: Account Management + Business Information APIs ───────────
  try {
    const locations = await listGbpLocations(accessToken);
    const match = locations.find(l => l.name.endsWith(`/locations/${bareId}`));
    if (match) {
      console.log(`[GBP] resolveLocation: resolved via location list → ${match.name}`);
      return match.name;
    }
    if (locations.length > 0) {
      console.log(`[GBP] resolveLocation: ${locations.length} location(s) found but none matched bareId ${bareId}`);
    }
  } catch (e) {
    console.warn("[GBP] resolveLocation: account API strategy error:", (e as Error).message);
  }

  // ── Strategy 2: wildcard accounts/- on the Reviews API ──────────────────
  // The Reviews API supports accounts/-/locations/{id} as a wildcard.
  // If it returns reviews, the first review's resource name contains the real
  // account ID — e.g. accounts/123456/locations/{id}/reviews/{rev} — so we
  // can extract the canonical path without touching the Account Management API.
  try {
    const wildcardPath = `accounts/-/locations/${bareId}`;
    const wRes = await fetch(
      `https://mybusinessreviews.googleapis.com/v1/${wildcardPath}/reviews?pageSize=1`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(12_000) },
    );
    if (wRes.ok) {
      const wData: any = await wRes.json();
      const sampleName: string = (wData.reviews ?? [])[0]?.name ?? "";
      // name shape: accounts/123456/locations/789/reviews/abc
      const locPart = sampleName.split("/reviews/")[0]; // accounts/123456/locations/789
      if (locPart?.startsWith("accounts/") && locPart.includes("/locations/")) {
        console.log(`[GBP] resolveLocation: resolved via Reviews wildcard → ${locPart}`);
        return locPart;
      }
      // Wildcard endpoint returned 200 but no reviews yet — still a valid path;
      // return it so the caller can at least save and use it.
      if (wData.reviews !== undefined) {
        const fallback = `accounts/-/locations/${bareId}`;
        console.log(`[GBP] resolveLocation: Reviews wildcard succeeded but 0 reviews — using ${fallback} as fallback`);
        return fallback;
      }
    } else {
      console.warn(`[GBP] resolveLocation: Reviews wildcard returned ${wRes.status}`);
    }
  } catch (e) {
    console.warn("[GBP] resolveLocation: Reviews wildcard strategy error:", (e as Error).message);
  }

  // ── Strategy 3: Business Information API with bare location ID ────────────
  // Calling locations/{id}?readMask=name directly (no account prefix needed)
  // returns the canonical accounts/{accountId}/locations/{id} path in data.name.
  // This is the same call the startup migration uses and works even when the
  // Account Management API quota is zero.
  try {
    const infoRes = await fetch(
      `${GBP_INFO_API}/locations/${bareId}?readMask=name`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000) },
    );
    if (infoRes.ok) {
      const infoData: any = await infoRes.json();
      const fullName: string = infoData?.name ?? "";
      if (fullName.startsWith("accounts/") && fullName.includes("/locations/")) {
        console.log(`[GBP] resolveLocation: resolved via Business Info API → ${fullName}`);
        return fullName;
      }
    } else {
      const errText = await infoRes.text().catch(() => "");
      console.warn(`[GBP] resolveLocation: Business Info API returned ${infoRes.status}: ${errText.slice(0, 120)}`);
    }
  } catch (e) {
    console.warn("[GBP] resolveLocation: Business Info API strategy error:", (e as Error).message);
  }

  return null;
}

export async function getGbpAccessToken(): Promise<string | null> {
  const clientId = await getSetting("gbp_client_id");
  const clientSecret = await getSetting("gbp_client_secret");
  const refreshToken = await getSetting("gbp_refresh_token");
  if (!refreshToken) return null;
  if (!clientId || !clientSecret) throw new Error("MISSING_CREDENTIALS: Google Client ID and Secret must be entered in Settings → Social Media → Google Business Profile before the connection can be used.");

  const expiresAt = parseInt(await getSetting("gbp_token_expires_at") ?? "0");
  if (Date.now() < expiresAt - 60_000) {
    return getSetting("gbp_access_token");
  }

  await assertIntegrationWriteAllowed("google_business");
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const data: any = await res.json();
  if (!res.ok) {
    const reason = data?.error_description ?? data?.error ?? `HTTP ${res.status}`;
    if (data?.error === "invalid_client") throw new Error("INVALID_CLIENT: The Google Client ID or Secret is incorrect. Re-enter your credentials in Settings → Social Media and reconnect.");
    if (data?.error === "invalid_grant") throw new Error("TOKEN_EXPIRED: The Google authorisation has expired or been revoked. Click Disconnect and reconnect to Google.");
    throw new Error(`TOKEN_REFRESH_FAILED: ${reason}`);
  }
  await setSetting("gbp_access_token", data.access_token);
  await setSetting("gbp_token_expires_at", String(Date.now() + (data.expires_in ?? 3600) * 1000));
  return data.access_token;
}

/** Structured diagnostic info for the settings UI */
export async function getGbpDiagnostics(): Promise<{ hasClientId: boolean; hasClientSecret: boolean; hasRefreshToken: boolean }> {
  return {
    hasClientId: !!(await getSetting("gbp_client_id")),
    hasClientSecret: !!(await getSetting("gbp_client_secret")),
    hasRefreshToken: !!(await getSetting("gbp_refresh_token")),
  };
}

export async function getGbpStatus(): Promise<{ connected: boolean; locationName?: string; locationTitle?: string }> {
  const refreshToken = await getSetting("gbp_refresh_token");
  const locationName = await getSetting("gbp_location_name");
  const locationTitle = await getSetting("gbp_location_title");
  return { connected: !!refreshToken, locationName: locationName ?? undefined, locationTitle: locationTitle ?? undefined };
}

function parseGbpError(status: number, errText: string, context: string): Error {
  try {
    const errJson = JSON.parse(errText);
    const detail = (errJson?.error?.details ?? []).find((d: any) => d.reason === "SERVICE_DISABLED");
    if (detail?.metadata?.activationUrl) {
      return new Error(`SERVICE_DISABLED:${detail.metadata.activationUrl}`);
    }
    if (errJson?.error?.message) {
      return new Error(errJson.error.message);
    }
  } catch { /* not JSON — fall through */ }
  return new Error(`${context} error ${status}: ${errText}`);
}

// ── Shared in-memory cache for location list (5-min TTL) ─────────────────────
// Prevents multiple concurrent callers (reviews, settings page, social posts)
// from each hitting the low-quota Account Management API independently.
let _locationsCache: { locations: { name: string; title: string }[]; at: number } | null = null;
const LOCATIONS_TTL = 5 * 60_000;

export async function listGbpLocations(accessToken: string): Promise<{ name: string; title: string }[]> {
  const now = Date.now();
  if (_locationsCache && now - _locationsCache.at < LOCATIONS_TTL) {
    return _locationsCache.locations;
  }

  // ── Strategy 1: v1 Account Management API + Business Information API ─────
  const accRes = await fetch(`${GBP_ACCOUNT_API}/accounts`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (accRes.ok) {
    const accData: any = await accRes.json();
    const accounts: any[] = accData.accounts ?? [];
    const locations: { name: string; title: string }[] = [];
    for (const acc of accounts) {
      const locRes = await fetch(
        `${GBP_INFO_API}/${acc.name}/locations?readMask=name,title&pageSize=100`,
        { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000) },
      );
      if (!locRes.ok) {
        const errText = await locRes.text();
        console.warn(`[GBP] listLocations: Business Info API returned ${locRes.status} for ${acc.name}: ${errText.slice(0, 100)}`);
        continue;
      }
      const locData: any = await locRes.json();
      for (const loc of locData.locations ?? []) {
        locations.push({ name: loc.name, title: loc.title ?? loc.name });
      }
    }
    if (locations.length > 0) {
      _locationsCache = { locations, at: now };
      return locations;
    }
    // Fall through to v4 if no locations found
    console.warn("[GBP] listLocations: v1 APIs returned no locations — trying legacy v4 API");
  } else {
    const errText = await accRes.text();
    console.warn(`[GBP] listLocations: v1 Account Management API returned ${accRes.status} — trying legacy v4 API`);
    if (accRes.status !== 429 && accRes.status !== 503) {
      throw parseGbpError(accRes.status, errText, "GBP accounts API");
    }
  }

  // ── Strategy 2: Legacy My Business API v4 (separate quota) ───────────────
  const v4AccRes = await fetch(`${GBP_LEGACY_API}/accounts`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!v4AccRes.ok) {
    const v4Err = await v4AccRes.text();
    console.warn(`[GBP] listLocations: legacy v4 API also returned ${v4AccRes.status}`);
    throw parseGbpError(v4AccRes.status, v4Err, "GBP legacy v4 accounts API");
  }
  const v4AccData: any = await v4AccRes.json();
  const v4Accounts: any[] = v4AccData.accounts ?? [];
  const v4Locations: { name: string; title: string }[] = [];
  for (const acc of v4Accounts) {
    const v4LocRes = await fetch(
      `${GBP_LEGACY_API}/${acc.name}/locations?pageSize=100`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000) },
    );
    if (!v4LocRes.ok) {
      console.warn(`[GBP] listLocations: v4 locations for ${acc.name} returned ${v4LocRes.status}`);
      continue;
    }
    const v4LocData: any = await v4LocRes.json();
    for (const loc of (v4LocData.locations ?? [])) {
      // v4 loc.name is "accounts/{accountId}/locations/{locationId}"
      v4Locations.push({ name: loc.name, title: loc.locationName ?? loc.name });
    }
  }

  if (v4Locations.length === 0) {
    throw new Error("No GBP locations found via either API");
  }

  _locationsCache = { locations: v4Locations, at: now };
  return v4Locations;
}

/** Invalidate the in-process locations cache (call after saving a new location). */
export function invalidateLocationsCache(): void {
  _locationsCache = null;
}


export async function publishGbpPost(locationName: string, accessToken: string, text: string, imageUrl?: string | null, callToActionUrl?: string | null): Promise<{ ok: boolean; postName?: string; error?: string }> {
  // The Posting API v1 uses locations/{locationId} — strip the accounts/*/locations/ prefix
  // if the stored name is the full canonical path.
  const locationId = locationName.includes("/locations/")
    ? locationName.split("/locations/")[1]
    : locationName.replace(/^locations\//, "");

  const body: any = { topicType: "STANDARD", summary: text };
  if (imageUrl) body.media = [{ mediaFormat: "PHOTO", sourceUrl: imageUrl }];
  if (callToActionUrl) body.callToAction = { actionType: "LEARN_MORE", url: callToActionUrl };

  const url = `${GBP_POST_API}/locations/${locationId}/localPosts`;
  console.log(`[gbp] POST ${url} imageUrl=${imageUrl?.slice(0, 60) ?? "none"}`);

  await assertIntegrationWriteAllowed("google_business");
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: any = await res.json();
  if (!res.ok) {
    const errMsg = data.error?.message ?? `GBP API error ${res.status}`;
    console.error(`[gbp] post failed ${res.status}:`, errMsg);
    return { ok: false, error: errMsg };
  }
  return { ok: true, postName: data.name };
}

export async function disconnectGbp(): Promise<void> {
  for (const key of [
    "gbp_refresh_token", "gbp_access_token", "gbp_token_expires_at",
    "gbp_location_name", "gbp_location_title", "gbp_account_name",
    "gbp_location_resolve_retry_after", "gbp_locations_cache",
  ]) {
    await setSetting(key, null);
  }
  _locationsCache = null;
}
