-- Archive looks (outfits) the user wore but doesn't want resurfaced.
-- Adds an "archived" flag to outfits. Archived looks stay in history but are
-- hidden from the Looks browse and the calendar "+ Look" picker; they remain
-- viewable under an "Archived" lens in the Looks tab.
-- Run in the Supabase SQL editor BEFORE deploying the archive UI.
-- The app reads `archived` as falsy when the column is absent, so reads are safe
-- pre-migration; only the Archive button's PATCH needs this column to exist.

ALTER TABLE outfits
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
