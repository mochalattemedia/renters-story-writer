
// pg-webhook.js — pgw-v4
// PandaGuarantee webhook receiver. 2xx within 10s or Panda retries for 24h.
//
// pgw-v1 -> v2: v1 assumed Panda-Signature was a bare hex digest. Every
//   delivery 400'd. v2 tried several formats and logged which matched.
// pgw-v2 -> v3: v2 called hmac.copy() — .copy() is on crypto.Hash, NOT on
//   crypto.Hmac. Threw at module scope, bare 502. Also a TRUNCATED PASTE
//   ("Unexpected end of input") cost a round; hit ?version=1 BEFORE replaying.
// pgw-v3 -> v4: ⭐ THE ACTUAL SCHEME. Header is Stripe-style
//   t=<unix>,v1=<hex>. The v1 value CHANGED ON EVERY RETRY while the body
//   stayed 750 bytes — so the signature is not over the body alone. The
//   TIMESTAMP IS AN INPUT, not metadata:
//       signed_payload = t + "." + raw_body
//       v1             = HMAC-SHA256(signed_payload, secret)
//   v1-v3 all skipped t= as a value to ignore. That was the bug.
//   Timestamp is also checked against a tolerance window to blunt replay.

const crypto = require('crypto');

const FN_VERSION = 'pgw-v4';

// Reject signatures older than this. Panda retries for 24h, and a replayed
// delivery from the portal carries a fresh t, so 15 min is generous.
const TOLERANCE_SECONDS = 900;

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
  try {
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

    // RAW bytes. Parsing then re-stringifying changes key order and whitespace
    // and the HMAC can never match.
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body || '', 'utf8');

    const parsed = parseSignature(sigHeader);

    if (!parsed.t || !parsed.sigs.length) {
      console.warn('pg_webhook_unparsable_signature', FN_VERSION, String(sigHeader).slice(0, 160));
      return { statusCode: 400, body: 'bad_signature' };
    }

    // signed_payload = timestamp + "." + body
    const signedPayload = Buffer.concat([
      Buffer.from(String(parsed.t) + '.', 'utf8'),
      raw,
    ]);

    const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

    let matched = false;
    for (let i = 0; i < parsed.sigs.length; i++) {
      if (eq(parsed.sigs[i], expected)) { matched = true; break; }
    }

    if (!matched) {
      console.warn(
        'pg_webhook_bad_signature', FN_VERSION,
        'header', String(sigHeader).slice(0, 160),
        'bodyBytes', raw.length,
        'expected', expected.slice(0, 16) + '...'
      );
      return { statusCode: 400, body: 'bad_signature' };
    }

    // Signature is valid. Now check freshness — a valid but ancient signature
    // is a replay, not a delivery.
    const age = Math.floor(Date.now() / 1000) - Number(parsed.t);
    if (Math.abs(age) > TOLERANCE_SECONDS) {
      console.warn('pg_webhook_stale_signature', FN_VERSION, 'ageSeconds', age);
      return { statusCode: 400, body: 'stale_signature' };
    }

    console.log('pg_webhook_sig_ok', FN_VERSION, 'ageSeconds', age);

    let evt;
    try { evt = JSON.parse(raw.toString('utf8')); }
    catch (e) { return { statusCode: 400, body: 'bad_json' }; }

    try {
      await route(evt);
    } catch (e) {
      // Still 200 — a handler bug must not trigger 24h of retries.
      console.error('pg_webhook_handler_error', evt && evt.type, evt && evt.id, e && e.message);
    }

    return { statusCode: 200, body: 'ok' };

  } catch (e) {
    // Nothing escapes. An uncaught throw becomes a bare 502 with no body.
    console.error('pg_webhook_fatal', FN_VERSION, e && e.message, e && e.stack);
    return { statusCode: 500, body: JSON.stringify({ error: 'server_error', detail: String((e && e.message) || e) }) };
  }
};

// t=1787606608,v1=6a75bb...  (may carry more than one v1 during a secret rotation)
function parseSignature(header) {
  const out = { t: null, sigs: [] };
  const parts = String(header).trim().split(',');
  for (let i = 0; i < parts.length; i++) {
    const kv = parts[i].split('=');
    if (kv.length < 2) continue;
    const key = kv[0].trim().toLowerCase();
    const val = kv.slice(1).join('=').trim();
    if (key === 't') { out.t = val; }
    else if (key === 'v1') { out.sigs.push(val); }
  }
  return out;
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

  // TODO: upsert to BD member record. Guard on event_created — webhooks arrive
  // out of order and retry for 24h, so an older event must never overwrite a
  // newer stage. Dedupe on event_id.
}
