/* ============================================================
   netlify/functions/vi-offer-log.js — v1
   Public beacon target for rdc-vi-offer.js funnel events.
   Records offer views/selections so you can see who saw a quote
   and didn't buy. Deliberately stores no address or payment data.
   ============================================================ */
import { rdcStore } from '../lib/vi-token.js';

const FILE = 'vi-offer-log.js v1';
const ALLOWED = new Set(['offer-ready', 'offer-state-change', 'purchase-completed', 'third-party-policy-upload']);
const MAX_BYTES = 8000;

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const raw = await req.text();
  if (raw.length > MAX_BYTES) return new Response('Too large', { status: 413 });

  let body;
  try { body = JSON.parse(raw); }
  catch { return new Response('Bad JSON', { status: 400 }); }
  if (!ALLOWED.has(body.type)) return new Response('ok', { status: 202 });

  try {
    const d = body.detail || {};
    const quotes = Array.isArray(d.quotes) ? d.quotes : [];
    const now = new Date();
    const key = `${now.toISOString().slice(0, 10)}/${now.toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;

    await rdcStore('vi-offer-log').setJSON(key, {
      type: body.type,
      at: now.toISOString(),
      // Path only — query strings can carry the prefill token.
      path: (() => { try { return new URL(body.url).pathname; } catch { return null; } })(),
      offers_available: d.offersAvailable ?? null,
      product: d.product ?? null,
      quote_count: quotes.length,
      premiums: quotes.map((q) => q.premium_amount ?? q.premium ?? null).slice(0, 5)
    });
  } catch (err) {
    console.error(`[${FILE}] log error`, err);
  }

  return new Response('ok', { status: 200 });
};
