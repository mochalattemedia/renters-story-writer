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

// Profile completeness matched to BD's own elements.
//  Renter (5): My Profile, My Photo, My Story, My Obstacles, My Areas
//  Landlord/PM/Realtor (2): My Profile, My Photo
function completeness(m, accountType) {
  const isRenter = String(accountType || "").toLowerCase().includes("renter");
  const hasPhoto = !!((m.filename || m.image_main_file) && String(m.filename || m.image_main_file).trim());
  // "My Profile" = core identity/contact filled in
  const hasProfile = !!(m.first_name && m.last_name && m.email &&
    (m.phone_number || m.city || m.address1));

  if (!isRenter) {
    // Landlord-type: only Profile + Photo
    const parts = [hasProfile, hasPhoto];
    return Math.round((parts.filter(Boolean).length / parts.length) * 100);
  }

  // Renter: Profile, Photo, Story, Obstacles, Areas
  const hasStory = !!(m.my_story && String(m.my_story).trim());
  const hasObstacles = !!(m.my_obstacles && String(m.my_obstacles).trim());
  // "My Areas" — renter's searched locations. Try common fields.
  const areasVal = m.geo_state || m.user_location || m.nationwide || m.search_description;
  const hasAreas = !!(areasVal && String(areasVal).trim() && String(areasVal).trim() !== "0");

  const parts = [hasProfile, hasPhoto, hasStory, hasObstacles, hasAreas];
  return Math.round((parts.filter(Boolean).length / parts.length) * 100);
}

// Read opted-in / opted-out from the member's tags array.
function optStatus(m) {
  const tags = Array.isArray(m.tags) ? m.tags : [];
  const names = tags.map((t) => (t.tag_name || t.name || "").toLowerCase());
  if (names.includes("matching-opted-in")) return "opted-in";
  if (names.includes("matching-opted-out")) return "opted-out";
  return "none";
}

// Tidy BD's lowercase_underscore values into readable labels.
// "long_term_rental_" -> "Long Term Rental", "selfemployed_1099" -> "Selfemployed 1099"
function tidy(v) {
  if (!v || String(v).trim() === "" || String(v).trim() === "0") return "";
  return String(v).replace(/_+$/,"").replace(/_/g," ").trim()
    .replace(/\b\w/g, function(c){ return c.toUpperCase(); });
}

// Budget is stored mashed, e.g. "10002000_" = $1000–$2000. Try to split into a range.
function tidyBudget(v) {
  if (!v) return "";
  const digits = String(v).replace(/[^0-9]/g, "");
  if (digits.length === 8) {
    const lo = parseInt(digits.slice(0, 4), 10);
    const hi = parseInt(digits.slice(4), 10);
    return "$" + lo.toLocaleString() + "–$" + hi.toLocaleString();
  }
  if (digits.length === 7) {
    // e.g. 1000200 ambiguous; fall back to showing raw-ish
    return "$" + parseInt(digits, 10).toLocaleString();
  }
  return tidy(v);
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

  // What a renter is seeking (useful queue context).
  const seeking = tidy(m.seeking);

  return {
    memberId: String(memberId),
    found: true,
    name,
    email: m.email || "",
    phone: m.phone_number || "",
    location,
    accountType,
    seeking,
    rentalInfo: {
      budget: tidyBudget(m.monthly_budget),
      timeline: tidy(m.i_want_to_relocate),
      household: m.number_of_peop ? String(m.number_of_peop).trim() : "",
      income: tidy(m.type_of_income),
      coSigner: tidy(m.co_signer),
      pets: tidy(m.do_you_have_pets),
      propertyType: tidy(m.property_type_preference),
      idealRental: (m.ideal_rental && String(m.ideal_rental).trim()) ? String(m.ideal_rental).trim() : "",
      creditRange: tidy(m.credit_range),
    },
    verified: String(m.verified || "0") === "1",
    verifyPhotoUrl: verifyPhoto ? (verifyPhoto.startsWith("http") ? verifyPhoto : "https://www.renters.com" + verifyPhoto) : "",
    profilePhoto: profilePhoto || "",
    profilePhotoUrl: profilePhoto
      ? (String(profilePhoto).startsWith("http") ? profilePhoto
         : "https://www.renters.com" + (String(profilePhoto).charAt(0) === "/" ? "" : "/") + profilePhoto)
      : "",
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
