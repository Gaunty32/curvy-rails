CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact_first_name" text,
	"contact_last_name" text,
	"email" text,
	"billing_email" text,
	"phone" text,
	"address" text,
	"city" text,
	"state" text,
	"postcode" text,
	"notes" text,
	"logo_url" text,
	"xero_contact_id" text,
	"stripe_customer_id" text,
	"default_shipping_service" text,
	"high_level_contact_id" text,
	"requires_prepayment" boolean DEFAULT false NOT NULL,
	"zero_vat" boolean DEFAULT false NOT NULL,
	"po_number_required" boolean DEFAULT false NOT NULL,
	"portal_suspended" boolean DEFAULT false NOT NULL,
	"dept_manager_can_approve" boolean DEFAULT true NOT NULL,
	"has_reviewed" boolean DEFAULT false NOT NULL,
	"invoice_name" text,
	"invoice_address" text,
	"invoice_city" text,
	"invoice_postcode" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"category" text,
	"description" text,
	"unit_price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"stock_quantity" integer,
	"supplier_id" integer,
	"secondary_supplier_id" integer,
	"supplier_code" text,
	"supplier_price" numeric(10, 2),
	"secondary_supplier_code" text,
	"secondary_supplier_price" numeric(10, 2),
	"supplier_currency" text DEFAULT 'GBP' NOT NULL,
	"min_order_qty" integer,
	"price_breaks" jsonb,
	"image_url" text,
	"woo_commerce_id" integer,
	"product_category_ids" jsonb,
	"woo_status" text,
	"website_published" boolean DEFAULT false NOT NULL,
	"tax_status" text,
	"tax_class" text,
	"vat_rate" numeric(5, 4) DEFAULT '0.2000' NOT NULL,
	"customer_id" integer,
	"is_bespoke" boolean DEFAULT false NOT NULL,
	"is_service" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"guidance_best_for" text,
	"guidance_not_ideal_for" text,
	"guidance_badge" text,
	"guidance_badges" jsonb,
	"guidance_value_rating" integer,
	"guidance_durability_rating" integer,
	"guidance_smart_rating" integer,
	"guidance_tags" jsonb,
	"guidance_staff_quotes" jsonb,
	"branding_positions_override" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_email_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"email_type" text DEFAULT 'acknowledgement' NOT NULL,
	"to_email" text NOT NULL,
	"subject" text,
	"sent_by" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"product_id" integer,
	"product_name" text NOT NULL,
	"colour" text,
	"size" text,
	"finish_id" integer,
	"finish_name" text,
	"recipient_type" text DEFAULT 'stock' NOT NULL,
	"recipient_name" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(10, 2) DEFAULT '0' NOT NULL,
	"recipient_employee_id" integer,
	"purchase_required" boolean DEFAULT false NOT NULL,
	"purchase_quantity" integer,
	"supplier_id" integer,
	"supplier_name" text,
	"stock_status" text,
	"stock_allocated_at" timestamp with time zone,
	"vat_rate" numeric(5, 4) DEFAULT '0.2000' NOT NULL,
	"notes" text,
	"purchasing_queued_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"sbs_stock_allocated_qty" integer
);
--> statement-breakpoint
CREATE TABLE "order_label_prints" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"label_type" text DEFAULT 'wearer' NOT NULL,
	"wearer_key" text NOT NULL,
	"wearer_name" text NOT NULL,
	"item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actor" text DEFAULT 'Staff' NOT NULL,
	"printed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"action" text NOT NULL,
	"actor" text DEFAULT 'System' NOT NULL,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_message_reads" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"reader_name" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"order_number" text NOT NULL,
	"author_name" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"customer_id" integer,
	"customer_name" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"order_date" timestamp with time zone DEFAULT now() NOT NULL,
	"required_date" timestamp with time zone,
	"shipping_method" text,
	"carriage_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"delivery_address_id" integer,
	"invoice_address_id" integer,
	"dispatched_at" timestamp with time zone,
	"xero_invoice_id" text,
	"xero_invoice_number" text,
	"xero_invoice_status" text,
	"xero_invoice_posting_at" timestamp with time zone,
	"xero_invoice_posting_token" text,
	"tracking_number" text,
	"dpd_consignment_id" text,
	"dpd_job_id" bigint,
	"dpd_parcel_count" integer,
	"invoice_email_sent_at" timestamp with time zone,
	"invoice_email_sent_to" text,
	"shop_customer_id" integer,
	"source" text DEFAULT 'internal' NOT NULL,
	"portal_status" text,
	"portal_notes" text,
	"po_number" text,
	"fulfilment_group_id" text,
	"attention_of" text,
	"portal_submitted_by_email" text,
	"portal_submitted_by_name" text,
	"portal_approved_by_email" text,
	"portal_approved_by_name" text,
	"invoice_date" timestamp with time zone,
	"stripe_payment_link_url" text,
	"stripe_payment_link_id" text,
	"paid_at" timestamp with time zone,
	"invoice_scheduled_send_at" timestamp with time zone,
	"invoice_schedule_to_email" text,
	"attachments" jsonb,
	"absorbed_order_numbers" text[],
	"number_of_boxes" integer DEFAULT 1 NOT NULL,
	"woo_order_id" integer,
	"invoice_followup_due_at" timestamp with time zone,
	"invoice_followup_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"po_id" integer NOT NULL,
	"order_item_id" integer,
	"order_id" integer,
	"order_number" text,
	"product_id" integer,
	"product_name" text NOT NULL,
	"colour" text,
	"size" text,
	"supplier_code" text,
	"supplier_price" numeric(10, 2),
	"process_stock_id" integer,
	"source_order_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_order_item_quantities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quantity_ordered" integer DEFAULT 1 NOT NULL,
	"quantity_delivered" integer DEFAULT 0 NOT NULL,
	"estimated_due_date" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"po_number" text NOT NULL,
	"supplier_id" integer,
	"supplier_name" text NOT NULL,
	"supplier_email" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"attachments" jsonb,
	"sent_at" timestamp with time zone,
	"estimated_delivery_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_po_number_unique" UNIQUE("po_number")
);
--> statement-breakpoint
CREATE TABLE "worksheet_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"worksheet_id" integer NOT NULL,
	"order_item_id" integer,
	"product_name" text NOT NULL,
	"colour" text,
	"size" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"recipient_type" text DEFAULT 'stock' NOT NULL,
	"recipient_name" text,
	"finish_id" integer,
	"finish_name" text,
	"processes_snapshot" text,
	"notes" text,
	"supplier_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worksheets" (
	"id" serial PRIMARY KEY NOT NULL,
	"worksheet_number" text NOT NULL,
	"status" text DEFAULT 'pre_wip' NOT NULL,
	"order_id" integer,
	"order_number" text,
	"customer_id" integer,
	"customer_name" text,
	"notes" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worksheets_worksheet_number_unique" UNIQUE("worksheet_number")
);
--> statement-breakpoint
CREATE TABLE "customer_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"job_title" text,
	"email" text,
	"phone" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_delivery_addresses" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"label" text,
	"line1" text,
	"line2" text,
	"city" text,
	"postcode" text,
	"country" text DEFAULT 'United Kingdom',
	"invoice_address_id" integer,
	"is_default" boolean DEFAULT false,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_employee_sizes" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"label" text NOT NULL,
	"size" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"employee_number" text,
	"job_title" text,
	"department" text,
	"role_id" integer,
	"email" text,
	"phone" text,
	"avatar_url" text,
	"team_id" integer,
	"manager_id" integer,
	"delivery_address_id" integer,
	"allowance" numeric(10, 2),
	"allowance_topup" numeric(10, 2) DEFAULT '0',
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer,
	"content_type" text,
	"category" text DEFAULT 'other' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_finish_processes" (
	"id" serial PRIMARY KEY NOT NULL,
	"finish_id" integer NOT NULL,
	"process_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_finish_products" (
	"id" serial PRIMARY KEY NOT NULL,
	"finish_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"colour" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_finished_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"role_id" integer,
	"name" text NOT NULL,
	"product_id" integer NOT NULL,
	"finish_id" integer,
	"colour" text,
	"sleeve" text,
	"size" text,
	"unit_price" numeric(10, 2) NOT NULL,
	"special_price" numeric(10, 2),
	"stock_quantity" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_finishes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text,
	"customer_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"notes" text,
	"role_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_invoice_addresses" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"label" text,
	"name" text,
	"address" text,
	"line2" text,
	"city" text,
	"postcode" text,
	"billing_email" text,
	"is_default" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_processes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text,
	"customer_id" integer NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"placement" text,
	"price" numeric(10, 2),
	"process_stock_id" integer,
	"image_url" text,
	"file_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_references" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"title" text,
	"notes" text,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"annual_allowance" numeric(10, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"manager_id" integer,
	"delivery_address_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"address" text,
	"city" text,
	"county" text,
	"postcode" text,
	"country" text DEFAULT 'United Kingdom',
	"notes" text,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"default_price_breaks" jsonb,
	"logo_url" text,
	"xero_contact_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_attributes" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"type" text NOT NULL,
	"value" text NOT NULL,
	"image_url" text,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"woo_variation_id" integer,
	"colour" text,
	"size" text,
	"sleeve" text,
	"variant_attributes" jsonb,
	"sku" text,
	"price" numeric(10, 2),
	"vat_rate" numeric(5, 4),
	"image_url" text,
	"stock_quantity" integer DEFAULT 0 NOT NULL,
	"min_stock_qty" integer DEFAULT 5 NOT NULL,
	"bin_location" text,
	"primary_supplier_id" integer,
	"supplier_code" text,
	"supplier_price" numeric(10, 2),
	"secondary_supplier_id" integer,
	"secondary_supplier_code" text,
	"secondary_supplier_price" numeric(10, 2),
	"is_available" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "process_stock" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"description" text,
	"unit_cost" numeric(10, 2) DEFAULT '0' NOT NULL,
	"stock_quantity" integer DEFAULT 0 NOT NULL,
	"supplier_id" integer,
	"supplier_code" text,
	"customer_id" integer,
	"notes" text,
	"file_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sync_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text DEFAULT 'woocommerce' NOT NULL,
	"status" text NOT NULL,
	"message" text,
	"items_created" text,
	"items_updated" text,
	"errors" text,
	"progress_pct" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"customer_id" integer,
	"customer_name" text,
	"due_date" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"woo_id" integer,
	"name" text NOT NULL,
	"slug" text,
	"image_url" text,
	"parent_woo_id" integer,
	"product_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_categories_woo_id_unique" UNIQUE("woo_id")
);
--> statement-breakpoint
CREATE TABLE "stock_bins" (
	"id" serial PRIMARY KEY NOT NULL,
	"bin_number" text NOT NULL,
	"notes" text,
	"max_qty" integer DEFAULT 15 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_bins_bin_number_unique" UNIQUE("bin_number")
);
--> statement-breakpoint
CREATE TABLE "staff_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"profile_image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_open_pos" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"po_number" text NOT NULL,
	"total_value" numeric(10, 2) NOT NULL,
	"remaining_value" numeric(10, 2) NOT NULL,
	"expiry_date" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_portal_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"company" text,
	"phone" text,
	"address_1" text,
	"address_2" text,
	"city" text,
	"county" text,
	"postcode" text,
	"country" text DEFAULT 'GB' NOT NULL,
	"woo_customer_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "callback_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"callback_request_id" text NOT NULL,
	"phone" text NOT NULL,
	"phone_normalised" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"callback_type" text NOT NULL,
	"source" text DEFAULT 'website_callback' NOT NULL,
	"business_open" boolean NOT NULL,
	"page_url" text,
	"page_title" text,
	"referrer" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"gclid" text,
	"fbclid" text,
	"session_id" text,
	"device_type" text,
	"user_agent" text,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"highlevel_sent_at" timestamp with time zone,
	"highlevel_response_status" integer,
	"highlevel_contact_id" text,
	"highlevel_contact_http_status" integer,
	"highlevel_contact_succeeded" boolean,
	"highlevel_contact_response_body" text,
	"highlevel_contact_error" text,
	"highlevel_workflow_id" text,
	"highlevel_workflow_status" text,
	"highlevel_workflow_http_status" integer,
	"highlevel_workflow_succeeded" boolean,
	"highlevel_workflow_response_body" text,
	"highlevel_workflow_error" text,
	"highlevel_attempt_count" integer DEFAULT 0 NOT NULL,
	"highlevel_last_attempt_at" timestamp with time zone,
	"error_message" text,
	CONSTRAINT "callback_requests_callback_request_id_unique" UNIQUE("callback_request_id")
);
--> statement-breakpoint
CREATE TABLE "live_chat_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"page_url" text,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"flagged_for_training" boolean DEFAULT false NOT NULL,
	"training_notes" text
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analytics_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_id" uuid NOT NULL,
	"visitor_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"path" text NOT NULL,
	"product_id" text,
	"category_id" text,
	"channel" text NOT NULL,
	"landing_path" text NOT NULL,
	"referrer_domain" text,
	"device_category" text NOT NULL,
	"search_term" text,
	"quantity" integer,
	"value" numeric(12, 2),
	CONSTRAINT "analytics_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "analytics_sessions" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"visitor_id" uuid NOT NULL,
	"first_touch" text NOT NULL,
	"first_path" text NOT NULL,
	"referrer_domain" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"channel" text NOT NULL,
	"device_category" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_attribution" (
	"order_id" integer PRIMARY KEY NOT NULL,
	"visitor_id" uuid,
	"session_id" uuid,
	"first_touch" text NOT NULL,
	"last_touch" text NOT NULL,
	"first_landing_path" text NOT NULL,
	"last_landing_path" text NOT NULL,
	"first_channel" text NOT NULL,
	"last_channel" text NOT NULL,
	"first_referrer_domain" text,
	"last_referrer_domain" text,
	"first_utm_source" text,
	"first_utm_medium" text,
	"first_utm_campaign" text,
	"first_utm_content" text,
	"first_utm_term" text,
	"last_utm_source" text,
	"last_utm_medium" text,
	"last_utm_campaign" text,
	"last_utm_content" text,
	"last_utm_term" text,
	"repeat_order" boolean DEFAULT false NOT NULL,
	"revenue" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_email_logs" ADD CONSTRAINT "order_email_logs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_label_prints" ADD CONSTRAINT "order_label_prints_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_logs" ADD CONSTRAINT "order_logs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_message_reads" ADD CONSTRAINT "order_message_reads_message_id_order_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."order_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_messages" ADD CONSTRAINT "order_messages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_customer_id_shop_customers_id_fk" FOREIGN KEY ("shop_customer_id") REFERENCES "public"."shop_customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worksheet_items" ADD CONSTRAINT "worksheet_items_worksheet_id_worksheets_id_fk" FOREIGN KEY ("worksheet_id") REFERENCES "public"."worksheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worksheet_items" ADD CONSTRAINT "worksheet_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worksheets" ADD CONSTRAINT "worksheets_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_delivery_addresses" ADD CONSTRAINT "customer_delivery_addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_employee_sizes" ADD CONSTRAINT "customer_employee_sizes_employee_id_customer_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."customer_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_employees" ADD CONSTRAINT "customer_employees_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_employees" ADD CONSTRAINT "customer_employees_delivery_address_id_customer_delivery_addresses_id_fk" FOREIGN KEY ("delivery_address_id") REFERENCES "public"."customer_delivery_addresses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_files" ADD CONSTRAINT "customer_files_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_finish_processes" ADD CONSTRAINT "customer_finish_processes_finish_id_customer_finishes_id_fk" FOREIGN KEY ("finish_id") REFERENCES "public"."customer_finishes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_finish_processes" ADD CONSTRAINT "customer_finish_processes_process_id_customer_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."customer_processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_finish_products" ADD CONSTRAINT "customer_finish_products_finish_id_customer_finishes_id_fk" FOREIGN KEY ("finish_id") REFERENCES "public"."customer_finishes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_finished_items" ADD CONSTRAINT "customer_finished_items_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_finishes" ADD CONSTRAINT "customer_finishes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoice_addresses" ADD CONSTRAINT "customer_invoice_addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_processes" ADD CONSTRAINT "customer_processes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_references" ADD CONSTRAINT "customer_references_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_roles" ADD CONSTRAINT "customer_roles_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_teams" ADD CONSTRAINT "customer_teams_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_teams" ADD CONSTRAINT "customer_teams_delivery_address_id_customer_delivery_addresses_id_fk" FOREIGN KEY ("delivery_address_id") REFERENCES "public"."customer_delivery_addresses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_primary_supplier_id_suppliers_id_fk" FOREIGN KEY ("primary_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_secondary_supplier_id_suppliers_id_fk" FOREIGN KEY ("secondary_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_stock" ADD CONSTRAINT "process_stock_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_stock" ADD CONSTRAINT "process_stock_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_open_pos" ADD CONSTRAINT "customer_open_pos_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_events_date_idx" ON "analytics_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_events_session_idx" ON "analytics_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "analytics_events_type_idx" ON "analytics_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "analytics_events_product_idx" ON "analytics_events" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "analytics_events_category_idx" ON "analytics_events" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "analytics_events_channel_idx" ON "analytics_events" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "analytics_sessions_visitor_idx" ON "analytics_sessions" USING btree ("visitor_id");