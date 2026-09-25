-- Route-derived compatibility columns missing from the original baseline.
-- Schema only: no historical order or quote data is created or repaired.
-- Apply after 0001_reviewed_missing_tables.sql (and 0002).

ALTER TABLE orders
  ADD COLUMN portal_submitted_by_employee_id integer
    REFERENCES customer_employees(id) ON DELETE SET NULL,
  ADD COLUMN portal_submitted_at timestamptz,
  ADD COLUMN add_to_stores boolean NOT NULL DEFAULT false,
  ADD COLUMN quote_id integer REFERENCES quotes(id) ON DELETE SET NULL;

ALTER TABLE order_items
  ADD COLUMN bundle_ref text,
  ADD COLUMN is_bundle_header boolean NOT NULL DEFAULT false,
  ADD COLUMN bundle_def_id integer REFERENCES bundles(id) ON DELETE SET NULL;

ALTER TABLE products
  ADD COLUMN issue_snoozed_until timestamptz;

ALTER TABLE quotes
  ADD COLUMN delivery_address_id integer
    REFERENCES customer_delivery_addresses(id) ON DELETE SET NULL;