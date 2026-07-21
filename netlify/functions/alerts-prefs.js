// ==================================================================
// alerts-prefs.js  —  ap-v4
// Daily listing alerts: read + write renter alert preferences in BD.
//
// ap-v4 CHANGE: MULTIPLE SAVED SEARCHES.
// ap-v3 stored one criteria object. This stores an array, so a renter
// can keep "2BR under 2200 in Vancouver" alongside "anything with a
// yard that takes big dogs" and see when each was created.
//
// STORED SHAPE (in alerts_criteria, long text):
//   { "v": 2, "searches": [ {
//       id, name, created, updated, enabled, criteria: {...}
//   } ] }
//
// LEGACY MIGRATION: ap-v3 records are a bare criteria object with no
// "searches" key. Those are wrapped into a single search on read, with
// created taken from alerts_consent_at. Migration happens on READ and is
// only persisted on the next write, so a read-only visit never mutates
// a member record.
//
// CAP: 5 searches. Every search is a nightly matcher call per member;
// unbounded searches is an unbounded bill. Also alerts_criteria is a
// text column and long enough JSON will truncate. The read-back catches
// truncation, which is exactly what it is there for.
//
// Endpoints:
//   GET  ?version=1
//   GET  ?diag=1&memberId=ID        - dump every key BD returns, no write
//   GET  ?probe=1&memberId=ID       - write a throwaway stamp, read it back
//   GET  ?status=1&memberId=ID      - { enabled, searches: [...] }
//   POST { memberId, enabled, searches }        - replace the whole set
//   POST { memberId, action:"delete", searchId } - remove one
//
// Env:
//   BD_API_KEY    - required
//   BD_API_BASE   - defaults to https://www.renters.com/api/v2
// ==================================================================

const https = require("https");

const FN_VERSION = "ap-v4";
const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";
const MAX_SEARCHES = 5;

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
// BD API helper. Lifted verbatim from member-zip.js mz-v4. Node https,
// not fetch. X-Api-Key, not Bearer. Form-urlencoded, not JSON. Keeps the
// redirect guard: BD redirects to the admin dashboard when auth is NOT
// accepted, and following that turns an auth failure into an HTML 200.
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
            ok: false, status: res.statusCode, data: null, raw: "",
            error: `redirected to ${loc} (auth likely not accepted)`
          });
        }
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let data = null;
          try { data = raw ? JSON.parse(raw) : null; } catch (e) { /* non-JSON */ }
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          if (!ok) console.log(`[ap] ${method} ${urlStr} -> HTTP ${res.statusCode}; body(300): ${raw.slice(0, 300)}`);
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

async function getMember(userId) {
  const res = await bd(`/user/get/${encodeURIComponent(userId)}`);
  if (!res.ok || !res.data || res.data.status !== "success") return { member: null, res };
  const arr = Array.isArray(res.data.message) ? res.data.message : [res.data.message];
  return { member: arr[0] || null, res };
}

async function updateMember(fields) {
  let last = null;
  for (const method of ["PUT", "POST"]) {
    const res = await bd("/user/update", { method, body: fields });
    last = res;
    if (res.status === 405) {
      console.log(`[ap] ${method} rejected (405), retrying`);
      continue;
    }
    console.log(`[ap] WRITE METHOD THAT WORKED: ${method} (HTTP ${res.status})`);
    return { method, res };
  }
  return { method: null, res: last };
}

// ------------------------------------------------------------------
// Criteria sanitising. Never trust the client.
// ------------------------------------------------------------------
function num(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) && n >= 0 ? n : null;
}

function sanitizeCriteria(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const wants = Array.isArray(c.wants) ? c.wants : [];
  const breakersRaw = Array.isArray(c.deal_breakers) ? c.deal_breakers : [];

  const cleanWants = wants.filter((k) => CHIPS.indexOf(k) !== -1).slice(0, 11);
  // A key cannot be both a want and a deal breaker. Wants win; the UI
  // blocks this, but the UI is not the security boundary.
  const cleanBreakers = breakersRaw
    .filter((k) => CHIPS.indexOf(k) !== -1 && cleanWants.indexOf(k) === -1)
    .slice(0, 11);

  const rent = num(c.rent_max);

  return {
    rent_max: rent && rent > 0 ? Math.round(rent) : null,
    beds_min: num(c.beds_min),
    baths_min: num(c.baths_min),
    move_in_by: typeof c.move_in_by === "string" ? c.move_in_by.slice(0, 10) : null,
    wants: cleanWants,
    deal_breakers: cleanBreakers,
    notes: typeof c.notes === "string" ? c.notes.slice(0, 200) : ""
  };
}

function criteriaIsEmpty(c) {
  if (!c) return true;
  if (c.rent_max) return false;
  if (c.beds_min !== null) return false;
  if (c.baths_min !== null) return false;
  if (c.move_in_by) return false;
  if (c.notes) return false;
  if ((c.wants || []).length) return false;
  if ((c.deal_breakers || []).length) return false;
  return true;
}

function newId() {
  return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function autoName(c) {
  const bits = [];
  if (c.beds_min) bits.push(c.beds_min + "BR");
  if (c.rent_max) bits.push("under $" + c.rent_max);
  if (!bits.length && (c.wants || []).length) bits.push(c.wants[0].replace(/_/g, " "));
  return bits.length ? bits.join(" ") : "My search";
}

function sanitizeSearch(raw, fallbackCreated) {
  const s = raw && typeof raw === "object" ? raw : {};
  const criteria = sanitizeCriteria(s.criteria);
  const nowIso = new Date().toISOString();
  let name = typeof s.name === "string" ? s.name.trim().slice(0, 40) : "";
  if (!name) name = autoName(criteria);
  return {
    id: typeof s.id === "string" && s.id ? s.id.slice(0, 24) : newId(),
    name: name,
    created: typeof s.created === "string" && s.created ? s.created.slice(0, 30) : (fallbackCreated || nowIso),
    updated: nowIso,
    enabled: s.enabled === false ? false : true,
    criteria: criteria
  };
}

// ------------------------------------------------------------------
// READ. Handles v2 array shape AND the ap-v3 single-object legacy shape.
// Migration is computed on read, persisted only on the next write.
// ------------------------------------------------------------------
function parseStored(rawStr, consentAt) {
  let o = null;
  try { o = JSON.parse(rawStr || "{}"); } catch (e) { o = null; }
  if (!o || typeof o !== "object") return { searches: [], migrated: false };

  if (Array.isArray(o.searches)) {
    return {
      searches: o.searches
        .filter((s) => s && typeof s === "object")
        .slice(0, MAX_SEARCHES)
        .map((s) => ({
          id: String(s.id || newId()).slice(0, 24),
          name: String(s.name || "My search").slice(0, 40),
          created: String(s.created || consentAt || "").slice(0, 30),
          updated: String(s.updated || "").slice(0, 30),
          enabled: s.enabled === false ? false : true,
          criteria: sanitizeCriteria(s.criteria)
        })),
      migrated: false
    };
  }

  // Legacy ap-v3: bare criteria object.
  const legacy = sanitizeCriteria(o);
  if (criteriaIsEmpty(legacy)) return { searches: [], migrated: false };

  return {
    searches: [{
      id: newId(),
      name: autoName(legacy),
      created: consentAt || new Date().toISOString(),
      updated: consentAt || new Date().toISOString(),
      enabled: true,
      criteria: legacy
    }],
    migrated: true
  };
}

// ------------------------------------------------------------------
async function writeSearches(memberId, enabled, searches) {
  const payload = JSON.stringify({ v: 2, searches: searches });
  const fields = {
    user_id: String(memberId),
    alerts_enabled: enabled ? "1" : "0",
    alerts_criteria: payload
  };
  if (enabled) fields.alerts_consent_at = new Date().toISOString();

  const w = await updateMember(fields);

  // READ-BACK VERIFY. /user/update accepts any column name, files unknown
  // ones into users_meta, and still returns success. The write response is
  // not evidence. The read is. This also catches text-column truncation,
  // which is the live risk now that the payload holds up to 5 searches.
  const { member } = await getMember(memberId);
  const gotEnabled = member ? String(member.alerts_enabled || "") : "";
  const gotCriteria = member ? String(member.alerts_criteria || "") : "";

  const landedEnabled = gotEnabled === (enabled ? "1" : "0");
  const landedCriteria = gotCriteria === payload;
  const landed = !!member && landedEnabled && landedCriteria;

  const truncated = !!member && gotCriteria.length > 0 && gotCriteria.length < payload.length;

  if (!landed) {
    console.error(FN_VERSION, "WRITE DID NOT LAND", {
      memberId,
      writeMethod: w.method,
      writeHttpStatus: w.res ? w.res.status : null,
      landedEnabled, landedCriteria, truncated,
      sentLength: payload.length,
      gotLength: gotCriteria.length
    });
  }

  return { landed, truncated, w, payloadLength: payload.length, gotLength: gotCriteria.length, member };
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
      maxSearches: MAX_SEARCHES,
      chips: CHIPS
    });
  }

  if (!process.env.BD_API_KEY) {
    return json(500, { version: FN_VERSION, error: "BD_API_KEY not configured" });
  }

  const id = String(q.memberId || "").replace(/[^0-9]/g, "");

  if (q.diag) {
    if (!id) return json(400, { version: FN_VERSION, error: "memberId required" });
    const { member, res } = await getMember(id);
    const keys = member ? Object.keys(member) : [];
    return json(200, {
      version: FN_VERSION,
      httpStatus: res.status,
      ok: res.ok,
      error: res.error || null,
      memberFound: !!member,
      keyCount: keys.length,
      alertsKeysPresent: keys.filter((k) => k.indexOf("alert") !== -1),
      alertsCriteriaLength: member ? String(member.alerts_criteria || "").length : 0,
      rawFirst800: (res.raw || "").slice(0, 800)
    });
  }

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
      readBack,
      landed: String(readBack || "") === stamp,
      alertsKeysPresent: member ? Object.keys(member).filter((k) => k.indexOf("alert") !== -1) : []
    });
  }

  // ---- status: what the dashboard card reads on load ----
  if (q.status) {
    if (!id) return json(400, { version: FN_VERSION, error: "memberId required" });
    const { member, res } = await getMember(id);
    if (!member) {
      // Fail loud, not silent. ap-v1 returned an empty default here and made
      // a 401 look like a clean empty record for an entire session.
      return json(502, {
        version: FN_VERSION,
        error: "member read failed",
        httpStatus: res.status,
        bdError: res.error || null
      });
    }
    const parsed = parseStored(member.alerts_criteria, member.alerts_consent_at);
    return json(200, {
      version: FN_VERSION,
      enabled: String(member.alerts_enabled || "0") === "1",
      maxSearches: MAX_SEARCHES,
      migratedFromLegacy: parsed.migrated,
      searches: parsed.searches
    });
  }

  if (event.httpMethod !== "POST") return json(405, { version: FN_VERSION, error: "method" });

  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return json(400, { version: FN_VERSION, error: "bad json" });
  }

  const pid = String(payload.memberId || "").replace(/[^0-9]/g, "");
  if (!pid) return json(400, { version: FN_VERSION, error: "memberId required" });

  // ---- delete one search ----
  if (payload.action === "delete") {
    const { member } = await getMember(pid);
    if (!member) return json(502, { version: FN_VERSION, error: "member read failed" });

    const parsed = parseStored(member.alerts_criteria, member.alerts_consent_at);
    const target = String(payload.searchId || "");
    const kept = parsed.searches.filter((s) => s.id !== target);

    if (kept.length === parsed.searches.length) {
      return json(404, { version: FN_VERSION, error: "search not found", searchId: target });
    }

    const stillEnabled = kept.some((s) => s.enabled);
    const r = await writeSearches(pid, stillEnabled, kept);

    return json(200, {
      version: FN_VERSION,
      landed: r.landed,
      deleted: target,
      enabled: stillEnabled,
      searches: kept,
      debug: r.landed ? undefined : {
        truncated: r.truncated,
        sentLength: r.payloadLength,
        gotLength: r.gotLength,
        writeMethod: r.w.method,
        writeHttpStatus: r.w.res ? r.w.res.status : null
      }
    });
  }

  // ---- replace the whole set ----
  const incoming = Array.isArray(payload.searches) ? payload.searches : [];
  if (incoming.length > MAX_SEARCHES) {
    return json(400, {
      version: FN_VERSION,
      error: "too many searches",
      max: MAX_SEARCHES,
      got: incoming.length
    });
  }

  const clean = incoming
    .map((s) => sanitizeSearch(s, null))
    .filter((s) => !criteriaIsEmpty(s.criteria));

  const enabled = payload.enabled === false ? false : clean.some((s) => s.enabled);

  const r = await writeSearches(pid, enabled, clean);

  return json(200, {
    version: FN_VERSION,
    landed: r.landed,
    enabled: enabled,
    maxSearches: MAX_SEARCHES,
    searches: clean,
    debug: r.landed ? undefined : {
      truncated: r.truncated,
      sentLength: r.payloadLength,
      gotLength: r.gotLength,
      writeMethod: r.w.method,
      writeHttpStatus: r.w.res ? r.w.res.status : null,
      hint: r.truncated
        ? "alerts_criteria is truncating. Widen the column in BD Form Manager to long text."
        : "field name or value mismatch on read-back"
    }
  });
};
