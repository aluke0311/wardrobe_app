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
const PACK_KIND_PREFIX = "pack_kind:";  // kv: trip character, per capsule

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

// A trip-sized rack. RACK_SLOT_QUOTA is calibrated for one day at home; ten
// days with two dress-coded evenings needs more to draw from. Passed to
// buildRack as `quota` — the cold share is untouched and stays load-bearing.
const PACK_TRIP_QUOTA = { Tops: 20, Bottoms: 12, Dresses: 8, Shoes: 10, Outerwear: 5 };

const PACK_CHARACTERS = ["beach week", "work trip", "family visit", "city break", "event trip"];
/* Occasions per DAY, used only until she has trips of that character to learn
   from (packOccasionSeed prefers history). ⚠️ These are guesses and are
   labelled as guesses in the UI — rewrite them from the first few real trips
   rather than tuning them now (TRIP_BUILDER.md §15). */
const PACK_CHAR_SEED = {
  "beach week":   [{ context: "Errands", per: 0.5 }, { context: "Friends", per: 0.4 }, { context: "Date Night", per: 0.15 }],
  "work trip":    [{ context: "Work", per: 0.8 }, { context: "Friends", per: 0.2 }, { context: "Errands", per: 0.2 }],
  "family visit": [{ context: "Friends", per: 0.6 }, { context: "Errands", per: 0.4 }],
  "city break":   [{ context: "Errands", per: 0.5 }, { context: "Friends", per: 0.4 }, { context: "Date Night", per: 0.2 }],
  "event trip":   [{ context: "Friends", per: 0.5 }, { context: "Errands", per: 0.35 }, { context: "Wedding", per: 0.15 }],
};

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
const PACK_REPEAT_TOP = 150;    // per earlier DAY this top/dress already went out
/* ⚠️ The suggester's own combo score spreads only about 2.5–5.5 points
   (measured), so against cost terms of 1000–5000 it was pure rounding error —
   the engine's formality cohesion, colour-pair and item-pair affinity were
   being thrown away. Scaling it up makes quality a real tie-breaker between
   options with the same piece count (a full spread ≈ half a piece) without
   letting it override the objective. Same reason PACK_PROVEN_W isn't 20 any
   more. Re-measure these if scoreCombo's range ever changes. */
const PACK_SCORE_W = 150;       // weight on the suggester's own combo score
const PACK_PROVEN_W = 60;       // per piece proven on past trips

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

/* ---- trip character (D4) ------------------------------------------------- */
function packCharacter(cid) {
  const v = kvData.get(PACK_KIND_PREFIX + cid);
  return typeof v === "string" && PACK_CHARACTERS.includes(v) ? v : null;
}
async function setPackCharacter(cid, ch) {
  await kvSet(PACK_KIND_PREFIX + cid, ch || null);
}

/* Occasions per day for a character, learned from her own completed trips of
   that character and falling back to PACK_CHAR_SEED. `source` is returned so
   the UI can label a guess as a guess — the r19 lesson is that an unlabelled
   guess costs more trust than hand-entry costs taps. */
function packOccasionSeed(character, { caps = null, wearRows = null, kinds = null, today = null } = {}) {
  const rows = wearRows || wears;
  const charOf = (id) => kinds ? (kinds.get(id) || null) : packCharacter(id);
  const trips = (character ? completedTrips(caps, today) : []).filter(c => charOf(c.id) === character);
  const per = new Map();
  let nTrips = 0;
  for (const c of trips) {
    const dates = new Set(tripDates(c));
    if (!dates.size) continue;
    nTrips++;
    // Occasion-DAYS per context (a wear is a day — never a row).
    const seen = new Set(), byCtx = new Map();
    for (const w of rows) {
      if (!w.worn_on || !dates.has(w.worn_on)) continue;
      for (const ctx of ctxArr(w)) {
        const k = ctx + " " + w.worn_on;
        if (seen.has(k)) continue;
        seen.add(k);
        byCtx.set(ctx, (byCtx.get(ctx) || 0) + 1);
      }
    }
    for (const [ctx, n] of byCtx) per.set(ctx, (per.get(ctx) || 0) + n / dates.size);
  }
  if (nTrips >= TRIP_MEMORY_MIN && per.size) {
    const out = [...per.entries()]
      .map(([context, tot]) => ({ context, per: tot / nTrips }))
      .filter(e => e.context !== TRIP_CONTEXT)   // travel days are stamped structurally
      .sort((a, b) => b.per - a.per);
    return { mix: out, source: "history", trips: nTrips };
  }
  const seed = (character && PACK_CHAR_SEED[character]) || [];
  return { mix: seed.map(e => ({ ...e })), source: seed.length ? "seed" : "none", trips: nTrips };
}

/* ---- the slate ----------------------------------------------------------
   Demand is a MULTISET of occasions; placement is optional metadata (D6). What
   this builds is the placed view, because a mid-trip wash needs to know WHICH
   days — with no wash the trip is one stretch and placement is irrelevant.

   Precedence per day: declared (dayplan) → her weekday rhythm → the character
   mix, clustered. ⚠️ Clustered on purpose: same context on consecutive days is
   the WORST case for laundry, so the default plan is conservative and one drag
   makes it better rather than worse. Same rule as the week planner — never ask
   for the grid, always show the guess. */
function packSlate(c, { character = null, plans = null, wearRows = null, rhythm = null,
                       mix = null, today = null } = {}) {
  const dates = tripDates(c);
  if (!dates.length) return [];
  const rows = wearRows || wears;
  const all = plans || dayPlanAll();
  const rhy = rhythm || weeklyRhythm(rows);
  const legOf = new Map();
  for (const leg of packLegsOrWhole(c)) for (const d of leg.dates) legOf.set(d, leg);

  const lvlOf = (ctx) => contextFormalityLevel(ctx, rows) || CONTEXT_FORMALITY_SEED[ctx] || null;
  const slate = dates.map(date => ({ date, leg: legOf.get(date) || null, occasions: [] }));
  const byDate = new Map(slate.map(s => [s.date, s]));

  // ① declared — a fixed event captured at booking IS a named context on a date
  for (const s of slate) {
    for (const e of (all[s.date] || [])) {
      const ctxs = (e.contexts || []).filter(Boolean);
      const lvl = ctxs.length ? Math.max(...ctxs.map(x => lvlOf(x) || 0)) : (e.level || 0);
      if (!ctxs.length && !e.level) continue;
      s.occasions.push({ context: ctxs[0] || null, contexts: ctxs, level: lvl || null, placed: true, source: "declared" });
    }
  }

  /* ② Travel days, claimed BEFORE the guesses. ⚠️ Ordering is load-bearing: with
     the travel stamp last, the departure day collected a rhythm occasion AND a
     character occasion AND then Travel — three occasions on the day she's on a
     plane. Claiming it first means the later passes see it as taken.
     This is also what enforces the travel-home reserve: because the return day
     always carries an occasion, the ordinary schedule walk detects a trip that
     burns its last clean bottoms on day 8. No special case, which is why there
     is no PACK_HOME_RESERVE constant. */
  for (const d of [dates[0], dates[dates.length - 1]]) {
    const s = byDate.get(d);
    if (!s) continue;
    if (!s.occasions.some(o => (o.contexts || []).includes(TRIP_CONTEXT))) {
      s.occasions.push({ context: TRIP_CONTEXT, contexts: [TRIP_CONTEXT], level: lvlOf(TRIP_CONTEXT), placed: true, source: "travel" });
    }
  }

  // ③ her weekday rhythm, for days she didn't declare
  for (const s of slate) {
    if (s.occasions.length) continue;
    const r = rhythmFor(s.date, rhy);
    const ctxs = (r && r.contexts || []).filter(x => x !== TRIP_CONTEXT);
    if (!ctxs.length) continue;
    s.occasions.push({ context: ctxs[0], contexts: ctxs, level: lvlOf(ctxs[0]), placed: false, source: "rhythm" });
  }

  /* ④ the character mix, as a TARGET COUNT across the trip.
     ⚠️ NOT merely a filler for empty days. Her weekday rhythm covers almost
     every day with one ordinary context, so filler-only meant a character
     carrying "two dressy evenings" produced NO dressy occasion at all and the
     pack silently lost the level it existed for. A nice dinner is an EXTRA
     occasion on a beach day, not a replacement for it — which is also why
     demand is a multiset (D6) rather than one context per day.
     Placement is clustered: consecutive days is the worst case for laundry, so
     the default plan is conservative and a drag can only improve it. */
  const targets = (mix || packOccasionSeed(character, { wearRows: rows, today }).mix)
    .map(e => ({ ...e, n: Math.max(0, Math.round((e.per || 0) * dates.length)) }));
  for (const e of targets) {
    const has = (s) => s.occasions.some(o => (o.contexts || []).includes(e.context));
    let need = e.n - slate.reduce((n, s) => n + (has(s) ? 1 : 0), 0);
    /* Still clustered (earliest days first, the worst case for laundry) but it
       skips days that are already carrying two occasions. Plain first-fit piled
       three occasions onto the departure day, which is neither realistic nor a
       worse laundry case — just a worse-looking one. */
    const order = slate.slice().sort((a, b) => a.occasions.length - b.occasions.length);
    for (const s of order) {
      if (need <= 0) break;
      if (has(s) || s.occasions.length >= 2) continue;
      s.occasions.push({ context: e.context, contexts: [e.context], level: lvlOf(e.context), placed: false, source: "character" });
      need--;
    }
  }
  // Anything still bare gets her modal level, so no day is ever unanswerable.
  const floor = packModalLevel(rows);
  for (const s of slate) {
    if (s.occasions.length) continue;
    s.occasions.push({ context: null, contexts: [], level: floor, placed: false, source: "floor" });
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

/* Flatten the slate into the demand multiset. Occasion ids are stable across
   re-solves (date + index) so locks and pins survive a rebuild. */
function packDemand(slate) {
  const out = [];
  for (const s of slate || []) {
    (s.occasions || []).forEach((o, idx) => {
      out.push({
        id: `${s.date}#${idx}`, date: s.date, leg: s.leg,
        context: o.context || null, contexts: o.contexts || [],
        level: o.level || null, placed: !!o.placed, source: o.source || null,
      });
    });
  }
  return out;
}
// The slate as a dayplan-shaped object, so buildRack's rackNeededLevels can
// read the trip's declared levels without a second code path.
function packSlateAsPlans(slate) {
  const out = {};
  for (const s of slate || []) {
    const entries = (s.occasions || []).filter(o => (o.contexts || []).length)
      .map(o => ({ contexts: o.contexts, outfit: null }));
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

/* ---- candidates ---------------------------------------------------------
   ⚠️ cleanOnly = FALSE, deliberately. Laundry is a SCHEDULE constraint here
   (inversion ②), not a pool filter: a piece that's dirty today may be perfectly
   packable after a wash before departure, and filtering it out of the pool is
   the divide-don't-schedule bug wearing a different hat.
   ⚠️ Level 1 draws from the WHOLE closet, never the rack — buildRack excludes
   the Workout category on purpose, so a Utility occasion pooled from the rack
   can never form an outfit. Same precedence as _suggBasePool. */
function packCandidates(occ, rackIds, { pool = null, wxFor = null, limit = PACK_CANDIDATES_PER_OCC,
                                        seed = 1, all = false } = {}) {
  const avail = (pool || items).filter(i => itemStatus(i) === "Available");
  const base = occ.level === 1 ? avail : rackIds.map(id => itemById.get(id)).filter(i => i && itemStatus(i) === "Available");
  if (!base.length) return [];
  const day = occ.date || (occ.leg && occ.leg.dates[0]) || todayStr();
  const wx = wxFor ? wxFor(day) : null;
  const season = seasonOf(day);
  const raw = packWithSeed(seed ^ packHash(occ.id || day), () =>
    suggestOutfits(occ.level, null, base, season, wx, null, false, null, null,
                   { all: true, uniqueCap: PACK_ENUM_CAP }));
  const out = raw.map(cmb => ({
    ids: cmb.pieces.map(p => p.id).sort(),
    pieces: cmb.pieces,
    score: cmb.score,
  }));
  out.sort((a, b) => (b.score - a.score) || (a.ids.join() < b.ids.join() ? -1 : 1));
  return all ? out : packDiversify(out, limit);
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
      const overlap = cd.ids.reduce((n, id) => n + (use.get(id) || 0), 0);
      const s = cd.score - overlap * 3;
      if (s > bs) { bs = s; bi = k; }
    }
    const cd = pool.splice(bi, 1)[0];
    out.push(cd);
    for (const id of cd.ids) use.set(id, (use.get(id) || 0) + 1);
  }
  return out;
}

/* ---- distinctness (D2) --------------------------------------------------
   Any piece differing makes two outfits distinct, so a second pair of shoes is
   a cheap way to buy options and the optimiser reaches for it on merit rather
   than because a hardcoded floor told it to. ⚠️ Selftest case 12 is what proves
   this holds on a Javea-shaped trip; if it goes red, D2 is wrong and needs the
   visible-core variant — do not paper over it with a per-slot minimum. */
function packDistinct(a, b) {
  return (a.ids || []).join(",") !== (b.ids || []).join(",");
}

// How many distinct valid outfits an occasion can make from a given pack.
function packOptionCount(occ, packIds, opts = {}) {
  const list = packCandidates(occ, [...packIds], { ...opts, all: true, pool: opts.packPool || null });
  const inside = list.filter(c => c.ids.every(id => packIds.has ? packIds.has(id) : packIds.includes(id)));
  const seen = new Set();
  for (const c of inside) seen.add(c.ids.join(","));
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
                     pinned = null, locked = null, restarts = PACK_RESTARTS, seed = null } = {}) {
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
  const candOpts = { pool, wxFor, seed: sd, limit: PACK_SOLVE_CANDIDATES };
  const legKeyOf = (o) => o.leg && o.leg.loc ? `${o.leg.loc.lat},${o.leg.loc.lon}` : "";
  const bandOf = (day) => {
    const w = day && wxFor ? wxFor(day) : null;
    return w && w.maxT != null ? Math.round(w.maxT / 8) : "x";
  };
  const groupKey = (o) => `${o.level}|${legKeyOf(o)}|${bandOf(o.date)}`;
  const reps = new Map();   // groupKey → a representative occasion
  for (const occ of dem) if (!reps.has(groupKey(occ))) reps.set(groupKey(occ), occ);
  const candByKey = new Map();
  for (const [k, rep] of reps) candByKey.set(k, packCandidates(rep, rackIds, candOpts));
  const cands = new Map();
  for (const occ of dem) cands.set(occ.id, candByKey.get(groupKey(occ)) || []);

  const rnd = packRng(sd);
  let best = null;

  /* The tightness dial governs REPETITION, not only option counts. D5 gave K the
     job of carrying variety, but K only guarantees options EXIST in the pack —
     it says nothing about whether consecutive days look different, which is the
     thing she'd actually notice. At Lean, wearing one sweater four days out of
     six is exactly right; at Cushion it is the whole complaint.
     ⚠️ PACK_REPEAT_DAY is deliberately NOT scaled: the identical outfit two days
     running is the worst-looking failure the solver can produce, so that floor
     holds at every tightness. */
  const repW = K <= PACK_OPTIONS.lean ? 0.5 : (K >= PACK_OPTIONS.cushion ? 2 : 1);

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
      const d = occ.date || "￿";
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
      // Scarcest first within a day — a dressy evening has fewer options than an
      // ordinary afternoon and should claim its pieces before the easy case does.
      const ord = occs.slice().sort((a, b) =>
        ((cands.get(a.id) || []).length - (cands.get(b.id) || []).length) || (rnd() - 0.5));

      for (const occ of ord) {
        if (lockedMap.has(occ.id)) {
          const lk = lockedMap.get(occ.id);
          chosen.set(occ.id, lk);
          for (const id of lk.ids) { pack.add(id); usedToday.add(id); }
          continue;
        }
        const list = cands.get(occ.id) || [];
        if (!list.length) {
          unmet.push({ occId: occ.id, date: occ.date, level: occ.level, reason: "nothing available covers this level" });
          continue;
        }
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
          const key = cd.ids.join(",");
          // A violation outweighs several new pieces: packing one more tee beats
          // wearing a dirty one, which is the whole reason she asked for this.
          const cost = over * 5000
            + (prevDayCombos.has(key) ? PACK_REPEAT_DAY : 0)
            + (usedCombos.has(key) ? PACK_REPEAT_ANY * repW : 0)
            + topRepeat * PACK_REPEAT_TOP * repW
            + added * 1000
            - prov * PACK_PROVEN_W
            - cd.score * PACK_SCORE_W
            + rnd() * 0.5;
          if (cost < bestCost) { bestCost = cost; pick = cd; }
        }
        chosen.set(occ.id, pick);
        const pickKey = pick.ids.join(",");
        if (prevDayCombos.has(pickKey)) repeatTally += 150;
        else if (usedCombos.has(pickKey)) repeatTally += 40;
        todayCombos.add(pickKey);
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
  const addPool = rackIds.filter(id => !pack.has(id))
    .sort((a, b) => (proven.has(b) - proven.has(a)) || (rackWarmth(b) - rackWarmth(a)) || (a < b ? -1 : 1));

  for (const occ of groups.values()) {
    let have = packOptionCount(occ, pack, candOpts);
    let guard = 0;
    while (have < K && guard++ < PACK_OPT_GUARD) {
      let bestAdd = null, bestGain = 0;
      for (const id of addPool.slice(0, PACK_ADD_TRIES)) {
        if (pack.has(id)) continue;
        pack.add(id);
        const gain = packOptionCount(occ, pack, candOpts) - have;
        pack.delete(id);
        if (gain > bestGain) { bestGain = gain; bestAdd = id; }
      }
      if (!bestAdd) break;
      pack.add(bestAdd);
      have += bestGain;
    }
  }

  const byKey = new Map();
  for (const occ of groups.values()) byKey.set(groupKey(occ), packOptionCount(occ, pack, candOpts));
  const options = new Map();
  for (const occ of dem) options.set(occ.id, byKey.get(groupKey(occ)) || 0);
  const sched = packSchedule(assignOf(dem, best.chosen), { dates: days, ls: lst, washDays });

  return {
    pack: [...pack],
    assign: best.chosen,
    options,
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
  const slate = packSlate(c, { character: packCharacter(c.id), wearRows });
  const demand = packDemand(slate);
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
// A stamp over everything a solve depended on, so re-entry can say what moved.
function packSlateHash(demand) {
  return packHash((demand || []).map(o => `${o.id}:${o.level}:${o.context || ""}`).join("|"));
}
// Rehydrate the stored assignment into the {ids, pieces, score} shape the rest
// of the module speaks. Drops pieces that no longer exist.
function packAssignFromRecord(cid) {
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
let _packView = "days";      // "days" | "bag"
let _packState = null;       // { cid, slate, demand, rack, res } for the open screen
let _packBusy = false;

// Rebuild the derivations for the open capsule, reusing the stored solve.
function packLoadState(cid, { resolve = false, K = null } = {}) {
  const c = capsuleById.get(cid);
  if (!c) return null;
  const rec = packRecord(cid);
  const character = packCharacter(cid);
  const slate = packSlate(c, { character });
  const demand = packDemand(slate);
  const rack = packRack(c, slate, { wxFor: packWxFor(c) });
  const kk = K != null ? K : (rec.K || PACK_OPTIONS.normal);
  let res;
  if (!resolve && rec.built && Object.keys(rec.assign || {}).length) {
    // Reuse the stored pack — the solve is an event. Options and the schedule
    // are recomputed because they're cheap and depend on current laundry.
    const assign = packAssignFromRecord(cid);
    const pack = new Set(rec.pieces || []);
    const options = new Map();
    for (const occ of demand) options.set(occ.id, packOptionCount(occ, pack, { wxFor: packWxFor(c) }));
    const sched = packSchedule(assignOf(demand, assign), { dates: tripDates(c), washDays: packWashDays(c) });
    res = { pack: [...pack], assign, options, unmet: rec.unmet || [], violations: sched.violations,
            stats: { pieces: pack.size, outfits: packOutfitCount(pack, demand), legs: rack.legs } };
  } else {
    res = packSolve({ c, demand, rack, wxFor: packWxFor(c), K: kk,
                      washDays: packWashDays(c), pinned: rec.pinned, locked: packLockedFromRecord(cid) });
  }
  _packState = { cid, c, slate, demand, rack, res, K: kk };
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
  _packView = "days";
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
  if (resolve) await packPersist(cid);
  renderCapsules();
}

// Commit the open solve: the record, then capsule_items.
async function packPersist(cid) {
  const st = _packState;
  if (!st || st.cid !== cid) return;
  const assign = {};
  for (const [occId, cd] of st.res.assign) assign[occId] = cd.ids;
  const rec = packRecord(cid);
  await savePackRecord(cid, {
    built: todayStr(), K: st.K, seed: st.res.stats.seed || rec.seed || null,
    slateHash: packSlateHash(st.demand), pieces: st.res.pack, assign,
    unmet: st.res.unmet, locked: [...(packLockedFromRecord(cid).keys())],
    pinned: rec.pinned || [], character: packCharacter(cid) || null,
  });
  await packSyncMembers(cid, st.res.pack);
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
  if (add.length) await addItemsToCapsule(cid, add);
  if (drop.length) {
    const inList = `(${drop.map(id => `"${id}"`).join(",")})`;
    await rest(`/capsule_items?capsule_id=eq.${cid}&item_id=in.${inList}`, { method: "DELETE" });
    capsuleLinks = capsuleLinks.filter(l => !(l.capsule_id === cid && drop.includes(l.item_id)));
    buildCapsuleIndexes();
  }
}

function renderCapsulePack() {
  const st = _packState && _packState.cid === capsuleId ? _packState : packLoadState(capsuleId);
  const c = capsuleById.get(capsuleId);
  if (!st || !c) return capToolbar("Pack", true) + `<div class="placeholder"><b>No trip</b></div>`;
  const { demand, res, rack } = st;
  const kName = Object.entries(PACK_OPTIONS).find(([, v]) => v === st.K);

  const legNote = res.stats.legs > 1 ? ` · ${res.stats.legs} legs` : "";
  const wxNote = packWxFor(c) ? "" : ` · no weather loaded`;
  /* ⚠️ Say ONCE, plainly, that a far-out trip was packed against climatology
     rather than a forecast. The per-day chip already carries a terse "avg", but
     for a September trip planned in July EVERY day says it, and a label repeated
     fifteen times is a label she stops seeing. The r19 lesson is that the guess
     itself is fine and an unlabelled guess is not — so name it where she reads
     the summary, in the spec's own words ("typical for", never "forecast"). */
  const histNote = (() => {
    const wxFor = packWxFor(c);
    if (!wxFor) return "";
    const days = tripDates(c).map(d => wxFor(d)).filter(w => w && w.maxT != null);
    if (!days.length || !days.every(w => w.hist)) return "";
    const mid = tripDates(c)[Math.floor(tripDates(c).length / 2)];
    const month = new Date(mid + "T00:00:00").toLocaleDateString(undefined, { month: "long" });
    const half = +mid.slice(8) <= 15 ? "early" : "mid-to-late";
    return `<div class="pack-warn-note" style="margin-top:8px">🌡 Packed for weather <b>typical for ${esc(half)} ${esc(month)}</b> — this trip is beyond the forecast range, so these are normals, not a forecast.</div>`;
  })();
  const head = `<div class="cap-insight">
    <div class="kpi-row">
      <div class="kpi-cell"><div class="kpi-val">${res.stats.pieces}</div><div class="kpi-lbl">pieces</div></div>
      <div class="kpi-cell"><div class="kpi-val">${res.stats.outfits}</div><div class="kpi-lbl">outfits they make</div></div>
    </div>
    <div class="cap-cov-lbl" style="margin-top:10px">${demand.length} occasion${demand.length === 1 ? "" : "s"} over ${tripDates(c).length} day${tripDates(c).length === 1 ? "" : "s"}${legNote}${wxNote}</div>
    ${histNote}
  </div>`;

  // ⚠️ Honest partial (TRIP_BUILDER.md §9): a pack that covers 8 of 10 must SAY
  // so, with dates and reasons. Silently returning the smaller pack is the r12
  // "looked like a partial result" bug in a new feature.
  const gaps = packGaps(demand, rack.ids, { wxFor: packWxFor(c) });
  const unmetHtml = res.unmet.length ? `<div class="pack-warn">
    <b>${demand.length - res.unmet.length} of ${demand.length} occasions covered.</b>
    ${res.unmet.map(u => {
      const g = gaps.find(x => x.occId === u.occId);
      const near = g && g.nearest ? ` — nearest you can dress is ${OCCASION_LADDER[g.nearest - 1]}` : "";
      const occ = demand.find(o => o.id === u.occId);
      return `<div>${esc(planDayLabel(u.date))}${occ && occ.context ? ` · ${esc(occ.context)}` : ""} (${esc(OCCASION_LADDER[(u.level || 1) - 1] || "level " + u.level)})${esc(near)}</div>`;
    }).join("")}
    <div class="pack-warn-note">Reported, not fixed — nothing here is a suggestion to buy anything.</div>
  </div>` : "";

  const violHtml = res.violations.length ? `<div class="pack-warn soft">
    ${res.violations.slice(0, 4).map(v => `<div>🧺 ${esc(planDayLabel(v.date))} — ${esc(v.name)} would be its ${ordinal(v.nth)} wear (washes every ${v.tol})</div>`).join("")}
    ${res.violations.length > 4 ? `<div>…and ${res.violations.length - 4} more</div>` : ""}
    <div class="pack-warn-note">Set a laundry day on the by-day planner, or add a piece.</div>
  </div>` : "";

  /* Consequences of her own edits, surfaced on both tabs. packConsequences was
     computed and only the drop path read it, so a swap that stranded a piece —
     or that broke a later day — said nothing at all until she went looking.
     ⚠️ "Broken" is the one that matters and it carries a DATE, same rule as the
     schedule: an edit that costs her Thursday should name Thursday. */
  const cons = packConsequences(st);
  const trueOrphans = cons.orphans.filter(id => {
    const s = packOptionsForPiece(st, id);
    return !s || !s.size;
  });
  const consHtml = (cons.broken.length || trueOrphans.length) ? `<div class="pack-warn soft">
    ${cons.broken.length ? `<div>⚠︎ <b>${cons.broken.length} day${cons.broken.length === 1 ? "" : "s"} lost a piece</b> — ${esc(cons.broken.slice(0, 3).map(b => planDayLabel(b.date)).join(", "))}${cons.broken.length > 3 ? "…" : ""}</div>` : ""}
    ${trueOrphans.length ? `<div>${trueOrphans.length} packed piece${trueOrphans.length === 1 ? "" : "s"} not in any outfit — see the Bag tab</div>` : ""}
    ${cons.broken.length ? `<div class="pack-warn-note">Nothing re-solved on its own. Fix just those days, or leave them.</div>` : ""}
  </div>` : "";

  const wash = packWashPlan(res.pack, { startDate: c.start_date });
  const washHtml = (wash.hamper.length || wash.underTol.length) ? `<div class="pack-warn soft">
    ${wash.hamper.length ? `<div>🧺 <b>${wash.hamper.length} in the hamper</b> — ${esc(wash.hamper.slice(0, 3).map(i => i.name || "Untitled").join(", "))}${wash.hamper.length > 3 ? "…" : ""}</div>` : ""}
    ${wash.underTol.length ? `<div>${wash.underTol.length} piece${wash.underTol.length === 1 ? " is" : "s are"} one wear from the hamper</div>` : ""}
    ${wash.lastUsefulWashDay ? `<div class="pack-warn-note">Last wash that still helps: ${esc(fmtDate(wash.lastUsefulWashDay))}</div>` : ""}
  </div>` : "";

  const bulky = packBulkyAdvice(res.pack);
  const bulkyHtml = bulky.length ? `<div class="pack-tip">👞 Wear the ${esc(bulky.map(i => i.name || i.subcategory).join(" / "))} rather than packing ${bulky.length === 1 ? "it" : "them"}.</div>` : "";

  const tabs = `<div class="cap-orgbar">
    <div class="cap-seg">
      <button data-packview="days" class="${_packView === "days" ? "on" : ""}">Days</button>
      <button data-packview="bag" class="${_packView === "bag" ? "on" : ""}">Bag</button>
    </div>
    <button class="cap-chip" data-pack-tight>${kName ? kName[0] : "normal"} ✎</button>
  </div>`;

  const body = _packView === "days" ? packDaysHtml(st) : packBagHtml(st);

  return capToolbar(c.name + " · Pack", true) + `
    <div class="cap-hdr">
      <div class="ch-name">The pack</div>
      <div class="ch-sub">${esc(capDateLabel(c) || "no dates")}${packCharacter(capsuleId) ? " · " + esc(packCharacter(capsuleId)) : ""}</div>
    </div>
    ${head}${unmetHtml}${consHtml}${violHtml}${washHtml}${bulkyHtml}${tabs}${body}
    <div class="pack-footer">
      <button class="cap-plan" data-pack-resolve style="background:var(--accent)">
        <svg viewBox="0 0 24 24"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
        ✨ Re-solve the unlocked days
      </button>
      <button class="cap-plan sec" data-pack-toplan style="margin-top:8px">
        <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>
        Send these to the by-day plan
      </button>
      <div class="pack-warn-note" style="padding:8px 16px 30px">Editing never re-solves anything you didn't ask it to. Whatever you touch is locked.</div>
    </div>`;
}

function packDaysHtml(st) {
  const { c, slate, demand, res } = st;
  const rec = packRecord(st.cid);
  const lockedSet = new Set(rec.locked || []);
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
    const cards = occs.map(occ => {
      const cd = res.assign.get(occ.id);
      const opts = res.options.get(occ.id) || 0;
      const unmet = res.unmet.some(u => u.occId === occ.id);
      const labels = [occ.context, ...(occ.alsoFor || []).map(o => o.context)].filter(Boolean);
      const label = labels.length ? labels.join(" + ") : (OCCASION_LADDER[(occ.level || 1) - 1] || "Something");
      // Merged contexts can sit at different levels; name the dressiest, since
      // that's the one the outfit had to clear.
      const topLvl = Math.max(occ.level || 1, ...(occ.alsoFor || []).map(o => o.level || 1));
      const lvl = OCCASION_LADDER[topLvl - 1] || "";
      if (unmet || !cd) {
        return `<div class="pack-occ gap">
          <div class="pack-occ-hd"><b>${esc(label)}</b><span>${esc(lvl)}</span></div>
          <div class="pack-occ-gap">Nothing available covers this.</div>
        </div>`;
      }
      const pieces = cd.pieces.length ? cd.pieces : cd.ids.map(id => itemById.get(id)).filter(Boolean);
      return `<div class="pack-occ${lockedSet.has(occ.id) ? " locked" : ""}">
        <div class="pack-occ-hd">
          <b>${esc(label)}</b>
          <span>${esc(lvl)}${packOptLabel(opts)}${lockedSet.has(occ.id) ? " · 🔒" : ""}</span>
        </div>
        <div class="pack-pieces">
          ${pieces.map(i => `<button class="pack-piece" data-pack-swap="${esc(i.id)}" data-pack-occ="${esc(occ.id)}">
            ${thumbHtml(i.image_path, "pack-pthumb")}
            <div class="pack-pname">${esc(i.name || "Untitled")}</div>
          </button>`).join("")}
        </div>
        <div class="pack-occ-acts">
          <button class="plan-act" data-pack-reroll="${esc(occ.id)}">✨ Another</button>
          ${opts > 1 ? `<button class="plan-act" data-pack-options="${esc(occ.id)}">Other options</button>` : ""}
          <button class="plan-act" data-pack-lock="${esc(occ.id)}">${lockedSet.has(occ.id) ? "Unlock" : "🔒 Lock"}</button>
        </div>
      </div>`;
    }).join("");
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

function packBagHtml(st) {
  const { res, demand, c } = st;
  const links = capsuleLinkMap.get(st.cid) || [];
  const packedSet = new Set(links.filter(l => l.packed).map(l => l.item_id));
  const list = res.pack.map(id => itemById.get(id)).filter(Boolean);
  // Grouped by subcategory in taxonomy order — the order she packs in, and the
  // "how many of each" answer she originally asked for (D1).
  const order = [];
  for (const cat of CATEGORIES) for (const sub of (TAXONOMY[cat] || [])) order.push(cat + "/" + sub);
  const groups = new Map();
  for (const i of list) {
    const k = (i.category || "?") + "/" + (i.subcategory || "Other");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  /* ⚠️ DAYS and labels, tracked separately. Counting occasions here said
     "needs a wash mid-trip" for a tee used twice on ONE day, while the schedule
     — which counts (item, day) — correctly found no violation. The bag line and
     the schedule must never disagree; that is the countByDay rule again. */
  const usedBy = new Map();   // itemId → {days:Set<date>, labels:Set<string>}
  for (const occ of demand) {
    const cd = res.assign.get(occ.id);
    if (!cd) continue;
    for (const id of cd.ids) {
      let u = usedBy.get(id);
      if (!u) usedBy.set(id, u = { days: new Set(), labels: new Set() });
      if (occ.date) u.days.add(occ.date);
      u.labels.add(occ.context || OCCASION_LADDER[(occ.level || 1) - 1] || "day");
    }
  }
  const optionFor = packOptionMap(st);
  const body = keys.map(k => {
    const arr = groups.get(k);
    const sub = k.split("/")[1];
    return `<div class="pack-grp">
      <div class="pack-grp-hd"><div class="t">${esc(sub)}</div><div class="n">${arr.length}</div></div>
      ${arr.map(i => {
        const on = packedSet.has(i.id);
        const why = packWhyLine(i, usedBy.get(i.id), c, optionFor.get(i.id));
        return `<div class="pack-bagrow${on ? " on" : ""}">
          <button class="pack-tick" data-pack-tick="${esc(i.id)}" aria-label="Packed">${on ? "✓" : ""}</button>
          ${thumbHtml(i.image_path, "pack-pthumb")}
          <div class="pack-baginfo">
            <div class="pack-bagname">${esc(i.name || "Untitled")}</div>
            <div class="pack-bagwhy">${esc(why)}</div>
          </div>
          <button class="pack-drop" data-pack-drop="${esc(i.id)}" aria-label="Remove from pack">×</button>
        </div>`;
      }).join("")}
    </div>`;
  }).join("");
  const leftOut = packLeftOut(c, res.pack);
  const leftHtml = leftOut.length ? `<div class="pack-grp">
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
  </div>` : "";
  return `<div class="pack-bag">${body}${leftHtml}
    <button class="cap-plan sec" data-pack-addany style="margin-top:10px">＋ Bring something else</button></div>`;
}

/* Which occasions each packed piece buys an ALTERNATIVE for.

   Stage B adds pieces purely to raise the option count, and those bag rows used
   to read "another option" — true, and too thin to act on. Naming the occasion
   is the difference between a line she reads and one she learns to skip. A piece
   in no combo at all is a genuine orphan, and both surfaces say so.

   ONE derivation, two surfaces (the bag rows and the header's orphan count) —
   the same rule tripRecapData follows. Enumerated once per LEVEL over the pack,
   which is 10–20 pieces, so it's cheap; memoised on the pack contents so a
   re-render during editing doesn't pay for it twice. */
let _packOptMemo = null;
function packOptionMap(st) {
  const { c, demand, res } = st;
  const stamp = `${st.cid}|${res.pack.slice().sort().join(",")}`;
  if (_packOptMemo && _packOptMemo.stamp === stamp) return _packOptMemo.map;
  const packSet = new Set(res.pack);
  const wxFor = packWxFor(c);
  const levelLabels = new Map();   // level → Set(label)
  const repOf = new Map();         // level → representative occasion
  for (const occ of demand) {
    if (!repOf.has(occ.level)) repOf.set(occ.level, occ);
    let s = levelLabels.get(occ.level);
    if (!s) levelLabels.set(occ.level, s = new Set());
    s.add(occ.context || OCCASION_LADDER[(occ.level || 1) - 1] || "day");
  }
  const map = new Map();
  for (const [lvl, occ] of repOf) {
    for (const cd of packCandidates(occ, res.pack, { wxFor, all: true })) {
      if (!cd.ids.every(id => packSet.has(id))) continue;
      for (const id of cd.ids) {
        let s = map.get(id);
        if (!s) map.set(id, s = new Set());
        for (const lbl of (levelLabels.get(lvl) || [])) s.add(lbl);
      }
    }
  }
  _packOptMemo = { stamp, map };
  return map;
}
const packOptionsForPiece = (st, id) => packOptionMap(st).get(id) || null;

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
  const byKey = new Map();
  for (const occ of demand) {
    const k = `${occ.level}`;
    if (!byKey.has(k)) byKey.set(k, packOptionCount(occ, pack, { wxFor }));
    res.options.set(occ.id, byKey.get(k));
  }
  const cons = packConsequences(st);
  res.violations = cons.violations;
  res.stats.pieces = pack.size;
  res.stats.outfits = packOutfitCount(pack, demand, { wxFor });
  return cons;
}
function packRepack(st) {
  const pack = new Set(packRecord(st.cid).pinned || []);
  for (const cd of st.res.assign.values()) for (const id of cd.ids) pack.add(id);
  for (const id of (st.res.extras || [])) pack.add(id);
  st.res.pack = [...pack];
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
    i && i.id !== pieceId && itemStatus(i) === "Available" && i.image_path && !isNoSuggest(i) &&
    (suggestSlot(i) === slot || (slot === "Outerwear" && isLayer(i) && i.category === "Tops")) &&
    (occ.level === 1 ? isFunctionWear(i) : (itemFormalitySet(i) || []).includes(occ.level)) &&
    inSeasonWx(i, season, wx) &&
    !others.some(o => isExcluded(i.id, o.id)))
    .sort((a, b) => rackWarmth(b.id) - rackWarmth(a.id) || (a.id < b.id ? -1 : 1))
    .slice(0, 18);
}

function openPackSwapSheet(occId, pieceId) {
  const st = _packState;
  if (!st) return;
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
  const st = _packState;
  if (!st) return;
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
  const st = _packState;
  if (!st || _packBusy) return;
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
  const st = _packState;
  if (!st) return;
  const occ = st.demand.find(o => o.id === occId);
  if (!occ) return;
  const inPack = new Set(st.res.pack);
  const cur = st.res.assign.get(occId);
  const list = packCandidates(occ, st.res.pack, { wxFor: packWxFor(st.c), all: true })
    .filter(x => x.ids.every(id => inPack.has(id))).slice(0, 12);
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

async function packToggleLock(occId) {
  const st = _packState;
  if (!st) return;
  const rec = packRecord(st.cid);
  const set = new Set(rec.locked || []);
  if (set.has(occId)) set.delete(occId); else set.add(occId);
  await savePackRecord(st.cid, { locked: [...set] });
  renderCapsules();
}

/* Remove a piece. Days that depended on it BREAK and are flagged with dates —
   the app never silently re-solves around her edit. */
async function packDropPiece(itemId) {
  const st = _packState;
  if (!st) return;
  const it = itemById.get(itemId);
  st.res.pack = st.res.pack.filter(id => id !== itemId);
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
  st.res.extras = (st.res.extras || []).concat([itemId]);
  const rec = packRecord(st.cid);
  await savePackRecord(st.cid, { pinned: [...new Set((rec.pinned || []).concat([itemId]))] });
  packRefresh(st);
  await packPersist(st.cid);
  renderCapsules();
  toast(`${it.name || "Piece"} is in the bag`);
}

function openPackAddSheet() {
  const st = _packState;
  if (!st) return;
  const inPack = new Set(st.res.pack);
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
      b.onclick = () => { hideSheet("logSheet"); packAddPiece(b.dataset.packadd); };
    });
  };
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="packAddCancel">Cancel</button>
      <h2>Bring something</h2>
      <span style="width:54px"></span>
    </div>
    <div style="padding:8px 16px"><input class="inp" id="packAddQ" placeholder="Search your closet…"></div>
    <div id="packAddResults" style="padding:0 0 30px"></div>`;
  showSheet("logSheet");
  render();
  $("#packAddCancel").onclick = () => hideSheet("logSheet");
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

function openPackTightSheet() {
  const st = _packState;
  if (!st) return;
  const rows = Object.entries(PACK_OPTIONS).map(([name, v]) => `<button class="sheet-row" data-packk="${v}">
    <span>${esc(name[0].toUpperCase() + name.slice(1))}</span>
    <span class="rt" style="color:${st.K === v ? "var(--accent)" : "var(--muted)"};font-weight:${st.K === v ? "700" : "400"}">${v} option${v === 1 ? "" : "s"} per occasion${st.K === v ? " ✓" : ""}</span>
  </button>`).join("");
  $("#moveInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="packKCancel">Cancel</button>
      <h2>How much to bring</h2>
      <span style="width:54px"></span>
    </div>
    <div class="sheet-note">Options per occasion, not spare pieces — a second choice for a day is what actually makes a bag feel roomy.</div>
    ${rows}`;
  showSheet("moveSheet");
  $("#packKCancel").onclick = () => hideSheet("moveSheet");
  $("#moveInner").querySelectorAll("[data-packk]").forEach(b => {
    b.onclick = async () => {
      hideSheet("moveSheet");
      _packBusy = true;
      try {
        const cid = capsuleId;
        await savePackRecord(cid, { K: +b.dataset.packk });
        packLoadState(cid, { resolve: true, K: +b.dataset.packk });
        await packPersist(cid);
        renderCapsules();
        toast(`${_packState.res.stats.pieces} pieces → ${_packState.res.stats.outfits} outfits`);
      } finally { _packBusy = false; }
    };
  });
}

/* Materialise the assignments as real looks in capsules.plan, so trip mode opens
   ready. Explicit, because it creates outfit records. */
async function packSendToPlan() {
  const st = _packState;
  if (!st || _packBusy) return;
  if (!confirm(`Save ${st.res.assign.size} outfits to the by-day plan? They become real looks you can wear-log.`)) return;
  _packBusy = true;
  try {
    let n = 0;
    for (const occ of st.demand) {
      const cd = st.res.assign.get(occ.id);
      if (!cd || !occ.date) continue;
      const pieces = cd.ids.map(id => itemById.get(id)).filter(Boolean);
      if (pieces.length < 2) continue;
      const oid = await saveComboAsOutfit(pieces);
      if (oid) { await addPlanLook(st.cid, occ.date, oid); n++; }
    }
    toast(`${n} outfit${n === 1 ? "" : "s"} in the by-day plan`);
  } catch (e) { toast(e.message); }
  finally { _packBusy = false; }
}

/* ===================================================================
   RE-ENTRY — the diff is the artifact (TRIP_BUILDER.md §8).
   The second and third visits are the common case, not the first.
   =================================================================== */
function packDiff(cid) {
  const rec = packRecord(cid);
  if (!rec.built) return null;
  const c = capsuleById.get(cid);
  if (!c) return null;
  const slate = packSlate(c, { character: packCharacter(cid) });
  const demand = packDemand(slate);
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
function packCharChipsHtml(cid) {
  const cur = packCharacter(cid);
  return `<div class="pack-chiprow">${PACK_CHARACTERS.map(ch =>
    `<button class="cap-chip${cur === ch ? " on" : ""}" data-packchar="${esc(ch)}">${esc(ch)}</button>`).join("")}</div>`;
}

function openPackBuildSheet(cid) {
  const c = capsuleById.get(cid);
  if (!c) return;
  const character = packCharacter(cid);
  const seed = packOccasionSeed(character, {});
  const slate = packSlate(c, { character });
  const demand = packDemand(slate);
  const rec = packRecord(cid);
  const K = rec.K || PACK_OPTIONS.normal;
  const washDays = packWashDays(c);
  const guessNote = seed.source === "history"
    ? `From your last ${seed.trips} ${esc(character || "")} trip${seed.trips === 1 ? "" : "s"}.`
    : seed.source === "seed"
      ? `A starting guess for a ${esc(character || "trip")} — correct it on the by-day planner.`
      : `Built from your weekday habits — set a character to sharpen it.`;
  const byCtx = new Map();
  for (const o of demand) {
    const k = o.context || (OCCASION_LADDER[(o.level || 1) - 1] || "day");
    byCtx.set(k, (byCtx.get(k) || 0) + 1);
  }
  const mixRows = [...byCtx.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) =>
    `<div class="pack-mixrow"><span>${esc(k)}</span><b>×${n}</b></div>`).join("");
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="packBuildCancel">Cancel</button>
      <h2>Build the pack</h2>
      <span style="width:54px"></span>
    </div>
    <div style="padding:4px 16px 0">
      <div class="fld">What kind of trip</div>
      ${packCharChipsHtml(cid)}
      <div class="fld" style="margin-top:14px">What's happening · ${demand.length} occasion${demand.length === 1 ? "" : "s"}</div>
      <div class="pack-mix">${mixRows}</div>
      <div class="pack-warn-note" style="padding:6px 0">${guessNote} Days you've declared events for win.</div>
      <div class="fld" style="margin-top:14px">Laundry</div>
      <div class="pack-warn-note" style="padding:2px 0 6px">${washDays.length
        ? `Washing on ${esc(washDays.map(d => fmtDate(d)).join(", "))} — set on the by-day planner.`
        : `No wash planned. Set a laundry day on the by-day planner if you'll have one.`}</div>
      <div class="fld" style="margin-top:8px">How much to bring</div>
      <div class="pack-chiprow">${Object.entries(PACK_OPTIONS).map(([name, v]) =>
        `<button class="cap-chip${K === v ? " on" : ""}" data-packbk="${v}">${esc(name)}</button>`).join("")}</div>
      <button class="btn" id="packBuildGo" style="margin:18px 0 8px">✨ Build the pack</button>
      <div class="pack-warn-note" style="padding:0 0 24px">${(c.locations || []).length
        ? `Weather comes from your locations — beyond about two weeks out it's a typical-for-the-date average, not a forecast.`
        : `⚠️ No locations set, so this will pack for the season only. Add one on the trip page for real weather.`}</div>
    </div>`;
  showSheet("logSheet");
  $("#packBuildCancel").onclick = () => hideSheet("logSheet");
  $("#logInner").querySelectorAll("[data-packchar]").forEach(b => {
    b.onclick = async () => { await setPackCharacter(cid, b.dataset.packchar === packCharacter(cid) ? null : b.dataset.packchar); openPackBuildSheet(cid); };
  });
  $("#logInner").querySelectorAll("[data-packbk]").forEach(b => {
    b.onclick = async () => { await savePackRecord(cid, { K: +b.dataset.packbk }); openPackBuildSheet(cid); };
  });
  $("#packBuildGo").onclick = async () => {
    hideSheet("logSheet");
    await openPackPlan(cid, { resolve: true });
    const st = _packState;
    if (st) toast(`${st.res.stats.pieces} pieces → ${st.res.stats.outfits} outfits`);
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
function openCapAnchorSheet() {
  const opts = contextOptions();
  let date = _capForm && _capForm.start_date ? _capForm.start_date : todayStr();
  const render = () => {
    $("#moveInner").innerHTML = `
      <div class="sheet-hdr">
        <button class="lnk" id="capAnchCancel">Cancel</button>
        <h2>Fixed event</h2>
        <span style="width:54px"></span>
      </div>
      <div style="padding:8px 16px">
        <label class="fld">Date</label>
        <input class="inp" type="date" id="capAnchDate" value="${esc(date)}">
        <label class="fld" style="margin-top:12px">What is it</label>
      </div>
      ${opts.map(o => `<button class="sheet-row" data-capanch="${esc(o)}">
        <span>${esc(o)}</span>
        <span class="rt">${esc(OCCASION_LADDER[(contextFormalityLevel(o) || CONTEXT_FORMALITY_SEED[o] || 3) - 1] || "")}</span>
      </button>`).join("")}`;
    $("#capAnchCancel").onclick = () => hideSheet("moveSheet");
    const di = $("#capAnchDate"); if (di) di.onchange = () => { date = di.value; };
    $("#moveInner").querySelectorAll("[data-capanch]").forEach(b => {
      b.onclick = () => {
        const d = $("#capAnchDate");
        const useDate = (d && d.value) || date;
        if (!useDate) { toast("Pick a date"); return; }
        _capForm.anchors = (_capForm.anchors || []).concat([{ date: useDate, context: b.dataset.capanch }]);
        hideSheet("moveSheet");
        renderCapsules();
      };
    });
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
