-- Migration: convert items.formality from smallint to smallint[]
-- Run in Supabase SQL editor BEFORE deploying 2026-06-26 r1.
--
-- Existing single values (1-6) are preserved as 1-element arrays.
-- NULL stays NULL (unset items fall through to imputation in the UI).

-- Drop the old scalar check constraint first (incompatible with array type).
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_formality_check;

-- Convert smallint → smallint[].
ALTER TABLE items
  ALTER COLUMN formality TYPE smallint[]
  USING (CASE WHEN formality IS NULL THEN NULL ELSE ARRAY[formality] END);
