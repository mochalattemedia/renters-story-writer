// ============================================================
//  plaid-link-token.js  ·  Creates a Plaid Link token for Bank Income,
//  gated behind a confirmed $5 Stripe payment.
//  POST { memberId, sessionId } -> { link_token }
//  Env: PLAID_CLIENT_ID, PLAID_ENV (sandbox|production),
//       PLAID_SANDBOX_SECRET, PLAID_PRODUCT_SECRET, STRIPE_SECRET_KEY
//  Deps (package.json): plaid, stripe, @netlify/blobs

// Safe Blobs store: use Netlify's auto context, fall back to explicit siteID/token.
function rdcStore(name) {
  try { return getStore(name); }
  catch (e) {
    return getStore({
      name: name,
      siteID: process.env.NETLIFY_SITE_ID || process.env.SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_AUTH_TOKEN
    });
  }
}
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
    let { memberId, sessionId } = JSON.parse(event.body || '{}');

    // ---- Gate: confirm the $5 was paid; derive memberId from the session if needed ----
    let paid = false;

    // 1) Source of truth: verify the Stripe session directly (no webhook race).
    //    If the page couldn't read a memberId (this page has no logged_user field),
    //    pull it straight from the paid session's metadata.
    if (sessionId && process.env.STRIPE_SECRET_KEY) {
      try {
        const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
        const s = await stripe.checkout.sessions.retrieve(sessionId);
        const sessionMember = String((s && s.metadata && s.metadata.memberId) || '');
        if (!memberId && sessionMember) memberId = sessionMember;
        if (s && s.payment_status === 'paid' && sessionMember && String(sessionMember) === String(memberId)) {
          paid = true;
        }
      } catch (e) { /* fall through to blob check */ }
    }

    if (!memberId) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'memberId required' }) };

    // 2) Fallback: the webhook already marked them paid.
    if (!paid) {
      try {
        const store = rdcStore('prequalify-status');
        const rec = await store.get(String(memberId), { type: 'json' });
        if (rec && rec.paid) paid = true;
      } catch (e) { /* not found */ }
    }

    if (!paid) {
      return { statusCode: 402, headers: cors, body: JSON.stringify({ error: 'payment_not_confirmed' }) };
    }

    const plaid = plaidClient();

    // ---- Get or create the Plaid user for this member (one user per member) ----
    const users = rdcStore('plaid-users');
    let userRec = null;
    try { userRec = await users.get(String(memberId), { type: 'json' }); } catch (e) {}
    let userToken = userRec && userRec.user_token;
    const clientUserId = 'rdc-' + memberId;

    // Create the Plaid user if we don't have a valid token yet. If Plaid says the
    // user already exists but we lost the token, make a fresh unique user id so we
    // always end up with a usable user_token (Bank Income requires it).
    if (!userToken) {
      try {
        const u = await plaid.userCreate({ client_user_id: clientUserId });
        userToken = u.data.user_token;
        await users.set(String(memberId), JSON.stringify({
          user_token: userToken,
          user_id: u.data.user_id,
          client_user_id: clientUserId,
          memberId: String(memberId),
          createdAt: new Date().toISOString(),
        }));
      } catch (e) {
        // user_id already exists (from a prior partial run) but we don't have the
        // token — create a fresh uniquely-suffixed user so we get a token back.
        const freshId = clientUserId + '-' + Date.now();
        const u2 = await plaid.userCreate({ client_user_id: freshId });
        userToken = u2.data.user_token;
        await users.set(String(memberId), JSON.stringify({
          user_token: userToken,
          user_id: u2.data.user_id,
          client_user_id: freshId,
          memberId: String(memberId),
          createdAt: new Date().toISOString(),
        }));
      }
    }

    if (!userToken) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'could_not_create_plaid_user' }) };
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
