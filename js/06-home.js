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
  await kvSet("wxlog", log);
  await kvSet(WX_BACKFILL_KEY, today);
  return n;
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
    await kvSet("wxlog", log);
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

/* ---- SEASON vs WEATHER AUDIT (Round D) -------------------------------------
   Her ask: flag where a season tag and the weather she actually wore something
   in disagree — because it might mean the season is wrong, or it might mean
   she was somewhere else. Both are worth knowing and they want opposite fixes,
   so the detector tries to tell them apart instead of making her diagnose it:
   contradicting days that CLUSTER into one date window across several items
   look like a trip, whereas days scattered over years look like a bad label. */
const WXA_MIN_DAYS = 6;      // weather-matched wear-days before we'll judge an item
const WXA_CAL_SHARE = 0.2;   // share of days that must land in the claimed season
const WXA_TEMP_MARGIN = 3;   // °F of slack before "worn hotter/colder" is claimed
const WXA_GAP = 3;           // days apart that still count as one trip
const WXA_RUN_MIN = 2;       // distinct dates before a cluster is worth asking about
const WXA_OK_KEY = "wxaudit_ok";
const WXA_HOME_KEY = "wxaudit_home";   // windows she's answered "I was home" for

/* "I was home" is the other half of the question, and it has to persist or the
   same window comes back every time she opens the audit. It suppresses the
   TRIP guess only — never an item flag, because "I was home" is evidence the
   clothes are mislabeled, which is exactly when the flag is worth keeping. */
const homeRanges = () => (kvData.get(WXA_HOME_KEY) || []).filter(r => r && r.from && r.to);
const isMarkedHome = (date, ranges = null) =>
  (ranges || homeRanges()).some(r => date >= r.from && date <= r.to);
const WXA_TEMP_MIN_DAYS = 3; // the temp test measures a huge effect, so it needs less
const WXA_DAY_DELTA = 30;    // °F between a day and a piece's habit before it's odd
const WXA_DAY_PIECES = 2;    // vote WEIGHT that makes a day odd (see buildDayWxAnomalies)
/* Days of history that make one piece's vote worth two. Deliberately well
   above a long trip's length: at 12 the tests caught a piece with 6 home days
   and 7 uncorrected trip days having its own median dragged onto the wrong
   value, which then made its REAL summer days look like the anomaly. A habit
   only outvotes a trip if the trip can't be most of it. */
const WXA_DAY_STRONG = 20;

/* Greedy day clustering, shared by both trip-guess sources.
   ⚠️ Two guards that are the whole difference between "were you away Dec 20–27"
   and a useless "were you away March–August". Plain gap-chaining is transitive:
   days 3 apart link, so scattered anomalies daisy-chain across months. So a
   window is also capped at WXA_MAX_SPAN, and afterwards must be DENSE — a real
   trip is a run of days, not two odd days six weeks apart. */
const WXA_MAX_SPAN = 24;      // days; longer than this isn't one trip
// Half the window must be flagged days. Anomalies spaced every 3rd day land at
// ~0.36, a genuine trip at 0.6–1.0, so this is the clean line between them.
const WXA_MIN_DENSITY = 0.5;

function _clusterAwayDays(entries) {
  const out = [];
  let cur = null;
  for (const { d, id } of [...entries].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))) {
    const fits = cur && daysBetween(cur.to, d) <= WXA_GAP
              && daysBetween(cur.from, d) < WXA_MAX_SPAN;
    if (fits) {
      if (d > cur.to) cur.to = d;
      cur.dates.add(d); if (id) cur.itemIds.add(id);
    } else {
      if (cur) out.push(cur);
      cur = { from: d, to: d, dates: new Set([d]), itemIds: new Set(id ? [id] : []) };
    }
  }
  if (cur) out.push(cur);
  return out.filter(c => c.dates.size / (daysBetween(c.from, c.to) + 1) >= WXA_MIN_DENSITY);
}

/* The temperature an item habitually goes out in — the MEDIAN, deliberately,
   not the p10/p90 band `itemWxProfile` reports. Median is what survives the
   contamination this whole round is about: a handful of uncorrected trip days
   recorded as home weather sit in the tail, where they'd drag a percentile but
   can't move the middle. */
function itemTempCenter(itemId, log = null, dayMapByItem = null) {
  const L = log || wxLog();
  const days = dayMapByItem ? (dayMapByItem.get(itemId) || new Set())
    : new Set(wears.filter(w => w.item_id === itemId).map(w => w.worn_on));
  const t = [...days].map(d => L[d]).filter(e => e && e.maxT != null && !isNullWxDay(e))
    .map(e => e.maxT).sort((a, b) => a - b);
  if (t.length < WX_PROFILE_MIN) return null;
  const at = f => t[Math.min(t.length - 1, Math.max(0, Math.round(f * (t.length - 1))))];
  // IQR alongside the median: the median says where this piece lives, the IQR
  // says how PICKY it is. A year-round pair of jeans and a pair of sandals can
  // share a centre and mean completely different things.
  return { t: t[Math.floor(t.length / 2)], n: t.length, iqr: Math.max(0, at(0.75) - at(0.25)) };
}

/* Days she dressed for a completely different climate than the one on record.
   This is the detector that needs NO season tag, and it's the one that finds a
   trip the app was never told about: on an uncorrected St Lucia day the stored
   weather (home December) and the calendar AGREE with each other, so nothing
   about the day looks wrong on its own — but the sandals and the linen dress
   she wore have summer habits from years of home wears, and two of them
   disagreeing the same way is the tell. */
function buildDayWxAnomalies({ wearRows = null, log = null, ranges = null, home = null } = {}) {
  const L = log || wxLog();
  const R = ranges || awayRanges();
  const H = home || homeRanges();
  const rows = wearRows || wears;
  const byItem = new Map(), byDay = new Map();
  for (const w of rows) {
    if (!w.worn_on || !w.item_id) continue;
    if (!byItem.has(w.item_id)) byItem.set(w.item_id, new Set());
    byItem.get(w.item_id).add(w.worn_on);
    if (!byDay.has(w.worn_on)) byDay.set(w.worn_on, new Set());
    byDay.get(w.worn_on).add(w.item_id);
  }
  const centers = new Map();
  for (const id of byItem.keys()) centers.set(id, itemTempCenter(id, L, byItem));

  const odd = [];
  for (const [d, ids] of byDay) {
    const e = L[d];
    if (!e || e.maxT == null || isNullWxDay(e)) continue;
    if (awayRangeFor(d, R)) continue;         // already known — nothing to ask
    if (isMarkedHome(d, H)) continue;         // already answered "I was home"
    /* Votes are WEIGHTED by how well-established the habit is, which matters
       more than it looks. A piece worn only on the trip has a habit computed
       from the trip's own (wrong) weather, so it agrees with the wrong day
       trivially and abstains — on a real trip that can be most of the outfit.
       What's left is the one pair of sandals with years of home summer wears,
       and a piece that well-established being 50° off IS the evidence. Two
       lightly-worn pieces agreeing clears the same bar. */
    let hot = [], cold = [], hotW = 0, coldW = 0;
    for (const id of ids) {
      const c = centers.get(id);
      if (!c) continue;
      /* Judge each piece against ITS OWN spread, not a fixed number of degrees.
         Year-round basics sit near the annual mean, so a flat threshold made
         every genuine cold snap and heat wave look like travel — jeans with a
         55° median "disagreed" with a real 18° January day, and so did most of
         the closet, which is how this produced huge swaths of dates. Widening
         the bar by the piece's own IQR fixes that from both ends: a jeans-like
         spread can't be surprised, a sandals-like one is surprised easily.
         Contamination inflates the IQR, which only ever makes a piece abstain —
         the safe direction to be wrong in. */
      const bar = Math.max(WXA_DAY_DELTA, 1.5 * c.iqr);
      const w = c.n >= WXA_DAY_STRONG ? 2 : 1;
      if (c.t - e.maxT > bar) { hot.push(id); hotW += w; }
      else if (e.maxT - c.t > bar) { cold.push(id); coldW += w; }
    }
    const useHot = hotW >= coldW;
    if ((useHot ? hotW : coldW) < WXA_DAY_PIECES) continue;
    odd.push({ d, ids: useHot ? hot : cold, dir: useHot ? "warmer" : "colder", dayT: e.maxT });
  }
  return { days: odd, clusters: _clusterAwayDays(odd.flatMap(o => o.ids.map(id => ({ d: o.d, id })))) };
}

function buildSeasonWxFlags({ pool = null, wearRows = null, log = null, bands = null,
                              ranges = null, dismissed = null, home = null } = {}) {
  const L = log || wxLog();
  const B = bands || seasonBands(log);
  const R = ranges || awayRanges();
  const H = home || homeRanges();
  const OK = dismissed || kvData.get(WXA_OK_KEY) || {};
  const rows = wearRows || wears;
  const list = pool || items.filter(i => itemStatus(i) === "Available");

  // item_id -> Set(worn_on) — one pass; a wear is a DAY, never a row.
  const daysBy = new Map();
  for (const w of rows) {
    if (!w.worn_on) continue;
    if (!daysBy.has(w.item_id)) daysBy.set(w.item_id, new Set());
    daysBy.get(w.item_id).add(w.worn_on);
  }

  const flags = [];
  for (const i of list) {
    if (!i.season || !i.season.length) continue;      // no claim = nothing to contradict
    if (OK[i.id] === JSON.stringify(i.season)) continue;
    const days = [...(daysBy.get(i.id) || [])].filter(d => L[d] && L[d].maxT != null && !isNullWxDay(L[d])).sort();
    // The two tests need different amounts of evidence: the temp test measures
    // a huge effect (a whole climate off), the calendar test is a proportion
    // and needs enough days to be a proportion of.
    if (days.length < WXA_TEMP_MIN_DAYS) continue;

    const claimed = i.season.filter(s => SEASONS.includes(s));
    if (!claimed.length) continue;
    const off = days.filter(d => !claimed.includes(effectiveSeasonOf(d, log, B)));

    // Temperature evidence first — it's the stronger claim, and it's the one
    // that survives her having tagged something for the right months but the
    // wrong climate.
    const temps = days.map(d => L[d].maxT).sort((a, b) => a - b);
    const at = f => temps[Math.min(temps.length - 1, Math.max(0, Math.round(f * (temps.length - 1))))];
    const lo = at(0.1), hi = at(0.9);
    const usable = claimed.map(s => B[s]).filter(Boolean);
    let flag = null, guilty = off;
    if (usable.length) {
      const ceil = Math.max(...usable.map(b => b.p90));
      const floorT = Math.min(...usable.map(b => b.p10));
      /* Widen the bar by the claimed season's OWN spread, the same correction
         that fixed the day detector. A season that swings 30° here can't be
         contradicted by a piece worn 5° outside its 90th percentile — that's a
         piece worn at the mild end of its season, not a mislabelled one. */
      const spread = Math.max(...usable.map(b => b.p90 - b.p10));
      const bar = Math.max(WXA_TEMP_MARGIN, 0.5 * spread);
      if (lo > ceil + bar) {
        flag = { kind: "temp", dir: "hot", lo, hi, band: [floorT, ceil] };
        guilty = days.filter(d => L[d].maxT > ceil + bar);
      } else if (hi < floorT - bar) {
        flag = { kind: "temp", dir: "cold", lo, hi, band: [floorT, ceil] };
        guilty = days.filter(d => L[d].maxT < floorT - bar);
      }
    }
    if (!flag && days.length >= WXA_MIN_DAYS && off.length / days.length > 1 - WXA_CAL_SHARE)
      flag = { kind: "calendar", inSeason: days.length - off.length, lo, hi };
    if (!flag) continue;

    /* What the fix probably IS, so the flag isn't just "something's off".
       ⚠️ Each kind proposes in the SAME currency as its evidence. A temp flag
       reads the temperatures (its whole point is that a December day can feel
       like Summer); a calendar flag reads the seasons those days actually fell
       in — it fires when there are no usable temperature bands, so asking the
       temperature would leave it with nothing to propose and silently suppress
       the one flag that had evidence. */
    const fitSrc = flag.kind === "temp" ? days : guilty;
    const fitTally = new Map();
    for (const d of fitSrc) {
      const s = flag.kind === "temp" ? seasonForTemp(L[d].maxT, B) : effectiveSeasonOf(d, log, B);
      if (s) fitTally.set(s, (fitTally.get(s) || 0) + 1);
    }
    const fit = [...fitTally.entries()].filter(([, n]) => n / Math.max(1, fitSrc.length) >= 0.25)
      .sort((a, b) => b[1] - a[1]).map(([s]) => s);
    const missing = fit.filter(s => !claimed.includes(s));
    /* ⚠️ No proposal, no flag. If the seasons these temperatures resemble are
       ALREADY on the piece, there is nothing she can do about it — the tag is
       right and the weather simply varies. Raising it anyway produced a list
       of unactionable warnings, which is worse than silence (user, 2026-07-25:
       "there's nothing I can do about a lot of these flags — they already have
       the season in question on them"). */
    if (!missing.length) continue;
    flags.push({ ...flag, id: i.id, name: i.name, image_path: i.image_path,
                 season: claimed, days: days.length, off: guilty, fit, missing });
  }

  /* Trip guesses come ONLY from day anomalies — never from a flagged item's
     contradicting days. That seemed reasonable and was badly wrong: for a
     mis-tagged seasonal piece EVERY wear contradicts, and a winter coat tagged
     Summer is worn on consecutive cold days, so its own history clusters into a
     run of dense, entirely spurious "were you away?" windows. The two signals
     answer different questions and each already has its own fix: a flag means
     the TAG is suspect (edit the season), an anomaly means the DAY is suspect
     (log where you were). Mixing them made both worse. */
  const anom = buildDayWxAnomalies({ wearRows: rows, log, ranges: R, home: H });
  const tripGuesses = _clusterAwayDays(anom.days.flatMap(o => o.ids.map(id => ({ d: o.d, id }))));
  return {
    dayAnomalies: anom.days,   // per-DAY detail, so the day view can name the culprit
    flags: flags.sort((a, b) => b.days - a.days),
    tripGuesses: tripGuesses.filter(g => g.dates.size >= WXA_RUN_MIN)
      .map(g => ({ from: g.from, to: g.to, dates: [...g.dates].sort(), itemIds: [...g.itemIds] }))
      .sort((a, b) => (a.from < b.from ? 1 : -1)),
  };
}

// Session cache. Busted explicitly wherever a season is edited or a flag is
// dismissed — the stamp alone can't see an in-place season change.
function wxAuditFlags() {
  const stamp = `${wears.length}:${Object.keys(wxLog()).length}:${items.length}`;
  if (_wxAudit && _wxAudit.stamp === stamp) return _wxAudit.res;
  const res = dataReady ? buildSeasonWxFlags() : { flags: [], tripGuesses: [] };
  _wxAudit = { stamp, res };
  return res;
}
const wxFlagFor = (id) => wxAuditFlags().flags.find(f => f.id === id) || null;

/* The evidence, then the likely fix. Both halves matter: the first says why
   the app thinks something is off, the second answers "off HOW — is it missing
   Winter?", which the evidence alone never told her. */
function wxFlagText(f) {
  const s = f.season.join("/");
  let why;
  if (f.kind === "temp") {
    why = f.dir === "hot"
      ? `Tagged ${s}, but you wear it in ${f.lo}°–${f.hi}° — your ${s.toLowerCase()} tops out near ${f.band[1]}°.`
      : `Tagged ${s}, but you wear it in ${f.lo}°–${f.hi}° — your ${s.toLowerCase()} bottoms out near ${f.band[0]}°.`;
  } else {
    why = `Tagged ${s}, but only ${f.inSeason} of ${f.days} days you wore it felt like ${s}.`;
  }
  const miss = f.missing || [];
  return `${why} That's ${miss.join(" / ")} weather here.`;
}

// One tap: append the season(s) the weather says are missing, keeping whatever
// is already there. Never removes — the piece may well be right about Winter
// AND also need Summer.
async function addFlagSeason(id, seasons) {
  const i = itemById.get(id);
  if (!i || !seasons.length) return;
  const next = [...new Set([...(i.season || []), ...seasons])];
  await saveField(id, "season", next);
  _wxAudit = null;
  toast(`${i.name || "Item"} is now ${next.join(" + ")}`);
}

/* "Nothing to show" has several very different causes here, and silence made
   them indistinguishable — she went looking for the feature, found an empty
   health check, and reasonably concluded it was broken. Say which gate is
   closed, in her terms. */
function wxAuditEmptyHtml() {
  const L = wxLog(), n = Object.keys(L).length;
  const avail = items.filter(i => itemStatus(i) === "Available");
  const tagged = avail.filter(i => i.season && i.season.length).length;
  const withCentre = new Set(wears.filter(w => L[w.worn_on]).map(w => w.item_id)).size;
  const why = !n
    ? `No weather on record yet. Run <b>Look up past weather</b> in Settings first — everything here is built on it.`
    : !tagged
      ? `Nothing to contradict yet: no Available piece has a season set by hand. Pieces without one aren't judged — their season is worked out from the weather instead, which fixes itself once trips are logged.`
      : `${n} days of weather on record, ${tagged} piece${tagged === 1 ? "" : "s"} with a season set by hand, ${withCentre} with enough history to have a temperature habit.`;
  return `<div class="muted" style="padding:22px 18px;font-size:13px;line-height:1.55;text-align:center">
    🎉 Nothing disagrees.<div style="margin-top:8px">${why}</div>
    <div style="margin-top:8px">If you know you were away and it isn't listed, add it under <b>Where you've been</b> — that's always worth doing, flag or no flag.</div>
  </div>`;
}

/* The audit sheet. Trip guesses sit ABOVE the item list on purpose: answering
   one "were you away?" can dissolve a dozen item flags at once, and it's the
   cheaper question to answer. Nothing here is auto-applied. */
function openSeasonAuditSheet() {
  const { flags, tripGuesses } = wxAuditFlags();
  const fmt = d => new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const guesses = tripGuesses.map((g, idx) => {
    // Count everything she actually WORE in the window, not just the pieces
    // that voted — a trip-only piece abstains (its habit is the wrong weather),
    // so "1 piece" would badly understate a week of outfits.
    const worn = new Set(wears.filter(w => w.worn_on >= g.from && w.worn_on <= g.to).map(w => w.item_id)).size;
    const nDays = g.dates.length;
    return `<div style="margin:0 16px 8px;padding:11px 13px;background:var(--panel);border:1px solid var(--line);border-radius:14px">
      <div style="font-size:14px;font-weight:600">Were you away ${esc(fmt(g.from))}${g.from === g.to ? "" : ` – ${esc(fmt(g.to))}`}?</div>
      <div class="muted" style="font-size:12.5px;line-height:1.45;margin-top:3px">Over ${nDays} day${nDays === 1 ? "" : "s"} you wore ${worn} piece${worn === 1 ? "" : "s"} that don't suit the weather recorded here. If you were somewhere else, say where and the weather gets corrected instead — which fixes the seasons too.</div>
      <div style="display:flex;gap:8px;margin-top:9px;flex-wrap:wrap">
        <button class="btn btn-sec" data-wxa-trip="${idx}" style="flex:1;min-width:130px">✈️ I was away</button>
        <button class="btn btn-sec" data-wxa-home="${idx}" style="flex:1;min-width:130px">🏠 I was home</button>
      </div>
      <button class="lnk" data-wxa-days="${idx}" style="margin-top:7px;font-size:12.5px">See these days ›</button>
    </div>`;
  }).join("");
  const rows = flags.map(f => `
    <div style="display:flex;align-items:center;gap:10px;padding:9px 16px;border-bottom:1px solid var(--line)">
      <div style="width:46px;flex:none">${thumbHtml(f.image_path || "")}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name || "Untitled")}</div>
        <div class="muted" style="font-size:12px;line-height:1.4">${esc(wxFlagText(f))}</div>
        <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">
          <button class="cap-chip" data-wxa-add="${esc(f.id)}" style="color:var(--accent);font-weight:600">＋ Add ${esc(f.missing.join(" & "))}</button>
          <button class="cap-chip" data-wxa-edit="${esc(f.id)}">Edit…</button>
          <button class="cap-chip" data-wxa-ok="${esc(f.id)}" style="color:var(--muted)">It's fine</button>
        </div>
      </div>
    </div>`).join("");
  $("#wxAuditInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="wxaClose">Done</button>
      <h2>Season vs weather</h2>
      <span style="width:54px"></span>
    </div>
    <div class="muted" style="font-size:12.5px;padding:4px 18px 10px;line-height:1.5">${
      flags.length
        ? "These pieces were worn in weather their season tag doesn't fit. Either the tag is wrong, or you were somewhere warmer or colder than home."
        : "Some days you dressed for a completely different climate than the one on record here — which usually means you were away."
    }</div>
    ${guesses}
    ${rows || (tripGuesses.length ? "" : wxAuditEmptyHtml())}
    <div style="height:max(env(safe-area-inset-bottom),20px)"></div>`;
  showSheet("wxAuditSheet");
  hydratePhotos($("#wxAuditInner"));
  $("#wxaClose").onclick = () => {
    hideSheet("wxAuditSheet");
    if (activeTabName() === "settings") { renderSettings(); runDataHealthCheck(); }
  };
  $("#wxAuditInner").querySelectorAll("[data-wxa-trip]").forEach(b => {
    b.onclick = () => {
      const g = tripGuesses[+b.dataset.wxaTrip];
      hideSheet("wxAuditSheet");
      openWhereSheet({ from: g.from, to: g.to });
    };
  });
  $("#wxAuditInner").querySelectorAll("[data-wxa-days]").forEach(b => {
    b.onclick = () => openWxDaysView(tripGuesses[+b.dataset.wxaDays]);
  });
  $("#wxAuditInner").querySelectorAll("[data-wxa-home]").forEach(b => {
    b.onclick = async () => {
      const g = tripGuesses[+b.dataset.wxaHome];
      const list = [...homeRanges(), { from: g.from, to: g.to }];
      _wxAudit = null;
      try { await kvSet(WXA_HOME_KEY, list); } catch (e) { toast(e.message); }
      toast("Noted — those days were at home");
      openSeasonAuditSheet();
    };
  });
  $("#wxAuditInner").querySelectorAll("[data-wxa-edit]").forEach(b => {
    b.onclick = () => openWxSeasonEdit(b.dataset.wxaEdit);
  });
  $("#wxAuditInner").querySelectorAll("[data-wxa-add]").forEach(b => {
    b.onclick = async () => {
      const f = flags.find(x => x.id === b.dataset.wxaAdd);
      if (!f) return;
      b.disabled = true;
      await addFlagSeason(f.id, f.missing);
      openSeasonAuditSheet();
    };
  });
  $("#wxAuditInner").querySelectorAll("[data-wxa-ok]").forEach(b => {
    b.onclick = async () => {
      const i = itemById.get(b.dataset.wxaOk);
      if (!i) return;
      const ok = { ...(kvData.get(WXA_OK_KEY) || {}) };
      ok[i.id] = JSON.stringify(i.season || []);
      _wxAudit = null;
      try { await kvSet(WXA_OK_KEY, ok); } catch (e) { toast(e.message); }
      openSeasonAuditSheet();
    };
  });
}

/* Day-by-day view of one suspect window. The audit's verdicts were unreadable
   without this: she could see "Dec 20–26 looks odd" but not what she wore, what
   the weather on record was, or which piece drove it — and the dates themselves
   may be what's wrong. Everything here is inspectable and fixable in place:
   edit a piece's season, or jump to that day in the calendar to move the wear. */
function openWxDaysView(g) {
  const L = wxLog();
  const anomDays = new Set(g.dates);
  // Per-DAY culprits, not a union across the window: she couldn't tell which
  // piece made a given day suspect when every driver was marked on every day.
  const anomByDate = new Map((wxAuditFlags().dayAnomalies || []).map(o => [o.d, o]));
  const rowsByDay = new Map();
  for (const w of wears) {
    if (w.worn_on < g.from || w.worn_on > g.to) continue;
    if (!rowsByDay.has(w.worn_on)) rowsByDay.set(w.worn_on, new Set());
    rowsByDay.get(w.worn_on).add(w.item_id);
  }
  const dates = [];
  for (let d = g.from; d <= g.to; d = shiftDate(d, 1)) dates.push(d);

  const dayHtml = dates.map(d => {
    const e = L[d];
    const ids = [...(rowsByDay.get(d) || [])];
    const wd = new Date(d + "T00:00:00");
    const label = wd.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const loc = e && e.away ? e.loc : null;
    const an = anomByDate.get(d);
    const culprits = new Set(an ? an.ids : []);
    const pieces = ids.map(id => {
      const i = itemById.get(id);
      if (!i) return "";
      const p = itemWxProfile(id);
      const c = itemTempCenter(id);
      /* Explicit vs derived, said out loud. A piece with no season isn't
         season-less — the app works one out from the weather it's been worn in,
         and that one self-corrects as trips get logged. Setting a season here
         REPLACES that with a fixed answer, which is worth knowing before you
         tap it. */
      const derived = (!i.season || !i.season.length) ? itemSeasonSet(i) : null;
      const season = (i.season && i.season.length) ? i.season.join(", ")
        : derived && derived.length ? `${derived.join(", ")} (worked out, not set)`
        : "no season yet";
      const isCulprit = culprits.has(id);
      // Spell out the arithmetic for the piece that actually drove the verdict.
      const why = isCulprit && c && e && e.maxT != null
        ? `<div style="font-size:11px;color:var(--accent);margin-top:1px">⚠ flagged this day — usually around ${c.t}°, about ${Math.abs(c.t - e.maxT)}° ${c.t > e.maxT ? "warmer" : "colder"} than this</div>`
        : "";
      return `<div style="display:flex;align-items:center;gap:9px;padding:5px 0 5px 10px${isCulprit ? ";background:var(--accent-soft);border-radius:10px" : ""}">
        <div style="width:34px;flex:none">${thumbHtml(i.image_path || "")}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.name || "Untitled")}</div>
          <div class="muted" style="font-size:11px">${esc(season)}${p ? ` · usually ${p.lo}°–${p.hi}°` : " · not worn enough to have a usual range"}</div>
          ${why}
        </div>
        <button class="cap-chip" data-wxd-season="${esc(id)}" style="flex:none;font-size:11.5px">Season ✎</button>
      </div>`;
    }).join("");
    return `<div style="padding:9px 16px;border-bottom:1px solid var(--line);${anomDays.has(d) ? "background:var(--panel)" : ""}">
      <div style="display:flex;align-items:baseline;gap:8px">
        <div style="font-size:13.5px;font-weight:600;flex:1">${esc(label)}${anomDays.has(d) ? " ⚠" : ""}</div>
        <div class="muted" style="font-size:12px">${e && e.maxT != null && !isNullWxDay(e) ? `${e.maxT}°/${e.minT}°${loc ? ` · ${esc(String(loc).split(",")[0])}` : ""}` : "no weather on record"}</div>
      </div>
      ${pieces || `<div class="muted" style="font-size:12px;padding:4px 0 2px 10px">Nothing logged this day.</div>`}
      <button class="lnk" data-wxd-cal="${esc(d)}" style="font-size:11.5px;padding:4px 0 0 10px;color:var(--muted)">Open in calendar — wrong date? ›</button>
    </div>`;
  }).join("");

  $("#wxAuditInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="wxdBack">← Back</button>
      <h2>These days</h2>
      <span style="width:54px"></span>
    </div>
    <div class="muted" style="font-size:12.5px;padding:4px 18px 10px;line-height:1.5">⚠ marks the days and pieces that look wrong for the weather on record. If a date itself is wrong, open that day in the calendar and move the wear.</div>
    ${dayHtml}
    <div style="padding:12px 16px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" id="wxdAway" style="flex:1;min-width:130px">✈️ I was away</button>
      <button class="btn btn-sec" id="wxdHome" style="flex:1;min-width:130px">🏠 I was home</button>
    </div>
    <div style="height:max(env(safe-area-inset-bottom),20px)"></div>`;
  hydratePhotos($("#wxAuditInner"));
  $("#wxdBack").onclick = () => openSeasonAuditSheet();
  $("#wxdAway").onclick = () => { hideSheet("wxAuditSheet"); openWhereSheet({ from: g.from, to: g.to }); };
  $("#wxdHome").onclick = async () => {
    _wxAudit = null;
    try { await kvSet(WXA_HOME_KEY, [...homeRanges(), { from: g.from, to: g.to }]); } catch (e) { toast(e.message); }
    toast("Noted — those days were at home");
    openSeasonAuditSheet();
  };
  $("#wxAuditInner").querySelectorAll("[data-wxd-season]").forEach(b => {
    b.onclick = () => openWxSeasonEdit(b.dataset.wxdSeason, () => openWxDaysView(g));
  });
  $("#wxAuditInner").querySelectorAll("[data-wxd-cal]").forEach(b => {
    b.onclick = () => {
      hideSheet("wxAuditSheet");
      switchTab("calendar");
      calendarDay = b.dataset.wxdCal;
      renderCalendarDay($("#calendarBody"));
    };
  });
}

// Season edit routed through the field sheet with a custom save, so the audit
// list underneath refreshes instead of going stale behind the sheet.
function openWxSeasonEdit(id, onDone = null) {
  const i = itemById.get(id);
  if (!i) return;
  _fieldEditId = null;
  _fieldEditKey = "season";
  _fieldPending = i.season;
  _fieldEditItem = i;
  _fieldOnSave = async (val) => {
    await saveField(id, "season", val);
    _wxAudit = null;
    if (onDone) onDone(); else openSeasonAuditSheet();
  };
  renderFieldSheet(i, "season", FIELD_CONFIGS.season);
  showSheet("fieldSheet");
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

