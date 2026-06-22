-- r7: packing checklist for Trips.
-- Adds a per-item "packed" flag to the capsule_items join table.
-- Run in the Supabase SQL editor BEFORE deploying the r7 UI's packing tick.
-- The UI loads/inserts capsule_items without referencing `packed`, so it works
-- before this runs; the checkbox simply starts persisting once the column exists.

ALTER TABLE capsule_items
  ADD COLUMN IF NOT EXISTS packed boolean NOT NULL DEFAULT false;
