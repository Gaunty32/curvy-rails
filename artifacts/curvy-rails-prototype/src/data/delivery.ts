export type DeliveryRegion = 'mainland' | 'outside-mainland';
export const FREE_DELIVERY_OVER = 50;
export const DELIVERY_FEE = 3.99;

/** All amounts include VAT. A pending quote is not a zero-cost delivery. */
export function calculateDelivery(subtotal: number, region: DeliveryRegion, hasItems = true) {
  const subtotalPence = Math.round(subtotal * 100);
  if (!hasItems) return { delivery: 0, total: 0, quoteRequired: false };
  if (region === 'outside-mainland') {
    return { delivery: null, total: null, quoteRequired: true };
  }
  const delivery = subtotalPence > FREE_DELIVERY_OVER * 100 ? 0 : DELIVERY_FEE;
  return { delivery, total: (subtotalPence + Math.round(delivery * 100)) / 100, quoteRequired: false };
}
