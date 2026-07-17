// ============================================================
//  send-listing-draft-email.js
//  FN_VERSION: slde-v2   (2026-07-17)
//
//  Emails a LANDLORD when you set their rental listing back to draft for not
//  meeting the Renters.com photo standard (comprehensive photos of every
//  inside + outside space, including shared spaces).
//
//  Built to match send-verification-email.js exactly:
//   - @aws-sdk/client-ses (SESClient / SendEmailCommand) — same as sve-v3
//   - same env vars: SES_REGION, SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY
//     (already set in Netlify — that's why the verification emails send)
//   - same brand shell (navy #0d2d4e header, lime #8dc63f, RENTERS. wordmark)
//   - same cleanName(): blank -> "there"; de-links domain-like names
//
//  ONE addition over sve-v3: an admin-key gate on the POST, so the URL can't
//  be used as an open email relay against your SES sending reputation. (The
//  verification function is currently open — worth adding the same gate there.)
//
//  Changelog
//   slde-v2  Jul 17  Rewritten to use @aws-sdk/client-ses + the sve-v3 brand
//                    shell (was raw SigV4 in slde-v1). Copy trimmed per Kenny.
//   slde-v1  Jul 17  First cut (raw SigV4). Superseded before deploy.
//
//  ENV
//   SES_REGION              default "us-east-2"        (already set)
//   SES_ACCESS_KEY_ID       (already set)
//   SES_SECRET_ACCESS_KEY   (already set)
//   LISTING_EMAIL_ADMIN_KEY REQUIRED. Must match the KEY in the bookmarklet.
//   LISTING_EMAIL_SENDER    default "verify@renters.com" (proven DKIM sender;
//                           any @renters.com works since the domain is DKIM-verified)
//   LISTING_EMAIL_REPLYTO   default = sender
//   EDIT_LISTING_URL        default "https://www.renters.com/account/home"
//                           Point at the exact edit-listing slug if you have one.
//
//  ENDPOINTS
//   GET  ?version=1  -> { ok, _v, region, adminKeyConfigured, sesKeyConfigured }
//   POST (JSON)      -> { key, email, name?, listingTitle?, listingUrl?, missing? }
// ============================================================
const FN_VERSION = "slde-v2";

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

// --- Name cleanup (same as send-verification-email.js) ---
function cleanName(raw) {
  var n = String(raw == null ? "" : raw).trim();
  if (!n) return "there";
  n = n.replace(/([A-Za-z0-9])\.([A-Za-z0-9])/g, "$1 $2").trim();
  if (!n) return "there";
  return n;
}
// Escape user-supplied values that land in the HTML (listing title, missing note,
// name) so a stray "<" in a listing title can't break the email markup.
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function looksLikeEmail(e) {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e).trim());
}

function buildEmail({ name, listingTitle, listingUrl, missing }) {
  const greet = esc(cleanName(name));
  const url = listingUrl || EDIT_URL;

  // "...set {your listing "Title"} back to draft..."
  const titleHtml = listingTitle ? " &ldquo;" + esc(listingTitle) + "&rdquo;" : " your listing";
  const titleText = listingTitle ? ' "' + listingTitle + '"' : " your listing";

  const missingHtml = missing
    ? "<div style='background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px 16px;margin-bottom:18px;'>"
      + "<p style='font-size:14px;color:#7c2d12;line-height:1.6;margin:0;'><strong>What we still need to see:</strong> "
      + esc(missing) + "</p></div>"
    : "";
  const missingText = missing ? "\nWhat we still need to see: " + missing + "\n" : "";

  const subject = "Your Renters.com listing needs a few more photos to go live";

  const html = "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
    + "<body style='margin:0;padding:0;background:#eef2f5;font-family:Open Sans,Arial,sans-serif;'>"
    + "<div style='max-width:560px;margin:0 auto;padding:24px 16px;'>"
    + "<div style='background:#0d2d4e;border-radius:14px 14px 0 0;padding:26px 30px;text-align:center;'>"
    + "<div style='font-size:22px;font-weight:800;color:#ffffff;'>RENTERS<span style='color:#8dc63f;'>.</span></div></div>"
    + "<div style='background:#ffffff;padding:32px 30px;border-radius:0 0 14px 14px;'>"
    + "<h1 style='font-size:22px;font-weight:800;color:#0d2d4e;margin:0 0 14px;'>A quick fix to get your listing live</h1>"
    + "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 16px;'>Hi " + greet + ", thanks for listing your place on Renters.com. We&rsquo;ve set" + titleHtml + " back to draft for now, and it&rsquo;s a quick fix, not a rejection.</p>"
    + "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 16px;'>To keep listings trustworthy for renters, every live listing needs comprehensive photos of the whole property: every inside space (each room, the kitchen, bathrooms), the outside of the property, and any shared spaces (hallways, laundry, common areas, yard, parking).</p>"
    + missingHtml
    + "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 22px;'>Yours is missing some of these, so renters can&rsquo;t yet see the full picture. Add the remaining photos and set your listing back to live, and it&rsquo;ll be visible again.</p>"
    + "<div style='text-align:center;margin-bottom:24px;'>"
    + "<a href='" + esc(url) + "' style='display:inline-block;background:#8dc63f;color:#0d2d4e;text-decoration:none;border-radius:10px;padding:13px 30px;font-size:15px;font-weight:700;'>Edit your listing &rarr;</a></div>"
    + "<p style='font-size:14px;color:#4a5a6a;line-height:1.6;margin:0;'>&mdash; The Renters.com team</p>"
    + "</div>"
    + "<p style='font-size:12px;color:#9aa7b3;text-align:center;margin:18px 0 0;'>Renters.com. Finding a home should feel safe.</p>"
    + "</div></body></html>";

  const text = "Hi " + cleanName(name) + ",\n\n"
    + "Thanks for listing your place on Renters.com. We've set" + titleText + " back to draft for now, and it's a quick fix, not a rejection.\n\n"
    + "To keep listings trustworthy for renters, every live listing needs comprehensive photos of the whole property: every inside space (each room, the kitchen, bathrooms), the outside of the property, and any shared spaces (hallways, laundry, common areas, yard, parking).\n"
    + missingText + "\n"
    + "Yours is missing some of these, so renters can't yet see the full picture. Add the remaining photos and set your listing back to live, and it'll be visible again.\n\n"
    + "Edit your listing: " + url + "\n\n"
    + "- The Renters.com team\n\n"
    + "Renters.com. Finding a home should feel safe.";

  return { subject, html, text };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };

  // GET = version / config probe. Open the URL in a browser to confirm the
  // deploy and whether the env vars registered.
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
  if (!adminKey || body.key !== adminKey) {
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

// Exported for local execution / tests (Workflow Rule 16: run it before shipping)
module.exports._internal = { buildEmail, cleanName, esc, looksLikeEmail, FN_VERSION };
