// ============================================================
//  stripe-webhook.js  ·  Receives Stripe payment results
//  Verifies the Stripe signature over the RAW body, and on a
//  completed $5 Prequalified checkout, marks the member "paid"
//  in the prequalify-status Blob (keyed by BD member ID from
//  session metadata) and emails a notification to the hub.
//  Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SES_* (as elsewhere)
//  Deps (package.json): stripe, @netlify/blobs

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

const Stripe = require('stripe');
const { getStore } = require('@netlify/blobs');
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

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) {
    console.log('Stripe env not set');
    return { statusCode: 500, body: 'Not configured' };
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const rawBody = event.body || '';
  const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'] || '';

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (e) {
    console.log('Stripe signature mismatch: ' + e.message);
    return { statusCode: 401, body: 'Unauthorized (bad signature)' };
  }

  // We only act on a completed checkout for the Prequalified tier.
  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: JSON.stringify({ ok: true, ignored: stripeEvent.type }) };
  }

  const session = stripeEvent.data.object || {};
  const md = session.metadata || {};
  const memberId = (md.memberId || '').toString().trim();
  const householdId = (md.householdId || '').toString().trim();
  const email = (session.customer_details && session.customer_details.email) || session.customer_email || '';
  const amount = (session.amount_total != null) ? (session.amount_total / 100).toFixed(2) : '5.00';
  const paidOk = session.payment_status === 'paid';

  if (md.purpose !== 'prequalify_income') {
    return { statusCode: 200, body: JSON.stringify({ ok: true, ignored: 'purpose' }) };
  }

  if (!memberId) {
    console.log('Stripe webhook: paid but no memberId in metadata, session=' + session.id);
    await notify('💳⚠️ Prequalify paid, NO member id',
      'A $' + amount + ' Prequalified payment completed but carried no member id.\n\n' +
      'Session:  ' + session.id + '\n' +
      'Email:    ' + (email || '(none)') + '\n\n' +
      'Look it up in Stripe and tag by hand.');
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'no member id' }) };
  }

  // ---- Mark member paid (income verification not run yet) ----
  const record = {
    memberId: memberId,
    householdId: householdId || null,
    email: email || null,
    amount: amount,
    paid: paidOk,
    stripeSessionId: session.id,
    paymentIntent: session.payment_intent || null,
    stage: 'paid',            // paid -> income-linked -> income-verified
    paidAt: new Date().toISOString(),
  };

  try {
    const store = rdcStore('prequalify-status');
    await store.set(memberId, JSON.stringify(record));
    console.log('Stripe -> prequalify-status: member=' + memberId + ' session=' + session.id + ' paid=' + paidOk);
  } catch (e) {
    console.log('prequalify-status write error: ' + e.message);
  }

  // ---- Notify the hub ----
  await notify('💳 Prequalify PAID $' + amount + ' — Member #' + memberId,
    'A renter paid for Prequalified income verification on Renters.com\n\n' +
    'Member ID: ' + memberId + '\n' +
    (householdId ? 'Household: ' + householdId + '\n' : '') +
    'Email:     ' + (email || '(none)') + '\n' +
    'Amount:    $' + amount + '\n' +
    'Session:   ' + session.id + '\n\n' +
    'Next: renter links income (Plaid). Income result will land via income-verify.\n' +
    'Automated notification from Stripe.'
  );

  return { statusCode: 200, body: JSON.stringify({ ok: true, memberId: memberId, stage: 'paid' }) };
};
