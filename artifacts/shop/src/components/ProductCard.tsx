import { useState } from 'react';
import { Link } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { proxyImageUrl } from '@/lib/imageProxy';
import { useVAT } from '@/context/VATContext';
import { getBulkOffer } from '@/lib/priceBreaks';

export function ProductCard({ product, priority = false }: { product: any; priority?: boolean }) {
  const { vatPrice, vatLabel } = useVAT();
  const [imgError, setImgError] = useState(false);
  const image = proxyImageUrl(product.images?.[0] || product.image);
  const basePrice = Number(product.price);
  const bulkOffer = getBulkOffer(product.priceBreaks, basePrice);
  const isBundle = product.isBundle === true ||
    product.categories?.some((category: any) => category.slug === 'bundles');
  const href = `${isBundle ? '/bundle' : '/product'}/${product.slug || product.id}`;

  // A public product must have a usable primary image. This also protects the
  // catalogue from legacy objects whose filename says "image" but whose bytes
  // are an HTML error page.
  if (!image || imgError) return null;

  return (
    <Link href={href} className="group block h-full">
      <Card className="rounded-none border border-gray-100 shadow-sm hover:shadow-md transition-all duration-300 h-full flex flex-col group-hover:border-primary/20">
        <div className="relative aspect-square overflow-hidden bg-gray-50 flex items-center justify-center p-4">
          <img
            src={image}
            alt={product.name}
            width={400}
            height={400}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            onError={() => setImgError(true)}
            className="w-full h-full object-contain mix-blend-multiply group-hover:scale-105 transition-transform duration-500"
          />
          {product.onSale && (
            <span className="absolute top-2 right-2 bg-accent text-white text-[10px] md:text-xs font-bold px-2 py-1 uppercase tracking-wider z-10 shadow-sm">
              Sale
            </span>
          )}
        </div>
        <CardContent className="p-3 md:p-4 flex-1 flex flex-col bg-white">
          <h3 className="text-xs md:text-sm font-bold text-gray-800 line-clamp-2 mb-2 group-hover:text-primary transition-colors leading-tight">
            {product.name}
          </h3>
          <div className="mt-auto">
            {product.price ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
                  <p className="text-primary font-bold text-sm md:text-base flex items-baseline gap-1">
                    £{vatPrice(basePrice).toFixed(2)}
                    <span className="text-[10px] md:text-xs text-gray-500 font-normal tracking-wide">{vatLabel}</span>
                  </p>
                  {bulkOffer && (
                    <span className="text-[10px] md:text-xs font-extrabold text-emerald-700 whitespace-nowrap">
                      Save £{vatPrice(bulkOffer.saving).toFixed(2)} at {bulkOffer.qty}+
                    </span>
                  )}
                </div>
                <span className="inline-flex items-center text-[10px] md:text-xs font-bold text-primary group-hover:underline">
                  {bulkOffer ? 'See bulk offer' : 'View product'} <span aria-hidden="true" className="ml-1">→</span>
                </span>
              </div>
            ) : (
              <p className="text-gray-500 text-xs md:text-sm font-medium">Price unavailable</p>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
