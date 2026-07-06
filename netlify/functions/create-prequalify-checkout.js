// create-prequalify-checkout.js
// Creates a $5 Stripe Checkout Session for the Prequalified income tier.
// Money only. Verification happens after payment (see prequalify-verify page + income-verify.js).
// Env vars: STRIPE_SECRET_KEY
// Reached at: https://renters-story-writer.netlify.app/.netlify/functions/create-prequalify-checkout

const Stripe = require('stripe');

const ALLOWED_ORIGIN = 'https://www.renters.com';

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const { memberId, email, householdId } = JSON.parse(event.body || '{}');

    if (!memberId) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'memberId required' }) };
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: 500, // $5.00 — bump to 700 if the real Plaid pull pushes past $5
          product_data: {
            name: 'Renters.com Prequalified',
            description: 'Verify your income and earn your Prequalified mark.',
          },
        },
      }],
      customer_email: email || undefined,
      metadata: {
        memberId: String(memberId),
        householdId: householdId ? String(householdId) : '',
        purpose: 'prequalify_income',
      },
      success_url: 'https://www.renters.com/prequalify-verify?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://www.renters.com/account/home?prequalify=cancelled',
    });

    return { statusCode: 200, headers: cors, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
