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

**Current state: v7 / 2026-06-20. All phases through B + partial C/F done + UI polish session.**
Migrations are run by the user in the Supabase SQL editor; **never deploy UI that
writes a new column/table before its migration is confirmed.**

**What's done (condensed):**
- **Phase 1–2:** schema ✓ (schema.sql), import ✓ (476 items + photos + 3,995 wears + 1,543 outfits).
- **Phase 3a–3d core:** new schema, capsules+lens, outfits+builder, calendar (all ✓).
- **Phase A complete:** hierarchical closet, 7 tabs, Fill page, sortable grids, multi-select+batch, upkeep fields, wear ratings, fit/storage/price_original fields.
- **Phase B complete:** B1 Calendar (month grid, events, day-detail) + B1 refinement (wears grouped by outfit_id, inline notes) · B2 Capsule polish (packing checklist, outfit→capsule) · B3 Wishlist status + purchase-justification card · B4 Rotation/"Neglected" mode.
- **Phase C (Insights) partially complete:** KPI cards (item count, closet value, CPW, utilization) · drill-downs with time-range filter + Best/Worst toggle (CPW, Most Worn, Velocity, Never Worn, Best Purchases, Recency) · View Closet By donut charts (color/brand/size/season/fabric/price) · Occasion Coverage · **category filter chip row**. All Available-only scope. CPW $0 rule applied. *Airtable Goal CPW / Total Score formulas still pending — ask user for those formulas before implementing.*
- **Phase F partial:** F2 fill upgrades (Available-only pool, random field, shuffled order) · F5 item detail enrichment (outfit mosaic 2×2 collage, "Wear it with" pairings, "Create outfit" button, days-in-wardrobe KPI) · F8 type-ahead for brand/retailer/size.
- **UI polish (2026-06-20 session, v1–v7):** all item photos → `contain` (fit, never cover) everywhere · item detail: back button on hero, combined last-worn/KPI row, tap-to-edit attribute rows (shared `readFillPatch` / `wireFillWidgets`) · calendar compacted (`.cal-wrap` max-width `min(340px,86vw)`, `aspect-ratio:1/0.66`) · status filter → `<select>` dropdown · log screen overlap fixed · "Got compliments" removed · calendar "Log a wear for this day" now presets date correctly · calendar day-detail: ✕ per item (deletes one wear row) + "Remove outfit" button (bulk-deletes all wears for that outfit_id+date) · **"Worn" outfit log** — `wornOutfitMap()` derives accurate outfit history from wears (group by `outfit_id+worn_on`, collapse by exact item-set key), preserving same-day multi-outfit.
- **Still pending:** D1–D4 (outfit suggestions, weather, capsule auto-gen, outfit dedup/merge) · E (Home dashboard) · F1/F3/F4/F6/F7/F9.

**Outfit dedup note (D4, NOT started):** the import created one outfit row per
wear-day, so the ~1,543 outfits include many duplicates (same item set, different
days). The "Worn" view already solves *display* by deriving from wears; a future
merge script + in-app "merge duplicates" action would clean the `outfits` table itself — see ROADMAP §D4.

## Conventions

- **`APP_VERSION`** is shown in the UI as-is (no "v" prefix in markup). Format
  **`YYYY-MM-DD vN`**: on a new day use today's date + `v1`; for additional pushes
  the same day, increment `vN` (`v2`, `v3`, …) so same-day deploys differ.
  Currently `2026-06-20 v7`.
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
- **`outfitItemMap` is outfit_id → [item_id], not item_id → [outfit_id].** To find
  all outfits an item appears in, iterate the map: `for (const [oid, ids] of outfitItemMap) { if (ids.includes(itemId)) … }`. Don't assume the reverse index exists.
- **`outfits` is loaded lazily** — guard any outfit-dependent code (outfit mosaic,
  pairings, etc.) with `if (outfitsLoaded)`. Use `ensureOutfits()` before
  `startOutfitBuilder` when triggering from a context that may not have outfits loaded yet.
- **Named functions vs aliases:** if a function is renamed, grep for all call sites —
  e.g. `openOutfitDetail` was called in Insights but the real function was `openOutfit`
  (silently undefined until fixed in v10).
- **All item photos use `background-size: contain` everywhere** — tile thumbnails, folder thumbs, pick-grid, list rows, outfit mosaic cells, calendar day thumbs, and the hero on item detail. Never use `cover`/`fill` for item photos; the user explicitly wants `contain` throughout.
- **`wornOutfitMap()` derives "Worn" outfit log** — groups wears by `outfit_id+worn_on`, then collapses by sorted item-set key. Lone wears (no `outfit_id`) each get a unique key. This preserves same-day multi-outfit. ✕-ing one item from a day shifts that day to a different item-set bucket; "Remove outfit" deletes all wears for that `outfit_id` on that date.
- **`logPresetDate` is consumed once** — set it directly (`logPresetDate = dateStr`) then call `switchTab("log")`; do NOT call `setLogMode()` before `switchTab` or the preset gets consumed twice and the date field shows today.

## Deploy

Commit `index.html` → push to `origin/main` → Pages deploys in ~1–2 min. See the
`deploy-wardrobe` skill. Repo: aluke0311/wardrobe_app. Live:
https://aluke0311.github.io/wardrobe_app/

## Local preview

`.claude/launch.json` runs `python3 -m http.server 4173` for the Claude preview
panel. Note: auth/data only fully work against the real `https://` deploy or any
non-`data:` origin; the in-memory session fallback applies otherwise.
