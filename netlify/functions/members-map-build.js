// members-map-build.js
// Renters.com — Live Members Map (Element T) — the nightly snapshot builder.
//
// FN_VERSION: mmb-v12
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

const FN_VERSION = "mmb-v12";

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

// base64( "<page>*_*<limit>" ) — BD's cursor format, reproduced.
function cursor(page, limit) {
  return Buffer.from(String(page) + "*_*" + String(limit), "utf8").toString("base64");
}

function listPath(page, limit) {
  return "/user/get?page=" + encodeURIComponent(cursor(page, limit));
  // ⚠️ NEVER add &limit= here. The limit lives INSIDE the cursor. Sending it again
  // as its own query param makes BD 400 the entire request (mmb-v5 did this).
}

// ---------------------------------------------------------------------------
// ⚠️⚠️⚠️  BD RATE-LIMITS THE API, AND CALLS IT "user not found".
//
// This cost us three versions. Read it before you touch the pager.
//
// The mmb-v7 cursor walk fired ten calls back to back:
//     call 1  page2     200 ✓        call 6  page10    400 ✗
//     call 2  page1     400 ✗        call 7  page10    400 ✗
//     call 3  page3     200 ✓        call 8  page155   200 ✓
//     call 4  page4     200 ✓        call 9  limit100  400 ✗
//     call 5  page9     400 ✗        call 10 limit50   200 ✓
//
// We read that as "some pages are broken." IT IS NOT. It is a throttle. Roughly
// half of a rapid burst gets rejected. Proof: a SINGLE call to page 1 in isolation
// works; page 155 (deep, padded token, generated by us) works; and mmb-v8, which
// fired EIGHT pages in parallel, got almost nothing back.
//
// BD reports the throttle as HTTP 400 {"message":"user not found"}. There is no
// missing user. There is no bad cursor. There is a rate limit wearing a costume.
//
// THIS IS THE THIRD TIME BD HAS NAMED A CAUSE THAT WAS NOT THE CAUSE:
//   - {"result_status":"no-swal"}   = "show no popup", not "saved"
//   - /user/update 200              = "accepted", not "stored in the right table"
//   - 400 "user not found"          = "slow down", not "no such user"
// BD's responses describe what BD feels like saying. Trust the artifact, never the
// message.
//
// THE PAGER, ACCORDINGLY:
//   1. SERIAL. One call at a time. No parallelism, ever.
//   2. A deliberate delay between calls.
//   3. Exponential backoff on failure, because a 400 here means "wait", not "stop".
//   4. RESUMABLE. Progress is checkpointed to a Blob after every page, so a 10s
//      function timeout costs us nothing. Call it again and it picks up where it
//      stopped. This also means the nightly cron cannot fail halfway and leave a
//      half-built map.
// ---------------------------------------------------------------------------
const REQUEST_DELAY_MS = 320;   // between BD calls. Politeness is the feature.
// mmb-v12: was 4 retries at 600/1600/4000ms. A single dead page cost 6.2 SECONDS,
// so two of them ate the entire 10s window and we advanced three pages. Dead pages
// get recovered by ID in the gapfill phase anyway, so grinding on them is wasted
// time. Fail fast, recover later.
const PAGE_RETRIES = 3;
const BACKOFF_MS = [400, 1100];
const TIME_BUDGET_MS = 6000;    // stop, checkpoint, and hand back well before Netlify kills us
const MAX_GAPFILL_IDS = 1000;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// SELF-CHAINING (mmb-v11)
//
// Netlify kills a synchronous function at 10 seconds. BD's throttle means the read
// takes ~30s of wall time no matter how we slice it. So the function checkpoints,
// then RE-INVOKES ITSELF and returns. Each link picks up at the exact page the last
// one stopped on.
//
// One call finishes the whole build. The nightly cron fires once and walks away.
// You never refresh a URL six times.
//
// Guarded by MAX_CHAIN. A runaway loop would hammer BD, which is exactly the thing
// that started this whole mess.
// ---------------------------------------------------------------------------
const MAX_CHAIN = 40;
const SELF_URL = process.env.URL || "https://renters-story-writer.netlify.app";

async function chainSelf(key, chain) {
  const url = SELF_URL + "/.netlify/functions/members-map-build?build=1&chain=" + chain +
              "&key=" + encodeURIComponent(key);
  log("chaining -> link", chain);
  try {
    // Fire it and let go. The request reaches Netlify and a fresh invocation starts
    // with its own 10s budget. We abort our WAIT, not the downstream run.
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1200);
    await fetch(url, { signal: ctrl.signal }).catch(() => {});
    clearTimeout(t);
  } catch (e) { /* aborting our own wait is the expected path */ }
}

async function fetchPage(page, limit) {
  const data = await bdGet(listPath(page, limit));
  return { rows: rowsFrom(data), meta: metaFrom(data), raw: data };
}

// One page, serially, with backoff. A 400 from BD is a "wait", not a "no".
async function fetchPageResilient(page, limit, deadline) {
  let last = null;
  for (let attempt = 1; attempt <= PAGE_RETRIES; attempt++) {
    const r = await bdTry(listPath(page, limit));
    if (r.rows > 0) {
      if (attempt > 1) log("page", page, "recovered on attempt", attempt);
      return { ok: true, rows: rowsFrom(r.raw), meta: r.meta, attempts: attempt };
    }
    last = r;
    // Do not burn the remaining budget grinding on one page. The gapfill will get
    // its members by ID.
    if (deadline && Date.now() + (BACKOFF_MS[attempt - 1] || 1100) > deadline) break;
    if (attempt < PAGE_RETRIES) await sleep(BACKOFF_MS[attempt - 1] || 1100);
  }
  log("PAGE", page, "DEAD after", PAGE_RETRIES, "tries | http", last && last.httpStatus, "| bd:", last && last.bdMessage);
  return {
    ok: false, rows: [], attempts: PAGE_RETRIES,
    http: last && last.httpStatus,
    bdMessage: last && last.bdMessage
  };
}

async function fetchMemberById(id) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await bdTry("/user/get/" + id);
    if (r.rows > 0) return rowsFrom(r.raw)[0];
    await sleep(BACKOFF_MS[attempt - 1] || 2000);
  }
  return null; // deleted member. Correctly absent.
}

// Which page size does BD honour? 100 is rejected outright. 50 works.
// Probed SERIALLY with delays, or the throttle tells us everything is broken.
async function pickLimit() {
  for (const l of [50, 25]) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await bdTry(listPath(2, l));
      if (r.rows > 0) {
        log("limit", l, "OK | total", r.meta && r.meta.total, "| pages", r.meta && r.meta.total_pages);
        return { limit: l, probe: r };
      }
      await sleep(BACKOFF_MS[attempt - 1] || 2000);
    }
    log("limit", l, "rejected after 3 tries");
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fold one member into the running zip buckets. Called during paging so we never
// have to hold 3,873 full member records in memory or in a Blob (they are ~3KB
// each; the raw set would blow the 5MB Blob ceiling on its own).
// ---------------------------------------------------------------------------
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

  // BD's coordinate is trustworthy ONLY when a zip is present and it is not the
  // Colorado junk fallback. mz-v4 wrote real centroids for every member the gate
  // touched, so this is usually a free, correct centroid with no geocode call.
  if (!b.coord) {
    const la = num(m.lat), lo = num(m.lon);
    if (la !== null && lo !== null && !isJunkCoord(la, lo)) {
      b.coord = [Number(la.toFixed(5)), Number(lo.toFixed(5))];
    } else if (isJunkCoord(la, lo)) {
      state.totals.onJunkCoordinate++;
    }
  }
}

function emptyState() {
  return {
    v: FN_VERSION,
    startedAt: new Date().toISOString(),
    limit: 0,
    nextPage: 1,
    totalPages: 0,
    bdTotal: null,
    seen: {},
    byZip: {},
    deadPages: [],
    totals: {
      members: 0, renters: 0, landlords: 0, propertyManagers: 0, realtors: 0,
      uncategorized: 0, new7: 0, placed: 0, unplaced: 0, onJunkCoordinate: 0
    },
    gapFilled: 0,
    chain: 0,
    phase: "paging"   // paging -> gapfill -> done
  };
}

async function loadProgress(store, fresh) {
  if (fresh) return emptyState();
  try {
    const raw = await store.get(KEY_PROGRESS);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    if (s.v !== FN_VERSION) { log("progress from a different version, starting fresh"); return emptyState(); }
    return s;
  } catch (e) { return emptyState(); }
}

// ---------------------------------------------------------------------------
// PAGE THROUGH BD, SERIALLY, CHECKPOINTING AS WE GO.
// Returns { done: bool }. If done is false, call again to continue.
// ---------------------------------------------------------------------------
async function pageBd(store, state, deadline) {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  if (!state.limit) {
    const picked = await pickLimit();
    if (!picked) throw new Error("BD rejected page 2 at limit 50 AND 25, after retries. Not a rate limit. Run ?probe=1.");
    state.limit = picked.limit;
    state.bdTotal = picked.probe.meta && picked.probe.meta.total;
    state.totalPages = Math.min((picked.probe.meta && picked.probe.meta.total_pages) || MAX_PAGES, MAX_PAGES);
    log("PAGING | limit", state.limit, "| members", state.bdTotal, "| pages", state.totalPages);
  }

  while (state.nextPage <= state.totalPages) {
    if (Date.now() > deadline) {
      log("time budget reached at page", state.nextPage, "of", state.totalPages, "- checkpointing");
      await store.set(KEY_PROGRESS, JSON.stringify(state));
      return { done: false };
    }

    const r = await fetchPageResilient(state.nextPage, state.limit, deadline);
    if (r.ok) {
      for (const m of r.rows) foldMember(state, m, weekAgo);
    } else {
      state.deadPages.push({ page: state.nextPage, http: r.http, bdMessage: r.bdMessage });
    }

    state.nextPage++;
    await sleep(REQUEST_DELAY_MS);
  }

  state.phase = "gapfill";
  await store.set(KEY_PROGRESS, JSON.stringify(state));
  return { done: true };
}

// ---------------------------------------------------------------------------
// GAP FILL. Any member ID inside the range we saw, that we never got, gets fetched
// individually. That is how a page BD refused to serve stops costing us members.
// ---------------------------------------------------------------------------
async function gapFill(store, state, deadline) {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const ids = Object.keys(state.seen).map(Number).sort((a, b) => a - b);
  if (!ids.length) return { done: true };

  const maxId = ids[ids.length - 1];
  const missing = [];
  for (let id = 1; id <= maxId && missing.length < MAX_GAPFILL_IDS; id++) {
    if (!state.seen[id]) missing.push(id);
  }

  if (!missing.length) { state.phase = "done"; await store.set(KEY_PROGRESS, JSON.stringify(state)); return { done: true }; }
  log("gap-filling", missing.length, "ids");

  for (const id of missing) {
    if (Date.now() > deadline) {
      log("time budget reached during gapfill - checkpointing");
      await store.set(KEY_PROGRESS, JSON.stringify(state));
      return { done: false };
    }
    const m = await fetchMemberById(id);
    if (m) { foldMember(state, m, weekAgo); state.gapFilled++; }
    else { state.seen[id] = 1; } // deleted member. Mark it so we never chase it again.
    await sleep(REQUEST_DELAY_MS);
  }

  state.phase = "done";
  await store.set(KEY_PROGRESS, JSON.stringify(state));
  return { done: true };
}

// ---------------------------------------------------------------------------
// Geocoding — POSTAL CODE ONLY. No street address is ever sent to Google and none
// can come back. What returns is the centroid of the zip area (~90 sq mi), coarse
// by construction. Same model as member-zip.js mz-v4.
// ---------------------------------------------------------------------------
async function geocodeZip(z) {
  if (!GKEY) return null;
  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?components=" +
    encodeURIComponent("postal_code:" + z + "|country:US") +
    "&key=" + GKEY;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== "OK" || !data.results || !data.results.length) {
      log("geocode miss", z, data.status);
      return null;
    }
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

// ---------------------------------------------------------------------------
// THE BUILD
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// THE BUILD — resumable. Call it until it reports done:true.
//   ?build=1        continue (or start)
//   ?build=1&fresh=1  throw away progress and start over
// ---------------------------------------------------------------------------
async function build(opts) {
  const warmOnly = !!(opts && opts.warmOnly);
  const fresh = !!(opts && opts.fresh);
  const noChain = !!(opts && opts.noChain);
  const key = (opts && opts.key) || "";
  const started = Date.now();
  const deadline = started + TIME_BUDGET_MS;

  const store = rdcStore(BLOB_STORE);
  const state = await loadProgress(store, fresh);
  state.chain = (state.chain || 0) + 1;

  if (state.chain > MAX_CHAIN) {
    console.error("[mmb] MAX_CHAIN hit. Refusing to continue. Something is wrong.");
    return { ok: false, done: false, _v: FN_VERSION, error: "MAX_CHAIN exceeded at link " + state.chain + ". Run ?build=1&fresh=1 to reset." };
  }

  // ---- PHASE 1: read BD, serially, checkpointing ----
  if (state.phase === "paging") {
    const r = await pageBd(store, state, deadline);
    if (!r.done) {
      if (!noChain && key) await chainSelf(key, state.chain);
      return {
        ok: true, done: false, _v: FN_VERSION, phase: "paging",
        progress: (state.nextPage - 1) + " / " + state.totalPages + " pages",
        membersSoFar: state.totals.members,
        bdTotal: state.bdTotal,
        deadPages: state.deadPages.length,
        chainLink: state.chain,
        NOTE: noChain ? "chaining off, call ?build=1 again" : "still running in the background. Poll ?status=1 to watch it.",
        ms: Date.now() - started
      };
    }
  }

  // ---- PHASE 2: recover members BD's dead pages swallowed ----
  if (state.phase === "gapfill") {
    const r = await gapFill(store, state, deadline);
    if (!r.done) {
      if (!noChain && key) await chainSelf(key, state.chain);
      return {
        ok: true, done: false, _v: FN_VERSION, phase: "gapfill",
        membersSoFar: state.totals.members,
        gapFilled: state.gapFilled,
        chainLink: state.chain,
        NOTE: noChain ? "chaining off, call ?build=1 again" : "still running in the background. Poll ?status=1 to watch it.",
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
    listLimit: state.limit,
    membersReadVsBdTotal: state.totals.members + " / " + state.bdTotal,
    totals: snapshot.totals,
    pins: pins.length,
    deadPageCount: state.deadPages.length,
    deadPages: state.deadPages.slice(0, 10),
    gapFilledMembers: state.gapFilled,
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
async function probe() {
  const TOKENS = [
    { id: "CONTROL page2 limit25", token: "MipfKjI1",     note: "KNOWN GOOD. Returned 25 rows earlier today." },
    { id: "page1 limit25",         token: "MSpfKjI1",     note: "BD issued this as prev_page. Now 400s?" },
    { id: "page3 limit25",         token: "MypfKjI1",     note: "BD issued this as next_page." },
    { id: "page4 limit25",         token: cursor(4, 25),  note: "generated, no padding" },
    { id: "page9 limit25",         token: cursor(9, 25),  note: "last single-digit page, no padding" },
    { id: "page10 limit25 padded", token: cursor(10, 25), note: "THE PADDING TEST. base64 ends in =" },
    { id: "page10 limit25 strip",  token: cursor(10, 25).replace(/=+$/, ""), note: "same, padding removed" },
    { id: "page155 limit25",       token: cursor(155, 25),note: "last page" },
    { id: "page2 limit100 padded", token: cursor(2, 100), note: "can we get a bigger page?" },
    { id: "page2 limit50",         token: cursor(2, 50),  note: "no padding at limit 50" }
  ];

  const out = { _v: FN_VERSION, walk: [] };

  for (const t of TOKENS) {
    const r = await bdTry("/user/get?page=" + encodeURIComponent(t.token));
    out.walk.push({
      id: t.id,
      token: t.token,
      decoded: Buffer.from(t.token + "===".slice(0, (4 - (t.token.length % 4)) % 4), "base64").toString("utf8"),
      http: r.httpStatus,
      bdMessage: r.bdMessage,
      rows: r.rows,
      current_page: r.meta && r.meta.current_page,
      total: r.meta && r.meta.total,
      next_page: r.raw && r.raw.next_page,
      note: t.note
    });
  }

  const control = out.walk[0];
  out.CONTROL_STILL_WORKS = control.rows > 0;

  if (!out.CONTROL_STILL_WORKS) {
    out.verdict = "CONTROL FAILED. The page-2 cursor that returned 25 rows earlier now returns " +
                  control.http + ". This is not a page-1 problem. Something else changed (rate limit, key scope, BD-side). STOP AND RETHINK.";
    return out;
  }

  const working = out.walk.filter((w) => w.rows > 0);
  out.WORKING_TOKENS = working.length;
  out.PAGE_1_WORKS = out.walk.filter((w) => w.id === "page1 limit25")[0].rows > 0;
  out.PAGE_10_PADDED_WORKS = out.walk.filter((w) => w.id === "page10 limit25 padded")[0].rows > 0;
  out.PAGE_10_STRIPPED_WORKS = out.walk.filter((w) => w.id === "page10 limit25 strip")[0].rows > 0;
  out.BIGGER_PAGES_WORK = out.walk.filter((w) => w.id === "page2 limit100 padded")[0].rows > 0;

  const row0 = rowsFrom(control.rowsRaw || {})[0];
  out.verdict = "Control OK. page1=" + out.PAGE_1_WORKS +
                " page10padded=" + out.PAGE_10_PADDED_WORKS +
                " page10stripped=" + out.PAGE_10_STRIPPED_WORKS +
                " limit100=" + out.BIGGER_PAGES_WORK;
  return out;
}

// ---------------------------------------------------------------------------
// FILTER LADDER (mmb-v3)
//
// What the mmb-v2 probe proved:
//   - NO filter          -> HTTP 400 "user not found"      (list refuses to enumerate)
//   - property + value   -> HTTP 200, total 0              (filter ACCEPTED, matched none)
//   - property_operator=LIKE -> HTTP 400 "Invalid filter parameters"
//   - /user/search       -> HTTP 405 "Invalid Request Method"  (wants POST)
//
// So the endpoint is real and gated behind a filter whose column/operator
// vocabulary we do not yet know. This tries the plausible ones in one pass.
// ---------------------------------------------------------------------------
const Q = "/user/get?page=1&limit=100";

const FILTER_CANDIDATES = [
  // 1. Does the filter mechanism work AT ALL? Aim it at a member we know exists.
  { id: "user_id=3664",            path: Q + "&property=user_id&property_value=3664" },
  { id: "user_id=3664 op:=",       path: Q + "&property=user_id&property_value=3664&property_operator=" + encodeURIComponent("=") },
  { id: "user_id=3664 op:equal",   path: Q + "&property=user_id&property_value=3664&property_operator=equal" },
  { id: "user_id=3664 op:eq",      path: Q + "&property=user_id&property_value=3664&property_operator=eq" },

  // 2. Match-everything shapes. If one of these works, it IS the bulk list.
  { id: "user_id>0",               path: Q + "&property=user_id&property_value=0&property_operator=" + encodeURIComponent(">") },
  { id: "user_id op:greater",      path: Q + "&property=user_id&property_value=0&property_operator=greater_than" },
  { id: "email like %",            path: Q + "&property=email&property_value=" + encodeURIComponent("%") + "&property_operator=like" },
  { id: "email like @",            path: Q + "&property=email&property_value=" + encodeURIComponent("@") + "&property_operator=like" },
  { id: "email like % (LIKE caps)",path: Q + "&property=email&property_value=" + encodeURIComponent("%") + "&property_operator=LIKE" },

  // 3. Is the member-type column named something else?
  { id: "profession_id=20",        path: Q + "&property=profession_id&property_value=20" },
  { id: "profession=20",           path: Q + "&property=profession&property_value=20" },
  { id: "category_id=20",          path: Q + "&property=category_id&property_value=20" },
  { id: "subscription_id",         path: Q + "&property=subscription_id&property_value=1" },
  { id: "profession_id=19",        path: Q + "&property=profession_id&property_value=19" },

  // 4. Columns we have SEEN on a live record (Bible: confirmed on member 3835).
  { id: "verified=0",              path: Q + "&property=verified&property_value=0" },
  { id: "state_code=IL",           path: Q + "&property=state_code&property_value=IL" },
  { id: "zip_code=61802",          path: Q + "&property=zip_code&property_value=61802" },
  { id: "city=Urbana",             path: Q + "&property=city&property_value=Urbana" }
];

async function filterLadder() {
  const out = { _v: FN_VERSION, note: "BD's list requires a filter. Unfiltered calls 400. Looking for one that returns rows.", ladder: [] };

  for (const c of FILTER_CANDIDATES) {
    const r = await bdTry(c.path);
    const e = {
      id: c.id,
      http: r.httpStatus,
      bdMessage: r.bdMessage,
      rows: r.rows,
      total: r.meta && r.meta.total,
      total_pages: r.meta && r.meta.total_pages
    };
    if (r.error) e.error = r.error;
    out.ladder.push(e);

    if (r.rows > 0 && !out.WINNER) {
      out.WINNER = c.id;
      out.WINNER_PATH = c.path;
      out.reportedTotal = r.meta && r.meta.total;
      const rows = rowsFrom(r.raw);
      out.rowKeys = Object.keys(rows[0] || {});
      out.sample = rows.slice(0, 2).map((m) => ({
        user_id: m.user_id,
        profession_id: m.profession_id,
        zip_code: m.zip_code,
        city: m.city,
        state_code: m.state_code,
        lat: m.lat,
        lon: m.lon,
        signup_date: m.signup_date
      }));
    }
  }

  if (!out.WINNER) out.verdict = "No filter returned rows. Next: POST /user/search (405 says it wants POST), or the sequential ID scan.";
  return out;
}

// ---------------------------------------------------------------------------
// RAW PASSTHROUGH — the artifact, not the config. Returns BD's unmodified JSON
// for any path, so we can iterate without a redeploy.
//   ?raw=1&p=/user/get/3664&key=...
// [ADMIN] Returns full member records (email, phone). Key-gated, same as the
// member-zip probes.
// ---------------------------------------------------------------------------
async function rawPassthrough(p) {
  if (!p || p.charAt(0) !== "/") return { error: "p must be a path starting with /" };
  const r = await bdTry(p);
  return {
    _v: FN_VERSION,
    path: p,
    http: r.httpStatus,
    redirected: r.redirected,
    rowsParsed: r.rows,
    meta: r.meta,
    nonJson: r.snippet,
    raw: r.raw
  };
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

  return {
    _v: FN_VERSION,
    running: !!(prog && prog.phase !== "done" && prog.totals && prog.totals.members > 0),
    phase: prog ? prog.phase : "no build has run",
    progress: prog && prog.totalPages ? (prog.nextPage - 1) + " / " + prog.totalPages + " pages" : null,
    membersSoFar: prog && prog.totals ? prog.totals.members : 0,
    bdTotal: prog ? prog.bdTotal : null,
    zipsSoFar: prog && prog.byZip ? Object.keys(prog.byZip).length : 0,
    deadPages: prog && prog.deadPages ? prog.deadPages.length : 0,
    gapFilled: prog ? prog.gapFilled : 0,
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

  const isScheduled = !q.probe && !q.build && !q.warm && !q.filters && !q.raw && !q.status;
  const authed = PROBE_KEY && q.key === PROBE_KEY;

  if (!isScheduled && !authed && !q.status) return json(403, { error: "bad or missing key" });
  if (!BD_KEY) return json(500, { error: "BD_API_KEY not configured" });

  try {
    if (q.status) return json(200, await status());
    if (q.probe) return json(200, await probe());
    if (q.filters) return json(200, await filterLadder());
    if (q.raw) return json(200, await rawPassthrough(q.p));
    if (q.warm) return json(200, await build({ warmOnly: true, fresh: !!q.fresh, noChain: true }));
    const report = await build({ fresh: !!q.fresh, key: q.key, noChain: !!q.nochain });
    return json(report.ok ? 200 : 500, report);
  } catch (e) {
    console.error("[mmb] FAILED:", e.message);
    return json(500, { _v: FN_VERSION, ok: false, error: e.message });
  }
};
