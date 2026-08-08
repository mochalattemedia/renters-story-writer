// ============================================================
//  feed-request.js   ·   VERSION: fr-v1   (2026-08-07)
//
//  Receives a property manager's feed details and emails them to Kenny.
//
//  WHY THIS EXISTS
//  The "Add Your Properties Feed" menu link pointed at
//  /checkout/propertymanagers - a PAYMENT page. So a PM who had already
//  signed up was sent back to checkout, and the head code that hides signup
//  routes from logged-in members left them with no route at all.
//  This is the destination that link should have had.
//
//  DELIBERATELY PUBLIC. A PM who has not signed up yet sending us their feed
//  is a lead, not a problem - and gating the page would mean the people most
//  worth hearing from cannot reach it.
//
//  NO BD WRITE. This is a conversation starter, not a lead record. Feed
//  ingestion is a manual, one-company-at-a-time process by design, and
//  creating a BD lead here would put a PM into a renter-shaped pipeline.
//
//  ENDPOINTS
//   GET  ?version=1   config probe
//   POST { company, name, email, phone?, feedUrl?, format?, units?, notes? }
//
//  ENV  FEED_NOTIFY_TO (default kenny@renters.com), AWS SES creds
// ============================================================
const FN_VERSION = "fr-v1";

const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");

const ses = new SESClient({ region: process.env.AWS_REGION || "us-east-1" });
const NOTIFY_TO = process.env.FEED_NOTIFY_TO || "kenny@renters.com";
const FROM = process.env.FEED_NOTIFY_FROM || "verify@renters.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

function ok(b, s) { return { statusCode: s || 200, headers: corsHeaders, body: JSON.stringify(b) }; }

function looksLikeEmail(e) {
  if (typeof e !== "string") return false;
  var v = e.trim();
  return v.length <= 254 && /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/.test(v);
}

// Trimmed and length-capped. Everything here lands in an email we read, so
// the only real risk is someone pasting something enormous.
function clean(v, max) {
  if (v == null) return "";
  return String(v).replace(/[\r\n]+/g, " ").trim().slice(0, max || 200);
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };
  var q = event.queryStringParameters || {};

  if (event.httpMethod === "GET" && q.version === "1") {
    return ok({ ok: true, _v: FN_VERSION, notifyTo: NOTIFY_TO });
  }
  if (event.httpMethod !== "POST") return ok({ error: "POST a feed request" }, 405);

  var body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return ok({ error: "Invalid JSON" }, 400); }

  // A honeypot. Real people never see this field, so anything filling it is
  // a bot - the same trick BD's own bd_hpc uses, and it costs a human
  // nothing, unlike a captcha.
  if (clean(body.website)) {
    console.log("[feed-request] honeypot filled, discarding");
    return ok({ ok: true, _v: FN_VERSION, received: true });
  }

  var company = clean(body.company, 120);
  var name = clean(body.name, 120);
  var email = clean(body.email, 254);
  var phone = clean(body.phone, 40);
  var feedUrl = clean(body.feedUrl, 500);
  var format = clean(body.format, 40);
  var units = clean(body.units, 40);
  var notes = clean(body.notes, 1200);

  if (!name) return ok({ error: "Please tell us your name" }, 400);
  if (!looksLikeEmail(email)) return ok({ error: "Please give us an email we can reply to" }, 400);
  if (!feedUrl && !notes) {
    return ok({ error: "Send us a feed URL, or tell us what format your listings are in" }, 400);
  }

  var lines = [
    "A property manager wants to send us their listings.",
    "",
    "Company:   " + (company || "(not given)"),
    "Contact:   " + name,
    "Email:     " + email,
    "Phone:     " + (phone || "(not given)"),
    "Units:     " + (units || "(not given)"),
    "Format:    " + (format || "(not given)"),
    "",
    "Feed URL:",
    feedUrl || "(none given)",
    "",
    "Notes:",
    notes || "(none)",
    "",
    "Received:  " + new Date().toISOString(),
  ];

  var ip = (event.headers && (event.headers["x-nf-client-connection-ip"] || event.headers["client-ip"])) || "";
  if (ip) lines.push("IP:        " + ip);

  try {
    await ses.send(new SendEmailCommand({
      Source: FROM,
      Destination: { ToAddresses: [NOTIFY_TO] },
      // So a reply goes to the PM rather than to ourselves.
      ReplyToAddresses: [email],
      Message: {
        Subject: { Data: "Feed request: " + (company || name) },
        Body: { Text: { Data: lines.join("\n") } },
      },
    }));
  } catch (err) {
    console.error("[feed-request] send failed:", err && err.message);
    return ok({ error: "We could not send that just now. Email us directly and we will pick it up.", detail: err && err.message }, 502);
  }

  console.log("[feed-request] " + (company || name) + " <" + email + ">" + (feedUrl ? " with a feed URL" : ""));
  return ok({ ok: true, _v: FN_VERSION, received: true });
};
