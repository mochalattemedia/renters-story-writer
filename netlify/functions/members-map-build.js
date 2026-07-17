// members-map-build.js
// Renters.com — Live Members Map (Element T) — the nightly snapshot builder.
//
// FN_VERSION: mmb-v22
//
// WHAT IT DOES
//   Reads every member from BD's bulk list endpoint, reduces them to ZIP COUNTS,
//   and writes a finished payload to a Netlify Blob. The public page reads the blob.
//   Precise member data never leaves this function.
//
// THE PRIVACY MODEL (locked in the Build Bible, Element T — do not loosen)
//   1. One pin per ZIP. Never one dot per member. There is no member in the payload.
//   2. No member IDs. No join dates. No per-member rows. Nothing to trace.
//   3. Type counts ship EXACT, down to 1. A count is a fact about a place.
//   4. newCount is FORCED TO 0 on any pin holding fewer than MIN_MEMBERS_FOR_NEW
//      members. A timestamp on a thin pin is a fact about a PERSON. Suppressed
//      here, server-side, so it never reaches the browser at all.
//   5. We geocode the ZIP to a CENTROID ourselves. A street-address-precise
//      coordinate never enters the pipeline because we never ask for one.
//
// BD COORDINATE RULE (Bible: the Colorado junk pile)
//   1,764 members sit on the identical fallback coordinate 38.7945952,-106.5348379.
//   NEVER trust BD's lat/lon blind. Use the stored coordinate ONLY when a zip is
//   present AND the coordinate is not the junk value. Otherwise geocode the zip.
//
// ENDPOINTS
//   ?version=1                        -> FN_VERSION + env check
//   ?probe=1&key=ADMIN_PROBE_KEY      -> [ADMIN] runs Open Thread #26. Hits BD's bulk
//                                        list, reports whether it works and what the
//                                        rows carry. Writes NOTHING.
//   ?build=1&key=ADMIN_PROBE_KEY      -> [ADMIN] full build, writes the snapshot.
//   ?warm=1&key=ADMIN_PROBE_KEY       -> [ADMIN] geocode-cache warming only, batched.
//   ?filters=1&key=ADMIN_PROBE_KEY    -> [ADMIN] filter ladder. BD's list REQUIRES a
//                                        property filter; unfiltered calls 400 with
//                                        "user not found". This finds the column and
//                                        operator BD will actually accept.
//   ?raw=1&p=/path&key=ADMIN_PROBE_KEY-> [ADMIN] passthrough. Returns BD's unmodified
//                                        JSON for any path. The artifact, not the config.
//   (scheduled)                       -> full build, nightly via netlify.toml
//
// ENV: BD_API_KEY, ADMIN_PROBE_KEY, GOOGLE_MAPS_API_KEY,
//      optional NETLIFY_SITE_ID + NETLIFY_BLOBS_TOKEN

const { getStore } = require("@netlify/blobs");

const FN_VERSION = "mmb-v22";
// ⚠️ Bump STATE_SCHEMA *only* when the shape of the checkpoint (emptyState) changes.
// loadProgress keys off THIS, not FN_VERSION. mmb-v20 nuked a 24-hour scan because
// loadProgress discarded progress whenever FN_VERSION changed — but a code bump that
// does not change the state shape must NOT throw away a good in-progress scan.
const STATE_SCHEMA = "s1";

const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";
const BD_KEY = process.env.BD_API_KEY || "";
const GKEY = process.env.GOOGLE_MAPS_API_KEY || "";
const PROBE_KEY = process.env.ADMIN_PROBE_KEY || "";

// BD member category IDs (confirmed live, Bible Element T)
const TYPE_BY_PROFESSION = {
  5: "realtors",
  6: "propertyManagers",
  19: "landlords",
  20: "renters"
};

// The Colorado fallback. 1,764 members sit on it. It is not a location.
const JUNK_LAT = 38.7945952;
const JUNK_LON = -106.5348379;
const JUNK_EPS = 0.0005;

// A pin below this many members carries NO new-this-week signal. See privacy model.
const MIN_MEMBERS_FOR_NEW = 3;

// --- scan pacing + runtime limits (restored; were clipped with the old pager) ---
const REQUEST_DELAY_MS = 300;  // mmb-v22: was 650. One paced batch per cron wake is not a flood, so we can go faster. If BD 400s reappear (throttle), raise back to 650.              // ~92 req/min. Do not lower. BD throttles bursts.
const TIME_BUDGET_MS = 20000;  // mmb-v22: was 8000. Scheduled (cron) invocations get more headroom than the 10s synchronous limit, so each wake clears far more ids.               // checkpoint + hand back before Netlify's 10s kill
const MAX_CHAIN = 200;                      // ⚠️ UNUSED since v20. Kept to avoid a ReferenceError if referenced elsewhere. The cron drives; wake count grows without bound by design.
const SELF_URL = process.env.URL || "https://renters-story-writer.netlify.app";

// Bounded per-run geocoding so a scheduled run can never time out. Unknown zips
// left over get picked up on the next run. Self-healing.
const MAX_GEOCODE_PER_RUN = 120;
const MAX_GEOCODE_PER_WARM = 400;

let   PAGE_LIMIT = 100;  // BD rows per page. Discovery may lower this.
const PAGE_BATCH = 1;     // ⚠️ SERIAL. BD rate-limits. See the banner below.
// ⚠️ mmb-v12 BUG FIX. This was 60. At limit 50, 3,873 members is 78 PAGES, so the
// build stopped at page 60, read ~3,000 members, and reported SUCCESS. A silent
// truncation that would have shipped a map missing 800 people with a green light on
// it. Any cap on a paged read is a landmine. Set it far above the real ceiling and
// let BD's own total_pages do the stopping.
const MAX_PAGES = 400;

const BLOB_STORE = "members-map";
const KEY_SNAPSHOT = "snapshot";
const KEY_ZIPCACHE = "zipcache";
const KEY_LISTPATH = "listpath";
const KEY_PROGRESS = "progress";

// ---------------------------------------------------------------------------
// Blobs — explicit siteID/token fallback. getStore() does NOT throw on creation,
// only on read/write, which makes silent failures easy. (Bible, Netlify Blobs.)
// ---------------------------------------------------------------------------
function rdcStore(name) {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) return getStore({ name, siteID, token });
  return getStore(name);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function json(status, body) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify(body, null, 2)
  };
}

function log() {
  console.log.apply(console, ["[mmb]"].concat(Array.prototype.slice.call(arguments)));
}

// Normalize whatever BD hands back into a clean 5-digit US zip, or "".
function zip5(raw) {
  if (raw === null || raw === undefined) return "";
  let s = String(raw).trim();
  if (!s) return "";
  s = s.split("-")[0];
  let d = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c >= "0" && c <= "9") d += c;
  }
  if (d.length === 4) d = "0" + d;          // leading zero eaten somewhere upstream
  if (d.length > 5) d = d.substring(0, 5);
  return d.length === 5 ? d : "";
}

function isJunkCoord(lat, lon) {
  if (lat === null || lon === null) return false;
  return Math.abs(lat - JUNK_LAT) < JUNK_EPS && Math.abs(lon - JUNK_LON) < JUNK_EPS;
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

// BD hands back signup_date in TWO shapes, depending on where you read it:
//   - the API list/get returns ISO:      "2024-10-21T00:10:31+00:00"
//   - the admin CSV export returns:      "20241021001031"
// Handle both. ISO first, because it carries an explicit timezone.
function signupMs(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  if (s.indexOf("T") > 0 && s.indexOf("-") > 0) {
    const iso = Date.parse(s);
    if (isFinite(iso)) return iso;
  }

  const digits = s.replace(/[^0-9]/g, "");
  if (digits.length >= 8) {
    const y = Number(digits.substring(0, 4));
    const mo = Number(digits.substring(4, 6));
    const d = Number(digits.substring(6, 8));
    const h = digits.length >= 10 ? Number(digits.substring(8, 10)) : 0;
    const mi = digits.length >= 12 ? Number(digits.substring(10, 12)) : 0;
    const se = digits.length >= 14 ? Number(digits.substring(12, 14)) : 0;
    if (y > 2000 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return Date.UTC(y, mo - 1, d, h, mi, se);
    }
  }
  const t = Date.parse(s);
  return isFinite(t) ? t : null;
}

function typeOf(member) {
  const pid = num(member.profession_id);
  if (pid !== null && TYPE_BY_PROFESSION[pid]) return TYPE_BY_PROFESSION[pid];
  return null; // uncategorized. Counted in totals, never guessed at.
}

// ---------------------------------------------------------------------------
// BD bulk member list
// Never follow BD's redirect. It bounces to the admin dashboard when auth is not
// accepted, which turns an auth failure into a confusing HTML 200. (Bible.)
// ---------------------------------------------------------------------------
async function bdGet(path) {
  const url = BD_BASE + path;
  const res = await fetch(url, {
    method: "GET",
    headers: { "X-Api-Key": BD_KEY, Accept: "application/json" },
    redirect: "manual"
  });

  if (res.status >= 300 && res.status < 400) {
    throw new Error("BD redirected (" + res.status + ") on " + path + " — auth was NOT accepted. Check BD_API_KEY and its GET permission on users_data.");
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error("BD " + res.status + " on " + path + " :: " + text.slice(0, 300));
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error("BD returned non-JSON on " + path + " :: " + text.slice(0, 300));
  }
  return data;
}

// BD wraps rows differently in different places. Find the array, wherever it is.
function rowsFrom(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.message)) return data.message;
  if (Array.isArray(data.data)) return data.data;
  if (data.message && Array.isArray(data.message.data)) return data.message.data;
  if (data.message && Array.isArray(data.message.users)) return data.message.users;
  return [];
}

function metaFrom(data) {
  const m = (data && data.message && typeof data.message === "object" && !Array.isArray(data.message)) ? data.message : data;
  return {
    total: num(m && m.total),
    current_page: num(m && m.current_page),
    total_pages: num(m && m.total_pages)
  };
}


// ---------------------------------------------------------------------------
// ⭐ BD'S BULK MEMBER LIST — SOLVED (Open Thread #26, July 14)
//
// THE TRAP: BD's `page` parameter is NOT an integer. It is an opaque CURSOR.
//   next_page: "MipfKjI1"   ->  base64 decode  ->  "2*_*25"
//   i.e.  base64( "<page>*_*<limit>" )
//
// Send page=1 and BD feeds "1" to a base64 decoder, gets garbage, and replies
//   HTTP 400 {"status":"error","message":"user not found"}
// That message is a LIE about the cause. It cost us an entire probe cycle chasing
// a filter problem that never existed. The filters were fine. The cursor was wrong.
//
// The envelope was telling us the truth the whole time. Even /user/get/3664 came
// back carrying  total: 3871, total_pages: 155, next_page: "MipfKjI1".
// A single-member GET was reporting global pagination. That was the tell.
//
// LESSON (for the Bible): when a vendor's error message names a cause, verify the
// cause. BD said "user not found" about a request that had nothing to do with a
// user being found.
// ---------------------------------------------------------------------------

// Soft fetch. NEVER throws. Returns the whole story: HTTP code, BD's own message,
// the parsed rows, the pagination meta, and the raw body. Everything that reads BD
// defensively (the pager, the retries, the probes) goes through this.
//
// mmb-v9: this function was accidentally deleted in the v8 rewrite. Five call sites
// referenced it and the build died with "bdTry is not defined". Restored.
async function bdTry(path) {
  try {
    const res = await fetch(BD_BASE + path, {
      method: "GET",
      headers: { "X-Api-Key": BD_KEY, Accept: "application/json" },
      redirect: "manual"
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) {}
    return {
      path: path,
      httpStatus: res.status,
      redirected: res.status >= 300 && res.status < 400,
      bdStatus: data && data.status,
      bdMessage: data && typeof data.message === "string" ? data.message : undefined,
      rows: data ? rowsFrom(data).length : 0,
      meta: data ? metaFrom(data) : null,
      raw: data,
      snippet: data ? undefined : text.slice(0, 200)
    };
  } catch (e) {
    return { path: path, error: e.message, rows: 0 };
  }
}

// ---------------------------------------------------------------------------
// ⭐ THE REAL ANSWER (mmb-v16): SCAN BY ID. There is no list endpoint.
//
// The BD API docs (Website_API.txt) are unambiguous:
//     GET  /user/get/{user_id}   "Read the data of a SINGLE user"
//     POST /user/search          "Search Users"   <- the only bulk read, and POST
//
// /user/get has NO list form. Every ?page= call we made for fifteen versions was
// the single-user endpoint ignoring our query string and flailing. The "cursor",
// the "dead pages", the "44% failure", the "throttle that comes and goes" — much of
// that was an unsupported endpoint being poked in an undocumented way.
//
// POST /user/search is the intended bulk read, but its filter-body format is not in
// the docs, our key lacks POST on users_data, and guessing a POST body is exactly
// the hole we just climbed out of.
//
// So we use the ONE call BD documents, permits, and has never failed: GET the user
// by ID. IDs are contiguous 1..~3880. No cursors. No pagination. No list. Paced,
// resumable, chained. Boring and complete.
//
// LESSON FOR THE BIBLE: before reverse-engineering an endpoint's behaviour, confirm
// the endpoint EXISTS in the shape you are using. We treated /user/get as a list for
// an entire day. It was never a list. Read the docs before the third workaround, not
// after the fifteenth.
// ---------------------------------------------------------------------------

// One member by ID. The only bulk-read primitive on this platform. Documented,
// permitted, and 100% reliable all day. Two tries; a persistent null = deleted ID.
async function fetchMemberById(id) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await bdTry("/user/get/" + id);
    if (r.rows > 0) return rowsFrom(r.raw)[0];
    // A miss here is almost always a deleted member (gaps in the ID sequence are
    // normal). Only retry once, briefly, in case it was a blip.
    if (attempt === 1) await sleep(REQUEST_DELAY_MS);
  }
  return null;
}

// mmb-v18: the old findMaxId probed downward from 4200 at 650ms per call BEFORE the
// scan even started. On the live system, with real gaps in the ID sequence, that
// could eat the entire Netlify budget and 502 before checkpointing. It caused the
// first live 502.
//
// The scan does NOT need a precise ceiling. We KNOW the max is ~3,880 (BD total was
// 3,879 all day). Set a fixed generous ceiling and let the scan walk to it. Empty
// IDs cost one fast 400 each and are simply skipped. New signups above the ceiling
// get picked up when the ceiling is bumped, but we set it high enough that this is
// years away.
const ID_CEILING = 3950;  // mmb-v22: was 4200. Real max id ~3880; no point walking 300+ empty ids at the tail every fill.
function findMaxId() {
  return ID_CEILING;
}

// ---------------------------------------------------------------------------
// SCAN BY ID — the whole read, resumable. Walks id = nextId .. maxId, paced.
// ---------------------------------------------------------------------------
function emptyState() {
  return {
    v: FN_VERSION,
    schema: STATE_SCHEMA,
    startedAt: new Date().toISOString(),
    maxId: 0,
    nextId: 1,
    bdTotal: null,
    seen: {},
    byZip: {},
    deletedIds: 0,
    totals: {
      members: 0, renters: 0, landlords: 0, propertyManagers: 0, realtors: 0,
      uncategorized: 0, new7: 0, placed: 0, unplaced: 0, onJunkCoordinate: 0
    },
    chain: 0,
    phase: "scanning"
  };
}

// Fold one member record into the running zip buckets. Called during the scan so we
// never hold thousands of full records in memory or in a Blob.
function foldMember(state, m, weekAgo) {
  const id = num(m.user_id);
  if (id === null || state.seen[id]) return;
  state.seen[id] = 1;

  state.totals.members++;

  const t = typeOf(m);
  if (t) state.totals[t]++; else state.totals.uncategorized++;

  const ms = signupMs(m.signup_date);
  const isNew = ms !== null && ms >= weekAgo;
  if (isNew) state.totals.new7++;

  const z = zip5(m.zip_code);
  if (!z) { state.totals.unplaced++; return; }
  state.totals.placed++;

  if (!state.byZip[z]) {
    state.byZip[z] = { renters: 0, landlords: 0, propertyManagers: 0, realtors: 0, total: 0, newCount: 0, labels: {}, coord: null };
  }
  const b = state.byZip[z];
  b.total++;
  if (t) b[t]++;
  if (isNew) b.newCount++;

  const city = (m.city || "").trim();
  const st = (m.state_code || "").trim();
  if (city && st) {
    const lbl = city + ", " + st.toUpperCase();
    b.labels[lbl] = (b.labels[lbl] || 0) + 1;
  }

  // BD's coordinate is trusted ONLY when a zip is present and it is not the Colorado
  // junk fallback. mz-v4 wrote real centroids for gated members, so this is usually
  // a free correct centroid with no geocode call.
  if (!b.coord) {
    const la = num(m.lat), lo = num(m.lon);
    if (la !== null && lo !== null && !isJunkCoord(la, lo)) {
      b.coord = [Number(la.toFixed(5)), Number(lo.toFixed(5))];
    } else if (isJunkCoord(la, lo)) {
      state.totals.onJunkCoordinate++;
    }
  }
}

async function scanById(store, state, deadline) {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  if (!state.maxId) {
    state.maxId = findMaxId();
    state.bdTotal = state.maxId; // rough; real member count is state.totals.members
    state.nextId = 1;
    await store.set(KEY_PROGRESS, JSON.stringify(state));
  }

  while (state.nextId <= state.maxId) {
    if (Date.now() > deadline) {
      await store.set(KEY_PROGRESS, JSON.stringify(state));
      return { done: false };
    }
    const id = state.nextId;
    if (!state.seen[id]) {
      const m = await fetchMemberById(id);
      if (m) { foldMember(state, m, weekAgo); }
      else { state.deletedIds = (state.deletedIds || 0) + 1; state.seen[id] = 1; }
      await sleep(REQUEST_DELAY_MS);
    }
    state.nextId++;
  }

  state.phase = "geocode";
  await store.set(KEY_PROGRESS, JSON.stringify(state));
  return { done: true };
}

// Geocode a ZIP to its centroid. POSTAL CODE ONLY — no street address is ever sent
// and none can come back. ~90 sq mi granularity, coarse by construction.
async function geocodeZip(z) {
  if (!GKEY) return null;
  const url = "https://maps.googleapis.com/maps/api/geocode/json?components=" +
    encodeURIComponent("postal_code:" + z + "|country:US") + "&key=" + GKEY;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== "OK" || !data.results || !data.results.length) return null;
    const loc = data.results[0].geometry && data.results[0].geometry.location;
    if (!loc) return null;
    return [Number(loc.lat.toFixed(5)), Number(loc.lng.toFixed(5))];
  } catch (e) {
    log("geocode error", z, e.message);
    return null;
  }
}

async function loadZipCache(store) {
  try {
    const raw = await store.get(KEY_ZIPCACHE);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    log("zipcache empty or unreadable:", e.message);
    return {};
  }
}

// Re-invoke self so one call finishes the whole scan and the nightly cron fires once.
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function chainSelf(key, chain) {
  const url = SELF_URL + "/.netlify/functions/members-map-build?build=1&chain=" + chain +
              "&key=" + encodeURIComponent(key);
  log("chaining -> link", chain);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1200);
    await fetch(url, { signal: ctrl.signal }).catch(() => {});
    clearTimeout(t);
  } catch (e) { /* aborting our own wait is expected */ }
}

async function loadProgress(store, fresh) {
  if (fresh) return emptyState();
  try {
    const raw = await store.get(KEY_PROGRESS);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    // Discard ONLY when the checkpoint SHAPE is incompatible, not on every code bump.
    if (s.schema !== STATE_SCHEMA) { log("progress schema changed (" + s.schema + " -> " + STATE_SCHEMA + "), starting fresh"); return emptyState(); }
    if (s.v !== FN_VERSION) { log("resuming a scan started under " + s.v + " (schema compatible)"); s.v = FN_VERSION; }
    return s;
  } catch (e) { return emptyState(); }
}

// ---------------------------------------------------------------------------
// THE BUILD
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// THE BUILD — resumable, CRON-DRIVEN (mmb-v19).
//
// ⚠️ WHY THIS CHANGED FROM v18: v18 self-chained — each invocation re-invoked itself
// to beat Netlify's 10s limit. The chained runs OVERLAPPED and STACKED (observed
// chainLink 64 in ~8 min), which flooded BD's rate limit. BD then returned
// 400 "user not found" for members that exist, and the scan read 318/319 real
// members as "deleted." The engine was fine; the RUNNER flooded the throttle.
//
// v19: THE CRON IS THE CLOCK. Each invocation does ONE bounded batch (paced,
// ~8s of work), checkpoints to the Blob, and EXITS. It never re-invokes itself.
// The Netlify schedule (netlify.toml, every 10 min) is what advances it. BD only
// ever sees ~10-12 paced calls per wake, then silence. It cannot flood, so it
// cannot throttle.
//
// FILL MATH: ~3,880 ids, ~10 ids per wake, every 10 min => full fill in ~2-3 days.
// Then steady state is nearly free: each wake finds nothing new above the last id.
//
// MANUAL CONTROLS (admin, key-gated):
//   ?build=1         do ONE batch now (for testing). Does NOT chain.
//   ?build=1&fresh=1 reset progress and start the scan over.
//   ?status=1        watch progress (Blobs only, safe to spam).
//   (scheduled)      the cron path — one batch per wake, the real driver.
// ---------------------------------------------------------------------------
// Build a snapshot payload from whatever is currently in state. Used BOTH for the
// incremental writes during scanning (mmb-v22, so the map shows partial pins as it
// fills) and for the final complete snapshot. Only zips that already have a coord
// become pins; the rest wait for the geocode pass. Enforces the new-this-week
// suppression on thin pins server-side.
function buildSnapshotFromState(state) {
  const pins = [];
  let suppressedNew = 0, unresolvedZips = 0;
  for (const z of Object.keys(state.byZip)) {
    const b = state.byZip[z];
    if (!b.coord) { unresolvedZips++; continue; }
    let newCount = b.newCount;
    if (b.total < MIN_MEMBERS_FOR_NEW && newCount > 0) { suppressedNew += newCount; newCount = 0; }
    let label = "", best = 0;
    for (const k of Object.keys(b.labels)) if (b.labels[k] > best) { best = b.labels[k]; label = k; }
    pins.push([z, label, b.coord[0], b.coord[1], b.renters, b.landlords, b.propertyManagers, b.realtors, newCount]);
  }
  pins.sort((a, b) => (b[4] + b[5] + b[6] + b[7]) - (a[4] + a[5] + a[6] + a[7]));
  return {
    snapshot: {
      v: FN_VERSION,
      builtAt: new Date().toISOString(),
      partial: state.phase !== "done",
      totals: {
        members: state.totals.members, renters: state.totals.renters,
        landlords: state.totals.landlords, propertyManagers: state.totals.propertyManagers,
        realtors: state.totals.realtors, new7: state.totals.new7,
        placed: state.totals.placed, unplaced: state.totals.unplaced
      },
      pinCount: pins.length,
      schema: ["zip", "label", "lat", "lon", "renters", "landlords", "propertyManagers", "realtors", "newCount"],
      pins: pins
    },
    suppressedNew: suppressedNew,
    unresolvedZips: unresolvedZips
  };
}

async function build(opts) {
  const warmOnly = !!(opts && opts.warmOnly);
  const fresh = !!(opts && opts.fresh);
  const noChain = !!(opts && opts.noChain);
  const key = (opts && opts.key) || "";
  const started = Date.now();
  const deadline = started + TIME_BUDGET_MS;

  const store = rdcStore(BLOB_STORE);
  const state = await loadProgress(store, fresh);
  // wakeCount is just an operational counter now. mmb-v20 REMOVED the MAX_CHAIN
  // guard: it existed to stop runaway SELF-CHAINING, but v19 made the CRON the
  // driver, so the wake count legitimately grows forever. The guard was tripping at
  // 200 wakes (~33h) and freezing a healthy scan mid-fill. A cron-driven job has no
  // runaway to guard against — each wake is one bounded batch that exits on its own.
  state.chain = (state.chain || 0) + 1;

  // ---- PHASE 1: read every member BY ID, resumable ----
  if (state.phase === "scanning") {
    const r = await scanById(store, state, deadline);
    if (!r.done) {
      // mmb-v22: write a PARTIAL snapshot each wake so the map shows pins WHILE it
      // fills, instead of blank until 100%. Seed coords from the cache first (free),
      // then publish whatever has coords. No mid-scan geocoding — keeps the wake fast.
      try {
        const cache = await loadZipCache(store);
        for (const z of Object.keys(state.byZip)) {
          const b = state.byZip[z];
          if (b.coord && !cache[z]) cache[z] = b.coord;
          if (!b.coord && cache[z]) b.coord = cache[z];
        }
        const built = buildSnapshotFromState(state);
        if (built.snapshot.pins.length > 0) {
          await store.set(KEY_SNAPSHOT, JSON.stringify(built.snapshot));
        }
      } catch (e) { log("partial snapshot write skipped:", e.message); }

      // mmb-v19: NO self-chaining. The scheduled cron re-invokes us. See header.
      const scanned = state.nextId - 1;
      const pct = state.maxId ? Math.round((scanned / state.maxId) * 100) : 0;
      return {
        ok: true, done: false, _v: FN_VERSION, phase: "scanning",
        progress: scanned + " / " + state.maxId + " ids (" + pct + "%)",
        membersSoFar: state.totals.members,
        placedSoFar: state.totals.placed,
        deletedIds: state.deletedIds,
        chainLink: state.chain,
        NOTE: noChain ? "chaining off, call ?build=1 again" : "running in the background. Poll ?status=1.",
        ms: Date.now() - started
      };
    }
  }

  // ---- PHASE 3: coordinates. Cache first, geocode only what is unknown. ----
  const cache = await loadZipCache(store);
  const cacheBefore = Object.keys(cache).length;

  for (const z of Object.keys(state.byZip)) {
    const b = state.byZip[z];
    if (b.coord && !cache[z]) cache[z] = b.coord;   // seed the cache off mz-v4's centroids, free
    if (!b.coord && cache[z]) b.coord = cache[z];
  }

  const pending = Object.keys(state.byZip).filter((z) => !state.byZip[z].coord);
  const budget = warmOnly ? MAX_GEOCODE_PER_WARM : MAX_GEOCODE_PER_RUN;
  const toDo = pending.slice(0, budget);
  log("zips:", Object.keys(state.byZip).length, "| cached:", cacheBefore, "| need geocode:", pending.length, "| doing:", toDo.length);

  for (let i = 0; i < toDo.length; i += 8) {
    const slice = toDo.slice(i, i + 8);
    const got = await Promise.all(slice.map((z) => geocodeZip(z)));   // Google, not BD. Parallel is fine here.
    for (let j = 0; j < slice.length; j++) {
      if (got[j]) { cache[slice[j]] = got[j]; state.byZip[slice[j]].coord = got[j]; }
    }
  }
  await store.set(KEY_ZIPCACHE, JSON.stringify(cache));

  if (warmOnly) {
    await store.set(KEY_PROGRESS, JSON.stringify(state));
    return {
      ok: true, done: true, mode: "warm", _v: FN_VERSION,
      membersRead: state.totals.members,
      zipsSeen: Object.keys(state.byZip).length,
      zipCacheSize: Object.keys(cache).length,
      geocodedThisRun: toDo.length,
      stillMissing: Math.max(0, pending.length - toDo.length),
      ms: Date.now() - started
    };
  }

  // ---- PHASE 4: the pins. The privacy rule is enforced HERE, server-side. ----
  const pins = [];
  let suppressedNew = 0;
  let unresolvedZips = 0;

  for (const z of Object.keys(state.byZip)) {
    const b = state.byZip[z];
    if (!b.coord) { unresolvedZips++; continue; }

    // THE ONE SUPPRESSION. A count is a fact about a place. A timestamp on a thin
    // pin is a fact about a PERSON. Zeroed here so it never reaches the browser and
    // cannot be read out of the payload.
    let newCount = b.newCount;
    if (b.total < MIN_MEMBERS_FOR_NEW && newCount > 0) { suppressedNew += newCount; newCount = 0; }

    let label = "", best = 0;
    for (const k of Object.keys(b.labels)) if (b.labels[k] > best) { best = b.labels[k]; label = k; }

    pins.push([z, label, b.coord[0], b.coord[1], b.renters, b.landlords, b.propertyManagers, b.realtors, newCount]);
  }

  pins.sort((a, b) => (b[4] + b[5] + b[6] + b[7]) - (a[4] + a[5] + a[6] + a[7]));

  const snapshot = {
    v: FN_VERSION,
    builtAt: new Date().toISOString(),
    totals: {
      members: state.totals.members,
      renters: state.totals.renters,
      landlords: state.totals.landlords,
      propertyManagers: state.totals.propertyManagers,
      realtors: state.totals.realtors,
      new7: state.totals.new7,
      placed: state.totals.placed,
      unplaced: state.totals.unplaced
    },
    pinCount: pins.length,
    schema: ["zip", "label", "lat", "lon", "renters", "landlords", "propertyManagers", "realtors", "newCount"],
    pins: pins
  };

  await store.set(KEY_SNAPSHOT, JSON.stringify(snapshot));

  // READ IT BACK. Every write, every time. (Bible, Workflow Rule 15.)
  let landed = false, landedPins = 0;
  try {
    const back = JSON.parse(await store.get(KEY_SNAPSHOT));
    landedPins = (back.pins || []).length;
    landed = back.builtAt === snapshot.builtAt && landedPins === pins.length;
  } catch (e) { log("READ-BACK FAILED:", e.message); }
  if (!landed) console.error("[mmb] SNAPSHOT DID NOT LAND. Wrote " + pins.length + " pins, read back " + landedPins + ".");

  // Clear the checkpoint so the next run starts clean.
  await store.set(KEY_PROGRESS, JSON.stringify(emptyState()));

  const report = {
    ok: landed,
    done: true,
    _v: FN_VERSION,
    builtAt: snapshot.builtAt,
    landed: landed,
    idsScanned: state.maxId,
    membersFound: state.totals.members,
    deletedOrEmptyIds: state.deletedIds,
    totals: snapshot.totals,
    pins: pins.length,
    zipsUnresolved: unresolvedZips,
    zipCacheSize: Object.keys(cache).length,
    geocodedThisRun: toDo.length,
    geocodeStillPending: Math.max(0, pending.length - toDo.length),
    newSuppressedOnThinPins: suppressedNew,
    membersStillOnJunkCoordinate: state.totals.onJunkCoordinate,
    uncategorizedMembers: state.totals.uncategorized,
    ms: Date.now() - started
  };
  log("BUILD DONE", JSON.stringify(report));
  return report;
}

// ---------------------------------------------------------------------------
// CURSOR WALK (mmb-v7)
//
// THE CONTRADICTION WE ARE RESOLVING:
//   /user/get?page=MipfKjI1   (base64 "2*_*25")  RETURNED 25 ROWS. Proven, logged.
//   That same response carried  prev_page: "MSpfKjI1"  (base64 "1*_*25").
//   /user/get?page=MSpfKjI1   NOW RETURNS HTTP 400.
//
// BD is rejecting a token BD itself issued. Two explanations, different fixes:
//   (a) PAGE 1 IS SPECIAL. BD serves pages 2..N by cursor but will not accept its
//       own page-1 token. Fix: fetch page 1 some other way, cursor the rest.
//   (b) THE GROUND MOVED. Rate limit, key scope, anything. Then page 2 fails too
//       and the whole cursor theory rests on a result that no longer reproduces.
//
// MipfKjI1 is the CONTROL. If the control fails, stop and rethink. Do not build a
// map on a result that will not reproduce.
// ---------------------------------------------------------------------------
async function rawPassthrough(p) {
  if (!p || p.charAt(0) !== "/") return { error: "p must be a path starting with /" };
  const r = await bdTry(p);
  return { _v: FN_VERSION, path: p, http: r.httpStatus, rowsParsed: r.rows, meta: r.meta, raw: r.raw };
}

async function probe() {
  // mmb-v16: the map reads members by ID (GET /user/get/{id}), the only bulk-read
  // primitive BD documents and permits. This probe confirms that path and the shape
  // of a member row. No pagination, no cursors — those were never real.
  const out = { _v: FN_VERSION, method: "GET /user/get/{id} (documented single-user read)" };
  const sampleIds = [50, 3664, 3800];
  out.samples = [];
  for (const id of sampleIds) {
    const r = await bdTry("/user/get/" + id);
    const row = r.rows ? rowsFrom(r.raw)[0] : null;
    out.samples.push({
      id: id,
      http: r.httpStatus,
      found: !!row,
      user_id: row && row.user_id,
      profession_id: row && row.profession_id,
      zip_code: row && row.zip_code,
      city: row && row.city,
      state_code: row && row.state_code,
      onJunkCoordinate: row ? isJunkCoord(num(row.lat), num(row.lon)) : null,
      signup_date: row && row.signup_date
    });
    await sleep(400);
  }
  const ok = out.samples.filter((s) => s.found).length;
  out.READ_PATH_WORKS = ok > 0;
  out.HAS_MAP_FIELDS = out.samples.some((s) => s.found && s.zip_code !== undefined && s.profession_id !== undefined);
  out.verdict = ok + "/" + sampleIds.length + " sample ids read. Scan by ID is the build path.";
  return out;
}

// ---------------------------------------------------------------------------
// STATUS — watch the build without touching it. Safe to refresh as often as you like.
// ---------------------------------------------------------------------------
async function status() {
  const store = rdcStore(BLOB_STORE);
  let prog = null, snap = null;
  try { prog = JSON.parse(await store.get(KEY_PROGRESS)); } catch (e) {}
  try {
    const s = JSON.parse(await store.get(KEY_SNAPSHOT));
    snap = { builtAt: s.builtAt, pins: (s.pins || []).length, totals: s.totals, v: s.v };
  } catch (e) {}

  const scanned = prog ? (prog.nextId - 1) : 0;
  const pct = prog && prog.maxId ? Math.round((scanned / prog.maxId) * 100) : 0;
  return {
    _v: FN_VERSION,
    running: !!(prog && prog.phase !== "done" && prog.phase),
    phase: prog ? prog.phase : "no build has run",
    progress: prog && prog.maxId ? scanned + " / " + prog.maxId + " ids (" + pct + "%)" : null,
    membersSoFar: prog && prog.totals ? prog.totals.members : 0,
    placedSoFar: prog && prog.totals ? prog.totals.placed : 0,
    zipsSoFar: prog && prog.byZip ? Object.keys(prog.byZip).length : 0,
    deletedOrEmptyIds: prog ? (prog.deletedIds || 0) : 0,
    chainLink: prog ? prog.chain : 0,
    LIVE_SNAPSHOT: snap || "none yet"
  };
}

exports.handler = async (event) => {
  const q = (event && event.queryStringParameters) || {};

  if (q.version) {
    return json(200, {
      _v: FN_VERSION,
      bdApiKeyConfigured: !!BD_KEY,
      googleKeyConfigured: !!GKEY,
      probeKeyConfigured: !!PROBE_KEY,
      blobsExplicitAuth: !!(process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN),
      minMembersForNewFlag: MIN_MEMBERS_FOR_NEW
    });
  }

  // The SCHEDULED invocation has no query string. That is the cron doing one batch.
  // Everything else is an admin call and must carry the key (except read-only status).
  const isScheduled = !q.probe && !q.build && !q.warm && !q.filters && !q.raw && !q.status && !q.version;
  const authed = PROBE_KEY && q.key === PROBE_KEY;

  if (!isScheduled && !authed && !q.status) return json(403, { error: "bad or missing key" });
  if (!BD_KEY) return json(500, { error: "BD_API_KEY not configured" });

  try {
    if (q.status) return json(200, await status());
    if (q.probe) return json(200, await probe());
    if (q.raw) return json(200, await rawPassthrough(q.p));
    if (q.warm) return json(200, await build({ warmOnly: true, fresh: !!q.fresh }));

    // Scheduled (cron) OR manual ?build=1 — both run exactly ONE bounded batch and
    // exit. No self-chaining. The cron schedule advances the scan across wakes.
    const report = await build({ fresh: !!q.fresh });
    if (isScheduled) log("scheduled batch done:", report.phase || "?", report.progress || report.membersFound || "");
    return json(report.ok ? 200 : 500, report);
  } catch (e) {
    console.error("[mmb] FAILED:", e.message);
    return json(500, { _v: FN_VERSION, ok: false, error: e.message });
  }
};
