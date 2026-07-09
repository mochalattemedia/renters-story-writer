const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const ses = new SESClient({
  region: process.env.SES_REGION || "us-east-1",
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

// Decide which side of the marketplace a member is on.
// Renters get the renter email; landlords, property managers, and realtors
// (all supply-side) get the landlord email.
function isSupplySide(accountType) {
  const t = String(accountType || "").toLowerCase();
  if (t.indexOf("landlord") > -1) return true;
  if (t.indexOf("property") > -1) return true;   // property manager
  if (t.indexOf("manager") > -1) return true;
  if (t.indexOf("realtor") > -1) return true;
  if (t.indexOf("agent") > -1) return true;
  return false; // default: treat as renter
}

const BADGE = "https://www.renters.com/images/Twitter_Verified_Badge.svg.png";
const DASH = "https://www.renters.com/account/home";
const RENTER_SERVICE = "https://www.renters.com/renters-concierge";
const LANDLORD_SERVICE = "https://www.renters.com/landlords-concierge";

function htmlShell(name, headline, introLine, bullets, whereLine, nudgeTitle, nudgeBody, nudgeLink, nudgeBtn) {
  const bulletHtml = bullets.map(function (b) {
    return "<p style='font-size:14px;color:#4a5a6a;line-height:1.6;margin:0 0 8px;'>&#9679; " + b + "</p>";
  }).join("");
  return "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
    + "<body style='margin:0;padding:0;background:#eef2f5;font-family:Open Sans,Arial,sans-serif;'>"
    + "<div style='max-width:560px;margin:0 auto;padding:24px 16px;'>"
    + "<div style='background:#0d2d4e;border-radius:14px 14px 0 0;padding:26px 30px;text-align:center;'>"
    + "<div style='font-size:22px;font-weight:800;color:#ffffff;'>RENTERS<span style='color:#8dc63f;'>.</span></div></div>"
    + "<div style='background:#ffffff;padding:32px 30px;border-radius:0 0 14px 14px;'>"
    + "<div style='width:64px;height:64px;border-radius:50%;background:#eafaf1;text-align:center;line-height:64px;margin:0 auto 18px;'>"
    + "<img src='" + BADGE + "' alt='Verified' width='38' height='38' style='width:38px;height:38px;vertical-align:middle;' /></div>"
    + "<h1 style='font-size:24px;font-weight:800;color:#0d2d4e;text-align:center;margin:0 0 10px;'>" + headline + "</h1>"
    + "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;text-align:center;margin:0 0 24px;'>Hi " + name + ", " + introLine + "</p>"
    + "<div style='background:#f4f6f7;border-radius:10px;padding:18px 20px;margin-bottom:22px;'>"
    + "<p style='font-size:13px;font-weight:700;color:#0d2d4e;margin:0 0 10px;'>What being verified does for you:</p>"
    + bulletHtml + "</div>"
    + "<p style='font-size:14px;color:#4a5a6a;line-height:1.6;margin:0 0 22px;'>" + whereLine + "</p>"
    + "<div style='text-align:center;margin-bottom:26px;'>"
    + "<a href='" + DASH + "' style='display:inline-block;background:#8dc63f;color:#0d2d4e;text-decoration:none;border-radius:10px;padding:13px 30px;font-size:15px;font-weight:700;'>See your verified status &rarr;</a></div>"
    + "<div style='border-top:1px solid #eef1f3;padding-top:20px;'>"
    + "<p style='font-size:15px;font-weight:700;color:#0d2d4e;margin:0 0 6px;'>" + nudgeTitle + "</p>"
    + "<p style='font-size:14px;color:#4a5a6a;line-height:1.6;margin:0 0 14px;'>" + nudgeBody + "</p>"
    + "<a href='" + nudgeLink + "' style='display:inline-block;background:#0d2d4e;color:#ffffff;text-decoration:none;border-radius:10px;padding:11px 24px;font-size:14px;font-weight:700;'>" + nudgeBtn + " &rarr;</a></div>"
    + "</div>"
    + "<p style='font-size:12px;color:#9aa7b3;text-align:center;margin:18px 0 0;'>Renters.com. Finding a home should feel safe.</p>"
    + "</div></body></html>";
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: "Method Not Allowed" };
  }
  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Invalid JSON" }) };
  }
  const { type, email, name, accountType } = body;
  if (!type || !email || !name) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing required fields: type, email, name" }) };
  }
  if (type !== "approved") {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Invalid type, only 'approved' is supported" }) };
  }

  const supply = isSupplySide(accountType);
  const subject = "You\u2019re now verified on Renters.com \u2713";
  let bodyText, bodyHtml;

  if (supply) {
    // LANDLORD / PM / REALTOR
    bodyText = "Hi " + name + ",\n\n"
      + "What being verified does for you:\n"
      + "- Renters trust that your listings are legit, not a scam\n"
      + "- Your properties get taken seriously\n"
      + "- Renters know you\u2019re a real, verified landlord\n\n"
      + "Where you\u2019ll see it: \"Identity Confirmed\" in your dashboard, and a blue verified check on your public profile.\n\n"
      + "See your verified status: " + DASH + "\n\n"
      + "Ready to fill a vacancy?\n"
      + "We bring you prequalified, verified renters who are looking to rent. It\u2019s free to start, and you only pay when a renter we send actually moves in.\n"
      + "Learn more: " + LANDLORD_SERVICE + "\n\n"
      + "Renters.com. Finding a home should feel safe.";

    bodyHtml = htmlShell(
      name,
      "You\u2019re verified!",
      "your identity is confirmed and your account is now verified on Renters.com.",
      [
        "Renters trust that your listings are legit, not a scam.",
        "Your properties get taken seriously.",
        "Renters know you\u2019re a real, verified landlord.",
      ],
      "<strong>Where you\u2019ll see it:</strong> \"Identity Confirmed\" in your dashboard, and a blue verified check on your public profile.",
      "Ready to fill a vacancy?",
      "We bring you prequalified, verified renters who are looking to rent. It\u2019s free to start, and you only pay when a renter we send actually moves in.",
      LANDLORD_SERVICE,
      "See how it works"
    );
  } else {
    // RENTER
    bodyText = "Hi " + name + ",\n\n"
      + "What being verified does for you:\n"
      + "- Landlords take your inquiries seriously\n"
      + "- You stand out from unverified applicants\n"
      + "- Landlords know you\u2019re a real, verified person they can trust\n\n"
      + "Where you\u2019ll see it: \"Identity Confirmed\" in your dashboard, and a blue verified check on your public profile.\n\n"
      + "See your verified status: " + DASH + "\n\n"
      + "Want us to handle the showings?\n"
      + "Our concierge service sets up showings you\u2019re actually likely to land. We check for a real fit first, so you\u2019re not wasting application fees on places you had no shot at.\n"
      + "Learn more: " + RENTER_SERVICE + "\n\n"
      + "Renters.com. Finding a home should feel safe.";

    bodyHtml = htmlShell(
      name,
      "You\u2019re verified!",
      "your identity is confirmed and your account is now verified on Renters.com.",
      [
        "Landlords take your inquiries seriously.",
        "You stand out from unverified applicants.",
        "Landlords know you\u2019re a real, verified person they can trust.",
      ],
      "<strong>Where you\u2019ll see it:</strong> \"Identity Confirmed\" in your dashboard, and a blue verified check on your public profile.",
      "Want us to handle the showings?",
      "Our concierge service sets up showings you\u2019re actually likely to land. We check for a real fit first, so you\u2019re not wasting application fees on places you had no shot at.",
      RENTER_SERVICE,
      "See how it works"
    );
  }

  const command = new SendEmailCommand({
    Source: "verify@renters.com",
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: {
        Text: { Data: bodyText, Charset: "UTF-8" },
        Html: { Data: bodyHtml, Charset: "UTF-8" },
      },
    },
  });
  try {
    await ses.send(command);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, type, email, side: supply ? "landlord" : "renter" }) };
  } catch (err) {
    console.error("SES error:", err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Failed to send email", details: err.message }) };
  }
};
