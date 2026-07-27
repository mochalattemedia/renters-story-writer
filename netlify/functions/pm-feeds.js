/**
 * pm-feeds.js  ·  pf-v1
 * Renters.com  ·  PM Feed Sync (Element Z)
 *
 * Feed registry. One record per property manager: their feed URL, the BD
 * member account their inventory belongs to, schedule and active flag.
 *
 * This is what turns a feedId into something pm-sync and pm-write can use.
 *
 * CHANGELOG
 *   pf-v1  2026-07-27  Initial build. CRUD over Netlify Blobs, feed
 *                      validation on register, status dashboard, and a
 *                      no-JS admin panel.
 *
 * ENDPOINTS
 *   GET  ?list=1                       all registered feeds + status
 *   GET  ?feedId=X                     one feed + its sync state
 *   GET  ?panel=1                      HTML admin panel
 *   POST { action:'register', ... }    add or replace a feed
 *   POST { action:'activate'|'deactivate'|'remove', feedId }
 *   GET  ?selftest=1
 *
 * REGISTER FIELDS
 *   feedId    required, short slug, e.g. "cascade-pm"
 *   feedUrl   required, http(s)
 *   memberId  required, BD user_id that will own the listings
 *   name      optional display name
 *   contact   optional email
 *   schedule  optional, informational only
 *   active    defaults true
 *
 * ENV
 *   PM_FEED_TOKEN   optional shared secret. If set, required on writes.
 */

'use strict';

const FEEDS_VERSION = 'pf-v1';

const NORMALIZE_URL =
  process.env.PM_NORMALIZE_URL ||
  'https://renters-story-writer.netlify.app/.netlify/functions/pm-normalize';

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

const FEED_STORE = 'pm-feeds';
const STATE_STORE = 'pm-feed-state';

async function listFeeds() {
  const store = rdcStore(FEED_STORE);
  const res = await store.list({ prefix: 'feed::' });
  const out = [];
  for (const b of res.blobs || []) {
    try {
      const raw = await store.get(b.key);
      if (!raw) continue;
      out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
    } catch (_) {
      /* skip unreadable */
    }
  }
  return out.sort((a, b) => String(a.feedId).localeCompare(String(b.feedId)));
}

async function getFeed(feedId) {
  const store = rdcStore(FEED_STORE);
  const raw = await store.get('feed::' + feedId);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function putFeed(feed) {
  const store = rdcStore(FEED_STORE);
  await store.set('feed::' + feed.feedId, JSON.stringify(feed));
}

async function removeFeed(feedId) {
  const store = rdcStore(FEED_STORE);
  await store.delete('feed::' + feedId);
}

async function getState(feedId) {
  try {
    const store = rdcStore(STATE_STORE);
    const raw = await store.get('state::' + feedId);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * validation
 * ------------------------------------------------------------------ */

function validateFeedId(id) {
  if (!id) return 'feedId is required';
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(String(id)))
    return 'feedId must be lowercase letters, numbers and hyphens';
  return null;
}

function validateFeedUrl(url) {
  if (!url) return 'feedUrl is required';
  const s = String(url).trim();
  if (!/^https?:\/\//i.test(s)) return 'feedUrl must start with http:// or https://';
  return null;
}

function validateMemberId(id) {
  if (id === undefined || id === null || id === '') return 'memberId is required';
  if (!/^[0-9]+$/.test(String(id))) return 'memberId must be numeric';
  return null;
}

/**
 * Fetches the feed through pm-normalize before accepting it. A feed that
 * cannot be parsed should be rejected at registration, not discovered on
 * the first sync when it looks like an empty inventory.
 */
async function probeFeed(feedUrl) {
  try {
    const res = await fetch(NORMALIZE_URL + '?summary=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: feedUrl })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || 'HTTP ' + res.status };
    }
    return {
      ok: true,
      units: data.summary.units,
      importable: data.summary.importable,
      blocked: data.summary.blocked,
      shapes: data.summary.shapes,
      issueCounts: data.summary.issueCounts,
      companies: (data.companies || []).map((c) => c.name).filter(Boolean)
    };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/* ------------------------------------------------------------------ *
 * summaries
 * ------------------------------------------------------------------ */

function summarizeState(state) {
  if (!state) {
    return { tracked: 0, live: 0, delisted: 0, pending: 0, lastRun: null, lastRunResult: null };
  }
  const units = Object.values(state.units || {});
  const byStatus = {};
  for (const u of units) byStatus[u.status] = (byStatus[u.status] || 0) + 1;
  return {
    tracked: units.length,
    live: byStatus.live || 0,
    delisted: byStatus.delisted || 0,
    pending: units.filter((u) => String(u.status || '').indexOf('pending') === 0).length,
    lastRun: state.lastRun || null,
    lastRunResult: state.lastRunResult || null,
    lastWriteRun: state.lastWriteRun || null,
    runCount: state.runCount || 0
  };
}

/* ------------------------------------------------------------------ *
 * admin panel
 *
 * Plain HTML, no framework, no external assets. Served from the function
 * so there is nothing to deploy separately and nothing for BD to mangle.
 * ------------------------------------------------------------------ */

const NAVY = '#0d2d4e';
const TEAL = '#3a9e8f';
const LIME = '#8dc63f';

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function panelHtml(rows) {
  const base = '/.netlify/functions/';

  const feedRows = rows.length
    ? rows
        .map((r) => {
          const s = r.state;
          const statusColor = r.feed.active === false ? '#999' : TEAL;
          const statusText = r.feed.active === false ? 'inactive' : 'active';
          return (
            '<tr style="border-bottom:1px solid #e5e5e5">' +
            '<td style="padding:10px 8px"><strong>' +
            esc(r.feed.feedId) +
            '</strong><br><span style="color:#666;font-size:12px">' +
            esc(r.feed.name || '') +
            '</span></td>' +
            '<td style="padding:10px 8px;font-size:12px;word-break:break-all;max-width:240px">' +
            esc(r.feed.feedUrl) +
            '</td>' +
            '<td style="padding:10px 8px;text-align:center">' +
            esc(r.feed.memberId) +
            '</td>' +
            '<td style="padding:10px 8px;text-align:center;color:' +
            statusColor +
            ';font-weight:600">' +
            statusText +
            '</td>' +
            '<td style="padding:10px 8px;text-align:center">' +
            s.tracked +
            '</td>' +
            '<td style="padding:10px 8px;text-align:center">' +
            s.live +
            '</td>' +
            '<td style="padding:10px 8px;text-align:center;color:#999">' +
            s.delisted +
            '</td>' +
            '<td style="padding:10px 8px;font-size:12px">' +
            esc(s.lastRun ? s.lastRun.slice(0, 16).replace('T', ' ') : 'never') +
            '<br><span style="color:#666">' +
            esc(s.lastRunResult || '') +
            '</span></td>' +
            '<td style="padding:10px 8px;font-size:12px;white-space:nowrap">' +
            '<a href="' +
            base +
            'pm-sync?feedId=' +
            esc(r.feed.feedId) +
            '&dryrun=1" style="color:' +
            NAVY +
            '">plan</a> &middot; ' +
            '<a href="' +
            base +
            'pm-write?feedId=' +
            esc(r.feed.feedId) +
            '&dryrun=1" style="color:' +
            NAVY +
            '">payloads</a> &middot; ' +
            '<a href="' +
            base +
            'pm-normalize?url=' +
            encodeURIComponent(r.feed.feedUrl) +
            '&summary=1" style="color:' +
            NAVY +
            '">feed</a>' +
            '</td>' +
            '</tr>'
          );
        })
        .join('')
    : '<tr><td colspan="9" style="padding:24px;text-align:center;color:#666">No feeds registered yet.</td></tr>';

  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>PM Feed Sync</title></head>' +
    '<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;background:#f7f8f9;color:#222">' +
    '<div style="background:' +
    NAVY +
    ';color:#fff;padding:18px 24px">' +
    '<div style="font-size:19px;font-weight:700">PM Feed Sync</div>' +
    '<div style="font-size:13px;opacity:.75;margin-top:2px">Element Z &middot; registry ' +
    FEEDS_VERSION +
    '</div></div>' +
    '<div style="padding:24px;max-width:1200px">' +
    '<div style="background:#fff;border:1px solid #e5e5e5;border-radius:6px;overflow:auto">' +
    '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
    '<thead><tr style="background:#fafbfc;border-bottom:2px solid #e5e5e5;text-align:left">' +
    '<th style="padding:10px 8px">Feed</th>' +
    '<th style="padding:10px 8px">URL</th>' +
    '<th style="padding:10px 8px;text-align:center">Member</th>' +
    '<th style="padding:10px 8px;text-align:center">State</th>' +
    '<th style="padding:10px 8px;text-align:center">Tracked</th>' +
    '<th style="padding:10px 8px;text-align:center">Live</th>' +
    '<th style="padding:10px 8px;text-align:center">Delisted</th>' +
    '<th style="padding:10px 8px">Last plan</th>' +
    '<th style="padding:10px 8px">Actions</th>' +
    '</tr></thead><tbody>' +
    feedRows +
    '</tbody></table></div>' +
    '<div style="background:#fff;border:1px solid #e5e5e5;border-radius:6px;margin-top:20px;padding:18px">' +
    '<div style="font-weight:700;margin-bottom:10px">Register a feed</div>' +
    '<div style="font-size:13px;color:#444;line-height:1.7">' +
    'POST JSON to <code style="background:#f2f4f5;padding:2px 5px;border-radius:3px">' +
    base +
    'pm-feeds</code><br>' +
    '<code style="background:#f2f4f5;padding:8px;border-radius:3px;display:block;margin-top:8px;white-space:pre">' +
    esc(
      '{\n  "action": "register",\n  "feedId": "cascade-pm",\n  "feedUrl": "https://example.com/feed.xml",\n  "memberId": "23",\n  "name": "Cascade Property Group"\n}'
    ) +
    '</code></div></div>' +
    '<div style="background:#fffbe6;border:1px solid ' +
    LIME +
    ';border-radius:6px;margin-top:20px;padding:16px;font-size:13px;line-height:1.7">' +
    '<strong>Order of operations.</strong> Register &rarr; <em>plan</em> (dry run, decides nothing is written) &rarr; ' +
    '<em>payloads</em> (dry run, shows exactly what BD would receive) &rarr; only then add ' +
    '<code>&amp;commit=1</code> to pm-sync and <code>&amp;execute=1</code> to pm-write.<br>' +
    'Imported listings are always created as <strong>drafts</strong>. Nothing publishes without review. ' +
    'Units are never deleted, only set to draft.' +
    '</div></div></body></html>'
  );
}

/* ------------------------------------------------------------------ *
 * handler
 * ------------------------------------------------------------------ */

const json = (code, body) => ({
  statusCode: code,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'X-Function-Version': FEEDS_VERSION
  },
  body: JSON.stringify({ version: FEEDS_VERSION, ...body }, null, 2)
});

const html = (code, body) => ({
  statusCode: code,
  headers: { 'Content-Type': 'text/html; charset=utf-8' },
  body
});

exports.handler = async (event) => {
  const q = (event && event.queryStringParameters) || {};
  const method = (event && event.httpMethod) || 'GET';

  let body = {};
  if (event && event.body) {
    try {
      body = JSON.parse(event.body);
    } catch (_) {
      body = {};
    }
  }

  try {
    if (q.selftest === '1') {
      const t = runSelfTest();
      return json(t.failed === 0 ? 200 : 500, { ok: t.failed === 0, selftest: t });
    }

    const token = process.env.PM_FEED_TOKEN;
    const authed = !token || q.token === token || body.token === token;

    /* ---- writes ---- */
    if (method === 'POST') {
      if (!authed) return json(401, { ok: false, error: 'bad token' });

      const action = body.action || 'register';

      if (action === 'register') {
        const errs = [
          validateFeedId(body.feedId),
          validateFeedUrl(body.feedUrl),
          validateMemberId(body.memberId)
        ].filter(Boolean);
        if (errs.length) return json(400, { ok: false, errors: errs });

        const probe = await probeFeed(body.feedUrl);
        if (!probe.ok && body.force !== true) {
          return json(400, {
            ok: false,
            error: 'FEED_UNREADABLE',
            detail: probe.error,
            note: 'The feed did not parse. Fix the URL, or pass "force": true to register anyway.'
          });
        }

        const existing = await getFeed(body.feedId);
        const feed = {
          feedId: String(body.feedId),
          feedUrl: String(body.feedUrl).trim(),
          memberId: String(body.memberId),
          name: body.name || (probe.companies && probe.companies[0]) || null,
          contact: body.contact || null,
          schedule: body.schedule || 'daily',
          active: body.active === false ? false : true,
          createdAt: (existing && existing.createdAt) || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastProbe: probe
        };
        await putFeed(feed);

        return json(200, {
          ok: true,
          action: existing ? 'updated' : 'registered',
          feed,
          probe,
          next:
            '/.netlify/functions/pm-sync?feedId=' + feed.feedId + '&dryrun=1'
        });
      }

      if (action === 'activate' || action === 'deactivate') {
        const feed = await getFeed(body.feedId);
        if (!feed) return json(404, { ok: false, error: 'NOT_FOUND' });
        feed.active = action === 'activate';
        feed.updatedAt = new Date().toISOString();
        await putFeed(feed);
        return json(200, { ok: true, action, feed });
      }

      if (action === 'remove') {
        const feed = await getFeed(body.feedId);
        if (!feed) return json(404, { ok: false, error: 'NOT_FOUND' });
        await removeFeed(body.feedId);
        return json(200, {
          ok: true,
          action: 'removed',
          feedId: body.feedId,
          note:
            'Registry entry removed. Sync state and any BD listings were NOT touched. ' +
            'Deactivate rather than remove if you intend to resume later.'
        });
      }

      return json(400, { ok: false, error: 'UNKNOWN_ACTION', action });
    }

    /* ---- reads ---- */
    if (q.feedId) {
      const feed = await getFeed(q.feedId);
      if (!feed) return json(404, { ok: false, error: 'NOT_FOUND', feedId: q.feedId });
      const state = await getState(q.feedId);
      return json(200, { ok: true, feed, state: summarizeState(state) });
    }

    const feeds = await listFeeds();
    const rows = [];
    for (const f of feeds) {
      rows.push({ feed: f, state: summarizeState(await getState(f.feedId)) });
    }

    if (q.panel === '1') return html(200, panelHtml(rows));

    if (q.list === '1' || Object.keys(q).length === 0) {
      return json(200, {
        ok: true,
        status: 'ready',
        count: rows.length,
        panel: '/.netlify/functions/pm-feeds?panel=1',
        feeds: rows
      });
    }

    return json(400, { ok: false, error: 'UNKNOWN_REQUEST' });
  } catch (err) {
    return json(500, { ok: false, error: String(err.message || err) });
  }
};

/* ------------------------------------------------------------------ *
 * self test
 * ------------------------------------------------------------------ */

function runSelfTest() {
  const checks = [];
  const ok = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });

  ok('valid feedId accepted', validateFeedId('cascade-pm') === null, '');
  ok('empty feedId rejected', validateFeedId('') !== null, '');
  ok('uppercase feedId rejected', validateFeedId('Cascade') !== null, '');
  ok('spaces in feedId rejected', validateFeedId('cascade pm') !== null, '');
  ok('slash in feedId rejected', validateFeedId('a/b') !== null, '');
  ok('single char feedId rejected', validateFeedId('a') !== null, '');

  ok('https url accepted', validateFeedUrl('https://x.com/f.xml') === null, '');
  ok('http url accepted', validateFeedUrl('http://x.com/f.xml') === null, '');
  ok('bare domain rejected', validateFeedUrl('x.com/f.xml') !== null, '');
  ok('empty url rejected', validateFeedUrl('') !== null, '');

  ok('numeric memberId accepted', validateMemberId('23') === null, '');
  ok('numeric memberId as number', validateMemberId(23) === null, '');
  ok('non numeric memberId rejected', validateMemberId('abc') !== null, '');
  ok('empty memberId rejected', validateMemberId('') !== null, '');

  {
    const s = summarizeState(null);
    ok('null state summarizes safely', s.tracked === 0 && s.live === 0, JSON.stringify(s));
  }
  {
    const s = summarizeState({
      units: {
        a: { status: 'live' },
        b: { status: 'live' },
        c: { status: 'delisted' },
        d: { status: 'pending_create' }
      },
      lastRun: '2026-07-27T10:00:00.000Z',
      lastRunResult: 'PLANNED',
      runCount: 3
    });
    ok('counts live', s.live === 2, s.live);
    ok('counts delisted', s.delisted === 1, s.delisted);
    ok('counts pending', s.pending === 1, s.pending);
    ok('counts tracked', s.tracked === 4, s.tracked);
  }

  {
    const h = panelHtml([]);
    ok('empty panel renders', h.indexOf('No feeds registered') !== -1, '');
    const h2 = panelHtml([
      {
        feed: { feedId: 'test-pm', feedUrl: 'https://x.com/f.xml', memberId: '23', active: true, name: 'Test' },
        state: summarizeState(null)
      }
    ]);
    ok('populated panel renders', h2.indexOf('test-pm') !== -1, '');
    ok('panel escapes html', panelHtml([
      {
        feed: { feedId: 'x', feedUrl: 'https://x.com/<script>', memberId: '1', active: true, name: '<b>hi</b>' },
        state: summarizeState(null)
      }
    ]).indexOf('<script>') === -1, 'escaped');
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

exports.runSelfTest = runSelfTest;
exports.FEEDS_VERSION = FEEDS_VERSION;
