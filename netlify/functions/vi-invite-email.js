/* ============================================================
   netlify/functions/vi-invite-email.js — v1
   POST (x-rdc-secret) { member: {...}, ttl_days? }
   Mints a prefill token, sends the SES invite, returns { sent, url }.
   Env: SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY, SES_REGION,
        VI_FROM_EMAIL, VI_REPLY_TO, SITE_URL, RDC_INTERNAL_SECRET
   Dependency: @aws-sdk/client-ses
     — if your existing SES helper uses sesv2, swap the import and
       the command shape to match rather than adding a second client.
   ============================================================ */
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { mint, authorized } from '../lib/vi-token.js';

const FILE = 'vi-invite-email.js v1';

const BRAND = { navy: '#0d2d4e', teal: '#3a9e8f', lime: '#8dc63f' };
const SITE  = (process.env.SITE_URL || 'https://renters.com').replace(/\/$/, '');

// CAN-SPAM: a physical mailing address and a working opt-out are required
// on promotional mail. Fill these before the first real send.
const POSTAL_ADDRESS = process.env.RDC_POSTAL_ADDRESS || 'Renters.com — [MAILING ADDRESS]';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function html({ first, link, address, unsubscribe }) {
  const greet = first ? `Hi ${esc(first)},` : 'Hi there,';
  const place = address ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4a5b6d">For <strong style="color:${BRAND.navy}">${esc(address)}</strong>.</p>` : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Renters insurance for your new place</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <tr><td style="background:${BRAND.navy};padding:20px 28px;">
      <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.2px;">Renters<span style="color:${BRAND.lime}">.com</span></span>
    </td></tr>
    <tr><td style="padding:28px;">
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:${BRAND.navy};">Renters insurance for your new place</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4a5b6d">${greet}</p>
      ${place}
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4a5b6d">Most leases require renters insurance before you get the keys. We've pre-filled what we already know — review it and you can be covered in about a minute. We'll send proof straight to your landlord.</p>
      <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:${BRAND.teal};">
        <a href="${esc(link)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">See my price</a>
      </td></tr></table>
      <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#7b8794">Or paste this into your browser:<br><span style="color:${BRAND.teal};word-break:break-all;">${esc(link)}</span></p>
    </td></tr>
    <tr><td style="padding:18px 28px 26px;border-top:1px solid #e9edf2;">
      <p style="margin:0 0 8px;font-size:11px;line-height:1.6;color:#8b97a4">Coverage is offered by Vertical Insure. Renters.com earns a commission on policies purchased through this link. This link expires in 30 days.</p>
      <p style="margin:0;font-size:11px;line-height:1.6;color:#8b97a4">${esc(POSTAL_ADDRESS)}<br><a href="${esc(unsubscribe)}" style="color:#8b97a4;">Unsubscribe</a></p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

function text({ first, link, address }) {
  return [
    first ? `Hi ${first},` : 'Hi there,',
    '',
    address ? `Renters insurance for ${address}.` : 'Renters insurance for your new place.',
    '',
    "Most leases require renters insurance before you get the keys. We've pre-filled what we already know — review it and you can be covered in about a minute. We'll send proof straight to your landlord.",
    '',
    link,
    '',
    'Coverage is offered by Vertical Insure. Renters.com earns a commission on policies purchased through this link. This link expires in 30 days.',
    POSTAL_ADDRESS
  ].join('\n');
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 });

  let body;
  try { body = await req.json(); }
  catch { return new Response('Bad JSON', { status: 400 }); }

  const m = body.member || body;
  if (!m || !m.email) return new Response('member.email required', { status: 400 });

  try {
    const token = await mint(m, Number(body.ttl_days) || 30);
    const link  = `${SITE}/renters-insurance?vi=${encodeURIComponent(token)}`;
    const unsubscribe = `${SITE}/unsubscribe?e=${encodeURIComponent(m.email)}`;
    const address = [m.street, m.unit, m.city].filter(Boolean).join(' ');
    const ctx = { first: m.first, link, address, unsubscribe };

    const ses = new SESClient({
      region: process.env.SES_REGION || 'us-east-2',
      credentials: {
        accessKeyId: process.env.SES_ACCESS_KEY_ID,
        secretAccessKey: process.env.SES_SECRET_ACCESS_KEY
      }
    });

    await ses.send(new SendEmailCommand({
      Source: process.env.VI_FROM_EMAIL || 'Renters.com <hello@renters.com>',
      Destination: { ToAddresses: [m.email] },
      ReplyToAddresses: [process.env.VI_REPLY_TO || 'hello@renters.com'],
      Message: {
        Subject: { Charset: 'UTF-8', Data: 'Renters insurance for your new place' },
        Body: {
          Html: { Charset: 'UTF-8', Data: html(ctx) },
          Text: { Charset: 'UTF-8', Data: text(ctx) }
        }
      }
    }));

    console.log(`[${FILE}] sent to ${m.email}`);
    return new Response(JSON.stringify({ sent: true, url: link }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  } catch (err) {
    console.error(`[${FILE}] send failed`, err);
    return new Response(JSON.stringify({ sent: false, error: String(err.message || err) }), {
      status: 500, headers: { 'content-type': 'application/json' }
    });
  }
};
