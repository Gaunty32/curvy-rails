export const DEMO_TOKEN_KEY = "sbs_demo_token";
export const DEMO_USER_KEY  = "sbs_demo_user";

const API_BASE = "/api";

export function getDemoToken(): string | null {
  try { return sessionStorage.getItem(DEMO_TOKEN_KEY); } catch { return null; }
}

export function setDemoSession(token: string, user: { firstName: string; company: string }) {
  try {
    sessionStorage.setItem(DEMO_TOKEN_KEY, token);
    sessionStorage.setItem(DEMO_USER_KEY, JSON.stringify(user));
  } catch {}
}

export function clearDemoSession() {
  try {
    sessionStorage.removeItem(DEMO_TOKEN_KEY);
    sessionStorage.removeItem(DEMO_USER_KEY);
  } catch {}
}

export function getDemoUser(): { firstName: string; company: string } | null {
  try {
    const raw = sessionStorage.getItem(DEMO_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function demoFetch(path: string, opts?: RequestInit) {
  const token = getDemoToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? "Request failed");
  }
  return res.json();
}

// ── masking utilities ──────────────────────────────────────────────────────────

function redactWord(word: string): string {
  if (word.length <= 1) return word;
  return word[0] + "●".repeat(Math.min(word.length - 1, 5));
}

export function maskName(name: string | null | undefined): string {
  if (!name?.trim()) return "●●●●●";
  return name.trim().split(/\s+/).map(redactWord).join(" ");
}

export function maskMoney(_amount: string | number | null | undefined): string {
  return "£**.00";
}

export function maskText(text: string | null | undefined, visibleChars = 2): string {
  if (!text?.trim()) return "●●●●●";
  const t = text.trim();
  if (t.length <= visibleChars) return t;
  return t.slice(0, visibleChars) + "●".repeat(Math.min(t.length - visibleChars, 6));
}
