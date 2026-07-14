// members-map-build.js
// Renters.com — Live Members Map (Element T) — the nightly snapshot builder.
//
// FN_VERSION: mmb-v6
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

const FN_VERSION = "mmb-v6";

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
const PAGE_BATCH = 6;     // pages fetched in parallel
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

// base64( "<page>*_*<limit>" ) — BD's cursor format, reproduced.
function cursor(page, limit) {
  return Buffer.from(String(page) + "*_*" + String(limit), "utf8").toString("base64");
}

// ⚠️ mmb-v6 FIX — DO NOT ADD &limit= BACK.
// The limit is ALREADY inside the cursor ("1*_*25"). Sending it again as its own
// query param makes BD 400 the whole request. mmb-v5 did exactly that and every
// page failed, even though the cursors were byte-identical to BD's own tokens.
//
// PADDING: base64("1*_*25") has no "=" padding, but base64("10*_*25") does, and at
// 155 pages we cannot avoid page 10. Whether BD's decoder tolerates padding is
// UNKNOWN, so we discover it rather than assume. padMode:
//   "raw"     -> send the "=" (URL-encoded as %3D)
//   "stripped"-> drop the "=" entirely (many base64 decoders accept unpadded)
function listPath(page, limit, padMode) {
  let c = cursor(page, limit);
  if (padMode === "stripped") c = c.replace(/=+$/, "");
  return "/user/get?page=" + encodeURIComponent(c);
}

// Soft fetch: never throws, returns the whole story. Used by the probes.
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

async function fetchPage(page, limit, padMode) {
  const data = await bdGet(listPath(page, limit, padMode));
  return { rows: rowsFrom(data), meta: metaFrom(data), raw: data };
}

// Discover TWO things in one pass:
//   1. the biggest page size BD actually honours (fewer pages, fewer calls)
//   2. whether BD's base64 decoder accepts padded cursors
// Page 10 is the real test for padding, because page 1 at limit 25 happens to have
// none. A format that works on page 1 and dies on page 10 would be a silent
// half-build, which is the worst outcome available.
async function pickLimit() {
  for (const padMode of ["raw", "stripped"]) {
    for (const l of [100, 50, 25]) {
      const p1 = await bdTry(listPath(1, l, padMode));
      if (!p1.rows) {
        log("limit", l, padMode, "-> page1 http", p1.httpStatus, "rows 0");
        continue;
      }

      // Page 1 works. Now prove a PADDED cursor works, or this dies at page 10.
      const p10 = await bdTry(listPath(10, l, padMode));
      log("limit", l, padMode, "-> page1 rows", p1.rows, "| page10 rows", p10.rows, "http", p10.httpStatus);
      if (!p10.rows) {
        log("page 10 failed under padMode=" + padMode + " — cursor padding rejected");
        continue;
      }

      const effective = p1.rows >= l ? l : p1.rows;
      log("USING limit", effective, "padMode", padMode, "| total", p1.meta && p1.meta.total, "| pages", p1.meta && p1.meta.total_pages);
      return { limit: effective, padMode: padMode, firstPage: p1 };
    }
  }
  return null;
}

async function fetchAllMembers() {
  const picked = await pickLimit();
  if (!picked) {
    throw new Error("BD bulk list returned zero rows at every limit. The cursor format may have changed. Run ?probe=1.");
  }

  const limit = picked.limit;
  const padMode = picked.padMode;
  PAGE_LIMIT = limit;

  const first = picked.firstPage;
  const all = rowsFrom(first.raw).slice();

  let totalPages = (first.meta && first.meta.total_pages) || 0;
  if (!totalPages || totalPages < 1) totalPages = MAX_PAGES;
  totalPages = Math.min(totalPages, MAX_PAGES);

  log("BULK LIST OK | limit:", limit, "| padMode:", padMode, "| page 1:", all.length, "rows | total:", first.meta && first.meta.total, "| pages:", totalPages);

  let page = 2;
  while (page <= totalPages) {
    const batch = [];
    for (let i = 0; i < PAGE_BATCH && page + i <= totalPages; i++) batch.push(fetchPage(page + i, limit, padMode));
    const results = await Promise.all(batch);
    let empty = false;
    for (const r of results) {
      all.push.apply(all, r.rows);
      if (!r.rows.length) empty = true;
    }
    page += batch.length;
    if (empty) break; // ran off the end
  }

  log("fetched", all.length, "member rows across", Math.min(totalPages, page - 1), "pages");
  return {
    members: all,
    reportedTotal: first.meta && first.meta.total,
    reportedPages: first.meta && first.meta.total_pages,
    listLimit: limit,
    padMode: padMode
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

  const { members, reportedTotal, reportedPages, listLimit, padMode } = await fetchAllMembers();

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
    padMode: padMode,
    bdReportedTotal: reportedTotal,
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
async function probe() {
  const out = {
    _v: FN_VERSION,
    BULK_LIST_WORKS: false,
    cursorFormat: 'base64("<page>*_*<limit>"), sent as ?page=<cursor>. NO separate &limit param.',
    ladder: []
  };

  for (const padMode of ["raw", "stripped"]) {
    for (const l of [100, 50, 25]) {
      const p1r = await bdTry(listPath(1, l, padMode));
      const p10r = p1r.rows ? await bdTry(listPath(10, l, padMode)) : null;

      out.ladder.push({
        limit: l,
        padMode: padMode,
        page1_cursor: padMode === "stripped" ? cursor(1, l).replace(/=+$/, "") : cursor(1, l),
        page1_http: p1r.httpStatus,
        page1_rows: p1r.rows,
        page10_cursor: padMode === "stripped" ? cursor(10, l).replace(/=+$/, "") : cursor(10, l),
        page10_http: p10r ? p10r.httpStatus : null,
        page10_rows: p10r ? p10r.rows : null,
        total: p1r.meta && p1r.meta.total,
        total_pages: p1r.meta && p1r.meta.total_pages
      });

      if (p1r.rows > 0 && p10r && p10r.rows > 0 && !out.BULK_LIST_WORKS) {
        out.BULK_LIST_WORKS = true;
        out.WORKING_LIMIT = l;
        out.WORKING_PADMODE = padMode;
        out.rowsPerPage = p1r.rows;
        out.reportedTotal = p1r.meta && p1r.meta.total;
        out.reportedTotalPages = p1r.meta && p1r.meta.total_pages;

        const rows = rowsFrom(p1r.raw);
        const row0 = rows[0] || {};
        out.HAS_user_id = "user_id" in row0;
        out.HAS_zip_code = "zip_code" in row0;
        out.HAS_profession_id = "profession_id" in row0;
        out.HAS_signup_date = "signup_date" in row0;
        out.HAS_lat_lon = "lat" in row0 && "lon" in row0;
        out.ALL_MAP_FIELDS_PRESENT =
          out.HAS_user_id && out.HAS_zip_code && out.HAS_profession_id && out.HAS_signup_date;

        // location fields only. No names, no emails, no phones.
        out.sample = rows.slice(0, 3).map((m) => ({
          user_id: m.user_id,
          profession_id: m.profession_id,
          zip_code: m.zip_code,
          city: m.city,
          state_code: m.state_code,
          lat: m.lat,
          lon: m.lon,
          signup_date: m.signup_date,
          onJunkCoordinate: isJunkCoord(num(m.lat), num(m.lon))
        }));
      }
    }
  }

  if (out.BULK_LIST_WORKS) {
    out.verdict = "Bulk list WORKS. " + out.reportedTotal + " members, " + out.reportedTotalPages +
                  " pages at limit " + out.WORKING_LIMIT + " (padMode " + out.WORKING_PADMODE + ").";
  } else {
    out.verdict = "Still no rows. Send me the ladder. Fallback is the sequential ID scan.";
  }
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
