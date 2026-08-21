/* ===================================================================
   CALENDAR
   =================================================================== */
let calendarYear  = new Date().getFullYear();
let calendarMonth = new Date().getMonth(); // 0-based
let calendarDay   = null; // null = month view | "YYYY-MM-DD" = day view

const CAL_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const CAL_DOW    = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// Build: date-string → [wear]
function wearDayMap() {
  const m = new Map();
  for (const w of wears) {
    if (!w.worn_on) continue;
    let a = m.get(w.worn_on); if (!a) { a = []; m.set(w.worn_on, a); }
    a.push(w);
  }
  return m;
}

// For one date: [{outfitId, itemIds, wearIds}] grouped by outfit_id (null = solo per item)
function dayGroups(dateStr) {
  const byKey = new Map();
  for (const w of wears) {
    if (w.worn_on !== dateStr) continue;
    const key = w.outfit_id || `__${w.item_id}`;
    if (!byKey.has(key)) byKey.set(key, { outfitId: w.outfit_id, itemIds: [], wearIds: [], context: [] });
    const g = byKey.get(key);
    if (!g.itemIds.includes(w.item_id)) g.itemIds.push(w.item_id);
    g.wearIds.push(w.id);
    for (const c of ctxArr(w)) if (!g.context.includes(c)) g.context.push(c);
  }
  return [...byKey.values()];
}

// Mini calendar-cell collage (aspect-ratio 3/4, 2-col grid)
// V3 "On this day": most recent prior year with wears on this same date —
// quiet payoff for the years of history, and passive resurfacing. Extracted
// from the calendar day view (Round C) so Home can show it too; renders "" when
// there's no prior year, which is what keeps it from becoming noise.
function onThisDayHtml(dateStr) {
  const mmdd = dateStr.slice(4);
  const priorDates = [...new Set(wears
    .filter(w => w.worn_on && w.worn_on.slice(4) === mmdd && w.worn_on < dateStr)
    .map(w => w.worn_on))].sort().reverse();
  if (!priorDates.length) return '';
  const pd = priorDates[0];
  const pGroups = dayGroups(pd);
  const g = pGroups[0];
  const ctxs = [...new Set(pGroups.flatMap(gr => gr.context))];
  const nItems = new Set(wears.filter(w => w.worn_on === pd).map(w => w.item_id)).size;
  const detail = ctxs.length ? ctxs.join(', ') : `${nItems} item${nItems === 1 ? '' : 's'}`;
  const collage = g ? calCellCollageHtml(g.itemIds, g.outfitId ? outfitById.get(g.outfitId) : null) : '';
  // .otd-memory: this is a fact about the past, not an action. Sharing the
  // plain .otd-row look with the day view's "Wear it ✓" row made a memory and a
  // database write indistinguishable (2026-07-26 audit H1). Used on Home too,
  // where this row was already documented as delight rather than attention.
  return `<button class="otd-row otd-memory" data-otd="${esc(pd)}">
    <div class="otd-collage">${collage}</div>
    <div class="otd-text">
      <div class="otd-title">On this day in ${esc(pd.slice(0, 4))}</div>
      <div class="otd-sub">${esc(detail)}</div>
    </div>
    <svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:var(--muted);stroke-width:2;fill:none;flex:none"><path d="M9 6l6 6-6 6"/></svg>
  </button>`;
}

function calCellCollageHtml(itemIds, outfit) {
  const canvas = outfit && layoutCanvasHtml(outfit, "cal-ccanvas");
  if (canvas) return canvas;
  const pieces = itemIds.map(id => itemById.get(id)).filter(Boolean).slice(0, 4);
  if (!pieces.length) return '';
  const cells = pieces.map((p, i) => {
    const span = pieces.length === 3 && i === 2 ? ' span2' : '';
    return `<div class="cal-cp${span}" data-photo="${esc(p.image_path || '')}"></div>`;
  }).join('');
  return `<div class="cal-ccoll${pieces.length === 1 ? ' solo' : ''}">${cells}</div>`;
}

// Day-view outfit collage (88×88 square, 2-col grid). `tappable` (solo-item
// cards only — look cards open the look instead) makes each cell open its item.
function calOutfitCollageHtml(itemIds, outfit, tappable) {
  const canvas = outfit && layoutCanvasHtml(outfit, "cal-outfit-canvas");
  if (canvas) return canvas;
  const pieces = itemIds.map(id => itemById.get(id)).filter(Boolean).slice(0, 4);
  if (!pieces.length) return '<div class="cal-outfit-collage" style="background:var(--panel)"></div>';
  const cells = pieces.map(p =>
    `<div class="cal-outfit-piece" data-photo="${esc(p.image_path || '')}"${tappable ? ` data-cal-item="${esc(p.id)}" style="cursor:pointer"` : ''}></div>`).join('');
  return `<div class="cal-outfit-collage${pieces.length === 1 ? ' solo' : ''}">${cells}</div>`;
}

// Most-worn item in current calendar month
function calMostWorn() {
  const prefix = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}`;
  const counts = countByDay(wears, w =>
    w.worn_on.startsWith(prefix) && w.item_id ? [w.item_id] : []);
  if (!counts.size) return null;
  const [topId, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { item: itemById.get(topId), count: topCount };
}

// Consecutive-day wear streak ending today
function calStreak() {
  const worn = new Set(wears.map(w => w.worn_on));
  const d = new Date(); let streak = 0;
  while (worn.has(localISO(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

/* ⚠️ The Month / "Plan the week" mode bar is gone (2026-08-21) along with the
   week planner itself — the Calendar tab is the month and the day, nothing
   else. `calendarMode` went with it. */
function renderCalendar() {
  const body = $('#calendarBody');
  if (calendarDay) renderCalendarDay(body);
  else renderCalendarMonth(body);
}

function renderCalendarMonth(body) {
  const todayStr    = localISO(new Date());
  const year        = calendarYear, month = calendarMonth;
  const firstDoW    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dayMap      = wearDayMap();

  // Build grid cells
  let cells = '';
  for (let i = 0; i < firstDoW; i++) cells += `<div class="cal-cell other-month"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds       = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayWears = dayMap.get(ds) || [];
    const isToday  = ds === todayStr;
    let collage = '';
    if (dayWears.length) {
      const firstOutfitId = dayWears.find(w => w.outfit_id)?.outfit_id;
      const itemIds = firstOutfitId
        ? (outfitItemMap.get(firstOutfitId) || [])
        : [...new Set(dayWears.map(w => w.item_id))];
      collage = calCellCollageHtml(itemIds.slice(0, 4), firstOutfitId ? outfitById.get(firstOutfitId) : null);
    }
    /* A planned day carries a dot, so a commitment is visible from the month
       without opening each date. Nothing lived is marked — the collage already
       says that — and a plan fulfilled by a real wear stops being news. */
    const planned = !dayWears.length && ds >= todayStr && dayPlan(ds).length;
    cells += `<div class="cal-cell${isToday ? ' today-cell' : ''}">
      <button class="cal-cell-btn" data-calday="${esc(ds)}">
        <div class="cal-daynum${isToday ? ' is-today' : ''}">${d}</div>
        ${collage}
        ${planned ? `<div class="cal-planned" aria-label="Planned"></div>` : ''}
      </button>
    </div>`;
  }
  const trailing = (7 - ((firstDoW + daysInMonth) % 7)) % 7;
  for (let i = 0; i < trailing; i++) cells += `<div class="cal-cell other-month"></div>`;

  // Stats
  const mw     = calMostWorn();
  const streak = calStreak();
  const mwHtml = mw?.item ? `
    <div class="cal-stat">
      <div class="cal-stat-img"${mw.item.image_path ? ` data-photo="${esc(mw.item.image_path)}"` : ''}></div>
      <div>
        <div class="cal-stat-lbl">Most Worn This Month</div>
        <div class="cal-stat-sub">${mw.count} day${mw.count !== 1 ? 's' : ''}</div>
      </div>
    </div>` : '';
  const streakHtml = `
    <div class="cal-stat">
      <div class="cal-stat-ico"><svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>
      <div>
        <div class="cal-stat-lbl">${streak} Day Streak</div>
        <div class="cal-stat-sub">Continuous calendar recording</div>
      </div>
      ${streak ? `<div class="cal-stat-chev"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></div>` : ''}
    </div>`;

  body.innerHTML = `<div class="tabbody">
    <div class="cal-nav">
      <button class="cal-nav-btn" id="calPrev"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
      <div class="cal-month-lbl"><strong>${CAL_MONTHS[month]}</strong> <em>${year}</em></div>
      <button class="cal-nav-btn" id="calNext"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>
    </div>
    <div class="cal-dow">${CAL_DOW.map(h => `<div class="cal-dow-h">${h}</div>`).join('')}</div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-stats">${mwHtml}${streakHtml}</div>
  </div>`;

  body.onclick = e => {
    if (e.target.closest('#calPrev')) {
      calendarMonth--; if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
      renderCalendarMonth(body); return;
    }
    if (e.target.closest('#calNext')) {
      calendarMonth++; if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
      renderCalendarMonth(body); return;
    }
    const btn = e.target.closest('[data-calday]');
    // Tapping a day opens the day (2026-07-26 audit C3). It used to open a sheet
    // offering "View day / + Add clothing / + Add look" — a menu choosing between
    // the one thing she always wants and two things already in the day footer,
    // one screen deeper. On an empty future date that sheet's entire content was
    // the words "Nothing logged yet".
    // navDeeper belongs HERE, on the real navigation. Firing it on sheet-open
    // scrolled the month grid to the top behind the sheet, and Cancel had no
    // matching navShallower — so every backed-out day tap leaked a stack entry
    // and desynced the offsets for the next real back.
    if (btn) { navDeeper('calendar'); calendarDay = btn.dataset.calday; renderCalendarDay(body); }
  };

  hydratePhotos(body);
}

function renderCalendarDay(body) {
  const dateStr = calendarDay;
  const [y, m, d] = dateStr.split('-').map(Number);
  const title   = `${CAL_MONTHS[m - 1]} ${d}, ${y}`;
  const groups  = dayGroups(dateStr);
  const isFuture = dateStr > todayStr();

  const cardsHtml = groups.length ? groups.map(g => {
    const outfit  = g.outfitId ? outfitById.get(g.outfitId) : null;
    const collage = calOutfitCollageHtml(g.itemIds, outfit, !g.outfitId);
    const notes   = outfit?.notes || '';
    const wearIdsStr = g.wearIds.join(',');
    return `<div class="cal-outfit-card">
      <div class="cal-outfit-inner">
        ${g.outfitId ? `<div data-open-look="${esc(g.outfitId)}" style="cursor:pointer;position:relative">${collage}
          <button class="cal-heart-btn${outfit && outfit.rating === 1 ? ' on' : ''}" data-cal-heart="${esc(g.outfitId)}" title="Like this look"><svg viewBox="0 0 24 24">${HEART_SVG}</svg></button>
        </div>` : collage}
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:9px">
          <button class="cal-outfit-notes-btn${notes ? ' has-notes' : ''}" data-cal-notes="${esc(g.outfitId || '')}" style="flex:none">
            <span>${esc(notes || 'Tap to add notes')}</span>
            <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
          </button>
          ${(() => {
            const has = g.context.length > 0;
            return `<button class="cal-ctx-btn${has ? ' has-ctx' : ''}" data-cal-ctx="${esc(g.wearIds.join(','))}"
            style="display:flex;align-items:center;gap:6px;background:none;border:none;text-align:left;padding:0;cursor:pointer">
            <svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:${has ? 'var(--accent)' : 'var(--muted)'};stroke-width:2;fill:none;flex:none"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
            <span style="font-size:13px;color:${has ? 'var(--accent)' : 'var(--muted)'};font-weight:${has ? '600' : '400'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${has ? esc(g.context.join(', ')) : 'Add context'}</span>
          </button>`;
          })()}
          <button class="cal-ctx-btn" data-cal-wd="${esc(wearIdsStr)}"
            style="display:flex;align-items:center;gap:6px;background:none;border:none;text-align:left;padding:0;cursor:pointer">
            <span style="font-size:13px;color:var(--muted)">✨ What this wear changed</span>
          </button>
        </div>
      </div>
      <div class="cal-swipe-acts">
        <button class="cal-act cal-act-copy" data-calact="copy" data-wear-ids="${esc(wearIdsStr)}" data-outfit-id="${esc(g.outfitId || '')}">
          <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          Copy
        </button>
        <button class="cal-act cal-act-move" data-calact="move" data-wear-ids="${esc(wearIdsStr)}" data-outfit-id="${esc(g.outfitId || '')}">
          <svg viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
          Move
        </button>
        ${g.outfitId ? `<button class="cal-act cal-act-split" data-cal-split="${esc(wearIdsStr)}" data-outfit-id="${esc(g.outfitId)}">
          <svg viewBox="0 0 24 24"><path d="M12 3v6"/><path d="M6 21a3 3 0 100-6 3 3 0 000 6z"/><path d="M18 21a3 3 0 100-6 3 3 0 000 6z"/><path d="M12 9c0 3-4 3-6 6"/><path d="M12 9c0 3 4 3 6 6"/></svg>
          Split
        </button>` : ''}
        <button class="cal-act cal-act-del" data-wear-ids="${esc(wearIdsStr)}">
          <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          Delete
        </button>
      </div>
    </div>`;
  }).join('')
  /* ⚠️ ON A FUTURE DAY "Nothing logged for this day" IS THE WRONG SENTENCE, and
     it is the exact sentence from her report (2026-08-06 r4: the pack packed for
     a wedding and *"there is no such wedding"* — there was, in `dayplan`, and
     this line is what the calendar said instead of showing it). r4 fixed the
     plan row underneath and left this above it, so a declared future day STILL
     opens by announcing that nothing is there, with the plan below the fold of
     the sentence denying it. You cannot log a day you haven't lived, so on a
     future date this is never the point: if there's a plan, the plan row says
     everything and this is pure noise; if there isn't, the honest empty state is
     about planning, not logging. */
  : (isFuture
      ? (dayPlan(dateStr).length ? ''
         : `<div class="cal-day-empty">Nothing planned for this day yet.</div>`)
      : `<div class="cal-day-empty">Nothing logged for this day.</div>`);

  const prevD    = localISO(new Date(y, m - 1, d - 1));
  const nextD    = localISO(new Date(y, m - 1, d + 1));

  const onThisDay = onThisDayHtml(dateStr);

  body.innerHTML = `<div class="tabbody">
    <div class="cal-day-header">
      <button id="calDayBack" style="color:var(--accent);font-size:15px;font-weight:500">Back</button>
      <div style="font-size:16px;font-weight:600">Day View</div>
      <button id="calDayEdit" style="color:var(--accent);font-size:15px;font-weight:500;opacity:.4">Edit</button>
    </div>
    <div class="cal-day-nav">
      <button class="cal-day-nav-btn" id="calDayPrev"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
      <div class="cal-day-title">${esc(title)}</div>
      <button class="cal-day-nav-btn" id="calDayNext"${isFuture ? ' disabled style="opacity:.4"' : ''}><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>
    </div>
    ${cardsHtml}
    ${(() => {
      const soloGroups = groups.filter(g => !g.outfitId);
      const soloCount  = [...new Set(soloGroups.flatMap(g => g.itemIds))].length;
      return soloCount >= 2
        ? `<button class="cal-make-look-btn" id="calMakeLook">
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
            Create look from these ${soloCount} items
           </button>`
        : '';
    })()}
    ${/* ⚠️ A PLAN YOU CAN'T SEE IS A COMMITMENT THE APP KEEPS AND YOU DON'T
          (2026-08-06 r4, her report: the pack was packing for a wedding, and
          *"there is no such wedding"* — there was, in `dayplan`, and the
          calendar said "Nothing logged for this day").

          Two gates hid it. The row only rendered when the date was TODAY, and
          only when the entry had an OUTFIT attached — so a context declared for
          a future day, which is exactly what the trip builder and the rack read,
          rendered nothing anywhere. It could only be found by opening that one
          day and pressing 📅 Plan.

          ⚠️ THIS IS NOW THE ONLY PLACE A FUTURE PLAN IS VISIBLE (2026-08-21).
          Everything that used to SET one — the day-plan sheet, the week planner,
          the Tomorrow card — went with the planning-ahead removal; the suggester's
          "Plan for Thu" is the single writer left, and this row is what makes it
          worth writing. So the row also owns REMOVING a plan, which the day-plan
          sheet used to: without that, setting a wrong day would be permanent.
          A plan she has already worn stops rendering — the wear card above says
          it better. */ ""}
    ${dateStr >= todayStr() ? dayPlan(dateStr).map((e, idx) => {
      const o = e.outfit ? outfitById.get(e.outfit) : null;
      if (o && planWorn(dateStr, o.id)) return "";
      const ctxs = (e.contexts || []).filter(Boolean).join(", ");
      const lvl = e.level ? occLabel(e.level) : null;
      // ⚠️ Nothing writes a context-only entry any more, but old ones exist in
      // her kv — they still render, and can still be cleared.
      const title = o ? outfitName(o) : (ctxs || (lvl ? `Dressing for ${lvl}` : "Planned"));
      const sub = o ? ctxs : (ctxs && lvl ? lvl : "no outfit picked yet");
      // ⚠️ "Wear it" is a today action — you can't log a day you haven't lived.
      const canWear = !!o && dateStr === todayStr() && !tripModeId;
      return `<div class="otd-row" style="gap:6px">
        ${o ? `<button class="otd-text" data-cal-plan-look="${esc(o.id)}" style="flex:1;text-align:left">
                 <div class="otd-title">\u{1F4C5} Planned: ${esc(title)}</div>
                 ${sub ? `<div class="otd-sub">${esc(sub)}</div>` : ""}
               </button>`
             : `<div class="otd-text" style="flex:1">
                 <div class="otd-title">\u{1F4C5} Planned: ${esc(title)}</div>
                 ${sub ? `<div class="otd-sub">${esc(sub)}</div>` : ""}
               </div>`}
        ${canWear ? `<button class="cap-chip" data-cal-plan-wear="${idx}" style="flex:none">Wear it \u2713</button>` : ""}
        <button class="cap-chip" data-cal-plan-drop="${idx}" style="flex:none;color:var(--muted)" title="Remove this plan">\u2715</button>
      </div>`;
    }).join("") : ""}
    <div class="cal-day-foot">
      <div class="cal-day-foot-ico"><svg viewBox="0 0 24 24"><path d="M16 4l-4 9-4-9"/><path d="M12 13l-9 7h18l-9-7z"/></svg></div>
      ${/* ⚠️ No "📅 Plan" button — planning a day happens in the outfit suggester
            now, and a future day has nothing else to add to it. */""}
      <div class="cal-day-foot-add">
        ${isFuture ? `<span>plan it from \u2728 What should I wear?</span>` : `
        <span>add more items:</span>
        <button id="calWearAgain">Wear again</button>
        <button id="calAddClothing">+ Clothing</button>
        <button id="calAddLook">+ Look</button>`}
      </div>
    </div>
    ${onThisDay}
  </div>`;

  body.onclick = null;  // clear any stale picker/month delegation
  $('#calDayBack').onclick = () => { calendarDay = null; renderCalendarMonth(body); navShallower('calendar'); };
  $('#calDayPrev').onclick = () => { calendarDay = prevD; renderCalendarDay(body); };
  if (!isFuture) $('#calDayNext').onclick = () => { calendarDay = nextD; renderCalendarDay(body); };
  // Absent on future dates — you can plan a day you haven't lived, not log it.
  // (The deleted day sheet gated these with the same rule; routing the month tap
  // straight here made future day views reachable for the first time.)
  if (!isFuture) {
    $('#calAddClothing').onclick = () => openCalAddClothing();
    $('#calAddLook').onclick     = () => openCalAddLook();
    $('#calWearAgain').onclick   = () => openWearAgainChooser(dateStr);
  }
  const makeLookBtn = $('#calMakeLook');
  if (makeLookBtn) makeLookBtn.onclick = () => makeLookFromDay(dateStr, body);
  body.querySelectorAll('[data-cal-plan-wear]').forEach(b => {
    b.onclick = () => wearPlannedEntry(dateStr, +b.dataset.calPlanWear);
  });
  body.querySelectorAll('[data-cal-plan-look]').forEach(b => {
    b.onclick = () => openLookFrom(b.dataset.calPlanLook);
  });
  body.querySelectorAll('[data-cal-plan-drop]').forEach(b => {
    b.onclick = async () => {
      const idx = +b.dataset.calPlanDrop;
      await saveDayPlan(dateStr, dayPlan(dateStr).filter((_, k) => k !== idx));
      renderCalendarDay(body);
      toast("Plan removed");
    };
  });

  // Horizontal swipe to navigate days; skip if touch starts on a swipeable card
  const _dayTb = body.querySelector('.tabbody');
  let _dswX = 0, _dswOk = false;
  _dayTb.addEventListener('touchstart', e => {
    if (e.target.closest('.cal-outfit-card')) { _dswOk = false; return; }
    _dswX = e.touches[0].clientX; _dswOk = true;
  }, { passive: true });
  _dayTb.addEventListener('touchend', e => {
    if (!_dswOk) return; _dswOk = false;
    const dx = e.changedTouches[0].clientX - _dswX;
    if (dx > 60) { calendarDay = prevD; renderCalendarDay(body); }
    else if (dx < -60 && !isFuture) { calendarDay = nextD; renderCalendarDay(body); }
  }, { passive: true });

  body.querySelectorAll('.cal-outfit-card').forEach(wireCalSwipe);

  body.querySelectorAll('.cal-act-del').forEach(btn => {
    btn.onclick = async () => {
      const ids = btn.dataset.wearIds.split(',').filter(Boolean);
      if (!ids.length) return;
      if (!confirm(`Remove ${ids.length} wear record${ids.length !== 1 ? 's' : ''}?`)) return;
      try {
        await rest(`wears?id=in.(${ids.map(id => `"${id}"`).join(',')})`, { method: 'DELETE' });
        wears = wears.filter(w => !ids.includes(w.id));
        buildOutfitWearMap();
        renderCalendarDay(body);
        toast('Removed');
      } catch (e) { toast(e.message); }
    };
  });

  body.querySelectorAll('[data-cal-split]').forEach(btn => {
    btn.onclick = () => {
      const wearIds  = (btn.dataset.calSplit || '').split(',').filter(Boolean);
      const outfitId = btn.dataset.outfitId || null;
      if (wearIds.length && outfitId) openSplitWearSheet(wearIds, outfitId, body);
    };
  });

  body.querySelectorAll('[data-calact]').forEach(btn => {
    btn.onclick = () => {
      const action   = btn.dataset.calact;
      const wearIds  = (btn.dataset.wearIds || '').split(',').filter(Boolean);
      if (!wearIds.length) return;
      const today = todayStr();
      $("#logInner").innerHTML = `
        <div class="sheet-hdr">
          <button class="lnk" id="calCpCancel">Cancel</button>
          <h2>${action === 'copy' ? 'Copy to…' : 'Move to…'}</h2>
          <button class="lnk" id="calCpSave" style="font-weight:700">${action === 'copy' ? 'Copy' : 'Move'}</button>
        </div>
        <div style="padding:20px 18px 30px">
          <label style="display:block;font-size:13px;color:var(--muted);margin-bottom:8px">New date</label>
          <input class="inp" id="calCpDate" type="date" value="${today}" max="${today}" style="width:100%;font-size:16px">
          ${action === 'move' ? `<div class="muted" style="font-size:13px;margin-top:10px">Original wear entries will be removed from ${esc(calendarDay)}.</div>` : ''}
        </div>`;
      showSheet("logSheet");
      $("#calCpCancel").onclick = () => { hideSheet("logSheet"); };
      $("#calCpSave").onclick = async () => {
        const newDate = $("#calCpDate").value;
        if (!newDate || newDate === calendarDay) { toast("Pick a different date"); return; }
        const origWears = wears.filter(w => wearIds.includes(w.id));
        if (!origWears.length) { hideSheet("logSheet"); return; }
        try {
          const payload = origWears.map(w => ({
            item_id: w.item_id, worn_on: newDate,
            ...(w.outfit_id ? { outfit_id: w.outfit_id } : {}),
          }));
          const rows = await rest("/wears", {
            method: "POST",
            headers: { "Content-Type": "application/json", Prefer: "return=representation" },
            body: JSON.stringify(payload),
          });
          if (Array.isArray(rows)) wears.push(...rows);
          if (action === 'move') {
            const idList = wearIds.map(id => `"${id}"`).join(',');
            await rest(`/wears?id=in.(${idList})`, { method: 'DELETE' });
            wears = wears.filter(w => !wearIds.includes(w.id));
          }
          buildOutfitWearMap();
          hideSheet("logSheet");
          toast(`${action === 'copy' ? 'Copied' : 'Moved'} to ${newDate}`);
          renderCalendarDay(body);
        } catch (e) { toast(e.message); }
      };
    };
  });

  body.querySelectorAll('[data-open-look]').forEach(el => {
    el.onclick = () => {
      const id = el.dataset.openLook;
      if (id && outfitById.has(id)) openLookFrom(id);  // open detail; back returns here
    };
  });

  // Solo-logged items: tap a collage cell to open the item (back returns here).
  body.querySelectorAll('[data-cal-item]').forEach(el => {
    el.onclick = () => {
      const it = itemById.get(el.dataset.calItem);
      if (it) openItemFrom(it.id, { cat: it.category, sub: it.subcategory });
    };
  });

  const otdBtn = body.querySelector('[data-otd]');
  if (otdBtn) otdBtn.onclick = () => { calendarDay = otdBtn.dataset.otd; renderCalendarDay(body); };

  // L2b: heart toggle on the day-view look card (stopPropagation so it doesn't
  // also trigger the parent [data-open-look] tap-to-open)
  body.querySelectorAll('[data-cal-heart]').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      const id = el.dataset.calHeart;
      if (!id) return;
      toggleLikeLook(id).then(r => el.classList.toggle("on", r === 1));
    };
  });

  body.querySelectorAll('[data-cal-notes]').forEach(el => {
    el.onclick = () => {
      const outfitId = el.dataset.calNotes;
      if (!outfitId) { toast('Notes are only available for saved looks'); return; }
      openCalNotes(outfitId, () => renderCalendarDay(body));
    };
  });

  body.querySelectorAll('[data-cal-wd]').forEach(el => {
    el.onclick = () => {
      const ids = (el.dataset.calWd || '').split(',').filter(Boolean);
      if (ids.length) openWearDetail(dateStr, ids);
    };
  });
  body.querySelectorAll('[data-cal-ctx]').forEach(el => {
    el.onclick = () => {
      const wearIds = (el.dataset.calCtx || '').split(',').filter(Boolean);
      if (!wearIds.length) return;
      const cur = [];
      for (const id of wearIds) {
        const w = wears.find(x => x.id === id);
        for (const c of ctxArr(w)) if (!cur.includes(c)) cur.push(c);
      }
      openContextSheet(wearIds, cur, () => renderCalendarDay(body));
    };
  });

  hydratePhotos(body);
}

// Set/change the contexts on a group of wear rows (calendar day card "after" flow).
function openContextSheet(wearIds, current, onSaved) {
  _ctxSel = Array.isArray(current) ? [...current] : []; _ctxAddOpen = false; _ctxSuggest = null;
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="ctxCancel">Cancel</button>
      <h2>Context</h2>
      <button class="lnk" id="ctxSave" style="font-weight:700">Save</button>
    </div>
    <div style="padding:18px 18px 30px">
      <div class="muted" style="font-size:13px;margin-bottom:4px">Where did you wear this?</div>
      ${contextPickerHtml()}
    </div>`;
  showSheet("logSheet");
  renderContextPicker();
  $("#ctxCancel").onclick = () => { hideSheet("logSheet"); };
  $("#ctxSave").onclick = async () => {
    const val = ctxSelOrNull();
    try {
      await rest(`/wears?id=in.(${wearIds.map(id => `"${id}"`).join(",")})`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ context: val }),
      });
      wears.forEach(w => { if (wearIds.includes(w.id)) w.context = val; });
      hideSheet("logSheet");
      toast(val ? `Marked as ${val.join(", ")}` : "Context cleared");
      if (onSaved) onSaved();
    } catch (e) { toast(e.message); }
  };
}

function wireCalSwipe(card) {
  const inner = card.querySelector('.cal-outfit-inner');
  const acts  = card.querySelector('.cal-swipe-acts');
  const W = (acts.querySelectorAll('.cal-act').length || 3) * 70;  // 70px per action
  let startX = 0, opened = false, tracking = false;

  card.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    tracking = true;
    inner.style.transition = 'none';
    acts.style.transition   = 'none';
  }, { passive: true });

  card.addEventListener('touchmove', e => {
    if (!tracking) return;
    const dx  = e.touches[0].clientX - startX;
    const off = Math.max(-W, Math.min(0, (opened ? -W : 0) + dx));
    inner.style.transform = `translateX(${off}px)`;
    acts.style.transform  = `translateX(${100 + (off / W * 100)}%)`;
  }, { passive: true });

  card.addEventListener('touchend', e => {
    if (!tracking) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - startX;
    inner.style.transition = 'transform .25s ease';
    acts.style.transition   = 'transform .25s ease';
    opened = opened ? dx < 30 : dx < -50;
    inner.style.transform = opened ? `translateX(-${W}px)` : 'translateX(0)';
    acts.style.transform  = opened ? 'translateX(0)' : 'translateX(100%)';
  }, { passive: true });
}

// "Split" sheet for an outfit-wear group on a calendar day. Three outcomes:
//   keep    → keep the outfit wear AND also log each piece as a separate solo
//             item wear for the day (day shows the outfit + each item).
//   delWear → replace the outfit wear with each piece as a solo item wear
//             (detach the rows from the outfit); keep the outfit record.
//   delBoth → delWear, then delete the outfit record too (warns re: other days).
// Lets a mistakenly-grouped day be rebuilt or cleared cleanly.
function openSplitWearSheet(wearIds, outfitId, body) {
  const o = outfitById.get(outfitId);
  const rows = wears.filter(w => wearIds.includes(w.id) && w.id);
  const nItems = new Set(rows.map(w => w.item_id)).size;
  // Other days this outfit is worn — deleting the outfit affects those too.
  const otherDays = new Set(wears.filter(w => w.outfit_id === outfitId && w.worn_on !== calendarDay).map(w => w.worn_on));
  /* ⚠️ Her rule for deciding: "almost always only want to delete it if there
     were no previous wears". So the number that matters isn't "other days" —
     it's how many wear-DAYS came BEFORE this one. Said in the header, not buried
     in a footnote, because it's the whole decision. */
  const priorDays = new Set(wears.filter(w => w.outfit_id === outfitId && w.worn_on && w.worn_on < calendarDay).map(w => w.worn_on)).size;
  const laterDays = otherDays.size - priorDays;
  const priorLine = priorDays
    ? `<b style="color:var(--danger)">${priorDays} wear${priorDays === 1 ? '' : 's'} before today</b>`
    : `<b>No wears before today</b>`;
  const delNote = otherDays.size
    ? `<div class="muted" style="font-size:12.5px;margin-top:12px;color:var(--danger)">Heads up: this look is also worn on ${otherDays.size} other day${otherDays.size === 1 ? '' : 's'}${laterDays > 0 ? ` (${priorDays} before today, ${laterDays} after)` : ''} — deleting the outfit unlinks those wears too (they stay as individual items).</div>`
    : '';
  const opt = (id, title, sub, danger) => `<button class="sheet-chip" id="${id}" style="width:100%;flex-direction:column;align-items:flex-start;gap:3px;height:auto;padding:12px 14px;text-align:left">
      <span style="font-weight:600${danger ? ';color:var(--danger)' : ''}">${title}</span>
      <span class="muted" style="font-size:12.5px;line-height:1.35;font-weight:400">${sub}</span>
    </button>`;
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="splCancel">Cancel</button>
      <h2>Split outfit</h2>
      <span style="width:52px"></span>
    </div>
    <div style="padding:16px 18px 30px">
      <div class="muted" style="font-size:13.5px;line-height:1.5;margin-bottom:18px">
        “${esc(o ? outfitName(o) : 'this look')}” · ${nItems} piece${nItems === 1 ? '' : 's'} on this day.<br>${priorLine}
      </div>
      <div class="sheet-chips" style="flex-direction:column;gap:10px">
        ${opt('splKeep', 'Split &amp; keep', `Keep the outfit wear and also log each of the ${nItems} piece${nItems === 1 ? '' : 's'} as a separate item.`, false)}
        ${opt('splDelWear', 'Split &amp; delete the wear', 'Replace the outfit wear with each piece as a separate item; keep the outfit in your looks.', true)}
        ${opt('splDelBoth', 'Split &amp; delete the wear + outfit', `Same as above, and delete the outfit entirely. ${priorDays ? `It has ${priorDays} wear${priorDays === 1 ? '' : 's'} before today.` : 'It has never been worn before today.'}`, true)}
      </div>
      ${delNote}
    </div>`;
  showSheet("logSheet");
  const close = () => { hideSheet("logSheet"); };
  $("#splCancel").onclick = close;
  $("#splKeep").onclick    = () => resolveSplit(wearIds, outfitId, 'keep', body).then(close);
  $("#splDelWear").onclick = () => resolveSplit(wearIds, outfitId, 'delWear', body).then(close);
  $("#splDelBoth").onclick = () => {
    if (!confirm("Delete this outfit? Wears on other days are kept as individual items.")) return;
    resolveSplit(wearIds, outfitId, 'delBoth', body).then(close);
  };
}

async function resolveSplit(wearIds, outfitId, mode, body) {
  const groupWears = wears.filter(w => wearIds.includes(w.id) && w.id);
  const ids = groupWears.map(w => w.id);
  if (!ids.length) return;
  const idList = ids.map(i => `"${i}"`).join(',');
  const date = calendarDay;
  try {
    if (mode === 'keep') {
      // Keep the outfit wear; ALSO log each piece as a separate solo item wear.
      const itemIds = [...new Set(groupWears.map(w => w.item_id))];
      const payload = itemIds.map(item_id => ({ item_id, worn_on: date, formality_for: deriveWearFormality([item_id]) }));
      const created = await rest("/wears", {
        method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify(payload),
      });
      if (Array.isArray(created)) wears.push(...created);
    } else {
      // delWear / delBoth: detach this day's rows from the outfit → solo items.
      await rest(`/wears?id=in.(${idList})`, {
        method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ outfit_id: null }),
      });
      wears.forEach(w => { if (ids.includes(w.id)) w.outfit_id = null; });
    }

    if (mode === 'delBoth' && outfitId) {
      // Wears on OTHER days FK-cascade to null server-side; mirror that locally.
      await rest(`/outfits?id=eq.${outfitId}`, { method: "DELETE" });
      outfits = outfits.filter(o => o.id !== outfitId);
      outfitById.delete(outfitId);
      outfitItemMap.delete(outfitId);
      outfitLinks = outfitLinks.filter(l => l.outfit_id !== outfitId);
      wears.forEach(w => { if (w.outfit_id === outfitId) w.outfit_id = null; });
      buildOutfitIndexes();
    }
    buildOutfitWearMap();
    renderCalendarDay(body);
    toast(mode === 'keep' ? "Pieces added alongside the outfit"
        : mode === 'delWear' ? "Outfit wear split into pieces"
        : "Split · outfit deleted");
  } catch (e) { toast(e.message); }
}

// G2: shared create-or-merge logic (was inline in makeLookFromDay). Dedup guard
// merges into an existing non-archived look with the same item-set instead of
// creating a duplicate outfit record (mirrors saveBuilder/saveComboAsOutfit).
async function createLookFromItems(itemIds, { name } = {}) {
  if (!itemIds || itemIds.length < 2) throw new Error("A look needs at least 2 pieces");
  const dup = findDuplicateOutfit(itemIds, null);
  if (dup) return { outfitId: dup.id, isNew: false };
  const oRows = await rest("/outfits?select=*", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ name: name || null }),
  });
  const newOutfit = Array.isArray(oRows) ? oRows[0] : oRows;
  if (!newOutfit?.id) throw new Error("Could not create look");
  outfits.push(newOutfit);
  const links = itemIds.map(item_id => ({ outfit_id: newOutfit.id, item_id }));
  await rest("/outfit_items", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(links),
  });
  outfitLinks = outfitLinks.concat(links);
  buildOutfitIndexes();
  return { outfitId: newOutfit.id, isNew: true };
}

/* ---- make-a-look from solo items on a day ---- */
async function makeLookFromDay(dateStr, body) {
  const soloGroups = dayGroups(dateStr).filter(g => !g.outfitId);
  const itemIds = [...new Set(soloGroups.flatMap(g => g.itemIds))];
  const wearIds = soloGroups.flatMap(g => g.wearIds);
  if (itemIds.length < 2) return;

  const [y, m, d] = dateStr.split('-').map(Number);
  const name = new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  try {
    const { outfitId } = await createLookFromItems(itemIds, { name });

    // Stamp wears with the outfit_id + re-derive formality for the grouped set
    // (solo-derived values were per-item; the look as a whole is the better read)
    const fml = deriveWearFormality(itemIds);
    const inList = `(${wearIds.map(id => `"${id}"`).join(',')})`;
    await rest(`/wears?id=in.${inList}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ outfit_id: outfitId, formality_for: fml }),
    });

    // Update local state
    const dayWears = wears.filter(w => wearIds.includes(w.id));
    for (const w of dayWears) { w.outfit_id = outfitId; w.formality_for = fml; }
    buildOutfitIndexes();

    renderCalendarDay(body);
    // G1: single-ask — pre-seed from whatever context is already on these wears
    // so opening the sheet doesn't blank out captured values.
    const presetCtx = dayWears.flatMap(w => ctxArr(w)).filter((v, i, a) => a.indexOf(v) === i);
    openPostLogSheet(dayWears, { presetCtx });
  } catch (e) { toast(e.message); }
}

/* ---- log a wear from the calendar day view (+ Clothing / + Look) ---- */
let _calLookQ = "";  // look-picker search

function calDayLabel(ds) {
  const [y, m, d] = ds.split('-').map(Number);
  return `${CAL_MONTHS[m - 1]} ${d}, ${y}`;
}

// + Clothing: multi-select closet picker (reuses pickerPool/pickerGridHtml/togglePick)
function openCalAddClothing() {
  _capPick = new Set();
  _capPickFilter = "";
  _capPickCat = null;
  _capPickSub = null;          // reset so a stale subcategory filter can't hide items
  _capPickStatus = "Available"; // reset so a stale status lens can't hide items
  _pickTripScope = !!tripCapsule();  // trip mode: default to the suitcase
  pickerFilter = newFilterState();
  renderCalClothingPicker();
}

function renderCalClothingPicker() {
  const body = $('#calendarBody');
  const sortKey = gridSortKey();
  body.innerHTML = `<div class="tabbody">
    <div class="cal-day-header">
      <button id="calLogCancel" style="color:var(--accent);font-size:15px;font-weight:500">Cancel</button>
      <div style="font-size:16px;font-weight:600">Log clothing</div>
      <button id="calLogDone" style="color:var(--accent);font-size:15px;font-weight:700">Done</button>
    </div>
    <div style="text-align:center;font-size:13px;color:var(--muted);padding:0 0 4px">${esc(calDayLabel(calendarDay))}</div>
    <div style="padding:6px 14px 0;display:flex;gap:8px;align-items:center">
      <input class="inp" id="calLogSearch" style="flex:1" placeholder="Search your closet…" value="${esc(_capPickFilter)}">
      ${funnelBtnHtml("calLogFilter", pickerFilter, renderCalClothingPicker)}
    </div>
    ${(() => { const b = (s, l) => `<button class="cap-chip${_capPickStatus === s ? " on" : ""}" data-pick-status="${s}">${l}</button>`;
      const trip = tripCapsule();
      const scope = trip ? `<button class="cap-chip${_pickTripScope ? " on" : ""}" data-pick-tripscope>✈️ Suitcase only</button>` : "";
      return `<div class="cap-catbar" style="padding-top:6px">${scope}${b("Available","Available")}${b("Storage","Storage")}${b("All","All")}</div>`; })()}
    ${laundryLensHtml("calpick", pickerFilter, renderCalClothingPicker)}
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px 2px;gap:8px">
      <span style="font-size:13px;color:var(--muted)" id="capPickCount">${_capPick.size} selected</span>
      <div style="display:flex;gap:8px;align-items:center">
        <button id="calLogAsLook" ${_capPick.size < 2 ? "hidden" : ""} style="font-size:13px;color:var(--accent);font-weight:600;padding:4px 10px;border:1px solid var(--accent);border-radius:20px;white-space:nowrap">Log as look</button>
      </div>
    </div>
    <div id="calLogResults">${pickerCatBar()}${pickerSubBar()}${pickerGridHtml(pickerPool())}</div>
  </div>`;
  hydratePhotos(body);
  scrollToTop();
  const s = $('#calLogSearch');
  if (s) s.oninput = () => { _capPickFilter = s.value; renderCalLogGrid(); };
  body.onclick = (e) => {
    if (e.target.closest('#calLogCancel')) return renderCalendarDay(body);
    if (e.target.closest('#calLogDone')) return saveCalClothingLog();
    if (e.target.closest('#calLogAsLook')) return saveCalClothingLogAsLook();
    if (e.target.closest('#calLogFilter')) return openFilterSheet(pickerFilter, { onApply: renderCalClothingPicker, title: "Filter & sort", dims: PICKER_FILTER_DIMS, sortable: true });
    if (e.target.closest('[data-pick-tripscope]')) { _pickTripScope = !_pickTripScope; _capPickCat = null; _capPickSub = null; return renderCalClothingPicker(); }
    const ps = e.target.closest('[data-pick-status]');
    if (ps) { _capPickStatus = ps.dataset.pickStatus; _capPickCat = null; _capPickSub = null; return renderCalClothingPicker(); }
    const pc = e.target.closest('[data-pickcat]');
    if (pc) { _capPickCat = pc.dataset.pickcat === '__all__' ? null : pc.dataset.pickcat; _capPickSub = null; return renderCalClothingPicker(); }
    const psub = e.target.closest('[data-picksub]');
    if (psub) { _capPickSub = psub.dataset.picksub || null; return renderCalClothingPicker(); }
    const pk = e.target.closest('[data-pick]');
    if (pk) return togglePick(pk.dataset.pick);  // updates #capPickCount + tile
  };
}

// light re-render of the picker results (keeps the search box focused)
function renderCalLogGrid() {
  const cnt = $('#capPickCount'); if (cnt) cnt.textContent = `${_capPick.size} selected`;
  const wrap = $('#calLogResults');
  if (wrap) { wrap.innerHTML = pickerCatBar() + pickerSubBar() + pickerGridHtml(pickerPool()); hydratePhotos($('#calendarBody')); }
}

async function saveCalClothingLog() {
  const body = $('#calendarBody');
  const ids = [..._capPick];
  if (!ids.length) return renderCalendarDay(body);
  const date = calendarDay;
  try {
    const wctx = tripWearContext(date, ids);  // trip mode: auto-stamp "Travel"
    const payload = ids.map(item_id => ({ item_id, worn_on: date, formality_for: deriveWearFormality([item_id]), ...(wctx ? { context: wctx } : {}) }));  // solo wears, no outfit_id
    const rows = await rest('/wears', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
    const pushed = Array.isArray(rows) ? rows : payload.map(p => ({ ...p, outfit_id: null }));
    wears.push(...pushed);
    buildOutfitWearMap();
    renderCalendarDay(body);
    // G1: single-ask — no auto-opened sheet for solo items (context stays reachable
    // via the toast chip and the day-card "Add context" button instead).
    toast(logCelebration(pushed) || `Logged ${ids.length} item${ids.length === 1 ? '' : 's'} for ${date}`, [
      { label: "Undo", fn: () => undoLoggedWears(pushed) },
      { label: "Add context →", fn: () => openPostLogSheet(pushed) },
    ]);
  } catch (e) { toast(e.message); }
}

// G2: "Log as look" — skip the day-page detour. Create-or-merge the picked items
// into a look (createLookFromItems), log wears WITH outfit_id, one post-log sheet.
async function saveCalClothingLogAsLook() {
  const body = $('#calendarBody');
  const ids = [..._capPick];
  if (ids.length < 2) return;
  const date = calendarDay;
  try {
    const { outfitId } = await createLookFromItems(ids);
    const fml = deriveWearFormality(ids);
    const wctx = tripWearContext(date, ids);  // trip mode: auto-stamp "Travel"
    const payload = ids.map(item_id => ({ item_id, worn_on: date, outfit_id: outfitId, formality_for: fml, ...(wctx ? { context: wctx } : {}) }));
    const rows = await rest('/wears', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
    const pushed = Array.isArray(rows) ? rows : payload.map(p => ({ ...p }));
    wears.push(...pushed);
    buildOutfitWearMap();
    tripPlanSync(outfitId, date);  // trip mode: a worn look IS that day's plan
    renderCalendarDay(body);
    openPostLogSheet(pushed, { undoable: true });
  } catch (e) { toast(e.message); }
}

// + Look: pick a saved look → one wear row per piece, linked to the outfit
let calLookFilter = newFilterState(); // P3: funnel for the calendar +Look picker
function openCalAddLook() {
  _calLookQ = "";
  _pickTripScope = !!tripCapsule();  // trip mode: default to suitcase-wearable looks
  calLookFilter = newFilterState();
  renderCalLookPicker();
}

function calLookListHtml() {
  const q = _calLookQ.trim().toLowerCase();
  // L5: liked looks first, then most-recently-created.
  let list = activeOutfits().slice()
    .sort((a, b) => (b.rating === 1 ? 1 : 0) - (a.rating === 1 ? 1 : 0) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  if (_pickTripScope && tripModeId) list = list.filter(o => outfitFullyInCapsule(o, tripModeId));
  if (q) list = list.filter(o => outfitName(o).toLowerCase().includes(q));
  if (hasActiveFilter(calLookFilter)) list = list.filter(o => outfitMatchesFilter(o, calLookFilter));
  const capped = list.slice(0, 150);
  if (!capped.length) return `<div class="cal-day-empty">No looks found.</div>`;
  const more = list.length > capped.length
    ? `<div class="snote center" style="padding:4px 16px 20px;color:var(--muted);font-size:12.5px">Showing ${capped.length} most recent of ${list.length}. Search to narrow.</div>` : "";
  return `<div class="ogrid">${capped.map(o =>
    `<button class="otile" data-callook="${esc(o.id)}">${outfitCollageHtml(o, 4)}${o.rating === 1 ? `<div class="otile-heart"><svg viewBox="0 0 24 24">${HEART_SVG}</svg></div>` : ""}<div class="oname">${esc(outfitName(o))}</div></button>`
  ).join('')}</div>${more}`;
}

function renderCalLookPicker() {
  const body = $('#calendarBody');
  body.innerHTML = `<div class="tabbody">
    <div class="cal-day-header">
      <button id="calLogCancel" style="color:var(--accent);font-size:15px;font-weight:500">Cancel</button>
      <div style="font-size:16px;font-weight:600">Log a look</div>
      <span style="width:54px"></span>
    </div>
    <div style="text-align:center;font-size:13px;color:var(--muted);padding:0 0 4px">${esc(calDayLabel(calendarDay))}</div>
    <div style="padding:6px 14px 8px;display:flex;gap:8px;align-items:center">
      <input class="inp" id="calLookSearch" style="flex:1" placeholder="Search looks…" value="${esc(_calLookQ)}">
      ${funnelBtnHtml("calLookFilterBtn", calLookFilter, renderCalLookPicker)}
    </div>
    ${tripCapsule() ? `<div class="cap-catbar" style="padding:0 14px 8px"><button class="cap-chip${_pickTripScope ? " on" : ""}" data-pick-tripscope>✈️ Suitcase only</button></div>` : ""}
    <div id="calLookResults">${calLookListHtml()}</div>
  </div>`;
  hydratePhotos(body);
  scrollToTop();
  const s = $('#calLookSearch');
  if (s) s.oninput = () => {
    _calLookQ = s.value;
    const wrap = $('#calLookResults');
    if (wrap) { wrap.innerHTML = calLookListHtml(); hydratePhotos(body); }
  };
  body.onclick = (e) => {
    if (e.target.closest('#calLogCancel')) return renderCalendarDay(body);
    if (e.target.closest('[data-pick-tripscope]')) { _pickTripScope = !_pickTripScope; return renderCalLookPicker(); }
    if (e.target.closest('#calLookFilterBtn')) return openFilterSheet(calLookFilter, { onApply: renderCalLookPicker, title: "Filter Looks", dims: LOOKS_FILTER_DIMS });
    const lk = e.target.closest('[data-callook]');
    if (lk) return logLookOnDay(lk.dataset.callook);
  };
}

// G6: "wear again" candidates — worn in the last 14 days ∪ liked ∪ most-worn this
// season, deduped, recency first. The most common real log is a repeat; this is
// the 2-tap path for it (tap the CTA, tap a look).
function outfitSeasonWornCount(o, season) {
  const s = outfitWearMap.get(o.id);
  if (!s) return 0;
  let n = 0;
  for (const d of s) if (seasonOf(d) === season) n++;
  return n;
}
function wearAgainCandidates() {
  // Trip/capsule mode: only looks wearable entirely from the capsule.
  let all = activeOutfits();
  if (activeCapsuleId) all = all.filter(o => outfitFullyInCapsule(o, activeCapsuleId));
  const cutoff = localISO(new Date(Date.now() - 14 * 86400000));
  const season = currentSeason();
  const recentIds = new Set(wears.filter(w => w.outfit_id && w.worn_on >= cutoff).map(w => w.outfit_id));
  const seasonCounts = new Map();
  for (const o of all) { const n = outfitSeasonWornCount(o, season); if (n) seasonCounts.set(o.id, n); }
  const topSeasonIds = new Set([...seasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id]) => id));
  const base = all.filter(o => recentIds.has(o.id) || o.rating === 1 || topSeasonIds.has(o.id))
    .sort((a, b) => String(outfitLastWorn(b) || "").localeCompare(String(outfitLastWorn(a) || "")));
  // V3: recency-sorting buries liked-but-neglected looks (they sort last and fall
  // off the 12 cap) — reserve 2 slots for them so resurfacing happens where she
  // actually logs, not just on the Stats page. Prefer in-season ones.
  const neglected = [];
  let negPool = likedNeglectedOutfits();
  if (activeCapsuleId) negPool = negPool.filter(o => outfitFullyInCapsule(o, activeCapsuleId));
  const inSeasonNeg = negPool.filter(o => { const s = outfitSeasons(o); return !s.length || s.includes(season); });
  /* ⚠️ THE RACK'S COLD BAND REACHES THE LOGGING FLOW (2026-08-16, her ask). The
     dormant band is the rack's anti-calcification mechanism and it only ever
     surfaced on a screen she had to go and open. Looks made entirely of pieces
     she hasn't reached for now compete for the same two reserved slots that
     liked-but-neglected looks already had — resurfacing belongs where she logs.
     ⚠️ ALL pieces dormant, not ANY: one cold piece in an otherwise current outfit
     is not a rediscovery, and an any-test would match most of the list (the same
     all-vs-any reasoning as outfitMatchesFilter's status dim).
     ⚠️ In-season first, from both sources, then whatever is left — the seasonal
     preference the liked-neglected half already had. */
  let coldPool = [];
  if (typeof rackBandOf === "function") {
    coldPool = all.filter(o => {
      const its = outfitItems(o);
      return its.length >= 2 && its.every(i => rackBandOf(i.id) === "dormant");
    });
    if (activeCapsuleId) coldPool = coldPool.filter(o => outfitFullyInCapsule(o, activeCapsuleId));
  }
  const seasonOk = (o) => { const s = outfitSeasons(o); return !s.length || s.includes(season); };
  const inSeasonCold = coldPool.filter(seasonOk);
  for (const o of [...inSeasonCold, ...inSeasonNeg, ...coldPool, ...negPool]) {
    if (neglected.length >= 2) break;
    if (!neglected.some(n => n.id === o.id)) neglected.push(o);
  }
  const negIds = new Set(neglected.map(o => o.id));
  const list = [...base.filter(o => !negIds.has(o.id)).slice(0, 12 - neglected.length), ...neglected];
  return { list, neglectedIds: negIds };
}
function openWearAgainChooser(date) {
  const { list: cands, neglectedIds } = wearAgainCandidates();
  const _ls = LAUNDRY_READY() ? laundryState() : null;
  // A4 (2026-07-18): the getting-out-of-bed flow — a ✨ Suggest tile at the
  // FRONT of the strip, so "surprise me" is two taps from a cold open.
  // TODAY only ("Wear this today" logs today; past-date suggestions are
  // explicitly not a use case — her call).
  const suggestTile = date !== todayStr() ? "" : `<button class="wa-tile" id="waSuggest" style="text-align:center">
      <div style="height:74px;display:flex;align-items:center;justify-content:center;font-size:30px;border:1.5px dashed var(--accent);border-radius:12px;background:var(--accent-soft)">✨</div>
      <div class="wa-name" style="color:var(--accent);font-weight:600">Suggest new</div>
    </button>`;
  const strip = (suggestTile || cands.length)
    ? `<div class="wa-strip">${suggestTile}${cands.map(o => `<button class="wa-tile" data-wa-look="${esc(o.id)}">
        ${outfitCollageHtml(o, 4)}
        ${o.rating === 1 ? `<div class="otile-heart" style="width:14px;height:14px"><svg viewBox="0 0 24 24">${HEART_SVG}</svg></div>` : ""}
        <div class="wa-name">${esc(outfitName(o))}</div>
        ${neglectedIds.has(o.id) ? `<div style="font-size:10px;color:var(--accent);font-weight:600">it's been a while</div>` : ""}
        ${_ls && outfitItems(o).some(p => isDirty(p, _ls)) ? `<div style="font-size:10px;color:var(--muted)">🧺 in the wash</div>` : ""}
      </button>`).join("")}</div>`
    : `<div class="muted center" style="padding:10px 24px 4px;font-size:13px">No recent looks yet — build one below.</div>`;
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="waCancel">Cancel</button>
      <h2>Wear again?</h2>
      <span style="width:54px"></span>
    </div>
    <div style="padding:4px 0 12px">${strip}</div>
    <div class="cal-day-foot" style="position:static;border-top:1px solid var(--line);margin:0 4px">
      <div class="cal-day-foot-ico"><svg viewBox="0 0 24 24"><path d="M16 4l-4 9-4-9"/><path d="M12 13l-9 7h18l-9-7z"/></svg></div>
      <div class="cal-day-foot-add">
        <span>or add fresh:</span>
        <button id="waAddClothing">+ Clothing</button>
        <button id="waAddLook">+ Look</button>
      </div>
    </div>
    <div style="height:max(env(safe-area-inset-bottom),16px)"></div>`;
  showSheet("logSheet");
  hydratePhotos($("#logInner"));
  $("#waCancel").onclick = () => { hideSheet("logSheet"); };
  const sg = $("#waSuggest");
  if (sg) sg.onclick = () => { hideSheet("logSheet"); openSuggestSheet(); };
  /* ⚠️ These two OWN their navigation now (2026-08-14). They render into
     #calendarBody and then open a picker over it, which only works if the
     calendar is the visible screen — until now they relied on the caller having
     already switched tabs, which Home's log CTA did on her behalf. That switch
     is gone (it stranded her on Calendar after a one-tap log), so the two paths
     that genuinely need the calendar ask for it themselves. Tapping a look
     below does NOT: it logs from wherever she is. */
  $("#waAddClothing").onclick = () => { hideSheet("logSheet"); switchTab("calendar"); calendarDay = date; renderCalendarDay($("#calendarBody")); openCalAddClothing(); };
  $("#waAddLook").onclick = () => { hideSheet("logSheet"); switchTab("calendar"); calendarDay = date; renderCalendarDay($("#calendarBody")); openCalAddLook(); };
  $("#logInner").querySelectorAll("[data-wa-look]").forEach(b => {
    b.onclick = () => { hideSheet("logSheet"); calendarDay = date; logLookOnDay(b.dataset.waLook); };
  });
}

async function logLookOnDay(id, { force = false } = {}) {
  const o = outfitById.get(id);
  if (!o) return;
  const its = outfitItems(o);
  if (!its.length) { toast('This look has no pieces'); return; }
  const date = calendarDay;
  // V3 soft dup guard (same as solo logs): don't silently double-log a look on a day
  if (!force && wears.some(w => w.outfit_id === id && w.worn_on === date)) {
    toast('Already logged that day', { label: 'Log again →', fn: () => logLookOnDay(id, { force: true }) });
    return;
  }
  try {
    const fml = deriveWearFormality(its.map(it => it.id));
    const wctx = tripWearContext(date, its.map(it => it.id));  // trip mode: auto-stamp "Travel"
    const payload = its.map(it => ({ item_id: it.id, worn_on: date, outfit_id: id, formality_for: fml, ...(wctx ? { context: wctx } : {}) }));
    const rows = await rest('/wears', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
    if (Array.isArray(rows)) wears.push(...rows);
    else payload.forEach(p => wears.push(p));
    buildOutfitWearMap();
    tripPlanSync(id, date);  // trip mode: a worn look IS that day's plan
    renderCalendarDay($('#calendarBody'));
    if (Array.isArray(rows) && rows.length && rows[0].id) {
      logCelebration(rows, { defer: true });
      openPostLogSheet(rows, { undoable: true });
    } else toast(logCelebration(payload) || `Logged ${outfitName(o)} for ${date}`);
  } catch (e) { toast(e.message); }
}

function openCalNotes(outfitId, onSaved) {
  const outfit = outfitById.get(outfitId);
  if (!outfit) return;
  $('#logInner').innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="calNotesCancel">Cancel</button>
      <h2>Notes</h2>
      <button class="lnk" id="calNotesSave" style="font-weight:700">Save</button>
    </div>
    <div style="padding:16px 18px 30px">
      <textarea id="calNotesInput" class="inp" rows="5"
        style="resize:none;width:100%;min-height:100px;font-size:15px">${esc(outfit.notes || '')}</textarea>
    </div>`;
  $('#logSheet').hidden = false;
  $('#calNotesCancel').onclick = () => { $('#logSheet').hidden = true; };
  $('#calNotesSave').onclick = async () => {
    const notes = $('#calNotesInput').value;
    try {
      await rest(`outfits?id=eq.${outfitId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      outfit.notes = notes;
      $('#logSheet').hidden = true;
      onSaved();
    } catch (e) { toast(e.message); }
  };
}

