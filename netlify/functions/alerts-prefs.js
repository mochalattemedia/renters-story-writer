// ==================================================================
// alerts-prefs.js  —  ap-v8
// Daily listing alerts: read + write renter alert preferences in BD.
//
// ap-v8 CHANGE: SEARCH IDS ARE STABLE ACROSS READS. FIXES A LIVE BUG
// THAT PREDATES v6 AND IS PRESENT IN ap-v5.
//
// Caught by comparing two consecutive live ?status=1 reads of member
// 3650: the same search came back as sms6oo93nkyhx, then sms6oxxr5h7jl.
// The id was being regenerated on every read.
//
// CAUSE. A stored record with no id fell through to newId(), which is
// timestamp + random. That happens for the ap-v3-era bare-criteria shape
// (no v, no id, name from autoName, created from alerts_consent_at -
// all four true of 3650) and for any v2 search missing an id.
//
// WHY IT MATTERS: DELETE WAS BROKEN FOR THOSE RECORDS.
//   1. card reads, gets id A
//   2. renter taps Delete, card POSTs id A
//   3. backend re-reads, generates id B, filters for A, finds nothing
//   4. 404 search not found
// The matcher would have inherited the same problem: alerts_sent_ids
// dedupe keyed on a search id that changes every night dedupes nothing.
//
// FIX. An id that is absent from storage is now DERIVED from the search
// content (sha1 of criteria + created + name, prefixed lg), so it is
// identical on every read until a write persists it. newId() is still
// used for genuinely new searches arriving from the card, where random
// is correct.
//
// ap-v7 CHANGE: LEGACY DEAL BREAKERS ARE QUARANTINED, NOT TRUSTED.
//
// Confirmed live on member 3650 (read, no write): the stored record had
//   nice_to_have:  move_in_special, large_dog_ok, yard
//   deal_breakers: washer_dryer_in_unit, no_stairs, furnished,
//                  utilities_included
// Those breakers are POSITIVE keys. Read literally the member will not
// accept in-unit laundry, no stairs, furniture or utilities included.
// Nobody meant that. The ap-v5 UI reused the positive labels on the
// deal-breaker row (Open Thread #44), so the stored value means
// something other than what it says and the intent is NOT recoverable
// from the data.
//
// THE HAZARD THIS REMOVES: the moment a matcher treats deal_breakers as
// hard exclusions, this member is filtered out of good listings
// silently, and the symptom reads as "alerts never send anything."
//
// So deal_breakers now accepts ONLY the negative vocabulary. Legacy
// positive keys arriving on that row are moved to legacy_breakers,
// which is PRESERVED for review and IGNORED BY THE MATCHER. Nothing is
// deleted, the live ac-v12 card keeps saving without error, and the
// field the matcher reads can be trusted.
//
// ?report=1 now lists membersNeedingBreakerReview so the affected
// renters can be re-asked. At this member count that is a handful.
//
// ap-v6 CHANGE: SCHEMA v3. CURATED CRITERIA + CONSENT + ONE VOCABULARY.
//
// Five things:
//
// 1. MUST-HAVE / NICE-TO-HAVE SPLIT. ap-v5 stored one undifferentiated
//    wants[] array, so the matcher had no way to know what was a hard
//    filter and what was a scoring weight. Either everything filtered
//    (zero matches) or nothing did (noise). must_have[] is a hard filter
//    applied in code and is CAPPED AT 3 - a renter with nine hard
//    requirements against a small market gets zero emails forever and
//    reads it as broken. nice_to_have[] is uncapped and is what the
//    scoring pass reads.
//
// 2. EXPANDED CRITERIA. beds is now a SET of acceptable sizes rather
//    than a floor (beds_min:1 sent 4BR houses to someone who wanted a
//    1BR). Rent gains a stretch amount and an all-in / plus-utilities
//    basis, because a renter at 1800 will take 1950 with utilities
//    included and that was the single largest source of missed matches.
//    Move-in is a WINDOW, not a deadline. Plus unit types, lease terms,
//    household size, structured pets (species + count + weight, because
//    "dogs ok under 40lbs" is what actually kills a match at the
//    showing) and voucher acceptance.
//
// 3. DEAL BREAKERS GET THEIR OWN NEGATIVE VOCABULARY. Closes Open
//    Thread #44. ap-v5 reused the positive chip list, so a deal breaker
//    read as "does not want: Dog friendly", which does not parse. The
//    old positive keys are STILL ACCEPTED in deal_breakers for back
//    compat - see note 5.
//
// 4. TWO CONSENT STATES, stored at the top of the wrapper rather than in
//    a new BD column. Renters opted into being surfaced ON Renters.com;
//    that is not consent to be passed to a third-party marketplace.
//      consent.platform     - introduce me to verified Renters.com
//                             properties that match
//      consent.off_platform - also pass my inquiry to matching
//                             properties not on Renters.com yet
//    Both default FALSE. Absent is not consent.
//
// 5. ap-v5 / ac-v12 BACK COMPAT IS DELIBERATE AND LOAD-BEARING. The
//    LIVE CARD IS ac-v12 and will keep POSTing the v2 shape until
//    ac-v14 deploys. Every v2 key is still whitelisted, so nothing a
//    live renter saves is silently stripped in the window between these
//    two deploys. Deploy order does not matter. That is the point.
//
// NEW: GET ?schema=1 returns every vocabulary and cap in one place.
//   ac-v14 and alerts-voice.js both read it instead of each carrying
//   their own copy of the chip list. A key that exists in one layer and
//   not another is the #44 failure mode, and this removes the chance of
//   it recurring.
//
// STORED SHAPE (v3, in alerts_criteria, long text):
//   { "v": 3,
//     "consent": { platform, off_platform, recorded_at },
//     "searches": [ { id, name, created, updated, enabled, source,
//                     criteria: {...} } ] }
//
// TRANSCRIPT HANDLING. Voice intake produces a verbatim transcript that
// can run well past what a text column should carry. The criteria keeps
// a 600-char excerpt for matching context; the FULL verbatim transcript
// goes to the demand Blob, which has no column limit. The structured
// output NEVER overwrites the transcript - the structure is for
// matching, the transcript is for the concierge and for demand reading.
//
// MIGRATION, v1 -> v2 -> v3, all computed on READ and persisted only on
// the next write, so a read-only visit never mutates a member record.
//   beds_min: N        -> beds: [N and every size above it]  (preserves
//                         the old floor semantics exactly)
//   move_in_by         -> move_in_latest  (earliest stays null)
//   wants[]            -> nice_to_have[]  (NEVER must_have - promoting
//                         an old soft preference to a hard filter would
//                         silently stop a renter's matches)
//   deal_breakers[]    -> kept as-is, old keys still valid
//
// CAP: 5 searches. Every search is a matcher call per member per night.
// alerts_criteria MUST be a long-text column; the read-back catches
// truncation and names it in the failure hint.
//
// Endpoints:
//   GET  ?version=1
//   GET  ?schema=1                  - vocabularies + caps, no auth
//   GET  ?diag=1&memberId=ID        - dump every key BD returns, no write
//   GET  ?probe=1&memberId=ID       - write a throwaway stamp, read it back
//   GET  ?status=1&memberId=ID      - { enabled, consent, searches: [...] }
//   GET  ?report=1&key=ADMIN[&limit=200]
//   POST { memberId, enabled, consent, searches }  - replace the whole set
//   POST { memberId, action:"delete", searchId }   - remove one
//
// Env:
//   BD_API_KEY    - required
//   BD_API_BASE   - defaults to https://www.renters.com/api/v2
//                   DO NOT CHANGE. It already includes /api/v2 and every
//                   function on the platform composes paths on that
//                   assumption. Changing it took listing down for 21h.
// ==================================================================

const https = require("https");
const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");

const FN_VERSION = "ap-v8";
const SCHEMA_VERSION = 3;
const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";
const MAX_SEARCHES = 5;
const MUST_HAVE_CAP = 3;
const NOTES_MAX = 400;
const TRANSCRIPT_EXCERPT_MAX = 600;
const DEMAND_STORE = "alert-demand";

// ------------------------------------------------------------------
// VOCABULARIES. One definition, served to every layer via ?schema=1.
// ------------------------------------------------------------------

// Positive amenity keys. Valid in must_have AND nice_to_have.
// The first eleven are the v2 CHIPS list, unchanged, so v2 payloads from
// the live ac-v12 card validate cleanly.
const POSITIVE_CHIPS = [
  "move_in_special", "pets_dog", "pets_cat", "large_dog_ok",
  "washer_dryer_in_unit", "parking", "yard", "ground_floor",
  "no_stairs", "furnished", "utilities_included",
  // ap-v6 additions
  "in_building_laundry", "dishwasher", "air_conditioning", "elevator",
  "balcony", "storage", "near_transit", "accessible_unit",
  "pool", "gym", "short_term_ok"
];

// Negative-form deal breakers. Closes #44: these read correctly as
// things a renter will NOT accept.
const BREAKER_CHIPS = [
  "stairs", "no_parking", "street_parking_only", "no_pets_allowed",
  "not_furnished", "no_laundry_on_site", "shared_bathroom",
  "shared_kitchen", "basement_unit", "no_air_conditioning",
  "carpet_throughout", "no_elevator", "ground_floor_only",
  "smoking_building"
];

// ap-v5 accepted positive keys on the deal-breaker row. They are still
// ACCEPTED (so a live ac-v12 save never errors) but they are no longer
// trusted as exclusions - they are quarantined into legacy_breakers.
// See the ap-v7 note in the header.
const BREAKER_ACCEPTED = BREAKER_CHIPS.concat(POSITIVE_CHIPS);
const LEGACY_BREAKER_KEYS = POSITIVE_CHIPS;

const BED_SIZES = ["studio", "1", "2", "3", "4plus"];
const UNIT_TYPES = ["apartment", "house", "townhouse", "condo", "duplex", "room"];
const LEASE_TERMS = ["12mo", "month_to_month", "short_term", "flexible"];
const RENT_BASIS = ["all_in", "plus_utilities"];
const PET_SPECIES = ["dog", "cat", "other"];
const SOURCES = ["form", "voice"];

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
// BD API helper. Lifted verbatim from member-zip.js mz-v4 and carried
// unchanged through ap-v5. Node https, not fetch. X-Api-Key, not Bearer.
// Form-urlencoded, not JSON. PUT then POST. Keeps the redirect guard: BD
// redirects to the admin dashboard when auth is NOT accepted, and
// following that turns an auth failure into an HTML 200.
// DO NOT RE-DERIVE THIS. ap-v1 and ap-v2 each guessed and were wrong in
// four ways at once.
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
// Sanitising. Never trust the client. Never invent a value the client
// did not state - an omitted field is silence, not a statement.
// ------------------------------------------------------------------
function num(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) && n >= 0 ? n : null;
}

function int(v, max) {
  const n = num(v);
  if (n === null) return null;
  const i = Math.round(n);
  if (max !== undefined && i > max) return max;
  return i;
}

function str(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function pickFrom(v, list) {
  return typeof v === "string" && list.indexOf(v) !== -1 ? v : null;
}

function setFrom(raw, list, cap) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const k of arr) {
    if (list.indexOf(k) !== -1 && out.indexOf(k) === -1) out.push(k);
    if (cap && out.length >= cap) break;
  }
  return out;
}

function isoDate(v) {
  const s = typeof v === "string" ? v.slice(0, 10) : "";
  // YYYY-MM-DD, digits checked without regex escapes.
  if (s.length !== 10) return null;
  for (let i = 0; i < 10; i++) {
    const ch = s.charCodeAt(i);
    if (i === 4 || i === 7) { if (ch !== 45) return null; continue; }
    if (ch < 48 || ch > 57) return null;
  }
  return s;
}

function sanitizePets(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const p of arr.slice(0, 4)) {
    if (!p || typeof p !== "object") continue;
    const species = pickFrom(p.species, PET_SPECIES);
    if (!species) continue;
    out.push({
      species: species,
      count: int(p.count, 6) || 1,
      weight_lbs: int(p.weight_lbs, 400),
      note: str(p.note, 60)
    });
  }
  return out;
}

function sanitizeCriteria(raw) {
  const c = raw && typeof raw === "object" ? raw : {};

  // ---- must-have / nice-to-have ----
  // Cap must_have HARD. A renter with nine hard requirements gets no
  // email ever, which reads as a broken product rather than a strict
  // search. Overflow is not discarded, it becomes nice-to-have.
  const mustRaw = Array.isArray(c.must_have) ? c.must_have : [];
  const must = setFrom(mustRaw, POSITIVE_CHIPS, MUST_HAVE_CAP);

  // v2 wants[] migrate to nice_to_have, never to must_have.
  const niceRaw = []
    .concat(Array.isArray(c.nice_to_have) ? c.nice_to_have : [])
    .concat(Array.isArray(c.wants) ? c.wants : [])
    .concat(mustRaw.filter((k) => must.indexOf(k) === -1));
  const nice = setFrom(niceRaw, POSITIVE_CHIPS, POSITIVE_CHIPS.length)
    .filter((k) => must.indexOf(k) === -1);

  // ---- deal breakers, split ----
  // Only the negative vocabulary lands in deal_breakers. A positive key
  // on this row is ap-v5-era data whose meaning is unrecoverable, so it
  // is quarantined rather than believed. A key cannot be both wanted and
  // a deal breaker: wants win. The UI blocks that, but the UI is not the
  // security boundary.
  const breakerRow = Array.isArray(c.deal_breakers) ? c.deal_breakers : [];
  const breakers = setFrom(breakerRow, BREAKER_CHIPS, BREAKER_CHIPS.length)
    .filter((k) => must.indexOf(k) === -1 && nice.indexOf(k) === -1);

  const quarantined = setFrom(
    [].concat(Array.isArray(c.legacy_breakers) ? c.legacy_breakers : [], breakerRow),
    LEGACY_BREAKER_KEYS, LEGACY_BREAKER_KEYS.length
  );

  // ---- rent ----
  const rent = num(c.rent_max);
  const stretch = num(c.rent_stretch);

  // ---- beds: a set, with the v2 beds_min floor migrated in ----
  let beds = setFrom(c.beds, BED_SIZES, BED_SIZES.length);
  if (!beds.length) {
    const floor = num(c.beds_min);
    if (floor !== null) {
      // beds_min:0 means studio-and-up; beds_min:2 means 2,3,4plus.
      const startIdx = floor <= 0 ? 0 : Math.min(Math.round(floor), 4);
      beds = BED_SIZES.slice(startIdx);
    }
  }

  // ---- move-in window ----
  const earliest = isoDate(c.move_in_earliest);
  let latest = isoDate(c.move_in_latest);
  if (!latest) latest = isoDate(c.move_in_by); // v2

  return {
    rent_max: rent && rent > 0 ? Math.round(rent) : null,
    rent_stretch: stretch && stretch > 0 ? Math.round(stretch) : null,
    rent_basis: pickFrom(c.rent_basis, RENT_BASIS),
    beds: beds,
    baths_min: num(c.baths_min),
    unit_types: setFrom(c.unit_types, UNIT_TYPES, UNIT_TYPES.length),
    move_in_earliest: earliest,
    move_in_latest: latest,
    lease_terms: setFrom(c.lease_terms, LEASE_TERMS, LEASE_TERMS.length),
    household_adults: int(c.household_adults, 12),
    household_kids: int(c.household_kids, 12),
    pets: sanitizePets(c.pets),
    voucher: c.voucher === true || c.voucher === "1" || c.voucher === 1,
    voucher_program: str(c.voucher_program, 40),
    must_have: must,
    nice_to_have: nice,
    deal_breakers: breakers,
    // Preserved, never matched on. Present means this search predates
    // the #44 fix and the renter should be re-asked.
    legacy_breakers: quarantined,
    notes: str(c.notes, NOTES_MAX),
    transcript_excerpt: str(c.transcript_excerpt || c.transcript, TRANSCRIPT_EXCERPT_MAX)
  };
}

function criteriaIsEmpty(c) {
  if (!c) return true;
  if (c.rent_max) return false;
  if ((c.beds || []).length) return false;
  if (c.baths_min !== null) return false;
  if ((c.unit_types || []).length) return false;
  if (c.move_in_earliest || c.move_in_latest) return false;
  if ((c.lease_terms || []).length) return false;
  if (c.household_adults !== null || c.household_kids !== null) return false;
  if ((c.pets || []).length) return false;
  if (c.voucher) return false;
  if ((c.must_have || []).length) return false;
  if ((c.nice_to_have || []).length) return false;
  if ((c.deal_breakers || []).length) return false;
  if ((c.legacy_breakers || []).length) return false;
  if (c.notes) return false;
  if (c.transcript_excerpt) return false;
  return true;
}

function newId() {
  return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// DERIVED id for a stored search that has none. Must be a pure function
// of the content, or the id changes on every read and delete breaks.
// Never used for new searches from the card - those get newId().
function derivedId(criteria, created, name) {
  const seed = JSON.stringify(criteria || {}) + "|" + (created || "") + "|" + (name || "");
  return "lg" + crypto.createHash("sha1").update(seed).digest("hex").slice(0, 12);
}

function bedsLabel(beds) {
  if (!beds || !beds.length) return "";
  if (beds.length === 1) return beds[0] === "studio" ? "Studio" : beds[0] + "BR";
  const first = beds[0] === "studio" ? "Studio" : beds[0] + "BR";
  const last = beds[beds.length - 1];
  return first + "-" + (last === "4plus" ? "4+" : last) + "BR";
}

function autoName(c) {
  const bits = [];
  const b = bedsLabel(c.beds);
  if (b) bits.push(b);
  if ((c.unit_types || []).length === 1) bits.push(c.unit_types[0]);
  if (c.rent_max) bits.push("under $" + c.rent_max);
  if (!bits.length && (c.must_have || []).length) bits.push(c.must_have[0].split("_").join(" "));
  if (!bits.length && (c.nice_to_have || []).length) bits.push(c.nice_to_have[0].split("_").join(" "));
  return bits.length ? bits.join(" ") : "My search";
}

function sanitizeSearch(raw, fallbackCreated) {
  const s = raw && typeof raw === "object" ? raw : {};
  const criteria = sanitizeCriteria(s.criteria);
  const nowIso = new Date().toISOString();
  let name = str(s.name, 40);
  if (!name) name = autoName(criteria);
  return {
    id: typeof s.id === "string" && s.id ? s.id.slice(0, 24) : newId(),
    name: name,
    created: typeof s.created === "string" && s.created ? s.created.slice(0, 30) : (fallbackCreated || nowIso),
    updated: nowIso,
    enabled: s.enabled === false ? false : true,
    source: pickFrom(s.source, SOURCES) || "form",
    criteria: criteria
  };
}

// ------------------------------------------------------------------
// CONSENT. Both default FALSE. An absent value is not consent, and a
// consent that was never explicitly granted is never inferred from the
// presence of a search.
// ------------------------------------------------------------------
function sanitizeConsent(raw, existing) {
  const r = raw && typeof raw === "object" ? raw : null;
  const prev = existing && typeof existing === "object" ? existing : {};

  if (!r) {
    return {
      platform: prev.platform === true,
      off_platform: prev.off_platform === true,
      recorded_at: typeof prev.recorded_at === "string" ? prev.recorded_at.slice(0, 30) : null
    };
  }

  const platform = r.platform === true || r.platform === "1" || r.platform === 1;
  const off = r.off_platform === true || r.off_platform === "1" || r.off_platform === 1;
  const changed = platform !== (prev.platform === true) || off !== (prev.off_platform === true);

  return {
    platform: platform,
    off_platform: off,
    recorded_at: changed
      ? new Date().toISOString()
      : (typeof prev.recorded_at === "string" ? prev.recorded_at.slice(0, 30) : null)
  };
}

// ------------------------------------------------------------------
// READ. Handles v3, v2 array shape, and the ap-v3-era bare object.
// Migration is computed on read, persisted only on the next write.
// ------------------------------------------------------------------
function parseStored(rawStr, consentAt) {
  let o = null;
  try { o = JSON.parse(rawStr || "{}"); } catch (e) { o = null; }
  if (!o || typeof o !== "object") {
    return { searches: [], consent: sanitizeConsent(null, null), migrated: false, fromVersion: null };
  }

  const fromVersion = Number(o.v) || null;
  const consent = sanitizeConsent(null, o.consent);

  if (Array.isArray(o.searches)) {
    const searches = o.searches
      .filter((s) => s && typeof s === "object")
      .slice(0, MAX_SEARCHES)
      .map((s) => {
        const criteria = sanitizeCriteria(s.criteria);
        const name = String(s.name || "My search").slice(0, 40);
        const created = String(s.created || consentAt || "").slice(0, 30);
        return {
          // Derived, not random, when storage has no id. A random id here
          // changes on every read and breaks delete.
          id: String(s.id || derivedId(criteria, created, name)).slice(0, 24),
          name: name,
          created: created,
          updated: String(s.updated || "").slice(0, 30),
          enabled: s.enabled === false ? false : true,
          source: pickFrom(s.source, SOURCES) || "form",
          criteria: criteria
        };
      });
    return {
      searches: searches,
      consent: consent,
      // v2 records read fine but are shaped as v3 on the way out, so the
      // next write upgrades them.
      migrated: fromVersion !== SCHEMA_VERSION,
      fromVersion: fromVersion
    };
  }

  // Legacy ap-v3-era: bare criteria object, no searches key.
  const legacy = sanitizeCriteria(o);
  if (criteriaIsEmpty(legacy)) {
    return { searches: [], consent: consent, migrated: false, fromVersion: fromVersion };
  }

  const legacyName = autoName(legacy);
  const legacyCreated = consentAt || "";
  return {
    searches: [{
      id: derivedId(legacy, legacyCreated, legacyName),
      name: legacyName,
      created: legacyCreated || new Date().toISOString(),
      updated: legacyCreated || new Date().toISOString(),
      enabled: true,
      source: "form",
      criteria: legacy
    }],
    consent: consent,
    migrated: true,
    fromVersion: fromVersion
  };
}

// ------------------------------------------------------------------
// DEMAND INDEX. getStore() does not throw on creation, only on read and
// write, so siteID and token go in explicitly upfront.
// The Blob is also where the FULL verbatim transcript lives, because it
// has no column limit and BD's text column does.
// ------------------------------------------------------------------
function demandStore() {
  return getStore({
    name: DEMAND_STORE,
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN
  });
}

async function indexMember(memberId, enabled, consent, searches, transcripts) {
  try {
    const s = demandStore();
    await s.setJSON("m:" + memberId, {
      memberId: String(memberId),
      enabled: !!enabled,
      consent: consent,
      searchCount: searches.length,
      searches: searches,
      transcripts: transcripts || {},
      updated: new Date().toISOString()
    });

    let idx = null;
    try { idx = await s.get("index", { type: "json" }); } catch (e) { idx = null; }
    if (!Array.isArray(idx)) idx = [];
    if (idx.indexOf(String(memberId)) === -1) {
      idx.push(String(memberId));
      await s.setJSON("index", idx);
    }
  } catch (e) {
    // Indexing is bookkeeping. It must never fail a member's save.
    console.log("[ap] demand index skipped: " + e.message);
  }
}

// ------------------------------------------------------------------
async function writeSearches(memberId, enabled, consent, searches, transcripts) {
  const payload = JSON.stringify({
    v: SCHEMA_VERSION,
    consent: consent,
    searches: searches
  });

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
  // which is a live risk now that v3 carries more per search.
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

  if (landed) await indexMember(memberId, enabled, consent, searches, transcripts);

  return { landed, truncated, w, payloadLength: payload.length, gotLength: gotCriteria.length, member };
}

// ------------------------------------------------------------------
function schemaBlock() {
  return {
    schemaVersion: SCHEMA_VERSION,
    maxSearches: MAX_SEARCHES,
    mustHaveCap: MUST_HAVE_CAP,
    notesMax: NOTES_MAX,
    transcriptExcerptMax: TRANSCRIPT_EXCERPT_MAX,
    positiveChips: POSITIVE_CHIPS,
    breakerChips: BREAKER_CHIPS,
    breakerAccepted: BREAKER_ACCEPTED,
    legacyBreakerKeys: LEGACY_BREAKER_KEYS,
    legacyBreakersQuarantined: true,
    bedSizes: BED_SIZES,
    unitTypes: UNIT_TYPES,
    leaseTerms: LEASE_TERMS,
    rentBasis: RENT_BASIS,
    petSpecies: PET_SPECIES,
    sources: SOURCES,
    consentKeys: ["platform", "off_platform"]
  };
}

// ------------------------------------------------------------------
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };

  const q = event.queryStringParameters || {};

  if (q.version) {
    return json(200, {
      version: FN_VERSION,
      schemaVersion: SCHEMA_VERSION,
      bdBase: BD_BASE,
      bdApiKeyConfigured: !!process.env.BD_API_KEY,
      bdApiKeyLength: (process.env.BD_API_KEY || "").length,
      authHeader: "X-Api-Key",
      bodyEncoding: "x-www-form-urlencoded",
      maxSearches: MAX_SEARCHES,
      mustHaveCap: MUST_HAVE_CAP,
      acceptsV2Payloads: true,
      blobsConfigured: !!(process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN)
    });
  }

  // Vocabulary source of truth. No auth: it is a list of chip keys, and
  // every consumer needs it. One definition beats three copies.
  if (q.schema) {
    return json(200, Object.assign({ version: FN_VERSION }, schemaBlock()));
  }

  if (!process.env.BD_API_KEY) {
    return json(500, { version: FN_VERSION, error: "BD_API_KEY not configured" });
  }

  const id = String(q.memberId || "").replace(/[^0-9]/g, "");

  // ---- admin demand report ----
  if (q.report) {
    const adminKey = process.env.ADMIN_PROBE_KEY || "";
    if (!adminKey || String(q.key || "") !== adminKey) {
      return json(403, { version: FN_VERSION, error: "bad key" });
    }

    const s = demandStore();
    let idx = [];
    try { idx = (await s.get("index", { type: "json" })) || []; } catch (e) { idx = []; }
    if (!Array.isArray(idx)) idx = [];

    const limit = Math.max(1, Math.min(500, Number(q.limit || 200)));
    const members = [];

    const mustCount = {};
    const niceCount = {};
    const breakerCount = {};
    const legacyBreakerCount = {};
    const needsBreakerReview = [];
    const bedCount = {};
    const unitCount = {};
    const leaseCount = {};
    const rents = [];
    const moveIns = [];
    const notes = [];
    const transcripts = [];

    let totalSearches = 0;
    let activeMembers = 0;
    let voucherMembers = 0;
    let petMembers = 0;
    let consentPlatform = 0;
    let consentOffPlatform = 0;
    let voiceSearches = 0;

    const bump = (obj, k) => { obj[k] = (obj[k] || 0) + 1; };

    for (const mid of idx.slice(0, limit)) {
      let rec = null;
      try { rec = await s.get("m:" + mid, { type: "json" }); } catch (e) { rec = null; }
      if (!rec) continue;

      members.push(rec);
      if (rec.enabled) activeMembers += 1;
      if (rec.consent && rec.consent.platform) consentPlatform += 1;
      if (rec.consent && rec.consent.off_platform) consentOffPlatform += 1;

      let memberHasVoucher = false;
      let memberHasPet = false;
      let memberHasLegacyBreakers = false;

      for (const sr of rec.searches || []) {
        totalSearches += 1;
        if (sr.source === "voice") voiceSearches += 1;

        const c = sr.criteria || {};
        if (c.rent_max) rents.push(c.rent_max);
        if (c.move_in_latest) moveIns.push(c.move_in_latest);
        if (c.notes) notes.push({ memberId: rec.memberId, searchName: sr.name, note: c.notes });
        if (c.voucher) memberHasVoucher = true;
        if ((c.pets || []).length) memberHasPet = true;

        for (const k of c.must_have || []) bump(mustCount, k);
        for (const k of c.nice_to_have || []) bump(niceCount, k);
        for (const k of c.deal_breakers || []) bump(breakerCount, k);
        for (const k of c.legacy_breakers || []) {
          bump(legacyBreakerCount, k);
          memberHasLegacyBreakers = true;
        }
        for (const k of c.beds || []) bump(bedCount, k);
        for (const k of c.unit_types || []) bump(unitCount, k);
        for (const k of c.lease_terms || []) bump(leaseCount, k);
      }

      if (memberHasVoucher) voucherMembers += 1;
      if (memberHasPet) petMembers += 1;
      if (memberHasLegacyBreakers) needsBreakerReview.push(rec.memberId);

      // Full verbatim transcripts. The highest-value text on the
      // platform: renters describing in their own words what to go find.
      const t = rec.transcripts || {};
      for (const k of Object.keys(t)) {
        if (t[k]) transcripts.push({ memberId: rec.memberId, searchId: k, transcript: t[k] });
      }
    }

    rents.sort((a, b) => a - b);
    const pct = (p) => (rents.length ? rents[Math.min(rents.length - 1, Math.floor(rents.length * p))] : null);

    const rank = (obj) => Object.keys(obj)
      .map((k) => ({ key: k, count: obj[k] }))
      .sort((a, b) => b.count - a.count);

    return json(200, {
      version: FN_VERSION,
      schemaVersion: SCHEMA_VERSION,
      indexedMembers: idx.length,
      returned: members.length,
      membersWithAlertsOn: activeMembers,
      totalSearches: totalSearches,
      searchesFromVoice: voiceSearches,
      consent: {
        platform: consentPlatform,
        offPlatform: consentOffPlatform
      },
      rentCeiling: {
        count: rents.length,
        min: rents.length ? rents[0] : null,
        p25: pct(0.25),
        median: pct(0.5),
        p75: pct(0.75),
        max: rents.length ? rents[rents.length - 1] : null
      },
      bedDemand: rank(bedCount),
      unitTypeDemand: rank(unitCount),
      leaseTermDemand: rank(leaseCount),
      mustHaveDemand: rank(mustCount),
      niceToHaveDemand: rank(niceCount),
      dealBreakerDemand: rank(breakerCount),
      // #44 fallout. These searches carry positive keys on the old
      // deal-breaker row; the intent is unrecoverable and the matcher
      // ignores them. Re-ask these renters.
      legacyBreakerKeysSeen: rank(legacyBreakerCount),
      membersNeedingBreakerReview: needsBreakerReview,
      voucherMembers: voucherMembers,
      membersWithPets: petMembers,
      moveInDates: moveIns.sort(),
      freeTextNotes: notes,
      voiceTranscripts: transcripts,
      members: members
    });
  }

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
      schemaVersion: SCHEMA_VERSION,
      enabled: String(member.alerts_enabled || "0") === "1",
      maxSearches: MAX_SEARCHES,
      mustHaveCap: MUST_HAVE_CAP,
      storedVersion: parsed.fromVersion,
      migratedOnRead: parsed.migrated,
      consent: parsed.consent,
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
    // Deleting a search does not revoke consent. Consent is a separate
    // decision and is only changed when the member changes it.
    const r = await writeSearches(pid, stillEnabled, parsed.consent, kept, null);

    return json(200, {
      version: FN_VERSION,
      landed: r.landed,
      deleted: target,
      enabled: stillEnabled,
      consent: parsed.consent,
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

  // Read current state first, so consent that is not being changed is
  // preserved rather than reset, and so a v2 record upgrades cleanly.
  const { member: existingMember } = await getMember(pid);
  const existing = existingMember
    ? parseStored(existingMember.alerts_criteria, existingMember.alerts_consent_at)
    : { consent: sanitizeConsent(null, null), searches: [] };

  const clean = incoming
    .map((s) => sanitizeSearch(s, null))
    .filter((s) => !criteriaIsEmpty(s.criteria));

  // Full verbatim transcripts go to the Blob, keyed by search id. The
  // excerpt inside criteria is for matching context only; this is the
  // record. Structure never overwrites the transcript.
  const transcripts = {};
  for (let i = 0; i < incoming.length; i++) {
    const src = incoming[i] || {};
    const full = typeof src.transcript_full === "string" ? src.transcript_full.slice(0, 4000) : "";
    if (full && clean[i]) transcripts[clean[i].id] = full;
  }

  const consent = sanitizeConsent(payload.consent, existing.consent);
  const enabled = payload.enabled === false ? false : clean.some((s) => s.enabled);

  const r = await writeSearches(pid, enabled, consent, clean, transcripts);

  return json(200, {
    version: FN_VERSION,
    schemaVersion: SCHEMA_VERSION,
    landed: r.landed,
    enabled: enabled,
    maxSearches: MAX_SEARCHES,
    mustHaveCap: MUST_HAVE_CAP,
    upgradedFrom: existing.fromVersion || null,
    consent: consent,
    searches: clean,
    debug: r.landed ? undefined : {
      truncated: r.truncated,
      sentLength: r.payloadLength,
      gotLength: r.gotLength,
      writeMethod: r.w.method,
      writeHttpStatus: r.w.res ? r.w.res.status : null,
      hint: r.truncated
        ? "alerts_criteria is truncating. Widen the column in BD Form Manager to long text. v3 carries more per search than v2 did."
        : "field name or value mismatch on read-back"
    }
  });
};
