import { useState } from "react";
import Layout from "@/components/Layout";
import { KitDesignerText } from "@/components/KitDesignerText";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { usePriceConfirm } from "@/components/PriceConfirmDialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Plus, Pencil, Trash2, Box, Check, Package2 } from "lucide-react";
import { cn } from "@/lib/utils";

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

type Bundle = {
  id: number;
  name: string;
  sku: string | null;
  description: string | null;
  price: string | number;
  is_active: boolean;
  notes: string | null;
  component_count: number;
  total_cost: string | number | null;
  components_priced: number;
};

function gpColor(pct: number | null) {
  if (pct === null) return "text-muted-foreground";
  if (pct >= 40) return "text-emerald-600";
  if (pct >= 25) return "text-amber-600";
  return "text-red-600";
}
function gpBadgeCls(pct: number | null) {
  if (pct === null) return "bg-muted/50 text-muted-foreground border-border";
  if (pct >= 40) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (pct >= 25) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-red-50 text-red-700 border-red-200";
}

type BundleComponent = {
  id: number;
  bundle_id: number;
  product_id: number | null;
  product_name: string;
  resolved_name: string;
  product_sku: string | null;
  quantity: number;
  finish_id: number | null;
  finish_name: string | null;
  notes: string | null;
};

type BundleDetail = Bundle & { components: BundleComponent[] };

type Product = { id: number; name: string; sku: string | null };

const EMPTY_FORM = { name: "", sku: "", description: "", price: "", notes: "", isActive: true };

export default function Bundles() {
  const { toast } = useToast();
  const { confirmIfNotWhole, dialog: priceConfirmDialog } = usePriceConfirm();
  const qc = useQueryClient();

  const { data: bundles = [], isLoading } = useQuery<Bundle[]>({
    queryKey: ["bundles"],
    queryFn: () => apiFetch("/bundles"),
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["products"],
    queryFn: () => apiFetch("/products"),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BundleDetail | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [components, setComponents] = useState<BundleComponent[]>([]);

  const [addCompOpen, setAddCompOpen] = useState(false);
  const [compProdPopOpen, setCompProdPopOpen] = useState(false);
  const [compProdSearch, setCompProdSearch] = useState("");
  const [compProd, setCompProd] = useState<Product | null>(null);
  const [compQty, setCompQty] = useState("1");

  const saveBundleMutation = useMutation({
    mutationFn: (data: typeof form) => {
      const payload = { ...data, price: parseFloat(data.price || "0") };
      if (editing) {
        return apiFetch(`/bundles/${editing.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      }
      return apiFetch("/bundles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bundles"] });
      setDialogOpen(false);
      toast({ title: editing ? "Bundle updated" : "Bundle created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteBundleMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/bundles/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bundles"] }); toast({ title: "Bundle deleted" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addComponentMutation = useMutation({
    mutationFn: ({ bundleId, data }: { bundleId: number; data: object }) =>
      apiFetch(`/bundles/${bundleId}/components`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
    onSuccess: (newComp: BundleComponent) => {
      setComponents(prev => [...prev, newComp]);
      setCompProd(null); setCompQty("1"); setAddCompOpen(false); setCompProdSearch("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteComponentMutation = useMutation({
    mutationFn: ({ bundleId, compId }: { bundleId: number; compId: number }) =>
      apiFetch(`/bundles/${bundleId}/components/${compId}`, { method: "DELETE" }),
    onSuccess: (_: unknown, { compId }: { bundleId: number; compId: number }) => setComponents(prev => prev.filter(c => c.id !== compId)),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateComponentQtyMutation = useMutation({
    mutationFn: ({ bundleId, comp, qty }: { bundleId: number; comp: BundleComponent; qty: number }) =>
      apiFetch(`/bundles/${bundleId}/components/${comp.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: comp.product_id, productName: comp.product_name, quantity: qty, finishId: comp.finish_id, finishName: comp.finish_name }),
      }),
    onSuccess: (updated: BundleComponent) => setComponents(prev => prev.map(c => c.id === updated.id ? { ...c, quantity: updated.quantity } : c)),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  async function openEdit(bundle: Bundle) {
    try {
      const detail: BundleDetail = await apiFetch(`/bundles/${bundle.id}`);
      setEditing(detail);
      setForm({ name: detail.name, sku: detail.sku ?? "", description: detail.description ?? "", price: parseFloat(String(detail.price)).toFixed(2), notes: detail.notes ?? "", isActive: detail.is_active });
      setComponents(detail.components ?? []);
      setDialogOpen(true);
    } catch (e: any) {
      toast({ title: "Error loading bundle", description: e.message, variant: "destructive" });
    }
  }

  function openCreate() {
    setEditing(null); setForm(EMPTY_FORM); setComponents([]); setAddCompOpen(false);
    setCompProd(null); setCompQty("1"); setDialogOpen(true);
  }

  function handleAddComponent() {
    if (!editing || !compProd) return;
    addComponentMutation.mutate({
      bundleId: editing.id,
      data: { productId: compProd.id, productName: compProd.name, quantity: parseInt(compQty) || 1 },
    });
  }

  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(compProdSearch.toLowerCase()) ||
    (p.sku ?? "").toLowerCase().includes(compProdSearch.toLowerCase())
  );

  return (
    <Layout>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Bundles</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Pre-defined product sets that expand into individual items when added to an order
            </p>
          </div>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="w-4 h-4" /> New Bundle
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
            ) : bundles.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <Box className="w-8 h-8 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No bundles yet. Create one to get started.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Bundle Price</TableHead>
                    <TableHead className="text-right">Est. Cost</TableHead>
                    <TableHead className="text-right">GP</TableHead>
                    <TableHead className="text-center">Items</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bundles.map(b => {
                    const price = parseFloat(String(b.price));
                    const cost  = b.total_cost != null ? parseFloat(String(b.total_cost)) : null;
                    const hasAllCosts = b.component_count > 0 && b.components_priced === b.component_count;
                    const hasPartialCosts = b.components_priced > 0 && b.components_priced < b.component_count;
                    const gpPounds = cost != null && hasAllCosts ? price - cost : null;
                    const gpPct    = gpPounds != null && price > 0 ? (gpPounds / price) * 100 : null;
                    return (
                    <TableRow key={b.id} className="cursor-pointer hover:bg-muted/40" onClick={() => openEdit(b)}>
                      <TableCell>
                        <div className="font-medium">{b.name}</div>
                        {b.description && <div className="text-xs text-muted-foreground truncate max-w-[260px]"><KitDesignerText>{b.description}</KitDesignerText></div>}
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{b.sku ?? "—"}</TableCell>
                      <TableCell className="text-right font-semibold">£{price.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-sm">
                        {cost != null && b.components_priced > 0 ? (
                          <span className={hasPartialCosts ? "text-amber-600" : "text-muted-foreground"}>
                            £{cost.toFixed(2)}
                            {hasPartialCosts && (
                              <span className="block text-[10px] leading-tight">
                                {b.components_priced}/{b.component_count} priced
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic text-xs">no cost data</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {gpPct !== null ? (
                          <span className={`inline-flex flex-col items-end`}>
                            <span className={`text-sm font-semibold ${gpColor(gpPct)}`}>{gpPct.toFixed(1)}%</span>
                            <span className={`text-xs ${gpColor(gpPct)}`}>£{gpPounds!.toFixed(2)}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{b.component_count} item{b.component_count !== 1 ? "s" : ""}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={b.is_active ? "default" : "outline"} className={b.is_active ? "" : "text-muted-foreground"}>
                          {b.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(b)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10">
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete "{b.name}"?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently delete the bundle definition. Existing orders that contain this bundle are not affected.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteBundleMutation.mutate(b.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ); })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Create / Edit dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={open => { if (!open) { setDialogOpen(false); setAddCompOpen(false); } else setDialogOpen(true); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package2 className="w-5 h-5 text-primary" />
              {editing ? `Edit: ${editing.name}` : "New Bundle"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Name + SKU */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Name <span className="text-destructive">*</span></Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Driver Starter Pack" />
              </div>
              <div className="space-y-1.5">
                <Label>SKU</Label>
                <Input value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} placeholder="e.g. BUNDLE-DSP-001" />
              </div>
            </div>

            {/* Price + Active */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Bundle Price <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                  <Input className="pl-7" type="number" step="1" min="0" value={form.price}
                    onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0.00" />
                </div>
                <p className="text-xs text-muted-foreground">Total price charged for one bundle unit</p>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <div className="flex items-center gap-3 pt-2">
                  <Switch id="bundle-active" checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
                  <Label htmlFor="bundle-active" className="font-normal">{form.isActive ? "Active" : "Inactive"}</Label>
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2}
                placeholder="Optional description (shown on acknowledgements)" />
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label>Internal Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                placeholder="Internal notes (not shown to customers)" />
            </div>

            {/* Components — only shown when editing an existing bundle */}
            {editing ? (
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base font-semibold">Components</Label>
                    <p className="text-xs text-muted-foreground">Products included when this bundle is added to an order</p>
                  </div>
                  <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setAddCompOpen(v => !v)}>
                    <Plus className="w-3.5 h-3.5" /> Add Item
                  </Button>
                </div>

                {/* Add component form */}
                {addCompOpen && (
                  <div className="border rounded-lg p-3 bg-muted/30 space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Product</Label>
                      <Popover open={compProdPopOpen} onOpenChange={setCompProdPopOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-start font-normal h-9 text-sm text-left">
                            {compProd ? (
                              <span className="flex items-center gap-2">
                                {compProd.name}
                                {compProd.sku && <span className="text-muted-foreground font-mono text-xs">{compProd.sku}</span>}
                              </span>
                            ) : <span className="text-muted-foreground">Search products…</span>}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[460px] p-0" align="start">
                          <Command>
                            <CommandInput placeholder="Search by name or SKU…" value={compProdSearch} onValueChange={setCompProdSearch} />
                            <CommandList>
                              <CommandEmpty>No products found.</CommandEmpty>
                              <CommandGroup>
                                {filteredProducts.slice(0, 30).map(p => (
                                  <CommandItem key={p.id} value={`${p.name} ${p.sku ?? ""}`}
                                    onSelect={() => { setCompProd(p); setCompProdPopOpen(false); setCompProdSearch(""); }}>
                                    <Check className={cn("mr-2 h-4 w-4 flex-shrink-0", compProd?.id === p.id ? "opacity-100" : "opacity-0")} />
                                    <span className="flex-1">{p.name}</span>
                                    {p.sku && <span className="ml-2 text-xs font-mono text-muted-foreground">{p.sku}</span>}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>

                    <div className="flex items-end gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Qty per bundle</Label>
                        <Input type="number" min="1" value={compQty} onChange={e => setCompQty(e.target.value)} className="h-9 w-28" />
                      </div>
                      <Button size="sm" className="h-9" disabled={!compProd || addComponentMutation.isPending} onClick={handleAddComponent}>
                        {addComponentMutation.isPending ? "Adding…" : "Add"}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-9" onClick={() => { setAddCompOpen(false); setCompProd(null); setCompQty("1"); }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {/* Components list */}
                {components.length === 0 ? (
                  <div className="border border-dashed rounded-lg p-6 text-center">
                    <p className="text-sm text-muted-foreground">No components yet. Add products that make up this bundle.</p>
                  </div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead className="w-36 text-center">Qty per bundle</TableHead>
                          <TableHead className="w-12" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {components.map(c => (
                          <TableRow key={c.id}>
                            <TableCell>
                              <span className="font-medium">{c.resolved_name ?? c.product_name}</span>
                              {c.product_sku && <span className="ml-2 text-xs font-mono text-muted-foreground">{c.product_sku}</span>}
                            </TableCell>
                            <TableCell className="text-center">
                              <Input
                                type="number" min="1" defaultValue={c.quantity}
                                className="h-7 w-20 text-center mx-auto"
                                onBlur={e => {
                                  const newQty = parseInt(e.target.value);
                                  if (newQty > 0 && newQty !== c.quantity && editing) {
                                    updateComponentQtyMutation.mutate({ bundleId: editing.id, comp: c, qty: newQty });
                                  }
                                }}
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => editing && deleteComponentMutation.mutate({ bundleId: editing.id, compId: c.id })}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground bg-muted/40 rounded-lg p-3 border border-dashed">
                Save the bundle first, then re-open it to add component products.
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setAddCompOpen(false); }}>Cancel</Button>
            <Button
              disabled={!form.name.trim() || !form.price || saveBundleMutation.isPending}
              onClick={async () => {
                const ok = await confirmIfNotWhole(parseFloat(form.price || "0"));
                if (!ok) return;
                saveBundleMutation.mutate(form);
              }}
            >
              {saveBundleMutation.isPending ? "Saving…" : editing ? "Save Changes" : "Create Bundle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {priceConfirmDialog}
    </Layout>
  );
}
