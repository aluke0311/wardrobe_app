# PACK_REVIEW_2026-08-04 — adversarial review of r5+r6, and the r7 build plan

**For the builder session. Read `CLAUDE.md` (the r5 and r6 entries especially) and
`TRIP_BUILDER.md` before touching anything. This doc is the r7 spec: a defect
register from an adversarial review of the two rounds shipped 2026-08-04, plus
one feature she asked for in her own words. Every judgment call is made HERE so
the build is mechanical. Where a number needs measuring, the doc says "measure"
and gives the probe — do not guess it.**

Her ask, verbatim: *"I'd also like to be able to tap over between the list and
the proposed outfits for each occasion, and be able to edit from either spot —
I want to for example be able to build an outfit from the suggester for the baby
shower — starting with what the packer suggests but expanding out to the full
closet to then influence the pack — which can then adjust around that once I
lock it in."*

Baseline before starting: selftest **330/330 green** at `2026-08-04 r6`
(check it FIRST — a red case on main reads as your regression).
Her standing instruction: **deploy first, test after** (a usage cap must not
leave her with nothing) — but run the suite before starting to baseline.

---

## PART 1 — DEFECT REGISTER (fix in this order)

### P0-1 · Candidate pools are contaminated across occasions (bug introduced in r6)

`packOccasionSlotFit` changes the candidate POOL per occasion (no dresses on the
plane day), but every grouped enumeration still keys on level alone or
level|leg|band:

- `packSolve`: `groupKey = level|legKey|band` → a Flight and an Errands occasion
  at the same level share ONE candidate list, from whichever occasion `reps`
  saw first. **The dress filter either leaks onto ordinary days or misses the
  plane day depending on demand order.**
- `packCoverage`: memo key `` `${occ.level}|${occ.date || ""}` `` — collides for
  two same-day same-level occasions with different contexts.
- `packItemsOptionMap`: `repOf` keyed on level only (this feeds the bag rows'
  "for Flight / Casual" labels).
- `packOutfitCount`: representative occasion per level only.
- `packRefresh`: `byKey` keyed on level only.

**Fix:** one helper pair in `js/21-pack.js`:

```js
// The inputs the slot-fit filter depends on — anything that can change the POOL.
function packFitSig(occ) {
  if (!occ) return "";
  if (occ.source === "flight" || (occ.contexts || []).includes(PACK_FLIGHT_CONTEXT)) return "F";
  return (occ.contexts || []).filter(c => c && c !== TRIP_CONTEXT).slice().sort().join("+");
}
```

and fold `packFitSig(occ)` into EVERY one of the five keys above (for
`packSolve`, extend `groupKey`; for the others, append to the memo/rep key).
Distinct fit signatures per trip ≈ distinct context sets (3–5), so the extra
enumeration is bounded — keep the memoisation, do not drop it.

**Test:** a trip with a Flight occasion and an Errands occasion at the SAME
level, closet containing a sundress she's worn for Errands but never flown in
(fixture per the existing "silhouette she has never flown in" case). Assert the
Errands candidate list contains a dress combo and the Flight list does not —
**and run the assertion twice, with the demand array in both orders.** Mutation:
remove `packFitSig` from `packSolve`'s groupKey → one order goes red.

### P0-2 · "Keep" does not actually bypass the filters (violates her core condition)

In `packFill`, keeps bypass only the season clause:

```js
const candidates = avail.filter(i =>
  !skip.has(i.id) &&
  (rackSet.has(i.id) || (needsUtility && isFunctionWear(i))) &&   // keeps NOT exempt
  (i.category !== "Workout" || needsUtility) &&                    // keeps NOT exempt
  (keep.has(i.id) || seasonOk(i)));
```

A kept piece not on the trip rack never enters `inSlot`, so:
- **"Same as last time" silently drops pieces.** `openPackTemplateSheet` pins a
  past trip's pieces and re-solves; any of them off this trip's rack — or, since
  r5, not covering a demanded level — vanish from the copy with no message.
- An off-rack piece she added by hand survives most edit paths only by accident
  (they add rather than rebuild), and `packSetTarget`'s "can't add" toast can
  misfire because held pieces aren't re-emitted by the fill.

This is the pack-side analog of the rack's hard condition ("locking a non-rack
piece never fails" — the line between a tool and a cage).

**Fix:** a keep bypasses EVERYTHING. Simplest shape: build `candidates` as
before but without the keep clause, then union in `avail.filter(i =>
keep.has(i.id) && !skip.has(i.id))`. Keeps still occupy their slot's budget
(existing behavior); the r5 level gate must not apply to them (it already
doesn't — they're pushed into `chosen` before the while loop — but only if they
reach `inSlot`, which is the bug).

**Also:** every explicit add becomes a keep — `packAddPiece` and any swap-in
from a widened pool must add the id to `rec.pinned`. An explicit choice is a
decision, not a candidate.

**Test:** template-copy a past trip containing one piece that is off this
trip's rack AND covers no demanded level; assert it survives `packLoadState({
resolve: true })` into the pack. Mutation: revert the union → red. (Fixture
guard: assert the piece is genuinely absent from `rack.ids` first, or the case
is vacuous — the r2 lesson.)

### P0-3 · The pack record has no algo stamp — shipped fixes are invisible (the RACK_ALGO lesson, missed twice)

`packLoadState` uses stored `rec.pieces` whenever it exists (inversion ③,
correct). So the r5 and r6 FILL changes ship invisibly for every already-built
pack until she happens to press "Start over from the app's numbers". Her
"still seeing 'doesn't fit any occasion'" report was exactly this. The codebase
already documents this trap (`RACK_ALGO`, 2026-08-04 r2; memory file
`cached-derived-state-needs-a-version-stamp`), and r5/r6 walked into it anyway.

**Fix:** `PACK_ALGO` constant in `js/21-pack.js` (start at 3, representing the
r5+r6 rule changes already live); `packPersist` writes `algo: PACK_ALGO`;
`packDiff` gains a reason when `rec.algo !== PACK_ALGO`: *"the packing rules
have changed since this was built"*. Surface `packDiff`'s reasons as a banner on
`renderCapsulePack` (they currently have no surface there) with the existing
"Start over" button as the action. ⚠️ **NEVER auto-refill** — stability is the
feature; the banner offers, she decides. Bump `PACK_ALGO` whenever
`packFill`/`packCandidates`/`packOccasionSlotFit` SELECTION rules change, not
for copy. Document the bump rule beside the constant, mirroring `RACK_ALGO`.

**Test:** record with `algo: 2` → `packDiff` includes the reason; with current →
doesn't. Mutation: stop writing `algo` in `packPersist` → red.

### P1-4 · The plane filter can strip outerwear

`packOccasionSlotFit` returns only slots present in the occasion's history. A
summer-heavy flight history lacks Outerwear → a cold-climate flight gets no coat
in its candidate pool. Weather decides layers, never context history.

**Fix:** unconditionally `slots.add("Outerwear")` before returning a non-null
set. **Test:** flight history of tee/jean/snk only; assert a coat survives into
the Flight pool (enumerate with a layer-boosting cold wx). Mutation: remove the
add → red.

### P1-5 · The season gate reads only each leg's first day

`packFill`'s `legSeasons` uses `seasonOf(leg.dates[0])` and that day's wx. A
one-leg trip crossing a season boundary (late Sept → Oct) gates the whole bag on
"Summer", excluding a Fall piece the trip mostly needs.

**Fix:** per leg, collect `new Set(leg.dates.map(seasonOf))` and let `seasonOk`
pass if the piece clears ANY season of ANY leg (wx rescue: any day's wx for that
leg, cheapest honest version: first day of each distinct season within the leg).
**Test:** trip spanning a boundary; Fall-only piece; assert packed. Mutation:
revert to `dates[0]` → red. (Fixture guard: assert the two seasons really
differ across the fixture trip's dates, else vacuous — use fixed dates, not
`D(n)` relative ones, for this case.)

### P1-6 · Rehydrate is all-or-nothing — one dropped piece reshuffles every unlocked day

`packEnsureSolve`'s `usable` check requires EVERY occasion's stored assignment
to be intact; one invalid entry (she dropped a piece) → full re-solve →
unlocked days she never touched reshuffle on the next outfits open.

**Fix — incremental re-solve:**

```
stored = packAssignFromRecord(cid)
validLocks = Map of every occ whose stored cd exists and cd.ids ⊆ pack
if validLocks covers every occ that has candidates → pure rehydrate (current fast path)
else → packSolve with locked = validLocks ∪ explicit locks, restarts ~60
```

An EXPLICITLY locked occ whose cd is invalid must not silently unlock — leave it
out of the lockedMap and let `packConsequences.broken` flag it (it already
does). **Test:** solve, persist, drop one non-shared piece, reopen outfits →
every other day's `assign` ids byte-identical to the record. Mutation: revert to
the all-or-nothing check → red.

### P1-7 · Affinity is half-installed — the bag knows her favourites, the day cards don't

r6 added `packAffinity` to `packFill` only. The greedy that assigns outfits to
days scores `- prov * PACK_PROVEN_W - cd.score * PACK_SCORE_W ...` with no
affinity term, and `packCandidates` orders by `scoreCombo` alone — so Tuesday's
card can still lead with the shoe she never reaches for, out of a bag that now
contains her Birkenstocks.

**Fix:** (a) in `packSolve`'s inner cost, add `- affSum * PACK_AFF_GREEDY_W`
where `affSum = Σ packAffinity(id, sig)` over the combo's pieces and `sig` is
built ONCE per solve (never per candidate — the items × wears trap). (b) in
`packCandidates`, add affinity as a post-score tiebreak so the 8 OFFERED lead
with pieces she wears. **Both weights are MEASURED, not guessed** — see Part 3.
Ceiling: the greedy term must never outweigh one piece (1000) or a violation
(5000); start the probe at `PACK_AFF_GREEDY_W = 30`.

### P2-8 · Affinity double-counts trip wears

`packWearSignals.home` counts ALL days including away days, then trip days get
+2× on top — effectively ~3×, while the comment says "double". **Fix:** exclude
away dates from the `home` pass (the `away` set is already built). Trip weight 2
stands. Update the comment to tell the truth.

### P2-9 · Affinity can defeat variety — three beloved sandals

`subsUsed * 12` vs an affinity term that reaches ~75: a slot of 3 can fill with
three same-subcategory favourites. Whether that's wrong is an empirical
question. **Measure on the realistic fixture (Part 3); if favourites stack,
raise the subs penalty toward ~25 rather than capping affinity** — variety
should cost the SECOND favourite of a subcategory, not mute the first.

### P2-10 · Known, accepted, documented (no code unless a probe shows them)

- Flight evidence includes arrival-evening wears (she lands, changes, dinner) —
  pollution is PERMISSIVE (filter says nothing), which is the safe direction.
- `packFill`'s `needAt` doesn't know slot-fit, so a dress can be packed "for" a
  level whose only occasion is a flight; `packCoverage` (post-P0-1) will name
  the gap honestly. Act only if the Part-3 probe shows it on a realistic closet.
- Gear-tagged everyday pieces get breadth credit for level 1 + their formality
  set (`set.length * 6`), a small subsidy on trips with a workout day. Probe it;
  if it distorts, count level 1 in `set` only when `i.category === "Workout"`
  or `isGearOnly(i)` — but only with a measured reason.

### P3-11 · Copy

- Kept piece covering no demanded level: why-line should read
  **"kept — no day on this trip is dressed like this"** (not the neutral
  "nothing else in the bag goes with it yet"). She chose it; say so.
- `packSetTarget`'s can't-add toast: after P0-2, compare against pieces
  actually addable (fill output minus held), or it misfires.

---

## PART 2 — THE FEATURE: suggester round-trip + tap-over (her ask, decisions locked)

### D1 · Entry points
- **Every outfit card** — pack screen days view (`packDaysHtml`) AND by-day plan
  cards (`packPlanCardsHtml`) — gains a **"✨ Beyond the bag"** button in the
  existing `.pack-occ-acts` row (it wraps; render and measure at 390px anyway).
  Existing buttons keep their names.
- **The gap card** ("Nothing available covers this") gains **"✨ Find
  something"** — the entry that matters most. It opens the suggester **already
  widened to the whole closet**, chip reading why ("Pack can't dress this").
  Starting narrowed there guarantees an empty sheet — the 2026-07-19 bug class;
  this mirrors the r2 `poolCoversLevel` rescue.
- **Tap-over, list → outfits:** the occasion labels in a bag row's why-line
  (`packItemWhy`'s "for Flight / Casual") become a tap target that switches
  `_packMode` to "outfits" and scrolls to that occasion's card (store
  `_packScrollOcc`, consume after render). Outfits → list already works (piece
  tap → swap sheet).

### D2 · The sheet
New `_sugg.packOcc = { cid, occId, date, label }`, set by a new
`openPackOccSuggest(occId)` which goes through `packStateReady(cid)` first.
- **Pool:** the pack. Reuse the `_sugg.capsuleId` branch (pack pieces ARE the
  capsule members after `packSyncMembers`) — pool chip copy: **"Pack · N"**.
  Widen = existing `_sugg.wholeCloset` (session-only, resets on open — the rack
  conditions apply verbatim: named pool + count, one-tap widen).
- **Seed:** the occasion's current assignment renders as the combo in front
  (the `openTomorrowRevise` / `_sugg.tmPick` pattern).
- **Level:** `occ.level` preset (hard filter as usual). **Weather:** that
  date's `_planWx` (the plan-suggest path already does this).
- ⚠️ **"Clean only" is forced OFF and the chip HIDDEN in packOcc mode.**
  Laundry is a SCHEDULE constraint for packing (inversion ②) — the chip would
  reintroduce divide-don't-schedule through the UI. `packCandidates` already
  passes `cleanOnly=false`; the sheet must match.

### D3 · Confirm
Primary action reads **"Use for {label}"** (never "Wear this today" — nothing
is being worn). `packUseCombo(occId, pieces)`:
1. `st.res.assign.set(occId, cd)`; lock via `packMarkLocked`.
2. Pieces not in the pack join it **as keeps** (P0-2 semantics) and
   `packSyncMembers` runs.
3. `packRepack` + `packRefresh` (linear, no solver), `packPersist`, close sheet.
4. Toast the consequences: pieces added, any laundry note — plus a
   **"Re-balance the rest"** action chip → `packResolveUnlocked` (locked days,
   including this one, survive by construction).
⚠️ **NO look is created and nothing writes `capsules.plan`** — the r5 rule
holds; a look materialises only on "Wore it" (`packWoreOccasion`).
⚠️ **Nothing re-solves automatically.** The chip is an offer.

### D4 · Ripples
- Widened-in pieces may be off-level or out of season — she chose them; they're
  keeps, the gates don't apply (P0-2), the why-line stays honest (P3-11 copy).
- Unlock later: pieces stay in the bag; `packConsequences.orphans` +
  the existing "isn't in any outfit now → Drop it" toast pattern handle it.
- Two same-day occasions locked to identical pieces merge on display (existing
  rule).

### D5 · Tests (each mutation-checked red in-session, per the standing rule)
1. `packUseCombo` with a whole-closet piece: assignment written, occ locked,
   piece in pack AND in `rec.pinned`, no new row in `outfits`. Mutation: skip
   the pinned write → red (via a follow-up `packLoadState({resolve:true})`
   dropping it — which also re-proves P0-2).
2. Re-balance after lock-in: `packResolveUnlocked` preserves the locked occ's
   ids exactly. (Existing "locked occasion keeps its outfit" case covers most;
   add the assertion through the new path.)
3. Gap-card entry opens widened: with a bag that can't dress the occasion,
   the sheet's pool is the whole closet and the chip names it (assert on
   `_sugg.wholeCloset` + chip HTML, not on pixels).
4. Clean-only forced off in packOcc mode (assert `_suggCleanArg()` / chip
   hidden).

### D6 · Render-and-read checklist (the lesson this feature keeps teaching)
At 390px, in the harness host: pack day card with 4–5 action buttons (wrap, no
sideways overflow); by-day card ditto; the suggester sheet over the pack with
the "Pack · N" chip and "Use for …" button visible; bag row with tappable
occasion labels; the toast + chip. Read the text out loud — that's what caught
"Casual · Casual" and the 62px thumb.

---

## PART 3 — MEASUREMENT TASKS (do these, record numbers in CLAUDE.md)

Build one realistic probe fixture in the selftest console style: ~200 pieces
with the real closet's shape (many tees, few dressy), wear history concentrated
on ~40 pieces, 2 completed trips. Then, before/after each weight change:
- % of assigned-outfit pieces that are top-quartile-by-wear-days (P1-7 target:
  should rise; violations and pack size should NOT move).
- Same-subcategory stacking in Shoes at target 3 (P2-9).
- Whether any packed piece serves only a flight-day level (P2-10 second item).
Weights are frozen only after these numbers exist. The r6 weights were set on a
5-item toy — treat them as provisional.

---

## PART 4 — OPEN, NOT FOR BLIND FIXING

**The recap/date-edit report** (wear on a removed last day showing in the
review) is still not reproduced — `tripRecapData` and `packGrade` both bound
correctly, verified live (see CLAUDE.md r5 note). Before any code: ask her
(1) what the trip's dates read as NOW on the trip page, (2) which screen showed
the wear — the recap sheet, "How the pack did", or the Travel stats page.
Travel stats aggregate over `completedTrips()` whose members come from
`capsule_items` — a piece added to the capsule but worn on the removed day
would appear there via a different path than the two already checked.

---

## PART 5 — GUARDRAILS (the standing ones, restated for this build)

- Check the suite is green BEFORE starting (330/330 at r6). Deploy first, test
  after (her instruction), but never skip the mutation checks — log which
  mutation made each new case fail.
- No bulk look creation, ever. No auto-re-solve, ever. Facts, never advice.
- Every pool is named, counted, and one tap from widening.
- Don't add scoring/filtering knobs to `suggestOutfits`' `opts` — that forks
  the engine (inversion ①).
- Zero new columns; everything lands in the `kv "pack:<cid>"` record.
- A wear is a DAY. New thumbs get their own class. No hardcoded colors.
- When you add a level-1 reader, audit them all (`packCoversLevel` is the one
  function; keep it that way).
- Version lockstep: `APP_VERSION` + meta + all 24 `?v=` tags; prepend
  `RELEASE_NOTES` (WHATS_NEW derives from its head).
