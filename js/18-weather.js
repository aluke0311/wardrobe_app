/* ===================================================================
   WEATHER + LOCATION  (trips only — Open-Meteo, no API key needed)
   =================================================================== */
const _wxCache = {};  // capsuleId → {days, ts}
const WX_TTL = 600000; // 10 min
let _wxAutoTimer = null;  // interval that re-fetches weather while a trip detail is open
let _locSheet = null;  // {cid, step:"search"|"range", searchQ, results, loc, from, to}

function wmoEmoji(code) {
  if (code == null) return "—";
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤️";
  if (code === 3) return "☁️";
  if (code <= 48) return "🌫️";
  if (code <= 55) return "🌦️";
  if (code <= 65) return "🌧️";
  if (code <= 77) return "❄️";
  if (code <= 82) return "🌧️";
  if (code <= 86) return "🌨️";
  if (code <= 99) return "⛈️";
  return "🌡️";
}

async function geocodeLocation(q) {
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`);
  const data = await res.json();
  return (data.results || []).map(r => ({
    name: r.name, admin1: r.admin1 || "", country: r.country || "",
    lat: r.latitude, lon: r.longitude
  }));
}

// Fetch weather for a lat/lon + date range.
// 3 zones: past (archive), recent+near-future (forecast), far-future (3-yr historical avg).
async function fetchWeatherRange(lat, lon, startStr, endStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = localISO(today);
  const fc92 = new Date(today); fc92.setDate(fc92.getDate() - 92);
  const fc92Str = localISO(fc92);
  const fcCutoff = new Date(today); fcCutoff.setDate(fcCutoff.getDate() + 15);
  const fcCutoffStr = localISO(fcCutoff);
  const result = {};

  // Zone A: within forecast API window (today-92 to today+15)
  const zAS = startStr > fc92Str ? startStr : fc92Str;
  const zAE = endStr < fcCutoffStr ? endStr : fcCutoffStr;
  if (zAS <= zAE) {
    try {
      const d = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto` +
        `&temperature_unit=fahrenheit&start_date=${zAS}&end_date=${zAE}`).then(r => r.json());
      if (d.daily) d.daily.time.forEach((date, i) => {
        result[date] = { maxT: Math.round(d.daily.temperature_2m_max[i]), minT: Math.round(d.daily.temperature_2m_min[i]), code: d.daily.weather_code[i], hist: false };
      });
    } catch (e) {}
  }

  // Zone B: older than 92 days — ERA5 archive (real historical data)
  if (startStr < fc92Str) {
    const zBE = endStr < fc92Str ? endStr : localISO(new Date(fc92.getTime() - 86400000));
    try {
      const d = await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
        `&daily=temperature_2m_max,temperature_2m_min,weather_code` +
        `&start_date=${startStr}&end_date=${zBE}&temperature_unit=fahrenheit`).then(r => r.json());
      if (d.daily) d.daily.time.forEach((date, i) => {
        if (!result[date]) result[date] = { maxT: Math.round(d.daily.temperature_2m_max[i]), minT: Math.round(d.daily.temperature_2m_min[i]), code: d.daily.weather_code[i], hist: false };
      });
    } catch (e) {}
  }

  // Zone C: future beyond forecast window — average same calendar dates from 3 prior years
  if (endStr > fcCutoffStr) {
    const histDates = [];
    { let d = new Date(startStr + "T00:00:00"), e = new Date(endStr + "T00:00:00");
      while (d <= e) { const s = localISO(d); if (s > fcCutoffStr && !result[s]) histDates.push(s); d.setDate(d.getDate() + 1); } }
    if (histDates.length) {
      const tripSY = parseInt(histDates[0].slice(0, 4));
      const tripEY = parseInt(histDates[histDates.length - 1].slice(0, 4));
      const totals = {};
      for (let yOff = 1; yOff <= 3; yOff++) {
        const aS = histDates[0].replace(/^\d{4}/, String(tripSY - yOff));
        const aE = histDates[histDates.length - 1].replace(/^\d{4}/, String(tripEY - yOff));
        if (aE >= todayStr) continue;
        try {
          const d = await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
            `&daily=temperature_2m_max,temperature_2m_min,weather_code` +
            `&start_date=${aS}&end_date=${aE}&temperature_unit=fahrenheit`).then(r => r.json());
          if (!d.daily) continue;
          d.daily.time.forEach((archDate, i) => {
            const mapped = archDate.replace(/^\d{4}/, String(parseInt(archDate.slice(0, 4)) + yOff));
            if (!histDates.includes(mapped)) return;
            if (!totals[mapped]) totals[mapped] = { mx: 0, mn: 0, codes: [], n: 0 };
            totals[mapped].mx += Math.round(d.daily.temperature_2m_max[i]);
            totals[mapped].mn += Math.round(d.daily.temperature_2m_min[i]);
            totals[mapped].codes.push(d.daily.weather_code[i]);
            totals[mapped].n++;
          });
        } catch (e) {}
      }
      for (const [date, t] of Object.entries(totals)) {
        if (t.n > 0) result[date] = { maxT: Math.round(t.mx / t.n), minT: Math.round(t.mn / t.n), code: t.codes[Math.floor(t.codes.length / 2)], hist: true };
      }
    }
  }
  return result;
}

// Build ordered per-day array across all locations for a trip capsule.
async function buildTripWeather(capsule) {
  if (!capsule.start_date || !capsule.end_date) return [];
  const locs = capsule.locations || [];
  if (!locs.length) return [];

  const dates = [];
  { let d = new Date(capsule.start_date + "T00:00:00"), e = new Date(capsule.end_date + "T00:00:00");
    while (d <= e) { dates.push(localISO(d)); d.setDate(d.getDate() + 1); } }
  if (!dates.length) return [];

  function locForDate(ds) {
    const specific = locs.filter(l => l.from && l.to && ds >= l.from && ds <= l.to);
    if (specific.length) return specific[specific.length - 1];
    const partial = locs.find(l => (l.from && !l.to && ds >= l.from) || (!l.from && l.to && ds <= l.to));
    if (partial) return partial;
    return locs.find(l => !l.from && !l.to) || locs[0];
  }

  // Group consecutive dates sharing the same location
  const groups = [];
  let curKey = null, curLoc = null, curDates = [];
  for (const ds of dates) {
    const loc = locForDate(ds);
    const key = loc ? `${loc.lat},${loc.lon}` : null;
    if (key !== curKey) {
      if (curDates.length && curLoc) groups.push({ loc: curLoc, dates: curDates });
      curKey = key; curLoc = loc; curDates = [ds];
    } else { curDates.push(ds); }
  }
  if (curDates.length && curLoc) groups.push({ loc: curLoc, dates: curDates });

  // Fetch weather per group in parallel
  const fetched = await Promise.all(groups.map(async g => {
    const wx = await fetchWeatherRange(g.loc.lat, g.loc.lon, g.dates[0], g.dates[g.dates.length - 1]);
    return { g, wx };
  }));

  const days = [];
  for (const { g, wx } of fetched) {
    g.dates.forEach((ds, i) => {
      const w = wx[ds];
      days.push({ date: ds, maxT: w ? w.maxT : null, minT: w ? w.minT : null, code: w ? w.code : null, hist: w ? w.hist : false, locName: g.loc.name, firstOfLoc: i === 0 });
    });
  }
  return days;
}

function weatherStripHtml(days) {
  const multiLoc = new Set(days.map(d => d.locName)).size > 1;
  let html = '<div class="wx-days">';
  let prevLoc = null;
  for (const day of days) {
    if (multiLoc && day.locName !== prevLoc && prevLoc !== null) {
      const city = day.locName.split(",")[0];
      html += `<div class="wx-loc-card"><div class="wx-loc-arrow">→</div><div class="wx-loc-lbl">${esc(city)}</div></div>`;
    }
    prevLoc = day.locName;
    const dateObj = new Date(day.date + "T00:00:00");
    const dow = dateObj.toLocaleDateString(undefined, { weekday: "short" });
    const md = dateObj.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
    const temps = day.maxT != null ? `${day.maxT}° / ${day.minT}°` : "—";
    html += `<div class="wx-day${day.hist ? " hist" : ""}">
      <div class="wx-date">${esc(dow)}</div>
      <div class="wx-date">${esc(md)}</div>
      <div class="wx-icon">${wmoEmoji(day.code)}</div>
      <div class="wx-temps">${esc(temps)}</div>
      ${day.hist ? `<div class="wx-hist-lbl">avg</div>` : ""}
    </div>`;
  }
  html += '</div>';
  return html;
}

async function loadTripWeather(capsule) {
  const cached = _wxCache[capsule.id];
  if (cached && Date.now() - cached.ts < WX_TTL) { _patchWeatherStrip(cached.days); return; }
  try {
    const days = await buildTripWeather(capsule);
    _wxCache[capsule.id] = { days, ts: Date.now() };
    _patchWeatherStrip(days);
  } catch (e) { const el = $("#wxStrip"); if (el) el.innerHTML = ""; }
}
function _patchWeatherStrip(days) {
  const el = $("#wxStrip");
  if (!el) return;
  el.innerHTML = days.length ? `<div class="wx-strip">${weatherStripHtml(days)}</div>` : "";
}

// ---- location add sheet ----
function openLocationSheet(cid) {
  const c = capsuleById.get(cid);
  _locSheet = { cid, step: "search", searchQ: "", results: [], loc: null,
    from: (c && c.start_date) || "", to: (c && c.end_date) || "" };
  _renderLocSheet();
  showSheet("logSheet");
}
function closeLocationSheet() { _locSheet = null; hideSheet("logSheet"); }

function _renderLocSheet() {
  const s = _locSheet;
  if (!s) return;
  if (s.step === "search") {
    const rows = s.results.map((r, i) => {
      const sub = [r.admin1, r.country].filter(Boolean).join(", ");
      return `<div class="loc-result" data-loc-idx="${i}">
        <span class="loc-result-pin">📍</span>
        <div><div class="loc-result-name">${esc(r.name)}</div>${sub ? `<div class="loc-result-sub">${esc(sub)}</div>` : ""}</div>
      </div>`;
    }).join("");
    $("#logInner").innerHTML = `
      <div class="sheet-hdr">
        <button class="lnk" id="locCancel">Cancel</button>
        <h2>Add location</h2>
        <span style="width:54px"></span>
      </div>
      <div class="loc-search-wrap">
        <input class="inp" id="locSearchInp" placeholder="Search city…" value="${esc(s.searchQ)}" autocomplete="off">
      </div>
      ${rows || (s.searchQ ? `<div style="padding:12px 0;color:var(--muted);font-size:14px">No results found</div>` : "")}`;
    const inp = $("#locSearchInp");
    if (inp) {
      inp.focus();
      let timer;
      inp.oninput = () => {
        _locSheet.searchQ = inp.value;
        clearTimeout(timer);
        if (!inp.value.trim()) { _locSheet.results = []; _renderLocSheet(); return; }
        timer = setTimeout(async () => {
          try { _locSheet.results = await geocodeLocation(inp.value.trim()); } catch (e) { _locSheet.results = []; }
          if (_locSheet && _locSheet.step === "search") _renderLocSheet();
        }, 380);
      };
    }
    $("#locCancel").onclick = closeLocationSheet;
    $("#logInner").querySelectorAll("[data-loc-idx]").forEach(el => {
      el.onclick = () => {
        const r = _locSheet.results[+el.dataset.locIdx];
        const city = r.name + ([r.admin1, r.country].filter(Boolean).length ? `, ${[r.admin1, r.country].filter(Boolean)[0]}` : "");
        _locSheet.loc = { name: city, lat: r.lat, lon: r.lon };
        _locSheet.step = "range";
        _renderLocSheet();
      };
    });
  } else {
    const s = _locSheet;
    const c = capsuleById.get(s.cid);
    const hasOthers = (c && (c.locations || []).length > 0);
    $("#logInner").innerHTML = `
      <div class="sheet-hdr">
        <button class="lnk" id="locBack">← Back</button>
        <h2>${esc(s.loc.name.split(",")[0])}</h2>
        <span style="width:54px"></span>
      </div>
      <div style="padding:14px 0 8px">
        <div style="font-size:15px;font-weight:600;margin-bottom:16px">📍 ${esc(s.loc.name)}</div>
        <label class="fld">From</label>
        <input class="inp" type="date" id="locFrom" value="${esc(s.from)}" ${c && c.start_date ? `min="${esc(c.start_date)}"` : ""} ${c && c.end_date ? `max="${esc(c.end_date)}"` : ""}>
        <label class="fld" style="margin-top:12px">To</label>
        <input class="inp" type="date" id="locTo" value="${esc(s.to)}" ${c && c.start_date ? `min="${esc(c.start_date)}"` : ""} ${c && c.end_date ? `max="${esc(c.end_date)}"` : ""}>
        <div style="font-size:12px;color:var(--muted);margin-top:8px">Leave as-is if this location covers the whole trip.</div>
        <button class="btn" id="locSave" style="margin-top:16px">Save location</button>
      </div>`;
    const fromEl = $("#locFrom"), toEl = $("#locTo");
    if (fromEl) fromEl.onchange = () => { _locSheet.from = fromEl.value; };
    if (toEl) toEl.onchange = () => { _locSheet.to = toEl.value; };
    $("#locBack").onclick = () => { _locSheet.step = "search"; _renderLocSheet(); };
    $("#locSave").onclick = _saveLocation;
  }
}

async function _saveLocation() {
  const s = _locSheet;
  if (!s || !s.loc) return;
  const c = capsuleById.get(s.cid);
  if (!c) return;
  const locs = [...(c.locations || [])];
  // Store null when dates match trip start/end (means "whole trip"); store specific value when different
  const from = (s.from && s.from !== (c.start_date || "")) ? s.from : null;
  const to   = (s.to   && s.to   !== (c.end_date   || "")) ? s.to   : null;
  locs.push({ name: s.loc.name, lat: s.loc.lat, lon: s.loc.lon, from, to });
  closeLocationSheet();
  try {
    await rest(`/capsules?id=eq.${s.cid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locations: locs }) });
    c.locations = locs;
    delete _wxCache[s.cid]; // invalidate cache
    renderCapsules();
    toast("Location added");
  } catch (e) { toast(e.message); }
}

/* ---- "Where you've been" sheet (Round D) -----------------------------------
   Same two-step shape as the trip location sheet above (search a city, then
   give it dates), but it writes to kv `wherelog` instead of a capsule — these
   are past trips that never existed as capsules, logged purely so the weather
   history can be corrected. */
let _whereSheet = null;  // {step:"search"|"range", searchQ, results, loc, from, to}

function openWhereSheet({ from = "", to = "" } = {}) {
  _whereSheet = { step: "search", searchQ: "", results: [], loc: null, from, to };
  _renderWhereSheet();
  showSheet("whereSheet");
}
function closeWhereSheet() { _whereSheet = null; hideSheet("whereSheet"); }

function _renderWhereSheet() {
  const s = _whereSheet;
  if (!s) return;
  if (s.step === "search") {
    const rows = s.results.map((r, i) => {
      const sub = [r.admin1, r.country].filter(Boolean).join(", ");
      return `<div class="loc-result" data-where-idx="${i}">
        <span class="loc-result-pin">📍</span>
        <div><div class="loc-result-name">${esc(r.name)}</div>${sub ? `<div class="loc-result-sub">${esc(sub)}</div>` : ""}</div>
      </div>`;
    }).join("");
    $("#whereInner").innerHTML = `
      <div class="sheet-hdr">
        <button class="lnk" id="whereCancel">Cancel</button>
        <h2>Where were you?</h2>
        <span style="width:54px"></span>
      </div>
      <div class="loc-search-wrap">
        <input class="inp" id="whereSearchInp" placeholder="Search city…" value="${esc(s.searchQ)}" autocomplete="off">
      </div>
      ${rows || (s.searchQ ? `<div style="padding:12px 0;color:var(--muted);font-size:14px">No results found</div>` : "")}`;
    const inp = $("#whereSearchInp");
    if (inp) {
      inp.focus();
      let timer;
      inp.oninput = () => {
        _whereSheet.searchQ = inp.value;
        clearTimeout(timer);
        if (!inp.value.trim()) { _whereSheet.results = []; _renderWhereSheet(); return; }
        timer = setTimeout(async () => {
          try { _whereSheet.results = await geocodeLocation(inp.value.trim()); } catch (e) { _whereSheet.results = []; }
          if (_whereSheet && _whereSheet.step === "search") _renderWhereSheet();
        }, 380);
      };
    }
    $("#whereCancel").onclick = closeWhereSheet;
    $("#whereInner").querySelectorAll("[data-where-idx]").forEach(el => {
      el.onclick = () => {
        const r = _whereSheet.results[+el.dataset.whereIdx];
        const extra = [r.admin1, r.country].filter(Boolean);
        _whereSheet.loc = { name: r.name + (extra.length ? `, ${extra[extra.length - 1]}` : ""), lat: r.lat, lon: r.lon };
        _whereSheet.step = "range";
        _renderWhereSheet();
      };
    });
  } else {
    const t = todayStr();
    $("#whereInner").innerHTML = `
      <div class="sheet-hdr">
        <button class="lnk" id="whereBack">← Back</button>
        <h2>${esc(s.loc.name.split(",")[0])}</h2>
        <span style="width:54px"></span>
      </div>
      <div style="padding:14px 0 8px">
        <div style="font-size:15px;font-weight:600;margin-bottom:16px">📍 ${esc(s.loc.name)}</div>
        <label class="fld">From</label>
        <input class="inp" type="date" id="whereFrom" value="${esc(s.from)}" max="${esc(t)}">
        <label class="fld" style="margin-top:12px">To</label>
        <input class="inp" type="date" id="whereTo" value="${esc(s.to)}" max="${esc(t)}">
        <div style="font-size:12px;color:var(--muted);margin-top:8px">Anything you wore on these days will be re-checked against the weather there, not here.</div>
        <button class="btn" id="whereSave" style="margin-top:16px">Save</button>
      </div>`;
    $("#whereFrom").onchange = e => { _whereSheet.from = e.target.value; };
    $("#whereTo").onchange = e => { _whereSheet.to = e.target.value; };
    $("#whereBack").onclick = () => { _whereSheet.step = "search"; _renderWhereSheet(); };
    $("#whereSave").onclick = _saveWhere;
  }
}

async function _saveWhere() {
  const s = _whereSheet;
  if (!s || !s.loc) return;
  if (!s.from || !s.to) return toast("Pick both dates");
  if (s.from > s.to) return toast("That range ends before it starts");
  if (s.to > todayStr()) return toast("That's in the future — log it as a trip instead");
  const entry = { from: s.from, to: s.to, name: s.loc.name, lat: s.loc.lat, lon: s.loc.lon };
  closeWhereSheet();
  try {
    await kvSet(WHERELOG_KEY, [...wherelog(), entry]);
    renderSettings();
    toast("Saved");
    correctAwayWeather(entry);            // fire-and-forget; re-renders when done
  } catch (e) { toast(e.message); }
}

async function removeWhereEntry(idx) {
  const list = [...wherelog()];
  if (idx < 0 || idx >= list.length) return;
  list.splice(idx, 1);
  try { await kvSet(WHERELOG_KEY, list); renderSettings(); }
  catch (e) { toast(e.message); }
}

// Settings list: everywhere the app thinks she was, trips included.
function whereListHtml() {
  const fmt = d => new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const log = wherelog();
  const rows = awayRanges().sort((a, b) => (a.from < b.from ? 1 : -1)).map(r => {
    const idx = r.src === "log" ? log.findIndex(e => e.from === r.from && e.to === r.to && e.name === r.name) : -1;
    return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--line)">
      <div style="flex:1;min-width:0">
        <div style="font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name)}</div>
        <div class="muted" style="font-size:11.5px">${esc(fmt(r.from))} – ${esc(fmt(r.to))}${r.src === "trip" ? " · from trip" : ""}</div>
      </div>
      ${idx >= 0 ? `<button class="cap-chip" data-where-del="${idx}" style="font-size:12px;flex:none;color:var(--muted)">✕</button>` : ""}
    </div>`;
  }).join("");
  return rows || `<div class="muted" style="font-size:13px;padding:4px 0">Nothing logged yet.</div>`;
}

async function removeLocation(cid, idx) {
  const c = capsuleById.get(cid);
  if (!c) return;
  const locs = [...(c.locations || [])];
  locs.splice(idx, 1);
  try {
    await rest(`/capsules?id=eq.${cid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locations: locs }) });
    c.locations = locs;
    delete _wxCache[cid];
    renderCapsules();
  } catch (e) { toast(e.message); }
}

