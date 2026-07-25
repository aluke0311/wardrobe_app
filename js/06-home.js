/* ===================================================================
   HOME LAUNCHER
   =================================================================== */
// Stylebook-style calm launcher: tiles that open a destination. Each tile carries
// a title, an inline SVG glyph, the tab it opens, and an optional live subtitle.
// ---- W7: weather-aware "Today" tile (flagship) ----
// Keyless geolocation, cached in `store` so we don't re-prompt every visit.
const HOME_LOC_KEY = "wardrobe.homeLoc";
const HOME_LOC_TTL = 6 * 3600000; // 6h — position + weather both drift slowly
function getHomeLocation() {
  try {
    const cached = JSON.parse(store.getItem(HOME_LOC_KEY) || "null");
    if (cached && Date.now() - cached.ts < HOME_LOC_TTL) return Promise.resolve({ lat: cached.lat, lon: cached.lon });
  } catch (e) {}
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude, ts: Date.now() };
        try { store.setItem(HOME_LOC_KEY, JSON.stringify(loc)); } catch (e) {}
        resolve({ lat: loc.lat, lon: loc.lon });
      },
      () => resolve(null),
      { timeout: 8000, maximumAge: HOME_LOC_TTL }
    );
  });
}
// V3: home weather for the suggestion sheet (the Today tile is gone — weather
// intelligence lives in the suggester now). One fetch per day, cached in memory.
let _homeWx = { date: null, wx: null, loading: false };
async function loadHomeWeather() {
  const today = todayStr();
  if (_homeWx.date === today || _homeWx.loading) return _homeWx.wx;
  _homeWx.loading = true;
  let wx = null, wx2 = null;
  try {
    const loc = await getHomeLocation();
    if (loc) {
      // Same single call now covers tomorrow too (Round A Tomorrow card).
      const tm = shiftDate(today, 1);
      const result = await fetchWeatherRange(loc.lat, loc.lon, today, tm);
      wx = result[today] || null;
      wx2 = result[tm] || null;
    }
  } catch (e) { /* offline/denied — suggester degrades to season-only */ }
  _homeWx = { date: today, wx, wx2, loading: false };
  // Quietly log today's weather (kv "wxlog", ≤1 write/day) — the history behind
  // "what did I wear last time it was like this" (see WEATHER MEMORY below).
  if (wx && session?.user && !(kvData.get("wxlog") || {})[today]) {
    const log = { ...(kvData.get("wxlog") || {}) };
    log[today] = { maxT: wx.maxT, minT: wx.minT, code: wx.code };
    const cut = shiftDate(today, -WXLOG_DAYS);
    for (const d of Object.keys(log)) if (d < cut) delete log[d];
    kvSet("wxlog", log);  // fire-and-forget
  }
  return wx;
}

/* ---- WEATHER MEMORY (Round C, 2026-07-25) ---------------------------------
   The wxlog above had been written every day since 2026-07-20 and read by
   NOTHING. This reads it: given a forecast, find the past days that felt like
   this and show what she actually wore. The suggester invents; this remembers,
   and precedent is the more trustworthy of the two.

   `backfillWxLog()` is what makes it useful today rather than in a year — one
   `fetchWeatherRange` call reconstructs the weather for her whole wear history
   out of the ERA5 archive she's already using for trips. */
const WXLOG_DAYS = 1200;        // ~3.3 years — was 400 before backfill existed
const WX_BACKFILL_KEY = "wxbackfill";
const WX_SIM_CUT = 15;          // score above this isn't "similar"; show nothing
const WX_WET_PENALTY = 8;       // a wet/dry mismatch, priced in degrees
const WX_SNOOZE_KEY = "wardrobe.wxBackfillSnooze";

const wxLog = () => kvData.get("wxlog") || {};

// One-shot. Idempotent: re-running only fills gaps and upgrades forecasts.
async function backfillWxLog() {
  const days = [...new Set(wears.map(w => w.worn_on).filter(Boolean))].sort();
  if (!days.length) throw new Error("No wears logged yet");
  const today = todayStr();
  const floor = shiftDate(today, -WXLOG_DAYS);
  const start = days[0] > floor ? days[0] : floor;
  const loc = await getHomeLocation();
  if (!loc) throw new Error("Location is off — can't look up past weather");
  const res = await fetchWeatherRange(loc.lat, loc.lon, start, today);
  const log = { ...wxLog() };
  // Anything logged live in the last 15 days came from a FORECAST; ERA5 is
  // observed, so it wins on older days and leaves the recent ones alone.
  const keep = shiftDate(today, -15);
  let n = 0;
  for (const [d, wx] of Object.entries(res || {})) {
    if (d > today || wx.maxT == null) continue;
    if (log[d] && d > keep) continue;
    log[d] = { maxT: wx.maxT, minT: wx.minT, code: wx.code };
    n++;
  }
  for (const d of Object.keys(log)) if (d < floor) delete log[d];
  await kvSet("wxlog", log);
  await kvSet(WX_BACKFILL_KEY, today);
  return n;
}

// Past wear-days that felt like `wx`. Args are injectable so selftest can drive it.
function similarDays(wx, { contexts = null, limit = 4, excludeDays = 14,
                           log = null, dayMap = null, today = null, trips = null } = {}) {
  if (!wx || wx.maxT == null) return [];
  const L = log || wxLog();
  const dm = dayMap || wearDayMap();
  const t = today || todayStr();
  const cutoff = shiftDate(t, -excludeDays);
  const want = contexts && contexts.length ? new Set(contexts) : null;
  const wet = wmoIsWet(wx.code);
  // Trip days are excluded (locked decision): what she wore out of a suitcase
  // in another climate is not precedent for a Tuesday at home.
  const ranges = trips || capsules.filter(isDatedTrip).map(c => [c.start_date, c.end_date]);
  const out = [];
  for (const [date, rows] of dm) {
    if (date > cutoff) continue;                 // too recent — she remembers it
    const e = L[date];
    if (!e || e.maxT == null) continue;
    if (ranges.some(([s, f]) => date >= s && date <= f)) continue;
    if (want && !rows.some(r => ctxArr(r).some(c => want.has(c)))) continue;
    let score = Math.abs(e.maxT - wx.maxT);
    if (e.minT != null && wx.minT != null) score += 0.5 * Math.abs(e.minT - wx.minT);
    if (wmoIsWet(e.code) !== wet) score += WX_WET_PENALTY;
    if (score > WX_SIM_CUT) continue;            // a bad match is worse than none
    out.push({
      date, score,
      outfitId: (rows.find(r => r.outfit_id) || {}).outfit_id || null,
      itemIds: [...new Set(rows.map(r => r.item_id))],
      contexts: [...new Set(rows.flatMap(r => ctxArr(r)))],
      maxT: e.maxT, minT: e.minT, code: e.code,
    });
  }
  out.sort((a, b) => a.score - b.score || (a.date < b.date ? 1 : -1));
  // One row per look, so the strip isn't four copies of the same outfit.
  const seen = new Set(), picked = [];
  for (const d of out) {
    const k = d.outfitId || `__${d.itemIds.slice().sort().join(",")}`;
    if (seen.has(k)) continue;
    seen.add(k); picked.push(d);
    if (picked.length >= limit) break;
  }
  return picked;
}

// The temperature band an item actually lives in. Needs ≥5 logged days with
// weather, so it stays quiet until the backfill has run.
const WX_PROFILE_MIN = 5;
function itemWxProfile(itemId, log = null) {
  const L = log || wxLog();
  const temps = [...new Set(wears.filter(w => w.item_id === itemId).map(w => w.worn_on))]
    .map(d => L[d]).filter(e => e && e.maxT != null).map(e => e.maxT).sort((a, b) => a - b);
  if (temps.length < WX_PROFILE_MIN) return null;
  const at = f => temps[Math.min(temps.length - 1, Math.max(0, Math.round(f * (temps.length - 1))))];
  return { lo: at(0.1), hi: at(0.9), n: temps.length };
}

function _wxTileCollage(d) {
  const o = d.outfitId ? outfitById.get(d.outfitId) : null;
  if (o) return outfitCollageHtml(o, 4);
  const pieces = d.itemIds.map(id => itemById.get(id)).filter(Boolean).slice(0, 4);
  if (!pieces.length) return `<div class="ocollage empty"></div>`;
  return `<div class="ocollage${pieces.length === 1 ? " solo" : ""}">${pieces.map((p, idx) =>
    `<div class="opiece${pieces.length === 3 && idx === 2 ? " span2" : ""}" data-photo="${esc(p.image_path || "")}"></div>`).join("")}</div>`;
}

// The precedent strip. Renders nothing at all when there's no decent match —
// silence is the correct output here, not a stretch.
function wxMemoryRowHtml(wx, contexts, { compact = false } = {}) {
  if (!dataReady || !wx || wx.maxT == null) return "";
  const hits = similarDays(wx, { contexts });
  if (!hits.length) return "";
  const pad = compact ? "0 2px 6px" : "0 16px 6px";
  const tiles = hits.map(d => {
    const o = d.outfitId ? outfitById.get(d.outfitId) : null;
    const when = new Date(d.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `<button class="wa-tile" data-wxmem="${esc(d.date)}"${o ? ` data-wxmem-look="${esc(o.id)}"` : ""}>
      ${_wxTileCollage(d)}
      <div class="wa-name">${esc(when)} · ${d.maxT}°/${d.minT}°</div>
      ${d.contexts.length ? `<div style="font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.contexts.join(", "))}</div>` : ""}
    </button>`;
  }).join("");
  return `<div style="padding:6px 0 2px${compact ? ";border-top:1px solid var(--line);margin-top:8px" : ""}">
    <div style="font-size:12px;color:var(--muted);padding:${pad}">You've dressed for this before</div>
    <div class="wa-strip"${compact ? ` style="padding-left:0;padding-right:0"` : ""}>${tiles}</div>
  </div>`;
}

// Shared wiring for any surface that renders wxMemoryRowHtml.
function wireWxMemory(root) {
  root.querySelectorAll("[data-wxmem]").forEach(b => {
    b.onclick = () => {
      const look = b.dataset.wxmemLook, date = b.dataset.wxmem;
      if (!$("#logSheet").hidden) hideSheet("logSheet");
      if (look) return openLookFrom(look);
      switchTab("calendar");
      calendarDay = date;
      renderCalendarDay($("#calendarBody"));
    };
  });
}

const HOME_TILES = [
  { tab: "closet",   label: "Closet",     sub: () => `${availableCount()} items`,
    icon: `<path d="M16 4l-4 9-4-9"/><path d="M12 13l-9 7h18l-9-7z"/>` },
  { tab: "looks",    label: "Looks",      sub: () => `${activeOutfits().length} looks`,
    icon: `<path d="M7 4l5 3 5-3 2 5-3 1v10H8V10L5 9z"/>` },
  { tab: "calendar", label: "Calendar",   sub: () => {
      const today = localISO(new Date());
      const n = new Set(wears.filter(w => w.worn_on === today).map(w => w.item_id)).size;
      return n ? `${n} logged today` : "Nothing logged yet";
    },
    icon: `<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>` },
  { tab: "capsules", label: "Capsules",   sub: () => capsules.length ? `${capsules.length} set${capsules.length === 1 ? "" : "s"}` : "Sets & packing",
    icon: `<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8V5h6v3"/>` },
  { tab: "stats",    label: "Style Stats", sub: () => "Insights", wide: true,
    icon: `<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>` },
];

function availableCount() {
  return items.filter(i => itemStatus(i) === "Available").length;
}

// ---- Home laundry row ----
// The user's own, deliberate exception to "no nudges": a passive strip about the
// most recent logged day — each worn piece pre-marked with the DERIVED hamper
// guess; tapping a thumb flips it (that write IS the one-time override).
// Confirming writes nothing (guesses stand either way). When the hamper goes
// stale the same slot becomes the "done laundry lately?" prompt instead.
const LAUNDRY_CONFIRM_KEY = "wardrobe.laundryConfirm";
function laundryReviewDay() {
  const today = todayStr();
  let best = null;
  for (const d of wearDayMap().keys()) if (d < today && (!best || d > best)) best = d;
  return best && daysSince(best) <= 3 ? best : null;
}
function laundryStripHtml() {
  const day = laundryReviewDay();
  if (!day || store.getItem(LAUNDRY_CONFIRM_KEY) === day) return "";
  const ls = laundryState();
  const ids = [...new Set(wears.filter(w => w.worn_on === day).map(w => w.item_id))];
  const its = ids.map(id => itemById.get(id))
    .filter(i => i && itemStatus(i) === "Available" && wearTolerance(i) !== Infinity);
  if (!its.length) return "";
  const dayLbl = daysSince(day) === 1 ? "Yesterday"
    : new Date(day + "T00:00:00").toLocaleDateString(undefined, { weekday: "long" });
  return `<div class="laun-row" data-laun-day="${esc(day)}">
    <div class="laun-hdr"><span>🧺 ${esc(dayLbl)}'s wear — hamper or keep?</span><button class="laun-ok" id="launConfirm">✓</button></div>
    <div class="laun-items">${its.map(i => `
      <button class="laun-it" data-laun-flip="${esc(i.id)}" title="${esc(i.name || "")}">
        ${thumbHtml(i.image_path)}
        <span class="laun-ic">${isDirty(i, ls) ? "🧺" : "↩︎"}</span>
      </button>`).join("")}</div>
    <div class="laun-sub">🧺 = to the hamper · ↩︎ = wearable again · tap to flip</div>
  </div>`;
}

// ---- what's new (2026-07-19) ----
// Features she paid for shouldn't be secrets: on the first run of a new
// version (not the first run EVER), a quiet toast offers the changelog.
function maybeShowWhatsNew() {
  const seen = store.getItem("wardrobe.seenVersion");
  if (seen === APP_VERSION) return;
  store.setItem("wardrobe.seenVersion", APP_VERSION);
  if (!seen || !WHATS_NEW.length) return;
  toast(`Updated · ${APP_VERSION}`, { label: "What's new →", fn: openWhatsNewSheet });
}
function openWhatsNewSheet() {
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <span style="width:54px"></span>
      <h2>What's new</h2>
      <button class="lnk" id="wnDone" style="font-weight:700">Done</button>
    </div>
    <div style="padding:6px 22px 26px">
      <div class="muted" style="font-size:12px;margin-bottom:10px">${esc(APP_VERSION)}</div>
      ${WHATS_NEW.map(b => `<div style="display:flex;gap:10px;padding:7px 0;font-size:14.5px;line-height:1.45">
        <span style="color:var(--accent);flex:none">•</span><span>${esc(b)}</span>
      </div>`).join("")}
    </div>`;
  showSheet("logSheet");
  $("#wnDone").onclick = () => hideSheet("logSheet");
}

// ---- catch-up strip (A1, 2026-07-18) ----
// Unlogged recent days rot the dataset silently; surface the last 3 (not
// today — that's the CTA's job) with a one-tap path in and a "skip" that
// marks a day deliberately unlogged (store-only, pruned to 30 days).
const SKIP_DAYS_KEY = "wardrobe.skipDays";
function skippedDays() {
  try { return new Set(JSON.parse(store.getItem(SKIP_DAYS_KEY) || "[]")); }
  catch { return new Set(); }
}
function skipDay(d) {
  const s = skippedDays();
  s.add(d);
  const cutoff = shiftDate(todayStr(), -30);
  store.setItem(SKIP_DAYS_KEY, JSON.stringify([...s].filter(x => x >= cutoff)));
}
function missedDays() {
  const skip = skippedDays();
  const wd = wearDayMap();
  const out = [];
  for (let n = 1; n <= 3; n++) {
    const d = shiftDate(todayStr(), -n);
    if (!wd.has(d) && !skip.has(d)) out.push(d);
  }
  return out;
}
function catchupHtml() {
  const miss = missedDays();
  if (!miss.length) return "";
  const row = (d) => {
    const lbl = new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0">
      <span style="flex:1;font-size:13.5px">${esc(lbl)}</span>
      <button class="lnk" data-cu-log="${esc(d)}" style="color:var(--accent);font-weight:700;font-size:13px">Log →</button>
      <button class="cb-x" data-cu-skip="${esc(d)}" title="Didn't get dressed / don't care" style="width:24px;height:24px;color:var(--muted)">✕</button>
    </div>`;
  };
  return `<div class="laun-row">
    <div style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)">Catch up?</div>
    ${miss.map(row).join("")}
  </div>`;
}

// ---- trip mode: Home dashboard ----
let _tripWxHomeFor = null;  // capsule id the dashboard last loaded _planWx for
async function loadTripHomeWx(c) {
  if (_tripWxHomeFor === c.id && _planWxLoadedFor === c.id) return;
  _tripWxHomeFor = c.id;
  const cached = _wxCache[c.id];
  let days;
  if (cached && Date.now() - cached.ts < WX_TTL) days = cached.days;
  else { try { days = await buildTripWeather(c); _wxCache[c.id] = { days, ts: Date.now() }; } catch { days = []; } }
  _planWx = {};
  (days || []).forEach(d => { _planWx[d.date] = d; });
  _planWxLoadedFor = c.id;
  if ($(".screen.active")?.id === "tab-home" && tripModeId === c.id) renderHome();
}

function tripDashHtml(c) {
  const today = todayStr();
  const dated = isDatedTrip(c);
  const phase = tripPhase(c);
  const dates = dated ? tripDates(c) : [];
  let sub;
  if (phase === "trip") sub = `Day ${tripDayNum(c, today)} of ${dates.length}`;
  else if (phase === "pack") sub = `starts ${fmtDate(c.start_date)}`;
  else if (phase === "unpack") sub = "trip finished — unpack when ready";
  else if (dated) sub = `${fmtDate(c.start_date)} – ${fmtDate(c.end_date)}`;
  else sub = "Capsule mode";
  const wx = dated && phase === "trip" ? planDayWxHtml(today) : "";

  // Today's plan (trip phase only): planned looks with a one-tap "Wore it".
  let planHtml = "";
  if (phase === "trip") {
    const planned = planActiveLooks(c, today);
    const laundryDay = planLaundryDay(c, today);
    const rows = planned.map(oid => {
      const o = outfitById.get(oid);
      if (!o) return "";
      return `<div class="td-look" data-td-look="${esc(oid)}">
        <div class="tdl-collage">${outfitCollageHtml(o, 4)}</div>
        <div class="tdl-name">${esc(outfitName(o))}</div>
        ${planWorn(today, oid) ? `<span class="tdl-worn">✓ Worn</span>` : `<button class="tdl-wore" data-td-wore="${esc(oid)}">Wore it</button>`}
      </div>`;
    }).join("");
    planHtml = `<div class="td-plan">
      <div class="td-plan-lbl">Today${laundryDay ? " · 🧺 laundry day" : ""}</div>
      ${rows || `<div class="muted" style="font-size:13.5px;padding:2px 0 4px">Nothing planned for today.</div>`}
    </div>`;
  }

  // Suitcase hamper (works for every phase, incl. capsule mode).
  let launHtml = "";
  if (LAUNDRY_READY()) {
    const members = capsuleItems(c.id).filter(i => itemStatus(i) === "Available");
    const _ls = laundryState();
    const dirty = members.filter(i => isDirty(i, _ls));
    const verb = phase === "pack" ? "wash before you pack" : "in the hamper";
    launHtml = `<button class="td-laun" data-td-laundry>🧺
      <span style="flex:1">${dirty.length ? `${dirty.length} of ${members.length} pieces ${verb}` : `Suitcase is clean · ${members.length} pieces`}</span>
      <span style="color:var(--accent);font-weight:600">＋</span></button>`;
  }

  // Remaining days mini-strip (trip phase): plan coverage + weather at a glance.
  let daysHtml = "";
  if (phase === "trip" || phase === "pack") {
    const rest = dates.filter(d => d >= today);
    if (rest.length > 1) {
      daysHtml = `<div class="td-days">${rest.map(d => {
        const w = _planWx[d];
        const n = planActiveLooks(c, d).length;
        const dow = new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" });
        return `<button class="td-day${d === today ? " today" : ""}" data-td-plandate="${esc(d)}">
          <div class="d">${esc(dow)}</div>
          <div>${w && w.maxT != null ? `${wmoEmoji(w.code)} ${w.maxT}°` : "·"}</div>
          <div>${planLaundryDay(c, d) ? "🧺" : n ? `${n} planned` : "—"}</div>
        </button>`;
      }).join("")}</div>`;
    }
  }

  const chips = [
    `<button class="cap-chip" data-td-suggest>✨ Suggest</button>`,
    `<button class="cap-chip" data-td-build>✎ Build</button>`,
    dated ? `<button class="cap-chip" data-td-plans>🗓 Trip plan</button>`
          : `<button class="cap-chip" data-td-plans>Planned outfits</button>`,
    `<button class="cap-chip" data-td-cap>🧳 ${dated ? "Packing list" : "Capsule"}</button>`,
  ].join("");

  const unpackHtml = phase === "unpack"
    ? `<button class="td-laun" data-td-unpack style="margin-top:10px">🧳
        <span style="flex:1">Trip's over — unpack &amp; see the recap</span>
        <span style="color:var(--accent);font-weight:600">›</span></button>`
    : "";
  return `<div class="trip-dash">
    <div class="td-banner">
      <div class="td-title">
        <div class="td-name">${dated ? "✈️ " : ""}${esc(c.name)}</div>
        <div class="td-sub">${esc(sub)}</div>
      </div>
      ${wx ? `<span class="td-wx">${wx}</span>` : ""}
      <button class="cb-x" data-td-exit title="Exit trip mode">✕</button>
    </div>
    ${planHtml}
    ${unpackHtml}
    ${launHtml}
    <div class="td-chips">${chips}</div>
    ${daysHtml}
  </div>`;
}

// Auto-offer banner: a dated trip overlapping today (or about to start) that the
// mode isn't on for. Dismissal is per-day, so it quietly comes back tomorrow.
function tripOfferHtml() {
  if (tripModeId) return "";
  const today = todayStr();
  const c = capsules.filter(isDatedTrip)
    .filter(x => { const p = tripPhase(x); return p === "trip" || p === "pack"; })
    .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  if (!c) return "";
  // B1 (2026-07-18): dismissal is once per TRIP, not per day — a skipped trip
  // shouldn't greet you every morning. (Legacy per-day date values stay truthy.)
  if (store.getItem(TRIP_OFFER_KEY + c.id)) return "";
  const phase = tripPhase(c);
  const txt = phase === "trip"
    ? (today === c.start_date ? `${c.name} starts today — enter trip mode?` : `On your ${c.name} trip? Enter trip mode`)
    : `${c.name} starts ${fmtDate(c.start_date)} — start packing?`;
  return `<div class="trip-offer" data-trip-offer="${esc(c.id)}" data-trip-offer-phase="${phase}">
    <span style="flex:none">✈️</span><span class="to-t">${esc(txt)}</span>
    <button class="cb-x" data-trip-offer-x="${esc(c.id)}">✕</button>
  </div>`;
}

/* ---- Round A: Tomorrow card + today's planned rows + plan-ahead ----
   All suppressed in trip mode (the trip dashboard owns those days). The
   Tomorrow card is visible ALL DAY (user decision 2026-07-20). */

// One generated outfit per context-only entry, cached per render-day so
// re-renders never re-roll it out from under her (predictability).
// A generated pick is STICKY: once she's seen it, it survives refreshes,
// re-renders and weather updates until she re-rolls it (2026-07-21 — "I saw
// one I liked and now it's gone"). Stored in kv, today-and-future only.
const TM_PICK_KEY = "tmpick";
function tmPickAll() { const v = kvData.get(TM_PICK_KEY); return v && typeof v === "object" ? v : {}; }
function tmPickGet(date, idx) {
  const ids = (tmPickAll()[date] || {})[String(idx)];
  if (!Array.isArray(ids)) return null;
  const pieces = ids.map(id => itemById.get(id)).filter(Boolean);
  return pieces.length >= 2 ? pieces : null;   // a deleted piece invalidates it
}
function tmPickSet(date, idx, pieces) {
  const all = JSON.parse(JSON.stringify(tmPickAll()));
  const today = todayStr();
  for (const d of Object.keys(all)) if (d < today) delete all[d];
  (all[date] = all[date] || {})[String(idx)] = pieces.map(p => p.id);
  kvSet(TM_PICK_KEY, all);   // fire-and-forget; kvData updates synchronously
}
function tomorrowGenPieces(date, entry, pool = null, idx = 0, force = false) {
  if (!force) { const saved = tmPickGet(date, idx); if (saved) return saved; }
  const act = entryActivity(entry.contexts);
  const res = suggestOutfits(act ? null : entrySuggestLevel(entry.contexts), null, pool, seasonOf(date), _dpWx(date), null, true, act);
  const pieces = res.length ? res[0].pieces : null;
  if (pieces) tmPickSet(date, idx, pieces);
  return pieces;
}
// Tap the pick to open it in the suggester with that exact combo in front —
// swap/lock/ban it, and whatever it ends as is what the card keeps.
function openTomorrowRevise(date, idx) {
  const trip = _tmTripCtx(date);
  const pieces = tmPickGet(date, idx);
  if (trip) openSuggestSheet(null, trip.id, { capsuleId: trip.id, date });
  else openSuggestSheet(null, null, _dpSuggestCtx(date, idx, (dayPlan(date)[idx] || {}).contexts));
  _sugg.tmPick = { date, idx };
  if (pieces) {
    const k = comboKey(pieces);
    _sugg.results = [{ pieces, score: 0 }, ..._sugg.results.filter(c => comboKey(c.pieces) !== k)];
    _sugg.idx = 0;
  }
  renderSuggestSheet();
}
function _planThumbStrip(pieces) {
  // .cthumb is a fixed 64px — wrapping it in a smaller box made the thumbs
  // overlap each other and the caption below (2026-07-21). Own class instead.
  return `<div class="tm-strip">${pieces.map(p => thumbHtml(p.image_path, "tm-thumb")).join("")}</div>`;
}
// Trip mode (2026-07-21, user request): the Tomorrow card works during a trip
// too, but for dates INSIDE the trip it reads/writes the TRIP's own day plan
// (capsules.plan) — never a second source of truth. Returns null when the kv
// day plan is the right backing store.
function _tmTripCtx(date) {
  if (!tripModeId) return null;
  const c = capsuleById.get(tripModeId);
  if (!c || !isDatedTrip(c)) return null;
  if (date < c.start_date || date > c.end_date) return null;
  return c;
}
function tomorrowCardHtml() {
  if (!dataReady) return "";
  const tm = shiftDate(todayStr(), 1);
  const trip = _tmTripCtx(tm);
  // Trip days synthesize entries from the trip plan; ordinary days use kv.
  const entries = trip
    ? planActiveLooks(trip, tm).map(oid => ({ contexts: [], outfit: oid }))
    : dayPlan(tm);
  // A trip day with nothing planned still gets one generated suggestion —
  // scoped to the suitcase, like every other trip-mode suggestion.
  const genEntries = entries.length ? entries : (trip ? [{ contexts: [], outfit: null }] : []);
  const pool = trip ? capsuleItems(trip.id).filter(i => itemStatus(i) === "Available") : null;
  const wx = _dpWx(tm);
  const wxBit = wx && wx.maxT != null ? ` · ${wmoEmoji(wx.code)} ${wx.maxT}°/${wx.minT}°` : "";
  const hdr = `<div style="display:flex;align-items:center;justify-content:space-between;padding:2px 2px 8px">
    <div style="font-size:13px;font-weight:600;color:var(--muted)">Tomorrow · ${esc(planDayLabel(tm))}${wxBit}${trip ? " · ✈️" : ""}</div>
    <button class="lnk" data-tm-edit style="font-size:12.5px">${entries.length ? "✎ Edit" : "＋ Plan"}</button>
  </div>`;
  let body = "";
  if (!genEntries.length) {
    body = `<button data-tm-edit style="width:100%;text-align:left;font-size:13.5px;color:var(--muted);padding:2px">Nothing planned — tap to set tomorrow's context or outfit.</button>`;
  } else {
    body = genEntries.map((e, idx) => {
      const ctxs = (e.contexts || []).join(", ");
      const o = e.outfit ? outfitById.get(e.outfit) : null;
      if (o) return `<button data-tm-look="${esc(o.id)}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:4px 0">
        <span style="width:48px;flex:none">${outfitCollageHtml(o, 4)}</span>
        <span style="flex:1;min-width:0">
          <span style="display:block;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(outfitName(o))}</span>
          ${ctxs ? `<span style="display:block;font-size:12px;color:var(--muted)">${esc(ctxs)}</span>` : ""}
        </span>
      </button>`;
      const pieces = tomorrowGenPieces(tm, e, pool, idx);
      if (!pieces) return `<div class="muted" style="font-size:12.5px;padding:4px 0">${esc(ctxs || "Planned")} — no clean outfit found${trip ? " in the suitcase" : ""}; tap ✨ to dig.</div>
        <div style="display:flex;gap:6px;padding:2px 0"><button class="cap-chip" data-tm-refine="${idx}">✨ Suggest</button></div>`;
      const why = [ctxs || (entrySuggestLevel(e.contexts) ? occLabel(entrySuggestLevel(e.contexts)) : ""),
                   trip ? "from the suitcase" : "clean picks"].filter(Boolean).join(" · ");
      return `<div style="padding:4px 0">
        <button data-tm-open="${idx}" style="display:block;width:100%;text-align:left" title="Open and revise">${_planThumbStrip(pieces)}</button>
        <div style="display:flex;align-items:center;gap:8px;padding-top:6px">
          <span class="muted" style="font-size:12px;flex:1;min-width:0;line-height:1.35">${esc(why)}</span>
          <button class="cap-chip" data-tm-keep="${idx}" style="font-size:12px" title="Save as a real look on the plan">📌 Keep</button>
          <button class="cap-chip" data-tm-reroll="${idx}" style="font-size:12px" title="Try a different one">↻</button>
        </div>
      </div>`;
    }).join(`<div class="det-divider" style="margin:4px 0"></div>`);
  }
  // Precedent (Round C): what she actually wore the last times it felt like this.
  const mem = trip ? "" : wxMemoryRowHtml(wx, [...new Set(genEntries.flatMap(e => e.contexts || []))], { compact: true });
  // Plan-ahead lives INSIDE the card now — Home had too many stacked rows.
  const foot = tripModeId ? "" :
    `<div style="border-top:1px solid var(--line);margin-top:8px;padding-top:7px">
      <button class="lnk" data-plan-ahead style="font-size:12.5px;color:var(--muted)">📅 Plan the week ›</button>
    </div>`;
  return `<div class="det-card" style="margin:10px 16px 0;padding:10px 12px">${hdr}${body}${mem}${foot}</div>`;
}
function todayPlanRowsHtml() {
  if (!dataReady || tripModeId) return "";
  const today = todayStr();
  return dayPlan(today).map((e, idx) => {
    const o = e.outfit ? outfitById.get(e.outfit) : null;
    if (!o || planWorn(today, o.id)) return "";
    const ctxs = (e.contexts || []).join(", ");
    return `<button class="logged-row" data-tp-wear="${idx}">
      <span class="lr-check">📅</span>
      <span class="lr-text">Planned: ${esc(outfitName(o))}${ctxs ? " · " + esc(ctxs) : ""}</span>
      <span class="lr-plus">✓</span>
    </button>`;
  }).join("");
}
function openWeekPlanSheet() {
  const today = todayStr();
  // Seven blank rows is what an abandoned planner looks like. Days with nothing
  // planned borrow the weekday's usual contexts, shown muted + italic so a
  // guess never reads as a commitment.
  const rhythm = weeklyRhythm();
  const rows = [...Array(7)].map((_, n) => {
    const d = shiftDate(today, n);
    const label = n === 0 ? "Today" : n === 1 ? "Tomorrow" : planDayLabel(d);
    const entries = dayPlan(d);
    const rh = entries.length ? null : rhythmFor(d, rhythm);
    const sum = entries.length
      ? entries.map(e => {
          const o = e.outfit ? outfitById.get(e.outfit) : null;
          return o ? outfitName(o) : ((e.contexts || []).join("/") || "outfit TBD");
        }).join(" · ")
      : (rh ? `${rh.contexts.join(" · ")} · usually` : "—");
    return `<button data-wk-day="${d}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:10px 16px;border-bottom:1px solid var(--line)">
      <span style="width:86px;flex:none;font-size:13.5px;font-weight:600">${esc(label)}</span>
      <span style="flex:1;min-width:0;font-size:13px;color:${entries.length ? "var(--text)" : "var(--muted)"}${rh ? ";font-style:italic" : ""};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(sum)}</span>
      <svg class="chev" viewBox="0 0 24 24" style="flex:none"><path d="M9 6l6 6-6 6"/></svg>
    </button>`;
  }).join("");
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="wkClose">Done</button>
      <h2>Plan ahead</h2>
      <div style="width:48px"></div>
    </div>
    ${rows}
    <div style="height:max(env(safe-area-inset-bottom),10px)"></div>`;
  showSheet("logSheet");
  $("#wkClose").onclick = () => { hideSheet("logSheet"); if (activeTabName() === "home") renderHome(); };
  $("#logInner").querySelectorAll("[data-wk-day]").forEach(b => b.onclick = () => openDayPlanSheet(b.dataset.wkDay));
}

// Session-only: whether the folded Home attention rows are expanded. Not
// persisted — a fresh open should be calm again.
let _homeAttnOpen = false;
function renderHome() {
  const tiles = HOME_TILES.map(t => `
    <button class="tile ${t.wide ? "wide" : ""}" data-go="${t.tab}">
      <svg viewBox="0 0 24 24">${t.icon}</svg>
      <div class="tlabel">${esc(t.label)}</div>
      <div class="tsub">${dataReady ? esc(t.sub()) : "&nbsp;"}</div>
    </button>`).join("");
  const today = todayStr();
  const hasWearToday = dataReady && wearDayMap().has(today);
  // V3: once today is logged, acknowledge it (habit feedback) + keep a one-tap
  // path into today's day view for the evening outfit — instead of going silent.
  let cta = "";
  if (dataReady && !hasWearToday) {
    cta = `<button class="log-cta" id="homeLogCta">Log today's wear</button>`;
  } else if (dataReady) {
    const todayWears = wears.filter(w => w.worn_on === today);
    const ctxs = [...new Set(todayWears.flatMap(w => ctxArr(w)))];
    const nItems = new Set(todayWears.map(w => w.item_id)).size;
    const detail = ctxs.length ? ctxs.join(", ") : `${nItems} item${nItems === 1 ? "" : "s"}`;
    cta = `<button class="logged-row" id="homeLoggedRow">
      <span class="lr-check">✓</span><span class="lr-text">Logged today · ${esc(detail)}</span><span class="lr-plus">＋</span>
    </button>`;
  }
  // Laundry slot: yesterday's confirm strip WINS over the stale-hamper prompt
  // (2026-07-21, user-reported "not seeing the hamper question from yesterday's
  // wears") — the per-day question is precise and one tap; the stale prompt is
  // the catch-all for when there's no recent day to review.
  let laun = "";
  if (dataReady && LAUNDRY_READY()) {
    laun = laundryStripHtml();
    if (!laun && laundryStale() && !laundryPromptSnoozed()) {
      const n = hamperItems().length;
      laun = `<button class="logged-row" id="homeLaunPrompt">
        <span class="lr-check">🧺</span><span class="lr-text">Done laundry lately? · ${n} in the hamper</span><span class="lr-plus">＋</span>
      </button>`;
    }
  }
  // Trip mode: the dashboard takes over the top of Home; the tile grid stays
  // below it (every screen still works, scoped to the capsule).
  const tc = dataReady ? tripCapsule() : null;
  const dash = tc ? tripDashHtml(tc) : (dataReady ? tripOfferHtml() : "");
  const catchup = dataReady ? catchupHtml() : "";
  // Backup staleness (E1): one tap runs the download right here.
  let bk = "";
  if (dataReady) {
    const last = store.getItem("wardrobe.lastBackup");
    if (!last || last <= shiftDate(todayStr(), -30)) {
      const ago = last ? `last backup ${Math.round((new Date(todayStr()) - new Date(last)) / 86400000)} days ago` : "no backup yet";
      bk = `<button class="logged-row" id="homeBackupRow" style="border:1px solid var(--line);background:var(--bg)">
        <span class="lr-check">🗄</span><span class="lr-text">Your data — ${esc(ago)}</span><span class="lr-plus">＋</span>
      </button>`;
    }
  }
  // One-time weather backfill offer (Round C). This card is the real entry
  // point — the Settings row exists only as a re-run hatch.
  let wxb = "";
  if (dataReady && !kvData.get(WX_BACKFILL_KEY) && wears.length > 100
      && (store.getItem(WX_SNOOZE_KEY) || "") <= todayStr()) {
    wxb = `<div class="det-card" style="margin:10px 16px 0;padding:12px">
      <div style="font-size:13.5px;line-height:1.45">Match today's weather to what you actually wore — a one-time lookup of past weather for every day you've logged.</div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn" id="homeWxFill" style="flex:1">Look it up</button>
        <button class="btn btn-sec" id="homeWxNo" style="flex:none">Not now</button>
      </div>
    </div>`;
  }
  /* Attention hierarchy (Round C). Home could stack eight blocks: trip dash,
     tiles, today's plan, the log CTA, Tomorrow, catch-up, laundry, backup, and
     now the weather offer. Only ONE thing gets to ask for attention; the rest
     fold into a single quiet line. The log CTA and the Tomorrow card are NOT in
     here — they're the daily loop, not interruptions. In trip mode the dash IS
     the one thing, so everything else folds. */
  const attention = [catchup, laun, bk, wxb].filter(Boolean);
  const shown = tc ? [] : attention.slice(0, 1);
  const rest = attention.slice(shown.length);
  const attnHtml = shown.join("") + (!rest.length ? "" : _homeAttnOpen
    ? rest.join("") + `<div class="center" style="padding:2px 0 6px"><button class="lnk" id="homeAttnLess" style="font-size:12.5px;color:var(--muted)">Show less</button></div>`
    : `<div class="center" style="padding:6px 0"><button class="lnk" id="homeAttnMore" style="font-size:12.5px;color:var(--muted)">${rest.length} more thing${rest.length === 1 ? "" : "s"} ›</button></div>`);

  // Below everything, and only on the days it has something: a delight row, not
  // an attention row, so it stays out of the folding group above.
  const otd = (dataReady && !tripModeId) ? onThisDayHtml(today) : "";

  $("#homeBody").innerHTML = `${dash}<div class="launch">${tiles}</div>${todayPlanRowsHtml()}${cta}${tomorrowCardHtml()}${attnHtml}${otd}`;
  hydratePhotos($("#homeBody"));
  wireWxMemory($("#homeBody"));
  $("#homeBody").querySelectorAll("[data-otd]").forEach(b => {
    b.onclick = () => { switchTab("calendar"); calendarDay = b.dataset.otd; renderCalendarDay($("#calendarBody")); };
  });
  const attnMore = $("#homeAttnMore");
  if (attnMore) attnMore.onclick = () => { _homeAttnOpen = true; renderHome(); };
  const attnLess = $("#homeAttnLess");
  if (attnLess) attnLess.onclick = () => { _homeAttnOpen = false; renderHome(); };
  const wxFill = $("#homeWxFill");
  if (wxFill) wxFill.onclick = async () => {
    wxFill.disabled = true; wxFill.textContent = "Looking up…";
    try {
      const n = await backfillWxLog();
      toast(`Weather filled in for ${n} day${n === 1 ? "" : "s"}`);
      renderHome();
    } catch (e) { toast(e.message); wxFill.disabled = false; wxFill.textContent = "Look it up"; }
  };
  const wxNo = $("#homeWxNo");
  if (wxNo) wxNo.onclick = () => { store.setItem(WX_SNOOZE_KEY, shiftDate(todayStr(), 14)); renderHome(); };
  // Round A planning wiring
  $("#homeBody").querySelectorAll("[data-tp-wear]").forEach(b => {
    b.onclick = () => wearPlannedEntry(todayStr(), +b.dataset.tpWear);
  });
  $("#homeBody").querySelectorAll("[data-tm-edit]").forEach(b => {
    b.onclick = () => {
      const tm = shiftDate(todayStr(), 1), trip = _tmTripCtx(tm);
      // Trip days are planned in the trip's own by-day planner.
      if (trip) { switchTab("capsules"); return openTripPlan(trip.id); }
      openDayPlanSheet(tm);
    };
  });
  $("#homeBody").querySelectorAll("[data-tm-look]").forEach(b => {
    b.onclick = () => openLookFrom(b.dataset.tmLook);
  });
  $("#homeBody").querySelectorAll("[data-tm-refine]").forEach(b => {
    b.onclick = () => {
      const tm = shiftDate(todayStr(), 1), idx = +b.dataset.tmRefine, trip = _tmTripCtx(tm);
      if (trip) return openSuggestSheet(null, trip.id, { capsuleId: trip.id, date: tm });
      openSuggestSheet(null, null, _dpSuggestCtx(tm, idx, (dayPlan(tm)[idx] || {}).contexts));
    };
  });
  $("#homeBody").querySelectorAll("[data-tm-open]").forEach(b => {
    b.onclick = () => openTomorrowRevise(shiftDate(todayStr(), 1), +b.dataset.tmOpen);
  });
  $("#homeBody").querySelectorAll("[data-tm-reroll]").forEach(b => {
    b.onclick = () => {
      const tm = shiftDate(todayStr(), 1), idx = +b.dataset.tmReroll, trip = _tmTripCtx(tm);
      const pool = trip ? capsuleItems(trip.id).filter(i => itemStatus(i) === "Available") : null;
      tomorrowGenPieces(tm, (trip ? {} : dayPlan(tm)[idx]) || {}, pool, idx, true);  // force
      renderHome();
    };
  });
  $("#homeBody").querySelectorAll("[data-tm-keep]").forEach(b => {
    b.onclick = async () => {
      const tm = shiftDate(todayStr(), 1), idx = +b.dataset.tmKeep, trip = _tmTripCtx(tm);
      const pool = trip ? capsuleItems(trip.id).filter(i => itemStatus(i) === "Available") : null;
      const pieces = tomorrowGenPieces(tm, (trip ? {} : dayPlan(tm)[idx]) || {}, pool, idx);
      if (!pieces) return;
      b.disabled = true;
      try {
        const oid = await saveComboAsOutfit(pieces);
        if (trip) await addPlanLook(trip.id, tm, oid);
        else await addKvPlanLook(tm, oid, idx);
        toast("Planned for tomorrow");
        renderHome();
      } catch (e) { toast(e.message); b.disabled = false; }
    };
  });
  const planAhead = $("#homeBody").querySelector("[data-plan-ahead]");
  if (planAhead) planAhead.onclick = () => openWeekPlanSheet();
  // Tomorrow card wants tomorrow's forecast; one lazy fetch/day (no-op after).
  if (dataReady && !tripModeId && _homeWx.date !== todayStr() && !_homeWx.loading) {
    loadHomeWeather().then(() => { if (activeTabName() === "home") renderHome(); });
  }
  $("#homeBody").querySelectorAll("[data-cu-log]").forEach(b => {
    b.onclick = () => {
      switchTab("calendar");
      calendarDay = b.dataset.cuLog;
      renderCalendarDay($("#calendarBody"));
      openWearAgainChooser(b.dataset.cuLog);
    };
  });
  $("#homeBody").querySelectorAll("[data-cu-skip]").forEach(b => {
    b.onclick = () => { skipDay(b.dataset.cuSkip); renderHome(); };
  });
  const bkRow = $("#homeBackupRow");
  if (bkRow) bkRow.onclick = () => downloadBackup();
  if (tc && isDatedTrip(tc) && (tc.locations || []).length && _planWxLoadedFor !== tc.id) loadTripHomeWx(tc);
  wireTripDash(tc);
  const launPrompt = $("#homeLaunPrompt");
  if (launPrompt) launPrompt.onclick = () => openLaundrySheet({ fromPrompt: true });
  const launOk = $("#launConfirm");
  if (launOk) launOk.onclick = (e) => {
    e.stopPropagation();
    const day = $("#homeBody").querySelector("[data-laun-day]")?.dataset.launDay;
    if (day) store.setItem(LAUNDRY_CONFIRM_KEY, day);
    renderHome();
  };
  $("#homeBody").querySelectorAll("[data-laun-flip]").forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const it = itemById.get(b.dataset.launFlip);
      if (!it) return;
      await flipLaundry(it.id, !isDirty(it));
      renderHome();
    };
  });
  const ctaBtn = $("#homeLogCta");
  // G6: the most common real log is a repeat — offer "wear again" first, not a
  // blank picker.
  if (ctaBtn) ctaBtn.onclick = () => {
    switchTab("calendar");
    calendarDay = today;
    renderCalendarDay($("#calendarBody"));
    openWearAgainChooser(today);
  };
  const loggedBtn = $("#homeLoggedRow");
  if (loggedBtn) loggedBtn.onclick = () => {
    switchTab("calendar");
    calendarDay = today;
    renderCalendarDay($("#calendarBody"));
  };
}

// Handlers for the trip dashboard + the trip-mode offer banner on Home.
function wireTripDash(tc) {
  const body = $("#homeBody");
  const offer = body.querySelector("[data-trip-offer]");
  if (offer) {
    const cid = offer.dataset.tripOffer;
    offer.onclick = () => {
      if (offer.dataset.tripOfferPhase === "pack") {
        switchTab("capsules"); capsuleId = cid; capsuleView = "detail"; renderCapsules();
      } else enterTripMode(cid);
    };
    const x = body.querySelector("[data-trip-offer-x]");
    if (x) x.onclick = (e) => {
      e.stopPropagation();
      store.setItem(TRIP_OFFER_KEY + cid, todayStr());
      renderHome();
    };
  }
  if (!tc) return;
  const on = (sel, fn) => body.querySelectorAll(sel).forEach(el => { el.onclick = fn; });
  on("[data-td-exit]", () => exitTripMode());
  on("[data-td-unpack]", () => openTripRecap(tc.id, { unpack: true }));
  on("[data-td-suggest]", () => openSuggestSheet(null, tc.id));
  on("[data-td-build]", () => openBuilder(null, null, { capsuleId: tc.id, date: PLAN_BUCKET }));
  on("[data-td-laundry]", () => {
    switchTab("closet");
    closetHamper = true; closetWorn = false; closetMend = false; closetCat = null; closetSub = null; searchResults = null; closetSearchQ = null;
    renderCloset();
  });
  on("[data-td-plans]", () => { switchTab("capsules"); openTripPlan(tc.id); });
  on("[data-td-cap]", () => { switchTab("capsules"); capsuleId = tc.id; capsuleView = "detail"; renderCapsules(); });
  body.querySelectorAll("[data-td-plandate]").forEach(el => {
    el.onclick = () => { switchTab("capsules"); openTripPlan(tc.id); };
  });
  body.querySelectorAll("[data-td-look]").forEach(el => {
    el.onclick = () => openLookFrom(el.dataset.tdLook);
  });
  body.querySelectorAll("[data-td-wore]").forEach(el => {
    el.onclick = async (e) => {
      e.stopPropagation();
      await planWoreIt(todayStr(), el.dataset.tdWore);
      renderHome();
    };
  });
}

