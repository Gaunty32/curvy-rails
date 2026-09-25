import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { suppliersTable } from "./suppliers";
import { customersTable } from "./customers";

export const processStockTable = pgTable("process_stock", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sku: text("sku"),
  description: text("description"),
  unitCost: numeric("unit_cost", { precision: 10, scale: 2 }).notNull().default("0"),
  stockQuantity: integer("stock_quantity").notNull().default(0),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  supplierCode: text("supplier_code"),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  notes: text("notes"),
  fileUrl: text("file_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ProcessStock = typeof processStockTable.$inferSelect;
