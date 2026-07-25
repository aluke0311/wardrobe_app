/* ===================================================================
   DATA SNAPSHOT + FRESHNESS (2026-07-17)
   Instant boot: hydrate from a Cache Storage snapshot of the last good
   loadData(), then fetch fresh behind. Return-to-app: silently refetch
   after >5 min hidden (or a date rollover) when the UI is at rest.
   =================================================================== */
const DATA_CACHE = "wardrobe-data-v1";
const SNAPSHOT_KEY = "wardrobe-data-snapshot";   // resolves under the app's path
const SNAPSHOT_MAX_AGE = 7 * 86400000;           // stale snapshots feel like bugs — skip past 7d
const REFRESH_AFTER_HIDDEN_MS = 5 * 60000;

async function saveDataSnapshot() {
  if (!("caches" in window)) return;
  try {
    const cache = await caches.open(DATA_CACHE);
    const body = JSON.stringify({ ts: Date.now(), user_id: session?.user?.id || null,
      items, wears, outfits, outfitLinks, capsules, capsuleLinks, exclusions,
      kv: [...kvData.entries()] });
    await cache.put(SNAPSHOT_KEY, new Response(body, { headers: { "Content-Type": "application/json" } }));
  } catch (_) {}
}
async function clearDataSnapshot() {
  if (!("caches" in window)) return;
  try { (await caches.open(DATA_CACHE)).delete(SNAPSHOT_KEY); } catch (_) {}
}
// Hydrate state from the snapshot. Returns true when the app is usable from it.
async function loadDataSnapshot() {
  if (!("caches" in window)) return false;
  try {
    const r = await (await caches.open(DATA_CACHE)).match(SNAPSHOT_KEY);
    if (!r) return false;
    const d = await r.json();
    if (!d || d.user_id !== session?.user?.id) return false;
    if (Date.now() - (d.ts || 0) > SNAPSHOT_MAX_AGE) return false;
    items = d.items || []; wears = d.wears || []; outfits = d.outfits || [];
    outfitLinks = d.outfitLinks || []; capsules = d.capsules || [];
    capsuleLinks = d.capsuleLinks || []; exclusions = d.exclusions || [];
    kvData = new Map(d.kv || []);
    applyTaxonomyOverride();
    buildOutfitIndexes(); buildCapsuleIndexes(); buildExcludeSet(); buildSuggestIndexes();
    dataReady = true;
    return true;
  } catch (_) { return false; }
}

function activeTabName() {
  const s = document.querySelector(".screen.active");
  return s ? s.id.slice(4) : null;                 // "tab-home" → "home"
}
// Safe to swap the data arrays out from under the UI? Anything mid-edit says no.
function uiCanRefetch() {
  for (const id of ["bulkSheet", "moveSheet", "quickActSheet", "fieldSheet", "logSheet",
                    "statsFilterSheet", "filterSheet", "statsRangeSheet"])
    { const w = document.getElementById(id); if (w && !w.hidden) return false; }
  const tab = activeTabName();
  if (tab === "add" || tab === "builder") return false;
  if (_reviewMode || statsView === "review") return false;
  if (capsuleView === "form" || capsuleView === "pick") return false;
  if (selectMode) return false;
  return true;
}
// Re-render only true root surfaces; open details/pickers keep their DOM and
// simply see fresh data on their next navigation.
function rerenderRootAfterRefresh() {
  const tab = activeTabName();
  if (tab === "home") renderHome();
  else if (tab === "closet" && !detailId) renderCloset();
  else if (tab === "looks" && !lookId) renderLooks();
  else if (tab === "calendar") renderCalendar();
  else if (tab === "stats" && statsView !== "review") renderStats();
}

// "Update available" toast — GH Pages caches hard, so a deployed fix can sit
// unseen for days. Reads the app-version <meta> from the first 2KB of our own
// index.html (cache-busted); reload goes through location.replace with a query
// because a plain reload() can re-serve the same stale cached copy.
let _verToastShown = null;
async function checkForNewVersion() {
  try {
    const r = await fetch(`index.html?v=${Date.now()}`,
      { headers: { Range: "bytes=0-2047" }, cache: "no-store" });
    if (!(r.ok || r.status === 206)) return;
    const m = /name="app-version" content="([^"]+)"/.exec(await r.text());
    if (!m || m[1] === APP_VERSION || m[1] === _verToastShown) return;
    _verToastShown = m[1];
    toast(`Update available · ${m[1]}`,
      { label: "Reload", fn: () => location.replace(location.pathname + "?v=" + Date.now()) });
  } catch (_) {}
}

let _lastHiddenAt = 0;
let _uiDay = todayStr();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") { _lastHiddenAt = Date.now(); return; }
  if (!session?.access_token || !dataReady) return;
  const dayChanged = todayStr() !== _uiDay;
  if (dayChanged) _uiDay = todayStr();
  const longAway = _lastHiddenAt && Date.now() - _lastHiddenAt > REFRESH_AFTER_HIDDEN_MS;
  if (longAway) checkForNewVersion();
  if ((longAway || dayChanged) && uiCanRefetch()) {
    loadData().then(() => { prunePhotoCache(); rerenderRootAfterRefresh(); }).catch(() => {});
  } else if (dayChanged && activeTabName() === "home") {
    renderHome();   // logged-row / laundry strip roll over even if a refetch was skipped
  }
});

/* ===================================================================
   AUTH / BOOT
   =================================================================== */
function showLogin() {
  $("#login").classList.add("active");
  $("#app").hidden = true;
  const em = $("#email");
  if (em && !em.value) em.value = store.getItem("wardrobe.lastEmail") || "";
}
function showApp() {
  $("#login").classList.remove("active");
  $("#app").hidden = false;
}
function handleSignedOut() {
  saveSession(null);
  clearDataSnapshot();
  items = []; wears = []; outfits = []; outfitLinks = []; dataReady = false; _urlCache.clear();
  itemById = new Map(); outfitById = new Map(); outfitItemMap = new Map(); outfitWearMap = new Map();
  showLogin();
}

async function bootApp() {
  showApp();
  const fromSnapshot = await loadDataSnapshot();  // instant: whole app usable before any network
  switchTab("home");
  checkForNewVersion();   // fire-and-forget
  try {
    await loadData();
    prewarmUrlCache();    // fire-and-forget: batch-sign all photo URLs into cache
    prunePhotoCache();    // fire-and-forget: drop cached bytes for photos no item references
    rerenderRootAfterRefresh();  // user may have navigated off Home while data fetched
    maybeShowWhatsNew();  // first run of a new version → changelog toast
  } catch (e) {
    if (fromSnapshot) return;    // app already works on cached data — fail silently
    $("#homeBody").innerHTML = `<div class="placeholder"><b>Couldn't load data</b>
      <div class="err">${esc(e.message)}</div>
      <button class="btn" style="max-width:180px" onclick="retryLoad()">Retry</button></div>`;
  }
}
async function retryLoad() {
  $("#homeBody").innerHTML = `<div class="sk-list">${
    Array.from({length:5}).map(()=>`<div class="sk-row"><div class="sk sk-thumb"></div><div class="sk-lines"><div class="sk sk-line"></div><div class="sk sk-line short"></div></div></div>`).join("")
  }</div>`;
  try { await loadData(); prewarmUrlCache(); prunePhotoCache(); renderHome(); } catch (e) { toast(e.message); }
}
window.retryLoad = retryLoad;

/* ===================================================================
   INIT
   =================================================================== */
function currentTheme() {
  const t = store.getItem("wardrobe.theme");
  return t === "sage" ? "sage" : "editorial";
}
function applyTheme(t) {
  const theme = t === "sage" ? "sage" : "editorial";
  document.documentElement.setAttribute("data-theme", theme);
  store.setItem("wardrobe.theme", theme);
}
(function init() {
  applyTheme(currentTheme());
  $$(".appver").forEach(el => el.textContent = APP_VERSION);
  const savedCols = parseInt(store.getItem("wardrobe.gridCols") || "0");
  if (savedCols >= 2 && savedCols <= 5) gridCols = savedCols;
  const savedLookCols = parseInt(store.getItem("wardrobe.lookCols") || "0");
  if (savedLookCols >= 2 && savedLookCols <= 4) lookCols = savedLookCols;
  document.documentElement.style.setProperty("--look-cols", lookCols);
  ["closet", "search"].forEach(s => {
    const k = store.getItem(`wardrobe.sort.${s}`);
    if (k) _gridSortKeys[s] = k;
  });
  tripModeId = store.getItem(TRIP_MODE_KEY) || null;  // validated after loadData
  wireEvents();
  loadSession();
  if (session?.access_token) bootApp();
  else showLogin();
})();
