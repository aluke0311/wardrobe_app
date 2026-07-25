/* ===================================================================
   GRID BAR  (density picker + select mode + bulk actions)
   =================================================================== */
// Which laundry bulk action the current closet view offers, if any. The Worn
// tray sends pieces onward to the hamper; the hamper sends them to washed.
function laundryBulkMode() {
  if (!LAUNDRY_READY()) return null;
  if (closetWorn) return "hamper";
  if (closetHamper) return "washed";
  return null;
}

function updateGridBar() {
  const n = selectedIds.size;
  const has = selectMode && n > 0;
  $("#gridBar").classList.toggle("selecting", selectMode);
  ["#gbMove", "#gbEdit", "#gbDelete", "#gbCapsule", "#gbLaundry"].forEach(id => $(id).classList.toggle("active", has));
  const lmode = laundryBulkMode();
  const lbtn = $("#gbLaundry");
  lbtn.hidden = !lmode;
  if (lmode) {
    lbtn.title = lmode === "hamper" ? "Move to hamper" : "Mark washed";
    // NOT `.hidden = bool` — on an <svg> element that sets a same-named JS
    // expando that reads back correctly but never touches the DOM attribute,
    // so the `[hidden]{display:none!important}` rule never fires and the icon
    // silently never swaps. toggleAttribute is the one that actually works.
    $("#gbLaundryToHamper").toggleAttribute("hidden", lmode !== "hamper");
    $("#gbLaundryWashed").toggleAttribute("hidden", lmode !== "washed");
  }
  // Five actions + the count + All/Done overflows a 375px phone (the count wraps
  // and All/Done get pushed off). The Worn/Hamper trays are transient laundry
  // states, so re-foldering and capsule assignment step aside there — Edit and
  // Delete stay, since a "this is worn out" moment happens with laundry in hand.
  $("#gbMove").hidden = !!lmode;
  $("#gbCapsule").hidden = !!lmode;
  // Number only, not "N selected": the full label plus four action icons plus
  // All/Done cannot fit 375px at any gap, and it was the label that lost — it
  // truncated to an ellipsis, or shoved Done off the screen entirely.
  const count = $("#gbCount");
  count.textContent = n ? String(n) : "";
  count.title = n ? `${n} selected` : "";
  $("#gbSelect").textContent = selectMode ? "Done" : "Select";
  const all = $("#gbAll");
  const vis = selectMode ? $$(".grid [data-item]").map(t => t.dataset.item) : [];
  all.hidden = !selectMode;
  all.textContent = vis.length && vis.every(id => selectedIds.has(id)) ? "None" : "All";
}

// Select every tile in the current grid (or clear when they're all already
// selected). DOM surgery like toggleSelect — a re-render would flicker photos.
function selectAllVisible() {
  const tiles = $$(".grid [data-item]");
  const ids = tiles.map(t => t.dataset.item);
  const allOn = ids.length && ids.every(id => selectedIds.has(id));
  for (const t of tiles) {
    const id = t.dataset.item;
    if (allOn) selectedIds.delete(id); else selectedIds.add(id);
    t.classList.toggle("selected", !allOn);
    const dot = t.querySelector(".sel-dot");
    if (dot) dot.classList.toggle("on", !allOn);
  }
  updateGridBar();
}

function toggleSelectMode() {
  selectMode = !selectMode;
  if (!selectMode) { selectedIds.clear(); }
  renderCloset();
}

function exitSelectMode() {
  if (!selectMode) return;
  selectMode = false;
  selectedIds.clear();
}

function toggleSelect(id) {
  if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
  // update just the affected tile + bar without full re-render
  const tile = $(`[data-item="${id}"]`);
  if (tile) {
    const sel = selectedIds.has(id);
    tile.classList.toggle("selected", sel);
    const dot = tile.querySelector(".sel-dot");
    if (dot) dot.classList.toggle("on", sel);
  }
  updateGridBar();
}

// ---- grid density picker ----
function renderCurrentGrid() {
  if (_gridSurface === "closet") renderCloset();
  else if (_gridSurface === "search") { searchResults = sortItems(searchResults || []); renderCloset(); }
}

function openGridPicker() {
  const pop = $("#gridPickerPop");
  pop.hidden = !pop.hidden;
  if (!pop.hidden) {
    pop.querySelectorAll("[data-cols]").forEach(b => b.classList.toggle("on", +b.dataset.cols === gridCols));
  }
}

function setGridCols(n) {
  gridCols = n;
  store.setItem("wardrobe.gridCols", String(n));
  $("#gridPickerPop").hidden = true;
  // update all grids on screen without full re-render
  $$(".grid").forEach(g => g.style.setProperty("--grid-cols", n));
}

// Looks-per-row — the var lives on <html> so EVERY .ogrid (Looks lists, stats
// look grids, pickers) follows without per-surface markup.
function setLookCols(n) {
  lookCols = n;
  store.setItem("wardrobe.lookCols", String(n));
  document.documentElement.style.setProperty("--look-cols", n);
  const pop = $("#lookGridPop");
  if (pop) {
    pop.hidden = true;
    pop.querySelectorAll("[data-lookcols]").forEach(b => b.classList.toggle("on", +b.dataset.lookcols === n));
  }
}

// ---- delete selected ----
async function deleteSelected() {
  if (!selectedIds.size) return;
  const n = selectedIds.size;
  if (!confirm(`Delete ${n} item${n === 1 ? "" : "s"}? This cannot be undone.`)) return;
  const ids = [...selectedIds];
  const inList = `(${ids.map(id => `"${id}"`).join(",")})`;
  try {
    await rest(`/items?id=in.${inList}`, { method: "DELETE" });
    items = items.filter(i => !ids.includes(i.id));
    exitSelectMode();
    renderCloset();
    toast(`${n} item${n === 1 ? "" : "s"} deleted`);
  } catch (e) { toast(e.message); }
}

// ---- bulk laundry actions (Worn tray → hamper, Hamper → washed) ----
// Both snapshot the two laundry columns per item first so Undo is exact: these
// write to real rows, and "washed" in particular clears an override AND stamps a
// date, which no single flip can put back.
function _laundrySnapshot(ids) {
  return ids.map(id => {
    const it = itemById.get(id);
    return it && { id, last_washed: it.last_washed ?? null, laundry_state: it.laundry_state ?? null };
  }).filter(Boolean);
}
async function _restoreLaundry(snap) {
  try {
    for (const s of snap) {
      const it = itemById.get(s.id);
      if (it) { it.last_washed = s.last_washed; it.laundry_state = s.laundry_state; }
      await rest(`/items?id=eq.${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ last_washed: s.last_washed, laundry_state: s.laundry_state }) });
    }
    renderCloset();
    toast("Undone");
  } catch (e) { toast(e.message); }
}

async function bulkToHamper() {
  const ids = [...selectedIds];
  if (!ids.length) return;
  const snap = _laundrySnapshot(ids);
  try {
    // Straight to the 'hamper' override in one PATCH. Not a flipLaundry loop:
    // that's a request per item, and it swallows its own errors, so a failed
    // write would still land a success toast. Everything in the Worn tray is
    // under tolerance by construction, so the override is always the right move.
    for (const id of ids) { const it = itemById.get(id); if (it) it.laundry_state = "hamper"; }
    for (let k = 0; k < ids.length; k += 40) {
      const chunk = ids.slice(k, k + 40).map(id => `"${id}"`).join(",");
      await rest(`/items?id=in.(${chunk})`, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ laundry_state: "hamper" }) });
    }
    exitSelectMode();
    renderCloset();
    toast(`${ids.length} in the hamper`, { label: "Undo", fn: () => _restoreLaundry(snap) });
  } catch (e) { toast(e.message); }
}

async function bulkMarkWashed() {
  const ids = [...selectedIds];
  if (!ids.length) return;
  const snap = _laundrySnapshot(ids);
  try {
    // The laundry SHEET filters to dirty items before stamping; here the user
    // picked these out of the hamper by hand, so stamp exactly what she chose.
    // stampWash clears laundry_state itself, which retires any 'hamper' override.
    await stampWash(ids, todayStr());
    exitSelectMode();
    renderCloset();
    toast(`${ids.length} marked washed`, { label: "Undo", fn: () => _restoreLaundry(snap) });
  } catch (e) { toast(e.message); }
}

// ---- bulk edit sheet ----
// Multi-value fields merge with what an item already has by default — adding
// Summer to a Fall item gives Fall+Summer (2026-07-21, her request). The sheet
// exposes a Replace toggle for when she really does mean "set exactly this".
const BULK_MULTI_KEYS = new Set(["fabric", "season", "formality"]);
let bulkAdditive = true;
const BULK_FIELDS = [
  { key: "color_family", label: "Color",     type: "single",    opts: COLOR_FAMILIES.map(c => c[0]) },
  { key: "fabric",       label: "Fabric",    type: "multi",     opts: ["Cotton","Linen","Wool","Cashmere","Silk","Denim","Polyester","Spandex","Nylon","Fleece","Leather","Velvet"] },
  { key: "size",         label: "Size",      type: "single",    opts: ["XXS","XS","S","M","L","XL","XXL","0","2","4","6","8","10","12","14","One size"] },
  { key: "season",       label: "Season",    type: "multi",     opts: SEASONS },
  { key: "formality",    label: "Formality", type: "formality" },
  { key: "brand",        label: "Brand",     type: "text" },
  { key: "status",       label: "Status",    type: "single",    opts: ["Available","Storage","Archive"] },
];

function openBulkEdit() {
  if (!selectedIds.size) return;
  bulkPending = {};
  bulkOpenField = null;
  bulkAdditive = true;
  renderBulkSheet();
  showSheet("bulkSheet");
}

function closeBulkEdit() {
  hideSheet("bulkSheet");
  bulkPending = {};
  bulkOpenField = null;
}

function renderBulkSheet() {
  const rows = BULK_FIELDS.map(f => {
    const isOpen = bulkOpenField === f.key;
    const val = bulkPending[f.key];
    const hasVal = val !== undefined && (Array.isArray(val) ? val.length > 0 : val !== "");
    const displayVal = f.type === "formality" && Array.isArray(val) && val.length
      ? val.map(v => `${v}. ${occLabel(v)}`).join(", ")
      : Array.isArray(val) ? val.join(", ") : val;
    const valHtml = hasVal
      ? `<span style="color:var(--accent);max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(displayVal)}</span>`
      : "";
    let expansion = "";
    if (isOpen) {
      if (f.type === "formality") {
        const sel = Array.isArray(val) ? val : (val ? [+val] : []);
        const chips = OCCASION_LADDER.map((lbl, idx) => {
          const lvl = idx + 1, on = sel.includes(lvl);
          return `<button class="sheet-chip${on ? " on" : ""}" data-bc-field="formality" data-bc-val="${lvl}" data-bc-fml="1" style="text-align:left">
            <span style="font-weight:500">${lvl}. ${esc(lbl)}</span>
            <span style="font-size:11px;color:var(--muted);display:block;margin-top:1px">${esc(OCCASION_HINTS[idx])}</span>
          </button>`;
        }).join("");
        expansion = `<div class="sheet-expand" style="border:none"><div class="sheet-chips" style="flex-direction:column;align-items:stretch;gap:6px">${chips}</div></div>`;
      } else if (f.type === "single" || f.type === "multi") {
        const chips = f.opts.map(o => {
          const on = Array.isArray(val) ? val.includes(o) : val === o;
          return `<button class="sheet-chip${on ? " on" : ""}" data-bc-field="${f.key}" data-bc-val="${esc(o)}" data-bc-multi="${f.type === "multi"}">${esc(o)}</button>`;
        }).join("");
        expansion = `<div class="sheet-expand"><div class="sheet-chips">${chips}</div></div>`;
      } else {
        expansion = `<div class="sheet-expand"><input class="inp" id="bulkTextInp" value="${esc(val || "")}" placeholder="${esc(f.label)}…" style="width:100%"></div>`;
      }
    }
    return `<button class="sheet-row" data-bf="${f.key}">
      <span>${esc(f.label)}</span>
      <span class="rt">${valHtml}<svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:currentColor;stroke-width:2;fill:none;flex-shrink:0"><path d="M${isOpen ? "6 15l6-6 6 6" : "6 9l6 6 6-6"}"/></svg></span>
    </button>${expansion}`;
  }).join("");
  const n = selectedIds.size;
  $("#bulkInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="bulkCancel">Cancel</button>
      <h2>Bulk Edit</h2>
      <button class="lnk" id="bulkSave" style="font-weight:700">Save</button>
    </div>
    ${rows}
    ${Object.keys(bulkPending).some(k => BULK_MULTI_KEYS.has(k) && Array.isArray(bulkPending[k]) && bulkPending[k].length)
      ? `<button class="sheet-row" id="bulkMode">
           <span>Multi-value fields</span>
           <span class="rt" style="color:var(--accent)">${bulkAdditive ? "Add to existing" : "Replace"}</span>
         </button>` : ""}
    <div class="sheet-note">Changes apply to ${n} selected item${n === 1 ? "" : "s"}.</div>`;
  $("#bulkCancel").onclick = closeBulkEdit;
  const bmode = $("#bulkMode");
  if (bmode) bmode.onclick = () => { bulkAdditive = !bulkAdditive; renderBulkSheet(); };
  $("#bulkSave").onclick = saveBulkEdit;
  // field row toggle
  $("#bulkInner").querySelectorAll("[data-bf]").forEach(btn => {
    btn.onclick = () => {
      saveBulkTextField();
      bulkOpenField = bulkOpenField === btn.dataset.bf ? null : btn.dataset.bf;
      renderBulkSheet();
    };
  });
  // chip toggles
  $("#bulkInner").querySelectorAll("[data-bc-field]").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const field = btn.dataset.bcField, isMulti = btn.dataset.bcMulti === "true";
      const isFml = btn.dataset.bcFml === "1";
      const val = isFml ? +btn.dataset.bcVal : btn.dataset.bcVal;
      if (isFml) {
        // formality is a multi-toggle array
        const cur = Array.isArray(bulkPending[field]) ? bulkPending[field] : (bulkPending[field] ? [+bulkPending[field]] : []);
        const next = cur.includes(val) ? cur.filter(x => x !== val) : [...cur, val].sort((a, b) => a - b);
        bulkPending[field] = next.length ? next : undefined;
        if (!next.length) delete bulkPending[field];
      } else if (isMulti) {
        const cur = bulkPending[field] || [];
        bulkPending[field] = cur.includes(val) ? cur.filter(x => x !== val) : [...cur, val];
      } else {
        bulkPending[field] = bulkPending[field] === val ? undefined : val;
        if (bulkPending[field] === undefined) delete bulkPending[field];
      }
      renderBulkSheet();
    };
  });
  // text input live save
  const ti = $("#bulkTextInp");
  if (ti) { ti.oninput = () => { bulkPending[bulkOpenField] = ti.value; }; ti.focus(); }
}

function saveBulkTextField() {
  const ti = $("#bulkTextInp");
  if (ti && bulkOpenField) bulkPending[bulkOpenField] = ti.value;
}

async function saveBulkEdit() {
  saveBulkTextField();
  const shared = {}, merge = {};
  for (const [k, v] of Object.entries(bulkPending)) {
    if (v === undefined || v === "") continue;
    if (bulkAdditive && BULK_MULTI_KEYS.has(k) && Array.isArray(v)) merge[k] = v;
    else shared[k] = v;
  }
  if (!Object.keys(shared).length && !Object.keys(merge).length) { closeBulkEdit(); return; }
  const ids = [...selectedIds];
  // In merge mode each item's result depends on what it already had, so group
  // items by their resulting patch — usually a handful of PATCHes, not N.
  const groups = new Map();
  for (const id of ids) {
    const it = itemById.get(id);
    if (!it) continue;
    const p = { ...shared };
    for (const [k, v] of Object.entries(merge)) {
      const cur = Array.isArray(it[k]) ? it[k] : (it[k] != null && it[k] !== "" ? [it[k]] : []);
      const out = [...new Set([...cur, ...v])];
      p[k] = k === "formality" ? out.map(Number).sort((a, b) => a - b) : out;
    }
    const key = JSON.stringify(p);
    let g = groups.get(key);
    if (!g) groups.set(key, g = { patch: p, ids: [] });
    g.ids.push(id);
  }
  try {
    for (const g of groups.values()) {
      const inList = `(${g.ids.map(id => `"${id}"`).join(",")})`;
      await rest(`/items?id=in.${inList}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(g.patch) });
      for (const id of g.ids) { const it = itemById.get(id); if (it) Object.assign(it, g.patch); }
    }
    closeBulkEdit();
    exitSelectMode();
    renderCloset();
    toast(`Updated ${ids.length} item${ids.length === 1 ? "" : "s"}`);
  } catch (e) { toast(e.message); }
}

// ---- move-to-folder sheet ----
let moveCatOpen = null;

function openMoveSheet() {
  if (!selectedIds.size) return;
  moveCatOpen = null;
  renderMoveSheet();
  showSheet("moveSheet");
}

function closeMoveSheet() {
  hideSheet("moveSheet");
  moveCatOpen = null;
  _moveItemId = null;
  _reviewMoveMode = false;
}

function renderMoveSheet() {
  const rows = CATEGORIES.map(cat => {
    const isOpen = moveCatOpen === cat;
    const subs = TAXONOMY[cat] || [];
    const subRows = isOpen ? subs.map(s =>
      `<button class="mv-sub" data-mv-cat="${esc(cat)}" data-mv-sub="${esc(s)}">${esc(s)}</button>`
    ).join("") : "";
    return `<button class="mv-cat" data-mv-toggle="${esc(cat)}">
      <span>${esc(cat)}</span>
      <svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:var(--muted);stroke-width:2;fill:none;flex-shrink:0"><path d="${isOpen ? "6 15l6-6 6 6" : "6 9l6 6 6-6"}"/></svg>
    </button>${subRows}`;
  }).join("");
  const n = selectedIds.size;
  $("#moveInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="moveCancel">Cancel</button>
      <h2>Move to Folder</h2>
      <span style="width:60px"></span>
    </div>
    ${rows}
    <div class="sheet-note">Moving ${n} item${n === 1 ? "" : "s"} to a new category.</div>`;
  $("#moveCancel").onclick = closeMoveSheet;
  $("#moveInner").querySelectorAll("[data-mv-toggle]").forEach(b => {
    b.onclick = () => { moveCatOpen = moveCatOpen === b.dataset.mvToggle ? null : b.dataset.mvToggle; renderMoveSheet(); };
  });
  $("#moveInner").querySelectorAll("[data-mv-cat]").forEach(b => {
    b.onclick = () => applyMove(b.dataset.mvCat, b.dataset.mvSub);
  });
}

async function applyMove(cat, sub) {
  const ids = [...selectedIds];
  const inList = `(${ids.map(id => `"${id}"`).join(",")})`;
  const patch = { category: cat, subcategory: sub };
  const isSingleItem = _moveItemId != null;
  try {
    await rest(`/items?id=in.${inList}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    items.forEach(i => { if (ids.includes(i.id)) Object.assign(i, patch); });
    const reviewMode = _reviewMoveMode;
    closeMoveSheet();
    if (reviewMode) {
      exitSelectMode();
      reviewAfterEdit();
    } else if (isSingleItem) {
      const sid = _moveItemId;
      _moveItemId = null;
      exitSelectMode();
      openItem(sid);
    } else {
      exitSelectMode();
      renderCloset();
    }
    toast(`Moved ${ids.length} item${ids.length === 1 ? "" : "s"} to ${cat} › ${sub}`);
  } catch (e) { toast(e.message); }
}

