/* ============================================================
   netlify/functions/vi-prefill.js — v1
   GET  ?t=<token>  -> { prefill: {...} }   (public, called by the page)
   POST             -> { token, url }       (internal, x-rdc-secret)
   ============================================================ */
import { mint, redeem, authorized } from '../lib/vi-token.js';

const FILE = 'vi-prefill.js v1';
const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

export default async (req) => {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const t = url.searchParams.get('t');
    let prefill = null;
    try { prefill = await redeem(t); }
    catch (err) { console.error(`[${FILE}] redeem error`, err); }
    // Always 200 with an empty object on a bad token — the page then just
    // shows the blank quick form instead of an error the renter can't fix.
    return new Response(JSON.stringify({ prefill: prefill || {} }), { status: 200, headers: JSON_HEADERS });
  }

  if (req.method === 'POST') {
    if (!authorized(req)) return new Response('Unauthorized', { status: 401 });

    let body;
    try { body = await req.json(); }
    catch { return new Response('Bad JSON', { status: 400 }); }

    try {
      const token = await mint(body.prefill || body, Number(body.ttl_days) || 30);
      const site  = (process.env.SITE_URL || 'https://renters.com').replace(/\/$/, '');
      const path  = body.path || '/renters-insurance';
      return new Response(
        JSON.stringify({ token, url: `${site}${path}?vi=${encodeURIComponent(token)}` }),
        { status: 200, headers: JSON_HEADERS }
      );
    } catch (err) {
      console.error(`[${FILE}] mint error`, err);
      return new Response('Mint failed', { status: 500 });
    }
  }

  return new Response('Method not allowed', { status: 405 });
};
