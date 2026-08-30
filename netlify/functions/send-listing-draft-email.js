// ============================================================
//  send-listing-draft-email.js
//  FN_VERSION: slde-v37  (2026-08-29)
//    slde-v37 INVENTORY WALK. The dashboard showed 23 of 213 listings, because
//             a listing only entered the index when somebody scanned it - so
//             the 190 nobody had looked at were invisible, which is exactly
//             the set most likely to be stale or junk.
//             WALKING IDS IS THE ONLY ROUTE, proven by the v36 probe: BD
//             accepts ?limit and ignores offset, page, start, sort, order and
//             status filters. Every variant returned the same window, ids
//             1..128. Individual fetches above that ceiling work fine.
//               POST { key, walk:true, from, to, cursor }
//             fetches ids in a bounded batch, records what it finds, and
//             returns a cursor to continue from.
//             NO AI, DELIBERATELY. This records what EXISTS - id, name,
//             status, landlord, dates. The photo assessment is the expensive
//             part and it is not needed to answer "what have we got" or "is
//             this still live". Scanning stays a separate, deliberate act.
//             IT MERGES, NEVER OVERWRITES. A listing already scanned keeps its
//             verdict and its notify history; the walk only fills in what was
//             missing. Discovering a listing must never erase what we know
//             about it.
//             BATCHED ON PURPOSE. BD is capped around 100 requests a minute
//             and a 429 is indistinguishable from a missing record unless you
//             check for it - that is how an inventory count once came back as
//             79 when it was 213. Each batch is small, paced, and STOPS on a
//             429 rather than recording a run of false absences.
//             IDS ARE NOT CONTIGUOUS. 213 listings reach id 293+, so deleted
//             records leave gaps. A miss is recorded and skipped, never
//             treated as the end of the walk.
//  FN_VERSION: slde-v36  (2026-08-29)
//    slde-v36 THE v35 PROBE ANSWERED ITS OWN QUESTION WRONG. It reported
//             "paging works" because ?limit raised the default 25 to 100 - but
//             ?offset=100 returned the IDENTICAL window (ids 1..128, same
//             84/16 split) and ?page=2 returned nothing at all. So it is the
//             same ceiling the Bible records for /leads/get: 100 rows, OLDEST
//             first, offset ignored. A pull cannot page past the first
//             hundred, and the newest listings are the ones it can never see.
//             THE TEST WAS TOO WEAK. It compared each variant against the
//             plain call rather than against the one that differed only by the
//             parameter under test, so a real change from ?limit masked the
//             absence of a change from ?offset.
//             v36 probes the three remaining routes: SORT (reverse it and the
//             newest hundred become reachable), FILTER (status or user, so
//             each slice fits under the cap), and WALK-BY-ID (always works,
//             costs ~213 calls against a ~100/minute limit).
//             EVERY VARIANT IS NOW COMPARED AGAINST ITS OWN CONTROL, and the
//             walk probe deliberately fetches only 3 ids: enough to prove the
//             route, not enough to spend the rate limit finding out.
//  FN_VERSION: slde-v35  (2026-08-29)
//    slde-v35 CAN WE EVEN SEE ALL 213 LISTINGS? A diagnostic, no behaviour
//             change. The dashboard renders from the stored index, and a
//             listing only enters that index when someone scans it - so it
//             shows 23 of 213 and the other 190 are invisible.
//             Before designing a full pull, find out what BD will actually
//             return. The Bible records /api/v2/leads/get capped at 100 rows,
//             ignoring ?limit and ?offset, and returning the OLDEST hundred -
//             which can never see a recent record. If groups behave the same
//             way the pull needs a different route entirely, and it is much
//             cheaper to learn that now than after building against it.
//               GET ?diag=listings   (x-admin-key header required)
//             tries several paging shapes and reports, for each: row count,
//             first and last id, and whether the ids differ from the plain
//             call. Ids and status only - it is a shape probe, not a data
//             dump.
//  FN_VERSION: slde-v34  (2026-08-29)
//    slde-v34 "A few suggestions for your listing" -> "Your listing".
//             The heading announced that we had opinions before saying
//             anything useful, which reads as preachy. The subject line had
//             the same shape and is now plain too. Nothing else changed: the
//             body already opens with what needs doing, so the heading was
//             doing no work the first sentence was not.
//  FN_VERSION: slde-v33  (2026-08-29)
//    slde-v33 THE BIO LIVES IN search_description, AND NOW GETS READ.
//             The dump settled what v31 guessed at and got wrong. The landlord
//             form has exactly ONE paragraph field, labelled Short Description,
//             stored as `search_description`. about_me and my_story are legacy
//             columns that no current form writes to - which is why they are
//             empty on a complete profile, and why widening the check to six
//             names in v31 fixed nothing at all. THE DUMP SHOULD HAVE COME
//             FIRST; guessing field names produced two versions of noise.
//             THREE STATES, NOT TWO. Presence was never the real question:
//               empty            -> a gap, as before
//               under 80 chars   -> a SUGGESTION, not a gap. "Three words" is
//                                   technically filled in and tells a renter
//                                   nothing.
//               about the RENTAL -> a suggestion. It is an About Me, not a
//                                   second listing description, and length
//                                   cannot detect this - 200 words about the
//                                   kitchen is still wrong.
//             The subject test is the only part that needs the model, so it
//             runs on the text alone: no images, ~200 tokens, and it is skipped
//             entirely when the bio is empty or already too short to judge.
//             SUGGESTIONS ARE RETURNED SEPARATELY from gaps, so they can go out
//             in the improve voice and never assert a listing is blocked.
//  FN_VERSION: slde-v32  (2026-08-29)
//    slde-v32 A MEMBER DUMP, so profile checks stop being written against
//             guesses. v31 widened the About/bio check to accept six possible
//             field names, which fixed the false positive by brute force
//             without anyone knowing which field BD actually uses. That is a
//             patch, not knowledge, and the next check written blind will
//             break the same way.
//               GET ?diag=member&memberId=NNN   (x-admin-key header required)
//             returns every field on the record that has a value, plus the
//             full key list, so a check can be written against what is really
//             stored.
//             VALUES ARE TRUNCATED to 300 characters. This is a diagnostic
//             read of somebody's personal record - it should show enough to
//             identify a field and no more.
//  FN_VERSION: slde-v31  (2026-08-29)
//    slde-v31 THE ABOUT/BIO CHECK READ ONE FIELD OUT OF TWO.
//             assessProfile() tested about_me alone, so a landlord who wrote
//             their intro into MY STORY had a complete profile and was told to
//             complete it. Head code w143 already recorded this: BD accepts
//             about_me OR my_story as the intro, and three wizards broke by
//             reading only one signal for it.
//             THIS IS THE WORST KIND OF FALSE POSITIVE. Telling someone to fix
//             what they have already done does not just waste their time, it
//             teaches them our notices are not worth reading - and then the
//             true ones get ignored too.
//             Name and phone hardened the same way: BD stores a display name
//             in more than one place, and phone in more than one column, so
//             both now accept any of the fields that can legitimately hold
//             them rather than the single one this happened to be written
//             against.
//  FN_VERSION: slde-v30  (2026-08-28)
//    slde-v30 THE SUGGESTION TONE SAYS WHY IT IS WORTH DOING, AND STOPS
//             REASSURING. v29 opened with "your listing is live and there is
//             nothing you have to do", which comforts someone who was not
//             worried and reads as condescending. Gone.
//             It now names the payoff, which is the only reason a landlord
//             would act: matching pairs on SPECS - budget, timing, type, area,
//             pets - and gets a renter to the listing. What decides whether
//             they pursue it is what they then see. A structurally perfect
//             match with weak photos fails anyway, and it fails INVISIBLY:
//             it shows up as a low conversion rate rather than as a bad match.
//             So the claim is deliberately about matching WELL rather than
//             about the algorithm reading photos, because it does not.
//             Saying "improves your ranking in our algorithm" would be false.
//  FN_VERSION: slde-v29  (2026-08-28)
//    slde-v29 TWO TONES. The email asserted "we have set your listing back to
//             draft" in every case, which is false for a PUBLISHED listing and
//             wrong for "these photos could use updating". A new `tone` field
//             picks the framing:
//               "draft"  (default) unchanged - blocking, listing is not live
//               "improve"          a suggestion - listing stays live, nothing
//                                  is blocked, no set-it-back-to-live step
//             The gap list, the callouts and the note render identically in
//             both; only the framing sentences, the heading, the subject and
//             the closing line change.
//             WHY IT MATTERS: publication is no longer the goal - matching is.
//             A live listing with weak photos is one we would still rather not
//             introduce a renter to, but telling its owner it has been set to
//             draft is simply untrue.
//             `note` was already threaded through and needed no change; it is
//             now the main path for a judgement only a person can make, e.g.
//             construction equipment visible in a photo, which no scanner
//             flags because the photo is present.
//
//  Emails a LANDLORD when a listing is set back to draft for not meeting the
//  photo standard, AND keeps a per-listing "what's missing" status so the
//  listings page can be annotated without opening each one.
//
//  Changelog
//   slde-v12 Jul 17  Two sections: POST accepts `listingReasons` and
//                    `profileReasons` (plus `missing`). Email renders a
//                    "On your listing" callout and an "On your profile" callout
//                    separately, then the full standard photo checklist. Status
//                    logs the combined items. `reasons` still accepted (treated
//                    as listing) for back-compat.
//   slde-v11 Jul 17  Preview mode: POST { preview:true, reasons, missing } returns
//                    the rendered { subject, html, text } WITHOUT sending, so the
//                    bookmarklet can show an in-panel email preview before send.
//   slde-v10 Jul 17  Email now ALWAYS shows the full standard checklist; ticked
//                    reasons appear as a highlighted "on your listing
//                    specifically" callout above it (both, not either/or). The
//                    per-listing status still logs just the ticked specifics.
//   slde-v9  Jul 17  Per-listing status tracker. POST accepts `postId` (the
//                    "ID:" on the listing row) and logs {items, date, to} to a
//                    Netlify Blob index (store "listing-status", key "index").
//                    New `saveOnly:true` logs the status WITHOUT sending an
//                    email. New GET `?statuses=1` returns the whole index for
//                    the list-page overlay bookmarklet.
//   slde-v8  Jul 17  Member-ID lookup via BD /user/get/{id} + BD_API_KEY.
//   slde-v7  Jul 17  Dropped listing-title from copy; sender verify@renters.com.
//   slde-v6  Jul 17  BCC every send to LISTING_EMAIL_BCC (default kenny@).
//   slde-v5  Jul 17  Reason checkboxes.
//   slde-v4  Jul 17  Security hardening.
//   slde-v3/2/1      Template, SDK rewrite, first cut.
//
//  ENV: SES_* · LISTING_EMAIL_ADMIN_KEY · LISTING_EMAIL_SENDER (verify@) ·
//       LISTING_EMAIL_BCC (kenny@) · EDIT_LISTING_URL · BD_API_KEY.
//  Blob: uses @netlify/blobs (already a dependency) — store "listing-status".
//
//  ENDPOINTS
//   GET ?version=1   -> config probe
//   GET ?statuses=1  -> { "<postId>": { items:[...], date, to }, ... }
//   POST (JSON)      -> { key, email?|memberId?, reasons?, missing?, postId?, saveOnly? }
// ============================================================
const FN_VERSION = "slde-v37";

const crypto = require("crypto");
const https = require("https");
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
  "Access-Control-Allow-Headers": "Content-Type, x-admin-key",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
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

// ---- per-listing status (Netlify Blob) --------------------------------------
// Each listing is its OWN blob key ("l:<id>") so concurrent scans never clobber
// each other (the old single "index" object had a lost-update race under the
// tracker's parallel scan). readStatusIndex() also folds in the legacy "index"
// object for back-compat with anything stored before this change.
// Netlify didn't auto-configure Blobs on this site, so configure it explicitly
// with a Site ID + token when those env vars are present (falls back to auto).
function statusStore() {
  const blobs = require("@netlify/blobs");
  const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN;
  if (siteID && token) return blobs.getStore({ name: "listing-status", siteID: siteID, token: token });
  return blobs.getStore("listing-status");
}
const STATUS_PREFIX = "l:";
function statusKey(id) { return STATUS_PREFIX + String(id).trim(); }
async function readOneStatus(id) {
  try { return (await statusStore().get(statusKey(id), { type: "json" })) || null; }
  catch (e) { return null; }
}
async function readStatusIndex() {
  const out = {};
  try {
    const store = statusStore();
    // Legacy single-index object (older versions) — lowest priority.
    try {
      const legacy = await store.get("index", { type: "json" });
      if (legacy && typeof legacy === "object") Object.keys(legacy).forEach(function (k) { out[k] = legacy[k]; });
    } catch (e) {}
    // Per-listing keys — authoritative, overwrite legacy.
    var cursor;
    do {
      const page = await store.list({ prefix: STATUS_PREFIX, cursor: cursor });
      const blobs = (page && page.blobs) || [];
      await Promise.all(blobs.map(async function (b) {
        const id = b.key.slice(STATUS_PREFIX.length);
        try { const v = await store.get(b.key, { type: "json" }); if (v) out[id] = v; } catch (e) {}
      }));
      cursor = page && page.cursor;
    } while (cursor);
  } catch (e) { console.error("[slde] status index read failed: " + (e && e.message)); }
  return out;
}
async function writeStatus(postId, entry) {
  try { await statusStore().setJSON(statusKey(postId), entry); return true; }
  catch (e) { console.error("[slde] status write failed: " + (e && e.message)); return false; }
}
// Shallow-merge a patch onto one listing's record. Only touches that listing's
// own key, so it never disturbs any other listing.
async function mergeStatus(postId, patch) {
  try {
    const store = statusStore();
    const cur = (await store.get(statusKey(postId), { type: "json" })) || {};
    await store.setJSON(statusKey(postId), Object.assign({}, cur, patch));
    return true;
  } catch (e) { console.error("[slde] status merge failed: " + (e && e.message)); return false; }
}

// Record that a landlord was emailed about a listing: bump the count, stamp the
// date, append to a capped log — WITHOUT wiping the auto-scan verdict.
async function recordNotification(postId, info) {
  try {
    const store = statusStore();
    const cur = (await store.get(statusKey(postId), { type: "json" })) || {};
    const log = Array.isArray(cur.notifyLog) ? cur.notifyLog.slice(-9) : [];
    log.push({ date: info.date, to: info.to || null, items: info.items || [] });
    const count = (cur.notifyCount || 0) + 1;
    await store.setJSON(statusKey(postId), Object.assign({}, cur, {
      items: info.items || cur.items || [], date: info.date, to: info.to || null,
      notifyCount: count, lastNotified: info.date, notifyLog: log,
    }));
    return count;
  } catch (e) { console.error("[slde] notify record failed: " + (e && e.message)); return null; }
}

// [DIAGNOSTIC] Prove out Netlify Blobs: does the module load, and can we write
// then read a value? Returns the exact failure so we can fix the right thing.
async function blobSelfTest() {
  const out = { moduleLoaded: false };
  try { require("@netlify/blobs"); out.moduleLoaded = true; }
  catch (e) { out.moduleError = (e && e.message) || String(e); return out; }
  out.manualConfig = !!((process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID) && (process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN));
  out.envSeen = {
    BLOBS_SITE_ID: !!process.env.BLOBS_SITE_ID,
    BLOBS_TOKEN: !!process.env.BLOBS_TOKEN,
    SITE_ID: !!process.env.SITE_ID,
    NETLIFY_SITE_ID: !!process.env.NETLIFY_SITE_ID,
    NETLIFY_API_TOKEN: !!process.env.NETLIFY_API_TOKEN,
  };
  try {
    const store = statusStore();
    await store.setJSON("selftest", { t: "ok" });
    const v = await store.get("selftest", { type: "json" });
    out.wroteAndRead = !!(v && v.t === "ok");
  } catch (e) {
    out.opError = (e && e.name ? e.name + ": " : "") + ((e && e.message) || String(e));
  }
  return out;
}

// ---- BD member lookup -------------------------------------------------------
// The whole record, untouched. bdGetMember() reduces it to email + first name,
// which is right for sending but useless for working out what BD stores.
function bdGetMemberRaw(id) {
  return new Promise(function (resolve) {
    const key = process.env.BD_API_KEY;
    if (!key) return resolve({ error: "no_bd_key" });
    const req = https.request(
      { host: "www.renters.com", path: "/api/v2/user/get/" + encodeURIComponent(String(id).trim()),
        method: "GET", headers: { "X-Api-Key": key, Accept: "application/json" } },
      function (res) {
        let data = "";
        res.on("data", function (c) { data += c; });
        res.on("end", function () {
          try {
            const j = JSON.parse(data);
            const rec = Array.isArray(j.message) ? j.message[0] : (j.message || j.data || j);
            if (!rec || typeof rec !== "object") return resolve({ error: "no_record" });
            resolve(rec);
          } catch (e) { resolve({ error: "parse_error", raw: String(data).slice(0, 200) }); }
        });
      }
    );
    req.on("error", function (e) { resolve({ error: "request_failed", detail: String(e && e.message) }); });
    req.end();
  });
}

function bdGetMember(id) {
  return new Promise(function (resolve) {
    const key = process.env.BD_API_KEY;
    if (!key) return resolve({ error: "no_bd_key" });
    const req = https.request(
      { host: "www.renters.com", path: "/api/v2/user/get/" + encodeURIComponent(String(id).trim()),
        method: "GET", headers: { "X-Api-Key": key, Accept: "application/json" } },
      function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); return resolve({ error: "redirect_" + res.statusCode }); }
        let data = "";
        res.on("data", function (c) { data += c; });
        res.on("end", function () {
          try {
            const j = JSON.parse(data);
            const rec = Array.isArray(j.message) ? j.message[0] : (j.message || j.data || j);
            if (!rec || typeof rec !== "object") return resolve({ error: "no_record" });
            const email = rec.email || rec.user_email || rec.email_address || "";
            let firstName = rec.first_name || rec.firstname || "";
            if (!firstName && rec.name) firstName = String(rec.name).trim().split(/\s+/)[0];
            if (!email) { console.error("[slde] BD " + id + ": no email; keys=" + Object.keys(rec).join(",")); return resolve({ error: "no_email_on_record" }); }
            resolve({ email: String(email).trim(), firstName: String(firstName || "").trim() });
          } catch (e) { resolve({ error: "parse_error", raw: String(data).slice(0, 160) }); }
        });
      }
    );
    req.on("error", function (e) { resolve({ error: String(e && e.message) }); });
    req.end();
  });
}

// [DIAGNOSTIC] Raw GET to a BD API path with the key — used by the ?probePost test.
function bdRawGet(path) {
  return new Promise(function (resolve) {
    const key = process.env.BD_API_KEY;
    if (!key) return resolve({ path: path, error: "no_bd_key" });
    const req = https.request({ host: "www.renters.com", path: path, method: "GET", headers: { "X-Api-Key": key, Accept: "application/json" } }, function (res) {
      var data = "";
      res.on("data", function (c) { data += c; });
      res.on("end", function () { resolve({ path: path, status: res.statusCode, snippet: String(data).slice(0, 500) }); });
    });
    req.on("error", function (e) { resolve({ path: path, error: String(e && e.message) }); });
    req.end();
  });
}

// ---- automatic scan: read a listing (photos + details) from BD --------------
// A raw GET against BD, so a diagnostic can try arbitrary paths without each
// one needing its own helper.
function bdRawGet(path) {
  return new Promise(function (resolve) {
    const key = process.env.BD_API_KEY;
    if (!key) return resolve({ error: "no_bd_key" });
    const req = https.request({ host: "www.renters.com", path: path, method: "GET", headers: { "X-Api-Key": key, Accept: "application/json" } }, function (res) {
      var data = "";
      res.on("data", function (c) { data += c; });
      res.on("end", function () {
        if (res.statusCode === 429) return resolve({ error: "rate_limited_429" });
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve({ error: "parse_error_" + res.statusCode, raw: String(data).slice(0, 160) }); }
      });
    });
    req.on("error", function (e) { resolve({ error: String(e && e.message) }); });
    req.end();
  });
}

function bdGetListing(id) {
  return new Promise(function (resolve) {
    const key = process.env.BD_API_KEY;
    if (!key) return resolve({ error: "no_bd_key" });
    const req = https.request({ host: "www.renters.com", path: "/api/v2/users_portfolio_groups/get/" + encodeURIComponent(String(id).trim()), method: "GET", headers: { "X-Api-Key": key, Accept: "application/json" } }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); return resolve({ error: "redirect_" + res.statusCode }); }
      var data = "";
      res.on("data", function (c) { data += c; });
      res.on("end", function () {
        try {
          const j = JSON.parse(data);
          const rec = Array.isArray(j.message) ? j.message[0] : null;
          if (!rec) return resolve({ error: "no_record" });
          const photos = (rec.users_portfolio || []).map(function (p) { return p.file_thumbnail_full_url || p.file_main_full_url; }).filter(Boolean);
          resolve({ listing: rec, photos: photos, user: rec.user || {} });
        } catch (e) { resolve({ error: "parse_error", raw: String(data).slice(0, 200) }); }
      });
    });
    req.on("error", function (e) { resolve({ error: String(e && e.message) }); });
    req.end();
  });
}

// ---- download one image server-side and return it as base64 (+ media type) --
// Claude's URL fetcher can't reach draft photos, so the function pulls the bytes
// itself and hands Claude base64 instead. Follows one redirect; caps the size.
function fetchImageB64(url, redirectsLeft) {
  return new Promise(function (resolve) {
    if (redirectsLeft == null) redirectsLeft = 3;
    var u;
    try { u = new URL(url); } catch (e) { return resolve(null); }
    const opts = { host: u.hostname, path: u.pathname + (u.search || ""), method: "GET", headers: { Accept: "image/*" } };
    const req = https.request(opts, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        var next = res.headers.location;
        try { next = new URL(next, url).toString(); } catch (e) {}
        return resolve(fetchImageB64(next, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      var ct = String(res.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (!/^image\//.test(ct)) ct = "";
      var chunks = [], total = 0, aborted = false;
      res.on("data", function (c) {
        total += c.length;
        if (total > 5 * 1024 * 1024) { aborted = true; res.destroy(); return; }
        chunks.push(c);
      });
      res.on("end", function () {
        if (aborted || !chunks.length) return resolve(null);
        const buf = Buffer.concat(chunks);
        var media = ct;
        if (!media) {
          if (/\.png(\?|$)/i.test(url)) media = "image/png";
          else if (/\.gif(\?|$)/i.test(url)) media = "image/gif";
          else if (/\.webp(\?|$)/i.test(url)) media = "image/webp";
          else media = "image/jpeg";
        }
        resolve({ media_type: media, data: buf.toString("base64") });
      });
    });
    req.on("error", function () { resolve(null); });
    req.setTimeout(15000, function () { req.destroy(); resolve(null); });
    req.end();
  });
}

// ---- automatic scan: judge the photos with Claude vision --------------------
function anthropicAssess(listing, photos) {
  return new Promise(function (resolve) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return resolve({ error: "no_anthropic_key" });
    const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
    const beds = listing.property_beds || "?";
    const baths = listing.property_baths || "?";
    const ptype = listing.property_type || "home";
    const desc = String(listing.group_desc || "").replace(/<[^>]+>/g, " ").slice(0, 700);
    const urls = (photos || []).slice(0, 12);
    Promise.all(urls.map(function (u) { return fetchImageB64(u); })).then(function (imgs) {
    const usable = imgs.filter(Boolean);
    if (!usable.length) return resolve({ error: "no_images_fetched", detail: "Could not download any of the " + urls.length + " photo URLs.", tried: urls.length });
    const content = [];
    content.push({ type: "text", text:
      "You review a rental listing's photos against a publishing standard. Property: " + ptype + ", " + beds + " bed / " + baths + " bath. Description: " + desc + "\n\n"
      + "The standard requires clear, well-lit photos of: the living area, EACH bedroom (there should be " + beds + "), the kitchen, EACH bathroom, the outside/exterior, and any shared spaces the description mentions (laundry, common areas, parking). "
      + "Looking only at the photos, decide which of these are NOT clearly shown, and whether any photos are too dark/blurry/low-quality or clearly not of this property.\n\n"
      + "Return ONLY compact JSON, no prose: {\"missing\":[\"A photo of the kitchen\",\"Photos of each bathroom\"],\"quality\":\"ok\",\"notes\":\"one short sentence\"}. "
      + "Phrase missing items the way a landlord should read them. If nothing is missing, use an empty array and quality \"ok\"."
    });
    usable.forEach(function (img) { content.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } }); });
    const bodyStr = JSON.stringify({ model: model, max_tokens: 600, messages: [{ role: "user", content: content }] });
    const req = https.request({ host: "api.anthropic.com", path: "/v1/messages", method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json", "Content-Length": Buffer.byteLength(bodyStr) } }, function (res) {
      var data = "";
      res.on("data", function (c) { data += c; });
      res.on("end", function () {
        try {
          const j = JSON.parse(data);
          if (j.error) return resolve({ error: "anthropic_" + (j.error.type || "err"), detail: j.error.message });
          const txt = (j.content && j.content[0] && j.content[0].text) || "";
          var parsed = null;
          try { parsed = JSON.parse(txt.replace(/^```json\s*|\s*```$/g, "").trim()); } catch (e2) {}
          resolve({ model: model, raw: txt, parsed: parsed, imagesUsed: usable.length, imagesTried: urls.length });
        } catch (e) { resolve({ error: "parse_error", raw: String(data).slice(0, 400) }); }
      });
    });
    req.on("error", function (e) { resolve({ error: String(e && e.message) }); });
    req.write(bodyStr);
    req.end();
    });
  });
}

// Is the bio about the PERSON or about the PROPERTY? Length cannot answer this
// - two hundred words about the kitchen is still the wrong field - so it is the
// one profile check that needs the model. Text only, no images, and skipped
// whenever the bio is empty or already too short to be worth judging.
function anthropicBioSubject(bio) {
  return new Promise(function (resolve) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return resolve({ verdict: "unknown", error: "no_anthropic_key" });
    const text = String(bio || "").trim();
    if (text.length < BIO_MIN) return resolve({ verdict: "unknown", skipped: "too_short_to_judge" });
    const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
    const prompt = "This is the Short Description on a landlord's PROFILE on a rental site. It is meant to introduce the person or company a renter would be renting from - not to describe a property.\n\n"
      + "Text: " + text.slice(0, 900) + "\n\n"
      + "Answer with ONLY one word: \"person\" if it is about the landlord, their company, their approach or their experience; \"property\" if it is mainly describing a rental unit, its rooms, features, price or availability; \"unclear\" if it is neither or you cannot tell. One word, nothing else.";
    const bodyStr = JSON.stringify({ model: model, max_tokens: 10, messages: [{ role: "user", content: prompt }] });
    const req = https.request({ host: "api.anthropic.com", path: "/v1/messages", method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json", "Content-Length": Buffer.byteLength(bodyStr) } }, function (res) {
      var data = "";
      res.on("data", function (c) { data += c; });
      res.on("end", function () {
        try {
          const j = JSON.parse(data);
          if (j.error) return resolve({ verdict: "unknown", error: "anthropic_" + (j.error.type || "err") });
          const t = String((j.content && j.content[0] && j.content[0].text) || "").toLowerCase();
          // FAIL TOWARD SAYING NOTHING. An unrecognised answer must not produce
          // a suggestion telling a landlord their bio is about the wrong thing.
          if (t.indexOf("property") !== -1) return resolve({ verdict: "property" });
          if (t.indexOf("person") !== -1) return resolve({ verdict: "person" });
          resolve({ verdict: "unknown", raw: t.slice(0, 40) });
        } catch (e) { resolve({ verdict: "unknown", error: "parse_error" }); }
      });
    });
    req.on("error", function () { resolve({ verdict: "unknown", error: "request_failed" }); });
    req.write(bodyStr);
    req.end();
  });
}

// ---- deterministic checks: listing fields + landlord profile ----------------
// A field "has a value" if it is non-empty and not a zero / null placeholder.
function hasVal(x) {
  if (x == null) return false;
  var s = String(x).trim();
  if (!s || s.toLowerCase() === "null") return false;
  if (/^0+(\.0+)?$/.test(s)) return false;         // "0", "0.00"
  if (/^[0.,\s]+$/.test(s) && !/[1-9]/.test(s)) return false; // "0,00.00"
  if (s === "0000-00-00") return false;
  return true;
}
// Non-photo gaps on the listing record itself.
function assessListingFields(g) {
  g = g || {};
  var out = [];
  if (!hasVal(g.group_name)) out.push("Add a listing title");
  var desc = String(g.group_desc || "").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
  if (desc.length < 40) out.push("Add a fuller property description");
  if (!hasVal(g.property_price) && !hasVal(g.post_promo) && !hasVal(g.rate)) out.push("Add the monthly rent price");
  if (!hasVal(g.property_beds)) out.push("Set the number of bedrooms");
  if (!hasVal(g.property_baths)) out.push("Set the number of bathrooms");
  if (!hasVal(g.property_type)) out.push("Set the property type");
  if (!hasVal(g.post_location)) out.push("Add the property address");
  return out;
}
// Gaps on the landlord's member profile.
// ACCEPT ANY FIELD THAT LEGITIMATELY HOLDS THE VALUE. BD stores several of
// these in more than one column depending on which form was used, and checking
// a single one produces a false gap on a profile that is genuinely complete.
// The intro is the one that bit: w143 in head code records that BD counts
// about_me OR my_story, and three wizards broke by reading only one.
function anyVal(u, names) {
  for (var i = 0; i < names.length; i++) { if (hasVal(u[names[i]])) return true; }
  return false;
}
// THE BIO FIELD, CONFIRMED FROM A LIVE RECORD rather than guessed: the landlord
// form has one paragraph field, labelled Short Description, stored as
// `search_description`. The legacy names are kept as fallbacks only - if a
// member predates the current form, their text may still be in one of them.
var BIO_FIELDS = ["search_description", "about_me", "my_story"];
var BIO_MIN = 80;   // characters. Anas's reads well at 152; three words is ~15.

function bioText(u) {
  for (var i = 0; i < BIO_FIELDS.length; i++) {
    var v = u[BIO_FIELDS[i]];
    if (hasVal(v)) return String(v).trim();
  }
  return "";
}

function assessProfile(u) {
  u = u || {};
  var out = [];
  if (!anyVal(u, ["first_name", "last_name", "full_name", "company", "companyname"])) out.push("Add your name");
  if (!anyVal(u, ["phone_number"])) out.push("Add a contact phone number");
  if (!bioText(u)) out.push("Complete your Short Description");
  if (String(u.verified) !== "1") out.push("Get verified");
  return out;
}

// SUGGESTIONS, NOT GAPS. These are things that are present but weak, so they
// belong in the improve voice and must never read as blocking. Returned
// separately for that reason.
function assessProfileSoft(u, subjectVerdict) {
  u = u || {};
  var out = [];
  var bio = bioText(u);
  if (bio && bio.length < BIO_MIN) {
    out.push("Your Short Description is filled in but very brief - a couple of sentences about you or your company helps renters take the listing seriously");
  }
  if (bio && subjectVerdict === "property") {
    out.push("Your Short Description talks about the property rather than about you - renters see it as an introduction to who they would be renting from");
  }
  return out;
}

// ---- email content ----------------------------------------------------------
const STANDARD_ITEMS = [
  "<strong style='color:#0d2d4e;'>Every room inside</strong> &mdash; the living area and each bedroom",
  "<strong style='color:#0d2d4e;'>The kitchen</strong>",
  "<strong style='color:#0d2d4e;'>Each bathroom</strong>",
  "<strong style='color:#0d2d4e;'>The outside of the property</strong> &mdash; the front, and any yard or grounds",
  "<strong style='color:#0d2d4e;'>Any shared spaces</strong> &mdash; hallways, stairwells, laundry, common areas, and parking",
];
const STANDARD_ITEMS_TEXT = [
  "Every room inside - the living area and each bedroom", "The kitchen", "Each bathroom",
  "The outside of the property - the front, and any yard or grounds",
  "Any shared spaces - hallways, stairwells, laundry, common areas, and parking",
];
function checklistRows(items) {
  return items.map(function (it) {
    return "<tr><td style='vertical-align:top;padding:0 10px 10px 0;'><span style='color:#8dc63f;font-size:18px;line-height:1.4;'>&#9679;</span></td>"
      + "<td style='padding:0 0 10px 0;font-size:14px;color:#4a5a6a;line-height:1.55;'>" + it + "</td></tr>";
  }).join("");
}
// Reasons ticked + optional free-text "other", as a plain-string list.
function pickedItems(reasons, missing) {
  const picked = [];
  (Array.isArray(reasons) ? reasons : []).forEach(function (r) { r = String(r == null ? "" : r).trim(); if (r) picked.push(r); });
  if (missing && String(missing).trim()) picked.push(String(missing).trim());
  return picked;
}
function buildEmail({ name, listingUrl, listingPicked, profilePicked, note, tone }) {
  // "improve" = a suggestion on a listing that stays live. Anything else keeps
  // the original blocking wording, so every existing caller is unaffected.
  const improve = String(tone || "") === "improve";
  const greet = esc(cleanName(name));
  const url = listingUrl || EDIT_URL;
  listingPicked = listingPicked || [];
  profilePicked = profilePicked || [];
  note = (note && String(note).trim()) ? String(note).trim() : "";
  const hasPhotos = listingPicked.length > 0;
  const hasProfile = profilePicked.length > 0;
  function callout(title, items, textColor, bg, border) {
    return "<div style='background:" + bg + ";border:1px solid " + border + ";border-radius:10px;padding:14px 16px;margin:0 0 18px;'>"
      + "<p style='font-size:14px;color:" + textColor + ";line-height:1.55;margin:0 0 6px;font-weight:700;'>" + title + "</p>"
      + "<table style='border-collapse:collapse;width:100%;'>" + checklistRows(items.map(esc)) + "</table></div>";
  }
  // The opening line follows what's actually checked — photos, profile, or both.
  var reasonHtml, reasonText;
  if (improve) {
    // NAME THE PAYOFF, DO NOT REASSURE. We match on specs - budget, timing,
    // property type, area, pets - which is what gets a renter to the listing.
    // What decides whether they pursue it is what they see when they arrive.
    // A good match that looks unconvincing does not convert, and nobody ever
    // finds out why. That is the landlord's own interest, so say it.
    var payoff = "When you get a chance, please update the following on your listing. We match renters to your place on the details, but what they see when they get there is what decides whether they pursue it.";
    if (hasPhotos && hasProfile) { reasonHtml = payoff; }
    else if (hasPhotos) { reasonHtml = "When you get a chance, please update the photos below. We match renters to your place on the details, but the photos are what decide whether they pursue it."; }
    else if (hasProfile) { reasonHtml = "When you get a chance, please complete the profile details below. Renters look at who they would be renting from before they get in touch."; }
    else { reasonHtml = "When you get a chance, please take a look at the note below."; }
  }
  else if (hasPhotos && hasProfile) { reasonHtml = "We&rsquo;ve set your listing back to draft because a few things still need attention before it can go live. It&rsquo;s a quick fix, not a rejection."; }
  else if (hasPhotos) { reasonHtml = "We&rsquo;ve set your listing back to draft because the photos don&rsquo;t yet meet our community standard. It&rsquo;s a quick fix, not a rejection."; }
  else if (hasProfile) { reasonHtml = "We&rsquo;ve set your listing back to draft because your profile needs a couple of updates before it can go live. It&rsquo;s a quick fix, not a rejection."; }
  else { reasonHtml = "We&rsquo;ve set your listing back to draft because it needs a couple of updates before it can go live. It&rsquo;s a quick fix, not a rejection."; }
  reasonText = reasonHtml.replace(/&rsquo;/g, "'");

  var specificHtml = "", specificText = "";
  if (hasPhotos) {
    var lHead = improve ? "On your listing:" : "On your listing, we still need:";
    specificHtml += callout(lHead, listingPicked, "#7c2d12", "#fff7ed", "#fed7aa");
    specificText += lHead + "\n" + listingPicked.map(function (i) { return "- " + i; }).join("\n") + "\n\n";
  }
  if (hasProfile) {
    var pHead = improve ? "On your profile:" : "On your profile, please add or complete:";
    specificHtml += callout(pHead, profilePicked, "#0c4a6e", "#eff6ff", "#bfdbfe");
    specificText += pHead + "\n" + profilePicked.map(function (i) { return "- " + i; }).join("\n") + "\n\n";
    // Identity + listing opt-in live at the end of the setup wizard.
    var identity = profilePicked.some(function (i) { return /identit|verif/i.test(i); });
    if (identity) {
      specificHtml += "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 18px;'>To confirm your identity and opt in to how you&rsquo;d like to list, finish the last step (Step 5 of 5) of the setup wizard on your dashboard.</p>";
      specificText += "To confirm your identity and opt in to how you'd like to list, finish the last step (Step 5 of 5) of the setup wizard on your dashboard.\n\n";
    }
  }
  if (note) {
    specificHtml += "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 18px;'><strong style='color:#0d2d4e;'>Also:</strong> " + esc(note) + "</p>";
    specificText += "Also: " + note + "\n\n";
  }
  // The full standard photo checklist appears ONLY when photos are involved.
  var standardHtml = "", standardText = "";
  if (hasPhotos) {
    var stdIntro = improve
      ? "For reference, this is what a complete set of photos covers:"
      : "Every live listing needs clear, well-lit photos of the whole property:";
    standardHtml = "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 14px;'>" + stdIntro + "</p>"
      + "<table style='border-collapse:collapse;width:100%;margin:0 0 20px;'>" + checklistRows(STANDARD_ITEMS) + "</table>";
    standardText = stdIntro + "\n" + STANDARD_ITEMS_TEXT.map(function (i) { return "- " + i; }).join("\n") + "\n";
  }
  var midHtml = specificHtml + standardHtml;
  var midText = specificText + standardText;
  var subject;
  if (improve) {
    // Plain, for the same reason as the heading. The body says what it is.
    if (hasPhotos) subject = "Your Renters.com listing";
    else if (hasProfile) subject = "Your Renters.com profile";
    else subject = "Your Renters.com listing";
  }
  else if (hasPhotos) subject = "Your Renters.com listing needs updated photos to go live";
  else if (hasProfile) subject = "A couple of updates to get your Renters.com listing live";
  else subject = "A quick fix to get your Renters.com listing live";
  const html = "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
    + "<body style='margin:0;padding:0;background:#eef2f5;font-family:Open Sans,Arial,sans-serif;'>"
    + "<div style='max-width:560px;margin:0 auto;padding:24px 16px;'>"
    + "<div style='background:#0d2d4e;border-radius:14px 14px 0 0;padding:26px 30px;text-align:center;'>"
    + "<div style='font-size:22px;font-weight:800;color:#ffffff;'>RENTERS<span style='color:#8dc63f;'>.</span></div></div>"
    + "<div style='background:#ffffff;padding:32px 30px;border-radius:0 0 14px 14px;'>"
    + "<h1 style='font-size:22px;font-weight:800;color:#0d2d4e;margin:0 0 14px;'>" + (improve ? "Your listing" : "A quick fix to get your listing live") + "</h1>"
    + "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 16px;'>Hi " + greet + ", thanks for listing your place on Renters.com. " + reasonHtml + "</p>"
    + midHtml
    + "<p style='font-size:15px;color:#4a5a6a;line-height:1.6;margin:0 0 22px;'>" + (improve
        ? "Your listing stays live either way."
        : "Once those are done, set your listing back to live. It will go to pending approval, and we&rsquo;ll review it and make it visible as soon as it meets the standard.") + "</p>"
    + "<div style='text-align:center;margin-bottom:24px;'><a href='" + esc(url) + "' style='display:inline-block;background:#8dc63f;color:#0d2d4e;text-decoration:none;border-radius:10px;padding:13px 30px;font-size:15px;font-weight:700;'>" + (improve ? "Update your listing &rarr;" : "Complete your listing &rarr;") + "</a></div>"
    + "<p style='font-size:14px;color:#4a5a6a;line-height:1.6;margin:0;'>&mdash; The Renters.com team</p>"
    + "</div><p style='font-size:12px;color:#9aa7b3;text-align:center;margin:18px 0 0;'>Renters.com. Finding a home should feel safe.</p>"
    + "</div></body></html>";
  const text = "Hi " + cleanName(name) + ",\n\n"
    + "Thanks for listing your place on Renters.com. " + reasonText + "\n\n"
    + midText + "\n" + (improve
        ? "Your listing stays live either way."
        : "Once those are done, set your listing back to live. It will go to pending approval, and we'll review it and make it visible as soon as it meets the standard.") + "\n\n" + (improve ? "Update your listing: " : "Complete your listing: ") + url + "\n\n- The Renters.com team\n\nRenters.com. Finding a home should feel safe.";
  return { subject, html, text };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === "GET") {
    if (qs.statuses != null) {
      // Gated: the status feed carries landlord emails, so require the admin key
      // via the x-admin-key header (not the URL). Callers: dashboard + tracker.
      const hk = (event.headers && (event.headers["x-admin-key"] || event.headers["X-Admin-Key"])) || "";
      const ak = process.env.LISTING_EMAIL_ADMIN_KEY || "";
      if (!ak || !safeEqual(hk, ak)) return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: "Unauthorized" }) };
      const idx = await readStatusIndex();
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(idx) };
    }
    if (qs.diag === "listings2") {
      // ROUND TWO. ?limit works, ?offset and ?page do not. What is left:
      // sorting (to reach the newest), filtering (so a slice fits the cap),
      // and walking ids one at a time (slow but certain).
      const hk2 = (event.headers && (event.headers["x-admin-key"] || event.headers["X-Admin-Key"])) || "";
      const ak2 = process.env.LISTING_EMAIL_ADMIN_KEY || "";
      if (!ak2 || !safeEqual(hk2, ak2)) return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: "Unauthorized" }) };
      const BASE = "/api/v2/users_portfolio_groups/get?limit=100";
      const probes = [
        { name: "control", path: BASE },
        { name: "sort_desc", path: BASE + "&sort=desc" },
        { name: "order_desc", path: BASE + "&order=desc" },
        { name: "orderby_id_desc", path: BASE + "&order_by=group_id&order=desc" },
        { name: "sortby_newest", path: BASE + "&sort_by=newest" },
        { name: "status_1", path: BASE + "&group_status=1" },
        { name: "status_0", path: BASE + "&group_status=0" },
        { name: "start_100", path: BASE + "&start=100" }
      ];
      const out = [];
      for (var pi = 0; pi < probes.length; pi++) {
        const pr = probes[pi];
        const r = await bdRawGet(pr.path);
        if (r.error) { out.push({ probe: pr.name, error: r.error }); continue; }
        const rows = Array.isArray(r.message) ? r.message : (Array.isArray(r.data) ? r.data : []);
        const ids = rows.map(function (x) { return String(x.group_id || x.id || ""); });
        out.push({ probe: pr.name, rows: rows.length, firstId: ids[0] || null, lastId: ids[ids.length - 1] || null });
      }
      // COMPARE EACH AGAINST THE CONTROL, not against a different variant.
      // That is the mistake v35 made.
      const ctrl = out[0] || {};
      out.forEach(function (o) {
        if (o.probe === "control" || o.error) return;
        o.differsFromControl = !(o.firstId === ctrl.firstId && o.lastId === ctrl.lastId && o.rows === ctrl.rows);
      });
      // Can we simply ask for an id above the cap? Three only - enough to
      // prove the route, not enough to spend the rate limit on.
      const walk = [];
      const tryIds = ["286", "290", "293"];
      for (var wi = 0; wi < tryIds.length; wi++) {
        const one = await bdGetListing(tryIds[wi]);
        walk.push({ id: tryIds[wi], ok: !one.error, error: one.error || null, name: (one.listing && one.listing.group_name) || null });
      }
      const useful = out.filter(function (o) { return o.differsFromControl; }).map(function (o) { return o.probe; });
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({
        ok: true, _v: FN_VERSION, control: ctrl, probes: out,
        walkById: walk,
        routesThatChangeTheWindow: useful,
        note: useful.length
          ? "These parameters move the window, so a full pull is possible without walking every id."
          : "Nothing moves the window. Walking ids one at a time is the only route that reaches every listing."
      }, null, 2) };
    }
    if (qs.diag === "listings") {
      // WHAT DOES BD ACTUALLY RETURN? Probe rather than assume: same call with
      // different paging parameters, and compare. If every variant returns an
      // identical first and last id, the parameters are being ignored - which
      // is exactly what /leads/get does.
      const hk = (event.headers && (event.headers["x-admin-key"] || event.headers["X-Admin-Key"])) || "";
      const ak = process.env.LISTING_EMAIL_ADMIN_KEY || "";
      if (!ak || !safeEqual(hk, ak)) return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: "Unauthorized" }) };
      const variants = [
        { name: "plain", path: "/api/v2/users_portfolio_groups/get" },
        { name: "limit250", path: "/api/v2/users_portfolio_groups/get?limit=250" },
        { name: "limit250_offset100", path: "/api/v2/users_portfolio_groups/get?limit=250&offset=100" },
        { name: "page2", path: "/api/v2/users_portfolio_groups/get?page=2" },
        { name: "perpage250", path: "/api/v2/users_portfolio_groups/get?per_page=250" }
      ];
      const results = [];
      for (var vi = 0; vi < variants.length; vi++) {
        const v = variants[vi];
        const r = await bdRawGet(v.path);
        if (r.error) { results.push({ variant: v.name, error: r.error }); continue; }
        const rows = Array.isArray(r.message) ? r.message : (Array.isArray(r.data) ? r.data : []);
        const ids = rows.map(function (x) { return String(x.group_id || x.id || ""); });
        results.push({
          variant: v.name, rows: rows.length,
          firstId: ids[0] || null, lastId: ids[ids.length - 1] || null,
          statuses: rows.reduce(function (acc, x) { var k = String(x.group_status); acc[k] = (acc[k] || 0) + 1; return acc; }, {})
        });
      }
      const base = results[0] || {};
      const allSame = results.every(function (r) { return r.error || (r.firstId === base.firstId && r.lastId === base.lastId); });
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({
        ok: true, _v: FN_VERSION, results: results,
        pagingIgnored: allSame,
        note: allSame
          ? "Every variant returned the same window - BD is ignoring the paging parameters, same as /leads/get."
          : "Paging changes the window, so a full pull is possible."
      }, null, 2) };
    }
    if (qs.diag === "member") {
      // Which fields does BD ACTUALLY populate? Written because v31 had to
      // accept six possible names for one field, none of them confirmed.
      const hk = (event.headers && (event.headers["x-admin-key"] || event.headers["X-Admin-Key"])) || "";
      const ak = process.env.LISTING_EMAIL_ADMIN_KEY || "";
      if (!ak || !safeEqual(hk, ak)) return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: "Unauthorized" }) };
      const mid = String(qs.memberId || "").trim();
      if (!mid) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "memberId required" }) };
      const rec = await bdGetMemberRaw(mid);
      if (!rec || rec.error) return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: false, _v: FN_VERSION, memberId: mid, error: (rec && rec.error) || "no_record" }) };
      const populated = {};
      Object.keys(rec).forEach(function (k) {
        const v = rec[k];
        if (v === null || v === undefined) return;
        const str = typeof v === "object" ? JSON.stringify(v) : String(v);
        if (!str.trim() || str.trim() === "0") return;
        populated[k] = str.length > 300 ? (str.slice(0, 300) + "...[truncated]") : str;
      });
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({
        ok: true, _v: FN_VERSION, memberId: mid,
        allKeys: Object.keys(rec).sort(),
        populated: populated,
        assessedAs: assessProfile(rec)
      }, null, 2) };
    }
    if (qs.blobtest != null) {
      const hk = (event.headers && (event.headers["x-admin-key"] || event.headers["X-Admin-Key"])) || "";
      const ak = process.env.LISTING_EMAIL_ADMIN_KEY || "";
      if (!ak || !safeEqual(hk, ak)) return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: "Unauthorized" }) };
      const t = await blobSelfTest();
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(t) };
    }
    return {
      statusCode: 200, headers: corsHeaders,
      body: JSON.stringify({
        ok: true, _v: FN_VERSION, region: process.env.SES_REGION || "us-east-2",
        adminKeyConfigured: !!process.env.LISTING_EMAIL_ADMIN_KEY,
        sesKeyConfigured: !!process.env.SES_ACCESS_KEY_ID && !!process.env.SES_SECRET_ACCESS_KEY,
        bdKeyConfigured: !!process.env.BD_API_KEY, sender: SENDER,
        bcc: BCC && looksLikeEmail(BCC) ? BCC.trim() : null,
      }),
    };
  }

  if (event.httpMethod !== "POST") return { statusCode: 405, headers: corsHeaders, body: "Method Not Allowed" };

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const adminKey = process.env.LISTING_EMAIL_ADMIN_KEY || "";
  if (!adminKey || !safeEqual(body.key, adminKey)) {
    console.warn("[slde] rejected: bad or missing admin key");
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  // [DIAGNOSTIC] Feasibility probe: can BD return a listing/post (with photos) via API?
  if (body.probePost) {
    const pid2 = String(body.probePost).trim();
    const cands = ["/api/v2/content/get/" + pid2, "/api/v2/post/get/" + pid2, "/api/v2/listing/get/" + pid2, "/api/v2/portfolio/get/" + pid2, "/api/v2/user_portfolio/get/" + pid2, "/api/v2/content/get?content_id=" + pid2, "/api/v2/posts/get/" + pid2];
    const results = [];
    for (var ci = 0; ci < cands.length; ci++) { results.push(await bdRawGet(cands[ci])); }
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ probePost: pid2, results: results }, null, 2) };
  }

  // [DIAGNOSTIC] Field inventory: dump the listing + landlord member fields so we
  // can build profile / non-photo checks against the real BD field names.
  if (body.inspectPost) {
    const iid = String(body.inspectPost).trim();
    const L = await bdGetListing(iid);
    if (L.error) return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: "listing fetch failed", detail: L.error }) };
    function inv(obj) {
      var o = {};
      Object.keys(obj || {}).forEach(function (k) {
        var v = obj[k];
        if (k === "users_portfolio") { o[k] = "[array of " + (Array.isArray(v) ? v.length : 0) + " photos]"; return; }
        if (v && typeof v === "object") { o[k] = Array.isArray(v) ? ("[array " + v.length + "]") : ("[object keys: " + Object.keys(v).join(",") + "]"); }
        else { o[k] = String(v == null ? "" : v).slice(0, 140); }
      });
      return o;
    }
    var uid = (L.user && (L.user.id || L.user.user_id)) || L.listing.user_id || L.listing.created_by || L.listing.user_created || L.listing.author_id || "";
    var member = uid ? await bdRawGet("/api/v2/user/get/" + encodeURIComponent(String(uid))) : { note: "no user id field found on listing record" };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({
      inspectPost: iid, memberIdGuess: uid,
      listingFields: inv(L.listing), embeddedUser: L.user, memberRaw: member,
    }, null, 2) };
  }

  // INVENTORY WALK. Records what exists, with no AI. See the v37 header note.
  if (body.walk === true) {
    const from = Math.max(1, parseInt(body.from || body.cursor || 1, 10) || 1);
    const to = Math.max(from, parseInt(body.to || (from + 24), 10) || (from + 24));
    // Bounded per call so a browser tab is never holding a four-minute request
    // open, and so a 429 costs one small batch rather than the whole run.
    const span = Math.min(to - from + 1, 25);
    const found = [], missing = [];
    var rateLimited = false, lastId = from - 1;

    for (var wid = from; wid < from + span; wid++) {
      const one = await bdGetListing(String(wid));
      lastId = wid;
      if (one.error) {
        // A 429 is NOT a missing listing. Stop, rather than write a run of
        // false absences that look exactly like deleted records.
        if (String(one.error).indexOf("429") !== -1 || String(one.error).indexOf("rate") !== -1) { rateLimited = true; break; }
        missing.push(wid);
        continue;
      }
      const L = one;
      const uid = String((L.listing && (L.listing.user_id || L.listing.logged_user)) || (L.user && L.user.user_id) || "").trim();
      var lname = "";
      if (L.user) { lname = [L.user.first_name, L.user.last_name].filter(Boolean).join(" ").trim(); if (!lname && L.user.company) lname = String(L.user.company).trim(); }
      // MERGE. A listing already scanned keeps its verdict and notify history;
      // this only fills in what was missing.
      await mergeStatus(String(wid), {
        listingName: L.listing.group_name,
        landlord: { userId: uid, email: (L.user && L.user.email) || "", name: lname },
        inv: {
          group_status: L.listing.group_status,
          created: L.listing.date_updated || "",
          lastEdit: L.listing.revision_timestamp || "",
          beds: L.listing.property_beds || "",
          baths: L.listing.property_baths || "",
          type: L.listing.property_type || "",
          rent: L.listing.post_promo || "",
          photoCount: (L.photos || []).length,
          seenAt: new Date().toISOString()
        }
      });
      found.push({ id: String(wid), name: L.listing.group_name, status: L.listing.group_status, photos: (L.photos || []).length });
      // Paced under BD's ~100/minute ceiling.
      await new Promise(function (r) { setTimeout(r, 120); });
    }

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({
      ok: true, _v: FN_VERSION,
      from: from, scanned: lastId - from + 1,
      found: found.length, missingIds: missing,
      rateLimited: rateLimited,
      nextCursor: rateLimited ? lastId : (lastId + 1),
      items: found
    }, null, 2) };
  }

  // [STAGE 1] Scan one listing: read its photos from BD, judge with Claude, return the verdict.
  if (body.scanPost) {
    const sid = String(body.scanPost).trim();
    const L = await bdGetListing(sid);
    if (L.error) return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: "listing fetch failed", detail: L.error }) };
    const a = await anthropicAssess(L.listing, L.photos);
    const photoGaps = (a && a.parsed && Array.isArray(a.parsed.missing)) ? a.parsed.missing : [];
    const listingGaps = assessListingFields(L.listing);
    const profileGaps = assessProfile(L.user);
    // One extra text-only call, and only when there is a bio worth judging.
    const bioSubj = await anthropicBioSubject(bioText(L.user || {}));
    const profileSoft = assessProfileSoft(L.user, bioSubj.verdict);
    const aiOk = !!(a && a.parsed);
    // Landlord, so the tracker can email them their gaps in one click.
    const uid = String((L.listing && (L.listing.user_id || L.listing.logged_user)) || (L.user && (L.user.user_id || L.user.id)) || "").trim();
    var lname = "";
    if (L.user) { lname = [L.user.first_name, L.user.last_name].filter(Boolean).join(" ").trim(); if (!lname && L.user.company) lname = String(L.user.company).trim(); }
    // Persist the verdict so the tracker badges fill in automatically. Merge, so
    // it never clobbers a manual "notified" record — it only updates `auto`.
    const saved = await mergeStatus(sid, {
      listingName: L.listing.group_name,
      landlord: { userId: uid, email: (L.user && L.user.email) || "", name: lname },
      auto: {
        photo: photoGaps, listing: listingGaps, profile: profileGaps,
        // Suggestions are stored apart from gaps so the dashboard can show them
        // differently and they never make a listing look blocked.
        profileSoft: profileSoft, bioSubject: bioSubj.verdict,
        items: photoGaps.concat(listingGaps, profileGaps),
        photoError: aiOk ? "" : ((a && (a.error || a.detail)) || "photo_scan_failed"),
        notes: (a && a.parsed && a.parsed.notes) || "", quality: (a && a.parsed && a.parsed.quality) || "",
        date: new Date().toISOString(), group_status: L.listing.group_status,
        created: L.listing.date_updated || "", lastEdit: L.listing.revision_timestamp || "",
        beds: L.listing.property_beds, baths: L.listing.property_baths, photoCount: L.photos.length,
      },
    });
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({
      scanPost: sid, name: L.listing.group_name, group_status: L.listing.group_status,
      beds: L.listing.property_beds, baths: L.listing.property_baths, type: L.listing.property_type,
      photoCount: L.photos.length, landlordEmail: (L.user && L.user.email) || null, saved: saved,
      gaps: { photo: photoGaps, listing: listingGaps, profile: profileGaps },
      // Kept out of `gaps` deliberately: the tracker counts gaps to decide
      // whether a listing needs work, and a brief bio should not make a
      // complete listing read as incomplete.
      profileSoft: profileSoft, bioSubject: bioSubj.verdict,
      assessment: a,
    }, null, 2) };
  }

  const postId = String(body.postId || "").trim();
  const saveOnly = !!body.saveOnly;
  // Listing section (accepts legacy `reasons` too) + Profile section. The free-text
  // "Anything else" is a NOTE, kept separate so it never triggers the photo copy.
  const listingSrc = body.listingReasons != null ? body.listingReasons : body.reasons;
  const listingPicked = pickedItems(listingSrc, null);
  const profilePicked = pickedItems(body.profileReasons, null);
  const note = (body.missing && String(body.missing).trim()) ? String(body.missing).trim() : "";
  // "improve" softens the framing for a listing that is staying live. Unknown
  // or absent values fall through to the original blocking wording, so an old
  // caller behaves exactly as before.
  const tone = String(body.tone || "") === "improve" ? "improve" : "draft";
  const picked = listingPicked.concat(profilePicked).concat(note ? [note] : []); // combined, for the status log/tracker
  const nowISO = new Date().toISOString();

  // Preview: render the email and return it, without sending or requiring a recipient.
  if (body.preview === true) {
    const pv = buildEmail({ name: body.name, listingUrl: body.listingUrl, listingPicked: listingPicked, profilePicked: profilePicked, note: note, tone: tone });
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, preview: true, subject: pv.subject, html: pv.html, text: pv.text }) };
  }

  // Save-only: record the listing's status without emailing anyone. Merge so it
  // keeps the auto-scan verdict and notify history intact.
  if (saveOnly) {
    if (!postId) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "postId required to save a status" }) };
    await mergeStatus(postId, { items: picked, date: nowISO, to: null });
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, saved: true, postId: postId, items: picked }) };
  }

  // Send path: resolve recipient (memberId lookup or typed email).
  let email = String(body.email || "").trim();
  let name = body.name;
  if ((!email || !name) && body.memberId != null && String(body.memberId).trim()) {
    const m = await bdGetMember(String(body.memberId).trim());
    if (m.error && !email) return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: "Could not look up member " + String(body.memberId).trim(), detail: m.error }) };
    if (!email && m.email) email = m.email;
    if (!name && m.firstName) name = m.firstName;
  }
  if (!looksLikeEmail(email)) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Provide a landlord email or a valid member ID", got: email }) };

  const { subject, html, text } = buildEmail({ name: name, listingUrl: body.listingUrl, listingPicked: listingPicked, profilePicked: profilePicked, note: note, tone: tone });

  const destination = { ToAddresses: [email] };
  if (BCC && looksLikeEmail(BCC)) destination.BccAddresses = [BCC.trim()];
  const command = new SendEmailCommand({
    Source: SENDER, Destination: destination, ReplyToAddresses: [REPLYTO],
    Message: { Subject: { Data: subject, Charset: "UTF-8" }, Body: { Text: { Data: text, Charset: "UTF-8" }, Html: { Data: html, Charset: "UTF-8" } } },
  });

  try {
    const res = await ses.send(command);
    var notifyCount = null;
    if (postId) notifyCount = await recordNotification(postId, { items: picked, date: nowISO, to: email });
    console.log("[slde] sent to " + email + (postId ? " (listing " + postId + ")" : "") + " MessageId=" + (res && res.MessageId));
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, _v: FN_VERSION, email, postId: postId || null, notifyCount: notifyCount, messageId: (res && res.MessageId) || null }) };
  } catch (err) {
    console.error("[slde] SES error:", err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Failed to send email", details: err.message }) };
  }
};

module.exports._internal = { buildEmail, cleanName, esc, looksLikeEmail, pickedItems, FN_VERSION };
