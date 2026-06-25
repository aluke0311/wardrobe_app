# STYLE_MODEL.md — the wardrobe app's style data model

Source of truth for how the app thinks about **formality, context, garment type,
outfit suggestions, and the closet-vs-life gap**. Locked with the user 2026-06-23.
Read alongside `CLAUDE.md` (architecture) and `migration/RESET_PLAN.md` (the
Airtable field spec that captures this model).

The framework is adapted from the *Everyday Style School* "6 categories of
clothing" (formality + utility), reconciled with the app's existing data.

---

## 1. Three independent axes (never conflate them)

A garment is described by three orthogonal things. Keeping them separate is the
whole design.

| Axis | What it is | Field | Cardinality | Role |
|---|---|---|---|---|
| **Garment type** | Tops / Bottoms / Dresses / Outerwear / Shoes / Workout | `category` + `subcategory` | one per item | browsing; filling outfit *slots* (need one of each) |
| **Formality** | how dressed-up: the 1–6 scale below | `formality` (smallint 1–6) | **one per item** | the vertical scale; suggestion targeting; gap analysis |
| **Context** | the *occasion/setting* (errands, office, date, funeral) | `context` (text, on wears/outfits) | optional, 0+ | vibe + hard rules; "browse by context"; *implies* a formality |

**An item lives in one garment type and at one formality level. An OUTFIT spans
multiple formality levels** (a level-2 sweatshirt with level-4 trousers), and the
spread between its pieces is a styling-quality signal (see §6).

---

## 2. The formality scale (1–6)

One number per item. The six levels (essay's "categories"), `OCCASION_LADDER`:

| # | Label | What it is | Example pieces |
|---|---|---|---|
| 1 | **Function** | function-first / utility; worn only for a specific activity, little crossover | gym/activewear (the `Workout` garment type) — swimwear/pajamas not tracked |
| 2 | **Very Casual** | comfort-first but presentable; "people might see you" | basic tees, hoodies, sweat sets, athleisure, sneakers |
| 3 | **Everyday Casual** | looks like you made an effort; comfort dialed down a notch | jeans, graphic tees, casual dresses, chinos, fashion sneakers, flats |
| 4 | **Smart Casual** | polished, intentional; "a little special" | blazers, nicer dresses, polished denim, blouses, heels/loafers |
| 5 | **Dressed Up** | professional / where dress codes start | suits, structured dresses, cocktail attire, dress shoes |
| 6 | **Formal** | black-tie, true formalwear; no crossover | gowns, tuxedos, formal gowns |

**Why a single level (not a range):** easier to fill on refresh (one number, and
the user historically left ranges empty — 34/476), matches the essay's "sort each
piece into one category," and loses almost nothing because **versatility is handled
at the outfit level via adjacency** (a level-3 item naturally pairs into level-2 and
level-4 outfits). Replaces the old `min_occasion`/`max_occasion` range.

**Function (1) is on the same scale, not off-ladder.** The old "Workout =
off-ladder" special-casing is gone; `Workout` garment-type items are simply
level 1. (The garment taxonomy is otherwise unchanged — see §9.)

---

## 3. Two formalities: supply vs demand

The essay's opening ("always a little over- or under-dressed") is literally the gap
between two numbers:

- **Supply** = how dressed-up a garment/outfit *reads as*. **Derived** from pieces
  (`outfitBucket`). Never typed.
- **Demand** = how dressed-up the *day/occasion* needed you to be. **Captured**
  one-tap on a wear (`wears.formality_for`, nullable 1–6). Optional; pre-filled when
  a context is chosen.

Everything downstream is these two numbers:
- outfit "reads as level X" → **supply** (derived, shown on the outfit)
- "I wore this for a level-X day" → **demand** (one tap)
- closet-vs-life gap → **supply distribution vs. demand distribution** (§7)

---

## 4. Context — an optional lens on top of the spine

Context is **not** a competitor to formality; it's an optional enrichment that
*contains* formality (picking a context implies a level; picking a level doesn't
imply a context).

- **Capture = typeahead** (the existing `brand` pattern): free-text input **plus**
  single-select of previously-used contexts (`distinctScalar("context")`). No fixed
  list — contexts accumulate so the eventual taxonomy can emerge from real use.
- A context, when present: (a) pre-fills a formality default (overridable), (b)
  adds the vibe distinction the essay's mistake #1 is about (office-4 ≠ social-4),
  (c) can carry a hard rule (funeral = dark tones; chorus concert = all black).
- **Never required.** Stays off the fast path. The 13-context list is **parked** —
  do not finalize it this round; just let strings accumulate via the typeahead.

`wears.context` and `outfits.context` already exist.

---

## 5. Negative pairs — "X doesn't go with Y, and why"

Absence of co-occurrence ≠ "doesn't go," so exclusions must be **explicit**.

- New table `exclusions(id, user_id, item_a, item_b, reason text, created_at)`.
  Stored unordered (normalize `item_a < item_b`).
- The suggestion engine **filters out any combo containing both** items, and
  surfaces the stored "why."
- Captured **at the moment of use** — right on a suggested outfit ("these two don't
  go" → pick/type a reason). Per the data philosophy: a captured field, justified
  because it can't be derived AND a feature being built now uses it.

---

## 6. Suggestion engine (heuristic, no AI, keyless)

`suggestOutfits` assembles head-to-toe looks and scores them. Pure rules over our
own data + the essay's adjacency law.

1. **Target band** — from a chosen context (its formality default) or a picked
   level, or "anything."
2. **Fill slots** — Tops, Bottoms-or-Dress, Shoes, optional Outerwear, with
   candidate items whose level is in-band (±1).
3. **Score each combo:**
   - **Formality cohesion** — adjacent levels fine; **2 apart = penalty; ≥3 apart =
     reject** (the essay's law).
   - **Color compatibility** — derived from historical co-occurrence (items worn
     together) + neutral rules over `color_family`. No hand-maintained graph.
   - **Season / weather** — `season` overlap + Open-Meteo temp band (already wired).
   - **Rotation** — boost neglected items → one "stretch pick."
   - **Exclusions (§5)** — hard filter.
   - **Context hard rules** — e.g. dark-only, all-black → filter.
4. Return top N → open into the Build-a-look canvas.

**Feedback loop (honest scope — weighted heuristics, not ML):**
- **Implicit (free):** tapping "Wear this" logs the outfit → grows the co-occurrence
  model the engine scores against. Accepted suggestions improve future ones.
- **Explicit (optional, later):** one-tap 👍/👎. `wears.rating` (1–3) already exists;
  add `outfits.rating` for the loop. Build the UI in a later round.

Ship v1 **without** the explicit loop; the implicit path works for free.

---

## 7. Closet-vs-life gap (the essay's homework, automated)

- **v1 (free, works on historical wears today):** closet **supply** distribution by
  level vs. the **read-as** level of outfits actually worn. → "Your closet is 45%
  level-4/5 but you mostly wear level-3." No new capture; runs on the 3,995 imported
  wears immediately.
- **v2 (richer, as data accrues):** add the one-tap **demand** capture
  (`wears.formality_for`) → demand vs. what-you-actually-wore (over/under-dress
  detection) and, with context, "you own 40 office outfits for ~12 office days/mo."

Lives in the Stats tab.

---

## 8. Schema implications

Two clean buckets — keep them separate.

### Filled in Airtable on refresh (item attributes)
- `items.formality` smallint 1–6 (**replaces** `min_occasion`/`max_occasion`)
- existing item fields (name, category, subcategory, brand, retailer, color_family,
  price, purchase_date, date_is_guess, acquisition, size, fabric[], season[], status,
  notes, image)

### App-captured over time (NOT Airtable-imported — schema additions only)
- `wears.formality_for` smallint 1–6, nullable — the day's demanded level
- `wears.context` / `outfits.context` — already exist (typeahead)
- `wears.rating` 1–3 — already exists (feedback)
- `outfits.rating` smallint, nullable — **new**, reserved for the 👍/👎 loop
- `exclusions` table — **new** (§5)

### Cleaned up in the refresh (dead v25 columns the rework UI never uses)
Drop from `items`: `min_occasion`, `max_occasion` (→ `formality`), `availability`,
`care`, `needs_repair`, `needs_tailoring`, `storage_location`, `fit`, `length`,
`rise`, `price_original`. Drop the `events` table (rework calendar uses `wears`).
**Confirmed 2026-06-23 — clean slate at refresh.**

---

## 9. Resolved decisions (2026-06-23)

1. **Garment taxonomy — unchanged.** Tops / Bottoms / Dresses / Outerwear / Shoes /
   Workout, with the existing subcategories. `Workout` items are formality 1.
   Swimwear / pajamas / loungewear are **not tracked** (the user doesn't own/track
   them as wardrobe), so no Function-first garment types are added.
2. **Prune — drop them all** (§8). Clean slate at the refresh.
3. **Accessories — out of scope.** No bags/jewelry/accessories category; the
   suggestion engine has no accessory slot.
