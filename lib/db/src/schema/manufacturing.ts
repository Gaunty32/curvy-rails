import {
  pgTable, text, serial, timestamp, integer, numeric, boolean, jsonb,
  uniqueIndex, index, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { suppliersTable } from "./suppliers";
import { productVariantsTable } from "./product-variants";
import { ordersTable, orderItemsTable } from "./orders";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const manufacturingComponentsTable = pgTable("manufacturing_components", {
  id: serial("id").primaryKey(),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  supplierSku: text("supplier_sku"),
  costGbp: numeric("cost_gbp", { precision: 10, scale: 2 }).notNull().default("0"),
  bin: text("bin"),
  reorderLevel: integer("reorder_level").notNull().default(0),
  targetLevel: integer("target_level").notNull().default(0),
  leadDays: integer("lead_days"),
  active: boolean("active").notNull().default(true),
  replenishable: boolean("replenishable").notNull().default(false),
  physicalBalance: integer("physical_balance").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("manufacturing_components_sku_uidx").on(table.sku),
  check("manufacturing_components_type_check", sql`${table.type} IN ('garment', 'transfer', 'patch', 'packaging', 'other')`),
  check("manufacturing_components_balance_check", sql`${table.physicalBalance} >= 0`),
  check("manufacturing_components_levels_check", sql`${table.reorderLevel} >= 0 AND ${table.targetLevel} >= 0`),
  check("manufacturing_components_cost_check", sql`${table.costGbp} >= 0`),
  check("manufacturing_components_lead_days_check", sql`${table.leadDays} IS NULL OR ${table.leadDays} >= 0`),
]);

export const manufacturingMovementsTable = pgTable("manufacturing_stock_movements", {
  id: serial("id").primaryKey(),
  componentId: integer("component_id").notNull().references(() => manufacturingComponentsTable.id, { onDelete: "restrict" }),
  quantityChange: integer("quantity_change").notNull(),
  reason: text("reason").notNull(),
  actor: text("actor").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  reference: text("reference"),
  note: text("note"),
  resultingBalance: integer("resulting_balance").notNull(),
}, (table) => [
  index("manufacturing_movements_component_created_idx").on(table.componentId, table.occurredAt),
  check("manufacturing_movements_nonzero_change_check", sql`${table.quantityChange} <> 0 OR ${table.reason} = 'OPENING_BALANCE'`),
  check("manufacturing_movements_resulting_balance_check", sql`${table.resultingBalance} >= 0`),
  uniqueIndex("manufacturing_movements_opening_once_uidx").on(table.componentId).where(sql`${table.reason} = 'OPENING_BALANCE'`),
]);

export const manufacturingStocktakesTable = pgTable("manufacturing_stocktakes", {
  id: serial("id").primaryKey(),
  componentId: integer("component_id").notNull().references(() => manufacturingComponentsTable.id, { onDelete: "restrict" }),
  expectedQuantity: integer("expected_quantity").notNull(),
  countedQuantity: integer("counted_quantity").notNull(),
  /** Last immutable ledger movement ID observed when this draft was created; -1 means legacy/unknown. */
  movementRevision: integer("movement_revision").notNull().default(-1),
  status: text("status").notNull().default("draft"),
  createdBy: text("created_by").notNull(),
  approvedBy: text("approved_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  note: text("note"),
}, (table) => [
  index("manufacturing_stocktakes_component_idx").on(table.componentId, table.createdAt),
  check("manufacturing_stocktakes_quantities_check", sql`${table.expectedQuantity} >= 0 AND ${table.countedQuantity} >= 0`),
  check("manufacturing_stocktakes_movement_revision_check", sql`${table.movementRevision} >= -1`),
  check("manufacturing_stocktakes_status_check", sql`${table.status} IN ('draft', 'approved')`),
]);

export const manufacturingBomsTable = pgTable("manufacturing_boms", {
  id: serial("id").primaryKey(),
  variantId: integer("variant_id").notNull().references(() => productVariantsTable.id, { onDelete: "restrict" }),
  version: integer("version").notNull(),
  isCurrent: boolean("is_current").notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("manufacturing_boms_variant_version_uidx").on(table.variantId, table.version),
  uniqueIndex("manufacturing_boms_current_variant_uidx").on(table.variantId).where(sql`${table.isCurrent} = true`),
  index("manufacturing_boms_variant_idx").on(table.variantId),
  check("manufacturing_boms_version_check", sql`${table.version} > 0`),
]);

export const manufacturingBomComponentsTable = pgTable("manufacturing_bom_components", {
  id: serial("id").primaryKey(),
  bomId: integer("bom_id").notNull().references(() => manufacturingBomsTable.id, { onDelete: "restrict" }),
  componentId: integer("component_id").notNull().references(() => manufacturingComponentsTable.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
  componentSkuSnapshot: text("component_sku_snapshot").notNull(),
  componentNameSnapshot: text("component_name_snapshot").notNull(),
  unitCostGbpSnapshot: numeric("unit_cost_gbp_snapshot", { precision: 10, scale: 2 }).notNull(),
}, (table) => [
  uniqueIndex("manufacturing_bom_components_bom_component_uidx").on(table.bomId, table.componentId),
  index("manufacturing_bom_components_component_idx").on(table.componentId),
  check("manufacturing_bom_components_quantity_check", sql`${table.quantity} > 0`),
  check("manufacturing_bom_components_snapshot_cost_check", sql`${table.unitCostGbpSnapshot} >= 0`),
]);

export const manufacturingBomOperationsTable = pgTable("manufacturing_bom_operations", {
  id: serial("id").primaryKey(),
  bomId: integer("bom_id").notNull().references(() => manufacturingBomsTable.id, { onDelete: "restrict" }),
  method: text("method").notNull(),
  designRef: text("design_ref"),
  position: text("position"),
  instructions: text("instructions"),
  labourAllowance: numeric("labour_allowance", { precision: 10, scale: 2 }).notNull().default("0"),
  thumbnail: text("thumbnail"),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [
  index("manufacturing_bom_operations_bom_idx").on(table.bomId),
  check("manufacturing_bom_operations_labour_check", sql`${table.labourAllowance} >= 0`),
]);

export const manufacturingAvailabilityPoliciesTable = pgTable("manufacturing_availability_policies", {
  id: integer("id").primaryKey().default(1),
  lowStockThreshold: integer("low_stock_threshold").notNull().default(3),
  holdDurationMinutes: integer("hold_duration_minutes").notNull().default(20),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("manufacturing_availability_policy_id_check", sql`${table.id} = 1`),
  check("manufacturing_availability_policy_values_check", sql`${table.lowStockThreshold} >= 0 AND ${table.holdDurationMinutes} BETWEEN 1 AND 1440`),
]);

export const manufacturingCheckoutHoldsTable = pgTable("manufacturing_checkout_holds", {
  id: serial("id").primaryKey(),
  paymentIntentId: text("payment_intent_id").notNull(),
  lineIndex: integer("line_index").notNull(),
  variantId: integer("variant_id").notNull().references(() => productVariantsTable.id, { onDelete: "restrict" }),
  bomId: integer("bom_id").notNull().references(() => manufacturingBomsTable.id, { onDelete: "restrict" }),
  componentId: integer("component_id").notNull().references(() => manufacturingComponentsTable.id, { onDelete: "restrict" }),
  componentSkuSnapshot: text("component_sku_snapshot").notNull(),
  componentNameSnapshot: text("component_name_snapshot").notNull(),
  requiredQuantity: integer("required_quantity").notNull(),
  heldQuantity: integer("held_quantity").notNull(),
  shortfallQuantity: integer("shortfall_quantity").notNull().default(0),
  checkoutReference: text("checkout_reference"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("ACTIVE"),
}, (table) => [
  uniqueIndex("manufacturing_checkout_holds_idempotency_uidx").on(table.paymentIntentId, table.lineIndex, table.variantId, table.bomId, table.componentId),
  index("manufacturing_checkout_holds_active_component_idx").on(table.componentId, table.status, table.expiresAt),
  index("manufacturing_checkout_holds_intent_idx").on(table.paymentIntentId),
  check("manufacturing_checkout_holds_quantities_check", sql`${table.lineIndex} >= 0 AND ${table.requiredQuantity} > 0 AND ${table.heldQuantity} >= 0 AND ${table.shortfallQuantity} >= 0 AND ${table.heldQuantity} + ${table.shortfallQuantity} = ${table.requiredQuantity}`),
  check("manufacturing_checkout_holds_status_check", sql`${table.status} IN ('ACTIVE', 'CONVERTED', 'RELEASED', 'EXPIRED')`),
]);

export const manufacturingAllocationsTable = pgTable("manufacturing_confirmed_allocations", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => ordersTable.id, { onDelete: "restrict" }),
  orderItemId: integer("order_item_id").notNull().references(() => orderItemsTable.id, { onDelete: "restrict" }),
  paymentIntentId: text("payment_intent_id").notNull(),
  lineIndex: integer("line_index").notNull(),
  variantId: integer("variant_id").notNull().references(() => productVariantsTable.id, { onDelete: "restrict" }),
  bomId: integer("bom_id").notNull().references(() => manufacturingBomsTable.id, { onDelete: "restrict" }),
  componentId: integer("component_id").notNull().references(() => manufacturingComponentsTable.id, { onDelete: "restrict" }),
  componentSkuSnapshot: text("component_sku_snapshot").notNull(),
  componentNameSnapshot: text("component_name_snapshot").notNull(),
  requiredQuantity: integer("required_quantity").notNull(),
  allocatedQuantity: integer("allocated_quantity").notNull(),
  shortfallQuantity: integer("shortfall_quantity").notNull().default(0),
  manualReviewRequired: boolean("manual_review_required").notNull().default(false),
  manualReviewReason: text("manual_review_reason"),
  status: text("status").notNull().default("CONFIRMED"),
  allocatedAt: timestamp("allocated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("manufacturing_allocations_order_item_component_uidx").on(table.orderId, table.orderItemId, table.componentId),
  uniqueIndex("manufacturing_allocations_payment_line_component_uidx").on(table.paymentIntentId, table.lineIndex, table.componentId),
  index("manufacturing_allocations_component_status_idx").on(table.componentId, table.status),
  index("manufacturing_allocations_order_idx").on(table.orderId),
  check("manufacturing_allocations_quantities_check", sql`${table.lineIndex} >= 0 AND ${table.requiredQuantity} > 0 AND ${table.allocatedQuantity} >= 0 AND ${table.shortfallQuantity} >= 0 AND ${table.allocatedQuantity} + ${table.shortfallQuantity} = ${table.requiredQuantity}`),
  check("manufacturing_allocations_status_check", sql`${table.status} IN ('CONFIRMED', 'RELEASED')`),
]);

export const insertManufacturingComponentSchema = createInsertSchema(manufacturingComponentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertManufacturingComponent = z.infer<typeof insertManufacturingComponentSchema>;
export type ManufacturingComponent = typeof manufacturingComponentsTable.$inferSelect;