# CLAUDE.md — Wardrobe App

Guidance for working in this repo. Read alongside `README.md`.

> ## ⚠️ READ FIRST — the product philosophy was re-decided on 2026-07-26
>
> A strategy interview that explicitly treated **every "locked" decision in this
> file as provisional** produced an approved philosophy that supersedes the
> product framing below wherever they conflict. The engineering content of this
> file (architecture, gotchas, data model, conventions) is unaffected and still
> authoritative. **`AUDIT_2026-07-26.md` in the repo root is the companion** —
> findings, what's fixed, what's open, and a revised rack spec.
>
> What changed, in short:
> - **Identity is mirror-first, and that's stronger than this file implies.**
>   She opens Stats *daily*, to look rather than to learn, and when offered 12
>   analytical features to cut she kept 11 (dropped **Mending**, removed in r8).
>   The stats ARE the daily reward.
> - **The app is over-*presented*, not overbuilt. Compress, don't delete.**
>   Given one round she chose a coherence pass over new features.
> - **The rack is BUILT (2026-07-26 r6+r7, `js/20-rack.js`)** — a standing ~46-piece derived pool
>   the suggester draws from by default, stratified by slot + formality +
>   temperature, **80% recently-reached-for / 20% deliberately cold**. The cold
>   quota is load-bearing: without it the rack calcifies and shrinks her working
>   wardrobe, i.e. the mirror would cause the thing it measures. It must read
>   **forward `dayplan` contexts and trip dates** so declared upcoming events
>   stock it, rather than guessing levels from history. Her four conditions:
>   the rack is always a visible screen, the suggester always names its pool
>   with a count and a one-tap widen, pull-in works from anywhere, and locking a
>   non-rack piece never fails. **All four are enforced and pinned by tests** —
>   see the RACK entry below.
> - ⚠️ **This conflicts with two entries below** and the conflict is deliberate,
>   not an oversight: ⑨'s "rescue-only: widens the pool, never narrows it", and
>   the suggester's "by design there is NO unworn/last-worn weighting". The rack
>   narrows, and reintroduces recency via pool construction. She approved it
>   knowingly, on condition the narrowing is visible and reversible.
> - **Hard NOs, asked directly:** notifications, AI, a second user, shopping,
>   voice, export-as-a-product. In-app laundry prompts remain fine.
> - **Sacred two-tap:** "what do I wear today" and "log what I wore".
> - **She likes building this.** The goal is not to finish — it's an app that
>   can absorb five more years without getting worse.

**"THINGS YOU MIGHT BE WRONG ABOUT" (2026-07-26 r10) — SHIPPED.** Audit B3, and
the clearest expression of the mirror-first identity: the app knows things about
the wardrobe that disagree with what she TOLD it, and the disagreement is more
interesting than either number alone. `buildMisfits(pool?, wearRows?)` +
`renderStatsMisfitPage()` + `statsView "misfit"`, row in Clothing Stats.
Per Available piece with an EXPLICIT `items.formality` and ≥`MISFIT_MIN_DAYS`(5)
levelled wear-DAYS: if ≥`MISFIT_SHARE`(70%) of those days sit at a level the
claim doesn't contain, it's flagged. `addMisfitLevel` **appends, never replaces**
(same rule as the season flag) and clears every `o._bucket`.
⚠️ **Explicit formality only** — `itemFormalitySet()` imputes a set when none is
stored, and flagging an imputed value would be the app arguing with itself.
⚠️ Not circular with the piece's own tag: `wears.formality_for` is derived from
the WHOLE outfit (`deriveWearFormality`), so a blazer tagged Dressed Up that
keeps going out with jeans records genuinely lower days. A solo-logged piece
derives its level from itself alone and so can never disagree — harmless.

**THE TRIP BUILDER / "pack plan" (2026-07-29 r2 → r4) — SHIPPED, phases 1–6.**
`js/21-pack.js` (boot renumbered to `22-boot.js`; index.html now has **23**
cache-busted tags). **Full spec, all 13 locked decisions, the rejected
alternatives and what's still open: `TRIP_BUILDER.md` in the repo root — read it
before touching any of this.** Her ask: suggest what and how many to pack, from
past trips + past wears + this trip's weather + laundry tolerance. Selftest
177 → **231**, run green; all 54 new cases mutation-checked red in the same
session. Entry: a dated trip's capsule page → "✨ Build the pack".

⚠️ **REPETITION IS A FIRST-CLASS COST (r4), and D5 alone did not cover it.**
A 5-day trip returned Thursday and Friday as the IDENTICAL outfit with one
sweater on 4 of 5 days at exactly its tolerance ceiling — zero violations,
minimum pieces, "correct", and it read as the app failing. K guards how many
options *exist in the pack*, not whether consecutive days differ, and the laundry
counter only stops a piece EXCEEDING tolerance, so sweaters (4) and shoes
(Infinity) sail through. `PACK_REPEAT_DAY`/`_ANY`/`_TOP` charge repetition on the
**visible half only** — reusing the same jeans and shoes all week is the point of
packing light — and **`repW` scales them by the tightness dial**, which is what
finally makes lean/normal/cushion change something she'd notice.
⚠️ `PACK_REPEAT_DAY` is deliberately NOT scaled: the identical outfit two days
running is the worst-looking output, so that floor holds at every tightness.
⚠️ **`PACK_SCORE_W`(150)/`PACK_PROVEN_W`(60) fixed a pre-existing calibration
bug:** `scoreCombo`'s range is only ~2.5–5.5 points against cost terms of
1000–5000, so the suggester's formality cohesion, colour-pair and item-pair
affinity were **rounding error** inside the solver. Re-measure if that range
changes.

**`packMidTripWash(c, today)` (r4)** re-runs `packSchedule` FORWARD from real
state over the days still left, and names the pieces the back half needs washed —
the actionable version of "6 things are dirty". ⚠️ Reads the **by-day plan
first**, the solve record only as a fallback: by mid-trip the plan is what she's
been living from. Owns whether to speak at all, exactly like `tripUnwornNow` —
null on the last day (the recap owns it) and null when nothing would run out. Its
`.td-laun` row **folds the generic hamper row** when it already names everything
dirty; two rows for one fact was found by rendering the dash and reading it.

⚠️ **THREE INVERSIONS. Getting any of them backwards produces a plausible WRONG
answer rather than an obvious failure — that's why they're written in the file
header too.**
- ① **OUTFITS FIRST; the pack is the union of their pieces.** Set cover over
  `(slot, level)` cells cannot work — cells aren't independent, so it returns
  packs where every cell is satisfied and no wearable outfit exists. **Counts are
  an OUTPUT, never a target.** The old `max(laundry, coverage)` formula survives
  only as the "why is this here" text on a bag line.
- ② **SCHEDULE, DON'T DIVIDE.** `ceil(wear-days / tolerance)` breaks on uneven
  distribution and can't name a day. `packSchedule` walks the dates, so
  infeasibility arrives **with a DATE**. ⚠️ It seeds each counter from
  `last_washed` + `laundryState` — a jean at 4/5 wears on departure day is
  tolerance-1 for the trip. `planRewearFlags` fixed this exact bug once already.
- ③ **THE SOLVE IS AN EVENT, NOT A FUNCTION.** Output is state (`kv "pack:<cid>"`
  + `capsule_items`); edits mutate it and never re-enter the solver. Same model as
  the rack — **stability is the feature**. Determinism comes from a seeded RNG
  swapped over `Math.random` for the duration of a *synchronous* `suggestOutfits`
  call; ⚠️ if that function ever gains an `await`, this breaks.

**It REUSES the suggester rather than forking it** — three small extensions:
`suggestOutfits` gained an `opts` param (`{all, uniqueCap}` = exhaustive mode);
`buildRack` gained an optional `quota` (`PACK_TRIP_QUOTA`, cold share untouched);
`buildTripWeather`'s leg-splitting moved to `tripLegs`/`tripLocForDate`.
⚠️ **Do not add scoring or filtering knobs to `opts`** — the moment the pack asks
for different RULES it has forked the engine and ① is broken.

- ⚠️ **`PACK_SOLVE_CANDIDATES` (120) is LOAD-BEARING and separate from the 8
  offered.** The top 8 by score are near-duplicates (same shirt, different shoes),
  which starves the laundry constraint: a 10-day trip on tolerance-1 tees came
  back with five violations its closet could easily have avoided.
- ⚠️ **The greedy walks the trip in DATE ORDER with a running wear counter.**
  Scoring only "new pieces added" makes reuse free — ten days at one level all
  chose the identical outfit, and a post-hoc repair can't undo it because every
  occasion shares one candidate list. **Do not "simplify" this back.**
- **Candidates are enumerated once per (level, leg, temperature band)**, not per
  occasion; per-occasion was a measured hang. `RACK_SLOT_QUOTA` is home-sized, so
  the pack passes `PACK_TRIP_QUOTA`; **one rack PER LEG, unioned** (Madrid-then-
  Javea is two climates).
- ⚠️ **`packCandidates` passes `cleanOnly=FALSE` deliberately.** Laundry is a
  SCHEDULE constraint here, not a pool filter — a piece dirty today is fine after
  a wash before departure, and filtering it is ② in a new hat. Level 1 draws from
  the whole closet, never the rack (same precedence as `_suggBasePool`).
- **Demand is a MULTISET of occasions (D6), not a day grid.** Placement only
  matters for a mid-trip wash. ⚠️ The character mix is a **target count across the
  trip**, and **travel days are claimed BEFORE the guesses** — filler-only meant a
  "two dressy evenings" character produced NO dressy occasion, because weekday
  rhythm had taken every day, and travel-last stacked three occasions on the
  departure day.
- **Tightness = options per occasion** (`PACK_OPTIONS` 1/2/3), not spare pieces.
  That's what makes `minimize |pack|` safe as an objective: K carries variety
  structurally, the way `RACK_COLD_SHARE` does at home.
- **ZERO new columns.** Slate + fixed events → `dayplan`; wash day →
  `PLAN_LAUNDRY`; pack → `capsule_items` (`packed=false`); solve record + trip
  character → `kv`. ⚠️ **`pruneDayPlan` now exempts dates inside a dated capsule**
  — without it a September trip planned in July was silently deleted on the next
  save (also a latent week-planner bug). `RACK_LOOKAHEAD_DAYS`(14) is what keeps a
  distant declared event out of today's rack; **don't widen it** for this feature.
- ⚠️ **`packSyncMembers` never un-packs something already ticked** `packed=true` —
  it's physically in the bag.
- ⚠️ **`capsules.plan` was written ONLY by an explicit "send to the by-day plan"
  — THAT BUTTON IS GONE (r5).** The reason survives: still no bulk look creation,
  ~13 records per solve would flood her Looks list. The by-day plan now READS the
  pack record (`packPlanByDate`) and one look is materialised per outfit she says
  she wore. See the r5 entry.
- **Honest partial (§9), not a smaller silent pack:** "8 of 10 occasions covered",
  each named with its date and reason. That's the r12 "looked like a partial
  result" bug guarded against. Gaps offer the nearest coverable level and **never
  a purchase** — shopping is a hard NO and packing is where it's most tempting.
- ⚠️ **`packLeftOut` is a fact, never advice** (from `travelUnused`): "packed 3×,
  worn 0×" with a one-tap Bring it. Never a "stop packing this".
- ⚠️ **The bag line and the schedule must both count `(item, DAY)`.** The line
  said "needs a wash mid-trip" for a tee used twice on ONE day while the schedule
  correctly found no violation. Same `countByDay` rule; a case pins the agreement.
- **Same-day occasions in identical clothes merge into one card** — `dayplan`
  already settles it ("one outfit across contexts = one entry"). Display only; the
  laundry and options math still sees both.
- ⚠️ **Three defects were found by RENDERING THE SCREEN AND READING IT, not by the
  tests** (the day/occasion contradiction, "20 options" beside a "See 20" button,
  and the stacked departure day). Same lesson as the 181px button.

**TRIP RETROSPECTIVE + TRAVEL MEMORY (2026-07-29 r1) — SHIPPED.** Her ask: "what
haven't I worn" + "what earned its weight". Trip mode had a beginning and an end
but nothing carried forward, so the recap was an autopsy. Selftest 167 → **177**,
run green, all 10 new cases mutation-checked red in the same session. No schema
change — every number derives from `wears` + `capsule_items` + capsule dates.

- ⚠️ **`tripRecapData(c, opts)` is now ONE derivation with TWO surfaces.**
  `opts.through` bounds the window at a date inside the trip; mid-trip passes
  today, the recap passes nothing. A second walk over `wears` for the live case
  would have been free to drift. `opts.wearRows`/`opts.members` exist so the
  travel derivations are injectable. Returns wear-days, tiers, `unpacked`,
  `outfitCount`, `elapsed`.
- **`tripUnwornNow(c, today)` owns whether to speak at all** — null on day 1
  (everything is unworn; the number is noise) and on the last day (the recap owns
  it). `TRIP_UNWORN_MIN_DONE`(2) completed + `TRIP_UNWORN_MIN_LEFT`(2) remaining,
  so a weekend trip never sees it. **Deliberately no dismiss** — it's inventory,
  not a prompt, and it goes away by itself. Surfaces as a `.td-laun` dash row
  (same shape as the hamper row) → capsule detail with a new **`_capUnwornOnly`**
  chip. ⚠️ **No fourth closet shelf flag on purpose** — the capsule screen already
  IS the suitcase, and `_capUnpackedOnly` was the precedent; the two chips answer
  different questions so each clears the other.
- ⚠️ **`tripUnwornPool` does NOT hard-filter, and must not be "simplified" into
  one.** Six unworn tops don't make an outfit — that's the r12 workout bug in a
  new costume, worse than empty because it looks like a partial result. It's
  rescue-shaped like `inSeasonWx`: starts at unworn, widens per missing core slot
  (`TRIP_CORE_SLOTS`; a Dress covers Tops+Bottoms) from the rest of the suitcase,
  and returns `rescued` so the chip says so. `_sugg.unworn` beats `_sugg.capsuleId`
  in `_suggBasePool`; the pool chip names and counts it and the one-tap widen
  clears it — the rack conditions apply here too. Entry: `openTripUnwornSuggest`.
- **Recap tiers are wear-DAYS against ELAPSED days**, not a boolean:
  `TRIP_WORKHORSE_SHARE`(0.4), min 2. ⚠️ The "worn, but only just" label falls back
  to plain "Worn" when there are no workhorses — it's a comparison, and with no
  top tier it reads as a dig at everything she wore.
- ⚠️ **`unpacked` ("wore it, didn't pack it") is polluted by design.** Accepting
  the in-trip `tripMissingPieces` offer makes a piece a member, so what lands here
  is what she DECLINED to call a trip piece. Known and accepted — arguably the
  more interesting set.
- **Cross-trip: `buildTravelStats` / `travelProven` / `travelUnused`** over
  `completedTrips()` = every **dated** capsule whose `end_date` has passed
  (`kind` is deliberately not consulted — dates are what trip mode keys on
  everywhere else). `TRIP_MEMORY_MIN`(2) trips before a piece's record says
  anything. Two surfaces: `statsView "travel"` (**whole-wardrobe page → no pool
  AND `hideFilter=true`**, per the funnel rule) and a trip-aware
  `capsulePickSuggestHtml` that leads with proven travellers — the packing list
  is the moment past trips are worth something. It **prepends, never substitutes**,
  so a first trip still gets the workhorse strip, and it excludes the open trip
  itself.
- ⚠️ **"Packed, never worn" is a fact, never advice.** A piece packed three times
  and never worn may be the just-in-case option doing exactly its job. The page
  says `packed 3× · worn 0×` and carries an explicit "not a verdict" note. Do not
  turn it into a "stop packing this" recommendation.
- **Rejected in the same conversation:** a weather-vs-packing retrospective ("you
  packed for 60°, it was 78°"). The data exists and it is the r19 guessing-layer
  trap in a new hat — an insight nobody acts on.

**2026-08-13 r1 — THE MORNING QUESTION IS A REAL BUTTON IN TRIP MODE TOO.
Selftest 395 → 396, run green; the new case mutation-checked red.** Her report:
*"I still need a 'what should I wear' button like I have in the home screen on
trip mode home screen."* Home suppresses its own primary ask whenever trip mode
is on, on the grounds that the dash owns the suitcase-scoped version — but that
was ✨ Suggest, **a chip in a row of four**, i.e. the morning decision at the same
weight as "Packing list". ⚠️ **The chip is REPLACED, not joined** — same handler,
same data attribute, same suitcase pool, so there is still exactly one door to
the suggester. `.td-ask` measured 326px in a 390px column.

**2026-08-17 r2 — DELETING LOOKS SHE NEVER WORE, AND THE MEMORY ROW WAS HIDDEN
INSIDE A CLOSED FOLD. Selftest 310 → **312**, run GREEN; both new cases
mutation-checked red in the same session.**

**"Delete all looks created but never worn"** (her ask; she has 1,100+ looks, 98%
unnamed, so the ones that never left the wardrobe are clutter in every picker).
`neverWornLooks()` + `openNeverWornLooksSheet()`, reached from a **Looks Stats**
row beside Liked Looks.
- ⚠️ **NOT in the Settings health check, deliberately.** That screen is for
  integrity problems, and this is curation. The same call was made once before:
  season/weather disagreements were kept out of it because "routing them through
  a health-check row built an audit queue she couldn't act on".
- ⚠️ **THREE SHIELDS, and the sheet states each count.** ① HEARTED —
  `likedNeglectedOutfits()` exists to RESURFACE liked-but-never-worn looks, so
  sweeping them would fight that feature directly. ② PLANNED — in a capsule's
  plan or a `dayplan` entry; deleting one breaks a plan she is still holding.
  ③ Made in the last `NEVERWORN_GRACE_DAYS`(14) — a look built last night for
  tomorrow is the likeliest thing to lose to an impatient sweep.
- Uses `deconstructLookCore`, the same primitive as `deleteLook`; for a
  never-worn look there is no wear history to keep, which is why the copy can say
  "no wear history exists to lose" honestly. A partial failure reports where it
  stopped rather than leaving the count a mystery.

⚠️ **"YOU'VE DRESSED FOR THIS BEFORE" WAS INSIDE THE REFINE FOLD, WHICH IS CLOSED
BY DEFAULT.** Her ask was "for all outfit suggesters, that's where I want it —
tappable from within outfit suggester but not elsewhere", and the reason it felt
missing is that 2026-08-14 r1 folded the filter chips away and this row went with
them: present in the sheet, invisible in practice. It now renders **below the
action buttons** (measured y=1,136 with Refine closed) — the outfit is the answer
and leads, the way to act on it comes next, and this is the evidence underneath.
Putting it above the actions would undo r1's whole point.
- **Removed from the Today card** (`{compact:true}`), along with its now-dead
  `wireWxMemory($("#homeBody"))` call — a live handler for markup nobody renders
  is how a removed thing creeps back (r7's rule).
- ⚠️ **ONE call site, and a structural case pins it.** Rendering it only in the
  suggester is what makes "all outfit suggesters" true for every surface that
  OPENS the sheet, without repeating the row on any of them.
- ⚠️ **The case's fold check had to be re-anchored twice.** `_sugg.refineOpen`
  also matches its initialiser and the chevron, and `suggestRatherHtml()` matches
  that function's DEFINITION earlier in the file — both made the first version
  fire on correct code. It anchors on the block's own opening,
  ``_sugg.refineOpen ? `<div``.

**STILL OPEN — the planning suggester.** Her third ask, *"for planning, I want an
outfit suggester for planning rather than the way it looks now"*, is NOT built:
the planning surfaces already call `openSuggestSheet` with a `planCtx`, so what
"the way it looks now" refers to is genuinely ambiguous (the Today card's thumb
strip? the day-plan sheet's per-entry rows? the week planner?). Asked rather than
guessed.

**2026-08-17 r1 — PARTIAL CREDIT FOR AWAY WEARS, TRANSPARENT PHOTOS, AND THE
RACK IN THE PLACES SHE ALREADY LOOKS. Selftest 307 → **310**, run GREEN; all 3
new cases mutation-checked red (four mutations), and ONE OF THEM WAS VACUOUS ON
FIRST WRITE.**

⚠️ **THE FLAT AWAY PENALTY WAS THE BUG, NOT THE FIX — her correction:** *"why
should an away only wear shift back 21 days and skip away days? that's exactly
the problem I want you to fix."* 2026-08-05 r2 fixed "the rack becomes the
suitcase" with a BINARY rule: rank on the most recent HOME wear, push an
away-only wear back a flat 21 days, and skip away days entirely in
`rackForcedIds`. That is wrong at both ends — a piece she wore EIGHT of ten trip
days got exactly the same treatment as one she wore ONCE, and skipping away days
is under-counting to zero, which is the same failure as over-counting from the
other side.
- **The penalty is now proportional to how much of the trip she actually chose
  it.** `awayWearShare` = wear-days on that trip ÷ its elapsed days;
  `penalty = RACK_AWAY_PENALTY_DAYS × (1 − share)`. The constant stops being a
  flat charge and becomes the MAXIMUM one. Measured: worn 8 of 11 days → warmth
  0.82 (ahead of a 30-day-old home wear at 0.50); worn once → 0.55, behind but
  not erased. The gap between those two went from 0.05 to 0.27.
- ⚠️ **The better of the two wins now.** Taking `lastHome` unconditionally is
  what made a heavy trip wear invisible behind its own stale home wear.
- **`rackForcedIds` uses a share GATE (`RACK_AWAY_FORCE_SHARE` 0.4)** instead of
  skipping away days. The original bug it must not undo is the whole suitcase
  flooding rotation on the way home; a 20-piece bag has only a handful above 0.4.
- ⚠️ **`RACK_ALGO` 9 → 10.** Selection changed, and a stored rack cannot otherwise
  see that the code did.
- ⚠️ **THE GUARD CASE WAS VACUOUS AND ITS OWN MUTATION CHECK CAUGHT IT.** The
  first fixture gave "lived-in" a LATER last-wear day than "worn-once", so plain
  RECENCY explained the ordering and it passed with the scaling deleted. Both
  trip pieces now share a last-wear date, so only the share can separate them.
  ⚠️ And the second assertion was wrong about the app, not the app about itself:
  it compared against a "home wear on the same day", but EVERY date inside a trip
  is an away date (only the two EDGE days consult the suitcase), so it was
  comparing a trip wear with itself. It asserts against the unpenalised
  arithmetic instead, which is what makes "no penalty at all" go red too.

⚠️ **CUT-OUT PHOTOS WERE BEING FLATTENED ONTO WHITE ON UPLOAD** (her report).
`compressImage` called `fillRect` white unconditionally to "flatten any
transparency" — right when every photo was a camera shot, wrong now she removes
backgrounds, and it **contradicted the display layer**: `loadPhotoNode` sets
`backgroundColor = "transparent"` precisely so a cut-out garment sits cleanly on
the tile. Upload was destroying what display was built to show, and a white box
looks worst in dark mode. Now: sample the alpha channel (not the MIME type —
most PNGs are opaque and should still take the smaller flattened path), and keep
alpha when there is any. ⚠️ **JPEG cannot carry alpha, so a transparent image
falls back to PNG, never JPEG.** ⚠️ The case does a real ROUND TRIP — encode,
decode, read the corner pixel — because asserting the file EXTENSION would pass
on a WebP that had already been flattened.

**HER OTHER TWO ASKS.** The by-day planner is a third trip tab (`TRIP_SECTIONS`
gained `"plan"`, dated trips only — `tripSectionsFor`), not a ⋯ row;
`capsulePlanBodyHtml` is split out so the tab and the standalone page render the
SAME cards. And the suggester gained **＋ Add to a trip or capsule**
(`openComboToCapsuleSheet`): ⚠️ **it adds the PIECES, not just the look** — a
trip proposes outfits from `capsuleItems(cid)` and nothing else, so filing the
look alone would leave a trip that cannot rebuild the outfit she just put in it.
⚠️ The trip she is ON sorts first; ranking by `start_date` alone filed a current
trip under "past" (caught by rendering the sheet).

**TRIP WEARS COUNT FULLY EVERYWHERE ELSE — HER EXPLICIT DECISION.** Offered a
home-only ranking she said: *"workhorses/declutter should rank on everything, not
just home wear. even though I have less choice on a trip, I specifically chose
these pieces and that's real too. No weighting for anything unless we decide to
weight for the rack specifically, and in that case only the rack."* So
`wearDaySplit` is **informational only** — the item page states "31 at home · 12
travelling" and `wearCount`/`costPerWear`/`buildItemPerf` are untouched. The rack
is the only weighted surface, which is exactly what she scoped it to.
- **Packing is its own signal:** `travelRecordFor` on the item page ("Packed for
  4 trips · worn on 3"), a **Declutter shield** (`travelShieldIds`, the same
  pattern as `likedLookItemIds()`), and a **"Most packed" sort key**.
- ⚠️ **`travelRecordMap` is memoised on a length stamp** and invalidated from
  `buildCapsuleIndexes`. A bare `buildTravelStats()` in Declutter would be one
  full walk over every completed trip PER ITEM — the items × wears trap.

**THE RACK, IN THE PLACES SHE ALREADY LOOKS** (her ask, all four built):
Stats' "Lately" says "3 of the 11 you hadn't reached for" (⚠️ reads the STORED
rack — rebuilding there would spend a rotation tick on a stats render); the wear
screen says "✨ first time in 4 months" and **suppresses the duplicate gap chip**
(it used to render the gap AND "✨ back off the rack", which reads like removal);
looks made ENTIRELY of dormant pieces compete for the wear-again strip's two
reserved slots (⚠️ all, not any — an any-test matches most of the list); and the
Today card's pool label gained its COUNT.
⚠️ **A CORRECTION TO THE r1 AUDIT: the Today card was NOT narrowing silently.**
It has named its pool since 2026-08-03 ("from the rack · clean"); only the count
was missing. The audit overstated it.

**2026-08-16 r3 — THE PACK SOLVER IS GONE. Selftest 428 → **307**, run GREEN.**
Her call, from the audit's findings. It was switched off in 2026-08-10 r6 and kept
whole for one-commit reversibility; r7 removed the last five surfaces that could
start it. It then sat dormant for six days, and the audit found it was still
writing to the database.

⚠️ **THE SUITE SHRANK BY 121 CASES AND THAT IS THE HONEST NUMBER.** Nothing was
weakened — those cases drove functions that no longer exist. **Do not pad it back
up.** One case was **removed with the decision it guarded** ("the pack's suggester
offers to save the outfit, never to log it today" — the `_sugg.packOcc` writeback):
a red case is not automatically a regression.

**What went:** 222 of 239 definitions in the old `js/21-pack.js` (~5,950 lines),
~40 wiring handlers, the `capsuleView` `"pack"`/`"packopts"` branches, the
definites picker mode, the builder's pack-occasion save path and its "In the bag"
pool chips, the suggester's trip-scoped preference override (and `SIL_ANY` with
it), 45 dead `pack-*` CSS rules and 10 orphaned selftest helpers.
- ⚠️ **`js/21-pack.js` → `js/21-trip.js`.** 17 definitions, 367 lines: the trip
  screen (`renderCapsuleTrip`, `tripListSectionHtml`, `tripOutfitsHtml`, the ⋯
  menu) plus `tripLegs`/`tripLocForDate`, which `js/18-weather.js` needs and which
  outlived the solver. The file was named for something it no longer contained.
- ⚠️ **THE LIVE SET WAS COMPUTED, NOT GUESSED.** Transitive closure from the
  rendering roots, then every `data-*` the wiring reads was checked against
  whether any *surviving* code EMITS it. That is what caught the one non-obvious
  keeper: **`openCapAnchorSheet`**, whose markup (`data-capanchor-add`) is on the
  live capsule CREATE form in `js/16-capsules.js`, not on any pack screen.
- ⚠️ **`data-pack` and `data-pack-tick` are different hooks.** The first is the
  packed tick on a trip's list and is very much alive; the second was the pack
  screen's and rendered nowhere. Two handlers (`data-pack-addany`,
  `data-pack-resolve`) already had no emitter anywhere in the app.
- **The DB residue is fixed and measured:** `addItemsToCapsule` → `savePackRecord`
  did a GET **and** a POST to `/kv` on every add to a trip packed before r6.
  After: a single `POST /capsule_items`, with a stored `pack:<cid>` record present.
- ⚠️ **`kv "pack:<cid>"` rows are now unread orphans on the live DB**, deliberately
  not migrated — the same call as `"wxaudit_home"` and the `"mend"` tag.
- **Verified after:** all 23 modules parse, zero dangling references to the 222
  removed names, and all 13 screens render with no JS errors (the trip's Outfits
  section still proposes outfits from the list — 4 from 11 pieces on a fixture).

⚠️ **THE TEST-FILE SURGERY IS THE PART THAT NEARLY WENT WRONG, so read this before
attempting anything similar.** Three attempts at deleting 100 cases by parsing
failed: a hand-rolled paren scanner breaks on **regex literals** (`/(?:src|href)="/`
looks like an unterminated string), and boundary heuristics fail in both
directions — too long swallows a following helper's opening brace, too short
leaves a dangling `});`. What worked: a conservative boundary, plus **removing
trailing orphan closers**, plus **a JavaScriptCore parse check after every single
removal**, bottom-up, reverting any cut that breaks the file. ⚠️ And the first
labelling pass was WRONG because the over-long boundary made a case look like a
pack case when the pack reference actually belonged to the next one — it flagged
101 rather than 99. **Verify the boundary before trusting the label.**

**2026-08-16 r1 — A CLOSET / RACK / TRIPS WORKFLOW AUDIT, AND THE TRAVEL-DAY
RULE. Selftest 416 → **422**, run GREEN; all 6 new cases mutation-checked red in
the same session (four separate mutations, one per guarded behaviour).**
She asked for a workflow audit covering the closet, the rack and trips/capsules
— the three areas 2026-08-14 r1 listed as NOT covered — plus one specific fix.

⚠️ **THE TRAVEL-DAY RULE, her words:** *"I should have a way to wear things on
the day I leave for a trip and the day I return and not have them considered as
on the trip. If they weren't in the suitcase then I was home when I wore them.
If I wore them on the other days then they must have been in the suitcase."*
The two edge days of a trip are half at home — she dresses out of her own closet
the morning she flies and again the evening she gets back — and both sit inside
the trip's date range, so every trip-scoped derivation counted those clothes as
travel. **The suitcase is the evidence that settles it, and the app already had
it.** `tripEdgeDay` + **`wearWasOnTrip(c, date, itemId, memberIds?)`** is the one
derivation; `wearWasAtHome` + `tripEdgeMemberMap` is the same question asked of a
wear row by readers that walk `wears`.
- ⚠️ **ONLY the two edge days are ambiguous.** A middle day needs no test:
  whatever she wore, she wore it away from her closet. Testing membership there
  would re-file every piece she forgot to pack as a home wear — the opposite of
  the truth, and the mutation that removes the early return is what pins it.
- ⚠️ **AN EMPTY PACKING LIST IS NOT EVIDENCE OF ABSENCE.** With no members the
  app cannot tell "she didn't pack it" from "she never told me what she packed",
  so it falls back to counting the day as travel — rescue-shaped, like
  `inSeasonWx` and `packOccasionSlotFit`. Without this the rule would silently
  strip the Travel stamp off both ends of every trip she never ticked a list for.
- ⚠️ **THE STAMP IS DECIDED FOR THE LOGGED SET, NOT PER PIECE.** A context is a
  fact about the outing and one outing carries one context (dayplan's "one outfit
  across contexts = one entry"), so if any part of what she put on came out of
  the suitcase she was travelling in it. `tripWearContext(date, itemIds)` — called
  without ids it behaves exactly as before, and **all 7 wear-create call sites
  now pass them**. The recap stays per-piece, because its question is per-piece.
- **Four readers, one rule:** the Travel stamp; `tripMissingPieces` (silent when
  nothing she wore that day was packed — accepting that offer makes the piece a
  member, the one thing that turns a home wear into trip history permanently);
  `tripRecapData`'s `unpacked` (travel-day home clothes are no longer "wore it,
  didn't pack it"); and the rack's `rackWarmth`/`rackForcedIds`, where a piece she
  wore at home the morning she flew was sitting 21 days behind everything else
  under `RACK_AWAY_PENALTY_DAYS`.
- ⚠️ **WEATHER IS DELIBERATELY UNTOUCHED.** `awayRanges` answers "where was she",
  and on a travel day she was genuinely in two places — a day carries one weather
  record and no garment can split it. Changing it would poison season bands for a
  gain nobody asked for.
- ⚠️ **The new fixture RESTORES, and that is not optional.** `withEdgeTrip` has to
  carry `locations` (it is what makes `awayRanges()` non-empty), and leaving that
  behind made two unrelated cases fail — the rack refuses to rotate mid-trip, so
  "only the weekly cadence rotates the bands" went red against a trip the fixture
  had invented. Same lesson as `withRackCloset`'s `finally`.

**THE AUDIT — method, because it is the reusable part.** A harness at
**`migration/audit.html`**, which differs from the selftest in two ways that
matter: ① **it carries a viewport meta**, so a 375×812 iframe renders 1:1 and
layout numbers and screenshots are honest (selftest.html has none, which is why
CLAUDE.md tells you not to screenshot through it); ② **it injects an
`addEventListener` recorder BEFORE the app's own scripts**, which is the only way
to know which elements are real delegation roots. Every probe asserts `#app` has
non-zero width first.

⚠️ **HANDLER REACHABILITY IS GENUINELY SOUND — checked at runtime, which had
never been done.** CLAUDE.md flagged "delegation-SCOPE mismatches like the dead ⋯
menu need a per-sheet runtime check that was not run". It has been run now: 12
sheets opened and every `data-*` hook walked to an ancestor with a real listener
— **zero orphans**, the ⋯ menu included. A static sweep of all **381** emitted
attributes found one true orphan, `data-grp` (an unused group-key identifier,
harmless); `data-cap-pack`, `data-snapshot`, `data-v1` and `data-pack-dropOCC`
are all false positives from comments and cache-name strings. **A later round
needn't re-audit this.**

**Also verified correct, so a later round needn't re-check:** no horizontal
overflow on any of 11 closet/capsule/trip screens (`body.scrollWidth` 375
everywhere — the capsule list's off-screen "Delete" is the swipe action); the
laundry lens and the hamper shelf row agree on the count (17 = 17); the trip's
empty-state names the missing slot rather than saying "tap All"; and
`rackQuotaTotal2` is honest — a 59-piece rack under "about 58 pieces" is the
formality top-up, which is exempt from slot quotas by design, and the word
"about" is doing real work.

**WHAT THE AUDIT FOUND (reported, NOT built — her call):**
- ⚠️ **THE RACK SCREEN BURIES THE ONLY BAND THAT JUSTIFIES IT.** Order is
  hardcoded rotation → steady → dormant, so it opens with the 32 pieces she
  already reaches for and puts **"Haven't reached for these lately" at y=2,581 of
  a 3,230px page**. `RACK_COLD_SHARE` is documented as "LOAD-BEARING, not a
  nicety" and this file claims at line ~2281 that "the rack screen leads with 'N
  you haven't reached for lately'". **It does not, and never has.** The bands are
  a warm→cold gradient; reading it cold→warm keeps that logic and puts the payoff
  first.
- ⚠️ **TRIP MODE AND CAPSULE SCOPE CAN DISAGREE, AND BOTH BANNERS RENDER.**
  `enterTripMode` sets `tripModeId` AND `activeCapsuleId`; `planFromCapsule` sets
  only `activeCapsuleId`. So "Plan outfits from this" while on a trip leaves trip
  mode on Madrid and the closet scoped to a different capsule — **measured: the
  closet showed 14 Summer-capsule pieces while the suggester pooled from Madrid
  (`_sugg.capsuleId = "cNow"`), with a "✈️ Madrid · Day 3 of 7" banner and a
  "Planning · Summer capsule" banner stacked on one screen.** And the ✕ clears
  only the capsule, leaving trip mode on with `activeCapsuleId` null — a state
  `enterTripMode` can never produce, against this file's own rule that the
  banner's ✕ exits the mode, "one mental model".
- **The closet root spends 337px — 45% of the usable screen — before the first
  garment**, on two lens bars and four full-width navigation rows. "Hamper"
  appears twice 190px apart (a lens chip that filters, a shelf row that
  navigates), and 👕 means both "the rack" and "Worn" on adjacent rows — the
  2026-07-26 "one glyph, one meaning" rule, never applied to this pair.
- **An undated capsule offers four stacked full-width buttons**, three meaning
  "use this capsule to plan": Enter capsule mode · Planned outfits · Plan outfits
  from this · Suggest an outfit. Same shape as the r6 "seven ways to change one
  outfit" diagnosis, on the screen that round didn't look at.
- **"wash before you pack" renders on an undated capsule**, which is not a trip
  and is never packed. `js/06-home.js:803` gates the same phrase on the pack
  phase; `js/16-capsules.js:541` does not — one fact, two surfaces, one gated.
- **A finished trip opens on "Outfits"**, proposing new outfits for a trip that
  ended weeks ago, with "Trip recap" 9th of 11 rows in the ⋯ menu.
- ⚠️ **The switched-off pack still writes to the database, and the trace is
  confirmed:** `addItemsToCapsule` → `savePackRecord` → a GET **and** a POST to
  `/kv`. Correctly gated on a stored `rec.pieces`, so it only fires for trips
  packed before the 2026-08-10 r6 strip — which is exactly her older trips.

**2026-08-14 r3 and r4 shipped WITHOUT an entry here** (`6ad61d9` "Declining a
piece comes back" — ⃠ restored as its own chip after r2 removed the wrong half of
it; `fab356a` "A decade of wears finally counts towards formality" —
`wearsWithLevels()` derives `formality_for` on READ for the 3,995-wear Airtable
import, taking the pieces `buildMisfits` can see from 18 to 151). Their commit
messages carry the reasoning. **Check `git log` against this file's newest entry
before assuming it is current.**

**2026-08-14 r2 — THREE CORRECTIONS FROM HER, TWO OF THEM UNDOING r1. Selftest
412 → **414**, run GREEN; both new cases mutation-checked red, and one of them
was VACUOUS TWICE before it bit.** Her words: *"the new wear builder is too
squished — rack/clean only buttons right up against wear this today. don't like
the swap button removing the item as an option — swap should be swap not ban. i
do not like the named outfits."*

⚠️ **✨ IS A SWAP, NOT A SWAP-AND-HIDE.** r1 had a successful swap drop the
outgoing piece into `_sugg.banned`, reasoning that repeated taps mean "stop
showing me this". Wrong: one control quietly did two things, and a piece she
merely cycled past left the whole sheet — reshuffle included — until she closed
it. Nothing touches the pool now.
- **The thing the ban was covering for is fixed properly.** The pick is
  `Math.random()` over candidates, so ✨ could hand back what she just moved off.
  **`_suggSwapSeen`** remembers per SLOT what this session has offered and prefers
  what it hasn't, clearing once the slot is exhausted — taps walk the options and
  every piece stays reachable. Session-only, reset on open.
- ⚠️ **ITS GUARD CASE WAS VACUOUS TWICE AND ITS OWN MUTATION CHECK CAUGHT BOTH.**
  Against the 30-top gear fixture it scored luck (random over 30 rarely repeats
  back-to-back). Rewritten with TWO tops it became **structurally unfalsifiable**:
  `cands` already excludes the piece being replaced, so with two tops there is
  exactly one candidate and alternation is forced by the exclusion — it passed
  with the cycling deleted. It now uses FIVE tops and asserts all five are seen
  before any repeat, which fails as `top1 → top2 → top4 → top2 → top4` without it.
  **A fixture small enough to be deterministic can be small enough to make the
  assertion free.**

⚠️ **`outfitName` IS THE SERIAL AGAIN.** r1 fell back to `formulaLabel()` because
98% of her looks are unnamed. Her verdict: a shape is what a look is made OF, not
what it is, and the same three words land on dozens of outfits — the lists read
as less distinct, not more. Thumbnails carry identity; the number is a handle.
**Do not re-derive this.**

**SPACING, from "too squished" — and the number was literally zero.** `poolRow`'s
bottom and the "Wear this today" button's top measured a **0px gap**. Now 14px
above / 18px below plus a rule separating the search controls from the actions.
Each piece's 🔒/✨/✕ render as one cluster (**`.sg-piece`**) instead of three chips
at a 1px gap, where the conditional ✕ appeared to belong to whichever chip it
happened to wrap beside. Legend shortened. Home's count row **drops its icons**
(the tab bar directly below repeats them) and **fades at the right edge** via a
mask instead of slicing the last chip in half.

⚠️ **HOW TO ACTUALLY LOOK AT THE APP, since this round needed it repeatedly.**
Drive `http://localhost:4173/` DIRECTLY — inject the eval bridge, install a
fixture, clear `#login.active`, and set `#app` `.active` + `hidden=false` +
`style.display="block"` (the class alone is not enough). Screenshots then render
1:1 because index.html carries a viewport meta. **Do NOT screenshot through the
selftest harness**: that page has no viewport meta, so mobile emulation lays it
out at 980px and scales to ~38%, and its iframe is unreadable. ⚠️ The module tags
carry `?v=<APP_VERSION>`, so a page-level query does NOT bust them — rewrite the
`?v=` token to a timestamp between edits or the browser replays the last deploy.

**2026-08-14 r1 — A WORKFLOW AUDIT AGAINST HER LIVE CLOSET, AND FOUR SCREENS PUT
THE ANSWER BELOW THE QUESTION. Selftest 402 → **412**, run GREEN; all 10 new
cases AND the 1 reversed case mutation-checked red in the same session.** She
asked for an audit of "what could be improved for the flow through the app",
then for all of it to be built.

⚠️ **MEASURED ON THE REAL DATABASE, WHICH IS NEW.** She signed in on the live
site and the audit ran against 491 items / 4,387 wears / 1,122 looks / 9
capsules at a 375×812 viewport — `HANDOFF_2026-08-09.md` records that none of
the packing rework had ever been checked against her actual closet. `api()` was
swapped for a guard absorbing every non-GET; one write was attempted all session
(a rack `kv` persist on suggester open) and did not land.
⚠️ **TWO FINDINGS WERE NEARLY REPORTED AND WERE ARTIFACTS OF THE FRESH BROWSER** —
trip mode read "off" and backup read "never", both `localStorage`. Check what a
probe is reading BEFORE calling it a defect; they became the real finding below
instead.

**THE THROUGH-LINE: every screen had been designed, almost none had been
ORDERED.** Blocks sat in the sequence they were built. On four of five main
screens the thing she came for rendered below the thing she didn't. This is the
2026-07-26 "over-*presented*, not overbuilt" diagnosis arriving on the screens
that round didn't look at, and every fix is a reorder or a deletion.

⚠️ **HOME'S LAUNCHER GRID WAS A SECOND COPY OF THE TAB BAR.** `HOME_TILES` is
closet · looks · calendar · capsules · stats; the tab bar, permanently on screen,
is home · closet · looks · calendar · capsules · stats. **Every tile was a tab**,
costing **533px — 71% of the usable screen** — with the log row **39px BEHIND
the tab bar** and the Today card (what she actually wore) starting at y=797,
never visible. It had a justification once, and **this file still carried it**
("Capsules is a Home-tile screen (not in bottom nav)"); that stopped being true
and nothing re-read the grid.
- ⚠️ **TRIP MODE ALREADY HAD THE ANSWER.** Its dash leads with the day, the
  hamper, then the ask, and pushes the tiles below the fold — proof they were
  never needed at the top. Non-trip Home is now built the same way:
  `${dash}${todayCardHtml()}${ask}${cta}<div class="hnav">…`.
- **Compress, don't delete:** the counts were the one thing the tiles carried
  that the tab bar doesn't, so they survive as `.hnav` — one scrollable row,
  every destination still one tap. `HOME_TILES.short()` is that number alone.
  `.launch`/`.tile` stay defined (the Add/builder screens use them, and it makes
  the grid a one-line revert).
- ⚠️ **Home had NEVER had a render case.** `withHome` is the first.

⚠️ **"WHAT SHOULD I WEAR?" ANSWERED WITH A CONTROL PANEL.** The sheet opened on
**25 filter chips / 587px — 90% of the visible area**; `#sgPreview` began at
y=765 and **"Wear this today" sat at y=1,411, a ~1,300px scroll**. The answer was
**143px of content in a 1,492px sheet — 10%**. The chips are refinements, not
prerequisites: they fold under **Refine** now, below the outfit.
- ⚠️ **`poolRow` NEVER FOLDS.** The pool chip and the laundry chip are the app's
  standing promise that a narrowing is never invisible — the explicit condition
  she approved the rack on ("always names its pool with a count and a one-tap
  widen"). Folding them keeps the letter of the sheet and breaks the deal.
  Pinned by a case that runs with Refine CLOSED.
- **`_sugg.refineOpen` starts OPEN when the CALLER pre-set a narrowing** (a
  formula, a planned day's level) — otherwise the fold hides the reason the
  results look the way they do. Session-only, reset every open, same rule as
  `wholeCloset`.
- ⚠️ **`suggestionCanvasAspect()` — the fixed `aspect-ratio: 3/4` was too tall
  for ALL FOUR layouts**, not just the small one: pieces are square and sized as
  a fraction of WIDTH but centred on a fraction of HEIGHT, so the needed height
  is a function of the grid (≈0.51W for a one-row look, ≈0.89W for the 2×2, vs
  1.333W fixed). A dress-and-shoes look was **67% empty**. `layoutCanvasHtml`
  gained an optional `aspect` used ONLY here — grids and look pages keep 3/4.
  ⚠️ It returns WIDTH/HEIGHT, the reciprocal of the height factor; inverting it
  yields a plausible box that is wrong in the one direction nobody checks.

⚠️ **THE PIECE LEGEND DESCRIBED CONTROLS THAT WEREN'T THERE.** One hardcoded
string: *"🔒 keeps it · ⃠ swaps it out · ✕ takes it out"*. **⃠ was the BAN, not
the swap**; **✕ can never render on a two-piece outfit** (`suggCanRemove` needs
two pieces to survive removal — a dress and shoes is one of her commonest
shapes); and it **never mentioned the ✨ chips that actually swap**. Two of four
claims wrong on the default screen. Now built from the same conditions as the
chips, so it can't drift again.

⚠️ **SIX CONTROLS MEANT "GIVE ME A DIFFERENT OUTFIT"** — swap ×2, ban, prev,
next, reshuffle, plus 25 chips that regenerate. That is the **2026-08-10 r6
diagnosis ("seven ways to change one outfit on ONE card") still alive on the
HOME suggester**: r6 fixed that shape on the trip screen and left the original
instance untouched. **`banSuggestionPiece` literally called `swapSuggestionPiece`**
— nested, not parallel — so ⃠ is gone and **✨ now retires the piece it
replaces**. The pick is `Math.random()` over candidates, so before this a second
tap could hand back the very piece she had just rejected.
⚠️ Only on a SUCCESSFUL swap (the no-candidates path returns first), and never
the seed. **The chip AND its handler AND the function went in one commit** —
r7's rule, pinned by a structural case.

⚠️ **LOGGING FROM HOME LEFT HER ON THE CALENDAR — AND THE FIX WAS SIX LINES
ABOVE, ALREADY WRITTEN.** The log CTA called `switchTab("calendar")`, and
`openPostLogSheet`'s `close()` re-renders whatever is active, so a one-tap log
started on Home and ended on Calendar (verified live: `tab-home → tab-calendar`).
The suggester's own comment at `js/06-home.js` says exactly this about exactly
this — *"closing the sheet stranded her there instead of on Home"* — and only one
of the symmetric pair had been fixed. ⚠️ **`openWearAgainChooser`'s ＋Clothing /
＋Look handlers now own their navigation**: they render into `#calendarBody` and
had been relying on the caller having switched.

**STATS LEADS WITH WHAT MOVED (`buildRecentPulse` / `recentPulseHtml`).** She
opens it daily *to look*; it opened on Closet vs. Your Life, a structural chart
that shifts fractions of a percent per day, while "Looking back" sat **2,600px
down**. "Lately" is days logged · pieces worn · top piece · first outings ·
back-out-after-90-days. ⚠️ **One pass over `wears`** (first-seen, last-seen-before
and in-window rows together) — a filter per question is the items × wears trap.
⚠️ **Counts DAYS via `countByDay`.** ⚠️ **Deliberately NOT Range-scoped** — it
states its own window in the subtitle, the precedent Rotation set; a "lately"
block silently meaning "all time" is the opposite of the point.

**`outfitName` FALLS BACK TO THE SHAPE.** **1,102 of her 1,122 looks (98%) have
no name**, so every text-only list asked her to choose between "Look #1081" and
"Look #1115" — a serial from creation order that also shifts by one for every
look deleted before it. `formulaKeyFor`/`formulaLabel` already render "Short +
Sandals" on the Formulas lens. ⚠️ **Memoised as `o._label`**, cleared beside
`_num`/`_bucket` in `buildOutfitIndexes` — it runs over 1,100+ looks per list
render. ⚠️ Falls back to the NUMBER, not to blank (a key needs a dress or a
top-and-bottom); an explicit name still wins.

⚠️ **FACTS ABOUT HER LIFE WERE STORED AS DEVICE PREFERENCES.** `tripWearContext`
read `tripCapsule()`, which is null unless `tripModeId` — a **localStorage** flag
— is set, while the trip's DATES are in the database. So the same wear on the
same day was stamped Travel from her phone and left unstamped from anywhere else,
silently, into the history every context page reads. **`tripCapsuleForDate`**
asks the dates, exactly as `tripPhase` already does for the offer banner; the
mode stays hers to toggle and simply isn't the source of truth. ⚠️ **Its guard
case REVERSED with the decision** (it asserted "dates AND mode") and gained a
fourth assertion so it can't pass by always saying Travel. Same fix for the
backup reminder: **`lastBackupDate`/`setLastBackupDate`** are kv-backed, so "no
backup yet" stops being a claim about the browser.

**NOT COVERED, and worth a later pass:** closet browsing, the add-item flow, the
builder, calendar month view, capsule management beyond the trip screen.
Handler reachability was swept statically over all 293 `data-*` attributes (one
orphan, `data-grp` in trip-mode); **delegation-SCOPE mismatches like the dead ⋯
menu need a per-sheet runtime check that was not run.**

**2026-08-13 r2 — A FULL-APP AUDIT, AND THE ENGINE COULD NOT SEE PART OF THE
CLOSET. Selftest 396 → **402**, run GREEN; all 6 new cases mutation-checked red
in the same session, and 1 existing case REVERSED with the decision it guarded.**
She asked for an audit and then for everything fixable to be fixed.

⚠️ **A PHOTOLESS PIECE WAS INVISIBLE TO EVERY OUTFIT ENGINE — the headline find,
and it had become load-bearing three days earlier without anyone touching it.**
`suggestOutfits` opened with `base.filter(i => i.image_path && !isNoSuggest(i))`,
and the same clause sat in swap, add-layer, `buildRack` (×2) and `packCandidates`
(×2). The rest of the app decided the opposite in **2026-07-11 r1** — grids,
collages, `layoutCanvasHtml` and `builderPool` all render photoless pieces
through `PHOTO_PLACEHOLDER`, and builderPool's comment says so outright. The
suggester never got that pass.
- ⚠️ **r6 is what made it matter.** Switching the pack off made `suggestOutfits`
  the WHOLE engine of the trip screen, so a filter that used to cost a slightly
  thinner sheet started deciding what she packs.
- **Measured on a 10-piece list holding ONE photoless shoe: 12 outfits. Give that
  shoe a photo: 26 — and the only dress went 0 → 2 appearances**, because that
  shoe was the one sharing a formality level with it. The screen meanwhile said
  *"12 outfits from your 10 pieces"*; the 10 was a claim about a list the engine
  had already cut to 9.
- ⚠️ **It broke a rule the app holds everywhere else.** The rack is ALLOWED to
  narrow the default pool only because it is **labelled, counted and one tap from
  widening**. This narrowed with no label, no count and no way out — and it
  contradicted **2026-08-10 r3**'s *"use the whole list unless I mark something as
  'do not plan'"* three days after that shipped.
- ⚠️ **The rack clause had to come out IN STEP.** Its own comment says the rack
  "mirrors the suggester's pool"; leaving it would have been worse than useless,
  since the home suggester draws FROM the rack — a photoless piece would still
  never be offered anywhere except the trip screen, and the fix would look
  half-applied. **`RACK_ALGO` 8 → 9**, because selection changed and a stored rack
  cannot otherwise see that the code did (the 2026-08-04 r2 lesson).
- **`suggestLayerCandidates`' `why = "no photo yet"` blocked-reason is gone** — it
  can no longer happen. The fixture keeps its photoless cardigan on purpose so
  that case kills the filter if anyone puts it back.
- ⚠️ A **structural** case now fails if `image_path` reappears in any pool filter
  in `12-looks` / `20-rack` / `21-pack`. Seven sites across three modules, one of
  which explicitly mirrors another, is precisely the "when you add a reader, audit
  them all" trap — a behavioural case on one of them would not have held.

⚠️ **HOME'S WEATHER OFFER RAN 41.6px OFF THE RIGHT EDGE OF THE PHONE.**
`.btn-sec` sets `width:100%`, and `style="flex:none"` (= `flex: 0 0 auto`) takes
its **basis from that width** — so "Not now" claimed the entire 332px row and
overhung the screen, while "Look it up" was crushed to **62.6px** and both labels
wrapped to **four lines** (72.4px tall). With `width:auto`: **227px / 97px, one
line each, 51.2px**. Same family as the `.log-cta` trap **from the opposite
direction** — there a full-width button needed an explicit width; here a
`width:100%` button in a flex row needs an explicit auto.
⚠️ It is the real entry point for the ERA5 backfill (gated on `wears.length >
100`), so it has been rendering for her since Round C.
⚠️ **The first version of its guard case was VACUOUS and its own mutation check
caught it** — written with hand-typed markup it asserted that the string *in the
test* had `width:auto`, and passed happily with the app still broken. It now
lifts both buttons out of `js/06-home.js` source and measures those.

⚠️ **THE TRIP'S EMPTY STATE TOLD HER TO "TRY ALL" WHILE ALL WAS SELECTED.** The
level chips are gated on `poolCoversLevel` under a comment explaining that this
is so *"a chip can never come back empty"* — but **the "All" chip is not gated**,
so it is the only one that can, and it landed on that copy. Reachable on **day one
of essentially every trip**: add a few tops before anything else and the screen
renders a one-option filter above advice to use that option. It now names the
gap — the engine needs shoes plus either a dress or a top-and-bottom, from
`suggestOutfits`' two combo loops — and only says "tap All" when a LEVEL is
selected, which is the one case where that is real advice.
⚠️ **This is the first test coverage `tripOutfitsHtml` has ever had.** r6 shipped
the trip rework with "no new cases — this round REMOVES surface", which left the
app's entire packing feature untested.

⚠️ **`#fieldSheet` WAS 5th OF 9 SHEETS, UNDER A COMMENT SAYING IT WAS LAST.** The
r19 rule is that every sheet hosting a field edit is declared BEFORE it; four
(log, stats filter, filter, stats range) were declared after. **Proved by
hit-testing with two open: `#logSheet` painted over `#fieldSheet`.** Nothing was
visibly broken only because the one live path across that boundary — the rack's
"wrong formality"/"wrong season" answers — calls `hideSheet("logSheet")` first.
Moved to genuinely last, and a case now asserts its index.

**Verified correct under probing, so a later round needn't re-audit:** no
undefined global function references in 27.8k lines / 930 top-level functions; no
horizontal scroll on any of 11 rendered screens (`body.scrollWidth` 390
everywhere — the r5 sideways-scroll bug has not regressed); all 13 stats views
render without throwing and with no oversized thumbs; Closet vs Life still agrees
with itself across both surfaces; Contexts counts DAYS not rows.

⚠️ **SUPERSEDED 2026-08-16 r3 — THE PACK WAS REMOVED. The paragraph below is
kept because its reasoning is the record of why it survived this long.**

⚠️ **THE PACK IS CONFIRMED UNREACHABLE, AND r6 AND r7 STATE OPPOSITE RULES ABOUT
IT — left alone deliberately, because it is her call.** 6,238 lines / 173
functions dormant, ~40 handlers still live in wiring, but the entry markup
(`data-trip-build`/`-mode`/`-ctx`/`-definites`/`-laundry`) exists only inside
`tripPlanSectionHtml`, which has **zero callers**, and `TRIP_SECTIONS` falls back
on unknown values so the surviving `data-trip-tosetup` handler is inert. r6 kept
it whole for one-commit reversibility; r7 wrote *"leaving a live handler for
removed markup is how a switched-off feature comes back"* and applied it to
`data-cap-pack` alone. **Both are now in this file as guidance.** One live
residue: `addItemsToCapsule` still writes `savePackRecord(… needsResolve:true)`
whenever `rec.pieces` exists, so every add-to-trip does a DB write for a
switched-off feature.

⚠️ **TWO PROCESS FAILURES IN THIS SESSION, BOTH OF THE DOCUMENTED KIND.**
① **The first layout sweep reported "0 overflow" on all 11 screens and was
worthless** — `#app` is `display:none` behind the login screen, so every
`getBoundingClientRect()` returned 0. That is the display:none trap the selftest
header already documents, arriving through a different door. **Any layout probe
must assert a known element has non-zero width before a single number is
trusted.** ② **A `jsc` parse check reported "no syntax errors in any module" while
`jsc` was not on PATH** — the binary lives at
`/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc`,
and the loop only surfaced failures matching a string, so 23 empty outputs read as
success. It hid a real syntax error (backticks inside a template literal in
`js/06-home.js`) that took the whole module out — 82 cases red — and **the selftest
freshness case is what actually caught it.** Check the tool runs before believing
the tool.

**2026-08-10 r1 — ONE SUPPLY OF OUTFITS, DEALT ACROSS THE TRIP. Selftest 374 →
**378**, run green; all 4 new cases mutation-checked red in the same session
(five mutations, one per guarded behaviour).** Her report: *"when it gives
alternative outfits, each context occasion gets the same set — so I can't choose
freely. They should all be different… or once I've chosen, the others change. I
want that either way — once I've selected an option, the pack is reoptimized
around all locked outfits/items automatically."*

⚠️ **THE OPTIONS WERE COMPUTED PER CARD, WHICH MAKES IDENTICAL SETS INEVITABLE.**
Every occasion at one level enumerates the same bag against the same score, so
the top three by shape are the same three on every card. **Measured on a 6-day
fixture: four Errands days offered the IDENTICAL trio and both Work days
another, out of 8 and 10 in-bag looks.** Worse, two of the three were what OTHER
days were already wearing — so "choosing" could only produce the repeat the
solver had already priced against.
- **`packOccCandidatesRanked`** is the old per-occasion body, extracted;
  **`packReviewOptionsAll`** deals the supply out and `packReviewOptions` reads
  the deal. ⚠️ **Per-occasion lists are NOT interchangeable** — `packOccasionSlotFit`
  and her per-occasion rules bite — so this deals from each occasion's own list
  rather than one list per level.
- **Round by round**, or the first card takes every fresh look for itself (the
  first version did exactly that: one card got all 3 free looks and the other
  three fell back to an identical rescue trio).
- ⚠️ **THE PREFERENCE ORDER WAS MEASURED, AND BOTH SIMPLE RULES FAILED.**
  Weight-first put the four Errands days back on an identical trio (a bag with
  two bottoms and four tops holds 8 looks and five days had claimed most of
  them). Freshness-first produced a card whose three alternatives each cost +2
  pieces — the app growing the suitcase to win an argument about variety. Final
  order: a look nobody else was offered and the bag already holds · then ONE
  from the closet, priced (`PACK_REVIEW_BEYOND_MAX`) · then a look another card
  is also showing · then, only if the card would otherwise be EMPTY, another
  day's outfit.
- ⚠️ **Being OFFERED the same look as another day is harmless** — it only
  becomes a repeat if she picks it twice. Being offered another day's CURRENT
  outfit is not, which is why that one is last.
- ⚠️ **The beyond list is materialised LAZILY**, per card that the bag couldn't
  fill — enumerating the trip rack for every occasion on every render is the
  measured hang `packCandidates` caches against. Whole-trip deal: **5–7ms**.
- ⚠️ **Never a costed variant of a look the bag can already make.** `packLookKey`
  drops shoes, so "the same outfit in a shoe you'd have to pack" enumerates as a
  beyond-bag candidate — it rendered as a "+1" option two cards from the
  identical look offered free. Charging her a piece for a different shoe is the
  distinction r13 removed from the solver.
- **`packAmbiguity` deliberately reads the RAW ranked list, not the deal** — the
  deal depends on the assignment, a choice changes the assignment, and the
  review queue would reshuffle under her.
- Result across roomy / scarce / 10-day fixtures: **0 identical option sets, 3
  options per card, at most 1 costed option per card.**

⚠️ **AND A CHOICE NOW RE-SOLVES THE TRIP AROUND HER LOCKS.** `packChooseOutfit`
already locked the occasion and `packEnsureSolve` already knew how to solve
around locks — **nothing asked it to**, so a choice stayed local and the other
days kept outfits chosen against a bag she had just changed. It now re-solves
via the same `packLoadState({resolve:true})` path "✨ Re-solve" uses, so there is
no second solving mode. **Measured: 22ms; earlier choices survive because each
one locked its own occasion.**
- ⚠️ **ONLY WHEN THE OUTFIT ACTUALLY CHANGED.** "This one" is her saying the day
  is settled; reshuffling days she never looked at in reply is the slot machine
  inversion ③ exists to prevent.
- ⚠️ **Undo restores the whole RECORD**, not just this occasion — once a choice
  moves other days, putting one outfit back leaves a trip that was never on
  screen. It reloads with `packLoadState` (**not `packStateReady`**, which would
  hand back the stale in-memory state) and re-runs `packPersist` to re-sync
  `capsule_items`.
- The full options screen still shows everything, but an option another day is
  wearing **says so** ("Thu, Aug 13 is wearing this") — a fact, never a block.

⚠️ **THE ASYNC-FIXTURE TRAP, AGAIN, AND IT COST A MEASUREMENT.** `withPackCloset`
restores in a `finally`, so an `async` body's fixture is gone by the first
`await` — every candidate list came back empty and it looked like a bug in the
code under test. `packClosetInstall` + **`withPackClosetA`** now share one setup.
⚠️ **Stubbing `rest` to return `[]` WIPES THE PACK:** `kvUpdate` reads `[]` as
"the row is gone" and re-applies the patch onto an empty record. The kv
freshness read must THROW (offline) instead.
⚠️ **A case that measured the choice itself passed with the fix deleted** — it
counted broken days including the one she chose for, and setting that outfit
counted as a repair. It asserts on OTHER days now. ⚠️ And "another day moved" is
not assertable: holding one more lock can legitimately leave the same optimum
(0 days moved on one fixture, 5 on another). **The case breaks a day by dropping
a piece and asserts only a re-solve can fill it back in.**

**2026-08-10 r2 — THE REVIEW CAN SEE THE LAUNDRY, AND UNLOCK RE-OPENS THE
QUESTION. Selftest 378 → **382**, run green; all 4 new cases mutation-checked
red in the same session.** Her report: *"if I unlock an outfit, I want it to show
me the alternatives again. And it should stop offering or flag for me if I've
chosen something too many times for laundry. Maybe the bag should have a laundry
setting? I will/won't do laundry on this trip. Right now I've selected the same
t shirt 4 times and that's a problem."*

⚠️ **UNLOCK CLEARED HALF OF WHAT A CHOICE WRITES.** `packChooseOutfit` writes
BOTH `chosen` (decided → the review row hides) and `locked` (held through every
re-solve); `packToggleLock` only ever cleared the second. So unlocking gave her
an editable card with nothing to compare against and no way back to the
comparison short of choosing something else. ⚠️ **Locking does NOT mark it
chosen** — `packSkipReview` already marks decided without locking, so making
lock imply chosen would collapse two things she does for different reasons.

⚠️ **THE REVIEW WAS STRUCTURALLY BLIND TO LAUNDRY, and it is the one narrowing
`packCandidates` deliberately doesn't do.** `cleanOnly=FALSE` is correct there —
laundry is a SCHEDULE constraint, not a pool filter (inversion ②) — so every
option was legal in isolation and nothing costed the fourth wear of one tee. The
solver knew; **the review, which is where r1 moved the actual choosing, didn't.**
- **`packLaundryProbe(st)`** re-walks the WHOLE TRIP through `packSchedule` with
  one occasion's outfit swapped in. It does not count wears inside the outfit —
  placement is what decides this, and the same four wears are fine either side
  of a wash day.
- ⚠️ **TWO ANSWERS, NOT ONE.** `over` = "would a piece in THIS outfit be past its
  wears" and drives the LABEL; `cost` = the delta against what's already planned
  and drives the RANKING. Getting this wrong is silent: an option that merely
  MOVES a violation from one tee to another has cost 0 and rendered as clean.
- **Ranked down, never removed** — `[over, cost]` leads the deal's key, ahead of
  weight and freshness. On a trip whose whole bag is over the line every option
  is flagged, which is the honest answer; removing them empties the card.
- ⚠️ **`packLaundryNote` NAMES THE DAY when the violation isn't on this card's
  own date.** The schedule is trip-wide, so putting a tee on Monday can be what
  pushes its FRIDAY wear over — and "2nd wear of the white tee" on day one reads
  as an outright error. **Found by rendering the cards**: every option on the
  first day carried a 2nd-wear flag.
- **A day whose own outfit is over gets `.pack-occ-laun`** on the card. The fact
  was already derived and already shown — on the ITEMS screen, three taps from
  where she was choosing. ⚠️ It states the count and stops; **no wash order**
  (2026-08-03 r6).

⚠️ **"WILL I DO LAUNDRY ON THIS TRIP" IS A CONTROL NOW.** It was a sentence on
the Plan tab pointing at the by-day planner — which is folded away behind "Day
by day", so the single input that decides how many tees the trip needs lived
three taps from the screen that decides how many tees the trip needs.
**`openTripLaundrySheet`** writes the **same `PLAN_LAUNDRY` sentinel** the by-day
planner writes, so `packSchedule`, `packSolve` and `packMidTripWash` all see it —
two controls, one fact, zero new state. ⚠️ **"No laundry" is not stored as an
answer**: it is the absence of wash days, which is what the schedule already
assumes, and a stored "no" would be a second way to say the same thing that
could disagree. ⚠️ It re-solves afterwards holding her locks — it changes the
constraint the outfits were solved under. **Measured on a scarce 8-day fixture:
one mid-trip wash day took violations 3 → 0 and flagged options 25 → 4.**

**2026-08-10 r3 — THE WHOLE LIST IS THE PLAN, AND THE ⋯ MENU WAS DEAD.
Selftest 382 → **386**, run green; all 4 new cases mutation-checked red in the
same session.** Her reports: *"tapping 'by day plan' from the three dot menu
doesn't do anything"*; *"the by day plan should not auto assign days — I should
be able to do it myself"*; *"make sure adding items individually works as
expected, including incorporating into suggested outfits — I want the packing
algorithm to try to use the whole list unless I mark something as 'do not plan'.
We can still have extras but I don't want to artificially limit myself."*

⚠️ **EVERY ROW IN THE ⋯ MENU WAS DEAD, NOT JUST THAT ONE.** `openTripMoreSheet`
renders into `#moveInner`; the delegated capsule handler is on **`#capsulesBody`**,
which does not contain it. So the `data-cap-*` attributes those rows carried
reached nothing — Add items, By-day plan, Rename, Dates, Duplicate, Share,
Archive, Delete. **The only row that worked was Locations, the one given an
explicit `onclick`** — i.e. the one that didn't rely on the theory the comment
was asserting. **`CAPSULE_ACTIONS` (js/16-capsules.js) is that comment made
true**: the sheet and the delegated handler both call it, and `capsuleArchiveToggle`
was extracted so the archive/undo logic isn't duplicated. ⚠️ **A case asserts on
the RENDERED sheet** — every row has a handler AND names a real action; a test of
the map alone would have passed throughout the bug.

⚠️ **THE BY-DAY PLAN COULDN'T CHANGE A DAY — the one screen that is about days.**
`packOccDates` pins and `openPackMoveDaySheet` shipped in 2026-08-09 r3, but only
on the Outfits section, so the spread read as a decision. Now: **📅 Move day on
every by-day card**, the sub-line says **"your day" / "app's pick"**, and
**`packDaySpreadRowHtml` + `packKeepDays`** name how many the app placed and pin
them all in one tap. ⚠️ **Only a `selected` occasion may move** — its id is
date-free (D6) so it keeps its outfit; a declared occasion IS its date and a
floor occasion is keyed by it, so a move control there would orphan them (pinned
by the case). ⚠️ **"Keep these days" pins where things ALREADY ARE** and must
never move anything — a control that promises to stop the app rearranging her
trip cannot rearrange it on the way out.

⚠️ **THE DEFAULT FLIPPED: EVERYTHING IN THE TRIP'S LIST IS SOMETHING TO PLAN
WITH.** Two failures compounded, and together they made hand-adding pointless:
- **A hand-added piece was never marked hers.** `addItemsToCapsule` put it in
  `rec.pieces` and stopped, so it was "optional" — the mode's spare trim could
  drop it and **`packSyncMembers` would then DELETE it from `capsule_items`**.
  It now joins `rec.pinned`, which makes it core: never trimmed, never dropped.
  ⚠️ **Gated on `syncPack`** — false means `packSyncMembers` is projecting the
  bag back, and pinning there would turn every solver-chosen piece into a
  definite she never picked.
- **`res = null` never produced a new solve.** The stored assignment still
  described the trip perfectly, so `packEnsureSolve`'s rehydrate guard passed and
  the piece sat in the suitcase with no outfit knowing about it. **`rec.needsResolve`**
  forces one, ⚠️ **consumed in `packEnsureSolve` ABOVE the early return** — not in
  `packLoadState`, because `packStateReady` hands back a warm state untouched and
  the flag would survive to fire on some unrelated later open.
- **Measured (Light mode, 6-day trip): five pieces added by hand, all five in
  outfits, none trimmed, 11 of 11 bag pieces used.**

⚠️ **`packNoPlan` IS THE OPT-OUT, AND IT IS NOT `banned`.** `banned` means "keep
it out of the bag"; this means "it's coming, stop building outfits around it".
⚠️ **It implies pinned** — a piece nothing plans around is in no outfit, which
makes it spare, which the mode trims, so without the pin "don't plan around
this" would be a slow way of deleting it. ⚠️ **`packCandidates` DEFAULTS the
exclusion in from the open pack** rather than being threaded through fifteen call
sites (coverage, option counts, the review lists, every re-pick path); a rule
half of them honoured is the "when you add a reader, audit them all" trap in its
fifth costume. `packSolve` still passes it explicitly so the solve never depends
on the fallback, and the dash paths (`packPlanByDate`, `packMidTripWash`) read
the stored assignment and never enumerate. Marking or unmarking **re-solves**
holding her locks — otherwise the outfits that used it just stand there.
⚠️ **The control lives on the SELECTION BAR, not the piece row**: that row is
already a tick, a thumb, two lines and two buttons in a 390px column, and this is
an occasional decision. Measured: the bar wraps to two lines, nothing overflows.

**2026-08-10 r6 — THE PACK IS SWITCHED OFF. THE TRIP SCREEN IS TWO SECTIONS.
Selftest 395/395, run GREEN (no new cases — this round REMOVES surface).**
Her words, after we reviewed the feature together: *"let's remove almost
everything — I give you the list of items I'm packing, and you can propose
outfits, which I can pull from to plan or create my own outfits from the list.
You don't invent or add items at all."*

⚠️ **THE REVIEW THAT PRODUCED THIS, because the diagnosis is the reusable part.**
She reported all three of "the outfits are wrong", "I can't get my input in" and
"it's confusing" at once, which is the signature of a structural problem rather
than three bugs. Measured: **6,099 lines, ~45 controls, 10 sheets, 3 sections, 2
full screens** — and **seven ways to change one outfit on ONE card** (tap a piece,
pick an alternative, "I'd rather…", See other outfits, ✎ Change it, 🔒 Lock,
✕ Not this trip). The 2026-08-09 r2 round had consolidated *three* unclear doors
into one; the inline review then shipped **beside** it rather than through it, so
the card ended with more doors than when she complained about the doors.
- **The shape was the bug: 4 coarse inputs → 1 big solve → 8–13 fine corrections.**
  Three of the four upstream inputs (days, quantity, laundry) aren't about
  clothes, so everything that makes an outfit an outfit was decided by the solver
  and she could only correct it afterwards — from inside the bag it had already
  chosen, while each choice re-solved the trip and moved the other cards.
- **`openPackRatherSheet` was the entire vocabulary for "this is wrong":** not a
  dress · a dress · dress down · dress up. **"None of these" was agreed and never
  built**, so the honest answer to a bad option had no button.
- **The general lesson: adding a control per report makes a feature worse if
  nothing is ever removed.** Every individual round here was correct and
  well-tested; the sum was unusable. Compress-don't-delete (2026-07-26) applied
  to the one feature built after it was written.

⚠️ **SUPERSEDED 2026-08-16 r3: the solver has since been REMOVED, which is the
"own unhurried pass" this entry asked for. Read the r3 entry at the top.**

⚠️ **NOTHING WAS DELETED — the pack solver is INTACT AND UNREACHABLE.** Every
`pack*` function still exists and still passes its cases; only the UI stopped
calling them. Deliberate: reversible in one commit, and small enough to ship
before she left. **Do not "clean up" the dead pack code as an unrelated tidy-up** —
if the stripped version is the keeper, that removal is its own unhurried pass.
`tripPlanSectionHtml`, `packSlotsHtml`, `packBucketsHtml`, `packReviewBarHtml`
and the `data-trip-ctx`/`-definites`/`-laundry`/`-mode`/`-build` handlers are all
still present and simply never rendered.

**What the trip screen is now:** `TRIP_SECTIONS = ["list","outfits"]`.
- **Your list** (`tripListSectionHtml`) — the capsule's members, ＋ Add items,
  packed ticks, hamper count. **Reuses `capGroupsHtml`**, so it cannot drift from
  the capsule detail page.
- **Outfits** (`tripOutfitsHtml`) — proposals built from the list and nothing
  else, level chips, ＋ Save as a look, ✎ Change it, ✎ Build one yourself.
- ⚠️ **"NEVER INVENTS OR ADDS" IS STRUCTURAL, NOT A RULE TO REMEMBER.**
  `suggestOutfits` only ever draws from the pool it is handed, so passing
  `capsuleItems(cid)` IS the guarantee. There is no rack, no widen, no
  "beyond the bag" — the whole class of bug where the app quietly grew the
  suitcase cannot occur. **Verified on a fixture with 3 decoy pieces outside the
  list: 12 pieces → 43 outfits, ZERO leaked.**
- ⚠️ **EXHAUSTIVE, NOT SAMPLED (`opts.all`), and that's the point.** The sampled
  path exists to make a sheet feel fresh per open; this is a list she browses,
  leaves and returns to, so it is score-ordered and **stable** — the same outfits
  in the same order every time. `TRIP_SUGG_PAGE`(12) / `TRIP_SUGG_MAX`(120).
- ⚠️ **`cleanOnly = FALSE`.** Laundry is not a filter on a packing list — she
  washes before she leaves. The hamper count is *stated* on the list instead.
- ⚠️ **Level chips are gated on `poolCoversLevel`, NOT on "some piece's set
  contains the level".** Those are different questions and the gap is the
  2026-08-04 r2 empty-sheet bug: heels + a silk cami put 6 in the covered set
  while the list held no level-6 bottom, so a "6. Dressed Up" chip rendered and
  returned **0 outfits**. **Found by rendering the screen and counting every
  chip's result** — the code read fine.
- ⚠️ **`TRIP_SUGG_PAGE` is declared beside `TRIP_SECTIONS`, above its first use.**
  `_tripSuggShow` is initialised from it in a TOP-LEVEL statement, and a `const`
  further down the file is still in its temporal dead zone when that runs — a
  boot-time ReferenceError. Function bodies may reference anything; top-level
  initialisers may not.
- ⚠️ **`✎ Change it` seeds the builder, it does not save.** `openBuilder(null,
  null, null, seedIds)` — the look is created at SAVE (2026-08-09 r3). Creating
  one per tap is the Looks-list flooding that got bulk creation removed.
  ⚠️ Scope is set as `builder.scopeCapsuleId` **after** opening, never via
  `planCtx` — a planCtx routes the save into `capsules.plan`.
- Section switches and level changes **reset `_tripSuggShow`**, or "Show more"
  survives a trip to the list and she returns to 60 cards.
- The ⋯ menu is untouched and still carries dates, locations, add items, share,
  recap, archive, delete.

**2026-08-10 r7 — THE LAST DOORS INTO THE SOLVER. Selftest 395/395, run GREEN;
one existing case REVERSED with the decision it guarded (mutation-checked red).**
Her report: *"it still builds it if I hit build the pack / rebuild the plan
button — can you remove any buttons that no longer are relevant."*

⚠️ **r6 STRIPPED THE TRIP SCREEN AND LEFT FIVE OTHER SURFACES STILL DRIVING THE
SOLVE.** The trip screen was the one I was looking at; the pack was reachable
from four other places and rendered its output in two more. **When you switch a
feature off, grep for its ENTRY POINTS, not for its screen.** What was left:
- **`renderCapsuleDetail`'s "✨ Build the pack" / "✨ Rebuild · N things changed"**
  (`data-cap-pack`) — the button she found. That page is still reachable from the
  ⋯ menu's "📍 Locations & weather" row, so the old detail screen and every
  button on it survived the r6 strip untouched.
- **`renderCapsulePlan`** rendered `packPlanCardsHtml` + `packDaySpreadRowHtml`,
  so the by-day plan filled itself in from the stored solve.
- **`tripDashHtml`** rendered the pack's outfit for today (`from your pack`,
  `data-td-packwore`) and the mid-trip wash row (`packMidTripWash`).
- **`openTripRecap`** rendered `packGradeRowHtml` — a grade for a plan that no
  longer exists.
⚠️ **All of these read the STORED record, so they kept working perfectly on a
pack built before the strip** — which is exactly her situation and why she still
saw a plan she hadn't agreed to. A case now pins the dash against a fixture that
deliberately keeps a `pack:<cid>` record.
⚠️ **The `data-cap-pack` HANDLER was deleted too, not just the button.** Leaving
a live handler for removed markup is how a switched-off feature comes back: the
next round re-adds the button, finds it already wired, and the solver is running.
- **Still no reachable path to `packEnsureSolve`:** `capsuleView = "pack"` can
  now only be set by the definites-picker branch and the builder's
  `planCtx.packOcc` branch, and nothing renders an entry to either.
  `tripPlanSectionHtml` has zero callers. Verified by rendering all four screens
  plus the dash with a stored pack record and scanning for every pack string.
- **What deliberately SURVIVES:** the by-day planner's own manual planning
  (assign a look, ✨ Suggest, ✎ Build, wash-day toggle, "Wore it"), `tripUnwornNow`,
  `tripMissingPieces`, the suitcase hamper row, and the recap's worn/once/dead
  sections — none of those are solver-derived.

⚠️ **A GUARD CASE REVERSED, AND THAT IS NOT A REGRESSION.** "the generic hamper
row folds when the wash plan already names everything dirty" asserted
`washplan===1 && generic===0`; with the wash plan gone there is nothing to fold
against. Rewritten to the surviving contract — the hamper row must still SPEAK
(`generic===1`) — because asserting only "no wash-plan row" would pass trivially
if the row were silenced altogether, which is the test-that-can't-fail trap from
the other direction. **Mutation-checked: breaking the hamper row turns it red.**

**▶ PICKING THIS UP COLD? Read `HANDOFF_2026-08-09.md` in the repo root.** It
carries the current state, her locked decisions from this arc, what is
deliberately NOT built, and — most importantly — **what has not been verified**:
none of the packing rework has been tested against her real closet, because the
app can't authenticate from localhost. Every number below came from synthetic
fixtures.

**2026-08-09 r1–r5 — THE PACKING REWORK, ROUNDS 2–6. Selftest 365 → **374**,
all green; every new case mutation-checked red in the same session.** Five
rounds off her live use, each one finding something structural the previous
round's fix had exposed.

⚠️ **r1 — THE REVIEW WAS RESHUFFLING A BAG SHE HAD NO SAY IN.** Her words:
*"it treats the pack as built… all from within one settled bag. If I don't like
those options the way to change is not clear. I want input before the bag is
finalized."* **Measured: 21 alternatives offered across 8 occasions against
3,171 that existed in her closet at those levels — 0.7%.** `packReviewOptions`
hard-filtered to the bag, and the bag came from `packFill` with no input from
her. `packReviewBeyond` draws from the trip rack, cheapest-first, each option
priced ("+1 to your bag"); choosing one flows through `packRepack`'s UNION, so
the pieces join the bag. **That union was the r1 audit fix; this is the second
thing it bought.** Also: definites became a pre-build INPUT, and "I'd rather…"
RE-SOLVES the day rather than re-picking inside the old bag.

⚠️ **r2 — ONE PICKER, ONE DOOR, AND A COUNT THAT MATCHED ITS LIST.** Her
reports: the definites screen was "bizarre" (the pack had grown a second item
picker with none of the funnel/laundry-lens/status/category machinery the real
one has); "See all the options" and "See other outfits" were one door with two
names; and ✨ Another / Suggester / Other options *"are not clear what they
do"* — three doors onto "show me a different outfit", none named that.
**Two defects found by RENDERING the new options page:** it said "52 from your
bag" while showing 40, and TWO tiles rendered as "What you have now" because the
enumeration held outfits differing only by shoes. Deduped on `packLookKey`.

⚠️ **r3 — "CHANGE IT MYSELF" OPENED A BLANK CANVAS.** `saveComboAsOutfit` takes
an ARRAY and was handed an object; it threw, the catch swallowed it, `openBuilder`
got a null id. **Creating a look just to open the builder was the wrong shape
anyway** — every tap would leave a record, which is the Looks-list flooding that
got bulk creation removed. `openBuilder` takes `seedIds`; the look is created at
SAVE. Also **scheduling**: her ask *"need to be able to schedule the contexts,
not just have things auto-assigned to days"*.
⚠️ **The first scheduling version silently ignored her.** `_nth` is assigned as
occasions are PLACED, so the loop looked for a pin on `#0`, found none and
stopped — a pin on `#2` was never reached — and placing pinned ones first would
have renumbered them and changed the id the pin is keyed on. **Ids are minted up
front now.** Only `selected` occasions are schedulable: their ids are date-free
(D6), so moving one keeps its outfit; a declared or floor occasion is keyed BY
its date. Measured: the target lands on the chosen day and all four untouched
days keep their outfits.

⚠️ **r4 — PACKING FROM OUTFITS SHE HAS ACTUALLY WORN.** Her ask: *"you KNOW
those are outfits I would create. The packer is still creating outfits I
wouldn't really wear."* **Measured first: 298 worn outfits fitted each occasion's
level and exactly 2 survived inside the bag `packFill` built from slot RATES.**
Picking pieces first is what destroys the combinations — inversion ① from the
other end.
- **Three tiers in `packCandidates`:** worn → shape she rebuilds (`formulaKeyFor`,
  her suggestion) → generated. **Tier 3 never disappears.** Proof is still gated
  on availability, level, weather, exclusions and her stated rules.
- ⚠️ **`packProvenSeed` is what makes the tiers real.** Filtering proven
  candidates to a bag chosen on other grounds is why only 2 of 298 survived, so
  proven outfits are chosen FIRST and their union seeds the bag. **Distinctness
  is required there or it degenerates instantly — measured, 8 occasions collapsed
  to 1 outfit and 2 pieces.**
- ⚠️ **A TIER, NOT A THUMB ON THE SCALE (her decision).** Sitting proven
  candidates in the list did nothing — the solver costs by pieces added and
  repetition and never read them. `PACK_WORN_BONUS`(600) is deliberately below
  `added * 1000`, `PACK_REPEAT_DAY`(1500) and the violation term (5000), so it
  can never grow the bag, buy a repeat, or dress her in something dirty. **A case
  asserts that against the constants directly** — an outcome can't tell
  "preferred" from "forced".
- **Result: every assigned outfit on a 7/10/14-day trip is one she has worn or in
  a shape she wears. Zero invented.**
- ⚠️ **The ordering case was VACUOUS on first write and survived its own
  mutation** — with generated candidates first, the `packLookKey` dedup ERASES
  the proven ones, so "no generated candidates" satisfied the assertion
  trivially. It needs both tiers present to mean anything.

⚠️ **r4 also — ONE LIST OF WHAT'S COMING.** `capsule_items` and `rec.pieces`
were two, and `packSyncMembers` computes `drop = members − bag − packed` — so
**a piece added from the trip's Add-items screen was DELETED at the next pack
edit.** Ten callers reach `addItemsToCapsule`, so the sync lives there rather
than in ten patches (`syncPack:false` marks the projection, or it recurses).

**r5 — ONE TRIP SCREEN.** Plan · Bag · Outfits, section chosen by `tripPhase`.
⚠️ **It ABSORBS, it doesn't delete** — she asked "do we lose anything?" and the
answer is only if the detail page's administration is dropped, so rename, dates,
duplicate, share, archive, delete, locations and weather moved to a ⋯ menu
**carrying the same data attributes**, i.e. one implementation, not two. Undated
capsules keep the old page. Composes the existing renderers so Bag and Outfits
can't drift.
⚠️ **Every pack screen scrolled sideways by 14px, and had been before this
round** — the "Day by day" row is `.frow` (width:100%) plus 14px side margins.
**The 181px `.log-cta` trap from the other direction**; fixed with `calc()`, and
a case now measures all three sections plus the fold.

**STILL NOT BUILT:** finalise ("I'm done packing" + the deterministic conflict
check + a what-changed trail), and the learned-preference PROPOSAL (choice
evidence has been accumulating in `kv "ctxchoices"` since 2026-08-08 r4).

**2026-08-08 r2–r4 — THE PACKING REWORK. Selftest 357 → **365**, all green.**
Driven by a design document she brought (a decision-authority philosophy written
about packing) plus the r1 audit. **Her decisions, taken as answers to direct
questions — do not re-litigate:** ① Core/Optional REPLACES the tightness dial;
② a review choice locks that outfit and nothing else; ③ **every** occasion is
offered, with a prominent skip (she overrode a recommendation to ask only about
ambiguous ones); ④ preference learning is **proposed, she confirms** — and it is
about **CONTEXTS in general, not trips**; ⑤ Light/Balanced/Flexible named by
consequence; ⑥ **no natural language anywhere**.

⚠️ **D2 AND D5 IN `TRIP_BUILDER.md` ARE DEAD.** D2 ("distinct = any piece
differs") was replaced by `packLookKey` in r13; D5 (tightness = options per
occasion) is what this rework removed. "Do not re-litigate" had already been
overtaken twice by her own reports — check a locked decision against the entries
below it before treating it as binding.

**r2 — "I'D RATHER NOT A DRESS FOR THIS."** Her report: *"the pack suggesting a
dress for a context I don't want one, and I can't really escape that as built."*
True, and nothing covered it: `packOccasionSlotFit` only rules out a silhouette
she has NEVER worn for an occasion, so one dress at one dinner permits dresses
there forever, and swap / ✨ Another / Other options each hand her another.
- **The model lives in `js/12-looks.js`** (`contextPref` / `comboMeetsPrefs` /
  `effectivePrefs` / `prefsLabel`, kv `"ctxprefs"`), NOT in the pack — she asked
  for it to be general, so the everyday suggester reads it too. `js/21-pack.js`
  holds only the trip-scoped override (`packOccPref`, keyed on `packOccId`).
- ⚠️ **A STATED RULE IS OBEYED, NOT WEIGHED — the distinction the rework rests
  on.** `inSeasonWx` and `packOccasionSlotFit` are rescue-shaped and widen again
  rather than cost her an answer, because they are guesses. A rule she stated is
  not: if it leaves nothing buildable the sheet stays EMPTY and says so.
- **Silhouette reuses `formulaKeyFor`** — a formula key names the Dresses slot or
  it doesn't. No new taxonomy.
- ⚠️ **`SIL_ANY` exists because clearing the chip inside a trip must overrule a
  STANDING context rule.** Deleting the occasion key just lets the context rule
  reassert itself, so the control visibly does nothing.
- Applied to the **POOL**, so `suggestPoolChipHtml` names and counts it and one
  tap clears it — the rack's four conditions inherited. `suggestOutfits`' `opts`
  stays free of scoring knobs. "It must BE a dress" can't be said by removing
  pieces, so that half filters results (`_suggApplyPrefs`).

**r3 — CORE AND SPARE REPLACE THE DIAL.** Measured once r1 made the dial real:
**core holds at 7/7/9 pieces while optional moves 4/8/10** — so the dial was only
ever a control over the spare count, wearing an abstraction. Light/Balanced/
Flexible now name their consequence before she picks ("~12 pieces · 3 spare").
- ⚠️ **`packApplyMode` runs AFTER the solve and may only ever drop SPARE.** That
  one-place rule is what stops the mode becoming another opaque multiplier
  threaded through the fill, which is exactly how the old dial got lost.
- ⚠️ **Two things the suite caught within a minute of the trim landing:**
  `res.options` kept promising options the trimmed bag couldn't make (the r1
  "options it never spent" bug from the other end → `packRefresh` after the
  trim); and `st.targets` stayed at the fill proposal, so a slot read "5/7" and
  claimed *"2 short — nothing else you own fits this trip"* about a closet full
  of tops — **the app blaming the wardrobe for its own decision.**

**r4 — THE REVIEW.** The app had never asked her anything.
- ⚠️ **AMBIGUITY MEANS "THE ALTERNATIVES DIFFER", NEVER "how much will she like
  it".** There is no preference model; a confidence percentage would be invented,
  which is the r19 guessing layer in the review's clothes. **Measured: the spread
  term alone barely discriminated** (every occasion ~0.99, because scoreCombo's
  top-two gap is ~0), so it also weighs **stakes** — a context she DECLARED, and
  how dressy the day is. Both derived, neither a guess about taste.
- **Options are diversified by FORMULA** (her suggestion), not by score rank —
  "more options" returning the next three is fake variety, and r13 already fixed
  that bug once when swapping shoes counted as a new outfit.
- ⚠️ **TWO LABELLING BUGS, BOTH FOUND BY RENDERING THE CARD AND READING IT**,
  neither visible in the markup: "Separates instead" was true of all three
  alternatives *at once*; then naming each option's lead garment collided when
  two shared a top. **`packOptionLabels` computes across the SET** — the first
  garment no other option has. The whole interaction is telling them apart, so a
  label that doesn't distinguish is worse than none.
- ⚠️ **Skipping marks decided but does NOT lock.** Locking what she merely didn't
  object to would stop a later re-solve improving days she never looked at.
- **Choices are recorded** (`kv "ctxchoices"`, contrastive: chose vs against) and
  **nothing acts on them yet** — that's the proposal UI, still to build.

**STILL TO BUILD (agreed, not started):** the learned-preference PROPOSAL
("you've picked separates for Dinner 5 times — stop offering dresses there?",
which writes to `ctxprefs` on confirm); DEFINITE/EXCLUDED as first-class visible
states with an unused-definite report and add-from-anywhere; "None of these" →
the "I'd rather…" chips wired into the review card; finalise ("I'm done
packing") with the deterministic conflict check and a what-changed trail; and
undo/reset throughout.

**2026-08-08 r1 — A FULL-APP AUDIT (she asked for one; no specific report).
Selftest 353 → **357**, run GREEN.** All 4 new cases + the 1 rewritten case
mutation-checked red in the same session. **The suite was ALREADY 352/353 on
`main`** — baselined first (the documented rule), and the red case was the r4
lean/cushion guard, which CLAUDE.md records as "run GREEN". Either it regressed
after that run or it was never re-run; **check the suite before starting.**

⚠️ **THE TIGHTNESS DIAL WAS BEING LOST IN THE LAST STEP, AFTER THREE ROUNDS OF
FIXES UPSTREAM OF IT (her 4th report on this dial, r11 being the 3rd).**
`packCounts` scales correctly with K and `packFill` builds exactly what it asks
for — measured on a 158-piece closet, 7-day trip: **11 / 15 / 19** pieces at
lean / normal / cushion. Then **`packRepack` rebuilt the bag from scratch** as
`pinned ∪ what the outfits use ∪ extras` and cut all three to **8 / 8 / 9**,
because eight occasions need about eight outfits' worth of pieces whatever the
dial says. **Lean and normal came out byte-identical** — that is the whole
"switching between lean/normal/cushion changes nothing" report, and r11's fix to
`packCounts` could never have been visible through it. `packRepack` now
**UNIONS** rather than replaces.
- ⚠️ **Inversion ① still holds and is unchanged in spirit:** the bag is a
  SUPERSET of the outfits' pieces, so every outfit is still fully packed and the
  items screen cannot disagree with the outfits screen. What it is no longer is
  the MINIMUM such set — the spare capacity K buys is exactly the difference.
  **Counts remain an OUTPUT of `packFill`; nothing targets a number.**
- ⚠️ **`packDropPiece`/`packAddPiece` now write `st.pack` too**, not only
  `st.res.pack`. They didn't, and with a unioning `packRepack` a dropped piece
  would come straight back at the next swap or re-roll. (The r3 note already
  said these two must stay in step; this is the other half of it.)
- ⚠️ **THE OFF-PATH MEASUREMENT LIED, AND I REPORTED IT BEFORE CATCHING IT.**
  Driving `packSolve` directly with the wide trip rack gave 11/11/11; the app
  passes the filled BAG, and the on-path truth was 8/8/9. Same conclusion, wrong
  numbers and wrong emphasis. **The suite already has `appSolve` for exactly
  this** (`packLoadState → packEnsureSolve`) — use it; `solveFor` cannot see this
  class of defect, which is why three rounds of green tests missed it.
- ⚠️ **A HYPOTHESIS I MUTATION-TESTED AND KILLED:** `repW = 0.5` at lean looked
  like the cause — it halves repetition costs, and the comment above it still
  stated the model she reversed in r4 ("at Lean, wearing one sweater four days
  out of six is exactly right"). **Removing it did NOT fix the red case.** It was
  stale policy, not the bug. It is now `1` at lean anyway, because a smaller bag
  must be paid for in PIECES, never in repeated looks — but **it is not what the
  dial was losing**, and a future round should not re-derive that by reading.

⚠️ **HER GUARD CASE WAS MEASURING SOMETHING STRICTER THAN HER DECISION.** The red
case asserted repetition with `topSpread` (most DAYS any one top went out), and
on a scarce closet a smaller bag makes that arithmetically impossible — four tops
cannot dress four occasions and also shrink. Asked directly, she confirmed the
recombination model: **one top worn with two different bottoms is two different
OUTFITS, not a repeat.** Rewritten against `packLookKey`, the unit
`packDistinct`/`packOptionCount` already use. **A guard that measures more
strictly than the decision it guards goes red for the right reason and sends you
to the wrong place** — it sent this round at `repW` before a mutation ruled it out.

⚠️ **TWO SCREENS, ONE QUESTION, OPPOSITE ANSWERS.** Stats main said *"Your closet
skews Utility but your wears don't — consider wearing those pieces more"* while
**Closet vs Life, one tap away, said "No big gaps"**. `biggestGap` started at 0
and any positive gap won, so **3.4% owned vs 0.0% worn** — a few workout pieces
she never logs — produced a whole-closet verdict. **Every other derivation in
this app carries a noise floor; this was the one that didn't.**
- ⚠️ **They are NOT merged, deliberately.** This one is about formality LEVELS
  (do I own clothes at levels I don't wear); the gap page is about CONTEXTS (is
  there a part of my life the closet can't dress). Both are worth having. What
  they may not do is disagree about whether anything is wrong, so they share
  **`CLOSET_VS_LIFE_MIN_GAP`(0.05)** — the threshold the gap page already used.
- ⚠️ **A fact, not advice**, per the rule "packed 3×, worn 0×" / "worth a second
  look" / the removal of wash orders all follow: it now names the level and both
  numbers and stops. A case pins that it still SPEAKS on a real gap — silencing
  it always would be the "test that can't fail" trap from the other direction.

⚠️ **THE r4 CALENDAR FIX WAS HALF OF ITSELF.** r4 added the future-day plan row
and left the empty state above it, so a declared future day **still opened with
"Nothing logged for this day"** — the exact sentence its own comment quotes as
the symptom — with the Wedding rendered below the sentence denying it. You cannot
log a day you haven't lived: with a plan the line is noise, without one the
honest empty state is about planning. **Past days are unchanged**, and a case
pins that too.

**Also:** Home's Calendar tile read "Nothing logged **yet**" (today-scoped words
that say "never") → "Nothing logged today"; and `renderStatsReportPage` now falls
back instead of throwing when `statsReportField` is unset — every real path sets
the two together, so it isn't reachable today, but dereferencing a missing dim
renders as a blank screen with no way back.

**Verified as CORRECT under probing, so a later round needn't re-audit them:**
suggester cohesion (**0 of 200** combos without a shared level), the Utility/level-1
empty sheet (gear door + starvation note both fire), laundry (tolerance, hamper,
lens narrowing, **0 of 8** suggestions offering a dirty piece), pack solve
determinism (byte-identical across runs — inversion ③ holds), the rack (58 pieces,
properly stratified), and structurally: **no undefined function references in
25k lines**, shelf flags, filter dims in all four places, version lockstep.
⚠️ **Two of my own probes were wrong before the code was** — `suggestGearDoorHtml`
and `renderStatsReportPage` read SHEET/VIEW STATE, not arguments, so calling them
bare returns "" or throws and looks like a bug. Set the state the screen would.

**2026-08-06 r4 — "THERE IS NO SUCH WEDDING". Selftest 349 → 353, run GREEN.**
All 4 new cases mutation-checked red; **one EXISTING case had to be rewritten
because it asserted a policy she reversed.** Follow-on from r3, and the r3 answer
to "where did the wedding come from" was wrong in the part that mattered.

⚠️ **A PLAN SHE CAN'T SEE IS A COMMITMENT THE APP KEEPS AND SHE DOESN'T.** Her
`dayplan` really did hold `2026-08-15 → ["Wedding"]` (and `08-12 →
["Party/Shower"]`), and no code path invents those — all six `saveDayPlan`
callers are user-driven. But **the calendar rendered nothing for it**: the day
row was gated on `dateStr === todayStr()` AND on the entry having an `outfit`
(`js/14-calendar.js:298`), so a context declared for a future day — exactly what
the trip builder and `rackNeededLevels` read — was invisible everywhere. Verified
live: `dayPlan("2026-08-15")` returned the Wedding while the day view said
*"Nothing logged for this day."* Now any date from today on shows its plan,
outfit or not; a context-only row says so and opens the day's plan sheet, and the
month grid carries a `.cal-planned` dot (`!dayWears.length && ds >= today`).
⚠️ "Wear it ✓" stays a TODAY action — you can't log a day you haven't lived — so
a future row reads "Change" instead.

⚠️ **THE FIXED-EVENT SHEET COMMITTED ON ONE TAP.** `openCapAnchorSheet` lists
every context she owns with its formality level printed on the right, which
invites tapping one to see what it maps to — and that tap wrote the `dayplan`
entry, on a date pre-filled to the trip's start. Party/Shower landing exactly on
her trip's start date is the fingerprint. Select and commit are two taps now, and
tapping the selected one clears it (a control that can only turn on is a trap).

⚠️ **A SOLVE THAT ISN'T SAVED IS A SOLVE THAT RUNS AGAIN.** Her ask: *"I need to
be able to reopen that item list / suggested outfit list without rebuilding it —
sometimes I just want to see what it said."* r3 made the BUILD path persist, but
a plain open never did: her record had `built` and **no `assign`**, so every open
solved from scratch, showed a different answer and discarded it. **`packPersistSolve`**
now writes the outfits whenever the solver actually runs, whoever asked.
⚠️ It writes the SOLVE only — never `built`/`targets` — because this isn't her
pressing build, and moving that date on every open is a small lie in the one
place that says how current the pack is. ⚠️ Guarded on `rec.built`, so a preview
or a diff can't create state for a pack she never made.

⚠️ **AN EXISTING CASE WAS ASSERTING THE POLICY SHE REVERSED.** "Lean tolerates
strictly more repetition than Cushion" went red the moment `packOptionTarget`
stopped asking for fewer looks at lean — it was correct for the old model and is
now backwards. Rewritten to the new contract: **lean packs strictly FEWER PIECES
and repeats no more than cushion.** The dial still has to do something she'd
notice; what it buys changed. **When a decision reverses, its guard case reverses
with it — a red case is not automatically a regression.**

**2026-08-06 r3 — TWO REPORTS, ONE TRIP. Selftest 337 → 349, run GREEN.** All 12
new cases mutation-checked red in the same session; **four were found VACUOUS by
that check and rewritten, and one measurement killed a fix I had already
written.** Her words: *"building the pack now readds occasions that I didn't
select and is still giving me two identical outfits for four days of the same
context."*

⚠️ **DIAGNOSED BY READING HER LIVE Stl TRIP IN THE BROWSER, NOT FROM THE CODE.**
The code reading produced a plausible ranking that was WRONG about which cause
dominated. Her actual trip (5 days, 2026-08-12→16): she ticked Home ×4, Workout
×2, Friends ×2, Party/Shower ×1 = **9 occasions on a 5-day trip** whose other
days were already claimed by two flights and two calendar events — leaving **2
free days**, onto which all 9 were crammed. Home ×4 landed as two pairs, and the
pair on each day was assigned the byte-identical look. **Four days, two outfits:
the SLATE, not the solver.** Trip-wide variety was fine (9 distinct over 13).

⚠️ **THE SPREADER ONLY EVER USED "FREE" DAYS.** `free` was computed once and then
cycled with `k % pool.length`, so once those days were used it stacked a SECOND
occasion of the same context on a day that already had one — and same-day
duplicates **merge into one card on screen** while still costing laundry and
options, so the day silently disappeared too. Now: least-loaded day, then fewest
of THAT context, then earliest date, round-robin across contexts. ⚠️ **Flight
days take overflow like any other day** — one extra occasion on a plane day is
honest, and TRIP_BUILDER's travel-last warning was about ORDERING (② claims those
days first), not about keeping them empty.

⚠️ **`todayCombos` WAS WRITTEN AND NEVER READ.** A second occasion on a day paid
nothing to repeat the first, and `added` was 0 because the pieces were already in
the bag — repeating was strictly cheapest. Now charged via **`packOccKind`** at
`PACK_REPEAT_DAY`, **unscaled by `repW`** like the consecutive-day floor.
⚠️ **PER KIND, NOT PER DAY.** "One outfit across contexts = one entry" is
dayplan's rule and the reason same-day cards merge — two DIFFERENT contexts
sharing an outfit is a feature. Only the same context, or two undeclared days at
one level, are charged.

⚠️ **OCCASION IDS ARE CONTENT-DERIVED NOW (`packOccId`), AND THE OLD ONES WERE A
BUG WITH TEETH.** `${date}#${index}` keyed the stored assignment, her locks and
now her drops — so unticking a context renumbered everything after it, the
rehydrate guard (which only asked "are the pieces still in the bag") passed, and
**the removed occasion's outfit was handed to whatever moved into its slot.**
- A `selected` occasion is **deliberately not date-anchored** — demand is a
  multiset (D6), so unticking some OTHER context must not orphan it.
- The level is in the key **only when she pinned it**; derived levels drift as
  she logs wears, and a self-drifting id orphans occasions she never touched.
- ⚠️ **`packOccId` falls back to the index when `_ident` is missing** — a
  hand-built slate (fixtures) would otherwise collapse two occasions onto one id.
  Found by two existing cases going red.

⚠️ **THE REHYDRATE GUARD IS PER OCCASION, VIA TRANSIENT LOCKS.** Survivors (id
present, pieces still in bag, `packOccSig` unchanged) are passed into `packSolve`
as **locks**, which stage A already copies through and the repair already skips —
so "keep what didn't change, solve what did" needed no new machinery.
⚠️ **They are NEVER written to `rec.locked`** — that is her explicit arrangement,
and polluting it would make "re-solve the unlocked ones" a permanent no-op.
⚠️ **`packOccSig` CARRIES NO DATE.** It did at first, and that made unticking one
context re-solve every OTHER context's outfits — removing a context re-spreads
the rest, so their dates moved, so every signature broke. The date's job is the
laundry SCHEDULE, which `packSchedule` recomputes anyway. No weather band either:
weather loads async, so a band would make rehydration depend on a race.
⚠️ Stage B's top-up now skips groups with no unlocked occasion, or adding one day
buys option pieces for four settled ones.

**`rec.dropped` — a calendar event can be taken OUT of the pack (her wedding).**
Pass ① regenerates `dayplan` events on every build and the contexts sheet never
listed them, so there was no way to say "not this trip".
⚠️ **It never writes `dayplan`** — the event stays on her calendar, and the copy
says so. ⚠️ Applied in **`packDemandFor`**, the one derivation all four callers
now use (`packLoadState`, `packDiff`, `packPlanByDate`, `packMidTripWash`), and
filtered on the **SLATE** so `packRack`/`packSlateAsPlans` see it too — a dropped
occasion still stocking the trip rack is the 2026-08-06 r1 lesson in a new hat.
⚠️ The floor pass runs AFTER the drop filter and skips dropped dates, or emptying
a day just refills it. **A declared occasion also inherits the level she set for
that context on this trip** — Stl carried Party/Shower at 4 (history) beside her
own tick at 6.

⚠️ **`PACK_ASSIGN_V`(2) + `packMigrateRecord`, hooked in `packAssignFromRecord`,
NOT in `packLoadState`** — the trip dash reaches the stored assignment through
`packMidTripWash`/`packPlanByDate` without ever loading pack state.
⚠️ **IT DECIDES FROM THE KEYS, NOT FROM THE MISSING STAMP.** A record written in
the new scheme but unstamped would otherwise have every still-correct key looked
up in a legacy map, miss, and be **silently emptied**. Legacy keys are exactly
`YYYY-MM-DD#n`; every new one carries a `|`. Both directions are pinned.

⚠️ **THE OUTFITS WERE NEVER BEING SAVED.** `packPersist` only writes `assign`
when `st.res` exists, and `openPackPlan`'s `if (resolve) await packPersist(cid)`
ran before the lazy `packEnsureSolve` — verified on her live record: `built` set,
`assign` absent. So every open re-solved from scratch, i.e. inversion ③ was not
actually holding and the plan could shift between two opens.

**LEAN IS A SMALLER BAG, NOT A REPEATED OUTFIT (her decision).** Told that lean
meant "repeat every other day" she said: *"same as normal just a smaller bag.
small numbers of clothes can make lots of different outfits."* She's right, and
it's the better model — distinct looks are a RECOMBINATION problem. **A different
outfit per occasion is the floor at every tightness**; K buys spare capacity
(lean +0, normal +1, cushion +2). `packOptionTarget` is **hoisted out of
packSolve so the policy is directly assertable** — a case written against its
downstream effect passed under a mutation restoring the old formula, because on
every fixture available the target isn't the binding constraint.

**`packDemandKey` (level+leg) is split from the candidate key (level+leg+band).**
The band is a CACHE key; keying the occasion COUNT on it split four mild days into
two groups of two, halving the target and letting both be satisfied by the same
two looks. `packRefresh` keyed on `occ.level` alone — a third grouping, and the
one the rehydrate path shows most.

**Stage C's gate is per group and no longer breaks on the first improvement.**
`packAssignVariety` returns `byGroup`/`deficit`/`maxDeficit`; all three strengths
are evaluated and the best legal one wins on `sum(deficit)`, then `maxDeficit`,
then trip-wide distinct. **`maxDeficit` is the term that fixes it** — a repair
improving only the dressy evening used to satisfy a trip-wide count and `break`.
**`res.extras`** now records stage B's spares so `packRepack` stops deleting
them, and **`packRepack` writes `st.pack` too**, not only `st.res.pack` (the r5
"the pack is the union of the outfits' pieces" fix was only half-wired).

⚠️ **A FIX I WROTE AND THEN DELETED, BECAUSE I MEASURED IT.** Stage B's add pool
is `rackIds` minus what stage A used, and the app passes the BAG as `rackIds` —
so it can only reshuffle within the bag. That looks exactly like the r1 bug, and
a version passing the wide trip rack was written. **On every configuration tried
— roomy and scarce closets, 5/8/10-day trips, lean through cushion — stage B
added ZERO pieces from outside the bag**, because `packFill` already builds a bag
richer than the option target. Unexercised, and its only reachable effect would
be growing the bag past the slot counts she set. **The evidence to bring, if a
future round wants it, is a fixture where `packOptionCount` on the filled bag
comes in UNDER `optionTarget`.**

⚠️ **THREE THINGS WERE ONLY FOUND BY RENDERING THE SCREENS.** "Wedding" appeared
**twice** in the contexts sheet — once in the browse list of every context she
owns, once as the actual calendar event, with the event buried under a dozen rows
(the calendar/floor sections now sit ABOVE "Everything else"); the drop button
measured 114px in a 390px column; and the four Home days came back as four
distinct tops over shared jeans and shoes, which is what confirmed the fix rather
than any assertion.

**2026-08-06 r1 — FOUR REPORTS. Selftest 330 → 337, run GREEN.** All 7 new cases
mutation-checked red in the same session; **two were found VACUOUS by that check
and rewritten**, which is the third and fourth time that has paid for itself.

⚠️ **EIGHT RACK CASES WERE ALREADY RED ON `main` BEFORE THIS SESSION** — left by
2026-08-05 r11–r13. Baselined first (the documented rule), which is the only
reason they didn't read as this round's regressions. Two causes, both worth
knowing: `RACK_SLOT_QUOTA` became `rackSlotQuota()` with the size dial and four
cases still named the constant; and three cases pick "an off-rack piece" with
`items.find(not on the rack)`, which **silently started returning a DRESS-ONLY
piece** once r12 excluded those — so cases about ordinary pieces became cases
about a piece the rack is supposed to refuse, and two failed for the right reason
while appearing to say the rack had become a cage. **The fixture drifted under
the code.** Both fixtures' dressy banks are now `[5,6]` (dressy-LEAN, which is
what `RACK_OFFLEVEL_SHARE` is actually about); `[6]` made every ceiling case
vacuous under r12's stricter rule, and left "a dressy piece can still be a
rediscovery pick" asserting the r1 rule r12 had replaced.

⚠️ **THE PACK WAS BUILDING OPTIONS IT NEVER SPENT.** Her report: a 5-day trip,
19 pieces, **four distinct outfits** — the same tee/pants/cardigan twice, the
same dress twice. Two causes and **NEITHER FIX WORKS ALONE** (verified by
mutating each separately; both alone go red):
- **Stage A chooses against a pack that doesn't exist yet.** On day one every
  candidate costs `added * 1000`; **by the third day of a level, re-wearing an
  earlier look costs `PACK_REPEAT_ANY + PACK_REPEAT_TOP` = 550 while ANY new
  piece costs 1000.** So repeating is cheaper than varying, by construction, at
  every tightness — `repW` scales the losing side, so the dial cannot reach it.
  It converges on ~2 looks per level. Stage B then raised option counts and
  **never revisited the assignment**, so the options were carried, not worn.
  **`packRepairAssign` (stage C)** re-walks the trip over the FINAL pack, where
  `added` is 0 for everything and the repetition terms finally decide.
- **Stage B's target was `K` per GROUP**, and four casual days are ONE group — so
  the app guaranteed exactly two looks for four days and then correctly repeated
  them. `optionTarget` scales it with the occasion count (`PACK_OPT_MAX` caps it).
- ⚠️ **`PACK_REPAIR_STRENGTHS` is not belt-and-braces.** Pushing variety hard
  spends the clean tolerance-1 tops early and leaves day five with nothing clean:
  measured **4 → 6 distinct outfits AND 0 → 1 violation**, so the gate threw the
  whole repair away and the fix silently did nothing. Strongest-first, take the
  first clean improvement.
- ⚠️ The repair **may never cost coverage or a clean day**, and **locked
  occasions pass through untouched** (inversion ③). It is deterministic — stage A
  has restarts because it searches; a repair that wobbled would read as churn.
- ⚠️ **THE ROOMY FIXTURE DOES NOT REPRODUCE THIS** — three attempts at the case
  passed against it while the defect was live. `scarceCloset` (few per slot, high
  tolerance so only repetition is under test) reproduces it exactly: **7
  occasions in 2 outfits with 6 options available** → 5 after.

⚠️ **TRAVEL PLANS ARE NOT THE RACK'S BUSINESS, and she diagnosed it herself**
(*"rack should not consider travel plans — a planned formal event on a trip does
not have anything to do with the rack"*). Booking a trip writes its anchor events
**straight into `dayplan`** (`saveCapsuleForm`), and a declared level is the ONE
exemption from r12's dress-only filter — so **one shower on holiday moved every
`[6,8]` piece she owns into the pool she dresses from AT HOME, for a fortnight.**
`rackHomeDate` skips away days in `rackNeededLevels`, `rackDeclaredLevels` and
`rackForcedIds`' declared half. ⚠️ `rackWarmth` and the lived half already did
this for PAST away days — **this is that audit finished on the forward half**,
the "when you add a trigger, audit them all" lesson arriving through `dayplan`.
`RACK_ALGO` → 8.

⚠️ **"THE RACK SHOULD ONLY BUILD LEVELS 2, 3, 4, 5 UNLESS I REQUEST OTHER
LEVELS."** The formality top-up is **deliberately exempt from the off-level
ceiling**, which made it the one door left open: `levels` unions declared plans
with her top three LIVED levels, so a few dressy evenings put 6 in the floor and
the top-up went shopping for level-6 tops, bottoms AND shoes on every rebuild —
the ceiling's whole job undone by the one door it doesn't watch.
`RACK_EVERYDAY_MAX`(5): habit stocks the ordinary levels, only a DECLARED plan
goes above. ⚠️ Coverage is unaffected — `poolCoversLevel` + `planningPool`'s
rescue already widen to the whole closet the moment she asks.
⚠️ **The case for this was VACUOUS twice.** First on `withRackCloset`, whose
dressy pieces are `[6]` and so can never be top-up material. Then, on the right
fixture, with 40 injected level-6 days — at which point level 6 **legitimately
becomes her typical day**, `rackTypicalLevel` rises to 6 and the ceiling
correctly stops applying. "Habit" means a level that reaches the top-three floor,
which one dressy evening a month already does; five days, not forty.

⚠️ **A SAME-DAY EDIT IS A CORRECTION TO WHAT SHE WORE.** Her report, and she
called it a major problem: *"removing an item from an outfit that I just logged
(or adding one) does not change the 'what this changed' screen and it does not
remove the item's wear."* `removeLookPiece`/`addLookPiece` shipped 2026-08-05
under "a look's PIECES are what it is now, its WEARS are what happened" — still
right for a look worn ten times over a year, **wrong for the one she logged an
hour ago, where the edit IS her saying what left the closet.** The builder has
drawn that line correctly since 2026-07-08, so this reuses it:
`syncLookPieceEdit`/`afterLookPieceEdit` → `wearSyncCandidate` +
`syncWearsToLook` (same-day syncs silently, 1–14 days offers).
⚠️ **The wear screen reads `wears` at open time, so the ROWS are the fix** —
there is nothing else to invalidate, and a second cache would only be a way for
the two to drift. Undo re-adds the piece and re-syncs, symmetrically.

**The rack screen's bookkeeping folds away** (her ask: *"bottom part showing
exclusions etc should be collapsible"*). Second-look + kept-in + taken-off go
behind one `#rackExtras` button carrying a count; `_rackExtrasOpen` is
session-only and reset on entry, same rule as `_sugg.wholeCloset`. Rendered and
measured at **358 × 51px** in a 390px column — full-width buttons need an
explicit `width`, and 22px in a detached host just means the app's CSS isn't
loaded there.

**2026-08-05 r1–r13 — THIRTEEN ROUNDS FROM HER LIVE USE. Written up 2026-08-06.**
Shipped one deploy per fix, tests deliberately skipped at her instruction ("I'm
close to my weekly usage limit — deploy often, skip tests until all is
deployed"); the 2026-08-06 r1 session is what baselined and repaired the suite
afterwards, which is where the 8 red rack cases it found came from. Verification
here was a per-file + whole-bundle JavaScriptCore parse check plus **targeted
arithmetic probes**, and three of the four hardest finds below came from a probe
rather than from reading the code.

⚠️ **THE HEELS TOOK FOUR ROUNDS AND ONLY THE MEASUREMENT ENDED IT.** She reported
"so many heels" three times (r6 ceiling → r9 → r12). r6 and r9 both reasoned
from the code and both were wrong about the cause. **`itemFormalityBase(i)`
(r9)** is the answer: `itemFormalitySet`'s LAST step adds the modal level of the
explicitly-tagged pieces she has co-worn, so imputed heels — `[6,8]` from the
`SUBCAT_FORMALITY` seed and the name rule — became **`[3,6,8]`** after a few
casual outings, and every ceiling was reading a minimum the nudge had already
moved. The nudge is right for the SUGGESTER (a piece needs a plausible level to
be paired at all); it is the wrong input for "has this earned a standing rack
seat". ⚠️ An EXPLICIT array is returned untouched — that is her judgement.
**Probe it before changing it:** 3/3 imputed heels excluded, boots and sneakers
unaffected.

⚠️ **THE RACK'S LEVEL RULES, in the order they were tightened.** All are
`RACK_ALGO`-stamped (4 → 7 across the day; bump it whenever SELECTION changes).
- **`RACK_DRESSY_FLOOR`(6) + `dressOnly`** (r6): a piece with no level below 6 is
  off the rack. ⚠️ Judged on `itemFormalityBase`, not the nudged set.
- **`offLevel` + `rackTypicalLevel`** (r9): the old ceiling only caught pieces
  serving NONE of `rackNeededLevels`, whose floor is her **top three lived
  levels** — so if 5 was among them a `[5,6,7]` piece was never even looked at.
  A piece whose FLOOR is above her 75th-percentile lived level
  (`RACK_TYPICAL_SHARE` 0.75) is now capped too.
- ⚠️ **HABIT IS NOT A PLAN** (r12, her words: *"cannot be on the rack unless I
  have planned something that requires that level"*). The exemption moved from
  `rackNeededLevels` (declared ∪ habitual) to **`rackDeclaredLevels`** (declared
  only). This is the one that finally bit; the previous two were exempting on
  her own habits.
- ⚠️ **WEARING IS NOT PLANNING** (r12): `rackForcedIds` forces anything worn in
  14 days into rotation, so one dressy evening put the heels back for a
  fortnight — the stretch she is LEAST likely to need them. Its **lived** half
  skips dress-only; its **declared** half does not. **A pin still overrides
  everything.**
- ⚠️ Safe because `poolCoversLevel` + `planningPool`'s rescue already widen to
  the whole closet the moment she asks for a level the rack can't dress.

**RACK SIZE IS A DIAL (r1).** `RACK_SLOT_QUOTA` → **`RACK_SLOT_QUOTA_BASE` +
`rackSlotQuota()`**, scaled by `rackTargetSize()` (Settings slider, 46–130).
⚠️ Every band keeps a floor of 1 so a slot can never lose its dormant share.
⚠️ The size is in `rackIsStale` (`st.size`) but deliberately **NOT** in
`RACK_ALGO` — a size change is hers and immediate; bumping ALGO would restale
every other stored rack too. `rackQuotaTotal2(size?)` reports the REAL total
(per-band floors round up), because "58" on a rack that will be 62 is the kind
of small lie that erodes every other number.

⚠️ **A TRIP WEAR IS NOT A HOME WEAR (r2).** `rackWarmth` is pure recency over 60
days, so a ten-day trip wrote ten days of wears for ~20 pieces at the top of the
window and **the suitcase owned rotation for two months**. It now ranks on the
most recent **HOME** wear, falling back to an away wear + `RACK_AWAY_PENALTY_DAYS`
(21) — not zero, or the bug just inverts. `rackForcedIds` skips away days for the
same reason. ⚠️ It reads its own `wearRows` (the r3 injectability lesson).

**PINS EXPIRE (r2), which is the answer to "does it stay forever?"** Stored as
`{id, d}` objects (legacy bare strings still read). A pin clears when she WEARS
the piece — merit takes over via `rackWarmth`/`rackForcedIds` — or after
`RACK_PIN_DAYS`(60) **HOME** days. ⚠️ `rackEnsure` must persist `st.pinned`
unchanged, not a flattened id list, or every rebuild resets the clocks.

⚠️ **RESET IS NOT A PIN (r10).** `rackReturnPiece` called `pullOntoRack`, so
undoing a "not right now" silently spent a rack seat (pins bypass the quotas).
**`rackResetPiece`** clears the exclusion and stops; **`rackUnpinPiece`** is its
mirror; **`rackPinnedListHtml`** + **`rackOffList`/`rackOffSectionHtml`** make
both sets visible — pins were write-only, and "will this come back?" is answered
per piece (a push-out expires, `NO_RACK_TAG` doesn't). **`NO_RACK_TAG`
("Keep off the rack", r6)** is narrower than `no-suggest` on purpose: the piece
is still suggested when she asks for its level or it's in a capsule.
**`pushOffRack` now tops the slot up** (`rackEnsure`, structural — never a tick).

⚠️ **PACK: `PACK_COUNT_MAX` WAS EATING THE TIGHTNESS DIAL (r11) — three reports,
and only a probe found it.** r9's `forceSolve` (below) was a real bug and not
her bug. `packCounts` scaled ONLY the rate term, then took a `max` against the
laundry and coverage floors, then clamped. Both ends swallow K: the max means
the scaled term often isn't the one being read, and **`packSlotRates` derives
her rate from what she ACTUALLY packed on past trips — she packs generously, so
on a 7-day trip all five slots pinned to their caps at BOTH normal and cushion.**
Identical bags. It only ever worked on short trips. `PACK_COUNT_MAX` is now the
cap on what **normal** proposes; cushion may exceed it, lean may go under but
never under the hard floors, and lean **floors** rather than rounds so a 2 can
reach 1. Measured 26 / 34 / 43.
- ⚠️ **`packLoadState({resolve})` sets `forceSolve`, consumed once by
  `packEnsureSolve` (r9).** Inversion ③'s rehydrate guard is unconditional, and
  cushion only GROWS the bag — so a stored assignment was always still contained
  and the guard could never fail on the one path that needed it.
- ⚠️ `openPackTightSheet` never solved before persisting, so `packPersist`'s
  `if (st.res)` left the PREVIOUS tightness's outfits stored, and the toast then
  read `res.stats` off null and threw **inside a `try/finally` with no `catch`**.

⚠️ **AN OUTFIT IS ITS LOOK, NOT ITS PIECE SET (r13).** Her rule: *"an outfit
cannot be exactly the same except shoes."* D2 said any differing piece makes two
outfits distinct, expecting the optimiser to buy a second pair of shoes on
merit. It bought them constantly — **swapping shoes adds one small piece and
resets every repetition penalty at once**, so the solver satisfied both "K
options per occasion" and "don't repeat" without changing what the outfit looks
like. **`packLookKey` = the piece set minus Shoes**, used by `packDistinct`,
`packOptionCount`, the solver's `prevDayCombos`/`usedCombos`/`todayCombos`,
`packDiversify` (look reuse weighted far above shoe reuse) and the options sheet.
⚠️ Deliberately NOT "every slot must differ" — reusing the same jeans all week is
why repetition is charged on the visible half only. ⚠️ **The D2 comment predicted
this exact failure and named this exact fix ("needs the visible core variant"),
so the old selftest case 12 was written to hold the behaviour this replaces.**

⚠️ **INVERSION ① IS NOT SELF-ENFORCING AFTER A SOLVE (r5).** Her report: *"hiking
boots in a workout context that are not listed in the items screen"* — and they
really weren't in the bag. `packCandidates` draws **level 1 from the whole
closet** by design (her running shoes are Sneakers at `[2,3]`), so a solve can
legitimately choose a piece that was never in `st.pack`, while `bySlot` — the
items screen — is derived from `st.pack`, which the solver doesn't touch.
`packEnsureSolve` now calls `packRepack` + `packRegroup` after solving.

**THE PACK'S OUTFITS ARE GROUPED BY HER BUCKETS (r5).** Her report: the outfits,
the occasions and the formalities didn't correspond. The screen rendered the
PLACED view (one card per day) — a derived detail the solver needs for the
laundry schedule and she never asked for. **`packBucketsHtml`** = one section per
(context, level) she declared, holding exactly the count she asked for and saying
so; flight days and floor filler get their own labelled sections rather than
being mixed into hers. **`packOccCardHtml`** is extracted so the bucket view, the
day view and the by-day planner share one card and one set of handlers;
`packDaysFoldHtml` keeps the by-day view, folded. **`packOpenSuggest` /
`packSetOccasionOutfit`** put the real suggester on every occasion, scoped to the
suitcase with the sheet's own widen as "or from outside of it".
⚠️ **No `planCtx`** — that would run the plan branch and write `capsules.plan`,
the bulk look creation r5 (2026-08-04) removed.
⚠️ **AN EMPTY STORED CONTEXT LIST IS A DECISION**, not "unset": `packSlate` fell
back on `.length`, so clearing the list handed the app's proposal straight back.
The sheet now says when the ticks are still a guess and offers Clear all.
⚠️ **`packSlateAsPlans` carries `o.level` (r12)** — entries went over as contexts
only, so the rack re-derived the level from `contextFormalityLevel` (her HISTORY
for that context) and threw away the level she set FOR THIS TRIP.

**HOME: ONE DAY CARD, TWO DATES (r6–r8).** `tomorrowCardHtml` → **`dayCardHtml(ds,
{label, isToday})`**, so Today gets the identical card (planned outfit, else a
generated one, weather, "you've dressed for this before") instead of a bare
`logged-row`. ⚠️ **Every handler now reads `data-tm-date`** — each used to
recompute `shiftDate(todayStr(), 1)` for itself, which is exactly what stops a
card being shared. **`quickCtxChipHtml`/`openQuickContextSheet`** are the
dropdown context button; they write the DAY PLAN (not a card-local filter) so the
suggestion re-levels and the week planner sees the same value, and
`tmPickClear` drops the now-wrong sticky pick.
⚠️ **WHAT SHE WORE OUTRANKS WHAT THE APP WOULD SUGGEST (r9):** the card read only
the plan, so logging from the calendar or a look left Home proposing something
else. `dayGroups(today)` leads; the suggestion is demoted behind "Something else
to wear?" (`_todayAltOpen`). Suppressed entirely in trip mode (r8) — the trip
dash already is today.
⚠️ **THE ATTENTION FOLD IS GONE (r6)**, her words: *"I don't want things hidden
behind 'two more things' — just keep scrolling."* The one-thing-at-a-time
hierarchy was my premise, not hers, and its real cost was that a prompt she'd
have acted on sat behind a link naming nothing — the app looked calm by hiding
work. `_homeAttnOpen` and `todayPlanRowsHtml` are gone.

**PLAN THE WEEK MOVED INTO THE CALENDAR TAB (r7).** `calendarMode` = Month /
Plan the week, sharing the day view; `renderWeekPlan(target, {embedded})` so
`#tab-week` still works and `openWeekPlanSheet` routes to the calendar.
⚠️ The month view installs `body.onclick` and the embedded view replaces that
innerHTML, so the mode bar carries its own handler in both.
⚠️ **"Outfit still to pick" was a LIE on any day she'd logged elsewhere** — the
screen read the plan and never `wears`. **`loggedOnDay(d)`** fixes it. A context
chip is on EVERY row (changing one context used to mean the whole day sheet),
plus ✕ per entry, ✕ per day and Clear the whole week — each also clearing that
day's sticky pick.

**LAUNDRY IS AN ALWAYS-VISIBLE LENS (r3).** Her ask: *"a filter at the top when I
add an item like available, but clean / clean + hamper / all — showing always so
I don't have to click into the filters."* A real `laundry` dim on `FILTERS`
(so the funnel inherits it) **plus** `laundryLensHtml(id, state, onChange?)`
rendered persistently on the closet root/category/grid, the capsule add-items
picker and the calendar +Clothing picker. One delegated capture-phase listener
over a registry (`_laundryLensFns`), registered by the renderer itself so a new
surface can't draw the row and forget to wire it. ⚠️ It deliberately does **not**
touch STATUS — both surfaces already have a status lens beside it, so "All"
means no laundry narrowing and the middle option is the hamper alone.
⚠️ Adding a dim still means four places: `FILTERS`, `newFilterState`,
`hasActiveFilter`, `filterActiveCount`.

**EDITING WITH FEWER TAPS (r4).** ⚠️ **`removeSuggestionPiece` (✕) ≠
`banSuggestionPiece` (⃠):** ⃠ bans and REFILLS the slot, which is the wrong
answer for *"shoes from an outfit I'll wear at home"* — the app already models a
shoeless look as `"home"`. Guarded by `outfitIncomplete` (via a `__probe__` entry
in `outfitItemMap`) so it can never produce a look the health check would flag,
and `suggCanRemove` hides the chip where it wouldn't work. On a look's Details
page, **swipe a piece row left to remove it** + ＋ Add a piece
(`removeLookPiece`/`addLookPiece`/`openLookAddPieceSheet`/`wireLookPieceSwipe`) —
⚠️ these are what 2026-08-06 r1 then had to make same-day-wear-aware.

**CAPSULES (r1).** Trips / Capsules are two tabs (`capsuleTab`), ⚠️ **split on
DATES, not `kind`** — dates are what trip mode keys on everywhere else. ＋ New
moved to the TOP, swipe-left deletes a row (`wireCapSwipe`, axis-locked so it
can't hijack a vertical scroll), and the create form takes a **location**
(`geocodeLocation`, written as `locations:[{…, from:null, to:null}]` = whole
trip) so weather works from the moment a trip exists.
**Also r1:** split/delete a look now names **wears BEFORE today** (`priorDays`) —
her rule is *"almost always only want to delete it if there were no previous
wears"*, so "other days" was the wrong fact; and **"use the default arrangement"
no longer vanishes once a look is arranged** (it was gated on having no layout;
it now reads Reset, with Undo on the toast).

⚠️ **DEPLOY NOTE.** `.nojekyll` was added 2026-08-06 — the site is plain static
files and Jekyll only adds a failure mode. (The r1 Pages failure itself was a
**GitHub Actions major outage**, not content: three builds stuck at 0ms while
every prior build took ~40s.)


**2026-08-04 r6 — FOUR MORE REPORTS FROM THE SAME FEATURE.** Selftest 327 →
**330**, run green; all 3 new cases mutation-checked red in the same session,
each reproducing her exact words. ⚠️ **Every one of these was a case of the app
holding the evidence and not consulting it at the moment it chose.**

⚠️ **SEASON AND WEATHER GATE THE BAG, NOT JUST THE OUTFITS.** Her report: the
pack *"put in snow boots, which is crazy and I haven't worn in years"*.
**`packFill` took a `wxFor` argument and never used it** — the ONLY season gating
anywhere was whatever `buildRack` applied, and the level-1 branch bypasses the
rack by design (r5). Measured before the fix on a Summer trip: snow boots were
the **SECOND shoe picked**, `rackWarmth` 0, zero wears, while
`inSeasonWx(snow, "Summer")` was already false — so the bag could hold pieces
`packCandidates` would then refuse to build with, and `packCoverage` reported the
gap the bag itself had caused. ⚠️ Eligible on **ANY leg**, not all (Madrid-then-
Javea is two climates). ⚠️ **Her keeps are exempt** — a pinned piece is a
decision, not a candidate. `wxFor` is now threaded through all five `packFill`
callers.

⚠️ **`rackWarmth` IS RECENCY ONLY, AND IT WAS CARRYING WEIGHT IT COULDN'T HOLD.**
Her report: it reached for beach sandals and hiking boots *"before ever thinking
to suggest my birkenstocks, which I wore almost every day of my last trip and
wear all the time at home too"*. Both halves of that sentence were evidence the
app had and discarded: `rackWarmth` is 0–1 over 60 days, so a shoe worn ONCE
three days ago scored 0.95 and one worn thirty times scored 0.98 — at weight 10
it could never outrank `set.length * 6`, and a specialist spanning one more
formality band won on breadth alone. And `travelProven` needs `TRIP_MEMORY_MIN`
(2) trips **and** worn-on-every-one, so one trip of daily wear counted for
nothing. **`packWearSignals`/`packAffinity`** = wear-DAYS (never rows), log-scaled,
trip days weighted double, ONE pass built per `packFill` call — ⚠️ `wearCount`
inside the candidate loop is the documented items × wears trap that got context
scoring thrown out of this very function. `PACK_AFFINITY_W`(10) beats a one- or
two-band breadth difference but **never a real `fill * 100` deficit**: an occasion
nothing else can dress still outranks her favourite shoe. `PACK_RECENCY_W` 10 → 4.

⚠️ **THE LEVEL IS NOT THE OCCASION.** Her report: *"a very casual dress for a
plane ride when I'd never wear a dress on a plane"*, and *"weird combinations for
certain events"*. Nothing was wrong by the solver's rules — a casual dress clears
level 2 — because **the context is translated to a level and then thrown away**,
the same discard `contextFormalityLevel` was written to fix for the suggester.
**`packOccasionSlotFit(occ)`** answers it from her own history and
`packCandidates` filters the pool with it.
- ⚠️ **THE PLANE DAY IS NOT TAGGED "Flight".** `tripWearContext` auto-stamps
  every trip wear with **Travel**, which is trip-WIDE — asking what she wears for
  Travel returns everything she wears on holiday, dresses included, and would
  block nothing. The honest source is the **FIRST AND LAST DATE of past trips**,
  which is exactly when she flew. Derived from dates already stored; no new
  tagging asked of her.
- ⚠️ **SLOTS, not subcategories.** "I'd never wear a dress on a plane" is a
  silhouette rule and it's the one she can state; blocking at subcategory level
  would also rule out the specific jeans she happens not to have flown in.
- ⚠️ **Rescue-shaped, like `inSeasonWx`** — it only REMOVES a silhouette she has
  never worn for this occasion, needs `PACK_CTX_MIN_DAYS`(4) days of evidence,
  and if the narrowed pool enumerates nothing the unfiltered pool is used
  instead. It also **says nothing at all unless the history shows a complete
  silhouette** (top half + shoes), or "she never wears a dress to work" would
  delete tops-and-bottoms on a day she has only ever worn dresses.

⚠️ **"DOESN'T FIT ANY OCCASION ON THIS TRIP" WAS USUALLY THE WRONG FACT.** She
still saw it after r5. `packItemWhy`'s labels come from `packItemsOptionMap`,
which is empty whenever a piece is in no COMPLETE in-pack outfit — normally
"nothing in the bag goes with it yet", not "wrong for this trip". Since r5 the
fill cannot choose an off-level piece at all, so a piece reaching that branch is
usually one she added, kept, or that survives in a pack built by the older
algorithm. It now checks the level directly and says which of the two it is.
⚠️ **A stored pack is NOT re-filled on open** (`rec.pieces` wins, inversion ③),
so pieces chosen by an older algorithm persist until "Start over from the app's
numbers" — that is deliberate, and it's why the copy had to be right.

**2026-08-04 r5 — THREE REPORTS ABOUT BUILD-A-PACK.** Selftest 322 → **327**, run
green; all 5 new cases mutation-checked red in the same session (two of them
reproducing her exact words). ⚠️ A FOURTH report — the trip recap counting a wear
from a day she'd removed by editing the dates — is **NOT FIXED and not
reproduced**: `tripRecapData` bounds on `[start_date, through=end_date]` and
`packGrade` on `tripDates(c)`, both verified live against a capsule ending 07-24
with a wear on 07-25 (`unpacked: []`, empty `outsideDays`), and `editCapsuleDates`
mutates the same object both readers use. Don't "fix" it blind; get the trip's
current dates first.

⚠️ **`packCoversLevel(i, lv)` — LEVEL 1 ANSWERS TO `isFunctionWear`, NOT TO THE
FORMALITY SET.** Her report: build-a-pack *"is unable to build workout items for
the trip"*. Her running shoes are subcategory **Sneakers at [2,3] with the
`gear:workout` tag** — she wears them casually too — so `packFill` asking "does
the set contain 1" credited **nothing** to a Utility occasion, never packed the
shoes, and `packCoverage` then reported the day uncoverable. `packBlockingSlot`
had the identical bug and so named the wrong slot. `packCandidates` and
`packSwapCandidates` were already asking it correctly; the rule is now ONE
function used by all four (`packFill`'s `canReach`/`noteCover`/scoring,
`packBlockingSlot`, `packRemovalOrder`, `packUniqueCoverIds`). **This is exactly
the trap `isFunctionWear` was created to close (2026-07-26 r13) arriving in a
function that hadn't heard of it — when you add a level-1 reader, audit them all.**

⚠️ **A PIECE THAT SERVES NO OCCASION ON THE TRIP IS NEVER PACKED; THE SLOT RUNS
SHORT.** Her report: the pack *"is putting items in that don't match the
contexts/formalities for the trip (and admitting that they don't match)"*. Both
halves were true and the second was the app being honest about the first: once
every demanded level had laundry capacity, `fill` went to **0 for every remaining
candidate** and `packFill`'s score fell through to `rackWarmth`, so the tail of
each slot filled with whatever she'd worn lately — and `packItemWhy` duly printed
*"doesn't fit any occasion on this trip"*. Same call as the rack's off-level
ceiling (r2): **54 that reflects her week beats 58 padded with clothes for days
she doesn't have.** ⚠️ Guarded on `needAt.size` — with no levels in demand there
is nothing to be off-level FROM and the gate would empty every slot. ⚠️ The
shortfall is SPOKEN, twice: the slot's why-line reads "3 short — nothing else you
own fits this trip's days", and ＋ toasts rather than silently doing nothing.

⚠️ **THE PACK *IS* THE PLAN — `packSendToPlan` IS GONE.** Her ask: *"I don't want
to have to say send to the trip, I want it to just build and all those editing
options to always be available."* The solve lived in `kv "pack:<cid>"` while the
by-day planner, the trip dash and "Wore it" all read `capsules.plan`, which
**only that one button ever wrote** — so a built pack was invisible everywhere she
lives during a trip until she found it, and pressing it dumped ~13 auto-created
looks into her Looks list (which is why it needed a confirm).
- **`packPlanByDate(c)`** reads the record directly; `packPlanCardsHtml` renders
  the day cards with the **same `data-pack-*` hooks** as the pack screen, so
  swap / ✨ Another / Other options / 🔒 Lock work there with no second set of
  handlers to drift. Rendered by `renderCapsulePlan` and the Home trip dash.
- ⚠️ **THE OLD GATE'S REASON IS STILL RIGHT; only the gate was wrong.** Nothing
  writes `capsules.plan` or creates an outfit on a solve. **`packWoreOccasion`**
  materialises ONE look at the moment she says she wore it (same create-or-merge
  as `wearSuggestedCombo`) and adds it to the plan. Do not reinstate a bulk send.
- ⚠️ **Materialised days are matched by ITEM SET, never a stored flag** — a plan
  look whose pieces are this occasion's pieces IS this occasion, however it got
  there (including packs sent by the old button). Derived, so it can't go stale,
  and removing the look brings the pack's card back.
- ⚠️ **`packEnsureSolve` REHYDRATES BEFORE RE-SOLVING** (inversion ③, now
  load-bearing): a screen that only wants to DISPLAY the plan must not re-enter
  the solver and reshuffle days she never touched. It solves only when the stored
  assignment no longer describes the trip. **`packStateReady(cid)`** loads state
  + rehydrates for handlers now reachable from screens that never opened the pack.
- ⚠️ **The `.cthumb` trap, caught by rendering it:** `.tdl-collage` is a fixed
  56px box and `.pack-pthumb` a fixed 62px thumb — four of those spill over the
  name beside them. New **`.tdl-mini`/`.tdl-minith`** (26px, in the dark-mode
  filter list). Reading the render also caught a card header printing
  "Casual · Casual" (a context-less occasion is already named by its level).

**2026-08-04 r3+r4 — HOW THE RACK, TRIPS AND CAPSULES INTERACT.** Her question,
then three asks out of it. Selftest 316 → **322**, run green; all 6 new cases
mutation-checked red in the same session. r3 shipped the features, r4 fixed three
real defects the suite then found in them — **she asked that work DEPLOY FIRST
and be tested after**, so that a usage cap can't leave her with nothing.

⚠️ **THE RACK DIDN'T KNOW HER OWN WEEK.** Two questions, both answered "no":
*"I make a planned outfit, and the rack resets after that — do those pieces stay
in (or get added to) the rack?"* and *"if I wear something not on the rack, does
it get added?"* `rackNeededLevels` reads forward day plans for their **LEVELS
ONLY**, so planning Thursday's outfit stocked *a* level-4 top and said nothing
about the top she picked; and a piece worn yesterday tops rotation by warmth but
only at the NEXT rebuild — and **wearing something marked nothing stale**, so
"next" was up to 7 days away. **`rackForcedIds`** forces both sets in
(`RACK_RECENT_DAYS` 14 back, `RACK_LOOKAHEAD_DAYS` 14 forward). `RACK_ALGO` → 3.
- ⚠️ **STRUCTURAL, never a rotation tick** (the r7 churn lesson). Forced pieces
  join **ROTATION**, not the offered bands, so they can't inflate `seen` — she is
  not "passing over" a shirt she is wearing.
- ⚠️ **THEY DISPLACE, THEY DO NOT PILE ON.** Adding on top grew the fixture's
  Dresses 6 → 15 and Shoes 11 → 16 — which turns the stratified rack back into a
  top-N, and the slot quotas are the whole reason it can build an outfit. A
  forced piece takes a rotation SEAT; the slot's coldest ordinary member steps
  out. **Pins are never displaced or counted** (pinning bypasses quotas by design).
- ⚠️ **THE FORCED SET MUST BE SATISFIABLE, or it is an infinite rebuild every
  boot.** First version capped nothing and let `buildRack` trim the overflow, so
  `rackIsStale` found a forced piece missing → rebuild → trim → forever. On the
  phone that reads as *the rack churning*. **The cap lives in `rackForcedIds`**
  (the slot's rotation band, commitments first then recency); a case pins that
  everything it returns survives into the rack.
- ⚠️ **A PUSHED-OFF piece is excluded** — she said not now, and wearing it once
  doesn't overrule that. **Season is deliberately NOT applied.** A caller with a
  restricted `pool` (the pack solver) drops anything outside it.
- ⚠️ **THE RANKING MUST READ ITS OWN `wearRows`.** It ordered by `rackWarmth`,
  which closes over the global `wears` — so an injected wear was invisible and a
  piece worn YESTERDAY ranked at warmth 0 and fell off the cap. `buildRack` is
  documented as injectable; **a ranking that quietly isn't makes the fixture and
  the phone disagree.**

⚠️ **THE RACK ROTATED WHILE SHE WAS AWAY, AND THE TICK MEASURED NOTHING.** During
a trip the **suitcase IS the pool** (`_suggPool` hands the capsule branch the
whole sheet), so a day-7 rotation mid-trip incremented `seen` for ~26 pieces in a
closet she wasn't standing in. They weren't passed over — she never had the
chance to decline them. Two trips a year and "worth a second look" fills with
pieces whose only crime was a holiday. **`rackShouldRotate` counts HOME days**
via **`rackHomeDaysSince`** + the existing `awayRanges()`, and never rotates
mid-trip. No new state. **This is the r7 measure-vs-mechanism lesson arriving
through yet another unaudited trigger — when you add one, audit them all.**

**TRIP DATES ARE EDITABLE (`editCapsuleDates`).** Her ask: *"I need to be able to
change vacation dates — e.g. I accidentally made this trip one day too long."*
There was no way to: `_capForm` exists only during CREATE and the detail page
offered Rename and nothing else — while the dates drive trip phase, the by-day
planner, the pack solver, `awayRanges()` and the recap. A **Dates** action beside
Rename. ⚠️ **It reverts the OLD range's weather correction before applying the
new one** — shortening a trip otherwise leaves a day she was actually home
carrying another climate's temperatures, which is the r19 rule (a correction
outliving the answer that justified it) and poisons season bands downstream.
Same revert-then-correct order `removeWhereEntry` already uses.

**LOCATIONS RENDER FOR ANY TRIP, not just a fully dated one.** The section was
gated on `start_date && end_date`, so a trip missing an end date hid the only ×
that removes a location — *"I need to be able to remove locations the app has
identified"*. The weather half now says it needs dates instead of vanishing.

⚠️ **TWO PROCESS LESSONS, both already in this file and both repeated.**
① **`.cap-actions` overflowed the phone sideways** with its 5th button — a
no-wrap flex row, and flex items don't shrink below their content. Green tests
said nothing; **measuring the rendered row did**. It now wraps
(`flex: 1 1 88px`). ② **The "everything forced survives" case was VACUOUS** on
first write — it passed under a mutation that dropped forced pieces, because the
plain fixture never has to displace anything. It now loads the recent window
deliberately. **Its own mutation check is the only reason that was caught.**

**2026-08-04 r2 — REVIEWING r1 ANTAGONISTICALLY, AFTER "I JUST REFRESHED AFTER
THE UPDATE AND IT STILL HAS LOTS OF HEELS???"** She was right and r1 was mostly
not applied. Selftest 308 → **316**, run green; all 8 new cases mutation-checked
red in the same session. **Four defects, and the biggest was not the rack.**

⚠️ **① THE STORED RACK HAD NO IDEA THE DERIVATION COULD CHANGE.** `rackIsStale`
asks four questions and none of them can see that the CODE that built the stored
rack is not the code now running — so r1's ceiling **never ran once**, and would
not have for up to seven days. **Every deploy touching `buildRack` silently
shipped nothing until the cadence caught up.** **`RACK_ALGO`** (stored as
`st.algo`) fixes it; bump it whenever buildRack's SELECTION changes (quotas,
bands, shares, ceilings, ordering) and **not** for copy or a new reader.
⚠️ It is a **STRUCTURAL** trigger — tops up coverage, must NOT spend a rotation
tick or move `built`, exactly like a season flip (the r7 churn lesson).
**The general rule: derived state cached across deploys needs a version stamp,
or a shipped fix is invisible until something unrelated invalidates it.**

⚠️ **② THE BACKFILL HANDED THE SKIPPED HEELS STRAIGHT BACK.** r1 let the backfill
ignore the ceiling ("full beats correct"). Harmless on the synthetic fixture,
where every slot had everyday spares; **on a real wardrobe it is the common
case** — most shoes she hasn't worn in 60 days ARE the dressy ones, so the
ceiling took 1, the slot came up short, and the backfill put the rest back. A
mutation run reproduced her exact report: **4 dressy-only pairs in the
rediscovery bands.** The ceiling binds the backfill too and **a slot may now run
SHORT** — 54 that reflects her week beats 58 padded with clothes for days she
doesn't have. Level coverage is unaffected: the formality top-up is exempt and
runs after.

⚠️ **③ THE SUGGESTER NEVER ENFORCED ITS OWN DOCUMENTED COHESION RULE — the
biggest find, and nothing to do with the rack.** "An outfit is valid at level L
iff every piece's set contains L" has been in the design model from the start and
was **only ever applied through the `targetLevel` POOL filter**. With no level
asked for — the DEFAULT — there was no cohesion floor at all: a `[6,8]` heel
could join a `[2,3]` tee and `[3,4]` jeans, three pieces with **no level in
common**. `formalityOk` sounds like it covers this and does not; it isolates
pure-utility and nothing else. `scoreCombo`'s versatility bonus merely declined
to *reward* it — ~2 points against a spread of 2.5–5.5, so it lost a coin-flip
rather than the argument. **Measured: 53 of 96 suggestions paired heels with a
tee.** **`comboSharesALevel`** is that sentence as a function, enforced in all
three combo loops **and in `swapSuggestionPiece` / `addSuggestionLayer`** — an
invariant the engine holds and the edit paths don't is one she can walk out of.
- ⚠️ Unknown beats invented (no derivable set never blocks); all-function-wear is
  exempt (level 1 answers to the TAG — re-checking sets here is the r12 bug).
- ⚠️ **No-op when `targetLevel` is set**, so the pack solver is untouched
  (`packCandidates` always passes `occ.level`).

⚠️ **④ AND FIXING ①–③ REINTRODUCED THE 2026-07-19 EMPTY-SHEET BUG — found by
MEASURING, not by reading.** Keeping rare-day clothes off the rack means tapping
"6. Dressed Up" out of the blue hit `targetLevel`'s HARD filter against a rack
with no heels: on a realistic 216-piece closet, **level 3 gave 8 results and
level 6 gave 0**. **`poolCoversLevel(lv, pool)`** ("can this pool BUILD at this
level" — shoes plus a dress or a top and a bottom, not "owns something dressy")
+ a rescue in `planningPool` that widens to the whole closet, with the pool chip
naming the level that forced it. Rescue-only; it never narrows.

**ALSO: "worth a second look" was about taps, not weeks.** Her words: *"I may
often hit refresh on the rack."* Every "Rebuild now" is a rotation, so it
increments `seen` for all ~26 offered pieces — correct as a QUEUE CURSOR, nonsense
as a MEASURE: three taps in one evening would fill the list with pieces she never
got the chance to decline. **`seenAt`** records the first offer and
**`RACK_SECOND_LOOK_DAYS`(14)** is required alongside the count. This is the r7
"counter that is both measure and mechanism" lesson arriving through **the one
trigger r7 deliberately exempted** — check the exemptions too.

⚠️ **THE FIXTURE LESSON, TWICE IN TWO ROUNDS.** r1's ceiling test passed against
a fixture where every slot had plenty of everyday spares, so it never exercised
the backfill path that was the real bug; and the r2 rescue test first passed
against `withRackCloset`, whose every-tenth-item dressy seeding puts a level-6
piece in ROTATION so that rack CAN dress 6. **A fixture that is tidier than her
closet tests the code you meant to write, not the code she runs.** Both cases now
carry an explicit guard clause that fails loudly if the fixture drifts back.

**2026-08-04 r1 — SIX REPORTS FROM USING r7.** Selftest 297 → **308**, run
green; all 11 new cases mutation-checked red in the same session.

⚠️ **THE RACK WAS FULL OF HEELS, AND THE CAUSE WAS STRUCTURAL.** Her report:
*"quite a lot of heels in the current rack, given that I don't dress up that
often — one from steady and three in haven't reached for lately."* The steady and
dormant queues are ordered least-offered-first then longest-unworn, and a piece
that only covers Dressed Up and Formal is **by construction always the most
overdue** — so the rediscovery half of every slot silts up with clothes there is
no upcoming day for. **`RACK_OFFLEVEL_SHARE`(0.2)** caps how many steady+dormant
picks per slot cover NONE of `rackNeededLevels()` (Tops 2, everything else 1).
- ⚠️ **Rotation is exempt** — if she wore heels last week they belong in play —
  and so is the formality top-up, which only ever adds on-level pieces.
- ⚠️ **Never zero** (`Math.max(1, …)`): rediscovering a dressy piece stays
  possible, it just can't take the whole band. And **declaring a level lifts the
  ceiling for it at once**, because `rackNeededLevels` already unions forward day
  plans with her habitual levels — no special case, and pinned by a test.
- ⚠️ **The backfill ignores the ceiling but is ORDERED by it.** A slot that can't
  fill any other way should be full rather than correct; without the reordering
  the skipped heels came straight back through that door.
- ⚠️ **THE FIRST VERSION OF THE TEST COMPUTED ITS CEILING FROM
  `RACK_OFFLEVEL_SHARE`** — so it passed with the ceiling switched off. Caught
  during its own mutation check. **Ceilings are literals now**, same as the
  cold-share test's hard 0.13–0.30 window.

⚠️ **THE SUGGESTER WASN'T SKIPPING DRESSES — IT NEVER SAW THEM.** Her report:
*"outfit suggester doesn't seem to like suggesting dresses."* Two independent
causes, both structural:
- **Enumeration arity.** The dress loop is `dresses × shoes × 3`; the two-piece
  loop is `tops × bottoms × shoes × 3`. On a 58-piece rack that's ~200 against
  ~5,000, and the candidate list is cut to `uniqueCap` **by score** before
  sampling — measured **7%** of enumerated combos, and a mutation run produced
  **0 dresses in 160 suggestions**. Fixed by **silhouette parity**: a dress
  REPLACES a top and a bottom, so the honest target is `dresses/(dresses+tops)`,
  and the two score-ordered queues are **interleaved** to it.
  ⚠️ Interleave, not concatenate-and-re-sort — `pool2` is seed-first then score,
  and re-sorting drops the seed guarantee. ⚠️ Sizes come from the new `slotSize`
  map (**pre-sample**); both slots cap at 12, which would call 40 dresses and 200
  tops an even split. ⚠️ `opts.all` (the pack solver) takes the plain cut —
  parity is about what gets OFFERED, not what exists.
- **`scoreCombo` paid for piece count.** `aff` summed over PAIRS (six for a
  four-piece look, one for dress+shoes) and the variety salt summed over PIECES.
  Both are **averages** now; the affinity term's 0–3 range is unchanged, so
  `PACK_SCORE_W` needs no re-measuring.
- **Measured after (58-piece rack, 6 dresses / 20 tops): ~23% of candidates,
  ~37% of what's shown.** The gap is the softmax preferring them on merit — a
  two-piece look has fewer chances to trip the loud-colour and pattern penalties
  — and is deliberately left alone. Those are the numbers to re-measure against.

**ONE DRESSING ORDER, TWO CALLERS.** Her report: *"outfit suggester buttons
layout doesn't match the layout of the images."* The canvas sorted its pieces and
the lock/swap chips rendered raw combo order, so on a four-piece look the second
picture was the layer while the second button said "Bottom". **`suggestionPieceOrder`**
is extracted and both use it. ⚠️ `suggestionLayout` also **no longer indexes past
the end of its four-piece grid** — a saved look can hold more pieces than a combo
ever will, and it threw; 5+ falls back to rows of three.

**A CHANGELOG THAT GOES BACK (her ask: "the most recent few changes should be
listed, or a new page with all the app updates so I can always see them").**
**`RELEASE_NOTES`** in `js/01-config.js` — every release, newest first —
plus `openChangelogSheet()` and a Settings card. ⚠️ **`WHATS_NEW` is DERIVED from
`RELEASE_NOTES[0].notes`**, not maintained beside it: the post-update toast and
the changelog can't disagree, and the deploy skill has one thing to prepend. A
case pins that the head's `v` equals `APP_VERSION`.

**THE HAMPER SORTS BY LOAD, AND BOTH WAYS IN OPEN THE SHEET.** Her words: *"I
need the ability to select which load from the hamper screen. Not just 'wash
these' — open up a whole thing, set the date, which colors, etc."*
- `hamperLoad` + `hamperViewList()` — load chips off the same `LAUNDRY_LOADS`
  mapping the sheet uses, plus an **"Other colours"** bucket so nothing is
  unreachable. Session-only and reset on entry; `siblingItems` reads the same
  list so swiping stays inside the load; the title reads **"8 of 22"** when
  filtered.
- `openLaundrySheet` gained **`preLoad` / `preIds`**. ⚠️ They pre-select, they
  never decide — the sheet still owns the date, because everything below it
  depends on that (the r2 fix).
- ⚠️ **`bulkMarkWashed` no longer stamps.** Select → ✓ used to write
  `stampWash(ids, todayStr())`, i.e. the one assumption r2 proved wrong. It opens
  the sheet with her picks ticked and **their load chips lit** — selected-but-
  hidden otherwise, since the grids only render pieces whose chip is on.

**LOOKS WITHOUT AN ARRANGEMENT (her ask: "want the option to set a look layout to
default rather than collage").** Two halves, deliberately:
`LOOK_FALLBACK_KEY` + `lookFallbackMode()`/`lookFallbackLayout()` is a
**presentation-only, store-backed** lens over every layout-less look (Settings →
Appearance), and `applyDefaultLayout(id)` on a look's Details page **writes**
`outfits.layout` so that one look becomes editable in the builder. ⚠️ A saved
arrangement always wins over both.

⚠️ **FOUR THINGS WERE ONLY FOUND BY RENDERING THE SCREENS** — the Settings
what's-new blurb running to six lines of muted text, the changelog intro clipped
under the sheet header, a four-line hamper explainer, and "Hamper · 22" printed
over a grid of 8. Green tests said nothing about any of them.

**2026-08-03 r7 — THE WARDROBE HALF, AND THE RACK CHURN I CAUSED.**

**"WOULD THERE BE PROBLEMS" HAS TWO HALVES (r7).** Her correction: *"that's
great — but also I meant more, gaps in my wardrobe etc."* r6 answered only the
DATA question. **`deleteGaps(id)`** answers the wardrobe one by running
`buildThinSpots` **twice** — the whole closet, then the closet minus this piece —
and diffing. ⚠️ Reuse, not a parallel derivation: it can't drift from the
"What's missing" page, which is already the app's answer to "where am I thin".
⚠️ **Only a piece that moves a context's BINDING slot is reported** (twelve tops
don't help if one pair of shoes covers the level), or every deletion looks
alarming. Plus a **stand-in count** — same slot, covers every level this one
covers, overlapping season; deliberately strict, since a piece covering FEWER
levels is not a replacement. `_thinBaseMemo` is scoped to ONE render pass
(callers null it), because a stamp on `items.length` can't see a formality edit.

⚠️ **THE RACK WAS CHURNING, AND IT WAS MY DOING (r7).** Her report: *"I feel
like the rack has updated a bunch just tonight — why would that have happened?"*
`seen` is the **ORDERING** of steady + dormant, so incrementing it reshuffles 26
of the 58 slots. That is right at the weekly cadence she was promised. But r1
made `rackEnsure` run at boot AND on every suggester open, and r6 made a newly
declared level mark the rack stale AND had `saveDayPlan` call it — so rebuilds
went from "only if she opens the rack screen" to several an evening, and **every
one of them spent a rotation tick.** Two deploys plus a week-planning session
churned it repeatedly.
- **`rackShouldRotate(st, today, force)`** splits the two ideas. Only the 7-day
  cadence — or her own "Rebuild now" — advances the queue and moves the `built`
  anchor. **Structural rebuilds (a new level, a season flip, a stored-format
  migration) top up COVERAGE and leave the picks alone.**
- ⚠️ `built` is the cadence anchor and must NOT move on a structural rebuild, or
  an unrelated trigger postpones the next real rotation by up to a week.
  **`revised`** records the top-up for the screen, and is in `rackStamp()` so the
  memo still invalidates.
- **The general lesson:** when one counter is both a MEASURE ("how often has she
  been offered this") and a MECHANISM (the queue order), anything that advances
  it for a technical reason corrupts the measure. Check what else can fire it.

⚠️ **TWO OF THE FIRST TEST ATTEMPTS HERE WERE WRONG, NOT THE CODE** — worth
knowing because both are documented traps: an async case wrapped in the
**synchronous** `withRackCloset` (its `finally` restores state before the body
finishes), two `ta` cases stubbing `rest` concurrently (they observe each
other), and a "doesn't rotate" assertion that compared a rotated state against
an unrotated one. Rewritten around a pure decision function, which is also how
the rule got a name.

**2026-08-03 r6 — FIVE MORE.**

⚠️ **THE MONTH-REVIEW OVERLAP WAS THE DOCUMENTED `.cthumb` TRAP, REPEATED.**
`.cthumb` is a **FIXED 64px**, so wrapping it in a 42px span doesn't shrink it —
it overflows onto the text beside it. This is already in Known gotchas from
2026-07-21 (`_planThumbStrip`) and r5 did it again in **three** places (month
review 42px, wear panel 58px, rack second-look 46px). There is now a real
**`.sthumb`** class (44px, its own empty state, in the dark-mode filter list).
**Never size a thumb by its container.**

**FLAG FOR REVIEW (r6).** Her ask: *"something to flag an item for potential
deletion? with maybe a note from me — doesn't change anything but adds to a list
for review in stats. And the app could tell me — would there be any problems if I
delete this?"* `kv "flagged"` = `{id: {at, note}}`; `isFlagged`/`flagNote`/
`setFlag`/`clearFlag`/`flaggedItems`, `flagLineHtml` on the item photo view,
`openFlagSheet`, and `statsView "flagged"` + a Clothing Stats row.
- ⚠️ **"DOESN'T CHANGE ANYTHING" IS THE CONTRACT.** A flag is a bookmark, never a
  state: it must not reach the rack, the suggester, laundry or any stats pool. A
  case pins that flagging alters neither the rack nor `_suggPool`. If a later
  round wants to demote flagged pieces in the suggester, that breaks the promise
  this shipped under.
- ⚠️ **`deleteImpact(id)` — and the answer is worse than the app ever admitted.**
  `wears.item_id` is `references items(id) ON DELETE CASCADE`, so deleting a
  piece **permanently deletes every wear ever logged for it**, blanks any
  calendar day where it was the only thing worn, and drops 2-piece looks below
  the minimum the app enforces elsewhere. `deleteItem`'s confirm said only "this
  cannot be undone". It now names the numbers, and both surfaces point at
  **Storage**, which keeps all of it.
- ⚠️ **Never a recommendation.** Same tone rule as "worth a second look" and
  "packed 3×, worn 0×": she flags, the app reports consequences, she decides.

**FILTER BY RACK, EVERYWHERE (r6).** Her ask, verbatim: *"should be able to
filter by rack in all places filters exist."* A `rack` dim on the shared
`FILTERS` array, so every funnel inherits it: On the rack · In rotation · Steady
· Dormant · Off the rack. ⚠️ For LOOKS it is **ALL-pieces** (like status and
capsule) — an ANY-piece reading matches nearly every look, i.e. no filter at all.
⚠️ Adding a dim means four places: `FILTERS`, `newFilterState`, `hasActiveFilter`
and `filterActiveCount`.

⚠️ **A NEWLY DECLARED LEVEL NOW REBUILDS THE RACK AT ONCE (r6).** Her question:
*"if I add a context not included in the rack, will the rack automatically
expand/revise itself right then?"* **It did not.** `rackNeededLevels` reads
forward day plans, but nothing marked the rack STALE when she added one, so a
Wedding planned on Monday could wait until Sunday's scheduled rebuild — and
`targetLevel` is a HARD filter, so asking for that level meanwhile returned an
**empty sheet**. The rack now stores the `levels` it was built for, `rackIsStale`
compares them against `rackNeededLevels()`, and `saveDayPlan` calls `rackEnsure`.
⚠️ **Losing a level deliberately does NOT rebuild** — that would churn the rack
for no gain, and stability is the feature.

**NO MORE WASH ORDERS (r6).** Her words: *"I don't like the app telling me to
wash x."* The trip row and the week-planner cards now state what the PLAN does
("Your plan has the white tee out again Thursday — that's past its wears since
the last wash") and stop. Same rule as "packed 3×, worn 0×" being a fact, never
advice. ⚠️ Note this is the SECOND round on that trip row; the first only
reworded the instruction rather than removing it.

**2026-08-03 r5 — FOUR REPORTS FROM USING r1–r4.**

⚠️ **PLANNING AHEAD NOW KNOWS THE LAUNDRY — the tank-top bug.** Her report: she
planned a tank top for one day and the app kept suggesting it for the NEXT.
`suggestibleClean()` reads TODAY's state, so planning ahead recommended pieces
the app already knew would be in the hamper by then. **r4 deliberately made the
week planner WARN rather than filter, and that was right for the planner's own
cards and wrong for suggestions.** "Clean only" now means clean ON THE DAY she's
dressing (**`plannedDirtyBy(date)`** + **`_suggPlanDate()`** + **`_suggCleanArg()`**),
and the chip reads **"Clean on Thu · N out"** so the narrowing stays named and
one tap from widening. Applies to the day-plan suggester AND the Tomorrow card.
- ⚠️ **TWO THRESHOLDS, and conflating them is the easy mistake** (made once
  here). `weekLaundryForecast`'s `byDate` flags **`n > tol`** — "wearing it that
  day means wearing something dirty". Whether a piece is **IN THE HAMPER** by a
  date is **`n >= tol`**, the `isDirty` test. Reading the planner's overflow flag
  for the filter missed exactly the tank-top case. `endCounts` is now returned so
  both questions come off ONE schedule walk.
- ⚠️ The forecast only walks pieces that appear in a PLAN, so **anything already
  in the hamper must be unioned in separately** or a dirty shirt reads as clean
  purely because she hasn't planned it.
- ⚠️ When a plan date is in play `_suggPool` owns laundry entirely and the
  engine's own `cleanOnly` is passed FALSE — the date-aware filter subsumes it,
  and layering today's on top would exclude a piece a planned wash will clean.

**THE WEAR PANEL GOT ROOM (r3 → r5).** Her report: *"make the wear screen have
bigger space so things don't overlap and you can have more stats."* It was a
44px thumb and three lines crammed on one row, so a long item name collided with
the numbers. Now a **card per piece**: name on its own line, cost per wear big,
and the facts as a **wrapping chip row** that can grow without ever overlapping.
New facts: time since last wear, **her usual gap** (`avgGap`, needs 3 prior
wear-days like `wearRhythm`), wears per month, wears this year, and the under-$1
crossing.

**MONTH REVIEW (r5).** Her ask: *"how did cost per wear change for key pieces in
the month? what got worn most? think creatively… and make it reviewable for past
months too."* `statsView "month"` + **`buildMonthReview(ym)`** + month chips.
Leads with the question she asked (**before → after per piece, biggest movers
first**), then most worn, the look she kept returning to, **back from the deep**
(`MONTH_REDISCOVER_DAYS` 90), first outings, a formality-mix bar, and odds and
ends (colour of the month in PIECE-DAYS, temperature range, priciest outing, vs
last month). ⚠️ **It takes `ym`, never "this month"** — browsing past months is
the same code path, so a live-month derivation can't drift from the archive one.
Whole-wardrobe page → **no pool AND `hideFilter=true`**, per the funnel rule.

**THE TRIP WASH ROW SAID NOTHING USEFUL (r5).** Her report: *"the packing thing —
wash x item for rest of trip — what was that? seeing it on the trip made no sense
to me."* `packMidTripWash`'s row read "Wash 3 pieces for the rest of the trip ·
white tee, jeans…" — it named neither the DAY nor the consequence, and tapping it
opened the mark-as-washed FORM, so a heads-up read as a chore. Now: *"Your plan
wears the white tee again Thursday, but it's out of clean wears."* The derivation
is unchanged; only the copy and the sub-line were wrong.

**2026-08-03 r1–r4 — FIVE ASKS, SHIPPED. Read `RACK.md` (repo root) before
touching the rack; it carries the reasoning, the rejected alternatives and the
conversation these came out of.** Selftest 249 → **278**, run green; every new
case mutation-checked red in the same session.

⚠️ **THE RACK NOW HAS THREE BANDS AND A ROTATION COUNTER (r1).** Her question —
*"what about pieces that are moderately worn? Not warm or cold?"* — named the
biggest hole in it. The split was binary at `RACK_WARM_DAYS`(60) and the warm
side was then CUT TO QUOTA, so a top worn five weeks ago was both too old to
survive the cut and too recent to be eligible for the cold list; it reached the
rack only by accident, and when it aged past 60 days it joined the back of the
cold queue and stayed invisible. Bands are now **rotation / steady / dormant**
(`RACK_SLOT_QUOTA` is a banded object; a plain number still works and splits by
the shares, which is how `PACK_TRIP_QUOTA` keeps working). Rack grew **46 → 58**
at her request, extra weight to steady + dormant.
- ⚠️ **ROTATION IS THE ORDERING.** The cold band sorted by all-time `wearCount`
  among pieces untouched 60+ days — both inputs near-static, so the SAME NINE
  PIECES came back every rebuild forever against a cold pool of hundreds. The
  anti-calcification mechanism had itself calcified. `seen[id]` counts rebuilds
  offered-and-not-worn; steady + dormant are least-offered-first queues, cleared
  when she wears the piece. **Rotation (32 of 58) still ranks by recency and does
  NOT move** — that's what keeps the rack recognisable.
- **"Worth a second look"** = the same counter read as a question, past
  `RACK_SEEN_LIMIT`(3). ⚠️ **It states a fact and never guesses why** (r19): four
  answers SHE picks — wrong formality, wrong season, not right now
  (`RACK_PUSH_LONG_DAYS`), moved on → Storage. **Never a "get rid of this", never
  a purchase.**
- ⚠️ **THE LIKED BONUS WAS A BAND-DECIDER.** `score()` was
  `warmth + (liked ? .15 : 0)` split at `> 0`, so a hearted piece unworn 60+ days
  scored .15 → warm list, ranked below everything worn in ~51 days, AND excluded
  from cold. **Her hearted-but-neglected pieces were the ones shut out of
  rediscovery.** Liked is now a tiebreak WITHIN a band.
- ⚠️ **`rackEnsure()` RAN IN TWO PLACES** — the closet's rack row and "Rebuild
  now" — while every consumer read `rackEffective()`, which checks nothing. The
  7-day cadence and the season-flip guard only ran if she visited the SCREEN.
  Now also at boot and on suggester open.
- **`rackBandOf(id)` / `rackPassedOver()` / `rackQuotaTotal(q)`** are the new
  readers; `pushed` values may be a bare date string (legacy) or `{d, n}`.

**CONTEXTS × FORMALITY (r1).** Her question: *"if I say I need an outfit for x
context, in which I have worn different formality levels, what happens?"* It took
the mode, set it as `targetLevel` — a HARD filter — and discarded the rest.
- ⚠️ **`contextFormalityLevel` COUNTED WEAR ROWS.** A 6-piece outfit cast six
  votes and a 2-piece outfit two, so the mode could name a level she'd dressed
  for on FEWER days; and *"min 3 to trust"* was 3 ROWS, i.e. one three-piece
  outfit worn once, permanently overriding the seed. This is the 2026-07-24
  "a wear is a DAY" audit — `contextFormalityStats` was fixed then and **this
  function was missed**, so the Contexts stats page and the suggester could
  disagree about the same context. Now counts OCCASIONS (distinct day+level).
- **`contextLevelDays` / `contextLevelSpread` / `CONTEXT_LEVEL_MIN_OCCASIONS`(3)**
  are the new shape; `suggestContextSpreadHtml()` renders the levels she's
  actually worn for that context, mode preselected, **only when the history
  disagrees with itself**. Picking one KEEPS the context selected.

**TOMORROW FROM THE RACK (r1).** `tomorrowGenPieces` passed `pool = null` and
`suggestOutfits` reads null as the whole Available closet — **the one surface
that shows an outfit unasked had never used the rack.** New **`planningPool
({capsuleId, level, wholeCloset})`** owns the precedence and `_suggBasePool`
delegates to it, so the two can't drift. Level 1 and trips still bypass the rack.
⚠️ Picks already in `kv "tmpick"` are deliberately NOT invalidated — a sticky
pick she liked survives; the ✨ re-roll moves it onto the rack.

**LAUNDRY: THE DATE LEADS (r2).** Her words: *"I often will go back the next day
and say things were washed — and like, today's clothes might not be included in
that, even though they're now in the hamper."* The sheet showed TODAY's hamper
and stamped everything ticked with the chosen date, wrong in both directions: a
load chip swept in pieces that only got dirty AFTER the wash, and for a piece
worn both on the wash day and the day before, stamping it washed on the earlier
date **DELETED the earlier wear from its count** (`wearDatesSinceWash` keeps
`d > since`), quietly resetting a jean that was most of the way to the hamper.
**`isDirtyAsOf` / `isWornNotDirtyAsOf` / `laundryAsOfSplit`** partition what's in
play into *in this wash* · *also worn, not dirty yet* · **"Worn since then"** —
shown, unselected, untouched by the load chips. Changing the date clears the
loads and the selection. ⚠️ **`asOf >= today` short-circuits to the live
derivation**, so the ordinary same-day path is unchanged; a case pins that.

**THE WEAR SCREEN (r3).** Her ask: *"I want to see the change in cost per wear
for each item in a wear/look… a screen on that wear, maybe?"* — and she chose to
have it **replace the post-log sheet**. `js/22-wear-detail.js`; boot renumbered
to `23-boot.js`; index.html now has **24** cache-busted tags.
- ⚠️ **It IS the post-log sheet.** "Log what I wore" is a sacred two-tap flow, so
  `buildWearDelta` renders ABOVE the context chips with the same Skip/Save header
  and the same heart — same taps, plus a payoff. The identical block renders
  read-only from a calendar day card (`data-cal-wd`) and a look's wear list
  (`data-wd-date`, checked BEFORE `data-wear-date`).
- Per piece: **CPW before → after**, days out, the gap closed, wears-since-wash
  vs tolerance (and whether THIS wear tipped it into the hamper), rack band.
- ⚠️ **"before" is the day-set minus this DATE, not minus this ROW.** The only
  definition that also works when she opens a wear from last March, and the
  "a wear is a DAY" rule — a 5-piece look writes 5 rows for one outing.

**PLAN THE WEEK (r4).** Her ask: *"actually plan my week… set contexts, but then
the option to tap through and actually plan the looks, including the ability to
understand what is/will be in laundry."* Now a real screen (`tab-week` /
`renderWeekPlan`) instead of seven rows that punted to the day sheet: contexts
AND an outfit slot per day with ✨ Suggest / ＋ Look / ✎ Build inline, the weekday
rhythm as a muted starting point, and a 🧺 wash-day toggle.
- ⚠️ **SCHEDULE, DON'T DIVIDE**, at home now. `weekLaundryForecast` walks the
  seven days in DATE ORDER with a running counter **seeded from real wear-days
  since `last_washed`** (a jean at 4 of 5 on Monday is one wear from the hamper
  all week — `planRewearFlags` fixed this exact bug once already). That's what
  lets it name a DAY. A lived day counts what she actually WORE unioned with the
  plan, so a fulfilled plan isn't double-counted.
- ⚠️ **A piece is reported only on the day it FIRST runs out** — once over
  tolerance it stays over, so flagging it every remaining day restated one fact
  with a bigger number. A wash day clears the flag set with the counters.
- ⚠️ **IT WARNS, IT DOES NOT FILTER.** Thursday's suggestions still draw from the
  normal pool. Silently removing pieces is the invisible-narrowing mistake, and
  she asked to UNDERSTAND the laundry, not to have it hidden.
- Wash days live in **`kv "washdays"`** — zero new columns, and deliberately NOT
  a sentinel inside `dayplan`, which every other consumer iterates.
- ⚠️ Both r4 defects were found by **RENDERING THE SCREEN AND READING IT**, not
  by the tests (the repeated flag, and a header calling today "Mon, Aug 3" while
  the card said "Today").

⚠️ **A RED TEST SAT ON `main` UNNOTICED** (fixed r1). The lean-vs-cushion pack
case passed `{context, per}` where `packSlate` reads `{ctx, n}` — left behind by
the 2026-07-30 r5 flat-list rework — so it had been solving a degenerate slate
where K couldn't bite. **Check the suite is green before starting, not only
after**; a failing assertion still looks like a test doing its job.

**THE RACK (2026-07-26, r6 + r7) — SHIPPED; REWORKED 2026-08-03 r1 (see the
entry above and `RACK.md`).** `js/20-rack.js`. A standing derived
pool — "what's in play right now" — that the suggester draws from by default.
It exists because the suggester is good in a capsule and a slot machine over 476
items: the fix was the POOL, not the algorithm.

- **`buildRack({pool, wearRows, today, season, wx, plans, pinned, pushed, quota, seen})`** is
  injectable and deterministic — same inputs, same rack — because **stability is
  the feature**; a rack that reshuffles every open is a random sample with extra
  steps. Stratified, NOT a top-N: `RACK_SLOT_QUOTA` (Tops 16 · Bottoms 11 ·
  Dresses 5 · Shoes 9 · Outerwear 5), because a 60-piece rack that happens to be
  45 tops cannot build an outfit.
- ⚠️ **`RACK_COLD_SHARE` (20% of every slot — the DORMANT band) is LOAD-BEARING,
  not a nicety.**
  Without it the rack calcifies — worn → on the rack → suggested → worn — and
  over five years shrinks her working wardrobe, i.e. the mirror would cause the
  thing it measures. It's also the nicest part, and a selftest case goes red if
  it's relaxed — verified by zeroing it. **Do not "optimise" it away.**
  ⚠️ **This used to claim "the rack screen leads with 'N you haven't reached for
  lately'". It does not and never did** — the order is hardcoded rotation →
  steady → dormant, putting that band at y=2,581 of a 3,230px page (measured
  2026-08-16). Corrected rather than deleted, because the claim was load-bearing
  in the argument for keeping the band.
- **`rackNeededLevels()` reads FORWARD `dayplan` contexts** (her ask: "can set
  events for future so the rack knows"), with her habitual levels as the floor.
  ⚠️ Load-bearing too: `targetLevel` is a HARD filter in `suggestOutfits`, so a
  rack that can't cover a declared level returns an **empty sheet** — the
  2026-07-19 capsule bug arriving via a smaller pool instead of a smaller capsule.
- **Laundry is deliberately ignored here.** Dirty pieces falling off would churn
  the rack daily and stop it being recognisable; the suggester's own `cleanOnly`
  still applies on top.
- **Nudges, never upkeep:** `pullOntoRack` / `pushOffRack` from any item photo
  view. Pins persist; **push-outs EXPIRE after `RACK_PUSH_DAYS` (42)** so a
  summer "not now" can't haunt October. She said she wouldn't reliably curate but
  might sometimes — so the app keeps it and she nudges it.
- ⚠️ **WORKOUT NEVER USES THE RACK** (r12, reported the day the rack shipped:
  *"if i want to go on a run, that doesn't build"*). `buildRack` excludes the
  Workout category deliberately — her words, *"those clothes don't really mix
  with the rest of my clothing"* — so filtering the rack by `isWorkoutGear` left
  only gear-tagged pieces living OUTSIDE that category (running shoes), i.e. a
  pool that can never form an outfit. Worse than empty, because it looked like a
  partial result. `_suggBasePool()` now owns the precedence and gear comes from
  the whole closet. **There is deliberately no second "workout rack"** — a rack
  exists to shrink 476 pieces to ~46 and the gear set is already small, so one
  would add a concept and shrink nothing.
- **Pool precedence (audit M2):** during a trip the **suitcase IS the rack**.
  They never compose — the intersection could be four items. `openSuggestSheet`
  sets `capsuleId` from `tripModeId`, so the capsule branch wins in `_suggPool()`
  and the rack chip hides. Pinned by a test.
- **`_sugg.wholeCloset`** is the widen; session-only, resets every open, so the
  app never quietly stays narrowed OR quietly stays wide.
  `suggestPoolChipHtml()` always names the pool and its count.
- ⚠️ **Locking or seeding an off-rack piece must never fail.** Holds by
  construction (`slot()` returns locked pieces directly; the seed is unshifted
  after filtering) and is pinned by two tests. This is the line between a tool
  and a cage.
- **"Vary this" opens on the whole closet** on purpose — it works from one saved
  outfit, not from "what's in play".
- Surfaces: closet-root row (always visible, `data-rack`) → `renderClosetRack`
  (`closetRack` flag, same shape as Worn/Hamper — ⚠️ **every shelf flag must be
  cleared together** in `switchTab`, `closetBack`, `clRootJump` and each shelf
  handler, or two shelves fight) · the pool chip in the suggester · the pull/push
  line on the item photo view.

**Round D "Where You Were" (2026-07-25, r14 → r21) — SHIPPED, and then largely
UNBUILT again. Read this whole entry before touching weather/season code; the
deletions are the most important part.** Selftest 91 → 136 → **124** (the drop
is deliberate). Every round was browser-run green.

**The arc, honestly:** r14 shipped her ask (log where I was + flag
season/weather contradictions) PLUS a third thing she never asked for — an
engine that GUESSED where she'd been from outfit anomalies. r15–r18 were four
same-day patch rounds, each fixing a real flaw in that guessing layer
(own-spread bars, span+density clustering, null-day hygiene, signal
separation, no-proposal-no-flag). Then she said: *"this whole feature set
feels like a mess."* It was, and the diagnosis was specific — every bug she
hit was in the guessing layer or its UI; the parts she'd actually asked for
had needed zero patches. **r19 deleted the guessing layer wholesale.**
⚠️ **Do not rebuild it "to help."** A wrong guess costs more trust than
hand-entry costs taps (locked, 2026-07-25). If a future round wants trip
detection, that is a product conversation, not an implementation detail.

**WHAT'S GONE (r19)** — `buildDayWxAnomalies`, `itemTempCenter`,
`_clusterAwayDays`, trip guesses, per-day anomalies, home marks
(`WXA_HOME_KEY`, `homeRanges`, `isMarkedHome`), `#wxAuditSheet` +
`openSeasonAuditSheet` + `openWxDaysView` + `openWxSeasonEdit`, the
health-check row, the calendar-kind flag, and 9 tuned constants. ⚠️ The kv key
`"wxaudit_home"` may still hold data on the live DB — it is an unread orphan,
deliberately not migrated.

**WHAT SURVIVES, and why it's the good part:**

① **WHERELOG (hand-entry, the only source of travel truth)** —
`kvData("wherelog")` = `[{from,to,name,lat,lon}]`, edited in Settings → "Where
you've been" (`openWhereSheet`/`_renderWhereSheet`/`_saveWhere`/
`removeWhereEntry`/`whereListHtml`, `js/18-weather.js`).
**`awayRanges(log?, caps?)`** (`js/06-home.js`) is the single reader: dated
trips' `locations` ∪ wherelog, wherelog last so it wins on overlap. ⚠️ A trip
with **several locations that all lack `from`/`to` yields NO ranges** —
unassignable. `awayRangeFor(date, ranges)` is the lookup.
② **LOCATION-TRUE WEATHER** — `mergeWxDays(log, fetched, {today, keepAfter,
away, loc, floor})` is pure and owns the merge. `backfillWxLog()` does a
second pass, one `fetchWeatherRange` per away range, merged `{away:1, loc}`.
⚠️ **An away merge ignores the 15-day forecast guard** — on a day she was
elsewhere the home reading is wrong however recent. `correctAwayWeather(r)`
does one new range; **`revertAwayWeather(r)`** (r19) is its mirror and is
mandatory on delete/undo — without it a correction outlives the answer that
justified it, leaving days stranded with another climate's temperatures. It
re-applies any surviving overlapping range afterwards.
③ **NULL-DAY HYGIENE (r17, load-bearing)** — Open-Meteo returns `null` for
days it has no reading and `Math.round(null)` is **0**, so archive gaps were
stored as hard freezes, poisoning bands + profiles + everything downstream at
once. `_wxDay(daily, i)` (`js/18-weather.js`) drops nulls at the source in all
three fetch zones; `isNullWxDay`/`purgeNullWxDays` clear stored artifacts on
backfill, and every derivation filters them. **Never write a weather entry
without this guard.**
④ **SEASON BANDS** — `seasonBands(log?)` → per season
`{p10,p25,median,p75,p90,n}` of maxT over **non-away** days;
`SEASON_BAND_MIN`(15) or null (consumers fall back to calendar). Memoized on
wxlog object identity (`_seasonBands`/`_seasonBandsFor`). ⚠️
**`SEASON_BAND_TRIM`(35°F) around the median is load-bearing** — untagged away
days sit in the log as home weather, and a warm-December fixture dragged
Winter p90 27°→84°, silently disarming the detector for exactly the days that
poisoned it.
⑤ **DERIVED SEASONS** — `effectiveSeasonOf(date, log?, bands?)`: an `away` day
counts as the home season its **temperature** resembles.
**`derivedSeasonSet(i, wearRows?, log?, bands?)`** (r20) derives from wear
history **ignoring any explicit tag** — that's what lets every item be asked
what its evidence says. Counts distinct **DAYS**, needs
`SEASON_DERIVE_MIN_DAYS`(3), keeps seasons ≥`SEASON_DERIVE_SHARE`(15%),
returns canonical `SEASONS` order so two answers compare by value.
`itemSeasonSet` keeps its contract (**explicit always wins**) and delegates
for the fallback.
⑥ **`similarDays` INCLUSION** — arg is `ranges` (was `trips`), takes
`awayRanges()` objects. A date is excluded only if it's in a range **and**
`log[date].away` is unset (known-away, uncorrectable). Corrected away days
flow through carrying `loc`, appended to the tile.
⑦ **THE ONE FLAG (r19, her criterion)** —
`buildSeasonWxFlags({pool,wearRows,log,bands,dismissed})` returns a **plain
array**. Per Available item with an explicit season and ≥`WX_PROFILE_MIN`(5)
weather-matched wear-days: `pieceCommonRange` = **[p25,p75]** of worn maxT;
each tagged season's general range = its band **[p10,p90]**.
⚠️ **Overlap with ANY tagged season → no flag, full stop.** This kills
unactionable flags *structurally* rather than by suppression, and needs no
tuned margins — two earlier margin constructions both got this wrong and she
reported both. Then `fit` = seasons whose general range overlaps
`pieceCommon`; `missing` = fit − claimed; **no missing → no flag**; `dir` =
hot/cold/between. Dismissals: `kv "wxaudit_ok"` =
`{itemId: JSON.stringify(items.season)}` so editing the season re-arms it.
`wxAuditFlags()` memoizes on a length-stamp; ⚠️ **that stamp cannot see an
in-place season edit**, so `_wxAudit` is nulled explicitly in `saveField`
(season), `correctAwayWeather`, `revertAwayWeather`, `addFlagSeason`,
`dismissWxFlag`.
⑧ **SURFACES (two, both where she already looks)** — the item **details** view
(beside "Usually worn"): one sentence + `＋ Add <season>` (`addFlagSeason`,
**appends, never replaces**) / `Edit season…` / `It's fine` (`dismissWxFlag`);
plus a "Worn like X" line under the Season row when it adds something. And
**Closet Review**: `season_check` row compares what she SET against what the
history shows, queueing only genuine disagreements. ⚠️ Its `guess` is the
**UNION** (`seasonCompareMerged`), never the derived set alone — accepting a
narrower derivation would silently delete a season she chose, and "worn like
Winter" means she hasn't worn it in summer *yet*. `REVIEW_FIELDS` gained an
optional **`saveKey`** so a row can edit a column it isn't named after.
⑨ **TEMPERATURE-ELIGIBLE SUGGESTIONS** — `inSeasonWx(i, season, wx)` +
`WXA_RESCUE_MARGIN`(5) in `js/12-looks.js`, used by `suggestOutfits`' slot
pool, `swapSuggestionPiece`, `addSuggestionLayer`. **Rescue-only: widens the
pool, never narrows it.** ⚠️ Still true of `inSeasonWx` itself, but NO LONGER
true of the suggester overall — the rack (2026-07-26 r7) narrows the default
pool. Approved knowingly; what makes it different from the December bug below is
that the rack is labelled, counted, and one tap from being widened. Fixes a real pre-existing flaw — a December trip
somewhere warm asked for "Winter" and filtered the sundress out *before*
scoring could see the 84° forecast.

⚠️ **SHEET STACKING (r19, cost her a day of "the button does nothing")** —
every sheet wrapper is `z-index: 301`, so **DOM ORDER in index.html decides
the stack**. `#whereSheet` sat *after* `#fieldSheet`, so "Edit season" opened
the field sheet UNDERNEATH it and looked completely dead. `#whereSheet` now
precedes `#fieldSheet`. **Any sheet that hosts a field edit must be declared
BEFORE `#fieldSheet`; keep `#fieldSheet` last among sheets.**


**Round C deferred list (2026-07-25, r9→r10) — SHIPPED.** The two items she'd
answered "yes, next round" to, built straight after Round C.
① **PALETTE** — `buildPaletteStats(pool?, wearRows?)` / `renderStatsPalettePage()` /
`statsView "palette"`; row in Looks Stats beside Closet vs Life. Share of pieces
OWNED per colour family vs share WORN, two stacked bars + a row per family sorted
by the gap, tapping into that colour's grid. ⚠️ **Unit is PIECE-DAYS** (each piece
once per day it went out) — the only unit comparable to a per-item closet share;
rows would double-count and wear-DAYS would flatter accent colours worn one piece
at a time. **Never call it "wears" in the UI.** Colourless pieces excluded from
both sides. Keeps its funnel (its pool IS `statsPool()`); links across to the
Colors report card, which answers a different question — Palette is about
**proportion** (is the mix you own the mix you wear), the report card is about
**per-piece performance**. They can disagree and both be right.
② **WHAT'S MISSING** — `buildThinSpots(pool?, wearRows?)` / `buildMileage(pool?)` /
`renderStatsMissingPage()` / `statsView "missing"`. **Thin spots:** per context over
`GAP_MIN_CTX_DAYS`(5), count level-covering Available pieces PER SLOT and report the
thinnest (`GAP_SLOT_FLOOR`=3); a context is only as served as its binding slot, and
dresses count toward Tops AND Bottoms. **Mileage:** `MILEAGE_MIN_DAYS`(25)+ wear-days
desc with age + $/wear — **explicitly not a wear-out prediction** (no durability
model exists; the note says so). Read-only: the before-you-buy manual-entry check
stays rejected. Uses the **full Available closet, not `statsPool()`**, and hides the
funnel to match (r11 fix). `contextFormalityLevel` gained an optional `wearRows` arg
so the new functions are genuinely injectable.

**Round C "Memory + Payback" (2026-07-25, r1→r8) — SHIPPED, all 9 steps.**
Reviewed and built the same day; one deploy per step. Selftest 52 → **80 cases,
written but NOT RUN** (no browser this session — run `migration/selftest.html`).

① **WEATHER MEMORY** — `kvData("wxlog")` had been written daily since 2026-07-20
and **read by nothing**. Now: `backfillWxLog()` reconstructs weather for the whole
wear history in ONE existing `fetchWeatherRange(lat,lon,start,end)` call (it already
splits the forecast window from the ERA5 archive); idempotent, and ERA5 **overwrites
entries older than 15 days** because those were forecasts when logged. Window
`WXLOG_DAYS` 400 → **1200**. `similarDays(wx, {contexts,limit,excludeDays,log,dayMap,
today,trips})` scores past wear-days `|Δmax| + 0.5|Δmin| + WX_WET_PENALTY(8)` on a
wet/dry mismatch, **cuts anything over `WX_SIM_CUT`(15)** (a bad match is worse than
none), drops the last 14 days and **all dated-trip days**, dedupes by look.
`wxMemoryRowHtml(wx, contexts, {compact})` + `wireWxMemory(root)` render the
"You've dressed for this before" strip in the **suggester** (above `#sgPreview`)
and the **Tomorrow card** (`compact:true`). `itemWxProfile(id)` → 10th/90th
percentile of maxT, needs `WX_PROFILE_MIN`(5) days, shows as "Usually worn 45°–62°"
on the item photo view. Entry: a one-time Home card (`WX_BACKFILL_KEY`,
`WX_SNOOZE_KEY`, gated on `wears.length > 100`) — **that card is the real entry
point**; the Settings "Weather history" card is only the re-run hatch.

② **MILESTONES** — `milestoneFor(rows)` returns at most one of six rungs, in order:
`first` · `paidoff` (crossed under $1/wear; gifts excluded) · `rescued`
(`MILESTONE_RESCUE_DAYS`=180) · `round` (`MILESTONE_ROUNDS` 10/25/50/100) ·
`completeset` (every Available pair of Shoes worn this year, 3+ pairs) · `streak`
(beats `kv "beststreak"`, min 5). **One per log, each key once ever** — seen-set in
`kv "milestones"`; the cap is deliberate and was built in from the start.
`logCelebration(rows, {defer})` computes + commits; `flushMilestone()` is drained by
`openPostLogSheet`'s `close()` so a toast never lands under an open sheet (it
replaces "Logged ✓" but **never** the Undo chip). `unmarkLastMilestone()` runs in
`undoLoggedWears` so a mis-tap can't permanently spend "first outing". Wired at all
five wear-create sites.

③ **WEEKLY RHYTHM** — `weeklyRhythm(wearRows?)` → `Map(dow → {contexts, n})`, up to
`RHYTHM_MAX_CTX`(2) above the existing `RHYTHM_MIN_DAYS`(3) floor; `rhythmFor(date,
rhythm?)`. `weekdayTopContext` now just reads it, so there's **one** derivation.
Week planner shows unplanned days' usual contexts muted+italic; `openDayPlanSheet`
names them and seeds the FIRST entry with them — **the tap is the acceptance,
nothing about the rhythm is ever auto-saved**. `weekRhythmBlockHtml()` = the "Your
week" strip in Looks Stats (`data-sa="looks:contexts"`); renders "" when no weekday
clears the floor. ⚠️ There is no `presetContexts` arg — the sheet derives it itself.

④ **HOME ATTENTION HIERARCHY** (unparked from 2026-07-19) — catch-up / laundry /
backup / weather-offer compete for **ONE** slot in that priority order; the rest
fold into a "N more things ›" line (`_homeAttnOpen`, session-only). In trip mode the
dash is the one thing, so all four fold. **The log CTA and the Tomorrow card are
deliberately NOT in the group** — they're the daily loop, not interruptions.

⑤ **CLOSET KEYWORD SEARCH** — it had been gone since the filter unification
(`openSearch()` is still just the funnel). `closetSearchQ` (null = not searching) +
`itemMatchesText(i, q)` (**multi-term AND** over `CLOSET_SEARCH_FIELDS` + tags) +
`closetSearchMatches(q)`. Magnifier `#clKeyword` in `clToolbar`, beside the funnel;
live results into `#clSearchResults`. **Scope is always the whole lens, never the
folder you're standing in** — search means search my closet, the funnel narrows.
Rides the surviving `searchResults` plumbing; `siblingItems()` walks the results and
`closetBack()` closes the search before unwinding the folder stack. The pickers'
`_capPickFilter` was repointed at the same matcher.

⑥ ~~**MENDING**~~ — ⚠️ **REMOVED 2026-07-26 r8.** Offered 12 features to cut she
kept 11 and dropped this one; the original entry's own reasoning ("she will never
run a mending audit") turned out to apply to the feature itself. Gone: `MEND_TAG`,
`isMending`, `setMending`, `mendLineHtml`, `_scopedMending`, `renderClosetMend`,
`closetMend` and the three suggester exclusions. ⚠️ The **`"mend"` tag may still
sit on items in the live DB** — an unread orphan, deliberately not migrated off,
so the data survives if it's ever wanted back. Nothing reads it, so a tagged piece
is suggestible again; a selftest case pins that this is harmless.

⑦ **YEAR IN PIXELS** — `statsView "pixels"` / `renderStatsPixelsPage()` /
`pixelDayLevels(year)` / `statsPixelsYear`. 53×7 `.pxgrid`, each day shaded by
derived formality as a 0.22→1.0 opacity ramp of `var(--accent)`; empty on
`var(--panel)`. Cells are a **fixed 11px** with sideways scroll — `1fr` columns
would be circular against the cells' own width. Pool is the whole year, so it uses
`statsToolbar(..., hideFilter=true)` like Rotation.

⑧ **ON THIS DAY on Home** — `onThisDayHtml(dateStr)` extracted from the calendar day
view and reused; renders "" without a prior year, and sits **below** the folding
group (delight, not attention).

⑨ **TAXONOMY RENAME GUARD** — `TAXONOMY_LOCKED_SUBCATS` =
`keys(WORKOUT_SLOTS) ∪ GEAR_CAND_SUBCATS`; renaming one now needs an explicit
confirm naming the consequence. **Doc correction: `LAUNDRY_LOADS` was never at
risk** — it's keyed on `color_family`, which the taxonomy editor never touches.

**"Rotation drill-in + wears-by-day" (2026-07-24 r1) — SHIPPED.** Two asks.
① **`countByDay(rows, keyFn)`** (beside `ctxArr`) + an app-wide audit enforcing
**a wear is a DAY, never a row** — see the Known gotchas entry, which is the
rule to read before adding any "N wears" number. Fixed: `wearCountInRange` /
`wearCountMapInRange` (the ranged branch counted raw rows, so the stats
Most/Least Worn and CPW lists double-counted inside any date range),
`contextWearCounts` / `contextTopItems` / `contextTopLooks` / `topContextsByWearCount`
/ `contextOptions` / `itemContexts` (**the worst of them — a 5-piece look stamped
"Church" counted as 5 outings**, so the Contexts page and every context-ordered
picker were inflated by pieces-per-outfit), `buildGapStats`, `buildWrappedStats`'
context shares, and `calMostWorn` (printed "N days" over a row count).
`contextFormalityStats` now averages one level per DAY (mean of that day's
pieces) so a 6-piece day can't outvote a 2-piece day. `buildWrappedStats`'
`totalWears` → `pieceDays` (it was item-days, not wears; unused in the UI).
Settings' data card says "N wear records" — a table size, deliberately not a
wear count. ② **Rotation drill-in**: the Stats "Rotation" bar is now tappable
(`.rot-open` → `statsView = "rotation"`, `renderStatsRotationPage`) — same 30d/90d/1y
window chips, plus a **Worn / Not worn** segmented toggle over the two sides of
the same number, each a real item grid (worn = freshest first with in-window
wear-days; not worn = coldest first, never-worn leading). `buildRotationStats`
now also returns `pool` / `wornIds` / `counts` so the page can't drift from the
headline. The page passes `statsToolbar(..., hideFilter=true)` — its denominator
is deliberately the **full Available closet, not `statsPool()`**, so a funnel
that silently changed nothing would lie. Selftest 52/52 (4 new).

**"Laundry Control" round (2026-07-22 r1) — SHIPPED.** Seven asks from one
message (planned by Fable, built by Sonnet same day). ① Fixed `planRewearFlags`
ignoring a real wash: it now skips planned days on/before `items.last_washed`,
not just the `PLAN_LAUNDRY` sentinel. ② Trip dash "N of M pieces in the hamper"
now opens the scoped hamper page (`closetHamper=true`) instead of jumping
straight to the wash sheet. ③ **Wash-load sheet reworked**: selection moved
from load-name Set (`_lnSel`) to an item-id Set (`_lnSelIds`); load chips
(`_lnActiveLoads`) are pre-selectors that reveal a tappable `itemGridView`
thumbnail grid of every hamper item in that load — "I need to see what is in
the load," not just trust the color mapping. A parallel "Also worn, not dirty
yet" section (`_lnWornPool`, honors `_lnPool`) offers worn-tray pieces of the
same color families, **pre-selected ON by default** (user decision — matches
"everything of that color went in"). ④ **Per-item tolerance override**: `tol:
<n>` sentinel tag (same pattern as `layer`/`no-suggest`), `tolTagValue()`/
`setWearToleranceOverride()`, checked first in `wearTolerance()`. Item photo
view: wash date is now tappable → `openFieldEdit(id, "last_washed")` (added
as a real `FIELD_CONFIGS` entry; `saveField` clears `laundry_state` on a
re-date, same as `stampWash`); dirty items get an explicit "Washed on…"
action; a `N/T wears since wash` line shows the count being overridden;
"Wears per wash: N ✎" opens `openTolEdit()` (routes the tag through the field
sheet via a custom `_fieldOnSave`, same trick as the Add form's
`openAddFieldEdit`). ⑤ Dark-mode PWA status bar fixed
(`apple-mobile-web-app-status-bar-style` → `black-translucent`) + manifest
`background_color`/`theme_color` → paper `#f8f4ee` (were still pre-redesign
white). ⑥ App icons regenerated from the inline SVG favicon (oxblood + hanger)
via `rsvg-convert`, `?v=2` cache-bust on both the apple-touch-icon link and
the manifest icon `src`s — **iOS bakes the icon at install time, tell her to
delete + re-add the home-screen app**. ⑦ Trip dash gained a **"✎ Build"** chip
beside "✨ Suggest" (`openBuilder(null, null, {capsuleId, date: PLAN_BUCKET})`
— same plumbing as the plan view's Build button). Selftest 48/48 (3 new: tag
override, tag edge cases, rewear-reset fixture).

## What this is

A personal, single-user wardrobe tracker. **Plain static files served straight
off GitHub Pages** — `index.html` + `css/styles.css` + `js/01…20-*.js`, loaded
by ordered `<script src>` tags. No build step, no framework, no bundler, no JS
libraries, no CDN scripts; what's committed is what runs. It talks to Supabase
using the **REST API and Storage API via plain `fetch`** — do **not** add
supabase-js or any library. If something seems to need a library, ask the user
first. (It was all one 16k-line `index.html` until 2026-07-25 r13; see
**File layout** below.)

## Hard constraints (do not break)

- **No build step, no framework, no bundler, no libraries, no CDN scripts.**
  What's in the repo is what runs. This is the constraint that actually
  matters — it survived the 2026-07-25 file split unchanged.
  ⚠️ **The "keep it one file" rule is GONE (2026-07-25, user decision).** It was
  never an intentional choice — it "just happened" and then got written down
  here as law. `index.html` is now 278 lines of markup pointing at
  `css/styles.css` + `js/01…20-*.js` via plain `<script src>` tags. Don't
  re-consolidate, and don't cite the old rule to refuse a new file.
- **No service worker, still** — offline caching is already handled by the
  snapshot + photo byte cache, and a SW would silently serve stale modules.
- Plain `fetch` only for all Supabase calls.
- Mobile-first; the user mostly uses this on a phone and takes photos with it.
- Only the publishable (anon) key ever appears in client code — it's safe to
  ship because RLS scopes everything to the signed-in user. The **secret key
  must never** be added or committed.

## File layout (since the 2026-07-25 r13 split)

`index.html` = `<head>` + body markup + ordered `<script src>` tags, ~278 lines.
Everything else moved out **untouched** — the split was cut-and-paste at the
existing `/* ==== */` section banners and verified byte-identical, so no logic,
naming or ordering changed. ~19,900 lines of JS across 23 files:

| file | lines | what's in it |
|---|---|---|
| `js/01-config.js` | 100 | `APP_VERSION`, `WHATS_NEW`, keys, `TAXONOMY`, ladders, `store` |
| `js/02-api.js` | 240 | `api`/`rest`, signed URLs, `photoUrl` byte cache, `compressImage` |
| `js/03-state.js` | 447 | globals, `loadData`, derived helpers, kv store, day plans |
| `js/04-laundry.js` | 181 | derived dirty state, tolerances, overrides |
| `js/05-dom.js` | 133 | `$`/`$$`, `esc`, toast, sheets, scroll helpers |
| `js/06-home.js` | 884 | launcher, attention group, Tomorrow card, weather memory |
| `js/07-closet.js` | 121 | lens/folder rendering |
| `js/08-trip-mode.js` | 877 | trip mode, dashboards, recap, rhythm, milestones |
| `js/09-item-detail.js` | 1321 | photo + details views, `FIELD_CONFIGS`, field sheet |
| `js/10-search.js` | 190 | keyword search + filter plumbing |
| `js/11-add-item.js` | 328 | Add form, `_addState` |
| `js/12-looks.js` | 2804 | looks lenses, formulas, **exclusions + the suggester** |
| `js/13-grid-bar.js` | 440 | density picker, select mode, bulk actions |
| `js/14-calendar.js` | 1028 | month/day views, logging pickers |
| `js/15-stats.js` | 2343 | every stats view + report cards + review |
| `js/16-capsules.js` | 1175 | capsules, trips, per-day planner |
| `js/17-builder.js` | 692 | Build-a-Look canvas |
| `js/18-weather.js` | 311 | Open-Meteo, geocoding, `_wxCache` |
| `js/19-wiring.js` | 798 | `switchTab`, `wireEvents`, delegation |
| `js/20-rack.js` | 490 | **the rack** — three bands, rotation, second look, rack screen |
| `js/21-trip.js` | 367 | **the trip screen** — your list + outfits from it (renamed from `21-pack.js` 2026-08-16, when the solver was removed) |
| `js/22-wear-detail.js` | 190 | **the wear screen** — `buildWearDelta`, the block, both surfaces |
| `js/23-boot.js` | 185 | snapshot, freshness, auth, `init()` |

**Load order is the contract.** Top-level `const`/`let` in classic scripts share
one global lexical scope, which is why the split needed zero code changes — but
it also means a file can only use a binding from a file loaded *earlier* at
**load time**. Function bodies are fine (they run after `init()`), top-level
statements are not. The numeric prefixes exist so the order can't be shuffled by
accident; adding a file means inserting a tag in the right place.

⚠️ `js/12-looks.js` and `js/15-stats.js` are still big (2.8k / 2.3k) because the
cut only followed existing banners. Splitting the suggester out of `looks.js` is
a clean follow-up — it just needs judgment about where the boundary is, which
the banners don't mark.

## Architecture

**Current state: 2026-07-25 r13. Full rework from v25.**
The old v25 is preserved at git tag `v25-full` and `archive/index_v25_full.html`.
Do not use v25 as a reference for current UI code.

**EDITORIAL REDESIGN (2026-07-21 r13) — SHIPPED.** Implemented from a Claude
Design handoff bundle (`claude.ai/design`, a reskin of r10). Presentation only —
zero schema/logic change. ① **Palette**: white/periwinkle → warm paper
(`--bg #f8f4ee`) + deep oxblood (`--accent #6b2737`). New tokens `--gold`/
`--gold-soft`, `--panel`/`--panel2` (thumb wells / segmented headers),
`--surface2` (sheet expands), `--grabber`, `--shadow-sm`/`-md`. **Every
hardcoded `#fff`/`#f4f4f7`/`#faf9f8` is now a token** — that's what makes
theming work, so never reintroduce a literal light color; reach for a token.
② **`--serif`** = the display face for headings (login wordmark, `.bar h1`,
`.fname.big`, `.cap-name`, `.ch-name`, `.sheet-hdr h2`, `.stats-sec-hdr .t`,
placeholder/empty-state `b`). It is **`Georgia, 'Times New Roman', serif` —
system fonts only**. The mock loaded Newsreader from Google Fonts; that was
rejected as an external asset + third-party request per the single-file rule
(user decision 2026-07-21). **Do not add a webfont link.**
③ **`--on-accent`** = text/icon color for anything filled with `var(--accent)`.
Exists because dark mode *lightens* the accent to `#c07f8c`, where cream text is
~2.3:1. Light `#fffdfb`, dark `#1a1512` (~7:1). The mock tried this as a
`@media dark { .btn { color: … } }` override and **lost the cascade** to the
later base rules — a token is the only thing that works here. Anything NOT on
the accent (heart stroke over photos, packed tick on green, `.cal-act` on fixed
greys, the color-swatch check) deliberately keeps literal white.
④ **DARK MODE via `prefers-color-scheme`** — reverses the 2026-07-17 "dark mode
REJECTED" call (user re-approved 2026-07-21; that line in the polish entry below
is superseded). Photos get `filter: brightness(.94)`.
⑤ **Themes**: `currentTheme()`/`applyTheme(t)` write `html[data-theme]` +
`store("wardrobe.theme")`; `applyTheme` runs FIRST in `init()`. Two themes —
`editorial` (default, oxblood) and `sage` (green), each with its own dark block.
Settings → Appearance picker. A third theme = add a `html[data-theme="x"]` block
+ its dark twin + a `.theme-opt` button; nothing else.
⑥ Motion/polish: `:active` press-scale on primary buttons, `:focus-visible`
rings, `.screen.active` fade-in, sheet transition on `cubic-bezier(.32,.72,0,1)`
+ backdrop blur, `.sk*` skeleton loaders (replaced the `.spin` on `retryLoad`),
tabbar icon scale, thicker donut ring.
⑦ `smoothScrollTop()` extracted from the header-tap handler (was inline) and
reused by the tab bar: **re-tapping the ACTIVE tab scrolls to top**. Still
hand-eased — body is the scroll container, `behavior:"smooth"` on it is
unreliable and `scrollingElement.scrollTo` is a no-op (see Known gotchas).
⑧ `haptic()` on primary taps — a **no-op on iOS Safari** (no Vibration API), so
it does nothing on the user's actual device; the `:active` transforms carry the
feedback. Kept for Android/desktop Chrome.

**Batch of user asks (2026-07-21, r5→r7) — SHIPPED.**
① **Sticky Tomorrow pick**: the generated combo persists in `kvData("tmpick")`
(`TM_PICK_KEY`, `{date:{idx:[itemIds]}}`, today+future only) instead of a
volatile in-memory cache — a refresh no longer loses a pick she liked. `↻`
re-rolls (`tomorrowGenPieces(..., force)`); tapping the strip calls
`openTomorrowRevise` (opens the suggester with that combo in front, and
`#sgClose` writes the revised combo back via `_sugg.tmPick`).
② **"home" formality bucket**: `outfitBucket` returns `"home"` when a look has
NO shoes ("no shoes = worn at home"), superseding the derived level; a manual
`formality_override` still wins. It's a bucket, NOT a 9th ladder level —
`BUCKET_RANGES.home = 2` for the places that need a number. Adds a Home folder
to the Formality lens.
③ Looks grid tiles lead with wear count.
④ **"Worn" tray**: `isWornNotDirty`/`wornItems`/`_scopedWorn` = worn since
`last_washed` but under tolerance (the pile on the chair). Closet-root
`👕 Worn · N` row → `closetWorn` full-page view (`renderClosetWorn`, subtitle
`wears/tolerance`), wired into `closetBack`/`siblingItems`/`switchTab` exactly
like `closetHamper`.
⑤ Closet Review gained an `image` field (first in `REVIEW_FIELDS`) so photoless
items surface; `replaceItemPhoto` advances the deal when it fires from review.
⑥ **EDITABLE TAXONOMY** — `TAXONOMY` is no longer a const: `TAXONOMY_DEFAULT`
holds the shipped shape, `let TAXONOMY`/`let CATEGORIES` are rebuilt by
`applyTaxonomyOverride()` from `kvData("taxonomy")` = `{cats, meta}` (called at
the end of `loadData` AND after snapshot hydration — both, or the boot render
uses stale lists). Settings → "Edit categories & types" → `openTaxonomySheet`:
rename/add/remove categories + subcategories with live item counts; renames
bulk-PATCH items via `retagItems(match, patch)` (PostgREST column filter, no id
list); delete only offered at zero usage. `meta` carries a renamed
subcategory's `SUBCAT_FORMALITY`/`WEAR_TOLERANCE` defaults to the new name.
⚠️ Renaming does NOT update `WORKOUT_SLOTS`/`GEAR_CAND_SUBCATS` (still keyed on
the shipped names) — renaming a Workout subcat silently breaks workout mode.
Round C Step 9 adds a warn-on-rename guard. **`LAUNDRY_LOADS` is NOT affected** —
it's keyed on `color_family`, not subcategory (corrected 2026-07-25; the taxonomy
editor never touches color families).

**Partners / rhythm / rotation (2026-07-21 r10) — SHIPPED.** Three derived-only
adds, harvested from external design docs (ChatGPT/Gemini specs the user
brought — everything else in them was already shipped or blocked by the
single-file/no-library constraints; the native-iOS half is permanently out of
reach). ① `itemPartners(itemId, limit, wearRows?)` — top co-wear partners keyed
on the shared **wear DAY**, not shared look membership (what left the closet
together > what got saved); `PARTNER_MIN_DAYS`=2 so one memorable outfit isn't a
habit. Rendered by `partnersRowHtml` as a "Usually worn with" thumb strip in the
item-details top card; `[data-partner]` tiles `openItem` (already in closet, so
no `_itemReturn` needed). ② `wearRhythm(itemId, wearRows?)` → `{avg, longest,
wearDays}` over DISTINCT wear days, null under 3 (two wears = one gap = noise);
shown as a `det-sub` under "Worn N days" via `humanGap`. ③ `buildRotationStats
(days, pool?, wearRows?, today?)` + `rotationBlockHtml`/`wireRotationChips` —
share of the Available closet worn in a trailing window, `ROTATION_WINDOWS`
30/90/365 chips (session-only `statsRotationDays`), first block in Clothing
Stats. ⚠️ Its denominator is the **full Available closet, NOT `statsPool()`** —
deliberate, so an active stats filter can't flatter the number. All four
functions take injectable args and are covered in selftest (44/44).

**Round B "Formulas" (2026-07-21, r3→r4) — FIRST SLICE SHIPPED.** Discover the
outfit SHAPES she rebuilds, then re-cook them. All derived, nothing stored.
`formulaKeyFor(items)` = canonical `"Slot:Subcategory + …"` signature (sorted;
null unless there's a dress OR a top+bottom; null-slot pieces — bras/swim —
never count); `formulaLabel(key)` renders it in dressing order (`FORMULA_SLOT_ORDER`);
`buildFormulas(pool)` groups WORN looks by key, keeping shapes with
`FORMULA_MIN_LOOKS`=2+ distinct looks and `FORMULA_MIN_WEARS`=6+ wears (a single
much-worn look is just that look). Surfaced as the **"Formulas" Looks lens**
(first tab) through the existing folder machinery — `folderRowsHtml`/
`folderOutfits`/`folderLabel` all have a Formulas branch, folder key = the raw
signature. Payoff: a formula's folder page has **"✨ New outfit from this
formula"** → `openSuggestSheet(null,null,null,shapeKey)`; `suggestOutfits`'
10th arg `shapeKey` hard-filters each slot's pool to `formulaShapeMap(key)`
(slots the shape doesn't name go EMPTY so the silhouette holds; a two-top shape
may fill the layer slot from its own tops), and `swapSuggestionPiece` stays
inside the shape. ⚠️ Still TODO for Round B: naming/saving formulas to `kv` and builder
slot-seeding. **The formula chip in the suggester shipped 2026-07-26 r9** —
`topFormulas()` (memoised on outfit+wear counts) + `suggestShapeChipsHtml()`;
tapping the active chip CLEARS it, since a chip that can only be turned on is a
trap. Hidden in workout and "Vary this" modes, which already answer "what
shape?" more strongly.

**Round A "Tomorrow" (2026-07-20, r1→r2) is FULLY SHIPPED** (decisions in
ROADMAP.md's Round A section — do not re-litigate). Three parts:
⚠️ **ACTIVITY MODE WAS REMOVED 2026-07-26 r13 — read this before the entry
below.** Her call, after a run wouldn't build on a trip: *"I should just have
workout formality and that can fix it."* **Level 1 (Utility) IS the function-wear
ask.** The 🏋️ chip, `_sugg.activity`, `entryActivity` and `suggestOutfits`' 8th
`activity` param are gone. What replaced them:
- **`isFunctionWear(i)`** — formality contains 1 **OR** category Workout **OR**
  the `gear:workout` tag. Used by BOTH the level-1 pool filter and the
  pure-utility isolation in `formalityOk`, so they can never disagree.
  ⚠️ The tag clause is what makes a real trip work: running shoes are usually
  subcategory Sneakers at formality `[2,3]` because she wears them casually too,
  and requiring level 1 on every piece left a Utility ask with no shoes.
  Rescue-only — it widens level 1 and narrows nothing else.
- Level 1 draws from the **whole closet, never the rack** (the rack excludes the
  Workout category on purpose — "those clothes don't really mix"), and is the
  only level at which the Workout category is visible at all.
- The **Workout CONTEXT survives** for logging and planning; it reaches the
  suggester through `CONTEXT_FORMALITY_SEED` (`Workout: 1`) like any other
  context, so a planned workout day asks for Utility with no special case. It is
  filtered OUT of the suggester's context chips only — *"I do still want the
  other contexts available to select though. just not workout"*.
- `openGearTagSheet` survives: its "Gear-only" toggle writes formality `[1]`,
  which is now exactly the thing being asked for.
- ⚠️ **The 🏋️ Workout CHIP is back (2026-07-27 r1) — as an ALIAS, not a mode.**
  r13 removed it with activity mode and she asked for it back: she liked the
  chip, what was broken was that it pooled by tag and wouldn't build. It carries
  **`data-slvl="1"`**, so it shares one handler and one piece of state with
  "1. Utility" and cannot drift from it the way the old mode did. Both chips
  light up together on purpose — that reads as "same thing", not as a bug. The
  ladder keeps the word *Utility* (level 1 is also rain and hiking); the chip
  keeps *Workout* because that's what she goes looking for. Pinned by a test.

① **Activity/gear rework** (r1, no migration) — SUPERSEDED, see above: `GEAR_WORKOUT_TAG`/`GEAR_RAIN_TAG`
sentinel tags (`isWorkoutGear`/`isRainGear`/`setWorkoutGear`/`setRainGear`,
item-detail SUGGESTIONS toggles). `suggestOutfits` gained an 8th arg
`activity` — `"workout"` filters the pool to `isWorkoutGear` and bypasses
`formalityOk` (the tag IS cohesion); normal mode now explicitly drops the whole
Workout category and gates `gear:rain` behind `wmoIsWet(wx.code)` (boosted +2
when wet). `WORKOUT_SLOTS` maps Workout subcats to real slots (bras/swim →
null = never suggested). Sheet: 🏋️ Workout chip (`_sugg.activity`, mutually
exclusive with formality/context asks, clears locks on flip); empty-state
`suggestGearDoorHtml` → `openGearTagSheet` (one-pass tagging + a "Gear-only"
toggle that sets `formality [1]` via `setGearOnlyFormality`/`isGearOnly` so the
existing pure-Utility isolation keeps gear off normal days). **Level 1 renamed
"Function"→"Utility"** (labels only; stored bucket key `"function"` unchanged).
② **kv store** (r2): new `kv` table (`migration/kv_store.sql`, CONFIRMED RUN
2026-07-20) → `kvData` Map loaded in `loadData`, `kvSet(key,value)` optimistic
upsert (POST `Prefer: resolution=merge-duplicates`), included in the snapshot.
③ **Day plans + Tomorrow** (r2): `dayPlan(date)` reads `kvData("dayplan")` =
`{date: [{contexts:[], outfit:id|null}]}` — ordered ENTRIES (one outfit across
contexts = one multi-context entry; an outfit change = 2 entries; outfit null =
context set, look TBD). `saveDayPlan`+`pruneDayPlan` (past 7d/future 30d window,
pure for selftest). `entrySuggestLevel` (dressier context wins) / `entryActivity`
(Workout context → activity mode) drive suggestions. `openDayPlanSheet(date)` =
the editor (context multi-select + Pick/✨Suggest/✎Build per entry, reuses the
suggester/builder via a `planCtx={kv:true,date,entryIdx,level,activity}` — see
`data-swear`/`finishBuilder`/`builderCancel` kv branches). `wearPlannedEntry`
logs an entry stamping ALL its contexts. Home (suppressed in trip mode):
`tomorrowCardHtml` (all-day, planned looks or a cached `tomorrowGenPieces`
generated combo + 📌 Keep), `todayPlanRowsHtml` (one-tap Wear-it), `planAheadRowHtml`
→ `openWeekPlanSheet` (7-day overview). Calendar day view (today/future, non-trip):
planned-look Wear-it rows + a 📅 Plan button. `loadHomeWeather` now fetches
today+tomorrow in one call (`_homeWx.wx2`) and logs the day's weather to
`kvData("wxlog")` (≤1 write/day, 400d window) as groundwork for style-twins.

**LAUNDRY v1 + Trips (2026-07-15, r1→r4) is FULLY SHIPPED** (decisions in
ROADMAP.md's laundry section — do not re-litigate). `migration/items_laundry.sql`
(adds `items.last_washed` + `items.laundry_state`) **CONFIRMED RUN on the live
DB 2026-07-18** (REST column probe) — laundry is fully live. The
`LAUNDRY_READY()` gate (checks the column exists on loaded rows) stays in the
code as harmless belt-and-suspenders; read paths never needed a gate (absent
column = null = clean). Core model (LAUNDRY section, after the derived helpers): dirty
is **derived, never stored** — distinct wear-days since `last_washed` ≥
`WEAR_TOLERANCE[subcategory]` (category fallback; Infinity = shoes/outerwear
never dirty); **null `last_washed` = clean** (tracking is opt-in by behavior).
`laundryState()` = one pass over wears → Map(item_id→Set(dates)); build ONCE per
bulk scan and pass into `isDirty`/`dirtySince`/`suggestibleClean` (items×wears
perf). One-time overrides in `items.laundry_state`: `'hamper'` (dirty until next
wash stamp) and `'extra:<n>'` ("one more wear" — stores the wear-day count at
set time, self-expires when a newer wear lands; NO wear-path bookkeeping).
`stampWash(ids, date)` stamps ONLY dirty items (an under-tolerance jean wasn't
in the physical hamper). Surfaces: suggester "🧺 Clean only" chip (Season row,
default on; pool filter in `suggestOutfits` cleanOnly param + swap/add-layer;
locked/seed exempt by construction; items dirty `LAUNDRY_RESUGGEST_DAYS`=7+
re-enter badged so the pool can't starve); `openLaundrySheet` (closet-root
"🧺 Hamper · N/empty" row, `[data-laundry]` — ALWAYS visible once migrated, r5)
with load chips from her real sorting (`LAUNDRY_LOADS`: Whites/Cools/Warms +
All together, keyed on color_family) + back-datable date — when NO item has a
`last_washed` yet the sheet instead offers the one-time bootstrap "Mark whole
closet washed" (`#lnStart`, stamps Available finite-tolerance items; fixes the
day-one chicken-and-egg where an empty hamper hid the only entry point); 🧺 tile badge via `itemGridView` (informational — pickers
never filter); item photo view `laundryLineHtml` (One more wear / Washed / To
hamper); wear-again "🧺 in the wash" tag; Home `.laun-row` **previous-day
confirm strip** (most recent logged day ≤3 back; thumbs pre-marked with derived
🧺/↩︎, tap = `flipLaundry` override, ✓ = `LAUNDRY_CONFIRM_KEY` and writes
nothing) which becomes the **"Done laundry lately?" prompt** when the hamper is
stale (`LAUNDRY_STALE_DAYS`=7; "Not yet" snoozes `LAUNDRY_SNOOZE_DAYS`=3 via
`LAUNDRY_SNOOZE_KEY`) — her deliberate, laundry-only exception to "no nudges".
Trips: `planRewearFlags` rewear budget on plan day cards (counts planned
wear-days per piece since trip start / last laundry day, flags past-tolerance);
`PLAN_LAUNDRY = "__laundry__"` sentinel INSIDE a day's plan array (invisible to
look rendering — `planActiveLooks` drops unknown ids) toggled by the day card's
🧺 chip; capsule detail "wash before you pack" hamper count. **The bucket chip
icon changed 🧺→🪣 so 🧺 means laundry app-wide.**

**"Bucket + Visibility polish" (2026-07-11 r1) is FULLY SHIPPED:** ① photoless
items render a muted tee-glyph placeholder everywhere (`PHOTO_PLACEHOLDER`
data-URI SVG applied by `loadPhotoNode` when `data-photo` is empty or the URL
fails; `outfitPieces`/`layoutCanvasHtml`/`lookHeroBlock` no longer drop
photoless pieces; the builder accepts photoless items — `builderPool`'s
image_path filter removed). ② Calendar day-view SOLO-item collage cells are
tappable (`calOutfitCollageHtml(ids, outfit, tappable)` → `data-cal-item` →
`openItemFrom`); look cards still open the look first (user call). ③ Look-
details piece rows carry a `.det-piece-thumb` thumbnail that opens the item
(`data-piece-open`, checked BEFORE `data-occ-item` in the looks delegation);
the rest of the row still edits formality. ④ Empty status filter now means
**Available only** (`itemMatchesFilter` default — Storage no longer counts in
Style Stats unless explicitly picked in the funnel). ⑤ Archived looks purged
from Most Worn Looks, stats main-page counts, context Top Looks, the Home
Looks-tile count, `outfitsForItem` (item's looks list), and trip-plan day
cards (`planActiveLooks`) — archived looks appear ONLY in the Archive lens and
on the calendar. ⑥ **Trip/capsule OUTFIT BUCKET** — see CAPSULES entry.
r2 routed `thumbHtml`/review-card/det-thumb empties through the tee placeholder
(and `.empty` CSS tints via `background-color`, never the `background:`
shorthand — it kills the `center/contain` the placeholder needs). r3 QoL:
`contextOptions()` sorts by global wear frequency (all context pickers);
`.cltoolbar` + `.cal-day-header` are sticky under the app header (`--hdr-h`
var); tapping the header scrolls to top (NOTE: **body is the scroll
container**, not window — `window.scrollTo` is a no-op app-wide; the header
tap animates `document.body.scrollTop` with a setTimeout loop because rAF
stalls in hidden documents).
**"Feels Professional" polish round (2026-07-17 r1) is FULLY SHIPPED** (decisions
in ROADMAP.md's polish section; dark mode was REJECTED here but that is
SUPERSEDED — it shipped in the 2026-07-21 r13 redesign above). All
perceived-quality, no features/schema: ① **PWA install** — `manifest.json` +
`icon-180/512.png` (repo-root files, the approved one-file exceptions),
apple-touch-icon + standalone metas, SVG data-URI favicon. ② **Sheet motion** —
`showSheet(id)`/`hideSheet(id)` helpers (slide-up/down + backdrop fade; wrapper
`hidden` stays the source of truth, `hideSheet` delays `hidden=true` ~240ms) —
**never toggle a sheet wrapper's `.hidden` directly**; drag-dismiss hands its
offset to `hideSheet` for continuity. ③ **Freshness** — `visibilitychange`
handler: >5 min hidden (or date rollover) + `uiCanRefetch()` (no sheet open, no
builder/add/review/pick/select) → silent `loadData()` +
`rerenderRootAfterRefresh()` (roots only: home / closet-sans-detail /
looks-sans-look / calendar / stats-sans-review). ④ **Snapshot instant-boot** —
`saveDataSnapshot()` after every `loadData` into Cache Storage
(`DATA_CACHE`/`SNAPSHOT_KEY`, 7d max age, user-id-checked); `bootApp` hydrates
from it before any network and fails silently if fresh fetch dies;
`handleSignedOut` clears it. ⑤ **Update toast** — `checkForNewVersion()`
Range-fetches own index.html, compares `<meta name="app-version">` (MUST stay
in lockstep with `APP_VERSION` — deploy skill bumps both) → "Update available"
toast; reload via `location.replace(+query)` because plain reload can re-serve
the stale cached copy. ⑥ **Scroll** — `scrollToTop()`/`getScrollTop()`/
`restoreScroll(y)` (body is the scroll container; the 9 dead `window.scrollTo`
calls were converted); `makeScreenReturn` thunks restore origin scroll;
`_detailEntryScroll`/`_lookEntryScroll` restore grid/list position on plain
back (captured only when `detailId`/`lookId` was null, so sibling prev/next
keeps the original). ⑦ **Photo fade-in** — `loadPhotoNode` decodes off-DOM then
fades (`.ph-fade`/`.ph-in`); `_shownPhotos` Set skips the fade on re-renders
(no added flicker). ⑧ Papercuts: tabular-nums body-wide, desktop ≥700px frame
(app + all fixed chrome capped at 640px), login email prefill
(`wardrobe.lastEmail`), `prefers-reduced-motion` guard.

**Usability batch 2026-07-19 r5+r6 (from the "how would you improve
usability/professionalism now" review; user picked 3/4/5/6+keyboard+finder,
PARKED Home attention-slot hierarchy + in-app confirm sheets — see
Back-burner):** r5 ① `outfitIncomplete(o)` (no dress/swimsuit AND no
top+bottom; shoes NEVER required — "no shoes = worn at home" is her rule;
workout subcats count as top/bottom) + health-check "Incomplete looks" row →
`openIncompleteLooksSheet` review list with per-look deconstruct.
② zero-state door: level-starved capsule suggestions render
`suggestLevelDoorHtml` — up to 8 closet pieces covering the level with
one-tap add-to-capsule then re-roll. r6 ③ `WHATS_NEW` const (deploy skill
refreshes it with APP_VERSION) + `maybeShowWhatsNew()` in bootApp (first run
of a new version toasts the changelog; `wardrobe.seenVersion`).
④ `api()` network-failure copy is honest about data ("You're offline — that
didn't save"). ⑤ `.cb-x`/`.laun-ok` get ::after hit-area expansion (~44px).
⑥ review-card price input `inputmode=decimal`. Selftest 31/31.

**Fix pack 2026-07-19 r4 (user-reported, same day):** ① one-piece looks are
outlawed — `createLookFromItems` guards <2 (saveBuilder already did); existing
strays surface in the data health check with a bulk fix that DECONSTRUCTS them
(wears survive as solo wears). ② `deconstructLook(id)` + a "Deconstruct look"
row on the look details page ("not really a look" — keeps every wear, drops
the grouping; shares `deconstructLookCore` with deleteLook/health check).
③ tops-vs-layers: `layerPieceOf` picks the LAST flagged top (the ow-slot one)
so labels don't swap when the base is also layer-flagged; combo generation
skips stacking two layerable tops. ④ **suggester `targetLevel` is now a HARD
filter** in the engine + swap + add-layer — a "Dressed Up" ask returns
fewer/zero results (starvation note explains) instead of silently falling
back to casual (the capsule-mode bug she hit). Selftest 31/31.

**"Loop Resilience + Payoff" round (2026-07-18→19, through 2026-07-19 r3) is
FULLY SHIPPED** (spec in ROADMAP.md's section — decisions locked from the
2026-07-18 product review). Pieces: **suggester** — ⃠ per-piece session bans
(`_sugg.banned`, `banSuggestionPiece`; `_suggPool()` now ALWAYS returns the
effective pool minus bans), pool-starvation note (`suggestStarvationNote`),
per-sheet-open variety salt (`_saltFor`, `SUGGEST_SALT`=0.35, added in
`scoreCombo`); **Home** — catch-up strip (`catchupHtml`/`missedDays`/
`skipDay`, `SKIP_DAYS_KEY` store set pruned 30d; "Log →" jumps to that day's
wear-again chooser) + backup-staleness row (30d, taps `downloadBackup` which
re-renders the CURRENT screen); **Stats** — "Closet vs Life" gap page
(`buildGapStats` pure: wear share vs formality-eligible closet share per
context, 5+ wears noise floor; `statsView "gap"`) and "Year in Review"
(`buildWrappedStats(year)` pure + `renderStatsWrapped` card stack, year
chips, gift-free all-time CPW champions, dead weight, `longestStreak`;
`statsView "wrapped"`); **trips** — offer dismissal now once per TRIP.
**Data safety (r7, same series):** Settings Data card (`downloadBackup` JSON
export + `runDataHealthCheck` with one-tap fixes for dangling rows),
`migration/backup_photos.py` (full offline backup) + `restore_backup.py`
(disaster recovery, refuses non-empty tables without --force), both stdlib-
only; `migration/backup/` + `.env` gitignored.

**"Trip Mode + Tap Tax" round (2026-07-18, r1→r6) is FULLY SHIPPED** (spec +
locked decisions in ROADMAP.md's trip-mode section — do not re-litigate; the
"no nudges" rule is SOFT as of this round). No schema changes. Key pieces:
**TRIP MODE** — `tripModeId` (`TRIP_MODE_KEY` in `store`, restored in `init`,
validated at end of `loadData`); phases DERIVED from capsule dates via
`tripPhase(c)` (pack ≤`PACK_LEAD_DAYS`=3 before start · trip · unpack
≤`UNPACK_GRACE_DAYS`=3 after end; undated capsule = "capsule mode", no
phases). `enterTripMode`/`exitTripMode` (also set/clear `activeCapsuleId`;
the shared `scopeBannerHtml()` banner's ✕ EXITS THE MODE — one mental model).
Home: `tripDashHtml` takeover (day counter, today's planned looks +
`planWoreIt` one-tap, `_planWx` weather via `loadTripHomeWx`, suitcase hamper
row, remaining-days strip, ✨/plan/packing chips) + `tripOfferHtml` auto-offer
banner (per-day dismissable, `TRIP_OFFER_KEY`); wiring in `wireTripDash`.
Scoping: wear-again chooser + `openSuggestSheet` default pool + calendar
pickers (`_pickTripScope`, "✈️ Suitcase only" chip escape) + `builderPool`.
`tripWearContext(date)` auto-stamps `TRIP_CONTEXT`="Travel" on EVERY
wear-create POST during trip dates (post-log sheet shows it pre-selected);
`tripPlanSync(outfitId, date)` records logged looks into that day's plan;
`tripMissingPieces` offers add-to-capsule (post-log row + toast chip); Add
Item pre-ticks the trip capsule; laundry sheet takes a pool (`_lnPool`) —
trip laundry washes only the suitcase. **UNPACK/RECAP** — `tripRecapData(c)`
(pure derivation: worn vs dead-weight, most-worn, repeated look — retroactive
for any past dated trip) + `openTripRecap(cid, {unpack})` (worn→hamper via
`flipLaundry` overrides, End trip mode); dashboard unpack-phase row +
capsule-detail "Trip recap" button on past trips. **FILTER+SORT (A3/A2)** —
sort lives IN `openFilterSheet` (`sortable: true` on closet/calendar/capsule
pickers; title "Filter & sort"); the 3 standalone sort popovers are GONE.
⚠️ Sort keys renamed: `"category"` = the composite (was misleadingly keyed
"color"), `"colorfam"` = NEW true color sort; `gridSortKey()` maps legacy
stored `"color"`→`"category"` — never write key "color" again. One-tap clear:
`funnelBtnHtml(id, state, onClear)` renders an adjacent ✕ when active
(`_funnelClearFns` registry + one capture-phase listener in `wireEvents`;
closet/looks/stats toolbars registered manually). **PICKER TOGGLE (B)** —
`builder.pickAll` ("all" = the bottom RAIL over the whole `builderPool()`
with category jump chips, zero folder depth; "browse" = classic drill),
toggled via `setBuilderPickAll` (🗂/▦ buttons in rail hdr + picker hdr),
persisted `wardrobe.pickmode.builder`, capsule/trip scope defaults to all.
**A1/E4** — `openPostLogSheet`'s `close()` re-renders the calendar day/Home
beneath it (the "set context twice" bug); `openLogWear` + `logWearToday`
refresh photo-view stat strip / day view too. **A4** — ✨ "Suggest new" tile
at the front of the wear-again strip, TODAY only (past-date suggestions
rejected by user).

**Report Cards (2026-07-10) shipped in `2026-07-10 r2`→`r3`** — r2 shipped Brand
& Retailer report cards; r3 (same day) generalized the engine to 7 dimensions
(+ subcategory, price bracket, purchase year, color, acquisition) and added the
Workhorses/Declutter smart lists, the capsule-picker suggested strip, and the
item-detail workhorse badge. See the STYLE STATS entry below for
`buildItemPerf`/`buildReportStats`/`renderStatsReportPage`/
`renderStatsReportDetailPage`.

**"Weather + Loop Polish" v3 (2026-07-09) is FULLY SHIPPED in `2026-07-09 r1`**
(decisions locked in ROADMAP.md's v3 section): the W7 "Today" tile was REMOVED
(user call) and weather moved INTO the suggester (`scoreCombo` wx override,
`WX_HOT_F`/`WX_COLD_F` constants, sheet weather chip, trip-plan `_planWx`) ·
`wears.formality_for` is now DERIVED at log time (`deriveWearFormality`), never
asked — the post-log sheet is context-only · weekday-context suggestion chip
(`weekdayTopContext`) · look-log dup guard + Undo parity · Home "✓ Logged today"
row · Wear-again strip reserves 2 liked-but-neglected slots · suggester
lock-a-piece (🔒) + add/remove Layer · calendar "On this day" row · both nav-audit
items closed (`openItemFrom(id, browseCtx)` snapshot/restore). No schema changes.

**"Hearts + Filters Everywhere" v2 is FULLY SHIPPED, all 8 waves (W0–W7), through
`2026-07-06 r7`.** The 2026-06 "Unified Experience" build (W0–W5) and filter
unification Phases 2+3 are also fully shipped. **▶ NEXT UP:** nothing scheduled —
the agreed next round is the palette page + shopping gap / replacement watch (see
ROADMAP.md's Round C deferred list); ask the user before starting new work.

Top-of-`<script>` config, then logically grouped sections:

- **CONFIG** — `SUPABASE_URL`, `SUPABASE_KEY`, `BUCKET`, `APP_VERSION`, `TAXONOMY`,
  `COLOR_FAMILIES`, `OCCASION_LADDER` (8 levels), `FORMALITY_BUCKETS`, `BUCKET_RANGES`,
  `SUBCAT_FORMALITY`, `CAT_FORMALITY`, `CONTEXTS`, image/encode constants.
- **SESSION** — `store` safe wrapper (probes localStorage once, falls back to in-memory
  Map). Always use `store`/`saveSession`/`loadSession`, never raw localStorage.
- **FETCH HELPERS** — `authRequest`, `api` (authed fetch + transparent 401 retry),
  `rest` (PostgREST wrapper), `uploadPhoto`/`deletePhoto`/`signedUrl`/`signedUrlBatch`,
  `prewarmUrlCache()` (batch-signs all item photos after loadData, fire-and-forget).
- **IMAGE COMPRESSION** — `compressImage(file)`: canvas downscale to 1200px, WebP
  q0.82, JPEG fallback if browser can't encode WebP.
- **STATE + DERIVED** — `items`, `wears`, `outfits`, `outfit_items`, `capsules`,
  `capsule_items`, `exclusions` loaded via `loadData()`. Helpers: `wearCount`,
  `lastWorn`, `costPerWear`, `daysSince`, `money`, `esc`.
- **HOME LAUNCHER** — `renderHome()`: Stylebook calm tile grid (5 tiles). Below the
  grid: the `log-cta` ("Log today's wear" → `openWearAgainChooser`) when nothing is
  logged today, else a **"✓ Logged today · <contexts|n items>" row** (`.logged-row`)
  that taps into today's calendar day view (v3 — habit feedback + evening-outfit
  shortcut). The v2 "Today" tile was REMOVED in v3; what remains of it is
  `getHomeLocation()` (keyless `navigator.geolocation`, cached in `store` under
  `HOME_LOC_KEY`/`HOME_LOC_TTL`) + `loadHomeWeather()` (`_homeWx`, one fetch/day),
  which now feed the suggestion sheet's weather chip instead.
- **CLOSET** — `renderCloset()`/`openItem()`/`openItemDetails()`. Status-lens
  switcher. `siblingItems()` derives the current list for prev/next item nav.
- **ITEM DETAIL** — two-view: `openItem()` (photo + nav bar) → `openItemDetails()`
  (edit view). Field sheet (`#fieldSheet`) driven by `FIELD_CONFIGS`/`openFieldEdit()`.
  `_fieldEditItem`/`_fieldOnSave` dual-mode (DB save vs. callback). Photo view shows
  a **"★ Workhorse" badge line** (`workhorseBadgeHtml`, 2026-07-10) under the stat
  strip when the item has 5+ wears and idx ≥ 1.5 vs subcategory peers
  (`buildItemPerf(items)` — full-closet baseline, not the stats-filtered pool).
- **ADD ITEM** — `renderAdd()`/`_renderAddBody()`/`saveNewItem()`. State in `_addState`.
- **SEARCH** — `openSearch()`/`renderSearch()`/`runSearch()`. Keyword + 6 filter rows.
- **LOOKS** — `renderLooks()` + 3-view look detail keyed by `lookView`:
  `openLook()` (clean canvas + bottom action toolbar: Details/Formality/Duplicate/
  Calendar/Archive/Delete, plus a **heart toggle** in the toolbar's right slot) →
  `openLookDetails()` (metadata page: wear/pieces/cost, formality, season, per-piece
  formality, notes) → `openLookWears()` ("When You Wore It" — every wear date; tap a
  day → `openContextSheet` to set that wear's context). `looksBack()` walks
  wears→details→canvas, then `leaveLook()` — the single canvas-level exit (also used
  by archive + delete): consumes `_lookReturn` if the look was opened from another
  screen (see `openLookFrom` in Known gotchas), else `renderLooks()` (list, stays
  filtered if scoped). `duplicateLook()`/`archiveLook()`.
  Lens switcher: **Formality · Season · Context · Capsule · Liked · Recent · All ·
  Archived** (8 tabs — `.lens` row scrolls horizontally, doesn't shrink labels).
  `activeOutfits()`/`archivedOutfits()` derive from `effectiveArchived(o)` (`o.archived`
  OR any piece is status Archive — no cascade PATCH, no column; auto- vs
  manually-archived shows a one-line note on canvas/details, the Archive/Unarchive
  button only ever reads/writes `o.archived`). `layoutCanvasHtml(o, wrapCls)` /
  `lookHeroBlock(o)` render arrangements.
  **Hearts**: `outfits.rating === 1` = liked (`toggleLikeLook(id)`, PATCH 1↔null, no
  other values used). Primary hearting moment is `openPostLogSheet` (shown whenever
  logged wears share an `outfit_id`) and a `.cal-heart-btn` on calendar day-view look
  cards — not just browsing. `.otile-heart` badges liked-look tiles everywhere
  (`outfitGridHtml`, all look pickers). `outfitContextMap()` (one pass over wears →
  Map(outfit_id→Set(contexts)); `outfitContexts(o)` is the single-look convenience)
  backs the Context lens folders — use the map for whole-list scans, never a
  per-outfit scan (perf: outfits × wears).
- **BUILD-A-LOOK** — Stylebook canvas on `#tab-builder`. `openBuilder(outfitId?, seedItemId?)`.
  Pointer drag+resize; `builder` global state. `saveBuilder()` writes `outfits.layout` JSONB.
  "+ Clothing" picker: category/subfolder browsing is full-screen (`renderBuilderPicker`);
  once at an item list (`builderInItemMode` → subfolder or flat category) it switches to a
  bottom item rail over the visible canvas (`renderBuilderRail`, `.bld-rail`); rail taps
  `addPieceToBuilder(id, true)` keep it open. Migration: `migration/outfit_layout.sql`.
  **Wear-sync after piece edits** (2026-07-08): `saveBuilder` checks `wearSyncCandidate(id)`
  (most recent wear date ≤14d whose outfit-linked wear rows ≠ current piece set).
  Same-day mismatch → `syncWearsToLook(id, date)` runs silently (toast notes it);
  1–14 days old → offer chip on the toast ("Update that wear →"). Sync deletes that
  day's wear rows for swapped-out pieces and inserts rows for swapped-in ones,
  copying context/formality from a surviving group row (tags follow the swap).
  State-based, not delta-based — re-saving an unchanged look still offers the fix,
  which is also the repair path for wears left stale before this shipped. Older
  wears are history and never touched. **Dup-merge follow-up**: when an EDITED
  look merges into an existing duplicate, the same policy applies to the edited
  look's latest wear — same-day is re-pointed to the survivor automatically
  (`repointWears` + `syncWearsToLook`); ≤14d is offered inside `openMergeFollowUp`,
  a post-merge sheet that also asks the old look's fate (Keep / Archive / Delete —
  delete inlined, not `deleteLook`, to skip its `leaveLook()` navigation; wears FK
  is SET NULL so history survives). Sheet skipped in trip-plan (`planCtx`) saves.
- **OUTFIT SUGGESTIONS** — `suggestOutfits(targetLevel?, seedItemId?, capsulePool?,
  season?, wx?, lockedIds?)`. Slot-filling engine (Top/Dress + Bottom + Shoes +
  optional Outerwear). **By design there is NO unworn/last-worn weighting** in
  SCORING — ⚠️ but since 2026-07-26 r7 the default POOL is the rack, which is
  built partly from recency, so recency now enters through pool construction.
  That is deliberate and approved; see the RACK entry. Slots
  random-sample and scoring is only "match" signals: formality cohesion (hard filter
  via `formalityOk`), exclusions (hard), loud-color penalty, pattern-clash penalty
  (`isPatterned`), and a capped SOFT boost for color-pair + item-pair affinity learned
  from saved outfits (`buildSuggestIndexes` → `_colorPairFreq`/`_itemPairFreq`;
  **liked looks (`o.rating===1`) count double**). Returns 8 via softmax (temp 0.8)
  with diversity-aware selection so arrowing/swiping swaps pieces.
  **Weather (v3):** when `wx` (`{maxT,minT,code}`) is present it OVERRIDES the
  season layer heuristic in `scoreCombo` — hot (`maxT ≥ WX_HOT_F`, 78°F) penalizes
  layers/heavy tops, cold (`≤ WX_COLD_F`, 50°F) boosts layers, precipitation
  (`wmoIsWet`) boosts Boots / penalizes Sandals. Sheet weather = `loadHomeWeather()`
  (`_homeWx`, one fetch/day, geolocation) or the plan day's `_planWx`; shown as a
  toggleable chip in the Season row (`_sugg.useWx`, `_suggWx()`).
  **Lock-a-piece (v3):** 🔒 chip per piece (`_sugg.locked` Set) — locked pieces pin
  their slot and survive every regenerate; locked+seed ids are exempt from the
  per-item diversity cap. **"+ Layer" / "× Layer"** (`comboLayerPiece`/
  `addSuggestionLayer`) adds/removes a compatible layer on the current combo.
  Pieces are tappable (open item); swipe slides (`sg-anim-*`). A row of
  **Context chips** (`topContextsByWearCount`) sits above the formality chips —
  picking one sets `_sugg.targetLevel` from `contextFormalityLevel(context)` (mode of
  that context's `formality_for` wears, min 3 to trust; else `CONTEXT_FORMALITY_SEED`).
  Entry points: item detail shuffle button, Looks tab +, capsule "Suggest an outfit".
  Sheet state in `_sugg` (incl. `activeContext`).
  **"Wear this today" logs AS AN OUTFIT** (`wearSuggestedCombo`, r2): create-or-merge
  a real look via `saveComboAsOutfit` (item-set dedup + layout), wears get its
  `outfit_id` + derived formality, soft dup guard per day, post-log sheet shows the
  heart. Undo removes the wear rows only (the created look stays; dedup reabsorbs it).
- **EXCLUSIONS** — `exclusions` table stores item pairs that shouldn't appear together.
  `buildExcludeSet()` → `_excludeSet` (Set of "a:b" canonical pairs). `isExcluded(a,b)`,
  `addExclusion(a,b,reason)`. Loaded in `loadData()`.
- **CAPSULES** — `renderCapsules()` dispatches by `capsuleView` (list/detail/form/pick/**plan**).
  Two modes: Capsule + Trip (packing checklist, weather strip). The add-items picker
  (`renderCapsulePicker`) opens with a **"★ Suggested" workhorse strip**
  (`capsulePickSuggestHtml`, 2026-07-10): up to 12 in-season (trip start-date season
  when set, else current), Available, idx ≥ 1.2, 3+-wear items; hidden while
  searching or category-drilled; tiles are `data-pick` so `togglePick` (now `$$` —
  an item can appear in strip AND grid) selects in both places. "Plan outfits from this" sets
  `activeCapsuleId` (scopes Closet + Looks). "Suggest an outfit" opens suggestion sheet scoped to
  capsule members.
  **Trip by-day planner** (`capsuleView="plan"`, `renderCapsulePlan()`): one card per trip date
  with that day's weather (`_planWx` from `buildTripWeather`). Per day: Assign a saved Look
  (`openPlanLookPicker`, scoped to `outfitFullyInCapsule`), Suggest (`openSuggestSheet(null,cid,
  {capsuleId,date})` — season = trip date, saves combo via `saveComboAsOutfit`), or Build
  (`openBuilder(null,null,{capsuleId,date})` — picker scoped to capsule via `builderPool()`).
  Saving in any of those calls `addPlanLook`. Plans live in `capsules.plan` JSONB (intentions,
  NOT wears — `migration/capsule_plan.sql`); "Wore it" (`planWoreIt`) converts a day to a real
  wear. `finishBuilder(id,msg)` routes a builder save back to the plan when `builder.planCtx` set.
  **Outfit bucket (2026-07-11 r1):** `PLAN_BUCKET = "bucket"` is a RESERVED key in the same
  `capsules.plan` JSONB — a pool of planned looks not tied to a day. The plan view (now reachable
  for ALL capsules: dated trips get "Plan outfits by day", undated capsules get a "Planned
  outfits" button, same `data-cap-byday`/`openTripPlan`) renders the bucket card first with its
  own ＋ Look / ✨ Suggest / ✎ Build actions — all the existing plan plumbing works because they
  just pass `date = PLAN_BUCKET` (`planDayLabel` special-cases the label; `planCtxSeasonDate`
  anchors season to trip start / today since the bucket has no date; suggest button reads "Add
  to bucket"). Day cards get a **"🪣 From bucket"** chip (was 🧺 until 2026-07-15 — 🧺 now means laundry) (`openBucketAssignSheet`) — assigning
  KEEPS the look in the bucket (one outfit can cover several days); bucket tiles show
  "✓ planned" once used somewhere. `planActiveLooks(c, date)` is the render-side reader — it
  drops deleted AND archived looks (raw ids stay in the JSONB; unarchiving restores them).
- **CALENDAR** — `renderCalendar()` dispatches month/day views. Day view: outfit groups,
  swipe-left actions (Copy/Move/Delete). "+ Clothing" / "+ Look" log pickers, both with
  a filter funnel (`pickerFilter`/`PICKER_FILTER_DIMS` for +Clothing, `calLookFilter`/
  `LOOKS_FILTER_DIMS` for +Look). Footer also has a **"↻ Wear again"** button
  (`openWearAgainChooser`, see DAILY LOOP). Above the footer, an **"On this day"** row
  (v3, `.otd-row`) shows the most recent prior YEAR with wears on the same date
  (mini collage + contexts); tap navigates the day view to that date.
- **STYLE STATS** — `renderStats()` dispatches main/field/grid/outfits/contexts/
  context-detail/gap/wrapped/**rotation**/report/report-detail/review views.
  **Report Cards** (2026-07-10):
  main-page "Report Cards" section → `renderStatsReportPage()` over
  the 7 dimensions in `REPORT_DIMS` (brand, retailer, subcategory, price bracket,
  purchase year, color_family, acquisition). Engine: `buildItemPerf(pool)` computes
  per-item {count, months, exp, idx} — idx = actual wears / expected wears, where
  expected = peer wear-rate (subcategory rate, category fallback when the subcat
  slice is under 5 items) × months observed. Tenure runs from purchase_date
  (→ first wear → created_at fallback), clamped to the earliest logged wear
  anywhere (pre-logging months would deflate rates). `buildReportStats(field)`
  groups per-item perf by the dim's `keyFn`. Per group: wears/mo, median $/wear +
  total spend (gifts excluded from cost stats, still counted for engagement), duds
  (never worn, or archived with < `REPORT_DUD_WEARS`=3 wears). **Ranked dims**
  (brand/retailer/color/acquisition): idx sort + Best/Worst bar; groups under
  `REPORT_MIN_ITEMS`=3 items list unranked. **Canonical dims**: subcategory
  (taxonomy order under category `sf-label` headers, `showIdx:false` — the index
  is ×1.0 by construction there; the payoff is best/worst WITHIN the group, per
  user decision 2026-07-10), price (bracket order), year (newest first; current
  year's duds say "still proving out"/"too soon"). Pool = `reportPool()` —
  statsPool but `{ noStatusDefault: true }` so archived items stay in (dud rate
  needs them). Detail page: KPI card (subcategory swaps the vs-Similar KPI for
  Duds), Best performers / Underperformers grids (worst = never-worn by price
  desc, then lowest index), "All items" → grid with `statsFromReport` so back
  returns to the detail page (wired in `statsNavBack` + `statsRebuild`). No
  date-range button (metrics are inherently all-time / tenure-normalized); the
  filter funnel + acquisition range apply. **Workhorses / Declutter smart lists**
  (`buildSmartList` keys, a TOGGLE_GROUPS pair, rows in Clothing Stats):
  Workhorses = idx desc among 3+-wear items; Declutter = owned 6+ months, not in
  any liked look (`likedLookItemIds()` shield), never worn (longest-owned first)
  or idx < 0.5 and untouched 90+ days — transparent sort, no composite score.
  Filter sheet (funnel icon). Range button. Closet Review
  deals items one card at a time; inline field picker on the deal card (no sheet-hop
  for most fields). `reviewPool()` is **Available-only** (Storage + Archive excluded).
  Deal card is sized to fit one phone screen: horizontal card (96px photo + info
  beside it), single-line formality chips, one-row action bar. Looks Stats section
  has three rows: Most Worn Looks, Liked Looks (→ `likedNeglectedOutfits()`: liked +
  never-worn-or-60d+), and Contexts (→ `renderStatsContextsPage`: wears-by-context,
  `contextFormalityStats` avg/spread, tap through to `renderStatsContextDetailPage`'s
  top items + top looks for that context — both range-scoped via `rangeStart()`).
- **DAILY LOOP** — `logWearToday(id)`: one-tap wear log from item photo view (no modal).
  Soft dup-wear guard (skips the POST + offers "Log again →" if already logged today);
  `logLookOnDay` has the same guard per look/day (v3). POSTs immediately; toast shows
  "Wear logged" + **Undo** + "Add context →" chips (`toast()` accepts an array of
  `{label,fn}` action chips; `undoLoggedWears(rows)` is the shared Undo — back-dated
  logs and look logs get Undo too, the latter via the post-log sheet's close toast).
  **`wears.formality_for` is DERIVED, never asked (v3):** every wear-create path
  writes `deriveWearFormality(itemIds)` (level(s) all pieces share → median, else
  rounded avg of per-piece minimums); manual correction = the look's formality edit.
  `openPostLogSheet(wearRows[], {presetCtx, undoable})`: context multi-select +
  **heart toggle** (shown whenever the wears share an `outfit_id` — the PRIMARY
  hearting moment). A **weekday-context suggestion chip** (v3,
  `weekdayTopContext(date)` → "✨ Church · usual for Sundays", ≥3 distinct days to
  trust, `_ctxSuggest`) sits above the context chips — one tap selects, never
  auto-saved. Sheet fires after solo item log, look wear, and (single-ask) after
  `makeLookFromDay`/`saveCalClothingLogAsLook` create a look, pre-seeded from any
  context already on the day's rows. `_logItemId` (module-global) tells
  `renderContextPicker` which item's frequent contexts to sort first. `openLogWear(id)`
  (back-dated log) reachable via quick-actions "Log on a date…" and a 500ms long-press
  on the item photo view's Log button. Home's `.log-cta` (or, once logged, the
  `.logged-row`) and the calendar day-view footer's "↻ Wear again" both open
  `openWearAgainChooser(date)` — a horizontal strip of 12 candidate looks
  (`wearAgainCandidates()` → `{list, neglectedIds}`: worn last 14 days ∪ liked ∪
  most-worn this season, with **2 slots reserved for in-season liked-but-neglected
  looks** badged "it's been a while", v3) before falling back to +Clothing/+Look;
  tapping a look calls `logLookOnDay`. `createLookFromItems(itemIds, {name})` is the
  shared create-or-merge (dedup via `findDuplicateOutfit`) behind both
  `makeLookFromDay` and the +Clothing picker's "Log as look" button
  (`saveCalClothingLogAsLook`, shown once ≥2 items are picked).
- **TABS + WIRING** — `switchTab(name)`, `wireEvents()`, `init()` IIFE.
  Active tabs: home · closet · looks · calendar · stats.
  Capsules is in the bottom nav (the "Home-tile only" note was stale, and it
  was the standing justification for the launcher grid removed 2026-08-14). Search/Add are non-tab screens.

## Closet model

**Status is a cross-cutting lens, not a category.** A tee is always under Tops.
`closetLens` (Available/Storage/Archive/All) scopes the category folder list.
Status changes happen on the item detail move bar only.

- `closetLens` — current lens, default "Available"
- `closetCat` — null = root | category name
- `closetSub` — null = subcategory list | name | `"__other__"` | `"__all__"`
- `searchResults` — null = browsing | array = search-result grid
- `detailId` — item id in detail view (null = none)

`closetBack()` pops the stack: details view → photo view; then `_reviewMode` → review
deal; `_fromBuilder` → restore builder; **`_itemReturn` → return to origin screen**;
else: grid → subcategory list → category list → root.

**Item-detail back is app-wide via `_itemReturn`** (a restore thunk). Item detail always
renders into the closet screen, so any NON-closet entry point opens via `openItemFrom(id)`,
which captures the active screen (`makeItemReturn`) and brings the closet forward without
`switchTab`. `closetBack` invokes the thunk (`restoreTab(tab)` re-renders that tab from its
preserved view-state). `switchTab` clears `_itemReturn` (a real tab tap abandons the return).
The builder is the one exception — it needs a full state stash, so it keeps `_fromBuilder`.
Plain closet-grid taps use bare `openItem` (origin IS closet → default back). Migrated entry
points: stats (`openItemFromStats`), look piece tap, suggestion piece tap, capsule item tap.

**Look-detail back mirrors this via `_lookReturn`** (added 2026-07-07 r2). Non-Looks entry
points open via `openLookFrom(id)` (`makeScreenReturn("looks")` — the generalized capture
behind `makeItemReturn`); `leaveLook()` consumes the thunk on back/archive/delete. Migrated:
calendar day-view look cards, both stats look grids, capsule looks, trip-plan day cards.
`restoreTab("looks")` re-opens `lookId` (per `lookView`) instead of `renderLooks()`, so
item-back from a look-canvas piece lands on the LOOK, and the two thunks compose:
calendar → look → piece → back → look → back → calendar. `switchTab` clears both returns.
Builder round-trips (`builderCancel`/`finishBuilder`) route through `switchTab("looks")`
and intentionally abandon origin.

## Data model

Canonical definition: **`schema.sql`** in repo root. Six tables, all RLS-scoped to
`auth.uid()`:

- `items`: id, user_id, name, category, subcategory, brand, retailer, color_family
  (single), price, purchase_date, date_is_guess, acquisition (New|Secondhand|Gift),
  size, fabric (text[]), season (text[]), **formality** (smallint[] of 1–8 levels), status
  (Available|Storage|Archive), tags (text[] — includes `"no-suggest"` tag), url,
  order_no, receipt_url, official_name, notes, image_path, created_at.
- `wears`: id, user_id, item_id, outfit_id (nullable), worn_on (date),
  context (text[] — named contexts, multi-select; seed list `CONTEXT_SEED` + any
  custom ones, derived via `contextOptions()`), formality_for (smallint 1–8,
  nullable — DERIVED at log time via `deriveWearFormality`, never asked (v3);
  manual override lives on the look), created_at.
- `outfits`: id, user_id, name, context, notes, image_path, formality_override
  (text — bucket key, nullable), **layout** (JSONB `{item_id,x,y,s}[]`),
  **rating** (smallint, CHECK 1–5, nullable — `rating === 1` means "liked" (hearts);
  other values unused/reserved), **archived** (boolean default false — manually-set
  flag; browse/pickers actually key off the DERIVED `effectiveArchived(o)`, which is
  also true when any piece's status is Archive), created_at.
  Join table: `outfit_items(outfit_id, item_id, user_id)`.
- `capsules`: id, user_id, name, kind (capsule|packing|travel), start_date,
  end_date, notes, locations (JSONB `{name,lat,lon,from,to}[]`), created_at.
  Join table: `capsule_items(capsule_id, item_id, user_id, packed bool)`.
- `exclusions`: id, user_id, item_a (uuid), item_b (uuid), reason (text),
  created_at. Normalized: `item_a < item_b`. RLS own_rows.
- Photos: private `wardrobe` bucket, path `<user_id>/<uuid>.<ext>`. Display = signed URLs.

**Migrations applied to live DB** (run via Supabase SQL editor):
- `migration/formality_schema.sql` — adds `items.formality`, `wears.formality_for`,
  `outfits.rating`, `exclusions` table.
- `migration/formality_multiselect.sql` — converts `items.formality smallint → smallint[]`
  (drops CHECK constraint, wraps existing values in arrays).
- `migration/outfit_layout.sql` — adds `outfits.layout`.
- `migration/capsule_weather.sql` — adds `capsules.locations`.
- `migration/capsule_items_packed.sql` — adds `capsule_items.packed`.
- `migration/wears_context_array.sql` — converts `wears.context text → text[]` (multi-select).
- `migration/outfit_archived.sql` — adds `outfits.archived` (boolean). Applied 2026-06-28.
- `migration/capsule_plan.sql` — adds `capsules.plan` (jsonb) for trip per-day outfit
  planning (`{ "<date>": ["<outfitId>", ...] }`). **Run before using the by-day planner.**
- `migration/merge_duplicate_outfits.sql` — DATA cleanup (not schema): collapses outfits
  with identical item-sets into one survivor, re-pointing wears. Survivor = non-archived >
  has-layout > oldest. Idempotent. Pairs with the save-time dedup guard in `saveBuilder`
  (`findDuplicateOutfit`/`itemSetKey`). Run once after deploying 2026-06-28 r5.
- `migration/items_laundry.sql` — adds `items.last_washed` (date) + `items.laundry_state`
  (text override: `'hamper'` | `'extra:<n>'`). **CONFIRMED RUN 2026-07-18** (verified
  via anon-key REST column probe; `LAUNDRY_READY()` gate stays as belt-and-suspenders).
- `migration/kv_store.sql` — new `kv` table (`user_id, key, value jsonb`, PK
  (user_id,key), RLS own_rows) for small app state (Round A day plans + wxlog).
  **CONFIRMED RUN 2026-07-20** (anon-key REST probe returned 200).

## Design model

**Formality (1–8, multiselect set):**
1. Function (workout, hiking, rain) · 2. Very Casual (home, errands) · 3. Casual
(chorus rehearsal, casual lunch) · 4. Polished Casual (date nights, matinees, parties) ·
5. Smart Casual (normal work day) · 6. Dressed Up (cocktail, weddings, evening) ·
7. Business Professional (interviews, conferences) · 8. Formal (black tie).

`items.formality` is `smallint[]` (a set, not a range). `itemFormalitySet(i)` is the
source of truth — returns the explicit array, or imputes from name keywords + subcat
seed (`SUBCAT_FORMALITY`) + co-occurrence nudge. `itemFormality(i)` returns the minimum
of the set for backward-compat display/grouping.

Suggestions: outfit valid at level L iff every piece's set contains L (pool-filtered
before combo generation). Pure-Function items (`set == [1]`) never mix with non-function
items — enforced by `formalityOk(its)`. L8 (Formal) is soft — no isolation.

`OCCASION_HINTS` parallel array holds the context descriptions shown in chip UI.

Migration: `migration/formality_multiselect.sql` — drops old CHECK constraint, converts
`smallint → smallint[]`. Applied 2026-06-26.

**`outfitBucket(o)`:** checks `o.formality_override` first, then derives from
`itemFormality()` averages across pieces. `o._bucket` is a session cache — clear it
(set null) when any piece's formality changes.

**Outfit suggestions:** slot-filling (Top/Dress + Bottom + Shoes + optional Outerwear).
Cardigans slot as "Outerwear" via `suggestSlot(i)`. **Intentionally random within things
that plausibly match — no unworn/rotation bias.** Hard filters: formality cohesion
(`formalityOk`), exclusions. Soft penalties only: 2+ loud colors, 2+ patterned pieces
(`isPatterned`). Soft boost: color-pair + item-pair affinity learned from saved outfits
(`buildSuggestIndexes`, capped). Slots random-sample; softmax (temp 0.8) + diversity-aware
batch selection. Capsule-scoped mode via `openSuggestSheet(null, capsuleId)`. A seeded item
(item-detail shuffle) persists across the batch by design. Suggestion/builder pieces are
tappable to open the item (builder restores in-progress look via `_fromBuilder`).

**Sentinel tags in `items.tags`** (managed via `setItemTag(id, tag, bool)`):
- **`NO_SUGGEST_TAG = "no-suggest"`** — `isNoSuggest(i)`/`setNoSuggest`. Excluded from all suggestions.
- **`LAYER_TAG = "layer"`** — `isLayer(i)`/`setLayer`. A Top flagged as layerable (e.g. a
  button-up) is eligible for the Outerwear/layer slot in `suggestOutfits` as well as the
  Top slot (combos guard against an item being its own layer). Toggle in item detail
  SUGGESTIONS card, shown only when `category === "Tops"`.

**Contexts** — 13 named occasions stamped on wears/outfits (not items). Formality
ranges: Function/garden (1) · WFH (1) · Errands (1–2) · Friends/rehearsal (2) ·
Campus (3) · Conference (3) · Date night (2–4) · Symphony (3–4) · Church (3–4) ·
Shower/holiday party (4) · Funeral (4, dark tones rule) · Wedding guest (4–5) ·
Gala/chorus concert (5, all-black rule).

**Taxonomy** (category → subcategories):
- Tops: Tee shirts, Graphic tees, Long-sleeve tees, Sleeveless, Blouses, Sweaters, Cardigans, Sweatshirts
- Bottoms: Jeans, Pants, Shorts, Skirts, Leggings/Joggers, Tights
- Dresses: Short, Long, Cocktail
- Outerwear: Blazers, Jackets, Coats
- Shoes: Boots, Sandals, Flats, Heels, Sneakers
- Workout: Workout tops, Active shorts, Sports bras, Swimwear

**Color families** (single per item): Green, Teal, Blue, Purple, Maroon, Pink, Red,
Orange, Yellow, Beige, Brown, White, Gray, Black, Metallic.

## Migration

**The full data reset is DONE (user confirmed 2026-07-18)** — the live data is
real, not provisional; treat it as the irreplaceable asset it is.
`migration/RESET_PLAN.md` is historical.
`migration/` holds throwaway importers (NOT shipped; libraries OK there).
`migration/.env` (gitignored) holds the service-role key + Airtable token.
`schema.sql` (repo root) = canonical target state.

Airtable base "CLOTHING BASE CURRENT" (`appK4hX9DJYTGFGYb`) is the source of truth.
476 items + 3,995 wears + 1,543 outfits imported 2026-06-18.

Migrations are run by the user in the Supabase SQL editor. **Never deploy UI that
writes a new column/table before its migration is confirmed.**

## Conventions

- **`APP_VERSION`** format: `YYYY-MM-DD rN`. New day = `r1`; same day = increment `rN`.
  Currently `2026-08-17 r2`. ⚠️ The version lives in **THREE** places that must
  stay in lockstep — the deploy skill does all three, the selftest pins all three:
  1. `APP_VERSION` in `js/01-config.js`;
  2. `<meta name="app-version">` in `index.html` (read by `checkForNewVersion`,
     which Range-fetches the first 2KB of the deployed page — a mismatch means a
     phantom "Update available" toast, or never seeing a real one);
  3. the **`?v=` on all 24 `js/`+`css/` tags** (23 until 2026-08-03 r3 added
     `js/22-wear-detail.js` and renumbered boot to `23-boot.js`). Miss one and Pages
     serves a fresh `index.html` beside a stale module — a half-updated app,
     which is worse than an un-updated one.
- Comment non-obvious logic only — match the surrounding density.
- Fixed product choices live as constants at the top of `js/01-config.js`
  (`TAXONOMY`, `COLOR_FAMILIES`, `OCCASION_LADDER`, `CONTEXTS`) — change them there.
- All item photos use **`background-size: contain`** everywhere. Never `cover`/`fill`.

## Filtering

**Canonical filter predicates** (single source of truth): `matchesFormality(i, level)`
(numeric 1–8) and `matchesSeason(i, season)` (DERIVED via `itemSeasonSet`; unknown
season = no match). **Status is always read via `itemStatus(i)`** (null → "Available");
an empty status filter means **Available only** (`itemMatchesFilter` default, tightened
2026-07-11 r1 — it used to only exclude Archive, which let Storage into Style Stats;
explicitly picking statuses in the funnel brings Storage/Archive back; pickers/builder
pass `{ noStatusDefault: true }` because they have their own status chips). `STATUSES`
no longer includes Wishlist. `inSeason()` (suggestions) is intentionally separate —
unknown = all-season-eligible.

**Unified filter sheet (Phase 2) is SHIPPED**: `openFilterSheet(state, { onApply, title,
dims })` + `itemMatchesFilter(i, state, opts)` / `outfitMatchesFilter(o, state)` drive
Closet, Stats, and Looks. Per-surface dim lists (`CLOSET_FILTER_DIMS` etc., ~line 2869)
and per-surface `newFilterState()` clones (`closetFilter`/`statsFilter`/`looksFilter`).
The standalone Search screen is retired (`openSearch` now opens the closet funnel).
`outfitMatchesFilter` semantics: ALL-pieces for formality/capsule/status, ANY-piece for
the rest (plus outfit-only `liked`, since `itemMatchesFilter` never sees it — see
`FILTER_UNIFICATION.md` Phase 3, now SHIPPED). **Phase 3 (pickers: builder, calendar
+Clothing/+Look, capsule add-items, trip plan picker) is SHIPPED** — every picker uses
the shared `funnelBtnHtml(id, state)` button+badge.

## Known gotchas

- **⚠️ `.cthumb` is a FIXED 64px — a narrower wrapper does NOT shrink it**, it
  overflows and lands on top of whatever is beside it. Bitten twice: the Tomorrow
  strip (2026-07-21, fixed with its own `.tm-thumb`) and then THREE new lists in
  2026-08-03 r5 (month review, wear panel, rack second-look), which she reported
  as "text overlaps with the images". **Use `.sthumb` (44px) for list rows and
  never size a thumb by its container.** Any new thumb size = a new class.

- **⚠️ A full-width `<button>` needs an explicit `width`. `display:block` is not
  enough** (2026-07-26). Form controls size to their content regardless of
  `display`, so `.log-cta` — the app's primary action — rendered as a **181px
  stub in a 390px column** for months, and `.logged-row` (also the laundry,
  backup and planned rows) at 259px. Neither rule set `width`. Both now use
  `width: calc(100% - 32px)`, matching their 16px side margins; that's the idiom
  `.otd-row` and `.trip-dash .td-laun` already used, and `.btn`/`.btn-sec`/
  `.sheet-action-btn` set `width:100%`. **Any new full-width BUTTON needs one of
  those.** A `<div>` in the same position would have been fine, which is exactly
  why this hid so long. It was invisible to CSS reading and obvious within five
  seconds of rendering the app — **render the screens and look at them.**
- **One glyph, one meaning, app-wide** (2026-07-26, user-reported: "the little
  shuffle button means two different things in two different places"). `↻` had
  come to mean "wear again" (show me looks I already own) in the calendar
  footer, "reshuffle" (generate a new combo) in the suggester, and a per-piece
  swap — two of those are opposites, which makes a one-tap control require
  recall. **`↻` is retired; `✨` is the single mark for "make something new"**
  (suggest, reshuffle, re-roll, per-piece swap) and history actions carry a
  plain word ("Wear again"). Weather refresh is an inline SVG and unaffected.
  A selftest case fails if `↻` reappears in any `js/` module.
- **`svgElement.hidden = bool` does not reflect to the DOM attribute** in this
  app's runtime (2026-07-21 r14) — unlike on a div/button, it silently sets a
  same-named JS expando that reads back correctly (`el.hidden === true`) but
  never touches `getAttribute("hidden")`, so the global
  `[hidden]{display:none!important}` rule never fires and the element stays
  visible regardless. Toggling an inline `<svg>` icon's visibility from JS
  must use `svg.toggleAttribute("hidden", bool)` instead. Every OTHER
  `.hidden =` in the codebase targets a div/button/span, where it works fine —
  this only bites bare `<svg>` elements.
- **No hardcoded colors in new UI** (2026-07-21 r13). The redesign routed every
  literal through a token so the two themes × light/dark all work. A new
  `background: #fff` or `color: #fff` looks fine while you're building and then
  glows on a dark screen. Use `--surface`/`--panel`/`--panel2`/`--bg2` for
  fills, and **`var(--on-accent)` for text or strokes sitting on
  `var(--accent)`** — never literal white there, because the accent lightens in
  dark mode. Headings use `var(--serif)`, which is **system fonts only**; adding
  a webfont `<link>` breaks the single-file rule.
- **A `@media (prefers-color-scheme: dark)` block near the TOP of the stylesheet
  cannot override a later base rule at equal specificity** (2026-07-21 r13). The
  design handoff's dark-mode text-color override sat at line ~75 and silently
  lost to `.btn { color: … }` at line ~165. Theme-varying values belong in a
  **custom property** on `:root` (which is why `--on-accent` exists), not in a
  media-query rule that races the cascade.
- **Bottom sheets open/close ONLY via `showSheet(id)`/`hideSheet(id)`** (2026-07-17)
  — never set a sheet wrapper's `.hidden` directly. `hideSheet` animates first and
  flips `hidden=true` ~240ms later, so code that *reads* `.hidden` right after a
  close sees `false`; the wrapper ids list in `uiCanRefetch()` must gain any NEW
  sheet wrapper added later.
- **`#toast` overlays bottom-fixed controls and must stay tap-transparent**
  (2026-07-21 r12). It's `position:fixed` at `bottom: nav-h + safe-b + 18px`,
  **z-index 50** — the same band as `.stats-toggle-float` (z-index 18) and close
  to `#itemBar`/`.lk-actbar` (25). It used to set `pointer-events:auto` on the
  whole pill when it had action chips, and its handler returns early on a
  non-chip tap — so a lingering toast made the Most/Least Worn toggle look
  broken (tap the chip → that action fired; tap elsewhere → nothing). Rule:
  **`pointer-events` stays `none` on the pill; only `.toast-chip` opts back
  in.** `positionToast()` additionally lifts the toast clear of
  `.stats-toggle-float`; it's called from `toast()` AND from
  `renderStatsGridPage` so it self-corrects from both directions. Any NEW
  bottom-fixed control in that band needs the same consideration.
- **⚠️ A WEAR IS A DAY. Never count wear ROWS** (2026-07-24 r1). One outfit
  logged on one day writes one `wears` row **per piece**, so `rows.length` reads
  a 5-piece look as 5 wears — and the context stamped on it as 5 outings. Every
  "N wears" number must dedupe on `worn_on`. Use **`countByDay(rows, keyFn)`**
  (next to `ctxArr`): `keyFn` returns the keys a row contributes to, and each key
  counts a given `worn_on` at most once. Already day-based and safe to copy:
  `wearCount`, `outfitWornCount`, `buildItemPerf`'s `itemWearIndex`. The only
  legitimate row count left is the Settings backup card ("N wear records" —
  deliberately relabeled, it's a table size, not a wear count).
- **A stats page's funnel must match its pool — both directions** (2026-07-25 r11,
  user-reported). `statsToolbar(..., hideFilter)` and the pool argument are ONE
  decision, and getting them out of step lies to her either way: "What's missing"
  hid the funnel but still passed `statsPool()` (invisible filter silently
  narrowing the page), and "Closet vs Life" showed a funnel while `buildGapStats()`
  ignored `statsFilter` entirely (decorative funnel). Rule: **whole-wardrobe pages
  pass no pool AND `hideFilter=true`** (Rotation, What's missing, Closet vs Life,
  Year in pixels); **filtered pages pass `statsPool()` and show the funnel**
  (Palette, field/report pages). Never mix.
- **Every `statsView = "grid"` entry point owns ALL the back-nav flags** (2026-07-25
  r11, user-reported "back goes too far"). `statsNavBack` picks the return target
  from `statsFromReport` / `statsFromPalette` / `statsFromField`, falling through to
  `main`. A new drill-in that sets only its own flag lands correctly but leaves the
  others stale for the NEXT drill-in — so every grid entry must set its own flag
  true and the rest false. There are four such sites; grep `statsView = "grid"`.
- **`effectiveArchived` is memoised** (2026-07-26 r11) — it walks every piece of
  every look and runs from `activeOutfits()` on every Looks render, every look
  picker and several stats paths. `buildOutfitIndexes()` clears the map, so
  anything reloading data is safe; the two OPTIMISTIC mutations that don't go
  through it — `archiveLook` (incl. its rollback) and `saveField(id,"status")` —
  call `invalidateArchivedCache()` explicitly. Any new path that flips
  `o.archived` or an item's status must too.
- **Never call `wearCountInRange` inside a sort comparator** (2026-07-21 r11) —
  it filters the whole `wears` array per call, so a comparator makes it
  items × wears × log(items) (~34M row reads on the real closet, ~1s of frozen
  UI). Use `wearCountMapInRange()` — one pass, `Map(item_id → count)`. Both count
  distinct wear DAYS in every range mode (the ranged branch counted raw rows
  until 2026-07-24 r1; the selftest pins the agreement).
- **Drilling in must reset scroll; re-rendering must NOT** (2026-07-25 r12,
  user-reported "clicking into stats starts in the middle of the page"). Body is
  one scroll container shared by every screen, so a short child page inherits a
  long parent's offset. `switchTab` resets it; nothing else used to. The trap:
  `renderCloset()`/`renderStats()`/`renderCapsules()` are each called BOTH to
  navigate and to refresh in place (after a log, an undo, a filter change), so a
  bare `scrollToTop()` inside them yanks the page out from under her. Two
  patterns, use the right one: **Stats** compares `_statsLastView` to `statsView`
  inside `renderStats()` (the wrapper around `_renderStatsView()`) — view changed
  = navigation, same view = re-render. **Everything else** uses the per-surface
  stack `navDeeper(surface)` / `navShallower(surface)` / `navResetScroll(surface)`
  called at the *navigation handler*, never inside a render. ⚠️ `navShallower`
  deliberately does not just call `restoreScroll(y)` — that early-returns on 0 and
  would strand you at the child's offset when the parent was at the top.
- **Screen-top scrolling**: use `scrollToTop()` (instant) / `smoothScrollTop()`
  (animated, for deliberate "take me up" taps — header, re-tapping the active
  tab) / `getScrollTop()` / `restoreScroll(y)`. `window.scrollTo` AND
  `document.scrollingElement.scrollTo` are both no-ops (body is the scroll
  container), and `behavior:"smooth"` on body is unreliable — that's why
  `smoothScrollTop` hand-eases `scrollTop` on a setTimeout loop (rAF stalls in
  hidden documents). Back-nav scroll restore: `makeScreenReturn` thunks carry
  it; plain closet/look back uses `_detailEntryScroll`/`_lookEntryScroll`.
- **`localStorage` in restricted contexts**: `data:` URL open throws "Storage is
  disabled". `store` wrapper handles it — never use `localStorage` directly.
- **WebP encode**: `canvas.toBlob(..., 'image/webp')` silently returns PNG on some
  browsers. `compressImage` checks `blob.type === 'image/webp'` and falls back to JPEG.
- **Private photos need signed URLs** — never use a public bucket URL. Batch-sign via
  `POST /storage/v1/object/sign/{bucket}` with `{paths, expiresIn}`; full URL =
  `` `${SUPABASE_URL}/storage/v1${row.signedURL}` ``.
- **Photo bytes are cached locally (Supabase egress guard, added 2026-07-06 r8).**
  Signed URLs change every session so the browser HTTP cache never hits — every session
  used to re-download every photo (triggered a Supabase egress-quota email 2026-07-02).
  `photoUrl(path)` (the ONLY thing `loadPhotoNode` calls now) checks the Cache Storage
  API (`PHOTO_CACHE`, keyed by stable `image_path` via `photoCacheKey`) before any
  network; misses fetch the signed URL once and store the bytes; serves `blob:` URLs
  (`_blobUrlCache` per session, `_photoPending` dedupes concurrent grid renders).
  Eviction: `deletePhoto` → `evictPhotoCache` (photo replace/remove both flow through
  it); `prunePhotoCache()` after `loadData` drops entries no item references. Falls
  back to plain signed URLs where `caches` is unavailable. If photo display ever
  changes, route it through `photoUrl`, never raw `signedUrl`.
- **`prewarmUrlCache()`** — call after `loadData()` fire-and-forget. IntersectionObserver
  finds URLs cached on scroll.
- **`loadPhotoNode` sets `backgroundColor = "transparent"`** — lets white/transparent
  garment PNGs show cleanly on tile backgrounds.
- **GitHub Pages caches hard** — hard-refresh (`Cmd+Shift+R`) after deploy.
- **⚠️ The tab-bar gap is an iOS 26 bug. Do not try to fix it in CSS.** In the
  installed (standalone) app on iOS 26, the layout viewport is short at the bottom
  by exactly the *top* safe-area inset: iOS deducts the status-bar inset from the
  viewport height as if the web view sat below the Dynamic Island, while also
  placing it at y=0 and reporting `safe-area-inset-top` normally. Counted twice.
  Measured 2026-07-22, iPhone 14 Pro: `screen.height` 852, `innerHeight` 793,
  inset-top 59, inset-bottom 34. So anything at `bottom: 0` renders 59pt above the
  physical edge, and the page canvas keeps painting that strip — which is why the
  gap always matches the *body* background, never the bar's.
  - `env(safe-area-inset-bottom)` is **not** the cause. `--safe-b` is 0 and that is
    correct; zeroing it changes nothing about the gap.
  - **Fixed elements are clipped to the layout viewport, even though the canvas
    paints past it.** Tried and reverted in r5: `.tabbar { bottom: calc(-1 * 59px) }`
    positioned the bar perfectly (`rect.bottom` 852 = the physical edge) and then
    rendered *nothing at all* — the bar vanished. A `::after` shim extending the
    background downward fails identically. There is no CSS route into that strip.
  - Remaining options if it's ever worth revisiting: revert
    `apple-mobile-web-app-status-bar-style` to `default` (system lays the web view
    out inside the safe area and paints the bands itself — costs the edge-to-edge
    dark status bar), or wait for the WebKit fix (reportedly Safari 26.1).
  - Her standing call: live with the gap. Don't re-litigate it without new evidence.
  - A temporary on-device diagnostics readout lived in Settings for r4/r5 —
    `git show 5b11943` if numbers are ever needed again.
- **Status is a lens, not a category** — always change status on the item detail move bar.
- **`closetBack()` priority stack**: `detailView==="details"` → photo view; `_reviewMode`
  → review deal card; `_fromBuilder` → restore builder; `_itemReturn` → origin screen
  (`restoreTab`); `detailId` set → closet grid; `searchResults` → sub → cat → root.
- **Open an item from a non-closet screen via `openItemFrom(id, browseCtx?)`** (never
  bare `switchTab("closet")` + `openItem`) so back returns to the origin, not the
  closet. To make sibling prev/next nav browse the item's category, pass
  `{cat, sub}` as `browseCtx` — NEVER pre-set `closetCat`/`closetSub` at the call
  site: `openItemFrom` snapshots the closet browse state and restores it when the
  return thunk fires (v3 nav-audit fix). Builder `_fromBuilder` path is the exception.
- **Open a look from a non-Looks screen via `openLookFrom(id)`** (never bare
  `switchTab("looks")` + `openLook`) — same rule for looks (`_lookReturn`/`leaveLook`).
- **`looksBack()` checks `lookId` BEFORE `looksSearchQ`** — a look can sit on top of a
  lingering search; back must exit the look first (then `renderLooks()` restores the
  search results). Don't reorder.
- **`closetSub` special values**: `"__other__"` = no recognized subcategory;
  `"__all__"` = flat grid of whole category. Handle both in `categoryGrid()`.
- **`[hidden]` vs CSS specificity**: always include `[hidden] { display: none !important }`
  in global styles or `display:flex` on an ID beats the built-in hidden behavior.
- **Grid bar `position:fixed`** above tab bar. Add `has-gridbar` class to `#app` so
  `.tabbody` gets padding; else the grid's bottom row hides behind the bar.
- **Select mode DOM surgery**: `toggleSelect(id)` updates just the tile + calls
  `updateGridBar()` directly — no full re-render — to avoid photo-URL flicker.
- **Bulk PATCH via PostgREST**: `PATCH /items?id=in.("id1","id2")` — IDs must be
  quoted strings inside `in.()`.
- **`store.getItem` / `store.setItem`** (not `.get/.set`) — mirrors localStorage API.
- **Item photo view**: `detail-photo` class on `#app` hides the tab bar via CSS.
  `#itemBar` (z-index 25, bottom:0) replaces it. Add in `openItem()`; remove in
  `renderCloset()`, `closetBack()` (photo exit), and `switchTab()`.
- **`FIELD_CONFIGS`** maps field key → `{label, type, opts?, filter?}`. Types: `color`,
  `multi`, `single`, `formality`, `text`, `price`, `typeahead`, `date`. Add new fields here
  before wiring in `openItemDetails`. Current fields: name, purchase_date (date), color_family,
  fabric (filter), size, season, brand (typeahead), status, formality, price, url,
  retailer (typeahead), acquisition. Name is tappable in the detail header (rename);
  `saveField` blocks empty name and clears `date_is_guess` when `purchase_date` is set.
  Capsule membership is NOT a `FIELD_CONFIGS` field — it's a join table, edited via
  `openCapsuleAssign`/`saveItemCapsules` (item detail) and `_addState.capsules` (Add form).
- **Field sheet dual-mode**: `_fieldEditItem` = item OR `_addState`; `_fieldOnSave` = null
  (save to DB) or callback fn (Add form). Clear both in `closeFieldSheet()`.
- **Add Item state**: `_addState`, `_addPhotoBlob`, `_addPhotoUrl`. `#moveSheet` reused for
  category with `_addCatMode = true` guard.
- **Formality is 1–8**: `OCCASION_LADDER` has 8 entries (see Design model).
  `itemFormalitySet(i)` is the source of truth (explicit array or imputed);
  `itemFormality(i)` = min of the set, for display/grouping compat.
  Function items (set == [1]) must never mix with non-Function — enforced by `formalityOk(its)`.
- **`openOccasionEdit(itemId, onSaved)`**: single-tap pick (tap again to deselect).
  Always clears all `o._bucket` caches so looks re-derive.
- **Exclusions**: `_excludeSet` is a Set of `"<smaller-id>:<larger-id>"` strings.
  `isExcluded(a,b)` normalizes order before lookup. Loaded in `loadData()`, rebuilt via
  `buildExcludeSet()`.
- **Capsule suggestions**: `openSuggestSheet(null, capsuleId)` scopes the pool to
  `capsuleItems(capsuleId).filter(i => itemStatus(i) === "Available")`. `_suggPool()`
  reads `_sugg.capsuleId` to supply this on every regenerate/level-filter inside the sheet.
- **Calendar day-view logging**: `renderCalendarDay` does `body.onclick = null` to clear
  stale picker delegation. Both `openCalAddClothing` and `openCalAddLook` set `body.onclick`;
  they always terminate via `renderCalendarDay(body)` which clears it.
- **Calendar copy/move**: implemented in the `[data-calact]` handler in `renderCalendarDay`.
  Opens `#logSheet` with a date picker; copy = duplicate rows, move = copy + DELETE originals.
- **Item photo replace**: `replaceItemPhoto` reuses the Add pipeline; new uuid filename
  avoids cache collisions. `removeItemPhoto` nulls `image_path`. No in-app crop/rotate.
- **`layoutCanvasHtml(o, wrapCls)`**: single source for outfit thumbnails everywhere.
  Returns positioned `.ocpiece` divs or `null` (no usable layout). Falls back to grid
  collage on `null`. Pass through for any new outfit-thumbnail surface.
- **Build-a-look canvas**: `builder` global is `null` except on `#tab-builder`.
  `switchTab` clears it + `builder-mode` class. Normalized geometry (center fractions).
  Move/resize/select = DOM surgery only (no re-render). Touch needs `touch-action:none`
  on `.bCanvas` and `.bpiece`. `outfits.layout` write needs `migration/outfit_layout.sql`.
- **Trip weather (Open-Meteo)**: geocoding (`geocoding-api.open-meteo.com`), forecast
  (`api.open-meteo.com`, today−92d→+15d), ERA5 archive (`archive-api.open-meteo.com`).
  Far-future dates use 3-yr historical average (gray "avg" card). `_wxCache` 10-min TTL.
- **`activeCapsuleId`** scopes Closet (`lensItems()` returns only capsule members) AND
  Looks (`looksScopedOutfits()` keeps only wearable looks). Does **not** clear on tab switch.
  Set by `planFromCapsule(id)` — from the capsule detail ("Plan outfits from this") OR from
  the **closet root** "Filter by capsule or trip" button (`openClosetCapsuleFilter`, shown
  when not already scoped). Cleared only by banner ✕ (`[data-cap-clear]`) or deleting the capsule.
- **Capsules: nested-button gotcha** — inner tap targets inside `.gtile` must be `<div>`,
  not `<button>`. Parser hoists nested buttons as siblings; `.gtile .pack-tick` won't match.
- **`capsule_items.packed`**: inserts omit it (pre-migration safe); only `togglePack()`
  PATCHes it. Needs `migration/capsule_items_packed.sql` before using tick feature.
- **`[data-sv]` on stats field pages** must use `:not([data-sf])` to avoid filter chips
  (which carry both attributes) also triggering grid navigation. Same for donut highlight.
- **`statsRebuild()`** handles grid state transitions then calls `renderStats()`.
  `wireStatsToolbar()` wires `#stBack` + `#stFilter` — call at end of every stats render.
- **Stats date range** only affects wear-count lists (most/least worn, never worn).
  CPW uses all-time `wearCount`. `wearCountInRange(itemId)` for range-aware counts.
- **Closet Review inline editing**: `_rvPending` holds the pending value for the current
  card. `renderReviewInline(fieldKey)` returns chip HTML. Resets on every `reviewAfterEdit()`
  or `reviewSkip()`. Category/subcategory fall through to sheet-based editing.
- **`siblingItems()`** derives the current browsing context list (searchResults → sub →
  cat → lensItems) for item prev/next navigation in `openItem()`.

## Back-burner (not in current round)

- Reorder capsules (needs an `order` column)
- Crop/rotate photo editor
- ~~Outfit feedback~~ → hearts scheduled in ROADMAP v2 Wave 3 (👎 still rejected)
- ~~Outfit of the day on Home~~ → scheduled in ROADMAP v2 Wave 7
- Capsule-scoped suggestions improvements: variety seeding, multi-anchor, constraints
- ~~Wear-logging loop overhaul~~ → scheduled in ROADMAP v2 Waves 1+5

**Shipped 2026-06-27 r3:**
- Multi-exclude UI (r4) — `openExcludeSheet` lists every unordered PAIR among the shown pieces as a
  toggle row (`.ex-pair`, `data-expair="<a:b>"`); user ticks the specific clashing pairs (A×B without
  A×C). Already-excluded pairs render locked. Each ticked pair → its own exclusion. NOT subset-pairwise.
- Context typeahead — `renderContextPicker` "+ Add…" input live-filters `contextOptions()` + tap to
  pick/create. `_ctxAddOpen` tracks the expanded state (reset in every picker opener).
- `wears.formality_for` capture — `openPostLogSheet` now also fires after suggestion "Wear today",
  calendar +Clothing (`saveCalClothingLog`), and calendar +Look (`logLookOnDay`).
- Guessed-value indication — `REVIEW_FIELDS` season + formality carry `guess`/`guessLabel`;
  `renderReviewDeal` pre-fills the derived value and shows a `.rv-guess-hint` that clears on edit.
  `date_is_guess` intentionally NOT routed to review (would flood the queue).
- Builder subcat drill + scoped search (Phase 3a) — confirmed already implemented in `builderPickContent`.
- Auto-refresh trip weather — `_wxAutoTimer` re-fetches every `WX_TTL` while a trip detail is open
  (cleared in `renderCapsules` + `switchTab`); manual ↻ button (`[data-wx-refresh]`) in Locations header.

## Deploy

Commit `index.html` → push to `origin/main` → Pages deploys in ~1–2 min. See the
`deploy-wardrobe` skill. Repo: aluke0311/wardrobe_app. Live:
https://aluke0311.github.io/wardrobe_app/

## Local preview

`.claude/launch.json` runs `python3 -m http.server 4173` for the Claude preview
panel (the port is passed explicitly as of 2026-07-09 — it used to default to 8000
while the panel proxied 4173). Auth/data only fully work against the real
`https://` deploy; locally you get the login screen, but the whole script parses
and pure helpers are testable from the console. ⚠️ The panel's browser caches
index.html — always load with a fresh query string (`/?v=<anything>`).

**Self-test harness (2026-07-18): `migration/selftest.html`** — open
`http://localhost:4173/migration/selftest.html?v=<bust>` in the preview browser;
it loads the app in an iframe and asserts the derivation logic (trip phases,
sort keys incl. the legacy `"color"` mapping, laundry dirty/overrides,
formality, recap math, exclusions, version-lockstep). Summary line = `N/N
passed` — currently **312/312** (2026-08-17 r2, RUN GREEN — it DROPPED from 428 when the pack solver's 121 cases went with the solver; a shrinking suite can be a good sign). The count went 124 → 131 → 152 over 2026-07-26; it had earlier DROPPED from 136 when r19 deleted the guessing layer and its cases — a shrinking suite can be a good sign, say so plainly rather than padding. **It is a deploy gate for logic
changes** (skipped for CSS/copy/version-only deploys, which get a JavaScriptCore
parse-check instead) — the trigger list is step 0 of the `deploy-wardrobe`
skill. **Add a test whenever a session's ad-hoc console verification proves
something worth keeping true.** ⚠️ `ta(name, asyncFn)` is the async variant
(added 2026-07-26 for the kv conflict cases); `run()` awaits every pending one
before rendering, since an assertion landing after the summary is drawn would be
silently dropped. **Async cases that stub a global (e.g. `rest`) MUST be
`await`ed one at a time** — run concurrently they observe each other's stubs,
which is exactly how the first three failed. Gotchas baked in: app globals are top-level
const/let (invisible on `contentWindow` — the harness injects an eval-bridge
Proxy), and Sets passed into app code must be created in the IFRAME's realm
(`W.Set`) or `instanceof Set` fails. The iframe is parked **off-screen**, not
`display:none` — a display:none subtree has no layout, so every
`getBoundingClientRect()` in it returns 0 and layout assertions silently pass
on zeros (2026-07-26). Layout regressions are testable because of this; the
full-width-button case measures detached nodes in a 390px host.

⚠️⚠️ **THE GATE ITSELF WAS BROKEN FROM THE FILE SPLIT UNTIL 2026-07-26 — read
this before "improving" the harness's loading.** The 2026-07-25 fix (re-fetch
every module with `cache:"reload"` so mid-session edits are visible) was
requesting **`/migration/js/*.js`** — the harness lives at `/migration/`, so
every one of those 21 relative fetches was a 404. `fetch()` does not throw on
404, so it looked like it worked, and nothing was ever refreshed. Since
`index.html`'s tags carry `?v=<APP_VERSION>` and that only changes on deploy,
**every edit made without a version bump kept the same URL and the iframe
replayed the cached copy.** Measured: a freshly edited `js/14-calendar.js`,
correct on disk and on the wire, with the iframe still executing the previous
copy and 129 cases passing against it. Three things now stop it recurring, and
all three matter:
① fetches are **`/`-prefixed** and **throw on `!r.ok`**, so a 404 can never be
silent again; ② the iframe no longer trusts cache semantics at all — the harness
rewrites index.html with a **per-run token on every `js/`+`css/` URL** and hands
it over via **`srcdoc`** plus an injected **`<base href="/">`** (without the
base, relative URLs resolve against `/migration/` and the app loads nothing); ③
a case asserts every live function's `toString()` is a substring of the
freshly-fetched file — divergence means the iframe is stale.

⚠️ **A test that has never been executed is not a test — and a test that
can't fail is worse, because it reports success.** Two real instances: the
harness sat at 89/90 for a round of deploys because the r11 `statsNavBack` case
drove a re-render with no data behind it; and the r1 (2026-07-26) icon and
sheet-registry cases both passed **vacuously against 404 bodies** for a full
deploy. When you add a case, run it AND prove it can fail — mutate the thing
it guards and watch it go red, in the same session.
