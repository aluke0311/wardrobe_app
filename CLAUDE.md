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

## Build roadmap / current status

**The forward plan now lives in `ROADMAP.md`, which is written as an execution-ready
spec** (executor handbook + file map + per-slice decisions, schema, and migration
SQL) — start there. Key decisions locked 2026-06-18: **personal single-user tool**,
**heuristics only — no AI/server-proxy/Edge Functions**, **thumbnail outfits (no
collage canvas)**, **derive-first/capture-light** data philosophy. The legacy
`3d/3e/3f` items below are folded into ROADMAP's Phases B/C/D; this section keeps the
*done* history.

**Current state: v20 / 2026-06-20. All phases through B + E + partial C/D/F + partial G done.**
Migrations are run by the user in the Supabase SQL editor; **never deploy UI that
writes a new column/table before its migration is confirmed.**

**What's done (condensed):**
- **Phase 1–2:** schema ✓ (schema.sql), import ✓ (476 items + photos + 3,995 wears + 1,543 outfits).
- **Phase 3a–3d core:** new schema, capsules+lens, outfits+builder, calendar (all ✓).
- **Phase A complete:** hierarchical closet, 7 tabs, Fill page, sortable grids, multi-select+batch, upkeep fields, wear ratings, fit/storage/price_original fields.
- **Phase B complete:** B1 Calendar (month grid, events, day-detail) + B1 refinement (wears grouped by outfit_id, inline notes) · B2 Capsule polish (packing checklist, outfit→capsule) · B3 Wishlist status + purchase-justification card · B4 Rotation/"Neglected" mode.
- **Phase C (Insights) partially complete:** KPI cards (item count, closet value, CPW, utilization) · drill-downs with time-range filter + Best/Worst toggle (CPW, Most Worn, Velocity, Never Worn, Best Purchases, Recency) · View Closet By donut charts (color/brand/size/season/fabric/price) · Occasion Coverage · **category filter chip row**. All Available-only scope. CPW $0 rule applied. *Airtable Goal CPW / Total Score formulas still pending — ask user for those formulas before implementing.*
- **Phase D1 complete (v8 2026-06-20):** ✨ Outfit ideas button in Log→Outfit tab. `suggestOutfits(ctx, n)` scores Available items by season match, recency penalty (−3 worn <7d, −1 worn <30d), color harmony (neutrals/adjacent hues), formality overlap, co-occurrence bonus. Builds top+bottom and dress combos, optionally adds best-fit shoe. `openSuggestSheet()` shows 13 occasion chips to filter by formality, 🔄 Shuffle (reseed candidates), "Use this outfit" → `startOutfitBuilder(null, ids)`. State: `suggestCtx`, `suggestSeed`. Button is a static element in `#logOutfitPanel`, wired once in `wireEvents`.
- **Phase D2 complete (v12–v13 2026-06-20):** Weather integration via open-meteo (no API key). `loadWeather(forceRefresh?)` fetches current temp/precip/code; `savedGeo()`/`requestGeo()` handle geolocation; `geoFromZip(zip)` looks up lat/lon via zippopotam.us as a fallback. `weatherCache` holds `{ temp_f, precip, code, fetched_ms }`, cached in `store` with 30-min TTL. Suggest sheet shows weather row (icon + temp + description). `suggestOutfits` scoring nudges ±0.5 for season/temp match and −2 for Sandals in rain. Settings → Location card: ZIP input (primary) + Auto-detect button + Clear; geo stored in `wardrobe.geo`, weather in `wardrobe.weather`, ZIP in `wardrobe.geo.zip`.
- **Phase F partial:** F2 fill upgrades (Available-only pool, random field, shuffled order) · F5 item detail enrichment (outfit mosaic 2×2 collage, "Wear it with" pairings, "Create outfit" button, days-in-wardrobe KPI) · F8 type-ahead for brand/retailer/size.
- **UI polish (2026-06-20 session, v1–v7):** all item photos → `contain` (fit, never cover) everywhere · item detail: back button on hero, combined last-worn/KPI row, tap-to-edit attribute rows (shared `readFillPatch` / `wireFillWidgets`) · calendar compacted · status filter → `<select>` dropdown · log screen overlap fixed · "Got compliments" removed · calendar "Log a wear for this day" now presets date correctly · calendar day-detail: ✕ per item + "Remove outfit" button · **"Worn" outfit log** via `wornOutfitMap()`.
- **Photo improvements (v9–v11 2026-06-20):** v9 transparent backgrounds — `loadPhotoNode` sets `backgroundColor="transparent"` on successful URL load so transparent PNG/WebP garments show cleanly on white tile surface. v11 batch URL signing — `signedUrlBatch(paths)` uses `POST /storage/v1/object/sign/{bucket}` (body `{ paths, expiresIn }`) to sign up to 100 URLs in one call; `prewarmUrlCache()` fires after `loadData()` so all item photos are cache-ready before IntersectionObserver fires (reduces ~476 round-trips to ~5).
- **Worn outfits filter (v14 2026-06-20):** "Hide singles (N)" / "Show singles (N)" pill in the Worn outfits header. State: `outfitHideSingles` bool. Filters `wornOutfitMap()` entries where `ids.length === 1` before rendering; count badge shows how many singles exist. Resets `outfitsShown` on toggle.
- **v15 (2026-06-20):** F3 rating in outfit builder · D4 clone outfit, add-to-capsule from detail, merge duplicate outfits ("Merge dupes" button in Saved header).
- **v16 (2026-06-20):** Quick re-wear section at top of Log → Outfit tab — shows top 6 recently-worn multi-item combos with inline date picker + Log button. `renderQuickRewear()` called in `setLogMode("outfit")`; uses `wornOutfitMap()`.
- **v17 (2026-06-20):** F8 type-ahead for fill_size + fill_fabric (shared dl_size datalist; new dl_fabric populated from text[] fabric arrays via `fillDlArray`). F9 "By Context" third view in Outfits tab — folders derived from `outfits.context`, drill into outfit list, no schema change. "Style This Orphan" card in Log → Outfit — finds Available items with 0 outfit appearances, shows one randomly, "Build an outfit around this" + Skip button; `renderOrphanCard()` called after `ensureOutfits()` resolves. Strict weather hard-filter in `suggestOutfits` — `isCold` (temp_f < 50) removes Sandals + Shorts from pool entirely; `isRainy` (precip > 0.1) removes Sandals (previously only soft-scored ±0.5). Batch Season + Color — two new buttons in multi-select bar; `batchSeason()` opens chip sheet (additive merge); `batchColor()` opens swatch sheet (sets color_family). New(90d) closet filter chip — toggleable chip in filterbar root header filters items by `purchase_date >= today-90`; `applyFacets` now actually called in `renderCloset` (was dead code before).
- **Phase E complete (v18 2026-06-20):** Home dashboard landing tab. Nav rebalanced to 6 tabs: Home · Closet · Log · Calendar · Capsules · Insights (Fill + Settings removed from nav; Settings via ⚙ gear in header; Fill via Home quick-action). `renderHome()` builds: week strip (Sun–Sat current week, first worn item's thumbnail per day, wear-dot, today highlighted, tap → `openDay`), greeting + weather row, today's picks (top 2 from `suggestOutfits(null,2)`, "Use this outfit" → builder, "More ideas" → suggest sheet), quick-action buttons (Log / Fill gaps / Browse closet), upcoming events (loaded lazily, re-renders on load, tap → `openDay`), neglected strip (Available items unworn 30d+, horizontal scroll, "View all →" sets `neglectMode=true`), needs-attention list (laundry/repair items, tap → `openItem`). App now boots to Home tab.
- **F6 closet filter polish (v19 2026-06-20):** Filters button with active-count badge in the closet toolbar. `openFilterSheet()` opens `#modal` with Season chips, Color swatches, and Acquisition (New/Secondhand/Gift) chips — all toggle independently, Done/Clear all/✕ buttons. `closetAcqFilter` state + `applyFacets` + `closetFilterCount()` wired. Active acquisition filter shown as dismissible chip. "Recently purchased" sort option added.
- **Phase G partial (v20 2026-06-20):** G1 multi-select logger — Log tab "Items" mode is now a tap-to-pick photo grid (cols4) of Available items + search. Sticky `#logPickedBar` shows N selected + "Log N items" button. Single pick: logs directly + undo toast (8s). 2+ picks: opens `openGroupingSheet()` — numbered chip assignment per item (items can share outfit numbers for overlap), "Log outfits" creates outfits + wear rows per group (option a: multiple rows per item/day; `wearCount` now counts distinct `worn_on` dates), "Log separately" skips grouping. `toastUndo(msg, fn)` helper with tap-to-undo. G2: long-press closet tile (600ms) → instant `logWear(id, today, null)` + undo toast; `lpFired` flag prevents normal tap from firing after. G3: Home today-cell empty shows "＋", tap routes to multi-select logger with date preset; today-with-wears still opens day detail. G-prune: removed `storage_location`, `fit`, `length`, `rise` from `FILL_FIELDS` + `FILL_PROMPT` (DB columns kept).
- **▶ NEXT UP (G remaining):** G7 laundry self-clear + checkbox bulk-reset → G6 season derive-and-confirm → suggestion recency-decay + stretch pick → G-meta tidy-up nudge.
- **Still pending (other):** D3 (capsule auto-gen) · F4 (user-editable categories, decision required) · F7 (size tracker).

**Outfit dedup note (D4, NOT started):** the import created one outfit row per
wear-day, so the ~1,543 outfits include many duplicates (same item set, different
days). The "Worn" view already solves *display* by deriving from wears; a future
merge script + in-app "merge duplicates" action would clean the `outfits` table itself — see ROADMAP §D4.

## Conventions

- **`APP_VERSION`** is shown in the UI as-is (no "v" prefix in markup). Format
  **`YYYY-MM-DD vN`**: on a new day use today's date + `v1`; for additional pushes
  the same day, increment `vN` (`v2`, `v3`, …) so same-day deploys differ.
  Currently `2026-06-20 v20`.
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
- **Batch-sign photo URLs on load** — `POST /storage/v1/object/sign/{bucket}` with body `{ paths: string[], expiresIn: number }` returns `[{ path, signedURL, error }]`; full URL = `` `${SUPABASE_URL}/storage/v1${row.signedURL}` ``. Call `prewarmUrlCache()` after `loadData()` to fill `_urlCache` before any IntersectionObserver fires. Don't `await` it — fire-and-forget so it doesn't block render.
- **`button.pill.on` CSS needed for chip selected state** — the `.pill` class alone has no `.on` rule; add `button.pill.on { background: var(--ink); color: #fff; }` alongside any interactive chip group. The context chips in the suggest sheet use this.
- **Transparent photo backgrounds** — `loadPhotoNode` sets `el.style.backgroundColor = "transparent"` when a URL resolves, letting the tile's white `--surface` show through transparent PNG/WebP garments. Placeholder tiles (no `data-photo`) keep the `#eceae6` warm gray.
- **Weather is fire-and-forget** — `loadWeather()` is called without `await` in `bootApp` and `retryLoad` so it never blocks render. `weatherCache` starts null; the suggest sheet checks it at render time and simply omits the weather row if null. Don't await it in the boot path.
- **`geoFromZip` uses zippopotam.us** — `GET https://api.zippopotam.us/us/{zip}` returns `{ places: [{ latitude, longitude }] }`. US-only, free, no key. Falls back gracefully (returns null) on bad ZIP or network error. Saves geo to `wardrobe.geo` same as `requestGeo`.
- **`outfitHideSingles` filter state** — bool at module level, default false. Applied in `renderWornOutfits` before slicing for the "Show more" pagination, so the count and the "more" button reflect the filtered set, not the raw total.
- **`renderQuickRewear()` is called in `setLogMode("outfit")`** — renders the top 6 recently-worn multi-item combos from `wornOutfitMap()` into `#quickRewearSection`. Uses `logPresetDate` if set for the default date. Log button creates bare wear rows (no `outfit_id`) and calls `refreshViews()` + re-renders the section.
- **`applyFacets` is called in `renderCloset`** — wraps `applyNeglect(statusScoped())` result. Facets: `closetSeasonFilter`, `closetColorFilter`, `closetRecentFilter` (New 90d). `closetFilterActive()` / `clearClosetFacets()` manage all three. The "New (90d)" chip toggles `closetRecentFilter`; the chip row is wired in `wireClosetControls` via `#closetFilterChips`.
- **`renderOrphanCard()` in Log → Outfit** — shows one random Available item with 0 outfit appearances in `#orphanCardSection`. Called after `ensureOutfits()` resolves in `setLogMode("outfit")`. Skip temporarily adds the picked id to the in-memory `inOutfits` set and redraws (session only, not persisted).
- **`fillDlArray(id, field)` for array fields** — like `fillDl` but flattens `text[]` arrays from items. Used for `#dl_fabric`. `fillDl` assumes scalar strings; `fillDlArray` iterates `(i[field] || [])`. Both live in `wireItemForm`.
- **Outfit "By Context" view** — `outfitView === "context"` dispatches to `renderContextOutfits()`. State: `outfitContextBrowse` (null = root folders, else chosen context name). Reset on view-toggle click. Uses `outfits.context` directly — no schema change. Checks `outfitsLoaded` and shows spinner + calls `ensureOutfits()` if not yet loaded.
- **Home tab nav + routing** — App now boots to `switchTab("home")` (not closet). Nav is 6 tabs: Home · Closet · Log · Calendar · Capsules · Insights (Fill + Settings removed from tabbar). Settings reachable via `#headerGear` ⚙ button in header. Fill accessible via "Fill gaps" quick-action on Home. The tabbar CSS is `grid-template-columns: repeat(6, 1fr)` — update this if tabs change.
- **`renderHome()` derives from in-memory state** — reads `items`, `wears`, `weatherCache`, `events`/`eventsLoaded` directly; no additional network calls. Events are loaded lazily: `renderHome` calls `loadEvents().then(() => renderHome())` if `eventsLoaded` is false, so the upcoming-events section auto-appears after data arrives.
- **Week strip thumbnails** — each day cell shows the `image_path` of the first item worn that day (via `wearsByDay` map built from `wears` array). `data-photo` attribute on `.hd-thumb` means `hydratePhotos(body)` will fill signed URLs via the IntersectionObserver. The `.home-day.today` class applies the ink-background highlight; child elements inherit `color: #fff` for the label/number, but `.hd-thumb` uses its own background.
- **Neglected "View all →"** — sets the module-level `neglectMode = true` then calls `switchTab("closet")`. This activates the same B4 neglect filter as the "Neglected" toggle button in the closet header, so the two stay in sync.
- **`openFilterSheet()` closet filter sheet** — opens `#modal` + `#sheet` with Season/Color/Acquisition facets.
- **`#logPickedBar` is position:fixed — use `style.display` not `hidden`** — the CSS rule sets `display:flex` which overrides the `[hidden]` UA stylesheet. Toggle via `el.style.display = "flex"/"none"` in all code; don't use `.hidden`. Start as `style="display:none"` in HTML.
- **`wearCount` counts distinct worn_on dates (not rows)** — option (a) for overlapping same-day outfits is live: multiple wear rows per item/day are allowed when an item is shared across two outfits. All wear-count stats (CPW, tiles, Insights) now correctly de-dup by date. `outfitWearCount` and `outfitWearDates` were already distinct-day and remain unchanged.
- **`logPickedIds` is a module-level Set** — cleared in `buildWearTab()`, `setLogMode("outfit")`, and `switchTab(name !== "log")`. `logCommitBtn` and `logItemGrid` delegation are wired once in `wireEvents`; `renderLogGrid(q)` re-renders the grid from the current `items` pool with `.picked` toggled for ids in `logPickedIds`.
- **`lpTimer`/`lpFired` (G2 long-press)** — module-level. `touchstart` on `#closetBody` starts a 600ms timer; any `touchend/cancel/move` clears it. When it fires, `lpFired = true` so the subsequent `click` event on the tile returns early without opening the item. Reset `lpFired = false` inside the click handler after consuming it.
- **`openGroupingSheet(ids, date, context)`** — sets `sheet.innerHTML`, renders items via `renderItems()`, wires `sheet.onclick`, then calls `$("#modal").classList.add("open")`. Same modal/sheet pattern as rest of app. `closeModal()` clears `sheet.onclick` so no stale handler remains. State: `closetSeasonFilter`, `closetColorFilter`, `closetAcqFilter` (null or value). `closetFilterCount()` returns the active-filter count shown as a badge on the "Filters" button in the closet toolbar. All filters persist across sheet open/close; Done or ✕ closes + re-renders closet; Clear all resets all three + closes. `.fswatch` CSS class for the 34px circular color swatches.

## Deploy

Commit `index.html` → push to `origin/main` → Pages deploys in ~1–2 min. See the
`deploy-wardrobe` skill. Repo: aluke0311/wardrobe_app. Live:
https://aluke0311.github.io/wardrobe_app/

## Local preview

`.claude/launch.json` runs `python3 -m http.server 4173` for the Claude preview
panel. Note: auth/data only fully work against the real `https://` deploy or any
non-`data:` origin; the in-memory session fallback applies otherwise.
