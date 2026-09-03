/* ============================================================
   netlify/functions/vi-webhook.js — v1
   Vertical Insure webhook receiver for Renters.com
   Env: VI_WEBHOOK_SIGNING_KEY, NETLIFY_SITE_ID, NETLIFY_BLOBS_TOKEN
   Configure URL at partners.verticalinsure.com/webhooks:
     https://renters.com/.netlify/functions/vi-webhook
   ============================================================ */
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const FILE = 'vi-webhook.js v1';

function rdcStore(name) {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    try { return getStore({ name, siteID, token }); } catch (e) { /* fall through */ }
  }
  return getStore(name);
}

function verify(raw, header) {
  const key = process.env.VI_WEBHOOK_SIGNING_KEY;
  if (!key) { console.error(`[${FILE}] VI_WEBHOOK_SIGNING_KEY missing`); return false; }
  if (!header) return false;
  const sent = String(header).trim().replace(/^sha256=/i, '');
  const calc = crypto.createHmac('sha256', key).update(raw, 'utf8').digest('hex');
  const a = Buffer.from(calc, 'utf8');
  const b = Buffer.from(sent.toLowerCase(), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const STATUS = {
  policy_bind_complete:    'active',
  policy_bind_failed:      'bind_failed',
  policy_purchase_invalid: 'purchase_invalid',
  policy_payment_failed:   'payment_failed',
  policy_canceled:         'canceled',
  policy_endorsed:         'endorsed'
};

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

  const type = body.event || body.type || body.event_type || 'unknown';
  const now  = new Date().toISOString();
  const events   = rdcStore('vi-events');
  const policies = rdcStore('vi-policies');

  // Always keep the raw event — cheap audit trail, survives schema drift.
  const evKey = `${now.replace(/[:.]/g, '-')}-${type}-${Math.random().toString(36).slice(2, 8)}`;
  await events.setJSON(evKey, { type, received_at: now, body });

  try {
    if (type === 'payout_report_published' || type === 'payout_payment_sent') {
      await rdcStore('vi-payouts').setJSON(evKey, { type, received_at: now, body });
      console.log(`[${FILE}] payout event ${type}`);
      return new Response('ok', { status: 200 });
    }

    const p   = body.policy || body.data || body;
    const id  = p.policy_id || p.id || p.policy_number || body.policy_id;
    const cur = body.current_policy || null;   // policy_endorsed carries prev + current
    const rec = cur || p;

    if (!id) {
      console.warn(`[${FILE}] ${type} with no policy id`);
      return new Response('ok', { status: 200 });
    }

    const prev = (await policies.get(String(id), { type: 'json' })) || {};
    const merged = {
      ...prev,
      policy_id: String(id),
      status: STATUS[type] || prev.status || 'unknown',
      product: rec.product || prev.product || 'renters',
      test: rec.test ?? body.test ?? prev.test ?? null,
      customer: {
        email_address: rec.customer?.email_address || prev.customer?.email_address || null,
        first_name:    rec.customer?.first_name    || prev.customer?.first_name    || null,
        last_name:     rec.customer?.last_name     || prev.customer?.last_name     || null
      },
      premium: rec.premium ?? rec.premium_amount ?? prev.premium ?? null,
      effective_date:  rec.effective_date  || prev.effective_date  || null,
      expiration_date: rec.expiration_date || prev.expiration_date || null,
      version: rec.version ?? prev.version ?? null,
      last_event: type,
      updated_at: now,
      created_at: prev.created_at || now,
      history: [...(prev.history || []), { type, at: now }].slice(-50)
    };

    await policies.setJSON(String(id), merged);

    const email = merged.customer.email_address;
    if (email) {
      const idx = rdcStore('vi-policies-by-email');
      const key = email.trim().toLowerCase();
      const list = (await idx.get(key, { type: 'json' })) || [];
      if (!list.includes(String(id))) {
        list.push(String(id));
        await idx.setJSON(key, list);
      }
    }

    console.log(`[${FILE}] ${type} -> policy ${id} status ${merged.status}`);
  } catch (err) {
    // Never 500 on a bookkeeping failure — the raw event is already stored,
    // and a 500 makes VI retry a webhook we did in fact receive.
    console.error(`[${FILE}] processing error`, err);
  }

  return new Response('ok', { status: 200 });
};
