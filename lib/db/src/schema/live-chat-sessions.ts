import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const liveChatSessionsTable = pgTable("live_chat_sessions", {
  id: serial("id").primaryKey(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  pageUrl: text("page_url"),
  messages: jsonb("messages").notNull().default([]),
  messageCount: integer("message_count").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  flaggedForTraining: boolean("flagged_for_training").notNull().default(false),
  trainingNotes: text("training_notes"),
});