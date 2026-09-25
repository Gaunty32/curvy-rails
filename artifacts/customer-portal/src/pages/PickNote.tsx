import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft, Package, MapPin, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface PickNoteItem {
  id: number;
  quantity: number;
  recipient_name: string | null;
  notes: string | null;
  created_at: string;
  created_by_name: string | null;
  item_name: string;
  colour: string | null;
  size: string | null;
  location: string | null;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function PickNote() {
  const params = useParams<{ ref: string }>();
  const ref = params.ref ?? "";
  const [, navigate] = useLocation();

  const { data, isLoading, error } = useQuery<{ ref: string; items: PickNoteItem[] }>({
    queryKey: ["pick-note", ref],
    queryFn: () => apiFetch(`/portal/stock/picking-note/${encodeURIComponent(ref)}`),
    enabled: !!ref,
  });

  // Group items by location (then unlocation at end)
  const grouped = (() => {
    if (!data?.items?.length) return [];
    const map = new Map<string, PickNoteItem[]>();
    for (const item of data.items) {
      const loc = item.location ?? "No location";
      if (!map.has(loc)) map.set(loc, []);
      map.get(loc)!.push(item);
    }
    return [...map.entries()].map(([location, items]) => ({ location, items }));
  })();

  const issuedAt = data?.items?.[0]?.created_at;
  const issuedBy = data?.items?.[0]?.created_by_name;
  const totalQty = data?.items?.reduce((s, i) => s + Math.abs(i.quantity), 0) ?? 0;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Package className="w-8 h-8 mx-auto mb-2 animate-pulse opacity-40" />
          <p className="text-sm">Loading pick note…</p>
        </div>
      </div>
    );
  }

  if (error || !data?.items?.length) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Package className="w-8 h-8 mx-auto mb-2 opacity-20" />
          <p className="font-medium">Pick note not found</p>
          <p className="text-sm mt-1">Reference: {ref}</p>
          <Button variant="outline" className="mt-4 gap-2" onClick={() => navigate("/stores")}>
            <ArrowLeft className="w-4 h-4" /> Back to Stores
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Screen-only toolbar */}
      <div className="print:hidden sticky top-0 z-10 flex items-center justify-between gap-4 border-b bg-white px-4 py-3 shadow-sm">
        <Button variant="ghost" size="sm" className="gap-2" onClick={() => navigate("/stores")}>
          <ArrowLeft className="w-4 h-4" /> Stores
        </Button>
        <Button className="gap-2" onClick={() => window.print()}>
          <Printer className="w-4 h-4" /> Print Pick Note
        </Button>
      </div>

      {/* Pick note body */}
      <div className="max-w-2xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Pick Note</p>
            <h1 className="text-2xl font-bold text-foreground">{ref}</h1>
            {issuedAt && (
              <p className="text-sm text-muted-foreground mt-1">{fmt(issuedAt)}</p>
            )}
            {issuedBy && (
              <p className="text-sm text-muted-foreground">Raised by {issuedBy}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total items</p>
            <p className="text-3xl font-bold tabular-nums">{totalQty}</p>
          </div>
        </div>

        <hr className="mb-6" />

        {/* Grouped by location */}
        <div className="space-y-6">
          {grouped.map(({ location, items }) => (
            <div key={location}>
              {/* Location heading */}
              <div className="flex items-center gap-2 mb-3">
                <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-semibold text-foreground">{location}</span>
              </div>

              {/* Items table */}
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-left">Colour / Size</th>
                      <th className="px-3 py-2 text-center w-16">Qty</th>
                      <th className="px-3 py-2 text-left">For</th>
                      <th className="px-3 py-2 text-center w-20 print:block hidden">Picked ✓</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => (
                      <tr
                        key={item.id}
                        className={cn(
                          "border-t",
                          idx % 2 === 0 ? "bg-white" : "bg-muted/20"
                        )}
                      >
                        <td className="px-3 py-2.5 font-medium">{item.item_name}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {[item.colour, item.size].filter(Boolean).join(" / ") || "—"}
                        </td>
                        <td className="px-3 py-2.5 text-center font-bold tabular-nums">
                          {Math.abs(item.quantity)}
                        </td>
                        <td className="px-3 py-2.5">
                          {item.recipient_name ? (
                            <span className="flex items-center gap-1 text-muted-foreground">
                              <User className="w-3 h-3 shrink-0" />
                              {item.recipient_name}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50 text-xs italic">Stock</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center print:block hidden">
                          <div className="w-5 h-5 border border-gray-400 rounded mx-auto" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>

        {/* Signature block — print only */}
        <div className="hidden print:block mt-12 pt-8 border-t grid grid-cols-2 gap-8">
          <div>
            <p className="text-xs text-muted-foreground mb-6">Picked by (signature)</p>
            <div className="border-b border-gray-400 w-full" />
            <p className="text-xs text-muted-foreground mt-1">Name / Date</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-6">Checked by (signature)</p>
            <div className="border-b border-gray-400 w-full" />
            <p className="text-xs text-muted-foreground mt-1">Name / Date</p>
          </div>
        </div>
      </div>
    </div>
  );
}
