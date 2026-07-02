// ============================================================
//  didit-webhook.js  ·  Receives Didit verification results
//  Verifies HMAC-SHA256 over the RAW body, then writes the
//  outcome into verify-log (the store verify-panel.js reads),
//  keyed by BD member ID (from Didit vendor_data).
//  Approved -> identity-confirmed | Declined -> denied | else pending
//  Env: DIDIT_WEBHOOK_SECRET (required)
// ============================================================

const crypto = require('crypto');

const VERIFY_LOG_URL = process.env.VERIFY_LOG_URL
  || 'https://renters-story-writer.netlify.app/.netlify/functions/verify-log';
const VERIFY_LOG_KEY = process.env.VERIFY_LOG_KEY || 'renters2026';

function post(url, payload) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function (r) { return r.json().catch(function () { return null; }); });
}

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
  } catch (e) { valid = false; }
  if (!valid) {
    console.log('Signature mismatch');
    return { statusCode: 401, body: 'Unauthorized (bad signature)' };
  }

  let body;
  try { body = JSON.parse(rawBody); } catch (e) { return { statusCode: 400, body: 'Bad JSON' }; }

  const sessionId   = body.session_id || '';
  const diditStatus = (body.status || '').toString();
  const memberId    = (body.vendor_data || '').toString().trim();
  const decision    = body.decision || {};
  const idv = (decision && decision.id_verification) || {};

  if (!memberId || memberId === 'renter' || /^live-test/i.test(memberId) || /^test/i.test(memberId)) {
    console.log('Didit webhook: no usable member id (vendor_data="' + memberId + '") session=' + sessionId + ' status=' + diditStatus);
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'no member id' }) };
  }

  let logStatus = 'pending';
  let reasons = [];
  let note = '';
  const s = diditStatus.toLowerCase();
  if (s === 'approved') {
    logStatus = 'identity-confirmed';
    note = 'Didit: identity confirmed (ID + liveness + face match)';
  } else if (s === 'declined') {
    logStatus = 'denied';
    reasons = ['Didit declined'];
    const warnings = (decision && decision.warnings) || [];
    if (Array.isArray(warnings) && warnings.length) {
      note = 'Didit declined: ' + warnings.map(function (w) { return w.risk || w.reason || w; }).join('; ');
    } else {
      note = 'Didit declined the verification';
    }
  } else {
    logStatus = 'pending';
    note = 'Didit status: ' + diditStatus;
  }

  const name = (idv.first_name || idv.last_name)
    ? [idv.first_name, idv.last_name].filter(Boolean).join(' ')
    : '';

  try {
    await post(VERIFY_LOG_URL, {
      action: 'record',
      key: VERIFY_LOG_KEY,
      memberId: memberId,
      inquiryId: sessionId,
      name: name,
      submitted: new Date().toISOString()
    });
    await post(VERIFY_LOG_URL, {
      action: 'update',
      key: VERIFY_LOG_KEY,
      memberId: memberId,
      inquiryId: sessionId,
      status: logStatus,
      reasons: reasons,
      note: note,
      decidedBy: 'didit'
    });
    console.log('Didit -> verify-log: member=' + memberId + ' session=' + sessionId + ' status=' + logStatus);
  } catch (e) {
    console.log('verify-log write error: ' + e.message);
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, memberId: memberId, status: logStatus }) };
};
