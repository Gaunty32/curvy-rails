import { db, orderLogsTable } from "@workspace/db";

export async function logOrderAction(
  orderId: number,
  action: string,
  actor: string,
  details?: string
): Promise<void> {
  try {
    await db.insert(orderLogsTable).values({
      orderId,
      action,
      actor: actor || "System",
      details: details ?? null,
    });
  } catch (err) {
    console.error("[orderLog] Failed to log action:", err);
  }
}

export function getActor(req: { headers: Record<string, string | string[] | undefined> }): string {
  const h = req.headers["x-actor"];
  if (Array.isArray(h)) return h[0] || "System";
  return h || "System";
}
