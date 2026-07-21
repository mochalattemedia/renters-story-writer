// ==================================================================
// click.js  —  clk-v1
// Listing click tracker. Signed redirect in, counted, forwarded out.
//
// WHY SIGNED: the destination travels in the URL so this works on ANY
// listing (ours, landlord-submitted external, partner feed) with no
// lookup table. That would be an open redirect, which is a real abuse
// vector (phishing links wearing a renters.com domain), so every link
// carries an HMAC over the exact target. No signature, no redirect.
//
// WHY IT MATTERS: this is the number the partner conversation needs.
// "Verified renters clicked your listings N times last month" is the
// only claim that turns a per-click rate into a better per-click rate.
//
// Endpoints:
//   GET ?version=1
//   GET ?build=1&key=ADMIN&l=ID&u=URL[&m=MEMBER][&v=1][&src=SOURCE]
//        -> returns a signed tracking URL. Alert emails call this.
//   GET ?stats=1&key=ADMIN[&l=ID][&days=30]
//        -> per-listing totals, ranked. This is the report.
//   GET ?l=ID&u=B64&s=SIG[&m=MEMBER][&v=1][&src=SOURCE]
//        -> logs, then 302 to the decoded target. The public path.
//
// Env:
//   CLICK_SIGNING_SECRET   required. Any long random string.
//   ADMIN_PROBE_KEY        gates build + stats (same key mz-v4 uses).
//   NETLIFY_SITE_ID        required for Blobs.
//   NETLIFY_BLOBS_TOKEN    required for Blobs.
//
// BLOBS NOTE: getStore() does NOT throw on creation, only on read/write.
// siteID and token are passed explicitly upfront, per the pattern that
// cost this project a session to learn.
// ==================================================================

const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");

const FN_VERSION = "clk-v1";
const STORE_NAME = "listing-clicks";

const corsHeaders = {
  "content-type": "application/json",
  "access-control-allow-origin": "*"
};

function json(status, obj) {
  return { statusCode: status, headers: corsHeaders, body: JSON.stringify(obj, null, 2) };
}

// ---- base64url, because a raw URL in a query string will not survive ----
function b64uEncode(s) {
  return Buffer.from(s, "utf8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64uDecode(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf8");
}

// ---- HMAC over the exact target. Truncated to 16 chars: short enough to
//      keep email links tidy, long enough that guessing is not happening. ----
function sign(target) {
  return crypto
    .createHmac("sha256", process.env.CLICK_SIGNING_SECRET || "")
    .update(String(target))
    .digest("hex")
    .slice(0, 16);
}

function safeEqual(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

function store() {
  return getStore({
    name: STORE_NAME,
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN
  });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function adminOk(q) {
  const k = process.env.ADMIN_PROBE_KEY || "";
  return !!k && String(q.key || "") === k;
}

// ------------------------------------------------------------------
// Recording. Two writes, both small, both tolerant of failure: a click
// that fails to log must STILL redirect. Losing a data point is a
// rounding error; losing the renter is not.
// ------------------------------------------------------------------
async function record(listingId, memberId, verified, src) {
  const s = store();
  const key = "agg:" + listingId;

  let agg = null;
  try {
    agg = await s.get(key, { type: "json" });
  } catch (e) {
    agg = null;
  }

  if (!agg || typeof agg !== "object") {
    agg = {
      listingId: String(listingId),
      clicks: 0,
      verifiedClicks: 0,
      members: {},
      byDay: {},
      src: src || "",
      first: new Date().toISOString(),
      last: null
    };
  }

  agg.clicks += 1;
  if (verified) agg.verifiedClicks += 1;
  if (memberId) agg.members[memberId] = (agg.members[memberId] || 0) + 1;
  const d = today();
  agg.byDay[d] = (agg.byDay[d] || 0) + 1;
  agg.last = new Date().toISOString();
  if (src && !agg.src) agg.src = src;

  // Keep byDay from growing forever. 120 days is plenty for a monthly report.
  const days = Object.keys(agg.byDay).sort();
  if (days.length > 120) {
    for (const old of days.slice(0, days.length - 120)) delete agg.byDay[old];
  }

  await s.setJSON(key, agg);

  // Index of listing ids, so stats does not need a full blob list scan.
  try {
    let idx = await s.get("index", { type: "json" });
    if (!Array.isArray(idx)) idx = [];
    if (idx.indexOf(String(listingId)) === -1) {
      idx.push(String(listingId));
      await s.setJSON("index", idx);
    }
  } catch (e) {
    console.log("[clk] index update skipped: " + e.message);
  }
}

// ------------------------------------------------------------------
exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const base =
    "https://renters-story-writer.netlify.app/.netlify/functions/click";

  // ---- version ----
  if (q.version) {
    return json(200, {
      version: FN_VERSION,
      signingSecretConfigured: !!process.env.CLICK_SIGNING_SECRET,
      adminKeyConfigured: !!process.env.ADMIN_PROBE_KEY,
      blobsSiteIdConfigured: !!process.env.NETLIFY_SITE_ID,
      blobsTokenConfigured: !!process.env.NETLIFY_BLOBS_TOKEN,
      store: STORE_NAME
    });
  }

  // ---- build a signed link. The alert email generator calls this. ----
  if (q.build) {
    if (!adminOk(q)) return json(403, { version: FN_VERSION, error: "bad key" });
    if (!process.env.CLICK_SIGNING_SECRET) {
      return json(500, { version: FN_VERSION, error: "CLICK_SIGNING_SECRET not configured" });
    }
    const target = String(q.u || "");
    const listingId = String(q.l || "").slice(0, 64);
    if (!target || !listingId) {
      return json(400, { version: FN_VERSION, error: "l and u required" });
    }
    if (target.indexOf("https://") !== 0 && target.indexOf("http://") !== 0) {
      return json(400, { version: FN_VERSION, error: "u must be an absolute http(s) url" });
    }
    const enc = b64uEncode(target);
    const sig = sign(target);
    let url = base + "?l=" + encodeURIComponent(listingId) + "&u=" + enc + "&s=" + sig;
    if (q.m) url += "&m=" + encodeURIComponent(String(q.m).replace(/[^0-9]/g, ""));
    if (q.v) url += "&v=1";
    if (q.src) url += "&src=" + encodeURIComponent(String(q.src).slice(0, 24));
    return json(200, { version: FN_VERSION, listingId, target, url });
  }

  // ---- the report ----
  if (q.stats) {
    if (!adminOk(q)) return json(403, { version: FN_VERSION, error: "bad key" });
    const s = store();

    let idx = [];
    try {
      idx = (await s.get("index", { type: "json" })) || [];
    } catch (e) {
      idx = [];
    }
    if (!Array.isArray(idx)) idx = [];

    const days = Math.max(1, Math.min(365, Number(q.days || 30)));
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    const wanted = q.l ? [String(q.l)] : idx;
    const rows = [];
    let totalClicks = 0;
    let totalVerified = 0;

    for (const id of wanted) {
      let agg = null;
      try {
        agg = await s.get("agg:" + id, { type: "json" });
      } catch (e) {
        agg = null;
      }
      if (!agg) continue;

      let windowClicks = 0;
      for (const d of Object.keys(agg.byDay || {})) {
        if (d >= cutoff) windowClicks += agg.byDay[d];
      }

      const uniqueMembers = Object.keys(agg.members || {}).length;
      totalClicks += windowClicks;
      totalVerified += agg.verifiedClicks || 0;

      rows.push({
        listingId: agg.listingId,
        src: agg.src || "",
        clicksInWindow: windowClicks,
        clicksAllTime: agg.clicks || 0,
        verifiedClicksAllTime: agg.verifiedClicks || 0,
        uniqueMembers: uniqueMembers,
        last: agg.last
      });
    }

    rows.sort((a, b) => b.clicksInWindow - a.clicksInWindow);

    return json(200, {
      version: FN_VERSION,
      windowDays: days,
      since: cutoff,
      listingsTracked: rows.length,
      totalClicksInWindow: totalClicks,
      verifiedClicksAllTime: totalVerified,
      verifiedShareAllTime:
        totalClicks > 0 ? Math.round((totalVerified / Math.max(1, rows.reduce((n, r) => n + r.clicksAllTime, 0))) * 100) + "%" : "0%",
      listings: rows
    });
  }

  // ---- the public path: verify, log, redirect ----
  const listingId = String(q.l || "").slice(0, 64);
  const enc = String(q.u || "");
  const sig = String(q.s || "");

  if (!listingId || !enc || !sig) {
    return json(400, { version: FN_VERSION, error: "missing l, u or s" });
  }

  let target = "";
  try {
    target = b64uDecode(enc);
  } catch (e) {
    return json(400, { version: FN_VERSION, error: "bad target encoding" });
  }

  if (!safeEqual(sig, sign(target))) {
    console.log("[clk] BAD SIGNATURE for listing " + listingId);
    return json(403, { version: FN_VERSION, error: "bad signature" });
  }

  if (target.indexOf("https://") !== 0 && target.indexOf("http://") !== 0) {
    return json(400, { version: FN_VERSION, error: "target not http(s)" });
  }

  const memberId = String(q.m || "").replace(/[^0-9]/g, "");
  const verified = String(q.v || "") === "1";
  const src = String(q.src || "").slice(0, 24);

  try {
    await record(listingId, memberId, verified, src);
  } catch (e) {
    // Never block the renter on our own bookkeeping.
    console.error("[clk] record failed, redirecting anyway: " + e.message);
  }

  return {
    statusCode: 302,
    headers: {
      Location: target,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer"
    },
    body: ""
  };
};
