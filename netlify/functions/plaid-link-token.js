// ============================================================
//  plaid-link-token.js  ·  version plt-v9  (deploy-ready)
//  Creates a Plaid Link token for Bank Income, gated behind a
//  confirmed $5 Stripe payment. Uses the user_token model.
//
//  NOTE: Bank Income requires a Plaid USER TOKEN. New Plaid accounts
//  (created after 2025-12-10) must REQUEST user-token access from Plaid
//  before /user/create returns a token. Until granted, this returns
//  "plaid_user_token_not_enabled" with the user_id we did get.
//
//  POST { sessionId, memberId? } -> { _v, link_token }
//  Env: PLAID_CLIENT_ID, PLAID_ENV, PLAID_SANDBOX_SECRET,
//       PLAID_PRODUCT_SECRET, STRIPE_SECRET_KEY,
//       NETLIFY_SITE_ID, NETLIFY_BLOBS_TOKEN
//  Deps: plaid, stripe, @netlify/blobs
// ============================================================

const FN_VERSION = 'plt-v9';  // <-- deployed version; echoed as _v in every response

const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const { getStore } = require('@netlify/blobs');
const Stripe = require('stripe');

const ALLOWED_ORIGIN = 'https://www.renters.com';
const PLAID_WEBHOOK = 'https://renters-story-writer.netlify.app/.netlify/functions/plaid-webhook';

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

function plaidClient() {
  const env = process.env.PLAID_ENV === 'production' ? 'production' : 'sandbox';
  const secret = env === 'production' ? process.env.PLAID_PRODUCT_SECRET : process.env.PLAID_SANDBOX_SECRET;
  return new PlaidApi(new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: { headers: { 'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID, 'PLAID-SECRET': secret } },
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
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ _v: FN_VERSION, error: 'Method not allowed' }) };

  try {
    let { memberId, sessionId } = JSON.parse(event.body || '{}');

    // ---- Gate: confirm the $5 was paid; derive memberId from the session if needed ----
    let paid = false;
    if (sessionId && process.env.STRIPE_SECRET_KEY) {
      try {
        const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
        const s = await stripe.checkout.sessions.retrieve(sessionId);
        const sessionMember = String((s && s.metadata && s.metadata.memberId) || '');
        if (!memberId && sessionMember) memberId = sessionMember;
        if (s && s.payment_status === 'paid' && sessionMember && String(sessionMember) === String(memberId)) paid = true;
      } catch (e) { /* fall through */ }
    }
    if (!memberId) return { statusCode: 400, headers: cors, body: JSON.stringify({ _v: FN_VERSION, error: 'memberId required' }) };
    if (!paid) {
      try {
        const store = rdcStore('prequalify-status');
        const rec = await store.get(String(memberId), { type: 'json' });
        if (rec && rec.paid) paid = true;
      } catch (e) {}
    }
    if (!paid) return { statusCode: 402, headers: cors, body: JSON.stringify({ _v: FN_VERSION, error: 'payment_not_confirmed' }) };

    const plaid = plaidClient();

    // ---- Get or create the Plaid user + user_token (required for Bank Income) ----
    const users = rdcStore('plaid-users');
    let userRec = null;
    try { userRec = await users.get(String(memberId), { type: 'json' }); } catch (e) {}
    let userToken = userRec && userRec.user_token;
    let userId = userRec && userRec.user_id;
    const clientUserId = 'rdc-' + memberId;

    if (!userToken) {
      const u = await plaid.userCreate({ client_user_id: clientUserId });
      userToken = u.data && u.data.user_token;   // present only once Plaid enables user tokens
      userId = u.data && u.data.user_id;
      await users.set(String(memberId), JSON.stringify({
        user_token: userToken || null,
        user_id: userId,
        client_user_id: clientUserId,
        memberId: String(memberId),
        createdAt: new Date().toISOString(),
      }));
    }

    // If Plaid has not yet enabled user tokens for this (new) account, /user/create
    // returns only a user_id. Bank Income cannot proceed until Plaid grants access.
    if (!userToken) {
      return {
        statusCode: 409,
        headers: cors,
        body: JSON.stringify({
          _v: FN_VERSION,
          error: 'plaid_user_token_not_enabled',
          detail: 'Request user-token access for Bank Income from Plaid support. /user/create returned only a user_id.',
          user_id: userId || null,
        }),
      };
    }

    // ---- Create the Bank Income Link token ----
    const lt = await plaid.linkTokenCreate({
      user: { client_user_id: clientUserId },
      user_token: userToken,
      client_name: 'Renters.com',
      products: ['income_verification'],
      income_verification: { income_source_types: ['bank'], bank_income: { days_requested: 120 } },
      country_codes: ['US'],
      language: 'en',
      webhook: PLAID_WEBHOOK,
    });

    return { statusCode: 200, headers: cors, body: JSON.stringify({ _v: FN_VERSION, link_token: lt.data.link_token }) };
  } catch (err) {
    const msg = (err.response && err.response.data) ? JSON.stringify(err.response.data) : err.message;
    console.log('plaid-link-token error: ' + msg);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ _v: FN_VERSION, error: msg }) };
  }
};
