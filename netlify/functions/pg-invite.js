// pg-invite.js — pgi-v1
// PandaGuarantee pre-approval invite trigger. Server-side only.
// POST /v1/pre_approval_invites — tenant.email is the only required field.

const crypto = require('crypto');

const FN_VERSION = 'pgi-v1';
const PG_BASE = process.env.PANDA_API_BASE || 'https://api.pandaguarantee.com';

exports.handler = async (event) => {
  if (event.queryStringParameters && event.queryStringParameters.version) {
    return json(200, { _v: FN_VERSION, keyConfigured: !!process.env.PANDA_API_KEY });
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'method' });

  // Stopgap auth. Replace with a BD session check before live.
  const shared = process.env.PG_INVITE_SECRET;
  if (shared) {
    const got = event.headers['x-rc-invite-key'] || event.headers['X-RC-Invite-Key'];
    if (got !== shared) return json(401, { error: 'unauthorized' });
  }

  const key = process.env.PANDA_API_KEY;
  if (!key) return json(503, { error: 'unconfigured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'bad_json' }); }

  const { email, name, phone, monthly_rent_cents, target_move_in_date, member_id } = body;

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json(400, { error: 'invalid_email' });
  }

  const payload = { tenant: { email } };
  if (name)  payload.tenant.name  = name;
  if (phone) payload.tenant.phone = phone;              // E.164 -> also sends SMS
  if (monthly_rent_cents) payload.monthly_rent = Number(monthly_rent_cents);  // CENTS
  if (target_move_in_date) payload.target_move_in_date = target_move_in_date; // YYYY-MM-DD

  const idem = crypto.createHash('sha256')
    .update(String(member_id || 'anon') + ':' + email + ':' + new Date().toISOString().slice(0, 10))
    .digest('hex');

  const ctl = new AbortController();
  const t = setTimeout(function () { ctl.abort(); }, 10000);

  try {
    const res = await fetch(PG_BASE + '/v1/pre_approval_invites', {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'Authorization': 'Bearer ' + key,
        'Idempotency-Key': idem,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();

    if (!res.ok) {
      console.error('pg_invite_fail', res.status, text.slice(0, 500));
      return json(502, { error: 'invite_failed', status: res.status });
    }

    const data = JSON.parse(text);

    // invite id is the ONLY join key back to a BD member — no metadata field exists.
    console.log('pg_invite_ok', JSON.stringify({
      _v: FN_VERSION, invite_id: data.id, status: data.status, member_id: member_id || null, email: email,
    }));

    return json(200, { ok: true, _v: FN_VERSION, invite_id: data.id, status: data.status });

  } catch (e) {
    console.error('pg_invite_error', e.name, e.message);
    return json(504, { error: 'timeout' });
  } finally {
    clearTimeout(t);
  }
};

function json(statusCode, obj) {
  return {
    statusCode: statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj),
  };
}
