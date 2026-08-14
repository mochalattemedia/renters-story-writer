// ============================================================
//  member-profile.js   ·   VERSION: mp-v2  (2026-08-14)
//  mp-v2: THE PHONE COLUMN IS phone_number, NOT phone.
//    mp-v1 guessed `phone` from the shape of the other fields and it read
//    back EMPTY on a member who plainly had a number on file. The read was
//    merely wrong; the WRITE would have been worse - it would have created
//    a `phone` field nobody displays, the read-back would have compared
//    that new field against itself and reported ok:true, and the number on
//    her dashboard would never have changed. A write that verifies itself
//    against the wrong column verifies nothing.
//    Field names come from BD's Form Manager, where the system variable IS
//    the column name. Guessing one because it matches the pattern of its
//    neighbours is how this happened.
//
//  ONE RECORD, TWO VIEWS. The app edits name, email and phone natively;
//  BD's own forms edit the same fields on the web. Both write the same BD
//  member record, so a renter who fixes their phone number on a phone and
//  opens a laptop finds it already right.
//
//  🔴 THIS IS NOT A SECOND STORE, AND THE DISTINCTION IS THE WHOLE POINT.
//  "Native" here means the FORM is native. The data is BD's, exactly as it
//  was before. A second copy would be a fork with a redundant sync problem
//  attached, and it would show up as two screens disagreeing about
//  somebody's own phone number - which is worse than a branding seam.
//
//  ENDPOINTS
//    GET  ?memberId=ID          -> the editable fields, and nothing else
//    POST { memberId, secret, first_name, last_name, email, phone }
//    GET  ?version=1
//
//  ⚠️ WHAT IT DELIBERATELY WILL NOT TOUCH:
//    · password       - BD owns auth, and a password endpoint is a target
//    · verified flag  - set by the Didit webhook, never by a client
//    · plan / status  - billing state, not profile state
//    · alerts_criteria - ap-v11 owns that, and a partial write there
//                        destroys every spot the renter has
//  An allowlist rather than a blocklist, because a blocklist fails open the
//  day BD adds a field.
//
//  🔑 THE READ IS AN ALLOWLIST TOO. BD's user record carries far more than
//  a renter needs back - internal flags, billing fields, other members'
//  data shapes. Returning the whole object because it was convenient is
//  how an endpoint quietly becomes an information leak.
//
//  Env: BD_API_KEY, BD_API_BASE (default v2).
// ============================================================

const https = require("https");

const FN_VERSION = "mp-v2";
const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";

// The same light gate the rest of the member-facing functions check. It
// ships to the client, and it belongs in an env var with a server-side
// check. Recorded rather than quietly worked around.
const SECRET = "renters2026";

// Exactly what the app may read back and write. Nothing else crosses.
const FIELDS = ["first_name", "last_name", "email", "phone_number"];

const cors = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
};

function json(status, obj) {
  return { statusCode: status, headers: cors, body: JSON.stringify(obj, null, 2) };
}

// Verbatim shape from member-zip.js mz-v4, which is the only BD call shape
// proven to land. Redirects are treated as failure: BD answers an
// unauthenticated write with a 302 to a login page, and following it would
// return a cheerful 200 carrying HTML.
function bd(path, opts) {
  opts = opts || {};
  const method = opts.method || "GET";
  const body = opts.body || null;
  return new Promise((resolve) => {
    let payload = null;
    const headers = { "X-Api-Key": process.env.BD_API_KEY, Accept: "application/json" };
    if (body) {
      payload = new URLSearchParams(body).toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    let u;
    try { u = new URL(BD_BASE + path); }
    catch (e) { return resolve({ ok: false, status: 0, data: null, error: "bad url" }); }

    const req = https.request(
      { hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, headers },
      (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return resolve({ ok: false, status: res.statusCode, data: null,
                           error: "redirected (auth not accepted)" });
        }
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let data = null;
          try { data = raw ? JSON.parse(raw) : null; } catch (e) {}
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300,
                    status: res.statusCode, data, raw });
        });
      }
    );
    req.on("error", (e) => resolve({ ok: false, status: 0, data: null, error: e.message }));
    req.setTimeout(10000, () => { req.destroy();
      resolve({ ok: false, status: 0, data: null, error: "timeout" }); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function getMember(userId) {
  const res = await bd("/user/get/" + encodeURIComponent(userId));
  if (!res.ok || !res.data || res.data.status !== "success") return null;
  const arr = Array.isArray(res.data.message) ? res.data.message : [res.data.message];
  return arr[0] || null;
}

async function updateMember(fields) {
  // BD has answered PUT on some installs and POST on others, and a 405 is
  // the only way to tell. Try in order rather than guessing.
  let last = null;
  for (const method of ["PUT", "POST"]) {
    const res = await bd("/user/update", { method, body: fields });
    last = res;
    if (res.status === 405) continue;
    return { method, res };
  }
  return { method: null, res: last };
}

// ---- validation -------------------------------------------------------
// Shape validation is not validation - a correctly shaped value can still be
// wrong - but a wrongly shaped one is certainly wrong and costs nothing to
// catch here rather than in a bounced email six weeks later.

function cleanName(v) {
  return String(v == null ? "" : v).replace(/[<>]/g, "").trim().slice(0, 60);
}

function cleanEmail(v) {
  const s = String(v == null ? "" : v).trim().slice(0, 120);
  if (!s) return "";
  const at = s.indexOf("@");
  const dot = s.lastIndexOf(".");
  if (at < 1 || dot < at + 2 || dot === s.length - 1) return null;
  if (s.indexOf(" ") !== -1) return null;
  return s;
}

function cleanPhone(v) {
  const s = String(v == null ? "" : v);
  let d = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c >= "0" && c <= "9") d += c;
  }
  if (!d) return "";
  // 10 digits, or 11 starting with a US country code. Anything else is a
  // typo far more often than it is an international number, and this is a
  // US-only product today.
  if (d.length === 11 && d.charAt(0) === "1") d = d.slice(1);
  if (d.length !== 10) return null;
  return d;
}

function pick(member) {
  return {
    first_name: member.first_name || "",
    last_name: member.last_name || "",
    email: member.email || "",
    // Returned as `phone` for the client, read from phone_number in BD.
    phone: member.phone_number || "",
    // Read-only context the app displays but cannot change. Included so the
    // Me tab does not need a second call for it.
    verified: String(member.verified || "0") === "1",
    // Still a guess, and it reads blank on live data. Left in rather than
    // removed because it costs nothing and is a label, not a decision - but
    // it should be corrected from the Form Manager rather than guessed at
    // a third time.
    memberType: member.plan_name || member.membership_plan || ""
  };
}

// ---- handler ----------------------------------------------------------

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };

  const q = event.queryStringParameters || {};

  if (q.version) {
    return json(200, {
      version: FN_VERSION,
      bdApiKeyConfigured: !!process.env.BD_API_KEY,
      editable: FIELDS
    });
  }

  if (!process.env.BD_API_KEY) {
    return json(500, { version: FN_VERSION, error: "BD_API_KEY not set" });
  }

  if (event.httpMethod === "GET") {
    const memberId = String(q.memberId || "").replace(/[^0-9]/g, "");
    if (!memberId) return json(400, { version: FN_VERSION, error: "memberId required" });
    const m = await getMember(memberId);
    if (!m) return json(502, { version: FN_VERSION, error: "member read failed" });
    return json(200, { version: FN_VERSION, memberId, profile: pick(m) });
  }

  if (event.httpMethod !== "POST") {
    return json(405, { version: FN_VERSION, error: "method not allowed" });
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return json(400, { version: FN_VERSION, error: "bad json" }); }

  if (body.secret !== SECRET) return json(401, { version: FN_VERSION, error: "unauthorized" });

  const memberId = String(body.memberId || "").replace(/[^0-9]/g, "");
  if (!memberId) return json(400, { version: FN_VERSION, error: "memberId required" });

  const before = await getMember(memberId);
  if (!before) return json(502, { version: FN_VERSION, error: "member read failed" });

  // Only fields actually PRESENT in the request are touched. A form that
  // submits three fields must not blank the fourth, and an app screen that
  // only edits a phone number should send only a phone number.
  const fields = { user_id: memberId };
  const errors = [];

  if ("first_name" in body) fields.first_name = cleanName(body.first_name);
  if ("last_name" in body) fields.last_name = cleanName(body.last_name);

  if ("email" in body) {
    const e = cleanEmail(body.email);
    if (e === null) errors.push({ field: "email", error: "that does not look like an email address" });
    else if (!e) errors.push({ field: "email", error: "email cannot be empty" });
    else fields.email = e;
  }

  // Accepts either name from the client and always writes phone_number.
  if ("phone" in body || "phone_number" in body) {
    const raw = "phone_number" in body ? body.phone_number : body.phone;
    const p = cleanPhone(raw);
    if (p === null) errors.push({ field: "phone", error: "a US phone number is 10 digits" });
    else fields.phone_number = p;
  }

  if (errors.length) return json(400, { version: FN_VERSION, error: "check these", errors });
  if (Object.keys(fields).length < 2) {
    return json(400, { version: FN_VERSION, error: "nothing to update" });
  }

  const w = await updateMember(fields);

  // READ BACK. BD accepts a write it did not apply and answers 200 - it has
  // done exactly that with unknown keys and with fake geo - so success is
  // whether the value CHANGED, not whether the call returned cleanly.
  const after = await getMember(memberId);
  if (!after) return json(502, { version: FN_VERSION, error: "could not verify the save" });

  const landed = {};
  let allLanded = true;
  Object.keys(fields).forEach((k) => {
    if (k === "user_id") return;
    const got = String(after[k] == null ? "" : after[k]);
    const want = String(fields[k]);
    landed[k] = got === want;
    if (!landed[k]) allLanded = false;
  });

  if (!allLanded) {
    console.error(FN_VERSION, "write did not land", {
      memberId, method: w.method, status: w.res ? w.res.status : null, landed
    });
  }

  return json(200, {
    version: FN_VERSION,
    ok: allLanded,
    landed,
    profile: pick(after)
  });
};
