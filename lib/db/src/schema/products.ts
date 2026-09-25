import { pgTable, text, serial, timestamp, numeric, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sku: text("sku"),
  category: text("category"),
  description: text("description"),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull().default("0"),
  stockQuantity: integer("stock_quantity"),
  supplierId: integer("supplier_id"),
  secondarySupplierId: integer("secondary_supplier_id"),
  supplierCode: text("supplier_code"),
  supplierPrice: numeric("supplier_price", { precision: 10, scale: 2 }),
  secondarySupplierCode: text("secondary_supplier_code"),
  secondarySupplierPrice: numeric("secondary_supplier_price", { precision: 10, scale: 2 }),
  /** Currency used when purchasing from supplier (e.g. "USD", "GBP") */
  supplierCurrency: text("supplier_currency").notNull().default("GBP"),
  /** Minimum units that must be ordered from the supplier */
  minOrderQty: integer("min_order_qty"),
  /** Tiered pricing: [{qty: 25, price: 15.00}, {qty: 50, price: 11.00}, ...] sorted asc by qty */
  priceBreaks: jsonb("price_breaks").$type<{ qty: number; price: number }[]>(),
  imageUrl: text("image_url"),
  wooCommerceId: integer("woo_commerce_id"),
  /** All WooCommerce category IDs assigned to this product, including parents. */
  wooCategoryIds: jsonb("product_category_ids").$type<number[]>(),
  /** Lifecycle value read from WooCommerce during catalogue sync. */
  wooStatus: text("woo_status"),
  regularPrice: text("regular_price"),
  onSale: boolean("on_sale").notNull().default(false),
  permalink: text("permalink"),
  galleryImages: jsonb("gallery_images").$type<string[]>(),
  sizeGuideHtml: text("size_guide_html"),
  /** Local storefront publication setting. This is never changed by sync. */
  websitePublished: boolean("website_published").notNull().default(false),
  taxStatus: text("tax_status"),
  taxClass: text("tax_class"),
  /** VAT rate as a decimal, e.g. 0.20 = standard 20%, 0 = zero-rated (children's clothing etc.) */
  vatRate: numeric("vat_rate", { precision: 5, scale: 4 }).notNull().default("0.2000"),
  /** If set, this is a bespoke product belonging exclusively to this customer */
  customerId: integer("customer_id"),
  /** Bespoke products are hidden from WooCommerce sync */
  isBespoke: boolean("is_bespoke").notNull().default(false),
  /** Service products (e.g. logo digitising) — no stock, no variants, no purchasing */
  isService: boolean("is_service").notNull().default(false),
  /** Archived products are hidden from order entry, purchasing, and WooCommerce sync */
  isArchived: boolean("is_archived").notNull().default(false),
  /** Guidance: what the product is best suited for */
  guidanceBestFor: text("guidance_best_for"),
  /** Guidance: situations where this product is not ideal */
  guidanceNotIdealFor: text("guidance_not_ideal_for"),
  /** Short shop-facing recommendation written by staff */
  guidanceStaffRecommendation: text("guidance_staff_recommendation"),
  /** Guidance: promotional badge (legacy single value) */
  guidanceBadge: text("guidance_badge"),
  /** Guidance: multiple promotional badges */
  guidanceBadges: jsonb("guidance_badges").$type<string[]>(),
  /** Guidance: value-for-money rating 1–5 */
  guidanceValueRating: integer("guidance_value_rating"),
  /** Guidance: durability rating 1–5 */
  guidanceDurabilityRating: integer("guidance_durability_rating"),
  /** Guidance: smarts/tech rating 1–5 */
  guidanceSmartRating: integer("guidance_smart_rating"),
  /** Guidance: display tags e.g. ['Everyday Workwear', 'Heavy Duty'] */
  guidanceTags: jsonb("guidance_tags").$type<string[]>(),
  /** Guidance: staff quotes attributed to named staff members */
  guidanceStaffQuotes: jsonb("guidance_staff_quotes").$type<{
    id: string; staffId: number; staffName: string;
    staffRole: string | null; staffImageUrl: string | null;
    draft: string; rewritten: string | null;
  }[]>(),
  /** Per-product branding override: null = use global defaults, [] = no branding, [...] = custom list */
  brandingPositionsOverride: jsonb("branding_positions_override").$type<{
    id: string; name: string; surcharge: number; description?: string; notes_field?: boolean;
  }[] | null>(),
  issueSnoozedUntil: timestamp("issue_snoozed_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
