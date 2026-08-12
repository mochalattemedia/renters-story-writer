// pg-webhook.js — pgw-v1
// PandaGuarantee webhook receiver. HMAC-SHA256 over RAW body, Panda-Signature header.
// Must return 2xx within 10s or Panda retries with backoff for 24h.

const crypto = require('crypto');

const FN_VERSION = 'pgw-v1';

const STATUS_MAP = {
  'pre_approval_invite.sent':      { stage: 'invited',      badge: null },
  'pre_approval_invite.opened':    { stage: 'opened',       badge: null },
  'pre_approval_invite.applied':   { stage: 'applying',     badge: null },
  'pre_approval_invite.cancelled': { stage: 'cancelled',    badge: null },
  'application.submitted':         { stage: 'submitted',    badge: null },
  'application.referred':          { stage: 'in_review',    badge: null },
  'application.approved':          { stage: 'approved',     badge: 'preapproved' },
  'application.declined':          { stage: 'not_eligible', badge: null },
  'application.cancelled':         { stage: 'cancelled',    badge: null },
  'bond.issued':                   { stage: 'bonded',       badge: 'guaranteed' },
  'bond.cancelled':                { stage: 'bond_ended',   badge: null },
};

exports.handler = async (event) => {
  if (event.queryStringParameters && event.queryStringParameters.version) {
    return { statusCode: 200, body: JSON.stringify({ _v: FN_VERSION, secretConfigured: !!process.env.PANDA_WEBHOOK_SECRET }) };
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };

  const secret = process.env.PANDA_WEBHOOK_SECRET;
  const sig = event.headers['panda-signature'] || event.headers['Panda-Signature'];
  if (!secret || !sig) return { statusCode: 400, body: 'missing_signature' };

  // Hash the RAW bytes. Parsing and re-stringifying WILL break the signature.
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64')
    : Buffer.from(event.body || '', 'utf8');

  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');

  if (!safeEqual(expected, String(sig).trim())) {
    console.warn('pg_webhook_bad_signature', FN_VERSION);
    return { statusCode: 400, body: 'bad_signature' };
  }

  let evt;
  try { evt = JSON.parse(raw.toString('utf8')); }
  catch { return { statusCode: 400, body: 'bad_json' }; }

  try {
    await route(evt);
  } catch (e) {
    // Still 200. A handler bug must not trigger 24h of retries.
    console.error('pg_webhook_handler_error', evt.type, evt.id, e.message);
  }

  return { statusCode: 200, body: 'ok' };
};

async function route(evt) {
  const obj = (evt && evt.data && evt.data.object) || {};
  const mapped = STATUS_MAP[evt.type];

  if (!mapped) {
    console.log('pg_event_unhandled', evt.type, evt.id);
    return;
  }

  const record = {
    _v: FN_VERSION,
    provider: 'panda',
    stage: mapped.stage,
    badge: mapped.badge,
    external_id: obj.id || null,
    status: obj.status || null,
    status_label: obj.status_label || null,
    property_assigned: obj.property_assigned === true,
    property_id: obj.property_id || null,
    landlord_id: obj.landlord_id || null,
    premium_cents: (obj.premium_amount === undefined ? null : obj.premium_amount),
    bond_number: (obj.bond && obj.bond.number) || null,
    issued_at: (obj.bond && obj.bond.issued_at) || null,
    event_id: evt.id,
    event_created: evt.created,
    updated_at: new Date().toISOString(),
  };

  console.log('pg_state', JSON.stringify(record));

  // TODO: upsert to BD member record. Guard on event_created — webhooks
  // arrive out of order and retry for 24h, so an older event must never
  // overwrite a newer stage. Dedupe on event_id.
}

function safeEqual(a, b) {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
