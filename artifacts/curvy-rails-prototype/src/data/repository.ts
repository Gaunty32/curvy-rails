import type { Product } from './types';
import { FIRST_PRODUCT, SEED_PRODUCTS } from './seed';

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
const FIRST_PRODUCT_ADDED = 'cr.demo.catalogue.patience-added';

function read(): Product[] {
  try {
    const raw = localStorage.getItem(KEY);
    let items = SEED_PRODUCTS;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) items = parsed as Product[];
    }
    // Add the first supplied design once, preserving existing catalogue edits.
    // The marker also preserves a deliberate deletion of this new product.
    if (!localStorage.getItem(FIRST_PRODUCT_ADDED)) {
      if (!items.some((p) => p.id === FIRST_PRODUCT.id)) {
        items = [FIRST_PRODUCT, ...items];
        localStorage.setItem(KEY, JSON.stringify(items));
      }
      localStorage.setItem(FIRST_PRODUCT_ADDED, 'true');
    }
    return items;
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
