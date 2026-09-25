import { pgTable, text, serial, timestamp, numeric, integer, bigint, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";
import { productsTable } from "./products";
import { suppliersTable } from "./suppliers";
import { shopCustomersTable } from "./shop-customers";
import { customerEmployeesTable } from "./customer-details";

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  customerName: text("customer_name"),
  status: text("status").notNull().default("draft"),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  orderDate: timestamp("order_date", { withTimezone: true }).notNull().defaultNow(),
  requiredDate: timestamp("required_date", { withTimezone: true }),
  shippingMethod: text("shipping_method"),
  carriageAmount: numeric("carriage_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  deliveryAddressId: integer("delivery_address_id"),
  invoiceAddressId: integer("invoice_address_id"),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  xeroInvoiceId: text("xero_invoice_id"),
  xeroInvoiceNumber: text("xero_invoice_number"),
  xeroInvoiceStatus: text("xero_invoice_status"),
  /** Cross-process claim used while creating a Xero invoice. Prevents duplicate remote posts. */
  xeroInvoicePostingAt: timestamp("xero_invoice_posting_at", { withTimezone: true }),
  xeroInvoicePostingToken: text("xero_invoice_posting_token"),
  trackingNumber: text("tracking_number"),
  dpdConsignmentId: text("dpd_consignment_id"),
  dpdJobId: bigint("dpd_job_id", { mode: "number" }),
  dpdParcelCount: integer("dpd_parcel_count"),
  invoiceEmailSentAt: timestamp("invoice_email_sent_at", { withTimezone: true }),
  invoiceEmailSentTo: text("invoice_email_sent_to"),
  shopCustomerId: integer("shop_customer_id").references(() => shopCustomersTable.id, { onDelete: "set null" }),
  source: text("source").notNull().default("internal"),
  portalStatus: text("portal_status"),
  portalNotes: text("portal_notes"),
  poNumber: text("po_number"),
  /** Links address-specific fulfilment orders created from one portal submission. Null for legacy and single-address orders. */
  fulfilmentGroupId: text("fulfilment_group_id"),
  attentionOf: text("attention_of"),
  portalSubmittedByEmail: text("portal_submitted_by_email"),
  portalSubmittedByName: text("portal_submitted_by_name"),
  portalSubmittedByEmployeeId: integer("portal_submitted_by_employee_id")
    .references(() => customerEmployeesTable.id, { onDelete: "set null" }),
  portalSubmittedAt: timestamp("portal_submitted_at", { withTimezone: true }),
  portalApprovedByEmail: text("portal_approved_by_email"),
  portalApprovedByName: text("portal_approved_by_name"),
  portalApprovedAt: timestamp("portal_approved_at", { withTimezone: true }),
  addToStores: boolean("add_to_stores").notNull().default(false),
  quoteId: integer("quote_id"),
  invoiceDate: timestamp("invoice_date", { withTimezone: true }),
  stripePaymentLinkUrl: text("stripe_payment_link_url"),
  stripePaymentLinkId: text("stripe_payment_link_id"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  invoiceScheduledSendAt: timestamp("invoice_scheduled_send_at", { withTimezone: true }),
  invoiceScheduleToEmail: text("invoice_schedule_to_email"),
  attachments: jsonb("attachments").$type<Array<{ name: string; objectPath: string }>>(),
  /** Order numbers absorbed into this order during a merge (e.g. ["P39", "P40"]) */
  absorbedOrderNumbers: text("absorbed_order_numbers").array(),
  /** Number of boxes/parcels in this shipment — drives box label copies */
  numberOfBoxes: integer("number_of_boxes").notNull().default(1),
  /** WooCommerce internal order ID (used for API calls back to WC) */
  wooOrderId: integer("woo_order_id"),
  /** Timestamp when the invoice follow-up email/WhatsApp should fire (48h after invoice email sent, non-local-delivery orders) */
  invoiceFollowupDueAt: timestamp("invoice_followup_due_at", { withTimezone: true }),
  /** Timestamp when the invoice follow-up was actually sent */
  invoiceFollowupSentAt: timestamp("invoice_followup_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const orderItemsTable = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  productName: text("product_name").notNull(),
  colour: text("colour"),
  size: text("size"),
  finishId: integer("finish_id"),
  finishName: text("finish_name"),
  recipientType: text("recipient_type").notNull().default("stock"),
  recipientName: text("recipient_name"),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull().default("0"),
  lineTotal: numeric("line_total", { precision: 10, scale: 2 }).notNull().default("0"),
  recipientEmployeeId: integer("recipient_employee_id"),
  purchaseRequired: boolean("purchase_required").notNull().default(false),
  purchaseQuantity: integer("purchase_quantity"),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  supplierName: text("supplier_name"),
  // Stock allocation tracking: null=pending, allocated=plain stock picked, in_production=worksheet created, complete=done
  stockStatus: text("stock_status"),
  stockAllocatedAt: timestamp("stock_allocated_at", { withTimezone: true }),
  /** VAT rate as a decimal, e.g. 0.20 = 20%, 0 = zero-rated (children's clothing etc.) */
  vatRate: numeric("vat_rate", { precision: 5, scale: 4 }).notNull().default("0.2000"),
  /** Free-text notes on this item, e.g. extra logo positions imported from WooCommerce */
  notes: text("notes"),
  /** Timestamp when this item first entered the purchasing queue (purchase_required set to true) */
  purchasingQueuedAt: timestamp("purchasing_queued_at", { withTimezone: true }),
  /** Set when this item is dispatched; null = not yet shipped. Used for part-shipment tracking. */
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  /** Units deducted from warehouse stock during portal order confirmation.
   *  Populated by the confirm route; used by unconfirm to restore exactly what was taken.
   *  NULL for items fulfilled entirely from customer_finished_items (stock_status='allocated'). */
  sbsStockAllocatedQty: integer("sbs_stock_allocated_qty"),
  bundleRef: text("bundle_ref"),
  isBundleHeader: boolean("is_bundle_header").notNull().default(false),
  bundleDefId: integer("bundle_def_id"),
});

export const purchaseOrdersTable = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  poNumber: text("po_number").notNull().unique(),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  supplierName: text("supplier_name").notNull(),
  supplierEmail: text("supplier_email"),
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  attachments: jsonb("attachments").$type<Array<{ name: string; objectPath: string }>>(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  estimatedDeliveryDate: timestamp("estimated_delivery_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const purchaseOrderItemsTable = pgTable("purchase_order_items", {
  id: serial("id").primaryKey(),
  poId: integer("po_id").notNull().references(() => purchaseOrdersTable.id, { onDelete: "cascade" }),
  orderItemId: integer("order_item_id").references(() => orderItemsTable.id, { onDelete: "set null" }),
  orderId: integer("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  orderNumber: text("order_number"),
  /** Product FK — enables orphaned on-order quantity checks even after linked order items are deleted. */
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  productName: text("product_name").notNull(),
  colour: text("colour"),
  size: text("size"),
  supplierCode: text("supplier_code"),
  supplierPrice: numeric("supplier_price", { precision: 10, scale: 2 }),
  processStockId: integer("process_stock_id"),
  /** All order item IDs consolidated into this PO line (superset of orderItemId). */
  sourceOrderItemIds: jsonb("source_order_item_ids").$type<number[]>().notNull().default([]),
  /** Purchased quantity attributed to each consolidated source item at PO creation. */
  sourceOrderItemQuantities: jsonb("source_order_item_quantities")
    .$type<Array<{ orderItemId: number; quantity: number }>>()
    .notNull()
    .default([]),
  quantityOrdered: integer("quantity_ordered").notNull().default(1),
  quantityDelivered: integer("quantity_delivered").notNull().default(0),
  estimatedDueDate: timestamp("estimated_due_date", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const worksheetsTable = pgTable("worksheets", {
  id: serial("id").primaryKey(),
  worksheetNumber: text("worksheet_number").notNull().unique(),
  status: text("status").notNull().default("pre_wip"),
  orderId: integer("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  orderNumber: text("order_number"),
  customerId: integer("customer_id"),
  customerName: text("customer_name"),
  notes: text("notes"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const worksheetItemsTable = pgTable("worksheet_items", {
  id: serial("id").primaryKey(),
  worksheetId: integer("worksheet_id").notNull().references(() => worksheetsTable.id, { onDelete: "cascade" }),
  orderItemId: integer("order_item_id").references(() => orderItemsTable.id, { onDelete: "set null" }),
  productName: text("product_name").notNull(),
  colour: text("colour"),
  size: text("size"),
  quantity: integer("quantity").notNull().default(1),
  recipientType: text("recipient_type").notNull().default("stock"),
  recipientName: text("recipient_name"),
  finishId: integer("finish_id"),
  finishName: text("finish_name"),
  processesSnapshot: text("processes_snapshot"),
  notes: text("notes"),
  supplierCode: text("supplier_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orderLogsTable = pgTable("order_logs", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  actor: text("actor").notNull().default("System"),
  details: text("details"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orderLabelPrintsTable = pgTable("order_label_prints", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
  labelType: text("label_type").notNull().default("wearer"),
  wearerKey: text("wearer_key").notNull(),
  wearerName: text("wearer_name").notNull(),
  itemIds: jsonb("item_ids").$type<number[]>().notNull().default([]),
  actor: text("actor").notNull().default("Staff"),
  printedAt: timestamp("printed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orderEmailLogsTable = pgTable("order_email_logs", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
  emailType: text("email_type").notNull().default("acknowledgement"),
  toEmail: text("to_email").notNull(),
  subject: text("subject"),
  sentBy: text("sent_by"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  success: boolean("success").notNull().default(true),
  error: text("error"),
});

export const orderMessagesTable = pgTable("order_messages", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
  orderNumber: text("order_number").notNull(),
  authorName: text("author_name").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orderMessageReadsTable = pgTable("order_message_reads", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull().references(() => orderMessagesTable.id, { onDelete: "cascade" }),
  readerName: text("reader_name").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;

export const insertOrderItemSchema = createInsertSchema(orderItemsTable).omit({ id: true });
export type InsertOrderItem = z.infer<typeof insertOrderItemSchema>;
export type OrderItem = typeof orderItemsTable.$inferSelect;

export type OrderLog = typeof orderLogsTable.$inferSelect;
export type OrderEmailLog = typeof orderEmailLogsTable.$inferSelect;
