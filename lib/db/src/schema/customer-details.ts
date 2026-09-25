import { pgTable, text, serial, timestamp, integer, boolean, numeric } from "drizzle-orm/pg-core";
import { customersTable } from "./customers";

export const customerInvoiceAddressesTable = pgTable("customer_invoice_addresses", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  label: text("label"),
  name: text("name"),
  address: text("address"),
  line2: text("line2"),
  city: text("city"),
  postcode: text("postcode"),
  billingEmail: text("billing_email"),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const customerDeliveryAddressesTable = pgTable("customer_delivery_addresses", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  label: text("label"),
  line1: text("line1"),
  line2: text("line2"),
  city: text("city"),
  postcode: text("postcode"),
  country: text("country").default("United Kingdom"),
  invoiceAddressId: integer("invoice_address_id"),
  isDefault: boolean("is_default").default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const customerContactsTable = pgTable("customer_contacts", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  jobTitle: text("job_title"),
  email: text("email"),
  phone: text("phone"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const customerProcessesTable = pgTable("customer_processes", {
  id: serial("id").primaryKey(),
  code: text("code"),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type"),
  placement: text("placement"),
  price: numeric("price", { precision: 10, scale: 2 }),
  processStockId: integer("process_stock_id"),
  imageUrl: text("image_url"),
  fileUrl: text("file_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const customerFinishesTable = pgTable("customer_finishes", {
  id: serial("id").primaryKey(),
  code: text("code"),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  notes: text("notes"),
  roleId: integer("role_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const customerFinishProcessesTable = pgTable("customer_finish_processes", {
  id: serial("id").primaryKey(),
  finishId: integer("finish_id").notNull().references(() => customerFinishesTable.id, { onDelete: "cascade" }),
  processId: integer("process_id").notNull().references(() => customerProcessesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const customerFinishProductsTable = pgTable("customer_finish_products", {
  id: serial("id").primaryKey(),
  finishId: integer("finish_id").notNull().references(() => customerFinishesTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull(),
  colour: text("colour"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Roles ────────────────────────────────────────────────────────────────────

export const customerRolesTable = pgTable("customer_roles", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  annualAllowance: numeric("annual_allowance", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// ─── Teams ────────────────────────────────────────────────────────────────────

export const customerTeamsTable = pgTable("customer_teams", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  managerId: integer("manager_id"),
  deliveryAddressId: integer("delivery_address_id").references(() => customerDeliveryAddressesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// ─── Employees ────────────────────────────────────────────────────────────────

export const customerEmployeesTable = pgTable("customer_employees", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  employeeNumber: text("employee_number"),
  jobTitle: text("job_title"),
  department: text("department"),
  roleId: integer("role_id"),
  email: text("email"),
  phone: text("phone"),
  avatarUrl: text("avatar_url"),
  teamId: integer("team_id"),
  managerId: integer("manager_id"),
  deliveryAddressId: integer("delivery_address_id").references(() => customerDeliveryAddressesTable.id, { onDelete: "set null" }),
  allowance: numeric("allowance", { precision: 10, scale: 2 }),
  allowanceTopup: numeric("allowance_topup", { precision: 10, scale: 2 }).default("0"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const customerEmployeeSizesTable = pgTable("customer_employee_sizes", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => customerEmployeesTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  size: text("size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// ─── References (internal notes & media) ─────────────────────────────────────

export const customerReferencesTable = pgTable("customer_references", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  title: text("title"),
  notes: text("notes"),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// ─── Customer Files (embroidery & print files) ───────────────────────────────

export const customerFilesTable = pgTable("customer_files", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size"),
  contentType: text("content_type"),
  category: text("category").notNull().default("other"), // 'embroidery' | 'print' | 'other'
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// ─── Finished Items (Wardrobe) ────────────────────────────────────────────────

export const customerFinishedItemsTable = pgTable("customer_finished_items", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  roleId: integer("role_id"),
  name: text("name").notNull(),
  productId: integer("product_id"),
  finishId: integer("finish_id"),
  colour: text("colour"),
  sleeve: text("sleeve"),
  size: text("size"),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  specialPrice: numeric("special_price", { precision: 10, scale: 2 }),
  stockQuantity: integer("stock_quantity").notNull().default(0),
  minQuantity: integer("min_quantity").notNull().default(0),
  reorderQuantity: integer("reorder_quantity").notNull().default(0),
  location: text("location"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
