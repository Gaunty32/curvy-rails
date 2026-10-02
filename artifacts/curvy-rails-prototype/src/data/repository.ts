import type { Product } from './types';
import { SEED_PRODUCTS } from './seed';

/**
 * Catalogue repository abstraction. The prototype implements it on top of
 * browser localStorage; a production build would implement the same interface
 * against a real API without touching any UI code.
 */
export interface ProductRepository {
  list(): Promise<Product[]> | Product[];
  save(product: Product): Product[];
  remove(id: string): Product[];
  reset(): Product[];
  exportJson(): string;
}

const KEY = 'cr.demo.catalogue.v1';

function read(): Product[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as Product[];
    }
  } catch { /* fall through to seed */ }
  return SEED_PRODUCTS;
}
function write(items: Product[]): Product[] {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* storage full */ }
  return items;
}

export const localProductRepository: ProductRepository = {
  list: read,
  save(p) {
    const items = read();
    const i = items.findIndex((x) => x.id === p.id);
    return write(i >= 0 ? items.map((x) => (x.id === p.id ? p : x)) : [...items, p]);
  },
  remove: (id) => write(read().filter((x) => x.id !== id)),
  reset() { localStorage.removeItem(KEY); return SEED_PRODUCTS; },
  exportJson: () => JSON.stringify(read(), null, 2),
};
