-- r9: Weather support for Trips.
-- Adds a per-capsule locations JSONB array for weather lookup.
-- Each element: {"name": "Paris, France", "lat": 48.86, "lon": 2.35, "from": "2024-08-01", "to": "2024-08-05"}
-- from/to are null if the location covers the whole trip.
-- Run in the Supabase SQL editor BEFORE deploying the weather UI.

ALTER TABLE capsules
  ADD COLUMN IF NOT EXISTS locations JSONB NOT NULL DEFAULT '[]';
