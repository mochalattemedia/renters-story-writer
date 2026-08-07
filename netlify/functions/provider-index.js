// ============================================================
//  provider-index.js   ·   VERSION: pi-v4   (2026-08-06, diagnostics on every BD failure)
//
//  Indexes LISTINGS and the members who own them, so the hub can answer
//  "who is near this renter, and what have they got".
//
//  WHY IT WALKS IDS
//  Same constraint as leads. users_portfolio_groups/get ignores its query
//  parameters - passing user_id or group_token returned the same first row
//  both times. Path-segment lookup (/users_portfolio_groups/get/12) filters
//  correctly, which is the asymmetry the Bible already records for
//  /user/get. There are only tens of listings, so walking up from id 1 is
//  cheap and complete.
//
//  TWO HOPS PER LISTING
//  A listing carries user_id but not the owner's name or plan. Owners are
//  fetched separately and cached within the run, so a PM with 40 units
//  costs one member lookup, not 40.
//
//  THE FIELD TRAPS ARE REAL AND DOCUMENTED
//    rent lives in post_promo, NOT property_price (which BD syncs itself)
//    property_beds / property_baths were reversed in BD and later corrected
//  Read them as they are now and do not "fix" them here - lw-v52 resolves
//  the form side by label, and this only reads.
//
//  ENDPOINTS
//   GET ?version=1        -> config probe
//   GET                   -> cached index, no BD calls
//   GET ?refresh=1        -> rebuild, then return
//   GET ?refresh=1&max=400 -> how far up to walk
//
//  ENV  BD_API_KEY, NETLIFY_SITE_ID, NETLIFY_BLOBS_TOKEN
// ============================================================
const FN_VERSION = "pi-v4";

const https = require("https");
// ADMIN GATE. This function returns renter names, emails and phone numbers,
// so it must not answer an unauthenticated request. Set HUB_ADMIN_KEY in
// Netlify and pass ?key= on every call. Constant-time compare, so the key
// cannot be guessed a character at a time from response timings.
// The renter-facing consent page is deliberately NOT gated by this - it is
// authorised by the lead's own id+token pair instead.
const crypto = require("crypto");
function keyOk(given) {
  const want = process.env.HUB_ADMIN_KEY || "";
  if (!want) return true;               // unset means open, so nothing breaks before it is configured
  const a = Buffer.from(String(given == null ? "" : given));
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const { getStore } = require("@netlify/blobs");

const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";
const INDEX_KEY = "index:providers";
const DEFAULT_MAX = 400;
const BATCH = 6;
const PAUSE_MS = 220;
const STOP_AFTER_MISSES = 60;
// Owners are fetched more gently than listings. The first run asked for 67
// in quick succession and got nothing back, which reads as throttling.
const OWNER_BATCH = 3;
const OWNER_PAUSE_MS = 500;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

function store() {
  return getStore({
    name: "provider-index",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN,
  });
}

// pi-v4: bdGet reports WHY it failed instead of returning a bare null.
// The owner pass returned 0 from 8 attempts while the same call worked by
// hand, so the failure has to be visible rather than inferred. Every reason
// is captured and surfaced on the response.
var DIAG = [];
function note(t) { if (DIAG.length < 30) DIAG.push(t); }

function bdGet(path) {
  return new Promise(function (resolve) {
    var u;
    try { u = new URL(BD_BASE + path); } catch (e) { note(path + " -> bad URL"); return resolve(null); }
    var req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
      method: "GET", headers: { "X-Api-Key": process.env.BD_API_KEY, Accept: "application/json" },
    }, function (res) {
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        res.resume(); note(path + " -> redirect " + res.statusCode); return resolve(null);
      }
      var raw = "";
      res.on("data", function (c) { raw += c; });
      res.on("end", function () {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          note(path + " -> HTTP " + res.statusCode + " " + raw.slice(0, 90));
          return resolve(null);
        }
        try { resolve(JSON.parse(raw)); }
        catch (e) { note(path + " -> unparseable: " + raw.slice(0, 90)); resolve(null); }
      });
    });
    req.on("error", function (e) { note(path + " -> " + (e && e.message)); resolve(null); });
    req.setTimeout(9000, function () { req.destroy(); note(path + " -> timeout"); resolve(null); });
    req.end();
  });
}

function first(d) {
  if (!d) return null;
  var m = d.message;
  return Array.isArray(m) ? m[0] : m;
}

async function getListing(id) {
  var l = first(await bdGet("/users_portfolio_groups/get/" + encodeURIComponent(id)));
  return l && l.group_id ? l : null;
}
async function getMember(id) {
  var d = await bdGet("/user/get/" + encodeURIComponent(id));
  if (!d) return null;                                  // bdGet already noted why
  if (d.status && d.status !== "success") { note("user " + id + " -> status " + d.status); return null; }
  var m = first(d);
  if (!m) { note("user " + id + " -> empty message"); return null; }
  if (!m.user_id) { note("user " + id + " -> no user_id, keys: " + Object.keys(m).slice(0, 6).join(",")); return null; }
  return m;
}

// Plan level -> what they actually are. Landlord 17, PM 14, Realtor 18,
// Renter 15. A realtor should never appear as a rental provider, so they
// are indexed but flagged rather than silently included.
function planOf(m) {
  var s = m && m.subscription_schema;
  var name = "";
  try {
    if (s && typeof s === "object") name = s.subscription_name || s.name || "";
    else if (typeof s === "string") name = s;
  } catch (e) {}
  var t = String(name || m.subscription_name || "").toLowerCase();
  if (t.indexOf("property manager") !== -1) return "pm";
  if (t.indexOf("realtor") !== -1) return "realtor";
  if (t.indexOf("landlord") !== -1) return "landlord";
  if (t.indexOf("renter") !== -1) return "renter";
  return "";
}

function num(v) { var n = Number(String(v == null ? "" : v).replace(/[^0-9.]/g, "")); return isFinite(n) && n > 0 ? n : null; }

function shapeListing(l) {
  return {
    id: l.group_id,
    ownerId: l.user_id,
    title: l.group_name || "",
    location: l.post_location || "",
    lat: l.lat ? Number(l.lat) : null,
    lon: l.lon ? Number(l.lon) : null,
    state: l.state_sn || "",
    // Rent is post_promo. property_price is BD's own synced field and is
    // null on every record we have looked at - see the Bible.
    rent: num(l.post_promo),
    beds: l.property_beds || "",
    baths: l.property_baths || "",
    sqft: l.property_sqr_foot || "",
    type: l.property_type || "",
    subtype: l.sub_property_type || "",
    duration: l.property_duration || "",
    furnished: l.status || "",
    live: String(l.group_status || "") === "1",
    slug: l.group_filename || "",
  };
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };
  var q = event.queryStringParameters || {};

  if (q.version === "1") {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({
      ok: true, _v: FN_VERSION,
      bdKeyConfigured: !!process.env.BD_API_KEY,
      blobsConfigured: !!process.env.NETLIFY_SITE_ID && !!process.env.NETLIFY_BLOBS_TOKEN,
    })};
  }

  if (!keyOk(q.key)) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  var s = store();

  if (!q.refresh) {
    try {
      var c = await s.get(INDEX_KEY, { type: "json" });
      if (c) return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, _v: FN_VERSION, cached: true, builtAt: c.builtAt, listings: c.listings, providers: c.providers }) };
    } catch (e) {}
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, _v: FN_VERSION, cached: false, listings: [], providers: [], note: "No index yet. Call with ?refresh=1." }) };
  }

  if (!process.env.BD_API_KEY) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "BD_API_KEY is not set" }) };
  }

  var max = Math.min(Math.max(parseInt(q.max, 10) || DEFAULT_MAX, 10), 2000);
  var listings = [], misses = 0, id = 1;

  while (id <= max) {
    var ids = [];
    for (var i = 0; i < BATCH && id <= max; i++) { ids.push(id); id++; }
    var got = await Promise.all(ids.map(getListing));
    got.forEach(function (l) {
      if (l) { listings.push(shapeListing(l)); misses = 0; }
      else { misses++; }
    });
    if (misses >= STOP_AFTER_MISSES) break;
    if (id <= max) await sleep(PAUSE_MS);
  }

  if (!listings.length) {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ error: "No listings found. Existing index left untouched.", _v: FN_VERSION }) };
  }

  // pi-v3: ONLY look up owners of LIVE listings.
  // The first run found 79 listings across 67 distinct owners and returned
  // ZERO providers - 67 rapid /user/get calls straight after 79 listing
  // calls, which is exactly the shape of BD throttling (the Bible records
  // byte-identical 400s under load). Only 8 of those 79 listings were live,
  // so 59 of those lookups were for drafts nobody can be introduced to
  // anyway. Asking for 8 instead of 67 is both kinder to BD and the only
  // set the hub actually needs.
  // ?all=1 restores the full sweep if you ever want draft owners too.
  var wantAll = q.all === "1";
  var ownerIds = {};
  listings.forEach(function (l) {
    if (!l.ownerId || l.ownerId === "0") return;
    if (!wantAll && !l.live) return;
    ownerIds[l.ownerId] = 1;
  });
  var uniq = Object.keys(ownerIds);
  var providers = [];
  // A pause before switching endpoints. The listing walk has just made
  // dozens of requests and BD does not distinguish between them.
  if (uniq.length) await sleep(700);
  for (var j = 0; j < uniq.length; j += OWNER_BATCH) {
    var slice = uniq.slice(j, j + OWNER_BATCH);
    var members = await Promise.all(slice.map(getMember));
    members.forEach(function (m) {
      if (!m) return;
      var mine = listings.filter(function (l) { return String(l.ownerId) === String(m.user_id); });
      var withGeo = mine.filter(function (l) { return l.lat && l.lon; });
      providers.push({
        id: m.user_id,
        name: (m.full_name || ((m.first_name || "") + " " + (m.last_name || "")).trim() || m.company || "").trim(),
        company: m.company || "",
        email: m.email || "",
        phone: m.phone_number || "",
        plan: planOf(m),
        verified: String(m.verified) === "1",
        location: m.user_location || [m.city, m.state_code].filter(Boolean).join(", "),
        // Centre of their listings, so proximity works even when the member
        // record has no coordinates of its own.
        lat: withGeo.length ? withGeo.reduce(function (a, l) { return a + l.lat; }, 0) / withGeo.length : (m.lat ? Number(m.lat) : null),
        lon: withGeo.length ? withGeo.reduce(function (a, l) { return a + l.lon; }, 0) / withGeo.length : (m.lon ? Number(m.lon) : null),
        listingCount: mine.length,
        liveCount: mine.filter(function (l) { return l.live; }).length,
        listingIds: mine.map(function (l) { return l.id; }),
      });
    });
    if (j + OWNER_BATCH < uniq.length) await sleep(OWNER_PAUSE_MS);
  }

  var payload = { builtAt: new Date().toISOString(), listings: listings, providers: providers };
  try { await s.setJSON(INDEX_KEY, payload); }
  catch (e) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Indexed but could not cache", detail: e && e.message, listings: listings.length }) };
  }

  console.log("[provider-index] " + listings.length + " listings, " + providers.length + " providers");

  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({
    ok: true, _v: FN_VERSION, refreshed: true, builtAt: payload.builtAt,
    listingCount: listings.length,
    liveCount: listings.filter(function (l) { return l.live; }).length,
    ownersAttempted: uniq.length,
    ownerIdsTried: uniq,
    diagnostics: DIAG,
    providerCount: providers.length,
    listings: listings, providers: providers,
  })};
};

module.exports._internal = { shapeListing, planOf, num, FN_VERSION };
