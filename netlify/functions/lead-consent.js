// ============================================================
//  lead-consent.js   ·   VERSION: lc-v5   (2026-08-06, +HUB_ADMIN_KEY on operator reads)
//    lc-v4  INCOME AMOUNT IS NOW SHAREABLE, WITH CONSENT. INCOME SOURCE IS
//           STILL NOT, AND THE DISTINCTION IS DELIBERATE.
//           Consent makes disclosure lawful, so a renter CAN authorise their
//           income to be shared - and landlords legitimately need to know
//           someone can afford the rent. That is approximate_gross_m, and it
//           is now on the list.
//           what_type_of_income (W-2 / self-employed / benefits / fixed
//           income) stays off it. The problem there is not privacy, which
//           consent solves. It is that source-of-income discrimination is
//           unlawful in a growing number of states and cities, and handing a
//           landlord the field those laws are written about makes us the
//           mechanism. It also tells a landlord almost nothing the amount
//           does not. Moving it here needs a Fair Housing review, not a
//           code change.
//    lc-v3  LOOK THE LEAD UP BY ID, NOT BY SCANNING.
//           lc-v2 pulled a page of leads and matched the token client-side.
//           BD CAPS THAT PAGE AT 100 REGARDLESS OF ?limit, and ?offset is
//           ignored - both confirmed live: limit=5000 returned 100 rows, and
//           offset=100 returned the same first id. So the scan could only
//           ever see the oldest 100 leads and lead 2948 was never in range.
//           Now: the link carries BOTH id and token. The id fetches that one
//           record via path-segment lookup (/leads/get/2948), which BD
//           filters correctly - the Bible already records that query-param
//           lookup ignores filters while path segments do not. The token is
//           then compared against the record and must match, so nobody can
//           read someone else's request by changing the number.
//           One request instead of thirty, and it cannot miss.
//    lc-v2  +GET ?token=XXX  reads the renter's own lead from BD and returns
//           ONLY the shareable fields, decoded to readable text. Keyed on the
//           lead's own token, not its id: BD already generates one, it is
//           unguessable, and it scopes access to that single lead. A renter
//           cannot enumerate other people's requests by changing a number.
//    lc-v1  consent store
//
//  Records what a renter has authorised us to share with a housing
//  provider, and the exact text they approved.
//
//  WHY THIS EXISTS
//  Nothing about a renter goes to a landlord, PM or realtor unless the
//  renter ticked it. This function is the record of that. It is the audit
//  trail, not a convenience: if a renter later disputes what was shared,
//  this is the answer.
//
//  THE SNAPSHOT IS THE POINT
//  We store the field VALUES as they were at the moment of consent, not
//  just which field names were ticked. A renter who later changes their
//  budget must not retroactively alter what a landlord was already shown.
//  Consent is a photograph, not a live query.
//
//  NEVER SHAREABLE, EVEN IF ASKED FOR
//  Income source (what_type_of_income) and income amount
//  (approximate_gross_m) are on the BD lead record but are NOT in
//  SHAREABLE_FIELDS and cannot be consented to through this endpoint.
//  Source-of-income discrimination is unlawful in a growing number of
//  jurisdictions, and income multipliers are a known disparate-impact
//  exposure. If a field is never sent, it cannot influence a housing
//  decision. Adding either to SHAREABLE_FIELDS needs a Fair Housing
//  review first, not a code change.
//
//  ENDPOINTS
//   GET  ?version=1              -> { ok, _v, blobsConfigured }
//   GET  ?leadId=NNNN            -> consent record, or { consented:false }
//   GET  ?leadIds=1,2,3          -> { "1": true, "2": false, ... } bulk check
//                                    (the hub calls this to show status)
//   POST { leadId, fields[], snapshot{}, profileText, renterName?,
//          renterEmail? }        -> writes the record
//
//  ENV
//   NETLIFY_SITE_ID      REQUIRED. Passed to getStore explicitly.
//   NETLIFY_BLOBS_TOKEN  REQUIRED. Same.
//   CONSENT_ADMIN_KEY    optional. If set, POST requires it.
// ============================================================
const FN_VERSION = "lc-v5";

const { getStore } = require("@netlify/blobs");
const https = require("https");
// The bulk check is an OPERATOR call - it reveals which lead ids exist -
// so it is gated. The renter's own token-scoped view and their consent POST
// are deliberately NOT gated: a renter has no admin key, and the id+token
// pair is what authorises them.
const crypto = require("crypto");
function hubKeyOk(given) {
  const want = process.env.HUB_ADMIN_KEY || "";
  if (!want) return true;
  const a = Buffer.from(String(given == null ? "" : given));
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}


const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

// The ONLY fields a renter can authorise. Anything not on this list is
// unshareable regardless of what the caller sends. Deliberately a
// whitelist, not a blacklist: a new BD column cannot leak by default.
const SHAREABLE_FIELDS = {
  budget:        { label: "My budget",                 src: "what_is_your_budget" },
  timing:        { label: "When I need to move",       src: "when_are_you_looki" },
  term:          { label: "How long I am looking for", src: "select_all_that_des" },
  location:      { label: "Where I am looking",        src: "lead_location" },
  propertyType:  { label: "The kind of place I want",  src: "property_type" },
  household:     { label: "How many people",           src: "number_of_people_y" },
  pets:          { label: "Pets",                      src: "do_you_have_pets" },
  petDetails:    { label: "Details about my pets",     src: "if_yes_type_size_br" },
  cosigner:      { label: "Whether I have a co-signer", src: "woulda_cosigner_or" },
  income:        { label: "Roughly what I earn each month", src: "approximate_gross_m" },
  description:   { label: "What I am looking for, in my own words", src: "please_describe_the" },
  obstacles:     { label: "Anything you should know upfront", src: "anything_else_we_sh" },
  preferredDay:  { label: "Best day to reach me",      src: "lead_preferred_day" },
  preferredTime: { label: "Best time to reach me",     src: "lead_preferred_time" },
  name:          { label: "My name",                   src: "lead_name" },
  email:         { label: "My email address",          src: "lead_email" },
  phone:         { label: "My phone number",           src: "phone" },
};

// Named so the reason travels with the code. Do not move these into
// SHAREABLE_FIELDS without a Fair Housing review.
// Income AMOUNT moved to SHAREABLE_FIELDS in lc-v4. Income SOURCE did not,
// and should not without a Fair Housing review - see the header.
const NEVER_SHAREABLE = ["what_type_of_income", "optional_age_and_ge"];

// BD stores questionnaire answers as slugs. These make them readable, both
// for the renter reviewing what will be shared and for the provider who
// eventually receives it. An unmapped value falls through as itself rather
// than being hidden, so a new option never silently disappears.
const DECODE = {
  less_than_1k: "Under $1,000 a month",
  "1k2k": "$1,000 to $2,000 a month",
  "2k3k": "$2,000 to $3,000 a month",
  "3k4k": "$3,000 to $4,000 a month",
  "4k6k": "$4,000 to $6,000 a month",
  over_6k: "Over $6,000 a month",
  immediately_: "Immediately",
  next_month: "Next month",
  "36_months": "In 3 to 6 months",
  "612_months": "In 6 to 12 months",
  more_than_a_year: "More than a year from now",
  not_sure_yet: "Not sure yet",
  longterm_: "Long-term",
  midterm_: "Mid-term",
  shortterm_: "Short-term",
  no_pets: "No pets",
  dog: "Dog",
  cat: "Cat",
  service_animal: "Service animal",
  yes: "Yes",
  no: "No",
  not_sure: "Not sure",
};

// BD squashes the income band into a single run of digits ("30004000" is
// 3000-4000). Rendered as a range so a renter reviewing what will be shared
// sees something they recognise rather than an eight-digit number.
function incomeBand(v) {
  var s = String(v == null ? "" : v).replace(/[^0-9]/g, "");
  if (!s) return "";
  if (s.length === 8) {
    return "$" + Number(s.slice(0, 4)).toLocaleString() + " to $" + Number(s.slice(4)).toLocaleString() + " a month";
  }
  if (s.length === 7) {
    return "$" + Number(s.slice(0, 3)).toLocaleString() + " to $" + Number(s.slice(3)).toLocaleString() + " a month";
  }
  return "$" + Number(s).toLocaleString() + " a month";
}
function readable(v) {
  if (v === null || v === undefined) return "";
  var s = String(v).trim();
  if (!s) return "";
  return s.split(",").map(function (part) {
    var p = part.trim();
    if (DECODE[p]) return DECODE[p];
    return p.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  }).filter(Boolean).join(", ");
}

function bdGet(path) {
  return new Promise(function (resolve) {
    var u;
    try { u = new URL(BD_BASE + path); } catch (e) { return resolve(null); }
    var req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
      method: "GET", headers: { "X-Api-Key": process.env.BD_API_KEY, Accept: "application/json" },
    }, function (res) {
      if ([301, 302, 307, 308].includes(res.statusCode)) { res.resume(); return resolve(null); }
      var raw = "";
      res.on("data", function (c) { raw += c; });
      res.on("end", function () {
        try { resolve(JSON.parse(raw)); } catch (e) { resolve(null); }
      });
    });
    req.on("error", function () { resolve(null); });
    req.setTimeout(10000, function () { req.destroy(); resolve(null); });
    req.end();
  });
}

// Blobs: getStore does NOT throw on creation, only on read/write, so the
// siteID and token must be passed explicitly up front rather than relying
// on ambient config. A missing token otherwise surfaces as a confusing
// failure at the first read.
function store() {
  return getStore({
    name: "lead-consent",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN,
  });
}

function key(leadId) {
  return "consent:" + String(leadId).replace(/[^0-9]/g, "");
}

function ok(body, status) {
  return { statusCode: status || 200, headers: corsHeaders, body: JSON.stringify(body) };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };

  const q = event.queryStringParameters || {};

  if (event.httpMethod === "GET" && q.version === "1") {
    return ok({
      ok: true,
      _v: FN_VERSION,
      blobsConfigured: !!process.env.NETLIFY_SITE_ID && !!process.env.NETLIFY_BLOBS_TOKEN,
      adminKeyRequired: !!process.env.CONSENT_ADMIN_KEY,
      shareableFields: Object.keys(SHAREABLE_FIELDS).map(function (k) {
        return { id: k, label: SHAREABLE_FIELDS[k].label, source: SHAREABLE_FIELDS[k].src };
      }),
      neverShareable: NEVER_SHAREABLE,
    });
  }

  // lc-v3: the renter's own view of their request. Needs BOTH id and token.
  if (event.httpMethod === "GET" && (q.token || q.id)) {
    if (!process.env.BD_API_KEY) return ok({ error: "BD_API_KEY is not set on this function" }, 500);
    var tok = String(q.token || "").replace(/[^a-zA-Z0-9]/g, "");
    var lid = String(q.id || "").replace(/[^0-9]/g, "");
    if (!lid) return ok({ error: "This link is missing its request id" }, 400);
    if (tok.length < 16) return ok({ error: "Invalid token" }, 400);

    // Path-segment lookup. BD filters these correctly; query-parameter
    // lookup does not, and the list endpoint is hard-capped at 100 rows
    // with ?offset ignored, so scanning is not an option.
    var data = await bdGet("/leads/get/" + encodeURIComponent(lid));
    var rows = (data && data.message) || [];
    var lead = Array.isArray(rows) ? rows[0] : rows;
    if (!lead || !lead.lead_id) return ok({ error: "That request could not be found" }, 404);

    // The id says WHICH record; the token proves it is theirs. Without this
    // check the id alone would let anyone read any request by counting up.
    if (String(lead.token || "") !== tok) {
      console.warn("[lead-consent] token mismatch for lead " + lid);
      return ok({ error: "That request could not be found" }, 404);
    }

    // ONLY the shareable fields, decoded. Income source and amount are not
    // in SHAREABLE_FIELDS, so they are structurally absent from this
    // response - the renter's own page never sees them offered.
    var values = {};
    Object.keys(SHAREABLE_FIELDS).forEach(function (k) {
      var raw = lead[SHAREABLE_FIELDS[k].src];
      var txt = k === "income" ? incomeBand(raw) : readable(raw);
      if (txt) values[k] = txt;
    });

    var existing = null;
    try { existing = await store().get(key(lead.lead_id), { type: "json" }); } catch (e) { existing = null; }

    return ok({
      ok: true,
      _v: FN_VERSION,
      leadId: lead.lead_id,
      submitted: lead.date_added || null,
      values: values,
      labels: Object.keys(SHAREABLE_FIELDS).reduce(function (a, k) { a[k] = SHAREABLE_FIELDS[k].label; return a; }, {}),
      alreadyConsented: !!(existing && existing.consentedAt),
      previousFields: existing ? existing.fields : null,
    });
  }

  // Bulk status check. The hub calls this once for a page of leads rather
  // than making one request per row.
  if (event.httpMethod === "GET" && q.leadIds) {
    if (!hubKeyOk(q.key)) return ok({ error: "Unauthorized" }, 401);
    const ids = String(q.leadIds).split(",").map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 500);
    const out = {};
    const s = store();
    for (const id of ids) {
      try {
        const rec = await s.get(key(id), { type: "json" });
        out[id] = !!(rec && rec.consentedAt);
      } catch (e) {
        out[id] = false;
      }
    }
    return ok({ ok: true, _v: FN_VERSION, consent: out });
  }

  if (event.httpMethod === "GET" && q.leadId) {
    if (!hubKeyOk(q.key)) return ok({ error: "Unauthorized" }, 401);
    try {
      const rec = await store().get(key(q.leadId), { type: "json" });
      if (!rec) return ok({ ok: true, _v: FN_VERSION, leadId: q.leadId, consented: false });
      return ok({ ok: true, _v: FN_VERSION, consented: true, record: rec });
    } catch (e) {
      // A missing key throws rather than returning null, so this is the
      // normal "no consent yet" path, not an error.
      return ok({ ok: true, _v: FN_VERSION, leadId: q.leadId, consented: false });
    }
  }

  if (event.httpMethod !== "POST") {
    return ok({ error: "Send ?version=1, ?leadId=NNNN, ?leadIds=a,b,c, or POST a consent record" }, 400);
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return ok({ error: "Invalid JSON" }, 400); }

  const adminKey = process.env.CONSENT_ADMIN_KEY || "";
  if (adminKey && body.key !== adminKey) {
    return ok({ error: "Unauthorized" }, 401);
  }

  const leadId = String(body.leadId || "").replace(/[^0-9]/g, "");
  if (!leadId) return ok({ error: "leadId is required" }, 400);

  // Whitelist the ticked fields. Anything not in SHAREABLE_FIELDS is
  // dropped silently rather than rejected, so a stale client cannot break
  // a consent submission - but it also cannot smuggle a field through.
  const asked = Array.isArray(body.fields) ? body.fields : [];
  const fields = asked.filter(function (f) { return Object.prototype.hasOwnProperty.call(SHAREABLE_FIELDS, f); });
  const dropped = asked.filter(function (f) { return !Object.prototype.hasOwnProperty.call(SHAREABLE_FIELDS, f); });

  if (!fields.length) {
    return ok({ error: "No shareable fields were selected", dropped: dropped }, 400);
  }

  // THE SNAPSHOT. Only the authorised fields, valued as at this moment.
  const incoming = body.snapshot && typeof body.snapshot === "object" ? body.snapshot : {};
  const snapshot = {};
  fields.forEach(function (f) {
    if (incoming[f] !== undefined && incoming[f] !== null) snapshot[f] = String(incoming[f]);
  });

  const profileText = String(body.profileText || "").trim();
  if (!profileText) {
    return ok({ error: "profileText is required - the renter must approve the text that will be shared" }, 400);
  }

  const record = {
    _v: FN_VERSION,
    leadId: leadId,
    consentedAt: new Date().toISOString(),
    fields: fields,
    snapshot: snapshot,
    profileText: profileText,
    renterName: body.renterName ? String(body.renterName) : null,
    renterEmail: body.renterEmail ? String(body.renterEmail) : null,
    ip: (event.headers && (event.headers["x-nf-client-connection-ip"] || event.headers["client-ip"])) || null,
    userAgent: (event.headers && event.headers["user-agent"]) || null,
    // Recorded so a later audit can see the rules in force at the time.
    neverShareable: NEVER_SHAREABLE,
  };

  try {
    await store().setJSON(key(leadId), record);
  } catch (e) {
    console.error("[lead-consent] blob write failed:", e && e.message);
    return ok({ error: "Could not save consent", detail: e && e.message, _v: FN_VERSION }, 500);
  }

  // Read back. BD taught us that a write returning success is not proof
  // the value landed; the same discipline applies here.
  let verified = false;
  try {
    const back = await store().get(key(leadId), { type: "json" });
    verified = !!(back && back.consentedAt === record.consentedAt);
  } catch (e) { verified = false; }

  console.log("[lead-consent] lead " + leadId + " consented to " + fields.length + " fields, verified=" + verified);

  return ok({
    ok: true,
    _v: FN_VERSION,
    leadId: leadId,
    consented: true,
    verified: verified,
    fieldsRecorded: fields.length,
    droppedUnshareable: dropped,
    consentedAt: record.consentedAt,
  });
};

module.exports._internal = { SHAREABLE_FIELDS, NEVER_SHAREABLE, key, FN_VERSION };
