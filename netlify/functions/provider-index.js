// ============================================================
//  provider-index.js   ·   VERSION: pi-v6   (2026-08-06)
//
//  Indexes LISTINGS and the members who own them, RESUMABLY.
//
//  WHY IT IS RESUMABLE
//  pi-v5 tried to crawl the whole id range in one call and BD refused:
//      HTTP 429 {"status":"error","message":"Too many API requests per minute"}
//  starting around the hundredth request. Slower pacing does not fix a
//  per-minute limit - a long crawl will always reach it, and Netlify's ~10s
//  function ceiling means a full sweep was never going to fit anyway.
//  So each call does a SLICE, merges it into what is already stored, and
//  records where it stopped. Call it a few times and the index fills in.
//  Nothing is discarded on a partial run.
//
//  429 ENDS THE RUN IMMEDIATELY. Once BD says slow down, every further
//  request that minute is wasted AND indistinguishable from a missing
//  record - which is how pi-v5 reported 79 listings when there may be more.
//  The run stops, keeps what it has, does not advance the cursor past ids
//  it never actually saw, and says it was throttled.
//
//  WHY IT WALKS IDS AT ALL
//  users_portfolio_groups/get ignores query parameters - user_id and
//  group_token both returned the same first row. Path-segment lookup
//  filters correctly. Same asymmetry the Bible records for /user/get.
//
//  FIELD TRAPS, READ ONLY
//    rent is post_promo, NOT property_price (BD syncs that itself)
//    beds/baths were reversed in BD and later corrected - read as-is
//
//  ENDPOINTS
//   GET ?version=1          config probe
//   GET                     cached index, no BD calls
//   GET ?scan=1             index the next slice
//   GET ?scan=1&slice=40    how many ids to try this call
//   GET ?scan=1&restart=1   begin again from id 1
//   GET ?owners=1           fetch owners of live listings
//   GET ?owners=1&all=1     ...including draft-only owners
//   GET ?reset=1            wipe the index
//
//  TYPICAL USE
//   ?scan=1 repeatedly until done:true, then ?owners=1
//
//  ENV  BD_API_KEY, NETLIFY_SITE_ID, NETLIFY_BLOBS_TOKEN, HUB_ADMIN_KEY
// ============================================================
const FN_VERSION = "pi-v6";

const https = require("https");
const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");

const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";
const INDEX_KEY = "index:providers";

// Deliberately conservative. BD starts refusing around 100 requests a
// minute, and this is not the only thing talking to that API.
const DEFAULT_SLICE = 40;
const BATCH = 4;
const PAUSE_MS = 320;
const MAX_ID = 4000;
const STOP_AFTER_GAPS = 120;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

function keyOk(given) {
  const want = process.env.HUB_ADMIN_KEY || "";
  if (!want) return true;
  const a = Buffer.from(String(given == null ? "" : given));
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function store() {
  return getStore({
    name: "provider-index",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN,
  });
}

var THROTTLED = false;
var DIAG = [];
function note(t) { if (DIAG.length < 20) DIAG.push(t); }

function bdGet(path) {
  return new Promise(function (resolve) {
    var u;
    try { u = new URL(BD_BASE + path); } catch (e) { return resolve(null); }
    var req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
      method: "GET", headers: { "X-Api-Key": process.env.BD_API_KEY, Accept: "application/json" },
    }, function (res) {
      if ([301, 302, 307, 308].includes(res.statusCode)) { res.resume(); note(path + " -> redirect"); return resolve(null); }
      var raw = "";
      res.on("data", function (c) { raw += c; });
      res.on("end", function () {
        if (res.statusCode === 429 || raw.indexOf("Too many API requests") !== -1) {
          THROTTLED = true;
          return resolve(null);
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          // "not found" is a hole in the id sequence: normal, and silent.
          if (raw.indexOf("not found") === -1) note(path + " -> HTTP " + res.statusCode + " " + raw.slice(0, 100).replace(/\s+/g, " "));
          return resolve(null);
        }
        try { resolve(JSON.parse(raw)); } catch (e) { note(path + " -> unparseable"); resolve(null); }
      });
    });
    req.on("error", function (e) { note(path + " -> " + (e && e.message)); resolve(null); });
    req.setTimeout(8000, function () { req.destroy(); note(path + " -> timeout"); resolve(null); });
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
  if (!d) return null;
  if (d.status && d.status !== "success") { note("user " + id + " -> " + d.status); return null; }
  var m = first(d);
  if (!m || !m.user_id) { note("user " + id + " -> no user_id"); return null; }
  return m;
}

function planOf(m) {
  var s = m && m.subscription_schema, name = "";
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
    id: l.group_id, ownerId: l.user_id,
    title: l.group_name || "", location: l.post_location || "",
    lat: l.lat ? Number(l.lat) : null, lon: l.lon ? Number(l.lon) : null,
    state: l.state_sn || "",
    rent: num(l.post_promo),
    beds: l.property_beds || "", baths: l.property_baths || "",
    sqft: l.property_sqr_foot || "", type: l.property_type || "",
    subtype: l.sub_property_type || "", duration: l.property_duration || "",
    furnished: l.status || "", live: String(l.group_status || "") === "1",
    slug: l.group_filename || "",
  };
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function load(s) {
  try {
    var c = await s.get(INDEX_KEY, { type: "json" });
    if (c) return c;
  } catch (e) {}
  return { builtAt: null, cursor: 1, gaps: 0, done: false, listings: [], providers: [], ownersAt: null };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };
  var q = event.queryStringParameters || {};
  var out = function (b, st) { return { statusCode: st || 200, headers: corsHeaders, body: JSON.stringify(b) }; };

  if (q.version === "1") {
    return out({ ok: true, _v: FN_VERSION,
      bdKeyConfigured: !!process.env.BD_API_KEY,
      blobsConfigured: !!process.env.NETLIFY_SITE_ID && !!process.env.NETLIFY_BLOBS_TOKEN,
      defaultSlice: DEFAULT_SLICE });
  }

  if (!keyOk(q.key)) return out({ error: "Unauthorized" }, 401);

  var s = store();
  var idx = await load(s);

  if (q.reset === "1") {
    idx = { builtAt: null, cursor: 1, gaps: 0, done: false, listings: [], providers: [], ownersAt: null };
    await s.setJSON(INDEX_KEY, idx);
    return out({ ok: true, _v: FN_VERSION, reset: true });
  }

  if (!q.scan && !q.owners) {
    return out({ ok: true, _v: FN_VERSION, cached: true,
      builtAt: idx.builtAt, cursor: idx.cursor, done: idx.done,
      listingCount: idx.listings.length,
      liveCount: idx.listings.filter(function (l) { return l.live; }).length,
      providerCount: idx.providers.length,
      listings: idx.listings, providers: idx.providers });
  }

  if (!process.env.BD_API_KEY) return out({ error: "BD_API_KEY is not set" }, 500);

  if (q.owners === "1") {
    var wantIds = {};
    idx.listings.forEach(function (l) {
      if (!l.ownerId || l.ownerId === "0") return;
      if (q.all !== "1" && !l.live) return;
      wantIds[l.ownerId] = 1;
    });
    var ids = Object.keys(wantIds);
    var have = {};
    idx.providers.forEach(function (p) { have[p.id] = 1; });
    var todo = ids.filter(function (i) { return !have[i]; });

    var added = [];
    for (var j = 0; j < todo.length && !THROTTLED; j += BATCH) {
      var got = await Promise.all(todo.slice(j, j + BATCH).map(getMember));
      got.forEach(function (m) {
        if (!m) return;
        var mine = idx.listings.filter(function (l) { return String(l.ownerId) === String(m.user_id); });
        var geo = mine.filter(function (l) { return l.lat && l.lon; });
        added.push({
          id: m.user_id,
          name: (m.full_name || ((m.first_name || "") + " " + (m.last_name || "")).trim() || m.company || "").trim(),
          company: m.company || "", email: m.email || "", phone: m.phone_number || "",
          plan: planOf(m), verified: String(m.verified) === "1",
          location: m.user_location || [m.city, m.state_code].filter(Boolean).join(", "),
          lat: geo.length ? geo.reduce(function (a, l) { return a + l.lat; }, 0) / geo.length : (m.lat ? Number(m.lat) : null),
          lon: geo.length ? geo.reduce(function (a, l) { return a + l.lon; }, 0) / geo.length : (m.lon ? Number(m.lon) : null),
          listingCount: mine.length,
          liveCount: mine.filter(function (l) { return l.live; }).length,
          listingIds: mine.map(function (l) { return l.id; }),
        });
      });
      if (j + BATCH < todo.length && !THROTTLED) await sleep(PAUSE_MS);
    }

    idx.providers = idx.providers.concat(added);
    idx.ownersAt = new Date().toISOString();
    idx.builtAt = idx.builtAt || idx.ownersAt;
    await s.setJSON(INDEX_KEY, idx);

    return out({ ok: true, _v: FN_VERSION, owners: true,
      wanted: ids.length, alreadyHad: ids.length - todo.length,
      added: added.length, providerCount: idx.providers.length,
      throttled: THROTTLED,
      note: THROTTLED ? "BD rate limit hit. Wait a minute and call ?owners=1 again to pick up the rest." : null,
      diagnostics: DIAG });
  }

  if (q.restart === "1") { idx.cursor = 1; idx.gaps = 0; idx.done = false; }

  var slice = Math.min(Math.max(parseInt(q.slice, 10) || DEFAULT_SLICE, 5), 120);
  var seen = {};
  idx.listings.forEach(function (l) { seen[l.id] = 1; });

  var id = idx.cursor, tried = 0, found = 0;
  while (tried < slice && id <= MAX_ID && !THROTTLED) {
    var batch = [];
    for (var b = 0; b < BATCH && tried < slice && id <= MAX_ID; b++) { batch.push(id); id++; tried++; }
    var res = await Promise.all(batch.map(getListing));
    res.forEach(function (l) {
      if (l) {
        idx.gaps = 0;
        if (!seen[l.group_id]) { idx.listings.push(shapeListing(l)); seen[l.group_id] = 1; found++; }
      } else if (!THROTTLED) {
        idx.gaps++;
      }
    });
    if (idx.gaps >= STOP_AFTER_GAPS) { idx.done = true; break; }
    if (tried < slice && !THROTTLED) await sleep(PAUSE_MS);
  }

  // A throttled run must not advance past ids it never actually saw.
  idx.cursor = THROTTLED ? Math.max(idx.cursor, id - BATCH) : id;
  if (idx.cursor > MAX_ID) idx.done = true;
  idx.builtAt = new Date().toISOString();
  await s.setJSON(INDEX_KEY, idx);

  return out({ ok: true, _v: FN_VERSION, scanned: true,
    triedThisRun: tried, foundThisRun: found,
    cursor: idx.cursor, done: idx.done, throttled: THROTTLED,
    listingCount: idx.listings.length,
    liveCount: idx.listings.filter(function (l) { return l.live; }).length,
    consecutiveGaps: idx.gaps,
    note: THROTTLED
      ? "BD rate limit hit. Wait a minute, then call ?scan=1 again - it resumes where it stopped."
      : (idx.done ? "Scan complete. Now call ?owners=1." : "Call ?scan=1 again to continue."),
    diagnostics: DIAG });
};

module.exports._internal = { shapeListing, planOf, num, FN_VERSION };
