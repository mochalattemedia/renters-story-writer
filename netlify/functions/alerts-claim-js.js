// ==================================================================
// alerts-claim-js.js  —  aclaimjs-v1
// PIECE 2. Runs on /account/home. If the visitor built a search on the
// homepage before signing up, this reunites it with their brand-new
// account, then gets out of the way forever.
//
// HOW THE TOKEN ARRIVES (checks both, in order):
//   1. sessionStorage "renters_claim_token" — the robust path. The
//      teaser writes it before sending the visitor to /checkout/renters,
//      and it survives BD's signup redirects because it never rides in a
//      URL. This is the primary path, because BD's redirect chain was NOT
//      confirmed to preserve query params.
//   2. ?claim=TOKEN on the dashboard URL — bonus path, used only if BD
//      happened to carry the param through. Cleared from the URL after.
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
// saved search). Still, we only run on /account/home.
//
// Served from Netlify; head code carries only a 6-line loader.
// ==================================================================

const FN_VERSION = "aclaimjs-v1";
const CLAIM = "https://renters-story-writer.netlify.app/.netlify/functions/alerts-claim";

const JS = `
(function () {
  var V = "${FN_VERSION}";
  var CLAIM = "${CLAIM}";
  console.log("[Renters claim] version: " + V);

  if ((window.location.pathname || "").toLowerCase().indexOf("/account/home") === -1) return;

  // ---- find the token: sessionStorage first, then URL param ----
  var token = "";
  try { token = window.sessionStorage.getItem("renters_claim_token") || ""; } catch (e) {}
  if (!token) {
    var m = (window.location.search || "").match(/[?&]claim=([^&]+)/);
    if (m) { try { token = decodeURIComponent(m[1]); } catch (e) { token = m[1]; } }
  }
  if (!token) return;  // nothing to claim, the common case

  console.log("[Renters claim] token present, attempting claim");

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
    try { window.sessionStorage.removeItem("renters_claim_token"); } catch (e) {}
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
        console.log("[Renters claim] search attached: " + (d.searchName || ""));
        banner(d);
      } else {
        console.log("[Renters claim] not claimed:", d && d.reason);
      }
    }).catch(function (e) {
      console.error("[Renters claim] claim error", e);
      // Do NOT cleanup on network error: let a reload try again.
    });
  }

  // Small confirmation so the handoff feels intentional. The alerts card
  // (ac-v13) renders the saved search itself; this just acknowledges it
  // and nudges toward Search Areas, which the teaser could not capture.
  function banner(d) {
    var host = document.getElementById("rdc-alerts") || document.querySelector(".page-content, main, body");
    if (!host) return;
    var b = document.createElement("div");
    b.id = "rdc-claim-banner";
    b.style.cssText =
      "background:#e7f4ed;border:1px solid #b9e2cc;border-radius:12px;padding:14px 16px;margin:16px auto;max-width:620px;font-family:inherit;color:#1a5c3a;font-size:14px;line-height:1.5;";
    var whereMsg = d.where
      ? " We saved your area as \\"" + String(d.where).replace(/</g,"&lt;") + "\\" — set your exact neighbourhoods so we can match you."
      : "";
    b.innerHTML = "<strong>Your search is saved.</strong> We will email you the moment a verified home matches." + whereMsg +
      (d.needsAreas ? ' <a href="/account/locations" style="color:#1a7f52;font-weight:600;">Choose my areas</a>' : "");
    if (host.id === "rdc-alerts") host.parentNode.insertBefore(b, host);
    else host.insertBefore(b, host.firstChild);
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
