import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const customersTable = pgTable("customers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  contactFirstName: text("contact_first_name"),
  contactLastName: text("contact_last_name"),
  email: text("email"),
  billingEmail: text("billing_email"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  postcode: text("postcode"),
  notes: text("notes"),
  logoUrl: text("logo_url"),
  xeroContactId: text("xero_contact_id"),
  stripeCustomerId: text("stripe_customer_id"),
  defaultShippingService: text("default_shipping_service"),
  defaultShippingOption: text("default_shipping_option"),
  highLevelContactId: text("high_level_contact_id"),
  requiresPrepayment: boolean("requires_prepayment").notNull().default(false),
  zeroVat: boolean("zero_vat").notNull().default(false),
  poNumberRequired: boolean("po_number_required").notNull().default(false),
  portalSuspended: boolean("portal_suspended").notNull().default(false),
  deptManagerCanApprove: boolean("dept_manager_can_approve").notNull().default(true),
  hasReviewed: boolean("has_reviewed").notNull().default(false),
  /** Centralised invoicing — official company/group name shown on invoices */
  invoiceName: text("invoice_name"),
  /** Centralised invoicing — address line 1 */
  invoiceAddress: text("invoice_address"),
  /** Centralised invoicing — city */
  invoiceCity: text("invoice_city"),
  /** Centralised invoicing — postcode */
  invoicePostcode: text("invoice_postcode"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCustomerSchema = createInsertSchema(customersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customersTable.$inferSelect;
