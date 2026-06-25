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

**Current state: 2026-06-22 r18. Full rework from v25. ~6,160 lines.**
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
- **CLOSET** — `renderCloset()` / `openItem()` / `openItemDetails()`. Status-lens
  switcher scopes the category folder list. See "Closet model" below.
- **ITEM DETAIL** — two-view: `openItem()` (photo view) → `openItemDetails()` (edit
  view). Field edit sheet (`#fieldSheet`) driven by `FIELD_CONFIGS` + `openFieldEdit()`.
  `_fieldEditItem` holds the item being edited; `_fieldOnSave` is null for DB saves
  or a callback fn when editing the Add form.
- **ADD ITEM** — `renderAdd()` / `_renderAddBody()` / `saveNewItem()`. State in
  `_addState` (plain object); `_addPhotoBlob` + `_addPhotoUrl` track the pending
  photo. Field edits use `openAddFieldEdit(field)` which sets `_fieldOnSave` to write
  into `_addState` and call `updateAddFieldDisplay(field)`. Category picked via
  `openAddCatSheet()` which reuses `#moveSheet` (guarded by `_addCatMode` flag).
- **SEARCH** — `openSearch()` / `renderSearch()` / `runSearch()`. Keyword +
  6 filter rows (Color/Fabric/Size/Season/Brand/Status), each expanding to chips.
- **LOOKS** — `renderLooks()` / `openLook()` / `openLookFormalityEdit()` /
  `showNudgePiecesSheet()`. Lens switcher (Formality/Season/Recent/All); derived
  organization (no manual filing). Nav state: `looksLens`/`looksFolder`/`lookId`.
  Outfit collages via `outfitCollageHtml()`. Formality derived from piece heuristics
  (`outfitBucket`), overridable via `formality_override` on the outfit row.
- **BUILD-A-LOOK** (r12) — Stylebook canvas on `#tab-builder`. `openBuilder(outfitId?, seedItemId?)`
  → `renderBuilder()` dispatches canvas (`renderBuilderCanvas`/`wireBuilderCanvas`, pointer
  drag+resize) vs. the +Clothing picker (`renderBuilderPicker`, closet-by-category-folder).
  State in `builder` ({outfitId,name,pieces:[{item_id,x,y,s}],selIdx,picking,pickCat,pickQ}).
  `saveBuilder()` writes `outfits.layout` (JSONB) + diffs `outfit_items`. Saved looks render
  the arrangement in the `openLook` hero (`.lk-canvas`). **Migration `migration/outfit_layout.sql`.**
- **CAPSULES** (r7) — `renderCapsules()` dispatches by `capsuleView`
  (list/detail/form/pick). Two modes: **Capsule** (`kind:"capsule"`, undated) and
  **Trip** (`kind:"packing"`, dates + packing checklist). `loadData()` loads
  `capsules` + `capsule_items`; `buildCapsuleIndexes()` builds `capsuleById` /
  `capsuleLinkMap`. Detail shows a derive-first insight strip (count · value ·
  formality coverage · ≈outfit combos), a packing progress bar (Trip), the item grid,
  and **"Plan outfits from this"** which sets `activeCapsuleId` (scopes the Closet via
  `lensItems()` + a clear-able banner). Add items two ways: in-capsule picker
  (`openCapsulePicker`, membership editor) + closet Select-mode "Add to capsule"
  (`gbCapsule` → `openCapsuleSheet`). Nav state: `capsuleId`/`capsuleView`/
  `activeCapsuleId`; items opened from a capsule set `_fromCapsule` (closetBack returns).
  **r9 — Trip weather:** Trips with dates get a Locations section (`openLocationSheet`,
  Open-Meteo geocode + per-location date ranges stored in `capsules.locations` JSONB) and
  a horizontal weather strip (`loadTripWeather`/`buildTripWeather`/`fetchWeatherRange`):
  real forecast (today→+15d), ERA5 archive (past), or 3-yr historical average (far future,
  labeled "avg"). `_wxCache` 10-min TTL. **Migration: `migration/capsule_weather.sql`.**
  **r10 — capsule QoL:** detail item grid is grouped into category sections with counts
  (`capGroupsHtml` + `groupByCategory`/`groupByFormality`; canonical `CAP_CAT_ORDER`),
  a "By category / By formality" sort toggle (`_capSort`), and for Trips per-category
  "N/M packed" headers + an "Unpacked only" filter (`_capUnpackedOnly`). The picker has
  category jump-chips with counts (`pickerCatBar`, `_capPickCat`) + category-grouped results.
- **TABS + WIRING** — `switchTab(name)`, `wireEvents()`, `init()` IIFE at bottom.
  Currently active tabs: home · closet · looks · calendar · stats.
  Capsules is a Home-tile screen (full tab; not in the bottom nav — Stats took its slot).
  Search and Add live as non-tab screens
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
  **season** (text[]), **min_occasion**/**max_occasion** (smallint 1–5),
  **status** (Available|Storage|Archive — replaces the old `archived` bool),
  tags (text[]), url, order_no, receipt_url, official_name, notes, image_path,
  created_at.
- `wears`: id, user_id, item_id, **outfit_id** (nullable), worn_on (date — any
  past date allowed, so historical back-fill is normal), **context** (text),
  created_at. One row per item per day worn.
- `outfits`: id, user_id, name, context, notes, image_path, **formality_override**
  (text — one of the 5 bucket keys, nullable), **layout** (JSONB array of
  `{item_id,x,y,s}` — the Build-a-look canvas arrangement, r12, `migration/outfit_layout.sql`),
  created_at. Join table `outfit_items(outfit_id, item_id, user_id)`.
- `capsules`: id, user_id, name, kind (capsule|packing|travel), start_date,
  end_date, notes, **locations** (JSONB array of `{name,lat,lon,from,to}` for Trip
  weather — r9), created_at. Join table `capsule_items(capsule_id, item_id, user_id,
  **packed** bool — r7)`. Named sets you build (e.g. "Spain trip"); travel = a capsule.
- Photos: private `wardrobe` bucket, path `<user_id>/<uuid>.<ext>` (webp/jpg/png).
  RLS keys off the first path segment matching `auth.uid()`. Display = signed URLs.

**Breaking change vs. the old app:** `archived`→`status`, `colors[]`→`color_family`,
wears `occasion`→`context`, plus many new columns. `index.html` was rewritten for
this schema in **Phase 3a** (2026-06-18) and now matches the live DB; later phases
(capsules, outfits, calendar, stats rebuild) are still pending.

## Design model (occasion, contexts, capsules)

Worked out with the user; encode these as CONFIG constants in `index.html`.

**Formality ladder (1–5)** — a `min_occasion`/`max_occasion` *range* on each item.
The 5 levels match the outfit bucket names exactly:
1 Lounge · 2 Casual · 3 Smart · 4 Dressy · 5 Formal.
(Migrated from an old 1–7 scale; ~34 items have ranges set, the user fills the rest
over time. DB constraint: `smallint CHECK BETWEEN 1 AND 5`.)

**Contexts** — a named occasion stamped on each *wear/outfit* (not on items). Each
context has a default formality range and may carry a hard rule. An item is
eligible for a context when their formality ranges overlap. The 13 contexts (in new
1–5 scale): Lounge/garden (1) · WFH (1) · Errands (1–2) · Friends/rehearsal (2) ·
Campus (3, 2×/wk) · Conference/job talk (3) · Date night (2–4) · Symphony (3–4) ·
Church service (3–4) · Shower/holiday party (4) · Funeral (4, *rule: darker tones*) ·
Wedding guest (4–5) · Gala/chorus concert (5, *rule: chorus concert = all black*).
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

**Current state: r11 / 2026-06-21.** Built across two sessions:
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
- **r6 — Item detail polish + Add Item:**
  - **Details view header**: thumbnail (lazy-loaded) + name / brand / category path.
    No more textarea embedded in the header card.
  - **Notes**: standalone `<textarea class="det-notes-ta">` below the stats card.
    Auto-saves with 900ms debounce via direct REST PATCH (skips `openItemDetails`
    re-render so typing isn't interrupted).
  - **Purchase date + time in closet**: shown in Pricing card as "Purchased Jun 2023
    · 3y in closet". Respects `date_is_guess` flag (shows "Jun 2023" vs exact date).
    Display-only for now (edit not wired).
  - **Acquisition field** added to Attributes card.
  - **Brand typeahead** (`type: "typeahead"` in FIELD_CONFIGS): text input + scrollable
    "Previously entered" chip list pulled from `distinctScalar("brand")`. Typing
    filters the list in-DOM (no re-render). Clicking a chip fills the input.
  - **Fabric filter**: `filter: true` on the fabric FIELD_CONFIGS entry adds a filter
    input above the chip list. Typing hides non-matching chips in-DOM.
  - **Field sheet dual-mode**: `_fieldEditItem` holds the item being edited (real item
    or `_addState`). `_fieldOnSave` is null → saves to DB; function → custom callback
    (used by Add form). `closeFieldSheet()` clears both.
  - **Add Item screen** (`renderAdd` / `_renderAddBody`): large 3:4 photo placeholder
    with "Photo" button (file input, `accept="image/*"`, no forced camera capture —
    iOS shows Camera/Library picker). Name (required) + Category/subcategory picker
    (reuses `#moveSheet` with `_addCatMode` flag). DETAILS card: Color, Size, Brand,
    Season, Status. PRICING card: Price, Acquired. NOTES textarea. Save → POST
    `/items` (return=representation to get ID), optional photo upload + PATCH, adds
    to local `items[]`, navigates to new item's photo view.
- **r7 — Looks tab (outfit library, direction "C" lens switcher):**
  - Loads `outfits` + `outfit_items` in `loadData`; `buildOutfitIndexes()` builds
    `itemById` / `outfitById` / `outfitItemMap` / `outfitWearMap` + assigns stable
    `_num` (oldest = #1, shown as "Look #N").
  - Lens switcher (`looksLens`): **Formality · Season · Recent · All**. Formality /
    Season show folder list → outfit grid → detail; Recent/All go straight to a flat
    grid (capped at `LOOKS_FLAT_CAP`=400 for perf).
  - All organization derived (imported outfits = date + items only). Formality from
    per-item heuristic averaged → `outfitBucket()`; season from wear dates.
  - Collage = member photos stacked by `LAYER_ORDER` (outerwear→tops→bottoms→shoes);
    2-col CSS grid; `solo` / `span2` classes for 1- and 3-piece looks.
  - Detail (`openLook`): collage hero, Wear stats, Formality+Season (Classification
    card), Piece Formality card (each piece tappable → `openOccasionEdit`), Notes
    auto-save, "Wear this look" / "Delete" footer.
  - `openWearLook(id)`: logs one wear row per piece with `outfit_id`.
  - `deleteLook(id)`: DELETE /outfits — wears preserved (FK is ON DELETE SET NULL).
- **r8 — Grid collages + per-piece formality correction:**
  - Collage layout changed from vertical flex-column to 2-col CSS grid.
  - `openOccasionEdit(itemId, onSaved)`: reuses `#logSheet`; tap-lo-then-hi for
    range selection; third tap resets. PATCHes `/items?id=eq.{id}`. Clears all
    `o._bucket` caches so looks re-derive after a change.
  - Added Occasion row to item details Attributes card (`[data-occ-item]`).
  - Required DB migration: `ALTER TABLE outfits ADD COLUMN formality_override text;`
- **r9 — Whole-look formality override + nudge pieces:**
  - `outfitBucket()` now checks `o.formality_override` before deriving from pieces.
  - Formality row in look detail is a tappable `<button>` → `openLookFormalityEdit()`.
  - `openLookFormalityEdit(id)`: 6-bucket picker in `#logSheet`; PATCHes
    `formality_override` on the outfit; "(set)" badge shows when override is active;
    "Remove override" restores auto-derive.
  - `showNudgePiecesSheet(outfitId, bucketKey)`: follow-up sheet listing each
    non-Workout piece, pre-checking those that don't match the bucket's range.
    Apply bulk-PATCHes `min/max_occasion` on checked items via PostgREST `in.(...)`.
  - `BUCKET_RANGES` const maps bucket key → `{min, max}` for nudge targets.
- **r10 — Collapse formality to 5 levels matching outfit buckets:**
  - `OCCASION_LADDER` changed from 7 labels to 5: Lounge/Casual/Smart/Dressy/Formal.
  - `SUBCAT_FORMALITY` and `CAT_FORMALITY` remapped to 1–5 scale.
  - `outfitBucket()` binning simplified to direct array index lookup.
  - `BUCKET_RANGES` targets updated to single-level values (1–5).
  - Required DB migration: drop old `CHECK 1–7` constraints, remap ~34 existing
    item values, add new `CHECK 1–5` constraints.
- **r11 — Calendar tab:**
  - Month grid: 7-col calendar grid with mini outfit collages per day, today
    highlighted (accent circle on date number), `#f4f4f7` background for today's
    cell. Prev/next month navigation. Leading/trailing blank cells for alignment.
  - Day view: outfit groups for the selected date (items grouped by `outfit_id`;
    null outfit_id = solo per-item). Each group shows an 88×88 collage + "Tap to
    add notes" (notes stored on `outfits.notes` via PATCH). Swipe-left reveals
    Copy/Move/Delete actions; Delete removes wear rows and rebuilds `outfitWearMap`.
    Copy/Move are stubbed (toast "Coming soon"). Prev/next day navigation.
  - Stats strip below the month grid: "Most Worn This Month" (item with most wears
    in the month, shown with photo + count) + "X Day Streak" (consecutive days with
    any wear logged, counting back from today).
  - State: `calendarYear`, `calendarMonth` (0-based), `calendarDay` (null = month
    view, "YYYY-MM-DD" = day view). `renderCalendar()` dispatches between views.
  - Helpers: `wearDayMap()`, `dayGroups(dateStr)`, `calCellCollageHtml()`,
    `calOutfitCollageHtml()`, `calMostWorn()`, `calStreak()`, `wireCalSwipe()`,
    `openCalNotes()`. No new DB migrations needed.

- **r12–r16 — Style Stats tab (fully built):**
  - **Nav:** Stats is now in the bottom tab bar (replaced Capsules stub). Capsules still
    accessible via Home tile.
  - **Main page:** CLOSET section (item count + total value KPI pair, color bar → Color
    breakdown), Browse by field rows (Color/Category/Brand/Retailer/Price/Size/Season/Fabric/
    Acquisition), WEAR INSIGHTS (Never Worn / Not Worn 12+ Mo / Most Worn / Cost-per-Wear /
    Best Potential Improvement / Recently Acquired), LOOKS section (outfit count + avg items/look).
  - **Field breakdown pages:** donut SVG (pure math, no library; hex colors for Color, palette
    for others). Arrows cycle segments — highlights matching list row + scrolls it into view.
    Sort by Count / Sort by Name buttons at bottom (except canonical-order fields like Price,
    Season, Category). State: `statsDonutIdx`, `statsFieldSort` ("count"|"name").
  - **Smart list grids:** `buildSmartList(key)` → never-worn, not-worn-1yr, most-worn,
    least-worn, best-cpw, worst-cpw, best-potential, recent. `TOGGLE_GROUPS` maps paired lists
    (most-worn↔least-worn, best-cpw↔worst-cpw); grid shows a Best/Worst or Most/Least toggle
    bar when a togglable list is active. Tiles show subtitles: wear count (most/least-worn),
    $/wear (CPW lists), CPW improvement (best-potential), purchase month (recently acquired).
    `gridHtml(list, subtitleFn)` accepts optional subtitle fn; renders `.gtile-sub`.
  - **Item detail from stats:** `openItemFromStats()` switches to closet tab; `_fromStats` in
    `closetBack()` returns to the stats grid. Back stack: detail → grid → field breakdown → main.
  - **State:** `statsView` ("main"|"field"|"grid"), `statsField`, `statsGridItems`,
    `statsGridTitle`, `statsFromField`, `statsListKey`, `statsDonutIdx`, `statsFieldSort`,
    `statsFilters` ({status:[], category:[], season:[], formality:[]}), `statsDateRange`
    ("all"|"7d"|"14d"|"30d"|"90d"|"6mo"|"1yr"), `statsAcqRange` ("all"|"w1yr"|"w2yr"|"w3yr"|
    "w5yr"|"o1yr"|"o2yr"|"o3yr"|"o5yr"), `statsSubtitleFn`.
  - Price field uses `PRICE_BRACKETS` for bucketed grouping. Season/Fabric count items
    once per value (an item may appear in multiple groups).

- **r17 — Stats polish + bugs fixed (2026-06-22):**
  - **Filter sheet:** filters moved to a bottom sheet opened by funnel icon (top-right of
    every stats toolbar). Badge shows active filter count. Sheet has Reset + Done + backdrop.
    Replaced the inline filter bar that appeared on every page.
  - **`wireStatsFilters()` removed**; replaced by `openStatsFilters()` (builds/wires sheet),
    `wireStatsToolbar()` (wires back + filter button after each render), `statsRebuild()`
    (extracted from the old rebuild closure — handles grid state transitions + re-renders).
  - **Date range ("worn within")** only shown in filter sheet when relevant: main page or
    wear-count grids (never-worn, most-worn, least-worn). Hidden for CPW, field pages, etc.
  - **Acquired range filter:** "Acquired within" (w1yr/w2yr/w3yr/w5yr) and "Acquired more
    than … ago" (o1yr/o2yr/o3yr/o5yr). `acqRangeStart()` returns `{cutoff, older}`.
    `statsPool()` respects both directions via `purchase_date`.
  - **Retailer field:** added to `getFieldGroups`, `STATS_FIELD_LABELS`, and main page rows.
  - **Recently Acquired:** renamed from "Recently Added"; uses `purchase_date` (not
    `created_at`); 6-month window; sorted by purchase_date descending; purchase month on tile.
  - **Dynamic labels:** "Never Worn" row → "Not worn · past X" when date range active.
    "Most Worn" row subtitle → "Most & Least · past X" when range active.
  - **Tile subtitles:** most/least-worn show "N wears"; CPW lists show "$/wear" value.
  - **Nudge pieces sheet:** now has a tap-lo/hi formality picker (default = bucket range)
    so user adjusts the target range before applying rather than accepting the bucket default.
  - **Bug fixes:** `[data-sv]` click handler on field page now uses `:not([data-sf])` to
    avoid filter chips triggering grid navigation; donut highlight selector same fix;
    `&amp;` double-encoding fixed in row subtitle strings.

- **r1–r5 — Stats Stylebook refinement + Closet Review (2026-06-22):**
  - **Titles match Stylebook:** main page is three card-sections — **Clothing Stats**
    (KPIs + color bar + insight rows), **Looks Stats**, **View Closet By…** (field rows
    only — *no donut on main*, the rotating-viz idea was explicitly rejected; the donut
    lives only on each field sub-page). CSS: `.stats-sec` / `.stats-sec-hdr` / `.stats-sec-body`.
  - **Dedicated Range button** (`#stRange`, `statsToolbar(title, showBack, showRange)`):
    own bottom sheet (`#statsRangeSheet`, `openStatsRange()`, `RANGE_OPTIONS`) with All
    time → Last Year + checkmark. Shown only on main + wear-count grids (`RANGE_LISTS` =
    never-worn/most-worn/least-worn/best-cpw/worst-cpw). **Removed from the funnel sheet.**
    Button label shows the active range. **Range resets to "all" on every navigation**
    (tab entry, entering any sub-page via `data-sa`, `statsNavBack`); it persists only
    while on a page (e.g. Most↔Least toggle keeps it).
  - **CPW is now range-aware** (`buildSmartList` best/worst-cpw use `wearCountInRange`),
    so the Range button on Cost per Wear actually changes results.
  - **Purchase Price** = new toggle grid (`least-expensive`/`most-expensive` in
    `buildSmartList` + `TOGGLE_GROUPS`), price on each card. Price *also* stays a donut
    under View Closet By.
  - **Number-only metric tiles:** `gridHtml(list, subtitleFn, {metricOnly})` renders the
    metric centered with no item name (`.gtile-metric`). `METRIC_LISTS` = worn/cpw/price.
    Toggle moved to a floating segmented pill (`.stats-toggle-float` / `.stats-seg`).
  - **Row changes:** "Never Worn" → **"Not Logged on Calendar"** (range-aware); dropped
    "Not Worn in 12+ Months" (subset); **Recently Acquired** no longer gated to 6 months
    (shows most-recent-first, top 100 — the gate was hiding everything).
  - **Looks Stats → Most Worn Looks** (`statsView="outfits"`, `renderStatsOutfitsPage`,
    `openLookFromStats`): outfit grid sorted by `outfitWornCount`, tap → opens the look
    in the Looks tab.
  - **Closet Review** (`statsView` `"review"`/`"review-deal"`): periwinkle CTA at the
    bottom of stats main (`.review-cta`). Landing lists each field with a gap count;
    picking one **deals items one card at a time** to fill in (`.rv-card`, `renderReviewDeal`,
    `startReview`/`reviewAfterEdit`/`reviewSkip`). `REVIEW_FIELDS` config (each: `missing`,
    `value`, `edit`) covers Category, Subcategory, Color, Size, Brand, Fabric, Season,
    Retailer, Acquisition, Price, **Occasion** (empty min/max = the algorithm-guessed
    formality the user wants to confirm), Purchase Date (**empty only** — `date_is_guess`
    is *not* a review trigger). Deal card buttons: **Set** (primary, opens field editor),
    **Skip** (advance to next item), **Edit Item** (opens full item detail view in photo mode;
    `_reviewMode = true` so back button returns to the review card). Editors reuse the field sheet
    (`openReviewField` sets `_fieldOnSave` to save+advance), `openOccasionEdit(id, reviewAfterEdit)`,
    the move sheet (`openReviewMove` + `_reviewMoveMode`, returns to deal via `applyMove`'s success branch),
    and a minimal date input (`openReviewDateEdit`). Scans all non-archived items (ignores
    the stats funnel filters).

- **r7 — Capsules & Trips (2026-06-22):** full Capsules tab (was a placeholder). Two
  modes — **Capsule** (undated style set) and **Trip** (`kind:"packing"`, start/end dates
  + packing checklist). List → detail → add-items picker / create form. Detail insight
  strip (count · value · formality-coverage chips · ≈outfit combos), packing progress bar
  (Trip), **"Plan outfits from this"** → `activeCapsuleId` scopes the Closet (`lensItems()`
  override + clear-able `cap-banner`). Add items two ways: in-capsule membership picker
  (`openCapsulePicker` → `saveCapsulePicker` diffs add/remove) and closet Select-mode
  `gbCapsule` → `openCapsuleSheet` (reuses `#moveSheet`). Items opened from a capsule set
  `_fromCapsule` so `closetBack()` returns to the capsule. **Gotcha caught & fixed:** the
  packing tick was a `<button>` nested inside the `.gtile` `<button>` — invalid HTML, so the
  parser re-parents it as a sibling and `.gtile .pack-tick` never matches; it must be a
  `<div>` (like `.sel-dot`). **Migration required for the checklist:**
  `migration/capsule_items_packed.sql` (`ALTER TABLE capsule_items ADD COLUMN packed boolean
  NOT NULL DEFAULT false`). Load + insert deliberately omit `packed` so everything works
  pre-migration; only the tick needs the column. **Do not deploy r7 before running it.**

- **r9 — Trip weather + locations (2026-06-22):** Trips with start+end dates get a
  **Locations** section. `openLocationSheet` (reuses `#logSheet`, 2-step search→range) calls
  **Open-Meteo geocoding** (no key) to find a city, then stores `{name,lat,lon,from,to}` in a
  new `capsules.locations` JSONB column (`from/to` null = whole trip; set = multi-city legs).
  A horizontal **weather strip** (`loadTripWeather` → `buildTripWeather` → `fetchWeatherRange`)
  shows one card per trip day: **forecast API** (today−92d→today+15d), **ERA5 archive** for older
  past dates, and a **3-year historical average** (labeled "avg", gray card) for dates beyond the
  forecast window. Multi-location trips group consecutive days per location and show a "→ City"
  separator. `_wxCache` keyed by capsule id, 10-min TTL; invalidated on add/remove location.
  All Open-Meteo (`api.open-meteo.com`, `archive-api.open-meteo.com`, `geocoding-api.open-meteo.com`).
  **Migration: `migration/capsule_weather.sql`** (`ADD COLUMN locations JSONB NOT NULL DEFAULT '[]'`).
- **r10 — Capsule QoL (sorting / grouping / packing / picker filters):** the detail item grid
  is now **grouped into sections** (`capGroupsHtml`). `groupByCategory` orders by `CAP_CAT_ORDER`
  (Outerwear, Tops, Dresses, Bottoms, Shoes, Workout, then Other), items sorted formality-then-name;
  `groupByFormality` buckets by the 5 ladder levels. A **"By category / By formality" toggle**
  (`_capSort`) sits above the grid. Each section header shows a **count**; for Trips it shows
  **"N/M packed"** per category (`refreshPackGroupCounts` keeps it live on tick) plus an
  **"Unpacked only"** filter chip (`_capUnpackedOnly` — checking a piece off removes it from
  that view without a full re-render). The **picker** gained category **jump-chips with counts**
  (`pickerCatBar`, `_capPickCat`) and category-grouped results (`pickerGridHtml`); the results
  container is `#capPickResults`, re-rendered light by `renderPickerGrid` so the search box keeps
  focus. Tapping any capsule/picker item still opens its full detail (`data-cap-item`).

- **r11 — Build-a-look v1 (multi-select), REMOVED in r12.** The first pass added a `gbLook`
  closet-select button + a capsule-style "Edit pieces" picker. The user didn't like it; r12
  replaced it wholesale with the Stylebook canvas. Don't reintroduce the `gbLook` button or
  the `lookPickId` picker — they're gone.
- **r12 — Build-a-look canvas (Stylebook-style, 2026-06-22):** a free-form outfit builder on
  its own screen (`#tab-builder` / `#builderBody`, a non-nav screen like Add/Search; bottom
  nav hidden via `#app.builder-mode`). **Reverses the old "no canvas" product decision** —
  the user explicitly asked for it.
  - **Entry points:** Looks toolbar **+** (`#looksNew` → `openBuilder()`); item detail
    **"Add to Look"** (`openBuilder(null, itemId)` seeds that piece); look detail **"Edit in
    canvas"** in the PIECE FORMALITY header (`openBuilder(lookId)` loads the saved layout).
  - **Canvas (`renderBuilderCanvas` + `wireBuilderCanvas`):** pieces are absolutely-positioned
    `.bpiece` divs (`background:contain`); **pointer events** (touch+mouse) drag to move and a
    corner handle (`.bp-handle`) to resize; tap selects; a selection bar does Send back / Bring
    front (array reorder = z-order) / Remove. Move/resize/select mutate the DOM directly (no
    re-render → no photo flicker); layer/delete/add re-render.
  - **+ Clothing picker** (`renderBuilderPicker`): closet **by category folder** (Tops, Bottoms,
    …, canonical `catRank` order) → item grid, plus a search box (flat results). Tapping an item
    drops it on the canvas (`addPieceToBuilder`, dedupes). `renderBuilderPickerResults()` is the
    light search re-render (keeps focus); category taps full-render to update the toolbar.
  - **State:** `builder = { outfitId, name, pieces:[{item_id,x,y,s}], selIdx, picking, pickCat,
    pickQ }`. `x`/`y` = piece **center** fraction (0..1); `s` = width fraction of canvas width;
    **array order = z-order**. `defaultPlacement(k)` staggers new drops. `clamp01` helper.
  - **Save (`saveBuilder`):** new → `POST /outfits {name, layout}` + `/outfit_items`; edit →
    `PATCH` layout/name + diff `outfit_items` (POST/DELETE). Then `buildOutfitIndexes()` and
    opens the look. Requires ≥1 piece.
  - **Saved looks render the arrangement everywhere (r13):** `layoutCanvasHtml(o, wrapCls)` is
    the shared renderer (positioned `.ocpiece` divs from `o.layout`, `null` if no usable layout).
    Used by `openLook` hero (`.lk-canvas`), `outfitCollageHtml` (looks grid tiles `.ocanvas` +
    folder reps `.ocanvas.omini`), and the calendar (`calCellCollageHtml`/`calOutfitCollageHtml`
    now take an optional `outfit` arg → `.cal-ccanvas` / `.cal-outfit-canvas`). All fall back to
    the old grid collage when `layout` is empty (legacy looks).
  - **Migration REQUIRED before deploy:** `migration/outfit_layout.sql`
    (`ALTER TABLE outfits ADD COLUMN layout JSONB NOT NULL DEFAULT '[]'`). Until it's run,
    saving a look 500s. The user said "ship" on r12 (after being told to run it first), so it
    should be applied — if saves 500, this migration is the first thing to check.

- **r14 — Item photo replace/add/remove (2026-06-22):** the item-detail footer's
  "Edit Image"/"Replace Image" stubs are replaced with a working set. `pickItemPhoto(id)`
  spawns a transient `<input type=file accept=image/*>`; `replaceItemPhoto(id, file)` runs the
  same pipeline as Add (`compressImage` → `uploadPhoto` → PATCH `image_path` → delete the old
  photo, fire-and-forget → `signedUrlBatch` the new path → re-render details). `removeItemPhoto`
  nulls `image_path` + deletes the file. Footer is now state-aware: photo → "Replace Photo" +
  "Remove Photo"; no photo → "Add Photo". The vague "Edit Image" (crop/rotate) stub was dropped
  — full-photo replace covers the practical need; a crop editor is out of scope.

- **r15 — Calendar: log from day view (2026-06-22):** the day-view footer's "+ Clothing" /
  "+ Look" stubs now work. **+ Clothing** (`openCalAddClothing` → `renderCalClothingPicker`) is a
  multi-select closet picker reusing the shared picker machinery (`_capPick`, `pickerPool`/
  `pickerGridHtml`/`pickerCatBar`/`togglePick`, count via the shared `#capPickCount` id) rendered
  into `#calendarBody`; Done → `saveCalClothingLog()` POSTs one solo wear row per item
  (`{item_id, worn_on: calendarDay}`, no `outfit_id`). **+ Look** (`openCalAddLook` →
  `renderCalLookPicker`/`calLookListHtml`) is a searchable recent-looks grid (cap 150); tapping a
  look → `logLookOnDay()` POSTs one wear per piece with that `outfit_id`. Both rebuild
  `outfitWearMap` and re-render the day. The picker uses `body.onclick` delegation; `renderCalendarDay`
  now clears it (`body.onclick = null`) on return. State: `_calLookQ`. **No DB migration.**

- **r16 — Capsule rename + duplicate (2026-06-22):** capsule detail footer gains **Rename**
  (`renameCapsule`, reuses `#logSheet` → optimistic PATCH `capsules.name`) and **Duplicate**
  (`duplicateCapsule`, POSTs a `"<name> (copy)"` shell copying kind/dates/notes/locations, then
  `addItemsToCapsule` for the members — packing resets since inserts omit `packed`; opens the
  copy). Footer is now Rename · Duplicate (`.cap-actions`) above Delete. **No DB migration.**

- **r17 — Active-capsule lens in Looks (2026-06-22):** while a capsule is active (set by
  "Plan outfits from this"), the Looks tab now also scopes to **looks wearable entirely from
  that capsule** (every piece is a member). `looksScopedOutfits()` wraps `displayOutfits()`
  with the capsule filter; `lensOutfitsSorted`/`folderRowsHtml`/`folderOutfits`/`openRandomLook`
  use it (stats/calendar/home keep the unscoped `displayOutfits()`). A `cap-banner`
  ("Wearable from · {name}", `looksCapsuleBanner`) shows on every Looks screen with a ✕
  (`[data-cap-clear]` in the looksBody handler → clears `activeCapsuleId`). Note: `switchTab`
  does **not** clear `activeCapsuleId` (so the scope spans Closet + Looks); only the banner ✕
  or deleting the capsule clears it. **No DB migration.**

- **r18 — Share a capsule/packing list (2026-06-22):** capsule detail actions gain **Share
  list** (`shareCapsuleList` → `capsuleListText`). Builds a plain-text checklist grouped by
  category in canonical order (`groupByCategory`), with `[x]`/`[ ]` boxes for Trips (packed
  state) or `•` bullets for Capsules, plus a name + date-range header. Uses `navigator.share`
  when available (mobile), else async `clipboard.writeText`, else a `document.execCommand("copy")`
  textarea fallback. `AbortError` (user dismissed the share sheet) is swallowed silently.
  **No DB migration.**

**▶ NEXT UP — 2026-06-23 big cleanup + feature round.**
Full design locked in **`STYLE_MODEL.md`** (read it first). Refresh spec in
**`migration/RESET_PLAN.md`** (fully rewritten). Execute phases in order; each is
self-contained and its dependencies are noted.

---

### Phase 2 — Schema + config foundation (GATES Phase 4)

**What:** Replace the stale half-migrated formality system with the clean 1–6 model.

1. Rewrite **`schema.sql`** to the clean target:
   - Add `items.formality smallint check (between 1 and 6)` (replaces `min_occasion`/`max_occasion`).
   - Add `wears.formality_for smallint` (nullable 1–6 — the "demand" capture).
   - Add `outfits.rating smallint` (nullable — reserved for future 👍/👎 feedback loop).
   - Add `exclusions` table: `(id uuid pk, user_id uuid, item_a uuid ref items, item_b uuid ref items, reason text, created_at)`. Normalize `item_a < item_b`. RLS own_rows policy.
   - Drop dead v25 columns from `items`: `min_occasion`, `max_occasion`, `availability`, `care`, `needs_repair`, `needs_tailoring`, `storage_location`, `fit`, `length`, `rise`, `price_original`.
   - Drop `events` table (rework calendar uses `wears`, not `events`).
   - Keep all other tables + columns untouched.

2. Write a **migration SQL file** (`migration/formality_schema.sql`) for the LIVE DB — idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` style. User runs it in the Supabase SQL editor before the Phase 4 UI ships. Until then the live DB still has `min_occasion`/`max_occasion`.

3. Update **config constants** in `index.html`:
   - `OCCASION_LADDER` (index.html:868): change from 5 labels to 6: `["Function", "Very Casual", "Everyday Casual", "Smart Casual", "Dressed Up", "Formal"]`.
   - `FORMALITY_BUCKETS` (index.html:2381): remove the stale "1–7 ladder" comments; fix the orphaned `workout` bucket (Workout is now formality 1, not off-ladder); align to 6 levels.
   - `BUCKET_RANGES` (index.html:2391): update to 1–6.
   - `SUBCAT_FORMALITY` (index.html:2401): remap all values to 1–6 scale (currently maps to 1–4 with stale "1–7" comments). Heels → 4, Blazers → 4, Cocktail dresses → 5, etc.
   - `CAT_FORMALITY` (index.html:2410): update to 1–6.

4. **Item-detail formality editor** — swap the min/max two-field range picker for a single-level picker (6 chips: Function/Very Casual/Everyday Casual/Smart Casual/Dressed Up/Formal). Update `FIELD_CONFIGS` to add `formality` as type `single` with these 6 opts. Remove `min_occasion`/`max_occasion` from the attributes card (or show both old + new during the transition until migration is run).

5. **Closet Review** — update the "guessed formality" card to use `formality` (the new single field) instead of empty `min_occasion`/`max_occasion`. The seed guess still comes from `SUBCAT_FORMALITY`/`CAT_FORMALITY`.

6. **`outfitBucket(o)`** — rewrite to derive from `item.formality` (single value) instead of averaging `min/max_occasion` ranges. Simpler binning.

**Gate:** user must run `migration/formality_schema.sql` before shipping any UI that reads/writes `formality`. Until then, keep the existing `min_occasion`/`max_occasion` reads for any live UI that still needs them.

---

### Phase 3 — Quick wins (formality-independent, ship any time)

Each item below is standalone — no dependency on Phase 2 or each other.

**3a — Build-a-look picker: subcategory drill + scoped search**
- File: `builderPickContent()` (index.html:5528), `renderBuilderPicker()` (index.html:5506).
- Currently: category → item grid; search queries the whole closet ignoring `pickCat`.
- Change: add subcategory drill between category and item grid (same pattern as closet: cat → subcat list → item grid). Add optional subcategory filter chips along the top of the item grid when a category is selected (like `pickerCatBar` in capsules). Scope search to the current `pickCat`/`pickSub` when set — only search globally when no category is selected.
- State needed: add `pickSub` to the `builder` object (null = subcategory list, string = filter).

**3b — Calendar copy/move wears**
- Current stub at index.html:3528 — the "Coming soon" toast on the swipe-action buttons.
- **Copy:** duplicate the wear row(s) to a different date (date picker → `POST /wears`). For outfit groups, copy all items with the same `outfit_id`.
- **Move:** copy to new date + delete original rows. Confirm before deleting.
- Wire into the existing swipe-action buttons (already rendered, just toasting).

**3c — Season derive-and-confirm**
- A Closet Review field card for `season` that seeds a guess from the item's `purchase_date` month (summer months → Summer, etc.) or from historical wear months. One-tap confirm or override.
- Fits naturally into the existing `REVIEW_FIELDS` / `renderReviewDeal` pattern.

---

### Phase 4 — Outfit suggestions + closet-vs-life gap (needs Phase 2)

**4a — `suggestOutfits(targetLevel?, context?)` engine**
- Input: optional target formality level (1–6) and/or context string.
- Slot-filling: one Top (or Dress), one Bottom (skip if Dress), one Shoes, optional Outerwear. Candidates filtered by `item.formality` in-band (±1 of target).
- Scoring per combo (all derived, no AI):
  1. **Formality cohesion** — adjacent levels OK; 2 apart = penalty; ≥3 = reject. (Essay's law.)
  2. **Color compatibility** — historical co-occurrence (`outfitItemMap` + `outfitWearMap`) = "worn together before" boost. Plus simple neutral rules: Black/White/Gray/Beige pair with anything; loud colors penalize combos with other loud colors.
  3. **Season/weather** — `season` overlap + Open-Meteo temp (already wired for trips; reuse `_wxCache`).
  4. **Rotation** — boost items not worn in 30+ days (`daysSince`).
  5. **Exclusions** — hard filter: reject any combo where both `item_a` and `item_b` are present in the `exclusions` table. Surface the `reason` on the rejection.
  6. **Context hard rules** — if context string matches known rules (funeral → dark colors; chorus concert → black only), filter accordingly.
- Output: top N combos (N=5 or so), each as a list of item IDs.

**4b — Entry points**
- `#itemShuffle` (index.html:1561) — the "suggest outfit" button already on the item detail (currently toasts "coming soon"). Wire to `suggestOutfits(null, null)` seeded with the current item already placed. Opens results in Build-a-look canvas.
- Looks tab **+** new look button — offer "Build manually" or "Suggest for me" (opens the suggestion sheet).
- Optional: Home tile "Get dressed" / "What to wear" CTA.

**4c — Suggestion UI**
- A bottom sheet showing the top suggestion as a canvas preview (reuse `layoutCanvasHtml`), with prev/next arrows to cycle through the N results.
- "Wear this" → logs the look (same as `openWearLook`).
- "Open in builder" → opens in Build-a-look canvas for tweaking.
- "These two don't go" → opens a mini form: pick the two offending items from the outfit + type/select a reason → `POST /exclusions`. Normalizes item_a < item_b.
- Optional level picker and context typeahead at the top of the sheet to filter by.

**4d — Context typeahead**
- On the suggestion sheet, wear-logging, and look detail: a text input + single-select of `distinctScalar("context")` over the `wears` and `outfits` tables (same pattern as `brand` typeahead). Pre-fills formality default when a known context is selected. Never required.
- Wire `wears.context` capture into the calendar "+ Look" / "+ Clothing" log flow.

**4e — One-tap demand capture (formality_for)**
- On the calendar day-view after logging a wear, offer a one-tap "How dressed up was this day?" (6-chip row: the OCCASION_LADDER labels). Writes `wears.formality_for`. Optional — if dismissed, just skip.

**4f — Closet-vs-life gap (Stats tab)**
- v1 (free, works on historical wears): compare closet supply distribution (count items by `formality`) vs. wear demand distribution (count wears by the `formality` of worn outfits via `outfitBucket`). Bar chart or simple percentage bars. → "Your closet is 40% Smart Casual but you mostly wear Everyday Casual."
- Lives in Stats tab, new section "Closet vs. Your Life" or similar.
- v2 (later, as `formality_for` data accumulates): use the actual demand-captured `wears.formality_for` instead of the derived outfit bucket.

---

### Phase 5 — Audit + docs (last — reflects final state)

**5a — Bug + improvement audit**
- Full read-through of `index.html`; fix small bugs inline; surface anything larger.
- Known items to check: the stale FORMALITY_BUCKETS "1–7 ladder" comments (cleaned in Phase 2); any `[data-sv]:not([data-sf])` selector gaps; builder canvas touch-action on older iOS.

**5b — Rewrite CLAUDE.md**
- Archive the r1–r18 build log to `archive/CLAUDE_build_history.md`.
- Keep a tight current-state CLAUDE.md: architecture, data model, conventions, current `APP_VERSION`, known gotchas — no per-release history.

**5c — ROADMAP update**
- The old `ROADMAP.md` describes the v25 app; it's obsolete. Replace with a short living doc covering: what's shipped in the rework, the Phase 2–5 plan above (mark each ✓ as completed), and the back-burner items (wear-logging G-series, crop editor, reorder capsules).

**5d — User guide / manual**
- A `USER_GUIDE.md` (or in-app Help screen) covering every surface: Closet (lenses, status, categories), Looks (formality, builder), Capsules (capsule vs. trip, weather, active-capsule lens), Calendar (logging, copy/move), Stats (gap analysis, Closet Review), Suggestions (how they work, exclusions).

---

### Back-burner (not in this round)
- Reorder capsules (needs an `order` column)
- Auto-refresh trip weather
- Wear-logging loop overhaul (G1 multi-select fast logger, G3 Home CTA, G2 long-press grid log)
- Crop/rotate photo editor
- Explicit outfit feedback (👍/👎 — `outfits.rating` column added in Phase 2 but UI deferred)
- Outfit of the day on Home connected to weather

Migrations are run by the user in the Supabase SQL editor; **never deploy UI
that writes a new column/table before its migration is confirmed.**

## Conventions

- **`APP_VERSION`** is shown in the UI as-is. Format **`YYYY-MM-DD rN`** for the
  rework series (r = rework): on a new day use today's date + `r1`; for additional
  pushes the same day, increment `rN`. Currently `2026-06-22 r18`.
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
- **`closetBack()` pops the navigation stack** — prioritizes context: if `_reviewMode`,
  return to review deal card; else if `_fromStats`, return to stats; else render closet.
  Within item detail: `detailView === "details"` → `openItem()` (photo view); `detailId` set →
  `renderCloset()` (grid); then `searchResults` → `closetSub` → `closetCat` → root.
- **`_reviewMode`** — set to true when opening an item from Closet Review ("Edit Item" button).
  `openItemFromReview(id)` sets the flag and opens the photo view; `closetBack()` checks it first
  and returns to `renderStats()` with `statsView = "review-deal"` instead of the normal closet flow.
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
- **`FIELD_CONFIGS`** const maps field key → `{label, type, opts?, filter?}`. Always
  add new editable fields here before wiring them in `openItemDetails`. Types: `color`,
  `multi`, `single`, `text`, `price`, `typeahead`. `filter: true` adds a filter input
  above chip lists. Currently: color_family, fabric (filter), size, season, brand
  (typeahead), status, price, url, retailer, acquisition.
- **Field sheet dual-mode**: `_fieldEditItem` = item being edited (real item OR
  `_addState`). `_fieldOnSave` = null means save to DB via `saveField()`; a function
  means call it with the value instead (Add form uses this). Always clear both in
  `closeFieldSheet()`.
- **Add Item state**: `_addState` (plain obj), `_addPhotoBlob` ({blob, ext}),
  `_addPhotoUrl` (object URL for preview, revoke on reset). Category sheet reuses
  `#moveSheet`; guard with `_addCatMode = true` so the bg-click handler routes
  correctly. Field edits via `openAddFieldEdit(field)` which sets `_fieldOnSave`.
- **Currently `APP_VERSION`** is `2026-06-22 r18`.
- **Calendar day-view logging** — `+ Clothing` (`openCalAddClothing`, multi-select via the shared
  `_capPick` picker, solo wear rows) and `+ Look` (`openCalAddLook`/`logLookOnDay`, one wear per
  piece with `outfit_id`) render into `#calendarBody` with `body.onclick` delegation. The clothing
  picker reuses the `#capPickCount` element id so `togglePick` updates the count. `renderCalendarDay`
  clears `body.onclick` on return so stale picker delegation doesn't linger.
- **Item photo replace** — `pickItemPhoto`/`replaceItemPhoto`/`removeItemPhoto` (item-detail
  footer). Replace reuses the Add pipeline (`compressImage`→`uploadPhoto`→PATCH→`deletePhoto`
  old→`signedUrlBatch` new); each upload gets a fresh `uuid.ext` filename so there's no cache
  collision. Footer markup is state-aware on `i.image_path`. No in-app crop/rotate (dropped).
- **`layoutCanvasHtml(o, wrapCls)`** is the single source for rendering a saved Build-a-look
  arrangement (returns positioned `.ocpiece` divs, or `null` when `o.layout` has no usable
  pieces). `outfitCollageHtml`, the `openLook` hero, and both calendar collage helpers call it
  and fall back to their grid collage on `null`. Add new outfit-thumbnail surfaces through it.
- **Build-a-look canvas** — `builder` global holds the whole editor state; it's `null` except
  while on `#tab-builder`. `switchTab` clears it + the `builder-mode` class for any tab ≠ builder,
  so leaving always tears down cleanly. Pieces store **normalized** geometry (`x`/`y` center
  fraction, `s` width fraction) so the same `layout` renders at any canvas size. **Move/resize/
  select do DOM surgery, never a re-render** (re-render reloads photos → flicker); only add/
  layer/delete/picker re-render. The canvas needs `touch-action:none` (set in CSS on `.bCanvas`
  and `.bpiece`) or the browser scrolls instead of dragging. **`outfits.layout` write requires
  `migration/outfit_layout.sql`** — saving a look 500s until it's run.
- **Trip weather (Open-Meteo)** — three APIs, **no key needed**, all by lat/lon:
  geocoding (`geocoding-api.open-meteo.com/v1/search?name=`), forecast
  (`api.open-meteo.com/v1/forecast`, daily, ~today−92d→+15d window), archive ERA5
  (`archive-api.open-meteo.com/v1/archive`, real historical, lags ~5 days). `fetchWeatherRange`
  splits a date range into those 3 zones; far-future dates get a **3-yr same-calendar-date
  average** from the archive (flagged `hist:true`, rendered as a gray "avg" card). Temps requested
  in °F. `capsules.locations` is JSONB (`migration/capsule_weather.sql`); a location with null
  `from/to` covers the whole trip. `_wxCache` (10-min TTL) is invalidated whenever locations change.
- **Capsule grouping** — `groupByCategory(list)` returns `[{key,items}]` in `CAP_CAT_ORDER`
  (Outerwear→Tops→Dresses→Bottoms→Shoes→Workout, then "Other"), items sorted by formality then
  name; `groupByFormality(list)` buckets by the 5 `OCCASION_LADDER` levels. Both feed `capGroupsHtml`
  (detail) and `pickerGridHtml` (picker). `_capSort` toggles which; `_capUnpackedOnly` filters Trips;
  `_capPickCat` is the picker's category filter. Section "N/M packed" headers are refreshed live by
  `refreshPackGroupCounts()` reading `.gtile.packed` from the DOM (no re-render on a tick).
- **Capsules: nested-button gotcha** — tiles in a capsule grid are `<button class="gtile">`;
  any tap target rendered *inside* a tile (the packing tick) must be a `<div>`/`<span>`, not a
  `<button>`. Nested `<button>` is invalid HTML and the parser hoists it out, breaking
  `.gtile .pack-tick` selectors. Use `data-*` + `closest()` + `stopPropagation` for the inner tap.
- **`activeCapsuleId`** scopes the Closet **and Looks** (r17): in Closet `lensItems()` returns
  only that capsule's members (ignoring the status lens); in Looks `looksScopedOutfits()` keeps
  only looks wearable entirely from it. Both inject a clear-able `.cap-banner`. It does **NOT**
  clear on tab switch (it deliberately spans both surfaces) — only the banner ✕ (`[data-cap-clear]`,
  handled in both the closetBody and looksBody handlers) or deleting the capsule clears it.
- **`capsule_items.packed`** is loaded via `select=*` and inserts omit it, so capsules work
  before the migration; only `togglePack()` PATCHes `packed` (needs `capsule_items_packed.sql`).
- **Formality is 1–5** (`OCCASION_LADDER` has 5 entries): Lounge/Casual/Smart/Dressy/Formal.
  Items (`min_occasion`/`max_occasion`) and outfit buckets now use the same vocabulary.
  `BUCKET_RANGES` maps each bucket key to its target `{min, max}` for nudging pieces.
- **`outfitBucket(o)`**: checks `o.formality_override` first, then derives from piece
  averages. `o._bucket` is a session cache; clear it (set null) when any piece's
  occasion changes. `openLookFormalityEdit()` PATCHes `formality_override` and offers
  `showNudgePiecesSheet()` to align pieces.
- **`openOccasionEdit(itemId, onSaved)`**: reuses `#logSheet`; tap-lo-then-hi for
  range selection (third tap resets to single). Always clears all `o._bucket` caches
  so looks re-derive correctly after a change.
- **Stats filter sheet:** filters live in `#statsFilterSheet` (bottom sheet), opened by
  funnel icon (`#stFilter`). `openStatsFilters()` builds + wires the sheet. Chips in the
  sheet use `[data-sf]` (multi-select dims), `[data-sar]` (acquired range), `[data-sr]`
  (wear date range). Each chip updates state + calls `statsRebuild()` immediately; sheet
  stays open so user can stack filters. Done/backdrop just hides the sheet.
- **`statsRebuild()`** handles grid state transitions (re-derive list if `statsListKey` set,
  back to field if `statsFromField`, back to main otherwise) then calls `renderStats()`.
  Call it whenever filter state changes. `wireStatsToolbar()` wires `#stBack` → `statsNavBack`
  and `#stFilter` → `openStatsFilters` — call it at the end of every stats render.
- **`[data-sv]` on field pages must use `:not([data-sf])`** to avoid targeting filter chips
  (which have both attributes). The donut arrow highlight selector has the same constraint.
  Breaking this again causes filter chip taps to also navigate to a grid.
- **`statsListKey` is the smart-list key** (e.g. "worst-cpw"). If set when a filter changes,
  `statsRebuild` re-derives via `buildSmartList(statsListKey)`. `statsNavBack()` must clear
  it. Field-derived grids have `statsListKey = null` and `statsFromField = true` instead.
- **`statsSubtitleFn`** is stored in state and passed to `gridHtml(list, statsSubtitleFn)`
  on every grid render. Set by `buildSmartList` for most-worn, least-worn, CPW lists,
  best-potential, recently-acquired. Clear it in `statsNavBack()`.
- **Date range only affects wear-count lists** (most/least worn, never worn).
  CPW and Best Potential use all-time `wearCount` (lifetime ratios). `wearCountInRange(itemId)`
  checks `rangeStart()` and filters the global `wears` array; returns `wearCount(itemId)` if
  range is "all". `dateRangeHuman()` returns the human-readable range string for labels.
- **Acquired range filter:** `statsAcqRange` encodes direction + period: "w1yr" = within
  1 year, "o2yr" = older than 2 years. `acqRangeStart()` returns `{cutoff, older}`.
  `statsPool()` uses `purchase_date` (not `created_at`) for this filter.

## Deploy

Commit `index.html` → push to `origin/main` → Pages deploys in ~1–2 min. See the
`deploy-wardrobe` skill. Repo: aluke0311/wardrobe_app. Live:
https://aluke0311.github.io/wardrobe_app/

## Local preview

`.claude/launch.json` runs `python3 -m http.server 4173` for the Claude preview
panel. Note: auth/data only fully work against the real `https://` deploy or any
non-`data:` origin; the in-memory session fallback applies otherwise.
