/* ===================================================================
   CAPSULES + TRIPS  (named item sets; trips add dates + packing checklist)
   =================================================================== */
let capsuleId = null;            // detail / picker target
let capsuleView = "list";        // "list" | "detail" | "form" | "pick" | "plan" | "pack"
let _capForm = null;             // {name, kind, start_date, end_date, notes} during create
let _capPick = new Set();        // selected item ids in the add-items picker
let _capPickFilter = "";         // keyword filter in the picker
let _capSheetMode = false;       // bulk "add to capsule" sheet open (reuses #moveSheet)
let _pendingAddIds = null;       // items to fold into a capsule right after creation
let _capNotesTimer = null;
let _capSort = "category";       // detail grid grouping: "category" | "formality"
let _capUnpackedOnly = false;    // trip detail: show only not-yet-packed items
let _capUnwornOnly = false;      // trip detail: show only what hasn't been worn yet ON the trip
let _capPickCat = null;          // picker category filter (null = all)
let _capPickSub = null;          // picker subcategory filter (null = all within cat)
let _capPickStatus = "Available"; // picker status lens: "Available" | "Storage" | "All"
let _capArchiveOpen = false;      // session-only: is the archived section expanded?

/* ---- ARCHIVED CAPSULES (2026-07-25, her request) --------------------------
   Past trips are worth KEEPING — they carry packing lists, plans, and (for
   dated ones) the locations that make `awayRanges` work — but a finished trip
   shouldn't sit at the top of the list forever. Archiving hides it from the
   main list behind an expander; nothing else about it changes.
   ⚠️ Rides `kv`, NOT a new `capsules.archived` column, so it ships without a
   migration (same reasoning as dayplan/wherelog). If a column is ever added,
   migrate this key rather than running both.
   ⚠️ An archived TRIP still contributes its locations to `awayRanges()` — the
   travel happened, and its weather corrections must not silently revert. */
const CAP_ARCHIVE_KEY = "capsule_archive";
const archivedCapsuleIds = () => new Set(kvData.get(CAP_ARCHIVE_KEY) || []);
const isCapsuleArchived = (id) => archivedCapsuleIds().has(id);
const activeCapsules = () => { const a = archivedCapsuleIds(); return capsules.filter(c => !a.has(c.id)); };

async function setCapsuleArchived(id, on) {
  try {
    await kvUpdate(CAP_ARCHIVE_KEY, prev => {
      const set = new Set(Array.isArray(prev) ? prev : []);
      if (on) set.add(id); else set.delete(id);
      return [...set];
    });
  } catch (e) { toast(e.message); return; }
  // A capsule that's being put away shouldn't keep scoping the closet.
  if (on && activeCapsuleId === id) activeCapsuleId = null;
  if (on && tripModeId === id) exitTripMode();
}

// canonical category order for grouping (packing-friendly)
const CAP_CAT_ORDER = ["Outerwear", "Tops", "Dresses", "Bottoms", "Shoes", "Workout"];
const catRank = (c) => { const i = CAP_CAT_ORDER.indexOf(c); return i < 0 ? 99 : i; };
// → [{key, items}] grouped by category in canonical order, items sorted by color (closet default)
function groupByCategory(list) {
  const map = new Map();
  for (const i of list) { const c = i.category || "Other"; if (!map.has(c)) map.set(c, []); map.get(c).push(i); }
  const keys = [...map.keys()].sort((a, b) => { const r = catRank(a) - catRank(b); return r !== 0 ? r : a.localeCompare(b); });
  return keys.map(k => ({ key: k, items: sortItems(map.get(k), "color") }));
}
// → [{key, items}] grouped by formality levels (only non-empty). Items with multi-level sets
// appear in the group for their minimum (most casual) level.
function groupByFormality(list) {
  const buckets = OCCASION_LADDER.map(lbl => ({ key: lbl, items: [] }));
  for (const i of list) { const lv = Math.max(1, Math.min(8, itemFormality(i))); buckets[lv - 1].items.push(i); }
  return buckets.filter(b => b.items.length)
    .map(b => ({ key: b.key, items: sortItems(b.items, "color") }));
}

const isTrip = (c) => c && c.kind !== "capsule";
const capModeLabel = (c) => isTrip(c) ? "Trip" : "Capsule";

function capValue(cid) {
  return capsuleItems(cid).reduce((s, i) => s + (Number(i.price) || 0), 0);
}
function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function capDateLabel(c) {
  if (!c.start_date && !c.end_date) return "";
  if (c.start_date && c.end_date) return `${fmtDate(c.start_date)} – ${fmtDate(c.end_date)}`;
  return fmtDate(c.start_date || c.end_date);
}

// small 2×2 collage thumbnail for a capsule card
function capCollageHtml(cid) {
  const paths = capsuleItems(cid).filter(i => i.image_path).slice(0, 4).map(i => i.image_path);
  if (!paths.length) return `<div class="cap-collage empty"><svg viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8V5h6v3"/></svg></div>`;
  const cls = paths.length === 1 ? "cap-collage solo" : "cap-collage";
  return `<div class="${cls}">${paths.map(p => `<div class="cc-cell" data-photo="${esc(p)}"></div>`).join("")}</div>`;
}

function renderCapsules() {
  const body = $("#capsulesBody");
  clearInterval(_wxAutoTimer); _wxAutoTimer = null;  // any prior trip-detail auto-refresh
  if (capsuleView === "form")      body.innerHTML = renderCapsuleForm();
  else if (capsuleView === "pick") body.innerHTML = renderCapsulePicker();
  else if (capsuleView === "pack" && capsuleById.get(capsuleId)) body.innerHTML = renderCapsulePack();
  else if (capsuleView === "packopts" && capsuleById.get(capsuleId)) body.innerHTML = renderPackOptionsPage();
  else if (capsuleView === "trip" && capsuleById.get(capsuleId)) body.innerHTML = renderCapsuleTrip();
  else if (capsuleView === "plan" && capsuleById.get(capsuleId)) body.innerHTML = renderCapsulePlan();
  else if (capsuleView === "detail" && capsuleById.get(capsuleId)) body.innerHTML = renderCapsuleDetail();
  else { capsuleView = "list"; body.innerHTML = renderCapsuleList(); }
  hydratePhotos(body);
  wireCapsules();
  if (capsuleView === "list") wireCapSwipe(body);
  if (capsuleView === "form") wireCapFormLoc();
  if (capsuleView === "plan") {
    const c = capsuleById.get(capsuleId);
    if (c && (c.locations || []).length && _planWxLoadedFor !== c.id) loadPlanWeather(c);
  }
  if (capsuleView === "detail") {
    const c = capsuleById.get(capsuleId);
    if (c && isTrip(c) && c.start_date && c.end_date && (c.locations || []).length) {
      loadTripWeather(c);
      // Auto-refresh the live strip while this trip detail stays open (cleared on any re-render / tab switch)
      _wxAutoTimer = setInterval(() => {
        delete _wxCache[c.id];
        loadTripWeather(c);
      }, WX_TTL);
    }
  }
}

function capToolbar(title, showBack, right = "") {
  // Root drops the duplicated title (see clToolbar) — and unlike the other
  // tabs the capsules root often has no actions either, so the whole row goes
  // rather than leaving an empty sticky strip.
  if (!showBack && !right) return "";
  return `<div class="cltoolbar${showBack ? "" : " tb-root"}">
    ${showBack
      ? `<button class="clback" id="capBack"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
         <div class="cltitle">${esc(title)}</div>`
      : ""}
    ${right}
  </div>`;
}

/* Capsules and trips are two different things she goes looking for at different
   moments — a trip is a dated event, a capsule is a standing set. One merged
   list meant scrolling past six trips to reach a capsule, so they're two tabs.
   ⚠️ The split is by DATES, not `kind` — dates are what trip mode keys on
   everywhere else (see completedTrips), and a "packing" capsule with no dates
   behaves like a capsule in every other part of the app. */
let capsuleTab = "trips";        // "trips" | "capsules" — session-only
function renderCapsuleList() {
  const card = (c) => {
    const n = capsuleItemCount(c.id);
    const dates = capDateLabel(c);
    const bits = [`${n} item${n === 1 ? "" : "s"}`];
    if (capValue(c.id)) bits.push(money(capValue(c.id)));
    if (dates) bits.unshift(dates);
    // Swipe-left to delete, same idiom as a calendar wear card.
    return `<div class="cap-swipe" data-cap-swipe="${esc(c.id)}">
      <div class="cap-swipe-acts">
        <button class="cal-act cal-act-del" data-cap-del-row="${esc(c.id)}">
          <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/></svg>
          Delete
        </button>
      </div>
      <button class="cap-card cap-swipe-inner" data-cap="${esc(c.id)}">
        ${capCollageHtml(c.id)}
        <div class="cap-meta">
          <div class="cap-badge${isTrip(c) ? " trip" : ""}">${capModeLabel(c)}</div>
          <div class="cap-name">${esc(c.name)}</div>
          <div class="cap-sub">${esc(bits.join(" · "))}</div>
        </div>
        <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
      </button>
    </div>`;
  };
  const isTripRow = (c) => !!(c.start_date || c.end_date);
  const arch = archivedCapsuleIds();
  const mine = capsules.filter(c => capsuleTab === "trips" ? isTripRow(c) : !isTripRow(c));
  const live = mine.filter(c => !arch.has(c.id));
  // Newest trips first among archived — that's how she'll look for one.
  const put = mine.filter(c => arch.has(c.id))
    .sort((a, b) => String(b.start_date || b.created_at || "").localeCompare(String(a.start_date || a.created_at || "")));
  const nTrips = capsules.filter(isTripRow).length, nCaps = capsules.length - nTrips;

  const tabs = `<div class="cap-tabbar">
    <button data-captab="trips" class="${capsuleTab === "trips" ? "on" : ""}">Trips${nTrips ? ` · ${nTrips}` : ""}</button>
    <button data-captab="capsules" class="${capsuleTab === "capsules" ? "on" : ""}">Capsules${nCaps ? ` · ${nCaps}` : ""}</button>
  </div>`;
  // ＋ at the TOP (her ask) — it's the reason she opens this screen on a day
  // when nothing is listed yet, so it must not sit under the whole list.
  const newBtn = `<button class="cap-newbtn" data-cap-new="${capsuleTab === "trips" ? "packing" : "capsule"}" style="margin:10px 14px 4px">＋ New ${capsuleTab === "trips" ? "trip" : "capsule"}</button>`;

  if (!live.length && !put.length) {
    return capToolbar("Capsules", false) + tabs + newBtn + `
      <div class="cap-empty">
        <svg viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8V5h6v3"/></svg>
        <b>No ${capsuleTab === "trips" ? "trips" : "capsules"} yet</b>
        <div>${capsuleTab === "trips"
          ? "A trip has dates and a place — that's what unlocks the weather, the packing list and the build-a-pack solver."
          : "A capsule is a standing named set of pieces you can plan outfits from. No dates."}</div>
      </div>`;
  }
  const archSection = put.length ? `
    <button class="frow" data-cap-archtoggle style="margin:4px 14px 0;border-radius:14px">
      <span style="flex:1;text-align:left">🗄 Archived · ${put.length}</span>
      <svg class="chev" viewBox="0 0 24 24" style="${_capArchiveOpen ? "transform:rotate(90deg)" : ""}"><path d="M9 6l6 6-6 6"/></svg>
    </button>
    ${_capArchiveOpen ? `<div class="cap-list" style="opacity:.72">${put.map(card).join("")}</div>` : ""}` : "";
  return capToolbar("Capsules", false) + tabs + newBtn +
    (live.length ? `<div class="cap-list">${live.map(card).join("")}</div>`
                 : `<div class="placeholder" style="padding:18px 16px;font-size:13px;color:var(--muted)">Everything's archived. Open the section below to bring one back.</div>`) +
    archSection;
}

// Swipe-left on a capsule row, same mechanics as wireCalSwipe.
function wireCapSwipe(root) {
  (root || document).querySelectorAll("[data-cap-swipe]").forEach(card => {
    const inner = card.querySelector(".cap-swipe-inner");
    const acts = card.querySelector(".cap-swipe-acts");
    if (!inner || !acts) return;
    const W = 70;
    let startX = 0, startY = 0, opened = false, tracking = false, axis = null;
    card.addEventListener("touchstart", e => {
      startX = e.touches[0].clientX; startY = e.touches[0].clientY;
      tracking = true; axis = null;
      inner.style.transition = "none"; acts.style.transition = "none";
    }, { passive: true });
    card.addEventListener("touchmove", e => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - startX, dy = e.touches[0].clientY - startY;
      // Don't hijack a vertical scroll of the list.
      if (!axis) { if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return; axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y"; }
      if (axis !== "x") return;
      const off = Math.max(-W, Math.min(0, (opened ? -W : 0) + dx));
      inner.style.transform = `translateX(${off}px)`;
      acts.style.transform = `translateX(${100 + (off / W * 100)}%)`;
    }, { passive: true });
    card.addEventListener("touchend", e => {
      if (!tracking) return;
      tracking = false;
      if (axis !== "x") return;
      const dx = e.changedTouches[0].clientX - startX;
      inner.style.transition = "transform .25s ease"; acts.style.transition = "transform .25s ease";
      opened = opened ? dx < 30 : dx < -50;
      inner.style.transform = opened ? `translateX(-${W}px)` : "translateX(0)";
      acts.style.transform = opened ? "translateX(0)" : "translateX(100%)";
    }, { passive: true });
  });
}

// ---- create form ----
function openCapsuleNew(kind = "capsule") {
  _capForm = { name: "", kind: kind === "packing" ? "packing" : "capsule",
               start_date: "", end_date: "", notes: "", anchors: [],
               loc: null, locQ: "", locResults: [] };
  capsuleView = "form";
  renderCapsules();
}

function renderCapsuleForm() {
  const f = _capForm;
  const trip = f.kind !== "capsule";
  return capToolbar(trip ? "New trip" : "New capsule", true) + `
    <div class="cap-form">
      <div>
        <label class="fld">Name</label>
        <input class="inp" id="capName" placeholder="e.g. Spain trip, Fall capsule" value="${esc(f.name)}">
      </div>
      <div>
        <label class="fld">Type</label>
        <div class="cap-modebar">
          <button data-capmode="capsule" class="${!trip ? "on" : ""}">Capsule</button>
          <button data-capmode="packing" class="${trip ? "on" : ""}">Trip</button>
        </div>
      </div>
      ${trip ? `<div class="cap-dates">
        <div><label class="fld">Start</label><input class="inp" type="date" id="capStart" value="${esc(f.start_date)}"></div>
        <div><label class="fld">End</label><input class="inp" type="date" id="capEnd" value="${esc(f.end_date)}"></div>
      </div>
      <div>
        <label class="fld">Where</label>
        ${f.loc
          ? `<div class="pack-anchor"><span>📍 ${esc(f.loc.name)}</span>
               <button class="pack-drop" id="capLocClear" aria-label="Remove">×</button></div>`
          : `<input class="inp" id="capLocInp" placeholder="Search a city…" value="${esc(f.locQ || "")}" autocomplete="off">
             ${(f.locResults || []).length ? `<div class="det-card" style="margin-top:6px">
               ${f.locResults.map((r, k) => `<button class="det-row" data-caploc="${k}" style="width:100%">
                 <span class="det-lbl">${esc(r.name)}</span>
                 <span class="det-val" style="font-size:12px">${esc([r.admin1, r.country].filter(Boolean).join(", "))}</span>
               </button>`).join("")}
             </div>` : ""}`}
        <div class="pack-warn-note" style="padding:4px 0 0">Sets the trip's weather straight away — you can add more stops later.</div>
      </div>
      <div>
        <label class="fld">Anything already fixed? (optional)</label>
        ${(f.anchors || []).map((a, idx) => `<div class="pack-anchor">
          <span>${esc(a.context)} · ${esc(fmtDate(a.date))}</span>
          <button class="pack-drop" data-capanchor-del="${idx}" aria-label="Remove">×</button>
        </div>`).join("")}
        <button class="cap-chip" data-capanchor-add>＋ Add an event</button>
        <div class="pack-warn-note" style="padding:4px 0 0">A wedding or a concert. Saying so now is what lets the app warn you in time to do something about it.</div>
      </div>` : ""}
      <div>
        <label class="fld">Notes (optional)</label>
        <textarea class="inp" id="capNotes" rows="3" placeholder="Anything to remember…">${esc(f.notes)}</textarea>
      </div>
      <button class="btn" id="capCreate">Create ${trip ? "trip" : "capsule"}</button>
    </div>`;
}

// Live city search on the create form — same geocoder the location sheet uses,
// so a trip can carry its weather from the moment it exists.
function wireCapFormLoc() {
  const inp = $("#capLocInp");
  if (inp) {
    let timer;
    inp.oninput = () => {
      if (!_capForm) return;
      _capForm.locQ = inp.value;
      clearTimeout(timer);
      if (!inp.value.trim()) { _capForm.locResults = []; return; }
      timer = setTimeout(async () => {
        syncCapForm();
        let res = [];
        try { res = await geocodeLocation(inp.value.trim()); } catch (e) { res = []; }
        if (!_capForm || capsuleView !== "form") return;
        _capForm.locResults = res.slice(0, 5);
        renderCapsules();
        const again = $("#capLocInp");
        if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      }, 380);
    };
  }
  $$("[data-caploc]").forEach(el => el.onclick = () => {
    syncCapForm();
    const r = (_capForm.locResults || [])[+el.dataset.caploc];
    if (!r) return;
    const extra = [r.admin1, r.country].filter(Boolean)[0];
    _capForm.loc = { name: r.name + (extra ? `, ${extra}` : ""), lat: r.lat, lon: r.lon };
    _capForm.locQ = ""; _capForm.locResults = [];
    renderCapsules();
  });
  const clr = $("#capLocClear");
  if (clr) clr.onclick = () => { syncCapForm(); _capForm.loc = null; renderCapsules(); };
}

async function saveNewCapsule() {
  syncCapForm();
  const f = _capForm;
  if (!f.name.trim()) { toast("Give it a name"); return; }
  const payload = { name: f.name.trim(), kind: f.kind, notes: f.notes || null };
  if (isTripKind(f.kind)) {
    payload.start_date = f.start_date || null;
    payload.end_date = f.end_date || null;
    // from/to null = "covers the whole trip", same convention as _saveLocation.
    if (f.loc) payload.locations = [{ name: f.loc.name, lat: f.loc.lat, lon: f.loc.lon, from: null, to: null }];
  }
  try {
    const rows = await rest("/capsules?select=*", {
      method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(payload),
    });
    const c = rows[0];
    capsules.unshift(c);
    buildCapsuleIndexes();
    // fold in any items queued from a closet bulk "add to capsule"
    if (_pendingAddIds && _pendingAddIds.length) {
      await addItemsToCapsule(c.id, _pendingAddIds);
      _pendingAddIds = null;
    }
    /* Booking-time capture (TRIP_BUILDER.md D4). Character is one kv string;
       an anchor event IS a named context on a date, so it goes straight into
       dayplan — which also means rackNeededLevels stocks the home rack for it
       automatically, bounded by RACK_LOOKAHEAD_DAYS. */
    for (const a of (f.anchors || [])) {
      try {
        const existing = dayPlan(a.date);
        await saveDayPlan(a.date, existing.concat([{ contexts: [a.context], outfit: null }]));
      } catch (err) { /* non-fatal */ }
    }
    _capForm = null;
    capsuleId = c.id;
    capsuleView = "detail";
    renderCapsules();
    toast("Capsule created");
  } catch (e) { toast(e.message); }
}
const isTripKind = (k) => k !== "capsule";

function syncCapForm() {
  if (!_capForm) return;
  const name = $("#capName"); if (name) _capForm.name = name.value;
  const notes = $("#capNotes"); if (notes) _capForm.notes = notes.value;
  const s = $("#capStart"); if (s) _capForm.start_date = s.value;
  const e = $("#capEnd"); if (e) _capForm.end_date = e.value;
}

// ---- detail ----
/* ⚠️ A DATED TRIP OPENS THE ONE TRIP SCREEN (2026-08-09, her ask to unify the
   packing/trip screens). The old detail page is still the right screen for an
   undated capsule — no phases, no bag, no occasions — and it stays reachable
   for a trip through ⋯ → Locations & weather, which is the part of it that
   isn't duplicated anywhere else. */
function openCapsule(id) {
  navDeeper("capsules");
  capsuleId = id;
  const c = capsuleById.get(id);
  capsuleView = (typeof isDatedTrip === "function" && isDatedTrip(c)) ? "trip" : "detail";
  _tripSection = null;                 // let the trip's phase choose
  _capUnpackedOnly = false;
  _capUnwornOnly = false;
  renderCapsules();
}



// category- or formality-grouped grid with per-group counts (and packed counts for trips)
function capGroupsHtml(list, trip, packedSet) {
  if (!list.length) return `<div class="placeholder" style="padding:40px 32px"><b>No items yet</b><div>Add pieces to start planning.</div></div>`;
  return itemGridView(list, {
    group: _capSort,
    onTap: "cap-item",
    packedSet: trip ? packedSet : null,
    trip,
  });
}

function renderCapsuleDetail() {
  const c = capsuleById.get(capsuleId);
  const list = capsuleItems(capsuleId);
  const trip = isTrip(c);
  const dates = capDateLabel(c);
  const sub = [capModeLabel(c)];
  if (dates) sub.push(dates);

  // formality coverage across all 8 levels
  const covered = new Set();
  for (const i of list) { for (const l of (itemFormalitySet(i) || [])) covered.add(l); }
  const covChips = OCCASION_LADDER.map((lbl, idx) =>
    `<span class="cap-cov-chip${covered.has(idx + 1) ? " on" : ""}" title="${esc(OCCASION_HINTS[idx])}">${idx + 1}. ${esc(lbl)}</span>`).join("");

  // rough outfit-combination estimate
  const byCat = (cat) => list.filter(i => i.category === cat).length;
  const combos = (byCat("Tops") * byCat("Bottoms") + byCat("Dresses")) * Math.max(1, byCat("Shoes"));

  let packHtml = "";
  if (trip && list.length) {
    const links = capsuleLinkMap.get(capsuleId) || [];
    const packed = links.filter(l => l.packed).length;
    const pct = Math.round((packed / list.length) * 100);
    packHtml = `<div class="cap-pack">
      <div class="cap-pack-bar"><div class="cap-pack-fill" style="width:${pct}%"></div></div>
      <div class="cap-pack-lbl">${packed} of ${list.length} packed · tap the circle on a piece to check it off</div>
    </div>`;
  }

  let wxHtml = "";
  /* ⚠️ Locations render for ANY trip, not only a fully dated one (2026-08-04 r3,
     her ask: "I need to be able to remove locations the app has identified").
     This was gated on start_date && end_date, so a trip missing an end date hid
     the whole section — and with it the only × that can remove a location. A
     list you can't get to is a list you can't correct. Weather still needs the
     dates; that half says so instead of vanishing. */
  if (trip) {
    const dated = !!(c.start_date && c.end_date);
    const locs = c.locations || [];
    const locRows = locs.map((l, i) => {
      const range = (l.from || l.to) ? `${l.from ? fmtDate(l.from) : "start"} – ${l.to ? fmtDate(l.to) : "end"}` : "Whole trip";
      return `<div class="loc-row">
        <span class="loc-pin">📍</span>
        <div class="loc-info">
          <div class="loc-name">${esc(l.name)}</div>
          <div class="loc-range">${esc(range)}</div>
        </div>
        <button class="loc-del" data-loc-del="${i}" aria-label="Remove location">×</button>
      </div>`;
    }).join("");
    const wxContent = (dated && locs.length)
      ? `<div id="wxStrip"><div class="wx-loading muted">Loading weather…</div></div>`
      : `<div id="wxStrip"></div>`;
    wxHtml = `<div class="wx-section">
      <div class="wx-sec-hdr">
        <div class="wx-sec-title">Locations</div>
        <div style="display:flex;gap:6px;align-items:center">
          ${dated && locs.length ? `<button class="wx-add-btn" data-wx-refresh aria-label="Refresh weather"><svg viewBox="0 0 24 24" style="width:15px;height:15px;stroke:currentColor;stroke-width:2;fill:none;vertical-align:-2px"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/></svg></button>` : ""}
          <button class="wx-add-btn" data-loc-add>＋ Add</button>
        </div>
      </div>
      ${locRows || `<div class="wx-no-locs">No locations yet — add one to see weather.</div>`}
      ${!dated && locs.length ? `<div class="wx-no-locs">Set the trip dates to see weather for these.</div>` : ""}
      ${wxContent}
    </div>`;
  }

  const packedSet = new Set((capsuleLinkMap.get(capsuleId) || []).filter(l => l.packed).map(l => l.item_id));
  // "Unworn only" is offered once the trip has started — before that everything
  // is unworn and the chip is a no-op. It shares the grid with "Unpacked only";
  // the two answer different questions, so turning one on turns the other off.
  const started = isDatedTrip(c) && c.start_date <= todayStr();
  const unwornSet = started
    ? new Set(tripRecapData(c, { through: todayStr() }).dead.map(i => i.id)) : null;
  let gridList = list;
  if (trip && _capUnpackedOnly) gridList = list.filter(i => !packedSet.has(i.id));
  else if (unwornSet && _capUnwornOnly) gridList = list.filter(i => unwornSet.has(i.id));
  let grid;
  if (trip && _capUnpackedOnly && !gridList.length && list.length) {
    grid = `<div class="placeholder" style="padding:40px 32px"><b>All packed 🎉</b><div>Every item is checked off.</div></div>`;
  } else if (unwornSet && _capUnwornOnly && !gridList.length && list.length) {
    grid = `<div class="placeholder" style="padding:40px 32px"><b>Nothing left in the bag 🎉</b><div>Every piece you packed has been worn.</div></div>`;
  } else {
    grid = capGroupsHtml(gridList, trip, packedSet);
  }
  // The payoff for looking at the unworn list: build something out of it. Not a
  // hard filter on the pool — see tripUnwornPool for why.
  const unwornBuild = (unwornSet && _capUnwornOnly && gridList.length)
    ? `<button class="cap-chip on" data-cap-unworn-suggest style="margin:0 14px 8px;font-size:13px">✨ Build from these</button>` : "";
  const orgBar = list.length > 1 ? `<div class="cap-orgbar">
    <div class="cap-seg">
      <button data-capsort="category" class="${_capSort === "category" ? "on" : ""}">By category</button>
      <button data-capsort="formality" class="${_capSort === "formality" ? "on" : ""}">By formality</button>
    </div>
    ${trip ? `<button class="cap-chip${_capUnpackedOnly ? " on" : ""}" data-cap-unpacked>Unpacked only</button>` : ""}
    ${unwornSet ? `<button class="cap-chip${_capUnwornOnly ? " on" : ""}" data-cap-unworn>Unworn only</button>` : ""}
  </div>` : "";

  return capToolbar(c.name, true) + `
    <div class="cap-hdr">
      <div class="ch-name">${esc(c.name)}</div>
      <div class="ch-sub">${esc(sub.join(" · "))}</div>
    </div>
    <div class="cap-insight">
      <div class="kpi-row">
        <div class="kpi-cell"><div class="kpi-val">${list.length}</div><div class="kpi-lbl">item${list.length === 1 ? "" : "s"}</div></div>
        <div class="kpi-cell"><div class="kpi-val">${list.length ? money(capValue(capsuleId)) : "—"}</div><div class="kpi-lbl">total value</div></div>
      </div>
      ${combos > 1 ? `<div class="cap-cov-lbl" style="margin-top:12px">≈ ${combos} outfit${combos === 1 ? "" : "s"} possible from these pieces</div>` : ""}
      <div class="cap-cov">
        <div class="cap-cov-lbl">Formality covered</div>
        <div class="cap-cov-chips">${covChips}</div>
      </div>
    </div>
    ${(() => {
      // Wash-before-you-pack: how much of this capsule/trip is sitting in the hamper.
      if (!LAUNDRY_READY()) return "";
      const _ls = laundryState();
      const dirty = list.filter(i => itemStatus(i) === "Available" && isDirty(i, _ls));
      return dirty.length ? `<div class="cap-launwarn">🧺 ${dirty.length} piece${dirty.length === 1 ? " is" : "s are"} in the hamper — wash before you pack</div>` : "";
    })()}
    ${packHtml}
    ${wxHtml}
    <button class="cap-plan" data-trip-toggle style="${tripModeId === c.id ? "background:var(--accent-soft);color:var(--accent)" : "background:var(--accent)"};margin-bottom:8px">
      <svg viewBox="0 0 24 24"><path d="M2 16l20-6-3 8-4-1-3 3-2-4z"/><path d="M9 12L4 8l3-1 6 3"/></svg>
      ${tripModeId === c.id ? (isDatedTrip(c) ? "End trip mode" : "Exit capsule mode")
        : (isDatedTrip(c) ? "✈️ Start trip mode" : "Enter capsule mode")}
    </button>
    ${(() => {
      // The pack builder. Reachable the moment a trip has dates — NOT gated
      // behind the 3-day pack phase, because the whole value of an early gap
      // flag is that she can still do something about it.
      if (!isDatedTrip(c)) return "";
      const df = packDiff(capsuleId);
      const label = !df ? "✨ Build the pack"
        : df.changed ? `✨ Rebuild · ${df.reasons.length} thing${df.reasons.length === 1 ? "" : "s"} changed`
        : "The pack";
      return `<button class="cap-plan" data-cap-pack style="background:var(--accent);margin-bottom:8px">
        <svg viewBox="0 0 24 24"><path d="M4 8h16l-1.5 12h-13z"/><path d="M8 8a4 4 0 0 1 8 0"/></svg>
        ${label}
      </button>
      ${df && df.changed ? `<div class="pack-tip" style="margin:-4px 14px 8px">Since ${esc(fmtDate(df.built))}: ${esc(df.reasons.join("; "))}. Anything you've ticked as packed stays.</div>` : ""}`;
    })()}
    ${trip && c.start_date && c.end_date ? `<button class="cap-plan" data-cap-byday>
      <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>
      Plan outfits by day
    </button>` : `<button class="cap-plan" data-cap-byday>
      <svg viewBox="0 0 24 24"><path d="M4 8h16l-1.5 12h-13z"/><path d="M8 8a4 4 0 0 1 8 0"/></svg>
      Planned outfits
    </button>`}
    <button class="cap-plan sec" data-cap-plan style="margin-top:8px">
      <svg viewBox="0 0 24 24"><path d="M12 3l-1.5 3L4 9v11h16V9l-6.5-3z"/><path d="M12 6v14"/></svg>
      Plan outfits from this
    </button>
    ${trip && c.start_date && c.end_date && c.end_date < todayStr() ? `<button class="cap-plan sec" data-cap-recap style="margin-top:8px">
      <svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 15l4-6 3 3 5-8"/></svg>
      Trip recap
    </button>` : ""}
    <button class="cap-plan" data-cap-suggest style="background:var(--accent);margin-top:8px">
      <svg viewBox="0 0 24 24"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
      Suggest an outfit
    </button>
    <textarea class="inp" id="capDetNotes" rows="2" style="margin:16px 14px 0;width:calc(100% - 28px)" placeholder="Notes…">${esc(c.notes || "")}</textarea>
    <div class="cap-secrow"><div class="t">Items</div><button class="a" data-cap-add>＋ Add items</button></div>
    ${orgBar}
    ${unwornBuild}
    ${grid}
    ${renderCapsuleLooksSection(capsuleId)}
    <div class="cap-footer">
      <div class="cap-actions">
        <button class="cap-act2" data-cap-rename>Rename</button>
        ${trip ? `<button class="cap-act2" data-cap-dates>Dates</button>` : ""}
        <button class="cap-act2" data-cap-dup>Duplicate</button>
        <button class="cap-act2" data-cap-share>Share list</button>
        <button class="cap-act2" data-cap-arch>${isCapsuleArchived(capsuleId) ? "Unarchive" : "Archive"}</button>
      </div>
      <button class="cap-del" data-cap-del>Delete capsule</button>
    </div>`;
}

function renderCapsuleLooksSection(cid) {
  const looks = activeOutfits().filter(o => outfitFullyInCapsule(o, cid))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  const tilesHtml = looks.length
    ? `<div class="ogrid" style="padding:0 14px 4px">${looks.map(o =>
        `<button class="otile" data-cap-look="${esc(o.id)}">${outfitCollageHtml(o, 4)}${o.rating === 1 ? `<div class="otile-heart"><svg viewBox="0 0 24 24">${HEART_SVG}</svg></div>` : ""}<div class="oname">${esc(outfitName(o))}</div></button>`
      ).join("")}</div>`
    : `<div class="placeholder" style="padding:16px 16px 8px;font-size:13px;color:var(--muted)">No saved looks use only these pieces yet — add a look to bring its pieces in.</div>`;
  return `<div class="cap-secrow"><div class="t">Looks</div><button class="a" data-cap-look-add>＋ Add looks</button></div>${tilesHtml}`;
}

function openCapsuleLookPicker() {
  const cid = capsuleId;
  const looks = activeOutfits()
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  const grid = looks.length
    ? `<div class="ogrid">${looks.map(o => {
        const inCap = outfitFullyInCapsule(o, cid);
        return `<button class="otile${inCap ? " selected" : ""}" data-lkpick="${esc(o.id)}">${outfitCollageHtml(o, 4)}${o.rating === 1 ? `<div class="otile-heart"><svg viewBox="0 0 24 24">${HEART_SVG}</svg></div>` : ""}<div class="oname">${esc(outfitName(o))}</div>${inCap ? `<div style="font-size:11px;color:var(--accent);margin-top:2px">In capsule</div>` : ""}</button>`;
      }).join("")}</div>`
    : `<div style="padding:24px 16px;text-align:center;color:var(--muted)">No saved looks yet.</div>`;
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="lkPickCancel">Cancel</button>
      <h2>Add a Look</h2>
      <span style="width:54px"></span>
    </div>
    <div style="padding:6px 16px 0;font-size:13px;color:var(--muted)">Tap a look to add its pieces to this capsule.</div>
    <div style="padding:6px 0 30px">${grid}</div>`;
  showSheet("logSheet");
  hydratePhotos($("#logInner"));
  $("#lkPickCancel").onclick = () => { hideSheet("logSheet"); };
  $("#logInner").querySelectorAll("[data-lkpick]").forEach(b => {
    b.onclick = async () => {
      const o = outfitById.get(b.dataset.lkpick);
      if (!o) return;
      if (outfitFullyInCapsule(o, cid)) { toast("Already in capsule"); return; }
      const itemIds = outfitItems(o).map(i => i.id);
      if (!itemIds.length) return;
      try {
        await addItemsToCapsule(cid, itemIds);
        hideSheet("logSheet");
        renderCapsules();
        toast("Look's pieces added to capsule");
      } catch (err) { toast(err.message); }
    };
  });
}

/* ===================================================================
   TRIP PER-DAY PLANNER
   capsules.plan = { "<date>": ["<outfitId>", ...] }. Plans are intentions kept
   separate from wears (past-only). "Wore it" converts a planned day to a real
   wear. Needs migration/capsule_plan.sql.
   =================================================================== */
let _planWx = {};  // date → {maxT,minT,code,hist,locName} for the open trip
let _planWxLoadedFor = null;  // capsuleId whose weather is already in _planWx (avoids reload loop)

function tripPlan(c) { return (c && c.plan && typeof c.plan === "object") ? c.plan : {}; }
// Reserved plan key: the trip/capsule "outfit bucket" — planned looks not tied
// to a day yet. Rides the same plan JSONB + add/remove pipeline as real dates.
const PLAN_BUCKET = "bucket";
// Reserved SENTINEL inside a day's look array: this trip day is a laundry day
// (hotel wash etc.) — the rewear budget resets there. Invisible to look rendering
// because planActiveLooks drops any id outfitById doesn't know.
const PLAN_LAUNDRY = "__laundry__";
function planLooksForDate(c, date) {
  const v = tripPlan(c)[date];
  return Array.isArray(v) ? v : (v ? [v] : []);
}
function planLaundryDay(c, date) { return planLooksForDate(c, date).includes(PLAN_LAUNDRY); }
async function togglePlanLaundry(cid, date) {
  const c = capsuleById.get(cid); if (!c) return;
  const plan = JSON.parse(JSON.stringify(tripPlan(c)));
  let arr = Array.isArray(plan[date]) ? plan[date] : (plan[date] ? [plan[date]] : []);
  if (arr.includes(PLAN_LAUNDRY)) arr = arr.filter(x => x !== PLAN_LAUNDRY); else arr.push(PLAN_LAUNDRY);
  if (arr.length) plan[date] = arr; else delete plan[date];
  await setCapsulePlan(c, plan);
  if (capsuleView === "plan") renderCapsules();
}
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][Math.min(n % 10, 4)] || "th");
// Rewear budget: walk the trip days in order, counting each piece's planned
// wear-days since the trip start (or the last laundry day). A day flags the
// pieces it pushes PAST their wears-per-wash tolerance. Informational only —
// nothing blocks; on trips rewearing is often the plan.
function planRewearFlags(c, dates) {
  const counts = new Map();
  const flags = new Map();  // date → [{name, nth}]
  for (const date of dates) {
    if (planLaundryDay(c, date)) counts.clear();  // washed; today's outfits count fresh
    const dayItems = new Set();
    for (const oid of planActiveLooks(c, date)) {
      const o = outfitById.get(oid);
      if (o) for (const it of outfitItems(o)) dayItems.add(it);
    }
    for (const it of dayItems) {
      const tol = wearTolerance(it);
      if (tol === Infinity) continue;
      if (it.last_washed && date <= it.last_washed) continue;
      const n = (counts.get(it.id) || 0) + 1;
      counts.set(it.id, n);
      if (n > tol) {
        let a = flags.get(date); if (!a) flags.set(date, a = []);
        a.push({ name: it.name || "Untitled", nth: n });
      }
    }
  }
  return flags;
}
// Same, but drops deleted/archived looks (archived lives only in Archive + calendar).
function planActiveLooks(c, date) {
  return planLooksForDate(c, date).filter(oid => {
    const o = outfitById.get(oid);
    return o && !effectiveArchived(o);
  });
}
// Season/weather anchor for a plan context — the bucket has no date of its own,
// so fall back to the trip start (or today for undated capsules).
function planCtxSeasonDate(planCtx) {
  if (planCtx.date !== PLAN_BUCKET) return planCtx.date;
  const c = capsuleById.get(planCtx.capsuleId);
  return (c && c.start_date) || todayStr();
}
function tripDates(c) {
  const out = [];
  if (!c.start_date || !c.end_date) return out;
  let d = new Date(c.start_date + "T00:00:00"), e = new Date(c.end_date + "T00:00:00");
  while (d <= e) { out.push(localISO(d)); d.setDate(d.getDate() + 1); }
  return out;
}
function planDayLabel(date) {
  if (date === PLAN_BUCKET) return "Outfit bucket";
  const o = new Date(date + "T00:00:00");
  return o.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
// A wear already logged for this look on this date → the day was actually worn.
function planWorn(date, outfitId) {
  return wears.some(w => w.worn_on === date && w.outfit_id === outfitId);
}

async function setCapsulePlan(c, plan) {
  c.plan = plan;  // optimistic
  try {
    await rest(`/capsules?id=eq.${c.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ plan }),
    });
  } catch (e) { toast(e.message); }
}
async function addPlanLook(cid, date, outfitId) {
  const c = capsuleById.get(cid); if (!c) return;
  const plan = JSON.parse(JSON.stringify(tripPlan(c)));
  const arr = Array.isArray(plan[date]) ? plan[date] : (plan[date] ? [plan[date]] : []);
  if (!arr.includes(outfitId)) arr.push(outfitId);
  plan[date] = arr;
  await setCapsulePlan(c, plan);
  if (capsuleView === "plan") renderCapsules();
}
async function removePlanLook(cid, date, outfitId) {
  const c = capsuleById.get(cid); if (!c) return;
  const plan = JSON.parse(JSON.stringify(tripPlan(c)));
  let arr = Array.isArray(plan[date]) ? plan[date] : (plan[date] ? [plan[date]] : []);
  arr = arr.filter(x => x !== outfitId);
  if (arr.length) plan[date] = arr; else delete plan[date];
  await setCapsulePlan(c, plan);
  if (capsuleView === "plan") renderCapsules();
}

// Record that a planned look was actually worn that day → a real wear row.
async function planWoreIt(date, outfitId) {
  const o = outfitById.get(outfitId);
  if (!o) return;
  const its = outfitItems(o);
  if (!its.length) { toast("This look has no pieces"); return; }
  try {
    const fml = deriveWearFormality(its.map(it => it.id));
    const wctx = tripWearContext(date);  // trip mode: auto-stamp "Travel"
    const payload = its.map(it => ({ item_id: it.id, worn_on: date, outfit_id: outfitId, formality_for: fml, ...(wctx ? { context: wctx } : {}) }));
    const rows = await rest("/wears", {
      method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    if (Array.isArray(rows)) wears.push(...rows); else payload.forEach(p => wears.push(p));
    buildOutfitWearMap();
    toast("Logged as worn");
    if (capsuleView === "plan") renderCapsules();
  } catch (e) { toast(e.message); }
}

async function loadPlanWeather(c) {
  const cached = _wxCache[c.id];
  let days;
  if (cached && Date.now() - cached.ts < WX_TTL) days = cached.days;
  else { try { days = await buildTripWeather(c); _wxCache[c.id] = { days, ts: Date.now() }; } catch (e) { days = []; } }
  _planWx = {};
  (days || []).forEach(d => { _planWx[d.date] = d; });
  _planWxLoadedFor = c.id;
  if (capsuleView === "plan") renderCapsules();
}

function openTripPlan(id) {
  capsuleId = id;
  capsuleView = "plan";
  _planWx = {};
  _planWxLoadedFor = null;
  renderCapsules();
}

function planDayWxHtml(date) {
  const w = _planWx[date];
  if (!w || w.maxT == null) return "";
  return `<span class="plan-wx"><span class="e">${wmoEmoji(w.code)}</span>${w.maxT}° / ${w.minT}°${w.hist ? " <span style='opacity:.7'>avg</span>" : ""}</span>`;
}

function renderCapsulePlan() {
  const c = capsuleById.get(capsuleId);
  const dates = tripDates(c);
  const memberCount = capsuleItems(capsuleId).length;
  const bucketIds = planActiveLooks(c, PLAN_BUCKET);

  // Bucket looks already assigned to some day get a "✓ planned" mark (they stay
  // in the bucket — one outfit can cover several days).
  const plannedSomewhere = new Set(dates.flatMap(d => planLooksForDate(c, d)));
  const bucketTiles = bucketIds.map(oid => {
    const o = outfitById.get(oid);
    return `<div class="plan-look">
      <div data-plan-open="${esc(oid)}">${outfitCollageHtml(o, 4)}</div>
      <button class="plan-look-x" data-plan-remove="${esc(oid)}" data-plan-date="${PLAN_BUCKET}" aria-label="Remove">×</button>
      <div class="plan-look-name">${plannedSomewhere.has(oid) ? `<span class="plan-worn">✓ planned</span>` : esc(outfitName(o))}</div>
    </div>`;
  }).join("");
  const bucketCard = `<div class="plan-day">
    <div class="plan-day-hd">
      <div class="plan-day-date">Outfit bucket<small>${bucketIds.length ? `${bucketIds.length} outfit${bucketIds.length === 1 ? "" : "s"} ready to assign` : "plan outfits here, then pull them onto days"}</small></div>
    </div>
    ${bucketIds.length ? `<div class="plan-looks">${bucketTiles}</div>` : ""}
    <div class="plan-add-row">
      <button class="plan-act" data-plan-assign="${PLAN_BUCKET}">＋ Look</button>
      <button class="plan-act" data-plan-suggest="${PLAN_BUCKET}">✨ Suggest</button>
      <button class="plan-act" data-plan-build="${PLAN_BUCKET}">✎ Build</button>
    </div>
  </div>`;

  const rewearFlags = planRewearFlags(c, dates);
  /* The pack's own outfits, shown here without ever having been "sent" (r5).
     Derived from the pack record — no look records, no capsules.plan writes.
     See the "THE PACK IS THE PLAN" header in js/21-pack.js. */
  const packByDate = (typeof packPlanByDate === "function") ? packPlanByDate(c) : null;
  const dayCards = dates.map(date => {
    const looks = planActiveLooks(c, date);
    const packCards = packByDate && packByDate.get(date)
      ? packPlanCardsHtml(packByDate.get(date), date) : "";
    const isLaun = planLaundryDay(c, date);
    const rw = rewearFlags.get(date);
    const looksHtml = looks.map(oid => {
      const o = outfitById.get(oid);
      const worn = planWorn(date, oid);
      return `<div class="plan-look">
        <div data-plan-open="${esc(oid)}">${outfitCollageHtml(o, 4)}</div>
        <button class="plan-look-x" data-plan-remove="${esc(oid)}" data-plan-date="${esc(date)}" aria-label="Remove">×</button>
        <div class="plan-look-name">${worn ? `<span class="plan-worn">✓ worn</span>` : esc(outfitName(o))}</div>
        ${worn ? "" : `<button class="plan-act" style="margin-top:4px;padding:5px 9px;font-size:11px" data-plan-wore="${esc(oid)}" data-plan-date="${esc(date)}">Wore it</button>`}
      </div>`;
    }).join("");
    return `<div class="plan-day">
      <div class="plan-day-hd">
        <div class="plan-day-date">${esc(planDayLabel(date))}<small>${esc(date)}</small></div>
        ${planDayWxHtml(date)}
      </div>
      ${isLaun ? `<div class="plan-launday">🧺 Laundry day — rewear counts reset</div>` : ""}
      ${rw ? `<div class="plan-rewarn">${rw.map(f => `⚠︎ ${esc(f.name)} — ${ordinal(f.nth)} wear since laundry`).join("<br>")}</div>` : ""}
      ${looks.length ? `<div class="plan-looks">${looksHtml}</div>` : ""}
      ${packCards}
      <div class="plan-add-row">
        ${bucketIds.length ? `<button class="plan-act" data-plan-frombucket="${esc(date)}">🪣 From bucket</button>` : ""}
        <button class="plan-act" data-plan-assign="${esc(date)}">＋ Look</button>
        <button class="plan-act" data-plan-suggest="${esc(date)}">✨ Suggest</button>
        <button class="plan-act" data-plan-build="${esc(date)}">✎ Build</button>
        <button class="plan-act" data-plan-laundry="${esc(date)}"${isLaun ? ` style="color:var(--accent);border-color:var(--accent)"` : ""}>🧺 Did laundry${isLaun ? " ✓" : ""}</button>
      </div>
    </div>`;
  }).join("");

  const kind = capModeLabel(c).toLowerCase();
  return capToolbar(c.name + (dates.length ? " · By day" : " · Planned outfits"), true) + `
    <div class="cap-hdr">
      <div class="ch-name">${dates.length ? "Plan by day" : "Planned outfits"}</div>
      <div class="ch-sub">${dates.length ? `${dates.length} day${dates.length === 1 ? "" : "s"} · ` : ""}${memberCount} piece${memberCount === 1 ? "" : "s"} in this ${esc(kind)}</div>
    </div>
    ${memberCount ? "" : `<div class="placeholder" style="padding:24px 32px"><b>No pieces yet</b><div>Add items to the ${esc(kind)} first — planning is scoped to its pieces.</div></div>`}
    ${bucketCard}
    ${dayCards}
    <div style="height:30px"></div>`;
}

// "🪣 From bucket": assign a bucket look to a specific day (the look stays in
// the bucket; assigning again on another day is fine).
function openBucketAssignSheet(date) {
  const c = capsuleById.get(capsuleId);
  const bucketIds = planActiveLooks(c, PLAN_BUCKET);
  const onDay = new Set(planLooksForDate(c, date));
  const grid = bucketIds.length
    ? `<div class="ogrid">${bucketIds.map(oid => {
        const o = outfitById.get(oid);
        const used = onDay.has(oid);
        return `<button class="otile${used ? " selected" : ""}" data-bktpick="${esc(oid)}">${outfitCollageHtml(o, 4)}${o.rating === 1 ? `<div class="otile-heart"><svg viewBox="0 0 24 24">${HEART_SVG}</svg></div>` : ""}<div class="oname">${esc(outfitName(o))}</div>${used ? `<div style="font-size:11px;color:var(--accent);margin-top:2px">On this day</div>` : ""}</button>`;
      }).join("")}</div>`
    : `<div style="padding:24px 16px;text-align:center;color:var(--muted)">The bucket is empty.</div>`;
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="bktPickCancel">Cancel</button>
      <h2>Bucket → ${esc(planDayLabel(date))}</h2>
      <span style="width:54px"></span>
    </div>
    <div style="padding:6px 0 30px">${grid}</div>`;
  showSheet("logSheet");
  hydratePhotos($("#logInner"));
  $("#bktPickCancel").onclick = () => { hideSheet("logSheet"); };
  $("#logInner").querySelectorAll("[data-bktpick]").forEach(b => {
    b.onclick = () => {
      const oid = b.dataset.bktpick;
      if (onDay.has(oid)) { toast("Already planned for this day"); return; }
      hideSheet("logSheet");
      addPlanLook(capsuleId, date, oid);
    };
  });
}

// Assign a saved look to a trip day — scoped to looks built entirely from the
// trip's pieces (falls back to a hint when none qualify).
let _planPickQ = ""; // P3: keyword search in the plan look picker
function planPickGridHtml() {
  const q = _planPickQ.trim().toLowerCase();
  // L5: liked looks first, then most-recently-created.
  let looks = activeOutfits().filter(o => outfitFullyInCapsule(o, capsuleId))
    .sort((a, b) => (b.rating === 1 ? 1 : 0) - (a.rating === 1 ? 1 : 0) || String(b.created_at || "").localeCompare(String(a.created_at || "")));
  if (q) looks = looks.filter(o => outfitName(o).toLowerCase().includes(q));
  return looks.length
    ? `<div class="ogrid">${looks.map(o => `<button class="otile" data-planpick="${esc(o.id)}">${outfitCollageHtml(o, 4)}${o.rating === 1 ? `<div class="otile-heart"><svg viewBox="0 0 24 24">${HEART_SVG}</svg></div>` : ""}<div class="oname">${esc(outfitName(o))}</div></button>`).join("")}</div>`
    : `<div class="cal-day-empty" style="padding:24px 16px;text-align:center;color:var(--muted)">${q ? "No looks match that search." : "No saved looks use only this trip's pieces yet.<br>Use ✨ Suggest or ✎ Build to make one."}</div>`;
}
function openPlanLookPicker(date) {
  _planPickQ = "";
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="planPickCancel">Cancel</button>
      <h2>${date === PLAN_BUCKET ? "Add to bucket" : `Look for ${esc(planDayLabel(date))}`}</h2>
      <span style="width:54px"></span>
    </div>
    <div style="padding:6px 16px 8px"><input class="inp" id="planPickSearch" placeholder="Search looks…" value=""></div>
    <div id="planPickResults" style="padding:6px 0 30px">${planPickGridHtml()}</div>`;
  showSheet("logSheet");
  hydratePhotos($("#logInner"));
  $("#planPickCancel").onclick = () => { hideSheet("logSheet"); };
  const s = $("#planPickSearch");
  if (s) s.oninput = () => {
    _planPickQ = s.value;
    const wrap = $("#planPickResults");
    if (wrap) { wrap.innerHTML = planPickGridHtml(); hydratePhotos($("#logInner")); wirePlanPickTaps(date); }
  };
  wirePlanPickTaps(date);
}
function wirePlanPickTaps(date) {
  $("#logInner").querySelectorAll("[data-planpick]").forEach(b => {
    b.onclick = () => { hideSheet("logSheet"); addPlanLook(capsuleId, date, b.dataset.planpick); };
  });
}

// Persist a suggester/builder combo as a real look so it can be referenced by a plan.
async function saveComboAsOutfit(pieces) {
  const itemIds = pieces.map(p => p.id);
  const dup = findDuplicateOutfit(itemIds, null);
  if (dup) return dup.id;
  const layout = suggestionLayout(pieces);
  const rows = await rest("/outfits?select=*", {
    method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ name: null, layout }),
  });
  const o = Array.isArray(rows) ? rows[0] : rows;
  if (!o || !o.id) throw new Error("Could not save look");
  o.layout = layout; outfits.push(o);
  const links = itemIds.map(item_id => ({ outfit_id: o.id, item_id }));
  await rest("/outfit_items", {
    method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(links),
  });
  outfitLinks = outfitLinks.concat(links);
  buildOutfitIndexes();
  return o.id;
}

// ---- build a plain-text checklist of a capsule (grouped by category) ----
function capsuleListText(id) {
  const c = capsuleById.get(id);
  if (!c) return "";
  const trip = isTrip(c);
  const packedSet = new Set((capsuleLinkMap.get(id) || []).filter(l => l.packed).map(l => l.item_id));
  const lines = [c.name];
  const dates = capDateLabel(c);
  if (dates) lines.push(dates);
  lines.push("");
  const groups = groupByCategory(capsuleItems(id));
  if (!groups.length) lines.push("(no items yet)");
  for (const g of groups) {
    lines.push(`${g.key.toUpperCase()} (${g.items.length})`);
    for (const i of g.items) {
      const box = trip ? (packedSet.has(i.id) ? "[x] " : "[ ] ") : "• ";
      lines.push(`${box}${i.name || "Untitled"}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

async function shareCapsuleList(id) {
  const c = capsuleById.get(id);
  if (!c) return;
  const text = capsuleListText(id);
  try {
    if (navigator.share) { await navigator.share({ title: c.name, text }); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }  // user dismissed the share sheet
  try {
    await navigator.clipboard.writeText(text);
    toast("List copied to clipboard");
  } catch (_) {
    // last-resort fallback for browsers without the async clipboard API
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("List copied to clipboard"); }
    catch { toast("Couldn't copy the list"); }
    ta.remove();
  }
}

// ---- rename a capsule (reuses #logSheet) ----
function renameCapsule(id) {
  const c = capsuleById.get(id);
  if (!c) return;
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="renCancel">Cancel</button>
      <h2>Rename</h2>
      <button class="lnk" id="renSave" style="font-weight:700">Save</button>
    </div>
    <div style="padding:18px 18px 30px">
      <input class="inp" id="renName" value="${esc(c.name)}" placeholder="Capsule name" style="width:100%;font-size:16px">
    </div>`;
  showSheet("logSheet");
  $("#renCancel").onclick = () => { hideSheet("logSheet"); };
  $("#renSave").onclick = async () => {
    const name = $("#renName").value.trim();
    if (!name) { toast("Give it a name"); return; }
    hideSheet("logSheet");
    const prev = c.name;
    c.name = name;  // optimistic
    try {
      await rest(`/capsules?id=eq.${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ name }),
      });
      renderCapsules();
      toast("Renamed");
    } catch (e) { c.name = prev; toast(e.message); }
  };
}

/* ---- edit a dated trip's dates (reuses #logSheet) ----------------------
   Her ask: "I need to be able to change vacation dates — e.g. I accidentally
   made this trip one day too long." There was no way to. `_capForm` only exists
   during CREATE, and the detail page offered Rename but nothing for the dates,
   so a trip typed wrong stayed wrong forever — while its dates drive trip phase,
   the by-day planner, the pack solver, awayRanges() and the recap.

   ⚠️ THE OLD RANGE'S WEATHER CORRECTION MUST BE UNDONE (the r19 rule). An away
   day gets its host city's temperatures written over the home reading; shorten
   the trip and that day is one she was actually home, still carrying Spain's
   weather — a correction outliving the answer that justified it, which poisons
   season bands and every derivation downstream. revertAwayWeather re-applies any
   surviving overlapping range itself, so revert-then-correct is safe and is the
   same order removeWhereEntry already uses. */
function editCapsuleDates(id) {
  const c = capsuleById.get(id);
  if (!c) return;
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="cdCancel">Cancel</button>
      <h2>Trip dates</h2>
      <button class="lnk" id="cdSave" style="font-weight:700">Save</button>
    </div>
    <div style="padding:18px 18px 30px">
      <div class="cap-dates">
        <div><label class="fld">Start</label><input class="inp" type="date" id="cdStart" value="${esc(c.start_date || "")}"></div>
        <div><label class="fld">End</label><input class="inp" type="date" id="cdEnd" value="${esc(c.end_date || "")}"></div>
      </div>
      <div class="pack-warn-note" style="padding:12px 0 0">Nothing you've already logged moves — wears keep their own dates. Days outside the new range simply stop counting as trip days.</div>
    </div>`;
  showSheet("logSheet");
  $("#cdCancel").onclick = () => { hideSheet("logSheet"); };
  $("#cdSave").onclick = async () => {
    const s = $("#cdStart").value || null;
    const e = $("#cdEnd").value || null;
    if (s && e && e < s) { toast("The end date is before the start"); return; }
    if (s === (c.start_date || null) && e === (c.end_date || null)) { hideSheet("logSheet"); return; }
    hideSheet("logSheet");
    const prevS = c.start_date || null, prevE = c.end_date || null;
    // The ranges the OLD dates justified, before we overwrite them. Pass [] for
    // the log so this is the trip's own contribution and never the wherelog's.
    const oldRanges = (prevS && prevE && typeof awayRanges === "function")
      ? awayRanges([], [{ ...c, start_date: prevS, end_date: prevE }]) : [];
    c.start_date = s; c.end_date = e;   // optimistic
    try {
      await rest(`/capsules?id=eq.${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ start_date: s, end_date: e }),
      });
      _planWxLoadedFor = null;          // the weather strip is keyed on the old span
      for (const r of oldRanges) { try { await revertAwayWeather(r); } catch (_) {} }
      if (s && e && typeof correctAwayWeather === "function") {
        for (const r of awayRanges([], [c])) correctAwayWeather(r);  // fire-and-forget
      }
      // Away days no longer count toward the rack's cadence — see rackShouldRotate.
      if (typeof rackEnsure === "function") rackEnsure();
      renderCapsules();
      toast("Dates updated");
    } catch (err) {
      c.start_date = prevS; c.end_date = prevE;
      toast(err.message);
    }
  };
}

// ---- duplicate a capsule (shell + its items; packing resets) ----
async function duplicateCapsule(id) {
  const c = capsuleById.get(id);
  if (!c) return;
  const itemIds = (capsuleLinkMap.get(id) || []).map(l => l.item_id);
  try {
    const payload = { name: `${c.name} (copy)`, kind: c.kind, notes: c.notes || null };
    if (c.start_date) payload.start_date = c.start_date;
    if (c.end_date)   payload.end_date   = c.end_date;
    if (c.locations)  payload.locations  = c.locations;  // column exists since r9
    const rows = await rest("/capsules?select=*", {
      method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    const nc = Array.isArray(rows) ? rows[0] : rows;
    if (!nc || !nc.id) throw new Error("Could not duplicate");
    capsules.unshift(nc);
    buildCapsuleIndexes();
    if (itemIds.length) await addItemsToCapsule(nc.id, itemIds);
    capsuleId = nc.id;
    capsuleView = "detail";
    renderCapsules();
    toast("Capsule duplicated");
  } catch (e) { toast(e.message); }
}

function planFromCapsule(id) {
  activeCapsuleId = id;
  closetCat = null; closetSub = null; searchResults = null; closetSearchQ = null;
  switchTab("closet");
  const c = capsuleById.get(id);
  toast(c ? `Planning from ${c.name}` : "Capsule active");
}

async function deleteCapsule(id) {
  const c = capsuleById.get(id);
  if (!confirm(`Delete "${c ? c.name : "this capsule"}"? Your items are not affected.`)) return;
  try {
    await rest(`/capsules?id=eq.${id}`, { method: "DELETE" });
    capsules = capsules.filter(x => x.id !== id);
    capsuleLinks = capsuleLinks.filter(l => l.capsule_id !== id);
    if (activeCapsuleId === id) activeCapsuleId = null;
    buildCapsuleIndexes();
    capsuleView = "list"; capsuleId = null;
    renderCapsules();
    toast("Capsule deleted");
  } catch (e) { toast(e.message); }
}

function saveCapsuleNotes(id, value) {
  clearTimeout(_capNotesTimer);
  _capNotesTimer = setTimeout(async () => {
    try {
      await rest(`/capsules?id=eq.${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: value || null }) });
      const c = capsuleById.get(id); if (c) c.notes = value;
    } catch (e) { /* silent */ }
  }, 900);
}

// ---- packing tick ----
async function togglePack(itemId) {
  const links = capsuleLinkMap.get(capsuleId) || [];
  const link = links.find(l => l.item_id === itemId);
  if (!link) return;
  const next = !link.packed;
  link.packed = next; // optimistic
  // surgical tile update + progress refresh
  const tile = $(`[data-cap-item="${itemId}"]`);
  if (tile) tile.classList.toggle("packed", next);
  refreshPackProgress();
  if (_capUnpackedOnly && next && tile) {
    tile.remove();
    $$(".cap-grp").forEach(g => { if (!g.querySelector(".gtile")) g.remove(); });
    if (!$(".cap-grp")) renderCapsules();
  }
  refreshPackGroupCounts();
  try {
    await rest(`/capsule_items?capsule_id=eq.${capsuleId}&item_id=eq.${itemId}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packed: next }) });
  } catch (e) { link.packed = !next; toast(e.message); renderCapsules(); }
}
function refreshPackProgress() {
  const fill = $(".cap-pack-fill"), lbl = $(".cap-pack-lbl");
  if (!fill) return;
  const links = capsuleLinkMap.get(capsuleId) || [];
  const total = capsuleItems(capsuleId).length;
  const packed = links.filter(l => l.packed && itemById.has(l.item_id)).length;
  fill.style.width = (total ? Math.round((packed / total) * 100) : 0) + "%";
  if (lbl) lbl.textContent = `${packed} of ${total} packed · tap the circle on a piece to check it off`;
}
// recompute each category/formality group's "N/M packed" header from the DOM tiles
function refreshPackGroupCounts() {
  $$(".cap-grp").forEach(grp => {
    const cnt = grp.querySelector("[data-grp-cnt]");
    if (!cnt) return;
    const total = grp.querySelectorAll(".gtile").length;
    const packed = grp.querySelectorAll(".gtile.packed").length;
    cnt.textContent = `${packed}/${total} packed`;
    cnt.classList.toggle("done", packed === total);
  });
}

// ---- add-items picker (membership editor) ----
/* ⚠️ ONE PICKER, NOT A SECOND ONE (2026-08-09, her report: "Add pieces you're
   bringing opens a bizarre screen. It should be the same item selector as
   everywhere else in the app"). The pack briefly grew its own search-box-and-
   grid, which had none of the things this screen has earned — the funnel, the
   laundry lens, the status lens, category drill-down, the suggested strip. A
   second picker is a second place to fix every future picker bug.
   `mode: "definites"` reuses all of it and only changes what Save writes. */
let _capPickMode = "capsule";     // "capsule" | "definites"
let _capPickBack = null;          // where Save/back returns, when not the detail page
function openCapsulePicker(id, { mode = "capsule", back = null } = {}) {
  capsuleId = id;
  _capPickMode = mode;
  _capPickBack = back;
  _capPick = mode === "definites"
    ? new Set(packRecord(id).pinned || [])
    : new Set((capsuleLinkMap.get(id) || []).map(l => l.item_id));
  _capPickFilter = "";
  _capPickCat = null;
  _capPickSub = null;
  _capPickStatus = "Available";
  _pickTripScope = false;  // adding items TO a capsule needs the whole closet
  pickerFilter = newFilterState();
  capsuleView = "pick";
  renderCapsules();
}

// status + keyword filtered (before category chip filter)
function pickerPoolBase() {
  let pool = _capPickStatus === "All"
    ? items.filter(i => itemStatus(i) !== "Archive")
    : items.filter(i => itemStatus(i) === _capPickStatus);
  // Trip mode (calendar log picker only): default to the suitcase, with the
  // "Suitcase only" chip as the whole-closet escape hatch.
  if (_pickTripScope && tripModeId) {
    const set = new Set((capsuleLinkMap.get(tripModeId) || []).map(l => l.item_id));
    pool = pool.filter(i => set.has(i.id));
  }
  // Shares the closet's matcher (Round C) so one box behaves the same
  // everywhere — multi-term AND, and colour/retailer/size/notes/tags too.
  const q = _capPickFilter.trim();
  if (q) pool = pool.filter(i => itemMatchesText(i, q));
  if (hasActiveFilter(pickerFilter)) pool = pool.filter(i => itemMatchesFilter(i, pickerFilter, { noStatusDefault: true }));
  return pool;
}
function pickerPool() {
  let pool = pickerPoolBase();
  if (_capPickCat) pool = pool.filter(i => (i.category || "Other") === _capPickCat);
  if (_capPickSub) pool = pool.filter(i => (i.subcategory || "") === _capPickSub);
  return sortItems(pool);
}

// subcategory chips (shown when a category is selected)
function pickerSubBar() {
  if (!_capPickCat) return "";
  const subs = TAXONOMY[_capPickCat] || [];
  if (!subs.length) return "";
  const catPool = pickerPoolBase().filter(i => (i.category || "Other") === _capPickCat);
  const counts = new Map();
  for (const i of catPool) { const s = i.subcategory || ""; if (s) counts.set(s, (counts.get(s) || 0) + 1); }
  const chip = (key, lbl, on) => `<button class="cap-chip${on ? " on" : ""}" data-picksub="${esc(key)}">${esc(lbl)}${counts.has(key) ? " " + counts.get(key) : ""}</button>`;
  const visibleSubs = subs.filter(s => counts.has(s));
  if (!visibleSubs.length) return "";
  return `<div class="cap-catbar" style="padding-top:0">${chip("", "All", !_capPickSub)}${visibleSubs.map(s => chip(s, s, _capPickSub === s)).join("")}</div>`;
}

// horizontal category jump-chips with counts (built from the keyword-filtered pool)
function pickerCatBar() {
  const base = pickerPoolBase();
  const counts = new Map();
  for (const i of base) { const c = i.category || "Other"; counts.set(c, (counts.get(c) || 0) + 1); }
  const cats = [...counts.keys()].sort((a, b) => { const r = catRank(a) - catRank(b); return r !== 0 ? r : a.localeCompare(b); });
  const chip = (key, lbl, n, on) => `<button class="cap-chip${on ? " on" : ""}" data-pickcat="${esc(key)}">${esc(lbl)} ${n}</button>`;
  return `<div class="cap-catbar">${chip("__all__", "All", base.length, !_capPickCat)}${cats.map(c => chip(c, c, counts.get(c), _capPickCat === c)).join("")}</div>`;
}

// category-grouped selectable grid for the picker
function pickerGridHtml(pool) {
  return itemGridView(pool, {
    group: "category",
    select: true,
    selSet: _capPick,
    onTap: "pick",
    emptyMsg: "No matches",
  });
}

// "★ Suggested" strip at the top of the capsule picker: in-season workhorses
// (high wear index vs similar items) not yet picked. Hidden while searching or
// drilled into a category. Trip capsules use the trip's start-date season.
/* For a DATED capsule this becomes travel-aware (2026-07-29): pieces that have
   gone on ${TRIP_MEMORY_MIN}+ trips and been worn on every one lead the strip,
   because the highest-leverage moment for what past trips taught is the moment
   the packing list is being built. Proven travellers are prepended, not
   substituted — a first trip has no record and must still get the workhorses. */
function capsulePickSuggestHtml() {
  if (_capPickFilter.trim() || _capPickCat) return "";
  const c = capsuleById.get(capsuleId);
  const season = (c && c.start_date) ? seasonOf(c.start_date) : currentSeason();
  const per = buildItemPerf(items);
  const eligible = (i) => itemStatus(i) === "Available" && inSeason(i, season);
  let proven = [];
  if (isDatedTrip(c)) {
    // Exclude this trip itself — it isn't finished, and its own membership
    // shouldn't recommend the pieces already in it.
    proven = travelProven(buildTravelStats(capsules.filter(x => x.id !== c.id)))
      .map(e => e.item).filter(i => itemById.has(i.id) && eligible(itemById.get(i.id)))
      .map(i => itemById.get(i.id)).slice(0, 6);
  }
  const provenIds = new Set(proven.map(i => i.id));
  const work = items.filter(i => {
    if (!eligible(i) || provenIds.has(i.id)) return false;
    const p = per.get(i.id);
    return p && p.count >= 3 && p.idx != null && p.idx >= 1.2;
  }).sort((a, b) => per.get(b.id).idx - per.get(a.id).idx);
  const sugg = proven.concat(work).slice(0, 12);
  if (!sugg.length) return "";
  const tile = (i) => `<button class="gtile cap-sug-tile${_capPick.has(i.id) ? " selected" : ""}" data-pick="${esc(i.id)}">
    <div class="sel-dot${_capPick.has(i.id) ? " on" : ""}"><svg viewBox="0 0 24 24"><path d="M5 12l5 5L19 7"/></svg></div>
    ${thumbHtml(i.image_path, "gphoto")}<div class="gname">${esc(i.name || "Untitled")}</div>
  </button>`;
  const label = proven.length
    ? `★ Suggested · ${proven.length} that always get worn on trips`
    : `★ Suggested · ${season} workhorses`;
  return `<div class="sf-label" style="padding:8px 14px 2px">${esc(label)}</div>
    <div class="cap-sug-strip">${sugg.map(tile).join("")}</div>`;
}

function renderCapsulePicker() {
  const c = capsuleById.get(capsuleId);
  const right = `<div style="display:flex;align-items:center;gap:8px">
    <button class="clsearch" id="capPickDone" style="width:auto;font-size:15px;font-weight:700;color:var(--accent);padding:0 6px">Save</button>
  </div>`;
  const lensBtn = (s, lbl) => `<button class="cap-chip${_capPickStatus === s ? " on" : ""}" data-pick-status="${s}">${lbl}</button>`;
  const title = _capPickMode === "definites"
    ? "Definitely bringing"
    : `Add to ${c ? c.name : "capsule"}`;
  return capToolbar(title, true, right) + `
    <div style="padding:10px 14px 0;display:flex;gap:8px;align-items:center">
      <input class="inp" id="capPickSearch" style="flex:1" placeholder="Search your closet…" value="${esc(_capPickFilter)}">
      ${funnelBtnHtml("capPickFilter", pickerFilter, () => renderCapsules())}
    </div>
    <div id="capPickLens" class="cap-catbar" style="padding-top:6px">${lensBtn("Available","Available")}${lensBtn("Storage","Storage")}${lensBtn("All","All")}</div>
    ${laundryLensHtml("picker", pickerFilter)}
    <div style="padding:4px 14px 2px;font-size:13px;color:var(--muted)" id="capPickCount">${_capPick.size} selected</div>
    <div id="capPickResults">${capsulePickSuggestHtml()}${pickerCatBar()}${pickerSubBar()}${pickerGridHtml(pickerPool())}</div>`;
}

function togglePick(id) {
  if (_capPick.has(id)) _capPick.delete(id); else _capPick.add(id);
  // $$: the item can appear twice (suggested strip + main grid) — update both
  $$(`[data-pick="${id}"]`).forEach(tile => {
    const on = _capPick.has(id);
    tile.classList.toggle("selected", on);
    const dot = tile.querySelector(".sel-dot"); if (dot) dot.classList.toggle("on", on);
  });
  const cnt = $("#capPickCount"); if (cnt) cnt.textContent = `${_capPick.size} selected`;
  const logAsLook = $("#calLogAsLook"); if (logAsLook) logAsLook.hidden = _capPick.size < 2;
}

async function saveCapsulePicker() {
  const cid = capsuleId;
  /* Definites write to the pack record, not to capsule membership — a piece
     you've decided to bring is a constraint on the solve, which is a different
     thing from the trip's item list. */
  if (_capPickMode === "definites") {
    try {
      await savePackRecord(cid, { pinned: [...(_capPick || [])] });
      const back = _capPickBack;
      _capPickMode = "capsule"; _capPickBack = null;
      if (back) { back(); return; }
      capsuleView = "pack"; renderCapsules();
      toast(`${_capPick.size} piece${_capPick.size === 1 ? "" : "s"} you're bringing`);
    } catch (e) { toast(e.message); }
    return;
  }
  const current = new Set((capsuleLinkMap.get(cid) || []).map(l => l.item_id));
  const selected = _capPick;
  const toAdd = [...selected].filter(id => !current.has(id));
  const toRemove = [...current].filter(id => !selected.has(id));
  try {
    if (toAdd.length) await addItemsToCapsule(cid, toAdd, true);
    /* ⚠️ ONE LIST OF WHAT'S COMING (2026-08-09, her ask: "if I change something
       from the bag, it should change the build a pack part too").

       There were TWO and they silently fought. This picker wrote only
       `capsule_items`; the pack's own list is `rec.pieces`; and packSyncMembers
       computes `drop = members − bag − packed`. So a piece added here vanished
       from the trip at the next pack edit — an explicit decision destroyed by a
       background sync, which is the exact failure this whole rework is about.
       The bag is the source of truth now, and every "add to this trip" door
       writes it. */
    if (packRecord(cid).pieces) {
      const bag = new Set(packRecord(cid).pieces || []);
      toAdd.forEach(id => bag.add(id));
      toRemove.forEach(id => bag.delete(id));
      await savePackRecord(cid, { pieces: [...bag] });
      if (_packState && _packState.cid === cid) {
        _packState.pack = [...bag];
        _packState.res = null;            // the outfits are re-derived on next open
        packRegroup(_packState);
      }
    }
    if (toRemove.length) {
      const inList = `(${toRemove.map(id => `"${id}"`).join(",")})`;
      await rest(`/capsule_items?capsule_id=eq.${cid}&item_id=in.${inList}`, { method: "DELETE" });
      capsuleLinks = capsuleLinks.filter(l => !(l.capsule_id === cid && toRemove.includes(l.item_id)));
      buildCapsuleIndexes();
    }
    capsuleView = "detail";
    renderCapsules();
    toast("Items updated");
  } catch (e) { toast(e.message); }
}

// Insert membership rows; `skipBuild` avoids a double rebuild when caller rebuilds.
/* ⚠️ EVERY "add to this trip" DOOR WRITES THE BAG (2026-08-09). There are ten
   callers — the trip picker, the Add-item form, the suggester's level door, the
   "you wore something you didn't pack" offer, duplicate-trip, and more — and
   patching them one at a time is how one gets missed. `capsule_items` and the
   pack's `rec.pieces` were two lists of "what's coming", and packSyncMembers
   computes `drop = members − bag − packed`, so anything added through a door
   that only wrote members was deleted at the next pack edit.
   ⚠️ `syncPack:false` is for packSyncMembers itself, which is the projection —
   without it this recurses. */
async function addItemsToCapsule(cid, itemIds, alreadyHandledRebuild, { syncPack = true } = {}) {
  const fresh = itemIds.filter(id => !(capsuleLinkMap.get(cid) || []).some(l => l.item_id === id));
  if (!fresh.length) return;
  if (syncPack && packRecord(cid).pieces) {
    const bag = new Set(packRecord(cid).pieces || []);
    const before = bag.size;
    fresh.forEach(id => bag.add(id));
    if (bag.size !== before) {
      await savePackRecord(cid, { pieces: [...bag] });
      if (typeof _packState !== "undefined" && _packState && _packState.cid === cid) {
        _packState.pack = [...bag];
        _packState.res = null;          // outfits re-derive on next open
        packRegroup(_packState);
      }
    }
  }
  // `packed` is omitted so this works before the column migration; DB default fills it after.
  const payload = fresh.map(id => ({ capsule_id: cid, item_id: id }));
  const rows = await rest("/capsule_items?select=*", {
    method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(payload),
  });
  capsuleLinks = capsuleLinks.concat(rows && rows.length ? rows : payload);
  buildCapsuleIndexes();
}

// ---- assign a single item to capsules (multi-select toggle sheet, reuses #moveSheet) ----
// currentIds: array of capsule ids the item is in. onSave(newIds[]) is called with the
// chosen set when the user taps Save. Used by item detail and the Add form.
function openCapsuleAssign(currentIds, onSave) {
  const sel = new Set(currentIds);
  const render = () => {
    // Archived capsules stay out of the way here too, unless this item is
    // already in one — hiding that would make its membership uneditable.
    const arch = archivedCapsuleIds();
    const rows = capsules.filter(c => !arch.has(c.id) || sel.has(c.id)).map(c => {
      const on = sel.has(c.id);
      return `<button class="sheet-row" data-cap-tog="${esc(c.id)}">
        <span>${esc(c.name)}</span>
        <span class="rt" style="color:${on ? "var(--accent)" : "var(--muted)"};font-weight:${on ? "700" : "400"}">${on ? "✓ In" : "Add"}</span>
      </button>`;
    }).join("");
    $("#moveInner").innerHTML = `
      <div class="sheet-hdr">
        <button class="lnk" id="capAssignCancel">Cancel</button>
        <h2>Capsules</h2>
        <button class="lnk" id="capAssignSave" style="font-weight:700">Save</button>
      </div>
      ${rows || `<div class="sheet-note">No capsules yet. Create one from the Capsules screen.</div>`}`;
    $("#capAssignCancel").onclick = () => { hideSheet("moveSheet"); };
    $("#capAssignSave").onclick = () => { hideSheet("moveSheet"); onSave([...sel]); };
    $("#moveInner").querySelectorAll("[data-cap-tog]").forEach(b => {
      b.onclick = () => {
        const id = b.dataset.capTog;
        sel.has(id) ? sel.delete(id) : sel.add(id);
        render();
      };
    });
  };
  render();
  showSheet("moveSheet");
}

// Diff an item's capsule membership against a chosen set, writing capsule_items rows.
async function saveItemCapsules(itemId, newIds) {
  const current = new Set(capsulesForItem(itemId));
  const next = new Set(newIds);
  const toAdd = [...next].filter(id => !current.has(id));
  const toRemove = [...current].filter(id => !next.has(id));
  try {
    for (const cid of toAdd) await addItemsToCapsule(cid, [itemId]);
    for (const cid of toRemove) {
      await rest(`/capsule_items?capsule_id=eq.${cid}&item_id=eq.${itemId}`, { method: "DELETE" });
      capsuleLinks = capsuleLinks.filter(l => !(l.capsule_id === cid && l.item_id === itemId));
    }
    if (toRemove.length) buildCapsuleIndexes();
    if (toAdd.length || toRemove.length) toast("Capsules updated");
  } catch (e) { toast(e.message); }
}

// ---- bulk "add to capsule" from closet select mode (reuses #moveSheet) ----
function openCapsuleSheet() {
  if (!selectedIds.size) return;
  _capSheetMode = true;
  const rows = capsules.map(c =>
    `<button class="sheet-row" data-cap-target="${esc(c.id)}">
      <span>${esc(c.name)}</span>
      <span class="rt" style="color:var(--muted);font-size:13px">${capModeLabel(c)} · ${capsuleItemCount(c.id)}</span>
    </button>`).join("");
  $("#moveInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="capSheetCancel">Cancel</button>
      <h2>Add to capsule</h2>
      <span style="width:54px"></span>
    </div>
    ${rows || `<div class="sheet-note">No capsules yet.</div>`}
    <button class="sheet-row" data-cap-target="__new__" style="color:var(--accent);font-weight:600"><span>＋ New capsule…</span></button>
    <div class="sheet-note">${selectedIds.size} item${selectedIds.size === 1 ? "" : "s"} selected.</div>`;
  $("#capSheetCancel").onclick = closeCapsuleSheet;
  $("#moveInner").querySelectorAll("[data-cap-target]").forEach(b => {
    b.onclick = () => capSheetPick(b.dataset.capTarget);
  });
  showSheet("moveSheet");
}
function closeCapsuleSheet() { _capSheetMode = false; hideSheet("moveSheet"); }

async function capSheetPick(target) {
  const ids = [...selectedIds];
  closeCapsuleSheet();
  if (target === "__new__") {
    _pendingAddIds = ids;
    exitSelectMode();
    switchTab("capsules");
    openCapsuleNew();
    return;
  }
  try {
    await addItemsToCapsule(target, ids);
    exitSelectMode();
    renderCloset();
    const c = capsuleById.get(target);
    toast(`Added to ${c ? c.name : "capsule"}`);
  } catch (e) { toast(e.message); }
}

