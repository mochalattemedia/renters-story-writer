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

  const { opt, memberId, memberName, timestamp } = body;

  const optLabel = opt === "match"
    ? "✅ Opted INTO matching — placement fee applies on success"
    : "☑️ Opted OUT of matching — listing freely, no placement fee";

  const profileLink = memberId
    ? `https://ww2.managemydirectory.com/admin/viewMembers.php?faction=view&userid=${memberId}&newsite=38748`
    : "Unknown";

  const emailBody = `
New landlord completed onboarding on Renters.com.

Name: ${memberName || "Unknown"}
Member ID: ${memberId || "Unknown"}
Option selected: ${optLabel}
Time: ${timestamp || new Date().toISOString()}

View profile in BD admin:
${profileLink}

---
Renters.com Landlord Onboarding Notification
  `.trim();

  try {
    await ses.send(new SendEmailCommand({
      Source: "verify@renters.com",
      Destination: {
        ToAddresses: ["kenny@renters.com"],
      },
      Message: {
        Subject: {
          Data: opt === "match"
            ? `🏠 New landlord opted into matching — ${memberName || "Unknown"}`
            : `🏠 New landlord listed freely — ${memberName || "Unknown"}`,
        },
        Body: {
          Text: { Data: emailBody },
        },
      },
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to send email", details: err.message }),
    };
  }
};
