// ============================================================
//  income-verify.js  ·  Pulls the Plaid Bank Income report for a
//  paid member, scores income vs 2.5x the top of their rent-range band, stamps the
//  BD "prequalified" tag (id 16) directly via /rel_tags/create.
//  Self-contained: clones visibility.js BD auth + rel_tags pattern.
//  Callable two ways (idempotent): from the verify page on Link
//  success, and from plaid-webhook on BANK_INCOME_REFRESH_COMPLETE.
//  POST { memberId, sessionId? }  ->  { ok, prequalified, monthlyIncome }
//
//  Env: PLAID_CLIENT_ID, PLAID_ENV, PLAID_SANDBOX_SECRET, PLAID_PRODUCT_SECRET,
//       BD_API_KEY, BD_API_BASE (default https://www.renters.com/api/v2),
//       SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY, SES_REGION (default us-east-2)
//  Deps (package.json): plaid, @netlify/blobs, @aws-sdk/client-ses

// Safe Blobs store: use Netlify's auto context, fall back to explicit siteID/token.
function rdcStore(name) {
  try { return getStore(name); }
  catch (e) {
    return getStore({
      name: name,
      siteID: process.env.NETLIFY_SITE_ID || process.env.SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_AUTH_TOKEN
    });
  }
}
// ============================================================

const { Configuration, PlaidApi, PlaidEnvironments } = require("plaid");
const { getStore } = require("@netlify/blobs");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const https = require("https");
const { URL } = require("url");

// ---- config ----
const PREQUALIFIED_TAG_ID = "16";
const PREQUALIFIED_TAG_TYPE_ID = "1"; // Custom Tags group
const PREQUALIFIED_TAG_NAME = "prequalified";
const RENT_MULTIPLE = 2.5; // income must be >= 2.5x the TOP of their rent-range band

const ALLOWED_ORIGIN = "https://www.renters.com";
const NOTIFY_TO = "kenny@renters.com";
const NOTIFY_FROM = "verify@renters.com";
const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";
const VERIFY_MEMBER_URL = "https://renters-story-writer.netlify.app/.netlify/functions/verify-member";
const VERIFY_MEMBER_KEY = "renters2026";

const ses = new SESClient({
  region: process.env.SES_REGION || "us-east-2",
  credentials: {
    accessKeyId: process.env.SES_ACCESS_KEY_ID,
    secretAccessKey: process.env.SES_SECRET_ACCESS_KEY,
  },
});

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function plaidClient() {
  const env = process.env.PLAID_ENV === "production" ? "production" : "sandbox";
  const secret = env === "production"
    ? process.env.PLAID_PRODUCT_SECRET
    : process.env.PLAID_SANDBOX_SECRET;
  return new PlaidApi(new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
        "PLAID-SECRET": secret,
      },
    },
  }));
}

async function notify(subject, bodyText) {
  try {
    await ses.send(new SendEmailCommand({
      Source: NOTIFY_FROM,
      Destination: { ToAddresses: [NOTIFY_TO] },
      Message: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: { Text: { Data: bodyText, Charset: "UTF-8" } },
      },
    }));
  } catch (e) { console.log("notify email error: " + e.message); }
}

// --- Call the BD API with Node https (cloned from visibility.js) ---
function bd(path, { method = "GET", body = null } = {}) {
  return new Promise((resolve) => {
    const urlStr = `${BD_BASE}${path}`;
    let payload = null;
    const headers = { "X-Api-Key": process.env.BD_API_KEY, "Accept": "application/json" };
    if (body) {
      payload = new URLSearchParams(body).toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    let u;
    try { u = new URL(urlStr); } catch (e) {
      return resolve({ ok: false, status: 0, data: null, error: "bad url" });
    }
    const options = { hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, headers };
    const req = https.request(options, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve({ ok: false, status: res.statusCode, data: null, error: "redirected (auth not accepted)" });
      }
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch (e) {}
        if (res.statusCode < 200 || res.statusCode >= 300) {
          console.log(`BD ${method} ${path} -> HTTP ${res.statusCode}; body: ${raw.slice(0, 300)}`);
        }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data });
      });
    });
    req.on("error", (e) => resolve({ ok: false, status: 0, data: null, error: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, status: 0, data: null, error: "timeout" }); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function getRelationships(userId) {
  const { ok, data } = await bd(`/rel_tags/get?object_id=${encodeURIComponent(userId)}`);
  if (ok && data && Array.isArray(data.message)) return data.message;
  return [];
}

// Idempotent: skip if tag 16 is already attached, else attach it.
async function addPrequalifiedTag(userId) {
  try {
    const rels = await getRelationships(userId);
    const already = rels.some((r) => r && String(r.tag_id) === PREQUALIFIED_TAG_ID);
    if (already) return { ok: true, already: true };
  } catch (e) { /* proceed to add */ }

  const res = await bd(`/rel_tags/create`, {
    method: "POST",
    body: {
      tag_id: PREQUALIFIED_TAG_ID,
      object_id: String(userId),
      tag_type_id: PREQUALIFIED_TAG_TYPE_ID,
      added_by: String(userId),
    },
  });
  const ok = res.ok && res.data && res.data.status === "success";
  return { ok: !!ok, already: false, status: res.status };
}

function toNum(x) {
  if (typeof x === "number") return x;
  if (x && typeof x.amount === "number") return x.amount;
  const n = Number(x);
  return isNaN(n) ? 0 : n;
}

// Sum verified monthly income across sources, normalized to a month by the
// report window. Defensive across Plaid bank-income field shapes; the raw
// summary is logged so we can lock the exact field on the first sandbox pull.
function monthlyFromBankIncome(report) {
  try {
    if (!report) return 0;
    let monthly = 0;
    const items = report.items || [];
    items.forEach((item) => {
      const sources = item.bank_income_sources || [];
      sources.forEach((src) => {
        const total = toNum(src.total_amount != null ? src.total_amount : src.total_amounts);
        const start = src.start_date ? new Date(src.start_date) : null;
        const end = src.end_date ? new Date(src.end_date) : null;
        let months = 0;
        if (start && end && end > start) months = (end - start) / (1000 * 60 * 60 * 24 * 30.44);
        monthly += months >= 0.5 ? total / months : total;
      });
    });
    if (!monthly) {
      const sum = report.bank_income_summary || {};
      const total = toNum(sum.total_amount != null ? sum.total_amount : sum.total_amounts);
      const start = sum.start_date ? new Date(sum.start_date) : null;
      const end = sum.end_date ? new Date(sum.end_date) : null;
      let months = 0;
      if (start && end && end > start) months = (end - start) / (1000 * 60 * 60 * 24 * 30.44);
      monthly = months >= 0.5 ? total / months : total;
    }
    return Math.round(monthly);
  } catch (e) { return 0; }
}


// Read the renter's rent-range CEILING (top of their Monthly rent budget band)
// via verify-member. monthly_budget stores e.g. "10002000" = $1000-$2000, so the
// last 4 digits are the ceiling we screen against.
async function readRentCeiling(memberId) {
  try {
    const url = VERIFY_MEMBER_URL + "?memberId=" + encodeURIComponent(memberId) + "&key=" + VERIFY_MEMBER_KEY;
    const res = await fetch(url);
    const data = await res.json();
    if (!data || data.found === false) return { ceiling: 0, band: "" };
    const band = (data.rentalInfo && data.rentalInfo.budget) || "";
    // Pull the raw band from the formatted string digits, or re-derive the ceiling.
    var digits = String(band).replace(/[^0-9]/g, "");
    var ceiling = 0;
    if (digits.length >= 8) ceiling = parseInt(digits.slice(4, 8), 10);
    else if (digits.length >= 4) ceiling = parseInt(digits.slice(-4), 10);
    else if (digits.length > 0) ceiling = parseInt(digits, 10);
    return { ceiling: ceiling || 0, band: band };
  } catch (e) { return { ceiling: 0, band: "" }; }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { memberId } = JSON.parse(event.body || "{}");
    if (!memberId) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "memberId required" }) };

    // ---- Look up the Plaid user for this member ----
    const users = rdcStore("plaid-users");
    let userRec = null;
    try { userRec = await users.get(String(memberId), { type: "json" }); } catch (e) {}
    if (!userRec || !userRec.user_token) {
      return { statusCode: 404, headers: cors, body: JSON.stringify({ error: "no_plaid_user" }) };
    }

    // ---- Pull the Bank Income report ----
    const plaid = plaidClient();
    let report;
    try {
      const res = await plaid.creditBankIncomeGet({ user_token: userRec.user_token });
      const bi = res.data && res.data.bank_income;
      report = Array.isArray(bi) ? bi[0] : (bi || res.data);
      console.log("bank_income summary: " + JSON.stringify((report && report.bank_income_summary) || {}));
    } catch (e) {
      const msg = (e.response && e.response.data) ? JSON.stringify(e.response.data) : e.message;
      console.log("bank_income not ready: " + msg);
      return { statusCode: 202, headers: cors, body: JSON.stringify({ ok: true, pending: true }) };
    }

    const monthlyIncome = monthlyFromBankIncome(report);

    // ---- Renter's target rent = TOP of their Monthly rent budget band ----
    const status = rdcStore("prequalify-status");
    let rec = null;
    try { rec = await status.get(String(memberId), { type: "json" }); } catch (e) {}
    const rentInfo = await readRentCeiling(memberId);
    const targetRent = Number(rentInfo.ceiling || (rec && rec.targetRent) || 0);

    // ---- Score income-to-rent ----
    let prequalified = false;
    let scoreNote;
    if (targetRent > 0) {
      prequalified = monthlyIncome >= RENT_MULTIPLE * targetRent;
      scoreNote = "$" + monthlyIncome + "/mo vs $" + targetRent + " rent ceiling" + (rentInfo.band ? " (band " + rentInfo.band + ")" : "") + " — need " + RENT_MULTIPLE + "x = $" + (RENT_MULTIPLE * targetRent) + "";
    } else {
      scoreNote = "$" + monthlyIncome + "/mo verified; no target rent on file — review";
    }

    // ---- Persist the result ----
    const merged = Object.assign({}, rec || { memberId: String(memberId) }, {
      stage: "income-verified",
      monthlyIncome: monthlyIncome,
      targetRent: targetRent || null,
      prequalified: prequalified,
      verifiedAt: new Date().toISOString(),
    });
    try { await status.set(String(memberId), JSON.stringify(merged)); } catch (e) {}

    // ---- On pass, stamp the tag ----
    let tagResult = { ok: false };
    if (prequalified) {
      try { tagResult = await addPrequalifiedTag(memberId); } catch (e) { console.log("tag write error: " + e.message); }
    }

    // ---- Notify Kenny ----
    const subj = prequalified
      ? "✅ Prequalified — Member #" + memberId
      : "📄 Income verified (review) — Member #" + memberId;
    await notify(subj,
      "Income verification result on Renters.com\n\n" +
      "Member ID:      " + memberId + "\n" +
      "Monthly income: $" + monthlyIncome + "\n" +
      "Target rent:    " + (targetRent ? "$" + targetRent : "(none on file)") + "\n" +
      "Result:         " + (prequalified ? "PREQUALIFIED (tag " + (tagResult.already ? "already on" : (tagResult.ok ? "stamped" : "FAILED to stamp")) + ")" : "held for review") + "\n" +
      "Detail:         " + scoreNote + "\n\n" +
      "BD admin: https://ww2.managemydirectory.com/admin/viewMembers.php?faction=view&userid=" + memberId + "&newsite=38748\n\n" +
      "Automated notification from income-verify."
    );

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ ok: true, prequalified, monthlyIncome, tag: tagResult }),
    };
  } catch (err) {
    const msg = (err.response && err.response.data) ? JSON.stringify(err.response.data) : err.message;
    console.log("income-verify error: " + msg);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: msg }) };
  }
};
