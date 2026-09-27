import { useState, useEffect, useRef, useMemo } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUpload } from "@workspace/object-storage-web";
import Layout from "@/components/Layout";
import { UploadedImage } from "@/components/UploadedImage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { usePriceConfirm } from "@/components/PriceConfirmDialog";
import { ProductCategoryMultiSelect } from "@/components/ProductCategoryMultiSelect";
import {
  ArrowLeft, Package, Loader2, X, Plus, Save, Trash2, Edit2, AlertCircle,
  Layers, Palette, Ruler, Upload, Camera, Wrench, Check, ChevronsUpDown, Cloud, Star, BookOpen, User, Sparkles, Shuffle, Search,
  Share2, Globe, CalendarDays, Send, Clock, CheckCircle2, RefreshCw, Eye, Wand2, Copy, ImageIcon
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { sortBySizeWithOrder, sizeRank } from "@/lib/sizeUtils";
import { useSizeOrder } from "@/hooks/useSizeOrder";
import { useGetProduct, useUpdateProduct, getListProductsQueryKey, getGetProductQueryKey, useListSuppliers, useListCustomers } from "@workspace/api-client-react";

const API_BASE = "/api";

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null;
  return res.json();
}

// ── Tag Input ──────────────────────────────────────────────────────────────
function TagInput({
  type, productId, attributes, onRefresh,
}: {
  type: "colour" | "size" | "sleeve"; productId: number; attributes: any[]; onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [inputVal, setInputVal] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const items = attributes.filter(a => a.type === type);

  const addMut = useMutation({
    mutationFn: (value: string) => apiFetch(`/products/${productId}/attributes`, {
      method: "POST", body: JSON.stringify({ type, value }),
    }),
    onSuccess: () => { onRefresh(); setInputVal(""); },
    onError: () => toast({ title: "Error adding attribute", variant: "destructive" }),
  });

  const delMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/products/${productId}/attributes/${id}`, { method: "DELETE" }),
    onSuccess: onRefresh,
  });

  const editMut = useMutation({
    mutationFn: ({ id, value }: { id: number; value: string }) =>
      apiFetch(`/products/${productId}/attributes/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ value }),
      }),
    onSuccess: () => {
      setEditingId(null);
      setEditingValue("");
      onRefresh();
    },
    onError: (error: Error) => toast({
      title: "Error updating attribute",
      description: error.message,
      variant: "destructive",
    }),
  });

  const saveEdit = (attribute: any) => {
    const value = editingValue.trim();
    if (!value || value === attribute.value) {
      setEditingId(null);
      setEditingValue("");
      return;
    }
    editMut.mutate({ id: attribute.id, value });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && inputVal.trim()) { e.preventDefault(); addMut.mutate(inputVal.trim()); }
  };

  const colourMap: Record<string, string> = {
    colour: "bg-pink-100 text-pink-800 border-pink-200",
    size:   "bg-blue-100 text-blue-800 border-blue-200",
    sleeve: "bg-amber-100 text-amber-800 border-amber-200",
  };

  const emptyLabel = type === "colour" ? "colours" : type === "size" ? "sizes" : "sleeve types";
  const placeholder = type === "colour" ? "colour" : type === "size" ? "size" : "e.g. Long Sleeve";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 min-h-[2.5rem]">
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground italic">No {emptyLabel} added yet</p>
        )}
        {items.map(a => (
          <span key={`${a.id}:${a.imageUrl ?? "no-image"}`} className={`inline-flex items-center gap-1.5 pr-2 py-1 rounded-full text-sm font-medium border ${colourMap[type]} ${a.imageUrl ? "pl-1" : "pl-3"}`}>
            {type === "colour" && a.imageUrl && (
              <UploadedImage
                src={a.imageUrl}
                alt={a.value}
                className="w-5 h-5 rounded-full object-cover border border-white/60 flex-shrink-0"
                fallback={<span className="w-5 h-5 rounded-full bg-white/40 border border-white/60 flex-shrink-0" aria-label={`${a.value} image unavailable`} />}
              />
            )}
            {type === "size" && editingId === a.id ? (
              <input
                autoFocus
                value={editingValue}
                onChange={event => setEditingValue(event.target.value)}
                onBlur={() => saveEdit(a)}
                onKeyDown={event => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    saveEdit(a);
                  } else if (event.key === "Escape") {
                    setEditingId(null);
                    setEditingValue("");
                  }
                }}
                disabled={editMut.isPending}
                className="w-16 min-w-0 bg-white/70 border border-blue-300 rounded px-1 py-0 text-sm text-blue-900 outline-none focus:ring-1 focus:ring-blue-500"
                aria-label={`Edit size ${a.value}`}
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (type !== "size") return;
                  setEditingId(a.id);
                  setEditingValue(a.value);
                }}
                className={type === "size" ? "hover:underline cursor-text" : "cursor-default"}
                title={type === "size" ? "Click to edit" : undefined}
              >
                {a.value}
              </button>
            )}
            <button onClick={() => delMut.mutate(a.id)} className="hover:opacity-60 ml-0.5"><X className="w-3 h-3" /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          placeholder={`Add ${placeholder}… (press Enter)`}
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          className="max-w-xs"
        />
        <Button size="sm" variant="outline" onClick={() => inputVal.trim() && addMut.mutate(inputVal.trim())} disabled={addMut.isPending || !inputVal.trim()}>
          <Plus className="w-4 h-4 mr-1" /> Add
        </Button>
      </div>
    </div>
  );
}

// ── Supplier select ────────────────────────────────────────────────────────
function SupplierSelect({ value, onChange, suppliers, placeholder = "Select supplier…", className }: {
  value: string; onChange: (v: string) => void; suppliers: any[]; placeholder?: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = suppliers.find((s) => String(s.id) === value);
  const triggerClass = className ?? "h-8 text-sm";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={`${triggerClass} justify-between font-normal gap-1 px-3`}
        >
          <span className="truncate">{selected ? selected.name : "— None —"}</span>
          <ChevronsUpDown className="w-3.5 h-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search supplier…" className="h-8 text-sm" />
          <CommandList className="max-h-56">
            <CommandEmpty>No supplier found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="none" onSelect={() => { onChange("none"); setOpen(false); }}>
                <Check className={`mr-2 w-3.5 h-3.5 ${value === "none" ? "opacity-100" : "opacity-0"}`} />
                — None —
              </CommandItem>
              {suppliers.map((s) => (
                <CommandItem key={s.id} value={s.name} onSelect={() => { onChange(String(s.id)); setOpen(false); }}>
                  <Check className={`mr-2 w-3.5 h-3.5 ${String(s.id) === value ? "opacity-100" : "opacity-0"}`} />
                  {s.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Variant row ─────────────────────────────────────────────────────────────
function VariantRow({ variant, suppliers, productId, onRefresh, onColourImageUpload, productSupplierId, productSecondaryId, productSupplierCode, productSupplierPrice }: {
  variant: any; suppliers: any[]; productId: number; onRefresh: () => void;
  onColourImageUpload: (colour: string | null, sleeve: string | null, imageUrl: string) => void;
  productSupplierId?: number | null; productSecondaryId?: number | null;
  productSupplierCode?: string; productSupplierPrice?: string;
}) {
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [stock, setStock] = useState(String(variant.stockQuantity));
  const [editStock, setEditStock] = useState(String(variant.stockQuantity));
  const [editSku, setEditSku] = useState(variant.sku || "");
  const [variantSalePrice, setVariantSalePrice] = useState(variant.price != null ? String(variant.price) : "");
  const [variantVatRate, setVariantVatRate] = useState(variant.vatRate != null ? String(variant.vatRate) : "inherit");
  const [primaryId, setPrimaryId] = useState(variant.primarySupplierId ? String(variant.primarySupplierId) : "none");
  const [variantSupplierCode, setVariantSupplierCode] = useState(variant.supplierCode || "");
  const [variantSupplierPrice, setVariantSupplierPrice] = useState(variant.supplierPrice != null ? String(variant.supplierPrice) : "");
  const [secondaryId, setSecondaryId] = useState(variant.secondarySupplierId ? String(variant.secondarySupplierId) : "none");
  const [secondarySupplierCode, setSecondarySupplierCode] = useState(variant.secondarySupplierCode || "");
  const [secondarySupplierPrice, setSecondarySupplierPrice] = useState(variant.secondarySupplierPrice != null ? String(variant.secondarySupplierPrice) : "");
  const [showVariantSecondary, setShowVariantSecondary] = useState(false);
  const [editImageUrl, setEditImageUrl] = useState(variant.imageUrl || "");
  const variantImageRef = useRef<HTMLInputElement>(null);
  const quickImageRef = useRef<HTMLInputElement>(null);

  // Upload used inside the edit dialog (updates local state only)
  const { uploadFile: uploadVariantImage, isUploading: isVariantImageUploading } = useUpload({
    onSuccess: (res) => setEditImageUrl(`/api/storage${res.objectPath}`),
    onError: () => toast({ title: "Image upload failed", variant: "destructive" }),
  });

  // Quick-upload: clicks directly on the row image cell → applies to all variants of this colour
  const { uploadFile: quickUploadImage, isUploading: isQuickUploading } = useUpload({
    onSuccess: (res) => {
      const url = `/api/storage${res.objectPath}`;
      setEditImageUrl(url);
      onColourImageUpload(variant.colour ?? null, variant.sleeve ?? null, url);
    },
    onError: () => toast({ title: "Image upload failed", variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: (data: any) => apiFetch(`/products/${productId}/variants/${variant.id}`, {
      method: "PATCH", body: JSON.stringify(data),
    }),
    onSuccess: () => { onRefresh(); setEditOpen(false); toast({ title: "Variant updated" }); },
    onError: () => toast({ title: "Error updating variant", variant: "destructive" }),
  });

  const availabilityMut = useMutation({
    mutationFn: (available: boolean) => apiFetch(`/products/${productId}/variants/${variant.id}`, {
      method: "PATCH", body: JSON.stringify({ isAvailable: available }),
    }),
    onSuccess: () => onRefresh(),
    onError: () => toast({ title: "Error updating availability", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: () => apiFetch(`/products/${productId}/variants/${variant.id}`, { method: "DELETE" }),
    onSuccess: () => { onRefresh(); toast({ title: "Variant removed" }); },
  });

  const handleStockBlur = () => {
    const num = parseInt(stock, 10);
    if (isNaN(num) || num < 0) { setStock(String(variant.stockQuantity)); return; }
    if (num !== variant.stockQuantity) {
      updateMut.mutate({ stockQuantity: num });
    }
  };

  const handleSaveEdit = () => {
    updateMut.mutate({
      stockQuantity: parseInt(editStock, 10) || 0,
      sku: editSku.trim() || null,
      price: variantSalePrice !== "" ? parseFloat(variantSalePrice) : null,
      vatRate: variantVatRate === "inherit" ? null : parseFloat(variantVatRate),
      imageUrl: editImageUrl || null,
      primarySupplierId: primaryId && primaryId !== "none" ? Number(primaryId) : null,
      supplierCode: variantSupplierCode || null,
      supplierPrice: variantSupplierPrice !== "" ? parseFloat(variantSupplierPrice) : null,
      secondarySupplierId: secondaryId && secondaryId !== "none" ? Number(secondaryId) : null,
      secondarySupplierCode: secondarySupplierCode || null,
      secondarySupplierPrice: secondarySupplierPrice !== "" ? parseFloat(secondarySupplierPrice) : null,
    });
  };

  const openEdit = () => {
    setEditStock(String(variant.stockQuantity));
    setEditSku(variant.sku || "");
    setVariantSalePrice(variant.price != null ? String(variant.price) : "");
    setVariantVatRate(variant.vatRate != null ? String(variant.vatRate) : "inherit");
    setEditImageUrl(variant.imageUrl || "");
    setPrimaryId(variant.primarySupplierId ? String(variant.primarySupplierId) : "none");
    setVariantSupplierCode(variant.supplierCode || "");
    setVariantSupplierPrice(variant.supplierPrice != null ? String(variant.supplierPrice) : "");
    setSecondaryId(variant.secondarySupplierId ? String(variant.secondarySupplierId) : "none");
    setSecondarySupplierCode(variant.secondarySupplierCode || "");
    setSecondarySupplierPrice(variant.secondarySupplierPrice != null ? String(variant.secondarySupplierPrice) : "");
    setEditOpen(true);
  };

  const primarySupplier = suppliers.find(s => s.id === (variant.primarySupplierId ?? productSupplierId));
  const secondarySupplier = suppliers.find(s => s.id === (variant.secondarySupplierId ?? productSecondaryId));
  const primaryIsInherited = !variant.primarySupplierId && !!productSupplierId;
  const secondaryIsInherited = !variant.secondarySupplierId && !!productSecondaryId;
  const isLowStock = variant.stockQuantity <= 5;

  return (
    <>
      <TableRow className="group hover:bg-muted/20">
        {/* Hidden file input for quick image upload */}
        <input ref={quickImageRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) quickUploadImage(f); e.target.value = ""; }}
        />
        <TableCell>
          <div className="flex items-center gap-2">
            {/* Image cell — click to upload */}
            <button
              type="button"
              title={variant.imageUrl ? "Click to replace image" : "Click to upload image"}
              onClick={() => quickImageRef.current?.click()}
              className="relative w-8 h-8 rounded overflow-hidden flex-shrink-0 group/img border border-border/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {isQuickUploading ? (
                <div className="w-full h-full bg-muted flex items-center justify-center">
                  <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                </div>
              ) : (variant.imageUrl || editImageUrl) ? (
                <>
                  <UploadedImage src={variant.imageUrl || editImageUrl} alt={variant.colour ?? ""} className="w-full h-full object-cover" fallback={<div className="w-full h-full bg-muted flex items-center justify-center"><Package className="w-3 h-3 text-muted-foreground/40" /></div>} />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                    <Camera className="w-3 h-3 text-white" />
                  </div>
                </>
              ) : (
                <div className="w-full h-full bg-pink-100 border-pink-200 flex items-center justify-center">
                  <div className="absolute inset-0 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center bg-pink-200/60">
                    <Camera className="w-3 h-3 text-pink-700" />
                  </div>
                </div>
              )}
            </button>
            {variant.colour
              ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-pink-100 text-pink-800 border border-pink-200">{variant.colour}</span>
              : <span className="text-muted-foreground text-sm italic">Any</span>}
          </div>
        </TableCell>
        <TableCell>
          {variant.sleeve
            ? <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">{variant.sleeve}</span>
            : <span className="text-muted-foreground text-sm italic">—</span>}
        </TableCell>
        <TableCell>
          {variant.size
            ? <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">{variant.size}</span>
            : <span className="text-muted-foreground text-sm italic">Any</span>}
        </TableCell>
        <TableCell className="font-mono text-xs">
          {variant.supplierCode
            ? <span className="text-foreground">{variant.supplierCode}</span>
            : productSupplierCode
              ? <span className="text-muted-foreground italic">{productSupplierCode}</span>
              : <span className="text-muted-foreground italic">—</span>}
        </TableCell>
        <TableCell className="text-xs tabular-nums">
          {variant.supplierPrice != null
            ? <span className="font-medium">£{parseFloat(String(variant.supplierPrice)).toFixed(2)}</span>
            : productSupplierPrice && productSupplierPrice !== ""
              ? <span className="text-muted-foreground italic">£{parseFloat(productSupplierPrice).toFixed(2)}</span>
              : <span className="text-muted-foreground italic">—</span>}
        </TableCell>
        <TableCell className="text-xs tabular-nums">
          {variant.price != null
            ? <span className="font-semibold text-primary">£{parseFloat(String(variant.price)).toFixed(2)}</span>
            : <span className="text-muted-foreground italic">Default</span>}
        </TableCell>
        <TableCell className="text-xs">
          {variant.vatRate != null
            ? <span className={Number(variant.vatRate) === 0 ? "font-semibold text-emerald-700" : "font-medium"}>{Number(variant.vatRate) === 0 ? "VAT free" : `${Number(variant.vatRate) * 100}%`}</span>
            : <span className="text-muted-foreground italic">Default</span>}
        </TableCell>
        <TableCell>
          <Input
            type="number"
            min={0}
            value={stock}
            onChange={e => setStock(e.target.value)}
            onBlur={handleStockBlur}
            className={`w-20 h-7 text-sm text-center ${isLowStock ? "border-amber-400 text-amber-700 font-bold" : ""}`}
          />
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {primarySupplier
            ? <span className={primaryIsInherited ? "text-muted-foreground italic" : "font-medium text-foreground"}>{primarySupplier.name}</span>
            : <span className="italic">—</span>}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {secondarySupplier
            ? <span className={secondaryIsInherited ? "italic" : ""}>{secondarySupplier.name}</span>
            : <span className="italic">—</span>}
        </TableCell>
        <TableCell>
          <button
            type="button"
            disabled={availabilityMut.isPending}
            onClick={() => availabilityMut.mutate(variant.isAvailable === false ? true : false)}
            className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border transition-colors disabled:opacity-50 ${
              variant.isAvailable === false
                ? "bg-slate-100 text-slate-500 border-slate-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-slate-100 hover:text-slate-500 hover:border-slate-200"
            }`}
          >
            {availabilityMut.isPending && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
            {variant.isAvailable === false ? "Unavailable" : "Available"}
          </button>
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={openEdit}>
              <Edit2 className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => {
              if (confirm("Remove this variant?")) deleteMut.mutate();
            }}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </TableCell>
      </TableRow>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Variant</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap gap-2 mb-4">
            {variant.colour && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-pink-100 text-pink-800 border border-pink-200">{variant.colour}</span>}
            {variant.sleeve && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">{variant.sleeve}</span>}
            {variant.size && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">{variant.size}</span>}
          </div>
          <div className="grid gap-4">
            {/* Variation image upload */}
            <div className="grid gap-2">
              <Label>Variation Image</Label>
              {editImageUrl ? (
                <div className="flex items-start gap-3">
                  <UploadedImage src={editImageUrl} alt="Variant" className="w-16 h-16 object-cover rounded-lg border border-border/50 flex-shrink-0" fallback={<div className="w-16 h-16 rounded-lg border border-border/50 bg-muted flex items-center justify-center flex-shrink-0"><Package className="w-5 h-5 text-muted-foreground/40" /></div>} />
                  <div className="flex flex-col gap-2 mt-1">
                    <button type="button" onClick={() => variantImageRef.current?.click()} disabled={isVariantImageUploading} className="text-xs text-primary hover:underline disabled:opacity-50">
                      {isVariantImageUploading ? "Uploading…" : "Replace image"}
                    </button>
                    <button type="button" onClick={() => setEditImageUrl("")} className="text-xs text-destructive hover:underline">Remove</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => variantImageRef.current?.click()} disabled={isVariantImageUploading}
                  className="flex items-center justify-center gap-2 h-16 rounded-lg border-2 border-dashed border-border/60 hover:border-primary/40 hover:bg-muted/30 transition-colors disabled:opacity-50"
                >
                  {isVariantImageUploading ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : <Upload className="w-4 h-4 text-muted-foreground" />}
                  <span className="text-xs text-muted-foreground">{isVariantImageUploading ? "Uploading…" : "Upload variation image"}</span>
                </button>
              )}
              <input ref={variantImageRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadVariantImage(f); e.target.value = ""; }}
              />
            </div>
            <div className="grid gap-2">
              <Label>SKU</Label>
              <Input value={editSku} onChange={e => setEditSku(e.target.value)} placeholder="Variant SKU" />
              <p className="text-[11px] text-muted-foreground">
                Use a different SKU here only when this colour has its own code.
              </p>
            </div>
            <div className="grid gap-2">
              <Label>Stock Quantity</Label>
              <Input type="number" min={0} value={editStock} onChange={e => setEditStock(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Sale Price (£, ex VAT)</Label>
              <Input
                type="number"
                min="1"
                step="1"
                value={variantSalePrice}
                onChange={e => setVariantSalePrice(e.target.value)}
                placeholder="Use default product price"
              />
              <p className="text-[11px] text-muted-foreground">
                Optional price for this exact colour and size. Includes the standard logo; leave blank to use the product price.
              </p>
            </div>
            <div className="grid gap-2">
              <Label>VAT for this size</Label>
              <Select value={variantVatRate} onValueChange={setVariantVatRate}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Use product VAT rate</SelectItem>
                  <SelectItem value="0.2">Standard VAT (20%)</SelectItem>
                  <SelectItem value="0.05">Reduced VAT (5%)</SelectItem>
                  <SelectItem value="0">VAT free (0%)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Choose VAT free for qualifying sizes such as children’s clothing.</p>
            </div>
            <div className="grid gap-2">
              <Label>Preferred Supplier</Label>
              <SupplierSelect value={primaryId} onChange={setPrimaryId} suppliers={suppliers} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Supplier Code</Label>
                <Input value={variantSupplierCode} onChange={e => setVariantSupplierCode(e.target.value)} placeholder="Override code" />
              </div>
              <div className="grid gap-2">
                {(() => {
                  const sup = suppliers.find((s: any) => String(s.id) === primaryId);
                  const sym = (sup as any)?.currency === "USD" ? "$" : (sup as any)?.currency === "EUR" ? "€" : "£";
                  return <Label>Supplier Price ({sym})</Label>;
                })()}
                <Input type="number" min="0" step="0.01" value={variantSupplierPrice} onChange={e => setVariantSupplierPrice(e.target.value)} placeholder="Override price" />
              </div>
            </div>

            <button
              type="button"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors select-none"
              onClick={() => setShowVariantSecondary(v => !v)}
            >
              <span className={`transition-transform duration-150 ${showVariantSecondary ? "rotate-90" : ""}`}>▶</span>
              {showVariantSecondary ? "Hide" : "Show"} backup supplier
            </button>

            {showVariantSecondary && (
              <div className="pl-4 border-l-2 border-border/40 space-y-3">
                <div className="grid gap-2">
                  <Label>Backup Supplier</Label>
                  <SupplierSelect value={secondaryId} onChange={setSecondaryId} suppliers={suppliers} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label>Backup Code</Label>
                    <Input value={secondarySupplierCode} onChange={e => setSecondarySupplierCode(e.target.value)} placeholder="Backup code" />
                  </div>
                  <div className="grid gap-2">
                    <Label>Backup Price (£)</Label>
                    <Input type="number" min="0" step="0.01" value={secondarySupplierPrice} onChange={e => setSecondarySupplierPrice(e.target.value)} placeholder="0.00" />
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={updateMut.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Add Variant Dialog ────────────────────────────────────────────────────
function AddVariantDialog({ open, onClose, productId, attributes, suppliers, defaultPrimaryId, defaultSecondaryId, onRefresh }: {
  open: boolean; onClose: () => void; productId: number;
  attributes: any[]; suppliers: any[];
  defaultPrimaryId: string; defaultSecondaryId: string;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const colours = attributes.filter(a => a.type === "colour").map(a => a.value);
  const sizes = attributes.filter(a => a.type === "size").map(a => a.value);
  const sleevesAttr = attributes.filter(a => a.type === "sleeve").map(a => a.value);

  const [colour, setColour] = useState("none");
  const [customColour, setCustomColour] = useState("");
  const [size, setSize] = useState("none");
  const [customSize, setCustomSize] = useState("");
  const [sleeve, setSleeve] = useState("none");
  const [customSleeve, setCustomSleeve] = useState("");
  const [stock, setStock] = useState("0");
  const [primaryId, setPrimaryId] = useState(defaultPrimaryId);
  const [secondaryId, setSecondaryId] = useState(defaultSecondaryId);

  useEffect(() => {
    if (open) {
      setColour("none"); setCustomColour("");
      setSize("none"); setCustomSize("");
      setSleeve("none"); setCustomSleeve("");
      setStock("0");
      setPrimaryId(defaultPrimaryId);
      setSecondaryId(defaultSecondaryId);
    }
  }, [open, defaultPrimaryId, defaultSecondaryId]);

  const createMut = useMutation({
    mutationFn: (data: any) => apiFetch(`/products/${productId}/variants`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { onRefresh(); onClose(); toast({ title: "Variant added" }); },
    onError: () => toast({ title: "Error adding variant", variant: "destructive" }),
  });

  const handleSave = () => {
    const finalColour = colour === "custom" ? customColour.trim() : colour === "none" ? null : colour;
    const finalSize = size === "custom" ? customSize.trim() : size === "none" ? null : size;
    const finalSleeve = sleeve === "custom" ? customSleeve.trim() : sleeve === "none" ? null : sleeve;
    createMut.mutate({
      colour: finalColour,
      size: finalSize,
      sleeve: finalSleeve,
      stockQuantity: parseInt(stock, 10) || 0,
      primarySupplierId: primaryId && primaryId !== "none" ? Number(primaryId) : null,
      secondarySupplierId: secondaryId && secondaryId !== "none" ? Number(secondaryId) : null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add Variant Combination</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Colour</Label>
              <Select value={colour} onValueChange={setColour}>
                <SelectTrigger><SelectValue placeholder="Select colour…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— No colour —</SelectItem>
                  {colours.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  <SelectItem value="custom">Custom…</SelectItem>
                </SelectContent>
              </Select>
              {colour === "custom" && (
                <Input placeholder="Enter colour" value={customColour} onChange={e => setCustomColour(e.target.value)} />
              )}
            </div>
            <div className="grid gap-2">
              <Label>Size</Label>
              <Select value={size} onValueChange={setSize}>
                <SelectTrigger><SelectValue placeholder="Select size…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— No size —</SelectItem>
                  {sizes.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  <SelectItem value="custom">Custom…</SelectItem>
                </SelectContent>
              </Select>
              {size === "custom" && (
                <Input placeholder="Enter size" value={customSize} onChange={e => setCustomSize(e.target.value)} />
              )}
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Fit / Length <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Select value={sleeve} onValueChange={setSleeve}>
              <SelectTrigger><SelectValue placeholder="Select fit / length…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— No sleeve —</SelectItem>
                {sleevesAttr.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                <SelectItem value="custom">Custom…</SelectItem>
              </SelectContent>
            </Select>
            {sleeve === "custom" && (
              <Input placeholder="e.g. Long Sleeve" value={customSleeve} onChange={e => setCustomSleeve(e.target.value)} />
            )}
          </div>
          <div className="grid gap-2">
            <Label>Stock Quantity</Label>
            <Input type="number" min={0} value={stock} onChange={e => setStock(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Primary Supplier</Label>
            <SupplierSelect value={primaryId} onChange={setPrimaryId} suppliers={suppliers} />
          </div>
          <div className="grid gap-2">
            <Label>Secondary Supplier <span className="text-muted-foreground font-normal">(out-of-stock fallback)</span></Label>
            <SupplierSelect value={secondaryId} onChange={setSecondaryId} suppliers={suppliers} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={createMut.isPending}>Add Variant</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const productId = Number(id);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { confirmIfNotWhole, dialog: priceConfirmDialog } = usePriceConfirm();
  const sizeOrder = useSizeOrder();

  const { data: product, isLoading } = useGetProduct(productId);
  const { data: suppliers = [] } = useListSuppliers({});
  const updateMutation = useUpdateProduct();

  const productImageRef = useRef<HTMLInputElement>(null);
  const { uploadFile: uploadProductImage, isUploading: isProductImageUploading } = useUpload({
    onSuccess: async (res) => {
      const newUrl = `/api/storage${res.objectPath}`;
      await updateMutation.mutateAsync({ id: productId, data: { imageUrl: newUrl } as any });
      qc.invalidateQueries({ queryKey: getListProductsQueryKey() });
      toast({ title: "Product image updated" });
    },
    onError: () => toast({ title: "Image upload failed", variant: "destructive" }),
  });

  // ── Group-row bulk image upload (applies to all variants of a colour+sleeve group) ──
  const groupImageInputRef = useRef<HTMLInputElement>(null);
  const [uploadingGroupKey, setUploadingGroupKey] = useState<string | null>(null);
  const { uploadFile: uploadGroupImage, isUploading: isGroupImageUploading } = useUpload({
    onSuccess: async (res) => {
      if (!uploadingGroupKey) return;
      const url = `/api/storage${res.objectPath}`;
      const [groupColour, groupSleeve] = uploadingGroupKey.split("||");
      const groupVariants = (variants as any[]).filter((v: any) =>
        (v.colour ?? "") === groupColour && (v.sleeve ?? "") === groupSleeve
      );
      await Promise.all(
        groupVariants.map((v: any) =>
          apiFetch(`/products/${productId}/variants/${v.id}`, {
            method: "PATCH",
            body: JSON.stringify({ imageUrl: url }),
          })
        )
      );
      refetchVariants();
      refetchAttrs();
      setUploadingGroupKey(null);
      toast({ title: `Image applied to ${groupVariants.length} variant${groupVariants.length !== 1 ? "s" : ""}` });
    },
    onError: () => {
      toast({ title: "Image upload failed", variant: "destructive" });
      setUploadingGroupKey(null);
    },
  });

  const { data: attributes = [], refetch: refetchAttrs } = useQuery({
    queryKey: ["product", productId, "attributes"],
    queryFn: () => apiFetch(`/products/${productId}/attributes`),
    enabled: !!productId,
  });

  const { data: globalBrandingPositions = [] } = useQuery<{ id: string; name: string; surcharge: number; notes_field?: boolean }[]>({
    queryKey: ["shop-branding-options"],
    queryFn: () => apiFetch("/shop/branding-options"),
    staleTime: 10 * 60_000,
  });

  const { data: variantsData, refetch: refetchVariants } = useQuery({
    queryKey: ["product", productId, "variants"],
    queryFn: () => apiFetch(`/products/${productId}/variants`),
    enabled: !!productId,
  });
  // Stable reference: avoids creating a new [] on every render while loading
  const variants = useMemo(() => (variantsData as any[]) ?? [], [variantsData]);

  const rewriteMut = useMutation({
    mutationFn: ({ draft, staffName }: { draft: string; staffName: string }) =>
      apiFetch("/staff/rewrite-quote", {
        method: "POST",
        body: JSON.stringify({ draft, staffName, productName: (product as any)?.name ?? "" }),
      }),
    onSuccess: (data: any) => {
      setQuoteRewritten(data.rewritten);
      setQuoteUseRewritten(true);
    },
    onError: () => toast({ title: "AI rewrite failed", variant: "destructive" }),
  });

  const addStaffMut = useMutation({
    mutationFn: (body: { name: string; role: string | null; profileImageUrl: string | null }) =>
      apiFetch("/staff", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { refetchStaff(); setStaffFormName(""); setStaffFormRole(""); setStaffFormImageUrl(""); setEditingStaffId(null); },
    onError: () => toast({ title: "Could not save staff member", variant: "destructive" }),
  });

  const updateStaffMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { name: string; role: string | null; profileImageUrl: string | null } }) =>
      apiFetch(`/staff/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { refetchStaff(); setStaffFormName(""); setStaffFormRole(""); setStaffFormImageUrl(""); setEditingStaffId(null); },
    onError: () => toast({ title: "Could not update staff member", variant: "destructive" }),
  });

  const deleteStaffMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/staff/${id}`, { method: "DELETE" }),
    onSuccess: () => refetchStaff(),
    onError: () => toast({ title: "Could not delete staff member", variant: "destructive" }),
  });

  const { uploadFile: uploadStaffPhoto, isUploading: uploadingStaffPhoto } = useUpload({});

  async function confirmCrop() {
    if (!cropSrc) return;
    setIsCropping(true);
    try {
      const SIZE = 400;
      const canvas = document.createElement("canvas");
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext("2d")!;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = cropSrc;
      await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = reject; });
      // Scale so shorter side fills the preview (200px), then apply zoom
      const aspect = img.naturalWidth / img.naturalHeight;
      let baseW = aspect >= 1 ? 200 * aspect : 200;
      let baseH = aspect >= 1 ? 200 : 200 / aspect;
      const canvasScale = SIZE / 200;
      const w = baseW * cropZoom * canvasScale;
      const h = baseH * cropZoom * canvasScale;
      const dx = SIZE / 2 - w / 2 + cropOffsetX * canvasScale;
      const dy = SIZE / 2 - h / 2 + cropOffsetY * canvasScale;
      ctx.drawImage(img, dx, dy, w, h);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
      if (!blob) return;
      const file = new File([blob], "staff-crop.jpg", { type: "image/jpeg" });
      const res = await uploadStaffPhoto(file);
      if (res) {
        setStaffFormImageUrl(`/api/storage${res.objectPath}`);
        setCropSrc(null);
        setCropZoom(1);
        setCropOffsetX(0);
        setCropOffsetY(0);
      }
    } finally {
      setIsCropping(false);
    }
  }

  const socialPostsQuery = useQuery<any[]>({
    queryKey: ["social-posts", productId],
    queryFn: () => apiFetch(`/products/${productId}/social-posts`),
    enabled: !!productId,
  });

  const socialImagesQuery = useQuery<any>({
    queryKey: ["social-images", productId],
    queryFn: () => apiFetch(`/products/${productId}/social-images`),
    enabled: !!productId,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (socialImagesQuery.data) {
      const d = socialImagesQuery.data as any;
      setSocialVariantImages(d.variantImages ?? []);
      setSocialDraft(p => ({
        ...p,
        productImageUrl: p.productImageUrl ?? d.productImageUrl ?? null,
        websiteUrl: p.websiteUrl || d.websiteUrl || "",
      }));
    }
  }, [socialImagesQuery.data]);

  const generateSocialMut = useMutation({
    mutationFn: () => apiFetch<any>(`/products/${productId}/social-posts/generate`, { method: "POST" }),
    onSuccess: (data: any) => {
      if (data.variantImages?.length) setSocialVariantImages(data.variantImages);
      setSocialDraft(p => ({ ...p, facebookContent: data.facebookContent || "", googleContent: data.googleContent || "", linkedinContent: data.linkedinContent || "", hashtags: data.hashtags || "", productImageUrl: data.productImageUrl ?? null, websiteUrl: p.websiteUrl || data.websiteUrl || "", editingId: null }));
      toast({ title: "Post generated — review and save or schedule" });
    },
    onError: (e: any) => toast({ title: "AI generation failed", description: e?.message, variant: "destructive" }),
  });

  const pullWooMediaMut = useMutation({
    mutationFn: () => apiFetch<{ imageUrl: string | null; permalink: string | null; variantImages?: { colour: string; imageUrl: string }[] }>(`/products/${productId}/pull-woo-media`),
    onSuccess: (data) => {
      // Update variant images in state so they don't disappear after the query refetch
      if (data.variantImages?.length) {
        setSocialVariantImages(prev => {
          const merged = [...prev];
          for (const v of data.variantImages!) {
            const idx = merged.findIndex(m => m.colour.toLowerCase() === v.colour.toLowerCase());
            if (idx >= 0) merged[idx] = v;
            else merged.push(v);
          }
          return merged;
        });
      }
      setSocialDraft(p => ({
        ...p,
        productImageUrl: data.imageUrl ?? p.productImageUrl,
        websiteUrl: data.permalink || p.websiteUrl,
      }));
      // Invalidate after state is updated so the refetch confirms what we've applied
      qc.invalidateQueries({ queryKey: ["social-images", productId] });
      const parts = [data.imageUrl && "image", data.permalink && "page URL", data.variantImages?.length && `${data.variantImages.length} variant image(s)`].filter(Boolean);
      toast({ title: "Pulled from WooCommerce", description: parts.join(", ") + " updated" });
    },
    onError: (e: any) => toast({ title: "WooCommerce pull failed", description: e?.message, variant: "destructive" }),
  });

  const saveSocialMut = useMutation({
    mutationFn: () => {
      const body = JSON.stringify({ facebookContent: socialDraft.facebookContent, googleContent: socialDraft.googleContent, linkedinContent: socialDraft.linkedinContent, hashtags: socialDraft.hashtags, platforms: socialDraft.platforms, autoReschedule: socialDraft.autoReschedule, productImageUrl: socialDraft.productImageUrl, websiteUrl: socialDraft.websiteUrl || null, season: socialDraft.season || null });
      return socialDraft.editingId
        ? apiFetch<any>(`/social-posts/${socialDraft.editingId}`, { method: "PATCH", body })
        : apiFetch<any>(`/products/${productId}/social-posts`, { method: "POST", body });
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["social-posts", productId] });
      setSocialDraft(p => ({ ...p, editingId: data?.id ?? p.editingId }));
      toast({ title: "Post saved" });
    },
    onError: () => toast({ title: "Failed to save post", variant: "destructive" }),
  });

  const scheduleSocialMut = useMutation({
    mutationFn: async () => {
      let id = socialDraft.editingId;
      if (!id) {
        const saved = await apiFetch<any>(`/products/${productId}/social-posts`, { method: "POST", body: JSON.stringify({ facebookContent: socialDraft.facebookContent, googleContent: socialDraft.googleContent, linkedinContent: socialDraft.linkedinContent, hashtags: socialDraft.hashtags, platforms: socialDraft.platforms, autoReschedule: socialDraft.autoReschedule, productImageUrl: socialDraft.productImageUrl, websiteUrl: socialDraft.websiteUrl || null, season: socialDraft.season || null }) });
        id = saved.id;
        setSocialDraft(p => ({ ...p, editingId: id ?? p.editingId }));
      }
      return apiFetch<any>(`/social-posts/${id}/schedule`, { method: "POST", body: JSON.stringify({ autoReschedule: socialDraft.autoReschedule }) });
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["social-posts", productId] });
      const d = new Date(data.scheduledAt);
      toast({ title: `Scheduled for ${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}` });
    },
    onError: (e: any) => toast({ title: "Scheduling failed", description: e?.message, variant: "destructive" }),
  });

  const publishSocialMut = useMutation({
    mutationFn: async () => {
      let id = socialDraft.editingId;
      if (!id) {
        const saved = await apiFetch<any>(`/products/${productId}/social-posts`, { method: "POST", body: JSON.stringify({ facebookContent: socialDraft.facebookContent, googleContent: socialDraft.googleContent, linkedinContent: socialDraft.linkedinContent, hashtags: socialDraft.hashtags, platforms: socialDraft.platforms, autoReschedule: socialDraft.autoReschedule, productImageUrl: socialDraft.productImageUrl, websiteUrl: socialDraft.websiteUrl || null, season: socialDraft.season || null }) });
        id = saved.id;
        setSocialDraft(p => ({ ...p, editingId: id ?? p.editingId }));
      }
      return apiFetch<any>(`/social-posts/${id}/publish`, { method: "POST" });
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["social-posts", productId] });
      if (data.queued) toast({ title: "Queued!", description: `Will publish ${new Date(data.scheduledAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}` });
      else if (data.ok) toast({ title: "Published!" });
      else toast({ title: "Error", description: "Check post history for details", variant: "destructive" });
    },
    onError: (e: any) => toast({ title: "Publish failed", description: e?.message, variant: "destructive" }),
  });

  const publishSocialById = useMutation({
    mutationFn: (id: number) => apiFetch<any>(`/social-posts/${id}/publish`, { method: "POST" }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["social-posts", productId] });
      if (data.queued) toast({ title: "Queued!", description: `Will publish ${new Date(data.scheduledAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}` });
      else if (data.ok) toast({ title: "Published!" });
      else toast({ title: "Published with notes", variant: "destructive" });
    },
    onError: (e: any) => toast({ title: "Publish failed", description: e?.message, variant: "destructive" }),
  });

  const refreshStatsMut = useMutation({
    mutationFn: (id: number) => apiFetch<any>(`/social-posts/${id}/insights`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["social-posts", productId] }),
    onError: () => toast({ title: "Could not fetch stats — check Facebook is connected", variant: "destructive" }),
  });

  const deleteSocialMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/social-posts/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["social-posts", productId] }),
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const websitePublicationMut = useMutation({
    mutationFn: (published: boolean) =>
      apiFetch(`/products/${productId}/website-publication`, { method: "PATCH", body: JSON.stringify({ published }) }),
    onSuccess: (_data, published) => {
      qc.invalidateQueries({ queryKey: getGetProductQueryKey(productId) });
      qc.invalidateQueries({ queryKey: getListProductsQueryKey() });
      toast({ title: published ? "Published to shop" : "Removed from shop" });
    },
    onError: (error: any) => toast({ title: "Could not update website publication", description: error?.message, variant: "destructive" }),
  });

  // Image Generation tab state — declared here so it is initialized before the
  // useEffect below references imgGenPopulated in its dependency array.
  const [imgGen, setImgGen] = useState({
    productName: "",
    garmentType: "",
    genderFit: "Unisex" as "Male" | "Female" | "Unisex",
    category: "Corporate" as "Trade" | "Corporate" | "Hospitality" | "Hi-Vis" | "Healthcare" | "Outerwear",
    heroColourway: "",
    availableColourways: [] as string[],
    numThumbnails: 9,
    logoText: "YOUR LOGO HERE",
    imageSize: "1000px x 1000px",
    notes: "",
    generateAnimation: false,
  });
  const [imgGenPrompt, setImgGenPrompt] = useState("");
  const [imgGenAnimPrompt, setImgGenAnimPrompt] = useState<string | null>(null);
  const [imgGenImage, setImgGenImage] = useState<string | null>(null);
  const [imgGenPopulated, setImgGenPopulated] = useState(false);
  const [imgGenNewColour, setImgGenNewColour] = useState("");
  const [imgGenHistory, setImgGenHistory] = useState<Array<{ ts: number; productName: string; stillPrompt: string; animationPrompt: string | null; image: string | null }>>(() => {
    try { return JSON.parse(localStorage.getItem(`imggen_history_${productId}`) ?? "[]"); } catch { return []; }
  });
  const [imgGenHistoryOpen, setImgGenHistoryOpen] = useState(false);

  // Auto-refresh WooCommerce status from WooCommerce when it's unknown
  const wooRefreshMut = useMutation({
    mutationFn: () => apiFetch<any>(`/products/${productId}/woo-refresh`),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: getGetProductQueryKey(productId) });
      if (data?.status) toast({ title: `WooCommerce status: ${data.status}` });
    },
  });
  useEffect(() => {
    if ((product as any)?.wooCommerceId && !(product as any)?.wooStatus) {
      wooRefreshMut.mutate();
    }
  }, [(product as any)?.wooCommerceId, (product as any)?.wooStatus]);

  // Pre-populate Image Gen form from product + attributes colour palette when first loaded
  useEffect(() => {
    if (!imgGenPopulated && product && (attributes as any[]).length > 0) {
      const colours = (attributes as any[]).filter((a: any) => a.type === "colour").map((a: any) => a.value as string);
      const randomHero = colours.length > 0 ? colours[Math.floor(Math.random() * colours.length)] : "";
      setImgGen(prev => ({
        ...prev,
        productName: (product as any).name || prev.productName,
        heroColourway: randomHero || prev.heroColourway,
        availableColourways: colours.length > 0 ? colours : prev.availableColourways,
      }));
      setImgGenPopulated(true);
    }
  }, [product, attributes, imgGenPopulated]);

  const generateImgPromptMut = useMutation({
    mutationFn: () => apiFetch<any>(`/products/${productId}/generate-image-prompt`, {
      method: "POST",
      body: JSON.stringify(imgGen),
    }),
    onSuccess: (data: any) => {
      const stillPrompt = data.prompt || "";
      const animPrompt = data.animationPrompt ?? null;
      setImgGenPrompt(stillPrompt);
      setImgGenAnimPrompt(animPrompt);
      setImgGenImage(null);
      const entry = { ts: Date.now(), productName: imgGen.productName, stillPrompt, animationPrompt: animPrompt, image: null };
      const updated = [entry, ...imgGenHistory].slice(0, 10);
      setImgGenHistory(updated);
      try { localStorage.setItem(`imggen_history_${productId}`, JSON.stringify(updated)); } catch {}
      toast({ title: "Prompt ready — copy and paste into ChatGPT" });
    },
    onError: (err: any) => toast({ title: err.message || "Failed to generate image", variant: "destructive" }),
  });

  // Upload one image and apply it to every variant that shares the same colour
  async function handleColourImageUpload(colour: string | null, sleeve: string | null, imageUrl: string) {
    const siblings = (variants as any[]).filter((v) =>
      (colour == null ? v.colour == null : v.colour === colour) &&
      (sleeve == null ? v.sleeve == null : v.sleeve === sleeve)
    );
    await Promise.all(
      siblings.map((v) =>
        apiFetch(`/products/${productId}/variants/${v.id}`, {
          method: "PATCH",
          body: JSON.stringify({ imageUrl }),
        })
      )
    );
    refetchVariants();
    refetchAttrs();
  }

  // Use product_categories (WooCommerce-synced) so the dropdown shows valid categories
  // that will map to real WooCommerce category IDs on save.
  const { data: wooCategories = [] } = useQuery<{ id: number; wooId: number | null; name: string; parentWooId?: number | null }[]>({
    queryKey: ["product-categories"],
    queryFn: () => apiFetch("/product-categories"),
  });

  const { data: staffList = [], refetch: refetchStaff } = useQuery<any[]>({
    queryKey: ["staff-members"],
    queryFn: () => apiFetch("/staff"),
  });

  const [details, setDetails] = useState<{
    name: string; sku: string; description: string; category: string; wooCategoryIds: number[];
    unitPrice: number; supplierId: string; secondarySupplierId: string;
    supplierCode: string; supplierPrice: string;
    secondarySupplierCode: string; secondarySupplierPrice: string;
    supplierCurrency: string;
    minOrderQty: string;
    vatRate: string;
    priceBreaks: { qty: number; price: number }[];
  } | null>(null);
  const [detailsDirty, setDetailsDirty] = useState(false);
  const [guidance, setGuidance] = useState<{
    bestFor: string;
    notIdealFor: string;
    staffQuotes: { id: string; staffId: number; staffName: string; staffRole: string | null; staffImageUrl: string | null; draft: string; rewritten: string | null; }[];
    badges: string[];
    valueRating: number | null;
    durabilityRating: number | null;
    smartRating: number | null;
    tags: string[];
  } | null>(null);
  const [guidanceDirty, setGuidanceDirty] = useState(false);
  const [customTagInput, setCustomTagInput] = useState("");
  // Per-product branding override: 'global' = use defaults, 'disabled' = no branding, 'custom' = override list
  const [brandingMode, setBrandingMode] = useState<'global' | 'disabled' | 'custom'>('global');
  const [brandingOverrideDirty, setBrandingOverrideDirty] = useState(false);
  const [customBrandingIds, setCustomBrandingIds] = useState<Set<string>>(new Set());
  const [socialDraft, setSocialDraft] = useState<{
    facebookContent: string; googleContent: string; linkedinContent: string; hashtags: string;
    platforms: string[]; autoReschedule: boolean; editingId: number | null;
    productImageUrl: string | null; websiteUrl: string; season: string | null;
  }>({ facebookContent: "", googleContent: "", linkedinContent: "", hashtags: "", platforms: ["facebook", "google"], autoReschedule: true, editingId: null, productImageUrl: null, websiteUrl: "", season: null });
  const [socialVariantImages, setSocialVariantImages] = useState<{ colour: string; imageUrl: string }[]>([]);
  const [socialShowPreview, setSocialShowPreview] = useState(false);

  const [quoteDialogOpen, setQuoteDialogOpen] = useState(false);
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [quoteDraft, setQuoteDraft] = useState("");
  const [quoteStaffId, setQuoteStaffId] = useState<number | null>(null);
  const [quoteRewritten, setQuoteRewritten] = useState<string | null>(null);
  const [quoteUseRewritten, setQuoteUseRewritten] = useState(false);
  const [manageStaffOpen, setManageStaffOpen] = useState(false);
  const [staffFormName, setStaffFormName] = useState("");
  const [staffFormRole, setStaffFormRole] = useState("");
  const [staffFormImageUrl, setStaffFormImageUrl] = useState("");
  const [editingStaffId, setEditingStaffId] = useState<number | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropOffsetX, setCropOffsetX] = useState(0);
  const [cropOffsetY, setCropOffsetY] = useState(0);
  const [isCropping, setIsCropping] = useState(false);
  const cropDragRef = useRef<{ active: boolean; lastX: number; lastY: number }>({ active: false, lastX: 0, lastY: 0 });
  const [isService, setIsService] = useState(false);
  const [isBespoke, setIsBespoke] = useState(false);
  const [bespokeCustomerId, setBespokeCustomerId] = useState<string>("none");
  const [bespokePickerOpen, setBespokePickerOpen] = useState(false);
  const [priceBreakModes, setPriceBreakModes] = useState<Record<number, "price" | "pct" | "disc">>({});
  const [showSecondarySupplier, setShowSecondarySupplier] = useState(false);
  const [addVariantOpen, setAddVariantOpen] = useState(false);
  const [generateMatrixOpen, setGenerateMatrixOpen] = useState(false);
  const [filterColour, setFilterColour] = useState<string>("all");
  const [filterSize, setFilterSize] = useState<string>("all");
  const [filterSleeve, setFilterSleeve] = useState<string>("all");
  const [filterSearch, setFilterSearch] = useState<string>("");
  const [bulkPrimaryId, setBulkPrimaryId] = useState<string>("none");
  const [bulkPrice, setBulkPrice] = useState<string>("");
  const [bulkCode, setBulkCode] = useState<string>("");

  useEffect(() => {
    if (product) {
      setIsService(!!(product as any).isService);
      setIsBespoke(!!(product as any).isBespoke);
      setBespokeCustomerId((product as any).customerId ? String((product as any).customerId) : "none");
    }
    if (product && !details) {
      setDetails({
        name: product.name,
        sku: product.sku || "",
        description: product.description || "",
        category: (product as any).category || "",
        wooCategoryIds: Array.isArray((product as any).wooCategoryIds)
          ? (product as any).wooCategoryIds.map(Number).filter((id: number) => Number.isInteger(id) && id > 0)
          : [],
        unitPrice: product.unitPrice,
        supplierId: product.supplierId ? String(product.supplierId) : "none",
        secondarySupplierId: product.secondarySupplierId ? String(product.secondarySupplierId) : "none",
        supplierCode: product.supplierCode || "",
        supplierPrice: product.supplierPrice != null ? String(product.supplierPrice) : "",
        secondarySupplierCode: product.secondarySupplierCode || "",
        secondarySupplierPrice: product.secondarySupplierPrice != null ? String(product.secondarySupplierPrice) : "",
        supplierCurrency: (product as any).supplierCurrency ?? "GBP",
        minOrderQty: (product as any).minOrderQty != null ? String((product as any).minOrderQty) : "",
        vatRate: (product as any).vatRate != null ? String(parseFloat(String((product as any).vatRate))) : "0.2",
        priceBreaks: Array.isArray((product as any).priceBreaks) ? (product as any).priceBreaks : [],
      });
    }
    if (product && !guidance) {
      const p = product as any;
      setGuidance({
        bestFor: p.guidanceBestFor || "",
        notIdealFor: p.guidanceNotIdealFor || "",
        staffQuotes: Array.isArray(p.guidanceStaffQuotes) ? p.guidanceStaffQuotes : [],
        badges: Array.isArray(p.guidanceBadges) ? p.guidanceBadges : (p.guidanceBadge ? [p.guidanceBadge] : []),
        valueRating: p.guidanceValueRating ?? null,
        durabilityRating: p.guidanceDurabilityRating ?? null,
        smartRating: p.guidanceSmartRating ?? null,
        tags: Array.isArray(p.guidanceTags) ? p.guidanceTags : [],
      });
      // Initialise branding override mode from the product
      if (!brandingOverrideDirty) {
        const ov = (p as any).brandingPositionsOverride;
        if (ov === null || ov === undefined) setBrandingMode('global');
        else if (Array.isArray(ov) && ov.length === 0) setBrandingMode('disabled');
        else {
          setBrandingMode('custom');
          setCustomBrandingIds(new Set((ov as any[]).map((pos: any) => pos.id)));
        }
      }
    }
  }, [product, details, guidance, brandingOverrideDirty]);

  useEffect(() => {
    if (!details || details.wooCategoryIds.length > 0 || !details.category || wooCategories.length === 0) return;
    const legacyMatch = wooCategories.find(
      (category) => category.wooId != null && category.name.trim().toLowerCase() === details.category.trim().toLowerCase(),
    );
    if (legacyMatch?.wooId) {
      setDetails((previous) => previous
        ? { ...previous, wooCategoryIds: [Number(legacyMatch.wooId)] }
        : previous);
    }
  }, [details, wooCategories]);

  const handleDetailChange = (field: string, value: any) => {
    setDetails(prev => prev ? { ...prev, [field]: value } : prev);
    setDetailsDirty(true);
  };

  const handleCategoryChange = (wooCategoryIds: number[]) => {
    setDetails((previous) => {
      if (!previous) return previous;
      const currentCategory = wooCategories.find(
        (category) => category.wooId != null
          && category.name.trim().toLowerCase() === previous.category.trim().toLowerCase(),
      );
      const currentStillSelected = currentCategory?.wooId != null
        && wooCategoryIds.includes(Number(currentCategory.wooId));
      const firstSelected = wooCategories.find(
        (category) => category.wooId != null && wooCategoryIds.includes(Number(category.wooId)),
      );
      const currentIsLocalOnly = previous.category
        && !wooCategories.some(
          (category) => category.wooId != null
            && category.name.trim().toLowerCase() === previous.category.trim().toLowerCase(),
        );

      return {
        ...previous,
        wooCategoryIds,
        category: currentStillSelected
          ? previous.category
          : firstSelected?.name ?? (currentIsLocalOnly ? previous.category : ""),
      };
    });
    setDetailsDirty(true);
  };

  const handleGuidanceChange = (field: string, value: any) => {
    setGuidance(prev => prev ? { ...prev, [field]: value } : prev);
    setGuidanceDirty(true);
  };

  // When supplier changes: auto-set currency from supplier record and apply default price breaks if none set
  const handleSupplierChange = (supplierId: string) => {
    const supplier = suppliers.find((s: any) => String(s.id) === supplierId);
    setDetails(prev => {
      if (!prev) return prev;
      const currency = (supplier as any)?.currency ?? "GBP";
      const hasBreaks = prev.priceBreaks.length > 0;
      const supplierBreaks: { qty: number; price: number }[] = (supplier as any)?.defaultPriceBreaks ?? [];
      return {
        ...prev,
        supplierId,
        supplierCurrency: currency,
        priceBreaks: !hasBreaks && supplierBreaks.length > 0 ? supplierBreaks : prev.priceBreaks,
      };
    });
    setDetailsDirty(true);
  };

  const saveDetails = async () => {
    if (!details?.name) { toast({ title: "Product name is required", variant: "destructive" }); return; }
    const priceOk = await confirmIfNotWhole(Number(details.unitPrice));
    if (!priceOk) return;
    updateMutation.mutate(
      {
        id: productId,
        data: {
          name: details.name,
          sku: details.sku || null,
          description: details.description || null,
          category: details.category.trim() || null,
          wooCategoryIds: details.wooCategoryIds,
          unitPrice: Number(details.unitPrice),
          supplierId: details.supplierId !== "none" ? Number(details.supplierId) : null,
          secondarySupplierId: details.secondarySupplierId !== "none" ? Number(details.secondarySupplierId) : null,
          supplierCode: details.supplierCode || null,
          supplierPrice: details.supplierPrice !== "" ? parseFloat(details.supplierPrice) : null,
          secondarySupplierCode: details.secondarySupplierCode || null,
          secondarySupplierPrice: details.secondarySupplierPrice !== "" ? parseFloat(details.secondarySupplierPrice) : null,
          supplierCurrency: details.supplierCurrency,
          minOrderQty: details.minOrderQty !== "" ? parseInt(details.minOrderQty, 10) || null : null,
          vatRate: parseFloat(details.vatRate) || 0,
          priceBreaks: details.priceBreaks.length > 0
            ? [...details.priceBreaks].sort((a, b) => a.qty - b.qty)
            : null,
        } as any,
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListProductsQueryKey() });
          qc.invalidateQueries({ queryKey: ["product", productId, "attributes"] });
          qc.invalidateQueries({ queryKey: ["product", productId, "variants"] });
          qc.invalidateQueries({ queryKey: getGetProductQueryKey(productId) });
          // Don't null details — the form already shows the correct saved values.
          // Nulling here causes a race: the useEffect repopulates from stale product
          // data before the refetch completes, then the guard blocks the correction.
          toast({ title: "Product saved" });
          setDetailsDirty(false);
        },
        onError: () => toast({ title: "Could not save product", variant: "destructive" }),
      }
    );
  };

  const saveGuidance = (staffQuotesOverride?: typeof guidance extends null ? never : typeof guidance.staffQuotes) => {
    if (!guidance) return;
    const quotes = staffQuotesOverride ?? guidance.staffQuotes;
    updateMutation.mutate(
      {
        id: productId,
        data: {
          guidanceBestFor: guidance.bestFor || null,
          guidanceNotIdealFor: guidance.notIdealFor || null,
          guidanceStaffQuotes: quotes.length > 0 ? quotes : null,
          guidanceBadges: guidance.badges.length > 0 ? guidance.badges : null,
          guidanceValueRating: guidance.valueRating,
          guidanceDurabilityRating: guidance.durabilityRating,
          guidanceSmartRating: guidance.smartRating,
          guidanceTags: guidance.tags.length > 0 ? guidance.tags : null,
        } as any,
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetProductQueryKey(productId) });
          toast({ title: "Guidance saved" });
          setGuidanceDirty(false);
        },
        onError: () => toast({ title: "Could not save guidance", variant: "destructive" }),
      }
    );
  };

  const toggleServiceMut = useMutation({
    mutationFn: (val: boolean) => apiFetch(`/products/${productId}`, {
      method: "PATCH",
      body: JSON.stringify({ isService: val }),
    }),
    onSuccess: (_data: any, val: boolean) => {
      setIsService(val);
      qc.invalidateQueries({ queryKey: getListProductsQueryKey() });
      qc.invalidateQueries({ queryKey: ["product", productId] });
      toast({ title: val ? "Marked as service" : "Marked as physical product" });
    },
    onError: () => toast({ title: "Could not update product type", variant: "destructive" }),
  });

  const { data: customers = [] } = useListCustomers();

  const setBespokeMut = useMutation({
    mutationFn: ({ bespoke, customerId }: { bespoke: boolean; customerId: number | null }) =>
      apiFetch(`/products/${productId}`, {
        method: "PATCH",
        body: JSON.stringify({ isBespoke: bespoke, customerId: bespoke ? customerId : null }),
      }),
    onSuccess: (_data: any, vars) => {
      setIsBespoke(vars.bespoke);
      if (!vars.bespoke) setBespokeCustomerId("none");
      qc.invalidateQueries({ queryKey: getListProductsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetProductQueryKey(productId) });
      toast({ title: vars.bespoke ? "Marked as bespoke" : "Bespoke flag removed" });
    },
    onError: () => toast({ title: "Could not update product", variant: "destructive" }),
  });

  const generateMatrixMut = useMutation({
    mutationFn: () => apiFetch(`/products/${productId}/variants/generate-matrix`, { method: "POST" }),
    onSuccess: (data: any) => {
      refetchVariants();
      setGenerateMatrixOpen(false);
      toast({ title: `Generated ${data.created} variant${data.created !== 1 ? "s" : ""}${data.deleted > 0 ? `, removed ${data.deleted} colour-only row${data.deleted !== 1 ? "s" : ""}` : ""}` });
    },
    onError: (err: any) => toast({ title: err.message || "Failed to generate variants", variant: "destructive" }),
  });

  const bulkUpdateMut = useMutation({
    mutationFn: ({ ids, supplierId, code, price }: { ids: number[]; supplierId: string; code: string; price: string }) =>
      apiFetch(`/products/${productId}/variants/bulk`, {
        method: "PATCH",
        body: JSON.stringify({
          ids,
          // Only send primarySupplierId when the user has explicitly selected a supplier.
          // Sending null when "none" is selected would silently wipe any variant-specific
          // supplier assignments that were set individually — which was the source of the
          // recurring "items back under default supplier" bug.
          ...(supplierId !== "none" ? { primarySupplierId: Number(supplierId) } : {}),
          ...(price !== "" ? { supplierPrice: parseFloat(price) } : {}),
          ...(code !== "" ? { supplierCode: code } : {}),
        }),
      }),
    onSuccess: (_data: any, { ids }) => {
      refetchVariants();
      toast({ title: `Updated ${ids.length} variant${ids.length !== 1 ? "s" : ""}` });
    },
    onError: () => toast({ title: "Bulk update failed", variant: "destructive" }),
  });

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: number[]) =>
      apiFetch(`/products/${productId}/variants/bulk`, {
        method: "DELETE",
        body: JSON.stringify({ ids }),
      }),
    onSuccess: (_data: any, ids) => {
      refetchVariants();
      toast({ title: `Deleted ${ids.length} variant${ids.length !== 1 ? "s" : ""}` });
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  // ── Must be computed before any early returns (React Rules of Hooks) ──────
  // Group variants — colour-first (preserving API order), then size within each group.
  // Wrapped in useMemo so the array reference is stable, preventing useEffect dep loops.
  const sortedVariants = useMemo(() => {
    const colourOrder = [...new Set(variants.map((v: any) => v.colour ?? ""))];
    return [...variants].sort((a: any, b: any) => {
      const ca = a.colour ?? "", cb = b.colour ?? "";
      const ci = colourOrder.indexOf(ca) - colourOrder.indexOf(cb);
      if (ci !== 0) return ci;
      const sa = a.size ?? "", sb = b.size ?? "";
      const ia = sizeOrder.length ? sizeOrder.findIndex((o: string) => o.toLowerCase() === sa.toLowerCase()) : -1;
      const ib = sizeOrder.length ? sizeOrder.findIndex((o: string) => o.toLowerCase() === sb.toLowerCase()) : -1;
      const ra = ia !== -1 ? ia : 10000 + sizeRank(sa);
      const rb = ib !== -1 ? ib : 10000 + sizeRank(sb);
      return ra - rb || sa.localeCompare(sb);
    });
  }, [variants, sizeOrder]);
  const colours = [...new Set(variants.map((v: any) => v.colour ?? ""))].filter(Boolean);
  const sizes = [...new Set(sortedVariants.map((v: any) => v.size).filter(Boolean))];
  const sleeves = [...new Set(sortedVariants.map((v: any) => v.sleeve).filter(Boolean))];

  const filteredVariants = sortedVariants.filter((v: any) => {
    if (filterColour !== "all" && v.colour !== filterColour) return false;
    if (filterSize !== "all" && v.size !== filterSize) return false;
    if (filterSleeve !== "all" && v.sleeve !== filterSleeve) return false;
    if (filterSearch) {
      const q = filterSearch.toLowerCase();
      const matchSku = (v.sku ?? "").toLowerCase().includes(q);
      const matchCode = (v.supplierCode ?? "").toLowerCase().includes(q);
      const matchColour = (v.colour ?? "").toLowerCase().includes(q);
      if (!matchSku && !matchCode && !matchColour) return false;
    }
    return true;
  });

  // Auto-populate the bulk strip with shared current values when the filter changes
  useEffect(() => {
    if (filteredVariants.length === 0) return;
    const allSupplierId = filteredVariants.every((v: any) => v.primarySupplierId === filteredVariants[0].primarySupplierId);
    const allCode = filteredVariants.every((v: any) => (v.supplierCode ?? "") === (filteredVariants[0].supplierCode ?? ""));
    const allPrice = filteredVariants.every((v: any) => (v.supplierPrice ?? "") === (filteredVariants[0].supplierPrice ?? ""));
    setBulkPrimaryId(allSupplierId && filteredVariants[0].primarySupplierId ? String(filteredVariants[0].primarySupplierId) : "none");
    setBulkCode(allCode ? (filteredVariants[0].supplierCode ?? "") : "");
    setBulkPrice(allPrice && filteredVariants[0].supplierPrice != null ? String(filteredVariants[0].supplierPrice) : "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterColour, filterSize, filterSleeve, variants]);

  // ── Combination pricing (colour + sleeve groups) ──────────────────────────
  type ComboDraft = { supplierId: string; code: string; price: string };

  const comboPricingGroups = useMemo(() => {
    if (sortedVariants.length === 0) return [];
    const seen = new Set<string>();
    const groups: {
      key: string; colour: string | null; sleeve: string | null;
      variantIds: number[]; sharedSupplierId: string; sharedCode: string; sharedPrice: string;
    }[] = [];
    for (const v of sortedVariants) {
      const colour = v.colour ?? "";
      const sleeve = v.sleeve ?? "";
      const key = `${colour}||${sleeve}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const members = sortedVariants.filter((v2: any) => (v2.colour ?? "") === colour && (v2.sleeve ?? "") === sleeve);
      const suppIds = [...new Set(members.map((v2: any) => v2.primarySupplierId ? String(v2.primarySupplierId) : "none"))];
      const codes = [...new Set(members.map((v2: any) => v2.supplierCode ?? ""))];
      const rawPrices = members.map((v2: any) => v2.supplierPrice != null ? String(parseFloat(String(v2.supplierPrice))) : "");
      const prices = [...new Set(rawPrices)];
      groups.push({
        key, colour: v.colour, sleeve: v.sleeve,
        variantIds: members.map((v2: any) => v2.id),
        sharedSupplierId: suppIds.length === 1 ? suppIds[0] : "none",
        sharedCode: codes.length === 1 ? codes[0] : "",
        sharedPrice: prices.length === 1 ? prices[0] : "",
      });
    }
    return groups;
  }, [sortedVariants]);

  const [comboDrafts, setComboDrafts] = useState<Record<string, ComboDraft>>({});

  useEffect(() => {
    setComboDrafts(() => {
      const next: Record<string, ComboDraft> = {};
      for (const g of comboPricingGroups) {
        next[g.key] = { supplierId: g.sharedSupplierId, code: g.sharedCode, price: g.sharedPrice };
      }
      return next;
    });
  }, [comboPricingGroups]);

  if (isLoading || !details || !guidance) {
    return <Layout><div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div></Layout>;
  }
  if (!product) {
    return <Layout><div className="text-center py-20"><p className="text-muted-foreground">Product not found.</p><Button variant="outline" className="mt-4" onClick={() => navigate("/products")}>Back</Button></div></Layout>;
  }

  const totalStock = variants.reduce((sum: number, v: any) => sum + (v.stockQuantity || 0), 0);
  const lowStockCount = variants.filter((v: any) => v.stockQuantity <= 5).length;
  const defaultPrimaryId = details.supplierId !== "none" ? Number(details.supplierId) : null;
  const defaultSecondaryId = details.secondarySupplierId !== "none" ? Number(details.secondarySupplierId) : null;

  // Attributes-based colour+size+sleeve lists (for matrix generation)
  const attrColours = (attributes as any[]).filter(a => a.type === "colour").map(a => a.value as string);
  const attrSizes = (attributes as any[]).filter(a => a.type === "size").map(a => a.value as string);
  const attrSleeves = (attributes as any[]).filter(a => a.type === "sleeve").map(a => a.value as string);
  const canGenerateMatrix = attrSizes.length > 0;
  const matrixVariantCount = (attrColours.length || 1) * attrSizes.length * (attrSleeves.length || 1);

  return (
    <TooltipProvider>
      <Layout>
        <div className="flex flex-col space-y-6">
          {/* ── Header ── */}
          <div className="flex items-start gap-4">
            <Button variant="ghost" size="icon" className="mt-1 shrink-0" onClick={() => navigate("/products")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <button
              type="button"
              title="Click to upload product image"
              onClick={() => productImageRef.current?.click()}
              disabled={isProductImageUploading}
              className="group relative w-16 h-16 rounded-lg border border-border/50 overflow-hidden flex-shrink-0 hover:border-primary/50 transition-colors disabled:opacity-60"
            >
              {(product as any).imageUrl ? (
                <UploadedImage src={(product as any).imageUrl} alt={product.name} className="w-full h-full object-cover" fallback={<div className="w-full h-full bg-muted flex items-center justify-center"><Package className="w-7 h-7 text-muted-foreground/40" /></div>} />
              ) : (
                <div className="w-full h-full bg-muted flex items-center justify-center">
                  <Package className="w-7 h-7 text-muted-foreground/40" />
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                {isProductImageUploading ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Camera className="w-4 h-4 text-white" />}
              </div>
            </button>
            <input ref={productImageRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadProductImage(f); e.target.value = ""; }}
            />
            {/* Hidden input shared by all colour-group image buttons */}
            <input ref={groupImageInputRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadGroupImage(f); e.target.value = ""; }}
            />
            <div className="flex-1 min-w-0 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">{product.name}</h1>
                  {product.sku && <span className="font-mono text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded">{product.sku}</span>}
                  {isService && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                      <Wrench className="w-3 h-3" /> Service
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground text-base">{formatCurrency(product.unitPrice)}</span>
                  {variants.length > 0 && (
                    <>
                      <span>{totalStock} units in stock</span>
                      {lowStockCount > 0 && (
                        <span className="text-amber-600 font-medium flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5" /> {lowStockCount} variant{lowStockCount > 1 ? "s" : ""} low stock
                        </span>
                      )}
                    </>
                  )}
                </div>
                <Link data-testid="link-product-bom" href={`/products/${productId}/bom`} className="inline-flex items-center gap-2 mt-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/10">
                  <Layers className="h-4 w-4" /> Bill of materials / production operations
                </Link>
              </div>
              {/* Internal GP% badge — only shown when supplier cost is known */}
              {product.unitPrice > 0 && (() => {
                // Collect all supplier prices: per-variant if set, else product-level fallback
                const variantPrices: number[] = variants
                  .map((v: any) => v.supplierPrice != null ? parseFloat(v.supplierPrice) : null)
                  .filter((p): p is number => p != null && p > 0);
                const productFallback = product.supplierPrice != null && parseFloat(String(product.supplierPrice)) > 0
                  ? parseFloat(String(product.supplierPrice))
                  : null;
                const costs = variantPrices.length > 0 ? variantPrices : (productFallback ? [productFallback] : []);
                if (costs.length === 0) return null;
                const unitPrice = product.unitPrice;
                const gps = costs.map(c => ((unitPrice - c) / unitPrice) * 100);
                const minGp = Math.min(...gps);
                const maxGp = Math.max(...gps);
                const isRange = Math.abs(maxGp - minGp) > 0.05;
                const displayGp = isRange ? maxGp : minGp; // use max for colouring when range
                const color = displayGp >= 70 ? "bg-green-50 text-green-700 border-green-200"
                            : displayGp >= 30 ? "bg-amber-50 text-amber-700 border-amber-200"
                            : "bg-red-50 text-red-700 border-red-200";
                return (
                  <div className={`flex-shrink-0 flex flex-col items-center rounded-lg border px-4 py-2 ${color}`}>
                    <span className="text-xs font-medium uppercase tracking-wide opacity-70">GP</span>
                    {isRange ? (
                      <span className="text-xl font-bold leading-none whitespace-nowrap">
                        {minGp.toFixed(0)}%–{maxGp.toFixed(0)}%
                      </span>
                    ) : (
                      <span className="text-2xl font-bold leading-none">{minGp.toFixed(0)}%</span>
                    )}
                    <span className="text-xs mt-0.5 opacity-60">
                      {isRange ? `${costs.length} variant costs` : `cost ${formatCurrency(costs[0])}`}
                    </span>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ── Tabs ── */}
          <Tabs defaultValue="details">
            <TabsList className="w-full justify-start bg-muted/50 p-1">
              <TabsTrigger value="details" className="flex items-center gap-1.5"><Package className="w-3.5 h-3.5" /> Details</TabsTrigger>
              {!isService && (
                <TabsTrigger value="variants" className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" /> Variants
                  {variants.length > 0 && (
                    <span className="ml-1 bg-primary/10 text-primary text-xs font-medium px-1.5 py-0.5 rounded-full">{variants.length}</span>
                  )}
                </TabsTrigger>
              )}
              <TabsTrigger value="guidance" className="flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5" /> Guidance
              </TabsTrigger>
              <TabsTrigger value="social" className="flex items-center gap-1.5">
                <Share2 className="w-3.5 h-3.5" /> Social Post
                {(socialPostsQuery.data?.some((p: any) => p.new_activity)) ? (
                  <span className="ml-1 bg-red-100 text-red-700 text-xs font-semibold px-1.5 py-0.5 rounded-full animate-pulse">!</span>
                ) : (socialPostsQuery.data?.filter((p: any) => p.status === "scheduled").length ?? 0) > 0 && (
                  <span className="ml-1 bg-amber-100 text-amber-700 text-xs font-medium px-1.5 py-0.5 rounded-full">
                    {socialPostsQuery.data!.filter((p: any) => p.status === "scheduled").length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="imagegen" className="flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5" /> Image Gen
              </TabsTrigger>
            </TabsList>

            {/* ── Details ── */}
            <TabsContent value="details">
              <div
                className="mt-4 bg-card border border-border/50 rounded-lg p-6 shadow-sm"
                onKeyDown={e => {
                  if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA" && detailsDirty && !updateMutation.isPending) {
                    e.preventDefault();
                    saveDetails();
                  }
                }}
              >
                <div className="flex items-center justify-between mb-5">
                  <p className="text-sm text-muted-foreground">Product details</p>
                  <Button size="sm" onClick={saveDetails} disabled={updateMutation.isPending || !detailsDirty} className="gap-1.5">
                    <Save className="w-3.5 h-3.5" />
                    {updateMutation.isPending ? "Saving…" : "Save Changes"}
                  </Button>
                </div>
                <div className="grid gap-5 max-w-2xl">
                  <div className="grid gap-2">
                    <Label>Product Name *</Label>
                    <Input value={details.name} onChange={e => handleDetailChange("name", e.target.value)} />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="grid gap-2">
                      <Label>SKU</Label>
                      <Input value={details.sku} onChange={e => handleDetailChange("sku", e.target.value)} placeholder="e.g. POLO-001" />
                    </div>
                    <div className="grid gap-2">
                      <Label>Unit Price (£) *</Label>
                      <Input type="number" min="0" step="1" value={details.unitPrice} onChange={e => handleDetailChange("unitPrice", parseFloat(e.target.value) || 0)} />
                    </div>
                    <div className="grid gap-2">
                      <Label>VAT Rate</Label>
                      <Select value={details.vatRate} onValueChange={v => handleDetailChange("vatRate", v)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0.2">Standard (20%)</SelectItem>
                          <SelectItem value="0.05">Reduced (5%)</SelectItem>
                          <SelectItem value="0">Zero-rated (0%)</SelectItem>
                        </SelectContent>
                      </Select>
                      {parseFloat(details.vatRate) === 0 && (
                        <p className="text-xs text-green-600">Zero-rated — e.g. children's clothing</p>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label>Description</Label>
                    <Textarea rows={3} value={details.description} onChange={e => handleDetailChange("description", e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Categories</Label>
                    <ProductCategoryMultiSelect
                      categories={wooCategories}
                      selectedWooIds={details.wooCategoryIds}
                      onChange={handleCategoryChange}
                    />
                    {details.category && !wooCategories.some(c => c.wooId != null && c.name === details.category) && (
                      <div className="grid gap-1.5">
                        <Label className="text-xs text-muted-foreground">Internal category</Label>
                        <Input
                          value={details.category}
                          onChange={e => handleDetailChange("category", e.target.value)}
                          placeholder="Internal category name"
                        />
                      </div>
                    )}
                    {details.wooCategoryIds.length > 0 && (
                      <p className="text-[11px] text-green-600 flex items-center gap-1">
                        <Cloud className="w-3 h-3" /> Saving will show this product in every selected category
                      </p>
                    )}
                    {details.category === "Bespoke Ties" && (
                      <p className="text-xs text-blue-600">On save, standard variants will be auto-created: <strong>Full Length Tie</strong> ({details.sku ? `${details.sku}-FLT` : "SKU-FLT"}), <strong>Clip-On Tie</strong> ({details.sku ? `${details.sku}-COT` : "SKU-COT"}), <strong>Clip-on Cravat</strong> ({details.sku ? `${details.sku}-COC` : "SKU-COC"}).</p>
                    )}
                  </div>

                  {/* ── Shop publication ── */}
                  {!(product as any).isArchived && !(product as any).isService && !(product as any).isBespoke && (
                    <div className="border-t border-border/40 pt-5 mt-1">
                      <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-3">
                        <Cloud className="w-3.5 h-3.5 text-blue-500" /> Shop publication
                      </h4>
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className={cn(
                          "text-xs font-semibold px-2.5 py-1 rounded-full border",
                          (product as any).websitePublished
                            ? "bg-green-50 text-green-700 border-green-200"
                            : "bg-muted text-muted-foreground border-border"
                        )}>
                          {(product as any).websitePublished ? "● Published" : "● Hidden"}
                        </span>
                        <p className="text-xs text-muted-foreground flex-1">
                          {(product as any).websitePublished
                            ? "Live on shop. This local setting is not changed by WooCommerce sync."
                            : "Hidden from shop. Publish when the product is ready."}
                        </p>
                        <div className="flex gap-2 flex-wrap">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => websitePublicationMut.mutate(!(product as any).websitePublished)}
                            disabled={websitePublicationMut.isPending}
                            className={cn(
                              "h-7 text-xs disabled:opacity-40",
                              (product as any).websitePublished
                                ? "border-amber-300 text-amber-700 hover:bg-amber-50"
                                : "border-green-300 text-green-700 hover:bg-green-50"
                            )}
                          >
                            {websitePublicationMut.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                            {(product as any).websitePublished ? "Remove from website" : "Publish to website"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Service toggle ── */}
                  <div className="border-t border-border/40 pt-5 mt-1">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                          <Wrench className="w-3.5 h-3.5 text-amber-500" /> Service product
                        </h4>
                        <p className="text-xs text-muted-foreground mt-0.5">No stock, no variants, no purchasing. E.g. logo digitising, setup charges.</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isService}
                        onClick={() => toggleServiceMut.mutate(!isService)}
                        disabled={toggleServiceMut.isPending}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isService ? "bg-amber-500" : "bg-muted-foreground/30"}`}
                      >
                        <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform ${isService ? "translate-x-4" : "translate-x-0"}`} />
                      </button>
                    </div>
                  </div>

                  {/* ── Bespoke toggle ── */}
                  <div className="border-t border-border/40 pt-5 mt-1">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-purple-500" /> Bespoke product
                        </h4>
                        <p className="text-xs text-muted-foreground mt-0.5">Exclusive to one customer — only available when ordering for them.</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isBespoke}
                        onClick={() => setBespokeMut.mutate({ bespoke: !isBespoke, customerId: isBespoke ? null : (bespokeCustomerId !== "none" ? Number(bespokeCustomerId) : null) })}
                        disabled={setBespokeMut.isPending}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isBespoke ? "bg-purple-500" : "bg-muted-foreground/30"}`}
                      >
                        <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform ${isBespoke ? "translate-x-4" : "translate-x-0"}`} />
                      </button>
                    </div>
                    {isBespoke && (
                      <div className="mt-3">
                        <Label className="text-xs mb-1.5 block">Assigned customer</Label>
                        <Popover open={bespokePickerOpen} onOpenChange={setBespokePickerOpen}>
                          <PopoverTrigger asChild>
                            <Button variant="outline" role="combobox" className="w-full justify-between font-normal text-sm h-9">
                              <span className="truncate">
                                {bespokeCustomerId !== "none"
                                  ? (customers as any[]).find((c: any) => String(c.id) === bespokeCustomerId)?.name ?? "Unknown customer"
                                  : "— No customer assigned —"}
                              </span>
                              <ChevronsUpDown className="w-3.5 h-3.5 shrink-0 opacity-50 ml-2" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[280px] p-0" align="start">
                            <Command>
                              <CommandInput placeholder="Search customers…" className="h-8 text-sm" />
                              <CommandList className="max-h-56">
                                <CommandEmpty>No customers found.</CommandEmpty>
                                <CommandGroup>
                                  <CommandItem value="none" onSelect={() => { setBespokeCustomerId("none"); setBespokePickerOpen(false); setBespokeMut.mutate({ bespoke: true, customerId: null }); }}>
                                    <Check className={`mr-2 w-3.5 h-3.5 ${bespokeCustomerId === "none" ? "opacity-100" : "opacity-0"}`} />
                                    — No customer assigned —
                                  </CommandItem>
                                  {(customers as any[]).map((c: any) => (
                                    <CommandItem key={c.id} value={c.name} onSelect={() => {
                                      setBespokeCustomerId(String(c.id));
                                      setBespokePickerOpen(false);
                                      setBespokeMut.mutate({ bespoke: true, customerId: c.id });
                                    }}>
                                      <Check className={`mr-2 w-3.5 h-3.5 ${String(c.id) === bespokeCustomerId ? "opacity-100" : "opacity-0"}`} />
                                      {c.name}
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                        {bespokeCustomerId === "none" && (
                          <p className="text-xs text-amber-600 mt-1.5">Assign a customer so this product appears in their orders.</p>
                        )}
                      </div>
                    )}
                  </div>

                  {!isService && (
                  <div className="border-t border-border/40 pt-5 mt-1">
                    <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Preferred Supplier</h4>
                    <div className="grid gap-2 mb-4">
                      <Label>Supplier</Label>
                      <SupplierSelect value={details.supplierId} onChange={handleSupplierChange} suppliers={suppliers} />
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="grid gap-2">
                        <Label>Supplier Code</Label>
                        <Input value={details.supplierCode} onChange={e => handleDetailChange("supplierCode", e.target.value)} placeholder="Supplier's code" />
                      </div>
                      <div className="grid gap-2">
                        <Label>Supplier Cost</Label>
                        <div className="flex gap-1.5 items-center">
                          <span className="h-9 flex items-center px-2.5 rounded-md border border-input bg-muted/50 text-sm font-medium text-muted-foreground shrink-0 select-none">
                            {details.supplierCurrency === "USD" ? "$" : details.supplierCurrency === "EUR" ? "€" : "£"}
                          </span>
                          <Input type="number" min="0" step="0.01" value={details.supplierPrice} onChange={e => handleDetailChange("supplierPrice", e.target.value)} placeholder="0.00" />
                        </div>
                        {details.supplierCurrency !== "GBP" && (
                          <p className="text-[11px] text-amber-600">Purchased in {details.supplierCurrency} — convert to £ for reporting</p>
                        )}
                      </div>
                      <div className="grid gap-2">
                        <Label>Min. Order Qty</Label>
                        <Input type="number" min="1" step="1" value={details.minOrderQty} onChange={e => handleDetailChange("minOrderQty", e.target.value)} placeholder="e.g. 25" />
                      </div>
                    </div>

                    {/* Secondary supplier — collapsed by default */}
                    <button
                      type="button"
                      className="mt-5 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors select-none"
                      onClick={() => setShowSecondarySupplier(v => !v)}
                    >
                      <span className={`transition-transform duration-150 ${showSecondarySupplier ? "rotate-90" : ""}`}>▶</span>
                      {showSecondarySupplier ? "Hide" : "Show"} backup supplier
                    </button>

                    {showSecondarySupplier && (
                      <div className="mt-3 pl-4 border-l-2 border-border/40 space-y-4">
                        <div className="grid gap-2">
                          <Label>Backup Supplier</Label>
                          <SupplierSelect value={details.secondarySupplierId} onChange={v => handleDetailChange("secondarySupplierId", v)} suppliers={suppliers} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="grid gap-2">
                            <Label>Backup Supplier Code</Label>
                            <Input value={details.secondarySupplierCode} onChange={e => handleDetailChange("secondarySupplierCode", e.target.value)} placeholder="e.g. RL204" />
                          </div>
                          <div className="grid gap-2">
                            <Label>Backup Price (£)</Label>
                            <Input type="number" min="0" step="0.01" value={details.secondarySupplierPrice} onChange={e => handleDetailChange("secondarySupplierPrice", e.target.value)} placeholder="0.00" />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  )}

                  {/* ── Price Breaks ── */}
                  <div className="border-t border-border/40 pt-5 mt-1">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Quantity Price Breaks</h4>
                        <p className="text-xs text-muted-foreground mt-0.5">Set the price per item when a minimum quantity is reached</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const newIdx = details.priceBreaks.length;
                          handleDetailChange("priceBreaks", [...details.priceBreaks, { qty: 0, price: 0 }]);
                          setPriceBreakModes(m => ({ ...m, [newIdx]: "disc" }));
                        }}
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" /> Add Tier
                      </Button>
                    </div>

                    {details.priceBreaks.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic">No price breaks set — a fixed unit price applies.</p>
                    ) : (
                      <div className="rounded-md border border-border/50 overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Min. Qty</th>
                              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Input type</th>
                              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Value</th>
                              <th className="text-left px-3 py-2 font-medium text-muted-foreground text-nowrap">Sell price</th>
                              <th className="text-right px-3 py-2 font-medium text-muted-foreground">GP%</th>
                              <th className="w-10 px-2 py-2" />
                            </tr>
                          </thead>
                          <tbody>
                            {[...details.priceBreaks]
                              .map((pb, origIdx) => ({ pb, origIdx }))
                              .sort((a, b) => a.pb.qty - b.pb.qty)
                              .map(({ pb, origIdx }) => {
                                const mode = priceBreakModes[origIdx] ?? "price";
                                const cost = details.supplierPrice ?? 0;
                                const unitPrice = details.unitPrice;
                                const sellPrice = pb.price;
                                const gp = sellPrice > 0 && cost > 0
                                  ? ((sellPrice - cost) / sellPrice) * 100
                                  : null;
                                const modeBtn = (m: "price" | "pct" | "disc", label: string) => (
                                  <button
                                    type="button"
                                    onClick={() => setPriceBreakModes(prev => ({ ...prev, [origIdx]: m }))}
                                    className={cn(
                                      "px-2 py-0.5 text-xs rounded transition-colors",
                                      mode === m
                                        ? "bg-primary text-primary-foreground font-semibold"
                                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                                    )}
                                  >{label}</button>
                                );
                                return (
                                  <tr key={origIdx} className="border-t border-border/30 hover:bg-muted/20">
                                    <td className="px-3 py-2">
                                      <Input
                                        type="number"
                                        min="1"
                                        step="1"
                                        className="h-7 w-20 text-sm"
                                        value={pb.qty || ""}
                                        onChange={e => {
                                          const updated = [...details.priceBreaks];
                                          updated[origIdx] = { ...pb, qty: parseInt(e.target.value, 10) || 0 };
                                          handleDetailChange("priceBreaks", updated);
                                        }}
                                      />
                                    </td>
                                    <td className="px-3 py-2">
                                      <div className="flex gap-1">
                                        {modeBtn("price", "£ price")}
                                        {modeBtn("pct", "% off")}
                                        {modeBtn("disc", "£ off")}
                                      </div>
                                    </td>
                                    <td className="px-3 py-2">
                                      {mode === "price" && (
                                        <div className="flex items-center gap-1">
                                          <span className="text-muted-foreground text-sm">£</span>
                                          <Input
                                            type="number" min="0" step="0.01"
                                            className="h-7 w-24 text-sm"
                                            value={sellPrice > 0 ? sellPrice : ""}
                                            placeholder="0.00"
                                            onFocus={e => e.target.select()}
                                            onChange={e => {
                                              const updated = [...details.priceBreaks];
                                              updated[origIdx] = { ...pb, price: parseFloat(parseFloat(e.target.value || "0").toFixed(2)) };
                                              handleDetailChange("priceBreaks", updated);
                                            }}
                                          />
                                        </div>
                                      )}
                                      {mode === "pct" && (
                                        <div className="flex items-center gap-1">
                                          <Input
                                            type="number" min="0" max="100" step="0.1"
                                            className="h-7 w-20 text-sm"
                                            value={unitPrice > 0 && sellPrice > 0 ? parseFloat(((1 - sellPrice / unitPrice) * 100).toFixed(2)) : ""}
                                            placeholder="0.0"
                                            onFocus={e => e.target.select()}
                                            onChange={e => {
                                              const pct = parseFloat(e.target.value) || 0;
                                              const updated = [...details.priceBreaks];
                                              updated[origIdx] = { ...pb, price: parseFloat((unitPrice * (1 - pct / 100)).toFixed(2)) };
                                              handleDetailChange("priceBreaks", updated);
                                            }}
                                          />
                                          <span className="text-muted-foreground text-sm">%</span>
                                        </div>
                                      )}
                                      {mode === "disc" && (
                                        <div className="flex items-center gap-1">
                                          <span className="text-muted-foreground text-sm">£</span>
                                          <Input
                                            type="number" min="0" step="0.01"
                                            className="h-7 w-24 text-sm"
                                            value={unitPrice > 0 && sellPrice > 0 ? parseFloat((unitPrice - sellPrice).toFixed(2)) : ""}
                                            placeholder="0.00"
                                            onFocus={e => e.target.select()}
                                            onChange={e => {
                                              const disc = parseFloat(e.target.value) || 0;
                                              const updated = [...details.priceBreaks];
                                              updated[origIdx] = { ...pb, price: parseFloat((unitPrice - disc).toFixed(2)) };
                                              handleDetailChange("priceBreaks", updated);
                                            }}
                                          />
                                          <span className="text-xs text-muted-foreground">off</span>
                                        </div>
                                      )}
                                    </td>
                                    <td className="px-3 py-2">
                                      <span className={cn("text-sm font-semibold tabular-nums", sellPrice > 0 ? "text-foreground" : "text-muted-foreground/40")}>
                                        {sellPrice > 0 ? `£${sellPrice.toFixed(2)}` : "—"}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      {gp != null ? (
                                        <span className={cn(
                                          "text-xs font-semibold px-1.5 py-0.5 rounded tabular-nums",
                                          gp >= 80 ? "bg-green-50 text-green-700" :
                                          gp >= 50 ? "bg-amber-50 text-amber-700" :
                                          "bg-red-50 text-red-600"
                                        )}>{gp.toFixed(1)}%</span>
                                      ) : <span className="text-xs text-muted-foreground/40">—</span>}
                                    </td>
                                    <td className="px-2 py-2">
                                      <button
                                        type="button"
                                        className="text-muted-foreground hover:text-destructive transition-colors"
                                        onClick={() => {
                                          const updated = details.priceBreaks.filter((_, i) => i !== origIdx);
                                          handleDetailChange("priceBreaks", updated);
                                          setPriceBreakModes(m => {
                                            const next: Record<number, "price" | "pct" | "disc"> = {};
                                            Object.entries(m).forEach(([k, v]) => {
                                              const ki = parseInt(k);
                                              if (ki < origIdx) next[ki] = v;
                                              else if (ki > origIdx) next[ki - 1] = v;
                                            });
                                            return next;
                                          });
                                        }}
                                      >
                                        <X className="w-4 h-4" />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end">
                    <Button onClick={saveDetails} disabled={updateMutation.isPending || !detailsDirty}>
                      <Save className="w-4 h-4 mr-2" />
                      {updateMutation.isPending ? "Saving…" : "Save Changes"}
                    </Button>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* ── Variants ── */}
            <TabsContent value="variants">
              <div className="mt-4 space-y-4">
                {/* Colour + Size + Sleeve palette editors */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-card border border-border/50 rounded-lg p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <Palette className="w-4 h-4 text-pink-500" />
                      <h3 className="font-semibold text-foreground">Available Colours</h3>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">Define the colour palette for this product. Use when adding variants.</p>
                    <TagInput type="colour" productId={productId} attributes={attributes} onRefresh={refetchAttrs} />
                  </div>
                  <div className="bg-card border border-border/50 rounded-lg p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <Ruler className="w-4 h-4 text-blue-500" />
                      <h3 className="font-semibold text-foreground">Available Sizes</h3>
                      {product?.category === "Bespoke Ties" && (
                        <span className="ml-auto text-[11px] font-medium bg-indigo-100 text-indigo-700 border border-indigo-200 rounded px-2 py-0.5">
                          Standard sizes auto-assigned
                        </span>
                      )}
                    </div>
                    {product?.category === "Bespoke Ties" && (
                      <p className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded p-2 mb-3">
                        Bespoke Ties automatically include: <strong>Full Length Tie</strong>, <strong>Clip-On Tie</strong>, and <strong>Clip-on Cravat</strong>.
                      </p>
                    )}
                    {product?.category !== "Bespoke Ties" && (
                      <p className="text-xs text-muted-foreground mb-3">Define the size range for this product. Use when adding variants.</p>
                    )}
                    <TagInput type="size" productId={productId} attributes={attributes} onRefresh={refetchAttrs} />
                  </div>
                  <div className="bg-card border border-border/50 rounded-lg p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <Layers className="w-4 h-4 text-amber-500" />
                      <h3 className="font-semibold text-foreground">Fit / Length</h3>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">Optional third dimension — e.g. <strong>Short / Regular / Long</strong> for body length, or <strong>Long Sleeve / Short Sleeve</strong> for sleeve type.</p>
                    <TagInput type="sleeve" productId={productId} attributes={attributes} onRefresh={refetchAttrs} />
                  </div>
                </div>

                {/* ── Variants (merged: group bulk-supplier + individual rows) ── */}
                <div className="bg-card border border-border/50 rounded-lg shadow-sm">
                  {/* Header */}
                  <div className="flex items-center justify-between p-4 border-b border-border/40">
                    <div>
                      <h3 className="font-semibold text-foreground">Variants</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {comboPricingGroups.length > 1
                          ? "Use the group rows to set a supplier for all sizes at once, or edit individual rows below."
                          : "Each row is a specific colour / fit / size combo with its own stock level and suppliers."}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {canGenerateMatrix && (
                        <Button size="sm" variant="outline" onClick={() => setGenerateMatrixOpen(true)}>
                          <Layers className="w-4 h-4 mr-1.5" /> Generate all variants
                        </Button>
                      )}
                      <Button size="sm" onClick={() => setAddVariantOpen(true)}>
                        <Plus className="w-4 h-4 mr-1.5" /> Add Variant
                      </Button>
                    </div>
                  </div>

                  {/* Filter bar */}
                  {variants.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 bg-muted/30 border-b border-border/40">
                      {colours.length > 1 && (
                        <Select value={filterColour} onValueChange={setFilterColour}>
                          <SelectTrigger className="h-8 w-[140px] text-xs">
                            <SelectValue placeholder="All colours" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All colours</SelectItem>
                            {colours.map((c: string) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                      {sleeves.length > 1 && (
                        <Select value={filterSleeve} onValueChange={setFilterSleeve}>
                          <SelectTrigger className="h-8 w-[130px] text-xs">
                            <SelectValue placeholder="All fits" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All fits</SelectItem>
                            {sleeves.map((s: string) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                      {sizes.length > 1 && (
                        <Select value={filterSize} onValueChange={setFilterSize}>
                          <SelectTrigger className="h-8 w-[120px] text-xs">
                            <SelectValue placeholder="All sizes" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All sizes</SelectItem>
                            {sizes.map((s: string) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                      <div className="relative flex items-center ml-auto">
                        <Search className="absolute left-2.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                        <Input
                          value={filterSearch}
                          onChange={e => setFilterSearch(e.target.value)}
                          placeholder="Search SKU or code…"
                          className="h-8 text-xs w-[170px] pl-8"
                        />
                      </div>
                      {(filterColour !== "all" || filterSize !== "all" || filterSleeve !== "all" || filterSearch !== "") && (
                        <button
                          className="text-xs text-muted-foreground hover:text-foreground underline"
                          onClick={() => { setFilterColour("all"); setFilterSize("all"); setFilterSleeve("all"); setFilterSearch(""); }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  )}

                  {variants.length === 0 ? (
                    <div className="py-12 text-center text-muted-foreground">
                      <Layers className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p className="font-medium text-foreground">No variants yet</p>
                      <p className="text-sm mt-1">Generate every size and fit combination, or add an individual variant manually.</p>
                      <div className="mt-4 flex items-center justify-center gap-2">
                        {canGenerateMatrix && (
                          <Button size="sm" onClick={() => setGenerateMatrixOpen(true)}>
                            <Layers className="w-4 h-4 mr-1.5" /> Generate {matrixVariantCount} variants
                          </Button>
                        )}
                        <Button variant="outline" size="sm" onClick={() => setAddVariantOpen(true)}>Add manually</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="w-[180px]">Colour</TableHead>
                            <TableHead className="w-[130px]">Fit / Length</TableHead>
                            <TableHead className="w-[110px]">Size</TableHead>
                            <TableHead className="w-[110px]">Code</TableHead>
                            <TableHead className="w-[80px]">Cost</TableHead>
                            <TableHead className="w-[100px]">Sale price</TableHead>
                            <TableHead className="w-[90px]">VAT</TableHead>
                            <TableHead className="w-[90px]">Stock</TableHead>
                            <TableHead>Primary Supplier</TableHead>
                            <TableHead>Secondary Supplier</TableHead>
                            <TableHead className="w-[110px]">Status</TableHead>
                            <TableHead className="w-[80px] text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(() => {
                            if (filteredVariants.length === 0) {
                              return (
                                <TableRow>
                                  <TableCell colSpan={12} className="text-center py-8 text-muted-foreground text-sm">
                                    No variants match the selected filters.{" "}
                                    <button className="underline" onClick={() => { setFilterColour("all"); setFilterSize("all"); setFilterSleeve("all"); setFilterSearch(""); }}>Clear filters</button>
                                  </TableCell>
                                </TableRow>
                              );
                            }

                            const showGroups = comboPricingGroups.length > 1;
                            const defSup = (suppliers as any[]).find((s: any) => String(s.id) === details.supplierId);
                            const rows: React.ReactNode[] = [];

                            for (const g of comboPricingGroups) {
                              const groupVariants = filteredVariants.filter((v: any) =>
                                (v.colour ?? "") === (g.colour ?? "") && (v.sleeve ?? "") === (g.sleeve ?? "")
                              );
                              if (groupVariants.length === 0) continue;

                              if (showGroups && groupVariants.length > 1) {
                                const draft: ComboDraft = comboDrafts[g.key] ?? { supplierId: g.sharedSupplierId, code: g.sharedCode, price: g.sharedPrice };
                                const isDirty = draft.supplierId !== g.sharedSupplierId || draft.code !== g.sharedCode || draft.price !== g.sharedPrice;
                                const setDraft = (field: keyof ComboDraft, val: string) =>
                                  setComboDrafts(prev => ({ ...prev, [g.key]: { ...draft, [field]: val } }));
                                const canApply = draft.supplierId !== "none" || draft.code !== "" || draft.price !== "";
                                const bulkSup = (suppliers as any[]).find((s: any) => String(s.id) === draft.supplierId);
                                const currSym = bulkSup?.currency === "USD" ? "$" : bulkSup?.currency === "EUR" ? "€" : "£";

                                rows.push(
                                  <TableRow key={`gh-${g.key}`} className={`border-t-2 border-border/40 ${isDirty ? "bg-primary/5" : "bg-muted/25"}`}>
                                    <TableCell colSpan={12} className="py-2 px-4">
                                      <div className="flex items-center gap-3 flex-wrap">
                                        <div className="flex items-center gap-1.5 shrink-0">
                                          {g.colour && (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-pink-100 text-pink-800 border border-pink-200">{g.colour}</span>
                                          )}
                                          {g.sleeve && (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">{g.sleeve}</span>
                                          )}
                                          <span className="text-xs text-muted-foreground">{groupVariants.length} size{groupVariants.length !== 1 ? "s" : ""}</span>
                                        </div>
                                        <span className="text-xs text-muted-foreground shrink-0">→ Set supplier for all:</span>
                                        <SupplierSelect
                                          value={draft.supplierId}
                                          onChange={v => setDraft("supplierId", v)}
                                          suppliers={suppliers}
                                          className="h-7 text-xs w-[150px]"
                                        />
                                        <Input
                                          value={draft.code}
                                          onChange={e => setDraft("code", e.target.value)}
                                          placeholder={details.supplierCode || "Code"}
                                          className="h-7 text-xs w-[110px]"
                                        />
                                        <div className="relative flex items-center">
                                          <span className="absolute left-2 text-muted-foreground text-xs pointer-events-none">{currSym}</span>
                                          <Input
                                            type="number" min="0" step="0.01"
                                            value={draft.price}
                                            onChange={e => setDraft("price", e.target.value)}
                                            placeholder="0.00"
                                            className="h-7 text-xs w-24 pl-4"
                                          />
                                        </div>
                                        {/* Colour image — applies to all sizes in this group */}
                                        {(() => {
                                          const firstVariant = groupVariants[0] as any;
                                          const groupImg = firstVariant?.imageUrl ?? null;
                                          const isUploading = isGroupImageUploading && uploadingGroupKey === g.key;
                                          return (
                                            <button
                                              type="button"
                                              title="Upload image for all sizes in this colour"
                                              className="group relative h-7 w-7 rounded border border-input bg-background overflow-hidden hover:border-primary/50 transition-colors flex items-center justify-center shrink-0"
                                              onClick={() => { setUploadingGroupKey(g.key); groupImageInputRef.current?.click(); }}
                                              disabled={isGroupImageUploading}
                                            >
                                              {groupImg ? (
                                                <img src={groupImg} alt="" className="w-full h-full object-cover" />
                                              ) : (
                                                <Camera className="w-3 h-3 text-muted-foreground" />
                                              )}
                                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                {isUploading ? <Loader2 className="w-3 h-3 text-white animate-spin" /> : <Camera className="w-3 h-3 text-white" />}
                                              </div>
                                            </button>
                                          );
                                        })()}
                                        <Button
                                          size="sm"
                                          variant={isDirty ? "default" : "outline"}
                                          className="h-7 text-xs gap-1"
                                          disabled={!canApply || bulkUpdateMut.isPending}
                                          onClick={() => bulkUpdateMut.mutate({ ids: g.variantIds, supplierId: draft.supplierId, code: draft.code, price: draft.price })}
                                        >
                                          {bulkUpdateMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                          Apply
                                        </Button>
                                        {draft.supplierId === "none" && defSup && (
                                          <span className="text-xs text-muted-foreground italic">
                                            Default: {defSup.name}{details.supplierCode ? ` · ${details.supplierCode}` : ""}
                                          </span>
                                        )}
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-7 text-xs gap-1 text-destructive hover:text-destructive hover:bg-destructive/10 ml-auto shrink-0"
                                          disabled={bulkDeleteMut.isPending}
                                          onClick={() => {
                                            if (confirm(`Delete all ${groupVariants.length} ${g.colour ?? g.sleeve ?? ""} variant${groupVariants.length !== 1 ? "s" : ""}? This cannot be undone.`)) {
                                              bulkDeleteMut.mutate(g.variantIds);
                                            }
                                          }}
                                        >
                                          <Trash2 className="w-3 h-3" />
                                          Delete colour
                                        </Button>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                );
                              }

                              for (const v of groupVariants) {
                                rows.push(
                                  <VariantRow
                                    key={v.id}
                                    variant={v}
                                    suppliers={suppliers}
                                    productId={productId}
                                    onRefresh={() => {
                                      refetchVariants();
                                      refetchAttrs();
                                    }}
                                    onColourImageUpload={handleColourImageUpload}
                                    productSupplierId={defaultPrimaryId}
                                    productSecondaryId={defaultSecondaryId}
                                    productSupplierCode={details.supplierCode}
                                    productSupplierPrice={details.supplierPrice}
                                  />
                                );
                              }
                            }

                            return rows;
                          })()}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>

                {/* Summary badges */}
                {variants.length > 0 && (
                  <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                    <span>{variants.length} variant{variants.length !== 1 ? "s" : ""}</span>
                    <span>·</span>
                    <span>{totalStock} total units</span>
                    {colours.length > 0 && <><span>·</span><span>{colours.length} colour{colours.length !== 1 ? "s" : ""}</span></>}
                    {sleeves.length > 0 && <><span>·</span><span>{sleeves.length} fit{sleeves.length !== 1 ? "s" : ""}</span></>}
                    {sizes.length > 0 && <><span>·</span><span>{sizes.length} size{sizes.length !== 1 ? "s" : ""}</span></>}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ── Guidance ── */}
            <TabsContent value="guidance">
              <div className="mt-4 bg-card border border-border/50 rounded-lg p-6 shadow-sm">
                <div className="grid gap-6 max-w-2xl">

                  {/* Ratings */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Ratings (click to set, click again to clear)</p>
                    <div className="grid grid-cols-3 gap-6">
                      {([
                        { label: "Value for Money", field: "valueRating", value: guidance.valueRating },
                        { label: "Durability",       field: "durabilityRating", value: guidance.durabilityRating },
                        { label: "Technical Features", field: "smartRating", value: guidance.smartRating },
                      ] as { label: string; field: string; value: number | null }[]).map(({ label, field, value }) => (
                        <div key={field} className="grid gap-2">
                          <Label>{label}</Label>
                          <div className="flex gap-1">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                type="button"
                                onClick={() => handleGuidanceChange(field, value === n ? null : n)}
                                className="p-0.5 hover:scale-110 transition-transform"
                              >
                                <Star className={`w-6 h-6 ${n <= (value ?? 0) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`} />
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="grid gap-2">
                    <Label>Badges <span className="text-muted-foreground font-normal">(select any that apply)</span></Label>
                    <div className="flex flex-wrap gap-2">
                      {(["Most Popular", "Best Value", "Premium Choice", "Staff Pick", "Bulk Buy Discount", "New Arrival", "Best Seller", "Eco Friendly", "Award Winner", "Exclusive", "Sale"] as string[]).map((b) => {
                        const active = guidance.badges.includes(b);
                        return (
                          <button
                            key={b}
                            type="button"
                            onClick={() => {
                              const next = active
                                ? guidance.badges.filter((x) => x !== b)
                                : [...guidance.badges, b];
                              handleGuidanceChange("badges", next);
                            }}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors flex items-center gap-1 ${
                              active
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-background text-muted-foreground border-border hover:border-primary/50"
                            }`}
                          >
                            {active && <Check className="w-3 h-3" />}
                            {b}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Tags */}
                  <div className="grid gap-2">
                    <Label>Guidance Tags</Label>
                    <div className="flex flex-wrap gap-2">
                      {(["Everyday Workwear", "Smart Uniform", "Heavy Duty", "Budget Friendly", "Premium", "Corporate", "Hospitality", "Healthcare", "Construction", "Hi-Vis", "Food Service", "Security", "Retail", "Schools", "Sports & Active", "Outdoor", "Waterproof", "Quick Turnaround"] as string[]).map((tag) => {
                        const active = guidance.tags.includes(tag);
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => {
                              const next = active
                                ? guidance.tags.filter((t) => t !== tag)
                                : [...guidance.tags, tag];
                              handleGuidanceChange("tags", next);
                            }}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors flex items-center gap-1 ${
                              active
                                ? "bg-primary/10 text-primary border-primary/40"
                                : "bg-background text-muted-foreground border-border hover:border-primary/30"
                            }`}
                          >
                            {active && <Check className="w-3 h-3" />}
                            {tag}
                          </button>
                        );
                      })}
                      {/* Custom tags added by the user */}
                      {guidance.tags
                        .filter(t => !["Everyday Workwear", "Smart Uniform", "Heavy Duty", "Budget Friendly", "Premium", "Corporate", "Hospitality", "Healthcare", "Construction", "Hi-Vis", "Food Service", "Security", "Retail", "Schools", "Sports & Active", "Outdoor", "Waterproof", "Quick Turnaround"].includes(t))
                        .map(tag => (
                          <span
                            key={tag}
                            className="px-3 py-1.5 rounded-md text-xs font-medium border flex items-center gap-1 bg-primary/10 text-primary border-primary/40"
                          >
                            <Check className="w-3 h-3" />
                            {tag}
                            <button
                              type="button"
                              onClick={() => handleGuidanceChange("tags", guidance.tags.filter(t => t !== tag))}
                              className="ml-0.5 hover:text-destructive transition-colors"
                              title="Remove tag"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                    </div>
                    {/* Add a custom tag */}
                    <form
                      className="flex gap-2 mt-1"
                      onSubmit={e => {
                        e.preventDefault();
                        const val = customTagInput.trim();
                        if (!val || guidance.tags.includes(val)) { setCustomTagInput(""); return; }
                        handleGuidanceChange("tags", [...guidance.tags, val]);
                        setCustomTagInput("");
                      }}
                    >
                      <input
                        type="text"
                        value={customTagInput}
                        onChange={e => setCustomTagInput(e.target.value)}
                        placeholder="Suggest a tag…"
                        maxLength={50}
                        className="flex-1 h-8 rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <button
                        type="submit"
                        disabled={!customTagInput.trim()}
                        className="h-8 px-3 rounded-md border border-input bg-background text-xs font-medium flex items-center gap-1 hover:bg-muted disabled:opacity-40 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add
                      </button>
                    </form>
                  </div>

                  {/* Text fields */}
                  <div className="grid gap-2">
                    <Label>Best For</Label>
                    <Textarea
                      value={guidance.bestFor}
                      onChange={(e) => handleGuidanceChange("bestFor", e.target.value)}
                      placeholder="e.g. Outdoor teams, frequent washers, budget-conscious buyers…"
                      rows={3}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Not Ideal For</Label>
                    <Textarea
                      value={guidance.notIdealFor}
                      onChange={(e) => handleGuidanceChange("notIdealFor", e.target.value)}
                      placeholder="e.g. Office environments, formal wear…"
                      rows={3}
                    />
                  </div>
                  {/* Staff Quotes */}
                  <div className="grid gap-3">
                    <div className="flex items-center justify-between">
                      <Label>Staff Quotes</Label>
                      <button
                        type="button"
                        onClick={() => setManageStaffOpen(true)}
                        className="text-xs text-muted-foreground hover:text-primary transition-colors"
                      >
                        Manage Staff
                      </button>
                    </div>

                    {guidance.staffQuotes.length === 0 ? (
                      <div className="border border-dashed border-border rounded-lg p-4 text-center text-sm text-muted-foreground">
                        No quotes yet — add your first staff recommendation below.
                      </div>
                    ) : (
                      <div className="grid gap-3">
                        {guidance.staffQuotes.map((q) => (
                          <div key={q.id} className="flex flex-col sm:flex-row items-start gap-3 border border-border rounded-lg p-3 bg-muted/20">
                            {/* Top row on mobile: avatar + name/role inline; left column on desktop */}
                            <div className="flex flex-row sm:flex-col items-center gap-3 sm:gap-1 flex-shrink-0 sm:w-24 sm:text-center">
                              <div className="w-14 h-14 sm:w-24 sm:h-24 rounded-full bg-primary/10 overflow-hidden flex items-center justify-center text-xl sm:text-2xl font-bold text-primary flex-shrink-0">
                                {q.staffImageUrl
                                  ? <img src={q.staffImageUrl} alt={q.staffName} className="w-full h-full object-cover object-center" />
                                  : q.staffName.charAt(0).toUpperCase()}
                              </div>
                              <div className="flex flex-col sm:items-center gap-0.5">
                                <span className="text-sm font-semibold leading-tight">{q.staffName}</span>
                                {q.staffRole && <span className="text-xs text-muted-foreground">{q.staffRole}</span>}
                                {q.rewritten && <span className="text-xs text-primary/70 flex items-center gap-0.5"><Sparkles className="w-3 h-3" /> AI-polished</span>}
                              </div>
                            </div>
                            {/* Quote text — full width on mobile */}
                            <div className="flex-1 min-w-0 flex items-center sm:min-h-[96px]">
                              <p className="text-sm text-muted-foreground italic">"{q.rewritten || q.draft}"</p>
                            </div>
                            <div className="flex gap-1 flex-shrink-0 self-start">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingQuoteId(q.id);
                                  setQuoteDraft(q.draft);
                                  setQuoteStaffId(q.staffId);
                                  setQuoteRewritten(q.rewritten);
                                  setQuoteUseRewritten(!!q.rewritten);
                                  setQuoteDialogOpen(true);
                                }}
                                className="p-1 text-muted-foreground hover:text-primary transition-colors"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleGuidanceChange("staffQuotes", guidance.staffQuotes.filter((x) => x.id !== q.id))}
                                className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingQuoteId(null);
                        setQuoteDraft("");
                        const randomStaff = staffList.length > 0
                          ? staffList[Math.floor(Math.random() * staffList.length)]
                          : null;
                        setQuoteStaffId(randomStaff?.id ?? null);
                        setQuoteRewritten(null);
                        setQuoteUseRewritten(false);
                        setQuoteDialogOpen(true);
                      }}
                      className="w-fit"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Quote
                    </Button>
                  </div>

                  {/* ── Per-product branding override ── */}
                  <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Logo Positions — this product</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        By default all products use the global logo positions from Settings → Branding.
                        Use this to turn off branding for this product or apply a different set.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(['global', 'disabled', 'custom'] as const).map(mode => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => { setBrandingMode(mode); setBrandingOverrideDirty(true); }}
                          className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                            brandingMode === mode
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                          }`}
                        >
                          {mode === 'global' ? '✓ Use global defaults' : mode === 'disabled' ? '✗ No branding' : '⚙ Custom for this product'}
                        </button>
                      ))}
                    </div>
                    {brandingMode === 'disabled' && (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                        The logo positions section will be hidden on this product's shop page.
                      </p>
                    )}
                    {brandingMode === 'custom' && (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">Tick the positions that apply to this product:</p>
                        <div className="grid grid-cols-2 gap-1.5">
                          {globalBrandingPositions.map(pos => (
                            <label key={pos.id} className="flex items-center gap-2 cursor-pointer p-2 rounded border border-border hover:bg-muted/40 text-sm">
                              <input
                                type="checkbox"
                                checked={customBrandingIds.has(pos.id)}
                                onChange={e => {
                                  setCustomBrandingIds(prev => {
                                    const next = new Set(prev);
                                    e.target.checked ? next.add(pos.id) : next.delete(pos.id);
                                    return next;
                                  });
                                  setBrandingOverrideDirty(true);
                                }}
                                className="rounded"
                              />
                              <span className="flex-1">{pos.name}</span>
                              {pos.surcharge > 0 && <span className="text-xs text-muted-foreground">+£{pos.surcharge.toFixed(2)}</span>}
                              {pos.surcharge === 0 && !pos.notes_field && <span className="text-xs text-green-600">Included</span>}
                            </label>
                          ))}
                        </div>
                        {globalBrandingPositions.length === 0 && (
                          <p className="text-xs text-muted-foreground italic">No global positions configured — go to Settings → Branding first.</p>
                        )}
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant={brandingOverrideDirty ? "default" : "outline"}
                      disabled={!brandingOverrideDirty || updateMutation.isPending}
                      onClick={() => {
                        const override =
                          brandingMode === 'global' ? null
                          : brandingMode === 'disabled' ? []
                          : globalBrandingPositions.filter(pos => customBrandingIds.has(pos.id));
                        updateMutation.mutate(
                          { brandingPositionsOverride: override } as any,
                          { onSuccess: () => setBrandingOverrideDirty(false) }
                        );
                      }}
                    >
                      <Save className="w-3.5 h-3.5 mr-1.5" />
                      Save branding override
                    </Button>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <Button onClick={saveGuidance} disabled={!guidanceDirty || updateMutation.isPending}>
                      {updateMutation.isPending
                        ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        : <Save className="w-4 h-4 mr-2" />}
                      Save Guidance
                    </Button>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* ── Social Post ── */}
            <TabsContent value="social">
              <div className="mt-4 space-y-6">
                {/* Composer */}
                <div className="bg-card border border-border/50 rounded-lg p-6 shadow-sm">
                  <div className="flex items-center justify-between mb-5">
                    <div>
                      <h3 className="font-semibold flex items-center gap-2">
                        <Share2 className="w-4 h-4 text-blue-500" /> Social Post Composer
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Generate and schedule posts for Facebook and Google Business — uses the WooCommerce product image</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {socialDraft.editingId && (
                        <Button size="sm" variant="ghost" className="text-xs gap-1" onClick={() => setSocialDraft(p => ({ facebookContent: "", googleContent: "", linkedinContent: "", hashtags: "", platforms: ["facebook","google"], autoReschedule: false, editingId: null, productImageUrl: socialImagesQuery.data?.productImageUrl ?? null, websiteUrl: p.websiteUrl, season: null }))}>
                          <X className="w-3 h-3" /> New draft
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="text-xs gap-1" onClick={() => setSocialShowPreview(v => !v)}>
                        <Eye className="w-3.5 h-3.5" /> {socialShowPreview ? "Hide preview" : "Preview"}
                      </Button>
                      <Button onClick={() => generateSocialMut.mutate()} disabled={generateSocialMut.isPending} className="gap-2">
                        {generateSocialMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                        {generateSocialMut.isPending ? "Generating…" : "Generate with AI"}
                      </Button>
                    </div>
                  </div>

                  {/* Post Preview */}
                  {socialShowPreview && (socialDraft.facebookContent || socialDraft.googleContent) && (
                    <div className="mb-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Facebook preview */}
                      {socialDraft.facebookContent && (
                        <div className="rounded-xl overflow-hidden border border-[#ddd] shadow-sm bg-white text-sm">
                          <div className="bg-[#1877f2] text-white text-xs font-semibold px-3 py-1.5 flex items-center gap-1.5">
                            <Share2 className="w-3 h-3" /> Facebook Post Preview
                          </div>
                          {socialDraft.productImageUrl && (
                            <img src={socialDraft.productImageUrl} alt="Product" className="w-full h-44 object-cover" onError={e => (e.currentTarget.style.display = "none")} />
                          )}
                          <div className="p-3 space-y-2">
                            <p className="text-xs font-semibold text-[#1c1e21]">Your business</p>
                            <p className="text-xs text-[#1c1e21] leading-relaxed whitespace-pre-wrap">{socialDraft.facebookContent}</p>
                            {socialDraft.hashtags && (
                              <p className="text-xs text-[#1877f2]">{socialDraft.hashtags.split(",").map(h => `#${h.trim()}`).join(" ")}</p>
                            )}
                          </div>
                        </div>
                      )}
                      {/* Google Business preview */}
                      {socialDraft.googleContent && (
                        <div className="rounded-xl overflow-hidden border border-[#ddd] shadow-sm bg-white text-sm">
                          <div className="bg-[#34a853] text-white text-xs font-semibold px-3 py-1.5 flex items-center gap-1.5">
                            <Globe className="w-3 h-3" /> Google Business Preview
                          </div>
                          {socialDraft.productImageUrl && (
                            <img src={socialDraft.productImageUrl} alt="Product" className="w-full h-44 object-cover" onError={e => (e.currentTarget.style.display = "none")} />
                          )}
                          <div className="p-3 space-y-2">
                            <p className="text-xs font-semibold text-[#202124]">Your business</p>
                            <p className="text-xs text-[#202124] leading-relaxed whitespace-pre-wrap">{socialDraft.googleContent}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-4">
                    {/* Facebook post */}
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-1.5 font-medium">
                          <Share2 className="w-3.5 h-3.5 text-blue-600" /> Facebook Post
                        </Label>
                        <span className="text-xs text-muted-foreground">{socialDraft.facebookContent.length} chars</span>
                      </div>
                      <Textarea rows={6} value={socialDraft.facebookContent} onChange={e => setSocialDraft(p => ({ ...p, facebookContent: e.target.value }))} placeholder="Facebook post content will appear here after generating…" />
                    </div>

                    {/* Google post */}
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-1.5 font-medium">
                          <Globe className="w-3.5 h-3.5 text-green-600" /> Google Business Post
                          <span className="text-xs text-muted-foreground font-normal">(auto-posted if GBP connected)</span>
                        </Label>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{socialDraft.googleContent.length} chars</span>
                          {socialDraft.googleContent && (
                            <Button size="sm" variant="ghost" className="h-6 text-xs px-2 gap-1" onClick={() => { navigator.clipboard.writeText(socialDraft.googleContent); toast({ title: "Google content copied" }); }}>
                              Copy
                            </Button>
                          )}
                        </div>
                      </div>
                      <Textarea rows={6} value={socialDraft.googleContent} onChange={e => setSocialDraft(p => ({ ...p, googleContent: e.target.value }))} placeholder="Google Business post content will appear here after generating…" />
                    </div>

                    {/* LinkedIn */}
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-1.5 font-medium">
                          <svg className="w-3.5 h-3.5 text-[#0077b5]" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                          LinkedIn Post
                          <span className="text-xs text-muted-foreground font-normal">(professional B2B tone)</span>
                        </Label>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{socialDraft.linkedinContent.length} chars</span>
                          {socialDraft.linkedinContent && (
                            <Button size="sm" variant="ghost" className="h-6 text-xs px-2 gap-1" onClick={() => { navigator.clipboard.writeText(socialDraft.linkedinContent); toast({ title: "LinkedIn content copied" }); }}>
                              Copy
                            </Button>
                          )}
                        </div>
                      </div>
                      <Textarea rows={6} value={socialDraft.linkedinContent} onChange={e => setSocialDraft(p => ({ ...p, linkedinContent: e.target.value }))} placeholder="LinkedIn post content will appear here after generating…" />
                    </div>

                    {/* Hashtags */}
                    <div className="grid gap-2">
                      <Label>Hashtags <span className="text-muted-foreground font-normal text-xs">(comma separated, no # symbol needed)</span></Label>
                      <Input value={socialDraft.hashtags} onChange={e => setSocialDraft(p => ({ ...p, hashtags: e.target.value }))} placeholder="brandedmerch, corporategifts, ukbusiness…" />
                    </div>

                    {/* Pull from WooCommerce */}
                    {product?.wooCommerceId && (
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-xs h-7"
                          disabled={pullWooMediaMut.isPending}
                          onClick={() => pullWooMediaMut.mutate()}
                        >
                          <RefreshCw className={`w-3 h-3 ${pullWooMediaMut.isPending ? "animate-spin" : ""}`} />
                          {pullWooMediaMut.isPending ? "Pulling…" : "Pull image & URL from WooCommerce"}
                        </Button>
                      </div>
                    )}

                    {/* Image picker */}
                    {(socialImagesQuery.data?.productImageUrl || socialVariantImages.length > 0) && (
                      <div className="grid gap-2">
                        <Label className="flex items-center gap-1.5">
                          <span>Product Image</span>
                          <span className="text-muted-foreground font-normal text-xs">(select which image to post with)</span>
                        </Label>
                        <div className="flex flex-wrap gap-2">
                          {/* No image option */}
                          <button
                            type="button"
                            onClick={() => setSocialDraft(p => ({ ...p, productImageUrl: null }))}
                            className={`w-14 h-14 rounded border-2 flex items-center justify-center text-xs text-muted-foreground transition-all ${!socialDraft.productImageUrl ? "border-blue-500 bg-blue-50" : "border-border/50 bg-muted/30 hover:border-border"}`}
                          >
                            None
                          </button>
                          {/* Main product image */}
                          {socialImagesQuery.data?.productImageUrl && (
                            <button
                              type="button"
                              onClick={() => setSocialDraft(p => ({ ...p, productImageUrl: socialImagesQuery.data.productImageUrl }))}
                              className={`relative w-14 h-14 rounded border-2 overflow-hidden transition-all ${socialDraft.productImageUrl === socialImagesQuery.data.productImageUrl ? "border-blue-500" : "border-border/50 hover:border-border"}`}
                              title="Main product image"
                            >
                              <img src={socialImagesQuery.data.productImageUrl} alt="Main" className="w-full h-full object-cover" />
                            </button>
                          )}
                          {/* Variant colour images */}
                          {socialVariantImages.map(v => (
                            <button
                              key={v.colour}
                              type="button"
                              onClick={() => setSocialDraft(p => ({ ...p, productImageUrl: v.imageUrl }))}
                              className={`relative w-14 h-14 rounded border-2 overflow-hidden transition-all ${socialDraft.productImageUrl === v.imageUrl ? "border-blue-500" : "border-border/50 hover:border-border"}`}
                              title={v.colour}
                            >
                              <img src={v.imageUrl} alt={v.colour} className="w-full h-full object-cover" />
                              <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] px-0.5 truncate text-center leading-4">{v.colour}</span>
                            </button>
                          ))}
                        </div>
                        {socialDraft.productImageUrl && (
                          <p className="text-xs text-muted-foreground">Selected image will be posted to Facebook. The product URL below will appear as a link in the caption.</p>
                        )}
                      </div>
                    )}

                    {/* Website URL */}
                    <div className="grid gap-2">
                      <Label className="flex items-center gap-1.5">
                        <span>Product Page URL</span>
                        <span className="text-muted-foreground font-normal text-xs">(appended to the post so people can shop)</span>
                      </Label>
                      <Input
                        value={socialDraft.websiteUrl}
                        onChange={e => setSocialDraft(p => ({ ...p, websiteUrl: e.target.value }))}
                            placeholder="https://your-store.example/product/…"
                      />
                    </div>

                    {/* Platform toggles */}
                    <div className="flex items-center gap-6 pt-1">
                      <span className="text-sm font-medium">Post to:</span>
                      {[{ id: "facebook", label: "Facebook (auto-post with image)" }, { id: "google", label: "Google Business (auto-post if connected)" }, { id: "linkedin", label: "LinkedIn (auto-post if connected)" }].map(p => (
                        <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input type="checkbox" checked={socialDraft.platforms.includes(p.id)} onChange={e => setSocialDraft(prev => ({ ...prev, platforms: e.target.checked ? [...prev.platforms, p.id] : prev.platforms.filter(x => x !== p.id) }))} className="rounded" />
                          {p.label}
                        </label>
                      ))}
                    </div>

                    {/* Auto-reschedule */}
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={socialDraft.autoReschedule} onChange={e => setSocialDraft(p => ({ ...p, autoReschedule: e.target.checked }))} className="rounded" />
                      <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
                      <span>Auto-reschedule every ~4 months after publishing</span>
                    </label>

                    {/* Action buttons */}
                    <div className="flex items-center gap-3 pt-2 border-t border-border/50">
                      <Button variant="outline" onClick={() => saveSocialMut.mutate()} disabled={saveSocialMut.isPending || !socialDraft.facebookContent} className="gap-2">
                        {saveSocialMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save Draft
                      </Button>
                      <Button variant="outline" onClick={() => scheduleSocialMut.mutate()} disabled={scheduleSocialMut.isPending || !socialDraft.facebookContent} className="gap-2 text-amber-700 border-amber-300 hover:bg-amber-50">
                        {scheduleSocialMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarDays className="w-4 h-4" />}
                        Schedule (within 30 days)
                      </Button>
                      <Button onClick={() => publishSocialMut.mutate()} disabled={publishSocialMut.isPending || !socialDraft.facebookContent} className="gap-2 bg-blue-600 hover:bg-blue-700 text-white">
                        {publishSocialMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        Publish Now
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Post history */}
                <div className="bg-card border border-border/50 rounded-lg p-6 shadow-sm">
                  <h3 className="font-semibold flex items-center gap-2 mb-4">
                    <Clock className="w-4 h-4" /> Post History
                  </h3>
                  {socialPostsQuery.isLoading ? (
                    <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                  ) : !socialPostsQuery.data?.length ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No posts yet — generate your first one above.</p>
                  ) : (
                    <div className="space-y-4">
                      {socialPostsQuery.data.map((post: any) => {
                        const STATUS_CFG: Record<string, { label: string; cls: string; Icon: any }> = {
                          draft:      { label: "Draft",       cls: "bg-slate-100 text-slate-700",  Icon: Save },
                          scheduled:  { label: "Scheduled",   cls: "bg-amber-100 text-amber-700",  Icon: CalendarDays },
                          publishing: { label: "Publishing…", cls: "bg-blue-100 text-blue-700",    Icon: Loader2 },
                          published:  { label: "Published",   cls: "bg-green-100 text-green-700",  Icon: CheckCircle2 },
                          failed:     { label: "Failed",      cls: "bg-red-100 text-red-700",      Icon: AlertCircle },
                        };
                        const cfg = STATUS_CFG[post.status] ?? STATUS_CFG.draft;
                        const { Icon } = cfg;
                        const lastComments: any[] = Array.isArray(post.last_comments) ? post.last_comments : (post.last_comments ? JSON.parse(post.last_comments) : []);
                        return (
                          <div key={post.id} className="rounded-lg border border-border/50 bg-muted/20 overflow-hidden">
                            {/* Image strip if present */}
                            {post.product_image_url && (
                              <div className="flex gap-0">
                                <img src={post.product_image_url} alt="" className="h-20 w-20 object-cover flex-shrink-0" onError={e => (e.currentTarget.style.display = "none")} />
                                <div className="flex-1 p-3 min-w-0">
                                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                                    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.cls}`}>
                                      <Icon className="w-3 h-3" /> {cfg.label}
                                    </span>
                                    {post.new_activity && (
                                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 animate-pulse">
                                        New activity!
                                      </span>
                                    )}
                                    {post.scheduled_at && (
                                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                                        <CalendarDays className="w-3 h-3" />
                                        {new Date(post.scheduled_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                                      </span>
                                    )}
                                    {post.published_at && (
                                      <span className="text-xs text-muted-foreground">
                                        Published {new Date(post.published_at).toLocaleDateString("en-GB")}
                                      </span>
                                    )}
                                    {post.auto_reschedule && (
                                      <span className="text-xs text-blue-600 flex items-center gap-1">
                                        <RefreshCw className="w-3 h-3" /> Auto-reschedule
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground line-clamp-2">{post.facebook_content || post.google_content}</p>
                                </div>
                              </div>
                            )}
                            {/* No image — original layout */}
                            {!post.product_image_url && (
                              <div className="p-3">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.cls}`}>
                                    <Icon className="w-3 h-3" /> {cfg.label}
                                  </span>
                                  {post.new_activity && (
                                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 animate-pulse">
                                      New activity!
                                    </span>
                                  )}
                                  {post.scheduled_at && (
                                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                                      <CalendarDays className="w-3 h-3" />{new Date(post.scheduled_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                                    </span>
                                  )}
                                  {post.published_at && (
                                    <span className="text-xs text-muted-foreground">Published {new Date(post.published_at).toLocaleDateString("en-GB")}</span>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground line-clamp-2">{post.facebook_content || post.google_content}</p>
                              </div>
                            )}
                            {/* Engagement stats */}
                            {post.status === "published" && post.fb_post_id && (
                              <div className="px-3 pb-2 flex items-center gap-4">
                                <span className="text-xs text-muted-foreground flex items-center gap-1">👍 {post.fb_reactions ?? 0} reactions</span>
                                <span className="text-xs text-muted-foreground flex items-center gap-1">💬 {post.fb_comments ?? 0} comments</span>
                                <span className="text-xs text-muted-foreground flex items-center gap-1">↗️ {post.fb_shares ?? 0} shares</span>
                                {post.fb_stats_at && (
                                  <span className="text-xs text-muted-foreground opacity-60">· updated {new Date(post.fb_stats_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                                )}
                                <Button size="sm" variant="ghost" className="h-6 text-xs px-2 ml-auto gap-1" onClick={() => refreshStatsMut.mutate(post.id)} disabled={refreshStatsMut.isPending}>
                                  <RefreshCw className={`w-3 h-3 ${refreshStatsMut.isPending ? "animate-spin" : ""}`} /> Refresh
                                </Button>
                              </div>
                            )}
                            {/* Recent comments */}
                            {lastComments.length > 0 && (
                              <div className="px-3 pb-3 space-y-1.5 border-t border-border/40 pt-2">
                                <p className="text-xs font-medium text-muted-foreground">Recent comments</p>
                                {lastComments.map((c: any, i: number) => (
                                  <div key={i} className="text-xs bg-white rounded px-2 py-1.5 border border-border/40">
                                    <span className="font-medium">{c.from}</span>
                                    <span className="text-muted-foreground mx-1">·</span>
                                    <span>{c.message}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {/* Error */}
                            {post.error_message && (
                              <div className="px-3 pb-2">
                                <p className="text-xs text-red-600">{post.error_message}</p>
                              </div>
                            )}
                            {/* Actions */}
                            <div className="px-3 pb-2 flex items-center gap-1 border-t border-border/30 pt-2">
                              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setSocialDraft({
                                facebookContent: post.facebook_content || "",
                                googleContent: post.google_content || "",
                                linkedinContent: post.linkedin_content || "",
                                hashtags: post.hashtags || "",
                                platforms: post.platforms || ["facebook", "google"],
                                autoReschedule: post.auto_reschedule || false,
                                editingId: post.id,
                                productImageUrl: post.product_image_url || null,
                                websiteUrl: post.website_url || "",
                                season: post.season || null,
                              })}>
                                <Edit2 className="w-3 h-3" /> Edit
                              </Button>
                              {(post.status === "draft" || post.status === "scheduled") && (
                                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-blue-600" onClick={() => publishSocialById.mutate(post.id)} disabled={publishSocialById.isPending}>
                                  <Send className="w-3 h-3" /> Publish Now
                                </Button>
                              )}
                              {post.new_activity && (
                                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-slate-600" onClick={() => apiFetch(`/social-posts/${post.id}/seen`, { method: "POST" }).then(() => qc.invalidateQueries({ queryKey: ["social-posts", productId] }))}>
                                  Mark seen
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-destructive ml-auto" onClick={() => deleteSocialMut.mutate(post.id)} disabled={deleteSocialMut.isPending}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* ── Image Generation ── */}
            <TabsContent value="imagegen">
              <div className="mt-4 space-y-6">
                {/* Form card */}
                <div className="bg-card border border-border/50 rounded-lg p-6 shadow-sm">
                  <div className="flex items-center justify-between mb-5">
                    <div>
                      <h3 className="font-semibold flex items-center gap-2">
                        <ImageIcon className="w-4 h-4 text-violet-500" /> AI Product Image Generator
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Generate a catalogue composite image prompt + optional animation prompt</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {imgGenHistory.length > 0 && (
                        <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setImgGenHistoryOpen(h => !h)}>
                          <Clock className="w-3.5 h-3.5" /> History ({imgGenHistory.length})
                        </Button>
                      )}
                      <Button
                        onClick={() => generateImgPromptMut.mutate()}
                        disabled={generateImgPromptMut.isPending || !imgGen.productName || !imgGen.garmentType || !imgGen.heroColourway || imgGen.availableColourways.length === 0}
                        className="gap-2 bg-violet-600 hover:bg-violet-700 text-white"
                      >
                        {generateImgPromptMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                        {generateImgPromptMut.isPending ? "Generating…" : "Generate"}
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* Product Name */}
                    <div className="grid gap-2">
                      <Label className="text-sm font-medium">Product Name *</Label>
                      <Input value={imgGen.productName} onChange={e => setImgGen(p => ({ ...p, productName: e.target.value }))} placeholder="e.g. Active Ladies Smash Polo" />
                    </div>

                    {/* Garment Type */}
                    <div className="grid gap-2">
                      <Label className="text-sm font-medium">Garment Type *</Label>
                      <Input value={imgGen.garmentType} onChange={e => setImgGen(p => ({ ...p, garmentType: e.target.value }))} placeholder="e.g. polo shirt, fleece jacket, hi-vis vest" />
                    </div>

                    {/* Gender Fit */}
                    <div className="grid gap-2">
                      <Label className="text-sm font-medium">Gender Fit</Label>
                      <div className="flex gap-2">
                        {(["Male", "Female", "Unisex"] as const).map(g => (
                          <button key={g} type="button" onClick={() => setImgGen(p => ({ ...p, genderFit: g }))}
                            className={cn("flex-1 py-2 text-sm font-medium rounded-md border transition-colors",
                              imgGen.genderFit === g ? "bg-violet-600 text-white border-violet-600" : "bg-background text-foreground border-border hover:bg-muted")}>
                            {g === "Male" ? "👨 Male" : g === "Female" ? "👩 Female" : "👥 Unisex"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Category */}
                    <div className="grid gap-2">
                      <Label className="text-sm font-medium">Product Category</Label>
                      <div className="grid grid-cols-3 gap-2">
                        {([
                          { id: "Trade", label: "🔧 Trade" },
                          { id: "Corporate", label: "💼 Corporate" },
                          { id: "Hospitality", label: "🏨 Hospitality" },
                          { id: "Hi-Vis", label: "🦺 Hi-Vis" },
                          { id: "Healthcare", label: "🏥 Healthcare" },
                          { id: "Outerwear", label: "🧥 Outerwear" },
                        ] as const).map(({ id, label }) => (
                          <button key={id} type="button" onClick={() => setImgGen(p => ({ ...p, category: id }))}
                            className={cn("py-2 text-xs font-medium rounded-md border transition-colors px-2",
                              imgGen.category === id ? "bg-violet-600 text-white border-violet-600" : "bg-background text-foreground border-border hover:bg-muted")}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Hero Colourway */}
                    <div className="grid gap-2">
                      <Label className="text-sm font-medium">Hero Colourway * <span className="text-muted-foreground font-normal">(centre panel)</span></Label>
                      <div className="flex gap-2">
                        <Input value={imgGen.heroColourway} onChange={e => setImgGen(p => ({ ...p, heroColourway: e.target.value }))} placeholder="e.g. Navy" className="flex-1" />
                        {imgGen.availableColourways.length > 0 && (
                          <Button type="button" variant="outline" size="sm" className="shrink-0 text-xs"
                            onClick={() => {
                              const others = imgGen.availableColourways.filter(c => c !== imgGen.heroColourway);
                              const pool = others.length > 0 ? others : imgGen.availableColourways;
                              setImgGen(p => ({ ...p, heroColourway: pool[Math.floor(Math.random() * pool.length)] }));
                            }}>
                            🎲 Random
                          </Button>
                        )}
                      </div>
                      {imgGen.availableColourways.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {imgGen.availableColourways.map(c => (
                            <button key={c} type="button" onClick={() => setImgGen(p => ({ ...p, heroColourway: c }))}
                              className={cn("text-xs px-2 py-0.5 rounded-full border transition-colors",
                                imgGen.heroColourway === c ? "bg-violet-600 text-white border-violet-600" : "bg-muted text-muted-foreground border-border hover:bg-muted/80")}>
                              {c}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Available Colourways */}
                    <div className="grid gap-2">
                      <Label className="text-sm font-medium">Available Colourways *</Label>
                      <div className="flex flex-wrap gap-1.5 min-h-[36px] rounded-md border border-border bg-muted/30 px-3 py-2">
                        {imgGen.availableColourways.length === 0 && (
                          <span className="text-xs text-muted-foreground italic">No colours found — check product has WooCommerce variants</span>
                        )}
                        {imgGen.availableColourways.map(c => (
                          <span key={c} className="inline-flex items-center gap-1 text-xs bg-violet-100 text-violet-800 border border-violet-200 rounded-full px-2 py-0.5">
                            {c}
                            <button type="button" onClick={() => setImgGen(p => ({ ...p, availableColourways: p.availableColourways.filter(x => x !== c), heroColourway: p.heroColourway === c ? (p.availableColourways.filter(x => x !== c)[0] ?? "") : p.heroColourway }))} className="hover:text-red-600">
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Number of thumbnails */}
                    <div className="grid gap-2">
                      <Label className="text-sm font-medium">Number of Thumbnails <span className="text-muted-foreground font-normal">(surrounding panels)</span></Label>
                      <div className="flex gap-2">
                        {[8, 9, 10].map(n => (
                          <button key={n} type="button" onClick={() => setImgGen(p => ({ ...p, numThumbnails: n }))}
                            className={cn("flex-1 py-2 text-sm font-medium rounded-md border transition-colors",
                              imgGen.numThumbnails === n ? "bg-violet-600 text-white border-violet-600" : "bg-background text-foreground border-border hover:bg-muted")}>
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Logo text */}
                    <div className="grid gap-2">
                      <Label className="text-sm font-medium">Logo Text <span className="text-muted-foreground font-normal">(embroidered left chest)</span></Label>
                      <Input value={imgGen.logoText} onChange={e => setImgGen(p => ({ ...p, logoText: e.target.value }))} placeholder="YOUR LOGO HERE" />
                    </div>

                    {/* Notes */}
                    <div className="grid gap-2 md:col-span-2">
                      <Label className="text-sm font-medium">Special Notes</Label>
                      <Textarea rows={2} value={imgGen.notes} onChange={e => setImgGen(p => ({ ...p, notes: e.target.value }))} placeholder="e.g. outdoor summer setting, avoid construction helmets, include high-visibility elements…" />
                    </div>

                    {/* Animation toggle */}
                    <div className="md:col-span-2 flex items-center justify-between rounded-md border border-border bg-muted/30 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium">Generate animation prompt</p>
                        <p className="text-xs text-muted-foreground">Produces an 8–12 second looping video prompt for the centre hero panel</p>
                      </div>
                      <button type="button" onClick={() => setImgGen(p => ({ ...p, generateAnimation: !p.generateAnimation }))}
                        className={cn("relative inline-flex h-6 w-11 items-center rounded-full transition-colors border-2",
                          imgGen.generateAnimation ? "bg-violet-600 border-violet-600" : "bg-muted border-border")}>
                        <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                          imgGen.generateAnimation ? "translate-x-5" : "translate-x-1")} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Category environment hint */}
                <div className="bg-muted/40 border border-border/40 rounded-lg px-4 py-3">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {({ Trade: "🔧 Trade", Corporate: "💼 Corporate", Hospitality: "🏨 Hospitality", "Hi-Vis": "🦺 Hi-Vis", Healthcare: "🏥 Healthcare", Outerwear: "🧥 Outerwear" })[imgGen.category]} environment:
                    </span>{" "}
                    {imgGen.category === "Trade" && "Vans, workshops, warehouses, construction, landscaping, delivery, engineering and site environments"}
                    {imgGen.category === "Corporate" && "Offices, hotel reception, meetings, conferences, golf days, networking and business environments"}
                    {imgGen.category === "Hospitality" && "Cafés, restaurants, hotels, bars, catering, reception and events"}
                    {imgGen.category === "Hi-Vis" && "Roads, rail, utilities, construction, civil engineering, traffic management and site work — railway workers wear orange only"}
                    {imgGen.category === "Healthcare" && "Care homes, clinics, reception, cleaning, support work and healthcare environments"}
                    {imgGen.category === "Outerwear" && "Spring, autumn, outdoor work, site visits, logistics, deliveries and facilities management"}
                  </p>
                </div>

                {/* Loading state */}
                {generateImgPromptMut.isPending && (
                  <div className="bg-card border border-violet-200 rounded-lg p-8 shadow-sm flex flex-col items-center gap-3 text-violet-700">
                    <Loader2 className="w-8 h-8 animate-spin" />
                    <p className="text-sm font-medium">Building your catalogue prompt…</p>
                    <p className="text-xs text-muted-foreground">Usually takes 5–10 seconds</p>
                  </div>
                )}

                {/* Output — prompts only, user pastes into ChatGPT for best quality */}
                {!generateImgPromptMut.isPending && imgGenPrompt && (
                  <div className="space-y-4">
                    {/* Still image prompt */}
                    <div className="bg-card border border-violet-200 rounded-lg p-5 shadow-sm space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <h4 className="font-semibold flex items-center gap-2 text-violet-700"><ImageIcon className="w-4 h-4" /> Still Image Prompt</h4>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" className="gap-1.5 text-xs border-violet-300 text-violet-700 hover:bg-violet-50"
                            onClick={() => { navigator.clipboard.writeText(imgGenPrompt); toast({ title: "Prompt copied!" }); }}>
                            <Copy className="w-3.5 h-3.5" /> Copy Prompt
                          </Button>
                          <Button size="sm" className="gap-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white"
                            onClick={() => { navigator.clipboard.writeText(imgGenPrompt); window.open("https://chatgpt.com/", "_blank"); toast({ title: "Prompt copied — paste it into ChatGPT" }); }}>
                            <Wand2 className="w-3.5 h-3.5" /> Copy &amp; Open ChatGPT
                          </Button>
                        </div>
                      </div>
                      <Textarea rows={9} value={imgGenPrompt} onChange={e => setImgGenPrompt(e.target.value)} className="font-mono text-xs leading-relaxed bg-muted/30 resize-y" />
                      <p className="text-xs text-muted-foreground">
                        Click <strong>Copy &amp; Open ChatGPT</strong>, then in ChatGPT choose <strong>Create image</strong> and paste the prompt for best quality results.
                      </p>
                    </div>

                    {/* Animation prompt */}
                    {imgGenAnimPrompt && (
                      <div className="bg-card border border-blue-200 rounded-lg p-5 shadow-sm space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <h4 className="font-semibold flex items-center gap-2 text-blue-700"><Sparkles className="w-4 h-4" /> Animation Prompt</h4>
                          <Button size="sm" className="gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                            onClick={() => { navigator.clipboard.writeText(imgGenAnimPrompt); toast({ title: "Animation prompt copied!" }); }}>
                            <Copy className="w-3.5 h-3.5" /> Copy Prompt
                          </Button>
                        </div>
                        <Textarea rows={10} value={imgGenAnimPrompt} onChange={e => setImgGenAnimPrompt(e.target.value)} className="font-mono text-xs leading-relaxed bg-muted/30 resize-y" />
                        <p className="text-xs text-muted-foreground">
                          Paste into <strong>Runway Gen-3, Kling, or Pika</strong> using your generated still image as the start frame.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Prompt history */}
                {imgGenHistoryOpen && imgGenHistory.length > 0 && (
                  <div className="bg-card border border-border/50 rounded-lg p-5 shadow-sm space-y-3">
                    <h4 className="font-semibold text-sm flex items-center gap-2"><Clock className="w-4 h-4 text-muted-foreground" /> Prompt History <span className="text-xs text-muted-foreground font-normal">(last {imgGenHistory.length}, stored locally)</span></h4>
                    <div className="space-y-3">
                      {imgGenHistory.map((h, i) => (
                        <div key={h.ts} className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-medium">{h.productName} <span className="text-muted-foreground font-normal">· {new Date(h.ts).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></p>
                            <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-violet-600 hover:text-violet-700"
                              onClick={() => { setImgGenPrompt(h.stillPrompt); setImgGenAnimPrompt(h.animationPrompt); setImgGenImage(h.image); setImgGenHistoryOpen(false); }}>
                              Restore
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2 font-mono">{h.stillPrompt}</p>
                          <Button size="sm" variant="outline" className="gap-1 text-xs h-6"
                            onClick={() => { navigator.clipboard.writeText(h.stillPrompt); toast({ title: "Copied from history" }); }}>
                            <Copy className="w-3 h-3" /> Copy
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

          </Tabs>
        </div>

        <AddVariantDialog
          open={addVariantOpen}
          onClose={() => setAddVariantOpen(false)}
          productId={productId}
          attributes={attributes}
          suppliers={suppliers}
          defaultPrimaryId={defaultPrimaryId !== null ? String(defaultPrimaryId) : "none"}
          defaultSecondaryId={defaultSecondaryId !== null ? String(defaultSecondaryId) : "none"}
          onRefresh={refetchVariants}
        />

        {/* ── Add / Edit Quote dialog ── */}
        <Dialog open={quoteDialogOpen} onOpenChange={(v) => { if (!v) setQuoteDialogOpen(false); }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingQuoteId ? "Edit Quote" : "Add Staff Quote"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label>Staff Member</Label>
                {staffList.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No staff members yet —{" "}
                    <button type="button" className="underline text-primary" onClick={() => { setQuoteDialogOpen(false); setManageStaffOpen(true); }}>
                      add one first
                    </button>
                  </p>
                ) : (
                  <div className="flex gap-2">
                    <Select
                      value={quoteStaffId ? String(quoteStaffId) : ""}
                      onValueChange={(v) => {
                        const id = Number(v);
                        setQuoteStaffId(id);
                        const sm = staffList.find((s: any) => s.id === id);
                        if (sm) setQuoteRewritten(null);
                      }}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select a staff member…" />
                      </SelectTrigger>
                      <SelectContent>
                        {staffList.map((s: any) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            <span className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-primary/10 inline-flex items-center justify-center text-xs font-bold text-primary overflow-hidden flex-shrink-0">
                                {s.profileImageUrl
                                  ? <img src={s.profileImageUrl} alt={s.name} className="w-full h-full object-cover object-center" />
                                  : s.name.charAt(0).toUpperCase()}
                              </span>
                              {s.name}{s.role ? ` — ${s.role}` : ""}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      title="Pick a random staff member"
                      onClick={() => {
                        if (staffList.length === 0) return;
                        const others = staffList.filter((s: any) => s.id !== quoteStaffId);
                        const pool = others.length > 0 ? others : staffList;
                        const pick = pool[Math.floor(Math.random() * pool.length)];
                        setQuoteStaffId(pick.id);
                        setQuoteRewritten(null);
                      }}
                    >
                      <Shuffle className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>

              <div className="grid gap-2">
                <Label>Draft Recommendation</Label>
                <Textarea
                  value={quoteDraft}
                  onChange={(e) => { setQuoteDraft(e.target.value); setQuoteRewritten(null); setQuoteUseRewritten(false); }}
                  placeholder="Type the basic recommendation — AI will polish it…"
                  rows={3}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  disabled={!quoteDraft.trim() || !quoteStaffId || rewriteMut.isPending}
                  onClick={() => {
                    const sm = staffList.find((s: any) => s.id === quoteStaffId);
                    rewriteMut.mutate({ draft: quoteDraft, staffName: sm?.name ?? "Staff" });
                  }}
                >
                  {rewriteMut.isPending
                    ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Rewriting…</>
                    : <><Sparkles className="w-3.5 h-3.5 mr-1.5" /> AI Rewrite</>}
                </Button>
              </div>

              {quoteRewritten && (
                <div className="grid gap-2">
                  <Label>AI-Polished Version</Label>
                  <Textarea
                    value={quoteRewritten}
                    onChange={(e) => setQuoteRewritten(e.target.value)}
                    rows={3}
                    className="italic text-sm"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="use-rewritten"
                      checked={quoteUseRewritten}
                      onChange={(e) => setQuoteUseRewritten(e.target.checked)}
                      className="rounded"
                    />
                    <label htmlFor="use-rewritten" className="text-sm cursor-pointer">Use AI version on the product page</label>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setQuoteDialogOpen(false)}>Cancel</Button>
              <Button
                disabled={!quoteStaffId || !quoteDraft.trim()}
                onClick={() => {
                  const sm = staffList.find((s: any) => s.id === quoteStaffId);
                  const newQuote = {
                    id: editingQuoteId ?? Math.random().toString(36).slice(2),
                    staffId: quoteStaffId!,
                    staffName: sm?.name ?? "",
                    staffRole: sm?.role ?? null,
                    staffImageUrl: sm?.profileImageUrl ?? null,
                    draft: quoteDraft,
                    rewritten: quoteUseRewritten ? quoteRewritten : null,
                  };
                  const updated = editingQuoteId
                    ? guidance!.staffQuotes.map((q) => q.id === editingQuoteId ? newQuote : q)
                    : [...guidance!.staffQuotes, newQuote];
                  handleGuidanceChange("staffQuotes", updated);
                  setQuoteDialogOpen(false);
                  saveGuidance(updated);
                }}
              >
                {editingQuoteId ? "Save Changes" : "Add Quote"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Manage Staff dialog ── */}
        <Dialog open={manageStaffOpen} onOpenChange={(v) => { if (!v) { setManageStaffOpen(false); setEditingStaffId(null); setStaffFormName(""); setStaffFormRole(""); setStaffFormImageUrl(""); } }}>
          <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col">
            <DialogHeader className="flex-shrink-0">
              <DialogTitle>Manage Staff</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-2 overflow-y-auto flex-1 min-h-0">
              {/* Add / Edit form */}
              <div className="border border-border rounded-lg p-4 grid gap-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{editingStaffId ? "Edit Staff Member" : "Add Staff Member"}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Name *</Label>
                    <Input value={staffFormName} onChange={(e) => setStaffFormName(e.target.value)} placeholder="e.g. Chris" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Role</Label>
                    <Input value={staffFormRole} onChange={(e) => setStaffFormRole(e.target.value)} placeholder="e.g. Sales Manager" />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Profile Photo</Label>

                  {/* ── Crop editor ── */}
                  {cropSrc ? (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">Drag to reposition · Scroll to zoom</p>
                      <div
                        className="relative mx-auto select-none"
                        style={{ width: 200, height: 200, borderRadius: "50%", overflow: "hidden", cursor: cropDragRef.current.active ? "grabbing" : "grab", background: "#e2e8f0", border: "3px solid #1e3a5f", boxShadow: "0 2px 12px rgba(30,58,95,0.25)" }}
                        onMouseDown={(e) => {
                          cropDragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
                          e.preventDefault();
                        }}
                        onMouseMove={(e) => {
                          if (!cropDragRef.current.active) return;
                          const dx = e.clientX - cropDragRef.current.lastX;
                          const dy = e.clientY - cropDragRef.current.lastY;
                          cropDragRef.current.lastX = e.clientX;
                          cropDragRef.current.lastY = e.clientY;
                          setCropOffsetX(x => x + dx);
                          setCropOffsetY(y => y + dy);
                        }}
                        onMouseUp={() => { cropDragRef.current.active = false; }}
                        onMouseLeave={() => { cropDragRef.current.active = false; }}
                        onWheel={(e) => {
                          e.preventDefault();
                          setCropZoom(z => Math.max(0.5, Math.min(5, z - e.deltaY * 0.005)));
                        }}
                        onTouchStart={(e) => {
                          const t = e.touches[0];
                          cropDragRef.current = { active: true, lastX: t.clientX, lastY: t.clientY };
                        }}
                        onTouchMove={(e) => {
                          if (!cropDragRef.current.active) return;
                          const t = e.touches[0];
                          const dx = t.clientX - cropDragRef.current.lastX;
                          const dy = t.clientY - cropDragRef.current.lastY;
                          cropDragRef.current.lastX = t.clientX;
                          cropDragRef.current.lastY = t.clientY;
                          setCropOffsetX(x => x + dx);
                          setCropOffsetY(y => y + dy);
                        }}
                        onTouchEnd={() => { cropDragRef.current.active = false; }}
                      >
                        <img
                          src={cropSrc}
                          alt="crop preview"
                          draggable={false}
                          style={{
                            position: "absolute",
                            left: "50%",
                            top: "50%",
                            width: "auto",
                            height: "auto",
                            minWidth: "100%",
                            minHeight: "100%",
                            transform: `translate(calc(-50% + ${cropOffsetX}px), calc(-50% + ${cropOffsetY}px)) scale(${cropZoom})`,
                            transformOrigin: "center center",
                            pointerEvents: "none",
                            objectFit: "cover",
                          }}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-muted-foreground">Zoom</label>
                        <input
                          type="range" min={0.5} max={5} step={0.05}
                          value={cropZoom}
                          onChange={(e) => setCropZoom(parseFloat(e.target.value))}
                          className="flex-1 h-1.5 accent-primary"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={confirmCrop} disabled={isCropping || uploadingStaffPhoto}>
                          {(isCropping || uploadingStaffPhoto) ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                          Apply crop
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setCropSrc(null); setCropZoom(1); setCropOffsetX(0); setCropOffsetY(0); }}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {staffFormImageUrl && (
                        <img src={staffFormImageUrl} alt="preview" className="w-10 h-10 rounded-full object-cover object-center border border-border flex-shrink-0" />
                      )}
                      <label className="cursor-pointer">
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                              setCropSrc(ev.target?.result as string);
                              setCropZoom(1);
                              setCropOffsetX(0);
                              setCropOffsetY(0);
                            };
                            reader.readAsDataURL(file);
                            e.target.value = "";
                          }}
                        />
                        <span className="inline-flex items-center gap-1.5 text-xs border border-border rounded px-2 py-1.5 hover:bg-muted transition-colors">
                          <Upload className="w-3 h-3" />
                          {staffFormImageUrl ? "Replace photo" : "Upload photo"}
                        </span>
                      </label>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!staffFormName.trim() || addStaffMut.isPending || updateStaffMut.isPending}
                    onClick={() => {
                      const body = { name: staffFormName.trim(), role: staffFormRole.trim() || null, profileImageUrl: staffFormImageUrl || null };
                      if (editingStaffId) {
                        updateStaffMut.mutate({ id: editingStaffId, body });
                      } else {
                        addStaffMut.mutate(body);
                      }
                    }}
                  >
                    {(addStaffMut.isPending || updateStaffMut.isPending) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (editingStaffId ? "Save" : "Add")}
                  </Button>
                  {editingStaffId && (
                    <Button size="sm" variant="outline" onClick={() => { setEditingStaffId(null); setStaffFormName(""); setStaffFormRole(""); setStaffFormImageUrl(""); }}>
                      Cancel
                    </Button>
                  )}
                </div>
              </div>

              {/* Staff list */}
              {staffList.length > 0 && (
                <div className="grid gap-2">
                  {staffList.map((s: any) => (
                    <div key={s.id} className="flex items-center gap-3 py-1.5 border-b border-border/50 last:border-0">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex-shrink-0 overflow-hidden flex items-center justify-center text-xs font-bold text-primary">
                        {s.profileImageUrl
                          ? <img src={s.profileImageUrl} alt={s.name} className="w-full h-full object-cover object-center" />
                          : s.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{s.name}</p>
                        {s.role && <p className="text-xs text-muted-foreground">{s.role}</p>}
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="p-1 text-muted-foreground hover:text-primary"
                          onClick={() => { setEditingStaffId(s.id); setStaffFormName(s.name); setStaffFormRole(s.role ?? ""); setStaffFormImageUrl(s.profileImageUrl ?? ""); }}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          className="p-1 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteStaffMut.mutate(s.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Generate colour × size matrix dialog */}
        <Dialog open={generateMatrixOpen} onOpenChange={v => { if (!v) setGenerateMatrixOpen(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Generate all variants</DialogTitle>
            </DialogHeader>
            <div className="py-2 space-y-3 text-sm text-muted-foreground">
              <p>
                This will create{" "}
                <strong className="text-foreground">
                  {attrColours.length > 0 && <>{attrColours.length} colour{attrColours.length !== 1 ? "s" : ""} × </>}
                  {attrSizes.length} size{attrSizes.length !== 1 ? "s" : ""}
                  {attrSleeves.length > 0 && <> × {attrSleeves.length} fit{attrSleeves.length !== 1 ? "s" : ""}</>}
                  {" = up to "}
                  {matrixVariantCount} variants
                </strong>{" "}for this product.
              </p>
              <p>
                Existing variants without a fit/sleeve value that have zero stock will be removed once the new combinations are created.
              </p>
              <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs space-y-1">
                <p className="font-medium text-foreground">
                  Colours: {attrColours.length > 0 ? attrColours.join(", ") : "No colour choice"}
                </p>
                <p className="font-medium text-foreground">Sizes: {attrSizes.join(", ")}</p>
                {attrSleeves.length > 0 && <p className="font-medium text-foreground">Fits: {attrSleeves.join(", ")}</p>}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setGenerateMatrixOpen(false)}>Cancel</Button>
              <Button onClick={() => generateMatrixMut.mutate()} disabled={generateMatrixMut.isPending}>
                {generateMatrixMut.isPending ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Generating…</> : "Generate variants"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {priceConfirmDialog}
      </Layout>
    </TooltipProvider>
  );
}
