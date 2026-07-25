/* ===================================================================
   ADD ITEM
   =================================================================== */
let _addState = {};
let _addPhotoBlob = null;
let _addPhotoUrl = null; // object URL for preview (revoke on reset)
let _addSeed = null;     // {category, subcategory} prefill when "+" is tapped inside a folder

function fmtPurchaseDate(d) {
  if (!d) return "";
  return new Date(String(d).slice(0, 10) + "T00:00:00")
    .toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function addFieldRow(lbl, val, field) {
  const display = val || `<span style="color:var(--muted)">${esc(lbl)}</span>`;
  return `<button class="det-row" data-add-field="${field}">
    <span class="det-lbl" style="min-width:80px">${esc(lbl)}</span>
    <span class="det-val">${display}</span>
    <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
  </button>`;
}

function renderAdd() {
  // reset state on fresh open
  if (_addPhotoUrl) { URL.revokeObjectURL(_addPhotoUrl); _addPhotoUrl = null; }
  _addState = { status: "Available" };  // purchase date left blank — user sets it if they want
  // Trip mode: something bought on a trip belongs in the trip capsule —
  // pre-tick it (visible in the Capsules row, un-tickable there).
  if (tripModeId && capsuleById.get(tripModeId)) _addState.capsules = [tripModeId];
  if (_addSeed) { Object.assign(_addState, _addSeed); _addSeed = null; }
  _addPhotoBlob = null;
  _renderAddBody();
}

function _renderAddBody() {
  const s = _addState;
  const colorDisplay = s.color_family
    ? `<span class="swatch" style="background:${colorHex(s.color_family)}"></span>${esc(s.color_family)}`
    : "";

  $("#addBody").innerHTML = `
    <div class="schead">
      <button class="lnk" id="addCancel">Cancel</button>
      <span style="font-weight:600">Add Item</span>
      <button class="lnk" id="addSave" style="font-weight:700">Save</button>
    </div>

    <div class="add-photo-wrap">
      <div class="add-photo-area" id="addPhotoArea">
        <svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="14" rx="2"/><circle cx="12" cy="13" r="3"/><path d="M8 6l1.5-2h5L16 6"/></svg>
      </div>
      <label class="add-photo-label" for="addPhotoInput">
        <svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="14" rx="2"/><circle cx="12" cy="13" r="3"/></svg>
        Photo
      </label>
      <input type="file" id="addPhotoInput" accept="image/*" style="display:none">
    </div>

    <div style="padding:0 16px 100px">
      <div class="det-card" style="margin-bottom:14px">
        <div class="det-row" style="gap:0">
          <span class="det-lbl" style="min-width:80px;flex-shrink:0">Name</span>
          <input id="addName" value="${esc(s.name || "")}" placeholder="Item name"
            style="flex:1;border:none;outline:none;font:inherit;font-size:15px;color:var(--ink);padding:0;background:transparent;min-width:0">
        </div>
        <div class="det-divider"></div>
        <button class="det-row" id="addCatBtn">
          <span class="det-lbl" style="min-width:80px;flex-shrink:0">Category</span>
          <span class="det-val" id="addCatVal" ${!s.category ? 'style="color:var(--muted)"' : ""}>
            ${s.category ? esc(s.category) + (s.subcategory ? ` › ${esc(s.subcategory)}` : "") : "Select category"}
          </span>
          <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
        </button>
      </div>

      <div class="det-section-label">DETAILS</div>
      <div class="det-card" style="margin-bottom:14px">
        ${addFieldRow("Color", colorDisplay, "color_family")}
        <div class="det-divider"></div>
        ${addFieldRow("Fabric", esc((s.fabric || []).join(", ")), "fabric")}
        <div class="det-divider"></div>
        ${addFieldRow("Size", esc(s.size || ""), "size")}
        <div class="det-divider"></div>
        ${addFieldRow("Brand", esc(s.brand || ""), "brand")}
        <div class="det-divider"></div>
        ${addFieldRow("Season", esc((s.season || []).join(", ")), "season")}
        <div class="det-divider"></div>
        ${addFieldRow("Formality", esc((s.formality || []).join(", ")), "formality")}
        <div class="det-divider"></div>
        ${addFieldRow("Status", esc(s.status || "Available"), "status")}
      </div>

      <div class="det-section-label">PRICING</div>
      <div class="det-card" style="margin-bottom:14px">
        ${addFieldRow("Price", s.price != null ? esc(money(s.price)) : "", "price")}
        <div class="det-divider"></div>
        ${addFieldRow("Acquired", esc(s.acquisition || ""), "acquisition")}
        <div class="det-divider"></div>
        ${addFieldRow("Purchased", esc(fmtPurchaseDate(s.purchase_date)), "purchase_date")}
      </div>

      <div class="det-section-label">LINK</div>
      <div class="det-card" style="margin-bottom:14px">
        ${addFieldRow("Retailer", esc(s.retailer || ""), "retailer")}
        <div class="det-divider"></div>
        ${addFieldRow("URL", esc(s.url || ""), "url")}
      </div>

      <div class="det-section-label">CAPSULES</div>
      <div class="det-card" style="margin-bottom:14px">
        <button class="det-row" id="addCapsulesBtn" style="width:100%;text-align:left">
          <span class="det-lbl" style="min-width:80px;flex-shrink:0">Capsules</span>
          <span class="det-val" id="addCapsulesVal" ${!(s.capsules || []).length ? 'style="color:var(--muted)"' : ""}>${(s.capsules || []).length ? esc((s.capsules || []).map(cid => capsuleById.get(cid)?.name).filter(Boolean).join(", ")) : "None"}</span>
          <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
        </button>
      </div>

      <div class="det-section-label">NOTES</div>
      <textarea class="det-notes-ta" id="addNotes" placeholder="Notes about this item…">${esc(s.notes || "")}</textarea>
    </div>
  `;

  // restore photo preview if we have one
  if (_addPhotoUrl) {
    const area = $("#addPhotoArea");
    area.style.backgroundImage = `url("${_addPhotoUrl}")`;
    area.classList.add("has-photo");
    area.innerHTML = "";
  }

  $("#addCancel").onclick = () => switchTab("home");
  $("#addSave").onclick = saveNewItem;
  $("#addCatBtn").onclick = openAddCatSheet;

  $("#addCapsulesBtn").onclick = () => {
    openCapsuleAssign(_addState.capsules || [], (ids) => {
      _addState.capsules = ids;
      const valEl = $("#addCapsulesVal");
      if (valEl) {
        const names = ids.map(cid => capsuleById.get(cid)?.name).filter(Boolean);
        valEl.textContent = names.length ? names.join(", ") : "None";
        valEl.style.color = names.length ? "" : "var(--muted)";
      }
    });
  };

  const nameInp = $("#addName");
  nameInp.oninput = () => { _addState.name = nameInp.value; };

  const notesEl = $("#addNotes");
  notesEl.oninput = () => { _addState.notes = notesEl.value.trim() || null; };

  const photoInput = $("#addPhotoInput");
  photoInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { blob, ext } = await compressImage(file);
      _addPhotoBlob = { blob, ext };
      if (_addPhotoUrl) URL.revokeObjectURL(_addPhotoUrl);
      _addPhotoUrl = URL.createObjectURL(blob);
      const area = $("#addPhotoArea");
      area.style.backgroundImage = `url("${_addPhotoUrl}")`;
      area.classList.add("has-photo");
      area.innerHTML = "";
    } catch { toast("Couldn't process that image"); }
  };
}

// Open field sheet wired to _addState instead of a DB item
function openAddFieldEdit(field) {
  const cfg = FIELD_CONFIGS[field];
  if (!cfg) return;
  _fieldEditId = null;
  _fieldEditKey = field;
  _fieldPending = _addState[field] !== undefined ? _addState[field] : (cfg.type === "multi" ? [] : null);
  _fieldEditItem = _addState;
  _fieldOnSave = (val) => {
    _addState[field] = val;
    updateAddFieldDisplay(field);
  };
  renderFieldSheet(_addState, field, cfg);
  showSheet("fieldSheet");
}

function updateAddFieldDisplay(field) {
  const btn = $(`[data-add-field="${field}"]`);
  if (!btn) return;
  const valEl = btn.querySelector(".det-val");
  if (!valEl) return;
  const s = _addState;
  let display = "";
  if (field === "color_family" && s.color_family) {
    display = `<span class="swatch" style="background:${colorHex(s.color_family)}"></span>${esc(s.color_family)}`;
  } else if (Array.isArray(s[field]) && s[field].length) {
    display = esc(s[field].join(", "));
  } else if (s[field] != null && s[field] !== "") {
    display = field === "price" ? esc(money(s[field]))
      : field === "purchase_date" ? esc(fmtPurchaseDate(s[field]))
      : esc(String(s[field]));
  }
  if (display) { valEl.innerHTML = display; valEl.style.color = ""; }
  else { valEl.innerHTML = `<span style="color:var(--muted)">${esc(FIELD_CONFIGS[field]?.label || field)}</span>`; }
}

// Category picker for Add Item (reuses #moveSheet container)
let _addCatMode = false;

function openAddCatSheet() {
  _addCatMode = true;
  moveCatOpen = null;
  renderAddCatSheet();
  showSheet("moveSheet");
}

function renderAddCatSheet() {
  const rows = CATEGORIES.map(cat => {
    const isOpen = moveCatOpen === cat;
    const subs = TAXONOMY[cat] || [];
    const subRows = isOpen ? subs.map(s =>
      `<button class="mv-sub" data-acat="${esc(cat)}" data-asub="${esc(s)}">${esc(s)}</button>`
    ).join("") : "";
    return `<button class="mv-cat" data-mv-toggle="${esc(cat)}">
      <span>${esc(cat)}</span>
      <svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:var(--muted);stroke-width:2;fill:none;flex-shrink:0"><path d="${isOpen ? "6 15l6-6 6 6" : "6 9l6 6 6-6"}"/></svg>
    </button>${subRows}`;
  }).join("");

  $("#moveInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="addCatClose">Cancel</button>
      <h2>Category</h2>
      <span style="width:60px"></span>
    </div>
    ${rows}
  `;
  $("#addCatClose").onclick = () => { _addCatMode = false; moveCatOpen = null; hideSheet("moveSheet"); };
  $("#moveInner").querySelectorAll("[data-mv-toggle]").forEach(b => {
    b.onclick = () => { moveCatOpen = moveCatOpen === b.dataset.mvToggle ? null : b.dataset.mvToggle; renderAddCatSheet(); };
  });
  $("#moveInner").querySelectorAll("[data-acat]").forEach(b => {
    b.onclick = () => {
      _addState.category = b.dataset.acat;
      _addState.subcategory = b.dataset.asub;
      _addCatMode = false; moveCatOpen = null;
      hideSheet("moveSheet");
      // update the category display row in the add form
      const valEl = $("#addCatVal");
      if (valEl) {
        valEl.textContent = _addState.category + (_addState.subcategory ? ` › ${_addState.subcategory}` : "");
        valEl.style.color = "";
      }
    };
  });
}

async function saveNewItem() {
  const nameInp = $("#addName");
  const name = (nameInp?.value || _addState.name || "").trim();
  if (!name) { toast("Item name is required"); nameInp?.focus(); return; }

  const saveBtn = $("#addSave");
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }

  try {
    const payload = { name };
    if (_addState.category)    payload.category    = _addState.category;
    if (_addState.subcategory) payload.subcategory = _addState.subcategory;
    if (_addState.color_family) payload.color_family = _addState.color_family;
    if (_addState.fabric?.length) payload.fabric   = _addState.fabric;
    if (_addState.size)        payload.size        = _addState.size;
    if (_addState.brand)       payload.brand       = _addState.brand;
    if (_addState.season?.length) payload.season   = _addState.season;
    if (_addState.formality?.length) payload.formality = _addState.formality;
    if (_addState.status)      payload.status      = _addState.status;
    if (_addState.price != null) payload.price     = _addState.price;
    if (_addState.acquisition) payload.acquisition = _addState.acquisition;
    if (_addState.purchase_date) payload.purchase_date = _addState.purchase_date;
    if (_addState.retailer)    payload.retailer    = _addState.retailer;
    if (_addState.url)         payload.url         = _addState.url;
    if (_addState.notes)       payload.notes       = _addState.notes;

    const rows = await rest("/items", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    const newItem = Array.isArray(rows) ? rows[0] : rows;
    if (!newItem?.id) throw new Error("Item created but no ID returned");

    // upload photo and patch
    if (_addPhotoBlob) {
      const { blob, ext } = _addPhotoBlob;
      const filename = `${(crypto.randomUUID ? crypto.randomUUID() : Date.now())}.${ext}`;
      const path = await uploadPhoto(blob, filename);
      await rest(`/items?id=eq.${newItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ image_path: path }),
      });
      newItem.image_path = path;
      if (_addPhotoUrl) { URL.revokeObjectURL(_addPhotoUrl); _addPhotoUrl = null; }
    }

    items.unshift(newItem);
    itemById.set(newItem.id, newItem);
    if (newItem.image_path) signedUrlBatch([newItem.image_path]);

    // capsule memberships chosen in the Add form
    if (_addState.capsules?.length) {
      for (const cid of _addState.capsules) {
        try { await addItemsToCapsule(cid, [newItem.id]); } catch (_) { /* best-effort */ }
      }
    }

    toast("Item added!");
    // navigate to the new item photo view
    closetCat = newItem.category || null;
    closetSub = newItem.subcategory || null;
    switchTab("closet");
    openItem(newItem.id);
  } catch (e) {
    toast(e.message);
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save"; }
  }
}

