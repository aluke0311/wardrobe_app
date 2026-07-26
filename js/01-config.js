/* ===================================================================
   CONFIG  (publishable key + URL are safe to ship in client code)
   =================================================================== */
const SUPABASE_URL = "https://ofwaxqrwbcixrnjkepuz.supabase.co";
const SUPABASE_KEY = "sb_publishable_MbsUbmttzon5YNsJgUsDrw_Mg5NMCGy";
const BUCKET = "wardrobe";
// Version label shown in the UI: "YYYY-MM-DD vN". N resets to 1 on a new day and
// increments for each additional push the same day (so same-day pushes differ).
const APP_VERSION = "2026-07-26 r2";
// Shown once after each update (deploy skill refreshes these alongside
// APP_VERSION — 2-4 user-facing bullets for the CURRENT release batch).
const WHATS_NEW = [
  "“What should I wear?” is now its own button on Home, and it stays there all day — including after you’ve logged, which is exactly when you’d want to swap one piece. It used to be three taps inside “Log today’s wear”",
  "Logging moved to the quiet row underneath it. Still one tap — it just isn’t the loudest thing on the screen any more, because deciding comes before recording",
  "The little shuffle arrow is gone. It meant “show me looks I already own” in one place and “build me a new outfit” in another — two opposite things wearing the same icon. ✨ now always means make something new",
  "Tapping a day on the calendar opens that day, instead of first asking which of three things you meant",
  "The big buttons on Home are actually full-width now — they'd been quietly shrink-wrapping to their own text this whole time",
  "“On this day” moved to the bottom of the day view and lost its box. It's a memory, and it was sitting between your outfits and your plan looking like a button",
];

// category -> subcategories. Keep in sync with migration/import.py TAXONOMY.
// Editable in-app since 2026-07-21: this is the DEFAULT shape; a saved
// override in kv ("taxonomy") replaces it at load via applyTaxonomyOverride().
// Both are `let` + rebuilt in place so the ~11 read sites need no changes.
const TAXONOMY_DEFAULT = {
  "Tops": ["Tee shirts", "Graphic tees", "Long-sleeve tees", "Sleeveless", "Blouses", "Sweaters", "Cardigans", "Sweatshirts"],
  "Bottoms": ["Jeans", "Pants", "Shorts", "Skirts", "Leggings/Joggers", "Tights"],
  "Dresses": ["Short", "Long", "Cocktail"],
  "Outerwear": ["Blazers", "Jackets", "Coats"],
  "Shoes": ["Boots", "Sandals", "Flats", "Heels", "Sneakers"],
  "Workout": ["Workout tops", "Active shorts", "Sports bras", "Swimwear"],
};
let TAXONOMY = JSON.parse(JSON.stringify(TAXONOMY_DEFAULT));
let CATEGORIES = Object.keys(TAXONOMY);

// Single color family per item: label + swatch. Keep in sync with import.py.
const COLOR_FAMILIES = [
  ["Green","#3a7d44"], ["Teal","#1f8f8f"], ["Blue","#2f6fd0"], ["Purple","#7d54a8"],
  ["Maroon","#7b2d3a"], ["Pink","#e88aa8"], ["Red","#c0392b"], ["Orange","#e08a2b"],
  ["Yellow","#e6c34a"], ["Beige","#d8c4a0"], ["Brown","#7a5230"], ["White","#ffffff"],
  ["Gray","#9a9a9a"], ["Black","#1a1a1a"],
  ["Metallic","linear-gradient(135deg,#bfc3c7,#f2f2f2,#c9a14a,#8a8d90)"],
];
const colorHex = (name) => (COLOR_FAMILIES.find(c => c[0] === name) || [])[1] || "#c9beae";

// Formality scale 1-8. Each level = a y/n "could I wear this here?" context.
const OCCASION_LADDER = [
  "Utility", "Very Casual", "Casual", "Polished Casual",
  "Smart Casual", "Dressed Up", "Business Professional", "Formal",
];
const OCCASION_HINTS = [
  "workout gear, gardening, grubby chores", "home, errands", "chorus rehearsal, casual lunch",
  "date nights, matinees, parties", "normal work day",
  "cocktail parties, weddings, evening events", "interviews, conferences", "black tie",
];
const occLabel = (n) => (n >= 1 && n <= 8) ? OCCASION_LADDER[n - 1] : null;

const ACQUISITIONS = ["New", "Secondhand", "Gift"];
const STATUSES = ["Available", "Storage", "Archive"];
const SEASONS = ["Spring", "Summer", "Fall", "Winter"];
const CAPSULE_KINDS = ["capsule", "packing", "travel"];

// Named contexts stamped on a wear (wears.context). Seed list; any custom context
// the user logs gets merged in at runtime via contextOptions() — derive-first, no storage.
const CONTEXT_SEED = ["Work", "Symphony", "Chorus Concert", "Date Night", "Friends",
  "Rehearsal", "Party/Shower", "Wedding", "Funeral", "Errands", "Travel", "Workout"];

const MAX_DIM = 1200;          // longest edge after downscale
const ENCODE_Q = 0.82;         // quality used for both webp + jpeg fallback
const SIGNED_TTL = 3600;       // signed photo URL lifetime (s)

/* ===================================================================
   SESSION  (persisted in localStorage)
   =================================================================== */
const SESSION_KEY = "wardrobe.session";
let session = null;   // { access_token, refresh_token, user, expires_at }

// Safe storage: localStorage is blocked in some contexts (e.g. data: URLs,
// private-mode quirks). Fall back to an in-memory store so the app never throws.
const store = (() => {
  try {
    const k = "__wardrobe_probe__";
    localStorage.setItem(k, "1"); localStorage.removeItem(k);
    return localStorage;
  } catch {
    const mem = new Map();
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, v),
      removeItem: (k) => mem.delete(k),
    };
  }
})();

function loadSession() {
  try { session = JSON.parse(store.getItem(SESSION_KEY)) || null; }
  catch { session = null; }
}
function saveSession(s) {
  session = s;
  if (s) store.setItem(SESSION_KEY, JSON.stringify(s));
  else store.removeItem(SESSION_KEY);
}

