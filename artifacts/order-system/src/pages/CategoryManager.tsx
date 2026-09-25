import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useUpload } from "@workspace/object-storage-web";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, GripVertical, Plus, Trash2, Loader2, Package,
  Save, FolderTree, ArrowRight, Camera, ImageOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

const API_BASE = "/api";

interface ManagedCategory {
  id: number;
  wooId: number | null;
  name: string;
  slug: string | null;
  imageUrl: string | null;
  parentWooId: number | null;
  productCount: number;
  displayOrder: number;
}

interface ManagedProduct {
  id: number;
  name: string;
  sku: string | null;
  category: string | null;
  image_url: string | null;
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(body || `HTTP ${res.status}`);
  }
  return res.json();
}

export default function CategoryManager() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"categories" | "move">("categories");

  // ── Categories tab state ────────────────────────────────────────────────────
  const [localCats, setLocalCats] = useState<ManagedCategory[]>([]);
  const [orderDirty, setOrderDirty] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [newName, setNewName] = useState("");
  const [newParentWooId, setNewParentWooId] = useState<string>("none");
  const [creating, setCreating] = useState(false);
  const dragItem = useRef<number | null>(null);
  const dragOver = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // ── Image upload ─────────────────────────────────────────────────────────────
  const uploadingCatId = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const { uploadFile } = useUpload({
    onSuccess: async (res) => {
      const id = uploadingCatId.current;
      if (id === null) return;
      const imageUrl = `/api/storage/objects${res.objectPath.replace(/^\/objects/, "")}`;
      setLocalCats((prev) => prev.map((c) => c.id === id ? { ...c, imageUrl } : c));
      try {
        await apiFetch(`/category-management/${id}`, { method: "PATCH", body: JSON.stringify({ imageUrl }) });
        qc.invalidateQueries({ queryKey: ["category-management"] });
        toast({ title: "Image updated" });
      } catch (e: any) {
        toast({ title: "Failed to save image", description: e.message, variant: "destructive" });
      } finally {
        uploadingCatId.current = null;
        setUploadingId(null);
      }
    },
    onError: () => {
      uploadingCatId.current = null;
      setUploadingId(null);
      toast({ title: "Upload failed", variant: "destructive" });
    },
  });

  const triggerImageUpload = (cat: ManagedCategory) => {
    uploadingCatId.current = cat.id;
    setUploadingId(cat.id);
    fileInputRef.current?.click();
  };

  // ── Move Products tab state ─────────────────────────────────────────────────
  const [sourceCatId, setSourceCatId] = useState<string>("none");
  const [targetCatId, setTargetCatId] = useState<string>("none");
  const [selectedProductIds, setSelectedProductIds] = useState<Set<number>>(new Set());
  const [moving, setMoving] = useState(false);

  // ── Data fetching ───────────────────────────────────────────────────────────
  const { data: categories = [], isLoading } = useQuery<ManagedCategory[]>({
    queryKey: ["category-management"],
    queryFn: () => apiFetch("/category-management"),
  });

  useEffect(() => {
    if (categories.length) {
      setLocalCats([...categories].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)));
    }
  }, [categories]);

  const { data: sourceProducts = [], isFetching: productsLoading } = useQuery<ManagedProduct[]>({
    queryKey: ["cat-products", sourceCatId],
    queryFn: () => apiFetch(`/category-management/${sourceCatId}/products`),
    enabled: sourceCatId !== "none",
  });

  useEffect(() => { setSelectedProductIds(new Set()); }, [sourceCatId]);

  // ── Drag handlers ────────────────────────────────────────────────────────────
  const onDragStart = (idx: number) => { dragItem.current = idx; };
  const onDragEnter = (idx: number) => { dragOver.current = idx; setDragOverIdx(idx); };
  const onDragEnd = () => {
    if (dragItem.current === null || dragOver.current === null || dragItem.current === dragOver.current) {
      dragItem.current = null; dragOver.current = null; setDragOverIdx(null); return;
    }
    const copy = [...localCats];
    const dragged = copy.splice(dragItem.current, 1)[0];
    copy.splice(dragOver.current, 0, dragged);
    setLocalCats(copy.map((c, i) => ({ ...c, displayOrder: i })));
    setOrderDirty(true);
    dragItem.current = null; dragOver.current = null; setDragOverIdx(null);
  };

  // ── Save order ───────────────────────────────────────────────────────────────
  const saveOrder = async () => {
    setSavingOrder(true);
    try {
      await apiFetch("/category-management/reorder", {
        method: "PATCH",
        body: JSON.stringify(localCats.map((c, i) => ({ id: c.id, displayOrder: i }))),
      });
      qc.invalidateQueries({ queryKey: ["category-management"] });
      setOrderDirty(false);
      toast({ title: "Order saved" });
    } catch (e: any) {
      toast({ title: "Failed to save order", description: e.message, variant: "destructive" });
    } finally { setSavingOrder(false); }
  };

  // ── Rename ───────────────────────────────────────────────────────────────────
  const startEdit = (cat: ManagedCategory) => { setEditingId(cat.id); setEditingName(cat.name); };
  const saveRename = async (id: number) => {
    const name = editingName.trim();
    setEditingId(null);
    if (!name) return;
    const old = localCats.find((c) => c.id === id);
    if (old?.name === name) return;
    // Optimistic update
    setLocalCats((prev) => prev.map((c) => c.id === id ? { ...c, name } : c));
    try {
      await apiFetch(`/category-management/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      qc.invalidateQueries({ queryKey: ["category-management"] });
      qc.invalidateQueries({ queryKey: ["cat-products"] });
      toast({ title: "Renamed" });
    } catch (e: any) {
      // Revert
      setLocalCats((prev) => prev.map((c) => c.id === id ? { ...c, name: old?.name ?? c.name } : c));
      toast({ title: "Failed to rename", description: e.message, variant: "destructive" });
    }
  };

  // ── Set parent ───────────────────────────────────────────────────────────────
  const setParent = async (cat: ManagedCategory, parentWooIdStr: string) => {
    const parentWooId = parentWooIdStr === "none" ? null : Number(parentWooIdStr);
    if (parentWooId === cat.parentWooId) return;
    if (parentWooId !== null && parentWooId === cat.wooId) return; // prevent self-parent
    // Optimistic
    setLocalCats((prev) => prev.map((c) => c.id === cat.id ? { ...c, parentWooId } : c));
    try {
      await apiFetch(`/category-management/${cat.id}`, { method: "PATCH", body: JSON.stringify({ parentWooId }) });
      qc.invalidateQueries({ queryKey: ["category-management"] });
    } catch (e: any) {
      setLocalCats((prev) => prev.map((c) => c.id === cat.id ? { ...c, parentWooId: cat.parentWooId } : c));
      toast({ title: "Failed to update parent", description: e.message, variant: "destructive" });
    }
  };

  // ── Create ───────────────────────────────────────────────────────────────────
  const createCategory = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const parentWooId = newParentWooId === "none" ? null : Number(newParentWooId);
      await apiFetch("/category-management", { method: "POST", body: JSON.stringify({ name, parentWooId }) });
      qc.invalidateQueries({ queryKey: ["category-management"] });
      setNewName(""); setNewParentWooId("none");
      toast({ title: `"${name}" created` });
    } catch (e: any) {
      toast({ title: "Failed to create", description: e.message, variant: "destructive" });
    } finally { setCreating(false); }
  };

  // ── Delete ───────────────────────────────────────────────────────────────────
  const deleteCategory = async (cat: ManagedCategory) => {
    if (cat.productCount > 0) {
      toast({ title: "Cannot delete", description: `Move the ${cat.productCount} product(s) to another category first.`, variant: "destructive" });
      return;
    }
    if (!confirm(`Delete "${cat.name}"? This cannot be undone.`)) return;
    try {
      await apiFetch(`/category-management/${cat.id}`, { method: "DELETE" });
      setLocalCats((prev) => prev.filter((c) => c.id !== cat.id));
      qc.invalidateQueries({ queryKey: ["category-management"] });
      toast({ title: `"${cat.name}" deleted` });
    } catch (e: any) {
      toast({ title: "Failed to delete", description: e.message, variant: "destructive" });
    }
  };

  // ── Move products ────────────────────────────────────────────────────────────
  const moveProducts = async () => {
    if (!selectedProductIds.size || targetCatId === "none") return;
    const targetCat = localCats.find((c) => String(c.id) === targetCatId);
    if (!targetCat) return;
    setMoving(true);
    try {
      const result = await apiFetch<{ moved: number }>("/category-management/bulk-reassign", {
        method: "POST",
        body: JSON.stringify({ productIds: [...selectedProductIds], targetCategory: targetCat.name }),
      });
      qc.invalidateQueries({ queryKey: ["category-management"] });
      qc.invalidateQueries({ queryKey: ["cat-products"] });
      toast({ title: `Moved ${result.moved} product${result.moved !== 1 ? "s" : ""} to "${targetCat.name}"` });
      setSelectedProductIds(new Set());
    } catch (e: any) {
      toast({ title: "Failed to move products", description: e.message, variant: "destructive" });
    } finally { setMoving(false); }
  };

  const toggleProduct = (id: number) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedProductIds.size === sourceProducts.length) {
      setSelectedProductIds(new Set());
    } else {
      setSelectedProductIds(new Set(sourceProducts.map((p) => p.id)));
    }
  };

  const sourceCat = localCats.find((c) => String(c.id) === sourceCatId) ?? null;
  // Only categories with a wooId can be parent options (shop uses wooId for hierarchy)
  const parentOptions = localCats.filter((c) => c.wooId !== null);

  return (
    <Layout>
      <div className="flex flex-col space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/products")}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Products
            </button>
            <span className="text-muted-foreground">/</span>
            <div>
              <h1 className="text-2xl font-display font-bold text-foreground tracking-tight">Manage Categories</h1>
              <p className="text-sm text-muted-foreground mt-0.5">{localCats.length} categories</p>
            </div>
          </div>
          {orderDirty && (
            <Button onClick={saveOrder} disabled={savingOrder} className="shadow-lg shadow-primary/20">
              {savingOrder ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Save order
            </Button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-border -mb-2">
          {(["categories", "move"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
                activeTab === tab
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab === "categories"
                ? <><FolderTree className="w-4 h-4" /> Order &amp; Hierarchy</>
                : <><ArrowRight className="w-4 h-4" /> Move Products</>
              }
            </button>
          ))}
        </div>

        {/* ── Categories tab ─────────────────────────────────────────────────── */}
        {activeTab === "categories" && (
          <div className="space-y-3 pt-2">
            {isLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Drag rows to reorder · click a name to rename · use the Parent column to nest categories.
                  Changes to order require clicking <strong>Save order</strong>.
                </p>

                {/* Hidden file input for image uploads */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadFile(file);
                    e.target.value = "";
                  }}
                />

                <div className="rounded-xl border border-border overflow-hidden bg-card shadow-sm">
                  {/* Column headers */}
                  <div className="grid gap-x-3 items-center px-3 py-2 bg-muted/40 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wide"
                    style={{ gridTemplateColumns: "44px 32px 1fr 190px 72px 36px" }}>
                    <span>Image</span>
                    <span />
                    <span>Name</span>
                    <span>Parent</span>
                    <span className="text-center">Products</span>
                    <span />
                  </div>

                  {localCats.map((cat, idx) => (
                    <div
                      key={cat.id}
                      draggable
                      onDragStart={() => onDragStart(idx)}
                      onDragEnter={() => onDragEnter(idx)}
                      onDragEnd={onDragEnd}
                      onDragOver={(e) => e.preventDefault()}
                      className={cn(
                        "grid gap-x-3 items-center px-3 py-2 border-b border-border/50 last:border-b-0 transition-colors group",
                        dragOverIdx === idx && dragItem.current !== null && dragItem.current !== idx
                          ? "bg-primary/5 border-t-2 border-t-primary"
                          : "hover:bg-muted/20"
                      )}
                      style={{ gridTemplateColumns: "44px 32px 1fr 190px 72px 36px" }}
                    >
                      {/* Image thumbnail — click to upload */}
                      <button
                        type="button"
                        onClick={() => triggerImageUpload(cat)}
                        disabled={uploadingId === cat.id}
                        className="relative w-10 h-10 rounded-lg overflow-hidden border border-border/60 bg-muted shrink-0 hover:border-primary/60 transition-colors group/img"
                        title="Click to upload image"
                      >
                        {uploadingId === cat.id ? (
                          <div className="absolute inset-0 flex items-center justify-center bg-muted">
                            <Loader2 className="w-4 h-4 animate-spin text-primary" />
                          </div>
                        ) : cat.imageUrl ? (
                          <>
                            <img
                              src={cat.imageUrl}
                              alt={cat.name}
                              className="w-full h-full object-cover"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/40 transition-colors flex items-center justify-center">
                              <Camera className="w-3.5 h-3.5 text-white opacity-0 group-hover/img:opacity-100 transition-opacity" />
                            </div>
                          </>
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Camera className="w-4 h-4 text-muted-foreground/40 group-hover/img:text-primary transition-colors" />
                          </div>
                        )}
                      </button>

                      {/* Drag handle */}
                      <GripVertical className="w-4 h-4 text-muted-foreground/30 cursor-grab active:cursor-grabbing group-hover:text-muted-foreground/60 transition-colors" />

                      {/* Name — click to edit */}
                      {editingId === cat.id ? (
                        <input
                          autoFocus
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={() => saveRename(cat.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveRename(cat.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="border border-primary rounded-md px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      ) : (
                        <button
                          onClick={() => startEdit(cat)}
                          className="text-sm font-medium text-left hover:text-primary transition-colors truncate pr-2 rounded"
                          title="Click to rename"
                        >
                          {cat.name}
                        </button>
                      )}

                      {/* Parent dropdown */}
                      <Select
                        value={cat.parentWooId !== null ? String(cat.parentWooId) : "none"}
                        onValueChange={(v) => setParent(cat, v)}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="Top level" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— Top level —</SelectItem>
                          {parentOptions
                            .filter((p) => p.id !== cat.id && p.wooId !== cat.wooId)
                            .map((p) => (
                              <SelectItem key={p.id} value={String(p.wooId!)}>
                                {p.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>

                      {/* Product count */}
                      <span className={cn(
                        "text-xs text-center font-medium",
                        cat.productCount === 0 ? "text-muted-foreground/50" : "text-foreground"
                      )}>
                        {cat.productCount}
                      </span>

                      {/* Delete */}
                      <button
                        onClick={() => deleteCategory(cat)}
                        disabled={cat.productCount > 0}
                        title={cat.productCount > 0 ? `Move the ${cat.productCount} product(s) before deleting` : `Delete "${cat.name}"`}
                        className="p-1 rounded text-muted-foreground/30 hover:text-red-500 hover:bg-red-50 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* New category form */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Input
                    placeholder="New category name…"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") createCategory(); }}
                    className="max-w-xs"
                  />
                  <Select value={newParentWooId} onValueChange={setNewParentWooId}>
                    <SelectTrigger className="w-44">
                      <SelectValue placeholder="— Top level —" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Top level —</SelectItem>
                      {parentOptions.map((p) => (
                        <SelectItem key={p.id} value={String(p.wooId!)}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={createCategory} disabled={!newName.trim() || creating} variant="outline">
                    {creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                    Add category
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Move Products tab ───────────────────────────────────────────────── */}
        {activeTab === "move" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
            {/* Left: source category + product list */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold">From category</Label>
              <Select value={sourceCatId} onValueChange={(v) => { setSourceCatId(v); setTargetCatId("none"); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a category…" />
                </SelectTrigger>
                <SelectContent>
                  {localCats.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name} ({c.productCount})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {sourceCatId !== "none" && (
                <div className="rounded-xl border border-border overflow-hidden bg-card shadow-sm">
                  <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border">
                    <span className="text-xs font-medium text-muted-foreground">
                      {productsLoading
                        ? "Loading…"
                        : `${sourceProducts.length} product${sourceProducts.length !== 1 ? "s" : ""}${selectedProductIds.size > 0 ? ` · ${selectedProductIds.size} selected` : ""}`
                      }
                    </span>
                    {sourceProducts.length > 0 && (
                      <button onClick={toggleAll} className="text-xs text-primary hover:underline">
                        {selectedProductIds.size === sourceProducts.length ? "Deselect all" : "Select all"}
                      </button>
                    )}
                  </div>

                  {productsLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin text-primary" />
                    </div>
                  ) : sourceProducts.length === 0 ? (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      No products in this category
                    </div>
                  ) : (
                    <div className="max-h-96 overflow-y-auto divide-y divide-border/50">
                      {sourceProducts.map((p) => (
                        <label
                          key={p.id}
                          className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={selectedProductIds.has(p.id)}
                            onChange={() => toggleProduct(p.id)}
                            className="rounded border-input shrink-0"
                          />
                          {p.image_url ? (
                            <img
                              src={p.image_url}
                              alt={p.name}
                              className="w-9 h-9 rounded object-cover shrink-0 bg-muted"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded bg-muted flex items-center justify-center shrink-0">
                              <Package className="w-4 h-4 text-muted-foreground/30" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{p.name}</p>
                            {p.sku && <p className="text-xs text-muted-foreground">{p.sku}</p>}
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right: target + action */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold">To category</Label>
              <Select
                value={targetCatId}
                onValueChange={setTargetCatId}
                disabled={sourceCatId === "none"}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a category…" />
                </SelectTrigger>
                <SelectContent>
                  {localCats
                    .filter((c) => String(c.id) !== sourceCatId)
                    .map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name} ({c.productCount})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>

              {selectedProductIds.size > 0 && targetCatId !== "none" && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
                  <p className="text-sm text-foreground">
                    Move{" "}
                    <strong>{selectedProductIds.size} product{selectedProductIds.size !== 1 ? "s" : ""}</strong>{" "}
                    from <strong>{sourceCat?.name}</strong> to{" "}
                    <strong>{localCats.find((c) => String(c.id) === targetCatId)?.name}</strong>?
                  </p>
                  <Button onClick={moveProducts} disabled={moving} className="w-full">
                    {moving
                      ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      : <ArrowRight className="w-4 h-4 mr-2" />
                    }
                    Move {selectedProductIds.size} product{selectedProductIds.size !== 1 ? "s" : ""}
                  </Button>
                </div>
              )}

              {sourceCatId === "none" && (
                <p className="text-sm text-muted-foreground pt-2">
                  Choose a source category on the left to get started.
                </p>
              )}
              {sourceCatId !== "none" && selectedProductIds.size === 0 && (
                <p className="text-sm text-muted-foreground pt-2">
                  Select products on the left, then pick a target category here.
                </p>
              )}
              {sourceCatId !== "none" && selectedProductIds.size > 0 && targetCatId === "none" && (
                <p className="text-sm text-muted-foreground pt-2">
                  Now pick a target category above to move the selected products.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
