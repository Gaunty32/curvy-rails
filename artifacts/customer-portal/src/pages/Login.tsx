import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { usePublicConfig } from "@/lib/publicConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, X, Smartphone, Share, MoreVertical, MailCheck, ExternalLink } from "lucide-react";
import IosInstallBanner from "@/components/IosInstallBanner";

function MobileInstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState("");

  useEffect(() => {
    const hasMousePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const isWideEnough = window.innerWidth >= 768;
    if (hasMousePointer && isWideEnough) {
      setVisible(true);
      setUrl(window.location.href);
    }
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 w-80 shadow-2xl rounded-xl border border-border bg-white animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="flex items-start justify-between p-4 pb-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          <div className="bg-primary/10 rounded-lg p-1.5">
            <Smartphone className="w-4 h-4 text-primary" />
          </div>
          <span className="font-semibold text-sm text-foreground">Use this on your phone</span>
        </div>
        <button
          onClick={() => setVisible(false)}
          className="text-muted-foreground hover:text-foreground transition-colors ml-2 mt-0.5"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-3 text-xs text-muted-foreground">
        <p className="text-foreground text-xs font-medium">
          Open this page on your phone's browser — it works like an app and can be pinned to your home screen.
        </p>

        <div className="bg-slate-50 rounded-lg px-3 py-2 flex items-center gap-2 border border-border/50">
          <span className="font-mono text-[11px] text-foreground/70 break-all leading-snug flex-1 select-all">{url}</span>
        </div>

        <div className="space-y-2.5">
          <div>
            <p className="font-semibold text-foreground mb-1 flex items-center gap-1">
              <Share className="w-3 h-3" /> iPhone / iPad (Safari)
            </p>
            <ol className="space-y-0.5 pl-3 list-decimal">
              <li>Open the link above in <strong>Safari</strong></li>
              <li>Tap the <strong>Share</strong> button <Share className="w-3 h-3 inline mx-0.5 -mt-0.5" /></li>
              <li>Scroll down and tap <strong>"Add to Home Screen"</strong></li>
              <li>Tap <strong>Add</strong> — done!</li>
            </ol>
          </div>

          <div>
            <p className="font-semibold text-foreground mb-1 flex items-center gap-1">
              <MoreVertical className="w-3 h-3" /> Android (Chrome)
            </p>
            <ol className="space-y-0.5 pl-3 list-decimal">
              <li>Open the link above in <strong>Chrome</strong></li>
              <li>Tap the <strong>menu</strong> <MoreVertical className="w-3 h-3 inline mx-0.5 -mt-0.5" /> (top right)</li>
              <li>Tap <strong>"Add to Home screen"</strong></li>
              <li>Tap <strong>Add</strong> — done!</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Login() {
  const { data: publicConfig } = usePublicConfig();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [error, setError] = useState("");

  const returnTo = new URLSearchParams(window.location.search).get("returnTo") ?? "";
  const suspended = new URLSearchParams(window.location.search).get("suspended") === "1";

  if (suspended) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
        <div className="w-full max-w-xl rounded-xl border-2 border-red-600 bg-white px-6 py-10 text-center shadow-xl">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-wide text-red-700">
            PORTAL ACCESS SUSPENDED.
          </h1>
          <p className="mt-3 text-xl sm:text-2xl font-bold tracking-wide text-slate-900">
            ACCOUNT OVERDUE.
          </p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch("/portal/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, returnTo: returnTo || undefined }),
      });
      if (data.noAccount) {
        setError("No portal account found for that email address. Please contact your account manager at the configured business.");
        return;
      }
      if (!data.emailSent && data.magicUrl) {
        setDevUrl(data.magicUrl);
      }
      setSent(true);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-6">
          {publicConfig?.logoUrl && <img src={publicConfig.logoUrl} alt={publicConfig.businessName || publicConfig.tradingName || "Business logo"} className="h-16 w-auto" />}
          <p className="text-sm text-muted-foreground text-center leading-snug max-w-[220px]">
            Effortless uniform management from order to delivery.
          </p>
        </div>

        <Card className="shadow-lg">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">Sign in</CardTitle>
            <CardDescription>
              {sent ? "Check your inbox" : "Enter your email to receive a sign-in link"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sent ? (
              <div className="text-center py-2 space-y-4">
                <div className="flex justify-center">
                  <div className="bg-green-50 rounded-full p-4 border border-green-100">
                    <MailCheck className="w-10 h-10 text-green-600" />
                  </div>
                </div>
                <div>
                  <p className="font-semibold text-foreground">Sign-in link sent!</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    We've sent a link to <span className="font-medium text-foreground">{email}</span>. Click it to sign in — it expires in 30 minutes.
                  </p>
                </div>
                {devUrl && (
                  <div className="text-left rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                    <p className="text-xs font-semibold text-amber-800">Email sending is not set up on this account</p>
                    <p className="text-xs text-amber-700">Use this link to sign in:</p>
                    <a
                      href={devUrl}
                      className="flex items-center gap-1 text-xs text-blue-600 hover:underline break-all font-mono"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      {devUrl}
                    </a>
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => { setSent(false); setDevUrl(null); }}
                >
                  Use a different email
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    required
                    autoFocus
                  />
                </div>
                {error && (
                  <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
                )}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Send sign-in link
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        {!sent && (
          <p className="text-center text-xs text-muted-foreground mt-4">
            Don't have access? Contact your account manager at the configured business.
          </p>
        )}
      </div>

      <MobileInstallPrompt />
      <IosInstallBanner />
    </div>
  );
}
