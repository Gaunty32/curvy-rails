import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient as _useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useUpload } from "@workspace/object-storage-web";
import Layout from "@/components/Layout";
import { UploadedImage } from "@/components/UploadedImage";
import { KitDesignerText } from "@/components/KitDesignerText";
import {
  useListSuppliers,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  getListProductsQueryKey,
  Product,
  Supplier
} from "@workspace/api-client-react";
import { useListCustomers } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { formatCurrency } from "@/lib/utils";
import { usePriceConfirm } from "@/components/PriceConfirmDialog";
import { ProductCategoryMultiSelect } from "@/components/ProductCategoryMultiSelect";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Edit2, Trash2, PackageSearch, Package, Loader2, ArrowLeft, ImageOff, Globe, Lock, Upload, X, Copy, Wand2, BarChart2, TrendingUp, Wrench, Archive, ArchiveRestore, AlertTriangle, ImageOff as NoImageIcon, BellOff, FolderTree } from "lucide-react";
import { cn } from "@/lib/utils";

const UNCATEGORISED = "Uncategorised";

interface ProductAnalytics {
  id: number;
  sku: string;
  name: string;
  supplierName: string | null;
  price: number;
  supplierCost: number | null;
  supplierCurrency: string;
  grossProfitPct: number | null;
  qtySold: number;
  revenue: number;
}

interface ProductCategory {
  id: number;
  wooId: number | null;
  name: string;
  slug: string | null;
  imageUrl: string | null;
  productCount: number;
  parentWooId: number | null;
}

type ProductWithCategory = Product & {
  category?: string | null;
  wooCategoryIds?: number[] | null;
  product_category_ids?: number[] | null;
};

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function Products() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [selectedTopCat, setSelectedTopCat] = useState<ProductCategory | null>(null);
  const [selectedSubCat, setSelectedSubCat] = useState<ProductCategory | null>(null);
  const [websiteFilter, setWebsiteFilter] = useState<"all" | "website" | "internal" | "bespoke" | "service" | "archived">("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductWithCategory | null>(null);
  const [customerComboOpen, setCustomerComboOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"catalogue" | "issues" | "sales">("catalogue");
  const [salesDateFrom, setSalesDateFrom] = useState("");
  const [salesDateTo, setSalesDateTo] = useState("");
  const [salesSearch, setSalesSearch] = useState("");

  const [formData, setFormData] = useState({
    name: "", sku: "", category: "", wooCategoryIds: [] as number[], description: "", unitPrice: 0, stockQuantity: 0,
    supplierId: "none", supplierCode: "", supplierPrice: "", imageUrl: "",
    customerId: "none" as string, supplierCurrency: "GBP",
    isService: false,
    websiteStatus: "draft" as "draft" | "publish",
  });
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const { uploadFile, isUploading: isImageUploading } = useUpload({
    onSuccess: (res) => {
      setFormData((f) => ({ ...f, imageUrl: `/api/storage${res.objectPath}` }));
      setImageUploadError(null);
      toast({ title: "Image uploaded", description: "Save Product to keep it with this item." });
    },
    onError: (error) => {
      setImageUploadError(error.message);
      toast({ title: "Image upload failed", description: error.message, variant: "destructive" });
    },
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { confirmIfNotWhole, dialog: priceConfirmDialog } = usePriceConfirm();

  const isArchivedTab = websiteFilter === "archived";
  const { data: products, isLoading: productsLoading } = useQuery<ProductWithCategory[]>({
    queryKey: isArchivedTab
      ? [...getListProductsQueryKey({ search }), { include_archived: true }]
      : getListProductsQueryKey({ search }),
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (isArchivedTab) params.set("include_archived", "true");
      return apiFetch(`/products?${params}`);
    },
  });
  const { data: suppliers = [] } = useListSuppliers();
  const { data: customers = [] } = useListCustomers();
  const { data: storedCategories = [], isLoading: categoriesLoading } = useQuery<ProductCategory[]>({
    queryKey: ["product-categories"],
    queryFn: () => apiFetch("/product-categories"),
  });
  const { data: analyticsData = [], isLoading: analyticsLoading } = useQuery<ProductAnalytics[]>({
    queryKey: ["product-analytics", salesDateFrom, salesDateTo],
    queryFn: () => {
      const params = new URLSearchParams();
      if (salesDateFrom) params.set("dateFrom", salesDateFrom);
      if (salesDateTo) params.set("dateTo", salesDateTo);
      const qs = params.toString();
      return apiFetch(`/products/analytics${qs ? `?${qs}` : ""}`);
    },
    enabled: viewMode === "sales",
  });
  type ProductIssue = { id: number; name: string; sku: string | null; imageUrl: string | null; supplierName: string | null; unitPrice: number | null; supplierPrice: number | null; gpPct: number | null; suggestedPrice: number | null; wooCommerceId: number | null; issueNoImage: boolean; issueLowGp: boolean; lastChecked: string | null };
  const { data: issuesData, isLoading: issuesLoading } = useQuery<{ products: ProductIssue[]; total: number; lastChecked: string | null }>({
    queryKey: ["product-issues"],
    queryFn: () => apiFetch("/products/issues"),
    enabled: viewMode === "issues",
    staleTime: 0,
  });
  const [snoozingId, setSnoozingId] = useState<number | null>(null);
  const snoozeMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/products/${id}/snooze-issue`, { method: "POST" })
        .then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? r.statusText); return r.json(); }),
    onMutate: (id) => setSnoozingId(id),
    onSettled: () => setSnoozingId(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product-issues"] });
      toast({ title: "Snoozed for 30 days", description: "This product won't appear in Issues until then." });
    },
    onError: () => toast({ title: "Failed to snooze", variant: "destructive" }),
  });
  const [updatingPublication, setUpdatingPublication] = useState<Record<number, boolean>>({});
  const websitePublicationMutation = useMutation({
    mutationFn: ({ id, published }: { id: number; published: boolean }) =>
      fetch(`/api/products/${id}/website-publication`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ published }),
      }).then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? r.statusText); return r.json(); }),
    onMutate: ({ id }) => setUpdatingPublication(p => ({ ...p, [id]: true })),
    onSettled: (_d, _e, { id }) => setUpdatingPublication(p => ({ ...p, [id]: false })),
    onSuccess: (_d, { published }) => {
      toast({ title: published ? "Published to shop" : "Removed from shop" });
      queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
    },
    onError: (e: any) => toast({ title: "Could not update website publication", description: e.message, variant: "destructive" }),
  });

  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();
  const deleteMutation = useDeleteProduct();

  const allProducts: ProductWithCategory[] = (products || []) as ProductWithCategory[];

  // ── Category hierarchy helpers ──────────────────────────────────────────────
  const subcategoriesOf = (parent: ProductCategory): ProductCategory[] =>
    storedCategories.filter((c) => c.parentWooId != null && c.parentWooId === parent.wooId);

  // All category names that "belong" to a top-level cat (itself + all descendants)
  function allNamesUnder(cat: ProductCategory): Set<string> {
    const names = new Set<string>([cat.name]);
    for (const sub of subcategoriesOf(cat)) {
      names.add(sub.name);
      for (const subsub of subcategoriesOf(sub)) names.add(subsub.name);
    }
    return names;
  }

  function allWooIdsUnder(cat: ProductCategory): Set<number> {
    const ids = new Set<number>();
    const visit = (category: ProductCategory) => {
      if (category.wooId != null) ids.add(Number(category.wooId));
      subcategoriesOf(category).forEach(visit);
    };
    visit(cat);
    return ids;
  }

  const productWooCategoryIds = (product: ProductWithCategory): number[] => {
    const raw = product.wooCategoryIds ?? product.product_category_ids;
    return Array.isArray(raw)
      ? raw.map(Number).filter((id) => Number.isInteger(id) && id > 0)
      : [];
  };

  const productMatchesCategory = (product: ProductWithCategory, category: ProductCategory): boolean => {
    const assignedIds = productWooCategoryIds(product);
    const includedIds = allWooIdsUnder(category);
    if (assignedIds.length > 0 && includedIds.size > 0) {
      return assignedIds.some((id) => includedIds.has(id));
    }
    return allNamesUnder(category).has(product.category ?? "");
  };

  // Top-level stored categories (no parent)
  const topLevelStored = storedCategories.filter((c) => !c.parentWooId);

  // Subcategories currently in scope (when a top cat is selected)
  const currentSubs = selectedTopCat ? subcategoriesOf(selectedTopCat) : [];

  // Names of all stored categories (to detect product-derived ones not in DB)
  const storedCatNames = new Set(storedCategories.map((c) => c.name));

  // Product-derived categories not in the WooCommerce DB (internal-only)
  const allProductCatNames = [...new Set(allProducts.map((p) => (p as any).category?.trim()).filter(Boolean))];
  const internalOnlyCatNames = allProductCatNames.filter((n) => !storedCatNames.has(n)).sort();

  // Static images for internal categories that have no WooCommerce image
  const internalCategoryImages: Record<string, string> = {
    "Bespoke Ties": "/images/bespoke-tie.png",
  };

  // Build top-level grid entries: WooCommerce top-level + internal-only
  type CatEntry = ProductCategory & { liveCount: number; isInternal: boolean };

  const topLevelEntries: CatEntry[] = [
    ...topLevelStored.map((cat) => ({
      ...cat,
      liveCount: allProducts.filter((product) => productMatchesCategory(product, cat)).length,
      isInternal: false,
    })),
    ...internalOnlyCatNames.map((name, i) => ({
      id: -(i + 1),
      wooId: null,
      name,
      slug: null,
      imageUrl: internalCategoryImages[name] ?? null,
      parentWooId: null,
      productCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      liveCount: allProducts.filter((p) => (p as any).category === name).length,
      isInternal: true,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  // Subcategory grid entries with live counts
  const subEntries: CatEntry[] = currentSubs.map((cat) => ({
    ...cat,
    liveCount: allProducts.filter((p) => (p as any).category === cat.name).length,
    isInternal: false,
  })).sort((a, b) => a.name.localeCompare(b.name));

  // ── Filtered product list ───────────────────────────────────────────────────
  const filteredProducts = allProducts
    // Step 1: separate archived from live
    .filter((p) => {
      const isArchived = !!(p as any).isArchived;
      if (websiteFilter === "archived") return isArchived;
      return !isArchived;
    })
    // Step 2: apply category navigation (skipped for archived tab)
    .filter((p) => {
      if (websiteFilter === "archived") return true;
      if (selectedSubCat) return productMatchesCategory(p, selectedSubCat);
      if (selectedTopCat) return productMatchesCategory(p, selectedTopCat);
      return true;
    })
    // Step 3: apply type filter
    .filter((p) => {
      if (websiteFilter === "archived") return true;
      if (websiteFilter === "service") return !!(p as any).isService;
      if (websiteFilter === "website") return (p as any).websitePublished === true && !(p as any).isService;
      if (websiteFilter === "internal") return (p as any).websitePublished !== true && !(p as any).isBespoke && !(p as any).isService;
      if (websiteFilter === "bespoke") return !!(p as any).isBespoke && !(p as any).isService;
      return true;
    });

  const openCreateDialog = () => {
    const defaultCat = selectedSubCat?.name ?? (selectedTopCat && currentSubs.length === 0 ? selectedTopCat.name : "");
    const defaultWooId = selectedSubCat?.wooId ?? (selectedTopCat && currentSubs.length === 0 ? selectedTopCat.wooId : null);
    setFormData({
      name: "", sku: "",
      category: defaultCat,
      wooCategoryIds: defaultWooId != null ? [Number(defaultWooId)] : [],
      description: "", unitPrice: 0, stockQuantity: 0,
      supplierId: "none", supplierCode: "", supplierPrice: "", imageUrl: "",
      customerId: "none", supplierCurrency: "GBP",
      isService: websiteFilter === "service",
      websiteStatus: "draft",
    });
    setImageUploadError(null);
    setIsCreateOpen(true);
  };

  const openEditDialog = (product: ProductWithCategory) => {
    const retainedIds = productWooCategoryIds(product);
    const legacyCategory = storedCategories.find(
      (category) => category.wooId != null
        && category.name.trim().toLowerCase() === (product.category ?? "").trim().toLowerCase(),
    );
    setFormData({
      name: product.name,
      sku: product.sku || "",
      category: (product as any).category || "",
      wooCategoryIds: retainedIds.length > 0
        ? retainedIds
        : legacyCategory?.wooId != null ? [Number(legacyCategory.wooId)] : [],
      description: product.description || "",
      unitPrice: product.unitPrice,
      stockQuantity: product.stockQuantity || 0,
      supplierId: product.supplierId ? String(product.supplierId) : "none",
      supplierCode: (product as any).supplierCode || "",
      supplierPrice: (product as any).supplierPrice != null ? String((product as any).supplierPrice) : "",
      imageUrl: (product as any).imageUrl || "",
      customerId: (product as any).customerId ? String((product as any).customerId) : "none",
      supplierCurrency: (product as any).supplierCurrency || "GBP",
      isService: (product as any).isService ?? false,
      websiteStatus: (product as any).websitePublished === true ? "publish" : "draft",
    });
    setImageUploadError(null);
    setEditingProduct(product);
  };

  const handleSave = async () => {
    if (isImageUploading) {
      toast({ title: "Image is still uploading", description: "Wait for the image preview before saving the product.", variant: "destructive" });
      return;
    }
    if (!formData.name || formData.unitPrice < 0) {
      toast({ title: "Validation Error", description: "Name and valid price are required", variant: "destructive" });
      return;
    }
    const priceOk = await confirmIfNotWhole(formData.unitPrice);
    if (!priceOk) return;
    if (!formData.isService && formData.customerId === "none" && websiteFilter === "bespoke") {
      toast({ title: "Customer required for bespoke product", description: "Select a customer in the Bespoke Assignment section, or change the filter to create a standard product.", variant: "destructive" });
      return;
    }
    const isService = formData.isService;
    const customerId = !isService && formData.customerId !== "none" ? Number(formData.customerId) : null;
    const payload = {
      ...formData,
      isService,
      category: isService ? null : (formData.category.trim() || null),
      wooCategoryIds: isService ? null : formData.wooCategoryIds,
      sku: isService ? null : (formData.sku || null),
      stockQuantity: isService ? 0 : formData.stockQuantity,
      supplierId: isService ? null : (formData.supplierId !== "none" ? Number(formData.supplierId) : null),
      supplierCode: isService ? null : (formData.supplierCode || null),
      supplierPrice: isService ? null : (formData.supplierPrice !== "" ? parseFloat(formData.supplierPrice) : null),
      imageUrl: formData.imageUrl || null,
      customerId,
      isBespoke: customerId != null,
      websiteStatus: !isService && customerId == null ? formData.websiteStatus : "draft",
      websitePublished: !isService && customerId == null && formData.websiteStatus === "publish",
    };
    if (editingProduct) {
      updateMutation.mutate({ id: editingProduct.id, data: payload as any }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
          toast({ title: "Product updated" });
          setEditingProduct(null);
        }
      });
    } else {
      createMutation.mutate({ data: payload as any }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
          toast({ title: "Product created" });
          setIsCreateOpen(false);
        }
      });
    }
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this product?")) {
      deleteMutation.mutate({ id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
          toast({ title: "Product deleted" });
        }
      });
    }
  };

  const handleDuplicate = async (id: number) => {
    try {
      const res = await fetch(`/api/products/${id}/duplicate`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const created = await res.json();
      queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
      toast({ title: "Product duplicated", description: `Created "${created.name}" (${created.sku || "no SKU"})` });
    } catch {
      toast({ title: "Duplicate failed", variant: "destructive" });
    }
  };

  const handleArchive = (id: number, archive: boolean) => {
    updateMutation.mutate({ id, data: { isArchived: archive } as any }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        toast({ title: archive ? "Product archived" : "Product restored" });
      },
    });
  };

  const autoFillBspSku = async () => {
    try {
      const res = await fetch(`/api/products/next-bsp-sku`);
      const data = await res.json();
      setFormData((f) => ({ ...f, sku: data.sku }));
    } catch {
      toast({ title: "Could not generate SKU", variant: "destructive" });
    }
  };

  const autoFillSku = async () => {
    try {
      const res = await fetch(`/api/products/next-sku`);
      const data = await res.json();
      setFormData((f) => ({ ...f, sku: data.sku }));
    } catch {
      toast({ title: "Could not generate SKU", variant: "destructive" });
    }
  };

  const isSearching = search.trim().length > 0;
  const showTopGrid = !isSearching && !selectedTopCat && websiteFilter === "all";
  const showSubGrid = !isSearching && !!selectedTopCat && currentSubs.length > 0 && !selectedSubCat && websiteFilter === "all";
  const showProductTable = !showTopGrid && !showSubGrid;

  // Breadcrumb helpers
  const activeCatTitle = selectedSubCat?.name ?? selectedTopCat?.name ?? "Products";
  const showBackToTop = !!selectedTopCat && !selectedSubCat;
  const showBackToSub = !!selectedSubCat;

  function CategoryGrid({ entries, onSelect }: { entries: (ProductCategory & { liveCount: number; isInternal: boolean })[]; onSelect: (c: ProductCategory & { liveCount: number; isInternal: boolean }) => void }) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {entries.map((cat) => (
          <button
            key={cat.id}
            onClick={() => onSelect(cat)}
            className="group relative rounded-xl overflow-hidden border border-border/60 bg-white shadow-sm hover:shadow-md hover:border-primary/40 transition-all duration-200 aspect-[4/3] text-left"
          >
            {cat.imageUrl ? (
              <img
                src={cat.imageUrl}
                alt={cat.name}
                className="absolute inset-0 w-full h-full object-contain p-3 transition-transform duration-300 group-hover:scale-105"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-muted/60 to-muted flex items-center justify-center">
                <ImageOff className="w-10 h-10 text-muted-foreground/30" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-3">
              <p className="text-white font-semibold text-sm leading-tight line-clamp-2 drop-shadow">{cat.name}</p>
              <p className="text-white/70 text-xs mt-0.5">{cat.liveCount} products</p>
            </div>
          </button>
        ))}
      </div>
    );
  }

  return (
    <Layout>
      <div className="flex flex-col space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            {/* Breadcrumb back navigation (catalogue mode only) */}
            {viewMode === "catalogue" && (showBackToTop || showBackToSub) && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <button
                  onClick={() => { setSelectedTopCat(null); setSelectedSubCat(null); }}
                  className="hover:text-foreground transition-colors"
                >All categories</button>
                {selectedTopCat && (
                  <>
                    <span className="mx-1">/</span>
                    {selectedSubCat ? (
                      <button
                        onClick={() => setSelectedSubCat(null)}
                        className="hover:text-foreground transition-colors"
                      >{selectedTopCat.name}</button>
                    ) : (
                      <span className="text-foreground font-medium">{selectedTopCat.name}</span>
                    )}
                  </>
                )}
                {selectedSubCat && (
                  <>
                    <span className="mx-1">/</span>
                    <span className="text-foreground font-medium">{selectedSubCat.name}</span>
                  </>
                )}
              </div>
            )}
            {(viewMode === "sales" || !selectedTopCat) && (
              <div>
                <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Products</h1>
                <p className="text-muted-foreground mt-1">
                  {viewMode === "sales"
                    ? `${analyticsData.length} product${analyticsData.length !== 1 ? "s" : ""} · sales analytics`
                    : `${allProducts.length} product${allProducts.length !== 1 ? "s" : ""} across ${topLevelEntries.length} categor${topLevelEntries.length !== 1 ? "ies" : "y"}`}
                </p>
              </div>
            )}
            {viewMode === "catalogue" && selectedTopCat && !selectedSubCat && currentSubs.length === 0 && (
              <div>
                <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">{selectedTopCat.name}</h1>
                <p className="text-muted-foreground mt-1">{filteredProducts.length} product{filteredProducts.length !== 1 ? "s" : ""}</p>
              </div>
            )}
            {viewMode === "catalogue" && selectedSubCat && (
              <div>
                <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">{selectedSubCat.name}</h1>
                <p className="text-muted-foreground mt-1">{filteredProducts.length} product{filteredProducts.length !== 1 ? "s" : ""}</p>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <div className="flex items-center rounded-lg border border-border bg-muted/30 p-0.5 gap-0.5">
              <button
                onClick={() => setViewMode("catalogue")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  viewMode === "catalogue" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Package className="w-3 h-3" /> Catalogue
              </button>
              <button
                onClick={() => setViewMode("issues")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  viewMode === "issues" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <AlertTriangle className="w-3 h-3 text-amber-500" />
                Issues
                {issuesData && issuesData.total > 0 && (
                  <span className="ml-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold px-1.5 py-0 leading-4">{issuesData.total}</span>
                )}
              </button>
              <button
                onClick={() => setViewMode("sales")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  viewMode === "sales" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <BarChart2 className="w-3 h-3" /> Sales
              </button>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-medium text-muted-foreground/70">GP%</span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-50 text-green-700 font-medium">&#9679; ≥80%</span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium">&#9679; ≥60%</span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-medium">&#9679; &lt;60%</span>
            </div>
            {viewMode === "catalogue" && (
              <>
                <Button onClick={() => navigate("/categories")} variant="outline" className="hidden sm:flex">
                  <FolderTree className="w-4 h-4 mr-2" /> Manage Categories
                </Button>
                <Button onClick={openCreateDialog} className="shadow-lg shadow-primary/20 transition-all hover:shadow-primary/30">
                  <Plus className="w-4 h-4 mr-2" /> Add Product
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Search + filter bar */}
        {viewMode === "catalogue" ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative max-w-sm flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search name, SKU, supplier code..."
                className="pl-9 bg-background"
                value={search}
                onChange={(e) => { setSearch(e.target.value); }}
              />
            </div>
            {/* Website / Internal / Bespoke filter */}
            <div className="flex items-center rounded-lg border border-border bg-muted/30 p-0.5 gap-0.5">
              {(["all", "website", "internal", "bespoke", "service", "archived"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => { setWebsiteFilter(f); setSelectedTopCat(null); setSelectedSubCat(null); }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    websiteFilter === f
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {f === "website" && <Globe className="w-3 h-3" />}
                  {f === "internal" && <Lock className="w-3 h-3" />}
                  {f === "bespoke" && <Package className="w-3 h-3" />}
                  {f === "service" && <Wrench className="w-3 h-3" />}
                  {f === "archived" && <Archive className="w-3 h-3" />}
                  {f === "all" ? "All" : f === "website" ? "Website" : f === "internal" ? "Internal only" : f === "bespoke" ? "Bespoke" : f === "service" ? "Services" : "Archived"}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Sales view filter bar */
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search SKU, name, supplier..."
                className="pl-9 bg-background"
                value={salesSearch}
                onChange={(e) => setSalesSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="text-xs font-medium">From</span>
              <Input type="date" className="w-36 bg-background text-sm" value={salesDateFrom} onChange={(e) => setSalesDateFrom(e.target.value)} />
              <span className="text-xs font-medium">To</span>
              <Input type="date" className="w-36 bg-background text-sm" value={salesDateTo} onChange={(e) => setSalesDateTo(e.target.value)} />
              {(salesDateFrom || salesDateTo) && (
                <button onClick={() => { setSalesDateFrom(""); setSalesDateTo(""); }} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {viewMode === "issues" ? (
          /* ── Issues view ── */
          issuesLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : !issuesData || issuesData.products.length === 0 ? (
            <div className="py-20 text-center text-muted-foreground">
              <AlertTriangle className="w-14 h-14 mx-auto mb-4 text-green-400" />
              <h3 className="text-lg font-medium text-foreground">No issues found</h3>
              <p className="mt-1 text-sm">All active products have images and meet the 80% GP threshold.</p>
              {issuesData?.lastChecked && (
                <p className="mt-2 text-xs text-muted-foreground/60">Last checked {new Date(issuesData.lastChecked).toLocaleString("en-GB")}</p>
              )}
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">{issuesData.total}</span> product{issuesData.total !== 1 ? "s" : ""} need attention
                </p>
                {issuesData.lastChecked && (
                  <p className="text-xs text-muted-foreground/60">Checked weekly · last {new Date(issuesData.lastChecked).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                )}
              </div>
              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="w-12"></TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="hidden sm:table-cell">SKU</TableHead>
                      <TableHead className="hidden md:table-cell">Supplier</TableHead>
                      <TableHead className="text-right">Sell price</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right w-20">GP%</TableHead>
                      <TableHead className="w-24">Issues</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {issuesData.products.map(p => (
                      <TableRow
                        key={p.id}
                        className="cursor-pointer hover:bg-muted/40 transition-colors"
                        onClick={() => navigate(`/products/${p.id}`)}
                      >
                        <TableCell className="p-2">
                          {p.imageUrl ? (
                            <img src={p.imageUrl} alt={p.name} className="w-9 h-9 rounded object-cover border border-border" />
                          ) : (
                            <div className="w-9 h-9 rounded border border-dashed border-red-300 bg-red-50 flex items-center justify-center">
                              <ImageOff className="w-4 h-4 text-red-400" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="hidden sm:table-cell font-mono text-xs text-muted-foreground">{p.sku ?? "—"}</TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{p.supplierName ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{p.unitPrice != null ? formatCurrency(p.unitPrice) : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{p.supplierPrice != null ? formatCurrency(p.supplierPrice) : "—"}</TableCell>
                        <TableCell className="text-right">
                          {p.gpPct != null ? (
                            <span className={cn(
                              "text-xs font-semibold px-1.5 py-0.5 rounded tabular-nums",
                              p.gpPct >= 80 ? "bg-green-50 text-green-700" :
                              p.gpPct >= 60 ? "bg-amber-50 text-amber-700" :
                              "bg-red-50 text-red-600"
                            )}>{p.gpPct.toFixed(1)}%</span>
                          ) : <span className="text-xs text-muted-foreground/50">—</span>}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {p.issueNoImage && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200">
                                <ImageOff className="w-2.5 h-2.5" />No image
                              </span>
                            )}
                            {p.issueLowGp && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">
                                <TrendingUp className="w-2.5 h-2.5" />Low GP
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            title="Snooze this issue for 30 days"
                            disabled={snoozingId === p.id}
                            onClick={() => snoozeMutation.mutate(p.id)}
                          >
                            {snoozingId === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BellOff className="w-3.5 h-3.5" />}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )
        ) : viewMode === "sales" ? (
          /* ── Sales analytics view ── */
          analyticsLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <SalesAnalyticsTable data={analyticsData} search={salesSearch} onNavigate={(id) => navigate(`/products/${id}`)} />
          )
        ) : productsLoading || (showTopGrid && categoriesLoading) ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : showTopGrid ? (
          /* ── Top-level category grid ── */
          topLevelEntries.length === 0 ? (
            <div className="py-20 text-center text-muted-foreground">
              <PackageSearch className="w-16 h-16 mx-auto mb-4 text-muted-foreground/40" />
              <h3 className="text-lg font-medium text-foreground">No products yet</h3>
              <p className="mt-1">Add your first product or run a WooCommerce sync.</p>
              <Button onClick={openCreateDialog} variant="outline" className="mt-6">Add Product</Button>
            </div>
          ) : (
            <CategoryGrid
              entries={topLevelEntries}
              onSelect={(cat) => {
                setSelectedTopCat(cat);
                setSelectedSubCat(null);
              }}
            />
          )
        ) : showSubGrid ? (
          /* ── Subcategory grid ── */
          <CategoryGrid
            entries={subEntries}
            onSelect={(cat) => setSelectedSubCat(cat)}
          />
        ) : (
          /* ── Product table ── */
          filteredProducts.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground border rounded-xl bg-card">
              <PackageSearch className="w-16 h-16 mx-auto mb-4 text-muted-foreground/40" />
              <h3 className="text-lg font-medium text-foreground">No products found</h3>
              <Button onClick={openCreateDialog} variant="outline" className="mt-6">Add Product</Button>
            </div>
          ) : (
            <div className="border rounded-xl overflow-hidden bg-card shadow-sm">
              <ProductTable
                products={filteredProducts}
                onEdit={openEditDialog}
                onDelete={handleDelete}
                onDuplicate={handleDuplicate}
                onArchive={handleArchive}
                onNavigate={(id) => navigate(`/products/${id}`)}
                onToggleWebsite={(id, published) => websitePublicationMutation.mutate({ id, published })}
                updatingPublication={updatingPublication}
              />
            </div>
          )
        )}
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={isCreateOpen || !!editingProduct} onOpenChange={(open) => {
        if (!open) { setIsCreateOpen(false); setEditingProduct(null); }
      }}>
        <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {editingProduct ? "Edit Product" : "Add New Product"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {/* ── Product Name ── */}
            <div className="grid gap-2">
              <Label htmlFor="name">Product Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
                placeholder={formData.isService ? "e.g. Logo Conversion to Stitches" : "e.g. Premium Polo Shirt"}
              />
            </div>

            {/* ── SKU + Categories (physical only) ── */}
            {!formData.isService && (
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="sku">SKU</Label>
                  <div className="flex gap-2">
                    <Input id="sku" value={formData.sku} onChange={(e) => setFormData((f) => ({ ...f, sku: e.target.value }))} placeholder="e.g. SKU0001" className="flex-1" />
                    {formData.customerId === "none" && (
                      <Button type="button" variant="outline" size="sm" onClick={autoFillSku} className="gap-1.5 text-xs whitespace-nowrap text-blue-700 border-blue-200 hover:bg-blue-50">
                        <Wand2 className="w-3.5 h-3.5" /> Suggest SKU
                      </Button>
                    )}
                    {formData.customerId !== "none" && (
                      <Button type="button" variant="outline" size="sm" onClick={autoFillBspSku} className="gap-1.5 text-xs whitespace-nowrap text-purple-700 border-purple-200 hover:bg-purple-50">
                        <Wand2 className="w-3.5 h-3.5" /> Auto BSP
                      </Button>
                    )}
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Categories</Label>
                  <ProductCategoryMultiSelect
                    categories={storedCategories}
                    selectedWooIds={formData.wooCategoryIds}
                    onChange={(wooCategoryIds) => setFormData((current) => {
                      const currentCategory = storedCategories.find(
                        (category) => category.wooId != null
                          && category.name.trim().toLowerCase() === current.category.trim().toLowerCase(),
                      );
                      const currentStillSelected = currentCategory?.wooId != null
                        && wooCategoryIds.includes(Number(currentCategory.wooId));
                      const firstSelected = storedCategories.find(
                        (category) => category.wooId != null && wooCategoryIds.includes(Number(category.wooId)),
                      );
                      const currentIsLocalOnly = current.category
                        && !storedCategories.some(
                          (category) => category.wooId != null
                            && category.name.trim().toLowerCase() === current.category.trim().toLowerCase(),
                        );
                      return {
                        ...current,
                        wooCategoryIds,
                        category: currentStillSelected
                          ? current.category
                          : firstSelected?.name ?? (currentIsLocalOnly ? current.category : ""),
                      };
                    })}
                  />
                  {formData.category && !storedCategories.some(
                    (category) => category.wooId != null
                      && category.name.trim().toLowerCase() === formData.category.trim().toLowerCase(),
                  ) && (
                    <div className="grid gap-1.5">
                      <Label htmlFor="internal-category" className="text-xs text-muted-foreground">Internal category</Label>
                      <Input
                        id="internal-category"
                        value={formData.category}
                        onChange={(event) => setFormData((current) => ({ ...current, category: event.target.value }))}
                        placeholder="Internal category name"
                      />
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    The product will appear in every selected website category.
                  </p>
                </div>
              </div>
            )}

            {/* ── Price + Stock ── */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="price">Unit Price (£) *</Label>
                <Input id="price" type="number" min="0" step="1" value={formData.unitPrice || ""} onChange={(e) => setFormData((f) => ({ ...f, unitPrice: parseFloat(e.target.value) || 0 }))} />
              </div>
              {!formData.isService && !editingProduct && (
                <div className="grid gap-2">
                  <Label htmlFor="stock">Stock Quantity</Label>
                  <Input id="stock" type="number" value={formData.stockQuantity || ""} onChange={(e) => setFormData((f) => ({ ...f, stockQuantity: parseInt(e.target.value, 10) || 0 }))} />
                </div>
              )}
            </div>

            {/* ── Description ── */}
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" className="resize-none" rows={3} value={formData.description} onChange={(e) => setFormData((f) => ({ ...f, description: e.target.value }))} />
            </div>

            {/* ── Product image ── */}
            <div className="grid gap-2">
              <Label>Product Image <span className="text-muted-foreground font-normal">(optional)</span></Label>
              {formData.imageUrl ? (
                <div className="flex items-start gap-3">
                  <UploadedImage
                    src={formData.imageUrl}
                    alt="Product"
                    className="w-20 h-20 object-cover rounded-lg border border-border/50 flex-shrink-0"
                    fallback={<div className="w-20 h-20 rounded-lg border border-border/50 bg-muted flex items-center justify-center flex-shrink-0"><ImageOff className="w-6 h-6 text-muted-foreground/40" /></div>}
                  />
                  <div className="flex flex-col gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={isImageUploading}
                      className="text-xs text-primary hover:underline disabled:opacity-50"
                    >
                      {isImageUploading ? "Uploading…" : "Replace image"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData((f) => ({ ...f, imageUrl: "" }))}
                      className="text-xs text-destructive hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={isImageUploading}
                  className="flex flex-col items-center justify-center gap-2 h-24 rounded-lg border-2 border-dashed border-border/60 hover:border-primary/40 hover:bg-muted/30 transition-colors disabled:opacity-50"
                >
                  {isImageUploading ? (
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  ) : (
                    <Upload className="w-5 h-5 text-muted-foreground" />
                  )}
                  <span className="text-xs text-muted-foreground">{isImageUploading ? "Uploading…" : "Click to upload product image"}</span>
                </button>
              )}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setImageUploadError(null);
                  await uploadFile(file);
                }}
              />
              {imageUploadError && (
                <p className="text-xs text-destructive">Upload failed: {imageUploadError}</p>
              )}
            </div>

            {/* ── Website visibility ── */}
            {!formData.isService && formData.customerId === "none" && (
              <div className="border-t border-border/40 pt-3 mt-1">
                <div className="grid gap-2">
                  <Label>Website availability</Label>
                  <Select
                    value={formData.websiteStatus}
                    onValueChange={(value: "draft" | "publish") =>
                      setFormData((f) => ({ ...f, websiteStatus: value }))
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Internal only — hide from website</SelectItem>
                      <SelectItem value="publish">Live on shop</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    This publishes directly to the configured shop. It does not send the product back to WordPress or WooCommerce.
                  </p>
                </div>
              </div>
            )}

            {/* ── Bespoke Assignment (physical only) ── */}
            {!formData.isService && (
              <div className="border-t border-border/40 pt-3 mt-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Bespoke Assignment</p>
                <div className="grid gap-2">
                  <Label>Assign to Customer (Bespoke)</Label>
                  <Popover open={customerComboOpen} onOpenChange={setCustomerComboOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={customerComboOpen}
                        className="w-full justify-between font-normal"
                      >
                        <span className="truncate">
                          {formData.customerId === "none"
                            ? "— Standard product (all customers) —"
                            : (customers as any[]).find((c: any) => String(c.id) === formData.customerId)?.name ?? "Unknown customer"}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search customers..." />
                        <CommandList>
                          <CommandEmpty>No customers found.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value="none"
                              onSelect={() => { setFormData((f) => ({ ...f, customerId: "none" })); setCustomerComboOpen(false); }}
                            >
                              <Check className={cn("mr-2 h-4 w-4", formData.customerId === "none" ? "opacity-100" : "opacity-0")} />
                              — Standard product (all customers) —
                            </CommandItem>
                            {(customers as any[]).map((c: any) => (
                              <CommandItem
                                key={c.id}
                                value={c.name}
                                onSelect={() => {
                                  setFormData((f) => ({ ...f, customerId: String(c.id), websiteStatus: "draft" }));
                                  setCustomerComboOpen(false);
                                }}
                              >
                                <Check className={cn("mr-2 h-4 w-4", formData.customerId === String(c.id) ? "opacity-100" : "opacity-0")} />
                                {c.name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {formData.customerId !== "none" && (
                    <p className="text-xs text-purple-600">This product will be marked bespoke and only visible to this customer on their portal.</p>
                  )}
                  {formData.customerId === "none" && websiteFilter === "bespoke" && (
                    <p className="text-xs text-amber-600 font-medium">⚠ You're on the Bespoke tab — select a customer above or this product will be saved as Internal only.</p>
                  )}
                </div>
              </div>
            )}

            {/* ── Supplier (physical only) ── */}
            {!formData.isService && (
              <div className="border-t border-border/40 pt-3 mt-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Supplier</p>
                <div className="grid gap-2 mb-3">
                  <Label>Preferred Supplier</Label>
                  <Select value={formData.supplierId} onValueChange={(v) => {
                    const sup = (suppliers as any[]).find((s: any) => String(s.id) === v);
                    setFormData((f) => ({ ...f, supplierId: v, supplierCurrency: sup?.currency ?? "GBP" }));
                  }}>
                    <SelectTrigger><SelectValue placeholder="— None —" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— None —</SelectItem>
                      {(suppliers as Supplier[]).map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Supplier Code</Label>
                    <Input value={formData.supplierCode} onChange={(e) => setFormData((f) => ({ ...f, supplierCode: e.target.value }))} placeholder="Supplier's code" />
                  </div>
                  <div className="grid gap-2">
                    <Label>Supplier Price ({formData.supplierCurrency === "USD" ? "$" : formData.supplierCurrency === "EUR" ? "€" : "£"})</Label>
                    <Input type="number" min="0" step="0.01" value={formData.supplierPrice} onChange={(e) => setFormData((f) => ({ ...f, supplierPrice: e.target.value }))} placeholder="0.00" />
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsCreateOpen(false); setEditingProduct(null); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save Product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {priceConfirmDialog}
    </Layout>
  );
}

function calcGp(product: ProductWithCategory): number | null {
  const sp = (product as any).supplierPrice;
  if (sp == null || sp <= 0 || product.unitPrice <= 0) return null;
  return ((product.unitPrice - sp) / product.unitPrice) * 100;
}

function GpBadge({ gp }: { gp: number }) {
  const color = gp >= 80 ? "text-green-700 bg-green-50 border-green-200"
              : gp >= 60 ? "text-amber-700 bg-amber-50 border-amber-200"
              : "text-red-700 bg-red-50 border-red-200";
  return (
    <span className={`inline-block text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded border ${color}`}>
      {gp.toFixed(0)}%
    </span>
  );
}

type SortCol = "name" | "price" | "stock" | "gp";
type SortDir = "asc" | "desc";

function ProductTable({
  products,
  onEdit,
  onDelete,
  onDuplicate,
  onArchive,
  onNavigate,
  onToggleWebsite,
  updatingPublication,
}: {
  products: ProductWithCategory[];
  onEdit: (p: ProductWithCategory) => void;
  onDelete: (id: number) => void;
  onDuplicate: (id: number) => void;
  onArchive: (id: number, archive: boolean) => void;
  onNavigate: (id: number) => void;
  onToggleWebsite: (id: number, published: boolean) => void;
  updatingPublication?: Record<number, boolean>;
}) {
  const [sort, setSort] = useState<{ col: SortCol; dir: SortDir } | null>(null);

  const toggleSort = (col: SortCol) => {
    setSort(s => s?.col === col ? (s.dir === "asc" ? { col, dir: "desc" } : null) : { col, dir: "asc" });
  };

  const sorted = [...products].sort((a, b) => {
    if (!sort) return 0;
    const dir = sort.dir === "asc" ? 1 : -1;
    switch (sort.col) {
      case "name":  return a.name.localeCompare(b.name) * dir;
      case "price": return ((a.unitPrice ?? 0) - (b.unitPrice ?? 0)) * dir;
      case "stock": return (((a.stockQuantity ?? -1)) - ((b.stockQuantity ?? -1))) * dir;
      case "gp": {
        const ga = calcGp(a) ?? -Infinity;
        const gb = calcGp(b) ?? -Infinity;
        return (ga - gb) * dir;
      }
    }
  });

  const SortHead = ({ col, children, className }: { col: SortCol; children: React.ReactNode; className?: string }) => (
    <TableHead className={className}>
      <button
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors select-none"
        onClick={() => toggleSort(col)}
      >
        {children}
        <span className="text-muted-foreground/60 text-[10px] w-3 text-center">
          {sort?.col === col ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </TableHead>
  );

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[48px]"></TableHead>
            <TableHead className="w-[100px]">SKU</TableHead>
            <SortHead col="name">Product Name</SortHead>
            <TableHead className="hidden md:table-cell">Description</TableHead>
            <SortHead col="price" className="text-right">Price</SortHead>
            <SortHead col="stock" className="text-right">Stock</SortHead>
            <SortHead col="gp" className="text-right w-[80px]">GP%</SortHead>
            <TableHead className="w-[100px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((product) => {
            const gp = calcGp(product);
            return (
              <TableRow
                key={product.id}
                className="group hover:bg-muted/30 cursor-pointer"
                onClick={() => onNavigate(product.id)}
              >
                <TableCell className="py-2 pl-4 pr-0">
                  {(product as any).imageUrl ? (
                    <UploadedImage src={(product as any).imageUrl} alt={product.name} className="w-9 h-9 rounded object-cover border border-border/50" fallback={<div className="w-9 h-9 rounded bg-muted border border-border/50 flex items-center justify-center"><Package className="w-4 h-4 text-muted-foreground/40" /></div>} />
                  ) : (
                    <div className="w-9 h-9 rounded bg-muted border border-border/50 flex items-center justify-center">
                      <Package className="w-4 h-4 text-muted-foreground/40" />
                    </div>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{product.sku || "—"}</TableCell>
                <TableCell className="font-medium text-foreground hover:text-primary transition-colors">
                  <div className="flex items-center gap-2 flex-wrap">
                    {product.name}
                    {(product as any).isArchived ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500 border border-zinc-200 flex-shrink-0">
                        <Archive className="w-2.5 h-2.5" /> Archived
                      </span>
                    ) : (product as any).isService ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 flex-shrink-0">
                        <Wrench className="w-2.5 h-2.5" /> Service
                      </span>
                    ) : (product as any).isBespoke ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 flex-shrink-0">
                        <Package className="w-2.5 h-2.5" /> Bespoke{(product as any).customerName ? ` · ${(product as any).customerName}` : ""}
                      </span>
                    ) : (product as any).websitePublished === true ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 flex-shrink-0">
                        <Globe className="w-2.5 h-2.5" /> Website
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border flex-shrink-0">
                        <Lock className="w-2.5 h-2.5" /> Internal
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm hidden md:table-cell max-w-[200px] truncate">
                  {product.description ? <KitDesignerText>{product.description}</KitDesignerText> : "—"}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatCurrency(product.unitPrice)}</TableCell>
                <TableCell className="text-right">
                  <span className={product.stockQuantity != null && product.stockQuantity <= 5 ? "text-red-600 font-bold" : ""}>
                    {product.stockQuantity ?? "—"}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {gp != null ? <GpBadge gp={gp} /> : <span className="text-xs text-muted-foreground/40">—</span>}
                </TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!(product as any).isArchived && !(product as any).isService && !(product as any).isBespoke && (
                      <div className="flex items-center gap-1 pr-1" title={(product as any).websitePublished ? "Published to shop" : "Hidden from shop"}>
                        <Globe className={cn("w-3.5 h-3.5", (product as any).websitePublished ? "text-blue-600" : "text-muted-foreground")} />
                        <Switch
                          checked={(product as any).websitePublished === true}
                          disabled={updatingPublication?.[product.id]}
                          onCheckedChange={(published) => onToggleWebsite(product.id, published)}
                          aria-label={`${(product as any).websitePublished ? "Unpublish" : "Publish"} ${product.name} on the shop`}
                          className="scale-90"
                        />
                      </div>
                    )}
                    {!(product as any).isArchived && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50" title="Duplicate product" onClick={() => onDuplicate(product.id)}>
                        <Copy className="w-4 h-4" />
                      </Button>
                    )}
                    {!(product as any).isArchived && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={() => onEdit(product)}>
                        <Edit2 className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn("h-8 w-8", (product as any).isArchived ? "text-green-600 hover:text-green-700 hover:bg-green-50" : "text-amber-600 hover:text-amber-700 hover:bg-amber-50")}
                      title={(product as any).isArchived ? "Restore product" : "Archive product"}
                      onClick={() => onArchive(product.id, !(product as any).isArchived)}
                    >
                      {(product as any).isArchived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                    </Button>
                    {!(product as any).isArchived && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => onDelete(product.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

type SalesSortCol = "sku" | "name" | "supplierName" | "price" | "supplierCost" | "grossProfitPct" | "qtySold" | "revenue";

function SalesAnalyticsTable({
  data,
  search,
  onNavigate,
}: {
  data: ProductAnalytics[];
  search: string;
  onNavigate: (id: number) => void;
}) {
  const [sort, setSort] = useState<{ col: SalesSortCol; dir: "asc" | "desc" }>({ col: "qtySold", dir: "desc" });
  const [colSearch, setColSearch] = useState<Partial<Record<SalesSortCol, string>>>({});

  const toggleSort = (col: SalesSortCol) => {
    setSort((s) => s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: col === "qtySold" || col === "revenue" ? "desc" : "asc" });
  };

  const SortHead = ({ col, children, className }: { col: SalesSortCol; children: React.ReactNode; className?: string }) => (
    <TableHead className={className}>
      <div className="flex flex-col gap-1">
        <button
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors select-none whitespace-nowrap"
          onClick={() => toggleSort(col)}
        >
          {children}
          <span className="text-muted-foreground/60 text-[10px] w-3 text-center">
            {sort.col === col ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}
          </span>
        </button>
        <input
          className="w-full text-[11px] border border-border/50 rounded px-1.5 py-0.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
          placeholder="Filter…"
          value={colSearch[col] ?? ""}
          onChange={(e) => setColSearch((p) => ({ ...p, [col]: e.target.value }))}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </TableHead>
  );

  const filtered = data
    .filter((r) => {
      if (search) {
        const q = search.toLowerCase();
        if (!r.sku.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q) && !(r.supplierName ?? "").toLowerCase().includes(q)) return false;
      }
      for (const [k, v] of Object.entries(colSearch)) {
        if (!v) continue;
        const val = String((r as any)[k] ?? "").toLowerCase();
        if (!val.includes(v.toLowerCase())) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      const va = (a as any)[sort.col] ?? (typeof (a as any)[sort.col] === "number" ? -Infinity : "");
      const vb = (b as any)[sort.col] ?? (typeof (b as any)[sort.col] === "number" ? -Infinity : "");
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });

  const currencySymbol = (cur: string) => cur === "USD" ? "$" : cur === "EUR" ? "€" : "£";

  const totals = filtered.reduce(
    (acc, r) => ({ qty: acc.qty + r.qtySold, rev: acc.rev + r.revenue }),
    { qty: 0, rev: 0 }
  );

  return (
    <div className="border rounded-xl overflow-hidden bg-card shadow-sm">
      {filtered.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">
          <TrendingUp className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
          <p className="font-medium text-foreground">No products match</p>
          <p className="text-sm mt-1">Try adjusting your search or date filter.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent align-top">
                <SortHead col="sku" className="w-[100px]">SKU</SortHead>
                <SortHead col="name">Product Name</SortHead>
                <SortHead col="supplierName" className="hidden md:table-cell">Supplier</SortHead>
                <SortHead col="price" className="text-right">Price</SortHead>
                <SortHead col="supplierCost" className="text-right hidden lg:table-cell">Supplier Cost</SortHead>
                <SortHead col="grossProfitPct" className="text-right w-[80px]">GP%</SortHead>
                <SortHead col="qtySold" className="text-right w-[90px]">Qty Sold</SortHead>
                <SortHead col="revenue" className="text-right w-[110px]">Revenue</SortHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow
                  key={r.id}
                  className="group hover:bg-muted/30 cursor-pointer"
                  onClick={() => onNavigate(r.id)}
                >
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.sku || "—"}</TableCell>
                  <TableCell className="font-medium text-foreground group-hover:text-primary transition-colors">{r.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground hidden md:table-cell">{r.supplierName ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{formatCurrency(r.price)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground hidden lg:table-cell">
                    {r.supplierCost != null
                      ? `${currencySymbol(r.supplierCurrency)}${r.supplierCost.toFixed(2)}`
                      : <span className="text-muted-foreground/40">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.grossProfitPct != null
                      ? <GpBadge gp={r.grossProfitPct} />
                      : <span className="text-xs text-muted-foreground/40">—</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.qtySold > 0
                      ? <span className="font-semibold text-foreground">{r.qtySold.toLocaleString()}</span>
                      : <span className="text-muted-foreground/40">0</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {r.revenue > 0
                      ? formatCurrency(r.revenue)
                      : <span className="text-muted-foreground/40">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {/* Footer totals */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/50 bg-muted/20 text-xs text-muted-foreground">
            <span>{filtered.length.toLocaleString()} product{filtered.length !== 1 ? "s" : ""}</span>
            <div className="flex items-center gap-6 font-medium">
              <span>Total sold: <span className="text-foreground">{totals.qty.toLocaleString()}</span></span>
              <span>Total revenue: <span className="text-foreground">{formatCurrency(totals.rev)}</span></span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
