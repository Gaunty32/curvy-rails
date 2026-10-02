import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { usePageHead } from '@/lib/use-page-head';
import { asset, gbp, useProducts } from '@/data/catalogue';
import { useBasket } from '@/data/basket';
import { SizePicker } from '@/components/size-picker';
import { ProductCard } from '@/components/product-card';
import { CATEGORY_LABEL } from '@/data/types';

export default function ProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const products = useProducts();
  const p = products.find((x) => x.slug === slug);
  usePageHead(p ? p.name : 'Product not found', p ? p.description : 'This product could not be found in the demo catalogue.');
  const [size, setSize] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const basket = useBasket();
  if (!p) return (
    <div className="mx-auto max-w-3xl px-4 py-24 text-center">
      <h1 className="font-display text-4xl uppercase">Product not found</h1>
      <Link href="/shop" className="mt-4 inline-block underline">Back to shop</Link>
    </div>
  );
  const related = products.filter((x) => x.category === p.category && x.id !== p.id).slice(0, 4);
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-10">
      <div className="grid gap-8 md:grid-cols-2 md:gap-14">
        <div className="relative bg-secondary">
          <img src={asset(p.image)} alt={p.name} fetchPriority="high" className="aspect-square w-full object-cover" />
          {p.placeholder && <span className="absolute left-3 top-3 bg-black px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-white">Placeholder image</span>}
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{CATEGORY_LABEL[p.category]} &middot; {p.colour}</p>
          <h1 data-testid="text-product-name" className="font-display mt-2 text-3xl uppercase sm:text-4xl md:text-5xl">{p.name}</h1>
          <p data-testid="text-product-price" className="mt-3 text-2xl font-bold">{gbp(p.price)}</p>
          <p className="mt-4 leading-relaxed">{p.description}</p>
          <p className="mt-6 mb-2 text-xs font-bold uppercase tracking-widest">UK size</p>
          <SizePicker sizes={p.sizes} value={size} onChange={setSize} />
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex h-12 w-fit items-center border border-black">
              <button aria-label="Fewer" className="h-full w-11" onClick={() => setQty(Math.max(1, qty - 1))}>-</button>
              <span data-testid="text-qty" className="w-8 text-center font-semibold">{qty}</span>
              <button aria-label="More" className="h-full w-11" onClick={() => setQty(Math.min(10, qty + 1))}>+</button>
            </div>
            <button data-testid="button-add-to-basket" disabled={!size} onClick={() => { if (size) { basket.add(p.id, size, qty); setAdded(true); } }}
              className="h-12 w-full bg-black sm:flex-1 text-xs font-bold uppercase tracking-widest text-white disabled:opacity-40">{size ? 'Add to basket' : 'Select a size'}</button>
          </div>
          {added && <p className="mt-3 text-sm font-semibold">Added to basket. <Link href="/basket" className="underline">View basket</Link></p>}
          <ul className="mt-8 space-y-1 border-t pt-4 text-sm text-muted-foreground">
            <li>Free UK delivery over £50, otherwise £3.99</li><li>Returns info on our <Link href="/delivery-returns" className="underline">Delivery &amp; Returns</Link> page</li>
          </ul>
        </div>
      </div>
      {related.length > 0 && (
        <section className="mt-16">
          <h2 className="font-display text-3xl uppercase">You might also like</h2>
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">{related.map((r) => <ProductCard key={r.id} product={r} />)}</div>
        </section>
      )}
    </div>
  );
}
