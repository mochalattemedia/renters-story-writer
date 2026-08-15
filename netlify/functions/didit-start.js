// ============================================================
//  didit-start.js   ·   VERSION: ds-v2
//
//  Creates a Didit verification session and returns the hosted
//  verification URL. Called by the BD confirm-identity form and by the
//  app's Me tab.
//
//  ds-v2: THE CALLER CHOOSES WHERE THE RENTER LANDS AFTERWARDS.
//  The callback was a single env var, so everybody came back to the same
//  BD landing page - including a renter who started inside the app, who
//  finished verification and was left standing on the website with
//  nothing telling them to go back. The app now asks to come back to the
//  app; the website keeps doing exactly what it does today.
//
//  🔴 AND THE ALLOWLIST IS NOT OPTIONAL. A callback taken from a request
//  body and passed through unchecked is an open redirect: anyone can
//  point renters.com at their own page and inherit the trust of the
//  domain, which on an identity flow is the worst possible place to
//  hand that away. Only renters.com paths are accepted. Anything else
//  falls back to the env var, silently, because a caller sending a bad
//  redirect does not get to break verification for the renter.
//
//  ⚠️ The prior file carried no version at all. It is treated as ds-v1
//  and this is ds-v2, so the two can never be confused.
//
//  ENDPOINTS
//    POST { memberId, returnUrl? }  -> { url, session_id, session_number }
//    GET  ?version=1                -> deploy confirmation
// ============================================================

const DIDIT_BASE = 'https://verification.didit.me';
const FN_VERSION = 'ds-v2';

// Hosts we will send a renter back to. Both are live today - the app has
// been reachable on the bare host and on www - so both are accepted and
// the renter returns to whichever origin they started from, which is the
// one holding their session.
const ALLOWED_HOSTS = ['www.renters.com', 'renters.com'];

// Only a renters.com https URL survives this. Everything else returns ''
// and the caller falls back to the configured default.
function safeReturn(raw) {
  if (!raw) return '';
  let u;
  try { u = new URL(String(raw)); } catch (e) { return ''; }
  if (u.protocol !== 'https:') return '';
  if (ALLOWED_HOSTS.indexOf(u.hostname) === -1) return '';
  // Strip any credentials or fragment rather than reflecting them back.
  return 'https://' + u.hostname + u.pathname + (u.search || '');
}

exports.handler = async (event) => {
  // CORS so the BD-hosted form can call it
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // Deploy is not confirmed until a live endpoint says so.
  const q = event.queryStringParameters || {};
  if (event.httpMethod === 'GET' && q.version) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        version: FN_VERSION,
        configured: !!(process.env.DIDIT_API_KEY && process.env.DIDIT_WORKFLOW_ID),
        defaultCallback: process.env.DIDIT_CALLBACK_URL || '',
        allowedHosts: ALLOWED_HOSTS
      })
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ version: FN_VERSION, error: 'Method not allowed' }) };
  }

  const apiKey = process.env.DIDIT_API_KEY;
  const workflowId = process.env.DIDIT_WORKFLOW_ID;
  const defaultCallback = process.env.DIDIT_CALLBACK_URL || '';

  if (!apiKey || !workflowId) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ version: FN_VERSION, error: 'Server not configured (missing API key or workflow id)' })
    };
  }

  // The BD form can POST a member identifier so the result maps back.
  let vendorData = '';
  let asked = '';
  try {
    if (event.body) {
      const parsed = JSON.parse(event.body);
      vendorData = (parsed.vendor_data || parsed.memberId || '').toString();
      asked = (parsed.returnUrl || parsed.return_url || '').toString();
    }
  } catch (e) { /* ignore bad body, vendorData stays empty */ }

  // Caller's choice if it survives the allowlist, otherwise the default.
  const callbackUrl = safeReturn(asked) || defaultCallback;

  const payload = {
    workflow_id: workflowId,
    vendor_data: vendorData || 'renter'
  };
  if (callbackUrl) payload.callback = callbackUrl;

  try {
    const res = await fetch(DIDIT_BASE + '/v3/session/', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        'accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    if (!res.ok) {
      return {
        statusCode: res.status,
        headers,
        body: JSON.stringify({ version: FN_VERSION, error: 'Didit error', detail: text.slice(0, 500) })
      };
    }

    const data = JSON.parse(text);
    // Didit returns the verification URL (field is "url" on v2/v3,
    // "session_url" in some examples)
    const url = data.url || data.session_url || '';
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        version: FN_VERSION,
        url: url,
        session_id: data.session_id || '',
        session_number: data.session_number || '',
        // Echoed so a caller can SEE whether its requested return survived
        // the allowlist rather than discovering it at the end of the flow.
        callback: callbackUrl
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ version: FN_VERSION, error: 'Request failed', detail: String(err).slice(0, 300) })
    };
  }
};
