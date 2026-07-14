// members-map-build.js
// Renters.com — Live Members Map (Element T) — the nightly snapshot builder.
//
// FN_VERSION: mmb-v3
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

const FN_VERSION = "mmb-v3";

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

// BD signup_date is a 14-digit YYYYMMDDHHMMSS string. Tolerate other shapes.
function signupMs(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
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
// LIST-PATH DISCOVERY (Open Thread #26)
//
// BD returned this on /user/get?page=1&limit=200 :
//   {"status":"error","message":"user not found","total":0,"current_page":0,
//    "total_pages":0,"next_page":"","prev_page":""}
//
// Those pagination fields only appear on a LIST response. So the endpoint is
// real and a PARAMETER was wrong. Rather than guess, we try every plausible
// shape, take the first that returns rows, and CACHE THE WINNER in a blob so we
// only ever pay for discovery once.
//
// Do not trust a vendor 200 and do not trust a vendor 400 either. Read the body.
// ---------------------------------------------------------------------------
const LIST_CANDIDATES = [
  { id: "page+limit100",      tpl: (p, l) => "/user/get?page=" + p + "&limit=" + l, limit: 100 },
  { id: "page+limit50",       tpl: (p, l) => "/user/get?page=" + p + "&limit=" + l, limit: 50 },
  { id: "page+limit25",       tpl: (p, l) => "/user/get?page=" + p + "&limit=" + l, limit: 25 },
  { id: "page0-indexed",      tpl: (p, l) => "/user/get?page=" + (p - 1) + "&limit=" + l, limit: 100 },
  { id: "limit-only",         tpl: (p, l) => "/user/get?limit=" + l, limit: 100 },
  { id: "bare",               tpl: () => "/user/get", limit: 100 },
  { id: "renters-filter",     tpl: (p, l) => "/user/get?page=" + p + "&limit=" + l + "&property=profession_id&property_value=20", limit: 100 },
  { id: "renters-filter-LIKE",tpl: (p, l) => "/user/get?page=" + p + "&limit=" + l + "&property=profession_id&property_value=20&property_operator=LIKE", limit: 100 },
  { id: "status-filter",      tpl: (p, l) => "/user/get?page=" + p + "&limit=" + l + "&property=status&property_value=active", limit: 100 },
  { id: "user-search",        tpl: (p, l) => "/user/search?page=" + p + "&limit=" + l, limit: 100 },
  { id: "users-plural",       tpl: (p, l) => "/users/get?page=" + p + "&limit=" + l, limit: 100 }
];

// Soft version of bdGet: never throws, returns the whole story.
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

async function discoverListPath(store) {
  // cached winner?
  try {
    const cached = await store.get(KEY_LISTPATH);
    if (cached) {
      const c = JSON.parse(cached);
      const found = LIST_CANDIDATES.filter((x) => x.id === c.id)[0];
      if (found) {
        const check = await bdTry(found.tpl(1, c.limit || found.limit));
        if (check.rows > 0) {
          log("list path from cache:", c.id, "limit", c.limit || found.limit);
          return { cand: found, limit: c.limit || found.limit, firstPage: check };
        }
        log("cached list path stopped working, rediscovering");
      }
    }
  } catch (e) {}

  for (const cand of LIST_CANDIDATES) {
    const r = await bdTry(cand.tpl(1, cand.limit));
    log("try", cand.id, "->", r.httpStatus, "rows:", r.rows, "bd:", r.bdMessage || r.bdStatus);
    if (r.rows > 0) {
      await store.set(KEY_LISTPATH, JSON.stringify({ id: cand.id, limit: cand.limit }));
      log("LIST PATH FOUND:", cand.id, "limit", cand.limit, "rows", r.rows);
      return { cand: cand, limit: cand.limit, firstPage: r };
    }
  }
  return null;
}

async function fetchPage(cand, limit, page) {
  const data = await bdGet(cand.tpl(page, limit));
  return { rows: rowsFrom(data), meta: metaFrom(data), raw: data };
}

async function fetchAllMembers(store) {
  const found = await discoverListPath(store);
  if (!found) {
    throw new Error("BD bulk member list DOES NOT WORK on this site. Every candidate returned zero rows. Run ?probe=1 and send the ladder.");
  }

  const cand = found.cand;
  const limit = found.limit;
  PAGE_LIMIT = limit;

  const first = found.firstPage;
  const all = rowsFrom(first.raw).slice();

  // Single-page shapes (bare / limit-only) cannot be paged. Take what they gave.
  const pageable = cand.id !== "bare" && cand.id !== "limit-only";

  let totalPages = first.meta && first.meta.total_pages;
  if (!totalPages || totalPages < 1) totalPages = pageable ? MAX_PAGES : 1;
  totalPages = Math.min(totalPages, MAX_PAGES);

  log("list path:", cand.id, "| limit:", limit, "| page 1:", all.length, "rows | total:", first.meta && first.meta.total, "| total_pages:", totalPages);

  if (pageable) {
    let page = 2;
    while (page <= totalPages) {
      const batch = [];
      for (let i = 0; i < PAGE_BATCH && page + i <= totalPages; i++) batch.push(fetchPage(cand, limit, page + i));
      const results = await Promise.all(batch);
      let short = false;
      for (const r of results) {
        all.push.apply(all, r.rows);
        if (r.rows.length < limit) short = true;
      }
      page += batch.length;
      if (short && !(first.meta && first.meta.total_pages)) break;
    }
  }

  log("fetched", all.length, "member rows");
  return {
    members: all,
    reportedTotal: first.meta && first.meta.total,
    reportedPages: first.meta && first.meta.total_pages,
    listPath: cand.id,
    listLimit: limit
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

  const { members, reportedTotal, reportedPages, listPath, listLimit } = await fetchAllMembers(store);

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
    listPath: listPath,
    listLimit: listLimit,
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
  const out = { _v: FN_VERSION, BULK_LIST_WORKS: false, ladder: [] };

  for (const cand of LIST_CANDIDATES) {
    const r = await bdTry(cand.tpl(1, cand.limit));
    const entry = {
      id: cand.id,
      path: r.path,
      http: r.httpStatus,
      redirected: r.redirected || false,
      bdMessage: r.bdMessage,
      rows: r.rows,
      total: r.meta && r.meta.total,
      total_pages: r.meta && r.meta.total_pages
    };
    if (r.error) entry.error = r.error;
    if (r.snippet) entry.nonJson = r.snippet;
    out.ladder.push(entry);

    if (r.rows > 0 && !out.WINNER) {
      out.BULK_LIST_WORKS = true;
      out.WINNER = cand.id;
      out.WINNER_PATH = r.path;
      out.WINNER_LIMIT = cand.limit;
      out.reportedTotal = r.meta && r.meta.total;
      out.reportedTotalPages = r.meta && r.meta.total_pages;
      out.topLevelKeys = Object.keys(r.raw || {});

      const rows = rowsFrom(r.raw);
      const row0 = rows[0] || {};
      out.rowKeys = Object.keys(row0);
      out.HAS_user_id = "user_id" in row0;
      out.HAS_zip_code = "zip_code" in row0;
      out.HAS_profession_id = "profession_id" in row0;
      out.HAS_signup_date = "signup_date" in row0;
      out.HAS_lat_lon = "lat" in row0 && "lon" in row0;
      out.ALL_MAP_FIELDS_PRESENT =
        out.HAS_user_id && out.HAS_zip_code && out.HAS_profession_id && out.HAS_signup_date;

      // 3 sample rows, location fields only. No names, no emails, no phones.
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

  if (!out.BULK_LIST_WORKS) {
    out.verdict = "No candidate returned rows. BD may not expose a bulk list on this plan. Fallback: sequential ID scan (member IDs are contiguous to ~3900).";
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
