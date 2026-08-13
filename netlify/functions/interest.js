// interest.js — int-v2
// int-v1 -> int-v2: CORS headers + OPTIONS preflight (the card is served from
// www.renters.com and calls this cross-origin), and getStore() moved INSIDE
// the try/catch. In v1 it sat at handler scope, so any throw crashed the
// function and Netlify returned a 502 instead of our JSON error.
// GET  ?memberId=NNNN                    -> current ticks
// POST {memberId, audience, interests[]} -> save + read back
// GET  ?admin=KEY&counts=1               -> aggregate. 404s if RDC_ADMIN_KEY unset.

const { getStore } = require('@netlify/blobs');

const FN_VERSION = 'int-v2';

const ORIGINS = ['https://www.renters.com', 'https://renters.com'];

const VALID = {
  renter:   ['cosigner', 'renters_insurance', 'deposit_insurance'],
  landlord: ['accept_guarantees', 'landlord_insurance', 'deposit_coverage'],
  pm:       ['accept_guarantees'],
};

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
    if (q.admin || q.counts) {
      const adminKey = process.env.RDC_ADMIN_KEY;
      if (!adminKey || q.admin !== adminKey) {
        return { statusCode: 404, headers: cors, body: 'Not Found' };
      }
      return json(200, await counts(), cors);
    }

    const store = getStore('rdc-interest');

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

    // READ BACK. A tick that silently fails to land is worse than no card.
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
    // Never let anything escape - an uncaught throw becomes a 502 with no
    // JSON body, which is what int-v1 was doing.
    console.error('interest_error', e && e.message, e && e.stack);
    return json(500, { error: 'server_error', detail: String(e && e.message || e) }, cors);
  }
};

async function counts() {
  const store = getStore('rdc-interest');
  const tally = {};
  const byAudience = {};
  let members = 0;
  let cursor;

  do {
    const page = await store.list({ prefix: 'member:', cursor: cursor });
    const keys = page.blobs || [];
    // Capped parallelism - firing every read at once trips the Blobs
    // concurrency limit and silently drops records (vl-v4 lesson).
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
