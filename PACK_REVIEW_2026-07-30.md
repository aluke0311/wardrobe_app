# Pack plan — what I'd change next

Written overnight 2026-07-29 → 30, after shipping r4. Everything below came out
of **building and then rendering** the thing, not from a general list of ideas.
Nothing here is built. It's for you to sort.

Current state: `2026-07-29 r4`, selftest **231/231** green, phases 1–6 shipped.

---

## First, the thing I'd want you to decide

### ① `minimize |pack|` systematically prefers dresses — and that costs you outfits

A dress fills the top and bottom slot at once, so it adds **one** piece where a
blouse + skirt adds **two**. The objective is minimising pieces, so it reaches for
dresses whenever they're legal.

Measured on a 5-day fixture, same trip, same closet:

| pack | pieces | outfits it makes |
|---|---|---|
| leaning on dresses | 8 | **6** |
| leaning on separates | 10 | **15** |

Both are "correct". The first is two pieces lighter and makes less than half as
many outfits — and "outfits they make" is the number printed at the top of the
screen, so the efficient answer looks worse to you than the roomier one.

Three ways to go, and I don't think it's my call:

- **Leave it.** Piece count is the honest objective; dresses genuinely are
  efficient; you can always tap Cushion.
- **Add a small recombination bonus** so separates win ties. Cheap, but it's a
  thumb on the scale that will be hard to explain later.
- **Change what the header brags about** — show pieces and "covers N occasions"
  rather than an outfit count that the objective is actively working against.

My lean: the third. The outfit count is the part that's misleading, not the pack.

### ② "Normal" currently behaves exactly like "Lean"

`repW` is 0.5 / 1 / 2 for lean / normal / cushion. On every closet I tested, 0.5
and 1 both land under the "is it worth packing another piece" threshold, so the
middle setting does nothing:

| setting | worst top reuse | pieces |
|---|---|---|
| Lean | 4 of 6 days | 6 |
| Normal | 4 of 6 days | 6 |
| Cushion | 2 of 6 days | 8 |

A three-position dial where two positions agree is a dial you'll stop trusting.
It's a one-line fix, but the right values want a real closet — I'd rather set them
from St. Louis than tune them against a synthetic one.

---

## Worth building, roughly in order

### ③ Nothing tells you the pack got *worse* after you edited it

The consequence engine reports broken days and orphans, which is the harm you
caused. It doesn't report the harm you caused *by degrees*: you swap a shirt,
options on Thursday quietly drop from 3 to 1, and nothing says so.

A single line — *"Thursday: 3 options → 1"* — after any edit. You already have
both numbers; nothing is computed that isn't already there.

### ④ The trip character is captured and then barely used

`packOccasionSeed` reads it, and that's it. Two more places it's the obvious
answer:

- **`PACK_TRIP_QUOTA` should vary by character.** A beach week and a work trip
  want differently shaped racks; right now both get `{Tops:20, Bottoms:12, …}`.
- **Swim and gear are still invisible.** `buildRack` excludes the Workout
  category on purpose, and swim subcategories map to a `null` slot so they can
  never appear in an outfit. So a beach week never packs a swimsuit. That's
  defensible (it's not an outfit piece) but a "beach week" that forgets swimwear
  will read as broken the first time it happens. The narrow fix: for characters
  that imply it, add a short non-outfit checklist to the Bag tab — swim, gym
  gear — derived from the character, never from a new column.

### ⑤ The solve doesn't know what you actually wore last time it ran

`packGrade` computes suggested / worn / unpacked per trip, and reports it. Nothing
feeds it back. The obvious loop: pieces the builder packed and you *didn't* wear
on the last two trips of the same character should cost slightly more to pack
again.

⚠️ This has to stay a **tie-break, not a filter**, and it must never become
"stop packing this" — same line `packLeftOut` already respects. The just-in-case
piece may be doing its job.

### ⑥ Two rows on the trip dash still overlap

I folded the hamper row when the wash plan covers it. But `tripUnwornNow`
("4 of 7 still in the suitcase") and the wash plan ("wash 2 pieces for the rest
of the trip") can both be about the same pieces and both be showing. The Home
attention hierarchy already solved this shape once — one slot, priority order,
rest folded into "N more things ›". The trip dash never got that treatment and
now has four candidate rows.

### ⑦ The Bag tab can't be used as a checklist while packing

It's grouped by subcategory, which is right. But ticking a piece re-renders the
whole screen, so you lose your scroll position halfway down a 20-piece list. The
grid-bar pattern (`toggleSelect` → DOM surgery on one tile, no re-render) is the
fix and already exists.

---

## Smaller, cheap, obviously right

- **The pack has no undo.** Every edit persists immediately. One level of undo on
  drop/swap would cost a toast and a stashed record.
- **`packDiff` is only on the trip-detail button.** It should also be the thing
  the pack screen shows on re-entry — that's the visit-#3 experience we designed
  and it currently only appears one level up.
- **Nothing surfaces "you have no laundry day set" on a trip long enough to need
  one.** The violations list says a piece runs out; it never says the fix is one
  tap on the by-day planner.
- **`packBulkyAdvice` is a 2-item list** (`Coats`, `Boots`). Sandals-vs-boots on a
  September trip is exactly when it matters, so it's fine — but it currently says
  "wear the boots" even when the boots are only worn on day 4.

---

## What I would NOT do

- **Add a bulk/volume model.** Still the `fit`/`length`/`rise` trap. The five-item
  subcategory list is the whole justified version.
- **Auto-create the by-day plan on solve.** ~13 look records per solve would
  flood Looks. It stays an explicit action.
- **Let the pack suggest purchases.** Gaps stay diagnostic. Packing is the moment
  this rule is most tempting to break, which is why it's written down twice.
- **Widen `RACK_LOOKAHEAD_DAYS` for the trip builder.** It doesn't need it — the
  builder passes its own `plans` and `today` — and widening it would narrow your
  daily rack for a trip three months out.
- **Tune `PACK_CHAR_SEED` now.** They're guesses labelled as guesses. Rewrite them
  from St. Louis and Javea.

---

## The process note that mattered most

**Six defects in this feature were found by rendering the screen and reading it.
The tests found none of them.** Every one was invisible in the code and obvious
within five seconds of looking:

1. the bag line contradicting the laundry warning above it
2. "20 options" beside a "See 20" button
3. three occasions stacked on the departure day
4. Thursday and Friday as the identical outfit *(r4)*
5. one sweater on 4 of 5 days at exactly its tolerance ceiling *(r4)*
6. the new wash row directly above a hamper row saying the same thing *(r4)*

Two of the tests I wrote to guard #4 and #5 were themselves **passing vacuously**
until I mutated the code and watched them stay green — the tightness-dial case
accepted `l >= u`, which holds even with the dial switched off. Green is not
evidence. Mutating is.

Worth adding to the deploy skill: for any round that changes a screen, render it
and read the text before believing the suite.
