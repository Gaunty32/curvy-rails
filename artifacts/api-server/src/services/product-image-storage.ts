import { createHash } from "crypto";
import path from "path";
import { objectStorageClient } from "../lib/objectStorage.js";

const PRODUCT_IMAGE_PREFIX = "public/product-images";
const PUBLIC_ROUTE_PREFIX = "/api/storage/public-objects/product-images/";
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function filenameForUrl(sourceUrl: string): string {
  const parsed = new URL(sourceUrl);
  const filename = path.basename(parsed.pathname) || "product-image";
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  const hash = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 16);
  return `${hash}-${safeName}`;
}

function contentTypeFor(sourceUrl: string, responseContentType: string | null): string {
  const normalized = responseContentType?.split(";")[0].trim().toLowerCase();
  if (normalized?.startsWith("image/")) return normalized;
  const extension = path.extname(new URL(sourceUrl).pathname).toLowerCase();
  return IMAGE_MIME_BY_EXT[extension] ?? "application/octet-stream";
}

function detectedImageMimeType(data: Buffer): string | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.length >= 6 && (data.subarray(0, 6).toString() === "GIF87a" || data.subarray(0, 6).toString() === "GIF89a")) return "image/gif";
  if (data.length >= 12 && data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (data.length >= 2 && data.subarray(0, 2).toString() === "BM") return "image/bmp";
  if (data.length >= 4 && (data.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || data.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])))) return "image/tiff";

  const openingText = data.subarray(0, 512).toString("utf8").replace(/^\uFEFF?\s*/, "").toLowerCase();
  return openingText.startsWith("<svg") || openingText.startsWith("<?xml") && openingText.includes("<svg")
    ? "image/svg+xml"
    : null;
}

export function isStoredProductImageUrl(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith(PUBLIC_ROUTE_PREFIX));
}

/**
 * Checks a locally-stored product image by its bytes, rather than trusting a
 * filename or the object's declared MIME type. Older migration jobs could
 * preserve a WordPress HTML response under an image filename.
 */
export async function isStoredProductImageValid(value: string | null | undefined): Promise<boolean> {
  if (!isStoredProductImageUrl(value)) return true;

  const filename = decodeURIComponent(value.slice(PUBLIC_ROUTE_PREFIX.length));
  if (!filename || filename.includes("/") || filename.includes("\\")) return false;

  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) return false;

  try {
    const file = objectStorageClient.bucket(bucketId).file(`${PRODUCT_IMAGE_PREFIX}/${filename}`);
    const [exists] = await file.exists();
    if (!exists) return false;

    const [data] = await file.download();
    return detectedImageMimeType(data) !== null;
  } catch {
    return false;
  }
}

/**
 * Download a remote product image once and return the local, public serving URL.
 * Object names include a source-URL hash, so identical filenames in different
 * WordPress folders cannot overwrite one another.
 */
export async function persistProductImage(sourceUrl: string | null | undefined): Promise<string | null> {
  if (!sourceUrl) return null;
  if (!isHttpUrl(sourceUrl) || isStoredProductImageUrl(sourceUrl)) return sourceUrl;

  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error("Object storage is not configured");

  const filename = filenameForUrl(sourceUrl);
  const legacyFilename = path.basename(new URL(sourceUrl).pathname).replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  const objectName = `${PRODUCT_IMAGE_PREFIX}/${filename}`;
  const bucket = objectStorageClient.bucket(bucketId);
  const file = bucket.file(objectName);
  const [exists] = await file.exists();
  if (exists) {
    const [existingData] = await file.download();
    if (detectedImageMimeType(existingData)) return `${PUBLIC_ROUTE_PREFIX}${filename}`;
  }

  // Some images imported before collision-safe naming used their original
  // WordPress filename. Reuse only a verified image so legacy references can
  // be repaired even after the old host is unavailable.
  const legacyFile = bucket.file(`${PRODUCT_IMAGE_PREFIX}/${legacyFilename}`);
  const [legacyExists] = await legacyFile.exists();
  if (legacyExists) {
    const [legacyData] = await legacyFile.download();
    if (detectedImageMimeType(legacyData)) return `${PUBLIC_ROUTE_PREFIX}${legacyFilename}`;
  }

  const response = await fetch(sourceUrl, {
    headers: { Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Image download returned HTTP ${response.status}`);

  const body = Buffer.from(await response.arrayBuffer());
  const detectedType = detectedImageMimeType(body);
  if (!detectedType) throw new Error("Source did not return valid image data");

  await file.save(body, {
    contentType: detectedType || contentTypeFor(sourceUrl, response.headers.get("content-type")),
    resumable: false,
  });

  return `${PUBLIC_ROUTE_PREFIX}${filename}`;
}
