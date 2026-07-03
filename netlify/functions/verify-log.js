// ============================================================
//  verify-log.js   ·   Stage 2 — Submission HISTORY log
//  Persistent source of truth for identity-confirmation events,
//  stored in Netlify Blobs. BD remains the member system; this
//  log holds the WORKFLOW history BD does not keep.
//
//  Actions (POST JSON { action, ... }, or GET ?action=list):
//   - record : register a submission (by memberId + inquiryId)
//   - update : set decision (status/reasons/note) on a submission
//              (also appends a timestamped event to the submission timeline)
//   - delete : remove ONE submission (by inquiryId) from a member's
//              history — clears a junk/duplicate identity record only;
//              never touches the BD member or other data
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

function normalize(rec) {
  if (!rec) return null;
  if (Array.isArray(rec.history)) return rec;
  var hist = [];
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

function latestStatus(history) {
  if (!history || !history.length) return "pending";
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
    // ---- LIST ----
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

    // ---- GET ----
    if (action === "get") {
      const memberId = body.memberId || q.memberId;
      if (!memberId) return bad(400, "memberId required");
      const val = normalize(await store.get(memberKey(memberId), { type: "json" }));
      return ok({ entry: val || null });
    }

    // ---- RECORD ----
    if (action === "record") {
      const src = Object.keys(body).length ? body : q;
      const memberId = src.memberId;
      const inquiryId = String(src.inquiryId || "");
      if (!memberId) return bad(400, "memberId required");
      const k = memberKey(memberId);
      let rec = normalize(await store.get(k, { type: "json" }));
      const now = new Date().toISOString();

      if (!rec) {
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
            events: [{ action: "recorded", status: "pending", at: now, by: src.decidedBy || "system" }],
          }],
        };
        await store.setJSON(k, rec);
        return ok({ resubmission: false, isNew: true, current: rec.history[0], history: rec.history, entry: rec });
      }

      rec.lastSeen = now;
      ["name", "email", "phone", "location", "accountType"].forEach(function (f) {
        if (src[f]) rec[f] = src[f];
      });

      let sub = null;
      for (let i = 0; i < rec.history.length; i++) {
        if (String(rec.history[i].inquiryId) === inquiryId && inquiryId !== "") { sub = rec.history[i]; break; }
      }

      if (sub) {
        await store.setJSON(k, rec);
        return ok({ resubmission: false, isNew: false, current: sub, history: rec.history, entry: rec });
      }

      const priorDecided = rec.history.filter(function (h) { return h.status && h.status !== "pending"; });
      const newSub = {
        inquiryId: inquiryId,
        submitted: src.submitted || now,
        status: "pending",
        reasons: [],
        note: "",
        decidedAt: "",
        decidedBy: "",
        events: [{ action: "recorded", status: "pending", at: now, by: src.decidedBy || "system" }],
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

    // ---- UPDATE ----
    if (action === "update") {
      const src = Object.keys(body).length ? body : q;
      const memberId = src.memberId;
      const inquiryId = String(src.inquiryId || "");
      if (!memberId) return bad(400, "memberId required");
      const k = memberKey(memberId);
      let rec = normalize(await store.get(k, { type: "json" }));
      if (!rec) return bad(404, "no log entry for member " + memberId);

      let sub = null;
      if (inquiryId) {
        for (let i = 0; i < rec.history.length; i++) {
          if (String(rec.history[i].inquiryId) === inquiryId) { sub = rec.history[i]; break; }
        }
      }
      if (!sub && rec.history.length) sub = rec.history[rec.history.length - 1];
      if (!sub) return bad(404, "no submission found to update");

      if (src.status) sub.status = src.status; // approved | denied | revoked | identity-confirmed | pending
      if (Array.isArray(src.reasons)) sub.reasons = src.reasons;
      if (typeof src.note === "string") sub.note = src.note;
      const nowU = src.decidedAt || new Date().toISOString();
      sub.decidedAt = nowU;
      sub.decidedBy = src.decidedBy || "admin";
      rec.lastSeen = nowU;

      if (!Array.isArray(sub.events)) sub.events = [];
      sub.events.push({
        action: src.status || "updated",
        status: src.status || sub.status || "",
        note: (typeof src.note === "string" ? src.note : ""),
        at: nowU,
        by: src.decidedBy || "admin",
      });

      await store.setJSON(k, rec);
      return ok({ updated: true, current: sub, history: rec.history, entry: rec });
    }

    // ---- DELETE: remove ONE submission (by inquiryId) ----
    if (action === "delete") {
      const src = Object.keys(body).length ? body : q;
      const memberId = src.memberId;
      const inquiryId = String(src.inquiryId || "");
      if (!memberId) return bad(400, "memberId required");
      if (!inquiryId) return bad(400, "inquiryId required (delete removes one submission, not the member)");
      const k = memberKey(memberId);
      let rec = normalize(await store.get(k, { type: "json" }));
      if (!rec) return bad(404, "no log entry for member " + memberId);

      const before = rec.history.length;
      rec.history = rec.history.filter(function (h) { return String(h.inquiryId) !== inquiryId; });
      const removed = before - rec.history.length;

      if (removed === 0) return bad(404, "no submission with that inquiryId");

      rec.lastSeen = new Date().toISOString();
      await store.setJSON(k, rec);
      return ok({ deleted: true, removed: removed, history: rec.history, entry: rec });
    }

    return bad(400, "unknown action: " + action);
  } catch (e) {
    return bad(500, "log error: " + e.message);
  }
};
