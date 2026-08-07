// ============================================================
//  housing-request.js   ·   VERSION: hr-v1   (2026-08-07)
//
//  Creates a housing request from a member's own dashboard, using the
//  profile and search areas they have already set. One click, no form.
//
//  WHY A FUNCTION AND NOT HEAD CODE
//  Creating a lead needs BD_API_KEY. That cannot live in head code, which
//  is public. So head code gathers what only a logged-in browser can see -
//  the member's service areas, read from BD's widget endpoint, which is
//  SESSION authenticated and not reachable from a server - geocodes them,
//  and posts the result here. This function holds the key and does the
//  write.
//
//  WHAT THE LEAD CARRIES
//  Real coordinates, because BD's auto_geocode=1 did nothing on create -
//  lat and lng came back empty on a test lead. The Bible already records
//  that BD accepts zeroed geo values and silently discards the row, so
//  every geo value here is real or absent, never zero.
//  The FULL zip list goes in lead_notes. The pin is the centre of their
//  areas, but matching must check every zip: a listing can sit inside one
//  of their areas while being far from the centroid.
//
//  NO EMAILS, NO AUTO-MATCH
//   send_lead_email_notification=0  we control the email flow ourselves
//   auto_match=0                    matching is a decision, not a default
//
//  WHY IT RETURNS THE TOKEN
//  BD generates a token on create. That is what the consent page needs, so
//  the caller can send the renter straight there while they are engaged
//  rather than chasing them days later.
//
//  ENDPOINTS
//   GET  ?version=1   config probe
//   POST { memberId, name, email, phone?, areas[], lat?, lon?, source? }
//        areas: [{ zip, label?, lat?, lon? }]
//
//  ENV  BD_API_KEY
// ============================================================
const FN_VERSION = "hr-v1";

const https = require("https");
const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

function ok(b, s) { return { statusCode: s || 200, headers: corsHeaders, body: JSON.stringify(b) }; }

function bdPost(path, params) {
  return new Promise(function (resolve) {
    var body = new URLSearchParams(params).toString();
    var u;
    try { u = new URL(BD_BASE + path); } catch (e) { return resolve({ ok: false, error: "bad URL" }); }
    var req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: "POST",
      headers: {
        "X-Api-Key": process.env.BD_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        Accept: "application/json",
      },
    }, function (res) {
      var raw = "";
      res.on("data", function (c) { raw += c; });
      res.on("end", function () {
        if (res.statusCode === 429 || raw.indexOf("Too many API requests") !== -1) {
          return resolve({ ok: false, throttled: true, error: "BD rate limit" });
        }
        var d = null;
        try { d = JSON.parse(raw); } catch (e) {}
        if (!d) return resolve({ ok: false, error: "Unparseable response", raw: raw.slice(0, 200) });
        if (d.status !== "success") return resolve({ ok: false, error: (d.message && String(d.message)) || "BD rejected the request" });
        resolve({ ok: true, data: d.message });
      });
    });
    req.on("error", function (e) { resolve({ ok: false, error: e && e.message }); });
    req.setTimeout(10000, function () { req.destroy(); resolve({ ok: false, error: "timeout" }); });
    req.write(body);
    req.end();
  });
}

function looksLikeEmail(e) {
  if (typeof e !== "string") return false;
  var v = e.trim();
  return v.length <= 254 && /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/.test(v);
}

// Mean of whatever coordinates we were given. Only the map pin depends on
// this - matching uses the full zip list, so a renter searching two distant
// cities gets an odd pin but correct matches.
function centre(areas) {
  var pts = areas.filter(function (a) { return isFinite(a.lat) && isFinite(a.lon) && a.lat && a.lon; });
  if (!pts.length) return null;
  return {
    lat: pts.reduce(function (s, a) { return s + Number(a.lat); }, 0) / pts.length,
    lon: pts.reduce(function (s, a) { return s + Number(a.lon); }, 0) / pts.length,
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };
  var q = event.queryStringParameters || {};

  if (event.httpMethod === "GET" && q.version === "1") {
    return ok({ ok: true, _v: FN_VERSION, bdKeyConfigured: !!process.env.BD_API_KEY });
  }
  if (event.httpMethod !== "POST") return ok({ error: "POST a housing request" }, 405);
  if (!process.env.BD_API_KEY) return ok({ error: "BD_API_KEY is not set" }, 500);

  var body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return ok({ error: "Invalid JSON" }, 400); }

  var memberId = String(body.memberId || "").replace(/[^0-9]/g, "");
  var email = String(body.email || "").trim();
  var name = String(body.name || "").trim();
  if (!memberId) return ok({ error: "memberId is required" }, 400);
  if (!looksLikeEmail(email)) return ok({ error: "A valid email is required" }, 400);

  var areas = Array.isArray(body.areas) ? body.areas.filter(function (a) { return a && a.zip; }) : [];
  var mid = centre(areas);
  var lat = isFinite(body.lat) && body.lat ? Number(body.lat) : (mid ? mid.lat : null);
  var lon = isFinite(body.lon) && body.lon ? Number(body.lon) : (mid ? mid.lon : null);

  // A readable summary of where they are looking, plus the machine-readable
  // zip list. The hub reads ZIPS: from notes to match every area, not just
  // the pin.
  var labels = areas.map(function (a) { return String(a.label || a.zip).trim(); }).filter(Boolean);
  var zips = areas.map(function (a) { return String(a.zip).replace(/[^0-9]/g, ""); }).filter(Boolean);
  var uniqueZips = zips.filter(function (z, i) { return zips.indexOf(z) === i; });

  var locationText = String(body.locationText || "").trim() ||
    (labels.length ? labels.slice(0, 3).join(" / ") + (labels.length > 3 ? " and " + (labels.length - 3) + " more" : "") : "");

  var notes = [];
  if (uniqueZips.length) notes.push("ZIPS: " + uniqueZips.join(","));
  if (labels.length) notes.push("AREAS: " + labels.join(" | "));
  notes.push("Submitted from the member dashboard.");

  var params = {
    lead_name: name || "Member " + memberId,
    lead_email: email,
    lead_location: locationText || "Not specified",
    url_from: String(body.source || "/account/home"),
    formname: "dashboard_housing_request",
    flow_source: "dashboard",
    lead_notes: notes.join("\n"),
    // Locked off. We control the email flow, and matching is a decision.
    send_lead_email_notification: "0",
    auto_match: "0",
    // BD's auto_geocode did nothing on create, so coordinates are supplied.
    auto_geocode: "0",
    status: "1",
  };
  if (body.phone) params.lead_phone = String(body.phone).trim();
  // Never send zeros. BD accepts them and silently discards the row.
  if (lat && lon) {
    params.lat = String(lat);
    params.lng = String(lon);
    params.location_type = "locality";
    params.country_sn = "US";
  }
  if (body.preferredDay) params.lead_preferred_day = String(body.preferredDay);
  if (body.preferredTime) params.lead_preferred_time = String(body.preferredTime);

  var res = await bdPost("/leads/create", params);
  if (!res.ok) {
    console.error("[housing-request] create failed for member " + memberId + ": " + res.error);
    return ok({ error: "Could not create the request", detail: res.error, throttled: !!res.throttled, _v: FN_VERSION }, 502);
  }

  var lead = Array.isArray(res.data) ? res.data[0] : res.data;
  var leadId = lead && lead.lead_id;
  var token = lead && lead.token;

  if (!leadId || !token) {
    // The lead may exist without these, but the consent link cannot be built
    // without both, so say so rather than returning a half-usable result.
    return ok({ error: "BD created the request but returned no id or token", raw: lead, _v: FN_VERSION }, 502);
  }

  console.log("[housing-request] member " + memberId + " -> lead " + leadId + ", " + uniqueZips.length + " areas");

  return ok({
    ok: true, _v: FN_VERSION,
    leadId: leadId, token: token,
    areaCount: uniqueZips.length,
    geocoded: !!(lat && lon),
    // Where to send them next, while they are still engaged.
    consentUrl: "/lead-consent-page.html?id=" + encodeURIComponent(leadId) + "&token=" + encodeURIComponent(token),
  });
};

module.exports._internal = { centre, looksLikeEmail, FN_VERSION };
