import { createHash } from "node:crypto";

export type PricedShopItem = {
  wcProductId: number;
  variationId?: number | null;
  name: string;
  sku?: string | null;
  price: number;
  vatRate: number;
  quantity: number;
  colour?: string | null;
  size?: string | null;
  brandingPositions?: Array<{ id: string; name: string; surcharge: number; notes?: string | null }>;
  wearerName?: string | null;
  bundleComponents?: Array<{
    productId?: number;
    name: string;
    qty: number;
    colour?: string | null;
    size?: string | null;
    sleeve?: string | null;
    variationId?: number | null;
    brandingPositions?: Array<{ id: string; name: string; surcharge: number; notes?: string | null }>;
  }>;
};

const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export function parsePriceBreaks(raw: unknown): Array<{ qty: number; price: number }> {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((tier: any) => ({ qty: Number(tier?.qty), price: Number(tier?.price) }))
    .filter((tier) => Number.isInteger(tier.qty) && tier.qty > 0 && Number.isFinite(tier.price) && tier.price > 0)
    .sort((a, b) => a.qty - b.qty);
}

export function quantityTierPrice(
  breaks: Array<{ qty: number; price: number }>,
  quantity: number,
  basePrice: number,
): number {
  return [...breaks].reverse().find((tier) => quantity >= tier.qty)?.price ?? basePrice;
}

export function calculateShopTotals(
  items: PricedShopItem[],
  shippingAmount: number,
): { subtotal: number; vat: number; total: number } {
  const subtotal = money(items.reduce((sum, item) => sum + item.price * item.quantity, 0));
  const vat = money(items.reduce((sum, item) => sum + item.price * item.quantity * item.vatRate, 0) + shippingAmount * 0.2);
  return { subtotal, vat, total: money(subtotal + shippingAmount + vat) };
}

/**
 * Hash only validated basket facts and authoritative prices. Client display
 * names, image URLs and supplied prices are deliberately excluded.
 */
export function shopBasketFingerprint(
  items: PricedShopItem[],
  shippingMethod: string,
  shippingAmount: number,
): string {
  const normalized = items.map((item) => ({
    productId: item.wcProductId,
    variationId: item.variationId ?? null,
    quantity: item.quantity,
    colour: item.colour?.trim() || null,
    size: item.size?.trim() || null,
    wearerName: item.wearerName?.trim() || null,
    price: money(item.price),
    vatRate: item.vatRate,
    branding: (item.brandingPositions ?? []).map((position) => ({
      id: position.id,
      surcharge: money(position.surcharge),
      notes: position.notes?.trim() || null,
    })).sort((a, b) => a.id.localeCompare(b.id)),
    components: (item.bundleComponents ?? []).map((component) => ({
      productId: component.productId ?? null,
      quantity: component.qty,
      variationId: component.variationId ?? null,
      colour: component.colour?.trim() || null,
      size: component.size?.trim() || null,
      sleeve: component.sleeve?.trim() || null,
      branding: (component.brandingPositions ?? []).map((position) => ({
        id: position.id,
        surcharge: money(position.surcharge),
        notes: position.notes?.trim() || null,
      })).sort((a, b) => a.id.localeCompare(b.id)),
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  return createHash("sha256")
    .update(JSON.stringify({ items: normalized, shippingMethod, shippingAmount: money(shippingAmount) }))
    .digest("hex");
}

/** Allows safe recovery of old shop intents whose complete cart JSON was stored in Stripe metadata. */
export function sameLegacyShopBasket(saved: unknown, submitted: unknown): boolean {
  if (!Array.isArray(saved) || !Array.isArray(submitted) || saved.length !== submitted.length) return false;
  const normalize = (items: any[]) => items.map((item) => ({
    productId: Number(item?.wcProductId),
    variationId: item?.variationId == null ? null : Number(item.variationId),
    quantity: Number(item?.quantity),
    colour: String(item?.colour ?? "").trim().toLowerCase() || null,
    size: String(item?.size ?? "").trim().toLowerCase() || null,
    wearerName: String(item?.wearerName ?? "").trim().toLowerCase() || null,
    branding: (Array.isArray(item?.brandingPositions) ? item.brandingPositions : [])
      .map((position: any) => ({
        id: String(position?.id ?? ""),
        notes: String(position?.notes ?? "").trim() || null,
      }))
      .sort((a: any, b: any) => a.id.localeCompare(b.id)),
    components: (Array.isArray(item?.bundleComponents) ? item.bundleComponents : [])
      .map((component: any) => ({
        name: String(component?.name ?? "").trim().toLowerCase(),
        quantity: Number(component?.qty),
        variationId: component?.variationId == null ? null : Number(component.variationId),
        colour: String(component?.colour ?? "").trim().toLowerCase() || null,
        size: String(component?.size ?? "").trim().toLowerCase() || null,
        sleeve: String(component?.sleeve ?? "").trim().toLowerCase() || null,
        branding: (Array.isArray(component?.brandingPositions) ? component.brandingPositions : [])
          .map((position: any) => ({
            id: String(position?.id ?? ""),
            notes: String(position?.notes ?? "").trim() || null,
          }))
          .sort((a: any, b: any) => a.id.localeCompare(b.id)),
      }))
      .sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify(normalize(saved)) === JSON.stringify(normalize(submitted));
}