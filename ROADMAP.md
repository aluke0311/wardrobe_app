# ROADMAP — Wardrobe App

Forward-looking feature plan. Read alongside `CLAUDE.md` (architecture + hard
constraints) and `schema.sql` (data model). The "what's already built" history
lives in `CLAUDE.md`; this file is the plan for what's next.

## North star & guardrails (decided 2026-06-18)

- **Personal, single-user tool.** Optimize for one closet (the owner's). No
  multi-user accounts, no social/sharing layer, no monetization. Don't add
  features that only make sense for a multi-user product.
- **Heuristics only — no "true AI", ever (current decision).** Stay strictly
  static: the client ships only the Supabase **anon** key. A secret model key
  (Claude, vision, etc.) must never reach client code, so we are **not** adding a
  server proxy / Supabase Edge Function. "Smart" behavior comes from analytics +
  rules over our own data, plus **keyless** external data (e.g. open-meteo for
  weather). This rules out: stylist chat, photo auto-tagging / background removal,
  embedding / semantic search. (Revisit only if the no-backend stance changes.)
- **Thumbnail outfits, no collage canvas.** Outfits stay clean photo-thumbnail
  sets; we are not building a free-form drag/resize/layer canvas.
- All existing **hard constraints from `CLAUDE.md` still hold**: one `index.html`,
  plain `fetch`, no libraries/CDN, mobile-first, Supabase REST + Storage only.

## The 7 subsystems (framing) — where we stand

1. **Closet database** — *strong*; rich schema live. Gaps: hierarchy nav,
   multi-select, laundry state. → Phase A.
2. **Image processing** — *intentionally minimal* (manual photo + WebP compress).
   Auto bg-removal / auto-tagging are AI → **out of scope** by the decision above.
3. **Outfit builder** — *basic* thumbnail sets (kept as-is; no canvas).
4. **Recommendation engine** — *none yet*; will be **heuristic** only → Phase D.
5. **Usage tracking** — *strong* (wears, CPW, history). Stats rebuild → Phase C.
6. **Planning** — *partial*; capsules done, calendar + wishlist → Phase B.
7. **Social** — *out of scope* (single-user).

## Done so far (see `CLAUDE.md` for detail)

Phase 3a core ✓ · 3b capsules + closet lens ✓ · 3c outfits ✓. App deployed.

## Plan

Legend: ✅ easy · ⚙️ moderate · 🧗 heavy. Legacy phase tags (3d/3e/3f) noted where
they map. Build in verifiable slices; keep the app working each step.

### Phase A — Closet usability *(in progress — started 2026-06-18)*
The closet doesn't scale to 476 items as a flat grid. Borrow Stylebook's
drill-down.
- **A1 ⚙️ Two-level drill-down**: Closet → category (count + thumbnail) →
  subcategory (count + thumbnail) → photo grid. Top-level search stays flat
  across everything. The capsule **lens** keeps its current behavior (flat
  filtered grid). Status (Available/Storage/Archive) stays a switcher at the
  closet root. Plus a **2/4-column density toggle** on the photo grid.
- **A2 ⚙️ Multi-select + batch actions**: a Select mode in the grid → act on many
  items at once: move status, **add to a capsule**, edit tags, delete.
- **A3 ✅ Laundry / availability state**: clean · in-laundry · at-cleaners ·
  lent-out — surfaced so a wear-log / outfit can flag what's actually wearable
  now. (New column on `items`; default clean.)

### Phase B — Planning & history
- **B1 ⚙️ Calendar (legacy 3d)**: month grid; tap a day to see/log worn items
  *and* outfits; multiple looks per day; log a single item without an outfit;
  plan future dates. Mostly a view over existing `wears`.
- **B2 ⚙️ Capsule polish**: packing checklist (tick as packed), **add an outfit
  to a capsule** (auto-pulls its items), destination image (+`image_path` on
  `capsules`), reorder capsules.
- **B3 ⚙️ Wishlist + "shop your closet"**: track candidate purchases with
  projected cost-per-wear and "how many outfits would this fit" before buying.

### Phase C — Stats + wardrobe intelligence (legacy 3e; pure analytics)
- **C1 ⚙️ Stats rebuild**: most/least/never worn, closet value, brand spend,
  category/color/season breakdowns, avg items/look, recently added — plus the
  owner's Airtable **Goal CPW / Total Score / Action Needed** formulas
  (still TODO: read those formula fields from Airtable and reproduce the logic).
- **C2 ⚙️ Wardrobe-intelligence cards**: "you own N sweaters, M black, K unworn
  >1yr", duplicate detection, gap analysis, closet utilization %, and a declutter
  assistant with a keep/sell/donate/archive state on items.

### Phase D — Heuristic styling (rules + keyless weather)
- **D1 ⚙️ Rule-based outfit suggestions**: occasion-range overlap (already
  computed) + season + color harmony + recently-worn avoidance.
- **D2 ⚙️ Weather + calendar daily pick**: open-meteo (no key) + today's context.
- **D3 ⚙️ Capsule / packing auto-generation**: optimal combos from the existing
  wardrobe for a trip's dates + weather.
- **D4 ⚙️ Outfit power tools (legacy 3f + extras)**: merge the ~1,543 import
  duplicates into reusable sets, clone outfit, one-tap re-wear, Outfit Shuffle.

### Cross-cutting backlog (slot in opportunistically)
Export/backup JSON · body measurements / sizes by type / brand size exceptions ·
Home hub + slimmer bottom nav (revisit once the tab count grows past ~7).

## Explicitly NOT doing (by decision, not omission)
AI auto-tagging / background removal · stylist chat · semantic / embedding search ·
server proxy / Edge Functions · outfit collage canvas · social sharing ·
multi-user / accounts / monetization · built-in shopping/retailer browser ·
editorial content ("Style Expert").
