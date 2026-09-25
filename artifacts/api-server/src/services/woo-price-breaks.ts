export interface WooBundleForPriceBreaks {
  type: string;
  price: string;
  regular_price: string;
  sale_price: string;
  on_sale: boolean;
  meta_data?: { key: string; value: unknown }[];
}

interface BundleDataItem {
  product_id?: string;
  bp_min_qty?: string;
}

/**
 * Convert homogeneous WooCommerce bulk packs into per-unit quantity breaks.
 *
 * Mixed wearer packs and outfit bundles must not create price breaks: their
 * total covers several different garments and cannot be divided by one
 * component's quantity to obtain that component's selling price.
 */
export function extractBundlePriceBreaks(
  products: WooBundleForPriceBreaks[],
): Map<number, { qty: number; price: number }[]> {
  const result = new Map<number, { qty: number; price: number }[]>();

  for (const product of products) {
    if (product.type !== "yith_bundle") continue;

    const bundleDataMeta = product.meta_data?.find(
      (entry) => entry.key === "_yith_wcpb_bundle_data",
    );
    const bundleData = bundleDataMeta?.value as Record<string, BundleDataItem> | null;
    if (!bundleData || typeof bundleData !== "object") continue;

    const items = Object.values(bundleData)
      .map((item) => ({
        wooProductId: item.product_id ? Number.parseInt(item.product_id, 10) : NaN,
        qty: item.bp_min_qty ? Number.parseInt(item.bp_min_qty, 10) : NaN,
      }))
      .filter((item) =>
        Number.isFinite(item.wooProductId) &&
        Number.isFinite(item.qty) &&
        item.wooProductId > 0 &&
        item.qty > 1
      );

    const productIds = new Set(items.map((item) => item.wooProductId));
    if (items.length !== 1 || productIds.size !== 1) continue;

    const bundlePrice = Number.parseFloat(
      product.on_sale && product.sale_price
        ? product.sale_price
        : product.price || product.regular_price || "0",
    );
    if (!Number.isFinite(bundlePrice) || bundlePrice <= 0) continue;

    const [{ wooProductId, qty }] = items;
    const perUnitPrice = Math.round((bundlePrice / qty) * 100) / 100;
    if (perUnitPrice <= 0) continue;

    const existing = result.get(wooProductId) ?? [];
    if (!existing.some((priceBreak) => priceBreak.qty === qty)) {
      existing.push({ qty, price: perUnitPrice });
    }
    result.set(wooProductId, existing);
  }

  for (const [wooProductId, priceBreaks] of result) {
    result.set(
      wooProductId,
      priceBreaks.sort((a, b) => a.qty - b.qty),
    );
  }

  return result;
}