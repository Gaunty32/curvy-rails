import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Trash2, Layers, AlertTriangle } from "lucide-react";
import { useVariants, useBoms, useComponents, useCreateBom, useClassifyVariant, type Bom, type InventoryClassification } from "@/hooks/use-manufacturing";

type ComponentLine = Bom["componentLines"][number];
type OperationLine = Bom["operationLines"][number];
const newOperation = (): OperationLine => ({ method: "", designRef: "", position: "", instructions: "", labourAllowance: 0 });
const inputClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const classifications: { value: InventoryClassification; label: string; description: string }[] = [
  { value: "LEGACY_REVIEW", label: "Legacy review", description: "Existing variant quantity needs migration review." },
  { value: "FINISHED_STOCK", label: "Finished stock", description: "Existing variant quantity represents finished decorated units." },
  { value: "COMPONENT_STOCK", label: "Component stock", description: "Label existing variant quantity as component-related for migration review." },
];

export default function ProductBom() {
  const { id } = useParams<{ id: string }>();
  const productId = Number(id);
  const { toast } = useToast();
  const variants = useVariants(productId);
  const components = useComponents();
  const [variantId, setVariantId] = useState<number | null>(null);
  const boms = useBoms(variantId);
  const create = useCreateBom(variantId);
  const classify = useClassifyVariant(productId);
  const [classificationChoice, setClassificationChoice] = useState<{ variantId: number; value: InventoryClassification } | null>(null);
  const [lines, setLines] = useState<ComponentLine[]>([]);
  const [operations, setOperations] = useState<OperationLine[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [viewId, setViewId] = useState<number | null>(null);
  useEffect(() => {
    if (variants.data?.length && !variants.data.some(v => v.id === variantId)) setVariantId(variants.data[0].id);
  }, [variants.data, variantId]);
  const versions = [...(boms.data ?? [])].sort((a,b) => Number(b.version) - Number(a.version));
  const current = versions.find(v => v.isCurrent) ?? versions[0];
  const viewed = versions.find(v => v.id === viewId) ?? current;
  const selected = variants.data?.find(v => v.id === variantId);
  const classification = classificationChoice?.variantId === variantId ? classificationChoice.value : selected?.inventoryClassification ?? "LEGACY_REVIEW";
  const switchVariant = (value: number) => { setVariantId(value); setClassificationChoice(null); setViewId(null); setShowEditor(false); setLines([]); setOperations([]); };
  const saveClassification = async () => {
    if (!selected || classification === selected.inventoryClassification) return;
    const label = classifications.find(option => option.value === classification)?.label ?? classification;
    if (!window.confirm(`Classify variant #${selected.id} as ${label}?\n\nThis only labels the existing legacy variant quantity for migration. It does NOT transfer any units to component inventory or change the quantity.`)) return;
    try {
      await classify.mutateAsync({ variantId: selected.id, classification });
      setClassificationChoice(null);
      toast({ title: "Variant classification updated", description: "Existing units were not transferred to component inventory." });
    } catch (error) {
      toast({ title: "Classification not saved", description: error instanceof Error ? error.message : "Please retry.", variant: "destructive" });
    }
  };
  const start = () => {
    setLines(current?.componentLines.map(l => ({ ...l })) ?? []);
    setOperations(current?.operationLines.map(l => ({ ...l })) ?? []);
    setShowEditor(true);
  };
  const editComponent = (index: number, patch: Partial<ComponentLine>) => setLines(prev => prev.map((line, i) => i === index ? { ...line, ...patch } : line));
  const editOperation = (index: number, patch: Partial<OperationLine>) => setOperations(prev => prev.map((line, i) => i === index ? { ...line, ...patch } : line));
  const save = async () => {
    if (!variantId || lines.length === 0 || lines.some(l => !l.componentId || !Number.isInteger(l.quantity) || l.quantity <= 0) || new Set(lines.map(l => l.componentId)).size !== lines.length || operations.some(o => !o.method.trim() || !Number.isFinite(o.labourAllowance) || o.labourAllowance < 0)) {
      toast({ title: "Check your BOM lines", description: "Choose distinct components with positive quantities and give each operation a method and valid allowance.", variant: "destructive" }); return;
    }
    try {
      await create.mutateAsync({ componentLines: lines, operationLines: operations });
      setShowEditor(false); setViewId(null);
      toast({ title: "New BOM version saved", description: "Previous versions remain read-only." });
    } catch (error) { toast({ title: "Could not save BOM", description: error instanceof Error ? error.message : "Please retry.", variant: "destructive" }); }
  };
  return <Layout><div className="space-y-6">
    <div className="flex items-center gap-3"><Link data-testid="link-back-product" href={`/products/${id}`} className="rounded-lg p-2 hover:bg-muted"><ArrowLeft className="h-5 w-5" /></Link><div><p className="text-xs uppercase tracking-widest font-semibold text-primary">Products / production definition</p><h1 className="text-3xl font-bold mt-1">Bill of materials</h1><p className="text-sm text-muted-foreground mt-1">Define physical inputs and production work for one existing variant at a time.</p></div></div>
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex gap-3 text-sm text-amber-950"><AlertTriangle className="h-5 w-5 shrink-0" /><p><strong>Phase 1 planning only.</strong> BOMs do not yet drive website availability or checkout. Legacy product stock stays as-is until explicitly reconciled; count blanks manually before opening component balances.</p></div>
    <div className="rounded-xl border bg-card p-5 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-4"><label className="text-xs font-semibold text-muted-foreground w-full sm:w-[360px]">PRODUCT VARIANT
        {variants.isLoading ? <div className="h-10 bg-muted animate-pulse rounded mt-2" /> : variants.isError ? <div className="text-destructive mt-2">Variants unavailable. <button className="underline" onClick={() => variants.refetch()}>Retry</button></div> : <select data-testid="select-bom-variant" className={`${inputClass} mt-2`} value={variantId ?? ""} onChange={e => switchVariant(Number(e.target.value))}><option value="" disabled>Choose a variant</option>{variants.data?.map(v => <option key={v.id} value={v.id}>{[v.sku, v.colour, v.sleeve, v.size].filter(Boolean).join(" / ") || `Variant #${v.id}`}</option>)}</select>}
      </label>{variantId && !showEditor && <Button data-testid="button-new-bom-version" onClick={start}><Plus className="mr-2 h-4 w-4" />{current ? "Create new version" : "Author first BOM"}</Button>}</div>
      {variants.data?.length === 0 && <p className="text-sm text-muted-foreground">This product has no variants yet. Add a variant on the product page before authoring a BOM.</p>}
      {selected && <p className="text-xs text-muted-foreground">Variant ID {selected.id}. Each saved version is immutable; edits create a new version.</p>}
      {selected && <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
        <div><h2 className="text-sm font-semibold">Legacy quantity classification</h2><p className="mt-1 text-xs text-muted-foreground">Label this variant's existing quantity ({selected.stockQuantity ?? "unknown"} units) for migration review only. Classification does not transfer units to component inventory, change its balance, or affect checkout.</p></div>
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <label className="text-xs font-semibold text-muted-foreground flex-1">CLASSIFICATION
            <select data-testid="select-inventory-classification" className={`${inputClass} mt-1`} value={classification} onChange={e => setClassificationChoice({ variantId: selected.id, value: e.target.value as InventoryClassification })} disabled={classify.isPending}>
              {classifications.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <Button data-testid="button-save-inventory-classification" variant="outline" disabled={classify.isPending || classification === selected.inventoryClassification} onClick={saveClassification}>{classify.isPending ? "Saving…" : "Confirm classification"}</Button>
        </div>
        <p className="text-xs text-muted-foreground">{classifications.find(option => option.value === classification)?.description}</p>
      </div>}
    </div>
    {variantId && (boms.isLoading ? <div className="space-y-3"><div className="h-20 rounded-xl animate-pulse bg-muted" /><div className="h-44 rounded-xl animate-pulse bg-muted" /></div> : boms.isError ? <div className="rounded-xl border bg-card p-6 text-sm text-destructive">BOM history unavailable. {boms.error.message} <Button variant="outline" className="ml-3" onClick={() => boms.refetch()}>Retry</Button></div> : <>
      {versions.length > 0 && <div className="flex flex-wrap gap-2 items-center"><span className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mr-2">Saved versions</span>{versions.map(v => <button data-testid={`button-bom-version-${v.version}`} key={v.id} className={`rounded-lg px-3 py-1.5 border text-sm ${viewed?.id === v.id && !showEditor ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted"}`} onClick={() => { setViewId(v.id); setShowEditor(false); }}>Version {v.version}{v.isCurrent ? " · Current" : ""}</button>)}</div>}
      {showEditor ? <div className="space-y-5">
        <div className="rounded-xl border bg-card p-5 space-y-4"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Physical components</h2><p className="text-xs text-muted-foreground">Quantities consumed per finished unit. Decoration artwork is not stock.</p></div><Button data-testid="button-add-component-line" size="sm" variant="outline" disabled={!components.data?.length} onClick={() => setLines(p => [...p, { componentId: 0, quantity: 1 }])}><Plus className="mr-1 h-4 w-4" /> Add line</Button></div>
          {components.isError && <p className="text-sm text-destructive">Component catalogue unavailable. <button onClick={() => components.refetch()} className="underline">Retry</button></p>}
          {components.isLoading && <div className="h-12 rounded bg-muted animate-pulse" />}
          {!components.isLoading && components.data?.length === 0 && <p className="text-sm text-muted-foreground">No components available. <Link href="/components" className="text-primary underline">Create a physical component</Link> first.</p>}
          {lines.map((line,i) => <div key={i} className="grid gap-2 sm:grid-cols-[1fr_120px_auto] items-end"><label className="text-xs text-muted-foreground">Component<select data-testid={`select-bom-component-${i}`} className={`${inputClass} mt-1`} value={line.componentId || ""} onChange={e => editComponent(i,{ componentId: Number(e.target.value) })}><option value="">Choose component</option>{components.data?.filter(c => c.isActive || c.id === line.componentId).map(c => <option key={c.id} value={c.id}>{c.sku} · {c.name}</option>)}</select></label><label className="text-xs text-muted-foreground">Qty / unit<Input data-testid={`input-bom-quantity-${i}`} className="mt-1" type="number" min="1" step="1" value={line.quantity} onChange={e => editComponent(i,{ quantity: Number(e.target.value) })} /></label><Button data-testid={`button-remove-bom-component-${i}`} variant="ghost" size="icon" aria-label="Remove component line" onClick={() => setLines(p => p.filter((_,n) => n !== i))}><Trash2 className="h-4 w-4" /></Button></div>)}
        </div>
        <div className="rounded-xl border bg-card p-5 space-y-4"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Production operations</h2><p className="text-xs text-muted-foreground">Embroidery designs, heat press and placement are work instructions, not physical stock.</p></div><Button data-testid="button-add-operation" size="sm" variant="outline" onClick={() => setOperations(p => [...p,newOperation()])}><Plus className="mr-1 h-4 w-4" /> Add operation</Button></div>
          {operations.map((op,i) => <div key={i} className="rounded-lg border bg-muted/20 p-4 space-y-3"><div className="flex justify-between"><strong className="text-sm">Operation {i+1}</strong><Button data-testid={`button-remove-operation-${i}`} variant="ghost" size="sm" onClick={() => setOperations(p => p.filter((_,n) => n !== i))}><Trash2 className="h-4 w-4 mr-1" /> Remove</Button></div><div className="grid sm:grid-cols-2 gap-3">{([["method","Method (e.g. embroidery)"],["designRef","Design reference"],["position","Position"]] as const).map(([key,title]) => <label key={key} className="text-xs text-muted-foreground">{title}<Input data-testid={`input-operation-${key}-${i}`} className="mt-1" value={op[key]} onChange={e => editOperation(i,{[key]: e.target.value})} /></label>)}<label className="text-xs text-muted-foreground">Labour allowance<Input data-testid={`input-operation-labour-${i}`} className="mt-1" type="number" min="0" step="any" value={op.labourAllowance} onChange={e => editOperation(i,{labourAllowance: Number(e.target.value)})} /></label></div><label className="block text-xs text-muted-foreground">Instructions<Textarea data-testid={`input-operation-instructions-${i}`} className="mt-1" value={op.instructions} onChange={e => editOperation(i,{instructions:e.target.value})} /></label></div>)}
        </div><div className="flex gap-2 justify-end"><Button variant="outline" onClick={() => setShowEditor(false)}>Discard draft</Button><Button data-testid="button-save-bom" disabled={create.isPending || components.isError || components.isLoading} onClick={save}>{create.isPending ? "Saving…" : "Save immutable version"}</Button></div>
      </div> : viewed ? <div className="rounded-xl border bg-card overflow-hidden"><div className="px-5 py-4 border-b flex items-center justify-between"><div><h2 className="text-lg font-semibold">Version {viewed.version}</h2><p className="text-xs text-muted-foreground">Read-only record {viewed.createdAt ? `· ${new Date(viewed.createdAt).toLocaleString("en-GB")}` : ""}</p></div><span className="rounded-full bg-primary/10 text-primary text-xs font-semibold px-3 py-1">{viewed.isCurrent ? "Current" : "Historic"}</span></div>
        <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x"><section className="p-5"><h3 className="font-semibold mb-3">Physical inputs</h3>{viewed.componentLines.length ? <div className="divide-y">{viewed.componentLines.map((line,i) => <div key={i} className="py-3 flex justify-between text-sm gap-3"><span><strong>{line.componentNameSnapshot ?? `Component #${line.componentId} (name snapshot unavailable)`}</strong><span className="block text-xs font-mono text-muted-foreground">{line.componentSkuSnapshot ?? "SKU snapshot unavailable"}</span><span className="block text-xs text-muted-foreground">Saved unit cost: {line.unitCostGbpSnapshot != null ? `£${Number(line.unitCostGbpSnapshot).toFixed(2)}` : "snapshot unavailable"}</span></span><span className="tabular-nums font-semibold whitespace-nowrap">{line.quantity} / unit</span></div>)}</div> : <p className="text-sm text-muted-foreground">No physical component lines.</p>}</section><section className="p-5"><h3 className="font-semibold mb-3">Production work</h3>{viewed.operationLines.length ? <div className="space-y-3">{viewed.operationLines.map((op,i) => <div key={i} className="rounded-lg bg-muted/40 p-3 text-sm"><strong>{op.method}</strong><span className="text-muted-foreground"> · {op.position || "Placement unspecified"}</span><p className="text-xs mt-1">Design: {op.designRef || "—"} · Labour: {op.labourAllowance}</p>{op.instructions && <p className="text-xs text-muted-foreground mt-2">{op.instructions}</p>}</div>)}</div> : <p className="text-sm text-muted-foreground">No production operations.</p>}</section></div>
      </div> : <div className="rounded-xl border border-dashed bg-card p-12 text-center"><Layers className="mx-auto h-9 w-9 text-muted-foreground/50 mb-3" /><h2 className="font-semibold">No BOM for this variant</h2><p className="text-sm text-muted-foreground mt-1">Author its first version to document the blank and decoration work.</p></div>}
    </>)}
  </div></Layout>;
}