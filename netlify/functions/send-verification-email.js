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

// Renter vs supply-side (landlord / property manager / realtor / agent)
function isSupplySide(accountType) {
  const t = String(accountType || "").toLowerCase();
  return (
    t.indexOf("landlord") > -1 ||
    t.indexOf("property") > -1 ||
    t.indexOf("manager") > -1 ||
    t.indexOf("realtor") > -1 ||
    t.indexOf("agent") > -1
  );
}

const BADGE = "https://www.renters.com/images/Twitter_Verified_Badge.svg.png";
const DASH = "https://www.renters.com/account/home";
const LISA = "https://www.renters.com/lisa";
const SAFETY = "https://www.renters.com/listing-safety-check";
const RENTER_SERVICE = "https://www.renters.com/renters-concierge";
const LANDLORD_SERVICE = "https://www.renters.com/landlords-concierge";
// Scheduling tool lives in the dashboard for now. When the /schedule-showings
// page is built, change SCHEDULE to "https://www.renters.com/schedule-showings".
const SCHEDULE = "https://www.renters.com/account/home";

function btn(href, label, primary) {
  const bg = primary ? "#8dc63f" : "#0d2d4e";
  const fg = primary ? "#0d2d4e" : "#ffffff";
  return "<a href='" + href + "' style='display:inline-block;background:" + bg + ";color:" + fg + ";text-decoration:none;border-radius:10px;padding:12px 26px;font-size:15px;font-weight:700;'>" + label + "</a>";
}

function checklistHtml(items) {
  return items.map(function (it) {
    return "<tr><td style='vertical-align:top;padding:0 10px 12px 0;'><span style='color:#8dc63f;font-size:18px;line-height:1.3;'>&#9679;</span></td>"
      + "<td style='padding:0 0 12px 0;font-size:14px;color:#4a5a6a;line-height:1.55;'>" + it + "</td></tr>";
  }).join("");
}

function toolCard(title, desc) {
  return "<div style='border:1px solid #e8eceb;border-radius:10px;padding:14px 16px;margin-bottom:10px;'>"
    + "<p style='font-size:14px;font-weight:700;color:#0d2d4e;margin:0 0 3px;'>" + title + "</p>"
    + "<p style='font-size:13px;color:#5a6a78;line-height:1.55;margin:0;'>" + desc + "</p></div>";
}

function shell(name, introLine, checklistItems, toolsHtml) {
  return "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
    + "<body style='margin:0;padding:0;background:#eef2f5;font-family:Open Sans,Arial,sans-serif;'>"
    + "<div style='max-width:580px;margin:0 auto;padding:24px 16px;'>"
    + "<div style='background:#0d2d4e;border-radius:14px 14px 0 0;padding:26px 30px;text-align:center;'>"
    + "<div style='font-size:22px;font-weight:800;color:#ffffff;'>RENTERS<span style='color:#8dc63f;'>.</span></div></div>"
    + "<div style='background:#ffffff;padding:32px 30px;border-radius:0 0 14px 14px;'>"
    + "<div style='width:64px;height:64px;border-radius:50%;background:#eafaf1;text-align:center;line-height:64px;margin:0 auto 18px;'>"
    + "<img src='" + BADGE + "' alt='Verified' width='38' height='38' style='width:38px;height:38px;vertical-align:middle;' /></div>"
    + "<h1 style='font-size:24px;font-weight:800;color:#0d2d4e;text-align:center;margin:0 0 10px;'>You\u2019re verified!</h1>"
    + "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;text-align:center;margin:0 0 20px;'>Hi " + name + ", " + introLine + "</p>"

    // where to see it
    + "<div style='background:#f4f6f7;border-radius:10px;padding:16px 18px;margin-bottom:24px;'>"
    + "<p style='font-size:13px;color:#4a5a6a;line-height:1.6;margin:0;'>Your dashboard now shows <strong style='color:#1e8449;'>Identity Confirmed</strong>, and your <strong style='color:#0d2d4e;'>verified badge</strong> appears on your public profile.</p></div>"

    // checklist
    + "<p style='font-size:16px;font-weight:800;color:#0d2d4e;margin:0 0 12px;'>Finish setting up</p>"
    + "<table style='border-collapse:collapse;width:100%;margin-bottom:20px;'>" + checklistHtml(checklistItems) + "</table>"
    + "<div style='text-align:center;margin-bottom:28px;'>" + btn(DASH, "Go to your dashboard &rarr;", true) + "</div>"

    // toolkit
    + "<p style='font-size:16px;font-weight:800;color:#0d2d4e;margin:0 0 12px;'>Your Renters.com toolkit</p>"
    + toolsHtml

    + "</div>"
    + "<p style='font-size:12px;color:#9aa7b3;text-align:center;margin:18px 0 0;'>Renters.com. Finding a home should feel safe.</p>"
    + "</div></body></html>";
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: corsHeaders, body: "Method Not Allowed" };

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const { type, email, name, accountType } = body;
  if (!type || !email || !name) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing required fields: type, email, name" }) };
  }
  if (type !== "approved" && type !== "denied" && type !== "needs-photo") {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Invalid type, use 'approved', 'denied', or 'needs-photo'" }) };
  }

  // ---------- NEEDS PHOTO (identity verified, waiting on a face photo) ----------
  if (type === "needs-photo") {
    const npSubject = "One quick step to finish verifying you";
    const dash = "https://www.renters.com/account/home";
    const npText = "Hi " + name + ",\n\n"
      + "Good news: your identity checked out. To finish getting your verified badge, we just need a clear photo of your face on your profile.\n\n"
      + "Right now your profile does not have a photo we can match to your ID, so we are holding your verification until you add one.\n\n"
      + "Please add a profile photo that is:\n"
      + "- A clear, front-facing photo of your face, like an ID photo. Just you, no logos, group photos, hats, or sunglasses.\n"
      + "- Recent and clearly showing you.\n\n"
      + "Add your photo from your dashboard (My Profile > Profile Photo): " + dash + "\n\n"
      + "Once it is added, we will finish verifying you. You do NOT need to redo the identity check.\n\n"
      + "Questions? Just reply to this email.\n\n"
      + "Renters.com. Finding a home should feel safe.";

    const npHtml = "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
      + "<body style='margin:0;padding:0;background:#eef2f5;font-family:Open Sans,Arial,sans-serif;'>"
      + "<div style='max-width:560px;margin:0 auto;padding:24px 16px;'>"
      + "<div style='background:#0d2d4e;border-radius:14px 14px 0 0;padding:26px 30px;text-align:center;'>"
      + "<div style='font-size:22px;font-weight:800;color:#ffffff;'>RENTERS<span style='color:#8dc63f;'>.</span></div></div>"
      + "<div style='background:#ffffff;padding:32px 30px;border-radius:0 0 14px 14px;'>"
      + "<h1 style='font-size:22px;font-weight:800;color:#0d2d4e;margin:0 0 12px;'>One quick step to finish</h1>"
      + "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 16px;'>Hi " + name + ", good news: your identity checked out. To finish getting your verified badge, we just need a clear photo of your face on your profile.</p>"
      + "<p style='font-size:14px;color:#4a5a6a;line-height:1.6;margin:0 0 16px;'>Right now your profile does not have a photo we can match to your ID, so we are holding your verification until you add one.</p>"
      + "<div style='background:#f4f6f7;border-radius:10px;padding:16px 18px;margin-bottom:18px;'>"
      + "<p style='font-size:13px;font-weight:700;color:#0d2d4e;margin:0 0 8px;'>Please add a profile photo that is:</p>"
      + "<p style='font-size:14px;color:#4a5a6a;line-height:1.6;margin:0 0 6px;'>&#9679; A clear, front-facing photo of your face, like an ID photo. Just you, no logos, group photos, hats, or sunglasses.</p>"
      + "<p style='font-size:14px;color:#4a5a6a;line-height:1.6;margin:0;'>&#9679; Recent and clearly showing you.</p></div>"
      + "<div style='text-align:center;margin-bottom:16px;'>"
      + "<a href='" + dash + "' style='display:inline-block;background:#8dc63f;color:#0d2d4e;text-decoration:none;border-radius:10px;padding:13px 30px;font-size:15px;font-weight:700;'>Add your photo &rarr;</a></div>"
      + "<p style='font-size:13px;color:#4a5a6a;line-height:1.6;text-align:center;margin:0 0 6px;'>Add it from My Profile &gt; Profile Photo. Once it is added, we will finish verifying you.</p>"
      + "<p style='font-size:13px;color:#1e8449;font-weight:700;line-height:1.6;text-align:center;margin:0;'>You do not need to redo the identity check.</p>"
      + "</div>"
      + "<p style='font-size:12px;color:#9aa7b3;text-align:center;margin:18px 0 0;'>Renters.com. Finding a home should feel safe.</p>"
      + "</div></body></html>";

    const npCommand = new SendEmailCommand({
      Source: "verify@renters.com",
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: { Data: npSubject, Charset: "UTF-8" },
        Body: { Text: { Data: npText, Charset: "UTF-8" }, Html: { Data: npHtml, Charset: "UTF-8" } },
      },
    });
    try {
      await ses.send(npCommand);
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, type: "needs-photo", email }) };
    } catch (err) {
      console.error("SES error:", err);
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Failed to send email", details: err.message }) };
    }
  }

  // ---------- DENIED (identity could not be confirmed against the profile) ----------
  if (type === "denied") {
    const denySubject = "About your Renters.com verification";
    const reverify = "https://www.renters.com/account/promote/verify";
    const denyText = "Hi " + name + ",\n\n"
      + "Thanks for verifying your identity. We could not yet confirm that it matches your Renters.com profile, so your account is not verified.\n\n"
      + "Here is how verification works: we check that the photo on your profile is a clear photo of you that matches the ID and selfie from your verification.\n\n"
      + "To get verified, please make sure:\n"
      + "- Your profile photo is a clear, front-facing photo of your face, like an ID photo. Just you, no logos, group photos, hats, or sunglasses.\n"
      + "- The photo is recent and clearly shows you.\n\n"
      + "Then re-verify here: " + reverify + "\n\n"
      + "If you have questions, just reply to this email.\n\n"
      + "Renters.com. Finding a home should feel safe.";

    const denyHtml = "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
      + "<body style='margin:0;padding:0;background:#eef2f5;font-family:Open Sans,Arial,sans-serif;'>"
      + "<div style='max-width:560px;margin:0 auto;padding:24px 16px;'>"
      + "<div style='background:#0d2d4e;border-radius:14px 14px 0 0;padding:26px 30px;text-align:center;'>"
      + "<div style='font-size:22px;font-weight:800;color:#ffffff;'>RENTERS<span style='color:#8dc63f;'>.</span></div></div>"
      + "<div style='background:#ffffff;padding:32px 30px;border-radius:0 0 14px 14px;'>"
      + "<h1 style='font-size:22px;font-weight:800;color:#0d2d4e;margin:0 0 12px;'>Let\u2019s finish verifying you</h1>"
      + "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 16px;'>Hi " + name + ", thanks for verifying your identity. We could not yet confirm it matches your Renters.com profile, so your account is not verified.</p>"
      + "<div style='background:#f4f6f7;border-radius:10px;padding:16px 18px;margin-bottom:18px;'>"
      + "<p style='font-size:13px;font-weight:700;color:#0d2d4e;margin:0 0 8px;'>To get verified, make sure:</p>"
      + "<p style='font-size:14px;color:#4a5a6a;line-height:1.6;margin:0 0 6px;'>&#9679; Your profile photo is a clear, front-facing photo of your face, like an ID photo. Just you, no logos, group photos, hats, or sunglasses.</p>"
      + "<p style='font-size:14px;color:#4a5a6a;line-height:1.6;margin:0;'>&#9679; The photo is recent and clearly shows you.</p></div>"
      + "<div style='text-align:center;margin-bottom:18px;'>"
      + "<a href='" + reverify + "' style='display:inline-block;background:#8dc63f;color:#0d2d4e;text-decoration:none;border-radius:10px;padding:13px 30px;font-size:15px;font-weight:700;'>Re-verify now &rarr;</a></div>"
      + "<p style='font-size:13px;color:#8a97a3;line-height:1.6;text-align:center;margin:0;'>Questions? Just reply to this email and we\u2019ll help.</p>"
      + "</div>"
      + "<p style='font-size:12px;color:#9aa7b3;text-align:center;margin:18px 0 0;'>Renters.com. Finding a home should feel safe.</p>"
      + "</div></body></html>";

    const denyCommand = new SendEmailCommand({
      Source: "verify@renters.com",
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: { Data: denySubject, Charset: "UTF-8" },
        Body: {
          Text: { Data: denyText, Charset: "UTF-8" },
          Html: { Data: denyHtml, Charset: "UTF-8" },
        },
      },
    });
    try {
      await ses.send(denyCommand);
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, type: "denied", email }) };
    } catch (err) {
      console.error("SES error:", err);
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Failed to send email", details: err.message }) };
    }
  }

  const supply = isSupplySide(accountType);
  const subject = "You\u2019re now verified on Renters.com \u2713";
  let bodyText, bodyHtml;

  if (supply) {
    // ---------- LANDLORD / REALTOR / PM ----------
    const items = [
      "<strong style='color:#0d2d4e;'>Complete your profile to 100%.</strong> A full profile earns renters\u2019 trust.",
      "<strong style='color:#0d2d4e;'>Add comprehensive listings.</strong> Include inside and outside photos, plus any shared spaces, so renters know exactly what they are getting.",
      "<strong style='color:#0d2d4e;'>Opt in or out of our <a href='" + LANDLORD_SERVICE + "' style='color:#3a9e8f;'>paid service</a>.</strong> We deliver verified renters, and you only pay when someone moves in.",
    ];
    const tools =
      toolCard("Ask Lisa", "Your AI guide for landlord questions, listing tips, and how Renters.com works. Find her at renters.com/lisa or as the chat at the bottom of any page.")
      + toolCard("Safety Check", "Run your own listing through it to catch wording that could read as a red flag, so your legit listing builds trust instead of raising doubts.")
      + toolCard("Showing Scheduler", "Share your availability right in your dashboard, and let verified renters book showings with you. No back-and-forth.");

    bodyHtml = shell(name, "your identity is confirmed and your account is now verified on Renters.com.", items, tools);

    bodyText = "Hi " + name + ",\n\n"
      + "You\u2019re verified on Renters.com. Your dashboard shows \"Identity Confirmed,\" and your verified badge appears on your public profile.\n\n"
      + "FINISH SETTING UP:\n"
      + "- Complete your profile to 100%.\n"
      + "- Add comprehensive listings: inside and outside photos, plus any shared spaces.\n"
      + "- Opt in or out of our paid service (you only pay when a renter we send moves in).\n"
      + "Go to your dashboard: " + DASH + "\n\n"
      + "YOUR TOOLKIT:\n"
      + "- Ask Lisa: your AI guide for landlord questions and listing tips. " + LISA + "\n"
      + "- Safety Check: run your own listing through it to catch red-flag wording. " + SAFETY + "\n"
      + "- Showing Scheduler: share your availability in your dashboard so renters can book showings.\n\n"
      + "Renters.com. Finding a home should feel safe.";

  } else {
    // ---------- RENTER ----------
    const items = [
      "<strong style='color:#0d2d4e;'>Complete your profile to 100%.</strong> A full profile with a photo gets you found and taken seriously by landlords.",
      "<strong style='color:#0d2d4e;'>Opt in or out of our <a href='" + RENTER_SERVICE + "' style='color:#3a9e8f;'>concierge service</a>.</strong> Let us line up showings for you, or search on your own.",
      "<strong style='color:#0d2d4e;'>Verify your income</strong> for the monthly rent you are targeting, so landlords know you qualify.",
      "<strong style='color:#0d2d4e;'>Choose who can view your public profile.</strong> You control your visibility.",
    ];
    const tools =
      toolCard("Ask Lisa", "Your AI renting guide for neighborhoods, budgets, local rules, leases, and how Renters.com works. Find her at renters.com/lisa or as the chat at the bottom of any page.")
      + toolCard("Safety Check", "Paste any listing or landlord message and we\u2019ll flag common rental-scam warning signs before you engage.")
      + toolCard("Showing Scheduler", "Share when you\u2019re available right in your dashboard, and let landlords book showings with you. No back-and-forth.");

    bodyHtml = shell(name, "your identity is confirmed and your account is now verified on Renters.com.", items, tools);

    bodyText = "Hi " + name + ",\n\n"
      + "You\u2019re verified on Renters.com. Your dashboard shows \"Identity Confirmed,\" and your verified badge appears on your public profile.\n\n"
      + "FINISH SETTING UP:\n"
      + "- Complete your profile to 100% (a photo gets you found).\n"
      + "- Opt in or out of our concierge service.\n"
      + "- Verify your income for the rent you are targeting.\n"
      + "- Choose who can view your public profile.\n"
      + "Go to your dashboard: " + DASH + "\n\n"
      + "YOUR TOOLKIT:\n"
      + "- Ask Lisa: your AI renting guide. " + LISA + "\n"
      + "- Safety Check: paste any listing to spot rental scams. " + SAFETY + "\n"
      + "- Showing Scheduler: share your availability in your dashboard so landlords can book showings.\n\n"
      + "Renters.com. Finding a home should feel safe.";
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
