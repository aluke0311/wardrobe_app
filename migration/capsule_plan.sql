-- Per-day outfit planning for trips.
-- capsules.plan maps a trip date (YYYY-MM-DD) → array of outfit (look) ids planned
-- for that day, e.g. { "2026-07-06": ["<outfitId>", ...] }.
-- Plans are intentions, kept separate from `wears` (which stay past-only and feed
-- wear-count stats). A "Wore it" tap converts a planned day into a real wear.
-- Run once in the Supabase SQL editor. RLS already scopes capsules to auth.uid().

ALTER TABLE capsules ADD COLUMN IF NOT EXISTS plan jsonb;
