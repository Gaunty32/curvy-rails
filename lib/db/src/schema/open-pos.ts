import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { customersTable } from "./customers";

export const customerOpenPosTable = pgTable("customer_open_pos", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  poNumber: text("po_number").notNull(),
  totalValue: numeric("total_value", { precision: 10, scale: 2 }).notNull(),
  remainingValue: numeric("remaining_value", { precision: 10, scale: 2 }).notNull(),
  /** YYYY-MM-DD string */
  expiryDate: text("expiry_date").notNull(),
  /** active | exhausted | expired */
  status: text("status").notNull().default("active"),
  /** Portal user ID who created this PO (null when created by staff) */
  createdByPortalUserId: integer("created_by_portal_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type CustomerOpenPo = typeof customerOpenPosTable.$inferSelect;
