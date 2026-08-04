// ==================================================================
// alerts-claim.js  —  aclaim-v1
// The bridge between the logged-OUT homepage teaser and the logged-IN
// dashboard. A visitor's search is parked here under a random token, and
// claimed onto their new member record after signup.
//
//   POST ?stash=1   body { search:{...} }        -> { token }
//   GET  ?peek=1&token=TOKEN                      -> { search } (no delete)
//   POST ?claim=1   body { token, memberId }      -> writes the search to
//        that member via ap-v5's storage shape, read-back verified, then
//        deletes the token so it cannot be claimed twice.
//
// STORAGE: Netlify Blob store "alert-stash". Tokens expire after 30 days;
// a claim or a peek past expiry is treated as not-found. getStore() gets
// siteID + token passed explicitly (it only throws on read/write, not on
// creation).
//
// SECURITY NOTES:
//   - A token is a bearer capability: whoever has it can attach that
//     search to a member id they supply. That is acceptable because the
//     search contains no PII (rent, beds, chips, a place name) and the
//     worst case is a spurious saved search on your own new account.
//   - The claim writes to BD with the SAME read-back-verified path as
//     ap-v5. It does NOT trust the stashed data blindly: criteria is
//     re-sanitised and chip keys are re-whitelisted here too.
//   - Location from the teaser is a free-text place ("Portland, OR"), NOT
//     zones. It is stored in criteria.notes-adjacent field `where` and
//     surfaced to the member so they can convert it to real Search Areas
//     on the dashboard. The nightly cron must treat a search whose areas
//     are unset as "not yet matchable" (same gate the card shows).
//
// Env: BD_API_KEY, BD_API_BASE (default v2), NETLIFY_SITE_ID,
//      NETLIFY_BLOBS_TOKEN.
// ==================================================================

const https = require("https");
const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");

const FN_VERSION = "aclaim-v1";
const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";
const STORE_NAME = "alert-stash";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SEARCHES = 5;

const CHIPS = [
  "move_in_special", "pets_dog", "pets_cat", "large_dog_ok",
  "washer_dryer_in_unit", "parking", "yard", "ground_floor",
  "no_stairs", "furnished", "utilities_included"
];

const cors = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS"
};

function json(status, obj) {
  return { statusCode: status, headers: cors, body: JSON.stringify(obj, null, 2) };
}

function store() {
  return getStore({
    name: STORE_NAME,
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN
  });
}

// ---- BD helper: verbatim shape from member-zip.js mz-v4 ----
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
    try { u = new URL(urlStr); }
    catch (e) { return resolve({ ok: false, status: 0, data: null, raw: "", error: "bad url" }); }
    const req = https.request(
      { hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, headers },
      (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return resolve({ ok: false, status: res.statusCode, data: null, raw: "", error: "redirected (auth not accepted)" });
        }
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let data = null;
          try { data = raw ? JSON.parse(raw) : null; } catch (e) {}
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data, raw });
        });
      }
    );
    req.on("error", (e) => resolve({ ok: false, status: 0, data: null, raw: "", error: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, status: 0, data: null, raw: "", error: "timeout" }); });
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
    if (res.status === 405) continue;
    return { method, res };
  }
  return { method: null, res: last };
}

// ---- sanitising, mirrors ap-v5 ----
function num(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) && n >= 0 ? n : null;
}

function sanitizeSearch(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const wants = Array.isArray(s.wants) ? s.wants.filter((k) => CHIPS.indexOf(k) !== -1).slice(0, 11) : [];
  const rent = num(s.rent_max);
  return {
    rent_max: rent && rent > 0 ? Math.round(rent) : null,
    beds_min: num(s.beds_min),
    baths_min: num(s.baths_min),
    move_in_by: typeof s.move_in_by === "string" ? s.move_in_by.slice(0, 10) : null,
    wants: wants,
    deal_breakers: [],
    notes: typeof s.notes === "string" ? s.notes.slice(0, 200) : "",
    // Free-text location from the teaser. NOT zones. Surfaced to the member
    // so they convert it to real Search Areas on the dashboard.
    where: typeof s.where === "string" ? s.where.slice(0, 80) : ""
  };
}

function newToken() {
  return "t_" + crypto.randomBytes(16).toString("hex");
}
function newId() {
  return "s" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
}
function autoName(c) {
  const bits = [];
  if (c.beds_min) bits.push(c.beds_min + "BR");
  if (c.rent_max) bits.push("under $" + c.rent_max);
  if (c.where) bits.push("in " + c.where);
  return bits.length ? bits.join(" ") : "My search";
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  const q = event.queryStringParameters || {};

  if (q.version) {
    return json(200, {
      version: FN_VERSION,
      bdApiKeyConfigured: !!process.env.BD_API_KEY,
      blobsConfigured: !!process.env.NETLIFY_SITE_ID && !!process.env.NETLIFY_BLOBS_TOKEN,
      store: STORE_NAME,
      ttlDays: 30
    });
  }

  // ---- stash: park a search, return a token ----
  if (q.stash) {
    if (event.httpMethod !== "POST") return json(405, { version: FN_VERSION, error: "POST only" });
    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch (e) { return json(400, { version: FN_VERSION, error: "bad json" }); }

    const search = sanitizeSearch(body.search);
    const empty = !search.rent_max && !search.beds_min && !search.baths_min &&
                  !search.move_in_by && !search.notes && !search.where && !search.wants.length;
    if (empty) return json(400, { version: FN_VERSION, error: "empty search" });

    const token = newToken();
    try {
      await store().setJSON(token, { search: search, created: Date.now() });
    } catch (e) {
      console.error(FN_VERSION, "stash write failed", e.message);
      return json(502, { version: FN_VERSION, error: "could not stash" });
    }
    return json(200, { version: FN_VERSION, token: token });
  }

  // ---- peek: read a stashed search without consuming it ----
  if (q.peek) {
    const token = String(q.token || "");
    if (!token) return json(400, { version: FN_VERSION, error: "token required" });
    let rec = null;
    try { rec = await store().get(token, { type: "json" }); } catch (e) { rec = null; }
    if (!rec || (Date.now() - (rec.created || 0)) > TTL_MS) {
      return json(404, { version: FN_VERSION, error: "not found or expired" });
    }
    return json(200, { version: FN_VERSION, search: rec.search });
  }

  // ---- claim: attach the stashed search to a member, then delete it ----
  if (q.claim) {
    if (event.httpMethod !== "POST") return json(405, { version: FN_VERSION, error: "POST only" });
    if (!process.env.BD_API_KEY) return json(500, { version: FN_VERSION, error: "BD_API_KEY not set" });

    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch (e) { return json(400, { version: FN_VERSION, error: "bad json" }); }

    const token = String(body.token || "");
    const memberId = String(body.memberId || "").replace(/[^0-9]/g, "");
    if (!token || !memberId) return json(400, { version: FN_VERSION, error: "token and memberId required" });

    let rec = null;
    try { rec = await store().get(token, { type: "json" }); } catch (e) { rec = null; }
    if (!rec || (Date.now() - (rec.created || 0)) > TTL_MS) {
      return json(404, { version: FN_VERSION, error: "not found or expired" });
    }

    const search = sanitizeSearch(rec.search);

    // Read the member first: never clobber searches they already have.
    const { member } = await getMember(memberId);
    if (!member) return json(502, { version: FN_VERSION, error: "member read failed" });

    let existing = [];
    try {
      const parsed = JSON.parse(member.alerts_criteria || "{}");
      if (Array.isArray(parsed.searches)) existing = parsed.searches;
    } catch (e) { existing = []; }

    if (existing.length >= MAX_SEARCHES) {
      // Nothing to do, but still consume the token so the wall does not loop.
      try { await store().delete(token); } catch (e) {}
      return json(200, { version: FN_VERSION, claimed: false, reason: "member already at max searches" });
    }

    const nowIso = new Date().toISOString();
    const rec2 = {
      id: newId(),
      name: autoName(search),
      created: nowIso,
      updated: nowIso,
      enabled: true,
      criteria: search
    };
    const merged = existing.concat([rec2]).slice(0, MAX_SEARCHES);
    const payload = JSON.stringify({ v: 2, searches: merged });

    const w = await updateMember({
      user_id: memberId,
      alerts_enabled: "1",
      alerts_criteria: payload,
      alerts_consent_at: nowIso
    });

    // Read-back verify, same discipline as ap-v5.
    const after = (await getMember(memberId)).member;
    const landed = !!after && String(after.alerts_criteria || "") === payload;

    if (!landed) {
      console.error(FN_VERSION, "claim write did not land", {
        memberId, writeMethod: w.method, writeStatus: w.res ? w.res.status : null,
        sentLen: payload.length, gotLen: after ? String(after.alerts_criteria || "").length : 0
      });
      return json(200, {
        version: FN_VERSION, claimed: false, reason: "write did not land",
        debug: { writeMethod: w.method, writeStatus: w.res ? w.res.status : null }
      });
    }

    // Consume the token so it cannot be replayed.
    try { await store().delete(token); } catch (e) {}

    return json(200, {
      version: FN_VERSION,
      claimed: true,
      searchName: rec2.name,
      needsAreas: true,   // teaser location is free text, not zones
      where: search.where
    });
  }

  return json(400, { version: FN_VERSION, error: "no action (stash|peek|claim|version)" });
};
