# Filter Unification — design & handoff

Living spec for the cross-app filter rework. Read with `CLAUDE.md`.
**Status: Phase 1 shipped (2026-06-29 r3). Phase 2 SHIPPED (commit `c468226`, ~2026-06-30):
unified `openFilterSheet` + `itemMatchesFilter`/`outfitMatchesFilter` live on Closet,
Stats, Looks; standalone Search screen retired; per-surface dim lists
(`CLOSET/STATS/LOOKS_FILTER_DIMS`) + per-surface states (`closetFilter` etc.).
Phase 3 (pickers) is planned — see `ROADMAP.md` "Hearts + Filters Everywhere".**

## Why this exists

A filter audit found the app filtered items in many divergent ways. The user
decided to unify all of it into ONE powerful filter available across surfaces.

### The 7 audit findings and the decisions

1. **Status had three different defaults** (Closet=Available, Search=all incl.
   Archive, Stats=all-but-Archive, Review=Available). → **Decision: status default
   is always Available.**
2. **`i.status` vs `itemStatus(i)`** — null status appeared in Closet but not
   Stats/Review. → **Decision: read status only via `itemStatus(i)` (null→Available).**
3. **Season filters ignored derived seasons** (Search/Stats used explicit `i.season`;
   suggestions used derived `itemSeasonSet`). → **Decision: Search & Stats filter on
   DERIVED season too; user promotes derived→explicit via Closet Review.**
4. **Formality encoded 3 ways** (string / label-index / numeric). → **Decision:
   canonical numeric levels 1–8 + shared predicates.**
5. **Two filter UIs (Search 12-dim, Stats 4-dim) with no in-place option.** →
   **Decision: ONE unified filter, available everywhere, applied in place.**
6. **`STATUSES` still listed "Wishlist".** → **Decision: drop Wishlist.**
7. **Capsule scope was all-or-nothing and invisible to Stats/Calendar.** →
   **Decision: capsule becomes a FILTER DIMENSION (so you can scope any surface,
   incl. Stats, to a trip's pieces).**

### Scope decisions (from the user)

- **Surfaces to unify this round: Closet, Stats, Looks.** (Calendar deferred.)
- **Fold the standalone Search screen into an in-place Closet funnel** — the search
  icon opens the unified filter; retire the separate `#tab-search` results flow.

## Phase 1 — DONE (shipped r3)

Logic unified; data-semantics decisions implemented. No UI change yet.

- Canonical predicates added after `inSeason` (~`index.html:3447`):
  - `matchesFormality(i, level)` — `itemFormalitySet(i).includes(level)`, numeric 1–8.
  - `matchesSeason(i, season)` — DERIVED via `itemSeasonSet`; unknown season = NO match
    (a positive filter shouldn't qualify a no-signal item). Note: `inSeason()` (used by
    SUGGESTIONS) is different — it treats unknown as all-season-eligible. Keep both.
- `runSearch` now uses `hitSeason`/`hitFormality` → the shared predicates.
- `statsPool` now: status via `itemStatus(i)`; season via `matchesSeason`; formality via
  `matchesFormality`. Empty status filter still excludes Archive.
- `reviewPool` uses `itemStatus(i)`.
- `STATUSES` = `["Available","Storage","Archive"]` (Wishlist gone).

## Phase 3 — TODO (pickers + calendar; execution plan in ROADMAP.md)

Phase 2 unified the three browse surfaces but left the **pickers** on legacy filtering:

- **Calendar +Clothing picker** (`renderCalClothingPicker`) and **capsule add-items
  picker** (`openCapsulePicker`) share the `_capPick*` state + `pickerPool()` — own
  status chips + category folders, NO unified funnel, **no capsule dimension** (the
  reported bug: "filter by capsule doesn't appear when adding clothes on calendar").
  → shared `pickerFilter` + funnel; capsule dim included; status/cat/subcat excluded
  (picker keeps its own chips/folders).
- **Builder picker** — funnel added (in-flight diff, `builderFilter` +
  `BUILDER_FILTER_DIMS`); commit + deploy in Wave 0.
- **Calendar +Look picker** (`renderCalLookPicker`) — keyword only → add funnel with
  `LOOKS_FILTER_DIMS` via `outfitMatchesFilter`.
- **Trip plan look picker** (`openPlanLookPicker`) — no search at all → add keyword +
  liked-first.
- Extract `funnelBtnHtml(id, state)` — the funnel-button+badge markup is copy-pasted
  per surface today.

## Phase 2 — SHIPPED (the unified funnel UI; spec kept for reference)

Goal: one filter model + one reusable sheet, wired into Closet, Stats, Looks.

### 1. Shared filter model + predicate
- Reuse the dimension list in `FILTERS` (`index.html:2843`) but make it the single
  source. Dimensions: keyword, color, fabric, size, season, brand, status, category,
  subcategory, formality, retailer, acquisition, **capsule**.
- New `itemMatchesFilter(i, state)` — built from today's `runSearch` body:
  - keyword over name/brand/notes/retailer/category/subcategory
  - scalars via `hit`, arrays via `hitArr`
  - season → `matchesSeason`, formality → `matchesFormality` (already shared)
  - status → `itemStatus(i)`; **empty status dimension ⇒ exclude Archive** (universal
    "hide archived junk" default; a surface wanting Available-only pre-seeds `["Available"]`)
  - capsule → membership via `capsuleNamesForItem(i.id)` or `capsuleLinkMap`
- Per-surface state objects with sensible defaults:
  - `closetFilter` → status `["Available"]` (replaces the lens default)
  - `statsFilter` → status `[]` (⇒ all-but-Archive)
  - `looksFilter` → status `[]`
  - Each is a `newFilterState()` clone; never share one mutable object.

### 2. Reusable filter sheet
- One `openFilterSheet(state, { onApply, title })` rendering the same expandable chip
  rows `renderSearch` uses (`FILTERS.map(...)`), plus a keyword input, Reset, and a live
  result count. Mutates `state` and calls `onApply()` to re-render the surface in place.
- A funnel icon + active-count badge in each surface's toolbar. A clearable summary
  chip-row under the toolbar showing active dimensions.

### 3. Wire surfaces
- **Closet:** replace the bounce-to-Search. `lensItems()` becomes
  `items.filter(i => itemMatchesFilter(i, closetFilter))` (capsule scope folds into the
  capsule dimension; keep category/subcategory **folders as navigation**, intersected
  with the filter). The `#clSearch` icon opens the unified sheet (keyword at top). Retire
  `renderSearch`/`#tab-search` (or keep `openSearch` as an alias that opens the sheet).
  `activeCapsuleId` banner → becomes a shortcut that pre-sets the capsule dimension.
- **Stats:** replace the 4-dim sheet (`statsFilters`, `#statsFilterSheet` ~`6000`) with
  the unified sheet → `statsPool()` = `items.filter(i => itemMatchesFilter(i, statsFilter))`.
  Keep `statsDateRange` + `statsAcqRange` SEPARATE (they're time filters, not item attrs).
- **Looks:** add `outfitMatchesFilter(o, state)`. **OPEN DESIGN QUESTION** — intersection
  vs subset semantics: does a look match if ANY piece passes (e.g. "looks containing a
  summer top") or only if ALL pieces pass (e.g. "an all-summer look")? Recommend: ANY-piece
  for attribute dims (color/season/formality), and ALL-pieces for scope dims (status/capsule,
  i.e. reuse `outfitFullyInCapsule`). Confirm with user before building. Keep the existing
  Formality/Season/Capsule lens folders; the filter narrows within them.

### Gotchas / constraints
- Single `index.html`, plain `fetch`, no libs (see `CLAUDE.md` hard constraints).
- Function declarations hoist, so predicate call-sites above their definitions are fine.
- Don't reuse one mutable `filterState` across surfaces — clone per surface.
- `#tab-search` removal: also clean `switchTab`'s `name==="search"` branch, `openSearch`,
  the search screen markup, and any `searchResults` grid special-casing in `renderCloset`.
- Verify by parse-check (no node locally): extract the inline `<script>`, wrap in
  `new Function(...)`, run via `osascript -l JavaScript`. Local preview is login-only.

## Deploy
Bump `APP_VERSION`, commit, push (see `deploy-wardrobe` skill). Live:
https://aluke0311.github.io/wardrobe_app/ — hard-refresh after deploy.
