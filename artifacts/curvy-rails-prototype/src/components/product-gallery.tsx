import { useState } from 'react';
import { asset } from '@/data/catalogue';
import type { Product } from '@/data/types';

export function ProductGallery({ product }: { product: Product }) {
  const images = [...new Set([product.image, ...(product.images ?? [])])];
  const [active, setActive] = useState(0);
  return (
    <div>
      <div className="relative bg-secondary">
        <img data-testid="image-product-main" src={asset(images[active])} alt={`${product.name} — ${product.colour}${images.length > 1 ? ` — ${active === 0 ? 'flat shot' : 'model mock-up'}` : ''}`} fetchPriority="high" className="aspect-square w-full object-cover" />
        {(product.placeholder || product.mockup) && <span className="absolute left-3 top-3 bg-black px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-white">{product.mockup ? 'Product mock-up' : 'Placeholder image'}</span>}
      </div>
      {images.length > 1 && <div className="mt-3 flex gap-3" aria-label="Product images">
        {images.map((image, i) => (
          <button key={image} type="button" aria-label={`Show ${product.colour.toLowerCase()} ${i === 0 ? 'flat shot' : 'model mock-up'}`} aria-pressed={active === i} onClick={() => setActive(i)} className={`h-20 w-20 border-2 p-1 ${active === i ? 'border-black' : 'border-transparent hover:border-neutral-400'}`}>
            <img src={asset(image)} alt={`${product.colour} ${i === 0 ? 'flat shot' : 'model mock-up'}`} loading="lazy" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>}
    </div>
  );
}