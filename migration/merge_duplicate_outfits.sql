-- merge_duplicate_outfits.sql
-- One-time DATA cleanup (not a schema change).
-- Collapses outfits that share an identical item-set into one canonical outfit,
-- re-pointing every wear to the survivor so history is preserved as multiple wears.
--
-- Canonical (survivor) preference, per user + item-set:
--   1. non-archived over archived  (never hide a look that had a live duplicate)
--   2. has a saved layout over none ("best one")
--   3. oldest created_at, then id   (stable tie-break)
--
-- Idempotent: running again is a no-op once duplicates are gone.
-- Run in the Supabase SQL editor. Wrapped in a transaction.

BEGIN;

CREATE TEMP TABLE _dup_map ON COMMIT DROP AS
WITH sets AS (
  SELECT o.id, o.user_id, o.created_at,
         (o.layout IS NOT NULL)            AS has_layout,
         (NOT COALESCE(o.archived, false)) AS is_live,
         oi.itemset
  FROM outfits o
  JOIN (
    SELECT outfit_id, array_agg(item_id ORDER BY item_id) AS itemset
    FROM outfit_items
    GROUP BY outfit_id
  ) oi ON oi.outfit_id = o.id
),
ranked AS (
  SELECT id, user_id, itemset,
    first_value(id) OVER (
      PARTITION BY user_id, itemset
      ORDER BY is_live DESC, has_layout DESC, created_at ASC, id ASC
    ) AS canonical_id,
    count(*) OVER (PARTITION BY user_id, itemset) AS grp_n
  FROM sets
)
SELECT id AS dup_id, canonical_id
FROM ranked
WHERE grp_n > 1 AND id <> canonical_id;

-- 1. Re-point wears from duplicates to the survivor (becomes "multiple wears").
UPDATE wears w
   SET outfit_id = m.canonical_id
  FROM _dup_map m
 WHERE w.outfit_id = m.dup_id;

-- 2. Drop the duplicates' item links.
DELETE FROM outfit_items oi
 USING _dup_map m
 WHERE oi.outfit_id = m.dup_id;

-- 3. Drop the duplicate outfit rows.
DELETE FROM outfits o
 USING _dup_map m
 WHERE o.id = m.dup_id;

COMMIT;
