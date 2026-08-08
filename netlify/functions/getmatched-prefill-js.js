// ============================================================
//  getmatched-prefill-js.js   ·   VERSION: gmp-v5   (2026-08-07)
//    gmp-v5  The geocoded search areas now travel to the LEAD, not just into
//            BD's hidden location fields. Without them the hub can only match
//            on the lead's single location - which is where a renter LIVES.
//            An Ohio renter searching Utah was being shown Ohio listings.
//    gmp-v4  LOCATION NOW ACTUALLY FILLS. Two bugs, both mine:
//            1. BD renders lead_location TWICE - hidden and visible - and
//               querySelector took the hidden one, so the box stayed empty
//               and the form refused to submit for want of a location it had
//               already been given. setText now fills every match.
//            2. BD validates location against its HIDDEN companions - lat,
//               lng, country_sn and the rest - not the visible box. So the
//               zips are geocoded and those are populated too. Same trap the
//               Bible records on add_service_area, where zeroed coordinates
//               were silently discarded.
//    gmp-v3  +claim and redirect. BD's form submits and the page changes, so
//            the lead id is never seen - which means no member pointer, so
//            withdraw and the card's open state would silently stop working.
//            Now: note who submitted in sessionStorage, and on the next page
//            load ask housing-request to find the lead and hand back a
//            consent link. The claim runs on EVERY page, not just the form,
//            because BD chooses where to land them.
//    gmp-v2  The profile fetch was a RELATIVE path. This script runs on
//            www.renters.com, where /.netlify/functions does not exist, so it
//            would have 404'd and filled nothing. Same mistake as the consent
//            redirect. Netlify-served endpoints need their own origin; the
//            service areas widget stays relative because it is session
//            authenticated on renters.com and unreachable from anywhere else.
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
const FN_VERSION = "gmp-v5";

const SCRIPT = `
(function () {
  var GMP = "${FN_VERSION}";
  function log() {
    try { console.log.apply(console, ["[GetMatched prefill]"].concat([].slice.call(arguments))); } catch (e) {}
  }

  var FN_BASE_EARLY = "https://renters-story-writer.netlify.app/.netlify/functions";
  var PATH = window.location.pathname || "";
  var ON_FORM = PATH.indexOf("/getmatched") !== -1 || PATH.indexOf("/find-housing") !== -1;

  // Only prefill when we were sent here deliberately. A renter who navigated
  // to this form themselves should find it empty, not silently populated.
  var qs = new URLSearchParams(window.location.search);
  var WANT_PREFILL = ON_FORM && qs.get("prefill") === "1";

  // ABSOLUTE. This runs on www.renters.com, where /.netlify/functions does
  // not exist - the same mistake that sent the consent redirect to
  // renters.com/lead-consent-page.html and 404'd. Anything served from
  // Netlify must carry its own origin.
  var FN_BASE = "https://renters-story-writer.netlify.app/.netlify/functions";

  // This one IS relative, and must be: the service areas widget is session
  // authenticated on renters.com and unreachable from anywhere else.
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

  // EVERY matching field, not the first. BD renders lead_location TWICE - a
  // hidden one and the visible text box - and querySelector took the hidden
  // one, so the box stayed empty and the form refused to submit for want of
  // a location it had actually been given.
  function setText(name, value) {
    if (!value) return false;
    var els = document.querySelectorAll("[name='" + name + "']");
    if (!els.length) return false;
    Array.prototype.forEach.call(els, function (el) {
      el.value = value;
      try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
      try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
    });
    return true;
  }

  // BD's location widget validates against its HIDDEN companions, not the
  // visible box. Typing a value without the geocode leaves lat, lng and the
  // rest empty, which reads as "no location given" no matter what is on
  // screen. The Bible records the same trap on add_service_area, where zeroed
  // coordinates were silently discarded.
  function setHidden(name, value) {
    if (value === undefined || value === null || value === "") return;
    var els = document.querySelectorAll("[name='" + name + "']");
    Array.prototype.forEach.call(els, function (el) { el.value = String(value); });
  }

  function setLocationProperly(text, areas) {
    setText("lead_location", text);
    var withGeo = (areas || []).filter(function (a) { return a.lat && a.lon; });
    if (!withGeo.length) return;
    var lat = withGeo.reduce(function (s, a) { return s + a.lat; }, 0) / withGeo.length;
    var lon = withGeo.reduce(function (s, a) { return s + a.lon; }, 0) / withGeo.length;
    setHidden("lat", lat);
    setHidden("lng", lon);
    setHidden("location_type", "locality");
    setHidden("country_sn", "US");
    if (areas[0] && areas[0].state) setHidden("adm_lvl_1_sn", areas[0].state);
    if (areas[0] && areas[0].city) setHidden("city", areas[0].city);
    // A viewport, since BD stores one. A tenth of a degree either way is
    // roughly a town, which is the right scale for a zip cluster.
    setHidden("swlat", lat - 0.1); setHidden("swlng", lon - 0.1);
    setHidden("nelat", lat + 0.1); setHidden("nelng", lon + 0.1);
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

  // The zips need real coordinates or BD's location validation fails. The
  // Maps API is already on the page for the zone picker, so nothing extra is
  // loaded. A zip that will not resolve is kept for the label and simply
  // contributes no coordinates.
  function geocodeZips(areas) {
    if (!window.google || !google.maps || !google.maps.Geocoder) {
      log("Google Maps not on this page, location will have no coordinates");
      return Promise.resolve(areas);
    }
    var gc = new google.maps.Geocoder();
    return Promise.all(areas.map(function (a) {
      return new Promise(function (resolve) {
        gc.geocode({ address: a.zip, componentRestrictions: { country: "US" } }, function (res, status) {
          if (status === "OK" && res && res[0]) {
            var g = res[0];
            a.lat = g.geometry.location.lat();
            a.lon = g.geometry.location.lng();
            (g.address_components || []).forEach(function (c) {
              if (c.types.indexOf("administrative_area_level_1") !== -1) a.state = c.short_name;
              if (c.types.indexOf("locality") !== -1) a.city = c.long_name;
            });
          } else { log("zip", a.zip, "did not geocode:", status); }
          resolve(a);
        });
      });
    }));
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
      .then(geocodeZips)
      .then(function (areas) {
        var text = "";
        if (areas.length) {
          var g = groupLabels(areas);
          text = g.slice(0, 3).join(" / ") + (g.length > 3 ? " and " + (g.length - 3) + " more" : "");
          setLocationProperly(text, areas);
        }
        watchSubmit(member.user_id, plain(member.email), areas);
        banner(filled, total, text);
      })
      .catch(function () {
        watchSubmit(member.user_id, plain(member.email), []);
        banner(filled, total, "");
      });

    // areas are resolved asynchronously above; watchSubmit is wired inside
    // that chain so it always has them.
  }

  // After BD's form submits, the page changes and we never see the lead id.
  // So: remember who submitted, and on the confirmation page ask our own
  // function to find the lead that was just created and hand back a consent
  // link. Chasing consent by email days later is how it does not get done.
  function watchSubmit(mid, email, areas) {
    var f = document.querySelector("form [name=formname]");
    var form = f ? f.form : null;
    if (!form) return;
    form.addEventListener("submit", function () {
      try {
        // The geocoded areas travel with the pending record. Without them the
        // hub can only match on the lead's single location, which for anyone
        // relocating is where they LIVE, not where they are looking - an Ohio
        // renter searching Utah would be shown Ohio listings.
        sessionStorage.setItem("rdcGmPending", JSON.stringify({
          mid: mid, email: email, at: Date.now(),
          areas: (areas || []).map(function (a) {
            return { zip: a.zip, label: a.label, lat: a.lat || null, lon: a.lon || null };
          })
        }));
      } catch (e) {}
    });
  }

  // Runs on any renters.com page load. If a submission just happened, link it
  // and send them to consent. Kept separate from the prefill so it fires on
  // whatever page BD lands them on.
  function claimPending() {
    var raw = null;
    try { raw = sessionStorage.getItem("rdcGmPending"); } catch (e) { return; }
    if (!raw) return;
    var p = null;
    try { p = JSON.parse(raw); } catch (e) {}
    try { sessionStorage.removeItem("rdcGmPending"); } catch (e) {}
    if (!p || !p.mid) return;
    // Anything older than five minutes is a stale tab, not a submission.
    if (Date.now() - (p.at || 0) > 300000) return;

    log("claiming the request that was just submitted");
    fetch(FN_BASE + "/housing-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "link", memberId: p.mid, email: p.email, areas: p.areas || [] })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok && d.consentUrl) {
          log("linked lead", d.leadId, "- going to consent");
          window.location.href = d.consentUrl;
        } else {
          log("could not link the request", d && d.error);
        }
      })
      .catch(function (e) { log("link failed", e); });
  }

  function memberId() {
    try {
      var el = document.querySelector("input[name=logged_user]");
      if (el && el.value) return el.value;
    } catch (e) {}
    return "";
  }

  function boot() {
    // Always first: a submission may have just completed on another page.
    claimPending();
    if (!WANT_PREFILL) { log("version:", GMP, "no prefill flag"); return; }
    var mid = memberId();
    if (!mid) { log("not logged in, standing down"); return; }
    // The profile comes from our own function, which holds the BD key. Head
    // code cannot read a member record directly and should not try.
    fetch(FN_BASE + "/housing-request?profile=" + encodeURIComponent(mid))
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
