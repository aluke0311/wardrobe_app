# ROADMAP — Wardrobe App (v2)

Forward-looking feature plan. Read alongside `CLAUDE.md` (architecture + hard
constraints) and `schema.sql` (data model). The "what's already built" history
lives in `CLAUDE.md`; this file is the plan for what's next.

## North star & guardrails (decided 2026-06-18)

- **Personal, single-user tool.** Optimize for one closet (the owner's). No
  multi-user accounts, no social/sharing, no monetization.
- **Heuristics only — no "true AI", ever (current decision).** Stay strictly
  static: client ships only the Supabase **anon** key; **no server proxy / Edge
  Function**. Rules out stylist chat, photo auto-tagging / background removal,
  embedding / semantic search. "Smart" = analytics + rules over our own data +
  **keyless** external data (open-meteo weather).
- **Thumbnail outfits, no collage canvas.**
- **Data philosophy — derive-first, capture-light.** Compute everything we can
  from data already logged (wears, outfits, prices, dates, occasion ranges) — it
  is free and never goes stale. Add a new *captured* field only when (a) it can't
  be derived and (b) a feature we're building now consumes it. Capture subjective
  data **at the moment of use** (a one-tap rating when logging a wear), not as a
  per-item chore. Prefer batch entry (multi-select) for any field applied across
  many items.
- All existing **hard constraints from `CLAUDE.md` still hold**: one `index.html`,
  plain `fetch`, no libraries/CDN, mobile-first, Supabase REST + Storage only.

Two design rules that fall out of "derive-first":
- **Pairings / "matches with" / orphans are derived from outfit co-occurrence**
  (what you actually wear together) — *not* a hand-maintained relationship graph.
- **Item "confidence/trust" is derived from wear ratings**, not a typed field.

## The 7 subsystems — where we stand
1. **Closet database** — *strong*; rich schema. Gaps: hierarchy nav ✓(A1), multi-
   select, laundry/care, a few optional fields. → Phase A.
2. **Image processing** — *intentionally minimal*; auto bg-removal/tagging is AI →
   **out of scope**.
3. **Outfit builder** — *basic* thumbnail sets (kept; no canvas).
4. **Recommendation engine** — *none yet*; **heuristic** only → Phase D.
5. **Usage tracking** — *strong*; ratings + the Insights rebuild → A4 + Phase C.
6. **Planning** — *partial*; capsules done, calendar/wishlist/events → Phase B.
7. **Social** — *out of scope*.

## Done so far (see `CLAUDE.md` for detail)
3a core ✓ · 3b capsules + closet lens ✓ · 3c outfits ✓ · A1 hierarchical closet +
density ✓ (v4) · Phase A slices 2–4 ✓ (v5): nav→6 tabs (Add-in-Closet, merged Log
tab, new Fill tab), the random-item Fill page, and sortable grids · **slice 5 ✓
(v6): multi-select + batch (move / capsule / tag / delete)**.

## Plan

Legend: ✅ easy · ⚙️ moderate · 🧗 heavy. New columns are added *with* the feature
that uses them (not up front); all new captured fields are **optional**.

### Phase A — Closet usability, navigation & light data model
Build order (each slice shippable on its own):
1. **Hierarchical closet + density** ✅ done — category→subcategory drill-down +
   2/4-col density toggle (shipped v4).
2. **Nav restructure** ✅ done (v5) — **Add** moved into the Closet (＋ in the top
   header bar, shown on the Closet tab); **Wear + Outfits merged into one `Log`
   tab** with a segmented *Single item | Outfit* toggle; new **`Fill`** tab. Bottom
   nav is now 6: `Closet · Log · Capsules · Fill · Stats · Settings`. (Pulled the
   Phase-E nav target forward; the Home dashboard itself stays in E.)
3. **Fill page** ✅ done (v5) — a "fun" data-completion screen: one **random item**
   (favors items with a photo), surfaces its **highest-priority empty field**, fast
   input (chips/segmented for set fields, box for free text), **Save → next** +
   **Skip** + **Edit full item** + a progress count. Targets the capture-light
   fields: **occasion range, color, subcategory, season, fabric, price, acquisition,
   size** (care/storage/fit will join once those columns exist).
4. **Sorting** ✅ done (v5) — photo grids sortable by recently-added · name A–Z ·
   **color** (palette order) · category · brand · price ↑↓ · times-worn ·
   cost-per-wear · recently-worn · longest-unworn. **Default sort set in Settings**
   (persisted); a per-grid control overrides for the session.
5. **Multi-select + batch actions** ✅ done (v6) — a **Select** button in the tile
   grids enters select mode; tap tiles to pick; a dark action bar offers **Move**
   (status), **Capsule** (add to / new-with-these), **Tag** (append tags), and
   **Delete** — all operating on the whole selection via bulk endpoints.
6. **Laundry/availability + care** ⚙️ — clean · in-laundry · at-cleaners ·
   lent-out, plus care method + **needs-repair / needs-tailoring** flags
   (→ smart collections later). New optional `items` columns.
7. **One-tap wear/outfit ratings (START COLLECTING EARLY)** ⚙️ — loved-it / fine /
   didn't-work + optional "got compliments" + a short felt-note, on the `Log`
   flows. New `wears` columns (+ `outfits`: rating + tags). Unlocks most-trusted /
   best-outfits / journal in Phase C.
8. **Optional extra item fields** ✅ — storage location; fit/length/rise;
   acquisition detail (source, original vs paid price, discount %). Optional;
   entered via the Fill page or batch multi-select. Add when convenient.

### Phase B — Planning
- **B1 ⚙️ Calendar (legacy 3d)** — month grid; see/log worn items & outfits per
  day; multiple looks/day; plan future dates; **events** (date + dress code +
  planned/backup outfit). Heat-map shading by usage.
- **B2 ⚙️ Capsule goals + trip enrich** — capsules track coverage % + wear count +
  goal; trips add weather (open-meteo) + laundry-access + activities; packing
  checklist; add-outfit-to-capsule pulls its items; destination image; reorder.
- **B3 ⚙️ Wishlist + decision support** — wishlist items with **purchase
  justification** (fits N outfits, M duplicates, projected CPW), **waiting period**
  (added → 30 days → still want?), and **one-in-one-out** (new buy → removal
  candidates). Keep/sell/donate pipeline via item status states.
- **B4 ✅ Rotation mode** — filter to show neglected / hide recently-worn (no AI,
  just filtering).

### Phase C — Closet Health / Insights *(the centerpiece)*
All **derived** unless noted. One rich dashboard + drill-ins.
- **C1 ⚙️ Usage analytics** — wear velocity, recency states (active/cooling/
  dormant/unworn), repeat cadence, seasonality %, CPW trends + projected CPW,
  utilization %.
- **C2 ⚙️ Distributions** — category / color / **formality (occasion ladder)** /
  season breakdowns; closet count + value (replacement vs original).
- **C3 ⚙️ Coverage & gaps** — context × eligible-pieces matrix (we already compute
  context eligibility), seasonal gaps, outfit-potential combination counts.
- **C4 ⚙️ Orphans & declutter** — items in 0 outfits / worn once / pair with
  nothing (from co-occurrence); declutter pipeline (keep/sell/donate); needs-repair
  queue.
- **C5 ⚙️ Personal analytics** — most-trusted (top rated), best purchases (wears/$),
  regret purchases (low wear/high cost) — depend on A4 ratings.
- **C6 ✅ Smart collections & saved searches** — rule-based filters
  ("professional + blue + unworn", "needs repair", "summer favorites").
- **C7 ✅ Timeline & heat map** — purchases by year; calendar usage heat map.
- The owner's Airtable **Goal CPW / Total Score / Action Needed** formulas (TODO:
  read those formula fields from Airtable and reproduce the logic).

### Phase D — Heuristic styling (rules + keyless weather)
D1 rule-based outfit suggestions (occasion overlap + season + color + recency) ·
D2 weather + calendar daily pick (open-meteo) · D3 capsule/packing auto-generation
· D4 outfit power tools (merge ~1,543 import dupes [legacy 3f], clone, one-tap
re-wear, Outfit Shuffle).

### Phase E — Home dashboard *(last)*
The 6-tab nav lands earlier in Phase A; Phase E adds the **Home dashboard** as a
landing surface. Likely tabs by then: `Home · Closet · Log · Calendar · Capsules ·
Insights` (Stats→Insights; Fill + Settings reachable from Home/menu). Home =
dashboard: today's weather, suggested capsule, recently worn, neglected pieces,
laundry, upcoming events, quick log-wear, continue packing, closet-health score.
Built last so it has real content to surface.

### Journal (threads through B/C, not its own phase)
Outfit diary = wear notes + ratings + weather surfaced as a timeline; "style
discoveries" = a searchable notes list. Falls out of A4 + B1 + C.

## Explicitly NOT doing (by decision)
AI auto-tagging / bg-removal · stylist chat · semantic/embedding search · server
proxy / Edge Functions · outfit collage canvas · social sharing · multi-user /
accounts / monetization · built-in shopping/retailer browser · editorial content ·
hand-maintained item relationship graph (derive pairings instead) · per-item
typed comfort/confidence (derive from ratings).
