import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@workspace/db", () => ({ db: {}, settingsTable: {} }));

import {
  isShopShippingMethodEnabled,
  resolveShopShippingConfiguration,
} from "../src/lib/business-config.js";

describe("shop shipping configuration", () => {
  it("does not enable local delivery or collection from installation defaults", () => {
    const configuration = resolveShopShippingConfiguration({}, null);

    expect(configuration).toEqual({
      collectionAddress: null,
      enabledCollectionMethods: [],
      freeLocalDelivery: null,
    });
    expect(isShopShippingMethodEnabled("courier", configuration)).toBe(true);
    expect(isShopShippingMethodEnabled("free_local", configuration)).toBe(false);
    expect(isShopShippingMethodEnabled("warehouse_collection", configuration)).toBe(false);
    expect(isShopShippingMethodEnabled("office_collection", configuration)).toBe(false);
  });

  it("requires explicit staff settings and configured business address", () => {
    const settings = {
      shop_warehouse_collection_enabled: "true",
      shop_office_collection_enabled: "true",
      shop_free_local_delivery_enabled: "true",
      shop_free_local_delivery_latitude: "53.8",
      shop_free_local_delivery_longitude: "-1.6",
      shop_free_local_delivery_radius_miles: "12",
    };
    const withoutAddress = resolveShopShippingConfiguration(settings, { name: "Installed business" });
    expect(withoutAddress.enabledCollectionMethods).toEqual([]);
    expect(withoutAddress.collectionAddress).toBeNull();

    const configured = resolveShopShippingConfiguration(settings, {
      name: "Installed business",
      address: "Configured collection address",
    });
    expect(configured.collectionAddress).toBe("Configured collection address");
    expect(configured.enabledCollectionMethods).toEqual(["warehouse_collection", "office_collection"]);
    expect(configured.freeLocalDelivery).toEqual({
      origin: { latitude: 53.8, longitude: -1.6 },
      radiusMiles: 12,
    });
    expect(isShopShippingMethodEnabled("free_local", configured)).toBe(true);
  });

  it("rejects stale and incomplete enabled local-delivery configuration", () => {
    const configuration = resolveShopShippingConfiguration({
      shop_free_local_delivery_enabled: "true",
      shop_free_local_delivery_latitude: "91",
      shop_free_local_delivery_longitude: "-1.6",
      shop_free_local_delivery_radius_miles: "12",
    }, { address: "Configured collection address" });

    expect(configuration.freeLocalDelivery).toBeNull();
    expect(isShopShippingMethodEnabled("free_local", configuration)).toBe(false);
    expect(isShopShippingMethodEnabled("not-a-shipping-method", configuration)).toBe(false);
  });
});

describe("public shop order logo handling", () => {
  it("keeps an uploaded logo on the pending order without changing a matched profile", () => {
    const routeSource = readFileSync(new URL("../src/routes/shop.ts", import.meta.url), "utf8");

    expect(routeSource).toContain("const logoNote = logoSource === \"on_file\"");
    expect(routeSource).toContain("Logo: ${orderLogo.name} (${orderLogo.url})");
    expect(routeSource).not.toContain("customersTable");
    expect(routeSource).not.toContain("set({ logoUrl: orderLogo.url");
  });
});