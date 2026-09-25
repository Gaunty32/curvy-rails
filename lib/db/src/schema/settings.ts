import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const syncLogsTable = pgTable("sync_logs", {
  id: serial("id").primaryKey(),
  type: text("type").notNull().default("woocommerce"),
  status: text("status").notNull(),
  message: text("message"),
  itemsCreated: text("items_created"),
  itemsUpdated: text("items_updated"),
  errors: text("errors"),
  progressPct: integer("progress_pct"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
