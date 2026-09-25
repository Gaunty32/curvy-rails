/**
 * DPD Local API v3.2 integration
 * Spec: api.dpdlocal.co.uk
 *
 * Required env vars:
 *   DPD_USERNAME        – DPD account username
 *   DPD_PASSWORD        – DPD account password (plain text; MD5-hashed internally per spec)
 *   DPD_ACCOUNT_NUMBER  – DPD account number (used in GeoClient header)
 *
 * Optional env vars:
 *   DPD_SENDER_NAME     – Business name shown on labels (or provide business_config)
 *   DPD_SENDER_LINE1    – Collection address street
 *   DPD_SENDER_TOWN     – Collection town / city
 *   DPD_SENDER_POSTCODE – Collection postcode
 *   DPD_NETWORK_CODE    – Service network code (default: "2^12" = Parcel Next Day)
 */

import { assertIntegrationOutboundAllowed } from "../setup/outbound-gate.js";

const DPD_BASE = "https://api.dpdlocal.co.uk";

function getConfig() {
  const required = [
    "DPD_USERNAME",
    "DPD_PASSWORD",
    "DPD_ACCOUNT_NUMBER",
  ] as const;

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`DPD not configured. Missing env vars: ${missing.join(", ")}`);
  }

  return {
    username: process.env.DPD_USERNAME!,
    password: process.env.DPD_PASSWORD!,
    accountNumber: process.env.DPD_ACCOUNT_NUMBER!,
    senderName: process.env.DPD_SENDER_NAME ?? "",
    senderLine1: process.env.DPD_SENDER_LINE1 ?? "",
    senderTown: process.env.DPD_SENDER_TOWN ?? "",
    senderPostcode: process.env.DPD_SENDER_POSTCODE ?? "",
    networkCode: process.env.DPD_NETWORK_CODE ?? "2^12",
  };
}

/**
 * Authenticate with DPD Local API.
 * Per spec (v3.2): base64-encode "username:password" as plain text — no hashing.
 * Returns a GeoSession token valid for the day.
 */
async function login(cfg: ReturnType<typeof getConfig>): Promise<string> {
  await assertIntegrationOutboundAllowed("dpd");
  const credentials = Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");
  const res = await fetch(`${DPD_BASE}/user/?action=login`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      GeoClient: `account/${cfg.accountNumber}`,
    },
  });

  if (res.status === 401) {
    throw new Error("DPD login failed: invalid username or password (HTTP 401)");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DPD login failed (${res.status}): ${body}`);
  }

  const json = await res.json() as { data?: { geoSession?: string }; error?: unknown };
  const session = json?.data?.geoSession;
  if (!session) {
    throw new Error(`DPD login succeeded but returned no geoSession. Response: ${JSON.stringify(json)}`);
  }
  return session;
}

export interface DpdDeliveryAddress {
  contactName: string;
  organisation?: string;
  line1: string;
  line2?: string;
  town: string;
  postcode: string;
  countryCode?: string;
  telephone?: string;
  email?: string;
  mobile?: string;
}

export interface BookConsignmentParams {
  orderNumber: string;
  delivery: DpdDeliveryAddress;
  numberOfParcels: number;
  totalWeightKg: number;
  collectionDate?: Date;
  networkCode?: string;
  customsValue?: number;
  parcelDescription?: string;
}

/**
 * The Channel Islands (Jersey, Guernsey, Alderney, Sark, Herm) use UK-style
 * postcodes (JE/GY) but sit outside the UK customs/VAT territory. DPD requires
 * a customs value and goods description on shipments there even though the
 * postcode looks domestic — omitting them causes "missing mandatory field"
 * errors that never occur for genuinely domestic UK addresses.
 */
export function isChannelIslandsPostcode(postcode: string | null | undefined): boolean {
  if (!postcode) return false;
  return /^\s*(JE|GY)\d/i.test(postcode.trim());
}

export interface ConsignmentResult {
  consignmentNumber: string;
  shipmentId: number;
  trackingUrl: string;
  labelHtml: string | null;
}

export async function bookDpdConsignment(params: BookConsignmentParams): Promise<ConsignmentResult> {
  await assertIntegrationOutboundAllowed("dpd");
  const cfg = getConfig();
  const geoSession = await login(cfg);

  const authHeaders = {
    "Content-Type": "application/json",
    Accept: "application/json",
    GeoClient: `account/${cfg.accountNumber}`,
    GeoSession: geoSession,
  };

  const collectionDate = (params.collectionDate ?? new Date()).toISOString().split("T")[0] + "T09:00:00";

  const shipmentPayload = {
    jobId: null,
    collectionOnDelivery: false,
    invoice: null,
    collectionDate,
    consolidate: false,
    consignment: [
      {
        consignmentNumber: null,
        consignmentRef: params.orderNumber,
        parcel: [],
        collectionDetails: {
          contactDetails: {
            contactName: cfg.senderName,
            telephone: "",
          },
          address: {
            organisation: cfg.senderName,
            countryCode: "GB",
            postcode: cfg.senderPostcode,
            street: cfg.senderLine1,
            locality: "",
            town: cfg.senderTown,
            county: "",
          },
        },
        deliveryDetails: {
          contactDetails: {
            contactName: params.delivery.contactName,
            telephone: params.delivery.telephone ?? "",
          },
          address: {
            organisation: params.delivery.organisation ?? params.delivery.contactName,
            countryCode: params.delivery.countryCode ?? "GB",
            postcode: params.delivery.postcode,
            street: params.delivery.line1,
            locality: params.delivery.line2 ?? "",
            town: params.delivery.town,
            county: "",
          },
          notificationDetails: {
            email: params.delivery.email ?? "",
            mobile: params.delivery.mobile ?? "",
          },
        },
        networkCode: params.networkCode ?? cfg.networkCode,
        numberOfParcels: params.numberOfParcels,
        totalWeight: params.totalWeightKg,
        shippingRef1: params.orderNumber.slice(0, 25),
        shippingRef2: "",
        shippingRef3: "",
        customsValue: params.customsValue ?? null,
        deliveryInstructions: "",
        parcelDescription: params.parcelDescription ?? "",
        liabilityValue: null,
        liability: false,
      },
    ],
  };

  await assertIntegrationOutboundAllowed("dpd");
  const shipRes = await fetch(`${DPD_BASE}/shipping/shipment`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(shipmentPayload),
  });

  if (!shipRes.ok) {
    const body = await shipRes.text();
    throw new Error(`DPD shipment booking failed (${shipRes.status}): ${body}`);
  }

  const shipJson = await shipRes.json() as {
    data?: {
      jobId?: number;
      shipmentId?: number;
      consolidated?: boolean;
      consignmentDetail?: Array<{ consignmentNumber?: string; parcelNumbers?: string[] }>;
    } | null;
    error?: { errorCode?: number | string; errorMessage?: string } | Array<{ errorCode?: number | string; errorMessage?: string }> | null;
  };

  // DPD returns error as either an object or an array of objects depending on version
  const shipError = Array.isArray(shipJson.error)
    ? (shipJson.error as Array<{ errorCode?: number | string; errorMessage?: string }>)[0]
    : (shipJson.error as { errorCode?: number | string; errorMessage?: string } | null);
  if (shipError?.errorCode) {
    throw new Error(`DPD error ${shipError.errorCode}: ${shipError.errorMessage}`);
  }

  const consignmentNumber = shipJson.data?.consignmentDetail?.[0]?.consignmentNumber ?? "";
  // DPD Local API returns jobId (used for label retrieval), not shipmentId
  const jobId = shipJson.data?.jobId ?? shipJson.data?.shipmentId ?? 0;

  console.log(`[DPD] Shipment created — consignment: ${consignmentNumber}, jobId: ${jobId}`);
  console.log(`[DPD] Full shipment response: ${JSON.stringify(shipJson.data)}`);

  // Fetch label HTML using the correct DPD Local label endpoint
  // Endpoint: GET /shipping/shipment/{shipmentId}/label/  (Accept: text/html)
  // Note: the older /user/label/{jobId} endpoint is deprecated by DPD and returns 404.
  let labelHtml: string | null = null;
  if (jobId) {
    try {
      const labelRes = await fetch(
        `${DPD_BASE}/shipping/shipment/${jobId}/label/`,
        {
          headers: {
            ...authHeaders,
            Accept: "text/html",
          },
        }
      );
      if (labelRes.ok) {
        labelHtml = await labelRes.text();
        console.log(`[DPD] Label fetched successfully for jobId ${jobId} (${labelHtml.length} chars)`);
      } else {
        const labelErr = await labelRes.text();
        console.error(`[DPD] Label fetch failed (${labelRes.status}): ${labelErr}`);
      }
    } catch (e) {
      console.error(`[DPD] Label fetch exception: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    console.error("[DPD] No jobId in shipment response — cannot fetch label. Full response:", JSON.stringify(shipJson));
  }

  return {
    consignmentNumber,
    shipmentId: jobId,
    trackingUrl: `https://track.dpdlocal.co.uk/search?reference=${consignmentNumber}&postcode=${encodeURIComponent(params.delivery.postcode)}`,
    labelHtml,
  };
}

export async function reprrintDpdLabel(jobId: number): Promise<string | null> {
  try {
    const cfg = getConfig();
    const geoSession = await login(cfg);
    const res = await fetch(`${DPD_BASE}/shipping/shipment/${jobId}/label/`, {
      headers: {
        "Content-Type": "application/json",
        Accept: "text/html",
        GeoClient: `account/${cfg.accountNumber}`,
        GeoSession: geoSession,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[DPD] Reprint label failed (${res.status}): ${body}`);
      return null;
    }
    return await res.text();
  } catch (e) {
    console.error(`[DPD] Reprint label exception: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

export function isDpdConfigured(): boolean {
  return ["DPD_USERNAME", "DPD_PASSWORD", "DPD_ACCOUNT_NUMBER"].every((k) => !!process.env[k]);
}

/**
 * Test connection by attempting a login.
 * Returns detailed diagnostics to surface in Settings.
 */
export async function testDpdConnection(): Promise<{ ok: boolean; message: string; accountNumber?: string }> {
  const cfg = (() => {
    try { return getConfig(); } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  })();

  if ("error" in cfg) {
    return { ok: false, message: cfg.error };
  }

  try {
    await login(cfg as ReturnType<typeof getConfig>);
    return {
      ok: true,
      message: "Connected successfully to DPD Local API. GeoSession token received.",
      accountNumber: (cfg as ReturnType<typeof getConfig>).accountNumber,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
}
