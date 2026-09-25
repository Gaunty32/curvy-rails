import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, ExternalLink, ShoppingBag, Users, Package, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import DemoLayout from "./DemoLayout";
import { getDemoToken, demoFetch } from "@/lib/demo";

export default function DemoPortal() {
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);

  useEffect(() => {
    if (!getDemoToken()) setLocation("/demo");
  }, []);

  async function handleOpenPortal() {
    setLoading(true);
    setError(null);
    try {
      const data = await demoFetch("/demo/portal-preview");
      if (!data.previewUrl) throw new Error("Could not generate portal preview");
      setCustomerName(data.customerName ?? null);
      // Open in new tab
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      window.open(base + data.previewUrl, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      setError(err.message ?? "Could not open portal preview");
    } finally {
      setLoading(false);
    }
  }

  return (
    <DemoLayout>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold">Customer Portal</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            The customer-facing portal where staff place their own uniform orders
          </p>
        </div>

        {/* Hero CTA */}
        <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-700 px-8 py-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
            <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
              <ShoppingBag className="w-7 h-7 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-white font-bold text-xl mb-1">Try the Customer Portal</p>
              <p className="text-slate-300 text-sm leading-relaxed">
                Opens a live preview of the portal as an admin user. You can browse wardrobes, place test orders, and experience the full ordering flow your customers see.
              </p>
              {customerName && (
                <p className="text-amber-300 text-xs mt-2 font-medium">
                  Previewing as: {customerName}
                </p>
              )}
              {error && (
                <p className="text-red-400 text-xs mt-2">{error}</p>
              )}
            </div>
            <Button
              onClick={handleOpenPortal}
              disabled={loading}
              className="bg-white text-slate-900 hover:bg-slate-100 font-semibold shrink-0 gap-2"
              size="lg"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
              Open Portal
            </Button>
          </div>
        </div>

        {/* Feature cards */}
        <div className="grid sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-5 pb-5">
              <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center mb-3">
                <Users className="w-4 h-4 text-blue-600" />
              </div>
              <p className="font-semibold text-sm mb-1">Staff access</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Each staff member gets their own login. Managers can approve orders before they're submitted.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-5">
              <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center mb-3">
                <Package className="w-4 h-4 text-emerald-600" />
              </div>
              <p className="font-semibold text-sm mb-1">Branded wardrobe</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Each customer has their own product wardrobe — only their items, with their branding and pricing.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-5">
              <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center mb-3">
                <ShoppingBag className="w-4 h-4 text-violet-600" />
              </div>
              <p className="font-semibold text-sm mb-1">Self-service ordering</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Staff select sizes and quantities themselves — orders flow directly into your production pipeline.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* CTA banner */}
        <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted/40 px-5 py-4">
          <p className="text-sm text-muted-foreground">
            Ready to set up the portal for your customers?
          </p>
          <a href="mailto:" className="shrink-0">
            <Button variant="outline" size="sm" className="gap-1.5">
              Get in touch <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </a>
        </div>
      </div>
    </DemoLayout>
  );
}
