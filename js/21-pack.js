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

  // ② her weekday rhythm, for days she didn't declare
  for (const s of slate) {
    if (s.occasions.length) continue;
    const r = rhythmFor(s.date, rhy);
    const ctxs = (r && r.contexts || []).filter(x => x !== TRIP_CONTEXT);
    if (!ctxs.length) continue;
    s.occasions.push({ context: ctxs[0], contexts: ctxs, level: lvlOf(ctxs[0]), placed: false, source: "rhythm" });
  }

  /* ③ the character mix, as a TARGET COUNT across the trip.
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
    for (const s of slate) {
      if (need <= 0) break;
      if (has(s)) continue;
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

  /* Travel days. ⚠️ This is also what enforces the travel-home reserve: because
     the return day always carries an occasion, the ordinary schedule walk
     detects a trip that burns its last clean bottoms on day 8. No special case
     needed — that is why there is no PACK_HOME_RESERVE constant. */
  for (const d of [dates[0], dates[dates.length - 1]]) {
    const s = byDate.get(d);
    if (!s) continue;
    if (!s.occasions.some(o => (o.contexts || []).includes(TRIP_CONTEXT))) {
      s.occasions.push({ context: TRIP_CONTEXT, contexts: [TRIP_CONTEXT], level: lvlOf(TRIP_CONTEXT), placed: true, source: "travel" });
    }
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

    for (const [date, occs] of grouped) {
      if (washSet.has(date)) { counts.clear(); washed = true; }
      const usedToday = new Set();
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
          let added = 0, over = 0, prov = 0;
          for (const id of cd.ids) {
            if (!pack.has(id)) added++;
            if (proven.has(id)) prov++;
            const it = itemById.get(id);
            const tol = it ? wearTolerance(it) : Infinity;
            // usedToday: the same piece in two of today's outfits is ONE wear-day.
            if (tol === Infinity || usedToday.has(id)) continue;
            if (seedOf(id, it) + 1 > tol) over++;
          }
          // A violation outweighs several new pieces: packing one more tee beats
          // wearing a dirty one, which is the whole reason she asked for this.
          const cost = over * 5000 + added * 1000 - prov * 20 - cd.score + rnd() * 0.5;
          if (cost < bestCost) { bestCost = cost; pick = cd; }
        }
        chosen.set(occ.id, pick);
        for (const id of pick.ids) { pack.add(id); usedToday.add(id); }
      }

      // Commit the day: one wear-day per distinct piece, however many outfits.
      for (const id of usedToday) {
        const it = itemById.get(id);
        if (!it || wearTolerance(it) === Infinity) continue;
        counts.set(id, seedOf(id, it) + 1);
      }
    }

    const sched = packSchedule(assignOf(dem, chosen), { dates: days, ls: lst, washDays });
    const scoreOf = unmet.length * 1e6 + sched.violations.length * 1e4 + pack.size;
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
