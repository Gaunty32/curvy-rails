import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type BusinessConfig = {
  name?: string;
  tradingName?: string;
  website?: string;
  email?: string;
  phone?: string;
  whatsapp?: string | null;
  address?: string;
  logoUrl?: string;
  [key: string]: unknown;
};

export type ConfiguredBusinessIdentity = {
  name: string;
  email: string;
  phone: string;
  address?: string;
};

export type ShopShippingConfiguration = {
  collectionAddress: string | null;
  enabledCollectionMethods: Array<"warehouse_collection" | "office_collection">;
  freeLocalDelivery: {
    origin: { latitude: number; longitude: number };
    radiusMiles: number;
  } | null;
};

/** Shipping conveniences are unavailable unless staff explicitly enable and configure them. */
export function resolveShopShippingConfiguration(
  settings: Record<string, string | null>,
  business: BusinessConfig | null,
): ShopShippingConfiguration {
  const configuredNumber = (key: string): number => {
    const raw = settings[key]?.trim();
    return raw ? Number(raw) : Number.NaN;
  };
  const collectionAddress = business?.address?.trim() || null;
  const enabledCollectionMethods: ShopShippingConfiguration["enabledCollectionMethods"] = [];
  if (collectionAddress && settings["shop_warehouse_collection_enabled"] === "true") {
    enabledCollectionMethods.push("warehouse_collection");
  }
  if (collectionAddress && settings["shop_office_collection_enabled"] === "true") {
    enabledCollectionMethods.push("office_collection");
  }

  const latitude = configuredNumber("shop_free_local_delivery_latitude");
  const longitude = configuredNumber("shop_free_local_delivery_longitude");
  const radiusMiles = configuredNumber("shop_free_local_delivery_radius_miles");
  const freeLocalDelivery = settings["shop_free_local_delivery_enabled"] === "true"
    && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    && Number.isFinite(radiusMiles) && radiusMiles > 0
    ? { origin: { latitude, longitude }, radiusMiles }
    : null;

  return { collectionAddress, enabledCollectionMethods, freeLocalDelivery };
}

export function isShopShippingMethodEnabled(
  method: string,
  configuration: ShopShippingConfiguration,
): boolean {
  if (method === "courier") return true;
  if (method === "free_local") return configuration.freeLocalDelivery !== null;
  return configuration.enabledCollectionMethods.includes(method as "warehouse_collection" | "office_collection");
}

/** Read installation-owned identity only. Never supplies source-business defaults. */
export async function getBusinessConfig(): Promise<BusinessConfig | null> {
  const [row] = await db.select({ value: settingsTable.value })
    .from(settingsTable)
    .where(eq(settingsTable.key, "business_config"));
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === "object" ? parsed as BusinessConfig : null;
  } catch {
    return null;
  }
}

export async function requireBusinessConfig(): Promise<BusinessConfig> {
  const config = await getBusinessConfig();
  if (!config) throw new Error("Business configuration is not available; complete installation setup first.");
  return config;
}

/** Require the installed identity fields before placing them in customer-facing content. */
export async function requireConfiguredBusinessIdentity(options: { address?: boolean } = {}): Promise<ConfiguredBusinessIdentity> {
  const config = await requireBusinessConfig();
  const name = config.tradingName?.trim() || config.name?.trim();
  const email = config.email?.trim();
  const phone = config.phone?.trim();
  const address = config.address?.trim();
  const missing = [
    ...(!name ? ["business name"] : []),
    ...(!email ? ["business email"] : []),
    ...(!phone ? ["business phone"] : []),
    ...(options.address && !address ? ["business address"] : []),
  ];
  if (missing.length) {
    throw new Error(`Business configuration is incomplete: ${missing.join(", ")} is required for customer-facing content.`);
  }
  return { name: name!, email: email!, phone: phone!, ...(address ? { address } : {}) };
}

export function configuredBusinessName(config: BusinessConfig | null): string {
  const name = config?.tradingName?.trim() || config?.name?.trim();
  if (!name) throw new Error("Business configuration is incomplete: business name is required for customer-facing content.");
  return name;
}