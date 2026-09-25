-- Reviewed, schema-only additions for tables used by the staged application.
-- This migration intentionally contains no seed rows, settings, credentials, or
-- historical repair statements.  It is independent of startup-migrations.ts.

CREATE TABLE IF NOT EXISTS order_confirmation_content_alerts (
  order_id integer PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 1,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_email_campaigns (
  id serial PRIMARY KEY, article_id text NOT NULL, article_link text,
  title text NOT NULL, subject text NOT NULL, preheader text,
  from_name text NOT NULL, from_email text NOT NULL,
  tag_ids jsonb NOT NULL DEFAULT '[]'::jsonb, html_content text NOT NULL,
  status text NOT NULL DEFAULT 'draft', audience_count integer,
  scheduled_at timestamptz, high_level_campaign_id text,
  high_level_source_id text, error_message text, created_by text,
  audience_mode text NOT NULL DEFAULT 'tags',
  excluded_tag_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS knowledge_email_campaigns_status_idx
  ON knowledge_email_campaigns (status, created_at DESC);

CREATE TABLE IF NOT EXISTS wc_enquiries (
  id serial PRIMARY KEY, product_id integer, product_name text,
  customer_name text NOT NULL, email text NOT NULL, phone text,
  message text NOT NULL, customer_id integer REFERENCES customers(id) ON DELETE SET NULL,
  is_read boolean NOT NULL DEFAULT false, source text NOT NULL DEFAULT 'webhook',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_chase_logs (
  id serial PRIMARY KEY,
  purchase_order_id integer NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  purchase_order_item_id integer NOT NULL REFERENCES purchase_order_items(id) ON DELETE CASCADE,
  order_id integer REFERENCES orders(id) ON DELETE SET NULL,
  effective_due_date date NOT NULL, supplier_email text NOT NULL,
  message_id text, provider text, sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_chase_logs_line_due_idx
  ON supplier_chase_logs (purchase_order_item_id, effective_due_date);
CREATE INDEX IF NOT EXISTS supplier_chase_logs_order_sent_idx
  ON supplier_chase_logs (order_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS customer_portal_users (
  id serial PRIMARY KEY, customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  email text NOT NULL, password_hash text, invite_token text,
  invite_expires_at timestamptz, status text NOT NULL DEFAULT 'invited',
  portal_role text NOT NULL DEFAULT 'member', linked_employee_id integer REFERENCES customer_employees(id) ON DELETE SET NULL,
  selection_token text, selection_expires_at timestamptz,
  first_name text, last_name text, show_pricing boolean NOT NULL DEFAULT false,
  invite_sent_at timestamptz, last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_portal_users_email_customer_unique UNIQUE (email, customer_id)
);
CREATE INDEX IF NOT EXISTS customer_portal_users_invite_token_idx
  ON customer_portal_users (invite_token);

CREATE TABLE IF NOT EXISTS customer_enquiries (
  id serial PRIMARY KEY, customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  portal_user_id integer REFERENCES customer_portal_users(id),
  enquiry_ref text NOT NULL, status text NOT NULL DEFAULT 'pending',
  notes text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS customer_enquiry_items (
  id serial PRIMARY KEY, enquiry_id integer NOT NULL REFERENCES customer_enquiries(id) ON DELETE CASCADE,
  product_id integer REFERENCES products(id), product_name text NOT NULL,
  image_url text, colour text, desired_processes text, item_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS demo_leads (
  id serial PRIMARY KEY, first_name text NOT NULL, last_name text NOT NULL,
  email text NOT NULL, company text NOT NULL, ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_stock_movements (
  id serial PRIMARY KEY, customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  stock_item_id integer NOT NULL REFERENCES customer_finished_items(id) ON DELETE CASCADE,
  movement_type text NOT NULL, quantity integer NOT NULL, reference text,
  recipient_name text, notes text, created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portal_notifications (
  id serial PRIMARY KEY, customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  portal_user_id integer REFERENCES customer_portal_users(id) ON DELETE CASCADE,
  title text NOT NULL, body text, link text, type text NOT NULL DEFAULT 'info',
  is_read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS portal_baskets (
  id serial PRIMARY KEY, portal_user_id integer NOT NULL REFERENCES customer_portal_users(id) ON DELETE CASCADE,
  customer_id integer NOT NULL, customer_name text, user_email text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb, item_count integer NOT NULL DEFAULT 0,
  estimated_total numeric(10,2) NOT NULL DEFAULT 0, mode text,
  step integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (portal_user_id)
);

CREATE TABLE IF NOT EXISTS select_extra_offers (
  id serial PRIMARY KEY, year integer NOT NULL, month integer NOT NULL,
  title text NOT NULL, product_name text NOT NULL, description text,
  image_url text, product_url text, quantity integer NOT NULL DEFAULT 1,
  min_spend numeric(10,2) NOT NULL DEFAULT 250.00, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (year, month)
);
CREATE TABLE IF NOT EXISTS select_extra_claims (
  id serial PRIMARY KEY, offer_id integer NOT NULL REFERENCES select_extra_offers(id) ON DELETE CASCADE,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id integer REFERENCES orders(id) ON DELETE SET NULL, order_number text,
  customer_name text, claimed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offer_id, customer_id)
);

CREATE TABLE IF NOT EXISTS customer_finish_stock (
  id serial PRIMARY KEY, customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_name text NOT NULL, colour text, size text, sku text,
  quantity integer NOT NULL DEFAULT 0, notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotes (
  id serial PRIMARY KEY, quote_number text NOT NULL UNIQUE,
  customer_id integer REFERENCES customers(id) ON DELETE SET NULL,
  enquiry_id integer, wc_enquiry_id integer, customer_name text NOT NULL,
  status text NOT NULL DEFAULT 'draft', notes text, cover_text text,
  expires_at timestamptz, token uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_logo_url text, contact_first_name text, contact_last_name text,
  contact_email text, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS quote_items (
  id serial PRIMARY KEY, quote_id integer NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  parent_item_id integer REFERENCES quote_items(id) ON DELETE CASCADE,
  product_id integer REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL, colour text, size text, finish_id integer,
  finish_name text, quantity integer NOT NULL DEFAULT 1,
  unit_price numeric(10,2) NOT NULL DEFAULT 0, vat_rate numeric(6,4) NOT NULL DEFAULT 0.20,
  notes text, sort_order integer NOT NULL DEFAULT 0, product_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE SEQUENCE IF NOT EXISTS quote_number_seq START 1;
CREATE TABLE IF NOT EXISTS enquiries (
  id serial PRIMARY KEY, hl_contact_id text NOT NULL UNIQUE, name text NOT NULL,
  company text, email text, phone text, source_tag text NOT NULL DEFAULT 'unknown',
  last_synced_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE quotes ADD CONSTRAINT quotes_enquiry_fk FOREIGN KEY (enquiry_id) REFERENCES enquiries(id) ON DELETE SET NULL;
ALTER TABLE quotes ADD CONSTRAINT quotes_wc_enquiry_fk FOREIGN KEY (wc_enquiry_id) REFERENCES wc_enquiries(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS bundles (
  id serial PRIMARY KEY, name text NOT NULL, sku text, description text,
  price numeric(10,2) NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true,
  notes text, woo_id integer, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bundle_components (
  id serial PRIMARY KEY, bundle_id integer NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  product_id integer REFERENCES products(id) ON DELETE SET NULL, product_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1, finish_id integer, finish_name text, notes text
);

CREATE TABLE IF NOT EXISTS feedback_items (
  id serial PRIMARY KEY, type text NOT NULL, title text NOT NULL,
  description text NOT NULL DEFAULT '', submitted_by text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'staff', status text NOT NULL DEFAULT 'open',
  admin_note text NOT NULL DEFAULT '', note_by text, note_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS manual_purchase_requirements (
  id serial PRIMARY KEY, supplier_id integer REFERENCES suppliers(id),
  supplier_name text NOT NULL, supplier_email text, supplier_currency text NOT NULL DEFAULT 'GBP',
  product_id integer REFERENCES products(id), product_name text NOT NULL, product_sku text,
  supplier_code text, colour text, size text, quantity integer NOT NULL DEFAULT 1,
  supplier_price numeric(10,2), notes text, created_at timestamptz NOT NULL DEFAULT now(),
  fulfilled_at timestamptz
);

CREATE TABLE IF NOT EXISTS social_posts (
  id serial PRIMARY KEY, product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  facebook_content text NOT NULL DEFAULT '', google_content text NOT NULL DEFAULT '',
  linkedin_content text NOT NULL DEFAULT '', hashtags text NOT NULL DEFAULT '',
  platforms text[] NOT NULL DEFAULT ARRAY['facebook','google'],
  status text NOT NULL DEFAULT 'draft', scheduled_at timestamptz, published_at timestamptz,
  auto_reschedule boolean NOT NULL DEFAULT false, error_message text,
  fb_post_id text, gbp_post_name text, product_image_url text,
  fb_reactions integer NOT NULL DEFAULT 0, fb_comments integer NOT NULL DEFAULT 0,
  fb_shares integer NOT NULL DEFAULT 0, fb_stats_at timestamptz, last_comments jsonb,
  new_activity boolean NOT NULL DEFAULT false, website_url text, season text,
  li_post_urn text, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_templates (
  id serial PRIMARY KEY, key text NOT NULL UNIQUE, name text NOT NULL,
  channel text NOT NULL DEFAULT 'email', subject text, body text NOT NULL DEFAULT '',
  variables jsonb, notes text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS linkedin_shared_posts (
  id serial PRIMARY KEY, wp_post_id integer NOT NULL UNIQUE, wp_title text,
  linkedin_post_urn text, gbp_post_name text, shared_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflows (
  id serial PRIMARY KEY, name text NOT NULL, trigger_type text NOT NULL,
  is_active boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workflow_steps (
  id serial PRIMARY KEY, workflow_id integer NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0, step_type text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS workflow_steps_workflow_id_idx ON workflow_steps (workflow_id);
CREATE TABLE IF NOT EXISTS workflow_executions (
  id serial PRIMARY KEY, workflow_id integer NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  contact_email text, contact_name text, contact_phone text,
  context_data jsonb NOT NULL DEFAULT '{}'::jsonb, current_step integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running', next_run_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, error text
);
CREATE INDEX IF NOT EXISTS workflow_executions_status_next_run_idx
  ON workflow_executions (status, next_run_at) WHERE status = 'running';