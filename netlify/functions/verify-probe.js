// ============================================================
//  verify-probe.js   ·   DIAGNOSTIC (temporary)
//  Goal: find out whether the BD REST API can set a member's
//  `verified` flag (and read the verification queue), so the
//  standalone admin verification page can work via REST API
//  instead of the admin-session bookmarklet.
//
//  Usage:
//    ?probe=1&key=renters2026                 -> list endpoint guesses (read-only)
//    ?read=1&memberId=3649&key=renters2026    -> read one member (shows verified + fields)
//    ?set=1&memberId=3649&key=renters2026&to=1  -> ATTEMPT to set verified=to, multi-shape
//  Read-only by default. Writes only happen with ?set=1.
// ============================================================

const https = require("https");
const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";
const KEY = "renters2026";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
    try { u = new URL(urlStr); } catch (e) {
      return resolve({ ok: false, status: 0, data: null, raw: "", error: "bad url" });
    }
    const options = { hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, headers };
    const req = https.request(options, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve({ ok: false, status: res.statusCode, data: null, raw: "", error: "redirect to " + res.headers.location });
      }
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch (e) {}
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data, raw });
      });
    });
    req.on("error", (e) => resolve({ ok: false, status: 0, data: null, raw: "", error: (e.code || e.name) + ": " + e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, status: 0, data: null, raw: "", error: "timeout" }); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function readMember(id) {
  const r = await bd(`/user/get/${encodeURIComponent(id)}`);
  let m = r.data && r.data.message ? r.data.message : (r.data || null);
  if (Array.isArray(m)) m = m[0] || null; // BD returns message as an array
  return {
    status: r.status,
    verified: m ? m.verified : null,
    name: m ? (m.full_name || m.first_name) : null,
    allKeys: m ? Object.keys(m) : [],
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };
  const q = event.queryStringParameters || {};
  if (q.key !== KEY) return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: "bad key" }) };

  const out = { base: BD_BASE };

  // READ one member
  if (q.read === "1" && q.memberId) {
    out.read = await readMember(q.memberId);
    return { statusCode: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }, body: JSON.stringify(out, null, 2) };
  }

  // SET verified flag — try multiple endpoint/method/field shapes
  if (q.set === "1" && q.memberId) {
    const to = q.to === "0" ? "0" : "1";
    const id = q.memberId;
    out.before = await readMember(id);

    const attempts = [
      { label: "POST /user/update {id,verified}", path: `/user/update`, method: "POST", body: { id: id, verified: to } },
      { label: "POST /user/update/{id} {verified}", path: `/user/update/${id}`, method: "POST", body: { verified: to } },
      { label: "PUT /user/update/{id} {verified}", path: `/user/update/${id}`, method: "PUT", body: { verified: to } },
      { label: "POST /user/set {id,field,value}", path: `/user/set`, method: "POST", body: { id: id, field: "verified", value: to } },
      { label: "POST /user/edit/{id} {verified}", path: `/user/edit/${id}`, method: "POST", body: { verified: to } },
      { label: "POST /user/update_field {id,name,value}", path: `/user/update_field`, method: "POST", body: { user_id: id, field_name: "verified", field_value: to } },
      { label: "POST /members/update/{id} {verified}", path: `/members/update/${id}`, method: "POST", body: { verified: to } },
    ];

    out.attempts = [];
    for (const a of attempts) {
      const r = await bd(a.path, { method: a.method, body: a.body });
      const rec = {
        tried: a.label,
        status: r.status,
        ok: r.ok,
        error: r.error || null,
        raw: (r.raw || "").slice(0, 160),
      };
      // Always read back so we can see whether the flag actually moved.
      const check = await readMember(id);
      rec.verifiedAfter = check.verified;
      out.attempts.push(rec);
      if (r.ok && String(check.verified) === String(to) && String(out.before.verified) !== String(to)) {
        out.WINNER = a.label;
        break;
      }
    }
    out.after = await readMember(id);
    return { statusCode: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }, body: JSON.stringify(out, null, 2) };
  }

  // Default: probe which read endpoints respond (no writes)
  out.probe = {};
  const reads = [
    `/user/get/${q.memberId || "3649"}`,
    `/user_submitted_forms/get?user_id=${q.memberId || "3649"}`,
    `/users/get?verified=0`,
    `/users/search?verified=0`,
  ];
  for (const p of reads) {
    const r = await bd(p);
    out.probe[p] = { status: r.status, ok: r.ok, hasData: !!(r.data && (r.data.message || r.data.length)), raw: (r.raw || "").slice(0, 120) };
  }
  return { statusCode: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }, body: JSON.stringify(out, null, 2) };
};
