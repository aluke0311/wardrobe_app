/* ===================================================================
   RENDER: CLOSET  (status lens · category → subcategory → grid)
   =================================================================== */
// Status is a cross-cutting LENS, not a category. A tee is always a Top; the lens
// decides which tees you see. "Available" is the default working set.
const LENSES = ["Available", "Storage", "Archive", "All"];
let closetLens = "Available";
let closetCat = null;     // null = root | category name | "Other"
let closetSub = null;     // null = subcategory list | subcategory | "__other__"
let searchResults = null; // null = not in search-results mode; else array of items

/* ---- Closet keyword search (Round C, 2026-07-25) --------------------------
   The standalone Search screen was retired in the filter unification and its
   keyword box went with it — `openSearch()` became a one-line alias for the
   filter sheet, leaving 476 items reachable only by drilling or faceting.
   "The navy linen shirt" is a name lookup, not a filter query.
   Scope is deliberately the whole lens, never the folder you happen to be
   standing in: search means search my closet. The funnel is for narrowing. */
let closetSearchQ = null;   // null = not searching | string (may be empty)
const CLOSET_SEARCH_FIELDS = ["name", "brand", "retailer", "category", "subcategory", "color_family", "size", "notes"];
function itemMatchesText(i, q) {
  const needles = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!needles.length) return true;
  const hay = (CLOSET_SEARCH_FIELDS.map(f => i[f] || "").join(" ") + " " + (i.tags || []).join(" ")).toLowerCase();
  return needles.every(n => hay.includes(n));   // all terms must match, in any field
}
function closetSearchMatches(q) {
  return sortItems(lensItems().filter(i => itemMatchesText(i, q)));
}
let closetHamper = false; // true = full-page hamper contents (its own closet view, like a subcategory)
let closetWorn = false;   // true = full-page "worn since washing, not yet dirty" tray
let closetRack = false;   // true = full-page "the rack" (js/20-rack.js)
let closetMend = false;   // true = full-page "needs mending" tray (Round C)
let detailId = null;      // item id currently shown in detail (null = none)
let detailView = null;    // null = photo view | "details" = details view
let _detailEntryScroll = 0;  // grid scroll position when detail was entered (plain-back restore)
let _fromBuilder = null;  // stashed builder state when an item is opened from the builder
// App-wide "return to where I came from". Item detail always renders into the
// closet screen, so without this, back always lands in the closet. Any non-closet
// entry point captures its origin screen here via openItemFrom(); closetBack()
// invokes it. The builder is the one exception (it needs a full state stash, so it
// keeps _fromBuilder). Cleared by genuine tab navigation.
let _itemReturn = null;
// Same idea for looks: any non-Looks entry point (calendar, stats, capsules)
// captures its origin via openLookFrom(); looksBack() invokes it when leaving
// the look. Cleared by genuine tab navigation.
let _lookReturn = null;
// Prev/next sibling nav overrides (captured in VISUAL order at tap time, so the
// item photo view / look canvas swipe through exactly what was on screen — used
// for surfaces whose order siblingItems()/the looks list can't re-derive, e.g. a
// capsule's grouped grid). null = fall back to the default closet/looks list.
let _itemSiblingIds = null;   // array of item ids | null
let _itemSiblingLabel = null; // e.g. the capsule name, shown in the sib bar
let _lookSiblingIds = null;   // array of outfit ids | null
let _itemSlideDir = null; // "next" | "prev" → slide-in animation for sibling navigation
let _reviewMode = false;  // item detail opened from closet review (closetBack returns to review)
let gridCols = 3;         // items per row (2–5), persisted to localStorage
let lookCols = 2;         // looks per row (2–4), persisted to localStorage (drives --look-cols)
let selectMode = false;   // multi-select active

// ---- sort system (shared across all grid surfaces) ----
// 2026-07-18: the default composite (category > subcategory > color) was
// internally keyed "color" AND labeled inconsistently ("Category" in the
// closet menu, "Color" in picker menus) with no true color sort at all.
// Now: key "category" = the composite, key "colorfam" = real color order.
// gridSortKey() maps legacy stored "color" → "category".
const SORT_OPTS = [
  { key: "category",  label: "Category" },
  { key: "colorfam",  label: "Color" },
  { key: "name",      label: "Name" },
  { key: "newest",    label: "Newest first" },
  { key: "most-worn", label: "Most worn" },
  { key: "least-worn",label: "Least worn" },
  { key: "formality", label: "Formality" },
  { key: "price",     label: "Price" },
];
const SORT_LABELS = Object.fromEntries(SORT_OPTS.map(o => [o.key, o.label]));
let _gridSurface = "closet";
let _gridSortKeys = {};   // surface → sort key; defaults to "color"
function gridSortKey(surface) {
  const k = _gridSortKeys[surface ?? _gridSurface] || "category";
  return k === "color" ? "category" : k;  // legacy stored key for the composite
}
function setGridSort(key) {
  _gridSortKeys[_gridSurface] = key;
  store.setItem(`wardrobe.sort.${_gridSurface}`, key);
}
function sortItems(list, key) {
  const k = key ?? gridSortKey();
  const colorOrder = Object.fromEntries(COLOR_FAMILIES.map((c, i) => [c[0], i]));
  switch (k) {
    case "name":      return [...list].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    case "newest":    return [...list].sort((a, b) => (b.purchase_date || "").localeCompare(a.purchase_date || ""));
    case "most-worn": return [...list].sort((a, b) => wearCount(b.id) - wearCount(a.id));
    case "least-worn":return [...list].sort((a, b) => wearCount(a.id) - wearCount(b.id));
    case "formality": return [...list].sort((a, b) => itemFormality(a) - itemFormality(b));
    case "price":     return [...list].sort((a, b) => (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0));
    case "colorfam":  return [...list].sort((a, b) => {
      // True color sort: family spectrum order first, category grouping within.
      const cd = (colorOrder[a.color_family] ?? 99) - (colorOrder[b.color_family] ?? 99);
      if (cd !== 0) return cd;
      const catD = (CATEGORIES.indexOf(a.category) + 1 || 99) - (CATEGORIES.indexOf(b.category) + 1 || 99);
      return catD !== 0 ? catD : (a.name || "").localeCompare(b.name || "");
    });
    default:          return [...list].sort((a, b) => {
      // Default: category > subcategory > color > name (taxonomy declaration order).
      const catD = (CATEGORIES.indexOf(a.category) + 1 || 99) - (CATEGORIES.indexOf(b.category) + 1 || 99);
      if (catD !== 0) return catD;
      const subs = TAXONOMY[a.category] || [];
      const subD = (subs.indexOf(a.subcategory) + 1 || 99) - (subs.indexOf(b.subcategory) + 1 || 99);
      if (subD !== 0) return subD;
      const cd = (colorOrder[a.color_family] ?? 99) - (colorOrder[b.color_family] ?? 99);
      return cd !== 0 ? cd : (a.name || "").localeCompare(b.name || "");
    });
  }
}
let selectedIds = new Set();
let bulkPending = {};     // bulk edit: field -> pending value
let bulkOpenField = null; // which field row is expanded in bulk edit sheet

let activeCapsuleId = null; // when set, Closet is scoped to this capsule's items

