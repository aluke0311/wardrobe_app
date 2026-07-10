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

**Current state: 2026-07-10 r2. Full rework from v25. ~10,700 lines.**
The old v25 is preserved at git tag `v25-full` and `archive/index_v25_full.html`.
Do not use v25 as a reference for current UI code.

**Brand & Retailer Report Cards (2026-07-10) shipped in `2026-07-10 r2`** — see
the STYLE STATS entry below for `buildReportStats`/`renderStatsReportPage`/
`renderStatsReportDetailPage`. **▶ NEXT UP:** nothing scheduled — ask before
starting new work.

**"Weather + Loop Polish" v3 (2026-07-09) is FULLY SHIPPED in `2026-07-09 r1`**
(decisions locked in ROADMAP.md's v3 section): the W7 "Today" tile was REMOVED
(user call) and weather moved INTO the suggester (`scoreCombo` wx override,
`WX_HOT_F`/`WX_COLD_F` constants, sheet weather chip, trip-plan `_planWx`) ·
`wears.formality_for` is now DERIVED at log time (`deriveWearFormality`), never
asked — the post-log sheet is context-only · weekday-context suggestion chip
(`weekdayTopContext`) · look-log dup guard + Undo parity · Home "✓ Logged today"
row · Wear-again strip reserves 2 liked-but-neglected slots · suggester
lock-a-piece (🔒) + add/remove Layer · calendar "On this day" row · both nav-audit
items closed (`openItemFrom(id, browseCtx)` snapshot/restore). No schema changes.

**"Hearts + Filters Everywhere" v2 is FULLY SHIPPED, all 8 waves (W0–W7), through
`2026-07-06 r7`.** The 2026-06 "Unified Experience" build (W0–W5) and filter
unification Phases 2+3 are also fully shipped. **▶ NEXT UP:** nothing scheduled —
see `ROADMAP.md`'s "Back-burner" section for what's next; ask the user before
starting new work.

Top-of-`<script>` config, then logically grouped sections:

- **CONFIG** — `SUPABASE_URL`, `SUPABASE_KEY`, `BUCKET`, `APP_VERSION`, `TAXONOMY`,
  `COLOR_FAMILIES`, `OCCASION_LADDER` (8 levels), `FORMALITY_BUCKETS`, `BUCKET_RANGES`,
  `SUBCAT_FORMALITY`, `CAT_FORMALITY`, `CONTEXTS`, image/encode constants.
- **SESSION** — `store` safe wrapper (probes localStorage once, falls back to in-memory
  Map). Always use `store`/`saveSession`/`loadSession`, never raw localStorage.
- **FETCH HELPERS** — `authRequest`, `api` (authed fetch + transparent 401 retry),
  `rest` (PostgREST wrapper), `uploadPhoto`/`deletePhoto`/`signedUrl`/`signedUrlBatch`,
  `prewarmUrlCache()` (batch-signs all item photos after loadData, fire-and-forget).
- **IMAGE COMPRESSION** — `compressImage(file)`: canvas downscale to 1200px, WebP
  q0.82, JPEG fallback if browser can't encode WebP.
- **STATE + DERIVED** — `items`, `wears`, `outfits`, `outfit_items`, `capsules`,
  `capsule_items`, `exclusions` loaded via `loadData()`. Helpers: `wearCount`,
  `lastWorn`, `costPerWear`, `daysSince`, `money`, `esc`.
- **HOME LAUNCHER** — `renderHome()`: Stylebook calm tile grid (5 tiles). Below the
  grid: the `log-cta` ("Log today's wear" → `openWearAgainChooser`) when nothing is
  logged today, else a **"✓ Logged today · <contexts|n items>" row** (`.logged-row`)
  that taps into today's calendar day view (v3 — habit feedback + evening-outfit
  shortcut). The v2 "Today" tile was REMOVED in v3; what remains of it is
  `getHomeLocation()` (keyless `navigator.geolocation`, cached in `store` under
  `HOME_LOC_KEY`/`HOME_LOC_TTL`) + `loadHomeWeather()` (`_homeWx`, one fetch/day),
  which now feed the suggestion sheet's weather chip instead.
- **CLOSET** — `renderCloset()`/`openItem()`/`openItemDetails()`. Status-lens
  switcher. `siblingItems()` derives the current list for prev/next item nav.
- **ITEM DETAIL** — two-view: `openItem()` (photo + nav bar) → `openItemDetails()`
  (edit view). Field sheet (`#fieldSheet`) driven by `FIELD_CONFIGS`/`openFieldEdit()`.
  `_fieldEditItem`/`_fieldOnSave` dual-mode (DB save vs. callback).
- **ADD ITEM** — `renderAdd()`/`_renderAddBody()`/`saveNewItem()`. State in `_addState`.
- **SEARCH** — `openSearch()`/`renderSearch()`/`runSearch()`. Keyword + 6 filter rows.
- **LOOKS** — `renderLooks()` + 3-view look detail keyed by `lookView`:
  `openLook()` (clean canvas + bottom action toolbar: Details/Formality/Duplicate/
  Calendar/Archive/Delete, plus a **heart toggle** in the toolbar's right slot) →
  `openLookDetails()` (metadata page: wear/pieces/cost, formality, season, per-piece
  formality, notes) → `openLookWears()` ("When You Wore It" — every wear date; tap a
  day → `openContextSheet` to set that wear's context). `looksBack()` walks
  wears→details→canvas, then `leaveLook()` — the single canvas-level exit (also used
  by archive + delete): consumes `_lookReturn` if the look was opened from another
  screen (see `openLookFrom` in Known gotchas), else `renderLooks()` (list, stays
  filtered if scoped). `duplicateLook()`/`archiveLook()`.
  Lens switcher: **Formality · Season · Context · Capsule · Liked · Recent · All ·
  Archived** (8 tabs — `.lens` row scrolls horizontally, doesn't shrink labels).
  `activeOutfits()`/`archivedOutfits()` derive from `effectiveArchived(o)` (`o.archived`
  OR any piece is status Archive — no cascade PATCH, no column; auto- vs
  manually-archived shows a one-line note on canvas/details, the Archive/Unarchive
  button only ever reads/writes `o.archived`). `layoutCanvasHtml(o, wrapCls)` /
  `lookHeroBlock(o)` render arrangements.
  **Hearts**: `outfits.rating === 1` = liked (`toggleLikeLook(id)`, PATCH 1↔null, no
  other values used). Primary hearting moment is `openPostLogSheet` (shown whenever
  logged wears share an `outfit_id`) and a `.cal-heart-btn` on calendar day-view look
  cards — not just browsing. `.otile-heart` badges liked-look tiles everywhere
  (`outfitGridHtml`, all look pickers). `outfitContextMap()` (one pass over wears →
  Map(outfit_id→Set(contexts)); `outfitContexts(o)` is the single-look convenience)
  backs the Context lens folders — use the map for whole-list scans, never a
  per-outfit scan (perf: outfits × wears).
- **BUILD-A-LOOK** — Stylebook canvas on `#tab-builder`. `openBuilder(outfitId?, seedItemId?)`.
  Pointer drag+resize; `builder` global state. `saveBuilder()` writes `outfits.layout` JSONB.
  "+ Clothing" picker: category/subfolder browsing is full-screen (`renderBuilderPicker`);
  once at an item list (`builderInItemMode` → subfolder or flat category) it switches to a
  bottom item rail over the visible canvas (`renderBuilderRail`, `.bld-rail`); rail taps
  `addPieceToBuilder(id, true)` keep it open. Migration: `migration/outfit_layout.sql`.
  **Wear-sync after piece edits** (2026-07-08): `saveBuilder` checks `wearSyncCandidate(id)`
  (most recent wear date ≤14d whose outfit-linked wear rows ≠ current piece set).
  Same-day mismatch → `syncWearsToLook(id, date)` runs silently (toast notes it);
  1–14 days old → offer chip on the toast ("Update that wear →"). Sync deletes that
  day's wear rows for swapped-out pieces and inserts rows for swapped-in ones,
  copying context/formality from a surviving group row (tags follow the swap).
  State-based, not delta-based — re-saving an unchanged look still offers the fix,
  which is also the repair path for wears left stale before this shipped. Older
  wears are history and never touched. **Dup-merge follow-up**: when an EDITED
  look merges into an existing duplicate, the same policy applies to the edited
  look's latest wear — same-day is re-pointed to the survivor automatically
  (`repointWears` + `syncWearsToLook`); ≤14d is offered inside `openMergeFollowUp`,
  a post-merge sheet that also asks the old look's fate (Keep / Archive / Delete —
  delete inlined, not `deleteLook`, to skip its `leaveLook()` navigation; wears FK
  is SET NULL so history survives). Sheet skipped in trip-plan (`planCtx`) saves.
- **OUTFIT SUGGESTIONS** — `suggestOutfits(targetLevel?, seedItemId?, capsulePool?,
  season?, wx?, lockedIds?)`. Slot-filling engine (Top/Dress + Bottom + Shoes +
  optional Outerwear). **By design there is NO unworn/last-worn weighting** — slots
  random-sample and scoring is only "match" signals: formality cohesion (hard filter
  via `formalityOk`), exclusions (hard), loud-color penalty, pattern-clash penalty
  (`isPatterned`), and a capped SOFT boost for color-pair + item-pair affinity learned
  from saved outfits (`buildSuggestIndexes` → `_colorPairFreq`/`_itemPairFreq`;
  **liked looks (`o.rating===1`) count double**). Returns 8 via softmax (temp 0.8)
  with diversity-aware selection so arrowing/swiping swaps pieces.
  **Weather (v3):** when `wx` (`{maxT,minT,code}`) is present it OVERRIDES the
  season layer heuristic in `scoreCombo` — hot (`maxT ≥ WX_HOT_F`, 78°F) penalizes
  layers/heavy tops, cold (`≤ WX_COLD_F`, 50°F) boosts layers, precipitation
  (`wmoIsWet`) boosts Boots / penalizes Sandals. Sheet weather = `loadHomeWeather()`
  (`_homeWx`, one fetch/day, geolocation) or the plan day's `_planWx`; shown as a
  toggleable chip in the Season row (`_sugg.useWx`, `_suggWx()`).
  **Lock-a-piece (v3):** 🔒 chip per piece (`_sugg.locked` Set) — locked pieces pin
  their slot and survive every regenerate; locked+seed ids are exempt from the
  per-item diversity cap. **"+ Layer" / "× Layer"** (`comboLayerPiece`/
  `addSuggestionLayer`) adds/removes a compatible layer on the current combo.
  Pieces are tappable (open item); swipe slides (`sg-anim-*`). A row of
  **Context chips** (`topContextsByWearCount`) sits above the formality chips —
  picking one sets `_sugg.targetLevel` from `contextFormalityLevel(context)` (mode of
  that context's `formality_for` wears, min 3 to trust; else `CONTEXT_FORMALITY_SEED`).
  Entry points: item detail shuffle button, Looks tab +, capsule "Suggest an outfit".
  Sheet state in `_sugg` (incl. `activeContext`).
  **"Wear this today" logs AS AN OUTFIT** (`wearSuggestedCombo`, r2): create-or-merge
  a real look via `saveComboAsOutfit` (item-set dedup + layout), wears get its
  `outfit_id` + derived formality, soft dup guard per day, post-log sheet shows the
  heart. Undo removes the wear rows only (the created look stays; dedup reabsorbs it).
- **EXCLUSIONS** — `exclusions` table stores item pairs that shouldn't appear together.
  `buildExcludeSet()` → `_excludeSet` (Set of "a:b" canonical pairs). `isExcluded(a,b)`,
  `addExclusion(a,b,reason)`. Loaded in `loadData()`.
- **CAPSULES** — `renderCapsules()` dispatches by `capsuleView` (list/detail/form/pick/**plan**).
  Two modes: Capsule + Trip (packing checklist, weather strip). "Plan outfits from this" sets
  `activeCapsuleId` (scopes Closet + Looks). "Suggest an outfit" opens suggestion sheet scoped to
  capsule members.
  **Trip by-day planner** (`capsuleView="plan"`, `renderCapsulePlan()`): one card per trip date
  with that day's weather (`_planWx` from `buildTripWeather`). Per day: Assign a saved Look
  (`openPlanLookPicker`, scoped to `outfitFullyInCapsule`), Suggest (`openSuggestSheet(null,cid,
  {capsuleId,date})` — season = trip date, saves combo via `saveComboAsOutfit`), or Build
  (`openBuilder(null,null,{capsuleId,date})` — picker scoped to capsule via `builderPool()`).
  Saving in any of those calls `addPlanLook`. Plans live in `capsules.plan` JSONB (intentions,
  NOT wears — `migration/capsule_plan.sql`); "Wore it" (`planWoreIt`) converts a day to a real
  wear. `finishBuilder(id,msg)` routes a builder save back to the plan when `builder.planCtx` set.
- **CALENDAR** — `renderCalendar()` dispatches month/day views. Day view: outfit groups,
  swipe-left actions (Copy/Move/Delete). "+ Clothing" / "+ Look" log pickers, both with
  a filter funnel (`pickerFilter`/`PICKER_FILTER_DIMS` for +Clothing, `calLookFilter`/
  `LOOKS_FILTER_DIMS` for +Look). Footer also has a **"↻ Wear again"** button
  (`openWearAgainChooser`, see DAILY LOOP). Above the footer, an **"On this day"** row
  (v3, `.otd-row`) shows the most recent prior YEAR with wears on the same date
  (mini collage + contexts); tap navigates the day view to that date.
- **STYLE STATS** — `renderStats()` dispatches main/field/grid/outfits/contexts/
  context-detail/report/report-detail/review views. **Brand/Retailer report cards**
  (2026-07-10): main-page "Brands & Retailers" section → `renderStatsReportPage()`
  ranks groups by a wear index (`buildReportStats(field)`): actual wears / expected
  wears, where expected = peer wear-rate (subcategory rate, category fallback when
  the subcat slice is under 5 items) × months observed per item. Tenure runs from
  purchase_date (→ first wear → created_at fallback), clamped to the earliest logged
  wear anywhere (pre-logging months would deflate rates). Per group: wears/mo,
  median $/wear + total spend (gifts excluded from cost stats, still counted for
  engagement), duds (never worn, or archived with < `REPORT_DUD_WEARS`=3 wears).
  Groups under `REPORT_MIN_ITEMS`=3 items list unranked. Pool = `reportPool()` —
  statsPool but `{ noStatusDefault: true }` so archived items stay in (dud rate
  needs them). Detail page: KPI card, Best performers / Underperformers grids
  (worst = never-worn by price desc, then lowest index), "All items" →
  grid with `statsFromReport` so back returns to the detail page (wired in
  `statsNavBack` + `statsRebuild`). No date-range button (metrics are inherently
  all-time / tenure-normalized); the filter funnel + acquisition range apply.
  Filter sheet (funnel icon). Range button. Closet Review
  deals items one card at a time; inline field picker on the deal card (no sheet-hop
  for most fields). `reviewPool()` is **Available-only** (Storage + Archive excluded).
  Deal card is sized to fit one phone screen: horizontal card (96px photo + info
  beside it), single-line formality chips, one-row action bar. Looks Stats section
  has three rows: Most Worn Looks, Liked Looks (→ `likedNeglectedOutfits()`: liked +
  never-worn-or-60d+), and Contexts (→ `renderStatsContextsPage`: wears-by-context,
  `contextFormalityStats` avg/spread, tap through to `renderStatsContextDetailPage`'s
  top items + top looks for that context — both range-scoped via `rangeStart()`).
- **DAILY LOOP** — `logWearToday(id)`: one-tap wear log from item photo view (no modal).
  Soft dup-wear guard (skips the POST + offers "Log again →" if already logged today);
  `logLookOnDay` has the same guard per look/day (v3). POSTs immediately; toast shows
  "Wear logged" + **Undo** + "Add context →" chips (`toast()` accepts an array of
  `{label,fn}` action chips; `undoLoggedWears(rows)` is the shared Undo — back-dated
  logs and look logs get Undo too, the latter via the post-log sheet's close toast).
  **`wears.formality_for` is DERIVED, never asked (v3):** every wear-create path
  writes `deriveWearFormality(itemIds)` (level(s) all pieces share → median, else
  rounded avg of per-piece minimums); manual correction = the look's formality edit.
  `openPostLogSheet(wearRows[], {presetCtx, undoable})`: context multi-select +
  **heart toggle** (shown whenever the wears share an `outfit_id` — the PRIMARY
  hearting moment). A **weekday-context suggestion chip** (v3,
  `weekdayTopContext(date)` → "✨ Church · usual for Sundays", ≥3 distinct days to
  trust, `_ctxSuggest`) sits above the context chips — one tap selects, never
  auto-saved. Sheet fires after solo item log, look wear, and (single-ask) after
  `makeLookFromDay`/`saveCalClothingLogAsLook` create a look, pre-seeded from any
  context already on the day's rows. `_logItemId` (module-global) tells
  `renderContextPicker` which item's frequent contexts to sort first. `openLogWear(id)`
  (back-dated log) reachable via quick-actions "Log on a date…" and a 500ms long-press
  on the item photo view's Log button. Home's `.log-cta` (or, once logged, the
  `.logged-row`) and the calendar day-view footer's "↻ Wear again" both open
  `openWearAgainChooser(date)` — a horizontal strip of 12 candidate looks
  (`wearAgainCandidates()` → `{list, neglectedIds}`: worn last 14 days ∪ liked ∪
  most-worn this season, with **2 slots reserved for in-season liked-but-neglected
  looks** badged "it's been a while", v3) before falling back to +Clothing/+Look;
  tapping a look calls `logLookOnDay`. `createLookFromItems(itemIds, {name})` is the
  shared create-or-merge (dedup via `findDuplicateOutfit`) behind both
  `makeLookFromDay` and the +Clothing picker's "Log as look" button
  (`saveCalClothingLogAsLook`, shown once ≥2 items are picked).
- **TABS + WIRING** — `switchTab(name)`, `wireEvents()`, `init()` IIFE.
  Active tabs: home · closet · looks · calendar · stats.
  Capsules is a Home-tile screen (not in bottom nav). Search/Add are non-tab screens.

## Closet model

**Status is a cross-cutting lens, not a category.** A tee is always under Tops.
`closetLens` (Available/Storage/Archive/All) scopes the category folder list.
Status changes happen on the item detail move bar only.

- `closetLens` — current lens, default "Available"
- `closetCat` — null = root | category name
- `closetSub` — null = subcategory list | name | `"__other__"` | `"__all__"`
- `searchResults` — null = browsing | array = search-result grid
- `detailId` — item id in detail view (null = none)

`closetBack()` pops the stack: details view → photo view; then `_reviewMode` → review
deal; `_fromBuilder` → restore builder; **`_itemReturn` → return to origin screen**;
else: grid → subcategory list → category list → root.

**Item-detail back is app-wide via `_itemReturn`** (a restore thunk). Item detail always
renders into the closet screen, so any NON-closet entry point opens via `openItemFrom(id)`,
which captures the active screen (`makeItemReturn`) and brings the closet forward without
`switchTab`. `closetBack` invokes the thunk (`restoreTab(tab)` re-renders that tab from its
preserved view-state). `switchTab` clears `_itemReturn` (a real tab tap abandons the return).
The builder is the one exception — it needs a full state stash, so it keeps `_fromBuilder`.
Plain closet-grid taps use bare `openItem` (origin IS closet → default back). Migrated entry
points: stats (`openItemFromStats`), look piece tap, suggestion piece tap, capsule item tap.

**Look-detail back mirrors this via `_lookReturn`** (added 2026-07-07 r2). Non-Looks entry
points open via `openLookFrom(id)` (`makeScreenReturn("looks")` — the generalized capture
behind `makeItemReturn`); `leaveLook()` consumes the thunk on back/archive/delete. Migrated:
calendar day-view look cards, both stats look grids, capsule looks, trip-plan day cards.
`restoreTab("looks")` re-opens `lookId` (per `lookView`) instead of `renderLooks()`, so
item-back from a look-canvas piece lands on the LOOK, and the two thunks compose:
calendar → look → piece → back → look → back → calendar. `switchTab` clears both returns.
Builder round-trips (`builderCancel`/`finishBuilder`) route through `switchTab("looks")`
and intentionally abandon origin.

## Data model

Canonical definition: **`schema.sql`** in repo root. Six tables, all RLS-scoped to
`auth.uid()`:

- `items`: id, user_id, name, category, subcategory, brand, retailer, color_family
  (single), price, purchase_date, date_is_guess, acquisition (New|Secondhand|Gift),
  size, fabric (text[]), season (text[]), **formality** (smallint[] of 1–8 levels), status
  (Available|Storage|Archive), tags (text[] — includes `"no-suggest"` tag), url,
  order_no, receipt_url, official_name, notes, image_path, created_at.
- `wears`: id, user_id, item_id, outfit_id (nullable), worn_on (date),
  context (text[] — named contexts, multi-select; seed list `CONTEXT_SEED` + any
  custom ones, derived via `contextOptions()`), formality_for (smallint 1–8,
  nullable — DERIVED at log time via `deriveWearFormality`, never asked (v3);
  manual override lives on the look), created_at.
- `outfits`: id, user_id, name, context, notes, image_path, formality_override
  (text — bucket key, nullable), **layout** (JSONB `{item_id,x,y,s}[]`),
  **rating** (smallint, CHECK 1–5, nullable — `rating === 1` means "liked" (hearts);
  other values unused/reserved), **archived** (boolean default false — manually-set
  flag; browse/pickers actually key off the DERIVED `effectiveArchived(o)`, which is
  also true when any piece's status is Archive), created_at.
  Join table: `outfit_items(outfit_id, item_id, user_id)`.
- `capsules`: id, user_id, name, kind (capsule|packing|travel), start_date,
  end_date, notes, locations (JSONB `{name,lat,lon,from,to}[]`), created_at.
  Join table: `capsule_items(capsule_id, item_id, user_id, packed bool)`.
- `exclusions`: id, user_id, item_a (uuid), item_b (uuid), reason (text),
  created_at. Normalized: `item_a < item_b`. RLS own_rows.
- Photos: private `wardrobe` bucket, path `<user_id>/<uuid>.<ext>`. Display = signed URLs.

**Migrations applied to live DB** (run via Supabase SQL editor):
- `migration/formality_schema.sql` — adds `items.formality`, `wears.formality_for`,
  `outfits.rating`, `exclusions` table.
- `migration/formality_multiselect.sql` — converts `items.formality smallint → smallint[]`
  (drops CHECK constraint, wraps existing values in arrays).
- `migration/outfit_layout.sql` — adds `outfits.layout`.
- `migration/capsule_weather.sql` — adds `capsules.locations`.
- `migration/capsule_items_packed.sql` — adds `capsule_items.packed`.
- `migration/wears_context_array.sql` — converts `wears.context text → text[]` (multi-select).
- `migration/outfit_archived.sql` — adds `outfits.archived` (boolean). Applied 2026-06-28.
- `migration/capsule_plan.sql` — adds `capsules.plan` (jsonb) for trip per-day outfit
  planning (`{ "<date>": ["<outfitId>", ...] }`). **Run before using the by-day planner.**
- `migration/merge_duplicate_outfits.sql` — DATA cleanup (not schema): collapses outfits
  with identical item-sets into one survivor, re-pointing wears. Survivor = non-archived >
  has-layout > oldest. Idempotent. Pairs with the save-time dedup guard in `saveBuilder`
  (`findDuplicateOutfit`/`itemSetKey`). Run once after deploying 2026-06-28 r5.

## Design model

**Formality (1–8, multiselect set):**
1. Function (workout, hiking, rain) · 2. Very Casual (home, errands) · 3. Casual
(chorus rehearsal, casual lunch) · 4. Polished Casual (date nights, matinees, parties) ·
5. Smart Casual (normal work day) · 6. Dressed Up (cocktail, weddings, evening) ·
7. Business Professional (interviews, conferences) · 8. Formal (black tie).

`items.formality` is `smallint[]` (a set, not a range). `itemFormalitySet(i)` is the
source of truth — returns the explicit array, or imputes from name keywords + subcat
seed (`SUBCAT_FORMALITY`) + co-occurrence nudge. `itemFormality(i)` returns the minimum
of the set for backward-compat display/grouping.

Suggestions: outfit valid at level L iff every piece's set contains L (pool-filtered
before combo generation). Pure-Function items (`set == [1]`) never mix with non-function
items — enforced by `formalityOk(its)`. L8 (Formal) is soft — no isolation.

`OCCASION_HINTS` parallel array holds the context descriptions shown in chip UI.

Migration: `migration/formality_multiselect.sql` — drops old CHECK constraint, converts
`smallint → smallint[]`. Applied 2026-06-26.

**`outfitBucket(o)`:** checks `o.formality_override` first, then derives from
`itemFormality()` averages across pieces. `o._bucket` is a session cache — clear it
(set null) when any piece's formality changes.

**Outfit suggestions:** slot-filling (Top/Dress + Bottom + Shoes + optional Outerwear).
Cardigans slot as "Outerwear" via `suggestSlot(i)`. **Intentionally random within things
that plausibly match — no unworn/rotation bias.** Hard filters: formality cohesion
(`formalityOk`), exclusions. Soft penalties only: 2+ loud colors, 2+ patterned pieces
(`isPatterned`). Soft boost: color-pair + item-pair affinity learned from saved outfits
(`buildSuggestIndexes`, capped). Slots random-sample; softmax (temp 0.8) + diversity-aware
batch selection. Capsule-scoped mode via `openSuggestSheet(null, capsuleId)`. A seeded item
(item-detail shuffle) persists across the batch by design. Suggestion/builder pieces are
tappable to open the item (builder restores in-progress look via `_fromBuilder`).

**Sentinel tags in `items.tags`** (managed via `setItemTag(id, tag, bool)`):
- **`NO_SUGGEST_TAG = "no-suggest"`** — `isNoSuggest(i)`/`setNoSuggest`. Excluded from all suggestions.
- **`LAYER_TAG = "layer"`** — `isLayer(i)`/`setLayer`. A Top flagged as layerable (e.g. a
  button-up) is eligible for the Outerwear/layer slot in `suggestOutfits` as well as the
  Top slot (combos guard against an item being its own layer). Toggle in item detail
  SUGGESTIONS card, shown only when `category === "Tops"`.

**Contexts** — 13 named occasions stamped on wears/outfits (not items). Formality
ranges: Function/garden (1) · WFH (1) · Errands (1–2) · Friends/rehearsal (2) ·
Campus (3) · Conference (3) · Date night (2–4) · Symphony (3–4) · Church (3–4) ·
Shower/holiday party (4) · Funeral (4, dark tones rule) · Wedding guest (4–5) ·
Gala/chorus concert (5, all-black rule).

**Taxonomy** (category → subcategories):
- Tops: Tee shirts, Graphic tees, Long-sleeve tees, Sleeveless, Blouses, Sweaters, Cardigans, Sweatshirts
- Bottoms: Jeans, Pants, Shorts, Skirts, Leggings/Joggers, Tights
- Dresses: Short, Long, Cocktail
- Outerwear: Blazers, Jackets, Coats
- Shoes: Boots, Sandals, Flats, Heels, Sneakers
- Workout: Workout tops, Active shorts, Sports bras

**Color families** (single per item): Green, Teal, Blue, Purple, Maroon, Pink, Red,
Orange, Yellow, Beige, Brown, White, Gray, Black, Metallic.

## Migration

Full reset planned once feature-complete — see `migration/RESET_PLAN.md`.
`migration/` holds throwaway importers (NOT shipped; libraries OK there).
`migration/.env` (gitignored) holds the service-role key + Airtable token.
`schema.sql` (repo root) = canonical target state.

Airtable base "CLOTHING BASE CURRENT" (`appK4hX9DJYTGFGYb`) is the source of truth.
476 items + 3,995 wears + 1,543 outfits imported 2026-06-18.

Migrations are run by the user in the Supabase SQL editor. **Never deploy UI that
writes a new column/table before its migration is confirmed.**

## Conventions

- **`APP_VERSION`** format: `YYYY-MM-DD rN`. New day = `r1`; same day = increment `rN`.
  Currently `2026-07-10 r2`.
- Comment non-obvious logic only — match the surrounding density.
- Fixed product choices live as top-of-script constants (`TAXONOMY`, `COLOR_FAMILIES`,
  `OCCASION_LADDER`, `CONTEXTS`) — change them there.
- All item photos use **`background-size: contain`** everywhere. Never `cover`/`fill`.

## Filtering

**Canonical filter predicates** (single source of truth): `matchesFormality(i, level)`
(numeric 1–8) and `matchesSeason(i, season)` (DERIVED via `itemSeasonSet`; unknown
season = no match). **Status is always read via `itemStatus(i)`** (null → "Available");
an empty status filter excludes Archive (`itemMatchesFilter` default; pickers/builder
pass `{ noStatusDefault: true }` because they have their own status chips). `STATUSES`
no longer includes Wishlist. `inSeason()` (suggestions) is intentionally separate —
unknown = all-season-eligible.

**Unified filter sheet (Phase 2) is SHIPPED**: `openFilterSheet(state, { onApply, title,
dims })` + `itemMatchesFilter(i, state, opts)` / `outfitMatchesFilter(o, state)` drive
Closet, Stats, and Looks. Per-surface dim lists (`CLOSET_FILTER_DIMS` etc., ~line 2869)
and per-surface `newFilterState()` clones (`closetFilter`/`statsFilter`/`looksFilter`).
The standalone Search screen is retired (`openSearch` now opens the closet funnel).
`outfitMatchesFilter` semantics: ALL-pieces for formality/capsule/status, ANY-piece for
the rest (plus outfit-only `liked`, since `itemMatchesFilter` never sees it — see
`FILTER_UNIFICATION.md` Phase 3, now SHIPPED). **Phase 3 (pickers: builder, calendar
+Clothing/+Look, capsule add-items, trip plan picker) is SHIPPED** — every picker uses
the shared `funnelBtnHtml(id, state)` button+badge.

## Known gotchas

- **`localStorage` in restricted contexts**: `data:` URL open throws "Storage is
  disabled". `store` wrapper handles it — never use `localStorage` directly.
- **WebP encode**: `canvas.toBlob(..., 'image/webp')` silently returns PNG on some
  browsers. `compressImage` checks `blob.type === 'image/webp'` and falls back to JPEG.
- **Private photos need signed URLs** — never use a public bucket URL. Batch-sign via
  `POST /storage/v1/object/sign/{bucket}` with `{paths, expiresIn}`; full URL =
  `` `${SUPABASE_URL}/storage/v1${row.signedURL}` ``.
- **Photo bytes are cached locally (Supabase egress guard, added 2026-07-06 r8).**
  Signed URLs change every session so the browser HTTP cache never hits — every session
  used to re-download every photo (triggered a Supabase egress-quota email 2026-07-02).
  `photoUrl(path)` (the ONLY thing `loadPhotoNode` calls now) checks the Cache Storage
  API (`PHOTO_CACHE`, keyed by stable `image_path` via `photoCacheKey`) before any
  network; misses fetch the signed URL once and store the bytes; serves `blob:` URLs
  (`_blobUrlCache` per session, `_photoPending` dedupes concurrent grid renders).
  Eviction: `deletePhoto` → `evictPhotoCache` (photo replace/remove both flow through
  it); `prunePhotoCache()` after `loadData` drops entries no item references. Falls
  back to plain signed URLs where `caches` is unavailable. If photo display ever
  changes, route it through `photoUrl`, never raw `signedUrl`.
- **`prewarmUrlCache()`** — call after `loadData()` fire-and-forget. IntersectionObserver
  finds URLs cached on scroll.
- **`loadPhotoNode` sets `backgroundColor = "transparent"`** — lets white/transparent
  garment PNGs show cleanly on tile backgrounds.
- **GitHub Pages caches hard** — hard-refresh (`Cmd+Shift+R`) after deploy.
- **Status is a lens, not a category** — always change status on the item detail move bar.
- **`closetBack()` priority stack**: `detailView==="details"` → photo view; `_reviewMode`
  → review deal card; `_fromBuilder` → restore builder; `_itemReturn` → origin screen
  (`restoreTab`); `detailId` set → closet grid; `searchResults` → sub → cat → root.
- **Open an item from a non-closet screen via `openItemFrom(id, browseCtx?)`** (never
  bare `switchTab("closet")` + `openItem`) so back returns to the origin, not the
  closet. To make sibling prev/next nav browse the item's category, pass
  `{cat, sub}` as `browseCtx` — NEVER pre-set `closetCat`/`closetSub` at the call
  site: `openItemFrom` snapshots the closet browse state and restores it when the
  return thunk fires (v3 nav-audit fix). Builder `_fromBuilder` path is the exception.
- **Open a look from a non-Looks screen via `openLookFrom(id)`** (never bare
  `switchTab("looks")` + `openLook`) — same rule for looks (`_lookReturn`/`leaveLook`).
- **`looksBack()` checks `lookId` BEFORE `looksSearchQ`** — a look can sit on top of a
  lingering search; back must exit the look first (then `renderLooks()` restores the
  search results). Don't reorder.
- **`closetSub` special values**: `"__other__"` = no recognized subcategory;
  `"__all__"` = flat grid of whole category. Handle both in `categoryGrid()`.
- **`[hidden]` vs CSS specificity**: always include `[hidden] { display: none !important }`
  in global styles or `display:flex` on an ID beats the built-in hidden behavior.
- **Grid bar `position:fixed`** above tab bar. Add `has-gridbar` class to `#app` so
  `.tabbody` gets padding; else the grid's bottom row hides behind the bar.
- **Select mode DOM surgery**: `toggleSelect(id)` updates just the tile + calls
  `updateGridBar()` directly — no full re-render — to avoid photo-URL flicker.
- **Bulk PATCH via PostgREST**: `PATCH /items?id=in.("id1","id2")` — IDs must be
  quoted strings inside `in.()`.
- **`store.getItem` / `store.setItem`** (not `.get/.set`) — mirrors localStorage API.
- **Item photo view**: `detail-photo` class on `#app` hides the tab bar via CSS.
  `#itemBar` (z-index 25, bottom:0) replaces it. Add in `openItem()`; remove in
  `renderCloset()`, `closetBack()` (photo exit), and `switchTab()`.
- **`FIELD_CONFIGS`** maps field key → `{label, type, opts?, filter?}`. Types: `color`,
  `multi`, `single`, `formality`, `text`, `price`, `typeahead`, `date`. Add new fields here
  before wiring in `openItemDetails`. Current fields: name, purchase_date (date), color_family,
  fabric (filter), size, season, brand (typeahead), status, formality, price, url,
  retailer (typeahead), acquisition. Name is tappable in the detail header (rename);
  `saveField` blocks empty name and clears `date_is_guess` when `purchase_date` is set.
  Capsule membership is NOT a `FIELD_CONFIGS` field — it's a join table, edited via
  `openCapsuleAssign`/`saveItemCapsules` (item detail) and `_addState.capsules` (Add form).
- **Field sheet dual-mode**: `_fieldEditItem` = item OR `_addState`; `_fieldOnSave` = null
  (save to DB) or callback fn (Add form). Clear both in `closeFieldSheet()`.
- **Add Item state**: `_addState`, `_addPhotoBlob`, `_addPhotoUrl`. `#moveSheet` reused for
  category with `_addCatMode = true` guard.
- **Formality is 1–8**: `OCCASION_LADDER` has 8 entries (see Design model).
  `itemFormalitySet(i)` is the source of truth (explicit array or imputed);
  `itemFormality(i)` = min of the set, for display/grouping compat.
  Function items (set == [1]) must never mix with non-Function — enforced by `formalityOk(its)`.
- **`openOccasionEdit(itemId, onSaved)`**: single-tap pick (tap again to deselect).
  Always clears all `o._bucket` caches so looks re-derive.
- **Exclusions**: `_excludeSet` is a Set of `"<smaller-id>:<larger-id>"` strings.
  `isExcluded(a,b)` normalizes order before lookup. Loaded in `loadData()`, rebuilt via
  `buildExcludeSet()`.
- **Capsule suggestions**: `openSuggestSheet(null, capsuleId)` scopes the pool to
  `capsuleItems(capsuleId).filter(i => itemStatus(i) === "Available")`. `_suggPool()`
  reads `_sugg.capsuleId` to supply this on every regenerate/level-filter inside the sheet.
- **Calendar day-view logging**: `renderCalendarDay` does `body.onclick = null` to clear
  stale picker delegation. Both `openCalAddClothing` and `openCalAddLook` set `body.onclick`;
  they always terminate via `renderCalendarDay(body)` which clears it.
- **Calendar copy/move**: implemented in the `[data-calact]` handler in `renderCalendarDay`.
  Opens `#logSheet` with a date picker; copy = duplicate rows, move = copy + DELETE originals.
- **Item photo replace**: `replaceItemPhoto` reuses the Add pipeline; new uuid filename
  avoids cache collisions. `removeItemPhoto` nulls `image_path`. No in-app crop/rotate.
- **`layoutCanvasHtml(o, wrapCls)`**: single source for outfit thumbnails everywhere.
  Returns positioned `.ocpiece` divs or `null` (no usable layout). Falls back to grid
  collage on `null`. Pass through for any new outfit-thumbnail surface.
- **Build-a-look canvas**: `builder` global is `null` except on `#tab-builder`.
  `switchTab` clears it + `builder-mode` class. Normalized geometry (center fractions).
  Move/resize/select = DOM surgery only (no re-render). Touch needs `touch-action:none`
  on `.bCanvas` and `.bpiece`. `outfits.layout` write needs `migration/outfit_layout.sql`.
- **Trip weather (Open-Meteo)**: geocoding (`geocoding-api.open-meteo.com`), forecast
  (`api.open-meteo.com`, today−92d→+15d), ERA5 archive (`archive-api.open-meteo.com`).
  Far-future dates use 3-yr historical average (gray "avg" card). `_wxCache` 10-min TTL.
- **`activeCapsuleId`** scopes Closet (`lensItems()` returns only capsule members) AND
  Looks (`looksScopedOutfits()` keeps only wearable looks). Does **not** clear on tab switch.
  Set by `planFromCapsule(id)` — from the capsule detail ("Plan outfits from this") OR from
  the **closet root** "Filter by capsule or trip" button (`openClosetCapsuleFilter`, shown
  when not already scoped). Cleared only by banner ✕ (`[data-cap-clear]`) or deleting the capsule.
- **Capsules: nested-button gotcha** — inner tap targets inside `.gtile` must be `<div>`,
  not `<button>`. Parser hoists nested buttons as siblings; `.gtile .pack-tick` won't match.
- **`capsule_items.packed`**: inserts omit it (pre-migration safe); only `togglePack()`
  PATCHes it. Needs `migration/capsule_items_packed.sql` before using tick feature.
- **`[data-sv]` on stats field pages** must use `:not([data-sf])` to avoid filter chips
  (which carry both attributes) also triggering grid navigation. Same for donut highlight.
- **`statsRebuild()`** handles grid state transitions then calls `renderStats()`.
  `wireStatsToolbar()` wires `#stBack` + `#stFilter` — call at end of every stats render.
- **Stats date range** only affects wear-count lists (most/least worn, never worn).
  CPW uses all-time `wearCount`. `wearCountInRange(itemId)` for range-aware counts.
- **Closet Review inline editing**: `_rvPending` holds the pending value for the current
  card. `renderReviewInline(fieldKey)` returns chip HTML. Resets on every `reviewAfterEdit()`
  or `reviewSkip()`. Category/subcategory fall through to sheet-based editing.
- **`siblingItems()`** derives the current browsing context list (searchResults → sub →
  cat → lensItems) for item prev/next navigation in `openItem()`.

## Back-burner (not in current round)

- Reorder capsules (needs an `order` column)
- Crop/rotate photo editor
- ~~Outfit feedback~~ → hearts scheduled in ROADMAP v2 Wave 3 (👎 still rejected)
- ~~Outfit of the day on Home~~ → scheduled in ROADMAP v2 Wave 7
- Capsule-scoped suggestions improvements: variety seeding, multi-anchor, constraints
- ~~Wear-logging loop overhaul~~ → scheduled in ROADMAP v2 Waves 1+5

**Shipped 2026-06-27 r3:**
- Multi-exclude UI (r4) — `openExcludeSheet` lists every unordered PAIR among the shown pieces as a
  toggle row (`.ex-pair`, `data-expair="<a:b>"`); user ticks the specific clashing pairs (A×B without
  A×C). Already-excluded pairs render locked. Each ticked pair → its own exclusion. NOT subset-pairwise.
- Context typeahead — `renderContextPicker` "+ Add…" input live-filters `contextOptions()` + tap to
  pick/create. `_ctxAddOpen` tracks the expanded state (reset in every picker opener).
- `wears.formality_for` capture — `openPostLogSheet` now also fires after suggestion "Wear today",
  calendar +Clothing (`saveCalClothingLog`), and calendar +Look (`logLookOnDay`).
- Guessed-value indication — `REVIEW_FIELDS` season + formality carry `guess`/`guessLabel`;
  `renderReviewDeal` pre-fills the derived value and shows a `.rv-guess-hint` that clears on edit.
  `date_is_guess` intentionally NOT routed to review (would flood the queue).
- Builder subcat drill + scoped search (Phase 3a) — confirmed already implemented in `builderPickContent`.
- Auto-refresh trip weather — `_wxAutoTimer` re-fetches every `WX_TTL` while a trip detail is open
  (cleared in `renderCapsules` + `switchTab`); manual ↻ button (`[data-wx-refresh]`) in Locations header.

## Deploy

Commit `index.html` → push to `origin/main` → Pages deploys in ~1–2 min. See the
`deploy-wardrobe` skill. Repo: aluke0311/wardrobe_app. Live:
https://aluke0311.github.io/wardrobe_app/

## Local preview

`.claude/launch.json` runs `python3 -m http.server 4173` for the Claude preview
panel (the port is passed explicitly as of 2026-07-09 — it used to default to 8000
while the panel proxied 4173). Auth/data only fully work against the real
`https://` deploy; locally you get the login screen, but the whole script parses
and pure helpers are testable from the console.
