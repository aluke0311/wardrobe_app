/* ===================================================================
   LOOKS  (outfit library — lens switcher · folders · grid · detail)
   =================================================================== *

   Status of imported data: 1,543 outfits = a date + a set of items, almost no
   name/context/notes. So everything here is DERIVED, not filed by hand:
   - formality: estimated per item (occasion range if set, else a taxonomy
     heuristic), averaged across the outfit, bucketed into 6 coarse folders.
   - season: from the dates the look was worn (multiple seasons => multiple
     folders), falling back to the outfit's own date.
   The user can browse by Formality / Season / Recent / All. Most looks were
   worn once, so this reads as a library where it's useful and a log otherwise. */

const LOOK_LENSES = ["Formulas", "Formality", "Season", "Context", "Capsule", "Liked", "Recent", "All", "Archived"];
const NO_CONTEXT_FOLDER = "__no_context__"; // L8 trailing folder so context-less looks don't disappear
const LOOKS_FLAT_CAP = 400;   // cap for the flat Recent/All grids (perf on phone)

// Formality folders — one per level on the 1-8 scale.
const FORMALITY_BUCKETS = [
  // "home" is NOT a level on the 1-8 ladder — it's derived from the absence of
  // shoes ("no shoes = worn at home", her rule) and supersedes the derived
  // level. A manual formality_override still wins over it.
  { key: "home",     label: "Home"                  },  // no shoes
  { key: "function", label: "Utility"              },  // 1 (stored key stays "function")
  { key: "vcasual",  label: "Very Casual"           },  // 2
  { key: "casual",   label: "Casual"                },  // 3
  { key: "pcasual",  label: "Polished Casual"       },  // 4
  { key: "smart",    label: "Smart Casual"          },  // 5
  { key: "dressy",   label: "Dressed Up"            },  // 6
  { key: "bizpro",   label: "Business Professional" },  // 7
  { key: "formal",   label: "Formal"                },  // 8
];

// Bucket key → target formality level.
const BUCKET_RANGES = {
  home: 2,  // at-home dressing behaves like Very Casual when a level is needed
  function: 1, vcasual: 2, casual: 3, pcasual: 4, smart: 5, dressy: 6, bizpro: 7, formal: 8,
};

// Per-subcategory / category formality SETS (arrays of levels) for imputation.
// Items matching multiple contexts get multiple levels.
const SUBCAT_FORMALITY = {
  "Tee shirts": [2,3], "Graphic tees": [2,3], "Long-sleeve tees": [2,3], "Sleeveless": [3,4],
  "Blouses": [4,5], "Sweaters": [3,4,5], "Cardigans": [3,4,5], "Sweatshirts": [2,3],
  "Jeans": [3,4], "Pants": [4,5,6], "Shorts": [2,3], "Skirts": [3,4,5],
  "Leggings/Joggers": [1,2], "Tights": [3,4],
  "Short": [3,4], "Long": [4,6], "Cocktail": [6],
  "Blazers": [5,6,7], "Jackets": [3,4], "Coats": [3,4,5],
  "Boots": [3,4,5], "Sandals": [2,3,4], "Flats": [3,4,5], "Heels": [6,8], "Sneakers": [2,3],
  "Workout tops": [1], "Active shorts": [1], "Sports bras": [1], "Swimwear": [1],
};
const CAT_FORMALITY = {
  Tops: [2,3], Bottoms: [3,4], Dresses: [4,5], Outerwear: [3,4,5], Shoes: [3,4], Workout: [1],
};

// Vertical stacking order for collages: outerwear/tops up top, bottoms, then shoes.
const LAYER_ORDER = { Outerwear: 0, Tops: 1, Dresses: 1, Workout: 1, Bottoms: 2, Shoes: 3 };

let looksLens = "Formality";
let looksFolder = null;   // null = folder list (Formality/Season) | bucket key | season
let lookId = null;        // outfit id in detail (null = none)
let lookView = "canvas";  // when lookId set: "canvas" | "details" | "wears"
let _lookEntryScroll = 0; // list scroll position when the look was entered (plain-back restore)
let looksSearchQ = null;  // null = not searching | query string (search by piece/context)
let looksItemFilter = null;  // item id → Looks shows only looks containing that piece (from item detail)

// ---- derived helpers ----
function outfitItems(o) { return (outfitItemMap.get(o.id) || []).map(id => itemById.get(id)).filter(Boolean); }
// A look needs 2+ real (still-existing) pieces to show anywhere.
function displayOutfits() { return outfits.filter(o => (outfitItemMap.get(o.id) || []).filter(id => itemById.has(id)).length >= 2); }
// Looks the user hasn't archived (archived ones are hidden from browse/pickers).
// Every ACTIVE look this item is a member of, newest-worn first (archived looks
// stay out of the item's looks list too — user call 2026-07-11).
function outfitsForItem(itemId) {
  return activeOutfits()
    .filter(o => (outfitItemMap.get(o.id) || []).includes(itemId))
    .sort((a, b) => String(outfitLastWorn(b) || "").localeCompare(String(outfitLastWorn(a) || "")));
}
// L9: archived-ness is DERIVED, not just written — a look with any archived
// piece is effectively archived too, with no cascade PATCH and no new column.
// o.archived stays the source of truth for the manual Archive/Unarchive button;
// this only affects what browse/pickers show.
/* DERIVED archived: the flag she set, OR any piece having been archived.
   Memoised per outfit id, because this walks every piece of every look and is
   called from activeOutfits() on every Looks render, every look picker and
   several stats paths — items × looks, the same shape as the
   wearCountInRange-in-a-comparator trap in Known gotchas. The map is rebuilt
   wholesale by buildOutfitIndexes(), so anything that changes an item's status
   or a look's membership already invalidates it. */
let _archMemo = new Map();
const invalidateArchivedCache = () => { _archMemo = new Map(); };
function effectiveArchived(o) {
  if (!o) return false;
  const hit = _archMemo.get(o.id);
  if (hit !== undefined) return hit;
  const v = !!o.archived || outfitItems(o).some(i => itemStatus(i) === "Archive");
  _archMemo.set(o.id, v);
  return v;
}
function activeOutfits() { return displayOutfits().filter(o => !effectiveArchived(o)); }
function archivedOutfits() { return displayOutfits().filter(o => effectiveArchived(o)); }
// Looks pool, scoped to the active capsule when planning: only looks wearable
// entirely from that capsule's items (every piece is a member). Excludes archived.
function looksScopedOutfits() {
  let list = activeOutfits();
  if (activeCapsuleId) {
    const set = new Set((capsuleLinkMap.get(activeCapsuleId) || []).map(l => l.item_id));
    list = list.filter(o => {
      const ids = (outfitItemMap.get(o.id) || []).filter(id => itemById.has(id));
      return ids.length && ids.every(id => set.has(id));
    });
  }
  if (hasActiveFilter(looksFilter)) list = list.filter(o => outfitMatchesFilter(o, looksFilter));
  return list;
}
function outfitName(o) { return o.name || `Look #${o._num || "?"}`; }

// Similar looks (2026-07-15): graduated by piece overlap. Off-by-one relatives
// come first — one piece swapped, added, or removed — each carrying a diff
// label (dedup guarantees no two looks share an identical set, so an exact
// twin never appears). Then higher-overlap looks ranked by Jaccard share, with
// a floor of 2 shared pieces so "same jeans, everything else different" doesn't
// count. Archived looks stay out (Archive lens + calendar only). Returns
// [{o, label, tier}] best-first.
function similarLooks(o, limit = 8) {
  const mine = new Set(outfitItemMap.get(o.id) || []);
  if (!mine.size) return [];
  const nm = id => { const it = itemById.get(id); return it ? (it.name || "piece") : "piece"; };
  const scored = [];
  for (const other of activeOutfits()) {
    if (other.id === o.id) continue;
    const theirs = new Set(outfitItemMap.get(other.id) || []);
    if (!theirs.size) continue;
    let shared = 0;
    for (const id of theirs) if (mine.has(id)) shared++;
    const added = theirs.size - shared;    // pieces they have that I don't
    const removed = mine.size - shared;    // pieces I have that they don't
    const offByOne = added <= 1 && removed <= 1 && (added + removed) >= 1;
    // Off-by-one needs only 1 shared piece (a 2-piece look swapping its top is
    // "same jeans, new top"); broader-overlap matches need 2.
    if (offByOne ? shared < 1 : shared < 2) continue;
    const jaccard = shared / (mine.size + theirs.size - shared);
    let label;
    if (offByOne && added === 1 && removed === 1) {
      const r = [...mine].find(id => !theirs.has(id)), a = [...theirs].find(id => !mine.has(id));
      label = `${nm(r)} → ${nm(a)}`;
    } else if (offByOne && added === 1) label = `+ ${nm([...theirs].find(id => !mine.has(id)))}`;
    else if (offByOne && removed === 1) label = `− ${nm([...mine].find(id => !theirs.has(id)))}`;
    else label = `${shared} shared`;
    scored.push({
      o: other, label,
      tier: offByOne ? 0 : 1,
      // within off-by-one: add/remove (distance 1) before a swap (distance 2)
      dist: added + removed, jaccard,
      liked: other.rating === 1 ? 1 : 0, worn: outfitWornCount(other),
    });
  }
  scored.sort((a, b) =>
    a.tier - b.tier || a.dist - b.dist || b.jaccard - a.jaccard ||
    b.liked - a.liked || b.worn - a.worn);
  return scored.slice(0, limit);
}

function outfitPieces(o) {
  // Photoless pieces stay in — they render as the tee placeholder glyph.
  return outfitItems(o).slice()
    .sort((a, b) => (LAYER_ORDER[a.category] ?? 1.5) - (LAYER_ORDER[b.category] ?? 1.5));
}

const seasonOf = (dateStr) => {
  const m = +String(dateStr).slice(5, 7);
  return (m <= 2 || m === 12) ? "Winter" : m <= 5 ? "Spring" : m <= 8 ? "Summer" : "Fall";
};
function effectiveWearDays(o) {
  const s = outfitWearMap.get(o.id);
  if (s && s.size) return [...s];
  return o.created_at ? [String(o.created_at).slice(0, 10)] : [];
}
function outfitSeasons(o) { return [...new Set(effectiveWearDays(o).map(seasonOf))]; }
// L8: union of contexts across every real wear of this look (no created_at fallback —
// a look with no wear-context data simply has no context folders yet).
// One pass over wears → Map(outfit_id -> Set(contexts)). The Context lens used
// to call a per-outfit wears scan once per outfit PER FOLDER (O(contexts ×
// outfits × wears) ≈ 95M iterations at current data size — seconds of jank);
// build this map once per render instead and read from it.
// item_id → Set(contexts it's been worn in). Cached: the filter predicate is
// called once per item, and rebuilding a 4k-wear pass each time would crawl.
// Invalidated by buildOutfitWearMap (every wear insert/delete) and by the
// context-save paths.
let _itemCtxMap = null;
function invalidateContextCache() { _itemCtxMap = null; }
function itemContextMap() {
  if (_itemCtxMap) return _itemCtxMap;
  const m = new Map();
  for (const w of wears) {
    if (!w.item_id) continue;
    const cs = ctxArr(w);
    if (!cs.length) continue;
    let s = m.get(w.item_id);
    if (!s) { s = new Set(); m.set(w.item_id, s); }
    for (const c of cs) s.add(c);
  }
  _itemCtxMap = m;
  return m;
}
function outfitContextMap() {
  const m = new Map();
  for (const w of wears) {
    if (!w.outfit_id) continue;
    const cs = ctxArr(w);
    if (!cs.length) continue;
    let s = m.get(w.outfit_id);
    if (!s) { s = new Set(); m.set(w.outfit_id, s); }
    for (const c of cs) s.add(c);
  }
  return m;
}
function outfitContexts(o) { return [...(outfitContextMap().get(o.id) || [])]; }  // single-look convenience
// Wear count + last-worn are REAL wears only (no created_at fallback) — a freshly
// built look must read "never worn", not "worn today". (Seasons still use the
// created-date fallback above so unworn looks land in a season folder.)
function outfitWornCount(o) { const s = outfitWearMap.get(o.id); return s ? s.size : 0; }
function outfitLastWorn(o) {
  const s = outfitWearMap.get(o.id);
  if (!s || !s.size) return null;
  let m = null; for (const d of s) if (!m || d > m) m = d; return m;
}
function outfitCost(o) { return outfitItems(o).reduce((s, i) => s + (i.price ? Number(i.price) : 0), 0); }

// Returns the formality SET (array of levels 1-8) for an item.
// Source order: explicit DB field → name keywords → subcategory/category seed → co-occurrence nudge.
function itemFormalitySet(i) {
  if (i.formality) {
    if (Array.isArray(i.formality)) return i.formality.length ? i.formality : null;
    return [+i.formality]; // legacy single-value (pre-migration)
  }
  const seed = SUBCAT_FORMALITY[i.subcategory] ?? CAT_FORMALITY[i.category] ?? [3];
  const set = new Set(seed);
  const name = (i.name || "").toLowerCase();
  if (/\bgown\b|tuxedo|\btux\b/.test(name))                 { set.clear(); set.add(8); }
  else if (/\bheel\b|pumps?\b/.test(name))                  { set.clear(); set.add(6); set.add(8); }
  else if (/blazer/.test(name))                             { [5,6,7].forEach(l => set.add(l)); }
  else if (/cocktail/.test(name))                           { set.clear(); set.add(6); }
  else if (/athletic|workout|gym|running|yoga/.test(name))  { set.clear(); set.add(1); }
  // Co-occurrence nudge: add the most-frequent level of explicitly-tagged co-worn items
  const coLevels = [];
  for (const w of wears) {
    if (w.item_id !== i.id || !w.outfit_id) continue;
    for (const oid of (outfitItemMap.get(w.outfit_id) || [])) {
      if (oid === i.id) continue;
      const other = itemById.get(oid);
      if (!other || !other.formality) continue;
      const s = Array.isArray(other.formality) ? other.formality : [+other.formality];
      s.forEach(l => coLevels.push(l));
    }
  }
  if (coLevels.length >= 3) {
    const freq = {};
    for (const l of coLevels) freq[l] = (freq[l] || 0) + 1;
    const mode = +Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
    if (!set.has(mode)) set.add(mode);
  }
  return [...set].sort((a, b) => a - b);
}

// Single representative level (minimum of set) for display/grouping compatibility.
function itemFormality(i) {
  const s = itemFormalitySet(i);
  return s && s.length ? s[0] : 3;
}

// V3 (2026-07-09): wears.formality_for is DERIVED at log time, never asked.
// Inferred from the pieces worn: the level(s) every piece shares (median of the
// intersection), else the rounded average of each piece's base level. Manual
// correction lives on the look (formality override), not per-wear.
function deriveWearFormality(itemIds) {
  const sets = (itemIds || []).map(id => itemById.get(id)).filter(Boolean)
    .map(i => (itemFormalitySet(i) || []).slice().sort((a, b) => a - b));
  if (!sets.length) return null;
  const shared = [];
  for (let L = 1; L <= 8; L++) if (sets.every(s => s.includes(L))) shared.push(L);
  if (shared.length) return shared[Math.floor((shared.length - 1) / 2)];
  const mins = sets.map(s => (s.length ? s[0] : 3));
  return Math.round(mins.reduce((a, b) => a + b, 0) / mins.length);
}

const currentSeason = () => seasonOf(localISO(new Date()));

// Wearable SEASONS for an item — same derive-first idea as itemFormalitySet.
// Source order: explicit DB field → seasons it's actually been worn in (the
// "when worn" signal) → null = unknown (treated as all-season so a sparse
// wardrobe is never over-filtered). Year-round basics (jeans, plain tees)
// naturally span all four seasons via their wear months and stay eligible.
// Round D: the wear-history branch counts a day as the season it FELT like,
// not the season the calendar says — so pieces worn on warm-weather trips in
// December derive as Summer instead of Winter. `effectiveSeasonOf` is a plain
// lookup for the (overwhelmingly common) home day, and the bands behind it are
// memoized, so this stays cheap enough for the filter loops that call it.
/* The seasons the WEAR HISTORY alone implies, ignoring any explicit tag.
   Split out so EVERY item can be asked what the evidence says, not just the
   untagged ones (her request, 2026-07-25) — that's what lets Closet Review put
   "you set" and "worked out" side by side and reconcile them. Null when the
   piece hasn't been out enough (<3 days) to have an opinion. */
const SEASON_DERIVE_MIN_DAYS = 3;
const SEASON_DERIVE_SHARE = 0.15;
function derivedSeasonSet(i, wearRows = null, log = null, bands = null) {
  const days = [...new Set((wearRows || wears)
    .filter(w => w.item_id === i.id && w.worn_on).map(w => w.worn_on))];
  if (days.length < SEASON_DERIVE_MIN_DAYS) return null;
  const counts = new Map();
  const b = bands || seasonBands(log);
  for (const d of days) { const s = effectiveSeasonOf(d, log, b); counts.set(s, (counts.get(s) || 0) + 1); }
  const keep = [...counts.entries()].filter(([, n]) => n / days.length >= SEASON_DERIVE_SHARE)
    .sort((a, b2) => b2[1] - a[1]).map(([s]) => s);
  // Return in canonical SEASONS order so two derivations are comparable by ===.
  return keep.length ? SEASONS.filter(s => keep.includes(s)) : null;
}

/* ---- WHICH SEASON FUNCTION ANSWERS WHICH QUESTION (2026-07-26, audit H5) ----
   Six related derivations, each correct in isolation, with genuinely different
   meanings for "unknown". Read this before adding a seventh.

     itemSeasonSet(i)      "what seasons is this piece FOR?"  Explicit tag wins;
                           falls back to derivedSeasonSet. THE default reader.
     derivedSeasonSet(i)   "what does its HISTORY say?"  Ignores the explicit tag
                           on purpose — that's what lets a piece be asked what
                           its evidence shows, and what the season flag compares
                           the claim against.
     effectiveSeasonOf(d)  "what season did that DAY feel like?"  An away day
                           counts as the home season its temperature resembles.
     inSeason(i, s)        FILTER predicate for suggestions. ⚠️ unknown = ELIGIBLE.
     matchesSeason(i, s)   FILTER predicate for the funnel. ⚠️ unknown = NO MATCH.
     inSeasonWx(i, s, wx)  inSeason widened by observed temperature. Rescue-only.

   ⚠️ The two filter predicates disagree about unknown, and that is deliberate:
   a suggester that hid every untagged piece would be useless, while a funnel
   that showed them would be lying about what it filtered. Don't "harmonise"
   them — check which question you're asking. */
function itemSeasonSet(i, wearRows = null, log = null, bands = null) {
  if (i.season && i.season.length) return i.season;
  return derivedSeasonSet(i, wearRows, log, bands);
}
// An item is eligible for a season if its set includes it, or its season is unknown.
function inSeason(i, season) {
  if (!season) return true;
  const s = itemSeasonSet(i);
  return !s || s.includes(season);
}

/* Round D. The season filter asks a CALENDAR question, which is the wrong
   question on a trip: a December week in the Caribbean asked for "Winter" and
   filtered the sundress out of the pool before scoring ever saw the 84°
   forecast (the wx term in scoreCombo can only re-rank what survived the
   filter, never rescue it). When a forecast is in hand, a piece whose observed
   temperature band contains that forecast is eligible too.
   RESCUE ONLY — this widens the pool and never narrows it, so an item with no
   temperature profile behaves exactly as it did before. */
const WXA_RESCUE_MARGIN = 5;
function inSeasonWx(i, season, wx) {
  if (inSeason(i, season)) return true;
  if (!wx || wx.maxT == null) return false;
  const p = itemWxProfile(i.id);
  return !!p && wx.maxT >= p.lo - WXA_RESCUE_MARGIN && wx.maxT <= p.hi + WXA_RESCUE_MARGIN;
}

// ---- canonical filter predicates (single source of truth for every surface) ----
// Formality is always a numeric level 1–8; season uses the DERIVED set (explicit
// field → wear-history → null). For a positive filter, unknown season = no match
// (you asked for "summer", an item with no season signal shouldn't qualify), while
// suggestions keep using inSeason() which treats unknown as all-season-eligible.
function matchesFormality(i, level) { return (itemFormalitySet(i) || []).includes(level); }
function matchesSeason(i, season) { const s = itemSeasonSet(i); return !!s && s.includes(season); }

// Universal item filter — checks all active dims in state.
// opts.noStatusDefault: skip the default "empty status = Available only" logic
// (used by Closet where the lens already handles status, and by pickers/report
// cards that manage status themselves). Explicitly picking statuses in the
// funnel brings Storage/Archive back.
function itemMatchesFilter(i, state, opts) {
  const { q="", color, fabric, size, season, brand, status, category, subcategory,
          formality, retailer, acquisition, capsule, context } = state;
  const st = itemStatus(i);
  if (status?.size) { if (!status.has(st)) return false; }
  else if (!opts?.noStatusDefault) { if (st !== "Available") return false; }
  if (q) {
    const hay = [i.name, i.brand, i.notes, i.retailer, i.category, i.subcategory].filter(Boolean).join(" ").toLowerCase();
    if (!hay.includes(q.toLowerCase())) return false;
  }
  if (color?.size    && !color.has(i.color_family)) return false;
  if (size?.size     && !size.has(i.size)) return false;
  if (brand?.size    && !brand.has(i.brand)) return false;
  if (category?.size && !category.has(i.category)) return false;
  if (subcategory?.size && !subcategory.has(i.subcategory)) return false;
  if (retailer?.size && !retailer.has(i.retailer)) return false;
  if (acquisition?.size && !acquisition.has(i.acquisition)) return false;
  if (fabric?.size   && !(i.fabric || []).some(f => fabric.has(f))) return false;
  if (season?.size   && ![...season].some(s => matchesSeason(i, s))) return false;
  if (capsule?.size  && ![...capsule].some(c => capsuleNamesForItem(i.id).includes(c))) return false;
  if (context?.size) {
    const cs = itemContextMap().get(i.id);
    if (!cs || ![...context].some(c => cs.has(c))) return false;
  }
  // "Home" is a look-level bucket, not an item level — ignore it here.
  if (formality?.size) {
    const lv = [...formality].filter(v => v !== "Home");
    if (lv.length && !lv.some(v => matchesFormality(i, +v))) return false;
  }
  return true;
}
// Outfit filter for the Looks surface.
// ALL-pieces semantics: formality, capsule, status (when explicitly set).
// ANY-piece semantics: color, season, brand, fabric, size, retailer, acquisition, category, subcategory.
// No default archive-exclude — outfits may contain archived pieces.
function outfitMatchesFilter(o, state) {
  if (!hasActiveFilter(state)) return true;
  const { q="", color, fabric, size, season, brand, status, category, subcategory,
          formality, retailer, acquisition, capsule, liked, context } = state;
  if (q) {
    const hay = [o.name, o.notes].filter(Boolean).join(" ").toLowerCase();
    if (!hay.includes(q.toLowerCase())) return false;
  }
  if (liked?.size && o.rating !== 1) return false;
  if (context?.size) {
    const cs = outfitContextMap().get(o.id);
    if (!cs || ![...context].some(c => cs.has(c))) return false;
  }
  // Formality: "Home" matches the derived no-shoes bucket; numeric levels keep
  // ALL-pieces semantics. Either satisfies the filter.
  if (formality?.size) {
    const lv = [...formality].filter(v => v !== "Home").map(Number);
    const its0 = outfitItems(o);
    const okHome = formality.has("Home") && outfitBucket(o) === "home";
    const okLvl = lv.length && its0.length && its0.every(i => lv.some(v => matchesFormality(i, v)));
    if (!okHome && !okLvl) return false;
  }
  const its = outfitItems(o);
  if (its.length) {
    if (status?.size  && !its.every(i => status.has(itemStatus(i)))) return false;
    if (capsule?.size && !its.every(i => [...capsule].some(c => capsuleNamesForItem(i.id).includes(c)))) return false;
    if (color?.size   && !its.some(i => color.has(i.color_family))) return false;
    if (season?.size  && !its.some(i => [...season].some(s => matchesSeason(i, s)))) return false;
    if (brand?.size   && !its.some(i => brand.has(i.brand))) return false;
    if (fabric?.size  && !its.some(i => (i.fabric || []).some(f => fabric.has(f)))) return false;
    if (size?.size    && !its.some(i => size.has(i.size))) return false;
    if (retailer?.size && !its.some(i => retailer.has(i.retailer))) return false;
    if (acquisition?.size && !its.some(i => acquisition.has(i.acquisition))) return false;
    if (category?.size && !its.some(i => category.has(i.category))) return false;
    if (subcategory?.size && !its.some(i => subcategory.has(i.subcategory))) return false;
  }
  return true;
}

function outfitBucket(o) {
  if (o._bucket) return o._bucket;
  if (o.formality_override) { o._bucket = o.formality_override; return o._bucket; }
  const its = outfitItems(o);
  // No shoes = worn at home (her rule) — supersedes the derived level.
  if (its.length && !its.some(i => suggestSlot(i) === "Shoes")) { o._bucket = "home"; return "home"; }
  const KEYS = ["function","vcasual","casual","pcasual","smart","dressy","bizpro","formal"];
  const fs = i => itemFormalitySet(i) || [3];   // a piece's formality set (defaults to Casual)
  let level = 3;
  if (its.length) {
    const sets = its.map(i => new Set(fs(i)));
    // Dressiest level every piece can do (set intersection). Mirrors how
    // suggestOutfits judges fit: a look is valid at L iff every piece's set has L.
    // Averaging was wrong — formality isn't a true linear scale.
    let shared = null;
    for (let L = 8; L >= 1; L--) { if (sets.every(s => s.has(L))) { shared = L; break; } }
    // No level shared by all → fall back to the most-casual piece's ceiling:
    // a look is only as dressy as its most casual piece allows.
    level = shared ?? Math.min(...its.map(i => Math.max(...fs(i))));
  }
  const key = KEYS[Math.max(1, Math.min(8, level)) - 1];
  o._bucket = key;
  return key;
}

// G5: glanceable payoff of logging, shown on the item photo view.
function itemStatLine(i) {
  const n = wearCount(i.id);
  if (n === 0) return "never worn";
  const parts = [`worn ${n}×`, `last worn ${relDate(lastWorn(i.id))}`];
  const cpw = costPerWear(i);
  if (cpw != null) parts.push(`${money(cpw)}/wear`);
  return parts.join(" · ");
}

// "★ Workhorse" line under the stat strip when an item is well above its
// subcategory peers (5+ wears and 1.5×+ the expected wear rate).
function workhorseBadgeHtml(i) {
  const p = buildItemPerf(items).get(i.id);
  if (!p || p.count < 5 || p.idx == null || p.idx < 1.5) return "";
  return `<div class="item-stat-strip" style="color:var(--accent);font-weight:600">★ Workhorse · worn ${p.idx.toFixed(1)}× as much as similar pieces</div>`;
}

// Compact duration for wear gaps — days up to ~6 weeks, then months, then years.
const humanGap = (d) => d < 45 ? `${d}d` : d < 365 ? `${Math.round(d / 30)}mo` : `${(d / 365).toFixed(1)}y`;

// "Usually worn with" row for the item details page: top same-day partners,
// each tappable through to that item.
function partnersRowHtml(itemId) {
  const ps = itemPartners(itemId).map(p => ({ ...p, item: itemById.get(p.id) })).filter(p => p.item);
  if (!ps.length) return "";
  const tiles = ps.map(p => `
    <span class="prt-tile" data-partner="${esc(p.id)}">
      <span class="det-piece-thumb${p.item.image_path ? "" : " empty"}" data-photo="${esc(p.item.image_path || "")}"></span>
      <span class="prt-name">${esc(p.item.name || "Untitled")}</span>
      <span class="prt-n">${p.days}×</span>
    </span>`).join("");
  return `<div class="det-divider"></div>
    <div class="det-row" style="align-items:flex-start;flex-direction:column;gap:8px">
      <span class="det-lbl">Usually worn with</span>
      <span class="prt-strip">${tiles}</span>
    </div>`;
}

// Laundry status + one-time-override actions on the item photo view. Hidden for
// never-dirty categories (shoes/outerwear) and non-Available items.
function laundryLineHtml(i) {
  if (!LAUNDRY_READY() || itemStatus(i) !== "Available" || wearTolerance(i) === Infinity) return "";
  const ls = laundryState();
  const dirty = isDirty(i, ls);
  const dd = dirty ? dirtyDays(i) : null;
  const status = dirty
    ? `🧺 In the hamper${dd >= 1 ? ` · ${dd} day${dd === 1 ? "" : "s"}` : ""}`
    : (i.last_washed ? `Washed ${relDate(i.last_washed)}` : "");
  const acts = dirty
    ? `<button class="lnk" data-laun-act="extra" style="font-size:13px">↩︎ One more wear</button>
       <button class="lnk" data-laun-act="washed" style="font-size:13px">✓ Washed</button>
       <button class="lnk" data-laun-date-edit style="font-size:13px">Washed on…</button>`
    : `<button class="lnk" data-laun-act="hamper" style="font-size:13px">🧺 To hamper</button>`;
  // The count she's overriding, visible so the wash-date/tolerance edits below
  // make sense: how many wears since the last wash, out of her tolerance.
  const n = wearDatesSinceWash(i, ls).length, tol = wearTolerance(i);
  const countLine = i.last_washed
    ? `<div style="font-size:12px;color:var(--muted)">${n}/${tol} wears since wash</div>` : "";
  return `<div class="item-stat-strip" style="display:flex;flex-direction:column;align-items:center;gap:5px">
    <div style="display:flex;justify-content:center;align-items:center;gap:14px;flex-wrap:wrap">
      ${status ? (dirty ? `<span>${status}</span>`
        : `<button class="lnk" data-laun-date-edit style="font-size:inherit;color:inherit;font-weight:inherit">${status}</button>`) : ""}${acts}
    </div>
    ${countLine}
    <div style="font-size:12px;color:var(--muted)">Wears per wash: ${tol} <button class="lnk" data-laun-tol-edit style="font-size:12px">✎</button></div>
  </div>`;
}

// One quiet line on the photo view. It has to be reachable in a single tap from
// the piece itself, because the only moment she'll ever tag this is the moment
// the button comes off — there is no world in which she does a mending audit.
/* Pull-in / push-out, on the item photo view.
   Her condition when approving the rack: "ways to both see the rack and work
   outside it" — a piece can be put in play from ANYWHERE she happens to be
   looking at it, not only from the rack screen. Hidden while a capsule scopes
   the closet, where the capsule is the pool and the rack isn't in charge. */
function rackLineHtml(i) {
  if (itemStatus(i) !== "Available" || activeCapsuleId) return "";
  const on = isOnRack(i.id);
  const pinned = rackPinnedSet().has(i.id);
  return on
    ? `<div class="item-stat-strip" style="display:flex;justify-content:center;align-items:center;gap:14px">
        <span style="color:var(--accent)">\u{1F455} On the rack${pinned ? " · kept" : ""}</span>
        <button class="lnk" data-rack-toggle="0" style="font-size:13px;color:var(--muted)">Not right now</button>
      </div>`
    : `<div class="item-stat-strip" style="display:flex;justify-content:center">
        <button class="lnk" data-rack-toggle="1" style="font-size:12px;color:var(--muted)">\u{1F455} Put on the rack</button>
      </div>`;
}

function relDate(d) {
  const ds = daysSince(d);
  if (ds == null) return "";
  if (ds <= 0) return "today";
  if (ds < 30) return `${ds}d ago`;
  if (ds < 365) return `${Math.floor(ds / 30)}mo ago`;
  return `${Math.floor(ds / 365)}y ago`;
}

// ---- collage building ----
// Saved Build-a-look arrangement → positioned-pieces HTML (or null if no usable layout).
// `wrapCls` frames the container; pieces use absolute % geometry so it scales to any size.
function layoutCanvasHtml(o, wrapCls) {
  const lay = (Array.isArray(o && o.layout) ? o.layout : [])
    .filter(p => itemById.has(p.item_id));
  if (!lay.length) return null;
  const cells = lay.map((p, i) => {
    const it = itemById.get(p.item_id);
    return `<div class="ocpiece" data-photo="${esc(it.image_path || "")}" data-canvas-item="${esc(p.item_id)}" style="left:${p.x * 100}%;top:${p.y * 100}%;width:${p.s * 100}%;z-index:${i + 1}"></div>`;
  }).join("");
  return `<div class="${wrapCls}">${cells}</div>`;
}

function outfitCollageHtml(o, max, mini) {
  const canvas = layoutCanvasHtml(o, "ocanvas" + (mini ? " omini" : ""));
  if (canvas) return canvas;
  const pieces = outfitPieces(o).slice(0, max);
  let cls = "ocollage" + (mini ? " omini" : "");
  if (!pieces.length) return `<div class="${cls} empty"><svg viewBox="0 0 24 24"><path d="M16 4l-4 9-4-9"/><path d="M12 13l-9 7h18l-9-7z"/></svg></div>`;
  if (pieces.length === 1) cls += " solo";
  const cells = pieces.map((p, idx) => {
    const span = (pieces.length === 3 && idx === 2) ? " span2" : "";  // wide bottom for 3-piece looks
    return `<div class="opiece${span}" data-photo="${esc(p.image_path || "")}"></div>`;
  }).join("");
  return `<div class="${cls}">${cells}</div>`;
}

// Formality label for a piece: explicit set or estimated set.
function pieceFormalityLabel(it) {
  const s = itemFormalitySet(it) || [3];
  const label = s.map(n => `${n}. ${occLabel(n)}`).join(", ");
  return it.formality ? label : "est. · " + label;
}

function emptyLooks() {
  return `<div class="placeholder">
    <svg class="pi" viewBox="0 0 24 24"><path d="M7 4l5 3 5-3 2 5-3 1v10H8V10L5 9z"/></svg>
    <b>No looks here</b><div>Outfits you build or log will show up here.</div></div>`;
}

// ---- toolbar / lens row ----
// L2: heartId (only meaningful when showShuffle is false, e.g. the look canvas view)
// fills the otherwise-unused right slot with a like toggle instead of an empty span.
function looksToolbar(title, showBack, showShuffle, heartId) {
  const filterN = filterActiveCount(looksFilter);
  _funnelClearFns.looksFilter = { state: looksFilter, onClear: () => { looksSearchQ = null; renderLooks(); } };
  const heartO = heartId ? outfitById.get(heartId) : null;
  const right = showShuffle
    ? `<div style="display:flex;align-items:center;gap:2px">
           <div style="position:relative">
             <button class="clsearch" id="looksGrid" title="Looks per row"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></button>
             <div id="lookGridPop" hidden>
               ${[2, 3, 4].map(n => `<button data-lookcols="${n}" class="${n === lookCols ? "on" : ""}">${n} per row</button>`).join("")}
             </div>
           </div>
           <div style="position:relative">
             <button class="clsearch" id="looksFilter" title="Filter looks"><svg viewBox="0 0 24 24"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg></button>
             ${filterN ? `<span class="filter-badge">${filterN}</span>` : ""}
           </div>
           ${filterN ? `<button class="cb-x" data-funnel-clear="looksFilter" title="Clear filters" style="width:24px;height:24px;color:var(--muted)">✕</button>` : ""}
           <button class="clsearch" id="looksNew" title="Build a look"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
           <button class="clsearch" id="looksShuffle" title="Random look"><svg viewBox="0 0 24 24"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg></button>
         </div>`
    : heartO
    ? `<button class="clsearch lk-heart-btn${heartO.rating === 1 ? " on" : ""}" id="lookHeartBtn" title="Like this look"><svg viewBox="0 0 24 24">${HEART_SVG}</svg></button>`
    : `<span style="width:34px"></span>`;
  // Root drops the duplicated title; drill-in keeps it. See clToolbar.
  return `<div class="cltoolbar${showBack ? "" : " tb-root"}">
    ${showBack
      ? `<button class="clback" id="looksBack"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
         <div class="cltitle">${esc(title)}</div>`
      : ""}
    ${right}
  </div>`;
}
function looksLensHtml() {
  return `<div class="lens">${LOOK_LENSES.map(l =>
    `<button data-llens="${l}" class="${looksLens === l ? "on" : ""}">${l}</button>`).join("")}</div>`;
}

// ---- folder list (Formality / Season) ----
function looksFolderRow(label, count, rep, attrs) {
  const thumb = rep ? outfitCollageHtml(rep, 4, true)
    : `<div class="cthumb empty"><svg viewBox="0 0 24 24"><path d="M5 9l7-5 7 5"/><path d="M5 9c0 2.2 14 2.2 14 0"/></svg></div>`;
  return `<button class="frow" ${attrs}>
    ${thumb}
    <div class="fmeta"><div class="fname">${esc(label)}</div><div class="fcount">${count} look${count === 1 ? "" : "s"}</div></div>
    <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
  </button>`;
}
const repByRecency = (list) =>
  list.slice().sort((a, b) => String(outfitLastWorn(b) || "").localeCompare(String(outfitLastWorn(a) || "")))[0];

/* ---- FORMULAS (Round B, 2026-07-21) ---------------------------------------
   Your recurring outfit SHAPES, discovered rather than declared. Two looks
   share a formula when their pieces fill the same slots with the same
   subcategories — "Sweaters + Jeans + Boots" — whichever specific sweater.
   Pure derivation over WORN looks; nothing stored. The point is the shape you
   keep rebuilding, so a formula must recur across DIFFERENT looks (a single
   much-worn look is just that look, already visible in Most Worn). */
const FORMULA_SLOT_ORDER = ["Dresses", "Tops", "Outerwear", "Bottoms", "Shoes"];
const FORMULA_MIN_WEARS = 6;
const FORMULA_MIN_LOOKS = 2;

// Canonical shape key for a set of items — null when it isn't a real outfit.
function formulaKeyFor(its) {
  const parts = [];
  for (const i of its) {
    const slot = suggestSlot(i);
    if (!slot) continue;                  // bras/swim never define a shape
    parts.push(`${slot}:${i.subcategory || "?"}`);
  }
  if (parts.length < 2) return null;
  const slots = new Set(parts.map(p => p.slice(0, p.indexOf(":"))));
  // Needs a real base: a dress, or a top AND a bottom (same rule as outfitIncomplete).
  if (!slots.has("Dresses") && !(slots.has("Tops") && slots.has("Bottoms"))) return null;
  return parts.sort().join(" + ");
}
// "Tops:Sweaters + Bottoms:Jeans" → "Sweaters + Jeans" (in dressing order).
function formulaLabel(key) {
  return String(key).split(" + ")
    .sort((a, b) => FORMULA_SLOT_ORDER.indexOf(a.slice(0, a.indexOf(":")))
                  - FORMULA_SLOT_ORDER.indexOf(b.slice(0, b.indexOf(":"))))
    .map(p => p.slice(p.indexOf(":") + 1))
    .join(" + ");
}
// slot → Set(subcategories) the shape allows, for the suggester's pool filter.
function formulaShapeMap(key) {
  const m = new Map();
  for (const p of String(key).split(" + ")) {
    const c = p.indexOf(":");
    const slot = p.slice(0, c), sub = p.slice(c + 1);
    let s = m.get(slot); if (!s) { s = new Set(); m.set(slot, s); }
    s.add(sub);
  }
  return m;
}
// Recurring formulas, most-worn first. Pure (takes its pool) for the selftest.
function buildFormulas(pool, { minWears = FORMULA_MIN_WEARS, minLooks = FORMULA_MIN_LOOKS } = {}) {
  const map = new Map();
  for (const o of (pool || [])) {
    const n = outfitWornCount(o);
    if (!n) continue;                     // never worn = not a habit
    const key = formulaKeyFor(outfitItems(o));
    if (!key) continue;
    let e = map.get(key);
    if (!e) { e = { key, label: formulaLabel(key), wears: 0, looks: [] }; map.set(key, e); }
    e.wears += n;
    e.looks.push(o);
  }
  return [...map.values()]
    .filter(e => e.wears >= minWears && e.looks.length >= minLooks)
    .sort((a, b) => b.wears - a.wears || b.looks.length - a.looks.length);
}

// A look "belongs to" a capsule when every one of its pieces is a capsule member.
function outfitFullyInCapsule(o, cid) {
  const members = new Set((capsuleLinkMap.get(cid) || []).map(l => l.item_id));
  if (!members.size) return false;
  const its = outfitItems(o);
  return its.length > 0 && its.every(it => members.has(it.id));
}
function folderRowsHtml(lens) {
  const all = looksScopedOutfits();
  let rows = "";
  if (lens === "Formulas") {
    const fs = buildFormulas(all);
    if (!fs.length) {
      return `<div class="placeholder"><b>No formulas yet</b><div>A formula is a shape you rebuild — same slots, same kinds of pieces, different items. They appear once ${FORMULA_MIN_LOOKS}+ of your looks share one and you've worn it ${FORMULA_MIN_WEARS}+ times.</div></div>`;
    }
    rows += `<div class="snote" style="padding:8px 16px 2px">The shapes you actually rebuild — ${fs.length} of them, most-worn first.</div>`;
    for (const f of fs) {
      rows += looksFolderRow(`${f.label} · ${f.wears} wears`, f.looks.length,
        repByRecency(f.looks), `data-lfolder="${esc(f.key)}"`);
    }
    return rows;
  }
  if (lens === "Formality") {
    for (const b of FORMALITY_BUCKETS) {
      const list = all.filter(o => outfitBucket(o) === b.key);
      if (!list.length) continue;
      rows += looksFolderRow(b.label, list.length, repByRecency(list), `data-lfolder="${b.key}"`);
    }
  } else if (lens === "Capsule") {
    for (const c of capsules) {
      const list = all.filter(o => outfitFullyInCapsule(o, c.id));
      if (!list.length) continue;
      rows += looksFolderRow(c.name, list.length, repByRecency(list), `data-lfolder="${esc(c.id)}"`);
    }
  } else if (lens === "Context") {
    // L8: folders sorted by look-count desc, "No context" trails so nothing disappears.
    const ctxMap = outfitContextMap();
    const byCtx = new Map(), noCtx = [];
    for (const o of all) {
      const cs = ctxMap.get(o.id);
      if (!cs || !cs.size) { noCtx.push(o); continue; }
      for (const c of cs) { let l = byCtx.get(c); if (!l) { l = []; byCtx.set(c, l); } l.push(o); }
    }
    const ctxs = [...byCtx.keys()].sort((a, b) => byCtx.get(b).length - byCtx.get(a).length || a.localeCompare(b));
    for (const c of ctxs) {
      const list = byCtx.get(c);
      rows += looksFolderRow(c, list.length, repByRecency(list), `data-lfolder="${esc(c)}"`);
    }
    if (noCtx.length) rows += looksFolderRow("No context", noCtx.length, repByRecency(noCtx), `data-lfolder="${NO_CONTEXT_FOLDER}"`);
  } else {
    for (const s of SEASONS) {
      const list = all.filter(o => outfitSeasons(o).includes(s));
      if (!list.length) continue;
      rows += looksFolderRow(s, list.length, repByRecency(list), `data-lfolder="${s}"`);
    }
  }
  return rows ? `<div class="frows">${rows}</div>` : emptyLooks();
}
function folderOutfits(lens, folder) {
  const all = looksScopedOutfits();
  const list = lens === "Formulas"
    ? all.filter(o => formulaKeyFor(outfitItems(o)) === folder)
    : lens === "Formality"
    ? all.filter(o => outfitBucket(o) === folder)
    : lens === "Capsule"
    ? all.filter(o => outfitFullyInCapsule(o, folder))
    : lens === "Context"
    ? (() => {
        const ctxMap = outfitContextMap();
        return folder === NO_CONTEXT_FOLDER
          ? all.filter(o => !(ctxMap.get(o.id)?.size))
          : all.filter(o => ctxMap.get(o.id)?.has(folder));
      })()
    : all.filter(o => outfitSeasons(o).includes(folder));
  return list.sort((a, b) => String(outfitLastWorn(b) || "").localeCompare(String(outfitLastWorn(a) || "")));
}
function folderLabel(lens, folder) {
  if (lens === "Formulas") return formulaLabel(folder);
  if (lens === "Formality") return FORMALITY_BUCKETS.find(b => b.key === folder)?.label || folder;
  if (lens === "Capsule") return capsuleById.get(folder)?.name || folder;
  if (lens === "Context") return folder === NO_CONTEXT_FOLDER ? "No context" : folder;
  return folder;
}
function lensOutfitsSorted() {
  const all = looksScopedOutfits();
  // L4b: Liked is a flat folder-less lens (like Recent/All), scoped to o.rating === 1.
  if (looksLens === "Liked") return all.filter(o => o.rating === 1).sort((a, b) => String(outfitLastWorn(b) || "").localeCompare(String(outfitLastWorn(a) || "")));
  if (looksLens === "Recent") return all.slice().sort((a, b) => String(outfitLastWorn(b) || "").localeCompare(String(outfitLastWorn(a) || "")));
  return all.slice().sort((a, b) => (b._num || 0) - (a._num || 0)); // All: newest created first
}

// ---- grid of outfit tiles ----
function outfitGridHtml(list) {
  if (!list.length) return emptyLooks();
  return `<div class="ogrid">${list.map(o => {
    const n = outfitItems(o).length, lw = outfitLastWorn(o), w = outfitWornCount(o);
    return `<button class="otile" data-look="${esc(o.id)}">
      ${outfitCollageHtml(o, 4)}
      ${o.rating === 1 ? `<div class="otile-heart"><svg viewBox="0 0 24 24">${HEART_SVG}</svg></div>` : ""}
      <div class="oname">${esc(outfitName(o))}</div>
      <div class="ometa">${w ? `${w} wear${w === 1 ? "" : "s"}` : "never worn"} · ${n} piece${n === 1 ? "" : "s"}${lw ? " · " + esc(relDate(lw)) : ""}</div>
    </button>`;
  }).join("")}</div>`;
}

// Banner shown across Looks while a capsule scopes the view to wearable looks.
// ---- OUTFIT SUGGESTIONS (Phase 4) ----

function buildExcludeSet() {
  _excludeSet = new Set(exclusions.map(e => [e.item_a, e.item_b].sort().join(":")));
}

// Learn what actually goes together from saved outfits: how often each color pair
// and each item pair has been worn together. Used as a SOFT boost in scoreCombo so
// suggestions lean toward the user's real taste (not hardcoded color rules). Built
// once on load; degrades gracefully when history/color coverage is sparse.
let _colorPairFreq = new Map();
let _itemPairFreq = new Map();
const _pairKey = (a, b) => a < b ? a + "|" + b : b + "|" + a;
function buildSuggestIndexes() {
  _colorPairFreq = new Map();
  _itemPairFreq = new Map();
  for (const o of outfits) {
    const its = outfitItems(o);
    if (its.length < 2) continue;
    const w = o.rating === 1 ? 2 : 1; // L6: liked looks count double toward pair-affinity
    for (let i = 0; i < its.length; i++) {
      for (let j = i + 1; j < its.length; j++) {
        const A = its[i], B = its[j];
        const ik = _pairKey(A.id, B.id);
        _itemPairFreq.set(ik, (_itemPairFreq.get(ik) || 0) + w);
        if (A.color_family && B.color_family && A.color_family !== B.color_family) {
          const ck = _pairKey(A.color_family, B.color_family);
          _colorPairFreq.set(ck, (_colorPairFreq.get(ck) || 0) + w);
        }
      }
    }
  }
}
function isExcluded(a, b) { return _excludeSet.has([a, b].sort().join(":")); }

// Sentinel tags stored in items.tags (no schema change needed).
const NO_SUGGEST_TAG = "no-suggest";
const LAYER_TAG = "layer";  // a top that doubles as a layer (e.g. a button-up over a tee)
// Gear tags (Round A "Tomorrow", 2026-07-20). gear:workout = eligible for the
// suggester's Workout activity mode (run/lift/yoga/bike/hike share one pool).
// gear:rain = weather-conditional: in NORMAL suggestions only when wet.
// Exclusion from normal days comes from formality [1]-only, never from the tag.
const GEAR_WORKOUT_TAG = "gear:workout";
const GEAR_RAIN_TAG = "gear:rain";
// ⚠️ MENDING WAS REMOVED 2026-07-26 r8. Offered 12 analytical/utility features
// to cut, she kept 11 and dropped this one — she was never going to run a repair
// audit. The "mend" tag may STILL EXIST on items in the live DB; it is an unread
// orphan, deliberately not migrated off, so re-adding the feature later would
// find its data intact. Nothing reads it now, so a tagged piece is suggestible
// again — which is the intended consequence of removing the feature.
function isNoSuggest(i) { return !!i && (i.tags || []).includes(NO_SUGGEST_TAG); }
function isLayer(i) { return !!i && (i.tags || []).includes(LAYER_TAG); }
function isWorkoutGear(i) { return !!i && (i.tags || []).includes(GEAR_WORKOUT_TAG); }
function isRainGear(i) { return !!i && (i.tags || []).includes(GEAR_RAIN_TAG); }
async function setItemTag(id, tag, on) {
  const i = itemById.get(id); if (!i) return;
  const tags = (i.tags || []).filter(t => t !== tag);
  if (on) tags.push(tag);
  i.tags = tags;  // optimistic
  try {
    await rest(`/items?id=eq.${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tags }) });
  } catch (e) { toast(e.message); }
}
async function setNoSuggest(id, on) { return setItemTag(id, NO_SUGGEST_TAG, on); }
async function setLayer(id, on) { return setItemTag(id, LAYER_TAG, on); }
async function setWorkoutGear(id, on) { return setItemTag(id, GEAR_WORKOUT_TAG, on); }
async function setRainGear(id, on) { return setItemTag(id, GEAR_RAIN_TAG, on); }

// Slot a piece falls into for suggestions. Cardigans dress like outerwear,
// so they never fill the "shirt" slot. Workout subcats map to real slots for
// activity mode (normal mode excludes the whole category up front); bras and
// swimwear are never suggested (null slot — user decision 2026-07-20).
const WORKOUT_SLOTS = { "Workout tops": "Tops", "Active shorts": "Bottoms", "Sports bras": null, "Swimwear": null };
function suggestSlot(i) {
  if (i.category === "Workout") return WORKOUT_SLOTS[i.subcategory] ?? null;
  return i.subcategory === "Cardigans" ? "Outerwear" : i.category;
}

const NEUTRAL_COLORS = new Set(["White","Gray","Black","Beige","Brown","Metallic"]);

// No "pattern" field exists, so derive it: Graphic tees are always patterned, and
// most prints announce themselves in the item name. Used to avoid pairing two busy
// pieces together (the clash the user keeps hitting).
const PATTERN_RE = /\b(floral|plaid|stripe[ds]?|print(ed)?|graphic|leopard|animal|polka|checker(ed)?|gingham|paisley|tie.?dye|camo(uflage)?|houndstooth|argyle|geometric|patterned|sequin|snake|zebra|cheetah|tartan|tweed)\b/i;
function isPatterned(i) {
  if (!i) return false;
  if (i.subcategory === "Graphic tees") return true;
  return PATTERN_RE.test(i.name || "");
}

// Score a candidate combo of items. Higher = better.
// Combos the user has already been shown this session (key = sorted item ids).
// Lightly downweighted so reshuffles surface fresh outfits. Cleared on reload.
const _suggSeen = new Set();
const comboKey = pieces => pieces.map(p => p.id).sort().join(",");

// V3 weather-aware thresholds (°F) — tune from experience. Real weather, when
// available, overrides the calendar-season layer heuristic in scoreCombo.
const WX_HOT_F = 78;
const WX_COLD_F = 50;
// Any precipitation (drizzle/rain/snow/showers/thunder) per WMO weather codes.
const wmoIsWet = code => code != null &&
  ((code >= 51 && code <= 67) || (code >= 71 && code <= 77) || (code >= 80 && code <= 86) || code >= 95);

function scoreCombo(its, target, season = null, wx = null) {
  let s = 0;
  // dismissal memory: gently penalize combos already shown this session
  if (_suggSeen.has(comboKey(its))) s -= 4;
  if (!target) {
    // reward broader set overlap when no target level (more versatile combos rank higher)
    const sets = its.map(i => new Set(itemFormalitySet(i) || []));
    for (let lvl = 1; lvl <= 8; lvl++) {
      if (sets.every(st => st.has(lvl))) s++;
    }
  }
  // color: penalize 2+ different loud colors in same outfit
  const louds = [...new Set(its.map(i => i.color_family).filter(c => c && !NEUTRAL_COLORS.has(c)))];
  if (louds.length >= 2) s -= 3;
  // color coherence (positive): tonal/neutral palettes and neutral-base-plus-one-accent
  // read as intentional, not just "didn't clash". Single accent over neutrals is the
  // classic rule; an all-neutral or monochrome look is reliably safe.
  const fams = [...new Set(its.map(i => i.color_family).filter(Boolean))];
  if (fams.length >= 2 && louds.length <= 1) s += 1.5;
  if (fams.length === 1 && its.length >= 2) s += 1;
  // pattern: penalize mixing 2+ patterned/printed pieces (busy clash)
  if (its.filter(isPatterned).length >= 2) s -= 3;
  // layer appropriateness: bias WHETHER a layer belongs by weather (preferred) or
  // season + dressiness, instead of treating "+ outerwear" as a coin-flip. A
  // blazer-level piece (set reaches 6) justifies layering even in summer/heat.
  const hasLayer = its.some(i => i.category === "Outerwear" || i.subcategory === "Cardigans")
    || its.filter(i => i.category === "Tops").length >= 2;
  const heavyTop = its.some(i => i.subcategory === "Sweaters" || i.subcategory === "Sweatshirts");
  const dressy = its.some(i => Math.max(...(itemFormalitySet(i) || [3])) >= 6);
  if (wx && wx.maxT != null) {
    // real weather beats the calendar: a 95° September day is a summer day
    if (wx.maxT >= WX_HOT_F) {
      if (hasLayer && !dressy) s -= 3;
      if (heavyTop) s -= 3;
    } else if (wx.maxT <= WX_COLD_F) {
      s += hasLayer ? 2 : -2;
      if (heavyTop) s += 1;
    } else if (heavyTop && its.some(i => i.category === "Outerwear")) {
      s -= 2;  // mild day: don't stack outerwear over a sweater
    }
    // precipitation: closed shoes over open ones (category-level only), and
    // rain gear earns its place (it's pool-gated to wet days in normal mode)
    if (wmoIsWet(wx.code)) {
      if (its.some(i => i.subcategory === "Sandals")) s -= 2;
      if (its.some(i => i.subcategory === "Boots")) s += 1.5;
      if (its.some(isRainGear)) s += 2;
    }
  } else if (season) {
    if (season === "Summer") { if (hasLayer && !dressy) s -= 3; }
    else if (season === "Winter") { s += hasLayer ? 2 : -2; }
    // don't stack heat: outerwear over a sweater/sweatshirt only makes sense in winter
    if (heavyTop && its.some(i => i.category === "Outerwear") && season !== "Winter") s -= 2;
  }
  // learned affinity (soft): nudge toward color pairs + item pairs the user
  // actually wears together, mined from saved outfits. Capped so it stays a
  // nudge — suggestions remain random among things that plausibly match.
  let aff = 0;
  for (let i = 0; i < its.length; i++) {
    for (let j = i + 1; j < its.length; j++) {
      const A = its[i], B = its[j];
      const ip = _itemPairFreq.get(_pairKey(A.id, B.id)) || 0;
      if (ip) aff += Math.min(1.0, 0.4 * Math.log1p(ip));
      if (A.color_family && B.color_family && A.color_family !== B.color_family) {
        const cp = _colorPairFreq.get(_pairKey(A.color_family, B.color_family)) || 0;
        if (cp) aff += Math.min(0.8, 0.3 * Math.log1p(cp));
      }
    }
  }
  s += Math.min(3, aff);
  // C2 session variety salt — see _saltFor (tie-breaker, not a preference).
  s += its.reduce((n, p) => n + _saltFor(p.id), 0);
  // NOTE: no rotation/last-worn weighting by design — suggestions are random
  // among pieces that plausibly match, not biased toward unworn items.
  return s;
}

function suggestOutfits(targetLevel = null, seedItemId = null, capsulePool = null, season = currentSeason(), wx = null, lockedIds = null, cleanOnly = true, lockedRoles = null, shapeKey = null) {
  const base = capsulePool || items.filter(i => itemStatus(i) === "Available");
  let avail = base.filter(i => i.image_path && !isNoSuggest(i));
  /* ⚠️ Level 1 (Utility) IS the function-wear mode — there is no separate
     "activity" mode any more (2026-07-26 r13, her call: "I should just have
     workout formality and that can fix it").
     The old 🏋️ chip pooled by a `gear:workout` TAG, which meant maintaining a
     tag; asking for Utility uses something already on the item. The Workout
     CONTEXT still exists for logging and planning — CONTEXT_FORMALITY_SEED
     already maps it to 1, so a planned Workout day asks for level 1 by itself.
     The Workout CATEGORY is hidden from normal suggestions (it always was) but
     must be visible at level 1, or asking for Utility silently drops the sports
     bras and workout tops. Rain gear stays gated on actual wet weather even at
     level 1 — a rain shell is function-wear, but not for a dry-day run. */
  const utility = targetLevel === 1;
  if (!utility) avail = avail.filter(i => i.category !== "Workout");
  if (!(wx && wmoIsWet(wx.code))) avail = avail.filter(i => !isRainGear(i));
  // Laundry: hamper items sit out. Locked pieces bypass via the pinned-slot path
  // and the seed is unshifted after filtering, so both are exempt by construction.
  // Items dirty LAUNDRY_RESUGGEST_DAYS+ re-enter (badged) so an unanswered
  // laundry prompt can never starve the pool.
  if (cleanOnly) {
    const ls = laundryState();
    avail = avail.filter(i => suggestibleClean(i, ls));
  }
  const seed = seedItemId ? itemById.get(seedItemId) : null;
  // V3 lock-a-piece: locked items pin their slot — every returned combo contains
  // every locked piece (mutually impossible locks, e.g. dress + top, yield none).
  const locked = lockedIds && lockedIds.size ? [...lockedIds].map(id => itemById.get(id)).filter(Boolean) : [];
  // A locked piece remembers the ROLE it was playing when locked: a layerable
  // top locked AS the layer must pin the Outerwear slot, not the Tops slot —
  // otherwise re-rolling turns the locked layer into the base top
  // (2026-07-21, user-reported).
  const roleOf = i => (lockedRoles && lockedRoles.get(i.id)) || suggestSlot(i);
  // Formula mode (Round B): restrict each slot to the shape's subcategories,
  // so "Sweaters + Jeans + Boots" re-fills with DIFFERENT sweaters/jeans/boots.
  const shape = shapeKey ? formulaShapeMap(shapeKey) : null;
  const slot = (...cats) => {
    // Layerable tops (e.g. button-ups, flagged via isLayer) double as the outerwear
    // layer, so they're eligible for the Outerwear slot in addition to the Tops slot.
    const fits = i => cats.includes(suggestSlot(i)) ||
      (cats.includes("Outerwear") && isLayer(i) && i.category === "Tops");
    const lockedHere = locked.filter(i => cats.includes(roleOf(i)));
    if (lockedHere.length) return lockedHere;  // slot is pinned
    let pool = avail.filter(fits);
    // Season filter (soft): keep only in-season pieces, but fall back to the full
    // slot if that would empty it (e.g. a slot with no seasonal coverage yet).
    if (season) {
      const inS = pool.filter(i => inSeasonWx(i, season, wx));
      if (inS.length) pool = inS;
    }
    if (targetLevel) {
      // HARD filter (2026-07-19, user-reported): a "Dressed Up" ask must never
      // silently fall back to casual pieces because the pool (esp. a small
      // capsule) can't cover the level. Fewer/no results + the starvation
      // note beat wrong-level outfits. (Seed/locked stay exempt by
      // construction; the season filter above keeps its soft fallback.)
      // Utility is asked for by level but ANSWERED by isFunctionWear, so gear
      // that she also wears casually (sneakers at [2,3]) still qualifies.
      pool = targetLevel === 1
        ? pool.filter(isFunctionWear)
        : pool.filter(i => (itemFormalitySet(i) || []).includes(targetLevel));
    }
    if (shape) {
      // HARD, like targetLevel: a formula is a shape request. Slots the shape
      // doesn't name (e.g. no layer in "Sweaters + Jeans + Boots") go empty so
      // the generated outfit keeps the shape.
      let subs = cats.map(c => shape.get(c)).find(Boolean);
      // A two-top shape (base + layer) has no Outerwear entry — let the layer
      // slot draw from the shape's tops instead of going empty.
      if (!subs && cats.includes("Outerwear") && (shape.get("Tops") || new Set()).size > 1) subs = shape.get("Tops");
      pool = subs ? pool.filter(i => subs.has(i.subcategory)) : [];
    }
    // Random sample (Fisher–Yates) — no unworn/last-worn bias. A larger sample than
    // before so a single batch mixes more distinct pieces (less "same item every time").
    for (let k = pool.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [pool[k], pool[j]] = [pool[j], pool[k]]; }
    pool = pool.slice(0, 12);
    if (seed && cats.includes(suggestSlot(seed)) && !pool.find(p => p.id === seed.id)) pool.unshift(seed);
    return pool;
  };

  const tops = slot("Tops");
  const dresses = slot("Dresses");
  const bottoms = slot("Bottoms");
  const shoes = slot("Shoes");
  const outerwear = slot("Outerwear");

  const exFree = its => !its.some((a, i) => its.some((b, j) => i < j && isExcluded(a.id, b.id)));
  // Pure-utility items (set = [1] only) must never mix with non-utility items.
  // Uses the SAME isFunctionWear predicate as the level-1 filter above, so the
  // isolation rule can't reject a combo the pool just approved — which is what
  // left a Utility ask with gear it had itself selected and no way to combine it.
  const formalityOk = its => {
    const isPureFunc = p => { const s = itemFormalitySet(p) || []; return s.length === 1 && s[0] === 1; };
    return !its.some(isPureFunc) || its.every(isFunctionWear);
  };

  const combos = [];

  // Dress + shoes + optional outerwear
  for (const d of dresses) {
    for (const sh of shoes) {
      for (const ow of [null, ...outerwear.slice(0, 2)]) {
        const its = [d, sh, ...(ow ? [ow] : [])];
        if (!exFree(its) || !formalityOk(its)) continue;
        combos.push({ pieces: its, score: scoreCombo(its, targetLevel, season, wx) });
      }
    }
  }

  // Top + bottom + shoes + optional outerwear
  for (const t of tops) {
    for (const bt of bottoms) {
      if (isExcluded(t.id, bt.id)) continue;
      for (const sh of shoes.slice(0, 6)) {
        const its3 = [t, bt, sh];
        if (!exFree(its3) || !formalityOk(its3)) continue;
        combos.push({ pieces: its3, score: scoreCombo(its3, targetLevel, season, wx) });
        for (const ow of outerwear.slice(0, 2)) {
          if (ow.id === t.id) continue;  // a layerable top can't be its own layer
          // Two layerable tops stacked (button-up over button-up) reads wrong —
          // a top-as-layer only goes over a non-layerable base (2026-07-19).
          if (ow.category === "Tops" && isLayer(t)) continue;
          const its4 = [t, bt, sh, ow];
          if (exFree(its4) && formalityOk(its4)) combos.push({ pieces: its4, score: scoreCombo(its4, targetLevel, season, wx) });
        }
      }
    }
  }

  // Locked pieces must appear in EVERY combo (kills e.g. dress combos when a top
  // is locked, and layer-less variants when outerwear is locked).
  let pool2 = locked.length
    ? combos.filter(c => locked.every(l => c.pieces.some(p => p.id === l.id)))
    : combos;

  pool2.sort((a, b) => {
    // seed item always comes first
    if (seedItemId) {
      const ha = a.pieces.some(p => p.id === seedItemId) ? 1 : 0;
      const hb = b.pieces.some(p => p.id === seedItemId) ? 1 : 0;
      if (ha !== hb) return hb - ha;
    }
    return b.score - a.score;
  });

  // deduplicate: don't show the same set of item_ids twice
  const seen = new Set();
  const unique = [];
  for (const c of pool2) {
    const key = c.pieces.map(p => p.id).sort().join(",");
    if (!seen.has(key)) { seen.add(key); unique.push(c); }
    if (unique.length >= 60) break;
  }

  // Weighted-random sample (softmax) so results vary each call while still
  // respecting the (small) match score. High temperature → mostly random among
  // things that plausibly go together, which is what we want here.
  if (unique.length > 1) {
    const t = 0.8;
    const scores = unique.map(c => c.score);
    const minS = Math.min(...scores);
    const maxS = Math.max(...scores);
    const norm = maxS > minS ? scores.map(s => (s - minS) / (maxS - minS)) : scores.map(() => 1);
    const baseW = norm.map(s => Math.exp(s / t));
    // Weighted sample without replacement, with a HARD per-item cap so no single
    // piece dominates the batch (the "same two items in the whole set" bug). The
    // seed is exempt — it's meant to appear in every result. A first pass honors
    // the cap; a second pass tops up to 8 if the cap left us short.
    const MAX_PER_ITEM = 2;
    const picked = [];
    const used = new Array(unique.length).fill(false);
    const itemUse = new Map();
    // Seed + locked pieces appear in every combo by design — keep them out of the
    // per-item usage accounting so they don't trip the cap or the overlap decay.
    const pinnedIds = new Set(locked.map(l => l.id));
    if (seedItemId) pinnedIds.add(seedItemId);
    const seedOk = c => seedItemId && c.pieces.some(p => p.id === seedItemId);
    const fill = (cap) => {
      while (picked.length < 8) {
        const eff = new Array(unique.length).fill(0);
        let tot = 0;
        for (let k = 0; k < unique.length; k++) {
          if (used[k]) continue;
          const c = unique[k];
          if (cap && !seedOk(c) && c.pieces.some(p => !pinnedIds.has(p.id) && (itemUse.get(p.id) || 0) >= MAX_PER_ITEM)) continue;
          const overlap = c.pieces.reduce((n, p) => n + (!pinnedIds.has(p.id) && itemUse.get(p.id) ? 1 : 0), 0);
          const w = baseW[k] * Math.pow(0.35, overlap);
          eff[k] = w; tot += w;
        }
        if (tot <= 0) break;
        let r = Math.random() * tot, cumul = 0, pick = -1;
        for (let k = 0; k < unique.length; k++) { if (!eff[k]) continue; cumul += eff[k]; if (r < cumul) { pick = k; break; } }
        if (pick < 0) break;
        used[pick] = true;
        picked.push(unique[pick]);
        unique[pick].pieces.forEach(p => { if (!pinnedIds.has(p.id)) itemUse.set(p.id, (itemUse.get(p.id) || 0) + 1); });
      }
    };
    fill(true);
    fill(false);
    return picked;
  }
  return unique.slice(0, 8);
}

// Build a simple layout array for the suggestion canvas preview
function suggestionLayout(pieces) {
  // Left slot = base top, right slot = its layer (per user convention). The layer
  // is detected the same way the swap chips are (layerPieceOf), so a layerable top
  // used as a layer also lands on the right rather than beside the base top.
  const layer = layerPieceOf(pieces);
  const rank = (it) => {
    if (layer && it.id === layer.id) return 1.5;          // layer → just right of the top
    switch (it.category) {
      case "Tops": case "Dresses": return 1;              // base top/dress → left
      case "Workout": return 1.2;
      case "Outerwear": return 1.5;                        // (undetected layer, keep right)
      case "Bottoms": return 3;
      case "Shoes": return 4;
      default: return 2;
    }
  };
  const sorted = pieces.slice().sort((a, b) => rank(a) - rank(b));
  const grids = [
    [[.5,.5,.75]],
    [[.3,.5,.45],[.72,.5,.45]],
    [[.5,.28,.55],[.28,.72,.42],[.72,.72,.42]],
    [[.28,.28,.44],[.72,.28,.44],[.28,.72,.44],[.72,.72,.44]],
  ];
  const pos = grids[Math.min(sorted.length - 1, 3)];
  return sorted.map((it, i) => ({ item_id: it.id, x: pos[i][0], y: pos[i][1], s: pos[i][2] }));
}

// Suggestion sheet state. wx = today's (or the plan day's) weather; useWx toggles
// the weather chip; locked = item ids pinned across "New suggestions" (V3).
let _sugg = { results: [], idx: 0, targetLevel: null, seedItemId: null, capsuleId: null, season: currentSeason(), planCtx: null, activeContext: null, wx: null, useWx: true, useClean: true, locked: new Set(), lockedRoles: new Map(), shapeKey: null, wholeCloset: false };
const _suggWx = () => (_sugg.useWx ? _sugg.wx : null);
const _suggClean = () => _sugg.useClean !== false;
let _suggSlideDir = null;  // "next" | "prev" → slide-in animation on the next render

// C1: context chips on the suggestion sheet. Seed values (tweak here) for when a
// context has under 3 formality_for-tagged wears to trust an empirical read.
const CONTEXT_FORMALITY_SEED = {
  "Work": 5, "Symphony": 4, "Chorus Concert": 6, "Date Night": 4, "Friends": 2,
  "Rehearsal": 2, "Party/Shower": 4, "Wedding": 6, "Funeral": 4, "Errands": 2,
  "Travel": 3, "Workout": 1,
};
function topContextsByWearCount(limit = 6) {
  const counts = countByDay(wears, ctxArr);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([c]) => c);
}
// Most common formality_for level among this context's wears (min 3 to trust);
// falls back to the seed constant above.
function contextFormalityLevel(context, wearRows = null) {
  const levels = (wearRows || wears).filter(w => ctxArr(w).includes(context) && w.formality_for).map(w => w.formality_for);
  if (levels.length >= 3) {
    const freq = {};
    for (const l of levels) freq[l] = (freq[l] || 0) + 1;
    return +Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
  }
  return CONTEXT_FORMALITY_SEED[context] || null;
}

function openSuggestSheet(seedItemId = null, capsuleId = null, planCtx = null, shapeKey = null) {
  // Trip/capsule mode: every suggest entry point defaults to the suitcase pool
  // unless the caller scoped it explicitly.
  if (!capsuleId && tripModeId && capsuleById.get(tripModeId)) capsuleId = tripModeId;
  _sugg.seedItemId = seedItemId;
  _sugg.capsuleId = capsuleId;
  _sugg.planCtx = planCtx || null;
  // kv day-plan entries can pre-seed a level (from their contexts' usual
  // formality) or activity mode (a Workout-context entry).
  _sugg.targetLevel = (planCtx && planCtx.level) || null;
  _sugg.activeContext = null;
  _sugg.season = planCtx ? seasonOf(planCtxSeasonDate(planCtx)) : currentSeason();
  _sugg.idx = 0;
  _sugg.locked = new Set();
  _sugg.lockedRoles = new Map(); // id → pinned slot when it differs from suggestSlot
  _sugg.shapeKey = shapeKey || null;  // Round B: fill a formula's shape
  _sugg.tmPick = null;                // set only by openTomorrowRevise
  _sugg.varyFrom = null;              // set only by openVaryLook
  // Default pool is THE RACK (2026-07-26). Her four conditions when she approved
  // the narrowing: the rack is always a visible screen, the suggester always
  // names its pool with a count and a one-tap widen, pull-in works from
  // anywhere, and locking a non-rack piece never fails. This flag is the widen;
  // it is session-only and resets every open, so the app never quietly stays
  // narrowed OR quietly stays wide.
  _sugg.wholeCloset = false;
  _sugg.banned = new Set();      // "not this" — session-only, reset every open
  _suggSessionSalt = new Map();  // fresh variety lean every open
  _sugg.useWx = true;
  _sugg.useClean = true;

  // Weather: plan days use the trip's per-day forecast; otherwise home weather
  // (cached per day). If it isn't in memory yet, fetch and fold it in once.
  _sugg.wx = planCtx
    ? (_planWx[planCtx.date] || null)
    : (_homeWx.date === todayStr() ? _homeWx.wx : null);
  _sugg.results = suggestOutfits(_sugg.targetLevel, seedItemId, _suggPool(), _sugg.season, _suggWx(), null, _suggClean(), null, _sugg.shapeKey);
  renderSuggestSheet();
  showSheet("logSheet");
  if (!planCtx && !_sugg.wx) loadHomeWeather().then(wx => {
    // Only apply if the suggestion sheet is still the one showing (#sgClose is ours)
    if (!wx || _sugg.planCtx || $("#logSheet").hidden || !$("#sgClose")) return;
    _sugg.wx = wx;
    // Untouched sheet → regenerate with weather; otherwise just show the chip
    if (_sugg.idx === 0 && !_sugg.locked.size) {
      _sugg.results = suggestOutfits(_sugg.targetLevel, _sugg.seedItemId, _suggPool(), _sugg.season, _suggWx(), null, _suggClean(), null, _sugg.shapeKey);
    }
    renderSuggestSheet();
  });
}

// Effective suggestion pool: capsule members or the whole Available closet,
// minus any session-banned pieces ("not this", 2026-07-18). Always returns a
// real array now (the engine treats it as capsulePool either way).
/* The pool BEFORE activity/gear filtering. Shared with suggestStarvationNote so
   the note can never describe a different pool than the one that was searched.

   Precedence, in order:
   1. A capsule/trip scope wins outright (audit M2) — during a trip the SUITCASE
      is the rack. They never compose; intersecting them could leave four items.
   2. ⚠️ WORKOUT NEVER USES THE RACK (2026-07-26 r12, user-reported the day the
      rack shipped: "if i want to go on a run, that doesn't build"). buildRack
      excludes the Workout category on purpose — her words, "those clothes don't
      really mix with the rest of my clothing" — so filtering the rack by
      isWorkoutGear was guaranteed to return NOTHING. Gear is its own pool drawn
      from the whole closet. There is deliberately no second "workout rack": a
      rack exists to shrink 476 pieces to ~46, and the gear set is already small,
      so one would add a concept and shrink nothing. Revisit only if generating a
      workout outfit ever starts to feel like a slot machine.
   3. Otherwise the rack, unless she's widened it. */
function _suggBasePool() {
  if (_sugg.capsuleId) return capsuleItems(_sugg.capsuleId).filter(i => itemStatus(i) === "Available");
  if (_sugg.targetLevel === 1 || _sugg.wholeCloset) return items.filter(i => itemStatus(i) === "Available");
  return rackItems();
}
function _suggPool() {
  let pool = _suggBasePool();
  if (_sugg.banned && _sugg.banned.size) pool = pool.filter(i => !_sugg.banned.has(i.id));
  // Mirrors the engine so swap/+Layer/ban candidates see the same pool.
  // At Utility the pool IS function-wear (see isFunctionWear); at every other
  // level the Workout category stays hidden as it always has.
  if (_sugg.targetLevel === 1) pool = pool.filter(isFunctionWear);
  else pool = pool.filter(i => i.category !== "Workout");
  const wx = _suggWx();
  if (!(wx && wmoIsWet(wx.code))) pool = pool.filter(i => !isRainGear(i));
  return pool;
}

// C2 variety seeding (2026-07-18): a per-sheet-open random salt per item,
// added to combo scores — big enough to break ties so consecutive sessions
// lean into different corners of the closet, far too small to override real
// affinity/weather/formality signals.
const SUGGEST_SALT = 0.35;
let _suggSessionSalt = new Map();
function _saltFor(id) {
  let v = _suggSessionSalt.get(id);
  if (v == null) { v = Math.random() * SUGGEST_SALT; _suggSessionSalt.set(id, v); }
  return v;
}

// C3 (2026-07-18): when the batch comes back short, say WHICH filter is
// hiding the most — keeps trust in the engine instead of "it's broken".
/* The pool label. Non-negotiable: she approved the rack narrowing the suggester
   ONLY on condition that the narrowing is always named, counted and reversible
   in one tap. An unlabelled smaller pool is the invisible-filter mistake that
   burned her in December (a warm-weather trip filtered the sundress out before
   scoring could see the 84° forecast). Not shown in capsule/trip mode, where
   the capsule label above already names the pool. */
/* Round B left "formula chip in the suggester itself" explicitly unfinished, and
   it's the closest thing in the app to the mornings she actually described:
   "(b) I have a rough idea already — the black pants, probably — and I want to
   see whether there's a better version of that idea." A formula IS that rough
   idea, in her own history's words.
   Memoised on outfit-count + wear-count: buildFormulas walks every outfit and
   this renders on every keystroke-ish interaction in the sheet. */
let _formulaChipMemo = null;
function topFormulas(limit = 3) {
  const stamp = `${outfits.length}|${wears.length}`;
  if (_formulaChipMemo && _formulaChipMemo.stamp === stamp) return _formulaChipMemo.list.slice(0, limit);
  const list = buildFormulas(activeOutfits());
  _formulaChipMemo = { stamp, list };
  return list.slice(0, limit);
}
function suggestShapeChipsHtml() {
  // Not in activity mode (the gear tag is the cohesion) and not while varying a
  // specific look — both already answer "what shape?" in a stronger way.
  if (_sugg.targetLevel === 1 || _sugg.varyFrom) return "";
  const tops = topFormulas(3);
  if (!tops.length) return "";
  return `<div style="padding:2px 16px 0">
    <div style="font-size:12px;color:var(--muted);margin-bottom:6px">Your usual shapes</div>
    <div class="cap-catbar" style="flex-wrap:wrap;gap:6px">
      ${tops.map(f => `<button class="cap-chip${_sugg.shapeKey === f.key ? " on" : ""}" data-sshape="${esc(f.key)}" style="font-size:13px">${esc(f.label)}</button>`).join("")}
    </div>
  </div>`;
}

function suggestPoolChipHtml() {
  if (_sugg.capsuleId) return "";
  if (_sugg.targetLevel === 1) {
    // Named, but not a button: Utility already draws from the whole closet, so
    // there is nothing to widen to. The naming rule still applies.
    const n = items.filter(i => itemStatus(i) === "Available" && (itemFormalitySet(i) || []).includes(1)).length;
    return `<span class="cap-chip" style="font-size:13px;opacity:.7">\u{1F3CB} Utility \u00b7 ${n} pieces, whole closet</span>`;
  }
  const rackN = rackItems().length;
  const allN = items.filter(i => itemStatus(i) === "Available").length;
  return _sugg.wholeCloset
    ? `<button class="cap-chip" data-spool style="font-size:13px" title="Back to the rack">Whole closet · ${allN} \u2192 rack</button>`
    : `<button class="cap-chip on" data-spool style="font-size:13px" title="Widen to the whole closet">\u{1F455} Rack · ${rackN} \u2192 all ${allN}</button>`;
}

function suggestStarvationNote() {
  if (!_sugg.results || _sugg.results.length >= 8) return "";
  const base = _suggBasePool();
  const eligible = base.filter(i => i.image_path && !isNoSuggest(i));
  const bits = [];
  if (_suggClean() && LAUNDRY_READY()) {
    const ls = laundryState();
    const hidden = eligible.filter(i => !suggestibleClean(i, ls)).length;
    if (hidden) bits.push(`🧺 clean-only is hiding ${hidden}`);
  }
  if (_sugg.targetLevel) {
    const off = eligible.filter(i => !(itemFormalitySet(i) || []).includes(_sugg.targetLevel)).length;
    if (off) bits.push(`${off} don't cover ${occLabel(_sugg.targetLevel)}`);
  }
  if (_sugg.banned && _sugg.banned.size) bits.push(`${_sugg.banned.size} set aside`);
  if (_sugg.capsuleId) bits.push(`pool is ${eligible.length} pieces`);
  // A thin RACK must say so and point at the way out, or an empty sheet reads as
  // "the app is broken" rather than "this pool is small".
  if (!_sugg.capsuleId && !_sugg.wholeCloset && _sugg.targetLevel !== 1) bits.push(`the rack is ${eligible.length} pieces \u2014 tap it above to use the whole closet`);
  if (!bits.length) return "";
  return `<div class="center muted" style="font-size:12px;padding:4px 12px 0">Pool is tight — ${esc(bits.join(" · "))}</div>`;
}

// Zero-state door (2026-07-19): a level-starved CAPSULE isn't a dead end —
// show the closet pieces that would cover the level, addable in one tap.
function suggestLevelDoorHtml() {
  if (!_sugg.capsuleId || !_sugg.targetLevel || (_sugg.results && _sugg.results.length)) return "";
  const members = new Set((capsuleLinkMap.get(_sugg.capsuleId) || []).map(l => l.item_id));
  const cands = items.filter(i => itemStatus(i) === "Available" && !members.has(i.id)
    && i.image_path && !isNoSuggest(i)
    && (itemFormalitySet(i) || []).includes(_sugg.targetLevel)).slice(0, 8);
  if (!cands.length) return "";
  return `<div style="padding:12px 16px 0">
    <div class="center muted" style="font-size:12.5px;margin-bottom:8px">These closet pieces cover ${esc(occLabel(_sugg.targetLevel))} — add to the suitcase?</div>
    <div class="wa-strip" style="padding:0">${cands.map(i => `<div class="wa-tile" style="width:72px">
      <button data-sgdoor-open="${esc(i.id)}" style="display:block;width:100%">${thumbHtml(i.image_path)}</button>
      <div class="wa-name">${esc(i.name || "Untitled")}</div>
      <button class="cap-chip" data-sgdoor-add="${esc(i.id)}" style="width:100%;font-size:11px;justify-content:center;margin-top:2px">＋ Add</button>
    </div>`).join("")}</div>
  </div>`;
}

// Zero-state door for activity mode (Round A): an untagged closet isn't a dead
// end — offer the one-time gear-tagging pass right where the emptiness shows.
/* Zero-state for Utility. Since r13 the ask is a formality level, not a tag, so
   the door sets formality rather than tagging: openGearTagSheet's "Gear-only"
   toggle writes formality [1], which is now exactly the thing being asked for. */
function suggestGearDoorHtml() {
  if (_sugg.targetLevel !== 1 || (_sugg.results && _sugg.results.length)) return "";
  return `<div class="center" style="padding:8px 0">
    <div class="center muted" style="font-size:12.5px;margin-bottom:8px">Utility outfits come from pieces set to Utility (level 1).</div>
    <button class="btn btn-sec" data-sggear>🏋️ Mark your workout pieces</button>
  </div>`;
}

// Gear-only = formality becomes Utility-only ([1]) so the existing isolation
// rule keeps the item off normal days. Toggling off clears to null (imputed).
async function setGearOnlyFormality(id, on) {
  const i = itemById.get(id); if (!i) return;
  i.formality = on ? [1] : null;  // optimistic
  outfits.forEach(o => { o._bucket = null; });  // looks re-derive their bucket
  try {
    await rest(`/items?id=eq.${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ formality: i.formality }) });
  } catch (e) { toast(e.message); }
}
/* Is this piece function-wear? Three independent, honest ways to say yes, any
   of which is enough (2026-07-26 r13):
     · its formality set contains 1 (Utility) — she said so directly
     · it's in the Workout category — that's what the category means
     · it carries the gear tag — for pieces filed elsewhere, i.e. running shoes
   ⚠️ The third is what makes a real trip work. Running shoes are usually
   subcategory Sneakers with formality [2,3] because she also wears them
   casually; requiring level 1 on EVERY piece dropped them and left a Utility
   ask with no shoes and therefore no outfit — the reported bug ("not enough
   items in capsule to suggest an outfit" with workout clothes in the trip).
   This WIDENS the level-1 pool and never narrows any other level, the same
   rescue-only shape as inSeasonWx. */
function isFunctionWear(i) {
  if (!i) return false;
  if ((itemFormalitySet(i) || []).includes(1)) return true;
  return i.category === "Workout" || isWorkoutGear(i);
}
const isGearOnly = i => !!i && Array.isArray(i.formality) && i.formality.length === 1 && i.formality[0] === 1;

// One-time(ish) gear-tagging pass, rendered into the open suggestion sheet.
// Candidates: the whole Workout category + the subcats gear hides in, plus
// anything already tagged (so un-tagging is always possible here too).
const GEAR_CAND_SUBCATS = new Set(["Sneakers", "Boots", "Jackets", "Coats", "Leggings/Joggers", "Sweatshirts"]);
function openGearTagSheet() {
  const cands = items.filter(i => itemStatus(i) === "Available" &&
      (i.category === "Workout" || GEAR_CAND_SUBCATS.has(i.subcategory) || isWorkoutGear(i) || isRainGear(i)))
    .sort((a, b) => `${a.category}|${a.subcategory}|${a.name || ""}`.localeCompare(`${b.category}|${b.subcategory}|${b.name || ""}`));
  const rows = cands.map(i => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)">
      <div style="width:44px;height:44px;flex:none">${thumbHtml(i.image_path)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i.name || "Untitled")}</div>
        <div style="font-size:11px;color:var(--muted)">${esc(i.subcategory || i.category)}</div>
      </div>
      <button class="cap-chip${isWorkoutGear(i) ? " on" : ""}" data-gw="${esc(i.id)}" style="font-size:12px" title="Workout gear">🏋️</button>
      <button class="cap-chip${isRainGear(i) ? " on" : ""}" data-gr="${esc(i.id)}" style="font-size:12px" title="Rain gear">🌧</button>
      <button class="cap-chip${isGearOnly(i) ? " on" : ""}" data-go="${esc(i.id)}" style="font-size:11px" title="Sets formality to Utility-only — never suggested for normal days">Gear-only</button>
    </div>`).join("");
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="gearDone">Done</button>
      <h2>Tag your gear</h2>
      <div style="width:48px"></div>
    </div>
    <div style="padding:0 16px 8px;font-size:12px;color:var(--muted);line-height:1.5">🏋️ suggests it for workouts · 🌧 only on wet days · <b>Gear-only</b> keeps it OFF normal days (formality → Utility)</div>
    <div style="padding:0 16px 16px;max-height:60vh;overflow-y:auto">${rows || `<div class="center muted" style="padding:24px 0">Nothing to tag</div>`}</div>`;
  hydratePhotos($("#logInner"));
  $("#gearDone").onclick = () => {
    _sugg.idx = 0;
    _sugg.results = suggestOutfits(_sugg.targetLevel, _sugg.seedItemId, _suggPool(), _sugg.season, _suggWx(), _sugg.locked, _suggClean(), _sugg.lockedRoles, _sugg.shapeKey);
    renderSuggestSheet();
  };
  const flip = (b, on) => b.classList.toggle("on", on);
  $("#logInner").querySelectorAll("[data-gw]").forEach(b => b.onclick = () => {
    const i = itemById.get(b.dataset.gw); const next = !isWorkoutGear(i);
    flip(b, next); setWorkoutGear(i.id, next);
  });
  $("#logInner").querySelectorAll("[data-gr]").forEach(b => b.onclick = () => {
    const i = itemById.get(b.dataset.gr); const next = !isRainGear(i);
    flip(b, next); setRainGear(i.id, next);
  });
  $("#logInner").querySelectorAll("[data-go]").forEach(b => b.onclick = () => {
    const i = itemById.get(b.dataset.go); const next = !isGearOnly(i);
    flip(b, next); setGearOnlyFormality(i.id, next);
  });
}

// Friendly slot name for the swap chips.
function suggSlotLabel(i) {
  const slot = suggestSlot(i);
  if (slot === "Outerwear") return "Layer";
  return ({ Tops: "Top", Bottoms: "Bottom", Dresses: "Dress", Shoes: "Shoes" })[slot] || slot;
}

// Swap just ONE piece of the current suggestion, keeping the rest — a targeted
// re-roll instead of re-rolling the whole outfit. Same filters the engine uses:
// slot, season, exclusions, target level, and pure-function isolation.
/* "Vary this" (2026-07-26) — her own request: "I often will change just one piece
   of an outfit in a day."
   Deliberately NOT a re-roll. Her words when asked: "I will always know the change
   I want to make", so the app must not guess which piece; it puts the real outfit
   on screen and lets her point at the one to replace. That is exactly what the
   per-piece ✨ already does — it re-rolls one slot and holds everything else — so
   this is an entry point, not an engine.
   Pieces are NOT locked: 🔒 disables the per-piece swap, which is the whole
   feature. Reshuffle is a separate, deliberate tap.
   Wearing the result routes through the normal saveComboAsOutfit dedup, so a
   variation either becomes its own look or merges into the identical one that
   already exists — which is also how "Tuesday's outfit with different shoes"
   finally becomes recordable, and what buildFormulas feeds on. */
function openVaryLook(outfitId) {
  const o = outfitById.get(outfitId);
  if (!o) return;
  const pieces = outfitItems(o).filter(i => i && itemStatus(i) !== "Archive");
  if (pieces.length < 2) return toast("Not enough pieces to vary");
  openSuggestSheet();
  _sugg.varyFrom = outfitId;
  // Varying works from a specific saved outfit, not from "what's in play", so the
  // swap pool is the whole closet by default — a rack-only swap could refuse the
  // obvious replacement for a piece that isn't currently in rotation. The pool
  // chip still shows, so she can narrow it back.
  _sugg.wholeCloset = true;
  const k = comboKey(pieces);
  _sugg.results = [{ pieces, score: 0 }, ..._sugg.results.filter(c => comboKey(c.pieces) !== k)];
  _sugg.idx = 0;
  renderSuggestSheet();
}

function swapSuggestionPiece(pieceId) {
  const combo = _sugg.results[_sugg.idx];
  if (!combo) return;
  const old = itemById.get(pieceId);
  if (!old) return;
  // A layerable top (isLayer) doubling as this combo's layer must re-roll from the
  // LAYER pool, not the whole Tops pool — otherwise swapping it drops in a plain tee
  // and the "layer" slot silently becomes a second top.
  const layerPc = comboLayerPiece(combo);
  const asLayer = !!layerPc && layerPc.id === pieceId;
  const slot = asLayer ? "Outerwear" : suggestSlot(old);
  const others = combo.pieces.filter(p => p.id !== pieceId);
  const pool = _suggPool();  // always an array now; bans already excluded
  const isPureFunc = p => { const s = itemFormalitySet(p) || []; return s.length === 1 && s[0] === 1; };
  const ls = laundryState();
  let cands = pool.filter(i =>
    i.image_path && !isNoSuggest(i) && i.id !== pieceId &&
    (!_suggClean() || suggestibleClean(i, ls)) &&
    (suggestSlot(i) === slot || (slot === "Outerwear" && isLayer(i) && i.category === "Tops")) &&
    inSeasonWx(i, _sugg.season, _suggWx()) &&
    !others.some(o => isExcluded(i.id, o.id)));
  if (_sugg.targetLevel) {
    // hard, matching the engine (2026-07-19) — no silent level fallback
    cands = cands.filter(i => (itemFormalitySet(i) || []).includes(_sugg.targetLevel));
  }
  if (_sugg.shapeKey) {
    // Formula mode: a swap stays inside the shape (a different sweater, not a tee).
    const shape = formulaShapeMap(_sugg.shapeKey);
    const subs = shape.get(slot) || (slot === "Outerwear" ? shape.get("Tops") : null);
    if (subs) cands = cands.filter(i => subs.has(i.subcategory));
  }
  cands = cands.filter(i => {   // pure-utility isolation, always
    const test = [...others, i];
    const hasFunc = test.some(isPureFunc);
    return !hasFunc || test.every(p => (itemFormalitySet(p) || []).includes(1));
  });
  if (!cands.length) { toast(`No other ${(asLayer ? "layer" : suggSlotLabel(old).toLowerCase())} fits`); return; }
  const pick = cands[Math.floor(Math.random() * cands.length)];
  combo.pieces = combo.pieces.map(p => p.id === pieceId ? pick : p);
  renderSuggestSheet();
}

// The piece acting as a look's layer: outerwear/cardigan slot, or (when two tops
// are present) the layer-flagged top doubling as outerwear. Single source of truth
// so the chip labels and the canvas layout agree on which piece is the layer.
function layerPieceOf(pieces) {
  const ow = pieces.find(p => suggestSlot(p) === "Outerwear");
  if (ow) return ow;
  const tops = pieces.filter(p => p.category === "Tops");
  // With two tops, the LAYER is the one added in the outerwear slot — combos
  // push it last. Scanning forward mislabeled a layer-flagged BASE top as the
  // layer (and the actual layer as "Top") whenever both were flagged
  // (2026-07-19, user-reported tops/layers confusion).
  return tops.length >= 2 ? [...tops].reverse().find(isLayer) || null : null;
}
function comboLayerPiece(combo) { return layerPieceOf(combo.pieces); }

// V3 "+ Layer": add a compatible outerwear/layer piece to the current combo,
// using the same filters as a slot swap (season, exclusions, target level,
// pure-function isolation). Random among candidates, like the engine.
// "Not this" (C1, 2026-07-18): session-ban a piece — it leaves the pool for
// every regenerate/swap/layer until the sheet closes, and the current combo
// swaps it out immediately. Locked pieces unlock first; the seed can't be
// banned (it's the whole point of a seeded shuffle).
function banSuggestionPiece(pieceId) {
  if (pieceId === _sugg.seedItemId) return;
  _sugg.locked.delete(pieceId);
  _sugg.banned.add(pieceId);
  const combo = _sugg.results[_sugg.idx];
  const inCombo = combo && combo.pieces.some(p => p.id === pieceId);
  if (!inCombo) return renderSuggestSheet();
  // Try a targeted swap; if nothing else fits the slot, drop a layer or re-roll.
  const before = combo.pieces.map(p => p.id).join(",");
  swapSuggestionPiece(pieceId);
  const after = _sugg.results[_sugg.idx]?.pieces.map(p => p.id).join(",");
  if (before === after) {
    const layerPc = comboLayerPiece(combo);
    if (layerPc && layerPc.id === pieceId && combo.pieces.length > 2) {
      combo.pieces = combo.pieces.filter(p => p.id !== pieceId);  // layer is optional — just drop it
      return renderSuggestSheet();
    }
    _sugg.idx = 0;
    _sugg.results = suggestOutfits(_sugg.targetLevel, _sugg.seedItemId, _suggPool(), _sugg.season, _suggWx(), _sugg.locked, _suggClean(), _sugg.lockedRoles, _sugg.shapeKey);
    renderSuggestSheet();
  }
}

function addSuggestionLayer() {
  const combo = _sugg.results[_sugg.idx];
  if (!combo) return;
  const pool = _suggPool();  // always an array now; bans already excluded
  const isPureFunc = p => { const s = itemFormalitySet(p) || []; return s.length === 1 && s[0] === 1; };
  const ls = laundryState();
  let cands = pool.filter(i =>
    i.image_path && !isNoSuggest(i) &&
    !combo.pieces.some(p => p.id === i.id) &&
    (!_suggClean() || suggestibleClean(i, ls)) &&
    (suggestSlot(i) === "Outerwear" || (isLayer(i) && i.category === "Tops")) &&
    inSeasonWx(i, _sugg.season, _suggWx()) &&
    !combo.pieces.some(p => isExcluded(i.id, p.id)));
  if (_sugg.targetLevel) {
    // hard, matching the engine (2026-07-19) — no silent level fallback
    cands = cands.filter(i => (itemFormalitySet(i) || []).includes(_sugg.targetLevel));
  }
  cands = cands.filter(i => {   // pure-utility isolation, always
    const test = [...combo.pieces, i];
    const hasFunc = test.some(isPureFunc);
    return !hasFunc || test.every(p => (itemFormalitySet(p) || []).includes(1));
  });
  if (!cands.length) { toast("No layer fits this look"); return; }
  combo.pieces = [...combo.pieces, cands[Math.floor(Math.random() * cands.length)]];
  renderSuggestSheet();
}

// "Wear this today" (non-plan): a suggested outfit logs AS AN OUTFIT — create-or-
// merge a real look (saveComboAsOutfit dedups by item-set + saves the layout), then
// log one wear row per piece with that outfit_id. Same soft dup guard as
// logLookOnDay; post-log sheet gets the heart since the rows share an outfit_id.
async function wearSuggestedCombo(combo, { force = false } = {}) {
  const today = todayStr();
  try {
    const oid = await saveComboAsOutfit(combo.pieces);
    if (!force && wears.some(w => w.outfit_id === oid && w.worn_on === today)) {
      toast("Already logged today", { label: "Log again →", fn: () => wearSuggestedCombo(combo, { force: true }) });
      return;
    }
    const fml = deriveWearFormality(combo.pieces.map(p => p.id));
    const wctx = tripWearContext(today);  // trip mode: auto-stamp "Travel"
    const rows = await rest("/wears", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(combo.pieces.map(p => ({ item_id: p.id, worn_on: today, outfit_id: oid, formality_for: fml, ...(wctx ? { context: wctx } : {}) }))),
    });
    if (Array.isArray(rows)) wears.push(...rows);
    buildOutfitWearMap();
    tripPlanSync(oid, today);  // trip mode: a worn look IS that day's plan
    // Route into the context capture sheet (shared with daily-loop logging)
    if (Array.isArray(rows) && rows.length && rows[0].id) {
      logCelebration(rows, { defer: true });
      openPostLogSheet(rows, { undoable: true });
    } else { hideSheet("logSheet"); toast("Logged!"); }
  } catch (e) { toast(e.message); }
}

// One-line rationale shown under a suggestion so the randomness reads as intentional.
function suggestionWhy(combo) {
  const its = combo.pieces;
  const bits = [];
  let lvl = _sugg.targetLevel;
  if (!lvl) {
    const sets = its.map(i => new Set(itemFormalitySet(i) || [3]));
    for (let L = 8; L >= 1; L--) if (sets.every(s => s.has(L))) { lvl = L; break; }
  }
  if (lvl) bits.push(occLabel(lvl));
  if (_sugg.season) bits.push(_sugg.season.toLowerCase());
  let best = null, bestN = 0;
  for (let i = 0; i < its.length; i++) for (let j = i + 1; j < its.length; j++) {
    const A = its[i], B = its[j];
    if (A.color_family && B.color_family && A.color_family !== B.color_family) {
      const n = _colorPairFreq.get(_pairKey(A.color_family, B.color_family)) || 0;
      if (n > bestN) { bestN = n; best = `${A.color_family.toLowerCase()} + ${B.color_family.toLowerCase()}`; }
    }
  }
  if (best && bestN >= 2) bits.push(`${best} you wear together`);
  return bits.join(" · ");
}

function renderSuggestSheet() {
  const res = _sugg.results;
  const combo = res[_sugg.idx];
  const total = res.length;

  /* The 🏋️ Workout chip is an ALIAS for level 1, not a mode (r14).
     r13 removed it along with activity mode and she asked for it back — she
     liked the chip; what was broken was that it pooled by tag and wouldn't
     build. So it carries `data-slvl="1"`: literally the same control as the
     "1. Utility" chip, sharing one handler and one piece of state, which means
     it cannot drift from it the way the old mode did.
     Both light up together when level 1 is active. That's deliberate — it says
     "these are the same thing" rather than hiding one behind the other.
     The ladder keeps the word Utility because level 1 is also rain and hiking;
     the chip keeps Workout because that's what she actually goes looking for. */
  const levelChips = OCCASION_LADDER.map((lbl, i) => {
    const lvl = i + 1, on = _sugg.targetLevel === lvl;
    return `<button class="cap-chip${on ? " on" : ""}" data-slvl="${lvl}" style="font-size:13px;text-align:left">${lvl}. ${esc(lbl)}</button>`;
  }).join("")
    + `<button class="cap-chip${_sugg.targetLevel === 1 ? " on" : ""}" data-slvl="1" style="font-size:13px" title="Runs, lifts, hikes — the same as 1. Utility">🏋️ Workout</button>`;

  let preview = "";
  if (combo) {
    const layout = suggestionLayout(combo.pieces);
    const fakeOutfit = { layout, formality_override: null, _bucket: null };
    const canvas = layoutCanvasHtml(fakeOutfit, "ocanvas sg-canvas");
    preview = canvas || combo.pieces.map(p =>
      `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;cursor:pointer" data-canvas-item="${esc(p.id)}">
        ${thumbHtml(p.image_path)}
        <div><div style="font-size:14px;font-weight:500">${esc(p.name)}</div>
        <div style="font-size:12px;color:var(--muted)">${esc(p.category)}${p.color_family ? " · " + esc(p.color_family) : ""}</div></div>
      </div>`
    ).join("");
  }

  const nav = total > 1 ? `<div style="display:flex;align-items:center;justify-content:center;gap:16px;margin-top:8px">
    <button class="icon-btn" data-sprev ${_sugg.idx === 0 ? "disabled" : ""}>
      <svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>
    </button>
    <span style="font-size:13px;color:var(--muted)">${_sugg.idx + 1} of ${total}</span>
    <button class="icon-btn" data-snext ${_sugg.idx >= total - 1 ? "disabled" : ""}>
      <svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
    </button>
  </div>` : "";

  // Varying names the source look and says which control does the work, because
  // the answer is "the one you already had in mind" — she shouldn't have to
  // discover that the per-piece ✨ is the point of this screen.
  const varyLabel = _sugg.varyFrom ? (() => {
    const o = outfitById.get(_sugg.varyFrom);
    return `<div style="font-size:12px;color:var(--muted);text-align:center;padding:0 16px 4px">
      ${o ? `Starting from <b style="color:var(--accent)">${esc(outfitName(o))}</b>. ` : ""}Tap ✨ on the piece you want to change.
    </div>`;
  })() : "";
  // Only name the shape when a chip isn't already showing it as selected —
  // otherwise the same fact is on screen twice.
  const shapeOnAChip = _sugg.shapeKey && topFormulas(3).some(f => f.key === _sugg.shapeKey);
  const shapeLabel = (_sugg.shapeKey && !shapeOnAChip)
    ? `<div style="font-size:12px;color:var(--accent);text-align:center;padding:0 16px 2px">Formula: ${esc(formulaLabel(_sugg.shapeKey))}</div>` : "";
  const capLabel = _sugg.capsuleId ? (() => {
    const c = capsuleById.get(_sugg.capsuleId);
    return c ? `<div style="font-size:12px;color:var(--accent);text-align:center;padding:0 16px 2px">From: ${esc(c.name)}</div>` : "";
  })() : "";

  // C1: her top contexts by wear count, above the formality chips. Picking one sets
  // the target formality level from empirical wear data (or the seed fallback).
  /* Every context she actually wears EXCEPT Workout. The Workout context is
     still real everywhere else — she stamps it on wears and plans days with it —
     but in the SUGGESTER it would be a second control for something formality
     level 1 (Utility) already says, which is the duplication r13 removed
     (her call: "I do still want the other contexts available to select though.
     just not workout"). A planned Workout day still asks for level 1 by itself,
     via CONTEXT_FORMALITY_SEED. */
  const topContexts = topContextsByWearCount(8).filter(c => c !== "Workout").slice(0, 6);
  const contextChipsHtml = topContexts.length ? `<div style="padding:12px 16px 4px">
    <div style="font-size:12px;color:var(--muted);margin-bottom:6px">Context</div>
    <div class="cap-catbar" style="flex-wrap:wrap;gap:6px">${topContexts.map(c =>
      `<button class="cap-chip${_sugg.activeContext === c ? " on" : ""}" data-sctx="${esc(c)}" style="font-size:13px">${esc(c)}</button>`).join("")}</div>
  </div>` : "";

  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="sgClose">Close</button>
      <h2>${_sugg.varyFrom ? "Vary this look" : "Outfit suggestion"}</h2>
      <div style="width:48px"></div>
    </div>
    ${varyLabel}
    ${shapeLabel}
    ${capLabel}
    ${suggestShapeChipsHtml()}
    ${contextChipsHtml}
    <div style="padding:12px 16px 4px">
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px">Formality</div>
      <div class="cap-catbar" style="flex-wrap:wrap;gap:6px">${levelChips}</div>
    </div>
    <div style="padding:4px 16px">
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px">Season</div>
      <div class="cap-catbar" style="flex-wrap:wrap;gap:6px">
        ${SEASONS.map(s => `<button class="cap-chip${_sugg.season === s ? " on" : ""}" data-sseason="${s}" style="font-size:13px">${s}</button>`).join("")}
        <button class="cap-chip${_sugg.season === null ? " on" : ""}" data-sseason="" style="font-size:13px">Any</button>
        ${_sugg.wx && _sugg.wx.maxT != null ? `<button class="cap-chip${_sugg.useWx ? " on" : ""}" data-swx style="font-size:13px" title="Weather-aware picks">${wmoEmoji(_sugg.wx.code)} ${_sugg.wx.maxT}°/${_sugg.wx.minT}°</button>` : ""}
        ${(() => { if (!LAUNDRY_READY()) return ""; const n = hamperItems().length; return n ? `<button class="cap-chip${_suggClean() ? " on" : ""}" data-sclean style="font-size:13px" title="Skip items in the hamper">🧺 Clean only</button>` : ""; })()}
        ${suggestPoolChipHtml()}
      </div>
    </div>
    ${wxMemoryRowHtml(_suggWx(), _sugg.activeContext ? [_sugg.activeContext] : null)}
    <div style="padding:12px 16px" id="sgPreview">
      <div id="sgPreviewInner">${combo ? preview : `<div class="center muted" style="padding:32px 0">Not enough items in this ${_sugg.capsuleId ? "capsule" : "closet"} to suggest an outfit.</div>`}</div>
      ${combo ? `<div class="center" style="font-size:12px;color:var(--accent);padding:8px 0 0;font-weight:500">${esc(suggestionWhy(combo))}</div>` : ""}
      ${combo ? (() => {
        const layerPc = comboLayerPiece(combo);
        const ls = laundryState();
        return `<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:8px">
        ${combo.pieces.map(p => {
          const lk = _sugg.locked.has(p.id);
          // 🧺 marks a dirty piece that's in the combo anyway (locked/seeded,
          // 7-day re-entry, or the clean filter toggled off).
          const lbl = (isDirty(p, ls) ? "🧺 " : "") + ((layerPc && layerPc.id === p.id) ? "Layer" : suggSlotLabel(p));
          return `<span style="display:inline-flex;gap:1px">
            <button class="cap-chip${lk ? " on" : ""}" data-slock="${esc(p.id)}" style="font-size:12px;padding-left:8px;padding-right:8px" title="${lk ? "Unlock" : "Keep this piece"}">${lk ? "🔒" : "🔓"}</button>
            <button class="cap-chip" data-sswap="${esc(p.id)}" style="font-size:12px"${lk ? " disabled" : ""}>✨ ${esc(lbl)}</button>
            ${p.id === _sugg.seedItemId ? "" : `<button class="cap-chip" data-sban="${esc(p.id)}" style="font-size:12px;padding-left:8px;padding-right:8px;color:var(--muted)" title="Not this piece today">⃠</button>`}
          </span>`;
        }).join("")}
        ${!layerPc
          ? `<button class="cap-chip" data-saddlayer style="font-size:12px">＋ Layer</button>`
          : (_sugg.locked.has(layerPc.id) ? "" : `<button class="cap-chip" data-sunlayer="${esc(layerPc.id)}" style="font-size:12px">× Layer</button>`)}
      </div>`;
      })() : ""}
      ${combo ? `<div class="center muted" style="font-size:12px;padding:6px 0 0">Tap a piece to view it · 🔒 keeps it · ⃠ hides it this session${total > 1 ? " · swipe to browse" : ""}</div>` : ""}
      ${nav}
      ${suggestStarvationNote()}
      ${suggestLevelDoorHtml()}
      ${suggestGearDoorHtml()}
    </div>
    ${combo ? `
    <div style="padding:0 16px 16px;display:flex;flex-direction:column;gap:10px">
      <button class="btn" data-swear>${_sugg.planCtx ? (_sugg.planCtx.date === PLAN_BUCKET ? "Add to bucket" : "Plan for " + esc(planDayLabel(_sugg.planCtx.date))) : "Wear this today"}</button>
      <button class="btn btn-sec" data-sbuild>Open in builder</button>
      <button class="lnk" style="font-size:14px;font-weight:600;color:var(--accent);padding:4px 0" data-snew>✨ Reshuffle outfit${_sugg.locked.size ? " (keeps 🔒)" : ""}</button>
      <button class="lnk" style="font-size:14px;color:var(--muted);padding:4px 0" data-sfeedback>Give feedback…</button>
    </div>` : `
    <div style="padding:0 16px 16px"><button class="btn btn-sec" data-snew>✨ Try again</button></div>`}`;

  $("#sgClose").onclick = () => {
    // Opened from the Tomorrow card: whatever it ends as is what the card keeps.
    if (_sugg.tmPick) {
      const c = _sugg.results[_sugg.idx];
      if (c) tmPickSet(_sugg.tmPick.date, _sugg.tmPick.idx, c.pieces);
      _sugg.tmPick = null;
      hideSheet("logSheet");
      if (activeTabName() === "home") renderHome();
      return;
    }
    hideSheet("logSheet");
  };

  const regen = () => {
    _sugg.idx = 0;
    _sugg.results = suggestOutfits(_sugg.targetLevel, _sugg.seedItemId, _suggPool(), _sugg.season, _suggWx(), _sugg.locked, _suggClean(), _sugg.lockedRoles, _sugg.shapeKey);
    renderSuggestSheet();
  };

  $("#logInner").querySelectorAll("[data-slvl]").forEach(b => {
    b.onclick = () => {
      const lvl = +b.dataset.slvl;
      _sugg.targetLevel = _sugg.targetLevel === lvl ? null : lvl;
      _sugg.activeContext = null; // manual formality pick supersedes a context chip
      regen();
    };
  });

  $("#logInner").querySelectorAll("[data-sctx]").forEach(b => {
    b.onclick = () => {
      const c = b.dataset.sctx;
      if (_sugg.activeContext === c) { _sugg.activeContext = null; }
      else {
        _sugg.activeContext = c;
        const lvl = contextFormalityLevel(c);
        if (lvl) _sugg.targetLevel = lvl;
      }
      regen();
    };
  });

  $("#logInner").querySelectorAll("[data-sseason]").forEach(b => {
    b.onclick = () => {
      _sugg.season = b.dataset.sseason || null;
      regen();
    };
  });

  const wxBtn = $("#logInner").querySelector("[data-swx]");
  if (wxBtn) wxBtn.onclick = () => { _sugg.useWx = !_sugg.useWx; regen(); };

  const cleanBtn = $("#logInner").querySelector("[data-sclean]");
  if (cleanBtn) cleanBtn.onclick = () => { _sugg.useClean = !_suggClean(); regen(); };
  $("#logInner").querySelectorAll("[data-sshape]").forEach(b => {
    b.onclick = () => {
      const k = b.dataset.sshape;
      // Tapping the active shape clears it — a chip that can only ever be turned
      // ON is a trap, since the only way back would be closing the sheet.
      _sugg.shapeKey = _sugg.shapeKey === k ? null : k;
      regen();
    };
  });
  const poolBtn = $("#logInner").querySelector("[data-spool]");
  if (poolBtn) poolBtn.onclick = () => { _sugg.wholeCloset = !_sugg.wholeCloset; regen(); };

  const gearBtn = $("#logInner").querySelector("[data-sggear]");
  if (gearBtn) gearBtn.onclick = () => openGearTagSheet();

  $("#logInner").querySelectorAll("[data-sswap]").forEach(b => {
    b.onclick = (e) => { e.stopPropagation(); swapSuggestionPiece(b.dataset.sswap); };
  });

  // C1 "not this": session-ban + immediate replacement.
  $("#logInner").querySelectorAll("[data-sban]").forEach(b => {
    b.onclick = (e) => { e.stopPropagation(); banSuggestionPiece(b.dataset.sban); };
  });

  // Zero-state door: add a covering closet piece to the capsule, then re-roll.
  $("#logInner").querySelectorAll("[data-sgdoor-add]").forEach(b => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        await addItemsToCapsule(_sugg.capsuleId, [b.dataset.sgdoorAdd]);
        toast("Added to the suitcase");
        regen();
      } catch (e) { toast(e.message); b.disabled = false; }
    };
  });
  $("#logInner").querySelectorAll("[data-sgdoor-open]").forEach(b => {
    b.onclick = () => { hideSheet("logSheet"); openItemFrom(b.dataset.sgdoorOpen); };
  });

  wireWxMemory($("#logInner"));

  // V3 lock-a-piece: locking doesn't reshuffle — it marks the piece so the NEXT
  // regenerate (chips or "New suggestions") keeps it. Current combo re-renders only.
  $("#logInner").querySelectorAll("[data-slock]").forEach(b => {
    b.onclick = (e) => {
      e.stopPropagation();
      const id = b.dataset.slock;
      const cur = _sugg.results[_sugg.idx];
      if (_sugg.locked.has(id)) { _sugg.locked.delete(id); _sugg.lockedRoles.delete(id); }
      else {
        _sugg.locked.add(id);
        // Remember the role: a layerable top locked while acting as THIS combo's
        // layer must stay the layer when the batch re-rolls (2026-07-21).
        const lp = cur ? comboLayerPiece(cur) : null;
        if (lp && lp.id === id && lp.category === "Tops") _sugg.lockedRoles.set(id, "Outerwear");
      }
      // Locks must apply to the WHOLE batch, not just the combo on screen —
      // browsing to the next outfit used to drop them (2026-07-21). Regenerate,
      // then keep the current combo in front so the view doesn't jump.
      _sugg.results = suggestOutfits(_sugg.targetLevel, _sugg.seedItemId, _suggPool(), _sugg.season, _suggWx(), _sugg.locked, _suggClean(), _sugg.lockedRoles, _sugg.shapeKey);
      _sugg.idx = 0;
      if (cur && [..._sugg.locked].every(lid => cur.pieces.some(p => p.id === lid))) {
        const k = comboKey(cur.pieces);
        _sugg.results = [cur, ..._sugg.results.filter(c => comboKey(c.pieces) !== k)];
      }
      renderSuggestSheet();
    };
  });

  const addLayerBtn = $("#logInner").querySelector("[data-saddlayer]");
  if (addLayerBtn) addLayerBtn.onclick = () => addSuggestionLayer();
  const unLayerBtn = $("#logInner").querySelector("[data-sunlayer]");
  if (unLayerBtn) unLayerBtn.onclick = () => {
    const combo2 = _sugg.results[_sugg.idx];
    if (!combo2) return;
    combo2.pieces = combo2.pieces.filter(p => p.id !== unLayerBtn.dataset.sunlayer);
    renderSuggestSheet();
  };

  const go = (dir) => {
    if (dir === "next" && _sugg.idx < total - 1) { _suggSlideDir = "next"; _sugg.idx++; renderSuggestSheet(); }
    else if (dir === "prev" && _sugg.idx > 0) { _suggSlideDir = "prev"; _sugg.idx--; renderSuggestSheet(); }
  };
  const prevBtn = $("#logInner").querySelector("[data-sprev]");
  const nextBtn = $("#logInner").querySelector("[data-snext]");
  if (prevBtn) prevBtn.onclick = () => go("prev");
  if (nextBtn) nextBtn.onclick = () => go("next");

  // Apply the slide-in animation on the freshly rendered preview content
  const inner = $("#sgPreviewInner");
  if (inner && _suggSlideDir) {
    inner.classList.add(_suggSlideDir === "next" ? "sg-anim-next" : "sg-anim-prev");
    _suggSlideDir = null;
  }

  // Swipe the preview left/right to move through the batch
  const sw = $("#sgPreview");
  if (sw && total > 1) {
    let x0 = 0, y0 = 0;
    sw.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    sw.addEventListener("touchend", e => {
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;  // ignore taps / vertical scrolls
      go(dx < 0 ? "next" : "prev");
    }, { passive: true });
  }

  // Tap a piece (canvas or fallback row) to open that item
  $("#sgPreview").querySelectorAll("[data-canvas-item]").forEach(el => {
    el.addEventListener("click", () => {
      const it = itemById.get(el.dataset.canvasItem);
      if (!it) return;
      hideSheet("logSheet");
      openItemFrom(it.id, { cat: it.category, sub: it.subcategory });
    });
  });

  const wearBtn = $("#logInner").querySelector("[data-swear]");
  if (wearBtn && combo && _sugg.planCtx) wearBtn.onclick = async () => {
    const pc = _sugg.planCtx;
    try {
      const oid = await saveComboAsOutfit(combo.pieces);
      hideSheet("logSheet");
      if (pc.kv) {
        // Round A day plan (kv), not a capsule plan.
        await addKvPlanLook(pc.date, oid, pc.entryIdx ?? null);
        toast("Planned for " + planDayLabel(pc.date));
        if (activeTabName() === "home") renderHome();
        else if (activeTabName() === "calendar") renderCalendar();
      } else {
        // capsules tab is already on the plan view underneath the sheet; addPlanLook re-renders it
        await addPlanLook(pc.capsuleId, pc.date, oid);
        toast("Added to " + planDayLabel(pc.date));
      }
    } catch (e) { toast(e.message); }
  };
  else if (wearBtn && combo) wearBtn.onclick = () => wearSuggestedCombo(combo);

  const buildBtn = $("#logInner").querySelector("[data-sbuild]");
  if (buildBtn && combo) buildBtn.onclick = () => {
    hideSheet("logSheet");
    // seed the builder with the first piece, then open (carry plan context if any)
    openBuilder(null, combo.pieces[0].id, _sugg.planCtx);
    // after builder opens, drop all pieces
    setTimeout(() => {
      if (!builder) return;
      for (let i = 1; i < combo.pieces.length; i++) {
        const p = combo.pieces[i];
        if (!builder.pieces.find(x => x.item_id === p.id)) {
          builder.pieces.push({ item_id: p.id, ...defaultPlacement(builder.pieces.length) });
        }
      }
      renderBuilder();
    }, 50);
  };

  const fbBtn = $("#logInner").querySelector("[data-sfeedback]");
  if (fbBtn && combo) fbBtn.onclick = () => openFeedbackSheet(combo.pieces);

  // New suggestions: remember everything currently shown, then regenerate a fresh
  // batch (locked pieces persist through regen).
  const newBtn = $("#logInner").querySelector("[data-snew]");
  if (newBtn) newBtn.onclick = () => {
    _sugg.results.forEach(c => _suggSeen.add(comboKey(c.pieces)));
    regen();
  };

  hydratePhotos($("#logInner"));
}

// Feedback sheet from the suggester: never-suggest an item, or mark a pair as clashing.
function openFeedbackSheet(pieces) {
  const rows = pieces.map(p => {
    const off = isNoSuggest(p);
    return `<div class="frow" style="align-items:center">
      ${thumbHtml(p.image_path)}
      <div class="fmeta"><div class="fname">${esc(p.name)}</div><div class="fcount">${esc(p.category)}</div></div>
      <button class="rv-set" style="flex:none;width:auto;padding:8px 14px;font-size:13px" data-nosug="${esc(p.id)}">
        ${off ? "Suggest again" : "Don't suggest"}
      </button>
    </div>`;
  }).join("");
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="fbBack">Back</button>
      <h2>Feedback</h2>
      <div style="width:48px"></div>
    </div>
    <div style="padding:8px 16px 16px">
      <div class="muted" style="font-size:13px;margin-bottom:10px">Never suggest an item again, or tell us two pieces don't go together.</div>
      ${rows}
      <button class="btn btn-sec" id="fbPair" style="margin-top:16px">These don't go together…</button>
    </div>`;
  $("#fbBack").onclick = () => renderSuggestSheet();
  $("#fbPair").onclick = () => openExcludeSheet(pieces);
  $("#logInner").querySelectorAll("[data-nosug]").forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.nosug;
      await setNoSuggest(id, !isNoSuggest(itemById.get(id)));
      _sugg.results = suggestOutfits(_sugg.targetLevel, _sugg.seedItemId, _suggPool(), _sugg.season, _suggWx(), _sugg.locked, _suggClean(), _sugg.lockedRoles, _sugg.shapeKey);
      if (_sugg.idx >= _sugg.results.length) _sugg.idx = 0;
      toast(isNoSuggest(itemById.get(id)) ? "Won't suggest this item" : "Will suggest again");
      openFeedbackSheet(pieces);
    };
  });
  hydratePhotos($("#logInner"));
}

function openNewLookSheet() {
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="nlClose">Cancel</button>
      <h2>New look</h2>
      <div style="width:48px"></div>
    </div>
    <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
      <button class="btn" id="nlSuggest">Suggest an outfit for me</button>
      <button class="btn btn-sec" id="nlBuild">Build manually on canvas</button>
    </div>`;
  showSheet("logSheet");
  $("#nlClose").onclick = () => { hideSheet("logSheet"); };
  $("#nlSuggest").onclick = () => { hideSheet("logSheet"); openSuggestSheet(); };
  $("#nlBuild").onclick = () => { hideSheet("logSheet"); openBuilder(); };
}

async function openExcludeSheet(pieces) {
  // Mark individual clashing PAIRS among the shown pieces. Every unordered pair is
  // listed; the user ticks only the specific pairs that don't go together (e.g. A×B
  // clashes but A×C is fine). Each ticked pair becomes its own exclusion.
  const pairKey = (a, b) => [a, b].sort().join(":");
  const allPairs = [];
  for (let i = 0; i < pieces.length; i++)
    for (let j = i + 1; j < pieces.length; j++) allPairs.push([pieces[i], pieces[j]]);
  const pairSel = new Set();  // canonical "a:b" keys the user has marked this session

  const renderExSheet = () => {
    const rows = allPairs.map(([p, q]) => {
      const key = pairKey(p.id, q.id);
      const already = isExcluded(p.id, q.id);
      const on = pairSel.has(key);
      return `<button class="ex-pair${on ? " on" : ""}${already ? " ex-locked" : ""}" data-expair="${esc(key)}"${already ? " disabled" : ""}>
        <div class="ex-pair-imgs">${thumbHtml(p.image_path, "ex-thumb")}<span class="ex-x">×</span>${thumbHtml(q.image_path, "ex-thumb")}</div>
        <div class="ex-pair-names">${esc(p.name)} <span class="ex-x">×</span> ${esc(q.name)}</div>
        ${already
          ? `<span class="ex-already">Excluded</span>`
          : `<span class="ex-tick">${on ? `<svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:var(--accent);stroke-width:2.5;fill:none"><polyline points="20 6 9 17 4 12"/></svg>` : ""}</span>`}
      </button>`;
    }).join("");
    const n = pairSel.size;
    $("#logInner").innerHTML = `
      <div class="sheet-hdr">
        <button class="lnk" id="exBack">Back</button>
        <h2>Which pairs clash?</h2>
        <button class="lnk" id="exSave" style="font-weight:700;${n < 1 ? "opacity:.4;pointer-events:none" : ""}">Save</button>
      </div>
      <div style="padding:8px 16px 12px">
        <div class="muted" style="font-size:13px;margin-bottom:12px">Tap each pair that doesn't go together. Only the pairs you mark are excluded — every other combination stays available.${n >= 1 ? ` <b style="color:var(--text)">${n} marked</b>` : ""}</div>
        ${rows}
        <div style="margin-top:14px">
          <input class="inp" id="exReason" type="text" placeholder="Reason (optional)" style="width:100%;font-size:15px" value="">
        </div>
      </div>`;
    $("#exBack").onclick = () => openFeedbackSheet(pieces);
    $("#exSave").onclick = async () => {
      if (!pairSel.size) return;
      const reason = $("#exReason").value.trim() || null;
      const payload = [...pairSel].map(k => {
        const [a, b] = k.split(":");
        return { item_a: a, item_b: b, ...(reason ? { reason } : {}) };
      });
      try {
        const res = await rest("/exclusions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Prefer: "return=representation" },
          body: JSON.stringify(payload),
        });
        if (Array.isArray(res)) exclusions.push(...res);
        else if (res && res.id) exclusions.push(res);
        buildExcludeSet();
        toast(payload.length === 1 ? "Pair excluded" : `Excluded ${payload.length} pairs`);
        _sugg.results = suggestOutfits(_sugg.targetLevel, _sugg.seedItemId, _suggPool(), _sugg.season, _suggWx(), _sugg.locked, _suggClean(), _sugg.lockedRoles, _sugg.shapeKey);
        if (_sugg.idx >= _sugg.results.length) _sugg.idx = 0;
        renderSuggestSheet();
      } catch (e) { toast(e.message); }
    };
    $("#logInner").querySelectorAll("[data-expair]").forEach(b => {
      b.onclick = () => {
        const k = b.dataset.expair;
        if (pairSel.has(k)) pairSel.delete(k); else pairSel.add(k);
        renderExSheet();
      };
    });
    hydratePhotos($("#logInner"));
  };
  renderExSheet();
}

function looksCapsuleBanner() {
  if (!activeCapsuleId) return "";
  return scopeBannerHtml("Wearable from");
}

// Looks matching a query — by piece (name/brand/category/sub) or by context
// (the look's own context + any context stamped on its logged wears).
function looksSearchResults(q) {
  const ql = q.trim().toLowerCase();
  const all = looksScopedOutfits();
  if (!ql) return all.slice().sort((a, b) => (b._num || 0) - (a._num || 0));
  const ctxByOutfit = new Map();
  for (const w of wears) {
    if (!w.outfit_id) continue;
    let s = ctxByOutfit.get(w.outfit_id);
    if (!s) { s = new Set(); ctxByOutfit.set(w.outfit_id, s); }
    for (const c of ctxArr(w)) s.add(String(c).toLowerCase());
  }
  return all.filter(o => {
    if (o.context && String(o.context).toLowerCase().includes(ql)) return true;
    const cs = ctxByOutfit.get(o.id);
    if (cs && [...cs].some(c => c.includes(ql))) return true;
    return outfitItems(o).some(it =>
      [it.name, it.brand, it.category, it.subcategory].filter(Boolean).join(" ").toLowerCase().includes(ql));
  });
}

function renderLooks() {
  lookId = null; lookView = "canvas";
  $("#itemBar").hidden = true;
  const body = $("#looksBody");
  // Scoped to a single item (opened from its detail page): just its looks.
  if (looksItemFilter) {
    const it = itemById.get(looksItemFilter);
    if (it) {
      const list = outfitsForItem(looksItemFilter);
      body.innerHTML = looksToolbar(`In “${esc(it.name || "Untitled")}”`, true, false)
        + `<div style="padding:8px 14px 2px;font-size:13px;color:var(--muted)">${list.length} look${list.length === 1 ? "" : "s"} with this piece</div>`
        + outfitGridHtml(list);
      hydratePhotos(body);
      return;
    }
    looksItemFilter = null;
  }
  const banner = looksCapsuleBanner();
  if (looksSearchQ !== null) {
    const results = looksSearchResults(looksSearchQ);
    body.innerHTML = looksToolbar("Search looks", true, false) + banner + `
      <div style="padding:10px 14px 0"><input class="inp" id="looksSearchInp" placeholder="Search by piece or context…" value="${esc(looksSearchQ)}"></div>
      <div id="looksSearchCount" style="padding:6px 14px 2px;font-size:13px;color:var(--muted)">${results.length} look${results.length === 1 ? "" : "s"}</div>
      <div id="looksSearchResults">${outfitGridHtml(results)}</div>`;
    hydratePhotos(body);
    const inp = $("#looksSearchInp");
    if (inp) {
      inp.oninput = () => {
        looksSearchQ = inp.value;
        const r = looksSearchResults(looksSearchQ);
        const wrap = $("#looksSearchResults");
        if (wrap) { wrap.innerHTML = outfitGridHtml(r); hydratePhotos(body); }
        const cnt = $("#looksSearchCount"); if (cnt) cnt.textContent = `${r.length} look${r.length === 1 ? "" : "s"}`;
      };
      setTimeout(() => inp.focus(), 80);
    }
    return;
  }
  if (looksLens === "Archived") {
    let list = archivedOutfits().sort((a, b) => String(outfitLastWorn(b) || "").localeCompare(String(outfitLastWorn(a) || "")));
    if (hasActiveFilter(looksFilter)) list = list.filter(o => outfitMatchesFilter(o, looksFilter));
    body.innerHTML = looksToolbar("Looks", false, true) + banner + looksLensHtml()
      + (list.length ? outfitGridHtml(list) : `<div class="placeholder"><b>No archived looks</b><div>Archive a look from its screen to tuck it away here.</div></div>`);
    hydratePhotos(body);
    return;
  }
  if (looksLens === "Recent" || looksLens === "All" || looksLens === "Liked") {
    const full = lensOutfitsSorted();
    const list = full.slice(0, LOOKS_FLAT_CAP);
    const more = full.length > list.length
      ? `<div class="snote center" style="padding:0 16px 24px">Showing ${list.length} of ${full.length}. Narrow with Formality or Season.</div>` : "";
    const empty = looksLens === "Liked" && !list.length
      ? `<div class="placeholder"><b>No liked looks yet</b><div>Heart a look when you wear it and it'll show up here.</div></div>` : outfitGridHtml(list);
    body.innerHTML = looksToolbar("Looks", false, true) + banner + looksLensHtml() + empty + more;
  } else if (looksFolder) {
    const list = folderOutfits(looksLens, looksFolder);
    // Round B: a formula is a recipe, so offer to cook a NEW one from it.
    const fresh = looksLens === "Formulas"
      ? `<div style="padding:10px 16px 0"><button class="btn btn-sec" id="formulaNew" style="width:100%">✨ New outfit from this formula</button></div>` : "";
    body.innerHTML = looksToolbar(`${folderLabel(looksLens, looksFolder)} · ${list.length}`, true, true) + banner + fresh + outfitGridHtml(list);
    const fnBtn = $("#formulaNew");
    if (fnBtn) fnBtn.onclick = () => openSuggestSheet(null, null, null, looksFolder);
  } else {
    body.innerHTML = looksToolbar("Looks", false, true) + banner + looksLensHtml() + folderRowsHtml(looksLens);
  }
  hydratePhotos(body);
}

function looksBack() {
  // Look detail first: a look can be open on top of a lingering search (e.g.
  // tapped from a search result, or opened from another screen entirely).
  if (lookId) {
    if (lookView === "wears") return openLookDetails(lookId);   // wears → details
    if (lookView === "details") return openLook(lookId);        // details → canvas
    return leaveLook();                                         // canvas → list or origin screen
  }
  if (looksSearchQ !== null) { looksSearchQ = null; return renderLooks(); }
  // From the item-scoped looks list, back returns to that item's detail.
  if (looksItemFilter) { const id = looksItemFilter; looksItemFilter = null; switchTab("closet"); return openItemDetails(id); }
  if (looksFolder) { looksFolder = null; renderLooks(); return navShallower("looks"); }
  renderLooks();
}

// Leave the current look (back, archive, delete): return to the origin screen
// if it was opened from elsewhere (_lookReturn), else the looks list (stays
// filtered if scoped).
function leaveLook() {
  lookId = null; lookView = "canvas";
  _lookSiblingIds = null;
  if (_lookReturn) { const r = _lookReturn; _lookReturn = null; return r(); }
  renderLooks(); restoreScroll(_lookEntryScroll); _lookEntryScroll = 0;
}

function openRandomLook() {
  const all = looksScopedOutfits();
  if (all.length) openLook(all[Math.floor(Math.random() * all.length)].id);
}

// ---- outfit detail ----
// Shared hero: a saved canvas layout, else a grid of piece photos.
function lookHeroBlock(o) {
  const lay = Array.isArray(o.layout) ? o.layout.filter(p => itemById.has(p.item_id)) : [];
  if (lay.length) return `<div class="lk-canvas">${lay.map((p, idx) => {
    const it = itemById.get(p.item_id);
    return `<div class="lk-cpiece" data-look-item="${esc(it.id)}" data-photo="${esc(it.image_path || "")}" style="left:${p.x * 100}%;top:${p.y * 100}%;width:${p.s * 100}%;z-index:${idx + 1}"></div>`;
  }).join("")}</div>`;
  const pieces = outfitPieces(o);
  if (pieces.length) return `<div class="lk-hero${pieces.length === 1 ? " solo" : ""}">${pieces.map((p, idx) => {
    const span = (pieces.length === 3 && idx === 2) ? " span2" : "";
    return `<div class="lk-heropiece${span}" data-look-item="${esc(p.id)}" data-photo="${esc(p.image_path || "")}"></div>`;
  }).join("")}</div>`;
  return `<div class="muted center" style="padding:30px">No photos for this look's pieces.</div>`;
}

// Look view: clean canvas + bottom action toolbar (Stylebook-style).
function openLook(id) {
  const o = outfitById.get(id);
  if (!o) return;
  if (lookId === null) _lookEntryScroll = getScrollTop();  // list position, for plain-back
  lookId = id; lookView = "canvas";
  const its = outfitItems(o);
  const ic = (svg, label, act, cls) =>
    `<button class="lk-act${cls ? ` ${cls}` : ""}" data-lkact="${act}"><svg viewBox="0 0 24 24">${svg}</svg><span>${label}</span></button>`;

  // Prev/next sibling nav (arrows + swipe), mirroring the item photo view. Siblings
  // are the looks captured in visual order when the tile was tapped.
  const sibs = (_lookSiblingIds || []).map(x => outfitById.get(x)).filter(Boolean);
  const sibIdx = sibs.findIndex(x => x.id === id);
  const hasSibs = sibs.length > 1 && sibIdx >= 0;
  const sibBar = hasSibs ? `
    <div class="item-sib-bar">
      <button class="item-sib-btn" id="lookPrev" ${sibIdx <= 0 ? "disabled" : ""}>
        <svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <span class="item-sib-label">${sibIdx + 1} of ${sibs.length}</span>
      <button class="item-sib-btn" id="lookNext" ${sibIdx >= sibs.length - 1 ? "disabled" : ""}>
        <svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
      </button>
    </div>` : "";

  const body = $("#looksBody");
  body.innerHTML = `
    ${looksToolbar(esc(outfitName(o)), true, false, id)}
    ${sibBar}
    ${!o.archived && effectiveArchived(o) ? `<div class="center muted" style="font-size:12.5px;padding:6px 16px 0;color:var(--accent)">Hidden from browse — contains an archived item</div>` : ""}
    <div class="lk-canvas-wrap">
      ${lookHeroBlock(o)}
      <div class="center muted" style="font-size:12.5px;margin-top:4px">${its.length} piece${its.length === 1 ? "" : "s"} · tap a piece to open it${hasSibs ? " · swipe to browse" : ""}</div>
    </div>
    <div class="lk-actbar">
      ${ic('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>', "Details", "details")}
      ${ic('<path d="M3 7h6l2 2h10v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>', "Formality", "folder")}
      ${ic('<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><path d="M7.8 7.8l2.1 2.1M14.1 14.1l2.1 2.1M16.2 7.8l-2.1 2.1M9.9 14.1l-2.1 2.1"/>', "Vary", "vary")}
      ${ic('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>', "Duplicate", "duplicate")}
      ${ic('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M12 14v4M10 16h4"/>', "Calendar", "calendar")}
      ${ic('<rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/>', o.archived ? "Unarchive" : "Archive", "archive")}
      ${ic('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>', "Delete", "delete", "danger")}
    </div>`;
  $("#itemBar").hidden = true;
  hydratePhotos(body);
  scrollToTop();

  if (hasSibs) {
    const goSib = (dir) => {
      const idx = sibs.findIndex(x => x.id === id);
      if (dir === "next" && idx < sibs.length - 1) openLook(sibs[idx + 1].id);
      else if (dir === "prev" && idx > 0) openLook(sibs[idx - 1].id);
    };
    const pv = $("#lookPrev"), nx = $("#lookNext");
    if (pv) pv.onclick = () => goSib("prev");
    if (nx) nx.onclick = () => goSib("next");
    const canvas = body.querySelector(".lk-canvas-wrap");
    if (canvas) {
      let _lsx = 0, _lsy = 0;
      canvas.addEventListener("touchstart", e => { _lsx = e.touches[0].clientX; _lsy = e.touches[0].clientY; }, { passive: true });
      canvas.addEventListener("touchend", e => {
        const dx = e.changedTouches[0].clientX - _lsx, dy = e.changedTouches[0].clientY - _lsy;
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
        goSib(dx < 0 ? "next" : "prev");
      }, { passive: true });
    }
  }
}

// Look "Details" metadata page (Edit button on the canvas view).
function openLookDetails(id) {
  const o = outfitById.get(id);
  if (!o) return;
  lookId = id; lookView = "details";
  const its = outfitItems(o);
  const n = outfitWornCount(o), lw = outfitLastWorn(o);
  const lastTxt = lw ? (daysSince(lw) <= 0 ? "Today" : relDate(lw)) : "Never";
  const cost = outfitCost(o);
  const seasons = outfitSeasons(o);
  const bucket = FORMALITY_BUCKETS.find(b => b.key === outfitBucket(o));
  const lookLvl = BUCKET_RANGES[outfitBucket(o)];
  const missingLvlPieces = its.filter(it => !(itemFormalitySet(it) || []).includes(lookLvl));

  const pieceRows = its.map((it, idx) => `
    ${idx > 0 ? '<div class="det-divider"></div>' : ""}
    <button class="det-row" data-occ-item="${esc(it.id)}" style="align-items:center">
      <span class="det-piece-thumb" data-piece-open="${esc(it.id)}" data-photo="${esc(it.image_path || "")}"></span>
      <span style="flex:1;min-width:0">
        <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.name || "Untitled")}</span>
        <span style="display:block;color:var(--muted);font-size:12px;margin-top:2px">${esc(pieceFormalityLabel(it))}</span>
      </span>
      <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
    </button>`).join("");

  const body = $("#looksBody");
  body.innerHTML = `
    ${looksToolbar("Details", true, false)}
    ${!o.archived && effectiveArchived(o) ? `<div class="center muted" style="font-size:12.5px;padding:6px 16px 0;color:var(--accent)">Hidden from browse — contains an archived item</div>` : ""}
    <div class="det-body">
      <div class="det-section-label">WEAR</div>
      <div class="det-card">
        <button class="det-row" id="lookWearsBtn"><span class="det-lbl">Worn</span><span class="det-val">${n} time${n === 1 ? "" : "s"}${lw ? ` · last ${esc(lastTxt)}` : ""}</span><svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>
        <div class="det-divider"></div>
        <div class="det-row"><span class="det-lbl">Pieces</span><span class="det-val">${its.length} item${its.length === 1 ? "" : "s"}</span></div>
        <div class="det-divider"></div>
        <div class="det-row"><span class="det-lbl">Total</span><span class="det-val">${cost > 0 ? esc(money(cost)) : "—"}</span></div>
      </div>

      <div class="det-section-label">CLASSIFICATION</div>
      <div class="det-card">
        <button class="det-row" data-look-formality="1"><span class="det-lbl">Formality</span><span class="det-val">${esc(bucket ? bucket.label : "—")}${o.formality_override ? ' <span style="font-size:11px;color:var(--muted)">(set)</span>' : ""}</span><svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>
        <div class="det-divider"></div>
        <div class="det-row"><span class="det-lbl">Season</span><span class="det-val">${seasons.length ? seasons.map(s => `<span class="lk-chip">${esc(s)}</span>`).join(" ") : "—"}</span></div>
      </div>

      <div class="det-section-label" style="display:flex;justify-content:space-between;align-items:center">PIECE FORMALITY<button class="lnk" id="lookEditPieces" style="font-size:12.5px;font-weight:600">Edit arrangement</button></div>
      <div class="det-card">${pieceRows || '<div class="det-row"><span class="det-val muted">No pieces</span></div>'}</div>
      ${missingLvlPieces.length ? `<button class="lnk" id="lookAddLevel" style="display:block;width:100%;text-align:center;font-size:13px;font-weight:600;padding:11px 0;margin-top:8px">+ Add “${lookLvl}. ${esc(occLabel(lookLvl))}” to ${missingLvlPieces.length} piece${missingLvlPieces.length === 1 ? "" : "s"}</button>` : ""}

      <div class="det-section-label">NOTES</div>
      <textarea class="det-notes-ta" id="lookNotes" placeholder="Notes about this look…">${esc(o.notes || "")}</textarea>

      <div class="det-card" style="margin-top:14px">
        <button class="det-row" id="lookDecon">
          <span class="det-lbl" style="color:var(--danger)">Deconstruct look</span>
          <span class="det-val" style="font-size:12px;color:var(--muted)">not really a look — keep the wears, drop the grouping</span>
        </button>
      </div>

      ${(() => {
        const sims = similarLooks(o);
        if (!sims.length) return "";
        // Horizontal scroll strip — bigger tiles (full 3:4 collage) that scroll
        // sideways, so nothing runs off a phone's edge.
        const tiles = sims.map(s => `<button class="sim-tile" data-look="${esc(s.o.id)}">
          ${outfitCollageHtml(s.o, 4)}
          ${s.o.rating === 1 ? `<div class="otile-heart"><svg viewBox="0 0 24 24">${HEART_SVG}</svg></div>` : ""}
          <div class="oname">${esc(outfitName(s.o))}</div>
          <div style="font-size:11px;color:var(--accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.label)}</div>
        </button>`).join("");
        return `<div class="det-section-label">SIMILAR LOOKS</div>
          <div class="sim-strip">${tiles}</div>`;
      })()}
    </div>`;
  $("#itemBar").hidden = true;
  hydratePhotos(body);
  scrollToTop();

  // notes auto-save (direct PATCH; skip re-render so typing isn't interrupted)
  const ta = $("#lookNotes");
  let noteTimer;
  ta.addEventListener("input", () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(async () => {
      const val = ta.value.trim() || null, prev = o.notes;
      o.notes = val;
      try {
        await rest(`/outfits?id=eq.${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ notes: val }),
        });
      } catch (e) { o.notes = prev; toast(e.message); }
    }, 900);
  });
}

// "When You Wore It" — this look's wear dates; tap a day to set its context.
function openLookWears(id) {
  const o = outfitById.get(id);
  if (!o) return;
  lookId = id; lookView = "wears";
  const byDate = new Map();
  for (const w of wears) {
    if (w.outfit_id !== id) continue;
    let a = byDate.get(w.worn_on); if (!a) { a = []; byDate.set(w.worn_on, a); }
    a.push(w);
  }
  const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));
  const rows = dates.map(d => {
    const ws = byDate.get(d);
    const ctx = ws.flatMap(w => ctxArr(w)).filter((v, i, a) => a.indexOf(v) === i);
    const dt = new Date(d + "T00:00:00");
    const dlabel = dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    const dow = dt.toLocaleDateString(undefined, { weekday: "long" });
    return `<button class="det-row" data-wear-date="${esc(d)}" style="align-items:center">
      <span style="flex:1;min-width:0">
        <span style="display:block">${esc(dlabel)}</span>
        <span style="display:block;color:var(--muted);font-size:12.5px;margin-top:2px">${esc(dow)}${ctx.length ? ` · ${esc(ctx.join(", "))}` : ""}</span>
      </span>
      <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
    </button>`;
  }).join("");
  const body = $("#looksBody");
  body.innerHTML = `
    ${looksToolbar("When You Wore It", true, false)}
    <div class="det-body">
      ${dates.length
        ? `<div class="det-card">${rows}</div><div class="center muted" style="font-size:12px;margin-top:8px">Tap a day to open it on the calendar.</div>`
        : `<div class="muted center" style="padding:30px">Never worn yet.</div>`}
    </div>`;
  $("#itemBar").hidden = true;
  hydratePhotos(body);
  scrollToTop();
}

// Duplicate a look (copies name+"copy", layout, formality override, pieces).
async function duplicateLook(id) {
  const o = outfitById.get(id); if (!o) return;
  const itemIds = (outfitItemMap.get(id) || []).slice();
  try {
    const rows = await rest("/outfits?select=*", {
      method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ name: o.name ? `${o.name} copy` : null, layout: o.layout || null, formality_override: o.formality_override || null }),
    });
    const no = Array.isArray(rows) ? rows[0] : rows;
    if (!no || !no.id) throw new Error("Could not duplicate look");
    outfits.push(no);
    if (itemIds.length) {
      const links = itemIds.map(item_id => ({ outfit_id: no.id, item_id }));
      await rest("/outfit_items", { method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(links) });
      outfitLinks = outfitLinks.concat(links);
    }
    buildOutfitIndexes();
    toast("Look duplicated");
    openLook(no.id);
  } catch (e) { toast(e.message); }
}

// ---- wear this look (one wear row per piece, linked to the outfit) ----
// Single-ask: date only here; context/formality/heart are captured once,
// after logging, via the shared openPostLogSheet (same pattern as logLookOnDay).
function openWearLook(id) {
  const o = outfitById.get(id);
  if (!o) return;
  const its = outfitItems(o);
  const today = todayStr();
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="logCancel">Cancel</button>
      <h2>Wear This Look</h2>
      <button class="lnk" id="logSave" style="font-weight:700">Log</button>
    </div>
    <div style="padding:20px 18px 30px">
      <label style="display:block;font-size:13px;color:var(--muted);margin-bottom:8px">Date worn</label>
      <input class="inp" id="logDate" type="date" value="${today}" max="${today}" style="width:100%;font-size:16px">
      <div class="muted" style="font-size:13px;margin-top:12px">Logs a wear for all ${its.length} piece${its.length === 1 ? "" : "s"} in this look.</div>
    </div>`;
  showSheet("logSheet");
  $("#logCancel").onclick = () => { hideSheet("logSheet"); };
  $("#logSave").onclick = async () => {
    const date = $("#logDate").value;
    if (!date || !its.length) { hideSheet("logSheet"); return; }
    try {
      const fml = deriveWearFormality(its.map(it => it.id));
      const payload = its.map(it => ({ item_id: it.id, worn_on: date, outfit_id: id, formality_for: fml }));
      const rows = await rest("/wears", {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify(payload),
      });
      const newWears = Array.isArray(rows) && rows.length ? rows
        : its.map(it => ({ id: null, item_id: it.id, worn_on: date, outfit_id: id, context: null, formality_for: fml }));
      wears.push(...(Array.isArray(rows) ? rows : newWears));
      buildOutfitWearMap();
      if (lookId === id) openLook(id);
      openPostLogSheet(newWears, { undoable: true });
    } catch (e) { toast(e.message); }
  };
}

// ---- hearts: L1 liked = rating === 1, toggle liked <-> null (PATCH) ----
async function toggleLikeLook(id) {
  const o = outfitById.get(id);
  if (!o) return null;
  const prev = o.rating;
  const next = prev === 1 ? null : 1;
  o.rating = next; // optimistic
  try {
    await rest(`/outfits?id=eq.${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ rating: next }),
    });
    buildSuggestIndexes(); // L6: liked looks count double toward pair-affinity
  } catch (e) { o.rating = prev; toast(e.message); }
  return o.rating;
}
const HEART_SVG = '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>';

// ---- archive / unarchive a look (hidden from browse + pickers, kept in history) ----
async function archiveLook(id) {
  const o = outfitById.get(id); if (!o) return;
  const next = !o.archived;
  o.archived = next;  // optimistic
  invalidateArchivedCache();
  try {
    await rest(`/outfits?id=eq.${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ archived: next }),
    });
    toast(next ? "Look archived" : "Look unarchived");
  } catch (e) { o.archived = !next; invalidateArchivedCache(); toast(e.message); }
  if (o.archived) leaveLook();  // leave the now-hidden look
  else openLook(id);
}

// ---- delete a look (history is preserved: wears.outfit_id is SET NULL) ----
// Core removal shared by delete + deconstruct + the health-check bulk fix:
// the outfit row goes, its wear rows survive as individual wears (DB FK is
// SET NULL; mirrored locally). No navigation, no confirm — callers own those.
async function deconstructLookCore(id) {
  await rest(`/outfits?id=eq.${id}`, { method: "DELETE" });
  outfits = outfits.filter(o => o.id !== id);
  outfitById.delete(id);
  outfitItemMap.delete(id);
  outfitLinks = outfitLinks.filter(l => l.outfit_id !== id);
  wears.forEach(w => { if (w.outfit_id === id) w.outfit_id = null; });
  buildOutfitWearMap();
}

async function deleteLook(id) {
  if (!confirm("Delete this look? Your wear history is kept — only the saved outfit is removed.")) return;
  try {
    await deconstructLookCore(id);
    leaveLook();
    toast("Look deleted");
  } catch (e) { toast(e.message); }
}

// Incomplete outfit (2026-07-19, user request): can't plausibly be worn as-is —
// no one-piece (dress/swimsuit) AND not top+bottom. Shoes are NEVER required
// (an outfit without shoes = worn at home, her rule). Workout pieces count as
// their top/bottom equivalents. One-piece looks have their own check.
function outfitIncomplete(o) {
  const its = outfitItems(o);
  if (its.length < 2) return false;
  let top = false, bottom = false, one = false;
  for (const i of its) {
    const cat = i.category, sub = i.subcategory || "";
    if (cat === "Dresses" || sub === "Swimwear") one = true;
    else if (cat === "Tops" || sub === "Workout tops" || sub === "Sports bras") top = true;
    else if (cat === "Bottoms" || sub === "Active shorts") bottom = true;
  }
  return !(one || (top && bottom));
}

// Review sheet for incomplete looks: see them, open them, deconstruct the
// junk ones one tap at a time (wears always survive).
function openIncompleteLooksSheet() {
  const list = outfits.filter(outfitIncomplete);
  const rows = list.map(o => {
    const cats = [...new Set(outfitItems(o).map(i => i.subcategory || i.category || "?"))].join(" + ");
    const n = outfitWornCount(o);
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 16px;border-bottom:1px solid var(--line)">
      <button data-il-open="${esc(o.id)}" style="width:56px;flex:none">${outfitCollageHtml(o, 4)}</button>
      <button data-il-open="${esc(o.id)}" style="flex:1;min-width:0;text-align:left">
        <div style="font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(outfitName(o))}</div>
        <div style="font-size:12px;color:var(--muted)">${esc(cats)} · ${n} wear${n === 1 ? "" : "s"}</div>
      </button>
      <button class="cap-chip" data-il-decon="${esc(o.id)}" style="flex:none;color:var(--danger)">Deconstruct</button>
    </div>`;
  }).join("");
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="ilClose">Done</button>
      <h2>Incomplete looks</h2>
      <span style="width:54px"></span>
    </div>
    <div class="muted" style="font-size:12.5px;padding:4px 18px 8px">No dress and no top+bottom pair — probably import strays. Deconstructing keeps every wear as the individual pieces.</div>
    ${list.length > 1 ? `<div style="padding:0 16px 8px"><button class="btn btn-sec" id="ilDeconAll" style="width:100%;color:var(--danger)">Deconstruct all ${list.length}</button></div>` : ""}
    ${rows || `<div class="center muted" style="padding:28px 16px">🎉 None left.</div>`}
    <div style="height:max(env(safe-area-inset-bottom),20px)"></div>`;
  showSheet("logSheet");
  hydratePhotos($("#logInner"));
  $("#ilClose").onclick = () => {
    hideSheet("logSheet");
    if ($(".screen.active")?.id === "tab-settings") { renderSettings(); runDataHealthCheck(); }
  };
  $("#logInner").querySelectorAll("[data-il-open]").forEach(b => {
    b.onclick = () => { hideSheet("logSheet"); openLookFrom(b.dataset.ilOpen); };
  });
  $("#logInner").querySelectorAll("[data-il-decon]").forEach(b => {
    b.onclick = async () => {
      const o = outfitById.get(b.dataset.ilDecon);
      if (!o) return;
      if (!confirm(`Deconstruct "${outfitName(o)}"? Its wears stay as the individual pieces.`)) return;
      b.disabled = true;
      try { await deconstructLookCore(o.id); toast("Deconstructed — wears kept"); openIncompleteLooksSheet(); }
      catch (e) { toast(e.message); b.disabled = false; }
    };
  });

  // Bulk escape hatch (user request 2026-07-20): clear the whole list at once.
  const allBtn = $("#ilDeconAll");
  if (allBtn) allBtn.onclick = async () => {
    if (!confirm(`Deconstruct all ${list.length} incomplete looks? Every wear stays in your history as the individual pieces — only the groupings are removed.`)) return;
    allBtn.disabled = true;
    allBtn.textContent = "Deconstructing…";
    let done = 0;
    try {
      for (const o of list) { await deconstructLookCore(o.id); done++; }
      toast(`${done} look${done === 1 ? "" : "s"} deconstructed — wears kept`);
    } catch (e) {
      toast(`${e.message} — ${done} of ${list.length} done`);
    }
    openIncompleteLooksSheet();
  };
}

// "Not really a look" escape hatch (2026-07-19, user request): every wear of
// it stays in history as the individual pieces; the look itself disappears.
async function deconstructLook(id) {
  const o = outfitById.get(id);
  const n = o ? outfitWornCount(o) : 0;
  if (!confirm(`Deconstruct this look? Its ${n} wear${n === 1 ? "" : "s"} stay in your history as the individual pieces — only the grouping is removed.`)) return;
  try {
    await deconstructLookCore(id);
    leaveLook();
    toast("Look deconstructed — wears kept");
  } catch (e) { toast(e.message); }
}

// ---- override the whole look's formality bucket ----
function openLookFormalityEdit(id) {
  const o = outfitById.get(id);
  if (!o) return;
  let selected = o.formality_override || outfitBucket(o);

  const chips = FORMALITY_BUCKETS.map(b =>
    `<button class="sheet-chip${b.key === selected ? " on" : ""}" data-fbucket="${esc(b.key)}">${esc(b.label)}</button>`
  ).join("");

  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="fmlCancel">Cancel</button>
      <h2>Look formality</h2>
      <button class="lnk" id="fmlSave" style="font-weight:700">Save</button>
    </div>
    <div style="padding:14px 18px 30px">
      <div class="muted" style="font-size:13px;margin-bottom:14px">Override the derived formality for this look.</div>
      <div class="sheet-chips">${chips}</div>
      ${o.formality_override ? `<button class="lnk" id="fmlClear" style="color:var(--danger);font-size:14px;margin-top:16px">Remove override (use auto)</button>` : ""}
    </div>`;

  const syncChips = () => {
    $("#logInner").querySelectorAll("[data-fbucket]").forEach(b =>
      b.classList.toggle("on", b.dataset.fbucket === selected));
  };
  $("#logInner").querySelectorAll("[data-fbucket]").forEach(b => {
    b.onclick = () => { selected = b.dataset.fbucket; syncChips(); };
  });

  const fmlClear = $("#fmlClear");
  if (fmlClear) fmlClear.onclick = async () => {
    o.formality_override = null; o._bucket = null;
    try {
      await rest(`/outfits?id=eq.${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ formality_override: null }),
      });
      toast("Auto formality restored");
    } catch (e) { o._bucket = null; toast(e.message); }
    hideSheet("logSheet");
    openLook(id);
  };

  $("#fmlCancel").onclick = () => { hideSheet("logSheet"); };

  $("#fmlSave").onclick = async () => {
    const prev = o.formality_override;
    o.formality_override = selected; o._bucket = selected;
    try {
      await rest(`/outfits?id=eq.${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ formality_override: selected }),
      });
      toast("Formality saved");
      hideSheet("logSheet");
      openLook(id);
    } catch (e) {
      o.formality_override = prev; o._bucket = null;
      toast(e.message);
      hideSheet("logSheet");
    }
  };

  showSheet("logSheet");
}

// ---- add a formality level to a look's pieces (manual; opened from look detail) ----
function showNudgePiecesSheet(outfitId, bucketKey) {
  const o = outfitById.get(outfitId);
  if (!o) { hideSheet("logSheet"); return; }
  const its = outfitItems(o);
  const targetDefault = BUCKET_RANGES[bucketKey];
  if (!targetDefault || !its.length) { toast("Formality saved"); hideSheet("logSheet"); openLook(outfitId); return; }

  let target = targetDefault; // single level 1-8 to ADD to each piece's set

  const renderSheet = () => {
    const chips = OCCASION_LADDER.map((lbl, idx) => {
      const lvl = idx + 1, on = lvl === target;
      return `<button class="sheet-chip${on ? " on" : ""}" data-nudgelvl="${lvl}" style="text-align:left">${lvl}. ${esc(lbl)}</button>`;
    }).join("");

    const pieceRows = its.map(it => {
      const s = itemFormalitySet(it) || [];
      const alreadyHas = s.includes(target);
      return `<label style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)">
        <input type="checkbox" data-nudge="${esc(it.id)}" ${!alreadyHas ? "checked" : ""} style="width:18px;height:18px;flex-shrink:0;accent-color:var(--accent)">
        <span style="flex:1;min-width:0">
          <span style="display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(it.name || "Untitled")}</span>
          <span style="display:block;font-size:12px;color:var(--muted)">${esc(pieceFormalityLabel(it))}</span>
        </span>
      </label>`;
    }).join("");

    $("#logInner").innerHTML = `
      <div class="sheet-hdr">
        <button class="lnk" id="nudgeSkip">Cancel</button>
        <h2>Add formality</h2>
        <button class="lnk" id="nudgeApply" style="font-weight:700">Add</button>
      </div>
      <div style="padding:14px 18px 30px">
        <div class="muted" style="font-size:13px;margin-bottom:10px">Adds the chosen level to each checked piece's formality set (it won't remove any levels they already have).</div>
        <div class="sheet-chips" style="flex-direction:column;align-items:stretch;gap:6px;margin-bottom:14px">${chips}</div>
        <div style="font-size:13px;margin-bottom:12px">Adding: <b>${esc(occLabel(target))}</b></div>
        <div>${pieceRows}</div>
      </div>`;

    $("#nudgeSkip").onclick = () => { hideSheet("logSheet"); openLook(outfitId); };

    $("#logInner").querySelectorAll("[data-nudgelvl]").forEach(btn => {
      btn.addEventListener("click", () => { target = +btn.dataset.nudgelvl; renderSheet(); });
    });

    $("#nudgeApply").onclick = async () => {
      const toNudge = [...$("#logInner").querySelectorAll("[data-nudge]:checked")].map(x => x.dataset.nudge);
      if (!toNudge.length) { toast("Formality saved"); hideSheet("logSheet"); openLook(outfitId); return; }
      try {
        // patch each item individually — each has a different existing set
        await Promise.all(toNudge.map(async iid => {
          const it = itemById.get(iid) || items.find(x => x.id === iid);
          if (!it) return;
          const cur = it.formality ? (Array.isArray(it.formality) ? it.formality : [+it.formality]) : [];
          const newSet = [...new Set([...cur, target])].sort((a, b) => a - b);
          await rest(`/items?id=eq.${iid}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify({ formality: newSet }),
          });
          it.formality = newSet;
        }));
        outfits.forEach(o => { o._bucket = null; });
        toast(`Formality saved · ${toNudge.length} piece${toNudge.length === 1 ? "" : "s"} updated`);
      } catch (e) { toast(e.message); }
      hideSheet("logSheet");
      openLook(outfitId);
    };
  };

  showSheet("logSheet");
  renderSheet();
}

// ---- correct a piece's formality (edits items.formality — now a set/array) ----
function openOccasionEdit(itemId, onSaved) {
  const it = itemById.get(itemId) || items.find(x => x.id === itemId);
  if (!it) return;
  let sel = it.formality ? (Array.isArray(it.formality) ? [...it.formality] : [+it.formality]) : [];

  const render = () => {
    const chips = OCCASION_LADDER.map((lbl, idx) => {
      const n = idx + 1, on = sel.includes(n);
      return `<button class="sheet-chip${on ? " on" : ""}" data-occ="${n}" style="text-align:left">
        <span style="font-weight:500">${n}. ${esc(lbl)}</span>
        <span style="font-size:11px;color:var(--muted);display:block;margin-top:1px">${esc(OCCASION_HINTS[idx])}</span>
      </button>`;
    }).join("");
    const selLabel = sel.length ? sel.map(n => `${n}. ${occLabel(n)}`).join(", ") : "Not set";
    $("#logInner").innerHTML = `
      <div class="sheet-hdr">
        <button class="lnk" id="occCancel">Cancel</button>
        <h2>When can you wear this?</h2>
        <button class="lnk" id="occSave" style="font-weight:700">Save</button>
      </div>
      <div style="padding:14px 18px 24px">
        <div class="muted" style="font-size:13px;margin-bottom:12px">${esc(it.name || "Item")} — tap all contexts that apply.</div>
        <div class="sheet-chips" style="flex-direction:column;align-items:stretch;gap:6px">${chips}</div>
        <div style="margin-top:14px;font-size:13px;color:var(--muted)">Selected: <b style="color:var(--text)">${esc(selLabel)}</b></div>
        ${sel.length ? `<button class="lnk" id="occClear" style="color:var(--danger);font-size:14px;margin-top:10px">Clear</button>` : ""}
      </div>`;
    $("#occCancel").onclick = () => { hideSheet("logSheet"); };
    $("#occSave").onclick = async () => {
      const prev = it.formality;
      const val = sel.length ? sel : null;
      it.formality = val;
      outfits.forEach(o => { o._bucket = null; });
      hideSheet("logSheet");
      try {
        await rest(`/items?id=eq.${it.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ formality: val }),
        });
        toast("Formality updated");
        if (onSaved) onSaved();
      } catch (e) {
        it.formality = prev;
        outfits.forEach(o => { o._bucket = null; });
        toast(e.message);
      }
    };
    const oc = $("#occClear");
    if (oc) oc.onclick = () => { sel = []; render(); };
    $("#logInner").querySelectorAll("[data-occ]").forEach(b => {
      b.onclick = () => {
        const n = +b.dataset.occ;
        sel = sel.includes(n) ? sel.filter(x => x !== n) : [...sel, n].sort((a, b) => a - b);
        render();
      };
    });
  };
  render();
  showSheet("logSheet");
}

