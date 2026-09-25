import { createHash } from "node:crypto";
import { isShopShippingMethodEnabled, type ShopShippingConfiguration } from "./business-config.js";

export type ShopShippingMethod =
  | "courier"
  | "free_local"
  | "warehouse_collection"
  | "office_collection";

export type ShopShippingTerms = {
  method: ShopShippingMethod;
  destination: string;
  postcode: string;
  fingerprint: string;
};

type Coordinates = { latitude: number; longitude: number };

function distanceMiles(from: Coordinates, to: Coordinates): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const earthRadiusMiles = 3958.7613;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
    Math.cos(radians(to.latitude)) *
    Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function normalizeShopPostcode(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function fingerprint(method: string, destination: string): string {
  return createHash("sha256").update(JSON.stringify({ method, destination })).digest("hex");
}

/** Validate shipping exactly once before payment and snapshot the approved terms. */
export function validateShopShippingEligibility(
  method: ShopShippingMethod,
  submittedPostcode: string | undefined,
  configuration: ShopShippingConfiguration,
  postcodeCoordinates: Coordinates | null,
): { terms: ShopShippingTerms } | { error: string } {
  if (!isShopShippingMethodEnabled(method, configuration)) {
    return { error: "That shipping method is not currently available." };
  }

  const postcode = normalizeShopPostcode(submittedPostcode ?? "");
  if (method !== "warehouse_collection" && method !== "office_collection" && !postcode) {
    return { error: "A delivery postcode is required before payment." };
  }
  if (method === "free_local") {
    if (!postcodeCoordinates) return { error: "Free Local Delivery requires a valid delivery postcode." };
    const delivery = configuration.freeLocalDelivery;
    if (!delivery) return { error: "That shipping method is not currently available." };
    if (distanceMiles(delivery.origin, postcodeCoordinates) > delivery.radiusMiles) {
      return { error: `Free Local Delivery is only available within ${delivery.radiusMiles} miles of the configured delivery area.` };
    }
  }

  const destination = method === "warehouse_collection" || method === "office_collection"
    ? configuration.collectionAddress ?? ""
    : postcode;
  if (!destination) return { error: "A delivery postcode is required before payment." };

  return {
    terms: {
      method,
      destination,
      postcode,
      fingerprint: fingerprint(method, destination),
    },
  };
}

/** Verify a payment intent's immutable shipping snapshot without current settings or geocoding. */
export function verifyShopShippingTerms(
  metadata: Record<string, string>,
  method: ShopShippingMethod,
  submittedPostcode: string,
): ShopShippingTerms | null {
  if (metadata.shipping_terms_version !== "1" ||
    metadata.shipping_eligible !== "true" ||
    metadata.shipping_method !== method ||
    !metadata.shipping_destination ||
    metadata.shipping_fingerprint !== fingerprint(method, metadata.shipping_destination)) {
    return null;
  }
  const postcode = normalizeShopPostcode(submittedPostcode);
  if (method === "free_local" && (!postcode || postcode !== metadata.shipping_postcode ||
    metadata.shipping_destination !== postcode)) {
    return null;
  }
  if (method === "courier" && (!postcode || postcode !== metadata.shipping_postcode ||
    metadata.shipping_destination !== postcode)) {
    return null;
  }
  if (method === "warehouse_collection" || method === "office_collection") {
    if (!metadata.shipping_destination.trim()) return null;
  }

  return {
    method,
    destination: metadata.shipping_destination,
    postcode: metadata.shipping_postcode ?? "",
    fingerprint: metadata.shipping_fingerprint,
  };
}