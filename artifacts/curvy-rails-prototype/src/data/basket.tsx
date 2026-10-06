import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useProducts } from './catalogue';
import type { Product, ProductColour } from './types';
import { normalizeSize, productColours, productForColour } from './types';
import { calculateDelivery, type DeliveryRegion } from './delivery';

export interface BasketLine { productId: string; size: string; qty: number; colour?: ProductColour }
type Line = BasketLine;
const KEY = 'cr.demo.basket.v1';
const REGION_KEY = 'cr.demo.delivery-region.v1';

interface Ctx {
  lines: { product: Product; size: string; qty: number }[];
  count: number; subtotal: number; delivery: number | null; total: number | null;
  quoteRequired: boolean;
  region: DeliveryRegion;
  setRegion(region: DeliveryRegion): void;
  add(id: string, size: string, qty?: number, colour?: ProductColour): void;
  setQty(id: string, size: string, qty: number, colour: ProductColour): void;
  remove(id: string, size: string, colour: ProductColour): void;
  clear(): void;
}
const C = createContext<Ctx | null>(null);

export function normalizeBasket(items: Line[], products: Product[] = []): Line[] {
  return items.reduce<Line[]>((result, line) => {
    const size = normalizeSize(line.size);
    const product = products.find((p) => p.id === line.productId);
    const colour = product
      ? productColours(product).find((c) => c === line.colour) ?? product.colour
      : line.colour;
    const existing = result.find((l) => l.productId === line.productId && l.size === size && l.colour === colour);
    if (existing) existing.qty += line.qty;
    else result.push({ ...line, size, colour });
    return result;
  }, []);
}

export function BasketProvider({ children }: { children: ReactNode }) {
  const products = useProducts();
  const [raw, setRaw] = useState<Line[]>(() => {
    try { return normalizeBasket(JSON.parse(localStorage.getItem(KEY) || '[]'), products); } catch { return []; }
  });
  const [region, setRegion] = useState<DeliveryRegion>(() => {
    try { return localStorage.getItem(REGION_KEY) === 'outside-mainland' ? 'outside-mainland' : 'mainland'; }
    catch { return 'mainland'; }
  });
  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(raw)); }, [raw]);
  useEffect(() => { try { localStorage.setItem(REGION_KEY, region); } catch { /* Storage may be unavailable. */ } }, [region]);
  const value = useMemo<Ctx>(() => {
    const lines = raw.flatMap((l) => {
      const product = products.find((p) => p.id === l.productId);
      return product ? [{ product: productForColour(product, l.colour ?? product.colour), size: l.size, qty: l.qty }] : [];
    });
    const subtotal = Math.round(lines.reduce((s, l) => s + l.product.price * l.qty, 0) * 100) / 100;
    const amounts = calculateDelivery(subtotal, region, lines.length > 0);
    const same = (l: Line, id: string, size: string, colour: ProductColour) => l.productId === id && l.size === size && l.colour === colour;
    return {
      lines, subtotal, ...amounts, region, setRegion,
      count: lines.reduce((s, l) => s + l.qty, 0),
      add: (id, size, qty = 1, colour) => {
        const product = products.find((p) => p.id === id);
        if (!product) return;
        const chosen = productColours(product).find((c) => c === colour) ?? product.colour;
        setRaw((r) => r.some((l) => same(l, id, size, chosen))
          ? r.map((l) => (same(l, id, size, chosen) ? { ...l, qty: Math.min(10, l.qty + qty) } : l))
          : [...r, { productId: id, size, qty, colour: chosen }]);
      },
      setQty: (id, size, qty, colour) => setRaw((r) => r.map((l) => (same(l, id, size, colour) ? { ...l, qty: Math.max(1, Math.min(10, qty)) } : l))),
      remove: (id, size, colour) => setRaw((r) => r.filter((l) => !same(l, id, size, colour))),
      clear: () => setRaw([]),
    };
  }, [raw, products, region]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
export function useBasket() {
  const c = useContext(C);
  if (!c) throw new Error('BasketProvider missing');
  return c;
}
