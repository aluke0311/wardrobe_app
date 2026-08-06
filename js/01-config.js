/* ===================================================================
   CONFIG  (publishable key + URL are safe to ship in client code)
   =================================================================== */
const SUPABASE_URL = "https://ofwaxqrwbcixrnjkepuz.supabase.co";
const SUPABASE_KEY = "sb_publishable_MbsUbmttzon5YNsJgUsDrw_Mg5NMCGy";
const BUCKET = "wardrobe";
// Version label shown in the UI: "YYYY-MM-DD vN". N resets to 1 on a new day and
// increments for each additional push the same day (so same-day pushes differ).
const APP_VERSION = "2026-08-06 r1";

/* Every release, newest first (2026-08-04 r1, her ask: "in settings, the most
   recent few changes should be listed, or a new page with all the app updates
   so I can always see them").

   ⚠️ ONE LIST, TWO SURFACES. WHATS_NEW is derived from the head of this array
   rather than maintained beside it — the post-update toast and the Settings
   changelog can then never disagree, and there is exactly one thing for the
   deploy skill to add to. Prepend a new `{ v, notes }` whose `v` IS the new
   APP_VERSION; the selftest pins that they match.

   Notes are user-facing sentences, not commit subjects — this is the only
   place in the app that explains what she paid attention for. */
const RELEASE_NOTES = [
  { v: "2026-08-06 r1", notes: [
    "Removing a piece from an outfit you logged TODAY now removes that piece's wear too, and adding one adds it — so the \"what this wear changed\" screen agrees with what you actually wore. Editing a look from its details page never touched your wear history before, which was right for a look you wore last March and wrong for the one you logged an hour ago. Older wears still ask first, as they always did",
    "The pack stopped repeating itself. It was building a bag with several options per day and then never spending them — the outfits were chosen while the bag was still half empty, and at that point re-wearing yesterday's outfit is literally cheaper than reaching for anything not yet packed. It now re-picks the days once the bag is finished. Measured on a trip that came back with seven occasions in two outfits: five outfits, same bag",
    "It also asks for more options when more days are asking. Four casual days used to be promised two outfits, because \"options\" was counted per level rather than per day",
    "Travel plans no longer stock the rack. A dressy event on a trip was putting every formal piece you own into the pool you get dressed from at home, for a fortnight — which is where the heels kept coming from",
    "The rack only stocks levels 2–5 unless you've actually planned something dressier. Wearing something dressy now and then was enough to make it go looking for more",
    "The second-look, kept-in and taken-off lists on the rack screen fold away",
  ] },
  { v: "2026-08-05 r13", notes: [
    "For packing, two outfits that differ only in shoes are now the same outfit. The solver treated any differing piece as a new outfit, so changing shoes was the cheapest possible way to satisfy \"don\'t repeat\" and \"give her options\" — one small piece added and every repetition penalty reset, without the outfit looking any different",
    "\"Other options\" and the option count are per look too. Twelve options could be the same top and jeans twelve times over with different shoes, and that\'s what the number on the card was counting",
    "Sharing the same jeans under a different top is still fine — that\'s the point of packing light. What\'s ruled out is two outfits that read identically",
  ] },
  { v: "2026-08-05 r12", notes: [
    "A piece with no formality level below 6 cannot be on the rack unless you have PLANNED something at that level. Before this, your habitual levels also let one in — so if 6 was among the three levels you wear most, every pair of heels you own was exempt and the rule did nothing. Habit is not a plan",
    "Wearing something dressy no longer puts it back on the rack either. A piece worn in the last two weeks is normally forced in, which meant one dressy evening put the heels back for a fortnight — exactly the stretch you are least likely to need them again. Planning still works: a planned outfit containing them is a plan",
    "A pin still overrides all of this — keeping a piece on the rack is you saying so",
    "A trip\'s formality now reaches the rack as the level you set for that trip, not the level you usually wear to that kind of thing",
  ] },
  { v: "2026-08-05 r11", notes: [
    "Lean / normal / cushion now actually changes the bag, and here\'s why it didn\'t: the app works out how many of each thing to pack from what you\'ve packed on real trips before — and you pack generously, so on a week-long trip every single category was already hitting its ceiling. Normal and cushion produced identical bags. That ceiling is now what \"normal\" means, and cushion is allowed past it while lean goes under it. Measured on a 7-day trip at your rates: 26 / 34 / 43 pieces",
    "Changing the tightness also wasn\'t re-solving the outfits — it rebuilt the bag and kept the previous setting\'s outfits, then hit an error working out the toast, silently",
  ] },
  { v: "2026-08-05 r10", notes: [
    "Undoing a \"not right now\" no longer pins the piece to the rack. Those were two decisions welded into one button: Reset just makes a piece eligible again so it competes for a slot like everything else, and 📌 is there separately for when you mean keep it in",
    "You can see your rack pins — a \"Kept on the rack\" list on the rack screen, each with how long the keep has left and an Unpin. They used to be write-only: a toast said it was kept and then there was no way to find it again",
    "An item\'s own screen has both too: \"Stop keeping\" on a kept piece, and \"Reset not right now\" on one you pushed off",
  ] },
  { v: "2026-08-05 r9", notes: [
    "Found the real reason the heels kept coming back. When a piece has no formality set, the app guesses one — heels guess \"Dressed Up and Formal\" — and then widens the guess with the levels of things you\'ve worn them WITH. So a pair worn a few times with a casual outfit quietly counted as casual, and both of the last two fixes were reading a number that had already moved. The rack now judges dressiness on the piece itself. If you\'ve set a piece\'s formality by hand that still wins — that\'s your call, not a guess",
    "Pieces dressier than an ordinary day are capped in the rack\'s rediscovery bands, where before only pieces matching NONE of your levels were. Your top three lived levels were being read as a licence for the dressiest thing that touched them",
    "Taking something off the rack tops the slot back up from the same shelf, instead of leaving the rack a piece short until the weekly shuffle",
    "The rack screen lists everything you\'ve taken off it, saying which will come back on their own and which won\'t, with a Put back on each",
    "Lean / normal / cushion actually changes the pack now. Choosing one rebuilt the bag and then handed back the outfits it had already solved, so the setting was invisible",
    "Today\'s card on Home shows what you actually wore once you\'ve logged it. It was reading only the plan, so logging from the calendar or a look left Home proposing something else. A suggestion is still there, behind \"Something else to wear?\"",
  ] },
  { v: "2026-08-05 r8", notes: [
    "The Today card stays out of the way during a trip — the trip dash already is today",
  ] },
  { v: "2026-08-05 r7", notes: [
    "Plan the week lives inside the Calendar tab now — Month / Plan the week at the top, sharing the same day view. It's no longer a screen you can only reach from a link at the bottom of the Tomorrow card",
    "You can set a day's context from the week screen even when the outfit is already picked, and clear one entry, a whole day, or the whole week from there",
    "\"Outfit still to pick\" was a lie on any day you'd logged from somewhere else — the screen only read the plan, never what you actually wore. It reads both now and says what you wore",
  ] },
  { v: "2026-08-05 r6", notes: [
    "Today has its own card on Home, the same one Tomorrow gets: your planned outfit if you have one, a suggested outfit if you don't, the weather, and \"you've dressed for this before\". A dropdown context button sits next to the outfit — setting it re-levels the suggestion",
    "Nothing on Home is hidden behind \"2 more things\" any more. Everything that wants your attention is just on the page",
    "A \"Keep off the rack\" toggle on any piece, next to \"Don't suggest in outfits\". Narrower on purpose: the piece is still suggested when you ask for its level or it's in a capsule — it just never takes one of the rack's standing slots",
    "Pieces that ONLY work at Dressed Up and above stay off the rack unless you've declared a day for them. The cap on dressy pieces was right for a blazer that also does a work day and wrong for a gown, which has no ordinary day to be in play for. Put a wedding in the planner and they come straight back",
  ] },
  { v: "2026-08-05 r5", notes: [
    "The outfits screen is organised by the buckets you declare, not by day. One section per context → formality, holding exactly the number of outfits you asked for, with the count on it. The plane days and any day you declared nothing are in their own labelled sections instead of mixed in with your choices. Day by day is still there, folded underneath, where the laundry schedule lives",
    "Every occasion now has a Suggester… button: the real outfit suggester, opening on the suitcase, with the usual one-tap widen to your whole closet. Whatever you leave it on becomes that occasion's outfit",
    "Outfits could use pieces that weren't in the packing list — most visibly hiking boots on a workout day, because workout occasions are allowed to draw from the whole closet. The bag is now re-derived from the outfits after every solve, which is the rule the pack was built on",
    "\"What's happening\" says out loud when the ticked contexts are still the app's guess rather than your choices, and has a Clear all. Clearing now means nothing is happening, instead of quietly handing the guess back",
  ] },
  { v: "2026-08-05 r4", notes: [
    "A suggested outfit can have a piece taken OUT, not just swapped — the ✕ beside each piece. Shoes off an outfit you'll wear at home is a real outfit, and the app already treats a shoeless look as \"Home\". It won't let you take out something that would leave no dress and no top + bottom",
    "Editing a look's pieces no longer means a trip through the builder: swipe a piece left on the look's Details page to remove it, and ＋ Add a piece to put one in",
  ] },
  { v: "2026-08-05 r3", notes: [
    "A Clean / 🧺 Hamper / All row now sits at the top of the closet and of every add-an-item picker, always visible — no going into the filters to find it. It's the same filter underneath, so the funnel and the row can't disagree",
  ] },
  { v: "2026-08-05 r2", notes: [
    "The rack stopped being the suitcase you just unpacked. It ranked purely on how recently you wore something, so for two months after a trip the ~20 pieces you packed owned rotation and everything you were wearing at home the week before you left ranked behind them. It now ranks on when you last wore a piece AT HOME",
    "Putting a piece on the rack no longer keeps it there forever. A keep clears the moment you wear it — at which point it stays in on merit — or after 60 days at home if you never do, so your additions are respected without permanently taking a slot the rack needs. The item screen says how long a keep has left",
  ] },
  { v: "2026-08-05 r1", notes: [
    "The rack size is yours now — Settings → Rack size. It scales every category and keeps the 20% you haven't reached for lately, so a bigger rack is a bigger working wardrobe rather than just more tops",
    "Trips and capsules are two tabs, and ＋ New is at the top of the list instead of under it",
    "A trip can have its place set on the page where you create it, so the weather is there from the start",
    "Swipe left on a trip or capsule to delete it",
    "Splitting or deleting a look now tells you how many times it was worn before today — the thing you actually decide on",
    "\"Use the default arrangement\" stopped disappearing once a look had been arranged; it now reads Reset, and Undo is on the toast",
  ] },
  { v: "2026-08-04 r6", notes: [
    "The pack won't put in something that's out of season for every leg of the trip. It was only ever the rack that filtered by season, and the bag is chosen partly outside the rack — which is how snow boots got packed for a summer trip",
    "It now weighs how much you actually wear a piece: wear-days at home and on past trips, not just \"worn recently\". A shoe worn once last week used to score the same as one you wear constantly, so specialist pairs kept winning slots over your everyday ones",
    "One trip counts as evidence now. Something you wore nearly every day of your last trip used to be invisible until you'd taken it on two",
    "The plane day stops offering silhouettes you've never flown in. Your flights are tagged Travel like the rest of the trip, so it reads the first and last day of past trips instead — if you've never worn a dress on a plane, it won't suggest one",
    "\"Doesn't fit any occasion on this trip\" was often the wrong thing to say — usually the piece is fine and nothing else in the bag goes with it yet. It now says which",
  ] },
  { v: "2026-08-04 r5", notes: [
    "Build a pack no longer puts in clothes there's no day for. Once every formality level had enough to wear, the leftover slots were being filled by whatever you'd worn recently — so the bag picked up pieces and then told you they didn't fit any occasion on the trip. A slot is allowed to come up short instead, and says so",
    "Workout days build now. Your running shoes are Sneakers at an everyday formality with a gear tag, so the pack was asking \"does this say level 1\" and getting no — it never packed the shoes a workout day needs, then reported the day as uncoverable",
    "The pack's outfits are just on your by-day plan and today's trip screen. No \"send to the plan\" step, and every editing option — swap a piece, another outfit, other options, lock — is there too. A look only gets saved to your Looks when you say you wore it",
  ] },
  { v: "2026-08-04 r4", notes: [
    "A piece you've worn in the last two weeks is now on the rack, and so is every piece of an outfit you've planned for the next two weeks. Before this the rack only knew what LEVEL your plans needed, not which clothes you'd actually chosen — and wearing something off the rack didn't put it there until the next weekly rebuild",
    "The rack no longer rotates while you're away. Its \"worth a second look\" list counts how often a piece was offered and passed over, and a rebuild during a trip was counting clothes hanging in a closet you weren't standing in",
    "You can change a trip's dates after making it — Dates, next to Rename on the trip. Weather for any day that's no longer part of the trip is put back to what it was at home",
    "A trip's locations can be removed even before you've set both dates. The whole section used to be hidden until the trip was fully dated, which also hid the only way to delete a location",
  ] },
  { v: "2026-08-04 r2", notes: [
    "The rack now notices when the app itself has changed how racks are built. That's why the heels survived the last update — your stored rack was fine by every check it had, so it sat there unchanged, and the new rule never ran",
    "Outfits must now share a formality level to be suggested at all. The app has always said an outfit only works at a level every piece can be worn at, but it only enforced that when you asked for a specific level — so on an ordinary day it could pair dressy heels with a tee and jeans",
    "A rack slot is allowed to come up short rather than pad itself with clothes for days you don't have. Filling to the quota was quietly putting the heels back",
    "“Worth a second look” now needs a piece to have been in front of you for a couple of weeks, not just offered three times. Tapping Rebuild now a few times in an evening was counting as three chances to wear it",
  ] },
  { v: "2026-08-04 r1", notes: [
    "The rack stopped filling its rediscovery slots with dress-only pieces. Heels and other clothes for days you rarely have now take at most a slot or two per category, so the rack shows you things you can actually wear this week",
    "Every update is now listed in Settings → What's new, all the way back — not just the one that landed last",
    "The hamper screen sorts by wash load, and both ways in (the button and Select ✓) open the full wash sheet, so you can set the date and the loads instead of just stamping today",
    "The outfit suggester stopped skipping dresses. It was building thousands more top-and-bottom combinations than dress ones and then picking from the top of that pile, so dresses almost never survived",
    "The buttons under a suggested outfit are now in the same order as the pieces above them",
    "Looks without a saved arrangement can be shown in a default layout instead of a collage — Settings → Appearance, or set one look at a time from its Details page",
  ] },
  { v: "2026-08-03 r7", notes: [
    "“Would there be problems if I delete this?” now answers the wardrobe question too — which contexts would get thin, and whether anything else in your closet could stand in",
    "Fixed the rack churning: only its weekly shuffle rotates the rediscovery picks now. Installing an update or planning a week tops up coverage without reshuffling anything",
  ] },
  { v: "2026-08-03 r6", notes: [
    "Flag a piece for review with a note of your own — it changes nothing, it just collects in Stats",
    "Deleting a piece now tells you exactly what goes with it: every wear ever logged for it, and any calendar day or look that falls apart without it",
    "Filter by rack anywhere a filter exists",
    "Add a context the rack can't dress and it rebuilds right then, instead of waiting for Sunday",
    "The app stopped telling you to wash things — it says what your plan does and leaves the decision to you",
  ] },
  { v: "2026-08-03 r5", notes: [
    "Planning ahead knows the laundry: “clean only” now means clean on the day you're dressing for, not clean today",
    "The wear screen got room — a card per piece, so long names stop landing on the numbers, plus your usual gap between wears, wears per month, and wears this year",
    "Month review: how cost per wear moved for each piece, what you wore most, what came back from the deep — and every past month is browsable",
    "The trip wash row says what your plan does and which day it runs out, instead of ordering you to wash something",
  ] },
  { v: "2026-08-03 r4", notes: [
    "Plan the week is a real screen: contexts and an outfit per day, with Suggest / add a Look / Build inline",
    "It walks the week day by day and names the day a piece runs out of clean wears — and it warns rather than quietly hiding anything",
    "Mark a wash day and the counters reset from there",
  ] },
  { v: "2026-08-03 r3", notes: [
    "Logging a wear now shows what that wear changed: cost per wear before and after for every piece, the gap it closed, and how close each piece is to the hamper",
    "The same screen opens read-only from a calendar day or a look's wear list",
  ] },
  { v: "2026-08-03 r2", notes: [
    "Laundry asks for the date first, then shows what was in the hamper on that day",
    "Anything worn since then is listed separately, unticked — so back-dating a wash can't swallow today's clothes or quietly reset a piece's wear count",
  ] },
  { v: "2026-08-03 r1", notes: [
    "The rack has three bands now — in rotation, steady, and haven't reached for lately — so the moderately-worn middle of your wardrobe stops being invisible",
    "It grew from 46 to 58 pieces, and the rediscovery picks genuinely rotate instead of returning the same nine forever",
    "“Worth a second look”: pieces the rack has offered three times that still haven't gone out, with four answers you pick",
    "Tomorrow's pick comes from the rack now — it was the one screen that never used it",
    "Ask for a context you've dressed several ways for and the app shows you the levels you've actually worn",
  ] },
  { v: "2026-07-30 r1-r6", notes: [
    "Set contexts and a formality per event on a trip day, and add new contexts as you go",
    "The pack screen leads with the items, not the schedule",
    "Travel is a trip-wide tag rather than something stamped on the plane day",
  ] },
  { v: "2026-07-29 r1-r4", notes: [
    "The trip builder: tell it the trip and it works out what to pack and how many, from past trips, past wears, the forecast and how long you'll go between washes",
    "It won't hand you the same outfit two days running any more, and it names the day something runs out rather than saying “6 things are dirty”",
    "Trip retrospective: what earned its weight, and what you packed and never wore — stated as a fact, never as advice",
    "Mid-trip, it tells you what you haven't worn yet while there's still time to wear it",
  ] },
  { v: "2026-07-26 r1-r13", notes: [
    "The rack: a standing pool of what's in play, which the suggester now draws from by default — always visible, always named, always one tap from the whole closet",
    "“Things you might be wrong about”: pieces whose wear history disagrees with the formality you gave them",
    "“Vary this look” starts from an outfit you already have",
    "Formula chips in the suggester — rebuild a shape you keep returning to with different pieces",
    "Workout is a formality level now, not a separate mode, so a run actually builds an outfit",
    "A coherence pass: fewer screens printing their own title twice, one meaning per icon",
  ] },
  { v: "2026-07-25 r14-r22", notes: [
    "Log where you've been, and past weather is looked up there instead of at home",
    "One season flag, only when your season tags and what you've actually worn genuinely disagree — the guessing layer that produced the rest was deleted",
    "Closet Review compares the seasons you set against the seasons you wear, and its one-tap answer adds rather than replaces",
  ] },
  { v: "2026-07-25 r1-r13", notes: [
    "Weather memory: “you've dressed for this before”, with the outfits you wore on days like today",
    "Milestones when you log — first outing, paid off, back from the deep, and four more",
    "Your weekly rhythm pre-fills the planner, and never saves itself",
    "Closet keyword search came back",
    "Palette: the colours you own against the colours you actually wear",
    "What's missing: which contexts are thin, and which pieces are doing the most miles",
    "Year in pixels, and On this day on Home",
  ] },
  { v: "2026-07-24 r1", notes: [
    "A wear is a DAY, everywhere. A five-piece outfit was counting as five wears in the stats and five outings for its context — every one of those numbers is now honest",
    "The Rotation bar taps through to the two halves of the number: what you wore and what you didn't",
  ] },
  { v: "2026-07-21 r1-r14", notes: [
    "The editorial redesign: warm paper and oxblood, a serif for headings, and real dark mode",
    "Two themes to choose from in Settings",
    "Tomorrow's pick sticks around instead of vanishing on a refresh",
    "Edit your own categories and types",
    "A Worn tray for the pile on the chair — worn since washing, not dirty yet",
    "“Usually worn with”, your rhythm per piece, and how much of the closet you actually rotated",
  ] },
  { v: "2026-07-22 r1", notes: [
    "Laundry control: pick the loads you ran and see exactly what's in them, back-date the wash, and override wears-per-wash per item",
  ] },
];

// Shown once after each update — always the head of RELEASE_NOTES, never a
// second hand-maintained list.
const WHATS_NEW = (RELEASE_NOTES[0] && RELEASE_NOTES[0].notes) || [];

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
  "Rehearsal", "Party/Shower", "Wedding", "Funeral", "Errands", "Travel", "Flight", "Workout"];

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

