// pg-webhook.js — pgw-v3
// PandaGuarantee webhook receiver. 2xx within 10s or Panda retries for 24h.
//
// pgw-v1 -> v2: signature verification rejected every delivery (400). v1
//   assumed Panda-Signature was a bare hex digest. v2 accepts every common
//   format and logs which one matched.
// pgw-v2 -> v3: v2 CRASHED (502). It called hmac.copy() — .copy() exists on
//   crypto.Hash, NOT on crypto.Hmac. Threw before any try/catch, so Netlify
//   returned a bare 502. v3 computes each digest independently and wraps the
//   whole handler so a throw is logged and answered, never silent.
//   node --check does not catch this class of bug; only running it does.

const crypto = require('crypto');

const FN_VERSION = 'pgw-v3';

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

    // Hash the RAW bytes. Parsing then re-stringifying changes key order and
    // whitespace and the HMAC will never match.
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body || '', 'utf8');

    // Two independent HMAC instances. Hmac has no .copy() — that was the v2 bug.
    const digestHex = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const digestB64 = crypto.createHmac('sha256', secret).update(raw).digest('base64');

    const match = verify(sigHeader, digestHex, digestB64);

    if (!match) {
      console.warn(
        'pg_webhook_bad_signature', FN_VERSION,
        'header', String(sigHeader).slice(0, 160),
        'bodyBytes', raw.length,
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
      // Still 200 — a handler bug must not trigger 24h of retries.
      console.error('pg_webhook_handler_error', evt && evt.type, evt && evt.id, e && e.message);
    }

    return { statusCode: 200, body: 'ok' };

  } catch (e) {
    // Nothing escapes. An uncaught throw becomes a bare 502 with no body,
    // which is exactly what v2 did and what cost the diagnosis.
    console.error('pg_webhook_fatal', FN_VERSION, e && e.message, e && e.stack);
    return { statusCode: 500, body: JSON.stringify({ error: 'server_error', detail: String((e && e.message) || e) }) };
  }
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

  // Stripe-style: t=1756049608,v1=abc123 (may carry several v1 values)
  if (h.indexOf('=') !== -1) {
    const parts = h.split(',');
    for (let i = 0; i < parts.length; i++) {
      const kv = parts[i].split('=');
      if (kv.length
