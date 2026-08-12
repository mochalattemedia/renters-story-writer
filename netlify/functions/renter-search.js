// ============================================================
//  renter-search.js   ·   VERSION: rs3  (2026-08-11)
//  rs3: MEMBER-FACING SEARCH IS CLOSED. No member finds another member on
//       Renters.com any more, in any direction. Every introduction goes
//       through us, which is the product rather than a restriction on it.
//
//       WHY THIS FILE AND NOT JUST THE LINKS. The pages that displayed
//       these results were unlinked from the nav, but this function is a
//       PUBLIC URL with no auth - anyone who knew it still got verified
//       renter cards back, name, location, budget, timeline and all.
//       Unlinking a page is not the same as closing a capability, and the
//       renters in the index never agreed to the second thing.
//
//       THE INDEX IS LEFT INTACT AND STILL BEING WRITTEN by visibility.js.
//       Nothing is deleted, it simply is not served. Flip MEMBER_SEARCH to
//       true and the old behaviour returns with a current index behind it -
//       a stale index would have to be rebuilt.
//
//       ADMIN READ ADDED. Kenny needs one view the members do not get:
//       every renter who said yes to a realtor introduction, and how many
//       they agreed to hear from. That is an operator queue, not a
//       directory, and it is the list the realtor side of the business
//       actually runs on.
//       GET ?admin=KEY&audience=buying   (KEY must equal env RDC_ADMIN_KEY)
//       FAILS CLOSED: if RDC_ADMIN_KEY is unset, the admin path is dead.
//       An admin door that opens when a variable is missing is worse than
//       no door at all.
//
//  renter-search.js   ·   VERSION: rs2  (2026-07-09)
//  rs2: Blob read fixed. readFindableSet now builds the store via idxStore()
//       with explicit siteID + token, matching visibility.js. The old plain
//       getStore() read failed silently and returned [], so search showed
//       nothing even when the index was populated.
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
const VERSION = "rs3";

// Member-facing search. False = every non-admin call returns an empty set.
const MEMBER_SEARCH = false;

// Operator key. Unset means the admin path does not exist at all.
const ADMIN_KEY = process.env.RDC_ADMIN_KEY || "";
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

// Build the index store with explicit siteID + token (getStore does not throw
// on creation, so a try/catch fallback never fires). Matches visibility.js.
function idxStore() {
  var siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  var token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
  if (siteID && token) {
    return getStore({ name: INDEX_STORE, consistency: "strong", siteID: siteID, token: token });
  }
  return getStore({ name: INDEX_STORE, consistency: "strong" });
}

// vis7 stores the realtor introduction cap at intro-cap:{memberId} in the
// same store as the findable sets. A cap of null on a member sitting in the
// buying set means the consent landed but the number did not, which is worth
// seeing in the queue rather than silently reading as unlimited.
async function readIntroCap(memberId) {
  try {
    const v = await idxStore().get("intro-cap:" + String(memberId), { type: "json" });
    return v && typeof v.cap === "number" ? v.cap : null;
  } catch (e) {
    return null;
  }
}

async function readFindableSet(audience) {
  try {
    const store = idxStore();
    const v = await store.get("findable:" + audience, { type: "json" });
    return Array.isArray(v) ? v.map(String) : [];
  } catch (e) {
    return [];
  }
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: corsHeaders, body: "Method Not Allowed" };

  const q = event.queryStringParameters || {};

  // ---- ADMIN: the realtor introduction queue ------------------------------
  // Deliberately checked BEFORE the closed-search guard, and deliberately
  // requires a key that has to be set by hand.
  if (q.admin) {
    if (!ADMIN_KEY || q.admin !== ADMIN_KEY) {
      return { statusCode: 404, headers: corsHeaders,
        body: JSON.stringify({ version: VERSION, error: "not found" }) };
    }
    const aud = AUDIENCE_KEYS.indexOf(q.audience) !== -1 ? q.audience : "buying";
    const ids = await readFindableSet(aud);
    const rows = [];
    for (const id of ids.slice(0, 200)) {
      const c = await shapeCard(id);
      if (!c) continue;
      delete c._haystack;
      c.introCap = await readIntroCap(id);
      rows.push(c);
    }
    rows.sort((a, b) => (a.verified === b.verified ? 0 : a.verified ? -1 : 1));
    return {
      statusCode: 200,
      headers: Object.assign({}, corsHeaders, { "Cache-Control": "no-store" }),
      body: JSON.stringify({ version: VERSION, admin: true, audience: aud,
        total: rows.length, results: rows }, null, 2),
    };
  }

  // ---- MEMBER-FACING: closed ---------------------------------------------
  // Returns 200 with an empty set rather than an error. Any page still
  // calling this renders "nobody found" and stands down quietly, instead of
  // showing a member a broken component they cannot do anything about.
  if (!MEMBER_SEARCH) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ version: VERSION, closed: true, total: 0, results: [] }),
    };
  }

  const audience = AUDIENCE_KEYS.indexOf(q.audience) !== -1 ? q.audience : "landlords";
  const loc = (q.location || "").trim().toLowerCase();
  const verifiedOnly = q.verifiedOnly === "1" || q.verifiedOnly === "true";
  const limit = Math.min(parseInt(q.limit, 10) || 60, 100);

  // 1) who opted into being found by this member type
  const ids = await readFindableSet(audience);
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
