// netlify/functions/showings.js
// The showing-records engine. Backs the booking page, the dashboard tool, and the map.
//   GET  ?action=slots&hostId=ID                     -> open bookable slots for a host
//   GET  ?action=list&memberId=ID                    -> showings where member is host or guest
//   GET  ?action=feed&scope=participant&memberId=ID  -> that member's showings, exact
//   GET  ?action=feed&scope=platform                 -> all live showings, anonymized + city-level
//   POST { action:'book', secret, hostId, guestId, start, propertyLabel, city }
//   POST { action:'confirm'|'complete'|'cancel'|'decline', secret, id, by }
const { getStore } = require('@netlify/blobs');

const STORE_SHOW = 'showings';
const STORE_AVAIL = 'showings-availability';
const SECRET = 'renters2026';
const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const CENTROIDS = {
  baltimore: [39.2904, -76.6122],
  denver: [39.7392, -104.9903],
  portland: [45.5152, -122.6784],
  _default: [39.5, -98.35]
};

// rdcStore wrapper: auto-context first, explicit siteID/token fallback (matches project pattern)
function rdcStore(name) {
  try {
    return getStore(name);
  } catch (e) {
    return getStore({
      name,
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
    const show = rdcStore(STORE_SHOW);
    const q = event.queryStringParameters || {};

    if (event.httpMethod === 'GET') {
      if (q.action === 'slots') return json(cors, 200, { slots: await openSlots(q.hostId) });
      if (q.action === 'list') return json(cors, 200, { showings: await listFor(show, q.memberId) });
      if (q.action === 'feed') return json(cors, 200, { showings: await feed(show, q.scope, q.memberId) });
      return json(cors, 400, { error: 'unknown action' });
    }

    if (event.httpMethod === 'POST') {
      const b = JSON.parse(event.body || '{}');
      if (b.secret !== SECRET) return json(cors, 401, { error: 'unauthorized' });

      if (b.action === 'book') return await book(show, b, cors);
      if (['confirm', 'complete', 'cancel', 'decline'].includes(b.action)) return await transition(show, b, cors);
      return json(cors, 400, { error: 'unknown action' });
    }

    return json(cors, 405, { error: 'method not allowed' });
  } catch (e) {
    return json(cors, 500, { error: String(e && e.message ? e.message : e) });
  }
};

// ---- open slots -------------------------------------------------
async function openSlots(hostId) {
  if (!hostId) return [];
  const avail = await rdcStore(STORE_AVAIL).get('avail:' + hostId, { type: 'json' });
  if (!avail || !avail.enabled || !Array.isArray(avail.windows) || !avail.windows.length) return [];

  const all = await allShowings(rdcStore(STORE_SHOW));
  const taken = {};
  all.filter(s => s.hostId === String(hostId) && (s.status === 'proposed' || s.status === 'confirmed'))
     .forEach(s => { taken[s.start] = true; });

  const now = new Date();
  const minStart = new Date(now.getTime() + (avail.minNoticeHours || 0) * 3600000);
  const step = (avail.slotMins || 45) + (avail.bufferMins || 0);
  const out = [];

  for (let d = 0; d < (avail.horizonDays || 14); d++) {
    const day = new Date(now); day.setDate(now.getDate() + d);
    const dow = DOW[day.getDay()];
    avail.windows.filter(w => w.day === dow).forEach(w => {
      const [sh, sm] = w.start.split(':').map(Number);
      const [eh, em] = w.end.split(':').map(Number);
      let cur = new Date(day); cur.setHours(sh, sm, 0, 0);
      const winEnd = new Date(day); winEnd.setHours(eh, em, 0, 0);
      while (true) {
        const slotEnd = new Date(cur.getTime() + (avail.slotMins || 45) * 60000);
        if (slotEnd > winEnd) break;
        if (cur >= minStart) {
          const iso = local(cur);
          if (!taken[iso]) out.push({ start: iso, end: local(slotEnd) });
        }
        cur = new Date(cur.getTime() + step * 60000);
      }
    });
  }
  out.sort((a, b) => (a.start < b.start ? -1 : 1));
  return out.slice(0, 200);
}

// ---- booking ----------------------------------------------------
async function book(show, b, cors) {
  if (!b.hostId || !b.guestId || !b.start) return json(cors, 400, { error: 'hostId, guestId, start required' });
  if (String(b.hostId) === String(b.guestId)) return json(cors, 400, { error: 'cannot book with yourself' });

  const slots = await openSlots(b.hostId);
  const match = slots.find(s => s.start === b.start);
  if (!match) return json(cors, 409, { error: 'slot no longer available' });

  const avail = await rdcStore(STORE_AVAIL).get('avail:' + b.hostId, { type: 'json' });
  const autoConfirm = avail ? avail.autoConfirm !== false : true;
  const status = autoConfirm ? 'confirmed' : 'proposed';

  const city = (b.city || '').trim();
  const id = 'sh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const [lat, lng] = coordsFor(city, id);

  const rec = {
    id,
    hostId: String(b.hostId),
    guestId: String(b.guestId),
    hostName: b.hostName || '',
    guestName: b.guestName || '',
    hostVerified: !!b.hostVerified,
    guestVerified: !!b.guestVerified,
    propertyLabel: (b.propertyLabel || 'Showing').slice(0, 80),
    city,
    lat, lng,
    start: match.start,
    end: match.end,
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [{ status, by: String(b.guestId), at: new Date().toISOString() }]
  };
  await show.setJSON('show:' + id, rec);
  notify(rec, status === 'confirmed' ? 'booked-confirmed' : 'booked-request');
  return json(cors, 200, { ok: true, showing: rec });
}

// ---- status transitions ----------------------------------------
async function transition(show, b, cors) {
  if (!b.id) return json(cors, 400, { error: 'id required' });
  const rec = await show.get('show:' + b.id, { type: 'json' });
  if (!rec) return json(cors, 404, { error: 'showing not found' });

  const map = { confirm: 'confirmed', decline: 'cancelled', cancel: 'cancelled', complete: 'completed' };
  const to = map[b.action];
  rec.status = to;
  rec.updatedAt = new Date().toISOString();
  rec.history = rec.history || [];
  rec.history.push({ status: to, by: String(b.by || ''), at: rec.updatedAt });

  await show.setJSON('show:' + b.id, rec);
  notify(rec, b.action);
  return json(cors, 200, { ok: true, showing: rec });
}

// ---- reads ------------------------------------------------------
async function allShowings(show) {
  const { blobs } = await show.list({ prefix: 'show:' });
  const out = [];
  for (const b of blobs) {
    const r = await show.get(b.key, { type: 'json' });
    if (r) out.push(r);
  }
  return out;
}

async function listFor(show, memberId) {
  if (!memberId) return [];
  const id = String(memberId);
  const all = await allShowings(show);
  return all
    .filter(s => s.hostId === id || s.guestId === id)
    .map(s => Object.assign({}, s, { role: s.hostId === id ? 'host' : 'guest' }))
    .sort((a, b) => (a.start < b.start ? -1 : 1));
}

async function feed(show, scope, memberId) {
  const all = await allShowings(show);
  const live = all.filter(s => s.status !== 'cancelled');

  if (scope === 'platform') {
    // anonymized, city-level: no names, no property, coarse pin
    return live.map(s => ({
      id: s.id,
      status: s.status,
      city: s.city,
      lat: cityJitter(s.city, s.id)[0],
      lng: cityJitter(s.city, s.id)[1],
      verified: s.guestVerified,
      start: s.start
    }));
  }
  // participant scope: only this member's showings, full detail
  const id = String(memberId || '');
  return live
    .filter(s => s.hostId === id || s.guestId === id)
    .map(s => Object.assign({}, s, { role: s.hostId === id ? 'host' : 'guest' }));
}

// ---- helpers ----------------------------------------------------
function local(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function seed(str) {
  let h = 0; str = String(str);
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 100000;
  return h;
}
function coordsFor(city, id) {
  const key = String(city || '').toLowerCase().split(',')[0].trim();
  const base = CENTROIDS[key] || CENTROIDS._default;
  const j = seed(id);
  return [base[0] + ((j % 100) / 100 - 0.5) * 0.03, base[1] + (((j / 100) % 100) / 100 - 0.5) * 0.03];
}
function cityJitter(city, id) {
  const key = String(city || '').toLowerCase().split(',')[0].trim();
  const base = CENTROIDS[key] || CENTROIDS._default;
  const j = seed(id + 'x');
  return [base[0] + ((j % 100) / 100 - 0.5) * 0.08, base[1] + (((j / 100) % 100) / 100 - 0.5) * 0.08];
}
function json(headers, statusCode, obj) {
  return { statusCode, headers, body: JSON.stringify(obj) };
}
// SES notify hook — non-blocking stub. Wire to the existing SES sender next.
function notify(rec, kind) {
  try { console.log('[showings] notify', kind, rec.id, rec.hostId, rec.guestId); } catch (e) {}
}
