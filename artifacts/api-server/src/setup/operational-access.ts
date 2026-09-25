import type { Request, RequestHandler } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const publicStaffAuthentication = new Set([
  "POST /auth/staff/login",
  "POST /auth/staff/request-otp",
  "POST /auth/staff/verify-otp",
  "GET /auth/staff/status",
]);

const publicShopWrites = new Set([
  "POST /shop/auth/request-otp",
  "POST /shop/auth/verify-otp",
  "PATCH /shop/customer/profile",
  "POST /shop/promotions/validate",
  "POST /shop/stripe/payment-intent",
  "POST /shop/analytics/events",
  "POST /shop/orders",
]);

// Exact method/path exceptions for public support, callback, and provider
// return flows. Do not replace these with broad prefix exemptions.
const publicSupportRoutes = new Set([
  "POST /feedback",
  "POST /callback",
  "GET /callback/availability",
  "GET /callback/staff-photo",
  "POST /shop/enquiry",
  "POST /shop/product-enquiry",
  "POST /shop/live-chat/session",
  "PATCH /shop/live-chat/session/:id",
  "POST /shop/live-chat",
  "GET /xero/callback",
  "GET /linkedin/oauth/callback",
  "GET /gbp/callback",
]);

function canonicalPath(path: string): string | null {
  try {
    let decoded = decodeURIComponent(path);
    decoded = decoded.replace(/\/+/g, "/");
    if (decoded !== "/api" && decoded.startsWith("/api/")) decoded = decoded.slice(4);
    if (decoded.length > 1) decoded = decoded.replace(/\/+$/, "");
    return decoded.toLowerCase();
  } catch {
    return null;
  }
}

function isPublicSupportRoute(method: string, path: string): boolean {
  if (publicSupportRoutes.has(`${method} ${path}`)) return true;
  // Public callback-status links carry a single opaque identifier.
  return method === "GET" && /^\/callback\/[^/]+$/.test(path);
}

/**
 * URL-level staff policy. Portal authentication remains the portal router's
 * responsibility; public shop and checkout traffic is not staff-gated.
 */
export function requiresStaffAuthorization(method: string, rawPath: string): boolean {
  const path = canonicalPath(rawPath);
  if (!path) return true;
  const verb = method.toUpperCase();

  if (path === "/setup" || path.startsWith("/setup/")) return false;
  // Legacy portal-admin URLs are staff operations. Do not let a general
  // /portal exemption make these mutations public; manager/team URLs continue
  // into the portal router's own portal-JWT role checks unchanged.
  if (path === "/portal/admin" || path.startsWith("/portal/admin/")) return true;
  if (path === "/portal" || path.startsWith("/portal/")) return false;
  // Storage routes perform their own bearer/ownership checks. Public object
  // reads are intentionally public; private operations are not staff-wide.
  if (path === "/storage" || path.startsWith("/storage/")) return false;
  if (publicStaffAuthentication.has(`${verb} ${path}`)) return false;
  if (isPublicSupportRoute(verb, path)) return false;
  if ((verb === "GET" && (path === "/health" || path === "/healthz"))) return false;

  // These paths are known staff operations embedded in otherwise-public shop
  // traffic. Protect them independently instead of exempting all /shop APIs.
  if (path === "/shop/admin" || path.startsWith("/shop/admin/")) return true;
  if (path === "/shop/team-members") return true;
  if (path === "/shop/team-members/upload-photo") return true;
  if (path === "/shop/live-chat/sessions" || path.startsWith("/shop/live-chat/sessions/")) return true;
  if (path === "/shop/live-chat/system-prompt") return true;
  if (path === "/shop" || path.startsWith("/shop/")) {
    // Public product/catalog reads and customer shop authentication are left to
    // their existing route policies. Unknown shop writes are staff-only.
    if (verb === "GET" || verb === "HEAD") return false;
    if (publicShopWrites.has(`${verb} ${path}`)) return false;
    return true;
  }

  // The standalone chat API is staff-facing, including reads and writes.
  if (path === "/chat" || path.startsWith("/chat/")) return true;

  // The historical API is staff-operated unless one of the explicit public,
  // customer portal, or shop routes above applies.
  return true;
}

let historicalRouterPromise: Promise<{ default: import("express").IRouter }> | undefined;
let operationalJobsPromise: Promise<void> | undefined;
let operationalJobsTimer: ReturnType<typeof setInterval> | undefined;
let schedulerStop: (() => void) | undefined;
let socialSchedulersSync: (() => Promise<void>) | undefined;

async function stopOperationalAutomations(): Promise<void> {
  if (operationalJobsTimer) clearInterval(operationalJobsTimer);
  operationalJobsTimer = undefined;
  schedulerStop?.();
  if (socialSchedulersSync) {
    const social = await import("../routes/social-posts.js");
    social.stopSocialPostScheduler();
    social.stopKnowledgeBaseLinkedInScheduler();
  }
}

/**
 * Jobs are considered only after activation. The durable automation_enabled
 * setting is re-read periodically so administrators can change job choices
 * without restarting the staged API process.
 */
export async function reconcileOperationalAutomations(): Promise<void> {
  if (operationalJobsPromise) return operationalJobsPromise;
  operationalJobsPromise = (async () => {
    if (!(await installationIsActivated())) {
      await stopOperationalAutomations();
      return;
    }

    const scheduler = await import("../services/scheduler.js");
    const social = await import("../routes/social-posts.js");
    schedulerStop = scheduler.stopScheduler;
    socialSchedulersSync = social.syncSocialSchedulers;
    await scheduler.registerScheduler({ enabled: true, setupMode: false, activated: true });
    await social.syncSocialSchedulers();

    if (!operationalJobsTimer) {
      operationalJobsTimer = setInterval(() => {
        void reconcileOperationalAutomations().catch((error) => {
          console.error("[operational-access] Automation reconciliation failed:", error);
        });
      }, 30_000);
      operationalJobsTimer.unref();
    }
  })().finally(() => {
    operationalJobsPromise = undefined;
  });
  return operationalJobsPromise;
}

async function installationIsActivated(): Promise<boolean> {
  const [row] = await db.select({ value: settingsTable.value })
    .from(settingsTable)
    .where(eq(settingsTable.key, "installation_activated"));
  return row?.value === "true";
}

export const operationalAccess: RequestHandler = async (request, response, next) => {
  let activated: boolean;
  try {
    activated = await installationIsActivated();
  } catch {
    response.status(503).json({ error: "Installation state is unavailable; operational routes are denied." });
    return;
  }

  if (!activated) {
    await stopOperationalAutomations();
    response.status(423).json({ error: "Operational routes are unavailable until local installation activation." });
    return;
  }

  try {
    await reconcileOperationalAutomations();
    // Neither the historical route tree nor its route/service imports are
    // evaluated in setup-only mode.
    historicalRouterPromise ??= import("../routes/index.js");
    const { default: historicalRouter } = await historicalRouterPromise;

    if (requiresStaffAuthorization(request.method, request.path)) {
      const { staffAuthorization } = await import("../routes/staff-auth.js");
      let authorization: { authenticated: boolean; admin: boolean };
      try {
        authorization = await staffAuthorization(request);
      } catch {
        response.status(503).json({ error: "Staff authorization state is unavailable." });
        return;
      }
      if (!authorization.authenticated) {
        response.status(401).json({ error: "Staff authentication required." });
        return;
      }
    }

    historicalRouter(request, response, next);
  } catch {
    response.status(503).json({ error: "Operational routes could not be loaded safely." });
  }
};