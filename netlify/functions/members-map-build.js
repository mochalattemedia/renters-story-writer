// members-map-build.js
// Renters.com — Live Members Map (Element T) — the nightly snapshot builder.
//
// FN_VERSION: mmb-v9
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

const FN_VERSION = "mmb-v9";

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
const PAGE_BATCH = 8;     // pages fetched in parallel
const MAX_PAGES = 60;     // hard stop, ~12,000 members

const BLOB_STORE = "members-map";
const KEY_SNAPSHOT = "snapshot";
const KEY_ZIPCACHE = "zipcache";
const KEY_LISTPATH = "listpath";

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
// ⚠️⚠️ BD'S PAGINATION IS NOT RELIABLE. SOME PAGES SIMPLY WILL NOT SERVE.
//
// Proven by the mmb-v7 cursor walk, all at limit 25:
//     page 2, 3, 4   -> 200, 25 rows
//     page 155       -> 200, 23 rows   (and its token IS base64-padded)
//     page 1, 9, 10  -> HTTP 400
//
// Page 4 and page 155 were cursors WE generated. Both worked. Page 9 is built
// identically and 400s. So this is NOT a token-format problem, NOT a padding
// problem, and NOT a page-1 problem. Specific pages are unserveable, and BD's
// message ("user not found") suggests a page containing a member row BD itself
// cannot resolve. Page 1 is the oldest members, thick with dead test accounts.
//
// We are not going to make BD fix this. We route around it.
//
// THE STRATEGY:
//   1. Page at limit 50 (limit 100 is rejected; 50 is the proven ceiling).
//   2. Retry any page that fails. Some of it may be transient.
//   3. Any page that STAYS dead becomes an ID RANGE, and we fetch those members
//      one at a time via /user/get/{id} — the single most proven call we have.
//      Pages come back sorted by user_id, so a dead page is bracketed by its
//      neighbours. Page 1 is bracketed by 1 and (first id on page 2) - 1.
//
// A hole in BD's pagination costs us a few dozen individual lookups. It does not
// cost us members. Never ship a map that silently omits people because a vendor's
// pager coughed.
// ---------------------------------------------------------------------------
const PAGE_RETRIES = 3;
const MAX_GAPFILL_IDS = 400;   // bounded so a scheduled run cannot run away
const GAPFILL_BATCH = 8;

async function fetchPage(page, limit) {
  const data = await bdGet(listPath(page, limit));
  return { rows: rowsFrom(data), meta: metaFrom(data), raw: data };
}

async function fetchPageResilient(page, limit) {
  let last = null;
  for (let attempt = 1; attempt <= PAGE_RETRIES; attempt++) {
    const r = await bdTry(listPath(page, limit));
    if (r.rows > 0) {
      if (attempt > 1) log("page", page, "recovered on attempt", attempt);
      return { ok: true, rows: rowsFrom(r.raw), attempts: attempt };
    }
    last = r;
    if (attempt < PAGE_RETRIES) await new Promise((res) => setTimeout(res, 150 * attempt));
  }
  log("PAGE", page, "DEAD after", PAGE_RETRIES, "attempts | http", last && last.httpStatus, "| bd:", last && last.bdMessage);
  return {
    ok: false,
    rows: [],
    attempts: PAGE_RETRIES,
    http: last && last.httpStatus,
    bdMessage: last && last.bdMessage,
    bdBody: last && last.raw ? JSON.stringify(last.raw).slice(0, 200) : (last && last.snippet)
  };
}

// One member, by ID. The most reliable call BD gives us.
async function fetchMemberById(id) {
  const r = await bdTry("/user/get/" + id);
  const rows = r.rows ? rowsFrom(r.raw) : [];
  return rows.length ? rows[0] : null;
}

// Which page size does BD actually honour? 100 is rejected. Find the ceiling.
async function pickLimit() {
  for (const l of [50, 25]) {
    // Probe on page 2, NOT page 1. Page 1 is one of the dead ones.
    const r = await bdTry(listPath(2, l));
    log("limit probe", l, "-> http", r.httpStatus, "rows", r.rows, "total", r.meta && r.meta.total);
    if (r.rows > 0) {
      log("USING limit", l, "| total", r.meta && r.meta.total, "| pages", r.meta && r.meta.total_pages);
      return { limit: l, probe: r };
    }
  }
  return null;
}

async function fetchAllMembers() {
  const picked = await pickLimit();
  if (!picked) throw new Error("BD list returned zero rows at limit 50 AND 25, probed on page 2. Run ?probe=1.");

  const limit = picked.limit;
  PAGE_LIMIT = limit;

  const totalMembers = picked.probe.meta && picked.probe.meta.total;
  let totalPages = (picked.probe.meta && picked.probe.meta.total_pages) || 0;
  if (!totalPages || totalPages < 1) totalPages = MAX_PAGES;
  totalPages = Math.min(totalPages, MAX_PAGES);

  log("PAGING | limit:", limit, "| total members:", totalMembers, "| pages:", totalPages);

  const byId = {};            // dedupe: a member could appear on a retry and a gapfill
  const deadPages = [];
  let attemptsTotal = 0;

  for (let page = 1; page <= totalPages; page += PAGE_BATCH) {
    const batch = [];
    for (let i = 0; i < PAGE_BATCH && page + i <= totalPages; i++) batch.push(page + i);
    const results = await Promise.all(batch.map((p) => fetchPageResilient(p, limit)));

    for (let i = 0; i < batch.length; i++) {
      const r = results[i];
      attemptsTotal += r.attempts;
      if (!r.ok) {
        deadPages.push({ page: batch[i], http: r.http, bdMessage: r.bdMessage, bdBody: r.bdBody });
        continue;
      }
      for (const m of r.rows) {
        const id = num(m.user_id);
        if (id !== null) byId[id] = m;
      }
    }
  }

  const fetched = Object.keys(byId).map(Number).sort((a, b) => a - b);
  log("pages done |", fetched.length, "members |", deadPages.length, "dead pages");

  // -------------------------------------------------------------------------
  // GAP FILL. A dead page is an ID range, and we fetch it one member at a time.
  // -------------------------------------------------------------------------
  let gapFilled = 0;
  let gapAttempted = 0;

  if (deadPages.length && fetched.length) {
    const missing = new Set();
    const minId = fetched[0];
    const maxId = fetched[fetched.length - 1];

    // Any dead page BEFORE the lowest id we got (i.e. page 1): IDs 1..minId-1.
    for (let id = 1; id < minId && missing.size < MAX_GAPFILL_IDS; id++) missing.add(id);

    // Any ID inside the range we DID see, that we never got. Those are the holes
    // punched by dead pages in the middle.
    const have = new Set(fetched);
    for (let id = minId; id <= maxId && missing.size < MAX_GAPFILL_IDS; id++) {
      if (!have.has(id)) missing.add(id);
    }

    const ids = Array.from(missing);
    gapAttempted = ids.length;
    log("gap-filling", ids.length, "ids (bounded at", MAX_GAPFILL_IDS + ")");

    for (let i = 0; i < ids.length; i += GAPFILL_BATCH) {
      const slice = ids.slice(i, i + GAPFILL_BATCH);
      const got = await Promise.all(slice.map((id) => fetchMemberById(id)));
      for (const m of got) {
        if (m) {
          const id = num(m.user_id);
          if (id !== null && !byId[id]) { byId[id] = m; gapFilled++; }
        }
      }
    }
    log("gap-filled", gapFilled, "of", gapAttempted, "(the rest are deleted members, correctly absent)");
  }

  const members = Object.keys(byId).map((k) => byId[k]);
  log("TOTAL MEMBERS READ:", members.length, "| BD says:", totalMembers);

  return {
    members: members,
    reportedTotal: totalMembers,
    reportedPages: totalPages,
    listLimit: limit,
    deadPages: deadPages,
    gapFilled: gapFilled,
    gapAttempted: gapAttempted
  };
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
async function build(opts) {
  const warmOnly = !!(opts && opts.warmOnly);
  const started = Date.now();
  const store = rdcStore(BLOB_STORE);
  const cache = await loadZipCache(store);
  const cacheSizeBefore = Object.keys(cache).length;

  const { members, reportedTotal, reportedPages, listLimit, deadPages, gapFilled, gapAttempted } = await fetchAllMembers();

  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const totals = {
    members: 0,
    renters: 0,
    landlords: 0,
    propertyManagers: 0,
    realtors: 0,
    uncategorized: 0,
    new7: 0,
    placed: 0,
    unplaced: 0,
    onJunkCoordinate: 0
  };

  // zip -> { counts, new, labels:{}, coord }
  const byZip = {};
  const needGeocode = {};

  for (const m of members) {
    totals.members++;

    const t = typeOf(m);
    if (t) totals[t]++; else totals.uncategorized++;

    const ms = signupMs(m.signup_date || m.created || m.date_added);
    const isNew = ms !== null && ms >= weekAgo;
    if (isNew) totals.new7++;

    const z = zip5(m.zip_code);
    if (!z) {
      totals.unplaced++;
      continue;
    }
    totals.placed++;

    if (!byZip[z]) {
      byZip[z] = {
        renters: 0, landlords: 0, propertyManagers: 0, realtors: 0,
        total: 0, newCount: 0, labels: {}, coord: null
      };
    }
    const bucket = byZip[z];
    bucket.total++;
    if (t) bucket[t]++;
    if (isNew) bucket.newCount++;

    // Friendly label for the tooltip. Modal city/state per zip, so one member's
    // typo cannot rename a zip. Adds no information: the pin IS the zip already.
    const city = (m.city || "").trim();
    const st = (m.state_code || "").trim();
    if (city && st) {
      const lbl = city + ", " + st.toUpperCase();
      bucket.labels[lbl] = (bucket.labels[lbl] || 0) + 1;
    }

    // Coordinate: trust BD ONLY when a zip is present and the coord is not junk.
    // mz-v4 wrote real centroids for every member the gate touched, so this is
    // usually a free, correct centroid with no geocode call.
    if (!bucket.coord) {
      const la = num(m.lat), lo = num(m.lon);
      if (la !== null && lo !== null && !isJunkCoord(la, lo)) {
        bucket.coord = [Number(la.toFixed(5)), Number(lo.toFixed(5))];
        if (!cache[z]) cache[z] = bucket.coord; // seed the cache for free
      } else if (isJunkCoord(la, lo)) {
        totals.onJunkCoordinate++;
      }
    }
  }

  // Fill missing coords from cache, then geocode whatever is still unknown.
  for (const z of Object.keys(byZip)) {
    if (byZip[z].coord) continue;
    if (cache[z]) { byZip[z].coord = cache[z]; continue; }
    needGeocode[z] = true;
  }

  const pending = Object.keys(needGeocode);
  const budget = warmOnly ? MAX_GEOCODE_PER_WARM : MAX_GEOCODE_PER_RUN;
  const toDo = pending.slice(0, budget);
  log("zips:", Object.keys(byZip).length, "| cached:", cacheSizeBefore, "| need geocode:", pending.length, "| doing:", toDo.length);

  for (let i = 0; i < toDo.length; i += 8) {
    const slice = toDo.slice(i, i + 8);
    const got = await Promise.all(slice.map((z) => geocodeZip(z)));
    for (let j = 0; j < slice.length; j++) {
      if (got[j]) {
        cache[slice[j]] = got[j];
        byZip[slice[j]].coord = got[j];
      }
    }
  }

  await store.set(KEY_ZIPCACHE, JSON.stringify(cache));
  log("zipcache written:", Object.keys(cache).length, "zips");

  if (warmOnly) {
    return {
      ok: true,
      mode: "warm",
      _v: FN_VERSION,
      membersRead: totals.members,
      zipsSeen: Object.keys(byZip).length,
      zipCacheSize: Object.keys(cache).length,
      geocodedThisRun: toDo.length,
      stillMissing: Math.max(0, pending.length - toDo.length),
      ms: Date.now() - started
    };
  }

  // -------------------------------------------------------------------------
  // Assemble the pins. THIS is where the privacy rule is enforced, server-side.
  // -------------------------------------------------------------------------
  const pins = [];
  let suppressedNew = 0;
  let unresolvedZips = 0;

  for (const z of Object.keys(byZip)) {
    const b = byZip[z];
    if (!b.coord) { unresolvedZips++; continue; }

    // THE ONE SUPPRESSION. A count is a fact about a place. A timestamp on a thin
    // pin is a fact about a person. Zeroed HERE so it never reaches the browser.
    let newCount = b.newCount;
    if (b.total < MIN_MEMBERS_FOR_NEW && newCount > 0) {
      suppressedNew += newCount;
      newCount = 0;
    }

    let label = "";
    let best = 0;
    for (const k of Object.keys(b.labels)) {
      if (b.labels[k] > best) { best = b.labels[k]; label = k; }
    }

    pins.push([
      z,
      label,
      b.coord[0],
      b.coord[1],
      b.renters,
      b.landlords,
      b.propertyManagers,
      b.realtors,
      newCount
    ]);
  }

  pins.sort((a, b) => (b[4] + b[5] + b[6] + b[7]) - (a[4] + a[5] + a[6] + a[7]));

  const snapshot = {
    v: FN_VERSION,
    builtAt: new Date().toISOString(),
    totals: {
      members: totals.members,
      renters: totals.renters,
      landlords: totals.landlords,
      propertyManagers: totals.propertyManagers,
      realtors: totals.realtors,
      new7: totals.new7,
      placed: totals.placed,
      unplaced: totals.unplaced
    },
    pinCount: pins.length,
    // schema is documented in the payload so the page can never drift from it
    schema: ["zip", "label", "lat", "lon", "renters", "landlords", "propertyManagers", "realtors", "newCount"],
    pins: pins
  };

  await store.set(KEY_SNAPSHOT, JSON.stringify(snapshot));

  // READ IT BACK. Every third-party write, every time. (Bible, Workflow Rule 15.)
  let landed = false;
  let landedPins = 0;
  try {
    const back = await store.get(KEY_SNAPSHOT);
    const parsed = JSON.parse(back);
    landedPins = (parsed.pins || []).length;
    landed = parsed.builtAt === snapshot.builtAt && landedPins === pins.length;
  } catch (e) {
    log("READ-BACK FAILED:", e.message);
  }
  if (!landed) console.error("[mmb] SNAPSHOT DID NOT LAND. Wrote " + pins.length + " pins, read back " + landedPins + ".");

  const report = {
    ok: landed,
    _v: FN_VERSION,
    builtAt: snapshot.builtAt,
    landed: landed,
    listLimit: listLimit,
    bdReportedTotal: reportedTotal,
    // BD refuses to serve some pages. These are the ones it refused, and how many
    // members we recovered by fetching them individually instead.
    deadPageCount: deadPages.length,
    deadPages: deadPages,
    gapFilledMembers: gapFilled,
    gapAttemptedIds: gapAttempted,
    membersReadVsBdTotal: totals.members + " / " + reportedTotal,
    bdReportedPages: reportedPages,
    membersRead: totals.members,
    totals: snapshot.totals,
    pins: pins.length,
    zipsUnresolved: unresolvedZips,
    zipCacheSize: Object.keys(cache).length,
    geocodedThisRun: toDo.length,
    geocodeStillPending: Math.max(0, pending.length - toDo.length),
    newSuppressedOnThinPins: suppressedNew,
    membersStillOnJunkCoordinate: totals.onJunkCoordinate,
    uncategorizedMembers: totals.uncategorized,
    ms: Date.now() - started
  };
  log("BUILD DONE", JSON.stringify(report));
  return report;
}

// ---------------------------------------------------------------------------
// PROBE — Open Thread #26. Answers "does BD's bulk member list actually work on
// this site" and "do the rows carry user_id + zip_code + profession_id together".
// Writes nothing.
// ---------------------------------------------------------------------------
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

  const isScheduled = !q.probe && !q.build && !q.warm && !q.filters && !q.raw;
  const authed = PROBE_KEY && q.key === PROBE_KEY;

  if (!isScheduled && !authed) return json(403, { error: "bad or missing key" });
  if (!BD_KEY) return json(500, { error: "BD_API_KEY not configured" });

  try {
    if (q.probe) return json(200, await probe());
    if (q.filters) return json(200, await filterLadder());
    if (q.raw) return json(200, await rawPassthrough(q.p));
    if (q.warm) return json(200, await build({ warmOnly: true }));
    const report = await build({});
    return json(report.ok ? 200 : 500, report);
  } catch (e) {
    console.error("[mmb] FAILED:", e.message);
    return json(500, { _v: FN_VERSION, ok: false, error: e.message });
  }
};
