/* ============================================================
   tour-feedback.js  ·  tf-v1
   ============================================================

   Receives the three answers at the end of the walkthrough and writes
   them to a Blobs store. Nothing else. No email, no notification, no
   scoring.

   WHY THIS EXISTS: the survey button said "Send it" and sent nothing.
   Somebody typing a considered answer into a form that swallows it is
   worse than not asking, and the answers to these three questions are
   the entire reason the walkthrough was built.

   WHAT IT DELIBERATELY DOES NOT DO
   - No identity. Nobody is asked who they are and nothing here tries to
     work it out. No IP is stored. A renter who was told nothing leaves
     the phone gets a record that cannot be tied back to them.
   - No overwrite. Every submission is its own key. Last-write-wins on a
     shared key would quietly eat answers.

   🔑 getStore() IS GIVEN siteID AND token EXPLICITLY. It does not throw
   on creation, only later on read or write, so the usual try/catch
   fallback pattern fails silently and looks like it worked.

   READ THEM BACK:  GET  ?key=renters2026&list=1
   ============================================================ */

const { getStore } = require('@netlify/blobs');

const TF_VERSION = 'tf-v1';
const KEY = 'renters2026';

/* Long enough for anything considered, short enough that nobody can post
   a novel into the store. */
const MAX_FIELD = 4000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Content-Type': 'application/json'
};

function store() {
  return getStore({
    name: 'tour-feedback',
    siteID: process.env.BLOBS_SITE_ID || process.env.SITE_ID,
    token: process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN
  });
}

function clean(v) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, MAX_FIELD);
}

function reply(code, body) {
  return { statusCode: code, headers: CORS, body: JSON.stringify(body) };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  /* ---------------------------------------------------------- read back */
  if (event.httpMethod === 'GET') {
    const q = event.queryStringParameters || {};
    if (q.key !== KEY) return reply(403, { ok: false, error: 'forbidden' });

    if (!q.list) return reply(200, { ok: true, version: TF_VERSION });

    try {
      const s = store();
      const listed = await s.list();
      const keys = (listed.blobs || []).map(b => b.key).sort().reverse();
      const rows = [];
      /* Capped. A read that has to page through everything ever submitted
         is a read that starts timing out the month it matters. */
      for (const k of keys.slice(0, 200)) {
        const raw = await s.get(k);
        if (raw) { try { rows.push(JSON.parse(raw)); } catch (e) {} }
      }
      return reply(200, {
        ok: true, version: TF_VERSION, count: keys.length, rows: rows
      });
    } catch (e) {
      return reply(500, { ok: false, error: String(e && e.message || e) });
    }
  }

  if (event.httpMethod !== 'POST') {
    return reply(405, { ok: false, error: 'method' });
  }

  /* ------------------------------------------------------------- write */
  let b;
  try { b = JSON.parse(event.body || '{}'); }
  catch (e) { return reply(400, { ok: false, error: 'bad json' }); }

  if (b.key !== KEY) return reply(403, { ok: false, error: 'forbidden' });

  const use = clean(b.use);
  const worth = clean(b.worth);
  const friction = clean(b.friction);

  /* Somebody who tapped Send with nothing filled in has told us nothing,
     and a store full of blank rows makes the real ones harder to find. */
  if (!use && !worth && !friction) {
    return reply(200, { ok: true, version: TF_VERSION, stored: false });
  }

  const at = new Date().toISOString();
  const rec = {
    at: at,
    who: b.who === 'investor' ? 'investor' : 'renter',
    shell: clean(b.shell),
    use: use,
    worth: worth,
    friction: friction
  };

  /* Timestamp first so the keys sort chronologically, random tail so two
     submissions in the same millisecond cannot land on each other. */
  const id = at.replace(/[:.]/g, '-') + '-' +
             Math.random().toString(36).slice(2, 8);

  try {
    await store().set('fb-' + id, JSON.stringify(rec));
  } catch (e) {
    return reply(500, { ok: false, error: String(e && e.message || e) });
  }

  return reply(200, { ok: true, version: TF_VERSION, stored: true, id: id });
};
