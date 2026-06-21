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

**Current state: r11 / 2026-06-21. Full rework from v25. ~2,100 lines.**
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
- **TABS + WIRING** — `switchTab(name)`, `wireEvents()`, `init()` IIFE at bottom.
  Currently active tabs: home · closet · looks · calendar (stub) ·
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
  **season** (text[]), **min_occasion**/**max_occasion** (smallint 1–5),
  **status** (Available|Storage|Archive — replaces the old `archived` bool),
  tags (text[]), url, order_no, receipt_url, official_name, notes, image_path,
  created_at.
- `wears`: id, user_id, item_id, **outfit_id** (nullable), worn_on (date — any
  past date allowed, so historical back-fill is normal), **context** (text),
  created_at. One row per item per day worn.
- `outfits`: id, user_id, name, context, notes, image_path, **formality_override**
  (text — one of the 5 bucket keys, nullable), created_at.
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

**▶ NEXT UP:**
1. **Capsules** — named item sets, packing lists.
2. **Style Stats** — wear counts, cost-per-wear, coverage gaps.
3. **Style Stats** — wear counts, cost-per-wear, coverage gaps.
4. **Build-a-look** — closet multi-select → create new outfit; edit a look's pieces.
5. **Image replace** — currently "coming soon" stub on the details footer.

Migrations are run by the user in the Supabase SQL editor; **never deploy UI
that writes a new column/table before its migration is confirmed.**

## Conventions

- **`APP_VERSION`** is shown in the UI as-is. Format **`YYYY-MM-DD rN`** for the
  rework series (r = rework): on a new day use today's date + `r1`; for additional
  pushes the same day, increment `rN`. Currently `2026-06-21 r11`.
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
- **Currently `APP_VERSION`** is `2026-06-21 r11`.
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

## Deploy

Commit `index.html` → push to `origin/main` → Pages deploys in ~1–2 min. See the
`deploy-wardrobe` skill. Repo: aluke0311/wardrobe_app. Live:
https://aluke0311.github.io/wardrobe_app/

## Local preview

`.claude/launch.json` runs `python3 -m http.server 4173` for the Claude preview
panel. Note: auth/data only fully work against the real `https://` deploy or any
non-`data:` origin; the in-memory session fallback applies otherwise.
