/* ===================================================================
   THE WEAR SCREEN  (2026-08-03)

   Her ask: "I want to see the change in cost per wear for each item in a
   wear/look. Other things that change with a wear also — a screen on that
   wear, maybe?"

   The app has always KNOWN what a wear moves — cost per wear, the count, the
   gap it closed, how close a piece now is to the hamper — and has never shown
   any of it at the moment it happens. The post-log sheet asked for context and
   said nothing back. This is the mirror-first identity applied to the daily
   loop: the reward for logging is seeing what logging changed.

   ⚠️ ONE DERIVATION, TWO SURFACES, and the live one is a SHEET.
   She chose "replace the post-log sheet with it". That must not cost her taps —
   "log what I wore" is one of the two sacred two-tap flows. So this does not
   introduce a screen in front of logging: the deltas render as a block ABOVE
   the existing context chips inside openPostLogSheet, with the same Skip/Save
   header and the same heart. Same taps, plus a payoff. The identical block
   renders read-only from a calendar day card and from a look's wear list, so
   the number is there whether the wear was ten seconds or ten months ago.

   ⚠️ "BEFORE" MEANS "BEFORE THIS DAY", NOT "BEFORE THIS ROW".
   after = distinct wear-days including this date; before = the same set minus
   this date. Defined that way it needs no knowledge of what was already stored
   when the log happened, which is the only definition that also works when she
   opens a wear from last March. It is also the honest reading: a DAY is what
   moved the count (see the 2026-07-24 "a wear is a DAY, never a row" rule) —
   logging the same piece twice on one day must not read as two wears.
   =================================================================== */

// Cost per wear is only meaningful against a price. Gifts keep their count but
// have no cost story, exactly as the report cards treat them.
const WEAR_DELTA_MIN_PRICE = 0;

/* Pure. `rows` are wear rows sharing a date (the shape every log path already
   produces); `wearRows` is injectable so the selftest can drive it. */
function buildWearDelta(rows, { wearRows = null, today = null } = {}) {
  if (!rows || !rows.length) return null;
  const all = wearRows || wears;
  const date = rows[0].worn_on || today || todayStr();
  const ids = [...new Set(rows.map(r => r.item_id).filter(Boolean))];

  // One pass: item → Set(days), and outfit → Set(days).
  const dayMap = new Map(), lookMap = new Map();
  for (const w of all) {
    if (!w.worn_on) continue;
    if (w.item_id) { let s = dayMap.get(w.item_id); if (!s) dayMap.set(w.item_id, s = new Set()); s.add(w.worn_on); }
    if (w.outfit_id) { let s = lookMap.get(w.outfit_id); if (!s) lookMap.set(w.outfit_id, s = new Set()); s.add(w.worn_on); }
  }

  const pieces = ids.map(id => {
    const i = itemById.get(id);
    if (!i) return null;
    const days = [...(dayMap.get(id) || new Set())].sort();
    const prior = days.filter(d => d < date);
    const before = days.filter(d => d !== date).length;
    const after = before + 1;
    const price = (i.price != null && i.price > WEAR_DELTA_MIN_PRICE) ? i.price : null;
    // The gap this outing closed — null on a first outing, which the count line
    // already says more warmly.
    const prev = prior.length ? prior[prior.length - 1] : null;
    const gap = prev ? daysBetween(prev, date) : null;

    /* Laundry, as of this day: how many wear-days since the last wash have
       happened up to and including this one, against the piece's tolerance.
       ⚠️ Counted with the same >last_washed rule the hamper uses, so this line
       and the hamper can never disagree. */
    const tol = wearTolerance(i);
    const sinceWash = (i.last_washed ? days.filter(d => d > i.last_washed) : days).filter(d => d <= date).length;
    const tracked = !!i.last_washed && tol !== Infinity;
    const hamperNow = tracked && sinceWash >= tol;
    const hamperThis = hamperNow && sinceWash === tol;   // THIS wear is what tipped it

    return {
      item: i, before, after,
      cpwBefore: (price && before) ? price / before : null,
      cpwAfter: price ? price / after : null,
      price, gap, first: before === 0,
      tracked, tol, sinceWash, hamperNow, hamperThis,
      band: (typeof rackBandOf === "function") ? rackBandOf(id) : null,
    };
  }).filter(Boolean);

  // Outfit-level, when every row shares one look (the same test the heart uses).
  const oid = rows.length && rows.every(r => r.outfit_id && r.outfit_id === rows[0].outfit_id)
    ? rows[0].outfit_id : null;
  const o = oid ? outfitById.get(oid) : null;
  const lookDays = o ? [...(lookMap.get(oid) || new Set())] : [];
  const look = o ? {
    outfit: o,
    before: lookDays.filter(d => d !== date).length,
    after: lookDays.filter(d => d !== date).length + 1,
  } : null;

  const contexts = [...new Set(rows.flatMap(r => ctxArr(r)))];
  const wx = (typeof wxLog === "function" ? wxLog() : {})[date] || null;
  const level = rows.find(r => r.formality_for)?.formality_for || null;

  // Totals worth one line: what this outing did to the money.
  const withPrice = pieces.filter(p => p.price);
  const spendBefore = withPrice.reduce((a, p) => a + (p.cpwBefore == null ? 0 : p.cpwBefore), 0);
  const spendAfter = withPrice.reduce((a, p) => a + p.cpwAfter, 0);

  return { date, pieces, look, contexts, wx, level,
           saved: (withPrice.length && spendBefore) ? spendBefore - spendAfter : null };
}

const _cpw = (n) => n == null ? "—" : "$" + n.toFixed(n < 10 ? 2 : 0);

/* The block. `live` = rendered inside the post-log sheet (where the context
   picker and Save/Skip live below it); otherwise read-only. */
function wearDetailHtml(d, { live = false } = {}) {
  if (!d || !d.pieces.length) return "";
  const rows = d.pieces.map(p => {
    const i = p.item;
    // Lead with the thing she asked for. A first outing has no "before" — say
    // so rather than printing an infinity or a dash she has to interpret.
    const cpwBit = !p.price
      ? `<span class="muted">no price on file</span>`
      : p.first
        ? `<b style="color:var(--accent)">${esc(_cpw(p.cpwAfter))}</b> a wear, first time out`
        : `${esc(_cpw(p.cpwBefore))} → <b style="color:var(--accent)">${esc(_cpw(p.cpwAfter))}</b> a wear`;
    const bits = [];
    bits.push(`${p.after} day${p.after === 1 ? "" : "s"} out`);
    if (p.gap != null && p.gap >= 14) bits.push(`first in ${esc(humanGap(p.gap))}`);
    if (p.tracked) {
      bits.push(p.hamperThis ? `🧺 that's the hamper`
        : p.hamperNow ? `🧺 in the hamper`
        : `${p.sinceWash}/${p.tol} since a wash`);
    }
    if (p.band === "dormant") bits.push("back off the rack");
    return `<button data-wd-item="${esc(i.id)}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 0;border-bottom:1px solid var(--line)">
      <span style="width:44px;flex:none">${thumbHtml(i.image_path, "cthumb")}</span>
      <span style="flex:1;min-width:0">
        <span style="display:block;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.name || "Untitled")}</span>
        <span style="display:block;font-size:13px;padding-top:1px">${cpwBit}</span>
        <span class="muted" style="display:block;font-size:11.5px;padding-top:1px">${esc(bits.join(" · "))}</span>
      </span>
    </button>`;
  }).join("");

  const wxBit = d.wx && d.wx.maxT != null
    ? `${typeof wmoEmoji === "function" ? wmoEmoji(d.wx.code) : ""} ${d.wx.maxT}°/${d.wx.minT}°` : "";
  const head = [d.contexts.join(", "), d.level ? occLabel(d.level) : "", wxBit].filter(Boolean).join(" · ");
  const lookBit = d.look
    ? `<div class="muted" style="font-size:12.5px;padding-top:4px">${esc(outfitName(d.look.outfit))} · ${d.look.after} time${d.look.after === 1 ? "" : "s"} worn</div>`
    : "";
  // One honest money line. Only when there's actually a price behind it.
  const savedBit = d.saved
    ? `<div style="font-size:12.5px;color:var(--muted);padding-top:8px">Today took ${esc(_cpw(d.saved))} off what this outfit costs you per wear.</div>`
    : "";

  return `<div style="padding:${live ? "2px 2px 14px" : "6px 16px 14px"}">
    ${live ? "" : `<div style="font-size:12px;color:var(--muted)">${esc(fmtDate(d.date))}</div>`}
    ${head ? `<div style="font-size:13px;padding-top:2px">${esc(head)}</div>` : ""}
    ${lookBit}
    <div style="padding-top:6px">${rows}</div>
    ${savedBit}
  </div>`;
}

// Shared wiring: piece rows open the item, from wherever the block is showing.
function wireWearDetail(root, { onLeave = null } = {}) {
  (root || document).querySelectorAll("[data-wd-item]").forEach(b => b.onclick = () => {
    if (onLeave) onLeave();
    openItemFrom(b.dataset.wdItem);
  });
}

/* The standalone view: any past wear, from the calendar day card or a look's
   wear list. Rendered into #logSheet like every other reader — it's a thing you
   glance at, not a place you navigate into and have to get back out of. */
function openWearDetail(dateStr, wearIds = null) {
  const idSet = wearIds && wearIds.length ? new Set(wearIds) : null;
  const rows = wears.filter(w => w.worn_on === dateStr && (!idSet || idSet.has(w.id)));
  if (!rows.length) return;
  const d = buildWearDelta(rows);
  $("#logInner").innerHTML = `
    <div class="sheet-hdr">
      <button class="lnk" id="wdClose">Done</button>
      <h2>What this wear changed</h2>
      <div style="width:48px"></div>
    </div>
    ${wearDetailHtml(d)}
    <div class="snote" style="padding:0 16px 6px;font-size:12px">Cost per wear counts the days a piece has gone out, so wearing something twice in one day still counts once.</div>
    <div style="height:max(env(safe-area-inset-bottom),16px)"></div>`;
  showSheet("logSheet");
  hydratePhotos($("#logInner"));
  $("#wdClose").onclick = () => hideSheet("logSheet");
  wireWearDetail($("#logInner"), { onLeave: () => hideSheet("logSheet") });
}
