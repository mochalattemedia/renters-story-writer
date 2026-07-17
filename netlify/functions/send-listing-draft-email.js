// ============================================================
//  send-listing-draft-email.js
//  FN_VERSION: slde-v6   (2026-07-17)
//
//  Emails a LANDLORD when you set their rental listing back to draft because
//  the photos don't meet the Renters.com community photo standard.
//  - reason checkboxes shape the email (POST `reasons` array)
//  - every send BCCs LISTING_EMAIL_BCC (default kenny@renters.com) as a record
//  - admin-key gated, input-hardened; matches send-verification-email.js
// ============================================================
const FN_VERSION = "slde-v6";

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
// Blind copy of every send lands here as your "sent" record. Set LISTING_EMAIL_BCC to "" to turn off.
const BCC = process.env.LISTING_EMAIL_BCC != null ? process.env.LISTING_EMAIL_BCC : "kenny@renters.com";

function cleanName(raw) {
  var n = String(raw == null ? "" : raw).trim();
  if (!n) return "there";
  n = n.replace(/([A-Za-z0-9])\.([A-Za-z0-9])/g, "$1 $2").trim();
  if (!n) return "there";
  return n;
}
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function looksLikeEmail(e) {
  if (typeof e !== "string") return false;
  const v = e.trim();
  return v.length <= 254 && /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/.test(v);
}
function safeEqual(a, b) {
  const ab = Buffer.from(String(a == null ? "" : a));
  const bb = Buffer.from(String(b == null ? "" : b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

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

function buildEmail({ name, listingTitle, listingUrl, missing, reasons }) {
  const greet = esc(cleanName(name));
  const url = listingUrl || EDIT_URL;

  const titleHtml = listingTitle ? " &ldquo;" + esc(listingTitle) + "&rdquo;" : " your listing";
  const titleText = listingTitle ? ' "' + listingTitle + '"' : " your listing";

  const picked = [];
  (Array.isArray(reasons) ? reasons : []).forEach(function (r) {
    r = String(r == null ? "" : r).trim();
    if (r) picked.push(r);
  });
  if (missing && String(missing).trim()) picked.push(String(missing).trim());

  var midHtml, midText;
  if (picked.length) {
    midHtml = "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 14px;'>Here&rsquo;s what we still need before it can go live:</p>"
      + "<table style='border-collapse:collapse;width:100%;margin:0 0 20px;'>" + checklistRows(picked.map(esc)) + "</table>";
    midText = "Here's what we still need before it can go live:\n"
      + picked.map(function (i) { return "- " + i; }).join("\n") + "\n";
  } else {
    midHtml = "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 14px;'>To keep listings trustworthy for renters, every live listing needs clear, well-lit photos of the whole property:</p>"
      + "<table style='border-collapse:collapse;width:100%;margin:0 0 20px;'>" + checklistRows(STANDARD_ITEMS) + "</table>";
    midText = "To keep listings trustworthy for renters, every live listing needs clear, well-lit photos of the whole property:\n"
      + STANDARD_ITEMS_TEXT.map(function (i) { return "- " + i; }).join("\n") + "\n";
  }

  const subject = "Your Renters.com listing needs updated photos to go live";

  const html = "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
    + "<body style='margin:0;padding:0;background:#eef2f5;font-family:Open Sans,Arial,sans-serif;'>"
    + "<div style='max-width:560px;margin:0 auto;padding:24px 16px;'>"
    + "<div style='background:#0d2d4e;border-radius:14px 14px 0 0;padding:26px 30px;text-align:center;'>"
    + "<div style='font-size:22px;font-weight:800;color:#ffffff;'>RENTERS<span style='color:#8dc63f;'>.</span></div></div>"
    + "<div style='background:#ffffff;padding:32px 30px;border-radius:0 0 14px 14px;'>"
    + "<h1 style='font-size:22px;font-weight:800;color:#0d2d4e;margin:0 0 14px;'>A quick fix to get your listing live</h1>"
    + "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 16px;'>Hi " + greet + ", thanks for listing your place on Renters.com. We&rsquo;ve set" + titleHtml + " back to draft because the photos don&rsquo;t yet meet our community standard. It&rsquo;s a quick fix, not a rejection.</p>"
    + midHtml
    + "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 22px;'>Add those and set your listing back to live, and it&rsquo;ll be visible again.</p>"
    + "<div style='text-align:center;margin-bottom:24px;'>"
    + "<a href='" + esc(url) + "' style='display:inline-block;background:#8dc63f;color:#0d2d4e;text-decoration:none;border-radius:10px;padding:13px 30px;font-size:15px;font-weight:700;'>Edit your listing &rarr;</a></div>"
    + "<p style='font-size:14px;color:#4a5a6a;line-height:1.6;margin:0;'>&mdash; The Renters.com team</p>"
    + "</div>"
    + "<p style='font-size:12px;color:#9aa7b3;text-align:center;margin:18px 0 0;'>Renters.com. Finding a home should feel safe.</p>"
    + "</div></body></html>";

  const text = "Hi " + cleanName(name) + ",\n\n"
    + "Thanks for listing your place on Renters.com. We've set" + titleText + " back to draft because the photos don't yet meet our community standard. It's a quick fix, not a rejection.\n\n"
    + midText + "\n"
    + "Add those and set your listing back to live, and it'll be visible again.\n\n"
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
        bcc: BCC && looksLikeEmail(BCC) ? BCC.trim() : null,
      }),
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: "Method Not Allowed" };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Invalid JSON" }) }; }

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
    reasons: body.reasons,
  });

  const destination = { ToAddresses: [email] };
  if (BCC && looksLikeEmail(BCC)) destination.BccAddresses = [BCC.trim()];

  const command = new SendEmailCommand({
    Source: SENDER,
    Destination: destination,
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

module.exports._internal = { buildEmail, cleanName, esc, looksLikeEmail, FN_VERSION };
