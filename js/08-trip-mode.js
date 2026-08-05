/* ===================================================================
   TRIP MODE  (2026-07-18)
   App-wide mode scoped to one capsule. Three phases, DERIVED from the
   capsule's dates, never stored: pack (lead-up) → trip → unpack (grace).
   Entering also sets activeCapsuleId (the existing scoping); the scope
   banner's ✕ exits the mode. Undated capsules get the same mode minus
   every date-driven piece ("capsule mode").
   =================================================================== */
const PACK_LEAD_DAYS = 3;     // pack phase starts this many days before a trip
const UNPACK_GRACE_DAYS = 3;  // unpack/recap offered this long after it ends
const TRIP_CONTEXT = "Travel";
const TRIP_MODE_KEY = "wardrobe.tripMode";
const TRIP_OFFER_KEY = "wardrobe.tripOffer.";  // + capsule id → date offer was dismissed
let tripModeId = null;        // capsule id while the mode is on (persisted)
let _pickTripScope = false;   // calendar/log pickers: true = pool limited to the trip capsule

function shiftDate(dstr, n) { const d = new Date(dstr + "T00:00:00"); d.setDate(d.getDate() + n); return localISO(d); }
function isDatedTrip(c) { return !!(c && c.start_date && c.end_date); }
// The mode's capsule, validated (self-clears if the capsule was deleted).
function tripCapsule() {
  if (!tripModeId) return null;
  const c = capsuleById.get(tripModeId);
  if (!c) { tripModeId = null; store.removeItem(TRIP_MODE_KEY); }
  return c || null;
}
function tripPhase(c, day) {
  if (!isDatedTrip(c)) return null;
  const d = day || todayStr();
  if (d >= c.start_date && d <= c.end_date) return "trip";
  if (d < c.start_date) return d >= shiftDate(c.start_date, -PACK_LEAD_DAYS) ? "pack" : null;
  return d <= shiftDate(c.end_date, UNPACK_GRACE_DAYS) ? "unpack" : null;
}
function tripDayNum(c, day) {
  return Math.round((new Date(day + "T00:00:00") - new Date(c.start_date + "T00:00:00")) / 86400000) + 1;
}
function enterTripMode(cid) {
  const c = capsuleById.get(cid);
  if (!c) return;
  tripModeId = cid;
  store.setItem(TRIP_MODE_KEY, cid);
  activeCapsuleId = cid;
  closetCat = null; closetSub = null; searchResults = null; closetSearchQ = null;
  switchTab("home");
  toast(isDatedTrip(c) ? `✈️ Trip mode · ${c.name}` : `Capsule mode · ${c.name}`);
}
function exitTripMode() {
  tripModeId = null;
  store.removeItem(TRIP_MODE_KEY);
  activeCapsuleId = null;
  toast("Trip mode off");
  const scr = $(".screen.active")?.id;
  if (scr === "tab-home") renderHome();
  else if (scr === "tab-closet" && !detailId) renderCloset();
  else if (scr === "tab-looks" && !lookId) renderLooks();
  else if (scr === "tab-capsules") renderCapsules();
}
// Auto-stamped wear context while ON a trip (dated capsules only — wearing a
// home capsule isn't "Travel"). Composes with anything she adds in the sheet.
function tripWearContext(date) {
  const c = tripCapsule();
  if (!c || !isDatedTrip(c)) return null;
  return (date >= c.start_date && date <= c.end_date) ? [TRIP_CONTEXT] : null;
}
// A look logged on a trip day IS that day's plan, fulfilled — record it there
// so she never has to do both. Fire-and-forget from the wear paths.
async function tripPlanSync(outfitId, date) {
  const c = tripCapsule();
  if (!c || !outfitId || !isDatedTrip(c)) return;
  if (date < c.start_date || date > c.end_date) return;
  if (planLooksForDate(c, date).includes(outfitId)) return;
  await addPlanLook(c.id, date, outfitId);
}
// Pieces just logged that aren't packed → offer to add them to the trip capsule
// (keeps the capsule honest when she wears something she didn't pack).
function tripMissingPieces(itemIds) {
  const c = tripCapsule();
  if (!c) return null;
  const members = new Set((capsuleLinkMap.get(c.id) || []).map(l => l.item_id));
  const missing = [...new Set(itemIds)].filter(id => id && !members.has(id) && itemById.get(id));
  return missing.length ? { c, missing } : null;
}

// ---- Unpack + recap (step D) ----
// Pure derivation from wears in the trip's date range vs capsule members —
// nothing stored, so the recap works retroactively for any past dated trip.
/* ⚠️ ONE derivation, TWO surfaces (2026-07-29). `through` bounds the window at a
   date inside the trip, which is what makes the mid-trip "still in the suitcase"
   row and the end-of-trip recap the same function. A second walk over `wears`
   for the live case would have been free to drift from this one; it isn't worth
   the two lines it would have saved.
   opts: { through, wearRows, members } — the last two exist so the travel
   derivations below are injectable and therefore testable. */
function tripRecapData(c, opts = {}) {
  const through = opts.through && opts.through < c.end_date ? opts.through : c.end_date;
  const rows = opts.wearRows || wears;
  const members = opts.members || capsuleItems(c.id);
  const memberIds = new Set(members.map(i => i.id));
  const wearDays = new Map();    // item_id → Set(dates), packed pieces
  const outsideDays = new Map(); // item_id → Set(dates), worn but NOT packed
  const lookDays = new Map();    // outfit_id → Set(dates)
  for (const w of rows) {
    if (w.worn_on < c.start_date || w.worn_on > through) continue;
    if (w.item_id) {
      const m = memberIds.has(w.item_id) ? wearDays : outsideDays;
      let s = m.get(w.item_id); if (!s) m.set(w.item_id, s = new Set()); s.add(w.worn_on);
    }
    if (w.outfit_id) { let s = lookDays.get(w.outfit_id); if (!s) lookDays.set(w.outfit_id, s = new Set()); s.add(w.worn_on); }
  }
  const daysOf = (i) => (wearDays.get(i.id) || { size: 0 }).size;
  const worn = members.filter(i => wearDays.has(i.id)).sort((a, b) => daysOf(b) - daysOf(a));
  const dead = members.filter(i => !wearDays.has(i.id));
  // Days ELAPSED, not the whole trip — mid-trip the two differ, and "earned its
  // weight" has to be measured against the days that have actually happened.
  const all = tripDates(c);
  const elapsed = all.filter(d => d <= through).length || 1;
  // A workhorse pulled its weight on a meaningful share of the days. Min 2 so a
  // one-day trip can't crown everything you wore.
  const workMin = Math.max(2, Math.ceil(TRIP_WORKHORSE_SHARE * elapsed));
  const workhorses = worn.filter(i => daysOf(i) >= workMin);
  const once = worn.filter(i => daysOf(i) < workMin);
  // Worn on the trip but never on the packing list. ⚠️ Accepting the in-trip
  // "add to this trip?" offer makes a piece a member, so what survives here is
  // specifically what she DECLINED to call a trip piece — which is the more
  // interesting set anyway.
  const unpacked = [...outsideDays.keys()].map(id => itemById.get(id)).filter(Boolean)
    .sort((a, b) => outsideDays.get(b.id).size - outsideDays.get(a.id).size);
  let mostWorn = worn[0] || null, mostN = mostWorn ? daysOf(mostWorn) : 0;
  let topLook = null, topLookN = 0;
  for (const [oid, s] of lookDays) {
    const o = outfitById.get(oid);
    if (o && s.size > topLookN) { topLookN = s.size; topLook = o; }
  }
  return {
    members, worn, dead, wearDays, outsideDays, unpacked, workhorses, once,
    mostWorn, mostN, topLook, topLookN, outfitCount: lookDays.size,
    days: all.length, elapsed, through,
  };
}
const TRIP_WORKHORSE_SHARE = 0.4;  // share of elapsed trip days that "earned its spot"
const TRIP_UNWORN_MIN_DONE = 2;    // completed days before the app mentions unworn pieces
const TRIP_UNWORN_MIN_LEFT = 2;    // days still to come — below this it isn't actionable

/* Mid-trip: what's still in the suitcase, while there's time to do something
   about it. Returns null rather than an empty shape whenever it shouldn't be
   spoken about — on day 1 every piece is unworn and the number is noise, and
   after the last day the recap owns the question. A weekend trip never
   qualifies, which is correct. */
function tripUnwornNow(c, today = todayStr()) {
  if (!isDatedTrip(c)) return null;
  if (today < c.start_date || today > c.end_date) return null;
  const dates = tripDates(c);
  const done = dates.filter(d => d < today).length;
  const left = dates.filter(d => d > today).length;
  if (done < TRIP_UNWORN_MIN_DONE || left < TRIP_UNWORN_MIN_LEFT) return null;
  const r = tripRecapData(c, { through: today });
  const unworn = r.dead.filter(i => itemStatus(i) === "Available");
  if (!unworn.length) return null;
  return { unworn, left, done, packed: r.members.filter(i => itemStatus(i) === "Available").length };
}

/* Pool for "build from these": the unworn pieces, PLUS whatever the unworn set
   can't dress. ⚠️ This is the r12 workout bug waiting to happen — a pool that
   cannot form an outfit is worse than an empty one, because it looks like a
   partial result. Six unworn tops don't make an outfit. So the narrowing is
   rescue-shaped, exactly like inSeasonWx: it starts from unworn and only ever
   widens, per missing slot, from the rest of the suitcase. The count of rescued
   pieces is returned so the pool chip can say so out loud. */
const TRIP_CORE_SLOTS = ["Tops", "Bottoms", "Shoes"];
function tripUnwornPool(c, today = todayStr()) {
  const suitcase = capsuleItems(c.id).filter(i => itemStatus(i) === "Available");
  const dead = new Set(tripRecapData(c, { through: today }).dead.map(i => i.id));
  const pool = suitcase.filter(i => dead.has(i.id));
  const have = new Set(pool.map(suggestSlot).filter(Boolean));
  // A dress covers Tops+Bottoms on its own; otherwise all three core slots.
  const need = have.has("Dresses") ? ["Shoes"] : TRIP_CORE_SLOTS;
  const rescued = [];
  for (const slot of need) {
    if (have.has(slot)) continue;
    for (const i of suitcase) if (!dead.has(i.id) && suggestSlot(i) === slot) rescued.push(i);
  }
  return { pool: pool.concat(rescued), unworn: pool.length, rescued: rescued.length };
}

/* ---- Cross-trip memory (2026-07-29) ----
   The part that makes a recap worth reading twice: one trip is an anecdote,
   four are a fact about how you pack. Every completed dated capsule counts —
   `kind` isn't consulted, because dates are what trip mode already keys on
   everywhere else and an undated capsule has no trip to have been on. */
const TRIP_MEMORY_MIN = 2;  // trips of evidence before a piece's record says anything
function completedTrips(caps = null, today = null) {
  const t = today || todayStr();
  return (caps || capsules).filter(c => isDatedTrip(c) && c.end_date < t)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
}
function buildTravelStats(caps = null, wearRows = null, membersFor = null, today = null) {
  const trips = completedTrips(caps, today).map(c => {
    const members = membersFor ? membersFor(c) : null;
    const r = tripRecapData(c, { wearRows, members });
    return {
      c, r, packed: r.members.length, worn: r.worn.length, days: r.days,
      wornIds: new Set(r.worn.map(i => i.id)),
    };
  });
  // Per-piece travel record. Deliberately just two counts — see the note in the
  // Travel page: a piece packed three times and never worn may be the emergency
  // option, doing exactly its job. The app reports; it doesn't rule.
  const rec = new Map();  // item_id → {item, packed, worn}
  for (const t of trips) {
    for (const i of t.r.members) {
      let e = rec.get(i.id);
      if (!e) rec.set(i.id, e = { item: i, packed: 0, worn: 0 });
      e.packed++;
      if (t.wornIds.has(i.id)) e.worn++;
    }
  }
  const totPacked = trips.reduce((s, t) => s + t.packed, 0);
  const totWorn = trips.reduce((s, t) => s + t.worn, 0);
  return { trips, rec, totPacked, totWorn };
}
// Pieces with enough history to be worth showing on a packing list.
function travelProven(stats) {
  return [...stats.rec.values()]
    .filter(e => e.packed >= TRIP_MEMORY_MIN && e.worn === e.packed)
    .sort((a, b) => b.packed - a.packed);
}
function travelUnused(stats) {
  return [...stats.rec.values()]
    .filter(e => e.packed >= TRIP_MEMORY_MIN && e.worn === 0)
    .sort((a, b) => b.packed - a.packed);
}

// Unpack sheet: recap + (when unpacking a live trip) send worn pieces to the
// hamper and end the mode. `unpack: false` = recap-only (past trips).
function openTripRecap(cid, { unpack = false } = {}) {
  const c = capsuleById.get(cid);
  if (!c || !isDatedTrip(c)) return;
  const r = tripRecapData(c);
  const tile = (i) => `<button class="wa-tile" data-unpack-item="${esc(i.id)}" style="width:72px">
    ${thumbHtml(i.image_path || null)}
    <div class="wa-name">${esc(i.name || "Untitled")}</div>
  </button>`;
  const dayN = (i) => (r.wearDays.get(i.id) || { size: 0 }).size;
  const strip = (label, list, sub = null) => list.length ? `
    <div class="td-plan-lbl" style="margin:16px 0 6px">${label}</div>
    ${sub ? `<div class="muted" style="font-size:11.5px;margin:-4px 0 6px">${esc(sub)}</div>` : ""}
    <div class="wa-strip" style="padding:0">${list.map(tile).join("")}</div>` : "";

  // "Earned its weight" is wear-DAYS, not a boolean: a piece worn four days and
  // one worn once both used a suitcase slot, and only one of them paid for it.
  const workHtml = strip(
    `⭐ Earned its spot · ${r.workhorses.length} piece${r.workhorses.length === 1 ? "" : "s"}`,
    r.workhorses, r.workhorses.length ? r.workhorses.map(i => `${i.name || "Untitled"} ${dayN(i)}d`).join(" · ") : null);
  // ⚠️ "but only just" is a COMPARISON — it needs a top tier to be compared
  // against. With no workhorses it reads as a dig at everything she wore.
  const onceHtml = strip(
    r.workhorses.length ? `Worn, but only just · ${r.once.length}` : `Worn · ${r.once.length}`, r.once);
  const deadHtml = r.dead.length
    ? strip(`🧳 Dead weight · ${r.dead.length} piece${r.dead.length === 1 ? "" : "s"} never left the suitcase`, r.dead)
    : `<div style="margin-top:16px;font-size:14px">🎉 Every packed piece got worn — perfect packing.</div>`;
  // The most useful packing signal there is: what you reached for that wasn't
  // on the list. Next time, it goes on the list.
  const unpackedHtml = strip(
    `＋ Wore it, didn't pack it · ${r.unpacked.length}`, r.unpacked,
    "These weren't on the packing list — worth adding before the next trip.");
  const canHamper = unpack && LAUNDRY_READY() && r.worn.length;
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="unpCancel">${unpack ? "Later" : "Close"}</button>
      <h2>${unpack ? "Unpack" : "Trip recap"}</h2>
      <span style="width:54px"></span>
    </div>
    <div style="padding:14px 18px 30px">
      <div style="font-size:15px;font-weight:700">${esc(c.name)}</div>
      <div class="muted" style="font-size:13px;margin-bottom:12px">${esc(fmtDate(c.start_date))} – ${esc(fmtDate(c.end_date))} · ${r.days} day${r.days === 1 ? "" : "s"}</div>
      <div style="font-size:14px;line-height:1.6">
        <b>${r.worn.length} of ${r.members.length}</b> packed pieces worn
        ${r.outfitCount ? `<br><b>${r.outfitCount}</b> distinct look${r.outfitCount === 1 ? "" : "s"} out of ${r.members.length} pieces` : ""}
        ${r.mostWorn ? `<br>Most worn: <b>${esc(r.mostWorn.name || "Untitled")}</b> · ${r.mostN} day${r.mostN === 1 ? "" : "s"}` : ""}
        ${r.topLook && r.topLookN > 1 ? `<br>Repeated look: <b>${esc(outfitName(r.topLook))}</b> · ${r.topLookN} days` : ""}
      </div>
      ${workHtml}
      ${onceHtml}
      ${deadHtml}
      ${unpackedHtml}
      ${typeof packGradeRowHtml === "function" && packHasPlan(cid) ? packGradeRowHtml(c) : ""}
      ${canHamper ? `<button class="btn" id="unpHamper" style="margin-top:20px">🧺 Send ${r.worn.length} worn piece${r.worn.length === 1 ? "" : "s"} to the hamper</button>` : ""}
      ${unpack ? `<button class="btn${canHamper ? " btn-sec" : ""}" id="unpEnd" style="margin-top:10px">End trip mode</button>` : ""}
    </div>`;
  showSheet("logSheet");
  hydratePhotos($("#logInner"));
  $("#unpCancel").onclick = () => hideSheet("logSheet");
  $("#logInner").querySelectorAll("[data-unpack-item]").forEach(b => {
    b.onclick = () => { hideSheet("logSheet"); openItemFrom(b.dataset.unpackItem); };
  });
  const hamperBtn = $("#unpHamper");
  if (hamperBtn) hamperBtn.onclick = async () => {
    hamperBtn.disabled = true;
    try {
      const ls = laundryState();
      await Promise.all(r.worn.map(i => flipLaundry(i.id, true, ls)));
      hamperBtn.textContent = `✓ ${r.worn.length} in the hamper`;
    } catch (e) { toast(e.message); hamperBtn.disabled = false; }
  };
  const endBtn = $("#unpEnd");
  if (endBtn) endBtn.onclick = () => { hideSheet("logSheet"); exitTripMode(); };
}

// Items in the current lens. An active capsule overrides the status lens entirely
// (you want to see everything you packed, regardless of Available/Storage).
function lensItems() {
  let base;
  if (activeCapsuleId) {
    const ids = new Set((capsuleLinkMap.get(activeCapsuleId) || []).map(l => l.item_id));
    base = items.filter(i => ids.has(i.id));
  } else {
    base = closetLens === "All" ? items : items.filter(i => itemStatus(i) === closetLens);
  }
  if (!hasActiveFilter(closetFilter)) return base;
  // noStatusDefault: lens already handles status; don't double-apply archive exclusion
  return base.filter(i => itemMatchesFilter(i, closetFilter, { noStatusDefault: true }));
}
const isOtherCat = (i) => !i.category || !CATEGORIES.includes(i.category);
function folderThumb(list) { const f = list.find(i => i.image_path); return f ? f.image_path : null; }

function thumbHtml(path, cls = "cthumb") {
  // Empty path still gets data-photo so loadPhotoNode applies the tee placeholder.
  return `<div class="${cls}${path ? "" : " empty"}" data-photo="${esc(path || "")}"></div>`;
}
function rowHtml(thumb, name, count, attrs = "") {
  const sub = count === 0 ? "No items" : `${count} item${count === 1 ? "" : "s"}`;
  return `<button class="frow" ${attrs}>
    ${thumbHtml(thumb)}
    <div class="fmeta"><div class="fname">${esc(name)}</div><div class="fcount">${sub}</div></div>
    <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
  </button>`;
}
function gridHtml(list, subtitleFn = null, opts = {}) {
  return itemGridView(list, {
    select: selectMode,
    subtitleFn,
    metricOnly: !!opts.metricOnly,
  });
}

// ---- shared render helpers ----
function sectionLabel(txt) {
  return `<div class="section-label">${esc(txt)}</div>`;
}
function chip(txt, cls = "", attrs = "") {
  return `<span class="chip${cls ? " " + cls : ""}"${attrs ? " " + attrs : ""}>${esc(txt)}</span>`;
}

// ---- unified item grid (Wave 1 keystone; surfaces migrate in Wave 2) ----
// cfg: { cols, group, select, selSet, onTap, metricOnly, subtitleFn,
//        packedSet, trip, emptyMsg }
function itemGridView(list, cfg = {}) {
  const {
    cols       = gridCols,
    group      = null,         // null | 'category' | 'formality'
    select     = false,
    selSet     = null,         // Set of selected ids; falls back to selectedIds
    onTap      = "item",       // data-* attribute name for delegation
    metricOnly = false,
    subtitleFn = null,
    packedSet  = null,         // Set → show pack-tick; null → no tick
    trip       = false,
    emptyMsg   = "No items here",
  } = cfg;

  if (!list.length) return `<div class="placeholder"><b>${esc(emptyMsg)}</b></div>`;

  const activeSelSet = selSet ?? (select ? selectedIds : new Set());

  // Laundry badge on every item tile (informational only — pickers never filter).
  const _ls = LAUNDRY_READY() ? laundryState() : null;
  const launBadge = (i) => (_ls && isDirty(i, _ls) ? `<div class="gtile-laun">🧺</div>` : "");

  const tileHtml = (i) => {
    if (packedSet) {
      const isPacked = packedSet.has(i.id);
      return `<button class="gtile${isPacked ? " packed" : ""}" data-${onTap}="${esc(i.id)}">
        <div class="pack-tick" data-pack="${esc(i.id)}"><svg viewBox="0 0 24 24"><path d="M5 12l5 5L19 7"/></svg></div>
        ${launBadge(i)}${thumbHtml(i.image_path, "gphoto")}<div class="gname">${esc(i.name || "Untitled")}</div>
      </button>`;
    }
    const sel = select && activeSelSet.has(i.id);
    const sub = subtitleFn ? subtitleFn(i) : "";
    if (metricOnly) {
      return `<button class="gtile" data-${onTap}="${esc(i.id)}">
        ${launBadge(i)}${thumbHtml(i.image_path, "gphoto")}
        <div class="gtile-metric">${esc(sub)}</div>
      </button>`;
    }
    const chk = `<div class="sel-dot${sel ? " on" : ""}"><svg viewBox="0 0 24 24"><path d="M5 12l5 5L19 7"/></svg></div>`;
    return `<button class="gtile${sel ? " selected" : ""}" data-${onTap}="${esc(i.id)}">
      ${select ? chk : ""}
      ${launBadge(i)}${thumbHtml(i.image_path, "gphoto")}
      <div class="gname">${esc(i.name || "Untitled")}</div>
      ${sub ? `<div class="gtile-sub">${esc(sub)}</div>` : ""}
    </button>`;
  };

  const gridDiv = (items) =>
    `<div class="grid" style="--grid-cols:${cols}">${items.map(tileHtml).join("")}</div>`;

  if (!group) return gridDiv(list);

  const groups = group === "formality" ? groupByFormality(list) : groupByCategory(list);
  return groups.map(g => {
    let cnt;
    if (trip && packedSet) {
      const packed = g.items.filter(i => packedSet.has(i.id)).length;
      cnt = `<span class="g-cnt${packed === g.items.length ? " done" : ""}" data-grp-cnt>${packed}/${g.items.length} packed</span>`;
    } else {
      cnt = `<span class="g-cnt">${g.items.length} item${g.items.length === 1 ? "" : "s"}</span>`;
    }
    return `<div class="cap-grp" data-grp="${esc(g.key)}">
      <div class="cap-grp-hdr"><span class="g-name">${esc(g.key)}</span>${cnt}</div>
      ${gridDiv(g.items)}
    </div>`;
  }).join("");
}

// ---- grid bar show/hide ----
function showGridBar(surface) {
  if (surface) _gridSurface = surface;
  $("#gridBar").hidden = false;
  $("#app").classList.add("has-gridbar");
  updateGridBar();
}
function hideGridBar() {
  $("#gridBar").hidden = true;
  $("#app").classList.remove("has-gridbar");
  $("#gridPickerPop").hidden = true;
}

function clToolbar(title, showBack, showPlus) {
  const filterN = filterActiveCount(closetFilter);
  _funnelClearFns.clSearch = { state: closetFilter, onClear: () => renderCloset() };
  const right = `<div style="display:flex;align-items:center;gap:2px">
    ${closetSearchQ === null ? `<button class="clsearch" id="clKeyword" title="Search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/></svg></button>` : ""}
    <div style="position:relative">
      <button class="clsearch" id="clSearch"><svg viewBox="0 0 24 24"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg></button>
      ${filterN ? `<span class="filter-badge">${filterN}</span>` : ""}
    </div>
    ${filterN ? `<button class="cb-x" data-funnel-clear="clSearch" title="Clear filters" style="width:24px;height:24px;color:var(--muted)">✕</button>` : ""}
    ${showPlus ? `<button class="clsearch" id="clPlus" style="font-size:22px;font-weight:300;line-height:1">＋</button>` : ""}
  </div>`;
  // At a tab ROOT the toolbar title just repeats the app header — "Closet" over
  // "Closet" — so it's dropped and the row becomes actions-only (2026-07-26
  // audit M6; it did this on four of six screens). On a DRILL-IN the title is
  // the folder/category and carries real information, so it stays. See
  // .tb-root. NB the element itself must survive at closet root: renderCloset
  // inserts the capsule scope banner with .cltoolbar + insertAdjacentHTML.
  return `<div class="cltoolbar${showBack ? "" : " tb-root"}">
    ${showBack
      ? `<button class="clback" id="clBack"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
         <div class="cltitle">${esc(title)}</div>`
      : ""}
    ${right}
  </div>`;
}
function lensHtml() {
  return `<div class="lens">${LENSES.map(l =>
    `<button data-lens="${l}" class="${closetLens === l ? "on" : ""}">${l}</button>`).join("")}</div>`;
}

function renderClosetRoot() {
  const av = lensItems();
  let rows = "";
  for (const cat of CATEGORIES) {
    const list = av.filter(i => i.category === cat);
    if (!list.length) continue;
    rows += rowHtml(folderThumb(list), cat, list.length, `data-cat="${esc(cat)}"`);
  }
  const other = av.filter(isOtherCat);
  if (other.length) rows += rowHtml(folderThumb(other), "Other", other.length, `data-cat="Other"`);
  if (!rows) {
    const msg = activeCapsuleId ? ["No pieces in this capsule yet", "Add some from the capsule's ＋ Add items."]
      : closetLens === "Storage" ? ["Nothing in storage", "Move a piece here from its detail page."]
      : closetLens === "Archive" ? ["Nothing archived", "Archived pieces land here when you let them go."]
      : ["Nothing here yet", "Add your first piece with the ＋ up top."];
    rows = `<div class="placeholder"><b>${msg[0]}</b><div>${msg[1]}</div></div>`;
  }
  const top = activeCapsuleId ? "" : lensHtml();
  const capFilter = (!activeCapsuleId && capsules.length)
    ? `<button class="cl-capbtn" data-cap-filter>
        <svg viewBox="0 0 24 24"><path d="M3 5h18M6 12h12M10 19h4"/></svg>
        Filter by capsule or trip</button>`
    : "";
  // Hamper row stays visible while capsule/trip-scoped (user-reported bug
  // 2026-07-19: trip mode hid the hamper) — scoped to the capsule's members,
  // same as everything else under the banner.
  const launRow = LAUNDRY_READY() ? (() => {
    const ls = laundryState();
    const n = _scopedHamper(ls).length, w = _scopedWorn(ls).length;
    return `<button class="cl-capbtn" data-laundry>🧺 Hamper · ${n ? `${n} item${n === 1 ? "" : "s"}` : "empty"}</button>`
      + (w ? `<button class="cl-capbtn" data-worn>👕 Worn · ${w} item${w === 1 ? "" : "s"}</button>` : "");
  })() : "";
  // The rack is ALWAYS a visible row (her condition when approving it): a pool
  // that quietly narrows the suggester has to be somewhere she can go and look.
  const rackRow = activeCapsuleId ? ""
    : `<button class="cl-capbtn" data-rack>\u{1F455} The rack \u00b7 ${rackItems().length} in play</button>`;
  return clToolbar("Closet", false, true) + laundryLensHtml("closet", closetFilter)
    + top + capFilter + rackRow + launRow + `<div class="frows">${rows}</div>`;
}

// ---- laundry sheet ----
// "I did laundry": pick the load(s) you ran (her real sorting — whites / cools /
// warms, sometimes all together), see + edit exactly what's in it, optionally
// back-date, and stamp the chosen items washed. Selection lives at the ITEM
// level (`_lnSelIds`) — load chips are pre-selectors that add/remove a whole
// load's ids at once, not the selection itself ("I need to see what is in the
// load — not just check whatever happens to be in those colors").
const LAUNDRY_REAL_LOADS = ["Whites", "Cools", "Warms"];
let _lnSelIds = new Set();     // item ids that will be stamped washed
let _lnActiveLoads = new Set(); // which load chips are "on" (controls grid visibility)
let _lnPool = null;  // Set of item ids scoping the laundry sheet (trip mode), or null
let _lnFromPrompt = false;
/* The wash DATE, chosen first and driving everything below it (2026-08-03).
   It lives here rather than being read back off the input, because the sheet
   re-renders on every chip tap and the whole point is that changing the date
   changes which pieces are shown. */
let _lnDate = null;
// Generic color-family filter — works over the hamper OR the worn-tray pool.
function _lnLoadItems(load, list) {
  if (load === "All") return list;
  return list.filter(i => laundryLoadOf(i.color_family) === load);
}
function _lnLoadIds(load, hamper, worn) {
  return [..._lnLoadItems(load, hamper), ..._lnLoadItems(load, worn)].map(i => i.id);
}
/* `preLoad` / `preIds` carry a choice she has ALREADY made on the hamper screen
   into the sheet (2026-08-04, her words: "I need the ability to select which
   load from the hamper screen. Not just 'wash these' — open up a whole thing,
   set the date, which colors, etc.").

   ⚠️ They pre-select, they never decide. The sheet still owns the date, the
   loads and the final Mark washed, because everything below the date depends on
   it — that's the r2 fix, and a caller that pre-stamped a wash would walk
   straight back into it. */
function openLaundrySheet({ fromPrompt = false, pool = null, preLoad = null, preIds = null } = {}) {
  _lnSelIds = new Set();
  _lnActiveLoads = new Set();
  _lnFromPrompt = fromPrompt;
  _lnDate = todayStr();
  // Trip mode: wash the suitcase, not the closet — pool limits the hamper to
  // the passed items (capsule members). Null = whole closet, as ever.
  _lnPool = pool ? new Set(pool.map(i => i.id)) : null;
  if (preLoad && LAUNDRY_REAL_LOADS.includes(preLoad)) {
    const ls = laundryState();
    const split = laundryAsOfSplit([..._lnHamper(ls), ..._lnWornPool(ls)], ls, _lnDate);
    _lnActiveLoads.add(preLoad);
    for (const id of _lnLoadIds(preLoad, split.hamper, split.worn)) _lnSelIds.add(id);
  }
  for (const id of (preIds || [])) {
    _lnSelIds.add(id);
    // Light the chip each piece belongs to as well, or it would be ticked and
    // invisible — the grids only render items whose load chip is on.
    const l = laundryLoadOf((itemById.get(id) || {}).color_family);
    if (l) _lnActiveLoads.add(l);
  }
  renderLaundrySheet();
  showSheet("logSheet");
}
function _lnHamper(ls) {
  const h = hamperItems(ls);
  return _lnPool ? h.filter(i => _lnPool.has(i.id)) : h;
}
// "Also worn, not dirty yet" — the pile on the chair, offered alongside the
// hamper so a worn-once piece can go in the same real-world wash load.
function _lnWornPool(ls) {
  const w = wornItems(ls);
  return _lnPool ? w.filter(i => _lnPool.has(i.id)) : w;
}
function renderLaundrySheet() {
  const ls = laundryState();
  const date = _lnDate || todayStr();
  /* Everything in play right now, re-partitioned AS OF the chosen date. On the
     ordinary same-day path `after` is empty and this is exactly the old sheet;
     back-date it and pieces that only went out after the wash move out of the
     loads and into their own section. */
  const livePool = [..._lnHamper(ls), ..._lnWornPool(ls)];
  const split = laundryAsOfSplit(livePool, ls, date);
  const hamper = split.hamper, worn = split.worn, after = split.after;
  const chips = [...LAUNDRY_REAL_LOADS, "All"].map(l => {
    const n = _lnLoadItems(l, hamper).length + _lnLoadItems(l, worn).length;
    const lbl = l === "All" ? `All together (${hamper.length + worn.length})` : `${l} (${n})`;
    const on = l === "All" ? LAUNDRY_REAL_LOADS.every(x => _lnActiveLoads.has(x)) && hamper.length + worn.length > 0
      : _lnActiveLoads.has(l);
    return `<button class="cap-chip${on ? " on" : ""}" data-lnload="${l}" ${n ? "" : "disabled"} style="font-size:14px">${lbl}</button>`;
  }).join("");
  const visHamper = hamper.filter(i => _lnActiveLoads.has(laundryLoadOf(i.color_family)));
  const visWorn = worn.filter(i => _lnActiveLoads.has(laundryLoadOf(i.color_family)));
  const selN = _lnSelIds.size;
  // Tracking is opt-in per item: it starts the first time an item is stamped
  // washed. Until ANY item has, offer the whole-closet bootstrap — including
  // when the hamper already holds manual overrides, which used to hide it.
  // Scoped (trip) sheets never show the whole-closet bootstrap.
  const tracking = items.some(i => i.last_washed) || !!_lnPool;
  const backDated = date < todayStr();
  /* ⚠️ The date leads now. She sets WHEN the wash ran, and the lists below
     answer "what was dirty then" — the other order is what let yesterday's
     wash swallow today's clothes. */
  const dateRow = `
    <div style="padding:10px 16px 2px;display:flex;align-items:center;gap:10px">
      <span style="font-size:13px;color:var(--muted);flex:none">Washed on</span>
      <input class="inp" id="lnDate" type="date" value="${date}" max="${todayStr()}" style="flex:1;font-size:16px">
    </div>
    ${backDated ? `<div class="snote" style="padding:4px 16px 0;font-size:12.5px">Showing what was in the hamper on ${esc(fmtDate(date))}.</div>` : ""}`;
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="lnCancel">Cancel</button>
      <h2>${_lnPool ? "Trip laundry" : "Laundry"}</h2>
      <span style="width:54px"></span>
    </div>
    ${(hamper.length || after.length || !tracking) ? dateRow : ""}
    ${hamper.length ? `
    <div style="padding:10px 16px 4px">
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px">Which loads did you run?</div>
      <div class="cap-catbar" style="flex-wrap:wrap;gap:8px">${chips}</div>
    </div>` : tracking ? `
    <div class="center muted" style="padding:24px 24px 4px">${backDated ? `Nothing was in the hamper on ${esc(fmtDate(date))}.` : "Nothing in the hamper 🎉"}</div>` : ""}
    ${visHamper.length ? `
    <div style="padding:10px 16px 0">
      <div class="section-label">In this wash · ${visHamper.length}</div>
      ${itemGridView(visHamper, { select: true, selSet: _lnSelIds, onTap: "lnitem", cols: 4 })}
    </div>` : ""}
    ${visWorn.length ? `
    <div style="padding:14px 16px 0">
      <div class="section-label">Also worn, not dirty yet</div>
      ${itemGridView(visWorn, { select: true, selSet: _lnSelIds, onTap: "lnitem", cols: 4 })}
    </div>` : ""}
    ${after.length ? `
    <div style="padding:16px 16px 0">
      <div class="section-label">Worn since then · ${after.length}</div>
      <div class="muted" style="font-size:12.5px;padding:2px 0 6px;line-height:1.4">These only went out after ${esc(fmtDate(date))}, so they weren't in that load. The load buttons leave them alone — tap any that did go in.</div>
      ${itemGridView(after, { select: true, selSet: _lnSelIds, onTap: "lnitem", cols: 4 })}
    </div>` : ""}
    ${hamper.length ? `
    <div style="padding:16px 16px 0;display:flex;flex-direction:column;gap:10px">
      <button class="btn" id="lnSave" ${selN ? "" : "disabled"}>Mark washed${selN ? ` · ${selN} item${selN === 1 ? "" : "s"}` : ""}</button>
      ${_lnFromPrompt ? `<button class="lnk" id="lnNotYet" style="font-size:14px;color:var(--muted);padding:4px 0">Not yet</button>` : ""}
    </div>` : ""}
    ${!tracking ? `
    <div style="padding:18px 20px 0;margin-top:${hamper.length ? "14px" : "0"};${hamper.length ? "border-top:1px solid var(--line);" : ""}font-size:13.5px;line-height:1.5;color:var(--muted)">
      ${hamper.length
        ? "Wear-count tracking isn't on yet, so only pieces you tap into the hamper count as dirty."
        : "Nothing is tracked yet — laundry counts from an item's first logged wash."}
      Mark the whole closet washed as of the date above (your last real laundry
      day works) and the hamper fills itself from your wear log.
    </div>
    <div style="padding:12px 16px 0"><button class="btn${hamper.length ? " btn-sec" : ""}" id="lnStart">Mark whole closet washed</button></div>` : ""}
    <div style="height:max(env(safe-area-inset-bottom),20px)"></div>`;
  $("#lnCancel").onclick = () => { hideSheet("logSheet"); };
  /* Changing the date re-derives the lists, so anything that has just moved into
     "worn since then" is un-ticked — otherwise a load selected at today's date
     would silently carry pieces into a wash that ran two days ago, which is the
     whole bug. Loads are cleared too: "which loads did you run" is a question
     about that day, and the answer shouldn't survive the day changing. */
  const dateEl = $("#lnDate");
  if (dateEl) dateEl.onchange = () => {
    const next = dateEl.value || todayStr();
    if (next === _lnDate) return;
    _lnDate = next > todayStr() ? todayStr() : next;
    _lnActiveLoads = new Set();
    _lnSelIds = new Set();
    renderLaundrySheet();
  };
  $("#logInner").querySelectorAll("[data-lnload]").forEach(b => {
    b.onclick = () => {
      const l = b.dataset.lnload;
      const loads = l === "All" ? LAUNDRY_REAL_LOADS : [l];
      const turningOn = l === "All"
        ? !LAUNDRY_REAL_LOADS.every(x => _lnActiveLoads.has(x))
        : !_lnActiveLoads.has(l);
      for (const ll of loads) {
        if (_lnActiveLoads.has(ll) === turningOn) continue;  // already at target state
        if (turningOn) _lnActiveLoads.add(ll); else _lnActiveLoads.delete(ll);
        for (const id of _lnLoadIds(ll, hamper, worn)) {
          if (turningOn) _lnSelIds.add(id); else _lnSelIds.delete(id);
        }
      }
      renderLaundrySheet();
    };
  });
  $("#logInner").querySelectorAll("[data-lnitem]").forEach(b => {
    b.onclick = () => {
      const id = b.dataset.lnitem;
      if (_lnSelIds.has(id)) _lnSelIds.delete(id); else _lnSelIds.add(id);
      renderLaundrySheet();
    };
  });
  const save = $("#lnSave");
  if (save) save.onclick = async () => {
    const ids = [..._lnSelIds];
    const day = _lnDate || todayStr();
    hideSheet("logSheet");
    try {
      await stampWash(ids, day);
      toast(`${ids.length} item${ids.length === 1 ? "" : "s"} marked washed`);
    } catch (e) { toast(e.message); }
    const scr = $(".screen.active")?.id;
    if (scr === "tab-closet" && !detailId) renderCloset();
    else if (scr === "tab-home") renderHome();
  };
  const notYet = $("#lnNotYet");
  if (notYet) notYet.onclick = () => {
    store.setItem(LAUNDRY_SNOOZE_KEY, todayStr());
    hideSheet("logSheet");
    if ($(".screen.active")?.id === "tab-home") renderHome();
  };
  // Bootstrap: no item has a wash logged yet, so stamp the whole (trackable,
  // Available) closet clean as of the chosen date — tracking derives from there.
  const start = $("#lnStart");
  if (start) start.onclick = async () => {
    const day = _lnDate || todayStr();
    const ids = items.filter(i => itemStatus(i) === "Available" && wearTolerance(i) !== Infinity).map(i => i.id);
    hideSheet("logSheet");
    try {
      await stampWash(ids, day);
      toast(`Laundry tracking started — ${ids.length} items marked washed`);
    } catch (e) { toast(e.message); }
    const scr = $(".screen.active")?.id;
    if (scr === "tab-closet" && !detailId) renderCloset();
    else if (scr === "tab-home") renderHome();
  };
}

// Hamper list, honoring an active capsule/trip scope (suitcase hamper).
function _scopedHamper(ls) {
  let list = hamperItems(ls);
  if (activeCapsuleId) {
    const set = new Set((capsuleLinkMap.get(activeCapsuleId) || []).map(l => l.item_id));
    list = list.filter(i => set.has(i.id));
  }
  return list;
}
function _scopedWorn(ls) {
  let list = wornItems(ls);
  if (activeCapsuleId) {
    const set = new Set((capsuleLinkMap.get(activeCapsuleId) || []).map(l => l.item_id));
    list = list.filter(i => set.has(i.id));
  }
  return list;
}

// Full-page hamper — its own closet view (like a subcategory grid), because the
// closet row promises "Hamper · N" and a tap should SHOW them. The wash flow
// (load chips + date) still lives in the sheet, one tap away via "Did laundry".
/* Which load the hamper page is showing. Session-only and reset on entry — a
   filter that survived a trip back to the closet would be the invisible
   narrowing the rack was approved on condition of avoiding.
   `"__other__"` = colours no load claims (LAUNDRY_LOADS doesn't map every family,
   and a piece with no colour at all belongs somewhere she can reach). */
let hamperLoad = null;
const _hamperLoadOf = (i) => laundryLoadOf(i.color_family) || "__other__";
// The hamper as she's currently looking at it — used by the grid AND by
// siblingItems, so swiping between pieces stays inside the load she picked.
function hamperViewList(ls) {
  const list = _scopedHamper(ls);
  return hamperLoad ? list.filter(i => _hamperLoadOf(i) === hamperLoad) : list;
}

function renderClosetHamper() {
  const ls = laundryState();
  const all = _scopedHamper(ls);
  const list = hamperViewList(ls);
  const sub = (i) => { const d = dirtyDays(i, ls); return d == null ? "" : d === 0 ? "today" : `${d}d`; };
  /* Her ask, verbatim: "I need the ability to select which load from the hamper
     screen." Same three loads as the wash sheet, off the same LAUNDRY_LOADS
     mapping, so the page and the sheet can never disagree about what's a White. */
  const counts = new Map();
  for (const i of all) counts.set(_hamperLoadOf(i), (counts.get(_hamperLoadOf(i)) || 0) + 1);
  const loadChip = (key, label) => {
    const n = key ? (counts.get(key) || 0) : all.length;
    if (key && !n) return "";
    return `<button class="cap-chip${hamperLoad === key ? " on" : ""}" data-hload="${key || ""}" style="font-size:13px">${esc(label)} · ${n}</button>`;
  };
  const chips = all.length ? `<div style="padding:10px 16px 2px">
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px">Load</div>
      <div class="cap-catbar" style="flex-wrap:wrap;gap:6px">
        ${loadChip(null, "Everything")}
        ${LAUNDRY_REAL_LOADS.map(l => loadChip(l, l)).join("")}
        ${loadChip("__other__", "Other colours")}
      </div>
    </div>` : "";
  const body = list.length
    ? gridHtml(list, sub)
    : all.length
      ? `<div class="placeholder" style="padding:40px 32px"><b>Nothing in this load</b>
          <div>Tap <b>Everything</b> to see the rest of the hamper.</div></div>`
      : `<div class="placeholder" style="padding:40px 32px"><b>Nothing in the hamper 🎉</b>
          <div>Pieces land here once you've worn them enough times since their last wash — or when you tap "🧺 To hamper" on an item.</div></div>`;
  // The button carries the chosen load through, so the sheet opens with that
  // load lit and its pieces ticked instead of asking her the same question twice.
  const washLabel = hamperLoad && hamperLoad !== "__other__" ? `🧺 Did laundry — the ${hamperLoad.toLowerCase()}` : "🧺 Did laundry…";
  // "8 of 22" while a load chip is on — a bare total over a filtered grid reads
  // as a miscount, which is the same complaint as an unlabelled narrowed pool.
  return clToolbar(hamperLoad ? `Hamper · ${list.length} of ${all.length}` : `Hamper · ${all.length}`, true, false)
    + chips
    + (all.length ? `<div style="padding:8px 14px 2px"><button class="cl-capbtn" data-laundry-wash="${esc(hamperLoad && hamperLoad !== "__other__" ? hamperLoad : "")}" style="margin:0">${esc(washLabel)}</button></div>
       <div class="snote" style="padding:2px 16px 0">Set the day it ran and tick the loads there. Washed only part of a load? Tap <b>Select</b>, pick those pieces, then ✓.</div>` : "")
    + body
    + `<div style="padding:18px 0 32px;text-align:center"><button class="lnk" id="clRootJump" style="color:var(--muted);font-size:14px">Closet</button></div>`;
}

// The "worn" tray: worn since its last wash, still under tolerance. Subtitle
// shows how far along each piece is (2 of 5 wears).
function renderClosetWorn() {
  const ls = laundryState();
  const list = _scopedWorn(ls);
  const sub = (i) => {
    const n = wearDatesSinceWash(i, ls).length, tol = wearTolerance(i);
    return tol === Infinity ? `${n}` : `${n}/${tol}`;
  };
  const body = list.length
    ? gridHtml(list, sub)
    : `<div class="placeholder" style="padding:40px 32px"><b>Nothing worn yet</b>
        <div>Pieces land here once you've worn them since their last wash but not enough times to be dirty.</div></div>`;
  return clToolbar(`Worn · ${list.length}`, true, false)
    + `<div class="snote" style="padding:8px 16px 2px">Worn since washing, not dirty yet — the pile on the chair. Tap <b>Select</b> to send several to the hamper at once, or open one piece to do it individually.</div>`
    + body
    + `<div style="padding:18px 0 32px;text-align:center"><button class="lnk" id="clRootJump" style="color:var(--muted);font-size:14px">Closet</button></div>`;
}

// Pick a capsule/trip to scope the closet to (reuses the same activeCapsuleId path
// as "Plan outfits from this"; the banner + ✕ then show across closet + looks).
function openClosetCapsuleFilter() {
  // Same rule as the capsules list: archived sets aren't offered as a scope.
  const rows = activeCapsules().map(c => {
    const n = capsuleItemCount(c.id);
    const rep = capsuleItems(c.id).find(i => i.image_path);
    return `<button class="frow" data-capfilterpick="${esc(c.id)}">${thumbHtml(rep ? rep.image_path : null)}
      <div class="fmeta"><div class="fname">${esc(c.name)}</div>
      <div class="fcount">${esc(capModeLabel(c))} · ${n} item${n === 1 ? "" : "s"}</div></div>
      <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>`;
  }).join("");
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="capFilterCancel">Cancel</button>
      <h2>Filter by capsule</h2>
      <span style="width:54px"></span>
    </div>
    <div style="padding:6px 0 30px">${rows || `<div class="cal-day-empty" style="padding:24px 16px;text-align:center;color:var(--muted)">No capsules or trips yet.</div>`}</div>`;
  showSheet("logSheet");
  hydratePhotos($("#logInner"));
  $("#capFilterCancel").onclick = () => { hideSheet("logSheet"); };
  $("#logInner").querySelectorAll("[data-capfilterpick]").forEach(b => {
    b.onclick = () => { hideSheet("logSheet"); planFromCapsule(b.dataset.capfilterpick); };
  });
}

// Shared scope banner (E1): one component for every capsule-scoped surface.
// Trip mode gets its own wording + the ✕ exits the MODE (one mental model:
// the banner IS the mode); plain planning scope keeps its old behavior.
function scopeBannerHtml(prefix) {
  const c = capsuleById.get(activeCapsuleId);
  if (!c) return "";
  if (tripModeId === c.id) {
    const p = tripPhase(c);
    const day = p === "trip" ? ` · Day ${tripDayNum(c, todayStr())} of ${tripDates(c).length}` : "";
    return `<div class="cap-banner">
      <div class="cb-t">${isDatedTrip(c) ? "✈️ " : ""}${esc(c.name)}${day}</div>
      <button class="cb-x" data-cap-clear title="Exit trip mode">✕</button>
    </div>`;
  }
  return `<div class="cap-banner">
    <div class="cb-t">${esc(prefix)} · ${esc(c.name)}</div>
    <button class="cb-x" data-cap-clear>✕</button>
  </div>`;
}
// Banner shown across Closet screens while a capsule scopes the view.
function capsuleBanner() { return scopeBannerHtml("Planning"); }

function renderClosetCategory(cat) {
  const inCat = cat === "Other" ? lensItems().filter(isOtherCat) : lensItems().filter(i => i.category === cat);
  let rows = "";
  if (cat !== "Other") {
    for (const s of (TAXONOMY[cat] || [])) {
      const list = inCat.filter(i => i.subcategory === s);
      rows += rowHtml(folderThumb(list), s, list.length, `data-sub="${esc(s)}"`);
    }
    const subs = TAXONOMY[cat] || [];
    const other = inCat.filter(i => !i.subcategory || !subs.includes(i.subcategory));
    if (other.length) rows += rowHtml(folderThumb(other), "Other", other.length, `data-sub="__other__"`);
  }
  const hdr = `<div class="fhdr">${thumbHtml(folderThumb(inCat))}
    <div class="fmeta"><div class="fname big">${esc(cat)}</div>
    <div class="fcount">${inCat.length} item${inCat.length === 1 ? "" : "s"}</div></div></div>
    <button class="frow" data-sub="__all__" style="color:var(--accent);font-weight:600">
      <span>All Items in ${esc(cat)}</span>
      <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
    </button>`;
  // categories with no subcategory taxonomy (Other) jump straight to a grid
  return clToolbar(cat, true, true) + laundryLensHtml("closet", closetFilter)
    + (rows ? hdr + `<div class="frows">${rows}</div>` : hdr + gridHtml(sortItems(inCat)));
}

function categoryGrid(cat, sub) {
  const inCat = cat === "Other" ? lensItems().filter(isOtherCat) : lensItems().filter(i => i.category === cat);
  if (sub === "__all__") return sortItems(inCat);
  if (sub === "__other__") { const subs = TAXONOMY[cat] || []; return sortItems(inCat.filter(i => !i.subcategory || !subs.includes(i.subcategory))); }
  return sortItems(inCat.filter(i => i.subcategory === sub));
}

function renderCloset() {
  detailId = null;
  detailView = null;
  $("#itemBar").hidden = true;
  $("#app").classList.remove("detail-photo");
  const body = $("#closetBody");
  if (closetSearchQ !== null) {
    searchResults = closetSearchMatches(closetSearchQ);
    body.innerHTML = clToolbar("Search closet", true, false) + `
      <div style="padding:10px 14px 0"><input class="inp" id="clSearchInp" placeholder="Name, brand, color, type…" value="${esc(closetSearchQ)}" autocapitalize="off" autocorrect="off"></div>
      <div id="clSearchCount" style="padding:6px 14px 2px;font-size:13px;color:var(--muted)">${closetSearchQ ? `${searchResults.length} item${searchResults.length === 1 ? "" : "s"}` : "Start typing"}</div>
      <div id="clSearchResults">${closetSearchQ ? gridHtml(searchResults) : ""}</div>`;
    hydratePhotos(body);
    if (searchResults.length && closetSearchQ) showGridBar("closet"); else hideGridBar();
    const inp = $("#clSearchInp");
    if (inp) {
      inp.oninput = () => {
        closetSearchQ = inp.value;
        searchResults = closetSearchMatches(closetSearchQ);
        const wrap = $("#clSearchResults");
        if (wrap) { wrap.innerHTML = closetSearchQ ? gridHtml(searchResults) : ""; hydratePhotos(body); }
        const cnt = $("#clSearchCount");
        if (cnt) cnt.textContent = closetSearchQ ? `${searchResults.length} item${searchResults.length === 1 ? "" : "s"}` : "Start typing";
      };
      setTimeout(() => inp.focus(), 80);
    }
    return;   // #clBack is handled by the global delegation in wireEvents
  }
  if (closetHamper) {
    body.innerHTML = renderClosetHamper();
  } else if (closetRack) {
    body.innerHTML = renderClosetRack();
  } else if (closetWorn) {
    body.innerHTML = renderClosetWorn();
  } else if (closetCat && closetSub) {
    const label = closetSub === "__all__" ? "All" : closetSub === "__other__" ? "Other" : closetSub;
    body.innerHTML = clToolbar(`${closetCat} · ${label}`, true, true)
      + laundryLensHtml("closet", closetFilter) + gridHtml(categoryGrid(closetCat, closetSub))
      + `<div style="padding:18px 0 32px;text-align:center"><button class="lnk" id="clRootJump" style="color:var(--muted);font-size:14px">Closet</button></div>`;
  } else if (closetCat) {
    body.innerHTML = renderClosetCategory(closetCat);
  } else {
    body.innerHTML = renderClosetRoot();
  }
  // While a capsule scopes the closet, show a clear-able banner under the toolbar
  // on every screen (root already omits the lens row).
  if (activeCapsuleId && closetCat) {
    const tb = body.querySelector(".cltoolbar");
    if (tb) tb.insertAdjacentHTML("afterend", capsuleBanner());
  } else if (activeCapsuleId && !closetCat) {
    const lens = body.querySelector(".cltoolbar");
    if (lens) lens.insertAdjacentHTML("afterend", capsuleBanner());
  }
  hydratePhotos(body);
  const hasGrid = !!body.querySelector(".grid");
  if (hasGrid) showGridBar("closet"); else hideGridBar();
  // wire "+" add button (pre-fills category context)
  const clPlus = $("#clPlus");
  if (clPlus) clPlus.onclick = () => {
    _addSeed = {
      category: (closetCat && closetCat !== "Other") ? closetCat : null,
      subcategory: (closetSub && closetSub !== "__all__" && closetSub !== "__other__") ? closetSub : null,
    };
    switchTab("add");
  };
  // Manual rebuild. The rack keeps itself up to date on its own cadence; this is
  // the escape hatch for "I've changed what I'm wearing and want it to catch up
  // now", not a maintenance chore.
  const rackBtn = $("#rackRebuild");
  if (rackBtn) rackBtn.onclick = async () => {
    rackBtn.disabled = true; rackBtn.textContent = "Rebuilding…";
    await rackEnsure({ force: true });
    if (closetRack) renderCloset();
  };
  // "Worth a second look" rows → the label-it-yourself sheet (never a verdict).
  body.querySelectorAll("[data-rsecond]").forEach(b =>
    b.onclick = () => openRackSecondLook(b.dataset.rsecond));
  // "Taken off the rack" list: open the piece, or put it straight back.
  body.querySelectorAll("[data-item-open]").forEach(b =>
    b.onclick = () => openItem(b.dataset.itemOpen));
  body.querySelectorAll("[data-rack-return]").forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    b.disabled = true;
    await rackReturnPiece(b.dataset.rackReturn);
  });
  // "Closet" footer link — jumps all the way back to root
  const clRootJump = $("#clRootJump");
  if (clRootJump) clRootJump.onclick = () => { closetCat = null; closetSub = null; searchResults = null; closetSearchQ = null; closetHamper = false; closetWorn = false; closetRack = false; navResetScroll("closet"); renderCloset(); scrollToTop(); };
}

// Snapshot the screen currently showing so back can return there. null when we're
// already on the destination tab (the default back behavior is then correct).
function makeScreenReturn(homeTab) {
  const active = document.querySelector(".screen.active");
  const tab = active ? active.id.replace("tab-", "") : homeTab;
  if (tab === homeTab) return null;
  const sc = getScrollTop();               // land back exactly where the user was
  const fn = () => { restoreTab(tab); restoreScroll(sc); };
  fn.tab = tab;  // lets openItem() label its back button with the real destination
  return fn;
}
function makeItemReturn() { return makeScreenReturn("closet"); }

// Re-show a tab from its PRESERVED view-state (unlike switchTab, which resets
// per-tab view globals like capsuleView/statsView). Used to return from item detail.
function restoreTab(tab) {
  $$(".screen").forEach(s => s.classList.toggle("active", s.id === `tab-${tab}`));
  $$("#tabbar button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  $("#title").textContent = TAB_TITLES[tab] || "";
  $("#headerAdd").hidden = tab !== "home";
  $("#itemBar").hidden = true;
  $("#app").classList.remove("detail-photo");
  hideGridBar();
  if (tab === "capsules")      renderCapsules();
  else if (tab === "stats")    renderStats();
  else if (tab === "looks") {
    // A look was open when we left (e.g. tapped one of its pieces) — return to
    // it, not the list. renderLooks() would wipe lookId.
    if (lookId && outfitById.has(lookId)) {
      if (lookView === "details")    openLookDetails(lookId);
      else if (lookView === "wears") openLookWears(lookId);
      else                           openLook(lookId);
    } else renderLooks();
  }
  else if (tab === "calendar") renderCalendar();
  else if (tab === "home")     renderHome();
  else                         renderCloset();
}

// Open an item while remembering the origin screen. Use from any non-closet entry
// point (looks, capsules, stats, suggestions, calendar…) instead of bare
// switchTab("closet") + openItem, so back returns to where the item was opened.
// V3 nav-audit fix: pass `browseCtx` ({cat, sub}) instead of pre-setting
// closetCat/closetSub at the call site — the closet browse state is snapshotted
// here and restored when the return thunk fires, so viewing an item from another
// screen no longer silently moves the closet tab's position.
function openItemFrom(id, browseCtx) {
  const ret = makeItemReturn();             // capture BEFORE we bring the closet forward
  if (ret) {
    const snap = { cat: closetCat, sub: closetSub, res: searchResults };
    _itemReturn = () => { closetCat = snap.cat; closetSub = snap.sub; searchResults = snap.res; _itemSiblingIds = null; _itemSiblingLabel = null; ret(); };
    _itemReturn.tab = ret.tab;
  } else _itemReturn = null;
  // Explicit sibling list (capsule/trip grid) — prev/next swipes through it
  // instead of a closet category.
  _itemSiblingIds = (browseCtx && browseCtx.siblings) || null;
  _itemSiblingLabel = (browseCtx && browseCtx.siblingLabel) || null;
  if (browseCtx) {  // sibling prev/next nav browses the item's own category
    closetCat = browseCtx.cat ?? null;
    closetSub = browseCtx.sub ?? null;
    searchResults = null;
  }
  builder = null; $("#app").classList.remove("builder-mode");
  $$(".screen").forEach(s => s.classList.toggle("active", s.id === "tab-closet"));
  $$("#tabbar button").forEach(b => b.classList.toggle("on", b.dataset.tab === "closet"));
  $("#title").textContent = "";
  $("#headerAdd").hidden = true;
  hideGridBar();
  openItem(id);
}

// Open a look while remembering the origin screen. Use from any non-Looks entry
// point (calendar, stats, capsules…) instead of switchTab("looks") + openLook,
// so back returns to where the look was opened.
function openLookFrom(id) {
  _lookReturn = makeScreenReturn("looks");  // capture BEFORE we bring Looks forward
  _lookSiblingIds = null;                   // opened singly from another screen — no sibling strip
  $$(".screen").forEach(s => s.classList.toggle("active", s.id === "tab-looks"));
  $$("#tabbar button").forEach(b => b.classList.toggle("on", b.dataset.tab === "looks"));
  $("#title").textContent = TAB_TITLES.looks;
  $("#headerAdd").hidden = true;
  openLook(id);
}

function closetBack() {
  if (selectMode) { exitSelectMode(); renderCloset(); return; }
  if (detailId && detailView === "wears") { openItemDetails(detailId); return; }
  if (detailId && detailView === "details") { openItem(detailId); return; }
  if (detailId && _reviewMode) {
    _reviewMode = false;
    detailId = null; detailView = null;
    $("#itemBar").hidden = true;
    $("#app").classList.remove("detail-photo");
    // Return to review deal card
    $$(".screen").forEach(s => s.classList.toggle("active", s.id === "tab-stats"));
    $$("#tabbar button").forEach(b => b.classList.toggle("on", b.dataset.tab === "stats"));
    $("#title").textContent = "Style Stats";
    $("#headerAdd").hidden = true;
    statsView = "review-deal";
    renderStats(); return;
  }
  if (detailId && _fromBuilder) {
    const stash = _fromBuilder; _fromBuilder = null;
    detailId = null; detailView = null;
    $("#itemBar").hidden = true;
    $("#app").classList.remove("detail-photo");
    builder = stash;
    $("#app").classList.add("builder-mode");
    switchTab("builder");
    return;
  }
  if (detailId && _itemReturn) {
    const r = _itemReturn; _itemReturn = null;
    detailId = null; detailView = null;
    $("#itemBar").hidden = true;
    $("#app").classList.remove("detail-photo");
    r(); return;
  }
  if (detailId) {
    detailId = null; detailView = null;
    $("#itemBar").hidden = true;
    $("#app").classList.remove("detail-photo");
    renderCloset(); restoreScroll(_detailEntryScroll); _detailEntryScroll = 0; return;
  }
  // Back out of a keyword search before unwinding the folder stack — the search
  // is what she can see, so it's what back should close.
  if (closetSearchQ !== null) { closetSearchQ = null; searchResults = null; renderCloset(); navShallower("closet"); return; }
  if (closetHamper) { closetHamper = false; }
  if (closetRack) { closetRack = false; }
  if (closetWorn) { closetWorn = false; }
  else if (closetSub) { closetSub = null; }
  else if (closetCat) { closetCat = null; }
  renderCloset();
  navShallower("closet");
}

