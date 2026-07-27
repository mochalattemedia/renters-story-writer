// ============================================================
//  listing-check.js  ·  Rental Listing Safety Check  ·  lc-v5
//  SCREENSHOT ONLY. A renter uploads up to 4 screenshots of a rental
//  listing or of their conversation with a supposed landlord. Claude
//  reads them and returns a structured risk read. Server-side so the
//  API key stays secret.
//
//  v5 changelog:
//   - Single input path. URL fetching removed entirely: no scraping,
//     no proxies, nothing any site has asked us not to do.
//   - Source dropdown removed. Vision reads the app chrome in the
//     screenshot and works out where it came from.
//   - Prompt now stitches multiple screenshots into one listing.
//
//  Env: ANTHROPIC_API_KEY
//  POST { images: [{ media_type, data }] }
//    -> { riskLevel, summary, flags[], tips[] }
// ============================================================

const { getStore } = require("@netlify/blobs");

const VERSION = "lc-v5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function ok(body) { return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(body) }; }
function bad(code, msg) { return { statusCode: code, headers: corsHeaders, body: JSON.stringify({ error: msg }) }; }

// --- rate limit ---
var RL_MAX = 10;            // checks
var RL_WINDOW_MS = 3600000; // per hour, per IP

// --- image limits ---
var MAX_IMAGES = 4;
var MAX_IMAGE_B64 = 1600000;   // ~1.2MB per image after client downscale
var MAX_TOTAL_B64 = 4200000;   // stay well under Netlify's payload ceiling
var OK_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function clientIp(event) {
  var h = event.headers || {};
  var xf = h["x-nf-client-connection-ip"] || h["x-forwarded-for"] || "";
  if (xf) return String(xf).split(",")[0].trim();
  return "unknown";
}

// Accepts raw base64 or a data: URL. Returns null if unusable.
function cleanImage(img) {
  if (!img) return null;
  var media = (img.media_type || img.mediaType || "").toString().toLowerCase();
  var data = (img.data || "").toString();

  var dm = data.match(/^data:([a-z/+.-]+);base64,([\s\S]*)$/i);
  if (dm) {
    if (!media) media = dm[1].toLowerCase();
    data = dm[2];
  }
  data = data.replace(/\s/g, "");
  if (!data) return null;
  if (OK_IMAGE_TYPES.indexOf(media) === -1) return null;
  if (data.length > MAX_IMAGE_B64) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(data)) return null;
  return { media_type: media, data: data };
}

function collectImages(raw) {
  if (!Array.isArray(raw)) return [];
  var out = [];
  var total = 0;
  for (var i = 0; i < raw.length && out.length < MAX_IMAGES; i++) {
    var c = cleanImage(raw[i]);
    if (!c) continue;
    if (total + c.data.length > MAX_TOTAL_B64) break;
    total += c.data.length;
    out.push(c);
  }
  return out;
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
    return false; // if the limiter itself fails, don't block the renter
  }
}

var FALLBACK_TIPS = [
  "Never wire money, send gift cards, or pay by Zelle, CashApp, or crypto before signing a lease and seeing the place in person.",
  "Insist on an in-person or live video tour before paying anything.",
  "Be wary of any landlord who is out of the country or cannot meet you.",
  "Search the listing photos and address online to check whether they appear elsewhere.",
];

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };
  if (event.httpMethod !== "POST") return bad(405, "Method not allowed");

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return bad(500, "Not configured");

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return bad(400, "Bad JSON"); }

  const images = collectImages(body.images);
  if (!images.length) {
    return bad(400, "Add a screenshot of the listing to check it.");
  }

  var ip = clientIp(event);
  if (await rateLimited(ip)) {
    return bad(429, "You've run several checks in a short time. Please wait a little while and try again.");
  }

  const many = images.length > 1;

  const system = [
    "You are a rental-scam safety assistant for Renters.com. A renter has sent you " + images.length + " screenshot" + (many ? "s" : "") + " and wants to know whether what they are looking at is safe. Your job is to help them spot red flags and protect themselves.",
    "",
    "WHAT YOU ARE LOOKING AT",
    "- The screenshot" + (many ? "s" : "") + " may show a rental listing, a chat or text thread with a supposed landlord, an email, a marketplace post, or some mix.",
    many ? "- Treat all of the screenshots as one continuous item. They are most likely different parts of the same listing or the same conversation, scrolled. Do not analyze them separately or repeat the same finding once per image." : "",
    "- Work out where it came from by the interface itself: Zillow, Craigslist, Facebook Marketplace, Messenger, iMessage, WhatsApp, Gmail, and so on all look distinct. Weigh the source, since an anonymous marketplace post or an unsolicited message carries more risk than a listing from a managed property company, though scams appear everywhere.",
    "- Read what you can actually see: price, address, dates, names, profile age, and the wording of any messages. Never guess at text you cannot read, and never invent details.",
    "- A screenshot only captures part of a page. Missing information is not evidence of a scam. If something important is cut off, you may note that another screenshot would help, but do not treat it as a red flag.",
    "- Do not comment on image quality, resolution, or the fact that it is a screenshot.",
    "",
    "WHAT COUNTS AS A RED FLAG",
    "Rental scams commonly include: demands to wire money or pay via gift cards, Zelle, CashApp, or crypto before seeing the unit; refusal or inability to show the place in person ('I'm out of the country / a missionary / military overseas'); prices well below market for the area; pressure and urgency ('many applicants, send the deposit today'); pushing the conversation off-platform; asking for a deposit or application fee before a lease or a viewing; promises to mail keys after a wire; copied or generic photos and descriptions; emotional backstory paired with a payment request; and requests for excessive personal information up front such as SSN or bank logins.",
    "",
    "In a conversation screenshot, weigh what the supposed landlord actually says. Payment demands, excuses for not meeting, manufactured urgency, and requests to move to another app all matter more than the listing details.",
    "",
    "You are NOT giving a verdict or a guarantee. You are pointing out risk signals and educating.",
    "",
    "Return ONLY valid JSON, no prose, no markdown, in exactly this shape:",
    '{',
    '  "riskLevel": "low" | "caution" | "high",',
    '  "summary": "one or two plain sentences on the overall risk",',
    '  "flags": [ { "title": "short red-flag name", "detail": "one sentence on what you saw and why it matters", "severity": "low"|"medium"|"high" } ],',
    '  "tips": [ "short actionable safety tip", "..." ]',
    '}',
    "",
    "If it looks clean, return riskLevel 'low', an empty or short flags array, and still give general safety tips. Keep it clear and non-alarmist. 3 to 6 tips max.",
  ].filter(function (s) { return s !== ""; }).join("\n");

  var content = [];
  for (var i = 0; i < images.length; i++) {
    if (many) content.push({ type: "text", text: "Screenshot " + (i + 1) + " of " + images.length + ":" });
    content.push({
      type: "image",
      source: { type: "base64", media_type: images[i].media_type, data: images[i].data },
    });
  }
  content.push({
    type: "text",
    text: many
      ? "These are all part of the same listing or conversation. Read them together and give me one safety check."
      : "Give me a safety check on this.",
  });

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
        max_tokens: 1100,
        system: system,
        messages: [{ role: "user", content: content }],
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
        version: VERSION,
        riskLevel: "caution",
        summary: "We could not fully read those screenshots. Review the safety tips below and trust your instincts.",
        flags: [],
        tips: FALLBACK_TIPS,
      });
    }

    var out = {
      version: VERSION,
      riskLevel: ["low", "caution", "high"].indexOf(parsed.riskLevel) > -1 ? parsed.riskLevel : "caution",
      summary: (parsed.summary || "").toString().slice(0, 400),
      flags: Array.isArray(parsed.flags) ? parsed.flags.slice(0, 10).map(function (f) {
        return {
          title: (f.title || "").toString().slice(0, 120),
          detail: (f.detail || "").toString().slice(0, 300),
          severity: ["low", "medium", "high"].indexOf(f.severity) > -1 ? f.severity : "medium",
        };
      }) : [],
      tips: Array.isArray(parsed.tips) && parsed.tips.length
        ? parsed.tips.slice(0, 6).map(function (t) { return t.toString().slice(0, 240); })
        : FALLBACK_TIPS,
    };

    return ok(out);
  } catch (e) {
    return bad(500, "check error: " + e.message);
  }
};
