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
  Sole exceptions (user-approved 2026-07-17, PWA install): `manifest.json` +
  `icon-180.png` + `icon-512.png` in repo root. **No service worker, ever** —
  that would be a real second JS file.
- Plain `fetch` only for all Supabase calls.
- Mobile-first; the user mostly uses this on a phone and takes photos with it.
- Only the publishable (anon) key ever appears in client code — it's safe to
  ship because RLS scopes everything to the signed-in user. The **secret key
  must never** be added or committed.

## Architecture (inside `index.html`)

**Current state: 2026-07-17 r1. Full rework from v25. ~11,900 lines.**
The old v25 is preserved at git tag `v25-full` and `archive/index_v25_full.html`.
Do not use v25 as a reference for current UI code.

**Batch of user asks (2026-07-21, r5→r7) — SHIPPED.**
① **Sticky Tomorrow pick**: the generated combo persists in `kvData("tmpick")`
(`TM_PICK_KEY`, `{date:{idx:[itemIds]}}`, today+future only) instead of a
volatile in-memory cache — a refresh no longer loses a pick she liked. `↻`
re-rolls (`tomorrowGenPieces(..., force)`); tapping the strip calls
`openTomorrowRevise` (opens the suggester with that combo in front, and
`#sgClose` writes the revised combo back via `_sugg.tmPick`).
② **"home" formality bucket**: `outfitBucket` returns `"home"` when a look has
NO shoes ("no shoes = worn at home"), superseding the derived level; a manual
`formality_override` still wins. It's a bucket, NOT a 9th ladder level —
`BUCKET_RANGES.home = 2` for the places that need a number. Adds a Home folder
to the Formality lens.
③ Looks grid tiles lead with wear count.
④ **"Worn" tray**: `isWornNotDirty`/`wornItems`/`_scopedWorn` = worn since
`last_washed` but under tolerance (the pile on the chair). Closet-root
`👕 Worn · N` row → `closetWorn` full-page view (`renderClosetWorn`, subtitle
`wears/tolerance`), wired into `closetBack`/`siblingItems`/`switchTab` exactly
like `closetHamper`.
⑤ Closet Review gained an `image` field (first in `REVIEW_FIELDS`) so photoless
items surface; `replaceItemPhoto` advances the deal when it fires from review.
⑥ **EDITABLE TAXONOMY** — `TAXONOMY` is no longer a const: `TAXONOMY_DEFAULT`
holds the shipped shape, `let TAXONOMY`/`let CATEGORIES` are rebuilt by
`applyTaxonomyOverride()` from `kvData("taxonomy")` = `{cats, meta}` (called at
the end of `loadData` AND after snapshot hydration — both, or the boot render
uses stale lists). Settings → "Edit categories & types" → `openTaxonomySheet`:
rename/add/remove categories + subcategories with live item counts; renames
bulk-PATCH items via `retagItems(match, patch)` (PostgREST column filter, no id
list); delete only offered at zero usage. `meta` carries a renamed
subcategory's `SUBCAT_FORMALITY`/`WEAR_TOLERANCE` defaults to the new name.
⚠️ Renaming does NOT update `WORKOUT_SLOTS`/`LAUNDRY_LOADS`/`GEAR_CAND_SUBCATS`
(still keyed on the shipped names) — revisit if she renames Workout subcats.

**Partners / rhythm / rotation (2026-07-21 r10) — SHIPPED.** Three derived-only
adds, harvested from external design docs (ChatGPT/Gemini specs the user
brought — everything else in them was already shipped or blocked by the
single-file/no-library constraints; the native-iOS half is permanently out of
reach). ① `itemPartners(itemId, limit, wearRows?)` — top co-wear partners keyed
on the shared **wear DAY**, not shared look membership (what left the closet
together > what got saved); `PARTNER_MIN_DAYS`=2 so one memorable outfit isn't a
habit. Rendered by `partnersRowHtml` as a "Usually worn with" thumb strip in the
item-details top card; `[data-partner]` tiles `openItem` (already in closet, so
no `_itemReturn` needed). ② `wearRhythm(itemId, wearRows?)` → `{avg, longest,
wearDays}` over DISTINCT wear days, null under 3 (two wears = one gap = noise);
shown as a `det-sub` under "Worn N days" via `humanGap`. ③ `buildRotationStats
(days, pool?, wearRows?, today?)` + `rotationBlockHtml`/`wireRotationChips` —
share of the Available closet worn in a trailing window, `ROTATION_WINDOWS`
30/90/365 chips (session-only `statsRotationDays`), first block in Clothing
Stats. ⚠️ Its denominator is the **full Available closet, NOT `statsPool()`** —
deliberate, so an active stats filter can't flatter the number. All four
functions take injectable args and are covered in selftest (44/44).

**Round B "Formulas" (2026-07-21, r3→r4) — FIRST SLICE SHIPPED.** Discover the
outfit SHAPES she rebuilds, then re-cook them. All derived, nothing stored.
`formulaKeyFor(items)` = canonical `"Slot:Subcategory + …"` signature (sorted;
null unless there's a dress OR a top+bottom; null-slot pieces — bras/swim —
never count); `formulaLabel(key)` renders it in dressing order (`FORMULA_SLOT_ORDER`);
`buildFormulas(pool)` groups WORN looks by key, keeping shapes with
`FORMULA_MIN_LOOKS`=2+ distinct looks and `FORMULA_MIN_WEARS`=6+ wears (a single
much-worn look is just that look). Surfaced as the **"Formulas" Looks lens**
(first tab) through the existing folder machinery — `folderRowsHtml`/
`folderOutfits`/`folderLabel` all have a Formulas branch, folder key = the raw
signature. Payoff: a formula's folder page has **"✨ New outfit from this
formula"** → `openSuggestSheet(null,null,null,shapeKey)`; `suggestOutfits`'
10th arg `shapeKey` hard-filters each slot's pool to `formulaShapeMap(key)`
(slots the shape doesn't name go EMPTY so the silhouette holds; a two-top shape
may fill the layer slot from its own tops), and `swapSuggestionPiece` stays
inside the shape. ⚠️ Still TODO for Round B: naming/saving formulas to `kv`,
builder slot-seeding, formula chip in the suggester itself.

**Round A "Tomorrow" (2026-07-20, r1→r2) is FULLY SHIPPED** (decisions in
ROADMAP.md's Round A section — do not re-litigate). Three parts:
① **Activity/gear rework** (r1, no migration): `GEAR_WORKOUT_TAG`/`GEAR_RAIN_TAG`
sentinel tags (`isWorkoutGear`/`isRainGear`/`setWorkoutGear`/`setRainGear`,
item-detail SUGGESTIONS toggles). `suggestOutfits` gained an 8th arg
`activity` — `"workout"` filters the pool to `isWorkoutGear` and bypasses
`formalityOk` (the tag IS cohesion); normal mode now explicitly drops the whole
Workout category and gates `gear:rain` behind `wmoIsWet(wx.code)` (boosted +2
when wet). `WORKOUT_SLOTS` maps Workout subcats to real slots (bras/swim →
null = never suggested). Sheet: 🏋️ Workout chip (`_sugg.activity`, mutually
exclusive with formality/context asks, clears locks on flip); empty-state
`suggestGearDoorHtml` → `openGearTagSheet` (one-pass tagging + a "Gear-only"
toggle that sets `formality [1]` via `setGearOnlyFormality`/`isGearOnly` so the
existing pure-Utility isolation keeps gear off normal days). **Level 1 renamed
"Function"→"Utility"** (labels only; stored bucket key `"function"` unchanged).
② **kv store** (r2): new `kv` table (`migration/kv_store.sql`, CONFIRMED RUN
2026-07-20) → `kvData` Map loaded in `loadData`, `kvSet(key,value)` optimistic
upsert (POST `Prefer: resolution=merge-duplicates`), included in the snapshot.
③ **Day plans + Tomorrow** (r2): `dayPlan(date)` reads `kvData("dayplan")` =
`{date: [{contexts:[], outfit:id|null}]}` — ordered ENTRIES (one outfit across
contexts = one multi-context entry; an outfit change = 2 entries; outfit null =
context set, look TBD). `saveDayPlan`+`pruneDayPlan` (past 7d/future 30d window,
pure for selftest). `entrySuggestLevel` (dressier context wins) / `entryActivity`
(Workout context → activity mode) drive suggestions. `openDayPlanSheet(date)` =
the editor (context multi-select + Pick/✨Suggest/✎Build per entry, reuses the
suggester/builder via a `planCtx={kv:true,date,entryIdx,level,activity}` — see
`data-swear`/`finishBuilder`/`builderCancel` kv branches). `wearPlannedEntry`
logs an entry stamping ALL its contexts. Home (suppressed in trip mode):
`tomorrowCardHtml` (all-day, planned looks or a cached `tomorrowGenPieces`
generated combo + 📌 Keep), `todayPlanRowsHtml` (one-tap Wear-it), `planAheadRowHtml`
→ `openWeekPlanSheet` (7-day overview). Calendar day view (today/future, non-trip):
planned-look Wear-it rows + a 📅 Plan button. `loadHomeWeather` now fetches
today+tomorrow in one call (`_homeWx.wx2`) and logs the day's weather to
`kvData("wxlog")` (≤1 write/day, 400d window) as groundwork for style-twins.

**LAUNDRY v1 + Trips (2026-07-15, r1→r4) is FULLY SHIPPED** (decisions in
ROADMAP.md's laundry section — do not re-litigate). `migration/items_laundry.sql`
(adds `items.last_washed` + `items.laundry_state`) **CONFIRMED RUN on the live
DB 2026-07-18** (REST column probe) — laundry is fully live. The
`LAUNDRY_READY()` gate (checks the column exists on loaded rows) stays in the
code as harmless belt-and-suspenders; read paths never needed a gate (absent
column = null = clean). Core model (LAUNDRY section, after the derived helpers): dirty
is **derived, never stored** — distinct wear-days since `last_washed` ≥
`WEAR_TOLERANCE[subcategory]` (category fallback; Infinity = shoes/outerwear
never dirty); **null `last_washed` = clean** (tracking is opt-in by behavior).
`laundryState()` = one pass over wears → Map(item_id→Set(dates)); build ONCE per
bulk scan and pass into `isDirty`/`dirtySince`/`suggestibleClean` (items×wears
perf). One-time overrides in `items.laundry_state`: `'hamper'` (dirty until next
wash stamp) and `'extra:<n>'` ("one more wear" — stores the wear-day count at
set time, self-expires when a newer wear lands; NO wear-path bookkeeping).
`stampWash(ids, date)` stamps ONLY dirty items (an under-tolerance jean wasn't
in the physical hamper). Surfaces: suggester "🧺 Clean only" chip (Season row,
default on; pool filter in `suggestOutfits` cleanOnly param + swap/add-layer;
locked/seed exempt by construction; items dirty `LAUNDRY_RESUGGEST_DAYS`=7+
re-enter badged so the pool can't starve); `openLaundrySheet` (closet-root
"🧺 Hamper · N/empty" row, `[data-laundry]` — ALWAYS visible once migrated, r5)
with load chips from her real sorting (`LAUNDRY_LOADS`: Whites/Cools/Warms +
All together, keyed on color_family) + back-datable date — when NO item has a
`last_washed` yet the sheet instead offers the one-time bootstrap "Mark whole
closet washed" (`#lnStart`, stamps Available finite-tolerance items; fixes the
day-one chicken-and-egg where an empty hamper hid the only entry point); 🧺 tile badge via `itemGridView` (informational — pickers
never filter); item photo view `laundryLineHtml` (One more wear / Washed / To
hamper); wear-again "🧺 in the wash" tag; Home `.laun-row` **previous-day
confirm strip** (most recent logged day ≤3 back; thumbs pre-marked with derived
🧺/↩︎, tap = `flipLaundry` override, ✓ = `LAUNDRY_CONFIRM_KEY` and writes
nothing) which becomes the **"Done laundry lately?" prompt** when the hamper is
stale (`LAUNDRY_STALE_DAYS`=7; "Not yet" snoozes `LAUNDRY_SNOOZE_DAYS`=3 via
`LAUNDRY_SNOOZE_KEY`) — her deliberate, laundry-only exception to "no nudges".
Trips: `planRewearFlags` rewear budget on plan day cards (counts planned
wear-days per piece since trip start / last laundry day, flags past-tolerance);
`PLAN_LAUNDRY = "__laundry__"` sentinel INSIDE a day's plan array (invisible to
look rendering — `planActiveLooks` drops unknown ids) toggled by the day card's
🧺 chip; capsule detail "wash before you pack" hamper count. **The bucket chip
icon changed 🧺→🪣 so 🧺 means laundry app-wide.**

**"Bucket + Visibility polish" (2026-07-11 r1) is FULLY SHIPPED:** ① photoless
items render a muted tee-glyph placeholder everywhere (`PHOTO_PLACEHOLDER`
data-URI SVG applied by `loadPhotoNode` when `data-photo` is empty or the URL
fails; `outfitPieces`/`layoutCanvasHtml`/`lookHeroBlock` no longer drop
photoless pieces; the builder accepts photoless items — `builderPool`'s
image_path filter removed). ② Calendar day-view SOLO-item collage cells are
tappable (`calOutfitCollageHtml(ids, outfit, tappable)` → `data-cal-item` →
`openItemFrom`); look cards still open the look first (user call). ③ Look-
details piece rows carry a `.det-piece-thumb` thumbnail that opens the item
(`data-piece-open`, checked BEFORE `data-occ-item` in the looks delegation);
the rest of the row still edits formality. ④ Empty status filter now means
**Available only** (`itemMatchesFilter` default — Storage no longer counts in
Style Stats unless explicitly picked in the funnel). ⑤ Archived looks purged
from Most Worn Looks, stats main-page counts, context Top Looks, the Home
Looks-tile count, `outfitsForItem` (item's looks list), and trip-plan day
cards (`planActiveLooks`) — archived looks appear ONLY in the Archive lens and
on the calendar. ⑥ **Trip/capsule OUTFIT BUCKET** — see CAPSULES entry.
r2 routed `thumbHtml`/review-card/det-thumb empties through the tee placeholder
(and `.empty` CSS tints via `background-color`, never the `background:`
shorthand — it kills the `center/contain` the placeholder needs). r3 QoL:
`contextOptions()` sorts by global wear frequency (all context pickers);
`.cltoolbar` + `.cal-day-header` are sticky under the app header (`--hdr-h`
var); tapping the header scrolls to top (NOTE: **body is the scroll
container**, not window — `window.scrollTo` is a no-op app-wide; the header
tap animates `document.body.scrollTop` with a setTimeout loop because rAF
stalls in hidden documents).
**"Feels Professional" polish round (2026-07-17 r1) is FULLY SHIPPED** (decisions
in ROADMAP.md's polish section; dark mode REJECTED — don't re-propose). All
perceived-quality, no features/schema: ① **PWA install** — `manifest.json` +
`icon-180/512.png` (repo-root files, the approved one-file exceptions),
apple-touch-icon + standalone metas, SVG data-URI favicon. ② **Sheet motion** —
`showSheet(id)`/`hideSheet(id)` helpers (slide-up/down + backdrop fade; wrapper
`hidden` stays the source of truth, `hideSheet` delays `hidden=true` ~240ms) —
**never toggle a sheet wrapper's `.hidden` directly**; drag-dismiss hands its
offset to `hideSheet` for continuity. ③ **Freshness** — `visibilitychange`
handler: >5 min hidden (or date rollover) + `uiCanRefetch()` (no sheet open, no
builder/add/review/pick/select) → silent `loadData()` +
`rerenderRootAfterRefresh()` (roots only: home / closet-sans-detail /
looks-sans-look / calendar / stats-sans-review). ④ **Snapshot instant-boot** —
`saveDataSnapshot()` after every `loadData` into Cache Storage
(`DATA_CACHE`/`SNAPSHOT_KEY`, 7d max age, user-id-checked); `bootApp` hydrates
from it before any network and fails silently if fresh fetch dies;
`handleSignedOut` clears it. ⑤ **Update toast** — `checkForNewVersion()`
Range-fetches own index.html, compares `<meta name="app-version">` (MUST stay
in lockstep with `APP_VERSION` — deploy skill bumps both) → "Update available"
toast; reload via `location.replace(+query)` because plain reload can re-serve
the stale cached copy. ⑥ **Scroll** — `scrollToTop()`/`getScrollTop()`/
`restoreScroll(y)` (body is the scroll container; the 9 dead `window.scrollTo`
calls were converted); `makeScreenReturn` thunks restore origin scroll;
`_detailEntryScroll`/`_lookEntryScroll` restore grid/list position on plain
back (captured only when `detailId`/`lookId` was null, so sibling prev/next
keeps the original). ⑦ **Photo fade-in** — `loadPhotoNode` decodes off-DOM then
fades (`.ph-fade`/`.ph-in`); `_shownPhotos` Set skips the fade on re-renders
(no added flicker). ⑧ Papercuts: tabular-nums body-wide, desktop ≥700px frame
(app + all fixed chrome capped at 640px), login email prefill
(`wardrobe.lastEmail`), `prefers-reduced-motion` guard.

**Usability batch 2026-07-19 r5+r6 (from the "how would you improve
usability/professionalism now" review; user picked 3/4/5/6+keyboard+finder,
PARKED Home attention-slot hierarchy + in-app confirm sheets — see
Back-burner):** r5 ① `outfitIncomplete(o)` (no dress/swimsuit AND no
top+bottom; shoes NEVER required — "no shoes = worn at home" is her rule;
workout subcats count as top/bottom) + health-check "Incomplete looks" row →
`openIncompleteLooksSheet` review list with per-look deconstruct.
② zero-state door: level-starved capsule suggestions render
`suggestLevelDoorHtml` — up to 8 closet pieces covering the level with
one-tap add-to-capsule then re-roll. r6 ③ `WHATS_NEW` const (deploy skill
refreshes it with APP_VERSION) + `maybeShowWhatsNew()` in bootApp (first run
of a new version toasts the changelog; `wardrobe.seenVersion`).
④ `api()` network-failure copy is honest about data ("You're offline — that
didn't save"). ⑤ `.cb-x`/`.laun-ok` get ::after hit-area expansion (~44px).
⑥ review-card price input `inputmode=decimal`. Selftest 31/31.

**Fix pack 2026-07-19 r4 (user-reported, same day):** ① one-piece looks are
outlawed — `createLookFromItems` guards <2 (saveBuilder already did); existing
strays surface in the data health check with a bulk fix that DECONSTRUCTS them
(wears survive as solo wears). ② `deconstructLook(id)` + a "Deconstruct look"
row on the look details page ("not really a look" — keeps every wear, drops
the grouping; shares `deconstructLookCore` with deleteLook/health check).
③ tops-vs-layers: `layerPieceOf` picks the LAST flagged top (the ow-slot one)
so labels don't swap when the base is also layer-flagged; combo generation
skips stacking two layerable tops. ④ **suggester `targetLevel` is now a HARD
filter** in the engine + swap + add-layer — a "Dressed Up" ask returns
fewer/zero results (starvation note explains) instead of silently falling
back to casual (the capsule-mode bug she hit). Selftest 31/31.

**"Loop Resilience + Payoff" round (2026-07-18→19, through 2026-07-19 r3) is
FULLY SHIPPED** (spec in ROADMAP.md's section — decisions locked from the
2026-07-18 product review). Pieces: **suggester** — ⃠ per-piece session bans
(`_sugg.banned`, `banSuggestionPiece`; `_suggPool()` now ALWAYS returns the
effective pool minus bans), pool-starvation note (`suggestStarvationNote`),
per-sheet-open variety salt (`_saltFor`, `SUGGEST_SALT`=0.35, added in
`scoreCombo`); **Home** — catch-up strip (`catchupHtml`/`missedDays`/
`skipDay`, `SKIP_DAYS_KEY` store set pruned 30d; "Log →" jumps to that day's
wear-again chooser) + backup-staleness row (30d, taps `downloadBackup` which
re-renders the CURRENT screen); **Stats** — "Closet vs Life" gap page
(`buildGapStats` pure: wear share vs formality-eligible closet share per
context, 5+ wears noise floor; `statsView "gap"`) and "Year in Review"
(`buildWrappedStats(year)` pure + `renderStatsWrapped` card stack, year
chips, gift-free all-time CPW champions, dead weight, `longestStreak`;
`statsView "wrapped"`); **trips** — offer dismissal now once per TRIP.
**Data safety (r7, same series):** Settings Data card (`downloadBackup` JSON
export + `runDataHealthCheck` with one-tap fixes for dangling rows),
`migration/backup_photos.py` (full offline backup) + `restore_backup.py`
(disaster recovery, refuses non-empty tables without --force), both stdlib-
only; `migration/backup/` + `.env` gitignored.

**"Trip Mode + Tap Tax" round (2026-07-18, r1→r6) is FULLY SHIPPED** (spec +
locked decisions in ROADMAP.md's trip-mode section — do not re-litigate; the
"no nudges" rule is SOFT as of this round). No schema changes. Key pieces:
**TRIP MODE** — `tripModeId` (`TRIP_MODE_KEY` in `store`, restored in `init`,
validated at end of `loadData`); phases DERIVED from capsule dates via
`tripPhase(c)` (pack ≤`PACK_LEAD_DAYS`=3 before start · trip · unpack
≤`UNPACK_GRACE_DAYS`=3 after end; undated capsule = "capsule mode", no
phases). `enterTripMode`/`exitTripMode` (also set/clear `activeCapsuleId`;
the shared `scopeBannerHtml()` banner's ✕ EXITS THE MODE — one mental model).
Home: `tripDashHtml` takeover (day counter, today's planned looks +
`planWoreIt` one-tap, `_planWx` weather via `loadTripHomeWx`, suitcase hamper
row, remaining-days strip, ✨/plan/packing chips) + `tripOfferHtml` auto-offer
banner (per-day dismissable, `TRIP_OFFER_KEY`); wiring in `wireTripDash`.
Scoping: wear-again chooser + `openSuggestSheet` default pool + calendar
pickers (`_pickTripScope`, "✈️ Suitcase only" chip escape) + `builderPool`.
`tripWearContext(date)` auto-stamps `TRIP_CONTEXT`="Travel" on EVERY
wear-create POST during trip dates (post-log sheet shows it pre-selected);
`tripPlanSync(outfitId, date)` records logged looks into that day's plan;
`tripMissingPieces` offers add-to-capsule (post-log row + toast chip); Add
Item pre-ticks the trip capsule; laundry sheet takes a pool (`_lnPool`) —
trip laundry washes only the suitcase. **UNPACK/RECAP** — `tripRecapData(c)`
(pure derivation: worn vs dead-weight, most-worn, repeated look — retroactive
for any past dated trip) + `openTripRecap(cid, {unpack})` (worn→hamper via
`flipLaundry` overrides, End trip mode); dashboard unpack-phase row +
capsule-detail "Trip recap" button on past trips. **FILTER+SORT (A3/A2)** —
sort lives IN `openFilterSheet` (`sortable: true` on closet/calendar/capsule
pickers; title "Filter & sort"); the 3 standalone sort popovers are GONE.
⚠️ Sort keys renamed: `"category"` = the composite (was misleadingly keyed
"color"), `"colorfam"` = NEW true color sort; `gridSortKey()` maps legacy
stored `"color"`→`"category"` — never write key "color" again. One-tap clear:
`funnelBtnHtml(id, state, onClear)` renders an adjacent ✕ when active
(`_funnelClearFns` registry + one capture-phase listener in `wireEvents`;
closet/looks/stats toolbars registered manually). **PICKER TOGGLE (B)** —
`builder.pickAll` ("all" = the bottom RAIL over the whole `builderPool()`
with category jump chips, zero folder depth; "browse" = classic drill),
toggled via `setBuilderPickAll` (🗂/▦ buttons in rail hdr + picker hdr),
persisted `wardrobe.pickmode.builder`, capsule/trip scope defaults to all.
**A1/E4** — `openPostLogSheet`'s `close()` re-renders the calendar day/Home
beneath it (the "set context twice" bug); `openLogWear` + `logWearToday`
refresh photo-view stat strip / day view too. **A4** — ✨ "Suggest new" tile
at the front of the wear-again strip, TODAY only (past-date suggestions
rejected by user).

**Report Cards (2026-07-10) shipped in `2026-07-10 r2`→`r3`** — r2 shipped Brand
& Retailer report cards; r3 (same day) generalized the engine to 7 dimensions
(+ subcategory, price bracket, purchase year, color, acquisition) and added the
Workhorses/Declutter smart lists, the capsule-picker suggested strip, and the
item-detail workhorse badge. See the STYLE STATS entry below for
`buildItemPerf`/`buildReportStats`/`renderStatsReportPage`/
`renderStatsReportDetailPage`.

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
  `_fieldEditItem`/`_fieldOnSave` dual-mode (DB save vs. callback). Photo view shows
  a **"★ Workhorse" badge line** (`workhorseBadgeHtml`, 2026-07-10) under the stat
  strip when the item has 5+ wears and idx ≥ 1.5 vs subcategory peers
  (`buildItemPerf(items)` — full-closet baseline, not the stats-filtered pool).
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
  Two modes: Capsule + Trip (packing checklist, weather strip). The add-items picker
  (`renderCapsulePicker`) opens with a **"★ Suggested" workhorse strip**
  (`capsulePickSuggestHtml`, 2026-07-10): up to 12 in-season (trip start-date season
  when set, else current), Available, idx ≥ 1.2, 3+-wear items; hidden while
  searching or category-drilled; tiles are `data-pick` so `togglePick` (now `$$` —
  an item can appear in strip AND grid) selects in both places. "Plan outfits from this" sets
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
  **Outfit bucket (2026-07-11 r1):** `PLAN_BUCKET = "bucket"` is a RESERVED key in the same
  `capsules.plan` JSONB — a pool of planned looks not tied to a day. The plan view (now reachable
  for ALL capsules: dated trips get "Plan outfits by day", undated capsules get a "Planned
  outfits" button, same `data-cap-byday`/`openTripPlan`) renders the bucket card first with its
  own ＋ Look / ✨ Suggest / ✎ Build actions — all the existing plan plumbing works because they
  just pass `date = PLAN_BUCKET` (`planDayLabel` special-cases the label; `planCtxSeasonDate`
  anchors season to trip start / today since the bucket has no date; suggest button reads "Add
  to bucket"). Day cards get a **"🪣 From bucket"** chip (was 🧺 until 2026-07-15 — 🧺 now means laundry) (`openBucketAssignSheet`) — assigning
  KEEPS the look in the bucket (one outfit can cover several days); bucket tiles show
  "✓ planned" once used somewhere. `planActiveLooks(c, date)` is the render-side reader — it
  drops deleted AND archived looks (raw ids stay in the JSONB; unarchiving restores them).
- **CALENDAR** — `renderCalendar()` dispatches month/day views. Day view: outfit groups,
  swipe-left actions (Copy/Move/Delete). "+ Clothing" / "+ Look" log pickers, both with
  a filter funnel (`pickerFilter`/`PICKER_FILTER_DIMS` for +Clothing, `calLookFilter`/
  `LOOKS_FILTER_DIMS` for +Look). Footer also has a **"↻ Wear again"** button
  (`openWearAgainChooser`, see DAILY LOOP). Above the footer, an **"On this day"** row
  (v3, `.otd-row`) shows the most recent prior YEAR with wears on the same date
  (mini collage + contexts); tap navigates the day view to that date.
- **STYLE STATS** — `renderStats()` dispatches main/field/grid/outfits/contexts/
  context-detail/report/report-detail/review views. **Report Cards** (2026-07-10):
  main-page "Report Cards" section → `renderStatsReportPage()` over
  the 7 dimensions in `REPORT_DIMS` (brand, retailer, subcategory, price bracket,
  purchase year, color_family, acquisition). Engine: `buildItemPerf(pool)` computes
  per-item {count, months, exp, idx} — idx = actual wears / expected wears, where
  expected = peer wear-rate (subcategory rate, category fallback when the subcat
  slice is under 5 items) × months observed. Tenure runs from purchase_date
  (→ first wear → created_at fallback), clamped to the earliest logged wear
  anywhere (pre-logging months would deflate rates). `buildReportStats(field)`
  groups per-item perf by the dim's `keyFn`. Per group: wears/mo, median $/wear +
  total spend (gifts excluded from cost stats, still counted for engagement), duds
  (never worn, or archived with < `REPORT_DUD_WEARS`=3 wears). **Ranked dims**
  (brand/retailer/color/acquisition): idx sort + Best/Worst bar; groups under
  `REPORT_MIN_ITEMS`=3 items list unranked. **Canonical dims**: subcategory
  (taxonomy order under category `sf-label` headers, `showIdx:false` — the index
  is ×1.0 by construction there; the payoff is best/worst WITHIN the group, per
  user decision 2026-07-10), price (bracket order), year (newest first; current
  year's duds say "still proving out"/"too soon"). Pool = `reportPool()` —
  statsPool but `{ noStatusDefault: true }` so archived items stay in (dud rate
  needs them). Detail page: KPI card (subcategory swaps the vs-Similar KPI for
  Duds), Best performers / Underperformers grids (worst = never-worn by price
  desc, then lowest index), "All items" → grid with `statsFromReport` so back
  returns to the detail page (wired in `statsNavBack` + `statsRebuild`). No
  date-range button (metrics are inherently all-time / tenure-normalized); the
  filter funnel + acquisition range apply. **Workhorses / Declutter smart lists**
  (`buildSmartList` keys, a TOGGLE_GROUPS pair, rows in Clothing Stats):
  Workhorses = idx desc among 3+-wear items; Declutter = owned 6+ months, not in
  any liked look (`likedLookItemIds()` shield), never worn (longest-owned first)
  or idx < 0.5 and untouched 90+ days — transparent sort, no composite score.
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
- `migration/items_laundry.sql` — adds `items.last_washed` (date) + `items.laundry_state`
  (text override: `'hamper'` | `'extra:<n>'`). **CONFIRMED RUN 2026-07-18** (verified
  via anon-key REST column probe; `LAUNDRY_READY()` gate stays as belt-and-suspenders).
- `migration/kv_store.sql` — new `kv` table (`user_id, key, value jsonb`, PK
  (user_id,key), RLS own_rows) for small app state (Round A day plans + wxlog).
  **CONFIRMED RUN 2026-07-20** (anon-key REST probe returned 200).

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
- Workout: Workout tops, Active shorts, Sports bras, Swimwear

**Color families** (single per item): Green, Teal, Blue, Purple, Maroon, Pink, Red,
Orange, Yellow, Beige, Brown, White, Gray, Black, Metallic.

## Migration

**The full data reset is DONE (user confirmed 2026-07-18)** — the live data is
real, not provisional; treat it as the irreplaceable asset it is.
`migration/RESET_PLAN.md` is historical.
`migration/` holds throwaway importers (NOT shipped; libraries OK there).
`migration/.env` (gitignored) holds the service-role key + Airtable token.
`schema.sql` (repo root) = canonical target state.

Airtable base "CLOTHING BASE CURRENT" (`appK4hX9DJYTGFGYb`) is the source of truth.
476 items + 3,995 wears + 1,543 outfits imported 2026-06-18.

Migrations are run by the user in the Supabase SQL editor. **Never deploy UI that
writes a new column/table before its migration is confirmed.**

## Conventions

- **`APP_VERSION`** format: `YYYY-MM-DD rN`. New day = `r1`; same day = increment `rN`.
  Currently `2026-07-17 r1`. ⚠️ Since 2026-07-17 the version lives in TWO
  places that must stay in lockstep: the `APP_VERSION` constant AND the
  `<meta name="app-version">` tag in `<head>` (read by `checkForNewVersion`).
- Comment non-obvious logic only — match the surrounding density.
- Fixed product choices live as top-of-script constants (`TAXONOMY`, `COLOR_FAMILIES`,
  `OCCASION_LADDER`, `CONTEXTS`) — change them there.
- All item photos use **`background-size: contain`** everywhere. Never `cover`/`fill`.

## Filtering

**Canonical filter predicates** (single source of truth): `matchesFormality(i, level)`
(numeric 1–8) and `matchesSeason(i, season)` (DERIVED via `itemSeasonSet`; unknown
season = no match). **Status is always read via `itemStatus(i)`** (null → "Available");
an empty status filter means **Available only** (`itemMatchesFilter` default, tightened
2026-07-11 r1 — it used to only exclude Archive, which let Storage into Style Stats;
explicitly picking statuses in the funnel brings Storage/Archive back; pickers/builder
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

- **Bottom sheets open/close ONLY via `showSheet(id)`/`hideSheet(id)`** (2026-07-17)
  — never set a sheet wrapper's `.hidden` directly. `hideSheet` animates first and
  flips `hidden=true` ~240ms later, so code that *reads* `.hidden` right after a
  close sees `false`; the wrapper ids list in `uiCanRefetch()` must gain any NEW
  sheet wrapper added later.
- **`#toast` overlays bottom-fixed controls and must stay tap-transparent**
  (2026-07-21 r12). It's `position:fixed` at `bottom: nav-h + safe-b + 18px`,
  **z-index 50** — the same band as `.stats-toggle-float` (z-index 18) and close
  to `#itemBar`/`.lk-actbar` (25). It used to set `pointer-events:auto` on the
  whole pill when it had action chips, and its handler returns early on a
  non-chip tap — so a lingering toast made the Most/Least Worn toggle look
  broken (tap the chip → that action fired; tap elsewhere → nothing). Rule:
  **`pointer-events` stays `none` on the pill; only `.toast-chip` opts back
  in.** `positionToast()` additionally lifts the toast clear of
  `.stats-toggle-float`; it's called from `toast()` AND from
  `renderStatsGridPage` so it self-corrects from both directions. Any NEW
  bottom-fixed control in that band needs the same consideration.
- **Never call `wearCountInRange` inside a sort comparator** (2026-07-21 r11) —
  it filters the whole `wears` array per call, so a comparator makes it
  items × wears × log(items) (~34M row reads on the real closet, ~1s of frozen
  UI). Use `wearCountMapInRange()` — one pass, `Map(item_id → count)`. It
  mirrors the per-item function's asymmetry exactly: distinct wear DAYS when
  the range is "all", raw rows within a cutoff (pinned in selftest).
- **Screen-top scrolling**: use `scrollToTop()` / `getScrollTop()` /
  `restoreScroll(y)` — `window.scrollTo` is a no-op (body is the scroll container).
  Back-nav scroll restore: `makeScreenReturn` thunks carry it; plain closet/look
  back uses `_detailEntryScroll`/`_lookEntryScroll`.
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
and pure helpers are testable from the console. ⚠️ The panel's browser caches
index.html — always load with a fresh query string (`/?v=<anything>`).

**Self-test harness (2026-07-18): `migration/selftest.html`** — open
`http://localhost:4173/migration/selftest.html?v=<bust>` in the preview browser;
it loads the app in an iframe and asserts the derivation logic (trip phases,
sort keys incl. the legacy `"color"` mapping, laundry dirty/overrides,
formality, recap math, exclusions, version-lockstep). Summary line = `N/N
passed`. **Run it before every deploy; add a test whenever a session's ad-hoc
console verification proves something worth keeping true.** Gotchas baked in:
app globals are top-level const/let (invisible on `contentWindow` — the harness
injects an eval-bridge Proxy), and Sets passed into app code must be created in
the IFRAME's realm (`W.Set`) or `instanceof Set` fails.
