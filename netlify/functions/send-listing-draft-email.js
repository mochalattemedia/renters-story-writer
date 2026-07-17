// send-listing-draft-email.js  —  FN_VERSION: slde-v1
// ---------------------------------------------------------------------------
// Netlify function. Emails a LANDLORD when you set their rental listing back
// to draft for not meeting the Renters.com photo standard (comprehensive
// photos of every inside + outside space, including shared spaces).
//
// Pattern clone of send-verification-email.js:
//   - SES, region us-east-2 (code fallback is us-east-2, per the Bible)
//   - DKIM-verified renters.com sender  (deliverability you already proved)
//   - HTML + plain text
//   - cleanName(): blank -> "there"; dots between alphanumerics -> spaces
// This function only SENDS mail (no BD write), so no read-back is needed
// (Workflow Rule 15 is about writes). It logs loudly and never swallows the
// SES response (Rule 8).
//
// ENV VARS  (⚠️ match these to whatever send-verification-email.js already uses
//            so both emails share one set of SES creds):
//   SES_REGION              default "us-east-2"
//   SES_ACCESS_KEY_ID       (falls back to AWS_ACCESS_KEY_ID)
//   SES_SECRET_ACCESS_KEY   (falls back to AWS_SECRET_ACCESS_KEY)
//   LISTING_EMAIL_SENDER    default "support@renters.com"  (any @renters.com works; domain is DKIM-verified)
//   LISTING_EMAIL_REPLYTO   default = sender
//   LISTING_EMAIL_ADMIN_KEY REQUIRED. Gates the POST so the URL can't be used
//                           as an open email relay against your SES reputation.
//   EDIT_LISTING_URL        default "https://www.renters.com/account/listings"
//                           ⚠️ CONFIRM the real "edit my listing" slug and set this.
//
// ENDPOINTS
//   GET  ?version=1   -> { fn, region, senderConfigured, awsKeyConfigured, adminKeyConfigured }
//   POST (JSON)       -> { key, email, name?, listingTitle?, listingUrl?, missing? }
//                        sends the email; returns { ok, messageId } or a loud error.
// ---------------------------------------------------------------------------

const crypto = require("crypto");
const https = require("https");

const FN_VERSION = "slde-v1";

// ---- small helpers ---------------------------------------------------------
function hmac(key, str) {
  return crypto.createHmac("sha256", key).update(str, "utf8").digest();
}
function sha256hex(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
// blank/missing -> "there"; domain-like names ("RENTERS.COM") get the dots
// between alphanumerics turned into spaces so mail clients don't auto-link them.
function cleanName(name) {
  if (!name || !String(name).trim()) return "there";
  let n = String(name).trim();
  n = n.replace(/([A-Za-z0-9])\.([A-Za-z0-9])/g, "$1 $2");
  return n;
}
function looksLikeEmail(e) {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

// ---- SES v2 send, signed with raw SigV4 (zero dependencies) ----------------
function sesSend({ region, accessKey, secretKey, payload }) {
  const service = "ses";
  const host = `email.${region}.amazonaws.com`;
  const path = "/v2/email/outbound-emails";
  const body = JSON.stringify(payload);

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = sha256hex(body);
  const canonicalHeaders =
    `content-type:application/json\n` + `host:${host}\n` + `x-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-date";
  const canonicalRequest = [
    "POST",
    path,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac("AWS4" + secretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto
    .createHmac("sha256", kSigning)
    .update(stringToSign, "utf8")
    .digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Amz-Date": amzDate,
          Authorization: authorization,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () =>
          resolve({ statusCode: res.statusCode, body: data })
        );
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ---- the email itself ------------------------------------------------------
function buildEmail({ name, listingTitle, listingUrl, missing }) {
  const greeting = esc(cleanName(name));
  const titlePhrase = listingTitle
    ? ` <strong>&ldquo;${esc(listingTitle)}&rdquo;</strong>`
    : " your listing";
  const titlePhraseText = listingTitle ? ` "${listingTitle}"` : " your listing";

  const missingHtml = missing
    ? `<tr><td style="padding:0 32px 20px;">
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;">
           <tr><td style="padding:14px 16px;color:#7c2d12;font-size:15px;line-height:1.5;">
             <strong>What we still need to see:</strong> ${esc(missing)}
           </td></tr>
         </table>
       </td></tr>`
    : "";
  const missingText = missing ? `\nWhat we still need to see: ${missing}\n` : "";

  const subject = "Your Renters.com listing needs a few more photos to go live";

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f6f8fa;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fa;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0"
             style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;
                    font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
        <tr><td style="background:#081f38;padding:20px 32px;">
          <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.2px;">Renters.com</span>
        </td></tr>

        <tr><td style="padding:28px 32px 8px;color:#0f172a;font-size:16px;line-height:1.55;">
          Hi ${greeting},
        </td></tr>

        <tr><td style="padding:0 32px 16px;color:#0f172a;font-size:16px;line-height:1.55;">
          Thanks for listing your place on Renters.com. We&rsquo;ve set${titlePhrase} back to draft for now,
          and it&rsquo;s a quick fix, not a rejection.
        </td></tr>

        <tr><td style="padding:0 32px 16px;color:#0f172a;font-size:16px;line-height:1.55;">
          To keep listings trustworthy for renters, every live listing needs comprehensive photos of the
          whole property: every inside space (each room, the kitchen, bathrooms), the outside of the property,
          and any shared spaces (hallways, laundry, common areas, yard, parking).
        </td></tr>

        ${missingHtml}

        <tr><td style="padding:0 32px 20px;color:#0f172a;font-size:16px;line-height:1.55;">
          Yours is missing some of these, so renters can&rsquo;t yet see the full picture. Add the remaining
          photos and set your listing back to live, and it&rsquo;ll be visible again.
        </td></tr>

        <tr><td style="padding:0 32px 24px;">
          <a href="${esc(listingUrl)}"
             style="display:inline-block;background:#84cc16;color:#0b1b0b;text-decoration:none;
                    font-weight:700;font-size:16px;padding:13px 24px;border-radius:8px;">
            Edit your listing &rarr;
          </a>
        </td></tr>

        <tr><td style="padding:0 32px 28px;color:#0f172a;font-size:16px;line-height:1.55;">
          &mdash; The Renters.com team
        </td></tr>

        <tr><td style="background:#f1f5f9;padding:16px 32px;color:#64748b;font-size:12px;line-height:1.5;">
          You&rsquo;re getting this because you have a listing on Renters.com.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Hi ${cleanName(name)},

Thanks for listing your place on Renters.com. We've set${titlePhraseText} back to draft for now, and it's a quick fix, not a rejection.

To keep listings trustworthy for renters, every live listing needs comprehensive photos of the whole property: every inside space (each room, the kitchen, bathrooms), the outside of the property, and any shared spaces (hallways, laundry, common areas, yard, parking).
${missingText}
Yours is missing some of these, so renters can't yet see the full picture. Add the remaining photos and set your listing back to live, and it'll be visible again.

Edit your listing: ${listingUrl}

- The Renters.com team`;

  return { subject, html, text };
}

// ---- handler ---------------------------------------------------------------
exports.handler = async (event) => {
  const region = process.env.SES_REGION || "us-east-2";
  const accessKey =
    process.env.SES_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || "";
  const secretKey =
    process.env.SES_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "";
  const sender = process.env.LISTING_EMAIL_SENDER || "support@renters.com";
  const replyTo = process.env.LISTING_EMAIL_REPLYTO || sender;
  const adminKey = process.env.LISTING_EMAIL_ADMIN_KEY || "";
  const defaultEditUrl =
    process.env.EDIT_LISTING_URL || "https://www.renters.com/account/listings";

  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // CORS preflight (bookmarklet posts cross-origin from the BD admin page)
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  // version / config probe — no secrets echoed
  if (event.httpMethod === "GET") {
    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({
        fn: FN_VERSION,
        region,
        senderConfigured: !!sender,
        awsKeyConfigured: !!accessKey && !!secretKey,
        adminKeyConfigured: !!adminKey,
        defaultEditUrl,
      }),
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: "method_not_allowed" }),
    };
  }

  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch (e) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: "bad_json" }),
    };
  }

  // admin gate — do NOT let this be an open relay
  if (!adminKey || data.key !== adminKey) {
    console.warn("[slde] rejected: bad or missing admin key");
    return {
      statusCode: 401,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: "unauthorized" }),
    };
  }

  const email = (data.email || "").trim();
  if (!looksLikeEmail(email)) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: "missing_or_bad_email", got: email }),
    };
  }

  if (!accessKey || !secretKey) {
    console.error("[slde] SES credentials not configured (SES_ACCESS_KEY_ID / SES_SECRET_ACCESS_KEY)");
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: "ses_not_configured" }),
    };
  }

  const listingUrl = (data.listingUrl || defaultEditUrl).trim();
  const { subject, html, text } = buildEmail({
    name: data.name,
    listingTitle: data.listingTitle,
    listingUrl,
    missing: data.missing,
  });

  const payload = {
    FromEmailAddress: sender,
    Destination: { ToAddresses: [email] },
    ReplyToAddresses: [replyTo],
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: html, Charset: "UTF-8" },
          Text: { Data: text, Charset: "UTF-8" },
        },
      },
    },
  };

  try {
    console.log(`[slde] ${FN_VERSION} sending to ${email} from ${sender} (region ${region})`);
    const res = await sesSend({ region, accessKey, secretKey, payload });
    let parsed = {};
    try {
      parsed = JSON.parse(res.body || "{}");
    } catch (_) {
      parsed = { raw: res.body };
    }

    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log(`[slde] sent, MessageId=${parsed.MessageId || "(none)"} to ${email}`);
      return {
        statusCode: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true, messageId: parsed.MessageId || null, to: email }),
      };
    }

    // Loud failure — never swallow the SES response (Workflow Rule 8)
    console.error(`[slde] SES rejected (${res.statusCode}): ${res.body}`);
    return {
      statusCode: 502,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        error: "ses_error",
        status: res.statusCode,
        detail: parsed,
      }),
    };
  } catch (err) {
    console.error(`[slde] send threw: ${err && err.message}`);
    return {
      statusCode: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "send_failed", detail: String(err && err.message) }),
    };
  }
};

// Exported for local execution / tests (Workflow Rule 16: run it before shipping)
module.exports._internal = { buildEmail, cleanName, esc, looksLikeEmail, FN_VERSION };
