// ============================================================
//  listing-contact-js.js   ·   VERSION: lcj-v10  (2026-08-07)
//    lcj-v10 The inquiry note was never written. watchSend listened for the
//            form's submit event, and BD submits programmatically - a
//            form.submit() call fires NO submit event - so nothing was
//            stored and the confirmation page had nothing to recognise. It
//            showed the search-request copy to someone who had asked about
//            one property.
//            Now listens for the button click as well. Writing the note
//            twice is harmless: the record is keyed and deduped server-side.
//    lcj-v9  (previous)
//    lcj-v9  The location row was never being hidden. The v4 guard skipped
//            any row containing a <button>, and BD's location widget has its
//            own locate control - so the whole row was spared, leaving a
//            renter asked where they live while enquiring about a specific
//            address. The guard now looks for SUBMIT controls: an explicit
//            type="button" or "reset" no longer counts, while a <button> with
//            no type still does, because that submits by default.
//    lcj-v8  (previous)
//    lcj-v8  Notes the property on submit, in sessionStorage, for the
//            confirmation page to record. It cannot be recorded here: the
//            page is unloading and an in-flight request would be cancelled.
//    lcj-v7  (previous)
//    lcj-v7  HIDDEN REQUIRED FIELDS ARE NO LONGER REQUIRED. top_id, the
//            category dropdown, is required by the form and hidden by us - so
//            the browser refused to submit and displayed nothing, because the
//            message it wanted to show belonged to a field nobody could see.
//            Clicking Send did exactly nothing, with no error anywhere.
//            Anything hidden now has its required flag dropped. This is the
//            THIRD failure today caused by validation against something
//            invisible: the location field, the removed reCAPTCHA, and now
//            this. When a BD form silently refuses, look for a hidden field
//            before looking anywhere else.
//    lcj-v6  (previous)
//    lcj-v6  Hides BD's "Required fields are marked with (*)" line. It has no
//            name attribute so the field hiding never reached it, and with
//            one message box and nothing required it refers to nothing. It
//            stays on the full form, where it is true.
//    lcj-v5  (previous)
//    lcj-v5  The v4 restore climbed six levels looking for hidden ancestors
//            and un-hid whole containers on the way, which brought the
//            location map and the form intro text back. Now it restores the
//            button and at most its immediate parent - enough to make the
//            form sendable, not enough to undo the hiding.
//    lcj-v4  THE SUBMIT BUTTON WAS BEING HIDDEN. rowOf walks up to a wrapper,
//            and on this form that wrapper also holds the submit control - so
//            hiding a field took the button with it, leaving a form that
//            could be filled in and captcha-solved but never sent.
//            Now: a row containing a submit control or the captcha is never
//            hidden, and anything that submits is explicitly restored
//            afterwards. Two guards, because a form you cannot send is worse
//            than one that is too long.
//    lcj-v3  HIDING IS AN ALLOWLIST NOW. lcj-v2 hid only the fields it had
//            filled, which left dozens on screen - the modal carries the
//            whole 99-field form and no list of ours will keep up with it.
//            Everything is hidden except the message box and the reCAPTCHA,
//            so a field BD adds tomorrow is hidden by default.
//            The message is anything_else_we_sh, relabelled - it reads as a
//            message where please_describe_the asks about an ideal rental,
//            which is a profile question rather than an inquiry.
//    lcj-v2  Waits for the DOM. This is injected from head code, so it could
//            run before the body was parsed - it would then find no modal and
//            stand down silently. The loader had the same fault in w160,
//            where an element check in head code could never pass.
//
//  Turns the listing Contact modal from a 99-field questionnaire into a
//  message box.
//
//  WHY IT FILLS AND HIDES RATHER THAN REPLACING
//  The modal contains BD's Get Matched form - confirmed live: formname
//  bootstrap_get_match, 99 fields, recaptcha true. It cannot be replaced
//  with our own form, because BD VALIDATES THE RECAPTCHA SERVER-SIDE.
//  Tested: removing the field made every submission fail, and the error
//  blamed the location field rather than the missing token, which is how
//  that test nearly cost an afternoon.
//  So the real form stays and does the submitting. This fills it from the
//  member's profile, hides everything already answered, and leaves a short
//  visible section. The renter sees a message box; BD sees its own form.
//
//  THE PROPERTY REFERENCE ALREADY TRAVELS
//  url_origin_pars and url_from carry the listing slug, and utoken carries
//  the landlord's member id - both confirmed on a live modal. So a landlord
//  can tell which unit prompted the inquiry, which is the one thing the old
//  flow got right.
//
//  RENTERS ONLY, AND ONLY WHEN LOGGED IN. A logged-out visitor gets BD's
//  login prompt instead of this modal, so there is nothing to intercept.
//
//  ENDPOINTS
//   GET ?version=1  -> JSON probe
//   GET             -> the script
// ============================================================
const FN_VERSION = "lcj-v10";

const SCRIPT = `
(function () {
  var LCJ = "${FN_VERSION}";
  var FN_BASE = "https://renters-story-writer.netlify.app/.netlify/functions";

  function log() {
    try { console.log.apply(console, ["[Listing contact]"].concat([].slice.call(arguments))); } catch (e) {}
  }

  // Everything below needs the body. This script is injected from head code,
  // so it can run before the body is parsed - the same trap that stopped the
  // loader firing at all in w160. Wait for the DOM, then start.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  function start() {

  var modal = document.querySelector("#contactModal");
  if (!modal) { log("version:", LCJ, "no contact modal on this page"); return; }
  var form = modal.querySelector("form");
  if (!form) { log("version:", LCJ, "no form in the modal"); return; }

  var fn = form.querySelector("[name=formname]");
  if (!fn || String(fn.value).indexOf("get_match") === -1) {
    log("version:", LCJ, "modal is not the get-matched form (", fn && fn.value, ") - standing down");
    return;
  }

  var loggedUser = form.querySelector("[name=logged_user]");
  var mid = loggedUser ? String(loggedUser.value || "") : "";
  if (!mid) { log("version:", LCJ, "not logged in, standing down"); return; }

  // ---- the same two vocabularies as the dashboard prefill ----
  var MAP = {
    seeking: { long_term_rental_: "longterm_", mid_term_rental_: "midterm_", short_term_rental: "shortterm", furnished_: "furnished_" },
    property_type_preference: { apartment: "apartment", townhome: "townhome", condo: "condo", single_family: "single_family_", any: "any_" },
    i_want_to_relocate: { immediately_: "immediately_", next_month: "in_the_next_month", "36_months": "in_a_couple_months", "612_months": "next_6_months", more_than_a_year: "next_year_" },
    monthly_budget: { under_1000: "less_than_1k", "10002000_": "1_2k", "20003000": "2_3k", "30004000": "3_4k", "40006000": "4_6k", "60008000": "6_8k", "800010000": "8_10k", over_10000: "more_than_10k", over_6000: "6_8k" }
  };
  var DIRECT = { number_of_peop: "number_of_people_y", co_signer: "woulda_cosigner_or", do_you_have_pets: "if_yes_type_size_br", ideal_rental: "please_describe_the", phone_number: "phone" };
  var MULTI = { seeking: "select_all_that_des", property_type_preference: "property_type", how_are_you_searchi: "how_are_you_searchi" };

  function translate(f, v) {
    var t = MAP[f];
    if (!t) return v;
    return Object.prototype.hasOwnProperty.call(t, v) ? t[v] : null;
  }
  function plain(v) {
    if (v == null) return "";
    return String(v).replace(new RegExp("<[^>]*>", "g"), " ")
      .replace(new RegExp("&nbsp;", "g"), " ")
      .replace(new RegExp("[ " + String.fromCharCode(9, 13, 10) + "]+", "g"), " ").trim();
  }
  function q(name) { return form.querySelectorAll("[name='" + name + "'],[name='" + name + "[]']"); }
  function setText(name, value) {
    if (!value) return;
    Array.prototype.forEach.call(q(name), function (el) {
      el.value = value;
      try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
      try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
    });
  }
  function setChoice(name, value) {
    if (!value) return;
    Array.prototype.forEach.call(q(name), function (el) {
      if (el.tagName === "SELECT") {
        var ok = Array.prototype.some.call(el.options, function (o) { return o.value === value; });
        if (ok) { el.value = value; try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {} }
        return;
      }
      if (el.value === value) { el.checked = true; try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {} }
    });
  }
  function setHidden(name, value) {
    if (value === undefined || value === null || value === "") return;
    Array.prototype.forEach.call(q(name), function (el) { el.value = String(value); });
  }

  // The field's whole row, so hiding it takes the label with it.
  function rowOf(el) {
    var n = el;
    for (var i = 0; i < 6 && n && n.parentNode; i++) {
      n = n.parentNode;
      if (n.className && String(n.className).indexOf("form-group") !== -1) return n;
    }
    return el.parentNode;
  }

  // AN ALLOWLIST, NOT A BLOCKLIST. Hiding only the fields we happened to fill
  // left dozens on screen, because the modal carries the whole 99-field form
  // and no list of ours will ever keep up with it. Everything is hidden
  // except the few things that must stay - so a field BD adds tomorrow is
  // hidden by default rather than appearing unannounced.
  // Same reasoning as SHAREABLE_FIELDS in lead-consent.
  var VISIBLE = {
    anything_else_we_sh: 1,      // the message
    "g-recaptcha-response": 1,   // BD checks the token SERVER-SIDE. Removing
    recaptcha: 1                 // this field breaks every submission, and
                                 // the error blames the location field.
  };

  function hideEverythingElse() {
    var hidden = 0, seen = {};
    Array.prototype.forEach.call(form.querySelectorAll("[name]"), function (el) {
      var n = String(el.name || "").replace("[]", "");
      if (!n || VISIBLE[n]) return;
      // Hidden inputs carry the payload and have no row to hide.
      if (el.type === "hidden") return;
      var row = rowOf(el);
      if (!row || !row.style) return;
      if (row.style.display === "none") return;
      // Never hide a row containing a SUBMIT control or the captcha - rowOf
      // walks up to a wrapper, and on this form that wrapper can hold the
      // submit button, which hid it and left a form that could be filled in
      // but not sent.
      // Deliberately NOT any <button>: BD's location widget has its own
      // locate control, so the broader test spared the whole location row and
      // left it on screen asking a renter where they live while they are
      // enquiring about a specific address.
      if (row.querySelector("[type=submit],[type=image],.g-recaptcha,[name*=recaptcha]")) return;
      var btns = row.querySelectorAll("button");
      var hasSubmit = false;
      Array.prototype.forEach.call(btns, function (b) {
        var t = (b.getAttribute("type") || "").toLowerCase();
        // A <button> with no type submits by default, so only an explicit
        // button or reset is safe to hide alongside.
        if (t !== "button" && t !== "reset") hasSubmit = true;
      });
      if (hasSubmit) return;
      row.style.display = "none";
      if (!seen[n]) { seen[n] = 1; hidden++; }
    });

    // A HIDDEN REQUIRED FIELD IS UNANSWERABLE. top_id - the category
    // dropdown - is required and now hidden, so the browser refused to submit
    // and showed nothing: the message it wanted to display was attached to a
    // field nobody could see. Clicking Send did precisely nothing.
    // Anything hidden has its required flag dropped. Filling it instead would
    // mean choosing a category on the renter's behalf, which is worse than
    // leaving it empty.
    Array.prototype.forEach.call(form.querySelectorAll("[required],[aria-required=true]"), function (el) {
      var r = rowOf(el);
      var isHidden = (el.style && el.style.display === "none") ||
                     (r && r.style && r.style.display === "none") ||
                     (el.offsetParent === null && el.type !== "hidden");
      if (!isHidden) return;
      el.removeAttribute("required");
      el.removeAttribute("aria-required");
    });

    // The renter must be able to send. Restore the button and AT MOST its
    // immediate parent - v4 climbed six levels and un-hid whole containers,
    // which brought the location map and the form intro back with them.
    Array.prototype.forEach.call(form.querySelectorAll("[type=submit],button"), function (b) {
      if (b.style && b.style.display === "none") b.style.display = "";
      var p = b.parentNode;
      if (p && p !== form && p.style && p.style.display === "none") p.style.display = "";
    });

    return hidden;
  }

  function propertyName() {
    var u = form.querySelector("[name=url_origin_pars]");
    var slug = u ? String(u.value || "") : "";
    var last = slug.split("/").filter(Boolean).pop() || "";
    if (!last) return "";
    return last.split("-").map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");
  }

  // BD's own intro text - "Required fields are marked with (*)" - has no name
  // attribute, so the field hiding never touched it. It belongs on the full
  // form, where things genuinely are required. Here there is one message box
  // and nothing required, so it refers to nothing.
  // Matched on its text because there is nothing else to match on; if BD
  // rewords it the line simply stays, which is harmless.
  function dropBdIntro() {
    var nodes = form.querySelectorAll("p, div, span, h1, h2, h3, h4, label");
    Array.prototype.forEach.call(nodes, function (n) {
      if (n.children.length) return;                 // leaf nodes only
      var t = (n.textContent || "").trim();
      if (!t || t.length > 160) return;
      if (t.indexOf("Required fields") !== -1 || t.indexOf("marked with") !== -1) {
        n.style.display = "none";
      }
    });
  }

  function intro(place, hiddenCount) {
    dropBdIntro();
    if (modal.querySelector("#rdc-lc-intro")) return;
    var box = document.createElement("div");
    box.id = "rdc-lc-intro";
    box.style.cssText = "background:#f0faf6;border-left:3px solid #3a9e8f;padding:14px 16px;border-radius:0 9px 9px 0;margin:0 0 18px;font-family:inherit;";
    box.innerHTML = ''
      + '<p style="font-size:15px;font-weight:700;color:#1e8449;margin:0 0 5px">'
      + (place ? ('Ask about ' + place) : 'Send a message') + '</p>'
      + '<p style="font-size:13.5px;line-height:1.6;color:#1e8449;margin:0">'
      + 'We will send what you have already told us - your budget, timing and what you are looking for - '
      + 'so you only need to write the bit that is specific to this place.</p>';
    form.insertBefore(box, form.firstChild);
    log("version:", LCJ, "hid", hiddenCount, "answered fields");
  }

  // Quick openers. Budget, timing and pets already travel with the request,
  // so these are only the things the profile cannot answer.
  var OPENERS = [
    "When could I see it?",
    "Is it still available?",
    "Is the rent negotiable for a longer lease?"
  ];

  function openers() {
    var box = form.querySelector("[name=anything_else_we_sh]");
    if (!box || modal.querySelector("#rdc-lc-openers")) return;

    // On the long form this asks "anything else we should know". Here it is
    // the whole message, so it needs relabelling.
    var row = rowOf(box), lab = row ? row.querySelector("label") : null;
    if (lab) lab.textContent = "Your message";
    box.setAttribute("placeholder", "Anything you would like to ask or mention");
    box.value = "";

    var wrap = document.createElement("div");
    wrap.id = "rdc-lc-openers";
    wrap.style.cssText = "margin:0 0 9px;display:flex;gap:7px;flex-wrap:wrap;";
    OPENERS.forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = t;
      b.style.cssText = "font-family:inherit;font-size:12.5px;padding:7px 12px;border:1px solid #dde3ea;border-radius:999px;background:#fff;color:#0d2d4e;cursor:pointer;";
      b.addEventListener("mouseover", function () { b.style.borderColor = "#3a9e8f"; });
      b.addEventListener("mouseout", function () { b.style.borderColor = "#dde3ea"; });
      b.addEventListener("click", function () {
        box.value = box.value ? (box.value.replace(new RegExp("[ ]+$"), "") + " " + t) : t;
        box.focus();
        try { box.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
      });
      wrap.appendChild(b);
    });
    box.parentNode.insertBefore(wrap, box);
  }

  function fill(member) {
    // Still tracked, but only so the log says what was filled. Hiding is an
    // allowlist now and does not depend on it.
    var answered = {};

    var full = [plain(member.first_name), plain(member.last_name)].filter(Boolean).join(" ") || plain(member.full_name);
    if (full) { setText("lead_name", full); answered.lead_name = 1; }
    if (plain(member.email)) { setText("lead_email", plain(member.email)); answered.lead_email = 1; }

    Object.keys(DIRECT).forEach(function (src) {
      var v = plain(member[src]);
      if (!v) return;
      if (src === "number_of_peop" || src === "co_signer") setChoice(DIRECT[src], v);
      else setText(DIRECT[src], v);
      answered[DIRECT[src]] = 1;
    });

    [["i_want_to_relocate", "when_are_you_looki"], ["monthly_budget", "what_is_your_budget"]].forEach(function (pair) {
      var t = translate(pair[0], plain(member[pair[0]]));
      if (!t) return;
      setChoice(pair[1], t);
      answered[pair[1]] = 1;
    });

    Object.keys(MULTI).forEach(function (src) {
      var raw = plain(member[src]);
      if (!raw) return;
      raw.split(",").map(function (x) { return x.trim(); }).filter(Boolean)
        .map(function (x) { return MAP[src] ? translate(src, x) : x; })
        .filter(Boolean)
        .forEach(function (v) { setChoice(MULTI[src], v); });
      answered[MULTI[src]] = 1;
    });

    // Their current location, already geocoded by BD at signup. The form
    // validates against the hidden companions rather than the visible box,
    // so those are what matter.
    var city = plain(member.city), st = plain(member.state_code || member.state_sn), zip = plain(member.zip_code);
    var label = [city, st].filter(Boolean).join(", ") + (zip ? " " + zip : "");
    if (label.trim()) {
      setText("lead_location", label.trim());
      var lat = Number(member.lat), lon = Number(member.lon);
      if (isFinite(lat) && isFinite(lon) && lat && lon) {
        setHidden("lat", lat); setHidden("lng", lon);
        setHidden("location_type", "locality");
        setHidden("country_sn", plain(member.country_code) || "US");
        if (st) setHidden("adm_lvl_1_sn", st);
        if (city) setHidden("city", city);
        setHidden("swlat", lat - 0.1); setHidden("swlng", lon - 0.1);
        setHidden("nelat", lat + 0.1); setHidden("nelng", lon + 0.1);
        answered.lead_location = 1;
      }
    }

    var n = hideEverythingElse();
    openers();
    intro(propertyName(), n);
    watchSend(mid);
  }

  // On submit, note what was asked about. The confirmation page picks this up
  // and records it - we cannot record here, because the page is unloading and
  // an in-flight request would be cancelled.
  function watchSend(memberId) {
    function note() {
      var u = form.querySelector("[name=url_origin_pars]");
      var msgEl = form.querySelector("[name=anything_else_we_sh]");
      try {
        sessionStorage.setItem("rdcListingInquiry", JSON.stringify({
          mid: memberId,
          slug: u ? String(u.value || "") : (window.location.pathname || ""),
          title: propertyName(),
          message: msgEl ? String(msgEl.value || "").slice(0, 400) : "",
          at: Date.now()
        }));
      } catch (e) {}
    }

    // BOTH the submit event and the button click. Listening only for submit
    // was not enough: BD submits the form programmatically, and a
    // form.submit() call fires no submit event at all - so the note was never
    // written and the confirmation page had nothing to recognise.
    // Writing it twice is harmless; the record is keyed and deduped.
    form.addEventListener("submit", note);
    Array.prototype.forEach.call(form.querySelectorAll("[type=submit],button"), function (b) {
      var t = (b.getAttribute("type") || "").toLowerCase();
      if (t === "button" || t === "reset") return;
      b.addEventListener("click", note);
    });
  }

  // Fill when the modal opens, not on page load - the fields may not be
  // rendered until then, and a renter who never clicks Contact should cost
  // nothing.
  var done = false;
  function go() {
    if (done) return;
    done = true;
    fetch(FN_BASE + "/housing-request?profile=" + encodeURIComponent(mid))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok && d.profile) fill(d.profile);
        else log("could not read the profile", d && d.error);
      })
      .catch(function (e) { log("profile fetch failed", e); });
  }

  var triggers = document.querySelectorAll("[data-target='#contactModal']");
  Array.prototype.forEach.call(triggers, function (t) { t.addEventListener("click", go); });
  // Bootstrap fires this too, and some themes open the modal without a click.
  try {
    if (window.jQuery) window.jQuery(modal).on("show.bs.modal", go);
  } catch (e) {}

  log("version:", LCJ, "armed for member", mid);

  } // start
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
