// ============================================================
//  member-zip.js   ·   VERSION: mz-v1  (2026-07-13)
//
//  WHY THIS FILE EXISTS
//  The onboarding wizard replaced BD's About Me force-march and killed
//  location capture (57% -> 3%, week of June 22 2026). 1,897 of 3,822
//  members have no city and no zip. This writes the member's zip to BD's
//  NATIVE zip_code column, and PROVES it landed by reading it back.
//
//  THE TRAP THIS FILE IS BUILT AROUND  (from BD's own API docs)
//  /user/update accepts data for ANY column. Columns that do NOT exist in
//  the users_data table are silently written to the users_meta table
//  instead, and BD still returns {"status":"success"}.
//  A wrong field name = HTTP 200 + stored where nothing can read it.
//  This is the write-API twin of the "no-swal" trap that cost us Search Areas.
//  So: EVERY WRITE IS READ BACK. A vendor 200 is not a save.
//
//  ENDPOINTS
//  GET  ?version=1                          -> { FN_VERSION }
//  GET  ?status=1&memberId=ID               -> { hasZip }        (head code calls this)
//  GET  ?keys=1&memberId=ID&key=KEY         -> location keys on the live record  [ADMIN]
//  GET  ?raw=1&memberId=ID&key=KEY          -> BD's unmodified /user/get JSON    [ADMIN]
//  GET  ?list=1&page=1&limit=100&key=KEY    -> bulk member-list probe            [ADMIN]
//  POST { memberId, zip }                   -> write + read-back verify
//
//  Required Netlify env vars:
//    BD_API_KEY              - Brilliant Directories API key (X-Api-Key header)
//    ADMIN_PROBE_KEY         - gates the three [ADMIN] probes (they return PII)
//    SES_ACCESS_KEY_ID       - already set
//    SES_SECRET_ACCESS_KEY   - already set
//  Optional:
//    BD_API_BASE             - defaults to https://www.renters.com/api/v2
//    SES_REGION              - defaults to us-east-2
// ============================================================

const https = require("https");
const { URL } = require("url");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");

const FN_VERSION = "mz-v1";
const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";
const PROBE_KEY = process.env.ADMIN_PROBE_KEY || "";

// BD's users_data column for the member zip. Confirmed in BD's API docs
// (/user/get, /user/create and /user/update all use zip_code). Re-confirm on
// the LIVE site with ?keys=1 before trusting it. If this is wrong, the write
// still returns success and the value lands in users_meta where nothing reads
// it — which is exactly what the read-back below is here to catch.
const ZIP_FIELD = "zip_code";

const ses = new SESClient({
  region: process.env.SES_REGION || "us-east-2",
  credentials: {
    accessKeyId: process.env.SES_ACCESS_KEY_ID,
    secretAccessKey: process.env.SES_SECRET_ACCESS_KEY,
  },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

function reply(status, obj) {
  return { statusCode: status, headers: corsHeaders, body: JSON.stringify(obj) };
}

// ------------------------------------------------------------------
// BD API helper. Lifted verbatim from landlord-optin.js v16 (proven in
// production). Node https, not fetch. Keeps the redirect guard: BD redirects
// to the admin dashboard when auth is NOT accepted, and blindly following that
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
          console.log(`[mz] ${method} ${urlStr} -> REDIRECT ${res.statusCode} to ${loc}`);
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
            console.log(`[mz] ${method} ${urlStr} -> HTTP ${res.statusCode}; body(300): ${raw.slice(0, 300)}`);
          }
          resolve({ ok, status: res.statusCode, data, raw });
        });
      }
    );
    req.on("error", (e) => {
      console.log(`[mz] ${method} ${urlStr} -> REQ ERROR ${e.code || e.name}: ${e.message}`);
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

// --- Read one member's full record ---
async function getMember(userId) {
  const { ok, data } = await bd(`/user/get/${encodeURIComponent(userId)}`);
  if (!ok || !data || data.status !== "success") return null;
  const arr = Array.isArray(data.message) ? data.message : [data.message];
  return arr[0] || null;
}

// --- Write. BD's docs conflict: the Users API article says PUT, the API
//     Overview says POST with x-www-form-urlencoded. We try PUT, and on a 405
//     (Invalid Request Method) we retry POST — and we LOG which one worked so
//     the next function that writes to a member column does not have to guess.
async function updateMember(fields) {
  let last = null;
  for (const method of ["PUT", "POST"]) {
    const res = await bd("/user/update", { method, body: fields });
    last = res;
    if (res.status === 405) {
      console.log(`[mz] ${method} rejected (405 Invalid Request Method), retrying`);
      continue;
    }
    console.log(`[mz] WRITE METHOD THAT WORKED: ${method} (HTTP ${res.status})`);
    return { method, res };
  }
  return { method: null, res: last };
}

// --- Zip normalize. Digits only, exactly 5. ---
function cleanZip(raw) {
  const s = String(raw == null ? "" : raw);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c >= "0" && c <= "9") out += c;
  }
  return out.slice(0, 5);
}

// --- Alarm. Fires ONLY when a write does not land. If the field name is right
//     this never sends. If it is ever wrong, the inbox should be screaming,
//     because that is precisely the failure that ran silently for three weeks.
async function alarm(memberId, zip, detail) {
  try {
    const lines = [
      "A member zip write did NOT land in BD.",
      "",
      "This means the value was accepted by BD (HTTP 200) but is not on the",
      "member record. Most likely the field name is wrong and BD filed it in",
      "users_meta instead of users_data.",
      "",
      `Member ID: ${memberId}`,
      `Zip sent: ${zip}`,
      `Field used: ${ZIP_FIELD}`,
      `Function: member-zip ${FN_VERSION}`,
      "",
      "Detail:",
      String(detail).slice(0, 800),
      "",
      "Check the live field name:",
      `  /.netlify/functions/member-zip?keys=1&memberId=${memberId}&key=YOUR_ADMIN_PROBE_KEY`,
      "",
      "---",
      "Renters.com zip capture alarm",
    ];
    await ses.send(
      new SendEmailCommand({
        Source: "verify@renters.com",
        Destination: { ToAddresses: ["kenny@renters.com"] },
        Message: {
          Subject: { Data: `ZIP WRITE FAILED - member ${memberId} (field ${ZIP_FIELD})` },
          Body: { Text: { Data: lines.join(String.fromCharCode(10)) } },
        },
      })
    );
  } catch (e) {
    console.log("[mz] alarm email failed: " + e.message);
  }
}

// ==================================================================
exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  const q = event.queryStringParameters || {};

  // ---------- version (public, harmless) ----------
  if (event.httpMethod === "GET" && q.version) {
    return reply(200, { fn: "member-zip", FN_VERSION, zipField: ZIP_FIELD });
  }

  if (!process.env.BD_API_KEY) {
    console.log("[mz] FATAL: BD_API_KEY missing from env");
    return reply(500, { ok: false, error: "bd_api_key_missing", FN_VERSION });
  }

  if (event.httpMethod === "GET") {
    // ---------- status: does this member already have a zip? ----------
    // Returns a BOOLEAN only. Never echoes the zip back, so this endpoint
    // cannot be walked to enumerate member locations.
    if (q.status === "1" && q.memberId) {
      const m = await getMember(q.memberId);
      if (!m) {
        // Unknown. The head code treats this as "do not block" (fail open).
        return reply(200, { FN_VERSION, memberId: q.memberId, hasZip: null, note: "member_not_read" });
      }
      const z = cleanZip(m[ZIP_FIELD]);
      return reply(200, { FN_VERSION, memberId: q.memberId, hasZip: z.length === 5 });
    }

    // ---------- ADMIN PROBES (gated: /user/get returns email, phone, address) ----
    const isProbe = q.raw || q.keys || q.list;
    if (isProbe) {
      if (!PROBE_KEY || q.key !== PROBE_KEY) {
        return reply(403, { ok: false, error: "probe_key_required", FN_VERSION });
      }

      // ?list=1 -> DOES BD HAVE A BULK MEMBER LIST?
      // This is the question that has blocked Open Thread #6 (Verification Ops
      // Dashboard) and #9 / Element T (Live Members Map). BD's docs say
      // /user/get with no params enumerates all users, paginated.
      if (q.list) {
        let path = `/user/get?page=${encodeURIComponent(q.page || 1)}&limit=${encodeURIComponent(q.limit || 100)}`;
        if (q.property) {
          path += `&property=${encodeURIComponent(q.property)}&property_value=${encodeURIComponent(q.property_value || "")}`;
        }
        const res = await bd(path);
        const msg = res.data && res.data.message;
        const rows = Array.isArray(msg) ? msg : [];
        return reply(200, {
          ok: true,
          FN_VERSION,
          BULK_LIST_WORKS: rows.length > 0,
          returnedThisPage: rows.length,
          total: res.data && res.data.total,
          current_page: res.data && res.data.current_page,
          total_pages: res.data && res.data.total_pages,
          // Exactly the fields members-map-build.js needs, and nothing else.
          sample: rows.slice(0, 5).map((u) => ({
            user_id: u.user_id,
            zip_code: u.zip_code,
            city: u.city,
            profession_id: u.profession_id,
            subscription_id: u.subscription_id,
          })),
          httpStatus: res.status,
          error: res.error || null,
        });
      }

      // ?raw=1 -> BD's unmodified /user/get JSON.
      if (q.raw) {
        if (!q.memberId) return reply(400, { ok: false, error: "memberId_required" });
        const res = await bd(`/user/get/${encodeURIComponent(q.memberId)}`);
        return reply(200, {
          ok: true,
          FN_VERSION,
          httpStatus: res.status,
          raw: res.data || res.raw,
          error: res.error || null,
        });
      }

      // ?keys=1 -> the same answer, readable on a phone. Read LOCATION_KEYS.
      if (q.keys) {
        if (!q.memberId) return reply(400, { ok: false, error: "memberId_required" });
        const rec = await getMember(q.memberId);
        if (!rec) return reply(200, { ok: false, error: "no_record", FN_VERSION });

        const keys = Object.keys(rec);
        const hits = {};
        keys.forEach((k) => {
          const lk = k.toLowerCase();
          if (
            lk.indexOf("zip") !== -1 ||
            lk.indexOf("postal") !== -1 ||
            lk.indexOf("city") !== -1 ||
            lk.indexOf("state") !== -1 ||
            lk.indexOf("address") !== -1 ||
            lk === "lat" ||
            lk === "lon"
          ) {
            hits[k] = rec[k];
          }
        });
        return reply(200, {
          ok: true,
          FN_VERSION,
          memberId: q.memberId,
          LOCATION_KEYS: hits, // <-- the answer, in one line
          weWillWriteTo: ZIP_FIELD,
          allKeys: keys,
        });
      }
    }

    return reply(200, { FN_VERSION, fn: "member-zip" });
  }

  // ==================================================================
  // POST: the write. Called by the wizard zip gate (head code block zip1).
  // ==================================================================
  if (event.httpMethod !== "POST") {
    return reply(405, { ok: false, error: "method_not_allowed", FN_VERSION });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return reply(400, { ok: false, error: "bad_json", FN_VERSION });
  }

  const memberId = String(body.memberId || "").trim();
  const zip = cleanZip(body.zip);

  if (!memberId) return reply(400, { ok: false, error: "memberId_required", FN_VERSION });
  if (zip.length !== 5) {
    return reply(400, { ok: false, error: "zip_must_be_5_digits", got: zip, FN_VERSION });
  }

  console.log(`[mz] WRITE member=${memberId} zip=${zip} field=${ZIP_FIELD}`);

  const fields = { user_id: memberId };
  fields[ZIP_FIELD] = zip;

  const w = await updateMember(fields);
  const wStatus = w.res ? w.res.status : 0;
  const wRaw = w.res ? String(w.res.raw || w.res.error || "").slice(0, 300) : "";

  // ------------------------------------------------------------------
  // READ IT BACK. THIS IS THE ENTIRE POINT OF THIS FUNCTION.
  // BD returns success even when it quietly files the value in users_meta.
  // The only proof is reading the member record and finding the value ON it.
  // ------------------------------------------------------------------
  const after = await getMember(memberId);
  const stored = after ? cleanZip(after[ZIP_FIELD]) : "";
  const landed = stored === zip;

  if (landed) {
    console.log(`[mz] LANDED. member=${memberId} ${ZIP_FIELD}=${stored} lat=${after.lat} lon=${after.lon}`);
  } else {
    console.log(
      `[mz] *** DID NOT LAND *** member=${memberId} sent=${zip} field=${ZIP_FIELD} ` +
        `readBack=${JSON.stringify(stored)} writeMethod=${w.method} writeStatus=${wStatus} writeBody=${wRaw}`
    );
    await alarm(memberId, zip, `writeMethod=${w.method} writeStatus=${wStatus} body=${wRaw} readBack=${stored}`);
  }

  return reply(landed ? 200 : 502, {
    ok: landed,
    landed, // false = the value is NOT on the member record. Field name is wrong.
    zip,
    field: ZIP_FIELD,
    readBack: stored,
    writeMethod: w.method,
    writeStatus: wStatus,
    // Did BD geocode the zip for us on write, or does it still wait for the
    // manual "Sync Members with Google Maps" button? First real write answers this.
    lat: after ? after.lat : null,
    lon: after ? after.lon : null,
    FN_VERSION,
  });
};
