// netlify/functions/didit-start.js
// Creates a Didit verification session and returns the hosted verification URL.
// Your BD confirm-identity form calls this, then redirects the renter to the returned url.

const DIDIT_BASE = 'https://verification.didit.me';

exports.handler = async (event) => {
  // CORS so the BD-hosted form can call it
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.DIDIT_API_KEY;
  const workflowId = process.env.DIDIT_WORKFLOW_ID;
  const callbackUrl = process.env.DIDIT_CALLBACK_URL || '';

  if (!apiKey || !workflowId) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server not configured (missing API key or workflow id)' }) };
  }

  // Optional: your BD form can POST a member identifier so we can map the result back
  let vendorData = '';
  try {
    if (event.body) {
      const parsed = JSON.parse(event.body);
      vendorData = (parsed.vendor_data || parsed.memberId || '').toString();
    }
  } catch (e) { /* ignore bad body, vendorData stays empty */ }

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
      return { statusCode: res.status, headers, body: JSON.stringify({ error: 'Didit error', detail: text.slice(0, 500) }) };
    }

    const data = JSON.parse(text);
    // Didit returns the verification URL (field is "url" on v2/v3, "session_url" in some examples)
    const url = data.url || data.session_url || '';
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        url: url,
        session_id: data.session_id || '',
        session_number: data.session_number || ''
      })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Request failed', detail: String(err).slice(0, 300) }) };
  }
};
