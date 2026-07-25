/* ===================================================================
   DOM UTILS
   =================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Track the on-screen keyboard height into --kb so bottom sheets sit above it
// (iOS anchors fixed bottom:0 to the layout viewport, so the keyboard covers them).
(function trackKeyboardInset() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty("--kb", kb + "px");
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
})();

let toastTimer;
// The stats Most/Least toggle floats in the same band as the toast, and the
// toast wins on z-index — a toast chip parked over that control made it look
// broken (tap → "What's new" opened, or nothing happened). Lift the toast clear
// whenever that control is on screen. Queried live from both sides (toast shown
// on this page / navigated onto this page with a toast up), so it self-corrects
// and needs no cleanup.
function positionToast() {
  const t = $("#toast");
  t.style.bottom = document.querySelector(".stats-toggle-float")
    ? "calc(var(--nav-h) + var(--safe-b) + 80px)" : "";
}

// action = one {label,fn} chip, an array of them, or omitted. Each chip is its
// own click target so multiple actions (e.g. Undo + Add context) don't collide.
function toast(msg, action) {
  const t = $("#toast");
  const actions = action ? (Array.isArray(action) ? action : [action]) : [];
  positionToast();
  if (actions.length) {
    t.innerHTML = esc(msg) + actions.map((a, i) => `<span class="toast-chip" data-tchip="${i}">${esc(a.label)}</span>`).join("");
    // pointer-events stays `none` on the pill; only .toast-chip opts back in.
    t.onclick = (e) => {
      const chip = e.target.closest("[data-tchip]");
      if (!chip) return;
      t.classList.remove("show"); clearTimeout(toastTimer);
      actions[parseInt(chip.dataset.tchip)].fn();
    };
  } else {
    t.textContent = msg;
    t.style.pointerEvents = "";
    t.onclick = null;
  }
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), actions.length ? 5500 : 2200);
}

// Animated bottom-sheet open/close (2026-07-17). The wrapper's `hidden`
// attribute stays the source of truth — these only add the slide/fade motion.
// Wrapper markup is always <div id=… hidden><div .sheet-bg><div .sheet></div>.
const _sheetHideTimers = new Map();
function showSheet(id) {
  const w = document.getElementById(id);
  if (!w) return;
  const pending = _sheetHideTimers.get(id);
  if (pending) { clearTimeout(pending); _sheetHideTimers.delete(id); }
  else if (!w.hidden) return;                    // already open — don't re-animate
  const s = w.querySelector(".sheet"), bg = w.querySelector(".sheet-bg");
  w.hidden = false;
  if (!s) return;
  s.scrollTop = 0;
  s.style.transform = "translateY(105%)";
  if (bg) bg.style.opacity = "0";
  s.offsetHeight;                                // reflow so the slide-up transitions
  s.style.transform = "";
  if (bg) bg.style.opacity = "";
}
function hideSheet(id) {
  const w = document.getElementById(id);
  if (!w || w.hidden) return;
  const s = w.querySelector(".sheet"), bg = w.querySelector(".sheet-bg");
  if (s) s.style.transform = "translateY(105%)";
  if (bg) bg.style.opacity = "0";
  _sheetHideTimers.set(id, setTimeout(() => {
    _sheetHideTimers.delete(id);
    w.hidden = true;
    if (s) s.style.transform = "";
    if (bg) bg.style.opacity = "";
  }, 240));
}

// Lazy photo loading: sign + set background only when a node nears the viewport.
const photoObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const n = e.target;
    photoObserver.unobserve(n);
    loadPhotoNode(n);
  }
}, { rootMargin: "300px" });

// Muted tee-shirt glyph shown wherever an item has no photo yet — the piece is
// still visibly "there" in collages, canvases, and grids.
const PHOTO_PLACEHOLDER = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-7 -7 38 38"><path d="M8.2 2.4 3 5.6l2 4.4 2.2-1v12h9.6V9l2.2 1 2-4.4-5.2-3.2a3.3 3.3 0 0 1-7.6 0z" fill="none" stroke="#c6c6cf" stroke-width="1.4" stroke-linejoin="round"/></svg>`
)}")`;
const _shownPhotos = new Set();  // paths already displayed this session — re-renders set instantly (no flicker)
async function loadPhotoNode(n) {
  if (n.dataset.photoDone) return;
  n.dataset.photoDone = "1";
  const path = n.dataset.photo;
  if (!path) { n.style.backgroundImage = PHOTO_PLACEHOLDER; return; }
  const url = await photoUrl(path);   // local byte cache first, Supabase only on miss
  if (!url) { n.style.backgroundImage = PHOTO_PLACEHOLDER; return; }
  if (_shownPhotos.has(path)) {
    n.style.backgroundImage = `url("${url}")`; n.style.backgroundColor = "transparent";
    return;
  }
  // First display this session: decode off-DOM, then fade in instead of popping.
  try { const im = new Image(); im.src = url; if (im.decode) await im.decode(); } catch (_) {}
  _shownPhotos.add(path);
  n.classList.add("ph-fade");
  n.style.backgroundImage = `url("${url}")`; n.style.backgroundColor = "transparent";
  n.offsetHeight;                     // reflow so the opacity transition runs
  n.classList.add("ph-in");
}
function hydratePhotos(root = document) {
  $$("[data-photo]", root)
    .filter(n => !n.dataset.photoDone && !n.dataset.photoObs)
    .forEach(n => { n.dataset.photoObs = "1"; photoObserver.observe(n); });
}

