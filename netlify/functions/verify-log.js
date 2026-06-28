// ============================================================
//  verify-log.js   ·   Stage 1 — Verification history log
//  Persistent source of truth for verification events, stored
//  in Netlify Blobs. BD remains the member system; this log
//  holds the WORKFLOW history (who submitted, when, decision,
//  who acted) that BD doesn't keep — enabling a complete,
//  sortable verification CRM.
//
//  Requires "@netlify/blobs" in package.json.
//
//  Actions (POST JSON { action, ... }, or GET ?action=list):
//   - record : upsert a submission into the log (by memberId)
//   - update : set status/decision on an existing entry
//   - list   : return all log entries (for the panel)
//   - get    : return one entry by memberId
//
//  Auth: simple shared key (?key= or body.key) — same pattern
//  as the other internal tools.
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

// One blob key per member, prefixed, so list() can scan them.
function memberKey(memberId) {
  return `member:${String(memberId).trim()}`;
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };

  // Parse input from query or JSON body
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
    // Prefer automatic config; fall back to explicit siteID/token env vars
    // (needed when Netlify doesn't auto-inject the Blobs context).
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
    // ---- LIST: return every log entry (for the panel) ----
    if (action === "list") {
      const out = [];
      const listing = await store.list({ prefix: "member:" });
      for (const blob of listing.blobs) {
        const val = await store.get(blob.key, { type: "json" });
        if (val) out.push(val);
      }
      // newest submissions first by default
      out.sort((a, b) => String(b.submitted || "").localeCompare(String(a.submitted || "")));
      return ok({ count: out.length, entries: out });
    }

    // ---- GET: one entry ----
    if (action === "get") {
      const memberId = body.memberId || q.memberId;
      if (!memberId) return bad(400, "memberId required");
      const val = await store.get(memberKey(memberId), { type: "json" });
      return ok({ entry: val || null });
    }

    // ---- RECORD: upsert a submission (idempotent by memberId) ----
    if (action === "record") {
      const memberId = body.memberId;
      if (!memberId) return bad(400, "memberId required");
      const k = memberKey(memberId);
      const existing = await store.get(k, { type: "json" });

      if (existing) {
        // Already logged — update intake fields but DO NOT clobber a decision.
        // Track resubmissions for duplicate awareness.
        existing.lastSeen = new Date().toISOString();
        existing.submitCount = (existing.submitCount || 1) + (body.countResubmit ? 1 : 0);
        // Refresh contact/intake details if newer ones were parsed
        ["name", "email", "phone", "location", "accountType", "inquiryId", "photoPath", "submitted"].forEach((f) => {
          if (body[f]) existing[f] = body[f];
        });
        await store.setJSON(k, existing);
        return ok({ upserted: false, duplicate: true, entry: existing });
      }

      const entry = {
        memberId: String(memberId),
        name: body.name || "",
        email: body.email || "",
        phone: body.phone || "",
        location: body.location || "",
        accountType: body.accountType || "Unknown",
        inquiryId: body.inquiryId || "",
        photoPath: body.photoPath || "",
        submitted: body.submitted || new Date().toISOString(),
        status: "pending",
        decidedAt: "",
        decidedBy: "",
        submitCount: 1,
        firstLogged: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      };
      await store.setJSON(k, entry);
      return ok({ upserted: true, duplicate: false, entry });
    }

    // ---- UPDATE: set a decision (approved/denied/notice-sent) ----
    if (action === "update") {
      const memberId = body.memberId;
      if (!memberId) return bad(400, "memberId required");
      const k = memberKey(memberId);
      const existing = await store.get(k, { type: "json" });
      if (!existing) return bad(404, "no log entry for member " + memberId);

      if (body.status) existing.status = body.status; // approved | denied | notice-sent | pending
      existing.decidedAt = body.decidedAt || new Date().toISOString();
      existing.decidedBy = body.decidedBy || "admin";
      await store.setJSON(k, existing);
      return ok({ updated: true, entry: existing });
    }

    return bad(400, "unknown action: " + action);
  } catch (e) {
    return bad(500, "log error: " + e.message);
  }
};
