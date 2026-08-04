// ==================================================================
// alerts-teaser-js.js  —  at-v2
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
// at-v2: signup URL wired to /checkout/renters, and the token is now ALSO
// written to sessionStorage before the visitor leaves for signup. BD's
// signup redirect chain does not reliably preserve a URL query param, so
// sessionStorage is the robust handoff: it survives any same-origin
// redirect. The ?claim= param is kept too as a bonus path. The dashboard
// claimer (alerts-claim-js) reads whichever is present.
// ==================================================================

const FN_VERSION = "at-v2";
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
    card: "background:#fff;border:1px solid #e3e8ef;border-radius:16px;padding:26px;max-width:620px;margin:0 auto;font-family:inherit;box-shadow:0 2px 18px rgba(13,45,78,0.06);",
    h: "margin:0 0 6px;font-size:22px;font-weight:800;color:" + NAVY + ";",
    sub: "margin:0 0 18px;font-size:15px;color:#5b6b82;line-height:1.5;",
    lab: "display:block;font-size:13px;font-weight:600;color:" + NAVY + ";margin:0 0 6px;",
    inp: "width:100%;padding:11px 13px;border:1px solid #d7dee8;border-radius:10px;font-size:15px;box-sizing:border-box;",
    row: "display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;",
    chips: "display:flex;gap:9px;flex-wrap:wrap;margin-bottom:16px;",
    chip: "border:1px solid #d7dee8;background:#fff;color:#33475f;border-radius:999px;padding:9px 15px;font-size:13px;cursor:pointer;",
    chipOn: "border:1px solid " + NAVY + ";background:" + NAVY + ";color:#fff;border-radius:999px;padding:9px 15px;font-size:13px;cursor:pointer;",
    btn: "background:" + NAVY + ";color:#fff;border:0;border-radius:11px;padding:14px 26px;font-size:16px;font-weight:700;cursor:pointer;width:100%;",
    btnGo: "background:" + TEAL + ";color:#fff;border:0;border-radius:11px;padding:14px 26px;font-size:16px;font-weight:700;cursor:pointer;width:100%;text-decoration:none;display:block;text-align:center;box-sizing:border-box;",
    wallWrap: "text-align:center;padding:8px 4px;",
    wallH: "margin:0 0 10px;font-size:21px;font-weight:800;color:" + NAVY + ";",
    wallP: "margin:0 0 20px;font-size:15px;color:#5b6b82;line-height:1.55;",
    recap: "background:#f7f9fc;border:1px solid #e3e8ef;border-radius:12px;padding:14px 16px;margin:0 0 20px;text-align:left;",
    recapLine: "font-size:14px;color:" + NAVY + ";margin:0 0 4px;",
    recapMuted: "font-size:13px;color:#5b6b82;margin:0;",
    back: "background:none;border:0;color:#5b6b82;font-size:13px;cursor:pointer;text-decoration:underline;margin-top:14px;",
    err: "color:#b3261e;font-size:13px;margin-top:10px;min-height:16px;"
  };

  var wants = [];

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
    mount.innerHTML =
      '<div style="' + S.card + '">' +
        '<h3 style="' + S.h + '">Find your next place before anyone else</h3>' +
        '<p style="' + S.sub + '">Tell us what you are looking for. When a verified home matches, we email you. No matches, no email.</p>' +
        '<div style="margin-bottom:14px;"><span style="' + S.lab + '">Where do you want to live?</span>' +
          '<input id="rt-where" placeholder="Portland, OR or a ZIP" style="' + S.inp + '"></div>' +
        '<div style="' + S.row + '">' +
          '<div style="flex:2;min-width:130px;"><span style="' + S.lab + '">Max rent</span>' +
            '<input id="rt-rent" type="number" inputmode="numeric" placeholder="2200" style="' + S.inp + '"></div>' +
          '<div style="flex:1;min-width:80px;"><span style="' + S.lab + '">Beds</span>' +
            '<input id="rt-beds" type="number" inputmode="numeric" placeholder="2" style="' + S.inp + '"></div>' +
          '<div style="flex:1;min-width:80px;"><span style="' + S.lab + '">Baths</span>' +
            '<input id="rt-baths" type="number" inputmode="numeric" placeholder="1" style="' + S.inp + '"></div>' +
        '</div>' +
        '<div style="margin-bottom:14px;"><span style="' + S.lab + '">Move in by</span>' +
          '<input id="rt-move" type="date" style="' + S.inp + '"></div>' +
        '<span style="' + S.lab + '">Nice to have</span>' +
        '<div id="rt-chips" style="' + S.chips + '"></div>' +
        '<div style="margin-bottom:18px;"><span style="' + S.lab + '">Anything else that matters?</span>' +
          '<input id="rt-notes" maxlength="200" placeholder="Quiet street, close to the light rail" style="' + S.inp + '"></div>' +
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
