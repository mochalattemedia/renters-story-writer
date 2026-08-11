/**
 * renters-pwa-worker.js — pwaw-v1
 *
 * WHY THIS EXISTS
 * A service worker can only control the origin it is served from, and it must sit
 * at the root of the scope it covers. The dashboard, login and every member surface
 * live on www.renters.com (Brilliant Directories). BD root-level static file access
 * with a correct Content-Type is unproven and probably unavailable.
 *
 * renters.com DNS is on Cloudflare, so a Worker route can serve /sw.js and
 * /manifest.json at the real root without BD's involvement. Everything else
 * passes straight through to the BD origin untouched.
 *
 * ROUTES TO ADD IN CLOUDFLARE (Workers > Routes):
 *   www.renters.com/sw.js
 *   www.renters.com/manifest.json
 *   www.renters.com/offline.html
 *   renters.com/sw.js
 *   renters.com/manifest.json
 *   renters.com/offline.html
 *
 * DO NOT route this worker at /*  — it must only intercept these three paths.
 *
 * ICONS: hosted on Netlify (cross-origin manifest icons are permitted).
 * Upload to the repo root of mochalattemedia/renters-story-writer:
 *   icon-192.png          192x192  square, opaque
 *   icon-512.png          512x512  square, opaque
 *   icon-maskable-512.png 512x512  logo inside the centre 80% safe zone
 *   apple-touch-icon.png  180x180  opaque, no transparency (iOS ignores alpha)
 */

const PWA_VERSION = 'pwaw-v1';
const SW_CACHE = 'rdc-v1';
const ASSET_BASE = 'https://renters-story-writer.netlify.app';

/* ---------------------------------------------------------------- manifest */

const MANIFEST = {
  id: '/',
  name: 'Renters.com',
  short_name: 'Renters',
  description:
    'Verified renters, verified landlords. Search homes, book showings, and keep your rental records in one place.',
  start_url: '/account/home?src=pwa',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#ffffff',
  theme_color: '#0d2d4e',
  categories: ['lifestyle', 'business', 'utilities'],
  icons: [
    { src: ASSET_BASE + '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: ASSET_BASE + '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: ASSET_BASE + '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ],
  shortcuts: [
    { name: 'Find Me a Place', short_name: 'Find', url: '/getmatched?prefill=1&src=pwa' },
    { name: 'Safety Check', short_name: 'Safety', url: '/listing-check?src=pwa' },
    { name: 'My Dashboard', short_name: 'Dashboard', url: '/account/home?src=pwa' }
  ]
};

/* -------------------------------------------------------- service worker */
/*
 * DELIBERATELY CONSERVATIVE.
 *
 * Navigations are NETWORK-ONLY with an offline fallback. BD serves logged-in
 * member HTML with personal data in it; caching that risks showing one member
 * another member's page from disk, or showing stale verification state. The
 * offline page is the only HTML this worker will ever hand back.
 *
 * The only things cached are the offline page and the icons. Nothing else.
 * This means the PWA gives up offline browsing and keeps the icon and push,
 * which are the two things actually worth having.
 */

const SW_JS = `/* renters.com service worker — ${SW_CACHE} (served by ${PWA_VERSION}) */
const CACHE = '${SW_CACHE}';
const PRECACHE = [
  '/offline.html',
  '${ASSET_BASE}/icon-192.png',
  '${ASSET_BASE}/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(PRECACHE); })
      .catch(function () { /* a failed precache must not block install */ })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/* Kill switch: post {type:'RDC_UNREGISTER'} from any page to remove the worker
   and purge every cache. Use this if a bad deploy ever needs undoing. */
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'RDC_UNREGISTER') {
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.registration.unregister(); });
  }
  if (e.data && e.data.type === 'RDC_SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  /* Never touch the API, functions, admin, checkout or auth.
     A prefix list rather than a regex, deliberately: this string is emitted
     through a template literal, and an escape that survives one layer and not
     the next is exactly the class of bug that produced /^\\/ instead of /^/. */
  var SKIP = ['/api', '/admin', '/checkout', '/login', '/logout', '/signup', '/.netlify'];
  for (var i = 0; i < SKIP.length; i++) {
    if (url.pathname.indexOf(SKIP[i]) === 0) return;
  }

  /* Navigations: network only, offline page as the fallback. */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(function () {
        return caches.match('/offline.html').then(function (r) {
          return r || new Response('You are offline.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' }
          });
        });
      })
    );
    return;
  }

  /* Precached icons only. Everything else goes straight to the network. */
  e.respondWith(
    caches.match(req).then(function (hit) { return hit || fetch(req); })
  );
});

/* ---- PUSH ----
   Handler is live now so the client is ready. The VAPID keys and the
   subscription store are NOT built yet, so nothing will ever call this
   until the push backend exists. Harmless until then. */
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  var title = d.title || 'Renters.com';
  var opts = {
    body: d.body || '',
    icon: '${ASSET_BASE}/icon-192.png',
    badge: '${ASSET_BASE}/icon-192.png',
    tag: d.tag || 'rdc',
    renotify: !!d.renotify,
    data: { url: d.url || '/account/home?src=push' }
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || '/account/home?src=push';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf(target) !== -1 && 'focus' in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
`;

/* --------------------------------------------------------- offline page */

const OFFLINE_HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline — Renters.com</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:'Open Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
       background:#f7f9fb;color:#0d2d4e;padding:24px;text-align:center}
  .w{max-width:380px}
  h1{font-family:'Red Hat Display',sans-serif;font-size:22px;margin:0 0 10px}
  p{font-size:15px;line-height:1.55;color:#4a5b6d;margin:0 0 22px}
  button{background:#3a9e8f;color:#fff;border:0;border-radius:8px;padding:13px 26px;
         font-size:15px;font-weight:600;cursor:pointer}
</style></head>
<body><div class="w">
  <h1>You're offline</h1>
  <p>Renters.com needs a connection to show your dashboard, listings and showings.</p>
  <button onclick="location.reload()">Try again</button>
</div></body></html>`;

/* ------------------------------------------------------------- dispatch */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;

    if (p === '/manifest.json') {
      return new Response(JSON.stringify(MANIFEST, null, 2), {
        headers: {
          'Content-Type': 'application/manifest+json; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
          'Access-Control-Allow-Origin': '*',
          'X-PWA-Version': PWA_VERSION
        }
      });
    }

    if (p === '/sw.js') {
      return new Response(SW_JS, {
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          /* max-age=0 matters: a cached service worker is very hard to replace */
          'Cache-Control': 'no-cache, max-age=0, must-revalidate',
          'Service-Worker-Allowed': '/',
          'X-PWA-Version': PWA_VERSION
        }
      });
    }

    if (p === '/offline.html') {
      return new Response(OFFLINE_HTML, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
          'X-PWA-Version': PWA_VERSION
        }
      });
    }

    /* Anything else: straight through to BD. */
    return fetch(request);
  }
};
