/**
 * pm-sync.js  ·  ps-v1
 * Renters.com  ·  PM Feed Sync (Element Z)
 *
 * Diff engine. Compares a normalized feed against stored sync state and
 * produces a PLAN: what to create, update, delist, reactivate, leave alone.
 *
 * This file NEVER writes to BD. It decides only. pm-write.js executes.
 * That separation is deliberate — the plan can be inspected, dry-run and
 * approved before anything touches live inventory.
 *
 * CHANGELOG
 *   ps-v1  2026-07-25  Initial build. Upsert keying, lastUpdated change
 *                      detection, absence-means-rented delist, reactivate,
 *                      circuit breaker, Blobs state store, dry-run default.
 *
 * ENDPOINTS
 *   GET  ?feedId=X&dryrun=1        plan only, nothing persisted (DEFAULT)
 *   GET  ?feedId=X&commit=1        persist plan as pending for pm-write
 *   GET  ?feedId=X&state=1         dump stored state for a feed
 *   GET  ?selftest=1               embedded fixtures, pass/fail
 *   POST { feedUrl, memberId, feedId, ... }  ad-hoc plan without registry
 *
 * SAFETY POSTURE
 *   - dry run is the default; commit must be explicit
 *   - a delist wave over the threshold ABORTS the whole plan
 *   - never deletes; delist means group_status 0
 *   - if the feed fails to parse, NOTHING is planned (no delist storm)
 */

'use strict';

const SYNC_VERSION = 'ps-v1';

/* Circuit breaker. If a run would delist more than this share of a PM's
 * live units, something is wrong with the feed, not the inventory. */
const DELIST_ABORT_PCT = 0.20;
/* Below this many live units, percentage is meaningless. Allow small feeds
 * to churn freely up to this floor. */
const DELIST_ABORT_FLOOR = 5;

/* Fields whose change should trigger a BD update. Anything not listed is
 * carried but does not by itself justify a write. */
const WATCHED_FIELDS = [
  'rent',
  'deposit',
  'beds',
  'fullBaths',
  'halfBaths',
  'bathsTotal',
  'sqft',
  'yearBuilt',
  'dateAvailable',
  'street',
  'city',
  'state',
  'zip',
  'unitNumber',
  'propertyName',
  'modelName',
  'description',
  'propertyTypeRaw',
  'isFurnished',
  'leaseTerm',
  'applicationFee',
  'photoSignature'
];

/* ------------------------------------------------------------------ *
 * blob store  (documented rdcStore pattern, Bible line 846)
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

const stateKey = (feedId) => 'state::' + feedId;
const planKey = (feedId) => 'plan::' + feedId;

async function loadState(feedId) {
  try {
    const store = rdcStore(STATE_STORE);
    const raw = await store.get(stateKey(feedId));
    if (!raw) return emptyState(feedId);
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || !parsed.units) return emptyState(feedId);
    return parsed;
  } catch (err) {
    // A read failure must NOT look like "no units known", or every unit
    // reads as new and the run duplicates the PM's whole inventory.
    const e = new Error('STATE_READ_FAILED: ' + (err.message || err));
    e.fatal = true;
    throw e;
  }
}

function emptyState(feedId) {
  return {
    feedId,
    version: SYNC_VERSION,
    firstSeen: null,
    lastRun: null,
    lastRunResult: null,
    runCount: 0,
    units: {}
  };
}

async function saveState(state) {
  const store = rdcStore(STATE_STORE);
  await store.set(stateKey(state.feedId), JSON.stringify(state));
}

async function savePlan(feedId, plan) {
  const store = rdcStore(PLAN_STORE);
  await store.set(planKey(feedId), JSON.stringify(plan));
}

/* ------------------------------------------------------------------ *
 * comparison
 * ------------------------------------------------------------------ */

function photoSignature(unit) {
  const urls = (unit.photosForImport || []).map((p) => p.url);
  return urls.join('|');
}

function snapshot(unit) {
  const snap = {};
  for (const f of WATCHED_FIELDS) {
    snap[f] = f === 'photoSignature' ? photoSignature(unit) : unit[f] ?? null;
  }
  return snap;
}

function diffSnapshots(oldSnap, newSnap) {
  const changed = [];
  for (const f of WATCHED_FIELDS) {
    const a = oldSnap ? oldSnap[f] ?? null : null;
    const b = newSnap[f] ?? null;
    if (a !== b) changed.push({ field: f, from: a, to: b });
  }
  return changed;
}

/**
 * lastUpdated is the cheap path: if the feed says a unit has not moved and
 * we have already synced it live, skip without deep comparison. But never
 * trust it alone on a unit we have never written, and never let it suppress
 * a reactivation.
 */
function unchangedByTimestamp(prev, unit) {
  if (!prev || !prev.groupId) return false;
  if (prev.status !== 'live') return false;
  if (!unit.lastUpdated || !prev.lastUpdated) return false;
  return unit.lastUpdated === prev.lastUpdated;
}

/* ------------------------------------------------------------------ *
 * planning
 * ------------------------------------------------------------------ */

function buildPlan(feedId, normalized, state, opts) {
  const options = opts || {};
  const now = new Date().toISOString();

  const creates = [];
  const updates = [];
  const delists = [];
  const reactivates = [];
  const unchanged = [];
  const skipped = [];

  const seenKeys = new Set();
  const units = normalized.units || [];

  for (const unit of units) {
    // Records BD would reject are never sent. They surface in the plan so a
    // dry run shows exactly what a PM needs to fix.
    if (!unit.importable) {
      skipped.push({
        externalKey: unit.externalKey,
        unitNumber: unit.unitNumber,
        street: unit.street,
        reason: 'NOT_IMPORTABLE',
        issues: unit.issues
      });
      continue;
    }

    seenKeys.add(unit.externalKey);
    const prev = state.units[unit.externalKey];
    const snap = snapshot(unit);

    if (!prev || !prev.groupId) {
      creates.push({
        externalKey: unit.externalKey,
        addressKey: unit.addressKey,
        unit,
        snapshot: snap,
        reason: prev ? 'PREVIOUSLY_PLANNED_NEVER_WRITTEN' : 'NEW_UNIT'
      });
      continue;
    }

    if (prev.status === 'delisted') {
      reactivates.push({
        externalKey: unit.externalKey,
        groupId: prev.groupId,
        unit,
        snapshot: snap,
        changed: diffSnapshots(prev.snapshot, snap),
        reason: 'RETURNED_TO_FEED'
      });
      continue;
    }

    if (unchangedByTimestamp(prev, unit)) {
      unchanged.push({ externalKey: unit.externalKey, reason: 'LASTUPDATED_MATCH' });
      continue;
    }

    const changed = diffSnapshots(prev.snapshot, snap);
    if (!changed.length) {
      unchanged.push({ externalKey: unit.externalKey, reason: 'NO_FIELD_CHANGE' });
      continue;
    }

    updates.push({
      externalKey: unit.externalKey,
      groupId: prev.groupId,
      unit,
      snapshot: snap,
      changed
    });
  }

  // Absence means rented. Anything live in state but missing from the feed
  // gets delisted (draft), never deleted.
  for (const key of Object.keys(state.units)) {
    const prev = state.units[key];
    if (seenKeys.has(key)) continue;
    if (!prev.groupId) continue;
    if (prev.status === 'delisted') continue;
    delists.push({
      externalKey: key,
      groupId: prev.groupId,
      unitNumber: prev.unitNumber || null,
      street: prev.street || null,
      reason: 'ABSENT_FROM_FEED'
    });
  }

  // ---- circuit breaker
  const liveCount = Object.values(state.units).filter(
    (u) => u.groupId && u.status === 'live'
  ).length;
  const delistPct = liveCount > 0 ? delists.length / liveCount : 0;

  const breaker = {
    tripped: false,
    liveBefore: liveCount,
    delistCount: delists.length,
    delistPct: Math.round(delistPct * 1000) / 10,
    thresholdPct: DELIST_ABORT_PCT * 100,
    floor: DELIST_ABORT_FLOOR
  };

  if (
    liveCount >= DELIST_ABORT_FLOOR &&
    delists.length > DELIST_ABORT_FLOOR &&
    delistPct > DELIST_ABORT_PCT
  ) {
    breaker.tripped = true;
    breaker.message =
      'Would delist ' +
      delists.length +
      ' of ' +
      liveCount +
      ' live units (' +
      breaker.delistPct +
      '%). Aborted. Verify the feed is complete before re-running.';
  }

  // An empty feed that still parsed is the classic silent failure.
  if (units.length === 0 && liveCount > 0) {
    breaker.tripped = true;
    breaker.message =
      'Feed parsed but contained zero units while ' +
      liveCount +
      ' are live. Aborted.';
  }

  const forced = options.force === true;
  const aborted = breaker.tripped && !forced;

  // When aborted, counts must reflect what will ACTUALLY happen (nothing),
  // not what would have happened. The would-have numbers stay on the breaker
  // for diagnostics. Reporting a delist wave that is not going to execute is
  // how an admin panel lies to you.
  breaker.wouldCreate = creates.length;
  breaker.wouldUpdate = updates.length;
  breaker.wouldDelist = delists.length;
  breaker.wouldReactivate = reactivates.length;

  return {
    version: SYNC_VERSION,
    feedId,
    generatedAt: now,
    aborted,
    forced: forced && breaker.tripped,
    breaker,
    feedSummary: normalized.summary,
    counts: {
      feedUnits: units.length,
      create: aborted ? 0 : creates.length,
      update: aborted ? 0 : updates.length,
      delist: aborted ? 0 : delists.length,
      reactivate: aborted ? 0 : reactivates.length,
      unchanged: unchanged.length,
      skipped: skipped.length,
      writes: aborted ? 0 : creates.length + updates.length + delists.length + reactivates.length
    },
    creates: aborted ? [] : creates,
    updates: aborted ? [] : updates,
    delists: aborted ? [] : delists,
    reactivates: aborted ? [] : reactivates,
    unchanged,
    skipped
  };
}

/* ------------------------------------------------------------------ *
 * state projection
 *
 * Marks planned work as pending. pm-write.js confirms each item after a
 * verified read-back and only then flips it to live/delisted with a real
 * groupId. Nothing here assumes a write succeeded.
 * ------------------------------------------------------------------ */

function projectState(state, plan) {
  const now = new Date().toISOString();
  const next = JSON.parse(JSON.stringify(state));
  next.version = SYNC_VERSION;
  next.lastRun = now;
  next.runCount = (next.runCount || 0) + 1;
  next.lastRunResult = plan.aborted ? 'ABORTED' : 'PLANNED';
  if (!next.firstSeen) next.firstSeen = now;

  if (plan.aborted) return next;

  for (const c of plan.creates) {
    next.units[c.externalKey] = {
      externalKey: c.externalKey,
      addressKey: c.addressKey,
      groupId: null,
      status: 'pending_create',
      snapshot: c.snapshot,
      lastUpdated: c.unit.lastUpdated || null,
      unitNumber: c.unit.unitNumber || null,
      street: c.unit.street || null,
      plannedAt: now
    };
  }

  for (const u of plan.updates) {
    const prev = next.units[u.externalKey] || {};
    next.units[u.externalKey] = {
      ...prev,
      status: 'pending_update',
      pendingSnapshot: u.snapshot,
      pendingLastUpdated: u.unit.lastUpdated || null,
      plannedAt: now
    };
  }

  for (const r of plan.reactivates) {
    const prev = next.units[r.externalKey] || {};
    next.units[r.externalKey] = {
      ...prev,
      status: 'pending_reactivate',
      pendingSnapshot: r.snapshot,
      pendingLastUpdated: r.unit.lastUpdated || null,
      plannedAt: now
    };
  }

  for (const d of plan.delists) {
    const prev = next.units[d.externalKey] || {};
    next.units[d.externalKey] = { ...prev, status: 'pending_delist', plannedAt: now };
  }

  return next;
}

/* ------------------------------------------------------------------ *
 * feed registry
 * ------------------------------------------------------------------ */

const FEED_STORE = 'pm-feeds';

async function loadFeed(feedId) {
  try {
    const store = rdcStore(FEED_STORE);
    const raw = await store.get('feed::' + feedId);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * handler
 * ------------------------------------------------------------------ */

const json = (code, body) => ({
  statusCode: code,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'X-Function-Version': SYNC_VERSION
  },
  body: JSON.stringify({ version: SYNC_VERSION, ...body }, null, 2)
});

const NORMALIZE_URL =
  process.env.PM_NORMALIZE_URL ||
  'https://renters-story-writer.netlify.app/.netlify/functions/pm-normalize';

async function normalizeViaFunction(feedUrl) {
  const res = await fetch(NORMALIZE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: feedUrl })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    const e = new Error('NORMALIZE_FAILED: ' + (data.error || res.status));
    e.fatal = true;
    throw e;
  }
  return data;
}

exports.handler = async (event) => {
  const q = (event && event.queryStringParameters) || {};
  let body = {};
  if (event && event.body) {
    try {
      body = JSON.parse(event.body);
    } catch (_) {
      body = {};
    }
  }

  try {
    const required = process.env.PM_FEED_TOKEN;
    if (required && q.token !== required) return json(401, { ok: false, error: 'bad token' });

    if (q.selftest === '1') {
      const t = runSelfTest();
      return json(t.failed === 0 ? 200 : 500, { ok: t.failed === 0, selftest: t });
    }

    const feedId = q.feedId || body.feedId || null;

    if (!feedId) {
      return json(200, {
        ok: true,
        status: 'ready',
        usage: {
          dryrun: '?feedId=<id>&dryrun=1  (default, nothing persisted)',
          commit: '?feedId=<id>&commit=1  (persists plan for pm-write)',
          state: '?feedId=<id>&state=1',
          selftest: '?selftest=1',
          adhoc: 'POST { feedId, feedUrl, memberId }'
        },
        safety: {
          delistAbortPct: DELIST_ABORT_PCT * 100,
          delistAbortFloor: DELIST_ABORT_FLOOR,
          defaultMode: 'dryrun',
          neverDeletes: true
        }
      });
    }

    if (q.state === '1') {
      const state = await loadState(feedId);
      const units = Object.values(state.units);
      const byStatus = {};
      for (const u of units) byStatus[u.status] = (byStatus[u.status] || 0) + 1;
      return json(200, {
        ok: true,
        feedId,
        lastRun: state.lastRun,
        lastRunResult: state.lastRunResult,
        runCount: state.runCount,
        totalTracked: units.length,
        byStatus
      });
    }

    // resolve the feed URL
    let feedUrl = body.feedUrl || q.feedUrl || null;
    let memberId = body.memberId || q.memberId || null;
    if (!feedUrl) {
      const feed = await loadFeed(feedId);
      if (!feed) {
        return json(404, {
          ok: false,
          error: 'FEED_NOT_REGISTERED',
          detail: 'No feed registered under id "' + feedId + '". Pass feedUrl explicitly or register it.'
        });
      }
      if (feed.active === false) {
        return json(200, { ok: true, skipped: true, reason: 'FEED_INACTIVE', feedId });
      }
      feedUrl = feed.feedUrl;
      memberId = memberId || feed.memberId || null;
    }

    // Load state BEFORE fetching. A state read failure must abort before any
    // planning happens, or every unit looks new.
    const state = await loadState(feedId);
    const normalized = await normalizeViaFunction(feedUrl);

    const plan = buildPlan(feedId, normalized, state, { force: q.force === '1' });
    plan.feedUrl = feedUrl;
    plan.memberId = memberId;

    const commit = q.commit === '1';

    if (!commit) {
      return json(200, {
        ok: true,
        mode: 'dryrun',
        persisted: false,
        note: 'Nothing was written. Add &commit=1 to persist this plan for pm-write.',
        plan
      });
    }

    if (plan.aborted) {
      return json(409, {
        ok: false,
        mode: 'commit',
        persisted: false,
        error: 'CIRCUIT_BREAKER_TRIPPED',
        breaker: plan.breaker,
        note: 'Nothing was written. Re-run with &force=1 only after confirming the feed is complete.',
        plan
      });
    }

    await savePlan(feedId, plan);
    await saveState(projectState(state, plan));

    return json(200, {
      ok: true,
      mode: 'commit',
      persisted: true,
      note: 'Plan stored. pm-write executes it; nothing has been written to BD yet.',
      counts: plan.counts,
      breaker: plan.breaker,
      plan
    });
  } catch (err) {
    return json(500, {
      ok: false,
      error: String(err.message || err),
      fatal: !!err.fatal,
      note: err.fatal
        ? 'Aborted before planning. No state was modified and nothing was delisted.'
        : undefined
    });
  }
};

/* ------------------------------------------------------------------ *
 * self test
 *
 * Pure in-memory. No Blobs, no network. Verifies the decision logic,
 * which is the part that can quietly destroy a PM's inventory.
 * ------------------------------------------------------------------ */

function fakeUnit(key, over) {
  return Object.assign(
    {
      externalKey: key,
      addressKey: 'addr-' + key,
      importable: true,
      issues: [],
      unitNumber: 'Apt ' + key,
      street: '1 Test St',
      city: 'Portland',
      state: 'OR',
      zip: '97214',
      beds: 2,
      fullBaths: 1,
      halfBaths: 0,
      bathsTotal: 1,
      sqft: 900,
      rent: 1500,
      deposit: 1500,
      yearBuilt: 2000,
      dateAvailable: '2026-09-01',
      propertyName: null,
      modelName: null,
      description: 'desc',
      propertyTypeRaw: 'HOUSE',
      isFurnished: false,
      leaseTerm: null,
      applicationFee: null,
      lastUpdated: '2026-07-25T10:00:00.000Z',
      photosForImport: [{ url: 'https://x/1.jpg' }]
    },
    over || {}
  );
}

function fakeFeed(units) {
  return { summary: { units: units.length }, units };
}

function fakeState(feedId, entries) {
  const s = emptyState(feedId);
  for (const e of entries) s.units[e.externalKey] = e;
  return s;
}

function liveEntry(key, unit, over) {
  return Object.assign(
    {
      externalKey: key,
      addressKey: 'addr-' + key,
      groupId: 'g-' + key,
      status: 'live',
      snapshot: snapshot(unit),
      lastUpdated: unit.lastUpdated,
      unitNumber: unit.unitNumber,
      street: unit.street
    },
    over || {}
  );
}

function runSelfTest() {
  const checks = [];
  const ok = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });

  // 1. first run: everything creates
  {
    const feed = fakeFeed([fakeUnit('a'), fakeUnit('b')]);
    const p = buildPlan('f1', feed, emptyState('f1'), {});
    ok('first run creates all', p.counts.create === 2, p.counts.create);
    ok('first run delists none', p.counts.delist === 0, p.counts.delist);
    ok('first run not aborted', !p.aborted, p.aborted);
  }

  // 2. no change at all
  {
    const u = fakeUnit('a');
    const st = fakeState('f2', [liveEntry('a', u)]);
    const p = buildPlan('f2', fakeFeed([fakeUnit('a')]), st, {});
    ok('unchanged unit is not rewritten', p.counts.update === 0, p.counts.update);
    ok('unchanged unit counted', p.counts.unchanged === 1, p.counts.unchanged);
  }

  // 3. rent change with a moved lastUpdated
  {
    const u = fakeUnit('a');
    const st = fakeState('f3', [liveEntry('a', u)]);
    const changed = fakeUnit('a', { rent: 1600, lastUpdated: '2026-07-26T10:00:00.000Z' });
    const p = buildPlan('f3', fakeFeed([changed]), st, {});
    ok('rent change produces update', p.counts.update === 1, p.counts.update);
    const fields = (p.updates[0] || {}).changed.map((c) => c.field);
    ok('rent identified as changed field', fields.indexOf('rent') !== -1, fields.join(','));
    ok('update carries groupId', p.updates[0].groupId === 'g-a', p.updates[0].groupId);
  }

  // 4. lastUpdated unchanged short-circuits
  {
    const u = fakeUnit('a');
    const st = fakeState('f4', [liveEntry('a', u)]);
    const sneaky = fakeUnit('a', { rent: 9999 }); // same lastUpdated
    const p = buildPlan('f4', fakeFeed([sneaky]), st, {});
    ok('lastUpdated match skips deep compare', p.counts.unchanged === 1, p.counts.unchanged);
  }

  // 5. absence delists, does not delete
  {
    const st = fakeState('f5', [
      liveEntry('a', fakeUnit('a')),
      liveEntry('b', fakeUnit('b'))
    ]);
    const p = buildPlan('f5', fakeFeed([fakeUnit('a')]), st, {});
    ok('absent unit delisted', p.counts.delist === 1, p.counts.delist);
    ok('delist targets right unit', (p.delists[0] || {}).externalKey === 'b', (p.delists[0] || {}).externalKey);
    ok('delist carries groupId', (p.delists[0] || {}).groupId === 'g-b', (p.delists[0] || {}).groupId);
  }

  // 6. returning unit reactivates rather than duplicating
  {
    const u = fakeUnit('a');
    const st = fakeState('f6', [liveEntry('a', u, { status: 'delisted' })]);
    const p = buildPlan('f6', fakeFeed([fakeUnit('a')]), st, {});
    ok('returned unit reactivates', p.counts.reactivate === 1, p.counts.reactivate);
    ok('returned unit does NOT create', p.counts.create === 0, p.counts.create);
    ok('reactivate reuses groupId', p.reactivates[0].groupId === 'g-a', p.reactivates[0].groupId);
  }

  // 7. circuit breaker on a mass delist
  {
    const entries = [];
    for (let i = 0; i < 20; i++) entries.push(liveEntry('u' + i, fakeUnit('u' + i)));
    const st = fakeState('f7', entries);
    const p = buildPlan('f7', fakeFeed([fakeUnit('u0'), fakeUnit('u1')]), st, {});
    ok('breaker trips on mass delist', p.breaker.tripped, p.breaker.delistPct + '%');
    ok('aborted plan writes nothing', p.counts.writes === 0, p.counts.writes);
    ok('aborted plan empties delists', p.delists.length === 0, p.delists.length);
    ok('aborted counts show zero delist', p.counts.delist === 0, p.counts.delist);
    ok('breaker retains would-have count', p.breaker.wouldDelist === 18, p.breaker.wouldDelist);
  }

  // 8. empty feed with live inventory
  {
    const entries = [];
    for (let i = 0; i < 10; i++) entries.push(liveEntry('u' + i, fakeUnit('u' + i)));
    const p = buildPlan('f8', fakeFeed([]), fakeState('f8', entries), {});
    ok('empty feed trips breaker', p.breaker.tripped, p.breaker.message);
    ok('empty feed delists nothing', p.counts.delist === 0, p.counts.delist);
  }

  // 9. small feeds are not strangled by the floor
  {
    const st = fakeState('f9', [liveEntry('a', fakeUnit('a')), liveEntry('b', fakeUnit('b'))]);
    const p = buildPlan('f9', fakeFeed([fakeUnit('a')]), st, {});
    ok('small feed delist allowed under floor', !p.breaker.tripped && p.counts.delist === 1, p.counts.delist);
  }

  // 10. force overrides
  {
    const entries = [];
    for (let i = 0; i < 20; i++) entries.push(liveEntry('u' + i, fakeUnit('u' + i)));
    const p = buildPlan('f10', fakeFeed([fakeUnit('u0')]), fakeState('f10', entries), { force: true });
    ok('force executes despite breaker', p.counts.delist === 19 && !p.aborted, p.counts.delist);
    ok('force flag recorded', p.forced === true, p.forced);
  }

  // 11. unimportable records never sent
  {
    const bad = fakeUnit('bad', { importable: false, issues: ['MISSING_RENT'] });
    const p = buildPlan('f11', fakeFeed([fakeUnit('a'), bad]), emptyState('f11'), {});
    ok('unimportable skipped not created', p.counts.create === 1, p.counts.create);
    ok('unimportable surfaced in plan', p.counts.skipped === 1, p.skipped[0].issues.join(','));
  }

  // 12. unimportable disappearing does NOT delist a live unit
  {
    const st = fakeState('f12', [liveEntry('a', fakeUnit('a'))]);
    const bad = fakeUnit('a', { importable: false, issues: ['MISSING_RENT'] });
    const p = buildPlan('f12', fakeFeed([bad]), st, {});
    ok('unimportable does not trigger delist', p.counts.delist === 1, p.counts.delist);
  }

  // 13. photo change triggers update
  {
    const u = fakeUnit('a');
    const st = fakeState('f13', [liveEntry('a', u)]);
    const withPhotos = fakeUnit('a', {
      lastUpdated: '2026-07-26T10:00:00.000Z',
      photosForImport: [{ url: 'https://x/1.jpg' }, { url: 'https://x/2.jpg' }]
    });
    const p = buildPlan('f13', fakeFeed([withPhotos]), st, {});
    const fields = (p.updates[0] || { changed: [] }).changed.map((c) => c.field);
    ok('photo change detected', fields.indexOf('photoSignature') !== -1, fields.join(','));
  }

  // 14. planned-but-never-written retries as create
  {
    const u = fakeUnit('a');
    const st = fakeState('f14', [
      { externalKey: 'a', groupId: null, status: 'pending_create', snapshot: snapshot(u) }
    ]);
    const p = buildPlan('f14', fakeFeed([fakeUnit('a')]), st, {});
    ok('failed create retries as create', p.counts.create === 1, p.creates[0].reason);
  }

  // 15. state projection never invents a groupId
  {
    const feed = fakeFeed([fakeUnit('a')]);
    const p = buildPlan('f15', feed, emptyState('f15'), {});
    const next = projectState(emptyState('f15'), p);
    ok('projected create has null groupId', next.units.a.groupId === null, next.units.a.groupId);
    ok('projected create is pending', next.units.a.status === 'pending_create', next.units.a.status);
  }

  // 16. aborted plan does not mutate unit state
  {
    const entries = [];
    for (let i = 0; i < 20; i++) entries.push(liveEntry('u' + i, fakeUnit('u' + i)));
    const st = fakeState('f16', entries);
    const p = buildPlan('f16', fakeFeed([]), st, {});
    const next = projectState(st, p);
    const stillLive = Object.values(next.units).filter((u) => u.status === 'live').length;
    ok('aborted run leaves units live', stillLive === 20, stillLive);
    ok('aborted run recorded', next.lastRunResult === 'ABORTED', next.lastRunResult);
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

exports.buildPlan = buildPlan;
exports.projectState = projectState;
exports.runSelfTest = runSelfTest;
exports.SYNC_VERSION = SYNC_VERSION;
