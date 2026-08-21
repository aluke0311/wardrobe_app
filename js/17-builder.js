/* ===================================================================
   BUILD A LOOK — pick the pieces; the arrangement is derived
   builder = { outfitId, name, pieces:[{item_id}], picking, pickCat, pickQ }.

   ⚠️ THE FREE-FORM CANVAS IS GONE (2026-08-21), and with it x / y / s and the
   z-order that array position used to carry. Her ask: "remove the feature that
   allows you to move clothes around — there should just be a default layout
   always. Clothes should ALWAYS fit within the screen on every view of the look,
   so if there are 6 items, they still need to always be visible."

   A dragged layout cannot make that promise: nothing stopped a piece being
   pushed half off the canvas, or two pieces landing on top of each other, and
   `.ocanvas` is a fixed 3/4 box in every grid so a look arranged tall rendered
   clipped in the list it was browsed from. `suggestionLayout` derives the
   arrangement from the piece COUNT, so it fits by construction — see its header.

   What this screen is now: a name, the pieces (tap one to take it out), a live
   preview of exactly how the look will be drawn, and ＋ Clothing. The pieces are
   still an ordered array purely so the preview is stable while she edits; the
   arrangement re-sorts them into dressing order anyway (suggestionPieceOrder).
   =================================================================== */
let builder = null;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/* ⚠️ `seedIds` opens the canvas ON an outfit without CREATING one (2026-08-09,
   her report: "'change it myself' opens a blank outfit canvas"). The first
   version saved a look first so it could pass an outfitId — which was both a
   bug (saveComboAsOutfit takes an array, it was handed an object, threw, and
   the catch left a blank canvas) and the wrong shape: every tap would have left
   a look record behind, which is the Looks-list flooding that got bulk creation
   removed in the first place. The look is created at SAVE, when it's real. */
function openBuilder(outfitId = null, seedItemId = null, planCtx = null, seedIds = null) {
  let pieces = [], name = "";
  const asPieces = (ids) => ids.filter(id => itemById.has(id)).map(id => ({ item_id: id }));
  if (!outfitId && Array.isArray(seedIds) && seedIds.length) {
    pieces = asPieces(seedIds);
  } else if (outfitId) {
    const o = outfitById.get(outfitId);
    if (o) {
      name = o.name || "";
      // ⚠️ The MEMBERSHIP join is the only source of pieces now. It used to read
      // `o.layout` first and top up from the join, which meant a stale layout
      // entry decided the order; the join is what the look actually IS.
      pieces = asPieces(outfitItemMap.get(outfitId) || []);
    }
  } else if (seedItemId && itemById.has(seedItemId)) {
    pieces = asPieces([seedItemId]);
  }
  // Picker mode (B, 2026-07-18): "all" = flat rail over the whole pool with
  // category chips (no folder depth — back always means the same thing);
  // "browse" = the classic folder drill. Persisted; capsule/trip scope
  // defaults to "all" (small pools are where flat shines).
  const scoped = (planCtx && planCtx.capsuleId) || tripModeId;
  const storedMode = store.getItem("wardrobe.pickmode.builder");
  const pickAll = storedMode ? storedMode === "all" : !!scoped;
  builder = { outfitId, name, pieces, picking: false, pickCat: null, pickSub: null, pickQ: "",
              pickAll, planCtx: planCtx || null, scopeCapsuleId: planCtx ? planCtx.capsuleId : null };
  $("#app").classList.add("builder-mode");
  switchTab("builder");
}

function renderBuilder() {
  if (!builder) return;
  if (builder.picking && (builder.pickAll || builderInItemMode())) {
    renderBuilderCanvas();    // canvas stays visible behind the rail
    renderBuilderRail();
  } else if (builder.picking) {
    renderBuilderPicker();    // full-screen category / subfolder list
  } else {
    renderBuilderCanvas();
  }
}

// Toggle between the two picker modes; the preference sticks per user choice.
function setBuilderPickAll(on) {
  builder.pickAll = on;
  store.setItem("wardrobe.pickmode.builder", on ? "all" : "browse");
  builder.pickCat = null; builder.pickSub = null;
  renderBuilder();
}

// True once we're down to an item list (a subfolder, or a flat category with no
// subcategories) — that's when we show the bottom rail over the canvas.
function builderInItemMode() {
  if (!builder.pickCat || builder.pickQ.trim()) return false;  // category list / search stay full-screen
  if (builder.pickSub) return true;
  const catPool = builderPool().filter(i => (i.category || "Other") === builder.pickCat);
  return ![...new Set(catPool.map(i => i.subcategory).filter(Boolean))].length;  // flat category
}

function builderRailPool() {
  // builderPool() honors builder.scopeCapsuleId (trip-day planning) AND trip
  // mode, so the rail stays scoped — same as the folder/subfolder lists.
  const pool = builderPool();
  if (builder.pickAll) {
    // "All" mode: the whole pool in one rail, chip-filtered — no folder depth.
    const list = builder.pickCat ? pool.filter(i => (i.category || "Other") === builder.pickCat) : pool;
    return sortItems(list, "category");
  }
  const catPool = pool.filter(i => (i.category || "Other") === builder.pickCat);
  const list = builder.pickSub ? catPool.filter(i => (i.subcategory || "") === builder.pickSub) : catPool;
  return sortItems(list, "category");  // grouped: category > subcat > color
}

// Bottom item slider over the visible canvas; tap an item to drop it in (rail stays open).
function renderBuilderRail() {
  const body = $("#builderBody");
  const list = builderRailPool();
  const have = new Set(builder.pieces.map(p => p.item_id));
  const cells = list.length
    ? list.map(i => `<div class="bld-rail-item${have.has(i.id) ? " in" : ""}" data-railadd="${esc(i.id)}" data-photo="${esc(i.image_path || "")}"></div>`).join("")
    : `<div class="muted" style="padding:20px 12px;font-size:13px">No items</div>`;
  let chips = "";
  /* The same named-pool + one-tap widen as the full picker. ⚠️ It has to be HERE
     too: a capsule-scoped builder defaults to `pickAll`, i.e. this rail is the
     mode she actually lands in, and a widen that only exists on the screen she
     never opens is no widen at all. */
  /* The pack's "In the bag · N / Whole closet" pool chips went with the solver
     (2026-08-16) — nothing sets `planCtx.packOcc` now. A trip-scoped builder
     still reaches the trip's own pieces: `builder.scopeCapsuleId`, set by the
     trip screen's ✎ Change it / ✎ Build one yourself. */
  if (builder.pickAll) {
    const pool = builderPool();
    const counts = new Map();
    for (const i of pool) { const c = i.category || "Other"; counts.set(c, (counts.get(c) || 0) + 1); }
    const cats = [...counts.keys()].sort((a, b) => { const r = catRank(a) - catRank(b); return r !== 0 ? r : a.localeCompare(b); });
    const chip = (key, lbl, on) => `<button class="cap-chip${on ? " on" : ""}" data-railcat="${esc(key)}">${esc(lbl)}</button>`;
    chips += `<div class="cap-catbar" style="padding:0 10px 6px">${chip("", `All ${pool.length}`, !builder.pickCat)}${cats.map(c => chip(c, `${c} ${counts.get(c)}`, builder.pickCat === c)).join("")}</div>`;
  }
  const backBtn = builder.pickAll
    ? `<button class="lnk" data-railbrowse>🗂 Browse</button>`
    : `<button class="lnk" data-railback>‹ ${esc(builder.pickCat || "Folders")}</button>`;
  const title = builder.pickAll
    ? `${esc(builder.pickCat || "All items")} · ${list.length}`
    : `${esc(builder.pickSub || builder.pickCat || "Items")} · ${list.length}`;
  const ov = document.createElement("div");
  ov.className = "bld-pick-overlay";
  ov.innerHTML = `
    <div class="bld-rail">
      <div class="bld-rail-hdr">
        ${backBtn}
        <div class="bld-rail-title">${title}</div>
        <button class="lnk" data-railclose style="font-weight:700">Done</button>
      </div>
      ${chips}
      <div class="bld-rail-scroll">${cells}</div>
    </div>`;
  body.appendChild(ov);
  hydratePhotos(ov);
}

/* The preview is the REAL arrangement, not an approximation of it — it calls the
   same `suggestionLayout` every grid tile and the look page call, so what she
   sees here is exactly what the look will look like everywhere else. That is
   what makes removing the drag safe: there is nothing left to adjust, so there
   must be nothing left to be surprised by. */
function renderBuilderCanvas() {
  const body = $("#builderBody");
  const its = builder.pieces.map(pc => itemById.get(pc.item_id)).filter(Boolean);
  const lay = suggestionLayout(its);
  const pieceEls = lay.map((p, i) => {
    const it = itemById.get(p.item_id);
    return `<div class="bpiece" data-bitem="${esc(p.item_id)}" data-photo="${esc(it.image_path || "")}"
      style="left:${p.x * 100}%;top:${p.y * 100}%;width:${p.s * 100}%;z-index:${i + 1}"></div>`;
  }).join("");
  const empty = its.length ? "" : `<div class="bld-empty">
    <svg viewBox="0 0 24 24"><path d="M5 9l7-5 7 5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/></svg>
    <div>Tap “+ Clothing” to start</div></div>`;
  /* One row per piece, in the order the look is drawn in. ✕ takes it out, the
     name opens the item — the two things the old selection bar did that were
     about the LOOK rather than about pixels. */
  const list = its.length ? `<div class="bld-pieces">${
    suggestionPieceOrder(its).map(it => `<div class="bld-prow">
      <button class="bld-pmain" data-bopen="${esc(it.id)}">
        <span class="bld-pthumb" data-photo="${esc(it.image_path || "")}"></span>
        <span class="bld-pname">${esc(it.name || "Untitled")}</span>
        <span class="bld-pslot">${esc(it.subcategory || it.category || "")}</span>
      </button>
      <button class="bld-pdrop" data-bdrop="${esc(it.id)}" title="Take it out">✕</button>
    </div>`).join("")}</div>` : "";
  body.innerHTML = `
    <div class="bld-top">
      <button class="lnk" id="bldCancel">Cancel</button>
      <input class="bld-name" id="bldName" placeholder="${builder.outfitId ? "Edit look" : "Name (optional)"}" value="${esc(builder.name)}">
      <button class="lnk" id="bldSave" style="font-weight:700;color:var(--accent)">Save</button>
    </div>
    <div class="bld-stage">
      <div class="bCanvas" id="bCanvas">${empty}${pieceEls}</div>
      <div class="bld-actions">
        <button class="btn-ghost" id="bldAdd"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Clothing</button>
      </div>
      ${list}
      <div class="bld-hint">Every piece is always in frame — the arrangement is set for you.</div>
    </div>`;
  hydratePhotos(body);
  scrollToTop();
  const nameInp = $("#bldName");
  if (nameInp) nameInp.oninput = () => { builder.name = nameInp.value; };
}

function deleteBuilderPiece(itemId) {
  const i = builder.pieces.findIndex(p => p.item_id === itemId);
  if (i < 0) return;
  builder.pieces.splice(i, 1);
  renderBuilderCanvas();
}

// ---- + Clothing picker: closet by category → subcategory → item grid ----
function renderBuilderPicker() {
  const body = $("#builderBody");
  const q = builder.pickQ.trim();
  const backLabel = builder.pickSub ? builder.pickCat : builder.pickCat && !q ? "Categories" : "Done";
  const title = builder.pickSub ? builder.pickSub : builder.pickCat && !q ? builder.pickCat : "Add clothing";
  const chip = (id, lbl, on) => `<button class="cap-chip${on ? " on" : ""}" data-bcap="${esc(id)}">${esc(lbl)}</button>`;
  let capBar = "";
  /* ⚠️ THE PACK GETS A NAMED POOL AND A ONE-TAP WIDEN — the rack's rule, which
     applies to any surface that narrows what she can reach. Revising a trip
     outfit starts in the suitcase (that's the question she's answering), and
     "Whole closet" is the "or from outside the pack too" half of her ask. The
     full capsule list would be noise here: only one trip is in play. */
  if (!builder.planCtx && capsules.length) {
    capBar = `<div class="cap-catbar" style="padding-top:6px">${chip("", "All", !builder.scopeCapsuleId)}${capsules.map(c => chip(c.id, c.name, builder.scopeCapsuleId === c.id)).join("")}</div>`;
  }
  body.innerHTML = `
    <div class="bld-top">
      <button class="lnk" id="bldPickBack">${esc(backLabel)}</button>
      <div class="bld-name" style="cursor:default">${esc(title)}</div>
      <button class="lnk" data-ballmode title="Flat list">▦ All</button>
    </div>
    <div style="padding:10px 14px 0;display:flex;gap:8px;align-items:center">
      <input class="inp" id="bldPickSearch" style="flex:1" placeholder="Search${builder.pickCat ? " in " + builder.pickCat : " your closet"}…" value="${esc(builder.pickQ)}">
      ${funnelBtnHtml("bldPickFilter", builderFilter, () => renderBuilderPicker())}
    </div>
    ${capBar}
    <div id="bldPickResults" style="padding:8px 0 30px">${builderPickContent()}</div>`;
  hydratePhotos(body);
  scrollToTop();
  const s = $("#bldPickSearch");
  if (s) s.oninput = () => { builder.pickQ = s.value; renderBuilderPickerResults(); };
}

function renderBuilderPickerResults() {
  const wrap = $("#bldPickResults");
  if (wrap) { wrap.innerHTML = builderPickContent(); hydratePhotos($("#builderBody")); }
}

// Base pool for the builder picker — scoped to a capsule's pieces when the
// builder was opened for trip-day planning (scopeCapsuleId set).
function builderPool() {
  // Photoless items are allowed — they place on the canvas as the tee placeholder.
  let pool = items.filter(i => itemStatus(i) !== "Archive");
  const scopeCid = (builder && builder.scopeCapsuleId) || tripModeId;  // trip mode scopes too
  if (scopeCid) {
    const set = new Set((capsuleLinkMap.get(scopeCid) || []).map(l => l.item_id));
    pool = pool.filter(i => set.has(i.id));
  }
  if (hasActiveFilter(builderFilter)) pool = pool.filter(i => itemMatchesFilter(i, builderFilter, { noStatusDefault: true }));
  return pool;
}

function builderPickContent() {
  const pool = builderPool();
  const q = builder.pickQ.trim().toLowerCase();
  if (q) {
    // search: scoped to current category/subcat when set
    const hit = i => (i.name || "").toLowerCase().includes(q) || (i.brand || "").toLowerCase().includes(q) ||
      (i.subcategory || "").toLowerCase().includes(q);
    const scoped = pool.filter(i => {
      if (builder.pickCat && (i.category || "Other") !== builder.pickCat) return false;
      if (builder.pickSub && (i.subcategory || "") !== builder.pickSub) return false;
      return hit(i);
    });
    return builderItemGrid(scoped);
  }
  if (builder.pickCat) {
    const catPool = pool.filter(i => (i.category || "Other") === builder.pickCat);
    const subcats = [...new Set(catPool.map(i => i.subcategory).filter(Boolean))];
    subcats.sort();
    if (builder.pickSub) {
      // item grid with subcat chips at top for quick switching
      const subPool = catPool.filter(i => (i.subcategory || "") === builder.pickSub);
      const chip = (key, lbl, n, on) => `<button class="cap-chip${on ? " on" : ""}" data-bsub="${esc(key)}">${esc(lbl)} ${n}</button>`;
      const chips = subcats.map(s => chip(s, s, catPool.filter(i => i.subcategory === s).length, s === builder.pickSub)).join("");
      return `<div class="cap-catbar">${chips}</div>` + builderItemGrid(subPool);
    }
    if (!subcats.length) return builderItemGrid(catPool);  // no subcats → flat grid
    // subcategory folder rows
    return subcats.map(s => {
      const si = catPool.filter(i => i.subcategory === s);
      return `<button class="frow" data-bsub="${esc(s)}">${thumbHtml(si[0]?.image_path || null)}
        <div class="fmeta"><div class="fname">${esc(s)}</div><div class="fcount">${si.length} item${si.length === 1 ? "" : "s"}</div></div>
        <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>`;
    }).join("");
  }
  // category folder rows
  const counts = new Map();
  for (const i of pool) { const c = i.category || "Other"; counts.set(c, (counts.get(c) || 0) + 1); }
  const cats = [...counts.keys()].sort((a, b) => { const r = catRank(a) - catRank(b); return r !== 0 ? r : a.localeCompare(b); });
  return cats.map(c => {
    const rep = pool.find(i => (i.category || "Other") === c);
    return `<button class="frow" data-bcat="${esc(c)}">${thumbHtml(rep ? rep.image_path : null)}
      <div class="fmeta"><div class="fname">${esc(c)}</div><div class="fcount">${counts.get(c)} item${counts.get(c) === 1 ? "" : "s"}</div></div>
      <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>`;
  }).join("");
}

function builderItemGrid(list) {
  const have = new Set(builder.pieces.map(p => p.item_id));
  return `<div style="padding:0 12px">${itemGridView(list, {
    select: true,
    selSet: have,
    onTap: "badd",
    emptyMsg: "No items",
  })}</div>`;
}

function addPieceToBuilder(id, keepPicking) {
  if (!itemById.has(id)) return;
  if (!builder.pieces.some(p => p.item_id === id)) builder.pieces.push({ item_id: id });
  // From the bottom rail we keep picking so several pieces can be added in a row.
  if (!keepPicking) { builder.picking = false; builder.pickCat = null; builder.pickSub = null; builder.pickQ = ""; }
  renderBuilder();
}

function builderPickBack() {
  const q = builder.pickQ.trim();
  if (q) { builder.pickQ = ""; return renderBuilder(); }
  if (builder.pickSub) { builder.pickSub = null; return renderBuilder(); }
  if (builder.pickCat) { builder.pickCat = null; return renderBuilder(); }
  builder.picking = false;
  renderBuilder();
}

function builderCancel() {
  const oid = builder ? builder.outfitId : null;
  const planCtx = builder ? builder.planCtx : null;
  builder = null;
  $("#app").classList.remove("builder-mode");
  // ⚠️ A cancelled kv-plan build lands on that DAY in the calendar — the one
  // surface a future plan is visible on now that the day-plan editor is gone.
  if (planCtx && planCtx.kv) { switchTab("calendar"); calendarDay = planCtx.date; renderCalendar(); return; }
  if (planCtx) { switchTab("capsules"); capsuleId = planCtx.capsuleId; capsuleView = "plan"; renderCapsules(); return; }
  switchTab("looks");
  if (oid) openLook(oid);
}

// Canonical key for an item-set (order-independent, dedup-safe).
function itemSetKey(ids) { return [...new Set(ids)].sort().join("|"); }
// Find a non-archived outfit with an identical item-set (excludeId optional).
function findDuplicateOutfit(itemIds, excludeId) {
  const key = itemSetKey(itemIds);
  for (const o of outfits) {
    if (o.id === excludeId || o.archived) continue;
    const ids = outfitItemMap.get(o.id) || [];
    if (ids.length && itemSetKey(ids) === key) return o;
  }
  return null;
}

// ---- wear-sync after piece edits ------------------------------------------
// Editing a look's pieces doesn't rewrite wear history, but a look edited right
// after being worn usually means "I actually wore the new pieces". These
// reconcile ONE day's outfit-linked wear rows with the look's current piece
// set: swapped-out pieces lose that day's wear row, swapped-in pieces gain one
// with the group's context/formality copied over (so tags follow the swap).

// Most recent date this look was worn (within 14 days) whose wear rows no
// longer match the current piece set. Older wears are history — left alone.
function wearSyncCandidate(outfitId) {
  const dates = [...new Set(wears.filter(w => w.outfit_id === outfitId).map(w => w.worn_on))].sort();
  if (!dates.length) return null;
  const d = dates[dates.length - 1];
  if (daysSince(d) > 14) return null;
  const current = new Set(outfitItemMap.get(outfitId) || []);
  if (!current.size) return null;
  const group = wears.filter(w => w.outfit_id === outfitId && w.worn_on === d);
  const have = new Set(group.map(w => w.item_id));
  const mismatch = group.some(w => !current.has(w.item_id)) || [...current].some(x => !have.has(x));
  return mismatch ? d : null;
}

async function syncWearsToLook(outfitId, dateStr) {
  const current = new Set(outfitItemMap.get(outfitId) || []);
  const group = wears.filter(w => w.outfit_id === outfitId && w.worn_on === dateStr);
  if (!current.size || !group.length) return null;
  const stale = group.filter(w => !current.has(w.item_id) && w.id);
  const have = new Set(group.map(w => w.item_id));
  const missing = [...current].filter(x => !have.has(x));
  if (!stale.length && !missing.length) return null;
  // Copy context/formality from a row that's staying (fall back to any row).
  const src = group.find(w => current.has(w.item_id) && (ctxArr(w).length || w.formality_for))
    || group.find(w => ctxArr(w).length || w.formality_for) || null;
  if (stale.length) {
    await rest(`/wears?id=in.(${stale.map(w => `"${w.id}"`).join(",")})`, { method: "DELETE" });
    const gone = new Set(stale.map(w => w.id));
    wears = wears.filter(w => !gone.has(w.id));
  }
  if (missing.length) {
    const payload = missing.map(item_id => ({
      item_id, worn_on: dateStr, outfit_id: outfitId,
      context: src && ctxArr(src).length ? ctxArr(src) : null,
      formality_for: (src && src.formality_for) || null,
    }));
    const rows = await rest("/wears", {
      method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    wears.push(...(Array.isArray(rows) ? rows : payload));
  }
  buildOutfitWearMap();
  return { added: missing.length, removed: stale.length };
}

// Move one day's wear rows from one look to another (merge follow-up).
async function repointWears(fromId, toId, dateStr) {
  await rest(`/wears?outfit_id=eq.${fromId}&worn_on=eq.${dateStr}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ outfit_id: toId }),
  });
  wears.forEach(w => { if (w.outfit_id === fromId && w.worn_on === dateStr) w.outfit_id = toId; });
  buildOutfitWearMap();
}

// After an EDITED look merges into an existing duplicate: the edit landed on the
// surviving look, but the edited look still exists with its old pieces. Offer to
// move the recent wear over (re-point + piece-sync) and decide the old look's fate.
function openMergeFollowUp(oldId, dupId, wearDate) {
  const oldO = outfitById.get(oldId);
  if (!oldO) return;
  const wearRow = wearDate ? `
      <div style="margin-bottom:20px">
        <div class="muted" style="font-size:13px;margin-bottom:8px">It was worn ${esc(calDayLabel(wearDate))} with the old pieces.</div>
        <button class="sheet-chip" id="mergeMoveWear">Move that wear to this look →</button>
      </div>` : "";
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="mergeClose">Done</button>
      <h2>Merged</h2>
      <span></span>
    </div>
    <div style="padding:20px 18px 30px">
      <div class="muted" style="font-size:13px;margin-bottom:20px">Your edit matched an existing look, so it was applied there. “${esc(outfitName(oldO))}” still exists with the old pieces.</div>
      ${wearRow}
      <div class="muted" style="font-size:13px;margin-bottom:8px">Keep the old look?</div>
      <div class="sheet-chips">
        <button class="sheet-chip" id="mergeKeep">Keep it</button>
        <button class="sheet-chip" id="mergeArchive">Archive it</button>
        <button class="sheet-chip" id="mergeDelete">Delete it</button>
      </div>
    </div>`;
  showSheet("logSheet");
  const close = () => { hideSheet("logSheet"); };
  $("#mergeClose").onclick = close;
  $("#mergeKeep").onclick = close;
  if (wearDate) $("#mergeMoveWear").onclick = async () => {
    try {
      await repointWears(oldId, dupId, wearDate);
      await syncWearsToLook(dupId, wearDate);
      const b = $("#mergeMoveWear");
      if (b) { b.textContent = "Wear moved ✓"; b.disabled = true; }
    } catch (e) { toast(e.message); }
  };
  $("#mergeArchive").onclick = async () => {
    try {
      await rest(`/outfits?id=eq.${oldId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ archived: true }),
      });
      oldO.archived = true;
      close(); toast("Old look archived");
    } catch (e) { toast(e.message); }
  };
  // Delete preserves history like deleteLook (wears.outfit_id is SET NULL), but
  // without leaveLook() — we're on the surviving look, not the deleted one.
  $("#mergeDelete").onclick = async () => {
    try {
      await rest(`/outfits?id=eq.${oldId}`, { method: "DELETE" });
      outfits = outfits.filter(o => o.id !== oldId);
      outfitById.delete(oldId);
      outfitItemMap.delete(oldId);
      wears.forEach(w => { if (w.outfit_id === oldId) w.outfit_id = null; });
      buildOutfitWearMap();
      close(); toast("Old look deleted");
    } catch (e) { toast(e.message); }
  };
}

async function saveBuilder() {
  if (!builder) return;
  const p = builder.pieces;
  if (p.length < 2) { toast("A look needs at least 2 pieces"); return; }
  /* ⚠️ NO `layout` IS WRITTEN ANY MORE (2026-08-21). The arrangement is derived
     from the piece set at render time, so storing one would be a second, stale
     answer to a question the renderer already answers. Existing rows keep
     whatever they hold — unread, deliberately not migrated. */
  const itemIds = p.map(pc => pc.item_id);
  const name = builder.name.trim() || null;
  const wasNew = !builder.outfitId;
  try {
    let id = builder.outfitId;
    // Dedup guard: a new look (or one re-edited to an existing set) merges into
    // the matching outfit instead of creating a duplicate. Latest arrangement wins.
    const dup = findDuplicateOutfit(itemIds, builder.outfitId || null);
    if (dup) {
      await rest(`/outfits?id=eq.${dup.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(name ? { name } : {}),
      });
      if (name) dup.name = name;
      dup._bucket = null;
      buildOutfitIndexes();
      // Edited-look merge: the edit landed on dup, but oldId's recent wear (if
      // any) still points at oldId with the old pieces. Same-day wear moves
      // silently (same policy as the non-merge sync); anything else is offered
      // in the follow-up sheet along with the old look's fate.
      const oldId = builder.outfitId || null;
      const mergePlanCtx = builder.planCtx || null;
      let mergeMsg = "Merged into existing look";
      let mergeWearDate = null;
      if (oldId) {
        const oldDates = [...new Set(wears.filter(w => w.outfit_id === oldId).map(w => w.worn_on))].sort();
        const d = oldDates.length ? oldDates[oldDates.length - 1] : null;
        if (d && daysSince(d) <= 14) {
          if (d === todayStr()) {
            await repointWears(oldId, dup.id, d);
            await syncWearsToLook(dup.id, d);
            mergeMsg = "Merged into existing look · today's wear moved";
          } else {
            mergeWearDate = d;
          }
        }
      }
      finishBuilder(dup.id, mergeMsg);
      if (oldId && !mergePlanCtx) openMergeFollowUp(oldId, dup.id, mergeWearDate);
      return;
    }
    if (!id) {
      const rows = await rest("/outfits?select=*", {
        method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({ name }),
      });
      const o = Array.isArray(rows) ? rows[0] : rows;
      if (!o || !o.id) throw new Error("Could not create look");
      id = o.id;
      outfits.push(o);
      const links = itemIds.map(item_id => ({ outfit_id: id, item_id }));
      await rest("/outfit_items", {
        method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(links),
      });
      outfitLinks = outfitLinks.concat(links);
    } else {
      await rest(`/outfits?id=eq.${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ name }),
      });
      const o = outfitById.get(id); if (o) o.name = name;
      const current = new Set(outfitItemMap.get(id) || []);
      const toAdd = itemIds.filter(x => !current.has(x));
      const toRemove = [...current].filter(x => !itemIds.includes(x));
      if (toAdd.length) {
        const links = toAdd.map(item_id => ({ outfit_id: id, item_id }));
        await rest("/outfit_items", {
          method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify(links),
        });
        outfitLinks = outfitLinks.concat(links);
      }
      if (toRemove.length) {
        const inList = `(${toRemove.map(x => `"${x}"`).join(",")})`;
        await rest(`/outfit_items?outfit_id=eq.${id}&item_id=in.${inList}`, { method: "DELETE" });
        outfitLinks = outfitLinks.filter(l => !(l.outfit_id === id && toRemove.includes(l.item_id)));
      }
    }
    buildOutfitIndexes();  // resets _bucket caches so formality re-derives
    const planCtx = builder && builder.planCtx;
    let savedMsg = wasNew ? "Look created" : "Look saved";
    let syncOffer = null;
    if (!wasNew) {
      const d = wearSyncCandidate(id);
      if (d === todayStr()) {
        // Same-day edit = "this is what I actually wore" — sync silently.
        const r = await syncWearsToLook(id, d);
        if (r) savedMsg = "Look saved · today's wear updated";
      } else if (d && !planCtx) {
        syncOffer = d;
      }
    }
    finishBuilder(id, savedMsg);
    if (syncOffer) {
      toast(`Worn ${calDayLabel(syncOffer)} with the old pieces`, [
        { label: "Update that wear →", fn: async () => {
          try {
            const r = await syncWearsToLook(id, syncOffer);
            toast(r ? "Wear updated to match the look" : "Already up to date");
          } catch (e) { toast(e.message); }
        } },
      ]);
    }
  } catch (e) { toast(e.message); }
}

// After a builder save, either route to the saved look (normal flow) or, when the
// builder was opened for a trip day, attach the look to that day and return there.
function finishBuilder(id, msg) {
  const planCtx = builder && builder.planCtx;
  builder = null;
  $("#app").classList.remove("builder-mode");
  if (planCtx && planCtx.kv) {
    // Attach to the day plan, then land on that day in the calendar — where a
    // future plan is now read (the day-plan editor is gone, 2026-08-21).
    switchTab("calendar");
    calendarDay = planCtx.date;
    addKvPlanLook(planCtx.date, id, planCtx.entryIdx ?? null).then(() => renderCalendar());
    toast("Planned for " + planDayLabel(planCtx.date));
    return;
  }
  if (planCtx) {
    switchTab("capsules");                 // resets capsuleView — set plan state AFTER
    capsuleId = planCtx.capsuleId; capsuleView = "plan";
    addPlanLook(planCtx.capsuleId, planCtx.date, id);  // optimistic c.plan update + re-render
    renderCapsules();
    toast("Added to " + planDayLabel(planCtx.date));
    return;
  }
  looksLens = "All"; looksFolder = null;
  switchTab("looks");
  openLook(id);
  toast(msg);
}

function capsuleBack() {
  // "pack" / "packopts" went with the solver (2026-08-16); nothing can set them.
  if (capsuleView === "trip") { capsuleView = "list"; capsuleId = null; renderCapsules(); return navShallower("capsules"); }
  if (capsuleView === "plan") { capsuleView = "detail"; renderCapsules(); return navShallower("capsules"); }
  if (capsuleView === "pick") { capsuleView = "detail"; return renderCapsules(); }
  if (capsuleView === "form") { _capForm = null; _pendingAddIds = null; capsuleView = capsuleId ? "detail" : "list"; return renderCapsules(); }
  if (capsuleView === "detail") { capsuleView = "list"; capsuleId = null; renderCapsules(); return navShallower("capsules"); }
  renderCapsules();
}

function wireCapsules() {
  const body = $("#capsulesBody");
  // form inputs (re-render only on mode change to keep field focus otherwise)
  if (capsuleView === "form") {
    body.querySelectorAll("[data-capmode]").forEach(b => b.onclick = () => {
      syncCapForm(); _capForm.kind = b.dataset.capmode; renderCapsules();
    });
    const create = $("#capCreate"); if (create) create.onclick = saveNewCapsule;
    return;
  }
  if (capsuleView === "pick") {
    const s = $("#capPickSearch");
    if (s) s.oninput = () => { _capPickFilter = s.value; renderPickerGrid(); };
    const done = $("#capPickDone"); if (done) done.onclick = saveCapsulePicker;
    const filterBtn = $("#capPickFilter");
    if (filterBtn) filterBtn.onclick = () => openFilterSheet(pickerFilter, { onApply: () => renderPickerGrid(), title: "Filter & sort", dims: PICKER_FILTER_DIMS, sortable: true });
    body.querySelectorAll("[data-pick-status]").forEach(b => {
      b.onclick = () => { _capPickStatus = b.dataset.pickStatus; _capPickCat = null; _capPickSub = null; renderPickerGrid(); };
    });
    return;
  }
  const dn = $("#capDetNotes");
  if (dn) dn.oninput = () => saveCapsuleNotes(capsuleId, dn.value);
}

// re-render just the picker results (cat bar + grouped grid); keeps the search box focused
function renderPickerGrid() {
  const body = $("#capsulesBody");
  const cnt = $("#capPickCount"); if (cnt) cnt.textContent = `${_capPick.size} selected`;
  const wrap = $("#capPickResults");
  if (wrap) { wrap.innerHTML = capsulePickSuggestHtml() + pickerCatBar() + pickerSubBar() + pickerGridHtml(pickerPool()); hydratePhotos(body); }
  // update lens chip active state
  const lens = $("#capPickLens");
  if (lens) lens.querySelectorAll("[data-pick-status]").forEach(b => b.classList.toggle("on", b.dataset.pickStatus === _capPickStatus));
}

