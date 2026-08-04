// ==================================================================
// alerts-teaser-js.js  —  at-v5
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

const FN_VERSION = "at-v5";
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

  var mount = document.querySelector(MOUNT_SELECTOR);
  if (!mount) { console.log("[Renters teaser] no mount " + MOUNT_SELECTOR + ", standing down"); return; }
  if (mount.getAttribute("data-rendered") === "1") return;
  mount.setAttribute("data-rendered", "1");

  var NAVY = "#0d2d4e", NAVY2 = "#081f38", TEAL = "#3a9e8f", LIME = "#8dc63f";

  var S = {
    card: "background:#fff;border:1px solid #e3e8ef;border-radius:16px;padding:32px clamp(24px,4vw,44px);max-width:1100px;margin:0 auto;font-family:inherit;box-shadow:0 2px 18px rgba(13,45,78,0.06);",
    h: "margin:0 0 6px;font-size:22px;font-weight:800;color:" + NAVY + ";",
    sub: "margin:0 0 18px;font-size:15px;color:#5b6b82;line-height:1.5;",
    lab: "display:block;font-size:13px;font-weight:600;color:" + NAVY + ";margin:0 0 6px;",
    inp: "width:100%;padding:11px 13px;border:1px solid #d7dee8;border-radius:10px;font-size:15px;box-sizing:border-box;",
    row: "display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;",
    chips: "display:flex;gap:9px;flex-wrap:wrap;margin-bottom:16px;",
    chip: "border:1px solid #d7dee8;background:#fff;color:#33475f;border-radius:999px;padding:9px 15px;font-size:13px;cursor:pointer;",
    chipOn: "border:1px solid " + NAVY + ";background:" + NAVY + ";color:#fff;border-radius:999px;padding:9px 15px;font-size:13px;cursor:pointer;",
    btn: "background:" + NAVY + ";color:#fff;border:0;border-radius:11px;padding:15px 26px;font-size:16px;font-weight:700;cursor:pointer;width:100%;max-width:340px;display:block;",
    btnGo: "background:" + TEAL + ";color:#fff;border:0;border-radius:11px;padding:14px 26px;font-size:16px;font-weight:700;cursor:pointer;width:100%;text-decoration:none;display:block;text-align:center;box-sizing:border-box;",
    wallWrap: "text-align:center;padding:8px 4px;max-width:560px;margin:0 auto;",
    wallH: "margin:0 0 10px;font-size:21px;font-weight:800;color:" + NAVY + ";",
    wallP: "margin:0 0 20px;font-size:15px;color:#5b6b82;line-height:1.55;",
    recap: "background:#f7f9fc;border:1px solid #e3e8ef;border-radius:12px;padding:14px 16px;margin:0 auto 20px;max-width:520px;text-align:left;",
    recapLine: "font-size:14px;color:" + NAVY + ";margin:0 0 4px;",
    recapMuted: "font-size:13px;color:#5b6b82;margin:0;",
    back: "background:none;border:0;color:#5b6b82;font-size:13px;cursor:pointer;text-decoration:underline;margin-top:14px;",
    head: "max-width:1100px;margin:0 auto 22px;text-align:center;",
    title: "margin:0 0 10px;font-size:clamp(26px,4vw,36px);font-weight:800;color:" + NAVY + ";letter-spacing:-.5px;line-height:1.1;",
    concept: "margin:0 auto;max-width:560px;font-size:clamp(15px,2vw,17px);color:#5b6b82;line-height:1.5;",
    err: "color:#b3261e;font-size:13px;margin-top:10px;min-height:16px;",
    mic: "background:" + TEAL + ";color:#fff;border:0;border-radius:11px;padding:13px 22px;font-size:15px;font-weight:700;cursor:pointer;",
    ghost: "background:#fff;color:" + NAVY + ";border:1px solid #d7dee8;border-radius:11px;padding:13px 22px;font-size:15px;font-weight:700;cursor:pointer;",
    live: "background:#f7f9fc;border:1px solid #e3e8ef;border-radius:12px;padding:16px;min-height:90px;font-size:16px;color:" + NAVY + ";line-height:1.5;margin:0 0 16px;text-align:left;",
    vstatus: "font-size:13px;color:#5b6b82;margin:0 0 14px;min-height:16px;"
  };

  var wants = [];
  var voice = { active: false, transcript: "", interim: "", status: "", rec: null };
  var seed = { rent_max:"", beds_min:"", baths_min:"", move_in_by:"", where:"", wants:null, notes:"" };
  var seededFromVoice = false;
  var VIEW = "form";  // "form" | "voice"

  function speechOK() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }

  function money(n) { return "$" + String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ","); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function readForm() {
    return {
      rent_max: document.getElementById("rt-rent").value,
      beds_min: document.getElementById("rt-beds").value,
      baths_min: document.getElementById("rt-baths").value,
      move_in_by: document.getElementById("rt-move").value,
      where: document.getElementById("rt-where").value.trim(),
      wants: wants.slice(),
      notes: document.getElementById("rt-notes").value.trim()
    };
  }

  function renderForm() {
    if (seededFromVoice && Array.isArray(seed.wants)) { wants = seed.wants.slice(); }
    mount.innerHTML =
      '<div style="' + S.head + '">' +
        '<h2 style="' + S.title + '">Find your next place before anyone else</h2>' +
        '<p style="' + S.concept + '">Tell us what you are looking for. When a verified home matches, we email you. No matches, no email.</p>' +
      '</div>' +
      '<div style="' + S.card + '">' +
        (speechOK()
          ? '<div style="text-align:center;margin-bottom:22px;">' +
              '<button id="rt-voice" type="button" style="' + S.mic + '">🎙 Describe it out loud</button>' +
              '<div style="font-size:13px;color:#9aa8b8;margin-top:12px;position:relative;">' +
                '<span style="background:#fff;padding:0 12px;position:relative;z-index:1;">or fill in the details</span>' +
                '<span style="position:absolute;left:0;right:0;top:50%;height:1px;background:#e8edf3;z-index:0;"></span>' +
              '</div>' +
            '</div>'
          : "") +
        '<div style="margin-bottom:14px;"><span style="' + S.lab + '">Where do you want to live?</span>' +
          '<input id="rt-where" placeholder="Portland, OR or a ZIP" value="' + esc(seed.where) + '" style="' + S.inp + '"></div>' +
        '<div style="' + S.row + '">' +
          '<div style="flex:2;min-width:130px;"><span style="' + S.lab + '">Max rent</span>' +
            '<input id="rt-rent" type="number" inputmode="numeric" placeholder="2200" value="' + esc(seed.rent_max) + '" style="' + S.inp + '"></div>' +
          '<div style="flex:1;min-width:80px;"><span style="' + S.lab + '">Beds</span>' +
            '<input id="rt-beds" type="number" inputmode="numeric" placeholder="2" value="' + esc(seed.beds_min) + '" style="' + S.inp + '"></div>' +
          '<div style="flex:1;min-width:80px;"><span style="' + S.lab + '">Baths</span>' +
            '<input id="rt-baths" type="number" inputmode="numeric" placeholder="1" value="' + esc(seed.baths_min) + '" style="' + S.inp + '"></div>' +
        '</div>' +
        '<div style="margin-bottom:14px;"><span style="' + S.lab + '">Move in by</span>' +
          '<input id="rt-move" type="date" value="' + esc(seed.move_in_by) + '" style="' + S.inp + '"></div>' +
        '<span style="' + S.lab + '">Nice to have</span>' +
        '<div id="rt-chips" style="' + S.chips + '"></div>' +
        '<div style="margin-bottom:18px;"><span style="' + S.lab + '">Anything else that matters?</span>' +
          '<input id="rt-notes" maxlength="200" placeholder="Quiet street, close to the light rail" value="' + esc(seed.notes) + '" style="' + S.inp + '"></div>' +
        '<button id="rt-go" style="' + S.btn + '">Notify me when this matches</button>' +
        '<div id="rt-err" style="' + S.err + '"></div>' +
      '</div>';

    var chipMount = document.getElementById("rt-chips");
    CHIPS.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = c[1];
      b.style.cssText = wants.indexOf(c[0]) !== -1 ? S.chipOn : S.chip;
      b.onclick = function () {
        var i = wants.indexOf(c[0]);
        if (i === -1) wants.push(c[0]); else wants.splice(i, 1);
        b.style.cssText = wants.indexOf(c[0]) !== -1 ? S.chipOn : S.chip;
      };
      chipMount.appendChild(b);
    });

    document.getElementById("rt-go").onclick = submit;

    var vb = document.getElementById("rt-voice");
    if (vb) vb.onclick = function () { VIEW = "voice"; voice = { active:false, transcript:"", interim:"", status:"", rec:null }; renderVoice(); };
  }

  // ---------------- VOICE VIEW ----------------
  function renderVoice() {
    mount.innerHTML =
      '<div style="' + S.head + '">' +
        '<h2 style="' + S.title + '">Describe your ideal place</h2>' +
        '<p style="' + S.concept + '">Talk the way you would tell a friend. Where you want to live, your budget, beds, pets, anything that matters. We turn it into a search you can tweak.</p>' +
      '</div>' +
      '<div style="' + S.card + '">' +
        '<div id="rt-live" style="' + S.live + '">' + (esc(voice.transcript + voice.interim) || '<span style="color:#9aa8b8;">Your words will show up here.</span>') + '</div>' +
        '<div id="rt-vstatus" style="' + S.vstatus + '">' + esc(voice.status) + '</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
          '<button id="rt-rec" type="button" style="' + (voice.active ? S.ghost : S.mic) + '">' +
            (voice.active ? "Stop and use this" : (voice.transcript ? "Start over" : "Start talking")) + '</button>' +
          (voice.transcript && !voice.active ? '<button id="rt-use" type="button" style="' + S.mic + '">Use this</button>' : "") +
          '<button id="rt-back" type="button" style="' + S.ghost + '">Type it instead</button>' +
        '</div>' +
        '<div id="rt-note" style="' + S.err + '"></div>' +
      '</div>';

    document.getElementById("rt-back").onclick = function () { stopRec(); VIEW = "form"; renderForm(); };

    var rec = document.getElementById("rt-rec");
    rec.onclick = function () {
      if (voice.active) { stopRec(); renderVoice(); return; }
      if (voice.transcript && !voice.active) { voice.transcript = ""; voice.interim = ""; }
      startRec();
    };

    var use = document.getElementById("rt-use");
    if (use) use.onclick = function () {
      stopRec();
      var text = String(voice.transcript || "").trim();
      if (text.length < 12) { voice.status = "A little more detail and we can work with it."; renderVoice(); return; }
      extractVoice(text);
    };
  }

  function startRec() {
    var Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    var r;
    try { r = new Ctor(); } catch (e) { voice.status = "We could not start the microphone. Type it instead."; renderVoice(); return; }
    r.continuous = true; r.interimResults = true; r.lang = "en-US";
    voice.transcript = ""; voice.interim = ""; voice.status = "Listening. Take your time."; voice.active = true; voice.rec = r;
    r.onresult = function (ev) {
      var interim = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) voice.transcript += t; else interim += t;
      }
      voice.interim = interim;
      var live = document.getElementById("rt-live");
      if (live) live.textContent = voice.transcript + voice.interim;
    };
    r.onerror = function (ev) {
      voice.active = false;
      voice.status = (ev && ev.error === "not-allowed")
        ? "Microphone permission was declined. Type it instead."
        : "The microphone stopped. Try again or type it instead.";
      renderVoice();
    };
    r.onend = function () { if (!voice.active) return; voice.active = false; voice.interim = ""; renderVoice(); };
    try { r.start(); } catch (e) { voice.active = false; voice.status = "We could not start the microphone. Type it instead."; }
    renderVoice();
  }

  function stopRec() {
    voice.active = false;
    if (voice.rec) { try { voice.rec.stop(); } catch (e) {} }
  }

  // Send transcript to the SAME backend the dashboard uses (av-v1).
  // memberId is omitted; av-v1 rate-limits by IP when it is absent.
  function extractVoice(transcript) {
    voice.status = "Working out what you need.";
    renderVoice();

    fetch(VOICE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript: transcript })
    }).then(function (r) { return r.json(); }).then(function (d) {
      applyExtraction(d, transcript);
    }).catch(function (e) {
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
    var picked = [];
    [].concat(c.must_have || [], c.nice_to_have || [], c.wants || []).forEach(function (k) {
      for (var i = 0; i < CHIPS.length; i++) if (CHIPS[i][0] === k && picked.indexOf(k) === -1) picked.push(k);
    });
    seed.wants = picked;
    // notes: preserve the transcript, plus any model notes
    var noteBits = [];
    if (c.notes) noteBits.push(c.notes);
    if (transcript) noteBits.push(transcript);
    seed.notes = noteBits.join(" — ").slice(0, 200);
    seed.where = "";  // renter fills location; it is not reliably in criteria
    seededFromVoice = true;
  }

  function submit() {
    var f = readForm();
    var err = document.getElementById("rt-err");

    var hasSomething = f.rent_max || f.beds_min || f.baths_min || f.move_in_by || f.where || f.notes || f.wants.length;
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
    var chipTxt = f.wants.map(function (k) {
      for (var i = 0; i < CHIPS.length; i++) if (CHIPS[i][0] === k) return CHIPS[i][1];
      return k;
    }).join(", ");

    return '<div style="' + S.recap + '">' +
      '<p style="' + S.recapLine + '"><strong>' + esc(f.where) + '</strong></p>' +
      (line1 ? '<p style="' + S.recapLine + '">' + esc(line1) + '</p>' : "") +
      (chipTxt ? '<p style="' + S.recapMuted + '">' + esc(chipTxt) + '</p>' : "") +
      (f.notes ? '<p style="' + S.recapMuted + '">' + esc(f.notes) + '</p>' : "") +
    '</div>';
  }

  function renderWall(f, token) {
    // Robust handoff: stash the token same-origin so it survives BD's
    // signup redirects even if the query param is dropped.
    try { window.sessionStorage.setItem("renters_claim_token", token); } catch (e) {}

    var signupReady = SIGNUP_URL.indexOf("SET_ME") === -1;
    var href = signupReady
      ? SIGNUP_URL + (SIGNUP_URL.indexOf("?") === -1 ? "?" : "&") + "claim=" + encodeURIComponent(token)
      : "#";

    mount.innerHTML =
      '<div style="' + S.card + '">' +
        '<div style="' + S.wallWrap + '">' +
          '<h3 style="' + S.wallH + '">Your search is ready</h3>' +
          '<p style="' + S.wallP + '">Create a free account and the moment a verified home matches what you asked for, we will email you. No matches, no email.</p>' +
          recap(f) +
          (signupReady
            ? '<a href="' + href + '" style="' + S.btnGo + '">Create my free account</a>'
            : '<button style="' + S.btn + '" onclick="alert(\\'Signup URL not set yet. Set SIGNUP_URL in alerts-teaser-js.\\');">Create my free account</button>') +
          '<button id="rt-back" style="' + S.back + '">Edit my search</button>' +
        '</div>' +
      '</div>';

    document.getElementById("rt-back").onclick = function () {
      mount.removeAttribute("data-rendered");
      mount.setAttribute("data-rendered", "1");
      renderForm();
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
