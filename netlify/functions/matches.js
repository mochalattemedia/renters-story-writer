// ============================================================
//  matches.js   ·   VERSION: mt-v1  (2026-08-14)
//
//  THE STORE BEHIND THE DECK. One member's matches, and what they did
//  with each one.
//
//  WHY THIS EXISTS AT ALL. app-deck.html has been a finished renderer
//  with four hardcoded listings since md-v11 - swipe, tiers, the criteria
//  strip, the reason-and-move panel, the booking sheet. What it never had
//  was anywhere to read from. This is that, and it is deliberately the
//  same shape a matcher will write when one exists, so nothing has to be
//  rebuilt when the fulfilment half arrives.
//
//  🔴 MATCHES ARE HAND-CURATED FOR NOW, AND THAT IS A FEATURE OF THE
//  SEQUENCING, NOT A PLACEHOLDER. There is no matcher: ~16 running spots,
//  ~42 live listings, no cron, and alerts@renters.com does not send. A
//  curated match is a real match - somebody checked the listing is live
//  and the renter clears the landlord's bar - which is exactly the claim
//  the deck makes on its face.
//
//  ENDPOINTS
//    GET  ?memberId=ID                 -> that member's live deck
//    GET  ?memberId=ID&all=1           -> including passed, for an audit
//    POST ?act=1  { memberId, matchId, action, secret }
//         action: pass | looked | booked | reset
//    POST ?admin=KEY { memberId, matches:[...] }   -> curate
//    GET  ?admin=KEY&audit=1           -> every member with matches
//    GET  ?version=1
//
//  🔑 A CURATED MATCH MUST CARRY hostId, propertyLabel AND city.
//  Without hostId the booking sheet cannot call showings.js at all - the
//  scheduler needs to know whose calendar it is. The other two are what
//  showings.js records on the booking, and a showing with no label is a
//  calendar entry nobody can identify a week later. Enforced on write
//  rather than discovered at booking time.
//
//  ⚖️ NOTES NEVER TRAVEL. The renter's own notes on a spot are operator
//  context - people write credit positions and children's schools in
//  there - and nothing in this file reads or carries them. Said once here
//  because the shape invites it: a match looks like a good place to
//  staple context onto.
// ============================================================

const { getStore } = require("@netlify/blobs");

const FN_VERSION = "mt-v1";
const STORE_NAME = "matches";
const ADMIN_KEY = process.env.RDC_ADMIN_KEY || "";

// The same light gate showings.js and availability.js use. It ships to the
// client, exactly as it already does on the booking page, and it belongs in
// an env var with the check server-side. Recorded, not quietly worked around.
const SECRET = "renters2026";

const MAX_MATCHES = 40;
const TIERS = ["strong", "moderate", "weak"];
const STATES = ["new", "passed", "looked", "booked"];

const cors = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
};

function json(status, obj) {
  return { statusCode: status, headers: cors, body: JSON.stringify(obj, null, 2) };
}

// getStore(name) does NOT throw on creation - only later, on read or write -
// so a try/catch fallback around it never fires. Pass config explicitly.
// This is the systemic Blobs bug that was swept across five functions.
function store() {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN;
  if (siteID && token) {
    return getStore({ name: STORE_NAME, consistency: "strong", siteID, token });
  }
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

const key = (id) => "m:" + String(id).replace(/[^0-9]/g, "");

// ---- sanitising -------------------------------------------------------

function str(v, max) {
  if (v === null || v === undefined) return "";
  return String(v).slice(0, max || 120);
}

function num(v) {
  const n = Number(v);
  return isFinite(n) && n >= 0 ? n : null;
}

// A criteria row is the landlord's stated requirement checked against this
// renter. state: y (met) | q (needs something) | n (unknown).
//
// ⚠️ "n" MEANS NOBODY HAS CONFIRMED IT, NOT THAT IT FAILS. The deck renders
// those grey rather than red for that reason. A hard fail should never be
// curated in the first place - hard no's do not render, which is the whole
// product in four words.
function cleanCriterion(c) {
  if (!c || typeof c !== "object") return null;
  const s = ["y", "q", "n"].indexOf(c.state) !== -1 ? c.state : "n";
  const label = str(c.label, 60);
  if (!label) return null;
  return { state: s, label, value: str(c.value, 60), note: str(c.note, 60) };
}

function cleanMatch(raw) {
  const m = raw && typeof raw === "object" ? raw : {};

  const tier = TIERS.indexOf(m.tier) !== -1 ? m.tier : "moderate";
  const hostId = String(m.hostId || "").replace(/[^0-9]/g, "");
  const label = str(m.propertyLabel || m.address, 80);

  // The three fields booking cannot proceed without. Rejected here so a
  // curation mistake surfaces now, not when a renter taps Book and the
  // scheduler returns nothing.
  if (!hostId) return { error: "hostId required (the landlord's member id)" };
  if (!label) return { error: "propertyLabel required" };
  if (!m.city) return { error: "city required" };

  const crit = Array.isArray(m.criteria)
    ? m.criteria.map(cleanCriterion).filter(Boolean).slice(0, 6)
    : [];

  // A moderate or weak match with no move is noise with a warning label.
  // The deck's whole argument is that a caveat without a next step is the
  // thing this product sells against, so the store refuses to hold one.
  const move = m.move && m.move.title && m.move.body
    ? { title: str(m.move.title, 60), body: str(m.move.body, 260) }
    : null;
  if (tier !== "strong" && !move) {
    return { error: "a " + tier + " match needs move.title and move.body" };
  }

  return {
    id: str(m.id, 40) || "mx" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    tier,
    hostId,
    propertyLabel: label,
    city: str(m.city, 60),
    unit: str(m.unit, 30),
    neighborhood: str(m.neighborhood, 60),
    rent: num(m.rent),
    beds: num(m.beds),
    baths: num(m.baths),
    sqft: num(m.sqft),
    daysListed: num(m.daysListed),
    inquiries: num(m.inquiries),
    // Free text, shown in the detail sheet. This is the operator explaining
    // the match to the renter, and it is the reason the deck reads as a
    // person rather than a filter.
    why: str(m.why, 600),
    criteria: crit,
    move,
    // Set by the operator when they have actually checked with the landlord.
    // Never inferred: the card says "confirmed available today" and that
    // sentence has to be earned every time.
    confirmedAt: m.confirmedAt ? str(m.confirmedAt, 40) : null,
    state: STATES.indexOf(m.state) !== -1 ? m.state : "new",
    createdAt: str(m.createdAt, 40) || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

// ---- read / write -----------------------------------------------------

async function read(memberId) {
  try {
    const v = await store().get(key(memberId), { type: "json" });
    return v && Array.isArray(v.matches) ? v : { memberId: String(memberId), matches: [] };
  } catch (e) {
    return { memberId: String(memberId), matches: [] };
  }
}

async function write(memberId, rec) {
  rec.updatedAt = new Date().toISOString();
  await store().setJSON(key(memberId), rec);
  // Read back. A write that reports success and lands nothing is the
  // failure this project has paid for more than once.
  const back = await read(memberId);
  return back.matches.length === rec.matches.length;
}

// ---- handler ----------------------------------------------------------

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };

  const q = event.queryStringParameters || {};

  if (q.version) {
    return json(200, {
      version: FN_VERSION,
      store: STORE_NAME,
      adminConfigured: !!ADMIN_KEY,
      blobsConfigured: !!(process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN),
      states: STATES,
      tiers: TIERS
    });
  }

  // ---- admin audit: every member holding matches ----
  if (q.admin && q.audit) {
    // Fails closed. An admin door that opens when a variable is missing is
    // worse than no door.
    if (!ADMIN_KEY || q.admin !== ADMIN_KEY) return json(404, { error: "not found" });
    try {
      const { blobs } = await store().list({ prefix: "m:" });
      const rows = [];
      for (const b of blobs) {
        const rec = await store().get(b.key, { type: "json" });
        if (!rec) continue;
        const counts = { new: 0, passed: 0, looked: 0, booked: 0 };
        (rec.matches || []).forEach((m) => { counts[m.state] = (counts[m.state] || 0) + 1; });
        rows.push({
          memberId: rec.memberId,
          total: (rec.matches || []).length,
          counts,
          updatedAt: rec.updatedAt || null
        });
      }
      rows.sort((a, b) => b.total - a.total);
      return json(200, { version: FN_VERSION, members: rows.length, rows });
    } catch (e) {
      return json(500, { version: FN_VERSION, error: String(e && e.message ? e.message : e) });
    }
  }

  // ---- GET: one member's deck ----
  if (event.httpMethod === "GET") {
    const memberId = String(q.memberId || "").replace(/[^0-9]/g, "");
    if (!memberId) return json(400, { version: FN_VERSION, error: "memberId required" });

    const rec = await read(memberId);
    // A pass is permanent FOR THIS RENTER. The match stays on the record so
    // the next curation run does not resurface it, and the listing itself is
    // untouched - it stays available to everybody else it fits.
    const live = q.all
      ? rec.matches
      : rec.matches.filter((m) => m.state !== "passed");

    return json(200, {
      version: FN_VERSION,
      memberId,
      total: live.length,
      matches: live
    });
  }

  if (event.httpMethod !== "POST") {
    return json(405, { version: FN_VERSION, error: "method not allowed" });
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return json(400, { version: FN_VERSION, error: "bad json" }); }

  // ---- POST ?act=1 : the renter acted on a card ----
  if (q.act) {
    if (body.secret !== SECRET) return json(401, { version: FN_VERSION, error: "unauthorized" });

    const memberId = String(body.memberId || "").replace(/[^0-9]/g, "");
    const matchId = str(body.matchId, 40);
    const action = str(body.action, 20);
    if (!memberId || !matchId) return json(400, { version: FN_VERSION, error: "memberId and matchId required" });

    const map = { pass: "passed", looked: "looked", booked: "booked", reset: "new" };
    const next = map[action];
    if (!next) return json(400, { version: FN_VERSION, error: "unknown action" });

    const rec = await read(memberId);
    const hit = rec.matches.filter((m) => m.id === matchId)[0];
    if (!hit) return json(404, { version: FN_VERSION, error: "match not found" });

    // 'reset' exists for the undo on the toast. A pass is permanent, which
    // makes a mis-swipe permanent too, and on a deck of three cards that is
    // a real cost. Undo is cheap; a lost match is not.
    hit.state = next;
    hit.updatedAt = new Date().toISOString();

    try { await write(memberId, rec); }
    catch (e) { return json(502, { version: FN_VERSION, error: "could not save" }); }

    return json(200, { version: FN_VERSION, ok: true, id: matchId, state: next });
  }

  // ---- POST ?admin=KEY : curate ----
  if (!ADMIN_KEY || q.admin !== ADMIN_KEY) return json(404, { error: "not found" });

  const memberId = String(body.memberId || "").replace(/[^0-9]/g, "");
  if (!memberId) return json(400, { version: FN_VERSION, error: "memberId required" });
  if (!Array.isArray(body.matches)) return json(400, { version: FN_VERSION, error: "matches[] required" });

  const rec = await read(memberId);
  const existing = {};
  rec.matches.forEach((m) => { existing[m.id] = m; });

  const out = [];
  const errors = [];
  body.matches.slice(0, MAX_MATCHES).forEach((raw, i) => {
    const c = cleanMatch(raw);
    if (c.error) { errors.push({ index: i, error: c.error }); return; }
    // Curating over an existing id KEEPS what the renter did with it.
    // Re-running a curation must never quietly un-pass something they
    // already threw away.
    const prev = existing[c.id];
    if (prev) { c.state = prev.state; c.createdAt = prev.createdAt; }
    out.push(c);
  });

  if (errors.length) {
    return json(400, { version: FN_VERSION, error: "some matches were rejected", errors });
  }

  // append mode keeps anything not named in this write
  const merged = body.replace === true
    ? out
    : rec.matches.filter((m) => !out.some((n) => n.id === m.id)).concat(out);

  rec.memberId = memberId;
  rec.matches = merged.slice(0, MAX_MATCHES);

  let landed = false;
  try { landed = await write(memberId, rec); }
  catch (e) {
    return json(502, { version: FN_VERSION, error: String(e && e.message ? e.message : e) });
  }

  return json(200, {
    version: FN_VERSION,
    ok: true,
    landed,
    memberId,
    total: rec.matches.length,
    live: rec.matches.filter((m) => m.state !== "passed").length
  });
};
