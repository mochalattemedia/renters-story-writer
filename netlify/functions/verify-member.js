// ============================================================
//  verify-member.js   ·   Stage 2 — Live BD data for the panel
//  Given a member ID, reads that member's CURRENT data from BD
//  (name, email, phone, location, account type, verified flag,
//  verification photo, profile photo, opted-in/out, profile
//  completeness) and returns a clean object the panel can show.
//  BD stays the source of member truth; this just reads + shapes.
//
//  GET ?memberId=ID&key=renters2026
//  Optional: ?ids=3649,3650,3651  -> batch (comma list)
// ============================================================

const https = require("https");

const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";
const KEY = "renters2026";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

function bd(path, { method = "GET", body = null } = {}) {
  return new Promise((resolve) => {
    const urlStr = `${BD_BASE}${path}`;
    let payload = null;
    const headers = { "X-Api-Key": process.env.BD_API_KEY, "Accept": "application/json" };
    if (body) {
      payload = new URLSearchParams(body).toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    let u;
    try { u = new URL(urlStr); } catch (e) { return resolve({ ok: false, status: 0, data: null }); }
    const options = { hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, headers };
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
    if (payload) req.write(payload);
    req.end();
  });
}

// Pull the member object out of BD's { message: [ {...} ] } shape.
function memberFrom(data) {
  let m = data && data.message ? data.message : data;
  if (Array.isArray(m)) m = m[0] || null;
  return m;
}

// Estimate profile completeness from key fields being filled.
function completeness(m) {
  const checks = [
    m.first_name, m.last_name, m.email, m.phone_number,
    m.city, m.about_me || m.about_me_1, (m.filename || m.image_main_file),
  ];
  const filled = checks.filter((v) => v && String(v).trim() && String(v).trim() !== "0").length;
  return Math.round((filled / checks.length) * 100);
}

// Read opted-in / opted-out from the member's tags array.
function optStatus(m) {
  const tags = Array.isArray(m.tags) ? m.tags : [];
  const names = tags.map((t) => (t.tag_name || t.name || "").toLowerCase());
  if (names.includes("matching-opted-in")) return "opted-in";
  if (names.includes("matching-opted-out")) return "opted-out";
  return "none";
}

async function shapeMember(memberId) {
  const r = await bd(`/user/get/${encodeURIComponent(memberId)}`);
  const m = memberFrom(r.data);
  if (!m) return { memberId: String(memberId), found: false };

  const name = (m.full_name && m.full_name.trim())
    || [m.first_name, m.last_name].filter(Boolean).join(" ").trim()
    || "Unknown";
  const location = [m.city, m.state_code].filter(Boolean).join(", ");
  const verifyPhoto = m.image_verification_1_url || m.image_verification_1 || "";
  const profilePhoto = m.image_main_file || m.filename || "";

  // Account type can live in several BD fields depending on setup. Try them in order.
  const acctCandidates = {
    member_type: m.member_type,
    i_am_a: m.i_am_a,
    seeking: m.seeking,
    listing_type: m.listing_type,
    service: m.service,
    member_level: m.subscription_name || m.member_level_name,
    profession: m.profession_id,
  };
  // Completeness: look for BD's own value, and show which of our checks are empty.
  const completenessDebug = {
    bd_fields_checked: {
      first_name: !!m.first_name, last_name: !!m.last_name, email: !!m.email,
      phone_number: !!m.phone_number, city: !!m.city,
      about: !!(m.about_me || m.about_me_1), photo: !!(m.filename || m.image_main_file),
    },
    possible_bd_value: m.profile_completeness || m.completeness || m.profile_progress || null,
  };
  let accountType = "Unknown";
  for (const v of [m.member_type, m.i_am_a, m.seeking, m.listing_type, m.service, m.subscription_name]) {
    if (v && String(v).trim() && String(v).trim() !== "0") { accountType = String(v).trim(); break; }
  }

  return {
    memberId: String(memberId),
    found: true,
    name,
    email: m.email || "",
    phone: m.phone_number || "",
    location,
    accountType,
    acctCandidates,
    completenessDebug,
    verified: String(m.verified || "0") === "1",
    verifyPhotoUrl: verifyPhoto ? (verifyPhoto.startsWith("http") ? verifyPhoto : "https://www.renters.com" + verifyPhoto) : "",
    profilePhoto: profilePhoto || "",
    hasProfilePhoto: !!(profilePhoto && String(profilePhoto).trim()),
    profileCompletePct: completeness(m),
    optStatus: optStatus(m),
    signupDate: m.signup_date || "",
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };
  const q = event.queryStringParameters || {};
  if (q.key !== KEY) return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: "bad key" }) };

  try {
    // Batch mode
    if (q.ids) {
      const ids = q.ids.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
      const results = [];
      for (const id of ids) {
        results.push(await shapeMember(id));
      }
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ count: results.length, members: results }) };
    }

    // Single
    if (!q.memberId) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "memberId or ids required" }) };
    const shaped = await shapeMember(q.memberId);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(shaped) };
  } catch (e) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: e.message }) };
  }
};
