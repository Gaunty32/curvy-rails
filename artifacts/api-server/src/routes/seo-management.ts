import { Router, type IRouter, type RequestHandler } from "express";
import { timingSafeEqual, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { objectStorageClient } from "../lib/objectStorage";

const router: IRouter = Router();
const SECRET_NAME = "SELECT_INTELLIGENCE_SEO_API_SECRET";
const APPROVAL_SECRET_NAME = "SBS_SEO_APPROVAL_SECRET";
const STORAGE_ROOT = "seo-management/v1";
const MAX_BODY_BYTES = 50_000;

const standardTypes = [
  "titleTag",
  "metaDescription",
  "heading",
  "publicCopy",
  "internalLink",
  "imageAlt",
  "structuredData",
] as const;

const approvalOnlyTypes = [
  "newPage",
  "redirect",
  "navigation",
  "template",
  "legalContent",
  "pricing",
] as const;

const publicPathPattern = /^\/(?:$|products\/?$|about\/?$|contact\/?$|faq\/?$|reviews\/?$|personalisation\/?$|on-site-measuring\/?$|uniform-management\/?$|order-workwear\/?$|logo-conversions\/?$|bulk-buy-bundles\/?$|knowledge-centre(?:\/[a-z0-9-]+)?\/?$|product\/[a-z0-9-]+\/?$|category\/[a-z0-9-]+\/?$|bundle\/[a-z0-9-]+\/?$)/;
const forbiddenPathPattern = /^\/(?:cart|checkout|account|login|order-complete|terms|privacy|cookie-policy)(?:\/|$)/;
const seoKeySelectorPattern = /^\[data-seo-key="[a-zA-Z0-9_-]+"\]$/;
const headingSelectorPattern = /^(?:h[1-6]|\[data-seo-key="[a-zA-Z0-9_-]+"\])$/;
const linkSelectorPattern = /^a\[data-seo-key="[a-zA-Z0-9_-]+"\]$/;
const imageSelectorPattern = /^img\[data-seo-key="[a-zA-Z0-9_-]+"\]$/;

const standardChangeSchema = z.object({
  changeType: z.enum(standardTypes),
  pagePath: z.string().min(1).max(180),
  selector: z.string().max(240).optional(),
  value: z.union([z.string().max(10_000), z.record(z.string(), z.unknown())]),
  rationale: z.string().min(3).max(2_000),
  requestedBy: z.enum(["Select Intelligence", "Maya"]),
});

const approvalOnlyChangeSchema = z.object({
  changeType: z.enum(approvalOnlyTypes),
  pagePath: z.string().min(1).max(180).optional(),
  summary: z.string().min(3).max(5_000),
  rationale: z.string().min(3).max(2_000),
  requestedBy: z.enum(["Select Intelligence", "Maya"]),
});

type StandardChange = z.infer<typeof standardChangeSchema>;

interface ProposalRecord {
  id: string;
  proposalDigest?: string;
  classification: "standard" | "approval_only";
  status: "proposed" | "applying" | "applied" | "approval_only";
  createdAt: string;
  appliedAt?: string;
  approvedBy?: string;
  approvalReference?: string;
  change: StandardChange | z.infer<typeof approvalOnlyChangeSchema>;
}

interface AuditEvent {
  id: string;
  timestamp: string;
  action: "proposed" | "previewed" | "approved" | "applied" | "apply_rejected";
  proposalId: string;
  actor: string;
  changeType: string;
  pagePath?: string;
  requestId?: string;
  approvalReference?: string;
}

interface StaffApproval {
  proposalId: string;
  proposalDigest: string;
  approvedAt: string;
  approvedBy: string;
  approvalReference: string;
  recordedAt: string;
}

function changeDigest(change: ProposalRecord["change"]): string {
  return createHash("sha256").update(JSON.stringify(change)).digest("hex");
}

function privateFile(relativePath: string) {
  const configured = process.env.PRIVATE_OBJECT_DIR;
  if (!configured) throw new Error("PRIVATE_OBJECT_DIR is not configured");
  const parts = configured.replace(/^gs:\/\//, "").split("/").filter(Boolean);
  if (parts.length < 1) throw new Error("PRIVATE_OBJECT_DIR is invalid");
  const bucketName = parts[0];
  const base = parts.slice(1).join("/");
  return objectStorageClient.bucket(bucketName).file([base, STORAGE_ROOT, relativePath].filter(Boolean).join("/"));
}

async function readJson<T>(relativePath: string): Promise<T | null> {
  const result = await readJsonWithGeneration<T>(relativePath);
  return result?.value ?? null;
}

async function readJsonWithGeneration<T>(relativePath: string): Promise<{ value: T; generation: string } | null> {
  const file = privateFile(relativePath);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const [metadata] = await file.getMetadata();
      const generation = String(metadata.generation);
      const exactVersion = file.bucket.file(file.name, { generation });
      const [contents] = await exactVersion.download();
      return { value: JSON.parse(contents.toString("utf8")) as T, generation };
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code === 404 && attempt === 0) {
        const [exists] = await file.exists();
        if (!exists) return null;
      }
      if ((code === 404 || code === 412) && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("Unable to read a consistent object generation");
}

async function writeJson(relativePath: string, value: unknown, createOnly = false): Promise<void> {
  const file = privateFile(relativePath);
  await file.save(JSON.stringify(value), {
    resumable: false,
    contentType: "application/json",
    preconditionOpts: createOnly ? { ifGenerationMatch: 0 } : undefined,
    metadata: { cacheControl: "private, no-store" },
  });
}

async function writeJsonAtGeneration(relativePath: string, value: unknown, generation: string): Promise<void> {
  const file = privateFile(relativePath);
  await file.save(JSON.stringify(value), {
    resumable: false,
    contentType: "application/json",
    preconditionOpts: { ifGenerationMatch: Number(generation) },
    metadata: { cacheControl: "private, no-store" },
  });
}

async function audit(event: Omit<AuditEvent, "id" | "timestamp">): Promise<void> {
  const timestamp = new Date().toISOString();
  const record: AuditEvent = { id: randomUUID(), timestamp, ...event };
  const sortableTime = timestamp.replace(/[:.]/g, "-");
  await writeJson(`audit/${sortableTime}-${record.id}.json`, record, true);
}

async function auditAppliedOnce(record: ProposalRecord, approval: StaffApproval, appliedAt: string): Promise<void> {
  const event: AuditEvent = {
    id: `applied:${record.id}`,
    timestamp: appliedAt,
    action: "applied",
    proposalId: record.id,
    actor: "Maya SEO API",
    changeType: record.change.changeType,
    pagePath: record.change.pagePath,
    approvalReference: approval.approvalReference,
  };
  const sortableTime = record.createdAt.replace(/[:.]/g, "-");
  try {
    await writeJson(`audit/${sortableTime}-applied-${record.id}.json`, event, true);
  } catch (error) {
    if ((error as { code?: number }).code !== 412) throw error;
  }
}

async function auditApprovedOnce(record: ProposalRecord, approval: StaffApproval): Promise<void> {
  const event: AuditEvent = {
    id: `approved:${record.id}`,
    timestamp: approval.recordedAt,
    action: "approved",
    proposalId: record.id,
    actor: "Select Intelligence approval service",
    changeType: record.change.changeType,
    pagePath: record.change.pagePath,
    approvalReference: approval.approvalReference,
  };
  const sortableTime = record.createdAt.replace(/[:.]/g, "-");
  try {
    await writeJson(`audit/${sortableTime}-approved-${record.id}.json`, event, true);
  } catch (error) {
    if ((error as { code?: number }).code !== 412) throw error;
  }
}

function validPublicPath(path: string): boolean {
  return publicPathPattern.test(path) && !forbiddenPathPattern.test(path) && !path.includes("..") && !path.includes("?");
}

function validateStandardChange(change: StandardChange): string | null {
  if (!validPublicPath(change.pagePath)) return "pagePath is not an approved public website route";
  if (change.changeType === "heading" && (!change.selector || !headingSelectorPattern.test(change.selector))) return "Headings may target one heading or an explicit data-seo-key";
  if (change.changeType === "publicCopy" && (!change.selector || !seoKeySelectorPattern.test(change.selector))) return "Public copy requires an explicit data-seo-key target";
  if (change.changeType === "internalLink" && (!change.selector || !linkSelectorPattern.test(change.selector))) return "Internal links require an explicit anchor data-seo-key target";
  if (change.changeType === "imageAlt" && (!change.selector || !imageSelectorPattern.test(change.selector))) return "Image alt text requires an explicit image data-seo-key target";
  if (change.changeType === "internalLink") {
    if (typeof change.value !== "string" || !validPublicPath(change.value)) return "Internal links must point to an approved public website route";
  }
  if (change.changeType === "structuredData") {
    if (typeof change.value !== "object" || Array.isArray(change.value) || change.value === null) return "Structured data must be a JSON object";
    const serialized = JSON.stringify(change.value);
    if (/<\/?script|javascript:|__proto__|constructor/i.test(serialized)) return "Structured data contains a forbidden value";
  } else if (typeof change.value !== "string") {
    return "This change type requires a text value";
  }
  return null;
}

function suppliedSecret(req: Parameters<RequestHandler>[0]): string {
  const auth = req.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

const authenticate: RequestHandler = (req, res, next) => {
  const expected = process.env[SECRET_NAME];
  const supplied = suppliedSecret(req);
  if (!expected || !supplied) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const expectedHash = createHash("sha256").update(expected).digest();
  const suppliedHash = createHash("sha256").update(supplied).digest();
  if (!timingSafeEqual(expectedHash, suppliedHash)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

const requestWindows = new Map<string, number[]>();
const rateLimit: RequestHandler = (req, res, next) => {
  const key = req.ip ?? "unknown";
  const now = Date.now();
  const recent = (requestWindows.get(key) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= 60) {
    res.status(429).json({ error: "Rate limit exceeded" });
    return;
  }
  recent.push(now);
  requestWindows.set(key, recent);
  next();
};

const requireStaffApprovalAuth: RequestHandler = (req, res, next) => {
  const auth = req.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    res.status(401).json({ error: "Approval authentication required" });
    return;
  }
  const expected = process.env[APPROVAL_SECRET_NAME];
  if (!expected) {
    res.status(503).json({ error: "Approval authentication is not configured" });
    return;
  }
  const expectedHash = createHash("sha256").update(expected).digest();
  const suppliedHash = createHash("sha256").update(auth.slice(7)).digest();
  if (!timingSafeEqual(expectedHash, suppliedHash)) {
    res.status(401).json({ error: "Invalid approval credential" });
    return;
  }
  next();
};

router.post("/maya-seo/approve", rateLimit, requireStaffApprovalAuth, async (req, res): Promise<void> => {
  const body = z.object({
    proposalId: z.string().uuid(),
    approvalReference: z.string().min(2).max(200),
    approvedBy: z.string().min(2).max(120),
    approvedAt: z.string().datetime({ offset: true }),
  }).strict().safeParse(req.body);
  if (!body.success) {
    res.status(400).json({
      error: "proposalId, approvalReference, approvedBy and an ISO-8601 approvedAt are required",
    });
    return;
  }
  const approvedAtMs = Date.parse(body.data.approvedAt);
  const now = Date.now();
  if (approvedAtMs > now + 5 * 60_000 || approvedAtMs < now - 5 * 60_000) {
    res.status(400).json({ error: "approvedAt must be within five minutes of the server time" });
    return;
  }

  const proposal = await readJson<ProposalRecord>(`proposals/${body.data.proposalId}.json`);
  if (!proposal) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  const currentDigest = changeDigest(proposal.change);
  if (!proposal.proposalDigest || proposal.proposalDigest !== currentDigest) {
    res.status(409).json({ error: "Proposal content has changed since preview and cannot be approved" });
    return;
  }
  if (approvedAtMs < Date.parse(proposal.createdAt) - 5_000) {
    res.status(400).json({ error: "approvedAt cannot be earlier than the proposal" });
    return;
  }

  const approval: StaffApproval = {
    proposalId: proposal.id,
    proposalDigest: currentDigest,
    approvedAt: new Date(approvedAtMs).toISOString(),
    approvedBy: body.data.approvedBy,
    approvalReference: body.data.approvalReference,
    recordedAt: new Date().toISOString(),
  };
  const existingApproval = await readJson<StaffApproval>(`approvals/${proposal.id}.json`);
  if (existingApproval) {
    if (
      existingApproval.proposalId !== approval.proposalId ||
      existingApproval.proposalDigest !== approval.proposalDigest ||
      existingApproval.approvedAt !== approval.approvedAt ||
      existingApproval.approvedBy !== approval.approvedBy ||
      existingApproval.approvalReference !== approval.approvalReference
    ) {
      res.status(409).json({ error: "Proposal already has a different approval" });
      return;
    }
  } else if (proposal.classification !== "standard" || proposal.status !== "proposed") {
    res.status(409).json({ error: "Only pending standard SEO proposals can be approved" });
    return;
  }

  let persistedApproval = existingApproval ?? approval;
  try {
    if (!existingApproval) await writeJson(`approvals/${proposal.id}.json`, approval, true);
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 412) {
      const existing = await readJson<StaffApproval>(`approvals/${proposal.id}.json`);
      if (
        !existing ||
        existing.proposalId !== approval.proposalId ||
        existing.proposalDigest !== approval.proposalDigest ||
        existing.approvedAt !== approval.approvedAt ||
        existing.approvedBy !== approval.approvedBy ||
        existing.approvalReference !== approval.approvalReference
      ) {
        res.status(409).json({ error: "Proposal already has a different approval" });
        return;
      }
      persistedApproval = existing;
    } else {
      throw error;
    }
  }
  await auditApprovedOnce(proposal, persistedApproval);
  res.status(200).json({
    proposalId: proposal.id,
    proposalDigest: currentDigest,
    classification: proposal.classification,
    status: "approved",
    change: proposal.change,
    approval: {
      approvalReference: persistedApproval.approvalReference,
      approvedBy: persistedApproval.approvedBy,
      approvedAt: persistedApproval.approvedAt,
      recordedAt: persistedApproval.recordedAt,
    },
  });
});

router.use("/seo-management", rateLimit, authenticate);
router.use("/maya-seo", rateLimit, authenticate);
// The original internal route shape was superseded by the exact Maya contract.
// Keep it unreachable so there is only one protected mutation surface.
router.use("/seo-management", (_req, res): void => {
  res.status(404).json({ error: "Not found" });
});

router.get("/maya-seo/capabilities", (_req, res): void => {
  res.json({
    scope: "public_website_only",
    authentication: {
      type: "bearer",
      headerName: "Authorization",
      headerFormat: "Bearer <secret>",
      secretName: SECRET_NAME,
    },
    approvalAuthentication: {
      endpoint: "POST /api/maya-seo/approve",
      type: "bearer",
      headerName: "Authorization",
      headerFormat: "Bearer <secret>",
      secretName: APPROVAL_SECRET_NAME,
      audience: "server-to-server only",
    },
    allowedChanges: standardTypes,
    approvalOnlyChanges: approvalOnlyTypes,
    forbiddenAreas: [
      "orders",
      "customers",
      "production",
      "financial_information",
      "authentication",
      "pricing",
      "checkout",
      "database_records",
      "internal_administration",
    ],
    approvedPublicPaths: [
      "/",
      "/products",
      "/product/:slug",
      "/category/:slug",
      "/bundle/:slug",
      "/about",
      "/contact",
      "/faq",
      "/reviews",
      "/knowledge-centre",
      "/knowledge-centre/:slug",
      "/personalisation",
      "/on-site-measuring",
      "/uniform-management",
      "/order-workwear",
      "/logo-conversions",
      "/bulk-buy-bundles",
    ],
    workflow: {
      preview: "POST /api/maya-seo/preview",
      approve: "POST /api/maya-seo/approve",
      apply: "POST /api/maya-seo/apply",
      audit: "GET /api/maya-seo/audit",
    },
  });
});

async function activeChangesForPath(pagePath: string): Promise<Array<{ id: string } & StandardChange>> {
  const prefixFile = privateFile(`active/${pagePath.replace(/[^a-z0-9]+/gi, "_")}/_`);
  const [files] = await prefixFile.bucket.getFiles({ prefix: prefixFile.name.replace(/_$/, ""), maxResults: 200 });
  return Promise.all(files.map(async (file) => {
    const [contents] = await file.download();
    const record = JSON.parse(contents.toString("utf8")) as ProposalRecord;
    return { id: record.id, ...(record.change as StandardChange) };
  }));
}

async function auditEvents(limit: number): Promise<AuditEvent[]> {
  const root = privateFile("audit/_").name.replace(/_$/, "");
  const bucket = privateFile("audit/_").bucket;
  const [files] = await bucket.getFiles({ prefix: root, maxResults: limit });
  return Promise.all(files.slice(-limit).reverse().map(async (file) => {
    const [contents] = await file.download();
    return JSON.parse(contents.toString("utf8")) as AuditEvent;
  }));
}

router.post("/maya-seo/preview", async (req, res): Promise<void> => {
  if (Buffer.byteLength(JSON.stringify(req.body ?? {}), "utf8") > MAX_BODY_BYTES) {
    res.status(413).json({ error: "Request is too large" });
    return;
  }

  const standard = standardChangeSchema.safeParse(req.body);
  const major = approvalOnlyChangeSchema.safeParse(req.body);
  if (!standard.success && !major.success) {
    res.status(400).json({ error: "Request does not match an approved SEO change or approval-only proposal" });
    return;
  }

  if (standard.success) {
    const validationError = validateStandardChange(standard.data);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }
  }

  const id = randomUUID();
  const proposedChange = standard.success ? standard.data : major.data;
  const proposalDigest = changeDigest(proposedChange);
  const record: ProposalRecord = standard.success
    ? { id, proposalDigest, classification: "standard", status: "proposed", createdAt: new Date().toISOString(), change: standard.data }
    : { id, proposalDigest, classification: "approval_only", status: "approval_only", createdAt: new Date().toISOString(), change: major.data };
  await writeJson(`proposals/${id}.json`, record, true);

  let before: unknown = null;
  if (standard.success) {
    const existing = await activeChangesForPath(standard.data.pagePath);
    const previous = [...existing].reverse().find((change) =>
      change.changeType === standard.data.changeType &&
      (change.selector ?? null) === (standard.data.selector ?? null)
    );
    before = previous?.value ?? null;
  }

  await audit({
    action: "proposed",
    proposalId: id,
    actor: record.change.requestedBy,
    changeType: record.change.changeType,
    pagePath: record.change.pagePath,
    requestId: String(req.id ?? ""),
  });
  await audit({
    action: "previewed",
    proposalId: id,
    actor: record.change.requestedBy,
    changeType: record.change.changeType,
    pagePath: record.change.pagePath,
    requestId: String(req.id ?? ""),
  });

  res.status(201).json({
    proposalId: id,
    proposalDigest,
    classification: record.classification,
    status: record.status,
    preview: standard.success
      ? { pagePath: standard.data.pagePath, changeType: standard.data.changeType, selector: standard.data.selector ?? null, before, after: standard.data.value }
      : { before: null, after: null, message: "Manual approval required; this change cannot be applied through the API" },
  });
});

router.post("/maya-seo/apply", async (req, res): Promise<void> => {
  const parsed = z.object({
    proposalId: z.string().uuid(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid proposalId is required" });
    return;
  }

  const proposalPath = `proposals/${parsed.data.proposalId}.json`;
  let proposalState = await readJsonWithGeneration<ProposalRecord>(proposalPath);
  if (!proposalState) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  let record = proposalState.value;
  if (record.classification === "approval_only") {
    await audit({
      action: "apply_rejected",
      proposalId: record.id,
      actor: record.change.requestedBy,
      changeType: record.change.changeType,
      pagePath: record.change.pagePath,
      requestId: String(req.id ?? ""),
    });
    res.status(403).json({ error: "This major change is approval-only and cannot be applied through this API" });
    return;
  }
  if (record.status === "applied" && record.appliedAt) {
    res.json({ proposalId: record.id, status: "applied", appliedAt: record.appliedAt });
    return;
  }
  const approval = await readJson<StaffApproval>(`approvals/${record.id}.json`);
  const expectedDigest = createHash("sha256").update(JSON.stringify(record.change)).digest("hex");
  if (!approval || approval.proposalId !== record.id || approval.proposalDigest !== expectedDigest) {
    res.status(409).json({ error: "This proposal has not been independently approved by staff" });
    return;
  }

  let applying: ProposalRecord;
  if (record.status === "applying" && record.appliedAt) {
    applying = record;
  } else {
    applying = {
      ...record,
      status: "applying",
      appliedAt: new Date().toISOString(),
      approvedBy: approval.approvedBy,
      approvalReference: approval.approvalReference,
    };
    try {
      await writeJsonAtGeneration(proposalPath, applying, proposalState.generation);
    } catch (error) {
      if ((error as { code?: number }).code !== 412) throw error;
      proposalState = await readJsonWithGeneration<ProposalRecord>(proposalPath);
      if (!proposalState) throw error;
      record = proposalState.value;
      if (record.status === "applied" && record.appliedAt) {
        res.json({ proposalId: record.id, status: "applied", appliedAt: record.appliedAt });
        return;
      }
      if (record.status !== "applying" || !record.appliedAt) {
        res.status(409).json({ error: "Proposal state changed; retry the request" });
        return;
      }
      applying = record;
    }
  }

  try {
    await writeJson(`active/${applying.change.pagePath.replace(/[^a-z0-9]+/gi, "_")}/${applying.id}.json`, applying, true);
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 412) throw error;
    const existing = await readJson<ProposalRecord>(`active/${applying.change.pagePath.replace(/[^a-z0-9]+/gi, "_")}/${applying.id}.json`);
    if (!existing || existing.id !== applying.id || JSON.stringify(existing.change) !== JSON.stringify(applying.change)) throw error;
  }
  await auditAppliedOnce(applying, approval, applying.appliedAt!);

  const currentState = await readJsonWithGeneration<ProposalRecord>(proposalPath);
  if (!currentState) throw new Error("Proposal disappeared during apply");
  if (currentState.value.status !== "applied") {
    const applied: ProposalRecord = { ...applying, status: "applied" };
    try {
      await writeJsonAtGeneration(proposalPath, applied, currentState.generation);
    } catch (error) {
      if ((error as { code?: number }).code !== 412) throw error;
      const settled = await readJson<ProposalRecord>(proposalPath);
      if (!settled || settled.status !== "applied") throw error;
    }
  }
  res.json({ proposalId: applying.id, status: "applied", appliedAt: applying.appliedAt });
});

router.get("/maya-seo/audit", async (req, res): Promise<void> => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json({ events: await auditEvents(limit) });
});

router.post("/seo-management/proposals", async (req, res): Promise<void> => {
  if (Buffer.byteLength(JSON.stringify(req.body ?? {}), "utf8") > MAX_BODY_BYTES) {
    res.status(413).json({ error: "Request is too large" });
    return;
  }

  const standard = standardChangeSchema.safeParse(req.body);
  const major = approvalOnlyChangeSchema.safeParse(req.body);
  if (!standard.success && !major.success) {
    res.status(400).json({ error: "Request does not match an approved SEO change or approval-only proposal" });
    return;
  }

  if (standard.success) {
    const validationError = validateStandardChange(standard.data);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }
  }

  const id = randomUUID();
  const record: ProposalRecord = standard.success
    ? { id, classification: "standard", status: "proposed", createdAt: new Date().toISOString(), change: standard.data }
    : { id, classification: "approval_only", status: "approval_only", createdAt: new Date().toISOString(), change: major.data };

  await writeJson(`proposals/${id}.json`, record, true);
  await audit({
    action: "proposed",
    proposalId: id,
    actor: record.change.requestedBy,
    changeType: record.change.changeType,
    pagePath: record.change.pagePath,
    requestId: String(req.id ?? ""),
  });
  res.status(201).json({ id, classification: record.classification, status: record.status });
});

router.get("/seo-management/proposals/:id/preview", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const record = await readJson<ProposalRecord>(`proposals/${id}.json`);
  if (!record) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  await audit({
    action: "previewed",
    proposalId: id,
    actor: record.change.requestedBy,
    changeType: record.change.changeType,
    pagePath: record.change.pagePath,
    requestId: String(req.id ?? ""),
  });
  res.json({
    id: record.id,
    classification: record.classification,
    status: record.status,
    preview: record.classification === "standard" ? record.change : { summary: "Manual approval required", change: record.change },
  });
});

router.post("/seo-management/proposals/:id/apply", async (req, res): Promise<void> => {
  const approval = z.object({
    approvedBy: z.string().min(2).max(120),
    approvalReference: z.string().min(2).max(200),
  }).safeParse(req.body);
  if (!approval.success) {
    res.status(400).json({ error: "approvedBy and approvalReference are required" });
    return;
  }

  const id = String(req.params.id);
  const record = await readJson<ProposalRecord>(`proposals/${id}.json`);
  if (!record) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  if (record.classification === "approval_only") {
    await audit({
      action: "apply_rejected",
      proposalId: id,
      actor: record.change.requestedBy,
      changeType: record.change.changeType,
      pagePath: record.change.pagePath,
      requestId: String(req.id ?? ""),
      approvalReference: approval.data.approvalReference,
    });
    res.status(403).json({ error: "This major change is approval-only and cannot be applied through this API" });
    return;
  }
  if (record.status === "applied") {
    res.status(409).json({ error: "Proposal has already been applied" });
    return;
  }

  const appliedAt = new Date().toISOString();
  const applied = { ...record, status: "applied" as const, appliedAt, ...approval.data };
  await writeJson(`active/${record.change.pagePath.replace(/[^a-z0-9]+/gi, "_")}/${id}.json`, applied, true);
  await writeJson(`proposals/${id}.json`, applied);
  await audit({
    action: "applied",
    proposalId: id,
    actor: approval.data.approvedBy,
    changeType: record.change.changeType,
    pagePath: record.change.pagePath,
    requestId: String(req.id ?? ""),
    approvalReference: approval.data.approvalReference,
  });
  res.json({ id, status: "applied", appliedAt });
});

router.get("/seo-management/audit", async (req, res): Promise<void> => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json({ events: await auditEvents(limit) });
});

router.get("/public/seo-config", async (req, res): Promise<void> => {
  const parsed = z.object({ path: z.string().min(1).max(180) }).safeParse(req.query);
  if (!parsed.success || !validPublicPath(parsed.data.path)) {
    res.status(400).json({ error: "Invalid public page path" });
    return;
  }
  const changes = await activeChangesForPath(parsed.data.path);
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  res.json({ path: parsed.data.path, changes });
});

export default router;