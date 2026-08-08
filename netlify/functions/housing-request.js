// ============================================================
//  housing-request.js   ·   VERSION: hr-v11  (2026-08-07)
//    hr-v11 link now WRITES THE SEARCH AREAS ONTO THE LEAD.
//           BD's form captures one location - "Your Current Location" - so a
//           lead created through it says where the renter LIVES. The hub was
//           matching listings against that, which for anyone relocating is
//           the wrong city entirely: an Ohio renter searching Utah was shown
//           Ohio listings.
//           Their real search areas come from the zone picker, are geocoded
//           in the browser, and now land in lead_notes as:
//             ZIPS: 84005,84043,84045
//             GEO: 40.3769,-111.7963|40.3916,-111.8508|40.3413,-111.9099
//           The hub reads GEO and matches a listing when it is near ANY of
//           them. Coordinates rather than zips because BD does not store a
//           postal code on listings - confirmed on listing 31, which shows
//           an address on the page but returns none through the API - and
//           because a listing one street outside a zip line is still a good
//           match.
//    hr-v10 +action:"link", which recovers a lead created by BD'S OWN FORM.
//           The API cannot write the questionnaire columns, so requests now
//           go through the Get Matched form - which means we never see the
//           lead id at creation, and without it the member pointer is not
//           written, so withdraw and the card's open state stop working.
//           This finds the lead afterwards: probe UP from the highest id we
//           have seen, take the newest one whose email matches, store the
//           pointer, and hand back the token so the renter can be sent
//           straight to consent.
//           WHY PROBING UP AND NOT SEARCHING: the leads list endpoint is
//           hard-capped at 100 rows, ignores ?offset, and returns the OLDEST
//           hundred - so it can never see a lead created a second ago.
//           Single-id lookup by path segment does work. A high-water mark is
//           kept so this costs a handful of requests, not a crawl.
//    hr-v9  +GET ?profile=NNNN, for the Get Matched prefill.
//           Head code cannot read a member record - that needs BD_API_KEY,
//           which must never be in a public file. This returns the fields
//           the prefill needs and NOTHING ELSE: a whitelist, so a new BD
//           column cannot leak into a page just by existing.
//           type_of_income is not on the list and must not be added.
//           NOT GATED by HUB_ADMIN_KEY. It runs on the renter's own page in
//           their own browser, so it cannot carry an admin key - but that
//           means it will return any member's profile to anyone who asks.
//           The whitelist is what makes that acceptable: budget, timing,
//           property type and the rest are already on a public profile.
//    hr-v8  PENDING IS 1. hr-v7 changed it to 2 and made every dashboard
//           request arrive as MATCHED.
//           The mistake: the create response returned status 2 and that was
//           read as "the default BD assigns". It is not - it was the value
//           being sent. Lead 2948, which reads Pending in BD's admin screen,
//           carries status 1.
//           CONFIRMED BY READING REAL LEADS, not by inference:
//             1 Pending (lead 2948)     2 Matched (lead 2958)
//             5 Sold Out                6 Closed
//           A lead arriving as Matched is not cosmetic - the hub and BD both
//           treat Matched as already introduced, so it would drop out of the
//           queue of things to work.
//    hr-v7  THREE FIXES FOUND ON LEAD 2956.
//           1. status was hardcoded "1". The tested Pending value is 2 - the
//              numbering starts at 2, not 1 - so every dashboard request was
//              landing in an undefined status and reading oddly in BD's
//              admin screen. Now uses STATUS_PENDING, which is the constant
//              that already held the right value.
//           2. url_from is OVERWRITTEN by BD. Sending "Member dashboard"
//              came back as "Received from External Source", so that field
//              cannot carry the source at all. formname and flow_source
//              survive, so the source lives there instead.
//           3. lead_notes listed one AREAS entry per zip, so a single
//              three-zip zone read as "Meadow Ranch, UT | Meadow Ranch, UT |
//              Meadow Ranch, UT". Grouped now, the same way the dashboard
//              card and the location text already were.
//    hr-v6  THE LEAD NOW CARRIES THE WHOLE PROFILE.
//           hr-v5 sent only name, email, phone, location and the zips, so a
//           dashboard request arrived in BD nearly empty next to a Get
//           Matched lead - and worse, lead-index and the consent page both
//           READ those columns, so the hub showed almost nothing and a
//           renter reviewing what we would share had almost nothing to tick.
//           The member record was already being fetched for the email; now
//           its answers are mapped onto the lead's columns.
//
//           MEMBER FIELD -> LEAD FIELD, confirmed against member 4410:
//             seeking                  -> select_all_that_des
//             i_want_to_relocate       -> when_are_you_looki
//             number_of_peop           -> number_of_people_y
//             property_type_preference -> property_type
//             monthly_budget           -> what_is_your_budget
//             co_signer                -> woulda_cosigner_or
//             do_you_have_pets         -> do_you_have_pets
//             my_story                 -> please_describe_the
//             my_obstacles             -> anything_else_we_sh
//
//           type_of_income IS DELIBERATELY NOT MAPPED. It is on the member
//           record, but it is not shareable through lead-consent, and putting
//           it somewhere a provider might see defeats the point. Leaving it
//           out here means it cannot reach a lead either.
//
//           HTML IS STRIPPED. BD stores my_story and my_obstacles as rich
//           text, so an untouched one is "<p><br></p>" - which passes a
//           truthiness check and then renders as blank markup downstream.
//    hr-v5  +reset, for testing. Deletes the member->lead pointer so the
//           dashboard card forgets there was ever a request and shows its
//           first-time state again. ADMIN GATED - it needs HUB_ADMIN_KEY and
//           is not reachable from the dashboard, because a renter undoing a
//           withdrawal should submit a fresh request rather than quietly
//           reopening a closed one.
//           It does NOT touch the lead in BD. If the lead was closed it stays
//           closed; this only clears our own bookkeeping. Deleting the
//           pointer while leaving a live lead open would orphan it.
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
//             1 Pending   2 Matched   5 Sold Out   6 Closed
//           Setting 5 for "closed" was tried first and filed the lead as
//           SOLD OUT, which would have mislabelled every renter who simply
//           found a place. Every one of these was read off a real lead.
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
const FN_VERSION = "hr-v11";

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

async function getLead(id) {
  var d = await bdGet("/leads/get/" + encodeURIComponent(id));
  if (!d || d.status !== "success") return null;
  var l = Array.isArray(d.message) ? d.message[0] : d.message;
  return l && l.lead_id ? l : null;
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
// Read off real leads: 2948 shows Pending in admin and carries 1; sending 2
// produced a lead that reads Matched. Do not infer these from a create
// response - that only echoes what was sent.
const STATUS_PENDING = "1";
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

const crypto = require("crypto");
function hubKeyOk(given) {
  const want = process.env.HUB_ADMIN_KEY || "";
  if (!want) return true;
  const a = Buffer.from(String(given == null ? "" : given));
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Confirmed against member 4410. Anything not listed does not travel to the
// lead, notably type_of_income.
const PROFILE_TO_LEAD = {
  seeking: "select_all_that_des",
  i_want_to_relocate: "when_are_you_looki",
  number_of_peop: "number_of_people_y",
  property_type_preference: "property_type",
  monthly_budget: "what_is_your_budget",
  co_signer: "woulda_cosigner_or",
  do_you_have_pets: "do_you_have_pets",
  my_story: "please_describe_the",
  my_obstacles: "anything_else_we_sh",
};

function plain(v) {
  if (v == null) return "";
  return String(v)
    .replace(new RegExp("<[^>]*>", "g"), " ")
    .replace(new RegExp("&nbsp;", "g"), " ")
    .replace(new RegExp("[ " + String.fromCharCode(9, 13, 10) + "]+", "g"), " ")
    .trim();
}

function profileFields(member) {
  var out = {};
  if (!member) return out;
  Object.keys(PROFILE_TO_LEAD).forEach(function (src) {
    var v = plain(member[src]);
    if (v) out[PROFILE_TO_LEAD[src]] = v;
  });
  return out;
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

  // hr-v9: the fields the Get Matched prefill needs, and only those.
  // Deliberately a whitelist. type_of_income is absent and stays absent.
  if (event.httpMethod === "GET" && q.profile) {
    if (!process.env.BD_API_KEY) return ok({ error: "BD_API_KEY is not set" }, 500);
    var pm = await getMember(String(q.profile).replace(/[^0-9]/g, ""));
    if (!pm) return ok({ error: "Could not read that member" }, 404);
    var allow = [
      "user_id", "first_name", "last_name", "full_name", "email", "phone_number",
      "seeking", "i_want_to_relocate", "number_of_peop", "property_type_preference",
      "monthly_budget", "co_signer", "do_you_have_pets", "ideal_rental",
      "how_are_you_searchi", "if_other_elaborate",
    ];
    var out = {};
    allow.forEach(function (k) { if (pm[k] !== undefined && pm[k] !== null && pm[k] !== "") out[k] = pm[k]; });
    return ok({ ok: true, _v: FN_VERSION, profile: out });
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

  // ---- LINK ----
  // Called right after BD's form has been submitted. Finds the lead that
  // was just created and records it against the member.
  if (body.action === "link") {
    var linkEmail = String(body.email || "").trim().toLowerCase();
    if (!looksLikeEmail(linkEmail)) {
      // Fall back to the member record rather than failing - the caller may
      // not have the email to hand.
      var lm = await getMember(memberId);
      linkEmail = String((lm && lm.email) || "").trim().toLowerCase();
    }
    if (!looksLikeEmail(linkEmail)) return ok({ error: "No email to match against" }, 400);

    var markRec = null;
    try { markRec = await store().get("index:leadtop", { type: "json" }); } catch (e) { markRec = null; }
    var from = parseInt(String(body.fromId || (markRec && markRec.top) || 2900).replace(/[^0-9]/g, ""), 10) || 2900;

    // Climb until nothing is there. A lead created seconds ago is at or just
    // above the mark; PROBE_GAP is how many empty ids we tolerate before
    // deciding we are past the end.
    var PROBE_GAP = 12, MAX_PROBE = 200;
    var best = null, gap = 0, id = from, seenTop = from;
    while (gap < PROBE_GAP && id - from < MAX_PROBE) {
      var cand = await getLead(id);
      if (cand && cand.lead_id) {
        seenTop = id; gap = 0;
        if (String(cand.lead_email || "").trim().toLowerCase() === linkEmail) best = cand;
      } else { gap++; }
      id++;
    }

    try { await store().setJSON("index:leadtop", { top: seenTop, at: new Date().toISOString() }); } catch (e) {}

    if (!best) {
      return ok({ ok: false, _v: FN_VERSION, linked: false,
        error: "Could not find a new request for that member. It may still have been created.",
        searchedFrom: from, searchedTo: id - 1 }, 404);
    }

    // Write the search areas onto the lead. BD's form only captured where
    // they live; this is where they are looking.
    var lAreas = Array.isArray(body.areas) ? body.areas.filter(function (a) { return a && a.zip; }) : [];
    var lZips = [], lGeo = [], lLabels = [];
    lAreas.forEach(function (a) {
      var z = String(a.zip).replace(/[^0-9]/g, "");
      if (z && lZips.indexOf(z) === -1) lZips.push(z);
      if (a.lat && a.lon) lGeo.push(Number(a.lat).toFixed(4) + "," + Number(a.lon).toFixed(4));
      var lb = String(a.label || z).trim();
      if (lb && lLabels.indexOf(lb) === -1) lLabels.push(lb);
    });

    if (lZips.length) {
      var keep = String(best.lead_notes || "").split("\n")
        .filter(function (line) { return line && line.indexOf("ZIPS:") !== 0 && line.indexOf("GEO:") !== 0 && line.indexOf("AREAS:") !== 0; });
      var newNotes = ["ZIPS: " + lZips.join(",")];
      if (lGeo.length) newNotes.push("GEO: " + lGeo.join("|"));
      if (lLabels.length) newNotes.push("AREAS: " + lLabels.join(" | "));
      newNotes.push("Searching from the member dashboard.");
      var noteRes = await bdPut("/leads/update", {
        lead_id: best.lead_id,
        lead_notes: keep.concat(newNotes).join("\n"),
      });
      if (!noteRes.ok) console.error("[housing-request] could not write areas to lead " + best.lead_id + ": " + noteRes.error);
    }

    var linkRec = {
      leadId: best.lead_id, token: best.token || null, status: "open",
      createdAt: best.date_added || new Date().toISOString(),
      areaCount: lZips.length, areaLabels: lLabels,
      areaGeo: lGeo, locationText: best.lead_location || "",
      via: "getmatched-form",
    };
    await writeRequest(memberId, linkRec);
    console.log("[housing-request] linked member " + memberId + " -> lead " + best.lead_id);

    return ok({ ok: true, _v: FN_VERSION, linked: true,
      leadId: best.lead_id, token: best.token || null, areaCount: lZips.length,
      consentUrl: best.token
        ? (CONSENT_BASE + "?id=" + encodeURIComponent(best.lead_id) + "&token=" + encodeURIComponent(best.token))
        : null });
  }

  // ---- RESET (admin only) ----
  // Clears our pointer for this member. The card then shows its first-time
  // state. Deliberately not exposed to renters: undoing a withdrawal should
  // mean submitting a fresh request, not silently reviving a closed lead.
  if (body.action === "reset") {
    if (!hubKeyOk(body.key)) return ok({ error: "Unauthorized" }, 401);
    var had = await readRequest(memberId);
    try {
      await store().delete(mkey(memberId));
    } catch (e) {
      // A missing key throws rather than returning quietly, which is the
      // normal "nothing to clear" path.
      return ok({ ok: true, _v: FN_VERSION, reset: true, hadRequest: false, note: "Nothing was stored for that member." });
    }
    console.log("[housing-request] reset member " + memberId + (had ? " (had lead " + had.leadId + ")" : " (nothing stored)"));
    return ok({ ok: true, _v: FN_VERSION, reset: true, hadRequest: !!had,
      clearedLeadId: had ? had.leadId : null,
      note: had && had.leadId ? "The lead itself is untouched in BD - close it there if it should not stay open." : null });
  }

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
  // BD stores one service area per zip, so a zone spanning three zips
  // arrives as three identical labels. Collapse for the notes, or a single
  // zone reads as three places.
  var rawLabels = areas.map(function (a) { return String(a.label || a.zip).trim(); }).filter(Boolean);
  var seenLabel = {}, labels = [];
  rawLabels.forEach(function (l) {
    if (seenLabel[l] === undefined) { seenLabel[l] = 0; labels.push(l); }
    seenLabel[l]++;
  });
  var labelsWithCounts = labels.map(function (l) {
    return seenLabel[l] > 1 ? (l + " (" + seenLabel[l] + " zipcodes)") : l;
  });
  var zips = areas.map(function (a) { return String(a.zip).replace(/[^0-9]/g, ""); }).filter(Boolean);
  var uniqueZips = zips.filter(function (z, i) { return zips.indexOf(z) === i; });

  var locationText = String(body.locationText || "").trim() ||
    (labels.length ? labels.slice(0, 3).join(" / ") + (labels.length > 3 ? " and " + (labels.length - 3) + " more" : "") : "");

  var notes = [];
  if (uniqueZips.length) notes.push("ZIPS: " + uniqueZips.join(","));
  if (labelsWithCounts.length) notes.push("AREAS: " + labelsWithCounts.join(" | "));
  notes.push("Submitted from the member dashboard by member " + memberId + ".");

  var profile = profileFields(member);

  var params = {
    lead_name: name || "Member " + memberId,
    lead_email: email,
    lead_location: locationText || "Not specified",
    // url_from is NOT ours to set - BD overwrites it with "Received from
    // External Source" no matter what is sent. formname and flow_source do
    // survive, so the source is recorded there and in the notes.
    formname: "dashboard_housing_request",
    flow_source: "Member dashboard",
    lead_notes: notes.join("\n"),
    // Locked off. We control the email flow, and matching is a decision.
    send_lead_email_notification: "0",
    auto_match: "0",
    // BD's auto_geocode did nothing on create, so coordinates are supplied.
    auto_geocode: "0",
    status: STATUS_PENDING,
  };
  // Everything the member has already told us, onto the lead.
  Object.keys(profile).forEach(function (k) { params[k] = profile[k]; });
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
