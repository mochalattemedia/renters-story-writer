// ==================================================================
// alerts-claim.js  —  aclaim-v4
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
// aclaim-v4: A DRAWN ZONE FROM THE TEASER ARRIVES INTACT. The homepage
// now offers the map, so a visitor can hand over real zips and a real
// polygon before they have an account.
// That changes what a signup is worth: a typed name lands as a zone with
// NO ZIPS - a half-state the dashboard has to ask them to complete - while
// a drawn zone lands MATCHABLE. `needsAreas` is now false in that case, so
// the claim banner stops asking for something they already gave.
// A drawn zone always wins over a typed name; the name carries neither
// zips nor a path and exists only to be confirmed later.
// ⚠️ Re-sanitised here as well as in the teaser. A stash token is a
// BEARER capability and its contents are not trusted on the way back in.
//
// aclaim-v3: MUST-HAVES WERE BEING DROPPED AT THE DOOR. at-v14 split the
// teaser's single chip row into MUST HAVE and NICE TO HAVE - a genuine
// distinction, since a must-have REMOVES every listing without it while a
// nice-to-have only ranks them. This sanitiser still only knew about
// `wants`, so every must-have a visitor deliberately marked was silently
// discarded on the way in, and criteriaFromTeaser then wrote must_have as
// an empty array unconditionally.
// Now whitelisted, capped at 3 like the dashboard, and a key can only sit
// in one list.
// 📌 THE PATTERN: a producer gained a field and the consumer did not know.
// Anything crossing this boundary needs BOTH sides changed in the same
// pass, or the new field vanishes without an error anywhere.
//
// aclaim-v2 CHANGES. Two of these are data-loss fixes, not features.
//
// 1. 🔴 THE CLAIM WAS WIPING CONSENT AND HOUSEHOLD. It wrote
//    { v: 2, searches: merged } - a wrapper with NO consent key and NO
//    household key - straight over alerts_criteria. Anything the member
//    already had in those two fields was gone. It also stamped a v4
//    record back down to v2. Harmless while claims only ever landed on
//    brand new accounts, and a live data-loss path the moment one does
//    not. The merge now READS the existing wrapper and carries consent
//    and household through untouched, and writes v4.
//
// 2. 🔴 THE TEASER'S LOCATION DIED AT THE HANDOFF. The visitor typed a
//    place - the ONE required field on the teaser - and it was stored as
//    criteria.where. There is no `where` field in ANY schema version, so
//    the first time alerts-prefs read that record sanitizeCriteria threw
//    it away. A renter arrived on the dashboard with their budget, beds
//    and chips intact and no trace of the city they had asked for.
//    ⭐ IT NOW BECOMES A ZONE NAME: zone { name: "Portland, OR", zips: [] }.
//    A zone with a name and no zips is EXACTLY the right half-state -
//    ap-v10 stores it, the dashboard card still treats step one as
//    unanswered (it tests zips.length, not the name), and the picker can
//    open pre-centred on the place they typed. Confirm-or-redraw instead
//    of start-from-nothing, and the name is not lost either way.
//
// 3. The stashed search is written in SCHEMA v4 shape: an options[] entry
//    built from the rent and beds, mirrored onto criteria so any older
//    reader still sees a budget. beds_min becomes a beds[] set.
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
//     a drawn zone. It lands as zone.name with an empty zips list, which
//     is a deliberate half-state: the matcher must treat a zone with no
//     zips as NOT YET MATCHABLE, and the dashboard asks them to draw it.
//
// Env: BD_API_KEY, BD_API_BASE (default v2), NETLIFY_SITE_ID,
//      NETLIFY_BLOBS_TOKEN.
// ==================================================================

const https = require("https");
const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");

const FN_VERSION = "aclaim-v4";
const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";
const STORE_NAME = "alert-stash";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SEARCHES = 5;
const SCHEMA_VERSION = 4;
const BED_SIZES = ["studio", "1", "2", "3", "4plus"];

const CHIPS = [
  "move_in_special", "pets_dog", "pets_cat", "large_dog_ok",
  "washer_dryer_in_unit", "parking", "yard", "ground_floor",
  "no_stairs", "furnished", "utilities_included"
];
const MUST_CAP = 3;

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
  // 🔴 aclaim-v3: MUSTS WERE BEING DROPPED AT THE DOOR. at-v14 split the
  // teaser's one chip row into MUST HAVE and NICE TO HAVE, and this
  // sanitiser only knew about `wants` - so every must-have a visitor
  // picked was silently discarded on the way in. Whitelisted here, capped
  // at 3 like the dashboard, and a key can only be in one list.
  const musts = Array.isArray(s.musts)
    ? s.musts.filter((k) => CHIPS.indexOf(k) !== -1).slice(0, MUST_CAP)
    : [];
  const wants = Array.isArray(s.wants)
    ? s.wants.filter((k) => CHIPS.indexOf(k) !== -1 && musts.indexOf(k) === -1).slice(0, 11)
    : [];
  const rent = num(s.rent_max);
  return {
    rent_max: rent && rent > 0 ? Math.round(rent) : null,
    beds_min: num(s.beds_min),
    baths_min: num(s.baths_min),
    move_in_by: typeof s.move_in_by === "string" ? s.move_in_by.slice(0, 10) : null,
    wants: wants,
    musts: musts,
    deal_breakers: [],
    notes: typeof s.notes === "string" ? s.notes.slice(0, 200) : "",
    // Free-text location from the teaser. NOT zones. Surfaced to the member
    // so they convert it to real Search Areas on the dashboard.
    where: typeof s.where === "string" ? s.where.slice(0, 80) : "",
    zone: sanitizeDrawnZone(s.zone)
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
  return bits.length ? bits.join(" ").slice(0, 40) : "My perfect spot";
}

// ---- v2 teaser shape -> v4 perfect spot -----------------------------
// The teaser still captures beds_min as a single minimum. Schema v4 wants
// a SET of acceptable sizes, so a minimum of 2 means 2, 3 and 4plus all
// work - which is what "at least two bedrooms" actually means and is how
// ap-v6 migrated the same field.
function bedsFromMin(min) {
  const n = num(min);
  if (n === null) return [];
  const from = Math.max(0, Math.min(4, Math.round(n)));
  return BED_SIZES.slice(from);
}

// ⭐ THE LOCATION SURVIVES AS A ZONE NAME WITH NO ZIPS. Deliberate
// half-state: ap-v10 stores it, the card still treats step one as
// unanswered because it tests zips.length rather than the name, and the
// picker opens pre-centred on what they typed.
function zoneFromWhere(where) {
  const w = typeof where === "string" ? where.trim().slice(0, 60) : "";
  if (!w) return null;
  return { name: w, zips: [], custom: false, path: [] };
}

// aclaim-v4: A ZONE THE VISITOR ACTUALLY DREW, from the teaser's optional
// map. This is the difference between a signup that arrives MATCHABLE and
// one that still owes us a step: real zips and a real polygon rather than
// a place name we have to ask them to confirm.
// Sanitised here as well as in the teaser - a stash is a bearer token and
// its contents are not trusted on the way back in.
function sanitizeDrawnZone(raw) {
  const z = raw && typeof raw === "object" ? raw : null;
  if (!z) return null;

  const zips = [];
  const seen = {};
  const src = Array.isArray(z.zips) ? z.zips : [];
  for (let i = 0; i < src.length && zips.length < 40; i++) {
    // Exactly five digits. NEVER truncate - "9999999" cut to five is a
    // syntactically valid zip nobody typed, and a fabricated zip in a
    // match key is worse than a dropped one.
    const v = String(src[i] || "").replace(/[^0-9]/g, "");
    if (v.length === 5 && !seen[v]) { seen[v] = 1; zips.push(v); }
  }

  const path = [];
  const rawPath = Array.isArray(z.path) ? z.path : [];
  for (let i = 0; i < rawPath.length && path.length < 120; i++) {
    const pt = rawPath[i];
    if (!pt || typeof pt !== "object") continue;
    const lat = Number(pt.lat), lng = Number(pt.lng);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    path.push({ lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 });
  }

  const name = typeof z.name === "string" ? z.name.trim().slice(0, 60) : "";
  if (!name && !zips.length) return null;
  return { name: name, zips: zips, custom: z.custom === true, path: path };
}

function optionFromTeaser(c) {
  const beds = bedsFromMin(c.beds_min);
  const rent = num(c.rent_max);
  if (!rent && !beds.length && c.baths_min === null) return null;
  return {
    unit_types: [],
    rent_max: rent && rent > 0 ? Math.round(rent) : null,
    rent_stretch: null,
    rent_basis: null,
    beds: beds,
    baths_min: num(c.baths_min),
    label: ""
  };
}

// criteria in v4 shape. The chip keys the teaser collects are WANTS, and
// v3 renamed that pair to must_have / nice_to_have. A teaser chip is a
// preference, not a filter that removes listings, so it lands as
// nice_to_have - putting them in must_have would silently narrow a search
// the visitor thought they were widening.
function criteriaFromTeaser(c) {
  const beds = bedsFromMin(c.beds_min);
  const rent = num(c.rent_max);
  return {
    rent_max: rent && rent > 0 ? Math.round(rent) : null,
    rent_stretch: null,
    rent_basis: null,
    beds: beds,
    baths_min: num(c.baths_min),
    unit_types: [],
    move_in_earliest: null,
    move_in_latest: typeof c.move_in_by === "string" && c.move_in_by.length === 10 ? c.move_in_by : null,
    lease_terms: [],
    household_adults: null,
    household_kids: null,
    pets: [],
    voucher: false,
    voucher_program: "",
    // A must-have REMOVES listings that lack it. Only the ones the visitor
    // deliberately marked as such land here - never a nice-to-have
    // promoted by accident, which would silently narrow their spot.
    must_have: (c.musts || []).slice(0, MUST_CAP),
    nice_to_have: (c.wants || []).slice(0, 6),
    deal_breakers: [],
    legacy_breakers: [],
    notes: c.notes || "",
    transcript_excerpt: ""
  };
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
                  !search.move_in_by && !search.notes && !search.where &&
                  !search.wants.length && !search.musts.length && !search.zone;
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

    // 🔴 READ THE WHOLE WRAPPER, not just the searches. aclaim-v1 rebuilt
    // it as { v: 2, searches } and destroyed consent and household in the
    // process. Anything not understood here is carried through untouched.
    let existing = [];
    let priorConsent = null;
    let priorHousehold = null;
    try {
      const parsed = JSON.parse(member.alerts_criteria || "{}");
      if (Array.isArray(parsed.searches)) existing = parsed.searches;
      if (parsed.consent && typeof parsed.consent === "object") priorConsent = parsed.consent;
      if (parsed.household && typeof parsed.household === "object") priorHousehold = parsed.household;
    } catch (e) { existing = []; }

    if (existing.length >= MAX_SEARCHES) {
      // Nothing to do, but still consume the token so the wall does not loop.
      try { await store().delete(token); } catch (e) {}
      return json(200, { version: FN_VERSION, claimed: false, reason: "member already at max searches" });
    }

    const nowIso = new Date().toISOString();
    // A DRAWN zone wins over a typed name. It carries zips and a polygon;
    // the name carries neither and only exists to be confirmed later.
    const zone = search.zone || zoneFromWhere(search.where);
    const opt = optionFromTeaser(search);
    const rec2 = {
      id: newId(),
      /* The place they typed is the best name available, and it is what
         the card would have used anyway once a zone exists. */
      name: (zone && zone.name ? zone.name.slice(0, 40) : autoName(search)),
      created: nowIso,
      updated: nowIso,
      enabled: true,
      source: "form",
      zone: zone,
      options: opt ? [opt] : [],
      criteria: criteriaFromTeaser(search)
    };
    const merged = existing.concat([rec2]).slice(0, MAX_SEARCHES);

    /* v4, and consent and household are carried rather than dropped.
       A brand new member has neither, so both are usually null - the
       point is that a claim onto an EXISTING member no longer destroys
       them. */
    const payload = JSON.stringify({
      v: SCHEMA_VERSION,
      consent: priorConsent,
      household: priorHousehold,
      searches: merged
    });

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
      /* Still true, and now actionable: the zone has a NAME but no zips,
         so the dashboard knows both that a zone is needed AND where to
         centre the picker when it asks. */
      // FALSE when they drew one on the teaser - that spot is already
      // matchable and the dashboard must not ask again.
      needsAreas: !(zone && (zone.zips || []).length),
      where: search.where,
      zoneName: zone ? zone.name : ""
    });
  }

  return json(400, { version: FN_VERSION, error: "no action (stash|peek|claim|version)" });
};
