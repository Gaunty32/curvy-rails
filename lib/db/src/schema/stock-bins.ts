import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";

export const stockBinsTable = pgTable("stock_bins", {
  id: serial("id").primaryKey(),
  binNumber: text("bin_number").notNull().unique(),
  notes: text("notes"),
  maxQty: integer("max_qty").notNull().default(15),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
