# ROADMAP — Wardrobe App

> Read `CLAUDE.md` (architecture + conventions) and `schema.sql` (DB) alongside this.
> Current version: **2026-07-06 r1**.

---

## ▶ NEXT BUILD — "Hearts + Filters Everywhere" v2 (planned 2026-07-06)

**Status: APPROVED + EXPANDED after the 2026-07-06 product review. All decisions locked
(user answered the review questionnaire: "defaults for everything" + 7 additions, all
folded in below). Build in wave order; deploy at each ✅ checkpoint via the
`deploy-wardrobe` skill (bump `APP_VERSION`, commit, push). When the user says
"continue the build," start at the first unchecked item.**

Through-line: **make the daily wear-log loop safe and single-ask, finish filter
unification on the pickers, add hearts ("I liked this look") captured at the wear
moment, organize Looks by context, and surface the payoff of context capture.**
No schema changes anywhere — `outfits.rating` already exists.

**User-corrected mental model (from the review — design against THIS):** serious
logging only began with this app (the sparse context/occasion coverage in imported
data is an import artifact, NOT evidence she skips capture). She says she **will fill
in context most of the time** — so context capture must be reliable and asked at the
right moment (exactly once), and context-powered features are worth building now. She
will heart looks **when wearing them, not while browsing** — the heart must live in the
wear/log flow, not only on browse surfaces.

### Locked decisions (do not re-litigate)

Hearts:
- **L1 Liked = `outfits.rating === 1`.** Heart toggle: liked ↔ null (PATCH). Other
  values reserved (a future 👎 could use −1). No migration needed.
- **L2 Heart placement (browse):** look canvas toolbar right slot (`openLook` renders
  `looksToolbar` with the shuffle slot unused — put the heart there, filled when liked).
  Do NOT add a 7th icon to the already-full `.lk-actbar`.
- **L2b Heart placement (wear moment — the user's PRIMARY hearting moment):**
  a heart toggle row in `openPostLogSheet` whenever the logged wears share an
  `outfit_id`, AND a small heart toggle on calendar day-view look cards.
- **L3 Tile badge:** small (~14px) heart overlay on `.otile` thumbnails in
  `outfitGridHtml` AND in the look pickers (calendar +Look, plan picker, capsule looks).
- **L4 Filter-by-liked:** a "Liked" dimension appended only to `LOOKS_FILTER_DIMS`
  (outfit-level; `outfitMatchesFilter` handles it, `itemMatchesFilter` ignores it).
- **L4b Liked LENS (user override of the earlier "no 7th lens" call):** add "Liked" to
  `LOOK_LENSES` as a flat folder-less list (like Recent/All). Lens row grows to 8 —
  see L8 CSS note.
- **L5 Liked-first sort** in the calendar +Look picker and the trip plan look picker.
- **L6 Suggestion nudge:** liked outfits count **double** in `buildSuggestIndexes`
  pair-affinity. Still capped/soft; no other engine change.
- **L7 "Liked but neglected" smart list:** liked looks not worn in 60+ days (or never),
  in the Stats Looks section. Ships empty-ish and fills itself as hearts accumulate
  (user expects little backfill — that's fine).

Looks organization:
- **L8 Context lens:** add "Context" to `LOOK_LENSES`. Folders = distinct contexts
  across a look's wears (`outfitContexts(o)` = union of `ctxArr(w)` over wears with
  `outfit_id === o.id`), sorted by look-count desc, plus a trailing "No context"
  folder so nothing disappears. A look may appear in multiple folders (same as Season).
  Final lens order: **Formality · Season · Context · Capsule · Liked · Recent · All ·
  Archived**. CSS: `.lens` buttons are `flex:1` (index.html:169) — 8 tabs won't fit;
  make the row horizontally scrollable (`overflow-x:auto`, `flex:none` buttons,
  `-webkit-overflow-scrolling:touch`, hide scrollbar) rather than shrinking labels.
- **L9 Auto-archive is DERIVED, not written:** a look is effectively archived iff
  `o.archived || outfitItems(o).some(i => itemStatus(i) === "Archive")`. Implement
  `effectiveArchived(o)` and use it in `activeOutfits()`/`archivedOutfits()`
  (index.html:3395). NO cascade PATCHes, NO new column — archiving an item instantly
  hides its looks everywhere; unarchiving the item restores them, and manually-archived
  looks stay archived (`o.archived` untouched). In the look canvas/details of an
  auto-archived look, show a one-line note ("Hidden from browse — contains an archived
  item") and leave the manual Archive/Unarchive button operating on `o.archived` only.

Logging flow (single-ask + log-as-look):
- **G1 Ask context/formality EXACTLY ONCE, at look creation.** Current double-ask:
  calendar +Clothing → `saveCalClothingLog` opens `openPostLogSheet` (ask #1), then the
  user hits "Create look from these N items" and gets asked again. New behavior:
  - `saveCalClothingLog` (index.html:5895): NO auto sheet. Toast with **Undo** +
    **"Add context →"** chips instead (same pattern as `logWearToday`).
  - `makeLookFromDay` (index.html:5768): after creating/merging the look, open
    `openPostLogSheet` for that day's wear rows — pre-seed `_ctxSel` (and formality)
    from any values already on the rows so nothing gets blanked. Include the L2b heart.
  - Solo items never grouped into a look: context stays reachable via the toast chip
    and the day-card "Add context" button — acceptable per user.
- **G2 "Log as look" directly from the +Clothing picker** (skip the day-page detour):
  a second commit button in `renderCalClothingPicker` next to Done ("Log as look",
  enabled when ≥2 picked). Extract the create-or-merge logic from `makeLookFromDay`
  into `createLookFromItems(itemIds, {name})` (dedup via `findDuplicateOutfit`,
  POST outfit + outfit_items, returns outfitId) shared by both; then POST wears WITH
  `outfit_id`, land on the day view, open `openPostLogSheet` once (with heart).
- **G3 Undo everywhere logging is one-tap:** extend `toast()` (index.html:1462) to
  accept an ARRAY of action chips. `logWearToday` toast becomes **Undo** + **Add
  context →**; `saveCalClothingLog` toast gets **Undo** too. Undo = DELETE the created
  wear rows + splice from `wears` + re-render if on the day view.
- **G4 Back-dating from the item:** `openLogWear(id)` (index.html:2811) is fully built
  but DEAD (zero call sites — verify it still works, it predates the rework). Wire it:
  a "Log on a date…" row in the long-press quick-actions sheet (`openQuickActions`,
  index.html:2613) + long-press on `#ibLog` (tap = today as now; wiring at
  index.html:9141).
- **G5 Stat strip on the item photo view:** in `openItem` (index.html:2013), one muted
  line between the nav/sib bar and the photo: `worn 14× · last worn 3 wk ago ·
  $6.20/wear` via `wearCount`/`lastWorn`/`relDate`/`costPerWear` (never-worn → "never
  worn"; no price → omit CPW). Photo view is the most-viewed surface; this is the
  glanceable payoff of logging.
- **G6 "Wear again" chooser:** the Home "Log today's wear" CTA (index.html:1535) and
  the calendar day-view footer open a chooser sheet: a horizontal strip of ~12 candidate
  looks — worn in the last 14 days ∪ liked ∪ most-worn this season, deduped, recency
  first — tap = `logLookOnDay(id)` for today → `openPostLogSheet` (with heart); below
  the strip, the existing **+ Clothing** and **+ Look** buttons. Reuses
  `outfitCollageHtml`. The most common real log is a repeat — make it 2 taps.
- **D1 Local "today":** `todayStr()` (index.html:1437) uses `toISOString()` = UTC;
  evening logs land on tomorrow. Add `localISO(d)` (getFullYear/Month/Date, padded) and
  sweep EVERY `toISOString().slice(0, 10)` call site (~1437, 1511, 2813, 3480, 5382
  streak walker, 5546 day nav — audit all).
- **D2 Soft dup-wear guard:** `logWearToday` (index.html:2731): if a wear for this item
  already exists today, skip the POST and toast "Already logged today" + "Log again →"
  chip. Calendar multi-pickers exempt (intentional).

Filters/pickers:
- **P1 The `_capPick*` picker family gets ONE shared unified funnel.** New
  `pickerFilter = newFilterState()` + `PICKER_FILTER_DIMS = FILTERS` minus
  status/category/subcategory (picker keeps its own status chips + category folders;
  **capsule stays IN** — that's the reported bug). Reset in both openers
  (`openCalAddClothing` index.html:5831, `openCapsulePicker` index.html:7842). Applied
  in `pickerPoolBase()` (index.html:7854) via
  `itemMatchesFilter(i, pickerFilter, { noStatusDefault: true })`.
- **P2 Funnel button + count badge beside each picker search input**, mirroring the
  builder-picker pattern. Extract shared `funnelBtnHtml(id, state)` — the
  button+badge markup is copy-pasted in 4+ toolbars; new surfaces must use it
  (retrofit old ones only if trivial).
- **P3 Calendar +Look picker funnel** (`renderCalLookPicker` index.html:5935) with
  `LOOKS_FILTER_DIMS` (incl. Liked) on a new `calLookFilter` state via
  `outfitMatchesFilter`; **plan look picker** (`openPlanLookPicker` index.html:7619)
  gets keyword search.

Context payoff (user says she WILL fill context — reward it):
- **C1 Context chips on the suggestion sheet:** a row of her top contexts (by wear
  count) above the formality chips in `renderSuggestSheet` (index.html:4112). Picking
  one sets the target level(s) from the EMPIRICAL distribution of `formality_for` on
  wears with that context (levels covering the bulk of those wears; min 3 wears to
  trust), falling back to a tweakable seed constant `CONTEXT_FORMALITY_SEED` (map
  context → level array on the 1–8 ladder; propose sensible values, e.g. Workout [1],
  Errands [1,2], Friends/Rehearsal [2,3], Campus/Travel [3], Date Night [4], Symphony/
  Church [3,4], Party/Shower [4], Work [5], Wedding [6], Chorus Concert [6] — user can
  tweak in code).
- **C2 Contexts page in Stats:** wears by context (respecting the stats date range via
  `rangeStart`), per-context formality demand (avg/spread of `formality_for`), top
  items/looks per context; tap-through to grids following the existing stats
  field-page patterns (`renderStatsFieldPage`). Entry row in `renderStatsMain`.

Hygiene:
- **H1 Dead-code sweep:** retired-search remnants (`searchState`, `newSearchState`,
  `searchOpenRow`, stub `renderSearch`/`runSearch` — KEEP `openSearch`, it's the live
  closet funnel entry), `placeholder()` (index.html:1551), and the duplicate sort menu
  (`PICK_SORT_OPTS`/`PICK_SORT_LABELS` index.html:5840 — derive from `SORT_OPTS`
  index.html:1584). Do NOT delete `openLogWear` — G4 revives it.
- **H2 `.gitignore` `reference-images/`** (user confirmed: don't version).
- **Rejected this round:** 👎 dislike UI, rating-driven suggestion overhaul, reorder
  capsules (needs schema), crop/rotate editor, mandatory context capture (must stay
  optional/skippable).

### NAVIGATION AUDIT (parallel track — user-reported pain, no single fix)

The user reports navigation "doesn't always take me where I expect." Principles to
enforce wherever violated: **back returns to the screen I visibly came from; a tab tap
goes to that tab's root; viewing something must not silently mutate my browse state.**
Known suspects found in review (fix these; user will report more cases as she hits them
— collect + fix in any wave):
- [ ] Suggestion-sheet piece tap mutates `closetCat`/`closetSub` (index.html:4246) so
  sibling nav works — after returning, the CLOSET tab's browse position has silently
  changed. Same pattern anywhere `openItemFrom` callers pre-set closet globals: restore
  the prior closet state when the `_itemReturn` thunk fires.
- [ ] Make-a-look toast "View →" (and similar toast shortcuts) `switchTab("looks")`,
  which clears `_itemReturn`/origin — back from the look lands in Looks browse, not the
  calendar day the user came from. Decide per-case: either capture a return thunk for
  look-detail too, or accept and document.
- [ ] `activeCapsuleId` scoping persists across tab switches by design — verify the
  banner is ALWAYS visible on scoped surfaces so "why is my closet tiny" never happens.

### WAVE 0 — Land in-flight work + housekeeping ✅ deploy after
- [x] **Commit the builder-picker funnel** — uncommitted diff in `index.html`
  (`BUILDER_FILTER_DIMS`, `builderFilter`, funnel in `renderBuilderPicker`, pool filter
  in `builderPool`, `#bldPickFilter` wire). Parse-check, verify in preview, commit. (S)
- [x] **H2 gitignore** `reference-images/`. (S)
- [x] **H1 dead-code sweep** — removed `placeholder()`, `searchState`/`newSearchState`/
  `searchOpenRow`, stub `renderSearch`/`runSearch`; `PICK_SORT_OPTS`/`PICK_SORT_LABELS`
  now derive from `SORT_OPTS`. (see Hygiene above). (S)
→ ✅ **DEPLOYED** (`2026-07-06 r1`)

### WAVE 1 — Daily-loop correctness + safety
- [x] **D1 local-date fix** — added `localISO(d)`; every `toISOString().slice(0,10)`
  call site swept (todayStr, home calendar tile, openLogWear, currentSeason, calStreak,
  calendar month/day nav, stats ranges, trip dates, weather-range fetch). (M)
- [x] **D2 soft dup-wear guard** — `logWearToday` skips the POST if a wear already
  exists today for that item; toasts "Already logged today" + "Log again →" (force flag). (S)
- [x] **G3 multi-action `toast()` + Undo** — `toast()` now accepts an action array;
  `logWearToday` shows Undo + Add context; `saveCalClothingLog` fallback toast gets Undo.
  New shared `undoLoggedWears(rows)` DELETEs + splices + re-renders the active screen. (S/M)
- [x] **G4 back-date entry points** — "Log on a date…" row in quick-actions
  (`#qaLogDate` → `openLogWear`); long-press (500ms) on `#ibLog` opens the same;
  plain tap still logs today. `openLogWear` confirmed working against current wears flow. (S)
- [x] **G5 photo-view stat strip** — `itemStatLine(i)` (`worn N× · last worn X ago ·
  $Y/wear`, never-worn / no-price handled) shown in `openItem` between the sib bar
  and the photo. (S)
→ ✅ **DEPLOYED** (`2026-07-06 r2`)

### WAVE 2 — Capsule filter in the item pickers (the reported bug)
- [x] **P1 `pickerFilter` + `PICKER_FILTER_DIMS`**, reset in both openers
  (`openCalAddClothing`, `openCapsulePicker`). (S)
- [x] **Apply in `pickerPoolBase()`** via `itemMatchesFilter(i, pickerFilter,
  { noStatusDefault: true })`, gated on `hasActiveFilter`. (S)
- [x] **P2 funnel + badge in both picker headers** (`renderCalClothingPicker` +
  `renderCapsulePicker`); extracted shared `funnelBtnHtml(id, state)` and retrofitted
  the Wave-0 builder-picker funnel to use it too. (M)
- [x] **Verified** parse-check + preview load clean; capsule dim now reaches both
  pickers (previously only the builder picker had it). (S)
→ ✅ **DEPLOYED** (`2026-07-06 r3`)

### WAVE 3 — Hearts
- [ ] **`toggleLikeLook(id)`** — PATCH rating 1↔null, update local row, re-render. (S)
- [ ] **L2 heart on look canvas** toolbar right slot. (S)
- [ ] **L2b heart in `openPostLogSheet`** (when wears share an outfit_id) + on calendar
  day-view look cards. **This is the primary capture point — build it in the same wave
  as the browse heart, not later.** (M)
- [ ] **L3 tile badges** in `outfitGridHtml` + look pickers. (S)
- [ ] **L4 Liked filter dim** (`newFilterState` key lists + `LOOKS_FILTER_DIMS` +
  `outfitMatchesFilter`). (S)
- [ ] **L4b Liked lens** in `LOOK_LENSES` (flat list) **+ L8 scrollable `.lens` CSS**
  (needed before Wave 4 adds Context too). (S/M)
- [ ] **L5 liked-first** in +Look picker + plan picker. (S)
- [ ] **L6 liked ×2 pair-affinity** in `buildSuggestIndexes`. (S)
- [ ] **L7 "liked but neglected" smart list** + liked count line in Looks Stats. (S/M)
→ ✅ **DEPLOY**

### WAVE 4 — Looks organization
- [ ] **L8 Context lens** — `outfitContexts(o)` helper; folder rows with counts +
  "No context" folder; wire into `folderRowsHtml`/`folderOutfits`/`folderLabel`
  (index.html:3688–3725). (M)
- [ ] **L9 `effectiveArchived(o)`** — swap into `activeOutfits`/`archivedOutfits`;
  auto-archived note on look canvas/details; verify pickers/calendar/capsule-looks all
  read through `activeOutfits`. (M)
→ ✅ **DEPLOY**

### WAVE 5 — Logging flow rework
- [ ] **G1 single-ask** — `saveCalClothingLog` stops auto-opening the sheet (toast w/
  Undo + context chip); `makeLookFromDay` opens the sheet once post-creation,
  pre-seeded from existing row values, with heart. (M)
- [ ] **G2 "Log as look"** — extract `createLookFromItems`; second commit button in the
  +Clothing picker; wears POSTed with `outfit_id`; one post-log sheet. (M)
- [ ] **G6 "Wear again" chooser** — shared sheet from Home CTA + day-view footer. (M)
→ ✅ **DEPLOY**

### WAVE 6 — Context payoff + finish funnels
- [ ] **C1 context chips on the suggestion sheet** (empirical + seed fallback). (M)
- [ ] **C2 Contexts stats page.** (M)
- [ ] **P3 +Look picker funnel + plan-picker search.** (M)
- [ ] **Docs sync** — tick shipped boxes here; update `FILTER_UNIFICATION.md` Phase 3
  + `CLAUDE.md` sections touched. (S)
→ ✅ **DEPLOY**

### WAVE 7 — Flagship (build LAST)
- [ ] **"Today" tile on Home — weather-aware outfit of the day.** `navigator.geolocation`
  (keyless, permission-prompted, cache the last fix in `store`) → existing open-meteo
  plumbing (`fetchWeatherRange`) → pick season/level context → one `suggestOutfits()`
  pick rendered as a mini collage on a Home tile; tap → suggestion sheet. Degrade
  gracefully: no permission/offline → season-only pick. (L)
→ ✅ **DEPLOY**

### Build conventions for this plan
- One wave = one deploy at the ✅ checkpoint; bump `APP_VERSION` each deploy.
- No schema changes anywhere (`outfits.rating` already live in the DB).
- New UI uses the shared helpers (`chip()`, `sectionLabel()`, `openFilterSheet`,
  `itemGridView`, `funnelBtnHtml` once extracted) — never a new bespoke filter UI.
- Context/formality capture stays OPTIONAL on every path — never block a log on it.
- Parse-check before deploy: extract the inline `<script>`, wrap in `new Function(...)`,
  run via `osascript -l JavaScript` (no node locally; preview is login-only).
- Line numbers are as of `2026-07-01 r1` + the uncommitted builder diff; re-grep if
  drifted. Read `CLAUDE.md` (architecture, gotchas, nav model) before each wave.

---

## ✅ SHIPPED BUILD — "Unified Experience + Daily Loop" (planned 2026-06-26)

**Status: FULLY SHIPPED through Wave 5 (2026-06-27 r2). Wave 0 checkboxes below were
never ticked but all items shipped (verified in code 2026-07-06). Kept for history.**

This plan came out of a 3-part product + UX + unification review. The through-line:
the app is a collection of independent render functions that each re-decide layout,
sorting, filtering, density, and gestures. **Unify the "many items at once" experience,
make the daily wear-logging loop a ≤1-gesture reflex, and reduce one-handed reach.**

### Locked decisions (do not re-litigate)
- **A1** One-tap "Wear today": single tap on item photo-view Log = logs today immediately,
  then toast "Wear logged — add context?" with a chip that re-opens context. No modal.
- **A2** Context picker ordering: most-used contexts **for that specific item** first
  (`itemContexts(id)`), then the rest.
- **A3** Do NOT pre-select/pre-check a context.
- **A4** Home: when today has 0 wears logged, show a "Log today's wear" CTA (subtile/badge).
- **B1** Suggestion sheet: after the 8th result show a "New suggestions →" button that
  regenerates a fresh 8 (vary the random seed).
- **B2** Lightly downweight today's dismissed/skipped suggestion combos (session memory).
- **C1** Closet Review landing: pin **Formality** and **Color** to top as "Suggested",
  rest alphabetical.
- **C2** Keep manual field choice (do NOT auto-launch a field).
- **D1** Home calendar tile subtitle: "X wears logged today" (0 → "Nothing logged yet").
- **D2** Move "Closet vs. Your Life" to the TOP of the Stats page.
- **E2** Calendar day view: swipe left/right between days.
- **E4** Build `wears.formality_for` capture: after logging a wear/look, one-tap
  "How dressed up were you?" chip row (levels 1–8). Column already exists — no migration.
- **U1** Build a single `itemGridView(list, config)` component to replace the 7 grid
  wrappers. Fold into the design-system refactor.
- **U2** One shared sort menu everywhere: Color · Name · Newest · Most/Least worn ·
  Formality · Price. Remembered per surface. Replaces hardcoded color sort + count/name +
  category/formality toggles.
- **U3** One shared filter sheet callable from any grid (funnel icon). **MUST filter on
  everything it can** — current Search covers only Color/Fabric/Size/Season/Brand/Status;
  ADD **Formality, Category, Subcategory, Retailer, Acquisition, Price range**.
- **U4** Expose density (per-row) control on every grid via the shared controls bar.
- **U5** Long-press a grid tile → quick actions (Log today · Add to look · Move) without
  entering the item.
- **U6** One selection affordance everywhere (the dot); retire builder outline-only;
  trip pack-tick becomes a dot variant.
- **F1/UX-1** 44px minimum tap-target audit (item nav arrows, clback, sib buttons).
- **F2** Extract type-scale + spacing tokens and shared render helpers
  (`row()`, `sectionLabel()`, `chip()`, `sheet()`) before the feature wave.
- **F3** Sheet grabber pill + swipe-down-to-dismiss.
- **F4** Remove dev-scaffolding (`placeholder()` "We'll build this next"); give every
  empty/zero state a friendly line + a primary action.
- **New feature** "Make a look from today's logged items": in calendar day view, when ≥2
  solo items (`dayGroups` entries with `outfitId === null`) exist for the day, show
  "Create look from these N items" → creates `outfit` + `outfit_items`, back-fills
  `wears.outfit_id` so the day re-groups. **2+ items = a Look; 1 item stays an item.**
- **Bug** Stats "Least Expensive" must exclude $0/free items (`> 0`, not just `!= null`).
- **Gesture** Global swipe-right-from-left-edge = back (dispatch to active screen's back fn).
- **Rejected this round:** E1 duplicate-item, E3 swipe-log from Looks list, B3 suggest-from-search.

### Guardrails (unchanged, see §0 below): single-user · heuristics-only · one `index.html`
· plain `fetch` · `background-size: contain` · no libraries.

---

### WAVE 0 — Quick wins (independent, instant value) ✅ deploy after
- [ ] **Least Expensive excludes $0** — `buildSmartList` line 4882, `least-expensive`
  branch: filter `parseFloat(i.price) > 0`. (S)
- [ ] **Stats label fix** — `buildSmartList` `never-worn` (line 4862) + `renderStatsMain`
  `notLoggedLabel` (line 5128): rename "Not Logged on Calendar" → "Never Worn" (all-time) /
  "Not Worn · past N" (range). (S)
- [ ] **Home calendar tile subtitle** (D1) — `HOME_TILES` line 1290: `sub()` returns
  today's wear count from `wearDayMap()`. (S)
- [ ] **Closet-vs-Life to top of Stats** (D2) — `renderStatsMain` (5113): move
  `closetVsLifeHtml()` (5055) above Clothing Stats section. (S)
- [ ] **Closet Review field priority** (C1) — `renderReviewLanding` (5389): pin formality +
  color_family rows to top under a "Suggested" label, rest alphabetical. (S)
- [ ] **Suggestion "New suggestions →" + dismissal memory** (B1/B2) — `renderSuggestSheet`
  (3008): add regen button at end-of-list; track shown/dismissed piece-id sets in a
  session global, downweight in `scoreCombo` (2855). (M)
- [ ] **44px tap-target audit** (F1) — CSS lines 434/442/148: `.item-sib-btn`,
  `.item-nav-btn`, `.clback`/`.clsearch` → 44px hit area (padding, keep glyph small). (S)
→ ✅ **DEPLOY** (`2026-06-26 r5`)

### WAVE 1 — Foundation: tokens + helpers + grid component (behavior-preserving)
- [x] **Type-scale + spacing tokens** (F2/UX-2) — `--fs-xs..xl`, `--sp-*` in `:root`. (shipped r6)
- [x] **Shared render helpers** (F2) — `sectionLabel()`, `chip()` added. (shipped r7)
- [x] **Sheet grabber + swipe-down dismiss** (F3) — `.sheet` grabber + touch handler. (shipped r6)
- [x] **`itemGridView(list, config)`** (U1) — unified grid; surfaces migrate in Wave 2. (shipped r7)
- [x] **Shared grid-controls bar** (U2/U3/U4) — `showGridBar()`/`hideGridBar()` wrappers;
  sort + filter stub buttons added to `#gridBar`. (shipped r7)
→ ✅ **DEPLOY** (`r7`) — behavior unchanged; `itemGridView` ready for Wave 2 migration.

### WAVE 2 — Unified rollout: sort, filter, density, selection everywhere
- [x] **Migrate all 7 surfaces** to `itemGridView` — gridHtml, pickerGridHtml, builderItemGrid,
  capGroupsHtml all delegate to itemGridView; capItemTileHtml removed. (shipped r8)
- [x] **Shared sort menu** (U2) — Color · Name · Newest · Most/Least worn · Formality · Price;
  `#gbSort` button, `#sortMenuPop`, `sortItems()`, per-surface `_gridSortKeys` persisted to
  localStorage. Applied to closet + search grid. (shipped r8)
- [x] **Expanded shared filter sheet** (U3) — added Category, Subcategory, Formality,
  Retailer, Acquisition to `FILTERS`/`searchState`/`runSearch`. (shipped r8)
- [x] **Unified selection affordance** (U6) — dot everywhere via itemGridView migration;
  builder tiles now show dots for pieces already on canvas. (shipped r8)
- [ ] **Empty-state pass + remove scaffolding** (F4) — `placeholder()` defined but never
  called; existing empty states are already friendly. No action needed.
→ ✅ **DEPLOY** (`r8`)

### WAVE 3 — Daily logging loop
- [x] **One-tap "Wear today"** (A1) — `logWearToday()`: tap Log → immediate POST → toast
  "Wear logged" with "Add context →" chip. (shipped r9)
- [x] **Context picker ordering** (A2) — `renderContextPicker`: `_logItemId` drives
  per-item context frequency sort via `itemContexts()`. (shipped r9)
- [x] **`wears.formality_for` capture** (E4) — `openPostLogSheet(wearRows)`: context chips
  + 1–8 formality row; PATCHes all wears. Surfaces: A1 toast chip + look "Wear" flow. (shipped r9)
- [x] **Home "Log today's wear" CTA** (A4) — `renderHome`: no-wear-today shows `.log-cta`
  button → calendar day (today) + openCalAddClothing. (shipped r9)
→ ✅ **DEPLOY** (`r9`)

### WAVE 4 — Gestures & reach
- [x] **Swipe-right-to-go-back, app-wide** — one left-edge (<24px) swipe listener;
  dispatch to active screen's back fn (`closetBack` / `looksBack` / `statsNavBack` /
  calendar). (shipped r1 2026-06-27)
- [x] **Day-view swipe between days** (E2) — `renderCalendarDay`: horizontal swipe →
  prevD/nextD; skips if touch starts on a cal-outfit-card. (shipped r1 2026-06-27)
- [x] **Swipe between sibling items in detail** — `openItem`: swipe photo →
  `siblingItems()` prev/next. (shipped r1 2026-06-27)
- [x] **Long-press tile quick-actions** (U5) — 500 ms long-press on `.gtile[data-item]` →
  `#quickActSheet` (Log today · Add to look · Move to folder). (shipped r1 2026-06-27)
→ ✅ **DEPLOY** (`r1` 2026-06-27)

### WAVE 5 — New capture feature
- [x] **Make-a-look from today's logged items** — `renderCalendarDay`: when ≥2 unique
  items in solo groups (`outfitId === null`), shows accent "Create look from these N items"
  button; POSTs outfit + outfit_items, PATCHes wears.outfit_id, rebuilds indexes,
  re-renders day. Toast with "View →" shortcut to Looks tab. (shipped r2 2026-06-27)
→ ✅ **DEPLOY** (`r2` 2026-06-27)

### Build conventions for this plan
- One wave = one or more deploys; **always deploy at the ✅ checkpoint** before starting the
  next wave so regressions are isolated.
- Bump `APP_VERSION` each deploy (line 871). Same-day = increment `rN`.
- After Wave 1, **build all new UI with the shared helpers/tokens**, never inline styles.
- No schema changes needed anywhere in this plan (formality_for column already live).

---

## What's shipped (rework series, 2026-06-20 → 2026-06-25)

All screens are fully built. Per-release detail in `archive/CLAUDE_build_history.md`.

- ✅ Home launcher (Stylebook tile grid)
- ✅ Closet: status lens, category folder drill, item detail (two-view), field editing, bulk select/edit/delete/move, prev/next item nav, root jump link
- ✅ Add Item: photo, all fields, inline category picker
- ✅ Search: keyword + 6 filter rows
- ✅ Looks: lens switcher (Formality/Season/Recent/All), outfit collage, look detail, formality override, nudge pieces, active-capsule scoping
- ✅ Build-a-look canvas: pointer drag+resize, save to `outfits.layout`, entry from Looks + item detail
- ✅ Calendar: month grid with mini collages, day view, swipe copy/move/delete, log Clothing + Look
- ✅ Style Stats: Clothing Stats + Looks Stats + View Closet By; field donut; smart list grids; filter + range sheet
- ✅ Closet Review: inline field picker on deal card, shuffled queue, review formality
- ✅ Bulk edit: includes Formality
- ✅ Capsules & Trips: list/detail/form/add-items picker; packing checklist; weather strip (Open-Meteo); Rename/Duplicate/Share list; "Plan outfits from this" scopes Closet + Looks
- ✅ Outfit suggestions: slot-filling engine; formality cohesion + color co-occurrence + rotation scoring; exclusions hard filter; softmax variety; "no-suggest" tag; capsule-scoped mode; feedback sheet (exclusions)
- ✅ Closet-vs-life gap in Stats
- ✅ Schema: 1–6 formality (`items.formality`), `wears.formality_for`, `outfits.rating`, `exclusions` table

---

## Back-burner (not yet scheduled)

These are agreed-on ideas parked for a future session. No timeline.

**Features:**
- Capsule suggestions improvements: variety seeding, multi-anchor ("these jeans AND these boots"), constraints ("no heels today"), context picker
- ✅ Multi-exclude UI — shipped r3, reworked r4 2026-06-27. `openExcludeSheet` lists every unordered
  PAIR among the shown pieces as a toggle row (thumbnails + names); the user ticks only the specific
  pairs that clash (A×B can be excluded while A×C stays fine). Already-excluded pairs show locked.
  Each ticked pair → its own exclusion row. NOT subset-pairwise, NOT "none of these".
- ✅ Context typeahead — shipped r3 2026-06-27. `renderContextPicker` "+ Add…" input now live-filters
  known contexts (`contextOptions()`) and offers tap-to-pick or "+ Create". Routed into suggestion
  "Wear today" + calendar +Clothing/+Look flows via `openPostLogSheet`.
- ✅ `wears.formality_for` capture — shipped r3 2026-06-27. `openPostLogSheet` (context + 1–8 formality)
  now also fires after suggestion "Wear today", calendar +Clothing, and calendar +Look (previously
  only solo-log + look-detail wear).
- ✅ Builder subcategory drill + scoped search (Phase 3a) — already implemented in `builderPickContent`
  (cat → subcat folders → grid, scoped search, quick-switch subcat chips). Verified r3 2026-06-27.
- ✅ Season derive-and-confirm in Closet Review (Phase 3c) — shipped r3 2026-06-27. Season + Formality
  REVIEW_FIELDS now carry `guess`/`guessLabel`; the deal card pre-fills the derived value and shows a
  "✨ Guessed from… — confirm or change" hint that clears once the user edits.
- ~~Outfit rating~~ → SCHEDULED: hearts, Wave 3 of the v2 build above (👎 still rejected)
- ~~"Outfit of the day" on Home connected to weather~~ → SCHEDULED: Wave 7 of the v2 build
- ~~Wear-logging loop overhaul~~ → SCHEDULED: Waves 1+5 of the v2 build (Undo, back-date,
  single-ask, log-as-look, wear-again). Long-press grid log already shipped (W4 quick-actions).

**Guessed-value indication (r3 2026-06-27):** Formality imputation (`itemFormalitySet`) shows `est.`
in detail/looks AND now pre-fills + labels in Closet Review. Season guess (`guessSeason`) labeled in
review. `date_is_guess` deliberately left OUT of review (476 imported items would flood the queue;
already indicated via month-only display).

**Infrastructure:**
- Reorder capsules (needs an `order` column on `capsules`)
- Crop/rotate photo editor
- ✅ Auto-refresh trip weather — shipped r3 2026-06-27. `_wxAutoTimer` re-fetches the weather strip
  every `WX_TTL` (10 min) while a trip detail is open (cleared on re-render + tab switch); manual ↻
  refresh button added to the Locations header.

---

## North star & guardrails (locked)

- **Single-user.** No social/sharing/multi-account features.
- **Heuristics only, no AI backends.** Client has only the Supabase anon key. "Smart" = analytics + rules over own data + keyless external APIs (open-meteo). No Edge Functions, no server proxy.
- **Derive-first, capture-light.** Compute from existing data. Add a captured field only when it can't be derived and a feature in hand needs it.
- **One `index.html`.** No build step, no CDN, no libraries.
- **Plain `fetch`.** No supabase-js.
- **`background-size: contain`** on all garment photos, always.

---

## Full data reset (planned)

Once feature-complete, the user will update Airtable with new schema fields, wipe
Supabase, and re-import. Plan: `migration/RESET_PLAN.md`.
