// ============================================================
//  getmatched-prefill-js.js   ·   VERSION: gmp-v1   (2026-08-07)
//
//  Serves the JavaScript that fills BD's Get Matched form from a logged-in
//  member's About Me answers.
//
//  WHY THE FORM AND NOT THE API
//  /api/v2/leads/create only accepts its documented parameters. The
//  questionnaire columns - what_is_your_budget, when_are_you_looki and the
//  rest - are not among them, so a lead created through the API arrives with
//  nothing but a note. Tested: lead 2960 had correct notes and no answers.
//  BD's own form writes them, because the Save Form widget knows the form
//  definition. Posting to that widget directly was also tried and refused:
//    {"result":"error","message":"...The data submitted is invalid."}
//  reCAPTCHA is enforced server-side. So the only reliable route is to let
//  the renter submit the real form - which is what this makes painless.
//
//  WHY IT IS SERVED FROM HERE
//  Head code is at 300KB across 19 blocks and every paste risks the whole
//  file. This follows the pattern listing-wizard-js already uses: a six-line
//  loader in head code, the actual logic deployed independently and
//  versioned on its own.
//
//  THE TWO FORMS SPEAK DIFFERENT LANGUAGES
//  Same questions, different values, confirmed by reading both live:
//    long_term_rental_ -> longterm_        single_family -> single_family_
//    36_months         -> in_a_couple_months
//    30004000          -> 3_4k
//  Mapping in code rather than aligning the forms was deliberate: there are
//  thousands of renter records, and changing option values would orphan
//  every one of them.
//
//  NOT_SURE_YET IS LEFT BLANK ON PURPOSE. Guessing a timeline for someone
//  who said they do not have one is worse than an empty field.
//
//  LOCATION IS NOT COPIED FROM THE PROFILE. About Me holds where they live
//  now; Get Matched asks where they want to live. Prefilling a Utah search
//  from an Ohio address would be actively wrong. It comes from their service
//  areas instead, and is left blank when they have none.
//
//  ENDPOINTS
//   GET ?version=1  -> JSON probe
//   GET             -> the script, as application/javascript
// ============================================================
const FN_VERSION = "gmp-v1";

const SCRIPT = `
(function () {
  var GMP = "${FN_VERSION}";
  function log() {
    try { console.log.apply(console, ["[GetMatched prefill]"].concat([].slice.call(arguments))); } catch (e) {}
  }

  var PATH = window.location.pathname || "";
  if (PATH.indexOf("/getmatched") === -1 && PATH.indexOf("/find-housing") === -1) return;

  // Only prefill when we were sent here deliberately. A renter who navigated
  // to this form themselves should find it empty, not silently populated.
  var qs = new URLSearchParams(window.location.search);
  if (qs.get("prefill") !== "1") { log("version:", GMP, "no prefill flag, standing down"); return; }

  var AREAS_URL = "/api/widget/get/json/Bootstrap%20Theme%20-%20Account%20-%20Select%20Locations?action=get_services_areas&user_id=";

  // About Me value -> Get Matched value. Anything absent is left blank so the
  // renter chooses, rather than being given a wrong answer on their behalf.
  var MAP = {
    seeking: {
      long_term_rental_: "longterm_",
      mid_term_rental_: "midterm_",
      short_term_rental: "shortterm",
      furnished_: "furnished_"
    },
    property_type_preference: {
      apartment: "apartment",
      townhome: "townhome",
      condo: "condo",
      single_family: "single_family_",
      any: "any_"
    },
    i_want_to_relocate: {
      immediately_: "immediately_",
      next_month: "in_the_next_month",
      "36_months": "in_a_couple_months",
      "612_months": "next_6_months",
      more_than_a_year: "next_year_"
      // not_sure_yet_ deliberately absent
    },
    monthly_budget: {
      under_1000: "less_than_1k",
      "10002000_": "1_2k",
      "20003000": "2_3k",
      "30004000": "3_4k",
      "40006000": "4_6k",
      "60008000": "6_8k",
      "800010000": "8_10k",
      over_10000: "more_than_10k",
      over_6000: "6_8k"   // legacy band, nearest honest match
    }
  };

  // Field on the member record -> field on the Get Matched form.
  var DIRECT = {
    number_of_peop: "number_of_people_y",
    co_signer: "woulda_cosigner_or",
    do_you_have_pets: "if_yes_type_size_br",   // renamed field, see the Bible
    ideal_rental: "please_describe_the",
    if_other_elaborate: "if_other_elaborate",
    phone_number: "phone"
  };

  var MULTI = { seeking: "select_all_that_des", property_type_preference: "property_type", how_are_you_searchi: "how_are_you_searchi" };

  function translate(field, value) {
    var t = MAP[field];
    if (!t) return value;
    return Object.prototype.hasOwnProperty.call(t, value) ? t[value] : null;
  }

  function plain(v) {
    if (v == null) return "";
    return String(v)
      .replace(new RegExp("<[^>]*>", "g"), " ")
      .replace(new RegExp("&nbsp;", "g"), " ")
      .replace(new RegExp("[ " + String.fromCharCode(9, 13, 10) + "]+", "g"), " ")
      .trim();
  }

  function setText(name, value) {
    if (!value) return false;
    var el = document.querySelector("[name='" + name + "']");
    if (!el) return false;
    el.value = value;
    try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
    try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
    return true;
  }

  function setChoice(name, value) {
    if (!value) return false;
    var els = document.querySelectorAll("[name='" + name + "'],[name='" + name + "[]']");
    var hit = false;
    Array.prototype.forEach.call(els, function (el) {
      if (el.tagName === "SELECT") {
        var ok = Array.prototype.some.call(el.options, function (o) { return o.value === value; });
        if (ok) { el.value = value; hit = true; try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {} }
        return;
      }
      if (el.value === value) {
        el.checked = true; hit = true;
        try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
      }
    });
    return hit;
  }

  function setMulti(name, values) {
    var hit = 0;
    (values || []).forEach(function (v) { if (v && setChoice(name, v)) hit++; });
    return hit;
  }

  function parseAreas(json) {
    var rows = (json && json.data) || [];
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var text = String((rows[i] && rows[i][0]) || "")
        .replace(new RegExp("<[^>]*>", "g"), "")
        .replace(new RegExp("[ " + String.fromCharCode(9, 13, 10) + "]+", "g"), " ").trim();
      var zm = text.match(new RegExp("([0-9]{5})(?!.*[0-9]{5})"));
      if (!zm) continue;
      out.push({ zip: zm[1], label: text.replace(new RegExp(",?[ ]*[0-9]{5}[ ]*$"), "").trim() || zm[1] });
    }
    return out;
  }

  function groupLabels(areas) {
    var order = [], by = {};
    areas.forEach(function (a) { if (by[a.label] === undefined) { by[a.label] = 0; order.push(a.label); } by[a.label]++; });
    return order.map(function (l) { return by[l] > 1 ? (l + " (" + by[l] + " zipcodes)") : l; });
  }

  function banner(filled, total, areaText) {
    var f = document.querySelector("form [name=formname]");
    var form = f ? f.form : document.querySelector("form");
    if (!form) return;
    var b = document.createElement("div");
    b.style.cssText = "background:#f0faf6;border-left:3px solid #3a9e8f;color:#1e8449;padding:12px 15px;border-radius:0 8px 8px 0;font-size:14px;line-height:1.6;margin:0 0 18px;";
    b.innerHTML = "<b>We have filled this in from your profile.</b> " +
      "Check it over, change anything that has moved on, and press the button at the bottom. " +
      (areaText ? "We are looking in " + areaText + "." : "Add where you are looking below.");
    form.insertBefore(b, form.firstChild);
    try { b.scrollIntoView({ block: "center" }); } catch (e) {}
    log("version:", GMP, "filled", filled, "of", total, "fields");
  }

  function run(member) {
    var filled = 0, total = 0;

    // Name: two fields on the profile, one on the form.
    var full = [plain(member.first_name), plain(member.last_name)].filter(Boolean).join(" ");
    total++; if (setText("lead_name", full || plain(member.full_name))) filled++;
    total++; if (setText("lead_email", plain(member.email))) filled++;

    Object.keys(DIRECT).forEach(function (src) {
      total++;
      var v = plain(member[src]);
      if (!v) return;
      // number_of_peop is a select on both; the rest are text.
      if (src === "number_of_peop" || src === "co_signer") { if (setChoice(DIRECT[src], v)) filled++; }
      else if (setText(DIRECT[src], v)) filled++;
    });

    ["i_want_to_relocate", "monthly_budget"].forEach(function (src) {
      total++;
      var t = translate(src, plain(member[src]));
      if (!t) { log(src, "has no equivalent, leaving blank"); return; }
      var target = src === "i_want_to_relocate" ? "when_are_you_looki" : "what_is_your_budget";
      if (setChoice(target, t)) filled++;
    });

    Object.keys(MULTI).forEach(function (src) {
      var raw = plain(member[src]);
      if (!raw) return;
      var vals = raw.split(",").map(function (x) { return x.trim(); }).filter(Boolean)
        .map(function (x) { return MAP[src] ? translate(src, x) : x; })
        .filter(Boolean);
      total++;
      if (setMulti(MULTI[src], vals)) filled++;
    });

    // Where they are LOOKING, from service areas - never their home address.
    fetch(AREAS_URL + encodeURIComponent(member.user_id), { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(parseAreas)
      .then(function (areas) {
        var text = "";
        if (areas.length) {
          var g = groupLabels(areas);
          text = g.slice(0, 3).join(" / ") + (g.length > 3 ? " and " + (g.length - 3) + " more" : "");
          setText("lead_location", text);
        }
        banner(filled, total, text);
      })
      .catch(function () { banner(filled, total, ""); });
  }

  function memberId() {
    try {
      var el = document.querySelector("input[name=logged_user]");
      if (el && el.value) return el.value;
    } catch (e) {}
    return "";
  }

  function boot() {
    var mid = memberId();
    if (!mid) { log("not logged in, standing down"); return; }
    // The profile comes from our own function, which holds the BD key. Head
    // code cannot read a member record directly and should not try.
    fetch("/.netlify/functions/housing-request?profile=" + encodeURIComponent(mid))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok && d.profile) run(d.profile);
        else log("could not read profile", d && d.error);
      })
      .catch(function (e) { log("profile fetch failed", e); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
`;

exports.handler = async function (event) {
  var q = (event && event.queryStringParameters) || {};
  if (q.version === "1") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ ok: true, _v: FN_VERSION, bytes: SCRIPT.length }),
    };
  }
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
    body: SCRIPT,
  };
};
