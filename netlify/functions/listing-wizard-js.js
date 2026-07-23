// lw-v4   <-- PASTE CHECK: this is the version. Must match ?version=1
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

const LW_VERSION = "lw-v4";

const WIZARD = String.raw`(function () {
  "use strict";

  var LW_VERSION = "lw-v4";
  var DEBUG = false;

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

  function log() {
    if (!DEBUG) return;
    try { console.log.apply(console, ["[Listing wizard]"].concat([].slice.call(arguments))); } catch (e) {}
  }
  try { console.log("[Listing wizard] version:", LW_VERSION); } catch (e) {}

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
  var F = {
    title:      "group_name",
    price:      "property_price",
    beds:       "property_baths",        // <-- BEDROOMS. Correct. See above.
    baths:      "property_beds",         // <-- BATHROOMS. Correct. See above.
    sqft:       "property_sqr_foot",
    year:       "year_built",
    ptype:      "property_type",
    subtype:    "sub_property_type",
    duration:   "property_duration",
    furnished:  "status",
    deposit:    "deposit_amount",
    promo:      "post_promo",
    movein:     "total_cost_to_movei",
    mincredit:  "minimum_cc_requ",
    minincome:  "minimum_income_requ",
    desc:       "group_desc",
    terms:      "group_desc_2",
    golive:     "group_status",
    location:   "post_location",
    address1:   "address1",
    city:       "city",
    zip:        "zip_code",
    lat:        "lat",
    lon:        "lon"
  };

  // ---------------------------------------------------------------
  // FORM DISCOVERY
  // ---------------------------------------------------------------
  var FORM = null;
  function findForm() {
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
  function one(name) { var n = el(name); return n ? n[0] : null; }
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
    var first = nodes[0];
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
    // WYSIWYG mirrors: BD may back group_desc with an editor iframe.
    syncEditor(name, value);
    return true;
  }

  function getField(name) {
    var nodes = el(name);
    if (!nodes) return "";
    var first = nodes[0];
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

  function syncEditor(name, value) {
    try {
      if (window.tinymce && window.tinymce.get && window.tinymce.get(name)) {
        window.tinymce.get(name).setContent(value);
        return;
      }
      if (window.CKEDITOR && window.CKEDITOR.instances && window.CKEDITOR.instances[name]) {
        window.CKEDITOR.instances[name].setData(value);
        return;
      }
    } catch (e) {}
  }

  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, ""); }

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

  function submitButtons() {
    var scope = FORM || document;
    var list = scope.querySelectorAll("input[type=submit], button[type=submit], button.btn-submit, #save_form");
    return [].slice.call(list);
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
    "#lw-native{display:none}",
    "#lw-native.show{display:block}",
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
      title: "Where is it?",
      sub: "Start with the address. It has to be entered in the field below so the map pin and geocode are saved before anything else.",
      note: "address",
      fields: [
        { key: "title", label: "Listing title", kind: "text", required: true, hint: "What renters see first. City and street, or the building name." }
      ]
    },
    {
      title: "The basics",
      sub: "Rent, size and layout. These are the filters renters search on, so they matter more than the description.",
      fields: [
        { key: "price", label: "Monthly rent", kind: "number", required: true, hint: "Numbers only" },
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
      sub: "Renters filter hard on this. Listings that state the real move-in number get far fewer dead enquiries.",
      fields: [
        { key: "deposit", label: "Security deposit", kind: "number", required: false, hint: "Numbers only" },
        { key: "movein", label: "Total cost to move in", kind: "number", required: false, hint: "Deposit plus first month plus any fees" },
        { key: "promo", label: "Promotional rent", kind: "number", required: false, hint: "Leave blank if none" }
      ]
    },
    {
      title: "Screening requirements",
      sub: "State these up front. Renters on Renters.com are identity verified, and many have verified income, so a stated minimum filters rather than deters.",
      fields: [
        { key: "mincredit", label: "Minimum credit score", kind: "number", required: false },
        { key: "minincome", label: "Minimum monthly income", kind: "number", required: false, hint: "Numbers only" }
      ]
    },
    {
      title: "Describe the place",
      sub: "Write it rough. Plain sentences beat a list of adjectives, and renters skim for specifics: parking, laundry, pets, what is nearby.",
      fields: [
        { key: "desc", label: "Description", kind: "textarea", required: true, hint: "Rough is fine" },
        { key: "terms", label: "Screening and terms note", kind: "textarea", required: false, hint: "Application process, pet policy, anything a renter should know before applying" }
      ]
    },
    {
      title: "Photos",
      sub: "Photos are the single biggest driver of enquiries, and this platform holds a standard. Listings that fall short get set back to draft.",
      note: "photos",
      fields: []
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
      var t = kind === "number" ? "text" : "text";
      var im = kind === "number" ? " inputmode='numeric'" : "";
      h += "<input type='" + t + "' id='" + id + "' data-fkey='" + f.key + "' value='" + esc(cur) + "'" + im + ">";
    }
    h += "<div class='lw-err'></div></div>";
    return h;
  }

  function stripTags(s) {
    return String(s == null ? "" : s).replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  }

  function noteHTML(kind) {
    if (kind === "address") {
      return "<div class='lw-note'><strong>The address field is below this wizard, on the form itself.</strong> " +
        "It saves on its own the moment it is complete, separately from everything else, so fill it in first and " +
        "wait for the map to settle. Everything after this step is handled here.</div>" +
        "<div class='lw-esc'><a data-act='shownative'>Show the address field</a></div>";
    }
    if (kind === "photos") {
      return "<div class='lw-note'>Photos upload on their own page after this form is saved. Finish here, hit " +
        "<strong>Save and go live</strong>, then use <strong>Actions, Manage Photos</strong> on the listing.</div>" +
        "<p class='lw-eyebrow'>What is required</p>" +
        "<ul class='lw-check'>" +
        "<li>The outside: front, and the street it sits on</li>" +
        "<li>Every room, including each bedroom and each bathroom</li>" +
        "<li>The kitchen, with the appliances visible</li>" +
        "<li>Shared spaces: laundry, yard, garage, hallways, parking</li>" +
        "<li>Daylight, lights on, nothing blurry, no logos or watermarks</li>" +
        "</ul>" +
        "<div class='lw-warn'>A listing that goes live short of this gets set back to draft and you will get an email " +
        "saying which photos are missing. It is faster to shoot them now.</div>";
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

    h += "<div class='lw-row" + (i === 0 ? " end" : "") + "'>";
    if (i > 0) h += "<button type='button' class='lw-btn lw-ghost' data-act='back'>Back</button>";
    if (i < STEPS.length - 1) h += "<button type='button' class='lw-btn lw-navy' data-act='next'>Continue</button>";
    h += "</div></div>";
    return h;
  }

  function buildUI() {
    var h = "<div id='lw-card'><div id='lw-pips'>";
    for (var p = 0; p < STEPS.length; p++) h += "<div class='lw-pip" + (p === 0 ? " on" : "") + "'></div>";
    h += "</div>";
    for (var i = 0; i < STEPS.length; i++) h += stepHTML(STEPS[i], i);
    h += "</div><div class='lw-esc'><a data-act='togglenative'>Prefer the original form? Show it</a></div>";
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
      h += "<div class='lw-note'>Going live publishes this to renters immediately. Save as a draft instead if the " +
           "photos are not ready, then publish from the listing page once they are up.</div>";
      h += "<button type='button' class='lw-btn lw-go' data-act='golive'>Save and go live</button>";
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
    root.addEventListener("input", function (e) {
      var t = e.target;
      var key = t && t.getAttribute ? t.getAttribute("data-fkey") : null;
      if (!key || !F[key]) return;
      setField(F[key], t.value);
    }, true);
    root.addEventListener("change", function (e) {
      var t = e.target;
      var key = t && t.getAttribute ? t.getAttribute("data-fkey") : null;
      if (!key || !F[key]) return;
      setField(F[key], t.value);
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

  function showNative(force) {
    var n = document.getElementById("lw-native");
    if (!n) return;
    if (force) { n.className = "show"; return; }
    n.className = n.className === "show" ? "" : "show";
  }

  // ---------------------------------------------------------------
  // MOUNT
  // ---------------------------------------------------------------
  function mount() {
    FORM = findForm();
    if (!FORM) { log("BD listing form not found, standing down"); return; }
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
      if (act === "next") { if (validateStep(stepIndex)) showStep(Math.min(stepIndex + 1, STEPS.length - 1)); }
      else if (act === "back") showStep(Math.max(stepIndex - 1, 0));
      else if (act === "golive") submitForm(true);
      else if (act === "draft") submitForm(false);
      else if (act === "shownative") showNative(true);
      else if (act === "togglenative") showNative(false);
    });

    // The address widget lives on BD's form and saves itself. Step 1 needs it
    // reachable, so the native form is visible while the wizard sits on step 1.
    showNative(true);

    log("mounted", { level: LEVEL, missing: missing.length });
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
      if (document.getElementById("lw-wrap") || tries > 12) { clearInterval(t); return; }
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
