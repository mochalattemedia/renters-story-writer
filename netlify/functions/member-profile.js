// ============================================================
//  member-profile.js   ·   VERSION: mp-v5  (2026-08-14)
//  mp-v5: A RAW READ, ADMIN ONLY, BECAUSE GUESSING KEEPS COSTING US.
//    ?admin=KEY&raw=1&memberId=ID returns BD's unmodified user object, and
//    ?admin=KEY&values=1 samples several members to show which VALUES are
//    actually stored in each option field.
//
//    🔴 WHY IT EXISTS. mp-v2 was needed because `phone` was guessed when
//    the column is `phone_number`. Then the About Me sheet was built with
//    option LABELS - "Next month", "$2,000-$3,000" - when BD stores
//    `next_month` and `20003000`. Both are the same failure: a write that
//    succeeds, reads back exactly what it wrote, and means nothing to the
//    form that owns the field. Reading the record is the only way to know.
//
//    ⚠️ ADMIN ONLY, FAILS CLOSED. The raw object carries email, phone and
//    everything else BD holds. Without RDC_ADMIN_KEY set, the path does not
//    exist - an admin door that opens when a variable is missing is worse
//    than no door.
//  mp-v4: ABOUT ME. Seven more fields, so the app can edit the profile
//    natively instead of sending a renter out to a BD page.
//
//    🔑 EVERY NAME CAME OFF BD'S FORM MANAGER, NOT FROM A PATTERN. They
//    are truncated at inconsistent points - `number_of_peop`,
//    `how_are_you_searchi` - because BD cuts the label at a fixed length
//    and the labels differ. There is no rule to infer them from, and mp-v2
//    exists because `phone` was guessed when the column was `phone_number`.
//
//    ⚠️ `how_are_you_searchi[]` IS DELIBERATELY NOT HERE. It is a
//    multi-select, arrays post to BD differently, and a wrong array shape
//    stores nothing while returning 200 - the same silent failure that cost
//    us the phone field. It stays read-only until a write can be proven.
//
//    ⚠️ `ideal_rental` IS READ ONLY for the same reason it is not asked
//    twice: the spot's notes field asks it at the moment it is useful, and
//    alerts-voice fills it in from speech. Two editors for one answer is
//    how they end up disagreeing.
//  mp-v3: VALIDATE ON THE DIGITS, STORE WHAT THEY TYPED.
//    mp-v2 stripped every number to bare digits, so Charlye's stored
//    "253-686-7582" would have been rewritten as "2536867582" the first
//    time anything else on that form was saved. Three problems, none of
//    them loud:
//      · a write that changes a field the renter did not touch
//      · a "saved" message over a value that is not what they typed
//      · and the client comparing "253-686-7582" against "2536867582",
//        seeing a difference, and sending a write on every single save
//    The digits are what makes a phone number valid. The punctuation is
//    what makes it THEIRS. Check the first, keep the second.
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

const FN_VERSION = "mp-v5";
const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";

// The same light gate the rest of the member-facing functions check. It
// ships to the client, and it belongs in an env var with a server-side
// check. Recorded rather than quietly worked around.
const SECRET = "renters2026";
const ADMIN_KEY = process.env.RDC_ADMIN_KEY || "";

// Exactly what the app may read back and write. Nothing else crosses.
const FIELDS = [
  "first_name", "last_name", "email", "phone_number",
  // About me. Editable.
  "number_of_peop", "monthly_budget", "gross_monthly_combined",
  "do_you_have_pets", "co_signer", "i_want_to_relocate", "seeking"
];

// Read back, never written from the app. See the header.
const READ_ONLY = ["ideal_rental", "how_are_you_searchi"];

// Free-text-ish fields get a length cap and nothing else - BD owns its own
// option lists, and a client-side allowlist of values here would go stale
// the day somebody edits the form.
const ABOUT_MAX = 120;

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

function digitsOf(v) {
  const s = String(v == null ? "" : v);
  let d = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c >= "0" && c <= "9") d += c;
  }
  return d;
}

// Returns the string to STORE, or null if it is not a usable number.
// The value returned is the renter's own text, trimmed - not a normalised
// rewrite of it.
function cleanPhone(v) {
  const raw = String(v == null ? "" : v).trim().slice(0, 30);
  if (!raw) return "";
  let d = digitsOf(raw);
  // 10 digits, or 11 starting with a US country code. Anything else is a
  // typo far more often than it is an international number, and this is a
  // US-only product today.
  if (d.length === 11 && d.charAt(0) === "1") d = d.slice(1);
  if (d.length !== 10) return null;
  return raw;
}

// Two numbers are the same number if the same ten digits are in them.
// Used so a re-save does not write a field nobody edited just because the
// punctuation moved.
function samePhone(a, b) {
  let x = digitsOf(a), y = digitsOf(b);
  if (x.length === 11 && x.charAt(0) === "1") x = x.slice(1);
  if (y.length === 11 && y.charAt(0) === "1") y = y.slice(1);
  return x === y;
}

function pick(member) {
  return {
    first_name: member.first_name || "",
    last_name: member.last_name || "",
    email: member.email || "",
    // Returned as `phone` for the client, read from phone_number in BD.
    phone: member.phone_number || "",

    // About me, editable.
    household: member.number_of_peop || "",
    budget: member.monthly_budget || "",
    income: member.gross_monthly_combined || "",
    pets: member.do_you_have_pets || "",
    cosigner: member.co_signer || "",
    timing: member.i_want_to_relocate || "",
    term: member.seeking || "",

    // Read only. Shown so the app can display the whole picture without
    // becoming a second place to edit it.
    idealRental: member.ideal_rental || "",
    searchingOn: member.how_are_you_searchi || "",
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

  // ---- ADMIN: raw record, and an option-value sample --------------------
  if (q.admin) {
    if (!ADMIN_KEY || q.admin !== ADMIN_KEY) return json(404, { error: "not found" });

    if (q.raw) {
      const id = String(q.memberId || "").replace(/[^0-9]/g, "");
      if (!id) return json(400, { version: FN_VERSION, error: "memberId required" });
      const m = await getMember(id);
      if (!m) return json(502, { version: FN_VERSION, error: "member read failed" });
      return json(200, { version: FN_VERSION, memberId: id, raw: m });
    }

    if (q.values) {
      // Walks a handful of members and collects every DISTINCT value seen in
      // each option field. It cannot show an option nobody has ever picked -
      // that is the honest limit of reading data rather than reading a form.
      const ids = String(q.ids || "").split(",").map((x) => x.trim()).filter(Boolean);
      if (!ids.length) {
        return json(400, { version: FN_VERSION,
          error: "pass ids=4534,4110,... (members who have filled this in)" });
      }
      const watch = ["gross_monthly_combined", "number_of_peop", "monthly_budget",
                     "co_signer", "i_want_to_relocate", "seeking", "do_you_have_pets",
                     "how_are_you_searchi", "ideal_rental"];
      const seen = {};
      watch.forEach((k) => { seen[k] = {}; });
      const missed = [];

      for (const id of ids.slice(0, 25)) {
        const m = await getMember(id);
        if (!m) { missed.push(id); continue; }
        watch.forEach((k) => {
          const v = m[k];
          if (v === undefined || v === null || v === "") return;
          const key = String(v);
          seen[k][key] = (seen[k][key] || 0) + 1;
        });
      }

      const out = {};
      watch.forEach((k) => {
        out[k] = Object.keys(seen[k]).map((v) => ({ value: v, count: seen[k][v] }))
                       .sort((a, b) => b.count - a.count);
      });
      return json(200, { version: FN_VERSION, sampled: ids.length, unreadable: missed,
                         values: out });
    }
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
  // About me. Only fields actually PRESENT in the request are touched, so a
  // sheet that edits three of them cannot blank the other four.
  ["number_of_peop", "monthly_budget", "gross_monthly_combined",
   "do_you_have_pets", "co_signer", "i_want_to_relocate", "seeking"].forEach((k) => {
    if (k in body) fields[k] = str(body[k], ABOUT_MAX);
  });

  if ("phone" in body || "phone_number" in body) {
    const raw = "phone_number" in body ? body.phone_number : body.phone;
    const p = cleanPhone(raw);
    if (p === null) errors.push({ field: "phone", error: "a US phone number is 10 digits" });
    else if (samePhone(p, before.phone_number)) {
      // Same digits, different punctuation. Nothing to do, and writing it
      // anyway would touch a record the renter did not change.
    } else {
      fields.phone_number = p;
    }
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
    // BD may normalise a phone on its way in. Same digits is a landed write;
    // comparing the exact string would report a false failure and send the
    // renter back to re-save something that already saved.
    landed[k] = (k === "phone_number") ? samePhone(got, want) : (got === want);
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
