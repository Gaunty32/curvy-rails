import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Loader2, Eye, EyeOff, ArrowLeft, KeyRound, ShieldCheck, Mail, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setStaffToken, isStaffAuthenticated } from "@/lib/staff-auth";
import { businessDisplayName, useBusinessConfig } from "@/lib/business-config";

const API_BASE = "/api";

type Mode = "loading" | "setup" | "login" | "recover" | "email-code" | "verify-code";

export default function StaffLogin() {
  const [, setLocation] = useLocation();
  const [mode, setMode]               = useState<Mode>("loading");
  const [password, setPassword]       = useState("");
  const [confirm, setConfirm]         = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [email, setEmail]             = useState("");
  const [code, setCode]               = useState("");
  const [showPass, setShowPass]       = useState(false);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [recovered, setRecovered]     = useState(false);
  const [codeSent, setCodeSent]       = useState(false);
  const codeInputRef                  = useRef<HTMLInputElement>(null);
  const business = useBusinessConfig();
  const displayName = businessDisplayName(business);

  useEffect(() => {
    if (isStaffAuthenticated()) { setLocation("/dashboard"); return; }
    fetch(`${API_BASE}/auth/staff/status`)
      .then(r => r.json())
      .then(data => setMode(data.passwordConfigured ? "login" : "setup"))
      .catch(() => setMode("login"));
  }, []);

  function switchMode(next: Mode) {
    setError(null);
    setPassword("");
    setConfirm("");
    setMode(next);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/staff/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(email.trim() ? { email: email.trim() } : {}), password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Login failed"); return; }
      setStaffToken(data.token);
      setLocation("/dashboard");
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally { setLoading(false); }
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) { setError("Passwords don't match"); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/staff/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Setup failed"); return; }
      setStaffToken(data.token);
      setLocation("/dashboard");
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally { setLoading(false); }
  }

  async function handleRecover(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/staff/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recoveryKey }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Recovery failed"); return; }
      setRecovered(true);
      setRecoveryKey("");
      setPassword("");
      setConfirm("");
      setMode("setup");
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally { setLoading(false); }
  }

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/staff/request-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to send login code. Please try again.");
        return;
      }
      setCodeSent(true);
      setCode("");
      setMode("verify-code");
      setTimeout(() => codeInputRef.current?.focus(), 100);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally { setLoading(false); }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/staff/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Invalid code"); return; }
      setStaffToken(data.token);
      setLocation("/dashboard");
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally { setLoading(false); }
  }

  if (mode === "loading") {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
      </div>
    );
  }

  const isEmailMode = mode === "email-code" || mode === "verify-code";

  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col">
      <header className="flex items-center gap-3 px-6 py-5 border-b border-white/10">
        <button
          onClick={() => {
            if (mode === "recover" || mode === "email-code" || mode === "verify-code") switchMode("login");
            else setLocation("/");
          }}
          className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      </header>

      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm space-y-6">

          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-500/20 mb-2">
              {isEmailMode
                ? <Mail className="w-7 h-7 text-indigo-400" />
                : (mode === "setup" || mode === "recover"
                  ? <KeyRound className="w-7 h-7 text-indigo-400" />
                  : <ShieldCheck className="w-7 h-7 text-indigo-400" />)}
            </div>
            <h1 className="text-white text-2xl font-bold">
              {mode === "setup" ? "Create your password"
                : mode === "recover" ? "Reset password"
                : mode === "email-code" ? "Sign in with email"
                : mode === "verify-code" ? "Check your email"
                : "Staff Login"}
            </h1>
            <p className="text-slate-400 text-sm">
              {mode === "setup" ? "Set a password to protect the order system."
                : mode === "recover" ? "Enter your recovery key to reset access."
                : mode === "email-code" ? "We'll send a one-time code to your email address."
                : mode === "verify-code" ? `We sent a 6-digit code to ${email}`
                : `${displayName} — Order System`}
            </p>
          </div>

          {/* Recovery success banner */}
          {recovered && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
              <p className="text-emerald-300 text-xs">Password cleared — set a new one below.</p>
            </div>
          )}

          {/* ── Setup form ── */}
          {mode === "setup" && (
            <form onSubmit={handleSetup} className="space-y-4">
              {!recovered && (
                <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-3">
                  <p className="text-indigo-300 text-xs leading-relaxed">
                     This is the first time the order system has been opened. Complete installation setup before staff access is enabled.
                  </p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-slate-300">New password</Label>
                <div className="relative">
                  <Input type={showPass ? "text" : "password"} placeholder="At least 8 characters"
                    value={password} onChange={e => setPassword(e.target.value)} autoFocus
                    className="bg-white/5 border-white/15 text-white placeholder:text-slate-500 pr-10 focus:border-indigo-500" />
                  <button type="button" onClick={() => setShowPass(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Confirm password</Label>
                <Input type="password" placeholder="Repeat your password" value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  className="bg-white/5 border-white/15 text-white placeholder:text-slate-500 focus:border-indigo-500" />
              </div>
              {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}
              <Button type="submit" disabled={loading || !password || !confirm}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Setting up…</> : "Create password & sign in"}
              </Button>
            </form>
          )}

          {/* ── Login form ── */}
          {mode === "login" && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-slate-300">Email address <span className="text-slate-500">(administrator account)</span></Label>
                <Input type="email" placeholder="you@example.com"
                  value={email} onChange={e => setEmail(e.target.value)}
                  className="bg-white/5 border-white/15 text-white placeholder:text-slate-500 focus:border-indigo-500" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Password</Label>
                <div className="relative">
                  <Input type={showPass ? "text" : "password"} placeholder={email.trim() ? "Enter your account password" : "Enter shared staff password"}
                    value={password} onChange={e => setPassword(e.target.value)} autoFocus
                    className="bg-white/5 border-white/15 text-white placeholder:text-slate-500 pr-10 focus:border-indigo-500" />
                  <button type="button" onClick={() => setShowPass(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-slate-500">Use your email and password for an individual account. Leave email blank only for the legacy shared staff login.</p>
              </div>
              {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}
              <Button type="submit" disabled={loading || !password}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Signing in…</> : "Sign in"}
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10" /></div>
                <div className="relative flex justify-center"><span className="bg-[#0f172a] px-3 text-xs text-slate-600">or</span></div>
              </div>

              <Button type="button" variant="outline"
                onClick={() => switchMode("email-code")}
                className="w-full border-white/15 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white gap-2">
                <Mail className="w-4 h-4" /> Sign in with email code
              </Button>
            </form>
          )}

          {/* ── Email code — request ── */}
          {mode === "email-code" && (
            <form onSubmit={handleRequestCode} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-slate-300">Your email address</Label>
                <Input type="email" placeholder="you@example.com"
                  value={email} onChange={e => setEmail(e.target.value)} autoFocus
                  className="bg-white/5 border-white/15 text-white placeholder:text-slate-500 focus:border-indigo-500" />
              </div>
              {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}
              <Button type="submit" disabled={loading || !email}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold gap-2">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Sending…</> : <><Mail className="w-4 h-4" />Send me a code</>}
              </Button>
              <button type="button" onClick={() => switchMode("login")}
                className="w-full text-center text-slate-500 hover:text-slate-300 text-xs transition-colors pt-1">
                Use password instead
              </button>
            </form>
          )}

          {/* ── Email code — verify ── */}
          {mode === "verify-code" && (
            <form onSubmit={handleVerifyCode} className="space-y-4">
              <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-3">
                <p className="text-indigo-300 text-xs leading-relaxed">
                  Enter the 6-digit code sent to <strong>{email}</strong>. It expires in 10 minutes.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Login code</Label>
                <Input
                  ref={codeInputRef}
                  type="text" inputMode="numeric" placeholder="000000"
                  value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  maxLength={6} autoComplete="one-time-code"
                  className="bg-white/5 border-white/15 text-white placeholder:text-slate-500 text-center text-2xl font-mono tracking-[0.5em] focus:border-indigo-500" />
              </div>
              {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}
              <Button type="submit" disabled={loading || code.length < 6}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Verifying…</> : "Sign in"}
              </Button>
              <button type="button" onClick={() => { setCodeSent(false); switchMode("email-code"); }}
                className="w-full text-center text-slate-500 hover:text-slate-300 text-xs transition-colors flex items-center justify-center gap-1.5 pt-1">
                <RotateCcw className="w-3 h-3" /> Resend code
              </button>
            </form>
          )}

          {/* ── Recovery form ── */}
          {mode === "recover" && (
            <form onSubmit={handleRecover} className="space-y-4">
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                <p className="text-amber-300 text-xs leading-relaxed">
                  Enter the recovery key from your Replit Secrets panel (<code className="bg-white/10 px-1 rounded">STAFF_RECOVERY_KEY</code>). This will clear your password so you can set a new one.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Recovery key</Label>
                <Input type="text" placeholder="Paste recovery key here" value={recoveryKey}
                  onChange={e => setRecoveryKey(e.target.value)} autoFocus
                  className="bg-white/5 border-white/15 text-white placeholder:text-slate-500 focus:border-amber-500 font-mono text-sm" />
              </div>
              {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}
              <Button type="submit" disabled={loading || !recoveryKey}
                className="w-full bg-amber-600 hover:bg-amber-500 text-white font-semibold">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Recovering…</> : "Reset my password"}
              </Button>
            </form>
          )}

        </div>
      </div>
    </div>
  );
}
