import { index, integer, pgTable, primaryKey, serial, text, timestamp, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { customersTable } from "./customers";
import { ordersTable } from "./orders";

export const chatConversationsTable = pgTable("chat_conversations", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  orderId: integer("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  subject: text("subject"),
  createdBy: text("created_by"),
  participantsKey: text("participants_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
}, (table) => [
  index("chat_conversations_order_id_idx").on(table.orderId),
  index("chat_conversations_customer_id_idx").on(table.customerId),
  index("chat_conversations_last_message_at_idx").on(table.lastMessageAt, table.createdAt),
]);

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => chatConversationsTable.id, { onDelete: "cascade" }),
  senderName: text("sender_name").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("chat_messages_conversation_created_idx").on(table.conversationId, table.createdAt),
]);

export const chatParticipantsTable = pgTable("chat_participants", {
  conversationId: integer("conversation_id").notNull().references(() => chatConversationsTable.id, { onDelete: "cascade" }),
  userName: text("user_name").notNull(),
  addedBy: text("added_by"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.conversationId, table.userName], name: "chat_participants_pk" }),
]);

export const chatMessageReadsTable = pgTable("chat_message_reads", {
  messageId: integer("message_id").notNull().references(() => chatMessagesTable.id, { onDelete: "cascade" }),
  userName: text("user_name").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.messageId, table.userName], name: "chat_message_reads_pk" }),
]);

export const chatNotificationPrefsTable = pgTable("chat_notification_prefs", {
  conversationId: integer("conversation_id").notNull().references(() => chatConversationsTable.id, { onDelete: "cascade" }),
  userName: text("user_name").notNull(),
  email: text("email"),
  notifyEmail: boolean("notify_email").notNull().default(false),
}, (table) => [
  uniqueIndex("chat_notification_prefs_conversation_user_idx").on(table.conversationId, table.userName),
]);