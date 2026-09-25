import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiFetch } from "@/lib/api";
import PortalLayout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertTriangle, Plus, ArrowUpCircle, ArrowDownCircle, History,
  Pencil, Trash2, Package, MapPin, TrendingDown, RefreshCw, Shirt,
  ShoppingCart, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { sortBySizeWithOrder, sortSizes } from "@/lib/sizeUtils";
import { useSizeOrder } from "@/hooks/useSizeOrder";

// ─── Types ───────────────────────────────────────────────────────────────────

interface StockItem {
  id: number;
  name: string;
  product_id: number | null;
  product_name: string | null;
  product_sku: string | null;
  product_image_url: string | null;
  variant_image_url: string | null;
  colour: string | null;
  sleeve: string | null;
  size: string | null;
  unit_price: string | null;
  special_price: string | null;
  woo_price: string | null;
  woo_regular_price: string | null;
  woo_on_sale: boolean | null;
  price_breaks: { qty: number; price: number }[] | null;
  stock_quantity: number;
  min_quantity: number;
  location: string | null;
  notes: string | null;
  finish_id: number | null;
  finish_name: string | null;
  reorder_quantity: number;
  movement_count: number;
  last_movement_at: string | null;
}

interface StockProcess {
  finish_id: number;
  process_id: number;
  item_finish_name: string;
  process_type: string;
  placement: string | null;
  price: string | null;
}

function getSizesForGroup(
  group: CardGroup,
  sizesMap: Record<string, Record<string, string[]>>
): string[] {
  const productId = group.items[0]?.product_id;
  if (!productId) return sortSizes([...new Set(group.items.map(i => i.size ?? "—"))]);
  const byProduct = sizesMap[String(productId)];
  // No catalogue data — fall back to stored sizes
  if (!byProduct) return sortSizes([...new Set(group.items.map(i => i.size ?? "—"))]);
  // Same logic as wardrobe: return all sizes across all colour variants, colour doesn't restrict ordering
  const all = [...new Set(Object.values(byProduct).flat())];
  if (all.length) return sortSizes(all);
  // Last resort: use the sizes actually stored (deduplicated)
  return sortSizes([...new Set(group.items.map(i => i.size ?? "—"))]);
}

function resolveStockPrice(item: StockItem, _processes: StockProcess[]): number {
  // special_price = all-in agreed price for this customer — use directly
  if (item.special_price != null && item.special_price !== "") {
    return parseFloat(item.special_price);
  }
  // No special price — use the current product list price (woo_price) so that
  // price increases on the product are always reflected in store reorders.
  // Fall back to the stored unit_price only if woo_price is missing (unlinked item).
  const wooBase = item.woo_price ? parseFloat(item.woo_price) : null;
  if (wooBase != null && wooBase > 0) {
    // Apply quantity price breaks if available
    const breaks: { qty: number; price: number }[] = Array.isArray(item.price_breaks) ? item.price_breaks : [];
    const discountBreaks = breaks
      .map(pb => ({ qty: Number(pb.qty), price: Number(pb.price) }))
      .filter(pb =>
        Number.isFinite(pb.qty) &&
        Number.isFinite(pb.price) &&
        pb.qty > 0 &&
        pb.price > 0 &&
        pb.price <= wooBase
      );
    if (discountBreaks.length > 0) {
      const sorted = [...discountBreaks].sort((a, b) => b.qty - a.qty);
      return sorted[0]?.price ?? wooBase; // stock reorders don't have a specific qty at this point — use best break
    }
    return wooBase;
  }
  return item.unit_price ? parseFloat(item.unit_price) : 0;
}

interface Movement {
  id: number;
  movement_type: string;
  quantity: number;
  reference: string | null;
  recipient_name: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
}

// ─── Card group ───────────────────────────────────────────────────────────────

interface CardGroup {
  key: string;
  displayName: string;
  productSku: string | null;
  imageUrl: string | null;
  colour: string | null;
  sleeve: string | null;
  finishId: number | null;
  finishName: string | null;
  location: string | null;
  items: StockItem[];
}

function groupItems(items: StockItem[], sizeOrder: string[]): CardGroup[] {
  const map = new Map<string, CardGroup>();

  for (const item of items) {
    // Key includes colour AND sleeve so Long Sleeve / Short Sleeve get separate cards.
    // Null values use empty string — null-colour/null-sleeve merging handled below.
    const key = `${item.product_id ?? item.name}|${item.colour ?? ""}|${item.finish_id ?? ""}|${item.sleeve ?? ""}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        displayName: item.product_name ?? item.name,
        productSku: item.product_sku ?? null,
        imageUrl: item.variant_image_url ?? item.product_image_url ?? null,
        colour: item.colour,
        sleeve: item.sleeve,
        finishId: item.finish_id,
        finishName: item.finish_name,
        location: item.location,
        items: [],
      });
    }
    map.get(key)!.items.push(item);
  }

  // Merge null-colour groups into a matching named-colour group for the same
  // product + finish + sleeve. This collapses cards that were split because some
  // items were saved without a colour (e.g. "Black" vs null for the same shoe SKU).
  for (const [key, group] of map) {
    if (group.colour != null) continue; // only process null-colour groups
    const productPart = `${group.items[0]?.product_id ?? group.displayName}`;
    const finishPart  = `${group.finishId ?? ""}`;
    const sleevePart  = `${group.sleeve ?? ""}`;
    // Find the first named-colour group for the same product+finish+sleeve
    const target = [...map.values()].find(g =>
      g !== group &&
      g.colour != null &&
      `${g.items[0]?.product_id ?? g.displayName}` === productPart &&
      `${g.finishId ?? ""}` === finishPart &&
      `${g.sleeve ?? ""}` === sleevePart
    );
    if (target) {
      target.items.push(...group.items);
      map.delete(key);
    }
  }

  // Within each group, deduplicate by size+sleeve key: if the same combination
  // appears more than once (e.g. duplicate DB records), merge by summing stock.
  return Array.from(map.values()).map(g => {
    const sizeMap = new Map<string, StockItem>();
    for (const item of g.items) {
      // Include sleeve in dedup key so "Size 8 Long" and "Size 8 Short" stay separate
      // within a card that contains both (shouldn't happen after the group-key fix, but
      // keeps the dedup safe if sleeve is null on some items).
      const sizeKey = `${(item.size ?? "—").toLowerCase().trim()}|${(item.sleeve ?? "").toLowerCase().trim()}`;
      const existing = sizeMap.get(sizeKey);
      if (!existing) {
        sizeMap.set(sizeKey, item);
      } else {
        // Sum duplicate balances and keep the row with the most actual stock as
        // the adjustment target. The API also deducts across all exact matches.
        const canonical = item.stock_quantity > existing.stock_quantity ? item : existing;
        sizeMap.set(sizeKey, {
          ...canonical,
          stock_quantity: existing.stock_quantity + item.stock_quantity,
        });
      }
    }
    const deduped = [...sizeMap.values()];
    return { ...g, items: sortBySizeWithOrder(deduped, i => i.size, sizeOrder) };
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SIZE_ABBREV: Record<string, string> = {
  "extra small": "XS",
  "small": "S",
  "medium": "M",
  "large": "L",
  "extra large": "XL",
  "extra-large": "XL",
  "double extra large": "2XL",
  "triple extra large": "3XL",
};
function abbrevSize(s: string): string {
  return SIZE_ABBREV[s.toLowerCase()] ?? s;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function movementLabel(type: string) {
  if (type === "in") return { label: "Stock In", color: "text-green-600" };
  if (type === "out") return { label: "Stock Out", color: "text-red-500" };
  if (type === "issue") return { label: "Issued", color: "text-orange-500" };
  if (type === "adjustment") return { label: "Adjustment", color: "text-blue-500" };
  if (type === "transfer") return { label: "Transfer", color: "text-purple-500" };
  return { label: type, color: "text-muted-foreground" };
}

// ─── Process badge ────────────────────────────────────────────────────────────

function ProcessBadge({ type }: { type: string }) {
  const colours: Record<string, string> = {
    embroidery: "bg-purple-100 text-purple-700 border-purple-200",
    print: "bg-blue-100 text-blue-700 border-blue-200",
    dtf: "bg-cyan-100 text-cyan-700 border-cyan-200",
    badge: "bg-amber-100 text-amber-700 border-amber-200",
    heat_transfer: "bg-orange-100 text-orange-700 border-orange-200",
  };
  const cls = colours[type?.toLowerCase()] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border ${cls}`}>
      {type?.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase())}
    </span>
  );
}

// ─── Product image with fallback ──────────────────────────────────────────────

function ProductImage({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Shirt className="w-10 h-10 text-muted-foreground/20" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className="w-full h-full object-contain p-2"
      onError={() => setFailed(true)}
    />
  );
}

// ─── Stock card ───────────────────────────────────────────────────────────────

function StockCard({
  group,
  processes,
  onAdjust,
  onHistory,
  onEdit,
  onDelete,
  onReorder,
  onSaveLimits,
}: {
  group: CardGroup;
  processes: StockProcess[];
  onAdjust: (item: StockItem) => void;
  onHistory: (item: StockItem) => void;
  onEdit: (item: StockItem) => void;
  onDelete: (item: StockItem) => void;
  onReorder: (group: CardGroup) => void;
  onSaveLimits: (item: StockItem, minQty: number, reorderQty: number) => void;
}) {
  const groupProcesses = group.finishId != null
    ? processes.filter(p => p.finish_id === group.finishId)
    : [];

  const hasLow = group.items.some(i => i.min_quantity > 0 && i.stock_quantity <= i.min_quantity);
  const totalStock = group.items.reduce((sum, i) => sum + i.stock_quantity, 0);
  const sizesInStock = group.items.filter(i => i.stock_quantity > 0).length;

  // Collapsible size table — open by default when any size is low stock
  const [sizeOpen, setSizeOpen] = useState(hasLow);

  // Local state for inline min/reorder editing
  // Key = itemId, value = { min: string; reorder: string }
  const [localLimits, setLocalLimits] = useState<Record<number, { min: string; reorder: string }>>({});

  function getLimit(item: StockItem, field: "min" | "reorder"): string {
    if (localLimits[item.id]) return localLimits[item.id][field];
    return field === "min" ? String(item.min_quantity) : String(item.reorder_quantity ?? 0);
  }

  function setLimit(item: StockItem, field: "min" | "reorder", value: string) {
    setLocalLimits(prev => ({
      ...prev,
      [item.id]: {
        min: prev[item.id]?.min ?? String(item.min_quantity),
        reorder: prev[item.id]?.reorder ?? String(item.reorder_quantity ?? 0),
        [field]: value,
      },
    }));
  }

  function commitLimit(item: StockItem) {
    const local = localLimits[item.id];
    if (!local) return;
    const minQty = Math.max(0, parseInt(local.min) || 0);
    const reorderQty = Math.max(0, parseInt(local.reorder) || 0);
    const unchanged = minQty === item.min_quantity && reorderQty === (item.reorder_quantity ?? 0);
    if (!unchanged) onSaveLimits(item, minQty, reorderQty);
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-shadow">
      {/* Image area */}
      <div className="relative w-full h-44 bg-white border-b">
        <ProductImage src={group.imageUrl} alt={group.displayName} />
        {hasLow && (
          <div className="absolute top-2 right-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              <TrendingDown className="w-3 h-3" /> Low stock
            </span>
          </div>
        )}
      </div>

      {/* Card body */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        {/* Name + colour + SKU */}
        <div className="min-w-0">
          <p className="font-semibold text-sm leading-snug line-clamp-2">{group.displayName}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
            {[group.colour, group.sleeve, group.productSku].filter(Boolean).join(" · ")}
          </p>
          {group.finishName && (
            <p className="text-[11px] text-muted-foreground/70 truncate">{group.finishName}</p>
          )}
        </div>

        {/* Process badges — show type + placement only (finish name already shown above) */}
        {groupProcesses.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {groupProcesses.map(p => (
              <div key={p.process_id} className="flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5">
                {p.process_type && <ProcessBadge type={p.process_type} />}
                {p.placement && (
                  <span className="text-[10px] text-muted-foreground font-medium">{p.placement}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Location */}
        {group.location && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <MapPin className="w-3 h-3 shrink-0" />
            {group.location}
          </p>
        )}

        {/* Collapsible size table toggle */}
        <button
          onClick={() => setSizeOpen(o => !o)}
          className={cn(
            "w-full flex items-center justify-between rounded-lg px-2 py-1.5 text-xs font-medium transition-colors",
            sizeOpen
              ? "bg-muted/50 text-foreground"
              : "bg-muted/30 hover:bg-muted/50 text-foreground"
          )}
        >
          <span className="flex items-center gap-1.5 min-w-0 truncate">
            <span className="font-semibold shrink-0">
              {group.items.length} size{group.items.length !== 1 ? "s" : ""}
            </span>
            <span className="text-muted-foreground shrink-0">· {totalStock} in stock</span>
            {sizesInStock > 0 && sizesInStock < group.items.length && (
              <span className="text-muted-foreground/70 text-[10px] shrink-0">({sizesInStock} non-zero)</span>
            )}
            {hasLow && (
              <span className="inline-flex items-center gap-0.5 text-amber-600 font-semibold shrink-0">
                <TrendingDown className="w-3 h-3" /> Low
              </span>
            )}
          </span>
          {sizeOpen
            ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          }
        </button>

        {sizeOpen && (
          <>
            {/* Column headers */}
            <div className="grid grid-cols-[auto_1fr_52px_auto] items-center gap-1 px-1 -mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground min-w-[2.5rem]">Size</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Stock</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground text-center">Min</span>
              <span className="w-8" />
            </div>

            <div className="border-t" />

            {/* Per-size rows */}
            <div className="flex flex-col gap-1">
              {group.items.map(item => {
                const isLow = item.min_quantity > 0 && item.stock_quantity <= item.min_quantity;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "grid grid-cols-[auto_1fr_52px_auto] items-center gap-1 rounded-lg px-1.5 py-1.5",
                      isLow ? "bg-amber-50 border border-amber-200" : "bg-muted/30"
                    )}
                  >
                    {/* Size chip — abbreviated so e.g. "Extra Small" → "XS" fits without wrapping */}
                    <span
                      className={cn(
                        "rounded-md px-1.5 py-0.5 text-[11px] font-semibold shrink-0 min-w-[2.5rem] text-center",
                        isLow ? "bg-amber-200 text-amber-800" : "bg-background border text-foreground"
                      )}
                      title={item.size ?? undefined}
                    >
                      {abbrevSize(item.size ?? "—")}
                    </span>

                    {/* Quantity */}
                    <div className="flex items-center gap-1">
                      <span className={cn(
                        "font-bold text-sm tabular-nums",
                        isLow ? "text-amber-700" : "text-foreground"
                      )}>
                        {item.stock_quantity}
                      </span>
                      {isLow && <TrendingDown className="w-3 h-3 text-amber-500 shrink-0" />}
                    </div>

                    {/* Min qty — inline editable */}
                    <input
                      type="number"
                      min="0"
                      value={getLimit(item, "min")}
                      onChange={e => setLimit(item, "min", e.target.value)}
                      onBlur={() => commitLimit(item)}
                      onKeyDown={e => e.key === "Enter" && (e.currentTarget.blur())}
                      className="w-full h-7 rounded border border-transparent bg-background/60 hover:border-border focus:border-primary focus:outline-none text-center text-xs font-medium tabular-nums px-1 transition-colors"
                      title="Minimum stock level — alert when stock reaches this"
                    />

                    {/* Adjust stock */}
                    <button
                      onClick={() => onAdjust(item)}
                      className="p-1 rounded hover:bg-background transition-colors text-muted-foreground hover:text-foreground"
                      title="Adjust stock"
                    >
                      <ArrowUpCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Hint text */}
            <p className="text-[10px] text-muted-foreground/60 text-center -mt-0.5">
              Click Min to edit · Enter to save
            </p>
          </>
        )}

        {/* Reorder button */}
        {group.items.some(i => i.product_id != null) && (
          <button
            onClick={() => onReorder(group)}
            className="mt-1 w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-primary/40 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/5 transition-colors"
          >
            <ShoppingCart className="w-3.5 h-3.5" /> Reorder
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const PORTAL_SESSION_KEY = "portal-new-order";

export default function StockPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const sizeOrder = useSizeOrder();
  const [, navigate] = useLocation();

  const { data, isLoading } = useQuery<{ items: StockItem[]; processes: StockProcess[]; sizesMap: Record<string, Record<string, string[]>> }>({
    queryKey: ["portal-stock"],
    queryFn: () => apiFetch("/portal/stock"),
  });

  const items = data?.items ?? [];
  const processes = data?.processes ?? [];
  const sizesMap = data?.sizesMap ?? {};

  // ── Add item dialog ─────────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    name: "", colour: "", size: "", initialQuantity: "0",
    minQuantity: "0", reorderQuantity: "0", location: "", notes: "", unitPrice: "0",
  });

  const addMutation = useMutation({
    mutationFn: (body: object) => apiFetch("/portal/stock", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-stock"] });
      setAddOpen(false);
      setAddForm({ name: "", colour: "", size: "", initialQuantity: "0", minQuantity: "0", reorderQuantity: "0", location: "", notes: "", unitPrice: "0" });
      toast({ title: "Item added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function handleAdd() {
    addMutation.mutate({
      name: addForm.name.trim(),
      colour: addForm.colour.trim() || null,
      size: addForm.size.trim() || null,
      unitPrice: parseFloat(addForm.unitPrice) || 0,
      initialQuantity: parseInt(addForm.initialQuantity) || 0,
      minQuantity: parseInt(addForm.minQuantity) || 0,
      reorderQuantity: parseInt(addForm.reorderQuantity) || 0,
      location: addForm.location.trim() || null,
      notes: addForm.notes.trim() || null,
    });
  }

  // ── Edit item dialog ────────────────────────────────────────────────────────
  const [editItem, setEditItem] = useState<StockItem | null>(null);
  const [editForm, setEditForm] = useState({ name: "", colour: "", size: "", location: "", notes: "" });

  function openEdit(item: StockItem) {
    setEditItem(item);
    setEditForm({
      name: item.name,
      colour: item.colour ?? "",
      size: item.size ?? "",
      location: item.location ?? "",
      notes: item.notes ?? "",
    });
  }

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      apiFetch(`/portal/stock/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-stock"] });
      setEditItem(null);
      toast({ title: "Item updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function handleEdit() {
    if (!editItem) return;
    editMutation.mutate({
      id: editItem.id,
      body: {
        name: editForm.name.trim(),
        colour: editForm.colour.trim() || null,
        size: editForm.size.trim() || null,
        location: editForm.location.trim() || null,
        notes: editForm.notes.trim() || null,
      },
    });
  }

  // ── Save limits (inline min/reorder editing on cards) ───────────────────────
  const saveLimitsMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      apiFetch(`/portal/stock/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-stock"] });
    },
    onError: (e: any) => toast({ title: "Could not save limits", description: e.message, variant: "destructive" }),
  });

  function handleSaveLimits(item: StockItem, minQty: number, reorderQty: number) {
    saveLimitsMutation.mutate({
      id: item.id,
      body: { minQuantity: minQty, reorderQuantity: reorderQty },
    });
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  const [deleteItem, setDeleteItem] = useState<StockItem | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/portal/stock/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-stock"] });
      setDeleteItem(null);
      toast({ title: "Item removed" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Adjust dialog ───────────────────────────────────────────────────────────
  const [adjustItem, setAdjustItem] = useState<StockItem | null>(null);
  const [adjustForm, setAdjustForm] = useState({ type: "in" as "in" | "out" | "adjustment", quantity: "1", notes: "", recipientName: "" });

  function openAdjust(item: StockItem) {
    setAdjustItem(item);
    setAdjustForm({ type: "in", quantity: "1", notes: "", recipientName: "" });
  }

  const adjustMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      apiFetch(`/portal/stock/${id}/adjust`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-stock"] });
      qc.invalidateQueries({ queryKey: ["stores-log"] });
      setAdjustItem(null);
      toast({ title: "Stock adjusted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function handleAdjust() {
    if (!adjustItem) return;
    const qty = parseInt(adjustForm.quantity);
    if (!qty || qty < 1) { toast({ title: "Enter a valid quantity", variant: "destructive" }); return; }
    adjustMutation.mutate({
      id: adjustItem.id,
      body: {
        type: adjustForm.type,
        quantity: qty,
        notes: adjustForm.notes.trim() || null,
        recipientName: adjustForm.recipientName.trim() || null,
      },
    });
  }

  // ── Movement history sheet ──────────────────────────────────────────────────
  const [historyItem, setHistoryItem] = useState<StockItem | null>(null);
  const { data: movements = [], isLoading: movementsLoading } = useQuery<Movement[]>({
    queryKey: ["portal-stock-movements", historyItem?.id],
    queryFn: () => apiFetch(`/portal/stock/${historyItem!.id}/movements`),
    enabled: !!historyItem,
  });

  // ── Bulk order sheet ────────────────────────────────────────────────────────
  const [bulkOrderOpen, setBulkOrderOpen] = useState(false);
  const [bulkFocusKey, setBulkFocusKey] = useState<string | null>(null);
  // Key = "groupKey:size", value = quantity
  const [orderQtys, setOrderQtys] = useState<Record<string, number>>({});

  function openBulkOrder(focusGroup?: CardGroup) {
    setOrderQtys({});
    setBulkFocusKey(focusGroup?.key ?? null);
    setBulkOrderOpen(true);
  }

  // Pre-fill bulk order sheet with reorder quantities for items below minimum
  function handleGenerateReorderDraft() {
    const preQtys: Record<string, number> = {};
    for (const group of cardGroups) {
      if (!group.items.some(i => i.product_id != null)) continue;
      for (const item of group.items) {
        const isLow = item.min_quantity > 0 && item.stock_quantity <= item.min_quantity;
        if (!isLow) continue;
        const reorderQty = item.reorder_quantity > 0
          ? item.reorder_quantity
          : Math.max(item.min_quantity - item.stock_quantity, 1);
        const key = `${group.key}:${item.size ?? "—"}`;
        preQtys[key] = reorderQty;
      }
    }
    setOrderQtys(preQtys);
    setBulkFocusKey(null);
    setBulkOrderOpen(true);
  }

  const totalOrderLines = useMemo(
    () => Object.values(orderQtys).filter(q => q > 0).length,
    [orderQtys]
  );
  const totalOrderQty = useMemo(
    () => Object.values(orderQtys).reduce((s, q) => s + (q > 0 ? q : 0), 0),
    [orderQtys]
  );

  function handleContinueToOrder() {
    if (totalOrderQty === 0) {
      toast({ title: "No quantities entered", description: "Enter at least one quantity before continuing.", variant: "destructive" });
      return;
    }
    const basketItems: object[] = [];
    let skipped = 0;
    for (const [key, qty] of Object.entries(orderQtys)) {
      if (qty <= 0) continue;
      const colonIdx = key.lastIndexOf(":");
      const groupKey = key.substring(0, colonIdx);
      const size = key.substring(colonIdx + 1);
      const group = cardGroups.find(g => g.key === groupKey);
      if (!group) { skipped++; continue; }
      // Find matching store item (for price + metadata), fall back to first item in group
      const refItem = group.items.find(
        i => (i.size ?? "—").toLowerCase() === size.toLowerCase()
      ) ?? group.items[0];
      if (!refItem?.product_id) {
        skipped++;
        continue;
      }
      const resolvedPrice = resolveStockPrice(refItem, processes);
      const garmentBase = refItem.special_price != null && refItem.special_price !== ""
        ? parseFloat(refItem.special_price)
        : refItem.woo_price ? parseFloat(refItem.woo_price)
        : parseFloat(refItem.unit_price ?? "0");
      basketItems.push({
        productId: refItem.product_id,
        productName: refItem.product_name ?? refItem.name,
        sku: refItem.product_sku ?? null,
        colour: refItem.colour ?? "",
        size,
        finishId: refItem.finish_id ?? null,
        finishName: refItem.finish_name ?? "",
        recipientType: "stock",
        recipientName: "",
        recipientEmployeeId: null,
        quantity: qty,
        garmentBasePrice: garmentBase,
        processLines: [],
        unitPrice: resolvedPrice,
        imageUrl: refItem.variant_image_url ?? refItem.product_image_url ?? null,
      });
    }
    if (basketItems.length === 0) {
      toast({
        title: "Can't create order",
        description: skipped > 0
          ? `${skipped} item line${skipped !== 1 ? "s" : ""} could not be added because they are not linked to catalogue products. Please contact support to link these stock items.`
          : "No valid items found. Please try again.",
        variant: "destructive",
      });
      return;
    }
    if (skipped > 0) {
      toast({
        title: `${skipped} item${skipped !== 1 ? "s" : ""} skipped`,
        description: `${skipped} line${skipped !== 1 ? "s" : ""} could not be added as they are not linked to catalogue products.`,
        variant: "destructive",
      });
    }
    try {
      localStorage.setItem(PORTAL_SESSION_KEY, JSON.stringify({ step: 2, mode: "wardrobe", basket: basketItems }));
    } catch {
      toast({ title: "Storage error", description: "Could not save your basket. Please try again or reduce the number of items.", variant: "destructive" });
      return;
    }
    navigate("/orders/new");
  }

  const lowStockCount = items.filter(i => i.min_quantity > 0 && i.stock_quantity <= i.min_quantity).length;
  const reorderableCount = items.filter(i =>
    i.min_quantity > 0 && i.stock_quantity <= i.min_quantity && i.product_id != null
  ).length;
  const cardGroups = groupItems(items, sizeOrder);

  const bulkGroups = useMemo(() => {
    if (!bulkFocusKey) return cardGroups;
    const focused = cardGroups.find(g => g.key === bulkFocusKey);
    if (!focused) return cardGroups;
    return [focused, ...cardGroups.filter(g => g.key !== bulkFocusKey)];
  }, [cardGroups, bulkFocusKey]);

  return (
    <PortalLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Stores</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manage your store cupboard — items are automatically deducted when you place an order.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {reorderableCount > 0 && (
              <Button
                onClick={handleGenerateReorderDraft}
                className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
              >
                <AlertTriangle className="w-4 h-4" />
                Generate Reorder Draft
                <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-[11px] font-bold">
                  {reorderableCount}
                </span>
              </Button>
            )}
            {cardGroups.some(g => g.items.some(i => i.product_id != null)) && (
              <Button variant="outline" onClick={() => openBulkOrder()} className="gap-2">
                <ShoppingCart className="w-4 h-4" /> Bulk Order
              </Button>
            )}
            <Button onClick={() => setAddOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" /> Add Item
            </Button>
          </div>
        </div>

        {/* Low stock alert */}
        {lowStockCount > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <p className="text-sm text-amber-800 font-medium">
              {lowStockCount} item{lowStockCount !== 1 ? "s are" : " is"} at or below minimum stock level.
              Consider placing a top-up order.
            </p>
          </div>
        )}

        {/* Card grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        ) : cardGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
            <Package className="w-12 h-12 opacity-20" />
            <p className="font-medium">No items in your stores yet</p>
            <p className="text-sm">Add your first item to start tracking your store levels.</p>
            <Button variant="outline" onClick={() => setAddOpen(true)} className="gap-2 mt-2">
              <Plus className="w-4 h-4" /> Add Item
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {cardGroups.map(group => (
              <StockCard
                key={group.key}
                group={group}
                processes={processes}
                onAdjust={openAdjust}
                onHistory={setHistoryItem}
                onEdit={openEdit}
                onDelete={setDeleteItem}
                onReorder={openBulkOrder}
                onSaveLimits={handleSaveLimits}
              />
            ))}
          </div>
        )}

        {/* ── Add Item Dialog ──────────────────────────────────────────────── */}
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Add Item</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Item Name *</Label>
                <Input
                  placeholder="e.g. Embroidered Polo Shirt"
                  value={addForm.name}
                  onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Colour</Label>
                  <Input placeholder="e.g. Navy Blue" value={addForm.colour} onChange={e => setAddForm(f => ({ ...f, colour: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Size</Label>
                  <Input placeholder="e.g. XL" value={addForm.size} onChange={e => setAddForm(f => ({ ...f, size: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Initial Quantity</Label>
                  <Input type="number" min="0" value={addForm.initialQuantity} onChange={e => setAddForm(f => ({ ...f, initialQuantity: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Min Stock Level</Label>
                  <Input type="number" min="0" value={addForm.minQuantity} onChange={e => setAddForm(f => ({ ...f, minQuantity: e.target.value }))} placeholder="0 = no alert" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Reorder Quantity</Label>
                <Input
                  type="number" min="0"
                  value={addForm.reorderQuantity}
                  onChange={e => setAddForm(f => ({ ...f, reorderQuantity: e.target.value }))}
                  placeholder="How many to order when restocking"
                />
                <p className="text-[11px] text-muted-foreground">When stock hits the minimum, a draft order will suggest this quantity.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Storage Location</Label>
                <Input placeholder="e.g. Warehouse A, Shelf 3" value={addForm.location} onChange={e => setAddForm(f => ({ ...f, location: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea rows={2} placeholder="Any additional notes…" value={addForm.notes} onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button onClick={handleAdd} disabled={!addForm.name.trim() || addMutation.isPending}>
                {addMutation.isPending ? "Adding…" : "Add Item"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Edit Item Dialog ─────────────────────────────────────────────── */}
        <Dialog open={!!editItem} onOpenChange={v => !v && setEditItem(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Edit Item</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Item Name *</Label>
                <Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Colour</Label>
                  <Input value={editForm.colour} onChange={e => setEditForm(f => ({ ...f, colour: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Size</Label>
                  <Input value={editForm.size} onChange={e => setEditForm(f => ({ ...f, size: e.target.value }))} />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
                Min stock and reorder quantities are now edited directly on each size row on the Stores page.
              </p>
              <div className="space-y-1.5">
                <Label>Storage Location</Label>
                <Input value={editForm.location} onChange={e => setEditForm(f => ({ ...f, location: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea rows={2} value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
              <Button onClick={handleEdit} disabled={!editForm.name.trim() || editMutation.isPending}>
                {editMutation.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Delete Confirm Dialog ────────────────────────────────────────── */}
        <Dialog open={!!deleteItem} onOpenChange={v => !v && setDeleteItem(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Remove Item</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground py-2">
              Remove <strong>{deleteItem?.name}</strong>
              {deleteItem?.colour || deleteItem?.size
                ? ` (${[deleteItem?.colour, deleteItem?.size].filter(Boolean).join(", ")})`
                : ""}?
              This will also delete all movement history for this item.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteItem(null)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Removing…" : "Remove"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Adjust Stock Dialog ──────────────────────────────────────────── */}
        <Dialog open={!!adjustItem} onOpenChange={v => !v && setAdjustItem(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>
                Adjust — {adjustItem?.product_name ?? adjustItem?.name}
                {adjustItem?.size ? ` (${adjustItem.size})` : ""}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Movement Type</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(["in", "out", "adjustment"] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setAdjustForm(f => ({ ...f, type: t }))}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors capitalize",
                        adjustForm.type === t
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:bg-muted"
                      )}
                    >
                      {t === "in" && <ArrowUpCircle className="w-4 h-4" />}
                      {t === "out" && <ArrowDownCircle className="w-4 h-4" />}
                      {t === "adjustment" && <RefreshCw className="w-4 h-4" />}
                      {t === "in" ? "Stock In" : t === "out" ? "Stock Out" : "Adjustment"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Quantity</Label>
                <Input
                  type="number" min="1"
                  value={adjustForm.quantity}
                  onChange={e => setAdjustForm(f => ({ ...f, quantity: e.target.value }))}
                />
                {adjustItem && adjustForm.type === "out" && (
                  <p className="text-xs text-muted-foreground">
                    Current stock: <strong>{adjustItem.stock_quantity}</strong>
                    {parseInt(adjustForm.quantity) > adjustItem.stock_quantity
                      ? <span className="text-amber-600"> — this will go negative</span>
                      : null}
                  </p>
                )}
              </div>
              {adjustForm.type === "out" && (
                <div className="space-y-1.5">
                  <Label>Recipient Name <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input
                    placeholder="Who is this being issued to?"
                    value={adjustForm.recipientName}
                    onChange={e => setAdjustForm(f => ({ ...f, recipientName: e.target.value }))}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  placeholder="Reason for adjustment…"
                  value={adjustForm.notes}
                  onChange={e => setAdjustForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAdjustItem(null)}>Cancel</Button>
              <Button onClick={handleAdjust} disabled={adjustMutation.isPending}>
                {adjustMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Bulk Order Sheet ─────────────────────────────────────────────── */}
        <Sheet open={bulkOrderOpen} onOpenChange={v => { if (!v) setBulkOrderOpen(false); }}>
          <SheetContent className="w-full sm:max-w-xl overflow-y-auto flex flex-col">
            <SheetHeader className="mb-4 shrink-0">
              <SheetTitle className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5" /> Bulk Order from Stores
              </SheetTitle>
              <p className="text-sm text-muted-foreground">
                Enter how many of each item you'd like to reorder. Current stock levels are shown for reference.
              </p>
            </SheetHeader>

            <div className="flex-1 space-y-5 overflow-y-auto pb-24">
              {bulkGroups.filter(g => g.items.some(i => i.product_id != null)).map(group => (
                <div
                  key={group.key}
                  className={cn(
                    "rounded-xl border p-4",
                    bulkFocusKey === group.key ? "border-primary ring-1 ring-primary/20 bg-primary/5" : "bg-card"
                  )}
                >
                  {/* Group header */}
                  <div className="flex items-start gap-3 mb-3">
                    {group.imageUrl && (
                      <img
                        src={group.imageUrl}
                        alt={group.displayName}
                        className="w-12 h-12 rounded-lg object-contain border bg-white p-1 shrink-0"
                        onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-sm leading-snug">{group.displayName}</p>
                      {(group.colour || group.productSku) && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {[group.colour, group.productSku].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      {group.finishName && (
                        <p className="text-xs text-muted-foreground italic">{group.finishName}</p>
                      )}
                    </div>
                  </div>

                  {/* Size rows — sourced from catalogue variants */}
                  {(() => {
                    const catalogueSizes = getSizesForGroup(group, sizesMap);
                    const stockBySize = Object.fromEntries(
                      group.items.map(i => [(i.size ?? "—").toLowerCase(), i])
                    );
                    return (
                      <div className="space-y-2">
                        <div className="grid grid-cols-[80px_1fr_100px] gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-1">
                          <span>Size</span>
                          <span>In stock</span>
                          <span>Order qty</span>
                        </div>
                        {catalogueSizes.map(size => {
                          const qtyKey = `${group.key}:${size}`;
                          const qty = orderQtys[qtyKey] ?? 0;
                          const stockItem = stockBySize[size.toLowerCase()];
                          const stockQty = stockItem?.stock_quantity ?? 0;
                          const isLow = stockItem
                            ? stockItem.min_quantity > 0 && stockQty <= stockItem.min_quantity
                            : false;
                          return (
                            <div key={size} className="grid grid-cols-[80px_1fr_100px] items-center gap-2">
                              <span className={cn(
                                "rounded-md px-2 py-1 text-xs font-semibold text-center",
                                isLow ? "bg-amber-100 text-amber-800" : "bg-muted text-foreground"
                              )}>
                                {abbrevSize(size)}
                              </span>
                              <span className={cn(
                                "text-sm tabular-nums font-medium flex items-center gap-1",
                                isLow ? "text-amber-600" : "text-muted-foreground"
                              )}>
                                {stockQty}
                                {isLow && <TrendingDown className="w-3 h-3" />}
                              </span>
                              <Input
                                type="number"
                                min="0"
                                value={qty === 0 ? "" : qty}
                                placeholder="0"
                                className="h-8 text-sm text-center px-2 tabular-nums"
                                onChange={e => {
                                  const v = parseInt(e.target.value) || 0;
                                  setOrderQtys(prev => ({ ...prev, [qtyKey]: v < 0 ? 0 : v }));
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>

            {/* Sticky footer */}
            <div className="shrink-0 border-t bg-background pt-4 pb-2 space-y-3">
              {totalOrderQty > 0 && (
                <p className="text-sm text-muted-foreground text-center">
                  <span className="font-semibold text-foreground">{totalOrderQty}</span> item{totalOrderQty !== 1 ? "s" : ""} across{" "}
                  <span className="font-semibold text-foreground">{totalOrderLines}</span> line{totalOrderLines !== 1 ? "s" : ""}
                </p>
              )}
              <Button
                className="w-full gap-2"
                disabled={totalOrderQty === 0}
                onClick={handleContinueToOrder}
              >
                <ShoppingCart className="w-4 h-4" />
                {totalOrderQty > 0 ? `Continue to Order (${totalOrderQty} items)` : "Enter quantities above"}
              </Button>
            </div>
          </SheetContent>
        </Sheet>

        {/* ── Movement History Sheet ───────────────────────────────────────── */}
        <Sheet open={!!historyItem} onOpenChange={v => !v && setHistoryItem(null)}>
          <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
            <SheetHeader className="mb-4">
              <SheetTitle>
                Movement History — {historyItem?.product_name ?? historyItem?.name}
                {historyItem?.size ? ` (${historyItem.size})` : ""}
              </SheetTitle>
            </SheetHeader>

            {movementsLoading ? (
              <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
                <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
              </div>
            ) : movements.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <History className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p className="text-sm">No movements recorded yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {movements.map(m => {
                  const { label, color } = movementLabel(m.movement_type);
                  const sign = m.movement_type === "out" || m.movement_type === "issue" ? "-" : m.movement_type === "in" ? "+" : "±";
                  return (
                    <div key={m.id} className="rounded-lg border p-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn("text-xs font-semibold", color)}>{label}</span>
                          <span className="text-sm font-bold tabular-nums">{sign}{Math.abs(m.quantity)}</span>
                        </div>
                        {m.recipient_name && (
                          <p className="text-xs text-muted-foreground mt-0.5">Issued to: {m.recipient_name}</p>
                        )}
                        {m.reference && (
                          <p className="text-xs text-muted-foreground mt-0.5">Ref: {m.reference}</p>
                        )}
                        {m.notes && (
                          <p className="text-xs text-muted-foreground mt-0.5 italic">{m.notes}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {fmt(m.created_at)}{m.created_by_name ? ` · ${m.created_by_name}` : ""}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </PortalLayout>
  );
}
