// ==================================================================
// alerts-card-js.js  —  ac-v15
// Daily listing alerts card for /account/home. Served from Netlify;
// head code carries only the 6-line loader stub.
//
// Backend: alerts-prefs.js ap-v8. Voice: alerts-voice.js av-v1.
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

const FN_VERSION = "ac-v15";
const PREFS = "https://renters-story-writer.netlify.app/.netlify/functions/alerts-prefs";
const VOICE = "https://renters-story-writer.netlify.app/.netlify/functions/alerts-voice";

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
  var LABEL = ${JSON.stringify(LABELS)};
  var MAX = 5;
  var MUST_CAP = 3;
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
    card: "background:#fff;border:1px solid #e3e8ef;border-radius:14px;padding:20px 20px 28px;margin:16px 0;font-family:inherit;",
    h: "margin:0 0 4px;font-size:18px;font-weight:700;color:#0f2545;",
    sub: "margin:0 0 16px;font-size:14px;color:#5b6b82;line-height:1.45;",
    row: "display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;",
    lab: "display:block;font-size:13px;font-weight:600;color:#0f2545;margin:0 0 6px;",
    hint: "display:block;font-size:12px;color:#7a8ba1;margin:0 0 8px;line-height:1.4;",
    inp: "width:100%;padding:10px 12px;border:1px solid #d7dee8;border-radius:9px;font-size:15px;box-sizing:border-box;",
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
    item: "border:1px solid #e3e8ef;border-radius:11px;padding:14px 16px;margin:0 0 10px;background:#fff;",
    itemOff: "border:1px solid #eceff3;border-radius:11px;padding:14px 16px;margin:0 0 10px;background:#fafbfc;",
    itemName: "font-size:15px;font-weight:700;color:#0f2545;margin:0;display:inline-block;",
    itemLine: "font-size:14px;color:#33475f;margin:6px 0 2px;",
    itemMuted: "font-size:12px;color:#7a8ba1;margin:0;",
    acts: "margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;",
    warn: "background:#fff8e8;border:1px solid #f0e0bd;border-radius:11px;padding:14px 16px;margin:0 0 14px;",
    warnTxt: "font-size:13px;color:#7a5c14;margin:0;line-height:1.5;",
    heard: "background:#f2f9f7;border:1px solid #cfe8e2;border-radius:11px;padding:14px 16px;margin:0 0 14px;",
    fold: "border-top:1px solid #eceff3;margin:18px 0 0;padding-top:16px;",
    consent: "border-top:1px solid #eceff3;margin:18px 0 0;padding-top:16px;",
    cRow: "display:flex;gap:10px;align-items:flex-start;margin:0 0 12px;cursor:pointer;",
    cBox: "margin:2px 0 0;flex:0 0 auto;width:17px;height:17px;cursor:pointer;",
    cLab: "font-size:13px;color:#33475f;line-height:1.45;margin:0;",
    live: "font-size:14px;color:#33475f;background:#f7f9fb;border:1px solid #e3e8ef;border-radius:9px;padding:12px;min-height:64px;line-height:1.5;margin:0 0 12px;"
  };

  var state = {
    searches: [], consent: { platform: false, off_platform: false },
    enabled: false, view: "list", editIdx: -1, draft: null,
    savedAt: null, busy: false, areas: null, areasRead: false, anchor: "",
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

  // ---- AREAS (unchanged from ac-v11) --------------------------------
  function firstZip(txt) {
    var s = String(txt || ""), run = "", i, ch;
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      if (ch >= "0" && ch <= "9") {
        run += ch;
        if (run.length === 5) {
          var nxt = s.charAt(i + 1);
          if (!(nxt >= "0" && nxt <= "9")) return run;
        }
      } else { run = ""; }
    }
    return "";
  }

  function parseAreas(html) {
    var doc;
    try { doc = new DOMParser().parseFromString(html, "text/html"); }
    catch (e) { return null; }
    var rows = doc.querySelectorAll("table tr");
    var seen = {}, zips = [], labels = [], seenLabel = {};
    for (var i = 0; i < rows.length; i++) {
      var txt = rows[i].textContent || "";
      if (txt.indexOf("Postal Code") === -1) continue;
      var z = firstZip(txt);
      if (z && !seen[z]) { seen[z] = 1; zips.push(z); }
      var cells = rows[i].querySelectorAll("td");
      for (var j = 0; j < cells.length; j++) {
        var ct = (cells[j].textContent || "").trim();
        if (ct.indexOf(",") !== -1 && firstZip(ct)) {
          var lab = ct.split(",")[0].trim();
          if (lab && lab.length < 40 && !seenLabel[lab] && !firstZip(lab)) {
            seenLabel[lab] = 1; labels.push(lab);
          }
          break;
        }
      }
    }
    return { zips: zips, labels: labels };
  }

  function loadAreas() {
    return fetch("/account/locations", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (html) { return html ? parseAreas(html) : null; })
      .catch(function (e) {
        console.log("[Renters alerts] areas read failed, gate suppressed", e);
        return null;
      });
  }

  function areaLine() {
    if (!state.areas) return "";
    if (state.areas.labels && state.areas.labels.length) {
      return state.areas.labels.slice(0, 6).join("  \\u00b7  ") +
        (state.areas.labels.length > 6 ? "  and " + (state.areas.labels.length - 6) + " more" : "");
    }
    if (state.areas.zips && state.areas.zips.length) {
      return state.areas.zips.slice(0, 8).join(", ") +
        (state.areas.zips.length > 8 ? " and " + (state.areas.zips.length - 8) + " more" : "");
    }
    return "";
  }

  function noAreas() {
    return state.areasRead && state.areas && state.areas.zips.length === 0;
  }

  // ---- render -------------------------------------------------------
  function render(mp) {
    removeCard();
    var wrap = document.createElement("div");
    wrap.id = "rdc-alerts";
    wrap.style.cssText = S.card;

    if (state.view === "form") renderForm(wrap);
    else if (state.view === "voice") renderVoice(wrap);
    else renderList(wrap);

    state.anchor = mp.anchor;
    if (mp.before && mp.before.parentNode === mp.parent) mp.parent.insertBefore(wrap, mp.before);
    else mp.parent.appendChild(wrap);

    if (state.view === "form") wireForm(mp);
    else if (state.view === "voice") wireVoice(mp);
    else wireList(mp);
  }

  // ---------------- LIST ----------------
  function renderList(wrap) {
    var n = state.searches.length;
    var html =
      '<h3 style="' + S.h + '">Daily listing alerts</h3>' +
      '<p style="' + S.sub + '">Tell us what you are looking for and we email you when a match lands. The more precise you are, the fewer and better the emails.</p>';

    if (noAreas()) {
      html +=
        '<div style="' + S.warn + '">' +
          '<p style="' + S.warnTxt + 'font-weight:600;margin-bottom:8px;">Add your search areas first</p>' +
          '<p style="' + S.warnTxt + 'margin-bottom:10px;">Alerts match on the neighbourhoods you pick, so we need at least one before we can send you anything. You can still save what you are looking for below.</p>' +
          '<a href="/account/locations" style="' + S.ghost + 'display:inline-block;text-decoration:none;">Choose my areas</a>' +
        '</div>';
    }

    var lc = legacyCount();
    if (lc) {
      html +=
        '<div style="' + S.warn + '">' +
          '<p style="' + S.warnTxt + 'font-weight:600;margin-bottom:6px;">' +
            (lc === 1 ? "One alert needs" : lc + " alerts need") + ' a quick fix</p>' +
          '<p style="' + S.warnTxt + '">The deal breakers saved on ' + (lc === 1 ? "it" : "them") +
          ' were recorded in an older format we can no longer read correctly, so we are ignoring them rather than guessing. Open the alert and re-pick them.</p>' +
        '</div>';
    }

    if (!n) {
      html +=
        '<p style="' + S.itemLine + '">You have not set up an alert yet.</p>' +
        '<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;">' +
          '<button id="ra-voice" style="' + S.mic + '">Describe it out loud</button>' +
          '<button id="ra-new" style="' + S.ghost + '">Fill in a form instead</button>' +
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
        html +=
          '<div style="' + (s.enabled ? S.item : S.itemOff) + '">' +
            '<p style="margin:0 0 2px;"><span style="' + S.itemName + '">' + esc(s.name) + '</span> ' +
              '<span style="' + (s.enabled ? S.pillOn : S.pillOff) + '">' + (s.enabled ? "Running" : "Paused") + '</span>' +
              (s.source === "voice" ? ' <span style="' + S.pillOff + '">by voice</span>' : "") + '</p>' +
            (summaryText(c) ? '<p style="' + S.itemLine + '">' + esc(summaryText(c)) + '</p>' : "") +
            (areaLine() ? '<p style="' + S.itemMuted + '">Areas: ' + esc(areaLine()) + '</p>' : "") +
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
              '<button data-act="edit" data-i="' + i + '" style="' + S.ghost + '">Edit</button>' +
              '<button data-act="toggle" data-i="' + i + '" style="' + S.ghost + '">' + (s.enabled ? "Pause" : "Resume") + '</button>' +
              '<button data-act="del" data-i="' + i + '" style="' + S.link + '">Delete</button>' +
            '</div>' +
          '</div>';
      });
      html += '</div>';

      html += '<div style="margin-top:6px;display:flex;gap:10px;flex-wrap:wrap;">';
      if (n < MAX) {
        html += '<button id="ra-voice" style="' + S.mic + '">Describe another out loud</button>' +
                '<button id="ra-new" style="' + S.ghost + '">Add with a form</button>';
      } else {
        html += '<p style="' + S.itemMuted + '">You have reached the limit of ' + MAX + ' saved alerts. Delete one to add another.</p>';
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
      '<p style="font-size:12px;color:#7a8ba1;margin:14px 0 0;">No matches, no email. Turn alerts off any time, here or from any email we send.</p>';

    wrap.innerHTML = html;
  }

  function newDraft() {
    return {
      id: "", name: "", created: "", enabled: true, source: "form",
      transcript_full: "", criteria: emptyCriteria()
    };
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
      state.draft = newDraft();
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
      var btns = list.querySelectorAll("button[data-act]");
      for (var k = 0; k < btns.length; k++) {
        btns[k].onclick = function () {
          var act = this.getAttribute("data-act");
          var i = Number(this.getAttribute("data-i"));
          var s = state.searches[i];
          if (!s) return;

          if (act === "edit") {
            state.draft = {
              id: s.id, name: s.name, created: s.created,
              enabled: s.enabled, source: s.source || "form", transcript_full: "",
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
            if (!window.confirm("Delete the alert \\"" + s.name + "\\"?")) return;
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

  function renderVoice(wrap) {
    var supported = speechSupported();
    var html =
      '<h3 style="' + S.h + '">Tell us what you are looking for</h3>' +
      '<p style="' + S.sub + '">Say it however you would say it to a friend. Budget, size, timing, pets, anything that matters. We will fill in the form and you can fix anything we get wrong.</p>';

    if (supported) {
      html +=
        '<div id="ra-live" style="' + S.live + '">' +
          (state.voice.transcript || state.voice.interim
            ? esc(state.voice.transcript + state.voice.interim)
            : '<span style="color:#9aa8b8;">Your words will appear here.</span>') +
        '</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">' +
          '<button id="ra-rec" style="' + (state.voice.active ? S.ghost : S.mic) + '">' +
            (state.voice.active ? "Stop and use this" : (state.voice.transcript ? "Start over" : "Start talking")) + '</button>' +
          (state.voice.transcript && !state.voice.active
            ? '<button id="ra-use" style="' + S.btn + '">Use this</button>' : "") +
          '<button id="ra-vcancel" style="' + S.link + '">Type it instead</button>' +
        '</div>';
    } else {
      html +=
        '<p style="' + S.hint + '">This browser will not let us listen, so type it instead. Same result.</p>' +
        '<div id="ra-ta-mount" style="margin-bottom:12px;"></div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
          '<button id="ra-use" style="' + S.btn + '">Use this</button>' +
          '<button id="ra-vcancel" style="' + S.link + '">Use the form instead</button>' +
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
    var rec = document.getElementById("ra-rec");
    var use = document.getElementById("ra-use");
    var cancel = document.getElementById("ra-vcancel");

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

      state.draft = {
        id: "", name: d.suggested_name || "", created: "", enabled: true,
        source: "voice", transcript_full: d.transcript_full || transcript,
        criteria: c
      };
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
      '<h3 style="' + S.h + '">' + (isNew ? "New alert" : "Edit alert") + '</h3>';

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
      html += '<p style="' + S.sub + '">Three questions to start. Open Refine if you want to be precise, and the more precise you are the fewer and better the emails.</p>';
    }

    if (areaLine()) {
      html += '<p style="' + S.itemMuted + 'margin:0 0 14px;">Searching in: ' + esc(areaLine()) +
        '  \\u00b7  <a href="/account/locations" style="color:#5b6b82;">change</a></p>';
    }

    // ---- the three questions ----
    html +=
      '<div style="' + S.row + '">' +
        '<div style="flex:1;min-width:140px;"><span style="' + S.lab + '">Most you can pay</span>' +
          '<input id="ra-rent" type="number" inputmode="numeric" placeholder="2200" value="' + esc(val(c.rent_max)) + '" style="' + S.inp + '"></div>' +
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
      '<div style="margin-bottom:14px;"><span style="' + S.lab + '">Name this alert</span>' +
        '<input id="ra-name" maxlength="40" placeholder="2BR near the light rail" value="' + esc(d.name) + '" style="' + S.inp + '"></div>';

    // ---- refine ----
    html += '<div style="' + S.fold + '">' +
      '<button id="ra-refine" style="' + S.ghost + '">' + (state.showRefine ? "Hide the details" : "Refine this search") + '</button>';

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
            '<input id="ra-stretch" type="number" inputmode="numeric" placeholder="150" value="' + esc(val(c.rent_stretch)) + '" style="' + S.inp + '"></div>' +
          '<div style="flex:1;min-width:160px;"><span style="' + S.lab + '">Is that with utilities?</span>' +
            '<select id="ra-basis" style="' + S.inp + '">' +
              '<option value=""' + (!c.rent_basis ? " selected" : "") + '>Not sure</option>' +
              '<option value="all_in"' + (c.rent_basis === "all_in" ? " selected" : "") + '>Utilities included</option>' +
              '<option value="plus_utilities"' + (c.rent_basis === "plus_utilities" ? " selected" : "") + '>Rent only, utilities on top</option>' +
            '</select></div>' +
          '<div style="flex:1;min-width:110px;"><span style="' + S.lab + '">Baths</span>' +
            '<input id="ra-baths" type="number" step="0.5" inputmode="decimal" placeholder="1" value="' + esc(val(c.baths_min)) + '" style="' + S.inp + '"></div>' +
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
            '<input id="ra-adults" type="number" inputmode="numeric" placeholder="1" value="' + esc(val(c.household_adults)) + '" style="' + S.inp + '"></div>' +
          '<div style="flex:1;min-width:110px;"><span style="' + S.lab + '">Children</span>' +
            '<input id="ra-kids" type="number" inputmode="numeric" placeholder="0" value="' + esc(val(c.household_kids)) + '" style="' + S.inp + '"></div>' +
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
            '<div style="flex:1;min-width:110px;"><input id="ra-pet-count" type="number" inputmode="numeric" placeholder="How many" value="' + esc(val(petField(c, "count"))) + '" style="' + S.inp + '"></div>' +
            '<div style="flex:1;min-width:110px;"><input id="ra-pet-weight" type="number" inputmode="numeric" placeholder="Weight in lb" value="' + esc(val(petField(c, "weight_lbs"))) + '" style="' + S.inp + '"></div>' +
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
        '<button id="ra-save" style="' + S.btn + '">' + (isNew ? "Save this alert" : "Save changes") + '</button>' +
        '<button id="ra-cancel" style="' + S.ghost + '">Cancel</button>' +
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
    function n(x) {
      var e = el(x);
      if (!e || e.value === "") return null;
      var v = Number(e.value);
      return isFinite(v) && v >= 0 ? v : null;
    }
    function s(x) { var e = el(x); return e ? e.value : ""; }

    c.rent_max = n("ra-rent");
    c.move_in_earliest = s("ra-move-e") || null;
    c.move_in_latest = s("ra-move-l") || null;
    state.draft.name = s("ra-name");

    if (state.showRefine) {
      c.rent_stretch = n("ra-stretch");
      c.rent_basis = s("ra-basis") || null;
      c.baths_min = n("ra-baths");
      c.household_adults = n("ra-adults");
      c.household_kids = n("ra-kids");
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

  function wireForm(mp) {
    redrawChips();

    var rf = document.getElementById("ra-refine");
    if (rf) rf.onclick = function () {
      readForm();
      state.showRefine = !state.showRefine;
      render(mp);
    };

    document.getElementById("ra-cancel").onclick = function () {
      state.view = "list";
      state.draft = null;
      state.editIdx = -1;
      state.voice.heard = "";
      state.voice.unclear = [];
      render(mp);
    };

    document.getElementById("ra-save").onclick = function () {
      readForm();
      var c = state.draft.criteria;

      if (!hasSomething(c)) {
        var note = document.getElementById("ra-note");
        note.style.color = "#b3261e";
        note.textContent = "Add at least one thing to match on.";
        return;
      }

      var rec = {
        id: state.draft.id || "",
        name: state.draft.name,
        created: state.draft.created || "",
        enabled: state.draft.enabled !== false,
        source: state.draft.source || "form",
        transcript_full: state.draft.transcript_full || "",
        criteria: c
      };

      if (state.editIdx === -1) state.searches.push(rec);
      else state.searches[state.editIdx] = rec;

      state.view = "list";
      state.draft = null;
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
        consent: state.consent
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
    var wiz = document.getElementById("rdc-wiz");
    if (wiz && wiz.parentNode) return { parent: wiz.parentNode, before: wiz.nextSibling, anchor: "wiz" };
    var main = document.querySelector(".page-content, .main-content, main");
    if (main) return { parent: main, before: null, anchor: "main" };
    return null;
  }

  var moves = 0;
  var MAX_MOVES = 8;

  function keepOrder() {
    if (moves > MAX_MOVES) return;
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

  function removeCard() {
    var el = document.getElementById("rdc-alerts");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // ---- boot ---------------------------------------------------------
  // Schema and areas in parallel. Neither is allowed to stop the card:
  // a missing schema hides the chip rows, a missing areas read hides the
  // gate, and the core fields work either way.
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

  Promise.all([loadAreas(), loadSchema()]).then(function (res) {
    state.areas = res[0];
    state.areasRead = res[0] !== null;
    state.schema = res[1];
    if (res[0]) console.log("[Renters alerts] areas", { zips: res[0].zips.length, labels: res[0].labels });
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

        var tries = 0;
        var t = setInterval(function () {
          tries++;
          var m = mount();
          if (!m) { if (tries > 300) clearInterval(t); return; }
          var here = document.getElementById("rdc-alerts");
          if (!here) { render(m); return; }
          keepOrder();
          if (tries > 300) clearInterval(t);
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
