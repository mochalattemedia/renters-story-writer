/* ============================================================
   netlify/lib/vi-token.js — v1
   Shared prefill-token helpers for the Vertical Insure flow.
   Tokens are <random-id>.<hmac>. The id resolves to a Blobs record
   server-side, so no renter PII ever rides in an email URL.
   Env: VI_TOKEN_SECRET, RDC_INTERNAL_SECRET,
        NETLIFY_SITE_ID, NETLIFY_BLOBS_TOKEN
   ============================================================ */
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

export function rdcStore(name) {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    try { return getStore({ name, siteID, token }); } catch (e) { /* fall through */ }
  }
  return getStore(name);
}

// Must match the prefill keys rdc-vi-offer.js reads.
export const FIELDS = [
  'email','first','last','street','unit','city','state','zip','start','rental',
  'llName','llEmail','llStreet','llCity','llState','llZip'
];

export function pick(obj) {
  const out = {};
  if (!obj) return out;
  for (const k of FIELDS) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') out[k] = String(v).trim().slice(0, 120);
  }
  return out;
}

function sig(id) {
  const secret = process.env.VI_TOKEN_SECRET;
  if (!secret) throw new Error('VI_TOKEN_SECRET missing');
  return crypto.createHmac('sha256', secret).update(id, 'utf8').digest('base64url').slice(0, 32);
}

export async function mint(prefill, ttlDays = 30) {
  const id = crypto.randomUUID().replace(/-/g, '');
  await rdcStore('vi-prefill').setJSON(id, {
    prefill: pick(prefill),
    created_at: new Date().toISOString(),
    expires_at: Date.now() + ttlDays * 86400000
  });
  return `${id}.${sig(id)}`;
}

export async function redeem(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [id, given] = token.split('.');
  if (!/^[a-f0-9]{32}$/.test(id || '')) return null;

  const want = Buffer.from(sig(id), 'utf8');
  const got  = Buffer.from(String(given || ''), 'utf8');
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;

  const rec = await rdcStore('vi-prefill').get(id, { type: 'json' });
  if (!rec) return null;
  if (rec.expires_at && Date.now() > rec.expires_at) return null;
  return rec.prefill || null;
}

// Guards the mint + send endpoints so only your own systems can call them.
export function authorized(req) {
  const secret = process.env.RDC_INTERNAL_SECRET;
  if (!secret) return false;
  const a = Buffer.from(secret, 'utf8');
  const b = Buffer.from(req.headers.get('x-rdc-secret') || '', 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
