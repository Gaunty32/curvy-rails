import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { productsTable } from "./products";

export const productAttributesTable = pgTable("product_attributes", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  value: text("value").notNull(),
  imageUrl: text("image_url"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
