// ============================================================
//  renter-search.js   ·   VERSION: rs1  (2026-07-05)
//  Landlord-facing renter search. Reads the "findable" Blob index
//  written by visibility.js, shapes each renter from live BD data
//  (same read pattern as verify-member.js), filters by location,
//  sorts verified-first, and returns public-safe profile cards.
//
//  GET ?audience=landlords&location=97201&verifiedOnly=0&limit=60
//    audience: landlords | propertyManagers | realtors | buying | renters
//              (which findable set to read — the searcher's member type)
//    location: optional zip or city/area text; matched against the
//              renter's city / state / searched areas. Blank = all.
//    verifiedOnly: "1" to only return verified renters.
//
//  No PII returned. Contact happens through a Renters.com message.
//  Requires env: BD_API_KEY. Uses @netlify/blobs (store "visibility-index").
// ============================================================

const https = require("https");
const { URL } = require("url");
const { getStore } = require("@netlify/blobs");

const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";
const VERSION = "rs1";
const INDEX_STORE = "visibility-index";

const AUDIENCE_KEYS = ["landlords", "propertyManagers", "realtors", "buying", "renters"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

function bd(path) {
  return new Promise((resolve) => {
    const urlStr = `${BD_BASE}${path}`;
    const headers = { "X-Api-Key": process.env.BD_API_KEY, "Accept": "application/json" };
    let u;
    try { u = new URL(urlStr); } catch (e) { return resolve({ ok: false, status: 0, data: null }); }
    const options = { hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: "GET", headers };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch (e) {}
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data });
      });
    });
    req.on("error", () => resolve({ ok: false, status: 0, data: null }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, status: 0, data: null }); });
    req.end();
  });
}

function memberFrom(data) {
  let m = data && data.message ? data.message : data;
  if (Array.isArray(m)) m = m[0] || null;
  return m;
}

// --- shaping helpers cloned from verify-member.js so cards show real data ---
function tidy(v) {
  if (!v || String(v).trim() === "" || String(v).trim() === "0") return "";
  return String(v).replace(/_+$/, "").replace(/_/g, " ").trim()
    .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}
function tidyBudget(v) {
  if (!v) return "";
  const digits = String(v).replace(/[^0-9]/g, "");
  if (digits.length === 8) {
    const lo = parseInt(digits.slice(0, 4), 10);
    const hi = parseInt(digits.slice(4), 10);
    return "$" + lo.toLocaleString() + "–$" + hi.toLocaleString();
  }
  if (digits.length === 7) return "$" + parseInt(digits, 10).toLocaleString();
  return tidy(v);
}
function absUrl(p) {
  if (!p) return "";
  const s = String(p);
  if (s.startsWith("http")) return s;
  return "https://www.renters.com" + (s.charAt(0) === "/" ? "" : "/") + s;
}

// A short public-safe story snippet (no contact info).
function snippet(v, n) {
  if (!v) return "";
  const t = String(v).replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return t.slice(0, n - 1).trim() + "…";
}

// The searchable location haystack for a renter (city, state, searched areas).
function locationHaystack(m) {
  const parts = [
    m.city, m.state_code, m.geo_state, m.user_location,
    m.search_description, m.zip_code, m.zip, m.postal_code,
  ];
  return parts.filter(Boolean).map((x) => String(x).toLowerCase()).join(" | ");
}

async function shapeCard(memberId) {
  const r = await bd(`/user/get/${encodeURIComponent(memberId)}`);
  const m = memberFrom(r.data);
  if (!m) return null;

  const name = (m.full_name && m.full_name.trim())
    || [m.first_name, m.last_name].filter(Boolean).join(" ").trim()
    || "A renter";
  const location = [m.city, m.state_code].filter(Boolean).join(", ");
  const profilePhoto = m.image_main_file || m.filename || "";

  return {
    memberId: String(memberId),
    name,
    location,
    verified: String(m.verified || "0") === "1",
    profilePhotoUrl: absUrl(profilePhoto),
    hasProfilePhoto: !!(profilePhoto && String(profilePhoto).trim()),
    areas: tidy(m.geo_state || m.user_location || m.search_description) || location,
    budget: tidyBudget(m.monthly_budget),
    timeline: tidy(m.i_want_to_relocate),
    household: m.number_of_peop ? String(m.number_of_peop).trim() : "",
    propertyType: tidy(m.property_type_preference),
    storySnippet: snippet(m.my_story, 180),
    _haystack: locationHaystack(m),
  };
}

function idxStore() {
  try {
    return getStore({ name: INDEX_STORE, consistency: "strong" });
  } catch (e1) {
    const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
    const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
    if (siteID && token) {
      return getStore({ name: INDEX_STORE, consistency: "strong", siteID, token });
    }
    throw e1;
  }
}

async function readFindableSet(audience) {
  const store = idxStore(); // may throw; caller handles
  const v = await store.get("findable:" + audience, { type: "json" });
  return Array.isArray(v) ? v.map(String) : [];
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: corsHeaders, body: "Method Not Allowed" };

  const q = event.queryStringParameters || {};
  const audience = AUDIENCE_KEYS.indexOf(q.audience) !== -1 ? q.audience : "landlords";
  const loc = (q.location || "").trim().toLowerCase();
  const verifiedOnly = q.verifiedOnly === "1" || q.verifiedOnly === "true";
  const limit = Math.min(parseInt(q.limit, 10) || 60, 100);

  // --- debug: /renter-search?debug=1&audience=landlords reveals the Blob state ---
  if (q.debug === "1") {
    let store_ok = false, store_err = "", ids_dbg = [], read_err = "";
    try { const st = idxStore(); store_ok = true;
      try { const v = await st.get("findable:" + audience, { type: "json" }); ids_dbg = Array.isArray(v) ? v.map(String) : []; }
      catch (e) { read_err = (e && e.message) ? e.message : String(e); }
    } catch (e) { store_err = (e && e.message) ? e.message : String(e); }
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({
      version: VERSION, debug: true, audience, store_ok, store_err,
      count_in_set: ids_dbg.length, ids_in_set: ids_dbg, read_err,
      env_seen: { NETLIFY_SITE_ID: !!process.env.NETLIFY_SITE_ID, SITE_ID: !!process.env.SITE_ID, NETLIFY_BLOBS_TOKEN: !!process.env.NETLIFY_BLOBS_TOKEN }
    }) };
  }

  // 1) who opted into being found by this member type
  let ids = [];
  try { ids = await readFindableSet(audience); } catch (e) { ids = []; }
  if (!ids.length) {
    return {
      statusCode: 200, headers: corsHeaders,
      body: JSON.stringify({ version: VERSION, audience, location: q.location || "", total: 0, results: [] }),
    };
  }

  // 2) shape each (cap the number of BD reads for safety)
  const toRead = ids.slice(0, 100);
  const cards = [];
  for (const id of toRead) {
    const c = await shapeCard(id);
    if (c) cards.push(c);
  }

  // 3) filter: location text match (zip or city/area substring), verifiedOnly
  let filtered = cards;
  if (loc) filtered = filtered.filter((c) => c._haystack.indexOf(loc) !== -1);
  if (verifiedOnly) filtered = filtered.filter((c) => c.verified);

  // 4) sort: verified first, then has-photo, then name (lead with the moat)
  filtered.sort((a, b) => {
    if (a.verified !== b.verified) return a.verified ? -1 : 1;
    if (a.hasProfilePhoto !== b.hasProfilePhoto) return a.hasProfilePhoto ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const total = filtered.length;
  const results = filtered.slice(0, limit).map((c) => {
    const out = Object.assign({}, c);
    delete out._haystack;
    return out;
  });

  return {
    statusCode: 200, headers: corsHeaders,
    body: JSON.stringify({ version: VERSION, audience, location: q.location || "", verifiedOnly, total, results }),
  };
};
