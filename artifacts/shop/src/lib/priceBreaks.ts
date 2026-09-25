export interface PriceBreak {
  qty: number;
  price: number;
}

export interface BulkOffer {
  qty: number;
  price: number;
  saving: number;
}

/**
 * Returns the first genuine discounted tier for a product.
 * Price breaks can arrive in either order from the catalogue API.
 */
export function getBulkOffer(priceBreaks: unknown, basePrice: number): BulkOffer | null {
  if (!Array.isArray(priceBreaks) || !Number.isFinite(basePrice) || basePrice <= 0) {
    return null;
  }

  const firstDiscount = (priceBreaks as Partial<PriceBreak>[])
    .map((tier) => ({
      qty: Number(tier.qty),
      price: Number(tier.price),
    }))
    .filter((tier) => Number.isFinite(tier.qty) && tier.qty > 1 && Number.isFinite(tier.price) && tier.price > 0 && tier.price < basePrice)
    .sort((a, b) => a.qty - b.qty)[0];

  if (!firstDiscount) return null;

  return {
    ...firstDiscount,
    saving: basePrice - firstDiscount.price,
  };
}