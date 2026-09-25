import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  calculateShopTotals,
  parsePriceBreaks,
  quantityTierPrice,
  sameLegacyShopBasket,
  shopBasketFingerprint,
  type PricedShopItem,
} from "../src/lib/shop-checkout-pricing.js";

describe("shop checkout authoritative pricing helpers", () => {
  it("uses the highest valid quantity tier and preserves variant price locking at the caller", () => {
    const tiers = parsePriceBreaks([
      { qty: 10, price: 8.5 },
      { qty: 25, price: 7.75 },
      { qty: 0, price: 1 },
      { qty: "invalid", price: 1 },
    ]);
    expect(tiers).toEqual([{ qty: 10, price: 8.5 }, { qty: 25, price: 7.75 }]);
    expect(quantityTierPrice(tiers, 24, 10)).toBe(8.5);
    expect(quantityTierPrice(tiers, 25, 10)).toBe(7.75);
    expect(quantityTierPrice([], 25, 10)).toBe(10);
  });

  it("prices VAT on validated item amounts and carriage", () => {
    const items: PricedShopItem[] = [{
      wcProductId: 15,
      name: "Polo",
      quantity: 2,
      price: 12,
      vatRate: 0.2,
    }];
    expect(calculateShopTotals(items, 8.5)).toEqual({
      subtotal: 24,
      vat: 6.5,
      total: 39,
    });
  });

  it("binds authoritative basket variants, branding, component choices and carriage", () => {
    const basket: PricedShopItem[] = [{
      wcProductId: 15,
      variationId: 91,
      name: "Polo",
      quantity: 2,
      price: 14,
      vatRate: 0.2,
      colour: "Navy",
      size: "M",
      brandingPositions: [{ id: "back-large", name: "Back Large", surcharge: 6 }],
    }];
    const fingerprint = shopBasketFingerprint(basket, "courier", 8.5);
    expect(shopBasketFingerprint(basket, "courier", 8.5)).toBe(fingerprint);
    expect(shopBasketFingerprint([{ ...basket[0], variationId: 92 }], "courier", 8.5)).not.toBe(fingerprint);
    expect(shopBasketFingerprint([{ ...basket[0], price: 13 }], "courier", 8.5)).not.toBe(fingerprint);
    expect(shopBasketFingerprint(basket, "warehouse_collection", 0)).not.toBe(fingerprint);
  });

  it("permits legacy payment recovery only when the saved selection is identical", () => {
    const saved = [{
      wcProductId: 15,
      variationId: 91,
      quantity: 2,
      colour: "Navy",
      size: "M",
      price: 1,
      brandingPositions: [{ id: "back-large", surcharge: 0 }],
    }];
    expect(sameLegacyShopBasket(saved, structuredClone(saved))).toBe(true);
    expect(sameLegacyShopBasket(saved, [{ ...saved[0], wcProductId: 16 }])).toBe(false);
    expect(sameLegacyShopBasket(JSON.stringify(saved).slice(0, 20), saved)).toBe(false);
  });

  it("finalizes paid orders from the persisted priced snapshot after catalog changes", () => {
    const routeSource = readFileSync(new URL("../src/routes/shop.ts", import.meta.url), "utf8");
    const orderRoute = routeSource.slice(routeSource.indexOf('router.post("/shop/orders"'));
    expect(routeSource).toContain("pricedItems: validated.items");
    expect(routeSource).toContain("originalCartFingerprint");
    expect(orderRoute).toContain("FROM shop_checkout_intents");
    expect(orderRoute).toContain("items: checkoutSnapshot.pricedItems");
    expect(orderRoute).not.toContain("validateShopBasket(");
    // Finalization must not reject paid lines just because current publication or
    // price fields changed; catalog lookups in this route are ID-existence-only.
    expect(orderRoute).not.toMatch(/website_published|unit_price\s*(?:[=<>]|ILIKE)/);
  });

  it("rejects changed cart choices but ignores edited display prices", () => {
    const paidSelections = [{
      wcProductId: 51,
      variationId: 72,
      quantity: 3,
      colour: "Navy",
      size: "M",
      price: 10,
      brandingPositions: [{ id: "left-chest", surcharge: 0 }],
    }];
    const resubmittedAfterCatalogPriceChange = structuredClone(paidSelections);
    resubmittedAfterCatalogPriceChange[0].price = 999;
    expect(sameLegacyShopBasket(paidSelections, resubmittedAfterCatalogPriceChange)).toBe(true);
    expect(sameLegacyShopBasket(paidSelections, [{
      ...resubmittedAfterCatalogPriceChange[0],
      variationId: 73,
    }])).toBe(false);
  });

  it("serializes repeat submissions on PaymentIntent and reuses the existing order", () => {
    const routeSource = readFileSync(new URL("../src/routes/shop.ts", import.meta.url), "utf8");
    const orderRoute = routeSource.slice(routeSource.indexOf('router.post("/shop/orders"'));
    expect(orderRoute).toContain("pg_advisory_xact_lock(hashtext(${d.paymentIntentId}))");
    expect(orderRoute).toContain("alreadyRecorded: true");
    expect(orderRoute).toContain("SET status = 'finalized', order_id = ${id}");
  });
});