/* ===================================================================
   APP STATE + DATA LOADING
   =================================================================== */
let items = [];   // all items (every status)
let wears = [];   // all wears
let outfits = [];      // all outfits (saved sets of items worn together)
let outfitLinks = [];  // outfit_items join rows {outfit_id, item_id}
let capsules = [];     // capsule rows {id,name,kind,start_date,end_date,notes,...}
let capsuleLinks = []; // capsule_items join rows {capsule_id, item_id, packed}
let kvData = new Map(); // kv table: key -> jsonb value (Round A small-state store)
let dataReady = false;

// Derived indexes (rebuilt by buildOutfitIndexes after each load).
let itemById = new Map();        // item id -> item
let outfitById = new Map();      // outfit id -> outfit
let outfitItemMap = new Map();   // outfit id -> [item id]
let outfitWearMap = new Map();   // outfit id -> Set(worn_on)
let capsuleById = new Map();     // capsule id -> capsule
let capsuleLinkMap = new Map();  // capsule id -> [link rows {item_id, packed}]
let exclusions = [];             // exclusion pairs {item_a, item_b, reason}
let _excludeSet = new Set();     // "a:b" canonical pairs for O(1) lookup

// PostgREST/Supabase caps a single response at 1000 rows; page through the rest.
async function restAll(path) {
  const PAGE = 1000;
  let out = [], offset = 0;
  for (;;) {
    const sep = path.includes("?") ? "&" : "?";
    const chunk = await rest(`${path}${sep}limit=${PAGE}&offset=${offset}`);
    if (!chunk || chunk.length === 0) break;
    out = out.concat(chunk);
    if (chunk.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

async function loadData() {
  dataReady = false;
  const [it, wr, of, oi, cp, ci, ex, kv] = await Promise.all([
    restAll("items?select=*&order=created_at.desc"),
    restAll("wears?select=*&order=worn_on.desc"),
    restAll("outfits?select=*&order=created_at.desc"),
    restAll("outfit_items?select=outfit_id,item_id"),
    restAll("capsules?select=*&order=created_at.desc"),
    restAll("capsule_items?select=*"),  // includes `packed` once that column exists
    restAll("exclusions?select=*").catch(() => []),
    restAll("kv?select=key,value").catch(() => []),  // Round A small-state store
  ]);
  items = it || [];
  wears = wr || [];
  outfits = of || [];
  outfitLinks = oi || [];
  capsules = cp || [];
  capsuleLinks = ci || [];
  exclusions = ex || [];
  kvData = new Map((kv || []).map(r => [r.key, r.value]));
  applyTaxonomyOverride();
  buildOutfitIndexes();
  buildCapsuleIndexes();
  buildExcludeSet();
  buildSuggestIndexes();
  dataReady = true;
  // Trip mode persists across sessions; re-assert the scope (or self-clear if
  // the capsule is gone). Runs on every load — idempotent.
  if (tripModeId) {
    if (capsuleById.get(tripModeId)) activeCapsuleId = tripModeId;
    else { tripModeId = null; store.removeItem(TRIP_MODE_KEY); if (activeCapsuleId) activeCapsuleId = null; }
  }
  saveDataSnapshot();   // fire-and-forget — instant hydration on next boot
}

/* ---- kv store (Round A "Tomorrow", 2026-07-20) ----
   Tiny per-user key/value rows (migration/kv_store.sql) for small app state
   that isn't item/wear/outfit shaped. Loaded with everything else; writes are
   optimistic upserts. Keys: dayplan · wxlog · wherelog · taxonomy · milestones ·
   tmpick · wxaudit_ok · beststreak · capsarchive · wxbackfill.

   ⚠️ Each key is ONE JSONB blob that gets rewritten whole, so a bare kvSet is
   last-write-wins ACROSS DEVICES — and silently. Phone and laptop both load
   {A}; phone writes {A,B}; laptop writes {A,C} and B is gone, with no error
   anywhere (2026-07-26 audit H2). She uses both, and the snapshot cache makes
   it likelier still: a tab can hydrate a week-old snapshot and write it back.

   So: kvSet ONLY for values that don't depend on what's already stored (a date
   marker, a flag). Anything that reads-then-writes must use kvUpdate. */
async function kvSet(key, value) {
  kvData.set(key, value);  // optimistic
  try {
    await kvPost(key, value);
    saveDataSnapshot();
  } catch (e) { toast(e.message); }
}
/* When she last exported her data — kv-backed, not device-backed (2026-08-14).

   ⚠️ This lived only in localStorage, so "no backup yet" was a claim about the
   BROWSER, not about her data. Opening the app anywhere new asserted she had
   never backed up 4,000+ wears, and a device that had backed up stayed quiet
   even if the export was a year old elsewhere. Same class as the Travel stamp
   reading a per-device toggle: a fact about her, stored as a preference.
   The old local value is still READ as a fallback, so a device that already has
   one doesn't start nagging before kv loads (or if it never does). */
function lastBackupDate() {
  return kvData.get("lastBackup") || store.getItem("wardrobe.lastBackup") || null;
}
function setLastBackupDate(d) {
  store.setItem("wardrobe.lastBackup", d);   // instant local read; kv is the truth
  kvSet("lastBackup", d);                    // fire-and-forget, like every other kv write
}
async function kvPost(key, value) {
  return rest("/kv", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ user_id: session.user.id, key, value }]),
  });
}
/* Read-modify-write for one kv key, safe against a concurrent writer.
   `mutate(current) -> next` must be re-runnable: it is applied once optimistically
   (so the UI can render straight away) and, if the server turns out to have moved
   on since we loaded, applied a SECOND time on top of the server's value instead
   of overwriting it. Additive edits — add a plan, stamp a milestone, log a day's
   weather — therefore survive on both devices.

   The kv table has no version column and adding one needs a migration she'd have
   to run, so the freshness check is a re-read of the row. If that read fails
   (offline) we keep the optimistic value and write it: the old behaviour, which
   is the right fallback since the alternative is losing her edit outright. */
async function kvUpdate(key, mutate) {
  const base = kvData.get(key);
  let next = mutate(base);
  kvData.set(key, next);  // optimistic
  try {
    let remote = null;
    try {
      const rows = await rest(`/kv?select=value&key=eq.${encodeURIComponent(key)}`);
      remote = { value: Array.isArray(rows) && rows.length ? rows[0].value : undefined };
    } catch (e) { /* offline / unreachable — fall through with the optimistic value */ }
    if (remote && !kvSameValue(remote.value, base)) {
      next = mutate(remote.value);
      kvData.set(key, next);
    }
    await kvPost(key, next);
    saveDataSnapshot();
  } catch (e) { toast(e.message); }
  return next;
}
// Structural equality over kv blobs. Key order is stable here because every
// value is either built by object spread from the previous one or is an array.
function kvSameValue(a, b) {
  return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
}

/* ---- editable taxonomy (2026-07-21) ----
   kvData("taxonomy") = { cats: {Category: [subs]}, meta: {sub: {formality, tolerance}} }.
   `meta` carries the built-in defaults of a RENAMED subcategory across its new
   name, so renaming "Cocktail" → "Evening" doesn't silently drop that type's
   formality seed / laundry tolerance. */
const TAXONOMY_KEY = "taxonomy";
function applyTaxonomyOverride() {
  const v = kvData.get(TAXONOMY_KEY);
  const cats = v && v.cats && typeof v.cats === "object" ? v.cats : null;
  TAXONOMY = cats ? JSON.parse(JSON.stringify(cats)) : JSON.parse(JSON.stringify(TAXONOMY_DEFAULT));
  CATEGORIES = Object.keys(TAXONOMY);
  for (const [sub, m] of Object.entries((v && v.meta) || {})) {
    if (m && m.formality && !(sub in SUBCAT_FORMALITY)) SUBCAT_FORMALITY[sub] = m.formality;
    if (m && m.tolerance != null && !(sub in WEAR_TOLERANCE)) WEAR_TOLERANCE[sub] = m.tolerance;
  }
}
async function saveTaxonomy(cats, meta) {
  await kvUpdate(TAXONOMY_KEY, prev => ({
    cats, meta: { ...(((prev || {}).meta) || {}), ...(meta || {}) },
  }));
  applyTaxonomyOverride();
}

/* Day plans: kvData("dayplan") = { "<YYYY-MM-DD>": [entry, ...] } where an
   entry is { contexts: [names], outfit: <outfit id>|null }. One outfit worn
   across contexts = one entry with several contexts; an outfit change = a
   second entry. Entries with outfit null are "context set, outfit TBD".
   Intentions only, never wears — logging converts (see wearPlannedEntry). */
const DAYPLAN_KEY = "dayplan";
const DAYPLAN_KEEP_PAST = 7, DAYPLAN_KEEP_FUTURE = 30;
function dayPlanAll() { const v = kvData.get(DAYPLAN_KEY); return v && typeof v === "object" ? v : {}; }
function dayPlan(date) { const v = dayPlanAll()[date]; return Array.isArray(v) ? v : []; }
/* Pure so the selftest can cover the prune window (today + trips injectable).
   ⚠️ Dates inside a DATED CAPSULE are exempt from the 30-day future window.
   Trips get booked months out, and the trip builder puts the day slate here — so
   without this, declaring "wedding, Sept 14" in July silently deleted it on the
   next save. It also fixed a latent bug: planning a far-out trip in the week
   planner lost the plan for the same reason. Growth stays bounded because the
   exemption is scoped to real capsule date ranges. */
function pruneDayPlan(all, today, caps = null) {
  const lo = shiftDate(today, -DAYPLAN_KEEP_PAST), hi = shiftDate(today, DAYPLAN_KEEP_FUTURE);
  const keep = [];
  for (const c of (caps || (typeof capsules !== "undefined" ? capsules : []) || [])) {
    if (c && c.start_date && c.end_date) keep.push([c.start_date, c.end_date]);
  }
  const inTrip = (d) => keep.some(([a, b]) => d >= a && d <= b);
  for (const d of Object.keys(all)) {
    if (!(all[d] || []).length) { delete all[d]; continue; }
    if ((d < lo || d > hi) && !inTrip(d)) delete all[d];
  }
  return all;
}
async function saveDayPlan(date, entries) {
  // Only THIS date is being set — a plan made on the phone for another day must
  // survive (see kvUpdate).
  await kvUpdate(DAYPLAN_KEY, prev => {
    const all = JSON.parse(JSON.stringify(prev && typeof prev === "object" ? prev : {}));
    all[date] = entries || [];
    return pruneDayPlan(all, todayStr());
  });
  /* Declaring an event is exactly when the rack should learn about it — her
     question, "if I add a context not included in the rack, will the rack
     automatically expand/revise itself right then?" rackIsStale now compares
     the needed levels against the ones the stored rack was built for, so this
     is a no-op unless the plan actually introduced a level it can't dress. */
  if (typeof rackEnsure === "function") rackEnsure().catch(() => {});
}
// Suggest level for a multi-context entry: every context's usual level when
// they agree; the dressier one when they don't (safer to be the overdressed
// person at campus than underdressed at dinner). Null = no signal.
function entrySuggestLevel(ctxs) {
  const lvls = (ctxs || []).map(c => contextFormalityLevel(c)).filter(Boolean);
  return lvls.length ? Math.max(...lvls) : null;
}
// The Workout-mapped context runs the suggester in activity mode instead.
// Attach a look to a day plan: fills the targeted entry's outfit slot, or
// appends a fresh context-less entry when no entry was targeted.
async function addKvPlanLook(date, outfitId, entryIdx = null) {
  const entries = JSON.parse(JSON.stringify(dayPlan(date)));
  if (entryIdx != null && entries[entryIdx]) entries[entryIdx].outfit = outfitId;
  else entries.push({ contexts: [], outfit: outfitId });
  await saveDayPlan(date, entries);
}

/* ---- Day-plan editor (Round A) --------------------------------------------
   Plan any day: entries of contexts + an optional look. Rendered into
   #logSheet like the other pickers. Close re-renders the screen beneath
   (the post-log staleness lesson). */
function _dpWx(date) {
  if (_planWx[date]) return _planWx[date];
  if (_homeWx.date === todayStr()) {
    if (date === todayStr()) return _homeWx.wx;
    if (date === shiftDate(todayStr(), 1)) return _homeWx.wx2;
  }
  return null;
}
function _dpSuggestCtx(date, entryIdx, ctxs) {
  const wx = _dpWx(date);
  if (wx) _planWx[date] = wx;  // openSuggestSheet reads _planWx[planCtx.date]
  // The Workout CONTEXT survives r13's removal of activity mode: it maps to
  // formality 1 through CONTEXT_FORMALITY_SEED like every other context, so a
  // planned workout day asks for Utility without a special case.
  return { kv: true, date, entryIdx, level: entrySuggestLevel(ctxs) };
}
/* ⚠️ THE DAY-PLAN EDITOR IS GONE (2026-08-21) — `openDayPlanSheet`, its context
   multi-select, its per-entry Pick / ✨ Suggest / ✎ Build rows, `_dpAddCtx` and
   the look picker behind it. Her ask: remove the planning-ahead features
   entirely, except being able to set an outfit for a future day FROM THE
   SUGGESTER.

   That one path is untouched and is now the only writer: the suggester's day
   chips set `_sugg.forDate`, `_suggPlanCtx()` synthesises the same `{kv, date}`
   context this editor used to pass, and "Plan for Thu" calls `addKvPlanLook`.
   The store (`kv "dayplan"`), the pruning window and `wearPlannedEntry` all stay
   — a plan she sets still shows on that day in the calendar, and still logs in
   one tap when the day comes.

   ⚠️ WHAT WENT WITH IT: declaring a CONTEXT for a future day. Nothing writes
   `entry.contexts` any more, so `rackNeededLevels`/`rackDeclaredLevels` see only
   what a trip's fixed events write (`saveCapsuleForm`, still live) plus her
   habitual levels. That is a real narrowing of the rack's forward look and it is
   deliberate — the control that fed it was a planning screen. */

// Log a planned entry as actually worn: wear rows carry ALL the entry's
// contexts (multi-context days were the point — one outfit across contexts).
async function wearPlannedEntry(date, entryIdx) {
  const entry = dayPlan(date)[entryIdx];
  const o = entry && entry.outfit ? outfitById.get(entry.outfit) : null;
  if (!o) return;
  const its = outfitItems(o);
  if (!its.length) { toast("This look has no pieces"); return; }
  if (wears.some(w => w.outfit_id === o.id && w.worn_on === date)) { toast("Already logged that day"); return; }
  try {
    const fml = deriveWearFormality(its.map(it => it.id));
    const twc = tripWearContext(date, its.map(it => it.id));
    const ctx = [...new Set([...(entry.contexts || []), ...(twc || [])])];
    const payload = its.map(it => ({ item_id: it.id, worn_on: date, outfit_id: o.id, formality_for: fml, ...(ctx.length ? { context: ctx } : {}) }));
    const rows = await rest("/wears", {
      method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    if (Array.isArray(rows)) wears.push(...rows); else payload.forEach(p => wears.push(p));
    buildOutfitWearMap();
    tripPlanSync(o.id, date);
    if (Array.isArray(rows) && rows.length && rows[0].id) {
      logCelebration(rows, { defer: true });
      openPostLogSheet(rows, { presetCtx: entry.contexts || [], undoable: true });
    } else { toast(logCelebration(payload) || "Logged as worn"); if (activeTabName() === "home") renderHome(); }
  } catch (e) { toast(e.message); }
}

// Rebuild capsule lookup maps. Called after each load + after any mutation.
function buildCapsuleIndexes() {
  // The per-piece travel record is memoised on a LENGTH stamp, which cannot see a
  // trip's dates moving in place. Every capsule mutation lands here, so this is
  // the one place that can't be forgotten (2026-08-16).
  if (typeof invalidateTravelRecord === "function") invalidateTravelRecord();
  capsuleById = new Map(capsules.map(c => [c.id, c]));
  capsuleLinkMap = new Map();
  for (const l of capsuleLinks) {
    let a = capsuleLinkMap.get(l.capsule_id);
    if (!a) { a = []; capsuleLinkMap.set(l.capsule_id, a); }
    a.push(l);
  }
}
// Item objects belonging to a capsule (skips dangling links).
function capsuleItems(cid) {
  return (capsuleLinkMap.get(cid) || []).map(l => itemById.get(l.item_id)).filter(Boolean);
}
// Capsule ids an item belongs to.
function capsulesForItem(itemId) {
  return capsuleLinks.filter(l => l.item_id === itemId).map(l => l.capsule_id);
}
// Capsule names an item belongs to (for search filter matching).
function capsuleNamesForItem(itemId) {
  return capsulesForItem(itemId).map(cid => capsuleById.get(cid)?.name).filter(Boolean);
}
function capsuleItemCount(cid) { return capsuleItems(cid).length; }

// Rebuild the lookup maps + per-outfit derived caches. Called after each load.
function buildOutfitIndexes() {
  itemById = new Map(items.map(i => [i.id, i]));
  outfitById = new Map(outfits.map(o => [o.id, o]));
  outfitItemMap = new Map();
  for (const l of outfitLinks) {
    let a = outfitItemMap.get(l.outfit_id);
    if (!a) { a = []; outfitItemMap.set(l.outfit_id, a); }
    a.push(l.item_id);
  }
  // Stable display number: oldest outfit = #1 (Stylebook-style "Look #N").
  outfits.slice()
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
    .forEach((o, idx) => { o._num = idx + 1; o._bucket = null; });
  // A formality edit or a new wear changes every derived level (wearsWithLevels).
  if (typeof invalidateLevelledWears === "function") invalidateLevelledWears();
  invalidateArchivedCache();
  buildOutfitWearMap();
}
function buildOutfitWearMap() {
  invalidateContextCache();
  outfitWearMap = new Map();
  for (const w of wears) {
    if (!w.outfit_id) continue;
    let s = outfitWearMap.get(w.outfit_id);
    if (!s) { s = new Set(); outfitWearMap.set(w.outfit_id, s); }
    s.add(w.worn_on);
  }
}

// ---- derived helpers ----
function wearCount(itemId) { return new Set(wears.filter(w => w.item_id === itemId).map(w => w.worn_on)).size; }
function lastWorn(itemId) {
  const ws = wears.filter(w => w.item_id === itemId).map(w => w.worn_on).sort();
  return ws.length ? ws[ws.length - 1] : null;
}
function costPerWear(item) {
  const n = wearCount(item.id);
  if (item.price == null || n === 0) return null;
  return item.price / n;
}
function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr + "T00:00:00").getTime()) / 86400000);
}
// Whole days from a to b (negative if b is earlier). Both are plain YYYY-MM-DD.
function daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000);
}
function outfitCount(itemId) {
  return new Set(wears.filter(w => w.item_id === itemId && w.outfit_id).map(w => w.outfit_id)).size;
}
const itemStatus = (i) => i.status || "Available";
const money = (n) => (n == null ? "—" : "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
// Local calendar date, NOT toISOString() (which is UTC and rolls over mid-evening
// in negative-UTC-offset zones — an evening log would land on tomorrow).
const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayStr = () => localISO(new Date());
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
// Body is the scroll container (not window) — window.scrollTo is a no-op here.
const scrollToTop = () => { document.body.scrollTop = 0; document.documentElement.scrollTop = 0; };
// Animated version for deliberate "take me back up" taps (header, re-tapping the
// active tab). body is the real scroll container and smooth `behavior` on it is
// unreliable, so the easing is by hand.
function smoothScrollTop() {
  const sc = document.body.scrollTop ? document.body : document.documentElement;
  const from = sc.scrollTop;
  if (!from) return;
  const t0 = performance.now(), dur = 260;
  const step = () => {
    const p = Math.min(1, (performance.now() - t0) / dur);
    sc.scrollTop = from * Math.pow(1 - p, 3);  // ease-out cubic
    if (p < 1) setTimeout(step, 16);           // timer, not rAF — rAF stalls in hidden docs
  };
  step();
}
const getScrollTop = () => document.body.scrollTop || document.documentElement.scrollTop || 0;

/* Drill-in / drill-out scroll, per surface (2026-07-25, user-reported "clicking
   into stats starts in the middle of the page"). Body is ONE scroll container
   shared by every screen, so navigating from a long list into a short child left
   you wherever the parent had been. `switchTab` always reset it; nothing else
   did — not closet folders, looks folders, calendar days or capsule details.
   Going deeper parks the parent's position and starts the child at the top;
   coming back puts you where you were. A small stack, because closet is three
   levels deep. Stats does its own version inside renderStats(), which is the
   only place that can distinguish navigating from re-rendering. */
const _navScroll = { closet: [], looks: [], capsules: [], calendar: [] };
function navDeeper(surface) {
  (_navScroll[surface] || []).push(getScrollTop());
  scrollToTop();
}
function navShallower(surface) {
  const st = _navScroll[surface] || [];
  const y = st.length ? st.pop() : 0;
  // restoreScroll() early-returns on 0, which would strand you at the CHILD's
  // offset when the parent had been at the top — the same bug one level up.
  if (y) restoreScroll(y); else scrollToTop();
}
const navResetScroll = (surface) => { if (_navScroll[surface]) _navScroll[surface].length = 0; };
// Put the scroll position back after a back-navigation re-render. Tiles are
// fixed-height so restoring before photos lazy-load is safe; the extra rAF pass
// covers layout that settles a frame later.
const restoreScroll = (y) => {
  if (!y) return;
  const set = () => { document.body.scrollTop = y; document.documentElement.scrollTop = y; };
  set(); requestAnimationFrame(set);
};
const parseList = (s) => String(s || "").split(",").map(x => x.trim()).filter(Boolean);

