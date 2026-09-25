import { useSEO } from '@/hooks/useSEO';
import { useWcProducts } from '@/hooks/use-wc';
import { proxyImageUrl } from '@/lib/imageProxy';
import { Link } from 'wouter';
import { Skeleton } from '@/components/ui/skeleton';
import { Package, Tag } from 'lucide-react';
import { useVAT } from '@/context/VATContext';
import { getBulkOffer } from '@/lib/priceBreaks';

interface BundleItem { qty: number; name: string }

function parseBundleItems(desc: string): BundleItem[] {
  const lower = desc.toLowerCase();
  const start = lower.search(/pack includes/);
  if (start === -1) return [];
  const after = desc.slice(start).replace(/^[^\n]*\n/, '');
  return after.split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .flatMap(line => {
      const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
      return m ? [{ qty: parseInt(m[1], 10), name: m[2].trim() }] : [];
    });
}

function BundleCard({ product }: { product: any }) {
  const { vatPrice, vatLabel } = useVAT();
  const image = proxyImageUrl(product.images?.[0] || product.imageUrl);
  const price = Number(product.price);
  const regularPrice = product.regularPrice ? Number(product.regularPrice) : null;
  const onSale = regularPrice && regularPrice > price;
  const items = parseBundleItems(product.shortDescription ?? '');
  const slug = product.slug || String(product.id);
  const isBundle = product.isBundle === true;
  const quantityDiscount = Array.isArray(product.priceBreaks) && product.priceBreaks.length > 0;
  const bulkOffer = getBulkOffer(product.priceBreaks, price);
  const href = isBundle ? `/bundle/${slug}` : `/product/${slug}`;

  return (
    <Link href={href} className="group block">
      <div className="rounded-none border border-gray-200 bg-white shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col h-full overflow-hidden">
        {/* Image */}
        <div className="relative aspect-square overflow-hidden bg-gray-100">
          {image ? (
            <img
              src={image}
              alt={product.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              loading="lazy"
              decoding="async"
              width={400}
              height={400}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-300">
              <Package className="w-12 h-12" />
            </div>
          )}
          {onSale && (
            <span className="absolute top-2 right-2 bg-accent text-white text-xs font-bold px-2 py-1 uppercase shadow">
              Sale
            </span>
          )}
          <span className="absolute top-2 left-2 bg-primary text-white text-xs font-bold px-2 py-1 uppercase shadow">
            {isBundle ? 'Bundle Pack' : 'Quantity Discount'}
          </span>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col flex-1 gap-2">
          <h3 className="text-sm font-bold text-gray-900 leading-snug group-hover:text-primary transition-colors line-clamp-2">
            {product.name}
          </h3>

          {/* Price */}
          <div className="flex items-baseline gap-2">
            <span className="text-base font-extrabold text-primary">£{vatPrice(price).toFixed(2)}</span>
            {onSale && regularPrice && (
              <span className="text-xs text-gray-400 line-through">£{vatPrice(regularPrice).toFixed(2)}</span>
            )}
            <span className="text-xs text-gray-400">{vatLabel}</span>
          </div>
          {bulkOffer && (
            <div className="text-xs font-extrabold text-emerald-700">
              Save £{vatPrice(bulkOffer.saving).toFixed(2)} at {bulkOffer.qty}+ <span className="font-semibold">· View offer →</span>
            </div>
          )}

          {/* Items preview */}
          {items.length > 0 && (
            <ul className="mt-1 space-y-1 flex-1">
              {items.slice(0, 4).map((item, i) => (
                <li key={i} className="flex items-center gap-2 text-xs text-gray-600">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                    {item.qty}
                  </span>
                  <span className="line-clamp-1">{item.name}</span>
                </li>
              ))}
              {items.length > 4 && (
                <li className="text-xs text-gray-400 pl-7">+{items.length - 4} more items</li>
              )}
            </ul>
          )}

          <div className="mt-auto pt-3 border-t border-gray-100">
            <span className="text-xs font-semibold text-primary group-hover:underline">
              {isBundle ? 'View bundle' : 'View product'} →
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function SkeletonCard() {
  return (
    <div className="border border-gray-200 bg-white animate-pulse flex flex-col">
      <div className="aspect-square bg-gray-200" />
      <div className="p-4 space-y-2">
        <div className="h-4 bg-gray-200 rounded w-3/4" />
        <div className="h-4 bg-gray-200 rounded w-1/3" />
        <div className="h-3 bg-gray-200 rounded w-full mt-2" />
        <div className="h-3 bg-gray-200 rounded w-5/6" />
        <div className="h-3 bg-gray-200 rounded w-4/6" />
      </div>
    </div>
  );
}

export default function BulkBuyBundles() {
  useSEO({
    title: 'Bulk Buy Workwear & Bundle Deals',
    description: 'Save more when you order more. Browse our bulk buy workwear deals and pre-matched uniform bundles — ideal for kitting out teams quickly at the best price.',
  });

  const { data: products = [], isLoading } = useWcProducts({ category_slug: 'bundles', per_page: 100 });

  return (
    <div className="flex flex-col w-full">
      {/* Hero */}
      <section className="relative h-64 bg-accent flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white to-transparent" />
        <div className="relative z-10 text-center px-4">
          <span className="inline-flex items-center gap-1.5 bg-white text-accent font-black px-4 py-1 text-sm tracking-widest mb-4 uppercase rounded-sm shadow-md transform -rotate-2">
            <Tag className="w-3.5 h-3.5" /> Sale
          </span>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-wider uppercase">
            Bulk Buy &amp; Bundles
          </h1>
          <p className="text-white/90 mt-4 max-w-xl mx-auto font-medium text-sm md:text-base">
            Save more when you kit out your whole team. Essential workwear bundles with free logo application included.
          </p>
        </div>
      </section>

      <section className="py-12 container mx-auto px-4">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {[...Array(8)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : products.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {products.map((p: any) => <BundleCard key={p.id} product={p} />)}
          </div>
        ) : (
          <div className="py-12 text-center text-gray-500">
            <Package className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="font-medium">No bundles available at the moment. Please check back later.</p>
          </div>
        )}
      </section>
    </div>
  );
}
