/* ============================================================
   netlify/functions/vi-webhook.js — v2
   Vertical Insure webhook receiver for Renters.com
   v2: rebuilt against the published payload schema —
       body.data envelope, is_test, premium_amount, policy_status,
       endorsement previous/current split, null-data payout events.
   Env: VI_WEBHOOK_SIGNING_KEY, NETLIFY_SITE_ID, NETLIFY_BLOBS_TOKEN
   URL to register at partners.verticalinsure.com/webhooks:
     https://renters.com/.netlify/functions/vi-webhook
   ============================================================ */
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const FILE = 'vi-webhook.js v2';

function rdcStore(name) {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    try { return getStore({ name, siteID, token }); } catch (e) { /* fall through */ }
  }
  return getStore(name);
}

// Signature = hex HMAC-SHA256 of the raw JSON body, keyed with the
// webhook's signature_key. Must hash the RAW text, never a re-serialized object.
function verify(raw, header) {
  const key = process.env.VI_WEBHOOK_SIGNING_KEY;
  if (!key) { console.error(`[${FILE}] VI_WEBHOOK_SIGNING_KEY missing`); return false; }
  if (!header) return false;
  const sent = String(header).trim().replace(/^sha256=/i, '').toLowerCase();
  const calc = crypto.createHmac('sha256', key).update(raw, 'utf8').digest('hex');
  const a = Buffer.from(calc, 'utf8');
  const b = Buffer.from(sent, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const FALLBACK_STATUS = {
  policy_bind_complete:    'ACTIVE',
  policy_bind_failed:      'BIND_FAILED',
  policy_purchase_invalid: 'PENDING',
  policy_payment_failed:   'REQUIRES_PAYMENT',
  policy_canceled:         'CANCELED',
  policy_endorsed:         'ACTIVE'
};

const PAYOUT_EVENTS = ['payout_report_published', 'payout_payment_sent'];

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const raw = await req.text();
  const sig = req.headers.get('verticalinsure-signature');

  if (!verify(raw, sig)) {
    console.warn(`[${FILE}] rejected: bad signature`);
    return new Response('Invalid signature', { status: 401 });
  }

  let body;
  try { body = JSON.parse(raw); }
  catch { return new Response('Bad JSON', { status: 400 }); }

  const type = body.event || 'unknown';
  const now  = new Date().toISOString();
  const stamp = now.replace(/[:.]/g, '-');

  // Raw event always lands first — audit trail that survives any schema drift.
  const evKey = `${stamp}-${type}-${Math.random().toString(36).slice(2, 8)}`;
  await rdcStore('vi-events').setJSON(evKey, { type, received_at: now, body });

  try {
    // payout_* events carry data: null — nothing to reconcile, just record.
    if (PAYOUT_EVENTS.includes(type)) {
      await rdcStore('vi-payouts').setJSON(evKey, { type, received_at: now, body });
      console.log(`[${FILE}] ${type} recorded`);
      return new Response('ok', { status: 200 });
    }

    const data = body.data || {};
    const isEndorsement = type === 'policy_endorsed';
    const rec  = isEndorsement ? (data.current_policy  || {}) : data;
    const prevRec = isEndorsement ? (data.previous_policy || {}) : null;

    const id = rec.id || rec.policy_number;
    if (!id) {
      console.warn(`[${FILE}] ${type} carried no policy id`);
      return new Response('ok', { status: 200 });
    }

    const policies = rdcStore('vi-policies');
    const prev = (await policies.get(String(id), { type: 'json' })) || {};

    // Endorsement payloads have no customer block — carry it forward from the
    // prior record, and from the policy being endorsed if we tracked that one.
    let customer = data.customer || prev.customer || null;
    if (!customer && isEndorsement && prevRec.id) {
      const older = await policies.get(String(prevRec.id), { type: 'json' });
      if (older && older.customer) customer = older.customer;
    }

    const merged = {
      ...prev,
      id: String(id),
      policy_number:    rec.policy_number    ?? prev.policy_number    ?? null,
      master_policy_id: data.master_policy_id ?? prev.master_policy_id ?? null,
      quote_id:         rec.quote_id         ?? prev.quote_id         ?? null,
      policy_status:    rec.policy_status    ?? FALLBACK_STATUS[type] ?? prev.policy_status ?? 'UNKNOWN',
      customer: customer
        ? {
            first_name:    customer.first_name    ?? null,
            last_name:     customer.last_name     ?? null,
            email_address: customer.email_address ?? null
          }
        : null,
      premium_amount:   rec.premium_amount   ?? prev.premium_amount   ?? null,
      total:            rec.total            ?? prev.total            ?? null,
      currency:         rec.currency         ?? prev.currency         ?? 'USD',
      endorsement_price_changes: rec.endorsement_price_changes ?? prev.endorsement_price_changes ?? null,
      version:          rec.version          ?? prev.version          ?? null,
      quote_date:       rec.quote_date       ?? prev.quote_date       ?? null,
      issued_date:      rec.issued_date      ?? prev.issued_date      ?? null,
      effective_date:   rec.effective_date   ?? prev.effective_date   ?? null,
      expiration_date:  rec.expiration_date  ?? prev.expiration_date  ?? null,
      policy_attributes: rec.policy_attributes ?? prev.policy_attributes ?? null,
      is_test:          rec.is_test ?? prev.is_test ?? null,
      product: 'renters',
      endorses: isEndorsement ? (prevRec.id ?? null) : (prev.endorses ?? null),
      last_event: type,
      created_at: prev.created_at || now,
      updated_at: now,
      history: [...(prev.history || []), { type, at: now, status: rec.policy_status ?? null }].slice(-50)
    };

    await policies.setJSON(String(id), merged);

    // Endorsement supersedes the old policy record so the dashboard shows one live policy.
    if (isEndorsement && prevRec.id && String(prevRec.id) !== String(id)) {
      const older = (await policies.get(String(prevRec.id), { type: 'json' })) || {};
      await policies.setJSON(String(prevRec.id), {
        ...older,
        id: String(prevRec.id),
        policy_status: 'SUPERSEDED',
        superseded_by: String(id),
        updated_at: now
      });
    }

    const email = merged.customer && merged.customer.email_address;
    if (email) {
      const idx  = rdcStore('vi-policies-by-email');
      const key  = email.trim().toLowerCase();
      const list = (await idx.get(key, { type: 'json' })) || [];
      if (!list.includes(String(id))) {
        list.push(String(id));
        await idx.setJSON(key, list);
      }
    }

    console.log(`[${FILE}] ${type} -> ${id} status ${merged.policy_status} test ${merged.is_test}`);
  } catch (err) {
    // Bookkeeping failures never 500 — the raw event is already stored, and a
    // 500 makes VI retry an event we did in fact receive.
    console.error(`[${FILE}] processing error`, err);
  }

  return new Response('ok', { status: 200 });
};
