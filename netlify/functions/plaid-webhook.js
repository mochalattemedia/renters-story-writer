// plaid-webhook.js
// Receives Plaid webhooks (Income verification lifecycle).
// INSTALL THIS URL IN PLAID (Dashboard > Developers > Webhooks) and pass it as
// `webhook` in /link/token/create:
//   https://renters-story-writer.netlify.app/.netlify/functions/plaid-webhook
//
// Env vars: PLAID_CLIENT_ID, PLAID_ENV (sandbox|production),
//           PLAID_SANDBOX_SECRET, PLAID_PRODUCT_SECRET
// Deps (package.json): plaid, jose, @netlify/blobs

const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const { getStore } = require('@netlify/blobs');
const { importJWK, jwtVerify, decodeProtectedHeader } = require('jose');
const crypto = require('crypto');

function plaidClient() {
  const env = process.env.PLAID_ENV === 'production' ? 'production' : 'sandbox';
  const secret = env === 'production'
    ? process.env.PLAID_PRODUCT_SECRET
    : process.env.PLAID_SANDBOX_SECRET;
  return new PlaidApi(new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': secret,
      },
    },
  }));
}

// Verify the Plaid-Verification JWT. Best-effort: never blocks the 200 response.
async function verifyPlaid(event) {
  try {
    const headers = event.headers || {};
    const token = headers['plaid-verification'] || headers['Plaid-Verification'];
    if (!token) return false;

    const { kid, alg } = decodeProtectedHeader(token);
    if (alg !== 'ES256') return false;

    const res = await plaidClient().webhookVerificationKeyGet({ key_id: kid });
    const key = await importJWK(res.data.key, 'ES256');
    const { payload } = await jwtVerify(token, key, { maxTokenAge: '5 min' });

    const bodyHash = crypto
      .createHash('sha256')
      .update(event.body || '', 'utf8')
      .digest('hex');

    return payload.request_body_sha256 === bodyHash;
  } catch (e) {
    console.error('plaid verify failed:', e.message);
    return false;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const verified = await verifyPlaid(event);

  const record = {
    receivedAt: new Date().toISOString(),
    verified,
    webhook_type: body.webhook_type || null,
    webhook_code: body.webhook_code || null,
    item_id: body.item_id || null,
    user_id: body.user_id || null,
    environment: body.environment || null,
    raw: body,
  };

  try {
    const store = getStore('plaid-webhooks');
    const key = `${record.webhook_type || 'UNKNOWN'}:${record.item_id || record.user_id || 'na'}:${Date.now()}`;
    await store.set(key, JSON.stringify(record));
  } catch (e) {
    console.error('blob write failed:', e.message);
  }

  // Income lifecycle signals we act on (processing lands with income-verify.js, file 5):
  //   webhook_type INCOME + code BANK_INCOME_REFRESH_COMPLETE  -> bank income ready
  //   webhook_type INCOME + code INCOME_VERIFICATION           -> payroll; check verification_status
  // On completion, income-verify.js pulls income, scores income-to-rent, writes the
  // Prequalified BD tag, and SES-notifies Kenny.

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
