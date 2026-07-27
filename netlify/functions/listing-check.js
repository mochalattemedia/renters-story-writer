// ============================================================
//  listing-check.js  ·  Renters.com Safety Check  ·  lc-v7
//  A renter screenshots a message from a supposed landlord (email,
//  text, DM, marketplace chat) or a listing, and Claude reads it and
//  returns a structured risk read. Server-side so the API key stays
//  secret.
//
//  v7 changelog:
//   - Anchored on the core test: every scam exists because the sender
//     does not have the property, so the summary and tips are steered
//     toward whether money is being requested before an in-person
//     viewing.
//
//  v6 changelog (CORRESPONDENCE FIRST):
//   - Reframed from "check this listing" to "check who you are
//     talking to". Scams live in the reply, not the listing page.
//   - Prompt leads on message-thread analysis: payment demands,
//     excuses for not meeting, urgency, off-platform pushes,
//     identity claims that cannot be checked.
//   - Listing screenshots still fully supported as a secondary case.
//   - Tips are now next-step actions the renter can take today.
//
//  v5: screenshot-only, URL fetching removed
//
//  Env: ANTHROPIC_API_KEY
//  POST { images: [{ media_type, data }] }
//    -> { riskLevel, summary, flags[], tips[] }
// ============================================================

const { getStore } = require("@netlify/blobs");

const VERSION = "lc-v7";

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
  "Do not send money by wire, gift card, Zelle, CashApp, or crypto. Those payments cannot be reversed.",
  "Ask to see the place in person, or on a live video call where they walk through it while you watch.",
  "Search the address and the photos online to see whether the same listing appears elsewhere under a different name.",
  "Look up the property management company separately and call the number on their own website, not the one in the message.",
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
    return bad(400, "Add a screenshot of the message to check it.");
  }

  var ip = clientIp(event);
  if (await rateLimited(ip)) {
    return bad(429, "You've run several checks in a short time. Please wait a little while and try again.");
  }

  const many = images.length > 1;

  const system = [
    "You are a rental-scam safety assistant for Renters.com. A renter has sent you " + images.length + " screenshot" + (many ? "s" : "") + " of something that felt off to them, and they want to know whether the person on the other end is trying to scam them. Take that instinct seriously and give them a clear, calm read.",
    "",
    "WHAT YOU ARE LOOKING AT",
    "- Most often this is correspondence: an email, a text thread, a Messenger or WhatsApp chat, a marketplace inquiry reply, or a Craigslist email. Sometimes it is a rental listing instead. Work out which and judge accordingly.",
    many ? "- Treat all of the screenshots as one continuous item. They are almost certainly the same thread or the same page, scrolled. Do not analyze them separately and do not repeat a finding once per image." : "",
    "- Identify the platform from the interface itself. iMessage, Gmail, Messenger, WhatsApp, Zillow, Craigslist and the rest all look distinct, and the platform matters to the risk picture.",
    "- Read what you can actually see: the sender's name and address, the wording, the amounts, the dates, the urgency. Never guess at text you cannot read and never invent details.",
    "- A screenshot captures only part of a thread. Missing context is not evidence of a scam. If something important is cut off, say another screenshot would help, but do not count it as a red flag.",
    "- Do not comment on image quality or on the fact that it is a screenshot.",
    "",
    "WHAT MATTERS MOST IN CORRESPONDENCE",
    "Weigh what the supposed landlord actually says and asks for. The strongest signals:",
    "- Any request for money before the renter has seen the place and signed a lease: deposit, first month, 'application fee', 'holding fee', 'key delivery'.",
    "- Payment methods that cannot be reversed or traced: wire, gift cards, Zelle, CashApp, Venmo, PayPal friends-and-family, crypto.",
    "- Reasons they cannot meet or show the unit: out of the country, missionary work, military deployment, family emergency, relocated for a job, agent unavailable.",
    "- Manufactured urgency: many applicants, offer expires today, someone else is ready to pay.",
    "- Pushing the conversation off the platform to personal email, text, or WhatsApp early on.",
    "- Promises to mail keys or a lease after payment.",
    "- An emotional or religious backstory arriving alongside a payment request.",
    "- Requests for excessive personal information up front: SSN, date of birth, bank logins, photos of ID before any viewing.",
    "- A sender address or phone number that does not match the company or person they claim to be.",
    "- Copied, generic, or oddly formal wording, or a message that reads like a template with the address dropped in.",
    "",
    "THE TEST THAT SITS UNDER ALL OF IT",
    "A rental scammer does not have the property. Every tactic above exists to solve that one problem: prevent an in-person viewing while still getting money moved through a channel that cannot be reversed. So the question that decides most cases is whether someone is asking for money before the renter has stood inside the unit. Anchor your summary on that question, and if money is being requested before a viewing, say so plainly and make it the lead finding.",
    "",
    "Also weigh what looks reassuring, and say so when you see it: a real leasing office, a scheduled in-person tour, a company domain that matches the business, willingness to meet before any money changes hands, and payment only after a signed lease.",
    "",
    "You are NOT giving a verdict or a guarantee. You are pointing out risk signals and telling the renter what to do next.",
    "",
    "TIPS should be concrete next steps this renter can take today given what you saw, not generic advice. Prefer things like verifying the company by calling the number on its own website, asking for a live video walkthrough, or refusing a specific payment method that was requested.",
    "",
    "Return ONLY valid JSON, no prose, no markdown, in exactly this shape:",
    '{',
    '  "riskLevel": "low" | "caution" | "high",',
    '  "summary": "one or two plain sentences on what you are seeing and how worried they should be",',
    '  "flags": [ { "title": "short red-flag name", "detail": "one sentence on what you saw and why it matters", "severity": "low"|"medium"|"high" } ],',
    '  "tips": [ "short concrete next step", "..." ]',
    '}',
    "",
    "If nothing looks wrong, return riskLevel 'low', an empty or short flags array, say plainly that nothing stood out, and still give safety tips. Do not manufacture concerns to seem useful. Keep it clear and non-alarmist. 3 to 6 tips max.",
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
      ? "These are all part of the same message thread or page. Read them together and give me one safety check."
      : "Something about this felt off to me. Give me a safety check on it.",
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
        summary: "We could not fully read those screenshots. Go through the steps below before you send anyone money.",
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
