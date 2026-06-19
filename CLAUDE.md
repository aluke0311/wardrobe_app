# CLAUDE.md — Wardrobe App

Guidance for working in this repo. Read alongside `README.md`.

## What this is

A personal, single-user wardrobe tracker. **The entire app is one file:
`index.html`** (HTML + CSS + JS inline). No build step, no framework, no
bundler, no JS libraries, no CDN scripts. It talks to Supabase using the **REST
API and Storage API via plain `fetch`** — do **not** add supabase-js or any
library. If something seems to need a library, ask the user first.

## Hard constraints (do not break)

- Keep it a single `index.html`. No external JS/CSS assets, no `<script src>`.
- Plain `fetch` only for all Supabase calls.
- Mobile-first; the user mostly uses this on a phone and takes photos with it.
- Only the publishable (anon) key ever appears in client code — it's safe to
  ship because RLS scopes everything to the signed-in user. The **secret key
  must never** be added or committed.

## Architecture (inside `index.html`)

Top-of-`<script>` config, then logically grouped sections:

- **CONFIG** — `SUPABASE_URL`, `SUPABASE_KEY`, `BUCKET`, `APP_VERSION`, the
  category→subcategory `TAXONOMY`, `COLOR_FAMILIES`, `OCCASION_LADDER`,
  `CONTEXTS`, image/encode constants. (Note: the old flat `CATEGORIES` / `PALETTE`
  constants are being replaced — see "Data model" and "Design model" below.)
- **SESSION** — `store` is a safe wrapper that probes `localStorage` once and
  falls back to an in-memory Map if storage is blocked (e.g. `data:` URLs).
  Always go through `store` / `saveSession` / `loadSession`, never raw
  `localStorage`.
- **FETCH HELPERS**
  - `authRequest(grant, body)` → Supabase Auth token endpoint (sign in / refresh).
  - `api(path, opts)` → core authed fetch; adds `apikey` + `Authorization`
    bearer; **transparently refreshes the token once on 401**, then retries.
  - `rest(path, opts)` → PostgREST wrapper over `api`, returns parsed JSON.
  - `uploadPhoto` / `deletePhoto` / `signedUrl` → Storage; photos are private so
    display uses **signed URLs** (cached in `_urlCache`).
- **IMAGE COMPRESSION** — `compressImage(file)`: canvas downscale to 1200px max
  edge, encode WebP at q0.82, fall back to JPEG if the browser can't encode WebP.
- **STATE + DERIVED** — `items`, `wears` arrays loaded once via `loadData()`;
  helpers `wearCount`, `lastWorn`, `costPerWear`, `daysSince`, `money`, `esc`.
- **RENDER** — `renderCloset`, `openItem` (detail sheet), add-item form,
  log-wear, `renderStats`. Lists are built as HTML strings; **always `esc()`
  user-supplied values** when interpolating into HTML.
- **TABS + WIRING** — `switchTab`, `refreshViews`, `wireEvents`, `init()` (IIFE
  at the bottom that boots the app).

## Data model

The schema was **redesigned and migrated 2026-06-17/18** (476 items imported from
Airtable). The canonical definition is **`schema.sql`** in the repo root — read it
first. Five tables, all RLS-scoped to `auth.uid()` (client never sends `user_id`):

- `items`: id, user_id, name, **category**, **subcategory**, brand, **retailer**,
  **color_family** (single, not an array), price, purchase_date, **date_is_guess**,
  **acquisition** (New|Secondhand|Gift), **size**, **fabric** (text[]),
  **season** (text[]), **min_occasion**/**max_occasion** (smallint 1–7),
  **status** (Available|Storage|Archive — replaces the old `archived` bool),
  tags (text[]), url, order_no, receipt_url, official_name, notes, image_path,
  created_at.
- `wears`: id, user_id, item_id, **outfit_id** (nullable), worn_on (date — any
  past date allowed, so historical back-fill is normal), **context** (text),
  created_at. One row per item per day worn.
- `outfits`: id, user_id, name, context, notes, image_path, created_at.
  Join table `outfit_items(outfit_id, item_id, user_id)`.
- `capsules`: id, user_id, name, kind (capsule|packing|travel), start_date,
  end_date, notes, created_at. Join table `capsule_items(capsule_id, item_id,
  user_id)`. Named sets you build (e.g. "Spain trip"); travel = a capsule.
- Photos: private `wardrobe` bucket, path `<user_id>/<uuid>.<ext>` (webp/jpg/png).
  RLS keys off the first path segment matching `auth.uid()`. Display = signed URLs.

**Breaking change vs. the old app:** `archived`→`status`, `colors[]`→`color_family`,
wears `occasion`→`context`, plus many new columns. `index.html` was rewritten for
this schema in **Phase 3a** (2026-06-18) and now matches the live DB; later phases
(capsules, outfits, calendar, stats rebuild) are still pending.

## Design model (occasion, contexts, capsules)

Worked out with the user; encode these as CONFIG constants in `index.html`.

**Formality ladder (1–7)** — a `min_occasion`/`max_occasion` *range* on each item:
1 At-home · 2 Relaxed · 3 Casual · 4 Smart casual · 5 Professional · 6 Cocktail · 7 Formal.
(Imported Airtable values were on an old 1–6 scale and were shifted +1; only ~34
active items have ranges set — the user fills the rest in over time.)

**Contexts** — a named occasion stamped on each *wear/outfit* (not on items). Each
context has a default formality range and may carry a hard rule. An item is
eligible for a context when their formality ranges overlap. The 13 contexts:
Lounge/garden (1) · WFH (1–2) · Errands (2–3) · Friends/rehearsal (3) ·
Campus (4–5, 2×/wk) · Conference/job talk (5) · Date night (3–6) · Symphony (4–6) ·
Church service (4–6) · Shower/holiday party (6) · Funeral (6, *rule: darker tones*) ·
Wedding guest (6–7) · Gala/chorus concert (7, *rule: chorus concert = all black*).
**Gym** = its own category (off-ladder). **Travel** = a capsule (not a formality).

**Outfits vs capsules:** capsule/packing = a named set of items with an
"active-capsule" lens (filter the closet to just those items to build the day's
outfit). Outfit = items worn together; adding an outfit to a capsule pulls its
items in. Logging an outfit creates a wear row per item.

**Taxonomy** (category → subcategories) — see `migration/import.py` `TAXONOMY`:
- Tops: Tee shirts, Graphic tees, Long-sleeve tees, Sleeveless, Blouses, Sweaters, Cardigans, Sweatshirts
- Bottoms: Jeans, Pants, Shorts, Skirts, Leggings/Joggers, Tights
- Dresses: Casual dresses, Work dresses, Cocktail dresses
- Outerwear: Blazers, Jackets, Coats
- Shoes: Boots, Sandals, Flats, Heels, Sneakers
- Workout: Workout tops, Active shorts, Sports bras

**Color families** (single per item): Green, Teal, Blue, Purple, Maroon, Pink,
Red, Orange, Yellow, Beige, Brown, White, Gray, Black, Metallic.

## Migration (done — one-time)

`migration/` holds the throwaway importer (NOT shipped, libraries/installs OK there):
- `schema.sql` (repo root) — run in the Supabase SQL editor first. Done ✓.
- `migration/import.py` — stdlib + macOS `sips`; reads Airtable, maps fields,
  re-hosts photos to Storage, bulk-inserts. `python3 import.py` = dry run,
  `--live` = real. Already run live ✓ (476 items, 0 photo failures).
- `migration/import_wears.py` — stdlib; back-fills **historical wears** from the
  Airtable **Dates** table (one record per day, links the Clothing worn). A wear
  = (item, day). Run live ✓ 2026-06-18: **3,995 wears** imported, 2015-12-15 →
  2026-06-11. Items carry no Airtable id, so it re-links each Clothing record to
  its Supabase item by **normalized name** (strips the `ARCHIVE ` prefix), with
  status (prefer non-Archive, since dated wears only come from the active table) /
  purchase_date / price / brand as tiebreakers. `context` left null (Airtable
  `Occasion` was empty). Future-dated rows (planned outfits) skipped; user_id
  borrowed from existing items. Dry run writes `wears_review.json` (gitignored).
- `migration/import_outfits.py` — stdlib + `sips`; imports **outfits** from the
  Airtable **Outfits** table (a set of Clothing Items worn together on a Date).
  Run live ✓ 2026-06-18: **1,543 outfits + 4,182 outfit_items**, and back-links
  **3,993 wears.outfit_id** by (item, day). `created_at` = the outfit's date (the
  schema has no date column; the date lives on the linked wears). 7 contexts +
  6 outfit photos re-hosted; same name→item matcher as the wears import. Dry run
  writes `outfits_review.json`. **Gotcha baked in:** Supabase caps a single REST
  response at 1000 rows, so the wear back-link fetch **must page** (`sb_page`) —
  an unpaged fetch silently links only ~1/4. Reusable: re-running needs `--force`
  (guards on a non-empty outfits table).
- **Airtable wear model (confirmed with the user):** the **Dates** table is the
  full wear log; **Outfits** only regroup items already in Dates on the same day
  (every outfit day exists in Dates; ~all outfit item-slots map to a Dates wear).
  So wear counts come from Dates alone; outfits add the "worn together" grouping.
- `migration/.env` (gitignored) holds the Supabase **service-role key** + Airtable
  token — local use only, never commit. `.env.example` is the committed template.
- Airtable base "CLOTHING BASE CURRENT" (`appK4hX9DJYTGFGYb`) is the source of truth.
- **Review later:** `migration/review.json` lists ~46 items whose dress-length
  subcategory ("Short"/"Long") was dropped + 1 category-less item — retag in-app.

## Build roadmap / current status

**The forward plan now lives in `ROADMAP.md`, which is written as an execution-ready
spec** (executor handbook + file map + per-slice decisions, schema, and migration
SQL) — start there. Key decisions locked 2026-06-18: **personal single-user tool**,
**heuristics only — no AI/server-proxy/Edge Functions**, **thumbnail outfits (no
collage canvas)**, **derive-first/capture-light** data philosophy. The legacy
`3d/3e/3f` items below are folded into ROADMAP's Phases B/C/D; this section keeps the
*done* history.

**Phase A (closet usability) is nearly complete (through v8):** A1 hierarchical
closet + density, nav→6 tabs (Add-in-Closet, merged **Log** tab, new **Fill** tab),
the random-item Fill page, sortable grids, multi-select + batch actions, upkeep
fields (availability/care/needs-repair), and one-tap wear ratings. **Only slice 8
(optional fit/storage/acquisition fields) remains.** Live DB has gained columns
since the baseline — see ROADMAP §2 (items: availability/care/needs_*; wears:
rating/compliments/note). Migrations are run by the user in the Supabase SQL editor;
**never deploy UI that writes a new column before its migration is confirmed.**

- **Phase 1 — schema** ✓ run in Supabase.
- **Phase 2 — import** ✓ 476 items + photos live; ARCHIVE-prefix names cleaned.
- **Phase 3 — rewrite `index.html` for the new schema** (3a/3b/3c DONE). Build in
  verifiable slices, keeping the app fully working each step:
  - 3a Core ✓ (2026-06-18): all new fields + subcategory picker (dependent on
    category), `status` (Available/Storage/Archive) filter + search + category
    filter replacing the archived toggle, single `color_family`, occasion range
    + `CONTEXTS` (with item↔context overlap "Works for"), **item editing**,
    **photo replace**, **back-dated wear logging** (Log Wear date picker allows
    past; context select). Closet photos lazy-load via IntersectionObserver.
    Stats adapted to the new fields but its full rebuild is 3e. NOT yet verified
    against live data by the user / not yet deployed.
  - 3b Capsules ✓ (2026-06-18): a **Capsules** tab (nav is now 7 tabs) — browse
    capsule cards (name, kind pill, item count, date range, item-photo thumbnails),
    capsule detail (tap an item to open it), and a **builder** (name, kind segmented
    `capsule`/`packing`/`travel`, start/end dates, notes, searchable multi-select
    item picker — pulls from any non-Archive item). The **active-capsule lens**:
    "Use as closet lens" filters the Closet to just that capsule's items, shows a
    dark lens banner with a Clear button, suppresses the status filter (capsule set
    shown whole, all statuses), and **persists** via `store` (key `wardrobe.lens`,
    re-applied on boot by `restoreLens`, which lazy-loads capsules if needed).
    `CAPSULE_KINDS`/`kindLabel`/`dateRangeLabel` are the new constants/helpers.
    Verified end-to-end against live data (create→lens→clear→delete). Not yet
    deployed; user hasn't reviewed in the live app.
  - 3c Outfits ✓ (2026-06-18): a 6th **Outfits** tab — browse (date + item-photo
    thumbnails, "Show more" paging over ~1.5k), outfit detail (tap an item to open
    it), **log-an-outfit-as-a-wear** (back-datable; one wear per item per day,
    tagged with `outfit_id`), and a **builder** to create/edit outfits (searchable
    multi-select item picker, context, date; "Save & log as worn"). Outfits +
    outfit_items load lazily on first tab open. **Verified against live data.**
    Note: added `restAll()` paging — `loadData` now pages `wears` (was capped at
    1000, so the app had been undercounting; CPW/stats were silently wrong).
  - 3d Calendar.
  - 3e Stats — rebuild around the user's Airtable CPW / score / alert formulas
    (still TODO: read those formulas from the Airtable "Clothing" table fields like
    Goal CPW, Total Score, Action Needed and reproduce the logic).
  - 3f Outfit dedup + rewear (agreed 2026-06-18, NOT STARTED). The import made
    **one outfit row per wear-day**, so the 1,543 outfits include many duplicates
    (same item set, different days). Goal: an outfit is a *reusable* set that can
    have **many wears** (the schema already supports this — `wears.outfit_id` is
    many-to-one; nothing ties an outfit to a single date except the `created_at`
    we set at import). Pieces:
    1. **Merge identical outfits** — collapse outfits whose item set is identical
       into one; repoint their wears' `outfit_id`; delete the now-empty dupes.
       (Order-independent compare of `outfit_items`. Likely a `migration/` script
       + an in-app "merge duplicates" action.) After merge, `created_at` ≈ first
       worn; surface wear count + last-worn per outfit.
    2. **Rewear** — "Log as worn" already creates a new dated wear on an existing
       outfit; with merge this is the primary path (one outfit, growing wear list).
    3. **Builder shows matching prior outfits** — as the user selects items in the
       builder, surface existing outfits that match (subset/superset/exact) so they
       can pick one to rewear instead of creating a duplicate.
- **Backlog of agreed ideas** (not yet scheduled): one-tap re-wear, closet
  utilization % (worn this month), declutter assistant (never-worn + high CPW +
  old), laundry/available-now status, wishlist (pre-purchase, projected CPW),
  export/backup JSON, color/category gap analysis. "What I wear by context"
  analysis falls out once wears carry contexts.

## Conventions

- **`APP_VERSION`** is shown in the UI as-is (no "v" prefix in markup). Format
  **`YYYY-MM-DD vN`**: on a new day use today's date + `v1`; for additional pushes
  the same day, increment `vN` (`v2`, `v3`, …) so same-day deploys differ.
  Currently `2026-06-19 v2`.
- Match the surrounding code's comment density; comment non-obvious logic only.
- Fixed product choices (taxonomy, color families, occasion ladder, contexts) live
  as top-of-script constants (`TAXONOMY`, `COLOR_FAMILIES`, `OCCASION_LADDER`,
  `CONTEXTS`) — change them there. Keep them in sync with `migration/import.py`.

## Known gotchas / lessons

- **`localStorage` in restricted contexts**: opening the file from a `data:` URL
  (some preview surfaces) throws "Storage is disabled". The `store` wrapper
  handles this — never touch `localStorage` directly. On GitHub Pages (real
  `https://`) it works normally and the session persists.
- **WebP encode support**: `canvas.toBlob(..., 'image/webp')` silently returns a
  PNG on browsers that can't encode WebP, so `compressImage` checks
  `blob.type === 'image/webp'` and falls back to JPEG. Keep that check.
- **Private photos need signed URLs** — you can't use a public bucket URL.
- GitHub Pages caches aggressively; hard-refresh after deploy.

## Deploy

Commit `index.html` → push to `origin/main` → Pages deploys in ~1–2 min. See the
`deploy-wardrobe` skill. Repo: aluke0311/wardrobe_app. Live:
https://aluke0311.github.io/wardrobe_app/

## Local preview

`.claude/launch.json` runs `python3 -m http.server 4173` for the Claude preview
panel. Note: auth/data only fully work against the real `https://` deploy or any
non-`data:` origin; the in-memory session fallback applies otherwise.
