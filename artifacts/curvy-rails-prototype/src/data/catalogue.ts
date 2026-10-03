import { useSyncExternalStore } from 'react';
import { localProductRepository as repo } from './repository';
import type { Product } from './types';

let cache: Product[] = repo.list() as Product[];
const subs = new Set<() => void>();
const set = (items: Product[]) => { cache = items; subs.forEach((f) => f()); };

export const catalogue = {
  save: (p: Product) => set(repo.save(p)),
  remove: (id: string) => set(repo.remove(id)),
  reset: () => set(repo.reset()),
  exportJson: () => repo.exportJson(),
};
export function useProducts(): Product[] {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => cache);
}
export const gbp = (n: number) => `£${n.toFixed(2)}`;
export const asset = (p: string) => (/^(https?:|data:|blob:)/.test(p) ? p : `${import.meta.env.BASE_URL}${p.replace(/^\//, '')}`);
export const sizeRange = (s: string[]) => (s.length ? s.join(' / ') : 'Sold out');
