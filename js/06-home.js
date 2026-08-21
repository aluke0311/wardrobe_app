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
    kvUpdate("wxlog", prev => {                       // fire-and-forget
      const log = { ...(prev || {}) };
      log[today] = { maxT: wx.maxT, minT: wx.minT, code: wx.code };
      const cut = shiftDate(today, -WXLOG_DAYS);
      for (const d of Object.keys(log)) if (d < cut) delete log[d];
      return log;
    });
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
const WHERELOG_KEY = "wherelog";

const wxLog = () => kvData.get("wxlog") || {};

/* ---- WHERE YOU WERE (Round D, 2026-07-25) ---------------------------------
   The log above is reconstructed at her HOME coordinates for every date, so a
   day spent somewhere else is recorded with weather she never experienced —
   St Lucia at Christmas reads as a Minnesota December. That corrupts the item
   temperature profiles, the season tags derived from them, and any attempt to
   flag the two contradicting each other. `awayRanges()` is the single reader
   of where she actually was: dated trips that carry coordinates, plus ranges
   she enters by hand (most of her travel predates the app). */
const wherelog = () => kvData.get(WHERELOG_KEY) || [];
let _wxAudit = null;   // season-vs-weather flag cache; see buildSeasonWxFlags

function awayRanges(log = null, caps = null) {
  const out = [];
  for (const c of (caps || capsules).filter(isDatedTrip)) {
    const locs = (c.locations || []).filter(l => l && l.lat != null && l.lon != null);
    if (!locs.length) continue;
    // Several locations that all left their own dates blank can't be pinned to
    // days. Leave those days uncorrectable rather than guessing a climate.
    if (locs.length > 1 && !locs.some(l => l.from || l.to)) continue;
    for (const l of locs) {
      const from = l.from && l.from > c.start_date ? l.from : c.start_date;
      const to   = l.to   && l.to   < c.end_date   ? l.to   : c.end_date;
      if (from > to) continue;
      out.push({ from, to, name: l.name || c.name, lat: l.lat, lon: l.lon, src: "trip" });
    }
  }
  // Hand-entered ranges come last so they win where they overlap a trip.
  for (const r of (log || wherelog())) {
    if (!r || !r.from || !r.to || r.lat == null || r.lon == null) continue;
    out.push({ from: r.from, to: r.to, name: r.name || "Away", lat: r.lat, lon: r.lon, src: "log" });
  }
  return out;
}
const awayRangeFor = (date, ranges) => ranges.find(r => date >= r.from && date <= r.to) || null;

/* Merge a `fetchWeatherRange` result into the log. Pure — no globals — so the
   selftest can drive it. `keepAfter` protects days already logged live from
   being rewritten by a forecast of the same day; an AWAY fetch ignores that
   guard, because on a day she was elsewhere the home reading is wrong by
   construction, however recently it was taken. */
/* A day stored as exactly 0°/0° is the null-artifact described in _wxDay, not
   weather — max AND min landing on precisely zero effectively doesn't happen.
   Dropping them lets a re-run of the backfill refill them properly, and if the
   archive genuinely has nothing, absent is the correct end state. */
const isNullWxDay = (e) => !!e && e.maxT === 0 && e.minT === 0;

function purgeNullWxDays(log) {
  const out = {};
  let n = 0;
  for (const [d, e] of Object.entries(log || {})) {
    if (isNullWxDay(e)) { n++; continue; }
    out[d] = e;
  }
  return { log: out, n };
}

function mergeWxDays(log, fetched, { today, keepAfter = null, away = false, loc = null, floor = null } = {}) {
  const out = { ...log };
  let n = 0;
  for (const [d, wx] of Object.entries(fetched || {})) {
    if (d > today || wx.maxT == null) continue;
    if (!away && out[d] && keepAfter && d > keepAfter) continue;
    if (floor && d < floor) continue;
    const e = { maxT: wx.maxT, minT: wx.minT, code: wx.code };
    if (away) { e.away = 1; if (loc) e.loc = loc; }
    out[d] = e;
    n++;
  }
  if (floor) for (const d of Object.keys(out)) if (d < floor) delete out[d];
  return { log: out, n };
}

// One-shot. Idempotent: re-running only fills gaps, upgrades forecasts, and
// re-corrects any day she has since told us she was away for.
async function backfillWxLog() {
  const days = [...new Set(wears.map(w => w.worn_on).filter(Boolean))].sort();
  if (!days.length) throw new Error("No wears logged yet");
  const today = todayStr();
  const floor = shiftDate(today, -WXLOG_DAYS);
  const start = days[0] > floor ? days[0] : floor;
  const loc = await getHomeLocation();
  if (!loc) throw new Error("Location is off — can't look up past weather");
  const res = await fetchWeatherRange(loc.lat, loc.lon, start, today);
  // Clear any 0°/0° null-artifacts first so this pass can refill them.
  const cleaned = purgeNullWxDays(wxLog());
  // Anything logged live in the last 15 days came from a FORECAST; ERA5 is
  // observed, so it wins on older days and leaves the recent ones alone.
  let { log, n } = mergeWxDays(cleaned.log, res, { today, keepAfter: shiftDate(today, -15), floor });
  // Second pass: every window she was somewhere else gets that place's real
  // weather, overwriting the home reading this first pass just wrote.
  for (const r of awayRanges()) {
    const from = r.from > start ? r.from : start;
    const to = r.to < today ? r.to : today;
    if (from > to) continue;
    try {
      const away = await fetchWeatherRange(r.lat, r.lon, from, to);
      const m = mergeWxDays(log, away, { today, away: true, loc: r.name, floor });
      log = m.log; n += m.n;
    } catch (e) { /* one unreachable place shouldn't lose the whole backfill */ }
  }
  // Per-DAY merge, not a clobber: keep any day another device logged while
  // this backfill was running, and let our computed days win where both exist.
  await kvUpdate("wxlog", prev => ({ ...(prev || {}), ...log }));
  await kvSet(WX_BACKFILL_KEY, today);   // a plain date marker — no prior state to lose
  return n;
}

/* Undo a location answer: put HOME weather back over its span. Without this a
   correction outlives the answer that justified it — deleting a "Where you've
   been" entry left its days still flagged `away` with another climate's
   temperatures, which is worse than never having entered it.
   ⚠️ Overlaps matter: after reverting we re-apply every REMAINING away range
   that touches the span, so deleting one of two overlapping answers doesn't
   silently wipe the survivor. */
async function revertAwayWeather(r) {
  if (!r || !r.from || !r.to) return 0;
  const today = todayStr();
  const floor = shiftDate(today, -WXLOG_DAYS);
  const from = r.from > floor ? r.from : floor;
  const to = r.to < today ? r.to : today;
  if (from > to) return 0;
  const home = await getHomeLocation();
  if (!home) return 0;
  try {
    const res = await fetchWeatherRange(home.lat, home.lon, from, to);
    // away:false, so the rebuilt entries carry no away flag or location.
    const { log, n } = mergeWxDays(wxLog(), res, { today, floor });
    let out = log;
    for (const other of awayRanges()) {
      if (other.to < from || other.from > to) continue;
      const oF = other.from > from ? other.from : from;
      const oT = other.to < to ? other.to : to;
      if (oF > oT) continue;
      try {
        const back = await fetchWeatherRange(other.lat, other.lon, oF, oT);
        out = mergeWxDays(out, back, { today, away: true, loc: other.name, floor }).log;
      } catch (e) { /* leave those days as home rather than lose the revert */ }
    }
    await kvUpdate("wxlog", prev => ({ ...(prev || {}), ...out }));
    _wxAudit = null;
    _seasonBands = null;
    return n;
  } catch (e) { return 0; }
}

// Correct one newly-added away range on its own — the whole backfill is a lot
// of network for a range she just typed in.
async function correctAwayWeather(r) {
  if (!r || r.lat == null) return 0;
  const today = todayStr();
  const floor = shiftDate(today, -WXLOG_DAYS);
  const from = r.from > floor ? r.from : floor;
  const to = r.to < today ? r.to : today;
  if (from > to) return 0;
  try {
    const res = await fetchWeatherRange(r.lat, r.lon, from, to);
    const { log, n } = mergeWxDays(wxLog(), res, { today, away: true, loc: r.name, floor });
    await kvUpdate("wxlog", prev => ({ ...(prev || {}), ...log }));
    if (n) {
      _wxAudit = null;
      toast(`Weather corrected for ${n} day${n === 1 ? "" : "s"}`);
      if (activeTabName() === "settings") renderSettings();
    }
    return n;
  } catch (e) { return 0; }
}

// Past wear-days that felt like `wx`. Args are injectable so selftest can drive it.
function similarDays(wx, { contexts = null, limit = 4, excludeDays = 14,
                           log = null, dayMap = null, today = null, ranges = null } = {}) {
  if (!wx || wx.maxT == null) return [];
  const L = log || wxLog();
  const dm = dayMap || wearDayMap();
  const t = today || todayStr();
  const cutoff = shiftDate(t, -excludeDays);
  const want = contexts && contexts.length ? new Set(contexts) : null;
  const wet = wmoIsWet(wx.code);
  /* Round D supersedes the old blanket trip-exclusion. That rule existed
     because a trip day's weather was recorded at HOME, so matching on it
     compared a Caribbean outfit against a Minnesota reading. Once a day has
     been corrected to where she actually was, 78° in St Lucia is honest
     precedent for 78° here. What stays excluded is a day we KNOW was away and
     could not correct — an undated location, or a trip she hasn't logged. */
  const away = ranges || awayRanges();
  const out = [];
  for (const [date, rows] of dm) {
    if (date > cutoff) continue;                 // too recent — she remembers it
    const e = L[date];
    if (!e || e.maxT == null || isNullWxDay(e)) continue;
    if (!e.away && awayRangeFor(date, away)) continue;
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
      maxT: e.maxT, minT: e.minT, code: e.code, loc: e.away ? (e.loc || null) : null,
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
// Round D needed no change here: away days now carry the temperature she was
// actually in, so they count toward the band on purpose — a sundress worn at
// 84° in December is real evidence about that sundress.
const WX_PROFILE_MIN = 5;
function itemWxProfile(itemId, log = null) {
  const L = log || wxLog();
  const temps = [...new Set(wears.filter(w => w.item_id === itemId).map(w => w.worn_on))]
    .map(d => L[d]).filter(e => e && e.maxT != null && !isNullWxDay(e)).map(e => e.maxT).sort((a, b) => a - b);
  if (temps.length < WX_PROFILE_MIN) return null;
  const at = f => temps[Math.min(temps.length - 1, Math.max(0, Math.round(f * (temps.length - 1))))];
  return { lo: at(0.1), hi: at(0.9), n: temps.length };
}

/* ---- SEASON BANDS (Round D) ------------------------------------------------
   What each season actually FEELS like where she lives, derived from her own
   weather history rather than hardcoded. A Minneapolis winter and an Atlanta
   winter get different numbers for free, and the bands re-fit themselves as
   the log grows. Away days are excluded — they describe somewhere else. */
const SEASON_BAND_MIN = 15;   // days below this and the season has no opinion
const SEASON_BAND_TRIM = 35;  // °F from the median past which a day isn't this climate
let _seasonBands = null, _seasonBandsFor = null;

function seasonBands(log = null) {
  const L = log || wxLog();
  if (!log && _seasonBands && _seasonBandsFor === L) return _seasonBands;
  const by = {};
  for (const s of SEASONS) by[s] = [];
  for (const [d, e] of Object.entries(L)) {
    if (!e || e.away || e.maxT == null || isNullWxDay(e)) continue;
    const s = seasonOf(d);
    if (by[s]) by[s].push(e.maxT);
  }
  const out = {};
  for (const s of SEASONS) {
    let a = by[s].sort((x, y) => x - y);
    if (a.length < SEASON_BAND_MIN) { out[s] = null; continue; }
    /* Trim around the median before taking percentiles. Away days she hasn't
       logged yet are still in here recorded as home weather, and they land far
       from the rest — left in, a single warm-December trip drags the Winter
       p90 up to its own temperature and the band quietly stops flagging the
       very days that poisoned it. The median survives that (it takes >50% to
       move), so it's the anchor. The window is deliberately generous: a real
       cold snap or heat wave stays, another climate doesn't. */
    const med = a[Math.floor(a.length / 2)];
    const trimmed = a.filter(v => Math.abs(v - med) <= SEASON_BAND_TRIM);
    if (trimmed.length >= SEASON_BAND_MIN) a = trimmed;
    const at = f => a[Math.min(a.length - 1, Math.max(0, Math.round(f * (a.length - 1))))];
    out[s] = { p10: at(0.1), p25: at(0.25), median: at(0.5), p75: at(0.75), p90: at(0.9), n: a.length };
  }
  if (!log) { _seasonBands = out; _seasonBandsFor = L; }
  return out;
}

/* The season a wear-day should COUNT AS. On a day she was away, the calendar
   lies about what she dressed for — a Christmas in St Lucia is a summer day in
   every way that matters to a wardrobe — so an away day is re-labelled with
   the home season its temperature most resembles. */
// Which season a temperature feels like here. Null when no band is usable yet.
function seasonForTemp(t, bands) {
  let best = null, bestD = Infinity;
  for (const s of SEASONS) {
    if (!bands[s]) continue;
    const d = Math.abs(t - bands[s].median);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

function effectiveSeasonOf(dateStr, log = null, bands = null) {
  const L = log || wxLog();
  const e = L[dateStr];
  if (!e || !e.away || e.maxT == null || isNullWxDay(e)) return seasonOf(dateStr);
  return seasonForTemp(e.maxT, bands || seasonBands(log)) || seasonOf(dateStr);
}

/* ---- SEASON vs WEATHER (Round D.4, 2026-07-25) -----------------------------
   Her ask, finally reduced to it: flag a piece whose season tag disagrees with
   the weather she actually wears it in, and make the flag its own fix.

   ⚠️ This replaced a much larger machine. r14–r18 also tried to GUESS where she
   had been — day-level outfit anomalies, greedy trip clustering, home marks, an
   audit sheet, a day-by-day view — and that layer generated a patch round per
   day of real use before she called it: "this whole feature set feels like a
   mess." It was. She had asked to ENTER her travel, not to have it inferred, so
   the inference is gone. Do not rebuild it "to help": a wrong guess costs more
   trust than hand-entry costs taps (locked decision, 2026-07-25).

   THE ONE CRITERION (hers): compare the piece's COMMONLY-WORN range against the
   GENERAL range of each season it claims. Overlap with any of them = no flag,
   full stop. This kills unactionable flags structurally rather than by
   suppression — a piece can't be accused of contradicting a season it plainly
   gets worn in — and it needs no tuned margins, which is what the previous two
   constructions kept getting wrong. */
const WXA_OK_KEY = "wxaudit_ok";    // {itemId: JSON.stringify(items.season)} — dismissals

// The middle half of the temperatures a piece actually goes out in. Quartiles,
// not min/max: one freak day shouldn't define "commonly worn".
function pieceCommonRange(itemId, log = null, rows = null) {
  const L = log || wxLog();
  const days = [...new Set((rows || wears).filter(w => w.item_id === itemId).map(w => w.worn_on))];
  const t = days.map(d => L[d]).filter(e => e && e.maxT != null && !isNullWxDay(e))
    .map(e => e.maxT).sort((a, b) => a - b);
  if (t.length < WX_PROFILE_MIN) return null;
  const at = f => t[Math.min(t.length - 1, Math.max(0, Math.round(f * (t.length - 1))))];
  return { lo: at(0.25), hi: at(0.75), n: t.length };
}

// A season's general range = the band's p10–p90. Null when the season has too
// few days on record to have an opinion (seasonBands' own floor).
const seasonGeneralRange = (s, bands) => (bands[s] ? { lo: bands[s].p10, hi: bands[s].p90 } : null);
const _rangesOverlap = (a, b) => !!a && !!b && a.lo <= b.hi && b.lo <= a.hi;

function buildSeasonWxFlags({ pool = null, wearRows = null, log = null, bands = null,
                              dismissed = null } = {}) {
  const L = log || wxLog();
  const B = bands || seasonBands(log);
  const OK = dismissed || kvData.get(WXA_OK_KEY) || {};
  const rows = wearRows || wears;
  const list = pool || items.filter(i => itemStatus(i) === "Available");
  const flags = [];

  for (const i of list) {
    if (!i.season || !i.season.length) continue;   // no claim = nothing to contradict
    if (OK[i.id] === JSON.stringify(i.season)) continue;
    const claimed = i.season.filter(s => SEASONS.includes(s));
    if (!claimed.length) continue;
    const common = pieceCommonRange(i.id, L, rows);
    if (!common) continue;                          // not worn enough to have a habit

    const claimedRanges = claimed.map(s => seasonGeneralRange(s, B)).filter(Boolean);
    if (!claimedRanges.length) continue;            // no usable band = no opinion
    if (claimedRanges.some(r => _rangesOverlap(common, r))) continue;   // it fits — done

    // It fits none of them. Which seasons DOES it fit? That's the proposal, and
    // no proposal means no flag (r18's rule, kept: an unactionable warning is
    // worse than silence).
    const fit = SEASONS.filter(s => _rangesOverlap(common, seasonGeneralRange(s, B)));
    const missing = fit.filter(s => !claimed.includes(s));
    if (!missing.length) continue;

    const hottest = Math.max(...claimedRanges.map(r => r.hi));
    const coldest = Math.min(...claimedRanges.map(r => r.lo));
    const dir = common.lo > hottest ? "hot" : common.hi < coldest ? "cold" : "between";
    flags.push({
      id: i.id, name: i.name, image_path: i.image_path, season: claimed,
      common, band: [coldest, hottest], days: common.n, dir, fit, missing,
    });
  }
  return flags.sort((a, b) => b.days - a.days);
}

/* Session cache. ⚠️ The stamp is built from array LENGTHS, which an in-place
   season edit doesn't change — so `_wxAudit` is nulled explicitly in
   `saveField` (season), `correctAwayWeather`, `revertAwayWeather`, and both
   flag resolutions. Four sites; grep `_wxAudit = null`. */
function wxAuditFlags() {
  const stamp = `${wears.length}:${Object.keys(wxLog()).length}:${items.length}`;
  if (_wxAudit && _wxAudit.stamp === stamp) return _wxAudit.res;
  const res = dataReady ? buildSeasonWxFlags() : [];
  _wxAudit = { stamp, res };
  return res;
}
const wxFlagFor = (id) => wxAuditFlags().find(f => f.id === id) || null;

// The evidence and the fix in one sentence, both in the same currency.
function wxFlagText(f) {
  const s = f.season.join("/");
  const band = `your ${s.toLowerCase()} generally runs ${f.band[0]}°–${f.band[1]}°`;
  return `Commonly worn ${f.common.lo}°–${f.common.hi}° — ${band}. That's ${f.missing.join(" / ")} weather here.`;
}

// One tap: append the season(s) the weather points to, keeping what's there.
// Never removes — a piece may be right about Winter and also need Summer.
async function addFlagSeason(id, seasons) {
  const i = itemById.get(id);
  if (!i || !seasons.length) return;
  const next = [...new Set([...(i.season || []), ...seasons])];
  await saveField(id, "season", next);
  _wxAudit = null;
  toast(`${i.name || "Item"} is now ${next.join(" + ")}`);
}

// "It's fine" — keyed on the season signature, so editing the season re-arms it.
async function dismissWxFlag(id) {
  const i = itemById.get(id);
  if (!i) return;
  _wxAudit = null;
  try {
    await kvUpdate(WXA_OK_KEY, prev => ({ ...(prev || {}), [i.id]: JSON.stringify(i.season || []) }));
  } catch (e) { toast(e.message); }
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
      <div class="wa-name">${esc(when)} · ${d.maxT}°/${d.minT}°${d.loc ? ` · ${esc(d.loc.split(",")[0])}` : ""}</div>
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

/* ⚠️ THE NAV STRIP IS GONE (2026-08-21, her ask: "on the home screen I don't
   know why I have a row that just says closet # looks # etc. drop it — I have
   those tabs on the bottom").

   It is the last of the launcher grid. 2026-08-14 compressed five full-width
   tiles into one scrollable count row on the grounds that the tab bar already
   carried every destination and the COUNTS were the one thing it didn't. She
   has now answered that: the counts weren't worth a row either. Same
   destinations, same one tap, from the bar that is on screen permanently. */

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
// One release rendered as a dated block of bullets. Shared by the post-update
// sheet and the full changelog so the two can't format the same fact differently.
function releaseNoteHtml(rel, { lead = false } = {}) {
  return `<div style="padding:${lead ? "0" : "14px"} 0 2px">
    <div class="muted" style="font-size:12px;font-weight:600;letter-spacing:.02em">${esc(rel.v)}</div>
    ${(rel.notes || []).map(b => `<div style="display:flex;gap:10px;padding:7px 0;font-size:14.5px;line-height:1.45">
      <span style="color:var(--accent);flex:none">•</span><span>${esc(b)}</span>
    </div>`).join("")}
  </div>`;
}

function openWhatsNewSheet() {
  const head = RELEASE_NOTES[0] || { v: APP_VERSION, notes: WHATS_NEW };
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <span style="width:54px"></span>
      <h2>What's new</h2>
      <button class="lnk" id="wnDone" style="font-weight:700">Done</button>
    </div>
    <div style="padding:6px 22px 8px">${releaseNoteHtml(head, { lead: true })}</div>
    <div style="padding:0 22px 26px">
      <button class="lnk" id="wnAll" style="font-size:14px;font-weight:600;color:var(--accent);padding:6px 0">All updates →</button>
    </div>`;
  showSheet("logSheet");
  $("#wnDone").onclick = () => hideSheet("logSheet");
  $("#wnAll").onclick = () => openChangelogSheet();
}

/* The full history (2026-08-04 r1, her ask: "a new page with all the app
   updates so I can always see them"). Deliberately the whole array and not a
   recent slice — the point of keeping it is that it's still there in a year. */
function openChangelogSheet() {
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <span style="width:54px"></span>
      <h2>All updates</h2>
      <button class="lnk" id="clgDone" style="font-weight:700">Done</button>
    </div>
    <div class="muted" style="font-size:12.5px;padding:8px 22px 6px;line-height:1.45">Every release, newest first. You're on ${esc(APP_VERSION)}.</div>
    <div style="max-height:66vh;overflow-y:auto;padding:2px 22px 8px">
      ${RELEASE_NOTES.map((r, i) => (i ? `<div class="det-divider"></div>` : "") + releaseNoteHtml(r, { lead: i === 0 })).join("")}
    </div>
    <div style="height:max(env(safe-area-inset-bottom),20px)"></div>`;
  showSheet("logSheet");
  $("#clgDone").onclick = () => hideSheet("logSheet");
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
    /* ⚠️ THE PACK'S OUTFIT FOR TODAY IS GONE FROM THE DASH (2026-08-10 r6).
       It was read live from the stored solve, so with the solver switched off
       Home would have kept proposing today's outfit from a plan she never
       agreed to — on the one screen that is supposed to say what's actually
       happening. What's left here is what SHE planned. */
    planHtml = `<div class="td-plan">
      <div class="td-plan-lbl">Today${laundryDay ? " · 🧺 laundry day" : ""}</div>
      ${rows}
      ${rows ? "" : `<div class="muted" style="font-size:13.5px;padding:2px 0 4px">Nothing planned for today.</div>`}
    </div>`;
  }

  // Mid-trip: what's still in the suitcase, while there are days left to wear
  // it. tripUnwornNow owns the "should this be said at all" decision — on day 1
  // it's noise, on the last day it's a scold. Inventory, not a prompt: there's
  // deliberately no dismiss, because it goes away on its own.
  let unwornHtml = "";
  const un = phase === "trip" ? tripUnwornNow(c, today) : null;
  if (un) {
    unwornHtml = `<button class="td-laun" data-td-unworn>🧳
      <span style="flex:1">${un.unworn.length} of ${un.packed} still in the suitcase · ${un.left} day${un.left === 1 ? "" : "s"} left</span>
      <span style="color:var(--accent);font-weight:600">›</span></button>`;
  }

  /* ⚠️ THE MID-TRIP WASH ROW WENT WITH THE SOLVER (2026-08-10 r6). It re-ran
     `packSchedule` forward over the days left and named the pieces the back
     half of the trip would run short of — genuinely useful, and entirely
     derived from the stored solve. With nothing solving, it would be reporting
     shortages in a plan she isn't following. `mtw` stays declared as null so
     the hamper row below keeps its "don't say the same thing twice" fold. */
  const mtw = null;
  const washPlanHtml = "";

  // Suitcase hamper (works for every phase, incl. capsule mode).
  let launHtml = "";
  if (LAUNDRY_READY()) {
    const members = capsuleItems(c.id).filter(i => itemStatus(i) === "Available");
    const _ls = laundryState();
    const dirty = members.filter(i => isDirty(i, _ls));
    /* ⚠️ Don't say the same thing twice. The wash-plan row above is the
       ACTIONABLE version of this one ("wash the white tee" vs "1 piece is
       dirty"), so when it already names everything dirty, this row is noise
       sitting directly beneath it — visible the moment the dash is rendered and
       read, invisible in the code. Same instinct as the Home attention
       hierarchy: one row per thing she has to do. */
    const named = mtw ? new Set(mtw.items.map(i => i.id)) : null;
    const covered = named && dirty.length && dirty.every(i => named.has(i.id));
    if (!covered) {
      const verb = phase === "pack" ? "wash before you pack" : "in the hamper";
      launHtml = `<button class="td-laun" data-td-laundry>🧺
        <span style="flex:1">${dirty.length ? `${dirty.length} of ${members.length} pieces ${verb}` : `Suitcase is clean · ${members.length} pieces`}</span>
        <span style="color:var(--accent);font-weight:600">＋</span></button>`;
    }
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

  /* The morning question owns a primary button here too (her report: "I still
     need a 'what should I wear' button like I have on the home screen"). Home
     was exempted from it in trip mode on the grounds that the dash already had
     ✨ Suggest — but that was a small chip in a row of four, i.e. the same
     decision demoted to the same weight as "Packing list". Same wording, same
     shape, same scope as the chip it REPLACES (the suitcase pool), so there is
     still exactly one door to it. */
  const askHtml = `<button class="td-ask" data-td-suggest>What should I wear?</button>`;

  const chips = [
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
    ${unwornHtml}
    ${washPlanHtml}
    ${launHtml}
    ${askHtml}
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
    .filter(x => !isCapsuleArchived(x.id))   // archiving means "done asking me"
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

/* ---- TODAY, ON HOME -------------------------------------------------------
   ⚠️ THE PLANNING-AHEAD MACHINERY THAT USED TO LIVE HERE IS GONE (2026-08-21,
   her ask: "remove the planning ahead features entirely except for I want to be
   able to set an outfit for the future from the outfit suggester").

   What went: the Tomorrow card and the shared two-date `dayCardHtml`; the sticky
   generated pick (`kv "tmpick"`, `tomorrowGenPieces`, `openTomorrowRevise`) and
   its 📌 Keep / ✨ re-roll chips; the dropdown context chip
   (`quickCtxChipHtml` / `openQuickContextSheet`); the "📅 Plan the week ›"
   footer; and the "Something else to wear?" fold, whose whole job was to demote
   a generated suggestion once the day was logged.

   What survives is the part that was never planning: TODAY, and what she
   actually put on. If she planned today's outfit from the suggester, it shows up
   on that day in the CALENDAR — that is the one read surface she chose for
   future plans, and duplicating it here would put a second, competing answer to
   "what am I wearing" on the screen that already answers it from `wears`.

   ⚠️ The card renders only once something IS logged. Empty, it would say
   "nothing yet" directly above the "What should I wear?" and "Log today's wear"
   buttons that already say exactly that, twice.
   ⚠️ Still "" in trip mode: `tripDashHtml` IS today's card there.
   ⚠️ `kv "tmpick"` rows are now unread orphans on the live DB, deliberately not
   migrated — same call as `"wxaudit_home"` and the `"mend"` tag. */
function todayCardHtml() {
  if (!dataReady || tripModeId) return "";
  const tm = todayStr();
  const groups = dayGroups(tm);
  if (!groups.length) return "";
  const wx = _dpWx(tm);
  const wxBit = wx && wx.maxT != null ? ` \u00b7 ${wmoEmoji(wx.code)} ${wx.maxT}\u00b0/${wx.minT}\u00b0` : "";
  const hdr = `<div style="display:flex;align-items:center;justify-content:space-between;padding:2px 2px 8px">
    <div style="font-size:13px;font-weight:600;color:var(--muted)">Today \u00b7 ${esc(planDayLabel(tm))}${wxBit}</div>
  </div>`;
  const body = groups.map(g => {
    const o = g.outfitId ? outfitById.get(g.outfitId) : null;
    const pieces = g.itemIds.map(id => itemById.get(id)).filter(Boolean);
    const name = o ? outfitName(o) : `${pieces.length} piece${pieces.length === 1 ? "" : "s"}`;
    const ctxs = (g.context || []).join(", ");
    return `<button data-tm-worn="${esc(g.outfitId || "")}" data-tm-date="${esc(tm)}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:4px 0">
      <span style="width:48px;flex:none">${o ? outfitCollageHtml(o, 4) : _planThumbStrip(pieces)}</span>
      <span style="flex:1;min-width:0">
        <span style="display:block;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\u2713 ${esc(name)}</span>
        <span style="display:block;font-size:12px;color:var(--muted)">${esc(ctxs || "Worn today")}</span>
      </span>
      <svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:var(--muted);stroke-width:2;fill:none;flex:none"><path d="M9 6l6 6-6 6"/></svg>
    </button>`;
  }).join(`<div class="det-divider" style="margin:4px 0"></div>`);
  return `<div class="det-card" style="margin:10px 16px 0;padding:10px 12px">${hdr}${body}</div>`;
}
function _planThumbStrip(pieces) {
  // .cthumb is a fixed 64px — wrapping it in a smaller box made the thumbs
  // overlap each other and the caption below (2026-07-21). Own class instead.
  return `<div class="tm-strip">${pieces.slice(0, 4).map(p => thumbHtml(p.image_path, "tm-thumb")).join("")}</div>`;
}

/* ===================================================================
   PLAN THE WEEK  (2026-08-03)

   Her ask: "I want to be able to actually plan my week when I tap plan my
   week. Yes, set contexts — but then the option to tap through and actually
   plan the looks for the week, including the ability to understand what
   is/will be in laundry."

   What was there was seven rows that each punted to the day sheet, so the only
   thing you could do from "Plan the week" was open one day at a time. This is a
   real screen: contexts AND a look slot per day, and a laundry forecast across
   the whole week.

   ⚠️ SCHEDULE, DON'T DIVIDE — the same inversion the trip builder is built on.
   The forecast WALKS the seven days in date order with a running per-piece wear
   counter seeded from real history, rather than dividing planned wears by
   tolerance. That is what lets it say "the black jeans run out on THURSDAY"
   instead of "you have too many jeans days", and it is the only way a wash day
   placed mid-week can reset anything.
   ⚠️ It seeds from actual wear-days since last_washed, so a jean already at 4
   of 5 on Monday is one wear from the hamper all week. planRewearFlags fixed
   exactly this bug once already for trips.

   ⚠️ IT WARNS, IT DOES NOT FILTER. Suggestions for Thursday still draw from the
   normal pool; the card just says which pieces will be dirty by then. Silently
   removing them would be the invisible narrowing the December sundress bug was
   about, and she asked to UNDERSTAND the laundry, not to have it hidden.
   =================================================================== */
const WASHDAY_KEY = "washdays";
const WEEK_PLAN_DAYS = 7;
function washDayAll() { const v = kvData.get(WASHDAY_KEY); return v && typeof v === "object" ? v : {}; }
const isWashDay = (d, all = null) => !!(all || washDayAll())[d];

/* Pure (given its injectables) so the selftest can drive it.
   Returns { byDate: Map(date → [{item, n, tol}]), firstOverflow, suggestWash }. */
function weekLaundryForecast(dates, { plans = null, wearRows = null, today = null, washSet = null } = {}) {
  const all = plans || dayPlanAll();
  const rows = wearRows || wears;
  const now = today || todayStr();
  const wash = washSet || washDayAll();
  const start = dates[0];

  // item → Set(wear days), one pass.
  const dayMap = new Map();
  for (const w of rows) {
    if (!w.item_id || !w.worn_on) continue;
    let s = dayMap.get(w.item_id); if (!s) dayMap.set(w.item_id, s = new Set());
    s.add(w.worn_on);
  }
  // Seed: wear-days since the last wash that already happened, BEFORE the window.
  const counts = new Map();
  for (const [id, s] of dayMap) {
    const i = itemById.get(id);
    if (!i || !i.last_washed) continue;
    counts.set(id, [...s].filter(d => d > i.last_washed && d < start).length);
  }

  const byDate = new Map();
  const flagged = new Set();     // pieces already reported as run-out
  let firstOverflow = null;
  for (const date of dates) {
    if (isWashDay(date, wash)) { counts.clear(); flagged.clear(); }  // washed; the week starts over
    /* A day's pieces are the union of what she ACTUALLY wore (a fact, for today
       and any past day in the window) and what she's PLANNED. A Set, so a plan
       she has already fulfilled isn't counted twice. */
    const ids = new Set();
    if (date <= now) for (const w of rows) if (w.worn_on === date && w.item_id) ids.add(w.item_id);
    for (const e of (all[date] || [])) {
      const o = e.outfit ? outfitById.get(e.outfit) : null;
      if (o) for (const it of outfitItems(o)) ids.add(it.id);
    }
    const hits = [];
    for (const id of ids) {
      const i = itemById.get(id);
      if (!i) continue;
      const tol = wearTolerance(i);
      if (tol === Infinity) continue;          // shoes / outerwear never run out
      if (!i.last_washed) continue;            // not tracked yet
      const n = (counts.get(id) || 0) + 1;
      counts.set(id, n);
      /* ⚠️ Report a piece only on the day it FIRST runs out. Once it's over
         tolerance it stays over until a wash, so repeating it every day just
         restates one fact with a bigger number — found by rendering the screen
         and reading it, same lesson as the doubled hamper row in the trip dash.
         A wash day clears `flagged` with the counters, so a piece that runs out
         again after the wash is news again. */
      if (n > tol && !flagged.has(id)) {
        flagged.add(id);
        hits.push({ item: i, n, tol });
        if (!firstOverflow) firstOverflow = date;
      }
    }
    if (hits.length) byDate.set(date, hits);
  }
  /* The day to run a wash: the day BEFORE the first thing runs out, or that day
     itself when it's the first of the window (nothing earlier to suggest). */
  const suggestWash = firstOverflow && firstOverflow > dates[0]
    ? dates[dates.indexOf(firstOverflow) - 1] : firstOverflow;
  /* ⚠️ TWO DIFFERENT THRESHOLDS, and conflating them is easy.
     `byDate` flags `n > tol` — "wearing this that day means wearing something
     dirty", which is what the planner warns about. Whether a piece is IN THE
     HAMPER by a date is `n >= tol`, the same test isDirty uses. `endCounts` is
     exposed so plannedDirtyBy can ask the second question without re-walking
     the schedule and drifting from this one. */
  return { byDate, firstOverflow, suggestWash, endCounts: counts };
}

// One label for a week date, so the header and the cards can't disagree about
// what to call today (the header said "Mon, Aug 3" while the card said "Today").
function weekDayLabel(d, today = todayStr()) {
  if (d === today) return "today";
  if (d === shiftDate(today, 1)) return "tomorrow";
  return planDayLabel(d);
}

/* Pieces that will be AT OR OVER tolerance by `date`, given everything planned
   between now and then. The set the suggester must not offer when she's
   dressing a future day.

   ⚠️ This is the tank-top bug (reported 2026-08-03, after r4): she planned a
   tank top for one day and the app went on suggesting it for the NEXT day,
   because suggestibleClean() reads TODAY's laundry state. r4 deliberately made
   the week planner warn rather than filter — right for the planner's own
   cards, wrong for suggestions, where the app was actively recommending
   something it already knew would be dirty.

   ⚠️ The narrowing stays visible and reversible, same as the rack: the
   suggester's laundry chip reads "Clean on Thu" instead of "Clean only" when
   this is in play, and turning it off widens back in one tap. */
function plannedDirtyBy(date, { plans = null, wearRows = null, today = null, washSet = null } = {}) {
  const now = today || todayStr();
  if (!date || date <= now) return new Set();
  const dates = [];
  for (let d = now; d < date; d = shiftDate(d, 1)) dates.push(d);
  if (!dates.length) return new Set();
  /* Reuse the forecast walk rather than re-deriving it — one schedule, so the
     planner's warning and the suggester's filter can never disagree. The
     forecast reports a piece on the day it FIRST runs out, which is exactly the
     set that is still dirty on `date`. */
  const fc = weekLaundryForecast(dates, { plans, wearRows, today: now, washSet });
  /* Two populations, and the first is easy to forget: pieces that are ALREADY
     in the hamper stay there. The forecast only walks pieces that appear in a
     plan, so on its own it would call a dirty shirt clean simply because she
     hasn't planned it. */
  const out = new Set();
  const wash = washSet || washDayAll();
  const washedBefore = dates.some(d => isWashDay(d, wash));
  if (!washedBefore) for (const i of hamperItems()) out.add(i.id);
  /* ⚠️ `>= tol`, NOT the forecast's `> tol`. "Is it in the hamper by then" is
     the isDirty test; "would wearing it that day mean wearing something dirty"
     is one wear later. A tee at tolerance 1 planned for today IS dirty
     tomorrow — reading the planner's overflow flag here missed exactly that,
     which is the tank top she reported. */
  for (const [id, n] of fc.endCounts) {
    const i = itemById.get(id);
    if (i && n >= wearTolerance(i)) out.add(id);
  }
  return out;
}

/* ⚠️ "PLAN THE WEEK" IS GONE (2026-08-21) — the screen, its Month/Week mode bar,
   the per-day context and outfit slots, the 🧺 wash-day toggle and the kv
   entry point. Her ask was to remove the planning-ahead features entirely.

   The laundry FORECAST above survives on purpose and is not part of that: the
   suggester's "🧺 Clean on Thu · N out" chip is what asks it, so that a look
   planned for Thursday from the suggester isn't built out of things that will be
   in the hamper by Thursday. It is a derivation, not a screen.
   ⚠️ `washDayAll` therefore stays too, with no writer left — `weekLaundryForecast`
   reads it, and the stored `kv "washdays"` rows are unread orphans, deliberately
   not migrated. */

// Session-only: whether the folded Home attention rows are expanded. Not
// persisted — a fresh open should be calm again.
function renderHome() {
  const today = todayStr();
  const hasWearToday = dataReady && wearDayMap().has(today);
  // The morning question owns the primary button, permanently (2026-07-26 audit
  // C1). It used to be reachable ONLY through "Log today's wear" → wear-again
  // chooser → ✨ — three taps behind a verb she isn't doing yet, since at that
  // moment she's deciding, not recording. Worse, the CTA swapped to the quiet
  // logged-row once the day was logged, so the path vanished exactly when she'd
  // want to change one piece in the evening. Deciding and logging are separate
  // intentions and now have separate buttons, both always present.
  // Trip mode is exempt: tripDashHtml owns the suitcase-scoped ✨ Suggest.
  // (Guarded on tripModeId, not on `tc` — that's declared ~40 lines below this
  // point and reading it here is a TDZ ReferenceError. Same guard the "On this
  // day" row uses.)
  const ask = (dataReady && !tripModeId)
    ? `<button class="log-cta" id="homeAsk">What should I wear?</button>` : "";
  // Logging is a small confirmation, not a decision — it takes the quiet row in
  // both states so the screen keeps ONE primary action.
  let cta = "";
  if (dataReady && !hasWearToday) {
    cta = `<button class="logged-row" id="homeLogCta">
      <span class="lr-check">＋</span><span class="lr-text">Log today's wear</span>
    </button>`;
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
  // Trip mode: the dashboard takes over the top of Home.
  const tc = dataReady ? tripCapsule() : null;
  const dash = tc ? tripDashHtml(tc) : (dataReady ? tripOfferHtml() : "");
  const catchup = dataReady ? catchupHtml() : "";
  // Backup staleness (E1): one tap runs the download right here.
  let bk = "";
  if (dataReady) {
    const last = lastBackupDate();
    if (!last || last <= shiftDate(todayStr(), -30)) {
      const ago = last ? `last backup ${Math.round((new Date(todayStr()) - new Date(last)) / 86400000)} days ago` : "no backup yet";
      bk = `<button class="logged-row" id="homeBackupRow" style="border:1px solid var(--line);background:var(--bg)">
        <span class="lr-check">🗄</span><span class="lr-text">Your data — ${esc(ago)}</span><span class="lr-plus">＋</span>
      </button>`;
    }
  }
  /* One-time weather backfill offer (Round C). This card is the real entry
     point — the Settings row exists only as a re-run hatch.

     ⚠️ `width:auto` on the "Not now" button is load-bearing. `.btn-sec` sets
     `width:100%`, and `flex:none` (= `flex: 0 0 auto`) takes its BASIS from that
     width — so the button claimed the entire 332px row and ran 41.6px past the
     right edge of a 390px screen, while "Look it up" was crushed to 62.6px and
     both labels wrapped to four lines. Measured 2026-08-13; with `width:auto`
     they are 227px / 97px and one line each.
     Same family as the `.log-cta` trap from the opposite direction: there a
     full-width button needed an explicit width, here a `width:100%` button in a
     flex row needs an explicit auto. */
  let wxb = "";
  if (dataReady && !kvData.get(WX_BACKFILL_KEY) && wears.length > 100
      && (store.getItem(WX_SNOOZE_KEY) || "") <= todayStr()) {
    wxb = `<div class="det-card" style="margin:10px 16px 0;padding:12px">
      <div style="font-size:13.5px;line-height:1.45">Match today's weather to what you actually wore — a one-time lookup of past weather for every day you've logged.</div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn" id="homeWxFill" style="flex:1">Look it up</button>
        <button class="btn btn-sec" id="homeWxNo" style="flex:none;width:auto;padding-left:16px;padding-right:16px">Not now</button>
      </div>
    </div>`;
  }
  /* Attention hierarchy (Round C). Home could stack eight blocks: trip dash,
     tiles, today's plan, the log CTA, Tomorrow, catch-up, laundry, backup, and
     now the weather offer. Only ONE thing gets to ask for attention; the rest
     fold into a single quiet line. The log CTA and the Tomorrow card are NOT in
     here — they're the daily loop, not interruptions. In trip mode the dash IS
     the one thing, so everything else folds. */
  /* ⚠️ THE FOLD IS GONE (2026-08-05, her words: "I don't want things hidden
     behind 'two more things' — just keep scrolling on home").

     The hierarchy was built on the premise that only one thing may ask for
     attention. That premise was mine, not hers, and the cost turned out to be
     real: a row she'd have acted on (the laundry prompt, a missed day) could sit
     behind a link that says nothing about what's under it, so the app looked
     calm by hiding work. Scrolling is cheap; a hidden prompt is a prompt that
     doesn't happen. In trip mode the dash still takes over — that's a different
     rule and she hasn't asked to change it. */
  const attention = [catchup, laun, bk, wxb].filter(Boolean);
  const attnHtml = tc ? "" : attention.join("");

  // Below everything, and only on the days it has something: a delight row, not
  // an attention row, so it stays out of the folding group above.
  const otd = (dataReady && !tripModeId) ? onThisDayHtml(today) : "";

  /* ⚠️ ORDER IS THE FIX (2026-08-14). Home used to open launcher-grid first, so
     on a 375×812 phone the two things she is actually here for — decide, and
     record — were the last things above the fold (the log row 39px behind the
     tab bar), and TODAY, the card saying what she has already worn, started at
     y=797 and was never visible at all.

     Trip mode had the right answer the whole time: its dash leads with the day,
     then the hamper, then the ask, and pushes the tiles below the fold — which
     is the proof they were never needed at the top. Non-trip Home is built the
     same way now: today, ask, log, then navigation, then tomorrow and the
     quieter rows.

     todayCardHtml() returns "" in trip mode (the dash already IS today), so the
     dash keeps the top for itself and this ordering costs it nothing. */
  $("#homeBody").innerHTML =
    `${dash}${todayCardHtml()}${ask}${cta}${attnHtml}${otd}`;
  hydratePhotos($("#homeBody"));
  // (wireWxMemory is not called here: the memory row is suggester-only now.)
  $("#homeBody").querySelectorAll("[data-otd]").forEach(b => {
    b.onclick = () => { switchTab("calendar"); calendarDay = b.dataset.otd; renderCalendarDay($("#calendarBody")); };
  });
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
  /* The only handler left from the day card: tapping something she wore opens
     it. Every other `data-tm-*` went with the planning block above — r7's rule,
     the handler goes in the same commit as the markup. */
  $("#homeBody").querySelectorAll("[data-tm-worn]").forEach(b => {
    // A logged look opens the look; a bare item-log opens that day.
    b.onclick = () => {
      const oid = b.dataset.tmWorn;
      if (oid) return openLookFrom(oid);
      switchTab("calendar"); calendarDay = b.dataset.tmDate; renderCalendar();
    };
  });
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
  // Straight into the sheet — no tab change. The old path routed through
  // switchTab("calendar") first, so asking "what should I wear" moved her to the
  // logging tab and closing the sheet stranded her there instead of on Home.
  const askBtn = $("#homeAsk");
  if (askBtn) askBtn.onclick = () => openSuggestSheet();
  const ctaBtn = $("#homeLogCta");
  /* G6: the most common real log is a repeat — offer "wear again" first, not a
     blank picker.

     ⚠️ NO TAB CHANGE (2026-08-14). This used to switchTab("calendar") before
     opening the sheet, so a one-tap log started on Home and ended on Calendar:
     openPostLogSheet's close() re-renders whichever screen is active, and by
     then that was the calendar. Measured — tab-home in, tab-calendar out.
     That is the identical defect fixed for the suggester six lines above, whose
     comment ("closing the sheet stranded her there instead of on Home") was
     sitting right here the whole time. One of a symmetric pair had been fixed;
     this is the twin.
     `calendarDay` is still set because logLookOnDay reads it — it is the date
     being logged, not a claim about which screen is showing. */
  if (ctaBtn) ctaBtn.onclick = () => {
    calendarDay = today;
    openWearAgainChooser(today);
  };
  const loggedBtn = $("#homeLoggedRow");
  // Already-logged: this one is genuinely "show me the day", so it navigates.
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
    closetHamper = true; hamperLoad = null; closetWorn = false; closetRack = false; closetCat = null; closetSub = null; searchResults = null; closetSearchQ = null;
    renderCloset();
  });
  on("[data-td-unworn]", () => {
    switchTab("capsules");
    capsuleId = tc.id; capsuleView = "detail";
    _capUnpackedOnly = false; _capUnwornOnly = true;
    renderCapsules();
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

