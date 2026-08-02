// ============================================================
//  send-listing-draft-email.js
//  FN_VERSION: slde-v12  (2026-07-17)
//
//  Emails a LANDLORD when a listing is set back to draft for not meeting the
//  photo standard, AND keeps a per-listing "what's missing" status so the
//  listings page can be annotated without opening each one.
//
//  Changelog
//   slde-v12 Jul 17  Two sections: POST accepts `listingReasons` and
//                    `profileReasons` (plus `missing`). Email renders a
//                    "On your listing" callout and an "On your profile" callout
//                    separately, then the full standard photo checklist. Status
//                    logs the combined items. `reasons` still accepted (treated
//                    as listing) for back-compat.
//   slde-v11 Jul 17  Preview mode: POST { preview:true, reasons, missing } returns
//                    the rendered { subject, html, text } WITHOUT sending, so the
//                    bookmarklet can show an in-panel email preview before send.
//   slde-v10 Jul 17  Email now ALWAYS shows the full standard checklist; ticked
//                    reasons appear as a highlighted "on your listing
//                    specifically" callout above it (both, not either/or). The
//                    per-listing status still logs just the ticked specifics.
//   slde-v9  Jul 17  Per-listing status tracker. POST accepts `postId` (the
//                    "ID:" on the listing row) and logs {items, date, to} to a
//                    Netlify Blob index (store "listing-status", key "index").
//                    New `saveOnly:true` logs the status WITHOUT sending an
//                    email. New GET `?statuses=1` returns the whole index for
//                    the list-page overlay bookmarklet.
//   slde-v8  Jul 17  Member-ID lookup via BD /user/get/{id} + BD_API_KEY.
//   slde-v7  Jul 17  Dropped listing-title from copy; sender verify@renters.com.
//   slde-v6  Jul 17  BCC every send to LISTING_EMAIL_BCC (default kenny@).
//   slde-v5  Jul 17  Reason checkboxes.
//   slde-v4  Jul 17  Security hardening.
//   slde-v3/2/1      Template, SDK rewrite, first cut.
//
//  ENV: SES_* · LISTING_EMAIL_ADMIN_KEY · LISTING_EMAIL_SENDER (verify@) ·
//       LISTING_EMAIL_BCC (kenny@) · EDIT_LISTING_URL · BD_API_KEY.
//  Blob: uses @netlify/blobs (already a dependency) — store "listing-status".
//
//  ENDPOINTS
//   GET ?version=1   -> config probe
//   GET ?statuses=1  -> { "<postId>": { items:[...], date, to }, ... }
//   POST (JSON)      -> { key, email?|memberId?, reasons?, missing?, postId?, saveOnly? }
// ============================================================
const FN_VERSION = "slde-v12";

const crypto = require("crypto");
const https = require("https");
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
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Content-Type": "application/json",
};

const SENDER = process.env.LISTING_EMAIL_SENDER || "verify@renters.com";
const REPLYTO = process.env.LISTING_EMAIL_REPLYTO || SENDER;
const EDIT_URL = process.env.EDIT_LISTING_URL || "https://www.renters.com/account/home";
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

// ---- per-listing status index (Netlify Blob) --------------------------------
function statusStore() { return require("@netlify/blobs").getStore("listing-status"); }
async function readStatusIndex() {
  try { return (await statusStore().get("index", { type: "json" })) || {}; }
  catch (e) { console.error("[slde] status read failed: " + (e && e.message)); return {}; }
}
async function writeStatus(postId, entry) {
  try {
    const store = statusStore();
    const idx = (await store.get("index", { type: "json" })) || {};
    idx[String(postId)] = entry;
    await store.setJSON("index", idx);
    return true;
  } catch (e) { console.error("[slde] status write failed: " + (e && e.message)); return false; }
}

// ---- BD member lookup -------------------------------------------------------
function bdGetMember(id) {
  return new Promise(function (resolve) {
    const key = process.env.BD_API_KEY;
    if (!key) return resolve({ error: "no_bd_key" });
    const req = https.request(
      { host: "www.renters.com", path: "/api/v2/user/get/" + encodeURIComponent(String(id).trim()),
        method: "GET", headers: { "X-Api-Key": key, Accept: "application/json" } },
      function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); return resolve({ error: "redirect_" + res.statusCode }); }
        let data = "";
        res.on("data", function (c) { data += c; });
        res.on("end", function () {
          try {
            const j = JSON.parse(data);
            const rec = Array.isArray(j.message) ? j.message[0] : (j.message || j.data || j);
            if (!rec || typeof rec !== "object") return resolve({ error: "no_record" });
            const email = rec.email || rec.user_email || rec.email_address || "";
            let firstName = rec.first_name || rec.firstname || "";
            if (!firstName && rec.name) firstName = String(rec.name).trim().split(/\s+/)[0];
            if (!email) { console.error("[slde] BD " + id + ": no email; keys=" + Object.keys(rec).join(",")); return resolve({ error: "no_email_on_record" }); }
            resolve({ email: String(email).trim(), firstName: String(firstName || "").trim() });
          } catch (e) { resolve({ error: "parse_error", raw: String(data).slice(0, 160) }); }
        });
      }
    );
    req.on("error", function (e) { resolve({ error: String(e && e.message) }); });
    req.end();
  });
}

// ---- email content ----------------------------------------------------------
const STANDARD_ITEMS = [
  "<strong style='color:#0d2d4e;'>Every room inside</strong> &mdash; the living area and each bedroom",
  "<strong style='color:#0d2d4e;'>The kitchen</strong>",
  "<strong style='color:#0d2d4e;'>Each bathroom</strong>",
  "<strong style='color:#0d2d4e;'>The outside of the property</strong> &mdash; the front, and any yard or grounds",
  "<strong style='color:#0d2d4e;'>Any shared spaces</strong> &mdash; hallways, stairwells, laundry, common areas, and parking",
];
const STANDARD_ITEMS_TEXT = [
  "Every room inside - the living area and each bedroom", "The kitchen", "Each bathroom",
  "The outside of the property - the front, and any yard or grounds",
  "Any shared spaces - hallways, stairwells, laundry, common areas, and parking",
];
function checklistRows(items) {
  return items.map(function (it) {
    return "<tr><td style='vertical-align:top;padding:0 10px 10px 0;'><span style='color:#8dc63f;font-size:18px;line-height:1.4;'>&#9679;</span></td>"
      + "<td style='padding:0 0 10px 0;font-size:14px;color:#4a5a6a;line-height:1.55;'>" + it + "</td></tr>";
  }).join("");
}
// Reasons ticked + optional free-text "other", as a plain-string list.
function pickedItems(reasons, missing) {
  const picked = [];
  (Array.isArray(reasons) ? reasons : []).forEach(function (r) { r = String(r == null ? "" : r).trim(); if (r) picked.push(r); });
  if (missing && String(missing).trim()) picked.push(String(missing).trim());
  return picked;
}
function buildEmail({ name, listingUrl, listingPicked, profilePicked }) {
  const greet = esc(cleanName(name));
  const url = listingUrl || EDIT_URL;
  listingPicked = listingPicked || [];
  profilePicked = profilePicked || [];
  function callout(title, items, textColor, bg, border) {
    return "<div style='background:" + bg + ";border:1px solid " + border + ";border-radius:10px;padding:14px 16px;margin:0 0 18px;'>"
      + "<p style='font-size:14px;color:" + textColor + ";line-height:1.55;margin:0 0 6px;font-weight:700;'>" + title + "</p>"
      + "<table style='border-collapse:collapse;width:100%;'>" + checklistRows(items.map(esc)) + "</table></div>";
  }
  var specificHtml = "", specificText = "";
  if (listingPicked.length) {
    specificHtml += callout("On your listing, we still need:", listingPicked, "#7c2d12", "#fff7ed", "#fed7aa");
    specificText += "On your listing, we still need:\n" + listingPicked.map(function (i) { return "- " + i; }).join("\n") + "\n\n";
  }
  if (profilePicked.length) {
    specificHtml += callout("On your profile, please add or complete:", profilePicked, "#0c4a6e", "#eff6ff", "#bfdbfe");
    specificText += "On your profile, please add or complete:\n" + profilePicked.map(function (i) { return "- " + i; }).join("\n") + "\n\n";
  }
  // ...and ALWAYS the full standard photo checklist beneath.
  var standardHtml = "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 14px;'>Every live listing needs clear, well-lit photos of the whole property:</p>"
    + "<table style='border-collapse:collapse;width:100%;margin:0 0 20px;'>" + checklistRows(STANDARD_ITEMS) + "</table>";
  var standardText = "Every live listing needs clear, well-lit photos of the whole property:\n" + STANDARD_ITEMS_TEXT.map(function (i) { return "- " + i; }).join("\n") + "\n";
  var midHtml = specificHtml + standardHtml;
  var midText = specificText + standardText;
  const subject = "Your Renters.com listing needs updated photos to go live";
  const html = "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
    + "<body style='margin:0;padding:0;background:#eef2f5;font-family:Open Sans,Arial,sans-serif;'>"
    + "<div style='max-width:560px;margin:0 auto;padding:24px 16px;'>"
    + "<div style='background:#0d2d4e;border-radius:14px 14px 0 0;padding:26px 30px;text-align:center;'>"
    + "<div style='font-size:22px;font-weight:800;color:#ffffff;'>RENTERS<span style='color:#8dc63f;'>.</span></div></div>"
    + "<div style='background:#ffffff;padding:32px 30px;border-radius:0 0 14px 14px;'>"
    + "<h1 style='font-size:22px;font-weight:800;color:#0d2d4e;margin:0 0 14px;'>A quick fix to get your listing live</h1>"
    + "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 16px;'>Hi " + greet + ", thanks for listing your place on Renters.com. We&rsquo;ve set your listing back to draft because the photos don&rsquo;t yet meet our community standard. It&rsquo;s a quick fix, not a rejection.</p>"
    + midHtml
    + "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 22px;'>Add those and set your listing back to live, and it&rsquo;ll be visible again.</p>"
    + "<div style='text-align:center;margin-bottom:24px;'><a href='" + esc(url) + "' style='display:inline-block;background:#8dc63f;color:#0d2d4e;text-decoration:none;border-radius:10px;padding:13px 30px;font-size:15px;font-weight:700;'>Edit your listing &rarr;</a></div>"
    + "<p style='font-size:14px;color:#4a5a6a;line-height:1.6;margin:0;'>&mdash; The Renters.com team</p>"
    + "</div><p style='font-size:12px;color:#9aa7b3;text-align:center;margin:18px 0 0;'>Renters.com. Finding a home should feel safe.</p>"
    + "</div></body></html>";
  const text = "Hi " + cleanName(name) + ",\n\n"
    + "Thanks for listing your place on Renters.com. We've set your listing back to draft because the photos don't yet meet our community standard. It's a quick fix, not a rejection.\n\n"
    + midText + "\nAdd those and set your listing back to live, and it'll be visible again.\n\nEdit your listing: " + url + "\n\n- The Renters.com team\n\nRenters.com. Finding a home should feel safe.";
  return { subject, html, text };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === "GET") {
    if (qs.statuses != null) {
      const idx = await readStatusIndex();
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(idx) };
    }
    return {
      statusCode: 200, headers: corsHeaders,
      body: JSON.stringify({
        ok: true, _v: FN_VERSION, region: process.env.SES_REGION || "us-east-2",
        adminKeyConfigured: !!process.env.LISTING_EMAIL_ADMIN_KEY,
        sesKeyConfigured: !!process.env.SES_ACCESS_KEY_ID && !!process.env.SES_SECRET_ACCESS_KEY,
        bdKeyConfigured: !!process.env.BD_API_KEY, sender: SENDER,
        bcc: BCC && looksLikeEmail(BCC) ? BCC.trim() : null,
      }),
    };
  }

  if (event.httpMethod !== "POST") return { statusCode: 405, headers: corsHeaders, body: "Method Not Allowed" };

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const adminKey = process.env.LISTING_EMAIL_ADMIN_KEY || "";
  if (!adminKey || !safeEqual(body.key, adminKey)) {
    console.warn("[slde] rejected: bad or missing admin key");
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  const postId = String(body.postId || "").trim();
  const saveOnly = !!body.saveOnly;
  // Listing section (accepts legacy `reasons` too) + Profile section.
  const listingSrc = body.listingReasons != null ? body.listingReasons : body.reasons;
  const listingPicked = pickedItems(listingSrc, body.missing);
  const profilePicked = pickedItems(body.profileReasons, null);
  const picked = listingPicked.concat(profilePicked); // combined, for the status log/tracker
  const nowISO = new Date().toISOString();

  // Preview: render the email and return it, without sending or requiring a recipient.
  if (body.preview === true) {
    const pv = buildEmail({ name: body.name, listingUrl: body.listingUrl, listingPicked: listingPicked, profilePicked: profilePicked });
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, preview: true, subject: pv.subject, html: pv.html, text: pv.text }) };
  }

  // Save-only: record the listing's status without emailing anyone.
  if (saveOnly) {
    if (!postId) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "postId required to save a status" }) };
    await writeStatus(postId, { items: picked, date: nowISO, to: null });
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, saved: true, postId: postId, items: picked }) };
  }

  // Send path: resolve recipient (memberId lookup or typed email).
  let email = String(body.email || "").trim();
  let name = body.name;
  if ((!email || !name) && body.memberId != null && String(body.memberId).trim()) {
    const m = await bdGetMember(String(body.memberId).trim());
    if (m.error && !email) return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: "Could not look up member " + String(body.memberId).trim(), detail: m.error }) };
    if (!email && m.email) email = m.email;
    if (!name && m.firstName) name = m.firstName;
  }
  if (!looksLikeEmail(email)) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Provide a landlord email or a valid member ID", got: email }) };

  const { subject, html, text } = buildEmail({ name: name, listingUrl: body.listingUrl, listingPicked: listingPicked, profilePicked: profilePicked });

  const destination = { ToAddresses: [email] };
  if (BCC && looksLikeEmail(BCC)) destination.BccAddresses = [BCC.trim()];
  const command = new SendEmailCommand({
    Source: SENDER, Destination: destination, ReplyToAddresses: [REPLYTO],
    Message: { Subject: { Data: subject, Charset: "UTF-8" }, Body: { Text: { Data: text, Charset: "UTF-8" }, Html: { Data: html, Charset: "UTF-8" } } },
  });

  try {
    const res = await ses.send(command);
    if (postId) await writeStatus(postId, { items: picked, date: nowISO, to: email });
    console.log("[slde] sent to " + email + (postId ? " (listing " + postId + ")" : "") + " MessageId=" + (res && res.MessageId));
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, _v: FN_VERSION, email, postId: postId || null, messageId: (res && res.MessageId) || null }) };
  } catch (err) {
    console.error("[slde] SES error:", err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Failed to send email", details: err.message }) };
  }
};

module.exports._internal = { buildEmail, cleanName, esc, looksLikeEmail, pickedItems, FN_VERSION };
