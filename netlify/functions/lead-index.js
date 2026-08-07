// ============================================================
//  lead-index.js   ·   VERSION: li-v1   (2026-08-06)
//
//  Fetches the most recent leads from BD and caches them in Blobs so the
//  hub has something it can actually query.
//
//  WHY THIS EXISTS
//  BD's list endpoint is unusable for this. Confirmed live:
//    /leads/get?limit=5000   returns 100 rows, not 5000
//    /leads/get?limit=100&offset=100   returns the SAME first row
//    the 100 it returns are ids 2 to 103 - the OLDEST hundred
//  So the list can never reach recent leads, no matter how it is called.
//  Single-record lookup by path segment DOES work (/leads/get/2948), which
//  is the same asymmetry the Bible already records for /user/get.
//  This walks DOWN from the newest id, one fetch per lead.
//
//  PACING IS DELIBERATE. The Bible records BD returning byte-identical
//  400s under throttle and a 21-hour outage caused by hammering the API.
//  Requests go in small batches with a pause between them, and a run that
//  fails partway keeps whatever it already had rather than discarding it.
//
//  FINDING THE TOP. There is no "newest id" endpoint, so the function
//  probes upward from the last known high-water mark. Nothing above it
//  means nothing new; a hit means keep climbing.
//
//  ENDPOINTS
//   GET ?version=1            -> config probe
//   GET                       -> cached index (fast, no BD calls)
//   GET ?refresh=1&n=100      -> re-fetch the newest n leads, then return
//   GET ?refresh=1&from=2948  -> start from a specific id
//
//  ENV
//   BD_API_KEY           REQUIRED
//   NETLIFY_SITE_ID      REQUIRED
//   NETLIFY_BLOBS_TOKEN  REQUIRED
//   BD_API_BASE          default https://www.renters.com/api/v2
// ============================================================
const FN_VERSION = "li-v1";

const https = require("https");
const { getStore } = require("@netlify/blobs");

const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";
const INDEX_KEY = "index:recent";
const MARK_KEY = "index:highwater";

const DEFAULT_N = 100;
const BATCH = 6;          // concurrent requests
const PAUSE_MS = 220;     // between batches
const PROBE_AHEAD = 25;   // how far above the mark to look for new leads

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

function store() {
  return getStore({
    name: "lead-index",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN,
  });
}

function bdGet(path) {
  return new Promise(function (resolve) {
    var u;
    try { u = new URL(BD_BASE + path); } catch (e) { return resolve({ ok: false, data: null }); }
    var req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
      method: "GET", headers: { "X-Api-Key": process.env.BD_API_KEY, Accept: "application/json" },
    }, function (res) {
      if ([301, 302, 307, 308].includes(res.statusCode)) { res.resume(); return resolve({ ok: false, data: null, status: res.statusCode }); }
      var raw = "";
      res.on("data", function (c) { raw += c; });
      res.on("end", function () {
        var d = null;
        try { d = JSON.parse(raw); } catch (e) {}
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, data: d, status: res.statusCode });
      });
    });
    req.on("error", function () { resolve({ ok: false, data: null, status: 0 }); });
    req.setTimeout(9000, function () { req.destroy(); resolve({ ok: false, data: null, status: 0 }); });
    req.end();
  });
}

async function getLead(id) {
  var r = await bdGet("/leads/get/" + encodeURIComponent(id));
  if (!r.ok || !r.data) return null;
  var m = r.data.message;
  var lead = Array.isArray(m) ? m[0] : m;
  return lead && lead.lead_id ? lead : null;
}

// BD squashes the income band into one run of digits: 30004000 is 3000-4000.
function incomeBand(v) {
  var s = String(v == null ? "" : v).replace(/[^0-9]/g, "");
  if (!s) return "";
  if (s.length === 8) return "$" + Number(s.slice(0, 4)).toLocaleString() + " to $" + Number(s.slice(4)).toLocaleString();
  if (s.length === 7) return "$" + Number(s.slice(0, 3)).toLocaleString() + " to $" + Number(s.slice(3)).toLocaleString();
  return "$" + Number(s).toLocaleString();
}
// Same decode table as lead-consent, so the hub and the renter's own page
// describe a value identically. An unmapped slug falls through as itself
// rather than vanishing, so a new BD option is visible rather than silent.
const DECODE = {
  less_than_1k: "Under $1,000",
  "1k2k": "$1,000 to $2,000",
  "2k3k": "$2,000 to $3,000",
  "3k4k": "$3,000 to $4,000",
  "4k6k": "$4,000 to $6,000",
  over_6k: "Over $6,000",
  immediately_: "Immediately",
  next_month: "Next month",
  "36_months": "3 to 6 months",
  "612_months": "6 to 12 months",
  more_than_a_year: "More than a year",
  not_sure_yet: "Not sure yet",
  longterm_: "Long-term",
  midterm_: "Mid-term",
  shortterm_: "Short-term",
  no_pets: "No pets",
  dog: "Dog",
  cat: "Cat",
  service_animal: "Service animal",
  yes: "Yes",
  no: "No",
  not_sure: "Not sure",
  w2_employment: "W-2 employment",
  selfemployed_1099: "Self-employed",
  benefits: "Benefits",
  fixed_income: "Fixed income",
};
function readable(v) {
  if (v == null) return "";
  var s = String(v).trim();
  if (!s) return "";
  return s.split(",").map(function (p) {
    var t = p.trim();
    if (DECODE[t]) return DECODE[t];
    return t.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  }).filter(Boolean).join(", ");
}

// Trimmed to what the hub renders. The full record stays in BD; carrying
// every column would bloat the blob for no benefit.
// income and incomeSource ARE indexed - the operator needs both to judge
// whether an introduction makes sense. What goes to a PROVIDER is decided
// by lead-consent, not here, and income source is not shareable there.
function shape(l) {
  return {
    id: l.lead_id,
    token: l.token || "",
    name: l.lead_name || "",
    email: l.lead_email || "",
    phone: l.phone || l.lead_phone || "",
    submitted: l.date_added || null,
    status: l.status || "",
    price: l.lead_price || "0.00",
    location: l.lead_location || "",
    lat: l.lat ? Number(l.lat) : null,
    lon: l.lng ? Number(l.lng) : null,
    state: l.adm_lvl_1_sn || "",
    origin: l.url_from || "",
    budget: readable(l.what_is_your_budget),
    timing: readable(l.when_are_you_looki),
    term: readable(l.select_all_that_des),
    propertyType: readable(l.property_type),
    household: l.number_of_people_y || "",
    pets: readable(l.do_you_have_pets),
    petDetails: l.if_yes_type_size_br || "",
    cosigner: readable(l.woulda_cosigner_or),
    description: (l.please_describe_the || "").trim(),
    obstacles: (l.anything_else_we_sh || "").trim(),
    preferredDay: l.lead_preferred_day || "",
    preferredTime: l.lead_preferred_time || "",
    income: incomeBand(l.approximate_gross_m),
    incomeSource: readable(l.what_type_of_income),
    searchingOn: readable(l.how_are_you_searchi),
    rentingFor: readable(l.how_long_have_you_b),
    insurance: readable(l.Insureance_options),
  };
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function fetchDown(startId, count) {
  var out = [], misses = 0, id = startId;
  while (out.length < count && id > 0) {
    var ids = [];
    for (var i = 0; i < BATCH && id > 0; i++) { ids.push(id); id--; }
    var got = await Promise.all(ids.map(getLead));
    got.forEach(function (l) {
      if (l) { out.push(shape(l)); misses = 0; }
      else { misses++; }
    });
    // A long unbroken run of misses means we are below the real data or BD
    // has started refusing. Either way, stop rather than grind through
    // hundreds of empty ids.
    if (misses >= 40) break;
    if (out.length < count && id > 0) await sleep(PAUSE_MS);
  }
  return out;
}

// No "newest id" endpoint exists, so climb from the mark until nothing is
// there. PROBE_AHEAD is the gap we tolerate: ids are sequential but a
// deleted lead would leave a hole.
async function findTop(mark) {
  var top = mark, id = mark + 1, gap = 0;
  while (gap < PROBE_AHEAD) {
    var l = await getLead(id);
    if (l) { top = id; gap = 0; } else { gap++; }
    id++;
    if (id - top > 400) break;   // hard stop, never run away
  }
  return top;
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };
  var q = event.queryStringParameters || {};

  if (q.version === "1") {
    return {
      statusCode: 200, headers: corsHeaders,
      body: JSON.stringify({
        ok: true, _v: FN_VERSION,
        bdKeyConfigured: !!process.env.BD_API_KEY,
        blobsConfigured: !!process.env.NETLIFY_SITE_ID && !!process.env.NETLIFY_BLOBS_TOKEN,
        defaultCount: DEFAULT_N,
      }),
    };
  }

  var s = store();

  if (!q.refresh) {
    try {
      var cached = await s.get(INDEX_KEY, { type: "json" });
      if (cached) {
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, _v: FN_VERSION, cached: true, builtAt: cached.builtAt, count: cached.leads.length, leads: cached.leads }) };
      }
    } catch (e) { /* nothing cached yet */ }
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, _v: FN_VERSION, cached: false, count: 0, leads: [], note: "No index yet. Call with ?refresh=1 to build one." }) };
  }

  if (!process.env.BD_API_KEY) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "BD_API_KEY is not set" }) };
  }

  var n = Math.min(Math.max(parseInt(q.n, 10) || DEFAULT_N, 1), 300);

  var mark = 0;
  try { var mk = await s.get(MARK_KEY, { type: "json" }); mark = (mk && mk.top) || 0; } catch (e) { mark = 0; }

  var startId;
  if (q.from) {
    startId = parseInt(String(q.from).replace(/[^0-9]/g, ""), 10) || 0;
  } else if (mark) {
    startId = await findTop(mark);
  } else {
    // First run with no mark: probe up from a low id to find the ceiling.
    startId = await findTop(1);
  }
  if (!startId) {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ error: "Could not find any leads. Pass ?from=NNNN with a known lead id.", _v: FN_VERSION }) };
  }

  var leads = await fetchDown(startId, n);

  if (!leads.length) {
    // Keep whatever was already cached rather than replacing it with nothing.
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ error: "BD returned no leads. Existing index left untouched.", startId: startId, _v: FN_VERSION }) };
  }

  var payload = { builtAt: new Date().toISOString(), topId: startId, leads: leads };
  try {
    await s.setJSON(INDEX_KEY, payload);
    await s.setJSON(MARK_KEY, { top: startId, at: payload.builtAt });
  } catch (e) {
    console.error("[lead-index] blob write failed:", e && e.message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Fetched leads but could not cache them", detail: e && e.message, count: leads.length }) };
  }

  console.log("[lead-index] indexed " + leads.length + " leads from id " + startId);

  return {
    statusCode: 200, headers: corsHeaders,
    body: JSON.stringify({ ok: true, _v: FN_VERSION, cached: false, refreshed: true, builtAt: payload.builtAt, topId: startId, count: leads.length, leads: leads }),
  };
};

module.exports._internal = { shape, incomeBand, readable, FN_VERSION };
