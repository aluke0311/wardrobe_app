# ROADMAP — Wardrobe App (execution-ready)

> Single source of truth for what's next. Written so a **fresh session (any model)
> can execute without re-deriving decisions**. Read `CLAUDE.md` (architecture +
> hard constraints) and `schema.sql` (DB) alongside this. Status as of **v8**.

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

**B1 — Calendar.** ✓ *done 2026-06-19 v4.* See §4 for what's built. New table:
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

**B2 — Capsule polish.**
```sql
alter table capsule_items add column if not exists packed boolean not null default false;
alter table capsules
  add column if not exists image_path text,
  add column if not exists sort_order int;
```
- **Packing checklist:** in `openCapsule`, render each item with a packed checkbox;
  toggle PATCHes `capsule_items` (composite key `capsule_id+item_id`); show "X/Y
  packed".
- **Add-an-outfit-to-capsule:** in `startCapsuleBuilder`, add an outfit picker that
  unions the outfit's item ids into `capSel`.
- **Destination image:** photo upload in the builder (reuse `compressImage/
  uploadPhoto`), show on capsule card + detail hero.
- **Reorder:** order capsules by `sort_order` (nulls last → created_at); simple
  up/down buttons set `sort_order`. *(Lowest priority; OK to defer.)*

**B3 — Wishlist + decision support.** *Decision: a wishlist item IS an `items` row
with `status='Wishlist'`* (reuses add/edit/detail/closet wholesale; converting to
owned = set status Available). Migration:
```sql
alter table items drop constraint if exists items_status_check;
alter table items add constraint items_status_check
  check (status in ('Available','Storage','Archive','Wishlist'));
```
- Add `"Wishlist"` to `STATUSES`; it appears in the closet status switcher.
  **Exclude Wishlist from wear/stats/Fill/Log pools** (they're not owned) — audit
  `statusScoped` default, `populateWearItems`, `fillPool`, builder pools (they
  filter to Available / non-Archive; add `!== "Wishlist"` where needed).
- **Purchase-justification card** (in `openItem` when status=Wishlist): projected
  CPW = `price / estWears` (estWears heuristic, e.g. wears/yr of same subcategory
  median, or a flat assumption — derive, document the formula); **duplicates** =
  count owned items with same `category+subcategory+color_family`; **days waiting**
  = `daysSince(created_at)` with a 30-day nudge.
- **One-in-one-out:** when converting Wishlist→Available, optionally prompt to pick
  an owned same-category item to Archive.

**B4 — Rotation mode.** A closet controls toggle "Neglected": forces
`closetSort='stale'` and hides items worn in the last 30 days (`daysSince(lastWorn)
< 30`). Pure client filter; no schema.

---

### Phase C — Closet Health / Insights  *(the centerpiece; rebuilds `Stats`→`Insights`)*
All **derived** (no schema) except where it reads slice-7 ratings. Reuse
`listRows/bars`; add KPI cards. Definitions to implement (locked):
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
- **D2 weather + calendar daily pick:** **open-meteo, no key** —
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

---

### Phase E — Home dashboard + nav rebalance  *(last)*
Add a **Home** landing tab (dashboard). Target nav (~6): `Home · Closet · Log ·
Calendar · Capsules · Insights` (Stats→Insights; Fill + Settings reachable from
Home/a menu). Home cards: today's weather (D2), suggested capsule, recently worn,
neglected pieces, in-laundry items, upcoming events (B1), quick log-wear, continue
packing, closet-health score (C). Built last so it has real content to surface.

### Journal (threads through B/C — not its own slice)
Outfit diary = wear `note` + `rating` + weather surfaced as a timeline (B1 + C7);
"style discoveries" = a searchable notes list.

---

## 6. Explicitly NOT doing (by decision)
AI auto-tagging / bg-removal · stylist chat · semantic/embedding search · server
proxy / Edge Functions · outfit collage canvas · social sharing · multi-user /
accounts / monetization · built-in shopping/retailer browser · editorial content ·
hand-maintained item relationship graph (derive pairings) · per-item typed
comfort/confidence (derive from ratings).
