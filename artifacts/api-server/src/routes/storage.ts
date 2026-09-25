import { createHash, randomUUID } from "crypto";
import express, { Router, type IRouter, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ObjectStorageService, ObjectNotFoundError, objectStorageClient } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf",
  eps: "application/postscript", ai: "application/postscript",
  bmp: "image/bmp", tiff: "image/tiff", tif: "image/tiff",
};

function mimeFromName(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase();
  return (ext && EXT_MIME[ext]) ?? null;
}

const RequestUploadUrlBody = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().positive().max(25 * 1024 * 1024),
  contentType: z.string().min(1).max(255),
});

type StorageIdentity =
  | { kind: "staff"; ownerScope: string }
  | { kind: "customer"; ownerScope: string };

const GUEST_IMAGE_TYPES: Record<string, { extension: string; contentType: string }> = {
  "image/jpeg": { extension: "jpg", contentType: "image/jpeg" },
  "image/png": { extension: "png", contentType: "image/png" },
  "image/gif": { extension: "gif", contentType: "image/gif" },
  "image/webp": { extension: "webp", contentType: "image/webp" },
};
const GUEST_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const GUEST_GRANT_TTL_SECONDS = 10 * 60;
const GUEST_GRANT_WINDOW_MS = 10 * 60 * 1000;
const GUEST_GRANT_LIMIT = 5;
const guestGrantRequests = new Map<string, { count: number; resetAt: number }>();
const consumedGuestGrants = new Map<string, number>();

function ownerScope(identity: string, secret: string): string {
  return createHash("sha256").update(`${secret}:${identity}`).digest("hex");
}

function guestGrantSecret(): string | null {
  const secret = process.env.SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

function guestGrantRateLimited(req: Request): boolean {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  for (const [ip, entry] of guestGrantRequests) {
    if (entry.resetAt <= now) guestGrantRequests.delete(ip);
  }
  if (guestGrantRequests.size >= 10_000 && !guestGrantRequests.has(key)) {
    const oldest = guestGrantRequests.keys().next().value;
    if (oldest) guestGrantRequests.delete(oldest);
  }
  const current = guestGrantRequests.get(key);
  if (!current || current.resetAt <= now) {
    guestGrantRequests.set(key, { count: 1, resetAt: now + GUEST_GRANT_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > GUEST_GRANT_LIMIT;
}

function guestImageExtension(name: string, contentType: string): string | null {
  const type = GUEST_IMAGE_TYPES[contentType.toLowerCase()];
  const extension = name.split(".").pop()?.toLowerCase();
  if (!type || !extension || !/^[a-z0-9]{1,10}$/.test(extension)) return null;
  const extensionType = extension === "jpeg" ? "image/jpeg" : `image/${extension}`;
  return extensionType === type.contentType ? type.extension : null;
}

function guestImageBytesMatch(contentType: string, bytes: Buffer): boolean {
  switch (contentType) {
    case "image/jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/gif":
      return bytes.length >= 6 && (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a");
    case "image/webp":
      return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
    default:
      return false;
  }
}

/**
 * Only application identities are accepted. Portal ownership is tenant-scoped:
 * members of the same customer account can use its uploaded order/profile files.
 */
function authenticateStorageRequest(req: Request): StorageIdentity | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const staffSecret = process.env.PORTAL_JWT_SECRET;
  const shopSecret = process.env.SESSION_SECRET;

  if (staffSecret && staffSecret.length >= 32) {
    try {
      const payload = jwt.verify(token, staffSecret) as Record<string, unknown>;
      if (payload.role === "staff" && payload.setup !== true && typeof payload.email === "string" && payload.email) {
        const identity = `staff:${payload.email.toLowerCase()}`;
        return { kind: "staff", ownerScope: ownerScope(identity, staffSecret) };
      }
      if (
        Number.isSafeInteger(payload.customerId) && Number(payload.customerId) > 0 &&
        typeof payload.portalRole === "string"
      ) {
        return {
          kind: "customer",
          ownerScope: ownerScope(`portal-customer:${payload.customerId}`, staffSecret),
        };
      }
    } catch {
      // A token can belong to the shop authentication scheme below.
    }
  }

  if (shopSecret && shopSecret.length >= 32) {
    try {
      const payload = jwt.verify(token, shopSecret) as Record<string, unknown>;
      if (payload.role === "shop_customer" && (typeof payload.sub === "string" || Number.isSafeInteger(payload.sub))) {
        return {
          kind: "customer",
          ownerScope: ownerScope(`shop-customer:${String(payload.sub)}`, shopSecret),
        };
      }
    } catch {
      // Invalid or expired bearer tokens are rejected below.
    }
  }
  return null;
}

/**
 * A guest grant is deliberately upload-only, one-use, image-only, and bound to
 * the exact file metadata approved when it was minted. It is never accepted by
 * the private-object read route.
 */
function consumeGuestUploadGrant(
  req: Request,
  file: z.infer<typeof RequestUploadUrlBody>,
): StorageIdentity | null {
  const auth = req.headers.authorization;
  const secret = guestGrantSecret();
  if (!auth?.startsWith("Bearer ") || !secret) return null;

  try {
    const payload = jwt.verify(auth.slice(7), secret, {
      issuer: "api-storage",
      audience: "checkout-upload",
    }) as Record<string, unknown>;
    const extension = guestImageExtension(file.name, file.contentType);
    const now = Date.now();
    for (const [jti, expiresAt] of consumedGuestGrants) {
      if (expiresAt <= now) consumedGuestGrants.delete(jti);
    }
    if (
      payload.scope !== "checkout-image-upload" ||
      typeof payload.jti !== "string" ||
      consumedGuestGrants.has(payload.jti) ||
      !extension ||
      file.size > GUEST_IMAGE_MAX_BYTES ||
      payload.size !== file.size ||
      payload.contentType !== file.contentType.toLowerCase() ||
      payload.extension !== extension
    ) return null;
    consumedGuestGrants.set(payload.jti, typeof payload.exp === "number" ? payload.exp * 1000 : now);
    return {
      kind: "customer",
      ownerScope: ownerScope(`checkout-guest:${payload.jti}`, secret),
    };
  } catch {
    return null;
  }
}

async function requireActivatedStorage(
  res: Response,
  kind: "private" | "public",
): Promise<boolean> {
  try {
    const [activation] = await db.select({ value: settingsTable.value })
      .from(settingsTable)
      .where(eq(settingsTable.key, "installation_activated"));
    if (activation?.value !== "true") {
      res.status(423).json({ error: "Storage is unavailable until installation activation." });
      return false;
    }
  } catch {
    res.status(503).json({ error: "Installation state is unavailable; storage access is blocked." });
    return false;
  }

  try {
    if (kind === "private") objectStorageService.getPrivateObjectDir();
    else objectStorageService.getPublicObjectSearchPaths();
  } catch {
    res.status(503).json({ error: "Object storage is not configured." });
    return false;
  }
  return true;
}

/**
 * POST /storage/uploads/guest-grant
 *
 * Mint a one-use grant for a single checkout image. Rate limits are per client
 * address; only a narrow set of raster image formats and a 5 MiB maximum pass.
 */
router.post("/storage/uploads/guest-grant", async (req: Request, res: Response) => {
  if (!await requireActivatedStorage(res, "private")) return;
  const secret = guestGrantSecret();
  if (!secret) {
    res.status(503).json({ error: "Guest checkout uploads are not configured." });
    return;
  }
  if (guestGrantRateLimited(req)) {
    res.status(429).json({ error: "Too many checkout upload grants. Please try again later." });
    return;
  }

  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }
  const { name, size, contentType } = parsed.data;
  const extension = guestImageExtension(name, contentType);
  if (!extension || size > GUEST_IMAGE_MAX_BYTES) {
    res.status(400).json({ error: "Checkout uploads must be JPEG, PNG, GIF, or WebP images no larger than 5 MiB." });
    return;
  }

  const grant = jwt.sign({
    scope: "checkout-image-upload",
    size,
    contentType: contentType.toLowerCase(),
    extension,
  }, secret, {
    expiresIn: GUEST_GRANT_TTL_SECONDS,
    issuer: "api-storage",
    audience: "checkout-upload",
    jwtid: randomUUID(),
  });
  res.json({ grant, expiresIn: GUEST_GRANT_TTL_SECONDS });
});

/**
 * POST /storage/uploads/guest-upload
 *
 * The one-use grant authorizes the bounded request body itself, rather than
 * returning an unrestricted signed PUT URL whose actual payload size/type
 * could differ from the metadata checked when requesting that URL.
 */
router.post(
  "/storage/uploads/guest-upload",
  express.raw({ type: "image/*", limit: GUEST_IMAGE_MAX_BYTES }),
  async (req: Request, res: Response) => {
    if (!await requireActivatedStorage(res, "private")) return;
    const secret = guestGrantSecret();
    if (!secret) {
      res.status(503).json({ error: "Guest checkout uploads are not configured." });
      return;
    }
    if (!Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: "A JPEG, PNG, GIF, or WebP image body is required." });
      return;
    }
    let name = "";
    try {
      name = decodeURIComponent(String(req.headers["x-upload-name"] || ""));
    } catch {
      res.status(400).json({ error: "Invalid upload file name." });
      return;
    }
    const contentType = String(req.headers["content-type"] || "").toLowerCase();
    const file = { name, size: req.body.length, contentType };
    if (
      !name ||
      name.length > 255 ||
      req.body.length > GUEST_IMAGE_MAX_BYTES ||
      !guestImageExtension(name, contentType) ||
      !guestImageBytesMatch(contentType, req.body)
    ) {
      res.status(400).json({ error: "Checkout uploads must be JPEG, PNG, GIF, or WebP images no larger than 5 MiB." });
      return;
    }
    const identity = consumeGuestUploadGrant(req, file);
    if (!identity) {
      res.status(401).json({ error: "Not authenticated or the checkout upload grant is invalid, expired, or already used." });
      return;
    }

    try {
      const extension = guestImageExtension(name, contentType)!;
      const privateDir = objectStorageService.getPrivateObjectDir().replace(/^\/+|\/+$/g, "");
      const [bucketName, ...prefixParts] = privateDir.split("/");
      if (!bucketName) throw new Error("Invalid PRIVATE_OBJECT_DIR");
      const objectFileName = `${identity.ownerScope}.${extension}`;
      const objectName = [...prefixParts, "uploads", identity.ownerScope, objectFileName].join("/");
      await objectStorageClient.bucket(bucketName).file(objectName).save(req.body, {
        resumable: false,
        metadata: { contentType },
        preconditionOpts: { ifGenerationMatch: 0 },
      });
      res.json({ objectPath: `/objects/uploads/${identity.ownerScope}/${objectFileName}` });
    } catch (error) {
      req.log.error({ err: error }, "Error storing guest checkout image");
      res.status(503).json({ error: "Failed to store checkout image." });
    }
  },
);

/**
 * POST /storage/uploads/request-url
 *
 * Returns a short-lived signed URL only to an authenticated application user.
 * New private objects are placed in a tenant-scoped path so subsequent reads
 * can enforce ownership without trusting client-supplied metadata.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }
  const identity = authenticateStorageRequest(req);
  if (!identity) {
    if (req.headers.authorization?.startsWith("Bearer ") && !guestGrantSecret()) {
      res.status(503).json({ error: "Guest checkout uploads are not configured." });
      return;
    }
    res.status(401).json({ error: "Not authenticated or the checkout upload grant is invalid or expired." });
    return;
  }
  if (!await requireActivatedStorage(res, "private")) return;

  try {
    const { name, size, contentType } = parsed.data;
    const extension = name.includes(".") ? name.split(".").pop()?.toLowerCase() : undefined;
    if (extension && !/^[a-z0-9]{1,10}$/.test(extension)) {
      res.status(400).json({ error: "Invalid file name extension" });
      return;
    }
    if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(contentType)) {
      res.status(400).json({ error: "Invalid content type" });
      return;
    }

    const uploadURL = await objectStorageService.getObjectEntityUploadURL(extension, identity.ownerScope);
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(503).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Public assets remain readable without a user token, but only from the
 * explicitly configured public object search paths after activation.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  if (!await requireActivatedStorage(res, "public")) return;
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    if (!filePath || filePath.split("/").some((part) => !part || part === "." || part === "..") || filePath.includes("\\")) {
      res.status(400).json({ error: "Invalid object path" });
      return;
    }
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const [metadata] = await file.getMetadata();
    const contentType = (metadata.contentType as string | undefined)?.trim() || mimeFromName(file.name) || "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=3600");
    if (metadata.size) res.setHeader("Content-Length", String(metadata.size));

    const stream = file.createReadStream();
    stream.on("error", (err) => {
      req.log.error({ err }, "Stream error serving public object");
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    if (!res.headersSent) res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Private reads require a live staff or customer token. Customers are limited
 * to objects uploaded under their own tenant scope; staff may access files for
 * normal operational work. Legacy unscoped objects remain staff-only because
 * they carry no verifiable ownership information.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  const identity = authenticateStorageRequest(req);
  if (!identity) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (!await requireActivatedStorage(res, "private")) return;

  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    if (!wildcardPath || wildcardPath.split("/").some((part) => !part || part === "." || part === "..") || wildcardPath.includes("\\")) {
      res.status(400).json({ error: "Invalid object path" });
      return;
    }
    const tenantPrefix = `uploads/${identity.ownerScope}/`;
    if (!wildcardPath.startsWith(tenantPrefix)) {
      res.status(403).json({ error: "You are not authorized to access this object" });
      return;
    }

    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const [metadata] = await objectFile.getMetadata();
    let contentType = (metadata.contentType as string | undefined)?.trim() || "";
    if (!contentType || contentType === "application/octet-stream") {
      contentType = mimeFromName(objectFile.name) || "application/octet-stream";
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    if (metadata.size) res.setHeader("Content-Length", String(metadata.size));

    const stream = objectFile.createReadStream();
    stream.on("error", (err) => {
      req.log.error({ err }, "Stream error serving object");
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    if (!res.headersSent) res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
