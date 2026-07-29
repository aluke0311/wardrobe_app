# Trip Builder ("Pack Plan") — round spec

**Status:** designed, decisions locked, NOT BUILT. Written 2026-07-29 against
`APP_VERSION 2026-07-29 r1`, selftest 177/177.

The ask, verbatim: *"use logic and previous trips and previous wears to suggest
items and number of items of different categories/subcategories to pack. Request
contexts and/or formalities that will happen on this trip. Use previous info
about what I tend to wear both in life and on other trips, and weather info for
this trip. Laundry availability and number of wears before washing by
subcategory should be used as well."*

Plus, from the design conversation: *"a suggestion engine that feels like magic,
but that I can revise as I definitely will revise it — swap shirts, add
something, etc."*

Test cases: **St. Louis, Aug 12–16** (inside the live forecast window, laundry
math trivial) and **Javea, September** (beyond forecast → climatology, two
dress-coded evenings, warm-weather pool — the case that stresses variety).

---

## 0. The three inversions — read before touching any of this

These are the load-bearing reasoning, not preferences. Each replaced an earlier
draft that looked reasonable and was wrong.

### ① Outfits first. The pack is the union of their pieces.

The obvious design is set cover over `(slot, formality level)` cells: count how
many L5 tops the trip needs, pick that many. **It cannot work, because cells
aren't independent.** It will hand you a pack where every cell is satisfied and
no wearable outfit exists — three tops that all clash with the one bottom, or
two pieces covering L5 that sit in an `exclusions` pair.

So generate outfits for the demand, and let the pack fall out as the union.

Four consequences, all good: every packed piece is provably in a real outfit; it
reuses `suggestOutfits` wholesale (formality cohesion, exclusions, clash
penalties, pair affinity) instead of a second scorer that will drift from the
first; counts become an *output* rather than a target, which is what derive-first
actually asks for; and `capsules.plan` fills for free, so trip mode opens ready.

The old `max(laundry need, coverage need)` formula survives as the **explanation
layer** — the "why is this here" text on a bag line. That's where it belonged.

### ② Schedule, don't divide.

`ceil(wear-days / tolerance)` breaks exactly when it matters. Five work days at
L5 need five shirt-days at tolerance 1; if you own two L5 shirts the formula says
"pack 5" and you cannot. It also can't express an uneven split across a mid-trip
wash, and it conflates the multi-outfit day (two outfits is two slot-fills but
one wear-day per item).

Walk the days explicitly and you get a far better failure message: not *"you need
5 tops"* but *"Thursday has no clean L5 top — Wednesday's is at tolerance."*
**Infeasibility gets a date attached.**

⚠️ **Seed the wear counter from CURRENT state, not zero.** A jean at 4/5 wears on
departure day is effectively tolerance-1 for the trip. `planRewearFlags` already
fixed this bug once on 2026-07-22 (`if (it.last_washed && date <= it.last_washed)
continue`) — do not reintroduce it 500 lines away.

### ③ The solve is an event, not a function.

This is what lets "magic" and "I will definitely revise it" coexist.

The solve runs when asked. Its output is **state** — `capsule_items` +
`capsules.plan` — not a derivation that recomputes. Every subsequent edit mutates
that state. Nothing re-runs the solver unless a button says so.

Same model as the rack: `buildRack` is deterministic and stable, and pins /
push-offs are nudges layered on top. **Stability is the feature.** A pack that
reshuffles eight pieces because you swapped one shirt is a slot machine.

Seed the solver's RNG on `capsuleId + slateHash + K + rackIds`. Open the same
trip twice, get the same pack.

---

## 1. Locked decisions

Approved 2026-07-29. Do not re-litigate.

| # | Decision |
|---|---|
| D1 | **Picks lead; counts are grouping headers.** The Bag view groups by subcategory with the count in the section header ("Tops · 5"), each line carrying a `why ›` disclosure. No separate abstract counts view — it's surface you'd stop opening. |
| D2 | **Distinctness = any piece differs.** Shoes and layers count toward it, so a second pair of shoes is a cheap way to buy options and the optimizer reaches for it on its own. No hardcoded per-slot floors. ⚠️ Prototype against Javea's shape in the selftest before building UI on it — see §11 case 12. |
| D3 | **The day slate lives in `dayplan`.** One source of truth for "what's happening on day X". Trip days appear in the week planner. `DAYPLAN_KEEP_FUTURE` gains a trip-aware exemption. |
| D4 | **Booking-time capture: character chip + fixed events.** Both optional, both one tap. Character seeds the occasion mix; fixed events buy lead time on the gap flag. |
| D5 | **Tightness = options per occasion**, not pieces beyond a minimum. Lean 1 · Normal 2 · Cushion 3. This makes `minimize pack size` safe as the objective, because K carries the variety requirement structurally. |
| D6 | **Demand is a multiset of occasions, not a day grid.** Placement is optional metadata. Unplaced occasions still produce a full answer. |
| D7 | **No shoe cap.** A hard ceiling of 2 is a magic number that will be wrong on the trip that matters. Coverage need for shoes is real and small; flag bulk instead. |
| D8 | **Three laundry options**, not four: none · one wash on `<date>` · anytime. Sink washing folds into "anytime". The date matters — that's ② applied to the input. |
| D9 | **No bulk field, no bulk table.** Same trap as `fit` / `length` / `rise`. A five-item hardcoded `PACK_BULKY_SUBCATS` covers the wear-don't-pack advice. |
| D10 | **Reliability weighting is not a new exemption.** The rack already reintroduced recency through pool construction, knowingly, on four conditions. The trip builder inherits them verbatim (§7). |
| D11 | **Gaps are diagnostic, never a wishlist.** A hole at L6 shoes reports as a hole and offers the nearest stretch. Shopping is a documented hard NO and packing is the moment it's most tempting to break. |
| D12 | **Scope boundary: wardrobe only.** No toiletries, chargers, passport, medication. Written down because it will come back. |
| D13 | **`TRIP_MEMORY_MIN` (2) is the calibration threshold.** It's shipped and in use. Do not mint a second constant. |

---

## 2. What already exists — build on it, don't rebuild it

The single biggest risk in this feature is duplicating a shipped derivation.
Everything below is verified present.

| Need | Already shipped | Where |
|---|---|---|
| Pool reduction 476 → ~46 | `buildRack({pool, wearRows, today, season, wx, plans, pinned, pushed})` — injectable, deterministic | `js/20-rack.js:117` |
| Forward events → needed levels | `rackNeededLevels(today, plans, wearRows)`, bounded by `RACK_LOOKAHEAD_DAYS = 14` | `js/20-rack.js:77` |
| Outfit generation + scoring | `suggestOutfits(targetLevel, seedItemId, capsulePool, season, wx, lockedIds, cleanOnly, lockedRoles, shapeKey)` | `js/12-looks.js:1020` |
| Fill one hole in a combo | `swapSuggestionPiece` — slot-aware, exclusion-aware, layer-aware, level-hard | `js/12-looks.js:1635` |
| Per-subcategory wear tolerance + overrides | `wearTolerance(i)` (`tol:<n>` tag → subcat → category → Infinity) | `js/04-laundry.js:56` |
| Current dirty state | `laundryState()`, `isDirty`, `dirtySince`, `suggestibleClean` | `js/04-laundry.js:66` |
| Rewear-budget walk | `planRewearFlags(c, dates)` — the pattern to generalize | `js/16-capsules.js:511` |
| Mid-trip wash marker | `PLAN_LAUNDRY` sentinel + `planLaundryDay(c, date)` | `js/16-capsules.js:487` |
| Per-day outfit plan | `capsules.plan[date]` (array) + `addPlanLook` | `js/16-capsules.js:575` |
| Undated outfit pool | `PLAN_BUCKET` + `openBucketAssignSheet` — assigning **keeps** it in the bucket | `js/16-capsules.js:487`, `:716` |
| Per-leg weather incl. climatology | `buildTripWeather` → `locForDate` + consecutive-date grouping; `_planWx[date] = {maxT,minT,code,hist,locName}` | `js/18-weather.js:127` |
| Cross-trip memory | `buildTravelStats` / `travelProven` / `travelUnused` / `completedTrips` | `js/08-trip-mode.js:195` |
| Trip retrospective | `tripRecapData(c, opts)` — one derivation, two surfaces | `js/08-trip-mode.js` |
| Weekday habits | `weeklyRhythm(wearRows?)` / `rhythmFor(date, rhythm?)` | `js/08-trip-mode.js` |
| Context → level | `contextFormalityLevel(context, wearRows?)` | `js/12-looks.js:1274` |
| Trip dates / phase | `tripDates(c)`, `tripPhase(c, day)`, `isDatedTrip(c)` | `js/16-capsules.js:549`, `js/08-trip-mode.js:26` |
| Wear = a DAY | `countByDay(rows, keyFn)` | `js/03-state.js` |

---

## 3. Storage — zero new columns

| What | Where | Note |
|---|---|---|
| Day slate (occasions per date) | `kvData("dayplan")` | D3. Makes `rackNeededLevels` see trip events for free |
| Fixed events declared at booking | `kvData("dayplan")` | An anchor event *is* a named context on a date |
| Mid-trip wash day | `PLAN_LAUNDRY` in `capsules.plan[date]` | Shipped sentinel |
| Chosen outfit per occasion | `capsules.plan[date]` via `addPlanLook` | Trip mode reads it already |
| Outfits with no date (unplaced) | `capsules.plan[PLAN_BUCKET]` | Shipped |
| The pack | `capsule_items` with `packed=false` | Doubles as the checklist |
| Trip character | `kv` key `pack_kind:<capsuleId>` | One string. `kv` is live (confirmed 2026-07-20) |
| Solve record (locks, pins, seed, slateHash, builtAt) | `kv` key `pack:<capsuleId>` | Small. Needed for the diff (§8) |
| Tightness | session only | A one-shot input, not a fact about the trip |

⚠️ **The one required change to shipped code:** `pruneDayPlan(all, today)`
([js/03-state.js:170](js/03-state.js:170)) drops anything past
`DAYPLAN_KEEP_FUTURE = 30`, so a September trip planned in July is deleted. Add a
trip-aware exemption: keep any date falling inside a dated capsule's range.
Bounded growth, one predicate — and it fixes a latent bug where planning a
far-out trip in the week planner today silently loses it.

⚠️ **`RACK_LOOKAHEAD_DAYS = 14` is what makes D3 safe.** A wedding declared in
July is invisible to today's rack and quietly starts stocking L6 two weeks before
departure. Do not widen that window to "help" the trip builder — the builder
calls `buildRack` with its own `plans` and `today`, so it doesn't need it, and
widening it would narrow her daily rack for a trip three months out.

---

## 4. Capture

Two moments, split by where the information actually is. Information quality
varies by *when* you ask, not by how much you're willing to type.

### 4a. At booking — what you know because you just booked it

Additions to `renderCapsuleForm` ([js/16-capsules.js:184](js/16-capsules.js:184)),
which today asks name / type / dates / notes. Both optional, both one tap.

- **Character chip:** `PACK_CHARACTERS` = beach week · work trip · family visit ·
  city break · event trip. Seeds the occasion mix from *your own past trips of
  that character* via `completedTrips()`; `PACK_CHAR_SEED` is the fallback for a
  character you haven't travelled yet.
- **Fixed events:** date + context, repeatable. Writes straight to `dayplan`.

**Why fixed events are the one thing that must be captured early:** declaring
"wedding, Sept 14" in July means the gap flag can tell you in July that you own
no shoes reaching L6. Three days out the same sentence is just bad news.
Everything else can be captured late, pre-filled, and corrected.

Locations stay where they are (capsule detail) — but the build sheet should
prompt for them if absent, since no locations means no weather.

### 4b. At build time — pre-filled, never a blank form

⚠️ **The capture screen is the whole risk.** A form is the opposite of magic. The
build sheet must open already answered, with everything correctable:

1. **Occasion strip** — pre-filled from character + `weeklyRhythm` + anchors,
   auto-placed onto the dates **pessimistically clustered** (same context
   consecutive = worst case for laundry, so the default plan is conservative).
   One drag fixes it. Same rule as the week planner: *never ask for the grid,
   always show the guess.*
2. **Laundry chip** — none / one wash on `<date>` / anytime (D8).
3. **Tightness chip** — Lean / Normal / Cushion (D5), defaulting to whatever your
   trailing trips' options-per-occasion actually was.

Each occasion carries a level, derived via `contextFormalityLevel` and shown as
an editable chip. **A bare level chip is also allowed with no context** — "one
dressy evening" is a thing you know before you know what it is. This closes a gap
the context-derived path can't express.

Then one CTA: **✨ Build the pack.**

---

## 5. Derivations

In dependency order. Every one takes injectable args so the selftest can drive it
headless — no exceptions, that's what makes §11 possible.

```
packCharacter(cid)                        → string|null          (kv read)
setPackCharacter(cid, ch)                                        (kv write)

packOccasionSeed(character, caps?, wearRows?)
    → [{context, level, n}]
    Past trips of this character → observed occasion mix. Falls back to
    PACK_CHAR_SEED. Labelled as a guess when it came from the seed table.

packLegs(c)
    → [{loc, dates:[...]}]
    Extract the grouping already inside buildTripWeather (locForDate +
    consecutive-run grouping) into a reusable function. Single-location and
    no-location trips return one leg.

packSlate(c, {character, plans, wearRows, today})
    → [{date, leg, occasions:[{id, context|null, level, placed}]}]
    Reads dayplan for declared events; fills unplaced days from weeklyRhythm;
    stamps TRIP_CONTEXT on departure/return.

packDemand(slate)
    → [{id, date|null, level, context|null, leg}]
    The multiset. A 10-day trip can have 14 occasions (D6).

packRack(c, slate, legs, {wxFor, pinned, pushed})
    → {ids, cold, byLeg}
    ⚠️ ONE buildRack PER LEG, unioned. Madrid-then-Javea is two climates; a
    single call with one weather band filters out half of what the trip needs.
    Overrides: PACK_TRIP_QUOTA (RACK_SLOT_QUOTA is home-sized at 16 tops, and
    excludes the Workout category — a beach trip needs swim). KEEP the cold
    share.

packCandidates(occasion, rack, wx, season)
    → combo[]                                   (PACK_CANDIDATES_PER_OCC = 8)
    suggestOutfits(level, null, rack, season, wx, null, /*cleanOnly*/ false, …)
    ⚠️ cleanOnly=FALSE. Laundry is a schedule constraint here, not a pool
    filter — that's inversion ②. Passing true would silently shrink the pool
    and reintroduce the divide-don't-schedule bug.

packSchedule(assign, c, {ls, today, homeReserve})
    → {violations:[{date, itemId, nth, tol}], washDays:[...]}
    Generalizes planRewearFlags from REPORTING violations to PREVENTING them.
    ⚠️ Seeds each counter from last_washed + laundryState (inversion ②).
    ⚠️ Counts distinct (item, day) pairs, NOT outfit-fills — two outfits in one
       day sharing jeans is ONE wear-day. Same rule as countByDay.
    ⚠️ PACK_HOME_RESERVE: don't let day 8 burn the last clean thing you need to
       travel home in.

packDistinct(comboA, comboB)  → bool           (D2: any piece differs)

packSolve({c, demand, rack, wxFor, K, ls, today, pinned, locked, seed})
    → {pack:Set, assign:Map(occId→combo), options:Map(occId→combo[]),
       unmet:[{occId, date, reason}], stats:{pieces, outfits, legs}}
    See §6.

packOutfitCount(pack, demand)  → int
    Distinct valid outfits the pack yields at the demanded levels. This is the
    magic number: "18 pieces → 31 outfits."

packConsequences(state)
    → {broken:[{occId, date, slot}], violations:[...], orphans:[...], missing:[...]}
    The after-edit walk. LINEAR. Never calls packSolve.

packGaps(demand, rack, ls)
    → [{occId, date, level, slot, nearest}]
    Uncoverable occasions. Diagnostic only (D11).

packWashPlan(pack, ls, today, startDate)
    → {hamper:[...], underTol:[...], lastUsefulWashDay}

packLeftOut(rack, pack, travelStats)
    → [{item, packed, worn}]
    ⚠️ From travelUnused. Frame as "Left out: linen jacket — packed 3×, worn 0×"
    with a one-tap include. NEVER "stop packing this" — a piece packed three
    times and never worn may be the just-in-case option doing its job. This is
    a documented line ("a fact, never advice").

packBulkyAdvice(pack)  → [{item}]              (PACK_BULKY_SUBCATS, D9)

packDiff(prevRecord, nextResult)
    → {added:[...], removed:[...], moved:[...], reasons:[...]}
    §8. The visit-#3 artifact.

packGrade(c, {wearRows, members})
    → {suggested, worn, unpacked, hitRate}|null
    §9. Null under PACK_GRADE_MIN_DAYS logged days.

packTemplate(cid, fromCid)                      (§10)
```

### Constants

```
PACK_OPTIONS = { lean: 1, normal: 2, cushion: 3 }   // K per occasion (D5)
PACK_RESTARTS = 240
PACK_CANDIDATES_PER_OCC = 8
PACK_TRIP_QUOTA = { Tops: 20, Bottoms: 12, Dresses: 8, Shoes: 10, Outerwear: 5 }
PACK_CHARACTERS = ["beach week","work trip","family visit","city break","event trip"]
PACK_CHAR_SEED = { … }        // occasion mix fallback per character
PACK_BULKY_SUBCATS = ["Coats","Boots"]
PACK_GRADE_MIN_DAYS = 3
PACK_HOME_RESERVE = true
```

---

## 6. The solve

**Objective:**

> minimize `|pack|`, subject to every occasion having ≥K distinct valid outfits
> available from the pack, and no item exceeding its tolerance within its laundry
> stretch.

`minimize |pack|` is safe here **only because K carries variety structurally**
(D5). Without K it is a calcifying objective — the minimum feasible pack for ten
days is one pair of shoes spanning `[4,5,6]`: feasible, miserable, and the exact
failure `RACK_COLD_SHARE` exists to prevent elsewhere in this app.

**Algorithm:**

1. Precompute `packCandidates` per occasion. Pinned items are in the pack from
   the start, free. Locked assignments are fixed and never re-chosen.
2. Restart loop, `PACK_RESTARTS` times, seeded RNG:
   - Order occasions **hardest-first** (fewest candidates first).
   - **Greedy pass:** per occasion pick the candidate adding the fewest *new*
     pieces. Tie-break in order: `travelProven` membership (D10/D13) → pair
     affinity with pieces already chosen → `rackWarmth`.
   - **Options pass:** per occasion count distinct valid combos *within* the
     current pack. Where < K, add the single cheapest piece that raises the
     count. This is where a second pair of shoes gets chosen on merit (D2).
   - **Schedule pass:** run `packSchedule`. On a violation, try to repair by
     swapping that occasion to a candidate avoiding the over-tolerance piece.
     Unrepairable → record in `unmet` with its date.
3. Keep the best by dominant sort: **fewest `unmet` → fewest pieces → most total
   options.**

**Determinism:** seed = hash(`capsuleId` + slateHash + K + sorted rack ids). Same
trip, same answer (inversion ③).

**Budget:** rack ≈ 46–90 across legs, occasions ≈ 10–16, 8 candidates each. ~31k
small set-unions per solve. One spinner, under a second, once.

---

## 7. Revision — the edit layer

Every edit is local. `packConsequences` runs (linear); the solver does not.

**Locks are the load-bearing primitive.** Every edit implicitly locks what you
touched — swap a piece in, it's locked; arrange an occasion, it's locked. Re-solve
only moves unlocked things. So **the more you revise, the more stable it gets**,
which is the right direction and makes `✨ Re-solve` safe to offer prominently.
`suggestOutfits` already takes `lockedIds` and `lockedRoles`.

| Verb | Behaviour | Consequence |
|---|---|---|
| **Swap a piece** | Rail of alternates for *this* hole — right slot, right level, weather-eligible, clean at that point in the schedule, not excluded against the rest, good affinity. `swapSuggestionPiece`'s filter, pooled on rack ∪ pack. | If the old piece is now unused, *offer* to drop it. Never automatic — a spare is a legitimate thing to want. |
| **Add something** | Pins it into the pack. Doesn't have to belong to any occasion. | Offers occasions it could improve. Never forces it in. Pins survive re-solve (`pullOntoRack` precedent). |
| **Remove something** | Drops it. | Occasions that depended on it break, flagged **with dates**. One-tap fix re-solves *only* those. |
| **Re-solve** | Explicit, and scoped: this occasion / all unlocked / everything. | Never silent, never global by accident. Respects every pin and lock. |

The four things `packConsequences` recomputes: which occasions lost a slot, any
laundry violations, pack pieces no occasion uses, occasion slots with no packed
piece. Shown as a quiet status line — **never a modal, never a spinner.**

**The rack's four conditions carry over verbatim (D10):** the pool is a visible
screen, named with a count, one tap to widen to the whole closet, and locking or
adding an off-pool piece never fails.

---

## 8. Re-entry — design for visit #3

The first solve is the rare case. Re-opening a pack you already built is the
common one.

Make the diff the artifact:

> *"Since you last built this: the wedding moved to Friday, your black heels went
> in the hamper, and the forecast dropped 8°. **2 changes to the pack.**"*

- Everything already `packed=true` stays checked and is **pinned, not
  re-optimized**.
- Only what moved is surfaced.
- `packDiff` compares the stored solve record (`kv pack:<cid>`) against a fresh
  solve: slate changes, weather changes, laundry-state changes, closet changes
  (a piece archived or newly dirty).

---

## 9. Honest failure — a partial answer must look partial

The documented r12 failure was a pool that produced nothing but *looked* like a
partial result — "worse than empty, because it looked like a partial result."
This feature's version of that bug is covering 8 of 10 occasions and quietly
handing over a pack that ignores the other 2.

So there is a state between success and failure:

> **8 of 10 occasions covered.** Sept 14 (Dressed Up) has no shoes that reach it.
> Sept 16 needs a clean Smart Casual top — Sept 15's is at tolerance.

Named, dated, reason given, and the pack still delivered for the 8.

Other states that must be labelled rather than silently absorbed:

| Condition | Behaviour |
|---|---|
| Rack can't cover a declared level | `unmet`, **never an empty sheet**. `targetLevel` is a hard filter in `suggestOutfits`, which is how the 2026-07-19 capsule bug happened — a smaller pool is the same bug with a new cause. |
| No locations set | Solve on season alone; prompt for locations; label it. |
| Beyond forecast range | `_planWx[date].hist === true` → label "typical for mid-September", never "forecast". |
| First trip of a character | `PACK_CHAR_SEED` used; label the occasion mix as a guess. |
| No trip history at all | `travelProven` empty; tie-breaks fall through to affinity. Still produces a plan. |

**Label every guess.** The r19 lesson is that an unlabeled guess costs more trust
than hand-entry costs taps.

---

## 10. Memory and the loop

**`packTemplate(cid, fromCid)` — "same as last time."** Start from a past trip's
pack; the solver adjusts for this trip's weather and occasions and shows the
delta. The most direct possible use of "previous trips" from the original ask,
and for repeat beach weeks / repeat work trips it's probably the primary path.
Sidesteps capture entirely.

**`packGrade(c)` — the builder grades itself.** *"Suggested 18, you wore 14. You
wore 3 things it didn't pack."* This is the "things you might be wrong about"
pattern applied to the builder: the app disagreeing with itself, which is the
part of this app that gets opened daily. It also makes everything else
trustworthy — an engine reporting its own hit rate is one you can calibrate
against. Surfaces on the trip recap and on the `statsView "travel"` page.

**`packLeftOut` — say what it omitted, and why.** *"Left out: the linen jacket —
packed 3×, worn 0×."* One tap brings it anyway. See the ⚠️ in §5.

**Mid-trip wash plan.** Once you're there and laundry is Thursday, run
`packSchedule` forward from *actual* state and name what the back half needs:
*"Wash these 6."* Trip mode's hamper row is the surface.

---

## 11. Selftest cases

Add to `migration/selftest.html`. **Every one mutation-checked red in the same
session** — a test that has never failed is not a test.

*Schedule / laundry*
1. Counter seeds from `last_washed`: a piece at 4/5 wears on day 1 flags on day 2, not day 5.
2. `PLAN_LAUNDRY` mid-trip resets the counter; the longer stretch binds.
3. Two outfits in one day sharing jeans = **one** wear-day, two slot-fills.
4. `tol:<n>` tag override beats the subcategory default inside the schedule.
5. Infinity-tolerance pieces never generate a violation.
6. `PACK_HOME_RESERVE` keeps a travel-home outfit clean on a long trip.

*Solve*
7. Deterministic: same inputs → identical pack, twice.
8. Every packed piece appears in at least one assigned outfit (inversion ①).
9. No assigned outfit violates an `exclusions` pair.
10. K options per occasion actually exist *within* the returned pack.
11. Lean/Normal/Cushion produce monotonically non-decreasing pack sizes.
12. **D2 probe:** a 10-day Javea-shaped fixture with two L6 evenings does NOT return a single pair of shoes. ⚠️ If this fails, D2 is wrong and needs the visible-core or per-slot-floor variant — resolve before building UI.
13. Pinned pieces are in the pack even when the optimizer wouldn't choose them.
14. A locked occasion's outfit is unchanged by `packResolve("unlocked")`.

*Rack / pool*
15. `packRack` on a two-leg trip includes pieces eligible for *either* climate.
16. Cold share survives — zeroing it turns a case red.
17. `packCandidates` passes `cleanOnly=false` (a dirty-but-schedulable piece is still a candidate).
18. A rack that can't cover a declared level yields `unmet`, not an empty result.

*Slate / storage*
19. `pruneDayPlan` keeps dates inside a dated capsule past the 30-day window.
20. Unplaced occasions still produce a full solve, written to `PLAN_BUCKET`.
21. Assigning a bucket outfit onto a day leaves it in the bucket.
22. Anchor events declared >14 days out do **not** appear in today's `rackNeededLevels`.
23. A bare level with no context is a valid occasion.

*Loop / honesty*
24. `packGrade` returns null under `PACK_GRADE_MIN_DAYS`.
25. `packLeftOut` requires `TRIP_MEMORY_MIN` trips before naming a piece.
26. Far-future trip: every day carries `hist:true` and the UI string says "typical", not "forecast".
27. `packDiff` on an unchanged trip returns zero changes.
28. Version lockstep across all three places (existing case, extended for any new `js/` file).

---

## 12. Surfaces and wiring

| Surface | Detail |
|---|---|
| **Create form** | Character chips + "Fixed events" repeater in `renderCapsuleForm`. Both optional. |
| **Capsule detail** | `✨ Build the pack` on dated trips; becomes `✨ Rebuild · 2 changes` once a pack exists (§8). |
| **Build sheet** | The pre-filled capture (§4b). Occasion strip + laundry chip + tightness chip + CTA. |
| **Pack screen** | New `capsuleView = "pack"`. Two tabs: **Days** (primary — one card per date, assigned outfit, "N options", swap affordances, laundry + anchor markers) and **Bag** (grouped by subcategory, count in the header, `packed` checkboxes, `why ›` per line — D1). Header strip: *"18 pieces → 31 outfits · 2 legs"* + the `unmet` banner. |
| **Alternates rail** | Bottom rail on piece tap, `.bld-rail` pattern. |
| **Grade row** | Trip recap + `statsView "travel"`. |

### Wiring discipline — the traps this feature will hit

- ⚠️ **`capsuleView` dispatch:** adding `"pack"` means `renderCapsules()` dispatch *and* `capsuleBack`. Use `navDeeper("capsules")` / `navShallower("capsules")` at the navigation handler — **never `scrollToTop()` inside a render**, since `renderCapsules` is called both to navigate and to refresh in place.
- ⚠️ **Sheet order in `index.html`:** the build sheet hosts a date edit, so it must be declared **before `#fieldSheet`**. Every sheet wrapper is `z-index: 301` and DOM order decides the stack — this cost a day of "the button does nothing" in r19. Keep `#fieldSheet` last.
- ⚠️ **`showSheet(id)` / `hideSheet(id)` only.** Never toggle a sheet wrapper's `.hidden` directly. Add any new wrapper id to `uiCanRefetch()`.
- ⚠️ **Full-width `<button>` needs an explicit `width`** — `display:block` is not enough. Use `width: calc(100% - 32px)` for margin-16 rows, `width:100%` inside padded containers.
- ⚠️ **`✨` for anything that makes something new.** `↻` is retired app-wide and a selftest case fails if it reappears in any `js/` module.
- ⚠️ **No literal colors.** Tokens only; `var(--on-accent)` for anything on `var(--accent)`; `var(--serif)` for headings.
- ⚠️ **`background-size: contain`** on every item photo. Never `cover`.
- ⚠️ New file → renumber, add a `<script src>` tag in order, and the `?v=` count in `index.html` goes 22 → 23. All three version sites stay in lockstep.

---

## 13. Build order

Judgment-heavy first, so the mechanical tail can be finished by a smaller model
if usage runs out.

| Phase | Contents | Why here |
|---|---|---|
| **1** | `packLegs` · `packSlate` · `packDemand` · `packRack` · `packCandidates` · `packSchedule` · `packDistinct` · `packSolve` + cases 1–18 | All pure and headless-testable. **Case 12 gates D2** — settle it before any UI exists. |
| **2** | Pack screen: Days + Bag, `packOutfitCount`, `unmet` banner, `packGaps` | The thing you'd actually open. Drive it from a synthetic slate; no capture yet. |
| **3** | Edit layer: swap rail, add, remove, scoped re-solve, `packConsequences`, locks | The half that makes it usable rather than impressive. |
| **4** | Capture: create-form additions, build sheet, `packOccasionSeed`, `packCharacter`, `pruneDayPlan` exemption + cases 19–23 | Now the pre-fill has something real to pre-fill *into*. |
| **5** | Memory + loop: `packTemplate`, `packGrade`, `packLeftOut`, `packDiff` + cases 24–27 | Needs at least one completed trip to be meaningful. |
| **6** | Polish: `packWashPlan`, `packBulkyAdvice`, mid-trip wash plan, guess labels | |

Phases 1–3 are a usable feature. **St. Louis is Aug 12** — that's the deadline
worth aiming at, and Javea in September stress-tests the hard case with a round in
between to fix what it gets wrong.

The selftest is a deploy gate for logic changes, so every phase ships green.

---

## 14. Rejected — and why, so it stops coming back

| Rejected | Reason |
|---|---|
| Set cover over `(slot, level)` cells | Cells aren't independent; produces packs with no wearable outfit. Inversion ①. |
| `ceil(wear-days / tolerance)` as the engine | Breaks on uneven distribution and the multi-outfit day; can't attach a date to a failure. Survives as explanation text only. Inversion ②. |
| `minimize |union|` without K | Calcifying objective — one pair of shoes for ten days. D5 fixes it. |
| A new `capsules.pack` column | Everything has a home already (§3). |
| Required per-day grid | Placement only matters for a mid-trip wash; `PLAN_BUCKET` absorbs the unplaced case. D6. |
| A hard shoe cap | D7. |
| `items.bulk`, or a full derived bulk table | D9. Same trap as `fit` / `length` / `rise`. |
| A separate abstract counts view | D1. Surface you'd stop opening. |
| A second "trip rack" concept | A rack exists to shrink 476 → ~46. `packRack` *is* `buildRack` with trip inputs, not a new concept. |
| Live-scorekeeper instead of a solver | Considered and rejected by explicit decision — the ask is magic-then-revise, not assisted-manual. |
| Feasibility-check-only first round | Withholds the actual ask. Its content survives as `packGaps` + `packWashPlan` inside phases 2 and 6. |
| Weather-vs-packing retrospective | Already rejected in the r1 travel-memory round. An insight nobody acts on. |
| Learning repeat-outfit tolerance to size K | Real signal, third-order refinement on a dial you can just set. |
| Toiletries / chargers / passport | D12. |
| "Stop packing this" advice | D11 + the documented "a fact, never advice" line. |

---

## 15. Small things still open, resolvable at build time

- `PACK_CHAR_SEED`'s actual occasion mixes — write them from the first few real trips rather than guessing now.
- `PACK_TRIP_QUOTA` numbers — the values above are a starting point; case 15 is what tells you if they're wrong.
- Whether the Days tab shows one card per **date** or per **occasion** on multi-occasion days. Per date with stacked occasions is probably right, but build it and look at it.
- Whether `packGrade` belongs on the recap, the travel page, or both.
