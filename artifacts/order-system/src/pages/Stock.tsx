import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertTriangle, Search, Loader2, Package, Shirt, Pencil, Tag,
  Plus, Trash2, Printer, ChevronDown, ChevronUp, Eye, X, Box, FileText, Download,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { sortBySizeWithOrder } from "@/lib/sizeUtils";
import { useSizeOrder } from "@/hooks/useSizeOrder";

const API_BASE = "/api";
async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error((e as any).error || res.statusText);
  }
  return res.json();
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlainVariant {
  variantId: number;
  productId: number;
  productName: string;
  productSku: string | null;
  productImageUrl: string | null;
  colour: string | null;
  size: string | null;
  sleeve: string | null;
  wooVariationId: number | null;
  variantAttributes: Array<{ id: number | string | null; name: string; option: string }> | null;
  sku: string | null;
  supplierCode: string | null;
  stockQuantity: number;
  minStockQty: number;
  binLocation: string | null;
  updatedAt: string | null;
}

function attributeLabel(v: PlainVariant): string {
  if (!v.variantAttributes?.length) return v.wooVariationId != null ? `Woo #${v.wooVariationId}` : "";
  const projected = new Set([v.colour, v.size, v.sleeve].filter(Boolean).map(x => x!.toLowerCase()));
  const attrs = v.variantAttributes
    .filter(a => a.name && a.option && !projected.has(a.option.toLowerCase()))
    .map(a => `${a.name}: ${a.option}`);
  if (v.wooVariationId != null) attrs.push(`Woo #${v.wooVariationId}`);
  return attrs.join(" · ");
}

interface FinishedItem {
  id: number;
  customerId: number;
  customerName: string;
  name: string;
  productName: string | null;
  finishName: string | null;
  colour: string | null;
  size: string | null;
  unitPrice: number;
  stockQuantity: number;
  notes: string | null;
}

interface StockBin {
  id: number;
  binNumber: string;
  notes: string | null;
  maxQty: number;
  totalQty: number;
  variantCount: number;
  isOverCapacity: boolean;
  createdAt: string;
}

interface BinWithContents extends StockBin {
  contents: PlainVariant[];
}

interface BinSuggestion {
  id: number;
  binNumber: string;
  notes: string | null;
  maxQty: number;
  currentQty: number;
  afterQty: number;
  available: number;
  isCurrent: boolean;
  wouldOverflow: boolean;
}

// ─── Inline editable qty cell ─────────────────────────────────────────────────

function InlineQty({ value, onSave, low }: { value: number; onSave: (qty: number) => void; low: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  const commit = () => {
    const num = parseInt(draft, 10);
    if (!isNaN(num) && num >= 0 && num !== value) onSave(num);
    else setDraft(String(value));
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        type="number" min={0} value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onFocus={e => e.currentTarget.select()}
        onKeyDown={e => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setDraft(String(value)); setEditing(false); }
        }}
        onClick={e => e.stopPropagation()}
        className="w-16 text-right border border-primary rounded px-2 py-0.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
        autoFocus
      />
    );
  }

  return (
    <button
      onClick={e => { e.stopPropagation(); setDraft(String(value)); setEditing(true); }}
      className={cn(
        "inline-flex items-center gap-1 tabular-nums font-mono text-sm px-2 py-0.5 rounded",
        "border border-transparent hover:border-border hover:bg-muted transition-colors cursor-pointer group/qty",
        low ? "text-amber-700 font-semibold" : "text-foreground"
      )}
      title="Click to edit"
    >
      {low && <AlertTriangle className="w-3 h-3 text-amber-500" />}
      {value}
      <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover/qty:opacity-60 transition-opacity" />
    </button>
  );
}

// ─── Inline bin location cell ─────────────────────────────────────────────────

function InlineBin({
  value, onSave, variantId,
}: { value: string | null; onSave: (bin: string | null) => void; variantId: number }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [suggestions, setSuggestions] = useState<BinSuggestion[]>([]);

  const startEdit = async () => {
    setDraft(value ?? "");
    setEditing(true);
    try {
      const data = await apiFetch<BinSuggestion[]>(`/stock/bins/suggest?variantId=${variantId}&qty=1`);
      setSuggestions(data);
    } catch {
      setSuggestions([]);
    }
  };

  const commit = () => {
    const trimmed = draft.trim() || null;
    if (trimmed !== value) onSave(trimmed);
    else setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-1" onClick={e => e.stopPropagation()}>
        <div className="flex gap-1 items-center">
          <input
            type="text" value={draft}
            onChange={e => setDraft(e.target.value.toUpperCase())}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder="e.g. A-001"
            className="w-24 border border-primary rounded px-2 py-0.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary uppercase"
            autoFocus
          />
          <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground">
            <X className="w-3 h-3" />
          </button>
        </div>
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {suggestions.slice(0, 4).map(s => (
              <button
                key={s.id}
                onMouseDown={e => { e.preventDefault(); onSave(s.binNumber); setEditing(false); }}
                className={cn(
                  "text-xs px-1.5 py-0.5 rounded border font-mono",
                  s.isCurrent
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-muted text-foreground hover:bg-muted/80"
                )}
                title={`${s.afterQty}/${s.maxQty} after`}
              >
                {s.binNumber}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={e => { e.stopPropagation(); startEdit(); }}
      className={cn(
        "inline-flex items-center gap-1 text-sm px-2 py-0.5 rounded font-mono",
        "border border-transparent hover:border-border hover:bg-muted transition-colors cursor-pointer group/bin"
      )}
      title="Click to set bin location"
    >
      {value ? (
        <span className="text-primary font-semibold">{value}</span>
      ) : (
        <span className="text-muted-foreground italic text-xs">—</span>
      )}
      <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover/bin:opacity-60 transition-opacity" />
    </button>
  );
}

// ─── Quick-adjust modal for stock take ────────────────────────────────────────

interface QuickAdjustRow {
  variantId: number;
  colour: string | null;
  size: string | null;
  supplierCode: string | null;
  stockQuantity: number;
  minStockQty: number;
  binLocation: string | null;
  draft: string;
  minDraft: string;
  binDraft: string;
  changed: boolean;
}

function QuickAdjustModal({
  productName, productSku, variants, onClose, onSave,
}: {
  productName: string;
  productSku: string | null;
  variants: PlainVariant[];
  onClose: () => void;
  onSave: (updates: { variantId: number; stockQuantity: number; minStockQty: number; binLocation: string | null }[]) => void;
}) {
  const sizeOrder = useSizeOrder();
  const sorted = sortBySizeWithOrder(variants, v => v.size, sizeOrder);

  const [colourFilter, setColourFilter] = useState<string>("");
  const [sizeFilter, setSizeFilter] = useState<string>("");

  const uniqueColours = useMemo(
    () => Array.from(new Set(sorted.map(v => v.colour ?? "")).values()).filter(Boolean).sort(),
    [sorted],
  );
  const uniqueSizes = useMemo(
    () => sortBySizeWithOrder(
      Array.from(new Set(sorted.map(v => v.size ?? "")).values()).filter(Boolean),
      s => s,
      sizeOrder,
    ),
    [sorted, sizeOrder],
  );

  const [rows, setRows] = useState<QuickAdjustRow[]>(
    sorted.map(v => ({
      variantId: v.variantId,
      colour: v.colour,
      size: v.size,
      supplierCode: v.supplierCode,
      stockQuantity: v.stockQuantity,
      minStockQty: v.minStockQty,
      binLocation: v.binLocation,
      draft: String(v.stockQuantity),
      minDraft: String(v.minStockQty),
      binDraft: v.binLocation ?? "",
      changed: false,
    }))
  );

  const update = (idx: number, field: "draft" | "minDraft" | "binDraft", val: string) => {
    setRows(r => {
      const next = [...r];
      next[idx] = { ...next[idx], [field]: field === "binDraft" ? val.toUpperCase() : val, changed: true };
      return next;
    });
  };

  const handleSave = () => {
    const updates = rows
      .filter(r => r.changed)
      .map(r => ({
        variantId: r.variantId,
        stockQuantity: Math.max(0, parseInt(r.draft, 10) || 0),
        minStockQty: Math.max(0, parseInt(r.minDraft, 10) || 0),
        binLocation: r.binDraft.trim() || null,
      }));
    onSave(updates);
  };

  const changedCount = rows.filter(r => r.changed).length;

  const visibleRows = useMemo(
    () => rows.filter(r =>
      (!colourFilter || r.colour === colourFilter) &&
      (!sizeFilter || r.size === sizeFilter)
    ),
    [rows, colourFilter, sizeFilter],
  );

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-2xl flex flex-col max-h-[85vh]" onInteractOutside={e => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            Stock Take — {productName}
            {productSku && <span className="text-sm font-mono text-muted-foreground ml-2">{productSku}</span>}
          </DialogTitle>
        </DialogHeader>

        {/* Filters */}
        {(uniqueColours.length > 1 || uniqueSizes.length > 1) && (
          <div className="flex items-center gap-2 flex-wrap -mt-1 mb-1">
            {uniqueColours.length > 1 && (
              <select
                value={colourFilter}
                onChange={e => setColourFilter(e.target.value)}
                className="border border-border rounded px-2 py-1 text-sm bg-background focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
              >
                <option value="">All colours</option>
                {uniqueColours.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            {uniqueSizes.length > 1 && (
              <select
                value={sizeFilter}
                onChange={e => setSizeFilter(e.target.value)}
                className="border border-border rounded px-2 py-1 text-sm bg-background focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
              >
                <option value="">All sizes</option>
                {uniqueSizes.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            {(colourFilter || sizeFilter) && (
              <button
                onClick={() => { setColourFilter(""); setSizeFilter(""); }}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                Clear
              </button>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              {visibleRows.length} of {rows.length} variant{rows.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}

        <div className="overflow-y-auto flex-1 -mx-6 px-6">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Colour</TableHead>
                <TableHead>Size</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Min</TableHead>
                <TableHead>Bin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => {
                const idx = rows.findIndex(r => r.variantId === row.variantId);
                return (
                  <TableRow key={row.variantId} className={cn(row.changed && "bg-primary/5")}>
                    <TableCell className="text-sm">{row.colour ?? "—"}</TableCell>
                    <TableCell className="text-sm font-medium">{row.size ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <input
                        type="number" min={0} value={row.draft}
                        onChange={e => update(idx, "draft", e.target.value)}
                        onFocus={e => e.currentTarget.select()}
                        className="w-16 text-right border border-border rounded px-2 py-1 text-sm font-mono focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <input
                        type="number" min={0} value={row.minDraft}
                        onChange={e => update(idx, "minDraft", e.target.value)}
                        onFocus={e => e.currentTarget.select()}
                        className="w-14 text-right border border-border rounded px-2 py-1 text-sm font-mono focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
                      />
                    </TableCell>
                    <TableCell>
                      <input
                        type="text" value={row.binDraft}
                        onChange={e => update(idx, "binDraft", e.target.value)}
                        placeholder="e.g. A-001"
                        className="w-20 border border-border rounded px-2 py-1 text-sm font-mono uppercase focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {visibleRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                    No variants match the current filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <DialogFooter className="gap-2 mt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={changedCount === 0}>
            Save {changedCount > 0 ? `${changedCount} change${changedCount !== 1 ? "s" : ""}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Plain stock tab ──────────────────────────────────────────────────────────

function PlainStockTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const sizeOrder = useSizeOrder();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [collapsedProducts, setCollapsedProducts] = useState<Set<number>>(new Set());
  const [reportOpen, setReportOpen] = useState(false);
  const [reportFilters, setReportFilters] = useState({ q: "", colour: "", size: "", bin: "", state: "all" });

  const reportUrl = () => {
    const params = new URLSearchParams();
    const values = { ...reportFilters, q: reportFilters.q.trim() };
    Object.entries(values).forEach(([key, value]) => { if (value && !(key === "state" && value === "all")) params.set(key, value); });
    return `${API_BASE}/stock/report.pdf${params.toString() ? `?${params.toString()}` : ""}`;
  };

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data: variants = [], isLoading } = useQuery<PlainVariant[]>({
    queryKey: ["stock-plain", debouncedSearch || null, showAll],
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (showAll) params.set("all", "1");
      const qs = params.toString();
      return apiFetch(`/stock/plain${qs ? `?${qs}` : ""}`);
    },
    staleTime: 30_000,
  });
  const [adjustingProduct, setAdjustingProduct] = useState<{ productId: number; productName: string; productSku: string | null } | null>(null);

  const updateMut = useMutation({
    mutationFn: (body: { variantId: number; stockQuantity?: number; binLocation?: string | null; minStockQty?: number }) =>
      apiFetch(`/stock/plain/${body.variantId}`, {
        method: "PATCH",
        body: JSON.stringify({
          stockQuantity: body.stockQuantity,
          binLocation: body.binLocation,
          minStockQty: body.minStockQty,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock-plain"] });
      qc.invalidateQueries({ queryKey: ["stock-bins"] });
    },
    onError: () => toast({ title: "Failed to update stock", variant: "destructive" }),
  });

  const handleBulkSave = async (
    productId: number,
    updates: { variantId: number; stockQuantity: number; minStockQty: number; binLocation: string | null }[]
  ) => {
    try {
      await Promise.all(updates.map(u =>
        apiFetch(`/stock/plain/${u.variantId}`, {
          method: "PATCH",
          body: JSON.stringify({ stockQuantity: u.stockQuantity, minStockQty: u.minStockQty, binLocation: u.binLocation }),
        })
      ));
      qc.invalidateQueries({ queryKey: ["stock-plain"] });
      qc.invalidateQueries({ queryKey: ["stock-bins"] });
      toast({ title: "Stock updated", description: `${updates.length} variant${updates.length !== 1 ? "s" : ""} updated` });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    }
    setAdjustingProduct(null);
  };

  // Search is now server-side — just group the returned variants by product
  type ProductGroup = { productId: number; productName: string; productSku: string | null; productImageUrl: string | null; variants: PlainVariant[] };
  const byProduct = useMemo(() => Object.values(
    variants.reduce<Record<number, ProductGroup>>((acc, v) => {
      if (!acc[v.productId]) acc[v.productId] = {
        productId: v.productId, productName: v.productName,
        productSku: v.productSku, productImageUrl: v.productImageUrl, variants: [],
      };
      acc[v.productId].variants.push(v);
      return acc;
    }, {})
  ), [variants]);

  const lowCount = useMemo(() => variants.filter(v => v.stockQuantity <= v.minStockQty).length, [variants]);
  const totalUnits = useMemo(() => variants.reduce((s, v) => s + v.stockQuantity, 0), [variants]);

  const toggleCollapse = (productId: number) => {
    setCollapsedProducts(prev => {
      const next = new Set(prev);
      next.has(productId) ? next.delete(productId) : next.add(productId);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {adjustingProduct && (() => {
        const pvs = variants.filter(v => v.productId === adjustingProduct.productId);
        return (
          <QuickAdjustModal
            productName={adjustingProduct.productName}
            productSku={adjustingProduct.productSku}
            variants={pvs}
            onClose={() => setAdjustingProduct(null)}
            onSave={(updates) => handleBulkSave(adjustingProduct.productId, updates)}
          />
        );
      })()}

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2"><FileText className="w-5 h-5 text-primary" /> Stock Report PDF</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Choose filters for a printable plain stock report. Costs and prices are never included.</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1"><Label>Search / code</Label><Input value={reportFilters.q} onChange={e => setReportFilters(f => ({ ...f, q: e.target.value }))} placeholder="Product, SKU or supplier code" /></div>
            <div className="space-y-1"><Label>Colour</Label><Input value={reportFilters.colour} onChange={e => setReportFilters(f => ({ ...f, colour: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Size / sleeve</Label><Input value={reportFilters.size} onChange={e => setReportFilters(f => ({ ...f, size: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Bin</Label><Input value={reportFilters.bin} onChange={e => setReportFilters(f => ({ ...f, bin: e.target.value }))} /></div>
            <div className="space-y-1"><Label>State</Label>
              <select value={reportFilters.state} onChange={e => setReportFilters(f => ({ ...f, state: e.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">All states</option><option value="out">Out of stock</option><option value="low">Low stock</option><option value="ok">OK stock</option>
              </select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReportOpen(false)}>Cancel</Button>
            <Button variant="outline" asChild><a href={reportUrl()} target="_blank" rel="noopener noreferrer"><FileText className="w-4 h-4 mr-1" /> Open PDF</a></Button>
            <Button asChild><a href={reportUrl()} download="plain-stock-report.pdf"><Download className="w-4 h-4 mr-1" /> Download PDF</a></Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search SKU, garment name or supplier code…"
            className="pl-9"
            value={search}
            onChange={e => { setSearch(e.target.value); if (e.target.value) setShowAll(false); }}
          />
          {isLoading && search && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />
          )}
        </div>
        <Button
          variant="default"
          className="gap-2 shrink-0"
          onClick={() => {
            setReportFilters(f => ({ ...f, q: f.q || search }));
            setReportOpen(true);
          }}
        >
          <FileText className="w-4 h-4" /> Stock Report PDF
        </Button>
        <div className="flex gap-2 items-center text-sm text-muted-foreground shrink-0">
          <span>{totalUnits.toLocaleString()} units total</span>
          {lowCount > 0 && (
            <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 gap-1">
              <AlertTriangle className="w-3 h-3" />{lowCount} low/out of stock
            </Badge>
          )}
          {!search && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground transition-colors"
              title="Load all 30k+ products from WooCommerce"
            >
              Show all products
            </button>
          )}
          {showAll && (
            <button
              onClick={() => setShowAll(false)}
              className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              Show active only
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
      ) : byProduct.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <Package className="w-12 h-12 text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground">{search ? "No variants match your search." : "No product variants found."}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {byProduct.map(pg => {
            const sorted = sortBySizeWithOrder(pg.variants, v => v.size, sizeOrder);
            const productTotal = pg.variants.reduce((s, v) => s + v.stockQuantity, 0);
            const hasLow = pg.variants.some(v => v.stockQuantity <= v.minStockQty);
            const isCollapsed = collapsedProducts.has(pg.productId);

            // Group by colour for display
            const colourMap = new Map<string, PlainVariant[]>();
            for (const v of sorted) {
              const c = v.colour ?? "—";
              if (!colourMap.has(c)) colourMap.set(c, []);
              colourMap.get(c)!.push(v);
            }
            const colours = [...colourMap.keys()];

            return (
              <div key={pg.productId} className="border rounded-lg bg-card shadow-sm overflow-hidden">
                {/* Product header */}
                <div
                  className="flex items-center gap-3 px-4 py-3 bg-muted/30 border-b cursor-pointer select-none hover:bg-muted/50 transition-colors"
                  onClick={() => toggleCollapse(pg.productId)}
                >
                  {/* Thumbnail */}
                  <div className="w-10 h-10 rounded border bg-white flex-shrink-0 overflow-hidden">
                    {pg.productImageUrl ? (
                      <img src={pg.productImageUrl} alt="" className="w-full h-full object-contain" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package className="w-5 h-5 text-muted-foreground/40" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{pg.productName}</span>
                      {pg.productSku && (
                        <span className="font-mono text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded">{pg.productSku}</span>
                      )}
                      {hasLow && (
                        <Badge variant="outline" className="border-amber-300 text-amber-600 bg-amber-50 text-xs gap-0.5">
                          <AlertTriangle className="w-2.5 h-2.5" /> Low
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {colours.length} colour{colours.length !== 1 ? "s" : ""} · {pg.variants.length} variant{pg.variants.length !== 1 ? "s" : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn(
                      "text-sm font-mono font-semibold tabular-nums",
                      productTotal === 0 ? "text-red-600" : hasLow ? "text-amber-600" : "text-foreground"
                    )}>
                      {productTotal} total
                    </span>
                    <Button
                      size="sm" variant="outline"
                      className="h-7 text-xs gap-1 shrink-0"
                      onClick={e => {
                        e.stopPropagation();
                        setAdjustingProduct({ productId: pg.productId, productName: pg.productName, productSku: pg.productSku });
                      }}
                    >
                      <Pencil className="w-3 h-3" /> Stock Take
                    </Button>
                    {isCollapsed
                      ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      : <ChevronUp className="w-4 h-4 text-muted-foreground" />
                    }
                  </div>
                </div>

                {/* Variant rows — visible when not collapsed */}
                {!isCollapsed && (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent text-xs">
                        <TableHead className="w-32">Colour</TableHead>
                        <TableHead className="w-24">Size</TableHead>
                        <TableHead className="w-28 hidden sm:table-cell">Sleeve / attributes</TableHead>
                        <TableHead className="w-28 hidden md:table-cell">Supplier Code</TableHead>
                        <TableHead className="text-right w-20">Qty</TableHead>
                        <TableHead className="text-right w-16 hidden sm:table-cell">Min</TableHead>
                        <TableHead className="w-28">Bin</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {colours.map((colour, ci) => {
                        const colourRows = colourMap.get(colour)!;
                        return colourRows.map((v, vi) => {
                          const isLow = v.stockQuantity <= v.minStockQty;
                          return (
                            <TableRow
                              key={v.variantId}
                              className={cn(
                                "hover:bg-muted/20",
                                isLow && "bg-amber-50/50",
                                vi === 0 && ci > 0 && "border-t-2 border-muted"
                              )}
                            >
                              <TableCell className={cn("text-sm", vi === 0 ? "font-medium" : "text-transparent select-none")}>
                                {vi === 0 ? colour : "·"}
                              </TableCell>
                              <TableCell className="text-sm font-medium">{v.size ?? "—"}</TableCell>
                              <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">
                                {(v.sleeve ?? attributeLabel(v)) || "—"}
                              </TableCell>
                              <TableCell className="hidden md:table-cell font-mono text-xs text-muted-foreground">
                                {v.supplierCode ?? "—"}
                              </TableCell>
                              <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                                <InlineQty
                                  value={v.stockQuantity}
                                  low={isLow}
                                  onSave={(qty) => updateMut.mutate({ variantId: v.variantId, stockQuantity: qty })}
                                />
                              </TableCell>
                              <TableCell className="text-right hidden sm:table-cell">
                                <span className="text-xs text-muted-foreground tabular-nums font-mono">{v.minStockQty}</span>
                              </TableCell>
                              <TableCell onClick={e => e.stopPropagation()}>
                                <InlineBin
                                  value={v.binLocation}
                                  variantId={v.variantId}
                                  onSave={(bin) => updateMut.mutate({ variantId: v.variantId, binLocation: bin })}
                                />
                              </TableCell>
                              <TableCell>
                                <button
                                  onClick={() => window.open(`/api/stock/plain/${v.variantId}/label`, "_blank")}
                                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                  title="Print stock label"
                                >
                                  <Printer className="w-3.5 h-3.5" />
                                </button>
                              </TableCell>
                            </TableRow>
                          );
                        });
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Bin View tab ─────────────────────────────────────────────────────────────

function CreateBinDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({ binNumber: "", notes: "", maxQty: "15" });
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!form.binNumber.trim()) return;
    setSaving(true);
    try {
      await apiFetch("/stock/bins", {
        method: "POST",
        body: JSON.stringify({
          binNumber: form.binNumber.trim().toUpperCase(),
          notes: form.notes.trim() || undefined,
          maxQty: parseInt(form.maxQty, 10) || 15,
        }),
      });
      toast({ title: `Bin ${form.binNumber} created` });
      setForm({ binNumber: "", notes: "", maxQty: "15" });
      onCreated();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: e.message || "Failed to create bin", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Create New Bin</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label htmlFor="binNumber">Bin Number *</Label>
            <Input
              id="binNumber"
              placeholder="e.g. A-001"
              value={form.binNumber}
              onChange={e => setForm(f => ({ ...f, binNumber: e.target.value.toUpperCase() }))}
              className="font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="maxQty">Max Capacity (items)</Label>
            <Input
              id="maxQty" type="number" min={1}
              value={form.maxQty}
              onChange={e => setForm(f => ({ ...f, maxQty: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="binNotes">Notes (optional)</Label>
            <Input
              id="binNotes"
              placeholder="e.g. Top shelf, section 3"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!form.binNumber.trim() || saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Bin"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BinDetailDialog({ binId, onClose }: { binId: number; onClose: () => void }) {
  const { data, isLoading } = useQuery<BinWithContents>({
    queryKey: ["stock-bin-detail", binId],
    queryFn: () => apiFetch(`/stock/bins/${binId}`),
  });

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-2xl flex flex-col max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Box className="w-5 h-5 text-primary" />
            {isLoading ? "Loading…" : `Bin ${data?.binNumber}`}
            {data && !isLoading && (
              <Badge
                variant="outline"
                className={cn(
                  "ml-2 text-xs",
                  data.isOverCapacity
                    ? "border-red-300 text-red-700 bg-red-50"
                    : "border-green-300 text-green-700 bg-green-50"
                )}
              >
                {data.totalQty}/{data.maxQty} items
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : !data ? null : (
          <div className="overflow-y-auto flex-1">
            {data.notes && <p className="text-sm text-muted-foreground mb-3">{data.notes}</p>}
            {data.contents.length === 0 ? (
              <p className="text-center text-muted-foreground py-8 text-sm">This bin is empty.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Product</TableHead>
                    <TableHead>Colour</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead className="hidden sm:table-cell">Supplier Code</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.contents.map(v => (
                    <TableRow key={v.variantId}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {v.productImageUrl ? (
                            <img src={v.productImageUrl} alt="" className="w-7 h-7 object-contain rounded border" />
                          ) : (
                            <div className="w-7 h-7 bg-muted rounded border flex items-center justify-center">
                              <Package className="w-3.5 h-3.5 text-muted-foreground/50" />
                            </div>
                          )}
                          <div>
                            <div className="text-sm font-medium leading-tight">{v.productName}</div>
                            {v.productSku && <div className="text-xs font-mono text-primary">{v.productSku}</div>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{v.colour ?? "—"}</TableCell>
                      <TableCell className="text-sm font-medium">{v.size ?? "—"}</TableCell>
                      <TableCell className="hidden sm:table-cell font-mono text-xs text-muted-foreground">{v.supplierCode ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <span className={cn(
                          "tabular-nums font-mono text-sm font-semibold",
                          v.stockQuantity <= v.minStockQty ? "text-amber-600" : "text-foreground"
                        )}>
                          {v.stockQuantity <= v.minStockQty && <AlertTriangle className="w-3 h-3 inline mr-0.5 text-amber-500" />}
                          {v.stockQuantity}
                        </span>
                      </TableCell>
                      <TableCell>
                        <button
                          onClick={() => window.open(`/api/stock/plain/${v.variantId}/label`, "_blank")}
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          title="Print stock label"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
        <DialogFooter>
          {data && (
            <div className="flex gap-2 mr-auto">
              <Button variant="outline" size="sm" className="gap-1.5"
                onClick={() => window.open(`/api/stock/bins/${binId}/label`, "_blank")}
              >
                <Tag className="w-3.5 h-3.5" /> Bin Label
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5"
                onClick={() => window.open(`/api/stock/bins/${binId}/report`, "_blank")}
              >
                <Printer className="w-3.5 h-3.5" /> Stock Report
              </Button>
            </div>
          )}
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BinViewTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [viewBinId, setViewBinId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const { data: bins = [], isLoading } = useQuery<StockBin[]>({
    queryKey: ["stock-bins"],
    queryFn: () => apiFetch("/stock/bins"),
    staleTime: 0, // always re-fetch when tab becomes active so new bins appear immediately
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/stock/bins/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      const bin = bins.find(b => b.id === id);
      toast({ title: `Bin ${bin?.binNumber ?? ""} deleted` });
      qc.invalidateQueries({ queryKey: ["stock-bins"] });
    },
    onError: (e: any) => toast({ title: e.message || "Cannot delete bin", variant: "destructive" }),
  });

  const filtered = bins.filter(b =>
    !search || b.binNumber.toLowerCase().includes(search.toLowerCase()) || b.notes?.toLowerCase().includes(search.toLowerCase())
  );

  const totalBins = bins.length;
  const overCapacity = bins.filter(b => b.isOverCapacity).length;
  const emptyBins = bins.filter(b => b.totalQty === 0).length;

  return (
    <div className="space-y-4">
      {createOpen && (
        <CreateBinDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={() => qc.invalidateQueries({ queryKey: ["stock-bins"] })}
        />
      )}
      {viewBinId !== null && (
        <BinDetailDialog binId={viewBinId} onClose={() => setViewBinId(null)} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search bin number…"
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 items-center text-sm text-muted-foreground">
          <span>{totalBins} bin{totalBins !== 1 ? "s" : ""}</span>
          {overCapacity > 0 && (
            <Badge variant="outline" className="border-red-300 text-red-700 bg-red-50 gap-1">
              <AlertTriangle className="w-3 h-3" />{overCapacity} over capacity
            </Badge>
          )}
          {emptyBins > 0 && (
            <Badge variant="outline" className="text-muted-foreground gap-1">
              {emptyBins} empty
            </Badge>
          )}
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 ml-auto"
          onClick={() => window.open("/api/stock/bins/report", "_blank")}
          title="Print stock report for all bins"
        >
          <Printer className="w-4 h-4" /> All Bins Report
        </Button>
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> New Bin
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <Box className="w-12 h-12 text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground text-sm">
            {search ? "No bins match your search." : "No bins set up yet. Create your first bin to start managing stock locations."}
          </p>
          {!search && (
            <Button className="mt-4 gap-1.5" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" /> Create First Bin
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filtered.map(bin => {
            const pct = Math.min(100, Math.round((bin.totalQty / bin.maxQty) * 100));
            const isEmpty = bin.totalQty === 0;
            const isWarn = pct >= 80 && !bin.isOverCapacity;

            return (
              <div
                key={bin.id}
                className={cn(
                  "relative group border rounded-xl p-4 flex flex-col gap-2 bg-card shadow-sm cursor-pointer",
                  "hover:shadow-md hover:border-primary/40 transition-all",
                  bin.isOverCapacity ? "border-red-300 bg-red-50/30" : "",
                  isEmpty ? "opacity-70" : ""
                )}
                onClick={() => setViewBinId(bin.id)}
              >
                {/* Bin number */}
                <div className="flex items-start justify-between gap-1">
                  <div className={cn(
                    "text-2xl font-black font-mono tracking-tight leading-none",
                    bin.isOverCapacity ? "text-red-700" : "text-foreground"
                  )}>
                    {bin.binNumber}
                  </div>
                  {bin.isOverCapacity && (
                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  )}
                </div>

                {/* Capacity bar */}
                <div className="space-y-1">
                  <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        bin.isOverCapacity ? "bg-red-500" : isWarn ? "bg-amber-400" : "bg-primary"
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex justify-between items-center">
                    <span className={cn(
                      "text-xs font-semibold tabular-nums",
                      bin.isOverCapacity ? "text-red-600" : isWarn ? "text-amber-600" : "text-foreground"
                    )}>
                      {bin.totalQty}/{bin.maxQty}
                    </span>
                    {bin.variantCount > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {bin.variantCount} sku{bin.variantCount !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>

                {bin.notes && (
                  <p className="text-xs text-muted-foreground truncate">{bin.notes}</p>
                )}

                {/* Hover actions */}
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={e => { e.stopPropagation(); window.open(`/api/stock/bins/${bin.id}/label`, "_blank"); }}
                    className="p-1 rounded bg-background border border-border shadow-sm text-muted-foreground hover:text-foreground transition-colors"
                    title="Print bin label"
                  >
                    <Tag className="w-3 h-3" />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); if (confirm(`Delete bin ${bin.binNumber}?`)) deleteMut.mutate(bin.id); }}
                    className="p-1 rounded bg-background border border-border shadow-sm text-muted-foreground hover:text-red-600 transition-colors"
                    title="Delete bin"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Finish stock tab ─────────────────────────────────────────────────────────

function FinishStockTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const { data: items = [], isLoading } = useQuery<FinishedItem[]>({
    queryKey: ["stock-finished"],
    queryFn: () => apiFetch("/stock/finished"),
    staleTime: 30_000,
  });

  const updateMut = useMutation({
    mutationFn: ({ id, stockQuantity }: { id: number; stockQuantity: number }) =>
      apiFetch(`/stock/finished/${id}`, { method: "PATCH", body: JSON.stringify({ stockQuantity }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stock-finished"] }),
    onError: () => toast({ title: "Failed to update stock", variant: "destructive" }),
  });

  const filtered = items.filter(item => {
    const q = search.toLowerCase();
    return !q || [item.name, item.customerName, item.productName, item.finishName, item.colour, item.size].some(s => s?.toLowerCase().includes(q));
  });

  const grouped = filtered.reduce<Record<string, FinishedItem[]>>((acc, item) => {
    const key = `${item.customerId}__${item.customerName}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const lowCount = items.filter(i => i.stockQuantity <= 5).length;
  const totalUnits = items.reduce((s, i) => s + i.stockQuantity, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search customer, item, colour, size…"
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 items-center text-sm text-muted-foreground shrink-0">
          <span>{totalUnits.toLocaleString()} units total</span>
          {lowCount > 0 && (
            <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 gap-1">
              <AlertTriangle className="w-3 h-3" />{lowCount} low stock
            </Badge>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <Shirt className="w-12 h-12 text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground text-sm text-center max-w-sm">
            {search
              ? "No items match your search."
              : "No finished stock items yet. Add items to customer wardrobes and set a stock quantity."}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(grouped).map(([key, customerItems]) => {
            const [, customerName] = key.split("__");
            const customerTotal = customerItems.reduce((s, i) => s + i.stockQuantity, 0);
            const hasLow = customerItems.some(i => i.stockQuantity <= 5);
            return (
              <div key={key} className="border rounded-lg shadow-sm overflow-hidden bg-card">
                <div className="px-4 py-3 bg-muted/30 border-b flex items-center gap-2">
                  <Shirt className="w-4 h-4 text-muted-foreground" />
                  <span className="font-semibold text-sm flex-1">{customerName}</span>
                  {hasLow && (
                    <Badge variant="outline" className="border-amber-300 text-amber-600 bg-amber-50 text-xs gap-1">
                      <AlertTriangle className="w-2.5 h-2.5" /> Low
                    </Badge>
                  )}
                  <span className="text-sm text-muted-foreground tabular-nums">{customerTotal} total</span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Item</TableHead>
                      <TableHead className="hidden md:table-cell">Base Product</TableHead>
                      <TableHead className="hidden lg:table-cell">Finish</TableHead>
                      <TableHead className="hidden sm:table-cell">Colour / Size</TableHead>
                      <TableHead className="text-right">Stock Qty</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customerItems.map(item => (
                      <TableRow key={item.id} className="group">
                        <TableCell className="font-medium text-sm">{item.name}</TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{item.productName || "—"}</TableCell>
                        <TableCell className="hidden lg:table-cell text-sm">
                          {item.finishName
                            ? <Badge variant="outline" className="text-xs font-normal">{item.finishName}</Badge>
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                          {[item.colour, item.size].filter(Boolean).join(" / ") || "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <InlineQty
                            value={item.stockQuantity}
                            low={item.stockQuantity <= 5}
                            onSave={(qty) => updateMut.mutate({ id: item.id, stockQuantity: qty })}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Stock() {
  return (
    <Layout>
      <div className="flex flex-col space-y-6">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Stock</h1>
          <p className="text-muted-foreground mt-1">
            Manage stock levels, bin locations, and labels for plain and finished goods.
          </p>
        </div>

        <Tabs defaultValue="plain">
          <TabsList className="mb-2">
            <TabsTrigger value="plain" className="gap-1.5">
              <Package className="w-4 h-4" /> Plain Stock
            </TabsTrigger>
            <TabsTrigger value="finish" className="gap-1.5">
              <Shirt className="w-4 h-4" /> Finish Stock
            </TabsTrigger>
            <TabsTrigger value="bins" className="gap-1.5">
              <Box className="w-4 h-4" /> Bin View
            </TabsTrigger>
          </TabsList>
          <TabsContent value="plain"><PlainStockTab /></TabsContent>
          <TabsContent value="finish"><FinishStockTab /></TabsContent>
          <TabsContent value="bins"><BinViewTab /></TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
