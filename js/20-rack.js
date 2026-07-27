/* ===================================================================
   THE RACK  (2026-07-26)

   A standing ~60-piece derived pool — "what's actually in play right now" —
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
        would cause the thing it measures. RACK_COLD_SHARE is the answer and is
        LOAD-BEARING, not a nicety — a fixed fraction of every slot is reserved
        for pieces she has NOT reached for lately. Do not "optimise" it away.

   LAUNDRY IS DELIBERATELY IGNORED HERE. If dirty pieces fell off the rack it
   would churn daily and stop being a thing she can recognise. The suggester's
   own cleanOnly filter still applies on top, so a dirty piece is on the rack
   and simply isn't suggested today.
   =================================================================== */

const RACK_KEY = "rack";
// Per-slot quotas, not a flat top-60: a 60-piece rack that happens to be 45
// tops cannot build an outfit. These sum to ~46 and formality top-ups take it
// toward 60.
const RACK_SLOT_QUOTA = { Tops: 16, Bottoms: 11, Dresses: 5, Shoes: 9, Outerwear: 5 };
const RACK_COLD_SHARE = 0.20;   // ⚠️ load-bearing — see the header note
const RACK_WARM_DAYS = 60;      // "recently reached for"
const RACK_REBUILD_DAYS = 7;    // stability is a feature; don't reshuffle daily
const RACK_PUSH_DAYS = 42;      // a push-out expires, so a summer no doesn't haunt October
const RACK_LOOKAHEAD_DAYS = 14; // how far ahead declared plans stock the rack
const RACK_LEVEL_MIN = 2;       // per core slot, per level she'll actually need

// ---- stored state (kv "rack") ----
// { built: "YYYY-MM-DD", ids: [...], cold: [...], pinned: [...], pushed: {id: date} }
function rackState() {
  const v = kvData.get(RACK_KEY);
  return v && typeof v === "object" ? v : {};
}
function rackPinnedSet() { return new Set(rackState().pinned || []); }
// Push-outs expire on their own so the rack can't be permanently narrowed by a
// decision she made in another season and forgot about.
function rackPushedSet(today = todayStr()) {
  const cut = shiftDate(today, -RACK_PUSH_DAYS);
  const out = new Set();
  for (const [id, d] of Object.entries(rackState().pushed || {})) if (d > cut) out.add(id);
  return out;
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
   smaller capsule. */
function rackNeededLevels(today = todayStr(), plans = null, wearRows = null) {
  const rows = wearRows || wears;
  const all = plans || dayPlanAll();
  const levels = new Set();
  for (let k = 0; k <= RACK_LOOKAHEAD_DAYS; k++) {
    const d = shiftDate(today, k);
    for (const e of (all[d] || [])) {
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

// How "warm" a piece is: 1 = worn today, 0 = not worn inside RACK_WARM_DAYS.
function rackWarmth(itemId, today = todayStr()) {
  const last = lastWorn(itemId);
  if (!last) return 0;
  const d = daysBetween(last, today);
  if (d < 0 || d > RACK_WARM_DAYS) return 0;
  return (RACK_WARM_DAYS - d) / RACK_WARM_DAYS;
}

/* Build the rack. Pure apart from its defaults, so the selftest can drive it.
   Returns { ids, cold, slots, levels } — `cold` is the rediscovery subset and
   is surfaced in the UI, because the thing that keeps the rack honest is also
   the nicest thing about it. */
function buildRack({ pool = null, wearRows = null, today = todayStr(), season = null,
                     wx = null, plans = null, pinned = null, pushed = null } = {}) {
  const rows = wearRows || wears;
  const seas = season || currentSeason();
  const pin = pinned || rackPinnedSet();
  const push = pushed || rackPushedSet(today);
  const liked = (typeof likedLookItemIds === "function") ? likedLookItemIds() : new Set();

  // Candidates mirror the suggester's own normal-mode pool so the rack can never
  // offer something the engine would refuse. Laundry is NOT considered — see header.
  const base = (pool || items).filter(i =>
    i && itemStatus(i) === "Available" && i.image_path &&
    !isNoSuggest(i) &&
    i.category !== "Workout" && !push.has(i.id));

  const eligible = base.filter(i => inSeasonWx(i, seas, wx));
  const levels = rackNeededLevels(today, plans, rows);

  // Deterministic ordering: same inputs, same rack. Stability is the point —
  // she should come to recognise it, and a rack that reshuffles every open is
  // just a random sample with extra steps.
  const score = i => rackWarmth(i.id, today) + (liked.has(i.id) ? 0.15 : 0);
  const byWarm = (a, b) => (score(b) - score(a)) || (a.id < b.id ? -1 : 1);
  // Cold pick order: most-loved-but-not-lately first. "You used to wear this a
  // lot and haven't in a while" is a better rediscovery than a random stranger.
  const byCold = (a, b) => (wearCount(b.id) - wearCount(a.id)) || (a.id < b.id ? -1 : 1);

  const slotOf = i => (isLayer(i) && i.category === "Tops") ? "Tops" : suggestSlot(i);
  const ids = new Set();
  const cold = new Set();

  for (const [slot, quota] of Object.entries(RACK_SLOT_QUOTA)) {
    const inSlot = eligible.filter(i => slotOf(i) === slot ||
      (slot === "Outerwear" && isLayer(i) && i.category === "Tops"));
    const warmList = inSlot.filter(i => score(i) > 0).sort(byWarm);
    const coldList = inSlot.filter(i => score(i) === 0).sort(byCold);
    const nCold = Math.max(1, Math.round(quota * RACK_COLD_SHARE));
    const nWarm = quota - nCold;
    const takenWarm = warmList.slice(0, nWarm);
    const takenCold = coldList.slice(0, nCold);
    // Backfill from whichever side has slack, so a thin slot still fills.
    const short = quota - takenWarm.length - takenCold.length;
    const extra = short > 0
      ? [...warmList.slice(takenWarm.length), ...coldList.slice(takenCold.length)].slice(0, short)
      : [];
    for (const i of takenWarm) ids.add(i.id);
    for (const i of takenCold) { ids.add(i.id); cold.add(i.id); }
    for (const i of extra) ids.add(i.id);
  }

  // Formality top-up: for every level she'll actually need, make sure each core
  // slot can cover it. This is what stops "Dressed Up" returning an empty sheet.
  for (const lv of levels) {
    for (const slot of ["Tops", "Bottoms", "Shoes"]) {
      const covers = i => (itemFormalitySet(i) || []).includes(lv);
      const have = [...ids].map(id => itemById.get(id)).filter(i => i && slotOf(i) === slot && covers(i)).length;
      if (have >= RACK_LEVEL_MIN) continue;
      const add = eligible
        .filter(i => !ids.has(i.id) && slotOf(i) === slot && covers(i))
        .sort(byWarm)
        .slice(0, RACK_LEVEL_MIN - have);
      for (const i of add) ids.add(i.id);
    }
  }

  // A pinned piece is always in play — that's what pinning means. It bypasses
  // season and slot quotas, but not "does this item still exist and is wearable".
  for (const id of pin) {
    const i = itemById.get(id);
    if (i && itemStatus(i) === "Available") { ids.add(id); cold.delete(id); }
  }

  const slots = new Map();
  for (const id of ids) {
    const i = itemById.get(id);
    const s = i ? (slotOf(i) || "Other") : "Other";
    slots.set(s, (slots.get(s) || 0) + 1);
  }
  return { ids: [...ids], cold: [...cold], slots, levels };
}

// ---- the live rack (stored, rebuilt on a cadence) ----
let _rackMemo = null;
function rackIsStale(st = rackState(), today = todayStr()) {
  if (!st.built || !Array.isArray(st.ids) || !st.ids.length) return true;
  if (daysBetween(st.built, today) >= RACK_REBUILD_DAYS) return true;
  return st.season !== currentSeason();   // a season flip must not wait a week
}
/* Rebuild if due, otherwise return what's stored. Nudges (pin/push) rebuild
   immediately so the change is visible at once. */
async function rackEnsure({ force = false } = {}) {
  const st = rackState();
  if (!force && !rackIsStale(st)) return st;
  const built = buildRack({ wx: (_homeWx && _homeWx.date === todayStr()) ? _homeWx.wx : null });
  const next = {
    built: todayStr(), season: currentSeason(),
    ids: built.ids, cold: built.cold,
    pinned: [...rackPinnedSet()], pushed: rackState().pushed || {},
  };
  _rackMemo = null;
  await kvUpdate(RACK_KEY, prev => ({ ...(prev || {}), ...next }));
  return next;
}
/* The effective rack: what's stored, or a fresh derivation when nothing is
   stored yet. Both ids AND the cold subset come from the SAME source — reading
   ids from the fallback build while reading cold from empty stored state made
   the rediscovery block silently vanish on first open, which is the one part of
   this feature that must never quietly disappear. */
function rackEffective() {
  if (_rackMemo && _rackMemo.stamp === rackStamp()) return _rackMemo.eff;
  const st = rackState();
  const eff = (Array.isArray(st.ids) && st.ids.length)
    ? { ids: st.ids, cold: new Set(st.cold || []) }
    : (() => { const b = buildRack(); return { ids: b.ids, cold: new Set(b.cold) }; })();
  _rackMemo = { stamp: rackStamp(), eff };
  return eff;
}
// Item objects on the rack, in closet order.
function rackItems() {
  return rackEffective().ids.map(id => itemById.get(id)).filter(i => i && itemStatus(i) === "Available");
}
const rackStamp = () => {
  const st = rackState();
  return `${st.built || ""}|${(st.ids || []).length}|${(st.pinned || []).length}|${Object.keys(st.pushed || {}).length}|${items.length}`;
};
const isOnRack = (id) => rackItems().some(i => i.id === id);
const rackColdSet = () => rackEffective().cold;

// ---- nudges ----
// Pull in: an explicit yes. Survives every rebuild until she pushes it back out.
async function pullOntoRack(id) {
  const i = itemById.get(id);
  if (!i) return;
  await kvUpdate(RACK_KEY, prev => {
    const st = prev && typeof prev === "object" ? prev : {};
    const pinned = new Set(st.pinned || []); pinned.add(id);
    const pushed = { ...(st.pushed || {}) }; delete pushed[id];
    const ids = new Set(st.ids || []); ids.add(id);
    return { ...st, pinned: [...pinned], pushed, ids: [...ids] };
  });
  _rackMemo = null;
  toast(`${i.name || "Piece"} is on the rack`);
}
// Push out: "not right now". Expires by itself (RACK_PUSH_DAYS).
async function pushOffRack(id) {
  const i = itemById.get(id);
  if (!i) return;
  await kvUpdate(RACK_KEY, prev => {
    const st = prev && typeof prev === "object" ? prev : {};
    const pinned = new Set(st.pinned || []); pinned.delete(id);
    const pushed = { ...(st.pushed || {}), [id]: todayStr() };
    const ids = (st.ids || []).filter(x => x !== id);
    return { ...st, pinned: [...pinned], pushed, ids };
  });
  _rackMemo = null;
  toast(`Off the rack for now`, { label: "Undo", fn: () => pullOntoRack(id) });
}

// ---- the rack screen (closet shelf, same shape as Worn / Hamper) ----
function renderClosetRack() {
  const list = rackItems();
  const cold = rackColdSet();
  const st = rackState();
  const coldList = list.filter(i => cold.has(i.id));
  const note = st.built
    ? `Put together ${st.built === todayStr() ? "today" : fmtDate(st.built)} from what's clean-ish, in season, and what you've been reaching for.`
    : `Derived from what's in season and what you've been reaching for.`;
  // Cold pieces lead, and are NOT repeated in the grid below — the same tile
  // twice on one screen reads as a bug, not as emphasis.
  const rest = list.filter(i => !cold.has(i.id));
  const coldBlock = coldList.length
    ? `<div class="snote" style="padding:10px 16px 2px">✨ <b>${coldList.length} you haven't reached for lately</b> — deliberately kept in, so the rack can't quietly shrink your wardrobe.</div>`
      + gridHtml(coldList)
      + `<div class="snote" style="padding:14px 16px 2px"><b>The rest of the rack</b></div>`
    : "";
  const body = list.length
    ? coldBlock + gridHtml(rest)
    : `<div class="placeholder" style="padding:40px 32px"><b>Rack not built yet</b>
        <div>It fills itself from what's in season and what you've been wearing.</div></div>`;
  return clToolbar(`The rack · ${list.length}`, true, false)
    + `<div class="snote" style="padding:8px 16px 2px">${esc(note)} Open a piece to pull it in or push it out — you never have to maintain this.</div>`
    + body
    + `<div style="padding:18px 0 32px;text-align:center">
         <button class="lnk" id="rackRebuild" style="color:var(--muted);font-size:14px">Rebuild now</button>
         · <button class="lnk" id="clRootJump" style="color:var(--muted);font-size:14px">Closet</button>
       </div>`;
}
