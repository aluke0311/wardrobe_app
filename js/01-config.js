/* ===================================================================
   CONFIG  (publishable key + URL are safe to ship in client code)
   =================================================================== */
const SUPABASE_URL = "https://ofwaxqrwbcixrnjkepuz.supabase.co";
const SUPABASE_KEY = "sb_publishable_MbsUbmttzon5YNsJgUsDrw_Mg5NMCGy";
const BUCKET = "wardrobe";
// Version label shown in the UI: "YYYY-MM-DD vN". N resets to 1 on a new day and
// increments for each additional push the same day (so same-day pushes differ).
const APP_VERSION = "2026-08-16 r3";

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
  { v: "2026-08-16 r3", notes: [
    "The old pack solver is gone for good. It was switched off six days ago and left in place in case you wanted it back; you didn't, so it's been removed — about 5,950 lines of it. Nothing you use changed: a trip is still your list plus outfits proposed from that list, and the by-day planner, the recap, the \"still in the suitcase\" nudge and the hamper row were never part of the solver",
    "One real effect you might notice: adding an item to an older trip no longer makes two pointless trips to the server to update a plan nothing could open",
  ] },
  { v: "2026-08-16 r2", notes: [
    "The rack opens on the pieces you haven't reached for lately, instead of making you scroll past the 32 you already wear to get to them. Same three bands, read the other way round — that band is the whole reason the rack can't quietly shrink your wardrobe, and it was the last thing on its own screen",
    "The closet gets to the clothes faster: the rack, hamper, worn tray and capsule filter are one row of chips rather than four stacked buttons, so you see six categories before scrolling instead of three. The clean/hamper filter now lives on the screens that actually show items — on the folder list it was filtering the counts, so \"Tops · 15\" meant 15 dirty tops",
    "Trip mode and capsule planning can't disagree any more. Planning from a capsule while you were on a trip left the closet showing one and the suggester using the other, with both banners on screen; there's one scope at a time now, and it tells you when the trip mode ends",
    "A finished trip opens on what you took, with the recap one tap away instead of ninth in the ⋯ menu — it used to open by proposing new outfits for a trip that had already ended",
    "\"Wash before you pack\" no longer shows up on a capsule that's never packed, or on a trip you've already come home from",
  ] },
  { v: "2026-08-16 r1", notes: [
    "The day you leave and the day you get back are half at home, and the app now knows it. If you wore something on either of those days that wasn't in your suitcase, it counts as a day at home — no Travel tag, and it won't turn up in the trip recap as something you wore but forgot to pack. Anything you wore on the days in between was in the suitcase by definition, so nothing changes there",
    "Your rack notices those days too: a piece you wore at home the morning you flew now counts as one you reached for, instead of being pushed to the back with the rest of the trip",
    "If you've never ticked a packing list for a trip, nothing changes — the app only applies this when it actually knows what went in the bag",
  ] },
  { v: "2026-08-14 r4", notes: [
    "Your whole wear history now counts towards formality, not just the last few weeks. A wear only got a dressiness level if it was logged after that feature shipped in July — 3.7% of your wear-days — so the app was reading a sliver of a decade. It now works the level out from what you wore that day, backwards through everything. Nothing is rewritten: anything already recorded stays exactly as it was",
    "What that changes: the \"things you might be wrong about\" check can now look at 151 of your pieces instead of 18, and 17 of your 26 contexts have a real dressiness level from your own history instead of a built-in guess (it was 9)",
  ] },
  { v: "2026-08-14 r3", notes: [
    "⃠ is back: you can decline a piece again so it stops being offered for the rest of the sheet. Removing it was the wrong half of yesterday's fix — declining a piece and swapping one are different things, and ✨ stays a plain swap",
  ] },
  { v: "2026-08-14 r2", notes: [
    "✨ is a swap again, not a swap-and-hide. It no longer takes the piece out of the sheet — it just shows you a different one, and it walks through the options for that slot instead of picking at random, so tapping twice can't hand back what you just moved off",
    "Outfits are back to \"Look #1082\" rather than being named after their shape",
    "Room to breathe on the suggestion sheet: the rack and laundry chips were sitting flush against \"Wear this today\", and each piece's 🔒 / ✨ / ✕ now read as one group instead of three loose buttons",
    "Home's row of counts fades at the edge instead of slicing the last one in half",
  ] },
  { v: "2026-08-14 r1", notes: [
    "Home leads with your day now — what you've worn, then \"What should I wear?\", then logging. The five big tiles became one small row of counts: every one of them was already a tab along the bottom, and they were taking up 71% of the first screen",
    "\"What should I wear?\" opens on the outfit instead of on the filters. Context, formality, season and shape fold under a \"Refine\" button underneath it — the pool and laundry chips stay put, so you can still always see what's being left out",
    "The outfit picture is sized to the outfit — a dress and shoes no longer sit in a box built for four pieces",
    "Logging from Home stays on Home instead of dropping you on the calendar afterwards",
    "One less button per piece: the ⃠ \"not this\" chip is gone — it and ✨ were two names for one intention",
    "The little caption under a suggested outfit was describing buttons that weren't there — it now matches what's actually on screen",
    "Stats opens with \"Lately\": days logged, pieces worn, first outings and anything back out after 90+ days",
    "Trips stamp \"Travel\" based on the trip's dates, not on whether trip mode happens to be on in that browser — so a wear logged from another device isn't quietly missing it",
  ] },
  { v: "2026-08-13 r2", notes: [
    "Pieces without a photo can now be suggested and packed like any other — they show as the grey tee placeholder. They'd been invisible to the outfit suggester, the rack and the trip screen, which on a small packing list could hide most of the outfits it could have offered",
    "Fixed the \"Not now\" button on Home's weather-history offer running off the right edge of the screen, and squashing \"Look it up\" next to it",
    "When a trip's list can't make a whole outfit yet, it now tells you what it's short of — shoes, a bottom — instead of suggesting you tap the filter you're already on",
  ] },
  { v: "2026-08-13 r1", notes: [
    "\"What should I wear?\" is now a proper button on the trip screen too — same one as Home, asking the suitcase instead of the closet (it replaces the small ✨ Suggest chip, so there's still one way in)",
  ] },
  { v: "2026-08-10 r7", notes: [
    "Removed the last buttons that could still start the old pack solver — \"Build the pack\" / \"Rebuild\" on a trip's page was still building one",
    "The by-day plan no longer fills itself in from the solver, and Home no longer proposes today's outfit from it — both were showing you a plan you hadn't agreed to",
    "Gone with them: the day-spread \"keep these days\" row, the mid-trip wash heads-up and the pack's after-the-trip grade, all of which described a plan that no longer exists",
  ] },
  { v: "2026-08-10 r6", notes: [
    "A trip is two screens now: Your list, and Outfits. You add the pieces you're taking; the app proposes outfits made only from those pieces, and never adds anything of its own",
    "Every outfit it shows you is one you can actually make from your bag — tap ＋ Save as a look to keep one, or ✎ Change it to open the builder with those pieces already on the canvas",
    "Build one yourself from the list, with the picker already scoped to what you're bringing",
    "Filter the proposals by how dressy you need — only the levels your list can actually put a whole outfit together at are offered",
    "Gone from the trip screen: the pack solver, the bag, the review queue, the laundry schedule and the Light/Balanced/Flexible modes. Nothing was deleted — it's switched off while you try this simpler version",
  ] },
  { v: "2026-08-10 r5", notes: [
    "Four Stats pages had a filter funnel that did nothing. Year in Review, Most Worn Looks, Contexts and a context's page all count across your whole wardrobe — so narrowing the funnel changed the badge and not one number. The funnel is gone from those four; Contexts keeps its date range, which does work",
    "The Laundry filter on the Looks tab was the same story: it lit up, counted itself, and never filtered a look. It works now — \"Clean\" means every piece is clean, \"In the hamper\" means something in the look is dirty",
  ] },
  { v: "2026-08-10 r4", notes: [
    "Changing a pack outfit now SAVES it. The only button on that screen offered to log the outfit as worn today — the thing you never want — while saving it to the trip was hidden in the ✕. It reads \"Use this outfit\" now, and ✕ means never mind",
    "You can pick the layer you actually want. ＋ Layer used to add a random one out of a list you couldn't see, and it disappeared entirely once an outfit already had a layer. Now it shows you the pieces by name, ⇄ changes the one that's there, and anything the app filtered out is still listed — dimmed, with the reason (\"in the wash\", \"not Smart Casual\") — and you can still choose it",
    "New: ＋ Shirt. If an outfit is wearing a shirt that can also be a layer, you can add a top underneath and that shirt becomes the layer",
    "\"Change it myself\" opens your suitcase, not your whole closet — with a Whole closet tap when you do want something from outside the bag",
    "\"Which would you actually wear?\" now appears on every undecided outfit. It used to vanish whenever the other days had claimed all the alternatives, so unlocking an outfit could look like it did nothing",
  ] },
  { v: "2026-08-10 r3", notes: [
    "Fixed: every row in a trip's ⋯ menu did nothing. By-day plan, Add items, Rename, Dates, Duplicate, Share, Archive, Delete — all of them. They were wired to handlers that can't see inside a sheet, and only Locations (which was wired differently) ever worked",
    "The by-day plan is yours to arrange. Every occasion you picked has 📅 Move day right on its card, each one says whether the day is your choice or the app's, and \"Keep these days\" pins the lot where they are so nothing gets re-spread",
    "The packer now tries to use your whole list. Anything you add to a trip by hand counts as something you're bringing: it can't be trimmed as spare, it can't be dropped from the trip, and the outfits re-derive so it actually gets worn. Measured on a Light-mode trip: five pieces added by hand, all five in outfits",
    "New: \"Don't plan around\" — select pieces on the Items screen and mark them. They stay packed and stay on your checklist; the app just stops building outfits with them. Tap again to put them back in the plan",
  ] },
  { v: "2026-08-10 r2", notes: [
    "Unlocking an outfit shows you the alternatives again. Choosing marked the day decided AND locked it; unlocking only ever undid the lock, so the card came back editable with nothing to compare against",
    "The review can see the laundry now. An option that would put a piece past its clean wears says so (\"🧺 3rd wear of the white tee\"), and clean options are always offered first — they're ranked down, never hidden, because on a long trip your whole bag can be over the line and an empty card would be worse",
    "A day whose outfit is already past its wears says so on the card, where you're choosing — that fact existed, but only on the Items screen",
    "Laundry is a real setting on the trip's Plan tab: pick the days you'll wash, or leave them off. Everything resets on a wash day, so the pack needs fewer of the things you wear most — and setting one re-plans the trip around it, keeping every outfit you've locked",
  ] },
  { v: "2026-08-10 r1", notes: [
    "Every occasion now gets its OWN alternatives. They used to be worked out one card at a time from the same bag and the same ranking, so four days of one context were offered the identical three outfits — and two of those three were what other days were already wearing, so \"choosing\" could only produce a repeat. The options are dealt across the whole trip now: no card is offered another day's outfit while it still has something else to show you",
    "When the bag can't give a day anything the other days aren't already being offered, one option comes from the rest of your closet, priced (\"+1 to your bag\") — one per card, never more",
    "Choosing an outfit now re-plans the rest of the trip around it, automatically. Your choice is locked, every earlier choice stays locked, and only the days you haven't decided move. Undo puts the whole trip back",
    "On the full \"what to wear\" screen, an outfit another day is already wearing says so",
  ] },
  { v: "2026-08-09 r5", notes: [
    "A trip is one screen now. Plan · Bag · Outfits, with the section that matters chosen by where the trip is — Plan before you've built, Outfits once you're travelling. The build sheet is gone as a separate modal; setting what's happening, what you're definitely bringing and how much to bring all live on Plan, where you can see them",
    "Nothing was dropped: rename, dates, duplicate, share, archive, delete, locations and weather all moved to the ⋯ menu, and they're the same actions, not copies",
    "Undated capsules keep the old page \u2014 they have no dates, no bag and no occasions, so a trip screen would be mostly empty boxes",
    "Fixed a sideways scroll on every pack screen: the \"Day by day\" row was 14px wider than the column it sat in",
  ] },
  { v: "2026-08-09 r4", notes: [
    "The packer now packs from outfits you've actually worn. Looks you've worn come first, then shapes you rebuild (your formulas), and only then something invented \u2014 and the BAG is built from those outfits rather than from slot counts, which is what makes it possible. Measured on a trip that used to produce 0 outfits you'd worn: every single one is now either a look you've worn or a shape you wear",
    "Before this, 298 outfits you'd worn fitted each day of a trip and exactly 2 of them survived inside the bag \u2014 because the bag was chosen piece-by-piece first, and picking pieces first destroys the combinations",
    "It stays a preference, not a rule: an outfit you've worn wins between otherwise-equal choices, but it can never make the bag bigger, buy a repeated look, or put you in something dirty",
    "Adding a piece to a trip from anywhere now adds it to the pack too. There were two lists of \"what's coming\" and they fought \u2014 a piece added from the trip's Add-items screen was DELETED the next time you edited the pack, unless you'd already ticked it as packed",
  ] },
  { v: "2026-08-09 r3", notes: [
    "You can schedule your contexts instead of letting the app assign them. Every occasion you picked has a 📅 day button \u2014 choose a day and it stays there, and the app spreads everything else around it. Tap \"Let the app choose again\" to hand it back. Moving one day leaves the other days' outfits exactly as they were",
    "\u270e Change it now asks how: suggest around this outfit (keeping the pieces you like), or open the builder with it already on the canvas. It was opening a BLANK canvas \u2014 a bug \u2014 which made \"change it myself\" mean \"start over\"",
    "The suggester opens on the outfit you were looking at, rather than rolling a fresh one, so you can lock the parts you like and swap the rest",
    "\"See all the options\" and \"See other outfits\" were the same door with two names. There's one now",
  ] },
  { v: "2026-08-09 r2", notes: [
    "\"See other outfits\" now opens a full screen with everything your closet can build for that day \u2014 usually 50-odd outfits, not three chips on a card. Your bag's options come first because they're free; the rest say what they'd add. \u2728 Another / Suggester / Other options are gone: they were three doors onto the same question and none of them said so",
    "\u270e Change it myself opens the builder with that outfit already loaded, so you can fix an almost-right outfit instead of replacing the whole thing. Saving makes it that day's outfit",
    "\"Definitely bringing\" uses the normal item picker now \u2014 search, filters, the laundry lens, category browsing \u2014 instead of the stripped-down grid it had",
    "The options list no longer pads itself with outfits that differ only by shoes, and the count at the top matches the list underneath it",
  ] },
  { v: "2026-08-09 r1", notes: [
    "The review can now reach outside the bag. Every outfit has \"Show me something else\" \u2014 options built from your whole closet, not just the pieces already packed, each one saying what it would add (\"+1 to your bag\"). Before this, the review only ever reshuffled a bag you'd had no say in: measured on a 7-day trip it was offering 21 alternatives when 3,171 existed in your closet at those levels",
    "\"I'd rather\u2026\" is on every outfit now \u2014 not a dress, dress it down, dress it up \u2014 and setting one RE-SOLVES that day rather than just re-picking from what was already there. If your rule leaves nothing buildable the day is reported uncovered rather than the app quietly ignoring you",
    "You can say what you're bringing BEFORE the pack is built. The build screen now has \"Definitely bringing\" \u2014 add anything you've already decided on and the bag gets built around it, instead of you having to add it afterwards and hope",
    "The build screen was still offering Lean / Normal / Cushion, a control that no longer exists anywhere else in the app. It now shows Light / Balanced / Flexible with what each one means",
  ] },
  { v: "2026-08-08 r4", notes: [
    "The pack asks you now. Every outfit shows two or three real alternatives with \"Which would you actually wear?\", and picking one locks it in \u2014 the app then optimises the rest of the trip around your choice instead of quietly re-deciding it. \"These all look fine\" clears the whole thing in one tap",
    "The alternatives are genuinely different, not the next three in the same ranking. They're picked to differ in SHAPE \u2014 a dress instead of separates, a different silhouette \u2014 using the same formulas the app already recognises in your outfits, so \"more options\" means something",
    "Occasions are ordered by how little the app can tell them apart, so the ones worth your opinion come first and skipping the rest is safe. Days you declared, and dressier days, come before an airport transfer",
    "Your choices are quietly filed as evidence about that kind of day \u2014 not acted on. Later the app will be able to say \"you've picked separates for Dinner five times, want me to stop offering dresses there?\" and you decide",
  ] },
  { v: "2026-08-08 r3", notes: [
    "Lean / Normal / Cushion is gone. It asked you to think in \"options per occasion\" \u2014 and measurably, all it ever changed was how many SPARE pieces you carried: the outfits needed the same 9 pieces at every setting. It's now Light / Balanced / Flexible, and each one tells you what you'd actually carry before you pick it",
    "Your pack is split into Core and Spare. Core is what your planned outfits actually use. Spare is everything else, each piece saying how many of the bag's possible looks it's in, with a Leave button. That's the packing-light decision made where the piece is, with the trade stated \u2014 rather than a dial you set and hope about",
    "Slot counts stopped inventing shortfalls. A slot could read \"5/7\" and claim \"2 short \u2014 nothing else you own fits this trip\", when the app had simply trimmed the spares itself. It was blaming your wardrobe for its own decision",
  ] },
  { v: "2026-08-08 r2", notes: [
    "You can now tell the app what you'd rather wear for a kind of day. \"I'd rather…\" in the suggester sets a rule like \"not a dress\" or \"more casual\" \u2014 and it sticks, for that context, every time. This is the thing you couldn't escape before: the pack would keep offering a dress for a context you'd never wear one to, and swapping or re-rolling would just hand you another",
    "A rule you set is obeyed, not weighed. Everything else the app narrows with \u2014 season, weather, what you've worn for an occasion before \u2014 quietly widens again if it can't build an outfit, because a guess shouldn't cost you an answer. A rule you stated doesn't do that: if nothing fits it, you get an empty sheet that says so, rather than the app deciding it knew better",
    "Rules are always visible and always one tap to clear. The chip at the top of the suggester names the rule in force, and tapping it again turns it off",
    "On a trip you can overrule a standing rule just for one occasion, without changing the general one",
  ] },
  { v: "2026-08-08 r1", notes: [
    "Lean / Normal / Cushion finally changes the bag. It was working out the right numbers all along — on a 7-day trip it proposed 11, 15 and 19 pieces — and then a last step rebuilt the bag from just the pieces your outfits happened to use, cutting all three back to 8, 8 and 9. Lean and Normal came out identical, which is why moving the dial did nothing. You now get the bag it proposed",
    "Lean also stopped quietly buying its smaller bag with repeated outfits — a leftover from the old meaning of Lean, before you said it should be \"the same, just a smaller bag\". Wearing one top with two different bottoms was never the problem and still isn't; that's two outfits",
    "A day you've planned no longer opens by telling you nothing is there. Future days used to lead with \"Nothing logged for this day\" and put the plan underneath it — the same sentence that made the wedding look like it didn't exist. A future day with no plan now says so in its own words, and past days are unchanged",
    "Style Stats and the Closet vs Life page no longer contradict each other. One said your closet skewed toward a level while the other said there were no big gaps — the first had no threshold at all, so three workout pieces you never log was enough to trigger a verdict. It now waits for a real gap, states both numbers, and stops telling you what to do about it",
    "Home's Calendar tile says \"Nothing logged today\" instead of \"Nothing logged yet\", which read as though you'd never logged anything",
  ] },
  { v: "2026-08-06 r4", notes: [
    "Days you've planned something for now show it. A context you'd set for a future day — which is what the trip builder and the rack read — rendered nowhere: the calendar said \"Nothing logged for this day\" while the app was quietly packing for it. That's where the wedding on your St. Louis trip came from. Planned days now say what's planned, on any day from today onward, and the month grid marks them with a dot",
    "Opening a built pack no longer rebuilds it. The outfits were being solved fresh every single time you looked, and thrown away again — so the plan could differ between two opens when you'd changed nothing. It solves once and remembers",
    "Adding a fixed event to a trip takes two taps instead of one. The list shows every context with its formality beside it, which invites tapping one just to see — and that tap used to create the event, on a date already filled in, permanently and invisibly",
  ] },
  { v: "2026-08-06 r3", notes: [
    "Occasions now spread across the whole trip instead of piling onto the days nothing else had claimed. On your St. Louis trip you'd asked for nine occasions over five days, two of which were free — so four Home days became two days holding two Home occasions each, and each pair got the identical outfit. That's where \"two outfits for four days\" came from: the day list, not the outfit picker",
    "Two occasions on one day can no longer come back in the same clothes when they're the same kind of occasion. Different contexts sharing one outfit is still fine — that's one outfit across two things, and it shows as one card",
    "An event on your calendar can be taken out of a trip's packing. A wedding on a trip date was regenerating on every build with nowhere to say \"not this trip\", and it wasn't even listed under What's happening. It is now, and unticking it only removes it from the packing — it stays on your calendar",
    "You can also drop a day the app filled in for you, and leave it with nothing planned",
    "Unticking a context no longer hands its outfit to a different day. Occasions were identified by their position, so removing one renumbered the rest and the outfits shuffled underneath them. The days you didn't touch now keep exactly what they had",
    "The pack's outfits are actually saved now. They weren't — every time you opened a built pack it solved again from scratch, so the plan could change when you'd changed nothing",
    "Lean means a smaller bag, not a repeated outfit. It used to aim for half as many looks as you had days; all three settings now aim for a different outfit each time, and the dial changes how much spare you carry",
  ] },
  { v: "2026-08-06 r2", notes: [
    "The Calendar tile on Home now counts what you logged as outfits, not pieces — a five-piece look said \"5 logged today\"; it now says \"1\"",
  ] },
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

