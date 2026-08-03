# THE RACK — design, decisions, and why

Companion to `js/20-rack.js`. Read this before changing anything about how the
rack is built, ordered, or refreshed. The file header carries the ⚠️ warnings;
this carries the reasoning and the conversation behind them.

Shipped 2026-07-26 (r6+r7). Reworked 2026-08-03 (r1) after a design conversation
that started with two questions from Alina and ended up rewriting most of the
derivation. **`AUDIT_2026-07-26.md` and `CLAUDE.md`'s rack entry are the other
two places this feature is documented; keep all three honest.**

---

## 1. What it is, and why it exists at all

A standing ~58-piece derived pool — "what's actually in play right now" — out of
a 476-piece closet. The suggester draws from it by default.

It exists because **the suggester is good inside a capsule and a slot machine
over the whole closet.** That was the diagnosis: the algorithm wasn't the
problem, the POOL was. A capsule of 40 pieces produces outfits she recognises as
hers; 476 pieces produce a random sample that happens to satisfy the constraints.

**It is derived, not curated.** Asked directly whether she'd sit down once a
month and pick what's in play, she said she probably wouldn't, but might
sometimes. So the app keeps the rack and she *nudges* it — pull a piece in, push
one out, whenever she feels like it. Skip a month and nothing breaks. **A feature
with upkeep would be abandoned, so this one has none.**

## 2. Her four conditions

She approved the rack narrowing the suggester's default pool on four conditions,
all of which are enforced in code and pinned by tests:

1. The rack is **always a visible screen** — a pool that quietly narrows the
   suggester has to be somewhere she can go and look.
2. The suggester **always names its pool** with a count and a **one-tap widen**.
3. **Pull-in works from anywhere** (any item photo view).
4. **Locking or seeding a non-rack piece never fails.** This is the line between
   a tool and a cage.

## 3. The three deliberate conflicts with older locked decisions

These are conflicts, not oversights. She approved all three knowingly.

- CLAUDE.md's suggestion rule is *"rescue-only: widens the pool, never narrows
  it"*. **The rack narrows.** It's allowed to because it is a labelled chip with
  a count and a one-tap widen, not an invisible filter. The earlier narrowing
  that burned her — a December trip somewhere warm, where asking for "Winter"
  filtered the sundress out before scoring could see the 84° forecast — was
  invisible. That's the difference, and it's the whole difference.
- *"By design there is NO unworn/last-worn weighting"* in the suggester. **The
  rack reintroduces recency**, through pool construction rather than scoring.
- Which creates a feedback loop: worn → on the rack → suggested → worn. Left
  alone that shrinks her working wardrobe over years — **the mirror would cause
  the thing it measures.** The dormant band is the answer.

## 4. The 2026-08-03 rework

Two questions from Alina drove all of it.

### 4a. "How much does the rack shift with each adjustment?"

Answering it honestly exposed the bug. Reasoning from the code:

- **The warm side barely moves, and that's correct.** Warmth is
  `(60 − days since worn) / 60`, so over a 7-day gap every unworn piece loses
  exactly 0.117 — a *uniform* shift that preserves the ranking perfectly. Only
  pieces she actually wore that week change position, by jumping to the top.
  That's the stability that was designed in, working.
- **The cold side was frozen.** Cold picks were sorted by `wearCount` descending
  among pieces untouched for 60+ days. All-time wear counts are almost static,
  and by definition these pieces aren't being worn — so the inputs to that sort
  essentially never changed. **The same nine pieces came back every rebuild,
  forever**, against a cold pool of several hundred. The mechanism that exists
  specifically to stop the rack calcifying had itself calcified.

### 4b. "What about pieces that are moderately worn? Not warm or cold?"

The split was binary at `RACK_WARM_DAYS` (60) — and the warm side was then **cut
to quota**. So a top worn five weeks ago was:

- too old to survive the rotation cut, and
- too recent to be eligible for the cold list at all.

It reached the rack only by accident (slot backfill, formality top-up, or a pin),
and when it finally aged past 60 days it joined the *back* of the frozen cold
queue and stayed invisible. **A dead zone on both sides of an arbitrary cliff.**
Nothing about a garment changes on day 60.

### 4c. What was built

**Three bands, named because they're the real distribution:**

| band | what it is | ordering |
|---|---|---|
| rotation | top N by recency | recency; **does not rotate** |
| steady | worn inside 60 days, below the rotation cut | round-robin |
| dormant | not worn inside 60 days (or never) | round-robin |

**Rotation is the ordering.** `seen[id]` counts how many rebuilds a piece has
been *offered* in steady/dormant without being worn; both queues are
least-offered-first. That guarantees turnover with no tuning — a piece that keeps
being passed over sinks and the next candidates get their turn. It is cleared the
moment she wears the piece (at the next rebuild, comparing `lastWorn` against the
previous rack's `built` date).

**One counter, two jobs.** Past `RACK_SEEN_LIMIT` (3) the same number surfaces
the piece under **"Worth a second look"** — her idea, and it falls straight out
of the rotation mechanism.

**Only ~26 of 58 slots rotate.** The 32 rotation slots rank by recency and stay
put, so the rack still looks like itself when she opens it. That trade —
some recognisability for coverage of the middle — was made explicitly.

**Sizes** (grown 46 → 58 at her request: *"some weeks will have more contexts and
formality levels"*), with the extra 12 going mostly to steady and dormant:

| slot | rotation | steady | dormant | total |
|---|---|---|---|---|
| Tops | 11 | 5 | 4 | 20 |
| Bottoms | 8 | 3 | 3 | 14 |
| Dresses | 3 | 2 | 1 | 6 |
| Shoes | 6 | 3 | 2 | 11 |
| Outerwear | 4 | 2 | 1 | 7 |
| | **32** | **15** | **11** | **58** |

Formality top-ups take the real total toward 65.

### 4d. Two bugs fixed in passing

- **The liked bonus was a band-decider.** `score()` was
  `warmth + (liked ? 0.15 : 0)` and the split was `score > 0` → warm,
  `score === 0` → cold. So a piece in a look she'd **hearted** but hadn't worn in
  60 days scored 0.15: it landed in the warm list ranked below everything worn in
  the last ~51 days (effectively never picked) **and** was excluded from the cold
  list, where it would have ranked well. Her hearted-but-neglected pieces —
  precisely the ones rediscovery is for — were the ones systematically shut out
  of it. Liked is now a tiebreak *within* a band.
- **The refresh never ran.** `rackEnsure()` — the only thing that checks
  staleness — was called from exactly two places: tapping the closet's rack row,
  and the "Rebuild now" button. Every *consumer* (the suggester's pool, the pool
  chip, the closet row's count) read `rackEffective()`, which checks nothing. So
  the 7-day cadence and the season-flip guard only ran **if she happened to visit
  the rack screen.** Three weeks of suggestions could come from a three-week-old
  rack, and a summer rack could survive into October. Now also called at boot and
  on suggester open — both cheap, since on six days out of seven `rackIsStale` is
  a date comparison that returns false.

## 5. "Worth a second look" — the tone rule

⚠️ **It states a fact and asks a question. It never guesses why.**

The app cannot tell "wrong for work" from "I don't like it any more" from "the
season tag is wrong". The r19 guessing layer is the standing proof that a wrong
guess costs more trust than a tap costs effort. So the sheet offers four answers
she picks from — wrong formality (opens the formality edit), wrong season (opens
the season edit), not right now (a longer push-out), moved on (Storage) — plus
"nothing's wrong, keep offering it", which resets the counter.

**There is deliberately no "get rid of this" recommendation and never a purchase
suggestion.** Same tone as "packed 3×, worn 0×": a sweater offered three times
may simply be waiting for a cold snap.

## 6. Standing rules (do not undo)

- **The dormant quota is load-bearing.** Not a nicety. See §3.
- **Laundry is deliberately ignored.** If dirty pieces fell off, the rack would
  churn daily and stop being recognisable. The suggester's own `cleanOnly` runs
  on top, so a dirty piece is *on* the rack and simply isn't offered today.
- **Workout never uses the rack.** `buildRack` excludes the Workout category on
  purpose — her words, *"those clothes don't really mix with the rest of my
  clothing"* — so filtering the rack by gear would return a pool that can never
  form an outfit. Level 1 (Utility) draws from the whole closet. There is
  deliberately **no second "workout rack"**: a rack exists to shrink 476 pieces
  to ~58, and the gear set is already small, so one would add a concept and
  shrink nothing.
- **During a trip the suitcase IS the rack.** They never compose — the
  intersection could be four items. `planningPool` owns this precedence, and both
  the suggester and the Tomorrow card go through it.
- **`RACK_LOOKAHEAD_DAYS` (14) is what keeps a distant declared event out of
  today's rack.** Don't widen it for a new feature.
- **"Vary this" opens on the whole closet** on purpose — it works from one saved
  outfit, not from "what's in play".

## 7. Rejected in these conversations

- ~~**Filtering the week planner's suggestions by the laundry forecast.**~~
  ⚠️ **REVERSED 2026-08-03 r5.** The original call — warn, never filter — was
  right for the planner's own day CARDS and wrong for SUGGESTIONS: she reported
  a tank top planned for one day still being offered for the next, i.e. the app
  actively recommending something it knew would be in the hamper. The rule was
  never "don't narrow", it was "don't narrow INVISIBLY", and the rack is the
  precedent for how: "Clean only" now means clean on the day she's dressing, the
  chip reads "Clean on Thu · N out", and one tap widens it. The planner's cards
  still warn rather than filter — that part stands.
- **Guessing why a piece keeps being passed over.** See §5.
- **A second "workout rack".** See §6.
- **Rebuilding the trip-detection guessing layer** (r19) in any form. A wrong
  guess costs more trust than hand-entry costs taps — locked 2026-07-25.

## 8. Where it's tested

`migration/selftest.html`, the "THE RACK" block. The cases that must never be
relaxed:

- every slot fills to its quota
- the dormant quota is reserved in **every** slot
- dormant pieces really are ones she hasn't reached for
- **the steady band carries pieces the rotation cut left behind**, meets its
  per-slot quota, and reaches into the old dead zone
- rotation is ranked by recency and does **not** rotate
- **a liked piece she hasn't worn can still be a dormant pick**
- **a piece offered and passed over steps aside for the next one**
- a stale or old-format rack is rebuilt; a fresh one is left alone
- locking and seeding an off-rack piece still return outfits containing it
- during a trip the suitcase is the pool, and the rack chip stays out of the way
- the pool chip always names the pool and its count
