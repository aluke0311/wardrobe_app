/* ===================================================================
   THE RACK  (2026-07-26; three bands + rotation 2026-08-03)

   A standing ~58-piece derived pool — "what's actually in play right now" —
   out of a 476-piece closet. The suggester draws from it by default (r7), the
   way capsule mode already does; that small-pool quality is the entire point,
   since the suggester is good in a capsule and a slot machine over the whole
   closet.

   WHY IT IS DERIVED AND NOT CURATED. Asked directly whether she'd sit down
   once a month and pick what's in play, she said she probably wouldn't, but
   might sometimes. So the app keeps the rack and she NUDGES it: pull a piece
   in, push one out, whenever she feels like it. Skip a month and nothing
   breaks. A feature with upkeep would be abandoned, so this one has none.

   ⚠️ THREE DELIBERATE CONFLICTS WITH OLDER LOCKED DECISIONS. She approved all
   three knowingly on 2026-07-26, on condition the narrowing stays visible and
   reversible:
     1. CLAUDE.md's suggestion rule is "rescue-only: widens the pool, never
        narrows it". The rack narrows. It is allowed to because it is a labelled
        chip with a count and a one-tap widen, not an invisible filter — the
        earlier narrowing that burned her (a December trip somewhere warm) was
        invisible.
     2. "By design there is NO unworn/last-worn weighting" in the suggester.
        The rack reintroduces recency — through pool construction rather than
        scoring.
     3. Which creates a feedback loop: worn → on the rack → suggested → worn.
        Left alone that shrinks her working wardrobe over years, i.e. the mirror
        would cause the thing it measures. The DORMANT band is the answer and is
        LOAD-BEARING, not a nicety. Do not "optimise" it away.

   ── THREE BANDS (2026-08-03) ────────────────────────────────────────────
   Her question, and it was the right one: "what about pieces that are
   moderately worn? Not warm or cold?"

   The original split was binary at RACK_WARM_DAYS (60): worn inside 60 days →
   warm list, outside → cold list. But the warm list was then CUT TO QUOTA, so a
   top worn five weeks ago was simultaneously too old to survive the warm cut
   and too recent to be eligible for the cold list at all. It reached the rack
   only by accident (slot backfill, formality top-up, or a pin) — and when it
   finally aged past 60 days it joined the BACK of the cold queue and stayed
   invisible. A dead zone on both sides of an arbitrary cliff; nothing about a
   garment changes on day 60.

   So the band that actually exists is named:
     · rotation — top N by recency. Stable week to week; this is what makes the
       rack recognisable, and it does NOT rotate.
     · steady   — worn inside RACK_WARM_DAYS but below the rotation cut. The
       middle of the wardrobe, which is most of it.
     · dormant  — not worn inside RACK_WARM_DAYS (or never worn). Rediscovery.

   ── ROTATION IS THE ORDERING (2026-08-03) ───────────────────────────────
   ⚠️ The cold band used to be sorted by all-time wearCount descending among
   pieces untouched for 60+ days. Both inputs are near-static — all-time counts
   barely move, and by definition these pieces are not being worn — so the SAME
   nine pieces came back every rebuild, forever, until one was worn or pushed
   out. The mechanism that exists to stop the rack calcifying had itself
   calcified, against a cold pool of several hundred pieces.

   The fix is one counter doing two jobs. `seen[id]` counts how many rebuilds a
   piece has been OFFERED in steady/dormant without being worn, and both queues
   are ordered least-offered-first. That guarantees turnover with no tuning: a
   piece that keeps being passed over sinks, and the next candidates get their
   turn. Past RACK_SEEN_LIMIT it also surfaces in the "worth a second look"
   list, which is the same signal read as a question rather than as an ordering.

   ⚠️ Only the ~26 steady+dormant slots rotate. The 32 rotation slots are
   ranked by recency and stay put, so the rack still looks like itself when she
   opens it. That trade — some recognisability for coverage of the middle — was
   made explicitly, and it is confined to the bands where nothing was being
   seen at all.

   ⚠️ THE LIKED BONUS IS A TIEBREAK, NOT A BAND-DECIDER (fixed 2026-08-03).
   `score()` used to be `warmth + (liked ? 0.15 : 0)` and the split was
   `score > 0` → warm, `score === 0` → cold. So a piece in a look she'd HEARTED
   but hadn't worn in 60 days scored 0.15: it landed in the warm list ranked
   below everything worn in the last ~51 days (so effectively never picked) AND
   was excluded from the cold list, where it would have ranked well. Her
   hearted-but-neglected pieces — precisely the ones rediscovery is for — were
   the ones systematically shut out of it. Liked now breaks ties WITHIN a band
   and never decides which band a piece is in.

   LAUNDRY IS DELIBERATELY IGNORED HERE. If dirty pieces fell off the rack it
   would churn daily and stop being a thing she can recognise. The suggester's
   own cleanOnly filter still applies on top, so a dirty piece is on the rack
   and simply isn't suggested today.
   =================================================================== */

const RACK_KEY = "rack";
/* ⚠️ THE STORED RACK HAD NO IDEA THE DERIVATION COULD CHANGE (2026-08-04 r2).

   Her report, the evening the off-level ceiling shipped: "I just refreshed after
   the update, and it still has lots of heels???" It did, and nothing was wrong
   with the ceiling — it never ran. `rackIsStale` asks four questions (is there a
   rack, is it the current format, is it a week old, has the season or a declared
   level changed) and none of them can see that the CODE that built it is not the
   code running now. So a rack built yesterday stays on screen, unchanged, for up
   to seven days after any change to how racks are built — and every deploy that
   touches this file silently ships nothing until the cadence catches up.

   Bump RACK_ALGO whenever buildRack's SELECTION changes (quotas, bands, shares,
   ceilings, ordering). Not for copy, not for the screen, not for a new reader.
   ⚠️ It is a STRUCTURAL trigger: it tops up coverage and must NOT spend a
   rotation tick or move the `built` anchor, exactly like a season flip — the
   r7 churn lesson. She should get the corrected rack on the next load, not a
   reshuffled one. */
const RACK_ALGO = 9;   // 9 = photoless pieces are eligible (2026-08-13)
/* Per-slot quotas, not a flat top-N: a 58-piece rack that happens to be 45 tops
   cannot build an outfit. Grown from 46 → 58 on 2026-08-03 at her request —
   "some weeks will have more contexts and formality levels" — with the extra 12
   going disproportionately to steady and dormant, which is where the coverage
   hole was. Formality top-ups take the real total toward 65. */
const RACK_SLOT_QUOTA_BASE = {
  Tops:      { rotation: 11, steady: 5, dormant: 4 },   // 20
  Bottoms:   { rotation: 8,  steady: 3, dormant: 3 },   // 14
  Dresses:   { rotation: 3,  steady: 2, dormant: 1 },   // 6
  Shoes:     { rotation: 6,  steady: 3, dormant: 2 },   // 11
  Outerwear: { rotation: 4,  steady: 2, dormant: 1 },   // 7
};
/* ⚠️ THE SIZE IS HERS NOW (2026-08-05, her report: "the rack feels too small for
   my real life"). 58 was a number I picked; how big a working wardrobe feels
   right is not something the app can derive. So it's a dial.

   It scales every band of every slot by one factor, which is what keeps the
   proportions — the slot quotas exist so a rack can BUILD an outfit, and the
   cold share is load-bearing (see the header). Scaling the whole object keeps
   both invariants at any size; letting her set per-slot numbers would not.
   ⚠️ Changing it changes SELECTION, so it's part of the staleness check — see
   rackStamp/rackIsStale, which now carry the size. It does NOT go through
   RACK_ALGO: a size change is hers and immediate, and bumping ALGO would make
   every OTHER stored rack in the world stale too. */
const RACK_SIZE_KEY = "wardrobe.rackSize";
const RACK_SIZE_MIN = 46, RACK_SIZE_MAX = 130, RACK_SIZE_DEFAULT = 58;
let _rackSizeOverride = null;   // set only while the Settings slider previews
function rackTargetSize() {
  if (_rackSizeOverride != null) return _rackSizeOverride;
  const v = +store.getItem(RACK_SIZE_KEY);
  if (!v || !isFinite(v)) return RACK_SIZE_DEFAULT;
  return Math.max(RACK_SIZE_MIN, Math.min(RACK_SIZE_MAX, Math.round(v)));
}
function setRackTargetSize(n) {
  store.setItem(RACK_SIZE_KEY, String(Math.max(RACK_SIZE_MIN, Math.min(RACK_SIZE_MAX, Math.round(+n || RACK_SIZE_DEFAULT)))));
}
/* The scaled quota. ⚠️ Every band keeps a floor of 1 — a slot that rounds to
   zero dormant would silently switch off rediscovery for that slot, which is
   the one thing the header says never to optimise away. */
/* What the dial actually buys, IN PIECES — the number the Settings label shows.
   Read off the scaled quota, not off the dial, because the per-band floors of 1
   mean small sizes round UP. Naming the real total is the honest version; "46"
   on a rack that will be 51 is the kind of small lie that erodes trust in every
   other number on the screen. */
function rackQuotaTotal2(size = null) {
  if (size != null) _rackSizeOverride = Math.max(RACK_SIZE_MIN, Math.min(RACK_SIZE_MAX, Math.round(size)));
  const q = rackSlotQuota();
  _rackSizeOverride = null;
  return Object.values(q).reduce((n, b) => n + b.rotation + b.steady + b.dormant, 0);
}
function rackSlotQuota() {
  const f = rackTargetSize() / RACK_SIZE_DEFAULT;
  if (Math.abs(f - 1) < 0.01) return RACK_SLOT_QUOTA_BASE;
  const out = {};
  for (const [slot, b] of Object.entries(RACK_SLOT_QUOTA_BASE)) {
    out[slot] = {
      rotation: Math.max(1, Math.round(b.rotation * f)),
      steady:   Math.max(1, Math.round(b.steady * f)),
      dormant:  Math.max(1, Math.round(b.dormant * f)),
    };
  }
  return out;
}
const RACK_COLD_SHARE = 0.20;   // ⚠️ dormant share — load-bearing, see header
const RACK_STEADY_SHARE = 0.25; // the middle band; rotation takes the remainder
const RACK_WARM_DAYS = 60;      // the rotation/steady vs dormant line
const RACK_REBUILD_DAYS = 7;    // stability is a feature; don't reshuffle daily
const RACK_PUSH_DAYS = 42;      // a push-out expires, so a summer no doesn't haunt October
const RACK_PUSH_LONG_DAYS = 120;// "not right now" from a reassessment — a season, not a month
const RACK_LOOKAHEAD_DAYS = 14; // how far ahead declared plans stock the rack
const RACK_RECENT_DAYS = 14;    // …and how far BACK a real wear keeps a piece in play
const RACK_LEVEL_MIN = 2;       // per core slot, per level she'll actually need
const RACK_SEEN_LIMIT = 3;      // offered this many rebuilds unworn → worth a second look
const RACK_SECOND_LOOK_DAYS = 14; // …AND in front of her this long. See rackPassedOver.
/* ⚠️ OFF-LEVEL CEILING (2026-08-04, her report: "I do feel that I have quite a
   lot of heels in the current rack, given that I don't dress up that often —
   one pair from steady and three in haven't-reached-for-lately").

   She was right, and the cause is structural rather than a bad number. The
   steady and dormant bands are queues ordered by how seldom a piece has been
   offered and how long it's been since she wore it — and a piece that only
   covers Dressed Up and Formal is, by construction, ALWAYS overdue. So the
   rediscovery half of a slot fills with exactly the pieces there is no upcoming
   day for. Four of eleven shoes were heels on a rack meant to dress an ordinary
   week.

   The ceiling caps how many steady+dormant picks per slot cover NONE of the
   levels in `rackNeededLevels()` — which is already declared upcoming plans
   UNIONED with the levels she habitually lives at, so a wedding in the planner
   still stocks the rack with heels the moment she declares it.

   ⚠️ It applies to steady + dormant ONLY. Rotation is what she has actually
   been reaching for, and if she wore heels last week they belong in play. The
   formality top-up is exempt too — that only ever adds pieces that DO cover a
   needed level.
   ⚠️ Never zero (Math.max(1, …)): rediscovering a dressy piece has to stay
   possible, it just can't take the whole band. And the backfill deliberately
   ignores the ceiling — a slot with nothing else to offer should be full rather
   than correct. */
const RACK_OFFLEVEL_SHARE = 0.2;
/* At or above this level, a piece that covers NOTHING else is dress-only — see
   the dressOnly filter in buildRack. 6 = Dressed Up, so a [6,7,8] gown is out
   and a [5,6] blazer (which also does a normal work day) stays. */
const RACK_DRESSY_FLOOR = 6;
/* The top of an ORDINARY day, in her own words (2026-08-06): "the rack should
   ONLY build levels 2, 3, 4, 5 unless I request other levels for the rack /
   plan future days". Read literally: nothing above this is stocked FOR unless a
   forward plan declares it. See the formality top-up in buildRack. */
const RACK_EVERYDAY_MAX = 5;

/* ⚠️ TRAVEL PLANS ARE NOT THE RACK'S BUSINESS (2026-08-06, her words: "rack
   should not consider travel plans — a planned formal event on a trip does not
   have anything to do with the rack").

   Booking a trip writes its anchor events STRAIGHT INTO `dayplan`
   (saveCapsuleForm), which is right for the pack solver and wrong here: one
   shower on holiday put level 6 into rackDeclaredLevels, and a declared level
   is the single exemption that lets a [6,8] piece past the dress-only filter.
   So an evening she'll spend a thousand miles away moved her dressiest clothes
   into the pool she gets dressed from AT HOME, for a fortnight — which is
   exactly the report "I'm still getting dressed up and formal pieces in the
   rack", from pieces that are explicitly nothing but 6 and 8.

   During the trip the suitcase IS the pool (see _suggPool's capsule branch), so
   a trip day is already answered by something else; reading it here only ever
   double-counts it.
   ⚠️ rackWarmth and rackForcedIds' lived half already skip PAST away days for
   the same reason. This is that audit finished on the forward half — the same
   "when you add a trigger, audit them all" lesson, arriving through dayplan. */
function rackHomeDate(d, away) {
  return !(away && away.length && awayRangeFor(d, away));
}
function rackAwayRanges() {
  return (typeof awayRanges === "function") ? awayRanges() : [];
}

/* A slot quota is either the banded object above or a plain number (the trip
   builder's PACK_TRIP_QUOTA is flat, and calibrating it per-band would be a
   second place to get the shares wrong). A number splits by the shares. */
function rackBands(q) {
  if (q && typeof q === "object") return q;
  const n = Math.max(1, +q || 0);
  const dormant = Math.max(1, Math.round(n * RACK_COLD_SHARE));
  const steady = Math.max(1, Math.round(n * RACK_STEADY_SHARE));
  return { rotation: Math.max(1, n - dormant - steady), steady, dormant };
}
const rackQuotaTotal = (q) => { const b = rackBands(q); return b.rotation + b.steady + b.dormant; };

// ---- stored state (kv "rack") ----
// { built, season, ids, rotation, steady, dormant, cold, seen: {id:n},
//   pinned: [...], pushed: {id: date | {d,n}} }
function rackState() {
  const v = kvData.get(RACK_KEY);
  return v && typeof v === "object" ? v : {};
}
/* ⚠️ A PIN EXPIRES, AND THAT'S THE ANSWER TO "does it stay forever?"
   (2026-08-05, her question: "when I add something, does it stay forever? How
   can we respect my additions while also rotating the rack?").

   It used to stay forever, and the two goals really do fight: pins bypass the
   slot quotas, so every permanent pin is a seat the stratified rack no longer
   controls. Enough of them and the rack stops being a rack.

   A pin now ends one of two ways, and both of them respect the addition:
     · she WEARS it — the pin has done its whole job, and a piece worn recently
       stays in rotation on merit through rackWarmth and rackForcedIds. Clearing
       it here is not dropping the piece, it's handing it back to the ordinary
       machinery.
     · RACK_PIN_DAYS pass without a wear — she put it in front of herself, had a
       season to reach for it, and didn't. It rejoins the queues (where seen/
       dormant will offer it again) rather than holding a seat indefinitely.

   ⚠️ Counted in HOME days, like rackShouldRotate — a pin shouldn't burn down
   while she's away and can't act on it.
   Legacy entries are bare id strings in an array; they're read as pinned-today
   so nothing she's pinned so far disappears on this deploy. */
const RACK_PIN_DAYS = 60;
function rackPinnedMap() {
  const raw = rackState().pinned;
  const out = {};
  if (Array.isArray(raw)) for (const v of raw) {
    if (typeof v === "string") out[v] = null;                 // legacy: no date
    else if (v && v.id) out[v.id] = v.d || null;
  }
  return out;
}
function rackPinnedSet(today = todayStr(), wearRows = null) {
  const rows = wearRows || wears;
  const map = rackPinnedMap();
  const ids = Object.keys(map);
  if (!ids.length) return new Set();
  const want = new Set(ids);
  // One pass for "worn since the pin" — never items × wears.
  const wornSince = new Map();
  for (const w of rows) {
    if (!w || !w.item_id || !w.worn_on || !want.has(w.item_id)) continue;
    const prev = wornSince.get(w.item_id);
    if (!prev || w.worn_on > prev) wornSince.set(w.item_id, w.worn_on);
  }
  const ranges = (typeof awayRanges === "function") ? awayRanges() : [];
  const out = new Set();
  for (const id of ids) {
    const at = map[id];
    if (!at) { out.add(id); continue; }             // legacy / undated pin
    const worn = wornSince.get(id);
    if (worn && worn >= at) continue;               // job done; merit takes over
    if (rackHomeDaysSince(at, today, ranges) >= RACK_PIN_DAYS) continue;
    out.add(id);
  }
  return out;
}
// How long a pin has left, for the item view's rack line. null = not pinned.
function rackPinDaysLeft(id, today = todayStr()) {
  const at = rackPinnedMap()[id];
  if (at === undefined) return null;
  if (!at) return RACK_PIN_DAYS;
  const ranges = (typeof awayRanges === "function") ? awayRanges() : [];
  return Math.max(0, RACK_PIN_DAYS - rackHomeDaysSince(at, today, ranges));
}
/* Push-outs expire on their own so the rack can't be permanently narrowed by a
   decision she made in another season and forgot about. Two durations: the
   ordinary nudge (RACK_PUSH_DAYS) and the longer "not right now" from a
   reassessment. Legacy entries are bare date strings — read as the short one. */
function rackPushedSet(today = todayStr()) {
  const out = new Set();
  for (const [id, v] of Object.entries(rackState().pushed || {})) {
    const at = typeof v === "string" ? v : (v && v.d);
    const days = typeof v === "string" ? RACK_PUSH_DAYS : ((v && v.n) || RACK_PUSH_DAYS);
    if (at && at > shiftDate(today, -days)) out.add(id);
  }
  return out;
}
function rackSeen() {
  const s = rackState().seen;
  return s && typeof s === "object" ? s : {};
}

/* Levels the rack must be able to dress.
   Her ask, in her words: "can set events for future so the rack knows". Forward
   day plans are already a thing she fills in, so declared contexts drive this
   directly rather than the app guessing a distribution from history — more
   accurate AND more honest. History is only the floor, so an empty planner
   still produces a usable rack.
   ⚠️ Without this the rack is all levels 2–3 and the first "Dressed Up" ask
   returns ZERO, because targetLevel is a hard filter in suggestOutfits — the
   same failure as the 2026-07-19 capsule bug, from a smaller pool instead of a
   smaller capsule.
   ⚠️ A day-plan entry's OWN level (set per event since 2026-07-30 r4) wins over
   its contexts' usual level, exactly as entrySuggestLevel does — otherwise a
   dinner she has explicitly pinned to Dressed Up stocks the rack for Friends. */
/* Just the levels she has DECLARED for the days ahead — rackNeededLevels minus
   its habitual floor. The ceiling below needs the two separated: "I have a
   wedding on Saturday" must lift it, "I wear level 5 sometimes" must not. */
function rackDeclaredLevels(today = todayStr(), plans = null, wearRows = null, away = null) {
  const rows = wearRows || wears;
  const all = plans || dayPlanAll();
  const awayR = away || rackAwayRanges();
  const levels = new Set();
  for (let k = 0; k <= RACK_LOOKAHEAD_DAYS; k++) {
    const d0 = shiftDate(today, k);
    if (!rackHomeDate(d0, awayR)) continue;   // see rackHomeDate — travel isn't the rack
    for (const e of (all[d0] || [])) {
      if (e.level) { levels.add(e.level); continue; }
      for (const c of (e.contexts || [])) {
        const lv = contextFormalityLevel(c, rows);
        if (lv) levels.add(lv);
      }
    }
  }
  return levels;
}
/* ⚠️ "DRESSIER THAN AN ORDINARY DAY" IS NOT THE SAME AS "off-level"
   (2026-08-05, her third report on this: "I'm still continuously getting so
   many heels — one pair in rotation and four in haven't reached for lately,
   and that's after removing one pair and saying not right now").

   RACK_OFFLEVEL_SHARE caps pieces that serve NONE of rackNeededLevels — and
   rackNeededLevels includes her TOP THREE lived levels as a floor. If one of
   those three is 5, then a heel at [5,6,7] "serves a needed level" and the
   ceiling never looks at it. That is the leak: the floor exists so the rack can
   dress her ordinary week, and it was being read as a licence for the dressiest
   thing that touches it.

   The real question is whether a piece can be worn on an ORDINARY day, and the
   honest measure of that is its FLOOR against how she actually dresses: a piece
   whose lowest level sits above the level most of her days fall under has no
   ordinary day to be in play for, whatever its top end reaches.

   ⚠️ Declared plans still lift it — see rackDeclaredLevels — so a wedding in the
   planner brings the heels back the same day, through the same machinery as
   RACK_DRESSY_FLOOR. And a piece with no derivable set is never dressy-lean:
   unknown beats invented, as everywhere else. */
const RACK_TYPICAL_SHARE = 0.75;   // the level most of her days fall at or under
function rackTypicalLevel(wearRows = null) {
  const rows = wearRows || wears;
  const byLevel = new Map(), seen = new Set();
  let total = 0;
  for (const w of rows) {
    if (!w.formality_for || !w.worn_on) continue;
    const k = w.formality_for + "|" + w.worn_on;
    if (seen.has(k)) continue;
    seen.add(k);
    byLevel.set(w.formality_for, (byLevel.get(w.formality_for) || 0) + 1);
    total++;
  }
  if (!total) return 4;                       // no history: don't cap anything hard
  let run = 0;
  for (const lv of [...byLevel.keys()].sort((a, b) => a - b)) {
    run += byLevel.get(lv);
    if (run / total >= RACK_TYPICAL_SHARE) return lv;
  }
  return 8;
}
function rackNeededLevels(today = todayStr(), plans = null, wearRows = null, away = null) {
  const rows = wearRows || wears;
  const all = plans || dayPlanAll();
  const awayR = away || rackAwayRanges();
  const levels = new Set();
  for (let k = 0; k <= RACK_LOOKAHEAD_DAYS; k++) {
    const d = shiftDate(today, k);
    if (!rackHomeDate(d, awayR)) continue;   // see rackHomeDate — travel isn't the rack
    for (const e of (all[d] || [])) {
      if (e.level) { levels.add(e.level); continue; }
      for (const c of (e.contexts || [])) {
        const lv = contextFormalityLevel(c, rows);
        if (lv) levels.add(lv);
      }
    }
  }
  // Floor: the levels she actually lives at, by wear-DAY (never row counts).
  const byLevel = new Map();
  const seen = new Set();
  for (const w of rows) {
    if (!w.formality_for || !w.worn_on) continue;
    const k = w.formality_for + "|" + w.worn_on;
    if (seen.has(k)) continue;
    seen.add(k);
    byLevel.set(w.formality_for, (byLevel.get(w.formality_for) || 0) + 1);
  }
  [...byLevel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).forEach(([lv]) => levels.add(lv));
  return [...levels].sort((a, b) => a - b);
}

/* ⚠️ PIECES SHE HAS DECLARED OR ACTUALLY WORN ARE ALWAYS IN PLAY (2026-08-04 r3).

   Two questions from her, and the honest answer to both was "no, it doesn't":
     "I make a planned outfit, and the rack resets after that — do those pieces
      stay in (or get added to) the rack?"
     "If I wear something not on the rack, does it get added?"

   Neither was true. `rackNeededLevels` reads forward day plans for their
   LEVELS ONLY — so planning Thursday's outfit stocked the rack with *a* level-4
   top and had nothing to say about the specific top she chose, which could be
   sitting in dormant or off the rack entirely. And a piece she wore yesterday
   ranks top of the rotation band by warmth, but only at the NEXT rebuild — and
   wearing something marks nothing stale, so "next" was up to seven days away.

   The rack claims to be "what's in play right now". A look she has committed to
   for Thursday and a shirt she put on this morning are the two least ambiguous
   things in play there are; leaving them out was the rack disagreeing with her
   about her own week.

   ⚠️ This is a STRUCTURAL trigger, like a season flip or a new level: it tops
   coverage up and must never spend a rotation tick (the r7 churn lesson). These
   pieces join ROTATION, not the offered bands, so they cannot inflate `seen` —
   she is plainly not passing over a shirt she is wearing.

   ⚠️ IT MIRRORS buildRack's ELIGIBILITY *AND* CAPS ITSELF PER SLOT, because the
   set has to be SATISFIABLE. rackIsStale asks "is anything forced missing from
   the stored rack?" — so anything this returns, buildRack must be able to keep.
   The first version capped nothing and let buildRack trim the overflow back out,
   which meant the two disagreed by construction: every boot found a forced piece
   missing, rebuilt, trimmed it again, and would have rebuilt forever. (The
   selftest caught it; on the phone it would have looked like the rack churning.)
   So the cap is the slot's ROTATION band, ranked commitments-first then by
   recency — the same order rotation already ranks by.

   ⚠️ A PUSHED-OFF piece is excluded: she said not now, and wearing it once does
   not overrule that. Season is deliberately NOT applied — she wore it, so what
   the band thinks of the weather is beside the point. And when a caller builds
   from a restricted pool (the pack solver), a piece outside that pool was never
   a candidate and is dropped. */
function rackForcedIds({ today = todayStr(), plans = null, wearRows = null,
                         pushed = null, quota = null, pool = null } = {}) {
  const rows = wearRows || wears;
  const all = plans || dayPlanAll();
  const push = pushed || rackPushedSet(today);
  const inPool = pool ? new Set(pool.map(i => i && i.id)) : null;
  const declared = new Set();
  const raw = new Set();
  const ok = (id) => {
    const i = itemById.get(id);
    // ⚠️ "Keep off the rack" wins over forcing too — a piece she has explicitly
    // excluded must not come back in through having been worn. Dress-only is
    // NOT re-checked here: forcing means she planned or wore it, which is the
    // "unless I select that as a need" case arriving as a fact.
    return !!(i && itemStatus(i) === "Available" && !isNoSuggest(i) &&
              !isNoRack(i) &&
              i.category !== "Workout" && !push.has(id) && (!inPool || inPool.has(id)));
  };
  /* Declared: the pieces of a look she has actually assigned to a day ahead.
     ⚠️ Home days only (2026-08-06) — see rackHomeDate. An outfit planned for a
     day of a trip is a packing decision, and forcing its pieces into the home
     rack is the same leak as reading that day's LEVEL. */
  const awayFwd = rackAwayRanges();
  for (let k = 0; k <= RACK_LOOKAHEAD_DAYS; k++) {
    const d = shiftDate(today, k);
    if (!rackHomeDate(d, awayFwd)) continue;
    for (const e of (all[d] || [])) {
      if (!e || !e.outfit) continue;
      for (const id of (outfitItemMap.get(e.outfit) || [])) {
        if (ok(id)) { raw.add(id); declared.add(id); }
      }
    }
  }
  /* Lived: anything she reached for herself in the last RACK_RECENT_DAYS.
     ⚠️ The most recent day is recorded HERE, from `rows`, rather than read back
     out of rackWarmth/lastWorn — those close over the global `wears` and would
     ignore an injected wearRows, which is exactly how the first version of this
     dropped a piece worn yesterday: it ranked at warmth 0 and fell off the cap.
     buildRack is documented as injectable; a ranking that quietly isn't makes
     the fixture and the phone disagree. */
  /* ⚠️ AWAY DAYS DON'T COUNT AS "reached for" (2026-08-05, same report as
     rackWarmth). Coming home from a ten-day trip, every one of the last 14 days
     is a trip day, so this forced the entire suitcase into rotation and
     displaced the coldest ordinary member of every slot to do it — the rack
     became the bag she just unpacked. What she chose to WEAR at home is the
     signal; what she chose to PACK is a different decision, and travelProven
     already reads it. */
  const floor = shiftDate(today, -RACK_RECENT_DAYS);
  const awayR = (typeof awayRanges === "function") ? awayRanges() : [];
  // Travel-day home wears count as reaching for it (2026-08-16) — see rackWarmth.
  const awayEdge = (typeof tripEdgeMemberMap === "function") ? tripEdgeMemberMap() : new Map();
  /* ⚠️ WEARING IS NOT PLANNING (2026-08-05). Her rule for dress-only pieces is
     "unless I have planned something that requires that level", and forcing a
     piece in because she wore it last week is the one remaining door that let a
     [6,8] pair back onto the rack after a single dressy evening — which is
     exactly the week she is LEAST likely to need them again. The DECLARED half
     of this function is untouched: a planned outfit containing heels is a plan. */
  const declared0 = rackDeclaredLevels(today, all, rows);
  const dressOnlyLived = (id) => {
    const set = itemFormalityBase(itemById.get(id)) || [];
    if (!set.length || !set.every(l => l >= RACK_DRESSY_FLOOR)) return false;
    return !set.some(l => declared0.has(l));
  };
  const recentAt = new Map();
  for (const w of rows) {
    if (!w || !w.item_id || !w.worn_on) continue;
    if (w.worn_on < floor || w.worn_on > today) continue;
    if (awayR.length && !wearWasAtHome(w.worn_on, w.item_id, { ranges: awayR, edgeMap: awayEdge })) continue;
    if (!ok(w.item_id)) continue;
    if (dressOnlyLived(w.item_id)) continue;
    raw.add(w.item_id);
    const prev = recentAt.get(w.item_id);
    if (!prev || w.worn_on > prev) recentAt.set(w.item_id, w.worn_on);
  }

  // Cap per slot — see the warning above. A commitment outranks recency.
  const Q = quota || rackSlotQuota();
  const slotOf = i => (isLayer(i) && i.category === "Tops") ? "Tops" : suggestSlot(i);
  const bySlot = new Map();
  for (const id of raw) {
    const i = itemById.get(id);
    if (!i) continue;
    const s = slotOf(i);
    if (!s || !Q[s]) continue;           // a slot the rack has no structure for
    if (!bySlot.has(s)) bySlot.set(s, []);
    bySlot.get(s).push(i);
  }
  const out = new Set();
  for (const [slot, list] of bySlot) {
    const band = rackBands(Q[slot]);
    list.sort((a, b) =>
      ((declared.has(b.id) ? 1 : 0) - (declared.has(a.id) ? 1 : 0)) ||
      String(recentAt.get(b.id) || "").localeCompare(String(recentAt.get(a.id) || "")) ||
      (a.id < b.id ? -1 : 1));
    for (const i of list.slice(0, band.rotation)) out.add(i.id);
  }
  return out;
}

/* Days between two dates that she was actually HOME — see rackShouldRotate. */
function rackHomeDaysSince(from, today = todayStr(), ranges = null) {
  const total = daysBetween(from, today);
  if (total <= 0) return total;
  // A rack this old should rotate whatever the travel log says; don't walk a year.
  if (total > 400) return total;
  const rs = ranges || ((typeof awayRanges === "function") ? awayRanges() : []);
  if (!rs.length) return total;
  let home = 0;
  for (let k = 1; k <= total; k++) if (!awayRangeFor(shiftDate(from, k), rs)) home++;
  return home;
}

/* How "warm" a piece is: 1 = worn today, 0 = not worn inside RACK_WARM_DAYS.

   ⚠️ A TRIP WEAR IS NOT A HOME WEAR (2026-08-05, her report: "the most worn
   stuff on my rack is almost exclusively what I brought on my trip that I just
   got back from — would love some things from before I left, which fit the
   current climate better").

   She was right and the cause is arithmetic. Warmth is pure recency, and a
   ten-day trip writes ten days of wears for ~20 pieces at the very top of the
   window. So for the whole 60 days after a trip, the suitcase OWNS rotation —
   32 of the 58 seats — and every piece she was wearing at home the week before
   she left is ranked behind it. Two trips a year and the rack is a suitcase
   most of the time.

   The fix is to rank on the most recent wear AT HOME, and fall back to the trip
   wear plus a penalty when a piece has only ever been worn away. Not zero: a
   piece she wore every day of a trip is genuinely in play, and erasing it would
   just invert the bug. The penalty puts it behind anything she's reached for at
   home inside the window and ahead of everything she hasn't.

   ⚠️ It reads its OWN wearRows (the r3 lesson — a ranking that quietly closes
   over the global makes the fixture and the phone disagree). */
const RACK_AWAY_PENALTY_DAYS = 21;
function rackWarmth(itemId, today = todayStr(), { wearRows = null, away = null } = {}) {
  const rows = wearRows || wears;
  const rs = away || ((typeof awayRanges === "function") ? awayRanges() : []);
  /* ⚠️ The day she flew out and the day she flew back are half at home, and the
     suitcase says which half (2026-08-16). Something she wore that morning and
     did NOT pack is a home wear — it should rank as one, not sit 21 days behind
     everything else under the away penalty. */
  const edgeMap = (typeof tripEdgeMemberMap === "function") ? tripEdgeMemberMap() : new Map();
  let lastHome = null, lastAny = null;
  for (const w of rows) {
    if (w.item_id !== itemId || !w.worn_on) continue;
    if (!lastAny || w.worn_on > lastAny) lastAny = w.worn_on;
    if (rs.length && !wearWasAtHome(w.worn_on, w.item_id, { ranges: rs, edgeMap })) continue;
    if (!lastHome || w.worn_on > lastHome) lastHome = w.worn_on;
  }
  if (!lastAny) return 0;
  let d;
  if (lastHome) d = daysBetween(lastHome, today);
  else d = daysBetween(lastAny, today) + RACK_AWAY_PENALTY_DAYS;
  if (d < 0 || d > RACK_WARM_DAYS) return 0;
  return (RACK_WARM_DAYS - d) / RACK_WARM_DAYS;
}

/* Build the rack. Pure apart from its defaults, so the selftest can drive it.
   Returns { ids, rotation, steady, dormant, cold, offered, slots, levels }.
   `cold` is an alias for `dormant` kept for the trip builder and the stored
   shape; `offered` is steady ∪ dormant — the pieces this build is PUTTING in
   front of her, which is what rackEnsure increments the seen-counter for.

   `quota` (2026-07-29) lets the trip builder ask for a trip-sized rack:
   RACK_SLOT_QUOTA is calibrated for a day at home, and a 10-day trip with two
   dress-coded evenings needs a wider pool to draw from. ⚠️ The band shares are
   deliberately NOT parameterised — they are load-bearing for the same reason at
   home and away. */
function buildRack({ pool = null, wearRows = null, today = todayStr(), season = null,
                     wx = null, plans = null, pinned = null, pushed = null,
                     quota = null, seen = null } = {}) {
  const QUOTA = quota || rackSlotQuota();
  const rows = wearRows || wears;
  const seas = season || currentSeason();
  const pin = pinned || rackPinnedSet();
  const push = pushed || rackPushedSet(today);
  const seenMap = seen || rackSeen();
  const liked = (typeof likedLookItemIds === "function") ? likedLookItemIds() : new Set();

  // Candidates mirror the suggester's own normal-mode pool so the rack can never
  // offer something the engine would refuse. Laundry is NOT considered — see header.
  // ⚠️ The image_path clause came out on 2026-08-13 IN STEP with suggestOutfits.
  // Leaving it here would have been worse than useless: the home suggester draws
  // from the rack, so a photoless piece would still never be offered anywhere
  // except the trip screen, and the fix would look half-applied.
  const base = (pool || items).filter(i =>
    i && itemStatus(i) === "Available" &&
    !isNoSuggest(i) && !isNoRack(i) &&
    i.category !== "Workout" && !push.has(i.id));

  // One away-range read for the whole build — the forward reads and rackWarmth
  // must agree about which days she was home for. See rackHomeDate.
  const awayR = rackAwayRanges();
  const levels = rackNeededLevels(today, plans, rows, awayR);
  const declaredSet0 = rackDeclaredLevels(today, plans, rows, awayR);
  /* ⚠️ DRESS-ONLY PIECES ARE OFF THE RACK UNLESS SHE ASKS (2026-08-05, her
     words: "let's never include pieces that only work for formal occasions in
     the rack unless I select that as a need").

     RACK_OFFLEVEL_SHARE already capped these at a slot or two, and that was the
     right shape for a piece that covers Dressed Up AND something ordinary. It's
     the wrong answer for a piece that covers NOTHING BUT the top of the ladder:
     a gown has no ordinary day to be in play for, so any share of it above zero
     is the rack spending a seat on a day she doesn't have. The ceiling is now a
     floor of zero for those.

     ⚠️ "UNLESS I HAVE PLANNED SOMETHING THAT REQUIRES THAT LEVEL" — her exact
     words, 2026-08-05, and this is now read literally. It used to exempt on
     rackNeededLevels, which is declared plans UNIONED WITH her top three lived
     levels; if 6 was among those three, every [6,8] piece she owned was exempt
     and the rule did nothing. Only a DECLARED plan lifts it now
     (rackDeclaredLevels — a forward day plan, an anchor event, a trip's
     contexts). Habit is not a plan.
     ⚠️ A PIN still shows: pinning is her saying "keep this in", which outranks
     any rule here. What no longer counts is merely having WORN it — see
     rackForcedIds, where the same filter is applied to the lived half. */
  const dressOnly = i => {
    const set = itemFormalityBase(i) || [];   // ⚠️ un-nudged — see itemFormalityBase
    if (!set.length) return false;                     // unknown beats invented
    if (!set.every(l => l >= RACK_DRESSY_FLOOR)) return false;
    return !set.some(l => declaredSet0.has(l));        // she has PLANNED one → keep
  };
  const baseNoGowns = base.filter(i => !dressOnly(i));

  const eligible = baseNoGowns.filter(i => inSeasonWx(i, seas, wx));

  /* Deterministic ordering: same inputs, same rack. Stability is the point —
     she should come to recognise it, and a rack that reshuffles every open is
     just a random sample with extra steps. */
  const warmth = i => rackWarmth(i.id, today, { wearRows: rows, away: awayR });
  const likedRank = i => (liked.has(i.id) ? 1 : 0);
  const seenOf = i => seenMap[i.id] || 0;
  // Rotation: purely how recently she reached for it. Liked only breaks ties.
  const byRecent = (a, b) => (warmth(b) - warmth(a)) || (likedRank(b) - likedRank(a)) || (a.id < b.id ? -1 : 1);
  /* Steady + dormant: a round-robin queue. Least-offered-first is what makes the
     whole pool cycle instead of the same handful looping forever; all-time wear
     count then leads with "you used to wear this a lot", which is a better
     rediscovery than a random stranger. */
  const byQueue = (a, b) => (seenOf(a) - seenOf(b)) || (likedRank(b) - likedRank(a)) ||
    (wearCount(b.id) - wearCount(a.id)) || (a.id < b.id ? -1 : 1);

  const slotOf = i => (isLayer(i) && i.category === "Tops") ? "Tops" : suggestSlot(i);
  /* Does this piece cover any level she'll actually need? See the
     RACK_OFFLEVEL_SHARE comment — this is what keeps the rediscovery bands from
     silting up with clothes for days she doesn't have. A piece with no
     formality at all is imputed by itemFormalitySet, so nothing is off-level
     merely for being untagged. */
  const levelSet = new Set(levels);
  const declaredSet = declaredSet0;
  const typical = rackTypicalLevel(rows);
  /* One predicate for the ceiling: a piece is "for a day she doesn't have" if it
     serves no needed level AT ALL, or if its floor is above an ordinary day.
     Either way a declared plan exempts it. */
  const offLevel = i => {
    const set = itemFormalityBase(i) || [];   // ⚠️ un-nudged — see itemFormalityBase
    if (!set.length) return false;                      // unknown beats invented
    if (set.some(l => declaredSet.has(l))) return false;
    if (!set.some(l => levelSet.has(l))) return true;
    return Math.min(...set) > typical;
  };
  const ids = new Set();
  const rotation = new Set(), steady = new Set(), dormant = new Set();

  for (const [slot, slotQuota] of Object.entries(QUOTA)) {
    const band = rackBands(slotQuota);
    const inSlot = eligible.filter(i => slotOf(i) === slot ||
      (slot === "Outerwear" && isLayer(i) && i.category === "Tops"));

    // 1. rotation — top N by recency, out of everything in the slot.
    const ranked = inSlot.slice().sort(byRecent);
    const inRotation = ranked.filter(i => warmth(i) > 0).slice(0, band.rotation);
    const chosen = new Set(inRotation.map(i => i.id));

    // 2. the remainder splits on the RACK_WARM_DAYS line. Everything the
    //    rotation cut left behind but that she HAS worn recently is the steady
    //    band — the middle of the wardrobe that used to be invisible.
    const rest = inSlot.filter(i => !chosen.has(i.id));
    const steadyPool = rest.filter(i => warmth(i) > 0).sort(byQueue);
    const dormantPool = rest.filter(i => warmth(i) === 0).sort(byQueue);
    /* One ceiling shared by both rediscovery bands, since the complaint is about
       their TOTAL ("one from steady and three from haven't-reached-for"). Taking
       in queue order and skipping past the ceiling means the next candidate gets
       the slot — the queue keeps working, it just can't be all one kind of day. */
    let offBudget = Math.max(1, Math.round((band.steady + band.dormant) * RACK_OFFLEVEL_SHARE));
    const takeCapped = (queue, n) => {
      const out = [];
      for (const i of queue) {
        if (out.length >= n) break;
        if (offLevel(i)) { if (offBudget <= 0) continue; offBudget--; }
        out.push(i);
      }
      return out;
    };
    const inSteady = takeCapped(steadyPool, band.steady);
    for (const i of inSteady) chosen.add(i.id);
    const inDormant = takeCapped(dormantPool, band.dormant);
    for (const i of inDormant) chosen.add(i.id);

    /* 3. Backfill from whichever band has slack, so a thin slot still fills to
       its total. A young closet has no dormant pieces at all; a neglected slot
       has no rotation. Backfilled pieces keep the band they came FROM, so the
       screen never calls a piece she wore yesterday "dormant". */
    const want = band.rotation + band.steady + band.dormant;
    let short = want - chosen.size;
    if (short > 0) {
      const spare = [
        ...ranked.filter(i => warmth(i) > 0 && !chosen.has(i.id)),   // more recent
        ...dormantPool.filter(i => !chosen.has(i.id)),               // then dormant
      ];
      /* ⚠️ THE BACKFILL USED TO HAND THE SKIPPED HEELS STRAIGHT BACK (fixed
         2026-08-04 r2 — it is why the ceiling barely moved her real rack).

         r1 let the backfill ignore the ceiling, reasoning that "a slot that
         can't fill any other way should be full rather than correct". On the
         SYNTHETIC fixture that was harmless, because every slot had plenty of
         everyday spares. On a real wardrobe it is the common case and it
         inverts the fix: most shoes she hasn't worn in 60 days ARE the dressy
         ones, so the ceiling took 1, the slot came up short, and the backfill
         put two more back — the ordering below only decided which heels.

         The ceiling binds here too, and a slot is allowed to run SHORT. A rack
         of 54 that reflects her week beats a rack of 58 padded with clothes for
         days she doesn't have; "58" was never the promise. Level coverage does
         not depend on this — the formality top-up below is exempt and runs
         after, so a declared Dressed Up day still gets its shoes. */
      for (const i of spare) {
        if (short <= 0) break;
        if (offLevel(i)) { if (offBudget <= 0) continue; offBudget--; }
        chosen.add(i.id);
        (warmth(i) > 0 ? inSteady : inDormant).push(i);
        short--;
      }
    }

    for (const i of inRotation) { ids.add(i.id); rotation.add(i.id); }
    for (const i of inSteady) { ids.add(i.id); steady.add(i.id); }
    for (const i of inDormant) { ids.add(i.id); dormant.add(i.id); }
  }

  /* Formality top-up: for every level she'll actually need, make sure each core
     slot can cover it. This is what stops "Dressed Up" returning an empty sheet.
     Top-ups join the STEADY band — they're here because a declared plan needs
     them, not because she's been reaching for them. */
  for (const lv of levels) {
    /* ⚠️ NEVER GO SHOPPING FOR A DRESSY LEVEL SHE HASN'T DECLARED (2026-08-06).
       `levels` is declared plans UNIONED with her top three LIVED levels, and
       this loop is deliberately exempt from the off-level ceiling — so a season
       with a few dressy evenings in it put 6 into the floor and then this loop
       actively went and fetched level-6 tops, bottoms AND shoes on every single
       rebuild. That is the ceiling's whole job being undone by the one door the
       ceiling doesn't watch. Her rule, verbatim: "the rack should ONLY build
       levels 2, 3, 4, 5 unless I request other levels for the rack / plan
       future days" — so habit stocks the ordinary levels and only a DECLARED
       plan stocks above them, the same split rackDeclaredLevels already draws.
       ⚠️ Coverage is not lost: poolCoversLevel + planningPool's rescue widen to
       the whole closet the instant she asks for a level the rack can't dress,
       so an undeclared "Dressed Up" ask still returns a full sheet — out of her
       closet, which is where clothes for rare days belong. */
    if (lv > RACK_EVERYDAY_MAX && !declaredSet.has(lv)) continue;
    for (const slot of ["Tops", "Bottoms", "Shoes"]) {
      const covers = i => (itemFormalitySet(i) || []).includes(lv);
      const have = [...ids].map(id => itemById.get(id)).filter(i => i && slotOf(i) === slot && covers(i)).length;
      if (have >= RACK_LEVEL_MIN) continue;
      const add = eligible
        .filter(i => !ids.has(i.id) && slotOf(i) === slot && covers(i))
        .sort(byRecent)
        .slice(0, RACK_LEVEL_MIN - have);
      for (const i of add) { ids.add(i.id); steady.add(i.id); }
    }
  }

  // A pinned piece is always in play — that's what pinning means. It bypasses
  // season and slot quotas, but not "does this item still exist and is wearable".
  for (const id of pin) {
    const i = itemById.get(id);
    if (i && itemStatus(i) === "Available") {
      ids.add(id); dormant.delete(id); steady.delete(id); rotation.add(id);
    }
  }

  /* Declared and lived pieces — see rackForcedIds. They join ROTATION, so they
     never count as an unmet offer and can't inflate `seen`.

     ⚠️ THEY DISPLACE, THEY DO NOT PILE ON (caught by the quota cases the first
     time this shipped). Adding them on top grew the fixture's Dresses slot from
     6 to 15 and Shoes from 11 to 16 — which quietly turns a stratified rack back
     into the top-N it exists not to be. The slot quotas are the reason the rack
     can build an outfit at all ("a 58-piece rack that happens to be 45 tops
     cannot"), so a forced piece takes a rotation seat rather than adding one:
     the slot's coldest ordinary member steps out, and the rack stays its size.
     Where more pieces are forced than the slot's rotation band holds, the most
     recent win — which is the same rule rotation already ranks by.
     ⚠️ Pins are never displaced and never counted: pinning deliberately bypasses
     quotas, and trimming to a quota that pins had inflated would drop pieces the
     derivation actually chose. */
  const forced = rackForcedIds({ today, plans, wearRows: rows, pushed: push, quota: QUOTA, pool });
  const touchedSlots = new Set();
  for (const id of forced) {
    const i = itemById.get(id);
    if (!i || ids.has(id)) continue;
    const s = slotOf(i) || "Other";
    if (!QUOTA[s]) continue;              // a slot the rack has no structure for
    ids.add(id); dormant.delete(id); steady.delete(id); rotation.add(id);
    touchedSlots.add(s);
  }
  for (const slot of touchedSlots) {
    const band = rackBands(QUOTA[slot]);
    const inSlot = () => [...rotation]
      .filter(id => !pin.has(id))
      .map(id => itemById.get(id))
      .filter(i => i && slotOf(i) === slot);
    let over = inSlot().length - band.rotation;
    if (over <= 0) continue;
    /* Only ordinary members are ever dropped, coldest first. rackForcedIds caps
       itself at exactly this band, so dropping the non-forced is always enough —
       and a forced piece surviving is the whole point of forcing it. */
    const droppable = inSlot().filter(i => !forced.has(i.id)).sort(byRecent).reverse();
    for (const victim of droppable) {
      if (over <= 0) break;
      rotation.delete(victim.id); ids.delete(victim.id);
      over--;
    }
  }

  const slots = new Map();
  for (const id of ids) {
    const i = itemById.get(id);
    const s = i ? (slotOf(i) || "Other") : "Other";
    slots.set(s, (slots.get(s) || 0) + 1);
  }
  return {
    ids: [...ids], rotation: [...rotation], steady: [...steady], dormant: [...dormant],
    cold: [...dormant],                       // alias: the trip builder reads .cold
    offered: [...new Set([...steady, ...dormant])],
    slots, levels,
  };
}

// ---- the live rack (stored, rebuilt on a cadence) ----
let _rackMemo = null;
function rackIsStale(st = rackState(), today = todayStr()) {
  if (!st.built || !Array.isArray(st.ids) || !st.ids.length) return true;
  // A rack stored before the three-band rework has no bands — rebuild rather
  // than render a screen with two thirds of its sections empty.
  if (!Array.isArray(st.steady) || !Array.isArray(st.rotation)) return true;
  // Built by an older derivation → rebuild now rather than show her last week's
  // answer to a question the app has since changed its mind about. See RACK_ALGO.
  if ((st.algo || 1) !== RACK_ALGO) return true;
  // She moved the size dial — that changes SELECTION, so top it up now rather
  // than up to a week from now. Structural: it must not spend a rotation tick.
  if ((st.size || RACK_SIZE_DEFAULT) !== rackTargetSize()) return true;
  if (daysBetween(st.built, today) >= RACK_REBUILD_DAYS) return true;
  if (st.season !== currentSeason()) return true;   // a season flip must not wait a week
  /* ⚠️ A NEWLY DECLARED LEVEL REBUILDS AT ONCE (2026-08-03 r6, her question:
     "if I add a context not included in the rack, will the rack automatically
     expand/revise itself right then?"). It did NOT. rackNeededLevels reads
     forward day plans, but nothing marked the rack stale when she added one, so
     a Wedding put in the planner on Monday could wait until Sunday's scheduled
     rebuild — and since targetLevel is a HARD filter, asking for that level in
     the meantime returned an EMPTY sheet.
     Only a level the stored rack was never built to cover counts. Losing a
     level (an event passing, or moving out of the 14-day window) must NOT
     rebuild: that would churn the rack for no gain, and stability is the
     feature. */
  const need = rackNeededLevels(today);
  const had = new Set(st.levels || []);
  if (need.some(lv => !had.has(lv))) return true;
  /* ⚠️ Same idea one level down: a piece she has PLANNED or WORN and that isn't
     on the stored rack tops it up now rather than in six days. Structural — see
     rackForcedIds, and note rackShouldRotate keeps this from spending a tick.
     Satisfiable by construction: buildRack forces the identical set in. */
  const forced = rackForcedIds({ today });
  if (forced.size) {
    const have = new Set(st.ids);
    for (const id of forced) if (!have.has(id)) return true;
  }
  return false;
}
/* Rebuild if due, otherwise return what's stored.

   ⚠️ WHERE THIS IS CALLED IS THE WHOLE FEATURE (fixed 2026-08-03). Until then
   rackEnsure ran in exactly two places — tapping the closet's rack row, and the
   "Rebuild now" button — while EVERY consumer (the suggester's pool, the pool
   chip, the closet row's count) read rackEffective(), which checks nothing. So
   the 7-day cadence and the season-flip guard only ever ran if she happened to
   visit the rack screen; three weeks of suggestions could come from a
   three-week-old rack, and a summer rack could survive into October. It is now
   also called at boot and whenever the suggester opens. Both are cheap: on six
   days out of seven rackIsStale is a date comparison that returns false.

   kvUpdate applies to kvData synchronously (persisting in the background), so
   callers that can't await — openSuggestSheet is synchronous — still see the
   fresh rack on this very render. */
/* Split out so it is testable without driving the whole async write path — and
   so the rule has a name. True = this rebuild may advance the rotation queue. */
/* ⚠️ THE CADENCE COUNTS DAYS SHE WAS HOME (2026-08-04 r3).

   `seen` counts how many rebuilds a piece has been OFFERED and not worn, and it
   is also the queue ordering. But during a trip the suitcase IS the pool —
   _suggPool hands the capsule branch the whole sheet and the rack is not
   consulted at all — so a rotation that fires on day 7 of a trip to Spain
   increments `seen` for ~26 pieces hanging in a closet she is 5,000 miles from.
   They weren't passed over. She never had the chance to decline them. Two trips
   a year and "worth a second look" fills with pieces whose only crime was that
   she went on holiday — the exact corruption r7 named (a counter that is both a
   measure and a mechanism) arriving through one more unaudited trigger.

   awayRanges() already unions dated trips' locations with the hand-entered
   wherelog, so this needs no new state. Away days simply don't count toward the
   cadence, and a rotation never lands mid-trip. */
function rackShouldRotate(st = rackState(), today = todayStr(), force = false, ranges = null) {
  if (force) return true;                       // only ever the "Rebuild now" button
  const prev = st && st.built;
  if (!prev) return true;                       // no rack yet: the first one rotates
  const rs = ranges || ((typeof awayRanges === "function") ? awayRanges() : []);
  if (awayRangeFor(today, rs)) return false;    // never rotate mid-trip
  return rackHomeDaysSince(prev, today, rs) >= RACK_REBUILD_DAYS;
}
async function rackEnsure({ force = false } = {}) {
  const st = rackState();
  if (!force && !rackIsStale(st)) return st;
  const today = todayStr();
  const prevBuilt = st.built || null;
  const built = buildRack({ wx: (_homeWx && _homeWx.date === todayStr()) ? _homeWx.wx : null });

  /* ⚠️ NOT EVERY REBUILD IS A ROTATION (fixed 2026-08-03 r7, she reported "the
     rack has updated a bunch just tonight").

     `seen` counts how many times a piece has been OFFERED to her and not worn,
     and it is also the ORDERING of the steady and dormant bands — so
     incrementing it reshuffles 26 of the 58 slots. That is correct at the weekly
     cadence, which is the pace she was promised.

     But r1 made rackEnsure run at boot and on every suggester open, and r6 made
     a newly declared formality level mark the rack stale and had saveDayPlan
     call it. So rebuilds went from "only if she opens the rack screen" to
     several an evening — and each one spent a rotation tick. Planning a week,
     or simply installing two updates, visibly churned the rack.

     Structural rebuilds (a new level to cover, a season flip, a stored-format
     migration) must top up COVERAGE without advancing the queue. Only the 7-day
     cadence rotates, and only the cadence moves `built` — otherwise an unrelated
     trigger would also postpone the next real rotation by up to a week.
     ⚠️ `force` DOES rotate: that is only ever the "Rebuild now" button, which is
     her asking for exactly this. */
  const cadence = rackShouldRotate(st, today, force);

  const seen = { ...rackSeen() };
  /* ⚠️ WHEN a piece was first offered, not just how often (2026-08-04 r2). Her
     words: "I may often hit refresh on the rack." Every "Rebuild now" is a
     rotation, so it increments `seen` for all ~26 offered pieces — correct as a
     QUEUE CURSOR (that's what makes the button give her different picks) and
     nonsense as a MEASURE: three taps in one evening would put 26 pieces in
     "worth a second look" claiming they'd been offered three times and passed
     over. They hadn't. She never got the chance to decline them.
     This is the r7 lesson — one counter doing a measure's job and a mechanism's
     job — arriving through the one trigger r7 deliberately exempted. The cursor
     keeps counting taps; the QUESTION now needs elapsed time as well. */
  const seenAt = { ...(rackState().seenAt || {}) };
  for (const id of Object.keys(seen)) {
    if (!itemById.get(id)) { delete seen[id]; delete seenAt[id]; continue; }   // deleted piece
    const lw = lastWorn(id);
    // she wore it: the offer worked, so the clock and the count both start over
    if (prevBuilt && lw && lw >= prevBuilt) { delete seen[id]; delete seenAt[id]; }
  }
  if (cadence) for (const id of built.offered) {
    seen[id] = (seen[id] || 0) + 1;
    if (!seenAt[id]) seenAt[id] = today;
  }

  const next = {
    algo: RACK_ALGO,
    size: rackTargetSize(),
    built: cadence ? today : (prevBuilt || today),
    revised: today,                 // last recomputed at all — for the screen
    season: currentSeason(),
    levels: built.levels,
    ids: built.ids, cold: built.cold,
    rotation: built.rotation, steady: built.steady, dormant: built.dormant,
    seen, seenAt,
    pinned: rackState().pinned || [], pushed: rackState().pushed || {},
  };
  _rackMemo = null;
  await kvUpdate(RACK_KEY, prev => ({ ...(prev || {}), ...next }));
  return next;
}
/* The effective rack: what's stored, or a fresh derivation when nothing is
   stored yet. Every band comes from the SAME source — reading ids from the
   fallback build while reading cold from empty stored state made the
   rediscovery block silently vanish on first open, which is the one part of
   this feature that must never quietly disappear. */
function rackEffective() {
  if (_rackMemo && _rackMemo.stamp === rackStamp()) return _rackMemo.eff;
  const st = rackState();
  const fromStored = Array.isArray(st.ids) && st.ids.length && Array.isArray(st.steady);
  const b = fromStored ? st : buildRack();
  const eff = {
    ids: b.ids,
    rotation: new Set(b.rotation || []),
    steady: new Set(b.steady || []),
    dormant: new Set(b.dormant || b.cold || []),
    cold: new Set(b.dormant || b.cold || []),
  };
  _rackMemo = { stamp: rackStamp(), eff };
  return eff;
}
// Item objects on the rack, in closet order.
function rackItems() {
  return rackEffective().ids.map(id => itemById.get(id)).filter(i => i && itemStatus(i) === "Available");
}
const rackStamp = () => {
  const st = rackState();
  return `${st.built || ""}|${st.revised || ""}|${(st.ids || []).length}|${(st.pinned || []).length}|${Object.keys(st.pushed || {}).length}|${items.length}`;
};
const isOnRack = (id) => rackItems().some(i => i.id === id);
const rackColdSet = () => rackEffective().cold;
// Which band a piece is in, for the item view's rack line. null = not on the rack.
function rackBandOf(id) {
  const eff = rackEffective();
  if (eff.rotation.has(id)) return "rotation";
  if (eff.steady.has(id)) return "steady";
  if (eff.dormant.has(id)) return "dormant";
  return null;
}
const RACK_BAND_LABEL = { rotation: "In rotation", steady: "Steady", dormant: "Haven't reached for it lately" };

/* ---- "worth a second look" ------------------------------------------------
   Pieces the rack has put in front of her RACK_SEEN_LIMIT times and that she
   still hasn't worn. Her idea, and it falls straight out of the counter that
   already drives rotation: one number, two jobs.

   ⚠️ THIS STATES A FACT AND ASKS A QUESTION. It never guesses WHY. The app
   cannot tell "wrong for work" from "I don't like it any more" from "the season
   tag is wrong", and the r19 guessing layer is the standing proof that a wrong
   guess costs more trust than a tap costs effort. Same tone as "packed 3×, worn
   0×": the sweater offered three times may simply be waiting for a cold snap.
   There is deliberately no "get rid of this" recommendation and never a
   purchase suggestion. */
function rackPassedOver(limit = RACK_SEEN_LIMIT, today = todayStr()) {
  const seen = rackSeen();
  const seenAt = rackState().seenAt || {};
  return Object.entries(seen)
    .filter(([id, n]) => {
      if (n < limit) return false;
      /* ⚠️ AND it has to have been in front of her for a WHILE. "Offered three
         times and still not worn" is a claim about weeks; without this it can be
         a claim about one evening of tapping Rebuild now (see the seenAt note in
         rackEnsure). A piece with no recorded first-offer is legacy state from
         before this existed — trust the count for those rather than hiding a
         list she's already been using. */
      const at = seenAt[id];
      return !at || daysBetween(at, today) >= RACK_SECOND_LOOK_DAYS;
    })
    .map(([id, n]) => ({ item: itemById.get(id), n }))
    .filter(x => x.item && itemStatus(x.item) === "Available")
    .sort((a, b) => (b.n - a.n) || ((a.item.name || "") < (b.item.name || "") ? -1 : 1));
}
async function rackClearSeen(id) {
  await kvUpdate(RACK_KEY, prev => {
    const st = prev && typeof prev === "object" ? prev : {};
    const seen = { ...(st.seen || {}) }; delete seen[id];
    return { ...st, seen };
  });
  _rackMemo = null;
}

// ---- nudges ----
// Pull in: an explicit yes. Survives every rebuild until she pushes it back out.
async function pullOntoRack(id) {
  const i = itemById.get(id);
  if (!i) return;
  await kvUpdate(RACK_KEY, prev => {
    const st = prev && typeof prev === "object" ? prev : {};
    // Store the date so the pin can expire — see rackPinnedSet.
    const pinned = (Array.isArray(st.pinned) ? st.pinned : [])
      .map(v => (typeof v === "string" ? { id: v, d: null } : v))
      .filter(v => v && v.id !== id);
    pinned.push({ id, d: todayStr() });
    const pushed = { ...(st.pushed || {}) }; delete pushed[id];
    const seen = { ...(st.seen || {}) }; delete seen[id];
    const ids = new Set(st.ids || []); ids.add(id);
    const rotation = new Set(st.rotation || []); rotation.add(id);
    return { ...st, pinned, pushed, seen, ids: [...ids], rotation: [...rotation] };
  });
  _rackMemo = null;
  toast(`${i.name || "Piece"} is on the rack`);
}
// Push out: "not right now". Expires by itself (RACK_PUSH_DAYS, or the longer
// RACK_PUSH_LONG_DAYS when it comes from a second-look answer).
async function pushOffRack(id, { days = RACK_PUSH_DAYS, quiet = false } = {}) {
  const i = itemById.get(id);
  if (!i) return;
  await kvUpdate(RACK_KEY, prev => {
    const st = prev && typeof prev === "object" ? prev : {};
    const pinned = (Array.isArray(st.pinned) ? st.pinned : [])
      .filter(v => (typeof v === "string" ? v : (v && v.id)) !== id);
    const pushed = { ...(st.pushed || {}), [id]: { d: todayStr(), n: days } };
    const seen = { ...(st.seen || {}) }; delete seen[id];
    const drop = (a) => (a || []).filter(x => x !== id);
    return { ...st, pinned, pushed, seen, ids: drop(st.ids),
             rotation: drop(st.rotation), steady: drop(st.steady),
             dormant: drop(st.dormant), cold: drop(st.cold) };
  });
  _rackMemo = null;
  /* ⚠️ TOP THE SLOT BACK UP (2026-08-05, her ask: "I want the rack to top itself
     off if I remove something from it").

     Removal used to just delete the id, so the rack shrank by one and stayed a
     piece short until the weekly rotation — which made saying "not right now"
     feel like a punishment rather than an exchange. A structural rebuild refills
     the gap from the same slot immediately.

     ⚠️ STRUCTURAL, NOT A ROTATION TICK — the r7 churn lesson. rackEnsure's own
     rackShouldRotate decides that, and a top-up must not spend a tick or move
     the `built` anchor, or a handful of removals would postpone the real weekly
     rotation and inflate `seen` for pieces she never declined. */
  await rackEnsure();
  if (!quiet) toast(`Off the rack — topped up from the same shelf`, { label: "Undo", fn: () => pullOntoRack(id) });
}

/* ---- what she's taken off, and whether it's coming back --------------------
   Her question: "a list available somewhere of pieces I've removed from the
   rack so I know if there are any I need to re-enter the pool (if they stay off
   permanently if I've removed them?)".

   The honest answer is that it depends which of two things she did, and the
   list has to say so per piece rather than in a legend:
     · "Not right now"      → expires (RACK_PUSH_DAYS / RACK_PUSH_LONG_DAYS)
     · "Keep off the rack"  → permanent until she says otherwise
   Both are listed, each with its own wording and a one-tap way back. */
function rackOffList(today = todayStr()) {
  const out = [];
  for (const [id, v] of Object.entries(rackState().pushed || {})) {
    const at = typeof v === "string" ? v : (v && v.d);
    const days = typeof v === "string" ? RACK_PUSH_DAYS : ((v && v.n) || RACK_PUSH_DAYS);
    if (!at) continue;
    const left = days - daysBetween(at, today);
    if (left <= 0) continue;                      // already back in the pool
    const i = itemById.get(id);
    if (!i || itemStatus(i) !== "Available") continue;
    out.push({ item: i, kind: "pushed", at, left });
  }
  for (const i of items) {
    if (!isNoRack(i) || itemStatus(i) !== "Available") continue;
    out.push({ item: i, kind: "tagged", at: null, left: null });
  }
  // Soonest to return first; the permanent ones last, since they need a decision.
  return out.sort((a, b) => (a.kind === b.kind ? (a.left || 0) - (b.left || 0)
                                               : (a.kind === "pushed" ? -1 : 1)));
}
function rackOffSectionHtml() {
  const list = rackOffList();
  if (!list.length) return "";
  const rows = list.map(({ item: i, kind, left }) => `<div class="frow" style="align-items:center">
      <button data-item-open="${esc(i.id)}" style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;text-align:left">
        ${thumbHtml(i.image_path, "sthumb")}
        <span style="flex:1;min-width:0">
          <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.name || "Untitled")}</span>
          <span style="display:block;font-size:12px;color:var(--muted)">${kind === "tagged"
            ? "Kept off the rack — stays off until you change it"
            : `Not right now — back in ${left} day${left === 1 ? "" : "s"}`}</span>
        </span>
      </button>
      <div style="display:flex;gap:5px;flex:none">
        <button class="cap-chip" data-rack-reset="${esc(i.id)}" style="font-size:12px">${kind === "tagged" ? "Allow again" : "Reset"}</button>
        <button class="cap-chip" data-rack-pin="${esc(i.id)}" style="font-size:12px" title="Put it in and keep it in">📌</button>
      </div>
    </div>`).join("");
  return `<div class="stats-sec-hdr" style="padding:16px 16px 4px"><div class="t">Taken off the rack · ${list.length}</div></div>
    <div class="muted" style="font-size:12.5px;padding:0 16px 6px;line-height:1.45">“Not right now” wears off by itself. “Keep off the rack” doesn't — those are the ones worth a second thought. <b>Reset</b> just makes a piece eligible again; 📌 puts it in and keeps it in.</div>
    <div class="frows">${rows}</div>`;
}
/* ⚠️ ELIGIBLE AGAIN ≠ PINNED (2026-08-05, her report: "I tapped put back to
   reset but it just put them back on the rack — can we just have a reset option
   to remove the 'not right now' that doesn't actually pin it to the rack?").

   She's right, and the old button was two decisions welded together. Undoing a
   "not right now" should hand the piece back to the ordinary machinery — it
   competes for a slot on its own merits like everything else — whereas pinning
   is a separate, stronger statement that bypasses the slot quotas. Reusing
   pullOntoRack for both meant every reset silently spent a rack seat.

   So: `rackResetPiece` clears the exclusion and stops. `pullOntoRack` is still
   there, offered separately, for when she means "and keep it in". */
async function rackResetPiece(id) {
  const i = itemById.get(id);
  if (isNoRack(i)) await setNoRack(id, false);
  await kvUpdate(RACK_KEY, prev => {
    const st = prev && typeof prev === "object" ? prev : {};
    const pushed = { ...(st.pushed || {}) };
    delete pushed[id];
    return { ...st, pushed };
  });
  _rackMemo = null;
  // Structural: the piece is eligible again, so let the rack reconsider it now
  // rather than at the next weekly shuffle. Never a rotation tick.
  await rackEnsure();
  if (typeof renderCloset === "function" && closetRack) renderCloset();
  toast(`${(i && i.name) || "Piece"} can be picked again`);
}
// Drop a pin without pushing the piece off — the mirror of rackResetPiece.
async function rackUnpinPiece(id) {
  await kvUpdate(RACK_KEY, prev => {
    const st = prev && typeof prev === "object" ? prev : {};
    const pinned = (Array.isArray(st.pinned) ? st.pinned : [])
      .filter(v => (typeof v === "string" ? v : (v && v.id)) !== id);
    return { ...st, pinned };
  });
  _rackMemo = null;
  await rackEnsure();
  if (typeof renderCloset === "function" && closetRack) renderCloset();
  const i = itemById.get(id);
  toast(`${(i && i.name) || "Piece"} is no longer kept — it competes like everything else`);
}

/* The pins, visible (her ask: "also want the option to reset (and see!) rack
   pins"). They were write-only: pullOntoRack said "on the rack" in a toast and
   the only way to find one again was to remember which piece it was. */
function rackPinnedListHtml(today = todayStr()) {
  const set = rackPinnedSet(today);
  if (!set.size) return "";
  const rows = [...set].map(id => itemById.get(id)).filter(i => i && itemStatus(i) === "Available")
    .map(i => {
      const left = rackPinDaysLeft(i.id, today);
      return `<div class="frow" style="align-items:center">
      <button data-item-open="${esc(i.id)}" style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;text-align:left">
        ${thumbHtml(i.image_path, "sthumb")}
        <span style="flex:1;min-width:0">
          <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.name || "Untitled")}</span>
          <span style="display:block;font-size:12px;color:var(--muted)">${left == null ? "Kept in"
            : left > 0 ? `Kept in for ${left} more day${left === 1 ? "" : "s"}` : "Keep has run out"}</span>
        </span>
      </button>
      <button class="cap-chip" data-rack-unpin="${esc(i.id)}" style="flex:none;font-size:12px">Unpin</button>
    </div>`;
    }).join("");
  if (!rows) return "";
  return `<div class="stats-sec-hdr" style="padding:16px 16px 4px"><div class="t">Kept on the rack · ${set.size}</div></div>
    <div class="muted" style="font-size:12.5px;padding:0 16px 6px;line-height:1.45">These skip the usual slot limits. A keep clears itself once you wear the piece, or after ${RACK_PIN_DAYS} days at home.</div>
    <div class="frows">${rows}</div>`;
}

/* ---- the second-look sheet ----
   Four answers, each wired to the thing that actually fixes it. She labels it;
   the app never labels it for her. */
function openRackSecondLook(id) {
  const i = itemById.get(id);
  if (!i) return;
  const n = rackSeen()[id] || 0;
  const lvls = (itemFormalitySet(i) || []).map(l => occLabel(l)).filter(Boolean);
  const last = lastWorn(id);
  const row = (key, label, sub) => `<button class="qa-row" data-rsl="${key}" style="display:block;text-align:left;width:100%">
      <div style="font-size:15px">${esc(label)}</div>
      <div class="muted" style="font-size:12.5px;padding-top:2px">${esc(sub)}</div>
    </button>`;
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="rslCancel">Cancel</button>
      <h2>Worth a second look</h2>
      <div style="width:54px"></div>
    </div>
    <div style="display:flex;gap:12px;align-items:center;padding:4px 16px 12px">
      <div style="width:64px;flex:none">${thumbHtml(i.image_path, "cthumb")}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.name || "Untitled")}</div>
        <div class="muted" style="font-size:12.5px;padding-top:2px">On the rack ${n}× without going out${last ? ` · last worn ${esc(fmtDate(last))}` : " · never worn"}</div>
      </div>
    </div>
    <div class="snote" style="padding:0 16px 10px;font-size:12.5px">This isn't a verdict — a piece can sit on the rack for weeks and still be exactly right when the weather turns. It's only worth asking why.</div>
    ${row("formality", "It's wrong for that kind of day", lvls.length ? `Tagged ${lvls.join(", ")} — edit what it's actually for` : "Set what it's actually for")}
    ${row("season", "Wrong time of year", "Edit its seasons")}
    ${row("later", "Not right now", `Off the rack for ${RACK_PUSH_LONG_DAYS} days, then it comes back on its own`)}
    ${row("storage", "I've moved on from it", "Move it to Storage — it stays in your closet and its history is kept")}
    ${row("keep", "Nothing's wrong — keep offering it", "Resets the counter")}
    <div style="height:max(env(safe-area-inset-bottom),16px)"></div>`;
  showSheet("logSheet");
  hydratePhotos($("#logInner"));
  $("#rslCancel").onclick = () => hideSheet("logSheet");
  const after = () => { hideSheet("logSheet"); if (closetRack) renderCloset(); };
  $("#logInner").querySelectorAll("[data-rsl]").forEach(b => b.onclick = async () => {
    const k = b.dataset.rsl;
    if (k === "formality") { hideSheet("logSheet"); await rackClearSeen(id); return openFieldEdit(id, "formality"); }
    if (k === "season")    { hideSheet("logSheet"); await rackClearSeen(id); return openFieldEdit(id, "season"); }
    if (k === "later")     { await pushOffRack(id, { days: RACK_PUSH_LONG_DAYS, quiet: true }); toast("Off the rack for now"); return after(); }
    if (k === "storage")   { await saveField(id, "status", "Storage"); await rackClearSeen(id); toast("Moved to Storage"); return after(); }
    await rackClearSeen(id); toast("Keeping it in play"); after();
  });
}

/* ===================================================================
   FLAGGED FOR REVIEW  (2026-08-03 r6)

   Her ask: "something to flag an item for potential deletion? with maybe a note
   from me — doesn't change anything but adds to a list for review in stats. And
   the app could tell me — would there be any problems if I delete this?"

   ⚠️ "DOESN'T CHANGE ANYTHING" IS THE CONTRACT. A flag is a bookmark, not a
   state: it must never touch suggestions, the rack, laundry, stats pools or
   anything else. It lives in kv (zero new columns) and the ONLY thing that
   reads it is the review list. If a future round is tempted to demote flagged
   pieces in the suggester, that breaks the promise she made this feature under.

   ⚠️ AND IT NEVER RECOMMENDS DELETING. Same tone rule as "worth a second look"
   and "packed 3×, worn 0×": she flags, the app reports consequences, she
   decides. There is no "you should get rid of this" anywhere in here.
   =================================================================== */
const FLAG_KEY = "flagged";
function flaggedAll() { const v = kvData.get(FLAG_KEY); return v && typeof v === "object" ? v : {}; }
const isFlagged = (id) => !!flaggedAll()[id];
const flagNote = (id) => (flaggedAll()[id] || {}).note || "";
function flaggedItems() {
  const all = flaggedAll();
  return Object.keys(all)
    .map(id => ({ item: itemById.get(id), ...all[id] }))
    .filter(x => x.item)
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
}
async function setFlag(id, note) {
  await kvUpdate(FLAG_KEY, prev => {
    const m = { ...(prev && typeof prev === "object" ? prev : {}) };
    m[id] = { at: (m[id] && m[id].at) || todayStr(), note: note || "" };
    return m;
  });
}
async function clearFlag(id) {
  await kvUpdate(FLAG_KEY, prev => {
    const m = { ...(prev && typeof prev === "object" ? prev : {}) }; delete m[id]; return m;
  });
}

/* "Would there be any problems if I delete this?" — the honest answer, derived.

   ⚠️ THE BIG ONE IS THE WEAR HISTORY. `wears.item_id` is
   `references items(id) ON DELETE CASCADE` (schema.sql), so deleting a piece
   permanently deletes every wear ever logged for it. Those days stop existing
   in her stats, her streaks and her calendar. The data is the irreplaceable
   asset here, and nothing in the app said this before. */
function deleteImpact(id) {
  const i = itemById.get(id);
  if (!i) return null;
  const days = new Set(wears.filter(w => w.item_id === id && w.worn_on).map(w => w.worn_on));
  // Days where this is the ONLY thing logged — deleting it erases the day.
  let soloDays = 0;
  for (const d of days) {
    const others = new Set(wears.filter(w => w.worn_on === d && w.item_id !== id).map(w => w.item_id));
    if (!others.size) soloDays++;
  }
  const looks = outfits.filter(o => (outfitItemMap.get(o.id) || []).includes(id));
  // outfit_items cascades too, so a 2-piece look becomes a 1-piece look — which
  // the app outlaws (createLookFromItems guards <2).
  const breaks = looks.filter(o => (outfitItemMap.get(o.id) || []).length <= 2);
  const liked = looks.filter(o => o.rating === 1);
  const caps = capsules.filter(c => (capsuleLinkMap.get(c.id) || []).some(l => l.item_id === id));
  const exc = exclusions.filter(e => e.item_a === id || e.item_b === id);
  return {
    item: i, wearDays: days.size, soloDays,
    firstWorn: [...days].sort()[0] || null,
    looks: looks.length, breaks: breaks.length, breakLooks: breaks, liked: liked.length,
    capsules: caps.length, capsuleNames: caps.map(c => c.name),
    exclusions: exc.length,
    onRack: !!rackBandOf(id),
    price: i.price, cpw: costPerWear(i),
    gaps: deleteGaps(id),
  };
}
/* The other half of "would there be problems if I delete this?" — the WARDROBE
   half (2026-08-03 r7, her correction: "I meant more — gaps in my wardrobe etc").
   r6 answered the data question (history, looks, calendar days) and stopped.

   ⚠️ Reuses buildThinSpots by running it TWICE — the whole closet, then the
   closet minus this piece — and diffing. That is the only way this can't drift
   from the "What's missing" page, which is already the app's answer to "where
   am I thin". A second, parallel coverage derivation would have been free to
   disagree with it.
   ⚠️ A context is only as served as its BINDING slot (twelve tops don't help if
   one pair of shoes covers the level), so only a piece that moves the thinnest
   slot is worth mentioning. Everything else is noise. */
/* ⚠️ Memo scoped to ONE render pass, not the session. buildThinSpots walks
   contexts × the whole closet and the flagged list calls this per card, so the
   baseline is worth computing once — but a stamp on items.length can't see a
   formality or season edit, and a stale baseline would report a gap that isn't
   there. Callers clear it (`_thinBaseMemo = null`) before rendering. */
let _thinBaseMemo = null;
function _thinBase(avail) {
  if (_thinBaseMemo) return _thinBaseMemo;
  return (_thinBaseMemo = buildThinSpots(avail));
}
function deleteGaps(id) {
  const i = itemById.get(id);
  if (!i) return null;
  const avail = items.filter(x => itemStatus(x) === "Available");
  const before = _thinBase(avail);
  const after = buildThinSpots(avail.filter(x => x.id !== id));
  const bMap = new Map(before.map(r => [r.ctx, r]));
  const hits = [];
  for (const r of after) {
    const b = bMap.get(r.ctx);
    if (!b || r.thinnest.n >= b.thinnest.n) continue;   // it wasn't carrying this
    hits.push({
      ctx: r.ctx, lvl: r.lvl, slot: r.thinnest.slot,
      from: b.thinnest.n, to: r.thinnest.n,
      // Crossing the floor is the difference between "one fewer" and "a problem".
      crosses: b.thinnest.n >= GAP_SLOT_FLOOR && r.thinnest.n < GAP_SLOT_FLOOR,
    });
  }
  hits.sort((a, b) => (b.crosses - a.crosses) || (a.to - b.to));

  /* "Could something else do its job?" — same slot, covers every level this one
     covers, and overlaps on at least one season. Deliberately strict: a piece
     that covers FEWER levels isn't a stand-in for this one. */
  const slot = suggestSlot(i);
  const lv = itemFormalitySet(i) || [];
  const seas = itemSeasonSet(i) || [];
  const standIns = slot ? avail.filter(x => {
    if (x.id === id || isNoSuggest(x) || suggestSlot(x) !== slot) return false;
    const xl = itemFormalitySet(x) || [];
    if (!lv.every(l => xl.includes(l))) return false;
    const xs = itemSeasonSet(x) || [];
    return !seas.length || !xs.length || seas.some(s => xs.includes(s));
  }) : [];
  return { hits, standIns: standIns.length, slot, levels: lv, unique: slot && standIns.length === 0 };
}

function deleteImpactHtml(im) {
  if (!im) return "";
  const line = (txt, warn) => `<div style="font-size:13px;line-height:1.5;padding:3px 0;${warn ? "color:var(--text)" : "color:var(--muted)"}">${warn ? "⚠️ " : "· "}${txt}</div>`;
  const bits = [];
  if (im.wearDays) bits.push(line(`<b>${im.wearDays} logged wear${im.wearDays === 1 ? "" : "s"} would be deleted with it</b>${im.firstWorn ? `, going back to ${esc(fmtDate(im.firstWorn))}` : ""}. That history can't be recovered.`, true));
  else bits.push(line("No wears logged, so no history would be lost."));
  if (im.soloDays) bits.push(line(`${im.soloDays} day${im.soloDays === 1 ? "" : "s"} in your calendar would go blank — it's the only thing logged on ${im.soloDays === 1 ? "that day" : "those days"}.`, true));
  if (im.breaks) bits.push(line(`${im.breaks} look${im.breaks === 1 ? "" : "s"} would drop below two pieces and stop being ${im.breaks === 1 ? "a look" : "looks"}.`, true));
  if (im.looks) bits.push(line(`It's in ${im.looks} look${im.looks === 1 ? "" : "s"}${
    im.liked ? (im.looks === 1 ? ", which you've hearted" : `, ${im.liked} of them hearted`) : ""}.`));
  if (im.capsules) bits.push(line(`It's packed in ${esc(im.capsuleNames.slice(0, 3).join(", "))}${im.capsules > 3 ? ` +${im.capsules - 3}` : ""}.`));
  if (im.exclusions) bits.push(line(`${im.exclusions} “don't wear together” pair${im.exclusions === 1 ? "" : "s"} would go with it.`));
  if (im.onRack) bits.push(line("It's on the rack right now."));
  if (im.cpw != null) bits.push(line(`At ${esc(money(im.price))} it's earned its way to ${esc(money(im.cpw))} a wear.`));

  /* The wardrobe half. Kept in its own block under its own heading, because
     "you'd lose 6 wears" and "you'd be short of Symphony shoes" are different
     kinds of answer and running them together buries the second one. */
  const g = im.gaps;
  let gapHtml = "";
  if (g) {
    const gb = [];
    if (g.hits.length) {
      for (const h of g.hits.slice(0, 4)) {
        gb.push(line(`<b>${esc(h.ctx)}</b> would be down to <b>${h.to}</b> ${esc(String(h.slot).toLowerCase())} at ${esc(occLabel(h.lvl))}${h.crosses ? " — that's below what it takes to build around" : ""}.`, h.crosses));
      }
    }
    if (g.unique) gb.push(line(`Nothing else in your closet covers the same ${esc(String(g.slot).toLowerCase())} at ${esc((g.levels || []).map(l => occLabel(l)).filter(Boolean).join(" / ") || "that level")}.`, true));
    else if (g.standIns) gb.push(line(`${g.standIns} other piece${g.standIns === 1 ? "" : "s"} could stand in for it — same slot, same levels, overlapping season.`));
    if (!gb.length) gb.push(line("Nothing in your rotation gets thin without it."));
    gapHtml = `<div class="section-label" style="margin-top:12px">And in the wardrobe</div><div>${gb.join("")}</div>`;
  }
  /* The alternative, stated plainly. Storage keeps every wear, every look and
     every number, and takes the piece out of the closet and out of suggestions —
     which is what "I'm done with this" usually actually means. */
  return `<div>${bits.join("")}</div>${gapHtml}
    <div class="snote" style="margin-top:10px;padding:9px 11px;background:var(--panel);border-radius:10px;font-size:12.5px;line-height:1.5">
      <b>Storage does most of this without losing anything.</b> It takes the piece out of your closet and out of suggestions, and keeps every wear, look and number attached to it.
    </div>`;
}

/* The flag sheet: a note, and the consequences, in one place. */
function openFlagSheet(id) {
  const i = itemById.get(id);
  if (!i) return;
  _thinBaseMemo = null;
  const im = deleteImpact(id);
  const on = isFlagged(id);
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="flagCancel">Cancel</button>
      <h2>${on ? "Flagged for review" : "Flag for review"}</h2>
      <button class="lnk" id="flagSave" style="font-weight:700">Save</button>
    </div>
    <div style="display:flex;gap:12px;align-items:center;padding:2px 16px 12px">
      ${thumbHtml(i.image_path, "sthumb")}
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.name || "Untitled")}</div>
        <div class="muted" style="font-size:12.5px">Nothing changes — it just joins a list you can review in Stats.</div>
      </div>
    </div>
    <div style="padding:0 16px 12px">
      <textarea class="det-notes-ta" id="flagNote" placeholder="Why? (optional — e.g. never fits right, elbows worn through)">${esc(flagNote(id))}</textarea>
    </div>
    <div style="padding:0 16px 10px">
      <div class="section-label">What you'd lose</div>
      ${deleteImpactHtml(im)}
    </div>
    ${on ? `<div style="padding:12px 16px 0"><button class="btn btn-sec" id="flagRemove">Remove the flag</button></div>` : ""}
    <div style="height:max(env(safe-area-inset-bottom),18px)"></div>`;
  showSheet("logSheet");
  hydratePhotos($("#logInner"));
  const done = () => { hideSheet("logSheet"); if (detailId === id) openItem(id); else if (statsView === "flagged") renderStats(); };
  $("#flagCancel").onclick = () => hideSheet("logSheet");
  $("#flagSave").onclick = async () => { await setFlag(id, $("#flagNote").value.trim()); toast("Flagged for review"); done(); };
  const rm = $("#flagRemove");
  if (rm) rm.onclick = async () => { await clearFlag(id); toast("Flag removed"); done(); };
}

// ---- the rack screen (closet shelf, same shape as Worn / Hamper) ----
// Session-only, and reset on every entry to the screen: the app never quietly
// stays folded OR quietly stays open, same rule as _sugg.wholeCloset.
let _rackExtrasOpen = false;
function renderClosetRack() {
  const list = rackItems();
  const eff = rackEffective();
  const st = rackState();
  const byId = new Map(list.map(i => [i.id, i]));
  const band = (set) => [...set].map(id => byId.get(id)).filter(Boolean);
  const inRot = band(eff.rotation), inSteady = band(eff.steady), inDorm = band(eff.dormant);
  const due = st.built ? Math.max(0, RACK_REBUILD_DAYS - daysBetween(st.built, todayStr())) : 0;
  const shown = st.revised || st.built;
  const note = st.built
    ? `Last shuffled ${st.built === todayStr() ? "today" : fmtDate(st.built)}${due ? ` · next in ${due} day${due === 1 ? "" : "s"}` : " · due now"}${shown && shown !== st.built ? ` · topped up ${shown === todayStr() ? "today" : fmtDate(shown)}` : ""}.`
    : `Derived from what's in season and what you've been reaching for.`;

  /* Three labelled sections, because the bands ARE the picture of the wardrobe —
     what's in play, what's still in the mix, and what's gone quiet. Nothing is
     repeated between them; the same tile twice on one screen reads as a bug
     rather than as emphasis. */
  const sec = (title, sub, arr) => arr.length
    ? `<div class="snote" style="padding:14px 16px 2px"><b>${esc(title)} · ${arr.length}</b><div style="font-size:12.5px;padding-top:2px">${esc(sub)}</div></div>` + gridHtml(arr)
    : "";

  const second = rackPassedOver();
  const secondBlock = second.length
    ? `<div class="snote" style="padding:16px 16px 2px"><b>Worth a second look · ${second.length}</b>
         <div style="font-size:12.5px;padding-top:2px">On the rack ${RACK_SEEN_LIMIT}+ times and still not worn. Not a verdict — just worth asking why.</div></div>
       <div style="padding:6px 16px 0">
         ${second.slice(0, 12).map(({ item, n }) => `<button data-rsecond="${esc(item.id)}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:7px 0;border-bottom:1px solid var(--line)">
           ${thumbHtml(item.image_path, "sthumb")}
           <span style="flex:1;min-width:0">
             <span style="display:block;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.name || "Untitled")}</span>
             <span class="muted" style="display:block;font-size:12px">offered ${n}× · not worn</span>
           </span>
           <svg class="chev" viewBox="0 0 24 24" style="flex:none"><path d="M9 6l6 6-6 6"/></svg>
         </button>`).join("")}
       </div>`
    : "";

  /* Everything below the three bands is BOOKKEEPING, not the rack (her ask:
     "bottom part showing exclusions etc should be collapsible"). The bands are
     the answer to "what's in play"; the second-look list, the keeps and the
     taken-off list are all answers to "what have I told it", and each one is a
     list she scrolls past every time to reach the Rebuild link. Collapsed by
     default, count on the label so nothing goes invisible, session-only so it
     never becomes another thing to maintain. */
  const extras = secondBlock + rackPinnedListHtml() + rackOffSectionHtml();
  const extraN = second.length + rackPinnedSet().size + rackOffList().length;
  const extrasBlock = extras
    ? `<div style="padding:18px 16px 0">
         <button class="btn-sec" id="rackExtras" style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px">
           <span>Pieces you've weighed in on · ${extraN}</span>
           <span class="muted" style="font-size:13px">${_rackExtrasOpen ? "Hide" : "Show"}</span>
         </button>
       </div>`
      + (_rackExtrasOpen ? extras : "")
    : "";

  const body = list.length
    ? sec("In rotation", "What you've actually been reaching for.", inRot)
      + sec("Steady", "You wear these — just not this week. This band exists so the middle of your wardrobe doesn't go invisible.", inSteady)
      + sec("Haven't reached for these lately", "Deliberately kept in, so the rack can't quietly shrink your wardrobe. These rotate, and they lean toward the kinds of days you actually have — clothes for rarer occasions take a slot or two at most.", inDorm)
      + extrasBlock
    : `<div class="placeholder" style="padding:40px 32px"><b>Rack not built yet</b>
        <div>It fills itself from what's in season and what you've been wearing.</div></div>`
      + extrasBlock;
  return clToolbar(`The rack · ${list.length}`, true, false)
    + `<div class="snote" style="padding:8px 16px 2px">${esc(note)} Open a piece to pull it in or push it out — you never have to maintain this.</div>`
    + body
    + `<div style="padding:18px 0 32px;text-align:center">
         <button class="lnk" id="rackRebuild" style="color:var(--muted);font-size:14px">Rebuild now</button>
         · <button class="lnk" id="clRootJump" style="color:var(--muted);font-size:14px">Closet</button>
       </div>`;
}
