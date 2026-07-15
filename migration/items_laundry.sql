-- Laundry v1 (2026-07-15): the derived hamper.
--
-- last_washed: date the item was last laundered. NULL = not tracked yet — the
--   item reads as CLEAN (tracking is opt-in by behavior: an item joins the
--   system the first time it's stamped washed, or overridden to the hamper).
-- laundry_state: one-time override, text:
--   'hamper'    — forces dirty until the next wash stamp (coffee-spill case).
--   'extra:<n>' — "one more wear": n = the item's distinct wear-day count at
--                 the moment it was set; the grace is spent automatically once
--                 a newer wear lands (count > n). No wear-path bookkeeping.
--   Every wash stamp clears it.
--
-- Run in the Supabase SQL editor BEFORE the laundry UI is used (the app hides
-- laundry write-UI until it sees these columns on loaded items). Idempotent.

alter table items add column if not exists last_washed date;
alter table items add column if not exists laundry_state text;
