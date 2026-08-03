/* ===================================================================
   LAUNDRY — dirty state is DERIVED from wears + items.last_washed
   (migration/items_laundry.sql). null last_washed = clean: tracking is
   opt-in by behavior — an item joins the first time it's stamped washed
   (or overridden into the hamper). No stored dirty flag anywhere.
   =================================================================== */
// Wears (distinct days) per wash, by subcategory; category fallback below.
// Infinity = never dirty. Tune from experience, like the WX thresholds.
const WEAR_TOLERANCE = {
  "Tee shirts": 1, "Graphic tees": 1, "Sleeveless": 1, "Blouses": 1,
  "Long-sleeve tees": 2, "Sweatshirts": 3, "Sweaters": 4, "Cardigans": 4,
  "Jeans": 5, "Pants": 3, "Shorts": 2, "Skirts": 2, "Leggings/Joggers": 1, "Tights": 1,
  "Short": 1, "Long": 2, "Cocktail": 2,
  "Workout tops": 1, "Active shorts": 1, "Sports bras": 1, "Swimwear": 1,
};
const WEAR_TOLERANCE_CAT = { Tops: 1, Bottoms: 2, Dresses: 1, Workout: 1, Outerwear: Infinity, Shoes: Infinity };
// Her real loads, keyed off color_family. Unmapped colors are only caught by
// the "All together" chip in the laundry sheet.
const LAUNDRY_LOADS = {
  Whites: ["White", "Beige"],
  Cools:  ["Blue", "Teal", "Green", "Purple", "Gray", "Black", "Metallic"],
  Warms:  ["Red", "Orange", "Yellow", "Pink", "Maroon", "Brown"],
};
const LAUNDRY_RESUGGEST_DAYS = 7;  // dirty this long → back in the suggestion pool (badged)
const LAUNDRY_STALE_DAYS = 7;      // hamper this stale → Home "done laundry?" prompt
const LAUNDRY_SNOOZE_DAYS = 3;     // "Not yet" pushes the prompt this far out
const LAUNDRY_SNOOZE_KEY = "wardrobe.laundrySnooze";
function laundryPromptSnoozed() {
  const d = store.getItem(LAUNDRY_SNOOZE_KEY);
  return !!d && daysSince(d) < LAUNDRY_SNOOZE_DAYS;
}
// Write-UI gate: true once migration/items_laundry.sql has run (loadData selects *
// so the column then appears on every row). Read paths need no gate — an absent
// column reads as null last_washed, i.e. everything clean.
const LAUNDRY_READY = () => items.length > 0 && "last_washed" in items[0];

// Per-item tolerance override — same sentinel-tag pattern as `layer`/
// `no-suggest` (see item.tags helpers below), just carrying a value: "tol:4".
// Beats the subcat/category defaults; cleared = back to derived.
const TOL_TAG_PREFIX = "tol:";
function tolTagValue(i) {
  const t = (i && i.tags || []).find(t => t.startsWith(TOL_TAG_PREFIX));
  if (!t) return null;
  const n = +t.slice(TOL_TAG_PREFIX.length);
  return Number.isFinite(n) && n > 0 ? n : null;
}
async function setWearToleranceOverride(id, n) {
  const i = itemById.get(id); if (!i) return;
  const tags = (i.tags || []).filter(t => !t.startsWith(TOL_TAG_PREFIX));
  if (n != null) tags.push(TOL_TAG_PREFIX + n);
  i.tags = tags;  // optimistic
  try {
    await rest(`/items?id=eq.${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tags }) });
  } catch (e) { toast(e.message); }
}
function wearTolerance(i) {
  if (!i) return Infinity;
  const override = tolTagValue(i);
  if (override != null) return override;
  if (i.subcategory != null && i.subcategory in WEAR_TOLERANCE) return WEAR_TOLERANCE[i.subcategory];
  return WEAR_TOLERANCE_CAT[i.category] ?? Infinity;
}
// One pass over wears → Map(item_id → Set of distinct worn dates). Build once per
// bulk scan (grids, suggester pool) and pass into the helpers below; per-item
// calls without one still work, they just pay the pass themselves.
function laundryState() {
  const m = new Map();
  for (const w of wears) {
    if (!w.item_id || !w.worn_on) continue;
    let s = m.get(w.item_id); if (!s) m.set(w.item_id, s = new Set());
    s.add(w.worn_on);
  }
  return m;
}
function wearDatesSinceWash(i, ls) {
  const s = (ls || laundryState()).get(i.id);
  if (!s) return [];
  const since = i.last_washed;
  return [...s].filter(d => !since || d > since).sort();
}
// The "one more wear" override stores the wear-day count at the moment it was set
// ("extra:N") — once a NEWER wear lands (count > N) the grace is spent, with no
// wear-path bookkeeping. "hamper" forces dirty until the next wash stamp.
function isDirty(i, ls) {
  if (!i) return false;
  const st = i.laundry_state || null;
  if (st === "hamper") return true;
  if (!i.last_washed) return false;  // never washed in-app = not tracked yet
  const tol = wearTolerance(i);
  if (tol === Infinity) return false;
  const n = wearDatesSinceWash(i, ls).length;
  if (st && st.startsWith("extra:") && n <= +st.slice(6)) return false;
  return n >= tol;
}
// Date the item crossed into the hamper (its tolerance-th wear day since the
// wash) — feeds staleness + suggestion re-entry.
function dirtySince(i, ls) {
  if (!isDirty(i, ls)) return null;
  const dates = wearDatesSinceWash(i, ls);
  if (!dates.length) return todayStr();
  // Never washed in-app (last_washed null) → wearDatesSinceWash is the item's
  // WHOLE history, so the tolerance-th wear would be an ancient date (a tee's
  // first wear in 2025 reading as "323 days dirty"). Only a 'hamper' override
  // gets here; she hampered it because of a RECENT wear, so date it from the
  // latest one.
  if (!i.last_washed) return dates[dates.length - 1];
  const tol = wearTolerance(i);
  if (tol !== Infinity && dates.length >= tol) return dates[tol - 1];
  return dates[dates.length - 1];
}
function dirtyDays(i, ls) { const d = dirtySince(i, ls); return d == null ? null : daysSince(d); }
// Suggester eligibility: clean, or dirty long enough that keeping it filtered
// would starve the pool while the laundry prompt sits unanswered (re-enters badged).
// A MANUAL 'hamper' override never re-enters — the amnesty exists because DERIVED
// dirt can be wrong (she may have washed and not logged it); an explicit "this is
// dirty" is ground truth, and overriding it would break the Clean-only promise.
function suggestibleClean(i, ls) {
  if (!isDirty(i, ls)) return true;
  if ((i.laundry_state || "") === "hamper") return false;
  return dirtyDays(i, ls) >= LAUNDRY_RESUGGEST_DAYS;
}

function hamperItems(ls) {
  ls = ls || laundryState();
  return items.filter(i => itemStatus(i) === "Available" && isDirty(i, ls));
}
// "Worn" tray (2026-07-21, her request): worn since the last wash but NOT yet
// at tolerance — the pile on the chair, not the hamper. Same derivation as
// isDirty, one step earlier. Untracked items (no last_washed) and
// never-dirty categories (shoes/outerwear) stay out.
function isWornNotDirty(i, ls) {
  if (!i || isDirty(i, ls)) return false;
  if (!i.last_washed) return false;
  if (wearTolerance(i) === Infinity) return false;
  return wearDatesSinceWash(i, ls).length > 0;
}
function wornItems(ls) {
  ls = ls || laundryState();
  return items.filter(i => itemStatus(i) === "Available" && isWornNotDirty(i, ls));
}

/* ---- "as of" a past date (2026-08-03) -------------------------------------
   Her words: "I often will go back the next day and say things were washed —
   and like, today's clothes might not be included in that, even though they're
   now in the hamper."

   The laundry sheet showed TODAY's hamper and stamped everything ticked with
   whatever date she picked, which is wrong in both directions. It swept in
   pieces that only got dirty after the wash ran; and for a piece worn both on
   the wash day and the day before, stamping it washed on the earlier date
   DELETED the earlier wear from its count (wearDatesSinceWash keeps d > since),
   quietly resetting a jean that was actually most of the way to the hamper.

   So the date is chosen first and the hamper is derived as of that date.
   ⚠️ asOf >= today short-circuits to the live derivation, so the ordinary
   "I did laundry just now" path is byte-for-byte what it always was. */
function wearDatesSinceWashAsOf(i, ls, asOf) {
  const all = wearDatesSinceWash(i, ls);
  return asOf ? all.filter(d => d <= asOf) : all;
}
function isDirtyAsOf(i, ls, asOf) {
  if (!i) return false;
  if (!asOf || asOf >= todayStr()) return isDirty(i, ls);
  const st = i.laundry_state || null;
  // An explicit "this is dirty" is ground truth and carries backwards — she
  // hampered it by hand, which the derivation can't second-guess.
  if (st === "hamper") return true;
  if (!i.last_washed) return false;
  const tol = wearTolerance(i);
  if (tol === Infinity) return false;
  const n = wearDatesSinceWashAsOf(i, ls, asOf).length;
  if (st && st.startsWith("extra:") && n <= +st.slice(6)) return false;
  return n >= tol;
}
function isWornNotDirtyAsOf(i, ls, asOf) {
  if (!i || isDirtyAsOf(i, ls, asOf)) return false;
  if (!i.last_washed) return false;
  if (wearTolerance(i) === Infinity) return false;
  return wearDatesSinceWashAsOf(i, ls, asOf).length > 0;
}
/* Split what's dirty-or-worn NOW into what the wash on `asOf` could actually
   have contained. `after` is the honest remainder: pieces that only went out
   after that date, so they were still in the drawer when the machine ran. */
function laundryAsOfSplit(pool, ls, asOf) {
  const hamper = [], worn = [], after = [];
  for (const i of pool) {
    if (isDirtyAsOf(i, ls, asOf)) hamper.push(i);
    else if (isWornNotDirtyAsOf(i, ls, asOf)) worn.push(i);
    else after.push(i);
  }
  return { hamper, worn, after };
}
// Load a color family belongs to (null = unmapped).
function laundryLoadOf(cf) {
  for (const [load, fams] of Object.entries(LAUNDRY_LOADS)) if (fams.includes(cf)) return load;
  return null;
}
function laundryStale(ls) {
  if (!LAUNDRY_READY()) return false;
  ls = ls || laundryState();
  return hamperItems(ls).some(i => (dirtyDays(i, ls) ?? 0) >= LAUNDRY_STALE_DAYS);
}
// Stamp items washed on a date: sets last_washed + clears any one-time override.
// Optimistic; PostgREST in.() needs quoted ids, chunked to keep URLs sane.
async function stampWash(ids, dateStr) {
  if (!ids.length) return;
  const day = dateStr || todayStr();
  for (const id of ids) { const it = itemById.get(id); if (it) { it.last_washed = day; it.laundry_state = null; } }
  for (let k = 0; k < ids.length; k += 40) {
    const chunk = ids.slice(k, k + 40).map(id => `"${id}"`).join(",");
    await rest(`/items?id=in.(${chunk})`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ last_washed: day, laundry_state: null }) });
  }
}
async function setLaundryOverride(id, state) {
  const it = itemById.get(id); if (!it) return;
  it.laundry_state = state;  // optimistic
  try {
    await rest(`/items?id=eq.${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ laundry_state: state }) });
  } catch (e) { toast(e.message); }
}
// Make the item's shown state = wantDirty, minimally: clear the override when the
// derived state already agrees, else set the override that forces it.
async function flipLaundry(id, wantDirty, ls) {
  const it = itemById.get(id); if (!it) return;
  const st = it.laundry_state;
  it.laundry_state = null;                // peek at the un-overridden state
  const derived = isDirty(it, ls);
  it.laundry_state = st;
  if (derived === wantDirty) return setLaundryOverride(id, null);
  if (wantDirty) return setLaundryOverride(id, "hamper");
  return setLaundryOverride(id, "extra:" + wearDatesSinceWash(it, ls).length);
}

