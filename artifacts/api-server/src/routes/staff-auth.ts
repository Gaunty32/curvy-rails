import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { z } from "zod";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendEmail } from "../services/email.js";

const router = Router();

const JWT_SECRET: string = process.env.PORTAL_JWT_SECRET ?? "";
if (JWT_SECRET.length < 32) {
  throw new Error("PORTAL_JWT_SECRET must be configured with at least 32 characters.");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]!);
}

async function getPasswordHash(): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, "staff_password_hash"));
  return row?.value ?? null;
}

async function getSettingValue(key: string): Promise<string | null> {
  const [row] = await db.select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}

// ── Staff accounts ───────────────────────────────────────────────────────────

interface StaffAccount {
  name: string;
  email: string;
  is_superuser?: boolean;
  is_active?: boolean;
  active?: boolean;
  allowed_nav?: string[] | null; // null = all access, array = restricted
  avatar_url?: string | null;
}

async function getStaffAccounts(): Promise<StaffAccount[]> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, "staff_accounts"));
  if (!row?.value) return [];
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((account: unknown): account is StaffAccount => {
      if (!account || typeof account !== "object") return false;
      const candidate = account as Record<string, unknown>;
      return typeof candidate.name === "string"
        && typeof candidate.email === "string"
        && candidate.email.includes("@");
    });
  } catch { return []; }
}

async function saveStaffAccounts(accounts: StaffAccount[]): Promise<void> {
  await db.insert(settingsTable)
    .values({ key: "staff_accounts", value: JSON.stringify(accounts) })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: JSON.stringify(accounts), updatedAt: new Date() } });
}

function isActiveAccount(account: StaffAccount): boolean {
  return account.is_active !== false && account.active !== false;
}

async function getAccountPasswordHash(email: string): Promise<string | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const firstAdminEmail = await getSettingValue("first_admin_email");
  if (firstAdminEmail?.trim().toLowerCase() === normalizedEmail) {
    return getSettingValue("first_admin_password_hash");
  }
  try {
    const hashes = JSON.parse((await getSettingValue("staff_account_password_hashes")) ?? "{}") as Record<string, unknown>;
    const hash = hashes[normalizedEmail];
    return typeof hash === "string" ? hash : null;
  } catch {
    return null;
  }
}

async function setAccountPasswordHash(email: string, hash: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const firstAdminEmail = await getSettingValue("first_admin_email");
  if (firstAdminEmail?.trim().toLowerCase() === normalizedEmail) {
    await db.insert(settingsTable)
      .values({ key: "first_admin_password_hash", value: hash })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: hash, updatedAt: new Date() } });
    return;
  }
  let hashes: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse((await getSettingValue("staff_account_password_hashes")) ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      hashes = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    }
  } catch {
    hashes = {};
  }
  hashes[normalizedEmail] = hash;
  await db.insert(settingsTable)
    .values({ key: "staff_account_password_hashes", value: JSON.stringify(hashes) })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: JSON.stringify(hashes), updatedAt: new Date() } });
}

async function renameAccountPassword(email: string, updatedEmail: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedUpdatedEmail = updatedEmail.trim().toLowerCase();
  if ((await getSettingValue("first_admin_email"))?.trim().toLowerCase() === normalizedEmail) {
    await db.insert(settingsTable)
      .values({ key: "first_admin_email", value: normalizedUpdatedEmail })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: normalizedUpdatedEmail, updatedAt: new Date() } });
    return;
  }
  let hashes: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse((await getSettingValue("staff_account_password_hashes")) ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      hashes = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    }
  } catch {
    hashes = {};
  }
  if (hashes[normalizedEmail]) {
    hashes[normalizedUpdatedEmail] = hashes[normalizedEmail];
    delete hashes[normalizedEmail];
    await db.insert(settingsTable)
      .values({ key: "staff_account_password_hashes", value: JSON.stringify(hashes) })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: JSON.stringify(hashes), updatedAt: new Date() } });
  }
}

// Decode JWT from Authorization header and return payload (or null if invalid)
export function decodeStaffJwt(req: import("express").Request): Record<string, unknown> | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const verified = jwt.verify(authHeader.slice(7), JWT_SECRET, { algorithms: ["HS256"] });
    if (!verified || typeof verified !== "object") return null;
    const payload = verified as Record<string, unknown>;
    // Setup sessions are deliberately confined to /setup routes. They share the
    // signing key, so the setup claim must never be treated as an operational role.
    if (payload.role !== "staff" || payload.setup === true || typeof payload.exp !== "number") return null;
    if (payload.email !== undefined && typeof payload.email !== "string") return null;
    return payload;
  } catch { return null; }
}

export async function staffAuthorization(req: import("express").Request): Promise<{ authenticated: boolean; admin: boolean }> {
  const payload = decodeStaffJwt(req);
  if (!payload) return { authenticated: false, admin: false };
  // Legacy shared-password sessions remain ordinary staff sessions, never admins.
  if (typeof payload.email !== "string") return { authenticated: true, admin: false };
  const accounts = await getStaffAccounts();
  const account = accounts.find(a => a.email.trim().toLowerCase() === (payload.email as string).trim().toLowerCase());
  if (!account || !isActiveAccount(account)) return { authenticated: false, admin: false };
  return { authenticated: true, admin: account.is_superuser === true };
}

async function isSuperuser(req: import("express").Request): Promise<boolean> {
  return (await staffAuthorization(req)).admin;
}

router.get("/auth/staff/accounts", async (req, res): Promise<void> => {
  if (!(await staffAuthorization(req)).authenticated) { res.status(401).json({ error: "Staff authentication required" }); return; }
  const accounts = await getStaffAccounts();
  res.json({ accounts });
});

router.post("/auth/staff/accounts", async (req, res): Promise<void> => {
  if (!await isSuperuser(req)) { res.status(403).json({ error: "Administrator access required" }); return; }
  const { name, email } = req.body ?? {};
  if (!name || typeof name !== "string" || !email || typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "Name and valid email required" });
    return;
  }
  const normEmail = email.trim().toLowerCase();
  if (!name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normEmail)) {
    res.status(400).json({ error: "Name and valid email required" }); return;
  }
  const accounts = await getStaffAccounts();
  if (accounts.some(a => a.email === normEmail)) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }
  accounts.push({ name: name.trim(), email: normEmail, is_superuser: false, allowed_nav: null });
  await saveStaffAccounts(accounts);
  res.json({ ok: true, accounts });
});

router.patch("/auth/staff/accounts/:email", async (req, res): Promise<void> => {
  if (!await isSuperuser(req)) { res.status(403).json({ error: "Administrator access required" }); return; }
  const normEmail = decodeURIComponent(req.params.email).trim().toLowerCase();
  const accounts = await getStaffAccounts();
  const idx = accounts.findIndex(a => a.email === normEmail);
  if (idx === -1) { res.status(404).json({ error: "Account not found" }); return; }
  const body = req.body ?? {};
  if (typeof body.name === "string" && body.name.trim()) accounts[idx].name = body.name.trim();
  if (typeof body.email === "string" && body.email.includes("@")) {
    const updatedEmail = body.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(updatedEmail)) {
      res.status(400).json({ error: "Valid email required" }); return;
    }
    if (updatedEmail !== normEmail && accounts.some((account, accountIdx) => accountIdx !== idx && account.email === updatedEmail)) {
      res.status(409).json({ error: "An account with this email already exists" }); return;
    }
    accounts[idx].email = updatedEmail;
    await renameAccountPassword(normEmail, updatedEmail);
  }
  if (typeof body.is_superuser === "boolean") accounts[idx].is_superuser = body.is_superuser;
  if ("allowed_nav" in body) accounts[idx].allowed_nav = Array.isArray(body.allowed_nav) ? body.allowed_nav : null;
  if ("avatar_url" in body) accounts[idx].avatar_url = typeof body.avatar_url === "string" && body.avatar_url ? body.avatar_url : null;
  if (!accounts.some(account => account.is_superuser)) {
    res.status(409).json({ error: "At least one administrator account must remain" }); return;
  }
  await saveStaffAccounts(accounts);
  res.json({ ok: true, account: accounts[idx] });
});

// Self-service: the logged-in staff member updates their own profile photo.
// (Distinct from the admin PATCH above, which requires superuser access.)
router.patch("/auth/staff/me/avatar", async (req, res): Promise<void> => {
  const payload = decodeStaffJwt(req);
  if (!payload || !(await staffAuthorization(req)).authenticated) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!payload.email) { res.status(400).json({ error: "Generic password logins don't have an individual profile" }); return; }

  const { avatar_url } = req.body ?? {};
  if (avatar_url !== null && typeof avatar_url !== "string") {
    res.status(400).json({ error: "avatar_url must be a string or null" }); return;
  }

  const accounts = await getStaffAccounts();
  const idx = accounts.findIndex(a => a.email === (payload.email as string));
  if (idx === -1) { res.status(404).json({ error: "Account not found" }); return; }

  accounts[idx].avatar_url = avatar_url || null;
  await saveStaffAccounts(accounts);
  res.json({ ok: true, avatar_url: accounts[idx].avatar_url });
});

router.delete("/auth/staff/accounts/:email", async (req, res): Promise<void> => {
  if (!await isSuperuser(req)) { res.status(403).json({ error: "Administrator access required" }); return; }
  const normEmail = decodeURIComponent(req.params.email).trim().toLowerCase();
  const accounts = await getStaffAccounts();
  const remaining = accounts.filter(a => a.email !== normEmail);
  if (remaining.length === accounts.length) { res.status(404).json({ error: "Account not found" }); return; }
  if (!remaining.some(account => account.is_superuser)) { res.status(409).json({ error: "At least one administrator account must remain" }); return; }
  await saveStaffAccounts(remaining);
  res.json({ ok: true });
});

// ── /auth/staff/me — return current user's profile ───────────────────────────
router.get("/auth/staff/me", async (req, res): Promise<void> => {
  const payload = decodeStaffJwt(req);
  if (!payload || !(await staffAuthorization(req)).authenticated) { res.status(401).json({ error: "Not authenticated" }); return; }
  // Legacy password login has no individual account and is never an administrator.
  if (!payload.email) {
    res.json({ name: null, email: null, is_superuser: false, allowed_nav: [], avatar_url: null });
    return;
  }
  const accounts = await getStaffAccounts();
  const account = accounts.find(a => a.email === (payload.email as string));
  if (!account) {
    // Account deleted since login — still valid JWT, give read-only access
    res.json({ name: payload.name ?? null, email: payload.email, is_superuser: false, allowed_nav: [], avatar_url: null });
    return;
  }
  res.json({
    name: account.name,
    email: account.email,
    is_superuser: !!account.is_superuser,
    allowed_nav: account.allowed_nav ?? null,
    avatar_url: account.avatar_url ?? null,
  });
});

// ── Email OTP login ──────────────────────────────────────────────────────────

router.post("/auth/staff/request-otp", async (req, res): Promise<void> => {
  const { email } = req.body ?? {};
  if (!email || typeof email !== "string") { res.status(400).json({ error: "Email required" }); return; }
  const normEmail = email.trim().toLowerCase();
  const accounts = await getStaffAccounts();

  if (!accounts.some(a => a.email === normEmail && isActiveAccount(a))) {
    res.json({ ok: true });
    return;
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = crypto.createHash("sha256").update(code).digest("hex");
  const expiresAt = Date.now() + 10 * 60 * 1000;

  const otpKey = `staff_otp_${normEmail}`;
  await db.insert(settingsTable)
    .values({ key: otpKey, value: JSON.stringify({ codeHash, expiresAt }) })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: JSON.stringify({ codeHash, expiresAt }), updatedAt: new Date() } });

  const firstName = accounts.find(a => a.email === normEmail)?.name.split(" ")[0] ?? "there";

  const emailResult = await sendEmail({
    to: normEmail,
    subject: "Your login code",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.1);">
        <tr><td style="background:#1e293b;padding:20px 28px;">
          <p style="margin:0;color:#ffffff;font-size:17px;font-weight:700;">Staff sign-in</p>
          <p style="margin:4px 0 0;color:#94a3b8;font-size:12px;">Order Management System</p>
        </td></tr>
        <tr><td style="padding:28px;">
          <p style="margin:0 0 16px;font-size:15px;color:#374151;">Hi ${escapeHtml(firstName)},</p>
          <p style="margin:0 0 24px;font-size:14px;color:#374151;line-height:1.6;">Here is your one-time login code for the order system:</p>
          <div style="text-align:center;margin:0 0 24px;">
            <span style="display:inline-block;background:#1e293b;color:#ffffff;font-size:32px;font-weight:700;letter-spacing:8px;padding:16px 28px;border-radius:8px;">${code}</span>
          </div>
          <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">This code expires in <strong>10 minutes</strong>.</p>
          <p style="margin:0;font-size:13px;color:#6b7280;">If you didn't request this, you can safely ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
    text: `Hi ${firstName},\n\nYour order system login code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, you can safely ignore this email.`,
  });

  if (!emailResult.sent) {
    console.error(`[auth] OTP email failed for ${normEmail}: ${emailResult.error ?? "unknown error"}`);
    res.status(500).json({ error: "Failed to send login code email. Please contact your administrator." });
    return;
  }

  console.log(`[auth] OTP email sent to ${normEmail} via ${emailResult.provider ?? "unknown"}, messageId=${emailResult.messageId ?? "n/a"}`);
  res.json({ ok: true });
});

router.post("/auth/staff/verify-otp", async (req, res): Promise<void> => {
  const { email, code } = req.body ?? {};
  if (!email || !code || typeof email !== "string" || typeof code !== "string") {
    res.status(400).json({ error: "Email and code required" }); return;
  }
  const normEmail = email.trim().toLowerCase();
  const otpKey = `staff_otp_${normEmail}`;
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, otpKey));

  if (!row?.value) { res.status(401).json({ error: "Invalid or expired code" }); return; }

  let otpData: { codeHash: string; expiresAt: number };
  try { otpData = JSON.parse(row.value); }
  catch { res.status(401).json({ error: "Invalid or expired code" }); return; }

  if (Date.now() > otpData.expiresAt) {
    await db.delete(settingsTable).where(eq(settingsTable.key, otpKey));
    res.status(401).json({ error: "Code has expired — please request a new one" }); return;
  }

  const inputHash = crypto.createHash("sha256").update(code.trim()).digest("hex");
  if (inputHash !== otpData.codeHash) {
    res.status(401).json({ error: "Incorrect code — please check and try again" }); return;
  }

  await db.delete(settingsTable).where(eq(settingsTable.key, otpKey));
  const accounts = await getStaffAccounts();
  const account = accounts.find(a => a.email === normEmail && isActiveAccount(a));
  if (!account) { res.status(401).json({ error: "Invalid or expired code" }); return; }
  const token = jwt.sign(
    { role: "staff", email: normEmail, name: account?.name ?? null },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
  res.json({ token });
});

// ── Password auth ────────────────────────────────────────────────────────────

router.post("/auth/staff/login", async (req, res): Promise<void> => {
  const { email, password } = req.body ?? {};
  if (!password || typeof password !== "string") {
    res.status(400).json({ error: "Password required" }); return;
  }

  if (email !== undefined) {
    if (typeof email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      res.status(400).json({ error: "A valid account email is required" }); return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    const account = (await getStaffAccounts()).find((candidate) =>
      candidate.email.trim().toLowerCase() === normalizedEmail && isActiveAccount(candidate));
    const accountHash = account ? await getAccountPasswordHash(normalizedEmail) : null;
    if (!account || !accountHash || !(await bcrypt.compare(password, accountHash))) {
      res.status(401).json({ error: "Invalid email or password" }); return;
    }
    const token = jwt.sign(
      { role: "staff", setup: false, email: normalizedEmail, name: account.name },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({ token });
    return;
  }

  // Keep the historical shared-password flow for ordinary staff only. It does
  // not carry an email claim and therefore can never impersonate an account.
  const hash = await getPasswordHash();
  let valid = false;
  if (hash) {
    valid = await bcrypt.compare(password, hash);
  } else {
    valid = false;
  }

  if (!valid) { res.status(401).json({ error: "Incorrect password" }); return; }

  const token = jwt.sign({ role: "staff" }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, usingDefault: !hash });
});

router.get("/auth/staff/status", async (_req, res): Promise<void> => {
  const hash = await getPasswordHash();
  const firstAdminHash = await getSettingValue("first_admin_password_hash");
  res.json({ passwordConfigured: !!hash || !!firstAdminHash });
});

// Maya integration status is staff-readable; changing write access requires an administrator.
router.get("/auth/staff/maya/integration/status", async (req, res): Promise<void> => {
  if (!(await staffAuthorization(req)).authenticated) { res.status(401).json({ error: "Not authenticated" }); return; }
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, "maya_write_access_enabled"));
  res.json({
    apiEnabled: Boolean(process.env.MAYA_API_KEY),
    connection: process.env.MAYA_API_KEY ? "connected" : "not_configured",
    writeAccess: process.env.MAYA_WRITE_API_ENABLED === "true" && row?.value === "true",
    lastRequest: null,
    lastSuccessful: null,
    lastFailed: null,
    changesByMaya: null,
    awaitingApproval: null,
    webhook: { configured: false },
  });
});

router.patch("/auth/staff/maya/integration/write-access", async (req, res): Promise<void> => {
  const authorization = await staffAuthorization(req);
  if (!authorization.authenticated) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!authorization.admin) { res.status(403).json({ error: "Administrator access required" }); return; }
  const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "enabled boolean is required" }); return; }
  await db.insert(settingsTable)
    .values({ key: "maya_write_access_enabled", value: String(parsed.data.enabled) })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: String(parsed.data.enabled), updatedAt: new Date() } });
  res.json({
    writeAccess: process.env.MAYA_WRITE_API_ENABLED === "true" && parsed.data.enabled,
  });
});

router.post("/auth/staff/setup", async (_req, res): Promise<void> => {
  res.status(410).json({ error: "Initial administrator creation is available only through /setup/admin." });
});

router.post("/auth/staff/recover", async (_req, res): Promise<void> => {
  res.status(410).json({ error: "Password recovery cannot reset administrator setup; use an authenticated administrator session." });
});

router.post("/auth/staff/accounts/:email/password", async (req, res): Promise<void> => {
  if (!await isSuperuser(req)) { res.status(403).json({ error: "Administrator access required" }); return; }
  const normalizedEmail = decodeURIComponent(req.params.email).trim().toLowerCase();
  const { newPassword } = req.body ?? {};
  if (typeof newPassword !== "string" || newPassword.length < 12) {
    res.status(400).json({ error: "New password must be at least 12 characters" }); return;
  }
  const account = (await getStaffAccounts()).find((candidate) =>
    candidate.email.trim().toLowerCase() === normalizedEmail && isActiveAccount(candidate));
  if (!account) { res.status(404).json({ error: "Active staff account not found" }); return; }
  await setAccountPasswordHash(normalizedEmail, await bcrypt.hash(newPassword, 12));
  res.json({ ok: true });
});

router.post("/auth/staff/set-password", async (req, res): Promise<void> => {
  if (!await isSuperuser(req)) { res.status(403).json({ error: "Administrator access required" }); return; }
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== "string" || !currentPassword || typeof newPassword !== "string" || newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" }); return;
  }
  const hash = await getPasswordHash();
  let valid = false;
  if (hash) {
    valid = await bcrypt.compare(currentPassword, hash);
  } else {
    valid = false;
  }
  if (!valid) { res.status(401).json({ error: "Current password is incorrect" }); return; }
  const newHash = await bcrypt.hash(newPassword, 12);
  await db.insert(settingsTable)
    .values({ key: "staff_password_hash", value: newHash })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: newHash, updatedAt: new Date() } });
  res.json({ ok: true });
});

export default router;
