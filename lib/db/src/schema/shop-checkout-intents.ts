import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const shopCheckoutIntentsTable = pgTable("shop_checkout_intents", {
  paymentIntentId: text("payment_intent_id").primaryKey(),
  originalCartFingerprint: text("original_cart_fingerprint").notNull(),
  amountPence: integer("amount_pence").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("pending"),
  orderId: integer("order_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
});

export type ShopCheckoutIntent = typeof shopCheckoutIntentsTable.$inferSelect;