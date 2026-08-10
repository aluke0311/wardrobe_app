/* ===================================================================
   STYLE STATS
   =================================================================== */

let statsView = "main";
let statsField = null;
let statsGridItems = [];
let statsGridTitle = "";
let statsFromField = false;
let statsListKey = null;    // key of current smart list (to re-derive on filter change)
let statsDonutIdx = 0;      // active donut segment index
let statsFieldSort = "count"; // "count" | "name" — sort order for field breakdown list
let statsDateRange = "all"; // "all"|"7d"|"14d"|"30d"|"90d"|"6mo"|"1yr"
let statsAcqRange = "all";  // "all"|"1yr"|"2yr"|"3yr"|"5yr"
let statsSubtitleFn = null;  // optional fn(item)=>string shown on grid tiles
let statsOutfitsMode = "most-worn"; // "most-worn" | "liked-neglected" — which outfits list renderStatsOutfitsPage shows
let statsContextSel = null; // C2: selected context on the Contexts detail page
let statsReportField = null;  // "brand" | "retailer" — which report card is open
let statsReportSel = null;    // selected brand/retailer label on the report detail page
let statsReportSort = "best"; // "best" | "worst" — report list order
let statsFromReport = false;  // grid page was entered from a report detail (back returns there)
let statsFromPalette = false; // grid page was entered from the Palette page (back returns there)
// closet review state
let reviewField = null;      // current field key being dealt
let reviewQueue = [];        // item ids queued for the current field
let reviewIdx = 0;           // position in the queue
let _rvPending = null;       // value being edited inline on the current review card
let _reviewMoveMode = false; // move sheet opened from review (return to deal, not item view)

const PRICE_BRACKETS = [
  { label: "Less than $25",  min: 0,   max: 25 },
  { label: "$25 – $50",      min: 25,  max: 50 },
  { label: "$50 – $100",     min: 50,  max: 100 },
  { label: "$100 – $150",    min: 100, max: 150 },
  { label: "$150 – $200",    min: 150, max: 200 },
  { label: "$200 – $300",    min: 200, max: 300 },
  { label: "$300 – $500",    min: 300, max: 500 },
  { label: "$500 or more",   min: 500, max: Infinity },
];

const DONUT_PALETTE = [
  "#2f6fd0","#3a7d44","#7d54a8","#e08a2b","#c0392b","#1f8f8f",
  "#e6c34a","#7a5230","#e88aa8","#9a9a9a","#1a1a1a","#d8c4a0",
];

const STATS_FIELD_LABELS = {
  color_family: "Color", category: "Category", brand: "Brand", retailer: "Retailer",
  price: "Price", size: "Size", season: "Season", fabric: "Fabric", acquisition: "Acquisition",
};

function statsPool() {
  const acqCutoff = acqRangeStart();
  return items.filter(i => {
    if (!itemMatchesFilter(i, statsFilter)) return false;
    if (acqCutoff) {
      const pd = i.purchase_date;
      if (acqCutoff.older) { if (!pd || pd >= acqCutoff.cutoff) return false; }
      else                 { if (!pd || pd < acqCutoff.cutoff)  return false; }
    }
    return true;
  });
}

function rangeStart() {
  if (statsDateRange === "all") return null;
  const d = new Date();
  if (statsDateRange === "7d")  d.setDate(d.getDate() - 7);
  else if (statsDateRange === "14d") d.setDate(d.getDate() - 14);
  else if (statsDateRange === "30d") d.setDate(d.getDate() - 30);
  else if (statsDateRange === "90d") d.setDate(d.getDate() - 90);
  else if (statsDateRange === "6mo") d.setMonth(d.getMonth() - 6);
  else if (statsDateRange === "1yr") d.setFullYear(d.getFullYear() - 1);
  return localISO(d);
}

function wearCountInRange(itemId) {
  const cutoff = rangeStart();
  if (!cutoff) return wearCount(itemId);
  return new Set(wears.filter(w => w.item_id === itemId && w.worn_on >= cutoff)
    .map(w => w.worn_on)).size;
}

// Same numbers as wearCountInRange, but ONE pass over wears for the whole
// closet. The smart-list sorts call the per-item version inside a comparator,
// which is items × wears × log(items) work — ~34M row reads on a real closet,
// enough to freeze the tap for about a second. Build this once, look up from it.
// A wear is a DAY, in range or not (a piece worn twice in one day is one wear).
function wearCountMapInRange() {
  const cutoff = rangeStart();
  const m = new Map(), seen = new Set();
  for (const w of wears) {
    if (cutoff && w.worn_on < cutoff) continue;
    const k = w.item_id + "|" + w.worn_on;
    if (seen.has(k)) continue;
    seen.add(k);
    m.set(w.item_id, (m.get(w.item_id) || 0) + 1);
  }
  return m;
}

function acqRangeStart() {
  if (statsAcqRange === "all") return null;
  const older = statsAcqRange.startsWith("o");
  const period = statsAcqRange.slice(1); // "1yr","2yr","3yr","5yr"
  const d = new Date();
  if (period === "1yr") d.setFullYear(d.getFullYear() - 1);
  else if (period === "2yr") d.setFullYear(d.getFullYear() - 2);
  else if (period === "3yr") d.setFullYear(d.getFullYear() - 3);
  else if (period === "5yr") d.setFullYear(d.getFullYear() - 5);
  return { cutoff: localISO(d), older };
}

function statsActiveFilterCount() {
  let n = filterActiveCount(statsFilter);
  if (statsAcqRange !== "all") n++;
  return n;
}

function statsRebuild() {
  if (statsView === "grid") {
    if (statsListKey) {
      const result = buildSmartList(statsListKey);
      if (result) { statsGridItems = result.list; statsGridTitle = result.title; statsSubtitleFn = result.subtitleFn || null; }
    } else if (statsFromReport) {
      statsView = "report-detail"; statsGridItems = []; statsGridTitle = ""; statsFromReport = false;
    } else if (statsFromField) {
      statsView = "field"; statsGridItems = []; statsGridTitle = "";
    } else {
      statsView = "main"; statsField = null; statsGridItems = []; statsGridTitle = ""; statsFromField = false;
    }
  }
  renderStats();
}

function openStatsFilters() {
  openFilterSheet(statsFilter, {
    onApply: statsRebuild,
    title: "Filter",
    dims: STATS_FILTER_DIMS,
  });
}

function wireStatsToolbar() {
  const back = $("#stBack");
  if (back) back.addEventListener("click", statsNavBack);
  const flt = $("#stFilter");
  if (flt) flt.addEventListener("click", openStatsFilters);
  const rng = $("#stRange");
  if (rng) rng.addEventListener("click", openStatsRange);
}

function openStatsRange() {
  const acqChip = (val, label) =>
    `<button class="stats-catbtn${statsAcqRange === val ? " on" : ""}" data-sar="${val}">${esc(label)}</button>`;
  $("#statsRangeInner").innerHTML = `
    <div class="sheet-hdr">
      <span style="width:48px"></span>
      <h2>Range</h2>
      <button class="lnk" id="srDone" style="font-weight:700">Done</button>
    </div>
    <div style="padding-bottom:24px">
      <div class="sf-section"><div class="sf-label">Wear date range</div>
        ${RANGE_OPTIONS.map(([v, l]) => `<button class="sheet-row" data-srv="${v}">
          <span>${esc(l)}</span>
          ${statsDateRange === v ? `<svg class="rng-chk" viewBox="0 0 24 24"><path d="M5 12l5 5L19 7"/></svg>` : ""}
        </button>`).join("")}
      </div>
      <div class="sf-section"><div class="sf-label">Acquired within</div>
        <div class="stats-catbar">
          ${acqChip("all", "All time")} ${acqChip("w1yr", "1 year")} ${acqChip("w2yr", "2 years")}
          ${acqChip("w3yr", "3 years")} ${acqChip("w5yr", "5 years")}
        </div>
      </div>
      <div class="sf-section"><div class="sf-label">Acquired more than … ago</div>
        <div class="stats-catbar">
          ${acqChip("o1yr", "1 year")} ${acqChip("o2yr", "2 years")}
          ${acqChip("o3yr", "3 years")} ${acqChip("o5yr", "5 years")}
        </div>
      </div>
    </div>`;
  const close = () => { hideSheet("statsRangeSheet"); };
  $("#srDone").onclick = close;
  $("#statsRangeBg").onclick = close;
  $("#statsRangeInner").querySelectorAll("[data-srv]").forEach(btn => {
    btn.addEventListener("click", () => { statsDateRange = btn.dataset.srv; close(); statsRebuild(); });
  });
  $("#statsRangeInner").querySelectorAll("[data-sar]").forEach(btn => {
    btn.addEventListener("click", () => {
      statsAcqRange = btn.dataset.sar;
      btn.closest(".stats-catbar").querySelectorAll("[data-sar]").forEach(b =>
        b.classList.toggle("on", b.dataset.sar === statsAcqRange));
      statsRebuild();
    });
  });
  showSheet("statsRangeSheet");
}

const TOGGLE_GROUPS = {
  "most-worn":       { keys: ["least-worn", "most-worn"],           labels: ["Least Worn", "Most Worn"] },
  "least-worn":      { keys: ["least-worn", "most-worn"],           labels: ["Least Worn", "Most Worn"] },
  "best-cpw":        { keys: ["best-cpw",  "worst-cpw"],            labels: ["Best CPW", "Worst CPW"] },
  "worst-cpw":       { keys: ["best-cpw",  "worst-cpw"],            labels: ["Best CPW", "Worst CPW"] },
  "least-expensive": { keys: ["least-expensive", "most-expensive"], labels: ["Least Expensive", "Most Expensive"] },
  "most-expensive":  { keys: ["least-expensive", "most-expensive"], labels: ["Least Expensive", "Most Expensive"] },
  "workhorses":      { keys: ["declutter", "workhorses"],           labels: ["Declutter", "Workhorses"] },
  "declutter":       { keys: ["declutter", "workhorses"],           labels: ["Declutter", "Workhorses"] },
};
// lists whose date Range control is meaningful (wear-count based)
const RANGE_LISTS = ["never-worn", "most-worn", "least-worn", "best-cpw", "worst-cpw"];
// lists shown as number-only metric tiles (no item name)
const METRIC_LISTS = ["most-worn", "least-worn", "best-cpw", "worst-cpw", "least-expensive", "most-expensive"];
const RANGE_OPTIONS = [
  ["all", "All time"], ["7d", "Last 7 Days"], ["14d", "Last 14 Days"], ["30d", "Last 30 Days"],
  ["90d", "Last 90 Days"], ["6mo", "Last 6 Months"], ["1yr", "Last Year"],
];

// Closet Review: fields dealt one item at a time. `missing` = empty (or, for the
// date, a guessed value that wants confirming). `value` renders the current value.
// Derive a likely season from purchase_date month or wear history.
// Returns an array (e.g. ["Summer"]) or null if no data to guess from.
/* The review's season guess now defers to `itemSeasonSet` — the SAME derivation
   the rest of the app uses (Round D made it temperature-aware, so a piece worn
   on warm-weather trips derives Summer rather than the December the calendar
   saw). It used to run its own month-counting logic and lead with purchase
   date, so the review could confidently propose a season the app itself
   disagreed with. Purchase month is now only the last resort. */
function guessSeason(item) {
  const derived = itemSeasonSet(item);
  if (derived && derived.length) return derived;
  if (item.purchase_date) {
    const m = +String(item.purchase_date).slice(5, 7);
    return [m <= 2 || m === 12 ? "Winter" : m <= 5 ? "Spring" : m <= 8 ? "Summer" : "Fall"];
  }
  return null;
}

/* What she SET vs what the wear history says, for any item (her request:
   "all items to have derived season, and wardrobe review to compare between
   derived and selected"). `derivedSeasonSet` ignores the tag entirely, so a
   piece that already has a season can still be asked what the evidence says —
   which is the only way to notice the two have drifted apart. */
function seasonCompare(i) {
  const explicit = (i.season && i.season.length)
    ? SEASONS.filter(s => i.season.includes(s)) : null;
  const derived = derivedSeasonSet(i);
  const differs = !!explicit && !!derived
    && JSON.stringify(explicit) !== JSON.stringify(derived);
  return { explicit, derived, differs };
}

/* The one-tap answer is the UNION, never the derived set alone. Accepting a
   narrower derivation would silently delete a season she deliberately chose —
   "worn like Winter" for a piece tagged Winter+Summer means she hasn't worn it
   in summer yet, not that it isn't a summer piece. Additive by default,
   same rule as the item-page flag; narrowing stays a manual edit. */
const seasonCompareMerged = (i) => {
  const { explicit, derived } = seasonCompare(i);
  if (!derived) return explicit;
  return SEASONS.filter(s => (explicit || []).includes(s) || derived.includes(s));
};

function seasonCompareNote(i) {
  const { explicit, derived } = seasonCompare(i);
  if (!explicit || !derived) return null;
  const days = new Set(wears.filter(w => w.item_id === i.id && w.worn_on).map(w => w.worn_on)).size;
  const merged = seasonCompareMerged(i);
  const adds = merged.filter(s => !explicit.includes(s));
  const unworn = explicit.filter(s => !derived.includes(s));
  let s = `You set ${explicit.join(" + ")} · worn like ${derived.join(" + ")} over ${days} day${days === 1 ? "" : "s"}.`;
  if (adds.length) s += ` Saving adds ${adds.join(" + ")}.`;
  if (unworn.length) s += ` (${unworn.join(" + ")} kept — you just haven't worn it then.)`;
  return s + " Skip leaves it alone.";
}

// Why the guess says what it says — she asked to be able to see and revise the
// derivations this feature makes, and an unexplained guess isn't revisable.
function seasonGuessWhy(item) {
  const L = wxLog();
  const days = [...new Set(wears.filter(w => w.item_id === item.id && w.worn_on).map(w => w.worn_on))];
  const withWx = days.filter(d => L[d] && L[d].maxT != null);
  if (!days.length) return item.purchase_date ? "From when you bought it — it's never been worn" : null;
  if (!withWx.length) return `From the months you've worn it (${days.length} day${days.length === 1 ? "" : "s"}) — no weather on record for those days yet`;
  const temps = withWx.map(d => L[d].maxT).sort((a, b) => a - b);
  const awayN = withWx.filter(d => L[d].away).length;
  const lo = temps[0], hi = temps[temps.length - 1];
  return `Worn ${withWx.length} day${withWx.length === 1 ? "" : "s"} in ${lo}°–${hi}° weather`
    + (awayN ? ` · ${awayN} of them while you were away, counted as the season that felt like` : "");
}

const REVIEW_FIELDS = [
  { key: "image", label: "Photo", missing: i => !i.image_path,
    edit: i => pickItemPhoto(i.id), value: i => i.image_path ? "Added" : null },
  { key: "category", label: "Category", missing: i => !i.category,
    edit: i => openReviewMove(i), value: i => i.category || null },
  { key: "subcategory", label: "Subcategory", missing: i => !!i.category && !i.subcategory,
    edit: i => openReviewMove(i), value: i => i.subcategory || null },
  { key: "color_family", label: "Color", missing: i => !i.color_family,
    edit: i => openReviewField(i, "color_family"), value: i => i.color_family || null },
  { key: "size", label: "Size", missing: i => !i.size,
    edit: i => openReviewField(i, "size"), value: i => i.size || null },
  { key: "brand", label: "Brand", missing: i => !(i.brand && i.brand.trim()),
    edit: i => openReviewField(i, "brand"), value: i => i.brand || null },
  { key: "fabric", label: "Fabric", missing: i => !(i.fabric && i.fabric.length),
    edit: i => openReviewField(i, "fabric"), value: i => (i.fabric || []).join(", ") || null },
  { key: "season", label: "Season", missing: i => !(i.season && i.season.length),
    edit: i => openReviewField(i, "season"), value: i => (i.season || []).join(", ") || null,
    guess: i => guessSeason(i), guessLabel: "Worked out from the weather you've worn it in",
    note: i => seasonGuessWhy(i) },
  /* Not a missing field — a DISAGREEMENT between the season she set and the
     one her wear history implies. `guess` is the DERIVED set, so the inline
     chips arrive pre-filled with it and "Save & Next" accepts the evidence in
     one tap, while Skip keeps her own answer. This is the compare-and-reconcile
     surface she asked for. */
  { key: "season_check", label: "Season: yours vs worn", saveKey: "season",
    missing: i => seasonCompare(i).differs,
    edit: i => openReviewField(i, "season"),
    value: i => (i.season || []).join(", ") || null,
    guess: i => seasonCompareMerged(i),
    note: i => seasonCompareNote(i) },
  { key: "retailer", label: "Retailer", missing: i => !(i.retailer && i.retailer.trim()),
    edit: i => openReviewField(i, "retailer"), value: i => i.retailer || null },
  { key: "acquisition", label: "Acquisition", missing: i => !i.acquisition,
    edit: i => openReviewField(i, "acquisition"), value: i => i.acquisition || null },
  { key: "price", label: "Price", missing: i => i.price == null || i.price === "",
    edit: i => openReviewField(i, "price"), value: i => (i.price != null && i.price !== "") ? money(i.price) : null },
  { key: "formality", label: "Formality",
    missing: i => !i.formality || (Array.isArray(i.formality) && !i.formality.length),
    edit: i => openReviewField(i, "formality"),
    value: i => {
      if (!i.formality) return null;
      const s = Array.isArray(i.formality) ? i.formality : [+i.formality];
      return s.length ? s.map(n => `${n}. ${occLabel(n)}`).join(", ") : null;
    },
    guess: i => itemFormalitySet(i), guessLabel: "Estimated from item type & similar outfits"
  },
  { key: "purchase_date", label: "Purchase Date",
    missing: i => !i.purchase_date,
    edit: i => openReviewDateEdit(i),
    value: i => i.purchase_date
      ? new Date(i.purchase_date + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
      : null },
];

function reviewPool() { return items.filter(i => itemStatus(i) === "Available"); }
function reviewCount(f) { return reviewPool().filter(f.missing).length; }
function reviewTotalItems() { return reviewPool().filter(i => REVIEW_FIELDS.some(f => f.missing(i))).length; }

function dateRangeHuman() {
  const map = { "7d": "7 days", "14d": "14 days", "30d": "30 days", "90d": "90 days", "6mo": "6 months", "1yr": "1 year" };
  return map[statsDateRange] || statsDateRange;
}

function buildSmartList(key) {
  const av = statsPool();
  const wcMap = wearCountMapInRange();
  const wc = id => wcMap.get(id) || 0;
  const wornSub = item => { const n = wc(item.id); return n === 0 ? "0 wears" : `${n} wear${n === 1 ? "" : "s"}`; };
  if (key === "never-worn") {
    const title = statsDateRange === "all" ? "Never Worn" : `Not Worn · past ${dateRangeHuman()}`;
    return { list: av.filter(i => wc(i.id) === 0), title };
  }
  if (key === "most-worn")
    return { list: [...av].sort((a, b) => wc(b.id) - wc(a.id)).slice(0, 100),
      title: "Worn History", subtitleFn: wornSub };
  if (key === "least-worn")
    return { list: [...av].sort((a, b) => wc(a.id) - wc(b.id)).slice(0, 100),
      title: "Worn History", subtitleFn: wornSub };
  if (key === "best-cpw" || key === "worst-cpw") {
    // range-aware CPW: price / wears within the active range
    const cpwR = item => { const n = wc(item.id); return n ? parseFloat(item.price) / n : null; };
    const cpwSub = item => { const c = cpwR(item); return c != null ? money(c) : ""; };
    const withWears = av.filter(i => i.price && wc(i.id) > 0);
    const sorted = key === "best-cpw"
      ? withWears.sort((a, b) => (cpwR(a) || Infinity) - (cpwR(b) || Infinity))
      : withWears.sort((a, b) => (cpwR(b) || 0) - (cpwR(a) || 0));
    return { list: sorted.slice(0, 100), title: "Cost per Wear", subtitleFn: cpwSub };
  }
  if (key === "most-expensive" || key === "least-expensive") {
    const priceSub = item => { const p = parseFloat(item.price); return isNaN(p) ? "" : money(p); };
    // Least Expensive excludes $0/free items (gifts, unpriced) so the list is useful.
    const withPrice = av.filter(i => {
      const p = parseFloat(i.price);
      if (i.price == null || isNaN(p)) return false;
      return key === "least-expensive" ? p > 0 : true;
    });
    const sorted = key === "most-expensive"
      ? withPrice.sort((a, b) => parseFloat(b.price) - parseFloat(a.price))
      : withPrice.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
    return { list: sorted.slice(0, 100), title: "Purchase Price", subtitleFn: priceSub };
  }
  if (key === "best-potential") {
    const cpwFmt = n => n >= 10 ? "$" + Math.round(n) : money(n);
    return {
      list: av.filter(i => i.price && wearCount(i.id) > 0)
        .sort((a, b) => {
          const na = wearCount(a.id), nb = wearCount(b.id);
          return (b.price / (nb * (nb + 1))) - (a.price / (na * (na + 1)));
        }).slice(0, 100),
      title: "Best Potential Improvement",
      subtitleFn: item => {
        const n = wearCount(item.id);
        if (!item.price || !n) return "";
        return cpwFmt(item.price / n) + " → " + cpwFmt(item.price / (n + 1)) + "/wear";
      },
    };
  }
  if (key === "recent") {
    const acqSub = item => {
      if (!item.purchase_date) return "";
      const d = new Date(item.purchase_date + "T00:00:00");
      return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
    };
    // most recently acquired by purchase_date (no hard window — always shows items)
    return { list: av.filter(i => i.purchase_date)
      .sort((a, b) => b.purchase_date.localeCompare(a.purchase_date)).slice(0, 100),
      title: "Recently Acquired", subtitleFn: acqSub };
  }
  if (key === "workhorses") {
    // Highest wear index vs similar items, among pieces with a real track record.
    const per = buildItemPerf(reportPool());
    const list = av.filter(i => { const p = per.get(i.id); return p && p.count >= 3 && p.idx != null; })
      .sort((a, b) => per.get(b.id).idx - per.get(a.id).idx).slice(0, 100);
    return { list, title: "Workhorses",
      subtitleFn: i => { const p = per.get(i.id); return `${p.count} wear${p.count === 1 ? "" : "s"} · ${fmtReportIdx(p.idx)}`; } };
  }
  if (key === "declutter") {
    // Removal candidates: owned 6+ months, not in any liked look, and either
    // never worn or badly under-worn for their type and not touched in 90+ days.
    // Never-worn lead (longest owned first), then lowest index. Transparent
    // sort, no composite score — she can see exactly why each item is here.
    const per = buildItemPerf(reportPool());
    const liked = likedLookItemIds();
    const pool = reportPool().filter(i => {
      if (itemStatus(i) === "Archive") return false;
      const p = per.get(i.id);
      if (!p || p.months < 6 || liked.has(i.id)) return false;
      if (p.count === 0) return true;
      const lw = lastWorn(i.id);
      return p.idx != null && p.idx < 0.5 && (!lw || daysSince(lw) >= 90);
    });
    pool.sort((a, b) => {
      const pa = per.get(a.id), pb = per.get(b.id);
      if ((pa.count === 0) !== (pb.count === 0)) return pa.count === 0 ? -1 : 1;
      if (pa.count === 0) return pb.months - pa.months;
      return (pa.idx ?? 0) - (pb.idx ?? 0);
    });
    return { list: pool.slice(0, 100), title: "Declutter Candidates",
      subtitleFn: i => {
        const p = per.get(i.id);
        if (p.count === 0) return `never worn · owned ${Math.round(p.months)} mo`;
        const st = itemStatus(i) === "Storage" ? " · storage" : "";
        return `${p.count} wear${p.count === 1 ? "" : "s"} · ${fmtReportIdx(p.idx)} · last ${relDate(lastWorn(i.id))}${st}`;
      } };
  }
  return null;
}

// Items that appear in at least one liked look — a "love" signal that shields
// them from declutter suggestions.
function likedLookItemIds() {
  const s = new Set();
  for (const o of outfits) if (o.rating === 1) for (const id of (outfitItemMap.get(o.id) || [])) s.add(id);
  return s;
}

/* Body is ONE scroll container shared by every screen (window.scrollTo is a
   no-op here), so moving from a long page to a short one leaves you halfway
   down it — Stats main is long and its rows sit near the bottom, so tapping one
   opened the child page already scrolled. Fixed at the dispatcher because it's
   the only place that can tell NAVIGATION (statsView changed → go to top) from
   a RE-RENDER of the same view (filter chip, range change, toggle → stay put).
   Backing out to main restores the row she left from. */
let _statsLastView = null;
let _statsEntryScroll = 0;
function renderStats() {
  const nav = _statsLastView !== statsView;
  if (nav && _statsLastView === "main") _statsEntryScroll = getScrollTop();
  _statsLastView = statsView;
  _renderStatsView();
  if (!nav) return;                                  // same view redrawing — leave scroll alone
  if (statsView === "main" && _statsEntryScroll) { restoreScroll(_statsEntryScroll); _statsEntryScroll = 0; }
  else scrollToTop();
}

function _renderStatsView() {
  if (statsView === "field")       { renderStatsFieldPage();   return; }
  if (statsView === "grid")        { renderStatsGridPage();    return; }
  if (statsView === "outfits")     { renderStatsOutfitsPage(); return; }
  if (statsView === "contexts")    { renderStatsContextsPage(); return; }
  if (statsView === "gap")         { renderStatsGapPage();      return; }
  if (statsView === "rotation")    { renderStatsRotationPage(); return; }
  if (statsView === "wrapped")     { renderStatsWrapped();      return; }
  if (statsView === "month")       { renderStatsMonthPage();   return; }
  if (statsView === "flagged")     { renderStatsFlaggedPage(); return; }
  if (statsView === "pixels")      { renderStatsPixelsPage();  return; }
  if (statsView === "palette")     { renderStatsPalettePage(); return; }
  if (statsView === "missing")     { renderStatsMissingPage(); return; }
  if (statsView === "misfit")      { renderStatsMisfitPage();  return; }
  if (statsView === "travel")      { renderStatsTravelPage();  return; }
  if (statsView === "context-detail") { renderStatsContextDetailPage(); return; }
  if (statsView === "report")        { renderStatsReportPage();       return; }
  if (statsView === "report-detail") { renderStatsReportDetailPage(); return; }
  if (statsView === "review")      { renderReviewLanding();    return; }
  if (statsView === "review-deal") { renderReviewDeal();       return; }
  renderStatsMain();
}

// hideFilter: for pages whose pool is deliberately NOT statsPool() (Rotation),
// where a funnel that silently changes nothing is worse than no funnel.
function statsToolbar(title, showBack, showRange, hideFilter = false) {
  const n = hideFilter ? 0 : statsActiveFilterCount();
  // Root drops the duplicated title (see clToolbar). A filter-less root has
  // nothing left to show, so it renders no row at all.
  const rangeLbl = statsDateRange === "all" ? "Range" : dateRangeHuman();
  if (hideFilter) {
    if (!showBack) return "";
    /* ⚠️ hideFilter USED TO SWALLOW showRange (2026-08-10 r4). The signature
       offers them as independent flags and this branch ignored the second, so
       "whole-wardrobe numbers, but still scoped to a date range" — which is
       exactly what the Contexts page is — could not be expressed, and hiding a
       decorative funnel there would have silently taken the working range
       button with it. Every pre-existing hideFilter caller passes
       showRange=false, so honouring it changes nothing that already shipped. */
    return `<div class="cltoolbar">
      <button class="clback" id="stBack"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
      <div class="cltitle">${esc(title)}</div>
      ${showRange
        ? `<button class="lnk" id="stRange" style="font-size:15px;white-space:nowrap;padding:0 6px">${esc(rangeLbl)}</button>`
        : `<span style="width:34px"></span>`}
    </div>`;
  }
  return `<div class="cltoolbar${showBack ? "" : " tb-root"}">
    ${showBack ? `<button class="clback" id="stBack"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
      <div class="cltitle">${esc(title)}</div>` : ""}
    ${showRange ? `<button class="lnk" id="stRange" style="font-size:15px;white-space:nowrap;padding:0 6px">${esc(rangeLbl)}</button>` : ""}
    <button class="clsearch" id="stFilter" style="position:relative" title="Filters">
      <svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
      ${n ? `<span class="filter-badge">${n}</span>` : ""}
    </button>
    ${n ? (_funnelClearFns.stFilter = { state: statsFilter, onClear: statsRebuild },
      `<button class="cb-x" data-funnel-clear="stFilter" title="Clear filters" style="width:24px;height:24px;color:var(--muted)">✕</button>`) : ""}
  </div>`;
}

function statsNavBack() {
  statsListKey = null; statsSubtitleFn = null;
  statsDateRange = "all";   // range is per-page; reset when navigating
  if (statsView === "review-deal") {
    statsView = "review"; reviewField = null; reviewQueue = []; reviewIdx = 0;
    renderStats(); return;
  }
  if (statsView === "review") { statsView = "main"; renderStats(); return; }
  if (statsView === "context-detail") { statsView = "contexts"; statsContextSel = null; renderStats(); return; }
  if (statsView === "report-detail") { statsView = "report"; statsReportSel = null; renderStats(); return; }
  if (statsView === "report") { statsView = "main"; statsReportField = null; renderStats(); return; }
  if (statsView === "grid" && statsFromReport) {
    statsView = "report-detail"; statsGridItems = []; statsGridTitle = ""; statsFromReport = false;
  } else if (statsView === "grid" && statsFromPalette) {
    statsView = "palette"; statsGridItems = []; statsGridTitle = ""; statsFromPalette = false;
  } else if (statsView === "grid" && statsFromField) {
    statsView = "field"; statsGridItems = []; statsGridTitle = "";
  } else {
    statsView = "main"; statsField = null;
    statsGridItems = []; statsGridTitle = "";
    statsFromField = false; statsFromReport = false; statsFromPalette = false;
  }
  renderStats();
}

function getFieldGroups(field) {
  const avail = statsPool();
  const noValue = [];
  const groups = {};
  const add = (label, item) => { if (!groups[label]) groups[label] = []; groups[label].push(item); };
  for (const item of avail) {
    if (field === "color_family") {
      if (!item.color_family) { noValue.push(item); continue; }
      add(item.color_family, item);
    } else if (field === "category") {
      if (!item.category) { noValue.push(item); continue; }
      add(item.category, item);
    } else if (field === "brand") {
      if (!item.brand || !item.brand.trim()) { noValue.push(item); continue; }
      add(item.brand.trim(), item);
    } else if (field === "price") {
      const p = parseFloat(item.price);
      if (!item.price || isNaN(p)) { noValue.push(item); continue; }
      const b = PRICE_BRACKETS.find(b => p >= b.min && p < b.max);
      if (b) add(b.label, item);
    } else if (field === "size") {
      if (!item.size) { noValue.push(item); continue; }
      add(item.size, item);
    } else if (field === "season") {
      if (!item.season || !item.season.length) { noValue.push(item); continue; }
      for (const s of item.season) add(s, item);
    } else if (field === "fabric") {
      if (!item.fabric || !item.fabric.length) { noValue.push(item); continue; }
      for (const f of item.fabric) add(f, item);
    } else if (field === "retailer") {
      if (!item.retailer || !item.retailer.trim()) { noValue.push(item); continue; }
      add(item.retailer.trim(), item);
    } else if (field === "acquisition") {
      if (!item.acquisition) { noValue.push(item); continue; }
      add(item.acquisition, item);
    }
  }
  let sorted;
  if (field === "price") sorted = PRICE_BRACKETS.map(b => ({ label: b.label, items: groups[b.label] || [] }));
  else if (field === "season") sorted = SEASONS.map(s => ({ label: s, items: groups[s] || [] })).filter(g => g.items.length);
  else if (field === "category") sorted = CATEGORIES.map(c => ({ label: c, items: groups[c] || [] })).filter(g => g.items.length);
  else sorted = Object.entries(groups).map(([label, items]) => ({ label, items })).sort((a, b) => b.items.length - a.items.length);
  return { noValue, groups: sorted };
}

function segmentColor(field, label, idx) {
  return field === "color_family" ? colorHex(label) : DONUT_PALETTE[idx % DONUT_PALETTE.length];
}

function donutSvgHighlight(segments, activeIdx) {
  const total = segments.reduce((s, x) => s + x.count, 0);
  if (!total) return "";
  const cx = 80, cy = 80, R = 72, r = 54, gap = total > 1 ? 0.018 : 0;
  let paths = "", angle = -Math.PI / 2;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg.count) continue;
    const sweep = (seg.count / total) * Math.PI * 2 - gap;
    if (sweep <= 0) continue;
    const a2 = angle + sweep;
    const x1 = cx + R * Math.cos(angle), y1 = cy + R * Math.sin(angle);
    const x2 = cx + R * Math.cos(a2),    y2 = cy + R * Math.sin(a2);
    const x3 = cx + r * Math.cos(a2),    y3 = cy + r * Math.sin(a2);
    const x4 = cx + r * Math.cos(angle), y4 = cy + r * Math.sin(angle);
    const lg = sweep > Math.PI ? 1 : 0;
    const op = segments.length <= 1 ? 1 : (i === activeIdx ? 1 : 0.22);
    paths += `<path class="dseg" d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 ${lg} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} L${x3.toFixed(1)} ${y3.toFixed(1)} A${r} ${r} 0 ${lg} 0 ${x4.toFixed(1)} ${y4.toFixed(1)}Z" fill="${seg.color}" style="opacity:${op};transition:opacity .15s"/>`;
    angle = a2 + gap;
  }
  return `<svg width="160" height="160" viewBox="0 0 160 160" style="display:block;flex-shrink:0;filter:drop-shadow(0 2px 6px rgba(33,29,26,.12))">${paths}</svg>`;
}

function wireDonutArrows(segments, total) {
  const upBtn = document.getElementById("donutUp");
  const dnBtn = document.getElementById("donutDn");
  if (!upBtn || !segments.length) return;
  const update = () => {
    document.querySelectorAll(".dseg").forEach((p, i) => {
      p.style.opacity = segments.length <= 1 ? 1 : (i === statsDonutIdx ? 1 : 0.22);
    });
    const seg = segments[statsDonutIdx];
    const lbl = document.getElementById("donutLbl");
    if (lbl && seg) lbl.innerHTML = `<div style="font-size:20px;font-weight:700;line-height:1.2">${esc(seg.label)}</div>
      <div class="muted" style="font-size:15px;margin-top:4px">${total ? ((seg.count/total)*100).toFixed(1) : 0}%</div>`;
    // highlight matching list row
    document.querySelectorAll("#statsBody [data-sv]:not([data-sf])").forEach(btn => {
      const active = seg && btn.dataset.sv === seg.label;
      btn.classList.toggle("donut-hi", active);
      if (active) btn.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };
  upBtn.addEventListener("click", () => { statsDonutIdx = (statsDonutIdx - 1 + segments.length) % segments.length; update(); });
  dnBtn.addEventListener("click", () => { statsDonutIdx = (statsDonutIdx + 1) % segments.length; update(); });
}

/* The one threshold both "does my closet match my life" surfaces answer to: the
   Closet vs Life page's verdict and rows already used a hard 0.05, and the main
   page's block used nothing at all. Shared so the two can never drift back into
   contradicting each other. Five percentage points of the closet is the smallest
   gap worth a sentence. */
const CLOSET_VS_LIFE_MIN_GAP = 0.05;

function closetVsLifeHtml() {
  const avail = items.filter(i => itemStatus(i) === "Available");
  if (!avail.length || !wears.length) return "";

  // Supply: count items across all levels in their set
  const supply = new Array(8).fill(0);
  for (const i of avail) { for (const l of (itemFormalitySet(i) || [])) supply[l - 1]++; }
  const supplyTotal = supply.reduce((a, b) => a + b, 0) || 1;

  // Demand: count wears by the formality set of each worn item
  const demand = new Array(8).fill(0);
  for (const w of wears) {
    const it = itemById.get(w.item_id);
    if (!it) continue;
    for (const l of (itemFormalitySet(it) || [])) demand[l - 1]++;
  }
  const demandTotal = demand.reduce((a, b) => a + b, 0) || 1;

  /* ⚠️ A NOISE FLOOR, AND IT USED TO CONTRADICT THE CLOSET VS LIFE PAGE
     (2026-08-08, audit). `biggestGap` started at 0 and any positive gap won, so
     with a handful of workout pieces she never logs — 3.4% of the closet, 0.0%
     of wears — this block announced "your closet skews Utility" while the
     Closet vs Life page, one tap away, said "no big gaps". Two screens, one
     question, opposite answers.

     They are NOT the same derivation and must not be merged: this one is about
     FORMALITY LEVELS (do I own clothes at levels I don't wear), the gap page is
     about CONTEXTS (is there a part of my life the closet can't dress). Both are
     worth having. What they can't do is disagree about whether anything is
     wrong — so this one now uses the gap page's own threshold, and says which
     question it is answering. Every other derivation in this app carries a
     minimum (WX_PROFILE_MIN, RHYTHM_MIN_DAYS, GAP_MIN_CTX_DAYS…); this was the
     one that didn't. */
  let biggestGap = CLOSET_VS_LIFE_MIN_GAP, gapLevel = -1;
  for (let i = 0; i < 8; i++) {
    const gap = supply[i] / supplyTotal - demand[i] / demandTotal;
    if (gap > biggestGap) { biggestGap = gap; gapLevel = i; }
  }

  const LEVEL_COLORS = ["#7c8cf8","#60b8d4","#6abf8a","#a8d96a","#f0b429","#e07d42","#c05c7e","#8b5cf6"];
  const rows = OCCASION_LADDER.map((lbl, i) => {
    const sp = supply[i] / supplyTotal;
    const dm = demand[i] / demandTotal;
    const color = LEVEL_COLORS[i];
    return `<div style="margin-bottom:11px">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:3px">
        <span>${i + 1}. ${esc(lbl)}</span>
        <span>${Math.round(sp * 100)}% owned · ${Math.round(dm * 100)}% worn</span>
      </div>
      <div style="position:relative;height:8px;background:var(--line);border-radius:4px;overflow:hidden">
        <div style="position:absolute;top:0;left:0;height:100%;width:${sp * 100}%;background:${color};opacity:.35;border-radius:4px"></div>
        <div style="position:absolute;top:0;left:0;height:100%;width:${dm * 100}%;background:${color};border-radius:4px"></div>
      </div>
    </div>`;
  }).join("");

  /* ⚠️ A FACT, NOT ADVICE. "Consider wearing those pieces more" was the app
     telling her what to do, which it refuses to do everywhere else — "packed 3×,
     worn 0×", "worth a second look", the flag-for-review consequences and the
     removal of wash orders are all the same rule. It also named a whole-closet
     verdict ("your closet skews X") off a single level's share. It now states
     the level, both numbers, and stops. */
  const insight = gapLevel >= 0
    ? `You own more <b>${OCCASION_LADDER[gapLevel]}</b> than you wear — ${Math.round(supply[gapLevel] / supplyTotal * 100)}% of the closet, ${Math.round(demand[gapLevel] / demandTotal * 100)}% of your wears.`
    : "Your closet and wear habits look well-balanced.";

  return `<div class="stats-sec">
    <div class="stats-sec-hdr">
      <div class="t">Closet vs. Your Life</div>
      <div class="s">Supply (light) vs. wear demand (solid)</div>
    </div>
    <div class="stats-sec-body" style="padding:14px 16px 10px">
      ${rows}
      <div style="font-size:13px;color:var(--muted);margin-top:4px">${insight}</div>
    </div>
  </div>`;
}

/* Rotation: one number for "am I actually wearing my closet". Uses the full
   Available closet, NOT statsPool() — the whole point is the denominator being
   everything wearable, so a filter can't flatter it. Window is session-only. */
let statsRotationDays = 90;
// "Your week" — the shape the wear log already knows about, shown plainly.
// Renders nothing when no weekday clears the ≥3-day floor (a new closet, or a
// life without a routine, shouldn't get a fabricated one).
function weekRhythmBlockHtml() {
  const r = weeklyRhythm();
  if (!r.size) return "";
  const rows = [1, 2, 3, 4, 5, 6, 0].map(dow => {
    const e = r.get(dow);
    return `<div style="display:flex;align-items:baseline;gap:10px;padding:3px 0">
      <span style="width:38px;flex:none;font-size:12.5px;font-weight:600;color:var(--muted)">${WEEKDAY_SHORT[dow]}</span>
      <span style="flex:1;min-width:0;font-size:13.5px;${e ? "" : "color:var(--muted)"}">${e ? esc(e.contexts.join(" · ")) : "—"}</span>
      ${e ? `<span style="flex:none;font-size:11.5px;color:var(--muted)">${e.n} day${e.n === 1 ? "" : "s"}</span>` : ""}
    </div>`;
  }).join("");
  return `<button data-sa="looks:contexts" style="display:block;width:100%;text-align:left;padding:12px 16px;border-bottom:1px solid var(--line)">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <span style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)">Your week</span>
      <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
    </div>
    ${rows}
  </button>`;
}

function rotationBlockHtml() {
  const r = buildRotationStats(statsRotationDays);
  const chips = ROTATION_WINDOWS.map(d =>
    `<button class="rot-chip${d === statsRotationDays ? " on" : ""}" data-rot="${d}">${d === 365 ? "1y" : d + "d"}</button>`
  ).join("");
  const label = statsRotationDays === 365 ? "the past year" : `the past ${statsRotationDays} days`;
  return `<div class="rot-block">
    <div class="rot-top">
      <span class="rot-lbl">Rotation</span>
      <span class="rot-chips">${chips}</span>
    </div>
    <button class="rot-open" data-rot-open>
      <div class="rot-bar"><span style="width:${r.pct}%"></span></div>
      <div class="rot-sub"><strong>${r.pct}%</strong> of your closet worn in ${label} · ${r.worn} of ${r.total} items
        <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></div>
    </button>
  </div>`;
}

// Window chips swap the block in place — no full stats re-render (and no photo
// flicker) just to change a denominator. The bar itself drills in.
function wireRotationChips() {
  $("#statsBody").querySelectorAll("[data-rot]").forEach(el => {
    el.addEventListener("click", () => {
      statsRotationDays = Number(el.dataset.rot);
      const blk = $("#statsBody").querySelector(".rot-block");
      if (!blk) return;
      blk.outerHTML = rotationBlockHtml();
      wireRotationChips();
    });
  });
  const open = $("#statsBody").querySelector("[data-rot-open]");
  if (open) open.addEventListener("click", () => { statsView = "rotation"; renderStats(); });
}

/* Rotation drill-in: same window as the block above, but showing WHICH pieces —
   the ones that came out, or the ones that sat it out. Two sides of one number,
   so it's a toggle, not two list pages. Pool stays the full Available closet
   (see rotationBlockHtml) — hence no filter funnel on this page. */
let statsRotationMode = "worn";   // "worn" | "unworn"

function renderStatsRotationPage() {
  const body = $("#statsBody");
  const r = buildRotationStats(statsRotationDays);
  const worn = [], unworn = [];
  for (const i of r.pool) (r.wornIds.has(i.id) ? worn : unworn).push(i);
  // Worn: freshest first. Not worn: coldest first, so never-worn leads.
  const lw = id => lastWorn(id) || "";
  worn.sort((a, b) => lw(b.id).localeCompare(lw(a.id)));
  unworn.sort((a, b) => lw(a.id).localeCompare(lw(b.id)));

  const showWorn = statsRotationMode === "worn";
  const list = showWorn ? worn : unworn;
  const pct = showWorn ? r.pct : 100 - r.pct;
  const label = statsRotationDays === 365 ? "the past year" : `the past ${statsRotationDays} days`;
  const chips = ROTATION_WINDOWS.map(d =>
    `<button class="rot-chip${d === statsRotationDays ? " on" : ""}" data-rot="${d}">${d === 365 ? "1y" : d + "d"}</button>`
  ).join("");

  const sub = (i) => {
    const last = lastWorn(i.id);
    if (!last) return "never worn";
    if (!showWorn) return `last worn ${relDate(last)}`;
    const n = r.counts.get(i.id) || 0;
    return `${n} day${n === 1 ? "" : "s"} · last ${relDate(last)}`;
  };

  body.innerHTML = statsToolbar("Rotation", true, false, true)
    + `<div class="rot-block">
        <div class="rot-top">
          <span class="rot-lbl">${showWorn ? "Worn" : "Not worn"} in ${esc(label)}</span>
          <span class="rot-chips">${chips}</span>
        </div>
        <div class="rot-bar"><span style="width:${pct}%"></span></div>
        <div class="rot-sub"><strong>${pct}%</strong> of your closet · ${list.length} of ${r.total} items</div>
      </div>`
    + gridHtml(list, sub)
    + `<div style="height:90px"></div>
       <div class="stats-toggle-float"><div class="stats-seg">
         <button class="${showWorn ? "on" : ""}" data-rotmode="worn">Worn ${worn.length}</button>
         <button class="${showWorn ? "" : "on"}" data-rotmode="unworn">Not worn ${unworn.length}</button>
       </div></div>`;
  positionToast();   // a toast already up would otherwise sit on the toggle
  wireStatsToolbar();
  body.querySelectorAll("[data-rot]").forEach(el => el.addEventListener("click", () => {
    statsRotationDays = Number(el.dataset.rot); renderStats();
  }));
  body.querySelectorAll("[data-rotmode]").forEach(el => el.addEventListener("click", () => {
    statsRotationMode = el.dataset.rotmode; renderStats();
  }));
  body.querySelectorAll(".gtile").forEach(btn => {
    btn.addEventListener("click", () => { if (btn.dataset.item) openItemFromStats(btn.dataset.item); });
  });
  hydratePhotos(body);
}

function renderStatsMain() {
  const avail = statsPool();
  const totalVal = avail.reduce((s, i) => s + (parseFloat(i.price) || 0), 0);
  const totalOutfitItems = [...outfitItemMap.values()].reduce((s, a) => s + a.length, 0);
  const avgItems = outfits.length ? (totalOutfitItems / outfits.length).toFixed(1) : "—";
  const colorBar = (() => {
    const counts = {};
    for (const i of avail) if (i.color_family) counts[i.color_family] = (counts[i.color_family] || 0) + 1;
    const tot = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, n]) =>
      `<span style="flex:${(n/tot*100).toFixed(1)};background:${colorHex(name)};display:inline-block;height:100%"></span>`
    ).join("");
  })();
  const neverWornMap = wearCountMapInRange();
  const neverWorn = avail.filter(i => !neverWornMap.get(i.id)).length;
  const declutterCount = (buildSmartList("declutter") || { list: [] }).list.length;
  const rangeTag = statsDateRange === "all" ? "" : ` · past ${dateRangeHuman()}`;
  const notLoggedLabel = statsDateRange === "all" ? "Never Worn" : `Not Worn${rangeTag}`;
  const wornSub = `Most & Least worn${rangeTag}`;
  const topLook = activeOutfits().sort((a, b) => outfitWornCount(b) - outfitWornCount(a))[0];
  const topLookSub = topLook ? `Most worn: ${outfitWornCount(topLook)} time${outfitWornCount(topLook) === 1 ? "" : "s"}` : "By wear count";
  const likedCount = activeOutfits().filter(o => o.rating === 1).length;
  const neglectedCount = likedNeglectedOutfits().length;
  const ctxCount = new Set(wears.flatMap(w => ctxArr(w))).size;
  const contextsRowSub = ctxCount ? `${ctxCount} context${ctxCount === 1 ? "" : "s"} logged` : "By occasion";
  const reviewToReview = reviewTotalItems();
  const row = (label, sub, action) =>
    `<button class="frow" data-sa="${esc(action)}">
      <div class="fmeta"><div class="fname">${esc(label)}</div>${sub ? `<div class="fcount">${esc(sub)}</div>` : ""}</div>
      <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
    </button>`;

  $("#statsBody").innerHTML = `
    ${statsToolbar("Style Stats", false, true)}
    <div style="padding-bottom:32px">
      ${closetVsLifeHtml()}
      <div class="stats-sec">
        <div class="stats-sec-hdr"><div class="t">Clothing Stats</div><div class="s">All about your wardrobe</div></div>
        <div class="stats-sec-body">
          <div class="kpi-row" style="border-bottom:1px solid var(--line)">
            <div class="kpi-cell"><div class="kpi-val">${avail.length}</div><div class="kpi-lbl">Item Count</div></div>
            <div class="kpi-cell"><div class="kpi-val">${money(totalVal)}</div><div class="kpi-lbl">Total Closet Value</div></div>
          </div>
          ${rotationBlockHtml()}
          <button class="frow" data-sa="field:color_family">
            <div style="flex:1"><div class="fld" style="margin-bottom:6px">Color</div>
              <div style="height:12px;border-radius:6px;overflow:hidden;display:flex">${colorBar}</div>
            </div>
            <svg class="chev" viewBox="0 0 24 24" style="flex-shrink:0;margin-left:10px"><path d="M9 6l6 6-6 6"/></svg>
          </button>
          ${row("Recently Acquired",         "Most recent first",                                "list:recent")}
          ${row(notLoggedLabel,              `${neverWorn} item${neverWorn !== 1 ? "s" : ""}`,    "list:never-worn")}
          ${row("Worn History",              wornSub,                                             "list:most-worn")}
          ${row("Cost per Wear",             "Best & Worst $/wear",                               "list:best-cpw")}
          ${row("Purchase Price",            "Most & least expensive",                            "list:least-expensive")}
          ${row("Best Potential Improvement","One more wear → biggest CPW drop",                  "list:best-potential")}
          ${row("Workhorses",                "Your highest-performing pieces",                    "list:workhorses")}
          ${row("Declutter Candidates",      declutterCount ? `${declutterCount} removal candidate${declutterCount === 1 ? "" : "s"}` : "Nothing to remove right now", "list:declutter")}
          ${(() => {
            const t = completedTrips().length;
            return row("Travel", t ? `What you pack vs what you wear · ${t} trip${t === 1 ? "" : "s"}` : "What you pack vs what you actually wear", "travel");
          })()}
        </div>
        <div class="stats-note">Total Closet Value and Item Count exclude archived items.</div>
      </div>

      <div class="stats-sec">
        <div class="stats-sec-hdr"><div class="t">Looks Stats</div><div class="s">How you wear your outfits</div></div>
        <div class="stats-sec-body">
          <div class="kpi-row" style="border-bottom:1px solid var(--line)">
            <div class="kpi-cell"><div class="kpi-val">${outfits.length}</div><div class="kpi-lbl">Outfit Count</div></div>
            <div class="kpi-cell"><div class="kpi-val">${avgItems}</div><div class="kpi-lbl">Avg. Items per Look</div></div>
          </div>
          ${row("Most Worn Looks", topLookSub, "looks:most-worn")}
          ${row("Liked Looks", `${likedCount} look${likedCount === 1 ? "" : "s"}${neglectedCount ? ` · ${neglectedCount} neglected` : ""}`, "looks:liked-neglected")}
          ${weekRhythmBlockHtml()}
          ${row("Contexts", contextsRowSub, "looks:contexts")}
          ${row("Closet vs Life", "Where the closet over- and under-serves your week", "gap")}
          ${row("Palette", "Your closet's color mix vs the mix you actually wear", "palette")}
          ${row("What's missing", "Thin spots in the closet, and what's done the most work", "missing")}
          ${(() => {
            const n = buildMisfits(statsPool()).length;
            return row("Things you might be wrong about",
              n ? `${n} piece${n === 1 ? "" : "s"} you wear differently than you tagged` : "Nothing's arguing with you",
              "misfit");
          })()}
          ${(() => {
            const n = flaggedItems().length;
            return row("Flagged for review",
              n ? `${n} piece${n === 1 ? "" : "s"} you've set aside to think about` : "Nothing flagged — flag a piece from its photo",
              "flagged");
          })()}
        </div>
      </div>

      <div class="stats-sec">
        <div class="stats-sec-hdr"><div class="t">Looking back</div><div class="s">A month at a time, or the whole year</div></div>
        <div class="stats-sec-body">
          ${row(monthLabel(monthOf(todayStr())), "What got cheaper, what you reached for, what came back", "month")}
          ${row(String(new Date().getFullYear()), "The year so far — most worn, best $/wear, dead weight", "wrapped")}
          ${row("Year in pixels", "Every day you logged, shaded by how dressed up it was", "pixels")}
        </div>
      </div>

      <div class="stats-sec">
        <div class="stats-sec-hdr"><div class="t">Report Cards</div><div class="s">Who's earning their place</div></div>
        <div class="stats-sec-body">
          ${row("Brands", "Best & worst by wear rate and $/wear", "report:brand")}
          ${row("Retailers", "Where you shop well (and don't)", "report:retailer")}
          ${row("Subcategories", "Best & worst pieces within each type", "report:subcategory")}
          ${row("Price Brackets", "Find your price sweet spot", "report:price")}
          ${row("Purchase Years", "Are you buying better over time?", "report:year")}
          ${row("Colors", "Which colors earn their keep — wear rate and $/wear", "report:color_family")}
          ${row("Acquisition", "New vs. secondhand vs. gifts", "report:acquisition")}
        </div>
      </div>

      <div class="stats-sec">
        <div class="stats-sec-hdr"><div class="t">View Closet By…</div><div class="s">Browse the closet by field</div></div>
        <div class="stats-sec-body">
          ${row("Color", null, "field:color_family")}
          ${row("Category", null, "field:category")}
          ${row("Brand", null, "field:brand")}
          ${row("Retailer", null, "field:retailer")}
          ${row("Price", null, "field:price")}
          ${row("Size", null, "field:size")}
          ${row("Season", null, "field:season")}
          ${row("Fabric", null, "field:fabric")}
          ${row("Acquisition", null, "field:acquisition")}
        </div>
      </div>

      <button class="review-cta" id="statsReviewCta">
        <svg class="rc-ic" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        <div style="flex:1">
          <div class="rc-t">Closet Review</div>
          <div class="rc-s">${reviewToReview} item${reviewToReview === 1 ? "" : "s"} with empty or guessed details</div>
        </div>
        <svg class="chev" viewBox="0 0 24 24" style="stroke:var(--on-accent)"><path d="M9 6l6 6-6 6"/></svg>
      </button>
    </div>`;

  wireStatsToolbar();
  wireRotationChips();
  const reviewCta = $("#statsReviewCta");
  if (reviewCta) reviewCta.addEventListener("click", () => { statsView = "review"; renderStats(); });
  $("#statsBody").querySelectorAll("[data-sa]").forEach(el => {
    el.addEventListener("click", () => {
      const action = el.dataset.sa;
      statsDateRange = "all";   // range is per-page; entering a sub-page starts fresh
      if (action.startsWith("field:")) {
        statsView = "field"; statsField = action.slice(6); statsDonutIdx = 0; statsFieldSort = "count";
        renderStats(); return;
      }
      if (action.startsWith("report:")) {
        statsView = "report"; statsReportField = action.slice(7);
        statsReportSel = null; statsReportSort = "best";
        renderStats(); return;
      }
      if (action === "looks:most-worn") {
        statsOutfitsMode = "most-worn"; statsView = "outfits"; renderStats(); return;
      }
      if (action === "looks:liked-neglected") {
        statsOutfitsMode = "liked-neglected"; statsView = "outfits"; renderStats(); return;
      }
      if (action === "looks:contexts") {
        statsView = "contexts"; renderStats(); return;
      }
      if (action === "gap") {
        statsView = "gap"; renderStats(); return;
      }
      if (action === "wrapped") {
        statsView = "wrapped"; statsWrappedYear = null; renderStats(); return;
      }
      if (action === "month") {
        statsView = "month"; statsMonthYm = null; renderStats(); return;
      }
      if (action === "flagged") {
        statsView = "flagged"; renderStats(); return;
      }
      if (action === "pixels") {
        statsView = "pixels"; statsPixelsYear = null; renderStats(); return;
      }
      if (action === "palette") {
        statsView = "palette"; renderStats(); return;
      }
      if (action === "missing") {
        statsView = "missing"; renderStats(); return;
      }
      if (action === "misfit") {
        statsView = "misfit"; renderStats(); return;
      }
      if (action === "travel") {
        statsView = "travel"; renderStats(); return;
      }
      if (action.startsWith("list:")) {
        const key = action.slice(5);
        const result = buildSmartList(key);
        if (result) {
          statsView = "grid"; statsGridItems = result.list; statsGridTitle = result.title;
          statsFromField = false; statsFromReport = false; statsFromPalette = false; statsListKey = key; statsSubtitleFn = result.subtitleFn || null;
          renderStats();
        }
      }
    });
  });
}

function renderStatsFieldPage() {
  const label = STATS_FIELD_LABELS[statsField] || statsField;
  const { noValue, groups: rawGroups } = getFieldGroups(statsField);

  // Assign stable colors based on count-sorted order, then optionally sort list by name
  const groupsWithColor = rawGroups.map((g, i) => ({ ...g, color: segmentColor(statsField, g.label, i) }));
  const CANONICAL_FIELDS = ["price", "season", "category"];
  const canSort = !CANONICAL_FIELDS.includes(statsField);
  const displayGroups = (canSort && statsFieldSort === "name")
    ? [...groupsWithColor].sort((a, b) => a.label.localeCompare(b.label))
    : groupsWithColor;

  // Donut always uses count order
  const segments = groupsWithColor.filter(g => g.items.length > 0)
    .map(g => ({ label: g.label, count: g.items.length, color: g.color }));
  if (statsDonutIdx >= segments.length) statsDonutIdx = 0;
  const total = segments.reduce((s, x) => s + x.count, 0);
  const active = segments[statsDonutIdx];
  const donut = donutSvgHighlight(segments, statsDonutIdx);

  const arrowBtn = (id, up) =>
    `<button id="${id}" style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--surface);border:1px solid var(--line);flex-shrink:0">
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        ${up ? '<path d="M1.5 7.5l4-4 4 4"/>' : '<path d="M1.5 3.5l4 4 4-4"/>'}
      </svg>
    </button>`;

  const noValRow = noValue.length
    ? `<div class="card" style="margin:0 14px 2px">
        <button class="frow" style="padding:10px 0;border-bottom:none" data-sv="__novalue__">
          <div class="fmeta"><div class="fname">No value</div></div>
          <span class="muted" style="font-size:15px;margin-right:6px">${noValue.length}</span>
          <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
        </button>
      </div>` : "";

  const rows = displayGroups.map(g => {
    const swatch = statsField === "color_family"
      ? `<span style="width:26px;height:26px;border-radius:50%;background:${g.color};flex-shrink:0;border:1px solid rgba(0,0,0,.1)"></span>` : "";
    const isActive = active && g.label === active.label;
    return `<button class="frow${isActive ? " donut-hi" : ""}" data-sv="${esc(g.label)}">
      ${swatch}<div class="fmeta"><div class="fname">${esc(g.label)}</div></div>
      <span class="muted" style="font-size:15px;margin-right:6px">${g.items.length}</span>
      <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
    </button>`;
  }).join("");

  const sortBar = canSort ? `
    <div class="stats-sort-bar">
      <button class="stats-sort-btn${statsFieldSort === "count" ? " on" : ""}" data-ss="count">Sort by Count</button>
      <button class="stats-sort-btn${statsFieldSort === "name" ? " on" : ""}" data-ss="name">Sort by Name</button>
    </div>` : `<div style="height:20px"></div>`;

  $("#statsBody").innerHTML = `
    ${statsToolbar(label, true)}
    ${donut ? `<div class="stats-donut-row">
      ${donut}
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px">
        ${arrowBtn("donutUp", true)}
        <div id="donutLbl" style="text-align:center;min-width:80px">
          <div style="font-size:20px;font-weight:700;line-height:1.2">${esc(active?.label || "")}</div>
          <div class="muted" style="font-size:15px;margin-top:4px">${active && total ? ((active.count/total)*100).toFixed(1) : 0}%</div>
        </div>
        ${arrowBtn("donutDn", false)}
      </div>
    </div>` : ""}
    ${noValRow}
    <div class="frows" style="padding-top:4px">${rows}</div>
    ${sortBar}`;

  wireStatsToolbar();
  wireDonutArrows(segments, total);

  $("#statsBody").querySelectorAll("[data-ss]").forEach(btn => {
    btn.addEventListener("click", () => { statsFieldSort = btn.dataset.ss; renderStatsFieldPage(); });
  });

  $("#statsBody").querySelectorAll("[data-sv]:not([data-sf])").forEach(el => {
    el.addEventListener("click", () => {
      const val = el.dataset.sv;
      const { noValue, groups } = getFieldGroups(statsField);
      let list, title;
      if (val === "__novalue__") { list = noValue; title = `No ${STATS_FIELD_LABELS[statsField] || statsField}`; }
      else { const g = groups.find(g => g.label === val); list = g ? g.items : []; title = val; }
      statsView = "grid"; statsGridItems = list; statsGridTitle = title;
      statsFromField = true; statsFromReport = false; statsFromPalette = false; statsListKey = null;
      renderStats();
    });
  });
}

function renderStatsGridPage() {
  const body = $("#statsBody");
  const tg = TOGGLE_GROUPS[statsListKey];
  const showRange = RANGE_LISTS.includes(statsListKey);
  const metricOnly = METRIC_LISTS.includes(statsListKey);
  body.innerHTML = statsToolbar(statsGridTitle, true, showRange)
    + gridHtml(statsGridItems, statsSubtitleFn, { metricOnly })
    + (tg ? `<div style="height:90px"></div>` : "");
  if (tg) {
    body.insertAdjacentHTML("beforeend", `<div class="stats-toggle-float"><div class="stats-seg">
      ${tg.keys.map((k, i) => `<button class="${statsListKey === k ? "on" : ""}" data-stoggle="${k}">${esc(tg.labels[i])}</button>`).join("")}
    </div></div>`);
    positionToast();   // a toast already up would otherwise sit on the toggle
  }
  wireStatsToolbar();
  body.querySelectorAll("[data-stoggle]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.stoggle;
      const result = buildSmartList(key);
      if (result) { statsListKey = key; statsGridItems = result.list; statsGridTitle = result.title; statsSubtitleFn = result.subtitleFn || null; }
      renderStats();
    });
  });
  body.querySelectorAll(".gtile").forEach(btn => {
    btn.addEventListener("click", () => { if (btn.dataset.item) openItemFromStats(btn.dataset.item); });
  });
  hydratePhotos(body);
}

function openItemFromStats(id) {
  openItemFrom(id);  // captures the stats screen as the return target
}

// L7: liked looks not worn in 60+ days (or never). Never-worn floats to the top,
// then oldest-last-worn first — the most "neglected" favorites lead the list.
function likedNeglectedOutfits() {
  return activeOutfits().filter(o => {
    if (o.rating !== 1) return false;
    const lw = outfitLastWorn(o);
    return !lw || daysSince(lw) >= 60;
  }).sort((a, b) => {
    const la = outfitLastWorn(a), lb = outfitLastWorn(b);
    if (!la && !lb) return 0;
    if (!la) return -1;
    if (!lb) return 1;
    return la.localeCompare(lb);
  });
}

function renderStatsOutfitsPage() {
  const body = $("#statsBody");
  const neglected = statsOutfitsMode === "liked-neglected";
  const list = (neglected ? likedNeglectedOutfits() : activeOutfits()
    .sort((a, b) => outfitWornCount(b) - outfitWornCount(a))).slice(0, 100);
  const subtitle = (o) => neglected
    ? (outfitLastWorn(o) ? `last worn ${relDate(outfitLastWorn(o))}` : "never worn")
    : `${outfitWornCount(o)} wear${outfitWornCount(o) === 1 ? "" : "s"}`;
  const grid = list.length ? `<div class="ogrid" style="padding:0 14px">${list.map(o => {
    return `<button class="otile" data-look="${esc(o.id)}">
      ${outfitCollageHtml(o, 4)}
      ${o.rating === 1 ? `<div class="otile-heart"><svg viewBox="0 0 24 24">${HEART_SVG}</svg></div>` : ""}
      <div class="oname">${esc(outfitName(o))}</div>
      <div class="ometa">${esc(subtitle(o))}</div>
    </button>`;
  }).join("")}</div>` : (neglected
    ? `<div class="placeholder"><b>No neglected favorites</b><div>Liked looks you haven't worn in 60+ days will show up here.</div></div>`
    : emptyLooks());
  /* ⚠️ NO FUNNEL: this page ranks LOOKS off activeOutfits()/likedNeglectedOutfits(),
     neither of which reads statsFilter — so the funnel was decorative, the same
     defect r11 fixed on Closet vs Life. Measured: narrowing the funnel to one
     colour changed statsPool() 6 → 3 and left this list byte-identical. */
  body.innerHTML = statsToolbar(neglected ? "Liked but Neglected" : "Most Worn Looks", true, false, true) + grid;
  wireStatsToolbar();
  body.querySelectorAll(".otile").forEach(btn => {
    btn.addEventListener("click", () => openLookFrom(btn.dataset.look));
  });
  hydratePhotos(body);
}


/* ---- C2: Contexts stats page ---- */
// Wear count per context, respecting the stats date range.
function contextWearCounts() {
  const cutoff = rangeStart();
  return countByDay(wears, w => (!cutoff || w.worn_on >= cutoff) ? ctxArr(w) : []);
}
// Effective formality of a wear for stats. The look's MANUAL override wins,
// then the level captured at log time (formality_for), then a derive-now
// fallback — pre-v3 wears (incl. the whole Airtable import) have neither.
// _soloFmlMemo: solo-wear derive is O(wears) for items with no explicit
// formality, so memoize per item; rebuilt on every Contexts page render.
let _soloFmlMemo = new Map();
function wearFormality(w) {
  const o = w.outfit_id ? outfitById.get(w.outfit_id) : null;
  if (o && o.formality_override) return BUCKET_RANGES[o.formality_override] || null;
  if (w.formality_for) return w.formality_for;
  if (o) return BUCKET_RANGES[outfitBucket(o)] || null;
  if (!w.item_id) return null;
  if (!_soloFmlMemo.has(w.item_id)) _soloFmlMemo.set(w.item_id, deriveWearFormality([w.item_id]));
  return _soloFmlMemo.get(w.item_id);
}
// Formality demand for a context: avg + spread of effective wear formality, range-scoped.
// One level per DAY, not per row — otherwise a day you wore six pieces pulls the
// average six times as hard as a day you wore two. Each day contributes the mean
// of its own pieces' levels.
function contextFormalityStats(context) {
  const cutoff = rangeStart();
  const byDay = new Map();
  for (const w of wears) {
    if (cutoff && w.worn_on < cutoff) continue;
    if (!w.worn_on || !ctxArr(w).includes(context)) continue;
    const l = wearFormality(w);
    if (!l) continue;
    let a = byDay.get(w.worn_on); if (!a) byDay.set(w.worn_on, a = []);
    a.push(l);
  }
  const levels = [...byDay.values()].map(a => a.reduce((x, y) => x + y, 0) / a.length);
  if (!levels.length) return null;
  // min/max round to whole levels — the day-means are fractional, but the ladder
  // the label prints ("levels 3–5") is not.
  return { avg: levels.reduce((a, b) => a + b, 0) / levels.length,
           min: Math.round(Math.min(...levels)), max: Math.round(Math.max(...levels)),
           n: levels.length };
}
function contextTopItems(context, limit = 12) {
  const cutoff = rangeStart();
  const counts = countByDay(wears, w =>
    (!cutoff || w.worn_on >= cutoff) && w.item_id && ctxArr(w).includes(context) ? [w.item_id] : []);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
    .map(([id, n]) => ({ item: itemById.get(id), n })).filter(x => x.item);
}
function contextTopLooks(context, limit = 12) {
  const cutoff = rangeStart();
  const counts = countByDay(wears, w =>
    (!cutoff || w.worn_on >= cutoff) && w.outfit_id && ctxArr(w).includes(context) ? [w.outfit_id] : []);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
    .map(([id, n]) => ({ outfit: outfitById.get(id), n }))
    .filter(x => x.outfit && !effectiveArchived(x.outfit))  // archived looks live only in Archive + calendar
    .slice(0, limit);
}

function renderStatsContextsPage() {
  _soloFmlMemo = new Map();  // formality edits since last visit must be picked up
  const counts = contextWearCounts();
  const ctxs = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
  const rows = ctxs.map(c => {
    const n = counts.get(c);
    const fs = contextFormalityStats(c);
    const sub = fs
      ? `avg ${fs.avg.toFixed(1)}${fs.min !== fs.max ? ` · levels ${fs.min}–${fs.max}` : ""}`
      : "no formality data yet";
    return `<button class="frow" data-sctxrow="${esc(c)}">
      <div class="fmeta"><div class="fname">${esc(c)}</div><div class="fcount">${n} wear${n === 1 ? "" : "s"} · ${esc(sub)}</div></div>
      <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
    </button>`;
  }).join("");
  /* ⚠️ Range YES, funnel NO. contextWearCounts() and contextFormalityStats()
     count WEARS across the whole wardrobe and never consult statsFilter, so the
     funnel here changed nothing — but the range genuinely works, which is why
     hideFilter had to learn to keep it (see statsToolbar). */
  $("#statsBody").innerHTML = statsToolbar("Contexts", true, true, true)
    + (rows ? `<div class="frows" style="padding-top:4px">${rows}</div>`
             : `<div class="placeholder"><b>No context data yet</b><div>Add context when you log a wear and it'll show up here.</div></div>`);
  wireStatsToolbar();
  $("#statsBody").querySelectorAll("[data-sctxrow]").forEach(el => {
    el.addEventListener("click", () => { statsContextSel = el.dataset.sctxrow; statsView = "context-detail"; renderStats(); });
  });
}

/* ---- Closet vs Life (gap analysis, 2026-07-19) ----
   The original closet-vs-life-gap thesis finally gets its page: per context,
   the share of your logged life it represents vs. the share of the Available
   closet that can dress it (formality-eligible via contextFormalityLevel).
   Pure derivation — factored for the selftest harness. Shares deliberately
   overlap across contexts (one blouse can serve Campus AND Church): this is
   coverage, not a partition. */
function buildGapStats() {
  const ctxCounts = countByDay(wears, ctxArr);
  let totalCtx = 0;
  for (const n of ctxCounts.values()) totalCtx += n;
  const avail = items.filter(i => itemStatus(i) === "Available");
  const rows = [];
  for (const [ctx, n] of ctxCounts) {
    if (n < 5) continue;                      // noise floor
    const lvl = contextFormalityLevel(ctx);
    if (!lvl) continue;                       // no formality signal yet
    const eligible = avail.filter(i => (itemFormalitySet(i) || []).includes(lvl));
    const wearShare = totalCtx ? n / totalCtx : 0;
    const closetShare = avail.length ? eligible.length / avail.length : 0;
    rows.push({ ctx, lvl, wearN: n, wearShare, closetN: eligible.length, closetShare,
                delta: wearShare - closetShare });
  }
  rows.sort((a, b) => b.delta - a.delta);
  return { rows, totalCtx, availN: avail.length };
}

/* ---- WHAT'S MISSING (2026-07-25) ------------------------------------------
   The shopping-gap half of the deferred list. Strictly read-only and strictly
   derived — she rejected a before-you-buy manual-entry check, so nothing here
   asks her to type anything.

   Two questions, deliberately kept separate because they have different
   answers: what can't the closet DRESS (thin spots), and what has done the
   most WORK (mileage).

   The thin-spot insight is the one only this app can produce: an outfit needs a
   top and a bottom and shoes, so a context isn't served by its total piece
   count — it's served by its THINNEST required slot. Twelve tops that cover
   Dressed Up are worth nothing if one pair of shoes does. */
const GAP_SLOT_FLOOR = 3;        // fewer than this in a required slot = a thin spot
const GAP_MIN_CTX_DAYS = 5;      // same noise floor as Closet vs Life
const REQUIRED_SLOTS = ["Bottoms", "Shoes"];   // Tops is covered by Dresses too

function buildThinSpots(pool = null, wearRows = null) {
  const avail = pool || items.filter(i => itemStatus(i) === "Available");
  const ws = wearRows || wears;
  const ctxCounts = countByDay(ws, ctxArr);
  let total = 0;
  for (const n of ctxCounts.values()) total += n;
  const out = [];
  for (const [ctx, n] of ctxCounts) {
    if (n < GAP_MIN_CTX_DAYS) continue;
    const lvl = contextFormalityLevel(ctx, ws);
    if (!lvl) continue;
    const eligible = avail.filter(i => (itemFormalitySet(i) || []).includes(lvl) && !isNoSuggest(i));
    const bySlot = new Map();
    for (const i of eligible) {
      const s = suggestSlot(i);
      if (!s) continue;
      bySlot.set(s, (bySlot.get(s) || 0) + 1);
    }
    // A dress covers top AND bottom, so it counts toward both.
    const dresses = bySlot.get("Dresses") || 0;
    const slots = {
      Tops: (bySlot.get("Tops") || 0) + dresses,
      Bottoms: (bySlot.get("Bottoms") || 0) + dresses,
      Shoes: bySlot.get("Shoes") || 0,
    };
    const thin = ["Tops", ...REQUIRED_SLOTS]
      .map(s => ({ slot: s, n: slots[s] }))
      .sort((a, b) => a.n - b.n)[0];
    out.push({ ctx, lvl, days: n, share: total ? n / total : 0,
               slots, thinnest: thin, outfitsPossible: slots.Tops * slots.Bottoms * slots.Shoes });
  }
  // Thinnest binding slot first, then by how much of her life the context is.
  out.sort((a, b) => a.thinnest.n - b.thinnest.n || b.share - a.share);
  return out;
}

/* Mileage — the replacement queue, on transparent terms. There is NO durability
   model here and this deliberately does not predict wear-out: it sorts by
   accumulated wear-days and shows age and $/wear beside it, exactly the way
   Workhorses/Declutter use a transparent sort rather than a composite score. */
const MILEAGE_MIN_DAYS = 25;
function buildMileage(pool = null) {
  const avail = pool || items.filter(i => itemStatus(i) === "Available");
  return avail
    .map(i => {
      const n = wearCount(i.id);
      const since = i.purchase_date || null;
      return { item: i, days: n, since,
               months: since ? Math.max(1, Math.round((new Date(todayStr()) - new Date(since)) / (86400000 * 30.44))) : null,
               cpw: i.price != null && n ? i.price / n : null };
    })
    .filter(r => r.days >= MILEAGE_MIN_DAYS)
    .sort((a, b) => b.days - a.days);
}

/* ---- "Things you might be wrong about" (2026-07-26 r10) -------------------
   The mirror being honest. The app knows things about the wardrobe that
   disagree with what she TOLD it, and that disagreement is more interesting
   than either number alone.

   Formality is the useful case. `wears.formality_for` is derived at log time
   from the WHOLE outfit (deriveWearFormality — the level all pieces share, else
   the rounded average of their minimums), so it is not circular with the
   piece's own tag: a blazer tagged "Dressed Up" that keeps going out with jeans
   and sneakers records days at a much lower level. That's a real fact about how
   she wears it, not a tautology. (A solo-logged piece derives its level from
   itself alone and so can never disagree — harmless, it just never appears.)

   ⚠️ Only pieces with an EXPLICIT `items.formality` qualify. itemFormalitySet()
   imputes a set when none is stored, and an imputed value is not something she
   told the app, so flagging it would be the app arguing with itself.
   ⚠️ Counts wear DAYS, never rows. */
const MISFIT_MIN_DAYS = 5;    // below this it's an anecdote
const MISFIT_SHARE = 0.7;     // it has to be the RULE, not a couple of odd days
function buildMisfits(pool = null, wearRows = null) {
  const rows = wearRows || wears;
  const list = pool || items.filter(i => itemStatus(i) === "Available");
  const byItem = new Map();   // item_id -> Map(level -> Set(dates))
  for (const w of rows) {
    if (!w.item_id || !w.formality_for || !w.worn_on) continue;
    let m = byItem.get(w.item_id); if (!m) byItem.set(w.item_id, m = new Map());
    let s = m.get(w.formality_for); if (!s) m.set(w.formality_for, s = new Set());
    s.add(w.worn_on);
  }
  const out = [];
  for (const i of list) {
    const claimed = (i.formality && i.formality.length) ? i.formality : null;
    if (!claimed) continue;
    const m = byItem.get(i.id);
    if (!m) continue;
    let total = 0;
    const counts = [];
    for (const [lv, set] of m) { counts.push([lv, set.size]); total += set.size; }
    if (total < MISFIT_MIN_DAYS) continue;
    const outside = counts.filter(([lv]) => !claimed.includes(lv)).sort((a, b) => b[1] - a[1]);
    const outN = outside.reduce((a, [, n]) => a + n, 0);
    if (!outN || outN / total < MISFIT_SHARE) continue;
    out.push({ item: i, claimed: [...claimed].sort((a, b) => a - b), observed: outside[0][0],
               days: total, outsideDays: outN, share: outN / total });
  }
  return out.sort((a, b) => b.share - a.share || b.days - a.days);
}
// Append the observed level rather than replacing the claim — she may well wear
// it both ways, and silently deleting a level she chose is the mistake the
// season flag was careful to avoid (CLAUDE.md ⑧: "appends, never replaces").
async function addMisfitLevel(id, lv) {
  const i = itemById.get(id);
  if (!i || !lv) return;
  const next = [...new Set([...(i.formality || []), lv])].sort((a, b) => a - b);
  await saveField(id, "formality", next);
  outfits.forEach(o => { o._bucket = null; });   // looks must re-derive their bucket
  toast(`${i.name || "Item"} now covers ${next.map(occLabel).join(" + ")}`);
  renderStats();
}

function renderStatsMisfitPage() {
  const list = buildMisfits(statsPool());
  const rows = list.map(r => `
    <div style="padding:11px 18px;border-bottom:1px solid var(--line);display:flex;gap:12px;align-items:flex-start">
      <button data-misfit-item="${esc(r.item.id)}" style="width:52px;flex:none">${thumbHtml(r.item.image_path)}</button>
      <div style="flex:1;min-width:0">
        <button data-misfit-item="${esc(r.item.id)}" style="display:block;text-align:left;font-size:14.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%">${esc(r.item.name || "Untitled")}</button>
        <div style="font-size:13px;line-height:1.5;padding-top:2px">
          You call it <b>${esc(r.claimed.map(occLabel).join(" + "))}</b>.
          You wear it in outfits that read as <b style="color:var(--accent)">${esc(occLabel(r.observed))}</b>
          — ${r.outsideDays} of ${r.days} days.
        </div>
        <div style="padding-top:6px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="cap-chip" data-misfit-add="${esc(r.item.id)}:${r.observed}" style="font-size:12.5px">＋ Add ${esc(occLabel(r.observed))}</button>
          <button class="cap-chip" data-misfit-edit="${esc(r.item.id)}" style="font-size:12.5px">Edit…</button>
        </div>
      </div>
    </div>`).join("");

  $("#statsBody").innerHTML = statsToolbar("Might be wrong", true, false) + `
    <div style="padding-bottom:32px">
      <div class="snote" style="padding:10px 16px 2px">Pieces whose history disagrees with what you told the app. Nothing here is necessarily wrong — it's just worth a look.</div>
      ${list.length ? `<div class="stats-sec"><div class="stats-sec-body">${rows}</div></div>`
        : `<div class="placeholder" style="padding:40px 32px"><b>Nothing's arguing with you</b>
            <div>Every piece with a formality you've set is being worn the way you said. This needs ${MISFIT_MIN_DAYS}+ days of history per piece.</div></div>`}
    </div>`;
  wireStatsToolbar();
  hydratePhotos($("#statsBody"));
  $("#statsBody").querySelectorAll("[data-misfit-item]").forEach(b =>
    b.onclick = () => openItemFromStats(b.dataset.misfitItem));
  $("#statsBody").querySelectorAll("[data-misfit-add]").forEach(b =>
    b.onclick = () => { const [id, lv] = b.dataset.misfitAdd.split(":"); addMisfitLevel(id, +lv); });
  $("#statsBody").querySelectorAll("[data-misfit-edit]").forEach(b =>
    b.onclick = () => openOccasionEdit(b.dataset.misfitEdit, () => renderStats()));
}

/* Travel (2026-07-29). One trip is an anecdote; four are a fact about how you
   pack, and that fact is the whole reason the recap is worth reading twice.
   Whole-wardrobe page, so it passes NO pool and hides the funnel — the two are
   one decision (see the stats-funnel gotcha in CLAUDE.md). */
function renderStatsTravelPage() {
  const st = buildTravelStats();
  const proven = travelProven(st);
  const unused = travelUnused(st);
  const over = st.totPacked - st.totWorn;

  const tripRows = st.trips.slice().reverse().map(t => {
    const pct = t.packed ? Math.round((t.worn / t.packed) * 100) : 0;
    return `<button data-travel-trip="${esc(t.c.id)}" style="display:block;width:100%;text-align:left;padding:11px 18px;border-bottom:1px solid var(--line)">
      <div style="display:flex;align-items:baseline;gap:8px">
        <span style="font-size:14.5px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.c.name)}</span>
        <span style="font-size:11.5px;color:var(--muted)">${esc(fmtDate(t.c.start_date))} · ${t.days} day${t.days === 1 ? "" : "s"}</span>
      </div>
      <div style="height:8px;border-radius:4px;background:var(--panel);overflow:hidden;margin:6px 0 4px">
        <div style="height:100%;width:${pct}%;background:var(--accent)"></div>
      </div>
      <div style="font-size:12px;color:var(--muted)">${t.worn} of ${t.packed} packed pieces worn${t.r.unpacked.length ? ` · ${t.r.unpacked.length} worn but not packed` : ""}</div>
    </button>`;
  }).join("");

  const itemRow = (e, note) => `
    <button data-travel-item="${esc(e.item.id)}" style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:9px 18px;border-bottom:1px solid var(--line)">
      <span style="width:46px;flex:none">${thumbHtml(e.item.image_path)}</span>
      <span style="flex:1;min-width:0">
        <span style="display:block;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.item.name || "Untitled")}</span>
        <span style="display:block;font-size:11.5px;color:var(--muted)">${esc(note)}</span>
      </span>
      <svg class="chev" viewBox="0 0 24 24" style="flex:none"><path d="M9 6l6 6-6 6"/></svg>
    </button>`;

  const body = !st.trips.length
    ? `<div class="placeholder" style="padding:40px 32px"><b>No finished trips yet</b>
        <div>Give a capsule a start and end date and use it as a trip — once it's over, it shows up here.</div></div>`
    : `
      <div class="stats-sec">
        <div class="stats-sec-body">
          <div class="kpi-row">
            <div class="kpi-cell"><div class="kpi-val">${st.totPacked}</div><div class="kpi-lbl">pieces packed</div></div>
            <div class="kpi-cell"><div class="kpi-val">${st.totWorn}</div><div class="kpi-lbl">actually worn</div></div>
          </div>
          ${over > 0 ? `<div class="stats-note" style="border:0">Across ${st.trips.length} trip${st.trips.length === 1 ? "" : "s"} you've carried <b>${over}</b> piece-slot${over === 1 ? "" : "s"} you didn't wear — about ${Math.round(over / st.trips.length)} per trip.</div>` : ""}
        </div>
      </div>
      <div class="stats-sec">
        <div class="stats-sec-hdr"><div class="t">Every trip</div><div class="s">Tap one for its recap</div></div>
        <div class="stats-sec-body">${tripRows}</div>
      </div>
      ${proven.length ? `<div class="stats-sec">
        <div class="stats-sec-hdr"><div class="t">Always earns its spot</div><div class="s">Packed more than once, worn every time</div></div>
        <div class="stats-sec-body">${proven.slice(0, 15).map(e => itemRow(e, `packed ${e.packed}× · worn ${e.worn}×`)).join("")}</div>
      </div>` : ""}
      ${unused.length ? `<div class="stats-sec">
        <div class="stats-sec-hdr"><div class="t">Packed, never worn</div><div class="s">On ${TRIP_MEMORY_MIN}+ trips</div></div>
        <div class="stats-sec-body">${unused.slice(0, 15).map(e => itemRow(e, `packed ${e.packed}× · worn 0×`)).join("")}</div>
        <div class="stats-note">Not a verdict. A piece you pack every time and never wear may be the just-in-case option, doing exactly its job.</div>
      </div>` : ""}`;

  $("#statsBody").innerHTML = statsToolbar("Travel", true, false, true) + `
    <div style="padding-bottom:32px">
      <div class="snote" style="padding:10px 16px 2px">Every dated capsule whose end date has passed. Nothing here is stored — it's read back out of what you logged.</div>
      ${body}
    </div>`;
  wireStatsToolbar();
  hydratePhotos($("#statsBody"));
  $("#statsBody").querySelectorAll("[data-travel-trip]").forEach(b =>
    b.onclick = () => openTripRecap(b.dataset.travelTrip));
  $("#statsBody").querySelectorAll("[data-travel-item]").forEach(b =>
    b.onclick = () => openItemFromStats(b.dataset.travelItem));
}

function renderStatsMissingPage() {
  // Denominator is the FULL Available closet, deliberately — not statsPool().
  // This page hides the funnel (its numbers are about the whole wardrobe), and
  // a hidden filter that still narrowed the pool would be the worse half of the
  // bug the hideFilter flag exists to prevent: invisible AND lying.
  const thin = buildThinSpots();
  const miles = buildMileage();
  const pct = (x) => `${Math.round(x * 100)}%`;

  const thinRows = thin.filter(r => r.thinnest.n < GAP_SLOT_FLOOR * 2).slice(0, 6).map(r => {
    const tone = r.thinnest.n < GAP_SLOT_FLOOR ? "var(--danger)" : "var(--muted)";
    return `<div style="padding:11px 18px;border-bottom:1px solid var(--line)">
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:5px">
        <span style="font-size:14.5px;font-weight:600;flex:1">${esc(r.ctx)}</span>
        <span style="font-size:11.5px;color:var(--muted)">${r.days} day${r.days === 1 ? "" : "s"} · ${pct(r.share)} of your life</span>
      </div>
      <div style="font-size:13px;line-height:1.5">
        Only <b style="color:${tone}">${r.thinnest.n} ${esc(r.thinnest.slot.toLowerCase())}</b> in the closet cover ${esc(occLabel(r.lvl))}.
      </div>
      <div style="font-size:11.5px;color:var(--muted);padding-top:3px">
        ${r.slots.Tops} tops · ${r.slots.Bottoms} bottoms · ${r.slots.Shoes} shoes
      </div>
    </div>`;
  }).join("");

  const mileRows = miles.slice(0, 20).map(r => `
    <button data-miss-item="${esc(r.item.id)}" style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:9px 18px;border-bottom:1px solid var(--line)">
      <span style="width:46px;flex:none">${thumbHtml(r.item.image_path)}</span>
      <span style="flex:1;min-width:0">
        <span style="display:block;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.item.name || "Untitled")}</span>
        <span style="display:block;font-size:11.5px;color:var(--muted)">${r.days} days out${r.months ? ` · owned ${r.months < 24 ? r.months + " mo" : Math.floor(r.months / 12) + " yr"}` : ""}${r.cpw != null ? ` · ${money(r.cpw)}/wear` : ""}</span>
      </span>
      <svg class="chev" viewBox="0 0 24 24" style="flex:none"><path d="M9 6l6 6-6 6"/></svg>
    </button>`).join("");

  $("#statsBody").innerHTML = statsToolbar("What's missing", true, false, true) + `
    <div style="padding-bottom:32px">
      <div class="stats-sec">
        <div class="stats-sec-hdr"><div class="t">Thin spots</div><div class="s">Where the closet can't quite dress your life</div></div>
        <div class="stats-sec-body">
          ${thinRows || `<div class="placeholder" style="padding:26px 24px"><b>No thin spots</b><div>Every context you log has a decent spread of tops, bottoms and shoes at its formality.</div></div>`}
        </div>
      </div>
      <div class="stats-note">An outfit needs a top, a bottom and shoes, so a context is only as well served as its <b>thinnest</b> slot — twelve tops don't help if one pair of shoes covers the level. Dresses count toward both top and bottom. Contexts need ${GAP_MIN_CTX_DAYS}+ logged days and a formality signal to appear.</div>

      <div class="stats-sec">
        <div class="stats-sec-hdr"><div class="t">Mileage</div><div class="s">What's done the most work</div></div>
        <div class="stats-sec-body">
          ${mileRows || `<div class="placeholder" style="padding:26px 24px"><b>Nothing with heavy mileage yet</b><div>Pieces show up here once they've been out ${MILEAGE_MIN_DAYS}+ days.</div></div>`}
        </div>
      </div>
      <div class="stats-note">Sorted by days worn — this is mileage, not a prediction. The app has no idea how long your clothes last; it just knows which ones have done the work, and how long you've had them.</div>
    </div>`;
  wireStatsToolbar();
  $("#statsBody").querySelectorAll("[data-miss-item]").forEach(el => {
    el.onclick = () => openItemFromStats(el.dataset.missItem);
  });
}

/* ---- PALETTE (2026-07-25) -------------------------------------------------
   Closet-vs-life, but for colour: the share of pieces you OWN in each family
   against the share of pieces you actually WEAR. Most people own one palette
   and wear another, and nothing in the app said so out loud.

   Unit is **piece-days** — each piece counted once per day it went out — NOT
   wear rows and NOT wear days. That's the only unit that compares like with
   like against a per-item closet share (see the "a wear is a DAY" gotcha:
   rows would double-count, and wear-days would flatter accent colours that
   only ever show up one piece at a time). Same unit `buildWrappedStats` calls
   `pieceDays`. The UI never calls this number "wears". */
function buildPaletteStats(pool = null, wearRows = null) {
  const avail = pool || items.filter(i => itemStatus(i) === "Available");
  const byId = new Map(avail.map(i => [i.id, i]));
  const owned = new Map(), worn = new Map();
  for (const i of avail) {
    const c = i.color_family || null;
    if (!c) continue;
    owned.set(c, (owned.get(c) || 0) + 1);
  }
  const seen = new Set();
  for (const w of (wearRows || wears)) {
    if (!w.worn_on) continue;
    const i = byId.get(w.item_id);
    if (!i || !i.color_family) continue;
    const k = `${w.item_id}|${w.worn_on}`;      // one piece, one day, once
    if (seen.has(k)) continue;
    seen.add(k);
    worn.set(i.color_family, (worn.get(i.color_family) || 0) + 1);
  }
  let totalOwned = 0, totalWorn = 0;
  for (const n of owned.values()) totalOwned += n;
  for (const n of worn.values()) totalWorn += n;
  const rows = [...new Set([...owned.keys(), ...worn.keys()])].map(c => {
    const o = owned.get(c) || 0, p = worn.get(c) || 0;
    const ownShare = totalOwned ? o / totalOwned : 0;
    const wearShare = totalWorn ? p / totalWorn : 0;
    return { color: c, owned: o, pieceDays: p, ownShare, wearShare,
             delta: wearShare - ownShare,
             index: ownShare ? wearShare / ownShare : null };
  }).sort((a, b) => b.delta - a.delta);
  return { rows, totalOwned, totalWorn,
           topOwned: [...owned.entries()].sort((a, b) => b[1] - a[1])[0] || null,
           topWorn: [...worn.entries()].sort((a, b) => b[1] - a[1])[0] || null };
}

function renderStatsPalettePage() {
  const g = buildPaletteStats(statsPool());
  const pct = (x) => `${Math.round(x * 100)}%`;
  const stack = (key) => {
    const rows = [...g.rows].filter(r => r[key] > 0).sort((a, b) => b[key] - a[key]);
    if (!rows.length) return `<div style="height:100%;background:var(--panel)"></div>`;
    return rows.map(r => `<span title="${esc(r.color)}" style="flex:${(r[key] * 1000).toFixed(1)};background:${colorHex(r.color)};display:block;height:100%"></span>`).join("");
  };
  const barRow = (label, key) => `<div style="padding:0 18px 12px">
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:5px">${label}</div>
    <div style="display:flex;height:22px;border-radius:6px;overflow:hidden;border:1px solid var(--line)">${stack(key)}</div>
  </div>`;

  const verdict = (g.topOwned && g.topWorn)
    ? (g.topOwned[0] === g.topWorn[0]
        ? `<div style="padding:14px 18px 10px;font-size:14px;line-height:1.5">You own the most <b>${esc(g.topOwned[0])}</b> — and you wear it the most too. The palette matches the life.</div>`
        : `<div style="padding:14px 18px 10px;font-size:14px;line-height:1.5">You own the most <b>${esc(g.topOwned[0])}</b>, but you wear the most <b>${esc(g.topWorn[0])}</b>.</div>`)
    : "";

  const rowsHtml = g.rows.map(r => {
    const chip = r.owned === 0
      ? `<span style="font-size:11px;color:var(--muted)">none owned</span>`
      : r.pieceDays === 0
      ? `<span style="font-size:11px;font-weight:700;color:var(--danger)">never worn</span>`
      : r.delta >= 0.03
      ? `<span style="font-size:11px;font-weight:700;color:#2f9e5e">punches above its weight</span>`
      : r.delta <= -0.03
      ? `<span style="font-size:11px;font-weight:700;color:var(--danger)">sits in the closet</span>`
      : `<span style="font-size:11px;font-weight:600;color:var(--muted)">even</span>`;
    const bar = (share, color) => `<div style="height:7px;border-radius:4px;background:var(--line);overflow:hidden;flex:1">
      <div style="height:100%;width:${Math.min(100, Math.round(share * 100))}%;background:${color}"></div></div>`;
    return `<button data-pal="${esc(r.color)}" style="display:block;width:100%;text-align:left;padding:11px 18px;border-bottom:1px solid var(--line)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
        <span class="swatch" style="background:${colorHex(r.color)};flex:none"></span>
        <span style="font-size:14.5px;font-weight:600;flex:1">${esc(r.color)}</span>
        ${chip}
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        ${bar(r.ownShare, "var(--muted)")}
        <span style="font-size:11.5px;color:var(--muted);width:118px;flex:none">${pct(r.ownShare)} of the closet</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        ${bar(r.wearShare, "var(--accent)")}
        <span style="font-size:11.5px;color:var(--muted);width:118px;flex:none">${pct(r.wearShare)} of what you wear</span>
      </div>
    </button>`;
  }).join("");

  $("#statsBody").innerHTML = statsToolbar("Palette", true, false)
    + (g.rows.length
      ? verdict + barRow("Your closet", "ownShare") + barRow("What you actually wear", "wearShare")
        + `<div style="padding-top:2px">${rowsHtml}</div>
        <div class="stats-note">"What you wear" counts each piece once per day it went out, so it compares like with like against a closet counted in pieces. Both columns add to 100%. Pieces with no color set are left out entirely.</div>
        <div class="stats-note"><b>Palette vs. the Colors report card:</b> this page is about <b>proportion</b> — is the mix you own the mix you wear? The Colors report card is about <b>per-piece performance</b> — do your black items individually get worn as often as similar items, and at what $/wear. They can disagree, and both be right: forty lightly-worn black pieces can still dominate what leaves the closet.</div>
        <div style="padding:2px 16px 0"><button class="lnk" id="palToReport" style="font-size:13px">Colors report card ›</button></div>`
      : `<div class="placeholder"><b>No colors set yet</b><div>Give pieces a color family and this page fills itself in.</div></div>`);
  wireStatsToolbar();
  const toReport = $("#palToReport");
  if (toReport) toReport.onclick = () => {
    statsView = "report"; statsReportField = "color_family";
    statsReportSel = null; statsReportSort = "best";
    renderStats();
  };
  $("#statsBody").querySelectorAll("[data-pal]").forEach(el => {
    el.onclick = () => {
      const c = el.dataset.pal;
      statsGridItems = statsPool().filter(i => i.color_family === c);
      statsGridTitle = c;
      statsFromField = false; statsFromReport = false; statsFromPalette = true;
      statsListKey = null; statsSubtitleFn = null;
      statsView = "grid";
      renderStats();
    };
  });
}

function renderStatsGapPage() {
  const g = buildGapStats();
  const pct = (x) => `${Math.round(x * 100)}%`;
  const verdict = g.rows.length && g.rows[0].delta >= CLOSET_VS_LIFE_MIN_GAP
    ? `<div style="padding:14px 18px 4px;font-size:14px;line-height:1.5">You live in <b>${esc(g.rows[0].ctx)}</b> more than your closet does — it's ${pct(g.rows[0].wearShare)} of your logged life but only ${pct(g.rows[0].closetShare)} of the closet can dress it.</div>`
    : g.rows.length ? `<div style="padding:14px 18px 4px;font-size:14px">No big gaps — the closet tracks your life pretty well.</div>` : "";
  const bar = (share, color) => `<div style="height:8px;border-radius:4px;background:var(--line);overflow:hidden;flex:1">
    <div style="height:100%;width:${Math.min(100, Math.round(share * 100))}%;background:${color}"></div></div>`;
  const rowsHtml = g.rows.map(r => {
    const chip = r.delta >= CLOSET_VS_LIFE_MIN_GAP
      ? `<span style="font-size:11px;font-weight:700;color:var(--danger)">underserved +${Math.round(r.delta * 100)}</span>`
      : r.delta <= -CLOSET_VS_LIFE_MIN_GAP
      ? `<span style="font-size:11px;font-weight:600;color:var(--muted)">well stocked</span>`
      : `<span style="font-size:11px;font-weight:600;color:#2f9e5e">balanced</span>`;
    return `<div style="padding:11px 18px;border-bottom:1px solid var(--line)">
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:7px">
        <span style="font-size:14.5px;font-weight:600;flex:1">${esc(r.ctx)}</span>
        <span style="font-size:11.5px;color:var(--muted)">${r.lvl}. ${esc(occLabel(r.lvl))}</span>
        ${chip}
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        ${bar(r.wearShare, "var(--accent)")}
        <span style="font-size:11.5px;color:var(--muted);width:110px;flex:none">${pct(r.wearShare)} of wears</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        ${bar(r.closetShare, "var(--muted)")}
        <span style="font-size:11.5px;color:var(--muted);width:110px;flex:none">${pct(r.closetShare)} of closet fits</span>
      </div>
    </div>`;
  }).join("");
  // hideFilter (2026-07-25): buildGapStats() has always used the whole Available
  // closet and ignored statsFilter, so the funnel here was decorative — tapping
  // it changed nothing. Same call as Rotation: no funnel beats a lying one.
  $("#statsBody").innerHTML = statsToolbar("Closet vs Life", true, false, true)
    + (g.rows.length
      ? verdict + `<div style="padding-top:6px">${rowsHtml}</div>
        <div class="stats-note">"Of closet fits" = share of Available pieces whose formality covers that context's level — pieces can serve several contexts, so columns don't add to 100%. Contexts need 5+ tagged wears and a formality signal to appear.</div>`
      : `<div class="placeholder"><b>Not enough context data yet</b><div>Tag contexts when you log (5+ wears per context) and this page fills itself in.</div></div>`);
  wireStatsToolbar();
}

/* ---- Year in Review (2026-07-19) ----
   Spotify-Wrapped for the closet: pure derivation over one calendar year,
   viewable any time (current year = "so far"). No capture, no storage. */
let statsWrappedYear = null;
let statsPixelsYear = null;

/* ---- Year in pixels (Round C, 2026-07-25) ---------------------------------
   A year of logging as one picture: 53 columns of 7 days, shaded by how dressed
   up that day was. Every other stats view is a list or a number; this is the
   only one that shows the SHAPE of a year — the summer of tee shirts, the run
   of concerts, the gaps where logging lapsed.
   Deliberately not filtered by statsPool(): it's the whole year or nothing. */
function pixelDayLevels(year) {
  const out = new Map();   // date → 1..8 (derived formality of that day)
  for (const [date, rows] of wearDayMap()) {
    if (!date.startsWith(String(year))) continue;
    const lvl = deriveWearFormality([...new Set(rows.map(r => r.item_id))]);
    out.set(date, lvl || 3);
  }
  return out;
}

function renderStatsPixelsPage() {
  const year = statsPixelsYear || +todayStr().slice(0, 4);
  const years = [...new Set(wears.map(w => +String(w.worn_on).slice(0, 4)).filter(y => y > 2000))].sort((a, b) => b - a);
  const levels = pixelDayLevels(year);
  const jan1 = new Date(year, 0, 1);
  const dec31 = new Date(year, 11, 31);
  // Grid is column-per-week, row-per-weekday, so the first column is padded to
  // the weekday Jan 1 actually fell on.
  const cells = [];
  for (let k = 0; k < jan1.getDay(); k++) cells.push(`<i style="background:transparent"></i>`);
  for (let d = new Date(jan1); d <= dec31; d.setDate(d.getDate() + 1)) {
    const ds = localISO(d);
    const lvl = levels.get(ds);
    // Level 1 (Utility) shouldn't vanish, level 8 shouldn't be pure accent —
    // ramp 0.22 → 1.0 across the ladder.
    const style = lvl
      ? `background:var(--accent);opacity:${(0.22 + (lvl - 1) / 7 * 0.78).toFixed(2)}`
      : `background:var(--panel)`;
    cells.push(`<i data-px="${ds}" style="${style}" title="${ds}${lvl ? " · " + esc(occLabel(lvl)) : ""}"></i>`);
  }
  const logged = levels.size;
  const inYear = Math.round((Math.min(dec31, new Date()) - jan1) / 86400000) + 1;
  const legend = [1, 3, 5, 6, 8].map(l =>
    `<span style="display:inline-flex;align-items:center;gap:4px"><i style="width:10px;height:10px;border-radius:2px;display:inline-block;background:var(--accent);opacity:${(0.22 + (l - 1) / 7 * 0.78).toFixed(2)}"></i><span>${esc(occLabel(l))}</span></span>`).join("");

  $("#statsBody").innerHTML = `
    ${statsToolbar("Year in pixels", true, false, true)}
    <div style="padding-bottom:32px">
      ${years.length > 1 ? `<div class="cap-catbar" style="padding:8px 14px 0">${years.map(y =>
        `<button class="cap-chip${y === year ? " on" : ""}" data-px-year="${y}">${y}</button>`).join("")}</div>` : ""}
      <div style="padding:12px 14px 0;overflow-x:auto">
        <div class="pxgrid">${cells.join("")}</div>
      </div>
      <div style="padding:10px 16px 0;font-size:13px;color:var(--muted)">
        <b style="color:var(--text)">${logged}</b> of ${inYear} days logged${logged ? ` · ${Math.round(logged / inYear * 100)}%` : ""}
      </div>
      <div style="padding:8px 16px 0;display:flex;flex-wrap:wrap;gap:10px;font-size:11.5px;color:var(--muted)">${legend}</div>
      <div style="padding:10px 16px 0;font-size:12px;color:var(--muted)">Each square is a day, shaded by how dressed up it was. Tap one to open it.</div>
    </div>`;
  wireStatsToolbar();
  $("#statsBody").querySelectorAll("[data-px-year]").forEach(b => {
    b.onclick = () => { statsPixelsYear = +b.dataset.pxYear; renderStats(); };
  });
  $("#statsBody").querySelectorAll("[data-px]").forEach(el => {
    el.onclick = () => { switchTab("calendar"); calendarDay = el.dataset.px; renderCalendarDay($("#calendarBody")); };
  });
}

function longestStreak(dateSet) {
  const arr = [...dateSet].sort();
  let best = 0, cur = 0, prev = null;
  for (const d of arr) {
    cur = (prev && shiftDate(prev, 1) === d) ? cur + 1 : 1;
    if (cur > best) best = cur;
    prev = d;
  }
  return best;
}

function buildWrappedStats(year) {
  const start = `${year}-01-01`, end = `${year}-12-31`;
  const today = todayStr();
  const yearWears = wears.filter(w => w.worn_on >= start && w.worn_on <= end);
  const days = new Set(yearWears.map(w => w.worn_on));
  const elapsedEnd = today < end ? today : end;
  const elapsed = Math.max(1, Math.round((new Date(elapsedEnd) - new Date(start)) / 86400000) + 1);

  const itemDays = new Map(), lookDays = new Map();
  const ctxCounts = countByDay(yearWears, ctxArr);
  for (const w of yearWears) {
    if (w.item_id && itemById.has(w.item_id)) {
      let s = itemDays.get(w.item_id); if (!s) itemDays.set(w.item_id, s = new Set()); s.add(w.worn_on);
    }
    if (w.outfit_id && outfitById.has(w.outfit_id)) {
      let s = lookDays.get(w.outfit_id); if (!s) lookDays.set(w.outfit_id, s = new Set()); s.add(w.worn_on);
    }
  }
  const topItems = [...itemDays.entries()].map(([id, s]) => ({ item: itemById.get(id), n: s.size }))
    .sort((a, b) => b.n - a.n).slice(0, 5);
  const topLooks = [...lookDays.entries()].map(([id, s]) => ({ o: outfitById.get(id), n: s.size }))
    .sort((a, b) => b.n - a.n).slice(0, 3);
  const totalCtx = [...ctxCounts.values()].reduce((a, b) => a + b, 0);
  const topCtx = [...ctxCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([c, n]) => ({ c, n, share: totalCtx ? n / totalCtx : 0 }));

  // $/wear champions: worn 3+ days this year, real price, gifts excluded
  // (CPW itself stays all-time — app doctrine).
  const cpw = [...itemDays.entries()]
    .filter(([id, s]) => s.size >= 3)
    .map(([id]) => itemById.get(id))
    .filter(i => i && i.acquisition !== "Gift" && parseFloat(i.price) > 0 && wearCount(i.id) > 0)
    .map(i => ({ item: i, cpw: parseFloat(i.price) / wearCount(i.id) }))
    .sort((a, b) => a.cpw - b.cpw).slice(0, 3);

  // New this year: bought in-year → did it earn wears?
  const bought = items.filter(i => i.purchase_date && i.purchase_date >= start && i.purchase_date <= end);
  const boughtWorn = bought.filter(i => itemDays.has(i.id));
  // Dead weight: Available, owned before Jan 1, zero wear-days all year.
  const dead = items.filter(i => itemStatus(i) === "Available"
    && (!i.purchase_date || i.purchase_date < start) && !itemDays.has(i.id));

  const seasonCounts = new Map();
  for (const d of days) { const s = seasonOf(d); seasonCounts.set(s, (seasonCounts.get(s) || 0) + 1); }

  // pieceDays = item-days (a 5-piece day is 5), NOT a wear count — daysLogged is
  // the wear count for the year.
  return { year, pieceDays: yearWears.length, daysLogged: days.size, elapsed,
           coverage: days.size / elapsed, streak: longestStreak(days),
           topItems, topLooks, topCtx, cpw,
           boughtN: bought.length, boughtWornN: boughtWorn.length,
           dead, seasonCounts, inProgress: today < end };
}

function renderStatsWrapped() {
  const year = statsWrappedYear || +todayStr().slice(0, 4);
  const s = buildWrappedStats(year);
  const years = [...new Set(wears.map(w => +String(w.worn_on).slice(0, 4)).filter(y => y > 2000))].sort((a, b) => b - a);
  const yearChips = years.length > 1 ? `<div class="cap-catbar" style="padding:8px 14px 0">${years.map(y =>
    `<button class="cap-chip${y === year ? " on" : ""}" data-wr-year="${y}">${y}</button>`).join("")}</div>` : "";
  const card = (inner, accent) => `<div style="margin:12px 14px;padding:18px 16px;border-radius:16px;border:1px solid var(--line);${accent ? "background:var(--accent-soft);" : ""}">${inner}</div>`;
  const big = (v, lbl) => `<div style="text-align:center"><div style="font-size:34px;font-weight:800;color:var(--accent)">${v}</div><div style="font-size:12.5px;color:var(--muted)">${lbl}</div></div>`;
  const lbl = (t) => `<div style="font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-bottom:10px">${t}</div>`;

  const hero = card(`
    <div style="text-align:center;font-size:15px;font-weight:700;margin-bottom:14px">${year}${s.inProgress ? " · so far" : ""}</div>
    <div style="display:flex;justify-content:space-around">
      ${big(s.daysLogged, "days logged")}
      ${big(`${Math.round(s.coverage * 100)}%`, "of days")}
      ${big(s.streak, "day streak")}
    </div>`, true);

  const mostWorn = s.topItems.length ? card(lbl("Most worn") + `
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">
      ${thumbHtml(s.topItems[0].item.image_path)}
      <div><div style="font-size:16px;font-weight:700">${esc(s.topItems[0].item.name || "Untitled")}</div>
      <div style="font-size:13px;color:var(--muted)">${s.topItems[0].n} day${s.topItems[0].n === 1 ? "" : "s"} on your body</div></div>
    </div>
    ${s.topItems.slice(1).map(({ item, n }, k) => `<div style="display:flex;gap:10px;font-size:13.5px;padding:3px 0">
      <span style="color:var(--muted);width:16px">${k + 2}.</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.name || "Untitled")}</span><span style="color:var(--muted)">${n}d</span>
    </div>`).join("")}`) : "";

  const cpwCard = s.cpw.length ? card(lbl("Cost-per-wear champion") + `
    <div style="display:flex;align-items:center;gap:14px">
      ${thumbHtml(s.cpw[0].item.image_path)}
      <div><div style="font-size:15px;font-weight:700">${esc(s.cpw[0].item.name || "Untitled")}</div>
      <div style="font-size:13px;color:var(--muted)">${money(s.cpw[0].cpw)}/wear and falling</div></div>
    </div>
    ${s.cpw.slice(1).map(({ item, cpw }) => `<div style="display:flex;gap:10px;font-size:13px;padding:4px 0 0;color:var(--muted)">
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.name || "Untitled")}</span><span>${money(cpw)}/wear</span>
    </div>`).join("")}`) : "";

  const looksCard = s.topLooks.length ? card(lbl("Signature looks") + `
    <div class="ogrid" style="padding:0">${s.topLooks.map(({ o, n }) => `<button class="otile" data-wr-look="${esc(o.id)}">
      ${outfitCollageHtml(o, 4)}<div class="oname">${esc(outfitName(o))}</div><div class="ometa">${n} day${n === 1 ? "" : "s"}</div>
    </button>`).join("")}</div>`) : "";

  const ctxCard = s.topCtx.length ? card(lbl("Where you showed up") + s.topCtx.map(({ c, n, share }) => `
    <div style="display:flex;align-items:center;gap:10px;padding:4px 0">
      <span style="font-size:13.5px;width:110px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c)}</span>
      <div style="flex:1;height:8px;border-radius:4px;background:var(--line);overflow:hidden"><div style="height:100%;width:${Math.round(share * 100)}%;background:var(--accent)"></div></div>
      <span style="font-size:12px;color:var(--muted);width:34px;text-align:right">${Math.round(share * 100)}%</span>
    </div>`).join("")) : "";

  const newCard = s.boughtN ? card(lbl("New this year") + `
    <div style="font-size:14px;line-height:1.6">${s.boughtN} piece${s.boughtN === 1 ? "" : "s"} joined the closet —
    <b>${s.boughtWornN}</b> already earning wears${s.boughtN - s.boughtWornN ? `, ${s.boughtN - s.boughtWornN} still waiting for a first outing` : ""}.</div>`) : "";

  const deadCard = card(lbl("Slept all year") + (s.dead.length ? `
    <div style="font-size:14px;margin-bottom:10px"><b>${s.dead.length}</b> piece${s.dead.length === 1 ? "" : "s"} you owned in January ${s.inProgress ? "haven't" : "never"} left the closet.</div>
    <div style="display:flex;gap:8px">${s.dead.slice(0, 4).map(i => `<button data-wr-item="${esc(i.id)}" style="width:56px">${thumbHtml(i.image_path)}</button>`).join("")}${s.dead.length > 4 ? `<div class="muted" style="align-self:center;font-size:12px">+${s.dead.length - 4}</div>` : ""}</div>`
    : `<div style="font-size:14px">🎉 Every piece you owned got worn this year.</div>`));

  /* ⚠️ buildWrappedStats(year) takes a YEAR and nothing else — no pool, no
     filter. Measured with the funnel set to one colour: statsPool() 6 → 3 while
     every number here (48 piece-days, 16 days logged, the top items, both
     contexts) stayed identical. The year chips are this page's real control. */
  $("#statsBody").innerHTML = statsToolbar("Year in Review", true, false, true)
    + yearChips
    + (s.daysLogged ? hero + mostWorn + cpwCard + looksCard + ctxCard + newCard + deadCard
      : `<div class="placeholder"><b>No wears logged in ${year}</b></div>`)
    + `<div style="height:24px"></div>`;
  wireStatsToolbar();
  hydratePhotos($("#statsBody"));
  $("#statsBody").querySelectorAll("[data-wr-year]").forEach(b => {
    b.onclick = () => { statsWrappedYear = +b.dataset.wrYear; renderStats(); };
  });
  $("#statsBody").querySelectorAll("[data-wr-look]").forEach(b => {
    b.onclick = () => openLookFrom(b.dataset.wrLook);
  });
  $("#statsBody").querySelectorAll("[data-wr-item]").forEach(b => {
    b.onclick = () => openItemFromStats(b.dataset.wrItem);
  });
}

/* ===================================================================
   MONTH REVIEW  (2026-08-03 r5)

   Her ask: "month review — how did cost per wear change for key pieces in the
   month? what got worn most? etc. think creatively about fun stats, and make it
   reviewable for past months too."

   Year in Review already exists and is deliberately a once-a-year artefact. A
   month is a different unit: short enough that she remembers it, long enough to
   have a shape. So this leans on MOVEMENT — what changed during the window —
   rather than on totals, which is also the only honest way to answer "how did
   cost per wear change".

   ⚠️ Every number here is wear-DAYS (the 2026-07-24 rule). Piece-days where a
   share across pieces is wanted, which is the unit the Palette page already
   uses and the only one comparable to a per-item closet share.
   ⚠️ Pure given its injectables, and it takes `ym` rather than "this month", so
   the past-months browser is the same code path — a second derivation for the
   live month would have been free to drift.
   =================================================================== */
const MONTH_REDISCOVER_DAYS = 90;   // gap that makes a wear a rediscovery
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const monthLabel = (ym) => `${MONTH_NAMES[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
const monthOf = (d) => String(d || "").slice(0, 7);
function monthDays(ym) {
  const y = +ym.slice(0, 4), m = +ym.slice(5, 7);
  return new Date(y, m, 0).getDate();
}
function shiftMonth(ym, n) {
  const y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n;
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function buildMonthReview(ym, { pool = null, wearRows = null, log = null } = {}) {
  const rows = wearRows || wears;
  const closet = pool || items.filter(i => itemStatus(i) === "Available");
  const start = `${ym}-01`, end = `${ym}-${String(monthDays(ym)).padStart(2, "0")}`;
  const today = todayStr();
  const inProgress = monthOf(today) === ym;

  // item → sorted wear days (whole history — the movement questions need it).
  const dayMap = new Map();
  const lookDays = new Map();
  for (const w of rows) {
    if (!w.worn_on) continue;
    if (w.item_id) { let s = dayMap.get(w.item_id); if (!s) dayMap.set(w.item_id, s = new Set()); s.add(w.worn_on); }
    if (w.outfit_id) { let s = lookDays.get(w.outfit_id); if (!s) lookDays.set(w.outfit_id, s = new Set()); s.add(w.worn_on); }
  }
  const inMonth = (d) => d >= start && d <= end;

  const daysLoggedSet = new Set();
  const levelDays = new Map();          // level → count of (day, level) occasions
  const seenLvl = new Set();
  for (const w of rows) {
    if (!w.worn_on || !inMonth(w.worn_on)) continue;
    daysLoggedSet.add(w.worn_on);
    if (w.formality_for) {
      const k = w.formality_for + "|" + w.worn_on;
      if (!seenLvl.has(k)) { seenLvl.add(k); levelDays.set(w.formality_for, (levelDays.get(w.formality_for) || 0) + 1); }
    }
  }
  const elapsed = inProgress ? +today.slice(8, 10) : monthDays(ym);

  // ---- per piece, inside the month ----
  const worn = [];
  for (const [id, s] of dayMap) {
    const i = itemById.get(id);
    if (!i) continue;
    const days = [...s].sort();
    const mine = days.filter(inMonth);
    if (!mine.length) continue;
    const before = days.filter(d => d < start).length;
    const through = before + mine.length;
    const price = (i.price != null && i.price > 0) ? i.price : null;
    const gift = i.acquisition === "Gift";
    const cpwBefore = (price && before) ? price / before : null;
    const cpwAfter = price ? price / through : null;
    // Longest gap CLOSED this month — a rediscovery is a gap, not a count.
    let bestGap = null;
    for (const d of mine) {
      const prior = days.filter(x => x < d);
      if (!prior.length) continue;
      const g = daysBetween(prior[prior.length - 1], d);
      if (bestGap == null || g > bestGap) bestGap = g;
    }
    worn.push({
      item: i, n: mine.length, before, through, price, gift,
      cpwBefore, cpwAfter,
      drop: (cpwBefore != null && cpwAfter != null) ? cpwBefore - cpwAfter : null,
      debut: before === 0,
      gap: bestGap,
      paidOff: !!(price && !gift && before && cpwBefore > 1 && cpwAfter <= 1),
    });
  }
  worn.sort((a, b) => (b.n - a.n) || ((a.item.name || "") < (b.item.name || "") ? -1 : 1));

  // ---- looks ----
  const looks = [];
  for (const [oid, s] of lookDays) {
    const o = outfitById.get(oid);
    if (!o) continue;
    const n = [...s].filter(inMonth).length;
    if (n) looks.push({ outfit: o, n });
  }
  looks.sort((a, b) => b.n - a.n);

  // ---- colour of the month, in PIECE-DAYS (the Palette unit) ----
  const colour = new Map();
  for (const w of worn) {
    const cf = w.item.color_family;
    if (!cf) continue;
    colour.set(cf, (colour.get(cf) || 0) + w.n);
  }
  const topColour = [...colour.entries()].sort((a, b) => b[1] - a[1])[0] || null;

  // ---- weather bookends ----
  const wl = log || (typeof wxLog === "function" ? wxLog() : {});
  let hottest = null, coldest = null;
  for (const d of daysLoggedSet) {
    const e = wl[d];
    if (!e || e.maxT == null) continue;
    if (!hottest || e.maxT > hottest.maxT) hottest = { date: d, ...e };
    if (!coldest || e.minT < coldest.minT) coldest = { date: d, ...e };
  }

  // ---- the busiest day, and the priciest outing ----
  let busiest = null, priciest = null;
  const byDay = new Map();
  for (const d of daysLoggedSet) byDay.set(d, []);
  for (const w of worn) for (const d of [...dayMap.get(w.item.id)].filter(inMonth)) byDay.get(d)?.push(w.item);
  for (const [d, its] of byDay) {
    if (!busiest || its.length > busiest.n) busiest = { date: d, n: its.length };
    const v = its.reduce((a, i) => a + (i.price || 0), 0);
    if (v > 0 && (!priciest || v > priciest.v)) priciest = { date: d, v, n: its.length };
  }

  // ---- against last month ----
  const prevYm = shiftMonth(ym, -1);
  let prevDays = new Set(), prevPieces = new Set();
  for (const w of rows) {
    if (!w.worn_on || monthOf(w.worn_on) !== prevYm) continue;
    prevDays.add(w.worn_on);
    if (w.item_id) prevPieces.add(w.item_id);
  }

  return {
    ym, label: monthLabel(ym), inProgress, elapsed, days: monthDays(ym),
    daysLogged: daysLoggedSet.size,
    coverage: elapsed ? daysLoggedSet.size / elapsed : 0,
    pieces: worn.length,
    closetShare: closet.length ? worn.length / closet.length : 0,
    closetSize: closet.length,
    top: worn.slice(0, 5),
    // The question she actually asked, answered by the biggest movers.
    movers: worn.filter(w => w.drop != null && w.drop > 0).sort((a, b) => b.drop - a.drop).slice(0, 5),
    paidOff: worn.filter(w => w.paidOff),
    debuts: worn.filter(w => w.debut),
    rediscovered: worn.filter(w => w.gap != null && w.gap >= MONTH_REDISCOVER_DAYS)
      .sort((a, b) => b.gap - a.gap),
    topLook: looks[0] || null,
    repeats: looks.filter(l => l.n > 1),
    levels: [...levelDays.entries()].sort((a, b) => a[0] - b[0]),
    topColour, hottest, coldest, busiest, priciest,
    valueWorn: worn.reduce((a, w) => a + (w.price || 0), 0),
    prev: { ym: prevYm, label: monthLabel(prevYm), daysLogged: prevDays.size, pieces: prevPieces.size },
  };
}

let statsMonthYm = null;
function renderStatsMonthPage() {
  const ym = statsMonthYm || monthOf(todayStr());
  const s = buildMonthReview(ym);
  // Every month she has actually logged in, newest first — the browser.
  const months = [...new Set(wears.map(w => monthOf(w.worn_on)).filter(m => m && m.length === 7))]
    .sort((a, b) => (a < b ? 1 : -1)).slice(0, 24);
  // "June 2026" → "June ’26" so a year of chips fits on one scrolling row.
  const shortMonth = (m) => monthLabel(m).replace(/ \d{2}(\d{2})$/, " ’$1");
  const chips = `<div class="cap-catbar" style="padding:8px 14px 0;overflow-x:auto">${months.map(m =>
    `<button class="cap-chip${m === ym ? " on" : ""}" data-mo="${m}" style="white-space:nowrap">${esc(shortMonth(m))}</button>`).join("")}</div>`;

  const card = (inner, accent) => `<div style="margin:12px 14px;padding:16px;border-radius:16px;border:1px solid var(--line);${accent ? "background:var(--accent-soft);" : ""}">${inner}</div>`;
  const big = (v, lbl) => `<div style="text-align:center;flex:1"><div style="font-size:30px;font-weight:800;color:var(--accent);line-height:1.1">${v}</div><div style="font-size:12px;color:var(--muted);padding-top:3px">${lbl}</div></div>`;
  const lbl = (t) => `<div style="font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-bottom:10px">${t}</div>`;
  const row = (it, right, sub) => `<button data-mo-item="${esc(it.id)}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:6px 0">
      ${thumbHtml(it.image_path, "sthumb")}
      <span style="flex:1;min-width:0">
        <span style="display:block;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.name || "Untitled")}</span>
        ${sub ? `<span style="display:block;font-size:11.5px;color:var(--muted)">${esc(sub)}</span>` : ""}
      </span>
      <span style="flex:none;font-size:13px;color:var(--accent);font-weight:600">${esc(right)}</span>
    </button>`;

  if (!s.daysLogged) {
    $("#statsBody").innerHTML = statsToolbar(s.label, true, false, true) + chips +
      `<div class="placeholder" style="padding:44px 32px"><b>Nothing logged in ${esc(s.label)}</b>
        <div>Pick another month above.</div></div>`;
    wireStatsToolbar();
    $("#statsBody").querySelectorAll("[data-mo]").forEach(b =>
      b.onclick = () => { statsMonthYm = b.dataset.mo; renderStats(); });
    return;
  }

  const hero = card(`
    <div style="text-align:center;font-size:15px;font-weight:700;margin-bottom:14px">${esc(s.label)}${s.inProgress ? " · so far" : ""}</div>
    <div style="display:flex">
      ${big(s.daysLogged, "days logged")}
      ${big(`${Math.round(s.coverage * 100)}%`, "of the month")}
      ${big(s.pieces, "pieces worn")}
    </div>
    <div style="text-align:center;font-size:12.5px;color:var(--muted);padding-top:12px;line-height:1.5">
      That's ${Math.round(s.closetShare * 100)}% of your ${s.closetSize}-piece closet out of the wardrobe.
    </div>`, true);

  // The question she asked, first.
  const movers = s.movers.length ? card(lbl("What got cheaper") +
    s.movers.map(m => row(m.item, `−${esc(_cpw(m.drop))}`,
      `${_cpw(m.cpwBefore)} → ${_cpw(m.cpwAfter)} a wear · ${m.n} day${m.n === 1 ? "" : "s"} this month`)).join("") +
    (s.paidOff.length ? `<div style="font-size:13px;color:var(--accent);font-weight:600;padding-top:10px">💸 ${s.paidOff.length} piece${s.paidOff.length === 1 ? "" : "s"} went under $1 a wear this month</div>` : "")) : "";

  const most = s.top.length ? card(lbl("Worn most") +
    s.top.map(w => row(w.item, `${w.n}d`,
      w.through === w.n ? "all of it this month" : `${w.through} days out all-time`)).join("")) : "";

  const lookCard = s.topLook ? card(lbl("The look you kept coming back to") + `
    <div style="display:flex;align-items:center;gap:12px">
      <button data-mo-look="${esc(s.topLook.outfit.id)}" style="width:64px;flex:none">${outfitCollageHtml(s.topLook.outfit, 4)}</button>
      <button data-mo-look="${esc(s.topLook.outfit.id)}" style="flex:1;min-width:0;text-align:left">
        <div style="font-size:15px;font-weight:700">${esc(outfitName(s.topLook.outfit))}</div>
        <div style="font-size:13px;color:var(--muted)">${s.topLook.n} time${s.topLook.n === 1 ? "" : "s"}${s.repeats.length > 1 ? ` · ${s.repeats.length} looks repeated` : ""}</div>
      </button>
    </div>`) : "";

  const debuts = s.debuts.length ? card(lbl(`First outings · ${s.debuts.length}`) +
    s.debuts.slice(0, 6).map(w => row(w.item, `${w.n}d`, "first time ever worn")).join("")) : "";

  const redis = s.rediscovered.length ? card(lbl(`Back from the deep · ${s.rediscovered.length}`) +
    `<div style="font-size:12.5px;color:var(--muted);margin:-4px 0 8px">Worn again after ${MONTH_REDISCOVER_DAYS}+ days out of sight.</div>` +
    s.rediscovered.slice(0, 6).map(w => row(w.item, humanGap(w.gap), "since the time before")).join("")) : "";

  // Fun, but derived and honest: the shape of the month rather than a number.
  const levelTotal = s.levels.reduce((a, [, n]) => a + n, 0);
  const mix = levelTotal ? card(lbl("How dressed up") + `
    <div style="display:flex;height:12px;border-radius:99px;overflow:hidden;margin-bottom:10px">
      ${s.levels.map(([lv, n]) => `<div title="${esc(occLabel(lv))}" style="width:${(n / levelTotal * 100).toFixed(1)}%;background:var(--accent);opacity:${(0.25 + 0.75 * (lv / 8)).toFixed(2)}"></div>`).join("")}
    </div>
    <div style="font-size:12.5px;color:var(--muted);line-height:1.5">${s.levels.map(([lv, n]) =>
      `${esc(occLabel(lv))} ${Math.round(n / levelTotal * 100)}%`).join(" · ")}</div>`) : "";

  const bits = [];
  if (s.topColour) bits.push(`<b style="color:var(--text)">${esc(s.topColour[0])}</b> was your colour of the month — ${s.topColour[1]} piece-days.`);
  if (s.busiest && s.busiest.n > 2) bits.push(`Your fullest day was ${esc(fmtDate(s.busiest.date))} with ${s.busiest.n} pieces.`);
  if (s.hottest && s.coldest && s.hottest.maxT !== s.coldest.maxT)
    bits.push(`You dressed for ${s.coldest.minT}° and ${s.hottest.maxT}° in the same month.`);
  if (s.priciest) bits.push(`The most valuable thing you walked out in was ${esc(money(s.priciest.v))} on ${esc(fmtDate(s.priciest.date))}.`);
  if (s.prev.daysLogged) {
    const dd = s.daysLogged - s.prev.daysLogged;
    bits.push(dd === 0 ? `Same number of days logged as ${esc(s.prev.label)}.`
      : `${Math.abs(dd)} ${dd > 0 ? "more" : "fewer"} day${Math.abs(dd) === 1 ? "" : "s"} logged than ${esc(s.prev.label)}.`);
  }
  const odds = bits.length ? card(lbl("Odds and ends") +
    `<div style="font-size:13.5px;line-height:1.65;color:var(--muted)">${bits.join(" ")}</div>`) : "";

  $("#statsBody").innerHTML = statsToolbar(s.label, true, false, true) + chips +
    hero + movers + most + lookCard + redis + debuts + mix + odds +
    `<div style="height:34px"></div>`;
  hydratePhotos($("#statsBody"));
  wireStatsToolbar();
  $("#statsBody").querySelectorAll("[data-mo]").forEach(b =>
    b.onclick = () => { statsMonthYm = b.dataset.mo; renderStats(); });
  $("#statsBody").querySelectorAll("[data-mo-item]").forEach(b =>
    b.onclick = () => openItemFromStats(b.dataset.moItem));
  $("#statsBody").querySelectorAll("[data-mo-look]").forEach(b =>
    b.onclick = () => openLookFrom(b.dataset.moLook));
}

/* The flagged list. ⚠️ Whole-wardrobe page → no pool AND hideFilter=true, per
   the funnel rule: a funnel that silently changed nothing would lie. */
function renderStatsFlaggedPage() {
  _thinBaseMemo = null;   // one baseline per render pass — see _thinBase
  const list = flaggedItems();
  const body = list.length ? list.map(({ item, note, at }) => {
    const im = deleteImpact(item.id);
    return `<div class="det-card" style="margin:0 14px 10px;padding:12px 13px">
      <button data-fl-item="${esc(item.id)}" style="display:flex;align-items:center;gap:11px;width:100%;text-align:left">
        ${thumbHtml(item.image_path, "sthumb")}
        <span style="flex:1;min-width:0">
          <span style="display:block;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.name || "Untitled")}</span>
          <span class="muted" style="display:block;font-size:11.5px">flagged ${esc(fmtDate(at))}${im && im.wearDays ? ` · ${im.wearDays} wear${im.wearDays === 1 ? "" : "s"} on record` : " · never worn"}</span>
        </span>
      </button>
      ${note ? `<div style="font-size:13px;line-height:1.5;padding-top:8px;font-style:italic">“${esc(note)}”</div>` : ""}
      <div style="padding-top:9px">${deleteImpactHtml(im)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;padding-top:11px">
        <button class="cap-chip" data-fl-edit="${esc(item.id)}" style="font-size:12.5px">✎ Note</button>
        <button class="cap-chip" data-fl-store="${esc(item.id)}" style="font-size:12.5px">Move to Storage</button>
        <button class="cap-chip" data-fl-clear="${esc(item.id)}" style="font-size:12.5px;color:var(--muted)">Keep it</button>
      </div>
    </div>`;
  }).join("") : `<div class="placeholder" style="padding:44px 32px"><b>Nothing flagged</b>
      <div>Open any piece and tap “Flag for review” to set it aside. Flagging changes nothing — it just collects them here.</div></div>`;

  $("#statsBody").innerHTML = statsToolbar("Flagged for review", true, false, true)
    + `<div class="snote" style="padding:10px 16px 4px;font-size:12.5px;line-height:1.5">Pieces you've set aside to think about, with what you'd lose if you deleted them. Nothing here is a recommendation — it's your list.</div>`
    + body + `<div style="height:34px"></div>`;
  hydratePhotos($("#statsBody"));
  wireStatsToolbar();
  $("#statsBody").querySelectorAll("[data-fl-item]").forEach(b =>
    b.onclick = () => openItemFromStats(b.dataset.flItem));
  $("#statsBody").querySelectorAll("[data-fl-edit]").forEach(b =>
    b.onclick = () => openFlagSheet(b.dataset.flEdit));
  $("#statsBody").querySelectorAll("[data-fl-clear]").forEach(b =>
    b.onclick = async () => { await clearFlag(b.dataset.flClear); renderStats(); });
  $("#statsBody").querySelectorAll("[data-fl-store]").forEach(b =>
    b.onclick = async () => {
      const id = b.dataset.flStore;
      await saveField(id, "status", "Storage");
      await clearFlag(id);
      toast("Moved to Storage — history kept");
      renderStats();
    });
}

function renderStatsContextDetailPage() {
  const c = statsContextSel;
  const topItems = contextTopItems(c, 12);
  const items = topItems.map(({ item }) => item);
  const itemWearCounts = new Map(topItems.map(({ item, n }) => [item.id, n]));
  const itemSub = (i) => { const n = itemWearCounts.get(i.id) || 0; return `${n} wear${n === 1 ? "" : "s"}`; };
  const looks = contextTopLooks(c, 12);
  const looksHtml = looks.length
    ? `<div class="ogrid" style="padding:0 14px">${looks.map(({ outfit, n }) => `<button class="otile" data-sctx-look="${esc(outfit.id)}">
        ${outfitCollageHtml(outfit, 4)}
        <div class="oname">${esc(outfitName(outfit))}</div>
        <div class="ometa">${n} wear${n === 1 ? "" : "s"}</div>
      </button>`).join("")}</div>`
    : `<div class="stats-note" style="padding:8px 18px">No looks logged with this context yet.</div>`;
  // Same as the Contexts list it drills in from: contextTopItems/contextTopLooks
  // are whole-wardrobe, so a funnel here would only pretend to narrow them.
  $("#statsBody").innerHTML = statsToolbar(c || "Context", true, false, true)
    + `<div class="sf-label">TOP ITEMS</div>${itemGridView(items, { subtitleFn: itemSub, emptyMsg: "No items logged with this context yet" })}
       <div class="sf-label">TOP LOOKS</div>${looksHtml}`;
  wireStatsToolbar();
  hydratePhotos($("#statsBody"));
  $("#statsBody").querySelectorAll(".gtile").forEach(btn => {
    btn.addEventListener("click", () => { if (btn.dataset.item) openItemFromStats(btn.dataset.item); });
  });
  $("#statsBody").querySelectorAll("[data-sctx-look]").forEach(el => {
    el.addEventListener("click", () => openLookFrom(el.dataset.sctxLook));
  });
}

/* ---- Brand / Retailer report cards ---- */
// Like statsPool, but archived items stay in unless the user explicitly
// filters status — the dud rate needs to see what got archived.
function reportPool() {
  const acqCutoff = acqRangeStart();
  return items.filter(i => {
    if (!itemMatchesFilter(i, statsFilter, { noStatusDefault: true })) return false;
    if (acqCutoff) {
      const pd = i.purchase_date;
      if (acqCutoff.older) { if (!pd || pd >= acqCutoff.cutoff) return false; }
      else                 { if (!pd || pd < acqCutoff.cutoff)  return false; }
    }
    return true;
  });
}

const REPORT_MIN_ITEMS = 3;  // fewer items than this → unranked "fewer than…" section
const REPORT_DUD_WEARS = 3;  // archived under this many wears counts as a dud

// Report-card dimensions. "ranked" dims sort by the wear index with a Best/Worst
// toggle and a min-items split; "canonical" dims keep a fixed browse order (no
// cross-group ranking implied). showIdx:false hides the vs-similar index — for
// subcategory it would be ×1.0 by construction (items are standardized against
// their own subcategory peers); the payoff there is best/worst WITHIN the group.
const REPORT_DIMS = {
  brand:        { title: "Brands",         mode: "ranked",    keyFn: i => (i.brand || "").trim(),    noValueLabel: "brand" },
  retailer:     { title: "Retailers",      mode: "ranked",    keyFn: i => (i.retailer || "").trim(), noValueLabel: "retailer" },
  color_family: { title: "Colors",         mode: "ranked",    keyFn: i => i.color_family || "",      noValueLabel: "color" },
  acquisition:  { title: "Acquisition",    mode: "ranked",    keyFn: i => i.acquisition || "",       noValueLabel: "acquisition" },
  subcategory:  { title: "Subcategories",  mode: "canonical", keyFn: i => i.subcategory || "",       noValueLabel: "subcategory", showIdx: false },
  price:        { title: "Price Brackets", mode: "canonical", keyFn: i => priceBracketLabel(i),      noValueLabel: "price" },
  year:         { title: "Purchase Years", mode: "canonical", keyFn: i => (i.purchase_date || "").slice(0, 4), noValueLabel: "purchase date" },
};

function priceBracketLabel(i) {
  const p = parseFloat(i.price);
  if (i.price == null || isNaN(p)) return "";
  const b = PRICE_BRACKETS.find(b => p >= b.min && p < b.max);
  return b ? b.label : "";
}

// One pass over wears → per-item { days: Set(worn_on), first: earliest date }.
function itemWearIndex() {
  const m = new Map();
  for (const w of wears) {
    if (!w.item_id) continue;
    let e = m.get(w.item_id);
    if (!e) { e = { days: new Set(), first: w.worn_on }; m.set(w.item_id, e); }
    e.days.add(w.worn_on);
    if (w.worn_on < e.first) e.first = w.worn_on;
  }
  return m;
}

// Per-item performance: wears, months observed, expected wears, and the
// "vs similar items" index. Tenure per item starts at purchase_date (falling
// back to its first wear, then created_at) but never before the earliest logged
// wear anywhere — months before logging began can't be observed and would
// deflate the rate. "vs expected" = actual wears / (peer wear-rate × months
// observed), where the peer rate comes from the item's subcategory (category
// fallback when the subcategory slice is under 5 items) — so basics aren't
// rewarded over formal pieces just for being basics. A peer rate of 0
// contributes nothing either way. Shared by the report cards, the
// Workhorses/Declutter smart lists, the capsule picker strip, and the item badge.
function buildItemPerf(pool) {
  const wearIdx = itemWearIndex();
  let epoch = null;
  for (const e of wearIdx.values()) if (!epoch || e.first < epoch) epoch = e.first;
  const today = todayStr();
  const MS_MONTH = 86400000 * 30.44;
  const per = new Map();
  for (const i of pool) {
    const e = wearIdx.get(i.id);
    const count = e ? e.days.size : 0;
    let since = i.purchase_date || (e ? e.first : null) || (i.created_at || today).slice(0, 10);
    if (epoch && since < epoch) since = epoch;
    const months = Math.max(1, (new Date(today) - new Date(since)) / MS_MONTH);
    per.set(i.id, { count, months, exp: 0, idx: null });
  }

  const bump = (map, key, p) => {
    const e = map.get(key) || { w: 0, m: 0, n: 0 };
    e.w += p.count; e.m += p.months; e.n++; map.set(key, e);
  };
  const subRate = new Map(), catRate = new Map();
  let totW = 0, totM = 0;
  for (const i of pool) {
    const p = per.get(i.id);
    bump(catRate, i.category || "?", p);
    bump(subRate, (i.category || "?") + "/" + (i.subcategory || "?"), p);
    totW += p.count; totM += p.months;
  }
  const overallRate = totM ? totW / totM : 0;
  for (const i of pool) {
    const p = per.get(i.id);
    const s = subRate.get((i.category || "?") + "/" + (i.subcategory || "?"));
    const c = catRate.get(i.category || "?");
    const rate = (s && s.n >= 5 && s.m) ? s.w / s.m
               : (c && c.m) ? c.w / c.m
               : overallRate;
    p.exp = rate * p.months;
    p.idx = p.exp > 0 ? p.count / p.exp : null;
  }
  return per;
}

// Group per-item performance by a report dimension (see REPORT_DIMS).
function buildReportStats(field) {
  const pool = reportPool();
  const per = buildItemPerf(pool);
  const keyFn = REPORT_DIMS[field].keyFn;

  const groups = new Map();
  let noValue = 0;
  for (const i of pool) {
    const label = keyFn(i);
    if (!label) { noValue++; continue; }
    let g = groups.get(label);
    if (!g) { g = []; groups.set(label, g); }
    g.push(i);
  }
  const rows = [...groups.entries()].map(([label, list]) => {
    let wearsN = 0, months = 0, exp = 0, duds = 0, spend = 0, gifts = 0, priced = 0;
    const cpws = [];
    for (const i of list) {
      const p = per.get(i.id);
      wearsN += p.count; months += p.months; exp += p.exp;
      if (p.count === 0 || (itemStatus(i) === "Archive" && p.count < REPORT_DUD_WEARS)) duds++;
      if (i.acquisition === "Gift") { gifts++; continue; }
      const price = parseFloat(i.price);
      if (isNaN(price)) continue;
      spend += price; priced++;
      if (p.count > 0) cpws.push(price / p.count);
    }
    cpws.sort((a, b) => a - b);
    const mid = cpws.length >> 1;
    const medCPW = !cpws.length ? null : (cpws.length % 2 ? cpws[mid] : (cpws[mid - 1] + cpws[mid]) / 2);
    return {
      label, items: list, n: list.length, wears: wearsN,
      rate: months ? wearsN / months : 0,
      idx: exp > 0 ? wearsN / exp : null,
      duds, spend, medCPW, gifts, priced,
    };
  });
  return { rows, per, noValue };
}

const fmtReportIdx = (v) => v == null ? "—" : "×" + v.toFixed(1);
const reportIdxColor = (v) => v == null ? "var(--muted)" : v >= 1.15 ? "#3a7d44" : v <= 0.85 ? "#c0392b" : "var(--text)";

function renderStatsReportPage() {
  const field = statsReportField;
  const dim = REPORT_DIMS[field];
  /* Every real entry point sets `statsView` and `statsReportField` together, so
     this shouldn't fire — but the two are separate globals and dereferencing a
     missing dim throws, which renders as a blank screen with no way back. Fall
     back to the list this page came from rather than dying. */
  if (!dim) { statsView = "main"; statsReportField = null; renderStatsMain(); return; }
  const { rows, noValue } = buildReportStats(field);
  const showIdx = dim.showIdx !== false;
  const thisYear = String(new Date().getFullYear());

  const rowHtml = (r, detailed) => {
    // Current-year cohort: too little tenure to call anything a dud yet.
    const dudTxt = (field === "year" && r.label === thisYear)
      ? " · still proving out"
      : (r.duds ? ` · ${r.duds} dud${r.duds === 1 ? "" : "s"}` : "");
    const sub = detailed
      ? `${r.n} item${r.n === 1 ? "" : "s"} · ${r.rate.toFixed(1)} wears/mo · ${r.medCPW != null ? money(r.medCPW) + "/wear" : "no cost data"}${dudTxt}`
      : `${r.n} item${r.n === 1 ? "" : "s"} · ${r.wears} wear${r.wears === 1 ? "" : "s"}`;
    return `<button class="frow" data-srb="${esc(r.label)}">
      <div class="fmeta"><div class="fname">${esc(r.label)}</div><div class="fcount">${esc(sub)}</div></div>
      ${detailed && showIdx ? `<span style="font-size:16px;font-weight:700;margin-right:6px;flex-shrink:0;color:${reportIdxColor(r.idx)}">${fmtReportIdx(r.idx)}</span>` : ""}
      <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
    </button>`;
  };

  let listHtml, sortBar = "";
  if (dim.mode === "ranked") {
    const ranked = rows.filter(r => r.n >= REPORT_MIN_ITEMS);
    const withIdx = ranked.filter(r => r.idx != null).sort((a, b) => b.idx - a.idx);
    if (statsReportSort === "worst") withIdx.reverse();
    const display = [...withIdx, ...ranked.filter(r => r.idx == null)];
    const small = rows.filter(r => r.n < REPORT_MIN_ITEMS).sort((a, b) => b.n - a.n || b.wears - a.wears);
    sortBar = `<div class="stats-sort-bar" style="padding-bottom:6px">
        <button class="stats-sort-btn${statsReportSort === "best" ? " on" : ""}" data-srs="best">Best first</button>
        <button class="stats-sort-btn${statsReportSort === "worst" ? " on" : ""}" data-srs="worst">Worst first</button>
      </div>`;
    listHtml = (display.length
        ? `<div class="frows">${display.map(r => rowHtml(r, true)).join("")}</div>`
        : `<div class="placeholder"><b>Not enough data</b><div>${esc(dim.title)} with ${REPORT_MIN_ITEMS}+ items get ranked here.</div></div>`)
      + (small.length ? `<div class="sf-label">Fewer than ${REPORT_MIN_ITEMS} items</div><div class="frows">${small.map(r => rowHtml(r, false)).join("")}</div>` : "");
  } else if (field === "subcategory") {
    // Taxonomy order with category headers; unrecognized subcats go under Other.
    const byLabel = new Map(rows.map(r => [r.label, r]));
    const used = new Set();
    const sections = [];
    for (const cat of CATEGORIES) {
      const secRows = (TAXONOMY[cat] || []).map(s => byLabel.get(s)).filter(Boolean);
      if (secRows.length) { sections.push({ hdr: cat, rows: secRows }); secRows.forEach(r => used.add(r.label)); }
    }
    const other = rows.filter(r => !used.has(r.label)).sort((a, b) => b.n - a.n);
    if (other.length) sections.push({ hdr: "Other", rows: other });
    listHtml = sections.map(s =>
      `<div class="sf-label">${esc(s.hdr)}</div><div class="frows">${s.rows.map(r => rowHtml(r, true)).join("")}</div>`
    ).join("") || `<div class="placeholder"><b>No data yet</b></div>`;
  } else {
    // price: bracket order · year: newest first
    const ordered = field === "price"
      ? PRICE_BRACKETS.map(b => rows.find(r => r.label === b.label)).filter(Boolean)
      : rows.sort((a, b) => b.label.localeCompare(a.label));
    listHtml = ordered.length
      ? `<div class="frows">${ordered.map(r => rowHtml(r, true)).join("")}</div>`
      : `<div class="placeholder"><b>No data yet</b></div>`;
  }

  const note = showIdx
    ? "×1.0 = worn about as much as similar items, for how long you've had each piece. Higher over-performs, lower under-performs. Cost stats skip gifts."
    : "Tap a type to see its best and worst pieces. Cost stats skip gifts.";

  $("#statsBody").innerHTML = statsToolbar(dim.title, true)
    + `<div class="stats-note" style="padding:12px 18px 2px">${esc(note)}</div>`
    + sortBar
    + (sortBar ? "" : `<div style="height:8px"></div>`)
    + listHtml
    + (noValue ? `<div class="stats-note" style="padding:12px 18px 24px">${noValue} item${noValue === 1 ? " has" : "s have"} no ${esc(dim.noValueLabel)} set.</div>` : `<div style="height:24px"></div>`);

  wireStatsToolbar();
  $("#statsBody").querySelectorAll("[data-srs]").forEach(btn => {
    btn.addEventListener("click", () => { statsReportSort = btn.dataset.srs; renderStatsReportPage(); });
  });
  $("#statsBody").querySelectorAll("[data-srb]").forEach(el => {
    el.addEventListener("click", () => {
      statsReportSel = el.dataset.srb; statsView = "report-detail"; renderStats();
    });
  });
}

function renderStatsReportDetailPage() {
  const field = statsReportField;
  const { rows, per } = buildReportStats(field);
  const r = rows.find(x => x.label === statsReportSel);
  if (!r) { statsView = "report"; renderStats(); return; }  // filter change can empty the group

  const scored = r.items.map(i => ({ i, p: per.get(i.id) }));
  const worn = scored.filter(x => x.p.count > 0 && x.p.idx != null).sort((a, b) => b.p.idx - a.p.idx);
  const best = worn.slice(0, 6);
  const bestIds = new Set(best.map(x => x.i.id));
  // Worst: never-worn first (priciest shelf-sitters lead), then lowest index.
  const never = scored.filter(x => x.p.count === 0)
    .sort((a, b) => (parseFloat(b.i.price) || 0) - (parseFloat(a.i.price) || 0));
  const worst = [...never, ...worn.slice().reverse().filter(x => !bestIds.has(x.i.id))].slice(0, 6);

  const subFor = new Map();
  for (const x of best) subFor.set(x.i.id, `${x.p.count} wear${x.p.count === 1 ? "" : "s"} · ${fmtReportIdx(x.p.idx)}`);
  for (const x of worst) if (!subFor.has(x.i.id)) subFor.set(x.i.id,
    x.p.count === 0 ? "never worn" : `${x.p.count} wear${x.p.count === 1 ? "" : "s"} · ${fmtReportIdx(x.p.idx)}`);
  const subFn = (i) => subFor.get(i.id) || "";

  const kpi = (val, lbl) => `<div class="kpi-cell"><div class="kpi-val">${val}</div><div class="kpi-lbl">${esc(lbl)}</div></div>`;
  const isThisYear = field === "year" && r.label === String(new Date().getFullYear());
  const dudNote = isThisYear
    ? "Bought this year — too soon to call anything a dud."
    : r.duds
      ? `${r.duds} of ${r.n} item${r.n === 1 ? "" : "s"} never worn or archived early.`
      : "No duds — everything got worn.";
  const giftNote = r.gifts ? ` Cost stats exclude ${r.gifts} gift${r.gifts === 1 ? "" : "s"}.` : "";
  // For subcategory the vs-similar index is ×1.0 by construction (items are
  // standardized against these same peers) — show the dud count instead.
  const secondKpi = REPORT_DIMS[field].showIdx === false
    ? kpi(r.duds, r.duds === 1 ? "Dud" : "Duds")
    : kpi(`<span style="color:${reportIdxColor(r.idx)}">${fmtReportIdx(r.idx)}</span>`, "vs Similar Items");

  $("#statsBody").innerHTML = statsToolbar(r.label, true)
    + `<div class="stats-sec" style="margin-top:12px">
      <div class="stats-sec-body">
        <div class="kpi-row" style="border-bottom:1px solid var(--line)">
          ${kpi(r.n, "Items")}${kpi(r.wears, "Total Wears")}
        </div>
        <div class="kpi-row" style="border-bottom:1px solid var(--line)">
          ${kpi(r.rate.toFixed(1), "Wears / Month")}
          ${secondKpi}
        </div>
        <div class="kpi-row">
          ${kpi(r.medCPW != null ? money(r.medCPW) : "—", "Median $ / Wear")}${kpi(r.priced ? money(r.spend) : "—", "Total Spent")}
        </div>
      </div>
      <div class="stats-note">${esc(dudNote)}${esc(giftNote)}</div>
    </div>`
    + (best.length ? `<div class="sf-label">Best performers</div>${itemGridView(best.map(x => x.i), { subtitleFn: subFn })}` : "")
    + (worst.length ? `<div class="sf-label">Underperformers</div>${itemGridView(worst.map(x => x.i), { subtitleFn: subFn })}` : "")
    + `<div class="frows" style="padding-top:8px"><button class="frow" id="srAllItems">
        <div class="fmeta"><div class="fname">All ${r.n} item${r.n === 1 ? "" : "s"}</div></div>
        <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
      </button></div><div style="height:24px"></div>`;

  wireStatsToolbar();
  hydratePhotos($("#statsBody"));
  $("#statsBody").querySelectorAll(".gtile").forEach(btn => {
    btn.addEventListener("click", () => { if (btn.dataset.item) openItemFromStats(btn.dataset.item); });
  });
  $("#srAllItems").addEventListener("click", () => {
    const counts = new Map(scored.map(x => [x.i.id, x.p.count]));
    statsView = "grid";
    statsGridItems = scored.slice().sort((a, b) => b.p.count - a.p.count).map(x => x.i);
    statsGridTitle = r.label;
    statsFromReport = true; statsFromField = false; statsFromPalette = false; statsListKey = null;
    statsSubtitleFn = (i) => { const n = counts.get(i.id) || 0; return `${n} wear${n === 1 ? "" : "s"}`; };
    renderStats();
  });
}

/* ---- Closet Review ---- */
function renderReviewLanding() {
  const body = $("#statsBody");
  const rows = REVIEW_FIELDS.map(f => ({ f, n: reviewCount(f) })).filter(r => r.n > 0);
  const total = reviewTotalItems();
  // Pin the two highest-value fields (Formality, Color) to the top under a
  // "Suggested" label; the rest stay below in alphabetical order.
  const SUGGESTED = ["formality", "color_family"];
  const suggested = SUGGESTED.map(k => rows.find(r => r.f.key === k)).filter(Boolean);
  const others = rows.filter(r => !SUGGESTED.includes(r.f.key))
    .sort((a, b) => a.f.label.localeCompare(b.f.label));
  const intro = total
    ? `<div class="stats-note" style="padding:14px 18px 6px">Pick a detail to fill in. We'll deal you the ${total} item${total === 1 ? "" : "s"} missing or guessing it, one at a time.</div>`
    : "";
  const fieldRow = r =>
    `<button class="frow rv-fieldrow" data-rv="${r.f.key}">
      <div class="fmeta"><div class="fname">${esc(r.f.label)}</div>
        <div class="fcount rv-cnt">${r.n} item${r.n === 1 ? "" : "s"} to review</div></div>
      <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
    </button>`;
  const section = (label, list) => list.length
    ? `<div class="sf-label">${esc(label)}</div><div class="stats-sec" style="margin-top:2px"><div class="stats-sec-body">${list.map(fieldRow).join("")}</div></div>`
    : "";
  const list = rows.length
    ? `${section("Suggested", suggested)}${section("More fields", others)}`
    : `<div class="rv-done"><svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        <b>All caught up</b><div>Every item has its details filled in.</div></div>`;
  body.innerHTML = `<div class="cltoolbar">
      <button class="clback" id="stBack"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
      <div class="cltitle">Closet Review</div><span style="width:34px"></span>
    </div>${intro}${list}<div style="height:24px"></div>`;
  $("#stBack").addEventListener("click", statsNavBack);
  body.querySelectorAll("[data-rv]").forEach(btn => {
    btn.addEventListener("click", () => startReview(btn.dataset.rv));
  });
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function startReview(key) {
  const f = REVIEW_FIELDS.find(x => x.key === key);
  if (!f) return;
  reviewField = key;
  reviewQueue = shuffle(reviewPool().filter(f.missing).map(i => i.id));
  reviewIdx = 0;
  statsView = "review-deal";
  renderStats();
}

function reviewAfterEdit() {
  reviewIdx++; _rvPending = null;
  if (statsView === "review-deal") renderStats();
}

function reviewSkip() { reviewIdx++; _rvPending = null; renderStats(); }

// Returns HTML for the inline field editor on a review card, or "" for complex fields.
function renderReviewInline(fieldKey) {
  const pending = _rvPending;
  const singleChips = (opts) => opts.map(o => {
    const on = pending === o;
    return `<button class="sheet-chip${on ? " on" : ""}" data-rvchip="${esc(o)}">${esc(o)}</button>`;
  }).join("");
  const multiChips = (opts) => opts.map(o => {
    const on = Array.isArray(pending) && pending.includes(o);
    return `<button class="sheet-chip${on ? " on" : ""}" data-rvchip="${esc(o)}" data-rvmulti="1">${esc(o)}</button>`;
  }).join("");

  switch (fieldKey) {
    case "formality": {
      const sel = Array.isArray(pending) ? pending : (pending ? [+pending] : []);
      const chips = OCCASION_LADDER.map((lbl, i) => {
        const lvl = i + 1, on = sel.includes(lvl);
        return `<button class="sheet-chip rv-fmlchip${on ? " on" : ""}" data-rvchip="${lvl}" data-rvfml="1">
          <span class="rv-fmllbl">${lvl}. ${esc(lbl)}</span>
          <span class="rv-fmlhint">${esc(OCCASION_HINTS[i])}</span>
        </button>`;
      }).join("");
      return `<div class="rv-inline rv-inline-col"><div class="sheet-chips" style="gap:6px">${chips}</div></div>`;
    }
    case "season":
      return `<div class="rv-inline"><div class="sheet-chips">${multiChips(SEASONS)}</div></div>`;
    case "fabric":
      return `<div class="rv-inline"><div class="sheet-chips">${multiChips(["Cotton","Linen","Wool","Cashmere","Silk","Denim","Polyester","Spandex","Nylon","Fleece","Leather","Velvet"])}</div></div>`;
    case "color_family":
      return `<div class="rv-inline"><div class="sheet-chips">${singleChips(COLOR_FAMILIES.map(c => c[0]))}</div></div>`;
    case "size":
      return `<div class="rv-inline"><div class="sheet-chips">${singleChips(["XXS","XS","S","M","L","XL","XXL","0","2","4","6","8","10","12","14","One size"])}</div></div>`;
    case "acquisition":
      return `<div class="rv-inline"><div class="sheet-chips">${singleChips(["New","Secondhand","Gift"])}</div></div>`;
    case "brand": case "retailer":
      return `<div class="rv-inline"><input class="rv-inp" id="rvInpText" type="text" value="${esc(pending || "")}" placeholder="${fieldKey === "brand" ? "Brand name" : "Retailer name"}"></div>`;
    case "price":
      return `<div class="rv-inline"><input class="rv-inp" id="rvInpText" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(pending != null ? pending : "")}" placeholder="0.00" style="width:120px"></div>`;
    case "purchase_date":
      return `<div class="rv-inline"><input class="rv-inp" id="rvInpText" type="date" value="${esc(pending || "")}"></div>`;
    default:
      return ""; // category/subcategory: use Edit Item
  }
}

function renderReviewDeal() {
  const body = $("#statsBody");
  const f = REVIEW_FIELDS.find(x => x.key === reviewField);
  if (!f) { statsView = "review"; renderStats(); return; }
  const total = reviewQueue.length;
  const toolbar = `<div class="cltoolbar">
      <button class="clback" id="stBack"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
      <div class="cltitle">${esc(f.label)}</div><span style="width:34px"></span>
    </div>`;

  if (reviewIdx >= total) {
    body.innerHTML = toolbar + `<div class="rv-done">
      <svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      <b>${esc(f.label)} — done</b><div>You reviewed all ${total} item${total === 1 ? "" : "s"}.</div>
      <button class="rv-set" id="rvBackList" style="margin-top:20px;max-width:240px">Back to review</button>
    </div>`;
    $("#stBack").addEventListener("click", statsNavBack);
    $("#rvBackList").addEventListener("click", statsNavBack);
    return;
  }

  const item = items.find(i => i.id === reviewQueue[reviewIdx]);
  if (!item) { reviewSkip(); return; }

  // Pre-populate pending with guess on first render of this card
  const guess = f.guess ? f.guess(item) : null;
  if (_rvPending === null && guess) _rvPending = guess;

  const cur = f.value(item);
  const path = item.category ? (item.subcategory ? `${item.category} › ${item.subcategory}` : item.category) : "Uncategorized";
  // A review row can edit a column it isn't named after (season_check writes
  // `season`), so the inline editor and the save both key off saveKey.
  const editKey = f.saveKey || reviewField;
  const inlineHtml = renderReviewInline(editKey);
  const hasInline = !!inlineHtml;
  const hasPending = _rvPending !== null && _rvPending !== "" && !(Array.isArray(_rvPending) && !_rvPending.length);
  // Show the "this is a guess" banner only while the pending value still equals the
  // derived guess (and the item has no stored value) — it clears once the user edits.
  const showGuessHint = cur == null && guess != null && f.guessLabel
    && JSON.stringify(_rvPending) === JSON.stringify(guess);
  const guessHintHtml = showGuessHint
    ? `<div class="rv-guess-hint"><svg viewBox="0 0 24 24"><path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7.4L12 16.7 5.3 21.4l2.3-7.4-6-4.6h7.6z"/></svg>${esc(f.guessLabel)} — confirm or change</div>`
    : "";
  // The evidence behind a derivation, always shown when the field has one. A
  // guess she can't inspect isn't one she can meaningfully revise.
  const noteText = f.note ? f.note(item) : null;
  const noteHtml = noteText
    ? `<div class="muted" style="font-size:12.5px;line-height:1.45;padding:2px 18px 8px">${esc(noteText)}</div>`
    : "";

  body.innerHTML = toolbar
    + `<div class="rv-prog">${reviewIdx + 1} of ${total}</div>
    <div class="rv-card">
      <div class="rv-photo${item.image_path ? "" : " empty"}" data-photo="${esc(item.image_path || "")}"></div>
      <div class="rv-info">
        <div class="rv-name">${esc(item.name || "Untitled")}</div>
        <div class="rv-path">${esc(path)}</div>
        ${cur ? `<div class="rv-cur">Current: <b>${esc(cur)}</b></div>` : ""}
      </div>
    </div>
    ${guessHintHtml}
    ${noteHtml}
    ${inlineHtml}
    <div class="rv-actions">
      ${hasInline
        ? `<button class="rv-confirm${hasPending ? "" : " rv-set"}" id="rvNext" style="${hasPending ? "" : "background:var(--surface);color:var(--text)"}">
             ${hasPending ? "Save &amp; Next →" : "Next →"}</button>
           <button class="rv-skip" id="rvSkip" style="flex:none;padding:14px 16px">Skip</button>`
        : `<button class="rv-set" id="rvSet">Set ${esc(f.label)}</button>
           <button class="rv-skip" id="rvSkip">Skip</button>`}
      <button class="rv-edit" id="rvEdit" style="flex:none;padding:14px 16px">Edit</button>
    </div>`;

  $("#stBack").addEventListener("click", statsNavBack);
  $("#rvSkip").addEventListener("click", reviewSkip);
  $("#rvEdit").addEventListener("click", () => openItemFromReview(item.id));

  if (hasInline) {
    const rvNext = $("#rvNext");
    rvNext.addEventListener("click", () => {
      if (hasPending) saveField(item.id, editKey, _rvPending);
      reviewAfterEdit();
    });

    // chip toggles
    body.querySelectorAll("[data-rvchip]").forEach(btn => {
      btn.addEventListener("click", () => {
        const v = btn.dataset.rvchip;
        const isFml = btn.dataset.rvfml === "1";
        const isMulti = btn.dataset.rvmulti === "1";
        if (isFml) {
          const n = +v;
          const cur2 = Array.isArray(_rvPending) ? [..._rvPending] : (_rvPending ? [+_rvPending] : []);
          _rvPending = cur2.includes(n) ? cur2.filter(x => x !== n) : [...cur2, n].sort((a, b) => a - b);
        } else if (isMulti) {
          const cur2 = Array.isArray(_rvPending) ? [..._rvPending] : [];
          _rvPending = cur2.includes(v) ? cur2.filter(x => x !== v) : [...cur2, v];
        } else {
          _rvPending = _rvPending === v ? null : v;
        }
        renderReviewDeal();
      });
    });

    // text / date / number input
    const inp = $("#rvInpText");
    if (inp) {
      inp.addEventListener("input", () => {
        _rvPending = editKey === "price" ? (inp.value ? +inp.value : null) : inp.value;
      });
      inp.focus();
    }
  } else {
    const rvSet = $("#rvSet");
    if (rvSet) rvSet.addEventListener("click", () => f.edit(item));
  }

  hydratePhotos(body);
}

// Open a FIELD_CONFIGS field for review; saves to DB then advances.
// Pre-populates with the field's guess when the item has no value yet.
function openReviewField(i, field) {
  const cfg = FIELD_CONFIGS[field];
  if (!cfg) return;
  const rf = REVIEW_FIELDS.find(x => x.key === field);
  _fieldEditId = i.id;
  _fieldEditKey = field;
  _fieldPending = i[field] || (rf && rf.guess && !i[field] ? (rf.guess(i) || i[field]) : i[field]);
  _fieldEditItem = i;
  _fieldOnSave = (val) => { saveField(i.id, field, val); reviewAfterEdit(); };
  renderFieldSheet(i, field, cfg);
  showSheet("fieldSheet");
}

// Open the category/subcategory move sheet for review.
function openReviewMove(i) {
  _reviewMoveMode = true;
  _moveItemId = i.id;
  selectedIds = new Set([i.id]);
  moveCatOpen = i.category || null;   // pre-expand current category (subcategory case)
  renderMoveSheet();
  showSheet("moveSheet");
}

// Purchase date editor (empty dates only).
function openReviewDateEdit(i) {
  _fieldEditItem = i;
  $("#fieldInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="rdCancel">Cancel</button>
      <h2>Purchase Date</h2>
      <button class="lnk" id="rdSave" style="font-weight:700">Save</button>
    </div>
    <div style="padding:16px 18px 8px">
      <input class="inp" id="rdDate" type="date" value="${esc(i.purchase_date || "")}" style="width:100%;font-size:16px">
    </div>`;
  $("#rdCancel").onclick = closeFieldSheet;
  $("#rdSave").onclick = async () => {
    const val = $("#rdDate").value || null;
    const prevD = i.purchase_date;
    i.purchase_date = val;
    closeFieldSheet();
    reviewAfterEdit();
    try {
      await rest(`/items?id=eq.${i.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ purchase_date: val }),
      });
    } catch (e) { i.purchase_date = prevD; toast(e.message); }
  };
  showSheet("fieldSheet");
}

// Open the full item detail from closet review
function openItemFromReview(itemId) {
  _reviewMode = true;
  $$(".screen").forEach(s => s.classList.toggle("active", s.id === "tab-closet"));
  $$("#tabbar button").forEach(b => b.classList.toggle("on", b.dataset.tab === "closet"));
  $("#title").textContent = "";
  $("#headerAdd").hidden = true;
  hideGridBar();
  openItem(itemId);
}

