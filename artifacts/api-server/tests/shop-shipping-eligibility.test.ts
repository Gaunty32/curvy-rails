import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, settingsTable: {} }));

import { resolveShopShippingConfiguration } from "../src/lib/business-config.js";
import {
  validateShopShippingEligibility,
  verifyShopShippingTerms,
} from "../src/lib/shop-shipping-eligibility.js";

const settings = {
  shop_free_local_delivery_enabled: "true",
  shop_free_local_delivery_latitude: "53.8",
  shop_free_local_delivery_longitude: "-1.6",
  shop_free_local_delivery_radius_miles: "10",
  shop_warehouse_collection_enabled: "true",
};
const business = { address: "1 Configured Road, Leeds" };

describe("shop payment shipping eligibility snapshots", () => {
  it("rejects collection methods that are not explicitly enabled", () => {
    const configuration = resolveShopShippingConfiguration({}, business);
    expect(validateShopShippingEligibility(
      "warehouse_collection",
      "",
      configuration,
      null,
    )).toEqual({ error: "That shipping method is not currently available." });
  });

  it("rejects free local delivery when the exact submitted postcode is outside the configured area", () => {
    const configuration = resolveShopShippingConfiguration(settings, business);
    expect(validateShopShippingEligibility(
      "free_local",
      "SW1A 1AA",
      configuration,
      { latitude: 51.501, longitude: -0.142 },
    )).toEqual({
      error: "Free Local Delivery is only available within 10 miles of the configured delivery area.",
    });
  });

  it("allows a paid retry against immutable intent terms after settings or geocoding change", () => {
    const originalConfiguration = resolveShopShippingConfiguration(settings, business);
    const validation = validateShopShippingEligibility(
      "free_local",
      "LS1 4AP",
      originalConfiguration,
      { latitude: 53.8, longitude: -1.6 },
    );
    expect("terms" in validation).toBe(true);
    if (!("terms" in validation)) return;

    const metadata = {
      shipping_terms_version: "1",
      shipping_eligible: "true",
      shipping_method: validation.terms.method,
      shipping_destination: validation.terms.destination,
      shipping_postcode: validation.terms.postcode,
      shipping_fingerprint: validation.terms.fingerprint,
    };
    // Current settings now disable local delivery and the lookup service is
    // unavailable; order recording validates only the intent snapshot.
    const changedConfiguration = resolveShopShippingConfiguration({}, null);
    expect(changedConfiguration.freeLocalDelivery).toBeNull();
    expect(verifyShopShippingTerms(metadata, "free_local", "ls1   4ap")).toEqual(validation.terms);
    expect(verifyShopShippingTerms(metadata, "free_local", "LS2 9XY")).toBeNull();
  });

  it("rejects altered or tampered shipping metadata", () => {
    const configuration = resolveShopShippingConfiguration(settings, business);
    const validation = validateShopShippingEligibility(
      "free_local",
      "LS1 4AP",
      configuration,
      { latitude: 53.8, longitude: -1.6 },
    );
    if (!("terms" in validation)) throw new Error(validation.error);
    const metadata = {
      shipping_terms_version: "1",
      shipping_eligible: "true",
      shipping_method: validation.terms.method,
      shipping_destination: validation.terms.destination,
      shipping_postcode: validation.terms.postcode,
      shipping_fingerprint: validation.terms.fingerprint,
    };
    expect(verifyShopShippingTerms({ ...metadata, shipping_eligible: "false" }, "free_local", "LS1 4AP")).toBeNull();
    expect(verifyShopShippingTerms({ ...metadata, shipping_destination: "LS2 9XY" }, "free_local", "LS1 4AP")).toBeNull();
  });

  it("binds courier payment terms to the submitted postcode", () => {
    const configuration = resolveShopShippingConfiguration({}, null);
    const validation = validateShopShippingEligibility("courier", "LS1 4AP", configuration, null);
    if (!("terms" in validation)) throw new Error(validation.error);
    const metadata = {
      shipping_terms_version: "1",
      shipping_eligible: "true",
      shipping_method: validation.terms.method,
      shipping_destination: validation.terms.destination,
      shipping_postcode: validation.terms.postcode,
      shipping_fingerprint: validation.terms.fingerprint,
    };
    expect(verifyShopShippingTerms(metadata, "courier", "LS1 4AP")).toEqual(validation.terms);
    expect(verifyShopShippingTerms(metadata, "courier", "LS2 9XY")).toBeNull();
  });
});