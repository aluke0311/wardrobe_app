/* ===================================================================
   TABS + WIRING
   =================================================================== */
const TAB_TITLES = {
  home: "Wardrobe", closet: "Closet", looks: "Looks", calendar: "Calendar",
  capsules: "Capsules", stats: "Style Stats", search: "Search", add: "Add Item",
  builder: "Build a Look", settings: "Settings", week: "Plan the week",
};

// Tapping a bottom-nav / Home tile should land on the top level of that tab,
// not resume a deep subpage left over from last visit. (Programmatic switchTab
// calls that pre-set folder state and then openItem() don't go through here.)
function resetTabRoot(name) {
  if (name === "closet") { closetCat = null; closetSub = null; searchResults = null; closetSearchQ = null; closetHamper = false; closetWorn = false; closetRack = false; }
  else if (name === "looks") { looksFolder = null; lookId = null; looksSearchQ = null; looksItemFilter = null; }
  else if (name === "calendar") { calendarDay = null; }
}

function switchTab(name) {
  $$(".screen").forEach(s => s.classList.toggle("active", s.id === `tab-${name}`));
  $$("#tabbar button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
  $("#title").textContent = TAB_TITLES[name] || "Wardrobe";
  $("#headerAdd").hidden = name !== "home";
  // A genuine tab tap abandons any pending item/look-return (even to the home tab
  // of that return, whose block below may be skipped). openItemFrom()/openLookFrom()
  // do NOT route through switchTab.
  _itemReturn = null;
  _lookReturn = null;
  _itemSiblingIds = null; _itemSiblingLabel = null; _lookSiblingIds = null;
  if (name !== "closet") {
    hideGridBar();
    exitSelectMode();
    $("#gridPickerPop").hidden = true;
    $("#itemBar").hidden = true;
    $("#app").classList.remove("detail-photo");
    detailId = null; detailView = null; _fromBuilder = null; _itemReturn = null;
  }

  navResetScroll("closet"); navResetScroll("looks"); navResetScroll("capsules"); navResetScroll("calendar");
  if (name !== "builder") { $("#app").classList.remove("builder-mode"); builder = null; }
  if (name !== "capsules") { clearInterval(_wxAutoTimer); _wxAutoTimer = null; }  // stop weather auto-refresh

  if (name === "home") renderHome();
  else if (name === "closet")   renderCloset();
  else if (name === "add")      renderAdd();
  else if (name === "builder")  renderBuilder();
  else if (name === "looks")    renderLooks();
  else if (name === "calendar") renderCalendar();
  else if (name === "capsules") { capsuleView = "list"; capsuleId = null; renderCapsules(); }
  // A real tab tap starts Stats fresh at the top — don't restore a stale
  // entry-scroll captured before she left the tab.
  else if (name === "stats")    { statsView = "main"; statsDateRange = "all"; _statsLastView = null; _statsEntryScroll = 0; renderStats(); }
  else if (name === "settings") renderSettings();
  else if (name === "week")     renderWeekPlan();

  scrollToTop();
}

function renderSettings() {
  const lastBk = store.getItem("wardrobe.lastBackup");
  $("#settingsBody").innerHTML = `
    <div style="padding:24px 18px" class="stack">
      <div class="card stack">
        <div><div class="fld">Appearance</div>
          <div class="muted" style="font-size:13px;line-height:1.5">Pick a color theme. Light &amp; dark follow your device automatically.</div></div>
        <div style="display:flex;gap:10px">
          <button class="theme-opt${currentTheme() === 'editorial' ? ' on' : ''}" data-theme-set="editorial">
            <span class="theme-sw" style="background:#6b2737"></span>
            <span class="theme-nm">Oxblood</span>
          </button>
          <button class="theme-opt${currentTheme() === 'sage' ? ' on' : ''}" data-theme-set="sage">
            <span class="theme-sw" style="background:#768c66"></span>
            <span class="theme-nm">Sage</span>
          </button>
        </div>
        <div><div class="fld" style="margin-top:4px">Looks without an arrangement</div>
          <div class="muted" style="font-size:13px;line-height:1.5">Looks you've arranged in the builder always show the way you arranged them. This is for the rest.</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${[["collage", "Collage"], ["layout", "Default layout"]].map(([k, lbl]) =>
            `<button class="cap-chip${lookFallbackMode() === k ? " on" : ""}" data-lookfb="${k}" style="font-size:13px">${lbl}</button>`).join("")}
        </div>
      </div>
      <div class="card stack">
        <div><div class="fld">Rack size</div>
          <div class="muted" style="font-size:13px;line-height:1.5">How many pieces are "in play" at once. Bigger keeps more of your wardrobe reachable; smaller makes the suggester more decisive. The slot mix and the 20% you haven't reached for lately scale with it.</div></div>
        <input type="range" id="setRackSize" min="${RACK_SIZE_MIN}" max="${RACK_SIZE_MAX}" step="4" value="${rackTargetSize()}" style="width:100%;accent-color:var(--accent)">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span class="muted" style="font-size:12px">${RACK_SIZE_MIN}</span>
          <b id="setRackSizeVal" style="font-size:16px">about ${rackQuotaTotal2()} pieces</b>
          <span class="muted" style="font-size:12px">${RACK_SIZE_MAX}</span>
        </div>
      </div>
      <div class="card stack">
        <div><div class="fld">What's new</div>
          <div class="muted" style="font-size:13px;line-height:1.5">${(() => {
            // Just the version and a count. Leading with the first bullet ran to
            // six lines of muted text and buried the button under it — the
            // detail is one tap away, which is what the button is for.
            const n = ((RELEASE_NOTES[0] || {}).notes || []).length;
            return `${esc((RELEASE_NOTES[0] || {}).v || APP_VERSION)}${n ? ` · ${n} change${n === 1 ? "" : "s"}` : ""}.`;
          })()}</div></div>
        <button class="btn btn-sec" id="setWhatsNew">What changed in this update</button>
        <button class="lnk" id="setChangelog" style="font-size:14px;color:var(--accent);font-weight:600;padding:2px 0">All ${RELEASE_NOTES.length} updates →</button>
      </div>
      <div class="card stack">
        <div><div class="fld">Signed in as</div><div id="set_email">${esc(session?.user?.email || "")}</div></div>
        <button class="btn" id="signOutBtn" style="background:var(--danger)">Sign out</button>
      </div>
      <div class="card stack">
        <div><div class="fld">Your data</div>
          <div class="muted" style="font-size:13px;line-height:1.5">${items.length} items · ${wears.length} wear records · ${outfits.length} looks.
          ${lastBk ? `Last backup ${esc(lastBk)}.` : "Never backed up."}</div></div>
        <button class="btn" id="setBackup">Download backup (JSON)</button>
        <div class="muted" style="font-size:12px;line-height:1.45">Photos aren't in the JSON — run
          <code>python3 migration/backup_photos.py</code> on your Mac for a full offline copy (data + photos).</div>
        <button class="btn btn-sec" id="setHealth">Run data health check</button>
        <div id="setHealthOut"></div>
      </div>
      <div class="card stack">
        <div><div class="fld">Weather history</div>
          <div class="muted" style="font-size:13px;line-height:1.5">${(() => {
            const n = Object.keys(wxLog()).length;
            const ran = kvData.get(WX_BACKFILL_KEY);
            return `${n} day${n === 1 ? "" : "s"} of weather on record${ran ? `, last filled in ${esc(ran)}` : ""}. This is what powers “you've dressed for this before”.`;
          })()}</div></div>
        <button class="btn btn-sec" id="setWxFill">Look up past weather</button>
      </div>
      <div class="card stack">
        <div><div class="fld">Where you've been</div>
          <div class="muted" style="font-size:13px;line-height:1.5">Past weather is looked up at home unless you say otherwise. Log a trip here and those days get the weather you were actually in — which is what keeps “usually worn” and your season tags honest.</div></div>
        <div id="setWhereList">${whereListHtml()}</div>
        <button class="btn btn-sec" id="setWhereAdd">＋ Add somewhere</button>
      </div>
      <div class="card stack">
        <div><div class="fld">Categories</div>
          <div class="muted" style="font-size:13px;line-height:1.5">Rename, add or remove your categories and the types inside them. Renaming moves every item over.</div></div>
        <button class="btn btn-sec" id="setTaxonomy">Edit categories &amp; types</button>
      </div>
      <div class="center muted" style="font-size:12px"><span class="appver">${esc(APP_VERSION)}</span></div>
    </div>`;
  $("#signOutBtn").onclick = () => handleSignedOut();
  $("#settingsBody").querySelectorAll("[data-theme-set]").forEach(b => b.onclick = () => { applyTheme(b.dataset.themeSet); renderSettings(); });
  $("#settingsBody").querySelectorAll("[data-lookfb]").forEach(b => b.onclick = () => { setLookFallbackMode(b.dataset.lookfb); renderSettings(); });
  const rs = $("#setRackSize");
  if (rs) {
    // Live label while dragging; commit (and let the rack go stale) on release,
    // so a drag across the range doesn't invalidate the rack forty times.
    rs.oninput = () => { const v = $("#setRackSizeVal"); if (v) v.textContent = `about ${rackQuotaTotal2(+rs.value)} pieces`; };
    rs.onchange = () => { setRackTargetSize(+rs.value); toast("Rack size saved — it'll top up on the next open"); };
  }
  $("#setWhatsNew").onclick = () => openWhatsNewSheet();
  $("#setChangelog").onclick = () => openChangelogSheet();
  $("#setBackup").onclick = downloadBackup;
  $("#setHealth").onclick = () => runDataHealthCheck();
  $("#setTaxonomy").onclick = () => openTaxonomySheet();
  $("#setWhereAdd").onclick = () => openWhereSheet();
  $("#setWhereList").querySelectorAll("[data-where-del]").forEach(b =>
    b.onclick = () => removeWhereEntry(+b.dataset.whereDel));
  $("#setWxFill").onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true; b.textContent = "Looking up…";
    try {
      const n = await backfillWxLog();
      toast(`Weather filled in for ${n} day${n === 1 ? "" : "s"}`);
      renderSettings();
    } catch (err) { toast(err.message); b.disabled = false; b.textContent = "Look up past weather"; }
  };
}

/* ---- category / subcategory editor (2026-07-21, her request) --------------
   Renames rewrite every affected item (bulk PATCH by column filter, not by id
   list), so the closet never ends up with orphaned values. Deleting is only
   offered when nothing uses the name — safer than silently reassigning items. */
function _taxCounts() {
  const cat = new Map(), sub = new Map();
  for (const i of items) {
    if (i.category) cat.set(i.category, (cat.get(i.category) || 0) + 1);
    if (i.category && i.subcategory) {
      const k = `${i.category}|${i.subcategory}`;
      sub.set(k, (sub.get(k) || 0) + 1);
    }
  }
  return { cat, sub };
}
/* Subcategory names that other behaviour is hard-keyed on (Round C step 9).
   WORKOUT_SLOTS maps Workout types to real outfit slots; GEAR_CAND_SUBCATS is
   where the gear-tagging pass looks. Neither can ride the `meta` override the
   way SUBCAT_FORMALITY / WEAR_TOLERANCE do, so a rename here needs a warning.
   NOTE: LAUNDRY_LOADS is NOT in this set — it's keyed on color_family, which
   the taxonomy editor never touches. (The old CLAUDE.md gotcha was wrong.) */
const TAXONOMY_LOCKED_SUBCATS = new Set([...Object.keys(WORKOUT_SLOTS), ...GEAR_CAND_SUBCATS]);

function openTaxonomySheet() {
  const { cat: catN, sub: subN } = _taxCounts();
  const secs = CATEGORIES.map(c => {
    const subs = TAXONOMY[c] || [];
    const rows = subs.map(sname => {
      const n = subN.get(`${c}|${sname}`) || 0;
      return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0 5px 12px;border-bottom:1px solid var(--line)">
        <span style="flex:1;min-width:0;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(sname)}</span>
        <span class="muted" style="font-size:11.5px;flex:none">${n}</span>
        <button class="cap-chip" data-tax-subren="${esc(c)}|${esc(sname)}" style="font-size:12px;flex:none">✎</button>
        <button class="cap-chip" data-tax-subdel="${esc(c)}|${esc(sname)}" style="font-size:12px;flex:none;color:${n ? "var(--muted)" : "var(--danger)"}">✕</button>
      </div>`;
    }).join("");
    return `<div style="padding:10px 16px 4px">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="flex:1;min-width:0;font-size:14px;font-weight:700">${esc(c)}</span>
        <span class="muted" style="font-size:11.5px">${catN.get(c) || 0} items</span>
        <button class="cap-chip" data-tax-catren="${esc(c)}" style="font-size:12px">✎</button>
        <button class="cap-chip" data-tax-catdel="${esc(c)}" style="font-size:12px;color:${(catN.get(c) || 0) ? "var(--muted)" : "var(--danger)"}">✕</button>
      </div>
      ${rows}
      <button class="lnk" data-tax-subadd="${esc(c)}" style="font-size:12.5px;padding:6px 0 0 12px">＋ Add a type</button>
    </div>`;
  }).join("");
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="taxClose">Done</button>
      <h2>Categories &amp; types</h2>
      <div style="width:48px"></div>
    </div>
    <div class="muted" style="font-size:12px;padding:0 16px 6px;line-height:1.5">Renaming moves every item using that name. You can only delete one nothing is using. The number is how many items use it.</div>
    <div style="max-height:60vh;overflow-y:auto">${secs}</div>
    <div style="padding:10px 16px 16px;display:flex;gap:8px">
      <button class="btn btn-sec" id="taxAddCat" style="flex:1">＋ Add category</button>
      <button class="lnk" id="taxReset" style="flex:none;color:var(--muted);font-size:12.5px">Reset to default</button>
    </div>
    <div style="height:max(env(safe-area-inset-bottom),10px)"></div>`;
  showSheet("logSheet");
  $("#taxClose").onclick = () => {
    hideSheet("logSheet");
    if (activeTabName() === "settings") renderSettings();
    else if (activeTabName() === "closet") renderCloset();
  };

  const cats = () => JSON.parse(JSON.stringify(TAXONOMY));
  const clean = (v) => (v || "").trim();

  $("#logInner").querySelectorAll("[data-tax-subren]").forEach(b => b.onclick = async () => {
    const [c, ...rest_] = b.dataset.taxSubren.split("|"); const old = rest_.join("|");
    const next = clean(prompt(`Rename “${old}” to:`, old));
    if (!next || next === old) return;
    // Some behaviour is keyed on the SHIPPED subcategory names, and a rename
    // would silently break it. `meta` carries formality/tolerance across a
    // rename; these two maps can't be, so warn instead of failing quietly.
    if (TAXONOMY_LOCKED_SUBCATS.has(old) &&
        !confirm(`“${old}” is one of the names workout and gear suggestions are keyed on.\n\nRenaming it will stop run/hike outfits from finding these pieces until you re-tag them.\n\nRename anyway?`)) return;
    const t = cats();
    if ((t[c] || []).includes(next)) return toast("That type already exists here");
    t[c] = (t[c] || []).map(x => (x === old ? next : x));
    const meta = {};
    if (SUBCAT_FORMALITY[old]) meta[next] = { formality: SUBCAT_FORMALITY[old], tolerance: WEAR_TOLERANCE[old] };
    await saveTaxonomy(t, meta);
    await retagItems({ category: c, subcategory: old }, { subcategory: next });
    openTaxonomySheet();
  });

  $("#logInner").querySelectorAll("[data-tax-subdel]").forEach(b => b.onclick = async () => {
    const [c, ...rest_] = b.dataset.taxSubdel.split("|"); const name = rest_.join("|");
    const n = _taxCounts().sub.get(`${c}|${name}`) || 0;
    if (n) return toast(`${n} item${n === 1 ? "" : "s"} still use “${name}” — rename it instead`);
    if (!confirm(`Remove the type “${name}” from ${c}?`)) return;
    const t = cats();
    t[c] = (t[c] || []).filter(x => x !== name);
    await saveTaxonomy(t);
    openTaxonomySheet();
  });

  $("#logInner").querySelectorAll("[data-tax-subadd]").forEach(b => b.onclick = async () => {
    const c = b.dataset.taxSubadd;
    const name = clean(prompt(`New type in ${c}:`, ""));
    if (!name) return;
    const t = cats();
    if ((t[c] || []).includes(name)) return toast("That type already exists here");
    t[c] = [...(t[c] || []), name];
    await saveTaxonomy(t);
    openTaxonomySheet();
  });

  $("#logInner").querySelectorAll("[data-tax-catren]").forEach(b => b.onclick = async () => {
    const old = b.dataset.taxCatren;
    const next = clean(prompt(`Rename category “${old}” to:`, old));
    if (!next || next === old) return;
    if (TAXONOMY[next]) return toast("That category already exists");
    const t = {};
    for (const k of Object.keys(TAXONOMY)) t[k === old ? next : k] = TAXONOMY[k].slice();  // keep order
    await saveTaxonomy(t);
    await retagItems({ category: old }, { category: next });
    openTaxonomySheet();
  });

  $("#logInner").querySelectorAll("[data-tax-catdel]").forEach(b => b.onclick = async () => {
    const c = b.dataset.taxCatdel;
    const n = _taxCounts().cat.get(c) || 0;
    if (n) return toast(`${n} item${n === 1 ? "" : "s"} are still in ${c} — move them first`);
    if (!confirm(`Remove the category “${c}”?`)) return;
    const t = cats(); delete t[c];
    await saveTaxonomy(t);
    openTaxonomySheet();
  });

  $("#taxAddCat").onclick = async () => {
    const name = clean(prompt("New category name:", ""));
    if (!name) return;
    if (TAXONOMY[name]) return toast("That category already exists");
    const t = cats(); t[name] = [];
    await saveTaxonomy(t);
    openTaxonomySheet();
  };

  $("#taxReset").onclick = async () => {
    if (!confirm("Reset categories and types to the app defaults? Your items keep whatever they're labelled — this only changes the lists.")) return;
    await saveTaxonomy(JSON.parse(JSON.stringify(TAXONOMY_DEFAULT)));
    openTaxonomySheet();
  };
}

// Bulk-rewrite a column value across every matching item (PostgREST column
// filters, so no id list). Updates the in-memory rows to match.
async function retagItems(match, patch) {
  const q = Object.entries(match).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join("&");
  const hit = items.filter(i => Object.entries(match).every(([k, v]) => i[k] === v));
  if (!hit.length) return;
  try {
    await rest(`/items?${q}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
    for (const i of hit) Object.assign(i, patch);
    toast(`Moved ${hit.length} item${hit.length === 1 ? "" : "s"}`);
    saveDataSnapshot();
  } catch (e) { toast(e.message); }
}

// ---- Data safety (2026-07-18) ----
// One-tap JSON export of every table. The dataset is the irreplaceable part
// of this app (the code is rebuildable) — this is the cheap insurance.
function downloadBackup() {
  const payload = {
    exported_at: new Date().toISOString(),
    app_version: APP_VERSION,
    user: session?.user?.email || null,
    items, wears, outfits,
    outfit_items: outfitLinks,
    capsules, capsule_items: capsuleLinks,
    exclusions,
  };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `wardrobe-backup-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  store.setItem("wardrobe.lastBackup", todayStr());
  toast("Backup downloaded — keep it somewhere safe");
  const scr = $(".screen.active")?.id;
  if (scr === "tab-home") renderHome();       // E1 nudge row lives here too
  else if (scr === "tab-settings") renderSettings();
}

// Chunked bulk DELETE (in.() URL length safety).
async function _bulkDeleteRows(table, ids) {
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    await rest(`/${table}?id=in.(${chunk.map(id => `"${id}"`).join(",")})`, { method: "DELETE" });
  }
}

// Integrity scan over the loaded state. Conservative by design: only rows that
// are unambiguously broken (dangling references, impossible dates) get a Fix
// button; anything that could be intentional is report-only.
function runDataHealthCheck() {
  const today = todayStr();
  const checks = [];
  const orphanWears = wears.filter(w => w.id && w.item_id && !itemById.has(w.item_id));
  checks.push({ label: "Wear rows pointing at deleted items", rows: orphanWears,
    fix: () => _bulkDeleteRows("wears", orphanWears.map(w => w.id)) });
  const futureWears = wears.filter(w => w.id && w.worn_on && w.worn_on > today);
  checks.push({ label: "Wears dated in the future", rows: futureWears,
    fix: () => _bulkDeleteRows("wears", futureWears.map(w => w.id)) });
  const orphanLinks = outfitLinks.filter(l => !outfitById.has(l.outfit_id) || !itemById.has(l.item_id));
  checks.push({ label: "Look-piece links with a missing look or item", rows: orphanLinks,
    fix: async () => { for (const l of orphanLinks) await rest(`/outfit_items?outfit_id=eq.${l.outfit_id}&item_id=eq.${l.item_id}`, { method: "DELETE" }); } });
  const orphanCapLinks = capsuleLinks.filter(l => !capsuleById.has(l.capsule_id) || !itemById.has(l.item_id));
  checks.push({ label: "Capsule links with a missing capsule or item", rows: orphanCapLinks,
    fix: async () => { for (const l of orphanCapLinks) await rest(`/capsule_items?capsule_id=eq.${l.capsule_id}&item_id=eq.${l.item_id}`, { method: "DELETE" }); } });
  const orphanEx = exclusions.filter(x => x.id && (!itemById.has(x.item_a) || !itemById.has(x.item_b)));
  checks.push({ label: "Exclusions referencing deleted items", rows: orphanEx,
    fix: () => _bulkDeleteRows("exclusions", orphanEx.map(x => x.id)) });
  // One-piece looks shouldn't exist (user rule 2026-07-19; import-era strays) —
  // fix = deconstruct: the look goes, its wears stay as individual pieces.
  const soloLooks = outfits.filter(o => (outfitItemMap.get(o.id) || []).filter(id => itemById.has(id)).length === 1);
  checks.push({ label: "One-piece looks (fix keeps their wears as solo wears)", rows: soloLooks,
    fix: async () => { for (const o of soloLooks) await deconstructLookCore(o.id); } });
  // Incomplete looks (no dress, no top+bottom; shoes never required) get a
  // REVIEW list, not a blanket fix — some pairings may be hers on purpose.
  const incomplete = outfits.filter(outfitIncomplete);
  checks.push({ label: "Incomplete looks (no dress, no top+bottom pair)", rows: incomplete,
    review: openIncompleteLooksSheet });
  // Season/weather disagreements deliberately do NOT appear here (Round D.4).
  // They aren't integrity problems, and routing them through a health-check
  // row built an audit queue she couldn't act on. They live where she already
  // looks at clothes: the item's own page, and Closet Review.
  // Report-only (could be intentional):
  const emptyLooks = outfits.filter(o => !(outfitItemMap.get(o.id) || []).some(id => itemById.has(id)));
  checks.push({ label: "Looks with no pieces (report only)", rows: emptyLooks });
  const dupKey = new Map();
  for (const w of wears) { const k = `${w.item_id}|${w.worn_on}`; dupKey.set(k, (dupKey.get(k) || 0) + 1); }
  const dupCount = [...dupKey.values()].filter(n => n > 1).length;
  checks.push({ label: "Same item logged twice on one day (report only — double-logs can be intentional)", rows: { length: dupCount } });

  const out = $("#setHealthOut");
  if (!out) return;
  const broken = checks.filter(c => c.rows.length);
  if (!broken.length) {
    out.innerHTML = `<div style="font-size:14px;padding:6px 0">✅ All clean — no integrity problems found.</div>`;
    return;
  }
  out.innerHTML = broken.map((c, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid var(--line);font-size:13.5px">
      <span style="flex:1">${esc(c.label)}</span>
      <b>${c.rows.length}</b>
      ${c.fix ? `<button class="lnk" data-health-fix="${i}" style="color:var(--accent);font-weight:700">Fix</button>`
        : c.review ? `<button class="lnk" data-health-review="${i}" style="color:var(--accent);font-weight:700">Review →</button>` : ""}
    </div>`).join("");
  out.querySelectorAll("[data-health-review]").forEach(b => {
    b.onclick = () => broken[+b.dataset.healthReview].review();
  });
  out.querySelectorAll("[data-health-fix]").forEach(b => {
    b.onclick = async () => {
      const c = broken[+b.dataset.healthFix];
      b.disabled = true; b.textContent = "…";
      try {
        await c.fix();
        await loadData();
        toast(`Fixed · ${c.rows.length} row${c.rows.length === 1 ? "" : "s"} removed`);
        renderSettings();
        runDataHealthCheck();
      } catch (e) { toast(e.message); b.disabled = false; b.textContent = "Fix"; }
    };
  });
}

function wireEvents() {
  // One-tap filter clear (A2): every funnel's adjacent ✕, wherever it renders.
  // Capture phase so per-screen body.onclick delegation can't swallow it.
  document.addEventListener("click", (e) => {
    const fc = e.target.closest("[data-funnel-clear]");
    if (!fc) return;
    const reg = _funnelClearFns[fc.dataset.funnelClear];
    if (!reg) return;
    e.stopPropagation();
    e.preventDefault();
    clearFilterState(reg.state);
    reg.onClear();
  }, true);

  /* The always-visible laundry lens, same registry idiom and same reason for
     capture phase: it renders inside surfaces (the picker, the closet grid) that
     install their own body.onclick delegation. */
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-laun-lens]");
    if (!btn) return;
    const row = btn.closest("[data-laundry-lens]");
    const reg = row && _laundryLensFns[row.dataset.laundryLens];
    if (!reg) return;
    e.stopPropagation();
    e.preventDefault();
    setLaundryLens(reg.state, btn.dataset.launLens);
    (reg.onChange || LAUNDRY_LENS_DEFAULT_RENDER[row.dataset.laundryLens] || (() => {}))();
  }, true);

  // login
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#loginBtn"), err = $("#loginErr");
    err.hidden = true; btn.disabled = true; btn.textContent = "Signing in…";
    try {
      await signIn($("#email").value.trim(), $("#pw").value);
      store.setItem("wardrobe.lastEmail", $("#email").value.trim());
      $("#pw").value = "";
      await bootApp();
    } catch (e2) {
      err.textContent = e2.message; err.hidden = false;
    } finally { btn.disabled = false; btn.textContent = "Sign in"; }
  });

  // bottom nav
  // No-op on iOS Safari (no Vibration API) — the :active transforms carry the
  // feedback there. Kept for Android/desktop Chrome.
  function haptic(ms = 8) { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) {} }
  // subtle tap feedback on primary actions
  document.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".btn, .cap-plan, .cap-newbtn, .rv-confirm, .review-cta, .log-cta, .sheet-action-btn, .cal-make-look-btn, .lk-act, .tile")) haptic(6);
  }, { passive: true });
  $("#tabbar").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (!b) return;
    haptic();
    // Re-tapping the current tab scrolls its content back to the top (iOS pattern)
    if (b.classList.contains("on")) { smoothScrollTop(); return; }
    resetTabRoot(b.dataset.tab); switchTab(b.dataset.tab);
  });

  // home launcher tiles
  $("#homeBody").addEventListener("click", (e) => {
    const t = e.target.closest("[data-go]");
    if (t) { resetTabRoot(t.dataset.go); switchTab(t.dataset.go); }
  });

  // closet: lens / folders / subcategories / items / back / search
  $("#closetBody").addEventListener("click", (e) => {
    if (e.target.closest("#clBack")) return closetBack();
    const itemWearDate = e.target.closest("[data-item-wear-date]");
    if (itemWearDate) {
      switchTab("calendar");
      calendarDay = itemWearDate.dataset.itemWearDate;
      renderCalendarDay($("#calendarBody"));
      return;
    }
    if (e.target.closest("[data-cap-clear]")) {
      if (tripModeId && tripModeId === activeCapsuleId) return exitTripMode();
      activeCapsuleId = null; closetCat = null; closetSub = null; return renderCloset();
    }
    if (e.target.closest("#clKeyword")) { navDeeper("closet"); closetSearchQ = ""; searchResults = null; return renderCloset(); }
    if (e.target.closest("#clSearch")) return openSearch();
    if (e.target.closest("[data-cap-filter]")) return openClosetCapsuleFilter();
    const hl = e.target.closest("[data-hload]");
    if (hl) { hamperLoad = hl.dataset.hload || null; exitSelectMode(); return renderCloset(); }
    const lw = e.target.closest("[data-laundry-wash]");
    if (lw) {
      // Scoped hamper page → scoped wash sheet (trip laundry = the suitcase).
      // The load chip she's standing on comes with her.
      return openLaundrySheet({
        ...(activeCapsuleId ? { pool: capsuleItems(activeCapsuleId) } : {}),
        preLoad: lw.dataset.laundryWash || null,
      });
    }
    if (e.target.closest("[data-rack]")) { navDeeper("closet"); closetRack = true; _rackExtrasOpen = false; closetHamper = false; closetWorn = false; closetCat = null; closetSub = null; searchResults = null; closetSearchQ = null; rackEnsure().then(() => { if (closetRack) renderCloset(); }); return renderCloset(); }
    if (e.target.closest("[data-laundry]")) { navDeeper("closet"); closetHamper = true; hamperLoad = null; closetWorn = false; closetRack = false; closetCat = null; closetSub = null; searchResults = null; closetSearchQ = null; return renderCloset(); }
    if (e.target.closest("[data-worn]")) { navDeeper("closet"); closetWorn = true; closetHamper = false; closetRack = false; closetCat = null; closetSub = null; searchResults = null; closetSearchQ = null; return renderCloset(); }
    const lens = e.target.closest("[data-lens]");
    if (lens) { closetLens = lens.dataset.lens; closetCat = null; closetSub = null; searchResults = null; closetSearchQ = null; navResetScroll("closet"); scrollToTop(); return renderCloset(); }
    const cat = e.target.closest("[data-cat]");
    if (cat) { navDeeper("closet"); closetCat = cat.dataset.cat; closetSub = null; searchResults = null; return renderCloset(); }
    const sub = e.target.closest("[data-sub]");
    if (sub) { navDeeper("closet"); closetSub = sub.dataset.sub; return renderCloset(); }
    const it = e.target.closest("[data-item]");
    if (it) {
      if (selectMode) { toggleSelect(it.dataset.item); return; }
      return openItem(it.dataset.item);
    }
  });

  // looks: lens / folders / outfit tiles / detail actions
  $("#looksBody").addEventListener("click", (e) => {
    if (e.target.closest("#looksBack")) return looksBack();
    if (e.target.closest("[data-cap-clear]")) {
      if (tripModeId && tripModeId === activeCapsuleId) return exitTripMode();
      activeCapsuleId = null; return renderLooks();
    }
    const lgc = e.target.closest("[data-lookcols]");
    if (lgc) return setLookCols(+lgc.dataset.lookcols);
    if (e.target.closest("#looksGrid")) { const pop = $("#lookGridPop"); if (pop) pop.hidden = !pop.hidden; return; }
    if (e.target.closest("#looksFilter")) { return openFilterSheet(looksFilter, { onApply: () => { looksSearchQ = null; renderLooks(); }, title: "Filter Looks", dims: LOOKS_FILTER_DIMS }); }
    if (e.target.closest("#looksNew")) return openNewLookSheet();
    if (e.target.closest("#looksShuffle")) return openRandomLook();
    if (e.target.closest("#lookHeartBtn")) {
      if (!lookId) return;
      toggleLikeLook(lookId).then(r => { const btn = $("#lookHeartBtn"); if (btn) btn.classList.toggle("on", r === 1); });
      return;
    }
    const lens = e.target.closest("[data-llens]");
    if (lens) { looksLens = lens.dataset.llens; looksFolder = null; lookId = null; return renderLooks(); }
    const folder = e.target.closest("[data-lfolder]");
    if (folder) { navDeeper("looks"); looksFolder = folder.dataset.lfolder; return renderLooks(); }
    const lkact = e.target.closest("[data-lkact]");
    if (lkact && lookId) {
      const a = lkact.dataset.lkact;
      if (a === "details")   return openLookDetails(lookId);
      if (a === "folder")    return openLookFormalityEdit(lookId);
      if (a === "vary")      return openVaryLook(lookId);
      if (a === "duplicate") return duplicateLook(lookId);
      if (a === "calendar")  return openWearLook(lookId);
      if (a === "archive")   return archiveLook(lookId);
      if (a === "delete")    return deleteLook(lookId);
      return;
    }
    if (e.target.closest("#lookWearsBtn")) { if (lookId) openLookWears(lookId); return; }
    // Checked BEFORE [data-wear-date] — it sits inside that row (same precedence
    // rule as data-piece-open vs data-occ-item).
    const wdDate = e.target.closest("[data-wd-date]");
    if (wdDate && lookId) {
      const d = wdDate.dataset.wdDate;
      return openWearDetail(d, wears.filter(w => w.outfit_id === lookId && w.worn_on === d).map(w => w.id));
    }
    const wearDate = e.target.closest("[data-wear-date]");
    if (wearDate && lookId) {
      const d = wearDate.dataset.wearDate;
      switchTab("calendar");
      calendarDay = d;
      renderCalendarDay($("#calendarBody"));
      return;
    }
    if (e.target.closest("[data-look-formality]")) { if (lookId) openLookFormalityEdit(lookId); return; }
    if (e.target.closest("#lookEditPieces")) { if (lookId) openBuilder(lookId); return; }
    if (e.target.closest("#lookDecon")) { if (lookId) deconstructLook(lookId); return; }
    if (e.target.closest("#lookAddLevel")) { if (lookId) showNudgePiecesSheet(lookId, outfitBucket(outfitById.get(lookId))); return; }
    if (e.target.closest("#lookDefLayout")) { if (lookId) applyDefaultLayout(lookId); return; }
    const pieceOpen = e.target.closest("[data-piece-open]");
    if (pieceOpen) {
      // Thumbnail tap opens the item; must run BEFORE the [data-occ-item] row check.
      const it = itemById.get(pieceOpen.dataset.pieceOpen);
      if (it) openItemFrom(it.id, { cat: it.category, sub: it.subcategory });
      return;
    }
    const occItem = e.target.closest("[data-occ-item]");
    if (occItem) { openOccasionEdit(occItem.dataset.occItem, () => { if (lookId) openLookDetails(lookId); }); return; }
    const piece = e.target.closest("[data-look-item]");
    if (piece) {
      const it = itemById.get(piece.dataset.lookItem);
      if (it) openItemFrom(it.id, { cat: it.category, sub: it.subcategory });
      return;
    }
    const look = e.target.closest("[data-look]");
    if (look) {
      // Swipe siblings = the looks in the container just tapped, in visual order
      // (grid, search results, or the similar-looks strip).
      const scope = look.closest(".ogrid, #looksSearchResults, .wa-strip") || $("#looksBody");
      _lookSiblingIds = $$("[data-look]", scope).map(b => b.dataset.look);
      return openLook(look.dataset.look);
    }
  });

  // build-a-look canvas: toolbar, picker, piece controls
  $("#builderBody").addEventListener("click", (e) => {
    if (!builder) return;
    if (e.target.closest("#bldCancel")) return builderCancel();
    if (e.target.closest("#bldSave")) return saveBuilder();
    if (e.target.closest("#bldAdd")) { builder.picking = true; builder.pickCat = null; builder.pickQ = ""; return renderBuilder(); }
    if (e.target.closest("#bldPickBack")) return builderPickBack();
    if (e.target.closest("#bldPickFilter")) return openFilterSheet(builderFilter, { onApply: renderBuilderPicker, title: "Filter Clothing", dims: BUILDER_FILTER_DIMS });
    const bcat = e.target.closest("[data-bcat]");
    if (bcat) { builder.pickCat = bcat.dataset.bcat; builder.pickSub = null; return renderBuilder(); }
    const bsub = e.target.closest("[data-bsub]");
    if (bsub) { builder.pickSub = bsub.dataset.bsub; return renderBuilder(); }
    const bcap = e.target.closest("[data-bcap]");
    if (bcap) { builder.scopeCapsuleId = bcap.dataset.bcap || null; builder.pickCat = null; builder.pickSub = null; return renderBuilder(); }
    const railadd = e.target.closest("[data-railadd]");
    if (railadd) return addPieceToBuilder(railadd.dataset.railadd, true);  // keep rail open
    const railcat = e.target.closest("[data-railcat]");
    if (railcat) { builder.pickCat = railcat.dataset.railcat || null; return renderBuilder(); }
    if (e.target.closest("[data-railbrowse]")) return setBuilderPickAll(false);
    if (e.target.closest("[data-ballmode]")) return setBuilderPickAll(true);
    if (e.target.closest("[data-railback]")) return builderPickBack();
    if (e.target.closest("[data-railclose]")) { builder.picking = false; builder.pickCat = null; builder.pickSub = null; builder.pickQ = ""; return renderBuilder(); }
    const badd = e.target.closest("[data-badd]");
    if (badd) return addPieceToBuilder(badd.dataset.badd);
    const layer = e.target.closest("[data-blayer]");
    if (layer) return layerPiece(layer.dataset.blayer);
    if (e.target.closest("[data-bdelete]")) return deleteBuilderPiece();
    if (e.target.closest("[data-bview]")) {
      const i = builder.selIdx;
      if (i < 0) { toast("Tap a piece first"); return; }
      const it = itemById.get(builder.pieces[i].item_id);
      if (!it) return;
      _fromBuilder = JSON.parse(JSON.stringify(builder));  // stash to restore on back
      closetCat = it.category || null; closetSub = it.subcategory || null; searchResults = null;
      switchTab("closet"); openItem(it.id);
      return;
    }
  });

  // capsules: list / detail / form / picker
  $("#capsulesBody").addEventListener("click", (e) => {
    if (e.target.closest("#capBack")) return capsuleBack();
    const capTab = e.target.closest("[data-captab]");
    if (capTab) { capsuleTab = capTab.dataset.captab; return renderCapsules(); }
    const delRow = e.target.closest("[data-cap-del-row]");
    if (delRow) return deleteCapsule(delRow.dataset.capDelRow);
    const capNew = e.target.closest("[data-cap-new]");
    // The ＋ carries the kind of the tab she's standing on.
    if (capNew) return openCapsuleNew(capNew.dataset.capNew || (capsuleTab === "trips" ? "packing" : "capsule"));
    if (e.target.closest("[data-trip-toggle]")) {
      if (tripModeId === capsuleId) exitTripMode();  // re-renders this screen
      else enterTripMode(capsuleId);
      return;
    }
    // ---- trip builder / pack plan ----
    if (e.target.closest("[data-cap-pack]")) {
      return packHasPlan(capsuleId) ? openPackPlan(capsuleId) : openPackBuildSheet(capsuleId);
    }
    // ---- items-first pack screen (2026-07-30) ----
    const packMode = e.target.closest("[data-packmode]");
    if (packMode) { _packMode = packMode.dataset.packmode; return renderCapsules(); }
    const packInc = e.target.closest("[data-pack-inc]");
    if (packInc) { const s = packInc.dataset.packInc; return packSetTarget(s, (_packState.targets[s] || 0) + 1); }
    const packDec = e.target.closest("[data-pack-dec]");
    if (packDec) { const s = packDec.dataset.packDec; return packSetTarget(s, (_packState.targets[s] || 0) - 1); }
    const packExpand = e.target.closest("[data-pack-expand]");
    if (packExpand) {
      const s = packExpand.dataset.packExpand;
      if (_packOpen.has(s)) _packOpen.delete(s); else _packOpen.add(s);
      return renderCapsules();
    }
    const subInc = e.target.closest("[data-pack-subinc]");
    if (subInc) {
      const s = subInc.dataset.packSubinc, sub = subInc.dataset.packSub;
      const cur = (_packState.subTargets && _packState.subTargets[s] && _packState.subTargets[s][sub]) || 0;
      return packSetSubTarget(s, sub, cur + 1);
    }
    const subDec = e.target.closest("[data-pack-subdec]");
    if (subDec) {
      const s = subDec.dataset.packSubdec, sub = subDec.dataset.packSub;
      const shown = (_packState.subTargets && _packState.subTargets[s])
        || packSubCounts(s, _packState.targets[s] || 0);
      return packSetSubTarget(s, sub, Math.max(0, (shown[sub] || 0) - 1));
    }
    const packKeep = e.target.closest("[data-pack-keep]");
    if (packKeep) { e.stopPropagation(); return packToggleKeep(packKeep.dataset.packKeep); }
    const packSwap1 = e.target.closest("[data-pack-swap1]");
    if (packSwap1) { e.stopPropagation(); return packSwapOne(packSwap1.dataset.packSwap1); }
    const packRerollSlotBtn = e.target.closest("[data-pack-rerollslot]");
    if (packRerollSlotBtn) return packRerollSlot(packRerollSlotBtn.dataset.packRerollslot);
    const packSel = e.target.closest("[data-pack-sel]");
    if (packSel) {
      e.stopPropagation();
      const id = packSel.dataset.packSel;
      if (_packSel.has(id)) _packSel.delete(id); else _packSel.add(id);
      return renderCapsules();
    }
    if (e.target.closest("[data-pack-swapsel]")) return packSwapSelected();
    if (e.target.closest("[data-pack-selclear]")) { _packSel.clear(); return renderCapsules(); }
    if (e.target.closest("[data-pack-occasions]")) return openPackContexts();
    if (e.target.closest("[data-pack-rebuild]")) return packRebuildFromProposal();
    if (e.target.closest("[data-pack-resolve]")) return packResolveUnlocked();
    if (e.target.closest("[data-pack-byday]")) return openTripPlan(capsuleId);
    if (e.target.closest("[data-pack-tight]")) return openPackModeSheet();
    if (e.target.closest("[data-pack-addany]")) return openPackAddSheet();
    const packSwap = e.target.closest("[data-pack-swap]");
    if (packSwap) return openPackSwapSheet(packSwap.dataset.packOcc, packSwap.dataset.packSwap);
    const packRerollBtn = e.target.closest("[data-pack-reroll]");
    if (packRerollBtn) return packReroll(packRerollBtn.dataset.packReroll);
    const packOpts = e.target.closest("[data-pack-options]");
    if (packOpts) return openPackOptionsSheet(packOpts.dataset.packOptions);
    const packOptsPage = e.target.closest("[data-pack-optspage]");
    if (packOptsPage) return openPackOptionsPage(packOptsPage.dataset.packOptspage);
    /* ---- the unified trip screen ---- */
    const tripSec = e.target.closest("[data-tripsec]");
    if (tripSec) { _tripSection = tripSec.dataset.tripsec; return renderCapsules(); }
    if (e.target.closest("[data-trip-more]")) return openTripMoreSheet();
    if (e.target.closest("[data-trip-tosetup]")) { _tripSection = "plan"; return renderCapsules(); }
    if (e.target.closest("[data-trip-ctx]")) {
      if (!_packState || _packState.cid !== capsuleId) packLoadState(capsuleId);
      return openPackContexts();
    }
    if (e.target.closest("[data-trip-definites]"))
      return openCapsulePicker(capsuleId, { mode: "definites",
        back: () => { capsuleView = "trip"; _tripSection = "plan"; renderCapsules(); } });
    if (e.target.closest("[data-trip-laundry]")) return openTripLaundrySheet();
    const tripMode = e.target.closest("[data-trip-mode]");
    if (tripMode) return (async () => {
      await savePackRecord(capsuleId, { mode: tripMode.dataset.tripMode });
      if (packRecord(capsuleId).built) {
        const st2 = packLoadState(capsuleId, { resolve: true });
        packEnsureSolve(st2, { force: true });
        await packPersist(capsuleId);
      }
      renderCapsules();
    })();
    if (e.target.closest("[data-trip-build]")) return (async () => {
      const cid = capsuleId;
      /* ⚠️ Whatever the Plan section is showing becomes HERS on build, so the
         pack isn't built on a guess that then re-guesses differently next time.
         Same rule the build sheet already followed. */
      if (!packTripContexts(cid))
        await setPackTripContexts(cid, packSuggestTripContexts(capsuleById.get(cid)));
      const st2 = packLoadState(cid, { resolve: true });
      packEnsureSolve(st2, { force: true });
      await packPersist(cid);
      _tripSection = "outfits";
      renderCapsules();
      toast(`${st2.pack.length} pieces → ${st2.res ? st2.res.assign.size : 0} outfits`);
    })();
    const packMoveDay = e.target.closest("[data-pack-moveday]");
    if (packMoveDay) return openPackMoveDaySheet(packMoveDay.dataset.packMoveday);
    const packBuildOcc = e.target.closest("[data-pack-buildocc]");
    if (packBuildOcc) return packBuildOccasion(packBuildOcc.dataset.packBuildocc);
    const packRuleClear = e.target.closest("[data-pack-ruleclear]");
    if (packRuleClear) return packClearOccRule(packRuleClear.dataset.packRuleclear);
    if (e.target.closest("[data-pack-optbuild]") && _packOptsOcc) return packBuildOccasion(_packOptsOcc);
    const packRather = e.target.closest("[data-pack-rather]");
    if (packRather) return openPackRatherSheet(packRather.dataset.packRather);
    const packChoose = e.target.closest("[data-pack-choose]");
    if (packChoose) return packChooseOutfit(packChoose.dataset.packChoose,
                                            packChoose.dataset.packIds.split(","));
    if (e.target.closest("[data-pack-reviewskip]")) return packSkipReview();
    const packLock = e.target.closest("[data-pack-lock]");
    if (packLock) return packToggleLock(packLock.dataset.packLock);
    const packSug = e.target.closest("[data-pack-suggest]");
    if (packSug) return packOpenSuggest(packSug.dataset.packSuggest);
    if (e.target.closest("[data-pack-ctx]")) return openPackContexts();
    // ⚠️ dropocc = take an OCCASION out of the trip; data-pack-drop below is a PIECE.
    const packDropOcc = e.target.closest("[data-pack-dropocc]");
    if (packDropOcc) { e.stopPropagation(); return packDropOccasion(packDropOcc.dataset.packDropocc); }
    const packDropBk = e.target.closest("[data-pack-dropbucket]");
    if (packDropBk) { e.stopPropagation(); return packDropBucket(packDropBk.dataset.packDropbucket); }
    if (e.target.closest("[data-pack-undrop]")) return packUndropAll();
    if (e.target.closest("[data-pack-daysfold]")) { _packDaysOpen = !_packDaysOpen; return renderCapsules(); }
    // The by-day planner shows the pack's outfits too, so this fires from there.
    const packWore = e.target.closest("[data-pack-wore]");
    if (packWore) { e.stopPropagation(); return packWoreOccasion(packWore.dataset.packWore, packWore.dataset.packDate); }
    const packTick = e.target.closest("[data-pack-tick]");
    if (packTick) { e.stopPropagation(); return togglePack(packTick.dataset.packTick).then(() => renderCapsules()); }
    const packDrop = e.target.closest("[data-pack-drop]");
    if (packDrop) { e.stopPropagation(); return packDropPiece(packDrop.dataset.packDrop); }
    const packAdd = e.target.closest("[data-pack-add]");
    if (packAdd) return packAddPiece(packAdd.dataset.packAdd);
    // create-form capture (fixed events)
    if (e.target.closest("[data-capanchor-add]")) { syncCapForm(); return openCapAnchorSheet(); }
    const capAnchDel = e.target.closest("[data-capanchor-del]");
    if (capAnchDel) {
      syncCapForm();
      _capForm.anchors.splice(parseInt(capAnchDel.dataset.capanchorDel), 1);
      return renderCapsules();
    }
    if (e.target.closest("[data-cap-byday]")) return openTripPlan(capsuleId);
    if (e.target.closest("[data-cap-recap]")) return openTripRecap(capsuleId);
    if (e.target.closest("[data-cap-plan]")) return planFromCapsule(capsuleId);
    if (e.target.closest("[data-cap-suggest]")) return openSuggestSheet(null, capsuleId);
    const planRemove = e.target.closest("[data-plan-remove]");
    if (planRemove) { e.stopPropagation(); return removePlanLook(capsuleId, planRemove.dataset.planDate, planRemove.dataset.planRemove); }
    const planWore = e.target.closest("[data-plan-wore]");
    if (planWore) { e.stopPropagation(); return planWoreIt(planWore.dataset.planDate, planWore.dataset.planWore); }
    const planOpen = e.target.closest("[data-plan-open]");
    if (planOpen) { looksLens = "All"; looksFolder = null; return openLookFrom(planOpen.dataset.planOpen); }
    const planFromBucket = e.target.closest("[data-plan-frombucket]");
    if (planFromBucket) return openBucketAssignSheet(planFromBucket.dataset.planFrombucket);
    const planLaun = e.target.closest("[data-plan-laundry]");
    if (planLaun) return togglePlanLaundry(capsuleId, planLaun.dataset.planLaundry);
    const planAssign = e.target.closest("[data-plan-assign]");
    if (planAssign) return openPlanLookPicker(planAssign.dataset.planAssign);
    const planSuggest = e.target.closest("[data-plan-suggest]");
    if (planSuggest) return openSuggestSheet(null, capsuleId, { capsuleId, date: planSuggest.dataset.planSuggest });
    const planBuild = e.target.closest("[data-plan-build]");
    if (planBuild) return openBuilder(null, null, { capsuleId, date: planBuild.dataset.planBuild });
    if (e.target.closest("[data-cap-add]")) return openCapsulePicker(capsuleId);
    if (e.target.closest("[data-cap-look-add]")) return openCapsuleLookPicker();
    const capLook = e.target.closest("[data-cap-look]");
    if (capLook) { looksLens = "All"; looksFolder = null; return openLookFrom(capLook.dataset.capLook); }
    if (e.target.closest("[data-cap-rename]")) return renameCapsule(capsuleId);
    if (e.target.closest("[data-cap-dates]")) return editCapsuleDates(capsuleId);
    if (e.target.closest("[data-cap-dup]")) return duplicateCapsule(capsuleId);
    if (e.target.closest("[data-cap-share]")) return shareCapsuleList(capsuleId);
    if (e.target.closest("[data-cap-del]")) return deleteCapsule(capsuleId);
    if (e.target.closest("[data-cap-archtoggle]")) { _capArchiveOpen = !_capArchiveOpen; return renderCapsules(); }
    if (e.target.closest("[data-cap-arch]")) {
      // Capture the id — capsuleId moves when we drop back to the list, and the
      // Undo closure must still point at the capsule she just archived.
      const cid = capsuleId;
      const on = !isCapsuleArchived(cid);
      const c = capsuleById.get(cid);
      return setCapsuleArchived(cid, on).then(() => {
        capsuleView = "list";
        renderCapsules();
        toast(on ? `Archived · ${(c && c.name) || "capsule"}` : "Back in the list",
          on ? { label: "Undo", fn: () => setCapsuleArchived(cid, false).then(() => renderCapsules()) } : undefined);
      });
    }
    if (e.target.closest("[data-wx-refresh]")) {
      const c = capsuleById.get(capsuleId);
      if (c) { delete _wxCache[c.id]; const el = $("#wxStrip"); if (el) el.innerHTML = `<div class="wx-loading muted">Refreshing…</div>`; loadTripWeather(c); }
      return;
    }
    if (e.target.closest("[data-loc-add]")) return openLocationSheet(capsuleId);
    const locDel = e.target.closest("[data-loc-del]");
    if (locDel) { e.stopPropagation(); return removeLocation(capsuleId, parseInt(locDel.dataset.locDel)); }
    const sortBtn = e.target.closest("[data-capsort]");
    if (sortBtn) { _capSort = sortBtn.dataset.capsort; return renderCapsules(); }
    // The two grid narrowings answer different questions; only one at a time.
    if (e.target.closest("[data-cap-unpacked]")) { _capUnpackedOnly = !_capUnpackedOnly; _capUnwornOnly = false; return renderCapsules(); }
    if (e.target.closest("[data-cap-unworn]")) { _capUnwornOnly = !_capUnwornOnly; _capUnpackedOnly = false; return renderCapsules(); }
    if (e.target.closest("[data-cap-unworn-suggest]")) return openTripUnwornSuggest(capsuleId);
    const pickCat = e.target.closest("[data-pickcat]");
    if (pickCat) { _capPickCat = pickCat.dataset.pickcat === "__all__" ? null : pickCat.dataset.pickcat; _capPickSub = null; return renderPickerGrid(); }
    const pickSub = e.target.closest("[data-picksub]");
    if (pickSub) { _capPickSub = pickSub.dataset.picksub === "" ? null : pickSub.dataset.picksub; return renderPickerGrid(); }
    const pack = e.target.closest("[data-pack]");
    if (pack) { e.stopPropagation(); return togglePack(pack.dataset.pack); }
    const capItem = e.target.closest("[data-cap-item]");
    if (capItem) {
      // Swipe siblings = the capsule/trip pieces in the order they're shown.
      const ids = $$("#capsulesBody [data-cap-item]").map(b => b.dataset.capItem);
      const c = capsuleById.get(capsuleId);
      return openItemFrom(capItem.dataset.capItem, { cat: null, sub: null, siblings: ids, siblingLabel: c ? c.name : "Capsule" });
    }
    const pick = e.target.closest("[data-pick]");
    if (pick) return togglePick(pick.dataset.pick);
    const card = e.target.closest("[data-cap]");
    if (card) return openCapsule(card.dataset.cap);
  });

  // grid action bar
  $("#gbSelect").addEventListener("click", toggleSelectMode);
  $("#gbAll").addEventListener("click", selectAllVisible);
  $("#gbGrid").addEventListener("click", openGridPicker);
  $("#gbEdit").addEventListener("click", () => { if (selectedIds.size) openBulkEdit(); });
  $("#gbDelete").addEventListener("click", () => { if (selectedIds.size) deleteSelected(); });
  $("#gbMove").addEventListener("click", () => { if (selectedIds.size) openMoveSheet(); });
  $("#gbCapsule").addEventListener("click", () => { if (selectedIds.size) openCapsuleSheet(); });
  $("#gbLaundry").addEventListener("click", () => {
    if (!selectedIds.size) return;
    const m = laundryBulkMode();
    if (m === "hamper") bulkToHamper();
    else if (m === "washed") bulkMarkWashed();
  });
  $("#gridPickerPop").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cols]");
    if (b) setGridCols(+b.dataset.cols);
  });
  // close the density pop on outside tap
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#gbGrid") && !e.target.closest("#gridPickerPop")) $("#gridPickerPop").hidden = true;
  }, true);
  // bulk edit sheet
  $("#bulkBg").addEventListener("click", closeBulkEdit);
  // move sheet (also covers add-cat sheet which reuses the same container)
  $("#moveBg").addEventListener("click", () => {
    if (_capSheetMode) { closeCapsuleSheet(); }
    else if (_addCatMode) { _addCatMode = false; moveCatOpen = null; hideSheet("moveSheet"); }
    else closeMoveSheet();
  });

  // item action bar (photo view)
  $("#ibEdit").addEventListener("click", () => { if (detailId) openItemDetails(detailId); });
  $("#ibMove").addEventListener("click", () => { if (detailId) openItemMoveSheet(detailId); });
  $("#ibLog").addEventListener("click", () => { if (detailId) logWearToday(detailId); });
  $("#ibDelete").addEventListener("click", () => { if (detailId) deleteItem(detailId); });

  // field edit sheet
  $("#fieldBg").addEventListener("click", closeFieldSheet);

  // log wear / location sheet
  $("#logBg").addEventListener("click", () => { if (_locSheet) _locSheet = null; hideSheet("logSheet"); });

  // add item: field rows + category picker
  document.getElementById("tab-add").addEventListener("click", (e) => {
    const addField = e.target.closest("[data-add-field]");
    if (addField) { openAddFieldEdit(addField.dataset.addField); return; }
  });

  // header ＋ (home only) -> add item
  $("#headerAdd").addEventListener("click", () => switchTab("add"));

  // header gear -> settings
  $("#headerGear").addEventListener("click", () => switchTab("settings"));

  // tap the header (not its buttons) -> scroll to top, like the iOS status bar
  document.querySelector("header.bar").addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    smoothScrollTop();
  });

  // bottom-sheet swipe-down-to-dismiss (each .sheet has a sibling .sheet-bg whose
  // click handler does the real cleanup — we just trigger it past a drag threshold)
  [["bulkInner","bulkBg"],["moveInner","moveBg"],["fieldInner","fieldBg"],
   ["logInner","logBg"],["statsFilterInner","statsFilterBg"],["statsRangeInner","statsRangeBg"],
   ["qaSheetInner","qaSheetBg"],["filterSheetInner","filterSheetBg"]]
    .forEach(([s, b]) => wireSheetSwipe(s, b));

  // Global left-edge swipe (< 24px) → back, mirrors the on-screen back button
  const SHEET_IDS = ['bulkSheet','moveSheet','fieldSheet','logSheet',
                     'statsFilterSheet','statsRangeSheet','quickActSheet'];
  let _gswX = 0, _gswTracking = false;
  document.addEventListener('touchstart', e => {
    _gswTracking = e.touches[0].clientX < 24;
    if (_gswTracking) _gswX = e.touches[0].clientX;
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (!_gswTracking) return;
    _gswTracking = false;
    if (e.changedTouches[0].clientX - _gswX < 60) return;
    if (SHEET_IDS.some(id => { const el = document.getElementById(id); return el && !el.hidden; })) return;
    if (document.getElementById('clBack'))     closetBack();
    else if (document.getElementById('looksBack')) looksBack();
    else if (document.getElementById('stBack'))    statsNavBack();
    else if (calendarDay) { calendarDay = null; renderCalendarMonth($("#calendarBody")); navShallower("calendar"); }
  }, { passive: true });

  // Long-press on grid tile (500 ms) → quick-action sheet.
  // Long-press on the item-photo Log button (500 ms) → back-date picker
  // (a plain tap still logs today via the #ibLog click handler).
  let _lpTimer = null, _lpItemId = null, _lpFired = false;
  document.addEventListener('touchstart', e => {
    const ibLog = e.target.closest('#ibLog');
    if (ibLog) {
      _lpFired = false;
      _lpTimer = setTimeout(() => { _lpTimer = null; _lpFired = true; if (detailId) openLogWear(detailId); }, 500);
      return;
    }
    const tile = e.target.closest('.gtile[data-item]');
    if (!tile || selectMode) { _lpItemId = null; return; }
    _lpFired = false;
    _lpItemId = tile.dataset.item;
    _lpTimer  = setTimeout(() => { _lpTimer = null; _lpFired = true; openQuickActions(_lpItemId); }, 500);
  }, { passive: true });
  document.addEventListener('touchmove',  () => { clearTimeout(_lpTimer); _lpTimer = null; }, { passive: true });
  document.addEventListener('touchend',   () => { clearTimeout(_lpTimer); _lpTimer = null; }, { passive: true });
  // Suppress the click that fires immediately after a long-press completes
  document.addEventListener('click', e => { if (_lpFired) { _lpFired = false; e.stopPropagation(); } }, true);
}

// Swipe-down on a bottom sheet to dismiss it. Only engages when the sheet is
// scrolled to the top, so it doesn't fight with scrolling long sheet content.
function wireSheetSwipe(sheetId, bgId) {
  const sheet = document.getElementById(sheetId);
  if (!sheet) return;
  let startY = 0, dragging = false, dy = 0;
  sheet.addEventListener("touchstart", e => {
    if (sheet.scrollTop > 0) { dragging = false; return; }
    startY = e.touches[0].clientY; dragging = true; dy = 0;
    sheet.classList.add("dragging");
  }, { passive: true });
  sheet.addEventListener("touchmove", e => {
    if (!dragging) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    sheet.style.transform = dy ? `translateY(${dy}px)` : "";
  }, { passive: true });
  sheet.addEventListener("touchend", () => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove("dragging");
    // Past the dismiss threshold: leave the dragged offset in place so
    // hideSheet's close animation continues from where the finger let go.
    if (dy > 90) { const bg = document.getElementById(bgId); if (bg) bg.click(); }
    else sheet.style.transform = "";
  });
}

