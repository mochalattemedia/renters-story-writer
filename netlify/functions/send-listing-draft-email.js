// ============================================================
//  send-listing-draft-email.js
//  FN_VERSION: slde-v4   (2026-07-17)
//
//  Emails a LANDLORD when you set their rental listing back to draft because
//  the photos don't meet the Renters.com community photo standard.
//  Matches send-verification-email.js (SDK, SES env vars, brand shell) + adds
//  an admin-key gate and input hardening.
// ============================================================
const FN_VERSION = "slde-v4";

const crypto = require("crypto");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const ses = new SESClient({
  region: process.env.SES_REGION || "us-east-2",
  credentials: {
    accessKeyId: process.env.SES_ACCESS_KEY_ID,
    secretAccessKey: process.env.SES_SECRET_ACCESS_KEY,
  },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const SENDER = process.env.LISTING_EMAIL_SENDER || "verify@renters.com";
const REPLYTO = process.env.LISTING_EMAIL_REPLYTO || SENDER;
const EDIT_URL = process.env.EDIT_LISTING_URL || "https://www.renters.com/account/home";

function cleanName(raw) {
  var n = String(raw == null ? "" : raw).trim();
  if (!n) return "there";
  n = n.replace(/([A-Za-z0-9])\.([A-Za-z0-9])/g, "$1 $2").trim();
  if (!n) return "there";
  return n;
}
// Escapes BOTH quote styles so a value can't break out of an attribute.
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
// Strict single-address check: no commas/semicolons/brackets/quotes, length cap.
function looksLikeEmail(e) {
  if (typeof e !== "string") return false;
  const v = e.trim();
  return v.length <= 254 && /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/.test(v);
}
// Constant-time key comparison — avoids leaking the admin key via response timing.
function safeEqual(a, b) {
  const ab = Buffer.from(String(a == null ? "" : a));
  const bb = Buffer.from(String(b == null ? "" : b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// The community photo standard — the fixed checklist every live listing must meet.
const STANDARD_ITEMS = [
  "<strong style='color:#0d2d4e;'>Every room inside</strong> &mdash; the living area and each bedroom",
  "<strong style='color:#0d2d4e;'>The kitchen</strong>",
  "<strong style='color:#0d2d4e;'>Each bathroom</strong>",
  "<strong style='color:#0d2d4e;'>The outside of the property</strong> &mdash; the front, and any yard or grounds",
  "<strong style='color:#0d2d4e;'>Any shared spaces</strong> &mdash; hallways, stairwells, laundry, common areas, and parking",
];
const STANDARD_ITEMS_TEXT = [
  "Every room inside - the living area and each bedroom",
  "The kitchen",
  "Each bathroom",
  "The outside of the property - the front, and any yard or grounds",
  "Any shared spaces - hallways, stairwells, laundry, common areas, and parking",
];

function checklistRows(items) {
  return items.map(function (it) {
    return "<tr><td style='vertical-align:top;padding:0 10px 10px 0;'>"
      + "<span style='color:#8dc63f;font-size:18px;line-height:1.4;'>&#9679;</span></td>"
      + "<td style='padding:0 0 10px 0;font-size:14px;color:#4a5a6a;line-height:1.55;'>" + it + "</td></tr>";
  }).join("");
}

function buildEmail({ name, listingTitle, listingUrl, missing }) {
  const greet = esc(cleanName(name));
  const url = listingUrl || EDIT_URL;

  const titleHtml = listingTitle ? " &ldquo;" + esc(listingTitle) + "&rdquo;" : " your listing";
  const titleText = listingTitle ? ' "' + listingTitle + '"' : " your listing";

  const missingHtml = missing
    ? "<div style='background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px 16px;margin:0 0 22px;'>"
      + "<p style='font-size:14px;color:#7c2d12;line-height:1.6;margin:0;'><strong>On your listing specifically, we still need:</strong> "
      + esc(missing) + "</p></div>"
    : "";
  const missingText = missing ? "\nOn your listing specifically, we still need: " + missing + "\n" : "";

  const subject = "Your Renters.com listing needs updated photos to go live";

  const html = "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
    + "<body style='margin:0;padding:0;background:#eef2f5;font-family:Open Sans,Arial,sans-serif;'>"
    + "<div style='max-width:560px;margin:0 auto;padding:24px 16px;'>"
    + "<div style='background:#0d2d4e;border-radius:14px 14px 0 0;padding:26px 30px;text-align:center;'>"
    + "<div style='font-size:22px;font-weight:800;color:#ffffff;'>RENTERS<span style='color:#8dc63f;'>.</span></div></div>"
    + "<div style='background:#ffffff;padding:32px 30px;border-radius:0 0 14px 14px;'>"
    + "<h1 style='font-size:22px;font-weight:800;color:#0d2d4e;margin:0 0 14px;'>A quick fix to get your listing live</h1>"
    + "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 16px;'>Hi " + greet + ", thanks for listing your place on Renters.com. We&rsquo;ve set" + titleHtml + " back to draft because the photos don&rsquo;t yet meet our community standard. It&rsquo;s a quick fix, not a rejection.</p>"
    + "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 14px;'>To keep listings trustworthy for renters, every live listing needs clear, well-lit photos of the whole property:</p>"
    + "<table style='border-collapse:collapse;width:100%;margin:0 0 20px;'>" + checklistRows(STANDARD_ITEMS) + "</table>"
    + missingHtml
    + "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 22px;'>Add the photos that are missing and set your listing back to live, and it&rsquo;ll be visible again.</p>"
    + "<div style='text-align:center;margin-bottom:24px;'>"
    + "<a href='" + esc(url) + "' style='display:inline-block;background:#8dc63f;color:#0d2d4e;text-decoration:none;border-radius:10px;padding:13px 30px;font-size:15px;font-weight:700;'>Edit your listing &rarr;</a></div>"
    + "<p style='font-size:14px;color:#4a5a6a;line-height:1.6;margin:0;'>&mdash; The Renters.com team</p>"
    + "</div>"
    + "<p style='font-size:12px;color:#9aa7b3;text-align:center;margin:18px 0 0;'>Renters.com. Finding a home should feel safe.</p>"
    + "</div></body></html>";

  const text = "Hi " + cleanName(name) + ",\n\n"
    + "Thanks for listing your place on Renters.com. We've set" + titleText + " back to draft because the photos don't yet meet our community standard. It's a quick fix, not a rejection.\n\n"
    + "To keep listings trustworthy for renters, every live listing needs clear, well-lit photos of the whole property:\n"
    + STANDARD_ITEMS_TEXT.map(function (i) { return "- " + i; }).join("\n") + "\n"
    + missingText + "\n"
    + "Add the photos that are missing and set your listing back to live, and it'll be visible again.\n\n"
    + "Edit your listing: " + url + "\n\n"
    + "- The Renters.com team\n\n"
    + "Renters.com. Finding a home should feel safe.";

  return { subject, html, text };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };

  if (event.httpMethod === "GET") {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        ok: true,
        _v: FN_VERSION,
        region: process.env.SES_REGION || "us-east-2",
        adminKeyConfigured: !!process.env.LISTING_EMAIL_ADMIN_KEY,
        sesKeyConfigured: !!process.env.SES_ACCESS_KEY_ID && !!process.env.SES_SECRET_ACCESS_KEY,
        sender: SENDER,
      }),
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: "Method Not Allowed" };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  // admin gate — do NOT let this be an open relay against your SES reputation
  const adminKey = process.env.LISTING_EMAIL_ADMIN_KEY || "";
  if (!adminKey || !safeEqual(body.key, adminKey)) {
    console.warn("[slde] rejected: bad or missing admin key");
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  const email = String(body.email || "").trim();
  if (!looksLikeEmail(email)) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing or invalid 'email'", got: email }) };
  }

  const { subject, html, text } = buildEmail({
    name: body.name,
    listingTitle: body.listingTitle,
    listingUrl: body.listingUrl,
    missing: body.missing,
  });

  const command = new SendEmailCommand({
    Source: SENDER,
    Destination: { ToAddresses: [email] },
    ReplyToAddresses: [REPLYTO],
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: {
        Text: { Data: text, Charset: "UTF-8" },
        Html: { Data: html, Charset: "UTF-8" },
      },
    },
  });

  try {
    const res = await ses.send(command);
    console.log("[slde] sent to " + email + " MessageId=" + (res && res.MessageId));
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, _v: FN_VERSION, type: "listing-draft", email, messageId: (res && res.MessageId) || null }) };
  } catch (err) {
    console.error("[slde] SES error:", err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Failed to send email", details: err.message }) };
  }
};
