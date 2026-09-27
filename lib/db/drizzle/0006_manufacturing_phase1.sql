-- Phase 1 manufacturing data model. Additive schema only: no legacy quantities
-- are migrated or reclassified. Apply after 0005_checkout_intent_snapshots.sql.
-- Apply from the repository root with:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/drizzle/0006_manufacturing_phase1.sql
BEGIN;

ALTER TABLE product_variants
  ADD COLUMN inventory_classification text NOT NULL DEFAULT 'LEGACY_REVIEW';
ALTER TABLE product_variants
  ADD CONSTRAINT product_variants_inventory_classification_check
  CHECK (inventory_classification IN ('LEGACY_REVIEW', 'FINISHED_STOCK', 'COMPONENT_STOCK'));

CREATE TABLE manufacturing_components (
  id serial PRIMARY KEY,
  sku text NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('garment', 'transfer', 'patch', 'packaging', 'other')),
  supplier_id integer REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_sku text,
  cost_gbp numeric(10,2) NOT NULL DEFAULT 0 CHECK (cost_gbp >= 0),
  bin text,
  reorder_level integer NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  target_level integer NOT NULL DEFAULT 0 CHECK (target_level >= 0),
  lead_days integer CHECK (lead_days IS NULL OR lead_days >= 0),
  active boolean NOT NULL DEFAULT true,
  physical_balance integer NOT NULL DEFAULT 0 CHECK (physical_balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX manufacturing_components_sku_uidx ON manufacturing_components(sku);

CREATE TABLE manufacturing_stock_movements (
  id serial PRIMARY KEY,
  component_id integer NOT NULL REFERENCES manufacturing_components(id) ON DELETE RESTRICT,
  quantity_change integer NOT NULL,
  reason text NOT NULL,
  actor text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reference text,
  note text,
  resulting_balance integer NOT NULL CHECK (resulting_balance >= 0),
  CHECK (quantity_change <> 0 OR reason = 'OPENING_BALANCE')
);
CREATE INDEX manufacturing_movements_component_created_idx
  ON manufacturing_stock_movements(component_id, occurred_at);
CREATE UNIQUE INDEX manufacturing_movements_opening_once_uidx
  ON manufacturing_stock_movements(component_id) WHERE reason = 'OPENING_BALANCE';

CREATE TABLE manufacturing_stocktakes (
  id serial PRIMARY KEY,
  component_id integer NOT NULL REFERENCES manufacturing_components(id) ON DELETE RESTRICT,
  expected_quantity integer NOT NULL CHECK (expected_quantity >= 0),
  counted_quantity integer NOT NULL CHECK (counted_quantity >= 0),
  movement_revision integer NOT NULL DEFAULT -1
    CONSTRAINT manufacturing_stocktakes_movement_revision_check CHECK (movement_revision >= -1),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  created_by text NOT NULL,
  approved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  note text
);
CREATE INDEX manufacturing_stocktakes_component_idx
  ON manufacturing_stocktakes(component_id, created_at);

CREATE TABLE manufacturing_boms (
  id serial PRIMARY KEY,
  variant_id integer NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  is_current boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(variant_id, version)
);
CREATE UNIQUE INDEX manufacturing_boms_current_variant_uidx
  ON manufacturing_boms(variant_id) WHERE is_current;
CREATE INDEX manufacturing_boms_variant_idx ON manufacturing_boms(variant_id);

CREATE TABLE manufacturing_bom_components (
  id serial PRIMARY KEY,
  bom_id integer NOT NULL REFERENCES manufacturing_boms(id) ON DELETE RESTRICT,
  component_id integer NOT NULL REFERENCES manufacturing_components(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  component_sku_snapshot text NOT NULL,
  component_name_snapshot text NOT NULL,
  unit_cost_gbp_snapshot numeric(10,2) NOT NULL CHECK (unit_cost_gbp_snapshot >= 0),
  UNIQUE(bom_id, component_id)
);
CREATE INDEX manufacturing_bom_components_component_idx
  ON manufacturing_bom_components(component_id);

CREATE TABLE manufacturing_bom_operations (
  id serial PRIMARY KEY,
  bom_id integer NOT NULL REFERENCES manufacturing_boms(id) ON DELETE RESTRICT,
  method text NOT NULL,
  design_ref text,
  position text,
  instructions text,
  labour_allowance numeric(10,2) NOT NULL DEFAULT 0 CHECK (labour_allowance >= 0),
  thumbnail text,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE INDEX manufacturing_bom_operations_bom_idx ON manufacturing_bom_operations(bom_id);

-- Ledger rows and historical BOM contents are append-only. Switching current
-- BOM status remains the sole allowed header update.
CREATE FUNCTION manufacturing_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'manufacturing records are immutable';
END;
$$;
CREATE TRIGGER manufacturing_movements_append_only
  BEFORE UPDATE OR DELETE ON manufacturing_stock_movements
  FOR EACH ROW EXECUTE FUNCTION manufacturing_reject_mutation();
CREATE TRIGGER manufacturing_bom_components_append_only
  BEFORE UPDATE OR DELETE ON manufacturing_bom_components
  FOR EACH ROW EXECUTE FUNCTION manufacturing_reject_mutation();
CREATE TRIGGER manufacturing_bom_operations_append_only
  BEFORE UPDATE OR DELETE ON manufacturing_bom_operations
  FOR EACH ROW EXECUTE FUNCTION manufacturing_reject_mutation();
CREATE FUNCTION manufacturing_bom_header_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.variant_id IS DISTINCT FROM OLD.variant_id
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'BOM versions are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER manufacturing_bom_header_immutable_trigger
  BEFORE UPDATE ON manufacturing_boms
  FOR EACH ROW EXECUTE FUNCTION manufacturing_bom_header_immutable();

COMMIT;