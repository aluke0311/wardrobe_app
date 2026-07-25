/* ===================================================================
   SEARCH  (keyword + Color/Fabric/Size/Season/Brand/Status filters)
   =================================================================== */
const FILTER_FORMALITY_OPTS = ["1","2","3","4","5","6","7","8"];
const FILTERS = [
  ["color",      "Color",       () => COLOR_FAMILIES.map(c => c[0])],
  ["fabric",     "Fabric",      () => distinctArr("fabric")],
  ["size",       "Size",        () => distinctScalar("size")],
  ["season",     "Season",      () => SEASONS],
  ["brand",      "Brand",       () => distinctScalar("brand")],
  ["status",     "Status",      () => STATUSES],
  ["category",   "Category",    () => Object.keys(TAXONOMY)],
  ["subcategory","Subcategory", () => distinctScalar("subcategory")],
  ["formality",  "Formality",   () => FILTER_FORMALITY_OPTS],
  ["retailer",   "Retailer",    () => distinctScalar("retailer")],
  ["acquisition","Acquisition", () => ["New","Secondhand","Gift"]],
  ["capsule",    "Capsule",     () => capsules.map(c => c.name).sort()],
  ["context",    "Worn for",    () => contextOptions()],
];
// Per-surface filter dims: closet uses lens for status + folders for category/subcategory (not in funnel).
// Stats includes category (useful: filter to Tops only), but not subcategory (too granular).
// Looks has no category/subcategory dims (outfits are cross-category by design).
const CLOSET_FILTER_DIMS = FILTERS.filter(([k]) => !["status","category","subcategory","capsule"].includes(k));
const STATS_FILTER_DIMS  = FILTERS.filter(([k]) => k !== "subcategory"); // keep category: "show Tops only" is a useful stats lens
// L4: "Liked" is outfit-only (o.rating) — appended only here, not to the shared
// FILTERS array, so itemMatchesFilter (which destructures specific keys) simply
// never sees it and other surfaces stay unaffected.
const LOOKS_FILTER_DIMS  = [
  ...FILTERS.filter(([k]) => !["category","subcategory"].includes(k))
    // Looks add the derived "Home" bucket (no shoes) alongside the 1-8 levels.
    .map(d => d[0] === "formality" ? ["formality", "Formality", () => ["Home", ...FILTER_FORMALITY_OPTS]] : d),
  ["liked", "Liked", () => ["Liked"]],
];
// Builder picker already has its own category/subcategory folder nav + a single-select
// capsule scope chip bar — the funnel only needs attribute dims layered on top.
const BUILDER_FILTER_DIMS = FILTERS.filter(([k]) => !["category","subcategory","capsule"].includes(k));
// Shared calendar +Clothing / capsule add-items picker (the `_capPick*` family): it
// already has its own status chips + category/subcategory folder nav, but — unlike
// the builder picker — capsule STAYS IN as a funnel dim (this was the reported bug:
// no way to narrow these pickers to a capsule/trip's members).
const PICKER_FILTER_DIMS = FILTERS.filter(([k]) => !["status","category","subcategory"].includes(k));

// ---- unified filter state (persists across renders per surface) ----
function newFilterState(overrides) {
  const s = { q: "", color: new Set(), fabric: new Set(), size: new Set(),
    season: new Set(), brand: new Set(), status: new Set(), category: new Set(),
    subcategory: new Set(), formality: new Set(), retailer: new Set(),
    acquisition: new Set(), capsule: new Set(), liked: new Set(), context: new Set() };
  if (overrides) Object.assign(s, overrides);
  return s;
}
function hasActiveFilter(f) {
  if (f.q) return true;
  return ["color","fabric","size","season","brand","status","category","subcategory",
          "formality","retailer","acquisition","capsule","liked","context"].some(k => f[k] instanceof Set && f[k].size > 0);
}
function filterActiveCount(f) {
  let n = f.q ? 1 : 0;
  for (const k of ["color","fabric","size","season","brand","status","category","subcategory",
                   "formality","retailer","acquisition","capsule","liked","context"]) if (f[k]?.size) n++;
  return n;
}
let closetFilter = newFilterState();
let statsFilter  = newFilterState();
let looksFilter  = newFilterState();
let builderFilter = newFilterState();
let pickerFilter = newFilterState();
// Shared funnel-button + count-badge markup for a picker toolbar (builder, calendar
// +Clothing, capsule add-items). Extracted so new picker surfaces don't copy-paste it.
// Clear every dim of a filter state IN PLACE (the object is shared by reference).
function clearFilterState(state) {
  for (const k of Object.keys(state)) if (state[k] instanceof Set) state[k] = new Set();
  state.q = "";
}
// One-tap clear (A2, 2026-07-18): when a filter is active the funnel grows an
// adjacent ✕ — no sheet visit to clear. onClear = the surface's re-render,
// kept in a registry keyed by button id; one delegated listener in wireEvents.
const _funnelClearFns = {};
function funnelBtnHtml(id, state, onClear) {
  const n = filterActiveCount(state);
  if (onClear) _funnelClearFns[id] = { state, onClear };
  return `<div style="position:relative;display:flex;align-items:center;gap:2px">
    <button class="clsearch" id="${esc(id)}"><svg viewBox="0 0 24 24"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg></button>
    ${n ? `<span class="filter-badge">${n}</span>` : ""}
    ${n && onClear ? `<button class="cb-x" data-funnel-clear="${esc(id)}" title="Clear filters" style="width:24px;height:24px;color:var(--muted)">✕</button>` : ""}
  </div>`;
}
function distinctScalar(field) { return [...new Set(items.map(i => i[field]).filter(Boolean))].sort(); }
// Like distinctScalar but ordered by how often each value occurs (most-used first).
function distinctByFreq(field) {
  const counts = new Map();
  for (const i of items) { const v = i[field]; if (v) counts.set(v, (counts.get(v) || 0) + 1); }
  return [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));
}
function distinctArr(field) { const s = new Set(); items.forEach(i => (i[field] || []).forEach(v => s.add(v))); return [...s].sort(); }

// Retired standalone search screen — logic folded into openFilterSheet + itemMatchesFilter.
function openSearch() {
  openFilterSheet(closetFilter, { onApply: renderCurrentGrid, title: "Filter & sort", dims: CLOSET_FILTER_DIMS, sortable: true });
}

function openFilterSheet(state, { onApply = () => {}, title = "Filter", dims, sortable = false } = {}) {
  const activeDims = dims || FILTERS;
  let openRow = null;

  function renderBody() {
    // Sort lives IN the filter sheet now (2026-07-18) — one place to look on
    // every surface; the old standalone sort popovers are retired.
    const sortRow = sortable ? (() => {
      const cur = gridSortKey();
      return `<div style="margin-bottom:14px">
        <div style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Sort by</div>
        <div class="schips">${SORT_OPTS.map(o =>
          `<button class="schip ${cur === o.key ? "on" : ""}" data-fsort="${o.key}">${esc(o.label)}</button>`).join("")}</div>
      </div>`;
    })() : "";
    const rowSummary = (key) => {
      const set = state[key];
      if (!set || set.size === 0) return "Any";
      if (set.size > 1) return `${set.size} selected`;
      const val = [...set][0];
      if (key === "formality") return `${val}. ${OCCASION_LADDER[+val - 1]}`;
      return val;
    };
    const rows = activeDims.map(([key, label, optsF]) => {
      const open = openRow === key;
      const opts = optsF();
      const chips = open
        ? `<div class="schips">${opts.map(opt => {
            const chipLabel = (key === "formality" && /^\d+$/.test(opt)) ? `${opt}. ${OCCASION_LADDER[+opt - 1]}` : opt;
            return `<button class="schip ${state[key]?.has(opt) ? "on" : ""}" data-chip="${key}|${esc(opt)}">${esc(chipLabel)}</button>`;
          }).join("") || `<span style="color:var(--muted);font-size:13px">None recorded yet</span>`}</div>`
        : "";
      return `<button class="srow" data-row="${key}">
        <span>${label}</span>
        <span class="rt">${esc(rowSummary(key))} ›</span>
      </button>${chips}`;
    }).join("");

    const activeN = filterActiveCount(state);
    $("#filterSheetInner").innerHTML = `
      <div class="schead">
        <button class="lnk" id="fsReset" style="color:var(--danger)">Reset</button>
        <span style="font-weight:600">${esc(title)}</span>
        <button class="lnk" id="fsDone" style="font-weight:700">Done</button>
      </div>
      <div class="sbody">
        ${sortRow}
        <input class="inp" id="fsQuery" placeholder="Keyword search…" value="${esc(state.q || "")}">
        <div class="srows" id="fsRows">${rows}</div>
        ${activeN ? `<div style="text-align:right;margin-top:14px"><button class="lnk" id="fsReset2" style="color:var(--danger)">Reset all</button></div>` : ""}
      </div>`;

    $("#fsQuery").oninput = (e) => { state.q = e.target.value; onApply(); };

    const doReset = () => {
      for (const [key] of activeDims) { if (state[key] instanceof Set) state[key] = new Set(); }
      state.q = "";
      openRow = null;
      onApply();
      renderBody();
    };
    $("#fsReset").onclick = doReset;
    const r2 = $("#fsReset2"); if (r2) r2.onclick = doReset;
    $("#fsDone").onclick = () => { hideSheet("filterSheet"); };
    $("#filterSheetInner").querySelectorAll("[data-fsort]").forEach(b => {
      b.onclick = () => { setGridSort(b.dataset.fsort); onApply(); renderBody(); };
    });

    $("#fsRows").onclick = (e) => {
      const chip = e.target.closest("[data-chip]");
      if (chip) {
        const raw = chip.dataset.chip;
        const sep = raw.indexOf("|");
        const key = raw.slice(0, sep), val = raw.slice(sep + 1);
        if (state[key].has(val)) state[key].delete(val); else state[key].add(val);
        onApply();
        renderBody();
        return;
      }
      const row = e.target.closest("[data-row]");
      if (row) { openRow = openRow === row.dataset.row ? null : row.dataset.row; renderBody(); }
    };
  }

  renderBody();
  $("#filterSheetBg").onclick = () => { hideSheet("filterSheet"); };
  showSheet("filterSheet");
}

