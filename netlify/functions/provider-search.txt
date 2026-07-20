// ============================================================
//  provider-search.js   ·   VERSION: ps1  (2026-07-20)
//  The mirror of renter-search: finds HOUSING PROVIDERS
//  (landlords / property managers / realtors) who opted into
//  being found by the viewer's member type.
//
//  GET ?viewer=renters&location=&verifiedOnly=0&limit=60
//    viewer: renters | landlords | propertyManagers | realtors
//            (the member type of whoever is searching)
//    Reads findable:{viewer}:{providerType} for each provider type,
//    written by visibility.js vis6.
//
//  A renter searching sees providers who ticked "Renters".
//  A landlord searching sees PMs, realtors and other landlords who
//  ticked "Landlords". Consent is enforced server-side: a provider
//  who did not opt in is never in the set, so never in the results.
//
//  No PII. Contact is on-platform via /account/messages/compose?to=ID
//  Requires env: BD_API_KEY. Uses @netlify/blobs (store visibility-index).
// ============================================================

const https = require("https");
const { URL } = require("url");
const { getStore } = require("@netlify/blobs");

const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";
const VERSION = "ps1";
const INDEX_STORE = "visibility-index";

const VIEWERS = ["renters", "landlords", "propertyManagers", "realtors"];
const PROVIDER_TYPES = ["landlords", "propertyManagers", "realtors"];
const TYPE_LABEL = {
  landlords: "Landlord",
  propertyManagers: "Property manager",
  realtors: "Realtor",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

function bd(path) {
  return new Promise((resolve) => {
    const headers = { "X-Api-Key": process.env.BD_API_KEY, Accept: "application/json" };
    let u;
    try { u = new URL(BD_BASE + path); } catch (e) { return resolve({ ok: false, data: null }); }
    const req = https.request(
      { hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: "GET", headers },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let data = null;
          try { data = raw ? JSON.parse(raw) : null; } catch (e) {}
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, data });
        });
      }
    );
    req.on("error", () => resolve({ ok: false, data: null }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, data: null }); });
    req.end();
  });
}

function idxStore() {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
  if (siteID && token) return getStore({ name: INDEX_STORE, consistency: "strong", siteID, token });
  return getStore({ name: INDEX_STORE, consistency: "strong" });
}

async function readSet(key) {
  try {
    const v = await idxStore().get(key, { type: "json" });
    return Array.isArray(v) ? v.map(String) : [];
  } catch (e) { return []; }
}

// Strip tags + decode the entities BD stores, so cards never show raw markup.
function plain(v, n) {
  if (!v) return "";
  let t = String(v).replace(/<[^>]*>/g, " ");
  t = t.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
       .replace(/&#39;/g, "'").replace(/&rsquo;/g, "'").replace(/&lsquo;/g, "'")
       .replace(/&ldquo;/g, '"').replace(/&rdquo;/g, '"').replace(/&mdash;/g, "-")
       .replace(/&ndash;/g, "-").replace(/&hellip;/g, "...").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  t = t.replace(/\s+/g, " ").trim();
  if (!n || t.length <= n) return t;
  return t.slice(0, n - 1).trim() + "\u2026";
}

function absUrl(p) {
  if (!p) return "";
  const s = String(p);
  if (s.indexOf("http") === 0) return s;
  return "https://www.renters.com" + (s.charAt(0) === "/" ? "" : "/") + s;
}

function memberFrom(data) {
  let m = data && data.message ? data.message : data;
  if (Array.isArray(m)) m = m[0] || null;
  return m;
}

async function shapeProvider(memberId, providerType) {
  const r = await bd("/user/get/" + encodeURIComponent(memberId));
  const m = memberFrom(r.data);
  if (!m) return null;

  const name =
    (m.company_name && String(m.company_name).trim()) ||
    (m.full_name && String(m.full_name).trim()) ||
    [m.first_name, m.last_name].filter(Boolean).join(" ").trim() ||
    "A member";
  const location = [m.city, m.state_code].filter(Boolean).join(", ");
  const photo = m.image_main_file || m.filename || "";

  return {
    memberId: String(memberId),
    name,
    providerType,
    typeLabel: TYPE_LABEL[providerType] || "",
    location,
    verified: String(m.verified || "0") === "1",
    profilePhotoUrl: absUrl(photo),
    hasProfilePhoto: !!(photo && String(photo).trim()),
    storySnippet: plain(m.my_story, 170),
    _hay: [m.city, m.state_code, m.zip_code, m.zip, m.user_location, m.geo_state]
      .filter(Boolean).map((x) => String(x).toLowerCase()).join(" | "),
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: corsHeaders, body: "Method Not Allowed" };

  const q = event.queryStringParameters || {};
  const viewer = VIEWERS.indexOf(q.viewer) !== -1 ? q.viewer : "renters";
  const loc = (q.location || "").trim().toLowerCase();
  const verifiedOnly = q.verifiedOnly === "1" || q.verifiedOnly === "true";
  const limit = Math.min(parseInt(q.limit, 10) || 60, 100);
  const wanted = (q.types ? q.types.split(",") : PROVIDER_TYPES)
    .map((t) => t.trim()).filter((t) => PROVIDER_TYPES.indexOf(t) !== -1);

  // debug: show the sets this viewer would read
  if (q.debug === "1") {
    const out = {};
    for (const t of PROVIDER_TYPES) {
      const key = "findable:" + viewer + ":" + t;
      out[key] = await readSet(key);
    }
    return { statusCode: 200, headers: corsHeaders,
      body: JSON.stringify({ version: VERSION, debug: true, viewer, sets: out }) };
  }

  // 1) gather opted-in provider IDs per type (consent enforced here)
  const pairs = [];
  for (const t of (wanted.length ? wanted : PROVIDER_TYPES)) {
    const ids = await readSet("findable:" + viewer + ":" + t);
    for (const id of ids) pairs.push([id, t]);
  }
  if (!pairs.length) {
    return { statusCode: 200, headers: corsHeaders,
      body: JSON.stringify({ version: VERSION, viewer, location: q.location || "", total: 0, results: [] }) };
  }

  // 2) shape (cap BD reads)
  const cards = [];
  for (const [id, t] of pairs.slice(0, 100)) {
    const c = await shapeProvider(id, t);
    if (c) cards.push(c);
  }

  // 3) filter
  let out = cards;
  if (loc) out = out.filter((c) => c._hay.indexOf(loc) !== -1);
  if (verifiedOnly) out = out.filter((c) => c.verified);

  // 4) verified first, then photo, then name
  out.sort((a, b) => {
    if (a.verified !== b.verified) return a.verified ? -1 : 1;
    if (a.hasProfilePhoto !== b.hasProfilePhoto) return a.hasProfilePhoto ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const total = out.length;
  const results = out.slice(0, limit).map((c) => { const o = Object.assign({}, c); delete o._hay; return o; });

  return { statusCode: 200, headers: corsHeaders,
    body: JSON.stringify({ version: VERSION, viewer, location: q.location || "", verifiedOnly, total, results }) };
};
