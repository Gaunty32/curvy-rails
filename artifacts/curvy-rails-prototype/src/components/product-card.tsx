import { useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, Heart } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { asset, gbp, sizeRange } from '@/data/catalogue';
import { useBasket } from '@/data/basket';
import type { Product } from '@/data/types';
import { SizePicker } from './size-picker';

export function ProductCard({ product }: { product: Product }) {
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState<number | null>(null);
  const [added, setAdded] = useState(false);
  const basket = useBasket();
  return (
    <article data-testid={`card-product-${product.id}`} className="group">
      <Link href={`/products/${product.slug}`} className="relative block aspect-square overflow-hidden bg-secondary">
        <img src={asset(product.image)} alt={product.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        <span aria-hidden className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5"><Heart className="h-4 w-4" /></span>
        {product.placeholder && <span className="absolute bottom-2 left-2 bg-black/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">Placeholder</span>}
      </Link>
      <h3 className="mt-3 text-sm font-bold leading-snug">{product.name}</h3>
      <p className="text-sm font-semibold">{gbp(product.price)}</p>
      <p className="text-xs text-muted-foreground">Sizes {sizeRange(product.sizes)}</p>
      <button data-testid={`button-quickshop-${product.id}`} onClick={() => { setSize(null); setAdded(false); setOpen(true); }}
        className="mt-2 flex h-11 w-full items-center justify-center gap-2 bg-black text-xs font-bold uppercase tracking-widest text-white hover:bg-neutral-800">
        Quick shop <ArrowRight className="h-4 w-4" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl uppercase">{product.name}</DialogTitle>
            <DialogDescription>{gbp(product.price)} - demo placeholder product</DialogDescription>
          </DialogHeader>
          <SizePicker sizes={product.sizes} value={size} onChange={setSize} />
          <button data-testid={`button-quickshop-add-${product.id}`} disabled={!size}
            onClick={() => { if (size) { basket.add(product.id, size); setAdded(true); } }}
            className="h-11 bg-black text-sm font-bold uppercase tracking-widest text-white disabled:opacity-40">
            {size ? 'Add to basket' : 'Choose a size'}
          </button>
          {added && <p className="text-sm font-semibold">Added. <Link href="/basket" className="underline" onClick={() => setOpen(false)}>View basket</Link></p>}
        </DialogContent>
      </Dialog>
    </article>
  );
}
