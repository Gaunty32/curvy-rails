import { pgTable, serial, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const callbackRequestsTable = pgTable("callback_requests", {
  id: serial("id").primaryKey(),
  callbackRequestId: text("callback_request_id").notNull().unique(),
  phone: text("phone").notNull(),
  phoneNormalised: text("phone_normalised").notNull(),
  status: text("status").notNull().default("received"),
  callbackType: text("callback_type").notNull(),
  source: text("source").notNull().default("website_callback"),
  businessOpen: boolean("business_open").notNull(),
  pageUrl: text("page_url"),
  pageTitle: text("page_title"),
  referrer: text("referrer"),
  utmSource: text("utm_source"), utmMedium: text("utm_medium"), utmCampaign: text("utm_campaign"),
  utmContent: text("utm_content"), utmTerm: text("utm_term"), gclid: text("gclid"), fbclid: text("fbclid"),
  sessionId: text("session_id"), deviceType: text("device_type"), userAgent: text("user_agent"),
  ipHash: text("ip_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  highlevelSentAt: timestamp("highlevel_sent_at", { withTimezone: true }),
  highlevelResponseStatus: integer("highlevel_response_status"),
  highlevelContactId: text("highlevel_contact_id"),
  highlevelContactHttpStatus: integer("highlevel_contact_http_status"),
  highlevelContactSucceeded: boolean("highlevel_contact_succeeded"),
  highlevelContactResponseBody: text("highlevel_contact_response_body"),
  highlevelContactError: text("highlevel_contact_error"),
  highlevelWorkflowId: text("highlevel_workflow_id"),
  highlevelWorkflowStatus: text("highlevel_workflow_status"),
  highlevelWorkflowHttpStatus: integer("highlevel_workflow_http_status"),
  highlevelWorkflowSucceeded: boolean("highlevel_workflow_succeeded"),
  highlevelWorkflowResponseBody: text("highlevel_workflow_response_body"),
  highlevelWorkflowError: text("highlevel_workflow_error"),
  highlevelAttemptCount: integer("highlevel_attempt_count").notNull().default(0),
  highlevelLastAttemptAt: timestamp("highlevel_last_attempt_at", { withTimezone: true }),
  errorMessage: text("error_message"),
});
export const insertCallbackRequestSchema = createInsertSchema(callbackRequestsTable).omit({ id: true, createdAt: true });
export type CallbackRequest = typeof callbackRequestsTable.$inferSelect;
export type InsertCallbackRequest = z.infer<typeof insertCallbackRequestSchema>;