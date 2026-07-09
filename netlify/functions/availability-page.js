// netlify/functions/availability.js
// Stores and returns a member's showing availability + booking rules.
// GET  /.netlify/functions/availability?memberId=123   -> that member's schedule
// POST /.netlify/functions/availability  { secret, memberId, ...schedule } -> saves
const { getStore } = require('@netlify/blobs');

const STORE = 'showings-availability';
const SECRET = 'renters2026'; // light gate, matches existing pattern; harden later
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// rdcStore wrapper: try auto-context first, fall back to explicit siteID + token.
// Matches the pattern used across the project (showings.js, plaid-link-token, etc.).
function rdcStore(name) {
  try {
    return getStore(name);
  } catch (e) {
    return getStore({
      name: name,
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN
    });
  }
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  try {
    const store = rdcStore(STORE);

    if (event.httpMethod === 'GET') {
      const memberId = (event.queryStringParameters || {}).memberId;
      if (!memberId) return json(cors, 400, { error: 'memberId required' });
      const data = await store.get('avail:' + memberId, { type: 'json' });
      return json(cors, 200, data || defaults(memberId));
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      if (body.secret !== SECRET) return json(cors, 401, { error: 'unauthorized' });
      if (!body.memberId) return json(cors, 400, { error: 'memberId required' });
      const record = clean(body);
      await store.setJSON('avail:' + record.memberId, record);
      return json(cors, 200, { ok: true, saved: record });
    }

    return json(cors, 405, { error: 'method not allowed' });
  } catch (e) {
    return json(cors, 500, { error: String(e && e.message ? e.message : e) });
  }
};

function json(headers, statusCode, obj) {
  return { statusCode, headers, body: JSON.stringify(obj) };
}

function defaults(memberId) {
  return {
    memberId: String(memberId),
    enabled: false,
    autoConfirm: true,
    minNoticeHours: 24,
    horizonDays: 14,
    slotMins: 45,
    bufferMins: 15,
    windows: [],
    updatedAt: null
  };
}

function clamp(v, min, max, def) {
  v = Number(v);
  if (isNaN(v)) return def;
  return Math.max(min, Math.min(max, v));
}

function clean(b) {
  const windows = Array.isArray(b.windows)
    ? b.windows
        .filter(w => w && DAYS.includes(w.day) && isTime(w.start) && isTime(w.end) && w.start < w.end)
        .map(w => ({ day: w.day, start: w.start, end: w.end }))
        .slice(0, 60)
    : [];
  return {
    memberId: String(b.memberId),
    enabled: !!b.enabled,
    autoConfirm: b.autoConfirm !== false,
    minNoticeHours: clamp(b.minNoticeHours, 0, 336, 24),
    horizonDays: clamp(b.horizonDays, 1, 60, 14),
    slotMins: [30, 45, 60].includes(Number(b.slotMins)) ? Number(b.slotMins) : 45,
    bufferMins: clamp(b.bufferMins, 0, 120, 15),
    windows,
    updatedAt: new Date().toISOString()
  };
}

function isTime(s) {
  return typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);
}
