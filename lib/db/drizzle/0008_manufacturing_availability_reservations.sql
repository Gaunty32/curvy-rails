-- Phase 2 component availability, checkout holds and paid allocations.
-- Additive only: no legacy quantities or physical balances are changed.
-- Apply manually after 0007_manufacturing_stocktake_revision.sql.
BEGIN;

ALTER TABLE product_variants
  ADD COLUMN manufacturing_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN allow_order_to_replenish boolean NOT NULL DEFAULT false,
  ADD COLUMN max_outstanding_replenishment_units integer NOT NULL DEFAULT 0,
  ADD COLUMN promised_replenishment_days integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT product_variants_replenishment_policy_check
    CHECK (max_outstanding_replenishment_units >= 0 AND promised_replenishment_days >= 0);

ALTER TABLE manufacturing_components
  ADD COLUMN replenishable boolean NOT NULL DEFAULT false;

CREATE TABLE manufacturing_availability_policies (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  low_stock_threshold integer NOT NULL DEFAULT 3 CHECK (low_stock_threshold >= 0),
  hold_duration_minutes integer NOT NULL DEFAULT 20 CHECK (hold_duration_minutes BETWEEN 1 AND 1440),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO manufacturing_availability_policies (id) VALUES (1);

CREATE TABLE manufacturing_checkout_holds (
  id serial PRIMARY KEY,
  payment_intent_id text NOT NULL,
  line_index integer NOT NULL CHECK (line_index >= 0),
  variant_id integer NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  bom_id integer NOT NULL REFERENCES manufacturing_boms(id) ON DELETE RESTRICT,
  component_id integer NOT NULL REFERENCES manufacturing_components(id) ON DELETE RESTRICT,
  component_sku_snapshot text NOT NULL,
  component_name_snapshot text NOT NULL,
  required_quantity integer NOT NULL CHECK (required_quantity > 0),
  held_quantity integer NOT NULL CHECK (held_quantity >= 0),
  shortfall_quantity integer NOT NULL DEFAULT 0 CHECK (shortfall_quantity >= 0),
  checkout_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CONVERTED', 'RELEASED', 'EXPIRED')),
  CHECK (held_quantity + shortfall_quantity = required_quantity)
);
CREATE UNIQUE INDEX manufacturing_checkout_holds_idempotency_uidx
  ON manufacturing_checkout_holds(payment_intent_id, line_index, variant_id, bom_id, component_id);
CREATE INDEX manufacturing_checkout_holds_active_component_idx
  ON manufacturing_checkout_holds(component_id, status, expires_at);
CREATE INDEX manufacturing_checkout_holds_intent_idx ON manufacturing_checkout_holds(payment_intent_id);

CREATE TABLE manufacturing_confirmed_allocations (
  id serial PRIMARY KEY,
  order_id integer NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  order_item_id integer NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
  payment_intent_id text NOT NULL,
  line_index integer NOT NULL CHECK (line_index >= 0),
  variant_id integer NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  bom_id integer NOT NULL REFERENCES manufacturing_boms(id) ON DELETE RESTRICT,
  component_id integer NOT NULL REFERENCES manufacturing_components(id) ON DELETE RESTRICT,
  component_sku_snapshot text NOT NULL,
  component_name_snapshot text NOT NULL,
  required_quantity integer NOT NULL CHECK (required_quantity > 0),
  allocated_quantity integer NOT NULL CHECK (allocated_quantity >= 0),
  shortfall_quantity integer NOT NULL DEFAULT 0 CHECK (shortfall_quantity >= 0),
  manual_review_required boolean NOT NULL DEFAULT false,
  manual_review_reason text,
  status text NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED', 'RELEASED')),
  allocated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (allocated_quantity + shortfall_quantity = required_quantity)
);
CREATE UNIQUE INDEX manufacturing_allocations_order_item_component_uidx
  ON manufacturing_confirmed_allocations(order_id, order_item_id, component_id);
CREATE UNIQUE INDEX manufacturing_allocations_payment_line_component_uidx
  ON manufacturing_confirmed_allocations(payment_intent_id, line_index, component_id);
CREATE INDEX manufacturing_allocations_component_status_idx
  ON manufacturing_confirmed_allocations(component_id, status);
CREATE INDEX manufacturing_allocations_order_idx ON manufacturing_confirmed_allocations(order_id);

COMMIT;