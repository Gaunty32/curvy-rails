import { eq } from "drizzle-orm";
import { db, settingsTable } from "@workspace/db";

const MANAGER_PACKING_SETTING_PREFIX = "dispatch_manager_packing_customer:";

export async function getManagerPackingCustomerIds(): Promise<number[]> {
  const rows = await db.select().from(settingsTable);
  return rows
    .filter(row => row.key.startsWith(MANAGER_PACKING_SETTING_PREFIX) && row.value === "true")
    .map(row => Number(row.key.slice(MANAGER_PACKING_SETTING_PREFIX.length)))
    .filter(id => Number.isInteger(id) && id > 0);
}

export async function isManagerPackingEnabled(customerId: number): Promise<boolean> {
  const [setting] = await db.select({ value: settingsTable.value })
    .from(settingsTable)
    .where(eq(settingsTable.key, `${MANAGER_PACKING_SETTING_PREFIX}${customerId}`));
  return setting?.value === "true";
}

export async function setManagerPackingEnabled(customerId: number, enabled: boolean): Promise<void> {
  await db.insert(settingsTable)
    .values({
      key: `${MANAGER_PACKING_SETTING_PREFIX}${customerId}`,
      value: enabled ? "true" : "false",
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: enabled ? "true" : "false", updatedAt: new Date() },
    });
}