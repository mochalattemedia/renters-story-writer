// lw-v19  <-- PASTE CHECK: this is the version. Must match ?version=1
// =====================================================================
// RENTERS.COM - LISTING WIZARD  ·  listing-wizard-js.js
// =====================================================================
// Serves the guided listing wizard that runs alongside BD's form on
// /account/properties/add.
//
// WHY THIS IS A NETLIFY FUNCTION AND NOT HEAD CODE (Bible, v36):
//   BD's head-code field destroys backslashes and mangles quoting. The
//   standing rule is that anything over ~20 lines is served from Netlify
//   and head code carries only a loader stub. Netlify stores this file
//   byte-for-byte. Updating the wizard never touches head code, which
//   also removes it from the head-code version-collision risk entirely.
//
// STAGE: this is "B" - the guiding layer. The human still presses save.
//   Every wizard input mirrors straight through to the real BD field, so
//   by the time the user reaches Review, BD's own form is already filled
//   and the CSRF token has never been touched. That is what makes stage
//   "A" (auto-submit) a small addition later rather than a rewrite.
//
// DIAGNOSTIC: run rdcLwProbe() in the console on /account/properties/add.
//   It dumps every mapped field, whether it was found, its tag/type, its
//   live option values and its current value. Send that output back and
//   lw-v2 is written against fact instead of assumption.
//
// CHANGELOG
//   lw-v19 2026-07-23  PHOTOS FIRST, AND AN EMPTY YELLOW STRIP FIXED.
//                      1. THE BLANK STRIP. The address status box rendered
//                         as a styled but EMPTY yellow bar. showStep() fills
//                         it, but the first step is marked visible directly
//                         in the initial HTML, so showStep never runs for
//                         it. Anything showStep does has to be done at mount
//                         too. The markup now ships with its default text
//                         and mount paints it and starts the watcher.
//                         GENERAL: if step one is rendered pre-selected, it
//                         never receives the transition that sets a step up.
//                      2. PHOTOS MOVED TO STEP 1. Kenny's call, and it is
//                         the right one: it moves the failure earlier. A
//                         member could previously finish seven steps, go
//                         live, and only then learn their photos fall short
//                         and the listing gets set back to draft. Asking
//                         first means finding out before anything is typed,
//                         and the checklist reads as preparation instead of
//                         a scolding at the end. Still no upload here, since
//                         photos attach to a listing id that does not exist
//                         until the save. When the upload capture lands, a
//                         real drop zone goes in THIS step and the files are
//                         held in the browser and pushed after the save.
//                      3. THE MAP NOW RELOCATES AT MOUNT, not on arrival at
//                         the address step. Google Maps paints grey tiles
//                         when its container is moved or sized while hidden,
//                         and with photos leading, the address step is no
//                         longer first. A window resize is fired when that
//                         step opens so a map laid out while hidden repaints.
//   lw-v18 2026-07-22  GROUNDWORK FOR OPTION C. Two additions.
//                      1. NETWORK RECORDER. Wraps XMLHttpRequest and fetch
//                         read-only across /account/properties and shows
//                         what the page sent in a copyable panel. On Manage
//                         Photos that means the upload call captures itself
//                         when a photo is uploaded normally. Nobody has to
//                         drive the Network tab, which is the same lesson as
//                         the console in v13. Analytics hosts filtered out.
//                         It never blocks, alters or swallows a request.
//                      2. IN-PAGE SAVE, OPT-IN, NOT THE DEFAULT. A quiet
//                         link under the green button posts BD's own form
//                         with fetch and reports status, final url, redirect
//                         flag and body. That answers how BD returns the new
//                         listing id, which Option C needs and which the
//                         POST capture could not show.
//                         The body is new FormData(FORM), serialising the
//                         REAL form as BD would: CSRF token, both money
//                         twins, the hidden property_price. Hand-building
//                         that body is the failure mode this avoids.
//                         IT DOES NOT FALL BACK ON FAILURE. A fetch that
//                         throws may still have reached the server, so a
//                         second submit could create a duplicate listing.
//                         It reports and stops; the green button remains.
//   lw-v17 2026-07-22  DESCRIPTION STEP LABELS. Two invented strings
//                      replaced. 'Screening and terms note' was mine; BD
//                      labels that field 'Application process and lease
//                      terms', which is clearer and keeps the wizard and the
//                      raw form saying the same thing. 'Publishes exactly as
//                      you write it' was accurate but read as a warning; the
//                      useful fact is WHERE the text goes, so it now reads
//                      'Shown on the public listing'.
//                      GENERAL: prefer BD's own field labels over invented
//                      ones unless BD's is actively wrong. A member who
//                      switches to the raw form should recognise the field.
//   lw-v16 2026-07-22  PHOTOS SIGNPOSTED AT THE SAVE POINT. Reported live:
//                      'dont see a spot for photos'. There is no photo
//                      upload on this form and there never was; BD's own
//                      label says photos are added on the page AFTER saving.
//                      The wizard said so on step 6, five steps before the
//                      member needed to know, and said nothing at the point
//                      of saving. The review step now states plainly that
//                      photos come next and names the Actions > Manage
//                      Photos route back. Step 6 leads with 'nothing to
//                      upload here' so it reads as a checklist to shoot
//                      against rather than a step with a missing control.
//                      A REAL UPLOAD INSIDE THE WIZARD stays blocked on the
//                      photo-upload call capture, which is still not done.
//   lw-v15 2026-07-22  DOUBLE BACK BUTTON ON THE REVIEW STEP. renderReview
//                      builds its own row (Save and go live, then Back and
//                      Save as draft), while stepHTML was still appending
//                      the generic Back/Continue row underneath it. Every
//                      step now has exactly one button row, asserted in the
//                      suite so it cannot come back.
//   lw-v14 2026-07-22  BUILT FROM THE ACTUAL FORM. MOUNT_UI back to true.
//                      The live dump of property_listing_316 exposed four
//                      real bugs, all invisible from the POST capture:
//
//                      1. RENT IS post_promo, NOT property_price. The
//                         form-group LABELED '* Rent:' contains post_promo.
//                         property_price is a standalone HIDDEN input with
//                         no label that BD syncs itself. v1-v13 wrote rent
//                         to property_price, and wrote a 'promotional rent'
//                         the form does not have to post_promo. So the rent
//                         went nowhere and the promo field was the rent.
//                         Second label-vs-variable trap on this form.
//                      2. RENT, DEPOSIT AND MOVE-IN EACH HAVE TWO INPUTS
//                         SHARING ONE NAME: a hidden 'fixed-' formatted twin
//                         and the visible text box, hidden one FIRST in the
//                         DOM. Taking nodes[0] wrote the invisible twin and
//                         left the member's field empty. one() now prefers
//                         the first non-hidden node.
//                      3. THE FORM IS NAMED property_listing_316. An exact
//                         match on 'property_listing' never hit; discovery
//                         was surviving on a fallback. Prefix match now.
//                      4. TWO SUBMIT BUTTONS. FormValidation's
//                         button.fv-hidden-submit comes first in the DOM, so
//                         go-live was clicking it rather than the real Save.
//                         Real submits are tried first now.
//
//                      ALSO: address1, city and zip_code DO NOT EXIST on
//                      this form. The address is a Places autocomplete with
//                      no name attribute (id pac-input) inside a div.well
//                      that holds NOTHING NAMED, so that container is MOVED
//                      into the wizard card and the raw form is hidden
//                      completely. Nothing leaves the POST because the
//                      fields it feeds (lat, lon, country_sn, state_sn,
//                      post_location) are separate hidden inputs.
//                      Step 1 now refuses to advance until lat/lon actually
//                      land, so a listing can no longer be built on top of
//                      an address that never geocoded.
//                      Editors are plain contenteditable, not tinymce or
//                      CKEditor. The v9 fallback path covers it and the
//                      read-back gate still guards it.
//                      LATE FIX before ship: the new address gate read
//                      lat/lon to confirm the geocode, but a form with
//                      NO lat/lon would have trapped the member on step
//                      1 with no way forward. It FAILS OPEN now: no
//                      fields to check means no gate. Found because the
//                      older test mocks lack those fields.
//   lw-v13 2026-07-22  ON-PAGE REPORT PANEL. Wizard still OFF.
//                      The console route failed twice in practice: the
//                      command name was unfamiliar, and the first attempt
//                      ran before the build had deployed so it threw
//                      'not defined', which reads like a broken file rather
//                      than a stale one. Asking a solo founder to open dev
//                      tools to unblock a build is friction I introduced.
//                      The report now renders as a panel above BD's form
//                      with the text prefilled and a Copy button. No dev
//                      tools. It reads the form and changes nothing.
//                      ALSO: the retry loop logged the UI-OFF line 13 times
//                      per page load, because it only stopped when it found
//                      a wizard that was never going to mount. Logs once now
//                      and the interval clears when the panel is up.
//                      The panel disappears when MOUNT_UI goes back to true.
//   lw-v12 2026-07-22  *** WIZARD UI TURNED OFF. DIAGNOSTIC BUILD. ***
//                      Live report: the address region never appeared on
//                      step 1, the member could not find where to enter the
//                      address or photos, and a listing came back empty.
//                      MOUNT_UI is now false. The file renders nothing,
//                      hides nothing, writes nothing. BD's form behaves
//                      exactly as it did before this file existed. Only the
//                      diagnostic hooks are installed.
//
//                      WHY OFF RATHER THAN PATCHED: every version v1-v11 was
//                      built from a captured POST body and two screenshots.
//                      The address and editor lookups are heuristics that
//                      have now demonstrably failed on the real DOM. Adding
//                      a twelfth guess on top of a failure is not a fix, and
//                      the failure mode is a member losing work.
//
//                      NEW: rdcLwDump() returns the WHOLE form structure as
//                      one copyable string and puts it on the clipboard.
//                      console.table could not be copied out of a browser,
//                      which is a large part of why this information never
//                      arrived across eleven versions. It lists every field
//                      INCLUDING UNNAMED ONES, because BD's address
//                      autocomplete has an id and a placeholder but no name.
//
//                      TO TURN THE WIZARD BACK ON: set MOUNT_UI = true, but
//                      only after the dump has been read and the address and
//                      description lookups are keyed to real ids.
//   lw-v11 2026-07-22  PHOTOS + MOVE-IN COPY. Three fixes. (1) The photos
//                      line said the consequence ('set back to draft') and
//                      the warning box below the checklist said it again, so
//                      the step scolded twice before asking for anything.
//                      The subtitle now explains WHY, the warning box states
//                      the consequence ONCE. (2) 'This platform holds a
//                      standard' read as policy language; replaced with what
//                      the standard is FOR, which is a renter deciding
//                      without having to ask. (3) US SPELLING: 'enquiries'
//                      appeared twice, on the photos and move-in steps. Both
//                      reworded. Member-facing copy is now clean on the
//                      usual British/US splits.
//   lw-v10 2026-07-22  DESCRIPTION COPY CORRECTED. 'Rough is fine' and
//                      'Write it rough' were written as if Claude-drafted
//                      descriptions were already wired. They are not. What
//                      the member types publishes verbatim, so the copy was
//                      inviting a worse listing than they would otherwise
//                      have written. Hint now reads 'Publishes exactly as
//                      you write it'.
//
//                      *** STANDING CHECK FOR THIS FILE ***
//                      Three separate pieces of member-facing copy have now
//                      described capabilities that are not live: identity
//                      verification coverage (v8), income verification (v8),
//                      and description drafting (v10). The pattern is that
//                      the ROADMAP reads as the PRESENT while writing copy.
//                      Before shipping any copy change, check every claim
//                      against what is actually deployed today, not what is
//                      planned. When the drafting feature does ship, this
//                      hint is the place to say so.
//   lw-v9  2026-07-22  FIRST VERSION BUILT AGAINST A SIGHT OF THE REAL FORM.
//                      Two structural corrections from screenshots:
//                      (1) THE ADDRESS REGION IS THREE ELEMENTS, not one: a
//                      geocoding autocomplete input, the Google map, and a
//                      separate Property Location textarea holding the public
//                      display string. v5-v8 walked up from the first match
//                      and showed ONE container, so step 1 probably showed
//                      the read-only display box and hid the input that
//                      feeds the map. Now every form child holding any part
//                      of the address region is shown, and BD's own title
//                      field is hidden inside it so it cannot duplicate the
//                      wizard's.
//                      (2) PROPERTY DESCRIPTION IS A RICH-TEXT EDITOR. An
//                      editor bound to a textarea overwrites that textarea
//                      with its own content on submit, so writing the raw
//                      field and trusting it would post an EMPTY
//                      description. The wizard now writes through tinymce,
//                      CKEditor or a contenteditable, then READS BACK. If
//                      the write did not take it refuses to advance, keeps
//                      the typed text on screen to copy, and reveals BD's
//                      own editor. Silent data loss becomes a visible stop.
//                      STILL UNSEEN: element names and ids. rdcLwProbe()
//                      would replace the heuristics here with facts.
//   lw-v8  2026-07-22  SCREENING COPY CORRECTED, and it was an ACCURACY bug,
//                      not a style one. The old line claimed 'Renters on
//                      Renters.com are identity verified, and many have
//                      verified income'. Both are overclaims: only a share
//                      of members are identity verified (the Bible already
//                      corrected this exact phrasing on the homepage band in
//                      v34), and income verification is still gated behind
//                      INCOME_LIVE = false pending the Plaid entitlement, so
//                      NO member has verified income yet. New copy makes no
//                      verification claim at all and adds a note that either
//                      field can be left blank.
//                      RULE FOR THIS FILE: member-facing copy must not claim
//                      a platform capability that is not live. Grep for
//                      'verified' before shipping any copy change.
//   lw-v7  2026-07-22  MONEY FIELDS SANITISE THEMSELVES. The rent hint read
//                      'Numbers only', which does not say what it wants.
//                      Rather than reword it, the wizard now accepts 1800,
//                      $1,800, 1,800.00 or '$1800 /mo' and writes 1800 to
//                      BD, matching the raw value in the capture. On blur
//                      the wizard field shows the same clean number that was
//                      stored, so the screen and BD can never disagree.
//                      Hints replaced with placeholders. Applies to rent,
//                      deposit, promo, move-in total and minimum income.
//                      KNOWN EDGE: '1.800' is stored as 1.800, since a lone
//                      dot is read as a decimal point, not a thousands
//                      separator. Fine for US listings, wrong for European
//                      convention. Revisit only if it shows up in practice.
//   lw-v6  2026-07-22  COPY. Listing title now asks for City, State with a
//                      Denver, CO placeholder and matching hint, matching
//                      BD's own convention in the capture (Washougal, WA).
//                      Escape-hatch link reworded: 'Show all fields on one
//                      page' / 'Back to step-by-step'. The old wording said
//                      'Prefer the original form?', which framed the guided
//                      flow as a skin over the real thing and planted doubt
//                      before a PM had tried it. Also added placeholder
//                      support to the field renderer.
//   lw-v5  2026-07-22  ONE INTERFACE AT A TIME. Reported live: the wizard
//                      and BD's raw form were both on screen, which read as
//                      two competing forms. lw-v1 to v4 called showNative
//                      (true) on mount so the address widget stayed usable.
//                      Replaced with a three-state controller: step 1 shows
//                      the wizard plus ONLY the address block of BD's form,
//                      every later step hides the form entirely, and the
//                      escape hatch shows the raw form with the wizard
//                      collapsed. The address block is ISOLATED IN PLACE,
//                      never relocated: those inputs must stay inside the
//                      form element or they drop out of the details POST,
//                      and BD's geocode widget is bound to the real input.
//   lw-v4  2026-07-22  VERSION MOVED TO LINE 1. No behaviour change. The
//                      stamp sat on line 2 under a divider, so confirming
//                      the right file was being pasted meant reading past
//                      the banner. It is now the first characters of the
//                      first line. KEEP IT THERE. Three live markers to
//                      bump: line 1, and both LW_VERSION constants.
//   lw-v3  2026-07-22  VERSION-STAMP FIX, no behaviour change. lw-v2 bumped
//                      both LW_VERSION constants but left the header line at
//                      the top of this file reading lw-v1, so the file said
//                      one thing and the console said another. Exactly the
//                      drift this project has hit four times in head code.
//                      WHEN BUMPING THIS FILE, GREP FOR lw-v AND CHANGE
//                      EVERY LIVE INSTANCE: the header line above and both
//                      LW_VERSION constants. Changelog entries below stay
//                      historical and must NOT be rewritten.
//   lw-v2  2026-07-22  PATH SCOPE FIX. lw-v1 scoped to /account/properties/add
//                      because the capture spec named that as the page the form
//                      posts FROM. The form actually renders at
//                      /account/properties/newgroup, which is also the POST
//                      target, so lw-v1 never mounted on a real new listing.
//                      Scope is now the whole /account/properties area and the
//                      real gate is form presence: no BD listing form on the
//                      page means stand down. A future path discovery is now a
//                      function change, never a head-code change.
//   lw-v1  2026-07-22  First build. Seven-step guided flow over BD's form,
//                      go-live surfaced as a real button, review reads back
//                      off the BD fields, escape hatch to the raw form.
//                      Descriptions and photo vision checks are NOT in this
//                      version; they layer on top.
// =====================================================================

const LW_VERSION = "lw-v19";

const WIZARD = String.raw`(function () {
  "use strict";

  var LW_VERSION = "lw-v19";
  var DEBUG = false;

  // =============================================================
  // MOUNT_UI - MASTER SWITCH. CURRENTLY OFF.
  // =============================================================
  // false = the wizard renders NOTHING and touches NOTHING. BD's form
  //         behaves exactly as it did before this file existed. Only the
  //         diagnostic hooks are installed.
  // true  = the guided wizard mounts.
  //
  // Turned off in lw-v12 after a live report that the address region never
  // appeared on step 1 and a listing came back empty. Every version to date
  // was built from a captured POST body and two screenshots, never from the
  // actual DOM, so the address and editor lookups are heuristics. Guessing
  // again on top of a failure is not a fix.
  //
  // TO TURN IT BACK ON: set this to true. Do that only after rdcLwProbe()
  // output has been read and the field lookups are keyed to real ids.
  // =============================================================
  var MOUNT_UI = true;

  // PATH SCOPE - deliberately broad, then gated by the form itself.
  // lw-v1 scoped to /account/properties/add because the capture spec called
  // that "the page it posts from". The listing form actually renders at
  // /account/properties/newgroup, which is ALSO the POST target, so lw-v1
  // never mounted. Both are covered now, and the real gate is findForm():
  // no BD listing form on the page means the wizard stands down. That way a
  // future path discovery is a function change, never a head-code change.
  var PATH = (window.location.pathname || "").toLowerCase();
  if (PATH.indexOf("/account/properties") === -1) return;
  if (window.__rdcLwMounted) return;
  window.__rdcLwMounted = true;

  // =============================================================
  // NETWORK RECORDER - captures the photo-upload call automatically.
  // Installed on every /account/properties page BEFORE anything else runs.
  // The member uploads one photo normally; this records what BD sent, so
  // nobody has to drive the Network tab. Reads only. Never blocks, never
  // alters a request, and passes every failure straight through.
  // =============================================================
  var NETLOG = [];
  var NET_SKIP = ["google", "gstatic", "doubleclick", "analytics", "facebook",
                  "hotjar", "segment", "sentry", "netlify", "cloudflare", "adservice"];

  function netInteresting(url) {
    var u = String(url || "").toLowerCase();
    if (!u) return false;
    for (var i = 0; i < NET_SKIP.length; i++) if (u.indexOf(NET_SKIP[i]) !== -1) return false;
    return true;
  }

  function describeBody(body) {
    try {
      if (!body) return "(empty)";
      if (typeof body === "string") return "string, " + body.length + " chars: " + body.slice(0, 400);
      if (window.FormData && body instanceof window.FormData) {
        var parts = [];
        try {
          body.forEach(function (v, k) {
            if (v && v.name !== undefined && v.size !== undefined) {
              parts.push(k + " = [FILE name=" + v.name + " type=" + (v.type || "?") + " bytes=" + v.size + "]");
            } else {
              parts.push(k + " = " + String(v).slice(0, 120));
            }
          });
        } catch (e) { parts.push("(FormData not enumerable here)"); }
        return "FormData with " + parts.length + " entries:" + String.fromCharCode(10) + "    " +
               parts.join(String.fromCharCode(10) + "    ");
      }
      if (window.Blob && body instanceof window.Blob) return "Blob type=" + body.type + " bytes=" + body.size;
      if (window.ArrayBuffer && body instanceof window.ArrayBuffer) return "ArrayBuffer bytes=" + body.byteLength;
      return "object: " + Object.prototype.toString.call(body);
    } catch (e) { return "(body unreadable: " + e + ")"; }
  }

  function netRecord(kind, method, url, body, extra) {
    if (!netInteresting(url)) return;
    NETLOG.push({
      when: new Date().toISOString().slice(11, 19),
      kind: kind, method: (method || "GET").toUpperCase(),
      url: String(url), body: describeBody(body), extra: extra || ""
    });
    if (NETLOG.length > 40) NETLOG.shift();
    try { paintNetPanel(); } catch (e) {}
  }

  function installRecorder() {
    if (window.__rdcLwNet) return;
    window.__rdcLwNet = true;
    try {
      var X = window.XMLHttpRequest;
      if (X && X.prototype) {
        var oOpen = X.prototype.open, oSend = X.prototype.send;
        X.prototype.open = function (m, u) {
          try { this.__lwM = m; this.__lwU = u; } catch (e) {}
          return oOpen.apply(this, arguments);
        };
        X.prototype.send = function (b) {
          try {
            var self = this;
            netRecord("XHR", self.__lwM, self.__lwU, b);
            self.addEventListener("load", function () {
              try {
                netRecord("XHR-RESPONSE", self.__lwM, self.__lwU, null,
                  "status=" + self.status + " bodyLen=" + ((self.responseText || "").length) +
                  " body=" + (self.responseText || "").slice(0, 300));
              } catch (e) {}
            });
          } catch (e) {}
          return oSend.apply(this, arguments);
        };
      }
    } catch (e) {}
    try {
      var oFetch = window.fetch;
      if (oFetch) {
        window.fetch = function (input, init) {
          try {
            var u = (typeof input === "string") ? input : (input && input.url);
            var m = (init && init.method) || (input && input.method) || "GET";
            netRecord("FETCH", m, u, init && init.body);
          } catch (e) {}
          return oFetch.apply(this, arguments);
        };
      }
    } catch (e) {}
  }

  function log() {
    if (!DEBUG) return;
    try { console.log.apply(console, ["[Listing wizard]"].concat([].slice.call(arguments))); } catch (e) {}
  }
  try { console.log("[Listing wizard] version:", LW_VERSION); } catch (e) {}
  installRecorder();

  // ---------------------------------------------------------------
  // AUDIENCE GATE - numeric plan level (Bible: body class, first paint)
  // 14 = property manager, 17 = landlord, 18 = realtor, 15 = renter
  // Allowlist with fail-OPEN default: this is a helper, not a gate. If the
  // class is missing we still mount. Only an explicit renter class blocks.
  // ---------------------------------------------------------------
  function planLevel() {
    var cls = " " + (document.body.className || "") + " ";
    var levels = [14, 15, 17, 18, 16];
    for (var i = 0; i < levels.length; i++) {
      if (cls.indexOf(" session-plan-level-" + levels[i] + " ") !== -1) return levels[i];
    }
    return null;
  }
  var LEVEL = planLevel();
  if (LEVEL === 15) { log("renter level, standing down"); return; }

  // ---------------------------------------------------------------
  // FIELD MAP - names captured from the live BD details POST.
  //
  // *** LOCKED, DO NOT "FIX" ***
  // BD's bed/bath variable names are reversed relative to their labels.
  // Verified by distinct-value test: setting the field LABELED "Bedrooms:"
  // (variable property_baths) to "more than 4" made the LIVE listing show
  // "more than 4" BEDROOMS. Label-to-display is correct; the variable name
  // is wrong. Writing beds -> property_baths is CORRECT.
  // Flipping this to match the variable names flips every listing.
  // ---------------------------------------------------------------
  // *** RENT IS post_promo, NOT property_price. *** Confirmed from the live
  // form dump: the form-group LABELED "* Rent:" contains post_promo. The
  // field named property_price is a standalone HIDDEN input with no id and
  // no label, which BD syncs itself. Writing rent to property_price put it
  // somewhere the member could not see and BD did not read. Same class of
  // trap as the bed/bath names: MAP BY LABEL, NEVER BY VARIABLE NAME.
  //
  // There is also NO promotional-rent field on this form. lw-v1 to v13
  // carried one, invented from the capture spec, and it wrote to post_promo,
  // which is the actual Rent field. So the wizard's "Promotional rent" was
  // the real rent and its "Monthly rent" went nowhere.
  var F = {
    title:      "group_name",
    price:      "post_promo",
    beds:       "property_baths",        // <-- BEDROOMS. Correct. See above.
    baths:      "property_beds",         // <-- BATHROOMS. Correct. See above.
    sqft:       "property_sqr_foot",
    year:       "year_built",
    ptype:      "property_type",
    subtype:    "sub_property_type",
    duration:   "property_duration",
    furnished:  "status",
    deposit:    "deposit_amount",
    movein:     "total_cost_to_movei",
    mincredit:  "minimum_cc_requ",
    minincome:  "minimum_income_requ",
    desc:       "group_desc",
    terms:      "group_desc_2",
    golive:     "group_status",
    location:   "post_location",
    lat:        "lat",
    lon:        "lon"
  };
  // NOT ON THIS FORM (confirmed by dump): address1, city, zip_code. The
  // address is entered through a Google Places autocomplete with NO name
  // attribute (id "pac-input"), and the widget writes lat, lon, country_sn,
  // state_sn and post_location. Nothing to mirror; the widget owns it.

  // ---------------------------------------------------------------
  // FORM DISCOVERY
  // ---------------------------------------------------------------
  var FORM = null;
  function findForm() {
    // BD names the form property_listing_NNN (property_listing_316 live), so
    // an exact match on "property_listing" never hits. Prefix match first.
    var forms0 = document.querySelectorAll("form");
    for (var z = 0; z < forms0.length; z++) {
      var nm = (forms0[z].getAttribute("name") || "") + " " + (forms0[z].id || "");
      if (nm.indexOf("property_listing") !== -1) return forms0[z];
    }
    var f = document.querySelector("form[name=property_listing]");
    if (f) return f;
    var marker = document.querySelector("input[name=formname][value=property_listing]");
    if (marker && marker.form) return marker.form;
    var forms = document.querySelectorAll("form");
    for (var i = 0; i < forms.length; i++) {
      if (forms[i].querySelector("[name=" + F.price + "]")) return forms[i];
    }
    return null;
  }

  function el(name) {
    var scope = FORM || document;
    var n = scope.querySelectorAll("[name='" + name + "']");
    if (!n.length && scope !== document) n = document.querySelectorAll("[name='" + name + "']");
    return n.length ? n : null;
  }
  // Rent, Deposit and Total move-in fees each have TWO inputs sharing one
  // name: a hidden "fixed-" formatted companion and the visible text box the
  // member types into. The hidden one comes FIRST in the DOM, so taking
  // nodes[0] wrote to the invisible twin and left the visible field empty.
  function one(name) {
    var n = el(name);
    if (!n) return null;
    for (var i = 0; i < n.length; i++) {
      var t = (n[i].type || "").toLowerCase();
      if (t !== "hidden") return n[i];
    }
    return n[0];
  }
  function exists(name) { return !!one(name); }

  function fire(node) {
    try {
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
      if (window.jQuery) window.jQuery(node).trigger("change");
    } catch (e) {
      try {
        var ev = document.createEvent("HTMLEvents");
        ev.initEvent("change", true, true);
        node.dispatchEvent(ev);
      } catch (e2) {}
    }
  }

  function setField(name, value) {
    var nodes = el(name);
    if (!nodes) { log("MISSING field on set:", name); return false; }
    var first = one(name) || nodes[0];
    var type = (first.type || "").toLowerCase();

    if (type === "radio" || type === "checkbox") {
      var hit = false;
      for (var i = 0; i < nodes.length; i++) {
        var want = String(nodes[i].value) === String(value);
        if (want) { nodes[i].checked = true; fire(nodes[i]); hit = true; }
        else if (type === "radio") { nodes[i].checked = false; }
      }
      return hit;
    }

    if (first.tagName === "SELECT") {
      var matched = false;
      for (var j = 0; j < first.options.length; j++) {
        if (String(first.options[j].value) === String(value)) { first.selectedIndex = j; matched = true; break; }
      }
      if (!matched) {
        for (var k = 0; k < first.options.length; k++) {
          if (norm(first.options[k].text) === norm(value)) { first.selectedIndex = k; matched = true; break; }
        }
      }
      if (matched) fire(first);
      else log("no option match", name, value);
      return matched;
    }

    first.value = value;
    fire(first);
    // WYSIWYG mirror. Returns false if an editor is present and refused it.
    var edOk = syncEditor(name, value);
    if (!edOk) log("editor write did not take for", name);
    return true;
  }

  function getField(name) {
    var nodes = el(name);
    if (!nodes) return "";
    var first = one(name) || nodes[0];
    var type = (first.type || "").toLowerCase();
    if (type === "radio" || type === "checkbox") {
      for (var i = 0; i < nodes.length; i++) if (nodes[i].checked) return nodes[i].value;
      return "";
    }
    if (first.tagName === "SELECT") {
      var o = first.options[first.selectedIndex];
      return o ? o.value : "";
    }
    return first.value || "";
  }

  function getFieldLabel(name) {
    var nodes = el(name);
    if (!nodes) return "";
    var first = nodes[0];
    if (first.tagName === "SELECT") {
      var o = first.options[first.selectedIndex];
      return o ? o.text : "";
    }
    return getField(name);
  }

  // Property Description is a rich-text editor on BD's form. An editor bound
  // to a textarea writes ITS OWN content over that textarea on submit, so
  // writing the raw textarea and trusting it would post an empty description.
  // Write through every editor API we can reach, then READ BACK. If the write
  // did not take, the wizard stops pretending and hands over BD's own editor.
  function editorFor(name) {
    var node = one(name);
    var id = node ? (node.id || name) : name;
    try {
      if (window.tinymce && window.tinymce.get) {
        var t = window.tinymce.get(id) || window.tinymce.get(name);
        if (t) return { kind: "tinymce", api: t };
      }
    } catch (e) {}
    try {
      if (window.CKEDITOR && window.CKEDITOR.instances) {
        var c = window.CKEDITOR.instances[id] || window.CKEDITOR.instances[name];
        if (c) return { kind: "ckeditor", api: c };
      }
    } catch (e) {}
    try {
      var block = node ? node.parentNode : null;
      var hops = 0;
      while (block && hops < 4) {
        var ce = block.querySelector ? block.querySelector("[contenteditable=true]") : null;
        if (ce) return { kind: "contenteditable", api: ce };
        block = block.parentNode; hops++;
      }
    } catch (e) {}
    return null;
  }

  function syncEditor(name, value) {
    var ed = editorFor(name);
    if (!ed) return true;
    try {
      if (ed.kind === "tinymce") { ed.api.setContent(value || ""); return readBackEditor(name, value); }
      if (ed.kind === "ckeditor") { ed.api.setData(value || ""); return readBackEditor(name, value); }
      if (ed.kind === "contenteditable") {
        ed.api.innerHTML = value ? "<p>" + esc(value).split(String.fromCharCode(10)).join("</p><p>") + "</p>" : "";
        return readBackEditor(name, value);
      }
    } catch (e) {}
    return false;
  }

  function readBackEditor(name, expected) {
    var ed = editorFor(name);
    if (!ed) return true;
    var got = "";
    try {
      if (ed.kind === "tinymce") got = ed.api.getContent({ format: "text" }) || "";
      else if (ed.kind === "ckeditor") got = stripTags(ed.api.getData() || "");
      else got = ed.api.textContent || "";
    } catch (e) { return false; }
    var want = stripTags(expected || "");
    if (!want) return true;
    return norm(got).indexOf(norm(want).slice(0, 40)) !== -1;
  }

  var descHandedOver = false;

  function verifyDescription() {
    if (!exists(F.desc)) return true;
    if (!editorFor(F.desc)) return true;
    var typed = "";
    var box = document.getElementById("lw-i-desc");
    if (box) typed = box.value;
    if (!typed) return true;
    var okNow = readBackEditor(F.desc, typed);
    if (okNow) return true;
    handOverDescription(typed);
    return false;
  }

  function handOverDescription(typed) {
    if (descHandedOver) return;
    descHandedOver = true;
    var step = null;
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i].note === "descfallback") step = i;
    var wrap = document.querySelector("#lw-card .lw-f[data-fkey=desc]");
    if (wrap) {
      wrap.innerHTML = "<div class='lw-warn'><strong>This one has to be typed in BD" + AP + "s own editor.</strong> " +
        "The description box below is a formatting editor and it does not accept text from this wizard. " +
        "Your text is copied to the clipboard note below, paste it in and carry on.</div>" +
        "<textarea readonly style='min-height:90px'>" + esc(typed) + "</textarea>";
    }
    setFormMode("desc");
  }

  var AP = String.fromCharCode(39);

  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, ""); }

  // MONEY INPUT - the member can type 1800, $1,800, 1,800.00 or "1800 / mo".
  // All of it becomes 1800 before it reaches BD. Telling a property manager
  // to omit the dollar sign is asking a person to do the machine's job, and
  // BD's captured POST wants the raw number (property_price: 1800).
  function cleanMoney(v) {
    var src = String(v == null ? "" : v);
    var out = "";
    var dot = false;
    for (var i = 0; i < src.length; i++) {
      var c = src.charAt(i);
      if (c >= "0" && c <= "9") { out += c; continue; }
      if (c === "." && !dot && out.length) { out += c; dot = true; }
    }
    if (out.charAt(out.length - 1) === ".") out = out.slice(0, -1);
    // Drop a trailing .00 so 1,800.00 stores as 1800, matching the capture.
    if (out.indexOf(".") !== -1) {
      var parts = out.split(".");
      if (parts[1] === "" || parseInt(parts[1], 10) === 0) out = parts[0];
    }
    return out;
  }

  function moneyKeys() {
    return { price: 1, deposit: 1, promo: 1, movein: 1, minincome: 1 };
  }

  function isMoneyKey(k) { return moneyKeys()[k] === 1; }

  function optionsFor(name) {
    var n = one(name);
    var out = [];
    if (!n || n.tagName !== "SELECT") return out;
    for (var i = 0; i < n.options.length; i++) {
      var v = n.options[i].value;
      var t = (n.options[i].text || "").trim();
      if (v === "" && !t) continue;
      out.push({ value: v, label: t || v });
    }
    return out;
  }

  // ---------------------------------------------------------------
  // PROBE - console hook. Dumps everything the wizard can see, so a
  // missing or renamed field is diagnosed by looking, not by guessing.
  // Run rdcLwProbe() in the console on /account/properties/add.
  // ---------------------------------------------------------------
  // A full structural report of BD's listing form, as ONE copyable string.
  // console.table cannot be copied out of a browser easily, which is why
  // eleven versions shipped without this information ever arriving.
  window.rdcLwDump = function () {
    var L = [];
    function line(t) { L.push(t); }
    line("=== RENTERS LISTING FORM DUMP  " + LW_VERSION + " ===");
    line("url: " + window.location.pathname);
    line("plan level: " + LEVEL + "   body class: " + (document.body.className || ""));
    var f = findForm();
    line("form found: " + (!!f) + "   name=" + (f ? f.getAttribute("name") : "-") + "   id=" + (f ? f.id : "-") + "   action=" + (f ? f.getAttribute("action") : "-"));
    if (!f) { var out0 = L.join(String.fromCharCode(10)); try { console.log(out0); } catch (e) {} return out0; }

    line("");
    line("--- TOP-LEVEL BLOCKS INSIDE THE FORM ---");
    for (var i = 0; i < f.children.length; i++) {
      var c = f.children[i];
      if (c.tagName === "SCRIPT" || c.tagName === "STYLE") continue;
      var named = [];
      var fields = c.querySelectorAll ? c.querySelectorAll("input,select,textarea") : [];
      for (var j = 0; j < fields.length; j++) {
        var nm = fields[j].getAttribute("name") || fields[j].id || "";
        var ty = (fields[j].type || fields[j].tagName || "").toLowerCase();
        if (nm || ty !== "hidden") named.push(nm + ":" + ty);
      }
      var label = (c.textContent || "").replace(/[ ]+/g, " ").trim().slice(0, 60);
      line("[" + i + "] <" + c.tagName.toLowerCase() + "> id=" + (c.id || "-") + " class=" + (c.className || "-"));
      line("     text: " + label);
      line("     fields: " + (named.length ? named.join(", ") : "(none)"));
    }

    line("");
    // Include UNNAMED inputs. BD's address autocomplete carries an id and a
    // placeholder but NO name attribute, so a name-only listing hides the one
    // element the wizard most needs to locate.
    line("--- EVERY FIELD (named or not) ---");
    var all = f.querySelectorAll("input,select,textarea");
    for (var k = 0; k < all.length; k++) {
      var e2 = all[k];
      var n2 = e2.getAttribute("name") || ("(no name, id=" + (e2.id || "?") + ")");
      if (!e2.getAttribute("name") && !e2.id && !e2.getAttribute("placeholder")) continue;
      var extra = "";
      if (e2.tagName === "SELECT") {
        var ov = [];
        for (var o = 0; o < e2.options.length; o++) ov.push(e2.options[o].value);
        extra = "  options=[" + ov.join("|") + "]";
      }
      var ph = e2.getAttribute("placeholder");
      if (ph) extra += "  placeholder=" + JSON.stringify(ph);
      line(n2 + "   <" + e2.tagName.toLowerCase() + " type=" + (e2.type || "-") + "> id=" + (e2.id || "-") + extra);
    }

    line("");
    line("--- WIZARD FIELD MAP RESOLUTION ---");
    for (var key in F) {
      if (!F.hasOwnProperty(key)) continue;
      var nd = one(F[key]);
      line((nd ? "  OK   " : "  MISS ") + key + " -> " + F[key] + (nd ? ("  <" + nd.tagName.toLowerCase() + " type=" + (nd.type || "-") + ">") : ""));
    }

    line("");
    line("--- EDITORS AND WIDGETS ---");
    line("tinymce present: " + (!!window.tinymce));
    line("CKEDITOR present: " + (!!window.CKEDITOR));
    line("google maps present: " + (!!(window.google && window.google.maps)));
    var ce = f.querySelectorAll("[contenteditable=true]");
    line("contenteditable nodes in form: " + ce.length);
    var ifr = f.querySelectorAll("iframe");
    line("iframes in form: " + ifr.length);
    line("submit buttons: " + submitButtons().length);
    line("csrf token present: " + (!!one("form_security_token")));
    line("=== END DUMP ===");

    var out = L.join(String.fromCharCode(10));
    try { console.log(out); } catch (e) {}
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(out);
        try { console.log("[copied to clipboard]"); } catch (e2) {}
      }
    } catch (e3) {}
    return out;
  };

  window.rdcLwProbe = function () {
    var rows = [];
    for (var key in F) {
      if (!F.hasOwnProperty(key)) continue;
      var name = F[key];
      var n = one(name);
      rows.push({
        wizard: key,
        bdField: name,
        found: !!n,
        tag: n ? n.tagName : "-",
        type: n ? (n.type || "-") : "-",
        options: n && n.tagName === "SELECT" ? optionsFor(name).map(function (o) { return o.value; }).join(" | ") : "",
        value: n ? getField(name) : ""
      });
    }
    try { console.table(rows); } catch (e) { try { console.log(rows); } catch (e2) {} }
    try {
      console.log("form found:", !!FORM, FORM ? (FORM.getAttribute("name") || FORM.id) : "");
      console.log("plan level:", LEVEL);
      console.log("submit candidates:", submitButtons().length);
      console.log("csrf token present:", !!one("form_security_token"));
    } catch (e) {}
    return rows;
  };

  // BD's form carries TWO submits: FormValidation's button.fv-hidden-submit
  // (first in the DOM) and the real one in .form-actions. Clicking the hidden
  // one is not the same as the member pressing Save, so it goes last.
  function submitButtons() {
    var scope = FORM || document;
    var list = [].slice.call(scope.querySelectorAll("input[type=submit], button[type=submit], button.btn-submit, #save_form"));
    var real = [], hidden = [];
    for (var i = 0; i < list.length; i++) {
      var c = (list[i].className || "");
      if (c.indexOf("fv-hidden-submit") !== -1) hidden.push(list[i]);
      else real.push(list[i]);
    }
    return real.concat(hidden);
  }

  var missing = [];
  function auditFields() {
    missing = [];
    for (var key in F) {
      if (!F.hasOwnProperty(key)) continue;
      if (!exists(F[key])) missing.push(key + " (" + F[key] + ")");
    }
    if (missing.length) {
      try { console.warn("[Listing wizard] fields not found on this page:", missing.join(", "), "- run rdcLwProbe() for detail"); } catch (e) {}
    }
    return missing;
  }

  // ---------------------------------------------------------------
  // STYLES
  // ---------------------------------------------------------------
  var CSS = [
    "#lw-wrap{font-family:inherit;max-width:860px;margin:0 0 26px 0}",
    "#lw-wrap *{box-sizing:border-box}",
    "#lw-card{background:#fff;border:1px solid #dfe4ea;border-radius:12px;padding:26px 26px 22px;box-shadow:0 1px 3px rgba(13,45,78,.07)}",
    "#lw-pips{display:flex;gap:6px;margin-bottom:20px}",
    ".lw-pip{height:4px;flex:1;border-radius:3px;background:#e3e8ee;transition:background .2s}",
    ".lw-pip.on{background:#0d2d4e}",
    ".lw-step{display:none}",
    ".lw-step.on{display:block}",
    ".lw-eyebrow{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#7a8798;margin:0 0 6px}",
    ".lw-h{font-size:23px;line-height:1.25;color:#0d2d4e;margin:0 0 8px;font-weight:600}",
    ".lw-sub{font-size:14px;color:#5b6b7d;margin:0 0 20px;line-height:1.5}",
    ".lw-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}",
    ".lw-grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}",
    ".lw-f{display:flex;flex-direction:column;gap:5px;margin-bottom:14px}",
    ".lw-f label{font-size:13px;font-weight:600;color:#28394d}",
    ".lw-f .lw-hint{font-size:12px;color:#8593a4;font-weight:400}",
    ".lw-f input,.lw-f select,.lw-f textarea{width:100%;padding:10px 12px;border:1px solid #ccd4de;border-radius:7px;font-size:14px;font-family:inherit;color:#1e2b3a;background:#fff}",
    ".lw-f input:focus,.lw-f select:focus,.lw-f textarea:focus{outline:none;border-color:#0d2d4e;box-shadow:0 0 0 3px rgba(13,45,78,.10)}",
    ".lw-f textarea{min-height:120px;resize:vertical;line-height:1.5}",
    ".lw-f.bad input,.lw-f.bad select,.lw-f.bad textarea{border-color:#c0392b;background:#fdf6f5}",
    ".lw-err{font-size:12px;color:#c0392b;min-height:14px}",
    ".lw-row{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:22px;padding-top:18px;border-top:1px solid #eef1f5}",
    ".lw-row.end{justify-content:flex-end}",
    ".lw-btn{border:0;border-radius:7px;padding:11px 22px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit}",
    ".lw-navy{background:#0d2d4e;color:#fff}",
    ".lw-navy:hover{background:#143d67}",
    ".lw-ghost{background:#fff;color:#0d2d4e;border:1px solid #ccd4de}",
    ".lw-ghost:hover{background:#f5f7fa}",
    ".lw-go{background:#1e8449;color:#fff;font-size:16px;padding:14px 30px;width:100%}",
    ".lw-go:hover{background:#22945a}",
    ".lw-note{background:#f5f8fb;border:1px solid #e1e8f0;border-radius:9px;padding:14px 16px;font-size:13px;color:#41566d;line-height:1.55;margin-bottom:16px}",
    ".lw-warn{background:#fffbea;border:1px solid #f0e2b0;border-radius:9px;padding:14px 16px;font-size:13px;color:#6b5a12;line-height:1.55;margin-bottom:16px}",
    ".lw-check{list-style:none;margin:0 0 16px;padding:0}",
    ".lw-check li{font-size:13.5px;color:#33475d;padding:7px 0 7px 26px;position:relative;line-height:1.45}",
    ".lw-check li:before{content:'';position:absolute;left:4px;top:13px;width:7px;height:7px;border-radius:50%;background:#0d2d4e}",
    ".lw-rev{width:100%;border-collapse:collapse;margin-bottom:6px}",
    ".lw-rev td{padding:9px 4px;border-bottom:1px solid #eef1f5;font-size:13.5px;vertical-align:top}",
    ".lw-rev td:first-child{color:#7a8798;width:44%}",
    ".lw-rev td:last-child{color:#1e2b3a;font-weight:600}",
    ".lw-rev td.empty{color:#c0392b;font-weight:400;font-style:italic}",
    ".lw-esc{margin-top:14px;font-size:12.5px;color:#8593a4;text-align:center}",
    ".lw-esc a{color:#5b6b7d;text-decoration:underline;cursor:pointer}",
    ".lw-addrstate.skip{display:none}",
    ".lw-addrstate{margin-top:12px;font-size:13px;color:#8a6d1f;background:#fffbea;border:1px solid #f0e2b0;border-radius:8px;padding:10px 13px}",
    ".lw-addrstate.ok{color:#1e6b3c;background:#f2faf5;border-color:#bfe3ce}",
    "#lw-addr-slot .well{margin:0;border:1px solid #dfe4ea;border-radius:9px;padding:14px}",
    "#lw-native{display:none}",
    "#lw-native.show{display:block}",
    "#lw-native.address-only{background:#fff;border:1px solid #dfe4ea;border-top:0;border-radius:0 0 12px 12px;padding:4px 26px 20px;max-width:860px;margin:-26px 0 26px}",
    "@media(max-width:640px){.lw-grid,.lw-grid3{grid-template-columns:1fr}#lw-card{padding:20px 16px 18px}.lw-h{font-size:20px}}"
  ].join("");

  // ---------------------------------------------------------------
  // STEP DEFINITIONS
  // Each field declares: key (into F), label, kind, required, hint.
  // Selects clone their options from the live BD select at runtime, so
  // the dropdown option values never need to be captured by hand.
  // ---------------------------------------------------------------
  var STEPS = [
    {
      note: "photos",
      title: "Photos first",
      sub: "Photos do more for a listing than anything else on the page. Check you have these before you fill anything in. A listing that goes live short of them gets set back to draft, and reshooting is slower than shooting once.",
      fields: []
    },
    {
      title: "Where is it?",
      sub: "Start with the address. It has to be entered in the field below so the map pin and geocode are saved before anything else.",
      note: "address",
      fields: [
        { key: "title", label: "Listing title", kind: "text", required: true, placeholder: "Denver, CO", hint: "City and state, for example Denver, CO" }
      ]
    },
    {
      title: "The basics",
      sub: "Rent, size and layout. These are the filters renters search on, so they matter more than the description.",
      fields: [
        { key: "price", label: "Monthly rent", kind: "number", required: true, placeholder: "1800" },
        { key: "ptype", label: "Property type", kind: "select", required: true },
        { key: "beds", label: "Bedrooms", kind: "select-or-text", required: true },
        { key: "baths", label: "Bathrooms", kind: "select-or-text", required: true },
        { key: "sqft", label: "Square feet", kind: "number", required: false },
        { key: "year", label: "Year built", kind: "number", required: false },
        { key: "furnished", label: "Furnished?", kind: "select", required: false },
        { key: "duration", label: "Lease term", kind: "select", required: false },
        { key: "subtype", label: "Sub type", kind: "select", required: false }
      ]
    },
    {
      title: "Move-in costs",
      sub: "Renters filter hard on this. A listing that states the real number up front gets fewer dead leads and fewer people walking away at the last step.",
      fields: [
        { key: "deposit", label: "Security deposit", kind: "number", required: false, placeholder: "1800" },
        { key: "movein", label: "Total cost to move in", kind: "number", required: false, hint: "Deposit plus first month plus any fees" }
      ]
    },
    {
      title: "Screening requirements",
      sub: "Stating these up front saves everyone time. Renters who cannot meet them move on, and the ones who do apply already know they qualify. Leave either blank if you would rather not screen on it.",
      fields: [
        { key: "mincredit", label: "Minimum credit score", kind: "number", required: false },
        { key: "minincome", label: "Minimum monthly income", kind: "number", required: false, placeholder: "5000" }
      ]
    },
    {
      hasDesc: true,
      title: "Describe the place",
      sub: "Renters skim for specifics, so lead with them: parking, laundry, pets, storage, what is within walking distance. Plain sentences do more work than a list of adjectives.",
      fields: [
        { key: "desc", label: "Description", kind: "textarea", required: true, hint: "Shown on the public listing" },
        { key: "terms", label: "Application process and lease terms", kind: "textarea", required: false, hint: "How to apply, pet policy, anything worth knowing before they ask" }
      ]
    },
    {
      title: "Review and go live",
      sub: "This is read back from the form itself, so it is exactly what will be saved.",
      note: "review",
      fields: []
    }
  ];

  var stepIndex = 0;

  // ---------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function fieldHTML(f) {
    var name = F[f.key];
    var live = one(name);
    var kind = f.kind;
    if (kind === "select-or-text") kind = (live && live.tagName === "SELECT") ? "select" : "number";
    if (!live) return "";

    var id = "lw-i-" + f.key;
    var cur = getField(name);
    var h = "<div class='lw-f' data-fkey='" + f.key + "'>";
    h += "<label for='" + id + "'>" + esc(f.label) + (f.required ? " *" : "");
    if (f.hint) h += " <span class='lw-hint'>" + esc(f.hint) + "</span>";
    h += "</label>";

    if (kind === "select") {
      var opts = optionsFor(name);
      h += "<select id='" + id + "' data-fkey='" + f.key + "'>";
      var hasBlank = false;
      for (var i = 0; i < opts.length; i++) if (opts[i].value === "") hasBlank = true;
      if (!hasBlank) h += "<option value=''>Choose...</option>";
      for (var j = 0; j < opts.length; j++) {
        var sel = String(opts[j].value) === String(cur) ? " selected" : "";
        h += "<option value='" + esc(opts[j].value) + "'" + sel + ">" + esc(opts[j].label) + "</option>";
      }
      h += "</select>";
    } else if (kind === "textarea") {
      h += "<textarea id='" + id + "' data-fkey='" + f.key + "'>" + esc(stripTags(cur)) + "</textarea>";
    } else {
      var im = kind === "number" ? " inputmode='numeric'" : "";
      var ph = f.placeholder ? " placeholder='" + esc(f.placeholder) + "'" : "";
      h += "<input type='text' id='" + id + "' data-fkey='" + f.key + "' value='" + esc(cur) + "'" + im + ph + ">";
    }
    h += "<div class='lw-err'></div></div>";
    return h;
  }

  function stripTags(s) {
    return String(s == null ? "" : s).replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  }

  function noteHTML(kind) {
    if (kind === "address") {
      return "<div class='lw-note'>Start typing the street address and pick it from the list. The map confirms " +
        "the pin. This one saves on its own as you choose it, separately from everything else.</div>" +
        "<div id='lw-addr-slot'></div>" +
        "<div id='lw-addr-state' class='lw-addrstate'>Pick the address from the dropdown so the map pin sets.</div>";
    }
    if (kind === "photos") {
      return "<div class='lw-note'><strong>Nothing to upload yet.</strong> Photos attach to the listing after it " +
        "is saved, so the upload comes at the end. This step is here first so you find out what is needed before " +
        "you fill anything in, rather than after.</div>" +
        "<p class='lw-eyebrow'>What is required</p>" +
        "<ul class='lw-check'>" +
        "<li>The outside: front, and the street it sits on</li>" +
        "<li>Every room, including each bedroom and each bathroom</li>" +
        "<li>The kitchen, with the appliances visible</li>" +
        "<li>Shared spaces: laundry, yard, garage, hallways, parking</li>" +
        "<li>Daylight, lights on, nothing blurry, no logos or watermarks</li>" +
        "</ul>" +
        "<div class='lw-warn'>A listing that goes live short of this gets set back to draft, with an email saying which " +
        "shots are missing. Faster to take them now than to do it twice.</div>";
    }
    if (kind === "review") return "<div id='lw-review'></div>";
    return "";
  }

  function stepHTML(s, i) {
    var h = "<div class='lw-step" + (i === 0 ? " on" : "") + "' data-step='" + i + "'>";
    h += "<p class='lw-eyebrow'>Step " + (i + 1) + " of " + STEPS.length + "</p>";
    h += "<h2 class='lw-h'>" + esc(s.title) + "</h2>";
    h += "<p class='lw-sub'>" + esc(s.sub) + "</p>";
    if (s.note) h += noteHTML(s.note);

    var body = "";
    for (var k = 0; k < s.fields.length; k++) body += fieldHTML(s.fields[k]);
    if (body) {
      var wide = s.fields.length > 3 ? "lw-grid" : "";
      h += wide ? "<div class='" + wide + "'>" + body + "</div>" : body;
    }

    // The review step builds its OWN button row inside renderReview, so the
    // generic row must not be added underneath it or the member sees two
    // Back buttons stacked.
    if (s.note !== "review") {
      h += "<div class='lw-row" + (i === 0 ? " end" : "") + "'>";
      if (i > 0) h += "<button type='button' class='lw-btn lw-ghost' data-act='back'>Back</button>";
      if (i < STEPS.length - 1) h += "<button type='button' class='lw-btn lw-navy' data-act='next'>Continue</button>";
      h += "</div>";
    }
    h += "</div>";
    return h;
  }

  function buildUI() {
    var h = "<div id='lw-card'><div id='lw-pips'>";
    for (var p = 0; p < STEPS.length; p++) h += "<div class='lw-pip" + (p === 0 ? " on" : "") + "'></div>";
    h += "</div>";
    for (var i = 0; i < STEPS.length; i++) h += stepHTML(STEPS[i], i);
    h += "</div><div class='lw-esc' id='lw-esc-line'><a data-act='togglenative'>Show all fields on one page</a></div>";
    return h;
  }

  // ---------------------------------------------------------------
  // REVIEW - reads back off the BD fields, never off the wizard inputs.
  // Bible rule 15: the read-back is the feature.
  // ---------------------------------------------------------------
  function renderReview() {
    var box = document.getElementById("lw-review");
    if (!box) return;
    var rows = [
      ["Listing title", F.title],
      ["Address", F.location],
      ["Monthly rent", F.price],
      ["Bedrooms", F.beds],
      ["Bathrooms", F.baths],
      ["Square feet", F.sqft],
      ["Property type", F.ptype],
      ["Lease term", F.duration],
      ["Furnished", F.furnished],
      ["Security deposit", F.deposit],
      ["Total to move in", F.movein],
      ["Minimum credit", F.mincredit],
      ["Minimum income", F.minincome],
      ["Description", F.desc]
    ];
    var h = "<table class='lw-rev'>";
    for (var i = 0; i < rows.length; i++) {
      if (!exists(rows[i][1])) continue;
      var v = rows[i][1] === F.desc ? stripTags(getField(rows[i][1])) : getFieldLabel(rows[i][1]);
      if (v && v.length > 90) v = v.slice(0, 90) + "...";
      var cls = v ? "" : " class='empty'";
      h += "<tr><td>" + esc(rows[i][0]) + "</td><td" + cls + ">" + esc(v || "not set") + "</td></tr>";
    }
    h += "</table>";

    if (!exists(F.golive)) {
      h += "<div class='lw-warn'>The go-live control is not on this page, so use the form's own save button below.</div>";
      h += "<div class='lw-row end'><button type='button' class='lw-btn lw-ghost' data-act='back'>Back</button>" +
           "<button type='button' class='lw-btn lw-navy' data-act='shownative'>Show the form</button></div>";
    } else {
      h += "<div class='lw-note'><strong>Photos come next.</strong> There is no photo upload on this form. " +
           "Once you save, the following page is where interior and exterior photos are added. If you leave now " +
           "you can get back to it any time from the listing" + AP + "s Actions menu, under Manage Photos.</div>";
      h += "<div class='lw-note'>Going live publishes this to renters immediately. Save as a draft instead if the " +
           "photos are not ready, then publish from the listing page once they are up.</div>";
      h += "<button type='button' class='lw-btn lw-go' data-act='golive'>Save and go live</button>";
      h += "<div id='lw-savelog'></div>";
      h += "<div class='lw-esc' style='margin-top:14px'>" +
           "<a data-act='golive-inpage'>Save without leaving this page (test)</a></div>";
      h += "<div class='lw-row'><button type='button' class='lw-btn lw-ghost' data-act='back'>Back</button>" +
           "<button type='button' class='lw-btn lw-ghost' data-act='draft'>Save as draft</button></div>";
    }
    box.innerHTML = h;
  }

  // ---------------------------------------------------------------
  // NAVIGATION + VALIDATION
  // ---------------------------------------------------------------
  function showStep(n) {
    var steps = document.querySelectorAll("#lw-card .lw-step");
    var pips = document.querySelectorAll("#lw-card .lw-pip");
    for (var i = 0; i < steps.length; i++) {
      if (i === n) steps[i].className = "lw-step on";
      else steps[i].className = "lw-step";
    }
    for (var j = 0; j < pips.length; j++) pips[j].className = "lw-pip" + (j <= n ? " on" : "");
    stepIndex = n;
    applyFormModeForStep(n);
    if (STEPS[n] && STEPS[n].note === "address") {
      paintAddressState();
      startAddressWatch();
      nudgeMap();
    }
    if (STEPS[n] && STEPS[n].note === "review") renderReview();
    try {
      var card = document.getElementById("lw-card");
      if (card && card.getBoundingClientRect().top < 0) card.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {}
  }

  function validateStep(n) {
    var ok = true;
    var s = STEPS[n];
    if (!s) return true;
    for (var i = 0; i < s.fields.length; i++) {
      var f = s.fields[i];
      if (!f.required) continue;
      var wrap = document.querySelector("#lw-card .lw-step[data-step='" + n + "'] .lw-f[data-fkey='" + f.key + "']");
      if (!wrap) continue;
      var input = wrap.querySelector("input,select,textarea");
      var errBox = wrap.querySelector(".lw-err");
      var val = input ? String(input.value || "").trim() : "";
      if (!val) {
        wrap.className = "lw-f bad";
        if (errBox) errBox.textContent = f.label + " is needed before you continue.";
        ok = false;
      } else {
        wrap.className = "lw-f";
        if (errBox) errBox.textContent = "";
      }
    }
    return ok;
  }

  // ---------------------------------------------------------------
  // MIRROR - every wizard input writes straight through to the BD field.
  // This is what makes stage A (auto-submit) nearly free later: by the
  // time the user reaches Review, BD's own form is already fully filled.
  // ---------------------------------------------------------------
  function bindMirror(root) {
    function push(e) {
      var t = e.target;
      var key = t && t.getAttribute ? t.getAttribute("data-fkey") : null;
      if (!key || !F[key]) return;
      setField(F[key], isMoneyKey(key) ? cleanMoney(t.value) : t.value);
    }
    root.addEventListener("input", push, true);
    root.addEventListener("change", push, true);
    // On blur, show the member the same clean number that was stored, so what
    // is on screen and what BD holds can never disagree.
    root.addEventListener("blur", function (e) {
      var t = e.target;
      var key = t && t.getAttribute ? t.getAttribute("data-fkey") : null;
      if (!key || !isMoneyKey(key)) return;
      var c = cleanMoney(t.value);
      if (t.value !== c) t.value = c;
      setField(F[key], c);
    }, true);
  }

  // ---------------------------------------------------------------
  // SUBMIT
  // ---------------------------------------------------------------
  function submitForm(goLive) {
    if (exists(F.golive)) {
      var wrote = setField(F.golive, goLive ? "1" : "0");
      var back = getField(F.golive);
      log("go-live write:", goLive ? "1" : "0", "read back:", back, "ok:", wrote);
      if (goLive && String(back) !== "1") {
        alert("The go-live setting did not take. Scroll down to the form and set 'Are you ready to set your listing live?' to Yes, then save there.");
        showNative(true);
        return;
      }
    }
    var btns = submitButtons();
    if (btns.length) { btns[0].click(); return; }
    if (FORM) { try { FORM.submit(); return; } catch (e) {} }
    alert("Could not find the save button. Scroll down and use the form's own save button.");
    showNative(true);
  }

  // -------------------------------------------------------------
  // FORM VISIBILITY - three states, only ever ONE interface on screen.
  //   "hidden"  steps 2-7. Wizard only.
  //   "address" step 1. Wizard, plus ONLY the address block of BD's form.
  //   "full"    escape hatch. BD's raw form, wizard collapsed.
  //
  // The address block is ISOLATED, never moved. Those inputs must stay
  // inside the form element or they drop out of the details POST, and the
  // geocode widget is bound to the real input. So the other direct children
  // of the form are hidden around it instead.
  // -------------------------------------------------------------
  var formChildState = null;

  function formChildren() {
    if (!FORM) return [];
    var out = [];
    for (var i = 0; i < FORM.children.length; i++) {
      var c = FORM.children[i];
      var tag = c.tagName;
      if (tag === "INPUT" && (c.type || "").toLowerCase() === "hidden") continue;
      if (tag === "SCRIPT" || tag === "STYLE") continue;
      out.push(c);
    }
    return out;
  }

  // The address region is THREE things on BD's form, confirmed from a live
  // screenshot: the geocoding autocomplete input, the Google map, and a
  // separate "Property Location" textarea holding the public display string.
  // Returning one container showed whichever came first, often the read-only
  // display box rather than the input that actually feeds the map. So collect
  // every form child that holds any part of the address region.
  function topLevelBlockOf(node) {
    if (!node || !FORM) return null;
    var n = node;
    while (n && n.parentNode && n.parentNode !== FORM) n = n.parentNode;
    return n && n.parentNode === FORM ? n : null;
  }

  function addressAutocomplete() {
    var byId = document.getElementById("pac-input");
    if (byId) return byId;
    var scope = FORM || document;
    var ins = scope.querySelectorAll("input[type=text], input:not([type])");
    for (var i = 0; i < ins.length; i++) {
      var ph = (ins[i].getAttribute("placeholder") || "").toLowerCase();
      if (ph.indexOf("main st") !== -1 || (ph.indexOf("example") !== -1 && ph.indexOf(",") !== -1 && /[0-9]{5}/.test(ph))) return ins[i];
      var cls = (ins[i].className || "") + " " + (ins[i].id || "") + " " + (ins[i].getAttribute("name") || "");
      if (cls.toLowerCase().indexOf("autocomplete") !== -1 || cls.toLowerCase().indexOf("pac-") !== -1) return ins[i];
    }
    return null;
  }

  function mapNode() {
    var scope = FORM || document;
    var cands = scope.querySelectorAll("div");
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      var id = (c.id || "") + " " + (c.className || "");
      if (id.toLowerCase().indexOf("map") !== -1 && c.offsetHeight > 80) return c;
      if (c.querySelector && c.querySelector("a[href*='maps.google']")) return c;
    }
    return null;
  }

  // THE ADDRESS WIDGET IS RELOCATABLE. Its container (div.well) holds the
  // Places autocomplete and the map and NOTHING WITH A NAME ATTRIBUTE, so
  // moving it out of the form drops nothing from the POST. The named fields
  // it feeds (lat, lon, country_sn, state_sn, post_location) are separate
  // hidden inputs that stay put. Moving a node carries its event listeners,
  // so Google's binding travels with it. This is what lets the raw form be
  // hidden completely instead of half-shown.
  var addrMoved = false;

  function addressWidgetContainer() {
    var pac = addressAutocomplete();
    if (!pac) return null;
    var block = topLevelBlockOf(pac);
    if (!block) return null;
    var named = block.querySelectorAll("input[name], select[name], textarea[name]");
    if (named.length) { log("address block carries named fields, will not move it", named.length); return null; }
    return block;
  }

  function relocateAddressWidget() {
    if (addrMoved) return true;
    var block = addressWidgetContainer();
    var slot = document.getElementById("lw-addr-slot");
    if (!block || !slot) return false;
    slot.appendChild(block);
    block.style.display = "";
    addrMoved = true;
    log("address widget relocated into the wizard");
    return true;
  }

  function addressBlocks() {
    var seen = [];
    function add(node) {
      var b = topLevelBlockOf(node);
      if (!b) return;
      for (var i = 0; i < seen.length; i++) if (seen[i] === b) return;
      seen.push(b);
    }
    add(addressAutocomplete());
    add(mapNode());
    add(one(F.location));
    add(one(F.address1));
    add(one(F.city));
    add(one(F.zip));
    return seen;
  }

  // The wizard already collects the listing title, so BD's own title field
  // must not reappear inside a shown address block.
  function hideTitleWithin(blocks) {
    var t = one(F.title);
    if (!t) return;
    var b = topLevelBlockOf(t);
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i] !== b) continue;
      // Same container as the address. Hide just the title input's own row.
      var row = t;
      var hops = 0;
      while (row && row.parentNode && row.parentNode !== blocks[i] && hops < 4) { row = row.parentNode; hops++; }
      if (row && row.parentNode === blocks[i]) row.style.display = "none";
      return;
    }
  }

  function captureChildState() {
    if (formChildState) return;
    formChildState = [];
    var kids = formChildren();
    for (var i = 0; i < kids.length; i++) {
      formChildState.push({ node: kids[i], display: kids[i].style.display });
    }
  }

  function restoreChildren() {
    if (!formChildState) return;
    for (var i = 0; i < formChildState.length; i++) {
      formChildState[i].node.style.display = formChildState[i].display;
    }
  }

  function setEscLabel(html) {
    var esc = document.getElementById("lw-esc-line");
    if (esc) esc.innerHTML = html;
  }

  function setFormMode(mode) {
    var n = document.getElementById("lw-native");
    var card = document.getElementById("lw-card");
    if (!n) return;
    captureChildState();

    if (mode === "full") {
      restoreChildren();
      n.className = "show";
      if (card) card.style.display = "none";
      setEscLabel("<a data-act='usewizard'>Back to step-by-step</a>");
      return;
    }

    if (card) card.style.display = "";
    setEscLabel("<a data-act='togglenative'>Show all fields on one page</a>");

    if (mode === "address") {
      if (relocateAddressWidget()) { n.className = ""; return; }
      var blocks = addressBlocks();
      if (!blocks.length) { n.className = ""; return; }
      var kids = formChildren();
      for (var i = 0; i < kids.length; i++) {
        var show = false;
        for (var j = 0; j < blocks.length; j++) if (kids[i] === blocks[j]) show = true;
        kids[i].style.display = show ? "" : "none";
      }
      hideTitleWithin(blocks);
      n.className = "show address-only";
      return;
    }

    if (mode === "desc") {
      var dblock = topLevelBlockOf(one(F.desc));
      if (!dblock) { n.className = ""; return; }
      var dk = formChildren();
      for (var a = 0; a < dk.length; a++) dk[a].style.display = (dk[a] === dblock) ? "" : "none";
      n.className = "show address-only";
      return;
    }

    n.className = "";
  }

  // OPT-IN, NOT THE DEFAULT PATH. Posts BD's own form with fetch so the page
  // does not navigate. The body is new FormData(FORM), which serialises the
  // real form exactly as BD would: CSRF token, both money twins, the hidden
  // property_price BD syncs, everything, in BD's order. Hand-building that
  // body is the mistake this avoids.
  //
  // It DELIBERATELY DOES NOT FALL BACK to clicking Save on failure. A fetch
  // that throws may still have reached the server, and a second submit would
  // create a duplicate listing. On any problem it reports and stops, and the
  // green button is still there.
  var savingInPage = false;

  function submitInPage(goLive) {
    if (savingInPage) return;
    var out = document.getElementById("lw-savelog");
    function say(html, cls) {
      if (out) out.innerHTML = "<div class='" + (cls || "lw-note") + "' style='margin-top:14px'>" + html + "</div>";
    }
    if (!FORM || !window.FormData || !window.fetch) {
      say("This browser cannot do the in-page save. Use the green button above.", "lw-warn");
      return;
    }
    if (exists(F.golive)) {
      setField(F.golive, goLive ? "1" : "0");
      if (goLive && String(getField(F.golive)) !== "1") {
        say("The go-live setting did not take. Use the green button above.", "lw-warn");
        return;
      }
    }
    savingInPage = true;
    say("Saving...");
    var action = FORM.getAttribute("action") || window.location.pathname;
    var fd;
    try { fd = new window.FormData(FORM); }
    catch (e) { savingInPage = false; say("Could not read the form: " + esc(String(e)), "lw-warn"); return; }

    var started = new Date().getTime();
    window.fetch(action, { method: "POST", body: fd, credentials: "same-origin", redirect: "follow" })
      .then(function (r) {
        return r.text().then(function (txt) {
          var ms = new Date().getTime() - started;
          var rep = ["status: " + r.status + " " + r.statusText,
                     "final url: " + (r.url || "(none)"),
                     "redirected: " + (r.redirected === true),
                     "body length: " + txt.length,
                     "took: " + ms + "ms",
                     "body starts: " + txt.slice(0, 300)].join(String.fromCharCode(10));
          say("<strong>Saved without leaving the page.</strong> Report below, copy it to Claude." +
              "<textarea readonly style='width:100%;height:120px;margin-top:9px;font-family:monospace;font-size:11px;" +
              "border:1px solid #ccd4de;border-radius:6px;padding:8px'>" + esc(rep) + "</textarea>" +
              "<p style='font-size:12.5px;color:#5b6b7d;margin:8px 0 0'>Check your listings before saving again, " +
              "so this cannot create a second copy.</p>");
          savingInPage = false;
        });
      })
      .catch(function (e) {
        say("<strong>The in-page save failed:</strong> " + esc(String(e)) +
            "<p style='font-size:12.5px;margin:8px 0 0'>It may still have reached the server, so check your " +
            "listings before pressing the green button, or you could end up with two.</p>", "lw-warn");
        savingInPage = false;
      });
  }

  function showNative(force) {
    if (force) setFormMode("full");
  }

  // READ BACK THE GEOCODE. The widget saves itself, so the only proof it
  // fired is lat/lon landing in the hidden inputs. Bible rule 15.
  function addressState() {
    // FAIL OPEN. If this form has no lat/lon at all there is nothing to
    // confirm, so the gate must not exist. Gating on a field that cannot be
    // filled would trap the member on step 1 with no way forward, which is
    // a worse failure than an unverified address.
    if (!exists(F.lat) || !exists(F.lon)) return { skip: true, ok: true, text: "" };
    var la = getField(F.lat), lo = getField(F.lon);
    var loc = stripTags(getField(F.location));
    if (la && lo && String(la) !== "0" && String(lo) !== "0") {
      return { ok: true, text: loc || (la + ", " + lo) };
    }
    return { ok: false, text: "" };
  }

  // A map that was laid out while hidden needs a poke once it is on screen.
  // Firing a window resize is the portable way to do that without holding a
  // reference to BD's map instance.
  function nudgeMap() {
    try {
      if (window.google && window.google.maps && window.google.maps.event) {
        window.google.maps.event.trigger(window, "resize");
      }
    } catch (e) {}
    try { window.dispatchEvent(new Event("resize")); }
    catch (e) {
      try {
        var ev = document.createEvent("HTMLEvents");
        ev.initEvent("resize", true, false);
        window.dispatchEvent(ev);
      } catch (e2) {}
    }
  }

  function startAddressWatch() {
    if (window.__rdcLwAddrWatch) return;
    window.__rdcLwAddrWatch = setInterval(function () {
      if (STEPS[stepIndex] && STEPS[stepIndex].note === "address") paintAddressState();
    }, 900);
  }

  function paintAddressState() {
    var box = document.getElementById("lw-addr-state");
    if (!box) return true;
    var st = addressState();
    if (st.skip) { box.innerHTML = ""; box.className = "lw-addrstate skip"; return true; }
    if (st.ok) {
      box.className = "lw-addrstate ok";
      box.innerHTML = "Location saved: " + esc(st.text);
    } else {
      box.className = "lw-addrstate";
      box.innerHTML = "No location saved yet. Pick the address from the dropdown so the map pin sets.";
    }
    return st.ok;
  }

  function applyFormModeForStep(n) {
    if (STEPS[n] && STEPS[n].note === "address") setFormMode("address");
    else setFormMode("hidden");
  }

  // ---------------------------------------------------------------
  // MOUNT
  // ---------------------------------------------------------------
  function mount() {
    FORM = findForm();
    if (!FORM) { log("BD listing form not found, standing down"); return; }
    if (!MOUNT_UI) {
      if (!window.__rdcLwToldOff) {
        window.__rdcLwToldOff = true;
        try {
          console.log("[Listing wizard] " + LW_VERSION + " - UI OFF. BD's form is untouched.");
        } catch (e) {}
        mountReportPanel();
      }
      return;
    }
    if (document.getElementById("lw-wrap")) return;

    auditFields();
    if (!exists(F.price) && !exists(F.title)) {
      log("core fields absent, standing down rather than showing an empty wizard");
      return;
    }

    var style = document.createElement("style");
    style.id = "lw-style";
    style.appendChild(document.createTextNode(CSS));
    document.head.appendChild(style);

    var wrap = document.createElement("div");
    wrap.id = "lw-wrap";
    wrap.innerHTML = buildUI();

    var native = document.createElement("div");
    native.id = "lw-native";
    FORM.parentNode.insertBefore(wrap, FORM);
    FORM.parentNode.insertBefore(native, FORM);
    native.appendChild(FORM);

    bindMirror(wrap);

    wrap.addEventListener("click", function (e) {
      var t = e.target;
      var act = t && t.getAttribute ? t.getAttribute("data-act") : null;
      if (!act) return;
      e.preventDefault();
      if (act === "next") {
        if (!validateStep(stepIndex)) return;
        if (STEPS[stepIndex] && STEPS[stepIndex].note === "address" && !paintAddressState()) return;
        if (STEPS[stepIndex] && STEPS[stepIndex].hasDesc && !verifyDescription()) return;
        showStep(Math.min(stepIndex + 1, STEPS.length - 1));
      }
      else if (act === "back") showStep(Math.max(stepIndex - 1, 0));
      else if (act === "golive") submitForm(true);
      else if (act === "golive-inpage") submitInPage(true);
      else if (act === "draft") submitForm(false);
      else if (act === "shownative") setFormMode("full");
      else if (act === "togglenative") setFormMode("full");
      else if (act === "usewizard") applyFormModeForStep(stepIndex);
    });

    // The first step is rendered with class "on" directly in the HTML, so
    // showStep() never runs for it. Anything showStep does had to be done
    // here too, which is why the address strip rendered empty: it was styled
    // by the markup and only filled by showStep.
    // Relocate the map ONCE, at mount, even though the address step is no
    // longer first. Google Maps paints grey tiles when its container is
    // moved or sized while hidden, so the move should happen as early as
    // possible and only once.
    relocateAddressWidget();
    applyFormModeForStep(0);
    paintAddressState();
    startAddressWatch();

    log("mounted", { level: LEVEL, missing: missing.length });
  }

  // -------------------------------------------------------------
  // ON-PAGE REPORT PANEL. Shown only while MOUNT_UI is false.
  // The console route failed twice in practice, so the report is put on
  // the page with a copy button. It READS the form and nothing else.
  // -------------------------------------------------------------
  function mountReportPanel() {
    if (document.getElementById("lw-report")) return;
    if (!FORM) return;

    var css = document.createElement("style");
    css.appendChild(document.createTextNode([
      "#lw-report{font-family:inherit;max-width:860px;margin:0 0 22px;background:#f7f9fb;border:1px solid #dbe2ea;border-radius:10px;padding:18px 20px}",
      "#lw-report h3{margin:0 0 6px;font-size:16px;color:#0d2d4e;font-weight:600}",
      "#lw-report p{margin:0 0 12px;font-size:13px;color:#5b6b7d;line-height:1.5}",
      "#lw-report textarea{width:100%;min-height:130px;font-family:monospace;font-size:11px;line-height:1.45;border:1px solid #ccd4de;border-radius:7px;padding:10px;color:#25333f;background:#fff}",
      "#lw-report .lw-rbtns{display:flex;gap:8px;margin-top:10px;align-items:center}",
      "#lw-report button{border:0;border-radius:7px;padding:9px 18px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;background:#0d2d4e;color:#fff}",
      "#lw-report button.ghost{background:#fff;color:#0d2d4e;border:1px solid #ccd4de}",
      "#lw-report .lw-rmsg{font-size:12.5px;color:#1e8449;font-weight:600}"
    ].join("")));
    document.head.appendChild(css);

    var box = document.createElement("div");
    box.id = "lw-report";
    box.innerHTML =
      "<h3>Listing form report</h3>" +
      "<p>Diagnostic only. Nothing on this page has been changed. Press Copy, paste it back to Claude, " +
      "and this panel goes away with the next build.</p>" +
      "<textarea id='lw-rtext' readonly></textarea>" +
      "<div class='lw-rbtns'><button type='button' id='lw-rcopy'>Copy report</button>" +
      "<button type='button' class='ghost' id='lw-rhide'>Hide</button>" +
      "<span class='lw-rmsg' id='lw-rmsg'></span></div>";

    FORM.parentNode.insertBefore(box, FORM);

    var ta = document.getElementById("lw-rtext");
    try { ta.value = window.rdcLwDump(); } catch (e) { ta.value = "report failed: " + e; }

    document.getElementById("lw-rcopy").onclick = function () {
      var msg = document.getElementById("lw-rmsg");
      try {
        ta.removeAttribute("readonly");
        ta.select();
        ta.setSelectionRange(0, 999999);
        var done = false;
        try { done = document.execCommand("copy"); } catch (e) {}
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(ta.value);
          done = true;
        }
        ta.setAttribute("readonly", "readonly");
        msg.textContent = done ? "Copied. Paste it to Claude." : "Select the text above and copy.";
      } catch (e2) {
        msg.textContent = "Select the text above and copy.";
      }
    };
    document.getElementById("lw-rhide").onclick = function () { box.style.display = "none"; };
  }

  // Panel that surfaces whatever the recorder caught. Appears on any
  // /account/properties page as soon as a non-analytics request is seen,
  // which on the Manage Photos page means the upload call itself.
  function netReport() {
    var L = ["=== RENTERS NETWORK CAPTURE  " + LW_VERSION + " ===",
             "page: " + window.location.pathname, "calls: " + NETLOG.length, ""];
    for (var i = 0; i < NETLOG.length; i++) {
      var r = NETLOG[i];
      L.push("[" + (i + 1) + "] " + r.when + "  " + r.kind + "  " + r.method + "  " + r.url);
      if (r.body) L.push("    body: " + r.body);
      if (r.extra) L.push("    " + r.extra);
      L.push("");
    }
    L.push("=== END CAPTURE ===");
    return L.join(String.fromCharCode(10));
  }
  window.rdcLwNetDump = netReport;

  function paintNetPanel() {
    if (MOUNT_UI && document.getElementById("lw-wrap")) return;
    if (!NETLOG.length) return;
    var panel = document.getElementById("lw-netpanel");
    if (!panel) {
      var st = document.createElement("style");
      st.appendChild(document.createTextNode([
        "#lw-netpanel{position:fixed;right:16px;bottom:16px;width:420px;max-width:92vw;z-index:99999;",
        "background:#fff;border:1px solid #dbe2ea;border-radius:10px;box-shadow:0 6px 24px rgba(13,45,78,.18);",
        "padding:14px 16px;font-family:inherit}",
        "#lw-netpanel h4{margin:0 0 4px;font-size:14px;color:#0d2d4e;font-weight:600}",
        "#lw-netpanel p{margin:0 0 9px;font-size:12px;color:#5b6b7d;line-height:1.45}",
        "#lw-netpanel textarea{width:100%;height:120px;font-family:monospace;font-size:10.5px;line-height:1.4;",
        "border:1px solid #ccd4de;border-radius:6px;padding:8px;color:#25333f}",
        "#lw-netpanel .r{display:flex;gap:7px;align-items:center;margin-top:8px}",
        "#lw-netpanel button{border:0;border-radius:6px;padding:8px 15px;font-size:12.5px;font-weight:600;",
        "cursor:pointer;font-family:inherit;background:#0d2d4e;color:#fff}",
        "#lw-netpanel button.g{background:#fff;color:#0d2d4e;border:1px solid #ccd4de}",
        "#lw-netpanel .m{font-size:12px;color:#1e8449;font-weight:600}"
      ].join("")));
      document.head.appendChild(st);

      panel = document.createElement("div");
      panel.id = "lw-netpanel";
      panel.innerHTML = "<h4>Network capture</h4>" +
        "<p>Recording what this page sends. Upload one photo, then press Copy and paste it to Claude.</p>" +
        "<textarea id='lw-nettext' readonly></textarea>" +
        "<div class='r'><button type='button' id='lw-netcopy'>Copy</button>" +
        "<button type='button' class='g' id='lw-nethide'>Hide</button>" +
        "<span class='m' id='lw-netmsg'></span></div>";
      document.body.appendChild(panel);

      document.getElementById("lw-netcopy").onclick = function () {
        var ta = document.getElementById("lw-nettext");
        var msg = document.getElementById("lw-netmsg");
        try {
          ta.removeAttribute("readonly"); ta.select(); ta.setSelectionRange(0, 999999);
          var done = false;
          try { done = document.execCommand("copy"); } catch (e) {}
          if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(ta.value); done = true; }
          ta.setAttribute("readonly", "readonly");
          msg.textContent = done ? "Copied." : "Select and copy.";
        } catch (e2) { msg.textContent = "Select and copy."; }
      };
      document.getElementById("lw-nethide").onclick = function () { panel.style.display = "none"; };
    }
    var t = document.getElementById("lw-nettext");
    if (t) t.value = netReport();
  }

  function ready(fn) {
    if (document.readyState === "complete" || document.readyState === "interactive") setTimeout(fn, 60);
    else document.addEventListener("DOMContentLoaded", function () { setTimeout(fn, 60); });
  }

  ready(function () {
    mount();
    // BD renders parts of this page async. Retry a few times, then stop.
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (document.getElementById("lw-wrap") || document.getElementById("lw-report") || tries > 12) { clearInterval(t); return; }
      mount();
    }, 500);
  });
})();
`;

exports.handler = async function (event) {
  const qs = (event && event.queryStringParameters) || {};

  if (qs.version === "1") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ version: LW_VERSION, bytes: WIZARD.length })
    };
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-LW-Version": LW_VERSION
    },
    body: WIZARD
  };
};
