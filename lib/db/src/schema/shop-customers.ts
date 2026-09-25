import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const shopCustomersTable = pgTable("shop_customers", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  company: text("company"),
  phone: text("phone"),
  address1: text("address_1"),
  address2: text("address_2"),
  city: text("city"),
  county: text("county"),
  postcode: text("postcode"),
  country: text("country").notNull().default("GB"),
  wooCustomerId: integer("woo_customer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ShopCustomer = typeof shopCustomersTable.$inferSelect;
