const TOKEN_KEY = "sbs_staff_token";

export function getStaffToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStaffToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStaffToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isStaffAuthenticated(): boolean {
  const token = getStaffToken();
  if (!token) return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1]));
    return (
      payload.role === "staff" &&
      typeof payload.exp === "number" &&
      payload.exp > Date.now() / 1000
    );
  } catch {
    return false;
  }
}

export interface StaffJwtPayload {
  role: string;
  email?: string | null;
  name?: string | null;
  exp?: number;
}

export function getStaffJwtPayload(): StaffJwtPayload | null {
  const token = getStaffToken();
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1])) as StaffJwtPayload;
  } catch {
    return null;
  }
}

// Returns Authorization header value for secure API calls
export function staffAuthHeader(): Record<string, string> {
  const token = getStaffToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
