const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");

const ses = new SESClient({
  region: process.env.SES_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.SES_ACCESS_KEY_ID,
    secretAccessKey: process.env.SES_SECRET_ACCESS_KEY,
  },
});

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { type, email, name } = body;

  if (!type || !email || !name) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required fields: type, email, name" }) };
  }

  let subject, bodyText;

  if (type === "approved") {
    subject = "Your Renters.com verification is approved";
    bodyText = `Hi ${name},

Your identity verification has been approved. Your profile is now verified on Renters.com.

You can view your verified status by logging into your dashboard at:
https://www.renters.com/account/home

Thank you for taking the time to verify your identity. It helps build trust across our entire community.

Renters.com Support`;

  } else if (type === "rejected") {
    subject = "Your Renters.com verification needs a resubmission";
    bodyText = `Hi ${name},

Thank you for submitting your verification. Unfortunately we weren't able to approve it because the photo didn't meet our requirements.

We need one single photo showing:
- Your face, clearly visible
- Your government-issued ID held next to your face

Common reasons for rejection:
- Photo of ID only, no face visible
- No photo submitted at all
- Photo of something unrelated

Please resubmit by logging into your dashboard and clicking "Verify Your Profile" under Account Details.

If you have any questions just reply to this email.

Renters.com Support`;

  } else {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid type — must be 'approved' or 'rejected'" }) };
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
      headers,
      body: JSON.stringify({ success: true, type, email }),
    };
  } catch (err) {
    console.error("SES error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to send email", details: err.message }),
    };
  }
};
