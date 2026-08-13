// interest.js — int-v3
// Product-interest capture from the dashboard card (head code w191, block pic1a).
//
// int-v1 -> int-v2: CORS headers + OPTIONS preflight (the card is served from
//   www.renters.com and calls this cross-origin), and getStore() moved INSIDE
//   the try/catch — at handler scope any throw crashed the function and Netlify
//   returned a bare 502 with no JSON body to diagnose from.
// int-v2 -> int-v3: getStore() replaced with the rdcStore() wrapper. Auto-context
//   threw "The environment has not been configured to use Netlify Blobs" — the
//   SAME failure documented July 6 for plaid-link-token. Falls back to explicit
//   NETLIFY_SITE_ID + NETLIFY_BLOBS_TOKEN, both already set in Netlify.
//   RULE: never call bare getStore() in a new function. Always rdcStore().
//
// GET  ?memberId=NNNN                    -> current ticks for that member
// POST {memberId, audience, interests[]} -> save, then READ BACK and verify
// GET  ?admin=KEY&counts=1               -> aggregate. 404s if RDC_ADMIN_KEY unset.
// GET  ?version=1                        -> version stamp

const { getStore } = require('@netlify/blobs');

const FN_VERSION = 'int-v3';

const ORIGINS = ['https://www.renters.com', 'https://renters.com'];

const VALID = {
  renter:   ['cosigner', 'renters_insurance', 'deposit_insurance'],
  landlord: ['accept_guarantees', 'landlord_insurance', 'deposit_coverage'],
  pm:       ['accept_guarantees'],
};

function rdcStore(name) {
  try {
    return getStore(name);
  } catch (e) {
    return getStore({
      name: name,
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN,
    });
  }
}

exports.handler = async (event) => {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const cors = {
    'Access-Control-Allow-Origin': ORIGINS.indexOf(origin) !== -1 ? origin : ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  const q = event.queryStringParameters || {};
  if (q.version) return json(200, { _v: FN_VERSION }, cors);

  try {
    // Admin counts. FAILS CLOSED: no env var, no door.
    if (q.admin || q.counts) {
      const adminKey = process.env.RDC_ADMIN_KEY;
      if (!adminKey || q.admin !== adminKey) {
        return { statusCode: 404, headers: cors, body: 'Not Found' };
      }
      return json(200, await counts(), cors);
    }

    const store = rdcStore('rdc-interest');

    if (event.httpMethod === 'GET') {
      const memberId = String(q.memberId || '').trim();
      if (!/^\d+$/.test(memberId)) return json(400, { error: 'bad_member' }, cors);
      let rec = null;
      try { rec = await store.get('member:' + memberId, { type: 'json' }); }
      catch (e) { rec = null; }
      return json(200, {
        _v: FN_VERSION,
        memberId: memberId,
        interests: (rec && rec.interests) || [],
        audience: (rec && rec.audience) || null,
      }, cors);
    }

    if (event.httpMethod !== 'POST') return json(405, { error: 'method' }, cors);

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (e) { return json(400, { error: 'bad_json' }, cors); }

    const memberId = String(body.memberId || '').trim();
    const audience = String(body.audience || '').trim();

    if (!/^\d+$/.test(memberId)) return json(400, { error: 'bad_member' }, cors);
    if (!VALID[audience]) return json(400, { error: 'bad_audience' }, cors);

    // Only ever store keys valid for THIS audience. A renter cannot post
    // landlord_insurance by editing the request.
    const allowed = VALID[audience];
    const interests = (Array.isArray(body.interests) ? body.interests : [])
      .map(function (s) { return String(s); })
      .filter(function (s) { return allowed.indexOf(s) !== -1; });

    const record = {
      memberId: memberId,
      audience: audience,
      interests: interests,
      updated_at: new Date().toISOString(),
      _v: FN_VERSION,
    };

    await store.setJSON('member:' + memberId, record);

    // READ BACK AND VERIFY. Same discipline as vis7's intro cap — a tick that
    // silently fails to land is worse than no card, because the member believes
    // they told us something they did not.
    let back = null;
    try { back = await store.get('member:' + memberId, { type: 'json' }); }
    catch (e) { back = null; }

    const landed = !!back &&
      JSON.stringify((back.interests || []).slice().sort()) === JSON.stringify(interests.slice().sort());

    if (!landed) {
      console.error('interest_readback_mismatch', memberId);
      return json(502, { error: 'readback_failed', landed: false }, cors);
    }

    console.log('interest_saved', JSON.stringify({ memberId: memberId, audience: audience, interests: interests }));
    return json(200, { ok: true, _v: FN_VERSION, landed: true, interests: interests }, cors);

  } catch (e) {
    // Never let anything escape. An uncaught throw becomes a 502 with no body,
    // which is exactly what int-v1 was doing and what cost the diagnosis time.
    console.error('interest_error', e && e.message, e && e.stack);
    return json(500, { error: 'server_error', detail: String((e && e.message) || e) }, cors);
  }
};

async function counts() {
  const store = rdcStore('rdc-interest');
  const tally = {};
  const byAudience = {};
  let members = 0;
  let cursor;

  do {
    const page = await store.list({ prefix: 'member:', cursor: cursor });
    const keys = page.blobs || [];
    // CAPPED PARALLELISM, chunks of 8. vl-v4's lesson: firing every read at
    // once trips a Blobs concurrency limit, and a .catch(()=>null) over that
    // batch silently drops records so the count looks fine and is wrong.
    for (let i = 0; i < keys.length; i += 8) {
      const chunk = keys.slice(i, i + 8);
      const recs = await Promise.all(chunk.map(async function (b) {
        try { return await store.get(b.key, { type: 'json' }); } catch (e) { return null; }
      }));
      recs.forEach(function (r) {
        if (!r) return;
        members++;
        byAudience[r.audience] = (byAudience[r.audience] || 0) + 1;
        (r.interests || []).forEach(function (k) { tally[k] = (tally[k] || 0) + 1; });
      });
    }
    cursor = page.cursor;
  } while (cursor);

  return { _v: FN_VERSION, members: members, byAudience: byAudience, interests: tally };
}

function json(statusCode, obj, cors) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  for (const k in cors) { headers[k] = cors[k]; }
  return { statusCode: statusCode, headers: headers, body: JSON.stringify(obj) };
}
