/**
 * pm-write.js  ·  pw-v2
 * Renters.com  ·  PM Feed Sync (Element Z)
 *
 * Executes a plan produced by pm-sync.js against the BD API.
 * Creates, updates, delists and reactivates listings.
 *
 * NEVER DELETES. Delist means group_status 0. There is no code path here
 * that calls the BD delete endpoint, and the API key should not carry the
 * permission either.
 *
 * CHANGELOG
 *   pw-v2  2026-07-28  URL COMPOSITION FIX AFTER A PRODUCTION INCIDENT.
 *                      pw-v1 read the shared BD_API_BASE while composing
 *                      paths by a different convention than every other
 *                      function using that variable. The variable was then
 *                      changed to suit this file, which sent every BD call
 *                      platform-wide to the public website instead of the
 *                      API. getMember() returned null, `verified` defaulted
 *                      false, and every verified landlord was gated out of
 *                      listing for ~21 hours.
 *
 *                      This file no longer depends on the shared variable's
 *                      convention. It normalizes whatever it is given and
 *                      reports the exact composed URL so it can be verified
 *                      before any write. A NEW FUNCTION MUST NEVER REDEFINE
 *                      SHARED CONFIG. If a future endpoint needs a different
 *                      base, it composes its own and says why.
 *
 *                      Also: response bodies are now surfaced verbatim with
 *                      the status code, so 403 (permission) is never again
 *                      mistaken for 404 (wrong URL). And only property_beds
 *                      and property_baths are written; the legacy bed_rooms
 *                      and property_bedrooms columns are read-back checked
 *                      and flagged if they ever populate.
 *   pw-v1  2026-07-27  Initial build. Field mapping from confirmed live API
 *                      reads, read-back verification on every write, rate
 *                      limit backoff, time budget with checkpointing,
 *                      dry-run default, per-item state confirmation.
 *
 * ENDPOINTS
 *   GET  ?feedId=X&dryrun=1   build payloads, write NOTHING (DEFAULT)
 *   GET  ?feedId=X&execute=1  execute the stored plan against BD
 *   GET  ?feedId=X&limit=N    cap items this invocation (default 25)
 *   GET  ?selftest=1          embedded fixtures, pass/fail
 *   GET  (no params)          deploy check
 *
 * ENV
 *   BD_API_KEY_FEED   BD API key scoped to Multi Image Posts GET/POST/PUT
 *                     and Post Types POST. No DEL.
 *   BD_API_BASE       SHARED ACROSS THE PLATFORM. Canonical value is
 *                     https://www.renters.com/api/v2 and it MUST NOT be
 *                     changed to suit this file. Read tolerantly below.
 *   BD_FEED_API_BASE  Optional override for this function only. Use this
 *                     if this endpoint ever needs a different base.
 *   PM_FEED_TOKEN     optional shared secret for calling this function
 */

'use strict';

const WRITE_VERSION = 'pw-v2';

/**
 * BD_API_BASE is shared platform-wide and its canonical value INCLUDES the
 * /api/v2 suffix. Other functions compose their paths on that assumption.
 *
 * This file therefore normalizes to a bare origin and appends the full
 * path itself, so it works correctly whichever form it is handed and,
 * critically, NEVER creates a reason to change the shared variable.
 */
function resolveBdOrigin() {
  const raw = process.env.BD_FEED_API_BASE || process.env.BD_API_BASE || 'https://www.renters.com';
  return String(raw)
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api\/v2$/i, '');
}

const BD_BASE = resolveBdOrigin();
const BD_BASE_RAW = process.env.BD_FEED_API_BASE || process.env.BD_API_BASE || '(unset, using default)';
const PROPERTY_DATA_ID = '12';
const PROPERTY_DATA_TYPE = '4';

/* Netlify background functions get 15 minutes. Leave headroom so the
 * checkpoint write always lands. */
const TIME_BUDGET_MS = 12 * 60 * 1000;
const DEFAULT_ITEM_LIMIT = 25;

/* BD rate limits under sustained load and reports it as HTTP 429. It has
 * also been observed reporting throttling as a 400 "user not found", which
 * is indistinguishable from a genuine miss, so pace deliberately. */
const PACE_MS = 350;
const MAX_RETRIES = 3;
const BACKOFF_MS = [1000, 3000, 8000];

/* ------------------------------------------------------------------ *
 * blobs
 * ------------------------------------------------------------------ */

function rdcStore(name) {
  const { getStore } = require('@netlify/blobs');
  try {
    return getStore(name);
  } catch (_) {
    return getStore({
      name,
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN
    });
  }
}

const STATE_STORE = 'pm-feed-state';
const PLAN_STORE = 'pm-feed-plans';
const LOG_STORE = 'pm-feed-logs';

async function loadPlan(feedId) {
  const store = rdcStore(PLAN_STORE);
  const raw = await store.get('plan::' + feedId);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function loadState(feedId) {
  const store = rdcStore(STATE_STORE);
  const raw = await store.get('state::' + feedId);
  if (!raw) {
    const e = new Error('NO_STATE: run pm-sync with commit=1 first');
    e.fatal = true;
    throw e;
  }
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function saveState(state) {
  const store = rdcStore(STATE_STORE);
  await store.set('state::' + state.feedId, JSON.stringify(state));
}

async function saveLog(feedId, log) {
  try {
    const store = rdcStore(LOG_STORE);
    await store.set('log::' + feedId + '::' + Date.now(), JSON.stringify(log));
  } catch (_) {
    /* logging must never break a run */
  }
}

/* ------------------------------------------------------------------ *
 * field mapping
 *
 * Every value below was confirmed by reading a live listing back through
 * the API on 2026-07-27. Dropdowns take the option KEY, never the label.
 * ------------------------------------------------------------------ */

const PROPERTY_TYPE_MAP = {
  APARTMENT: 'apartment_',
  CONDO: 'condo',
  CONDOMINIUM: 'condo',
  HOUSE: 'house_',
  SINGLEFAMILY: 'house_',
  'SINGLE FAMILY': 'house_',
  'SINGLE FAMILY HOME': 'house_',
  'SINGLE-FAMILY': 'house_',
  TOWNHOUSE: 'townhouse',
  TOWNHOME: 'townhouse',
  ADU: 'accessory_unit_',
  'ACCESSORY UNIT': 'accessory_unit_',
  DUPLEX: 'house_',
  LARGE: 'apartment_',
  SMALL: 'apartment_',
  MULTIFAMILY: 'apartment_',
  LOFT: 'apartment_',
  STUDIO: 'apartment_'
};

const SUB_TYPE_MAP = {
  STUDIO: 'studio_',
  LOFT: 'loft_',
  ROOM: 'room_',
  FLAT: 'flat_',
  DUPLEX: 'duplex_',
  TRIPLEX: 'triplex_',
  VILLA: 'villa_',
  MANSION: 'mansion',
  BASEMENT: 'basement',
  HIGHRISE: 'highrise',
  MIDRISE: 'midrise',
  LOWRISE: 'lowrise',
  PENTHOUSE: 'penthouse'
};

function mapPropertyType(raw) {
  if (!raw) return 'something_else_';
  const k = String(raw).trim().toUpperCase();
  return PROPERTY_TYPE_MAP[k] || 'something_else_';
}

function mapSubType(unit) {
  const candidates = [unit.propertyTypeRaw, unit.modelName, unit.propertyName];
  for (const c of candidates) {
    if (!c) continue;
    const k = String(c).trim().toUpperCase();
    if (SUB_TYPE_MAP[k]) return SUB_TYPE_MAP[k];
  }
  if (unit.beds === 0) return 'studio_';
  return 'no_sub_type';
}

function mapDuration(unit) {
  const t = (unit.leaseTerm || '').toString().toUpperCase();
  if (t.indexOf('MONTHTOMONTH') !== -1 || t.indexOf('MONTH_TO_MONTH') !== -1) return 'mid';
  if (t.indexOf('SHORT') !== -1 || t.indexOf('DAILY') !== -1 || t.indexOf('WEEKLY') !== -1)
    return 'short';
  return 'long_';
}

function mapFurnished(unit) {
  return unit.isFurnished === true ? 'furnished_' : 'unfurnished_';
}

/**
 * The display template runs number_format() on property_beds, which
 * returns 0 for the non-numeric key "more_than_4_". A 5-bedroom unit
 * would therefore render as 0 beds. Cap at 4 instead — understating by
 * one is far better than showing zero.
 */
function mapBeds(beds) {
  if (beds === null || beds === undefined) return null;
  const n = Number(beds);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return '0';
  if (n >= 4) return '4';
  return String(Math.round(n));
}

/**
 * Baths render through floatval(number_format(x,1)) which handles halves
 * correctly. Snap to the nearest allowed option: 1 1.5 2 2.5 3 3.5 4.
 */
const BATH_OPTIONS = [1, 1.5, 2, 2.5, 3, 3.5, 4];

function mapBaths(total) {
  if (total === null || total === undefined) return null;
  const n = Number(total);
  if (!Number.isFinite(n)) return null;
  if (n >= 4) return '4';
  if (n <= 1) return '1';
  let best = BATH_OPTIONS[0];
  let bestDiff = Infinity;
  for (const opt of BATH_OPTIONS) {
    const d = Math.abs(opt - n);
    if (d < bestDiff) {
      bestDiff = d;
      best = opt;
    }
  }
  return String(best);
}

/** BD stores money comma-formatted: "1,900.00". Match it exactly. */
function money(n) {
  if (n === null || n === undefined) return null;
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function plainMoney(n) {
  if (n === null || n === undefined) return null;
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return v.toFixed(2);
}

function buildLocation(unit) {
  const parts = [];
  if (unit.street && !unit.streetHidden) parts.push(unit.street);
  if (unit.unitNumber) parts.push(unit.unitNumber);
  const line1 = parts.join(' ');
  const tail = [unit.city, unit.state].filter(Boolean).join(', ');
  const full = [line1, tail, unit.zip].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return full || null;
}

function buildTitle(unit) {
  if (unit.streetHidden) {
    const bits = [unit.propertyName, unit.unitNumber].filter(Boolean).join(' ');
    if (bits) return bits;
    return [unit.city, unit.state].filter(Boolean).join(', ');
  }
  const street = [unit.street, unit.unitNumber].filter(Boolean).join(' ');
  return street || [unit.city, unit.state].filter(Boolean).join(', ');
}

function buildDescription(unit) {
  const body = (unit.description || '').trim();
  const extras = [];
  if (unit.dateAvailable) extras.push('Available ' + unit.dateAvailable);
  if (unit.laundry) extras.push('Laundry: ' + unit.laundry);
  if (unit.parkingType) extras.push('Parking: ' + unit.parkingType);
  if (unit.heatingSystem) extras.push('Heating: ' + unit.heatingSystem);
  if (unit.coolingSystem) extras.push('Cooling: ' + unit.coolingSystem);
  if (unit.catsAllowed === true || unit.dogsAllowed === true) {
    const pets = [];
    if (unit.catsAllowed) pets.push('cats');
    if (unit.dogsAllowed) pets.push('dogs');
    extras.push('Pets: ' + pets.join(', '));
  }
  if (unit.rentIncludes && unit.rentIncludes.length)
    extras.push('Rent includes: ' + unit.rentIncludes.join(', '));

  let html = body ? '<p>' + escapeHtml(body) + '</p>' : '';
  if (extras.length) {
    html += '<ul>' + extras.map((e) => '<li>' + escapeHtml(e) + '</li>').join('') + '</ul>';
  }
  return html || null;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Builds the form-encoded body for a create or update.
 *
 * Publish status is ALWAYS draft on create. BD is set to Admin Moderates
 * All Posts and imported inventory has not been reviewed. Nothing in this
 * file publishes anything.
 */
function buildPayload(unit, opts) {
  const options = opts || {};
  const p = {};

  p.user_id = String(options.memberId);
  p.data_id = PROPERTY_DATA_ID;
  p.data_type = PROPERTY_DATA_TYPE;

  if (options.groupId) p.group_id = String(options.groupId);
  p.group_status = options.status === 'live' ? '1' : '0';

  const title = buildTitle(unit);
  if (title) p.group_name = title;

  const desc = buildDescription(unit);
  if (desc) p.group_desc = desc;

  const loc = buildLocation(unit);
  if (loc) p.post_location = loc;

  if (unit.lat !== null && unit.lat !== undefined) p.lat = String(unit.lat);
  if (unit.lon !== null && unit.lon !== undefined) p.lon = String(unit.lon);

  const rent = money(unit.rent);
  if (rent) {
    p.post_promo = rent;
    p.property_price = plainMoney(unit.rent);
  }

  const dep = money(unit.deposit);
  if (dep) p.deposit_amount = dep;

  if (unit.rent !== null && unit.deposit !== null && unit.rent !== undefined) {
    const total = Number(unit.rent) + Number(unit.deposit) + Number(unit.applicationFee || 0);
    const t = money(total);
    if (t) p.total_cost_to_movei = t;
  }

  const beds = mapBeds(unit.beds);
  if (beds !== null) p.property_beds = beds;

  const baths = mapBaths(unit.bathsTotal);
  if (baths !== null) p.property_baths = baths;

  if (unit.sqft) p.property_sqr_foot = String(Math.round(Number(unit.sqft)));
  if (unit.yearBuilt) p.year_built = String(unit.yearBuilt);

  p.property_type = mapPropertyType(unit.propertyTypeRaw);
  p.sub_property_type = mapSubType(unit);
  p.property_duration = mapDuration(unit);
  p.status = mapFurnished(unit);

  if (unit.dateAvailable) p.date_available = unit.dateAvailable;
  p.external_unit_id = unit.externalKey;

  const photos = (unit.photosForImport || []).map((x) => x.url).filter(Boolean);
  if (photos.length && options.includePhotos !== false) {
    p.post_image = photos.join(',');
    p.auto_image_import = '1';
  }

  return p;
}

function encode(obj) {
  return Object.keys(obj)
    .filter((k) => obj[k] !== null && obj[k] !== undefined)
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]))
    .join('&');
}

/* ------------------------------------------------------------------ *
 * BD transport
 * ------------------------------------------------------------------ */

function apiKey() {
  const k = process.env.BD_API_KEY_FEED;
  if (!k) {
    const e = new Error('MISSING_BD_API_KEY_FEED');
    e.fatal = true;
    throw e;
  }
  return k;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bdCall(method, path, bodyObj) {
  const url = BD_BASE + path;
  let lastErr = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1] || 8000);

    let res;
    let text;
    try {
      res = await fetch(url, {
        method,
        headers: {
          'X-Api-Key': apiKey(),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: bodyObj ? encode(bodyObj) : undefined
      });
      text = await res.text();
    } catch (err) {
      lastErr = 'NETWORK: ' + (err.message || err);
      continue;
    }

    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { status: 'error', message: text.slice(0, 300) };
    }

    if (res.status === 429) {
      lastErr = 'RATE_LIMITED';
      continue;
    }

    // BD has been observed reporting throttling as a 400 "user not found",
    // which is indistinguishable from a genuine miss. Retry it as if it
    // were a rate limit rather than treating it as a hard failure.
    const msg = typeof data.message === 'string' ? data.message.toLowerCase() : '';
    if (res.status === 400 && msg.indexOf('not found') !== -1) {
      lastErr = 'POSSIBLE_THROTTLE_400: ' + msg.slice(0, 120);
      continue;
    }

    return {
      httpStatus: res.status,
      data,
      raw: text.slice(0, 500),
      url,
      // A 403 and a 404 both read as "the endpoint does not work" if the
      // body is not inspected. That confusion caused the pw-v1 incident.
      // Name the failure class explicitly.
      failureClass:
        res.status === 403
          ? 'PERMISSION - the API key lacks this endpoint. Check key permissions, NOT the URL.'
          : res.status === 404
          ? 'NOT_FOUND - wrong URL or the record does not exist. Check the composed url field.'
          : res.status === 401
          ? 'AUTH - key missing or rejected.'
          : undefined
    };
  }

  return { httpStatus: 0, data: { status: 'error', message: lastErr }, raw: lastErr };
}

async function bdCreate(payload) {
  return bdCall('POST', '/api/v2/users_portfolio_groups/create', payload);
}

async function bdUpdate(payload) {
  return bdCall('PUT', '/api/v2/users_portfolio_groups/update', payload);
}

async function bdRead(groupId) {
  const r = await bdCall('GET', '/api/v2/users_portfolio_groups/get/' + groupId, null);
  const m = r.data && r.data.message;
  if (Array.isArray(m)) return m[0] || null;
  if (m && typeof m === 'object') return m;
  return null;
}

/**
 * Extracts a group_id from a create response. BD returns this in more than
 * one shape depending on endpoint, so check several before giving up.
 */
function extractGroupId(data) {
  if (!data) return null;
  const m = data.message;
  if (m && typeof m === 'object' && !Array.isArray(m)) {
    if (m.group_id) return String(m.group_id);
  }
  if (Array.isArray(m) && m[0] && m[0].group_id) return String(m[0].group_id);
  if (data.group_id) return String(data.group_id);
  if (typeof m === 'string') {
    const digits = m.replace(/[^0-9]/g, '');
    if (digits && digits.length < 12) return digits;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * verification
 *
 * BD's write endpoints return success for values that were silently filed
 * or rejected. The only proof a write landed is reading it back. Every
 * item in this file is verified before its state is marked confirmed.
 * ------------------------------------------------------------------ */

function verifyRecord(record, payload) {
  const problems = [];
  if (!record) return { ok: false, problems: ['READ_BACK_EMPTY'] };

  const check = (field, expected, actual, normalize) => {
    if (expected === null || expected === undefined) return;
    const e = normalize ? normalize(expected) : String(expected);
    const a = normalize ? normalize(actual) : actual === null || actual === undefined ? '' : String(actual);
    if (e !== a) problems.push(field + ': sent ' + e + ', stored ' + (a || 'EMPTY'));
  };

  const numish = (v) => String(v === null || v === undefined ? '' : v).replace(/[$,\s]/g, '');

  check('property_beds', payload.property_beds, record.property_beds);
  check('property_baths', payload.property_baths, record.property_baths);
  check('property_sqr_foot', payload.property_sqr_foot, record.property_sqr_foot, numish);
  check('post_promo', payload.post_promo, record.post_promo, numish);
  check('external_unit_id', payload.external_unit_id, record.external_unit_id);
  check('group_status', payload.group_status, record.group_status);
  check('property_type', payload.property_type, record.property_type);

  if (payload.date_available) {
    check('date_available', payload.date_available, record.date_available);
  }

  // The listing table carries FOUR bed/bath columns: property_beds,
  // property_baths, and the legacy bed_rooms / property_bedrooms. Only the
  // first pair is writable via custom_fields and only that pair is written
  // here. If the legacy columns ever populate, they can disagree with the
  // real values and the display layer may pick the wrong one. Surface it
  // rather than silently tolerating it.
  if (record.bed_rooms !== null && record.bed_rooms !== undefined && record.bed_rooms !== '') {
    problems.push('legacy bed_rooms is populated (' + record.bed_rooms + ') - investigate before trusting display');
  }
  if (
    record.property_bedrooms !== null &&
    record.property_bedrooms !== undefined &&
    record.property_bedrooms !== ''
  ) {
    problems.push(
      'legacy property_bedrooms is populated (' + record.property_bedrooms + ') - investigate before trusting display'
    );
  }

  return { ok: problems.length === 0, problems };
}

/**
 * auto_image_import is BD fetching from the PM's CDN — a third party call
 * inside a third party call. Hotlink protection, a 404 or an unsupported
 * format can all still return success on the create. Count what landed.
 */
function verifyPhotos(record, expectedCount) {
  if (!expectedCount) return { ok: true, expected: 0, found: 0, note: 'no photos sent' };
  const list = Array.isArray(record && record.users_portfolio) ? record.users_portfolio : [];
  return {
    ok: list.length > 0,
    expected: expectedCount,
    found: list.length,
    note:
      list.length === 0
        ? 'BD reported success but imported no photos. Check CDN hotlink protection.'
        : list.length < expectedCount
        ? 'partial import, may still be processing'
        : 'ok'
  };
}

/* ------------------------------------------------------------------ *
 * execution
 * ------------------------------------------------------------------ */

async function executeItem(item, kind, memberId, dryrun) {
  const unit = item.unit;
  const isDelist = kind === 'delist';

  let payload;
  if (isDelist) {
    payload = {
      group_id: String(item.groupId),
      data_id: PROPERTY_DATA_ID,
      data_type: PROPERTY_DATA_TYPE,
      user_id: String(memberId),
      group_status: '0'
    };
  } else {
    payload = buildPayload(unit, {
      memberId,
      groupId: item.groupId || null,
      status: 'draft',
      includePhotos: kind === 'create'
    });
  }

  const result = {
    externalKey: item.externalKey,
    kind,
    groupId: item.groupId || null,
    payloadKeys: Object.keys(payload).length,
    payload: dryrun ? payload : undefined
  };

  if (dryrun) {
    result.status = 'DRYRUN';
    return result;
  }

  const write = kind === 'create' ? await bdCreate(payload) : await bdUpdate(payload);
  result.httpStatus = write.httpStatus;
  result.apiStatus = write.data && write.data.status;

  if (!write.data || write.data.status !== 'success') {
    result.status = 'WRITE_FAILED';
    result.error = (write.data && write.data.message) || write.raw;
    return result;
  }

  const groupId = item.groupId || extractGroupId(write.data);
  if (!groupId) {
    result.status = 'NO_GROUP_ID';
    result.error = 'Write reported success but no group_id could be read from the response.';
    return result;
  }
  result.groupId = groupId;

  await sleep(PACE_MS);
  const record = await bdRead(groupId);
  const verify = verifyRecord(record, payload);
  result.verified = verify.ok;
  result.problems = verify.problems;

  if (kind === 'create') {
    result.photos = verifyPhotos(record, (unit.photosForImport || []).length);
  }

  result.status = verify.ok ? 'OK' : 'VERIFY_FAILED';
  return result;
}

function stateAfter(kind) {
  if (kind === 'delist') return 'delisted';
  return 'live';
}

async function runPlan(feedId, plan, state, opts) {
  const started = Date.now();
  const dryrun = opts.dryrun;
  const limit = opts.limit || DEFAULT_ITEM_LIMIT;
  const memberId = opts.memberId || plan.memberId;

  if (!memberId) {
    const e = new Error('NO_MEMBER_ID: imported listings need an owning BD member');
    e.fatal = true;
    throw e;
  }

  const queue = [];
  for (const c of plan.creates || []) queue.push({ item: c, kind: 'create' });
  for (const u of plan.updates || []) queue.push({ item: u, kind: 'update' });
  for (const r of plan.reactivates || []) queue.push({ item: r, kind: 'reactivate' });
  for (const d of plan.delists || []) queue.push({ item: d, kind: 'delist' });

  const results = [];
  let processed = 0;
  let budgetHit = false;

  for (const q of queue) {
    if (processed >= limit) break;
    if (Date.now() - started > TIME_BUDGET_MS) {
      budgetHit = true;
      break;
    }

    let r;
    try {
      r = await executeItem(q.item, q.kind, memberId, dryrun);
    } catch (err) {
      r = {
        externalKey: q.item.externalKey,
        kind: q.kind,
        status: 'EXCEPTION',
        error: String(err.message || err)
      };
    }
    results.push(r);
    processed++;

    if (!dryrun && r.status === 'OK') {
      const prev = state.units[r.externalKey] || {};
      state.units[r.externalKey] = {
        ...prev,
        externalKey: r.externalKey,
        groupId: r.groupId,
        status: stateAfter(q.kind),
        snapshot: q.item.snapshot || prev.snapshot || null,
        lastUpdated:
          (q.item.unit && q.item.unit.lastUpdated) || prev.pendingLastUpdated || prev.lastUpdated || null,
        unitNumber: (q.item.unit && q.item.unit.unitNumber) || prev.unitNumber || null,
        street: (q.item.unit && q.item.unit.street) || prev.street || null,
        confirmedAt: new Date().toISOString()
      };
      delete state.units[r.externalKey].pendingSnapshot;
      delete state.units[r.externalKey].pendingLastUpdated;
    }

    if (!dryrun) await sleep(PACE_MS);
  }

  const tally = {};
  for (const r of results) tally[r.status] = (tally[r.status] || 0) + 1;

  return {
    feedId,
    dryrun,
    memberId,
    queued: queue.length,
    processed,
    remaining: queue.length - processed,
    budgetHit,
    elapsedMs: Date.now() - started,
    tally,
    results
  };
}

/* ------------------------------------------------------------------ *
 * handler
 * ------------------------------------------------------------------ */

const json = (code, body) => ({
  statusCode: code,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'X-Function-Version': WRITE_VERSION
  },
  body: JSON.stringify({ version: WRITE_VERSION, ...body }, null, 2)
});

exports.handler = async (event) => {
  const q = (event && event.queryStringParameters) || {};

  try {
    const required = process.env.PM_FEED_TOKEN;
    if (required && q.token !== required) return json(401, { ok: false, error: 'bad token' });

    if (q.selftest === '1') {
      const t = runSelfTest();
      return json(t.failed === 0 ? 200 : 500, { ok: t.failed === 0, selftest: t });
    }

    const feedId = q.feedId || null;
    if (!feedId) {
      return json(200, {
        ok: true,
        status: 'ready',
        keyConfigured: !!process.env.BD_API_KEY_FEED,
        bdBaseRaw: BD_BASE_RAW,
        bdOriginResolved: BD_BASE,
        composedUrls: {
          create: BD_BASE + '/api/v2/users_portfolio_groups/create',
          update: BD_BASE + '/api/v2/users_portfolio_groups/update',
          read: BD_BASE + '/api/v2/users_portfolio_groups/get/{group_id}'
        },
        sharedConfigWarning:
          'BD_API_BASE is shared platform-wide. Its canonical value includes /api/v2. ' +
          'This function normalizes it and must never be a reason to change it. ' +
          'Use BD_FEED_API_BASE if this endpoint alone ever needs a different base.',
        usage: {
          dryrun: '?feedId=<id>&dryrun=1  (default, builds payloads, writes nothing)',
          execute: '?feedId=<id>&execute=1',
          limit: '&limit=N  (default ' + DEFAULT_ITEM_LIMIT + ')',
          selftest: '?selftest=1'
        },
        safety: {
          neverDeletes: true,
          alwaysDraftOnCreate: true,
          readBackVerified: true,
          paceMs: PACE_MS
        }
      });
    }

    const plan = await loadPlan(feedId);
    if (!plan) {
      return json(404, {
        ok: false,
        error: 'NO_PLAN',
        detail: 'Run pm-sync?feedId=' + feedId + '&commit=1 first.'
      });
    }
    if (plan.aborted) {
      return json(409, {
        ok: false,
        error: 'PLAN_WAS_ABORTED',
        breaker: plan.breaker,
        detail: 'The stored plan tripped the circuit breaker and will not be executed.'
      });
    }

    const state = await loadState(feedId);
    const dryrun = q.execute !== '1';
    const limit = parseInt(q.limit || '0', 10) || DEFAULT_ITEM_LIMIT;

    const run = await runPlan(feedId, plan, state, {
      dryrun,
      limit,
      memberId: q.memberId || null
    });

    if (!dryrun) {
      state.lastWriteRun = new Date().toISOString();
      state.lastWriteTally = run.tally;
      await saveState(state);
      await saveLog(feedId, run);
    }

    return json(200, {
      ok: true,
      mode: dryrun ? 'dryrun' : 'execute',
      persisted: !dryrun,
      note: dryrun
        ? 'Nothing was written to BD. Inspect the payloads, then add &execute=1.'
        : run.remaining > 0
        ? 'Partial run. ' + run.remaining + ' items remain. Call again to continue.'
        : 'Run complete.',
      run
    });
  } catch (err) {
    return json(500, {
      ok: false,
      error: String(err.message || err),
      fatal: !!err.fatal
    });
  }
};

/* ------------------------------------------------------------------ *
 * self test
 * ------------------------------------------------------------------ */

function fixtureUnit(over) {
  return Object.assign(
    {
      externalKey: 'pm77::willow::A1',
      importable: true,
      issues: [],
      street: '900 SE Belmont',
      streetHidden: false,
      unitNumber: 'Apt 101',
      city: 'Portland',
      state: 'OR',
      zip: '97214',
      lat: 45.5163,
      lon: -122.6544,
      beds: 2,
      fullBaths: 1,
      halfBaths: 1,
      bathsTotal: 1.5,
      sqft: 900,
      yearBuilt: 2013,
      rent: 1900,
      deposit: 1900,
      applicationFee: 49,
      dateAvailable: '2026-09-01',
      propertyTypeRaw: 'SINGLE FAMILY HOME',
      leaseTerm: 'OneYear',
      isFurnished: false,
      description: 'Nice place & "cozy"',
      catsAllowed: true,
      dogsAllowed: false,
      laundry: 'IN_UNIT',
      rentIncludes: ['Water'],
      photosForImport: [{ url: 'https://cdn.example.com/1.jpg' }, { url: 'https://cdn.example.com/2.jpg' }]
    },
    over || {}
  );
}

function runSelfTest() {
  const checks = [];
  const ok = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });

  // --- payload shape
  {
    const p = buildPayload(fixtureUnit(), { memberId: 4144, status: 'draft' });
    ok('draft on create', p.group_status === '0', p.group_status);
    ok('data_id set', p.data_id === '12', p.data_id);
    ok('user_id set', p.user_id === '4144', p.user_id);
    ok('external key written', p.external_unit_id === 'pm77::willow::A1', p.external_unit_id);
    ok('rent comma formatted', p.post_promo === '1,900.00', p.post_promo);
    ok('property_price plain', p.property_price === '1900.00', p.property_price);
    ok('deposit formatted', p.deposit_amount === '1,900.00', p.deposit_amount);
    ok('move-in total summed', p.total_cost_to_movei === '3,849.00', p.total_cost_to_movei);
    ok('location single string', p.post_location === '900 SE Belmont Apt 101 Portland, OR 97214', p.post_location);
    ok('lat passed through', p.lat === '45.5163', p.lat);
    ok('date_available ISO', p.date_available === '2026-09-01', p.date_available);
    ok('photos comma joined', p.post_image.indexOf(',') !== -1, p.post_image);
    ok('auto_image_import on', p.auto_image_import === '1', p.auto_image_import);
    ok('description escaped', p.group_desc.indexOf('&amp;') !== -1, p.group_desc.slice(0, 60));
  }

  // --- dropdown keys, never labels
  {
    const p = buildPayload(fixtureUnit(), { memberId: 1, status: 'draft' });
    ok('property_type is key', p.property_type === 'house_', p.property_type);
    ok('duration is key', p.property_duration === 'long_', p.property_duration);
    ok('furnished is key', p.status === 'unfurnished_', p.status);
    ok('subtype defaults', p.sub_property_type === 'no_sub_type', p.sub_property_type);
    const apt = buildPayload(fixtureUnit({ propertyTypeRaw: 'APARTMENT' }), { memberId: 1 });
    ok('apartment maps', apt.property_type === 'apartment_', apt.property_type);
    const unknown = buildPayload(fixtureUnit({ propertyTypeRaw: 'YURT' }), { memberId: 1 });
    ok('unknown type falls back', unknown.property_type === 'something_else_', unknown.property_type);
    const studio = buildPayload(fixtureUnit({ beds: 0 }), { memberId: 1 });
    ok('zero beds becomes studio', studio.sub_property_type === 'studio_', studio.sub_property_type);
  }

  // --- the beds display trap
  {
    ok('1 bed', mapBeds(1) === '1', mapBeds(1));
    ok('4 beds', mapBeds(4) === '4', mapBeds(4));
    ok('6 beds capped at 4 not more_than_4_', mapBeds(6) === '4', mapBeds(6));
    ok('0 beds', mapBeds(0) === '0', mapBeds(0));
    ok('null beds omitted', mapBeds(null) === null, mapBeds(null));
  }

  // --- baths including halves
  {
    ok('1.5 baths preserved', mapBaths(1.5) === '1.5', mapBaths(1.5));
    ok('2.5 baths preserved', mapBaths(2.5) === '2.5', mapBaths(2.5));
    ok('3.5 baths preserved', mapBaths(3.5) === '3.5', mapBaths(3.5));
    ok('2.25 snaps to nearest', mapBaths(2.25) === '2' || mapBaths(2.25) === '2.5', mapBaths(2.25));
    ok('5 baths capped', mapBaths(5) === '4', mapBaths(5));
  }

  // --- hidden street
  {
    const p = buildPayload(fixtureUnit({ streetHidden: true, propertyName: 'Willow Creek' }), {
      memberId: 1
    });
    ok('hidden street omitted from location', p.post_location.indexOf('Belmont') === -1, p.post_location);
    ok('hidden street titled by property', p.group_name.indexOf('Willow Creek') !== -1, p.group_name);
  }

  // --- update payload carries required trio
  {
    const p = buildPayload(fixtureUnit(), { memberId: 4144, groupId: 251, status: 'draft' });
    ok('update carries group_id', p.group_id === '251', p.group_id);
    ok('update carries data_id', p.data_id === '12', p.data_id);
    ok('update carries user_id', p.user_id === '4144', p.user_id);
  }

  // --- verification logic
  {
    const p = buildPayload(fixtureUnit(), { memberId: 1 });
    const good = {
      property_beds: '2',
      property_baths: '1.5',
      property_sqr_foot: '900',
      post_promo: '1,900.00',
      external_unit_id: 'pm77::willow::A1',
      group_status: '0',
      property_type: 'house_',
      date_available: '2026-09-01'
    };
    ok('verify passes on match', verifyRecord(good, p).ok, '');

    const swapped = { ...good, property_beds: '1.5', property_baths: '2' };
    ok('verify catches bed/bath swap', !verifyRecord(swapped, p).ok, verifyRecord(swapped, p).problems.join('; '));

    const missingKey = { ...good, external_unit_id: null };
    ok('verify catches dropped external id', !verifyRecord(missingKey, p).ok, '');

    const published = { ...good, group_status: '1' };
    ok('verify catches unexpected publish', !verifyRecord(published, p).ok, '');

    ok('verify fails on empty read', !verifyRecord(null, p).ok, 'READ_BACK_EMPTY');

    const commaTolerant = { ...good, post_promo: '1900.00' };
    ok('verify tolerates money formatting', verifyRecord(commaTolerant, p).ok, '');
  }

  // --- photo verification
  {
    ok('photo miss detected', !verifyPhotos({ users_portfolio: [] }, 2).ok, 'none imported');
    ok('photo hit detected', verifyPhotos({ users_portfolio: [{}, {}] }, 2).ok, 'ok');
    ok('no photos sent is fine', verifyPhotos({ users_portfolio: [] }, 0).ok, 'none expected');
  }

  // --- group id extraction
  {
    ok('group_id from object', extractGroupId({ message: { group_id: '251' } }) === '251', '');
    ok('group_id from array', extractGroupId({ message: [{ group_id: '252' }] }) === '252', '');
    ok('group_id from top level', extractGroupId({ group_id: '253' }) === '253', '');
    ok('group_id absent returns null', extractGroupId({ message: 'ok' }) === null, '');
  }

  // --- delist payload never carries content
  {
    const p = {
      group_id: '251',
      data_id: PROPERTY_DATA_ID,
      data_type: PROPERTY_DATA_TYPE,
      user_id: '4144',
      group_status: '0'
    };
    ok('delist sets draft', p.group_status === '0', p.group_status);
    ok('delist sends no photos', !p.post_image, 'none');
    ok('delist sends no description', !p.group_desc, 'none');
  }

  const failed = checks.filter((c) => !c.pass);
  return {
    passed: checks.length - failed.length,
    failed: failed.length,
    total: checks.length,
    result: failed.length === 0 ? 'ALL PASS' : 'FAILURES PRESENT',
    checks
  };
}

exports.buildPayload = buildPayload;
exports.mapBeds = mapBeds;
exports.mapBaths = mapBaths;
exports.verifyRecord = verifyRecord;
exports.runSelfTest = runSelfTest;
exports.WRITE_VERSION = WRITE_VERSION;
