-- Migration: convert wears.context from text to text[] (multi-select)
-- Run in Supabase SQL editor BEFORE / with the deploy that adds context logging.
--
-- A single wearing can map to several contexts (e.g. Work + Rehearsal in one day).
-- Existing single values (if any) are wrapped into 1-element arrays; NULL stays NULL.
-- (context was never populated by the importer, so in practice all rows are NULL.)

ALTER TABLE wears
  ALTER COLUMN context TYPE text[]
  USING (CASE WHEN context IS NULL THEN NULL ELSE ARRAY[context] END);
