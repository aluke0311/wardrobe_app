-- =====================================================================
-- Phase 2 migration — clean 1-6 formality model
-- Run in the Supabase SQL editor BEFORE deploying the Phase 2 UI.
-- Idempotent: safe to re-run (ADD COLUMN IF NOT EXISTS throughout).
-- =====================================================================

-- -------------------------------------------------------------------
-- 1. items.formality — replaces min_occasion / max_occasion
-- -------------------------------------------------------------------
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS formality smallint CHECK (formality BETWEEN 1 AND 6);

-- Seed formality from existing min/max_occasion data.
-- Mapping: Workout category → 1 (Function); others: old_avg + 1 → clamped 1–6.
-- Old 1 (Lounge)→2, 2 (Casual)→3, 3 (Smart)→4, 4 (Dressy)→5, 5 (Formal)→6.
UPDATE items
SET formality = CASE
  WHEN category = 'Workout' THEN 1
  WHEN min_occasion IS NOT NULL AND max_occasion IS NOT NULL
    THEN LEAST(6, ROUND((min_occasion + max_occasion)::numeric / 2) + 1)::smallint
  WHEN min_occasion IS NOT NULL THEN LEAST(6, min_occasion + 1)::smallint
  WHEN max_occasion IS NOT NULL THEN LEAST(6, max_occasion + 1)::smallint
  ELSE NULL
END
WHERE formality IS NULL;

-- -------------------------------------------------------------------
-- 2. wears.formality_for — optional demand capture (1–6)
-- -------------------------------------------------------------------
ALTER TABLE wears
  ADD COLUMN IF NOT EXISTS formality_for smallint CHECK (formality_for BETWEEN 1 AND 6);

-- -------------------------------------------------------------------
-- 3. outfits.rating — reserved for future 👍/👎 feedback
-- -------------------------------------------------------------------
ALTER TABLE outfits
  ADD COLUMN IF NOT EXISTS rating smallint CHECK (rating BETWEEN 1 AND 5);

-- -------------------------------------------------------------------
-- 4. Migrate outfits.formality_override to new bucket keys
-- -------------------------------------------------------------------
UPDATE outfits SET formality_override = 'function' WHERE formality_override = 'workout';
UPDATE outfits SET formality_override = 'vcasual'  WHERE formality_override = 'lounge';
UPDATE outfits SET formality_override = 'ecasual'  WHERE formality_override = 'casual';
-- 'smart', 'dressy', 'formal' keys stay the same.

-- -------------------------------------------------------------------
-- 5. exclusions table — explicit "these two don't go" pairs
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exclusions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL DEFAULT auth.uid(),
  item_a     uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  item_b     uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exclusions_ordered CHECK (item_a < item_b),
  CONSTRAINT exclusions_unique  UNIQUE (user_id, item_a, item_b)
);

CREATE INDEX IF NOT EXISTS exclusions_user_idx ON exclusions(user_id);
CREATE INDEX IF NOT EXISTS exclusions_item_a_idx ON exclusions(item_a);
CREATE INDEX IF NOT EXISTS exclusions_item_b_idx ON exclusions(item_b);

ALTER TABLE exclusions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'exclusions' AND policyname = 'own_rows') THEN
    CREATE POLICY own_rows ON exclusions FOR ALL TO authenticated
      USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- -------------------------------------------------------------------
-- 6. Drop stale v25 columns from items (run after confirming Phase 2 UI
--    is deployed and no code touches these columns anymore).
--    Uncomment to apply. They are retained here for reference.
-- -------------------------------------------------------------------
-- ALTER TABLE items
--   DROP COLUMN IF EXISTS min_occasion,
--   DROP COLUMN IF EXISTS max_occasion,
--   DROP COLUMN IF EXISTS availability,
--   DROP COLUMN IF EXISTS care,
--   DROP COLUMN IF EXISTS needs_repair,
--   DROP COLUMN IF EXISTS needs_tailoring,
--   DROP COLUMN IF EXISTS storage_location,
--   DROP COLUMN IF EXISTS fit,
--   DROP COLUMN IF EXISTS length,
--   DROP COLUMN IF EXISTS rise,
--   DROP COLUMN IF EXISTS price_original;

-- -------------------------------------------------------------------
-- 7. Drop events table (calendar uses wears, not events).
--    Uncomment once you've confirmed no data you want to keep.
-- -------------------------------------------------------------------
-- DROP TABLE IF EXISTS events;
