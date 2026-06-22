-- r12 — Build-a-look canvas: store each look's free-form arrangement.
-- layout is an array of { item_id, x, y, s } where x/y are the piece CENTER as a
-- fraction (0..1) of the canvas, and s is the piece width as a fraction of the
-- canvas width. Array order = z-order (later entries render on top).
-- Run once in the Supabase SQL editor before deploying r12.

ALTER TABLE outfits ADD COLUMN IF NOT EXISTS layout JSONB NOT NULL DEFAULT '[]'::jsonb;
