// PASTE CHECK: member-probe.js  mp-v1  (rename this file to member-probe.js)
// Renters.com — newest-member probe
// Reads BD member records directly by ID scan, bypassing every HTML cache layer.
// Answers one question: are new member records actually landing in the database?
//
// Deploy to: netlify/functions/member-probe.js
//
// Endpoints:
//   ?version=1                       -> {"version":"mp-v1"} deployment confirmation
//   ?                                -> walks down from DEFAULT_FROM, returns newest members found
//   ?from=4600&count=6               -> start the downward walk at a specific ID
//   ?raw=1&id=4321                   -> full untouched BD record for one ID (shows real field names)
//   ?pace=800                        -> slow the pacing if BD starts throttling
//
// Bible constraints honored here:
//   - GET /user/get/{id} is the ONLY reliable BD read (three-findings block, Element T)
//   - pace >= 650ms, never parallelize, never let runners overlap
//   - BD_API_BASE must include /api/v2 or every BD-facing call breaks silently
//   - redirect = auth not accepted; never follow it, report it
//   - message is a ONE-ITEM ARRAY
//   - 400 "user not found" is indistinguishable from a throttle, so misses are
//     reported as "miss" and never as "deleted"

const FN_VERSION = 'mp-v1';

const BD_API_BASE = 'https://www.renters.com/api/v2';
const BD_API_KEY = process.env.BD_API_KEY;

const TIME_BUDGET_MS = 7500;   // Netlify kills at 10s; leave headroom
const DEFAULT_PACE_MS = 650;   // BD throttle floor
const MIN_PACE_MS = 650;
const DEFAULT_FROM = 4400;     // starting ID for the downward walk
const DEFAULT_COUNT = 6;
const MAX_COUNT = 12;
const MISS_LIMIT = 60;         // consecutive empty IDs before giving up

// Candidate join-date field names. BD's actual column name is not assumed here:
// whichever of these is present on the live record gets reported, along with
// its name, so the real field is discovered rather than guessed.
const DATE_FIELDS = [
  'date_created', 'created_at', 'date_added', 'join_date', 'date_joined',
  'signup_date', 'member_since', 'date_registered', 'registration_date',
  'created', 'date_updated', 'updated_at'
];

const NAME_FIELDS = ['first_name', 'last_name', 'display_name', 'user_name', 'company_name'];

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

function json(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
    },
    body: JSON.stringify(body, null, 2)
  };
}

function pickDates(rec) {
  const found = {};
  for (let i = 0; i < DATE_FIELDS.length; i++) {
    const f = DATE_FIELDS[i];
    if (rec[f] !== undefined && rec[f] !== null && String(rec[f]).length > 0) {
      found[f] = rec[f];
    }
  }
  return found;
}

function pickName(rec) {
  const parts = [];
  for (let i = 0; i < NAME_FIELDS.length; i++) {
    const f = NAME_FIELDS[i];
    if (rec[f] && String(rec[f]).trim().length > 0) parts.push(String(rec[f]).trim());
  }
  return parts.length ? parts.join(' / ') : null;
}

function maskEmail(v) {
  if (!v) return null;
  const s = String(v);
  const at = s.indexOf('@');
  if (at < 1) return 'set';
  const head = s.slice(0, at);
  const domain = s.slice(at);
  const shown = head.slice(0, 2);
  return shown + '***' + domain;
}

// Single BD read. Returns {ok, rec} or {ok:false, reason}.
async function readMember(id) {
  const url = BD_API_BASE + '/user/get/' + id;
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'X-Api-Key': BD_API_KEY,
        'Accept': 'application/json'
      }
    });
  } catch (e) {
    return { ok: false, reason: 'network', detail: String(e && e.message ? e.message : e) };
  }

  // Redirect guard: BD bounces to the admin dashboard when auth is not accepted.
  if (res.status >= 300 && res.status < 400) {
    return { ok: false, reason: 'auth_redirect', status: res.status };
  }

  let text = '';
  try { text = await res.text(); } catch (e) { text = ''; }

  if (res.status === 400) {
    // Could be a genuinely absent ID OR a throttle. Not distinguishable.
    return { ok: false, reason: 'miss', status: 400 };
  }
  if (!res.ok) {
    return { ok: false, reason: 'http_' + res.status, status: res.status };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: 'unparseable', sample: text.slice(0, 160) };
  }

  // message is a one-item ARRAY on this endpoint.
  let rec = parsed && parsed.message;
  if (Array.isArray(rec)) rec = rec[0];
  if (!rec || typeof rec !== 'object') {
    return { ok: false, reason: 'miss', status: res.status };
  }

  return { ok: true, rec: rec };
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};

  if (q.version === '1') {
    return json(200, { version: FN_VERSION, fn: 'member-probe' });
  }

  if (!BD_API_KEY) {
    return json(500, {
      version: FN_VERSION,
      error: 'BD_API_KEY is not set in the environment'
    });
  }

  const started = Date.now();
  const pace = Math.max(MIN_PACE_MS, parseInt(q.pace, 10) || DEFAULT_PACE_MS);

  // RAW MODE: one ID, full record, so the real BD field names are visible.
  if (q.raw === '1') {
    const rawId = parseInt(q.id, 10);
    if (!rawId || rawId < 1) {
      return json(400, { version: FN_VERSION, error: 'raw=1 requires a valid &id=' });
    }
    const r = await readMember(rawId);
    if (!r.ok) {
      return json(200, {
        version: FN_VERSION,
        mode: 'raw',
        id: rawId,
        found: false,
        reason: r.reason,
        note: r.reason === 'miss'
          ? 'Empty result. Either no such ID or a BD throttle. Wait 15 minutes and retry before concluding.'
          : undefined
      });
    }
    return json(200, {
      version: FN_VERSION,
      mode: 'raw',
      id: rawId,
      found: true,
      fieldNames: Object.keys(r.rec).sort(),
      record: r.rec
    });
  }

  // WALK MODE: step down from `from`, collect the newest live members.
  const from = parseInt(q.from, 10) || DEFAULT_FROM;
  const want = Math.min(MAX_COUNT, Math.max(1, parseInt(q.count, 10) || DEFAULT_COUNT));

  const members = [];
  let examined = 0;
  let consecutiveMisses = 0;
  let id = from;
  let stopped = 'complete';
  let authFailed = false;
  let firstCall = true;

  while (id >= 1 && members.length < want) {
    if (Date.now() - started > TIME_BUDGET_MS) { stopped = 'time_budget'; break; }
    if (consecutiveMisses >= MISS_LIMIT) { stopped = 'miss_limit'; break; }

    if (!firstCall) await sleep(pace);
    firstCall = false;

    const r = await readMember(id);
    examined++;

    if (r.ok) {
      consecutiveMisses = 0;
      members.push({
        user_id: r.rec.user_id || r.rec.id || id,
        scanned_id: id,
        name: pickName(r.rec),
        email: maskEmail(r.rec.email || r.rec.user_email),
        profession_id: r.rec.profession_id !== undefined ? r.rec.profession_id : null,
        zip_code: r.rec.zip_code || null,
        dates: pickDates(r.rec)
      });
    } else if (r.reason === 'auth_redirect') {
      authFailed = true;
      stopped = 'auth_redirect';
      break;
    } else {
      consecutiveMisses++;
    }

    id--;
  }

  const elapsed = Date.now() - started;

  const out = {
    version: FN_VERSION,
    mode: 'walk',
    generated_at: new Date().toISOString(),
    params: { from: from, count: want, pace_ms: pace },
    stopped: stopped,
    ids_examined: examined,
    consecutive_misses_at_stop: consecutiveMisses,
    elapsed_ms: elapsed,
    members_found: members.length,
    highest_live_id: members.length ? members[0].scanned_id : null,
    next_from: id >= 1 ? id : null,
    members: members
  };

  if (authFailed) {
    out.error = 'BD redirected the request, which means the API key was not accepted. Not a cache problem.';
    return json(200, out);
  }

  if (members.length === 0) {
    out.note = 'No live records in this range. If stopped=miss_limit, lower &from= and run again. '
      + 'If repeated runs at known-good IDs also come back empty, that is a BD throttle, not a missing record. '
      + 'Wait 15 minutes between attempts.';
  } else {
    out.note = 'These records came straight from the BD database with no HTML cache in front of them. '
      + 'If recent join dates appear here, signups are landing and only the public display is stale.';
  }

  if (stopped === 'time_budget' && id >= 1) {
    out.continue_hint = '?from=' + id + '&count=' + want;
  }

  return json(200, out);
};
