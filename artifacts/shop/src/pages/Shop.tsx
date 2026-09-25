import { useMemo, useState } from 'react';
import { useWcProducts, useWcCategories } from '@/hooks/use-wc';
import { CategorySidebar } from '@/components/CategorySidebar';
import { ProductCard } from '@/components/ProductCard';
import { Link, useSearch } from 'wouter';
import { Skeleton } from '@/components/ui/skeleton';
import { proxyImageUrl } from '@/lib/imageProxy';
import { compareCategoryNames, formatCategoryName } from '@/lib/categoryName';
import { sortProducts, type ProductSort } from '@/lib/productSorting';
import { LayoutGrid } from 'lucide-react';

const NAVY = "#0f172a";

function CategoryTile({ category, priority = false }: { category: any; priority?: boolean }) {
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const categoryName = formatCategoryName(category.name);

  return (
    <Link href={`/category/${category.slug}`}>
      <div
        className="relative overflow-hidden cursor-pointer group"
        style={{ aspectRatio: "4/3", background: "#f8fafc" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Product image */}
        {category.image && !imgError ? (
          <img
            src={proxyImageUrl(category.image) ?? ''}
            alt={categoryName}
            onError={() => setImgError(true)}
            className="absolute inset-0 w-full h-full object-contain mix-blend-multiply transition-transform duration-700 ease-out"
            style={{ transform: hovered ? "scale(1.08)" : "scale(1)", padding: "12px" }}
            width={800}
            height={600}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-300">
            <LayoutGrid className="w-10 h-10 mb-2 opacity-40" />
          </div>
        )}

        {/* Permanent dark footer — always readable before hover */}
        <div
          className="absolute inset-0 transition-opacity duration-400"
          style={{
            background: "linear-gradient(to top, rgba(15,23,42,0.8) 0%, rgba(15,23,42,0.2) 40%, transparent 60%)",
            opacity: hovered ? 0 : 1,
          }}
        />

        {/* Brand-wash overlay — slides up from bottom on hover */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center transition-all duration-500 ease-out"
          style={{
            background: NAVY,
            opacity: hovered ? 0.95 : 0,
            transform: hovered ? "translateY(0)" : "translateY(6%)",
          }}
        >
          <span
            className="text-white font-extrabold tracking-widest uppercase text-center px-4 transition-all duration-500 leading-tight"
            style={{ fontSize: "clamp(0.85rem, 2.5vw, 1.2rem)", transform: hovered ? "translateY(0)" : "translateY(12px)", opacity: hovered ? 1 : 0 }}
          >
            {categoryName}
          </span>
          {/* Animated underline */}
          <div
            className="mt-3 bg-accent transition-all duration-500"
            style={{ height: 3, width: hovered ? 40 : 0, transitionDelay: hovered ? "100ms" : "0ms" }}
          />
          <span
            className="mt-4 text-white/80 text-[10px] md:text-xs font-bold tracking-widest uppercase transition-all duration-500"
            style={{ opacity: hovered ? 1 : 0, transform: hovered ? "translateY(0)" : "translateY(8px)", transitionDelay: hovered ? "160ms" : "0ms" }}
          >
            Explore Collection →
          </span>
        </div>

        {/* Default label — fades out on hover */}
        <div
          className="absolute bottom-0 left-0 right-0 px-3 md:px-4 pb-3 md:pb-4 transition-opacity duration-300"
          style={{ opacity: hovered ? 0 : 1 }}
        >
          <p className="text-white font-bold text-xs md:text-sm uppercase tracking-wide leading-tight drop-shadow-md">
            {categoryName}
          </p>
          <p className="text-white/80 font-medium text-[10px] md:text-xs mt-0.5 drop-shadow">
            {category.count} {category.count === 1 ? 'product' : 'products'}
          </p>
        </div>
      </div>
    </Link>
  );
}

function CategoryTileSkeleton() {
  return <Skeleton className="aspect-[4/3] w-full rounded-none" />;
}

export default function Shop() {
  const searchString = useSearch();
  const search = new URLSearchParams(searchString).get('search') || '';

  const { data: products = [], isLoading: productsLoading } = useWcProducts(
    search ? { search, per_page: 100 } : { per_page: 0 }
  );
  const { data: allCategories = [], isLoading: catsLoading } = useWcCategories();
  const [sort, setSort] = useState<ProductSort>('default');

  const showTiles = !search;
  const sortedProducts = useMemo(() => sortProducts(products, sort), [products, sort]);
  const topCategories = (allCategories as any[])
    .filter((c: any) => c.parent === 0 && c.count > 0)
    .sort(compareCategoryNames);

  return (
    <div className="container mx-auto px-4 py-4 md:py-8 overflow-x-hidden">
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-2 text-[10px] md:text-xs text-gray-500 mb-4 md:mb-8 font-bold tracking-wider uppercase">
        <Link href="/" className="hover:text-primary transition-colors whitespace-nowrap">HOME</Link>
        <span className="text-gray-300">/</span>
        <span className="text-gray-900 whitespace-nowrap">SHOP</span>
        {search && (
          <>
            <span className="text-gray-300">/</span>
            <span className="text-gray-900 truncate max-w-[150px] md:max-w-none">SEARCH: "{search}"</span>
          </>
        )}
      </div>

      {showTiles ? (
        /* ── Category tiles — no sidebar on mobile ── */
        <div className="animate-in fade-in duration-500">
          <div className="mb-6 md:mb-8 text-center md:text-left">
            <h1 className="text-2xl md:text-3xl font-extrabold text-primary mb-2 uppercase tracking-tight">Shop by Category</h1>
            <p className="text-sm md:text-base text-gray-500 font-medium">Browse our full range — select a category to explore.</p>
          </div>

          {catsLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-4">
              {[...Array(12)].map((_, i) => <CategoryTileSkeleton key={i} />)}
            </div>
          ) : topCategories.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-4">
              {topCategories.map((cat: any, index: number) => (
                <CategoryTile key={cat.id} category={cat} priority={index < 4} />
              ))}
            </div>
          ) : (
            <div className="py-16 text-center text-gray-400 font-medium">No categories found.</div>
          )}
        </div>
      ) : (
        /* ── Search results — sidebar + product grid ── */
        <div className="flex flex-col md:flex-row gap-6 md:gap-8">
          {/* Sidebar */}
          <div className="w-full md:w-[260px] shrink-0">
            <CategorySidebar />
          </div>

          {/* Results */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 md:mb-6 pb-4 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-700">
                {products.length > 0 ? (
                  <>
                    <span className="text-primary">{products.length}</span> result{products.length !== 1 ? 's' : ''}
                  </>
                ) : 'No results'}
                {search && <> for <span className="text-primary truncate">"{search}"</span></>}
              </p>

              <div className="flex items-center w-full sm:w-auto">
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as ProductSort)}
                  aria-label="Sort products"
                  className="w-full sm:w-auto border-2 border-gray-200 rounded-md py-2 px-3 text-xs md:text-sm font-semibold text-gray-700 focus:outline-none focus:border-primary transition-colors bg-white hover:bg-gray-50 cursor-pointer"
                >
                  <option value="default">Default sorting</option>
                  <option value="popularity">Sort by popularity</option>
                  <option value="latest">Sort by latest</option>
                  <option value="price-asc">Sort by price: low to high</option>
                  <option value="price-desc">Sort by price: high to low</option>
                </select>
              </div>
            </div>

            {productsLoading ? (
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-6">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="flex flex-col gap-2">
                    <Skeleton className="aspect-square w-full rounded-sm" />
                    <Skeleton className="h-4 w-3/4 mt-2" />
                    <Skeleton className="h-4 w-1/4" />
                  </div>
                ))}
              </div>
            ) : products.length > 0 ? (
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-6 animate-in fade-in duration-500 slide-in-from-bottom-4">
                {sortedProducts.map((p: any) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            ) : (
              <div className="py-20 text-center">
                <h3 className="text-lg font-bold text-gray-900 mb-2">No products found</h3>
                <p className="text-sm text-gray-500">Try adjusting your search terms.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
