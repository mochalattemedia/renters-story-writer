// ============================================================
//  listing-check.js  ·  Rental Listing Safety Check
//  Takes a pasted rental listing (from anywhere) + optional
//  source, asks Claude to flag scam signals, returns a
//  structured risk read. Server-side so the API key stays secret.
//
//  Guards: bare-URL detection (nudge to paste text), per-IP
//  hourly rate limit (protects the API balance from abuse).
//
//  Env: ANTHROPIC_API_KEY
//  POST { text, source } -> { riskLevel, summary, flags[], tips[] }
// ============================================================

const { getStore } = require("@netlify/blobs");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function ok(body) { return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(body) }; }
function bad(code, msg) { return { statusCode: code, headers: corsHeaders, body: JSON.stringify({ error: msg }) }; }

const SOURCE_LABELS = {
  craigslist: "Craigslist",
  facebook: "Facebook Marketplace or a Facebook group",
  zillow: "Zillow, Apartments.com, or a major listing site",
  "other-site": "another listing website",
  message: "a message someone sent them (text, email, DM)",
  unknown: "an unknown source",
};

// --- rate limit config ---
var RL_MAX = 10;          // max checks
var RL_WINDOW_MS = 3600000; // per hour, per IP

function clientIp(event) {
  var h = event.headers || {};
  var xf = h["x-nf-client-connection-ip"] || h["x-forwarded-for"] || "";
  if (xf) return String(xf).split(",")[0].trim();
  return "unknown";
}

// Returns true if the text is basically just a URL (or a couple of URLs) with no real listing content.
function isBareUrl(text) {
  var t = text.trim();
  // strip urls out; if almost nothing is left, it was just a link
  var withoutUrls = t.replace(/https?:\/\/[^\s]+/gi, "").replace(/www\.[^\s]+/gi, "").trim();
  var hadUrl = /https?:\/\/|www\./i.test(t);
  return hadUrl && withoutUrls.length < 15;
}

async function rateLimited(ip) {
  try {
    var store;
    if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
      store = getStore({ name: "listing-check-rl", siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
    } else {
      store = getStore("listing-check-rl");
    }
    var now = Date.now();
    var rec = null;
    try { rec = await store.get("ip:" + ip, { type: "json" }); } catch (e) { rec = null; }
    if (!rec || (now - rec.start) > RL_WINDOW_MS) {
      rec = { start: now, count: 1 };
      await store.setJSON("ip:" + ip, rec);
      return false;
    }
    if (rec.count >= RL_MAX) return true;
    rec.count += 1;
    await store.setJSON("ip:" + ip, rec);
    return false;
  } catch (e) {
    // if the limiter itself fails, don't block the user
    return false;
  }
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };
  if (event.httpMethod !== "POST") return bad(405, "Method not allowed");

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return bad(500, "Not configured");

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return bad(400, "Bad JSON"); }

  const text = (body.text || "").toString().trim();
  const source = (body.source || "unknown").toString();

  // Friendly nudge if they pasted just a link.
  if (isBareUrl(text)) {
    return bad(422, "It looks like you pasted a link. Please copy and paste the listing's actual text — the description, price, and any message from the landlord — rather than just the URL. We check the words in the listing, not the web page.");
  }

  if (text.length < 20) return bad(400, "Please paste the full listing text.");
  if (text.length > 8000) return bad(400, "That is very long — paste just the listing, please.");

  // Rate limit (protects the API balance from abuse).
  var ip = clientIp(event);
  if (await rateLimited(ip)) {
    return bad(429, "You've run several checks in a short time. Please wait a little while and try again.");
  }

  const sourceLabel = SOURCE_LABELS[source] || SOURCE_LABELS.unknown;

  const system = [
    "You are a rental-scam safety assistant for Renters.com. A renter has pasted a rental listing (or a message from a supposed landlord) that they found via " + sourceLabel + ". Your job is to help them spot red flags and protect themselves.",
    "",
    "You are NOT making a guarantee or a verdict. You are pointing out risk signals and educating. Rental scams commonly include: demands to wire money / pay via gift cards / Zelle / cash app / crypto before seeing the unit; refusal or inability to show the place in person ('I'm out of the country / a missionary / military overseas'); prices well below market; pressure and urgency ('many applicants, send deposit today'); requests to move off-platform; asking for a deposit or 'application fee' before a lease or viewing; keys mailed after a wire; copied/generic photos or descriptions; broken English mixed with emotional backstory; requests for excessive personal info up front (SSN, bank logins).",
    "",
    "Consider the source: listings from major managed platforms (Zillow, Apartments.com) with a verified property manager are generally lower risk than anonymous Facebook or Craigslist posts or unsolicited messages, though scams appear everywhere.",
    "",
    "Return ONLY valid JSON, no prose, no markdown, in exactly this shape:",
    '{',
    '  "riskLevel": "low" | "caution" | "high",',
    '  "summary": "one or two plain-sentence read of the overall risk",',
    '  "flags": [ { "title": "short red-flag name", "detail": "one sentence explaining what was found and why it matters", "severity": "low"|"medium"|"high" } ],',
    '  "tips": [ "short actionable safety tip", "..." ]',
    '}',
    "",
    "If the listing looks clean, return riskLevel 'low', an empty or short flags array, and still give general safety tips. Never invent details that are not in the text. Keep it clear and non-alarmist. 3-6 tips max.",
  ].join("\n");

  const userMsg = "Here is the listing / message the renter pasted:\n\n" + text;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        system: system,
        messages: [{ role: "user", content: userMsg }],
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return bad(502, "Analysis service error: " + (data && data.error && data.error.message ? data.error.message : resp.status));
    }

    let raw = "";
    if (Array.isArray(data.content)) {
      raw = data.content.filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("");
    }
    raw = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) {
      return ok({
        riskLevel: "caution",
        summary: "We could not fully analyze this one automatically. Review the safety tips and trust your instincts.",
        flags: [],
        tips: [
          "Never wire money, send gift cards, or pay by Zelle/CashApp/crypto before signing a lease and seeing the place in person.",
          "Insist on an in-person (or live video) tour before paying anything.",
          "Be wary of any landlord who is 'out of the country' or cannot meet.",
          "Search the listing photos and address online to check for duplicates.",
        ],
      });
    }

    var out = {
      riskLevel: ["low", "caution", "high"].indexOf(parsed.riskLevel) > -1 ? parsed.riskLevel : "caution",
      summary: (parsed.summary || "").toString().slice(0, 400),
      flags: Array.isArray(parsed.flags) ? parsed.flags.slice(0, 10).map(function (f) {
        return {
          title: (f.title || "").toString().slice(0, 120),
          detail: (f.detail || "").toString().slice(0, 300),
          severity: ["low", "medium", "high"].indexOf(f.severity) > -1 ? f.severity : "medium",
        };
      }) : [],
      tips: Array.isArray(parsed.tips) ? parsed.tips.slice(0, 6).map(function (t) { return t.toString().slice(0, 240); }) : [],
    };

    return ok(out);
  } catch (e) {
    return bad(500, "check error: " + e.message);
  }
};
