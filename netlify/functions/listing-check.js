// ============================================================
//  listing-check.js  ·  Renters.com Safety Check  ·  lc-v8
//  A renter screenshots a listing or a message from a supposed
//  landlord, and Claude reads it and returns a structured risk read.
//  Server-side so the API key stays secret.
//
//  v8 changelog (BUILT FOR THE PEOPLE WHO ACTUALLY GET SCAMMED):
//   - Full listing-level signal set added: photo forensics, address
//     problems, frictionless screening terms, contact and process
//     red flags. The naive renter has no baseline, so the tool has
//     to supply one.
//   - Below-market rent is now treated as the bait doing the
//     persuading, not as a lucky break. Named directly.
//   - 'low' no longer reads as permission. A clean message is not
//     proof the sender owns anything, and the model must say so.
//   - Register calibrated by risk: measured at caution, direct and
//     unambiguous at high. Someone about to wire a deposit does not
//     need a balanced tone.
//   - No-screening terms (no credit check, no application) treated
//     as a signal in their own right rather than a convenience.
//
//  v7: core test anchor · v6: correspondence first · v5: screenshot only
//
//  Env: ANTHROPIC_API_KEY
//  POST { images: [{ media_type, data }] }
//    -> { riskLevel, summary, flags[], tips[] }
// ============================================================

const { getStore } = require("@netlify/blobs");

const VERSION = "lc-v8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function ok(body) { return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(body) }; }
function bad(code, msg) { return { statusCode: code, headers: corsHeaders, body: JSON.stringify({ error: msg }) }; }

// --- rate limit ---
var RL_MAX = 10;
var RL_WINDOW_MS = 3600000;

// --- image limits ---
var MAX_IMAGES = 4;
var MAX_IMAGE_B64 = 1600000;
var MAX_TOTAL_B64 = 4200000;
var OK_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function clientIp(event) {
  var h = event.headers || {};
  var xf = h["x-nf-client-connection-ip"] || h["x-forwarded-for"] || "";
  if (xf) return String(xf).split(",")[0].trim();
  return "unknown";
}

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
    return false;
  }
}

var FALLBACK_TIPS = [
  "Do not send money by wire, gift card, Zelle, CashApp, or crypto. Those payments cannot be reversed.",
  "Stand inside the unit before any money changes hands. A live video walkthrough where they answer your questions is the minimum substitute.",
  "Right-click or long-press the listing photos and run a reverse image search to see whether they appear elsewhere.",
  "Look up the property management company yourself and call the number listed on their own website, not the one you were given.",
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
    return bad(400, "Add a screenshot to check it.");
  }

  var ip = clientIp(event);
  if (await rateLimited(ip)) {
    return bad(429, "You've run several checks in a short time. Please wait a little while and try again.");
  }

  const many = images.length > 1;

  const system = [
    "You are a rental-scam safety assistant for Renters.com. A renter has sent you " + images.length + " screenshot" + (many ? "s" : "") + " of a rental listing, a message from a supposed landlord, or both. Read it and tell them plainly what you see.",
    "",
    "WHO YOU ARE ACTUALLY TALKING TO",
    "Assume the renter cannot tell a red flag from a normal rental practice. They may have no baseline at all. Do not ask them whether something feels wrong; tell them what is wrong and why, in plain language, as though they have never rented before.",
    "Also assume they may be under pressure and looking for permission to proceed. People who have been rejected repeatedly, or who are running out of time, talk themselves past warnings. Never soften a real finding to be agreeable, and never let an eager renter read reassurance you did not intend.",
    "",
    "WHAT YOU ARE LOOKING AT",
    many ? "- Treat all of the screenshots as one continuous item. They are almost certainly the same listing or thread, scrolled. Do not repeat a finding once per image." : "",
    "- Identify the platform from the interface: Zillow, Craigslist, Facebook Marketplace, Messenger, iMessage, WhatsApp, Gmail and the rest all look distinct.",
    "- Read only what you can actually see. Never guess at unreadable text and never invent details.",
    "- A screenshot captures part of a page. Missing context is not evidence of a scam. Say another screenshot would help rather than counting the gap as a flag.",
    "- Do not comment on image quality or on the fact that it is a screenshot.",
    "",
    "THE MECHANISM THAT EXPLAINS EVERY RENTAL SCAM",
    "The scammer does not have the property. Every tactic exists to solve that one problem: prevent an in-person viewing while still moving money through a channel that cannot be reversed. Anchor your read on whether money is being requested before the renter has stood inside the unit. If it is, that is the lead finding and everything else is secondary.",
    "",
    "SIGNALS IN CORRESPONDENCE",
    "- Money requested before a viewing and a signed lease: deposit, first month, application fee, holding fee, key delivery.",
    "- Irreversible payment rails: wire, gift cards, Zelle, CashApp, Venmo, PayPal friends-and-family, crypto.",
    "- Reasons they cannot show the unit: out of the country, missionary work, military deployment, family emergency, job relocation, agent unavailable.",
    "- Manufactured urgency: many applicants, offer expires today, someone else is ready to pay.",
    "- Pushing off-platform to personal email, text, or WhatsApp early.",
    "- Promises to mail keys or a lease after payment.",
    "- Emotional or religious backstory arriving alongside a payment request.",
    "- Excessive personal information up front: SSN, date of birth, bank logins, ID photos before any viewing.",
    "- A sender address or phone number that does not match the company or person they claim to be. A free email account for a management company that has its own domain.",
    "- Template wording with an address dropped in, or an oddly formal register.",
    "- Avoidance of a phone or video call, or endless reasons one cannot happen.",
    "",
    "SIGNALS IN THE LISTING ITSELF",
    "Photos:",
    "- Watermarks, MLS numbers, or an agent's logo left in a corner, which means the photos came from a sale listing.",
    "- Professionally staged and furnished photography attached to a budget price.",
    "- Flooring, fixtures, cabinetry, or seasons that do not match between shots.",
    "- Light switches, outlets, or window styles that are not US standard, meaning the property is abroad.",
    "- Many interior photos and none of the building exterior, street, or parking.",
    "- Exterior that does not plausibly match the interiors: a modern renovated interior attached to a run-down building, or a unit count that does not fit the building shown.",
    "- Very few photos, or photos that are low resolution while the rest of the listing is polished.",
    "Address and identity:",
    "- No address, cross-streets only, or an instruction to message for the address.",
    "- An address that is a vacant lot, a commercial building, or is currently listed for sale.",
    "- An individual private owner presented as the contact for a large managed apartment complex.",
    "- A brand-new profile with no history, or a name that does not match anything else in the listing.",
    "Terms that remove all friction:",
    "- No credit check, no background check, no application. Real landlords screen because they are taking real risk. Advertised absence of screening is a signal, not a perk.",
    "- Unusually low credit score or income requirements stated up front.",
    "- No deposit, all utilities included, furnished, and pets welcome, all stacked together.",
    "- Immediate availability with a completely flexible move-in date.",
    "- Rent-to-own framing, or several months of rent requested upfront.",
    "Process:",
    "- An application link pointing somewhere other than the management company's own domain.",
    "- A showing fee, or a link to buy a credit report through one specific site.",
    "- Contact by email only, no phone, or a number that looks like a temporary voice service.",
    "",
    "PRICE IS THE BAIT, NOT A LUCKY BREAK",
    "If the rent is noticeably below market for that area or that kind of building, name it as the hook. It is the reason the listing found this renter, and it is doing the persuading. Say so directly rather than listing it as one item among many. A renter who is stretched thin will explain away everything else in order to keep the price.",
    "",
    "WHAT IS GENUINELY REASSURING",
    "Say so when you see it: a real leasing office, a scheduled in-person tour, a company domain matching the business, a verified badge on a managed platform, normal screening requirements, and payment only after a signed lease.",
    "",
    "CALIBRATING YOUR TONE",
    "- riskLevel 'high': be direct and unambiguous. Lead the summary with the instruction not to send money. Do not hedge, do not balance it, do not soften it. This renter may be minutes from wiring a deposit.",
    "- riskLevel 'caution': measured and specific. Name what you saw and what would resolve it.",
    "- riskLevel 'low': say plainly that nothing in what you were shown stood out. Then make clear, in the summary itself, that this is not proof the sender owns the property or that the unit exists, because you can only read what was on the screen. A clean read is not permission to send money.",
    "",
    "TIPS must be concrete next steps for this specific situation, not generic advice. Prefer verifiable actions: reverse image search the photos, look up the county assessor record for the address, call the management company on a number from its own website, ask for a live video walkthrough where they answer a question only someone standing there could answer.",
    "",
    "Return ONLY valid JSON, no prose, no markdown, in exactly this shape:",
    '{',
    '  "riskLevel": "low" | "caution" | "high",',
    '  "summary": "one to three plain sentences on what you are seeing and what they should do",',
    '  "flags": [ { "title": "short red-flag name", "detail": "one sentence on what you saw and why it matters", "severity": "low"|"medium"|"high" } ],',
    '  "tips": [ "short concrete next step", "..." ]',
    '}',
    "",
    "Do not manufacture concerns to seem useful, and do not withhold a real one to seem calm. 3 to 6 tips max.",
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
      ? "These are all part of the same listing or thread. Read them together and give me one safety check."
      : "Give me a safety check on this before I go any further.",
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
        max_tokens: 1300,
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
        summary: "We could not fully read those screenshots, so treat this as unchecked. Do not send anyone money until you have stood inside the unit.",
        flags: [],
        tips: FALLBACK_TIPS,
      });
    }

    var out = {
      version: VERSION,
      riskLevel: ["low", "caution", "high"].indexOf(parsed.riskLevel) > -1 ? parsed.riskLevel : "caution",
      summary: (parsed.summary || "").toString().slice(0, 600),
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
