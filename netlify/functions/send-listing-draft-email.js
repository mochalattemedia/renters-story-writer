// ============================================================
//  send-listing-draft-email.js
//  FN_VERSION: slde-v12  (2026-07-28, application/lease terms + preview scroll)
//
//  v12 CHANGES
//   - NEW CODE application_terms_thin ("Application / lease terms incomplete").
//     Distinct from lease_terms_missing: that one is the DURATION dropdown
//     (month-to-month / six months / a year). This one is the free-text
//     "Application process and lease terms" block, group_desc_2 on the form,
//     which a landlord can leave thin or skip. 20 codes now.
//   - Preview responses get a preview-ONLY script that scrolls the pane to the
//     checklist. The wordmark, heading and intro are identical regardless of
//     what is ticked, so a pane anchored at the top looked frozen. Added at
//     the response, never inside buildEmail, so a real send cannot carry it.
//
//  v11 CHANGES
//   - POST { key, preview:true, reasonCodes:[...], missing:"..." } returns the
//     fully rendered email HTML and subject WITHOUT sending. The moderation
//     bookmarklet renders this live as boxes are ticked, so the preview is the
//     real artifact rather than a second copy of the wording that could drift.
//     Sits after the admin-key gate, before recipient resolution: no BD lookup,
//     and it is structurally incapable of sending.
//
//  v10 CHANGES
//   - EVERY reason now carries TWO labels. `admin` is the short diagnostic
//     phrasing for the moderation checkbox ("Missing kitchen"). html/text stay
//     the landlord-facing sentence for the email ("A photo of the kitchen").
//     v9 rendered the landlord sentence as the checkbox label, which read as
//     an instruction rather than a diagnosis and made the panel long.
//   - photos_rooms SPLIT into photos_rooms / photos_kitchen /
//     photos_bathrooms, restoring the granularity the original bookmarklet
//     had and v9 collapsed. 20 codes now, was 17.
//   - GET ?version=1 returns `admin` alongside `label` so the bookmarklet
//     builds its checkboxes from the short form.
//
//  v9 CHANGES
//   - ONE GENERIC SUBJECT for every reason. v8's subject named photos, which
//     lied whenever the problem was the rent, the description, or the member's
//     own eligibility. NOTE: the Gmail filter that files copies into
//     RENTERS/Listing Drafts matches the OLD subject and MUST be updated, or
//     sends stop being filed. New subject is in SUBJECT below.
//   - REASON CATALOG: pass reasonCodes:["photos_rooms","rent_missing",...] and
//     the wording lives HERE, server-side, so improving copy never means
//     re-packing the bookmarklet. GET ?version=1 returns the full catalog so
//     the bookmarklet can build its checkboxes from it.
//   - TWO VOICES. Reasons are grouped: LISTING problems (fix the listing) and
//     ACCOUNT problems (identity not confirmed, profile incomplete, unusable
//     profile photo). "Update your listing" is the wrong instruction when the
//     real fix is finishing verification, so the account group gets its own
//     section, its own explanation, and its own button.
//   - CONTRADICTION reasons are worded as a possible typo, never an accusation.
//   - BACKWARD COMPATIBLE: v8's reasons:["free text"] and missing:"..." still
//     work exactly as before, so the existing bookmarklet keeps sending.
// ============================================================
const FN_VERSION = "slde-v12";

const crypto = require("crypto");
const https = require("https");

const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";
function bd(path) {
  return new Promise((resolve) => {
    const headers = { "X-Api-Key": process.env.BD_API_KEY, "Accept": "application/json" };
    let u;
    try { u = new URL(BD_BASE + path); }
    catch (e) { return resolve({ ok: false, data: null }); }
    const options = { hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: "GET", headers };
    const req = https.request(options, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        console.log("[slde] BD redirect " + res.statusCode + " -> auth likely not accepted");
        return resolve({ ok: false, data: null });
      }
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        let data = null;
        try { data = JSON.parse(raw); } catch (e) {}
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, data });
      });
    });
    req.on("error", () => resolve({ ok: false, data: null }));
    req.end();
  });
}
async function emailForMember(memberId) {
  const { ok, data } = await bd("/user/get/" + encodeURIComponent(memberId));
  if (!ok || !data || data.status !== "success") return null;
  const arr = Array.isArray(data.message) ? data.message : [data.message];
  const m = arr[0] || null;
  return m && m.email ? String(m.email).trim() : null;
}
async function nameForMember(memberId) {
  const { ok, data } = await bd("/user/get/" + encodeURIComponent(memberId));
  if (!ok || !data || data.status !== "success") return null;
  const arr = Array.isArray(data.message) ? data.message : [data.message];
  const m = arr[0] || null;
  if (!m) return null;
  const fn = (m.first_name || "").trim();
  return fn || (m.full_name || "").trim() || null;
}
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

// ============================================================
//  REASON CATALOG (v9)
//  group: "listing" = fix the listing itself
//         "account" = fix the member's account; the listing may be fine
//  html is TRUSTED markup (never escaped). text is the plain-text twin.
//  Free-text from the operator is escaped separately and is never trusted.
// ============================================================
const REASONS = {
  // ---------- PHOTOS ----------
  photos_rooms: { group: "listing", admin: "Missing rooms (living area, bedrooms)",
    html: "<strong style='color:#0d2d4e;'>Photos of every room inside</strong> &mdash; the living area and each bedroom",
    text: "Photos of every room inside - the living area and each bedroom" },
  photos_kitchen: { group: "listing", admin: "Missing kitchen",
    html: "<strong style='color:#0d2d4e;'>A photo of the kitchen</strong>",
    text: "A photo of the kitchen" },
  photos_bathrooms: { group: "listing", admin: "Missing bathrooms",
    html: "<strong style='color:#0d2d4e;'>A photo of each bathroom</strong>",
    text: "A photo of each bathroom" },
  photos_exterior: { group: "listing", admin: "Missing exterior",
    html: "<strong style='color:#0d2d4e;'>Photos of the outside</strong> &mdash; the front of the property, and any yard or grounds",
    text: "Photos of the outside - the front of the property, and any yard or grounds" },
  photos_shared: { group: "listing", admin: "Missing shared spaces",
    html: "<strong style='color:#0d2d4e;'>Photos of any shared spaces</strong> &mdash; hallways, stairwells, laundry, common areas, and parking",
    text: "Photos of any shared spaces - hallways, stairwells, laundry, common areas, and parking" },
  photos_quality: { group: "listing", admin: "Poor quality (dark, blurry, low-res)",
    html: "<strong style='color:#0d2d4e;'>Clearer photos</strong> &mdash; some are dark, blurry, or too small to make out. Daylight and a steady hand go a long way",
    text: "Clearer photos - some are dark, blurry, or too small to make out. Daylight and a steady hand go a long way" },

  // ---------- LISTING DETAIL ----------
  rent_missing: { group: "listing", admin: "No rent / contact for price",
    html: "<strong style='color:#0d2d4e;'>The monthly rent</strong> &mdash; an exact amount. Renters skip listings that say contact for price",
    text: "The monthly rent - an exact amount. Renters skip listings that say contact for price" },
  availability_missing: { group: "listing", admin: "No availability date",
    html: "<strong style='color:#0d2d4e;'>The availability date</strong> &mdash; when someone could actually move in",
    text: "The availability date - when someone could actually move in" },
  lease_terms_missing: { group: "listing", admin: "No lease terms",
    html: "<strong style='color:#0d2d4e;'>The lease terms</strong> &mdash; month-to-month, six months, a year?",
    text: "The lease terms - month-to-month, six months, a year?" },
  application_terms_thin: { group: "listing", admin: "Application / lease terms incomplete",
    html: "<strong style='color:#0d2d4e;'>Your application process and lease terms</strong> &mdash; how someone applies, what you screen for, and what the lease does and does not cover. Renters who know the process before they ask are far likelier to follow through",
    text: "Your application process and lease terms - how someone applies, what you screen for, and what the lease does and does not cover. Renters who know the process before they ask are far likelier to follow through" },
  description_thin: { group: "listing", admin: "Description too thin",
    html: "<strong style='color:#0d2d4e;'>A real description</strong> &mdash; a few sentences in your own words about the space and the neighborhood",
    text: "A real description - a few sentences in your own words about the space and the neighborhood" },
  beds_baths_sqft: { group: "listing", admin: "Beds / baths / sqft incomplete",
    html: "<strong style='color:#0d2d4e;'>Bedrooms, bathrooms, and square footage</strong> &mdash; these are the first things renters filter on",
    text: "Bedrooms, bathrooms, and square footage - these are the first things renters filter on" },
  pets_parking_utilities: { group: "listing", admin: "Pets / parking / utilities not stated",
    html: "<strong style='color:#0d2d4e;'>Pets, parking, and utilities</strong> &mdash; what is included, and what is allowed",
    text: "Pets, parking, and utilities - what is included, and what is allowed" },
  address_missing: { group: "listing", admin: "Address missing or wrong",
    html: "<strong style='color:#0d2d4e;'>The property address</strong> &mdash; we only show the general area publicly, but we need the real address on file",
    text: "The property address - we only show the general area publicly, but we need the real address on file" },

  // ---------- CONTENT ----------
  // Worded as a possible typo. Never an accusation.
  contradiction: { group: "listing", admin: "Numbers contradict each other",
    html: "<strong style='color:#0d2d4e;'>A couple of details do not line up</strong> &mdash; it may just be a typo, but it is worth a second look before renters see it",
    text: "A couple of details do not line up - it may just be a typo, but it is worth a second look before renters see it" },
  content_offtopic: { group: "listing", admin: "Description off-topic",
    html: "<strong style='color:#0d2d4e;'>A few lines in the description need a trim</strong> &mdash; keeping it to the property itself works best",
    text: "A few lines in the description need a trim - keeping it to the property itself works best" },

  // ---------- ACCOUNT (the listing may be fine; the account is not ready) ----------
  identity_unconfirmed: { group: "account", admin: "Identity not confirmed",
    html: "<strong style='color:#0d2d4e;'>Confirm your identity</strong> &mdash; it takes a few minutes on your phone, and it is what earns the identity shield renters look for",
    text: "Confirm your identity - it takes a few minutes on your phone, and it is what earns the identity shield renters look for" },
  profile_incomplete: { group: "account", admin: "Profile incomplete",
    html: "<strong style='color:#0d2d4e;'>Finish your profile</strong> &mdash; the About Me section, so renters know who they would be renting from",
    text: "Finish your profile - the About Me section, so renters know who they would be renting from" },
  profile_photo_missing: { group: "account", admin: "No profile photo",
    html: "<strong style='color:#0d2d4e;'>Add a profile photo</strong> &mdash; a clear, front-facing photo of your face",
    text: "Add a profile photo - a clear, front-facing photo of your face" },
  profile_photo_unusable: { group: "account", admin: "Profile photo unusable",
    html: "<strong style='color:#0d2d4e;'>Swap your profile photo</strong> &mdash; we need a clear, upright, front-facing photo of your face. A logo, a property photo, or a sideways shot will not do the job",
    text: "Swap your profile photo - we need a clear, upright, front-facing photo of your face. A logo, a property photo, or a sideways shot will not do the job" },
};

const SUBJECT = "Your Renters.com listing needs an update before it goes live";
const ACCOUNT_URL = process.env.ACCOUNT_HOME_URL || "https://www.renters.com/account/home";

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

function buildEmail({ name, listingTitle, listingUrl, missing, reasons, reasonCodes }) {
  const greet = esc(cleanName(name));
  const url = listingUrl || EDIT_URL;

  const titleHtml = " your listing";
  const titleText = " your listing";

  // --- gather reasons -------------------------------------------------
  // Catalog codes carry TRUSTED html. Free text from v8 callers is ESCAPED.
  const listingItems = [];   // {html, text}
  const accountItems = [];

  (Array.isArray(reasonCodes) ? reasonCodes : []).forEach(function (code) {
    const r = REASONS[String(code == null ? "" : code).trim()];
    if (!r) return;
    (r.group === "account" ? accountItems : listingItems).push({ html: r.html, text: r.text });
  });

  // v8 compatibility: free-text reasons + the "anything else" note. Always
  // escaped, always treated as listing problems.
  (Array.isArray(reasons) ? reasons : []).forEach(function (r) {
    r = String(r == null ? "" : r).trim();
    if (r) listingItems.push({ html: esc(r), text: r });
  });
  if (missing && String(missing).trim()) {
    const m = String(missing).trim();
    listingItems.push({ html: esc(m), text: m });
  }

  const hasListing = listingItems.length > 0;
  const hasAccount = accountItems.length > 0;
  const accountOnly = hasAccount && !hasListing;

  function section(title, items) {
    return "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 14px;'>" + title + "</p>"
      + "<table style='border-collapse:collapse;width:100%;margin:0 0 20px;'>"
      + checklistRows(items.map(function (i) { return i.html; })) + "</table>";
  }
  function sectionText(title, items) {
    return title + "\n" + items.map(function (i) { return "- " + i.text; }).join("\n") + "\n";
  }

  var midHtml = "", midText = "";

  if (!hasListing && !hasAccount) {
    // Nothing ticked: fall back to the full photo standard, same as v8.
    midHtml = "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 14px;'>To keep listings trustworthy for renters, every live listing needs clear, well-lit photos of the whole property:</p>"
      + "<table style='border-collapse:collapse;width:100%;margin:0 0 20px;'>" + checklistRows(STANDARD_ITEMS) + "</table>";
    midText = "To keep listings trustworthy for renters, every live listing needs clear, well-lit photos of the whole property:\n"
      + STANDARD_ITEMS_TEXT.map(function (i) { return "- " + i; }).join("\n") + "\n";
  } else {
    if (hasListing) {
      midHtml += section("Here&rsquo;s what the listing still needs:", listingItems);
      midText += sectionText("Here's what the listing still needs:", listingItems);
    }
    if (hasAccount) {
      midHtml += "<div style='background:#eaf4fb;border-left:3px solid #2980b9;border-radius:0 8px 8px 0;padding:14px 16px;margin:0 0 20px;'>"
        + "<p style='font-size:14px;color:#1a5276;line-height:1.6;margin:0 0 10px;'><strong>"
        + (hasListing ? "And two things on your account:" : "This one is about your account, not the listing itself:")
        + "</strong></p>"
        + "<table style='border-collapse:collapse;width:100%;margin:0;'>"
        + checklistRows(accountItems.map(function (i) { return i.html; })) + "</table>"
        + "<p style='font-size:13px;color:#1a5276;line-height:1.6;margin:6px 0 0;'>Every landlord on Renters.com clears this same bar. It is the reason renters trust the listings here.</p>"
        + "</div>";
      midText += "\n" + (hasListing ? "And on your account:" : "This one is about your account, not the listing itself:") + "\n"
        + accountItems.map(function (i) { return "- " + i.text; }).join("\n") + "\n"
        + "Every landlord on Renters.com clears this same bar. It is the reason renters trust the listings here.\n";
    }
  }

  const subject = SUBJECT;

  // When the ONLY problems are account-side, "Edit your listing" is the wrong
  // instruction: the fix is not in the listing form. Point at the dashboard.
  const ctaUrl   = accountOnly ? ACCOUNT_URL : url;
  const ctaLabel = accountOnly ? "Go to your dashboard" : "Edit your listing";
  const closingHtml = accountOnly
    ? "Take care of that and your listing goes live right after. We&rsquo;ll review it as soon as you&rsquo;re done."
    : "Update those and we&rsquo;ll review it again right away. Nothing else for you to do after that.";
  const closingText = accountOnly
    ? "Take care of that and your listing goes live right after. We'll review it as soon as you're done."
    : "Update those and we'll review it again right away. Nothing else for you to do after that.";

  const html = "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
    + "<body style='margin:0;padding:0;background:#eef2f5;font-family:Open Sans,Arial,sans-serif;'>"
    + "<div style='max-width:560px;margin:0 auto;padding:24px 16px;'>"
    + "<div style='background:#0d2d4e;border-radius:14px 14px 0 0;padding:26px 30px;text-align:center;'>"
    + "<div style='font-size:22px;font-weight:800;color:#ffffff;'>RENTERS<span style='color:#8dc63f;'>.</span></div></div>"
    + "<div style='background:#ffffff;padding:32px 30px;border-radius:0 0 14px 14px;'>"
    + "<h1 style='font-size:22px;font-weight:800;color:#0d2d4e;margin:0 0 14px;'>A quick fix to get your listing live</h1>"
    + "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 16px;'>Hi " + greet + ", thanks for listing your place on Renters.com. We review every new listing before it goes live, and" + titleHtml + " needs one or two things first. It&rsquo;s a quick fix, not a rejection.</p>"
    + midHtml
    + "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 22px;'>" + closingHtml + "</p>"
    + "<div style='text-align:center;margin-bottom:24px;'>"
    + "<a href='" + esc(ctaUrl) + "' style='display:inline-block;background:#8dc63f;color:#0d2d4e;text-decoration:none;border-radius:10px;padding:13px 30px;font-size:15px;font-weight:700;'>" + ctaLabel + " &rarr;</a></div>"
    + "<p style='font-size:14px;color:#4a5a6a;line-height:1.6;margin:0;'>&mdash; The Renters.com team</p>"
    + "</div>"
    + "<p style='font-size:12px;color:#9aa7b3;text-align:center;margin:18px 0 0;'>Renters.com. Finding a home should feel safe.</p>"
    + "</div></body></html>";

  const text = "Hi " + cleanName(name) + ",\n\n"
    + "Thanks for listing your place on Renters.com. We review every new listing before it goes live, and" + titleText + " needs one or two things first. It's a quick fix, not a rejection.\n\n"
    + midText + "\n"
    + closingText + "\n\n"
    + ctaLabel + ": " + ctaUrl + "\n\n"
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
        bdKeyConfigured: !!process.env.BD_API_KEY,
        sesKeyConfigured: !!process.env.SES_ACCESS_KEY_ID && !!process.env.SES_SECRET_ACCESS_KEY,
        sender: SENDER,
        bcc: BCC && looksLikeEmail(BCC) ? BCC.trim() : null,
        subject: SUBJECT,
        // v10: `admin` is the SHORT diagnostic label for the moderation
        // checkbox ("Missing kitchen"). `label` is the landlord-facing
        // sentence that goes in the email. The bookmarklet renders `admin`;
        // the email body uses html/text. Two audiences, two registers, one
        // source of truth.
        reasonCodes: Object.keys(REASONS).map(function (k) {
          return { code: k, group: REASONS[k].group, admin: REASONS[k].admin || REASONS[k].text, label: REASONS[k].text };
        }),
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

  // v11: preview short-circuit. Runs the SAME buildEmail as a real send and
  // returns the rendered HTML instead of handing it to SES. The moderation
  // panel renders this, so what you see is what the landlord receives. It sits
  // AFTER the admin-key gate but BEFORE recipient resolution, so it costs no
  // BD lookup and can never send anything.
  if (body.preview) {
    const p = buildEmail({
      name: body.name || "there",
      listingTitle: body.listingTitle,
      listingUrl: body.listingUrl,
      missing: body.missing,
      reasons: body.reasons,
      reasonCodes: body.reasonCodes,
    });
    return {
      statusCode: 200,
      headers: corsHeaders,
      // v12: the wordmark/heading/intro at the top of the email never change,
      // so a preview pane anchored at the top looks frozen while ticking boxes.
      // Inject a preview-ONLY script that scrolls to the first checklist row.
      // Never present in a real send: it is added here, not in buildEmail.
      body: JSON.stringify({ success: true, _v: FN_VERSION, preview: true, subject: p.subject,
        html: p.html.replace("</body>", "<script>try{var t=document.querySelector('table');if(t){t.scrollIntoView({block:'center'});}}catch(e){}<" + "/script></body>") }),
    };
  }

  let email = String(body.email || "").trim();
  let resolvedName = null;
  if (!looksLikeEmail(email)) {
    const mid = String(body.memberId || "").trim();
    if (/^[0-9]+$/.test(mid)) {
      if (!process.env.BD_API_KEY) {
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Member-ID lookup needs BD_API_KEY set on the function" }) };
      }
      try {
        const found = await emailForMember(mid);
        if (found && looksLikeEmail(found)) { email = found; resolvedName = await nameForMember(mid); }
      } catch (e) { /* fall through to the error below */ }
    }
  }
  if (!looksLikeEmail(email)) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Provide a valid email, or a member ID whose account has an email on file", gotMemberId: String(body.memberId || "") }) };
  }

  const { subject, html, text } = buildEmail({
    name: body.name || resolvedName,
    listingTitle: body.listingTitle,
    listingUrl: body.listingUrl,
    missing: body.missing,
    reasons: body.reasons,
    reasonCodes: body.reasonCodes,
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

module.exports._internal = { buildEmail, cleanName, esc, looksLikeEmail, FN_VERSION, REASONS, SUBJECT };
