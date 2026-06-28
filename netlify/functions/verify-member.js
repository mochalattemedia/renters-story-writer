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

// Estimate profile completeness. Two profile shapes:
//  - Renter: includes an about/story field
//  - Landlord / Property Manager / Realtor: identical setup, no about-me
function completeness(m, accountType) {
  const isRenter = String(accountType || "").toLowerCase().includes("renter");
  const checks = [
    m.first_name, m.last_name, m.email, m.phone_number,
    m.city, (m.filename || m.image_main_file),
  ];
  if (isRenter) checks.push(m.about_me || m.about_me_1 || m.my_story);
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

  // Account type lives in member_level (subscription/level name): Renter / Landlord / etc.
  let accountType = "Unknown";
  for (const v of [m.subscription_name, m.member_level_name, m.member_type]) {
    if (v && String(v).trim() && String(v).trim() !== "0") { accountType = String(v).trim(); break; }
  }

  // What a renter is seeking (useful queue context). Tidy the raw value:
  // "long_term_rental_" -> "Long Term Rental"
  let seeking = "";
  if (m.seeking && String(m.seeking).trim()) {
    seeking = String(m.seeking).replace(/_+$/,"").replace(/_/g," ").trim()
      .replace(/\b\w/g, function(c){ return c.toUpperCase(); });
  }

  return {
    memberId: String(memberId),
    found: true,
    name,
    email: m.email || "",
    phone: m.phone_number || "",
    location,
    accountType,
    seeking,
    verified: String(m.verified || "0") === "1",
    verifyPhotoUrl: verifyPhoto ? (verifyPhoto.startsWith("http") ? verifyPhoto : "https://www.renters.com" + verifyPhoto) : "",
    profilePhoto: profilePhoto || "",
    hasProfilePhoto: !!(profilePhoto && String(profilePhoto).trim()),
    profileCompletePct: completeness(m, accountType),
    optStatus: optStatus(m),
    signupDate: m.signup_date || "",
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };
  const q = event.queryStringParameters || {};
  if (q.key !== KEY) return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: "bad key" }) };

  // DEBUG: dump renter-context candidate fields to see what's populated
  if (q.debug === "1" && q.memberId) {
    const r = await bd(`/user/get/${encodeURIComponent(q.memberId)}`);
    const m = memberFrom(r.data) || {};
    const fields = [
      "monthly_budget", "number_of_peop", "type_of_income", "co_signer",
      "do_you_have_pets", "credit_range", "credit_balance", "my_obstacles",
      "my_story", "ideal_rental", "property_type_preference", "seeking",
      "i_want_to_relocate", "describe_your_rent", "h_rentals_youve_had",
      "any_evictions", "clean_background", "do_you_know_your_cr",
      "do_you_have_a_clean", "do_you_have_any_evi", "signup_date", "modtime",
    ];
    const dump = {};
    fields.forEach((f) => { dump[f] = m[f] !== undefined ? m[f] : "(field absent)"; });
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ memberId: q.memberId, dump }, null, 2) };
  }

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
