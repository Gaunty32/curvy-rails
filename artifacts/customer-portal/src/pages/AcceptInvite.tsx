import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { usePublicConfig } from "@/lib/publicConfig";

export default function AcceptInvite() {
  const { data: publicConfig } = usePublicConfig();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const token = params.get("token") ?? "";
  const returnTo = params.get("returnTo") ?? "";
  const { refetchUser } = useAuth();

  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMsg("No sign-in token found. Please request a new link.");
      return;
    }

    apiFetch("/portal/auth/accept-invite", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
      .then(async (data) => {
        if (data.multipleBusinesses) {
          sessionStorage.setItem("portal_selection_token", data.selectionToken);
          sessionStorage.setItem("portal_selection_email", data.email);
          sessionStorage.setItem("portal_selection_businesses", JSON.stringify(data.businesses));
          if (returnTo) sessionStorage.setItem("portal_selection_returnTo", returnTo);
          localStorage.setItem("portal_businesses", JSON.stringify(data.businesses));
          localStorage.setItem("portal_email", data.email ?? "");
          setStatus("success");
          setTimeout(() => setLocation("/select-business"), 800);
        } else {
          localStorage.setItem("portal_token", data.token);
          localStorage.setItem("portal_customer_id", String(data.customerId));
          localStorage.setItem("portal_customer_name", data.customerName ?? "");
          localStorage.setItem("portal_email", data.email ?? "");
          localStorage.setItem("portal_role", data.portalRole ?? "member");
          await refetchUser();
          setStatus("success");
          setTimeout(() => setLocation(returnTo || "/orders"), 1200);
        }
      })
      .catch((err) => {
        setStatus("error");
        setErrorMsg(err.message ?? "This link has expired or already been used.");
      });
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-6">
          {publicConfig?.logoUrl && <img src={publicConfig.logoUrl} alt={publicConfig.businessName || publicConfig.tradingName || "Business logo"} className="h-16 w-auto" />}
        </div>

        <Card className="shadow-lg">
          <CardContent className="pt-8 pb-8 text-center">
            {status === "verifying" && (
              <div className="space-y-3">
                <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
                <p className="font-medium text-foreground">Signing you in…</p>
                <p className="text-sm text-muted-foreground">Just a moment</p>
              </div>
            )}

            {status === "success" && (
              <div className="space-y-3">
                <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
                <p className="font-semibold text-foreground">You're in!</p>
                <p className="text-sm text-muted-foreground">Redirecting…</p>
              </div>
            )}

            {status === "error" && (
              <div className="space-y-4">
                <AlertCircle className="w-10 h-10 text-destructive mx-auto" />
                <div>
                  <p className="font-semibold text-foreground">Link expired or already used</p>
                  <p className="text-sm text-muted-foreground mt-1">{errorMsg}</p>
                </div>
                <Button
                  className="w-full"
                  onClick={() => setLocation("/login")}
                >
                  Request a new sign-in link
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
