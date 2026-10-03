import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useProducts } from './catalogue';
import type { Product } from './types';
import { normalizeSize } from './types';

interface Line { productId: string; size: string; qty: number }
export const FREE_DELIVERY_OVER = 50;
export const DELIVERY_FEE = 3.99;
const KEY = 'cr.demo.basket.v1';

interface Ctx {
  lines: { product: Product; size: string; qty: number }[];
  count: number; subtotal: number; delivery: number; total: number;
  add(id: string, size: string, qty?: number): void;
  setQty(id: string, size: string, qty: number): void;
  remove(id: string, size: string): void;
  clear(): void;
}
const C = createContext<Ctx | null>(null);

export function normalizeBasket(items: Line[]): Line[] {
  return items.reduce<Line[]>((result, line) => {
    const size = normalizeSize(line.size);
    const existing = result.find((l) => l.productId === line.productId && l.size === size);
    if (existing) existing.qty += line.qty;
    else result.push({ ...line, size });
    return result;
  }, []);
}

export function BasketProvider({ children }: { children: ReactNode }) {
  const products = useProducts();
  const [raw, setRaw] = useState<Line[]>(() => {
    try { return normalizeBasket(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return []; }
  });
  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(raw)); }, [raw]);
  const value = useMemo<Ctx>(() => {
    const lines = raw.flatMap((l) => {
      const product = products.find((p) => p.id === l.productId);
      return product ? [{ product, size: l.size, qty: l.qty }] : [];
    });
    const subtotal = lines.reduce((s, l) => s + l.product.price * l.qty, 0);
    const delivery = lines.length === 0 || subtotal >= FREE_DELIVERY_OVER ? 0 : DELIVERY_FEE;
    const same = (l: Line, id: string, size: string) => l.productId === id && l.size === size;
    return {
      lines, subtotal, delivery, total: subtotal + delivery,
      count: lines.reduce((s, l) => s + l.qty, 0),
      add: (id, size, qty = 1) => setRaw((r) => r.some((l) => same(l, id, size))
        ? r.map((l) => (same(l, id, size) ? { ...l, qty: Math.min(10, l.qty + qty) } : l))
        : [...r, { productId: id, size, qty }]),
      setQty: (id, size, qty) => setRaw((r) => r.map((l) => (same(l, id, size) ? { ...l, qty: Math.max(1, Math.min(10, qty)) } : l))),
      remove: (id, size) => setRaw((r) => r.filter((l) => !same(l, id, size))),
      clear: () => setRaw([]),
    };
  }, [raw, products]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
export function useBasket() {
  const c = useContext(C);
  if (!c) throw new Error('BasketProvider missing');
  return c;
}
