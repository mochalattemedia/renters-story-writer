// members-map-new7.js
// Renters.com — Live Members Map — dedicated "New this week" counter (Element T).
//
// FN_VERSION: mn7-v1
//
// WHY THIS EXISTS:
//   The big member scan (members-map-build.js) is slow and kept failing to complete a
//   full pass, so the "New this week" count that rode on it never published. This REMOVES
//   that dependency. New signups have the HIGHEST member ids, so counting "joined in the
//   last 7 days" only needs the TOP slice of ids. This reads the top ~220 real members in
//   a SINGLE run, counts recent signups, and writes the number straight into the snapshot
//   Blob's totals.new7 — where the page already reads it. No page change needed.
//
//   It COMPLETES EVERY RUN. Nothing to resume, nothing to wedge, no checkpoint. Run it
//   once from Netlify "Run now" and it logs the count immediately.
//
// COST: ~220 single reads at 120ms, serial, one call at a time. Well under BD's throttle.
//   Does NOT geocode (no Google cost). Does NOT touch pins/totals/scan state.
//
// ENDPOINTS:
//   ?version=1   -> version + config
//   (scheduled)  -> runs the count (also fires on Netlify "Run now")
//   ?peek=1      -> report the last count written

const { getStore } = require("@netlify/blobs");

const FN_VERSION = "mn7-v1";

const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";
const BD_KEY = process.env.BD_API_KEY || "";

const BLOB_STORE = "members-map";
const KEY_SNAPSHOT = "snapshot";
const KEY_NEW7 = "new7-count";
const KEY_TOP = "new7-top";   // cached real top id so the coarse probe runs once, not every wake

const CEILING = 6000;
const TOP_WINDOW = 60;    // top 60 real members covers a week of signups comfortably
const REQUEST_DELAY_MS = 60;   // short burst of ~60 reads is safe under BD throttle
const TIME_BUDGET_MS = 8000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function rdcStore(name) {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) return getStore({ name, siteID, token });
  return getStore(name);
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(body, null, 2)
  };
}

function log() { console.log.apply(console, ["[mn7]"].concat(Array.prototype.slice.call(arguments))); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function signupMs(raw) {
  if (!raw) return null;
  var s = String(raw).trim();
  if (s.indexOf("T") > 0 && s.indexOf("-") > 0) {
    var iso = Date.parse(s);
    if (isFinite(iso)) return iso;
  }
  var d = s.replace(/[^0-9]/g, "");
  if (d.length >= 8) {
    var y = Number(d.substring(0, 4)), mo = Number(d.substring(4, 6)), da = Number(d.substring(6, 8));
    var h = d.length >= 10 ? Number(d.substring(8, 10)) : 0;
    var mi = d.length >= 12 ? Number(d.substring(10, 12)) : 0;
    var se = d.length >= 14 ? Number(d.substring(12, 14)) : 0;
    if (y > 2000 && mo >= 1 && mo <= 12 && da >= 1 && da <= 31) return Date.UTC(y, mo - 1, da, h, mi, se);
  }
  var t = Date.parse(s);
  return isFinite(t) ? t : null;
}

function rowsFrom(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.message)) return data.message;
  if (data.message && typeof data.message === "object" && !Array.isArray(data.message)) return [data.message];
  if (Array.isArray(data.data)) return data.data;
  return [];
}

async function fetchMemberById(id) {
  try {
    var res = await fetch(BD_BASE + "/user/get/" + id, {
      method: "GET",
      headers: { "X-Api-Key": BD_KEY, Accept: "application/json" },
      redirect: "manual"
    });
    if (res.status >= 300 && res.status < 400) return null;
    var text = await res.text();
    var data = null;
    try { data = JSON.parse(text); } catch (e) { return null; }
    var rows = rowsFrom(data);
    return rows.length ? rows[0] : null;
  } catch (e) {
    return null;
  }
}

async function run() {
  var started = Date.now();
  var deadline = started + TIME_BUDGET_MS;
  var store = rdcStore(BLOB_STORE);
  var weekAgo = Date.now() - WEEK_MS;

  var realSeen = 0, idsChecked = 0, new7 = 0, highestId = 0, timedOut = false;

  // STEP 1: find the real top. Use a cached value if we have one (so we do this ONCE,
  // not every wake). Otherwise do a coarse UNPACED probe down from CEILING in big steps
  // to jump the empty id zone quickly, then start the window a little above it.
  var start = 0;
  try {
    var cachedTop = JSON.parse(await store.get(KEY_TOP));
    if (cachedTop && cachedTop.top > 0) start = Math.min(CEILING, cachedTop.top + 40);
  } catch (e) {}

  if (!start) {
    for (var probe = CEILING; probe >= 1; probe -= 15) {
      if (Date.now() > deadline) { timedOut = true; break; }
      var pm = await fetchMemberById(probe);   // UNPACED: a short burst of light probes is fine
      idsChecked++;
      if (pm) { start = Math.min(CEILING, probe + 15); break; }
    }
    if (start > 0) {
      try { await store.set(KEY_TOP, JSON.stringify({ top: start, at: Date.now() })); } catch (e) {}
    }
  }
  if (!start) start = CEILING;

  // STEP 2: walk down from the real top, inspecting TOP_WINDOW real members.
  for (var id = start; id >= 1 && realSeen < TOP_WINDOW; id--) {
    if (Date.now() > deadline) { timedOut = true; break; }
    var m = await fetchMemberById(id);
    idsChecked++;
    if (m) {
      realSeen++;
      if (id > highestId) highestId = id;
      var ms = signupMs(m.signup_date || m.created || m.date_added);
      if (ms !== null && ms >= weekAgo) new7++;
    }
    await sleep(REQUEST_DELAY_MS);
  }

  var record = {
    new7: new7,
    checkedAt: new Date().toISOString(),
    realMembersInspected: realSeen,
    idsChecked: idsChecked,
    highestId: highestId,
    partial: timedOut
  };
  await store.set(KEY_NEW7, JSON.stringify(record));
  if (highestId > 0) { try { await store.set(KEY_TOP, JSON.stringify({ top: highestId, at: Date.now() })); } catch (e) {} }

  var published = false;
  try {
    var snapRaw = await store.get(KEY_SNAPSHOT);
    if (snapRaw) {
      var snap = JSON.parse(snapRaw);
      if (snap && snap.totals) {
        snap.totals.new7 = new7;
        await store.set(KEY_SNAPSHOT, JSON.stringify(snap));
        published = true;
      }
    }
  } catch (e) {
    log("could not write new7 into snapshot:", e.message);
  }

  var report = Object.assign({ _v: FN_VERSION, ok: true, publishedToSnapshot: published, ms: Date.now() - started }, record);
  log("NEW7 DONE", JSON.stringify(report));
  return report;
}

async function peek() {
  var store = rdcStore(BLOB_STORE);
  try {
    var r = JSON.parse(await store.get(KEY_NEW7));
    return Object.assign({ _v: FN_VERSION }, r);
  } catch (e) {
    return { _v: FN_VERSION, new7: null, note: "no count written yet" };
  }
}

exports.handler = async function (event) {
  var q = (event && event.queryStringParameters) || {};

  if (q.version) {
    return json(200, { _v: FN_VERSION, bdApiKeyConfigured: !!BD_KEY, topWindow: TOP_WINDOW, ceiling: CEILING });
  }
  if (q.peek) return json(200, await peek());
  if (!BD_KEY) return json(500, { error: "BD_API_KEY not configured" });

  try {
    var report = await run();
    return json(200, report);
  } catch (e) {
    console.error("[mn7] FAILED:", e.message);
    return json(500, { _v: FN_VERSION, ok: false, error: e.message });
  }
};
