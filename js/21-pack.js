/* ===================================================================
   THE TRIP BUILDER — "pack plan"   (2026-07-29)

   Full spec, locked decisions and rejected alternatives: TRIP_BUILDER.md in
   the repo root. This file is phase 1: the derivations and the solver. Pure —
   no UI, no writes, every input injectable so the selftest can drive it.

   THE THREE INVERSIONS, one line each, because getting any of them backwards
   produces a plausible-looking WRONG answer rather than an obvious failure:

   ① OUTFITS FIRST — the pack is the union of their pieces. Set cover over
      (slot, formality) cells cannot work: cells are not independent, so it
      happily returns a pack where every cell is satisfied and no wearable
      outfit exists (three tops that all clash with the one bottom). Counts
      are an OUTPUT here, never a target.
   ② SCHEDULE, DON'T DIVIDE — ceil(wear-days / tolerance) breaks on uneven
      distribution and on the multi-outfit day, and can never name a day.
      packSchedule walks the dates, so infeasibility arrives WITH A DATE.
   ③ THE SOLVE IS AN EVENT, NOT A FUNCTION — packSolve's output becomes state
      (capsule_items + capsules.plan). Edits mutate that state; nothing
      re-enters the solver except an explicit re-solve. Same model as the
      rack: stability is the feature, and a pack that reshuffles eight pieces
      because she swapped one shirt is a slot machine.
   =================================================================== */

const PACK_KEY_PREFIX = "pack:";        // kv: the solve record, per capsule
/* The OCCASION-ID SCHEME the stored assignment is keyed by. 1 = the positional
   `${date}#${index}` ids, 2 = content-derived (see packOccId).
   ⚠️ Deliberately NOT a PACK_ALGO. RACK_ALGO exists because the rack is cached
   derived state that SHOULD be thrown away when the algorithm changes; the pack
   record is her state (inversion ③) and re-deriving it on a deploy is exactly
   what must not happen. This is a one-shot remap marker, not a staleness stamp. */
const PACK_ASSIGN_V = 2;

// Options per occasion (D5). This is the tightness dial, and it is what makes
// "minimize pack size" SAFE as an objective — K carries the variety requirement
// structurally, so the optimiser can't answer a 10-day trip with one pair of
// shoes. Without it the objective calcifies, exactly as RACK_COLD_SHARE exists
// to prevent at home.
const PACK_OPTIONS = { lean: 1, normal: 2, cushion: 3 };
const PACK_RESTARTS = 240;              // stochastic greedy restarts
const PACK_CANDIDATES_PER_OCC = 8;      // outfits OFFERED to her per occasion
/* ⚠️ LOAD-BEARING. What the SOLVER sees, and it must be much larger than the
   handful she's offered. At 8 the top combos by score are near-duplicates of
   each other — same shirt, different shoes — so the laundry constraint had
   nothing to choose from and a 10-day trip on tolerance-1 tees came back with
   five violations its closet could easily have avoided.
   Mutation-checked 2026-07-29: dropping this to 8 turns the "stays inside
   tolerance" case red, and neither a small limit nor score-ordering alone does
   it — it takes both, which is why this constant carries the warning and
   packDiversify does not. */
const PACK_SOLVE_CANDIDATES = 120;
const PACK_ENUM_CAP = 400;              // combo enumeration cap inside a pack
const PACK_ADD_TRIES = 12;              // additions tested when short on options
const PACK_OPT_GUARD = 6;               // max pieces added per occasion for options
/* Ceiling on the per-group option target — see optionTarget in packSolve. A
   fortnight at one level should not go chasing fourteen distinct looks; past
   about a week of variety the bag is the problem, not the repetition. */
const PACK_OPT_MAX = 7;
/* How hard stage C is allowed to push for variety, strongest first — see the
   strengths loop in packSolve. Anything below the last of these is not worth a
   pass: it would move one occasion and call it a win. */
const PACK_REPAIR_STRENGTHS = [1, 0.5, 0.25];

// A trip-sized rack. RACK_SLOT_QUOTA is calibrated for one day at home; ten
// days with two dress-coded evenings needs more to draw from. Passed to
// buildRack as `quota` — the cold share is untouched and stays load-bearing.
const PACK_TRIP_QUOTA = { Tops: 20, Bottoms: 12, Dresses: 8, Shoes: 10, Outerwear: 5 };

/* ---- repetition penalties (2026-07-29 r4) --------------------------------
   ⚠️ FOUND BY RENDERING THE SCREEN, not by a test. A 5-day trip came back with
   Thursday and Friday as the IDENTICAL outfit and one sweater going out on 4 of
   5 days at exactly its tolerance ceiling. Zero violations, minimum pieces —
   "correct", and it reads as the app failing.
   The laundry counter only stops a piece exceeding its tolerance; it says
   nothing about a trip that LOOKS the same every day, and shoes (Infinity) and
   sweaters (4) sail straight through it. K guards how many options EXIST in the
   pack, not whether consecutive days differ — that is a real gap in D5's
   mechanism, so the cost function has to close it.
   Weighted so reuse of bottoms and shoes stays free (packing light is the whole
   point) and repetition is charged on the VISIBLE half: same outfit twice
   running is worth ~3 extra pieces, the same top on a third day about a
   quarter of one. */
const PACK_REPEAT_DAY = 1500;   // identical outfit on consecutive days (~1.5 pieces)
const PACK_REPEAT_ANY = 400;    // identical outfit again later in the trip
const PACK_REPEAT_TOP = 150;
/* ⚠️ WHAT MAKES "PROVEN" A TIER RATHER THAN A THUMB ON THE SCALE (2026-08-09).
   Sitting proven outfits in the candidate list does nothing on its own — the
   solver costs by pieces added and repetition, so an outfit she has actually
   worn loses to any generated one that happens to add the same pieces.
   This is deliberately SMALL: `added * 1000` and the repetition floors both
   dwarf it, so it can never make the bag bigger, never buy a repeated look, and
   never override a laundry violation (5000). It decides between candidates that
   are otherwise equal — which is exactly what "prefer the one she's worn"
   should mean, and no more. */
const PACK_WORN_BONUS = 600;    // an outfit she has worn
const PACK_SHAPE_BONUS = 220;   // a shape she rebuilds, other pieces    // per earlier DAY this top/dress already went out
/* ⚠️ The suggester's own combo score spreads only about 2.5–5.5 points
   (measured), so against cost terms of 1000–5000 it was pure rounding error —
   the engine's formality cohesion, colour-pair and item-pair affinity were
   being thrown away. Scaling it up makes quality a real tie-breaker between
   options with the same piece count (a full spread ≈ half a piece) without
   letting it override the objective. Same reason PACK_PROVEN_W isn't 20 any
   more. Re-measure these if scoreCombo's range ever changes. */
const PACK_SCORE_W = 150;       // weight on the suggester's own combo score
const PACK_PROVEN_W = 60;       // per piece proven on past trips

/* The occasion on a plane day. ⚠️ NOT TRIP_CONTEXT ("Travel") — she tags Travel
   on every wear of a trip, which tripWearContext already does automatically, so
   Travel is a trip-wide fact and never an event. Flight is the event. */
const PACK_FLIGHT_CONTEXT = "Flight";

const PACK_BULKY_SUBCATS = ["Coats", "Boots"];   // wear-don't-pack advice (D9)
const PACK_GRADE_MIN_DAYS = 3;                   // logged days before self-grading speaks

/* ---- determinism (inversion ③) -------------------------------------------
   suggestOutfits samples with Math.random (Fisher–Yates per slot + a softmax
   pick), which is right for the sheet and wrong for a pack she should be able
   to recognise when she reopens it. Rather than fork the engine — the one thing
   inversion ① forbids — drive it under a seeded RNG.
   ⚠️ This swaps the global Math.random for the duration of a SYNCHRONOUS call.
   suggestOutfits contains no awaits, which is what makes that safe; if it ever
   gains one, this breaks and must become an explicit rng parameter. */
function packRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function packHash(str) {
  let h = 2166136261;
  for (let k = 0; k < str.length; k++) { h ^= str.charCodeAt(k); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function packWithSeed(seed, fn) {
  const real = Math.random;
  Math.random = packRng(seed);
  try { return fn(); } finally { Math.random = real; }
}

/* ---- legs: one climate per stretch of dates ------------------------------
   Madrid then Javea is two climates and effectively two packs, so the rack is
   built PER LEG and unioned (a single call with one weather band filters out
   half of what the trip needs). buildTripWeather groups its fetches the same
   way and now calls this, so there is one definition. */
function tripLocForDate(locs, ds) {
  const specific = locs.filter(l => l.from && l.to && ds >= l.from && ds <= l.to);
  if (specific.length) return specific[specific.length - 1];
  const partial = locs.find(l => (l.from && !l.to && ds >= l.from) || (!l.from && l.to && ds <= l.to));
  if (partial) return partial;
  return locs.find(l => !l.from && !l.to) || locs[0];
}
function tripLegs(c) {
  if (!c || !c.start_date || !c.end_date) return [];
  const locs = c.locations || [];
  if (!locs.length) return [];
  const out = [];
  let curKey = null, curLoc = null, curDates = [];
  for (const ds of tripDates(c)) {
    const loc = tripLocForDate(locs, ds);
    const key = loc ? `${loc.lat},${loc.lon}` : null;
    if (key !== curKey) {
      if (curDates.length && curLoc) out.push({ loc: curLoc, dates: curDates });
      curKey = key; curLoc = loc; curDates = [ds];
    } else curDates.push(ds);
  }
  if (curDates.length && curLoc) out.push({ loc: curLoc, dates: curDates });
  return out;
}
// Every trip has at least one leg for solving purposes, even with no locations
// set (no weather, season only — labelled in the UI, never silently absorbed).
function packLegsOrWhole(c) {
  const legs = tripLegs(c);
  return legs.length ? legs : [{ loc: null, dates: tripDates(c) }];
}

/* ---- the trip's contexts (2026-07-30 r5) --------------------------------
   Her correction, and it supersedes the character chip as the way "what's
   happening" is captured: *"give me a list of contexts and i select all. not by
   date. context should also be able to select formality level (eg it says
   party/shower polished casual but i will do party/shower - dressed up)."*

   So the capture is a FLAT multi-select over every context she has, each
   carrying its own formality FOR THIS TRIP. No dates, no trip type.
   Shape: [{ ctx, level, n }] — level null means "use the usual one for this
   context", n is how many days of the trip it takes up.
   ⚠️ Stored on the pack record, NOT in dayplan: dayplan is per-DATE, and this is
   deliberately date-free. Fixed events on a specific day still go to dayplan and
   are still honoured first (pass ① in packSlate). */
function packTripContexts(cid) {
  const v = packRecord(cid).contexts;
  return Array.isArray(v) ? v.filter(e => e && e.ctx) : null;
}
async function setPackTripContexts(cid, list) {
  await savePackRecord(cid, { contexts: Array.isArray(list) ? list : null });
  packInvalidateState(cid);
}

/* ---- occasions she's dropped (2026-08-06 r2) ----------------------------
   Her report: the pack plans for a wedding she never selected. It came from a
   `dayplan` entry — a calendar event on a trip date — which pass ① regenerates
   on every single build, and which the "What's happening" sheet doesn't list,
   so there was no way to say "not part of this trip".
   ⚠️ PACK-SCOPED, AND IT NEVER WRITES `dayplan`. The event stays on her
   calendar; this only says it isn't part of the packing. An app that deleted
   her calendar entry to satisfy a packing screen would be the app arguing with
   her, which she has already reported once. */
function packDroppedOccasions(cid) {
  const v = packRecord(cid).dropped;
  return new Set(Array.isArray(v) ? v.filter(x => typeof x === "string") : []);
}
async function setPackDropped(cid, ids) {
  await savePackRecord(cid, { dropped: [...(ids || [])] });
  packInvalidateState(cid);
}

/* ONE derivation, every surface. The slate and demand were built independently
   in three places, so a filter applied to only one of them would leave dropped
   occasions showing on the others — the same "two surfaces, one derivation"
   rule tripRecapData follows. */
/* Days she scheduled herself: { occId: "YYYY-MM-DD" }. Only `selected`
   occasions can be here — see the note in packSlate. */
function packOccDates(cid) {
  const d = packRecord(cid).occDates;
  return d && typeof d === "object" ? d : {};
}
async function packSetOccDate(cid, occId, date) {
  const all = { ...packOccDates(cid) };
  if (date) all[occId] = date; else delete all[occId];
  await savePackRecord(cid, { occDates: all });
}

/* ---- "don't plan around it" (2026-08-10 r3) --------------------------------
   Her ask: *"I want the packing algorithm to try to use the whole list unless I
   mark something as 'do not plan'. We can still have extras but I don't want to
   artificially limit myself."*

   So the default flipped: everything in the trip's list is something the solver
   should try to build with, and THIS is the opt-out. It is deliberately not
   `banned`, which means "don't put this in the bag at all" — a piece marked here
   is still packed, still on the checklist, still hers. The app just stops
   building outfits around it.
   ⚠️ IT IMPLIES KEPT. A piece nothing plans around appears in no outfit, which
   makes it "spare" — and the mode trims spare. Without the pin, saying "don't
   plan around this" would be a slow way of deleting it from the trip. */
function packNoPlan(cid) { return new Set(packRecord(cid).noplan || []); }
async function packSetNoPlan(cid, ids, on) {
  const set = packNoPlan(cid);
  const keeps = new Set(packRecord(cid).pinned || []);
  for (const id of (ids || [])) {
    if (on) { set.add(id); keeps.add(id); } else set.delete(id);
  }
  await savePackRecord(cid, { noplan: [...set], pinned: [...keeps] });
  packInvalidateState(cid);
}

function packDemandFor(cid, c, { wearRows = null, tripContexts = undefined } = {}) {
  const cap = c || capsuleById.get(cid);
  if (!cap) return { slate: [], demand: [] };
  const slate = packSlate(cap, {
    wearRows,
    tripContexts: tripContexts === undefined ? packTripContexts(cid) : tripContexts,
    dropped: packDroppedOccasions(cid),
    pins: packOccDates(cid),
  });
  const demand = packDemand(slate);
  /* Her per-occasion constraints ride ON the occasion, the same way `level` and
     `leg` do, so every consumer — the solver, the cards, the options sheet, the
     coverage report — sees them without a second lookup that could go stale.
     ⚠️ This is the ONE derivation all four callers share (packLoadState,
     packDiff, packPlanByDate, packMidTripWash), which is exactly why the drop
     filter lives here too: attaching prefs anywhere else would let one screen
     honour a constraint another screen ignores. */
  for (const o of demand) {
    const p = effectivePrefs(o.context, packOccPref(cid, o.id));
    if (p) o.prefs = p;
  }
  return { slate, demand };
}

/* Anything that changes what the trip CONTAINS must drop the cached screen
   state, or packStateReady's `_packState.cid === cid` short-circuit serves the
   old demand to every handler reachable from the by-day planner and the dash. */
function packInvalidateState(cid) {
  if (_packState && _packState.cid === cid) _packState = null;
}

/* What to tick when she opens the list for the first time. The app proposes and
   she revises — the same contract as the count dials. Uses her real history:
   contexts she actually wears, most-used first, capped so the list opens with a
   plausible trip rather than everything. */
function packSuggestTripContexts(c, { wearRows = null, today = null } = {}) {
  const rows = wearRows || wears;
  const days = tripDates(c).length || 1;
  const counts = countByDay(rows, ctxArr);
  const skip = new Set([TRIP_CONTEXT, PACK_FLIGHT_CONTEXT]);
  const ranked = [...counts.entries()]
    .filter(([ctx, n]) => n > 0 && !skip.has(ctx))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([ctx]) => ctx);
  if (!ranked.length) return [];
  // Spread the trip's days over the picked contexts by how often she lives them.
  const tot = ranked.reduce((s, ctx) => s + (counts.get(ctx) || 1), 0);
  const free = Math.max(1, days - 2);           // the two plane days are claimed
  const out = ranked.map(ctx => ({ ctx, level: null, n: Math.max(1, Math.round(free * (counts.get(ctx) || 1) / tot)) }));
  return out;
}

/* ---- the slate ----------------------------------------------------------
   Demand is a MULTISET of occasions; placement is optional metadata (D6). What
   this builds is the placed view, because a mid-trip wash needs to know WHICH
   days — with no wash the trip is one stretch and placement is irrelevant.

   ⚠️ ONE source for "what's happening": the contexts she ticked (or, until she
   has, packSuggestTripContexts' proposal from her own history). The weekday
   rhythm and trip-character passes that used to guess this are GONE — 2026-07-30
   r6, her words: "I'm still seeing trip types and things that i've asked not to
   have." Fixed events on a date still win, because those are facts.

   Placement across days is computed (the laundry schedule needs dates) but never
   asked for. */
function packSlate(c, { plans = null, wearRows = null, today = null, tripContexts = null,
                        dropped = null, legacyPlacement = false, pins = null } = {}) {
  const dates = tripDates(c);
  if (!dates.length) return [];
  const rows = wearRows || wears;
  const all = plans || dayPlanAll();

  const lvlOf = (ctx) => contextFormalityLevel(ctx, rows) || CONTEXT_FORMALITY_SEED[ctx] || null;
  const legOf = new Map();
  for (const leg of packLegsOrWhole(c)) for (const d of leg.dates) legOf.set(d, leg);
  const slate = dates.map(date => ({ date, leg: legOf.get(date) || null, occasions: [] }));
  const byDate = new Map(slate.map(s => [s.date, s]));
  const drop = dropped instanceof Set ? dropped : new Set(dropped || []);

  /* Her selection is read up front because ① needs it: a level she set for a
     context ON THIS TRIP also governs a calendar event carrying that context.
     ⚠️ AN EMPTY ARRAY IS A DECISION; only null/undefined means "she hasn't said".
     Falling back on `.length` handed the proposal back to someone who had just
     cleared the list — which is one of the ways contexts she never chose kept
     turning up in the outfits (2026-08-05). */
  const picked = Array.isArray(tripContexts)
    ? tripContexts
    : packSuggestTripContexts(c, { wearRows: rows, today });
  const pickedLvl = new Map();
  for (const e of (picked || [])) if (e && e.ctx && e.level) pickedLvl.set(e.ctx, e.level);

  // ① Fixed events she declared for a specific date. Facts beat everything.
  for (const s of slate) {
    const nth = new Map();
    for (const e of (all[s.date] || [])) {
      const ctxs = (e.contexts || []).filter(Boolean);
      if (!ctxs.length && !e.level) continue;
      /* ⚠️ An explicit level WINS over the context-derived one: "hone the
         individual events by formality when context is not sufficient".
         ⚠️ AND SO DOES THE LEVEL SHE SET FOR THIS TRIP. Her Stl trip carried
         Party/Shower twice — a calendar event at 4 (her HISTORY's usual level)
         beside her own tick at 6 — so the app was dressing one context at two
         levels on one trip. Same discard contextFormalityLevel was written to
         fix for the suggester, arriving through dayplan. */
      const mine = ctxs.map(x => pickedLvl.get(x)).filter(Boolean);
      const lvl = e.level
        || (mine.length ? Math.max(...mine)
                        : (ctxs.length ? Math.max(...ctxs.map(x => lvlOf(x) || 0)) : 0));
      const pinned = !!(e.level || mine.length);
      const ident = `dec|${ctxs.slice().sort().join("+")}|${pinned ? "L" + lvl : ""}`;
      const n = nth.get(ident) || 0;
      nth.set(ident, n + 1);
      s.occasions.push({ context: ctxs[0] || null, contexts: ctxs, level: lvl || null,
                         placed: true, source: "declared", pinnedLevel: pinned,
                         _ident: ident, _nth: n });
    }
  }

  /* ② Flight days, claimed BEFORE anything spreads.
     ⚠️ The plane-day occasion is FLIGHT, not Travel — she tags Travel on every
     wear of a trip (tripWearContext already does that automatically), so Travel
     is a trip-wide fact and must never generate occasions, or a 6-day trip
     invents six of them and inflates the laundry maths with them.
     Claiming these first is what stops the departure day collecting a stack of
     occasions, and it's also the travel-home reserve: the return day always
     carries an occasion, so the schedule walk notices a trip that burns its last
     clean bottoms on day 8. */
  for (const d of [dates[0], dates[dates.length - 1]]) {
    const s = byDate.get(d);
    if (!s) continue;
    if (!s.occasions.some(o => (o.contexts || []).includes(PACK_FLIGHT_CONTEXT))) {
      s.occasions.push({ context: PACK_FLIGHT_CONTEXT, contexts: [PACK_FLIGHT_CONTEXT],
                         level: lvlOf(PACK_FLIGHT_CONTEXT), placed: true, source: "flight",
                         _ident: "fly", _nth: 0 });
    }
  }

  /* ③ Her selection, spread across the WHOLE trip — a day can carry two
     occasions, which is why demand is a multiset rather than a day grid.

     ⚠️ PLACE ON THE LEAST-LOADED DAY, NEVER ON A FIXED LIST OF "FREE" DAYS.
     The old version computed `free` once and then cycled it with
     `k % pool.length`, so the moment the free days were used it stacked a
     SECOND occasion of the same context onto a day that already had one — and
     two same-context occasions on one day merge into a single card on screen
     while still costing laundry and options. Measured on her Stl trip: 9
     occasions asked for on a 5-day trip whose other days were claimed by two
     flights and two calendar events, leaving 2 free days; Home×4 landed as two
     pairs and came back as TWO IDENTICAL OUTFITS. That is the whole of her
     "two identical outfits for four days of the same context" report, and it
     was the slate, not the solver.
     ⚠️ Flight days take overflow like any other day. One extra occasion on a
     plane day is honest — she does change when she lands. The travel-last
     warning in TRIP_BUILDER.md is about ORDERING (② claims those days first so
     they can't collect a stack), not about keeping them empty forever. */
  const queues = (picked || []).filter(e => e && e.ctx)
    .map(e => ({ e, left: Math.max(1, e.n || 1), nth: 0 }));
  if (legacyPlacement) {
    // Only for migrating records keyed by the old positional ids — see
    // packMigrateRecord. Delete with the migration.
    const free = slate.filter(s => !s.occasions.length);
    const queue = [];
    for (const q of queues) for (let n = 0; n < q.left; n++) queue.push(q);
    let k = 0;
    for (const q of queue) {
      const pool = free.length ? free : slate;
      const s = pool[k % pool.length];
      k++;
      if (!s) break;
      s.occasions.push({ context: q.e.ctx, contexts: [q.e.ctx],
                         level: q.e.level || lvlOf(q.e.ctx), placed: false,
                         source: "selected", pinnedLevel: !!q.e.level,
                         _ident: `sel|${q.e.ctx}|${q.e.level ? "L" + q.e.level : ""}`,
                         _nth: q.nth++ });
    }
  } else {
    const load = new Map(slate.map(s => [s.date, s.occasions.length]));
    const ctxOn = (s, ctx) => s.occasions.reduce((n, o) => n + (o.context === ctx ? 1 : 0), 0);
    // Fewest occasions, then fewest of THIS context, then earliest date (slate
    // is already in date order, so taking the first strict minimum does that).
    const place = (ctx) => {
      let best = null, bl = 0, bc = 0;
      for (const s of slate) {
        const l = load.get(s.date) || 0, cn = ctxOn(s, ctx);
        if (!best || l < bl || (l === bl && cn < bc)) { best = s; bl = l; bc = cn; }
      }
      return best;
    };
    /* ⚠️ A DAY SHE SCHEDULED BEATS THE SPREADER (2026-08-09, her report: "need
       to be able to schedule the contexts, not just have things auto-assigned
       to days"). Auto-placement is a proposal; a date she set is a decision,
       and the same rule applies here as everywhere else in this rework.

       ⚠️ Pinned ones are placed FIRST, before the round-robin, so the spreader
       balances AROUND them instead of filling the good days and leaving her
       choice to collide. And ⚠️ only `selected` occasions can be scheduled:
       their ids are deliberately date-free (D6 — demand is a multiset), so
       moving one keeps its outfit. A declared or floor occasion is keyed BY its
       date, so "moving" it would orphan whatever she'd chosen for it. */
    /* ⚠️ THE IDS ARE MINTED UP FRONT, and getting this wrong is why the first
       version silently ignored her (2026-08-09). `_nth` is assigned as
       occasions are placed, so placing a pinned one first would renumber it and
       change the very id the pin is keyed on. Enumerate every occasion the
       selection will produce WITH its stable id, then place: her scheduled ones
       first, the rest spread around them. */
    const pinAt = pins || {};
    const wanted = [];
    for (const q of queues) {
      const ident = `sel|${q.e.ctx}|${q.e.level ? "L" + q.e.level : ""}`;
      for (let n = 0; n < q.left; n++) wanted.push({ q, nth: n, id: `${ident}#${n}`, ident });
      q.left = 0;
    }
    const mkAt = (w) => ({
      context: w.q.e.ctx, contexts: [w.q.e.ctx],
      level: w.q.e.level || lvlOf(w.q.e.ctx), placed: false,
      source: "selected", pinnedLevel: !!w.q.e.level,
      _ident: w.ident, _nth: w.nth,
    });
    const rest = [];
    for (const w of wanted) {
      const s = pinAt[w.id] ? byDate.get(pinAt[w.id]) : null;
      if (!s) { rest.push(w); continue; }
      s.occasions.push(mkAt(w));
      load.set(s.date, (load.get(s.date) || 0) + 1);
    }
    /* Round-robin across contexts, one each per pass, so a context with a big
       count can't take every good day before the others are placed. */
    const byCtx = new Map();
    for (const w of rest) {
      if (!byCtx.has(w.q)) byCtx.set(w.q, []);
      byCtx.get(w.q).push(w);
    }
    for (let live = true; live; ) {
      live = false;
      for (const list of byCtx.values()) {
        if (!list.length) continue;
        live = true;
        const w = list.shift();
        const s = place(w.q.e.ctx);
        if (!s) break;
        s.occasions.push(mkAt(w));
        load.set(s.date, (load.get(s.date) || 0) + 1);
      }
    }
  }

  /* ④ What she said isn't happening, removed BEFORE the floor pass — otherwise
     emptying a day just re-fills it at her modal level and the ✕ looks broken.
     ⚠️ Filtered on the SLATE, not only on the demand: packRack and
     packSlateAsPlans read the slate, and a dropped occasion that still stocks
     the trip rack is the 2026-08-06 r1 lesson (a declared level reaching a pool
     it has no business in) arriving one more time. */
  if (drop.size) for (const s of slate) {
    s.occasions = s.occasions.filter((o, idx) => !drop.has(packOccId(s.date, o, idx)));
  }

  // Anything still bare gets her modal level, so no day is ever unanswerable —
  // unless she has explicitly dropped that day, which is a legitimate answer.
  const floorLvl = packModalLevel(rows);
  for (const s of slate) {
    if (s.occasions.length) continue;
    if (drop.has(`${s.date}|flr#0`)) continue;
    s.occasions.push({ context: null, contexts: [], level: floorLvl, placed: false,
                       source: "floor", _ident: "flr", _nth: 0 });
  }
  return slate;
}
// The level she actually lives at — the fallback when nothing else says.
function packModalLevel(wearRows = null) {
  const rows = wearRows || wears;
  const byLevel = new Map(), seen = new Set();
  for (const w of rows) {
    if (!w.formality_for || !w.worn_on) continue;
    const k = w.formality_for + "|" + w.worn_on;
    if (seen.has(k)) continue;
    seen.add(k);
    byLevel.set(w.formality_for, (byLevel.get(w.formality_for) || 0) + 1);
  }
  const top = [...byLevel.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? +top[0] : 3;
}

/* An occasion's identity, and it is CONTENT-DERIVED, not positional.

   ⚠️ IT USED TO BE `${date}#${index}`, AND THAT IS A BUG WITH TEETH. The stored
   assignment, her locks and her drops are all keyed by this string, so an index
   means unticking one context silently renumbers every later occasion on the
   affected days — and packEnsureSolve's guard only asks "are these pieces still
   in the bag", which stays true, so nothing re-solves and the REMOVED
   occasion's outfit is handed to whatever moved into its slot. She sees the
   outfit she deleted, wearing a different label.

   ⚠️ A `selected` occasion is deliberately NOT date-anchored. Demand is a
   multiset (D6) and placement is metadata the laundry schedule needs — "Errands
   #2" is the same occasion wherever the spreader put it, so unticking some
   OTHER context, which re-spreads everything, must not orphan it.

   ⚠️ The level is in the key only when she PINNED it. Derived levels move as
   she logs wears, and an id that drifts on its own would orphan occasions she
   never touched — which is the inversion-③ violation this exists to prevent. */
function packOccId(date, o, idx = 0) {
  if (!o) return "";
  // ⚠️ A slate built by hand (fixtures, and any future caller that doesn't go
  // through packSlate) carries no ident — fall back to the position so two
  // occasions on one day can't collapse onto the same id.
  const ident = o._ident || `x${idx}`;
  const nth = o._nth || 0;
  return o.source === "selected" ? `${ident}#${nth}` : `${date}|${ident}#${nth}`;
}

/* What a stored outfit was solved AGAINST — the things that decide whether it is
   still an APPROPRIATE outfit. If any of them moved, the stored answer is stale
   even though the occasion still exists.

   ⚠️ NO DATE, and that was measured. The date was in here first, and it made
   unticking one context re-solve every OTHER context's outfits: removing a
   context re-spreads the rest, so their dates move, so every signature broke.
   That is precisely the churn the partial rehydrate exists to prevent — caught
   by the case that stores a hand-picked assignment the solver would never pick.
   The date's job is the laundry SCHEDULE, and packSchedule recomputes that from
   the assignment every time; a valid outfit on a different day is still a valid
   outfit, and if it now collides with tolerance the violation is reported.

   ⚠️ NO WEATHER BAND either. Weather loads asynchronously (packWxFor returns
   null until _planWxLoadedFor is set), so a band here would make rehydration
   depend on whether a fetch happened to have finished — a slot machine, and
   strictly worse than the bug it would be guarding. The LEG is in, because
   Madrid-then-Javea is two climates and that is known without a fetch. */
const packLegKey = (o) => (o && o.leg && o.leg.loc) ? `${o.leg.loc.lat},${o.leg.loc.lon}` : "";
function packOccSig(o) {
  if (!o) return "";
  return `${o.level || ""}|${packLegKey(o)}`;
}

/* TWO GROUPING KEYS, AND CONFLATING THEM COST HER HALF THE VARIETY TARGET.
   packCandKey (level + leg + temperature band) is a CACHE key: which occasions
   share one enumerated candidate list. The band belongs there — a genuinely
   cold day inside a long leg should not be offered the warm day's outfits.
   packDemandKey (level + leg) answers a different question: how many different
   looks does this trip need at this level in this place. That is a property of
   her days, not of the enumerator's caching strategy — and keying the count on
   the band split four mild days into two groups of two, so the target dropped
   from 4 to 2 and the two groups were then free to be satisfied by the SAME
   two looks, with no cross-group dedup anywhere. */
const packDemandKey = (o) => `${o ? o.level : ""}|${packLegKey(o)}`;

/* How many distinct looks a group of `n` occasions should be able to make.

   ⚠️ LEAN IS A SMALLER BAG, NOT A REPEATED OUTFIT (her decision, 2026-08-06 r2).
   This used to be `ceil(n/2)` at lean — four days of one context asked for two
   looks and got exactly that, by design, and the design was wrong. Her words on
   being told what lean meant: *"same as normal just a smaller bag. small
   numbers of clothes can make lots of different outfits."* She is right, and it
   is the better model: distinct looks are mostly a RECOMBINATION problem, not a
   piece-count one — four tops and two bottoms is eight looks, not four.
   So a different outfit per occasion is the floor at EVERY tightness, and K
   buys spare capacity above it.
   ⚠️ Hoisted out of packSolve so the policy is directly assertable. It lived in
   that closure, and a case written against its downstream EFFECT passed under a
   mutation restoring the old formula — on every fixture available the target is
   not the binding constraint, so only the contract itself can be tested. */
function packOptionTarget(n, K) {
  const spare = K <= PACK_OPTIONS.lean ? 0 : (K >= PACK_OPTIONS.cushion ? 2 : 1);
  return Math.max(1, Math.min((n || 1) + spare, PACK_OPT_MAX));
}

/* TWO OCCASIONS ON ONE DAY WERE FREE TO BE IDENTICAL, AND THAT IS HOW HER FOUR
   HOME DAYS BECAME TWO OUTFITS (2026-08-06 r2). `todayCombos` was written and
   drained into `usedCombos` at end of day but NEVER READ by the cost function,
   and `dayWorn` is only incremented once the day closes — so a second occasion
   on a day paid nothing for repeating the first, and `added` was 0 because the
   pieces were already in the bag. Repeating was strictly the cheapest move.

   ⚠️ CHARGED PER KIND, NOT PER DAY. "One outfit across contexts = one entry" is
   dayplan's own rule and the reason same-day cards merge — two DIFFERENT
   contexts sharing an outfit is a feature, and charging it would inflate the
   bag for no gain. What is never right is the same context, or two undeclared
   days at one level, coming back in identical clothes.
   ⚠️ Charged at PACK_REPEAT_DAY and deliberately NOT scaled by repW, for the
   same reason consecutive days aren't: it is the worst-looking output the
   solver can produce, so the floor holds at every tightness. */
const packOccKind = (o) => o && o.context ? `c:${o.context}` : `l:${o ? o.level || "" : ""}`;
function packNoteKind(map, occ, lookKey) {
  const k = packOccKind(occ);
  let s = map.get(k);
  if (!s) map.set(k, s = new Set());
  s.add(lookKey);
}

// Flatten the slate into the demand multiset.
function packDemand(slate, { legacyIds = false } = {}) {
  const out = [];
  for (const s of slate || []) {
    (s.occasions || []).forEach((o, idx) => {
      out.push({
        id: legacyIds ? `${s.date}#${idx}` : packOccId(s.date, o, idx),
        date: s.date, leg: s.leg,
        context: o.context || null, contexts: o.contexts || [],
        level: o.level || null, placed: !!o.placed, source: o.source || null,
        pinnedLevel: !!o.pinnedLevel,
      });
    });
  }
  return out;
}
// The slate as a dayplan-shaped object, so buildRack's rackNeededLevels can
// read the trip's declared levels without a second code path.
/* ⚠️ CARRY THE LEVEL, don't make the rack re-derive it (2026-08-05). Entries
   went over as contexts only, so rackNeededLevels/rackDeclaredLevels fell back
   to contextFormalityLevel — her HISTORY's usual level for that context — and
   threw away the level she set FOR THIS TRIP. A "Party/shower · Dressed Up"
   she'd declared arrived at the rack as whatever she usually wears to a
   party/shower, which is the exact discard contextFormalityLevel was written to
   fix for the suggester. Both readers check `e.level` first.
   ⚠️ Occasions with a level but no context are included now too — they are
   still a declared level, and dropping them under-declares the trip. */
function packSlateAsPlans(slate) {
  const out = {};
  for (const s of slate || []) {
    const entries = (s.occasions || [])
      .filter(o => (o.contexts || []).length || o.level)
      .map(o => ({ contexts: o.contexts || [], level: o.level || null, outfit: null }));
    if (entries.length) out[s.date] = entries;
  }
  return out;
}

/* ---- the pool: one rack per leg, unioned -------------------------------- */
function packRack(c, slate, { pool = null, wearRows = null, wxFor = null,
                             pinned = null, pushed = null, quota = null } = {}) {
  const plans = packSlateAsPlans(slate);
  const ids = new Set(), cold = new Set();
  const legs = packLegsOrWhole(c);
  for (const leg of legs) {
    const d0 = leg.dates[0];
    const built = buildRack({
      pool, wearRows, today: d0, season: seasonOf(d0),
      wx: wxFor ? wxFor(d0) : null, plans, pinned, pushed,
      quota: quota || PACK_TRIP_QUOTA,
    });
    for (const id of built.ids) ids.add(id);
    for (const id of built.cold) cold.add(id);
  }
  for (const id of ids) if (!cold.has(id)) cold.delete(id);
  return { ids: [...ids], cold: [...cold], legs: legs.length };
}

/* ---- per-occasion constraints: her "I'd rather…" -------------------------
   Her report, 2026-08-08: *"the pack suggesting a dress for a context I don't
   want one, and I can't really escape that as built."*

   She was right, and there was no escape anywhere. `packOccasionSlotFit` looks
   like the answer and isn't: it removes a silhouette she has NEVER worn for an
   occasion, derived from history, so ONE dress worn to one dinner permits
   dresses to that context forever — and swap, ✨ Another and Other options can
   each hand her another one. Nothing in the app let her simply SAY "not a dress
   for this".

   ⚠️ THESE ARE DECISIONS, NOT HEURISTICS, and that is the whole distinction the
   rework rests on. `packOccasionSlotFit` is rescue-shaped — if its narrowed pool
   can't build, the unfiltered pool is used instead, because a guess should never
   cost her an answer. A constraint she set must NOT behave that way: if it
   leaves nothing buildable the honest result is an uncovered occasion she can
   see and act on (§9), never a quiet override. An app that overrules her when
   the maths gets hard has not given her control, it has given her a suggestion
   box.
   ⚠️ Stored per OCCASION id, so it survives re-solves and re-spreads like every
   other user decision. `packOccId` is content-derived, so an unticked context
   elsewhere can't silently transfer her constraint to a different occasion. */
/* ⚠️ The MODEL lives in js/12-looks.js (contextPref / comboMeetsPrefs /
   effectivePrefs / prefsLabel) because her rule is about a KIND OF DAY, not
   about a trip — "no dresses to Church" holds on an ordinary Tuesday too. What
   belongs here is only the TRIP-SCOPED override: a rule she set on one
   occasion of one trip, which beats the standing context rule for that
   occasion and nothing else.
   ⚠️ Stored per `packOccId`, which is content-derived, so unticking some other
   context can't renumber occasions and silently transfer her rule to a day she
   never touched — the r3 bug with teeth, in a new place. */
function packOccPrefsAll(cid) {
  const p = packRecord(cid).occPrefs;
  return p && typeof p === "object" ? p : {};
}
function packOccPref(cid, occId) {
  const p = packOccPrefsAll(cid)[occId];
  return p && typeof p === "object" && Object.keys(p).length ? p : null;
}
async function packSetOccPref(cid, occId, patch) {
  const all = { ...packOccPrefsAll(cid) };
  const next = { ...(all[occId] || {}), ...patch };
  for (const k of Object.keys(next)) {
    const v = next[k];
    if (v == null || (Array.isArray(v) && !v.length)) delete next[k];
  }
  if (Object.keys(next).length) all[occId] = next; else delete all[occId];
  await savePackRecord(cid, { occPrefs: all });
}
async function packClearOccPref(cid, occId) {
  const all = { ...packOccPrefsAll(cid) };
  delete all[occId];
  await savePackRecord(cid, { occPrefs: all });
}
// The level she'll actually be dressed at, after any "more casual / dressier".
function packOccLevel(occ) {
  return prefLevel(occ && occ.level ? occ.level : null, occ && occ.prefs);
}

/* ---- candidates ---------------------------------------------------------
   ⚠️ cleanOnly = FALSE, deliberately. Laundry is a SCHEDULE constraint here
   (inversion ②), not a pool filter: a piece that's dirty today may be perfectly
   packable after a wash before departure, and filtering it out of the pool is
   the divide-don't-schedule bug wearing a different hat.
   ⚠️ Level 1 draws from the WHOLE closet, never the rack — buildRack excludes
   the Workout category on purpose, so a Utility occasion pooled from the rack
   can never form an outfit. Same precedence as _suggBasePool. */
/* ===================================================================
   PROVEN OUTFITS — packing from what she has actually worn (2026-08-09)
   ===================================================================
   Her report: *"what about pulling in outfits I've already worn — you KNOW
   those are outfits I would create. The packer is still creating outfits I
   wouldn't really wear."*

   Measured on a closet with a real outfit history (167 pieces, 420 worn looks),
   7-day trip, 8 occasions:
       current packer    13 pieces · 7 distinct looks · 0 outfits she's worn
       proven + distinct 10 pieces · 8 distinct looks · 8 outfits she's worn
   Smaller bag, MORE variety, every outfit proven. And there were 298 worn
   outfits fitting each occasion's level of which only 2 survived inside the bag
   the old packer built — picking pieces first is what destroys the
   combinations.

   ⚠️ THE SOLVER IS UNCHANGED. This changes what it chooses FROM, nothing else:
   distinctness, the laundry schedule, repetition costs, core/spare and the
   review all work on `{ids, pieces, score}` and don't care where a candidate
   came from. Building a second solver for proven outfits would fork the engine,
   which is the thing inversion ① and the `opts` note both forbid.

   ⚠️ A TIER, NOT A WEIGHT (her decision). A scoring bonus for "worn before" is
   recency weighting through a side door — invisible, unarguable, and exactly
   what D10 and the rack's four conditions govern. A tier is a POOL decision:
   nameable, countable, and one tap from being widened. Same call the rack made.

   Three tiers, best evidence first:
     1. this exact outfit, worn
     2. this SHAPE worn (her formulas) with pieces suited to the trip
     3. generated — today's behaviour, and it never disappears
   Tier 2 matters because tier 1 is rare and tier 3 is a guess: a shape she
   rebuilds is proof of what she'd put together, even with different pieces. */
const PACK_PROVEN_TIER = { worn: 1, shape: 2, made: 3 };

// Outfits she has actually worn that could serve this occasion.
function packWornCandidates(occ, poolIds, { wxFor = null, excluded = null } = {}) {
  const allow = new Set(poolIds || []);
  const no = excluded && excluded.size ? excluded : null;
  const lvl = packOccLevel(occ);
  const day = occ.date || (occ.leg && occ.leg.dates[0]) || todayStr();
  const wx = wxFor ? wxFor(day) : null;
  const season = seasonOf(day);
  const out = [];
  for (const o of (typeof activeOutfits === "function" ? activeOutfits() : outfits)) {
    if (outfitWornCount(o) < 1) continue;                    // proof is the point
    const ids = (outfitItemMap.get(o.id) || []).slice().sort();
    if (ids.length < 2) continue;
    let ok = true;
    for (const id of ids) {
      const i = itemById.get(id);
      /* ⚠️ Availability, her exclusions, the level, and the WEATHER. An outfit
         proven at 75° is not proof at 40°, and inSeasonWx is the same gate the
         suggester uses — a proven outfit still has to be wearable there. */
      if (!i || itemStatus(i) !== "Available" || (no && no.has(id)) ||
          !packCoversLevel(i, lvl) || !inSeasonWx(i, season, wx)) { ok = false; break; }
      if (allow.size && !allow.has(id)) { ok = false; break; }
    }
    if (!ok) continue;
    if (!comboMeetsPrefs(ids, occ.prefs)) continue;          // her stated rules still bind
    out.push({ ids, pieces: ids.map(id => itemById.get(id)).filter(Boolean),
               score: 0, proven: PACK_PROVEN_TIER.worn, outfitId: o.id,
               wornDays: outfitWornCount(o), lastWorn: lastWornOutfit(o) });
  }
  // Most-worn first: the outfit she reaches for repeatedly is the best evidence.
  out.sort((a, b) => (b.wornDays - a.wornDays) || (a.ids.join() < b.ids.join() ? -1 : 1));
  return out;
}
// Last day this look went out, or null. Small helper so the card can say when.
function lastWornOutfit(o) {
  const s = outfitWearMap.get(o.id);
  if (!s || !s.size) return null;
  let max = null;
  for (const d of s) if (!max || d > max) max = d;
  return max;
}
/* Tier 2: a SHAPE she rebuilds, filled with pieces that suit this trip. Reuses
   topFormulas/formulaShapeMap rather than inventing a taxonomy, and reuses the
   suggester to fill the shape — so a "proven shape" candidate is still a
   normally-generated, cohesive outfit, just constrained to a silhouette she
   demonstrably wears. */
function packShapeCandidates(occ, poolIds, { wxFor = null, seed = 1, limit = 6 } = {}) {
  const shapes = (typeof topFormulas === "function") ? topFormulas(4) : [];
  if (!shapes.length) return [];
  const lvl = packOccLevel(occ);
  const day = occ.date || (occ.leg && occ.leg.dates[0]) || todayStr();
  const wx = wxFor ? wxFor(day) : null;
  const season = seasonOf(day);
  const pool = (poolIds || []).map(id => itemById.get(id)).filter(Boolean);
  if (!pool.length) return [];
  const out = [];
  for (const f of shapes) {
    const key = f && (f.key || f);
    if (!key) continue;
    const got = packWithSeed(seed ^ packHash(String(key)), () =>
      suggestOutfits(lvl, null, pool, season, wx, null, false, null, key,
                     { all: true, uniqueCap: 24 })) || [];
    for (const cmb of got.slice(0, limit)) {
      const ids = cmb.pieces.map(p => p.id).sort();
      if (!comboMeetsPrefs(ids, occ.prefs)) continue;
      out.push({ ids, pieces: cmb.pieces, score: cmb.score,
                 proven: PACK_PROVEN_TIER.shape, shapeKey: key });
    }
  }
  return out;
}

/* ⚠️ THE BAG IS SEEDED FROM OUTFITS SHE HAS WORN, and without this the tiers
   are decoration. Measured: with proven candidates filtered to a bag that
   packFill had built from slot RATES, exactly 2 of 298 fitting worn outfits
   survived — the pack could offer proof only where proof happened to coincide
   with a bag chosen on other grounds. Picking pieces first is what destroys the
   combinations, which is inversion ① stated from the other end.

   So: choose proven outfits for the demand FIRST, and their union seeds the
   bag. packFill then tops up around them, and the solver — which already
   prefers tier 1 — finds those outfits in the bag rather than just outside it.

   ⚠️ Distinct looks required, or this degenerates instantly: "fewest new
   pieces" alone picks the SAME outfit for every occasion (measured: 8 occasions
   collapsed to 1 outfit, 2 pieces). Same failure the solver's repetition costs
   exist to prevent, arriving one layer earlier.
   ⚠️ Cheapest-first among proven, most-worn breaking ties: a small bag is still
   the goal, and the outfit she reaches for repeatedly is the better evidence.
   ⚠️ Bounded — PACK_SEED_MAX stops a long trip seeding the whole wardrobe. */
// Tier → preference. Nothing else in the solver reads `proven`.
function packProvenBonus(cd) {
  if (!cd || !cd.proven) return 0;
  if (cd.proven === PACK_PROVEN_TIER.worn) return PACK_WORN_BONUS;
  if (cd.proven === PACK_PROVEN_TIER.shape) return PACK_SHAPE_BONUS;
  return 0;
}

const PACK_SEED_MAX = 24;
function packProvenSeed(demand, { wxFor = null, excluded = null, poolIds = null } = {}) {
  const seedSet = new Set(), usedLooks = new Set(), chosen = new Map();
  // Hardest occasions first: the ones with fewest proven options should get
  // their pick before the common ones spend the overlap.
  const withCands = (demand || []).map(occ => ({
    occ, cands: packWornCandidates(occ, poolIds, { wxFor, excluded }),
  })).filter(x => x.cands.length).sort((a, b) => a.cands.length - b.cands.length);
  for (const { occ, cands } of withCands) {
    if (seedSet.size >= PACK_SEED_MAX) break;
    let best = null, bestAdd = Infinity, bestWorn = -1;
    for (const cd of cands) {
      if (usedLooks.has(packLookKey(cd.ids))) continue;
      const add = cd.ids.filter(id => !seedSet.has(id)).length;
      if (add < bestAdd || (add === bestAdd && cd.wornDays > bestWorn)) {
        best = cd; bestAdd = add; bestWorn = cd.wornDays;
      }
    }
    if (!best) continue;
    if (seedSet.size + bestAdd > PACK_SEED_MAX) continue;
    usedLooks.add(packLookKey(best.ids));
    chosen.set(occ.id, best);
    best.ids.forEach(id => seedSet.add(id));
  }
  return { ids: [...seedSet], byOcc: chosen };
}

function packCandidates(occ, rackIds, { pool = null, wxFor = null, limit = PACK_CANDIDATES_PER_OCC,
                                        seed = 1, all = false, excluded = null } = {}) {
  /* ⚠️ EXCLUDED HAS TO BITE HERE TOO, not only in packFill. The bag already
     omits an excluded piece, so drawing from the bag is safe by construction —
     but a level-1 occasion draws from the WHOLE closet by design (running shoes
     are Sneakers at [2,3]), which walked straight past the exclusion. "Not this
     trip" that still turns up on the hiking day is not a decision, it's a
     suggestion. */
  /* ⚠️ AND "DON'T PLAN AROUND IT" DEFAULTS IN FROM THE OPEN PACK, rather than
     being threaded through fifteen call sites. Coverage, the option counts, the
     review lists, every re-pick path and the solver all enumerate through here,
     and a rule half of them honoured would be the "when you add a reader, audit
     them all" trap arriving in its fifth costume. `packSolve` still passes it
     explicitly, so the solve never depends on this fallback.
     ⚠️ Sound because every caller enumerates for the OPEN pack — the dash paths
     (packPlanByDate, packMidTripWash) read the stored assignment and never come
     through here. */
  const auto = (typeof _packState !== "undefined" && _packState && _packState.noplan) || null;
  const no = excluded && excluded.size ? excluded : (auto && auto.size ? auto : null);
  const okay = (i) => i && itemStatus(i) === "Available" && !(no && no.has(i.id));
  const avail = (pool || items).filter(okay);
  const lvl = packOccLevel(occ);
  let base = lvl === 1 ? avail : rackIds.map(id => itemById.get(id)).filter(okay);
  if (!base.length) return [];

  /* ⚠️ THE LEVEL IS NOT THE OCCASION (2026-08-04 r6). Reported: it offered "a
     very casual dress for a plane ride when I'd never wear a dress on a plane".
     Nothing was wrong by the rules the solver had — a casual dress clears
     level 2 — because the context is translated to a level and then thrown
     away, which is the same discard contextFormalityLevel was written to fix
     for the suggester. Her history answers it directly: on the plane days of
     every past trip she has never once worn a dress.
     Rescue-shaped, like inSeasonWx: it only ever REMOVES a silhouette she has
     never worn for this occasion, and if the narrowed pool can't build, the
     unfiltered one is used instead (below) — a pool that returns nothing is
     worse than a pool that returns something imperfect. */
  const fit = packOccasionSlotFit(occ);
  const wide = base;
  if (fit && fit.size) base = base.filter(i => {
    const s = packSlotOf(i);
    return !s || fit.has(s);
  });
  if (!base.length) base = wide;
  const day = occ.date || (occ.leg && occ.leg.dates[0]) || todayStr();
  const wx = wxFor ? wxFor(day) : null;
  const season = seasonOf(day);
  const enumerate = (p) => packWithSeed(seed ^ packHash(occ.id || day), () =>
    suggestOutfits(lvl, null, p, season, wx, null, false, null, null,
                   { all: true, uniqueCap: PACK_ENUM_CAP }));
  let raw = enumerate(base);
  // The rescue half of the context filter: never trade an answer for a purer one.
  if (!raw.length && base !== wide) raw = enumerate(wide);
  /* ⚠️ HER CONSTRAINTS APPLY LAST AND ARE NEVER RESCUED. Everything above is
     the app guessing and may be relaxed to keep an answer; this is her saying
     what she will wear, so it filters after the rescue and an empty result
     stays empty. packCoverage then reports the occasion as uncovered and the
     card offers to relax it — visible, and hers to undo. */
  const out = raw.map(cmb => ({
    ids: cmb.pieces.map(p => p.id).sort(),
    pieces: cmb.pieces,
    score: cmb.score,
  })).filter(x => comboMeetsPrefs(x.ids, occ.prefs));
  out.sort((a, b) => (b.score - a.score) || (a.ids.join() < b.ids.join() ? -1 : 1));

  /* ---- proof first (2026-08-09) -----------------------------------------
     ⚠️ TIERS, NOT WEIGHTS. Outfits she has WORN lead, then shapes she rebuilds,
     then generated ones — and tier 3 is always present, so a trip her history
     doesn't cover still gets a full answer. Deduped on packLookKey so a proven
     outfit and its generated twin don't both appear.
     ⚠️ Order matters and score does not re-sort across tiers: the whole point
     is that evidence outranks a score computed from affinity heuristics. */
  const seenLook = new Set();
  const tiered = [];
  const take = (list) => {
    for (const x of list) {
      const k = packLookKey(x.ids);
      if (seenLook.has(k)) continue;
      seenLook.add(k);
      tiered.push(x.proven ? x : { ...x, proven: PACK_PROVEN_TIER.made });
    }
  };
  take(packWornCandidates(occ, base.map(i => i.id), { wxFor, excluded }));
  take(packShapeCandidates(occ, base.map(i => i.id), { wxFor, seed }));
  take(out);
  return all ? tiered : packDiversify(tiered, limit);
}

/* ---- what she actually wears FOR an occasion (2026-08-04 r6) --------------
   Which SLOTS she has really worn for this kind of day, or null when there
   isn't enough history to say anything. Slots, deliberately, NOT subcategories:
   "I'd never wear a dress on a plane" is a silhouette rule and it is the one
   she can state. Blocking at subcategory level would also rule out the specific
   jeans she happens not to have flown in, which is not a rule she holds.

   ⚠️ THE PLANE DAY IS NOT TAGGED "Flight". tripWearContext auto-stamps every
   wear of a trip with "Travel", and Travel is a trip-wide fact, so asking what
   she wears for Travel returns everything she wears on holiday — dresses very
   much included — and would block nothing. The honest source for a plane day is
   the FIRST AND LAST DATE of past trips, which is exactly when she flew. That's
   derived from dates the app already has, with no new tagging asked of her.

   ⚠️ One pass over `wears` per call, and packCandidates is called once per
   (level, leg, band) group — not per candidate. Calling itemContexts in a
   candidate loop is the documented items × wears trap that got context scoring
   thrown out of packFill; don't move this inside one. */
const PACK_CTX_MIN_DAYS = 4;   // days of evidence before a silhouette is ruled out

function packOccasionSlotFit(occ, { wearRows = null, caps = null, today = null } = {}) {
  if (!occ) return null;
  const rows = wearRows || wears;
  const ctxs = (occ.contexts || []).filter(c => c && c !== TRIP_CONTEXT);
  const isFlight = occ.source === "flight" || ctxs.includes(PACK_FLIGHT_CONTEXT);

  let days;
  if (isFlight) {
    // The days she was actually on a plane: each past trip's first and last.
    const planeDays = new Set();
    for (const c of completedTrips(caps, today)) {
      const ds = tripDates(c);
      if (!ds.length) continue;
      planeDays.add(ds[0]);
      planeDays.add(ds[ds.length - 1]);
    }
    days = rows.filter(w => planeDays.has(w.worn_on));
  } else {
    if (!ctxs.length) return null;
    const want = new Set(ctxs);
    days = rows.filter(w => ctxArr(w).some(x => want.has(x)));
  }

  const distinct = new Set(days.map(w => w.worn_on));
  if (distinct.size < PACK_CTX_MIN_DAYS) return null;   // not enough to speak
  const slots = new Set();
  for (const w of days) {
    // ⚠️ A wear can outlive its item (deleted piece, or a fixture that doesn't
    // define one) — suggestSlot reads .category and throws on undefined.
    const it = itemById.get(w.item_id);
    if (!it) continue;
    const s = packSlotOf(it);
    if (s) slots.add(s);
  }
  /* ⚠️ A slot she has never worn for this occasion is only meaningful if the
     TOP HALF is still dressable without it — otherwise "she never wears a dress
     to work" would also delete tops-and-bottoms on a day she has only ever worn
     dresses. Require a complete silhouette before the set is allowed to narrow
     anything, and say nothing at all when the history is one-sided. */
  const topHalf = slots.has("Dresses") || (slots.has("Tops") && slots.has("Bottoms"));
  if (!topHalf || !slots.has("Shoes")) return null;
  return slots;
}

/* Trim a candidate list to `limit` while spanning as many distinct PIECES as
   possible, instead of taking the top N by score (which are near-duplicates of
   each other — same shirt, different shoes).
   ⚠️ Honest scope: this is NOT what rescues the solver from starvation —
   PACK_SOLVE_CANDIDATES is (mutation-checked; turning diversity off alone
   changes no test). It earns its place on the OTHER caller: the 8 alternates
   offered per occasion, where five variations of one shirt is a bad set of
   options to choose between. Deterministic — no RNG, ties broken on id. */
function packDiversify(list, limit) {
  const pool = list.slice();
  const out = [], use = new Map();
  while (out.length < limit && pool.length) {
    let bi = 0, bs = -Infinity;
    for (let k = 0; k < pool.length; k++) {
      const cd = pool[k];
      /* ⚠️ Reusing a LOOK costs far more than reusing a shoe — otherwise the
         cheapest way to look diverse is to change footwear, which is the thing
         she reported. Shoes still carry a small penalty so the strip doesn't
         show the identical pair eight times. */
      const overlap = cd.ids.reduce((n, id) => {
        const it = itemById.get(id);
        const w = (it && suggestSlot(it) === "Shoes") ? 1 : 4;
        return n + (use.get(id) || 0) * w;
      }, 0);
      const lookSeen = use.get("look:" + packLookKey(cd.ids)) || 0;
      const s = cd.score - overlap * 3 - lookSeen * 40;
      if (s > bs) { bs = s; bi = k; }
    }
    const cd = pool.splice(bi, 1)[0];
    out.push(cd);
    for (const id of cd.ids) use.set(id, (use.get(id) || 0) + 1);
    const lk = "look:" + packLookKey(cd.ids);
    use.set(lk, (use.get(lk) || 0) + 1);
  }
  return out;
}

/* ---- distinctness (D2, revised to the VISIBLE CORE 2026-08-05) -----------
   Her rule: "an outfit cannot be exactly the same except shoes. I need
   different outfits for each slot."

   D2 originally said any differing piece makes two outfits distinct, reasoning
   that a second pair of shoes is then a cheap way to buy options and the
   optimiser would reach for it on merit. It reached for it constantly, because
   it IS the cheapest edit available: swapping shoes adds one small piece and
   resets every repetition penalty at once, so the solver could satisfy "K
   options per occasion" and "don't repeat outfits" without ever changing what
   the outfit actually looks like. Two occasions came back in the same top and
   the same jeans and the app called them different.

   ⚠️ The D2 comment named this outcome and named the fix — "needs the visible
   core variant" — so this is the documented escape hatch being taken, not a
   patch over it. THE LOOK IS EVERYTHING BUT THE SHOES. Two outfits sharing a
   look are the same outfit for every purpose that counts repetition:
   distinctness, the option count, and the solver's repeat penalties.

   ⚠️ It is deliberately NOT "every slot must differ". Reusing the same jeans
   all week is the point of packing light and the reason repetition is charged
   on the visible half only; what she is objecting to is two outfits that read
   identically, and a shared bottom under a different top does not. */
const packLookIds = (ids) => (ids || [])
  .filter(id => { const i = itemById.get(id); return !i || suggestSlot(i) !== "Shoes"; })
  .slice().sort();
const packLookKey = (ids) => packLookIds(ids).join(",");
function packDistinct(a, b) {
  return packLookKey(a.ids) !== packLookKey(b.ids);
}

// How many distinct valid outfits an occasion can make from a given pack.
function packOptionCount(occ, packIds, opts = {}) {
  const list = packCandidates(occ, [...packIds], { ...opts, all: true, pool: opts.packPool || null });
  const inside = list.filter(c => c.ids.every(id => packIds.has ? packIds.has(id) : packIds.includes(id)));
  // ⚠️ Counted by LOOK, so five shoe permutations of one outfit are one option.
  // This is also what makes the tightness dial mean what it says: K is "options
  // per occasion", and it was being satisfied by changes of footwear.
  const seen = new Set();
  for (const c of inside) seen.add(packLookKey(c.ids));
  return seen.size;
}

/* ---- the schedule (inversion ②) ---------------------------------------- */
// Where a piece's wear counter STARTS. ⚠️ Not zero: a jean at 4 of 5 wears on
// departure day is effectively tolerance-1 for the whole trip. planRewearFlags
// already fixed this exact bug once (2026-07-22) — don't reintroduce it here.
function packWearSeed(it, ls) {
  if (!it) return 0;
  const tol = wearTolerance(it);
  if (tol === Infinity) return 0;
  const st = it.laundry_state || "";
  if (st === "hamper") return tol;                 // dirty now — needs a wash first
  if (!it.last_washed) return 0;                   // untracked = clean (matches isDirty)
  const n = wearDatesSinceWash(it, ls).length;
  if (st.startsWith("extra:") && n <= +st.slice(6)) return Math.max(0, tol - 1);
  return n;
}

/* Walk the trip and report tolerance violations WITH DATES. Generalises
   planRewearFlags from reporting to preventing.
   ⚠️ Counts distinct (item, DAY) pairs, never outfit-fills: two outfits in one
   day sharing the same jeans is ONE wear-day. Same rule as countByDay. */
function packSchedule(assign, { dates = null, ls = null, washDays = null } = {}) {
  const lst = ls || laundryState();
  const byDate = new Map();
  for (const a of (assign || [])) {
    if (!a || !a.date) continue;
    let s = byDate.get(a.date);
    if (!s) byDate.set(a.date, s = new Set());
    for (const id of (a.ids || [])) s.add(id);
  }
  const days = (dates && dates.length ? dates : [...byDate.keys()]).slice().sort();
  const wash = new Set(washDays || []);
  const counts = new Map();
  const violations = [];
  /* ⚠️ After a wash, an item first seen LATER in the trip must seed at 0, not
     from packWearSeed. Clearing the map alone re-seeded it from the pre-trip
     dirty count, so a mid-trip wash quietly did nothing for every piece that
     hadn't been worn yet — the reset looked like it worked because pieces
     already in the map did get cleared. */
  let washed = false;
  for (const d of days) {
    if (wash.has(d)) { counts.clear(); washed = true; }
    for (const id of (byDate.get(d) || [])) {
      const it = itemById.get(id);
      if (!it) continue;
      const tol = wearTolerance(it);
      if (tol === Infinity) continue;
      if (!counts.has(id)) counts.set(id, washed ? 0 : packWearSeed(it, lst));
      const n = counts.get(id) + 1;
      counts.set(id, n);
      if (n > tol) violations.push({ date: d, itemId: id, name: it.name || "Untitled", nth: n, tol });
    }
  }
  return { violations, days };
}

/* ---- the solve ---------------------------------------------------------
   minimize |pack|, subject to every occasion having ≥K distinct valid outfits
   from the pack, and no item exceeding tolerance inside its laundry stretch.

   Two stages, because the options pass is the expensive one:
     A. `restarts` seeded greedy passes, each scored on
        unmet → violations → pieces. Cheap and wide.
     B. the winner alone gets the options top-up (raise every occasion to K).
   Running B inside every restart would be rack-size × occasions × restarts and
   buys nothing — the base pack barely differs between good restarts. */
function packSolve({ c = null, demand = null, rack = null, pool = null, wxFor = null,
                     K = PACK_OPTIONS.normal, ls = null, washDays = null, dates = null,
                     pinned = null, locked = null, noplan = null,
                     restarts = PACK_RESTARTS, seed = null } = {}) {
  const dem = demand || [];
  const rackIds = (rack && rack.ids) || [];
  const lst = ls || laundryState();
  const days = dates || (c ? tripDates(c) : [...new Set(dem.map(o => o.date).filter(Boolean))].sort());
  const pinnedIds = new Set(pinned || []);
  const lockedMap = locked instanceof Map ? locked : new Map();
  const proven = new Set((travelProven(buildTravelStats(c ? capsules.filter(x => x.id !== c.id) : null)) || [])
    .map(e => e.item && e.item.id).filter(Boolean));

  const sd = seed != null ? seed
    : packHash(`${c ? c.id : "x"}|${dem.map(o => o.id + ":" + o.level).join(",")}|${K}|${rackIds.slice().sort().join(",")}`);

  /* ⚠️ Enumerate candidates ONCE per (level, leg, temperature band), not once
     per occasion. Two Work days in the same city at the same level have the
     IDENTICAL candidate set by construction, so per-occasion enumeration re-ran
     the combo builder a dozen times for one answer — measured as a hang, not a
     slowdown. Variety between those days comes from the greedy's own cost
     function as the pack fills, which is where it belongs.
     The temperature band keeps genuine hot/cold differences inside a long leg
     from being flattened; with no weather loaded it collapses to level+leg. */
  /* ⚠️ `noplan` bites HERE, not in the bag. A piece she has told the app not to
     plan around is still packed and still on the checklist — it just can't be
     enumerated into an outfit, which is the only thing "don't plan around it"
     can honestly mean. */
  const candOpts = { pool, wxFor, seed: sd, limit: PACK_SOLVE_CANDIDATES,
                     excluded: (noplan && noplan.size) ? noplan : null };
  const bandOf = (day) => {
    const w = day && wxFor ? wxFor(day) : null;
    return w && w.maxT != null ? Math.round(w.maxT / 8) : "x";
  };
  const groupKey = (o) => `${packDemandKey(o)}|${bandOf(o.date)}`;   // packCandKey
  const reps = new Map();   // groupKey → a representative occasion
  for (const occ of dem) if (!reps.has(groupKey(occ))) reps.set(groupKey(occ), occ);
  const candByKey = new Map();
  for (const [k, rep] of reps) candByKey.set(k, packCandidates(rep, rackIds, candOpts));
  const cands = new Map();
  for (const occ of dem) cands.set(occ.id, candByKey.get(groupKey(occ)) || []);

  const rnd = packRng(sd);
  let best = null;

  /* The tightness dial governs REPETITION as well as option counts, because K
     only guarantees options EXIST in the pack — it says nothing about whether
     consecutive days look different, which is the thing she'd actually notice.

     ⚠️ LEAN NO LONGER DISCOUNTS REPETITION (2026-08-08, audit). This used to be
     `0.5` at lean, on the old model — the comment here said "at Lean, wearing
     one sweater four days out of six is exactly right" — and that is precisely
     the model she reversed in r4: *"same as normal just a smaller bag. small
     numbers of clothes can make lots of different outfits."* A different outfit
     per occasion is the floor at EVERY tightness, so a smaller bag must be paid
     for in PIECES, never in repeated looks. Halving the repetition cost bought
     it in exactly the wrong currency.
     ⚠️ Reusing one TOP across two different-looking outfits is not repetition —
     that's the recombination the whole model rests on, and it's why repetition
     is charged on `packLookKey` (the look minus shoes), not per piece.
     ⚠️ PACK_REPEAT_DAY is deliberately NOT scaled at all: the identical outfit
     two days running is the worst-looking failure the solver can produce, so
     that floor holds at every tightness. */
  const repW = K >= PACK_OPTIONS.cushion ? 2 : 1;

  /* Occasions grouped by date, in order. ⚠️ The greedy walks the trip in DATE
     ORDER carrying a running wear counter, because tolerance has to DRIVE
     selection rather than be repaired after it. An earlier version scored only
     "how many new pieces does this add", which makes reuse free — so ten days
     at the same level all chose the identical outfit, and a post-hoc repair
     couldn't undo it (every occasion shared one candidate list, so they all
     moved to the same alternative). That is inversion ② applied to the search
     and not just to the report: a 10-day trip on tolerance-1 tees must cost ten
     tees, and it only does if the cost function knows the calendar. */
  const grouped = (() => {
    const m = new Map();
    for (const occ of dem) {
      const d = occ.date || "9999-12-31";   // undated occasions sort last
      let a = m.get(d);
      if (!a) m.set(d, a = []);
      a.push(occ);
    }
    return [...m.entries()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  })();
  const washSet = new Set(washDays || []);

  for (let r = 0; r < Math.max(1, restarts); r++) {
    const pack = new Set(pinnedIds);
    const chosen = new Map();
    const unmet = [];
    const counts = new Map();
    let washed = false;
    const seedOf = (id, it) => counts.has(id) ? counts.get(id) : (washed ? 0 : packWearSeed(it, lst));
    // Repetition state (see PACK_REPEAT_* above).
    const usedCombos = new Set();     // id-key → already worn on an earlier day
    const dayWorn = new Map();        // itemId → earlier DAYS it went out this trip
    let prevDayCombos = new Set();    // id-keys chosen yesterday
    let repeatTally = 0;

    for (const [date, occs] of grouped) {
      if (washSet.has(date)) { counts.clear(); washed = true; }
      const usedToday = new Set();
      const todayCombos = new Set();
      const todayKinds = new Map();     // kind → look-keys already used TODAY
      // Scarcest first within a day — a dressy evening has fewer options than an
      // ordinary afternoon and should claim its pieces before the easy case does.
      const ord = occs.slice().sort((a, b) =>
        ((cands.get(a.id) || []).length - (cands.get(b.id) || []).length) || (rnd() - 0.5));

      for (const occ of ord) {
        if (lockedMap.has(occ.id)) {
          const lk = lockedMap.get(occ.id);
          chosen.set(occ.id, lk);
          todayCombos.add(packLookKey(lk.ids));
          packNoteKind(todayKinds, occ, packLookKey(lk.ids));
          for (const id of lk.ids) { pack.add(id); usedToday.add(id); }
          continue;
        }
        const list = cands.get(occ.id) || [];
        if (!list.length) {
          unmet.push({ occId: occ.id, date: occ.date, level: occ.level, reason: "nothing available covers this level" });
          continue;
        }
        const sameKind = todayKinds.get(packOccKind(occ)) || null;
        let pick = null, bestCost = Infinity;
        for (const cd of list) {
          let added = 0, over = 0, prov = 0, topRepeat = 0;
          for (const id of cd.ids) {
            if (!pack.has(id)) added++;
            if (proven.has(id)) prov++;
            const it = itemById.get(id);
            if (!it) continue;
            // Repetition is charged on the visible half only — reusing the same
            // jeans and shoes all week is the point of packing light.
            const slot = suggestSlot(it);
            if (slot === "Tops" || slot === "Dresses") topRepeat += (dayWorn.get(id) || 0);
            const tol = wearTolerance(it);
            // usedToday: the same piece in two of today's outfits is ONE wear-day.
            if (tol === Infinity || usedToday.has(id)) continue;
            if (seedOf(id, it) + 1 > tol) over++;
          }
          const key = packLookKey(cd.ids);   // ⚠️ by LOOK — see packDistinct
          // A violation outweighs several new pieces: packing one more tee beats
          // wearing a dirty one, which is the whole reason she asked for this.
          const cost = over * 5000
            + (prevDayCombos.has(key) ? PACK_REPEAT_DAY : 0)
            + (sameKind && sameKind.has(key) ? PACK_REPEAT_DAY : 0)
            + (usedCombos.has(key) ? PACK_REPEAT_ANY * repW : 0)
            + topRepeat * PACK_REPEAT_TOP * repW
            + added * 1000
            - packProvenBonus(cd)
            - prov * PACK_PROVEN_W
            - cd.score * PACK_SCORE_W
            + rnd() * 0.5;
          if (cost < bestCost) { bestCost = cost; pick = cd; }
        }
        chosen.set(occ.id, pick);
        const pickKey = packLookKey(pick.ids);
        if (prevDayCombos.has(pickKey)) repeatTally += 150;
        else if (usedCombos.has(pickKey)) repeatTally += 40;
        if (sameKind && sameKind.has(pickKey)) repeatTally += 150;
        todayCombos.add(pickKey);
        packNoteKind(todayKinds, occ, pickKey);
        for (const id of pick.ids) { pack.add(id); usedToday.add(id); }
      }

      // Commit the day: one wear-day per distinct piece, however many outfits.
      for (const id of usedToday) {
        const it = itemById.get(id);
        if (!it) continue;
        const slot = suggestSlot(it);
        if (slot === "Tops" || slot === "Dresses") {
          repeatTally += (dayWorn.get(id) || 0) * 8;
          dayWorn.set(id, (dayWorn.get(id) || 0) + 1);
        }
        if (wearTolerance(it) === Infinity) continue;
        counts.set(id, seedOf(id, it) + 1);
      }
      for (const k of todayCombos) usedCombos.add(k);
      prevDayCombos = todayCombos;
    }

    const sched = packSchedule(assignOf(dem, chosen), { dates: days, ls: lst, washDays });
    // Pieces stay primary (100 each) so the pack still minimises; repetition
    // breaks ties between restarts and is worth ~1.5 pieces per identical day.
    const scoreOf = unmet.length * 1e6 + sched.violations.length * 1e4 + pack.size * 100 + repeatTally;
    if (!best || scoreOf < best.scoreOf) best = { pack, chosen, unmet, sched, scoreOf };
  }

  if (!best) return { pack: [], assign: new Map(), options: new Map(), unmet: [], violations: [], stats: { pieces: 0, outfits: 0, legs: 0 } };

  /* ---- stage B: raise every occasion to K options, inside the pack ----
     ⚠️ Grouped by (level, leg), not per occasion: two occasions at the same
     level in the same climate have IDENTICAL option counts by construction, so
     counting per occasion re-ran the enumerator a dozen times for one answer.
     Ungrouped this was ~1700 suggestOutfits calls per solve. */
  const pack = new Set(best.pack);
  const groups = new Map();
  for (const occ of dem) {
    if (!(cands.get(occ.id) || []).length) continue;
    if (!groups.has(groupKey(occ))) groups.set(groupKey(occ), occ);
  }
  // Additions are tried warmest/most-proven first, so the cheap early exits are
  // also the good ones and PACK_ADD_TRIES doesn't have to be large.
  // ⚠️ On the app path `rackIds` IS the bag, so this is its leftovers — see the
  // note in packEnsureSolve for why widening it was measured and rejected.
  const addIds = rackIds
    .filter(id => !pack.has(id))
    .sort((a, b) => (proven.has(b) - proven.has(a)) || (rackWarmth(b) - rackWarmth(a)) || (a < b ? -1 : 1));

  /* ⚠️ K IS PER OCCASION, SO THE TARGET HAS TO COUNT THE OCCASIONS (2026-08-06).
     Her report: a 5-day trip with FOUR casual days came back as two outfits,
     each worn twice, out of a 19-piece bag. Nothing was broken — this loop
     raises each GROUP to K options, K at normal is 2, and all four casual days
     are ONE group. The app guaranteed exactly two looks for four days and then,
     correctly by its own lights, repeated them.

     ⚠️ AND THE DIAL DOES NOT BUY REPETITION (her decision, 2026-08-06 r2, after
     reading that lean meant "repeat every other day": *"same as normal just a
     smaller bag. small numbers of clothes can make lots of different
     outfits."*). She is right, and it is the better model: distinct looks are
     mostly a RECOMBINATION problem, not a piece-count one — four tops and two
     bottoms is eight looks, not four. So a different outfit per occasion is the
     floor at EVERY tightness, and K buys spare capacity above it: lean carries
     nothing spare, normal one, cushion two.
     ⚠️ Capped — a fortnight at one level must not chase fourteen looks — and
     PACK_OPT_GUARD still bounds pieces added per group regardless.
     ⚠️ Counted on packDemandKey, not on the candidate key: see packDemandKey.
     ⚠️ THIS AND STAGE C ARE ONE FIX AND NEITHER WORKS ALONE. Measured on the
     scarce fixture that reproduces her report: with this alone the options are
     built and never spent (stage A still assigns two looks); with stage C alone
     there is nothing extra to spend (2 options → 2 looks). Together: 5 distinct
     outfits over 7 occasions. Removing either one silently restores the bug,
     which is why the case guarding it drives the whole solver end to end. */
  const occCount = new Map();
  for (const occ of dem) occCount.set(packDemandKey(occ), (occCount.get(packDemandKey(occ)) || 0) + 1);
  const optionTarget = (occ) => packOptionTarget(occCount.get(packDemandKey(occ)) || 1, K);

  /* ⚠️ Only groups holding an occasion the solver is still free to choose. With
     the survivors of a context edit carried in as transient locks, every other
     group is settled — and buying option pieces for four days she already has
     outfits for is how a one-line edit grows the bag. */
  const unlockedGroups = new Set();
  for (const occ of dem) if (!lockedMap.has(occ.id)) unlockedGroups.add(groupKey(occ));
  const stageBAdds = new Set();
  for (const occ of groups.values()) {
    if (!unlockedGroups.has(groupKey(occ))) continue;
    const target = optionTarget(occ);
    let have = packOptionCount(occ, pack, candOpts);
    let guard = 0;
    // Only pieces that can actually reach this level are worth a try — the
    // slice is small, and an off-level piece can never raise the count.
    const tries = addIds.filter(id => packCoversLevel(itemById.get(id), occ.level))
      .slice(0, PACK_ADD_TRIES);
    while (have < target && guard++ < PACK_OPT_GUARD) {
      let bestAdd = null, bestGain = 0;
      for (const id of tries) {
        if (pack.has(id)) continue;
        pack.add(id);
        const gain = packOptionCount(occ, pack, candOpts) - have;
        pack.delete(id);
        if (gain > bestGain) { bestGain = gain; bestAdd = id; }
      }
      if (!bestAdd) break;
      pack.add(bestAdd);
      stageBAdds.add(bestAdd);
      have += bestGain;
    }
  }

  const byKey = new Map();
  for (const occ of groups.values()) byKey.set(groupKey(occ), packOptionCount(occ, pack, candOpts));
  const options = new Map();
  for (const occ of dem) options.set(occ.id, byKey.get(groupKey(occ)) || 0);

  /* ---- stage C: re-assign over the finished pack — see packRepairAssign ----
     ⚠️ SEVERAL STRENGTHS, STRONGEST FIRST, and this is not belt-and-braces —
     the first version failed exactly here. The repair walks days in order, so
     chasing variety hard makes it spend the clean tolerance-1 tops early and
     day five is left with nothing clean: measured 4 → 6 distinct outfits AND
     0 → 1 laundry violation, so the gate correctly threw the whole thing away
     and the fix silently did nothing. Greedy myopia, and the honest answer is
     to ask for less spreading rather than to accept a dirty day: variety is
     worth having, but not at the price of wearing something out of clean wears,
     which is the constraint she asked for this feature to respect. */
  /* ⚠️ THE GATE IS PER GROUP, AND IT NO LONGER STOPS AT THE FIRST IMPROVEMENT
     (2026-08-06 r2). It used to compare ONE trip-wide distinct count and `break`
     — so a repair that improved only the dressy evening was accepted, and four
     casual days stayed on two alternating looks while the number the gate reads
     went up. The first improvement is not the best improvement, and a trip total
     cannot tell the difference between "every kind of day got better" and "one
     did". `maxDeficit` is the term that can: it asks how bad the WORST group
     still is, so a repair that leaves the week untouched cannot win.
     ⚠️ Always running all three costs two extra linear walks — the enumeration
     is shared through repairCache — and buys the comparison. Don't put the
     `break` back. */
  let assign = best.chosen;
  let sched = packSchedule(assignOf(dem, assign), { dates: days, ls: lst, washDays });
  const base = packAssignVariety(dem, assign, optionTarget);
  const repairCache = new Map();
  let pick = null;
  PACK_REPAIR_STRENGTHS.forEach((mult, idx) => {
    const repaired = packRepairAssign(pack, dem, best.chosen, {
      candOpts, ls: lst, washDays, locked: lockedMap, repW: repW * mult, cache: repairCache,
    });
    if (!repaired || !repaired.size) return;
    const rSched = packSchedule(assignOf(dem, repaired), { dates: days, ls: lst, washDays });
    const b = packAssignVariety(dem, repaired, optionTarget);
    // Never worse on the two things that matter more: every occasion still
    // dressed, and no new tolerance violation.
    if (b.placed < base.placed || rSched.violations.length > sched.violations.length) return;
    // Strictly better on variety, judged worst-group first.
    const better = b.deficit < base.deficit
      || (b.deficit === base.deficit && b.maxDeficit < base.maxDeficit)
      || (b.deficit === base.deficit && b.maxDeficit === base.maxDeficit && b.distinct > base.distinct);
    if (!better) return;
    const cand = { assign: repaired, sched: rSched, b, idx };
    if (!pick) { pick = cand; return; }
    const p = pick.b;
    const wins = b.deficit !== p.deficit ? b.deficit < p.deficit
      : b.maxDeficit !== p.maxDeficit ? b.maxDeficit < p.maxDeficit
      : b.distinct !== p.distinct ? b.distinct > p.distinct
      : rSched.violations.length !== pick.sched.violations.length
        ? rSched.violations.length < pick.sched.violations.length
        : idx < pick.idx;                     // ties go to the strongest attempt
    if (wins) pick = cand;
  });
  if (pick) { assign = pick.assign; sched = pick.sched; }

  /* ⚠️ `extras` is what stops stage B's work evaporating. packRepack rebuilds
     the bag as pinned ∪ what the outfits use ∪ extras, so a piece added purely
     to give an occasion a second option — and not worn, because only one option
     per occasion ever is — was deleted from the bag the instant the solve
     finished, and the option count fell back the next time it was read.
     An option whose pieces aren't in the suitcase is not an option; keeping
     them is what makes the screen and the solve agree. Counts stay an OUTPUT —
     nothing targets a piece count. */
  return {
    pack: [...pack],
    assign,
    options,
    extras: [...stageBAdds],
    unmet: best.unmet,
    violations: sched.violations,
    stats: {
      pieces: pack.size,
      outfits: packOutfitCount(pack, dem, candOpts),
      legs: (rack && rack.legs) || 1,
      seed: sd,
    },
  };
}
/* ---- stage C: SPEND the pack you actually built (2026-08-06) -------------
   Her report, on a 5-day trip that came back with 19 pieces: four home
   occasions dressed as two outfits, each worn twice unchanged, and the same
   dress again for the party. Nothing was wrong by stage A's rules — and that
   is precisely the bug.

   ⚠️ STAGE A CHOOSES AGAINST A PACK THAT DOESN'T EXIST YET. Every alternative
   it can see costs `added * 1000` for a piece not yet in the bag, while the
   repetition terms top out at PACK_REPEAT_ANY + PACK_REPEAT_TOP = 550. Repeating
   an outfit is therefore ALWAYS cheaper than varying it, by construction, at
   every tightness — the dial cannot fix this because repW scales the losing side.
   Then stage B goes and adds pieces to raise each occasion's option count and
   NEVER REVISITS THE ASSIGNMENT, so the options it bought sit in the suitcase
   unworn while the by-day plan repeats itself. That is the whole shape of "19
   pieces, four outfits": eight of those pieces were options nothing spent.

   Stage C re-walks the trip over the FINAL pack. Every candidate is already
   packed, so `added` is 0 for all of them and the repetition terms finally
   decide — which is what turns K's promise ("N options per occasion") into N
   different days rather than N more things to carry.
   ⚠️ It may never make things worse: an assignment that covers fewer occasions
   or breaks more tolerances is discarded whole, and locked occasions are copied
   through untouched (inversion ③ — her edits are state, not suggestions).
   ⚠️ Deterministic on purpose. Stage A has restarts and a seeded RNG because it
   is searching; this is a repair, and a repair that wobbles between renders
   would read as the pack reshuffling itself. */
function packRepairAssign(pack, demand, chosen, { candOpts = {}, ls = null, washDays = null,
                                                  locked = null, repW = 1, cache = null } = {}) {
  const dem = demand || [];
  if (!dem.length || !chosen) return null;
  const packSet = pack instanceof Set ? pack : new Set(pack || []);
  const lst = ls || laundryState();
  const lockedMap = locked instanceof Map ? locked : new Map();
  const washSet = new Set(washDays || []);

  /* Grouped by (level, leg, temperature band) — the same key stage A enumerates
     on, for the same reason: two Work days in one city at one level have the
     identical candidate set, so grouping is the difference between one solve
     and a dozen. */
  const bandOf = (day) => {
    const w = day && candOpts.wxFor ? candOpts.wxFor(day) : null;
    return w && w.maxT != null ? Math.round(w.maxT / 8) : "x";
  };
  const groupKey = (o) => `${packDemandKey(o)}|${bandOf(o.date)}`;
  // ⚠️ Shared across repair attempts (see the strengths loop in packSolve) — the
  // enumeration is the expensive half and the pack doesn't change between them.
  const byGroup = cache instanceof Map ? cache : new Map();
  for (const occ of dem) {
    const k = groupKey(occ);
    if (byGroup.has(k)) continue;
    /* ⚠️ Filtered to what's fully inside the pack. `all: true` because we want
       every look the bag can make, not the diversified top slice — and level 1
       draws from the whole closet by design (see packCandidates), so the filter
       is doing real work there rather than being a formality. */
    byGroup.set(k, packCandidates(occ, [...packSet], { ...candOpts, all: true })
      .filter(cd => cd.ids.every(id => packSet.has(id))));
  }

  const grouped = (() => {
    const m = new Map();
    for (const occ of dem) {
      const d = occ.date || "9999-12-31";
      let a = m.get(d);
      if (!a) m.set(d, a = []);
      a.push(occ);
    }
    return [...m.entries()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  })();

  const out = new Map();
  const counts = new Map();
  let washed = false;
  const seedOf = (id, it) => counts.has(id) ? counts.get(id) : (washed ? 0 : packWearSeed(it, lst));
  const usedCombos = new Set();
  const dayWorn = new Map();
  let prevDayCombos = new Set();

  for (const [date, occs] of grouped) {
    if (washSet.has(date)) { counts.clear(); washed = true; }
    const usedToday = new Set();
    const todayCombos = new Set();
    const todayKinds = new Map();     // same-day, same-kind repetition — see packOccKind
    // Scarcest first, exactly as stage A orders a day: the occasion with the
    // fewest ways to dress it should claim its pieces before the easy one does.
    const ord = occs.slice().sort((a, b) =>
      ((byGroup.get(groupKey(a)) || []).length - (byGroup.get(groupKey(b)) || []).length) ||
      (a.id < b.id ? -1 : 1));

    for (const occ of ord) {
      const keep = lockedMap.get(occ.id) || chosen.get(occ.id) || null;
      const list = (lockedMap.has(occ.id) ? [] : (byGroup.get(groupKey(occ)) || []));
      if (!list.length) {
        if (keep) {
          out.set(occ.id, keep);
          todayCombos.add(packLookKey(keep.ids));
          packNoteKind(todayKinds, occ, packLookKey(keep.ids));
          for (const id of keep.ids) usedToday.add(id);
        }
        continue;
      }
      const keepKey = keep ? packLookKey(keep.ids) : null;
      const sameKind = todayKinds.get(packOccKind(occ)) || null;
      let pick = keep, bestCost = Infinity;
      for (const cd of list) {
        let over = 0, topRepeat = 0;
        for (const id of cd.ids) {
          const it = itemById.get(id);
          if (!it) continue;
          // Repetition is charged on the visible half only — same rule as stage
          // A: wearing one pair of jeans all week is the point of packing light.
          const slot = suggestSlot(it);
          if (slot === "Tops" || slot === "Dresses") topRepeat += (dayWorn.get(id) || 0);
          const tol = wearTolerance(it);
          if (tol === Infinity || usedToday.has(id)) continue;
          if (seedOf(id, it) + 1 > tol) over++;
        }
        const key = packLookKey(cd.ids);
        const cost = over * 5000
          + (prevDayCombos.has(key) ? PACK_REPEAT_DAY : 0)
          + (sameKind && sameKind.has(key) ? PACK_REPEAT_DAY : 0)
          + (usedCombos.has(key) ? PACK_REPEAT_ANY * repW : 0)
          + topRepeat * PACK_REPEAT_TOP * repW
          - packProvenBonus(cd)
          - cd.score * PACK_SCORE_W
          - (key === keepKey ? 1 : 0);   // a genuine tie keeps what she may already be looking at
        if (cost < bestCost) { bestCost = cost; pick = cd; }
      }
      if (!pick) continue;
      out.set(occ.id, pick);
      todayCombos.add(packLookKey(pick.ids));
      packNoteKind(todayKinds, occ, packLookKey(pick.ids));
      for (const id of pick.ids) usedToday.add(id);
    }

    // Commit the day: one wear-day per distinct piece, however many outfits.
    for (const id of usedToday) {
      const it = itemById.get(id);
      if (!it) continue;
      const slot = suggestSlot(it);
      if (slot === "Tops" || slot === "Dresses") dayWorn.set(id, (dayWorn.get(id) || 0) + 1);
      if (wearTolerance(it) === Infinity) continue;
      counts.set(id, seedOf(id, it) + 1);
    }
    for (const k of todayCombos) usedCombos.add(k);
    prevDayCombos = todayCombos;
  }
  return out;
}

/* How many DIFFERENT outfits an assignment actually puts on her, counted by
   LOOK — the r13 rule, so five shoe permutations of one outfit stay one outfit.
   This is the number her report was really about.

   ⚠️ ALSO PER GROUP, because the trip total hides exactly the case she reported
   (2026-08-06 r2). Nine occasions in nine looks and nine occasions where the
   dressy evenings carry seven of them while four casual days share two both
   read as "distinct: 9". `byGroup` is keyed on packDemandKey, so two
   temperature bands at one level in one leg are ONE variety group — which is
   also where the cross-group duplication got in.
   `deficit` = how many looks short of the target each group is, summed;
   `maxDeficit` = the worst single group. Pass `target` (packSolve's
   optionTarget) so a fortnight at one level isn't asked for fourteen looks. */
function packAssignVariety(demand, assign, target = null) {
  const keys = new Set();
  const byGroup = new Map();
  let placed = 0;
  for (const occ of (demand || [])) {
    const cd = assign && assign.get(occ.id);
    const k = packDemandKey(occ);
    let g = byGroup.get(k);
    if (!g) byGroup.set(k, g = { n: 0, looks: new Set(), occ });
    g.n++;
    if (!cd) continue;
    placed++;
    const look = packLookKey(cd.ids);
    keys.add(look);
    g.looks.add(look);
  }
  let deficit = 0, maxDeficit = 0;
  for (const g of byGroup.values()) {
    const want = target ? Math.min(g.n, target(g.occ)) : g.n;
    const short = Math.max(0, want - g.looks.size);
    deficit += short;
    if (short > maxDeficit) maxDeficit = short;
  }
  return { placed, distinct: keys.size, byGroup, deficit, maxDeficit };
}

// demand + chosen → the [{date, ids}] shape packSchedule walks.
function assignOf(demand, chosen) {
  const out = [];
  for (const occ of demand) {
    const cd = chosen.get(occ.id);
    if (cd && occ.date) out.push({ date: occ.date, ids: cd.ids, occId: occ.id });
  }
  return out;
}

/* The number that makes this feel like magic: "18 pieces → 31 outfits."
   Distinct outfits the pack yields across every level the trip demands. */
function packOutfitCount(pack, demand, opts = {}) {
  const ids = pack instanceof Set ? pack : new Set(pack);
  const seen = new Set();
  for (const lvl of new Set((demand || []).map(o => o.level).filter(Boolean))) {
    const occ = (demand || []).find(o => o.level === lvl);
    const list = packCandidates({ ...occ, level: lvl }, [...ids], { ...opts, all: true });
    for (const cd of list) if (cd.ids.every(id => ids.has(id))) seen.add(cd.ids.join(","));
  }
  return seen.size;
}

/* ---- gaps: diagnostic, never a wishlist (D11) --------------------------- */
function packGaps(demand, rackIds, opts = {}) {
  const out = [];
  for (const occ of (demand || [])) {
    if (packCandidates(occ, rackIds, opts).length) continue;
    // Nearest level that IS coverable, so the flag can offer a stretch rather
    // than a purchase. Shopping is a hard NO and packing is where it's most
    // tempting to break.
    let nearest = null;
    for (let d = 1; d <= 3 && !nearest; d++) {
      for (const lv of [occ.level - d, occ.level + d]) {
        if (lv < 1 || lv > 8) continue;
        if (packCandidates({ ...occ, level: lv }, rackIds, opts).length) { nearest = lv; break; }
      }
    }
    out.push({ occId: occ.id, date: occ.date, level: occ.level, context: occ.context, nearest });
  }
  return out;
}

/* ---- wash before you go ------------------------------------------------- */
function packWashPlan(pack, { ls = null, today = null, startDate = null } = {}) {
  const lst = ls || laundryState();
  const t = today || todayStr();
  const hamper = [], underTol = [];
  for (const id of (pack || [])) {
    const it = itemById.get(id);
    if (!it) continue;
    const tol = wearTolerance(it);
    if (tol === Infinity) continue;
    if (isDirty(it, lst)) { hamper.push(it); continue; }
    const n = packWearSeed(it, lst);
    if (n > 0 && n >= tol - 1) underTol.push({ item: it, n, tol });
  }
  // The last day a wash still helps: the day before departure.
  const lastUseful = startDate ? shiftDate(startDate, -1) : null;
  return { hamper, underTol, lastUsefulWashDay: lastUseful && lastUseful >= t ? lastUseful : null };
}

/* ===================================================================
   ITEMS FIRST  (2026-07-30, redesign)

   Her words: *"I do want it to start with clothing not outfits... Start with
   items and number of slots THEN make sure the outfits cover the required
   occasions days etc. I think in items and like to decide my outfits on the go
   more often than not."*

   ⚠️ THIS DOES NOT REPEAL INVERSION ①, and understanding the difference matters.
   ① exists because a pack chosen ONLY to satisfy independent (slot, level)
   counts can come back with every count met and no wearable outfit in it —
   three tops that all clash with the one bottom, or two level-5 pieces that sit
   in an exclusion pair. That failure is still real. What changes is WHERE the
   guarantee lives: coverage is now a CHECK (packCoverage) rather than the
   generator. Counts are the interface and the objective; outfits are how the
   answer is verified and, on demand, browsed.
   ⚠️ So packCoverage is not optional decoration. Delete it and this is exactly
   the set-cover design ① warns about.

   packSolve is deliberately KEPT — outfits-on-demand and the "other options"
   browser both run on it. This is an added path, not a replacement.

   The flow, and the order is the point:
     packCounts   → the app PROPOSES a number per slot (the magic moment; she
                    revises from a starting answer rather than filling a form)
     packFill     → choose actual items to hit those counts
     packCoverage → can every occasion actually be dressed? name the blocker
   =================================================================== */

// Slots the count dials cover, in dressing order. Workout is absent for the same
// reason buildRack excludes it: those clothes don't mix with the rest.
const PACK_COUNT_SLOTS = ["Tops", "Bottoms", "Dresses", "Shoes", "Outerwear"];
// Pieces per slot per trip-DAY, used only until she has trips to learn from.
// ⚠️ Guesses, labelled as guesses. Rewrite from St. Louis and Javea (§15).
const PACK_SLOT_RATE_SEED = { Tops: 1.0, Bottoms: 0.45, Dresses: 0.15, Shoes: 0.35, Outerwear: 0.2 };
/* ⚠️ The cap on what NORMAL proposes — cushion is allowed past it (see
   packCounts). Read as an absolute ceiling it made the tightness dial a no-op
   for anyone whose own packing rate already exceeded it. */
const PACK_COUNT_MAX = { Tops: 14, Bottoms: 8, Dresses: 6, Shoes: 5, Outerwear: 3 };
// Tightness moves the proposal itself, not just repetition.
const PACK_COUNT_W = { 1: 0.8, 2: 1, 3: 1.25 };

const packSlotOf = (i) => (i && isLayer(i) && i.category === "Tops") ? "Tops" : suggestSlot(i);

/* Does this piece serve an occasion at level `lv`?
   ⚠️ LEVEL 1 ANSWERS TO isFunctionWear, NOT to the formality set, and getting
   that wrong is why a workout day would not build (2026-08-04 r5, reported).
   Her running shoes are subcategory Sneakers at formality [2,3] carrying the
   `gear:workout` tag — she wears them casually too — so asking "does the set
   contain 1" credits NOTHING to a Utility occasion. packFill then never packed
   the shoes that would dress it, packCoverage duly found no outfit, and
   packBlockingSlot named a slot that wasn't the problem.
   packCandidates and packSwapCandidates already asked it this way; this is that
   same sentence in ONE place so the four cannot drift. Same reason
   isFunctionWear itself exists — see the ACTIVITY MODE note in CLAUDE.md. */
function packCoversLevel(i, lv) {
  if (!i || !lv) return false;
  return lv === 1 ? isFunctionWear(i) : (itemFormalitySet(i) || []).includes(lv);
}

/* Pieces per slot per day, learned from her own completed trips (of this
   character when there are enough of them), falling back to the seed. Returns
   `source` so the UI can label a guess as a guess. */
function packSlotRates({ caps = null, wearRows = null, today = null } = {}) {
  const use = completedTrips(caps, today);
  const totals = new Map(), rates = {};
  let days = 0;
  for (const c of use) {
    const n = tripDates(c).length;
    if (!n) continue;
    days += n;
    for (const i of capsuleItems(c.id)) {
      const s = packSlotOf(i);
      if (!s) continue;
      totals.set(s, (totals.get(s) || 0) + 1);
    }
  }
  if (!days || !totals.size) {
    return { rates: { ...PACK_SLOT_RATE_SEED }, source: "seed", trips: 0 };
  }
  for (const s of PACK_COUNT_SLOTS) rates[s] = (totals.get(s) || 0) / days;
  return { rates, source: "history", trips: use.length };
}

/* THE PROPOSAL. Three floors, and the largest wins per slot:
     ① her own rate    — pieces/day on comparable past trips × trip days
     ② the laundry floor — wear-days this slot must absorb ÷ typical tolerance
     ③ the coverage floor — one piece per distinct formality band it must reach,
                            because a single piece can't be in two disjoint bands

   ⚠️ ② is `ceil(wear-days / tolerance)`, the very formula inversion ② rejects as
   an ENGINE. It is fine here and only here: this is a starting number she can
   revise, not a feasibility guarantee. The guarantee is packCoverage plus
   packSchedule. Do not promote this arithmetic back into a solver. */
function packCounts(demand, { K = PACK_OPTIONS.normal, days = null,
                              wearRows = null, caps = null, today = null,
                              rates = null } = {}) {
  const occs = demand || [];
  const nDays = days || new Set(occs.map(o => o.date).filter(Boolean)).size || occs.length || 1;
  const rr = rates || packSlotRates({ caps, wearRows, today });
  const w = PACK_COUNT_W[K] || 1;
  const levels = [...new Set(occs.map(o => o.level).filter(Boolean))].sort((a, b) => a - b);
  // Distinct formality BANDS, not levels: adjacent levels are usually covered by
  // the same piece (a blouse at [4,5] serves both), so counting raw levels
  // over-proposes. A gap of 2+ is a genuinely different band.
  const bands = levels.reduce((acc, lv) => {
    if (!acc.length || lv - acc[acc.length - 1] >= 2) acc.push(lv);
    return acc;
  }, []);

  const out = {}, why = {};
  for (const slot of PACK_COUNT_SLOTS) {
    /* ⚠️ TIGHTNESS IS APPLIED AFTER THE CAP, NOT INSIDE THE RATE (2026-08-05,
       her third report: "lean/normal/cushion still does nothing").

       It used to scale only the RATE term, and then `n` took the max of that
       against the laundry and coverage floors and finally clamped to
       PACK_COUNT_MAX. Both ends of that swallow the dial:
         · the max: whenever laundry or formality bands decide the number, the
           one term K touches isn't the one being read;
         · the clamp: `packSlotRates` derives her rate from what she ACTUALLY
           packed on past trips, and she packs generously — measured on a 7-day
           trip at her real rates, Tops/Bottoms/Dresses/Shoes/Outerwear all
           pinned to their caps at BOTH normal and cushion. Identical bags.

       So the cap is now what NORMAL proposes, and tightness moves off that:
       cushion may exceed it, lean may go under it but never under the hard
       floors (you cannot pack fewer tops than the laundry needs, whatever the
       dial says). Measured after: 26 / 34 / 43 pieces on that same trip.
       ⚠️ `floor` is clamped by normalN before it becomes a lower bound — a
       laundry floor above the cap must not make lean bigger than normal. */
    const rate = Math.round(((rr.rates || {})[slot] ?? PACK_SLOT_RATE_SEED[slot]) * nDays * 10) / 10;
    const fromRate = Math.round(rate);
    // Wear-days this slot absorbs. Tops and Dresses share the top half, Bottoms
    // and Shoes get one fill per occasion.
    const share = (slot === "Tops") ? 0.8 : (slot === "Dresses") ? 0.2 : 1;
    const wearDays = (slot === "Outerwear") ? 0 : Math.ceil(occs.length * share);
    const tol = PACK_TYPICAL_TOL[slot] ?? Infinity;
    const fromLaundry = (tol === Infinity || !wearDays) ? 0 : Math.ceil(wearDays / tol);
    const fromBands = (slot === "Outerwear" || slot === "Dresses") ? 0 : bands.length;
    const hardFloor = Math.max(fromLaundry, fromBands, slot === "Outerwear" ? 0 : 1);
    // What NORMAL would propose: the old formula exactly, at w = 1.
    const normalN = Math.min(Math.max(fromRate, hardFloor), PACK_COUNT_MAX[slot] ?? 99);
    // ⚠️ floor for lean, round for cushion: rounding a 2 down by 20% has to
    // reach 1, or the dial does nothing at the small end either.
    const scaled = w < 1 ? Math.floor(normalN * w) : Math.round(normalN * w);
    const n = Math.max(Math.min(hardFloor, normalN), scaled);
    out[slot] = n;
    // The "why" is shown on the dial. It's the old max(laundry, coverage)
    // formula finally in the one place it was ever good enough for.
    const bits = [];
    // Prefer the rate explanation on a tie — "you average 1 per trip" is a
    // better reason for one dress than "1 wear-days at 2 per wash", which also
    // read as broken grammar.
    if (fromLaundry > fromRate && fromLaundry > 0) {
      bits.push(`${wearDays} wear-day${wearDays === 1 ? "" : "s"} at ${tol} per wash`);
    } else if (fromRate > 0) {
      bits.push(`you average ${rate} per ${nDays}-day trip`);
    }
    if (fromBands > 1 && fromBands >= n) bits.push(`${fromBands} formality bands to reach`);
    why[slot] = bits.join(" · ") || "one to have";
  }
  return { slots: out, why, bands, days: nDays, rateSource: rr.source, rateTrips: rr.trips };
}
/* Typical wears-per-wash per slot, for packCounts' laundry floor. DERIVED from
   WEAR_TOLERANCE rather than restated, so editing a tolerance there can't leave
   a stale duplicate here (median across the slot's subcategories; Infinity when
   the whole slot never gets dirty, as shoes and outerwear don't). */
const PACK_TYPICAL_TOL = (() => {
  const out = {};
  for (const slot of ["Tops", "Bottoms", "Dresses", "Shoes", "Outerwear"]) {
    const vals = (TAXONOMY_DEFAULT[slot] || [])
      .map(sub => (sub in WEAR_TOLERANCE) ? WEAR_TOLERANCE[sub] : (WEAR_TOLERANCE_CAT[slot] ?? Infinity))
      .filter(v => Number.isFinite(v))
      .sort((a, b) => a - b);
    out[slot] = vals.length ? vals[Math.floor(vals.length / 2)] : Infinity;
  }
  return out;
})();

/* Split a slot's count across its subcategories, for the expanded dial. Same
   rate logic, from what she actually packs. */
function packSubCounts(slot, n, { caps = null, today = null } = {}) {
  const use = completedTrips(caps, today);
  const tally = new Map();
  for (const c of use) for (const i of capsuleItems(c.id)) {
    if (packSlotOf(i) !== slot) continue;
    tally.set(i.subcategory, (tally.get(i.subcategory) || 0) + 1);
  }
  /* ⚠️ With no trip history, fall back to what she actually OWNS AND WEARS in
     this slot — not the first three taxonomy entries. That fallback proposed
     "2 Graphic tees" for a closet containing none, which is worse than no
     suggestion: it's the app confidently naming clothes she doesn't have. */
  if (!tally.size) {
    for (const i of items) {
      if (itemStatus(i) !== "Available" || packSlotOf(i) !== slot) continue;
      tally.set(i.subcategory, (tally.get(i.subcategory) || 0) + 1 + wearCount(i.id) * 0.05);
    }
  }
  const pool = (TAXONOMY[slot] || []).filter(s => tally.has(s));
  if (!pool.length || n <= 0) return {};
  const tot = pool.reduce((s, x) => s + (tally.get(x) || 1), 0);
  const out = {};
  let left = n;
  pool.forEach((s, k) => {
    const share = (tally.get(s) || 1) / tot;
    const v = k === pool.length - 1 ? left : Math.min(left, Math.round(n * share));
    if (v > 0) out[s] = v;
    left -= v;
  });
  return out;
}

/* ---- how much she ACTUALLY wears a piece (2026-08-04 r6) ------------------
   Reported: the pack reached for beach sandals, hiking boots and snow boots
   "before ever thinking to suggest my birkenstocks, which I wore almost every
   day of my last trip and wear all the time at home too".

   Both halves of that sentence are evidence the app already holds and was
   throwing away at the moment it chose what to pack:
   ⚠️ `rackWarmth` is RECENCY ONLY, 0–1 over 60 days — a shoe worn once three
      days ago scores 0.95 and one worn thirty times scores 0.98. At weight 10
      it could never outrank `set.length * 6`, so a specialist that happens to
      span one more formality band beat her everyday shoe on breadth alone.
   ⚠️ `travelProven` needs `TRIP_MEMORY_MIN`(2) trips AND worn-on-every-one, so
      "worn almost every day of my last trip" — the single strongest signal she
      has — counted for exactly nothing.

   So: wear-DAYS (never rows — the 2026-07-24 rule), log-scaled so 30 days beats
   3 decisively while 300 doesn't run away with it, and trip days weighted double
   because this is a suitcase. Returns ONE pass over `wears`, built once per
   packFill call — `wearCount` inside the candidate loop would be the documented
   items × wears comparator trap. */
function packWearSignals({ wearRows = null, caps = null, today = null } = {}) {
  const rows = wearRows || wears;
  const away = new Set();
  for (const c of completedTrips(caps, today)) for (const d of tripDates(c)) away.add(d);
  const home = countByDay(rows, w => (w.item_id ? [w.item_id] : []));
  const trip = countByDay(rows.filter(w => away.has(w.worn_on)), w => (w.item_id ? [w.item_id] : []));
  return { home, trip };
}
function packAffinity(id, sig) {
  if (!sig) return 0;
  return Math.log1p(sig.home.get(id) || 0) + 2 * Math.log1p(sig.trip.get(id) || 0);
}
/* ⚠️ Weighted to beat a one- or two-band BREADTH difference (6 points a band)
   but never a real coverage deficit (`fill * 100`) — an occasion nothing else
   can dress still outranks her favourite shoe, which is the whole guarantee
   packCoverage exists to keep. Re-measure both if either scale changes. */
const PACK_AFFINITY_W = 10;
const PACK_RECENCY_W = 4;     // was 10, and was carrying weight it couldn't hold

/* Fill the counts with actual items.
   Greedy per slot, scoring each candidate on what it ADDS: formality levels the
   slot can't yet reach, then contexts, then proven-on-past-trips, then warmth.
   ⚠️ Pinned pieces (her "keep") count toward the target and are never dropped —
   that's what makes the keep/swap control trustworthy. */
function packFill(targets, { c = null, demand = null, rack = null, pinned = null,
                             subTargets = null, wxFor = null, banned = null,
                             pool = null } = {}) {
  const dem = demand || [];
  const rackIds = (rack && rack.ids) || [];
  const keep = new Set(pinned || []);
  const skip = new Set(banned || []);
  const proven = new Set((travelProven(buildTravelStats(c ? capsules.filter(x => x.id !== c.id) : null)) || [])
    .map(e => e.item && e.item.id).filter(Boolean));
  // ONE pass over wears for the whole fill — see packWearSignals.
  const sig = packWearSignals({ caps: c ? capsules.filter(x => x.id !== c.id) : null });
  const wantLevels = [...new Set(dem.map(o => o.level).filter(Boolean))];

  // image_path is deliberately NOT required — see suggestOutfits (2026-08-13).
  const avail = (pool || items).filter(i => itemStatus(i) === "Available" && !isNoSuggest(i));
  const rackSet = new Set(rackIds);
  // Level 1 (Utility) draws from the whole closet, never the rack — the rack
  // excludes the Workout category on purpose. Same precedence as _suggBasePool.
  const needsUtility = wantLevels.includes(1);

  /* ⚠️ SEASON AND WEATHER GATE THE BAG, NOT JUST THE OUTFITS (2026-08-04 r6).
     Reported: the pack "put in snow boots, which is crazy and I haven't worn in
     years". packFill took a `wxFor` argument and never used it — the only season
     gating anywhere was whatever buildRack happened to apply, and the level-1
     branch above bypasses the rack entirely by design. Measured on a Summer
     trip: snow boots were the SECOND shoe picked, with rackWarmth 0 and no
     wears, while inSeasonWx(snow, "Summer") was already false. So the bag could
     hold pieces packCandidates would then refuse to build an outfit from —
     which is the worst of both, because packCoverage reports the gap the bag
     itself caused.
     ⚠️ Eligible on ANY leg, not all: Madrid-then-Javea is two climates and a
     piece that only serves the cold half still earns its place. Same reason
     packRack unions a rack per leg.
     ⚠️ inSeasonWx is rescue-shaped — unknown season is eligible, and a real
     forecast can rescue an out-of-season piece — so this narrows only what is
     genuinely wrong for every climate on the trip. */
  const legs = c ? packLegsOrWhole(c) : [];
  const legSeasons = legs.map(leg => {
    const d0 = (leg.dates && leg.dates[0]) || null;
    return { season: d0 ? seasonOf(d0) : null, wx: (d0 && wxFor) ? wxFor(d0) : null };
  });
  const seasonOk = (i) => !legSeasons.length ||
    legSeasons.some(({ season, wx }) => !season || inSeasonWx(i, season, wx));

  const candidates = avail.filter(i =>
    !skip.has(i.id) &&
    (rackSet.has(i.id) || (needsUtility && isFunctionWear(i))) &&
    (i.category !== "Workout" || needsUtility) &&
    (keep.has(i.id) || seasonOk(i)));   // her keeps are never second-guessed

  const bySlot = {};
  const packIds = new Set();
  for (const slot of PACK_COUNT_SLOTS) {
    const want = Math.max(0, targets[slot] || 0);
    const inSlot = candidates.filter(i => packSlotOf(i) === slot);
    const chosen = [];
    // Her keeps come first and occupy their slot's budget.
    for (const i of inSlot) if (keep.has(i.id)) chosen.push(i);
    const subWant = subTargets && subTargets[slot] ? { ...subTargets[slot] } : null;
    if (subWant) for (const i of chosen) if (subWant[i.subcategory]) subWant[i.subcategory]--;

    /* ⚠️ Score on DEFICIT REDUCTION per level, not on "does this reach a level
       nothing else reaches". Scoring bare coverage packed five tees and one
       sweater for a trip with a work day: the tee covered levels 2–3, the sweater
       covered 5, every level was then "covered", and the remaining picks fell
       through to warmth — so it never packed a blouse she wears to work every
       week, and the whole L5 day hung on one sweater. Coverage is a per-level
       CAPACITY question (how many wear-days at this level can the pack absorb),
       which is the laundry dimension applied per level.
       ⚠️ HONEST SCOPE, all three facts established by mutation, not by argument:
       ① In the COMMON path the pool comes from buildRack, whose own formality
          top-up (RACK_LEVEL_MIN = 2 per core slot per needed level) already
          guarantees two L5 tops. So neither term below rescues the everyday
          case — the rack does. Don't credit them with more than they do.
       ② The subcategory penalty is what carries a MIXED pool: with it off, a
          tee-heavy pool fills up on tees and leaves one L5 top.
       ③ This capacity term is what carries a UNIFORM pool, where every candidate
          is the same subcategory so ② is flat: with it off, three occasions at
          L5 got one L5 blouse and three L3 ones.
       Each is pinned by exactly one case (the two packFill cases below). Removing
       either without removing its case is how this silently regresses.
       ⚠️ Levels only, deliberately: context coverage was tried here and removed
       because itemContexts walks the whole wears table per call, and this is
       inside a candidate loop — items × wears, the documented comparator trap. */
    /* The top half is split between Tops and Dresses — but the split has to be
       PER LEVEL, from what can actually serve that level.
       ⚠️ A flat 0.8/0.2 meant a Dressed Up evening only ever asked Dresses for
       0.2 of a wear-day, so the fill picked a Polished Casual dress over the one
       cocktail dress that reaches the level and left the gap it existed to
       prevent. When no top in the pool reaches a level, dresses carry it whole —
       and vice versa. Found by pinning Party/Shower to Dressed Up. */
    const canReach = (list, lv) => list.some(i => packCoversLevel(i, lv));
    const topsPool = candidates.filter(i => packSlotOf(i) === "Tops");
    const dressPool = candidates.filter(i => packSlotOf(i) === "Dresses");
    const topHalfShare = (lv) => {
      const t = canReach(topsPool, lv), d = canReach(dressPool, lv);
      if (slot === "Tops") return t ? (d ? 0.8 : 1) : 0;
      return d ? (t ? 0.2 : 1) : 0;
    };
    const needAt = new Map();
    for (const o of dem) {
      if (!o.level) continue;
      const w = (slot === "Tops" || slot === "Dresses") ? topHalfShare(o.level) : 1;
      if (!w) continue;
      needAt.set(o.level, (needAt.get(o.level) || 0) + w);
    }
    // How many wear-days one piece can absorb before it needs washing.
    const capacityOf = (i) => {
      const t = wearTolerance(i);
      return t === Infinity ? 99 : t;
    };
    const haveAt = new Map();
    // ⚠️ Walks the DEMANDED levels asking packCoversLevel, not the piece's own
    // set — that's what lets a gear-tagged sneaker count toward a Utility day.
    const noteCover = (i) => {
      const cap = capacityOf(i);
      for (const lv of needAt.keys()) {
        if (packCoversLevel(i, lv)) haveAt.set(lv, (haveAt.get(lv) || 0) + cap);
      }
    };
    chosen.forEach(noteCover);
    const subsUsed = new Map();
    for (const i of chosen) subsUsed.set(i.subcategory, (subsUsed.get(i.subcategory) || 0) + 1);

    while (chosen.length < want) {
      let best = null, bestScore = -Infinity;
      for (const i of inSlot) {
        if (chosen.some(x => x.id === i.id)) continue;
        if (subWant && !(subWant[i.subcategory] > 0)) continue;
        // Never pick something that can't co-exist with what's already in.
        if (chosen.some(x => isExcluded(x.id, i.id))) continue;
        const set = [...needAt.keys()].filter(lv => packCoversLevel(i, lv));
        /* ⚠️ A PIECE THAT SERVES NO OCCASION ON THIS TRIP IS NEVER PACKED, and
           the slot RUNS SHORT instead (2026-08-04 r5, reported: the pack "is
           putting items in that don't match the contexts/formalities for the
           trip, and admitting that they don't match").
           Once every demanded level had laundry capacity, `fill` went to 0 for
           every remaining candidate and the score fell through to rackWarmth —
           so the tail of each slot filled up with whatever she'd worn lately,
           whether or not the trip had a day for it. packItemWhy then printed
           the honest consequence, "doesn't fit any occasion on this trip",
           which is the app correctly reporting a choice it should not have
           made. Same call as the rack's off-level ceiling (r2): a shorter pack
           that reflects her trip beats one padded with clothes for days she
           isn't having.
           ⚠️ Guarded on needAt.size — with no levels in demand at all there is
           nothing to be off-level FROM, and the gate would empty every slot. */
        if (needAt.size && !set.length) continue;
        const cap = capacityOf(i);
        let fill = 0;
        for (const lv of set) {
          const deficit = Math.max(0, (needAt.get(lv) || 0) - (haveAt.get(lv) || 0));
          fill += Math.min(cap, deficit);
        }
        // Once every level has capacity, prefer breadth and a different
        // subcategory over another near-copy of what's already in the bag.
        const s = fill * 100 + set.length * 6
          - (subsUsed.get(i.subcategory) || 0) * 12
          + (proven.has(i.id) ? 25 : 0)
          + packAffinity(i.id, sig) * PACK_AFFINITY_W
          + rackWarmth(i.id) * PACK_RECENCY_W
          + (rack && rack.cold && rack.cold.includes(i.id) ? 4 : 0);
        if (s > bestScore) { bestScore = s; best = i; }
      }
      if (!best) break;
      chosen.push(best);
      noteCover(best);
      subsUsed.set(best.subcategory, (subsUsed.get(best.subcategory) || 0) + 1);
      if (subWant && subWant[best.subcategory]) subWant[best.subcategory]--;
    }
    bySlot[slot] = chosen.map(i => i.id);
    for (const i of chosen) packIds.add(i.id);
  }
  return { pack: [...packIds], bySlot, short: Object.fromEntries(
    PACK_COUNT_SLOTS.map(s => [s, Math.max(0, (targets[s] || 0) - (bySlot[s] || []).length)])) };
}

/* THE CHECK that keeps items-first honest (see the header). For every occasion,
   can an outfit actually be built from this pack? When it can't, name the SLOT
   that's blocking, because "add a top" is actionable and "Thursday fails" isn't.
   ⚠️ Uses the same enumerator as everything else (suggestOutfits with the pack
   as its pool), so it cannot disagree with what the outfit views will show. */
function packCoverage(pack, demand, { wxFor = null, poolIds = null } = {}) {
  const ids = pack instanceof Set ? [...pack] : (pack || []);
  const idSet = new Set(ids);
  const byOcc = new Map();
  const uncovered = [];
  const memo = new Map();
  for (const occ of (demand || [])) {
    const key = `${occ.level}|${occ.date || ""}`;
    let n = memo.get(key);
    if (n == null) {
      const list = packCandidates(occ, ids, { wxFor, all: true })
        .filter(cd => cd.ids.every(x => idSet.has(x)));
      n = list.length;
      memo.set(key, n);
    }
    byOcc.set(occ.id, n);
    if (!n) uncovered.push({
      occId: occ.id, date: occ.date, level: occ.level, context: occ.context,
      blocker: packBlockingSlot(ids, occ.level, poolIds),
    });
  }
  const seen = new Set();
  for (const lv of new Set((demand || []).map(o => o.level).filter(Boolean))) {
    const occ = (demand || []).find(o => o.level === lv);
    for (const cd of packCandidates(occ, ids, { wxFor, all: true })) {
      if (cd.ids.every(x => idSet.has(x))) seen.add(cd.ids.join(","));
    }
  }
  return { byOcc, uncovered, covered: (demand || []).length - uncovered.length, outfits: seen.size };
}

/* Which slot is stopping this level from being dressable — and it must be a slot
   she can ACTUALLY fix.

   ⚠️ Naming a slot with nothing to offer is worse than saying nothing. Caught by
   pinning a Dressed Up evening on a closet whose only level-6 pieces are a
   cocktail dress, a blazer, heels and trousers: the flag said "needs a top", the
   "Add one" offer duly added a top, and coverage did not move — because she owns
   no top that reaches 6. When no slot can be filled, say so plainly and let it
   stay a gap (D11: report it, never turn it into shopping).

   `poolIds` is the trip rack. Without it this falls back to the old
   pack-only reasoning, which is why it's threaded through packRegroup. */
function packBlockingSlot(ids, level, poolIds = null) {
  const reaches = (list, slot) => list.map(id => itemById.get(id)).some(i =>
    i && packSlotOf(i) === slot && packCoversLevel(i, level));
  const inPack = (slot) => reaches(ids, slot);
  const available = (slot) => !poolIds || reaches(poolIds, slot);

  // Top half: a dress substitutes for Tops AND Bottoms, so it's only a problem
  // when neither route is dressed.
  const topHalfOk = inPack("Dresses") || (inPack("Tops") && inPack("Bottoms"));
  if (!topHalfOk) {
    if (!inPack("Tops") && available("Tops")) return "Tops";
    if (!inPack("Bottoms") && available("Bottoms")) return "Bottoms";
    if (!inPack("Dresses") && available("Dresses")) return "Dresses";
    return null;    // nothing in the closet reaches this level — an honest gap
  }
  if (!inPack("Shoes")) return available("Shoes") ? "Shoes" : null;
  return null;      // pieces exist at this level but no valid combination of them
}

/* ---- mid-trip: "wash these six" ----------------------------------------
   The pack was solved before departure against the laundry plan she declared.
   Once she's there and actually logging wears, the schedule can be re-run
   FORWARD from real state over the days that are left — which turns the vague
   "do laundry at some point" into the only version that's actionable: the
   specific pieces the back half of the trip needs.

   ⚠️ Same discipline as tripUnwornNow: this decides whether to speak at all.
   Null on the last day (nothing left to plan for) and null when nothing would
   actually run out, because a laundry row that always shows is a row she stops
   reading. It is inventory, not a nudge — no dismiss, it goes away by itself.

   ⚠️ Reads the BY-DAY PLAN first and the solve record only as a fallback. By
   mid-trip the plan is what she's been living from (planWoreIt writes to it),
   so the solver's original assignment may be several revisions stale. */
function packMidTripWash(c, today = todayStr(), { ls = null, wearRows = null } = {}) {
  if (!isDatedTrip(c) || tripPhase(c, today) !== "trip") return null;
  const rest = tripDates(c).filter(d => d >= today);
  if (rest.length < 2) return null;                 // last day — the recap owns it
  const lst = ls || laundryState();

  // What she plans to wear on each remaining day: the by-day plan if it has
  // looks, else the pack's own assignment for that date.
  const assign = [];
  const rec = packRecord(c.id);
  const fromRec = packAssignFromRecord(c.id);
  const { demand } = packDemandFor(c.id, c, { wearRows });
  for (const d of rest) {
    const looks = planActiveLooks(c, d);
    if (looks.length) {
      const ids = new Set();
      for (const oid of looks) {
        const o = outfitById.get(oid);
        if (o) for (const it of outfitItems(o)) ids.add(it.id);
      }
      if (ids.size) { assign.push({ date: d, ids: [...ids] }); continue; }
    }
    for (const occ of demand.filter(o => o.date === d)) {
      const cd = fromRec.get(occ.id);
      if (cd) assign.push({ date: d, ids: cd.ids });
    }
  }
  if (!assign.length) return null;

  const sched = packSchedule(assign, { dates: rest, ls: lst, washDays: packWashDays(c) });
  // A piece is "needed washed" if it's already dirty and still due to go out, or
  // if the remaining days would push it past tolerance.
  const needed = new Map();
  for (const v of sched.violations) {
    if (!needed.has(v.itemId)) needed.set(v.itemId, { item: itemById.get(v.itemId), date: v.date, tol: v.tol });
  }
  for (const a of assign) {
    for (const id of a.ids) {
      const it = itemById.get(id);
      if (!it || needed.has(id)) continue;
      if (isDirty(it, lst)) needed.set(id, { item: it, date: a.date, tol: wearTolerance(it) });
    }
  }
  const list = [...needed.values()].filter(e => e.item);
  if (!list.length) return null;
  list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { list, items: list.map(e => e.item), daysLeft: rest.length, firstDate: list[0].date };
}

/* ---- what it left out, and why -----------------------------------------
   ⚠️ "Packed N×, worn 0×" is a FACT, never advice. A piece packed three times
   and never worn may be the just-in-case option doing exactly its job. This
   names the omission and offers a one-tap include; it must never become a
   "stop packing this" recommendation. */
function packLeftOut(c, pack, { caps = null, wearRows = null } = {}) {
  const inPack = new Set(pack || []);
  const stats = buildTravelStats(caps || (c ? capsules.filter(x => x.id !== c.id) : null), wearRows);
  return (travelUnused(stats) || [])
    .filter(e => e.item && !inPack.has(e.item.id))
    .map(e => ({ item: e.item, packed: e.packed, worn: e.worn }));
}

/* ---- wear it, don't pack it (D9) ---------------------------------------- */
function packBulkyAdvice(pack) {
  return (pack || []).map(id => itemById.get(id))
    .filter(i => i && PACK_BULKY_SUBCATS.includes(i.subcategory));
}

/* ---- the builder grades itself -----------------------------------------
   The app disagreeing with itself is the most interesting thing it does, and
   an engine that reports its own hit rate is one she can calibrate against. */
function packGrade(c, { wearRows = null, members = null } = {}) {
  if (!isDatedTrip(c)) return null;
  const rows = wearRows || wears;
  const dates = new Set(tripDates(c));
  const mem = members || new Set(capsuleItems(c.id).map(i => i.id));
  const wornDays = new Map();
  for (const w of rows) {
    if (!w.item_id || !w.worn_on || !dates.has(w.worn_on)) continue;
    let s = wornDays.get(w.item_id);
    if (!s) wornDays.set(w.item_id, s = new Set());
    s.add(w.worn_on);
  }
  const loggedDays = new Set([...wornDays.values()].flatMap(s => [...s])).size;
  if (loggedDays < PACK_GRADE_MIN_DAYS) return null;
  const worn = [...mem].filter(id => wornDays.has(id));
  const unpacked = [...wornDays.keys()].filter(id => !mem.has(id));
  return {
    suggested: mem.size, worn: worn.length, unpacked: unpacked.length,
    unpackedItems: unpacked.map(id => itemById.get(id)).filter(Boolean),
    hitRate: mem.size ? worn.length / mem.size : null,
    loggedDays,
  };
}

/* ===================================================================
   PERSISTENCE — inversion ③ in practice.

   The solve's result is STATE, not a derivation. It lives in two places:
     kv "pack:<capsuleId>"  — the record: assignments, locks, pins, drops,
                              the seed, and the slate hash used for diffing
     capsule_items          — the pack itself (packed=false → the checklist)

   ⚠️ capsules.plan is written only by an EXPLICIT "send to trip plan" action,
   never automatically. Materialising ~14 combos as real looks on every solve
   would flood her Looks list with auto-created records she never asked for, and
   the spec calls that pass optional for exactly that reason.
   =================================================================== */
function packRecord(cid) {
  const v = kvData.get(PACK_KEY_PREFIX + cid);
  return v && typeof v === "object" ? v : {};
}
function packHasPlan(cid) { return !!(packRecord(cid).built); }
async function savePackRecord(cid, patch) {
  await kvUpdate(PACK_KEY_PREFIX + cid, prev => ({ ...(prev && typeof prev === "object" ? prev : {}), ...patch }));
}
/* Re-key a record written under the positional ids onto the content-derived
   ones. Runs once per capsule, at load, before anything reads the assignment.

   Without it, every occasion on every existing pack orphans on the deploy and
   her arranged trip re-solves the first time she opens it — the inversion-③
   violation this whole change exists to prevent, delivered at the worst moment.

   ⚠️ The pairing is EXACT, not a guess: both id schemes are computed from the
   SAME slate (rebuilt under legacyPlacement so it reproduces the old spread),
   so index i in one list is the same occasion as index i in the other.
   ⚠️ `selected` ids are date-free, so they map correctly whichever placement
   built them. `floor` ids can drift when the new spread fills a day the old one
   left bare — those occasions simply re-solve, which is correct.
   ⚠️ Writes through savePackRecord WITHOUT awaiting: kvUpdate sets kvData
   synchronously, so the load that triggered this sees the migrated record, and
   the network write settles behind it. */
function packMigrateRecord(cid) {
  const rec = packRecord(cid);
  if ((rec.assignV || 0) >= PACK_ASSIGN_V) return false;
  const c = capsuleById.get(cid);
  if (!c) return false;
  /* ⚠️ DECIDE FROM THE KEYS, NOT FROM THE MISSING STAMP. A record written under
     the new scheme but never stamped — anything saved between the deploy and
     the next packPersist, and every fixture — would otherwise be "migrated",
     i.e. have every one of its still-correct keys looked up in a legacy map,
     miss, and be silently emptied. Losing her outfits while claiming to rescue
     them is worse than the bug. Legacy keys are exactly `YYYY-MM-DD#n`; every
     new one carries a `|`. */
  const isLegacy = (k) => typeof k === "string" && /^\d{4}-\d{2}-\d{2}#\d+$/.test(k);
  const oldKeys = Object.keys(rec.assign || {}).filter(isLegacy);
  const oldLocks = (rec.locked || []).filter(isLegacy);
  if (!oldKeys.length && !oldLocks.length) { savePackRecord(cid, { assignV: PACK_ASSIGN_V }); return false; }

  const legacySlate = packSlate(c, { tripContexts: packTripContexts(cid), legacyPlacement: true });
  const oldDem = packDemand(legacySlate, { legacyIds: true });
  const newDem = packDemand(legacySlate);
  const map = new Map();
  oldDem.forEach((o, i) => { if (newDem[i]) map.set(o.id, newDem[i].id); });
  const remap = (k) => isLegacy(k) ? map.get(k) : k;   // non-legacy keys pass through

  const assign = {};
  for (const [k, ids] of Object.entries(rec.assign || {})) {
    const nk = remap(k);
    if (nk) assign[nk] = ids;
  }
  const locked = (rec.locked || []).map(remap).filter(Boolean);
  const unmet = (rec.unmet || []).map(u => {
    const nk = u && u.occId ? remap(u.occId) : null;
    return nk ? { ...u, occId: nk } : null;
  }).filter(Boolean);
  // occSig is dropped, not remapped — it was never written under scheme 1, and
  // an absent signature means "can't tell if it moved", which reads as unchanged.
  savePackRecord(cid, { assign, locked, unmet, occSig: null, assignV: PACK_ASSIGN_V });
  return true;
}

// A stamp over everything a solve depended on, so re-entry can say what moved.
function packSlateHash(demand) {
  return packHash((demand || []).map(o => `${o.id}:${o.level}:${o.context || ""}`).join("|"));
}
// Rehydrate the stored assignment into the {ids, pieces, score} shape the rest
// of the module speaks. Drops pieces that no longer exist.
function packAssignFromRecord(cid) {
  /* ⚠️ THE MIGRATION HOOK LIVES HERE, not in packLoadState, because this is the
     single place the stored assignment is read — and packMidTripWash and
     packPlanByDate reach it from the home dash without ever loading pack state.
     Hooking the screen would have left the trip dash reading a record whose
     keys no longer matched anything. Idempotent: the version check makes every
     call after the first a no-op. */
  packMigrateRecord(cid);
  const rec = packRecord(cid);
  const out = new Map();
  for (const [occId, ids] of Object.entries(rec.assign || {})) {
    const pieces = (ids || []).map(id => itemById.get(id)).filter(Boolean);
    if (pieces.length) out.set(occId, { ids: pieces.map(p => p.id).sort(), pieces, score: 0 });
  }
  return out;
}
function packLockedFromRecord(cid) {
  const rec = packRecord(cid);
  const out = new Map();
  for (const occId of (rec.locked || [])) {
    const cd = packAssignFromRecord(cid).get(occId);
    if (cd) out.set(occId, cd);
  }
  return out;
}

/* ===================================================================
   THE PACK SCREEN  (capsuleView "pack")
   Days is primary — arriving somewhere with plans is the point; the bag list is
   the consequence. Bag groups by subcategory with the count in the header (D1),
   because that is both the "how many of each" answer she asked for and the order
   she actually packs in.
   =================================================================== */
let _packState = null;       // { cid, slate, demand, rack, res } for the open screen
let _packBusy = false;

// Rebuild the derivations for the open capsule, reusing the stored solve.
/* ITEMS FIRST (2026-07-30). The state is now a PACK — a set of items with a
   per-slot target — and outfits are derived from it on demand. `res` (the solver
   result) is deliberately LAZY: the items screen never needs it, so opening a
   pack no longer pays for a solve. packEnsureSolve fills it in when the outfits
   view or a plan hand-off actually asks. */
function packLoadState(cid, { resolve = false, K = null } = {}) {
  const c = capsuleById.get(cid);
  if (!c) return null;
  const rec = packRecord(cid);
  const { slate, demand } = packDemandFor(cid, c);
  const rack = packRack(c, slate, { wxFor: packWxFor(c) });
  const kk = K != null ? K : (rec.K || PACK_OPTIONS.normal);
  const keeps = new Set(rec.pinned || []);
  const banned = new Set(rec.banned || []);
  const noplan = packNoPlan(cid);

  // The app's PROPOSAL always exists, so a dial can show what it would have said
  // even after she's overridden it.
  const counts = packCounts(demand, { K: kk, days: tripDates(c).length });
  const targets = { ...counts.slots };
  if (!resolve && rec.targets) for (const s of PACK_COUNT_SLOTS) {
    if (Number.isFinite(rec.targets[s])) targets[s] = rec.targets[s];
  }
  const subTargets = (!resolve && rec.subTargets) ? rec.subTargets : null;

  let pack;
  if (!resolve && Array.isArray(rec.pieces) && rec.pieces.length) {
    pack = rec.pieces.filter(id => itemById.has(id));           // her pack, as left
  } else {
    /* Outfits she's worn seed the bag; packFill tops up around them. Passed as
       `pinned` only to force inclusion — they are NOT definites, and nothing
       stores them as such, so she can still drop any of them. */
    const seed = packProvenSeed(demand, { wxFor: packWxFor(c), excluded: banned,
                                          poolIds: (rack && rack.ids) || null });
    pack = packFill(targets, { c, demand, rack,
                               pinned: [...new Set([...keeps, ...seed.ids])], subTargets,
                               banned: [...banned], wxFor: packWxFor(c) }).pack;
  }

  /* ⚠️ `resolve` MUST SURVIVE INTO THE SOLVE (2026-08-05, her report:
     "switching between lean/normal/cushion changes nothing in a pack").

     It didn't, and the reason is that inversion ③'s rehydrate guard is
     unconditional. `packLoadState(cid, {resolve:true})` re-fills the BAG from
     the new K — and then packEnsureSolve found a stored assignment whose pieces
     were all still in that bag, declared it usable, and handed back the very
     outfits K was supposed to change. Cushion grows the bag, so the stored
     assignment is always still contained: the guard could never fail on the one
     path that most needed it. K is options per occasion, which is a property of
     the SOLVE, so it is invisible until the solver actually runs.

     Rehydration is right for a screen that only wants to display; it is wrong
     for an explicit "recompute this". `forceSolve` is that distinction. */
  /* ⚠️ ADDING A PIECE BY HAND HAS TO REACH THE OUTFITS (2026-08-10 r3, her ask:
     "make sure adding items individually works as expected, including
     incorporating into suggested outfits"). It didn't: `addItemsToCapsule` put
     the piece in the bag, but the stored assignment still described the trip
     perfectly, so packEnsureSolve's rehydrate guard passed and no solve ever
     ran. The piece sat in the suitcase and no outfit knew about it.
     One flag, consumed once, so it works whether or not the pack screen was
     open when she added — an in-memory forceSolve can't survive navigation. */
  _packState = { cid, c, slate, demand, rack, counts, targets, subTargets,
                 pack, keeps, banned, noplan, K: kk, res: null, forceSolve: !!resolve };
  packRegroup(_packState);
  return _packState;
}

/* bySlot and coverage are ALWAYS derived from `pack`, never carried alongside it
   — that's what stops the slot lists drifting from the actual pack after an edit.
   Call after any mutation. */
function packRegroup(st) {
  st.bySlot = {};
  for (const slot of PACK_COUNT_SLOTS) st.bySlot[slot] = [];
  for (const id of st.pack) {
    const i = itemById.get(id);
    const s = i ? packSlotOf(i) : null;
    if (s && st.bySlot[s]) st.bySlot[s].push(id);
  }
  st.cov = packCoverage(st.pack, st.demand,
    { wxFor: packWxFor(st.c), poolIds: (st.rack && st.rack.ids) || null });
  st.wash = packWashPlan(st.pack, { startDate: st.c.start_date });
  return st;
}

// Outfits are on demand (her call), so the solve is only run when something asks
// for it — scoped to the pack she's actually taking.
function packEnsureSolve(st, { force = false } = {}) {
  /* ⚠️ CONSUMED HERE, ABOVE THE EARLY RETURN, and not in packLoadState — a
     screen reached with the state already warm (packStateReady returns it
     untouched) would otherwise skip the check and leave the flag set, so the
     re-solve would fire again on some unrelated later open. One flag, one
     consumer, spent the first time anything asks for the outfits. */
  if (!force && st.cid && packRecord(st.cid).needsResolve) {
    force = true;
    savePackRecord(st.cid, { needsResolve: false });
  }
  if (st.res && !force) return st.res;
  // An explicit recompute (a tightness change, "start over") consumes its flag
  // here — one forced solve, not a screen that can never rehydrate again.
  if (st.forceSolve) { force = true; st.forceSolve = false; }
  /* ⚠️ REHYDRATE BEFORE RE-SOLVING — inversion ③, and load-bearing now that the
     by-day planner shows these outfits (2026-08-04 r5). The record IS the state;
     re-entering the solver for a screen that only wants to DISPLAY the plan would
     reshuffle days she never touched, which is the slot machine ③ exists to
     prevent. Only when the stored assignment no longer describes this trip — an
     occasion added, a piece dropped from the bag — does the solver run. */
  /* ⚠️ THE CHECK IS PER OCCASION, NOT ALL-OR-NOTHING (2026-08-06 r2). It used
     to ask "does EVERY occasion have a stored outfit still in the bag" and, on
     yes, hand the whole stored map back. With positional ids that was actively
     wrong — unticking a context renumbered the rest, every id still resolved,
     so nothing re-solved and a removed occasion's outfit was handed to whatever
     moved into its slot. With content ids it is merely blunt: one added
     occasion would re-solve the entire trip and reshuffle days she never
     touched, which is the slot machine ③ exists to prevent.
     Survivors are carried into the solve as TRANSIENT LOCKS instead — stage A
     copies a locked occasion through untouched and the repair skips it, so
     "keep what didn't change, solve what did" needs no new machinery. */
  const stored = packAssignFromRecord(st.cid);
  const sigs = packRecord(st.cid).occSig || {};
  const inPack = new Set(st.pack);
  const keep = new Map();
  if (!force) for (const o of st.demand) {
    const cd = stored.get(o.id);
    if (!cd) continue;                                   // new, renamed or re-levelled
    if (!cd.ids.every(id => inPack.has(id))) continue;    // a piece left the bag
    if (sigs[o.id] && sigs[o.id] !== packOccSig(o)) continue;   // moved day / level / leg
    keep.set(o.id, cd);
  }
  if (!force && st.demand.length && keep.size === st.demand.length) {
    st.res = {
      pack: [...st.pack], assign: keep, options: new Map(), unmet: [],
      violations: [], stats: { pieces: st.pack.length, outfits: 0,
                               legs: (st.rack && st.rack.legs) || 1,
                               seed: packRecord(st.cid).seed || null },
    };
    packRefresh(st);            // options + violations + outfit count, no solve
    return st.res;
  }
  /* ⚠️ Her own locks and the survivors are merged, but ONLY her locks are ever
     written back to `rec.locked` (packPersist doesn't touch it, and nothing
     here does either). Persisting survivors as locks would make her explicit
     "re-solve the unlocked ones" a permanent no-op. */
  const carry = new Map(keep);
  for (const [id, cd] of packLockedFromRecord(st.cid)) carry.set(id, cd);
  st.res = packSolve({
    c: st.c, demand: st.demand,
    rack: { ids: st.pack, cold: [], legs: (st.rack && st.rack.legs) || 1 },
    /* ⚠️ NO WIDER ADD POOL HERE, AND THAT WAS MEASURED, NOT ASSUMED (2026-08-06
       r2). Stage B's add pool is `rackIds` minus what stage A used — and since
       the app passes the BAG as rackIds, that is only the bag's own leftovers.
       It looks like a bug, and a version passing the trip rack was written and
       then thrown away: on every configuration tried (roomy and scarce closets,
       5/8/10-day trips, lean through cushion) stage B added ZERO pieces from
       outside the bag, because packFill already builds a bag richer than the
       option target. The change was unexercised, and its only reachable effect
       would be growing the bag past the slot counts she set.
       If a future round wants it, the evidence to bring is a fixture where
       `packOptionCount` on the filled bag comes in UNDER optionTarget. */
    wxFor: packWxFor(st.c), K: st.K, washDays: packWashDays(st.c),
    pinned: [...st.keeps], locked: carry, noplan: st.noplan,
  });
  /* ⚠️ INVERSION ① IS NOT SELF-ENFORCING AFTER A SOLVE (2026-08-05, her report:
     "it has hiking boots in a workout context that are not listed in the items
     screen"). She was right and the pieces really weren't in the bag.

     `packCandidates` draws LEVEL 1 from the whole closet rather than the rack —
     deliberately, because her running shoes are Sneakers at [2,3] and a Utility
     occasion has no shoes otherwise. So a solve can legitimately choose a piece
     that was never in `st.pack`, and nothing put it back: `bySlot` (the items
     screen) is derived from `st.pack`, which the solver doesn't touch.

     The pack IS the union of the outfits' pieces. Saying so here is the whole
     of inversion ①, and it's what keeps the two screens from disagreeing. */
  packRepack(st);
  /* The mode acts HERE and nowhere else: trim spare capacity to what she asked
     for, once the outfits are settled. Core is untouched by construction, so
     this can't break coverage — and keeping it to one place is what stops the
     mode becoming another opaque multiplier threaded through the fill, which is
     how the old dial got lost for four rounds. */
  packApplyMode(st);
  packRegroup(st);
  /* ⚠️ AND THE OPTION COUNTS HAVE TO BE RE-READ AFTER THE TRIM. Stage B builds
     options out of spare pieces; Light then removes some of those pieces, so
     `res.options` — set during the solve — would keep promising options the bag
     can no longer make. That is the r1 "building options it never spent" bug
     from the other end: a number on screen the suitcase can't honour. A case
     pins the agreement, and it caught this within a minute of the trim landing. */
  packRefresh(st);
  /* ⚠️ A SOLVE THAT ISN'T SAVED IS A SOLVE THAT RUNS AGAIN (2026-08-06 r4, her
     report: *"I need to be able to reopen that item list / suggested outfit
     list without rebuilding it — sometimes I just want to see what it said."*).

     r3 made the BUILD path persist its outfits, but a plain open never did: the
     record had `built` and no `assign`, so every open found nothing to
     rehydrate, solved from scratch, showed her a different answer and threw it
     away again. Inversion ③ says the solve is an EVENT whose result is state —
     so the moment the solver actually runs, the result becomes state, whoever
     asked for it. That is what makes reopening free and stable.
     ⚠️ Writes the SOLVE only, never `built`/`pieces`/`targets`: this is not her
     pressing build, and moving that date on every open would be a small lie in
     the one place that says how current the pack is.
     ⚠️ Fire-and-forget — kvUpdate sets kvData synchronously, so the screen that
     triggered it already sees the stored answer. */
  packPersistSolve(st);
  return st.res;
}

/* Store just the outfits, for a solve nobody explicitly asked to run. */
function packPersistSolve(st) {
  if (!st || !st.res || !st.cid) return;
  if (!packRecord(st.cid).built) return;      // never built — nothing to keep in sync with
  const assign = {};
  for (const [occId, cd] of st.res.assign) assign[occId] = cd.ids;
  const occSig = {};
  for (const o of st.demand) occSig[o.id] = packOccSig(o);
  savePackRecord(st.cid, {
    assign, occSig, assignV: PACK_ASSIGN_V,
    unmet: st.res.unmet || [],
    seed: (st.res.stats && st.res.stats.seed) || packRecord(st.cid).seed || null,
    pieces: st.pack,          // packRepack may have widened the bag — keep the two in step
  });
}
/* The pack's outfits are shown on the by-day planner and the trip dash now, so
   every revision handler can fire from a screen that never loaded the pack.
   Loads the state and rehydrates the solve for whichever capsule is in play.
   Returns null when there's no pack to revise, so callers can just bail. */
function packStateReady(cid = capsuleId) {
  if (!cid || !capsuleById.get(cid)) return null;
  if (!_packState || _packState.cid !== cid) packLoadState(cid);
  if (!_packState || _packState.cid !== cid) return null;
  packEnsureSolve(_packState);
  return _packState;
}

// Weather lookup for a trip, from whatever the plan view already loaded. Null
// when nothing is loaded — the solve still runs on season alone and says so.
function packWxFor(c) {
  if (!c || _planWxLoadedFor !== c.id) return null;
  return (date) => _planWx[date] || null;
}
function packWashDays(c) {
  return tripDates(c).filter(d => planLaundryDay(c, d));
}

async function openPackPlan(cid, { resolve = false } = {}) {
  capsuleId = cid;
  capsuleView = "pack";
  _packMode = "items";
  navDeeper("capsules");
  const c = capsuleById.get(cid);
  // Weather first when we have locations: a pack solved without it is solved on
  // season alone, and for a warm-destination winter trip that is the December
  // bug all over again.
  if (c && (c.locations || []).length && _planWxLoadedFor !== c.id) {
    renderCapsules();
    try { await loadPlanWeather(c); } catch (e) { /* solve on season alone */ }
  }
  packLoadState(cid, { resolve });
  /* ⚠️ SOLVE BEFORE PERSISTING, or the outfits are never stored at all.
     packPersist only writes `assign` when `st.res` exists, and `res` is lazy —
     so building a pack wrote `built` and `pieces` and no outfits, and every
     subsequent open re-solved from scratch. Verified on her live Stl record:
     `built` set, `assign` absent. That is inversion ③ failing silently — the
     solve is supposed to be an EVENT whose result is state, and instead the
     plan could shift under her between two opens of the same screen. */
  if (resolve && _packState && _packState.cid === cid) packEnsureSolve(_packState);
  if (resolve) await packPersist(cid);
  renderCapsules();
}

// Commit the open solve: the record, then capsule_items.
async function packPersist(cid) {
  const st = _packState;
  if (!st || st.cid !== cid) return;
  const rec = packRecord(cid);
  const patch = {
    built: todayStr(), K: st.K, slateHash: packSlateHash(st.demand),
    pieces: st.pack, targets: st.targets, subTargets: st.subTargets || null,
    pinned: [...st.keeps], banned: [...st.banned], assignV: PACK_ASSIGN_V,
  };
  // Only overwrite the stored outfit assignment when a solve actually ran —
  // otherwise editing items would wipe outfits she'd already arranged.
  if (st.res) {
    const assign = {};
    for (const [occId, cd] of st.res.assign) assign[occId] = cd.ids;
    patch.assign = assign;
    patch.unmet = st.res.unmet;
    patch.seed = st.res.stats.seed || rec.seed || null;
    /* What each stored outfit was solved AGAINST, so the next open can tell a
       moved occasion from an untouched one and re-solve only the difference. */
    const sig = {};
    for (const o of st.demand) sig[o.id] = packOccSig(o);
    patch.occSig = sig;
  }
  await savePackRecord(cid, patch);
  await packSyncMembers(cid, st.pack);
}

/* ---- editing the pack -------------------------------------------------
   Every one of these is LOCAL: it changes the item set and re-derives coverage.
   None of them calls packSolve. Outfits are re-derived when she next opens them,
   which is also why st.res is dropped on any change. */

// Rank a slot's members by how little would be lost by removing them, so
// "subtract one" takes the most redundant piece rather than an arbitrary one.
function packRemovalOrder(st, slot) {
  const ids = (st.bySlot[slot] || []).filter(id => !st.keeps.has(id));
  const needAt = new Map();
  for (const o of st.demand) if (o.level) needAt.set(o.level, (needAt.get(o.level) || 0) + 1);
  const reachCount = new Map();
  for (const id of (st.bySlot[slot] || [])) {
    for (const lv of needAt.keys()) {
      if (packCoversLevel(itemById.get(id), lv)) reachCount.set(lv, (reachCount.get(lv) || 0) + 1);
    }
  }
  const cost = (id) => {
    const i = itemById.get(id);
    let unique = 0;
    for (const lv of needAt.keys()) {
      if (packCoversLevel(i, lv) && (reachCount.get(lv) || 0) <= 1) unique++;
    }
    return unique * 100 + rackWarmth(id) * 10;   // higher = more missed
  };
  return ids.sort((a, b) => cost(a) - cost(b));
}

async function packSetTarget(slot, n) {
  const st = _packState;
  if (!st || !PACK_COUNT_SLOTS.includes(slot)) return;
  const max = PACK_COUNT_MAX[slot] ?? 99;
  const want = Math.max(0, Math.min(max, n));
  st.targets[slot] = want;
  const have = (st.bySlot[slot] || []).length;
  if (want > have) {
    // Fill only this slot; everything already in the pack is held.
    const only = {}; for (const s of PACK_COUNT_SLOTS) only[s] = s === slot ? want : 0;
    const held = st.bySlot[slot] || [];
    const filled = packFill(only, {
      c: st.c, demand: st.demand, rack: st.rack, pinned: held,
      subTargets: st.subTargets, banned: [...st.banned], wxFor: packWxFor(st.c),
    });
    for (const id of filled.bySlot[slot] || []) if (!st.pack.includes(id)) st.pack.push(id);
    /* ⚠️ Say so when ＋ can't add. Since a piece serving no occasion is never
       packed (see packFill), a slot can legitimately refuse to grow — and a
       stepper that silently does nothing reads as broken. */
    if ((filled.bySlot[slot] || []).length <= have) {
      toast(`Nothing else in your closet fits this trip's ${slot.toLowerCase()}`);
    }
  } else if (want < have) {
    const drop = packRemovalOrder(st, slot).slice(0, have - want);
    if (drop.length < have - want) toast("Kept pieces stay — unkeep one to go lower");
    st.pack = st.pack.filter(id => !drop.includes(id));
  }
  st.res = null;
  packRegroup(st);
  await packPersist(st.cid);
  renderCapsules();
  packOfferCoverageFix();
}

async function packToggleKeep(itemId) {
  const st = _packState;
  if (!st) return;
  if (st.keeps.has(itemId)) st.keeps.delete(itemId); else st.keeps.add(itemId);
  await packPersist(st.cid);
  renderCapsules();
}

/* Swap one piece for a different one in the same slot. The rejected piece is
   BANNED for this trip, not just skipped — otherwise the same greedy score picks
   it straight back and the button looks broken. */
async function packSwapOne(itemId) {
  const st = _packState;
  if (!st) return;
  const i = itemById.get(itemId);
  if (!i) return;
  const slot = packSlotOf(i);
  st.banned.add(itemId);
  st.keeps.delete(itemId);
  const held = (st.bySlot[slot] || []).filter(id => id !== itemId);
  const only = {}; for (const s of PACK_COUNT_SLOTS) only[s] = s === slot ? (st.targets[slot] || held.length + 1) : 0;
  const filled = packFill(only, {
    c: st.c, demand: st.demand, rack: st.rack, pinned: held,
    subTargets: st.subTargets, banned: [...st.banned], wxFor: packWxFor(st.c),
  });
  const next = filled.bySlot[slot] || [];
  if (next.length <= held.length) {
    st.banned.delete(itemId);
    toast("Nothing else in that slot fits this trip");
    return;
  }
  st.pack = st.pack.filter(id => id !== itemId);
  for (const id of next) if (!st.pack.includes(id)) st.pack.push(id);
  st.res = null;
  packRegroup(st);
  await packPersist(st.cid);
  renderCapsules();
  const added = next.filter(id => !held.includes(id)).map(id => (itemById.get(id) || {}).name).filter(Boolean);
  toast(added.length ? `Swapped in ${added[0]}` : "Swapped", {
    label: "Undo", fn: async () => {
      st.banned.delete(itemId);
      st.pack = st.pack.filter(id => !added.length || id !== next.find(x => !held.includes(x)));
      if (!st.pack.includes(itemId)) st.pack.push(itemId);
      st.res = null; packRegroup(st); await packPersist(st.cid); renderCapsules();
    },
  });
}

/* "✨ different tops" — reroll a whole slot's non-kept members in one tap.
   ⚠️ A piece that is the ONLY one covering a demanded level is held back even
   though she didn't keep it, and the toast says so. Without this, "different
   bottoms" on a closet whose only Very Casual bottoms are two pairs of shorts
   threw both away and returned a pack that couldn't dress three of five days —
   a strictly worse answer to a request for variety. Found by clicking the
   button and reading the result, not by a test. */
async function packRerollSlot(slot) {
  const st = _packState;
  if (!st) return;
  const loadBearing = packUniqueCoverIds(st, slot);
  const current = (st.bySlot[slot] || []).filter(id => !st.keeps.has(id) && !loadBearing.has(id));
  if (!current.length) {
    toast(loadBearing.size ? "These are the only ones that cover this trip's levels" : "Nothing to reroll — all kept");
    return;
  }
  const held = (st.bySlot[slot] || []).filter(id => st.keeps.has(id) || loadBearing.has(id));
  const only = {}; for (const s of PACK_COUNT_SLOTS) only[s] = s === slot ? (st.targets[slot] || 0) : 0;
  // Session-only exclusion: a reroll shouldn't permanently ban what it replaces.
  const filled = packFill(only, {
    c: st.c, demand: st.demand, rack: st.rack, pinned: held,
    subTargets: st.subTargets, banned: [...st.banned, ...current], wxFor: packWxFor(st.c),
  });
  const next = filled.bySlot[slot] || [];
  const fresh = next.filter(id => !current.includes(id));
  if (!fresh.length) { toast(`No other ${slot.toLowerCase()} available for this trip`); return; }
  st.pack = st.pack.filter(id => !current.includes(id));
  for (const id of next) if (!st.pack.includes(id)) st.pack.push(id);
  st.res = null;
  packRegroup(st);
  await packPersist(st.cid);
  renderCapsules();
  if (loadBearing.size) {
    const names = [...loadBearing].map(id => (itemById.get(id) || {}).name).filter(Boolean);
    toast(`Kept ${names.slice(0, 2).join(", ")} — nothing else covers those days`);
  }
  packOfferCoverageFix();
}

/* Pieces in a slot that are the SOLE cover for some demanded level. Removing one
   costs an occasion outright, so the reroll holds them and "subtract" takes them
   last. Shared by packRerollSlot and packRemovalOrder so the two can't disagree
   about what's load-bearing. */
function packUniqueCoverIds(st, slot) {
  const needed = new Set(st.demand.map(o => o.level).filter(Boolean));
  const reach = new Map();   // level → [ids in this slot that cover it]
  for (const id of (st.bySlot[slot] || [])) {
    for (const lv of needed) {
      if (!packCoversLevel(itemById.get(id), lv)) continue;
      if (!reach.has(lv)) reach.set(lv, []);
      reach.get(lv).push(id);
    }
  }
  const out = new Set();
  for (const [, ids] of reach) if (ids.length === 1) out.add(ids[0]);
  return out;
}

// Bulk: swap every selected piece at once.
/* ⚠️ MARKING RE-SOLVES, exactly like unmarking. Telling the app to stop planning
   around a piece leaves every outfit that used it standing — she'd have said
   "don't plan around this" and watched it stay in three outfits. Holds her
   locks, so decided days don't move. */
async function packNoPlanSelected(on) {
  const st = _packState;
  if (!st || !_packSel.size || _packBusy) return;
  const cid = st.cid;
  const ids = [..._packSel];
  _packSel.clear();
  _packBusy = true;
  try {
    await packSetNoPlan(cid, ids, on);
    const st2 = packLoadState(cid, { resolve: true });
    packEnsureSolve(st2, { force: true });
    await packPersist(cid);
    renderCapsules();
    toast(on
      ? `${ids.length} piece${ids.length === 1 ? "" : "s"} still coming · nothing planned around ${ids.length === 1 ? "it" : "them"}`
      : `Back in the plan`);
  } finally { _packBusy = false; }
}

async function packSwapSelected() {
  const st = _packState;
  if (!st || !_packSel.size) return;
  const ids = [..._packSel];
  _packSel.clear();
  for (const id of ids) st.banned.add(id);
  const bySlotDrop = new Map();
  for (const id of ids) {
    const s = packSlotOf(itemById.get(id));
    if (!s) continue;
    if (!bySlotDrop.has(s)) bySlotDrop.set(s, []);
    bySlotDrop.get(s).push(id);
  }
  st.pack = st.pack.filter(id => !ids.includes(id));
  packRegroup(st);
  for (const [slot] of bySlotDrop) {
    const only = {}; for (const s of PACK_COUNT_SLOTS) only[s] = s === slot ? (st.targets[slot] || 0) : 0;
    const filled = packFill(only, {
      c: st.c, demand: st.demand, rack: st.rack, pinned: st.bySlot[slot] || [],
      subTargets: st.subTargets, banned: [...st.banned], wxFor: packWxFor(st.c),
    });
    for (const id of filled.bySlot[slot] || []) if (!st.pack.includes(id)) st.pack.push(id);
    packRegroup(st);
  }
  st.res = null;
  await packPersist(st.cid);
  renderCapsules();
  toast(`Swapped ${ids.length} piece${ids.length === 1 ? "" : "s"}`);
  packOfferCoverageFix();
}

async function packSetSubTarget(slot, sub, n) {
  const st = _packState;
  if (!st) return;
  st.subTargets = st.subTargets || {};
  st.subTargets[slot] = st.subTargets[slot] || packSubCounts(slot, st.targets[slot] || 0);
  st.subTargets[slot][sub] = Math.max(0, n);
  const tot = Object.values(st.subTargets[slot]).reduce((a, b) => a + b, 0);
  st.targets[slot] = tot;
  // Rebuild just this slot to the new per-subcategory shape, keeping her keeps.
  const held = (st.bySlot[slot] || []).filter(id => st.keeps.has(id));
  st.pack = st.pack.filter(id => packSlotOf(itemById.get(id)) !== slot || st.keeps.has(id));
  const only = {}; for (const s of PACK_COUNT_SLOTS) only[s] = s === slot ? tot : 0;
  const filled = packFill(only, {
    c: st.c, demand: st.demand, rack: st.rack, pinned: held,
    subTargets: st.subTargets, banned: [...st.banned],
  });
  for (const id of filled.bySlot[slot] || []) if (!st.pack.includes(id)) st.pack.push(id);
  st.res = null;
  packRegroup(st);
  await packPersist(st.cid);
  renderCapsules();
  packOfferCoverageFix();
}

/* What's happening on this trip, day by day. Every row hands off to the ordinary
   day-plan editor — the same one the week planner uses — because the slate reads
   `dayplan` and a second editor would be a second source of truth for "what's
   happening on day X". Contexts, per-event formality and new contexts are all
   edited there. */
let _pcAddOpen = false;   // the "＋ New context" input on the trip-context list

/* WHAT'S HAPPENING ON THIS TRIP — a flat list of every context she has, ticked
   for the whole trip. No dates, no trip "type".

   Her words: *"give me a list of contexts and i select all. not by date. context
   should also be able to select formality level (eg it says party/shower
   polished casual but i will do party/shower - dressed up)."*

   Each ticked row carries its own formality for THIS trip and how many days it
   takes up. The days number matters — it is what the laundry maths runs on — so
   the app fills it in and she can nudge it, rather than being asked for it.
   ⚠️ Fixed events on a specific date still live in dayplan and are honoured
   first; this list is the date-free "these things will happen" layer. */
function openPackContexts({ back = null } = {}) {
  const st = _packState;
  if (!st) return;
  const cid = st.cid, c = st.c;
  const days = tripDates(c).length;
  const render = () => {
    const chosen = packTripContexts(cid) || packSuggestTripContexts(c);
    const byCtx = new Map(chosen.map(e => [e.ctx, e]));
    const skip = new Set([TRIP_CONTEXT, PACK_FLIGHT_CONTEXT]);
    const all = contextOptions().filter(x => !skip.has(x));
    const picked = all.filter(x => byCtx.has(x));
    const rest = all.filter(x => !byCtx.has(x));

    const row = (ctx) => {
      const e = byCtx.get(ctx);
      const on = !!e;
      const usual = contextFormalityLevel(ctx) || CONTEXT_FORMALITY_SEED[ctx] || null;
      const shown = (e && e.level) || usual;
      return `<div class="det-card" style="margin:0 16px 8px;padding:10px 12px">
        <div style="display:flex;align-items:center;gap:10px">
          <button class="pack-tick" data-pc-tog="${esc(ctx)}" aria-label="Select">${on ? "✓" : ""}</button>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600">${esc(ctx)}</div>
            <div class="muted" style="font-size:12px">${shown ? esc(occLabel(shown)) : "no usual level yet"}${e && e.level && e.level !== usual ? ` · usually ${esc(occLabel(usual))}` : ""}</div>
          </div>
          ${on ? `<div style="display:flex;align-items:center;gap:5px;flex:none">
            <button class="plan-act" data-pc-dec="${esc(ctx)}" aria-label="Fewer days">−</button>
            <div style="min-width:34px;text-align:center;font-weight:700">${e.n || 1}<span class="muted" style="font-weight:400;font-size:11px">d</span></div>
            <button class="plan-act" data-pc-inc="${esc(ctx)}" aria-label="More days">＋</button>
          </div>` : ""}
        </div>
        ${on ? `<div style="font-size:12px;color:var(--muted);padding-top:8px">how dressy, on this trip</div>
        <div class="cap-catbar" style="flex-wrap:wrap;gap:6px;padding-top:4px">
          ${OCCASION_LADDER.map((lbl, k) => {
            const n = k + 1;
            const isSet = e.level === n;
            const isUsual = !e.level && usual === n;
            return `<button class="cap-chip${isSet ? " on" : ""}" data-pc-lvl="${esc(ctx)}|${n}"
              style="font-size:12px${isUsual ? ";border-color:var(--accent);color:var(--accent)" : ""}">${n}. ${esc(lbl)}</button>`;
          }).join("")}
        </div>
        ${e.level ? `<div class="muted" style="font-size:11.5px;padding-top:4px">Set for this trip. Tap it again to go back to your usual.</div>` : ""}` : ""}
      </div>`;
    };

    const total = chosen.reduce((n, e) => n + (e.n || 1), 0);
    /* What the app already put on this trip that she never ticked, so "What's
       happening" is a complete answer to what the trip contains. Calendar
       events used to be invisible here and regenerate on every build — she
       reported the pack planning for a wedding she never selected. */
    const dropped = packDroppedOccasions(cid);
    const allDem = packDemand(packSlate(c, { tripContexts: packTripContexts(cid) }));
    const declared = allDem.filter(o => o.source === "declared");
    const floorDates = new Set(packDemandFor(cid, c).demand
      .filter(o => o.source === "floor").map(o => o.date));
    for (const id of dropped) if (id.includes("|flr#")) floorDates.add(id.split("|")[0]);
    const extraRow = (id, name, note) => {
      const on = !dropped.has(id);
      return `<div class="det-card" style="margin:0 16px 8px;padding:10px 12px">
        <div style="display:flex;align-items:center;gap:10px">
          <button class="pack-tick" data-pc-keep="${esc(id)}" aria-label="Include">${on ? "✓" : ""}</button>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600">${esc(name)}</div>
            <div class="muted" style="font-size:12px">${esc(note)}</div>
          </div>
        </div>
      </div>`;
    };
    const extras = [
      declared.length ? `<div class="stats-sec-hdr" style="padding:10px 16px 4px"><div class="t" style="font-size:14px">From your calendar</div></div>
        <div class="sheet-note" style="padding-top:0">Events already on these dates. Unticking one only takes it out of the packing — it stays on your calendar.</div>
        ${declared.map(o => extraRow(o.id, o.context || occLabel(o.level) || "Event",
            `${planDayLabel(o.date)}${o.level ? " · " + occLabel(o.level) : ""}`)).join("")}` : "",
      floorDates.size ? `<div class="stats-sec-hdr" style="padding:10px 16px 4px"><div class="t" style="font-size:14px">Days with nothing planned</div></div>
        <div class="sheet-note" style="padding-top:0">The app dresses these at the level you usually live at. Untick a day to leave it out of the bag entirely.</div>
        ${[...floorDates].sort().map(d => extraRow(`${d}|flr#0`, planDayLabel(d), "nothing declared")).join("")}` : "",
    ].join("");
    $("#logInner").innerHTML = `
      <div class="sheet-hdr">
        <button class="lnk" id="pcDone" style="font-weight:700">Done</button>
        <h2>What's happening</h2>
        <div style="width:48px"></div>
      </div>
      <div class="sheet-note">Tick everything you'll do on this trip. Each one can have its own formality just for this trip — a Party/Shower you'll do Dressed Up stays Dressed Up here without changing it everywhere else.</div>
      ${!packTripContexts(cid) && chosen.length ? `<div class="pack-warn-note" style="padding:0 16px 6px">These ${chosen.length} are the app's guess from your history, not your choices yet. Untick anything that isn't happening.</div>` : ""}
      ${chosen.length ? `<div style="padding:0 16px 8px"><button class="lnk" id="pcClear" style="font-size:13px;color:var(--muted);font-weight:600">Clear all and start from nothing</button></div>` : ""}
      <div class="center muted" style="font-size:12.5px;padding:0 16px 8px">${total} day${total === 1 ? "" : "s"} accounted for, of ${days} · the two travel days are added for you</div>
      ${total > days ? `<div class="pack-warn-note" style="padding:0 16px 8px">That's ${total - days} more than this trip has days, so some days will carry two outfits.</div>` : ""}
      ${picked.map(row).join("")}
      ${/* ⚠️ ABOVE "Everything else", not below it. Found by rendering the sheet
            and reading it: "Wedding" appeared TWICE — once in the browse list of
            every context she owns, and once as the actual calendar event — with
            the event buried under a dozen rows. What this trip already contains
            is a fact about the trip and belongs beside her own picks; the browse
            list is for adding something new. */ ""}
      ${extras}
      ${picked.length && rest.length ? `<div class="stats-sec-hdr" style="padding:10px 16px 4px"><div class="t" style="font-size:14px">Everything else</div></div>` : ""}
      ${rest.map(row).join("")}
      <div style="padding:6px 16px 16px">
        ${_pcAddOpen ? `<div style="display:flex;gap:6px">
          <input class="inp" id="pcNewInput" placeholder="Name a context…" style="flex:1;font-size:13px" autocomplete="off">
          <button class="cap-chip" id="pcNewSave">Add</button>
        </div>` : `<button class="btn btn-sec" id="pcNewOpen" style="width:100%">＋ New context</button>`}
      </div>
      <div style="height:max(env(safe-area-inset-bottom),10px)"></div>`;

    const save = async (next) => { await setPackTripContexts(cid, next); render(); };
    const clearBtn = $("#pcClear");
    /* ⚠️ Clearing stores an EMPTY LIST, not null — null means "never chosen" and
       packSlate would hand her the proposal straight back. An empty list is a
       decision, and the slate then holds only the plane days plus her floor. */
    if (clearBtn) clearBtn.onclick = () => save([]);
    const list = () => JSON.parse(JSON.stringify(packTripContexts(cid) || packSuggestTripContexts(c)));

    $("#pcDone").onclick = async () => {
      // Persist whatever's shown even if she never toggled anything, so the
      // suggestion becomes her selection rather than re-guessing next open.
      if (!packTripContexts(cid)) await setPackTripContexts(cid, chosen);
      _pcAddOpen = false;
      if (back) { back(); return; }      // came from the build sheet — go back to it
      hideSheet("logSheet");
      packLoadState(cid);
      renderCapsules();
      packOfferCoverageFix();
    };
    $("#logInner").querySelectorAll("[data-pc-tog]").forEach(b => b.onclick = () => {
      const ctx = b.dataset.pcTog;
      const next = list();
      const at = next.findIndex(e => e.ctx === ctx);
      if (at >= 0) next.splice(at, 1);
      else next.push({ ctx, level: null, n: 1 });
      save(next);
    });
    // Calendar events and filler days: the tick is inclusion in the PACK only.
    $("#logInner").querySelectorAll("[data-pc-keep]").forEach(b => b.onclick = async () => {
      const id = b.dataset.pcKeep;
      const next = packDroppedOccasions(cid);
      if (next.has(id)) next.delete(id); else next.add(id);
      await setPackDropped(cid, next);
      render();
    });
    $("#logInner").querySelectorAll("[data-pc-lvl]").forEach(b => b.onclick = () => {
      const [ctx, n] = b.dataset.pcLvl.split("|");
      const next = list();
      const e = next.find(x => x.ctx === ctx); if (!e) return;
      e.level = e.level === +n ? null : +n;     // tapping the set level clears it
      save(next);
    });
    $("#logInner").querySelectorAll("[data-pc-inc]").forEach(b => b.onclick = () => {
      const next = list();
      const e = next.find(x => x.ctx === b.dataset.pcInc); if (!e) return;
      e.n = Math.min(days, (e.n || 1) + 1);
      save(next);
    });
    $("#logInner").querySelectorAll("[data-pc-dec]").forEach(b => b.onclick = () => {
      const next = list();
      const e = next.find(x => x.ctx === b.dataset.pcDec); if (!e) return;
      e.n = Math.max(1, (e.n || 1) - 1);
      save(next);
    });
    const open = $("#pcNewOpen");
    if (open) open.onclick = () => { _pcAddOpen = true; render(); const i = $("#pcNewInput"); if (i) i.focus(); };
    const addNew = () => {
      const inp = $("#pcNewInput");
      const name = (inp ? inp.value : "").trim();
      if (!name) return;
      const next = list();
      if (!next.some(e => e.ctx === name)) next.push({ ctx: name, level: null, n: 1 });
      _pcAddOpen = false;
      save(next);
    };
    const saveBtn = $("#pcNewSave");
    if (saveBtn) saveBtn.onclick = addNew;
    const inp = $("#pcNewInput");
    if (inp) inp.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); addNew(); } };
  };
  render();
  showSheet("logSheet");
}

/* Throw away her overrides and go back to the app's own numbers. Explicit, and
   confirmed, because it discards keeps and swaps she may have spent time on. */
async function packRebuildFromProposal() {
  const st = _packState;
  if (!st) return;
  if (!confirm("Start over from the app's suggested numbers? Your keeps and swaps on this trip will be cleared.")) return;
  await savePackRecord(st.cid, { targets: null, subTargets: null, pinned: [], banned: [], pieces: null });
  _packSel.clear(); _packOpen.clear();
  packLoadState(st.cid, { resolve: true });
  await packPersist(st.cid);
  renderCapsules();
  packOfferCoverageFix();
}

/* ASK BEFORE RAISING (her decision). When an occasion can't be dressed, the app
   never silently bumps her number — it offers, names the slot, and leaves the
   gap flagged if she declines. A toast rather than a modal: it's the app's own
   idiom and it doesn't block her mid-edit. */
function packOfferCoverageFix() {
  const st = _packState;
  if (!st || !st.cov || !st.cov.uncovered.length) return;
  // ⚠️ Only offer when raising a dial can genuinely fix it. Offering "Add one"
  // for a level nothing in her closet reaches added a piece and moved nothing —
  // the app looking like it fixed something it hadn't.
  const first = st.cov.uncovered.find(u => u.blocker);
  if (!first) return;
  const slot = first.blocker;
  const when = first.date ? planDayLabel(first.date) : "one occasion";
  const lvl = OCCASION_LADDER[(first.level || 1) - 1] || "";
  toast(`${when} (${lvl}) needs a ${slot.replace(/s$/, "").toLowerCase()}`, {
    label: `Add one`,
    fn: () => packSetTarget(slot, (st.targets[slot] || 0) + 1),
  });
}
/* Make capsule_items match the pack. ⚠️ Never removes a piece she has already
   ticked as packed — it's physically in the bag, and un-adding it because the
   optimiser changed its mind would be the app arguing with the suitcase. */
async function packSyncMembers(cid, pack) {
  const want = new Set(pack || []);
  const links = capsuleLinkMap.get(cid) || [];
  const have = new Set(links.map(l => l.item_id));
  const packedAlready = new Set(links.filter(l => l.packed).map(l => l.item_id));
  const add = [...want].filter(id => !have.has(id));
  const drop = [...have].filter(id => !want.has(id) && !packedAlready.has(id));
  // ⚠️ syncPack:false — THIS is the projection; syncing back would recurse.
  if (add.length) await addItemsToCapsule(cid, add, false, { syncPack: false });
  if (drop.length) {
    const inList = `(${drop.map(id => `"${id}"`).join(",")})`;
    await rest(`/capsule_items?capsule_id=eq.${cid}&item_id=in.${inList}`, { method: "DELETE" });
    capsuleLinks = capsuleLinks.filter(l => !(l.capsule_id === cid && drop.includes(l.item_id)));
    buildCapsuleIndexes();
  }
}

/* THE PACK SCREEN — items first (2026-07-30).
   Slot sections with a count dial that expands to subcategories, a keep/swap
   control on every piece, and one coverage line. Outfits are a separate mode she
   opens when she wants them, not the default view. */
let _packMode = "items";        // "items" | "outfits"
let _packOpen = new Set();      // slots whose subcategory breakdown is expanded
let _packSel = new Set();       // bulk-swap selection
let _packLastCid = null;

/* ===================================================================
   ONE TRIP SCREEN  (2026-08-09)
   ===================================================================
   Her ask: *"we need to make sure all packing/trip screens go to one machine —
   if I change something from the bag, it should change the build a pack part
   too. We need to unify these and maybe combine them."*

   One trip had EIGHT surfaces: the capsule detail page, the build sheet, Pack →
   Items, Pack → Outfits, the options page, the by-day plan, the trip dash, and
   the add-items picker. Each showed a slice, several could disagree, and the
   state seam underneath them (two lists of "what's coming") is fixed separately.

   ⚠️ IT ABSORBS, IT DOESN'T DELETE. Replacing the detail page outright would
   lose rename, dates, duplicate, share, archive, delete, locations and weather
   — administration she still needs. Those move behind one ⋯ menu; nothing is
   gone. "Replace" means one place to go, not fewer capabilities.
   ⚠️ Composes the existing renderers rather than reimplementing them, so the
   Bag and Outfits sections cannot drift from what the pack screen showed.
   ⚠️ Dated trips only. An undated capsule has no phases, no bag and no
   occasions, so the old detail page is still the right screen for it. */
/* ===========================================================================
   THE TRIP SCREEN — STRIPPED BACK (2026-08-10 r4)

   Her decision, after reviewing the packing feature together: *"let's remove
   almost everything — I give you the list of items I'm packing, and you can
   propose outfits, which I can pull from to plan or create my own outfits
   from the list. You don't invent or add items at all."*

   What that replaced, and why. The builder had grown to ~45 controls, 10
   sheets and 6,099 lines across five rounds, and the three complaints it
   produced were one complaint: it asked her for four coarse inputs, solved the
   whole trip, and then asked her to correct the answer 8–13 times with a
   four-word vocabulary. Every round added a door and no round removed one.
   The shape below has no solver, no bag, no review queue, no laundry schedule
   and no modes — two sections, and the app never decides anything she can't see.

   ⚠️ NOTHING WAS DELETED. Every pack function below still exists and still
   passes its tests; it is simply no longer reachable from the UI. That is
   deliberate — it is reversible in one commit, and it kept this change small
   enough to ship before she leaves. If the stripped version is the keeper, the
   removal is a separate, unhurried pass.
   =========================================================================== */
const TRIP_SECTIONS = ["list", "outfits"];
let _tripSection = null;     // null = pick from what the trip has in it
/* ⚠️ Declared HERE, above their first use: `_tripSuggShow` is initialised from
   TRIP_SUGG_PAGE at load time, and a `const` further down the file is still in
   its temporal dead zone when that top-level statement runs. Function bodies
   could reference them from anywhere; a top-level initialiser cannot. */
const TRIP_SUGG_PAGE = 12;   // outfits added per "Show more"
const TRIP_SUGG_MAX = 120;   // hard cap on what we enumerate at once

// A trip whose last day has passed. Its outfits are history, not a proposal.
const tripIsOver = (c) => !!c && isDatedTrip(c) && c.end_date < todayStr();

function tripDefaultSection(c) {
  // Nothing in the list yet means there is nothing to propose from, so start
  // where the work is. Otherwise lead with the payoff.
  /* ⚠️ A FINISHED trip opens on the list, not on Outfits (2026-08-16). It used to
     open on "Outfits", proposing fresh outfits for a trip that ended weeks ago,
     while the recap — the one thing a past trip is actually for — sat 9th of 11
     rows in the ⋯ menu. The recap gets a real button below. */
  if (tripIsOver(c)) return "list";
  return capsuleItems(c.id).length ? "outfits" : "list";
}
function renderCapsuleTrip() {
  const c = capsuleById.get(capsuleId);
  if (!c) { capsuleView = "list"; return renderCapsuleList(); }
  const sec = TRIP_SECTIONS.includes(_tripSection) ? _tripSection : tripDefaultSection(c);
  const ph = tripPhase(c);
  const phaseLbl = ph === "pack" ? "Packing" : ph === "trip" ? "On the trip"
                 : ph === "unpack" ? "Just back" : capDateLabel(c);

  const seg = `<div class="cap-orgbar">
    <div class="cap-seg">
      ${TRIP_SECTIONS.map(k => `<button data-tripsec="${k}" class="${sec === k ? "on" : ""}">${
        k === "list" ? "Your list" : "Outfits"}</button>`).join("")}
    </div>
    <button class="cap-chip" data-trip-more>⋯</button>
  </div>`;

  const body = sec === "list" ? tripListSectionHtml(c) : tripOutfitsHtml(c);
  /* The payoff for a trip that has ENDED. Reuses `data-cap-recap`, already wired
     through CAPSULE_ACTIONS on the capsules delegation root — one implementation,
     not a second copy of the same action (the ⋯ menu row stays too). */
  const recap = tripIsOver(c)
    ? `<div style="padding:0 14px 12px"><button class="btn" data-cap-recap style="width:100%">📊 Trip recap</button></div>`
    : "";
  return capToolbar(`${c.name}${phaseLbl ? " · " + phaseLbl : ""}`, true) + seg + recap + body +
         `<div style="height:26px"></div>`;
}

/* The list IS the input, and the only input. Reuses the capsule detail page's
   own grid so the packed-ticks, sorting and thumbnails can't drift from it. */
function tripListSectionHtml(c) {
  const list = capsuleItems(c.id);
  const addBtn = (cls, style) => `<button class="${cls}" data-trip-add style="${style}">＋ Add items</button>`;
  if (!list.length) {
    return `<div class="placeholder"><b>Nothing in your list yet</b>
      <div>Add the pieces you're taking. Outfits get proposed from these and nothing else.</div>
      ${addBtn("btn", "margin-top:12px;width:auto;padding:0 18px")}</div>`;
  }
  const packedSet = new Set((capsuleLinkMap.get(c.id) || []).filter(l => l.packed).map(l => l.item_id));
  const packed = list.filter(i => packedSet.has(i.id)).length;
  const dirty = LAUNDRY_READY()
    ? (() => { const ls = laundryState();
               return list.filter(i => itemStatus(i) === "Available" && isDirty(i, ls)).length; })()
    : 0;
  return `<div class="pack-tip">${list.length} piece${list.length === 1 ? "" : "s"}${
      packed ? ` · ${packed} packed` : ""} · tap the circle on a piece to check it off</div>
    ${dirty ? `<div class="cap-launwarn">🧺 ${dirty} piece${dirty === 1 ? " is" : "s are"} in the hamper${
      /* Only before departure is it "wash before you pack" — mid-trip she is
         living out of the bag, and after it the trip is over (2026-08-16). */
      tripPhase(c) === "pack" ? " — wash before you pack" : ""}</div>` : ""}
    <div style="padding:0 14px 10px">${addBtn("btn btn-sec", "width:100%")}</div>
    ${capGroupsHtml(list, true, packedSet)}`;
}

/* ---- outfits from the list, and only from the list ------------------------
   ⚠️ IT CANNOT INVENT OR ADD A PIECE, and that is STRUCTURAL rather than a rule
   someone has to remember: `suggestOutfits` only ever draws from the pool it is
   handed, so passing the capsule's own members IS the guarantee. There is no
   second pool, no rack, no widen, no "beyond the bag" — the whole class of bug
   where the app quietly grew the suitcase cannot occur here.

   ⚠️ EXHAUSTIVE, NOT SAMPLED (`opts.all`). The sampled path exists to make a
   sheet feel fresh each time it opens; this is a list she browses, leaves and
   comes back to, so it is score-ordered and STABLE — the same outfits in the
   same order every time. That is what lets "I'll take that one" survive a
   screen change, and it's the same reason the rack is deterministic.

   ⚠️ `cleanOnly = FALSE`. Laundry is not a filter on a packing list — she washes
   before she leaves, and hiding a piece she's about to pack would be the app
   deciding something behind her. The hamper count is stated on the list instead.

   ⚠️ Cohesion still applies. `formalityOk` + `comboSharesALevel` are inside
   `suggestOutfits`, so a proposal is never three pieces with no level in common.
   The engine's judgment about what goes together is the one thing worth keeping. */
let _tripSuggLevel = null;               // session-only formality ask
let _tripSuggShow = TRIP_SUGG_PAGE;      // how many are on screen right now

function tripOutfitPool(c) {
  return capsuleItems(c.id).filter(i => itemStatus(i) !== "Archive");
}
function tripOutfitCombos(c, pool = null) {
  const list = pool || tripOutfitPool(c);
  if (!list.length) return [];
  // Season anchors on the trip, not on today — packing in August for October.
  const season = c.start_date ? seasonOf(c.start_date) : currentSeason();
  return suggestOutfits(_tripSuggLevel, null, list, season, null, null, false, null, null,
                        { all: true, uniqueCap: TRIP_SUGG_MAX });
}

function tripOutfitsHtml(c) {
  const list = tripOutfitPool(c);
  if (!list.length) {
    return `<div class="placeholder"><b>Nothing to work with yet</b>
      <div>Add the pieces you're taking and outfits get proposed from them.</div>
      <button class="btn" data-trip-add style="margin-top:12px;width:auto;padding:0 18px">＋ Add items</button></div>`;
  }
  const combos = tripOutfitCombos(c, list);

  /* Only offer a level this list can actually BUILD at, so a chip can never come
     back empty — an empty result reads as a broken filter, not as an answer.
     ⚠️ `poolCoversLevel`, NOT "some piece's set contains the level". Those are
     different questions and the difference is the whole 2026-08-04 r2 empty-sheet
     bug: heels and a silk cami put 6 in the covered set while the list holds no
     level-6 bottom, so a "6. Dressed Up" chip rendered and returned nothing.
     Caught here by rendering the screen and counting, not by reading the code. */
  const chips = `<div class="pack-chiprow" style="padding:0 14px 8px">
    <button class="cap-chip${_tripSuggLevel == null ? " on" : ""}" data-trip-lvl="">All</button>
    ${OCCASION_LADDER.map((lbl, idx) => poolCoversLevel(idx + 1, list)
      ? `<button class="cap-chip${_tripSuggLevel === idx + 1 ? " on" : ""}" data-trip-lvl="${idx + 1}">${idx + 1}. ${esc(lbl)}</button>`
      : "").join("")}
  </div>`;

  const own = `<div style="padding:0 14px 10px">
    <button class="btn btn-sec" data-trip-buildown style="width:100%">✎ Build one yourself from the list</button></div>`;

  if (!combos.length) {
    /* ⚠️ TWO DIFFERENT DEAD ENDS, AND ONE MESSAGE USED TO COVER BOTH (2026-08-13).

       The level chips above are gated on `poolCoversLevel` precisely so a chip
       can never come back empty — but the "All" chip is NOT gated, so it is the
       only one that can, and the copy it landed on read "try All" while All was
       the chip already selected. Reachable on day one of essentially every trip:
       add three tops before anything else and the screen renders a one-option
       filter above advice to use that option.

       On a LEVEL, "try All" is real advice. On All, the honest answer is what the
       list is short of — the engine needs shoes, plus either a dress or a
       top-and-bottom (see suggestOutfits' two combo loops), so that is what gets
       named rather than a generic shrug. */
    const have = new Set(list.map(i => suggestSlot(i)));
    const missing = [];
    if (!have.has("Shoes")) missing.push("shoes");
    if (!have.has("Dresses") && !(have.has("Tops") && have.has("Bottoms")))
      missing.push(have.has("Tops") ? "a bottom" : have.has("Bottoms") ? "a top" : "a top and a bottom");
    const onAll = _tripSuggLevel == null;
    const head = onAll ? "Not a complete outfit yet" : "No complete outfit at that level";
    const body = onAll
      ? (missing.length
          ? `Your list needs ${esc(missing.join(" and "))} before it can make one.`
          : "Nothing in the list goes together yet — the pieces share no formality level.")
      : "Your list doesn't cover it yet — tap All, or add a piece.";
    return `<div class="pack-tip">${list.length} piece${list.length === 1 ? "" : "s"} in your list</div>
      ${chips}${own}
      <div class="placeholder" style="padding:30px 32px"><b>${head}</b>
        <div>${body}</div></div>`;
  }

  const shown = combos.slice(0, _tripSuggShow);
  const cards = shown.map(cb => {
    const ids = cb.pieces.map(p => p.id);
    // Already a real look? Say so rather than offering to save it twice —
    // saveComboAsOutfit would merge anyway, but the card would be lying.
    const dup = findDuplicateOutfit(ids, null);
    const idAttr = esc(ids.join(","));
    return `<div class="pack-occ">
      <div class="pack-pieces">
        ${cb.pieces.map(i => `<button class="pack-piece" data-trip-piece="${esc(i.id)}">
          ${thumbHtml(i.image_path, "pack-pthumb")}
          <div class="pack-pname">${esc(i.name || "Untitled")}</div>
        </button>`).join("")}
      </div>
      <div class="pack-occ-acts">
        ${dup
          ? `<button class="plan-act" data-trip-openlook="${esc(dup.id)}">✓ Saved · open it</button>`
          : `<button class="plan-act" data-trip-save="${idAttr}">＋ Save as a look</button>`}
        <button class="plan-act" data-trip-edit="${idAttr}">✎ Change it</button>
      </div>
    </div>`;
  }).join("");

  const left = combos.length - shown.length;
  const more = left > 0
    ? `<div style="padding:0 14px 10px"><button class="btn btn-sec" data-trip-showmore style="width:100%">Show ${Math.min(TRIP_SUGG_PAGE, left)} more</button></div>`
    : "";

  return `<div class="pack-tip">${combos.length}${combos.length >= TRIP_SUGG_MAX ? "+" : ""} outfit${
      combos.length === 1 ? "" : "s"} from your ${list.length} piece${list.length === 1 ? "" : "s"}${
      _tripSuggLevel ? ` at ${esc(occLabel(_tripSuggLevel))}` : ""}</div>
    ${chips}${own}${cards}${more}`;
}

/* The Plan section: what the trip needs, what's definitely coming, how much to
   bring. This is the build sheet's content, no longer trapped in a modal — it
   was the only place definites could be set BEFORE a build, which made the one
   genuine pre-build input the hardest thing to find. */
function tripPlanSectionHtml(c, st) {
  const cid = c.id;
  const rec = packRecord(cid);
  /* ⚠️ An empty stored list is a DECISION; only null means "she hasn't said".
     Falling back on .length would hand her proposal back to someone who had
     just cleared it — the 2026-08-05 bug, and the reason contexts she never
     chose kept turning up in the outfits. */
  const mine = packTripContexts(cid);
  const picked = mine || packSuggestTripContexts(c);
  const { demand } = packDemandFor(cid, c);
  const mode = packMode(cid);
  const washDays = packWashDays(c);
  const pins = (rec.pinned || []).filter(id => itemById.has(id));
  const spare = packModeSpareTarget(mode, demand.length);
  const rows = picked.length
    ? picked.map(e => {
        const lvl = e.level || contextFormalityLevel(e.ctx) || CONTEXT_FORMALITY_SEED[e.ctx];
        return `<div class="pack-mixrow"><span>${esc(e.ctx)}${lvl ? ` · ${esc(occLabel(lvl))}` : ""}</span><b>${e.n || 1}d</b></div>`;
      }).join("")
    : `<div class="pack-warn-note" style="padding:4px 0">Nothing picked.</div>`;
  return `<div style="padding:6px 16px 0">
    <div class="fld">What's happening · ${demand.length} occasion${demand.length === 1 ? "" : "s"}</div>
    <div class="pack-mix">${rows}</div>
    <div class="pack-warn-note" style="padding:6px 0">${mine
      ? "Your picks. A day you've set a fixed event for wins over these."
      : "A starting guess from the contexts you wear most — change it and it's yours."}</div>
    <button class="btn btn-sec" data-trip-ctx style="margin-top:8px;width:100%">${
      picked.length ? "Change what's happening" : "Pick what's happening"}</button>

    <div class="fld" style="margin-top:16px">Definitely bringing${pins.length ? ` · ${pins.length}` : ""}</div>
    ${pins.length ? `<div class="pack-opt-thumbs" style="margin-bottom:8px">${
      pins.slice(0, 8).map(id => thumbHtml((itemById.get(id) || {}).image_path, "pack-opt-th")).join("")}</div>`
      : `<div class="pack-warn-note" style="padding:2px 0 6px">Nothing yet. Anything you add here, the pack gets built around.</div>`}
    <button class="btn btn-sec" data-trip-definites style="width:100%">＋ Pieces you're bringing</button>

    <div class="fld" style="margin-top:16px">How much to bring</div>
    <div class="pack-chiprow">${PACK_MODES.map(m =>
      `<button class="cap-chip${mode === m ? " on" : ""}" data-trip-mode="${esc(m)}">${esc(m)}</button>`).join("")}</div>
    <div class="pack-warn-note" style="padding:2px 0 0">${esc({
      light: "Smallest practical bag — no spare pieces.",
      balanced: "Compact, with a little room to change your mind.",
      flexible: "More options and backups." }[mode])}${
      st ? ` · about ${packCoreOptional(st).core.length + spare} pieces` : ""}</div>

    ${/* ⚠️ THE LAUNDRY QUESTION IS ASKED HERE NOW (2026-08-10 r2, her ask:
          "maybe the bag should have a laundry setting? I will/won't do laundry
          on this trip"). It was a sentence pointing at the by-day planner —
          which is folded away behind "Day by day", so the one input that
          decides how many tees the trip needs lived three taps from the screen
          that decides how many tees the trip needs.
          ⚠️ ZERO NEW STATE: it writes the SAME PLAN_LAUNDRY sentinel the by-day
          planner writes, which packSchedule, packSolve and packMidTripWash all
          already read. Two controls, one fact. */""}
    <div class="fld" style="margin-top:16px">Laundry</div>
    <div class="pack-warn-note" style="padding:2px 0 6px">${washDays.length
      ? `Washing on ${esc(washDays.map(d => fmtDate(d)).join(", "))} — everything resets that day, so the pack can be smaller.`
      : `No wash on this trip, so nothing can go out more times than it has clean wears.`}</div>
    <button class="btn btn-sec" data-trip-laundry style="width:100%">${washDays.length
      ? "Change your wash days" : "I'll do laundry on this trip"}</button>

    <button class="btn" data-trip-build style="margin:14px 0 8px">${
      packRecord(cid).built ? "✨ Rebuild the pack" : "✨ Build the pack"}</button>
    <div class="pack-warn-note" style="padding:0 0 10px">${(c.locations || []).length
      ? `Weather comes from your locations — past about two weeks out it's a typical-for-the-date average, not a forecast.`
      : `⚠️ No locations set, so this packs for the season only. Add one from ⋯ above.`}</div>
  </div>`;
}

/* Everything the old detail page could do, in one place, so absorbing it costs
   nothing. Reuses the detail page's own handlers — these are the same actions,
   not copies of them. */
function openTripMoreSheet() {
  const c = capsuleById.get(capsuleId);
  if (!c) return;
  const row = (act, label, sub) => `<button class="sheet-row" data-tripmore="${esc(act)}">
    <span>${label}${sub ? `<div class="muted" style="font-size:12px;font-weight:400">${esc(sub)}</div>` : ""}</span></button>`;
  $("#moveInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="tripMoreCancel">Close</button>
      <h2>${esc(c.name)}</h2>
      <span style="width:54px"></span>
    </div>
    ${row("add", "＋ Add items", "Browse your closet")}
    ${row("byday", "📅 By-day plan", "Day cards, wash days, wore-it")}
    ${row("detail", "📍 Locations & weather", (c.locations || []).length
        ? (c.locations || []).map(l => l.name).join(", ") : "None set")}
    ${row("rename", "Rename")}
    ${row("dates", "Dates", capDateLabel(c) || "Not set")}
    ${row("dup", "Duplicate")}
    ${row("share", "Share list")}
    ${completedTrips().some(x => x.id === c.id) ? row("recap", "Trip recap") : ""}
    ${row("arch", isCapsuleArchived(c.id) ? "Unarchive" : "Archive")}
    ${row("del", "Delete trip")}`;
  showSheet("moveSheet");
  $("#tripMoreCancel").onclick = () => hideSheet("moveSheet");
  /* ⚠️ WIRED DIRECTLY, because the delegated handlers CANNOT see this sheet
     (2026-08-10 r3, her report: "tapping 'by day plan' from the three dot menu
     doesn't do anything"). That listener is on `#capsulesBody` and this renders
     into `#moveInner`, which is outside it — so the data attributes these rows
     carried reached nothing at all, and every row here was dead except
     Locations, which happened to have its own onclick.
     The "one implementation" the old comment claimed is real now: CAPSULE_ACTIONS
     is what the delegated handler calls too. */
  const cid = c.id;
  $("#moveInner").querySelectorAll("[data-tripmore]").forEach(b => {
    b.onclick = () => {
      hideSheet("moveSheet");
      const act = b.dataset.tripmore;
      if (act === "detail") { capsuleId = cid; capsuleView = "detail"; return renderCapsules(); }
      const fn = CAPSULE_ACTIONS[act];
      if (fn) { capsuleId = cid; fn(cid); }
    };
  });
}

function renderCapsulePack() {
  /* ⚠️ Reset on entry, like _sugg.wholeCloset and _rackExtrasOpen: a widened
     occasion is a thing she did just now, not a setting she has to remember
     turning off. */
  if (_packLastCid !== capsuleId) { _packOptsOcc = null; _packLastCid = capsuleId; }
  const st = _packState && _packState.cid === capsuleId ? _packState : packLoadState(capsuleId);
  const c = capsuleById.get(capsuleId);
  if (!st || !c) return capToolbar("Pack", true) + `<div class="placeholder"><b>No trip</b></div>`;
  const days = tripDates(c).length;

  const legNote = (st.rack.legs > 1) ? ` · ${st.rack.legs} legs` : "";
  const wxFor = packWxFor(c);
  const wxNote = wxFor ? "" : ` · no weather loaded`;
  const histNote = (() => {
    if (!wxFor) return "";
    const ds = tripDates(c).map(d => wxFor(d)).filter(w => w && w.maxT != null);
    if (!ds.length || !ds.every(w => w.hist)) return "";
    const mid = tripDates(c)[Math.floor(days / 2)];
    const month = new Date(mid + "T00:00:00").toLocaleDateString(undefined, { month: "long" });
    const half = +mid.slice(8) <= 15 ? "early" : "mid-to-late";
    return `<div class="pack-warn-note" style="margin-top:8px">🌡 Packed for weather <b>typical for ${esc(half)} ${esc(month)}</b> — beyond the forecast range, so these are normals, not a forecast.</div>`;
  })();

  const head = `<div class="cap-insight">
    <div class="kpi-row">
      <div class="kpi-cell"><div class="kpi-val">${st.pack.length}</div><div class="kpi-lbl">${(() => {
        // The headline number, said the way she can act on it: what the outfits
        // need, and what's spare. "14 pieces" alone tells her nothing she can do.
        const _co = packCoreOptional(st);
        return _co.optional.length ? `${_co.core.length} core + ${_co.optional.length} spare` : "pieces";
      })()}</div></div>
      <div class="kpi-cell"><div class="kpi-val">${st.cov.outfits}</div><div class="kpi-lbl">outfits they make</div></div>
    </div>
    <button class="cap-cov-lbl" data-pack-occasions style="margin-top:10px;width:100%;text-align:left;color:var(--accent)">
      ${st.demand.length} occasion${st.demand.length === 1 ? "" : "s"} over ${days} day${days === 1 ? "" : "s"}${legNote}${wxNote} · edit ›
    </button>
    ${histNote}
  </div>`;

  /* ONE coverage line, and it is the whole reason items-first is safe (see the
     ITEMS FIRST header). Green when every occasion can be dressed; otherwise it
     names the date and the blocking slot, because "add a top" is actionable. */
  const cov = st.cov;
  const covHtml = cov.uncovered.length
    ? `<div class="pack-warn">
        <b>${cov.covered} of ${st.demand.length} occasions can be dressed.</b>
        ${cov.uncovered.slice(0, 4).map(u => {
          const lvl = OCCASION_LADDER[(u.level || 1) - 1] || `level ${u.level}`;
          // ⚠️ No blocker means no slot she can fill would help — usually because
          // nothing in the closet reaches this level. Say that, and stop: gaps
          // are reported, never turned into something to buy (D11).
          const need = u.blocker
            ? ` — needs a ${esc(u.blocker.replace(/s$/, "").toLowerCase())}`
            : " — nothing in your closet reaches this level";
          return `<div>${esc(u.date ? planDayLabel(u.date) : "unplaced")}${u.context ? " · " + esc(u.context) : ""} (${esc(lvl)})${need}</div>`;
        }).join("")}
        ${cov.uncovered.length > 4 ? `<div>…and ${cov.uncovered.length - 4} more</div>` : ""}
        <div class="pack-warn-note">Nothing is added without asking. Add a piece, drop the occasion, or leave the gap.</div>
      </div>`
    : `<div class="pack-tip">✓ Every occasion on this trip can be dressed from these pieces.</div>`;

  const violHtml = (() => {
    const solved = st.res && st.res.violations ? st.res.violations : null;
    if (!solved || !solved.length) return "";
    return `<div class="pack-warn soft">
      ${solved.slice(0, 3).map(v => `<div>🧺 ${esc(planDayLabel(v.date))} — ${esc(v.name)} would be its ${ordinal(v.nth)} wear (washes every ${v.tol})</div>`).join("")}
      <div class="pack-warn-note">Set a laundry day on the by-day planner, or add a piece.</div>
    </div>`;
  })();

  const wash = st.wash;
  const washHtml = (wash.hamper.length || wash.underTol.length) ? `<div class="pack-warn soft">
    ${wash.hamper.length ? `<div>🧺 <b>${wash.hamper.length} in the hamper</b> — ${esc(wash.hamper.slice(0, 3).map(i => i.name || "Untitled").join(", "))}${wash.hamper.length > 3 ? "…" : ""}</div>` : ""}
    ${wash.underTol.length ? `<div>${wash.underTol.length} piece${wash.underTol.length === 1 ? " is" : "s are"} one wear from the hamper</div>` : ""}
    ${wash.lastUsefulWashDay ? `<div class="pack-warn-note">Last wash that still helps: ${esc(fmtDate(wash.lastUsefulWashDay))}</div>` : ""}
  </div>` : "";

  const bulky = packBulkyAdvice(st.pack);
  const bulkyHtml = bulky.length ? `<div class="pack-tip">👞 Wear the ${esc(bulky.map(i => i.name || i.subcategory).join(" / "))} rather than packing ${bulky.length === 1 ? "it" : "them"}.</div>` : "";

  const tabs = `<div class="cap-orgbar">
    <div class="cap-seg">
      <button data-packmode="items" class="${_packMode === "items" ? "on" : ""}">Items</button>
      <button data-packmode="outfits" class="${_packMode === "outfits" ? "on" : ""}">Outfits</button>
    </div>
    <button class="cap-chip" data-pack-tight>${esc(packMode(st.cid))} ✎</button>
  </div>`;

  /* ⚠️ "Don't plan around it" lives on the SELECTION BAR, not on the piece row.
     The row already carries a tick, a thumb, two lines of text and two buttons
     in a 390px column — a fifth control is the `.cap-actions` overflow lesson
     waiting to happen, and this is an occasional decision, not a per-piece one.
     Toggles both ways off the same button, so nothing is one-way. */
  const allNoPlan = _packSel.size && [..._packSel].every(id => st.noplan.has(id));
  const selBar = _packSel.size ? `<div class="cap-orgbar">
    <div class="cap-cov-lbl">${_packSel.size} selected</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
      <button class="plan-act" data-pack-swapsel>✨ Swap these</button>
      <button class="plan-act" data-pack-noplansel="${allNoPlan ? "off" : "on"}">${
        allNoPlan ? "Plan around these" : "Don't plan around"}</button>
      <button class="plan-act" data-pack-selclear>Cancel</button>
    </div>
  </div>` : "";

  const body = _packMode === "outfits" ? packOutfitsModeHtml(st) : packSlotsHtml(st);

  return capToolbar(c.name + " · Pack", true) + `
    <div class="cap-hdr">
      <div class="ch-name">The pack</div>
      <div class="ch-sub">${esc(capDateLabel(c) || "no dates")}</div>
    </div>
    ${head}${covHtml}${violHtml}${washHtml}${bulkyHtml}${tabs}${selBar}${body}
    <div class="pack-footer">
      <button class="cap-plan sec" data-pack-rebuild>
        <svg viewBox="0 0 24 24"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/></svg>
        Start over from the app's numbers
      </button>
      <button class="cap-plan sec" data-pack-byday style="margin-top:8px">
        <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>
        Open the by-day plan
      </button>
      <div class="pack-warn-note" style="padding:8px 16px 30px">These outfits are already on your by-day plan and today's trip screen — nothing to send. Nothing re-picks itself either: keep a piece and it stays, and the dials only fill what's missing.</div>
    </div>`;
}

/* The slot sections. Each is: a header with the count and a stepper, the pieces
   with keep/swap, the app's reason for that number, and an optional subcategory
   breakdown. */
function packSlotsHtml(st) {
  const links = capsuleLinkMap.get(st.cid) || [];
  const packedSet = new Set(links.filter(l => l.packed).map(l => l.item_id));
  const optionFor = packItemsOptionMap(st);
  /* Core vs Optional, marked on the row she's already looking at rather than
     hidden behind another view. A piece her outfits need reads as settled; a
     spare says what it's carrying and offers to come out. That's the packing-
     light decision made where the piece is, with the trade stated. */
  const co = packCoreOptional(st);
  const optLooks = new Map(co.optional.map(o => [o.id, o.looks]));

  return PACK_COUNT_SLOTS.map(slot => {
    const ids = st.bySlot[slot] || [];
    const target = st.targets[slot] || 0;
    if (!ids.length && !target) return "";
    const open = _packOpen.has(slot);
    const proposed = st.counts.slots[slot];
    const changed = target !== proposed;

    const rows = ids.map(id => {
      const i = itemById.get(id);
      if (!i) return "";
      const kept = st.keeps.has(id);
      const sel = _packSel.has(id);
      const isOpt = optLooks.has(id);
      /* \u26a0\ufe0f A piece she's told the app not to plan around says so INSTEAD of
         "spare \u00b7 in 0 of the looks" \u2014 which would be technically true and read
         as the app complaining about a decision she made. */
      const why = st.noplan.has(id)
        ? "coming, but nothing is planned around it"
        : isOpt
          ? `spare \u00b7 in ${optLooks.get(id)} of the looks this bag can make`
          : packItemWhy(i, optionFor.get(id), st.demand);
      return `<div class="pack-bagrow${packedSet.has(id) ? " on" : ""}"${sel ? ` style="background:var(--panel2)"` : ""}>
        <button class="pack-tick" data-pack-sel="${esc(id)}" aria-label="Select">${sel ? "✓" : ""}</button>
        ${thumbHtml(i.image_path, "pack-pthumb")}
        <div class="pack-baginfo">
          <div class="pack-bagname">${esc(i.name || "Untitled")}</div>
          <div class="pack-bagwhy">${esc(why)}</div>
        </div>
        <button class="plan-act" data-pack-keep="${esc(id)}"${kept ? ` style="color:var(--accent);border-color:var(--accent)"` : ""}>${kept ? "📌 Kept" : "Keep"}</button>
        ${isOpt
          ? `<button class="plan-act" data-pack-drop="${esc(id)}" title="Leave this one behind">Leave</button>`
          : `<button class="plan-act" data-pack-swap1="${esc(id)}">Swap</button>`}
      </div>`;
    }).join("");

    const subs = open ? (st.subTargets && st.subTargets[slot]
      ? st.subTargets[slot]
      : packSubCounts(slot, target)) : null;
    const subHtml = open ? `<div class="pack-subs">
      ${Object.entries(subs).map(([sub, n]) => `<div class="pack-bagrow">
        <div class="pack-baginfo"><div class="pack-bagname">${esc(sub)}</div></div>
        <button class="plan-act" data-pack-subdec="${esc(slot)}" data-pack-sub="${esc(sub)}">−</button>
        <div style="min-width:22px;text-align:center;font-weight:700">${n}</div>
        <button class="plan-act" data-pack-subinc="${esc(slot)}" data-pack-sub="${esc(sub)}">＋</button>
      </div>`).join("")}
      ${!Object.keys(subs).length ? `<div class="pack-warn-note">Nothing in your closet for this slot yet.</div>` : ""}
    </div>` : "";

    return `<div class="pack-grp">
      <div class="pack-grp-hd">
        <div class="t">${esc(slot)}</div>
        <div style="display:flex;align-items:center;gap:6px">
          <button class="plan-act" data-pack-dec="${esc(slot)}" aria-label="One fewer">−</button>
          <div class="n">${ids.length}${ids.length !== target ? `<span style="opacity:.5">/${target}</span>` : ""}</div>
          <button class="plan-act" data-pack-inc="${esc(slot)}" aria-label="One more">＋</button>
        </div>
      </div>
      <div class="pack-grp-why">
        ${esc(st.counts.why[slot] || "")}${changed ? ` · <b>you set ${target}</b> (app said ${proposed})` : ""}${
        ids.length < target ? ` · <b>${target - ids.length} short</b> — nothing else you own fits this trip's days` : ""}
      </div>
      ${rows}
      <div class="plan-add-row">
        <button class="plan-act" data-pack-rerollslot="${esc(slot)}">✨ Different ${esc(slot.toLowerCase())}</button>
        <button class="plan-act" data-pack-expand="${esc(slot)}">${open ? "Hide types" : "By type"}</button>
      </div>
      ${subHtml}
    </div>`;
  }).join("") + packLeftOutHtml(st);
}

/* The line under each piece in items mode.
   ⚠️ NOT packWhyLine: that one describes a piece's role in a SOLVED plan ("for
   Errands · 3 of 5 wears"), and items-first has no assignment to read — it was
   silently falling through to "spare option for…", which is wrong when the piece
   is simply part of the pack. Here the honest fact is which occasions it can
   serve, plus the laundry ceiling when it actually binds. A piece that serves
   NOTHING says so, because that's the one worth swapping. */
/* ---- CORE and OPTIONAL — what replaced the tightness dial (2026-08-08) -----
   Her fourth report on that dial was that it did nothing; the audit found the
   reason (packRepack rebuilt the bag and threw the difference away) and the fix
   made the difference real. Measured on a 7-day trip once it worked: core stays
   at 7 / 7 / 9 pieces across lean / normal / cushion while optional moves
   4 / 8 / 10. So the dial was only ever a control over the OPTIONAL COUNT,
   expressed as an abstraction nobody could see.

   So say it directly. "7 core + 4 optional, drop what you don't want" is the
   same decision with nothing to decode, it's per-piece, and it's reversible —
   and each optional piece can explain what removing it costs, which is what
   turns packing light into an informed trade instead of a guess.

   ⚠️ CORE IS DERIVED, NEVER STORED: pieces her chosen outfits actually use,
   plus her definites. That keeps inversion ① true by construction — the bag is
   a superset of the outfits' pieces — and means the two screens cannot drift.
   ⚠️ A DEFINITE IS ALWAYS CORE even if no outfit uses it. She said it's coming;
   that is not the optimiser's call to revisit. It's reported as unused
   (packUnusedDefinites) rather than quietly demoted or dropped. */
const PACK_MODES = ["light", "balanced", "flexible"];
const PACK_MODE_SPARE = { light: 0, balanced: 0.35, flexible: 0.8 };  // × occasions
const PACK_MODE_DEFAULT = "balanced";

function packMode(cid) {
  const m = packRecord(cid).mode;
  return PACK_MODES.includes(m) ? m : PACK_MODE_DEFAULT;
}
function packModeSpareTarget(mode, occN) {
  const r = PACK_MODE_SPARE[mode] ?? PACK_MODE_SPARE[PACK_MODE_DEFAULT];
  return Math.max(0, Math.round((occN || 0) * r));
}
/* Pieces her outfits use ∪ her definites. Everything else in the bag is spare. */
function packCoreIds(st) {
  const core = new Set(packRecord(st.cid).pinned || []);
  if (st.res && st.res.assign) for (const cd of st.res.assign.values()) for (const id of cd.ids) core.add(id);
  return core;
}
/* How many distinct LOOKS this piece takes part in, among outfits the bag can
   actually build. ⚠️ Counted on packLookKey (the look minus shoes), because
   "swap the shoes" is not a different outfit — the r13 rule. One shared
   enumeration for the whole bag; doing it per piece is the items × candidates
   trap that got context scoring thrown out of packFill. */
function packLookReach(st) {
  const reach = new Map();
  const wxFor = packWxFor(st.c);
  const idSet = new Set(st.pack);
  const seenByLevel = new Map();
  for (const occ of st.demand) if (!seenByLevel.has(occ.level)) seenByLevel.set(occ.level, occ);
  for (const occ of seenByLevel.values()) {
    for (const cd of packCandidates(occ, st.pack, { wxFor, all: true })) {
      if (!cd.ids.every(x => idSet.has(x))) continue;
      const look = packLookKey(cd.ids);
      for (const id of cd.ids) {
        let s = reach.get(id);
        if (!s) reach.set(id, s = new Set());
        s.add(look);
      }
    }
  }
  return reach;
}
/* The whole bag, split. `optional` is ranked by what it buys, so trimming to a
   mode takes the least useful first and the list reads top-down as "most worth
   carrying". */
function packCoreOptional(st) {
  const core = packCoreIds(st);
  const reach = packLookReach(st);
  const optional = st.pack.filter(id => !core.has(id)).map(id => ({
    id,
    /* ⚠️ "in N of the looks this bag can make", NOT "adds N". Other pieces
       overlap, so dropping this one doesn't cost all N — claiming it would be
       the app flattering its own arithmetic, and the copy has to match what the
       number actually measures. */
    looks: (reach.get(id) || new Set()).size,
  })).sort((a, b) => (b.looks - a.looks) || (a.id < b.id ? -1 : 1));
  return { core: [...core], optional };
}
// A definite no outfit reached for. A fact, reported — never a demotion.
function packUnusedDefinites(st) {
  const used = new Set();
  if (st.res && st.res.assign) for (const cd of st.res.assign.values()) for (const id of cd.ids) used.add(id);
  return (packRecord(st.cid).pinned || []).filter(id => !used.has(id) && itemById.has(id));
}
/* Trim spare capacity to what the mode asks for. ⚠️ Runs AFTER the solve and
   only ever drops OPTIONAL pieces — never a definite, never anything an outfit
   uses — so it cannot break coverage or contradict the outfits screen. This is
   the one place the mode is allowed to act, which is what stops it becoming
   another opaque multiplier threaded through the fill. */
function packApplyMode(st) {
  const { core, optional } = packCoreOptional(st);
  const want = packModeSpareTarget(packMode(st.cid), st.demand.length);
  if (optional.length <= want) return;
  const keep = new Set(core.concat(optional.slice(0, want).map(o => o.id)));
  st.pack = st.pack.filter(id => keep.has(id));
  if (st.res) st.res.pack = st.pack.slice();
  /* ⚠️ AND THE SLOT TARGETS HAVE TO FOLLOW, or the screen invents a shortfall.
     `st.targets` is what packFill was asked to build; trimming spares leaves it
     above the real bag, so the header read "Tops 5/7" and the why-line said
     "2 short — nothing else you own fits this trip's days" about a closet with
     plenty of tops. That is the app blaming the wardrobe for its own decision —
     and it is the same class as the counts/bag disagreement inversion ① exists
     to prevent. A genuine gap is still reported, by packCoverage, from the
     outfits rather than from a fill target. */
  const bySlot = {};
  for (const id of st.pack) {
    const i = itemById.get(id);
    const s = i ? packSlotOf(i) : null;
    if (s) bySlot[s] = (bySlot[s] || 0) + 1;
  }
  for (const slot of PACK_COUNT_SLOTS) st.targets[slot] = bySlot[slot] || 0;
}

function packItemWhy(i, labels, demand) {
  const bits = [];
  const named = labels && labels.size ? [...labels] : [];
  if (named.length === 1) bits.push(`for ${named[0]}`);
  else if (named.length > 1) bits.push(`for ${named.slice(0, 2).join(" / ")}${named.length > 2 ? ` +${named.length - 2}` : ""}`);
  else {
    /* ⚠️ TWO DIFFERENT FACTS, and the old line told her the wrong one
       (2026-08-04 r6, reported: "still seeing 'doesn't fit any occasion'").
       `labels` is empty whenever the piece appears in no COMPLETE in-pack
       outfit — which is usually not "wrong for this trip" but "nothing in the
       bag pairs with it". Since r5 the fill can't choose an off-level piece at
       all, so a piece reaching this branch is normally one she added herself,
       kept, or that survives in a pack built by the older algorithm. Saying
       "doesn't fit any occasion" about a shirt she deliberately packed is the
       app arguing with the suitcase. Check the level directly and say which. */
    const levels = [...new Set((demand || []).map(o => o.level).filter(Boolean))];
    const servesALevel = levels.some(lv => packCoversLevel(i, lv));
    bits.push(levels.length && !servesALevel
      ? "no day on this trip is dressed like this"
      : "nothing else in the bag goes with it yet");
  }
  const tol = wearTolerance(i);
  if (tol !== Infinity && tol <= 2) bits.push(`${tol} wear${tol === 1 ? "" : "s"} per wash`);
  return bits.join(" · ");
}

// Which occasions a piece is an option for — keyed
// off the items-first state (which has no solver assignment to read).
function packItemsOptionMap(st) {
  const out = new Map();
  const wxFor = packWxFor(st.c);
  const idSet = new Set(st.pack);
  const labelFor = new Map();
  const repOf = new Map();
  for (const occ of st.demand) {
    if (!repOf.has(occ.level)) repOf.set(occ.level, occ);
    let s = labelFor.get(occ.level);
    if (!s) labelFor.set(occ.level, s = new Set());
    s.add(occ.context || OCCASION_LADDER[(occ.level || 1) - 1] || "day");
  }
  for (const [lv, occ] of repOf) {
    for (const cd of packCandidates(occ, st.pack, { wxFor, all: true })) {
      if (!cd.ids.every(x => idSet.has(x))) continue;
      for (const id of cd.ids) {
        let s = out.get(id);
        if (!s) out.set(id, s = new Set());
        for (const l of (labelFor.get(lv) || [])) s.add(l);
      }
    }
  }
  return out;
}

function packLeftOutHtml(st) {
  const leftOut = packLeftOut(st.c, st.pack);
  if (!leftOut.length) return "";
  return `<div class="pack-grp">
    <div class="pack-grp-hd"><div class="t">Left out</div><div class="n">${leftOut.length}</div></div>
    ${leftOut.slice(0, 5).map(e => `<div class="pack-bagrow muted">
      ${thumbHtml(e.item.image_path, "pack-pthumb")}
      <div class="pack-baginfo">
        <div class="pack-bagname">${esc(e.item.name || "Untitled")}</div>
        <div class="pack-bagwhy">packed ${e.packed}× · worn ${e.worn}×</div>
      </div>
      <button class="plan-act" data-pack-add="${esc(e.item.id)}">Bring it</button>
    </div>`).join("")}
    <div class="pack-warn-note">A record, not a verdict — the just-in-case piece may be doing its job.</div>
  </div>`;
}

/* Outfits mode: on demand, and always built from the pack she's actually taking.
   This is where the solver still earns its keep, and where "other options" lives. */
/* ---- the outfits screen (2026-08-05) --------------------------------------
   Her report: "The outfits and the packing list don't correspond to each other.
   The outfits and the list of occasions and the formalities don't correspond.
   Each occasion/formality bucket which I give a number to should have that many
   proposed outfits in a bucket in the outfit list."

   ⚠️ THE BUCKET IS THE UNIT, NOT THE DAY. What she declares is "1 day
   Party/shower → Dressed Up, 2 days Friends → Polished Casual" — a multiset of
   occasions with counts. The screen used to render the PLACED view (one card
   per day), which is a derived detail the solver needs for the laundry schedule
   and she never asked for: it spread her three occasions across seven dated
   cards, mixed her selections in with the plane days and the floor filler, and
   made the counts impossible to check against what she'd asked for. Demand was
   already right; the presentation was answering a different question.

   So: one section per bucket, holding exactly the number of outfits she asked
   for, with the count stated. The by-day view survives underneath, collapsed,
   because the laundry schedule genuinely is per-date.

   ⚠️ Buckets are keyed on (context, level) — the same pair she sets — so
   "Party/shower → Dressed Up" and "Party/shower → Polished Casual" are two
   buckets and not a contradiction. Anything the solver added for its own
   reasons (the two plane days, the floor filler for a day with nothing on it)
   is in its own clearly-labelled section, never mixed into hers. */
function packOutfitsModeHtml(st) {
  packEnsureSolve(st);
  return packReviewBarHtml(st) + packBucketsHtml(st) + packDaysFoldHtml(st);
}
/* ⚠️ "2 decisions left", never "67% complete" — a percentage is a number about
   the app's progress; a count is a number about hers, and it's the one that
   tells her whether stopping now is fine. And the skip is PROMINENT by
   decision: she chose to be offered every occasion rather than a filtered few,
   which only works if declining the whole thing is one tap. */
function packReviewBarHtml(st) {
  const left = packReviewQueue(st).length;
  const total = st.demand.filter(o => st.res && st.res.assign.get(o.id)).length;
  if (!total) return "";
  if (!left) return `<div class="pack-tip">\u2713 You've been through all ${total} outfit${total === 1 ? "" : "s"}.</div>`;
  return `<div class="cap-orgbar">
    <div class="cap-cov-lbl">${left} decision${left === 1 ? "" : "s"} for you${total > left ? ` \u00b7 ${total - left} done` : ""}</div>
    <button class="plan-act" data-pack-reviewskip>These all look fine</button>
  </div>`;
}

// The header for a bucket, and the order they appear in.
const PACK_BUCKET_ORDER = { selected: 0, declared: 1, flight: 2, floor: 3 };
function packBucketKey(o) {
  if (o.source === "flight") return "flight";
  if (o.source === "floor") return "floor";
  return `${o.source}|${o.context || ""}|${o.level || ""}`;
}
function packBucketsHtml(st) {
  const { demand, res } = st;
  const groups = new Map();
  for (const o of demand) {
    const k = packBucketKey(o);
    if (!groups.has(k)) groups.set(k, { source: o.source, context: o.context, level: o.level, occs: [] });
    groups.get(k).occs.push(o);
  }
  const list = [...groups.values()].sort((a, b) =>
    (PACK_BUCKET_ORDER[a.source] ?? 9) - (PACK_BUCKET_ORDER[b.source] ?? 9) ||
    String(a.context || "").localeCompare(String(b.context || "")));

  const asked = packTripContexts(st.cid);
  const summary = `<div class="pack-bucket-sum">
    ${asked && asked.length
      ? `You asked for ${asked.map(e => `<b>${esc(e.ctx)}</b> × ${e.n || 1}`).join(" · ")}.`
      : `The app proposed these from your history — tap “What's happening” to make them yours.`}
    <button class="lnk" data-pack-ctx style="font-size:13px;font-weight:600;color:var(--accent);padding:2px 0">Change what's happening</button>
  </div>`;

  const sections = list.map(g => {
    const n = g.occs.length;
    let title, sub;
    if (g.source === "flight") {
      title = "Travel days";
      sub = `${n} outfit${n === 1 ? "" : "s"} · added for you, the days you fly`;
    } else if (g.source === "floor") {
      title = "Everything else";
      sub = `${n} day${n === 1 ? "" : "s"} with nothing declared — dressed at the level you usually live at`;
    } else if (g.source === "declared") {
      title = [g.context, OCCASION_LADDER[(g.level || 1) - 1]].filter(Boolean).join(" · ");
      sub = `${n} outfit${n === 1 ? "" : "s"} · from an event on your calendar`;
    } else {
      title = [g.context, OCCASION_LADDER[(g.level || 1) - 1]].filter(Boolean).join(" · ");
      sub = `${n} outfit${n === 1 ? "" : "s"}`;
    }
    const canDrop = g.source === "declared" || g.source === "floor";
    // Removing the whole group is one tap when it's several days of filler.
    const dropAll = canDrop && n > 1
      ? `<button class="lnk" data-pack-dropbucket="${esc(packBucketKey(g.occs[0]))}"
           style="font-size:12.5px;font-weight:600;color:var(--muted);padding:2px 0">✕ Remove all ${n}</button>` : "";
    return `<div class="pack-bucket">
      <div class="pack-bucket-hd"><b>${esc(title)}</b><span>${esc(sub)}</span></div>
      ${dropAll}
      ${g.occs.map(o => packOccCardHtml(st, o, { showDate: true, canDrop })).join("")}
    </div>`;
  }).join("");
  const dropped = packDroppedOccasions(st.cid);
  // Never silently narrowed: what she took out is named, and one tap brings it
  // back — the same rule the suggester's pool chip follows.
  const droppedNote = dropped.size
    ? `<div class="pack-bucket-sum">You've taken ${dropped.size} occasion${dropped.size === 1 ? "" : "s"} out of this trip.
        <button class="lnk" data-pack-undrop style="font-size:13px;font-weight:600;color:var(--accent);padding:2px 0">Put them back</button></div>`
    : "";
  return summary + droppedNote + (sections || `<div class="center muted" style="padding:24px 16px">Nothing to dress yet — tap “What's happening”.</div>`);
}

/* ---- taking an occasion out of the trip ---------------------------------
   ⚠️ These write ONLY the pack record. A calendar event she'd rather not pack
   for is still an event; deleting her dayplan entry to satisfy a packing screen
   would be the app overruling her diary. The toast says so, because "removed"
   is ambiguous about which of the two it removed it from. */
async function packDropOccasion(occId) {
  const st = packStateReady();
  if (!st || !occId) return;
  const next = packDroppedOccasions(st.cid);
  next.add(occId);
  await setPackDropped(st.cid, next);
  packStateReady(st.cid);
  renderCapsules();
  toast("Taken out of this trip — it's still on your calendar", [
    { label: "Undo", fn: () => packUndropOccasion(occId) },
  ]);
}
async function packUndropOccasion(occId) {
  const cid = capsuleId;
  if (!cid) return;
  const next = packDroppedOccasions(cid);
  next.delete(occId);
  await setPackDropped(cid, next);
  packStateReady(cid);
  renderCapsules();
}
async function packDropBucket(key) {
  const st = packStateReady();
  if (!st || !key) return;
  const ids = st.demand.filter(o => packBucketKey(o) === key).map(o => o.id);
  if (!ids.length) return;
  const next = packDroppedOccasions(st.cid);
  for (const id of ids) next.add(id);
  await setPackDropped(st.cid, next);
  packStateReady(st.cid);
  renderCapsules();
  toast(`${ids.length} taken out of this trip`, [
    { label: "Undo", fn: async () => {
      const back = packDroppedOccasions(capsuleId);
      for (const id of ids) back.delete(id);
      await setPackDropped(capsuleId, back);
      packStateReady(capsuleId);
      renderCapsules();
    } },
  ]);
}
async function packUndropAll() {
  const cid = capsuleId;
  if (!cid) return;
  await setPackDropped(cid, []);
  packStateReady(cid);
  renderCapsules();
}

/* ONE card, used by the bucket view, the by-day view and the by-day planner, so
   the three can never drift apart in markup or in handlers. `alsoFor` carries
   the same-day merge the day view does; the bucket view never merges, because
   two occasions she asked for are two outfits she asked for. */
/* ===================================================================
   REVIEW — "which would you actually wear?"  (2026-08-08)
   ===================================================================
   The app has never once asked her anything. It presents a finished plan and
   she has to go digging to change it, which is why a dress she'd never wear
   could sit on a card until she found the swap sheet.

   Her decision was to be offered EVERY occasion with a prominent skip, rather
   than only the ambiguous ones — so the queue is ordered by ambiguity instead,
   most uncertain first. Skipping is then always safe: the ones she'd most want
   a say in are the ones she sees first.

   ⚠️ AMBIGUITY IS "THE ALTERNATIVES DIFFER", NEVER "how much will she like it".
   The app has no preference model — scoreCombo's range is ~2.5–5.5, which the
   solver treats as rounding error — so a confidence percentage would be an
   invented number, and inventing one is exactly the guessing layer r19 deleted
   with a "do not rebuild it to help" note. What IS derivable and honest: two
   good answers of different SHAPE and comparable score means the app has no
   basis to choose, which is precisely when her input is worth asking for. */
const PACK_REVIEW_OPTS = 3;

/* ⚠️ DIVERSIFIED BY FORMULA, NOT BY SCORE RANK. "More options" that hands back
   the next three candidates is fake variety — this app has already shipped that
   bug once, when swapping shoes counted as a different outfit (fixed r13 with
   packLookKey). A formula key is the app's own name for an outfit's SHAPE, so
   "a different shape" is a definition already in use rather than a new rule
   invented here. Falls back to look-distinct once shapes run out, so a closet
   with one shape still offers real alternatives. */
function packOccCandidatesRanked(st, occ, n = PACK_REVIEW_OPTS) {
  const wxFor = packWxFor(st.c);
  /* ⚠️ `st.pack` OR the solve's copy. They're the same thing on every real
     path, but the card renderer is reachable from states assembled elsewhere
     (packDaysHtml is driven directly in tests, and by-day surfaces build their
     own), and a review row is not worth throwing a whole screen away for. */
  const bag = st.pack || (st.res && st.res.pack) || [];
  const inPack = new Set(bag);
  const all = packCandidates(occ, bag, { wxFor, all: true })
    .filter(x => x.ids.every(id => inPack.has(id)));
  const shapeOf = (c) => formulaKeyFor(c.ids.map(id => itemById.get(id)).filter(Boolean)) || "";
  const out = [], seenLook = new Set(), seenShape = new Set();
  for (const c of all) {                       // pass 1: one per distinct shape
    if (out.length >= n) break;
    const look = packLookKey(c.ids), shape = shapeOf(c);
    if (seenLook.has(look) || seenShape.has(shape)) continue;
    seenLook.add(look); seenShape.add(shape);
    out.push({ ...c, shape, look });
  }
  for (const c of all) {                       // pass 2: top up on distinct looks
    if (out.length >= n) break;
    const look = packLookKey(c.ids);
    if (seenLook.has(look)) continue;
    seenLook.add(look);
    out.push({ ...c, shape: shapeOf(c), look });
  }
  return out;
}

/* ⚠️ THE OPTIONS ARE DEALT ACROSS THE WHOLE TRIP, NOT COMPUTED PER CARD
   (2026-08-10, her report: *"when it gives alternative outfits, each context
   occasion gets the same set — so I can't choose freely. They should all be
   different so I can choose from among them"*).

   She was right, and it was structural rather than a ranking accident. Every
   occasion at one level enumerates the same bag against the same score, so the
   top three by shape are the same three on every card — measured on a 6-day
   fixture, four Errands days were offered the IDENTICAL trio and both Work days
   another identical trio, out of 8 and 10 in-bag looks respectively. Two of the
   three offered to a day were what OTHER days were already wearing, so
   "choosing" could only produce a duplicate the solver had already priced
   against.

   So the supply is dealt out instead: each occasion's own ranked list (contexts
   differ, so the lists are NOT interchangeable — packOccasionSlotFit and her
   per-occasion rules both bite), minus its own outfit, minus every other
   occasion's outfit, preferring looks nothing else has been offered yet.

   ⚠️ RESCUE-SHAPED, like every other narrowing in this app. Supply runs out
   before the demand does on a scarce closet — four days sharing eight looks
   cannot each have three private alternatives — so the passes relax in order
   and the last one allows anything rather than hand her an empty card. What is
   never relaxed: an option is never another day's current outfit while any
   other candidate exists.
   ⚠️ Dealt in `st.demand` order, which is the order she reads them in. Not the
   review-queue order — that is sorted by ambiguity, which is itself computed
   from these lists, and one deriving from the other would make the sets move
   every time a choice changed the queue. */
/* How deep the per-occasion list has to run before dealing. Three occasions all
   wanting three private alternatives need nine distinct looks between them. */
const PACK_REVIEW_SUPPLY = 4;
// How much of one card may cost weight. One: enough to tell the cards apart,
// never enough to repack the bag from a review row.
const PACK_REVIEW_BEYOND_MAX = 1;

/* ---- what an option would do to the laundry (2026-08-10 r2) ---------------
   Her report: *"it should stop offering or flag for me if I've chosen something
   too many times for laundry. Right now I've selected the same t shirt 4 times
   and that's a problem."*

   She was right and the review was structurally blind to it. `packCandidates`
   passes `cleanOnly=false` ON PURPOSE — laundry is a SCHEDULE constraint here,
   not a pool filter (inversion ②) — so every option was laundry-legal in
   isolation and nothing costed the fourth wear of one tee. The solver knew;
   the review didn't, and the review is where she now makes the choice.

   ⚠️ IT RE-WALKS THE WHOLE TRIP, it does not count wears in the outfit. Placement
   is what decides this: the same four wears are fine either side of a wash day
   and a violation without one. `packSchedule` already answers exactly this
   question with a DATE, so the probe swaps one occasion's outfit into the real
   assignment and asks it again.
   ⚠️ TWO ANSWERS, AND THEY ARE NOT THE SAME QUESTION. `over` is "would a piece
   in THIS outfit be past its wears" — that is what the label must say, because
   an option that merely MOVES a violation from one tee to another shows a delta
   of zero and would otherwise render as clean. `cost` is the delta against
   what's already planned, which is what the ranking needs: a day that is
   already over shouldn't make every option for it look equally bad, and an
   option that FIXES a violation elsewhere scores below zero. */
function packLaundryProbe(st) {
  const base = assignOf(st.demand, st.res.assign);
  const dates = tripDates(st.c);
  const washDays = packWashDays(st.c);
  const ls = laundryState();
  const dateOf = new Map(st.demand.map(o => [o.id, o.date]));
  const was = packSchedule(base, { dates, ls, washDays }).violations.length;
  return (occId, ids) => {
    const date = dateOf.get(occId);
    if (!date) return { cost: 0, over: [] };
    let found = false;
    const swapped = base.map(a => {
      if (a.occId !== occId) return a;
      found = true;
      return { ...a, ids };
    });
    if (!found) swapped.push({ date, ids, occId });
    const v = packSchedule(swapped, { dates, ls, washDays }).violations;
    const mine = new Set(ids);
    return { cost: v.length - was, over: v.filter(x => mine.has(x.itemId)) };
  };
}
/* "3rd wear of the white tee" — the fact, with the number, and nothing else.
   ⚠️ No instruction. The app doesn't tell her to wash things (2026-08-03 r6,
   her words: "I don't like the app telling me to wash x"); the laundry row on
   the Plan tab is where she says what she'll actually do. */
/* ⚠️ IT HAS TO NAME THE DAY WHEN THE DAY ISN'T THIS ONE. The schedule is
   trip-wide, so putting a tee on Monday can be what pushes its FRIDAY wear past
   the line — and "2nd wear of the white tee" on the first card of the trip
   reads as an outright error. Found by rendering the cards: every option on day
   one carried a 2nd-wear flag. */
function packLaundryNote(over, onDate = null) {
  if (!over || !over.length) return "";
  const v = over.slice().sort((a, b) => a.date < b.date ? -1 : 1)[0];
  // ⚠️ Her name for the piece, verbatim — lowercasing it turns "J.Crew Tee"
  // into "j.crew tee", and the app never edits what she typed.
  const when = (onDate && v.date && v.date !== onDate) ? ` (${planDayLabel(v.date)})` : "";
  return `${ordinal(v.nth)} wear of ${v.name}${when}`;
}

function packReviewOptionsAll(st, n = PACK_REVIEW_OPTS) {
  const stamp = st.demand.map(o => {
    const cd = st.res && st.res.assign.get(o.id);
    return o.id + ":" + (cd ? cd.ids.join("-") : "");
  }).join(";") + "|" + ((st.pack || []).length) + "|" + n;
  if (st._revOpts && st._revOpts.stamp === stamp) return st._revOpts.map;

  const cur = new Map();                 // occId → the look it is wearing now
  const claimed = new Set();             // every look some occasion is wearing
  for (const o of st.demand) {
    const cd = st.res && st.res.assign.get(o.id);
    if (!cd) continue;
    const k = packLookKey(cd.ids);
    cur.set(o.id, k);
    claimed.add(k);
  }
  // A deeper supply than n, or the deal has nothing left to spread on day two.
  const supply = new Map();
  for (const o of st.demand) {
    supply.set(o.id, { bag: packOccCandidatesRanked(st, o, n * PACK_REVIEW_SUPPLY), out: null });
  }

  const map = new Map(), taken = new Map(), shapes = new Map(), beyondUsed = new Map();
  const dealt = new Map();               // look → how many occasions were offered it
  for (const o of st.demand) { map.set(o.id, []); taken.set(o.id, new Set()); shapes.set(o.id, new Set()); }
  const probe = packLaundryProbe(st);
  const laundry = new Map();             // occId|look → what it would cost the wash
  const lc = (o, c) => {
    const k = o.id + "|" + c.look;
    if (!laundry.has(k)) laundry.set(k, probe(o.id, c.ids));
    return laundry.get(k);
  };

  const less = (a, b) => {               // lexicographic on the preference key
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
    return false;
  };
  /* One option for one occasion, in preference order: a look nobody else has
     been offered and the bag already holds · then ONE from the closet, priced ·
     then a look another card is also showing.

     ⚠️ THE ORDER OF THOSE THREE WAS MEASURED, NOT ARGUED, and both of the
     simpler rules were tried first. Weight-first alone put the four Errands
     days back on an identical trio, because a bag with two bottoms and four
     tops at one level holds eight looks and five days had already claimed most
     of them — her exact report, reintroduced. Freshness-first alone came back
     with a card whose three alternatives each cost +2 pieces, which is the app
     growing the suitcase to win an argument about variety.
     So the closet is capped at PACK_REVIEW_BEYOND_MAX per card: enough that
     every card differs from every other, never enough to repack the bag by
     itself. Being OFFERED the same look as another day is harmless anyway — it
     only becomes a repeat if she picks it twice, and the solver prices that. */
  const chooseFor = (o, allowClaimed) => {
    const mine = cur.get(o.id), mySet = taken.get(o.id), myShapes = shapes.get(o.id);
    const pick = (list, keyOf) => {
      let best = null, bestKey = null;
      (list || []).forEach((c, rank) => {
        if (c.look === mine || mySet.has(c.look)) return;
        if (claimed.has(c.look) && !allowClaimed) return;
        const key = keyOf(c, rank);
        if (!bestKey || less(key, bestKey)) { best = c; bestKey = key; }
      });
      return best;
    };
    const s = supply.get(o.id);
    /* ⚠️ LAUNDRY IS THE FIRST TERM, ahead of both weight and freshness. An
       option that puts a piece past its wears is the thing she asked the app to
       stop handing her; a repeated offer or one extra piece are costs she can
       weigh. Ranked, never REMOVED — if her whole bag is over the line, the
       honest answer is to show it flagged rather than to empty the card. */
    const lKey = (c) => { const l = lc(o, c); return [l.over.length ? 1 : 0, l.cost > 0 ? 1 : 0]; };
    const bagPick = pick(s.bag, (c, rank) =>
      [...lKey(c), dealt.get(c.look) || 0, myShapes.has(c.shape) ? 1 : 0, rank]);
    if (bagPick && !(dealt.get(bagPick.look) || 0) && !lc(o, bagPick).over.length) return bagPick;
    /* ⚠️ THE CLOSET IS THE OVERFLOW WHEN THE BAG RUNS DRY, and paying for it
       lazily is deliberate. A bag holding three looks for a level cannot give
       four days three private alternatives, and the honest answer is not to
       hand everyone the same three — it is the r1 answer: an option the bag
       doesn't hold yet, priced. But enumerating the trip rack for every
       occasion on every render is the measured hang packCandidates caches
       against, so it only happens for a card the bag itself couldn't fill. */
    if ((beyondUsed.get(o.id) || 0) < PACK_REVIEW_BEYOND_MAX) {
      if (s.out === null) {
        /* ⚠️ AND NEVER A COSTED VARIANT OF A LOOK THE BAG CAN ALREADY MAKE.
           packLookKey drops shoes, so "the same outfit in a shoe you'd have to
           pack" enumerates as a beyond-bag candidate — it showed up as an
           option marked "+1" sitting two cards away from the identical look
           offered free. Charging her a piece for a different shoe is exactly
           the distinction r13 removed from the solver. */
        const bagLooks = new Set(s.bag.map(x => x.look));
        s.out = packReviewBeyond(st, o, n * PACK_REVIEW_SUPPLY)
          .map(x => ({ ...x, look: packLookKey(x.ids) }))
          .filter(x => !bagLooks.has(x.look));
      }
      const outPick = pick(s.out, (c, rank) =>
        [...lKey(c), dealt.get(c.look) || 0, c.adds || 0, myShapes.has(c.shape) ? 1 : 0, rank]);
      // ⚠️ Only take it if it beats the bag on the thing that sent us here.
      // Paying a piece for an option that ALSO breaks the wash is both costs.
      if (outPick && (!bagPick || !less(lKey(bagPick), lKey(outPick)))) return outPick;
    }
    return bagPick;
  };

  // Round by round, so the first card can't take every fresh look for itself.
  for (let round = 0; round < n; round++) {
    for (const o of st.demand) {
      const got = map.get(o.id);
      if (got.length > round) continue;
      const c = chooseFor(o, false) || chooseFor(o, true);   // an empty card is worse
      if (!c) continue;
      // Carried on the option so every surface says the same thing about it.
      const l = lc(o, c);
      got.push(l.over.length ? { ...c, laundry: packLaundryNote(l.over, o.date) } : c);
      taken.get(o.id).add(c.look);
      shapes.get(o.id).add(c.shape);
      dealt.set(c.look, (dealt.get(c.look) || 0) + 1);
      if (c.adds) beyondUsed.set(o.id, (beyondUsed.get(o.id) || 0) + 1);
    }
  }
  st._revOpts = { stamp, map };
  return map;
}

function packReviewOptions(st, occ, n = PACK_REVIEW_OPTS) {
  if (!occ) return [];
  const map = packReviewOptionsAll(st, Math.max(n, PACK_REVIEW_OPTS));
  const got = map.get(occ.id);
  if (got) return got.slice(0, n);
  // An occasion the deal never saw (a card rendered from a hand-built state).
  return packOccCandidatesRanked(st, occ, n);
}
/* ⚠️ AND OPTIONS THAT AREN'T IN THE BAG YET — because a review confined to the
   bag is a review of a decision she was never part of (2026-08-08, her report:
   *"it treats the pack as built… all from within one settled bag. If I don't
   like those options or want to change something, the way to do that is not
   clear. I want input before the bag is finalized."*).

   She was right, and the size of it is the point. Measured on a 7-day trip: the
   in-bag review offered 21 alternatives across 8 occasions while 3,171 existed
   in her closet at those levels — about 0.7%. The bag came out of `packFill`
   with no input from her, so every "choice" was a reshuffle of eight pieces
   somebody else picked.

   ⚠️ These cost WEIGHT, and the label says so ("+2 to your bag"). That is the
   honest trade and it's hers to make — the app's job is to state the cost, not
   to hide the option because it's expensive. Choosing one flows through the
   normal path: packChooseOutfit → packRepack, which UNIONS, so the pieces join
   the bag automatically (that union is what r1 fixed, and this is the second
   thing it buys). */
function packReviewBeyond(st, occ, n = PACK_REVIEW_OPTS) {
  const wxFor = packWxFor(st.c);
  const bag = st.pack || (st.res && st.res.pack) || [];
  const inPack = new Set(bag);
  const pool = (st.rack && st.rack.ids && st.rack.ids.length) ? st.rack.ids : bag;
  const shapeOf = (c) => formulaKeyFor(c.ids.map(id => itemById.get(id)).filter(Boolean)) || "";
  const all = packCandidates(occ, pool, { wxFor, all: true })
    .filter(x => !x.ids.every(id => inPack.has(id)))       // in-bag ones are tier 1
    .map(x => ({ ...x, shape: shapeOf(x), look: packLookKey(x.ids),
                 adds: x.ids.filter(id => !inPack.has(id)).length }));
  /* Cheapest first — one new piece before three — then by score. Packing light
     is the default preference; she can still scroll to the expensive one. */
  all.sort((a, b) => (a.adds - b.adds) || (b.score - a.score) || (a.ids.join() < b.ids.join() ? -1 : 1));
  const out = [], seenLook = new Set(), seenShape = new Set();
  for (const c of all) {                       // one per shape, as tier 1 does
    if (out.length >= n) break;
    const look = packLookKey(c.ids);
    if (seenLook.has(look) || seenShape.has(c.shape)) continue;
    seenLook.add(look); seenShape.add(c.shape);
    out.push(c);
  }
  for (const c of all) {
    if (out.length >= n) break;
    const look = packLookKey(c.ids);
    if (seenLook.has(look)) continue;
    seenLook.add(look);
    out.push(c);
  }
  return out;
}

/* How little basis the app has for its pick. Higher = ask sooner. Two options
   of DIFFERENT shape scoring almost the same is the strongest signal; the same
   shape twice is a weak one however close the scores. */
/* ⚠️ READS THE RAW RANKED LIST, NOT THE DEALT ONE. Ambiguity is a property of
   the occasion — how close its two best answers are — and the deal is a
   presentation decision about who gets shown what. Pointing this at the deal
   would make the review ORDER depend on the deal, which depends on the
   assignment, which a choice changes: the queue would reshuffle under her. */
function packAmbiguity(st, occ) {
  const o = packOccCandidatesRanked(st, occ, 2);
  if (o.length < 2) return 0;                       // no choice to make
  const gap = Math.max(0, (o[0].score || 0) - (o[1].score || 0));
  const spread = (o[0].shape !== o[1].shape ? 1 : 0.4) / (1 + gap);
  /* ⚠️ AND STAKES, not just spread — measured, the spread term alone barely
     discriminates: scoreCombo's top-two gap is usually ~0, so every occasion
     with two shapes scored ~0.99 and the ordering collapsed to date order. The
     doc's own rule is the missing half (§17): a wedding is worth asking about
     even when the app is confident, an airport transfer isn't even when it
     isn't. Both terms are derived — a context she DECLARED, and how dressy the
     day is — so neither is a guess about how much she'll like the outfit. */
  const declared = (occ.source === "selected" || occ.source === "declared") ? 1.6 : 1;
  const dressy = 1 + Math.max(0, (occ.level || 1) - 3) * 0.25;
  return spread * declared * dressy;
}
// Occasions she has actively decided — distinct from "locked", which she can
// also do without being offered a choice.
function packChosenSet(cid) { return new Set(packRecord(cid).chosen || []); }
function packReviewQueue(st) {
  const chosen = packChosenSet(st.cid);
  return st.demand
    .filter(o => st.res && st.res.assign.get(o.id) && !chosen.has(o.id))
    .map(o => ({ occ: o, amb: packAmbiguity(st, o) }))
    .sort((a, b) => (b.amb - a.amb) || ((a.occ.date || "") < (b.occ.date || "") ? -1 : 1))
    .map(x => x.occ);
}

/* ---- what a choice is worth keeping ---------------------------------------
   She asked for the review to teach the app her preferences, proposed for
   confirmation rather than applied silently, and to "bake this into contexts in
   general, not just for trips".

   A choice is CONTRASTIVE — "I picked A over B and C, which were all valid
   here" — which is worth far more per data point than a wear, and it's why the
   volume objection to learning from ~6 trips a year doesn't hold once every
   occasion is offered. Stored compactly and derived from, never trusted as a
   score. ⚠️ Recording starts now even though the proposal UI comes later:
   evidence that isn't being collected can't be learned from when it is. */
const CTX_CHOICES_KEY = "ctxchoices";
const CTX_CHOICES_MAX = 300;
async function recordContextChoice(ctx, level, chosenIds, rejected) {
  if (!ctx) return;                              // a level alone isn't a kind of day
  const prev = kvData.get(CTX_CHOICES_KEY);
  const list = Array.isArray(prev) ? prev.slice() : [];
  list.push({
    ctx, level: level || null, at: todayStr(),
    chose: silhouetteOfIds(chosenIds),
    against: [...new Set((rejected || []).map(ids => silhouetteOfIds(ids)))],
  });
  await kvSet(CTX_CHOICES_KEY, list.slice(-CTX_CHOICES_MAX));
}

/* What makes this option different from the one on offer. ⚠️ States the
   DIFFERENCE, never a recommendation — "A dress instead" tells her what she'd
   be choosing; "better for the weather" would be the app voting in its own
   election. Same rule as "packed 3×, worn 0×". */
/* ⚠️ LABELS ARE COMPUTED FOR THE SET, NOT PER OPTION, and two earlier versions
   got this wrong in the same way. "Separates instead" was true of all three
   alternatives at once; naming each one's lead garment then collided whenever
   two options shared a top and differed below. Both looked fine in the markup
   and were useless on screen — the whole interaction is telling these apart, so
   a label that doesn't distinguish is worse than no label.

   So: for each option, name the first garment (in dressing order) that no OTHER
   option has. Fall back to two names when nothing single is unique. */
const PACK_LABEL_ORDER = ["Dresses", "Tops", "Bottoms", "Shoes", "Outerwear"];
function packOptionLabels(options) {
  const named = options.map(o => {
    const its = o.ids.map(id => itemById.get(id)).filter(Boolean);
    const bySlot = new Map();
    for (const i of its) bySlot.set(packSlotOf(i) || "?", i);
    return PACK_LABEL_ORDER.map(sl => bySlot.get(sl)).filter(Boolean);
  });
  const nameOf = (i) => i.name || i.subcategory || "piece";
  return named.map((mine, k) => {
    const others = named.filter((_, n) => n !== k).map(list => new Set(list.map(nameOf)));
    const unique = mine.find(i => others.every(o => !o.has(nameOf(i))));
    if (unique) return nameOf(unique);
    // Nothing single tells them apart — the pair always does, since the options
    // are look-distinct by construction.
    const pair = mine.slice(0, 2).map(nameOf);
    return pair.length > 1 ? pair.join(" + ") : (pair[0] || "Another option");
  });
}

/* ===================================================================
   OUTFITS FOR ONE OCCASION — a full screen, not three chips on a card
   ===================================================================
   Her report (2026-08-09): *"'From the rest of your closet' needs a full
   rewrite — it only gives a couple options and if I don't like those I'm
   screwed. I'd like it to open to a full screen for more space and give me many
   options."*

   The inline row was right for "here are the near neighbours" and wrong as the
   ONLY way out. Three options on a card is a peek; choosing what to wear wants
   room. This is that screen: everything the closet can build for this day, the
   in-bag ones first because they're free, then the rest with their price.

   ⚠️ It shows MANY (PACK_OPTS_PAGE), not a curated few. The whole complaint was
   being handed a shortlist someone else drew up. */
const PACK_OPTS_PAGE = 40;
let _packOptsOcc = null;          // which occasion the options screen is showing

let _packOptsFrom = null;      // which screen opened the options page
function openPackOptionsPage(occId) {
  const st = packStateReady();
  if (!st) return;
  _packOptsOcc = occId;
  _packOptsFrom = (capsuleView === "trip") ? "trip" : "pack";
  navDeeper("capsules");
  capsuleView = "packopts";
  renderCapsules();
  scrollToTop();
}

function renderPackOptionsPage() {
  const st = packStateReady();
  const occ = st && st.demand.find(o => o.id === _packOptsOcc);
  if (!st || !st.res || !occ) { capsuleView = "pack"; return renderCapsulePack(); }
  const cd = st.res.assign.get(occ.id);
  const bag = new Set(st.pack);
  const wxFor = packWxFor(st.c);
  const label = occ.context || occLabel(occ.level) || "this day";

  /* ⚠️ DEDUPED ON packLookKey, and the count is what's SHOWN. Raw enumeration
     returned 52 "options" for one day, of which many differed only by shoes —
     the same fake variety r13 removed from the solver, padding a list she asked
     to be long. Worse, two tiles both rendered as "What you have now", because
     packDistinct correctly reads them as the same look.
     Deduping fixes both, and the header then reports the number of rows she can
     actually see: a count that disagrees with the list beneath it is the
     "20 options beside a See 20 button" bug all over again. */
  const seenLook = new Set();
  const inBag = packCandidates(occ, st.pack, { wxFor, all: true })
    .filter(x => x.ids.every(id => bag.has(id)))
    .filter(x => { const k = packLookKey(x.ids); if (seenLook.has(k)) return false; seenLook.add(k); return true; })
    .slice(0, PACK_OPTS_PAGE);
  const beyond = packReviewBeyond(st, occ, PACK_OPTS_PAGE)
    .filter(x => { const k = packLookKey(x.ids); if (seenLook.has(k)) return false; seenLook.add(k); return true; });
  const rule = prefsLabel(occ.prefs);

  /* ⚠️ THIS PAGE STILL SHOWS EVERYTHING — she asked for many options and the
     inline card is where the app narrows. But an option another day is already
     wearing SAYS SO, because picking it is the one choice here with a
     consequence she can't see from the tile: two days in the same clothes.
     A fact, never a block — same rule as "packed 3×, worn 0×". */
  const elsewhere = new Map();
  for (const o of st.demand) {
    if (o.id === occ.id) continue;
    const other = st.res.assign.get(o.id);
    if (other) elsewhere.set(packLookKey(other.ids), o);
  }
  // The same laundry answer as the inline card — one derivation, both surfaces.
  const probe = packLaundryProbe(st);
  const tile = (x, extra) => {
    const on = cd && !packDistinct(x, cd);
    const dup = !on && elsewhere.get(packLookKey(x.ids));
    const dupNote = dup ? `${dup.date ? planDayLabel(dup.date) : (dup.context || "Another day")} is wearing this` : "";
    const l = probe(occ.id, x.ids);
    const lNote = l.over.length ? "🧺 " + packLaundryNote(l.over, occ.date) : "";
    const note = [lNote, dupNote, extra].filter(Boolean).join(" · ");
    return `<button class="pack-opt-tile${on ? " on" : ""}" data-pack-choose="${esc(occ.id)}" data-pack-ids="${esc(x.ids.join(","))}">
      <div class="pack-opt-thumbs">${x.ids.map(id => thumbHtml((itemById.get(id) || {}).image_path, "pack-opt-th")).join("")}</div>
      <div class="pack-opt-meta">
        <div class="pack-opt-names">${esc(x.ids.map(id => (itemById.get(id) || {}).name || "piece").join(" · "))}</div>
        ${on ? `<div class="pack-opt-cost" style="color:var(--accent)">What you have now</div>`
             : note ? `<div class="pack-opt-cost">${esc(note)}</div>` : ""}
      </div>
    </button>`;
  };

  const right = `<button class="clsearch" data-pack-optbuild style="width:auto;font-size:14px;font-weight:700;color:var(--accent);padding:0 6px">✎ Build</button>`;
  return capToolbar(`What to wear · ${label}`, true, right) + `
    <div style="padding:8px 14px 0">
      <div class="pack-warn-note">${inBag.length} from your bag${beyond.length ? ` · ${beyond.length} more from your closet` : ""}${rule ? ` · rule: ${esc(rule)}` : ""}</div>
      <div class="pack-chiprow" style="margin-top:8px">
        <button class="cap-chip" data-pack-rather="${esc(occ.id)}">I'd rather…</button>
        ${rule ? `<button class="cap-chip on" data-pack-ruleclear="${esc(occ.id)}">${esc(rule)} ✕</button>` : ""}
      </div>
    </div>
    ${inBag.length ? `<div class="stats-sec-hdr" style="padding:14px 16px 6px"><div class="t">Already in your bag</div><div class="s">No extra weight</div></div>
      <div class="pack-opt-list">${inBag.map(x => tile(x, "")).join("")}</div>` : ""}
    ${beyond.length ? `<div class="stats-sec-hdr" style="padding:14px 16px 6px"><div class="t">From the rest of your closet</div><div class="s">Adds to what you carry</div></div>
      <div class="pack-opt-list">${beyond.map(x => tile(x, `+${x.adds} to your bag`)).join("")}</div>` : ""}
    ${!inBag.length && !beyond.length ? `<div class="placeholder"><b>Nothing fits this day</b><div>${rule
      ? "Your rule rules everything out — clear it above, or add a piece."
      : "Nothing you own reaches this day's level in this weather."}</div></div>` : ""}
    <div style="height:30px"></div>`;
}

function packOccCardHtml(st, occ, { showDate = false, canDrop = false } = {}) {
  const rec = packRecord(st.cid);
  const lockedSet = new Set(rec.locked || []);
  const { res } = st;
  const cd = res.assign.get(occ.id);
  const opts = res.options.get(occ.id) || 0;
  const unmet = res.unmet.some(u => u.occId === occ.id);
  const labels = [occ.context, ...(occ.alsoFor || []).map(o => o.context)].filter(Boolean);
  const label = labels.length ? labels.join(" + ") : (OCCASION_LADDER[(occ.level || 1) - 1] || "Something");
  const topLvl = Math.max(occ.level || 1, ...(occ.alsoFor || []).map(o => o.level || 1));
  const lvl = OCCASION_LADDER[topLvl - 1] || "";
  const when = showDate && occ.date ? `<small class="pack-occ-when">${esc(planDayLabel(occ.date))}</small>` : "";
  // "Not this trip" — only on occasions she never ticked (a calendar event, or
  // a day the app filled in). Her own selections are removed by unticking them.
  // ⚠️ data-pack-dropOCC — `data-pack-drop` already means "drop a PIECE".
  const drop = canDrop && (occ.source === "declared" || occ.source === "floor")
    ? `<button class="plan-act" data-pack-dropocc="${esc(occ.id)}">✕ Not this trip</button>` : "";
  if (unmet || !cd) {
    return `<div class="pack-occ gap">
      <div class="pack-occ-hd"><b>${esc(label)}</b><span>${esc(lvl)}</span></div>
      ${when}
      <div class="pack-occ-gap">Nothing available covers this.</div>
      <div class="pack-occ-acts">
        <button class="plan-act" data-pack-suggest="${esc(occ.id)}">✨ Suggest one</button>
        ${drop}
      </div>
    </div>`;
  }
  const pieces = cd.pieces.length ? cd.pieces : cd.ids.map(id => itemById.get(id)).filter(Boolean);
  return `<div class="pack-occ${lockedSet.has(occ.id) ? " locked" : ""}">
    <div class="pack-occ-hd">
      <b>${esc(label)}</b>
      <span>${esc(lvl)}${packOptLabel(opts)}${lockedSet.has(occ.id) ? " · 🔒" : ""}</span>
    </div>
    ${when}
    <div class="pack-pieces">
      ${pieces.map(i => `<button class="pack-piece" data-pack-swap="${esc(i.id)}" data-pack-occ="${esc(occ.id)}">
        ${thumbHtml(i.image_path, "pack-pthumb")}
        <div class="pack-pname">${esc(i.name || "Untitled")}</div>
      </button>`).join("")}
    </div>
    ${/* ⚠️ THE LAUNDRY FLAG SITS ON THE CARD, NOT ONLY IN THE WARNINGS BLOCK
          (2026-08-10 r2, her report: "I've selected the same t shirt 4 times
          and that's a problem"). The violation was already derived and already
          shown — on the ITEMS screen, three taps from where she was choosing.
          A consequence reported somewhere she isn't standing is one she finds
          out about while packing. It names the day's own piece and stops; the
          Laundry row on Plan is where she says what she'll do about it. */""}
    ${(() => {
      const mine = new Set(cd.ids);
      const over = (res.violations || []).filter(v => v.date === occ.date && mine.has(v.itemId));
      if (!over.length) return "";
      return `<div class="pack-occ-laun">🧺 ${over.slice(0, 2).map(v =>
        `${esc(v.name)} — ${esc(ordinal(v.nth))} wear since its last wash (goes ${v.tol})`).join("; ")}</div>`;
    })()}
    ${(() => {
      /* THE REVIEW, INLINE. Not a separate screen — the Outfits tab already
         shows one card per occasion, so asking here means review isn't a mode
         she has to enter and leave, and it costs no new surface. Undecided
         cards offer the alternatives; a decided one just says so. */
      if (packChosenSet(st.cid).has(occ.id)) return "";
      const alts = packReviewOptions(st, occ).filter(x => packDistinct(x, cd));
      /* ⚠️ THE QUESTION IS ALWAYS ASKED (2026-08-10 r4, her report: *"'what
         would you actually wear' only shows up sometimes rather than always if
         an outfit is unlocked"*). It used to `return ""` on an empty deal, and
         the deal legitimately comes back empty: r1 hands each look to ONE card,
         so a card can be left with nothing the others aren't already showing.
         Two things were wrong with going silent. `packReviewQueue` still counts
         that occasion, so the bar promised "5 decisions for you" over cards with
         nothing to decide on them — and unlocking, which r2 built precisely to
         re-open the question, appeared to do nothing. Her decision ③ was that
         EVERY occasion is offered with a prominent skip, not the ambiguous few.
         With no alternatives the honest card still confirms the outfit and keeps
         both escapes ("I'd rather…" and See other outfits), and says why it has
         nothing to put beside it rather than hiding. */
      const altLabels = packOptionLabels([cd, ...alts]).slice(1);
      const opt = (ids, label, cls, note) => `<button class="pack-review-opt${cls}" data-pack-choose="${esc(occ.id)}" data-pack-ids="${esc(ids.join(","))}">
            <div class="pack-review-thumbs">${ids.map(id => thumbHtml((itemById.get(id) || {}).image_path, "tdl-minith")).join("")}</div>
            <div class="pack-review-lbl">${esc(label)}</div>
            ${note ? `<div class="pack-review-cost">${esc(note)}</div>` : ""}
          </button>`;
      return `<div class="pack-review">
        <div class="pack-review-q">Which would you actually wear?</div>
        <div class="pack-review-opts">
          ${opt(cd.ids, "This one", " on", "")}
          ${/* ⚠️ An option the bag doesn't hold yet SAYS SO. The deal reaches
                past the bag when it can't give this card anything the others
                aren't already being offered, and an unpriced option would be
                the app quietly growing the suitcase on her behalf. */""}
          ${alts.map((x, _ai) => opt(x.ids, altLabels[_ai], "",
                                     [x.laundry ? "🧺 " + x.laundry : "",
                                      x.adds ? `+${x.adds} to your bag` : ""].filter(Boolean).join(" · "))).join("")}
        </div>
        ${alts.length ? "" : `<div class="pack-review-none">Nothing else in the bag makes a different outfit for this one — other days have claimed what it could reuse.</div>`}
        <div class="pack-review-more">
          <button class="lnk" data-pack-rather="${esc(occ.id)}">I'd rather\u2026</button>
        </div>
      </div>`;
    })()}
    ${/* ⚠️ THREE BUTTONS THAT DIDN'T SAY WHAT THEY DID (2026-08-09, her report:
          *"'Another', 'Suggester', 'other options' are not clear what they
          do"*). She was right and they also overlapped: ✨ Another re-rolled
          this occasion, Other options listed alternatives from the bag, and
          Suggester… opened the generic sheet scoped to it — three doors onto
          "show me a different outfit", none of them named that.
          One door now, named for the question, plus building it herself. */""}
    <div class="pack-occ-acts">
      <button class="plan-act" data-pack-optspage="${esc(occ.id)}">See other outfits</button>
      <button class="plan-act" data-pack-buildocc="${esc(occ.id)}">✎ Change it</button>
      ${occ.source === "selected"
        ? `<button class="plan-act" data-pack-moveday="${esc(occ.id)}">${occ.date ? "\u{1F4C5} " + esc(planDayLabel(occ.date)) : "\u{1F4C5} Pick a day"}</button>`
        : ""}
      <button class="plan-act" data-pack-lock="${esc(occ.id)}">${lockedSet.has(occ.id) ? "Unlock" : "🔒 Lock"}</button>
      ${drop}
    </div>
  </div>`;
}

// The by-day view, now folded away under the buckets — it exists for the
// laundry schedule, which is the one thing that genuinely needs dates.
let _packDaysOpen = false;
function packDaysFoldHtml(st) {
  /* ⚠️ `width: calc(100% - 28px)` — .frow is width:100%, and 100% PLUS 14px
     side margins overflows its column, so this row scrolled the whole screen
     sideways by 14px on every pack. Same trap as the 181px .log-cta, from the
     other direction: a full-width control with margins needs the calc, not the
     percentage. It was doing this on the old pack screen too. */
  return `<button class="frow" data-pack-daysfold style="margin:14px 14px 0;width:calc(100% - 28px);border-radius:14px">
      <span style="flex:1;text-align:left">📅 Day by day · ${st.slate.length} days</span>
      <svg class="chev" viewBox="0 0 24 24" style="${_packDaysOpen ? "transform:rotate(90deg)" : ""}"><path d="M9 6l6 6-6 6"/></svg>
    </button>
    ${_packDaysOpen ? packDaysHtml(st) : ""}`;
}

function packDaysHtml(st) {
  const { c, slate, demand, res } = st;
  return slate.map(s => {
    const all = demand.filter(o => o.date === s.date);
    /* ⚠️ Two occasions on one day that end up in the SAME clothes are one
       outfit, not two — dayplan already says so ("one outfit across contexts =
       one multi-context entry"). Rendering them as separate identical cards
       reads as a bug even though the underlying demand is right, so merge for
       display only. The laundry and options math still sees both. */
    const seen = new Map();
    const occs = [];
    for (const o of all) {
      const cd = res.assign.get(o.id);
      const key = cd ? cd.ids.join(",") : "gap:" + o.id;
      if (seen.has(key)) { seen.get(key).alsoFor.push(o); continue; }
      const merged = { ...o, alsoFor: [] };
      seen.set(key, merged);
      occs.push(merged);
    }
    const isLaun = planLaundryDay(c, s.date);
    const cards = occs.map(occ => packOccCardHtml(st, occ)).join("");
    return `<div class="plan-day">
      <div class="plan-day-hd">
        <div class="plan-day-date">${esc(planDayLabel(s.date))}<small>${esc(s.date)}${s.leg && s.leg.loc ? " · " + esc(s.leg.loc.name) : ""}</small></div>
        ${planDayWxHtml(s.date)}
      </div>
      ${isLaun ? `<div class="plan-launday">🧺 Laundry day — rewear counts reset</div>` : ""}
      ${cards}
    </div>`;
  }).join("");
}

/* ===================================================================
   THE PACK *IS* THE PLAN  (2026-08-04 r5)

   Her ask: *"I want build a pack to be more integrated — I don't want to have to
   say send to the trip, I want it to just build and all those editing options to
   always be available."*

   It used to end at a wall: the solve lived in kv "pack:<cid>" and the by-day
   planner, the trip dash and "Wore it" all read `capsules.plan`, which only an
   explicit "Send outfits to the by-day plan" ever wrote. So a built pack was
   invisible everywhere she actually lives during a trip until she found and
   pressed one button — and it then dumped ~13 auto-created looks into her Looks
   list, which is exactly why that button was gated behind a confirm.

   ⚠️ THE REASON FOR THE OLD GATE IS STILL RIGHT; only the gate is wrong. Nothing
   here writes `capsules.plan` or creates an outfit record on a solve. The day
   cards render the pack's assignment DIRECTLY, and a look is materialised at the
   one moment it has earned existing: when she says she wore it. That's the same
   create-or-merge `wearSuggestedCombo` already uses, and it means one record per
   outfit she actually wore rather than thirteen per solve.

   ⚠️ Materialised days are matched by ITEM SET, not by a stored flag — a plan
   look whose pieces are this occasion's pieces IS this occasion, however it got
   there (including packs sent over by the old button). Derived, so it can't go
   stale, and removing the look from the plan brings the pack's card back. */
function packPlanByDate(c) {
  if (!c || !isDatedTrip(c) || !packHasPlan(c.id)) return null;
  const stored = packAssignFromRecord(c.id);
  if (!stored.size) return null;
  const { demand } = packDemandFor(c.id, c);
  const lockedSet = new Set(packRecord(c.id).locked || []);
  const out = new Map();
  for (const occ of demand) {
    if (!occ.date) continue;
    const cd = stored.get(occ.id);
    if (!cd || !cd.ids.length) continue;
    const key = cd.ids.join(",");
    // Already a real look on this day → the plan owns it, not the pack.
    if (planActiveLooks(c, occ.date).some(oid => {
      const o = outfitById.get(oid);
      return o && outfitItems(o).map(i => i.id).sort().join(",") === key;
    })) continue;
    let arr = out.get(occ.date);
    if (!arr) out.set(occ.date, arr = []);
    // Same rule as packDaysHtml: two contexts in the same clothes are ONE card.
    const same = arr.find(e => e.cd.ids.join(",") === key);
    if (same) { same.alsoFor.push(occ); continue; }
    arr.push({ occ, cd, alsoFor: [], locked: lockedSet.has(occ.id) });
  }
  return out.size ? out : null;
}

/* Whose choice the day layout is, and the one tap that makes it entirely hers.
   ⚠️ It pins where things ALREADY ARE — it never moves anything. "Keep these
   days" has to be a no-op on screen and a change in who owns it, or the control
   that promises to stop the app rearranging her trip would rearrange it once on
   the way out. */
function packDaySpreadRowHtml(c) {
  if (!c || !tripDates(c).length || !packRecord(c.id).built) return "";
  const { demand } = packDemandFor(c.id, c);
  const movable = demand.filter(o => o.source === "selected" && o.date);
  if (!movable.length) return "";
  const pins = packOccDates(c.id);
  const loose = movable.filter(o => !pins[o.id]);
  return `<div class="pack-warn-note" style="padding:10px 16px 0">${loose.length
    ? `The app spread ${loose.length} of these across your free days. Tap 📅 on any one to move it — or keep them where they are.`
    : `Every day here is one you chose. The app won't move them.`}</div>
    ${loose.length ? `<button class="btn btn-sec" data-pack-keepdays style="margin:8px 16px 0;width:calc(100% - 32px)">📅 Keep these days</button>` : ""}`;
}
async function packKeepDays() {
  const cid = capsuleId;
  const c = capsuleById.get(cid);
  if (!c) return;
  const { demand } = packDemandFor(cid, c);
  const all = { ...packOccDates(cid) };
  let n = 0;
  for (const o of demand) if (o.source === "selected" && o.date && !all[o.id]) { all[o.id] = o.date; n++; }
  if (!n) return;
  await savePackRecord(cid, { occDates: all });
  if (_packState && _packState.cid === cid) packLoadState(cid);
  renderCapsules();
  toast(`${n} day${n === 1 ? "" : "s"} pinned — the app won't move them`);
}

/* One day's pack outfits, rendered for the by-day planner. Carries the SAME
   data-pack-* hooks as the pack screen's own cards, so every editing option is
   available here without a second set of handlers to drift. */
function packPlanCardsHtml(entries, date) {
  return (entries || []).map(e => {
    const { occ, cd } = e;
    const labels = [occ.context, ...e.alsoFor.map(o => o.context)].filter(Boolean);
    const label = labels.length ? labels.join(" + ") : (OCCASION_LADDER[(occ.level || 1) - 1] || "Something");
    const topLvl = Math.max(occ.level || 1, ...e.alsoFor.map(o => o.level || 1));
    const lvl = OCCASION_LADDER[topLvl - 1] || "";
    /* ⚠️ An occasion with no context is already NAMED by its level, so printing
       the level again beside it reads as "Casual · Casual". Found by rendering
       the plan and reading it, not by a test — same as the three defects this
       feature shipped with. */
    /* ⚠️ WHOSE DAY THIS IS, SAID OUT LOUD (2026-08-10 r3, her report: *"the by
       day plan should not auto assign days — I should be able to do it
       myself"*). The app spreads her occasions across the free days, and the
       control that moves one existed but only on the Outfits section — so the
       screen that IS about days was the one screen where the day couldn't be
       changed, and the spread read as a decision rather than a starting point.
       ⚠️ Only a `selected` occasion can move: its id is date-free by design
       (D6), so it keeps its outfit when it lands somewhere else. A declared
       occasion IS its date (that's the calendar event) and a floor occasion is
       keyed by its date, so moving either would orphan it. */
    const movable = occ.source === "selected";
    const pinnedDay = packOccDates(capsuleId)[occ.id];
    const sub = [labels.length && lvl ? lvl : "", movable ? (pinnedDay ? "your day" : "app's pick") : "",
                 "from your pack", e.locked ? "🔒" : ""].filter(Boolean).join(" · ");
    const pieces = cd.pieces.length ? cd.pieces : cd.ids.map(id => itemById.get(id)).filter(Boolean);
    return `<div class="pack-occ${e.locked ? " locked" : ""}">
      <div class="pack-occ-hd">
        <b>${esc(label)}</b>
        <span>${esc(sub)}</span>
      </div>
      <div class="pack-pieces">
        ${pieces.map(i => `<button class="pack-piece" data-pack-swap="${esc(i.id)}" data-pack-occ="${esc(occ.id)}">
          ${thumbHtml(i.image_path, "pack-pthumb")}
          <div class="pack-pname">${esc(i.name || "Untitled")}</div>
        </button>`).join("")}
      </div>
      <div class="pack-occ-acts">
        <button class="plan-act" data-pack-wore="${esc(occ.id)}" data-pack-date="${esc(date)}">Wore it</button>
        <button class="plan-act" data-pack-optspage="${esc(occ.id)}">See other outfits</button>
        <button class="plan-act" data-pack-buildocc="${esc(occ.id)}">✎ Change it</button>
        ${movable ? `<button class="plan-act" data-pack-moveday="${esc(occ.id)}">📅 Move day</button>` : ""}
        <button class="plan-act" data-pack-lock="${esc(occ.id)}">${e.locked ? "Unlock" : "🔒 Lock"}</button>
      </div>
    </div>`;
  }).join("");
}

/* "Wore it" on a pack outfit. THIS is where a look record is created — one, for
   an outfit she actually wore, instead of thirteen on a solve. It also joins the
   by-day plan, so the card stops being the pack's and starts being the trip's
   (packPlanByDate then skips it on the item-set match). */
async function packWoreOccasion(occId, date, cid = capsuleId) {
  if (_packBusy) return;
  const st = packStateReady(cid);
  if (!st) return;
  const cd = st.res.assign.get(occId);
  if (!cd) return;
  const pieces = cd.ids.map(id => itemById.get(id)).filter(Boolean);
  if (pieces.length < 2) { toast("This outfit needs at least two pieces"); return; }
  _packBusy = true;
  try {
    const oid = await saveComboAsOutfit(pieces);
    if (!oid) return;
    await addPlanLook(st.cid, date, oid);
    await planWoreIt(date, oid);
  } catch (e) { toast(e.message); }
  finally { _packBusy = false; }
  if (activeTabName() === "capsules") renderCapsules();
}

/* The "why is this here" line. This is where the old max(laundry, coverage)
   formula lives — as an explanation, which is all it was ever good enough for. */
function packWhyLine(i, use, c, optLabels) {
  const tol = wearTolerance(i);
  const days = use && use.days ? use.days.size : 0;
  const labels = use && use.labels ? [...use.labels] : [];
  const bits = [];
  if (labels.length === 1) bits.push(`for ${labels[0]}`);
  else if (labels.length > 1) bits.push(`covers ${labels.length} kinds of day`);
  else if (optLabels && optLabels.size) {
    // Not in a planned outfit, but it makes an alternative possible — say what
    // for. "another option" on its own is true and unusable.
    const named = [...optLabels].slice(0, 2).join(" / ");
    bits.push(`spare option for ${named}`);
  } else bits.push("not in any outfit yet — drop it?");
  // Only speak about laundry when it actually binds — "1 of 1 wears" on every
  // tee is noise that trains her to stop reading the line.
  if (tol !== Infinity && days > tol) bits.push(`${days} wear-days · needs a wash mid-trip (every ${tol})`);
  else if (tol !== Infinity && days > 1) bits.push(`${days} of ${tol} wears`);
  return bits.join(" · ");
}

/* ===================================================================
   REVISION — every edit is LOCAL. Nothing here calls packSolve except
   packResolveUnlocked, which she has to ask for by name.

   Locks are the load-bearing primitive: whatever she touches is locked, so
   revising compounds instead of fighting her. That is what makes "✨ Re-solve"
   safe to put on the screen rather than hide.
   =================================================================== */
function packMarkLocked(cid, occId) {
  const rec = packRecord(cid);
  const set = new Set(rec.locked || []);
  set.add(occId);
  return [...set];
}
// Recompute consequences after a local edit. LINEAR — no solver, no spinner.
function packConsequences(st) {
  const { c, demand, res } = st;
  const pack = new Set(res.pack);
  const used = new Set();
  for (const cd of res.assign.values()) for (const id of cd.ids) used.add(id);
  const broken = demand.filter(o => {
    const cd = res.assign.get(o.id);
    return !cd || !cd.ids.every(id => pack.has(id));
  }).map(o => ({ occId: o.id, date: o.date, level: o.level }));
  const sched = packSchedule(assignOf(demand, res.assign), { dates: tripDates(c), washDays: packWashDays(c) });
  return { broken, violations: sched.violations, orphans: [...pack].filter(id => !used.has(id)) };
}
// Re-derive options + violations in place after an edit, without re-solving.
function packRefresh(st) {
  const { c, demand, res } = st;
  const pack = new Set(res.pack);
  const wxFor = packWxFor(c);
  // ⚠️ packDemandKey, not the level alone — this was a THIRD grouping, and on a
  // Madrid-then-Javea trip it showed one leg's option count on the other's days.
  // It is also the grouping the rehydrate path uses, i.e. the one she sees most.
  const byKey = new Map();
  for (const occ of demand) {
    const k = packDemandKey(occ);
    if (!byKey.has(k)) byKey.set(k, packOptionCount(occ, pack, { wxFor }));
    res.options.set(occ.id, byKey.get(k));
  }
  const cons = packConsequences(st);
  res.violations = cons.violations;
  res.stats.pieces = pack.size;
  res.stats.outfits = packOutfitCount(pack, demand, { wxFor });
  return cons;
}
/* ⚠️ IT MUST WRITE `st.pack` TOO, not only `st.res.pack`. packRegroup derives
   the items screen from `st.pack` and packPersist stores `st.pack` — so the r5
   fix this function IS ("the pack is the union of the outfits' pieces") only
   ever reached the outfits half. A level-1 piece the solver legitimately pulled
   from the whole closet still never appeared on the items screen, and stage B's
   spare options were dropped again at the next save. */
/* ⚠️ IT UNIONS, IT DOES NOT REPLACE — and replacing is what made the tightness
   dial do nothing (2026-08-08, audit). This function existed to ADD what the
   solver reached for (a level-1 piece drawn from the whole closet); it was
   written as a rebuild-from-scratch, so it also SUBTRACTED everything packFill
   had chosen and no outfit happened to use.

   That is the entire dial. `packCounts` scales correctly with K and `packFill`
   builds exactly what it asks for — measured on a 158-piece closet, 7-day trip:
   11 / 15 / 19 pieces at lean / normal / cushion. Then this ran and cut all
   three to 8 / 8 / 9, because eight occasions need about eight outfits' worth of
   pieces whatever the dial says. Lean and normal came out byte-identical, which
   is the "switching between lean/normal/cushion changes nothing" report, and the
   r11 fix to `packCounts` could never have been visible through it.

   ⚠️ Inversion ① still holds: the pack is a SUPERSET of the outfits' pieces, so
   every outfit is still fully packed and the items screen can't disagree with
   the outfits screen. What it is no longer is the MINIMUM such set — the spare
   capacity K buys is exactly the difference, and `packItemWhy` already explains
   a piece that serves no occasion yet. Counts remain an OUTPUT of packFill;
   nothing here targets a number.
   ⚠️ Requires `st.pack` to be the live bag: packDropPiece/packAddPiece keep it
   in step, or a dropped piece would come straight back through this union. */
function packRepack(st) {
  const pack = new Set(packRecord(st.cid).pinned || []);
  for (const id of (st.pack || [])) pack.add(id);
  for (const cd of st.res.assign.values()) for (const id of cd.ids) pack.add(id);
  for (const id of (st.res.extras || [])) pack.add(id);
  st.res.pack = [...pack];
  st.pack = [...pack];
}

/* Alternates for ONE hole. Not "browse your closet": pieces that fit this slot,
   this level, this weather, not excluded against the rest of the outfit — the
   same filter swapSuggestionPiece applies in the sheet, pooled on rack ∪ pack. */
function packSwapCandidates(st, occ, cd, pieceId) {
  const old = itemById.get(pieceId);
  if (!old) return [];
  const others = cd.pieces.length ? cd.pieces.filter(p => p.id !== pieceId)
                                  : cd.ids.filter(id => id !== pieceId).map(id => itemById.get(id)).filter(Boolean);
  const layerPc = comboLayerPiece({ pieces: cd.pieces.length ? cd.pieces : cd.ids.map(id => itemById.get(id)).filter(Boolean) });
  const asLayer = !!layerPc && layerPc.id === pieceId;
  const slot = asLayer ? "Outerwear" : suggestSlot(old);
  const wx = packWxFor(st.c) ? packWxFor(st.c)(occ.date) : null;
  const season = seasonOf(occ.date || st.c.start_date);
  const pool = new Set([...(st.rack.ids || []), ...st.res.pack]);
  return [...pool].map(id => itemById.get(id)).filter(i =>
    i && i.id !== pieceId && itemStatus(i) === "Available" && !isNoSuggest(i) &&
    (suggestSlot(i) === slot || (slot === "Outerwear" && isLayer(i) && i.category === "Tops")) &&
    (occ.level === 1 ? isFunctionWear(i) : (itemFormalitySet(i) || []).includes(occ.level)) &&
    inSeasonWx(i, season, wx) &&
    !others.some(o => isExcluded(i.id, o.id)))
    .sort((a, b) => rackWarmth(b.id) - rackWarmth(a.id) || (a.id < b.id ? -1 : 1))
    .slice(0, 18);
}

function openPackSwapSheet(occId, pieceId) {
  const st = packStateReady();
  if (!st || !st.res) return;
  const occ = st.demand.find(o => o.id === occId);
  const cd = st.res.assign.get(occId);
  if (!occ || !cd) return;
  const cands = packSwapCandidates(st, occ, cd, pieceId);
  const old = itemById.get(pieceId);
  const grid = cands.length
    ? `<div class="ogrid">${cands.map(i => `<button class="otile" data-packswap-to="${esc(i.id)}">
        ${thumbHtml(i.image_path, "pack-pthumb")}<div class="oname">${esc(i.name || "Untitled")}</div></button>`).join("")}</div>`
    : `<div style="padding:24px 16px;text-align:center;color:var(--muted)">Nothing else in the pool fits this slot at ${esc(OCCASION_LADDER[(occ.level || 1) - 1] || "")}.</div>`;
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="packSwapCancel">Cancel</button>
      <h2>Swap ${esc(old ? (old.name || "piece") : "piece")}</h2>
      <span style="width:54px"></span>
    </div>
    <div style="padding:6px 16px 0;font-size:13px;color:var(--muted)">Fits this slot, this level and the forecast. Picking one locks this day.</div>
    <div style="padding:6px 0 30px">${grid}</div>`;
  showSheet("logSheet");
  hydratePhotos($("#logInner"));
  $("#packSwapCancel").onclick = () => hideSheet("logSheet");
  $("#logInner").querySelectorAll("[data-packswap-to]").forEach(b => {
    b.onclick = () => packApplySwap(occId, pieceId, b.dataset.packswapTo);
  });
}

async function packApplySwap(occId, fromId, toId) {
  const st = packStateReady();
  if (!st || !st.res) return;
  const cd = st.res.assign.get(occId);
  if (!cd) return;
  const ids = cd.ids.filter(id => id !== fromId).concat([toId]).sort();
  const pieces = ids.map(id => itemById.get(id)).filter(Boolean);
  st.res.assign.set(occId, { ids, pieces, score: cd.score });
  packRepack(st);
  const cons = packRefresh(st);
  await savePackRecord(st.cid, { locked: packMarkLocked(st.cid, occId) });
  await packPersist(st.cid);
  hideSheet("logSheet");
  renderCapsules();
  /* ⚠️ Offer, never automatic. A piece no longer in any outfit may still be a
     spare she wants — dropping it for her is the app arguing with the suitcase. */
  const stillUsed = [...st.res.assign.values()].some(x => x.ids.includes(fromId));
  const old = itemById.get(fromId);
  if (!stillUsed && old) {
    toast(`Swapped · ${old.name || "piece"} isn't in any outfit now`,
      { label: "Drop it", fn: () => packDropPiece(fromId) });
  } else {
    toast(cons.violations.length ? "Swapped · check the laundry note" : "Swapped");
  }
}

// "✨ Another" — a different outfit for THIS occasion only.
async function packReroll(occId) {
  const st = packStateReady();
  if (!st || !st.res || _packBusy) return;
  const occ = st.demand.find(o => o.id === occId);
  if (!occ) return;
  const cur = st.res.assign.get(occId);
  const inPack = new Set(st.res.pack);
  const wxFor = packWxFor(st.c);
  // Prefer another outfit the pack can already make — a re-roll shouldn't grow
  // the bag unless it has to.
  const inside = packCandidates(occ, st.res.pack, { wxFor, all: true })
    .filter(x => x.ids.every(id => inPack.has(id)) && (!cur || packDistinct(x, cur)));
  const pick = inside.length ? inside[0]
    : packCandidates(occ, st.rack.ids, { wxFor, all: true }).find(x => !cur || packDistinct(x, cur));
  if (!pick) { toast("No other outfit fits this one"); return; }
  st.res.assign.set(occId, pick);
  packRepack(st);
  packRefresh(st);
  await savePackRecord(st.cid, { locked: packMarkLocked(st.cid, occId) });
  await packPersist(st.cid);
  renderCapsules();
  toast(inside.length ? "Another one from the same bag" : "Another one — added a piece");
}

// "See N" — the other outfits this pack can make for one occasion.
function openPackOptionsSheet(occId) {
  const st = packStateReady();
  if (!st || !st.res) return;
  const occ = st.demand.find(o => o.id === occId);
  if (!occ) return;
  const inPack = new Set(st.res.pack);
  const cur = st.res.assign.get(occId);
  /* ⚠️ One row per LOOK. Before this the sheet's twelve "other options" could be
     the same top and jeans twelve times over with different shoes, which is
     what "20 options" was really counting. */
  const seenLook = new Set();
  const list = packCandidates(occ, st.res.pack, { wxFor: packWxFor(st.c), all: true })
    .filter(x => x.ids.every(id => inPack.has(id)))
    .filter(x => { const k = packLookKey(x.ids); if (seenLook.has(k)) return false; seenLook.add(k); return true; })
    .slice(0, 12);
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="packOptCancel">Close</button>
      <h2>${esc(occ.context || OCCASION_LADDER[(occ.level || 1) - 1] || "Options")}</h2>
      <span style="width:54px"></span>
    </div>
    <div style="padding:6px 16px 0;font-size:13px;color:var(--muted)">Everything here is already in the bag — no extra weight.</div>
    <div style="padding:6px 0 30px">${list.map(x => {
      const on = cur && !packDistinct(x, cur);
      return `<button class="pack-optrow${on ? " on" : ""}" data-packopt="${esc(x.ids.join(","))}">
        <div class="pack-pieces">${x.ids.map(id => thumbHtml((itemById.get(id) || {}).image_path, "pack-pthumb")).join("")}</div>
        ${on ? `<div class="pack-bagwhy">Current pick</div>` : ""}
      </button>`;
    }).join("")}</div>`;
  showSheet("logSheet");
  hydratePhotos($("#logInner"));
  $("#packOptCancel").onclick = () => hideSheet("logSheet");
  $("#logInner").querySelectorAll("[data-packopt]").forEach(b => {
    b.onclick = async () => {
      const ids = b.dataset.packopt.split(",");
      st.res.assign.set(occId, { ids: ids.slice().sort(), pieces: ids.map(id => itemById.get(id)).filter(Boolean), score: 0 });
      packRepack(st); packRefresh(st);
      await savePackRecord(st.cid, { locked: packMarkLocked(st.cid, occId) });
      await packPersist(st.cid);
      hideSheet("logSheet"); renderCapsules(); toast("Set");
    };
  });
}

/* ---- the real suggester, per occasion (2026-08-05) -------------------------
   Her ask: "I should be able to open the outfit suggester for any of those and
   have it revise from the packing list or from outside of it."

   ⚠️ It reuses the suggester rather than growing a second one — same rule as the
   solver (see the header). The pool is scoped to the trip capsule, so it opens
   on the SUITCASE, and the sheet's existing pool chip is the one-tap widen to
   the whole closet. Nothing new to learn and nothing that can drift.

   ⚠️ It does NOT re-enter the solver (inversion ③). It sets one occasion's
   outfit, exactly like packApplySwap, and marks it locked so a later re-solve
   doesn't undo the choice she just made by hand. */
function packOpenSuggest(occId, { seedCombo = null } = {}) {
  const st = packStateReady();
  if (!st) return;
  const occ = st.demand.find(o => o.id === occId);
  if (!occ) return;
  /* ⚠️ NO planCtx. Passing one would make "Wear this today" run the plan branch
     and write `capsules.plan` — the exact bulk-look creation the pack was built
     to avoid (r5). The occasion's level and season are set directly instead, and
     the writeback happens on close via _sugg.packOcc. */
  openSuggestSheet(null, st.cid, null);
  _sugg.targetLevel = occ.level || null;
  _sugg.season = seasonOf(occ.date || todayStr());
  _sugg.packOcc = { cid: st.cid, occId, ctx: occ.context || null };
  // Her rules for this occasion follow her into the sheet, so "✨ Another" and
  // every swap here obey them too — the escape hatch she didn't have.
  _sugg.occPrefs = occ.prefs || null;   // already context-merged by packDemandFor
  // The level/season were set after the sheet's own first generate, so re-run it.
  _sugg.idx = 0;
  _sugg.results = _suggApplyPrefs(suggestOutfits(_sugg.targetLevel, null, _suggPool(), _sugg.season,
                                 _suggWx(), null, _suggCleanArg(), null, null));
  /* ⚠️ HER CURRENT OUTFIT GOES FIRST. Opening on a fresh roll throws away the
     thing she was looking at — she came here to change SOME of it, so the
     starting point has to be what's on the card. Locking a piece then works
     from the outfit she actually has, which is the whole point of "suggest
     AROUND it". */
  if (seedCombo && seedCombo.ids && seedCombo.ids.length) {
    const pieces = seedCombo.ids.map(id => itemById.get(id)).filter(Boolean);
    if (pieces.length) {
      _sugg.results = [{ pieces, score: 0 }].concat((_sugg.results || [])
        .filter(r => packLookKey(r.pieces.map(p => p.id)) !== packLookKey(seedCombo.ids)));
      _sugg.idx = 0;
    }
  }
  renderSuggestSheet();
}
/* She picked one. Three things happen, and keeping them separate is the point:
   the outfit becomes hers (locked against automatic re-solving), the occasion
   leaves the review queue, and the CONTRASTIVE evidence is filed for the
   context. ⚠️ The choice locks the outfit and nothing else — no scores move, no
   pool shifts. She was told the app isn't learning her taste behind her back,
   and the recorded evidence only ever surfaces later as a proposal she confirms. */
/* ⚠️ "Change it myself" — the builder, seeded with this occasion's outfit
   (2026-08-09, her report: *"if an outfit is almost good, I'd like the option to
   open and revise it in the builder myself"*). Almost-right was the one case the
   pack had no answer for: every control replaced the whole outfit.
   The look is created for real and then assigned, so the pack doesn't hold a
   private copy the Looks list knows nothing about. */
/* ⚠️ TWO WAYS TO REVISE, AND SHE PICKS (2026-08-09: *"I want it to first give
   me options between the suggester (prefilled) and the canvas (prefilled not
   blank)"*). They answer different questions — the suggester asks "what else
   works with some of this", the canvas asks "let me move it myself" — and BOTH
   start from the outfit on the card rather than from nothing.

   ⚠️ The first version saved a look so it could pass an outfitId. That was a
   bug (saveComboAsOutfit takes an ARRAY, it was handed an object, threw, and
   the catch left a blank canvas) and the wrong shape besides: every tap would
   leave a look record behind, which is the Looks-list flooding that got bulk
   creation removed. The look is created at SAVE, when it's real. */
/* ⚠️ SCHEDULING IS HERS, PLACEMENT IS THE APP'S PROPOSAL (2026-08-09, her
   report: "need to be able to schedule the contexts, not just have things
   auto-assigned to days"). Offered only on `selected` occasions: their ids are
   date-free by design, so moving one keeps the outfit she chose for it. A
   declared event or a floor day is keyed BY its date — "moving" those would
   orphan their outfit, so they aren't offered. */
function openPackMoveDaySheet(occId) {
  const st = packStateReady();
  if (!st) return;
  const occ = st.demand.find(o => o.id === occId);
  if (!occ) return;
  const dates = tripDates(st.c);
  const counts = new Map();
  for (const o of st.demand) if (o.date) counts.set(o.date, (counts.get(o.date) || 0) + 1);
  const pinned = packOccDates(st.cid)[occId];
  const rows = dates.map(d => {
    const n = counts.get(d) || 0;
    const on = occ.date === d;
    return `<button class="sheet-row" data-packmoveto="${esc(d)}">
      <span>${esc(planDayLabel(d))}<div class="muted" style="font-size:12px;font-weight:400">${
        n ? `${n} thing${n === 1 ? "" : "s"} that day` : "nothing yet"}</div></span>
      <span class="rt" style="color:${on ? "var(--accent)" : "var(--muted)"}">${on ? (pinned ? "✓ yours" : "✓ app's pick") : ""}</span>
    </button>`;
  }).join("");
  $("#moveInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="packMoveCancel">Cancel</button>
      <h2>${esc(occ.context || occLabel(occ.level) || "This one")} \u2014 which day?</h2>
      <span style="width:54px"></span>
    </div>
    <div class="sheet-note">The app spreads these out for you. Pick a day and it stays there.</div>
    ${rows}
    ${pinned ? `<button class="sheet-row" data-packmoveto=""><span>Let the app choose again</span></button>` : ""}`;
  showSheet("moveSheet");
  $("#packMoveCancel").onclick = () => hideSheet("moveSheet");
  $("#moveInner").querySelectorAll("[data-packmoveto]").forEach(b => {
    b.onclick = async () => {
      hideSheet("moveSheet");
      await packSetOccDate(st.cid, occId, b.dataset.packmoveto || null);
      /* The slate changes shape, so reload and re-solve the days that moved.
         Her locks and chosen outfits survive — packEnsureSolve carries them in
         as locks, which is what makes moving one day safe for the rest. */
      const st2 = packLoadState(st.cid);
      if (st2) packEnsureSolve(st2);
      await packPersist(st.cid);
      renderCapsules();
      toast(b.dataset.packmoveto ? `Moved to ${planDayLabel(b.dataset.packmoveto)}` : "Back to the app's spread");
    };
  });
}

function packBuildOccasion(occId) {
  const st = packStateReady();
  if (!st || !st.res) return;
  const occ = st.demand.find(o => o.id === occId);
  const cd = st.res.assign.get(occId);
  if (!occ) return;
  const ids = cd ? cd.ids.slice() : [];
  const names = ids.map(id => (itemById.get(id) || {}).name || "piece").join(" \u00b7 ");
  $("#moveInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="packReviseCancel">Cancel</button>
      <h2>Change it</h2>
      <span style="width:54px"></span>
    </div>
    ${ids.length ? `<div class="sheet-note">Starting from ${esc(names)}</div>` : ""}
    <button class="sheet-row" data-packrevise="suggest">
      <span>\u2728 Suggest around it<div class="muted" style="font-size:12px;font-weight:400">Lock the pieces you like, swap the rest</div></span>
    </button>
    <button class="sheet-row" data-packrevise="canvas">
      <span>\u270e Arrange it myself<div class="muted" style="font-size:12px;font-weight:400">The builder, with this outfit already on it</div></span>
    </button>`;
  showSheet("moveSheet");
  $("#packReviseCancel").onclick = () => hideSheet("moveSheet");
  $("#moveInner").querySelectorAll("[data-packrevise]").forEach(b => {
    b.onclick = () => {
      hideSheet("moveSheet");
      /* ⚠️ `capsuleId` IS WHAT SCOPES THE PICKER (2026-08-10 r4, her report:
         *"the build it / change it myself should filter to what's in the pack —
         with the option to add from outside the pack too"*). `builderPool` reads
         `builder.scopeCapsuleId`, which `openBuilder` takes from
         `planCtx.capsuleId` — and this call passed only `packOcc`, so revising a
         trip outfit opened the WHOLE closet. It happened to look scoped whenever
         she was already in trip mode, because `builderPool` also falls back to
         `tripModeId`; planning a trip that hadn't started got the whole closet.
         The widen is the bag/closet chip bar in renderBuilderPicker. */
      if (b.dataset.packrevise === "canvas") openBuilder(null, null, { packOcc: { cid: st.cid, occId }, capsuleId: st.cid }, ids);
      else packOpenSuggest(occId, { seedCombo: cd || null });
    };
  });
}
async function packClearOccRule(occId) {
  const st = packStateReady();
  if (!st) return;
  await packClearOccPref(st.cid, occId);
  renderCapsules();
  toast("Rule cleared");
}
/* "I'd rather…" on the card. ⚠️ Setting a rule RE-SOLVES this occasion rather
   than only re-filtering what's shown — that's the difference between a filter
   and a decision, and it's the whole reason she couldn't escape the dress: the
   old controls all re-picked inside a bag chosen under the old assumptions.
   The rule is stored per occasion and beats her standing context rule. */
function openPackRatherSheet(occId) {
  const st = packStateReady();
  if (!st) return;
  const occ = st.demand.find(o => o.id === occId);
  if (!occ) return;
  const cur = occ.prefs || {};
  const row = (key, val, label) => {
    const on = key === "levelShift" ? (+cur.levelShift === val) : (cur[key] === val);
    return `<button class="sheet-row" data-packrather="${esc(key)}" data-packrval="${esc(String(val))}">
      <span>${label}</span>
      <span class="rt" style="color:${on ? "var(--accent)" : "var(--muted)"}">${on ? "\u2713" : ""}</span>
    </button>`;
  };
  $("#moveInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="packRatherCancel">Cancel</button>
      <h2>I'd rather\u2026</h2>
      <span style="width:54px"></span>
    </div>
    <div class="sheet-note">For ${esc(occ.context || occLabel(occ.level) || "this day")} on this trip. Tap again to undo.</div>
    ${row("silhouette", SIL_SEPARATES, "\u{1F455} Not wear a dress")}
    ${row("silhouette", SIL_DRESS, "\u{1F457} Wear a dress")}
    ${row("levelShift", -1, "\u2193 Dress this down")}
    ${row("levelShift", 1, "\u2191 Dress this up")}`;
  showSheet("moveSheet");
  $("#packRatherCancel").onclick = () => hideSheet("moveSheet");
  $("#moveInner").querySelectorAll("[data-packrather]").forEach(b => {
    b.onclick = async () => {
      hideSheet("moveSheet");
      const key = b.dataset.packrather;
      const val = key === "levelShift" ? +b.dataset.packrval : b.dataset.packrval;
      const on = key === "levelShift" ? (+cur.levelShift === val) : (cur[key] === val);
      /* Clearing has to be able to overrule a STANDING context rule, not just
         delete the occasion key — see SIL_ANY. */
      let patch;
      if (!on) patch = { [key]: val };
      else if (key === "silhouette" && (contextPref(occ.context) || {}).silhouette === val)
        patch = { silhouette: SIL_ANY };
      else patch = { [key]: null };
      await packSetOccPref(st.cid, occId, patch);
      // Re-solve THIS occasion against the new rule, holding the trip still.
      const st2 = packStateReady(st.cid);
      if (st2 && st2.res) {
        const o2 = st2.demand.find(o => o.id === occId);
        const wxFor = packWxFor(st2.c);
        const inside = packCandidates(o2, st2.pack, { wxFor, all: true })
          .find(x => x.ids.every(id => new Set(st2.pack).has(id)));
        const pick = inside || packCandidates(o2, st2.rack.ids, { wxFor, all: true })[0];
        if (pick) {
          st2.res.assign.set(occId, pick);
          packRepack(st2); packRegroup(st2); packRefresh(st2);
          await packPersist(st2.cid);
        } else {
          /* ⚠️ Her rule left nothing buildable. That is an honest gap, not a
             reason to ignore her — the occasion is reported uncovered and she
             can relax the rule. Overruling here would make the control a
             suggestion box. */
          st2.res.assign.delete(occId);
          packRegroup(st2); packRefresh(st2);
          await packPersist(st2.cid);
        }
      }
      renderCapsules();
      toast(prefsLabel(packOccPref(st.cid, occId)) || "Rule cleared");
    };
  });
}

/* \u26a0\ufe0f A CHOICE RE-OPTIMISES THE REST OF THE TRIP AROUND IT (2026-08-10, her
   ask: *"once I've selected an option, the pack is reoptimized around all
   locked outfits/items automatically again"*).

   The choice already LOCKED that occasion, and `packEnsureSolve` already knows
   how to solve around locks \u2014 the only thing missing was that nothing asked it
   to. Without this, a choice was purely local: the other days kept outfits
   chosen against a bag she had just changed, and the alternatives they offered
   never moved however much she picked.

   \u26a0\ufe0f ONLY WHEN THE OUTFIT ACTUALLY CHANGED. Answering "this one" is her saying
   the day is settled; reshuffling days she never looked at in reply to that is
   the slot machine inversion \u2462 exists to prevent, and re-solving under one more
   lock can legitimately return a different global answer. So keeping the
   current outfit locks it and stops.
   \u26a0\ufe0f Her earlier choices survive, because each one locked its occasion \u2014 the
   re-solve carries every lock and only the unlocked days move. That is the same
   arrangement "\u2728 Re-solve" runs under, so there is no second solving mode here.
   \u26a0\ufe0f Undo restores the RECORD, not just this occasion. Once a choice moves other
   days, putting one outfit back would leave the trip in a state that was never
   on screen. */
async function packChooseOutfit(occId, ids) {
  const st = packStateReady();
  if (!st || !st.res || _packBusy) return;
  const occ = st.demand.find(o => o.id === occId);
  if (!occ) return;
  const clean = [...new Set(ids)].filter(id => itemById.has(id)).sort();
  if (clean.length < 2) return;
  const cid = st.cid;
  const cur = st.res.assign.get(occId);
  const same = cur && !packDistinct({ ids: clean }, cur);
  const before = JSON.parse(JSON.stringify(packRecord(cid)));
  const alts = packReviewOptions(st, occ).map(x => x.ids);
  st.res.assign.set(occId, { ids: clean, pieces: clean.map(id => itemById.get(id)).filter(Boolean), score: 0 });
  packRepack(st); packRegroup(st); packRefresh(st);
  const chosen = [...new Set([...(packRecord(cid).chosen || []), occId])];
  await savePackRecord(cid, { chosen, locked: packMarkLocked(cid, occId) });
  await recordContextChoice(occ.context, occ.level, clean,
                            alts.filter(a => a.join() !== clean.join()));
  await packPersist(cid);

  let moved = 0;
  if (!same) {
    _packBusy = true;
    try {
      const kept = new Map(st.res.assign);
      packLoadState(cid, { resolve: true });      // consumed once by packEnsureSolve
      const st2 = _packState;
      if (st2) {
        packEnsureSolve(st2);
        for (const [id, cd] of st2.res.assign) {
          const was = kept.get(id);
          if (was && packDistinct(cd, was)) moved++;
        }
        await packPersist(cid);
      }
    } finally { _packBusy = false; }
  }
  renderCapsules();
  /* \u26a0\ufe0f AND IT SAYS SO WHEN THE CHOICE BREAKS THE WASH. The deal ranks these
     options last, so reaching one usually means she picked it deliberately from
     the full options screen or nothing else was left \u2014 either way the moment
     she chooses is the moment to say it, not the items screen later. */
  const laun = (_packState && _packState.res
    ? (_packState.res.violations || []).filter(v => v.date === occ.date && clean.includes(v.itemId))
    : []);
  toast(laun.length ? `Locked in \u00b7 \u{1F9FA} ${packLaundryNote(laun, occ.date)}`
             : same ? "Kept \u00b7 locked in"
             : moved ? `Locked in \u00b7 ${moved} other day${moved === 1 ? "" : "s"} re-planned around it`
                     : "Locked in", {
    label: "Undo", fn: async () => {
      await kvUpdate(PACK_KEY_PREFIX + cid, () => before);
      /* ⚠️ packLoadState, not packStateReady — the state for this capsule is
         already in memory and packStateReady would hand back that stale copy
         rather than re-read the record we just restored. Then re-sync the bag:
         the re-solve may have added pieces the old record doesn't carry. */
      packLoadState(cid);
      if (_packState) { packEnsureSolve(_packState); await packPersist(cid); }
      renderCapsules();
    },
  });
}
/* "These all look fine." ⚠️ Marks them decided WITHOUT locking: skipping is not
   the same as choosing, and locking what she merely didn't object to would make
   a later re-solve refuse to improve days she never looked at. */
async function packSkipReview() {
  const st = packStateReady();
  if (!st || !st.res) return;
  const all = st.demand.filter(o => st.res.assign.get(o.id)).map(o => o.id);
  await savePackRecord(st.cid, { chosen: [...new Set([...(packRecord(st.cid).chosen || []), ...all])] });
  renderCapsules();
  toast("Left as they are");
}

async function packSetOccasionOutfit(cid, occId, ids) {
  const st = packStateReady(cid);
  if (!st || !st.res || !ids || ids.length < 2) return;
  const clean = [...new Set(ids)].filter(id => itemById.has(id)).sort();
  st.res.assign.set(occId, { ids: clean, pieces: clean.map(id => itemById.get(id)).filter(Boolean), score: 0 });
  // Inversion ①: whatever the outfit uses is now in the bag.
  packRepack(st);
  packRegroup(st);
  packRefresh(st);
  await savePackRecord(cid, { locked: packMarkLocked(cid, occId) });
  await packPersist(cid);
  renderCapsules();
  toast("Set — anything new is in the bag");
}

/* ⚠️ UNLOCKING RE-OPENS THE QUESTION (2026-08-10 r2, her ask: *"if I unlock an
   outfit, I want it to show me the alternatives again"*). A choice writes BOTH
   `chosen` (decided — the review row hides) and `locked` (held through every
   re-solve), and unlock only ever cleared the second, so the card came back
   editable with nothing to compare against and no way to get the comparison
   back short of choosing something else.
   ⚠️ Locking does NOT mark it chosen, and the asymmetry is deliberate: locking
   is "hold this one still", which is an answer to the review, but skipping
   already marks decided without locking, so making lock imply chosen would
   collapse two different things she does for different reasons. */
async function packToggleLock(occId) {
  const st = packStateReady();
  if (!st) return;
  const rec = packRecord(st.cid);
  const set = new Set(rec.locked || []);
  if (set.has(occId)) {
    set.delete(occId);
    await savePackRecord(st.cid, { locked: [...set],
      chosen: (rec.chosen || []).filter(x => x !== occId) });
  } else {
    set.add(occId);
    await savePackRecord(st.cid, { locked: [...set] });
  }
  renderCapsules();
}

/* Remove a piece. Days that depended on it BREAK and are flagged with dates —
   the app never silently re-solves around her edit. */
async function packDropPiece(itemId) {
  const st = _packState;
  if (!st) return;
  const it = itemById.get(itemId);
  st.res.pack = st.res.pack.filter(id => id !== itemId);
  // ⚠️ `st.pack` too. It is the live bag packRepack now unions from, so leaving
  // it stale would hand the piece straight back at the next swap or re-roll —
  // and packRegroup derives the items screen from it either way.
  st.pack = (st.pack || []).filter(id => id !== itemId);
  st.res.extras = (st.res.extras || []).filter(id => id !== itemId);
  const rec = packRecord(st.cid);
  await savePackRecord(st.cid, { pinned: (rec.pinned || []).filter(id => id !== itemId) });
  const broken = st.demand.filter(o => {
    const cd = st.res.assign.get(o.id);
    return cd && cd.ids.includes(itemId);
  });
  for (const o of broken) st.res.assign.delete(o.id);
  packRefresh(st);
  await packPersist(st.cid);
  renderCapsules();
  if (broken.length) {
    toast(`Dropped · ${broken.length} day${broken.length === 1 ? "" : "s"} need a new outfit`,
      { label: "Fix them", fn: () => packFixBroken() });
  } else {
    toast(`Dropped ${it ? (it.name || "piece") : "piece"}`, { label: "Undo", fn: () => packAddPiece(itemId) });
  }
}
// Re-solve ONLY the occasions with no outfit, holding everything else still.
async function packFixBroken() {
  const st = _packState;
  if (!st) return;
  const wxFor = packWxFor(st.c);
  let fixed = 0;
  for (const occ of st.demand) {
    if (st.res.assign.has(occ.id)) continue;
    const inPack = new Set(st.res.pack);
    const inside = packCandidates(occ, st.res.pack, { wxFor, all: true }).find(x => x.ids.every(id => inPack.has(id)));
    const pick = inside || packCandidates(occ, st.rack.ids, { wxFor, all: true })[0];
    if (pick) { st.res.assign.set(occ.id, pick); fixed++; }
  }
  packRepack(st); packRefresh(st);
  await packPersist(st.cid);
  renderCapsules();
  toast(fixed ? `Filled ${fixed} day${fixed === 1 ? "" : "s"}` : "Nothing available fits those days");
}

// Bring something along. Pinned, so it survives every re-solve.
async function packAddPiece(itemId) {
  const st = _packState;
  if (!st) return;
  const it = itemById.get(itemId);
  if (!it) return;
  if (!st.res.pack.includes(itemId)) st.res.pack = st.res.pack.concat([itemId]);
  if (!(st.pack || []).includes(itemId)) st.pack = (st.pack || []).concat([itemId]);
  st.res.extras = (st.res.extras || []).concat([itemId]);
  const rec = packRecord(st.cid);
  await savePackRecord(st.cid, { pinned: [...new Set((rec.pinned || []).concat([itemId]))] });
  packRefresh(st);
  await packPersist(st.cid);
  renderCapsules();
  toast(`${it.name || "Piece"} is in the bag`);
}

/* ⚠️ TWO DOORS, ONE STATE (her doc: "all roads should lead to the same state").
   `pin:true` is the pre-build door — a piece added there is a DEFINITE, locked
   before packFill runs, so the bag is built AROUND it rather than rebuilt to
   accommodate it afterwards. Without the flag it's the post-build door and just
   drops a piece into the bag. Same store either way (`rec.pinned`), so the two
   can't drift. */
function openPackAddSheet({ pin = false, back = null } = {}) {
  const st = _packState;
  if (!st) return;
  const inPack = new Set(st.res ? st.res.pack : st.pack);
  const pool = items.filter(i => itemStatus(i) === "Available" && !inPack.has(i.id));
  let q = "";
  const render = () => {
    const list = (q.trim() ? pool.filter(i => itemMatchesText(i, q)) : pool.slice(0, 60));
    $("#packAddResults").innerHTML = list.length
      ? `<div class="ogrid">${list.map(i => `<button class="otile" data-packadd="${esc(i.id)}">
          ${thumbHtml(i.image_path, "pack-pthumb")}<div class="oname">${esc(i.name || "Untitled")}</div></button>`).join("")}</div>`
      : `<div style="padding:24px 16px;text-align:center;color:var(--muted)">Nothing matches.</div>`;
    hydratePhotos($("#logInner"));
    $("#logInner").querySelectorAll("[data-packadd]").forEach(b => {
      b.onclick = async () => {
        if (pin) {
          const rec = packRecord(st.cid);
          await savePackRecord(st.cid, { pinned: [...new Set((rec.pinned || []).concat([b.dataset.packadd]))] });
          if (back) { back(); return; }
          hideSheet("logSheet");
        } else { hideSheet("logSheet"); packAddPiece(b.dataset.packadd); }
      };
    });
  };
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="packAddCancel">Cancel</button>
      <h2>${pin ? "Definitely bringing" : "Bring something"}</h2>
      <span style="width:54px"></span>
    </div>
    <div style="padding:8px 16px"><input class="inp" id="packAddQ" placeholder="Search your closet…"></div>
    <div id="packAddResults" style="padding:0 0 30px"></div>`;
  showSheet("logSheet");
  render();
  $("#packAddCancel").onclick = () => { if (back) back(); else hideSheet("logSheet"); };
  $("#packAddQ").oninput = (e) => { q = e.target.value; render(); };
}

// ✨ Re-solve, scoped: pins and locks are held, everything else may move.
async function packResolveUnlocked() {
  if (_packBusy) return;
  _packBusy = true;
  try {
    const cid = capsuleId;
    packLoadState(cid, { resolve: true });
    await packPersist(cid);
    renderCapsules();
    const st = _packState;
    toast(st && st.res.unmet.length ? `Re-solved · ${st.res.unmet.length} occasion${st.res.unmet.length === 1 ? "" : "s"} still uncovered` : "Re-solved");
  } finally { _packBusy = false; }
}

/* ⚠️ THIS REPLACED THE TIGHTNESS DIAL (2026-08-08). The dial asked her to think
   in "options per occasion" — an implementation concept — and then, measurably,
   only ever changed the number of SPARE pieces. So it names its consequence
   instead: each row says what you'd actually carry, and switching re-solves and
   shows the new number. Nothing to decode, and the per-piece Optional list
   underneath is where the real control lives. */
function openPackModeSheet() {
  const st = _packState;
  if (!st) return;
  const cur = packMode(st.cid);
  const occN = st.demand.length;
  const { core } = packCoreOptional(st);
  const blurb = { light: "Smallest practical bag.", balanced: "Compact, with a little room.",
                  flexible: "More options and backups." };
  const rows = PACK_MODES.map(m => {
    const spare = packModeSpareTarget(m, occN);
    const total = core.length + spare;
    return `<button class="sheet-row" data-packmodeset="${esc(m)}">
      <span>${esc(m[0].toUpperCase() + m.slice(1))}<div class="muted" style="font-size:12px;font-weight:400">${esc(blurb[m])}</div></span>
      <span class="rt" style="color:${cur === m ? "var(--accent)" : "var(--muted)"};font-weight:${cur === m ? "700" : "400"}">~${total} piece${total === 1 ? "" : "s"}${spare ? ` · ${spare} spare` : ""}${cur === m ? " \u2713" : ""}</span>
    </button>`;
  }).join("");
  $("#moveInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="packModeCancel">Cancel</button>
      <h2>How much to bring</h2>
      <span style="width:54px"></span>
    </div>
    <div class="sheet-note">${core.length} pieces cover your planned outfits either way. This only changes how much spare you carry \u2014 and you can drop any spare piece individually.</div>
    ${rows}`;
  showSheet("moveSheet");
  $("#packModeCancel").onclick = () => hideSheet("moveSheet");
  $("#moveInner").querySelectorAll("[data-packmodeset]").forEach(b => {
    b.onclick = async () => {
      hideSheet("moveSheet");
      _packBusy = true;
      try {
        const cid = capsuleId;
        await savePackRecord(cid, { mode: b.dataset.packmodeset });
        /* ⚠️ SOLVE BEFORE PERSISTING — packLoadState leaves res null and
           packPersist only writes the assignment `if (st.res)`, so the stored
           outfits would be last mode's while the bag was rebuilt for this one.
           The r11 bug; the reason survives even though the dial didn't. */
        const st2 = packLoadState(cid, { resolve: true });
        packEnsureSolve(st2, { force: true });
        await packPersist(cid);
        renderCapsules();
        const co = packCoreOptional(st2);
        toast(`${co.core.length} core${co.optional.length ? ` + ${co.optional.length} optional` : ""}`);
      } finally { _packBusy = false; }
    };
  });
}

/* ---- "will I do laundry on this trip?" (2026-08-10 r2) --------------------
   Her ask, verbatim: *"maybe the bag should have a laundry setting? I will/won't
   do laundry on this trip"*. It is the single input that decides how many tees
   the trip needs, and it was a sentence on the Plan tab pointing at the by-day
   planner — which is folded away behind "Day by day".

   ⚠️ IT WRITES THE SAME SENTINEL the by-day planner writes (PLAN_LAUNDRY inside
   capsules.plan), so packSchedule, packSolve and packMidTripWash all see it with
   no new state and no second source of truth to drift.
   ⚠️ RE-SOLVES AFTERWARDS, holding her locks, because this changes the constraint
   the outfits were solved under — leaving them would mean a pack built for no
   laundry sitting under a plan that says there is some. Same path as a review
   choice; her chosen days can't move.
   ⚠️ "No laundry" is not stored as an answer. It is the absence of wash days,
   which is what the schedule already assumes — a stored "no" would be a second
   way to say the same thing, and they could disagree. */
function openTripLaundrySheet() {
  const c = capsuleById.get(capsuleId);
  if (!c) return;
  const dates = tripDates(c);
  if (!dates.length) return toast("This trip has no dates yet");
  const on = new Set(packWashDays(c));
  // ⚠️ The date sub-line only when the label isn't already the date — otherwise
  // every row read "Tue, Aug 11 / Aug 11". planDayLabel says "Today" near the
  // trip and the full date further out, so it can't just be dropped.
  const rows = dates.map(d => `<button class="sheet-row" data-launday="${esc(d)}">
      <span>${esc(planDayLabel(d))}${planDayLabel(d).includes(fmtDate(d)) ? ""
        : `<div class="muted" style="font-size:12px;font-weight:400">${esc(fmtDate(d))}</div>`}</span>
      <span class="rt" style="color:${on.has(d) ? "var(--accent)" : "var(--muted)"};font-weight:${on.has(d) ? "700" : "400"}">${on.has(d) ? "🧺 washing ✓" : "no wash"}</span>
    </button>`).join("");
  $("#moveInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="tripLaunCancel">Close</button>
      <h2>Laundry on this trip</h2>
      <span style="width:54px"></span>
    </div>
    <div class="sheet-note">Pick the days you'll wash. Everything resets that day, so the pack needs fewer of the things you wear most. Leave them all off if you won't do laundry — then nothing goes out more times than it has clean wears.</div>
    ${on.size ? `<button class="sheet-row" data-launnone><span>No laundry on this trip</span><span class="rt">Clear all</span></button>` : ""}
    ${rows}`;
  showSheet("moveSheet");
  $("#tripLaunCancel").onclick = () => hideSheet("moveSheet");
  const apply = async (fn, msg) => {
    hideSheet("moveSheet");
    if (_packBusy) return;
    _packBusy = true;
    try {
      const cid = capsuleId;
      await fn(cid);
      if (packRecord(cid).built) {
        const st2 = packLoadState(cid, { resolve: true });
        packEnsureSolve(st2, { force: true });
        await packPersist(cid);
      }
      renderCapsules();
      toast(msg(capsuleById.get(cid)));
    } finally { _packBusy = false; }
  };
  $("#moveInner").querySelectorAll("[data-launday]").forEach(b => {
    b.onclick = () => apply(
      (cid) => togglePlanLaundry(cid, b.dataset.launday),
      (c2) => {
        const days = packWashDays(c2);
        return days.length ? `Washing on ${days.map(d => fmtDate(d)).join(", ")}` : "No laundry planned";
      });
  });
  const none = $("#moveInner").querySelector("[data-launnone]");
  if (none) none.onclick = () => apply(async (cid) => {
    for (const d of packWashDays(capsuleById.get(cid))) await togglePlanLaundry(cid, d);
  }, () => "No laundry on this trip");
}

/* ⚠️ packSendToPlan is GONE (2026-08-04 r5). It materialised every assignment as
   a real look and wrote capsules.plan, which is why it needed a confirm and why
   the pack was invisible until she found it. The by-day planner and the trip
   dash now read the pack record directly (packPlanByDate) and a look is created
   only when she wears one (packWoreOccasion). Do not reinstate it: the flood of
   auto-created look records it caused is the reason it was gated, and the gate
   is the thing she asked to remove. */

/* ===================================================================
   RE-ENTRY — the diff is the artifact (TRIP_BUILDER.md §8).
   The second and third visits are the common case, not the first.
   =================================================================== */
function packDiff(cid) {
  const rec = packRecord(cid);
  if (!rec.built) return null;
  const c = capsuleById.get(cid);
  if (!c) return null;
  const { demand } = packDemandFor(cid, c);
  const reasons = [];
  if (packSlateHash(demand) !== rec.slateHash) reasons.push("the plan for the days changed");
  const ls = laundryState();
  const nowDirty = (rec.pieces || []).filter(id => {
    const i = itemById.get(id);
    return i && isDirty(i, ls);
  });
  if (nowDirty.length) reasons.push(`${nowDirty.length} packed piece${nowDirty.length === 1 ? " is" : "s are"} in the hamper`);
  const gone = (rec.pieces || []).filter(id => {
    const i = itemById.get(id);
    return !i || itemStatus(i) !== "Available";
  });
  if (gone.length) reasons.push(`${gone.length} piece${gone.length === 1 ? "" : "s"} no longer available`);
  return { reasons, nowDirty, gone, built: rec.built, changed: reasons.length };
}

/* ===================================================================
   CAPTURE (D4) — the character chip + fixed events, at booking.
   ⚠️ The build sheet opens ALREADY ANSWERED. A form is the opposite of magic:
   the slate pre-fills from dates + weekday rhythm + declared events, and the
   three questions are chips she taps only when the guess is wrong.
   =================================================================== */
/* First run: confirm what's happening and how much to bring, then build.
   ⚠️ NO trip "type" here, and no per-date grid — both were asked for and removed
   (2026-07-30 r6). What's happening is the ticked context list, edited in the
   one place that owns it (openPackContexts). */
function openPackBuildSheet(cid) {
  const c = capsuleById.get(cid);
  if (!c) return;
  const picked = packTripContexts(cid) || packSuggestTripContexts(c);
  const { slate, demand } = packDemandFor(cid, c, { tripContexts: picked });
  const rec = packRecord(cid);
  const mode = packMode(cid);
  const washDays = packWashDays(c);
  const mine = !!packTripContexts(cid);

  const rows = picked.length
    ? picked.map(e => {
        const lvl = e.level || contextFormalityLevel(e.ctx) || CONTEXT_FORMALITY_SEED[e.ctx];
        return `<div class="pack-mixrow"><span>${esc(e.ctx)}${lvl ? ` · ${esc(occLabel(lvl))}` : ""}</span><b>${e.n || 1}d</b></div>`;
      }).join("")
    : `<div class="pack-warn-note" style="padding:4px 0">Nothing picked yet.</div>`;

  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="packBuildCancel">Cancel</button>
      <h2>Build the pack</h2>
      <span style="width:54px"></span>
    </div>
    <div style="padding:4px 16px 0">
      <div class="fld">What's happening · ${demand.length} occasion${demand.length === 1 ? "" : "s"}</div>
      <div class="pack-mix">${rows}</div>
      <button class="btn btn-sec" id="packBuildCtx" style="margin-top:8px;width:100%">${mine ? "Change what's happening" : "Pick what's happening"}</button>
      <div class="pack-warn-note" style="padding:6px 0">${mine
        ? `Your picks. Days you've set a fixed event for win over these.`
        : `A starting guess from the contexts you wear most — change it and it's yours.`}</div>
      <div class="fld" style="margin-top:14px">Laundry</div>
      <div class="pack-warn-note" style="padding:2px 0 6px">${washDays.length
        ? `Washing on ${esc(washDays.map(d => fmtDate(d)).join(", "))} — set on the by-day planner.`
        : `No wash planned. Set a laundry day on the by-day planner if you'll have one.`}</div>
      <div class="fld" style="margin-top:14px">Definitely bringing${(rec.pinned || []).length ? ` · ${(rec.pinned || []).length}` : ""}</div>
      <div class="pack-warn-note" style="padding:2px 0 6px">${(rec.pinned || []).length
        ? esc((rec.pinned || []).map(id => (itemById.get(id) || {}).name || "piece").slice(0, 4).join(", "))
          + ((rec.pinned || []).length > 4 ? ` +${(rec.pinned || []).length - 4} more` : "")
        : `Nothing yet. Add anything you've already decided on and the pack gets built around it.`}</div>
      <button class="btn btn-sec" id="packBuildDefinites" style="width:100%">＋ Add pieces you're bringing</button>
      ${(rec.banned || []).length ? `<div class="pack-warn-note" style="padding:6px 0 0">Not this trip: ${
        esc((rec.banned || []).map(id => (itemById.get(id) || {}).name || "piece").slice(0, 3).join(", "))}${
        (rec.banned || []).length > 3 ? ` +${(rec.banned || []).length - 3}` : ""} · <button class="lnk" id="packBuildUnban">clear</button></div>` : ""}
      <div class="fld" style="margin-top:14px">How much to bring</div>
      <div class="pack-chiprow">${PACK_MODES.map(m =>
        `<button class="cap-chip${mode === m ? " on" : ""}" data-packbmode="${esc(m)}">${esc(m)}</button>`).join("")}</div>
      <div class="pack-warn-note" style="padding:2px 0 0">${esc({
        light: "Smallest practical bag \u2014 no spare pieces.",
        balanced: "Compact, with a little room to change your mind.",
        flexible: "More options and backups." }[mode])}</div>
      <button class="btn" id="packBuildGo" style="margin:18px 0 8px">✨ Build the pack</button>
      <div class="pack-warn-note" style="padding:0 0 24px">${(c.locations || []).length
        ? `Weather comes from your locations — beyond about two weeks out it's a typical-for-the-date average, not a forecast.`
        : `⚠️ No locations set, so this will pack for the season only. Add one on the trip page for real weather.`}</div>
    </div>`;
  showSheet("logSheet");
  $("#packBuildCancel").onclick = () => hideSheet("logSheet");
  $("#packBuildCtx").onclick = async () => {
    // The context list needs a loaded pack state to read the trip from.
    if (!_packState || _packState.cid !== cid) { capsuleId = cid; packLoadState(cid); }
    openPackContexts({ back: () => openPackBuildSheet(cid) });
  };
  $("#logInner").querySelectorAll("[data-packbmode]").forEach(b => {
    b.onclick = async () => { await savePackRecord(cid, { mode: b.dataset.packbmode }); openPackBuildSheet(cid); };
  });
  /* ⚠️ DEFINITES ARE AN INPUT, NOT AN EDIT (her report: "I want input before the
     bag is finalized"). Added here they are locked before packFill runs, so the
     bag is built AROUND them rather than being rebuilt to accommodate them
     afterwards. Same store as "Keep" on a built pack — one state, two doors. */
  const defBtn = $("#packBuildDefinites");
  if (defBtn) defBtn.onclick = () => {
    if (!_packState || _packState.cid !== cid) { capsuleId = cid; packLoadState(cid); }
    hideSheet("logSheet");
    openCapsulePicker(cid, { mode: "definites", back: () => openPackBuildSheet(cid) });
  };
  const unban = $("#packBuildUnban");
  if (unban) unban.onclick = async () => { await savePackRecord(cid, { banned: [] }); openPackBuildSheet(cid); };
  $("#packBuildGo").onclick = async () => {
    hideSheet("logSheet");
    // Whatever's shown becomes hers, so the pack isn't built on a guess that
    // then re-guesses differently next time.
    if (!packTripContexts(cid)) await setPackTripContexts(cid, picked);
    await openPackPlan(cid, { resolve: true });
    const st = _packState;
    if (st) toast(`${st.pack.length} pieces${st.cov ? ` → ${st.cov.outfits} outfits` : ""}`);
  };
}

/* "Same as last time" — start from a finished trip's pack. The most direct use
   of past trips there is, and it sidesteps the capture entirely. */
function openPackTemplateSheet(cid) {
  const c = capsuleById.get(cid);
  const past = completedTrips().filter(x => x.id !== cid && capsuleItems(x.id).length);
  if (!past.length) { toast("No finished trips to copy from yet"); return; }
  $("#moveInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="packTplCancel">Cancel</button>
      <h2>Same as last time</h2>
      <span style="width:54px"></span>
    </div>
    <div class="sheet-note">Copies that trip's pieces in, then adjusts for this trip's weather and days.</div>
    ${past.slice(0, 12).map(x => `<button class="sheet-row" data-packtpl="${esc(x.id)}">
      <span>${esc(x.name)}</span>
      <span class="rt">${capsuleItems(x.id).length} pieces · ${esc(fmtDate(x.start_date))}</span>
    </button>`).join("")}`;
  showSheet("moveSheet");
  $("#packTplCancel").onclick = () => hideSheet("moveSheet");
  $("#moveInner").querySelectorAll("[data-packtpl]").forEach(b => {
    b.onclick = async () => {
      hideSheet("moveSheet");
      const fromIds = capsuleItems(b.dataset.packtpl).filter(i => itemStatus(i) === "Available").map(i => i.id);
      const rec = packRecord(cid);
      await savePackRecord(cid, { pinned: [...new Set((rec.pinned || []).concat(fromIds))] });
      await openPackPlan(cid, { resolve: true });
      toast(`Started from ${fromIds.length} pieces — adjusted for this trip`);
    };
  });
}

/* The fixed-event capture on the create form. Date + context, nothing else —
   she's booking a trip, not planning outfits. */
/* ⚠️ TAPPING A CONTEXT USED TO CREATE THE EVENT IMMEDIATELY (fixed 2026-08-06
   r4). Every context she owns is listed here with its formality level printed on
   the right, which invites tapping one to see what level it maps to — and that
   tap wrote a `dayplan` entry, on a date pre-filled to the trip's start, which
   then stocked the rack and the pack and could never be seen again on the
   calendar. Her report was a trip packing for a wedding that didn't exist.
   Selecting and committing are two taps now. */
function openCapAnchorSheet() {
  const opts = contextOptions();
  let date = _capForm && _capForm.start_date ? _capForm.start_date : todayStr();
  let picked = null;
  const render = () => {
    $("#moveInner").innerHTML = `
      <div class="sheet-hdr">
        <button class="lnk" id="capAnchCancel">Cancel</button>
        <h2>Fixed event</h2>
        <span style="width:54px"></span>
      </div>
      <div class="sheet-note">Something already on the calendar for this trip — a wedding, a concert. It'll shape what gets packed.</div>
      <div style="padding:8px 16px">
        <label class="fld">Date</label>
        <input class="inp" type="date" id="capAnchDate" value="${esc(date)}">
        <label class="fld" style="margin-top:12px">What is it</label>
      </div>
      ${opts.map(o => `<button class="sheet-row${picked === o ? " on" : ""}" data-capanch="${esc(o)}">
        <span>${picked === o ? "✓ " : ""}${esc(o)}</span>
        <span class="rt">${esc(OCCASION_LADDER[(contextFormalityLevel(o) || CONTEXT_FORMALITY_SEED[o] || 3) - 1] || "")}</span>
      </button>`).join("")}
      <div style="padding:12px 16px 16px">
        <button class="btn" id="capAnchAdd"${picked ? "" : " disabled style=\"opacity:.45\""}>
          ${picked ? `Add ${esc(picked)}` : "Pick one above"}
        </button>
      </div>
      <div style="height:max(env(safe-area-inset-bottom),10px)"></div>`;
    $("#capAnchCancel").onclick = () => hideSheet("moveSheet");
    const di = $("#capAnchDate"); if (di) di.onchange = () => { date = di.value; };
    $("#moveInner").querySelectorAll("[data-capanch]").forEach(b => {
      // Tapping the selected one clears it — a control that can only turn on is a trap.
      b.onclick = () => { picked = picked === b.dataset.capanch ? null : b.dataset.capanch; render(); };
    });
    const addBtn = $("#capAnchAdd");
    if (addBtn) addBtn.onclick = () => {
      if (!picked) return;
      const d = $("#capAnchDate");
      const useDate = (d && d.value) || date;
      if (!useDate) { toast("Pick a date"); return; }
      _capForm.anchors = (_capForm.anchors || []).concat([{ date: useDate, context: picked }]);
      hideSheet("moveSheet");
      renderCapsules();
    };
  };
  render();
  showSheet("moveSheet");
}

/* ===================================================================
   THE BUILDER GRADES ITSELF — surfaced on the trip recap.
   An engine that reports its own hit rate is one she can calibrate against.
   =================================================================== */
function packGradeRowHtml(c) {
  const g = packGrade(c);
  if (!g) return "";
  const pct = g.hitRate == null ? null : Math.round(g.hitRate * 100);
  return `<div class="pack-grade">
    <div class="pack-grade-hd">How the pack did</div>
    <div>Packed ${g.suggested} · wore ${g.worn}${pct != null ? ` (${pct}%)` : ""}</div>
    ${g.unpacked ? `<div>Wore ${g.unpacked} thing${g.unpacked === 1 ? "" : "s"} you didn't pack: ${esc(g.unpackedItems.slice(0, 3).map(i => i.name || "Untitled").join(", "))}${g.unpacked > 3 ? "…" : ""}</div>` : ""}
    <div class="pack-warn-note">Over ${g.loggedDays} logged day${g.loggedDays === 1 ? "" : "s"}. Not a score — it's what to correct next time.</div>
  </div>`;
}

/* Options count, as text. Capped on purpose: past a handful the exact number is
   noise, and "20 options" next to a "See 20" button is worse than no number. */
function packOptLabel(n) {
  if (!n || n < 2) return "";
  return n > 8 ? " · plenty of options" : ` · ${n} options`;
}
