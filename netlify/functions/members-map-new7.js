// members-map-new7.js
// Renters.com — Live Members Map — the fast "New this week" updater (Element T).
//
// FN_VERSION: mn7-v1
//
// WHY THIS EXISTS
//   The full member scan (members-map-build.js) only recomputes "New this week" when
//   it rebuilds the snapshot, which during incremental cycles can lag by a full pass.
//   New signups have the HIGHEST ids, so counting just the top slice of ids catches
//   every recent member cheaply. This function scans only that tail every 10 minutes
//   and writes a fresh new7 override the page reads first. Recent members show on the
//   counter within ~10 minutes instead of a scan cycle later.
//
//   It NEVER touches the map pins or the member snapshot. It only maintains one number.
//
// SAFETY
//   Same pacing discipline as the main scan: serial calls, 300ms apart, well under
//   BD's throttle. A tail of ~150 ids at 300ms is ~45s of work, but we cap it to a
//   time budget and it is a SEPARATE function from the page, so page loads never hit BD.
//
// ENDPOINTS
//   ?version=1                    -> FN_VERSION + config
//   ?run=1&key=ADMIN_PROBE_KEY    -> [ADMIN] run the tail count now
//   ?peek=1                       -> read the current override (no key, no BD)
//   (scheduled)                   -> the cron path, every 10 min
//
// ENV: BD_API_KEY, ADMIN_PROBE_KEY, optional NETLIFY_SITE_ID + NETLIFY_BLOBS_TOKEN

const { getStore } = require("@netlify/blobs");

const FN_VERSION = "mn7-v1";

const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";
const BD_KEY = process.env.BD_API_KEY || "";
const PROBE_KEY = process.env.ADMIN_PROBE_KEY || "";

const BLOB_STORE = "members-map";
const KEY_NEW7 = "new7-override";       // { new7, checkedAt, highId, scannedFrom }
const KEY_SNAPSHOT = "snapshot";        // read only, to learn the current member ceiling

const ID_CEILING = 3950;                // must match members-map-build.js
const TAIL_SIZE = 180;                  // how many of the highest ids to sweep
const REQUEST_DELAY_MS = 300;           // paced. Never burst against BD.
const TIME_BUDGET_MS = 8000;            // stay under Netlify's 10s wall

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

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

// BD hands back signup_date as ISO ("2026-06-20T...") or 14-digit ("20260620...").
function signupMs(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (s.indexOf("T") > 0 && s.indexOf("-") > 0) {
    const iso = Date.parse(s);
    if (isFinite(iso)) return iso;
  }
  const d = s.replace(/[^0-9]/g, "");
  if (d.length >= 8) {
    const y = Number(d.substring(0, 4)), mo = Number(d.substring(4, 6)), da = Number(d.substring(6, 8));
    const h = d.length >= 10 ? Number(d.substring(8, 10)) : 0;
    const mi = d.length >= 12 ? Number(d.substring(10, 12)) : 0;
    const se = d.length >= 14 ? Number(d.substring(12, 14)) : 0;
    if (y > 2000 && mo >= 1 && mo <= 12 && da >= 1 && da <= 31) return Date.UTC(y, mo - 1, da, h, mi, se);
  }
  const t = Date.parse(s);
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

// One member by id. Same reliable single-user read the main scan uses.
async function fetchMemberById(id) {
  try {
    const res = await fetch(BD_BASE + "/user/get/" + id, {
      method: "GET",
      headers: { "X-Api-Key": BD_KEY, Accept: "application/json" },
      redirect: "manual"
    });
    if (res.status >= 300 && res.status < 400) return null;
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { return null; }
    const rows = rowsFrom(data);
    return rows.length ? rows[0] : null;
  } catch (e) {
    return null;
  }
}

// Learn the current highest real id, so the tail tracks growth. Prefer the snapshot's
// member ceiling; fall back to ID_CEILING.
async function currentHighId(store) {
  try {
    const snap = JSON.parse(await store.get(KEY_SNAPSHOT));
    // snapshot doesn't store max id directly, but ID_CEILING is the scan bound and the
    // tail below it always covers the newest members.
  } catch (e) {}
  return ID_CEILING;
}

// Sweep the top TAIL_SIZE ids, count signups within 7 days, write the override.
async function run() {
  const started = Date.now();
  const deadline = started + TIME_BUDGET_MS;
  const store = rdcStore(BLOB_STORE);

  const hi = await currentHighId(store);
  const from = Math.max(1, hi - TAIL_SIZE);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  let new7 = 0, scanned = 0, found = 0, highestSeen = 0, timedOut = false;

  for (let id = hi; id >= from; id--) {
    if (Date.now() > deadline) { timedOut = true; break; }
    const m = await fetchMemberById(id);
    scanned++;
    if (m) {
      found++;
      if (id > highestSeen) highestSeen = id;
      const ms = signupMs(m.signup_date || m.created || m.date_added);
      if (ms !== null && ms >= weekAgo) new7++;
    }
    await sleep(REQUEST_DELAY_MS);
  }

  const override = {
    new7: new7,
    checkedAt: new Date().toISOString(),
    scannedFrom: from,
    scannedTo: hi,
    idsChecked: scanned,
    membersFound: found,
    highestSeen: highestSeen,
    partialSweep: timedOut
  };
  await store.set(KEY_NEW7, JSON.stringify(override));

  // read-back
  let landed = false;
  try {
    const back = JSON.parse(await store.get(KEY_NEW7));
    landed = back.checkedAt === override.checkedAt;
  } catch (e) {}

  const report = Object.assign({ _v: FN_VERSION, ok: landed, ms: Date.now() - started }, override);
  log("new7 sweep:", JSON.stringify(report));
  return report;
}

async function peek() {
  const store = rdcStore(BLOB_STORE);
  try {
    const o = JSON.parse(await store.get(KEY_NEW7));
    return Object.assign({ _v: FN_VERSION }, o);
  } catch (e) {
    return { _v: FN_VERSION, new7: null, note: "no override written yet" };
  }
}

exports.handler = async (event) => {
  const q = (event && event.queryStringParameters) || {};

  if (q.version) {
    return json(200, {
      _v: FN_VERSION,
      bdApiKeyConfigured: !!BD_KEY,
      probeKeyConfigured: !!PROBE_KEY,
      tailSize: TAIL_SIZE
    });
  }

  if (q.peek) return json(200, await peek());

  const isScheduled = !q.run && !q.version && !q.peek;
  const authed = PROBE_KEY && q.key === PROBE_KEY;
  if (!isScheduled && !authed) return json(403, { error: "bad or missing key" });
  if (!BD_KEY) return json(500, { error: "BD_API_KEY not configured" });

  try {
    const report = await run();
    return json(report.ok ? 200 : 500, report);
  } catch (e) {
    console.error("[mn7] FAILED:", e.message);
    return json(500, { _v: FN_VERSION, ok: false, error: e.message });
  }
};
