-- Upgrade databases that applied the initial Phase 1 migration before
-- stocktake movement revisions were introduced. Fresh installs already get
-- this column from 0006_manufacturing_phase1.sql. Old drafts receive -1 and
-- cannot be approved against a later movement; recount them instead.
BEGIN;
ALTER TABLE manufacturing_stocktakes
  ADD COLUMN IF NOT EXISTS movement_revision integer NOT NULL DEFAULT -1;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'manufacturing_stocktakes_movement_revision_check'
      AND conrelid = 'manufacturing_stocktakes'::regclass
  ) THEN
    ALTER TABLE manufacturing_stocktakes
      ADD CONSTRAINT manufacturing_stocktakes_movement_revision_check
      CHECK (movement_revision >= -1);
  END IF;
END;
$$;
COMMIT;