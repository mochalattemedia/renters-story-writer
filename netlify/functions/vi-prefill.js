/* ============================================================
   netlify/functions/vi-prefill.js — v2
   GET  ?t=<token>  -> { prefill: {...} }   (public, called by the page)
   POST             -> { token, url }       (internal, x-rdc-secret)

   v2: CORS. The BD page lives on www.renters.com and this function
       answers on renters-story-writer.netlify.app, so without these
       headers the browser blocks the response and every emailed link
       lands on a blank form. Origin is allow-listed, not "*" — the
       POST side mints tokens and should not be callable from anywhere.
   ============================================================ */
import { mint, redeem, authorized } from '../lib/vi-token.js';

const FILE = 'vi-prefill.js v2';

const ALLOWED = [
  'https://www.renters.com',
  'https://renters.com'
];

function cors(req) {
  const origin = req.headers.get('origin') || '';
  const allow = ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-rdc-secret',
    'access-control-max-age': '86400',
    'vary': 'Origin'
  };
}

export default async (req) => {
  const url = new URL(req.url);
  const headers = { ...cors(req), 'content-type': 'application/json', 'cache-control': 'no-store' };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors(req) });
  }

  if (req.method === 'GET') {
    const t = url.searchParams.get('t');
    let prefill = null;
    try { prefill = await redeem(t); }
    catch (err) { console.error(`[${FILE}] redeem error`, err); }
    // Always 200 with an empty object on a bad token — the page then just
    // shows the blank quick form instead of an error the renter can't fix.
    return new Response(JSON.stringify({ prefill: prefill || {} }), { status: 200, headers });
  }

  if (req.method === 'POST') {
    if (!authorized(req)) return new Response('Unauthorized', { status: 401, headers: cors(req) });

    let body;
    try { body = await req.json(); }
    catch { return new Response('Bad JSON', { status: 400, headers: cors(req) }); }

    try {
      const token = await mint(body.prefill || body, Number(body.ttl_days) || 30);
      const site  = (process.env.SITE_URL || 'https://www.renters.com').replace(/\/$/, '');
      const path  = body.path || '/renters-insurance';
      return new Response(
        JSON.stringify({ token, url: `${site}${path}?vi=${encodeURIComponent(token)}` }),
        { status: 200, headers }
      );
    } catch (err) {
      console.error(`[${FILE}] mint error`, err);
      return new Response('Mint failed', { status: 500, headers: cors(req) });
    }
  }

  return new Response('Method not allowed', { status: 405, headers: cors(req) });
};
