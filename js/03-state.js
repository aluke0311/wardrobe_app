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
   optimistic upserts. Current keys: "dayplan". */
async function kvSet(key, value) {
  kvData.set(key, value);  // optimistic
  try {
    await rest("/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ user_id: session.user.id, key, value }]),
    });
    saveDataSnapshot();
  } catch (e) { toast(e.message); }
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
  const prev = kvData.get(TAXONOMY_KEY) || {};
  await kvSet(TAXONOMY_KEY, { cats, meta: { ...(prev.meta || {}), ...(meta || {}) } });
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
// Pure so the selftest can cover the prune window (today injectable).
function pruneDayPlan(all, today) {
  const lo = shiftDate(today, -DAYPLAN_KEEP_PAST), hi = shiftDate(today, DAYPLAN_KEEP_FUTURE);
  for (const d of Object.keys(all)) if (d < lo || d > hi || !(all[d] || []).length) delete all[d];
  return all;
}
async function saveDayPlan(date, entries) {
  const all = JSON.parse(JSON.stringify(dayPlanAll()));
  all[date] = entries || [];
  await kvSet(DAYPLAN_KEY, pruneDayPlan(all, todayStr()));
}
// Suggest level for a multi-context entry: every context's usual level when
// they agree; the dressier one when they don't (safer to be the overdressed
// person at campus than underdressed at dinner). Null = no signal.
function entrySuggestLevel(ctxs) {
  const lvls = (ctxs || []).map(c => contextFormalityLevel(c)).filter(Boolean);
  return lvls.length ? Math.max(...lvls) : null;
}
// The Workout-mapped context runs the suggester in activity mode instead.
function entryActivity(ctxs) { return (ctxs || []).includes("Workout") ? "workout" : null; }
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
  return { kv: true, date, entryIdx, level: entryActivity(ctxs) ? null : entrySuggestLevel(ctxs), activity: entryActivity(ctxs) };
}
function openDayPlanSheet(date) {
  const entries = dayPlan(date);
  const rh = rhythmFor(date);
  const wx = _dpWx(date);
  const ctxOpts = contextOptions();
  const entryCard = (e, idx) => {
    const shown = [...new Set([...ctxOpts.slice(0, 10), ...(e.contexts || [])])];
    const chips = shown.map(c =>
      `<button class="cap-chip${(e.contexts || []).includes(c) ? " on" : ""}" data-dp-ctx="${idx}|${esc(c)}" style="font-size:12.5px">${esc(c)}</button>`).join("");
    const lvls = [...new Set((e.contexts || []).map(c => contextFormalityLevel(c)).filter(Boolean))];
    const mixNote = lvls.length > 1
      ? `<div class="muted" style="font-size:11.5px;padding-top:4px">Contexts differ in formality — suggesting for ${esc(occLabel(Math.max(...lvls)))}</div>` : "";
    const o = e.outfit ? outfitById.get(e.outfit) : null;
    const worn = o && planWorn(date, o.id);
    const lookHtml = o ? `
      <div style="display:flex;align-items:center;gap:10px;padding-top:8px">
        <button data-dp-open="${esc(o.id)}" style="width:56px;flex:none">${outfitCollageHtml(o, 4)}</button>
        <button data-dp-open="${esc(o.id)}" style="flex:1;min-width:0;text-align:left">
          <div style="font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(outfitName(o))}</div>
          ${worn ? `<div style="font-size:12px;color:var(--accent)">✓ worn</div>` : ""}
        </button>
        ${!worn && date <= todayStr() ? `<button class="cap-chip" data-dp-wear="${idx}" style="flex:none">Wear it ✓</button>` : ""}
        <button class="cap-chip" data-dp-detach="${idx}" style="flex:none;color:var(--muted)" title="Remove the look, keep the plan">✕</button>
      </div>` : `
      <div style="display:flex;gap:6px;padding-top:8px">
        <button class="cap-chip" data-dp-pick="${idx}">＋ Look</button>
        <button class="cap-chip" data-dp-suggest="${idx}">✨ Suggest</button>
        <button class="cap-chip" data-dp-build="${idx}">✎ Build</button>
      </div>`;
    return `<div class="det-card" style="margin:0 16px 10px;padding:10px 12px">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:12px;color:var(--muted)">Outfit ${entries.length > 1 ? idx + 1 : ""} · contexts</div>
        <button class="lnk" data-dp-rm="${idx}" style="font-size:12px;color:var(--muted)">remove</button>
      </div>
      <div class="cap-catbar" style="flex-wrap:wrap;gap:6px;padding-top:6px">${chips}</div>
      ${mixNote}${lookHtml}
    </div>`;
  };
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="dpClose">Done</button>
      <h2>Plan · ${esc(planDayLabel(date))}</h2>
      <div style="width:48px"></div>
    </div>
    ${wx && wx.maxT != null ? `<div class="center muted" style="font-size:12.5px;padding:0 16px 8px">${wmoEmoji(wx.code)} ${wx.maxT}° / ${wx.minT}°</div>` : ""}
    ${entries.map(entryCard).join("") || (rh
      ? `<div class="center muted" style="font-size:13px;padding:4px 16px 12px;line-height:1.5">Usually <b style="color:var(--text)">${esc(rh.contexts.join(" · "))}</b> on ${esc(WEEKDAY_PLURAL[new Date(date + "T00:00:00").getDay()].toLowerCase())} — start there, or clear it once you're in.</div>`
      : `<div class="center muted" style="font-size:13px;padding:4px 16px 12px">Nothing planned yet — set the day's context now, pick the outfit whenever.</div>`)}
    <div style="padding:0 16px 16px"><button class="btn btn-sec" id="dpAdd" style="width:100%">＋ ${entries.length ? "Another outfit" : (rh ? `Plan this day · ${esc(rh.contexts.join(" · "))}` : "Plan this day")}</button></div>
    <div style="height:max(env(safe-area-inset-bottom),10px)"></div>`;
  showSheet("logSheet");
  hydratePhotos($("#logInner"));
  const save = async (next) => { await saveDayPlan(date, next); openDayPlanSheet(date); };
  $("#dpClose").onclick = () => {
    hideSheet("logSheet");
    const tab = activeTabName();
    if (tab === "home") renderHome();
    else if (tab === "calendar") renderCalendar();
  };
  // The weekday guess seeds the FIRST entry only, and only because this tap is
  // the acceptance — nothing about the rhythm is ever written on its own.
  $("#dpAdd").onclick = () => save([...JSON.parse(JSON.stringify(entries)),
    { contexts: (!entries.length && rh) ? [...rh.contexts] : [], outfit: null }]);
  $("#logInner").querySelectorAll("[data-dp-ctx]").forEach(b => b.onclick = () => {
    const [idx, ctx] = b.dataset.dpCtx.split("|");
    const next = JSON.parse(JSON.stringify(entries));
    const e = next[+idx]; if (!e) return;
    e.contexts = (e.contexts || []).includes(ctx) ? e.contexts.filter(c => c !== ctx) : [...(e.contexts || []), ctx];
    save(next);
  });
  $("#logInner").querySelectorAll("[data-dp-rm]").forEach(b => b.onclick = () => {
    const next = JSON.parse(JSON.stringify(entries)); next.splice(+b.dataset.dpRm, 1); save(next);
  });
  $("#logInner").querySelectorAll("[data-dp-detach]").forEach(b => b.onclick = () => {
    const next = JSON.parse(JSON.stringify(entries));
    if (next[+b.dataset.dpDetach]) next[+b.dataset.dpDetach].outfit = null;
    save(next);
  });
  $("#logInner").querySelectorAll("[data-dp-open]").forEach(b => b.onclick = () => {
    hideSheet("logSheet"); openLookFrom(b.dataset.dpOpen);
  });
  $("#logInner").querySelectorAll("[data-dp-pick]").forEach(b => b.onclick = () => openPlanLookPickerKv(date, +b.dataset.dpPick));
  $("#logInner").querySelectorAll("[data-dp-suggest]").forEach(b => b.onclick = () => {
    const idx = +b.dataset.dpSuggest;
    openSuggestSheet(null, null, _dpSuggestCtx(date, idx, (entries[idx] || {}).contexts));
  });
  $("#logInner").querySelectorAll("[data-dp-build]").forEach(b => b.onclick = () => {
    hideSheet("logSheet");
    openBuilder(null, null, { kv: true, date, entryIdx: +b.dataset.dpBuild });
  });
  $("#logInner").querySelectorAll("[data-dp-wear]").forEach(b => b.onclick = () => wearPlannedEntry(date, +b.dataset.dpWear));
}

// Attach a saved look to a plan entry: recent-first list with a name search.
function openPlanLookPickerKv(date, entryIdx, q = "") {
  const lastWornOf = o => { const s = outfitWearMap.get(o.id); return s && s.size ? [...s].sort().pop() : ""; };
  let list = activeOutfits().slice().sort((a, b) => lastWornOf(b).localeCompare(lastWornOf(a)));
  const needle = q.trim().toLowerCase();
  if (needle) list = list.filter(o => outfitName(o).toLowerCase().includes(needle));
  const rows = list.slice(0, 40).map(o => `
    <div style="display:flex;align-items:center;gap:10px;padding:6px 16px;border-bottom:1px solid var(--line)">
      <div style="width:56px;flex:none">${outfitCollageHtml(o, 4)}</div>
      <button data-dpl-pick="${esc(o.id)}" style="flex:1;min-width:0;text-align:left">
        <div style="font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${o.rating === 1 ? "♥ " : ""}${esc(outfitName(o))}</div>
        <div style="font-size:12px;color:var(--muted)">${lastWornOf(o) ? "worn " + lastWornOf(o) : "never worn"}</div>
      </button>
    </div>`).join("");
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="dplBack">Back</button>
      <h2>Pick a look</h2>
      <div style="width:48px"></div>
    </div>
    <div style="padding:0 16px 8px"><input class="inp" id="dplQ" placeholder="Search looks…" value="${esc(q)}"></div>
    <div style="max-height:55vh;overflow-y:auto">${rows || `<div class="center muted" style="padding:24px 0">No looks match</div>`}</div>
    <div style="height:max(env(safe-area-inset-bottom),10px)"></div>`;
  hydratePhotos($("#logInner"));
  $("#dplBack").onclick = () => openDayPlanSheet(date);
  const qEl = $("#dplQ");
  let qT; qEl.oninput = () => { clearTimeout(qT); qT = setTimeout(() => openPlanLookPickerKv(date, entryIdx, qEl.value), 250); };
  if (q) { qEl.focus(); qEl.setSelectionRange(qEl.value.length, qEl.value.length); }
  $("#logInner").querySelectorAll("[data-dpl-pick]").forEach(b => b.onclick = async () => {
    await addKvPlanLook(date, b.dataset.dplPick, entryIdx);
    openDayPlanSheet(date);
  });
}

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
    const twc = tripWearContext(date);
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

