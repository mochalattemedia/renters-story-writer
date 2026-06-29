// Lisa / Renters Roadmap — server-side Anthropic proxy.
// The roadmap page used to call api.anthropic.com directly from the browser,
// which fails CORS and exposes the API key. This function makes that call
// server-side using the ANTHROPIC_API_KEY env var and returns just the text.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// Cap output length for cost control. The roadmap prompts ask for <250 words,
// so 700 tokens is plenty of headroom while keeping spend predictable.
const MAX_TOKENS = 700;
const MODEL = "claude-sonnet-4-6";

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const prompt = body.prompt;
  if (!prompt || typeof prompt !== "string") {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing 'prompt'" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Server not configured" }) };
  }

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      const detail = data && data.error && data.error.message ? data.error.message : "Anthropic API error";
      return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: detail }) };
    }

    const text =
      data && Array.isArray(data.content) && data.content[0] && data.content[0].text
        ? data.content[0].text
        : "";

    if (!text) {
      return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: "Empty response" }) };
    }

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ text: text }) };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Request failed", details: err.message }) };
  }
};
