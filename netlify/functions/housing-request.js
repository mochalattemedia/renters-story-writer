// ============================================================
//  housing-request.js   ·   VERSION: hr-v4   (2026-08-07)
//    hr-v4  THE REQUEST HAS A LIFECYCLE, NOT JUST A CREATE.
//           A renter who has found a place must be able to STOP being
//           introduced, and one who has changed their areas should be able
//           to refresh rather than stack up duplicates. Three new actions:
//             GET  ?memberId=NNNN     what is their current request
//             POST { action:"withdraw", memberId, leadId, reason? }
//             POST { action:"update",   memberId, leadId, areas[] }
//           Status is kept in BD - a lead has a status field and the hub
//           already reads it - while Blobs holds the member->lead pointer
//           so the dashboard can answer "do you have an open request"
//           without a BD lookup on every page load. One place per fact.
//
//           BD STATUS NUMBERS, CONFIRMED BY TESTING, NOT ASSUMED:
//             2 Pending (what a new lead gets)   5 Sold Out
//             6 Closed                            
//           The numbering does NOT start at 1. Setting 5 for "closed" was
//           tried first and filed the lead as SOLD OUT, which would have
//           mislabelled every renter who simply found a place.
//    hr-v3  THE CONSENT URL IS ABSOLUTE.
//           hr-v2 returned a relative path. Head code runs on
//           www.renters.com and resolved it there, so the redirect landed on
//           renters.com/lead-consent-page.html - which does not exist. That
//           page is served from Netlify. Anything head code is told to
//           navigate to must carry its own origin.
//    hr-v2  THE EMAIL COMES FROM BD, NOT FROM THE PAGE.
//           hr-v1 required the caller to send name and email, and the head
//           code scraped them out of the dashboard text. That failed on real
//           accounts - "A valid email is required" on a member with a
//           perfectly good address - because the dashboard does not reliably
//           render it anywhere scrapeable.
//           This function already holds BD_API_KEY and is given the member
//           id, so it reads the member record itself. Anything the caller
//           sends is treated as a hint, not a requirement. Scraping page
//           text for identity was the wrong shape from the start.
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
const FN_VERSION = "hr-v4";

const https = require("https");
const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";

// The consent page is served from Netlify, NOT from renters.com. Head code
// runs on renters.com, so a relative path resolves to the wrong host.
const CONSENT_BASE = process.env.CONSENT_PAGE_URL ||
  "https://renters-story-writer.netlify.app/lead-consent-page.html";

function bdGet(path) {
  return new Promise(function (resolve) {
    var u;
    try { u = new URL(BD_BASE + path); } catch (e) { return resolve(null); }
    var req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
      method: "GET", headers: { "X-Api-Key": process.env.BD_API_KEY, Accept: "application/json" },
    }, function (res) {
      var raw = "";
      res.on("data", function (c) { raw += c; });
      res.on("end", function () {
        try { resolve(JSON.parse(raw)); } catch (e) { resolve(null); }
      });
    });
    req.on("error", function () { resolve(null); });
    req.setTimeout(9000, function () { req.destroy(); resolve(null); });
    req.end();
  });
}

async function getMember(id) {
  var d = await bdGet("/user/get/" + encodeURIComponent(id));
  if (!d || d.status !== "success") return null;
  var m = Array.isArray(d.message) ? d.message[0] : d.message;
  return m && m.user_id ? m : null;
}

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

// Confirmed live against lead 2951. Do not guess at these.
const STATUS_PENDING = "2";
const STATUS_CLOSED = "6";

const { getStore } = require("@netlify/blobs");
function store() {
  return getStore({
    name: "housing-requests",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN,
  });
}
function mkey(memberId) { return "member:" + String(memberId).replace(/[^0-9]/g, ""); }

async function readRequest(memberId) {
  try { return await store().get(mkey(memberId), { type: "json" }); }
  catch (e) { return null; }
}
async function writeRequest(memberId, rec) {
  await store().setJSON(mkey(memberId), rec);
}

function bdPut(path, params) {
  return new Promise(function (resolve) {
    var body = new URLSearchParams(params).toString();
    var u;
    try { u = new URL(BD_BASE + path); } catch (e) { return resolve({ ok: false, error: "bad URL" }); }
    var req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: "PUT",
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
        var d = null;
        try { d = JSON.parse(raw); } catch (e) {}
        if (!d || d.status !== "success") return resolve({ ok: false, error: (d && String(d.message)) || raw.slice(0, 150) });
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
    return ok({ ok: true, _v: FN_VERSION,
      bdKeyConfigured: !!process.env.BD_API_KEY,
      blobsConfigured: !!process.env.NETLIFY_SITE_ID && !!process.env.NETLIFY_BLOBS_TOKEN });
  }

  // The dashboard card asks this on every load. It reads Blobs only - no BD
  // call - so it costs nothing against the rate limit.
  if (event.httpMethod === "GET" && q.memberId) {
    var rec = await readRequest(q.memberId);
    if (!rec || rec.status === "withdrawn") {
      return ok({ ok: true, _v: FN_VERSION, hasRequest: false, previous: rec || null });
    }
    return ok({ ok: true, _v: FN_VERSION, hasRequest: true, request: rec });
  }
  if (event.httpMethod !== "POST") return ok({ error: "POST a housing request" }, 405);
  if (!process.env.BD_API_KEY) return ok({ error: "BD_API_KEY is not set" }, 500);

  var body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return ok({ error: "Invalid JSON" }, 400); }

  var memberId = String(body.memberId || "").replace(/[^0-9]/g, "");
  if (!memberId) return ok({ error: "memberId is required" }, 400);

  // ---- WITHDRAW ----
  // Closes the lead in BD so it can never be introduced, then records it
  // locally. BD first: if that write fails we must not tell a renter they
  // have stopped being introduced when they have not.
  if (body.action === "withdraw") {
    var cur = await readRequest(memberId);
    var leadId = String(body.leadId || (cur && cur.leadId) || "").replace(/[^0-9]/g, "");
    if (!leadId) return ok({ error: "No open request to withdraw" }, 400);

    var closed = await bdPut("/leads/update", { lead_id: leadId, status: STATUS_CLOSED });
    if (!closed.ok) {
      console.error("[housing-request] withdraw failed for lead " + leadId + ": " + closed.error);
      return ok({ error: "Could not close that request", detail: closed.error, _v: FN_VERSION }, 502);
    }

    var rec = Object.assign({}, cur || {}, {
      leadId: leadId,
      status: "withdrawn",
      withdrawnAt: new Date().toISOString(),
      // The only moment a renter will ever tell us how it went. "Found a
      // place" is worth knowing even when the match happened elsewhere.
      withdrawReason: body.reason ? String(body.reason).slice(0, 200) : null,
    });
    await writeRequest(memberId, rec);
    console.log("[housing-request] member " + memberId + " withdrew lead " + leadId + " (" + (rec.withdrawReason || "no reason") + ")");
    return ok({ ok: true, _v: FN_VERSION, withdrawn: true, leadId: leadId });
  }

  // ---- UPDATE ----
  // Refreshes the areas on an existing request. A renter tweaking where they
  // are looking has not made a new ask, so this must not create a second lead.
  if (body.action === "update") {
    var curU = await readRequest(memberId);
    var lid = String(body.leadId || (curU && curU.leadId) || "").replace(/[^0-9]/g, "");
    if (!lid) return ok({ error: "No open request to update" }, 400);

    var uAreas = Array.isArray(body.areas) ? body.areas.filter(function (a) { return a && a.zip; }) : [];
    var uMid = centre(uAreas);
    var uZips = uAreas.map(function (a) { return String(a.zip).replace(/[^0-9]/g, ""); }).filter(Boolean);
    var uUniq = uZips.filter(function (z, i) { return uZips.indexOf(z) === i; });
    var uLabels = uAreas.map(function (a) { return String(a.label || a.zip).trim(); }).filter(Boolean);

    var uParams = { lead_id: lid, status: STATUS_PENDING };
    if (body.locationText) uParams.lead_location = String(body.locationText);
    var uNotes = [];
    if (uUniq.length) uNotes.push("ZIPS: " + uUniq.join(","));
    if (uLabels.length) uNotes.push("AREAS: " + uLabels.join(" | "));
    uNotes.push("Updated from the member dashboard.");
    uParams.lead_notes = uNotes.join("\n");
    if (uMid) { uParams.lat = String(uMid.lat); uParams.lng = String(uMid.lon); }

    var upd = await bdPut("/leads/update", uParams);
    if (!upd.ok) return ok({ error: "Could not update that request", detail: upd.error, _v: FN_VERSION }, 502);

    var recU = Object.assign({}, curU || {}, {
      leadId: lid, status: "open", updatedAt: new Date().toISOString(),
      areaCount: uUniq.length, areaLabels: uLabels,
    });
    await writeRequest(memberId, recU);
    return ok({ ok: true, _v: FN_VERSION, updated: true, leadId: lid, areaCount: uUniq.length });
  }

  // hr-v2: BD is the source of truth for who this member is. Whatever the
  // caller sent is a hint; the member record wins. A dashboard that does not
  // happen to render an email must not stop a renter asking for help.
  var member = await getMember(memberId);
  var email = String((member && member.email) || body.email || "").trim();
  var name = String(
    (member && (member.full_name || ((member.first_name || "") + " " + (member.last_name || "")).trim())) ||
    body.name || ""
  ).trim();
  var phone = String((member && member.phone_number) || body.phone || "").trim();

  if (!looksLikeEmail(email)) {
    return ok({
      error: member
        ? "That account has no email address on file, so we cannot create a request for it."
        : "Could not read that member from BD. Try again in a moment.",
      memberFound: !!member,
      _v: FN_VERSION,
    }, 400);
  }

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
  if (phone) params.lead_phone = phone;
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

  // Remember it, so the dashboard can show status without asking BD.
  try {
    await writeRequest(memberId, {
      leadId: leadId, token: token, status: "open",
      createdAt: new Date().toISOString(),
      areaCount: uniqueZips.length, areaLabels: labels,
      locationText: locationText,
    });
  } catch (e) { console.error("[housing-request] could not record request:", e && e.message); }

  console.log("[housing-request] member " + memberId + " -> lead " + leadId + ", " + uniqueZips.length + " areas");

  return ok({
    ok: true, _v: FN_VERSION,
    leadId: leadId, token: token,
    areaCount: uniqueZips.length,
    geocoded: !!(lat && lon),
    // Where to send them next, while they are still engaged.
    consentUrl: CONSENT_BASE + "?id=" + encodeURIComponent(leadId) + "&token=" + encodeURIComponent(token),
  });
};

module.exports._internal = { centre, looksLikeEmail, FN_VERSION };
