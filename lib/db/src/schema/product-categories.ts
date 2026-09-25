import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";

export const productCategoriesTable = pgTable("product_categories", {
  id: serial("id").primaryKey(),
  wooId: integer("woo_id").unique(),
  name: text("name").notNull(),
  slug: text("slug"),
  imageUrl: text("image_url"),
  parentWooId: integer("parent_woo_id"),
  productCount: integer("product_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ProductCategory = typeof productCategoriesTable.$inferSelect;
