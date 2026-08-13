// ==================================================================
// alerts-claim-js.js  —  aclaimjs-v2
// PIECE 2. Runs on /account/home. If the visitor built a search on the
// homepage before signing up, this reunites it with their brand-new
// account, then gets out of the way forever.
//
// aclaimjs-v2 — WHY THIS NEVER WORKED, AND IT NEVER DID, NOT ONCE.
//
// 🔴 sessionStorage IS PER TAB. v1 called it "the robust path". It is
// not: BD's signup chain does not reliably keep the visitor in the same
// tab, and v1 already recorded that the ?claim= query param is not
// carried through the redirects either. Both routes failed together, so
// the token was simply absent. Proven live on a fresh incognito signup:
// the console printed the version line and NOTHING ELSE.
//
// ⚠️ AND THAT SILENCE IS THE SECOND BUG. v1 did `if (!token) return;`
// with no log, so the failure looked identical to the normal case of a
// visitor who never used the teaser. A handoff that can fail must SAY
// which branch it took, or nobody can tell broken from idle.
//
// HOW THE TOKEN ARRIVES NOW (checked in order):
//   1. localStorage "renters_claim" — { token, at }. Survives a new tab,
//      a full navigation and a browser restart. THE PRIMARY PATH.
//   2. localStorage "renters_claim_token" — plain string, same value.
//   3. sessionStorage "renters_claim_token" — kept for tokens stashed by
//      a teaser older than at-v19 that is still in somebody's tab.
//   4. ?claim=TOKEN on the URL — bonus only, if BD ever carries it.
//
// A localStorage token is TIMESTAMPED and expires at 30 days, matching
// the stash blob. Without that, a token left on a shared computer would
// attach a stranger's perfect spot to whoever signs up next on it.
//
// It reads the member id off the dashboard DOM the same way the alerts
// card does (#4356 is printed on the member card), so it does NOT depend
// on the id being in the URL either.
//
// ONE-SHOT: on success it deletes the sessionStorage key and strips the
// param, so a refresh cannot double-claim. alerts-claim.js also deletes
// the token server-side on claim, so even a replay is a no-op.
//
// RENTER-ONLY, same gate as the alerts card: only levels 15 get here in
// practice, but claim is harmless on any account (it just attaches a
// perfect spot). Still, we only run on /account/home.
//
// ⚠️ THE CLAIM RUNS BEFORE THE ACCOUNT IS VERIFIED, and that is correct.
// A brand new renter sees "Your Account Is Not Yet Activated" until they
// click the email link. Waiting for verification would mean the spot they
// just built is missing at the exact moment they first look for it, which
// is when they decide whether this product does anything. aclaim-v2
// writes through the API with read-back verification, so an unverified
// account is not an obstacle.
//
// Served from Netlify; head code carries only a 6-line loader.
// ==================================================================

const FN_VERSION = "aclaimjs-v2";
const CLAIM = "https://renters-story-writer.netlify.app/.netlify/functions/alerts-claim";

const JS = `
(function () {
  var V = "${FN_VERSION}";
  var CLAIM = "${CLAIM}";
  console.log("[Renters claim] version: " + V);

  if ((window.location.pathname || "").toLowerCase().indexOf("/account/home") === -1) return;

  // ---- find the token ----
  var TTL_MS = 30 * 24 * 60 * 60 * 1000;
  var token = "";
  var via = "";

  // 1. localStorage, timestamped. The path that actually survives signup.
  try {
    var rawL = window.localStorage.getItem("renters_claim");
    if (rawL) {
      var o = JSON.parse(rawL);
      if (o && o.token) {
        if (o.at && (Date.now() - o.at) > TTL_MS) {
          console.log("[Renters claim] found a token but it has expired, discarding");
          try { window.localStorage.removeItem("renters_claim"); } catch (e2) {}
        } else {
          token = o.token; via = "localStorage";
        }
      }
    }
  } catch (e) {}

  // 2. plain localStorage key.
  if (!token) {
    try {
      var t2 = window.localStorage.getItem("renters_claim_token");
      if (t2) { token = t2; via = "localStorage(plain)"; }
    } catch (e) {}
  }

  // 3. sessionStorage, for a token stashed by a pre-at-v19 teaser still
  //    sitting in this tab.
  if (!token) {
    try {
      var t3 = window.sessionStorage.getItem("renters_claim_token");
      if (t3) { token = t3; via = "sessionStorage"; }
    } catch (e) {}
  }

  // 4. URL param. BD drops it, but it costs nothing to look.
  if (!token) {
    var m = (window.location.search || "").match(/[?&]claim=([^&]+)/);
    if (m) {
      try { token = decodeURIComponent(m[1]); } catch (e) { token = m[1]; }
      via = "url";
    }
  }

  // ⚠️ SAY SO. v1 returned in silence here, which made a broken handoff
  // indistinguishable from a visitor who never touched the teaser.
  if (!token) {
    console.log("[Renters claim] no token found, nothing to claim");
    return;
  }

  console.log("[Renters claim] token found via " + via + ", attempting claim");

  // ---- member id off the dashboard DOM (same as the alerts card) ----
  function memberId() {
    var el = document.querySelector("input[name=logged_user]");
    if (el && el.value) return String(el.value).replace(/[^0-9]/g, "");
    // The member card prints "Member ID #4356".
    var txt = document.body.innerText || "";
    var mm = txt.match(/Member ID\\s*#?\\s*(\\d+)/i);
    if (mm) return mm[1];
    var c = document.cookie || "";
    var i = c.indexOf("userid=");
    if (i !== -1) return c.slice(i + 7).split(";")[0].replace(/[^0-9]/g, "");
    return "";
  }

  function cleanup() {
    // Every place a token can live, or it claims again on the next load.
    try { window.sessionStorage.removeItem("renters_claim_token"); } catch (e) {}
    try { window.localStorage.removeItem("renters_claim"); } catch (e) {}
    try { window.localStorage.removeItem("renters_claim_token"); } catch (e) {}
    // Strip ?claim= from the URL without reloading.
    try {
      if (window.history && window.history.replaceState && /[?&]claim=/.test(window.location.search)) {
        var url = window.location.pathname +
          window.location.search.replace(/([?&])claim=[^&]+(&|$)/, "$1").replace(/[?&]$/, "") +
          window.location.hash;
        window.history.replaceState(null, "", url);
      }
    } catch (e) {}
  }

  // The member card can render a beat after load. Retry briefly.
  var tries = 0;
  var iv = setInterval(function () {
    tries++;
    var id = memberId();
    if (!id) { if (tries > 20) clearInterval(iv); return; }
    clearInterval(iv);
    doClaim(id);
  }, 400);

  function doClaim(id) {
    fetch(CLAIM + "?claim=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: token, memberId: id })
    }).then(function (r) { return r.json(); }).then(function (d) {
      cleanup();  // consume regardless of outcome, so it never loops
      if (d && d.claimed) {
        console.log("[Renters claim] perfect spot attached: " + (d.searchName || ""));
        banner(d);
        // The card has almost certainly already rendered its empty state
        // by now, and it reads the member on boot. Nudge it to reload so
        // the new spot appears without a refresh.
        try {
          if (typeof window.rdcAlertsReload === "function") window.rdcAlertsReload();
        } catch (e) {}
      } else {
        console.log("[Renters claim] not claimed:", (d && d.reason) || "unknown reason", d);
      }
    }).catch(function (e) {
      console.error("[Renters claim] claim error", e);
      // Do NOT cleanup on network error: let a reload try again.
    });
  }

  // Confirmation, and the ONE next step. The card renders the perfect
  // spot itself; this acknowledges the handoff and points at what is
  // still missing.
  // ⚠️ v1 SENT THEM TO /account/locations. That page is the retired
  // member-level area manager - the zone now lives ON the perfect spot
  // and is drawn inside the card. Sending a brand new renter to a page
  // whose output nothing reads would have been the worst possible first
  // instruction. The step is: open your spot and pick your zone.
  function banner(d) {
    var host = document.getElementById("rdc-alerts") || document.querySelector(".page-content, main, body");
    if (!host) return;
    if (document.getElementById("rdc-claim-banner")) return;

    var b = document.createElement("div");
    b.id = "rdc-claim-banner";
    b.style.cssText =
      "background:#eaf5f2;border:1px solid #cfe6df;border-left:4px solid #3a9e8f;border-radius:12px;padding:14px 16px;margin:16px auto;max-width:660px;font-family:inherit;color:#14514a;font-size:14px;line-height:1.55;";

    var place = d.zoneName || d.where || "";
    var placeMsg = place
      ? " We kept " + String(place).replace(/</g, "&lt;") + " as the area you asked about."
      : "";

    b.innerHTML =
      "<strong>Your perfect spot is saved.</strong>" + placeMsg +
      (d.needsAreas
        ? " One thing left: open it below and draw your zone, so we know exactly where to look."
        : " We will email you the moment a verified home matches.");

    if (host.id === "rdc-alerts") host.parentNode.insertBefore(b, host);
    else host.insertBefore(b, host.firstChild);

    // The card can mount below the fold on a fresh account. Put the
    // confirmation where they are looking.
    try { b.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
  }
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
