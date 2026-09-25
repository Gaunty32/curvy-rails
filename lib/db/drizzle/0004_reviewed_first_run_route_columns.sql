-- Route-derived compatibility columns required by common first-run
-- customer, order, portal, and shop paths.
-- Schema only: this migration creates no business data or historical repairs.
-- Apply after 0003_reviewed_route_columns.sql.

ALTER TABLE customers
  ADD COLUMN default_shipping_option text;

ALTER TABLE customer_finished_items
  ADD COLUMN location text,
  ADD COLUMN min_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN reorder_quantity integer NOT NULL DEFAULT 0,
  ALTER COLUMN product_id DROP NOT NULL;

ALTER TABLE orders
  ADD COLUMN portal_approved_at timestamptz;

ALTER TABLE products
  ADD COLUMN regular_price text,
  ADD COLUMN on_sale boolean NOT NULL DEFAULT false,
  ADD COLUMN permalink text,
  ADD COLUMN gallery_images jsonb,
  ADD COLUMN size_guide_html text,
  ADD COLUMN guidance_staff_recommendation text;