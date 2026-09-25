import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export function applyVars(
  template: string,
  vars: Record<string, string | null | undefined>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

export async function getTemplate(
  key: string,
): Promise<{ subject: string | null; body: string } | null> {
  try {
    const result = await db.execute(
      sql`SELECT subject, body FROM message_templates WHERE key = ${key} LIMIT 1`,
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0] as any;
    return { subject: row.subject ?? null, body: row.body ?? "" };
  } catch {
    return null;
  }
}
