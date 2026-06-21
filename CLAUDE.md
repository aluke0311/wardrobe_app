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

**Current state: r4 / 2026-06-21. Full rework from v25. ~1,160 lines.**
The old v25 (5,788 lines, all features) is preserved at git tag `v25-full` and
`archive/index_v25_full.html`. Do not use v25 as a reference for current UI code;
use only what's in `index.html` now.

Top-of-`<script>` config, then logically grouped sections:

- **CONFIG** — `SUPABASE_URL`, `SUPABASE_KEY`, `BUCKET`, `APP_VERSION`, the
  category→subcategory `TAXONOMY`, `COLOR_FAMILIES`, `OCCASION_LADDER`,
  `CONTEXTS`, image/encode constants.
- **SESSION** — `store` is a safe wrapper that probes `localStorage` once and
  falls back to an in-memory Map if storage is blocked (e.g. `data:` URLs).
  Always go through `store` / `saveSession` / `loadSession`, never raw
  `localStorage`.
- **FETCH HELPERS**
  - `authRequest(grant, body)` → Supabase Auth token endpoint (sign in / refresh).
  - `api(path, opts)` → core authed fetch; adds `apikey` + `Authorization`
    bearer; **transparently refreshes the token once on 401**, then retries.
  - `rest(path, opts)` → PostgREST wrapper over `api`, returns parsed JSON.
  - `uploadPhoto` / `deletePhoto` / `signedUrl` / `signedUrlBatch` → Storage;
    photos are private so display uses **signed URLs** (cached in `_urlCache`).
  - `prewarmUrlCache()` — batch-signs all item photo URLs after `loadData()`,
    fire-and-forget so the IntersectionObserver finds them cached on scroll.
- **IMAGE COMPRESSION** — `compressImage(file)`: canvas downscale to 1200px max
  edge, encode WebP at q0.82, fall back to JPEG if the browser can't encode WebP.
- **STATE + DERIVED** — `items`, `wears` arrays loaded once via `loadData()`;
  helpers `wearCount`, `lastWorn`, `costPerWear`, `daysSince`, `money`, `esc`.
- **HOME LAUNCHER** — `renderHome()`: Stylebook-style calm tile grid (5 tiles).
  Boots here; asks nothing of the user on open.
- **CLOSET** — `renderCloset()` / `openItem()` / `changeStatus()`. Status-lens
  switcher scopes the category folder list. See "Closet model" below.
- **SEARCH** — `openSearch()` / `renderSearch()` / `runSearch()`. Keyword +
  6 filter rows (Color/Fabric/Size/Season/Brand/Status), each expanding to chips.
- **TABS + WIRING** — `switchTab(name)`, `wireEvents()`, `init()` IIFE at bottom.
  Currently active tabs: home · closet · looks (stub) · calendar (stub) ·
  capsules (stub) · stats (stub). Search and Add live as non-tab screens
  (`#tab-search`, `#tab-add`) navigated to by `switchTab`.

## Closet model

**Status is a cross-cutting lens, not a category.** A tee is always a Top;
`closetLens` (Available/Storage/Archive/All) scopes which items appear in the
category folder list. Status changes happen on the item detail (move bar), not
by moving items between folders.

- `closetLens` — current lens, default "Available"
- `closetCat` — null = root | category name | "Other"
- `closetSub` — null = subcategory list | subcategory name | "__other__" | "__all__"
- `searchResults` — null = normal browsing | array = search-result grid
- `detailId` — item id in detail view (null = none)

`closetBack()` pops the stack: detail → grid → subcategory list → category list
→ root. `lensItems()` returns `items` filtered by `closetLens`.

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

## Migration (initial run done; full reset planned)

**Planned full data reset:** once the app is feature-complete, the user will
update Airtable with new schema fields, replace photos, wipe Supabase, and
re-import. Full plan in `migration/RESET_PLAN.md`. Current data is pilot/provisional.

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

## Build history & current status

**2026-06-20 session: full UI rework.** The user felt overwhelmed by v25's
accumulated complexity and wanted to reset to a Stylebook-inspired calm UI.
The Supabase engine (auth, fetch, data loading, image compression, signed URLs)
was carried over verbatim; the UI was rebuilt from scratch, screen by screen.

**v25-full** (git tag + `archive/index_v25_full.html`) preserves everything built
through Phase G. The data, schema, and migration are all intact and untouched.

**Current state: r5 / 2026-06-21.** Built across two sessions:
- **r1 — Home launcher:** Stylebook-style calm tile grid (5 tiles: Closet · Looks ·
  Calendar · Capsules · Style Stats). Bottom nav (5 tabs), login, boot path.
  App boots to Home. Settings via ⚙ gear; Add Item via ＋ on Home header.
  All non-Home tabs are honest stubs, built screen-by-screen.
- **r2 — Closet + Search + item detail:**
  - Status lens switcher (Available/Storage/Archive/All) at top of Closet root.
    Status is a *lens*, not a category — items always live in their real category.
  - Category folder list → subcategory list → item grid (Stylebook in-place drill).
  - Item detail: hero photo, 6 attributes (color swatch, size, price, retailer,
    season, acquisition), KPI row (wears / last worn / cost-per-wear), status
    move bar (Available · Storage · Archive) with optimistic Supabase PATCH.
  - Search screen: keyword + Color/Fabric/Size/Season/Brand/Status filter rows
    that expand to chip multi-selects. Results show as a grid in Closet.
  - ＋ header button on Home → Add Item stub (built next).
- **r3 — Grid toolbar (density + select + bulk actions):**
  - Fixed action bar above the tab bar, visible only when a `.grid` is on screen.
  - Grid density picker: 2/3/4/5 per row, persisted to `wardrobe.gridCols` in
    `localStorage`. Updates grid via CSS `--grid-cols` variable without re-render.
  - Select mode: tap Select → circle checkboxes on tiles; tile taps toggle
    selection; `toggleSelect()` does surgical DOM update (no full re-render).
  - Bulk edit sheet: Color/Fabric/Size/Season/Brand/Status chip pickers;
    only changed fields are PATCHed (`/items?id=in.(...)` PostgREST syntax).
  - Delete selected: confirm → REST DELETE.
  - Move-to-folder sheet: category tree → PATCH `category` + `subcategory`.
  - "+" in grid toolbar header → Add Item stub.
  - Global `[hidden] { display: none !important }` rule to prevent CSS
    specificity from overriding the HTML `hidden` attribute.
- **r4 — Select mode fixes + "All Items in [cat]":**
  - Action icons now only appear when select mode is active (not faded/invisible
    before), turning accent-blue when items are selected; live count shown inline.
  - "All Items in [cat]" on the subcategory list is now a tappable blue row
    (`data-sub="__all__"`) that opens a flat grid of the whole category.
- **r5 — Item detail redesign (two-view, full editing):**
  - **Photo view** (`openItem`): full-height garment photo + item-nav (< subcategory |
    Closet | shuffle + Add to Look). Tab bar hidden; 4-icon action bar at very
    bottom (`#itemBar`, z-index 25): Edit (→details), Folder (→move sheet),
    Calendar (→log wear), Trash (→delete). Class `detail-photo` on `#app` hides
    the tabbar via CSS; `openItem()` adds it, `renderCloset()` / `closetBack()` /
    `switchTab()` all remove it.
  - **Details view** (`openItemDetails`): `detailView = "details"`. `closetBack()`
    checks `detailView === "details"` first → returns to photo; then if `detailId`
    → `renderCloset()`. Full scrollable section: header (thumbnail + name/brand),
    notes textarea (auto-saves 900ms debounce), stats (outfits + wears/last worn),
    0 Extra Images stub, attributes card (Color/Fabric/Size/Season/Brand/Status),
    pricing card (Price + $/Wear computed), URL, Category. Sticky footer:
    "Edit Image" / "Replace Image".
  - **Field edit sheet** (`#fieldSheet`): single-field editing. `FIELD_CONFIGS`
    const at top of detail section maps field key → `{label, type, opts?}`. Types:
    `"color"` (circle swatches), `"multi"` (chip multi-select), `"single"` (chip
    single-select), `"text"` / `"price"` (input). `saveField(id, field, value)`
    does optimistic PATCH + re-renders details on success.
  - **Action helpers**: `deleteItem(id)` (confirm → DELETE + renderCloset),
    `openItemMoveSheet(id)` (sets `_moveItemId`, reuses existing move sheet;
    `closeMoveSheet()` clears `_moveItemId`; `applyMove` returns to photo view
    when `_moveItemId` set), `openLogWear(id)` (date picker → POST `/wears`).
  - **New helpers**: `outfitCount(itemId)` counts distinct outfit_ids in wears.

**▶ NEXT UP (item detail, then screens):**
1. **Item detail polish** — notes layout (textarea separate from thumbnail header;
   show item name + brand in header), Fabric/Size/Brand edit: filter-as-you-type
   text input + "PREVIOUSLY ENTERED" list from existing `items` values; Fabric
   stays `text[]` multi-select. Add date purchased, time in closet to details.
   Wear frequency display TBD (may belong in Style Stats).
2. **Add Item** — photo from camera/library, name, category/subcategory, key fields.
3. **Looks (Outfits)** — outfit grid, outfit detail.
4. **Calendar** — month grid, day detail.
5. **Capsules** — named item sets.
6. **Style Stats** — wear counts, cost-per-wear, coverage.

Migrations are run by the user in the Supabase SQL editor; **never deploy UI
that writes a new column/table before its migration is confirmed.**

## Conventions

- **`APP_VERSION`** is shown in the UI as-is. Format **`YYYY-MM-DD rN`** for the
  rework series (r = rework): on a new day use today's date + `r1`; for additional
  pushes the same day, increment `rN`. Currently `2026-06-21 r5`.
- Match the surrounding code's comment density; comment non-obvious logic only.
- Fixed product choices (taxonomy, color families, occasion ladder, contexts) live
  as top-of-script constants (`TAXONOMY`, `COLOR_FAMILIES`, `OCCASION_LADDER`,
  `CONTEXTS`) — change them there. Keep them in sync with `migration/import.py`.
- All item photos use **`background-size: contain`** everywhere. Never use
  `cover`/`fill` for garment photos — the user explicitly wants `contain`.

## Known gotchas / lessons

- **`localStorage` in restricted contexts**: opening the file from a `data:` URL
  throws "Storage is disabled". The `store` wrapper handles this — never touch
  `localStorage` directly.
- **WebP encode support**: `canvas.toBlob(..., 'image/webp')` silently returns a
  PNG on browsers that can't encode WebP, so `compressImage` checks
  `blob.type === 'image/webp'` and falls back to JPEG. Keep that check.
- **Private photos need signed URLs** — you can't use a public bucket URL.
- **Batch-sign photo URLs on load** — `POST /storage/v1/object/sign/{bucket}` with
  body `{ paths: string[], expiresIn: number }` returns `[{ path, signedURL, error }]`;
  full URL = `` `${SUPABASE_URL}/storage/v1${row.signedURL}` ``. Call
  `prewarmUrlCache()` after `loadData()` fire-and-forget so it doesn't block render.
- **`loadPhotoNode` sets `backgroundColor = "transparent"`** on URL resolve — lets
  white/transparent garment PNGs show cleanly on the tile background.
- **GitHub Pages caches hard** — hard-refresh (`Cmd+Shift+R`) after deploy.
- **Status is a lens, not a category** — a tee is always under Tops. `closetLens`
  (Available/Storage/Archive/All) scopes the category folder list. Status changes
  happen on the item detail (move bar with optimistic PATCH), nowhere else.
- **`closetBack()` pops the navigation stack** — now 3-level for item detail:
  `detailView === "details"` → `openItem()` (photo view); `detailId` set →
  `renderCloset()` (grid); then `searchResults` → `closetSub` → `closetCat` → root.
- **`closetSub` special values**: `"__other__"` = items with no recognized subcategory;
  `"__all__"` = all items in the category (added r4). Handle both in `categoryGrid()`.
- **`[hidden]` vs CSS specificity**: a CSS rule with `display: flex` on an ID selector
  beats the browser's built-in `[hidden] { display: none }`. Always include
  `[hidden] { display: none !important }` in the global styles.
- **Grid bar is `position: fixed`** above the tab bar (`bottom: calc(var(--nav-h) + var(--safe-b))`).
  When visible, add class `has-gridbar` to `#app` so `.tabbody` gets extra bottom
  padding (else the bottom of the grid is hidden behind the bar).
- **Select mode DOM surgery**: `toggleSelect(id)` updates just the affected tile
  and calls `updateGridBar()` directly — no full `renderCloset()` re-render — to
  avoid photo-URL flicker. Bulk edit / delete / move DO call `renderCloset()` after.
- **Bulk PATCH via PostgREST**: `PATCH /items?id=in.("id1","id2")` with a JSON body
  updates all matching rows. IDs must be quoted strings inside the `in.()` list.
- **`store.getItem` / `store.setItem`** (not `store.get/set`) — the `store` wrapper
  mirrors the `localStorage` API exactly.
- **Item photo view hides the tab bar** via `#app.detail-photo .tabbar { display:none }`.
  `#itemBar` (z-index 25, `bottom:0`) replaces it. Add `detail-photo` in `openItem()`;
  remove it in `renderCloset()`, `closetBack()` (from photo), and `switchTab()`.
- **`_moveItemId`** — set by `openItemMoveSheet(id)` before opening the shared move
  sheet. `applyMove()` checks it to decide whether to `openItem()` or `renderCloset()`
  after success. `closeMoveSheet()` always clears it.
- **`FIELD_CONFIGS`** const maps field key → `{label, type, opts?}`. Always add new
  editable fields here before wiring them in `openItemDetails`. Currently: color_family,
  fabric, size, season, brand, status, price, url, retailer, acquisition.
- **Currently `APP_VERSION`** is `2026-06-21 r5`.

## Deploy

Commit `index.html` → push to `origin/main` → Pages deploys in ~1–2 min. See the
`deploy-wardrobe` skill. Repo: aluke0311/wardrobe_app. Live:
https://aluke0311.github.io/wardrobe_app/

## Local preview

`.claude/launch.json` runs `python3 -m http.server 4173` for the Claude preview
panel. Note: auth/data only fully work against the real `https://` deploy or any
non-`data:` origin; the in-memory session fallback applies otherwise.
