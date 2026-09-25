import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Circle, Loader2, LockKeyhole, ShieldCheck, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const API_BASE = "/api";
const BUSINESS_SAVED_KEY = "installation_business_saved";
const BUSINESS_DRAFT_KEY = "installation_business_draft";

export type SetupStatus = {
  setupMode: boolean;
  activated: boolean;
  administratorConfigured: boolean;
  integrations: Array<{
    id: string;
    name: string;
    purpose: string;
    optional: boolean;
    status: "AVAILABLE" | "NOT_CONFIGURED" | "CONNECTED" | "ERROR" | "DISABLED";
  }>;
  automations: Array<{
    id: string;
    name: string;
    purpose: string;
    enabled: boolean;
    dependenciesReady: boolean;
  }>;
  requiredSecrets: Array<{ handle: string; configured: boolean }>;
};

type Props = {
  status: SetupStatus;
  onRefresh: () => Promise<void>;
};

type BusinessForm = {
  name: string;
  tradingName: string;
  website: string;
  email: string;
  phone: string;
  address: string;
  logoUrl: string;
};

const emptyBusiness: BusinessForm = {
  name: "",
  tradingName: "",
  website: "",
  email: "",
  phone: "",
  address: "",
  logoUrl: "",
};

function readBusinessDraft(): BusinessForm {
  try {
    const value = sessionStorage.getItem(BUSINESS_DRAFT_KEY);
    return value ? { ...emptyBusiness, ...JSON.parse(value) } : emptyBusiness;
  } catch {
    return emptyBusiness;
  }
}

function statusLabel(value: string) {
  switch (value) {
    case "AVAILABLE": return "Ready";
    case "CONNECTED": return "Connected";
    case "ERROR": return "Needs attention";
    case "DISABLED": return "Disabled";
    default: return "Not configured";
  }
}

async function responseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return typeof body.error === "string" ? body.error : `Setup request failed (${response.status}). Please try again.`;
}

export default function InstallationSetup({ status, onRefresh }: Props) {
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [business, setBusiness] = useState<BusinessForm>(readBusinessDraft);
  const [setupToken, setSetupToken] = useState("");
  const [administratorCreated, setAdministratorCreated] = useState(status.administratorConfigured);
  const [businessSaved, setBusinessSaved] = useState(() => sessionStorage.getItem(BUSINESS_SAVED_KEY) === "true");
  const [busy, setBusy] = useState<"admin" | "business" | "activate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setAdministratorCreated(status.administratorConfigured);
  }, [status.administratorConfigured]);

  useEffect(() => {
    // Remove any setup session persisted by an older client version. The current
    // bootstrap authorization stays only in this component's memory.
    sessionStorage.removeItem("installation_setup_token");
  }, []);

  useEffect(() => {
    sessionStorage.setItem(BUSINESS_DRAFT_KEY, JSON.stringify(business));
  }, [business]);

  const canContinueBusiness = administratorCreated && setupToken.length > 0;

  async function createAdministrator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (adminPassword.length < 12) {
      setError("Choose a password with at least 12 characters.");
      return;
    }
    if (!administratorCreated && adminPassword !== confirmPassword) {
      setError("The administrator passwords do not match.");
      return;
    }
    setBusy("admin");
    try {
      const response = await fetch(`${API_BASE}/setup/admin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Setup-Bootstrap-Token": bootstrapToken,
        },
        body: JSON.stringify({ name: adminName, email: adminEmail, password: adminPassword }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const result = await response.json() as { token?: string; administrator?: { email?: string } };
      if (!result.token) throw new Error("The server created the administrator but did not return a setup session. Contact your installation administrator.");
      sessionStorage.removeItem(BUSINESS_SAVED_KEY);
      setSetupToken(result.token);
      setAdministratorCreated(true);
      setBusiness((current) => ({ ...current, email: current.email || result.administrator?.email || "" }));
      setBootstrapToken("");
      setAdminPassword("");
      setConfirmPassword("");
      setNotice("Administrator created. Continue with your business details.");
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the administrator. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function saveBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!business.name.trim()) {
      setError("Enter your business name before continuing.");
      return;
    }
    setBusy("business");
    try {
      const response = await fetch(`${API_BASE}/setup/business`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${setupToken}`,
        },
        body: JSON.stringify({
          name: business.name,
          tradingName: business.tradingName,
          website: business.website,
          email: business.email,
          phone: business.phone,
          address: business.address,
          logoUrl: business.logoUrl,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      sessionStorage.setItem(BUSINESS_SAVED_KEY, "true");
      setBusinessSaved(true);
      setNotice("Business details saved. Review the server readiness statuses before requesting activation.");
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save business details. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function requestActivation() {
    setError(null);
    setNotice(null);
    setBusy("activate");
    try {
      const response = await fetch(`${API_BASE}/setup/activate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${setupToken}` },
      });
      if (!response.ok) throw new Error(await responseError(response));
      sessionStorage.removeItem(BUSINESS_SAVED_KEY);
      sessionStorage.removeItem(BUSINESS_DRAFT_KEY);
      setNotice("Installation activated. Refreshing setup status…");
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not activate the installation. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  function updateBusiness(key: keyof BusinessForm, value: string) {
    setBusiness((current) => ({ ...current, [key]: value }));
  }

  const missingSetupToken = administratorCreated && !setupToken;

  return (
    <main className="min-h-screen bg-[#0f172a] px-4 py-8 text-white sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-8 flex items-center gap-3 border-b border-white/10 pb-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500/20">
            <Store className="h-5 w-5 text-indigo-300" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-300">Order System</p>
            <h1 className="text-xl font-bold sm:text-2xl">First-run setup</h1>
          </div>
          <span className="ml-auto hidden items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 sm:inline-flex">
            <LockKeyhole className="h-3.5 w-3.5" /> Secure installation
          </span>
        </header>

        <div className="mb-7 max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Set up your workspace</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
            Create the first administrator, add your business identity, and review which server integrations are ready.
            Integration credentials are managed securely in deployment secrets, not entered here.
          </p>
        </div>

        {(error || notice) && (
          <div className={`mb-6 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${error ? "border-red-400/30 bg-red-500/10 text-red-200" : "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"}`} role={error ? "alert" : "status"}>
            {error ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{error ?? notice}</span>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
          <section className="space-y-6">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-7">
              <div className="mb-6 flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-sm font-bold text-indigo-200">1</div>
                <div>
                  <h3 className="text-lg font-semibold">Administrator account</h3>
                  <p className="mt-1 text-sm text-slate-400">Create the account that will manage this installation.</p>
                </div>
                {administratorCreated && <CheckCircle2 className="ml-auto h-5 w-5 text-emerald-400" aria-label="Administrator created" />}
              </div>

              {!administratorCreated ? (
                <form onSubmit={createAdministrator} className="space-y-4">
                  <div className="rounded-xl border border-indigo-400/20 bg-indigo-500/5 px-4 py-3 text-xs leading-5 text-indigo-100/80">
                    The one-time installation bootstrap token authorises creation of the first administrator. It is not an integration credential and is used only for this request.
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-300">Administrator name</Label>
                    <Input required autoComplete="name" value={adminName} onChange={(event) => setAdminName(event.target.value)} className="border-white/15 bg-white/5 text-white placeholder:text-slate-500 focus:border-indigo-400" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-300">Administrator email</Label>
                    <Input required type="email" autoComplete="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} className="border-white/15 bg-white/5 text-white placeholder:text-slate-500 focus:border-indigo-400" />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-slate-300">Password</Label>
                      <Input required type="password" minLength={12} autoComplete="new-password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} className="border-white/15 bg-white/5 text-white placeholder:text-slate-500 focus:border-indigo-400" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-slate-300">Confirm password</Label>
                      <Input required type="password" minLength={12} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="border-white/15 bg-white/5 text-white placeholder:text-slate-500 focus:border-indigo-400" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-300">One-time setup authorization token</Label>
                    <Input required type="password" autoComplete="off" value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} className="border-white/15 bg-white/5 font-mono text-white placeholder:text-slate-500 focus:border-indigo-400" />
                    <p className="text-xs leading-5 text-slate-500">Ask the person deploying this installation for its token if it is not available to you. The token is not saved in the browser.</p>
                  </div>
                  <Button type="submit" disabled={busy !== null} className="w-full bg-indigo-600 font-semibold text-white hover:bg-indigo-500 sm:w-auto">
                    {busy === "admin" ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating account…</> : "Create administrator"}
                  </Button>
                </form>
              ) : missingSetupToken ? (
                <form onSubmit={createAdministrator} className="space-y-4">
                  <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">
                    The temporary setup session is not stored in the browser. Re-enter the bootstrap token and first administrator credentials to resume setup.
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-300">Administrator name</Label>
                    <Input required autoComplete="name" value={adminName} onChange={(event) => setAdminName(event.target.value)} className="border-white/15 bg-white/5 text-white placeholder:text-slate-500 focus:border-indigo-400" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-300">Administrator email</Label>
                    <Input required type="email" autoComplete="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} className="border-white/15 bg-white/5 text-white placeholder:text-slate-500 focus:border-indigo-400" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-300">Administrator password</Label>
                    <Input required type="password" minLength={12} autoComplete="current-password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} className="border-white/15 bg-white/5 text-white placeholder:text-slate-500 focus:border-indigo-400" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-300">One-time setup authorization token</Label>
                    <Input required type="password" autoComplete="off" value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} className="border-white/15 bg-white/5 font-mono text-white placeholder:text-slate-500 focus:border-indigo-400" />
                  </div>
                  <Button type="submit" disabled={busy !== null} className="w-full bg-indigo-600 font-semibold text-white hover:bg-indigo-500 sm:w-auto">
                    {busy === "admin" ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Resuming setup…</> : "Resume setup"}
                  </Button>
                </form>
              ) : (
                <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-100">
                  <div className="flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4" /> First administrator is ready</div>
                  <p className="mt-1 text-xs text-emerald-100/70">The temporary setup session is held only for this browser tab session.</p>
                </div>
              )}
            </div>

            <div className={`rounded-2xl border p-5 sm:p-7 ${canContinueBusiness ? "border-white/10 bg-white/[0.04]" : "border-white/5 bg-white/[0.02] opacity-60"}`}>
              <div className="mb-6 flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-sm font-bold text-indigo-200">2</div>
                <div>
                  <h3 className="text-lg font-semibold">Business details</h3>
                  <p className="mt-1 text-sm text-slate-400">These details identify your business in the system.</p>
                </div>
                {businessSaved && <CheckCircle2 className="ml-auto h-5 w-5 text-emerald-400" aria-label="Business details saved" />}
              </div>
              {canContinueBusiness ? (
                <form onSubmit={saveBusiness} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-slate-300">Business name</Label>
                    <Input required value={business.name} onChange={(event) => updateBusiness("name", event.target.value)} className="border-white/15 bg-white/5 text-white placeholder:text-slate-500 focus:border-indigo-400" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-300">Trading name <span className="font-normal text-slate-500">Optional</span></Label>
                    <Input value={business.tradingName} onChange={(event) => updateBusiness("tradingName", event.target.value)} className="border-white/15 bg-white/5 text-white placeholder:text-slate-500 focus:border-indigo-400" />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-slate-300">Contact email</Label>
                      <Input type="email" autoComplete="email" value={business.email} onChange={(event) => updateBusiness("email", event.target.value)} className="border-white/15 bg-white/5 text-white placeholder:text-slate-500 focus:border-indigo-400" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-slate-300">Contact phone</Label>
                      <Input type="tel" autoComplete="tel" value={business.phone} onChange={(event) => updateBusiness("phone", event.target.value)} className="border-white/15 bg-white/5 text-white placeholder:text-slate-500 focus:border-indigo-400" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-300">Website <span className="font-normal text-slate-500">Optional</span></Label>
                    <Input type="url" placeholder="https://" value={business.website} onChange={(event) => updateBusiness("website", event.target.value)} className="border-white/15 bg-white/5 text-white placeholder:text-slate-500 focus:border-indigo-400" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-300">Business address <span className="font-normal text-slate-500">Optional</span></Label>
                    <Input autoComplete="street-address" value={business.address} onChange={(event) => updateBusiness("address", event.target.value)} className="border-white/15 bg-white/5 text-white placeholder:text-slate-500 focus:border-indigo-400" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-300">Logo URL <span className="font-normal text-slate-500">Optional</span></Label>
                    <Input type="url" placeholder="https://" value={business.logoUrl} onChange={(event) => updateBusiness("logoUrl", event.target.value)} className="border-white/15 bg-white/5 text-white placeholder:text-slate-500 focus:border-indigo-400" />
                  </div>
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <Button type="submit" disabled={busy !== null} className="bg-indigo-600 font-semibold text-white hover:bg-indigo-500">
                      {busy === "business" ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : businessSaved ? "Save business details" : "Save business details"}
                    </Button>
                    {businessSaved && (
                      <Button type="button" variant="outline" onClick={requestActivation} disabled={busy !== null} className="border-white/20 bg-white/5 text-white hover:bg-white/10">
                        {busy === "activate" ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Checking readiness…</> : "Request activation"}
                      </Button>
                    )}
                  </div>
                </form>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-slate-500">
                  <Circle className="h-4 w-4" /> Create the administrator to unlock business details.
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-6">
            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">Integration status</h3>
                  <p className="mt-1 text-xs text-slate-400">Read from server configuration</p>
                </div>
              </div>
              <div className="space-y-2.5">
                {status.integrations.map((integration) => {
                  const ready = integration.status === "AVAILABLE" || integration.status === "CONNECTED";
                  return (
                    <div key={integration.id} className="rounded-xl border border-white/10 bg-[#0f172a]/50 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium">{integration.name}</p>
                        <span className={`shrink-0 text-[11px] font-semibold ${ready ? "text-emerald-300" : integration.status === "ERROR" ? "text-amber-300" : "text-slate-400"}`}>
                          {statusLabel(integration.status)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{integration.purpose}</p>
                    </div>
                  );
                })}
                {status.integrations.length === 0 && <p className="text-sm text-slate-400">No integrations are registered.</p>}
              </div>
              <p className="mt-4 text-xs leading-5 text-slate-500">
                To connect an integration, add its credentials in the deployment secrets manager. Never paste them into this setup form.
              </p>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
              <h3 className="font-semibold">Server readiness</h3>
              <p className="mb-4 mt-1 text-xs text-slate-400">Required deployment settings (values are never shown).</p>
              <div className="space-y-2">
                {status.requiredSecrets.map((secret) => (
                  <div key={secret.handle} className="flex items-center justify-between gap-3 text-xs">
                    <code className="break-all text-slate-400">{secret.handle}</code>
                    <span className={`shrink-0 ${secret.configured ? "text-emerald-300" : "text-amber-300"}`}>
                      {secret.configured ? "Configured" : "Missing"}
                    </span>
                  </div>
                ))}
                {status.requiredSecrets.length === 0 && <p className="text-xs text-slate-500">No required server settings were reported.</p>}
              </div>
            </section>

            {status.automations.length > 0 && (
              <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
                <h3 className="font-semibold">Automation readiness</h3>
                <p className="mb-4 mt-1 text-xs text-slate-400">Automations stay off until configured and enabled.</p>
                <div className="space-y-3">
                  {status.automations.map((automation) => (
                    <div key={automation.id} className="flex items-start justify-between gap-3 text-xs">
                      <div>
                        <p className="font-medium text-slate-200">{automation.name}</p>
                        <p className="mt-1 text-slate-500">{automation.purpose}</p>
                      </div>
                      <span className={`shrink-0 ${automation.enabled ? "text-emerald-300" : "text-slate-500"}`}>
                        {automation.enabled ? "Enabled" : automation.dependenciesReady ? "Off" : "Waiting"}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </aside>
        </div>

        <footer className="mt-8 border-t border-white/10 pt-5 text-xs leading-5 text-slate-500">
          The order system remains unavailable until the installation server confirms activation. If activation is blocked, review server readiness and contact the installation administrator.
        </footer>
      </div>
    </main>
  );
}