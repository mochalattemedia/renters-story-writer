// ==================================================================
// alerts-teaser-js.js  —  at-v23
// Homepage teaser for Daily Listing Alerts. Logged-OUT capture.
//
// PURPOSE: a visitor with no account builds a search, hits a wall that
// says "create a free account and we'll email you when a home matches",
// and after signup that exact search lands in their dashboard already
// configured. The search IS the onboarding pitch: they invest effort
// before the wall, so signup converts better than a cold register button.
//
// THIS FILE IS PIECE 1 of 2. It captures the search and parks it under a
// random token via alerts-claim.js (?stash). PIECE 2 — reading that
// token on first dashboard load and writing it to the new member — needs
// BD's post-signup redirect behaviour, which is not yet known, so it is
// built separately once that flow is observed.
//
// NO MEMBER ID EXISTS HERE. Nothing writes to BD. The only network call
// is stashing the search for later claim. Location is captured as a zip
// or city string (there is no session to read /account/locations), and
// converted to zones after signup.
//
// DROP-IN: head code / page content carries only a loader that points a
// container at this. Set MOUNT_SELECTOR to the id of the div you place
// in the homepage content area.
//
// at-v23: 🔴 MOBILE HAD NO WAY TO SUBMIT WHAT IT HEARD.
//
// ON MOBILE, SPEECH RECOGNITION ENDS ON A PAUSE. That is normal browser
// behaviour, not a fault - iOS and Android both do it. at-v22 only ever
// offered "Stop and add this" WHILE RECORDING, so the moment the
// recogniser ended by itself the panel showed "Start talking" and "Never
// mind" and NOTHING to use what had just been said. A renter could speak
// a whole description and have no way out of it but to discard it.
// Desktop hid this completely, because there the renter genuinely does
// tap Stop before anything auto-ends.
//
// NOW: when recording stops with a usable transcript, "Add this"
// (primary) and "Say more" appear, with a line saying so. "Say more"
// APPENDS rather than restarting - startRec() clears the transcript, so
// the existing text is carried across and rejoined.
// r.onend also SAYS something now instead of leaving a silent panel that
// looks either still-listening or already-finished.
//
// 📌 THE LESSON: A CONTROL THAT ONLY EXISTS DURING AN ACTIVE STATE
// STRANDS ANYONE WHOSE STATE ENDS WITHOUT THEM. Every terminal state
// needs its own way forward, not just the one the desktop path takes.
//
// at-v22: THE MIC OPENS IN PLACE. Tapping "Keep describing out loud"
// swapped the whole card for the voice screen - top of the page, a
// different heading, an empty transcript box. at-v12 had already made
// voice ADDITIVE and at-v18 added an "Already saved" line saying so, but
// a caption promising nothing was lost is weak next to a screen that
// looks exactly like a fresh start.
//
// ⭐ NOW IT RECORDS WHERE THE BUTTON IS. Every filled field stays on
// screen above the transcript while they speak, so "this is being added
// to what I have" is something they SEE rather than something they are
// asked to believe. Stop and add this, or Never mind.
// The full voice screen still opens on the FIRST use, when the form is
// empty - there is nothing on screen to reassure them about, and it is
// the better first impression.
//
// While recording inline, only the transcript line is repainted. A full
// renderForm() on every interim result would rebuild the inputs
// underneath the renter and steal focus from anything they were typing.
//
// at-v21: WAITING GETS ITS OWN SCREEN. "Working out what you need." was
// one line of grey 13px text sitting under an unchanged transcript box,
// so the two or three seconds of extraction looked exactly like nothing
// happening. Somebody who thinks nothing is happening taps the button
// again, or leaves - and this is the moment right after they have spoken
// a whole description, which is the most expensive thing to lose.
// Now: a spinner, the sentence at real size, and every button REMOVED
// while it runs so there is nothing to press by mistake. Both handlers
// are null-guarded, since the controls genuinely are not in the DOM.
//
// at-v20: ONE RED THING, NOT THREE. at-v15 made recording unmissable by
// turning the status text red, the transcript box red and the stop button
// red simultaneously. It worked, and it overshot: three reds at once read
// as an ERROR STATE, and a visitor mid-sentence should never be wondering
// whether something has broken.
// The pulsing dot keeps the whole signal - a single MOVING element is
// more legible than three static ones, and movement is what says "now",
// which is precisely the thing being communicated. Status text goes navy,
// the box goes neutral with a teal edge, and stop becomes teal like the
// mic button it replaces, so the screen does not change temperature just
// because the microphone is on.
//
// at-v19: 🔴 THE TOKEN NEVER SURVIVED SIGNUP. The whole point of this
// file is that a visitor builds a perfect spot logged out and finds it
// waiting in their dashboard afterwards. It has never once worked.
//
// The token was parked in sessionStorage, WHICH IS PER TAB. BD's signup
// chain does not reliably keep the visitor in the same tab, and at-v2
// already recorded that it drops the ?claim= query param through its
// redirects - so both handoffs failed and the token was gone. Confirmed
// live on a fresh signup, member #4581: sessionStorage.getItem returned
// null on the dashboard and the card showed its empty state.
//
// localStorage survives a new tab, a full navigation and a browser
// restart. Both keys are written now, with a timestamp so a stale token
// cannot attach itself to an account somebody creates weeks later on a
// shared computer.
//
// ⚠️ alerts-claim-js (the DASHBOARD reader) must be updated to look in
// localStorage too, or this fix does nothing on its own.
//
// at-v18: THE SCREENS NOW TELL THE TRUTH ABOUT WHAT IS KEPT. Two places
// where correct behaviour was undermined by presentation.
//
// 1. RETURNING TO VOICE LOOKED LIKE STARTING OVER. "Keep describing out
//    loud" opened onto an empty transcript box and a Start talking
//    button - pixel-identical to the first visit. at-v12 made voice ADD
//    rather than replace, but the screen said otherwise, and a visitor
//    who believes they are about to lose their work simply will not tap
//    it. The heading becomes "Add to your perfect spot" and an ALREADY
//    SAVED line lists what is held: the place, the ceiling, the beds, the
//    chip counts.
//
// 2. THE TRANSCRIPT WAS BURIED AT THE BOTTOM. It was appended into the
//    notes box, which sits at the foot of the filters panel - so coming
//    back from voice, the thing they had JUST SAID was the hardest thing
//    on the page to find, and it truncated mid-word at 400 characters
//    while duplicating fields already captured.
//    It now has its own field and renders at the TOP of the form as
//    "Here is what we heard" - the same position it occupied on the voice
//    screen. Notes goes back to being what the visitor wants remembered.
//
// at-v17: 🔴 THE SIGNUP BUTTON WAS INVISIBLE. Not missing - INVISIBLE.
// The anchor was in the DOM, correctly styled, with a working href to
// /checkout/renters and the claim token attached, and it computed to
// display:none. Console: "Create my free account | 0x0 | rgb(255,255,255)
// | rgb(58,158,143) | none".
// An inline style beats a stylesheet - but NOT one marked !important, and
// BD has a rule hiding bare anchors in this content area. So the single
// conversion point on the homepage teaser existed and nobody could see or
// click it. Every visitor who finished a perfect spot hit a dead end.
//
// ⚠️ INLINE IS NOT THE TOP OF THE CASCADE. On any surface whose CSS you
// do not control, the properties deciding whether a thing EXISTS on
// screen - display, visibility - need !important. Same family as the
// button-type trap that reloaded the dashboard: you do not own the
// document you are rendering into, and its defaults are not neutral.
//
// at-v16: BUTTON HIERARCHY, AND "TYPE IT INSTEAD" STOPS THROWING AWAY
// WHAT WAS SAID.
//
// 1. EVERY CONTROL ON THE VOICE SCREEN WAS WHITE. "Stop and use this" and
//    "Type it instead" looked identical, and so did "Start over" and "Use
//    this" on the next state. Two buttons of equal weight side by side is
//    the interface refusing to say which one is the point.
//    Three levels now: PRIMARY is the thing to do, GHOST is the
//    alternative, LINK is the way out. Stop is RED, matching the
//    recording pulse, because it ends the recording. After recording,
//    "Use this" takes the primary and "Start over" drops to ghost - it
//    throws work away and should not look like the obvious next step.
//
// 2. 🔴 "Type it instead" DISCARDED THE TRANSCRIPT. Someone who talked for
//    thirty seconds and then decided to finish by typing was dropped back
//    at an empty form with every word gone. It means TYPE THE REST - a
//    change of input method, not an abandonment. It now runs the same
//    extraction "Use this" runs, so they land in a filled form, and the
//    label says "Type the rest instead" once there is something to keep.
//    Third instance of this bug in two days: ac-v28 on the dashboard,
//    at-v12 on the teaser form, and now here. THE PATTERN IS ALWAYS THE
//    SAME - a path that changes view without carrying state forward.
//
// at-v15: LISTENING LOOKS LIKE LISTENING. "Listening. Take your time."
// was grey 13px body text - the same weight as every other hint on the
// page - so the one moment where a visitor needs certainty that the
// microphone is ACTUALLY ON was the quietest thing on screen. Somebody
// unsure whether it is recording stops talking, and a half-sentence is a
// worse perfect spot than no perfect spot.
// Now: red bold text, a pulsing red dot, and the transcript box itself
// turns warm with a red border while it runs. All three revert the
// instant recording stops, so the state is never ambiguous in either
// direction.
//
// at-v14: MUST HAVE AND NICE TO HAVE, AND NO NEGATIVE NUMBERS.
//
// 1. TWO CHIP ROWS, matching the dashboard. A must-have and a nice-to-have
//    are not the same promise: a MUST-HAVE REMOVES every listing without
//    it, a nice-to-have only ranks them. One undifferentiated row meant a
//    visitor tapping five things could not tell whether they had widened
//    their search or narrowed it to nothing.
//    ⭐ AND IT UNBLOCKS THE HANDOFF: aclaim-v2 files every teaser chip as
//    nice_to_have precisely BECAUSE the teaser could not say which was
//    which. Now it can, and the distinction survives into their perfect
//    spot instead of being flattened at the door.
//    Must-haves cap at 3, same as the dashboard, and a key can only sit
//    in one row - a thing cannot be both a deal breaker and a bonus.
//    Voice routes must_have and nice_to_have to their own rows rather
//    than pouring both into one bucket.
//
// 2. RENT, BEDS AND BATHS CANNOT GO NEGATIVE. min="0" stops the spinner
//    and numVal() CLEARS a typed or pasted negative so it is visibly
//    rejected. Minus one bedroom is not a search, and a visitor who
//    believes they set a value and did not will never find out on their
//    own. Same fix as ac-v29 on the dashboard.
//
// at-v13: THE BUTTONS SAY WHERE YOU ARE. Once voice has filled the form,
// "Describe it out loud" reads like starting over - which is precisely
// what it did before at-v12 - so it becomes "Keep describing out loud"
// with a line saying the fields above are theirs to correct. And the
// submit changes from "Notify me when this matches" to "This is my
// perfect spot", because after speaking a whole description the visitor
// is confirming, not requesting.
// A behaviour change nobody can see is a behaviour change nobody trusts.
//
// at-v12: VOICE ADDS, IT DOES NOT REPLACE. Plus a readable notes field
// and the Perfect Spot vocabulary.
//
// 1. 🔴 TAPPING "Describe it out loud" WIPED THE FORM. The handler jumped
//    straight to renderVoice(), and every render rebuilds the form from
//    `seed` - which was EMPTY unless voice had already filled it. So a
//    visitor who typed a rent, beds, baths, tapped a chip and wrote a
//    note, then reached for the microphone, lost all of it before the mic
//    even opened. captureIntoSeed() now runs first, and the voice result
//    MERGES: chips are added to the ones already tapped, notes keep the
//    visitor's own words at the front, and a typed location is never
//    overwritten by one guessed out of a transcript.
//    Same failure as ac-v28 on the dashboard, same principle: THE
//    TRANSCRIPT OWNS WHAT IT MENTIONS AND NOTHING ELSE.
//
// 2. NOTES IS A TEXTAREA NOW. It was a one-line input - the single field
//    voice fills with a whole paragraph - so the text ran off the right
//    edge with no way to read it back. Three rows, 400 characters,
//    matching what aclaim-v2 stores.
//
// 3. VOCABULARY. "Dream up your perfect spot" and "Your perfect spot is
//    ready", matching the dashboard card. A PERFECT SPOT is the object; a
//    HOUSING REQUEST is the separate external Get Matched form.
//
// PRIOR - at-v11: scroll so the TOP of the wall clears the fixed nav bar. v10
// centered the card, but the wall is taller than the phone screen, so
// centering pushed the "Your search is ready" title up under the nav.
// Now we compute the card's absolute top, subtract a nav-height offset,
// and scroll there with window.scrollTo - so the title is always the
// first thing in view. Falls back to scrollIntoView if geometry is
// unavailable.
//
// PRIOR - at-v10: the wall scrolled to CENTER the card in the viewport rather
// than aligning its top under the nav bar - so "Create my free account"
// sits in the middle of the screen, the natural place to look after
// submitting. Targets the signup button specifically when present.
//
// at-v9: FIX - on mobile, after tapping Notify, the "Create my free
// account" wall rendered but the page kept its scroll position, so the
// renter was looking at a section further down and had to scroll UP to
// see the confirmation. The wall now scrolls itself into view when it
// renders, so the call to action is what they see right after submitting.
// Same for returning to the form via "Edit my search".
//
// at-v8: FIX - voice did not fill the LOCATION field. The shared voice
// backend (av-v1) is deliberately told to IGNORE place names, because on
// the DASHBOARD the renter's location comes from their drawn Search Areas,
// not speech. But on this logged-out teaser there are no search areas and
// location is the one REQUIRED field - so a renter who said "Portland,
// Oregon" got the whole form filled EXCEPT the location, then blocked with
// "tell us where you want to live." The place name was captured (it showed
// up in notes) but never routed to the location box.
// Fix lives HERE, not in av-v1 (the dashboard depends on it ignoring
// location): the teaser now pulls a place name out of the transcript
// itself and fills the location field. Conservative - if it cannot find a
// confident place, it leaves the field for the renter rather than guessing.
//
// at-v7: ALIGNMENT. The two action buttons (voice + Notify) now share
// one width, capped at 360px and centered, so they stack evenly instead
// of one hugging its text and the other being wider. The "Add filters"
// link moved up to sit directly under the location bar - it extends the
// input, so it belongs with it, and that keeps the two buttons together
// at the bottom instead of splitting them. Also softened the teaser
// heading to "Start your search" so it stops competing with the section
// heading above it on the homepage.
//
// at-v6: CALM LAYOUT. The card now opens with just three things: a big
// location bar, a voice button, and Notify. Everything else - rent, beds,
// baths, move-in, the 11 chips, notes - lives behind a quiet "Add filters"
// link and is hidden until asked for. One clean screen, generous padding,
// nothing competing. Refinement is optional; the point is to get a search
// started, not to make them fill a form. If voice extraction pre-fills any
// hidden field, the filters panel auto-opens so they can see what we heard.
//
// at-v5: LAYOUT. Matches the homepage pattern - a centered primary
// heading with the concept line beneath it, sitting ABOVE the input card
// (like the hero and "Featured homes"), rather than a heading crammed
// inside the card. The card itself is calmer: voice is the clear first
// action, the form sits under a subtle divider, chips wrap with more
// breathing room, and the whole thing is centered to the same column as
// the two cards above. Logic unchanged from at-v4.
//
// at-v4: VOICE INTAKE, matching the dashboard (ac-v14). Same browser
// webkitSpeechRecognition capture, same alerts-voice.js (av-v1) backend,
// same Claude extraction. alerts-voice takes memberId as OPTIONAL and
// falls back to IP for rate limiting, so it works logged-out unchanged.
//
// One deliberate difference from the dashboard: the teaser's fields are
// the SIMPLE set (where / rent / beds / baths / chips / notes), while
// av-v1 returns the richer v3 schema (beds[], unit_types, pets[],
// must_have/nice_to_have/deal_breakers, move_in_earliest/latest). Rather
// than a lossy field-by-field remap, the teaser maps what lines up
// cleanly and ALWAYS preserves the full transcript in notes, then drops
// the renter into the pre-filled form to confirm. Nothing spoken is lost,
// and the dashboard (full schema) is where they refine after signup.
//
// Voice is never required: "Describe it out loud" and "Fill in a form"
// sit side by side, and any speech failure falls back to the form with
// the words kept.
//
// at-v3: widened to match the two-card row above it on the homepage
// (~1100px) instead of the old 620px, and the field layout stretched to
// fill: rent/beds/baths and the two chip areas breathe across the wider
// card. Wall recap stays centered and narrow because a confirmation reads
// better tight. Logic unchanged from at-v2.
//
// at-v2: signup URL wired to /checkout/renters, and the token is now ALSO
// written to sessionStorage before the visitor leaves for signup. BD's
// signup redirect chain does not reliably preserve a URL query param, so
// sessionStorage is the robust handoff: it survives any same-origin
// redirect. The ?claim= param is kept too as a bonus path. The dashboard
// claimer (alerts-claim-js) reads whichever is present.
// ==================================================================

const FN_VERSION = "at-v23";
const CLAIM = "https://renters-story-writer.netlify.app/.netlify/functions/alerts-claim";

// ⬇⬇⬇  SET THIS to your real BD signup URL (right-click your Sign up
//      button -> Copy link address). The teaser appends ?claim=TOKEN so
//      the search can be reunited with the new account after signup.
//      Leave the placeholder and the button will explain it is not set.
const SIGNUP_URL = "https://www.renters.com/checkout/renters";

const CHIPS = [
  ["move_in_special", "Move-in special"],
  ["pets_dog", "Dog friendly"],
  ["pets_cat", "Cat friendly"],
  ["large_dog_ok", "Large dog ok"],
  ["washer_dryer_in_unit", "W/D in unit"],
  ["parking", "Parking"],
  ["yard", "Yard"],
  ["ground_floor", "Ground floor"],
  ["no_stairs", "No stairs"],
  ["furnished", "Furnished"],
  ["utilities_included", "Utilities included"]
];

const JS = `
(function () {
  var V = "${FN_VERSION}";
  var CLAIM = "${CLAIM}";
  var VOICE = "https://renters-story-writer.netlify.app/.netlify/functions/alerts-voice";
  var SIGNUP_URL = "${SIGNUP_URL}";
  var CHIPS = ${JSON.stringify(CHIPS)};
  var MOUNT_SELECTOR = "#renters-alert-teaser";
  console.log("[Renters teaser] version: " + V);

  // The pulse keyframes. Injected once; a style tag in the mount HTML
  // would be re-created on every render.
  try {
    if (!document.getElementById("rdc-teaser-css")) {
      var st = document.createElement("style");
      st.id = "rdc-teaser-css";
      st.textContent = "@keyframes rdcPulse{0%{box-shadow:0 0 0 0 rgba(217,68,54,.5)}70%{box-shadow:0 0 0 8px rgba(217,68,54,0)}100%{box-shadow:0 0 0 0 rgba(217,68,54,0)}}@keyframes rdcSpin{to{transform:rotate(360deg)}}";
      document.head.appendChild(st);
    }
  } catch (e) {}

  var mount = document.querySelector(MOUNT_SELECTOR);
  if (!mount) { console.log("[Renters teaser] no mount " + MOUNT_SELECTOR + ", standing down"); return; }
  if (mount.getAttribute("data-rendered") === "1") return;
  mount.setAttribute("data-rendered", "1");

  var NAVY = "#0d2d4e", NAVY2 = "#081f38", TEAL = "#3a9e8f", LIME = "#8dc63f";

  var S = {
    card: "background:#fff;border:1px solid #e8edf3;border-radius:20px;padding:clamp(32px,5vw,56px);max-width:920px;margin:0 auto;font-family:inherit;box-shadow:0 4px 30px rgba(13,45,78,0.07);",
    h: "margin:0 0 6px;font-size:22px;font-weight:800;color:" + NAVY + ";",
    sub: "margin:0 0 18px;font-size:15px;color:#5b6b82;line-height:1.5;",
    lab: "display:block;font-size:13px;font-weight:600;color:" + NAVY + ";margin:0 0 6px;",
    hint: "font-size:12.5px;color:#6b7a8d;text-align:center;margin:8px 0 0;line-height:1.5;",
    inlineBox: "background:#f4faf8;border:1px solid #cfe6df;border-radius:12px;padding:14px 15px;margin:0 0 14px;text-align:left;",
    busyBox: "background:#f7fbfa;border:2px solid " + TEAL + ";border-radius:12px;padding:28px 16px;margin:0 0 16px;text-align:center;",
    spin: "display:inline-block;width:30px;height:30px;border-radius:50%;border:3px solid #d7e8e4;border-top-color:" + TEAL + ";animation:rdcSpin .8s linear infinite;",
    heard: "background:#eef7f4;border:1px solid #cfe6df;border-radius:11px;padding:13px 15px;margin:0 0 16px;text-align:left;",
    area: "width:100%;padding:11px 12px;border:1px solid #d7dee8;border-radius:9px;font-size:15px;font-family:inherit;line-height:1.45;box-sizing:border-box;resize:vertical;min-height:74px;",
    inp: "width:100%;padding:11px 13px;border:1px solid #d7dee8;border-radius:10px;font-size:15px;box-sizing:border-box;",
    row: "display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;",
    chips: "display:flex;gap:9px;flex-wrap:wrap;margin-bottom:16px;",
    chip: "border:1px solid #d7dee8;background:#fff;color:#33475f;border-radius:999px;padding:9px 15px;font-size:13px;cursor:pointer;",
    chipNo: "border:1px solid #edf1f5;background:#fbfcfd;color:#c2cbd6;border-radius:999px;padding:8px 13px;font-size:13.5px;margin:0 7px 8px 0;font-family:inherit;cursor:default;",
    chipOn: "border:1px solid " + NAVY + ";background:" + NAVY + ";color:#fff;border-radius:999px;padding:9px 15px;font-size:13px;cursor:pointer;",
    btn: "background:" + NAVY + ";color:#fff;border:0;border-radius:11px;padding:15px 26px;font-size:16px;font-weight:700;cursor:pointer;width:100%;max-width:360px;display:block;margin:0 auto;",
    // 🔴 at-v17: display AND visibility CARRY !important, AND THAT IS THE
    // WHOLE BUG. "Create my free account" - the one conversion on this
    // page - was in the DOM, correctly styled, with a working href, and
    // COMPUTED display:none. An inline style normally wins, but it loses
    // to a stylesheet rule marked !important, and BD has one hiding bare
    // anchors in this content area. So the button existed and nobody
    // could see it or click it.
    // ⚠️ THE LESSON FOR ANYTHING INJECTED INTO A HOST PAGE: inline is not
    // the top of the cascade. On a surface whose CSS you do not control,
    // the properties that decide whether a thing EXISTS on screen -
    // display, visibility - need !important. Same family as the button
    // type trap: you do not own the document you are rendering into.
    btnGo: "background:" + TEAL + ";color:#fff;border:0;border-radius:11px;padding:14px 26px;font-size:16px;font-weight:700;cursor:pointer;width:100%;text-decoration:none;text-align:center;box-sizing:border-box;display:block !important;visibility:visible !important;",
    wallWrap: "text-align:center;padding:8px 4px;max-width:560px;margin:0 auto;",
    wallH: "margin:0 0 10px;font-size:21px;font-weight:800;color:" + NAVY + ";",
    wallP: "margin:0 0 20px;font-size:15px;color:#5b6b82;line-height:1.55;",
    recap: "background:#f7f9fc;border:1px solid #e3e8ef;border-radius:12px;padding:14px 16px;margin:0 auto 20px;max-width:520px;text-align:left;",
    recapLine: "font-size:14px;color:" + NAVY + ";margin:0 0 4px;",
    recapMuted: "font-size:13px;color:#5b6b82;margin:0;",
    back: "background:none;border:0;color:#5b6b82;font-size:13px;cursor:pointer;text-decoration:underline;margin-top:14px;",
    head: "max-width:920px;margin:0 auto 28px;text-align:center;",
    bigInp: "width:100%;padding:18px 18px;border:1px solid #d7dee8;border-radius:13px;font-size:17px;box-sizing:border-box;",
    addLink: "background:none;border:0;color:" + TEAL + ";font-size:14px;font-weight:600;cursor:pointer;padding:8px 0;text-decoration:none;display:inline-flex;align-items:center;gap:6px;",
    panel: "border-top:1px solid #eef1f5;margin-top:8px;padding-top:22px;",
    title: "margin:0 0 10px;font-size:clamp(26px,4vw,36px);font-weight:800;color:" + NAVY + ";letter-spacing:-.5px;line-height:1.1;",
    concept: "margin:0 auto;max-width:560px;font-size:clamp(15px,2vw,17px);color:#5b6b82;line-height:1.5;",
    err: "color:#b3261e;font-size:13px;margin-top:10px;min-height:16px;",
    mic: "background:#fff;color:" + TEAL + ";border:2px solid " + TEAL + ";border-radius:11px;padding:13px 22px;font-size:15px;font-weight:700;cursor:pointer;width:100%;max-width:360px;display:block;margin:0 auto;",
    // at-v16. THREE LEVELS, NOT ONE. On the voice screen every control was
    // a white button, so "Stop and use this" and "Type it instead" looked
    // identical - and so did "Start over" and "Use this" on the next
    // state. Two buttons of equal weight sitting side by side is the
    // interface refusing to say which one is the point.
    // Primary = the thing to do. Ghost = the alternative. Link = the way
    // out. Stop is RED because it ends a recording and matches the pulse.
    // Stop is the primary action while recording, but it is not a
    // destructive one - it USES what was said. Teal, matching the mic
    // button it replaces, so the screen does not change temperature just
    // because the microphone is on.
    stop: "background:" + TEAL + ";color:#fff;border:2px solid " + TEAL + ";border-radius:11px;padding:13px 22px;font-size:15px;font-weight:700;cursor:pointer;",
    quiet: "background:none;color:#5b6b82;border:0;border-radius:0;padding:13px 6px;font-size:14px;font-weight:600;cursor:pointer;text-decoration:underline;",
    ghost: "background:#fff;color:" + NAVY + ";border:1px solid #d7dee8;border-radius:11px;padding:13px 22px;font-size:15px;font-weight:700;cursor:pointer;",
    live: "background:#f7f9fc;border:1px solid #e3e8ef;border-radius:12px;padding:16px;min-height:90px;font-size:16px;color:" + NAVY + ";line-height:1.5;margin:0 0 16px;text-align:left;",
    vstatus: "font-size:13px;color:#5b6b82;margin:0 0 14px;min-height:16px;",
    // at-v15. LISTENING HAS TO LOOK LIKE LISTENING. It read as grey 13px
    // body text - the same weight as every other hint on the page - so
    // the one moment where the visitor needs to know the microphone is
    // ACTUALLY ON was the quietest thing on screen. Red, a pulsing dot,
    // and the transcript box lights up with it.
    // at-v20. ONE RED THING, NOT THREE. at-v15 made recording obvious by
    // turning the status text red, the box red and the stop button red at
    // once - and three reds together read as an ERROR, not an activity.
    // A visitor mid-sentence should not wonder whether something broke.
    // THE DOT CARRIES THE SIGNAL. It is the only red left, it pulses, and
    // a single moving element is more legible than three static ones.
    // Everything else stays calm: dark text, a neutral box with a teal
    // edge, and a teal-bordered stop that matches the mic it replaces.
    vlive: "display:inline-flex;align-items:center;gap:8px;font-size:13.5px;font-weight:700;color:" + NAVY + ";margin:0 0 14px;min-height:16px;",
    dot: "width:9px;height:9px;border-radius:50%;background:#d94436;display:inline-block;box-shadow:0 0 0 0 rgba(217,68,54,.5);animation:rdcPulse 1.6s infinite;",
    liveOn: "background:#f7fbfa;border:2px solid " + TEAL + ";border-radius:12px;padding:16px;min-height:90px;font-size:16px;color:" + NAVY + ";line-height:1.5;margin:0 0 16px;text-align:left;"
  };

  var wants = [];
  var musts = [];
  var MUST_CAP = 3;
  var voice = { active: false, transcript: "", interim: "", status: "", rec: null };
  var seed = { rent_max:"", beds_min:"", baths_min:"", move_in_by:"", where:"", wants:null, musts:null, notes:"", heard:"" };
  var seededFromVoice = false;
  var inlineRec = false;
  var filtersOpen = false;
  var VIEW = "form";  // "form" | "voice"

  function speechOK() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }

  function money(n) { return "$" + String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ","); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function val(id) { var el = document.getElementById(id); return el ? el.value : ""; }

  // at-v14: NUMBERS CANNOT GO NEGATIVE. min="0" stops the spinner, and
  // this CLEARS a typed or pasted negative so it is visibly rejected
  // rather than quietly discarded further down. Minus one bedroom is not
  // a search, and a visitor who thinks they set a value and did not will
  // never find out on their own.
  function numVal(id) {
    var el = document.getElementById(id);
    if (!el || el.value === "") return "";
    var n = Number(el.value);
    if (!isFinite(n) || n < 0) { el.value = ""; return ""; }
    return el.value;
  }
  // Snapshot whatever is on screen into seed, so any re-render restores
  // it. Called on the way to the voice view and before the wall.
  function captureIntoSeed() {
    var f = readForm();
    seed.rent_max = f.rent_max;
    seed.beds_min = f.beds_min;
    seed.baths_min = f.baths_min;
    seed.move_in_by = f.move_in_by;
    seed.where = f.where;
    seed.notes = f.notes;
    seed.wants = wants.slice();
    seed.musts = musts.slice();
  }

  function readForm() {
    return {
      rent_max: numVal("rt-rent"),
      beds_min: numVal("rt-beds"),
      baths_min: numVal("rt-baths"),
      move_in_by: val("rt-move"),
      where: String(val("rt-where")).trim(),
      wants: wants.slice(),
      musts: musts.slice(),
      notes: String(val("rt-notes")).trim()
    };
  }

  function renderForm() {
    if (Array.isArray(seed.wants)) { wants = seed.wants.slice(); }
    if (Array.isArray(seed.musts)) { musts = seed.musts.slice(); }

    // Filters open automatically if voice pre-filled a hidden field, so the
    // renter can see what we heard. Otherwise they start hidden.
    var seededHidden = seededFromVoice && (seed.rent_max || seed.beds_min || seed.baths_min || seed.move_in_by || (Array.isArray(seed.wants) && seed.wants.length) || (Array.isArray(seed.musts) && seed.musts.length) || seed.notes);
    if (seededHidden) filtersOpen = true;

    mount.innerHTML =
      '<div style="' + S.head + '">' +
        '<h2 style="' + S.title + '">Dream up your perfect spot</h2>' +
        '<p style="' + S.concept + '">Type it or say it. When a verified home matches, we email you. No matches, no email.</p>' +
      '</div>' +
      '<div style="' + S.card + '">' +
        // at-v18: WHAT WE HEARD, AT THE TOP. On the voice screen the
        // transcript sits above everything; coming back to the form it
        // used to be buried at the bottom inside the notes box, so the
        // thing they just said was the hardest thing to find. Same place,
        // same prominence, either side of the transition.
        (seed.heard
          ? '<div style="' + S.heard + '">' +
              '<p style="font-size:12.5px;font-weight:700;color:#1f6b5e;margin:0 0 6px;">Here is what we heard</p>' +
              '<p style="font-size:14px;color:#2c4f49;margin:0;line-height:1.5;">' + esc(seed.heard) + '</p>' +
            '</div>'
          : "") +
        '<div style="margin-bottom:10px;"><input id="rt-where" placeholder="Where do you want to live? City or ZIP" value="' + esc(seed.where) + '" style="' + S.bigInp + '"></div>' +
        '<div style="text-align:center;margin-bottom:22px;">' +
          '<button id="rt-toggle" type="button" style="' + S.addLink + '">' + (filtersOpen ? "Hide filters" : "Add filters (rent, beds, more)") + '</button>' +
        '</div>' +
        '<div id="rt-filters" style="display:' + (filtersOpen ? "block" : "none") + ';">' +
          '<div style="' + S.panel + '">' +
            '<div style="' + S.row + '">' +
              '<div style="flex:2;min-width:130px;"><span style="' + S.lab + '">Max rent</span>' +
                '<input id="rt-rent" type="number" min="0" step="10" inputmode="numeric" placeholder="2200" value="' + esc(seed.rent_max) + '" style="' + S.inp + '"></div>' +
              '<div style="flex:1;min-width:80px;"><span style="' + S.lab + '">Beds</span>' +
                '<input id="rt-beds" type="number" min="0" step="1" inputmode="numeric" placeholder="2" value="' + esc(seed.beds_min) + '" style="' + S.inp + '"></div>' +
              '<div style="flex:1;min-width:80px;"><span style="' + S.lab + '">Baths</span>' +
                '<input id="rt-baths" type="number" min="0" step="1" inputmode="numeric" placeholder="1" value="' + esc(seed.baths_min) + '" style="' + S.inp + '"></div>' +
            '</div>' +
            '<div style="margin-bottom:16px;"><span style="' + S.lab + '">Move in by</span>' +
              '<input id="rt-move" type="date" value="' + esc(seed.move_in_by) + '" style="' + S.inp + '"></div>' +
            // at-v14: TWO ROWS, matching the dashboard. A must-have and a
            // nice-to-have are not the same promise: a must-have REMOVES
            // listings that lack it, a nice-to-have only ranks them. One
            // undifferentiated row meant a visitor tapping five things
            // could not tell whether they had widened their search or
            // narrowed it to nothing - and aclaim-v2 was filing every
            // teaser chip as nice_to_have precisely because it could not
            // know which they meant. Now they say.
            '<span style="' + S.lab + '">Must have</span>' +
            '<span style="' + S.hint + 'text-align:left;margin:0 0 6px;display:block;">At most 3. Only things you would turn a place down over.</span>' +
            '<div id="rt-must" style="' + S.chips + '"></div>' +
            '<span style="' + S.lab + '">Nice to have</span>' +
            '<span style="' + S.hint + 'text-align:left;margin:0 0 6px;display:block;">Good to have, but not a deal breaker.</span>' +
            '<div id="rt-chips" style="' + S.chips + '"></div>' +
            '<div style="margin-bottom:4px;"><span style="' + S.lab + '">Anything else that matters?</span>' +
              // at-v12: A TEXTAREA, NOT AN INPUT. This is the field voice
              // fills with a whole paragraph, and in a single-line input
              // the text ran off the right edge with no way to read it
              // back. 400 chars now, matching what the claim stores.
              '<textarea id="rt-notes" maxlength="400" rows="3" placeholder="Quiet street, close to the light rail" style="' + S.area + '">' + esc(seed.notes) + '</textarea></div>' +
          '</div>' +
        '</div>' +
        // at-v13: THE BUTTONS REPORT WHERE THE VISITOR IS. Before voice
        // has run, the mic is an invitation. AFTER it has run, "Describe
        // it out loud" reads like starting over - which is exactly what
        // it used to do - so it becomes "Keep describing out loud", and a
        // line underneath says the form below is theirs to correct. The
        // whole point of at-v12 was that voice adds rather than replaces;
        // the label has to say so or nobody will risk tapping it twice.
        // at-v22: THE MIC OPENS RIGHT HERE. Tapping it used to swap the
        // whole card for the voice screen - a jump to the top of the page,
        // a different heading and an empty transcript box - which read as
        // starting over even though at-v12 made it additive. Recording
        // INLINE keeps every filled field visible while they speak, so
        // "this is being added to what I already have" is something they
        // can SEE rather than something a caption has to promise.
        (voice.busy && inlineRec
          ? '<div style="' + S.busyBox + '">' +
              '<span style="' + S.spin + '"></span>' +
              '<p style="font-size:16px;font-weight:700;color:' + NAVY + ';margin:14px 0 4px;">Adding what you said</p>' +
              '<p style="font-size:13.5px;color:#5b6b82;margin:0;">A couple of seconds.</p>' +
            '</div>'
          : "") +
        (inlineRec && !voice.busy
          ? '<div style="' + S.inlineBox + '">' +
              '<p style="font-size:13px;font-weight:700;color:#1f6b5e;margin:0 0 8px;">Say whatever else matters. We will add it to what is above.</p>' +
              '<div id="rt-inline-live" style="' + (voice.active ? S.liveOn : S.live) + '">' +
                (esc(voice.transcript + voice.interim) || '<span style="color:#9aa8b8;">Your words will show up here.</span>') +
              '</div>' +
              '<div id="rt-inline-status" style="' + (voice.active ? S.vlive : S.vstatus) + '">' +
                (voice.active ? '<span style="' + S.dot + '"></span>' + esc(voice.status || "Listening") : esc(voice.status || "")) +
              '</div>' +
              // 🔴 at-v23: A WAY TO SUBMIT WHEN THE RECOGNISER STOPS ITSELF.
              // On mobile, speech recognition ENDS ON A PAUSE - that is
              // normal behaviour, not a fault. at-v22 only offered "Stop and
              // add this" while it was still running, so the moment iOS or
              // Android ended the session on its own the panel showed
              // "Start talking" and "Never mind" and NOTHING to use what had
              // just been said. A whole spoken description with no way out
              // of it. Desktop hid the bug because there the renter really
              // does tap Stop.
              '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">' +
                (!voice.active && voice.transcript
                  ? '<button id="rt-inline-use" type="button" style="' + S.btn + 'width:auto;">Add this</button>' +
                    '<button id="rt-inline-rec" type="button" style="' + S.ghost + '">Say more</button>'
                  : '<button id="rt-inline-rec" type="button" style="' + S.stop + '">' +
                      (voice.active ? "Stop and add this" : "Start talking") + '</button>') +
                '<button id="rt-inline-cancel" type="button" style="' + S.quiet + '">Never mind</button>' +
              '</div>' +
              (!voice.active && voice.transcript
                ? '<p style="' + S.hint + 'text-align:left;margin:8px 0 0;">Tap Add this when you are done, or Say more to keep going.</p>'
                : "") +
            '</div>'
          : "") +
        (speechOK() && !inlineRec
          ? '<button id="rt-voice" type="button" style="' + S.mic + '">🎙 ' +
              (seededFromVoice ? "Keep describing out loud" : "Describe it out loud") + '</button>' +
            (seededFromVoice
              ? '<p style="' + S.hint + '">We filled in what we heard. Say more, or fix anything above by typing, then submit.</p>'
              : '') +
            '<div style="height:12px;"></div>'
          : "") +
        '<button id="rt-go" style="' + S.btn + '">' +
          (seededFromVoice ? "This is my perfect spot" : "Notify me when this matches") + '</button>' +
        '<div id="rt-err" style="' + S.err + 'text-align:center;"></div>' +
      '</div>';

    // Chips only need building when the panel is visible.
    // One builder, two rows. A key can only be in ONE of them - tapping it
    // as a must-have removes it from nice-to-have and the other way round,
    // because a thing cannot be both a deal breaker and a bonus. The
    // dashboard enforces the same rule.
    function buildChipRow(mountId, list, other, cap, redraw) {
      var chipMount = document.getElementById(mountId);
      if (!chipMount) return;
      chipMount.innerHTML = "";
      CHIPS.forEach(function (c) {
        var key = c[0];
        var on = list.indexOf(key) !== -1;
        var blocked = !on && ((cap && list.length >= cap) || other.indexOf(key) !== -1);
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = c[1];
        b.style.cssText = on ? S.chipOn : (blocked ? S.chipNo : S.chip);
        if (blocked && other.indexOf(key) !== -1) b.title = "Already chosen in the other list";
        else if (blocked) b.title = "Pick at most " + cap;
        if (!blocked) {
          b.onclick = function () {
            var i = list.indexOf(key);
            if (i === -1) list.push(key); else list.splice(i, 1);
            redraw();
          };
        }
        chipMount.appendChild(b);
      });
    }

    function drawChips() {
      buildChipRow("rt-must", musts, wants, MUST_CAP, drawChips);
      buildChipRow("rt-chips", wants, musts, 0, drawChips);
    }

    if (filtersOpen) drawChips();

    document.getElementById("rt-toggle").onclick = function () {
      filtersOpen = !filtersOpen;
      var panel = document.getElementById("rt-filters");
      var tog = document.getElementById("rt-toggle");
      panel.style.display = filtersOpen ? "block" : "none";
      tog.textContent = filtersOpen ? "Hide filters" : "Add filters (rent, beds, more)";
      if (filtersOpen) buildChips();
    };

    document.getElementById("rt-go").onclick = submit;

    var iu = document.getElementById("rt-inline-use");
    if (iu) iu.onclick = function () {
      var text = String(voice.transcript || "").trim();
      if (text.length < 12) {
        voice.status = "A little more detail and we can work with it.";
        paint();
        return;
      }
      extractVoice(text);
    };

    var ir = document.getElementById("rt-inline-rec");
    if (ir) ir.onclick = function () {
      if (voice.active) {
        stopRec();
        var text = String(voice.transcript || "").trim();
        if (text.length < 12) {
          voice.status = "A little more detail and we can work with it.";
          paint();
          return;
        }
        extractVoice(text);
        return;
      }
      // "Say more" keeps what is already there. startRec() clears the
      // transcript, so carry it across and hand the joined text to the
      // extractor at the end.
      var carried = String(voice.transcript || "").trim();
      startRec();
      if (carried) voice.transcript = carried + " ";
      paint();
    };

    var ic = document.getElementById("rt-inline-cancel");
    if (ic) ic.onclick = function () {
      stopRec();
      inlineRec = false;
      captureIntoSeed();
      renderForm();
    };

    var vb = document.getElementById("rt-voice");
    if (vb) vb.onclick = function () {
      // 🔴 at-v12: READ THE FORM FIRST. Leaving for the voice view used to
      // jump straight to renderVoice(), and coming back rebuilt the form
      // from seed - which was EMPTY unless voice had filled it. So a
      // visitor who typed a rent, beds, baths, a chip and a note, then
      // tapped Describe it out loud, watched all of it vanish.
      // Voice is meant to ADD to what is there, never replace it.
      captureIntoSeed();
      voice = { active:false, busy:false, transcript:"", interim:"", status:"", rec:null };

      // Something already filled in? Record HERE, in place, so it is
      // visibly an addition. Nothing yet? The full voice screen is the
      // better first impression and there is nothing on screen to lose.
      if (haveAnything()) {
        inlineRec = true;
        renderForm();
        startRec();
        return;
      }

      VIEW = "voice";
      renderVoice();
    };
  }

  // What the visitor has given us so far, in their terms. Used to prove
  // on the voice screen that nothing is being thrown away.
  function haveAnything() {
    return !!(seed.where || seed.rent_max || seed.beds_min || seed.baths_min ||
      seed.notes || (seed.musts || []).length || (seed.wants || []).length);
  }

  function soFar() {
    var bits = [];
    if (seed.where) bits.push(seed.where);
    if (seed.rent_max) bits.push("up to " + money(seed.rent_max));
    if (seed.beds_min) bits.push(seed.beds_min + "+ beds");
    if (seed.baths_min) bits.push(seed.baths_min + "+ baths");
    var m = (seed.musts || []).length;
    var w = (seed.wants || []).length;
    if (m) bits.push(m + " must have" + (m === 1 ? "" : "s"));
    if (w) bits.push(w + " nice to have" + (w === 1 ? "" : "s"));
    return bits.join("  \u00b7  ");
  }

  // at-v22: ONE PAINTER. The mic can now run INSIDE the form as well as
  // on its own screen, so everything that used to call renderVoice()
  // directly has to draw whichever surface is actually showing.
  // While recording inline, only the transcript line is touched - a full
  // renderForm() on every interim result would rebuild the inputs
  // underneath the renter and steal focus from anything they were typing.
  function paint() {
    if (VIEW === "form" && inlineRec) {
      var box = document.getElementById("rt-inline-live");
      if (box) {
        var txt = voice.transcript + voice.interim;
        box.innerHTML = txt
          ? esc(txt)
          : '<span style="color:#9aa8b8;">Your words will show up here.</span>';
        box.style.cssText = voice.active ? S.liveOn : S.live;
      }
      var st = document.getElementById("rt-inline-status");
      if (st) {
        st.style.cssText = voice.active ? S.vlive : S.vstatus;
        st.innerHTML = voice.active
          ? '<span style="' + S.dot + '"></span>' + esc(voice.status || "Listening")
          : esc(voice.status || "");
      }
      // The button SET changes when recording stops - "Add this" and "Say
      // more" appear - so a partial repaint is not enough at that moment.
      // Only the interim text is cheap to patch; a state change needs the
      // full form back.
      var rb = document.getElementById("rt-inline-rec");
      var wantsFull = (!voice.active && voice.transcript && !document.getElementById("rt-inline-use"));
      if (!box || wantsFull) { renderForm(); return; }
      if (rb && voice.active) rb.textContent = "Stop and add this";
      return;
    }
    if (VIEW === "form") { renderForm(); return; }
    renderVoice();
  }

  // ---------------- VOICE VIEW ----------------
  function renderVoice() {
    mount.innerHTML =
      '<div style="' + S.head + '">' +
        // at-v18: RETURNING TO VOICE MUST NOT LOOK LIKE STARTING OVER.
        // "Keep describing out loud" opened onto an empty transcript box
        // and a Start talking button - identical to the first visit - so
        // even though at-v12 made voice ADD rather than replace, the
        // screen said otherwise and nobody would believe it. The heading
        // changes, and a line lists what is already held.
        '<h2 style="' + S.title + '">' + (haveAnything() ? "Add to your perfect spot" : "Describe your ideal place") + '</h2>' +
        '<p style="' + S.concept + '">' + (haveAnything()
          ? "Everything you have already given us is kept. Say whatever else matters and we will add it in."
          : "Talk the way you would tell a friend. Where you want to live, your budget, beds, pets, anything that matters. We turn it into a search you can tweak.") + '</p>' +
      '</div>' +
      (haveAnything()
        ? '<div style="' + S.card + 'padding:14px 18px;margin-bottom:14px;">' +
            '<p style="font-size:12.5px;font-weight:700;color:#1f6b5e;margin:0 0 4px;">Already saved</p>' +
            '<p style="font-size:14px;color:#2c4f49;margin:0;line-height:1.5;">' + esc(soFar()) + '</p>' +
          '</div>'
        : "") +
      '<div style="' + S.card + '">' +
        // at-v21: WAITING NEEDS ITS OWN SCREEN. "Working out what you
        // need." was one line of grey 13px text under an unchanged
        // transcript box, so the two or three seconds of extraction looked
        // exactly like nothing happening - and somebody who thinks nothing
        // is happening taps the button again or leaves.
        // A spinner, the sentence at real size, and the buttons removed so
        // there is nothing to press by mistake while it runs.
        (voice.busy
          ? '<div style="' + S.busyBox + '">' +
              '<span style="' + S.spin + '"></span>' +
              '<p style="font-size:16px;font-weight:700;color:' + NAVY + ';margin:14px 0 4px;">Working out what you need</p>' +
              '<p style="font-size:13.5px;color:#5b6b82;margin:0;">A couple of seconds. We are turning what you said into a perfect spot.</p>' +
            '</div>'
          : '<div id="rt-live" style="' + (voice.active ? S.liveOn : S.live) + '">' + (esc(voice.transcript + voice.interim) || '<span style="color:#9aa8b8;">Your words will show up here.</span>') + '</div>') +
        (voice.busy
          ? ""
          : (voice.active
            ? '<div id="rt-vstatus" style="' + S.vlive + '">' +
                '<span style="' + S.dot + '"></span>' + esc(voice.status || "Listening") + '</div>'
            : '<div id="rt-vstatus" style="' + S.vstatus + '">' + esc(voice.status) + '</div>')) +
        (voice.busy ? "" : '<div style="display:flex;gap:10px;flex-wrap:wrap;">') +
          // WHILE RECORDING: stop is the only thing to do, and it is red.
          // AFTER RECORDING: "Use this" is the point and takes the primary;
          // "Start over" drops to ghost because it throws work away.
          (voice.busy ? "" : '<button id="rt-rec" type="button" style="' +
            (voice.active ? S.stop : (voice.transcript ? S.ghost : S.mic)) + '">' +
            (voice.active
              ? "Stop and use this"
              : (voice.transcript ? "Say more" : "Start talking")) + '</button>') +
          (voice.busy ? "" : (voice.transcript && !voice.active ? '<button id="rt-use" type="button" style="' + S.btn + 'width:auto;">Use this</button>' : "")) +
          (voice.busy ? "" :
            '<button id="rt-back" type="button" style="' + S.quiet + '">' +
              (voice.transcript ? "Type the rest instead" : "Type it instead") + '</button>') +
        (voice.busy ? "" : '</div>') +
        '<div id="rt-note" style="' + S.err + '"></div>' +
      '</div>';

    var backEl = document.getElementById("rt-back");
    if (backEl) backEl.onclick = function () {
      stopRec();
      // 🔴 at-v16: THIS WAS DISCARDING THE TRANSCRIPT. Someone who had
      // talked for thirty seconds and then decided to finish by typing
      // was dropped back at an empty form with every word gone. "Type it
      // instead" means TYPE THE REST - it is a change of input method,
      // not an abandonment.
      // Enough words to work with: run the same extraction "Use this"
      // runs, so they land in a form already filled. Too few: just go
      // back, since there is nothing to lose.
      var text = String(voice.transcript || "").trim();
      if (text.length >= 12) { extractVoice(text); return; }
      VIEW = "form";
      renderForm();
    };

    var rec = document.getElementById("rt-rec");
    if (rec) rec.onclick = function () {
      if (voice.active) { stopRec(); paint(); return; }
      if (voice.transcript && !voice.active) { voice.transcript = ""; voice.interim = ""; }
      startRec();
    };

    var use = document.getElementById("rt-use");
    if (use) use.onclick = function () {
      stopRec();
      var text = String(voice.transcript || "").trim();
      if (text.length < 12) { voice.status = "A little more detail and we can work with it."; paint(); return; }
      extractVoice(text);
    };
  }

  function startRec() {
    var Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    var r;
    try { r = new Ctor(); } catch (e) { voice.status = "We could not start the microphone. Type it instead."; paint(); return; }
    r.continuous = true; r.interimResults = true; r.lang = "en-US";
    voice.transcript = ""; voice.interim = ""; voice.status = "Listening. Take your time."; voice.active = true; voice.rec = r;
    r.onresult = function (ev) {
      var interim = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) voice.transcript += t; else interim += t;
      }
      voice.interim = interim;
      // Touch only the live line. Whichever surface is showing.
      var live = document.getElementById("rt-live") || document.getElementById("rt-inline-live");
      if (live) live.textContent = voice.transcript + voice.interim;
    };
    r.onerror = function (ev) {
      voice.active = false;
      voice.status = (ev && ev.error === "not-allowed")
        ? "Microphone permission was declined. Type it instead."
        : "The microphone stopped. Try again or type it instead.";
      paint();
    };
    r.onend = function () {
      if (!voice.active) return;
      // 🔴 THE RECOGNISER ENDING IS NOT THE RENTER FINISHING. On mobile it
      // stops on a pause. Say so, rather than leaving a silent panel that
      // looks like it is still listening or already done.
      voice.active = false;
      voice.interim = "";
      if (String(voice.transcript || "").trim().length >= 12) {
        voice.status = "Got that. Tap Add this, or Say more to keep going.";
      } else if (!voice.transcript) {
        voice.status = "We did not catch anything. Try again, or type it instead.";
      }
      paint();
    };
    try { r.start(); } catch (e) { voice.active = false; voice.status = "We could not start the microphone. Type it instead."; }
    paint();
  }

  function stopRec() {
    voice.active = false;
    if (voice.rec) { try { voice.rec.stop(); } catch (e) {} }
  }

  // Send transcript to the SAME backend the dashboard uses (av-v1).
  // memberId is omitted; av-v1 rate-limits by IP when it is absent.
  function extractVoice(transcript) {
    // at-v21: a real waiting state, not a line of grey text.
    voice.busy = true;
    voice.status = "Working out what you need.";
    // Inline recording gets the busy panel too, so the form does not just
    // sit there looking finished while the extraction runs.
    if (VIEW === "form" && inlineRec) renderForm(); else renderVoice();

    fetch(VOICE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript: transcript })
    }).then(function (r) { return r.json(); }).then(function (d) {
      voice.busy = false;
      inlineRec = false;
      applyExtraction(d, transcript);
    }).catch(function (e) {
      voice.busy = false;
      inlineRec = false;
      console.error("[Renters teaser] voice call failed", e);
      // Keep their words: drop to the form with the transcript in notes.
      seedFormFromVoice({}, transcript);
      VIEW = "form"; renderForm();
      var n = document.getElementById("rt-note");
      if (n) { n.style.color = "#a07c1c"; n.textContent = "We could not reach the voice service, so your words are in the notes. Fill in what you can."; }
    });
  }

  // av-v1 returns the RICHER v3 schema. Map what lines up onto the teaser's
  // simple fields; always keep the transcript in notes so nothing is lost.
  function applyExtraction(d, transcript) {
    if (!d || !d.extracted) {
      console.log("[Renters teaser] extraction unavailable", d);
      seedFormFromVoice({}, transcript);
      VIEW = "form"; renderForm();
      var n0 = document.getElementById("rt-note");
      if (n0) { n0.style.color = "#a07c1c"; n0.textContent = "We could not break that down automatically, so your words are in the notes. Fill in what you can."; }
      return;
    }
    seedFormFromVoice(d.criteria || {}, d.transcript_full || transcript, d.heard);
    VIEW = "form"; renderForm();
    if (d.heard) {
      var n1 = document.getElementById("rt-note");
      if (n1) { n1.style.color = "#1a7f52"; n1.textContent = "Here is what we heard: " + d.heard + "  Check it and add anything missing."; }
    }
  }

  // Pull a place name out of the spoken transcript, since av-v1 is told to
  // ignore location. Looks for "in <Place>", "near <Place>", "around
  // <Place>", or a bare City, ST / City, State. Conservative: returns "" if
  // it is not reasonably sure, so we never put a wrong city in the box.
  function locationFromTranscript(t) {
    if (!t) return "";
    var raw = "";
    { var _t = "" + t, _cc, _i;
      for (_i = 0; _i < _t.length; _i++) { _cc = _t.charCodeAt(_i);
        raw += (_cc === 10 || _cc === 13 || _cc === 9) ? " " : _t.charAt(_i); } }
    raw = raw.replace(/  +/g, " ").trim();
    if (!raw) return "";
    var s = " " + raw + " ";

    var STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];
    var STATEWORDS = {"alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA","colorado":"CO","connecticut":"CT","delaware":"DE","florida":"FL","georgia":"GA","hawaii":"HI","idaho":"ID","illinois":"IL","indiana":"IN","iowa":"IA","kansas":"KS","kentucky":"KY","louisiana":"LA","maine":"ME","maryland":"MD","massachusetts":"MA","michigan":"MI","minnesota":"MN","mississippi":"MS","missouri":"MO","montana":"MT","nebraska":"NE","nevada":"NV","ohio":"OH","oklahoma":"OK","oregon":"OR","pennsylvania":"PA","tennessee":"TN","texas":"TX","utah":"UT","vermont":"VT","virginia":"VA","washington":"WA","wisconsin":"WY","wyoming":"WY"};
    var STOP = {"i":1,"we":1,"my":1,"the":1,"a":1,"an":1,"it":1,"hey":1,"hi":1,"so":1,"can":1,"you":1,"looking":1,"want":1,"need":1,"me":1,"for":1,"with":1,"and":1,"under":1,"about":1};

    var words = s.split(" ");
    var i, w, lw;

    // Pass 1: a capitalised word (or two) immediately followed by a state
    // word or 2-letter state -> "City, ST".
    for (i = 0; i < words.length; i++) {
      w = words[i]; if (!w) continue;
      lw = w.toLowerCase().replace(/[^a-z]/g, "");
      var st = "";
      if (STATEWORDS[lw]) st = STATEWORDS[lw];
      else if (w.length === 2 && STATES.indexOf(w.toUpperCase()) !== -1) st = w.toUpperCase();
      if (st) {
        // walk back over up to 2 capitalised, non-stop words for the city
        var city = [];
        var k = i - 1;
        while (k >= 0 && city.length < 2) {
          var pw = words[k].replace(/[.,]/g, "");
          if (!pw) break;
          var first = pw.charAt(0);
          var isCap = first >= "A" && first <= "Z";
          if (isCap && !STOP[pw.toLowerCase()]) { city.unshift(pw); k--; }
          else break;
        }
        if (city.length) return city.join(" ") + ", " + st;
      }
    }

    // Pass 2: after in/near/around/by/to/within, take up to 2 capitalised
    // non-stop words.
    var PREP = {"in":1,"near":1,"around":1,"by":1,"to":1,"within":1};
    for (i = 0; i < words.length - 1; i++) {
      lw = words[i].toLowerCase().replace(/[^a-z]/g, "");
      if (!PREP[lw]) continue;
      var got = [];
      var m = i + 1;
      while (m < words.length && got.length < 2) {
        var cand = words[m].replace(/[.,]/g, "");
        if (!cand) break;
        var c0 = cand.charAt(0);
        if (c0 >= "A" && c0 <= "Z" && !STOP[cand.toLowerCase()]) { got.push(cand); m++; }
        else break;
      }
      if (got.length) return got.join(" ");
    }

    // Pass 3: a 5-digit ZIP.
    for (i = 0; i < words.length; i++) {
      var d = words[i].replace(/[^0-9]/g, "");
      if (d.length === 5 && words[i].replace(/[0-9]/g, "").length <= 1) return d;
    }

    return "";
  }

  // Map the rich schema down to the teaser fields.
  function seedFormFromVoice(c, transcript, heard) {
    c = c || {};
    // rent
    if (c.rent_max) seed.rent_max = c.rent_max;
    // beds: rich schema returns an array like ["2","3"]; take the smallest as beds_min
    if (Array.isArray(c.beds) && c.beds.length) {
      var nums = c.beds.map(function (b) { return parseInt(b, 10); }).filter(function (n) { return !isNaN(n); });
      if (nums.length) seed.beds_min = Math.min.apply(null, nums);
    } else if (c.beds_min != null) { seed.beds_min = c.beds_min; }
    if (c.baths_min != null) seed.baths_min = c.baths_min;
    // move-in: rich schema has earliest/latest; teaser has one date. Use latest.
    if (c.move_in_latest) seed.move_in_by = c.move_in_latest;
    else if (c.move_in_by) seed.move_in_by = c.move_in_by;
    // location is not in the schema (renter says it in words) - leave for them
    // chips: combine must_have + nice_to_have, keep only ones the teaser shows
    // at-v14: the voice backend already separates must_have from
    // nice_to_have, and now the teaser has somewhere to put each. Routing
    // them all into one bucket threw that away.
    function known(k) {
      for (var i = 0; i < CHIPS.length; i++) if (CHIPS[i][0] === k) return true;
      return false;
    }
    var spokenMusts = (c.must_have || []).filter(known);
    var existingMusts = Array.isArray(seed.musts) ? seed.musts.slice() : [];
    spokenMusts.forEach(function (k) {
      if (existingMusts.indexOf(k) === -1 && existingMusts.length < MUST_CAP) existingMusts.push(k);
    });
    seed.musts = existingMusts;

    var picked = [];
    [].concat(c.nice_to_have || [], c.wants || []).forEach(function (k) {
      if (known(k) && picked.indexOf(k) === -1 && existingMusts.indexOf(k) === -1) picked.push(k);
    });
    // MERGE, not replace. A chip the visitor tapped before talking is
    // still true afterwards - the transcript simply did not mention it.
    var existingWants = Array.isArray(seed.wants) ? seed.wants.slice() : [];
    picked.forEach(function (k) { if (existingWants.indexOf(k) === -1) existingWants.push(k); });
    seed.wants = existingWants;
    // notes: preserve the transcript, plus any model notes
    // Anything they had already typed stays at the front. Their own words
    // are worth more than the transcript, and overwriting them is the
    // same mistake as clearing the form.
    // at-v18: THE RAW TRANSCRIPT NO LONGER GOES INTO NOTES. It was being
    // appended there, so the notes box filled with a wall of text that
    // duplicated fields already captured and truncated mid-word at 400
    // characters. The transcript is kept separately and SHOWN AT THE TOP
    // of the form as "here is what we heard" - which is where the person
    // looks for it, because that is where it sat on the voice screen.
    // Notes stays what the visitor actually wants remembered.
    var noteBits = [];
    if (seed.notes) noteBits.push(seed.notes);
    if (c.notes) noteBits.push(c.notes);
    seed.notes = noteBits.join(" - ").slice(0, 400);
    if (transcript) {
      seed.heard = String(transcript).trim().slice(0, 600);
    }
    // av-v1 ignores place names, so pull location from the transcript here.
    // Prefer an explicit criteria.where if a future schema ever provides one.
    // Only fill the location if it is still empty. A typed place beats a
    // guess pulled out of a transcript.
    var spoken = (c.where && String(c.where).trim())
      ? String(c.where).slice(0, 80)
      : locationFromTranscript(transcript);
    if (!seed.where && spoken) seed.where = spoken;
    seededFromVoice = true;
  }

  function submit() {
    var f = readForm();
    var err = document.getElementById("rt-err");

    var hasSomething = f.rent_max || f.beds_min || f.baths_min || f.move_in_by || f.where || f.notes || f.wants.length || f.musts.length;
    if (!hasSomething) { err.textContent = "Add at least one thing so we know what to look for."; return; }
    if (!f.where) { err.textContent = "Tell us where you want to live so we can match you."; return; }

    var btn = document.getElementById("rt-go");
    btn.disabled = true; btn.textContent = "One moment...";
    err.textContent = "";

    // Stash the search under a random token for claim-after-signup.
    fetch(CLAIM + "?stash=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ search: f })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.token) {
        renderWall(f, d.token);
      } else {
        btn.disabled = false; btn.textContent = "Notify me when this matches";
        err.textContent = "Something went wrong. Try once more.";
        console.error("[Renters teaser] stash failed", d);
      }
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = "Notify me when this matches";
      err.textContent = "Something went wrong. Try once more.";
      console.error("[Renters teaser] stash error", e);
    });
  }

  function recap(f) {
    var bits = [];
    if (f.rent_max) bits.push("Up to " + money(f.rent_max));
    if (f.beds_min) bits.push(f.beds_min + "+ beds");
    if (f.baths_min) bits.push(f.baths_min + "+ baths");
    var line1 = bits.join("  ·  ");
    function label(k) {
      for (var i = 0; i < CHIPS.length; i++) if (CHIPS[i][0] === k) return CHIPS[i][1];
      return k;
    }
    var mustTxt = (f.musts || []).map(label).join(", ");
    var chipTxt = (f.wants || []).map(label).join(", ");

    return '<div style="' + S.recap + '">' +
      '<p style="' + S.recapLine + '"><strong>' + esc(f.where) + '</strong></p>' +
      (line1 ? '<p style="' + S.recapLine + '">' + esc(line1) + '</p>' : "") +
      (mustTxt ? '<p style="' + S.recapMuted + '">Must have: ' + esc(mustTxt) + '</p>' : "") +
      (chipTxt ? '<p style="' + S.recapMuted + '">Nice to have: ' + esc(chipTxt) + '</p>' : "") +
      (f.notes ? '<p style="' + S.recapMuted + '">' + esc(f.notes) + '</p>' : "") +
    '</div>';
  }

  // Scroll so the top of the card sits just below the fixed nav bar, so
  // the title is always visible even when the card is taller than the
  // screen. Guesses the nav height from any fixed/sticky header, defaults
  // to a safe 80px.
  function scrollWallIntoView() {
    try {
      var card = mount.querySelector("div");
      if (!card) return;
      var navH = 80;
      var heads = document.querySelectorAll("header, nav, .navbar, .site-header");
      for (var i = 0; i < heads.length; i++) {
        var cs = window.getComputedStyle(heads[i]);
        if ((cs.position === "fixed" || cs.position === "sticky") && heads[i].offsetHeight) {
          navH = Math.max(navH, heads[i].offsetHeight);
          break;
        }
      }
      var rect = card.getBoundingClientRect();
      var top = rect.top + (window.pageYOffset || document.documentElement.scrollTop || 0);
      var target = top - navH - 12;
      if (target < 0) target = 0;
      if (window.scrollTo) window.scrollTo({ top: target, behavior: "smooth" });
      else if (card.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      try {
        var c2 = mount.querySelector("div");
        if (c2 && c2.scrollIntoView) c2.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (e2) {}
    }
  }

  function renderWall(f, token) {
    // Robust handoff: stash the token same-origin so it survives BD's
    // signup redirects even if the query param is dropped.
    // 🔴 at-v19: localStorage, NOT sessionStorage. THIS IS WHY NO PERFECT
    // SPOT EVER REACHED A NEW ACCOUNT.
    // sessionStorage is PER TAB. BD's signup chain does not reliably keep
    // the visitor in the same tab, and at-v2 already recorded that it
    // drops the ?claim= query param through its redirects - so BOTH
    // handoffs failed and the token was simply gone. Confirmed live on a
    // fresh signup, member #4581: sessionStorage.getItem returned null on
    // the dashboard and the card rendered its empty state.
    // localStorage survives a new tab, a full navigation and a browser
    // restart, and is per ORIGIN rather than per tab. Both are written -
    // sessionStorage costs nothing and the reader may still look there.
    // A timestamp rides along so a stale token cannot claim onto an
    // account somebody creates weeks later on a shared computer; the
    // stash blob expires at 30 days and this matches it.
    try {
      var payload = JSON.stringify({ token: token, at: Date.now() });
      window.localStorage.setItem("renters_claim", payload);
      window.sessionStorage.setItem("renters_claim_token", token);
      window.localStorage.setItem("renters_claim_token", token);
    } catch (e) {}

    var signupReady = SIGNUP_URL.indexOf("SET_ME") === -1;
    var href = signupReady
      ? SIGNUP_URL + (SIGNUP_URL.indexOf("?") === -1 ? "?" : "&") + "claim=" + encodeURIComponent(token)
      : "#";

    mount.innerHTML =
      '<div style="' + S.card + '">' +
        '<div style="' + S.wallWrap + '">' +
          '<h3 style="' + S.wallH + '">Your perfect spot is ready</h3>' +
          '<p style="' + S.wallP + '">Create a free account and the moment a verified home matches what you asked for, we will email you. No matches, no email.</p>' +
          recap(f) +
          (signupReady
            ? '<a href="' + href + '" style="' + S.btnGo + '">Create my free account</a>'
            : '<button style="' + S.btn + '" onclick="alert(\\'Signup URL not set yet. Set SIGNUP_URL in alerts-teaser-js.\\');">Create my free account</button>') +
          '<button id="rt-back" style="' + S.back + '">Edit my spot</button>' +
        '</div>' +
      '</div>';

    // Bring the wall into view. On mobile the page holds its old scroll
    // position after submit, leaving the call to action off-screen.
    try {
      scrollWallIntoView();
    } catch (e) {}

    var backEl = document.getElementById("rt-back");
    if (backEl) backEl.onclick = function () {
      mount.removeAttribute("data-rendered");
      mount.setAttribute("data-rendered", "1");
      renderForm();
      try {
        scrollWallIntoView();
      } catch (e) {}
    };
  }

  renderForm();
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
