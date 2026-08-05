// members-map-new7.js
// Renters.com — Live Members Map — dedicated "New this week" counter (Element T).
//
// FN_VERSION: mn7-v2
//
// WHY THIS EXISTS:
//   Counting "joined in the last 7 days" only needs the TOP few member ids (newest = highest
//   ids). This reads a small window at the top, counts recent signups, and writes the number
//   into the snapshot Blob's totals.new7 — where the page already reads it. No page change.
//
// ⭐ mn7-v2 — NO HARDCODED CEILING. The platform grows ~15 members/day, so any fixed ceiling
//   goes stale fast. Instead we STORE the highest member id we have ever seen (in a Blob) and
//   self-update it every run. Each run starts a bit ABOVE the stored high to catch new signups,
//   walks down through the top window, and saves the new highest found. The "top" tracks growth
//   automatically — it can never fall behind, and there is no number to maintain.
//
//   Completes every run, even when BD is slow: the window is tiny (top ~30 real members) and
//   there is a hard time budget, so a slow BD just means a slightly smaller sample, never a hang.
//
// COST: a few dozen single reads, serial, one call at a time. No geocoding (no Google cost).
//   Touches ONLY totals.new7 in the snapshot — every other count/pin is left exactly as-is.
//
// ENDPOINTS:  ?version=1 | ?peek=1 | (scheduled / Run now) runs the count

const { getStore } = require("@netlify/blobs");

const FN_VERSION = "mn7-v2";

const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";
const BD_KEY = process.env.BD_API_KEY || "";

const BLOB_STORE = "members-map";
const KEY_SNAPSHOT = "snapshot";
const KEY_NEW7 = "new7-count";
const KEY_HIGH = "new7-highest";     // self-updating highest member id ever seen

const WINDOW = 30;                    // inspect the top ~30 real members (covers a week of signups)
const PROBE_AHEAD = 30;              // small headroom above last-known top (only ~15 new/day, so 30 is ample)
const REQUEST_DELAY_MS = 60;         // light pacing between reads
const TIME_BUDGET_MS = 8500;         // stay under Netlify's 10s wall even if BD is slow
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const FALLBACK_START = 4500;         // only used the very first run, before any high is stored

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

  // Where to start: a bit ABOVE the last-known highest, so we catch members added since.
  var lastHigh = 0;
  try {
    var h = JSON.parse(await store.get(KEY_HIGH));
    if (h && h.high > 0) lastHigh = h.high;
  } catch (e) {}
  var start = lastHigh > 0 ? lastHigh + PROBE_AHEAD : FALLBACK_START;

  // Walk DOWN from start. Skip empties fast; when we hit real members, inspect the top WINDOW
  // of them and count recent signups. Record the highest real id we find (self-updating top).
  var realSeen = 0, idsChecked = 0, new7 = 0, highestFound = 0, timedOut = false;

  for (var id = start; id >= 1 && realSeen < WINDOW; id--) {
    if (Date.now() > deadline) { timedOut = true; break; }
    var m = await fetchMemberById(id);
    idsChecked++;
    if (m) {
      if (id > highestFound) highestFound = id;
      realSeen++;
      var ms = signupMs(m.signup_date || m.created || m.date_added);
      if (ms !== null && ms >= weekAgo) new7++;
    }
    await sleep(REQUEST_DELAY_MS);
  }

  // Self-update the stored highest so the top tracks growth automatically.
  if (highestFound > 0) {
    // found real members: record the true highest (climbs as you grow).
    var newHigh = Math.max(highestFound, lastHigh);
    try { await store.set(KEY_HIGH, JSON.stringify({ high: newHigh, at: Date.now() })); } catch (e) {}
  } else if (lastHigh > 0) {
    // found NOTHING: our start point was above the real top (deletions, or drift). Step the
    // stored high DOWN so the next run starts lower and reconverges, instead of sticking in
    // the empty zone forever. Drop by a WINDOW-sized chunk each empty run.
    var lowered = Math.max(1, lastHigh - 60);
    try { await store.set(KEY_HIGH, JSON.stringify({ high: lowered, at: Date.now() })); } catch (e) {}
    log("no members found from " + start + "; lowering stored top to " + lowered + " to reconverge");
  }

  var record = {
    new7: new7,
    checkedAt: new Date().toISOString(),
    realMembersInspected: realSeen,
    idsChecked: idsChecked,
    highestFound: highestFound,
    startedFrom: start,
    partial: timedOut
  };
  await store.set(KEY_NEW7, JSON.stringify(record));

  // Write into the snapshot's totals.new7 (where the page reads it). Only if we actually
  // inspected members this run — never overwrite a good count with a 0 from a slow/empty run.
  var published = false;
  if (realSeen > 0) {
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
  }

  var report = Object.assign({ _v: FN_VERSION, ok: true, publishedToSnapshot: published, ms: Date.now() - started }, record);
  log("NEW7 DONE", JSON.stringify(report));
  return report;
}

async function peek() {
  var store = rdcStore(BLOB_STORE);
  var out = { _v: FN_VERSION };
  try { out.lastCount = JSON.parse(await store.get(KEY_NEW7)); } catch (e) {}
  try { out.highest = JSON.parse(await store.get(KEY_HIGH)); } catch (e) {}
  return out;
}

exports.handler = async function (event) {
  var q = (event && event.queryStringParameters) || {};
  if (q.version) return json(200, { _v: FN_VERSION, bdApiKeyConfigured: !!BD_KEY, window: WINDOW });
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
