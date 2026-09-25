import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import PortalLayout from "@/components/Layout";
import { apiFetch } from "@/lib/api";
import { usePublicConfig } from "@/lib/publicConfig";
import { formatCurrency } from "@/lib/utils";
import { sizeRank } from "@/lib/sizeUtils";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Loader2, Search, Package, ArrowLeft, Tag, ImageOff, X } from "lucide-react";
import { cn } from "@/lib/utils";

const UNCATEGORISED = "Uncategorised";


// ─── Colour → CSS colour ──────────────────────────────────────────────────────
const COLOUR_KEYWORDS: [string, string][] = [
  ["black",         "#111827"],
  ["white",         "#f3f4f6"],
  ["off white",     "#f5f0e8"],
  ["cream",         "#fef3c7"],
  ["navy",          "#1e3a5f"],
  ["royal",         "#2563eb"],
  ["sky blue",      "#38bdf8"],
  ["light blue",    "#93c5fd"],
  ["blue",          "#2563eb"],
  ["red",           "#dc2626"],
  ["burgundy",      "#7f1d1d"],
  ["maroon",        "#881337"],
  ["bottle green",  "#14532d"],
  ["forest green",  "#15803d"],
  ["kelly green",   "#16a34a"],
  ["green",         "#16a34a"],
  ["charcoal",      "#374151"],
  ["grey",          "#6b7280"],
  ["gray",          "#6b7280"],
  ["silver",        "#9ca3af"],
  ["yellow",        "#eab308"],
  ["gold",          "#d97706"],
  ["orange",        "#ea580c"],
  ["pink",          "#f472b6"],
  ["hot pink",      "#ec4899"],
  ["purple",        "#9333ea"],
  ["violet",        "#7c3aed"],
  ["khaki",         "#a16207"],
  ["tan",           "#d97706"],
  ["sand",          "#d4a373"],
  ["stone",         "#a8a29e"],
  ["brown",         "#78350f"],
  ["chocolate",     "#5c3d11"],
  ["teal",          "#0d9488"],
  ["turquoise",     "#14b8a6"],
  ["lime",          "#65a30d"],
];

function colourToHex(name: string): string {
  if (!name) return "#e5e7eb";
  const lower = name.toLowerCase();
  for (const [key, hex] of COLOUR_KEYWORDS) {
    if (lower.includes(key)) return hex;
  }
  // Hash-based deterministic fallback
  let hash = 0;
  for (let i = 0; i < lower.length; i++) hash = lower.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 45%, 42%)`;
}

function isLight(hex: string): boolean {
  if (!hex.startsWith("#")) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 200;
}

// ─── Types ───────────────────────────────────────────────────────────────────
type PortalProduct = {
  id: number;
  name: string;
  sku: string | null;
  unit_price: string | null;
  image_url: string | null;
  first_variant_image_url: string | null;
  category: string | null;
  description: string | null;
  variant_count: string;
  colours: string[] | null;
};

type ProductVariant = {
  id: number;
  colour: string | null;
  size: string | null;
  price: string | null;
  image_url: string | null;
};

type ProductCategory = {
  id: number;
  name: string;
  slug: string | null;
  imageUrl: string | null;
  productCount: number;
};

// ─── Colour swatch chip ───────────────────────────────────────────────────────
function ColourChip({ colour, size = "sm", active = false, imageUrl, onClick }: {
  colour: string;
  size?: "sm" | "lg";
  active?: boolean;
  imageUrl?: string | null;
  onClick?: () => void;
}) {
  const hex = colourToHex(colour);
  const dim = size === "lg" ? "w-9 h-9" : "w-4 h-4";
  return (
    <button
      title={colour}
      onClick={onClick}
      className={cn(
        "rounded-full border-2 transition-all shrink-0 overflow-hidden",
        dim,
        active ? "border-primary ring-2 ring-primary/30 scale-110" : "border-white/80 hover:scale-110 hover:border-primary/50",
        onClick ? "cursor-pointer" : "cursor-default"
      )}
      style={{ background: imageUrl ? undefined : hex }}
    >
      {imageUrl && (
        <img src={imageUrl} alt={colour} className="w-full h-full object-cover" />
      )}
    </button>
  );
}

// ─── Product detail modal ─────────────────────────────────────────────────────
function ProductModal({ product, onClose }: { product: PortalProduct; onClose: () => void }) {
  const { canSeePricing } = useAuth();
  const { data: variants = [], isLoading } = useQuery<ProductVariant[]>({
    queryKey: ["portal-product-variants", product.id],
    queryFn: () => apiFetch(`/portal/products/${product.id}/variants`),
  });

  // Group variants by colour
  const colourGroups = useMemo(() => {
    const map = new Map<string, ProductVariant[]>();
    for (const v of variants) {
      const key = v.colour ?? "—";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(v);
    }
    // Sort sizes within each group
    for (const [, vs] of map) vs.sort((a, b) => sizeRank(a.size) - sizeRank(b.size));
    return map;
  }, [variants]);

  const colours = Array.from(colourGroups.keys());
  const [selectedColour, setSelectedColour] = useState<string | null>(() =>
    colours.length > 0 ? colours[0] : null
  );

  // Update selected colour when variants load
  const resolvedColour = selectedColour ?? colours[0] ?? null;
  const currentVariants = resolvedColour ? (colourGroups.get(resolvedColour) ?? []) : [];

  // Find best image for current colour
  const colourImage = currentVariants.find(v => v.image_url)?.image_url ?? null;
  const displayImage = colourImage ?? product.image_url;

  // Unique sizes in the current colour group
  const sizes = currentVariants.map(v => v.size).filter((s): s is string => !!s);

  // Price: cheapest variant price or product price
  const variantPrices = variants.map(v => v.price ? parseFloat(v.price) : null).filter((p): p is number => p != null);
  const minPrice = variantPrices.length > 0 ? Math.min(...variantPrices) : null;
  const productPrice = product.unit_price ? parseFloat(product.unit_price) : null;
  const displayPrice = minPrice ?? productPrice;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl w-full p-0 overflow-hidden max-h-[90vh]">
        <div className="flex flex-col sm:flex-row h-full overflow-auto">
          {/* Image panel */}
          <div className="sm:w-2/5 bg-muted flex-shrink-0">
            {displayImage ? (
              <img
                key={displayImage}
                src={displayImage}
                alt={resolvedColour ?? product.name}
                className="w-full h-64 sm:h-full object-contain p-4"
              />
            ) : (
              <div className="w-full h-64 sm:h-full flex items-center justify-center">
                <Package className="w-16 h-16 text-muted-foreground/20" />
              </div>
            )}
          </div>

          {/* Detail panel */}
          <div className="flex-1 p-5 overflow-y-auto flex flex-col gap-4">
            {/* Close */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold leading-tight">{product.name}</h2>
                {product.sku && <p className="text-xs font-mono text-muted-foreground mt-0.5">{product.sku}</p>}
              </div>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Price */}
            {canSeePricing && (displayPrice != null ? (
              <p className="text-xl font-bold tabular-nums">
                {variantPrices.length > 1 ? "from " : ""}{formatCurrency(displayPrice)}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Price on application</p>
            ))}

            {/* Description */}
            {product.description && (
              <p className="text-sm text-muted-foreground leading-relaxed">{product.description}</p>
            )}

            {isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading variants…
              </div>
            ) : variants.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No variants configured for this product.</p>
            ) : (
              <>
                {/* Colour selector */}
                {colours.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      Colour {resolvedColour ? <span className="normal-case font-normal text-foreground">— {resolvedColour}</span> : null}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {colours.map((c) => {
                        const img = colourGroups.get(c)?.find(v => v.image_url)?.image_url ?? null;
                        return (
                          <div key={c} className="flex flex-col items-center gap-1">
                            <ColourChip
                              colour={c}
                              size="lg"
                              active={resolvedColour === c}
                              imageUrl={img}
                              onClick={() => setSelectedColour(c)}
                            />
                            <span className="text-[10px] text-muted-foreground leading-tight max-w-[40px] text-center truncate">{c}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Sizes */}
                {sizes.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      Available sizes
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {sizes.map((s) => (
                        <span
                          key={s}
                          className="rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* All colours × sizes table if multiple colours */}
                {colours.length > 1 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                      View all colour × size combinations
                    </summary>
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full border-collapse text-xs">
                        <thead>
                          <tr>
                            <th className="text-left py-1 pr-3 font-medium text-muted-foreground">Colour</th>
                            <th className="text-left py-1 font-medium text-muted-foreground">Sizes available</th>
                          </tr>
                        </thead>
                        <tbody>
                          {colours.map((c) => (
                            <tr key={c} className="border-t border-border/40">
                              <td className="py-1 pr-3 font-medium whitespace-nowrap">{c}</td>
                              <td className="py-1">
                                <div className="flex flex-wrap gap-1">
                                  {(colourGroups.get(c) ?? []).map(v => v.size).filter(Boolean).map((s) => (
                                    <span key={s} className="bg-muted rounded px-1.5 py-0.5">{s}</span>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Products() {
  const { data: publicConfig } = usePublicConfig();
  const { canSeePricing } = useAuth();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<PortalProduct | null>(null);

  const { data: products = [], isLoading: productsLoading } = useQuery<PortalProduct[]>({
    queryKey: ["portal-products"],
    queryFn: () => apiFetch("/portal/products"),
  });

  const { data: storedCategories = [] } = useQuery<ProductCategory[]>({
    queryKey: ["product-categories"],
    queryFn: () => apiFetch("/product-categories"),
  });

  // Derive categories from products, enriched with stored images
  const categories = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of products) {
      const cat = p.category?.trim() || UNCATEGORISED;
      map[cat] = (map[cat] ?? 0) + 1;
    }
    return Object.entries(map)
      .map(([name, count]) => {
        const stored = storedCategories.find(c => c.name === name);
        return { name, count, imageUrl: stored?.imageUrl ?? null };
      })
      .sort((a, b) => {
        if (a.name === UNCATEGORISED) return 1;
        if (b.name === UNCATEGORISED) return -1;
        return b.count - a.count;
      });
  }, [products, storedCategories]);

  const filteredProducts = useMemo(() => {
    let list = products;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.name?.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q) ||
        (p.colours ?? []).some(c => c.toLowerCase().includes(q))
      );
    } else if (selectedCategory) {
      list = list.filter(p =>
        selectedCategory === UNCATEGORISED ? !p.category?.trim() : p.category?.trim() === selectedCategory
      );
    }
    return list;
  }, [products, search, selectedCategory]);

  const isSearching = search.trim().length > 0;
  const showCategories = !isSearching && !selectedCategory;

  return (
    <PortalLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Products</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Browse our full range. See something you'd like?{" "}
          <a href={publicConfig?.email ? `mailto:${publicConfig.email}` : undefined} className="underline underline-offset-2 hover:text-foreground">
            Get in touch
          </a>{" "}
          or start a{" "}
          <a href="new-order" className="underline underline-offset-2 hover:text-foreground">
            Looking for Inspiration
          </a>{" "}
          enquiry.
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search products, categories or colours…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); if (e.target.value) setSelectedCategory(null); }}
        />
      </div>

      {productsLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : showCategories ? (
        /* ── Category image grid ── */
        <div>
          <p className="text-sm text-muted-foreground mb-4">
            {categories.length} categories · {products.length} products total
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {categories.map((cat) => (
              <button
                key={cat.name}
                onClick={() => setSelectedCategory(cat.name)}
                className="group relative rounded-xl overflow-hidden border border-border/60 bg-card shadow-sm hover:shadow-md hover:border-primary/40 transition-all duration-200 aspect-[4/3] text-left"
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
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-3">
                  <p className="text-white font-semibold text-sm leading-tight line-clamp-2 drop-shadow">{cat.name}</p>
                  <p className="text-white/70 text-xs mt-0.5">{cat.count} product{cat.count !== 1 ? "s" : ""}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* ── Product grid ── */
        <div>
          {/* Breadcrumb */}
          <div className="flex items-center gap-3 mb-4">
            {!isSearching && selectedCategory && (
              <Button variant="ghost" size="sm" className="gap-1.5 -ml-1" onClick={() => setSelectedCategory(null)}>
                <ArrowLeft className="w-4 h-4" /> All categories
              </Button>
            )}
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-base">
                {isSearching ? `Results for "${search}"` : selectedCategory}
              </h2>
              <Badge variant="secondary" className="text-xs">{filteredProducts.length}</Badge>
            </div>
          </div>

          {filteredProducts.length === 0 ? (
            <div className="py-20 text-center border rounded-xl bg-card">
              <Package className="w-14 h-14 mx-auto mb-4 text-muted-foreground/20" />
              <h2 className="text-lg font-semibold">No products found</h2>
              <p className="text-muted-foreground text-sm mt-1">Try a different search term</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredProducts.map((product) => {
                const colours = product.colours ?? [];
                const variantCount = Number(product.variant_count);
                return (
                  <Card
                    key={product.id}
                    className="overflow-hidden hover:border-primary/40 hover:shadow-md transition-all cursor-pointer group"
                    onClick={() => setSelectedProduct(product)}
                  >
                    {/* Image — prefer variant image over main product image */}
                    <div className="aspect-[4/3] bg-muted overflow-hidden relative">
                      {(product.first_variant_image_url ?? product.image_url) ? (
                        <img
                          src={product.first_variant_image_url ?? product.image_url!}
                          alt={product.name}
                          className="w-full h-full object-contain p-2 transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Package className="w-12 h-12 text-muted-foreground/20" />
                        </div>
                      )}
                      {/* Colour dot overlay */}
                      {colours.length > 0 && (
                        <div className="absolute bottom-2 left-2 flex gap-1 flex-wrap">
                          {colours.slice(0, 8).map((c) => (
                            <div
                              key={c}
                              title={c}
                              className="w-3.5 h-3.5 rounded-full border border-white/70 shadow-sm"
                              style={{ background: colourToHex(c) }}
                            />
                          ))}
                          {colours.length > 8 && (
                            <span className="text-[9px] text-white/80 bg-black/40 rounded-full px-1 leading-tight flex items-center">+{colours.length - 8}</span>
                          )}
                        </div>
                      )}
                    </div>

                    <CardContent className="p-3">
                      <p className="font-semibold text-sm leading-tight line-clamp-2">{product.name}</p>
                      {product.sku && <p className="text-xs text-muted-foreground font-mono mt-0.5">{product.sku}</p>}

                      <div className="flex items-center justify-between mt-2 gap-2">
                        {canSeePricing && (product.unit_price ? (
                          <span className="text-sm font-semibold tabular-nums">{formatCurrency(product.unit_price)}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">POA</span>
                        ))}
                        <div className="flex items-center gap-1.5">
                          {isSearching && product.category && (
                            <button
                              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                              onClick={(e) => { e.stopPropagation(); setSearch(""); setSelectedCategory(product.category); }}
                            >
                              <Tag className="w-3 h-3" /> {product.category}
                            </button>
                          )}
                          {variantCount > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {colours.length > 0 ? `${colours.length} colour${colours.length !== 1 ? "s" : ""}` : `${variantCount} variant${variantCount !== 1 ? "s" : ""}`}
                            </span>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {selectedProduct && (
        <ProductModal product={selectedProduct} onClose={() => setSelectedProduct(null)} />
      )}
    </PortalLayout>
  );
}
