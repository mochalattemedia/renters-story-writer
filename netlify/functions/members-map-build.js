// members-map-build.js
// Renters.com — Live Members Map (Element T) — the nightly snapshot builder.
//
// FN_VERSION: mmb-v15
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

const FN_VERSION = "mmb-v15";

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
// ⚠️⚠️⚠️  READ THIS BEFORE TOUCHING THE PAGER. TWO SEPARATE FAULTS, BOTH REAL.
//
// I chased this through five versions by insisting it was ONE thing. It is two, and
// each one produces evidence that looks like a refutation of the other.
//
// FAULT 1 — SOME PAGES ARE PERMANENTLY DEAD.
//   Pages 1, 9 and 10 fail EVERY time, in every version, after every rest period.
//   Pages 2, 3, 4 and 155 always work. A cursor-walk run hours apart came back
//   BYTE-IDENTICAL. This is deterministic: a member record BD cannot resolve kills
//   the ENTIRE PAGE it sits on, and BD reports it as 400 "user not found".
//   ➜ At limit 50, 34 of 78 pages died. ~44% of the membership, gone, with a 200.
//   ➜ Consequence: a dead page costs you EVERY member on it, so a SMALLER page size
//     loses FEWER members. Hence limit 25, not 50. Same bad records, half the damage.
//
// FAULT 2 — THERE IS A THROTTLE, AND IT ONLY BITES UNDER SUSTAINED LOAD.
//   A 10-call probe sails through. A 27-link chain firing hundreds of calls gets
//   EVERYTHING rejected, including pages we have proven good. Fifteen minutes of
//   silence and those same pages answer perfectly again.
//   ➜ This is why "retries with backoff" looked like it disproved the throttle. The
//     retries were part of the flood.
//
// AND BOTH FAULTS SPEAK THE SAME SENTENCE: 400 {"message":"user not found"}.
// One message, two unrelated causes, and neither has anything to do with a user
// that could not be found. Fourth time BD has done this:
//     {"result_status":"no-swal"}   = "show no popup", NOT "saved"
//     /user/update 200              = "accepted", NOT "written where you asked"
//     400 "user not found" (dead)   = "this page has a rotten row in it"
//     400 "user not found" (flood)  = "slow down"
//
// THE STRATEGY THAT SURVIVES BOTH:
//   1. Page at limit 25. Halves what each dead page costs us.
//   2. Pace every call. Never burst. Never parallelise against BD.
//   3. WATCH FOR THE THROTTLE: N failures in a row means we are being rejected
//      wholesale, not hitting rotten pages. Stop, checkpoint, cool down, resume.
//      Grinding into a throttle is what broke the last three builds.
//   4. Recover every member a dead page swallowed via /user/get/{id}, which has
//      NEVER failed on this site, not once, under any condition.
//   5. Resumable end to end. This is a nightly job. Nobody is waiting. It is allowed
//      to take several passes, and it is not allowed to lie about being complete.
// ---------------------------------------------------------------------------
// ⚠️ mmb-v15 — THE ACTUAL FIX, AND THE ONE I SHOULD HAVE MADE FIRST.
//
// v10-v14 paced at 60-320ms. That is 190 to 1,000 requests per minute. NO API ON
// EARTH ALLOWS THAT. We were flooding BD from the very first build and then writing
// increasingly clever machinery to survive the consequences: backoff, retries,
// throttle detection, cooldowns, rewind logic. Four layers of armour, all of it
// engineering around a wall we were sprinting at.
//
// 650ms is ~92 requests/minute. Under any sane limit.
//
// ⚠️ AND IT INVALIDATES OUR DATA. Every "dead page" count we collected was taken
// while flooding, so most of those 34 dead pages were THROTTLE VICTIMS, not rotten
// rows. The only pages I trust as genuinely dead are 1, 9 and 10, because those
// failed during a light 10-call walk that never tripped anything.
//
// EXPECT, PACED PROPERLY:
//   155 pages x 650ms          ~= 100 seconds
//   a handful of rotten pages  ~= a few hundred members recovered by ID
//   total                      ~= under 5 minutes, no cooldowns
//
// Slower per call. Far faster overall. Because it stops fighting.
//
// THE LESSON: when a vendor keeps rejecting you, check your own request rate before
// you build a fourth layer of retry logic. Politeness is cheaper than armour.
const REQUEST_DELAY_MS = 650;   // ~92 req/min. Do not lower this.
// mmb-v12: was 4 retries at 600/1600/4000ms. A single dead page cost 6.2 SECONDS,
// so two of them ate the entire 10s window and we advanced three pages. Dead pages
// get recovered by ID in the gapfill phase anyway, so grinding on them is wasted
// time. Fail fast, recover later.
const PAGE_RETRIES = 2;
const BACKOFF_MS = [1500];
const LIST_LIMIT = 25;              // locked. A dead page costs 25 members, not 50.
const THROTTLE_STREAK = 6;          // this many consecutive failures = we are being throttled
const COOLDOWN_MS = 6 * 60 * 1000;  // should never fire now. If it does, we are still too fast.
const TIME_BUDGET_MS = 8000;    // stop, checkpoint, and hand back before Netlify kills us at 10s
const MAX_GAPFILL_IDS = 4200;   // the whole ID space if need be

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
const MAX_CHAIN = 200;   // ~10 calls per link at 650ms, so a full build is ~60-200 links
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

// /user/get/{id} has never failed on this site. Two tries, no backoff.
// A null here means the member is genuinely deleted, and is correctly absent.
async function fetchMemberById(id) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await bdTry("/user/get/" + id);
    if (r.rows > 0) return rowsFrom(r.raw)[0];
    if (attempt === 1) await sleep(120);
  }
  return null;
}

// The limit is LOCKED at 25 (see banner). We only need BD's total_pages, and we ask
// on page 2, because page 1 is one of the permanently dead ones.
async function openList() {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await bdTry(listPath(2, LIST_LIMIT));
    if (r.rows > 0) return { limit: LIST_LIMIT, probe: r };
    log("list not answering on page 2, attempt", attempt);
    await sleep(800 * attempt);
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
    const picked = await openList();
    if (!picked) {
      // Page 2 is PROVEN good. If it will not answer, we are throttled, full stop.
      state.cooldownUntil = Date.now() + COOLDOWN_MS;
      await store.set(KEY_PROGRESS, JSON.stringify(state));
      throw new Error("THROTTLED. Page 2 is proven good and BD will not serve it. Cooling down " +
                      (COOLDOWN_MS / 60000) + " min. Run ?status=1 to watch, then ?build=1 to resume.");
    }
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
      state.streak = 0;
    } else {
      state.deadPages.push({ page: state.nextPage, http: r.http, bdMessage: r.bdMessage });
      state.streak = (state.streak || 0) + 1;

      // A rotten page is isolated. SIX in a row is not rotten pages, it is BD
      // shutting the door. Back off instead of grinding, which is what broke v10-v13.
      if (state.streak >= THROTTLE_STREAK) {
        log("THROTTLE DETECTED:", state.streak, "consecutive failures. Cooling down.");
        state.cooldownUntil = Date.now() + COOLDOWN_MS;
        state.streak = 0;
        // rewind: those pages were probably fine, we were just being refused
        state.deadPages = state.deadPages.slice(0, -THROTTLE_STREAK);
        state.nextPage -= THROTTLE_STREAK;
        await store.set(KEY_PROGRESS, JSON.stringify(state));
        return { done: false, throttled: true };
      }
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
// ---------------------------------------------------------------------------
// GAP FILL — the part that actually gets us to 3,873.
//
// BD's pager drops ~44% of its pages. /user/get/{id} has NEVER failed. So every
// member the pager lost gets fetched individually, IN PARALLEL (no throttle exists,
// see the correction banner). ~1,700 lookups, 8 at a time, is about a minute of
// chained runs.
//
// Ceiling: we scan past the highest ID we saw, because if the LAST page is one of
// the dead ones, the newest members are exactly the ones missing. A map that
// silently omits this week's signups is worse than no map.
// ---------------------------------------------------------------------------
const GAPFILL_PARALLEL = 1;   // ⚠️ SERIAL. Parallel gapfill is what tripped the throttle.

async function gapFill(store, state, deadline) {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const ids = Object.keys(state.seen).map(Number).sort((a, b) => a - b);
  if (!ids.length) return { done: true };

  const maxSeen = ids[ids.length - 1];
  const ceiling = maxSeen + 120;   // covers a dead final page

  const missing = [];
  for (let id = 1; id <= ceiling && missing.length < MAX_GAPFILL_IDS; id++) {
    if (!state.seen[id]) missing.push(id);
  }

  if (!missing.length) {
    state.phase = "done";
    await store.set(KEY_PROGRESS, JSON.stringify(state));
    return { done: true };
  }
  log("gap-filling", missing.length, "ids (ceiling", ceiling + ")");

  let miss = 0;
  for (const id of missing) {
    if (Date.now() > deadline) {
      await store.set(KEY_PROGRESS, JSON.stringify(state));
      return { done: false };
    }
    const m = await fetchMemberById(id);
    if (m) {
      foldMember(state, m, weekAgo);
      state.gapFilled++;
      miss = 0;
    } else {
      // Could be a deleted member (fine) or the throttle (not fine). A long run of
      // nothing means the throttle, because deleted IDs do not cluster like that.
      miss++;
      if (miss >= 25) {
        log("gapfill: 25 consecutive misses, assuming throttle. Cooling down.");
        state.cooldownUntil = Date.now() + COOLDOWN_MS;
        await store.set(KEY_PROGRESS, JSON.stringify(state));
        return { done: false, throttled: true };
      }
      state.seen[id] = 1;
      state.gapDeleted = (state.gapDeleted || 0) + 1;
    }
    await sleep(REQUEST_DELAY_MS);
  }

  state.phase = "done";
  await store.set(KEY_PROGRESS, JSON.stringify(state));
  return { done: true };
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

  if (state.cooldownUntil && Date.now() < state.cooldownUntil) {
    const secs = Math.ceil((state.cooldownUntil - Date.now()) / 1000);
    return {
      ok: true, done: false, _v: FN_VERSION, phase: "cooldown",
      COOLING_DOWN: secs + "s left. BD throttled us. Nothing is broken.",
      progress: state.totalPages ? (state.nextPage - 1) + " / " + state.totalPages + " pages" : null,
      membersSoFar: state.totals.members,
      resumeWith: "?build=1 once the cooldown expires"
    };
  }
  state.cooldownUntil = 0;

  if (state.chain > MAX_CHAIN) {
    console.error("[mmb] MAX_CHAIN hit. Refusing to continue. Something is wrong.");
    return { ok: false, done: false, _v: FN_VERSION, error: "MAX_CHAIN exceeded at link " + state.chain + ". Run ?build=1&fresh=1 to reset." };
  }

  // ---- PHASE 1: read BD, serially, checkpointing ----
  if (state.phase === "paging") {
    const r = await pageBd(store, state, deadline);
    if (!r.done) {
      // NEVER chain into a cooldown. That is how we flooded BD in the first place.
      if (!noChain && key && !r.throttled) await chainSelf(key, state.chain);
      if (r.throttled) return {
        ok: true, done: false, _v: FN_VERSION, phase: "throttled",
        THROTTLED: "BD stopped answering. Cooling down " + (COOLDOWN_MS / 60000) + " min, then run ?build=1 again.",
        progress: (state.nextPage - 1) + " / " + state.totalPages + " pages",
        membersSoFar: state.totals.members,
        ms: Date.now() - started
      };
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
      if (!noChain && key && !r.throttled) await chainSelf(key, state.chain);
      if (r.throttled) return {
        ok: true, done: false, _v: FN_VERSION, phase: "throttled",
        THROTTLED: "BD stopped answering during gapfill. Cooling down, then run ?build=1 again.",
        membersSoFar: state.totals.members,
        gapFilled: state.gapFilled,
        ms: Date.now() - started
      };
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
    idsThatWereDeletedMembers: state.gapDeleted || 0,
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
    deletedIds: prog ? (prog.gapDeleted || 0) : 0,
    chainLink: prog ? prog.chain : 0,
    coolingDownFor: prog && prog.cooldownUntil && Date.now() < prog.cooldownUntil
      ? Math.ceil((prog.cooldownUntil - Date.now()) / 1000) + "s" : null,
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
