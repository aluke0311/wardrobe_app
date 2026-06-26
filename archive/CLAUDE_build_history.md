# Wardrobe App — Build History (archived from CLAUDE.md)

Covers the rework sessions (2026-06-20 → 2026-06-25). The pre-rework v25 app is
preserved at git tag `v25-full` and `archive/index_v25_full.html`.

## 2026-06-20 session: full UI rework

The user felt overwhelmed by v25's accumulated complexity and wanted to reset to a
Stylebook-inspired calm UI. The Supabase engine (auth, fetch, data loading, image
compression, signed URLs) was carried over verbatim; the UI was rebuilt from scratch.

## Per-release notes (rework series)

### r1 — Home launcher
Stylebook-style calm tile grid (5 tiles: Closet · Looks · Calendar · Capsules · Style
Stats). Bottom nav (5 tabs), login, boot path. App boots to Home. Settings via ⚙ gear;
Add Item via ＋ on Home header. All non-Home tabs are honest stubs.

### r2 — Closet + Search + item detail
- Status lens switcher (Available/Storage/Archive/All) at top of Closet root.
- Category folder list → subcategory list → item grid (Stylebook in-place drill).
- Item detail: hero photo, 6 attributes, KPI row, status move bar with optimistic PATCH.
- Search: keyword + Color/Fabric/Size/Season/Brand/Status filter rows → chip multi-select.

### r3 — Grid toolbar (density + select + bulk actions)
- Grid density picker (2/3/4/5 per row), persisted to localStorage.
- Select mode with DOM-surgery `toggleSelect()` (no full re-render).
- Bulk edit sheet: Color/Fabric/Size/Season/Brand/Status.
- Delete selected + Move-to-folder sheet.

### r4 — Select mode fixes + "All Items in [cat]"
- Action icons only appear when select mode is active; live count shown.
- "All Items in [cat]" = tappable `data-sub="__all__"` row.

### r5 — Item detail redesign (two-view, full editing)
- Photo view (`openItem`): full-height photo + item-nav; tab bar hidden; `#itemBar`.
- Details view (`openItemDetails`): scrollable section with all fields, pricing, stats.
- Field edit sheet (`#fieldSheet`) with FIELD_CONFIGS; `_fieldEditItem`/`_fieldOnSave` dual-mode.
- `deleteItem`, `openItemMoveSheet`, `openLogWear`.

### r6 — Item detail polish + Add Item
- Details header: thumbnail + name/brand/category. Notes auto-save debounce.
- Brand typeahead + fabric filter input.
- Add Item screen (`renderAdd`/`_renderAddBody`/`saveNewItem`); reuses `#moveSheet` with `_addCatMode`.

### r7 — Looks tab
- `buildOutfitIndexes()`, lens switcher (Formality/Season/Recent/All).
- Collage, `openLook` detail, `openWearLook`, `deleteLook`.

### r8 — Grid collages + per-piece formality correction
- 2-col CSS grid collage.
- `openOccasionEdit(itemId, onSaved)` reuses `#logSheet`.

### r9 — Whole-look formality override + nudge pieces
- `outfitBucket()` checks `formality_override` first.
- `openLookFormalityEdit(id)`, `showNudgePiecesSheet(outfitId, bucketKey)`.

### r10 — Collapse formality to 5 levels
- `OCCASION_LADDER` = 5 labels: Lounge/Casual/Smart/Dressy/Formal.
- DB migration: drop CHECK 1–7, remap values, add CHECK 1–5.

### r11 — Calendar tab
- Month grid with mini collages; day view with outfit groups; swipe actions (Copy/Move stubbed).
- Stats strip: Most Worn This Month + streak.

### r12–r16 — Style Stats tab (fully built)
- Main page: Clothing Stats + Looks Stats + View Closet By.
- Field breakdown pages with donut SVG.
- Smart list grids (`buildSmartList`), TOGGLE_GROUPS, METRIC_LISTS.
- Item detail from stats (`openItemFromStats`, `_fromStats`).
- Filter sheet (funnel icon), Range button, acquired range filter.
- Retailer field, dynamic labels, tile subtitles.
- Looks Stats → Most Worn Looks.
- Closet Review (`statsView "review"/"review-deal"`), `startReview`/`renderReviewDeal`/`reviewAfterEdit`.

### r17 (first series, 2026-06-22) — Stats Stylebook refinement
- Stats main reorganized to three card-sections.
- Range button (`#stRange`) with own sheet; range resets on every navigation.
- CPW now range-aware. Purchase Price toggle grid.
- Number-only metric tiles (`.gtile-metric`).
- "Not Logged on Calendar" row (was "Never Worn").
- `wireStatsToolbar()` / `statsRebuild()` / `openStatsFilters()` refactor.

### r7–r10 (capsules series, 2026-06-22) — Capsules & Trips
- Full Capsules tab: list/detail/form/pick. Two modes: Capsule + Trip (packing checklist).
- Insight strip, `activeCapsuleId` scopes Closet + Looks.
- Trip weather (Open-Meteo geocoding + forecast + ERA5 + 3-yr avg).
- Capsule detail grouped by category/formality; packed progress per category.

### r11 — Build-a-look v1 (multi-select) — REMOVED in r12
Multi-select picker removed; replaced by canvas. Don't reintroduce `gbLook`/`lookPickId`.

### r12–r13 — Build-a-look canvas
- Free-form builder (`#tab-builder`); pointer drag+resize; `builder` global state.
- `saveBuilder()` writes `outfits.layout` JSONB; `layoutCanvasHtml(o, wrapCls)` shared renderer.
- Migration required: `migration/outfit_layout.sql`.

### r14 — Item photo replace/add/remove
`pickItemPhoto`/`replaceItemPhoto`/`removeItemPhoto`; footer state-aware.

### r15 — Calendar: log from day view
`openCalAddClothing` + `openCalAddLook`; reuse shared picker machinery.

### r16 — Capsule rename + duplicate
`renameCapsule` + `duplicateCapsule`; footer: Rename · Duplicate · Share list.

### r17 (capsules series) — Active-capsule lens in Looks
`looksScopedOutfits()` filters to wearable looks from the active capsule.

### r18 — Share capsule/packing list
`shareCapsuleList` → `capsuleListText`; `navigator.share` → clipboard → execCommand fallback.

---

## 2026-06-25 session: Phase 2–6 (formality rework + features)

### r1 — Phase 2: 1–6 formality model
- `OCCASION_LADDER` updated to 6 levels: Function/Very Casual/Everyday Casual/Smart Casual/Dressed Up/Formal.
- `items.formality` (single int 1–6) replaces `min_occasion`/`max_occasion`.
- `itemFormality(i)` reads `i.formality`, falls back to SUBCAT_FORMALITY/CAT_FORMALITY.
- `migration/formality_schema.sql` adds `formality`, `formality_for`, `outfits.rating`, `exclusions` table.

### r2 — Phase 4: outfit suggestions + closet-vs-life gap
- `suggestOutfits(targetLevel, seedItemId)`: slot-filling (Top/Dress + Bottom + Shoes + Outerwear).
- Scoring: formality cohesion, color co-occurrence, rotation (daysSince), exclusions hard filter.
- `renderSuggestSheet()`: canvas preview + formality chips + Wear/Build/Feedback.
- Closet-vs-life gap chart in Stats (supply vs. demand by formality bucket).

### r3 — Suggestion feedback (never-suggest, cardigan slot, nav fixes)
- `NO_SUGGEST_TAG = "no-suggest"` in `items.tags`; `isNoSuggest(i)`, `setNoSuggest()`.
- `suggestSlot(i)`: Cardigans → "Outerwear" for slot purposes.
- `renderFeedbackSheet()`: "Don't suggest this item" + exclusion pair builder.
- Edit Item from review now switches tabs correctly.

### r4 — Item prev/next, closet root jump, shuffled review, function-1 isolation
- `siblingItems()` derives the current browsing list for prev/next arrows in `openItem`.
- "Closet" link at bottom of subcategory grid returns to root.
- Closet Review queue randomized via Fisher-Yates `shuffle()` on `startReview`.
- `formalityOk(its)`: Function items (level 1) never mixed with non-Function.

### r5 — Bulk-edit formality + closet review inline editing
- `BULK_FIELDS` gains `{key:"formality", type:"formality"}` → numbered chip column layout.
- `renderReviewInline(fieldKey)` shows chips/inputs directly on the review card.
- `_rvPending` holds the pending value; "Save & Next →" in one tap.

### r6 — Capsule-scoped outfit suggestions + weighted-random variety
- `openSuggestSheet(seedItemId, capsuleId)`: when capsuleId set, pool = capsule members only.
- `_suggPool()` supplies the pool on every regenerate/level-filter.
- Capsule detail gains "Suggest an outfit" button (`data-cap-suggest`).
- Weighted-random softmax sampling (t=0.5) across top 20 candidates → variety on every call.
