// netlify/functions/didit-webhook.js
// Receives Didit verification results, verifies the HMAC-SHA256 signature over the
// RAW body (legacy x-signature method), then records the outcome to Netlify Blobs.
//
// Env vars required:
//   DIDIT_WEBHOOK_SECRET  = your Webhook Secret Key from the Didit console
//
// Point Didit's webhook URL (console Step 3) at:
//   https://<your-site>.netlify.app/.netlify/functions/didit-webhook

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const secret = process.env.DIDIT_WEBHOOK_SECRET;
  if (!secret) {
    console.log('DIDIT_WEBHOOK_SECRET not set');
    return { statusCode: 500, body: 'Not configured' };
  }

  // RAW body — do NOT parse before verifying the signature
  const rawBody = event.body || '';
  const signature = (event.headers['x-signature'] || event.headers['X-Signature'] || '').trim();
  const timestamp = (event.headers['x-timestamp'] || event.headers['X-Timestamp'] || '').trim();

  if (!signature) {
    console.log('Missing x-signature header');
    return { statusCode: 401, body: 'Unauthorized' };
  }

  // Timestamp freshness (replay protection) — 5 min window. Skip if header absent.
  if (timestamp) {
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
      console.log('Stale timestamp');
      return { statusCode: 401, body: 'Unauthorized (stale)' };
    }
  }

  // Verify HMAC-SHA256 over the raw body
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  let valid = false;
  try {
    valid = crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch (e) {
    valid = false;
  }
  if (!valid) {
    console.log('Signature mismatch');
    return { statusCode: 401, body: 'Unauthorized (bad signature)' };
  }

  // Signature good — now parse
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (e) {
    return { statusCode: 400, body: 'Bad JSON' };
  }

  const sessionId  = body.session_id || '';
  const status     = body.status || '';
  const vendorData = body.vendor_data || '';
  const webhookType = body.webhook_type || '';
  const decision   = body.decision || {};

  // Pull a few useful fields from the decision report if present
  const idv = (decision && decision.id_verification) || {};
  const record = {
    session_id: sessionId,
    status: status,                       // Approved | Declined | In Review | ...
    vendor_data: vendorData,              // your renter/member id
    webhook_type: webhookType,
    first_name: idv.first_name || (decision.expected_details && decision.expected_details.first_name) || '',
    last_name: idv.last_name || (decision.expected_details && decision.expected_details.last_name) || '',
    document_type: idv.document_type || '',
    date_of_birth: idv.date_of_birth || '',
    expiration_date: idv.expiration_date || '',
    features: (decision && decision.features) || [],
    received_at: new Date().toISOString()
  };

  // Store to Netlify Blobs, keyed by session_id (and mirror by vendor_data if present)
  try {
    const store = getStore('didit-verifications');
    await store.setJSON(sessionId, record);
    if (vendorData) {
      await store.setJSON('vendor_' + vendorData, record);
    }
    console.log('Recorded verification: ' + sessionId + ' status=' + status + ' vendor=' + vendorData);
  } catch (e) {
    console.log('Blob store error: ' + e.message);
    // Still return 200 so Didit does not retry-storm; we logged it.
  }

  // Return 2xx quickly
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
