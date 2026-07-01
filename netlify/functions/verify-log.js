// ============================================================
//  verify-log.js   ·   Stage 2 — Submission HISTORY log
//  Persistent source of truth for identity-confirmation events,
//  stored in Netlify Blobs. BD remains the member system; this
//  log holds the WORKFLOW history BD does not keep.
//
//  v2 CHANGE: each member now stores a HISTORY ARRAY of
//  submissions (keyed by inquiryId) instead of a single status.
//  This enables:
//   - a real timeline (submitted+denied on X, then approved on Y)
//   - true resubmission detection (a NEW inquiryId after a prior
//     decided one) vs. simply re-viewing the same submission
//   - denial REASONS + a free-text note per submission, so we can
//     compare a resubmission against why the last one was denied
//     WITHOUT retaining the sensitive ID image.
//
//  Backward-compatible: legacy single-status entries (no history
//  array) are read as a one-item history so nothing breaks.
//
//  Requires "@netlify/blobs" in package.json.
//
//  Actions (POST JSON { action, ... }, or GET ?action=list):
//   - record : register a submission (by memberId + inquiryId)
//   - update : set decision (status/reasons/note) on a submission
//   - list   : return all member records (for the panel)
//   - get    : return one member record by memberId
//
//  Auth: shared key (?key= or body.key).
// ============================================================

const { getStore } = require("@netlify/blobs");

const KEY = "renters2026";
const STORE_NAME = "verification-log";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

function ok(body) {
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(body) };
}
function bad(code, msg) {
  return { statusCode: code, headers: corsHeaders, body: JSON.stringify({ error: msg }) };
}

function memberKey(memberId) {
  return `member:${String(memberId).trim()}`;
}

// Normalize any stored record (legacy or v2) into a record that
// always has a history array. Legacy entries carried a single
// top-level status/inquiryId; wrap that as one history item.
function normalize(rec) {
  if (!rec) return null;
  if (Array.isArray(rec.history)) return rec;
  var hist = [];
  // Build a single history item from the legacy top-level fields.
  if (rec.inquiryId || rec.status) {
    hist.push({
      inquiryId: rec.inquiryId || "",
      submitted: rec.submitted || rec.firstLogged || "",
      status: rec.status || "pending",
      reasons: [],
      note: "",
      decidedAt: rec.decidedAt || "",
      decidedBy: rec.decidedBy || "",
    });
  }
  rec.history = hist;
  return rec;
}

// Latest decided/known status across the history (for quick display).
function latestStatus(history) {
  if (!history || !history.length) return "pending";
  // The most recent submission (last in array) drives current status.
  return history[history.length - 1].status || "pending";
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };

  const q = event.queryStringParameters || {};
  let body = {};
  if (event.body) {
    try { body = JSON.parse(event.body); } catch (e) { return bad(400, "Invalid JSON body"); }
  }
  const action = body.action || q.action;
  const key = body.key || q.key;

  if (key !== KEY) return bad(403, "bad key");

  let store;
  try {
    if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
      store = getStore({
        name: STORE_NAME,
        siteID: process.env.NETLIFY_SITE_ID,
        token: process.env.NETLIFY_BLOBS_TOKEN,
      });
    } else {
      store = getStore(STORE_NAME);
    }
  } catch (e) {
    return bad(500, "Blobs store unavailable: " + e.message);
  }

  try {
    // ---- LIST: every member record (normalized with history) ----
    if (action === "list") {
      const out = [];
      const listing = await store.list({ prefix: "member:" });
      for (const blob of listing.blobs) {
        const val = await store.get(blob.key, { type: "json" });
        if (val) out.push(normalize(val));
      }
      out.sort((a, b) => String(b.lastSeen || "").localeCompare(String(a.lastSeen || "")));
      return ok({ count: out.length, entries: out });
    }

    // ---- GET: one member record ----
    if (action === "get") {
      const memberId = body.memberId || q.memberId;
      if (!memberId) return bad(400, "memberId required");
      const val = normalize(await store.get(memberKey(memberId), { type: "json" }));
      return ok({ entry: val || null });
    }

    // ---- RECORD: register a submission (by memberId + inquiryId) ----
    if (action === "record") {
      const src = Object.keys(body).length ? body : q;
      const memberId = src.memberId;
      const inquiryId = String(src.inquiryId || "");
      if (!memberId) return bad(400, "memberId required");
      const k = memberKey(memberId);
      let rec = normalize(await store.get(k, { type: "json" }));
      const now = new Date().toISOString();

      if (!rec) {
        // Brand-new member: create record with one pending submission.
        rec = {
          memberId: String(memberId),
          name: src.name || "",
          email: src.email || "",
          phone: src.phone || "",
          location: src.location || "",
          accountType: src.accountType || "Unknown",
          firstLogged: now,
          lastSeen: now,
          history: [{
            inquiryId: inquiryId,
            submitted: src.submitted || now,
            status: "pending",
            reasons: [],
            note: "",
            decidedAt: "",
            decidedBy: "",
          }],
        };
        await store.setJSON(k, rec);
        return ok({ resubmission: false, isNew: true, current: rec.history[0], history: rec.history, entry: rec });
      }

      // Existing member — refresh contact info + lastSeen.
      rec.lastSeen = now;
      ["name", "email", "phone", "location", "accountType"].forEach(function (f) {
        if (src[f]) rec[f] = src[f];
      });

      // Is this inquiryId already in the history?
      let sub = null;
      for (let i = 0; i < rec.history.length; i++) {
        if (String(rec.history[i].inquiryId) === inquiryId && inquiryId !== "") { sub = rec.history[i]; break; }
      }

      if (sub) {
        // SAME submission being re-viewed — NOT a resubmission.
        await store.setJSON(k, rec);
        return ok({ resubmission: false, isNew: false, current: sub, history: rec.history, entry: rec });
      }

      // NEW inquiryId for an existing member = genuine resubmission.
      const priorDecided = rec.history.filter(function (h) { return h.status && h.status !== "pending"; });
      const newSub = {
        inquiryId: inquiryId,
        submitted: src.submitted || now,
        status: "pending",
        reasons: [],
        note: "",
        decidedAt: "",
        decidedBy: "",
      };
      rec.history.push(newSub);
      await store.setJSON(k, rec);
      return ok({
        resubmission: priorDecided.length > 0,
        isNew: false,
        current: newSub,
        history: rec.history,
        entry: rec,
      });
    }

    // ---- UPDATE: set a decision on a specific submission ----
    if (action === "update") {
      const src = Object.keys(body).length ? body : q;
      const memberId = src.memberId;
      const inquiryId = String(src.inquiryId || "");
      if (!memberId) return bad(400, "memberId required");
      const k = memberKey(memberId);
      let rec = normalize(await store.get(k, { type: "json" }));
      if (!rec) return bad(404, "no log entry for member " + memberId);

      // Find the submission to decide: match inquiryId, else newest.
      let sub = null;
      if (inquiryId) {
        for (let i = 0; i < rec.history.length; i++) {
          if (String(rec.history[i].inquiryId) === inquiryId) { sub = rec.history[i]; break; }
        }
      }
      if (!sub && rec.history.length) sub = rec.history[rec.history.length - 1];
      if (!sub) return bad(404, "no submission found to update");

      if (src.status) sub.status = src.status; // approved | denied | pending
      if (Array.isArray(src.reasons)) sub.reasons = src.reasons;
      if (typeof src.note === "string") sub.note = src.note;
      sub.decidedAt = src.decidedAt || new Date().toISOString();
      sub.decidedBy = src.decidedBy || "admin";
      rec.lastSeen = new Date().toISOString();

      await store.setJSON(k, rec);
      return ok({ updated: true, current: sub, history: rec.history, entry: rec });
    }

    return bad(400, "unknown action: " + action);
  } catch (e) {
    return bad(500, "log error: " + e.message);
  }
};
