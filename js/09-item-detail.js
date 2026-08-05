/* ===================================================================
   ITEM DETAIL  — photo view + details/edit view
   =================================================================== */

// Field definitions for the edit sheet (used by openFieldEdit)
const FIELD_CONFIGS = {
  name:         { label: "Name",      type: "text" },
  purchase_date:{ label: "Purchased", type: "date" },
  color_family: { label: "Color",     type: "color",     opts: COLOR_FAMILIES.map(c => c[0]) },
  fabric:       { label: "Fabric",    type: "multi",     filter: true, opts: ["Cotton","Linen","Wool","Cashmere","Silk","Denim","Polyester","Spandex","Nylon","Fleece","Leather","Velvet","Modal","Rayon","Acrylic"] },
  size:         { label: "Size",      type: "single",    opts: ["XXS","XS","S","M","L","XL","XXL","00","0","2","4","6","8","10","12","14","16","18","23","24","25","26","27","28","29","30","31","32","33","34","36","One size"] },
  season:       { label: "Season",    type: "multi",     opts: SEASONS },
  brand:        { label: "Brand",     type: "typeahead" },
  status:       { label: "Status",    type: "single",    opts: ["Available","Storage","Archive"] },
  formality:    { label: "Formality", type: "formality" },
  price:        { label: "Price",     type: "price" },
  url:          { label: "URL",       type: "text" },
  retailer:     { label: "Retailer",  type: "typeahead" },
  acquisition:  { label: "Acquired",  type: "single",    opts: ["New","Secondhand","Gift"] },
  last_washed:  { label: "Washed",    type: "date" },
  wear_tolerance: { label: "Wears per wash", type: "single", opts: ["1","2","3","4","5","6","7","8","9","10"] },
};

// Tolerance override isn't a DB column, it's the tol:<n> tag (see
// setWearToleranceOverride) — routed through the field sheet via a custom
// _fieldOnSave, same pattern as the Add form's openAddFieldEdit.
function openTolEdit(id) {
  const cfg = FIELD_CONFIGS.wear_tolerance;
  const i = itemById.get(id); if (!i) return;
  _fieldEditId = null;
  _fieldEditKey = "wear_tolerance";
  _fieldPending = String(wearTolerance(i));
  _fieldEditItem = { wear_tolerance: _fieldPending };
  _fieldOnSave = async (val) => {
    await setWearToleranceOverride(id, val ? +val : null);
    if (detailId === id) openItem(id);
  };
  renderFieldSheet(_fieldEditItem, "wear_tolerance", cfg);
  showSheet("fieldSheet");
}

// Items visible in the current subcategory/grid context (for prev/next navigation).
function siblingItems() {
  // Explicit list captured at tap time (capsule/trip grid) wins.
  if (_itemSiblingIds) return _itemSiblingIds.map(id => itemById.get(id)).filter(Boolean);
  if (closetSearchQ !== null && searchResults) return searchResults;
  // hamperViewList, not _scopedHamper: with a load chip on, swiping must stay
  // inside the load she's looking at, or the grid and the arrows disagree.
  if (closetHamper) return hamperViewList();
  if (closetRack) return rackItems();
  if (closetWorn) return _scopedWorn();
  if (closetCat && closetSub) return categoryGrid(closetCat, closetSub);
  if (closetCat) return lensItems().filter(i => i.category === closetCat);
  return lensItems();
}

// ---- Photo view ----
function openItem(id) {
  const i = items.find(x => x.id === id);
  if (!i) return;
  // First entry into detail from a grid: remember the grid's scroll position so
  // plain-back can restore it. Sibling prev/next re-calls keep the original.
  if (detailId === null) _detailEntryScroll = getScrollTop();
  detailId = id;
  detailView = null;

  // Label the back button with where closetBack() will ACTUALLY go — its priority
  // order (review deal → builder → origin screen → closet grid). closetSub/closetCat
  // may hold this item's category for sibling nav, but back doesn't go there.
  const backLabel = _reviewMode ? "Review"
    : _fromBuilder ? "Look"
    : _itemReturn ? ({ home: "Home", calendar: "Calendar", stats: "Stats", capsules: "Capsules",
                       looks: (lookId && outfitById.has(lookId)) ? "Look" : "Looks" }[_itemReturn.tab] || "Back")
    : closetSub
    ? (closetSub === "__all__" ? closetCat : closetSub === "__other__" ? "Other" : closetSub)
    : closetCat || "Closet";

  const sibs = siblingItems();
  const sibIdx = sibs.findIndex(x => x.id === id);
  const sibLabel = _itemSiblingIds ? (_itemSiblingLabel || "")
    : closetSub && closetSub !== "__all__" && closetSub !== "__other__"
    ? closetSub : closetCat || "Closet";
  const sibBar = sibs.length > 1 ? `
    <div class="item-sib-bar">
      <button class="item-sib-btn" id="itemPrev" ${sibIdx <= 0 ? "disabled" : ""}>
        <svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <span class="item-sib-label">${sibIdx + 1} of ${sibs.length}${sibLabel !== "Closet" ? `<br><span style="font-size:11px">${esc(sibLabel)}</span>` : ""}</span>
      <button class="item-sib-btn" id="itemNext" ${sibIdx >= sibs.length - 1 ? "disabled" : ""}>
        <svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
      </button>
    </div>` : "";

  const body = $("#closetBody");
  body.innerHTML = `
    <div class="item-nav">
      <button class="item-back" id="clBack">
        <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>
        <span>${esc(backLabel)}</span>
      </button>
      <div class="item-nav-title">${esc(i.name || "Untitled")}</div>
      <div class="item-nav-right">
        <button class="item-nav-btn" id="itemShuffle" title="Suggest outfit">
          <svg viewBox="0 0 24 24"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>
        </button>
        <button class="item-add-look" id="itemAddLook">Add to Look</button>
      </div>
    </div>
    ${sibBar}
    <div class="item-stat-strip">${esc(itemStatLine(i))}</div>
    ${workhorseBadgeHtml(i)}
    ${laundryLineHtml(i)}
    ${rackLineHtml(i)}
    ${flagLineHtml(i)}
    ${i.image_path
      ? `<div class="item-photo" data-photo="${esc(i.image_path)}"></div>`
      : `<div class="item-photo empty"><svg viewBox="0 0 24 24" style="width:64px;height:64px;stroke:#c9beae;stroke-width:1.4;fill:none"><rect x="2" y="6" width="20" height="14" rx="2"/><circle cx="12" cy="13" r="3"/></svg></div>`}
  `;

  hideGridBar();
  $("#itemBar").hidden = false;
  $("#app").classList.add("detail-photo");

  hydratePhotos(body);

  // Slide-in animation when arriving via sibling navigation
  const photoForAnim = body.querySelector('.item-photo');
  if (photoForAnim && _itemSlideDir) {
    photoForAnim.classList.add(_itemSlideDir === "next" ? "itm-anim-next" : "itm-anim-prev");
    _itemSlideDir = null;
  }

  $("#itemShuffle").onclick = () => openSuggestSheet(i.id);
  $("#itemAddLook").onclick = () => openBuilder(null, i.id);

  body.querySelectorAll("[data-laun-act]").forEach(b => {
    b.onclick = async () => {
      try {
        if (b.dataset.launAct === "washed") await stampWash([i.id]);
        else await flipLaundry(i.id, b.dataset.launAct === "hamper");
      } catch (e) { toast(e.message); }
      openItem(i.id);  // refresh the status line
    };
  });
  const rackBtn = body.querySelector("[data-rack-toggle]");
  if (rackBtn) rackBtn.onclick = async () => {
    const on = rackBtn.dataset.rackToggle === "1";
    await (on ? pullOntoRack(i.id) : pushOffRack(i.id));
    openItem(i.id);
  };
  // Reset (eligible again) and unpin (stop keeping) are separate from the
  // pull/push toggle above — see rackResetPiece.
  const rackReset = body.querySelector("[data-rack-reset-one]");
  if (rackReset) rackReset.onclick = async () => {
    await rackResetPiece(rackReset.dataset.rackResetOne);
    openItem(i.id);
  };
  const rackUnpin = body.querySelector("[data-rack-unpin-one]");
  if (rackUnpin) rackUnpin.onclick = async () => {
    await rackUnpinPiece(rackUnpin.dataset.rackUnpinOne);
    openItem(i.id);
  };
  const flagBtn = body.querySelector("[data-flag-open]");
  if (flagBtn) flagBtn.onclick = () => openFlagSheet(i.id);
  const dateEdit = body.querySelector("[data-laun-date-edit]");
  if (dateEdit) dateEdit.onclick = () => openFieldEdit(i.id, "last_washed");
  const tolEdit = body.querySelector("[data-laun-tol-edit]");
  if (tolEdit) tolEdit.onclick = () => openTolEdit(i.id);

  const goSib = (dir) => {
    const s = siblingItems(); const idx = s.findIndex(x => x.id === id);
    if (dir === "next" && idx < s.length - 1) { _itemSlideDir = "next"; openItem(s[idx + 1].id); }
    else if (dir === "prev" && idx > 0) { _itemSlideDir = "prev"; openItem(s[idx - 1].id); }
  };
  const prevBtn = $("#itemPrev"), nextBtn = $("#itemNext");
  if (prevBtn) prevBtn.onclick = () => goSib("prev");
  if (nextBtn) nextBtn.onclick = () => goSib("next");

  // Swipe photo left/right to navigate siblings
  if (sibs.length > 1) {
    const photoEl = body.querySelector('.item-photo');
    if (photoEl) {
      let _psx = 0, _psy = 0;
      photoEl.addEventListener('touchstart', e => { _psx = e.touches[0].clientX; _psy = e.touches[0].clientY; }, { passive: true });
      photoEl.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - _psx, dy = e.changedTouches[0].clientY - _psy;
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
        goSib(dx < 0 ? "next" : "prev");
      }, { passive: true });
    }
  }
}

// ---- Details / edit view ----
function openItemDetails(id) {
  const i = items.find(x => x.id === id);
  if (!i) return;
  detailId = id;
  detailView = "details";

  const n = wearCount(i.id), lw = lastWorn(i.id), cpw = costPerWear(i), oc = outfitsForItem(i.id).length;
  const ds = lw ? daysSince(lw) : null;
  const lastWornText = lw ? (ds === 0 ? "Today" : `${ds} day${ds === 1 ? "" : "s"} ago`) : "Never";

  // Purchase date + time in closet
  let purchasedText = null, timeInClosetText = null;
  if (i.purchase_date) {
    const pd = new Date(i.purchase_date + "T00:00:00");
    purchasedText = i.date_is_guess
      ? pd.toLocaleDateString(undefined, { year: "numeric", month: "short" })
      : pd.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    const d = daysSince(i.purchase_date);
    if (d < 30) timeInClosetText = `${d}d`;
    else if (d < 365) timeInClosetText = `${Math.floor(d / 30)}mo`;
    else {
      const y = Math.floor(d / 365), m = Math.floor((d % 365) / 30);
      timeInClosetText = m > 0 ? `${y}y ${m}mo` : `${y}y`;
    }
  }

  // Row builders
  const detRow = (lbl, val, field) => {
    const display = val || `<span style="color:var(--muted)">${esc(lbl)}</span>`;
    if (!field) return `<div class="det-row"><span class="det-lbl">${esc(lbl)}</span><span class="det-val">${display}</span></div>`;
    return `<button class="det-row" data-det-field="${field}">
      <span class="det-lbl">${esc(lbl)}</span>
      <span class="det-val">${display}</span>
      <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
    </button>`;
  };

  const colorDisplay = i.color_family
    ? `<span class="swatch" style="background:${colorHex(i.color_family)}"></span>${esc(i.color_family)}`
    : "";

  const body = $("#closetBody");
  body.innerHTML = `
    <div class="cltoolbar">
      <button class="clback" id="clBack"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
      <div class="cltitle">Details</div>
      <span style="width:34px"></span>
    </div>
    <div class="det-body">

      <div class="det-header">
        <div class="det-thumb${i.image_path ? "" : " empty"}" data-photo="${esc(i.image_path || "")}"></div>
        <div class="det-hinfo">
          <button class="det-hname" data-det-field="name" style="background:none;border:none;padding:0;text-align:left;font:inherit;color:inherit;cursor:pointer">${esc(i.name || "Untitled")} <span style="color:var(--muted);font-size:13px;font-weight:400">✎</span></button>
          ${i.brand ? `<div class="det-hbrand">${esc(i.brand)}</div>` : ""}
          ${i.category ? `<div class="det-hpath">${esc(i.category)}${i.subcategory ? ` › ${esc(i.subcategory)}` : ""}</div>` : ""}
        </div>
      </div>

      <div class="det-card" style="margin-bottom:14px">
        <button class="det-row" id="detOutfits"${oc ? "" : " disabled"} style="width:100%;text-align:left">
          <span class="det-val"${oc ? "" : ' style="color:var(--muted)"'}>Used in ${oc} look${oc === 1 ? "" : "s"}</span>
          ${oc ? '<svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>' : ""}
        </button>
        <div class="det-divider"></div>
        <button class="det-row" id="detWears"${n ? "" : " disabled"} style="width:100%;text-align:left">
          <div style="flex:1;min-width:0">
            <div>Worn ${n} day${n === 1 ? "" : "s"}</div>
            <div class="det-sub">Last: ${lastWornText}</div>
            ${(() => {
              const r = wearRhythm(i.id);
              return r ? `<div class="det-sub">Every ~${humanGap(r.avg)} · longest gap ${humanGap(r.longest)}</div>` : "";
            })()}
            ${(() => {
              const p = itemWxProfile(i.id);
              return p ? `<div class="det-sub">Usually worn ${p.lo}°–${p.hi}°</div>` : "";
            })()}
          </div>
          ${n ? '<svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>' : ""}
        </button>
        ${(() => {
          const f = wxFlagFor(i.id);
          if (!f) return "";
          /* The flag IS the fix (Round D.4). It used to be a link into an audit
             sheet; now the sentence explains and the chip resolves, right here.
             Muted, and outside the wears button so it can't steal that tap. */
          return `<div style="padding:2px 0 8px">
            <div class="det-sub" style="line-height:1.45">⚠ ${esc(wxFlagText(f))}</div>
            <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">
              <button class="cap-chip" id="detWxAdd" style="color:var(--accent);font-weight:600">＋ Add ${esc(f.missing.join(" &amp; "))}</button>
              <button class="cap-chip" id="detWxEdit">Edit season…</button>
              <button class="cap-chip" id="detWxOk" style="color:var(--muted)">It's fine</button>
            </div>
          </div>`;
        })()}
        ${partnersRowHtml(i.id)}
        ${(() => {
          const ctx = itemContexts(i.id);
          if (!ctx.length) return "";
          const chips = ctx.map(c => `<span class="lk-chip">${esc(c.ctx)}${c.count > 1 ? ` ×${c.count}` : ""}</span>`).join(" ");
          return `<div class="det-divider"></div>
        <div class="det-row" style="align-items:flex-start">
          <span class="det-lbl" style="flex:none;padding-top:2px">Worn for</span>
          <span class="det-val" style="display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end">${chips}</span>
        </div>`;
        })()}
      </div>

      <div class="det-section-label">NOTES</div>
      <textarea class="det-notes-ta" id="detNotes" placeholder="Notes about this item…">${esc(i.notes || "")}</textarea>

      <div class="det-section-label">ATTRIBUTES</div>
      <div class="det-card">
        ${detRow("Color", colorDisplay, "color_family")}
        <div class="det-divider"></div>
        ${detRow("Fabric", esc((i.fabric || []).join(", ")), "fabric")}
        <div class="det-divider"></div>
        ${detRow("Size", esc(i.size || ""), "size")}
        <div class="det-divider"></div>
        ${detRow("Season", esc((i.season || []).join(", ")), "season")}
        ${(() => {
          /* "Worn like" always sits under Season (her request) — not only when
             it disagrees. Seeing it AGREE is information too: it's the app
             showing its work on a tag she can then trust. */
          const { explicit, derived, differs } = seasonCompare(i);
          const wrap = (t) => `<div class="det-sub" style="padding:0 0 6px">${t}</div>`;
          if (!derived) return wrap(`Worn like — <span style="color:var(--muted)">not worn enough yet to tell</span>`);
          const worn = `Worn like <b>${esc(derived.join(" + "))}</b>`;
          if (!explicit) return wrap(`${worn} — nothing set, so this is what the app uses.`);
          if (!differs) return wrap(`${worn} — matches what you set.`);
          return wrap(`${worn} — differs from what you set.`);
        })()}
        <div class="det-divider"></div>
        ${detRow("Brand", esc(i.brand || ""), "brand")}
        <div class="det-divider"></div>
        ${detRow("Status", esc(itemStatus(i)), "status")}
        <div class="det-divider"></div>
        ${detRow("Acquired", esc(i.acquisition || ""), "acquisition")}
        <div class="det-divider"></div>
        ${(() => { const s = itemFormalitySet(i); const lbl = s ? s.map(n => `${n}. ${occLabel(n)}`).join(" · ") : ""; return detRow("Formality", i.formality ? esc(lbl) : esc(lbl ? "est. · " + lbl : ""), "formality"); })()}
      </div>

      <div class="det-section-label">PRICING</div>
      <div class="det-card">
        ${detRow("Price", money(i.price) !== "—" ? esc(money(i.price)) : "", "price")}
        <div class="det-divider"></div>
        <div class="det-row">
          <span class="det-lbl">$/Wear</span>
          <span class="det-val">${cpw != null ? esc(money(cpw)) : "—"}</span>
        </div>
        <div class="det-divider"></div>
        <button class="det-row" data-det-field="purchase_date">
          <span class="det-lbl">Purchased</span>
          <span class="det-val">${purchasedText
            ? `${esc(purchasedText)}<span class="det-sub" style="margin-left:6px">· ${esc(timeInClosetText)} in closet</span>`
            : `<span style="color:var(--muted)">Set date</span>`}</span>
          <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
        </button>
        <div class="det-divider"></div>
        ${detRow("Retailer", esc(i.retailer || ""), "retailer")}
      </div>

      <div class="det-section-label">LINK</div>
      <div class="det-card">${detRow("URL", esc(i.url || ""), "url")}</div>

      <div class="det-section-label">CAPSULES</div>
      <div class="det-card">
        ${(() => {
          const names = capsuleNamesForItem(i.id);
          return `<button class="det-row" id="detCapsules" style="width:100%;text-align:left">
            <span class="det-lbl">Capsules</span>
            <span class="det-val">${names.length ? esc(names.join(", ")) : `<span style="color:var(--muted)">None</span>`}</span>
            <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
          </button>`;
        })()}
      </div>

      <div class="det-section-label">SUGGESTIONS</div>
      <div class="det-card">
        <button class="det-row" id="detNoSuggest" style="width:100%;text-align:left">
          <span class="det-lbl" style="flex:1;min-width:0">Don't suggest in outfits</span>
          <span class="tgl${isNoSuggest(i) ? " on" : ""}"><span class="tgl-knob"></span></span>
        </button>
        ${i.category === "Tops" ? `
        <div class="det-divider"></div>
        <button class="det-row" id="detLayer" style="width:100%;text-align:left">
          <span class="det-lbl" style="flex:1;min-width:0">Use as a layer<span class="det-sub" style="display:block">e.g. an open button-up over a tee</span></span>
          <span class="tgl${isLayer(i) ? " on" : ""}"><span class="tgl-knob"></span></span>
        </button>` : ""}
        <div class="det-divider"></div>
        <button class="det-row" id="detWorkoutGear" style="width:100%;text-align:left">
          <span class="det-lbl" style="flex:1;min-width:0">Workout gear<span class="det-sub" style="display:block">suggestible for runs, lifts, hikes…</span></span>
          <span class="tgl${isWorkoutGear(i) ? " on" : ""}"><span class="tgl-knob"></span></span>
        </button>
        <div class="det-divider"></div>
        <button class="det-row" id="detRainGear" style="width:100%;text-align:left">
          <span class="det-lbl" style="flex:1;min-width:0">Rain gear<span class="det-sub" style="display:block">only suggested on wet days</span></span>
          <span class="tgl${isRainGear(i) ? " on" : ""}"><span class="tgl-knob"></span></span>
        </button>
        <div class="det-divider"></div>
        <button class="det-row" id="detNoRack" style="width:100%;text-align:left">
          <span class="det-lbl" style="flex:1;min-width:0">Keep off the rack<span class="det-sub" style="display:block">still suggested when you ask for its level — just never in play by default</span></span>
          <span class="tgl${isNoRack(i) ? " on" : ""}"><span class="tgl-knob"></span></span>
        </button>
      </div>

    </div>
    <div class="det-footer">
      ${i.image_path
        ? `<button class="lnk" id="detReplaceImg">Replace Photo</button>
           <button class="lnk" id="detRemoveImg" style="color:var(--danger)">Remove Photo</button>`
        : `<button class="lnk" id="detReplaceImg">Add Photo</button>`}
    </div>
  `;

  $("#itemBar").hidden = true;
  hydratePhotos(body);

  $("#detReplaceImg").onclick = () => pickItemPhoto(i.id);
  const rmImg = $("#detRemoveImg");
  if (rmImg) rmImg.onclick = () => removeItemPhoto(i.id);

  const noRack = $("#detNoRack");
  if (noRack) noRack.onclick = async (e) => {
    const next = !isNoRack(i);
    e.currentTarget.querySelector(".tgl").classList.toggle("on", next);
    await setNoRack(i.id, next);
    // The rack's own membership check can't see a tag change, so invalidate.
    if (typeof rackEnsure === "function") { _rackMemo = null; rackEnsure().catch(() => {}); }
  };
  $("#detNoSuggest").onclick = async (e) => {
    const next = !isNoSuggest(i);
    e.currentTarget.querySelector(".tgl")?.classList.toggle("on", next);  // instant feedback
    await setNoSuggest(i.id, next);
    openItemDetails(i.id);
  };

  const layerBtn = $("#detLayer");
  if (layerBtn) layerBtn.onclick = async (e) => {
    const next = !isLayer(i);
    e.currentTarget.querySelector(".tgl")?.classList.toggle("on", next);  // instant feedback
    await setLayer(i.id, next);
    openItemDetails(i.id);
  };

  $("#detWorkoutGear").onclick = async (e) => {
    const next = !isWorkoutGear(i);
    e.currentTarget.querySelector(".tgl")?.classList.toggle("on", next);  // instant feedback
    await setWorkoutGear(i.id, next);
    openItemDetails(i.id);
  };

  $("#detRainGear").onclick = async (e) => {
    const next = !isRainGear(i);
    e.currentTarget.querySelector(".tgl")?.classList.toggle("on", next);  // instant feedback
    await setRainGear(i.id, next);
    openItemDetails(i.id);
  };

  const outfitsBtn = $("#detOutfits");
  if (outfitsBtn && oc) outfitsBtn.onclick = () => { looksItemFilter = i.id; switchTab("looks"); };

  const wearsBtn = $("#detWears");
  if (wearsBtn && n) wearsBtn.onclick = () => openItemWears(i.id);

  body.querySelectorAll("[data-partner]").forEach(el => {
    el.onclick = () => openItem(el.dataset.partner);
  });

  const wxAdd = $("#detWxAdd"), wxEdit = $("#detWxEdit"), wxOk = $("#detWxOk");
  if (wxAdd) wxAdd.onclick = async () => {
    const f = wxFlagFor(i.id);
    if (!f) return;
    wxAdd.disabled = true;
    await addFlagSeason(i.id, f.missing);
    if (detailId === i.id && detailView === null) openItem(i.id);
  };
  if (wxEdit) wxEdit.onclick = () => openFieldEdit(i.id, "season");
  if (wxOk) wxOk.onclick = async () => {
    await dismissWxFlag(i.id);
    if (detailId === i.id && detailView === null) openItem(i.id);
  };

  $("#detCapsules").onclick = () => {
    openCapsuleAssign(capsulesForItem(i.id), async (ids) => {
      await saveItemCapsules(i.id, ids);
      if (detailId === id && detailView === "details") openItemDetails(id);
    });
  };

  // Notes auto-save (direct REST call so we skip the openItemDetails re-render)
  const ta = $("#detNotes");
  let noteTimer;
  ta.addEventListener("input", () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(async () => {
      const val = ta.value.trim() || null;
      const prev = i.notes;
      i.notes = val;
      try {
        await rest(`/items?id=eq.${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ notes: val }),
        });
      } catch (e) { i.notes = prev; toast(e.message); }
    }, 900);
  });

  // Attribute rows → field edit sheet
  body.querySelectorAll("[data-det-field]").forEach(btn => {
    btn.onclick = () => openFieldEdit(id, btn.dataset.detField);
  });
}

// "Worn on these days" — every distinct day this item was worn; tap a day to
// open it on the calendar. Multiple outfits on one day collapse to one row
// (dates are de-duped), matching the day-based wear count.
function openItemWears(id) {
  const i = items.find(x => x.id === id);
  if (!i) return;
  detailId = id; detailView = "wears";
  const dates = [...new Set(wears.filter(w => w.item_id === id && w.worn_on).map(w => w.worn_on))]
    .sort((a, b) => b.localeCompare(a));
  const rows = dates.map(d => {
    const cs = [...new Set(wears.filter(w => w.item_id === id && w.worn_on === d).flatMap(w => ctxArr(w)))];
    const dt = new Date(d + "T00:00:00");
    const dlabel = dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    const dow = dt.toLocaleDateString(undefined, { weekday: "long" });
    return `<button class="det-row" data-item-wear-date="${esc(d)}" style="align-items:center">
      <span style="flex:1;min-width:0">
        <span style="display:block">${esc(dlabel)}</span>
        <span style="display:block;color:var(--muted);font-size:12.5px;margin-top:2px">${esc(dow)}${cs.length ? ` · ${esc(cs.join(", "))}` : ""}</span>
      </span>
      <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
    </button>`;
  }).join("");
  const body = $("#closetBody");
  body.innerHTML = `
    <div class="cltoolbar">
      <button class="clback" id="clBack"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
      <div class="cltitle">Worn ${dates.length} day${dates.length === 1 ? "" : "s"}</div>
      <span style="width:34px"></span>
    </div>
    <div class="det-body">
      ${dates.length
        ? `<div class="det-card">${rows}</div><div class="center muted" style="font-size:12px;margin-top:8px">Tap a day to open it on the calendar.</div>`
        : `<div class="muted center" style="padding:30px">Never worn yet.</div>`}
    </div>`;
  $("#itemBar").hidden = true;
  scrollToTop();
}

// ---- Replace / add / remove an item's photo (reuses the add-item pipeline) ----
function pickItemPhoto(id) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = (e) => { const f = e.target.files[0]; if (f) replaceItemPhoto(id, f); };
  input.click();
}

async function replaceItemPhoto(id, file) {
  const i = items.find(x => x.id === id);
  if (!i) return;
  toast("Uploading photo…");
  try {
    const { blob, ext } = await compressImage(file);
    const filename = `${(crypto.randomUUID ? crypto.randomUUID() : Date.now())}.${ext}`;
    const path = await uploadPhoto(blob, filename);
    const old = i.image_path;
    await rest(`/items?id=eq.${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ image_path: path }),
    });
    i.image_path = path;
    if (old && old !== path) deletePhoto(old);  // fire-and-forget cleanup
    signedUrlBatch([path]);                     // pre-sign so the new photo renders immediately
    toast(old ? "Photo replaced" : "Photo added");
    if (detailId === id && detailView === "details") openItemDetails(id);
    else if (statsView === "review-deal" && reviewQueue[reviewIdx] === id) reviewAfterEdit();
  } catch (e) { toast(e.message); }
}

async function removeItemPhoto(id) {
  const i = items.find(x => x.id === id);
  if (!i || !i.image_path) return;
  if (!confirm("Remove this photo?")) return;
  const old = i.image_path;
  try {
    await rest(`/items?id=eq.${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ image_path: null }),
    });
    i.image_path = null;
    deletePhoto(old);
    toast("Photo removed");
    if (detailId === id && detailView === "details") openItemDetails(id);
  } catch (e) { toast(e.message); }
}

// ---- Save a single field to Supabase ----
async function saveField(id, field, value) {
  const i = items.find(x => x.id === id);
  if (!i) return;
  if (field === "name" && !value) { toast("Name can't be empty"); return; }
  const prev = i[field];
  i[field] = value; // optimistic
  const patch = { [field]: value };
  // An explicitly-entered purchase date is no longer a guess.
  if (field === "purchase_date") { i.date_is_guess = false; patch.date_is_guess = false; }
  // A re-dated wash retires any one-shot override, same as stampWash.
  if (field === "last_washed") { i.laundry_state = null; patch.laundry_state = null; }
  // Changing a piece's formality re-categorizes every look it's in (unless the
  // look has a manual override) — drop their cached buckets so they re-derive.
  if (field === "formality") {
    for (const o of outfits) if ((outfitItemMap.get(o.id) || []).includes(id)) o._bucket = null;
  }
  // The audit cache is stamped on array LENGTHS, which an in-place season edit
  // doesn't change — bust it explicitly or a fixed tag keeps its warning.
  if (field === "season") _wxAudit = null;
  // effectiveArchived() is memoised per look; a piece moving to or from Archive
  // silently changes the answer for every look containing it.
  if (field === "status") invalidateArchivedCache();
  try {
    await rest(`/items?id=eq.${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
    // refresh details/photo view if still open for this item
    if (detailId === id && detailView === "details") openItemDetails(id);
    else if (detailId === id && detailView === null) openItem(id);
  } catch (e) {
    i[field] = prev;
    toast(e.message);
  }
}

// ---- Field edit sheet ----
let _fieldEditId = null;
let _fieldEditKey = null;
let _fieldPending = undefined; // current pending value in sheet
let _fieldEditItem = null;    // the item object being edited (real item or _addState)
let _fieldOnSave = null;      // null = save to DB; fn(val) = custom save (used by Add form)

function openFieldEdit(id, field) {
  const cfg = FIELD_CONFIGS[field];
  if (!cfg) return;
  const i = items.find(x => x.id === id);
  if (!i) return;
  _fieldEditId = id;
  _fieldEditKey = field;
  _fieldPending = i[field];
  _fieldEditItem = i;
  _fieldOnSave = null;
  renderFieldSheet(i, field, cfg);
  showSheet("fieldSheet");
}

function closeFieldSheet() {
  hideSheet("fieldSheet");
  _fieldEditId = null;
  _fieldEditKey = null;
  _fieldPending = undefined;
  _fieldEditItem = null;
  _fieldOnSave = null;
}

function renderFieldSheet(i, field, cfg) {
  const curVal = _fieldPending !== undefined ? _fieldPending : i[field];
  // Per-field keyboard hints: URLs want the url keyboard + no autocorrect; proper
  // nouns (name/brand/retailer) capitalize words and skip autocorrect/spellcheck.
  const isUrl = field === "url";
  const capWords = field === "name" || field === "brand" || field === "retailer";
  const textAttrs = isUrl
    ? `type="url" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false"`
    : `type="text" inputmode="text" autocapitalize="${capWords ? "words" : "sentences"}" autocorrect="${capWords ? "off" : "on"}" spellcheck="${capWords ? "false" : "true"}"`;
  let content = "";
  if (cfg.type === "text" || cfg.type === "price") {
    const isPrice = cfg.type === "price";
    const attrs = isPrice ? `type="number" inputmode="decimal"` : textAttrs;
    content = `<div class="sheet-expand" style="border:none;background:var(--surface);padding:16px 18px">
      <input class="inp" id="fieldTextInp" ${attrs}
        value="${esc(curVal != null ? String(curVal) : "")}"
        placeholder="${esc(cfg.label)}…" style="width:100%;font-size:16px">
    </div>`;
  } else if (cfg.type === "date") {
    content = `<div class="sheet-expand" style="border:none;background:var(--surface);padding:16px 18px">
      <input class="inp" id="fieldTextInp" type="date" max="${todayStr()}"
        value="${esc(curVal != null ? String(curVal).slice(0, 10) : "")}" style="width:100%;font-size:16px">
    </div>`;
  } else if (cfg.type === "typeahead") {
    const suggestions = distinctByFreq(field);  // most-used first
    const suggestHtml = suggestions.length
      ? `<div class="fld-sugg-lbl">Previously entered</div>
         <div class="fld-suggestions">${suggestions.map(s =>
           `<button class="sheet-chip${s === curVal ? " on" : ""}" data-fv="${esc(s)}">${esc(s)}</button>`).join("")}</div>`
      : "";
    content = `<div class="sheet-expand" style="border:none;background:var(--surface);padding:16px 18px">
      <input class="inp" id="fieldTextInp" ${textAttrs}
        value="${esc(curVal != null ? String(curVal) : "")}"
        placeholder="${esc(cfg.label)}…" style="width:100%;font-size:16px">
    </div>${suggestHtml}`;
  } else if (cfg.type === "color") {
    const chips = cfg.opts.map(o => {
      const on = curVal === o;
      const hex = colorHex(o);
      return `<button class="fld-color-chip${on ? " on" : ""}" data-fv="${esc(o)}" title="${esc(o)}"
        style="background:${hex};${on ? "outline:3px solid var(--accent);outline-offset:2px;" : ""}">
        ${on ? `<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:#fffdfb;stroke-width:3;fill:none"><path d="M5 12l5 5L19 7"/></svg>` : ""}
      </button>`;
    }).join("");
    content = `<div style="padding:16px 18px"><div class="fld-color-grid">${chips}</div></div>`;
  } else if (cfg.type === "formality") {
    const sel = Array.isArray(curVal) ? curVal : (curVal ? [+curVal] : []);
    const chips = OCCASION_LADDER.map((lbl, idx) => {
      const lvl = idx + 1, on = sel.includes(lvl);
      return `<button class="sheet-chip${on ? " on" : ""}" data-fv="${lvl}" style="text-align:left">
        <span style="font-weight:500">${lvl}. ${esc(lbl)}</span>
        <span style="font-size:11px;color:var(--muted);display:block;margin-top:1px">${esc(OCCASION_HINTS[idx])}</span>
      </button>`;
    }).join("");
    content = `<div class="sheet-expand" style="border:none"><div class="sheet-chips" style="flex-direction:column;align-items:stretch;gap:6px">${chips}</div></div>`;
  } else {
    // single or multi chips
    const isMulti = cfg.type === "multi";
    const selected = isMulti ? (Array.isArray(curVal) ? curVal : []) : (curVal ? [curVal] : []);
    const chips = cfg.opts.map(o => {
      const on = selected.includes(o);
      return `<button class="sheet-chip${on ? " on" : ""}" data-fv="${esc(o)}">${esc(o)}</button>`;
    }).join("");
    const filterHtml = (isMulti && cfg.filter)
      ? `<div style="padding:12px 18px 4px"><input id="multiFilter" class="inp" placeholder="Filter…" style="width:100%;font-size:15px"></div>`
      : "";
    content = `${filterHtml}<div class="sheet-expand" style="border:none"><div class="sheet-chips">${chips}</div></div>`;
  }

  const hasVal = curVal != null && curVal !== "" && !(Array.isArray(curVal) && curVal.length === 0);

  $("#fieldInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="fldCancel">Cancel</button>
      <h2>${esc(cfg.label)}</h2>
      <button class="lnk" id="fldSave" style="font-weight:700">Save</button>
    </div>
    ${content}
    ${hasVal ? `<div style="padding:0 18px 8px"><button class="lnk" id="fldClear" style="color:var(--danger);font-size:14px">Clear</button></div>` : ""}
  `;

  // wire cancel
  $("#fldCancel").onclick = closeFieldSheet;

  // wire save — respects _fieldOnSave for Add form
  $("#fldSave").onclick = async () => {
    let val = _fieldPending;
    if (cfg.type === "text" || cfg.type === "price" || cfg.type === "typeahead" || cfg.type === "date") {
      const inp = $("#fieldTextInp");
      val = inp ? (cfg.type === "price" ? (inp.value ? parseFloat(inp.value) : null) : (inp.value.trim() || null)) : val;
    }
    if (_fieldEditKey === "name" && !val) { toast("Name can't be empty"); return; }
    if (_fieldOnSave) { _fieldOnSave(val); closeFieldSheet(); }
    else { await saveField(_fieldEditId, _fieldEditKey, val); closeFieldSheet(); }
  };

  // wire clear
  const clearBtn = $("#fldClear");
  if (clearBtn) {
    clearBtn.onclick = async () => {
      const cleared = Array.isArray(curVal) ? [] : null;
      if (_fieldOnSave) { _fieldOnSave(cleared); closeFieldSheet(); }
      else { await saveField(_fieldEditId, _fieldEditKey, cleared); closeFieldSheet(); }
    };
  }

  // text / typeahead input live update + suggestion filtering
  const ti = $("#fieldTextInp");
  if (ti) {
    ti.oninput = () => {
      _fieldPending = ti.value;
      if (cfg.type === "typeahead") {
        const q = ti.value.trim().toLowerCase();
        $("#fieldInner").querySelectorAll(".fld-suggestions .sheet-chip").forEach(chip => {
          chip.hidden = q.length > 0 && !chip.textContent.toLowerCase().includes(q);
        });
      }
    };
    setTimeout(() => ti.focus(), 80);
  }

  // multi filter input (e.g. fabric)
  const mf = $("#multiFilter");
  if (mf) {
    mf.oninput = () => {
      const q = mf.value.trim().toLowerCase();
      $("#fieldInner").querySelectorAll(".sheet-chips .sheet-chip").forEach(chip => {
        chip.hidden = q.length > 0 && !chip.textContent.toLowerCase().includes(q);
      });
    };
    setTimeout(() => mf.focus(), 80);
  }

  // chip clicks
  $("#fieldInner").querySelectorAll("[data-fv]").forEach(btn => {
    btn.onclick = () => {
      const v = btn.dataset.fv;
      if (cfg.type === "typeahead") {
        // fill text input + highlight the chosen chip; don't re-render
        _fieldPending = v;
        const inp = $("#fieldTextInp");
        if (inp) inp.value = v;
        $("#fieldInner").querySelectorAll(".fld-suggestions .sheet-chip")
          .forEach(c => c.classList.toggle("on", c.dataset.fv === v));
        return;
      }
      if (cfg.type === "formality") {
        const n = +v;
        const cur = Array.isArray(_fieldPending) ? _fieldPending : (_fieldPending ? [+_fieldPending] : []);
        _fieldPending = cur.includes(n) ? cur.filter(x => x !== n) : [...cur, n].sort((a, b) => a - b);
      } else if (cfg.type === "multi") {
        const cur = Array.isArray(_fieldPending) ? _fieldPending : (Array.isArray((i || {})[field]) ? [...(i || {})[field]] : []);
        _fieldPending = cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v];
      } else if (cfg.type === "color" || cfg.type === "single") {
        _fieldPending = (_fieldPending === v) ? null : v;
      }
      renderFieldSheet(_fieldEditItem, _fieldEditKey, cfg);
    };
  });
}

// ---- Delete single item ----
async function deleteItem(id) {
  /* ⚠️ SAY WHAT IS ACTUALLY LOST. `wears.item_id` is ON DELETE CASCADE, so this
     permanently deletes every wear ever logged for the piece — and the app used
     to ask "this cannot be undone" without ever mentioning that. The data is
     the irreplaceable asset (2026-07-18); a generic confirm was not enough. */
  const im = (typeof deleteImpact === "function") ? deleteImpact(id) : null;
  const parts = ["Delete this item? This cannot be undone."];
  if (im) {
    if (im.wearDays) parts.push(`\n• ${im.wearDays} logged wear${im.wearDays === 1 ? "" : "s"} will be deleted with it${im.firstWorn ? `, back to ${fmtDate(im.firstWorn)}` : ""}.`);
    if (im.soloDays) parts.push(`• ${im.soloDays} calendar day${im.soloDays === 1 ? "" : "s"} will go blank.`);
    if (im.breaks) parts.push(`• ${im.breaks} look${im.breaks === 1 ? "" : "s"} will drop below two pieces.`);
    const crossing = im.gaps && im.gaps.hits.find(h => h.crosses);
    if (crossing) parts.push(`• ${crossing.ctx} would drop to ${crossing.to} ${String(crossing.slot).toLowerCase()} at ${occLabel(crossing.lvl)}.`);
    else if (im.gaps && im.gaps.unique) parts.push(`• Nothing else in your closet covers the same slot at the same levels.`);
    if (im.wearDays || im.looks) parts.push(`\nStorage keeps all of it and still takes the piece out of your closet.`);
  }
  if (!confirm(parts.join("\n"))) return;
  try {
    await rest(`/items?id=eq.${id}`, { method: "DELETE" });
    items = items.filter(i => i.id !== id);
    detailId = null; detailView = null;
    $("#itemBar").hidden = true;
    renderCloset();
    toast("Item deleted");
  } catch (e) { toast(e.message); }
}

// ---- Move single item (reuses move sheet with a single-item override) ----
let _moveItemId = null;

function openItemMoveSheet(id) {
  _moveItemId = id;
  selectedIds = new Set([id]);
  moveCatOpen = null;
  renderMoveSheet();
  showSheet("moveSheet");
}

function openQuickActions(id) {
  const i = items.find(x => x.id === id);
  if (!i) return;
  $("#qaTitle").textContent = i.name || "Untitled";
  $("#qaLog").onclick  = () => { hideSheet("quickActSheet"); logWearToday(id); };
  $("#qaLogDate").onclick = () => { hideSheet("quickActSheet"); openLogWear(id); };
  $("#qaLook").onclick = () => { hideSheet("quickActSheet"); openBuilder(null, id); };
  $("#qaMove").onclick = () => { hideSheet("quickActSheet"); openItemMoveSheet(id); };
  showSheet("quickActSheet");
}
$("#qaSheetBg").addEventListener("click", () => { hideSheet("quickActSheet"); });
$("#qaCancel").addEventListener("click",  () => { hideSheet("quickActSheet"); });

// ---- Contexts (wears.context — text[], multi-select) ----
// Tolerant accessor: returns an array whether context is null, a string (legacy /
// pre-migration), or an array (post-migration).
const ctxArr = (w) => !w || !w.context ? [] : (Array.isArray(w.context) ? w.context : [w.context]);

// A WEAR IS A DAY, app-wide. One outfit logged on one day writes one wear row
// per piece, so any count that tallies rows reads a 5-piece look as 5 wears —
// and a context stamped on that look as 5 outings. Every "N wears" number goes
// through here (or a Set of worn_on): keyFn returns the keys a row contributes
// to, and each key counts a given worn_on at most once. Keys are user text
// (context names), so the composite separator is a NUL — nothing typeable.
function countByDay(rows, keyFn) {
  const counts = new Map(), seen = new Set();
  for (const w of rows) {
    if (!w.worn_on) continue;
    for (const k of keyFn(w)) {
      const dk = k + "\u0000" + w.worn_on;
      if (seen.has(dk)) continue;
      seen.add(dk);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  return counts;
}

// Seed list + any custom contexts the user has already logged (derive-first).
function contextOptions() {
  // Most-used first (never-used seeds trail, alphabetical among ties).
  const counts = countByDay(wears, ctxArr);
  for (const c of CONTEXT_SEED) if (!counts.has(c)) counts.set(c, 0);
  /* Contexts she's PLANNED but not yet worn count too (2026-07-30). Without
     this, a context invented in the day-plan editor vanished from every other
     day's chip list until she'd logged a wear with it — so "create a new
     context" only half worked. Derive-first, still nothing stored. */
  for (const entries of Object.values(dayPlanAll())) {
    for (const e of (entries || [])) {
      for (const c of (e.contexts || [])) if (c && !counts.has(c)) counts.set(c, 0);
    }
  }
  return [...counts.keys()].sort((a, b) => (counts.get(b) - counts.get(a)) || a.localeCompare(b));
}

// Distinct contexts an item has been worn for, with counts (most-worn first).
function itemContexts(itemId) {
  const counts = countByDay(wears, w => w.item_id === itemId ? ctxArr(w) : []);
  return [...counts.entries()].map(([ctx, count]) => ({ ctx, count }))
    .sort((a, b) => b.count - a.count);
}

const dayDiff = (a, b) =>
  Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);

/* ---- Item rhythm + partners (2026-07-21) ----
   Both derived, nothing stored. The signal is same-DAY co-wear, not shared look
   membership: what actually left the closet together beats what got saved. */

// "Usually worn with" — top partners by distinct days worn alongside this item.
// PARTNER_MIN_DAYS keeps a single memorable outfit from reading as a habit.
const PARTNER_MIN_DAYS = 2;
function itemPartners(itemId, limit = 3, wearRows = null) {
  const ws = wearRows || wears;
  const days = new Set();
  for (const w of ws) if (w.item_id === itemId && w.worn_on) days.add(w.worn_on);
  if (!days.size) return [];
  const seen = new Set(), counts = new Map();
  for (const w of ws) {
    if (w.item_id === itemId || !w.worn_on || !days.has(w.worn_on)) continue;
    const k = w.item_id + "|" + w.worn_on;
    if (seen.has(k)) continue;
    seen.add(k);
    counts.set(w.item_id, (counts.get(w.item_id) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= PARTNER_MIN_DAYS)
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([id, days]) => ({ id, days }));
}

// Wear cadence: how often a piece actually comes back around, and the longest
// it ever sat. Needs 3+ wear days — two wears give one gap, which is noise.
function wearRhythm(itemId, wearRows = null) {
  const ws = wearRows || wears;
  const ds = [...new Set(ws.filter(w => w.item_id === itemId && w.worn_on).map(w => w.worn_on))].sort();
  if (ds.length < 3) return null;
  const gaps = [];
  for (let k = 1; k < ds.length; k++) gaps.push(dayDiff(ds[k - 1], ds[k]));
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return { avg: Math.round(avg), longest: Math.max(...gaps), wearDays: ds.length };
}

// Rotation: the share of the wearable closet that actually came out in a
// trailing window. One number for "am I wearing what I own".
const ROTATION_WINDOWS = [30, 90, 365];
function buildRotationStats(days = 90, pool = null, wearRows = null, today = null) {
  const t = today || todayStr();
  const cutoff = localISO(new Date(new Date(t + "T00:00:00").getTime() - days * 86400000));
  const active = (pool || items).filter(i => itemStatus(i) === "Available");
  const ids = new Set(active.map(i => i.id));
  // counts = wear DAYS per piece inside the window; its keys are the worn set.
  const counts = countByDay(wearRows || wears, w =>
    w.worn_on > cutoff && w.worn_on <= t && ids.has(w.item_id) ? [w.item_id] : []);
  const worn = new Set(counts.keys());
  // pool/wornIds/counts ride along so the drill-in page can show WHICH pieces
  // without re-deriving the window (and drifting from the headline number).
  return { days, total: active.length, worn: worn.size, pool: active, wornIds: worn, counts,
           pct: active.length ? Math.round(worn.size / active.length * 100) : 0 };
}

// V3: her weekly rhythm predicts the context ("Sundays are usually Church").
// Top context for the date's weekday, counted in distinct DAYS (so a 5-piece
// look doesn't count 5×); needs ≥3 days to trust. Suggestion only — never saved.
/* ---- WEEKLY RHYTHM (Round C, 2026-07-25) ----------------------------------
   She has a real weekly shape — chorus, church, campus — and the app could
   already see it: `weekdayTopContext` derived exactly this and was used in
   exactly ONE place, a single chip in the post-log sheet. Meanwhile the week
   planner rendered seven blank rows, and blank-slate planners get abandoned.
   Same ≥3-distinct-days floor as before: under it, show nothing rather than
   noise. Nothing here ever writes — accepting a guess is always a tap. */
const RHYTHM_MIN_DAYS = 3;
const RHYTHM_MAX_CTX = 2;
const WEEKDAY_PLURAL = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function weeklyRhythm(wearRows = null) {
  const ws = wearRows || wears;
  const byDow = [0, 1, 2, 3, 4, 5, 6].map(() => new Map());   // dow → ctx → Set(dates)
  for (const w of ws) {
    if (!w.worn_on) continue;
    const cs = ctxArr(w);
    if (!cs.length) continue;
    const m = byDow[new Date(w.worn_on + "T00:00:00").getDay()];
    for (const c of cs) { if (!m.has(c)) m.set(c, new Set()); m.get(c).add(w.worn_on); }
  }
  const out = new Map();
  byDow.forEach((m, dow) => {
    const ranked = [...m.entries()].map(([ctx, s]) => ({ ctx, n: s.size }))
      .filter(r => r.n >= RHYTHM_MIN_DAYS)
      .sort((a, b) => b.n - a.n || a.ctx.localeCompare(b.ctx))
      .slice(0, RHYTHM_MAX_CTX);
    if (ranked.length) out.set(dow, { contexts: ranked.map(r => r.ctx), n: ranked[0].n });
  });
  return out;
}
function rhythmFor(dateStr, rhythm = null) {
  return (rhythm || weeklyRhythm()).get(new Date(dateStr + "T00:00:00").getDay()) || null;
}

function weekdayTopContext(dateStr) {
  const r = rhythmFor(dateStr);
  if (!r) return null;
  return { ctx: r.contexts[0], label: `usual for ${WEEKDAY_PLURAL[new Date(dateStr + "T00:00:00").getDay()]}` };
}

// Reusable multi-select context picker for log sheets. Reads/writes the module-global
// `_ctxSel` (array of chosen contexts). Self-re-renders into #ctxPicker so the rest of
// the surrounding sheet (e.g. the date input) is untouched.
let _ctxSel = [];
let _ctxAddOpen = false;  // whether the "+ Add…" typeahead input is expanded
let _ctxSuggest = null;   // {ctx,label} weekday-based suggestion (post-log sheet only)
let _logItemId = null;  // item being logged, for context-chip ordering (A2)
function contextPickerHtml() { return `<div id="ctxPicker" style="margin-top:18px"></div>`; }
function renderContextPicker() {
  const wrap = $("#ctxPicker");
  if (!wrap) return;
  let opts = contextOptions();
  // Sort this item's most-frequently-used contexts to the top (A2)
  if (_logItemId) {
    const freq = new Map(itemContexts(_logItemId).map(({ctx, count}) => [ctx, count]));
    opts = [...opts].sort((a, b) => (freq.get(b) || 0) - (freq.get(a) || 0));
  }
  const extra = _ctxSel.filter(c => !opts.includes(c));   // custom added this session
  const all = [...opts, ...extra];
  // V3 weekday suggestion: one pre-offered chip, one tap to confirm; disappears
  // once picked (it's then just a selected chip below).
  const sug = _ctxSuggest && !_ctxSel.includes(_ctxSuggest.ctx)
    ? `<button class="sheet-chip" data-ctx-sug="${esc(_ctxSuggest.ctx)}" style="border-color:var(--accent);color:var(--accent);margin-bottom:8px">✨ ${esc(_ctxSuggest.ctx)} <span style="opacity:.65;font-weight:400">· ${esc(_ctxSuggest.label)}</span></button>`
    : "";
  wrap.innerHTML = `
    <label style="display:block;font-size:13px;color:var(--muted);margin-bottom:8px">Context <span style="opacity:.6">(optional · choose any that apply)</span></label>
    ${sug}
    <div class="sheet-chips" style="margin-bottom:8px">
      ${all.map(c => `<button class="sheet-chip${_ctxSel.includes(c) ? " on" : ""}" data-ctx="${esc(c)}">${esc(c)}</button>`).join("")}
      <button class="sheet-chip" data-ctx-add="1">+ Add…</button>
    </div>
    <div id="ctxOtherWrap" style="display:${_ctxAddOpen ? "flex" : "none"};flex-direction:column;gap:8px;margin-top:6px">
      <div style="display:flex;gap:8px">
        <input class="inp" id="ctxOther" placeholder="Type to find or add a context…" style="flex:1;font-size:15px" autocomplete="off">
        <button class="lnk" id="ctxOtherAdd" style="font-weight:700;flex:none">Add</button>
      </div>
      <div id="ctxSuggest" class="ctx-typeahead"></div>
    </div>`;
  wrap.querySelectorAll("[data-ctx]").forEach(b => b.onclick = () => {
    const v = b.dataset.ctx;
    _ctxSel = _ctxSel.includes(v) ? _ctxSel.filter(x => x !== v) : [..._ctxSel, v];
    _ctxAddOpen = false;
    renderContextPicker();
  });
  const sugBtn = wrap.querySelector("[data-ctx-sug]");
  if (sugBtn) sugBtn.onclick = () => {
    _ctxSel = [..._ctxSel, sugBtn.dataset.ctxSug];
    renderContextPicker();
  };
  const addBtn = wrap.querySelector("[data-ctx-add]");
  if (addBtn) addBtn.onclick = () => {
    _ctxAddOpen = true;
    const ow = wrap.querySelector("#ctxOtherWrap");
    ow.style.display = "flex";
    wrap.querySelector("#ctxOther").focus();
  };
  // Live typeahead: filter known contexts as the user types; tap to pick or create.
  const renderSuggest = (q) => {
    const box = wrap.querySelector("#ctxSuggest");
    if (!box) return;
    const ql = q.trim().toLowerCase();
    if (!ql) { box.innerHTML = ""; return; }
    const matches = contextOptions().filter(c => !_ctxSel.includes(c) && c.toLowerCase().includes(ql)).slice(0, 6);
    const exact = contextOptions().some(c => c.toLowerCase() === ql) || _ctxSel.some(c => c.toLowerCase() === ql);
    box.innerHTML = matches.map(c => `<button class="ctx-ta-row" data-ctx-pick="${esc(c)}">${esc(c)}</button>`).join("")
      + (!exact ? `<button class="ctx-ta-row ctx-ta-new" data-ctx-new="${esc(q.trim())}">+ Create “${esc(q.trim())}”</button>` : "");
    box.querySelectorAll("[data-ctx-pick]").forEach(b => b.onclick = () => {
      _ctxSel.push(b.dataset.ctxPick); _ctxAddOpen = false; renderContextPicker();
    });
    const nb = box.querySelector("[data-ctx-new]");
    if (nb) nb.onclick = () => {
      const v = nb.dataset.ctxNew;
      if (v && !_ctxSel.includes(v)) _ctxSel.push(v);
      _ctxAddOpen = false; renderContextPicker();
    };
  };
  const commit = () => {
    const inp = wrap.querySelector("#ctxOther");
    const v = (inp.value || "").trim();
    if (v && !_ctxSel.includes(v)) _ctxSel.push(v);
    _ctxAddOpen = false;
    renderContextPicker();
  };
  const otherAdd = wrap.querySelector("#ctxOtherAdd");
  if (otherAdd) otherAdd.onclick = commit;
  const inp = wrap.querySelector("#ctxOther");
  if (inp) {
    inp.oninput = () => renderSuggest(inp.value);
    inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } };
    if (_ctxAddOpen) inp.focus();
  }
}
const ctxSelOrNull = () => _ctxSel.length ? _ctxSel : null;

// ---- One-tap wear today (A1): POST immediately, then offer context + formality ----
// D2 soft dup-wear guard: if this item already has a wear logged today, don't
// silently double-log — ask first. "Log again →" bypasses the guard for the
// (rare, legit) case of wearing the same piece twice in a day.
async function logWearToday(id, { force = false } = {}) {
  const today = todayStr();
  if (!force && wears.some(w => w.item_id === id && w.worn_on === today)) {
    toast("Already logged today", { label: "Log again →", fn: () => logWearToday(id, { force: true }) });
    return;
  }
  try {
    const fml = deriveWearFormality([id]);
    const wctx = tripWearContext(today);  // trip mode: auto-stamp "Travel"
    const rows = await rest("/wears", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ item_id: id, worn_on: today, formality_for: fml, ...(wctx ? { context: wctx } : {}) }),
    });
    const wear = Array.isArray(rows) && rows[0]
      ? rows[0]
      : { id: null, item_id: id, worn_on: today, outfit_id: null, context: wctx || null, formality_for: fml };
    wears.push(wear);
    const chips = [
      { label: "Undo", fn: () => undoLoggedWears([wear]) },
      { label: "Add context →", fn: () => openPostLogSheet([wear]) },
    ];
    const miss = tripMissingPieces([id]);
    if (miss) chips.push({ label: `＋ ${miss.c.name}`, fn: async () => { await addItemsToCapsule(miss.c.id, miss.missing); toast(`Added to ${miss.c.name}`); } });
    // E4: the photo view's stat strip (wear count / last worn) must not go stale
    if (detailId && detailView !== "details") openItem(detailId);
    toast(logCelebration([wear]) || "Wear logged", chips);
  } catch (e) { toast(e.message); }
}

// G3: shared undo for one-tap logging — DELETE the created wear row(s), splice
// from local state, and re-render whatever's currently visible so it doesn't
// look logged anymore.
async function undoLoggedWears(rows) {
  const ids = rows.map(w => w.id).filter(Boolean);
  try {
    if (ids.length) await rest(`wears?id=in.(${ids.map(id => `"${id}"`).join(",")})`, { method: "DELETE" });
    wears = wears.filter(w => !rows.includes(w));
    unmarkLastMilestone();   // an undone log shouldn't spend a once-ever milestone
    toast("Undone");
    const activeScreen = $(".screen.active")?.id;
    if (activeScreen === "tab-calendar" && calendarDay) renderCalendarDay($("#calendarBody"));
    else if (activeScreen === "tab-home") renderHome();
    else if (detailId && detailView !== "details") openItem(detailId);
  } catch (e) { toast(e.message); }
}

/* ---- MILESTONES (Round C, 2026-07-25) -------------------------------------
   Logging is the behaviour every stat in this app is downstream of, and the log
   moment is the only second that can pay it back. It used to say "Wear logged"
   on the seven-hundredth repetition. Now, occasionally, it says something true
   and specific instead.

   Deliberately capped from day one: ONE per log, and each key fires ONCE EVER
   (seen-set in kv). Delight that repeats stops being delight, and a cap
   retrofitted later would mean rewriting the keys. */
const MILESTONE_ROUNDS = [10, 25, 50, 100];
const MILESTONE_RESCUE_DAYS = 180;
const MILESTONES_KEY = "milestones";
const BEST_STREAK_KEY = "beststreak";
let _pendingMilestone = null;

const milestoneSeen = key => !!(kvData.get(MILESTONES_KEY) || {})[key];
function markMilestone(key) {
  // Once-ever rungs: a milestone earned on the other device must not be undone
  // by this write (see kvUpdate).
  kvUpdate(MILESTONES_KEY, prev => ({ ...(prev || {}), [key]: todayStr() }));  // fire-and-forget
}

// Rows are already in `wears` by the time this runs (every call site pushes
// first), so wearCount() includes the wear being celebrated.
function milestoneFor(rows) {
  if (!rows || !rows.length) return null;
  const date = rows[0].worn_on || todayStr();
  const its = [...new Set(rows.map(r => r.item_id))].map(id => itemById.get(id)).filter(Boolean);
  const nm = i => i.name || "that piece";
  const pick = (key, text) => milestoneSeen(key) ? null : { key, text };
  let hit = null;

  // 1. first time out
  for (const i of its) {
    if (wearCount(i.id) !== 1) continue;
    hit = pick(`first:${i.id}`, `✨ First outing for the ${nm(i)}.`);
    if (hit) return hit;
  }
  // 2. paid off — crossed under a dollar a wear with THIS wear
  for (const i of its) {
    if (i.price == null || i.acquisition === "Gift") continue;
    const n = wearCount(i.id);
    if (n < 2 || i.price / n > 1 || i.price / (n - 1) <= 1) continue;
    hit = pick(`paidoff:${i.id}`, `💸 The ${nm(i)} just went under $1 a wear.`);
    if (hit) return hit;
  }
  // 3. rescued from the back of the closet
  for (const i of its) {
    const prev = [...new Set(wears.filter(w => w.item_id === i.id && w.worn_on && w.worn_on < date).map(w => w.worn_on))].sort().pop();
    if (!prev || dayDiff(prev, date) < MILESTONE_RESCUE_DAYS) continue;
    hit = pick(`rescued:${i.id}:${date}`, `👋 The ${nm(i)}, back after ${humanGap(dayDiff(prev, date))}.`);
    if (hit) return hit;
  }
  // 4. round numbers
  for (const i of its) {
    const n = wearCount(i.id);
    if (!MILESTONE_ROUNDS.includes(n)) continue;
    hit = pick(`round:${i.id}:${n}`, `🎉 That's the ${nm(i)}'s ${n}th day out.`);
    if (hit) return hit;
  }
  // 5. the whole shoe rack, in one year
  if (its.some(i => i.category === "Shoes")) {
    const year = date.slice(0, 4);
    const shoes = items.filter(i => i.category === "Shoes" && itemStatus(i) === "Available");
    const wornThisYear = new Set(wears.filter(w => (w.worn_on || "").startsWith(year)).map(w => w.item_id));
    if (shoes.length >= 3 && shoes.every(i => wornThisYear.has(i.id))) {
      hit = pick(`completeset:shoes:${year}`, `👟 You've worn every pair of shoes you own this year.`);
      if (hit) return hit;
    }
  }
  // 6. a new personal best for logging
  const streak = calStreak();
  const best = kvData.get(BEST_STREAK_KEY) || 0;
  if (streak > best && streak >= 5) {
    kvUpdate(BEST_STREAK_KEY, prev => Math.max(+prev || 0, streak));
    hit = pick(`streak:${streak}`, `🔥 Longest logging streak yet — ${streak} days.`);
    if (hit) return hit;
  }
  return null;
}

// Compute + commit. Sites that raise their own toast use the return value;
// sites that hand off to the post-log sheet pass `defer` and let close() flush,
// so a toast never ends up underneath an open sheet.
function logCelebration(rows, { defer = false } = {}) {
  let m = null;
  try { m = milestoneFor(rows); } catch (e) { return null; }   // never break a log
  if (!m) return null;
  markMilestone(m.key);
  _lastMilestoneKey = m.key;   // so an Undo doesn't burn "first outing" forever
  if (defer) { _pendingMilestone = m.text; return null; }
  return m.text;
}
function flushMilestone() { const t = _pendingMilestone; _pendingMilestone = null; return t; }
let _lastMilestoneKey = null;
function unmarkLastMilestone() {
  if (!_lastMilestoneKey) return;
  const undo = _lastMilestoneKey;
  _lastMilestoneKey = null;
  kvUpdate(MILESTONES_KEY, prev => { const m = { ...(prev || {}) }; delete m[undo]; return m; });
}

// ---- Post-log sheet: context capture (A2) ----
// L2b: this is the user's PRIMARY hearting moment (she hearts looks when wearing
// them, not while browsing) — show a heart row whenever the logged wears share
// an outfit_id. The tap saves immediately (not gated on Save/Skip), same as the
// canvas heart, since a heart is its own complete action.
// V3: formality is no longer asked here — it's derived at log time
// (deriveWearFormality); the look's formality edit is the manual override.
// `undoable` shows an Undo toast when the sheet closes (look logs).
function openPostLogSheet(wearRows, { presetCtx, undoable = false } = {}) {
  _logItemId = wearRows.length === 1 ? wearRows[0].item_id : null;
  _ctxSel = presetCtx && presetCtx.length ? [...presetCtx] : []; _ctxAddOpen = false;
  // Trip mode: "Travel" arrives pre-selected (the POST already stamped it) —
  // visible and un-tappable, composing with whatever else she picks.
  const _twc = tripWearContext(wearRows[0]?.worn_on || todayStr());
  if (_twc && !_ctxSel.includes(TRIP_CONTEXT)) _ctxSel.push(TRIP_CONTEXT);
  _ctxSuggest = weekdayTopContext(wearRows[0]?.worn_on || todayStr());
  const oid = wearRows.length && wearRows.every(r => r.outfit_id && r.outfit_id === wearRows[0].outfit_id)
    ? wearRows[0].outfit_id : null;
  const o = oid ? outfitById.get(oid) : null;

  /* The payoff block (2026-08-03). Her ask was "a screen on that wear"; she
     chose to have it REPLACE this sheet, and the way that doesn't cost taps is
     for it to BE this sheet — the deltas sit above the context chips, the
     header and the heart are untouched, and logging is still two taps. */
  const _wd = buildWearDelta(wearRows);

  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="postLogCancel">Skip</button>
      <h2>${_wd ? "What this changed" : "Add context"}</h2>
      <button class="lnk" id="postLogSave" style="font-weight:700">Save</button>
    </div>
    <div style="padding:14px 18px 30px">
      ${wearDetailHtml(_wd, { live: true })}
      ${o ? `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <label style="font-size:13px;color:var(--muted)">Loved wearing this look?</label>
        <button class="lk-heart-btn${o.rating === 1 ? " on" : ""}" id="postLikeBtn"><svg viewBox="0 0 24 24" style="width:26px;height:26px;stroke:currentColor;stroke-width:1.8;fill:none">${HEART_SVG}</svg></button>
      </div>` : ""}
      ${(() => {
        // Trip mode: worn pieces that aren't packed → one-tap add to the capsule.
        const miss = tripMissingPieces(wearRows.map(r => r.item_id));
        if (!miss) return "";
        return `<div id="postTripRow" style="display:flex;align-items:center;gap:8px;margin-bottom:16px;padding:10px 12px;background:var(--accent-soft);border-radius:12px;font-size:13.5px">
          <span style="flex:1">✈️ ${miss.missing.length === 1 ? "1 piece isn't" : miss.missing.length + " pieces aren't"} in ${esc(miss.c.name)}</span>
          <button id="postTripAdd" style="color:var(--accent);font-weight:700">Add</button>
        </div>`;
      })()}
      ${contextPickerHtml()}
    </div>`;
  showSheet("logSheet");
  renderContextPicker();
  hydratePhotos($("#logInner"));
  // A piece row opens the item — the sheet's own context/heart state is already
  // saved on tap, so leaving it is safe.
  wireWearDetail($("#logInner"), { onLeave: () => hideSheet("logSheet") });
  const tripAdd = $("#postTripAdd");
  if (tripAdd) tripAdd.onclick = async () => {
    const miss = tripMissingPieces(wearRows.map(r => r.item_id));
    if (!miss) return;
    try {
      await addItemsToCapsule(miss.c.id, miss.missing);
      const row = $("#postTripRow");
      if (row) row.innerHTML = `<span style="flex:1">✓ Added to ${esc(miss.c.name)}</span>`;
    } catch (e) { toast(e.message); }
  };
  if (o) {
    $("#postLikeBtn").onclick = () => {
      toggleLikeLook(oid).then(r => { const btn = $("#postLikeBtn"); if (btn) btn.classList.toggle("on", r === 1); });
    };
  }

  const close = () => {
    hideSheet("logSheet"); _logItemId = null; _ctxSuggest = null;
    // A1 fix (2026-07-18, user-reported "set context twice"): this sheet saved
    // context/hearts fine but never redrew the screen underneath, so the
    // calendar day card (and Home's logged-row) kept showing stale state.
    const scr = $(".screen.active")?.id;
    if (scr === "tab-calendar" && calendarDay) renderCalendarDay($("#calendarBody"));
    else if (scr === "tab-home") renderHome();
    // A milestone earned by this log rides out on the close toast — it replaces
    // the flat "Logged ✓" but never the Undo chip.
    const cel = flushMilestone();
    if (undoable) toast(cel || "Logged ✓", { label: "Undo", fn: () => undoLoggedWears(wearRows) });
    else if (cel) toast(cel);
  };
  $("#postLogCancel").onclick = close;
  $("#postLogSave").onclick = async () => {
    const ctx = ctxSelOrNull();
    if (ctx) {
      const patchable = wearRows.filter(r => r.id);
      if (patchable.length) {
        try {
          await Promise.all(patchable.map(r =>
            rest(`/wears?id=eq.${r.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ context: ctx }),
            })
          ));
          patchable.forEach(r => { r.context = ctx; });
          invalidateContextCache();
        } catch (_) { /* wear already logged — context is best-effort */ }
      }
    }
    close();
  };
}

// ---- Log wear (with date picker, for back-dating) ----
function openLogWear(id) {
  _logItemId = id;
  const today = todayStr();
  _ctxSel = []; _ctxAddOpen = false; _ctxSuggest = null;
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="logCancel">Cancel</button>
      <h2>Log Wear</h2>
      <button class="lnk" id="logSave" style="font-weight:700">Log</button>
    </div>
    <div style="padding:20px 18px 30px">
      <label style="display:block;font-size:13px;color:var(--muted);margin-bottom:8px">Date worn</label>
      <input class="inp" id="logDate" type="date" value="${today}" max="${today}" style="width:100%;font-size:16px">
      ${contextPickerHtml()}
    </div>
  `;
  showSheet("logSheet");
  renderContextPicker();
  $("#logCancel").onclick = () => { hideSheet("logSheet"); };
  $("#logSave").onclick = async () => {
    const date = $("#logDate").value;
    if (!date) return;
    const ctx = ctxSelOrNull();
    try {
      const row = await rest("/wears", {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({ item_id: id, worn_on: date, context: ctx, formality_for: deriveWearFormality([id]) }),
      });
      const pushed = Array.isArray(row) && row[0] ? row[0]
        : { item_id: id, worn_on: date, outfit_id: null, context: ctx };
      wears.push(pushed);
      hideSheet("logSheet");
      // E4: redraw whatever the sheet was covering (same staleness class as A1)
      const scr = $(".screen.active")?.id;
      if (scr === "tab-calendar" && calendarDay) renderCalendarDay($("#calendarBody"));
      else if (scr === "tab-home") renderHome();
      else if (detailId && detailView !== "details") openItem(detailId);
      toast(`Wear logged for ${date}`, { label: "Undo", fn: () => undoLoggedWears([pushed]) });
    } catch (e) { toast(e.message); }
  };
}

