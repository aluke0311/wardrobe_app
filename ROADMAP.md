# ROADMAP — Wardrobe App

> Read `CLAUDE.md` (architecture + conventions) and `schema.sql` (DB) alongside this.
> Current version: **2026-06-26 r4**.

---

## ▶ NEXT BUILD — "Unified Experience + Daily Loop" (planned 2026-06-26)

**Status: APPROVED, execution-ready. All decisions locked (see below). Build in wave
order; deploy at each ✅ checkpoint via the `deploy-wardrobe` skill (bump `APP_VERSION`,
commit, push). When the user says "continue the build," start at the first unchecked item.**

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
- [ ] **Swipe-right-to-go-back, app-wide** — one left-edge (<24px) swipe listener;
  dispatch to active screen's back fn (`closetBack` 1505 / `looksBack` / `statsNavBack` /
  calendar). (M)
- [ ] **Day-view swipe between days** (E2) — `renderCalendarDay` (4080): horizontal swipe →
  prevD/nextD (already computed, 4127). (M)
- [ ] **Swipe between sibling items in detail** — `openItem` (1584): swipe photo →
  `siblingItems()` prev/next. (M)
- [ ] **Long-press tile quick-actions** (U5) — on `itemGridView` tiles: long-press →
  small action sheet (Log today · Add to look · Move). (M)
→ ✅ **DEPLOY** (`r9`)

### WAVE 5 — New capture feature
- [ ] **Make-a-look from today's logged items** — `renderCalendarDay` (4080): when ≥2
  solo groups (`dayGroups` w/ `outfitId === null`), show "Create look from these N items";
  create `outfit` + `outfit_items`, PATCH those `wears.outfit_id`, re-render day. 1 item =
  no button. (M)
→ ✅ **DEPLOY** (`r10`)

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
- Multi-exclude UI: "none of this works" → pairwise-excludes all shown items
- Context typeahead on suggestion sheet + calendar log flow
- `wears.formality_for` capture UI (one-tap demand capture after logging a wear)
- Builder subcategory drill + scoped search (Phase 3a)
- Season derive-and-confirm in Closet Review (Phase 3c)
- Outfit 👍/👎 rating (`outfits.rating` exists, UI not built)
- "Outfit of the day" on Home connected to weather
- Wear-logging loop overhaul: multi-select fast logger from day view, long-press grid log

**Infrastructure:**
- Reorder capsules (needs an `order` column on `capsules`)
- Crop/rotate photo editor
- Auto-refresh trip weather

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
