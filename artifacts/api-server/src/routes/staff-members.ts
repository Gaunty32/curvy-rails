import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, staffMembersTable } from "@workspace/db";
import { z } from "zod";

const router: IRouter = Router();

// POST /staff/rewrite-quote uses AI_INTEGRATIONS_OPENAI_BASE_URL/API_KEY and
// requires installation_activated=true plus integration_enabled.openai=true.
async function assertOpenAiEnabled(): Promise<void> {
  const result = await db.execute(sql`
    SELECT key, value FROM settings
    WHERE key IN ('installation_activated', 'integration_enabled')
  `);
  const settings = new Map<string, string>(
    ((result.rows ?? result) as Array<{ key: string; value: string | null }>)
      .map((row) => [row.key, row.value ?? ""]),
  );
  if (settings.get("installation_activated") !== "true") {
    throw new Error("Outbound OpenAI request blocked until installation activation.");
  }
  let integrations: unknown;
  try { integrations = JSON.parse(settings.get("integration_enabled") ?? "null"); } catch {
    throw new Error("Outbound integration capability state is invalid; requests are blocked.");
  }
  if (!integrations || typeof integrations !== "object" || Array.isArray(integrations)
    || (integrations as Record<string, unknown>).openai !== true) {
    throw new Error("OpenAI integration is not explicitly enabled.");
  }
}

router.get("/staff", async (_req, res): Promise<void> => {
  const members = await db.select().from(staffMembersTable).orderBy(staffMembersTable.name);
  res.json(members);
});

router.post("/staff", async (req, res): Promise<void> => {
  const body = z.object({
    name: z.string().min(1),
    role: z.string().nullish(),
    profileImageUrl: z.string().nullish(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [member] = await db.insert(staffMembersTable).values({
    name: body.data.name,
    role: body.data.role ?? null,
    profileImageUrl: body.data.profileImageUrl ?? null,
  }).returning();
  res.json(member);
});

router.patch("/staff/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = z.object({
    name: z.string().min(1).optional(),
    role: z.string().nullish(),
    profileImageUrl: z.string().nullish(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const update: Record<string, unknown> = {};
  if (body.data.name !== undefined) update.name = body.data.name;
  if ("role" in req.body) update.role = body.data.role ?? null;
  if ("profileImageUrl" in req.body) update.profileImageUrl = body.data.profileImageUrl ?? null;
  const [member] = await db.update(staffMembersTable).set(update).where(eq(staffMembersTable.id, id)).returning();
  if (!member) { res.status(404).json({ error: "Not found" }); return; }
  res.json(member);
});

router.delete("/staff/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(staffMembersTable).where(eq(staffMembersTable.id, id));
  res.status(204).end();
});

router.post("/staff/rewrite-quote", async (req, res): Promise<void> => {
  const body = z.object({
    draft: z.string().min(1),
    staffName: z.string(),
    productName: z.string().optional(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  try {
    await assertOpenAiEnabled();
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "OpenAI integration is disabled." });
    return;
  }
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseUrl || !apiKey) { res.status(503).json({ error: "AI not configured" }); return; }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are writing in the voice of ${body.data.staffName}, a member of staff. Rewrite the draft as a genuine, warm recommendation addressed directly to the customer — use "you" not "I", as if ${body.data.staffName} is speaking to them in person. Friendly and natural, 2–3 sentences max. Return only the quote text itself, with no quotation marks and no preamble.`,
        },
        {
          role: "user",
          content: `${body.data.productName ? `Product: ${body.data.productName}\n\n` : ""}Draft: ${body.data.draft}`,
        },
      ],
      max_tokens: 200,
    }),
  });

  if (!response.ok) { res.status(502).json({ error: "AI request failed" }); return; }
  const data = await response.json() as any;
  const rewritten = (data.choices?.[0]?.message?.content ?? "").trim() || body.data.draft;
  res.json({ rewritten });
});

export default router;
