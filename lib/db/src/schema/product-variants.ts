import { pgTable, text, serial, timestamp, integer, numeric, boolean, jsonb, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { productsTable } from "./products";
import { suppliersTable } from "./suppliers";

export const productVariantsTable = pgTable("product_variants", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  wooVariationId: integer("woo_variation_id"),
  colour: text("colour"),
  size: text("size"),
  sleeve: text("sleeve"),
  variantAttributes: jsonb("variant_attributes").$type<Array<{ id: number | string | null; name: string; option: string }>>(),
  sku: text("sku"),
  price: numeric("price", { precision: 10, scale: 2 }),
  /** Optional VAT override for this exact variant; null inherits the product VAT rate. */
  vatRate: numeric("vat_rate", { precision: 5, scale: 4 }),
  imageUrl: text("image_url"),
  stockQuantity: integer("stock_quantity").default(0).notNull(),
  /** Additive rollout marker; legacy stock is never reinterpreted as component stock. */
  inventoryClassification: text("inventory_classification").notNull().default("LEGACY_REVIEW"),
  /** Explicit opt-in to BOM/component availability; independent of BOM/classification. */
  manufacturingEnabled: boolean("manufacturing_enabled").notNull().default(false),
  allowOrderToReplenish: boolean("allow_order_to_replenish").notNull().default(false),
  maxOutstandingReplenishmentUnits: integer("max_outstanding_replenishment_units").notNull().default(0),
  promisedReplenishmentDays: integer("promised_replenishment_days").notNull().default(0),
  minStockQty: integer("min_stock_qty").default(5).notNull(),
  binLocation: text("bin_location"),
  primarySupplierId: integer("primary_supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  supplierCode: text("supplier_code"),
  supplierPrice: numeric("supplier_price", { precision: 10, scale: 2 }),
  secondarySupplierId: integer("secondary_supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  secondarySupplierCode: text("secondary_supplier_code"),
  secondarySupplierPrice: numeric("secondary_supplier_price", { precision: 10, scale: 2 }),
  isAvailable: boolean("is_available").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  check("product_variants_inventory_classification_check", sql`${table.inventoryClassification} IN ('LEGACY_REVIEW', 'FINISHED_STOCK', 'COMPONENT_STOCK')`),
  check("product_variants_replenishment_policy_check", sql`${table.maxOutstandingReplenishmentUnits} >= 0 AND ${table.promisedReplenishmentDays} >= 0`),
]);
