import { useMemo, useState, useEffect } from 'react';
import { useWcProducts, useWcCategories } from '@/hooks/use-wc';
import { CategorySidebar } from '@/components/CategorySidebar';
import { ProductCard } from '@/components/ProductCard';
import { compareCategoryNames, formatCategoryName } from '@/lib/categoryName';
import { sortProducts, type ProductSort } from '@/lib/productSorting';
import { Link, useParams } from 'wouter';
import { Skeleton } from '@/components/ui/skeleton';
import { LayoutGrid } from 'lucide-react';
import { proxyImageUrl } from '@/lib/imageProxy';
import { track } from '@/lib/analytics';

function ChildCategoryCard({ category }: { category: any }) {
  const [imgError, setImgError] = useState(false);
  const categoryName = formatCategoryName(category.name);
  const imageUrl = proxyImageUrl(category.image);

  return (
    <Link href={`/category/${category.slug}`}>
      <div className="group flex h-full items-center gap-3 border border-gray-200 bg-white p-3 transition-colors hover:border-primary hover:bg-gray-50">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden bg-gray-50">
          {imageUrl && !imgError ? (
            <img
              src={imageUrl}
              alt=""
              onError={() => setImgError(true)}
              className="h-full w-full object-contain p-1 mix-blend-multiply transition-transform duration-300 group-hover:scale-105"
              width={128}
              height={128}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <LayoutGrid className="h-6 w-6 text-gray-300" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold uppercase tracking-wide text-gray-900 group-hover:text-primary">
            {categoryName}
          </p>
          <p className="mt-1 text-xs font-medium text-gray-500">
            {category.count} {category.count === 1 ? 'product' : 'products'}
          </p>
        </div>
      </div>
    </Link>
  );
}

export default function CategoryPage() {
  const { slug } = useParams();
  const { data: categories = [] } = useWcCategories();
  const { data: products = [], isLoading } = useWcProducts({ category_slug: slug, per_page: 100 });
  const [sort, setSort] = useState<ProductSort>('default');
  const sortedProducts = useMemo(() => sortProducts(products, sort), [products, sort]);
  const selectedCategory = categories.find((category: any) => category.slug === slug);
  useEffect(() => {
    if (selectedCategory?.id != null) {
      track('CATEGORY_VIEW', { categoryId: String(selectedCategory.id), _dedupeKey: `category:${selectedCategory.id}` });
    }
  }, [selectedCategory?.id]);
  const childCategories = useMemo(
    () => (categories as any[])
      .filter((category: any) =>
        selectedCategory &&
        Number(category.parent ?? 0) === Number(selectedCategory.id) &&
        Number(category.count ?? 0) > 0,
      )
      .sort(compareCategoryNames),
    [categories, selectedCategory],
  );

  const categoryName = formatCategoryName(
    categories.find((c: any) => c.slug === slug)?.name || slug?.replace(/-/g, ' ').toUpperCase(),
  );

  return (
    <div className="container mx-auto px-4 py-4 md:py-8 overflow-x-hidden">
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-2 text-[10px] md:text-xs text-gray-500 mb-4 md:mb-8 font-bold tracking-wider uppercase">
        <Link href="/" className="hover:text-primary transition-colors whitespace-nowrap">HOME</Link>
        <span className="text-gray-300">/</span>
        <Link href="/products" className="hover:text-primary transition-colors whitespace-nowrap">SHOP</Link>
        <span className="text-gray-300">/</span>
        <span className="text-gray-900 truncate max-w-[150px] md:max-w-none">{categoryName}</span>
      </div>

      <div className="flex flex-col md:flex-row gap-6 md:gap-8">
        {/* Sidebar — collapsible on mobile */}
        <div className="w-full md:w-[260px] shrink-0">
          <CategorySidebar activeSlug={slug} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl md:text-3xl font-extrabold text-primary mb-4 md:mb-6 uppercase tracking-tight">
            {categoryName}
          </h1>

          {childCategories.length > 0 && (
            <section className="mb-6 md:mb-8" aria-labelledby="child-category-heading">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 id="child-category-heading" className="text-sm font-extrabold uppercase tracking-widest text-gray-900">
                  Explore {categoryName}
                </h2>
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  WooCommerce categories
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {childCategories.map((category: any) => (
                  <ChildCategoryCard key={category.id} category={category} />
                ))}
              </div>
            </section>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 md:mb-6 pb-4 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-700">
              {products.length > 0 ? (
                <><span className="text-primary">{products.length}</span> product{products.length !== 1 ? 's' : ''}</>
              ) : '0 products'}
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

          {isLoading ? (
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
              <p className="text-sm text-gray-500">There are currently no products in this category.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
