/**
 * /shop/reviews — fetches reviews from Google Business Profile and Facebook,
 * normalises them to a common shape, and caches for 6 hours.
 */

import { Router } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getGbpAccessToken, listGbpLocations } from "../services/google-business.js";

const router = Router();

// ── types ────────────────────────────────────────────────────────────────────

export interface Review {
  id: string;
  source: "google" | "facebook";
  author: string;
  authorPhoto?: string;
  rating: number;   // 1-5
  text: string;
  date: string;     // ISO date string
  mediaUrls?: string[];  // photos attached to the review
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}

async function setSetting(key: string, value: string | null): Promise<void> {
  await db.insert(settingsTable).values({ key, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}

const GBP_STAR: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
};

// ── Google Business Profile reviews ───────────────────────────────────────────

async function fetchGoogleReviews(): Promise<Review[]> {
  let token: string | null;
  try {
    token = await getGbpAccessToken();
  } catch (err) {
    console.warn("[reviews] Cannot get GBP access token:", (err as Error).message);
    return [];
  }
  if (!token) return [];

  let locationName = await getSetting("gbp_location_name");

  // Auto-detect location when credentials are valid but location was never selected
  if (!locationName) {
    try {
      const locations = await listGbpLocations(token);
      if (locations.length === 1) {
        locationName = locations[0].name;
        await setSetting("gbp_location_name", locationName);
        await setSetting("gbp_location_title", locations[0].title);
        // Bust the reviews cache so the next call fetches fresh data including Google
        memCache = null;
        await setSetting("shop_reviews_cache_at", "0");
        console.log(`[reviews] Auto-saved GBP location: ${locations[0].title} (${locationName})`);
      } else if (locations.length > 1) {
        console.warn(`[reviews] GBP has ${locations.length} locations — cannot auto-select. Go to Settings → Social Media to pick one.`);
        return [];
      } else {
        console.warn("[reviews] GBP has no locations accessible via the API.");
        return [];
      }
    } catch (err) {
      console.warn("[reviews] Could not auto-detect GBP location:", err);
      return [];
    }
  }

  if (!locationName) return [];

  // The Reviews API requires the full accounts/{accountId}/locations/{locationId} path.
  // The Business Information API accepts locations/{locationId} directly (no account prefix needed)
  // and returns the canonical full name in its response — we use that to resolve the account ID
  // and then retry the Reviews API with the resolved path.
  const isFullPath = locationName.startsWith("accounts/") && locationName.includes("/locations/");
  const bareId = locationName.replace(/^accounts\/[^/]+\/locations\//, "").replace(/^locations\//, "");

  if (!isFullPath) {
    console.log(`[reviews] Location not yet resolved ("${locationName}") — will resolve via Business Info API`);
  }

  // Fetch reviews. Strategy:
  // 1. Try the stored path (full canonical or bare location ID).
  // 2. If that 404s (wrong account ID in stored canonical), retry with accounts/- wildcard.
  // 3. If wildcard succeeds, extract the real canonical from the first review's resource name
  //    and persist it so future calls go direct.
  // Business Info API is also fetched in parallel to resolve the canonical name, but
  // it has quota=0 on this project so we don't depend on it.
  try {
    const reviewsPath = isFullPath ? locationName : `accounts/-/locations/${bareId}`;
    const metaPath = isFullPath ? locationName : `locations/${bareId}`;

    const [reviewsRes, metaRes] = await Promise.all([
      fetch(
        `https://mybusinessreviews.googleapis.com/v1/${reviewsPath}/reviews?pageSize=50`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
      ),
      fetch(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${metaPath}?readMask=name,metadata`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
      ),
    ]);

    // Extract canonical location name and review URI from metadata response (best-effort).
    let canonicalName: string | null = null;
    if (metaRes.ok) {
      try {
        const meta: any = await metaRes.json();
        const reviewUri: string | undefined = meta?.metadata?.newReviewUri;
        if (reviewUri) await setSetting("gbp_new_review_uri", reviewUri);
        const metaName: string | undefined = meta?.name;
        if (metaName?.startsWith("accounts/") && metaName.includes("/locations/")) {
          canonicalName = metaName;
          if (locationName !== canonicalName) {
            const accountPart = canonicalName.split("/locations/")[0];
            await Promise.all([
              setSetting("gbp_location_name", canonicalName),
              setSetting("gbp_account_name", accountPart),
            ]);
            console.log(`[reviews] Resolved canonical location from Business Info API → ${canonicalName}`);
          }
        }
      } catch { /* non-fatal */ }
    }

    let reviewsData: any = null;

    if (reviewsRes.ok) {
      reviewsData = await reviewsRes.json();
    } else if (reviewsRes.status === 404 && isFullPath) {
      // Stored canonical path has a wrong account ID — fall back to wildcard.
      console.warn(`[reviews] Canonical path returned 404 (wrong account ID?) — falling back to accounts/- wildcard`);
      const wildcardPath = `accounts/-/locations/${bareId}`;
      const wildcardRes = await fetch(
        `https://mybusinessreviews.googleapis.com/v1/${wildcardPath}/reviews?pageSize=50`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
      );
      if (wildcardRes.ok) {
        reviewsData = await wildcardRes.json();
        // Extract the real canonical path from the first review and persist it.
        const firstReviewName: string = (reviewsData?.reviews ?? [])[0]?.name ?? "";
        const locPart = firstReviewName.split("/reviews/")[0]; // accounts/{real}/locations/{id}
        if (locPart?.startsWith("accounts/") && locPart.includes("/locations/")) {
          const accountPart = locPart.split("/locations/")[0];
          await Promise.all([
            setSetting("gbp_location_name", locPart),
            setSetting("gbp_account_name", accountPart),
          ]);
          console.log(`[reviews] Wildcard succeeded — persisted correct canonical: ${locPart}`);
        }
      } else {
        const err = await wildcardRes.text().catch(() => "");
        console.warn(`[reviews] Wildcard also failed (${wildcardRes.status}): ${err.slice(0, 200)}`);
        return [];
      }
    } else if (!reviewsRes.ok && canonicalName) {
      // Original path failed for some other reason but we resolved canonical from Business Info.
      console.log(`[reviews] Reviews path failed (${reviewsRes.status}) — retrying with Business Info canonical ${canonicalName}`);
      const retryRes = await fetch(
        `https://mybusinessreviews.googleapis.com/v1/${canonicalName}/reviews?pageSize=50`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
      );
      if (retryRes.ok) {
        reviewsData = await retryRes.json();
      } else {
        const err = await retryRes.text().catch(() => "");
        console.warn(`[reviews] GBP reviews retry also failed (${retryRes.status}): ${err.slice(0, 200)}`);
        return [];
      }
    } else if (!reviewsRes.ok) {
      const err = await reviewsRes.text().catch(() => "");
      console.warn(`[reviews] GBP reviews fetch failed (${reviewsRes.status}): ${err.slice(0, 200)}`);
      return [];
    }

    const data: any = reviewsData ?? {};

    const reviews: Review[] = [];
    for (const r of (data.reviews ?? [])) {
      if (!r.comment?.trim()) continue;   // skip no-text reviews
      reviews.push({
        id:          `google-${r.reviewId}`,
        source:      "google",
        author:      r.reviewer?.displayName ?? "Google User",
        authorPhoto: r.reviewer?.profilePhotoUrl,
        rating:      GBP_STAR[r.starRating] ?? 5,
        text:        r.comment.trim(),
        date:        r.createTime ?? r.updateTime ?? new Date().toISOString(),
      });
    }
    return reviews;
  } catch (err) {
    console.warn("[reviews] GBP reviews error:", err);
    return [];
  }
}

// ── Facebook ratings ──────────────────────────────────────────────────────────

async function fetchFacebookReviews(): Promise<Review[]> {
  const [pageId, token] = await Promise.all([
    getSetting("facebook_page_id"),
    getSetting("facebook_page_access_token"),
  ]);
  if (!pageId || !token) return [];

  try {
    // Exchange for a permanent page access token first (handles both user + page tokens)
    const pageTokenRes = await fetch(
      `https://graph.facebook.com/v20.0/${pageId}?fields=access_token&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    const pageTokenData: any = await pageTokenRes.json();
    const pageToken: string = pageTokenData.access_token ?? token;

    // reviewer picture: pic_square was deprecated in Graph API v13+; use picture{url} instead.
    // Response shape: reviewer.picture.data.url
    const url = `https://graph.facebook.com/v20.0/${pageId}/ratings`
      + `?fields=reviewer{name,picture{url}},rating,review_text,created_time`
      + `&limit=50&access_token=${encodeURIComponent(pageToken)}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      const err = await res.text();
      console.warn(`[reviews] Facebook ratings fetch failed (${res.status}): ${err.slice(0, 300)}`);
      return [];
    }
    const data: any = await res.json();
    if (data.error) {
      console.warn(`[reviews] Facebook ratings error: ${JSON.stringify(data.error)}`);
      return [];
    }
    // Log the first raw entry so we can confirm what fields Facebook actually returns
    console.log(`[reviews] Facebook raw sample:`, JSON.stringify(data.data?.[0] ?? {}).slice(0, 500));
    const reviews: Review[] = [];
    for (const r of (data.data ?? [])) {
      if (!r.review_text?.trim()) continue;
      reviews.push({
        id:          `facebook-${r.created_time ?? Math.random()}`,
        source:      "facebook",
        author:      r.reviewer?.name ?? "Facebook User",
        // picture{url} returns { data: { url, width, height, is_silhouette } }
        authorPhoto: r.reviewer?.picture?.data?.is_silhouette === false
          ? r.reviewer?.picture?.data?.url
          : undefined,
        rating:      typeof r.rating === "number" ? r.rating : 5,
        text:        r.review_text.trim(),
        date:        r.created_time ?? new Date().toISOString(),
      });
    }
    return reviews;
  } catch (err) {
    console.warn("[reviews] Facebook reviews error:", err);
    return [];
  }
}

// ── In-memory cache ────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
let memCache: { reviews: Review[]; fetchedAt: number } | null = null;

async function getReviews(): Promise<Review[]> {
  const now = Date.now();

  // 1. In-memory hit
  if (memCache && now - memCache.fetchedAt < CACHE_TTL_MS) {
    return memCache.reviews;
  }

  // 2. DB-persisted cache (survives restarts)
  if (!memCache) {
    try {
      const cached = await getSetting("shop_reviews_cache");
      const cachedAt = parseInt(await getSetting("shop_reviews_cache_at") ?? "0");
      if (cached && now - cachedAt < CACHE_TTL_MS) {
        const parsed: Review[] = JSON.parse(cached);
        memCache = { reviews: parsed, fetchedAt: cachedAt };
        return parsed;
      }
    } catch { /* ignore */ }
  }

  // 3. Fresh fetch
  const [google, facebook] = await Promise.all([
    fetchGoogleReviews(),
    fetchFacebookReviews(),
  ]);

  // Interleave sources so the carousel mixes them, sort newest first
  const all = [...google, ...facebook]
    .filter(r => r.text.length >= 20)         // skip very short reviews
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Persist to DB
  try {
    await setSetting("shop_reviews_cache", JSON.stringify(all));
    await setSetting("shop_reviews_cache_at", String(now));
  } catch { /* non-fatal */ }

  memCache = { reviews: all, fetchedAt: now };
  return all;
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.get("/shop/reviews", async (_req, res): Promise<void> => {
  try {
    const [reviews, googleReviewUrl] = await Promise.all([
      getReviews(),
      getSetting("gbp_new_review_uri"),
    ]);
    res.json({ reviews, googleReviewUrl: googleReviewUrl ?? null });
  } catch (err) {
    console.error("[reviews] Route error:", err);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

// Debug: call GBP Reviews API directly and return the raw status + body
router.get("/gbp-reviews-debug", async (_req, res): Promise<void> => {
  try {
    const token = await getGbpAccessToken();
    if (!token) { res.json({ error: "No GBP access token available (may need OAuth re-auth)" }); return; }

    const locationName = await getSetting("gbp_location_name") ?? "";
    const expiresAt = await getSetting("gbp_token_expires_at");
    const bareId = locationName.replace(/^accounts\/[^/]+\/locations\//, "").replace(/^locations\//, "");

    // Call both APIs in parallel: Business Info (to get true canonical name) + Reviews
    const reviewsUrl = `https://mybusinessreviews.googleapis.com/v1/${locationName}/reviews?pageSize=5`;
    const infoUrl = `https://mybusinessbusinessinformation.googleapis.com/v1/locations/${bareId}?readMask=name,title`;
    const [reviewsRes, infoRes] = await Promise.all([
      fetch(reviewsUrl, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }),
      fetch(infoUrl, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }),
    ]);
    const [reviewsBody, infoBody] = await Promise.all([
      reviewsRes.json().catch(() => ({})),
      infoRes.json().catch(() => ({})),
    ]);

    res.json({
      locationName,
      tokenExpiresAt: expiresAt ? new Date(Number(expiresAt)).toISOString() : null,
      businessInfoStatus: infoRes.status,
      businessInfoBody: infoBody,
      reviewsUrl,
      reviewsStatus: reviewsRes.status,
      reviewsBody,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Debug: return raw Facebook ratings response so we can see reviewer field shape
router.get("/facebook-ratings-debug", async (_req, res): Promise<void> => {
  const [pageId, token] = await Promise.all([
    getSetting("facebook_page_id"),
    getSetting("facebook_page_access_token"),
  ]);
  if (!pageId || !token) { res.status(400).json({ error: "No page ID or token stored" }); return; }

  const pageTokenRes = await fetch(
    `https://graph.facebook.com/v20.0/${pageId}?fields=access_token&access_token=${encodeURIComponent(token)}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  const pageTokenData: any = await pageTokenRes.json();
  const pageToken: string = pageTokenData.access_token ?? token;
  const exchanged = !!pageTokenData.access_token;

  const ratingsRes = await fetch(
    `https://graph.facebook.com/v20.0/${pageId}/ratings?fields=reviewer{id,name,picture{url}},rating,review_text,created_time&limit=3&access_token=${encodeURIComponent(pageToken)}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  const ratingsData: any = await ratingsRes.json();

  res.json({
    pageId,
    tokenExchanged: exchanged,
    pageTokenExchangeResponse: pageTokenData,
    ratingsStatus: ratingsRes.status,
    ratingsRaw: ratingsData,
  });
});

// Force-refresh (used by the weekly SEO check or manual refresh)
router.post("/shop/reviews/refresh", async (_req, res): Promise<void> => {
  memCache = null;
  await setSetting("shop_reviews_cache_at", "0");
  try {
    const reviews = await getReviews();
    res.json({ ok: true, count: reviews.length });
  } catch (err) {
    res.status(500).json({ error: "Refresh failed" });
  }
});

export default router;
