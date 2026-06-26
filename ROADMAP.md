# ROADMAP — Wardrobe App

> Read `CLAUDE.md` (architecture + conventions) and `schema.sql` (DB) alongside this.
> Current version: **2026-06-25 r6**.

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
