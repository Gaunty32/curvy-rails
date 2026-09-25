import { pgTable, text, serial, timestamp, jsonb } from "drizzle-orm/pg-core";

export const suppliersTable = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  county: text("county"),
  postcode: text("postcode"),
  country: text("country").default("United Kingdom"),
  notes: text("notes"),
  currency: text("currency").notNull().default("GBP"),
  /** Standard price breaks auto-applied when this supplier is selected on a product */
  defaultPriceBreaks: jsonb("default_price_breaks").$type<{ qty: number; price: number }[]>(),
  logoUrl: text("logo_url"),
  xeroContactId: text("xero_contact_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
