import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { apiFetch } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, Building2 } from "lucide-react";
import { usePublicConfig } from "@/lib/publicConfig";

interface Business {
  portalUserId: number;
  customerId: number;
  customerName: string;
  logoUrl: string | null;
  portalRole: string;
}

export default function SelectBusiness() {
  const { data: publicConfig } = usePublicConfig();
  const [, setLocation] = useLocation();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectionToken, setSelectionToken] = useState("");
  const [email, setEmail] = useState("");
  const [selecting, setSelecting] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = sessionStorage.getItem("portal_selection_token");
    const storedEmail = sessionStorage.getItem("portal_selection_email");
    const raw = sessionStorage.getItem("portal_selection_businesses");
    if (!token || !raw) {
      setLocation("/login");
      return;
    }
    try {
      setSelectionToken(token);
      setEmail(storedEmail ?? "");
      setBusinesses(JSON.parse(raw));
    } catch {
      setLocation("/login");
    }
  }, []);

  const select = async (b: Business) => {
    setSelecting(b.portalUserId);
    setError("");
    try {
      const data = await apiFetch("/portal/auth/select-business", {
        method: "POST",
        body: JSON.stringify({ selectionToken, portalUserId: b.portalUserId }),
      });
      const pendingReturnTo = sessionStorage.getItem("portal_selection_returnTo") ?? "";
      sessionStorage.removeItem("portal_selection_token");
      sessionStorage.removeItem("portal_selection_email");
      sessionStorage.removeItem("portal_selection_businesses");
      sessionStorage.removeItem("portal_selection_returnTo");
      localStorage.setItem("portal_token", data.token);
      localStorage.setItem("portal_customer_id", String(data.customerId));
      localStorage.setItem("portal_customer_name", data.customerName ?? "");
      localStorage.setItem("portal_email", data.email ?? "");
      localStorage.setItem("portal_role", data.portalRole ?? "member");
      // Preserve the full business list so the user can switch later
      if (businesses.length > 1) {
        localStorage.setItem("portal_businesses", JSON.stringify(businesses));
      }
      setLocation(pendingReturnTo || "/orders");
    } catch (err: any) {
      setError(err.message ?? "Something went wrong. Please sign in again.");
      setSelecting(null);
    }
  };

  if (businesses.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center gap-3 mb-8">
          {publicConfig?.logoUrl && <img src={publicConfig.logoUrl} alt={publicConfig.businessName || publicConfig.tradingName || "Business logo"} className="h-16 w-auto" />}
          <div className="text-center">
            <h1 className="text-xl font-semibold text-foreground">Choose your account</h1>
            {email && (
              <p className="text-sm text-muted-foreground mt-1">
                Signed in as <span className="font-medium">{email}</span>
              </p>
            )}
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 mb-4 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {businesses.map((b) => {
            const isLoading = selecting === b.portalUserId;
            return (
              <button
                key={b.portalUserId}
                onClick={() => select(b)}
                disabled={selecting !== null}
                className="group"
              >
                <Card className="shadow-sm hover:shadow-md transition-all cursor-pointer border-2 border-transparent group-hover:border-primary/40 disabled:opacity-60">
                  <CardContent className="flex items-center justify-center p-8">
                    {isLoading ? (
                      <Loader2 className="w-12 h-12 animate-spin text-primary" />
                    ) : b.logoUrl ? (
                      <img src={b.logoUrl} alt={b.customerName} className="max-h-28 max-w-full object-contain" />
                    ) : (
                      <Building2 className="w-20 h-20 text-muted-foreground/40" />
                    )}
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Not you?{" "}
          <button
            className="text-primary hover:underline"
            onClick={() => {
              sessionStorage.removeItem("portal_selection_token");
              sessionStorage.removeItem("portal_selection_email");
              sessionStorage.removeItem("portal_selection_businesses");
              setLocation("/login");
            }}
          >
            Sign in with a different email
          </button>
        </p>
      </div>
    </div>
  );
}
