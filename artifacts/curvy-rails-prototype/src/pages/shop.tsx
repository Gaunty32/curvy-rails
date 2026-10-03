import { useMemo, useState } from 'react';
import { usePageHead } from '@/lib/use-page-head';
import { useProducts } from '@/data/catalogue';
import { ProductCard } from '@/components/product-card';
import { ALL_SIZES, type Category } from '@/data/types';

const META = {
  all: ['Shop all', 'Browse every Curvy Rails T-shirt and hoodie in sizes 16-32. Demo catalogue.', 'Shop all'],
  tshirt: ['T-Shirts', 'Curvy Rails graphic T-shirts for sizes 16-32, £24. Demo catalogue.', 'T-Shirts'],
  hoodie: ['Hoodies', 'Curvy Rails graphic hoodies for sizes 16-32, £38. Demo catalogue.', 'Hoodies'],
} as const;

export default function Shop({ category }: { category?: Category }) {
  const m = META[category ?? 'all'];
  usePageHead(m[0], m[1]);
  const products = useProducts();
  const [q, setQ] = useState('');
  const [size, setSize] = useState('');
  const [colour, setColour] = useState('');
  const [sort, setSort] = useState('featured');
  const list = useMemo(() => {
    const r = products.filter((p) => (!category || p.category === category) && (!size || p.sizes.includes(size)) && (!colour || p.colour === colour) && p.name.toLowerCase().includes(q.toLowerCase().trim()));
    if (sort === 'low') r.sort((a, b) => a.price - b.price);
    if (sort === 'high') r.sort((a, b) => b.price - a.price);
    return r;
  }, [products, category, q, size, colour, sort]);
  const field = 'h-11 min-w-0 border border-black bg-white px-3 text-sm';
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 md:px-8">
      <h1 className="font-display text-4xl uppercase md:text-6xl">{m[2]}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{list.length} products. Placeholder range for demonstration.</p>
      <div className="mt-6 grid grid-cols-2 gap-2 sm:gap-3 md:flex md:flex-wrap">
        <input data-testid="input-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" aria-label="Search" className={`${field} col-span-2 md:w-64`} />
        <select data-testid="select-size" aria-label="Size" value={size} onChange={(e) => setSize(e.target.value)} className={field}>
          <option value="">Any size</option>{ALL_SIZES.map((s) => <option key={s} value={s}>Size {s}</option>)}
        </select>
        <select data-testid="select-colour" aria-label="Colour" value={colour} onChange={(e) => setColour(e.target.value)} className={field}>
          <option value="">Any colour</option><option>Black</option><option>White</option>
        </select>
        <select data-testid="select-sort" aria-label="Sort"  value={sort} onChange={(e) => setSort(e.target.value)} className={field}>
          <option value="featured">Featured</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option>
        </select>
      </div>
      {list.length === 0 ? (
        <div data-testid="text-empty" className="mt-12 border border-dashed border-black p-12 text-center">
          <p className="font-display text-2xl uppercase">Nothing matches</p>
          <button className="mt-3 min-h-11 px-3 underline" onClick={() => { setQ(''); setSize(''); setColour(''); }}>Clear filters</button>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">{list.map((p) => <ProductCard key={p.id} product={p} />)}</div>
      )}
    </div>
  );
}
