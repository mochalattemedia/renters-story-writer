// ============================================================
//  plaid-link-token.js  ·  Creates a Plaid Link token for Bank Income,
//  gated behind a confirmed $5 Stripe payment.
//  POST { memberId, sessionId } -> { link_token }
//  Env: PLAID_CLIENT_ID, PLAID_ENV (sandbox|production),
//       PLAID_SANDBOX_SECRET, PLAID_PRODUCT_SECRET, STRIPE_SECRET_KEY
//  Deps (package.json): plaid, stripe, @netlify/blobs
// ============================================================

const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const { getStore } = require('@netlify/blobs');
const Stripe = require('stripe');

const ALLOWED_ORIGIN = 'https://www.renters.com';
const PLAID_WEBHOOK = 'https://renters-story-writer.netlify.app/.netlify/functions/plaid-webhook';

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

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { memberId, sessionId } = JSON.parse(event.body || '{}');
    if (!memberId) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'memberId required' }) };

    // ---- Gate: confirm the $5 was paid ----
    let paid = false;

    // 1) Source of truth: verify the Stripe session directly (no webhook race).
    if (sessionId && process.env.STRIPE_SECRET_KEY) {
      try {
        const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
        const s = await stripe.checkout.sessions.retrieve(sessionId);
        if (s && s.payment_status === 'paid' && String((s.metadata || {}).memberId) === String(memberId)) {
          paid = true;
        }
      } catch (e) { /* fall through to blob check */ }
    }

    // 2) Fallback: the webhook already marked them paid.
    if (!paid) {
      try {
        const store = getStore('prequalify-status');
        const rec = await store.get(String(memberId), { type: 'json' });
        if (rec && rec.paid) paid = true;
      } catch (e) { /* not found */ }
    }

    if (!paid) {
      return { statusCode: 402, headers: cors, body: JSON.stringify({ error: 'payment_not_confirmed' }) };
    }

    const plaid = plaidClient();

    // ---- Get or create the Plaid user for this member (one user per member) ----
    const users = getStore('plaid-users');
    let userRec = null;
    try { userRec = await users.get(String(memberId), { type: 'json' }); } catch (e) {}
    let userToken = userRec && userRec.user_token;

    if (!userToken) {
      const u = await plaid.userCreate({ client_user_id: 'rdc-' + memberId });
      userToken = u.data.user_token;
      await users.set(String(memberId), JSON.stringify({
        user_token: userToken,
        user_id: u.data.user_id,
        memberId: String(memberId),
        createdAt: new Date().toISOString(),
      }));
    }

    // ---- Create the Bank Income Link token ----
    const lt = await plaid.linkTokenCreate({
      user: { client_user_id: 'rdc-' + memberId },
      user_token: userToken,
      client_name: 'Renters.com',
      products: ['income_verification'],
      income_verification: {
        income_source_types: ['bank'],
        bank_income: { days_requested: 120 },
      },
      country_codes: ['US'],
      language: 'en',
      webhook: PLAID_WEBHOOK,
    });

    return { statusCode: 200, headers: cors, body: JSON.stringify({ link_token: lt.data.link_token }) };
  } catch (err) {
    const msg = (err.response && err.response.data) ? JSON.stringify(err.response.data) : err.message;
    console.log('plaid-link-token error: ' + msg);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: msg }) };
  }
};
