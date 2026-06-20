# ROADMAP — Wardrobe App (execution-ready)

> Single source of truth for what's next. Written so a **fresh session (any model)
> can execute without re-deriving decisions**. Read `CLAUDE.md` (architecture +
> hard constraints) and `schema.sql` (DB) alongside this. Status as of **v17**.

---

## 0. North star & guardrails (locked 2026-06-18)

- **Personal, single-user tool.** No multi-user accounts, social/sharing, or
  monetization. Don't add features that only make sense for many users.
- **Heuristics only — no "true AI", ever (current decision).** Client ships only
  the Supabase **anon** key; **no server proxy / Edge Function**. Rules OUT stylist
  chat, photo auto-tagging / background removal, embedding / semantic search.
  "Smart" = analytics + rules over our own data + **keyless** external data
  (open-meteo for weather). Revisit only if the no-backend stance changes.
- **Thumbnail outfits, no collage canvas.**
- **Data philosophy — derive-first, capture-light.** Compute everything possible
  from data already logged. Add a *captured* field only when (a) it can't be
  derived and (b) a feature being built now uses it. Capture subjective data **at
  the moment of use** (the one-tap wear rating), not as a per-item chore. Prefer
  batch entry (multi-select) and the Fill page for fields across many items.
  → Derive "matches with"/orphans from **outfit co-occurrence** (no manual
  relationship graph). Derive item "trust" from **wear ratings** (no typed field).
- **Hard constraints (from `CLAUDE.md`):** one `index.html`, plain `fetch`, no
  libraries/CDN/`<script src>`, mobile-first, Supabase REST + Storage only.
- **Mobile-first AND usable on web (locked, user feedback 2026-06-19).** Phone is
  the primary surface, but the same `index.html` must be comfortable in a desktop
  browser too — fluid/responsive layout, not a fixed phone-width column. Verify
  both widths when touching layout.

---

## 1. Executor handbook — READ FIRST

### 1a. The ship-a-slice loop
1. **Build** the UI in `index.html` (one file; HTML + CSS + JS inline).
2. **If it needs new DB columns/tables:** add them to `schema.sql` in BOTH places —
   the `create table` (for fresh installs) and an **idempotent migration block**
   (`alter table ... add column if not exists ...`; guard check-constraints with a
   `do $$ ... pg_constraint ... $$`). Then give the user the exact SQL to paste in
   the **Supabase SQL editor** (Dashboard → SQL Editor → Run). **DO NOT COMMIT/DEPLOY
   until the user confirms the migration ran** — a write to a missing column fails
   the *entire* insert/update, so logging a wear / saving an item would break in
   production. Build + present SQL, wait for "done", then deploy.
3. **Bump `APP_VERSION`** (top of `<script>`, ~line 521). Format `YYYY-MM-DD vN`:
   same local day → increment `vN`; new day → today + `v1`. If unsure of the date,
   run `date "+%Y-%m-%d"` (note: the sandbox clock may be UTC; the user is US
   Eastern — the *local* date is what goes in the label).
4. **Verify** (§1b). 5. **Update this file** (mark the slice ✓ + version), then
   **commit + push** (`origin/main` → GitHub Pages auto-deploys in ~1–2 min). Use
   the `deploy-wardrobe` skill or plain git. Commit message ends with the
   `Co-Authored-By:` trailer.

### 1b. Verification (important — the preview is often logged out)
- Start the preview with `preview_start` name **"wardrobe"** (`.claude/launch.json`
  runs `python3 -m http.server 4173`). Use `preview_eval` to drive it.
- **The preview frequently loses its auth session on a dev-server restart, and you
  cannot sign in (no password).** When `document.getElementById('login')` is
  `.active`, verify **client-side with injected fixtures**: assign the lexical
  globals with **bare** names (e.g. `items = [...]; wears = []; dataReady = true;` —
  NOT `window.items`, which creates a different binding), unhide `#app`, call the
  render fn, and drive the DOM. This proves rendering/wiring without the network.
- Always `preview_console_logs` (level `error`) → expect **none**.
- For live **writes** you can't drive (logged out), ship and ask the user for a
  short live check ("log a rated wear and confirm it shows"). The PATCH/POST/DELETE
  paths all reuse the same `rest()` patterns, so risk is low.

### 1c. Code conventions
- **Always `esc()`** user values interpolated into HTML strings.
- **`rest(path, opts)`** = PostgREST over `fetch` (auto-adds keys, refreshes token
  once on 401). **Never send `user_id`** — RLS sets it via `auth.uid()`.
- **Bulk ops:** `items?id=in.(${ids.join(",")})` for batch PATCH/DELETE (UUIDs
  unquoted). Chunk if a selection could be hundreds (URL-length limit).
- **`restAll(path)`** pages past Supabase's 1000-row cap. `loadData` pages `items`
  + `wears`; any new bulk fetch (>1000 possible) MUST use it.
- **Private photos → signed URLs** (`signedUrl`, cached). Lazy-load grids via
  `data-photo` + `hydratePhotos()` (IntersectionObserver).
- **Session/persisted prefs via the `store` wrapper** (localStorage with in-memory
  fallback) — never touch `localStorage` directly. Keys in use:
  `wardrobe.session`, `wardrobe.lens`, `wardrobe.sort`.
- **Match surrounding style;** comment only non-obvious logic.
- **Never put control chars / `` in string literals.** (A NUL sentinel made
  `index.html` register as binary and broke grep/diffs — fixed in v8. Use plain
  ASCII tokens like `"__ALL__"`.)

### 1d. File map (`index.html`, ~2780 lines, all inline)
- **CONFIG consts** (~l.480–640): `SUPABASE_URL/KEY`, `BUCKET`, `APP_VERSION`,
  `TAXONOMY`→`CATEGORIES`, `COLOR_FAMILIES`, `OCCASION_LADDER`, `CONTEXTS`,
  `ACQUISITIONS`, `STATUSES`, `SEASONS`, `AVAILABILITY`, `CARE_METHODS`, `RATINGS`,
  `STORAGE_LOCATIONS`, `FITS`, `LENGTHS`, `RISES`, `CAPSULE_KINDS`, `SORTS`.
- **Fetch helpers:** `authRequest/api/rest/restAll`, `uploadPhoto/deletePhoto/
  signedUrl`, `compressImage`.
- **State:** `items/wears/dataReady`; outfits (`outfits/outfitItems/outfitItemMap/
  outfitsLoaded`); capsules (same shape) + `activeCapsule`; events (`events/
  eventsLoaded/calYear/calMonth/logPresetDate`); closet (`closetQuery/closetStatus/
  drillCat/drillSub/closetCols/closetSort/selectMode/selectedItems`); `logMode`;
  `fillCurrentId`; form (`editingId/pendingPhoto/oldPhotoPath`).
- **Derived:** `wearCount/lastWorn/costPerWear/daysSince/itemStatus/contextsForItem/
  occRangeLabel/money/esc/parseList`.
- **Closet render:** `renderCloset` (branches: lens → search → root folders →
  subcategory folders → leaf grid), `tileHtml/gridHtml/folderRow/sortItems/
  statusScoped/sortSelect/densitySeg/selectBar/wireClosetControls`. The delegated
  `#closetBody` click handler (in `wireEvents`) routes select/status/density/
  folder/back/tile.
- **Item detail + form:** `openItem` (sheet), `buildItemForm/resetItemForm/startEdit/
  readItemForm/submitItem/syncSubcategories/handlePhotoPick`.
- **Log tab:** `buildLogTab/setLogMode`; wear: `buildWearTab/populateWearItems/
  renderRecentWears/submitWear/logWear`; ratings: `ratingControls/wireRating/
  readRating` (reusable, keyed by prefix).
- **Outfits:** `ensureOutfits/renderOutfits/openOutfit/logOutfitWear/deleteOutfit/
  startOutfitBuilder(editId,preIds?)/renderBuilderGrid/saveOutfit`.
- **Capsules:** `ensureCapsules/renderCapsules/openCapsule/deleteCapsule/
  startCapsuleBuilder(editId,preIds?)/renderCapBuilderGrid/saveCapsule`; lens:
  `setLens/activeCapsuleObj/restoreLens`.
- **Batch:** `batchAction/batchStatus/batchCapsule/batchTags/batchDelete`.
- **Fill:** `renderFill/fillFieldEmpty/firstEmptyField/fillPool/fillWidget/fillSave`
  + `FILL_FIELDS/FILL_PROMPT`.
- **Stats (interim — rebuild is Phase C):** `renderStats/section/listRows/bars`.
- **Calendar:** `loadEvents/ensureCalendar/renderCalendar/openDay/openAddEvent`.
- **Tabs/boot:** `TAB_TITLES/switchTab/refreshViews/wireEvents/bootApp/init`.

---

## 2. Current data model delta (live as of 2026-06-19 v4)
Beyond the `schema.sql` baseline, these columns/tables exist in the live DB
(migrations already run by the user):
- **items:** `availability` (Ready|Laundry|Cleaners|Lent, default Ready), `care`
  text[], `needs_repair` bool, `needs_tailoring` bool. *(v7)*
- **wears:** `rating` smallint (3=loved,2=fine,1=didn't-work), `compliments` bool,
  `note` text. *(v8)*
- **items:** `storage_location` text, `fit` text, `length` text, `rise` text,
  `price_original` numeric. *(Phase A slice 8 / v3)*
- **events table** (new): id, user_id, title, event_date date, context, dress_code,
  planned_outfit_id → outfits, backup_outfit_id → outfits, notes, created_at.
  RLS own_rows policy. Index on (user_id, event_date). *(Phase B1 / v4)*

---

## 3. The 7 nav tabs today
`Closet · Log · Capsules · Calendar · Fill · Stats · Settings`. Add lives in the
Closet header (＋). Log = single-item wear **|** outfits (segmented). Phase E
rebalances nav.

## 4. Done so far
3a core ✓ · 3b capsules + lens ✓ · 3c outfits ✓ · **Phase A:** A1 hierarchical
closet + density ✓ (v4) · nav→6 tabs + Fill page + sortable grids ✓ (v5) ·
multi-select + batch ✓ (v6) · laundry/availability + care ✓ (v7) · one-tap wear
ratings ✓ (v8) · **slice 8 fit/storage/price_original fields ✓ (v3 2026-06-19)**.
**Phase A complete.**
**Phase B1 — Calendar ✓ (v4 2026-06-19):** 7th nav tab, month grid heat-shaded by
wear count, today circled, event dots, day detail sheet (wears + events + remove),
"Log wear/outfit for this day" (pre-fills date in Log), Add Event form (title,
date, context, dress code, notes). New state: `events/eventsLoaded/calYear/calMonth/
logPresetDate`. New functions: `loadEvents/ensureCalendar/renderCalendar/openDay/
openAddEvent`. New constants: `STORAGE_LOCATIONS/FITS/LENGTHS/RISES`.
**B1 day-detail refinement ✓ (v10 2026-06-19):** wears grouped by `outfit_id`
in the day sheet; outfit blocks show label + context + rating emoji; lone wears
listed individually; wear notes displayed inline with tap-to-edit "Add/Edit note"
affordance (PATCHes `wears.note`).
**F5 — Item detail enrichment ✓ (v10 2026-06-19):** "Used in N outfits" mosaic
(thumbnails, tap to open outfit); "Wear it with" co-occurrence pairings (top
co-occurring items from outfits, tap to open); "Create outfit with this item"
button (`startOutfitBuilder(null,[id])`); KPI 4 now shows days in wardrobe
(from `purchase_date`); "days since last worn" moved to Details card.
**F2 — Fill page upgrades ✓ (v10 2026-06-19):** Available-only pool; random
field selection across all empty fields; shuffled item order each card.
**F8 — Type-ahead ✓ (v10 2026-06-19):** brand/retailer/size inputs in
Add/Edit form show `<datalist>` of previously-entered values (case-deduped,
sorted).
**D1 — Outfit suggestions ✓ (v8 2026-06-20):** ✨ Outfit ideas button in
Log→Outfit tab. `suggestOutfits(ctx, n)` scores Available items by season,
recency, color harmony (neutrals/adjacent), formality overlap, co-occurrence
bonus; builds top+bottom + dress combos with optional shoe. `openSuggestSheet()`
shows occasion chips (13 contexts), 🔄 Shuffle, "Use this outfit" → builder
with pre-selected ids. State: `suggestCtx`, `suggestSeed` (increments on Shuffle).
**Photo perf + transparency (v9–v11 2026-06-20):** batch-sign (`signedUrlBatch` /
`prewarmUrlCache`) reduces ~476 per-image requests to ~5 on load. Transparent
PNG/WebP garments now show on white tile (`loadPhotoNode` clears `backgroundColor`).
**D2 — Weather integration ✓ (v12–v13 2026-06-20):** `loadWeather()` fetches
open-meteo (no key) using geolocation or ZIP→lat/lon via zippopotam.us. `weatherCache`
`{ temp_f, precip, code }` shown in suggest sheet header; scores nudge ±0.5 for
season/temp match, −2 for Sandals in rain. Settings → Location card: ZIP input
(primary), Auto-detect, Clear. All cached in localStorage with 30-min TTL.
**Worn outfits filter ✓ (v14 2026-06-20):** "Hide singles / Show singles (N)" pill
in Worn view header. `outfitHideSingles` bool filters `wornOutfitMap()` entries
where `ids.length === 1`.
**D4 outfit power tools ✓ (v15 2026-06-20):** Clone outfit (`cloneOutfit`), Add to
capsule from outfit detail (inline select + Add), Merge duplicate outfits
(`mergeOutfitDuplicates` — groups by sorted item-set, keeps earliest, repoints wears,
deletes dupes; "Merge dupes" button in Saved outfits header). `openOutfit` sheet now
shows Duplicate + Add to capsule actions alongside Edit/Delete.
**F3 — Rating in outfit builder ✓ (v15 2026-06-20):** `ratingControls("b")` added to
the new-outfit builder form (hidden for edit mode); `wireRating("b")` called on open;
`saveOutfit(true)` passes `readRating("b")` opts to `logOutfitWear`.
**Quick re-wear in Log → Outfit ✓ (v16 2026-06-20):** `renderQuickRewear()` renders
the top 6 most-recently-worn multi-item outfit combos (from `wornOutfitMap()`) at the
top of the Outfit log tab. Each card shows thumbnails + "worn N× · last DATE" + an
inline date picker + "Log" button. Logging creates individual wear rows (no
`outfit_id`); refreshes on success. Saves navigating into the library for everyday
re-wears. `#quickRewearSection` div inserted above `#outfitsBody` in `#logOutfitPanel`;
rendered in `setLogMode("outfit")` path alongside `ensureOutfits()`.

**v17 (2026-06-20):** F8 type-ahead for fill_size + fill_fabric (shared dl_size datalist;
new dl_fabric populated from text[] fabric arrays via `fillDlArray`). F9 "By Context"
third view in Outfits tab — folders derived from `outfits.context`, drill into outfit list,
no schema change; `outfitContextBrowse` state. "Style This Orphan" card in Log → Outfit —
finds Available items with 0 outfit appearances, shows one randomly, "Build an outfit around
this" + Skip; `renderOrphanCard()` called after `ensureOutfits()` resolves. Strict weather
hard-filter in `suggestOutfits` — `isCold` (temp_f < 50) removes Sandals + Shorts from
pool entirely; `isRainy` (precip > 0.1) removes Sandals (previously only soft-scored ±0.5).
Batch Season + Color — two new buttons in multi-select bar; `batchSeason()` opens chip sheet
(additive merge); `batchColor()` opens swatch sheet (sets color_family). New(90d) closet
filter chip — "New (90d)" chip in root filterbar; `applyFacets` now actually wired into
`renderCloset` via `applyFacets(applyNeglect(statusScoped()))` (was dead code before);
chip clear wired in `wireClosetControls` via `#closetFilterChips`.

---

## 5. Plan (per-slice, execution-ready)

### Phase A · slice 8 — Optional fields  ✓ *done 2026-06-19 v3*
**Decisions.** Add fit/storage/acquisition-detail fields, all optional, single-
select from fixed lists, surfaced in the Add/Edit form + Fill page.
**New consts:**
```
const STORAGE_LOCATIONS = ["Closet","Dresser","Under-bed","Coat closet","Attic","Storage bin","Suitcase"];
const FITS = ["Tight","Fitted","Relaxed","Oversized"];
const LENGTHS = ["Cropped","Regular","Long"];
const RISES = ["Low","Mid","High"];
```
**Migration (give user to run; also add to `schema.sql` items create + alter block):**
```sql
alter table items
  add column if not exists storage_location text,
  add column if not exists fit              text,
  add column if not exists length           text,
  add column if not exists rise             text,
  add column if not exists price_original   numeric;
```
**UI.** Add/Edit form: a new **"Fit & storage"** section (segmented `fit`,
`length`, `rise`; segmented or select `storage_location`). Put `price_original`
in the existing Purchase section next to `price` (label "Retail price"). Wire in
`buildItemForm/resetItemForm/startEdit/readItemForm` exactly like the upkeep
fields (slice 6 is the template). Detail sheet: show them in the Details card
(only when set). **Fill:** add `storage_location, fit, length, rise` to
`FILL_FIELDS` (after `care`) with prompts + single-select chip widgets + `fillSave`
cases (mirror the `subcategory`/`acquisition` single-select pattern). `price_original`
is NOT a Fill target. *Optional refinement:* only ask `rise` for Bottoms and
`length` for Tops/Dresses/Outerwear (gate in `fillFieldEmpty`); fine to ask all.
**Verify** client-side (fixtures) + ask user for a live save check. Discount % is
**derived** later (`1 - price/price_original`), not stored.

---

### Phase B — Planning
General: each sub-slice that needs DB changes follows the migration dance. Add an
RLS `own_rows` policy for any new table (copy the pattern in `schema.sql`).

**B1 — Calendar.** ✓ *done 2026-06-19 v4.* See §4 for what's built.
*Refinement (user feedback 2026-06-19; reference: Stylebook "Day View" 2026-06-19):*
the day-detail sheet (`openDay`) should **group that day's wears by `outfit_id`** —
render an outfit block (its thumbnails together) where wears share an outfit, and only
list loose items individually for wears with no `outfit_id`. Today it lists every item
flat with no grouping. *Also:* surface the per-wear/per-outfit **note** inline on each
day block ("Tap to add notes" → writes `wears.note`, which already exists), so the day
view doubles as the outfit diary; keep the "+ wear / + outfit for this day" add path.
New table:
```sql
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  title text,
  event_date date not null,
  context text,                                   -- one of CONTEXTS
  dress_code text,
  planned_outfit_id uuid references outfits(id) on delete set null,
  backup_outfit_id  uuid references outfits(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
-- + RLS own_rows policy; index on (user_id, event_date)
```
UI: month grid (7 cols, prev/next month). Each day cell: heat-shade by that day's
wear count (`wears` grouped by `worn_on`), small marker if events exist. Tap a day →
sheet: list that day's wears (item thumbnails, ratings) + events; buttons "Log a
wear/outfit for this day" (reuse the Log flows with the date preset) and "Add
event". Load events lazily (`loadEvents`, no paging needed). The "outfit diary" /
heat-map fall out of this + ratings.

**B2 — Capsule polish. ✓ 2026-06-19 v6 (partial — destination image + reorder deferred)**
Migration (run in Supabase SQL editor — needed for packing checklist):
```sql
alter table capsule_items add column if not exists packed boolean not null default false;
alter table capsules
  add column if not exists image_path text,
  add column if not exists sort_order int;
```
- **Packing checklist ✓** — `openCapsule` renders items with Pack/✓ buttons; toggle
  PATCHes `capsule_items`; shows "X/Y packed" count. (Needs migration above to work.)
- **Add-an-outfit-to-capsule ✓** — `startCapsuleBuilder` has an outfit picker dropdown
  + "Add items" button that unions the outfit's item IDs into `capSel`.
- Destination image — deferred.
- Reorder — deferred (lowest priority).

**B3 — Wishlist + decision support. ✓ 2026-06-19 v6**
Migration (run in Supabase SQL editor):
```sql
alter table items drop constraint if exists items_status_check;
alter table items add constraint items_status_check
  check (status in ('Available','Storage','Archive','Wishlist'));
```
- `"Wishlist"` added to `STATUSES`; appears in closet status switcher and item status seg. ✓
- Excluded from `fillPool`, capsule builder pool (Wishlist items not owned). ✓
  (`populateWearItems`, outfit builder already Available-only — no change needed.)
- **Purchase-justification card ✓** — shown in `openItem` when status=Wishlist:
  projected CPW (price ÷ est. wears, heuristic: subcategory/category median wears/yr
  × 3yr life; falls back to 12/yr), price, similar-owned count, days waiting (⚠️ at 30d).
- **One-in-one-out ✓** — confirm prompt when converting Wishlist→Available if the user
  owns same-category items.
- "Log a wear today" hidden for Wishlist items. ✓

**B4 — Rotation mode. ✓ 2026-06-19 v6**
"Neglected" toggle in the closet filterbar: hides items worn in the last 30 days,
forces sort to "Longest unworn". Pure client filter; no schema.

---

### Phase C — Closet Health / Insights  *(the centerpiece; rebuilds `Stats`→`Insights`)*
All **derived** (no schema) except where it reads slice-7 ratings. Reuse
`listRows/bars`; add KPI cards.

**UI pattern (reference: Stylebook "Style Stats" — user-provided 2026-06-19).** The
screen is a stack of **grouped stat cards**, each = an icon/title header + two
headline KPI columns + a list of tappable **drill-down rows** (every row → a
filtered item/outfit list, ties into the locked drill-down filters below):
- **Looks Stats** — KPIs: Outfit Count · Avg items per look. Rows: *Not logged on
  calendar* · *Worn history* · *Most packed*.
- **Clothing Stats** — KPIs: Item Count · Total Closet Value. A **color
  distribution bar** under the KPIs. Rows: *Most recently added* · *Never used in
  an outfit* · *Not logged on calendar* · *Worn history (most & least worn)* ·
  *Cost per wear (best & worst CPW)* · *Purchase price (most & least expensive)* ·
  *Most packed*. Footer caption: "Total Closet Value and Item Count do not include
  archived items" (matches the Available-only scope rule below).
- **View Closet By… (donut)** — a **donut chart** segmenting the closet by a chosen
  field with the lead segment labeled (e.g. "Brand · 18.1% Old Navy", "Size · 37.7%
  S"; ▲▼ steps the highlighted segment), and a tappable field list under it: Color ·
  Status · Price · Fabric · Size · Season · Brand. Each opens the closet
  grouped/filtered by that field. This is the visual home for the **Distributions** +
  **drill-down** items below. *Refinements (reference: Stylebook Brand/Size donuts,
  user-provided 2026-06-19):* always include a **"No value" bucket** for items missing
  that field (it doubles as a fill-gap entry point → tapping it opens those items, a
  natural hand-off to the Fill flow), and offer a **Sort by Name / Sort by Count**
  toggle on the row list. Optional **per-row density** (2–5 cols) on any resulting
  thumbnail grid, like the closet.
- **Size Tracker** — see backlog item in §5 (small captured-data feature).

Definitions to implement (locked):
- **Scope (locked, user feedback 2026-06-19):** every Insights stat counts
  **Available items only** — exclude `status` Storage / Archive (and Wishlist).
  Make this a single shared pool helper so all KPIs/distributions use it.
- **CPW $0 rule (locked, user feedback 2026-06-19):** **exclude items with
  `price` 0 / null** from all CPW math — they're not "free", just unpriced. This
  applies to CPW now, projected CPW, "best value" (lowest CPW), and best
  purchases. A $0 item should never win or skew a CPW ranking.
- **Drill-down filters (locked, user feedback 2026-06-19):** stats are
  **clickable into a filtered list** — tapping a KPI/row opens the closet (or an
  Insights detail view) scoped to that slice, with time + category facets. Target
  examples: *CPW in the past year*, *CPW for Tops only*, *most worn in the past
  month*. Implement a small filter spec (field + range + window) that both the KPI
  computation and the resulting list share, so the number and the drilled list
  always agree. **Time-window options (pin, reference: Stylebook "Range" sheet
  2026-06-19):** All time · Last 7 / 14 / 30 / 90 days · Last 6 months · Last year.
  The drilled list is a thumbnail grid with the metric printed under each tile (CPW
  grid shows `$x.xx`) and a **Best / Worst** order toggle (reference: Stylebook CPW
  screen).
- **Recency states** by `daysSince(lastWorn)`: active <30 · cooling 30–120 ·
  dormant 120–365 · unworn >365 · never (no wears).
- **Wear velocity** = wears in last 90 days. **Repeat cadence** = avg days between
  wears.
- **Utilization** = distinct items worn in last 365d ÷ Available count.
- **CPW now** = `price/wearCount`; **projected CPW** = `price / (wearCount *
  365/daysOwned)` where daysOwned from `purchase_date`.
- **Distributions:** counts by category / color_family / formality (bucket by
  `min_occasion`..`max_occasion`) / season. **Closet value** = Σ price (Available),
  replacement vs `price_original`.
- **Coverage matrix:** for each `CONTEXTS` entry, count Available items eligible
  (reuse `contextsForItem` overlap). Surfaces gaps (e.g. "Wedding guest: 3").
- **Outfit potential:** rough combination counts per formality (tops×bottoms, +
  dresses).
- **Orphans & declutter:** items in 0 outfits (`outfitItemMap`), worn once, never
  worn; declutter pipeline via `status` (keep/Storage/Archive); a needs-repair queue
  (`needs_repair`).
- **Personal analytics (need ratings):** most-trusted = avg wear `rating` desc;
  best purchases = wears/$ desc; regret = low wears + high price.
- **Smart collections / saved searches:** rule-based filter presets (e.g. "needs
  repair", "never worn", "Summer + rating≥2"). Could persist presets in `store`.
- **Timeline & heat map:** purchases by year (`purchase_date`); calendar usage heat
  map (shares B1).
- **Airtable parity (TODO):** reproduce the user's **Goal CPW / Total Score / Action
  Needed** logic. The executor should ask the user for those Airtable field formulas
  (base "CLOTHING BASE CURRENT" `appK4hX9DJYTGFGYb`; an Airtable MCP is available) and
  implement them — don't guess the formulas.

---

### Phase D — Heuristic styling
- **D1 outfit suggestions:** pick Available items forming a look (top+bottom or
  dress, + shoes/layers), score = context occasion-overlap + current-season match +
  color harmony (neutral/analogous via `COLOR_FAMILIES` order) − recency penalty
  (worn recently). Return top N.
- **D2 weather + calendar daily pick: ✓ done v12–v13** — `loadWeather` + `weatherCache`; see §4. Still to connect: wire into Home dashboard (Phase E) for the daily pick / week strip context. **open-meteo, no key** —
  `GET https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,precipitation,weather_code`.
  Location via `navigator.geolocation`, fallback lat/lon saved in Settings
  (`store` key `wardrobe.geo`). Map temp/precip → season/formality nudge for D1.
- **D3 capsule/packing auto-generation:** given a trip's dates + destination weather,
  pick a minimal set of mix-and-match Available items covering the trip's contexts.
- **D4 outfit power tools (legacy 3f):**
  - **Merge duplicates:** group `outfits` by the order-independent key
    `JSON.stringify([...outfitItemMap.get(id)].sort())`; per group >1 keep the
    earliest `created_at`, repoint each dupe's `wears.outfit_id` to the keeper, delete
    dupes' `outfit_items` + the dupe rows. In-app "Merge duplicate outfits" action
    (and/or a `migration/` script). The ~1,543 import rows include many dupes.
  - **Clone:** copy an outfit + its `outfit_items` with a fresh `created_at`.
  - **One-tap re-wear** (log an existing outfit for today) + **Outfit Shuffle**
    (random Available combos).
  - **Outfit action menu (reference: Indyx 2026-06-19):** tapping an outfit opens a
    quick-action sheet — Edit · Outfit Details · **Duplicate** · Selfies · **Add to
    Calendar** · **Add to Collection (capsule)** · Delete. Good template for the
    outfit detail actions (ties Duplicate→Clone, Add to Calendar→B1, Add to
    Collection→B2 capsules).

---

### Phase E — Home dashboard + nav rebalance  *(last)*
Add a **Home** landing tab (dashboard). Target nav (~6): `Home · Closet · Log ·
Calendar · Capsules · Insights` (Stats→Insights; Fill + Settings reachable from
Home/a menu). Home cards: today's weather (D2), suggested capsule, recently worn,
neglected pieces, in-laundry items, upcoming events (B1), quick log-wear, continue
packing, closet-health score (C). Built last so it has real content to surface.

**UI pattern (reference: ALTA home — user-provided 2026-06-19):**
- **Week strip** across the top: Sun–Sat with date numbers, today underlined; each
  day shows a silhouette/thumbnail of that day's planned or logged outfit (empty =
  faded silhouette). Tapping a day → that day's calendar detail (B1). Two buttons
  under it: **Add Look** and **Plan Event**.
- **Greeting + weather** row: "Good afternoon, {name}" + current temp / hi-lo /
  condition icon (D2 open-meteo).
- **Today's suggestions**: a labeled, paged carousel ("Home casual" + cadence tag
  like "Every day", `1/3`) of suggested outfits (item thumbnails grouped) for
  today's context/weather (D1). Swipe through alternatives.

### Journal (threads through B/C — not its own slice)
Outfit diary = wear `note` + `rating` + weather surfaced as a timeline (B1 + C7);
"style discoveries" = a searchable notes list.

---

### Phase F — Post-build polish (user feedback 2026-06-19)
Small, mostly client-only refinements to ship after the core phases are in. Each
is independent; do as one-off slices.

- **F1 — Card images "fit" not "fill" (quick).** Closet/outfit/capsule card
  thumbnails currently crop (`object-fit: cover`). Switch to `object-fit:
  contain` so the whole garment shows. Audit every card `img` rule; keep a fixed
  cell box (letterbox the contained image) so the grid stays even.
- **F2 — Fill page upgrades.** Three asks: (a) **Available-only pool** — `fillPool`
  must exclude Storage/Archive (and Wishlist), only `status='Available'`. (b)
  **More randomized item order** — shuffle the candidate items, don't serve them in
  a stable/category order. (c) **Random field, not just occasion** — today Fill
  leads with occasion; instead pick *any* empty open field for the shown item at
  random across `FILL_FIELDS` (occasion, color_family, fabric, season, fit, etc.),
  so each card prompts a different gap. Keep single-tap chip saves.
- **F3 — Rating in outfit builder ✓ v15** — done; see §4.
- **F3b — Quick re-wear in Log → Outfit ✓ v16** — done; see §4. *(Was implicit in F3 spirit.)*
- **F3 (original spec, for reference) — Outfit builder "I liked it" affordance.** In the outfit create/edit flow
  the "liked"/rating control is hard to find. Surface a clear like/rating toggle
  inline in the builder near Save (and on "Save & log as worn"), so the user can
  mark a fresh outfit as liked during creation, not only after. *Reference: Indyx
  treats **Favorite** as a first-class, filterable flag (a facet in the filter
  sheet).* Consider a simple persistent `favorite` boolean on items **and** outfits
  (cheap, filterable in F6), distinct from the per-wear `rating` (which is
  moment-of-use). Confirm whether you want both, or just the favorite flag.
- **F4 — Rethink categorization (bigger; design first).** Today `TAXONOMY`
  (category→subcategory) is a fixed top-of-script constant. The user wants to
  **change categories and add their own**. **Reference models seen 2026-06-19:**
  - **Stylebook "Edit Folders" (what the user wants):** categories are
    user-editable **folders** — add (`+ Folder`), rename (tap), delete (−), and
    drag-reorder, each showing a live item count. Tapping a folder opens its
    **subcategory** editor (same add/rename/delete/reorder, with counts). So a
    fully user-owned 2-level taxonomy. *(Note: Stylebook also models Archive /
    Storage / Pack / Workout as folders — we should NOT copy that; we already have
    a `status` field, keep status orthogonal to category.)*
  - **Indyx (the other approach):** a **fixed** top-level category list (Top,
    Bottom, Outerwear, One Piece, Bag, Shoes, Accessory, Jewelry, Swim, Other) and
    leans on rich multi-facet filters instead of custom categories.
  - **Recommendation:** go the Stylebook route since the ask is explicitly
    user-editable categories. Move taxonomy into RLS-scoped `categories` +
    `subcategories` tables (id, user_id, name, sort_order, parent), seed from the
    current `TAXONOMY`, and build a "Manage categories" UI in Settings mirroring
    Edit Folders. Items keep `category`/`subcategory` as text (or FK). **Decide:**
    rename = update in place; on delete, prompt to reassign affected items (don't
    orphan the 476). This breaks the "fixed choices live as constants" convention —
    confirm before building. **Do not start without a decision.**
- **F5 — Item-detail enrichment (references: Stylebook + Indyx item sheet,
  user-provided 2026-06-19).** All **pure-derive, no schema** — bundle these onto the
  item detail sheet (`openItem`):
  - **"Used in N outfits" mosaic** — tappable row, outfit count + a small thumbnail
    **mosaic** of those outfits (from `outfitItemMap`), opens the filtered outfit list.
  - **"Wear it with" pairings** — top co-occurring items derived from outfit
    co-occurrence (count items sharing an `outfit_id`/wear-day with this one, rank by
    frequency, show 2–4 thumbnails → tap to open). This is the concrete surface for
    the north-star "derive matches-with from co-occurrence" (no manual pairing graph).
  - **"Create outfit from this item"** button → `startOutfitBuilder(null,[id])`
    (preIds is already supported — near-free wiring). Build a look around the piece
    you're viewing.
  - **Elevate $/wear to a headline** on the sheet (Indyx puts `$x.xx / WEAR` at the
    top), and show **days-owned** ("In wardrobe: N days" from `purchase_date`) +
    outfits-made alongside the existing "Worn N days / last worn". Respect the CPW $0
    rule (don't show a CPW headline for unpriced items).
- **F6 — Closet grid header + filter/sort polish (reference: Indyx).** Tighten the
  closet toolbar: sort label + live item count, search, a filter button with an
  **active-filter count badge**, a **Select** (multi-select) toggle, and a two-row
  chip filter — **category chips** with a **subcategory chip row** under the chosen
  category. Optional **time-range tabs** (1M/6M/1Y/ALL). The Indyx **filter sheet**
  is the reference for a full-screen filter: facet groups = Category · Season ·
  Color (swatch grid) · Visibility (Private/Favorite/Archive/Sold-Donated/Do-not-
  style ≈ our `status` + a favorite flag) · Source (Purchase/Gift/Self-made ≈ our
  `acquisition`) · Secondhand · Location (≈ `storage_location`); a sticky "Clear" +
  "Apply Filter". Indyx **sort** options to mirror: Created newest/oldest, Purchased
  newest/oldest, Cost/Wear high/low, Most/Least worn, Category, Custom. Mostly
  re-dressing existing fields; confirm which controls already exist before building.
- **F8 — Type-ahead "previously entered" for free-text fields (reference: Stylebook
  Size entry 2026-06-19).** When entering a free-text field (`size`, `brand`,
  `retailer`), show a **"Previously entered"** suggestion list derived from the
  distinct existing values across `items`, filtered by what's typed. Pure client
  (compute from the loaded `items` array), no schema. Big mobile-typing win and it
  keeps values consistent (avoids "Old navy" vs "Old Navy" drift — consider a
  case-insensitive de-dupe in the suggestion list). Low effort; do alongside F6.
- **F9 — Browse outfits by context (reference: Stylebook "Outfit Tags" grid
  2026-06-19) — DECISION REQUIRED, don't build blind.** Stylebook shows a grid of
  free-text outfit tags each with a count (Casual 47, Out & About 104, Home 45,
  Travel 37, Symphony 5, Wedding 2, Spring/Summer/Fall/Winter…). **Do not copy this
  as a new free-text tag table.** Those "tags" are really a *mix of dimensions we
  already model:* occasion → our `context`; Spring/Summer/etc → derivable from item
  `season`; Travel / place names (Emory) → a **capsule**. A parallel free-tag system
  would fragment the same data three ways. **Recommendation:** build the *view* (a
  grid of contexts with outfit counts → tap a context to browse its outfits) on top of
  the **existing `outfits.context`** — zero schema, gives the same browse affordance.
  Only add a real `outfits.tags text[]` if the user, after seeing that, still wants
  arbitrary labels that don't map to context/season/capsule. **Confirm with the user
  before building; default to the no-schema context-browse view.**
- **F7 — Size Tracker (small new captured-data feature; reference: Stylebook).** A
  Settings/Insights page holding the user's own measurements + per-brand/category
  sizes (e.g. "Old Navy top = M"). This is *captured*, not derived, so it's a
  deliberate exception to derive-first — keep it tiny and optional. Likely a single
  `profile`/`sizes` row or a small `sizes` table (RLS-scoped). Confirm scope before
  building.

---

## 6. Planned data reset (Airtable re-import)

Once the app is feature-complete (or close to it), do a **full wipe and re-import
from a cleaned-up Airtable base.** Current data is pilot/provisional — the reset
gives a clean slate with properly enriched fields and better photos.

**Full plan:** `migration/RESET_PLAN.md` — read that first. Summary:

1. **Update Airtable schema** — add columns for all new fields: `Color Family`
   (single select), `Min Occasion` / `Max Occasion` (1–7, new scale directly),
   `Acquisition`, `Size`, `Fabric` (multi-select), `Season` (multi-select),
   `Status` (Available/Storage/Archive), `Subcategory` (taxonomy values).
2. **Bulk-fill data in Airtable** — fill in the enriched fields across all ~476 items.
3. **Replace photos** — swap `Picture` attachments in Airtable with better shots;
   the import script downloads and re-hosts them automatically.
4. **Wipe Supabase** — `DELETE FROM outfit_items; capsule_items; wears; outfits; capsules; items;`
   then wipe the `wardrobe` Storage bucket.
5. **Update `migration/import.py`** — remove the `+1` occasion offset (`remap_occ`
   currently shifts old 1-6 → 1-7; with new Airtable values on 1-7, just clamp).
6. **Re-run:** `import.py --live` → `import_wears.py --live` → `import_outfits.py --live`.

---

## 8. Brainstorm — potential future features

Ideas assessed against the hard constraints (single file, plain fetch, heuristics only, derive-first/capture-light, mobile-first). Organized by readiness, not category.

---

### Tier 1 — Strong fit, low complexity, high value (scope into next slices)

**Laundry pop-up on boot.**
`bootApp` checks: is this a new calendar day (compare stored last-open date with today)? If yes, fetch yesterday's `wears` and cross-reference `items.availability`. Any item still `Ready` that was worn yesterday → dismissible toast: "You logged 4 items yesterday. Move them to laundry?" One-tap bulk PATCH sets `availability='Laundry'`. Entirely client-side. Store last-open date in `wardrobe.lastOpen`. No schema.
*Care routing:* if any of those items have `care` containing `"Dry clean"`, the pop-up routes them to `'Cleaners'` rather than `'Laundry'`.

**"Mark all clean" action in laundry filter.**
When closet is filtered to `availability=Laundry`, surface a sticky action bar button "Mark all clean" → batch PATCH to `Ready`. Already has the batch infrastructure. One-liner feature with real daily value.

**One-Tap Unpack for Capsules.**
`openCapsule` gets an "Unpack" action alongside "Pack". Prompts: *"Return to closet (Ready)"* or *"Send to Laundry"*. Fires a batch PATCH on all the capsule's items. Closes the loop on the packing checklist (B2) with a natural end-of-trip flow.

**Batch attribute editing.**
Upgrade the multi-select action bar to include `Season`, `Color Family`, `Care`, and `Availability` as batch-editable fields, not just status/tags/capsule/delete. Add an `openBatchEditSheet()` that renders chip selectors for these fields. Saves massive amounts of time during the upcoming Airtable data reset. Reuses the `items?id=in.(...)` PATCH pattern.

**Strict weather hard-filter in Shuffle.**
Currently D1 soft-scores weather (±0.5). During Shuffle (`🔄`), hard-filter the candidate pool to remove items that actively conflict with `weatherCache`: temp < 50°F → remove Sandals and Shorts from pool; `precip > 0` → remove Sandals entirely. Every shuffled result is actually wearable that day. Simple change to `suggestOutfits` when called from Shuffle.

**"Style This Orphan" on Home / Log.**
`outfitItemMap` already reveals items in 0 outfits. Surface one random orphan item on the Home dashboard (Phase E) or as a persistent card in Log → Outfit with "Build an outfit around this" → `startOutfitBuilder(null, [id])`. Pure derive; no schema. High leverage for under-used items.

**Recently Purchased filter.**
Add a "New (90d)" chip to the closet filter bar. Client-only: filters `items` where `purchase_date >= today - 90`. Useful during the reset period when many items are freshly added/re-tagged.

**Seasonal Rotation Wizard.**
Once per season transition (detectable by month or a "Review winter items" button in Settings), show a modal: "These 6 winter items were not worn last winter — archive, storage, or keep?" Lists them with wear count + last worn. Bulk action buttons apply status. Pure derive from `wears` + `season` + `purchase_date`. High ROI per tap.

**Outfit Repeat Tracking surface.**
Already fully derivable from `wornOutfitMap()`. Surface it explicitly in the outfit detail sheet (`openOutfit`): "Last worn: 38 days ago · Worn 7× this year · Last context: Campus." Currently those stats don't appear in the outfit view. No schema, no new data.

---

### Tier 2 — Good ideas, moderate effort or needs a decision first

**Weekly Outfit Planning view.**
A 7-day strip showing planned/logged outfits for Mon–Sun. Tap a day → log or assign an outfit. Days with `events` show the event title. Very close to Phase E's Home week strip — implement together, not separately. *Decision before building:* does planning live on Home, or does Calendar get a week-view mode? Don't build both.

**Outfit Queue.**
A short "wear next" list — outfits you've pre-built and marked to wear soon. Could piggyback on `events.planned_outfit_id` (already exists) rather than a new table: add an "unscheduled / wear soon" event type with no date. Avoids schema addition. *Confirm approach before building.*

**Gap Analysis (actionable context coverage).**
Phase C already plans a coverage matrix (contexts × eligible items). Extend it with the specific framing: *"Professional: only 2 summer-appropriate tops. Wedding guest: 3 eligible items."* Flag gaps where eligible item count < threshold (e.g. < 4) and link to a filtered closet + Wishlist add. Pure derive from `contextsForItem` + `season`.

**CPW Projection.**
Alongside the current CPW (`price / wearCount`), show *projected* CPW: `price / (wearCount * 365 / daysOwned)`. Makes newer purchases feel less alarming. "At your current pace: $12.50/wear after 1 year." Pure math, no schema. Respect the CPW $0 rule.

**Utilization Heatmap by category.**
A table in Insights: `| Category | Items | Worn this year | % |`. One row per category from `TAXONOMY`, derived from `wears` filtered to `worn_on >= today - 365`. Instantly surfaces dead categories (e.g. Heels: 18%). Very fast to build; slots naturally into Phase C.

**Closet Aging metrics.**
`purchase_date` is already on items. Derive: average item age in years (Available items), % of closet added in the last 12 months, oldest regularly-worn item (most wears among items > 5 years old). Fun, zero schema, add to Insights.

**Packing Optimizer (Capsule coverage analysis).**
When viewing a Capsule, show a coverage card: "18 possible outfits · Missing: no rain jacket · Overpacked: 5 black cardigans." Derives possible-outfit count from top×bottom combinations in the capsule. "Missing" = context required by trip events with no eligible capsule item. "Overpacked" = more than 2 items of the same subcategory. Phase D3 auto-gen can build on this.

**Year in Wardrobe recap.**
Available from the Stats/Insights tab (not a December-only feature — scope to a trailing 365d window). Cards: wears logged · unique items worn · new outfits created · best purchase (lowest CPW, priced items) · most worn item · most neglected. Pure derive. Keep it personal — no export/share (violates no-social stance).

**Milestone items.**
A simple `milestone bool` on items (or a reserved tag `"Memory item"`). Tag: "Dissertation defense dress, worn to 9 meaningful events." Using a tag avoids schema. Surfaces on item detail as a "milestone" badge. Tiny captured-data exception to derive-first — keep it optional and single-tap.

**Purchase Success Score.**
Composite rank of items by value delivered: weight `wearCount / price` (per-dollar wears) × avg wear `rating` (where rated). Filters to priced + rated items. Useful for future shopping decisions. Needs ratings to be well-populated first — build after the Airtable reset when data is richer.

---

### Tier 3 — Lower priority / waiting on dependencies

**CPW Goal Celebrations.**
A visual indicator (gold accent or label change) when an item's CPW crosses from "above goal" to "at or below goal." Depends on the Airtable Goal CPW / Total Score formulas (pending — see Phase C). Build this after those formulas are implemented.

**Item Timeline.**
Chronological view within item detail: Purchased → First wear → Outfit appearances by date. Most of the raw material is in F5 already (outfit mosaic, wear count, days owned). A true timeline scroll is a visual layer on top — nice polish for high-sentimental items.

**"Wear Soon" / "Waiting for" micro-states.**
Lightweight status annotations below `availability`: "Wear soon" (want to use this week) and "Waiting for" (tailoring / season / occasion). Could be a reserved tag rather than a new column. Useful but low urgency vs the laundry/repair tracking already in place.

**Outfit Rotation Score.**
Insights card: "45 outfits never worn · 18 not worn in 6 months · top 20 outfits = 60% of wears." Derive from `outfits` vs `wornOutfitMap()`. Good Phase C addition once the Insights tab is more built out.

---

### Already covered by existing phases (don't re-derive)

| Idea | Where it lives |
|---|---|
| "What to Wear Today" filter view | D1 outfit suggestions (done v8) |
| Random outfit / Shuffle | D1 🔄 Shuffle button (done v8) |
| Laundry Basket view | Closet filter `availability=Laundry` (done v7) |
| "I Need Inspiration" (item → pairings) | F5 item detail "Wear it with" (done v10) |
| Orphan items list | Phase C orphans & declutter (planned) |
| Repair Dashboard / queue | Phase C, `needs_repair` field exists |
| Home dashboard + week strip | Phase E (planned last) |
| Smart Collections / saved searches | Phase C (planned) |
| Browse outfits by context | F9 (planned, decision required) |
| Size Tracker | F7 (planned) |
| User-editable categories | F4 (planned, decision required) |
| Advanced filter sheet | F6 (planned) |

---

### Not doing from this batch (rationale)

- **Shareable "Year in Wardrobe" infographic** — the recap itself is fine; the share/export framing is social-adjacent. Build the view for personal use only.
- **Drag-drop weekly outfit planning** — drag on mobile is painful. Tap-to-assign is the right interaction.
- **"Mood" per-item tag** — already rejected (per §7; subjective per-item chore, against capture-light).
- **Social-adjacent features** (lookbooks, selfies, followers, avatar) — already rejected (§7).

---

## 7. Explicitly NOT doing (by decision)
AI auto-tagging / bg-removal · stylist chat · semantic/embedding search · server
proxy / Edge Functions · outfit collage canvas · social sharing · multi-user /
accounts / monetization · built-in shopping/retailer browser · editorial content ·
hand-maintained item relationship graph (derive pairings) · per-item typed
comfort/confidence (derive from ratings).

**Reviewed-and-rejected from reference screenshots (IMG_0838–0857, 2026-06-19) —
recorded so they don't get re-proposed:**
- **Per-item condition / "State" (New/Used)** and **Resale value** (Indyx) — only
  meaningful for reselling, which this app doesn't do; no consuming feature →
  violates derive-first/capture-light. (If a *sell* declutter path ever lands,
  resale value could attach there — not before.)
- **"Mood" per-item styling tag** (Indyx) — subjective per-item chore, against
  capture-light. Subjective signal is captured at moment-of-use via the wear `rating`.
- **Manual usage +/- stepper** on item stats (Indyx "Scheduled/Unscheduled") — breaks
  the one-row-per-(item, day) wear model. Back-dated wear logging already covers
  "I wore this before I started tracking."
- **Visibility/Followers, Outfit selfies, Style submissions, Lookbooks, Create
  Avatar, style-descriptor profile + completion %** (Indyx/ALTA) — all social /
  multi-user / profile cruft; covered by the no-social, single-user stance.
