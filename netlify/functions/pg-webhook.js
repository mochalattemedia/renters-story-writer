// pg-webhook.js — pgw-v2
// PandaGuarantee webhook receiver. Must return 2xx within 10s or Panda
// retries with backoff for 24h.
//
// pgw-v1 -> pgw-v2: SIGNATURE VERIFICATION WAS REJECTING EVERY DELIVERY.
//   v1 assumed Panda-Signature carries a bare hex digest and compared the
//   whole header against our HMAC. Portal showed pre_approval_invite.sent
//   at attempt 4 with a 400, so the header is some other shape.
//   v2 accepts EVERY COMMON FORMAT and LOGS WHICH ONE MATCHED, so the first
//   successful delivery tells us the real format instead of us guessing:
//     - bare hex                      abc123...
//     - sha256= prefix                sha256=abc123...
//     - Stripe-style key=value list   t=1756049608,v1=abc123...
//     - base64 digest                 (same computation, different encoding)
//   It also logs the raw header (truncated) on failure so a rejection is
//   diagnosable from the log alone rather than needing the portal.
//   TIGHTEN THIS ONCE THE FORMAT IS KNOWN - a permanently permissive
//   verifier is a weaker check than a precise one.

const crypto = require('crypto');

const FN_VERSION = 'pgw-v2';

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
    return {
      statusCode: 200,
      body: JSON.stringify({ _v: FN_VERSION, secretConfigured: !!process.env.PANDA_WEBHOOK_SECRET }),
    };
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };

  const secret = process.env.PANDA_WEBHOOK_SECRET;
  const sigHeader =
    (event.headers && (event.headers['panda-signature'] || event.headers['Panda-Signature'])) || '';

  if (!secret || !sigHeader) {
    console.warn('pg_webhook_missing_signature', FN_VERSION, 'hasSecret', !!secret, 'hasHeader', !!sigHeader);
    return { statusCode: 400, body: 'missing_signature' };
  }

  // Hash the RAW bytes. Parsing and re-stringifying changes key order and
  // whitespace, and the HMAC will never match.
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64')
    : Buffer.from(event.body || '', 'utf8');

  const hmac = crypto.createHmac('sha256', secret).update(raw);
  const digestHex = hmac.copy().digest('hex');
  const digestB64 = crypto.createHmac('sha256', secret).update(raw).digest('base64');

  const match = verify(sigHeader, digestHex, digestB64);

  if (!match) {
    console.warn(
      'pg_webhook_bad_signature', FN_VERSION,
      'header', String(sigHeader).slice(0, 120),
      'expectedHex', digestHex.slice(0, 16) + '...',
      'expectedB64', digestB64.slice(0, 16) + '...'
    );
    return { statusCode: 400, body: 'bad_signature' };
  }

  console.log('pg_webhook_sig_ok', FN_VERSION, 'format', match);

  let evt;
  try { evt = JSON.parse(raw.toString('utf8')); }
  catch (e) { return { statusCode: 400, body: 'bad_json' }; }

  try {
    await route(evt);
  } catch (e) {
    // Still 200. A handler bug must not trigger 24h of retries.
    console.error('pg_webhook_handler_error', evt && evt.type, evt && evt.id, e && e.message);
  }

  return { statusCode: 200, body: 'ok' };
};

// Returns a label naming which format matched, or null.
function verify(header, hex, b64) {
  const h = String(header).trim();

  if (eq(h, hex)) return 'bare_hex';
  if (eq(h, b64)) return 'bare_base64';

  if (h.toLowerCase().indexOf('sha256=') === 0) {
    const v = h.slice(7).trim();
    if (eq(v, hex)) return 'sha256_prefix_hex';
    if (eq(v, b64)) return 'sha256_prefix_base64';
  }

  // Stripe-style: t=1756049608,v1=abc123  (may carry several v1 values)
  if (h.indexOf('=') !== -1) {
    const parts = h.split(',');
    for (let i = 0; i < parts.length; i++) {
      const kv = parts[i].split('=');
      if (kv.length < 2) continue;
      const key = kv[0].trim().toLowerCase();
      const val = kv.slice(1).join('=').trim();
      if (key === 't') continue;
      if (eq(val, hex)) return 'kv_' + key + '_hex';
      if (eq(val, b64)) return 'kv_' + key + '_base64';
    }
  }

  return null;
}

function eq(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

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

  // TODO: upsert to BD member record. Guard on event_created - webhooks
  // arrive out of order and retry for 24h, so an older event must never
  // overwrite a newer stage. Dedupe on event_id.
}
