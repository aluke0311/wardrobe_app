/* ===================================================================
   RENDER: THE TRIP SCREEN  (a dated capsule: your list + outfits from it)
   ===================================================================
   What a trip is, since 2026-08-10 r6: she gives the app the list of pieces
   she's taking, and the app proposes outfits made from THAT LIST and nothing
   else. Two sections, `TRIP_SECTIONS`. "Never invents or adds" is structural
   rather than a rule to remember — `suggestOutfits` only ever draws from the
   pool it is handed, so passing `capsuleItems(cid)` IS the guarantee.

   ⚠️ THE PACK SOLVER USED TO LIVE HERE AND IS GONE (2026-08-16, her call).
   It was switched off in r6 and left whole for one-commit reversibility; r7 then
   removed the last five surfaces that could still start it. It sat dormant for
   six days — 222 definitions, ~5,950 lines, ~40 wiring handlers for markup that
   no longer rendered, and a `savePackRecord` write that still hit the database
   every time she added an item to an older trip. Removing it is this file's own
   unhurried pass, as CLAUDE.md asked for; `git show 8a8c6e4` and the tag below
   have the whole thing if it is ever wanted back.
   ⚠️ What deliberately SURVIVES elsewhere and is NOT solver-derived: the by-day
   planner's manual planning, `tripUnwornNow`, `tripMissingPieces`, the suitcase
   hamper row, and the recap (all in js/08-trip-mode.js).

   ⚠️ `TRIP_SUGG_PAGE` must be declared BEFORE `_tripSuggShow`, which is
   initialised from it in a top-level statement — a `const` further down the file
   is still in its temporal dead zone when that runs, which is a boot-time
   ReferenceError. The order below is the original file's order for this reason.
   =================================================================== */
function tripLocForDate(locs, ds) {
  const specific = locs.filter(l => l.from && l.to && ds >= l.from && ds <= l.to);
  if (specific.length) return specific[specific.length - 1];
  const partial = locs.find(l => (l.from && !l.to && ds >= l.from) || (!l.from && l.to && ds <= l.to));
  if (partial) return partial;
  return locs.find(l => !l.from && !l.to) || locs[0];
}

function tripLegs(c) {
  if (!c || !c.start_date || !c.end_date) return [];
  const locs = c.locations || [];
  if (!locs.length) return [];
  const out = [];
  let curKey = null, curLoc = null, curDates = [];
  for (const ds of tripDates(c)) {
    const loc = tripLocForDate(locs, ds);
    const key = loc ? `${loc.lat},${loc.lon}` : null;
    if (key !== curKey) {
      if (curDates.length && curLoc) out.push({ loc: curLoc, dates: curDates });
      curKey = key; curLoc = loc; curDates = [ds];
    } else curDates.push(ds);
  }
  if (curDates.length && curLoc) out.push({ loc: curLoc, dates: curDates });
  return out;
}
// Every trip has at least one leg for solving purposes, even with no locations
// set (no weather, season only — labelled in the UI, never silently absorbed).

const TRIP_SECTIONS = ["list", "outfits", "plan"];
/* ⚠️ The by-day planner is a section only on a DATED trip — an undated capsule has
   no days to plan across, and it keeps its own standalone "Planned outfits" page
   reached from its detail view (2026-08-16, her ask: "travel capsule should have
   the day plan as a third tab, not hidden behind options"). */
const tripSectionsFor = (c) => isDatedTrip(c) ? TRIP_SECTIONS : ["list", "outfits"];
const TRIP_SECTION_LABEL = { list: "Your list", outfits: "Outfits", plan: "By day" };

let _tripSection = null;     // null = pick from what the trip has in it
/* ⚠️ Declared HERE, above their first use: `_tripSuggShow` is initialised from
   TRIP_SUGG_PAGE at load time, and a `const` further down the file is still in
   its temporal dead zone when that top-level statement runs. Function bodies
   could reference them from anywhere; a top-level initialiser cannot. */

const TRIP_SUGG_PAGE = 12;   // outfits added per "Show more"

const TRIP_SUGG_MAX = 120;   // hard cap on what we enumerate at once

// A trip whose last day has passed. Its outfits are history, not a proposal.

const tripIsOver = (c) => !!c && isDatedTrip(c) && c.end_date < todayStr();

function tripDefaultSection(c) {
  // Nothing in the list yet means there is nothing to propose from, so start
  // where the work is. Otherwise lead with the payoff.
  /* ⚠️ A FINISHED trip opens on the list, not on Outfits (2026-08-16). It used to
     open on "Outfits", proposing fresh outfits for a trip that ended weeks ago,
     while the recap — the one thing a past trip is actually for — sat 9th of 11
     rows in the ⋯ menu. The recap gets a real button below. */
  if (tripIsOver(c)) return "list";
  return capsuleItems(c.id).length ? "outfits" : "list";
}

function renderCapsuleTrip() {
  const c = capsuleById.get(capsuleId);
  if (!c) { capsuleView = "list"; return renderCapsuleList(); }
  const secs = tripSectionsFor(c);
  const sec = secs.includes(_tripSection) ? _tripSection : tripDefaultSection(c);
  const ph = tripPhase(c);
  const phaseLbl = ph === "pack" ? "Packing" : ph === "trip" ? "On the trip"
                 : ph === "unpack" ? "Just back" : capDateLabel(c);

  const seg = `<div class="cap-orgbar">
    <div class="cap-seg">
      ${secs.map(k => `<button data-tripsec="${k}" class="${sec === k ? "on" : ""}">${
        TRIP_SECTION_LABEL[k]}</button>`).join("")}
    </div>
    <button class="cap-chip" data-trip-more>⋯</button>
  </div>`;

  const body = sec === "list" ? tripListSectionHtml(c)
             : sec === "plan" ? capsulePlanBodyHtml(c)
             : tripOutfitsHtml(c);
  /* The payoff for a trip that has ENDED. Reuses `data-cap-recap`, already wired
     through CAPSULE_ACTIONS on the capsules delegation root — one implementation,
     not a second copy of the same action (the ⋯ menu row stays too). */
  const recap = tripIsOver(c)
    ? `<div style="padding:0 14px 12px"><button class="btn" data-cap-recap style="width:100%">📊 Trip recap</button></div>`
    : "";
  return capToolbar(`${c.name}${phaseLbl ? " · " + phaseLbl : ""}`, true) + seg + recap + body +
         `<div style="height:26px"></div>`;
}

/* The list IS the input, and the only input. Reuses the capsule detail page's
   own grid so the packed-ticks, sorting and thumbnails can't drift from it. */

function tripListSectionHtml(c) {
  const list = capsuleItems(c.id);
  const addBtn = (cls, style) => `<button class="${cls}" data-trip-add style="${style}">＋ Add items</button>`;
  if (!list.length) {
    return `<div class="placeholder"><b>Nothing in your list yet</b>
      <div>Add the pieces you're taking. Outfits get proposed from these and nothing else.</div>
      ${addBtn("btn", "margin-top:12px;width:auto;padding:0 18px")}</div>`;
  }
  const packedSet = new Set((capsuleLinkMap.get(c.id) || []).filter(l => l.packed).map(l => l.item_id));
  const packed = list.filter(i => packedSet.has(i.id)).length;
  const dirty = LAUNDRY_READY()
    ? (() => { const ls = laundryState();
               return list.filter(i => itemStatus(i) === "Available" && isDirty(i, ls)).length; })()
    : 0;
  return `<div class="pack-tip">${list.length} piece${list.length === 1 ? "" : "s"}${
      packed ? ` · ${packed} packed` : ""} · tap the circle on a piece to check it off</div>
    ${dirty ? `<div class="cap-launwarn">🧺 ${dirty} piece${dirty === 1 ? " is" : "s are"} in the hamper${
      /* Only before departure is it "wash before you pack" — mid-trip she is
         living out of the bag, and after it the trip is over (2026-08-16). */
      tripPhase(c) === "pack" ? " — wash before you pack" : ""}</div>` : ""}
    <div style="padding:0 14px 10px">${addBtn("btn btn-sec", "width:100%")}</div>
    ${capGroupsHtml(list, true, packedSet)}`;
}

/* ---- outfits from the list, and only from the list ------------------------
   ⚠️ IT CANNOT INVENT OR ADD A PIECE, and that is STRUCTURAL rather than a rule
   someone has to remember: `suggestOutfits` only ever draws from the pool it is
   handed, so passing the capsule's own members IS the guarantee. There is no
   second pool, no rack, no widen, no "beyond the bag" — the whole class of bug
   where the app quietly grew the suitcase cannot occur here.

   ⚠️ EXHAUSTIVE, NOT SAMPLED (`opts.all`). The sampled path exists to make a
   sheet feel fresh each time it opens; this is a list she browses, leaves and
   comes back to, so it is score-ordered and STABLE — the same outfits in the
   same order every time. That is what lets "I'll take that one" survive a
   screen change, and it's the same reason the rack is deterministic.

   ⚠️ `cleanOnly = FALSE`. Laundry is not a filter on a packing list — she washes
   before she leaves, and hiding a piece she's about to pack would be the app
   deciding something behind her. The hamper count is stated on the list instead.

   ⚠️ Cohesion still applies. `formalityOk` + `comboSharesALevel` are inside
   `suggestOutfits`, so a proposal is never three pieces with no level in common.
   The engine's judgment about what goes together is the one thing worth keeping. */

let _tripSuggLevel = null;               // session-only formality ask

let _tripSuggShow = TRIP_SUGG_PAGE;      // how many are on screen right now

function tripOutfitPool(c) {
  return capsuleItems(c.id).filter(i => itemStatus(i) !== "Archive");
}

function tripOutfitCombos(c, pool = null) {
  const list = pool || tripOutfitPool(c);
  if (!list.length) return [];
  // Season anchors on the trip, not on today — packing in August for October.
  const season = c.start_date ? seasonOf(c.start_date) : currentSeason();
  return suggestOutfits(_tripSuggLevel, null, list, season, null, null, false, null, null,
                        { all: true, uniqueCap: TRIP_SUGG_MAX });
}

function tripOutfitsHtml(c) {
  const list = tripOutfitPool(c);
  if (!list.length) {
    return `<div class="placeholder"><b>Nothing to work with yet</b>
      <div>Add the pieces you're taking and outfits get proposed from them.</div>
      <button class="btn" data-trip-add style="margin-top:12px;width:auto;padding:0 18px">＋ Add items</button></div>`;
  }
  const combos = tripOutfitCombos(c, list);

  /* Only offer a level this list can actually BUILD at, so a chip can never come
     back empty — an empty result reads as a broken filter, not as an answer.
     ⚠️ `poolCoversLevel`, NOT "some piece's set contains the level". Those are
     different questions and the difference is the whole 2026-08-04 r2 empty-sheet
     bug: heels and a silk cami put 6 in the covered set while the list holds no
     level-6 bottom, so a "6. Dressed Up" chip rendered and returned nothing.
     Caught here by rendering the screen and counting, not by reading the code. */
  const chips = `<div class="pack-chiprow" style="padding:0 14px 8px">
    <button class="cap-chip${_tripSuggLevel == null ? " on" : ""}" data-trip-lvl="">All</button>
    ${OCCASION_LADDER.map((lbl, idx) => poolCoversLevel(idx + 1, list)
      ? `<button class="cap-chip${_tripSuggLevel === idx + 1 ? " on" : ""}" data-trip-lvl="${idx + 1}">${idx + 1}. ${esc(lbl)}</button>`
      : "").join("")}
  </div>`;

  const own = `<div style="padding:0 14px 10px">
    <button class="btn btn-sec" data-trip-buildown style="width:100%">✎ Build one yourself from the list</button></div>`;

  if (!combos.length) {
    /* ⚠️ TWO DIFFERENT DEAD ENDS, AND ONE MESSAGE USED TO COVER BOTH (2026-08-13).

       The level chips above are gated on `poolCoversLevel` precisely so a chip
       can never come back empty — but the "All" chip is NOT gated, so it is the
       only one that can, and the copy it landed on read "try All" while All was
       the chip already selected. Reachable on day one of essentially every trip:
       add three tops before anything else and the screen renders a one-option
       filter above advice to use that option.

       On a LEVEL, "try All" is real advice. On All, the honest answer is what the
       list is short of — the engine needs shoes, plus either a dress or a
       top-and-bottom (see suggestOutfits' two combo loops), so that is what gets
       named rather than a generic shrug. */
    const have = new Set(list.map(i => suggestSlot(i)));
    const missing = [];
    if (!have.has("Shoes")) missing.push("shoes");
    if (!have.has("Dresses") && !(have.has("Tops") && have.has("Bottoms")))
      missing.push(have.has("Tops") ? "a bottom" : have.has("Bottoms") ? "a top" : "a top and a bottom");
    const onAll = _tripSuggLevel == null;
    const head = onAll ? "Not a complete outfit yet" : "No complete outfit at that level";
    const body = onAll
      ? (missing.length
          ? `Your list needs ${esc(missing.join(" and "))} before it can make one.`
          : "Nothing in the list goes together yet — the pieces share no formality level.")
      : "Your list doesn't cover it yet — tap All, or add a piece.";
    return `<div class="pack-tip">${list.length} piece${list.length === 1 ? "" : "s"} in your list</div>
      ${chips}${own}
      <div class="placeholder" style="padding:30px 32px"><b>${head}</b>
        <div>${body}</div></div>`;
  }

  const shown = combos.slice(0, _tripSuggShow);
  const cards = shown.map(cb => {
    const ids = cb.pieces.map(p => p.id);
    // Already a real look? Say so rather than offering to save it twice —
    // saveComboAsOutfit would merge anyway, but the card would be lying.
    const dup = findDuplicateOutfit(ids, null);
    const idAttr = esc(ids.join(","));
    return `<div class="pack-occ">
      <div class="pack-pieces">
        ${cb.pieces.map(i => `<button class="pack-piece" data-trip-piece="${esc(i.id)}">
          ${thumbHtml(i.image_path, "pack-pthumb")}
          <div class="pack-pname">${esc(i.name || "Untitled")}</div>
        </button>`).join("")}
      </div>
      <div class="pack-occ-acts">
        ${dup
          ? `<button class="plan-act" data-trip-openlook="${esc(dup.id)}">✓ Saved · open it</button>`
          : `<button class="plan-act" data-trip-save="${idAttr}">＋ Save as a look</button>`}
        <button class="plan-act" data-trip-edit="${idAttr}">✎ Change it</button>
      </div>
    </div>`;
  }).join("");

  const left = combos.length - shown.length;
  const more = left > 0
    ? `<div style="padding:0 14px 10px"><button class="btn btn-sec" data-trip-showmore style="width:100%">Show ${Math.min(TRIP_SUGG_PAGE, left)} more</button></div>`
    : "";

  return `<div class="pack-tip">${combos.length}${combos.length >= TRIP_SUGG_MAX ? "+" : ""} outfit${
      combos.length === 1 ? "" : "s"} from your ${list.length} piece${list.length === 1 ? "" : "s"}${
      _tripSuggLevel ? ` at ${esc(occLabel(_tripSuggLevel))}` : ""}</div>
    ${chips}${own}${cards}${more}`;
}

/* The Plan section: what the trip needs, what's definitely coming, how much to
   bring. This is the build sheet's content, no longer trapped in a modal — it
   was the only place definites could be set BEFORE a build, which made the one
   genuine pre-build input the hardest thing to find. */

function openTripMoreSheet() {
  const c = capsuleById.get(capsuleId);
  if (!c) return;
  const row = (act, label, sub) => `<button class="sheet-row" data-tripmore="${esc(act)}">
    <span>${label}${sub ? `<div class="muted" style="font-size:12px;font-weight:400">${esc(sub)}</div>` : ""}</span></button>`;
  $("#moveInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="tripMoreCancel">Close</button>
      <h2>${esc(c.name)}</h2>
      <span style="width:54px"></span>
    </div>
    ${row("add", "＋ Add items", "Browse your closet")}
    ${row("byday", "📅 By-day plan", "Day cards, wash days, wore-it")}
    ${row("detail", "📍 Locations & weather", (c.locations || []).length
        ? (c.locations || []).map(l => l.name).join(", ") : "None set")}
    ${row("rename", "Rename")}
    ${row("dates", "Dates", capDateLabel(c) || "Not set")}
    ${row("dup", "Duplicate")}
    ${row("share", "Share list")}
    ${completedTrips().some(x => x.id === c.id) ? row("recap", "Trip recap") : ""}
    ${row("arch", isCapsuleArchived(c.id) ? "Unarchive" : "Archive")}
    ${row("del", "Delete trip")}`;
  showSheet("moveSheet");
  $("#tripMoreCancel").onclick = () => hideSheet("moveSheet");
  /* ⚠️ WIRED DIRECTLY, because the delegated handlers CANNOT see this sheet
     (2026-08-10 r3, her report: "tapping 'by day plan' from the three dot menu
     doesn't do anything"). That listener is on `#capsulesBody` and this renders
     into `#moveInner`, which is outside it — so the data attributes these rows
     carried reached nothing at all, and every row here was dead except
     Locations, which happened to have its own onclick.
     The "one implementation" the old comment claimed is real now: CAPSULE_ACTIONS
     is what the delegated handler calls too. */
  const cid = c.id;
  $("#moveInner").querySelectorAll("[data-tripmore]").forEach(b => {
    b.onclick = () => {
      hideSheet("moveSheet");
      const act = b.dataset.tripmore;
      if (act === "detail") { capsuleId = cid; capsuleView = "detail"; return renderCapsules(); }
      const fn = CAPSULE_ACTIONS[act];
      if (fn) { capsuleId = cid; fn(cid); }
    };
  });
}

function openCapAnchorSheet() {
  const opts = contextOptions();
  let date = _capForm && _capForm.start_date ? _capForm.start_date : todayStr();
  let picked = null;
  const render = () => {
    $("#moveInner").innerHTML = `
      <div class="sheet-hdr">
        <button class="lnk" id="capAnchCancel">Cancel</button>
        <h2>Fixed event</h2>
        <span style="width:54px"></span>
      </div>
      <div class="sheet-note">Something already on the calendar for this trip — a wedding, a concert. It'll shape what gets packed.</div>
      <div style="padding:8px 16px">
        <label class="fld">Date</label>
        <input class="inp" type="date" id="capAnchDate" value="${esc(date)}">
        <label class="fld" style="margin-top:12px">What is it</label>
      </div>
      ${opts.map(o => `<button class="sheet-row${picked === o ? " on" : ""}" data-capanch="${esc(o)}">
        <span>${picked === o ? "✓ " : ""}${esc(o)}</span>
        <span class="rt">${esc(OCCASION_LADDER[(contextFormalityLevel(o) || CONTEXT_FORMALITY_SEED[o] || 3) - 1] || "")}</span>
      </button>`).join("")}
      <div style="padding:12px 16px 16px">
        <button class="btn" id="capAnchAdd"${picked ? "" : " disabled style=\"opacity:.45\""}>
          ${picked ? `Add ${esc(picked)}` : "Pick one above"}
        </button>
      </div>
      <div style="height:max(env(safe-area-inset-bottom),10px)"></div>`;
    $("#capAnchCancel").onclick = () => hideSheet("moveSheet");
    const di = $("#capAnchDate"); if (di) di.onchange = () => { date = di.value; };
    $("#moveInner").querySelectorAll("[data-capanch]").forEach(b => {
      // Tapping the selected one clears it — a control that can only turn on is a trap.
      b.onclick = () => { picked = picked === b.dataset.capanch ? null : b.dataset.capanch; render(); };
    });
    const addBtn = $("#capAnchAdd");
    if (addBtn) addBtn.onclick = () => {
      if (!picked) return;
      const d = $("#capAnchDate");
      const useDate = (d && d.value) || date;
      if (!useDate) { toast("Pick a date"); return; }
      _capForm.anchors = (_capForm.anchors || []).concat([{ date: useDate, context: picked }]);
      hideSheet("moveSheet");
      renderCapsules();
    };
  };
  render();
  showSheet("moveSheet");
}

/* ===================================================================
   THE BUILDER GRADES ITSELF — surfaced on the trip recap.
   An engine that reports its own hit rate is one she can calibrate against.
   =================================================================== */

