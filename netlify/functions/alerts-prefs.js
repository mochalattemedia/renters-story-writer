// ==================================================================
// alerts-prefs.js  —  ap-v3
// Daily listing alerts: read + write renter alert preferences in BD.
//
// ap-v3 REBUILD: ap-v1/ap-v2 guessed the BD call shape and were wrong in
// four ways at once (Bearer auth, JSON body, POST-only, data.response).
// Every one of those is fatal on its own. The bd() helper below is lifted
// VERBATIM from member-zip.js mz-v4, which is the only call shape proven
// to authenticate against this instance. Do not "improve" it.
//
// Endpoints:
//   GET  ?version=1                 - version + env config check
//   GET  ?diag=1&memberId=ID        - dump every key BD returns, no write
//   GET  ?probe=1&memberId=ID       - write a throwaway stamp, read it back
//   GET  ?status=1&memberId=ID      - { enabled, criteria }  (card reads this)
//   POST { memberId, enabled, criteria }  - save + read-back verify
//
// Env:
//   BD_API_KEY    - required
//   BD_API_BASE   - defaults to https://www.renters.com/api/v2
// ==================================================================

const https = require("https");

const FN_VERSION = "ap-v3";
const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";

const CHIPS = [
  "move_in_special", "pets_dog", "pets_cat", "large_dog_ok",
  "washer_dryer_in_unit", "parking", "yard", "ground_floor",
  "no_stairs", "furnished", "utilities_included"
];

const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS"
};

function json(status, obj) {
  return { statusCode: status, headers: corsHeaders, body: JSON.stringify(obj, null, 2) };
}

// ------------------------------------------------------------------
// BD API helper. Lifted verbatim from member-zip.js mz-v4 (which took it
// from landlord-optin.js v16). Node https, not fetch. X-Api-Key, not Bearer.
// Form-urlencoded, not JSON. Keeps the redirect guard: BD redirects to the
// admin dashboard when auth is NOT accepted, and blindly following that
// redirect turns an auth failure into a confusing HTML 200.
// ------------------------------------------------------------------
function bd(path, opts) {
  opts = opts || {};
  const method = opts.method || "GET";
  const body = opts.body || null;

  return new Promise((resolve) => {
    const urlStr = `${BD_BASE}${path}`;
    let payload = null;
    const headers = { "X-Api-Key": process.env.BD_API_KEY, Accept: "application/json" };
    if (body) {
      payload = new URLSearchParams(body).toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }

    let u;
    try {
      u = new URL(urlStr);
    } catch (e) {
      return resolve({ ok: false, status: 0, data: null, raw: "", error: "bad url: " + urlStr });
    }

    const req = https.request(
      { hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, headers },
      (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          const loc = res.headers.location;
          res.resume();
          console.log(`[ap] ${method} ${urlStr} -> REDIRECT ${res.statusCode} to ${loc}`);
          return resolve({
            ok: false,
            status: res.statusCode,
            data: null,
            raw: "",
            error: `redirected to ${loc} (auth likely not accepted)`,
          });
        }
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let data = null;
          try { data = raw ? JSON.parse(raw) : null; } catch (e) { /* non-JSON */ }
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          if (!ok) {
            console.log(`[ap] ${method} ${urlStr} -> HTTP ${res.statusCode}; body(300): ${raw.slice(0, 300)}`);
          }
          resolve({ ok, status: res.statusCode, data, raw });
        });
      }
    );
    req.on("error", (e) => {
      console.log(`[ap] ${method} ${urlStr} -> REQ ERROR ${e.code || e.name}: ${e.message}`);
      resolve({ ok: false, status: 0, data: null, raw: "", error: (e.code || e.name) + ": " + e.message });
    });
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ ok: false, status: 0, data: null, raw: "", error: "timeout after 10s" });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// --- Read one member's full record. BD returns the record in data.message,
//     sometimes as an array, sometimes bare. Same unwrap mz-v4 uses. ---
async function getMember(userId) {
  const res = await bd(`/user/get/${encodeURIComponent(userId)}`);
  if (!res.ok || !res.data || res.data.status !== "success") {
    return { member: null, res };
  }
  const arr = Array.isArray(res.data.message) ? res.data.message : [res.data.message];
  return { member: arr[0] || null, res };
}

// --- Write. BD's docs conflict: Users API says PUT, API Overview says POST
//     with x-www-form-urlencoded. Try PUT, retry POST on 405, log the winner. ---
async function updateMember(fields) {
  let last = null;
  for (const method of ["PUT", "POST"]) {
    const res = await bd("/user/update", { method, body: fields });
    last = res;
    if (res.status === 405) {
      console.log(`[ap] ${method} rejected (405 Invalid Request Method), retrying`);
      continue;
    }
    console.log(`[ap] WRITE METHOD THAT WORKED: ${method} (HTTP ${res.status})`);
    return { method, res };
  }
  return { method: null, res: last };
}

// ------------------------------------------------------------------
// Criteria sanitising. Never trust the client. Chips are whitelisted
// against CHIPS so nothing arbitrary reaches the matcher prompt later.
// ------------------------------------------------------------------
function sanitize(raw) {
  const c = raw && typeof raw === "object" ? raw : {};

  function num(v) {
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(v);
    return isFinite(n) && n >= 0 ? n : null;
  }

  const wants = Array.isArray(c.wants) ? c.wants : [];
  const breakers = Array.isArray(c.deal_breakers) ? c.deal_breakers : [];

  const rent = num(c.rent_max);

  return {
    rent_max: rent && rent > 0 ? Math.round(rent) : null,
    beds_min: num(c.beds_min),
    baths_min: num(c.baths_min),
    move_in_by: typeof c.move_in_by === "string" ? c.move_in_by.slice(0, 10) : null,
    wants: wants.filter((k) => CHIPS.indexOf(k) !== -1).slice(0, 11),
    deal_breakers: breakers.filter((k) => CHIPS.indexOf(k) !== -1).slice(0, 11),
    notes: typeof c.notes === "string" ? c.notes.slice(0, 200) : ""
  };
}

function parseCriteria(v) {
  try {
    const o = JSON.parse(v || "{}");
    return o && typeof o === "object" ? o : {};
  } catch (e) {
    return {};
  }
}

// ------------------------------------------------------------------
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };

  const q = event.queryStringParameters || {};

  if (q.version) {
    return json(200, {
      version: FN_VERSION,
      bdBase: BD_BASE,
      bdApiKeyConfigured: !!process.env.BD_API_KEY,
      bdApiKeyLength: (process.env.BD_API_KEY || "").length,
      authHeader: "X-Api-Key",
      bodyEncoding: "x-www-form-urlencoded",
      chips: CHIPS
    });
  }

  if (!process.env.BD_API_KEY) {
    return json(500, { version: FN_VERSION, error: "BD_API_KEY not configured" });
  }

  const id = String(q.memberId || "").replace(/[^0-9]/g, "");

  // ---- diag: dump every key BD returns for this member, no write ----
  if (q.diag) {
    if (!id) return json(400, { version: FN_VERSION, error: "memberId required" });
    const { member, res } = await getMember(id);
    const keys = member ? Object.keys(member) : [];
    return json(200, {
      version: FN_VERSION,
      httpStatus: res.status,
      ok: res.ok,
      error: res.error || null,
      bdStatus: res.data ? res.data.status : null,
      memberFound: !!member,
      keyCount: keys.length,
      alertsKeysPresent: keys.filter((k) => k.indexOf("alert") !== -1),
      allKeys: keys,
      rawFirst800: (res.raw || "").slice(0, 800)
    });
  }

  // ---- probe: write a throwaway stamp, read it back ----
  if (q.probe) {
    if (!id) return json(400, { version: FN_VERSION, error: "memberId required" });
    const stamp = "probe-" + Date.now();
    const w = await updateMember({ user_id: String(id), alerts_consent_at: stamp });
    const { member } = await getMember(id);
    const readBack = member ? (member.alerts_consent_at || null) : null;
    return json(200, {
      version: FN_VERSION,
      wrote: stamp,
      writeMethod: w.method,
      writeHttpStatus: w.res ? w.res.status : null,
      writeResponse: w.res ? (w.res.raw || "").slice(0, 400) : null,
      readBack: readBack,
      landed: String(readBack || "") === stamp,
      alertsKeysPresent: member ? Object.keys(member).filter((k) => k.indexOf("alert") !== -1) : []
    });
  }

  // ---- status: what the dashboard card reads on load ----
  if (q.status) {
    if (!id) return json(400, { version: FN_VERSION, error: "memberId required" });
    const { member, res } = await getMember(id);
    if (!member) {
      // Fail loud, not silent. ap-v1 returned an empty default here and made a
      // 401 look like a clean empty record for an entire session.
      return json(502, {
        version: FN_VERSION,
        error: "member read failed",
        httpStatus: res.status,
        bdError: res.error || null,
        rawFirst300: (res.raw || "").slice(0, 300)
      });
    }
    return json(200, {
      version: FN_VERSION,
      enabled: String(member.alerts_enabled || "0") === "1",
      criteria: parseCriteria(member.alerts_criteria)
    });
  }

  // ---- POST: save ----
  if (event.httpMethod !== "POST") return json(405, { version: FN_VERSION, error: "method" });

  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return json(400, { version: FN_VERSION, error: "bad json" });
  }

  const pid = String(payload.memberId || "").replace(/[^0-9]/g, "");
  if (!pid) return json(400, { version: FN_VERSION, error: "memberId required" });

  const enabled = payload.enabled ? "1" : "0";
  const criteria = sanitize(payload.criteria);
  const criteriaStr = JSON.stringify(criteria);

  const fields = {
    user_id: String(pid),
    alerts_enabled: enabled,
    alerts_criteria: criteriaStr
  };
  if (enabled === "1") fields.alerts_consent_at = new Date().toISOString();

  const w = await updateMember(fields);

  // READ-BACK VERIFY. /user/update accepts any column name, files unknown
  // ones into users_meta, and still returns success. The write response is
  // not evidence. The read is.
  const { member } = await getMember(pid);
  const gotEnabled = member ? String(member.alerts_enabled || "") : "";
  const gotCriteria = member ? String(member.alerts_criteria || "") : "";

  const landedEnabled = gotEnabled === enabled;
  const landedCriteria = gotCriteria === criteriaStr;
  const landed = !!member && landedEnabled && landedCriteria;

  if (!landed) {
    console.error(FN_VERSION, "WRITE DID NOT LAND", {
      memberId: pid,
      writeMethod: w.method,
      writeHttpStatus: w.res ? w.res.status : null,
      writeResponse: w.res ? (w.res.raw || "").slice(0, 300) : null,
      landedEnabled,
      landedCriteria,
      sentCriteriaLength: criteriaStr.length,
      gotCriteriaLength: gotCriteria.length,
      gotCriteria: gotCriteria.slice(0, 200)
    });
  }

  return json(200, {
    version: FN_VERSION,
    landed: landed,
    enabled: enabled === "1",
    criteria: criteria,
    debug: landed
      ? undefined
      : {
          writeMethod: w.method,
          writeHttpStatus: w.res ? w.res.status : null,
          writeResponse: w.res ? (w.res.raw || "").slice(0, 400) : null,
          landedEnabled,
          landedCriteria,
          sentCriteriaLength: criteriaStr.length,
          gotCriteriaLength: gotCriteria.length,
          gotCriteria: gotCriteria.slice(0, 200),
          alertsKeysPresent: member ? Object.keys(member).filter((k) => k.indexOf("alert") !== -1) : []
        }
  });
};
