// ============================================================
//  didit-webhook.js
//  FN_VERSION: dwh-v2   (2026-07-11)
//
//  Changelog
//   dwh-v2  Jul 11  verify-log writes ONLY on approved/declined. Didit sends
//                   4 statuses (not started -> in progress -> approved/declined);
//                   writing on every status put abandoned sessions in the review
//                   queue with no selfie and no ID. Funnel EMAILS still fire at
//                   every stage (that pipeline is unchanged).
//   dwh-v1          HMAC verify + verify-log write on every status + SES funnel
//                   notifications to the hub.
// ============================================================
const FN_VERSION = "dwh-v2";
// ============================================================
//  didit-webhook.js  ·  Receives Didit verification results
//  Verifies HMAC-SHA256 over the RAW body, writes the outcome
//  into verify-log (keyed by BD member ID from vendor_data),
//  AND emails a funnel notification to the hub so every stage
//  (link opened -> in progress -> approved/declined) lands in
//  its own Renters/Identity bucket.
//  Env: DIDIT_WEBHOOK_SECRET (required), SES_* (as elsewhere)
// ============================================================

const crypto = require('crypto');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const ses = new SESClient({
  region: process.env.SES_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.SES_ACCESS_KEY_ID,
    secretAccessKey: process.env.SES_SECRET_ACCESS_KEY,
  },
});

const NOTIFY_TO = 'kenny@renters.com';
const NOTIFY_FROM = 'verify@renters.com';

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

// Fire an alert email to the hub. Never throws — email must not break the pipeline.
async function notify(subject, bodyText) {
  try {
    await ses.send(new SendEmailCommand({
      Source: NOTIFY_FROM,
      Destination: { ToAddresses: [NOTIFY_TO] },
      Message: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: { Text: { Data: bodyText, Charset: 'UTF-8' } },
      },
    }));
  } catch (e) {
    console.log('notify email error: ' + e.message);
  }
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

  const name = (idv.first_name || idv.last_name)
    ? [idv.first_name, idv.last_name].filter(Boolean).join(' ')
    : '';
const displayName = name || ('Member #' + (memberId || 'unknown'));
  const s = diditStatus.toLowerCase();

  // ---- EMAIL NOTIFICATION (funnel: every stage, own subject anchor) ----
  let subj;
  if (s === 'approved') {
    subj = '🆔 Identity APPROVED — ' + displayName;          // -> Renters/Identity
  } else if (s === 'declined') {
    subj = '🆔❌ Identity DECLINED — ' + displayName;         // -> Renters/Identity-Failed
  } else if (s === 'in progress') {
    subj = '🆔⏳ Identity IN PROGRESS — ' + displayName;      // -> Renters/Identity-Progress
  } else if (s === 'not started') {
    subj = '🆔🔗 Identity link opened — ' + displayName;      // -> Renters/Identity-Started
  } else {
    subj = '🆔 Identity ' + diditStatus + ' — ' + displayName;
  }
  await notify(subj,
    'Identity verification update on Renters.com\n\n' +
    'Name:      ' + displayName + '\n' +
    'Member ID: ' + (memberId || '(none)') + '\n' +
    'Session:   ' + sessionId + '\n' +
    'Status:    ' + diditStatus + '\n' +
    (sessionId ? 'Review:    https://verify.didit.me/session/' + sessionId + '\n' : '') +
    '\nAutomated notification from Didit.'
  );

  // ---- verify-log pipeline: ONLY real decisions land in the review queue ----
  // Didit sends: 'not started' (link opened) -> 'in progress' -> 'approved'/'declined'.
  // The first two have no selfie/ID yet, so they must NOT create queue records.
  // Emails above still fire for every stage (funnel visibility); only the final
  // decision is written to verify-log for inspection.
  if (s !== 'approved' && s !== 'declined') {
    console.log('Didit webhook: skipping verify-log write for non-decision status "' + diditStatus + '" (member=' + memberId + ', session=' + sessionId + ')');
    return { statusCode: 200, body: JSON.stringify({ ok: true, _v: FN_VERSION, skipped: 'non-decision status', status: diditStatus }) };
  }

  if (!memberId || memberId === 'renter' || /^live-test/i.test(memberId) || /^test/i.test(memberId)) {
    console.log('Didit webhook: no usable member id (vendor_data="' + memberId + '") session=' + sessionId + ' status=' + diditStatus);
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'no member id' }) };
  }

  let logStatus = 'pending';
  let reasons = [];
  let note = '';
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
