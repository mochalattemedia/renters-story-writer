// interest.js — int-v1
// Product-interest capture from the dashboard card. Blobs-backed, read-back verified.
// GET  ?memberId=NNNN            -> current ticks for that member
// POST {memberId, audience, interests[]} -> save + read back
// GET  ?admin=KEY&counts=1       -> aggregate counts. 404s if RDC_ADMIN_KEY unset.

const { getStore } = require('@netlify/blobs');

const FN_VERSION = 'int-v1';

const VALID = {
  renter:   ['cosigner', 'renters_insurance', 'deposit_insurance'],
  landlord: ['accept_guarantees', 'landlord_insurance', 'deposit_coverage'],
  pm:       ['accept_guarantees'],
};

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};

  if (q.version) return json(200, { _v: FN_VERSION });

  // Admin counts. Fails closed: no env var, no door.
  if (q.admin || q.counts) {
    const adminKey = process.env.RDC_ADMIN_KEY;
    if (!adminKey) return { statusCode: 404, body: 'Not Found' };
    if (q.admin !== adminKey) return { statusCode: 404, body: 'Not Found' };
    return json(200, await counts());
  }

  const store = getStore('rdc-interest');

  if (event.httpMethod === 'GET') {
    const memberId = String(q.memberId || '').trim();
    if (!/^\d+$/.test(memberId)) return json(400, { error: 'bad_member' });
    let rec = null;
    try { rec = await store.get('member:' + memberId, { type: 'json' }); }
    catch (e) { rec = null; }
    return json(200, { _v: FN_VERSION, memberId: memberId, interests: (rec && rec.interests) || [], audience: (rec && rec.audience) || null });
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'method' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'bad_json' }); }

  const memberId = String(body.memberId || '').trim();
  const audience = String(body.audience || '').trim();

  if (!/^\d+$/.test(memberId)) return json(400, { error: 'bad_member' });
  if (!VALID[audience]) return json(400, { error: 'bad_audience' });

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

  try {
    await store.setJSON('member:' + memberId, record);
  } catch (e) {
    console.error('interest_write_fail', memberId, e.message);
    return json(502, { error: 'write_failed', landed: false });
  }

  // READ BACK. A tick that silently fails to land is worse than no card.
  let back = null;
  try { back = await store.get('member:' + memberId, { type: 'json' }); }
  catch (e) { back = null; }

  const landed = !!back && JSON.stringify((back.interests || []).slice().sort()) === JSON.stringify(interests.slice().sort());

  if (!landed) {
    console.error('interest_readback_mismatch', memberId);
    return json(502, { error: 'readback_failed', landed: false });
  }

  console.log('interest_saved', JSON.stringify({ memberId: memberId, audience: audience, interests: interests }));
  return json(200, { ok: true, _v: FN_VERSION, landed: true, interests: interests });
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

function json(statusCode, obj) {
  return {
    statusCode: statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj),
  };
}
