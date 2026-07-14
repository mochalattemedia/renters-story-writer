// members-map-build.js
// Renters.com — Live Members Map (Element T) — the nightly snapshot builder.
//
// FN_VERSION: mmb-v1
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
//   (scheduled)                       -> full build, nightly via netlify.toml
//
// ENV: BD_API_KEY, ADMIN_PROBE_KEY, GOOGLE_MAPS_API_KEY,
//      optional NETLIFY_SITE_ID + NETLIFY_BLOBS_TOKEN

const { getStore } = require("@netlify/blobs");

const FN_VERSION = "mmb-v1";

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

const PAGE_LIMIT = 200;   // BD rows per page
const PAGE_BATCH = 6;     // pages fetched in parallel
const MAX_PAGES = 60;     // hard stop, ~12,000 members

const BLOB_STORE = "members-map";
const KEY_SNAPSHOT = "snapshot";
const KEY_ZIPCACHE = "zipcache";

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

async function fetchPage(page) {
  const data = await bdGet("/user/get?page=" + page + "&limit=" + PAGE_LIMIT);
  return { rows: rowsFrom(data), meta: metaFrom(data), raw: data };
}

async function fetchAllMembers() {
  const first = await fetchPage(1);
  if (!first.rows.length) {
    throw new Error("BD bulk list returned ZERO rows on page 1. The endpoint may not be enabled on this site. Run ?probe=1 and read the rawKeys.");
  }

  let totalPages = first.meta.total_pages;
  if (!totalPages || totalPages < 1) {
    // BD did not tell us. Page until a short page comes back.
    totalPages = MAX_PAGES;
  }
  totalPages = Math.min(totalPages, MAX_PAGES);

  const all = first.rows.slice();
  log("page 1:", first.rows.length, "rows | total:", first.meta.total, "| total_pages:", first.meta.total_pages);

  let page = 2;
  while (page <= totalPages) {
    const batch = [];
    for (let i = 0; i < PAGE_BATCH && page + i <= totalPages; i++) batch.push(fetchPage(page + i));
    const results = await Promise.all(batch);

    let short = false;
    for (const r of results) {
      all.push.apply(all, r.rows);
      if (r.rows.length < PAGE_LIMIT) short = true;
    }
    page += batch.length;
    if (short && !first.meta.total_pages) break; // ran off the end of an unknown list
  }

  log("fetched", all.length, "member rows across", Math.min(totalPages, page - 1), "pages");
  return { members: all, reportedTotal: first.meta.total, reportedPages: first.meta.total_pages };
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

  const { members, reportedTotal, reportedPages } = await fetchAllMembers();

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
  const out = { _v: FN_VERSION, BULK_LIST_WORKS: false };
  try {
    const first = await fetchPage(1);
    out.rowsOnPage1 = first.rows.length;
    out.reportedTotal = first.meta.total;
    out.reportedCurrentPage = first.meta.current_page;
    out.reportedTotalPages = first.meta.total_pages;
    out.topLevelKeys = Object.keys(first.raw || {});

    if (first.rows.length) {
      const r = first.rows[0];
      out.rowKeys = Object.keys(r);
      out.HAS_user_id = "user_id" in r;
      out.HAS_zip_code = "zip_code" in r;
      out.HAS_profession_id = "profession_id" in r;
      out.HAS_signup_date = "signup_date" in r;
      out.HAS_lat_lon = "lat" in r && "lon" in r;
      out.BULK_LIST_WORKS = out.HAS_user_id && out.HAS_zip_code && out.HAS_profession_id;

      // 3 sample rows, location fields only. No names, no emails, no phones.
      out.sample = first.rows.slice(0, 3).map((m) => ({
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
  } catch (e) {
    out.error = e.message;
  }
  return out;
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

  const isScheduled = !q.probe && !q.build && !q.warm;
  const authed = PROBE_KEY && q.key === PROBE_KEY;

  if (!isScheduled && !authed) return json(403, { error: "bad or missing key" });
  if (!BD_KEY) return json(500, { error: "BD_API_KEY not configured" });

  try {
    if (q.probe) return json(200, await probe());
    if (q.warm) return json(200, await build({ warmOnly: true }));
    const report = await build({});
    return json(report.ok ? 200 : 500, report);
  } catch (e) {
    console.error("[mmb] FAILED:", e.message);
    return json(500, { _v: FN_VERSION, ok: false, error: e.message });
  }
};
