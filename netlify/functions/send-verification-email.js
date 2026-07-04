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
exports.handler = async function (event) {
  // Handle preflight OPTIONS request
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
  const { type, email, name, pct, optStatus } = body;
  if (!type || !email || !name) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing required fields: type, email, name" }) };
  }
  let subject, bodyText;
  if (type === "approved") {
    subject = "Your Renters.com verification is approved";
    bodyText = `Hi ${name},
Your identity has been verified. Your profile is now verified on Renters.com.
You can view your verified status by logging into your dashboard at:
https://www.renters.com/account/home
Thank you for taking the time to verify your identity. It helps build trust across our entire community.
Renters.com Support`;
  } else if (type === "rejected") {
    subject = "Your Renters.com verification needs another look";
    bodyText = `Hi ${name},
Thank you for submitting your verification. We weren't able to approve it yet, because we couldn't clearly match your ID to your profile photo.
Here's how verification works: we compare the photo on your valid ID to the profile photo on your account. For that to work, both need to clearly show your face.
To get verified, please make sure:
- Your profile photo is a clear, front-facing, close-up of your face — like an ID photo. Just you, no group photos, hats, or sunglasses.
- Your ID is a valid government-issued ID (driver's license, passport, or state ID) with your photo and name clearly visible.
- The two photos are of the same person and easy to compare.
To resubmit: log into your dashboard, make sure your profile photo under My Photo is a clear headshot, then click "Verify Your Profile" under Account Details to upload your ID.
If you have any questions, just reply to this email.
Renters.com Support`;
  } else if (type === "on-hold") {
    const pctStr = (pct || pct === 0) ? String(pct).replace(/[^0-9]/g, "") + "%" : "";
    const optLine = optStatus === "opted-in"
      ? "You have opted in to our matching service, so landlords can find you."
      : optStatus === "opted-out"
      ? "You have opted out of our matching service for now."
      : "";
    subject = "Your Renters.com verification is on hold: one quick fix";
    bodyText = `Hi ${name},
Good news first: your identity is verified.${pctStr ? " Your profile is " + pctStr + " complete." : ""}${optLine ? " " + optLine : ""}
Before we switch on your blue check, one thing needs attention: your profile photo does not yet meet our community standard. Your photo is how renters and landlords know they are dealing with a real, accountable person, so it needs to clearly show your face, be well lit, and be just you (no logos, group shots, hats, sunglasses, or filters).
Please upload a new profile photo under My Photo in your dashboard:
https://www.renters.com/account/home
Once it is updated, we will take another look and finish your verification. If you have any questions, just reply to this email.
Renters.com Support`;
  } else {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Invalid type - must be 'approved', 'rejected', or 'on-hold'" }) };
  }
  const command = new SendEmailCommand({
    Source: "verify@renters.com",
    Destination: {
      ToAddresses: [email],
    },
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: {
        Text: { Data: bodyText, Charset: "UTF-8" },
      },
    },
  });
  try {
    await ses.send(command);
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, type, email }),
    };
  } catch (err) {
    console.error("SES error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to send email", details: err.message }),
    };
  }
};
