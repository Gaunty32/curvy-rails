import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import PortalLayout from "@/components/Layout";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { usePublicConfig } from "@/lib/publicConfig";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Shirt, Tag, Layers, ShoppingBag } from "lucide-react";

function ProcessBadge({ type }: { type: string }) {
  const colours: Record<string, string> = {
    embroidery: "bg-purple-100 text-purple-700",
    print: "bg-blue-100 text-blue-700",
    dtf: "bg-cyan-100 text-cyan-700",
    badge: "bg-amber-100 text-amber-700",
    heat_transfer: "bg-orange-100 text-orange-700",
  };
  const cls = colours[type?.toLowerCase()] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {type?.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase())}
    </span>
  );
}

export default function Wardrobe() {
  const { data: publicConfig } = usePublicConfig();
  const { canSeePricing } = useAuth();
  const { data, isLoading } = useQuery<any>({
    queryKey: ["portal-wardrobe"],
    queryFn: () => apiFetch("/portal/wardrobe"),
  });

  // Group items by finish (null finish_id → "__none__" bucket shown as plain garments)
  const finishes: Record<string, { finishId: number | null; finishName: string | null; finishCode: string | null; items: any[]; processes: any[] }> = {};
  if (data?.items) {
    for (const item of data.items) {
      const key = item.finish_id != null ? String(item.finish_id) : "__none__";
      if (!finishes[key]) {
        finishes[key] = {
          finishId: item.finish_id ?? null,
          finishName: item.finish_name ?? null,
          finishCode: item.finish_code ?? null,
          items: [],
          processes: [],
        };
      }
      finishes[key].items.push(item);
    }
  }
  if (data?.processes) {
    for (const proc of data.processes) {
      const key = String(proc.finish_id);
      if (finishes[key]) finishes[key].processes.push(proc);
    }
  }

  // Put "no finish" bucket last
  const finishList = Object.entries(finishes)
    .sort(([a], [b]) => (a === "__none__" ? 1 : b === "__none__" ? -1 : 0))
    .map(([, v]) => v);

  return (
    <PortalLayout>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Wardrobe</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Your preset garments, finishes and decoration processes configured for this installation.
          </p>
        </div>
        <Link href="/orders/new?mode=wardrobe">
          <Button className="shrink-0">
            <ShoppingBag className="w-4 h-4 mr-2" />
            Place an Order
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : finishList.length === 0 ? (
        <Card>
          <CardContent className="py-20 text-center">
            <Shirt className="w-14 h-14 mx-auto mb-4 text-muted-foreground/30" />
            <h2 className="text-lg font-semibold">No wardrobe set up yet</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Contact the configured business to get your bespoke wardrobe configured.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {finishList.map((finish) => {
            // Group items by product name for display
            const productMap: Record<string, any[]> = {};
            for (const item of finish.items) {
              const key = item.product_name ?? item.name ?? "Unknown";
              if (!productMap[key]) productMap[key] = [];
              productMap[key].push(item);
            }

            return (
              <Card key={finish.finishId ?? "__none__"} className="overflow-hidden">
                {finish.finishName && (
                  <CardHeader className="bg-muted/40 border-b pb-4">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-primary" />
                      <CardTitle className="text-base">{finish.finishName}</CardTitle>
                      {finish.finishCode && (
                        <span className="text-xs text-muted-foreground font-mono">
                          {finish.finishCode}
                        </span>
                      )}
                    </div>
                  </CardHeader>
                )}
                <CardContent className="pt-4">
                  {/* Garments/Products */}
                  <div className={finish.processes.length > 0 ? "mb-4" : ""}>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Shirt className="w-3.5 h-3.5" /> Garments
                    </p>
                    <div className="flex flex-col gap-2">
                      {Object.entries(productMap).map(([productName, items]) => {
                        const firstItem = items[0];
                        const colours = [...new Set(items.map((i: any) => i.colour).filter(Boolean))];
                        const price = firstItem.special_price ?? firstItem.woo_price ?? firstItem.unit_price;
                        const thumbUrl = firstItem.variant_image_url ?? firstItem.product_image_url ?? null;
                        return (
                          <div
                            key={productName}
                            className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5 bg-background"
                          >
                            {thumbUrl && (
                              <img
                                src={thumbUrl}
                                alt={productName}
                                className="w-12 h-12 object-contain rounded shrink-0 bg-muted/30"
                              />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">{productName}</p>
                              {firstItem.product_sku && (
                                <p className="text-xs text-muted-foreground font-mono">
                                  SKU: {firstItem.product_sku}
                                </p>
                              )}
                              {colours.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {colours.map((c: any) => (
                                    <Badge key={c} variant="outline" className="text-xs py-0">
                                      {c}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                              {firstItem.role_name && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  Role: {firstItem.role_name}
                                </p>
                              )}
                            </div>
                            {price && canSeePricing && (
                              <span className="text-sm font-semibold tabular-nums shrink-0">
                                {formatCurrency(price)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Decoration processes */}
                  {finish.processes.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                        <Tag className="w-3.5 h-3.5" /> Decoration
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {finish.processes.map((p: any) => (
                          <div
                            key={p.process_id}
                            className="flex items-center gap-1.5 rounded-md border px-2 py-1 bg-background"
                          >
                            {p.process_type && <ProcessBadge type={p.process_type} />}
                            <span className="text-xs text-muted-foreground">{p.item_finish_name}</span>
                            {p.placement && (
                              <span className="text-xs text-muted-foreground opacity-60">
                                · {p.placement}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-6 text-center">
        Want to add a new garment or finish? Contact{" "}
        <a href={publicConfig?.email ? `mailto:${publicConfig.email}` : undefined} className="underline underline-offset-2 hover:text-foreground">
          {publicConfig?.businessName || publicConfig?.tradingName || "the configured business"}
        </a>
      </p>
    </PortalLayout>
  );
}
