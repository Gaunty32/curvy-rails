import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { usePageHead } from '@/lib/use-page-head';
import { gbp, useProducts } from '@/data/catalogue';
import { ProductGallery } from '@/components/product-gallery';
import { useBasket } from '@/data/basket';
import { SizePicker } from '@/components/size-picker';
import { ProductCard } from '@/components/product-card';
import { CATEGORY_LABEL, productColours, productForColour, type ProductColour } from '@/data/types';
import { ColourPicker } from '@/components/colour-picker';

export default function ProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const products = useProducts();
  const p = products.find((x) => x.slug === slug);
  usePageHead(p ? p.name : 'Product not found', p ? p.description : 'This product could not be found in the demo catalogue.');
  const [size, setSize] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [selected, setSelected] = useState<{ id: string; colour: ProductColour } | null>(null);
  const basket = useBasket();
  if (!p) return (
    <div className="mx-auto max-w-3xl px-4 py-24 text-center">
      <h1 className="font-display text-4xl uppercase">Product not found</h1>
      <Link href="/shop" className="mt-4 inline-block underline">Back to shop</Link>
    </div>
  );
  const related = products.filter((x) => x.category === p.category && x.id !== p.id).slice(0, 4);
  const preferred = new URLSearchParams(window.location.search).get('colour');
  const colours = productColours(p);
  const colour = selected?.id === p.id ? selected.colour : colours.find((c) => c === preferred) ?? p.colour;
  const variant = productForColour(p, colour);
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-10">
      <div className="grid gap-8 md:grid-cols-2 md:gap-14">
          <ProductGallery key={`${p.id}-${colour}`} product={variant} />
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{CATEGORY_LABEL[p.category]} &middot; {colour}</p>
          <h1 data-testid="text-product-name" className="font-display mt-2 text-3xl uppercase sm:text-4xl md:text-5xl">{p.name}</h1>
          <p data-testid="text-product-price" className="mt-3 text-2xl font-bold">{gbp(p.price)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Includes VAT</p>
          <p className="mt-4 leading-relaxed">{p.description}</p>
          <p className="mb-2 mt-6 text-xs font-bold uppercase tracking-widest">Colour: {colour}</p>
          <ColourPicker colours={colours} value={colour} onChange={(next) => { setSelected({ id: p.id, colour: next }); setAdded(false); }} />
          <p className="mt-6 mb-2 text-xs font-bold uppercase tracking-widest">UK size</p>
          <SizePicker sizes={p.sizes} value={size} onChange={setSize} />
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex h-12 w-fit items-center border border-black">
              <button aria-label="Fewer" className="h-full w-11" onClick={() => setQty(Math.max(1, qty - 1))}>-</button>
              <span data-testid="text-qty" className="w-8 text-center font-semibold">{qty}</span>
              <button aria-label="More" className="h-full w-11" onClick={() => setQty(Math.min(10, qty + 1))}>+</button>
            </div>
            <button data-testid="button-add-to-basket" disabled={!size} onClick={() => { if (size) { basket.add(p.id, size, qty, colour); setAdded(true); } }}
              className="h-12 w-full bg-black sm:flex-1 text-xs font-bold uppercase tracking-widest text-white disabled:opacity-40">{size ? 'Add to basket' : 'Select a size'}</button>
          </div>
          {added && <p className="mt-3 text-sm font-semibold">Added to basket. <Link href="/basket" className="underline">View basket</Link></p>}
          <ul className="mt-8 space-y-1 border-t pt-4 text-sm text-muted-foreground">
            <li>Dispatched within 7 working days, excluding weekends.</li>
            <li>UK mainland delivery: £3.99 including VAT, free on orders over £50.</li>
            <li>Outside UK mainland: orders accepted; shipping quoted separately.</li>
            <li>Returns info on our <Link href="/delivery-returns" className="underline">Delivery &amp; Returns</Link> page</li>
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
