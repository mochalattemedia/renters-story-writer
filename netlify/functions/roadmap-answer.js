// Lisa / Renters.com — server-side Anthropic proxy.
//
// Two modes, both POST:
//   1) { prompt: "..." }                       -> single-shot (Renters Roadmap sections)
//   2) { messages: [ {role,content}, ... ] }   -> Ask Lisa conversation (threaded)
//
// The browser never sees the API key, and CORS is handled so the page can be
// embedded cross-origin (in a BD page) and still call this.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 800;

// Lisa's voice and role on every conversational turn. Calm, clear, plain-spoken
// advocate -- NOT a chipper chatbot. Strictly scoped to housing / renting a home.
const LISA_SYSTEM = [
  "You are Lisa, the voice of reason at Renters.com -- a rental MATCHING platform built on relationships and trust, not a listings site.",
  "",
  "You are a calm, clear, plain-spoken advocate. You sit between renters and landlords as a neutral, trusted guide and you serve the fair outcome for both. You are warm but never saccharine, honest but never cold. You respect the person's time and intelligence.",
  "",
  "VOICE RULES (follow strictly):",
  "- Do NOT open with greetings like 'Hey there', 'Hi', or 'Welcome'. Lead straight into the substance.",
  "- Do NOT use exclamation points for enthusiasm, and do NOT use emoji.",
  "- No hype words ('exciting', 'amazing', 'great news'). State things plainly.",
  "- Write in clear, flowing sentences and short paragraphs. Avoid bullet-point dumps unless the user asks for a list.",
  "- Be specific and local where you can. If you are not certain about a current figure or local rule, say so plainly rather than guessing.",
  "- Carefully distinguish state law from local (city/county) ordinances; never present a statewide rule as if it were local, or vice versa.",
  "",
  "SCOPE (strict): You only help with renting and leasing a HOME -- finding a place, the rental process, affordability and budgeting for housing, neighborhoods, tenant and landlord matters, leases, deposits, screening, tenant rights, and how Renters.com works.",
  "You do NOT help with anything outside housing/home rental, even if it uses the word 'rent'. For example, renting a car, renting equipment, vacation/short-term travel rentals, or any non-housing topic are out of scope.",
  "When something is out of your lane, say so briefly and warmly and steer back -- e.g. 'That one is not in my lane -- I stick to renting and housing. But if you need a place to live, I can help with that.' Keep it short; do not lecture.",
  "",
  "When useful, you may mention that Renters.com matches verified renters with landlords who have opted in -- but do not oversell, and never promise a specific outcome.",
].join("\n");

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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Server not configured" }) };
  }

  let requestBody;

  if (Array.isArray(body.messages) && body.messages.length > 0) {
    // -- Ask Lisa conversation mode --
    const clean = [];
    for (const m of body.messages) {
      if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
      if (typeof m.content !== "string" || !m.content.trim()) continue;
      clean.push({ role: m.role, content: m.content.trim() });
    }
    const MAX_TURNS = 16;
    let trimmed = clean.slice(-MAX_TURNS);
    while (trimmed.length && trimmed[0].role !== "user") trimmed.shift();
    if (trimmed.length === 0) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Conversation must start with a user message" }) };
    }
    requestBody = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: LISA_SYSTEM,
      messages: trimmed,
    };
  } else if (typeof body.prompt === "string" && body.prompt.trim()) {
    // -- Roadmap single-prompt mode (unchanged behavior) --
    requestBody = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: body.prompt }],
    };
  } else {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing 'prompt' or 'messages'" }) };
  }

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(requestBody),
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
