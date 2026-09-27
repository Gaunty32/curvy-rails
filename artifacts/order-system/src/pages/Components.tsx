import { useState, type FormEvent } from "react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Boxes, Plus, Search, ArrowDownUp, ClipboardCheck, AlertTriangle } from "lucide-react";
import { AvailabilityPanel } from "@/components/manufacturing/AvailabilityPanel";
import { AvailabilityPolicyControl } from "@/components/manufacturing/AvailabilityPolicyControl";
import { useComponents, useSuppliers, useMovements, useStocktakes, useCreateComponent, useUpdateComponent, useOpeningBalance, useCreateStocktake, useApproveStocktake, type Component, type Stocktake } from "@/hooks/use-manufacturing";

type Form = { sku: string; name: string; type: string; supplierId: string; supplierSku: string; unitCost: string; binLocation: string; reorderLevel: string; targetStock: string; leadDays: string; isActive: boolean; replenishable: boolean };
const blank: Form = { sku: "", name: "", type: "garment", supplierId: "", supplierSku: "", unitCost: "", binLocation: "", reorderLevel: "0", targetStock: "0", leadDays: "0", isActive: true, replenishable: false };
const fromComponent = (c: Component): Form => ({
  sku: c.sku, name: c.name, type: c.type, supplierId: c.supplierId == null ? "" : String(c.supplierId),
  supplierSku: c.supplierSku ?? "", unitCost: c.unitCost == null ? "" : String(c.unitCost), binLocation: c.binLocation ?? "",
  reorderLevel: String(c.reorderLevel ?? 0), targetStock: String(c.targetStock ?? 0), leadDays: String(c.leadDays ?? 0), isActive: c.isActive, replenishable: c.replenishable,
});
const field = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
const label = "space-y-1 text-xs font-semibold text-muted-foreground";

export default function Components() {
  const { toast } = useToast();
  const components = useComponents();
  const suppliers = useSuppliers();
   const [selected, setSelected] = useState<number | null>(() => {
     const value = Number(new URLSearchParams(window.location.search).get("componentId"));
     return Number.isInteger(value) && value > 0 ? value : null;
   });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form>(blank);
  const [search, setSearch] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [unsavedCounts, setUnsavedCounts] = useState<Record<number, { quantity: string; note: string }>>({});
  const [mode, setMode] = useState<"details" | "opening" | "count" | "history">("details");
  const create = useCreateComponent();
  const update = useUpdateComponent();
  const opening = useOpeningBalance();
  const stocktake = useCreateStocktake();
  const approve = useApproveStocktake();
  const movements = useMovements(selected);
  const stocktakes = useStocktakes(selected);
  const active = components.data?.find(c => c.id === selected);
  const hasOpening = movements.data?.some(m => m.reason === "OPENING_BALANCE");
  const rows = (components.data ?? []).filter(c => `${c.name} ${c.sku} ${c.binLocation ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const error = (err: unknown) => toast({ title: "Could not save", description: err instanceof Error ? err.message : "Please retry.", variant: "destructive" });
  const change = (key: keyof Form, value: string | boolean) => setForm(current => ({ ...current, [key]: value }));
  const select = (c: Component) => {
    if (selected !== null) setUnsavedCounts(previous => ({ ...previous, [selected]: { quantity, note } }));
    setSelected(c.id); setEditing(false); setMode("details");
    setQuantity(unsavedCounts[c.id]?.quantity ?? ""); setNote(unsavedCounts[c.id]?.note ?? "");
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const data = {
      sku: form.sku.trim(), name: form.name.trim(), type: form.type.trim(),
      supplierId: form.supplierId ? Number(form.supplierId) : null, supplierSku: form.supplierSku.trim() || null,
      unitCost: form.unitCost ? Number(form.unitCost) : 0, binLocation: form.binLocation.trim() || null,
      reorderLevel: Number(form.reorderLevel), targetStock: Number(form.targetStock), leadDays: Number(form.leadDays), isActive: form.isActive, replenishable: form.replenishable,
    };
    try {
      if (selected !== null) await update.mutateAsync({ id: selected, ...data });
      else await create.mutateAsync(data);
      toast({ title: selected === null ? "Component created" : "Component updated" });
      setEditing(false);
    } catch (e) { error(e); }
  };
  const reconcile = async () => {
    if (!active || movements.isLoading || movements.isError || (mode === "count" && !hasOpening) || (mode === "opening" && hasOpening) || quantity === "" || !Number.isInteger(Number(quantity)) || Number(quantity) < 0) return;
    try {
      if (mode === "opening") {
        await opening.mutateAsync({ componentId: active.id, quantity: Number(quantity), note: note.trim() });
        toast({ title: "Opening balance recorded" }); setMode("details");
      } else {
        await stocktake.mutateAsync({ componentId: active.id, countedQty: Number(quantity), note: note.trim() });
        toast({ title: "Draft count saved", description: "No stock has moved. Review the variance and approve explicitly." });
      }
      setUnsavedCounts(previous => ({ ...previous, [active.id]: { quantity: "", note: "" } }));
      setQuantity(""); setNote("");
    } catch (e) { error(e); }
  };
  const approveDraft = async (draft: Stocktake) => {
    if (!window.confirm(`Approve count #${draft.id}? The physical balance will change from ${draft.expectedQty} to ${draft.countedQty}.`)) return;
    try { await approve.mutateAsync(draft.id); toast({ title: "Stocktake approved" }); }
    catch (e) { error(e); void stocktakes.refetch(); void movements.refetch(); void components.refetch(); }
  };

  return <Layout><div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-primary">Stock / physical inventory</p><h1 className="mt-1 text-3xl font-bold">Components</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Manage shared blanks and other physical inputs independently of decorated product variants.</p></div>
      <Button data-testid="button-new-component" onClick={() => { if (selected !== null) setUnsavedCounts(previous => ({ ...previous, [selected]: { quantity, note } })); setSelected(null); setForm(blank); setEditing(true); setMode("details"); setQuantity(""); setNote(""); }}><Plus className="mr-2 h-4 w-4" /> New component</Button>
    </div>
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 flex gap-3"><AlertTriangle className="h-5 w-5 shrink-0" /><p><strong>Count before opening.</strong> Legacy product stock stays untouched. A component balance is not inherited from old variant stock; record a manually counted opening balance when you are ready.</p></div>
    <AvailabilityPolicyControl />
    <div className="grid gap-5 lg:grid-cols-[minmax(300px,1fr)_minmax(350px,1.2fr)]">
      <section className="rounded-xl border bg-card overflow-hidden">
        <div className="border-b p-4 flex items-center justify-between gap-3"><h2 className="font-semibold">Physical catalogue <span className="text-muted-foreground font-normal">({components.data?.length ?? 0})</span></h2><div className="relative"><Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" /><Input data-testid="input-search-components" className="pl-8 h-9 w-40 sm:w-52" placeholder="SKU, name, bin" value={search} onChange={e => setSearch(e.target.value)} /></div></div>
        {components.isLoading ? <div className="p-4 space-y-3">{[1,2,3,4].map(n => <div key={n} className="h-14 animate-pulse rounded bg-muted" />)}</div> :
          components.isError ? <div className="p-6 text-sm text-destructive">Components could not be loaded. {components.error.message}<Button variant="outline" className="mt-3 block" onClick={() => components.refetch()}>Retry</Button></div> :
          rows.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground"><Boxes className="mx-auto mb-3 h-8 w-8 opacity-40" />{search ? "No matching components." : "No physical components yet. Create the first blank to begin."}</div> :
          <div className="divide-y max-h-[650px] overflow-auto">{rows.map(c => <button type="button" data-testid={`button-component-${c.id}`} key={c.id} onClick={() => select(c)} className={`w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-muted/40 ${selected === c.id ? "bg-primary/10 border-l-4 border-primary" : ""}`}>
            <span className="min-w-0"><span className="block font-semibold text-sm truncate">{c.name}</span><span className="block text-xs text-muted-foreground font-mono">{c.sku} · {c.binLocation || "No bin"}</span></span>
            <span className="text-right shrink-0"><span className="block font-semibold tabular-nums">{c.physicalQty == null ? "Not opened" : Number(c.physicalQty).toLocaleString()}</span><span className="text-[11px] text-muted-foreground">{c.isActive ? c.type : "Inactive"}</span></span>
          </button>)}</div>}
      </section>
      <section className="rounded-xl border bg-card min-h-[360px]">
        {editing ? <form onSubmit={save} className="p-5 space-y-5">
          <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{selected === null ? "New component" : `Edit ${active?.sku ?? "component"}`}</h2><Button variant="ghost" type="button" onClick={() => setEditing(false)}>Cancel</Button></div>
          <p className="text-xs text-muted-foreground">These are catalogue details only. Physical quantity is changed through opening reconciliation or an approved stocktake.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {([["sku","SKU"],["name","Name"],["supplierSku","Supplier SKU"],["binLocation","Bin location"]] as const).map(([key,title]) => <label key={key} className={label}>{title}<Input data-testid={`input-component-${key}`} required={key === "sku" || key === "name"} value={form[key]} onChange={e => change(key,e.target.value)} /></label>)}
            <label className={label}>Type<select data-testid="select-component-type" className={field} value={form.type} onChange={e => change("type",e.target.value)}>{["garment","transfer","patch","packaging","other"].map(t => <option key={t} value={t}>{t}</option>)}</select></label>
            <label className={label}>Supplier<select data-testid="select-component-supplier" className={field} value={form.supplierId} onChange={e => change("supplierId",e.target.value)}><option value="">None</option>{suppliers.data?.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select>{suppliers.isError && <span className="block text-destructive">Suppliers unavailable. <button type="button" className="underline" onClick={() => suppliers.refetch()}>Retry</button></span>}</label>
            {([["unitCost","Unit cost (£)","0.01"],["reorderLevel","Reorder level","1"],["targetStock","Target stock","1"],["leadDays","Lead days","1"]] as const).map(([key,title,step]) => <label key={key} className={label}>{title}<Input data-testid={`input-component-${key}`} type="number" min="0" step={step} value={form[key]} onChange={e => change(key,e.target.value)} /></label>)}
          </div>
          <label className="flex items-center gap-2 text-sm"><input data-testid="checkbox-component-active" type="checkbox" checked={form.isActive} onChange={e => change("isActive",e.target.checked)} />Active component</label>
           <label className="flex items-start gap-2 text-sm"><input data-testid="checkbox-component-replenishable" type="checkbox" className="mt-1" checked={form.replenishable} onChange={e => change("replenishable",e.target.checked)} /><span><strong>Eligible for order-to-replenish</strong><span className="block text-xs text-muted-foreground">Only enable if this component can reliably be replenished within its stated lead time. This does not create a purchase order.</span></span></label>
          <Button data-testid="button-save-component" disabled={create.isPending || update.isPending} type="submit">{create.isPending || update.isPending ? "Saving…" : "Save component"}</Button>
        </form> : active ? <div>
          <div className="p-5 border-b flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-xs text-muted-foreground">{active.sku}</p><h2 className="text-xl font-bold mt-1">{active.name}</h2><div className="flex gap-2 mt-2"><Badge variant="secondary">{active.type}</Badge><Badge variant="outline">{active.isActive ? "Active" : "Inactive"}</Badge></div></div><Button data-testid="button-edit-component" variant="outline" size="sm" onClick={() => { setForm(fromComponent(active)); setEditing(true); }}>Edit details</Button></div>
           <AvailabilityPanel key={active.id} componentId={active.id} />
           <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-5 border-b text-sm"><div><span className="text-xs text-muted-foreground block">Physical balance</span><strong className="text-lg tabular-nums">{movements.isLoading ? "Checking…" : movements.isError ? "Unavailable" : hasOpening ? active.physicalQty : "Not reconciled"}</strong></div><div><span className="text-xs text-muted-foreground block">Reorder / target</span><strong>{active.reorderLevel} / {active.targetStock}</strong></div><div><span className="text-xs text-muted-foreground block">Bin</span><strong>{active.binLocation || "—"}</strong></div><div><span className="text-xs text-muted-foreground block">Lead time</span><strong>{active.leadDays} days</strong></div></div>
          <div className="flex flex-wrap gap-2 px-5 pt-4"><Button data-testid="button-tab-history" size="sm" variant={mode === "history" ? "default" : "outline"} onClick={() => setMode("history")}><ArrowDownUp className="h-4 w-4 mr-1" /> Movements</Button><Button data-testid="button-tab-opening" size="sm" variant={mode === "opening" ? "default" : "outline"} disabled={movements.isLoading || movements.isError || !!hasOpening} onClick={() => setMode("opening")}>Opening balance</Button><Button data-testid="button-tab-stocktake" size="sm" variant={mode === "count" ? "default" : "outline"} disabled={movements.isLoading || movements.isError || !hasOpening} onClick={() => setMode("count")}><ClipboardCheck className="h-4 w-4 mr-1" /> Stocktake</Button></div>
          {mode === "details" && <p className="p-5 text-sm text-muted-foreground">{movements.isLoading ? "Checking reconciliation history…" : movements.isError ? <>Cannot verify reconciliation. <button className="underline text-destructive" onClick={() => movements.refetch()}>Retry</button></> : !hasOpening ? "Not reconciled yet. Count the physical stock and record it explicitly; existing product stock will remain unchanged." : "Review movement history or draft a stocktake to reconcile a new count."}</p>}
          {mode === "history" && <div className="p-5">{movements.isLoading ? <div className="h-32 animate-pulse bg-muted rounded" /> : movements.isError ? <p className="text-sm text-destructive">Movements unavailable. <button className="underline" onClick={() => movements.refetch()}>Retry</button></p> : movements.data?.length ? <div className="divide-y">{movements.data.map(m => <div key={m.id} className="py-3 grid grid-cols-[1fr_auto] gap-2 text-sm"><div><strong>{m.reason}</strong> <span className="text-muted-foreground">{m.reference || ""}</span><p className="text-xs text-muted-foreground">{m.actor} · {new Date(m.createdAt).toLocaleString("en-GB")}{m.note && ` · ${m.note}`}</p></div><div className="text-right tabular-nums"><strong className={m.delta < 0 ? "text-destructive" : "text-emerald-700"}>{m.delta > 0 ? "+" : ""}{m.delta}</strong><span className="block text-xs text-muted-foreground">Balance {m.balanceAfter}</span></div></div>)}</div> : <p className="text-sm text-muted-foreground">No movements recorded yet.</p>}</div>}
          {(mode === "opening" || mode === "count") && <div className="p-5 space-y-4"><div className="rounded-lg bg-muted/60 p-3 text-sm">{mode === "opening" ? "Opening reconciliation is a one-time recorded physical count. It does not migrate legacy variant stock." : `Expected balance: ${active.physicalQty}. A draft count does not change stock until approved.`}</div>
            <label className={label}>{mode === "opening" ? "Manually counted opening quantity" : "Counted quantity"}<Input data-testid="input-counted-quantity" type="number" min="0" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} /></label><label className={`${label} block`}>Count note / reference<Textarea data-testid="input-count-note" value={note} onChange={e => setNote(e.target.value)} placeholder="Who counted, where, and when" /></label><Button data-testid="button-submit-count" disabled={quantity === "" || !Number.isInteger(Number(quantity)) || Number(quantity) < 0 || opening.isPending || stocktake.isPending || (mode === "count" && !hasOpening)} onClick={reconcile}>{opening.isPending || stocktake.isPending ? "Saving…" : mode === "opening" ? "Record opening balance" : "Save draft stocktake"}</Button>
            {mode === "count" && <div className="border-t pt-5 space-y-4">
              <h3 className="font-semibold text-sm">Stocktake records</h3>
              {stocktakes.isLoading ? <div className="space-y-2">{[0, 1].map(n => <div key={n} className="h-20 rounded bg-muted animate-pulse" />)}</div> :
                stocktakes.isError ? <p className="text-sm text-destructive">Counts unavailable. {stocktakes.error.message} <button className="underline" onClick={() => stocktakes.refetch()}>Retry</button></p> :
                stocktakes.data?.length ? <div className="space-y-3">{stocktakes.data.map(record => <div data-testid={`stocktake-${record.id}`} key={record.id} className={`rounded-lg border p-4 text-sm ${record.status === "draft" ? "border-amber-200 bg-amber-50" : "bg-muted/30"}`}>
                  <div className="flex justify-between gap-3"><strong>Count #{record.id}</strong><Badge variant={record.status === "draft" ? "secondary" : "outline"}>{record.status}</Badge></div>
                  <p className="mt-2 tabular-nums">Expected {record.expectedQty} · Counted {record.countedQty} · Variance {record.countedQty - record.expectedQty > 0 ? "+" : ""}{record.countedQty - record.expectedQty}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{record.createdBy} · {new Date(record.createdAt).toLocaleString("en-GB")}{record.note ? ` · ${record.note}` : ""}</p>
                  {record.status === "approved" && record.approvedBy && <p className="mt-1 text-xs text-muted-foreground">Approved by {record.approvedBy}{record.approvedAt ? ` · ${new Date(record.approvedAt).toLocaleString("en-GB")}` : ""}</p>}
                  {record.status === "draft" && <Button data-testid={`button-approve-stocktake-${record.id}`} className="mt-3" size="sm" disabled={approve.isPending} onClick={() => approveDraft(record)}>{approve.isPending ? "Approving…" : "Approve and reconcile"}</Button>}
                </div>)}</div> : <p className="text-sm text-muted-foreground">No stocktakes recorded. Save a draft count to begin.</p>}
            </div>}
          </div>}
        </div> : <div className="p-12 text-center text-muted-foreground"><Boxes className="h-9 w-9 mx-auto mb-3 opacity-40" /><h2 className="font-semibold text-foreground">Select a component</h2><p className="text-sm mt-1">See its balance, count history and reconciliation actions here.</p></div>}
      </section>
    </div>
  </div></Layout>;
}