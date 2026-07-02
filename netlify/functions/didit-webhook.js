// netlify/functions/didit-webhook.js
// Receives Didit verification results, verifies HMAC-SHA256 over the RAW body,
// then stores the outcome into the existing "verification-log" Netlify Blobs store.

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'verification-log';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const secret = process.env.DIDIT_WEBHOOK_SECRET;
  if (!secret) {
    console.log('DIDIT_WEBHOOK_SECRET not set');
    return { statusCode: 500, body: 'Not configured' };
  }

  const rawBody = event.body || '';
  const signature = (event.headers['x-signature'] || event.headers['X-Signature'] || '').trim();
  const timestamp = (event.headers['x-timestamp'] || event.headers['X-Timestamp'] || '').trim();

  if (!signature) {
    console.log('Missing x-signature header');
    return { statusCode: 401, body: 'Unauthorized' };
  }

  if (timestamp) {
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
      console.log('Stale timestamp');
      return { statusCode: 401, body: 'Unauthorized (stale)' };
    }
  }

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

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (e) {
    return { statusCode: 400, body: 'Bad JSON' };
  }

  const sessionId   = body.session_id || '';
  const status      = body.status || '';
  const vendorData  = body.vendor_data || '';
  const webhookType = body.webhook_type || '';
  const decision    = body.decision || {};
  const idv = (decision && decision.id_verification) || {};

  const record = {
    source: 'didit',
    session_id: sessionId,
    status: status,
    vendor_data: vendorData,
    webhook_type: webhookType,
    first_name: idv.first_name || (decision.expected_details && decision.expected_details.first_name) || '',
    last_name: idv.last_name || (decision.expected_details && decision.expected_details.last_name) || '',
    document_type: idv.document_type || '',
    date_of_birth: idv.date_of_birth || '',
    expiration_date: idv.expiration_date || '',
    features: (decision && decision.features) || [],
    received_at: new Date().toISOString()
  };

  try {
    const store = getStore(STORE_NAME);
    await store.setJSON('didit_' + sessionId, record);
    if (vendorData) {
      await store.setJSON('didit_member_' + vendorData, record);
    }
    console.log('Recorded Didit verification: ' + sessionId + ' status=' + status + ' vendor=' + vendorData);
  } catch (e) {
    console.log('Blob store error: ' + e.message);
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
