// ==================================================================
// alerts-voice.js  —  av-v1
// Voice intake for Daily Listing Alerts. Transcript in, schema v3
// criteria out, with a confidence per field and an explicit list of
// what it could NOT determine.
//
// WHY THIS EXISTS. A renter talking for forty seconds gives us more
// usable criteria than a form they abandon at field seven, and the
// transcript itself is the highest-value text on the platform: renters
// describing in their own words what to go find.
//
// WHAT THIS IS NOT. It is not a save. It returns a PROPOSAL that the
// card renders into a pre-filled form for the renter to confirm or
// correct. The renter stays the author of their own criteria. Silent
// extraction that gets rent wrong sends thirty days of bad matches.
//
// THE ANTHROPIC API DOES NOT ACCEPT AUDIO. Transcription happens in the
// browser via the Web Speech API and arrives here as text. Swapping to
// Deepgram or Whisper later changes nothing in this file - it takes a
// transcript and does not care where the transcript came from.
//
// ------------------------------------------------------------------
// FOUR RULES THIS FILE ENFORCES
//
// 1. NEVER INVENT A VALUE THE RENTER DID NOT STATE. An omitted field is
//    silence, not a statement. Unstated fields come back null and are
//    named in unclear[]. The same principle Element Z locked for feed
//    mapping: silence is not a statement that a unit is unfurnished.
//
// 2. THE VOCABULARY COMES FROM ap-v6, NOT FROM HERE. Fetched from
//    ?schema=1 at cold start. A chip list copied into a second file is
//    exactly how Open Thread #44 happened - a key valid in one layer and
//    silently stripped in another. There is no local fallback copy on
//    purpose: if the schema cannot be read, this FAILS LOUD with a 502.
//    ap-v1 returned a plausible-looking default when its read failed and
//    cost most of a session.
//
// 3. THE MODEL NEVER SETS CONSENT. Consent is a human tap, per
//    recipient. A transcript saying "yeah send my info anywhere" is not
//    a recorded consent event. Any consent key in the model output is
//    discarded before it leaves this function.
//
// 4. EVERY EXTRACTED KEY IS RE-VALIDATED against the fetched vocabulary
//    before returning, so the model cannot introduce a key that ap-v6
//    would strip. Two layers, and ap-v6 sanitizes again on save.
//
// ------------------------------------------------------------------
// Endpoints:
//   GET  ?version=1
//   GET  ?selftest=1            - runs the offline extraction tests
//   POST { transcript, memberId? }
//        -> { version, criteria, confidence, unclear, suggested_name,
//             transcript_full, heard }
//
// Env:
//   ANTHROPIC_API_KEY   - required
//   SCHEMA_URL          - optional override for the ?schema=1 source
//   NETLIFY_SITE_ID / NETLIFY_BLOBS_TOKEN - rate limiter
// ==================================================================

const https = require("https");
const { getStore } = require("@netlify/blobs");

const FN_VERSION = "av-v1";
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1500;
const TRANSCRIPT_MAX = 4000;
const TRANSCRIPT_MIN = 12;
const RL_STORE = "alerts-voice-rl";
const RL_PER_HOUR = 20;

const SCHEMA_URL = process.env.SCHEMA_URL ||
  "https://renters-story-writer.netlify.app/.netlify/functions/alerts-prefs?schema=1";

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
// Small https helper. Node https, not fetch, matching every other
// function on this platform.
// ------------------------------------------------------------------
function request(urlStr, opts) {
  opts = opts || {};
  const method = opts.method || "GET";
  const headers = opts.headers || {};
  const payload = opts.payload || null;

  return new Promise((resolve) => {
    let u;
    try { u = new URL(urlStr); } catch (e) {
      return resolve({ ok: false, status: 0, raw: "", error: "bad url" });
    }
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);

    const req = https.request(
      { hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, headers },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          if (!ok) console.log(`[av] ${method} ${u.hostname} -> HTTP ${res.statusCode}; ${raw.slice(0, 300)}`);
          resolve({ ok, status: res.statusCode, raw });
        });
      }
    );
    req.on("error", (e) => {
      console.log(`[av] ${method} ${u.hostname} -> ERROR ${e.code || e.name}: ${e.message}`);
      resolve({ ok: false, status: 0, raw: "", error: (e.code || e.name) + ": " + e.message });
    });
    req.setTimeout(opts.timeout || 9000, () => {
      req.destroy();
      resolve({ ok: false, status: 0, raw: "", error: "timeout" });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// ------------------------------------------------------------------
// VOCABULARY. Fetched from ap-v6. Cached for the life of the container.
// NO LOCAL FALLBACK COPY, deliberately - see rule 2 in the header.
// ------------------------------------------------------------------
let SCHEMA_CACHE = null;

async function loadSchema() {
  if (SCHEMA_CACHE) return SCHEMA_CACHE;
  const res = await request(SCHEMA_URL, { timeout: 6000 });
  if (!res.ok) return null;
  let s = null;
  try { s = JSON.parse(res.raw); } catch (e) { return null; }
  if (!s || !Array.isArray(s.positiveChips) || !Array.isArray(s.bedSizes)) return null;
  SCHEMA_CACHE = s;
  return s;
}

// ------------------------------------------------------------------
// Rate limit. Per member when we have one, per IP otherwise. Fail OPEN
// if the limiter itself errors: losing a limit beats losing the renter.
// ------------------------------------------------------------------
async function rateLimited(key) {
  try {
    const store = getStore({
      name: RL_STORE,
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN
    });
    const bucket = "k:" + key + ":" + Math.floor(Date.now() / 3600000);
    let n = 0;
    try { n = Number(await store.get(bucket)) || 0; } catch (e) { n = 0; }
    if (n >= RL_PER_HOUR) return true;
    await store.set(bucket, String(n + 1));
    return false;
  } catch (e) {
    console.log("[av] rate limiter unavailable, failing open: " + e.message);
    return false;
  }
}

// ------------------------------------------------------------------
// THE PROMPT. Built from the fetched vocabulary so the model can only
// ever be told about keys that actually exist.
// ------------------------------------------------------------------
function buildPrompt(schema) {
  const list = (a) => a.join(", ");
  return [
    "You extract structured rental search criteria from a renter describing what they are looking for out loud.",
    "",
    "THE MOST IMPORTANT RULE: never invent a value the renter did not state or clearly imply.",
    "If they did not mention bathrooms, baths_min is null. If they did not mention a budget, rent_max is null.",
    "A guess that looks reasonable is worse than a null, because a wrong budget sends a month of wrong listings.",
    "When a field is missing or genuinely ambiguous, set it to null and add its name to unclear.",
    "",
    "Return ONLY a JSON object. No preamble, no markdown fences, no explanation.",
    "",
    "SHAPE:",
    "{",
    '  "criteria": {',
    '    "rent_max": number|null,',
    '    "rent_stretch": number|null,',
    '    "rent_basis": one of [' + list(schema.rentBasis) + '] or null,',
    '    "beds": [subset of: ' + list(schema.bedSizes) + '],',
    '    "baths_min": number|null,',
    '    "unit_types": [subset of: ' + list(schema.unitTypes) + '],',
    '    "move_in_earliest": "YYYY-MM-DD"|null,',
    '    "move_in_latest": "YYYY-MM-DD"|null,',
    '    "lease_terms": [subset of: ' + list(schema.leaseTerms) + '],',
    '    "household_adults": number|null,',
    '    "household_kids": number|null,',
    '    "pets": [ { "species": one of [' + list(schema.petSpecies) + '], "count": number, "weight_lbs": number|null, "note": string } ],',
    '    "voucher": true|false,',
    '    "voucher_program": string,',
    '    "must_have": [max ' + schema.mustHaveCap + ' of: ' + list(schema.positiveChips) + '],',
    '    "nice_to_have": [subset of: ' + list(schema.positiveChips) + '],',
    '    "deal_breakers": [subset of: ' + list(schema.breakerChips) + '],',
    '    "notes": string',
    "  },",
    '  "confidence": { "<field name>": "high"|"medium"|"low" },',
    '  "unclear": ["field names you could not determine or were ambiguous"],',
    '  "suggested_name": "short label under 40 chars, e.g. 2BR under $2200",',
    '  "heard": "one plain sentence summarising what you understood, in the renter\'s own framing"',
    "}",
    "",
    "GUIDANCE:",
    "- must_have is capped at " + schema.mustHaveCap + " and is for things the renter would TURN DOWN A PLACE OVER.",
    "  Only put something there if they said it in those terms (must, need, non-negotiable, deal breaker, has to have).",
    "  Everything else they mentioned positively goes in nice_to_have. When in doubt, nice_to_have.",
    "- Only mark must_have at all if the renter's language was clearly emphatic. Preferring something is not requiring it.",
    "- deal_breakers use the negative vocabulary above. 'No third floor walk-up' is stairs. 'Must have parking' is",
    "  a must_have of parking, NOT a deal breaker of no_parking. Do not encode the same idea on both sides.",
    "- A pet weight matters more than the species. If they say a 65 pound lab, weight_lbs is 65. If they say a big",
    "  dog with no number, weight_lbs is null and note carries their words.",
    "- rent_stretch only when they explicitly signal flexibility ('could go a bit higher for the right place').",
    "- rent_basis all_in only when they say utilities included or all in. Do not infer it from a round number.",
    "- Relative dates resolve against TODAY_IS below. 'Next month' means the first of next month as move_in_earliest",
    "  with move_in_latest at the end of that month. 'By September' is move_in_latest only.",
    "- voucher true only if they mention a voucher, Section 8, housing assistance or a subsidy.",
    "- notes carries anything real that no structured field holds: a school, a commute, a job start date, a reason.",
    "  Keep it in their own words. Do not editorialise and do not repeat what is already structured.",
    "- Location is NOT captured here. The renter already drew their search areas elsewhere. Ignore place names",
    "  for the structured fields, but if they named a neighbourhood or a landmark, put it in notes.",
    "- If the transcript is too short or too vague to extract anything, return empty arrays and nulls with every",
    "  field listed in unclear. Do not pad it out.",
    "",
    "TODAY_IS: " + new Date().toISOString().slice(0, 10)
  ].join("\n");
}

async function callClaude(transcript, schema) {
  const body = JSON.stringify({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: buildPrompt(schema),
    messages: [{ role: "user", content: "Transcript:\n\n" + transcript }]
  });

  const res = await request("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    payload: body,
    timeout: 9000
  });

  if (!res.ok) return { ok: false, error: "api http " + res.status, raw: res.raw.slice(0, 300) };

  let data = null;
  try { data = JSON.parse(res.raw); } catch (e) {
    return { ok: false, error: "api response not json" };
  }

  const text = (data.content || [])
    .filter((b) => b && b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return { ok: true, text: text };
}

// Strip fences and parse. The model is told not to fence; belt and braces.
function parseModelJson(text) {
  let t = String(text || "").trim();
  const fence = t.indexOf("```");
  if (fence !== -1) {
    t = t.slice(fence + 3);
    if (t.slice(0, 4).toLowerCase() === "json") t = t.slice(4);
    const close = t.lastIndexOf("```");
    if (close !== -1) t = t.slice(0, close);
    t = t.trim();
  }
  const open = t.indexOf("{");
  const shut = t.lastIndexOf("}");
  if (open === -1 || shut === -1 || shut <= open) return null;
  try { return JSON.parse(t.slice(open, shut + 1)); } catch (e) { return null; }
}

// ------------------------------------------------------------------
// RE-VALIDATION. The model output is untrusted input like any other.
// Every key is checked against the fetched vocabulary so nothing can
// reach the card that ap-v6 would strip on save.
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
  return max !== undefined && i > max ? max : i;
}
function str(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function pick(v, list) {
  return typeof v === "string" && list.indexOf(v) !== -1 ? v : null;
}
function set(raw, list, cap) {
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
  if (s.length !== 10) return null;
  for (let i = 0; i < 10; i++) {
    const ch = s.charCodeAt(i);
    if (i === 4 || i === 7) { if (ch !== 45) return null; continue; }
    if (ch < 48 || ch > 57) return null;
  }
  return s;
}

function validate(out, schema) {
  const c = (out && out.criteria && typeof out.criteria === "object") ? out.criteria : {};
  const dropped = [];

  const noteDropped = (field, raw, kept) => {
    const arr = Array.isArray(raw) ? raw : [];
    for (const k of arr) if (kept.indexOf(k) === -1) dropped.push(field + ":" + k);
  };

  const must = set(c.must_have, schema.positiveChips, schema.mustHaveCap);
  noteDropped("must_have", c.must_have, must);

  // Overflow past the cap is not thrown away, it becomes nice-to-have.
  const overflow = (Array.isArray(c.must_have) ? c.must_have : []).filter((k) => must.indexOf(k) === -1);
  const nice = set([].concat(Array.isArray(c.nice_to_have) ? c.nice_to_have : [], overflow),
    schema.positiveChips, schema.positiveChips.length)
    .filter((k) => must.indexOf(k) === -1);

  const breakers = set(c.deal_breakers, schema.breakerChips, schema.breakerChips.length)
    .filter((k) => must.indexOf(k) === -1 && nice.indexOf(k) === -1);
  noteDropped("deal_breakers", c.deal_breakers, breakers);

  const beds = set(c.beds, schema.bedSizes, schema.bedSizes.length);
  noteDropped("beds", c.beds, beds);

  const unitTypes = set(c.unit_types, schema.unitTypes, schema.unitTypes.length);
  noteDropped("unit_types", c.unit_types, unitTypes);

  const leaseTerms = set(c.lease_terms, schema.leaseTerms, schema.leaseTerms.length);
  noteDropped("lease_terms", c.lease_terms, leaseTerms);

  const pets = [];
  for (const p of (Array.isArray(c.pets) ? c.pets : []).slice(0, 4)) {
    if (!p || typeof p !== "object") continue;
    const species = pick(p.species, schema.petSpecies);
    if (!species) { dropped.push("pets:" + String(p.species).slice(0, 20)); continue; }
    pets.push({
      species: species,
      count: int(p.count, 6) || 1,
      weight_lbs: int(p.weight_lbs, 400),
      note: str(p.note, 60)
    });
  }

  const rent = num(c.rent_max);
  const stretch = num(c.rent_stretch);

  const criteria = {
    rent_max: rent && rent > 0 ? Math.round(rent) : null,
    rent_stretch: stretch && stretch > 0 ? Math.round(stretch) : null,
    rent_basis: pick(c.rent_basis, schema.rentBasis),
    beds: beds,
    baths_min: num(c.baths_min),
    unit_types: unitTypes,
    move_in_earliest: isoDate(c.move_in_earliest),
    move_in_latest: isoDate(c.move_in_latest),
    lease_terms: leaseTerms,
    household_adults: int(c.household_adults, 12),
    household_kids: int(c.household_kids, 12),
    pets: pets,
    voucher: c.voucher === true,
    voucher_program: str(c.voucher_program, 40),
    must_have: must,
    nice_to_have: nice,
    deal_breakers: breakers,
    notes: str(c.notes, schema.notesMax || 400)
  };

  // Confidence, only for fields that exist, only with valid values.
  const conf = {};
  const rawConf = (out && out.confidence && typeof out.confidence === "object") ? out.confidence : {};
  for (const k of Object.keys(criteria)) {
    const v = pick(rawConf[k], ["high", "medium", "low"]);
    if (v) conf[k] = v;
  }

  // Anything null or empty that the model did not already flag gets
  // flagged here. The card shows these as "not captured", which is what
  // turns a wrong extraction into a two-second correction.
  const unclear = [];
  const seen = {};
  for (const k of (Array.isArray(out && out.unclear) ? out.unclear : [])) {
    const key = str(k, 40);
    if (key && Object.prototype.hasOwnProperty.call(criteria, key) && !seen[key]) {
      seen[key] = true; unclear.push(key);
    }
  }
  const isEmpty = (v) => v === null || v === "" || v === false || (Array.isArray(v) && !v.length);
  for (const k of Object.keys(criteria)) {
    if (k === "notes" || k === "voucher_program" || k === "rent_stretch") continue;
    if (isEmpty(criteria[k]) && !seen[k]) { seen[k] = true; unclear.push(k); }
  }

  return {
    criteria: criteria,
    confidence: conf,
    unclear: unclear,
    droppedKeys: dropped,
    suggested_name: str(out && out.suggested_name, 40),
    heard: str(out && out.heard, 240)
  };
}

// ------------------------------------------------------------------
// Offline self-test. Exercises validate() against fixtures shaped like
// real model output, including hostile ones. No API key needed.
// ------------------------------------------------------------------
const TEST_SCHEMA = {
  mustHaveCap: 3,
  notesMax: 400,
  positiveChips: ["parking", "yard", "furnished", "pets_dog", "washer_dryer_in_unit", "dishwasher", "pool", "gym", "balcony"],
  breakerChips: ["stairs", "no_parking", "no_pets_allowed", "basement_unit"],
  bedSizes: ["studio", "1", "2", "3", "4plus"],
  unitTypes: ["apartment", "house", "townhouse", "condo", "duplex", "room"],
  leaseTerms: ["12mo", "month_to_month", "short_term", "flexible"],
  rentBasis: ["all_in", "plus_utilities"],
  petSpecies: ["dog", "cat", "other"]
};

function selftest() {
  const results = [];
  const check = (name, cond, detail) => results.push({ name, pass: !!cond, detail: cond ? undefined : detail });

  // 1. clean extraction survives intact
  let v = validate({
    criteria: {
      rent_max: 2200, beds: ["2"], baths_min: 1, unit_types: ["apartment"],
      move_in_latest: "2026-09-01", must_have: ["parking"], nice_to_have: ["dishwasher"],
      deal_breakers: ["stairs"], pets: [{ species: "dog", count: 1, weight_lbs: 65, note: "lab" }],
      notes: "close to the light rail"
    },
    confidence: { rent_max: "high", baths_min: "low" },
    unclear: ["lease_terms"],
    suggested_name: "2BR under $2200",
    heard: "Two bedroom apartment under 2200 by September"
  }, TEST_SCHEMA);
  check("clean rent kept", v.criteria.rent_max === 2200, v.criteria.rent_max);
  check("clean must kept", v.criteria.must_have.join() === "parking", v.criteria.must_have);
  check("pet weight kept", v.criteria.pets[0].weight_lbs === 65, v.criteria.pets);
  check("confidence kept", v.confidence.rent_max === "high" && v.confidence.baths_min === "low", v.confidence);
  check("name kept", v.suggested_name === "2BR under $2200", v.suggested_name);

  // 2. invented chip keys are dropped and reported
  v = validate({ criteria: { must_have: ["parking", "rooftop_helipad"], deal_breakers: ["haunted"] } }, TEST_SCHEMA);
  check("invented want dropped", v.criteria.must_have.join() === "parking", v.criteria.must_have);
  check("invented breaker dropped", v.criteria.deal_breakers.length === 0, v.criteria.deal_breakers);
  check("drops reported", v.droppedKeys.length === 2, v.droppedKeys);

  // 3. must_have cap enforced, overflow demoted not lost
  v = validate({ criteria: { must_have: ["parking", "yard", "furnished", "pool", "gym"] } }, TEST_SCHEMA);
  check("cap 3", v.criteria.must_have.length === 3, v.criteria.must_have);
  check("overflow demoted", v.criteria.nice_to_have.indexOf("pool") !== -1 && v.criteria.nice_to_have.indexOf("gym") !== -1, v.criteria.nice_to_have);

  // 4. same idea on both sides: wants win
  v = validate({ criteria: { must_have: ["parking"], deal_breakers: ["parking"] } }, TEST_SCHEMA);
  check("no double encode", v.criteria.must_have.length === 1 && v.criteria.deal_breakers.length === 0, v.criteria);

  // 5. nothing invented from an empty extraction
  v = validate({ criteria: {} }, TEST_SCHEMA);
  check("empty rent null", v.criteria.rent_max === null, v.criteria.rent_max);
  check("empty voucher false", v.criteria.voucher === false, v.criteria.voucher);
  check("empty household null", v.criteria.household_adults === null, v.criteria.household_adults);
  check("empty flags many unclear", v.unclear.length >= 10, v.unclear.length);

  // 6. junk types do not crash or leak
  v = validate({ criteria: { rent_max: "lots", baths_min: -3, beds: "two", pets: "a dog", notes: 42, voucher: "yes" } }, TEST_SCHEMA);
  check("junk rent null", v.criteria.rent_max === null, v.criteria.rent_max);
  check("negative baths null", v.criteria.baths_min === null, v.criteria.baths_min);
  check("string beds ignored", v.criteria.beds.length === 0, v.criteria.beds);
  check("string pets ignored", v.criteria.pets.length === 0, v.criteria.pets);
  check("number notes ignored", v.criteria.notes === "", v.criteria.notes);
  check("truthy-string voucher rejected", v.criteria.voucher === false, v.criteria.voucher);

  // 7. bad dates rejected rather than guessed
  v = validate({ criteria: { move_in_earliest: "next month", move_in_latest: "2026-9-1" } }, TEST_SCHEMA);
  check("prose date null", v.criteria.move_in_earliest === null, v.criteria.move_in_earliest);
  check("malformed date null", v.criteria.move_in_latest === null, v.criteria.move_in_latest);

  // 8. model cannot set consent or smuggle extra fields
  v = validate({ criteria: { consent: { platform: true }, alerts_enabled: "1", rent_max: 1500 } }, TEST_SCHEMA);
  check("no consent key", v.criteria.consent === undefined, Object.keys(v.criteria));
  check("no smuggled field", v.criteria.alerts_enabled === undefined, Object.keys(v.criteria));

  // 9. fence stripping
  check("fenced json parses", !!parseModelJson('```json\n{"criteria":{"rent_max":1500}}\n```'), null);
  check("bare json parses", !!parseModelJson('{"criteria":{}}'), null);
  check("preamble tolerated", !!parseModelJson('Here you go:\n{"criteria":{}}'), null);
  check("garbage returns null", parseModelJson("no json at all") === null, null);
  check("empty returns null", parseModelJson("") === null, null);

  // 10. unclear list cannot be polluted with non-fields
  v = validate({ criteria: { rent_max: 1500 }, unclear: ["rent_max", "the_vibe", "beds", "beds"] }, TEST_SCHEMA);
  check("unclear only real fields", v.unclear.indexOf("the_vibe") === -1, v.unclear);
  check("unclear deduped", v.unclear.filter((x) => x === "beds").length === 1, v.unclear);

  const passed = results.filter((r) => r.pass).length;
  return { total: results.length, passed, failed: results.length - passed, results: results.filter((r) => !r.pass) };
}

// ------------------------------------------------------------------
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };

  const q = event.queryStringParameters || {};

  if (q.version) {
    return json(200, {
      version: FN_VERSION,
      model: MODEL,
      schemaUrl: SCHEMA_URL,
      apiKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
      blobsConfigured: !!(process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN),
      transcriptMax: TRANSCRIPT_MAX,
      rateLimitPerHour: RL_PER_HOUR,
      note: "vocabulary is read from alerts-prefs ?schema=1 at cold start; there is no local copy by design"
    });
  }

  if (q.selftest) {
    const t = selftest();
    return json(t.failed ? 500 : 200, { version: FN_VERSION, selftest: t });
  }

  if (event.httpMethod !== "POST") return json(405, { version: FN_VERSION, error: "method" });

  if (!process.env.ANTHROPIC_API_KEY) {
    return json(500, { version: FN_VERSION, error: "ANTHROPIC_API_KEY not configured" });
  }

  let payload = {};
  try { payload = JSON.parse(event.body || "{}"); } catch (e) {
    return json(400, { version: FN_VERSION, error: "bad json" });
  }

  const transcript = str(payload.transcript, TRANSCRIPT_MAX);
  if (transcript.length < TRANSCRIPT_MIN) {
    return json(400, {
      version: FN_VERSION,
      error: "transcript too short",
      hint: "Ask the renter to say a bit more, or let them type it instead."
    });
  }

  const memberId = String(payload.memberId || "").replace(/[^0-9]/g, "");
  const ip = (event.headers && (event.headers["x-nf-client-connection-ip"] || event.headers["client-ip"])) || "unknown";
  if (await rateLimited(memberId || ip)) {
    return json(429, { version: FN_VERSION, error: "rate limited", perHour: RL_PER_HOUR });
  }

  // FAIL LOUD. No local vocabulary fallback: a stale copy is how #44
  // happened, and a plausible default on a failed read is how ap-v1 cost
  // a session.
  const schema = await loadSchema();
  if (!schema) {
    return json(502, {
      version: FN_VERSION,
      error: "could not read the criteria schema",
      schemaUrl: SCHEMA_URL,
      hint: "alerts-prefs must be deployed at ap-v6 or later and answering ?schema=1"
    });
  }

  const call = await callClaude(transcript, schema);
  if (!call.ok) {
    return json(502, { version: FN_VERSION, error: call.error, detail: call.raw || null });
  }

  const parsed = parseModelJson(call.text);
  if (!parsed) {
    // Do not fabricate an extraction. Hand the transcript back so the
    // card can drop the renter into the normal form with their words in
    // the notes field rather than losing what they said.
    return json(200, {
      version: FN_VERSION,
      extracted: false,
      error: "could not read the extraction",
      transcript_full: transcript,
      hint: "Show the form with the transcript in notes and let the renter fill it in."
    });
  }

  const v = validate(parsed, schema);

  return json(200, {
    version: FN_VERSION,
    extracted: true,
    schemaVersion: schema.schemaVersion || null,
    criteria: v.criteria,
    confidence: v.confidence,
    unclear: v.unclear,
    droppedKeys: v.droppedKeys,
    suggested_name: v.suggested_name,
    heard: v.heard,
    // The verbatim record. The card posts this back as transcript_full
    // so ap-v6 files it in the demand Blob. Structure never replaces it.
    transcript_full: transcript,
    source: "voice",
    // Consent is a human tap. It is never inferred from speech, and this
    // function never returns one.
    consentHandling: "not set here; the card must ask"
  });
};
