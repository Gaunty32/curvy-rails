import { z } from "zod";

export const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "").replace(/\/customer-portal$/, "") + "/api";

// Thrown by apiFetch on non-2xx responses. Carries the full parsed response body (when JSON) so
// callers can branch on structured error payloads, not just the display message.
export class ApiError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch(path: string, opts?: RequestInit) {
  const token = localStorage.getItem("portal_token");
  const res = await fetch(API_BASE + path, {
    ...opts,
    headers: { 
      "Content-Type": "application/json", 
      ...(token ? { Authorization: "Bearer " + token } : {}), 
      ...(opts?.headers ?? {}) 
    },
  });

  if (res.status === 403) {
    let body: any = null;
    try {
      body = await res.clone().json();
    } catch {}
    if (body?.error === "PORTAL_ACCESS_SUSPENDED") {
      localStorage.removeItem("portal_token");
      const suspendedUrl = import.meta.env.BASE_URL + "login?suspended=1";
      if (window.location.pathname + window.location.search !== suspendedUrl) {
        window.location.href = suspendedUrl;
      }
      throw new ApiError(body.message ?? "PORTAL ACCESS SUSPENDED. ACCOUNT OVERDUE.", res.status, body);
    }
  }

  if (res.status === 401) {
    localStorage.removeItem("portal_token");
    // Don't redirect if we're already on a public auth page — doing so would
    // navigate away from /accept-invite before the magic-link token is consumed,
    // causing an infinite email loop.
    const publicPages = ["accept-invite", "login", "select-business", "preview-login", "orders/new"];
    const onPublicPage = publicPages.some((p) => window.location.pathname.includes(p));
    if (!onPublicPage) {
      const returnTo = window.location.pathname + window.location.search;
      window.location.href = import.meta.env.BASE_URL + "login?returnTo=" + encodeURIComponent(returnTo);
    }
  }

  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    let body: any = null;
    try {
      body = await res.json();
      if (body?.error) msg = body.error;
    } catch {}
    throw new ApiError(msg, res.status, body);
  }

  return res.json();
}
