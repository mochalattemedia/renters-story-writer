// ==================================================================
// alerts-card-js.js  —  ac-v29
// Daily listing alerts card for /account/home. Served from Netlify;
// head code carries only the 6-line loader stub.
//
// Backend: alerts-prefs.js ap-v8. Voice: alerts-voice.js av-v1.
//
// ac-v29 CHANGE: NAMING, NEGATIVE NUMBERS, AND NAMES CUT MID-WORD.
//
// 1. THE ENTRANCES DID NOT READ AS THE WAY TO ADD A SEARCH. "Describe
//    another out loud" and "Add with a form" both say HOW before they say
//    WHAT, so a renter with one search already saved had no obvious "make
//    another" control - they were reading two descriptions of methods.
//    Every entrance now leads with the verb, and the two states stay
//    parallel: Start out loud / Start with a form on an empty card, Add a
//    search out loud / Add a search with a form once there is one.
//
// 2. A NEGATIVE PRICE WAS ACCEPTED BY THE FIELD AND SILENTLY DISCARDED.
//    Live: an option took -4 off the number spinner. The store was never
//    at risk - ap-v11 rejects anything not above zero - but readForm
//    turned it into null without saying so, and the renter walked away
//    believing they had priced that option. SILENTLY DROPPING WHAT
//    SOMEBODY TYPED IS WORSE THAN REFUSING IT, because they never find
//    out. min="0" on all nine number inputs stops the spinner, and the
//    reader now CLEARS the field so a typed or pasted negative visibly
//    goes rather than quietly vanishing.
//
// 3. NAMES WERE CUT MID-WORD. The store caps a name at 40 characters and
//    a hard slice produced "Jason - 2BR/1BA Wyoming w/ yard & parkin",
//    which reads as a typo rather than a limit. trimName() cuts back to
//    the last space when one is close enough to the end, then strips
//    trailing punctuation.
//    ⚠️ AND IT DOES IT WITHOUT A REGEX, DELIBERATELY. This whole file is
//    served from inside a TEMPLATE LITERAL, so a lone backslash escape is
//    consumed before the browser sees it: /[\s]+$/ written here arrives
//    as /[s]+$/ and would strip a trailing "s" off somebody's search
//    name. Character comparison instead. Same family as the BD head-code
//    backslash rule, different mechanism, same discipline.
//
// ac-v28 CHANGE: THE ZONE SURVIVES THE VOICE PROPOSAL, AND THE CARD
// STOPS LANDING OUTSIDE THE CONTENT COLUMN.
//
// 1. 🔴 THE VOICE PATH WAS THROWING THE ZONE AWAY. Proven on a live save:
//    every field from the transcript present, "zone": null. The renter
//    drew a zone, talked, and the proposal handler built a WHOLE NEW
//    draft object - discarding the zone and the extra options with it.
//    The zone had survived a page reload and the ac-v21 guard, and was
//    lost at the last step.
//    THE PRINCIPLE: THE TRANSCRIPT OWNS CRITERIA, NOT LOCATION.
//    alerts-voice deliberately ignores place names, so it has nothing to
//    say about a zone and must never be able to erase one. zone and extra
//    are now carried across, and the zone name becomes the search name
//    when the transcript did not suggest one.
//
// 2. THE MOUNT FALLBACK WAS PUTTING THE CARD OUTSIDE THE COLUMN.
//    #rdc-wiz is the right anchor but mounts async, and the old chain
//    fell straight through to main - which on /account/home is the whole
//    page. That is the full-bleed, left-clipped card sitting under
//    everything, and it appeared after head-code edits because changing
//    head-code size changes who wins the race.
//    .member_accounts now sits between them, and a card that settled for
//    a worse anchor MOVES UP when a better one appears. The wizard
//    arriving late is the normal case, not an edge case.
//
// 3. The "by voice" chip is removed. It told the renter something they
//    already knew and changed nothing about the search. source is still
//    stored and still reaches the demand index, where dictate-versus-type
//    is a question worth answering.
//
// ac-v27 CHANGE: 🔴 THE ANSWER. /account/home RELOADS ITSELF, AND IT IS
// BD DOING IT. Proven from a PRESERVED console log:
//     BeforeUnload {sessionId: ...}        home:2657
//     Navigated to https://www.renters.com/account/home
// home:2657 is BD'S OWN PAGE SCRIPT. Grepped w195 for BeforeUnload and
// sessionId: no match, so it is not ours. It logs a session id and
// navigates to the same URL - a session-refresh shape. AND NO FORM SUBMIT
// FIRED, so the ac-v26 button-type fix was a real bug but NOT THIS ONE.
//
// ⚠️ THIS IS WHAT COST FIVE VERSIONS OF WRONG DIAGNOSES. Every symptom
// pointed inward - card gone, no error, nothing thrown, nothing removed -
// and the card was fine every single time. The PAGE went away and came
// back, and a draft living only in memory went with it.
//
// 📌 THE DIAGNOSTIC LESSON, worth more than the fix: "THE CONSOLE
// RESTARTED" IS NOT A DETAIL ABOUT TOOLING, IT IS THE ANSWER. A cleared
// console means the document reloaded, which rules out every in-page
// explanation at once. And the tool that proves it is PRESERVE LOG - the
// evidence had been destroyed by the reload every time we went looking
// for it. Ask for Preserve log the FIRST time state vanishes with no
// error, not the fifth.
//
// ⭐ AND THE FIX IS NOT TO STOP THE RELOAD - IT IS TO STOP CARING ABOUT
// IT. The draft now persists to sessionStorage on every render and on the
// way out, and is restored on load. A renter can reload for their own
// reasons - back button, mistyped URL, a phone dropping the tab, a
// platform session refresh nobody controls - and a form that loses ten
// minutes of work to any of those is fragile regardless of the cause.
// sessionStorage rather than localStorage, because this is one sitting's
// work and should not outlive the tab. Keyed by member, so a shared
// computer never restores one person's draft into another person's card.
// Two hour ceiling, then it is somebody else's train of thought.
//
// ac-v26 CHANGE: 🔴 THE CARD WAS NOT DISAPPEARING. THE PAGE WAS
// RELOADING. Every button on this card was submitting a BD form.
//
// THE TELL, and it was the only diagnostic that mattered: KENNY SAID THE
// CONSOLE ITSELF RESTARTED. A console that clears is a NAVIGATION. Five
// versions were spent hunting a DOM removal that never happened - no
// error, no thrown render, no node removed, because nothing was wrong
// inside this card at all. The page simply went away and came back.
//
// THE CAUSE: <button> WITH NO type ATTRIBUTE DEFAULTS TO type="submit".
// This card injects into .member_accounts, which sits INSIDE ONE OF BD'S
// FORMS, so every button here was a submit button for somebody else's
// form. Clicking Start talking submitted it and reloaded /account/home,
// which threw away the in-memory draft and re-rendered the empty state.
// TWENTY-FOUR BUTTONS, NOT ONE OF THEM TYPED. It is a wonder anything
// worked - and the ones that appeared to work were the ones that
// re-rendered fast enough to look intentional.
//
// ⭐ THE RULE, AND IT APPLIES TO EVERY SURFACE INJECTED INTO A HOST PAGE:
// ALWAYS SET type="button" ON A BUTTON THAT IS NOT SUBMITTING YOUR OWN
// FORM. You do not control the DOM you are injected into, and a form
// wrapper you never see turns every control you render into a submit.
//
// 📌 AND THE DIAGNOSTIC LESSON: "the console restarted" is not a detail
// about tooling, IT IS THE ANSWER. A cleared console means the document
// reloaded, which rules out every in-page explanation at once. Ask about
// it FIRST when state vanishes with no error.
//
// ac-v25 CHANGE: "Use this area" NO LONGER HANGS. Diagnosed from a
// console that showed NO ERROR AT ALL, which is what made it slow to find.
//
// zone-picker saveZones() REFUSES to save while any zone still carries
// loading true: it posts renters_areas_busy and RETURNS. The host read
// busy as "in progress", printed "Working on it..." and waited for a
// message that was never coming. The renter had drawn the zone and could
// see its zip codes resolved on screen, and the button did nothing.
//
// ⭐ THE LESSON: A REFUSAL IS NOT PROGRESS. Any message that means "not
// now" needs a retry or an answer - never a spinner. Twelve retries at
// 800ms, then it says plainly that the area will not resolve and to draw
// it again.
//
// ac-v24 CHANGE: ONE FLOW, TWO NUMBERED STEPS. Pairs with zp-v10.
//
// THE COMPLAINT, and it was right: it read as a map with a form stacked
// under it. Two tools, no connection, and the renter had to work out that
// one fed the other. Both were visible and live at once, so neither was
// obviously first.
//
// FOUR CHANGES:
//   1. STEP ONE COLLAPSES WHEN IT IS DONE. Once a zone is drawn the panel
//      shrinks to a receipt - a teal tick, the area name, and every zip
//      it caught - with a quiet Change. A finished step should take up
//      the space of a finished step.
//   2. STEP TWO DOES NOT EXIST UNTIL STEP ONE IS ANSWERED. On the voice
//      screen the microphone is not rendered at all until there is a
//      zone. Two live controls with no order between them is precisely
//      what made this read as two tools.
//   3. THE SECOND STEP NAMES THE FIRST: "Inside SE Portland." The
//      connection is stated rather than implied by adjacency.
//   4. The heading changes with progress - "Start with where" becomes
//      "Now tell us about the place" - so the card itself reports which
//      step the renter is on.
//
// ⭐ AND THE RENAME IS GONE FROM THE EMBED (zp-v10). Naming a zone
// mattered when the label rendered on a PUBLIC RENTER PROFILE and a
// landlord read it. v69 removed the profile. Nothing reads the label now,
// the search takes its name from what the renter says in step two, and
// "Area in CO" was a chore that produced nothing. THE ZIPS STAY - not
// because the renter acts on them, but because they are the honest
// receipt for what the polygon actually caught.
//
// ac-v23 CHANGE: 🔴 THE CARD CAN NO LONGER DISAPPEAR. This is the real
// fix for the vanishing search; ac-v21 guessed the view was resetting and
// it was not. Console settled it: the card was GONE FROM THE DOM.
//
// WHAT WAS ACTUALLY HAPPENING. render() removed the old card FIRST, then
// built and inserted the new one. Anything throwing in between left the
// page with NO CARD AT ALL - and the boot timer cleared itself after
// ~300 ticks, roughly three and a half minutes, so there was no recovery
// by the time a renter had drawn a zone and started describing a place.
// A THROWN RENDER WAS A ONE-WAY DOOR, and the window it opened widened
// the longer someone stayed on the page.
//
// FOUR CHANGES:
//   1. INSERT THE NEW CARD BEFORE REMOVING THE OLD ONE. Never take the
//      working thing away first. A failure now leaves the previous card
//      standing rather than an empty page.
//   2. The view is validated first: a form or voice view with no draft is
//      the exact shape that throws, so it falls back instead.
//   3. The render runs inside try/catch and degrades to the list, LOUDLY.
//      A silent fallback would have hidden this fault while looking fine,
//      which is how it survived three sessions.
//   4. THE RECOVERY TIMER NO LONGER STOPS. Only the position settling
//      stops on schedule; the "is the card still there" check runs for
//      the life of the page and costs one getElementById every 700ms.
//
// ⭐ THE RULE: A REPAINT MUST NOT DESTROY THE ONLY COPY OF WHAT IT IS
// REPLACING. Build, insert, then remove - in that order - anywhere a
// failure would leave a surface empty.
//
// ac-v22 CHANGE: THE CARD LOOKS LIKE THE PRIMARY TOOL. Cosmetic only, no
// logic touched. Soft teal wash, 3px teal top edge, 22px/800 heading, and
// the search rows go WHITE so they read as items inside the tool rather
// than more page furniture. Paused rows drop to a dashed outline on the
// wash, which makes running-versus-paused visible at a glance instead of
// only in the chip.
// TINT, NOT INVERSION: the "Get started" button above and the My Profile
// buttons below are navy and blue. A navy card would fight them for
// attention rather than lead. Two things also had to invert to white to
// survive the tinted background - the zone step panel and the form inputs
// - because a grey panel on a tinted card disappears.
//
// ac-v21 CHANGE: 🔴 A DRAFT CARRYING WORK CAN NO LONGER BE RENDERED AWAY.
//
// THE BUG, REPORTED TWICE AND REPRODUCED: a renter picks a zone, goes to
// describe the place, and the whole in-progress search vanishes. The
// draft was never lost - it sat in memory the entire time. THE VIEW had
// fallen back to "list", so render() drew the list straight over live
// work. It reads as data loss and it is the worst thing this card can do,
// because the zone is the most expensive thing the renter just made.
//
// ⭐ THE FIX IS A GUARD, NOT A DIAGNOSIS, AND THAT IS DELIBERATE. Several
// paths can reset the view - the boot timer's recovery render, a stray
// picker message, a re-entrant render while the map is open. Chasing them
// one at a time means shipping a fix per path and finding the next one in
// production. render() now REFUSES to draw the list while state.draft
// holds a zone, an option, a name or any criteria. The renter leaves the
// form by Cancel or by Save. Nothing else can take them out of it.
// It logs when it catches one, so the underlying path is still findable
// without the renter paying for it.
//
// ⚠️ ORDER MATTERS AT EVERY EXIT: state.draft is cleared BEFORE
// state.view changes, on Cancel, on the voice Cancel and on Save.
// Reversed, the guard reads a draft that still has work and puts the form
// straight back - a card the renter cannot leave, which is the same bug
// wearing the opposite coat.
//
// ac-v20 CHANGE: THE FRAME SIZES ITSELF TO THE PICKER. Pairs with zp-v8.
// The picker posts rdcZoneHeight and this sets the iframe to match, so
// the picker never grows an inner scrollbar and Draw Zone cannot scroll
// out of reach. Bounds are checked here as well as clamped there, because
// a postMessage arrives from a frame and is data, not instruction.
// ⚠️ NOT rdcMapHeight. That name belongs to members-map.html and its
// listener lives in BD HEAD CODE - reusing it would have the homepage map
// listener resizing this frame, or this one resizing the map.
//
// ac-v19 CHANGE: THE MAP STOPS RESETTING ITSELF, AND THERE IS A WAY BACK
// FROM A BAD SHAPE. Four defects, all found by drawing one polygon.
//
// 1. 🔴 THE CARD WAS REBUILDING THE MAP UNDER THE RENTER'S HAND.
//    keepOrder() runs every 700ms and calls insertBefore to hold the
//    card below #rdc-wiz. insertBefore MOVES a node - and MOVING A NODE
//    THAT CONTAINS AN IFRAME DESTROYS AND RELOADS THE IFRAME. So the map
//    reset roughly twice a second, which read as "glitchy and jumping"
//    and threw away work in progress.
//    The same wound from the other side: render() rebuilds this card's
//    innerHTML on EVERY tap, so an iframe written as markup was a fresh
//    Google Maps load every time anything redrew.
//    TWO FIXES, BOTH NEEDED. keepOrder and the boot timer now stand down
//    entirely while the map is open - position can wait, and this card
//    has fought over position before (see the ELEMENT U mount notes).
//    And the frame is now built ONCE, held on state, and re-appended to
//    an empty #ra-picker-slot after each render rather than re-created.
//    ⚠️ THE GENERAL LESSON, worth carrying anywhere else on this
//    dashboard: A CONTAINER THAT RE-ASSERTS ITSELF ON A TIMER IS A BAD
//    HOST FOR ANY LIVE EMBED. Anything stateful inside it - an iframe, a
//    video, a canvas, a focused input - is destroyed by a reposition
//    that looks harmless in the code.
//
// 2. NO WAY TO UNDO A BAD SHAPE. ?embed=1 hides the picker's save row,
//    and zp-v6 deliberately takes Clear All with it on the reasoning
//    that it belongs beside the save it partners with and the host will
//    offer its own. The host never did. "Start over" is that button, and
//    it drops the frame rather than trying to reach inside the picker.
//
// 3. THE MAP WAS TOO SHORT. 460px against a picker that carries a search
//    row, a Draw Zone button and a zone list meant the controls scrolled
//    out of reach inside the iframe's own scrollbar. 620px.
//
// 4. "USE THIS AREA" WAS A WHITE GHOST BUTTON diagonally opposite Draw
//    Zone. It is the primary action of the step. Dark, full width,
//    directly under the map, with Start over beneath it.
//
// ac-v18 CHANGE: BOTH DOORS START WITH THE ZONE, AND BOTH HAVE AN EXIT.
//
// 1. THE VOICE VIEW NOW CARRIES THE ZONE BLOCK. ac-v17 put it on the
//    form only, and voice is the FIRST button a renter sees - so the
//    main entrance never asked where. That matters more than it looks:
//    alerts-voice DELIBERATELY IGNORES PLACE NAMES, so nothing else on
//    that path would ever have captured a location, and the search would
//    save with no zone at all.
//    zoneBlockHtml() is now one definition rendered by both views, and
//    wireZone() binds it for both. Two copies of a picker embed is how
//    the two halves drift apart again.
//    The draft is created when the renter taps into voice, not when the
//    proposal returns, so a zone picked BEFORE talking is still on the
//    draft afterwards rather than being wiped by the incoming criteria.
//
// 2. THE VOICE VIEW HAD NO WAY OUT. Its only escape was "Type it
//    instead", which is a route FORWARD. A renter who opened it by
//    mistake was stuck on the first screen of the product. Cancel now
//    sits beside it on both the supported and unsupported branches.
//
// 3. "Pick your zone" replaces "Draw an area on the map", and "Change
//    your zone" replaces "Redraw this area". The box above already
//    explains the mechanism; the button should start the thing.
//
// 4. "Save this alert" was the last straggler of the v68 vocabulary on
//    this surface. It says search now, like everything around it.
//
// ⚠️ THE MESSAGE LISTENER IS BOUND ONCE, GUARDED BY state.zoneWired.
// render() runs on every tap; a listener added per render would fire N
// times on a single picker message and write the zone N times.
//
// ac-v17 CHANGE: ZONE AND PRICED OPTIONS. THE PICKER AND THE SEARCH ARE
// ONE TOOL NOW. Requires ap-v10 (schema v4).
//
// 1. THE ZONE PICKER IS EMBEDDED IN THE FORM. zone-picker.html rides in
//    an iframe with ?embed=1, which hides its own header and save row so
//    the card owns the one Save button. The picker posts up
//    renters_areas_zips carrying zips AND the polygon path; the card
//    holds that on the draft and sends it to ap-v10 as search.zone.
//    WHY IT IS A STEP AND NOT A PAGE: a renter used to set areas on
//    /account/locations, then come back here and describe what they
//    want, and the two halves were stored so far apart that a search
//    could match inventory in a state the renter never asked about.
//    Zone and criteria are one thought and are now one save.
//    ⚠️ THE ZONE STILL WRITES TO BD SEPARATELY via window.rdcAreasAdd,
//    which is head code and is NOT path gated. It has to stay
//    client-side: add_service_area runs on the session cookie, and BD
//    takes a 200 then discards a write carrying fake geo. No function
//    can do it. So combining the UI does NOT combine the storage, and
//    the zone landing on the search is what the matcher reads.
//
// 2. OPTIONS. A zone can hold up to four priced configurations. The
//    case that forced it: one circle over SE Portland where the renter
//    would take a house up to 2000, a condo up to 1000, or a room at
//    750. One rent_max cannot say that, and three separate searches
//    burn three of five slots pretending one hunt is three.
//    Option one IS the three questions - nothing gets heavier for the
//    renter who wants one thing. Extra options are compact rows added
//    underneath, and ap-v10 mirrors option one back onto criteria so
//    nothing reading the old shape breaks.
//
// 3. HOUSEHOLD IS ASKED ONCE, NOT PER SEARCH. It sits on the member.
//    Live proof it needed to move: member 25 had household_kids 2 on one
//    search and 3 on another. Two records disagreeing about one family.
//    ⚖️ A COUNT AND AN ADULTS SPLIT ONLY. No ages, no relationships, no
//    who-is-a-child. Occupancy against a landlord limit is arithmetic;
//    inferring family status is not.
//
// 4. COLLAPSED ROWS SHOW THE ZONE NAME AS THE TITLE with its options
//    listed under it, so a glance answers where and for how much.
//
// ac-v16 CHANGE: COLLAPSED ROWS, NEW COPY, AND THE AREA GATE IS GONE.
//
// 1. THE AMBER "ADD YOUR SEARCH AREAS FIRST" PANEL IS REMOVED, ALONG WITH
//    THE READER BEHIND IT. It was lying. noAreas() fired whenever the
//    /account/locations fetch SUCCEEDED and parsed zero rows containing
//    "Postal Code" - and that table is rendered at runtime by BD's
//    get_services_areas widget call, so it is NOT in the server HTML the
//    fetch returns. parseAreas() therefore found nothing for every member,
//    always, including one with seven saved areas. Same family as za6
//    logging "0 areas" on the dashboard: a scraper pointed at markup that
//    is not there.
//    IT IS DELETED RATHER THAN FIXED because zones are moving onto the
//    search object itself. A gate guarding a member-level area pool has
//    nothing left to guard, and repairing a scraper due for deletion is
//    work that ships twice. firstZip, parseAreas, loadAreas, areaLine and
//    noAreas all come out; boot no longer fetches /account/locations at
//    all, which also drops one network call from every dashboard load.
//
// 2. EACH SEARCH COLLAPSES TO TITLE + STATUS + ONE SUMMARY LINE. Tap to
//    expand. Every search used to render fully - must-haves,
//    nice-to-haves, deal breakers, pets, voucher, notes, both dates and
//    three buttons - so two searches pushed Dashboard, My Profile,
//    Account Details and Showings far down the page.
//    THE FIX IS ENTIRELY INSIDE THIS FILE. w193 tried to solve a layout
//    push by having a different block climb the DOM and insert relative
//    to a bounded ancestor, and it killed this card outright. Do not
//    reorder BD native blocks from head code. Size is the lever.
//    Edit / Pause / Delete move INTO the expanded body, so a collapsed
//    list is rows of text and nothing else.
//
// 3. COPY. "Daily listing alerts" was wrong twice: it is not daily (the
//    footer on this same card says no matches, no email) and "listing" is
//    v68 vocabulary - listings came off the renter-facing site in v69.
//    Empty:     "Start your search"
//    Populated: "Your searches"
//    "Start your search" is deliberately the same phrase as the homepage
//    teaser, so the thing a renter met logged-out and the tool they get
//    as a member share one name.
//
// ac-v15 CHANGE: THE TWO CONSENT CHECKBOXES ARE REMOVED.
//   "Introduce me to verified Renters.com properties that match" and
//   "also pass my inquiry to matching properties that are not on
//   Renters.com yet" both came off this card.
//   WHY: consent is asked ONCE now, on the What We Share screen, where the
//   renter sees their own values beside every field and reads the exact
//   introduction a landlord will receive. A checkbox asking the same
//   question with none of that context is how two records end up
//   disagreeing about what somebody agreed to.
//   THE STORED VALUES ARE NOT TOUCHED. state.consent still loads from the
//   server and still goes back on every save. Zeroing them would have been
//   a consent change made on a renter's behalf without asking.
//   The handlers were deleted rather than guarded: saveConsent() read the
//   DOM, so with the inputs gone it would have written FALSE for both the
//   moment anything called it.
//   ⚠️ THERE IS NOW NO WAY TO REVOKE THESE TWO FROM THIS CARD. That is
//   only acceptable because the lead hub shows nobody has ever ticked
//   them. If that stops being true, revocation must exist on the What We
//   Share screen before this stays removed.
//
// ac-v14 CHANGE: SCHEMA v3, VOICE INTAKE, CONSENT, AND THE v13 GATE.
//
// 1. THE RENTER GATE IS NOW AN ALLOWLIST ON THE NUMERIC PLAN LEVEL.
//    This is the ac-v13 hardening, folded forward. ac-v13 IS NOT IN THE
//    REPO - the live file was ac-v12, confirmed by Kenny copying the
//    deployed file directly. Whatever happened to v13, its change lives
//    here now.
//      session-plan-level-14 = PM   15 = RENTER   17 = LANDLORD   18 = REALTOR
//    15 is the allowlist. The old "renter" substring read is kept ONLY
//    as a first-paint fallback that can ALLOW but never BLOCK, so a
//    future tier called "Renter Plus" still works and a tier added next
//    year renders nothing until explicitly allowed. That is the correct
//    failure for a renter-only feature.
//
// 2. THREE QUESTIONS, THEN REFINE. Rent, beds and the move-in window are
//    always visible. Everything else lives behind one Refine toggle.
//    Fifteen fields in front of a renter is a form they abandon at field
//    seven; three is a form they finish.
//
// 3. VOICE. A renter talking for forty seconds gives more usable
//    criteria than a form they abandon. Transcription is browser-side
//    (Web Speech API) because THE ANTHROPIC API DOES NOT ACCEPT AUDIO.
//    The transcript goes to alerts-voice, which returns a PROPOSAL; the
//    card pre-fills the form and the renter confirms or corrects before
//    anything saves. The renter stays the author of their own criteria.
//    Unsupported browser (Firefox, older Safari) gets a type-it-instead
//    box that posts to the same endpoint. Nothing is voice-only.
//
// 4. MUST-HAVE vs NICE-TO-HAVE, must-have capped at 3. This split is
//    what lets the matcher hard-filter cheaply in code and only send
//    survivors to be scored. The cap is a product decision, not an
//    apology: a renter with nine hard requirements gets zero emails
//    forever and reads it as broken.
//
// 5. TWO CONSENT TAPS, both default off. Renters opted into being
//    surfaced ON Renters.com; that is not consent to be passed to a
//    third-party marketplace. Consent is per member, recorded with a
//    timestamp server-side, and NEVER inferred from speech.
//
// 6. LEGACY DEAL BREAKERS ARE SURFACED, NOT SILENTLY DROPPED. ap-v8
//    quarantines positive keys stored on the old deal-breaker row
//    (#44 fallout - the stored value means something other than what it
//    says and the intent is unrecoverable). Where a search carries them,
//    the card says so and asks the renter to re-pick. Better a small ask
//    than a curated search built on data nobody meant.
//
// ------------------------------------------------------------------
// THE VOCABULARY IS NOT IN THIS FILE. It is fetched from
// alerts-prefs?schema=1 at boot. A chip list copied into a second file
// is exactly how #44 happened. This file carries only LABELS (cosmetic);
// any key the schema returns that has no label is prettified from the
// key itself, so a new chip added server-side appears here with no
// deploy. If the schema cannot be read, the chip rows are HIDDEN and the
// core fields still save - there is deliberately no fallback key list.
// ------------------------------------------------------------------
//
// MOUNT ORDER. Unchanged from ac-v11, and do not touch it without
// reading the ELEMENT U mount-order notes. Six things inject into this
// container. This card anchors AFTER #rdc-wiz and only ever moves DOWN.
// It never claims firstChild (the zip gate's slot) and never inserts
// between #rdc-zip and #rdc-wiz, which zip3 keeps adjacent on a 400ms
// timer. previousElementSibling, never previousSibling.
// ==================================================================

const FN_VERSION = "ac-v29";
const PREFS = "https://renters-story-writer.netlify.app/.netlify/functions/alerts-prefs";
const VOICE = "https://renters-story-writer.netlify.app/.netlify/functions/alerts-voice";
const PICKER = "https://renters-story-writer.netlify.app/zone-picker.html";

// Cosmetic labels only. The authoritative key list comes from ?schema=1.
const LABELS = {
  // positive
  move_in_special: "Move-in special",
  pets_dog: "Dog friendly",
  pets_cat: "Cat friendly",
  large_dog_ok: "Large dog ok",
  washer_dryer_in_unit: "W/D in unit",
  parking: "Parking",
  yard: "Yard",
  ground_floor: "Ground floor",
  no_stairs: "No stairs",
  furnished: "Furnished",
  utilities_included: "Utilities included",
  in_building_laundry: "Laundry in building",
  dishwasher: "Dishwasher",
  air_conditioning: "Air conditioning",
  elevator: "Elevator",
  balcony: "Balcony or patio",
  storage: "Storage",
  near_transit: "Near transit",
  accessible_unit: "Step-free access",
  pool: "Pool",
  gym: "Gym",
  short_term_ok: "Short term ok",
  // negative
  stairs: "Stairs",
  no_parking: "No parking",
  street_parking_only: "Street parking only",
  no_pets_allowed: "No pets allowed",
  not_furnished: "Unfurnished",
  no_laundry_on_site: "No laundry on site",
  shared_bathroom: "Shared bathroom",
  shared_kitchen: "Shared kitchen",
  basement_unit: "Basement unit",
  no_air_conditioning: "No air conditioning",
  carpet_throughout: "Carpet throughout",
  no_elevator: "No elevator",
  ground_floor_only: "Ground floor only",
  smoking_building: "Smoking building",
  // beds
  studio: "Studio",
  "1": "1 bed",
  "2": "2 beds",
  "3": "3 beds",
  "4plus": "4+ beds",
  // unit types
  apartment: "Apartment",
  house: "House",
  townhouse: "Townhouse",
  condo: "Condo",
  duplex: "Duplex",
  room: "Room",
  // lease terms
  "12mo": "12 months",
  month_to_month: "Month to month",
  short_term: "Short term",
  flexible: "Flexible",
  // rent basis
  all_in: "All in",
  plus_utilities: "Plus utilities"
};

const JS = `
(function () {
  var V = "${FN_VERSION}";
  var PREFS = "${PREFS}";
  var VOICE = "${VOICE}";
  var PICKER = "${PICKER}";
  var LABEL = ${JSON.stringify(LABELS)};
  var MAX = 5;
  var MUST_CAP = 3;
  var MAX_OPTIONS = 4;
  console.log("[Renters alerts] version: " + V);

  function pretty(k) {
    if (LABEL[k]) return LABEL[k];
    var s = String(k || "").split("_").join(" ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function memberId() {
    var el = document.querySelector("input[name=logged_user]");
    if (el && el.value) return String(el.value).replace(/[^0-9]/g, "");
    var m = document.querySelector(".member-account-id");
    if (m && m.textContent) return String(m.textContent).replace(/[^0-9]/g, "");
    var c = document.cookie || "";
    var i = c.indexOf("userid=");
    if (i !== -1) return c.slice(i + 7).split(";")[0].replace(/[^0-9]/g, "");
    return "";
  }

  var id = memberId();
  if (!id) { console.log("[Renters alerts] no member id, standing down"); return; }

  // ==================================================================
  // ac-v27: THE DRAFT SURVIVES A PAGE RELOAD.
  //
  // WHY THIS EXISTS, and it is not defensive programming for its own
  // sake: /account/home RELOADS ITSELF. Proven from a preserved console -
  //   BeforeUnload {sessionId: ...}   home:2657
  //   Navigated to https://www.renters.com/account/home
  // home:2657 is BD'S OWN PAGE SCRIPT, not our head code (grepped: no
  // match for BeforeUnload or sessionId in w195). It logs a session id
  // and navigates to the same URL, which is a session-refresh shape.
  // NO FORM SUBMIT FIRED - the ac-v26 button-type fix was a real bug but
  // it was not this one.
  //
  // THAT COST FIVE VERSIONS OF WRONG DIAGNOSES, because every symptom
  // pointed inward: card gone, no error, nothing thrown, nothing removed.
  // The card was fine every time. The PAGE went away and came back, and a
  // draft that lived only in memory went with it.
  //
  // ⭐ THE FIX IS NOT TO STOP THE RELOAD - IT IS TO STOP CARING ABOUT IT.
  // A renter can reload for their own reasons: a mistyped URL, a back
  // button, a phone dropping the tab, a session refresh from a platform
  // we do not control. A form that loses ten minutes of work to any of
  // those is fragile no matter who caused it.
  //
  // sessionStorage, not localStorage: this is one sitting's work, not a
  // saved preference, and it should not outlive the tab. Keyed by member
  // so a shared computer never restores one person's draft into another
  // person's card. Cleared on save, on cancel, and on any read that finds
  // stale or unreadable contents.
  // ==================================================================
  var DRAFT_KEY = "rdcAlertsDraft:" + id;
  var DRAFT_MAX_AGE_MS = 2 * 60 * 60 * 1000;   // two hours

  function saveDraft() {
    try {
      if (!state.draft || !draftHasWork(state.draft)) { clearDraft(); return; }
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        at: Date.now(),
        view: state.view === "voice" ? "voice" : "form",
        editIdx: state.editIdx,
        showRefine: !!state.showRefine,
        pickerOpen: false,          // never restore straight into the map
        draft: state.draft
      }));
    } catch (e) { /* private mode, quota, whatever - never break a save */ }
  }

  function clearDraft() {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) {}
  }

  function loadDraft() {
    try {
      var raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.draft) { clearDraft(); return null; }
      // Old enough that restoring it would be surprising rather than
      // helpful. Two hours is a sitting; a day later is somebody else's
      // train of thought.
      if (!o.at || (Date.now() - o.at) > DRAFT_MAX_AGE_MS) { clearDraft(); return null; }
      return o;
    } catch (e) { clearDraft(); return null; }
  }

  // ---- RENTERS ONLY -------------------------------------------------
  // ALLOWLIST on the numeric plan level. This is the ac-v13 hardening.
  // 14 = PM, 15 = RENTER, 17 = LANDLORD, 18 = REALTOR.
  // The class is written server-side by BD and is present on first paint.
  var RENTER_LEVEL_CLASS = "session-plan-level-15";
  var KNOWN_LEVEL_CLASSES = [
    "session-plan-level-14", "session-plan-level-15",
    "session-plan-level-16", "session-plan-level-17", "session-plan-level-18"
  ];

  function bodyClasses() {
    try { return " " + String(document.body.className || "") + " "; }
    catch (e) { return " "; }
  }

  function levelClassPresent() {
    var cls = bodyClasses();
    for (var i = 0; i < KNOWN_LEVEL_CLASSES.length; i++) {
      if (cls.indexOf(" " + KNOWN_LEVEL_CLASSES[i] + " ") !== -1) return KNOWN_LEVEL_CLASSES[i];
    }
    return "";
  }

  function isRenterByClass() {
    return bodyClasses().indexOf(" " + RENTER_LEVEL_CLASS + " ") !== -1;
  }

  // First-paint fallback, kept from ac-v12. It can ALLOW but never BLOCK,
  // so a tier later renamed "Renter Plus" still works while an unknown
  // tier renders nothing.
  function readAccountType() {
    try {
      var el = document.querySelector(".member-level-name");
      if (el && el.textContent.trim()) return el.textContent.trim();
    } catch (e) {}
    try {
      var txt = document.body.innerText || "";
      var i = txt.indexOf("Plan:");
      if (i !== -1) {
        var after = txt.slice(i + 5, i + 40);
        var line = after.split(String.fromCharCode(10))[0].trim();
        if (line) return line;
      }
    } catch (e) {}
    return "";
  }

  function isRenterByLabel() {
    return readAccountType().toLowerCase().indexOf("renter") !== -1;
  }

  (function gate() {
    function allowed() { return isRenterByClass() || isRenterByLabel(); }

    if (allowed()) { start(); return; }
    var t = 0;
    var iv = setInterval(function () {
      t++;
      if (allowed()) { clearInterval(iv); start(); return; }

      // A KNOWN level class is present and it is not the renter one:
      // stop for good. This is the allowlist doing its job.
      var lvl = levelClassPresent();
      if (lvl && lvl !== RENTER_LEVEL_CLASS) {
        clearInterval(iv);
        console.log("[Renters alerts] plan level " + lvl + ", standing down");
        return;
      }
      // Label present and not a renter: same conclusion.
      if (readAccountType() && !isRenterByLabel() && !isRenterByClass()) {
        clearInterval(iv);
        console.log("[Renters alerts] not a renter account, standing down");
        return;
      }
      if (t > 12) {
        clearInterval(iv);
        console.log("[Renters alerts] account level unreadable, standing down");
      }
    }, 400);
  })();

  function start() {

  var S = {
    // ac-v22. THE CARD READS AS THE PRIMARY TOOL NOW.
    // It was white, hairline-bordered, with an 18px heading, sitting
    // between BD's white blocks and under a heading the same weight. It
    // looked like one more block on a page made of blocks.
    // TINT RATHER THAN INVERSION, and the reason is the neighbours: the
    // "Get started" button above and the My Profile buttons below are
    // navy and blue. A navy card here would FIGHT them for attention
    // rather than lead. A soft teal wash separates it from every white
    // block without shouting, and the 3px teal top edge does the "this
    // one is different" work that colour alone cannot at a glance.
    card: "background:#f4f9f8;border:1px solid #d8e8e4;border-top:3px solid #3a9e8f;border-radius:14px;padding:22px 22px 28px;margin:18px 0;font-family:inherit;box-shadow:0 1px 3px rgba(13,45,78,.06);",
    h: "margin:0 0 5px;font-size:22px;font-weight:800;color:#0d2d4e;letter-spacing:-.2px;",
    sub: "margin:0 0 18px;font-size:14.5px;color:#4a6076;line-height:1.5;",
    row: "display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;",
    lab: "display:block;font-size:13px;font-weight:600;color:#0f2545;margin:0 0 6px;",
    hint: "display:block;font-size:12px;color:#7a8ba1;margin:0 0 8px;line-height:1.4;",
    inp: "width:100%;padding:10px 12px;border:1px solid #cfdbd7;border-radius:9px;font-size:15px;box-sizing:border-box;background:#fff;",
    chip: "border:1px solid #d7dee8;background:#fff;color:#33475f;border-radius:999px;padding:8px 14px;font-size:13px;cursor:pointer;",
    chipOn: "border:1px solid #0f2545;background:#0f2545;color:#fff;border-radius:999px;padding:8px 14px;font-size:13px;cursor:pointer;",
    chipNo: "border:1px solid #eceff3;background:#fff;color:#c0c8d2;border-radius:999px;padding:8px 14px;font-size:13px;cursor:not-allowed;",
    btn: "background:#0f2545;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-size:15px;font-weight:600;cursor:pointer;",
    ghost: "background:#fff;color:#0f2545;border:1px solid #d7dee8;border-radius:10px;padding:9px 16px;font-size:14px;font-weight:600;cursor:pointer;",
    mic: "background:#3a9e8f;color:#fff;border:0;border-radius:10px;padding:12px 20px;font-size:15px;font-weight:600;cursor:pointer;",
    link: "background:none;border:0;color:#5b6b82;font-size:13px;cursor:pointer;padding:6px 8px;text-decoration:underline;",
    note: "font-size:13px;margin-top:10px;min-height:18px;",
    pillOn: "display:inline-block;background:#e7f4ed;color:#1a7f52;border-radius:999px;padding:3px 10px;font-size:11px;font-weight:700;",
    pillOff: "display:inline-block;background:#eef1f5;color:#5b6b82;border-radius:999px;padding:3px 10px;font-size:11px;font-weight:700;",
    // White on the tint, so a search reads as an item INSIDE the tool
    // rather than another box on the page. Paused rows lose the white and
    // sit back into the wash, which is the whole visual difference
    // between running and not.
    item: "border:1px solid #dde9e6;border-radius:11px;padding:14px 16px;margin:0 0 10px;background:#fff;box-shadow:0 1px 2px rgba(13,45,78,.04);",
    itemOff: "border:1px dashed #cfdedb;border-radius:11px;padding:14px 16px;margin:0 0 10px;background:transparent;",
    itemName: "font-size:15px;font-weight:700;color:#0f2545;margin:0;display:inline-block;",
    itemLine: "font-size:14px;color:#33475f;margin:6px 0 2px;",
    itemMuted: "font-size:12px;color:#7a8ba1;margin:0;",
    acts: "margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;",
    warn: "background:#fff8e8;border:1px solid #f0e0bd;border-radius:11px;padding:14px 16px;margin:0 0 14px;",
    warnTxt: "font-size:13px;color:#7a5c14;margin:0;line-height:1.5;",
    heard: "background:#f2f9f7;border:1px solid #cfe8e2;border-radius:11px;padding:14px 16px;margin:0 0 14px;",
    fold: "border-top:1px solid #eceff3;margin:18px 0 0;padding-top:16px;",
    // On a white card this was a soft grey panel. On the tinted card it
    // would disappear into the background, so it inverts to white - the
    // zone step is the first thing the renter does and it has to look
    // like a step.
    zoneBox: "background:#fff;border:1px solid #dde9e6;border-radius:12px;padding:16px;margin-bottom:18px;",
    // Once a zone exists step one shrinks to a receipt. Teal wash and a
    // tick, so it reads as DONE rather than as another thing to do.
    zoneDone: "background:#eaf5f2;border:1px solid #cfe6df;border-radius:12px;padding:12px 14px;margin-bottom:14px;",
    stepNum: "flex:0 0 auto;width:22px;height:22px;border-radius:999px;background:#0d2d4e;color:#fff;font-size:12px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;margin-top:1px;",
    stepTick: "flex:0 0 auto;width:22px;height:22px;border-radius:999px;background:#3a9e8f;color:#fff;font-size:12px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;margin-top:1px;",
    optRow: "border:1px solid #dde9e6;border-radius:10px;padding:10px;margin-bottom:8px;background:#fff;",
    consent: "border-top:1px solid #eceff3;margin:18px 0 0;padding-top:16px;",
    cRow: "display:flex;gap:10px;align-items:flex-start;margin:0 0 12px;cursor:pointer;",
    cBox: "margin:2px 0 0;flex:0 0 auto;width:17px;height:17px;cursor:pointer;",
    cLab: "font-size:13px;color:#33475f;line-height:1.45;margin:0;",
    live: "font-size:14px;color:#33475f;background:#f7f9fb;border:1px solid #e3e8ef;border-radius:9px;padding:12px;min-height:64px;line-height:1.5;margin:0 0 12px;"
  };

  var state = {
    searches: [], consent: { platform: false, off_platform: false },
    enabled: false, view: "list", editIdx: -1, draft: null,
    savedAt: null, busy: false, anchor: "", expanded: {},
    household: null, pickerOpen: false, zoneWired: false, frame: null, frameH: 0, zoneTries: 0,
    schema: null, showRefine: false,
    voice: { active: false, transcript: "", interim: "", status: "", rec: null, heard: "", unclear: [] }
  };

  // ---- helpers ------------------------------------------------------
  function money(n) {
    return "$" + String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
  }

  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function val(v) { return (v === null || v === undefined) ? "" : v; }

  function bedsLabel(beds) {
    if (!beds || !beds.length) return "";
    if (beds.length === 1) return pretty(beds[0]);
    var order = (state.schema && state.schema.bedSizes) || [];
    var sorted = beds.slice().sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
    var f = sorted[0] === "studio" ? "Studio" : sorted[0];
    var l = sorted[sorted.length - 1] === "4plus" ? "4+" : sorted[sorted.length - 1];
    return f + " to " + l + " beds";
  }

  function names(keys) {
    return (keys || []).map(pretty).join(", ");
  }

  function summaryText(c) {
    var bits = [];
    if (c.rent_max) {
      var r = "Up to " + money(c.rent_max);
      if (c.rent_stretch) r += " (could stretch " + money(c.rent_stretch) + ")";
      if (c.rent_basis) r += " " + pretty(c.rent_basis).toLowerCase();
      bits.push(r);
    }
    var b = bedsLabel(c.beds);
    if (b) bits.push(b);
    if (c.baths_min !== null && c.baths_min !== undefined) bits.push(c.baths_min + "+ baths");
    if ((c.unit_types || []).length) bits.push(names(c.unit_types));
    if (c.move_in_earliest && c.move_in_latest) bits.push(fmtDate(c.move_in_earliest) + " to " + fmtDate(c.move_in_latest));
    else if (c.move_in_latest) bits.push("by " + fmtDate(c.move_in_latest));
    else if (c.move_in_earliest) bits.push("from " + fmtDate(c.move_in_earliest));
    return bits.join("  \\u00b7  ");
  }

  function petLine(pets) {
    if (!pets || !pets.length) return "";
    return pets.map(function (p) {
      var s = p.count > 1 ? p.count + " " + p.species + "s" : p.species;
      if (p.weight_lbs) s += " (" + p.weight_lbs + " lb)";
      else if (p.note) s += " (" + p.note + ")";
      return s;
    }).join(", ");
  }

  function emptyCriteria() {
    return {
      rent_max: null, rent_stretch: null, rent_basis: null,
      beds: [], baths_min: null, unit_types: [],
      move_in_earliest: null, move_in_latest: null, lease_terms: [],
      household_adults: null, household_kids: null, pets: [],
      voucher: false, voucher_program: "",
      must_have: [], nice_to_have: [], deal_breakers: [],
      legacy_breakers: [], notes: ""
    };
  }

  function hasSomething(c) {
    if (c.rent_max) return true;
    if ((c.beds || []).length) return true;
    if (c.baths_min !== null && c.baths_min !== "") return true;
    if ((c.unit_types || []).length) return true;
    if (c.move_in_earliest || c.move_in_latest) return true;
    if ((c.lease_terms || []).length) return true;
    if (c.household_adults || c.household_kids) return true;
    if ((c.pets || []).length) return true;
    if (c.voucher) return true;
    if ((c.must_have || []).length) return true;
    if ((c.nice_to_have || []).length) return true;
    if ((c.deal_breakers || []).length) return true;
    if (c.notes) return true;
    return false;
  }

  function legacyCount() {
    var n = 0;
    state.searches.forEach(function (s) {
      if (((s.criteria || {}).legacy_breakers || []).length) n++;
    });
    return n;
  }

  // ---- chip rows ----------------------------------------------------
  // Keys come from the schema. Never from this file.
  function chipRow(mount, keys, arr, opts) {
    opts = opts || {};
    mount.innerHTML = "";
    if (!keys || !keys.length) return;
    keys.forEach(function (k) {
      var on = arr.indexOf(k) !== -1;
      var blockedByOther = !on && opts.other && opts.other.indexOf(k) !== -1;
      var blockedByCap = !on && opts.cap && arr.length >= opts.cap;
      var blocked = blockedByOther || blockedByCap;
      var b = document.createElement("button");
      // Same trap as every other button on this card - see the ac-v26
      // header. A button with no type inside a form is a SUBMIT button.
      b.type = "button";
      b.textContent = pretty(k);
      if (blockedByOther) b.title = "Already chosen in another list";
      if (blockedByCap) b.title = "Pick at most " + opts.cap;
      b.style.cssText = on ? S.chipOn : (blocked ? S.chipNo : S.chip);
      if (!blocked) {
        b.onclick = function () {
          var i = arr.indexOf(k);
          if (i === -1) arr.push(k); else arr.splice(i, 1);
          redrawChips();
        };
      }
      mount.appendChild(b);
    });
  }

  function sc(name) {
    return (state.schema && state.schema[name]) || [];
  }

  function redrawChips() {
    var c = state.draft && state.draft.criteria;
    if (!c) return;
    var m;
    m = document.getElementById("ra-beds");
    if (m) chipRow(m, sc("bedSizes"), c.beds, {});
    m = document.getElementById("ra-units");
    if (m) chipRow(m, sc("unitTypes"), c.unit_types, {});
    m = document.getElementById("ra-lease");
    if (m) chipRow(m, sc("leaseTerms"), c.lease_terms, {});
    m = document.getElementById("ra-must");
    if (m) chipRow(m, sc("positiveChips"), c.must_have, { other: c.nice_to_have.concat(c.deal_breakers), cap: MUST_CAP });
    m = document.getElementById("ra-nice");
    if (m) chipRow(m, sc("positiveChips"), c.nice_to_have, { other: c.must_have.concat(c.deal_breakers) });
    m = document.getElementById("ra-break");
    if (m) chipRow(m, sc("breakerChips"), c.deal_breakers, { other: c.must_have.concat(c.nice_to_have) });

    var cnt = document.getElementById("ra-must-count");
    if (cnt) cnt.textContent = c.must_have.length + " of " + MUST_CAP + " chosen";
  }

  // ---- AREAS READER REMOVED (ac-v16) --------------------------------
  // firstZip / parseAreas / loadAreas / areaLine / noAreas lived here and
  // all five are gone. They scraped /account/locations for table rows
  // containing "Postal Code", but BD renders that table at runtime via its
  // get_services_areas widget call, so those rows are never in the fetched
  // HTML. The parse returned zero for every member and the amber gate fired
  // on people with areas saved. Zones belong on the search object; this
  // reader is not coming back.

  // ---- render -------------------------------------------------------
  // Does this draft hold work the renter would be upset to lose?
  function draftHasWork(d) {
    if (!d) return false;
    if (d.zone && ((d.zone.zips || []).length || d.zone.name)) return true;
    if ((d.extra || []).length) return true;
    if (d.name) return true;
    return hasSomething(d.criteria || {});
  }

  function render(mp) {
    // ⚠️ ac-v23 SAFETY NET. THE BUG: the card vanished from the page
    // entirely - not the wrong view, the whole element gone, with nothing
    // putting it back.
    // CAUSE: render() removed the old card FIRST and inserted the new one
    // after. Anything throwing in between left the page with NO CARD, and
    // because the boot timer clears itself after ~300 ticks (3.5 minutes),
    // a renter who had been on the page a while had no recovery at all.
    // A THROWN RENDER WAS A ONE-WAY DOOR.
    // THREE CHANGES, and the third is the one that makes it impossible:
    //   1. the view is validated before rendering - a form or voice view
    //      with no draft is the shape that throws, so it falls back
    //   2. the render runs inside try/catch and degrades to the list
    //   3. THE NEW CARD IS BUILT AND INSERTED BEFORE THE OLD ONE IS
    //      REMOVED, so a failure leaves the previous card standing rather
    //      than an empty page. Never take the working thing away first.
    if ((state.view === "form" || state.view === "voice") && !state.draft) {
      console.log("[Renters alerts] view wanted a draft and there was none, standing down to the list");
      state.view = "list";
    }

    // The ac-v21 guard: a draft holding real work is never rendered away.
    if (state.view === "list" && draftHasWork(state.draft)) {
      console.log("[Renters alerts] held the draft, view tried to reset to list");
      state.view = state.draft.source === "voice" && !state.voice.heard ? "voice" : "form";
    }

    var wrap = document.createElement("div");
    wrap.id = "rdc-alerts-new";
    wrap.style.cssText = S.card;

    try {
      if (state.view === "form") renderForm(wrap);
      else if (state.view === "voice") renderVoice(wrap);
      else renderList(wrap);
    } catch (e) {
      // Log LOUD. A silent fallback here would hide the real fault while
      // looking fine, which is how the original bug survived three
      // sessions.
      console.error("[Renters alerts] render threw, falling back to the list", e);
      state.view = "list";
      wrap.innerHTML = "";
      try { renderList(wrap); }
      catch (e2) {
        console.error("[Renters alerts] the list threw too, leaving the old card up", e2);
        return;   // old card is still on the page, untouched
      }
    }

    // Insert the new one, THEN remove the old. Order is the fix.
    state.anchor = mp.anchor;
    if (mp.before && mp.before.parentNode === mp.parent) mp.parent.insertBefore(wrap, mp.before);
    else mp.parent.appendChild(wrap);

    removeCard();
    wrap.id = "rdc-alerts";

    // Every change on this card funnels through render(), so this is the
    // one place a save has to happen. readForm() has already run for any
    // path that touches an input.
    saveDraft();

    try {
      if (state.view === "form") wireForm(mp);
      else if (state.view === "voice") wireVoice(mp);
      else wireList(mp);
    } catch (e) {
      // The card is on the page and readable even if a handler failed to
      // bind. Better a card with a dead button than no card.
      console.error("[Renters alerts] wiring threw, card left in place", e);
    }
  }

  // ---------------- LIST ----------------
  function renderList(wrap) {
    var n = state.searches.length;
    // ac-v16 COPY. "Daily listing alerts" was wrong twice: not daily, and
    // "listing" is v68 vocabulary. The empty-state heading matches the
    // homepage teaser word for word on purpose.
    var html = n
      ? '<h3 style="' + S.h + '">Your searches</h3>' +
        '<p style="' + S.sub + '">Running searches match automatically. Add another or refine what is here.</p>'
      : '<h3 style="' + S.h + '">Start your search</h3>' +
        '<p style="' + S.sub + '">Type it or say it. When a verified home matches, we email you.</p>';

    var lc = legacyCount();
    if (lc) {
      html +=
        '<div style="' + S.warn + '">' +
          '<p style="' + S.warnTxt + 'font-weight:600;margin-bottom:6px;">' +
            (lc === 1 ? "One search needs" : lc + " searches need") + ' a quick fix</p>' +
          '<p style="' + S.warnTxt + '">The deal breakers saved on ' + (lc === 1 ? "it" : "them") +
          ' were recorded in an older format we can no longer read correctly, so we are ignoring them rather than guessing. Open the search and re-pick them.</p>' +
        '</div>';
    }

    if (!n) {
      html +=
        '<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;">' +
          '<button type="button" id="ra-voice" style="' + S.mic + '">Start out loud</button>' +
          '<button type="button" id="ra-new" style="' + S.ghost + '">Start with a form</button>' +
        '</div>';
    } else {
      html += '<div id="ra-list">';
      state.searches.forEach(function (s, i) {
        var c = s.criteria || {};
        var must = names(c.must_have);
        var nice = names(c.nice_to_have);
        var brk = names(c.deal_breakers);
        var pets = petLine(c.pets);
        var legacy = (c.legacy_breakers || []).length;
        var opts = s.options || [];
        var open = !!state.expanded[s.id];
        var caret = open ? "\\u25be" : "\\u25b8";

        // COLLAPSED HEAD. Name, status, one summary line. Nothing else.
        // This is the whole height fix: everything below only renders when
        // the renter asks for it.
        html +=
          '<div style="' + (s.enabled ? S.item : S.itemOff) + '">' +
            '<div data-act="expand" data-i="' + i + '" style="cursor:pointer;">' +
              '<p style="margin:0 0 2px;"><span style="' + S.itemName + '">' + esc(s.name) + '</span> ' +
                '<span style="' + (s.enabled ? S.pillOn : S.pillOff) + '">' + (s.enabled ? "Running" : "Paused") + '</span>' +
                // ac-v28: the "by voice" chip is gone. It told the renter
                // how they made the search, which they already know, and it
                // changes nothing about what the search does. The source is
                // still stored and still reaches the demand index, where it
                // is genuinely useful - how many people dictate versus type
                // is our question, not theirs.
                (legacy ? ' <span style="' + S.pillOff + 'color:#a07c1c;">needs a fix</span>' : "") +
                ' <span style="color:#9aa9bd;font-size:12px;">' + caret + '</span>' +
              '</p>' +
              (s.zone && s.zone.name
                ? '<p style="' + S.itemMuted + 'margin:0 0 2px;">' + esc(s.zone.name) +
                  ((s.zone.zips || []).length ? '  \\u00b7  ' + s.zone.zips.length + ' zips' : "") + '</p>'
                : "") +
              (opts.length > 1
                ? '<p style="' + S.itemLine + 'margin:0;">' + esc(opts.map(optLabel).join("  or  ")) + '</p>'
                : (summaryText(c) ? '<p style="' + S.itemLine + 'margin:0;">' + esc(summaryText(c)) + '</p>' : "")) +
            '</div>';

        if (open) {
          html +=
            '<div style="margin-top:8px;">' +
              (opts.length > 1
                ? '<p style="' + S.itemMuted + '">Any of these works:</p>' +
                  opts.map(function (o) {
                    return '<p style="' + S.itemMuted + 'margin-left:10px;">' + esc(optLabel(o)) + '</p>';
                  }).join("")
                : "") +
              (opts.length > 1 && summaryText(c) ? "" : "") +
              (must ? '<p style="' + S.itemMuted + '">Must have: ' + esc(must) + '</p>' : "") +
              (nice ? '<p style="' + S.itemMuted + '">Nice to have: ' + esc(nice) + '</p>' : "") +
              (brk ? '<p style="' + S.itemMuted + '">Will not accept: ' + esc(brk) + '</p>' : "") +
              (pets ? '<p style="' + S.itemMuted + '">Pets: ' + esc(pets) + '</p>' : "") +
              (c.voucher ? '<p style="' + S.itemMuted + '">Using a voucher' + (c.voucher_program ? " (" + esc(c.voucher_program) + ")" : "") + '</p>' : "") +
              (c.notes ? '<p style="' + S.itemMuted + '">Notes: ' + esc(c.notes) + '</p>' : "") +
              (legacy ? '<p style="' + S.itemMuted + 'color:#a07c1c;">Deal breakers need re-picking</p>' : "") +
              '<p style="' + S.itemMuted + 'margin-top:6px;">Created ' + esc(fmtDate(s.created)) +
                (s.updated && s.updated.slice(0, 10) !== (s.created || "").slice(0, 10)
                  ? '  \\u00b7  updated ' + esc(fmtDate(s.updated)) : "") + '</p>' +
              '<div style="' + S.acts + '">' +
                '<button type="button" data-act="edit" data-i="' + i + '" style="' + S.ghost + '">Edit</button>' +
                '<button type="button" data-act="toggle" data-i="' + i + '" style="' + S.ghost + '">' + (s.enabled ? "Pause" : "Resume") + '</button>' +
                '<button type="button" data-act="del" data-i="' + i + '" style="' + S.link + '">Delete</button>' +
              '</div>' +
            '</div>';
        }

        html += '</div>';
      });
      html += '</div>';

      html += '<div style="margin-top:6px;display:flex;gap:10px;flex-wrap:wrap;">';
      if (n < MAX) {
        // ac-v29 NAMING. The populated state had "Describe another out
        // loud" and "Add with a form" - both of which say HOW before they
        // say WHAT, so neither read as the way to add a search. Every
        // entrance now begins with the verb, and the two states stay
        // parallel: Start / Add.
        html += '<button type="button" id="ra-voice" style="' + S.mic + '">Add a search out loud</button>' +
                '<button type="button" id="ra-new" style="' + S.ghost + '">Add a search with a form</button>';
      } else {
        html += '<p style="' + S.itemMuted + '">You have reached the limit of ' + MAX + ' saved searches. Delete one to add another.</p>';
      }
      html += '</div>';
    }

    // ---- CONSENT BLOCK REMOVED (ac-v15) ----------------------------------
    // Two checkboxes used to live here: "introduce me to verified
    // Renters.com properties" and "also pass my inquiry off-platform".
    //
    // WHY THEY ARE GONE. Consent is now asked ONCE, on the What We Share
    // screen, where the renter sees their own values beside every field and
    // reads the exact introduction a landlord will receive. A checkbox that
    // says "introduce me to properties that match" asks the same question
    // with none of that context, and asking twice in two vocabularies is how
    // two records end up disagreeing about what someone agreed to.
    //
    // THE STORED VALUES ARE NOT TOUCHED. state.consent is still loaded from
    // the server and still sent back on every save, so nothing is silently
    // revoked and nothing is silently granted. Zeroing them here would have
    // been a consent change made on a renter's behalf without asking, which
    // is the thing this whole surface exists to avoid.
    //
    // ⚠️ CONSEQUENCE WORTH KNOWING: there is now no way to REVOKE these two
    // from this card. That is only acceptable because the lead hub shows
    // nobody has ever ticked them. If that stops being true, revocation has
    // to exist on the What We Share screen before this stays removed.

    html +=
      '<div id="ra-note" style="' + S.note + '"></div>' +
      '<p style="font-size:12px;color:#7a8ba1;margin:14px 0 0;">No matches, no email. Pause any search here, or from any email we send.</p>';

    wrap.innerHTML = html;
  }

  function newDraft() {
    return {
      id: "", name: "", created: "", enabled: true, source: "form",
      transcript_full: "", criteria: emptyCriteria(),
      // The zone the renter drew, straight off the picker message.
      zone: null,
      // Options TWO and beyond. Option one is always the three questions
      // above, built from criteria at save time, so the primary is never
      // held in two places that can disagree.
      extra: []
    };
  }

  function emptyOption() {
    return { unit_types: [], rent_max: null, beds: [], baths_min: null, label: "" };
  }

  // ac-v29: TRIM AT A WORD BOUNDARY. The store caps a search name at 40
  // characters and a hard slice produced "Jason - 2BR/1BA Wyoming w/ yard
  // & parkin" - a name that reads as a typo rather than a limit. Cut back
  // to the last space when one is reasonably close to the end; otherwise
  // a hard cut is still better than an overflow.
  function trimName(v, max) {
    var t = String(v || "").trim();
    if (t.length <= max) return t;
    var cut = t.slice(0, max);
    var sp = cut.lastIndexOf(" ");
    // Only honour the space if it is not chopping most of the name off.
    if (sp > max * 0.6) cut = cut.slice(0, sp);
    // NO REGEX. This whole file is served from inside a template literal,
    // so a lone backslash escape is eaten before the browser ever sees it:
    // /[\s]+$/ written here arrives as /[s]+$/ and would strip a trailing
    // "s" off somebody's search name. Char comparison instead.
    var TRAIL = " ,.;:/&-";
    while (cut.length && TRAIL.indexOf(cut.charAt(cut.length - 1)) !== -1) {
      cut = cut.slice(0, cut.length - 1);
    }
    return cut;
  }

  function optLabel(o) {
    if (!o) return "";
    var bits = [];
    if ((o.unit_types || []).length === 1) bits.push(pretty(o.unit_types[0]));
    else if ((o.unit_types || []).length > 1) bits.push(o.unit_types.length + " types");
    var b = bedsLabel(o.beds);
    if (b) bits.push(b);
    if (o.rent_max) bits.push("up to " + money(o.rent_max));
    return bits.length ? bits.join(" ") : "Any place";
  }

  // The full options array as ap-v10 wants it: primary first, extras
  // after. Built at save time from the two places the UI holds them.
  function buildOptions(c, extra) {
    var out = [{
      unit_types: c.unit_types || [],
      rent_max: c.rent_max,
      rent_stretch: c.rent_stretch,
      rent_basis: c.rent_basis,
      beds: c.beds || [],
      baths_min: c.baths_min,
      label: ""
    }];
    (extra || []).forEach(function (o) {
      if (o && (o.rent_max || (o.beds || []).length || (o.unit_types || []).length)) out.push(o);
    });
    return out.slice(0, MAX_OPTIONS);
  }

  function wireList(mp) {
    var nb = document.getElementById("ra-new");
    if (nb) nb.onclick = function () {
      state.draft = newDraft();
      state.editIdx = -1;
      state.showRefine = false;
      state.view = "form";
      render(mp);
    };

    var vb = document.getElementById("ra-voice");
    if (vb) vb.onclick = function () {
      // The draft is created HERE, before the mic, so a zone picked on the
      // voice screen is already on it when the proposal lands. Marked as
      // voice so the ac-v21 guard restores THIS view rather than the form
      // if anything tries to reset while a zone is already on it.
      state.draft = newDraft();
      state.draft.source = "voice";
      state.editIdx = -1;
      state.showRefine = false;
      state.voice = { active: false, transcript: "", interim: "", status: "", rec: null, heard: "", unclear: [] };
      state.view = "voice";
      render(mp);
    };

    // ac-v15: the consent checkbox handlers are gone with their inputs.
    // They are removed rather than left guarded because saveConsent() read
    // the DOM and would have written FALSE for both the moment anything
    // called it - a live way to revoke a consent nobody asked to revoke.

    var list = document.getElementById("ra-list");
    if (list) {
      // ac-v16: [data-act], not button[data-act] - the collapsed head is a
      // clickable DIV so the whole row is the tap target, not a small caret.
      var btns = list.querySelectorAll("[data-act]");
      for (var k = 0; k < btns.length; k++) {
        btns[k].onclick = function () {
          var act = this.getAttribute("data-act");
          var i = Number(this.getAttribute("data-i"));
          var s = state.searches[i];
          if (!s) return;

          if (act === "expand") {
            state.expanded[s.id] = !state.expanded[s.id];
            render(mp);
            return;
          }

          if (act === "edit") {
            state.draft = {
              id: s.id, name: s.name, created: s.created,
              enabled: s.enabled, source: s.source || "form", transcript_full: "",
              zone: s.zone ? JSON.parse(JSON.stringify(s.zone)) : null,
              // Option one lives in criteria and is rendered by the three
              // questions, so only two-and-beyond come into extra.
              extra: JSON.parse(JSON.stringify((s.options || []).slice(1))),
              criteria: JSON.parse(JSON.stringify(s.criteria || emptyCriteria()))
            };
            state.editIdx = i;
            // Open Refine automatically when there is something in there
            // that needs attention.
            state.showRefine = ((s.criteria || {}).legacy_breakers || []).length > 0;
            state.view = "form";
            render(mp);
            return;
          }
          if (act === "toggle") { s.enabled = !s.enabled; persist(mp, "Updated."); return; }
          if (act === "del") {
            if (!window.confirm("Delete the search \\"" + s.name + "\\"?")) return;
            deleteSearch(mp, s.id);
          }
        };
      }
    }
    showSaved();
  }

  function showSaved() {
    var note = document.getElementById("ra-note");
    if (note && state.savedAt) {
      note.style.color = "#1a7f52";
      note.textContent = "Saved " + state.savedAt + ". We have this on file.";
    }
  }

  // ---------------- VOICE ----------------
  function speechSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  // ONE zone block, rendered by BOTH the voice view and the form view.
  // Kenny's call, and it is right: whichever button a renter taps, the
  // first question is where. av-v1 deliberately ignores place names, so
  // a renter who talks would otherwise never be asked at all - which is
  // how a search ends up matching inventory in a state nobody mentioned.
  function zoneBlockHtml(d, stepTwoLabel) {
    var picked = !!(d.zone && (d.zone.zips || []).length);

    // ---- STEP ONE, and it is a STEP now, not a panel that sits there ----
    // ac-v24: once a zone is drawn this collapses to a single receipt line
    // and the next question follows immediately underneath. Before, the
    // map and the form sat stacked as two separate tools and the renter
    // had to work out that one fed the other.
    var html = '<div style="' + (picked ? S.zoneDone : S.zoneBox) + '">';

    if (picked) {
      var zips = d.zone.zips || [];
      html +=
        '<div style="display:flex;align-items:flex-start;gap:10px;">' +
          '<span style="' + S.stepTick + '">1</span>' +
          '<div style="flex:1;min-width:0;">' +
            '<p style="font-size:15px;font-weight:700;color:#0d2d4e;margin:0 0 2px;">' +
              esc(d.zone.name || "Your area") + '</p>' +
            // The zips are the receipt for what the polygon actually
            // caught. The renter does nothing with them; they are here so
            // the tool is not silent about what it took.
            '<p style="' + S.itemMuted + 'margin:0;">' + zips.length + ' zip code' +
              (zips.length === 1 ? "" : "s") + (zips.length ? ' &middot; ' + esc(zips.join(", ")) : "") + '</p>' +
          '</div>' +
          '<button type="button" id="ra-zone-open" style="' + S.link + 'flex:0 0 auto;">' +
            (state.pickerOpen ? "Hide" : "Change") + '</button>' +
        '</div>';
    } else {
      html +=
        '<div style="display:flex;align-items:flex-start;gap:10px;">' +
          '<span style="' + S.stepNum + '">1</span>' +
          '<div style="flex:1;">' +
            '<p style="font-size:15px;font-weight:700;color:#0d2d4e;margin:0 0 2px;">Pick your zone</p>' +
            '<p style="' + S.hint + 'margin:0 0 10px;">Draw the area you would actually live in. Everything you say next applies inside it.</p>' +
            (state.pickerOpen ? "" :
              '<button type="button" id="ra-zone-open" style="' + S.btn + '">Pick your zone</button>') +
          '</div>' +
        '</div>';
    }

    if (state.pickerOpen) {
      html +=
        '<p style="' + S.hint + 'margin:10px 0 6px;">Search a place, tap Draw Zone, then tap the map to trace the area.</p>' +
        '<div id="ra-picker-slot" style="border:1px solid #dde9e6;border-radius:10px;overflow:hidden;"></div>' +
        '<button type="button" id="ra-zone-use" style="' + S.btn + 'margin-top:10px;width:100%;">Use this area</button>' +
        '<button type="button" id="ra-zone-reset" style="' + S.ghost + 'margin-top:8px;width:100%;">Start over</button>' +
        '<span id="ra-zone-msg" style="' + S.hint + 'display:block;margin-top:6px;"></span>';
    }

    html += '</div>';

    // ---- STEP TWO HEADER, rendered only once step one is done ----------
    // This is the interconnection: the second question does not exist
    // until the first is answered, so the flow reads as one movement
    // instead of two tools stacked on top of each other.
    if (picked && stepTwoLabel) {
      html +=
        '<div style="display:flex;align-items:flex-start;gap:10px;margin:0 0 14px;">' +
          '<span style="' + S.stepNum + '">2</span>' +
          '<div style="flex:1;">' +
            '<p style="font-size:15px;font-weight:700;color:#0d2d4e;margin:0 0 2px;">' + esc(stepTwoLabel) + '</p>' +
            '<p style="' + S.hint + 'margin:0;">Inside ' + esc(d.zone.name || "that area") + '.</p>' +
          '</div>' +
        '</div>';
    }

    return html;
  }

  function renderVoice(wrap) {
    var supported = speechSupported();
    var d = state.draft || newDraft();
    var zoned = !!(d.zone && (d.zone.zips || []).length);
    var html =
      '<h3 style="' + S.h + '">' + (zoned ? "Now tell us about the place" : "Start with where") + '</h3>' +
      '<p style="' + S.sub + '">' + (zoned
        ? "Budget, size, timing, pets, anything that matters. Say it however you would say it to a friend and we will fill in the form."
        : "Draw where you want to live, then tell us what you are looking for inside it.") + '</p>' +
      zoneBlockHtml(d, "Talk or type your spot");

    // ac-v24: the mic does not exist until step one is done. Two live
    // controls with no order between them is what made this read as two
    // tools rather than one flow.
    if (!zoned) {
      html += '<div id="ra-note" style="' + S.note + '"></div>' +
        '<div style="margin-top:6px;"><button type="button" id="ra-vback" style="' + S.link + '">Cancel</button></div>';
      wrap.innerHTML = html;
      return;
    }

    if (supported) {
      html +=
        '<div id="ra-live" style="' + S.live + '">' +
          (state.voice.transcript || state.voice.interim
            ? esc(state.voice.transcript + state.voice.interim)
            : '<span style="color:#9aa8b8;">Your words will appear here.</span>') +
        '</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">' +
          '<button type="button" id="ra-rec" style="' + (state.voice.active ? S.ghost : S.mic) + '">' +
            (state.voice.active ? "Stop and use this" : (state.voice.transcript ? "Start over" : "Start talking")) + '</button>' +
          (state.voice.transcript && !state.voice.active
            ? '<button type="button" id="ra-use" style="' + S.btn + '">Use this</button>' : "") +
          '<button type="button" id="ra-vcancel" style="' + S.link + '">Type it instead</button>' +
          // A DEAD END WAS THE BUG: "Type it instead" is a route FORWARD,
          // not a way back, so a renter who opened this by mistake was
          // stuck on it. Every view gets an exit.
          '<button type="button" id="ra-vback" style="' + S.link + '">Cancel</button>' +
        '</div>';
    } else {
      html +=
        '<p style="' + S.hint + '">This browser will not let us listen, so type it instead. Same result.</p>' +
        '<div id="ra-ta-mount" style="margin-bottom:12px;"></div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
          '<button type="button" id="ra-use" style="' + S.btn + '">Use this</button>' +
          '<button type="button" id="ra-vcancel" style="' + S.link + '">Use the form instead</button>' +
          '<button type="button" id="ra-vback" style="' + S.link + '">Cancel</button>' +
        '</div>';
    }

    html += '<div id="ra-note" style="' + S.note + '">' + esc(state.voice.status) + '</div>';
    wrap.innerHTML = html;

    // Textarea built with createElement rather than innerHTML, matching
    // the caution the safety-check tool learned about textareas.
    // NOTE: query inside wrap, NOT document. render() inserts wrap into
    // the page AFTER this function returns, so a document lookup here
    // returns null and the element is silently never created.
    if (!supported) {
      var m = wrap.querySelector("#ra-ta-mount");
      if (m) {
        var ta = document.createElement("textarea");
        ta.id = "ra-ta";
        ta.rows = 5;
        ta.maxLength = 4000;
        ta.placeholder = "Two bedroom under 2000, need parking, I have a 65 pound lab, in by October";
        ta.style.cssText = S.inp + "resize:vertical;line-height:1.5;";
        ta.value = state.voice.transcript || "";
        m.appendChild(ta);
      }
    }
  }

  function stopRec() {
    if (state.voice.rec) {
      try { state.voice.rec.stop(); } catch (e) {}
      state.voice.rec = null;
    }
    state.voice.active = false;
  }

  function wireVoice(mp) {
    // false: there is no form on this view to read.
    wireZone(mp, false);

    var rec = document.getElementById("ra-rec");
    var use = document.getElementById("ra-use");
    var cancel = document.getElementById("ra-vcancel");

    var back = document.getElementById("ra-vback");
    if (back) back.onclick = function () {
      stopRec();
      clearDraft();
      state.draft = null;
      state.view = "list";
      state.editIdx = -1;
      state.pickerOpen = false;
      state.voice.heard = "";
      state.voice.unclear = [];
      render(mp);
    };

    if (cancel) cancel.onclick = function () {
      stopRec();
      state.view = "form";
      render(mp);
    };

    if (rec) rec.onclick = function () {
      if (state.voice.active) { stopRec(); render(mp); return; }

      var Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
      var r;
      try { r = new Ctor(); } catch (e) {
        state.voice.status = "We could not start the microphone. Type it instead.";
        render(mp);
        return;
      }
      r.continuous = true;
      r.interimResults = true;
      r.lang = "en-US";

      state.voice.transcript = "";
      state.voice.interim = "";
      state.voice.status = "Listening. Take your time.";
      state.voice.active = true;
      state.voice.rec = r;

      r.onresult = function (ev) {
        var interim = "";
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          var t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) state.voice.transcript += t;
          else interim += t;
        }
        state.voice.interim = interim;
        var live = document.getElementById("ra-live");
        if (live) live.textContent = state.voice.transcript + state.voice.interim;
      };
      r.onerror = function (ev) {
        console.log("[Renters alerts] speech error", ev && ev.error);
        state.voice.active = false;
        state.voice.status = (ev && ev.error === "not-allowed")
          ? "Microphone permission was declined. Type it instead."
          : "The microphone stopped. You can try again or type it instead.";
        render(mp);
      };
      r.onend = function () {
        if (!state.voice.active) return;
        state.voice.active = false;
        state.voice.interim = "";
        render(mp);
      };

      try { r.start(); } catch (e) {
        state.voice.active = false;
        state.voice.status = "We could not start the microphone. Type it instead.";
      }
      render(mp);
    };

    if (use) use.onclick = function () {
      stopRec();
      var ta = document.getElementById("ra-ta");
      var text = ta ? ta.value : (state.voice.transcript || "");
      text = String(text || "").trim();
      if (text.length < 12) {
        state.voice.status = "A little more detail and we can work with it.";
        render(mp);
        return;
      }
      extract(mp, text);
    };
  }

  function extract(mp, transcript) {
    if (state.busy) return;
    state.busy = true;
    state.voice.status = "Working out what you need.";
    var note = document.getElementById("ra-note");
    if (note) { note.style.color = "#5b6b82"; note.textContent = state.voice.status; }

    fetch(VOICE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberId: id, transcript: transcript })
    }).then(function (r) { return r.json(); }).then(function (d) {
      state.busy = false;

      // Not extracted: keep the renter's words rather than losing them.
      if (!d || !d.extracted) {
        console.log("[Renters alerts] extraction unavailable", d);
        state.draft = newDraft();
        state.draft.source = "voice";
        state.draft.transcript_full = transcript;
        state.draft.criteria.notes = transcript.slice(0, 400);
        state.voice.heard = "";
        state.voice.unclear = [];
        state.showRefine = true;
        state.view = "form";
        render(mp);
        var n2 = document.getElementById("ra-note");
        if (n2) { n2.style.color = "#a07c1c"; n2.textContent = "We could not break that down automatically, so your words are in the notes. Fill in what you can."; }
        return;
      }

      var c = emptyCriteria();
      var got = d.criteria || {};
      Object.keys(c).forEach(function (k) {
        if (got[k] !== undefined && got[k] !== null) c[k] = got[k];
      });

      // 🔴 ac-v28: KEEP THE ZONE. The proposal used to build a WHOLE NEW
      // draft object, which silently discarded the zone the renter had
      // just drawn one screen earlier - and the extra options with it.
      // Proven on a live save: every field from the transcript present,
      // "zone": null. The zone survived the reload, survived the guard,
      // and was thrown away here at the last step.
      // The transcript owns CRITERIA. It does not own where they want to
      // live: alerts-voice deliberately ignores place names, so it has
      // nothing to say about a zone and must not be allowed to erase one.
      var prev = state.draft || {};
      state.draft = {
        id: "", name: trimName(d.suggested_name || "", 40), created: "", enabled: true,
        source: "voice", transcript_full: d.transcript_full || transcript,
        zone: prev.zone || null,
        extra: prev.extra || [],
        criteria: c
      };
      // The renter's own words for the place beat a generated name, but
      // only when the transcript did not produce one.
      if (!state.draft.name && prev.zone && prev.zone.name) {
        state.draft.name = trimName(prev.zone.name, 40);
      }
      state.editIdx = -1;
      state.voice.heard = d.heard || "";
      state.voice.unclear = Array.isArray(d.unclear) ? d.unclear : [];
      // Anything it could not determine lives behind Refine, so open it.
      state.showRefine = state.voice.unclear.length > 0;
      state.view = "form";
      render(mp);
    }).catch(function (e) {
      state.busy = false;
      console.error("[Renters alerts] voice call failed", e);
      state.voice.status = "That did not go through. Try again or type it instead.";
      render(mp);
    });
  }

  // ---------------- FORM ----------------
  var FIELD_LABEL = {
    rent_max: "budget", rent_basis: "utilities", beds: "bedrooms", baths_min: "bathrooms",
    unit_types: "type of place", move_in_earliest: "earliest move-in", move_in_latest: "latest move-in",
    lease_terms: "lease length", household_adults: "who is moving in", household_kids: "children",
    pets: "pets", voucher: "voucher", must_have: "must-haves", nice_to_have: "nice-to-haves",
    deal_breakers: "deal breakers", notes: "notes"
  };

  function unclearLine() {
    if (!state.voice.unclear.length) return "";
    var seen = {}, out = [];
    state.voice.unclear.forEach(function (k) {
      var l = FIELD_LABEL[k] || k.split("_").join(" ");
      if (!seen[l]) { seen[l] = 1; out.push(l); }
    });
    return out.slice(0, 6).join(", ");
  }

  function renderForm(wrap) {
    var d = state.draft;
    var c = d.criteria;
    var isNew = state.editIdx === -1;
    var legacy = (c.legacy_breakers || []).length;

    var html =
      '<h3 style="' + S.h + '">' + (isNew ? "New search" : "Edit search") + '</h3>';

    if (state.voice.heard) {
      html +=
        '<div style="' + S.heard + '">' +
          '<p style="font-size:13px;font-weight:600;color:#1f6b5e;margin:0 0 6px;">Here is what we heard</p>' +
          '<p style="font-size:14px;color:#2c4f49;margin:0 0 8px;line-height:1.5;">' + esc(state.voice.heard) + '</p>' +
          (unclearLine()
            ? '<p style="font-size:12px;color:#4d7a72;margin:0;">We did not catch your ' + esc(unclearLine()) + '. Add it below if it matters, or leave it out.</p>'
            : '') +
        '</div>';
    } else {
      html += '<p style="' + S.sub + '">Where first, then what would work there. Open Refine if you want to be precise, and the more precise you are the fewer and better the emails.</p>';
    }

    // ---- STEP ONE: WHERE ----------------------------------------------
    // Same block the voice view renders. One definition, two hosts.
    html += zoneBlockHtml(d, "Tell us about the place");

    // ---- the three questions ----
    html +=
      '<div style="' + S.row + '">' +
        '<div style="flex:1;min-width:140px;"><span style="' + S.lab + '">Most you can pay</span>' +
          '<input id="ra-rent" type="number" min="0" step="10" inputmode="numeric" placeholder="2200" value="' + esc(val(c.rent_max)) + '" style="' + S.inp + '"></div>' +
      '</div>' +
      '<div style="margin-bottom:14px;"><span style="' + S.lab + '">Size</span>' +
        '<span style="' + S.hint + '">Pick every size that would work.</span>' +
        '<div id="ra-beds" style="' + S.row + 'margin-bottom:0;"></div></div>' +
      '<div style="' + S.row + '">' +
        '<div style="flex:1;min-width:150px;"><span style="' + S.lab + '">Could move in as early as</span>' +
          '<input id="ra-move-e" type="date" value="' + esc(val(c.move_in_earliest)) + '" style="' + S.inp + '"></div>' +
        '<div style="flex:1;min-width:150px;"><span style="' + S.lab + '">Need to be in by</span>' +
          '<input id="ra-move-l" type="date" value="' + esc(val(c.move_in_latest)) + '" style="' + S.inp + '"></div>' +
      '</div>' +
      '<div style="margin-bottom:14px;"><span style="' + S.lab + '">Name this search</span>' +
        '<input id="ra-name" maxlength="40" placeholder="' + esc((d.zone && d.zone.name) || "2BR near the light rail") + '" value="' + esc(d.name) + '" style="' + S.inp + '"></div>';

    // ---- OTHER THINGS THAT WOULD WORK, EACH AT ITS OWN PRICE ---------
    // The whole reason schema v4 exists. Same area, different thing,
    // different number: a house at 2000 OR a condo at 1000 OR a room at
    // 750. Empty by default - a renter who wants one thing never sees a
    // row here.
    html +=
      '<div style="margin-bottom:14px;">' +
        '<span style="' + S.lab + '">Would something else work here?</span>' +
        '<span style="' + S.hint + '">A different kind of place at a different price. We only send one if it fits that price.</span>' +
        '<div id="ra-opts">';

    (d.extra || []).forEach(function (o, oi) {
      html +=
        '<div style="' + S.optRow + '">' +
          '<div style="' + S.row + 'margin-bottom:0;">' +
            '<div style="flex:1;min-width:120px;"><select id="ra-opt-type-' + oi + '" style="' + S.inp + '">' +
              '<option value="">Any type</option>' +
              sc("unitTypes").map(function (u) {
                return '<option value="' + esc(u) + '"' +
                  ((o.unit_types || [])[0] === u ? " selected" : "") + '>' + esc(pretty(u)) + '</option>';
              }).join("") +
            '</select></div>' +
            '<div style="flex:1;min-width:110px;">' +
              '<input id="ra-opt-rent-' + oi + '" type="number" min="0" step="10" inputmode="numeric" placeholder="Up to" value="' +
                esc(val(o.rent_max)) + '" style="' + S.inp + '"></div>' +
            '<div style="flex:1;min-width:110px;"><select id="ra-opt-beds-' + oi + '" style="' + S.inp + '">' +
              '<option value="">Any size</option>' +
              sc("bedSizes").map(function (b) {
                return '<option value="' + esc(b) + '"' +
                  ((o.beds || [])[0] === b ? " selected" : "") + '>' + esc(pretty(b)) + '</option>';
              }).join("") +
            '</select></div>' +
          '</div>' +
          '<button type="button" data-optdel="' + oi + '" style="' + S.link + 'margin-top:6px;">Remove</button>' +
        '</div>';
    });

    html += '</div>';
    if ((d.extra || []).length < MAX_OPTIONS - 1) {
      html += '<button type="button" id="ra-addopt" style="' + S.ghost + '">Add another option</button>';
    } else {
      html += '<p style="' + S.itemMuted + '">That is the limit of ' + MAX_OPTIONS + ' options on one area.</p>';
    }
    html += '</div>';

    // ---- refine ----
    html += '<div style="' + S.fold + '">' +
      '<button type="button" id="ra-refine" style="' + S.ghost + '">' + (state.showRefine ? "Hide the details" : "Refine this search") + '</button>';

    if (state.showRefine) {
      var noSchema = !state.schema;
      html += '<div style="margin-top:16px;">';

      if (noSchema) {
        html += '<p style="' + S.warnTxt + '">We cannot load the full option list right now. Everything above still saves.</p>';
      }

      // rent detail
      html +=
        '<div style="' + S.row + '">' +
          '<div style="flex:1;min-width:140px;"><span style="' + S.lab + '">Could stretch by</span>' +
            '<input id="ra-stretch" type="number" min="0" step="10" inputmode="numeric" placeholder="150" value="' + esc(val(c.rent_stretch)) + '" style="' + S.inp + '"></div>' +
          '<div style="flex:1;min-width:160px;"><span style="' + S.lab + '">Is that with utilities?</span>' +
            '<select id="ra-basis" style="' + S.inp + '">' +
              '<option value=""' + (!c.rent_basis ? " selected" : "") + '>Not sure</option>' +
              '<option value="all_in"' + (c.rent_basis === "all_in" ? " selected" : "") + '>Utilities included</option>' +
              '<option value="plus_utilities"' + (c.rent_basis === "plus_utilities" ? " selected" : "") + '>Rent only, utilities on top</option>' +
            '</select></div>' +
          '<div style="flex:1;min-width:110px;"><span style="' + S.lab + '">Baths</span>' +
            '<input id="ra-baths" type="number" min="0" step="0.5" inputmode="decimal" placeholder="1" value="' + esc(val(c.baths_min)) + '" style="' + S.inp + '"></div>' +
        '</div>';

      if (!noSchema) {
        html +=
          '<div style="margin-bottom:14px;"><span style="' + S.lab + '">Type of place</span>' +
            '<div id="ra-units" style="' + S.row + 'margin-bottom:0;"></div></div>' +
          '<div style="margin-bottom:14px;"><span style="' + S.lab + '">Lease length</span>' +
            '<div id="ra-lease" style="' + S.row + 'margin-bottom:0;"></div></div>';
      }

      // household + pets
      html +=
        '<div style="' + S.row + '">' +
          '<div style="flex:1;min-width:110px;"><span style="' + S.lab + '">Adults</span>' +
            '<input id="ra-adults" type="number" min="0" step="1" inputmode="numeric" placeholder="1" value="' + esc(val(c.household_adults)) + '" style="' + S.inp + '"></div>' +
          '<div style="flex:1;min-width:110px;"><span style="' + S.lab + '">Children</span>' +
            '<input id="ra-kids" type="number" min="0" step="1" inputmode="numeric" placeholder="0" value="' + esc(val(c.household_kids)) + '" style="' + S.inp + '"></div>' +
        '</div>' +
        '<div style="margin-bottom:14px;"><span style="' + S.lab + '">Pets</span>' +
          '<span style="' + S.hint + '">Weight matters more than breed. Plenty of places take a dog up to a limit.</span>' +
          '<div style="' + S.row + 'margin-bottom:0;">' +
            '<div style="flex:1;min-width:120px;"><select id="ra-pet-species" style="' + S.inp + '">' +
              '<option value="">No pets</option>' +
              '<option value="dog"' + (petSpecies(c) === "dog" ? " selected" : "") + '>Dog</option>' +
              '<option value="cat"' + (petSpecies(c) === "cat" ? " selected" : "") + '>Cat</option>' +
              '<option value="other"' + (petSpecies(c) === "other" ? " selected" : "") + '>Other</option>' +
            '</select></div>' +
            '<div style="flex:1;min-width:110px;"><input id="ra-pet-count" type="number" min="0" step="1" inputmode="numeric" placeholder="How many" value="' + esc(val(petField(c, "count"))) + '" style="' + S.inp + '"></div>' +
            '<div style="flex:1;min-width:110px;"><input id="ra-pet-weight" type="number" min="0" step="1" inputmode="numeric" placeholder="Weight in lb" value="' + esc(val(petField(c, "weight_lbs"))) + '" style="' + S.inp + '"></div>' +
          '</div></div>';

      // voucher
      html +=
        '<div style="margin-bottom:14px;">' +
          '<label style="' + S.cRow + '">' +
            '<input type="checkbox" id="ra-voucher" style="' + S.cBox + '"' + (c.voucher ? " checked" : "") + '>' +
            '<span style="' + S.cLab + '">I am using a housing voucher or rental assistance. We will only send places that accept it.</span>' +
          '</label>' +
          '<input id="ra-voucher-prog" maxlength="40" placeholder="Which programme, if you know" value="' + esc(val(c.voucher_program)) + '" style="' + S.inp + '">' +
        '</div>';

      if (!noSchema) {
        html +=
          '<div style="margin-bottom:14px;"><span style="' + S.lab + '">Must have</span>' +
            '<span style="' + S.hint + '">At most ' + MUST_CAP + '. Only the things you would turn a place down over, because these filter listings out completely. <span id="ra-must-count"></span></span>' +
            '<div id="ra-must" style="' + S.row + 'margin-bottom:0;"></div></div>' +
          '<div style="margin-bottom:14px;"><span style="' + S.lab + '">Nice to have</span>' +
            '<span style="' + S.hint + '">Pick as many as you like. These move a place up the list, they never rule one out.</span>' +
            '<div id="ra-nice" style="' + S.row + 'margin-bottom:0;"></div></div>' +
          '<div style="margin-bottom:14px;"><span style="' + S.lab + '">Will not accept</span>' +
            '<div id="ra-break" style="' + S.row + 'margin-bottom:0;"></div></div>';
      }

      if (legacy) {
        html +=
          '<div style="' + S.warn + '">' +
            '<p style="' + S.warnTxt + 'font-weight:600;margin-bottom:6px;">Your old deal breakers</p>' +
            '<p style="' + S.warnTxt + '">These were saved in a format we can no longer read correctly, so we are not matching on them: ' +
              esc(names(c.legacy_breakers)) + '. Pick what you will not accept from the list above and these will be cleared.</p>' +
          '</div>';
      }

      html +=
        '<div style="margin-bottom:6px;"><span style="' + S.lab + '">Anything else that matters?</span>' +
          '<span style="' + S.hint + '">A school, a commute, a reason. We read this against every listing description.</span>' +
          '<div id="ra-notes-mount"></div></div>';

      html += '</div>';
    }
    html += '</div>';

    html +=
      '<div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">' +
        '<button type="button" id="ra-save" style="' + S.btn + '">' + (isNew ? "Save this search" : "Save changes") + '</button>' +
        '<button type="button" id="ra-cancel" style="' + S.ghost + '">Cancel</button>' +
      '</div>' +
      '<div id="ra-note" style="' + S.note + '"></div>';

    wrap.innerHTML = html;

    // Same rule as renderVoice: wrap is not in the document yet.
    var nm = wrap.querySelector("#ra-notes-mount");
    if (nm) {
      var ta = document.createElement("textarea");
      ta.id = "ra-notes";
      ta.rows = 3;
      ta.maxLength = 400;
      ta.placeholder = "Quiet street, walkable to the light rail, starting a job downtown in September";
      ta.style.cssText = S.inp + "resize:vertical;line-height:1.5;";
      ta.value = c.notes || "";
      nm.appendChild(ta);
    }
  }

  function petSpecies(c) {
    return (c.pets && c.pets.length) ? c.pets[0].species : "";
  }
  function petField(c, k) {
    return (c.pets && c.pets.length) ? c.pets[0][k] : "";
  }

  function readForm() {
    var c = state.draft.criteria;

    function el(x) { return document.getElementById(x); }
    // ac-v29: A NEGATIVE WAS ACCEPTED BY THE FIELD AND SILENTLY DROPPED
    // HERE. Live: an option's price took -4 from the spinner, this
    // returned null, and the renter walked away believing they had set a
    // price on it. The store was never at risk - ap-v11 rejects anything
    // not above zero - but silently discarding what someone typed is
    // worse than refusing it, because they never find out.
    // min="0" on the inputs stops the spinner going under, and this
    // CLEARS THE FIELD so a pasted or typed negative is visibly gone
    // rather than quietly ignored.
    function n(x) {
      var e = el(x);
      if (!e || e.value === "") return null;
      var v = Number(e.value);
      if (!isFinite(v) || v < 0) { e.value = ""; return null; }
      return v;
    }
    function s(x) { var e = el(x); return e ? e.value : ""; }

    c.rent_max = n("ra-rent");
    c.move_in_earliest = s("ra-move-e") || null;
    c.move_in_latest = s("ra-move-l") || null;
    state.draft.name = s("ra-name");

    // Extra options. Read back into the draft so a re-render (opening
    // Refine, toggling the map) never loses a half-typed row.
    (state.draft.extra || []).forEach(function (o, oi) {
      var t = s("ra-opt-type-" + oi);
      var b = s("ra-opt-beds-" + oi);
      o.unit_types = t ? [t] : [];
      o.beds = b ? [b] : [];
      o.rent_max = n("ra-opt-rent-" + oi);
    });

    if (state.showRefine) {
      c.rent_stretch = n("ra-stretch");
      c.rent_basis = s("ra-basis") || null;
      c.baths_min = n("ra-baths");
      c.household_adults = n("ra-adults");
      c.household_kids = n("ra-kids");
      // Household belongs to the MEMBER as of ap-v10. The two criteria
      // fields above are still written for back compat, but this is the
      // copy that is authoritative and it is sent once, not per search.
      var ha = n("ra-adults");
      var hk = n("ra-kids");
      if (ha !== null || hk !== null) {
        state.household = { adults: ha, total: (ha || 0) + (hk || 0) };
      }
      var vb = el("ra-voucher");
      c.voucher = !!(vb && vb.checked);
      c.voucher_program = s("ra-voucher-prog");
      var nt = el("ra-notes");
      if (nt) c.notes = nt.value;

      var sp = s("ra-pet-species");
      if (sp) {
        c.pets = [{
          species: sp,
          count: n("ra-pet-count") || 1,
          weight_lbs: n("ra-pet-weight"),
          note: ""
        }];
      } else {
        c.pets = [];
      }

      // Re-picking clears the unreadable old values.
      if ((c.deal_breakers || []).length) c.legacy_breakers = [];
    }
  }

  // ZONE WIRING, SHARED BY BOTH VIEWS. The form reads its inputs before
  // re-rendering; the voice view has none to read, so the caller says
  // whether a readForm() is safe. Calling it from the voice view would
  // dereference form fields that do not exist.
  // Ask the picker to save. Separate from the click handler because a
  // busy answer has to be able to ask again.
  // A reload can land between renders, so anything typed since the last
  // one would be lost. This runs on the way out and costs nothing.
  window.addEventListener("beforeunload", function () {
    try {
      if (state.view === "form" && state.draft) readForm();
      saveDraft();
    } catch (e) {}
  });

  function askPickerToSave() {
    var f = document.getElementById("ra-picker");
    var msg = document.getElementById("ra-zone-msg");
    if (!f || !f.contentWindow) return;
    if (msg && !state.zoneTries) msg.textContent = "Saving that area...";
    // zp-v4 contract: the host asks, the picker saves and answers.
    f.contentWindow.postMessage({ type: "renters_areas_save" }, "*");
  }

  function wireZone(mp, readsForm) {
    // ---- THE ONE LIVE FRAME -------------------------------------------
    // Built once, parked in the slot after every render. render() rebuilds
    // this card's innerHTML on every tap, so an iframe written as markup
    // would reload Google Maps and throw away a half-drawn polygon each
    // time. Kept in a variable and re-appended instead.
    var slot = document.getElementById("ra-picker-slot");
    if (slot) {
      if (!state.frame) {
        var f = document.createElement("iframe");
        f.id = "ra-picker";
        f.src = PICKER + "?embed=1";
        f.setAttribute("allow", "geolocation");
        // Starting height only. zp-v8 measures itself and posts
        // rdcZoneHeight, and the listener below sizes the frame to fit so
        // the picker never grows its own scrollbar.
        f.style.cssText = "width:100%;height:" + (state.frameH || 560) + "px;border:0;display:block;transition:height .15s;";
        state.frame = f;
      }
      if (state.frame.parentNode !== slot) slot.appendChild(state.frame);
    }

    var zr = document.getElementById("ra-zone-reset");
    if (zr) zr.onclick = function () {
      // ?embed=1 hides the picker's own save row, and Clear All lives in
      // it - so an embedded picker has no way to undo a bad shape. This
      // is that button. A fresh frame is the reliable clear.
      if (readsForm) readForm();
      state.frame = null;
      var sl = document.getElementById("ra-picker-slot");
      if (sl) sl.innerHTML = "";
      render(mp);
    };

    var zo = document.getElementById("ra-zone-open");
    if (zo) zo.onclick = function () {
      if (readsForm) readForm();
      state.pickerOpen = !state.pickerOpen;
      // Closing drops the frame. Holding a detached iframe alive keeps
      // Google Maps running behind a card nobody is looking at.
      if (!state.pickerOpen) state.frame = null;
      render(mp);
    };

    var zu = document.getElementById("ra-zone-use");
    if (zu) zu.onclick = function () {
      state.zoneTries = 0;
      askPickerToSave();
    };

    // Bound ONCE for the life of the card. render() runs on every tap and
    // a listener added per render would fire N times on one message.
    if (!state.zoneWired) {
      state.zoneWired = true;
      window.addEventListener("message", function (e) {
        var d = e.data;
        if (!d || !d.type) return;
        var msg = document.getElementById("ra-zone-msg");

        // zp-v8 height handshake. Distinct from the members map's
        // rdcMapHeight on purpose - that listener lives in BD head code and
        // would resize the wrong element.
        if (d.type === "rdcZoneHeight") {
          var h = Number(d.height);
          if (!isFinite(h) || h < 300 || h > 900) return;
          state.frameH = h;
          if (state.frame) state.frame.style.height = h + "px";
          return;
        }

        if (d.type === "renters_areas_none") {
          state.zoneTries = 0;
          if (msg) msg.textContent = "Draw an area on the map first.";
          return;
        }
        if (d.type === "renters_areas_busy") {
          // ⚠️ ac-v25: BUSY IS A REFUSAL, NOT PROGRESS, AND THAT COST AN
          // HOUR. zone-picker's saveZones() returns WITHOUT SAVING when any
          // zone still has loading true - it posts busy and stops. The host
          // showed "Working on it..." and then waited forever, because
          // nothing was coming. No error, no crash, just a dead end: the
          // renter had drawn a zone, the zips were resolved on screen, and
          // Use this area did nothing.
          // A REFUSAL NEEDS A RETRY OR AN ANSWER. Never a spinner.
          state.zoneTries = (state.zoneTries || 0) + 1;
          if (state.zoneTries <= 12) {
            if (msg) msg.textContent = "Finishing the zip codes for that area...";
            setTimeout(askPickerToSave, 800);
          } else if (msg) {
            msg.textContent = "That area is taking too long to resolve. Tap Start over and draw it again.";
          }
          return;
        }
        if (d.type !== "renters_areas_zips") return;
        if (!state.draft) state.draft = newDraft();

        var zones = d.zones || [];
        var z = zones[0] || null;
        if (!z) return;

        // ONE zone per search. A renter drawing three shapes in one
        // sitting is describing three searches, and merging them here
        // would rebuild the undifferentiated pool this whole change
        // exists to kill.
        state.draft.zone = {
          name: z.name || "",
          zips: z.zips || [],
          custom: z.custom === true,
          path: z.path || []
        };
        if (!state.draft.name) state.draft.name = trimName(z.name || "", 40);

        // The zips ALSO go to BD as service areas, because that write can
        // only happen client-side on the session cookie. rdcAreasAdd is
        // head code and is not path gated. Absent, the search still saves
        // with its zone - this is bookkeeping, not the match key.
        try {
          if (typeof window.rdcAreasAdd === "function") {
            window.rdcAreasAdd(d.zips || [], zones);
          }
        } catch (err) {
          console.log("[Renters alerts] rdcAreasAdd unavailable", err);
        }

        state.zoneTries = 0;
        state.pickerOpen = false;
        state.frame = null;
        render(mp);
      });
    }
  }

  function wireForm(mp) {
    redrawChips();

    wireZone(mp, true);

    // ---- options ----
    var ao = document.getElementById("ra-addopt");
    if (ao) ao.onclick = function () {
      readForm();
      state.draft.extra = state.draft.extra || [];
      if (state.draft.extra.length < MAX_OPTIONS - 1) state.draft.extra.push(emptyOption());
      render(mp);
    };

    var optWrap = document.getElementById("ra-opts");
    if (optWrap) {
      var dels = optWrap.querySelectorAll("button[data-optdel]");
      for (var q = 0; q < dels.length; q++) {
        dels[q].onclick = function () {
          readForm();
          var oi = Number(this.getAttribute("data-optdel"));
          state.draft.extra.splice(oi, 1);
          render(mp);
        };
      }
    }

    var rf = document.getElementById("ra-refine");
    if (rf) rf.onclick = function () {
      readForm();
      state.showRefine = !state.showRefine;
      render(mp);
    };

    document.getElementById("ra-cancel").onclick = function () {
      // Order matters: the draft is cleared BEFORE the view changes, or
      // the ac-v21 guard reads a draft with work and puts the form back.
      clearDraft();
      state.draft = null;
      state.view = "list";
      state.editIdx = -1;
      state.voice.heard = "";
      state.voice.unclear = [];
      render(mp);
    };

    document.getElementById("ra-save").onclick = function () {
      readForm();
      var c = state.draft.criteria;

      // A drawn zone is enough on its own. Refusing to save one because
      // no price is typed yet throws away the work the renter just did on
      // the map, which is the most expensive thing on this form.
      if (!hasSomething(c) && !state.draft.zone && !(state.draft.extra || []).length) {
        var note = document.getElementById("ra-note");
        note.style.color = "#b3261e";
        note.textContent = "Draw an area or add at least one thing to match on.";
        return;
      }

      var rec = {
        id: state.draft.id || "",
        name: state.draft.name,
        created: state.draft.created || "",
        enabled: state.draft.enabled !== false,
        source: state.draft.source || "form",
        transcript_full: state.draft.transcript_full || "",
        zone: state.draft.zone || null,
        options: buildOptions(c, state.draft.extra),
        criteria: c
      };

      if (state.editIdx === -1) state.searches.push(rec);
      else state.searches[state.editIdx] = rec;

      clearDraft();
      state.draft = null;
      state.view = "list";
      state.editIdx = -1;
      state.voice.heard = "";
      state.voice.unclear = [];
      persist(mp, "Saved.");
    };
  }

  // ---- write --------------------------------------------------------
  function stamp() {
    var now = new Date();
    return now.toLocaleDateString() + " at " +
      now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function absorb(d) {
    // Trust the server's sanitised copy, not the form. What comes back is
    // what is actually stored.
    state.searches = d.searches || [];
    state.enabled = !!d.enabled;
    if (d.consent) state.consent = {
      platform: !!d.consent.platform,
      off_platform: !!d.consent.off_platform
    };
    if (d.household) state.household = d.household;
    state.savedAt = stamp();
  }

  function persist(mp, okMsg) {
    if (state.busy) return;
    state.busy = true;

    fetch(PREFS, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memberId: id,
        searches: state.searches,
        consent: state.consent,
        // Omitted rather than nulled when unknown: ap-v10 PRESERVES a
        // stored household on an absent key and would clear it on a null.
        household: state.household || undefined
      })
    }).then(function (r) { return r.json(); }).then(function (d) {
      state.busy = false;
      if (d && d.landed) { absorb(d); render(mp); }
      else fail(d, okMsg);
    }).catch(function (e) {
      state.busy = false;
      fail(e, okMsg);
    });
  }

  function deleteSearch(mp, searchId) {
    if (state.busy) return;
    state.busy = true;

    fetch(PREFS, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberId: id, action: "delete", searchId: searchId })
    }).then(function (r) { return r.json(); }).then(function (d) {
      state.busy = false;
      if (d && d.landed) { absorb(d); render(mp); }
      else fail(d, "delete");
    }).catch(function (e) {
      state.busy = false;
      fail(e, "delete");
    });
  }

  function fail(d, ctx) {
    var note = document.getElementById("ra-note");
    if (note) {
      note.style.color = "#b3261e";
      note.textContent = "We could not save that. Try once more.";
    }
    console.error("[Renters alerts] write did not land (" + ctx + ")", d);
  }

  // ---- MOUNT ORDER. Unchanged from ac-v11. -------------------------
  function mount() {
    // ac-v28: THE FALLBACK WAS PUTTING THE CARD OUTSIDE THE CONTENT
    // COLUMN. #rdc-wiz is the renter wizard and it is the right anchor -
    // but it mounts async, so when this runs first the old chain fell
    // straight through to main, which on /account/home is the WHOLE
    // PAGE. That is the full-bleed, left-clipped card sitting under
    // everything, and it appeared after head-code changes because
    // changing head-code size changes who wins the race.
    // The column is .col-md-9 ... .member_accounts - confirmed live from
    // the console as the parent the card lands in when it goes RIGHT.
    // Ordered best to worst, and main is last rather than second.
    var wiz = document.getElementById("rdc-wiz");
    if (wiz && wiz.parentNode) return { parent: wiz.parentNode, before: wiz.nextSibling, anchor: "wiz" };

    var col = document.querySelector(".member_accounts");
    if (col) return { parent: col, before: null, anchor: "column" };

    var main = document.querySelector(".page-content, .main-content, main");
    if (main) return { parent: main, before: null, anchor: "main" };
    return null;
  }

  // A card that settled for a WORSE anchor should move to a better one
  // when it appears. The wizard arriving late is the normal case, not an
  // edge case, so this is how the card ends up in the right place rather
  // than merely the first place available.
  function betterAnchorAvailable() {
    if (state.anchor === "wiz") return false;
    if (document.getElementById("rdc-wiz")) return true;
    if (state.anchor === "main" && document.querySelector(".member_accounts")) return true;
    return false;
  }

  var moves = 0;
  var MAX_MOVES = 8;

  function keepOrder() {
    if (moves > MAX_MOVES) return;
    // ac-v19: NEVER MOVE THE CARD WHILE THE MAP IS OPEN. insertBefore
    // MOVES the node, and moving a node that contains an iframe tears the
    // iframe down and reloads it. On a 700ms timer that is a map that
    // resets itself under the renter's hand, which is exactly what it
    // looked like. Position can wait until the map closes.
    if (state.pickerOpen) return;
    var card = document.getElementById("rdc-alerts");
    if (!card) return;
    var wiz = document.getElementById("rdc-wiz");
    if (!wiz || !wiz.parentNode) return;
    if (card.parentNode === wiz.parentNode && card.previousElementSibling === wiz) return;
    var p = card.compareDocumentPosition(wiz);
    if (!(p & Node.DOCUMENT_POSITION_FOLLOWING)) return;
    wiz.parentNode.insertBefore(card, wiz.nextSibling);
    moves++;
    if (state.anchor !== "wiz") {
      console.log("[Renters alerts] settled below the wizard");
      state.anchor = "wiz";
    }
  }

  // Removes the OLD card only. The incoming one is still called
  // rdc-alerts-new at this point and is deliberately not matched here.
  function removeCard() {
    var el = document.getElementById("rdc-alerts");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // ---- boot ---------------------------------------------------------
  // Schema only, as of ac-v16. The areas read is gone with the gate it fed.
  // A missing schema hides the chip rows and the core fields still save;
  // there is deliberately no fallback key list.
  function loadSchema() {
    return fetch(PREFS + "?schema=1")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s || !Array.isArray(s.positiveChips)) return null;
        return s;
      })
      .catch(function (e) {
        console.log("[Renters alerts] schema read failed, chips hidden", e);
        return null;
      });
  }

  Promise.all([loadSchema()]).then(function (res) {
    state.schema = res[0];
    res = [null, res[0]];
    if (res[1]) {
      if (typeof res[1].mustHaveCap === "number") MUST_CAP = res[1].mustHaveCap;
      if (typeof res[1].maxSearches === "number") MAX = res[1].maxSearches;
      console.log("[Renters alerts] schema v" + res[1].schemaVersion +
        " chips:" + res[1].positiveChips.length +
        " breakers:" + res[1].breakerChips.length +
        " mustCap:" + MUST_CAP);
    }
    boot();
  });

  function boot() {
    fetch(PREFS + "?status=1&memberId=" + id)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || d.error) {
          console.log("[Renters alerts] status error, standing down", d);
          return;
        }
        state.searches = Array.isArray(d.searches) ? d.searches : [];
        state.enabled = !!d.enabled;
        if (d.consent) state.consent = {
          platform: !!d.consent.platform,
          off_platform: !!d.consent.off_platform
        };
        if (typeof d.maxSearches === "number") MAX = d.maxSearches;
        if (typeof d.mustHaveCap === "number") MUST_CAP = d.mustHaveCap;
        console.log("[Renters alerts] loaded", {
          searches: state.searches.length,
          enabled: state.enabled,
          storedVersion: d.storedVersion,
          migrated: !!d.migratedOnRead,
          legacyBreakers: legacyCount(),
          consent: state.consent
        });

        // ---- RESTORE AN UNFINISHED DRAFT --------------------------------
        // The page reloads on its own (see the ac-v27 note above), so
        // arriving here does NOT mean the renter started over. If there is
        // recent work in sessionStorage, put them back where they were.
        // The picker is deliberately NOT reopened - the zone is already
        // captured and reopening a map on load would be startling.
        var saved = loadDraft();
        if (saved) {
          state.draft = saved.draft;
          state.editIdx = typeof saved.editIdx === "number" ? saved.editIdx : -1;
          state.showRefine = !!saved.showRefine;
          state.pickerOpen = false;
          state.view = saved.view === "voice" ? "voice" : "form";
          console.log("[Renters alerts] restored an unfinished search after a page reload", {
            zone: state.draft.zone ? state.draft.zone.name : null,
            options: (state.draft.extra || []).length + 1
          });
        }

        // ⚠️ ac-v23: THIS TIMER NO LONGER STOPS. It used to clear itself
        // after ~300 ticks, about three and a half minutes - so a card
        // that disappeared after that had NO recovery, which is exactly
        // the state a renter is in by the time they have drawn a zone and
        // started describing a place. The POSITION work still stops on
        // schedule (it is a settling behaviour and should not run
        // forever); only the "is the card still there" check keeps going,
        // and it costs one getElementById every 700ms.
        var tries = 0;
        var t = setInterval(function () {
          tries++;
          var m = mount();
          if (!m) return;
          var here = document.getElementById("rdc-alerts");
          if (!here) {
            console.log("[Renters alerts] card was missing, putting it back");
            render(m);
            return;
          }
          // Nothing on this timer touches the card while the map is open:
          // moving a node that contains an iframe reloads the iframe.
          if (state.pickerOpen) return;

          // Landed somewhere worse than it could have. Re-render into the
          // better parent. Only ever runs while the map is closed, and
          // only while the position is still settling.
          if (tries <= 300 && betterAnchorAvailable()) {
            console.log("[Renters alerts] moving to a better anchor");
            render(m);
            return;
          }

          if (tries <= 300) keepOrder();
        }, 700);
      })
      .catch(function (e) {
        console.log("[Renters alerts] status read failed, standing down", e);
      });
  }
  } // end start()
})();
`;

exports.handler = async () => ({
  statusCode: 200,
  headers: {
    "content-type": "application/javascript; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*"
  },
  body: JS
});
