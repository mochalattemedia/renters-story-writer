/**
 * pwa-install-js.js — pi-v1
 * Repo path: netlify/functions/pwa-install-js.js
 * Served at:  https://renters-story-writer.netlify.app/.netlify/functions/pwa-install-js
 *
 * Loaded by a six-line head-code stub, per the standing rule that non-trivial JS
 * never lives in the BD head-code field (BD strips backslashes and mangles quoting
 * inside console.log strings).
 *
 * WHAT IT DOES
 *   1. Registers /sw.js (served at the renters.com root by the Cloudflare Worker).
 *   2. Captures beforeinstallprompt on Android/Chrome and holds it.
 *   3. Exposes window.RDC_PWA.prompt() so a VALUE MOMENT fires the install ask —
 *      after a saved search, a booked showing, or completed verification.
 *      It is never fired on page load and never sits on the page as a banner.
 *   4. On iOS, where there is no install API, shows a designed Share-sheet overlay.
 *   5. Persists dismissal server-side via Blobs, with a localStorage fallback.
 *   6. Reports standalone display mode so installs are measurable.
 *
 * WIRING A VALUE MOMENT (from head code, after the action succeeds):
 *   window.RDC_PWA && window.RDC_PWA.prompt('saved_search');
 *   window.RDC_PWA && window.RDC_PWA.prompt('showing_booked');
 *   window.RDC_PWA && window.RDC_PWA.prompt('verified');
 *
 * PERSISTENCE ENDPOINT (not built yet — see the note on RDC_PWA_STATE_URL below).
 * Until it exists the module degrades to localStorage, which is per-device.
 */

const PI_VERSION = 'pi-v1';

/* Server-side dismissal store. Set to null until the endpoint exists.
   When built, point this at a Netlify function backed by Blobs, keyed on
   member id, holding { dismissedAt, installedAt, promptCount }. */
const STATE_URL = null;

const CLIENT = `(function () {
  'use strict';
  var V = '${PI_VERSION}';
  if (window.RDC_PWA) return;

  var STATE_URL = ${STATE_URL ? JSON.stringify(STATE_URL) : 'null'};
  var LS_KEY = 'rdc_pwa_state';
  var MAX_PROMPTS = 2;          /* never ask more than twice, ever */
  var COOLDOWN_DAYS = 45;       /* and not within 45 days of a dismissal */

  /* ---------------------------------------------------------- utilities */

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           window.navigator.standalone === true;
  }

  function isIOS() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) ||
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isSafari() {
    var ua = navigator.userAgent || '';
    return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  }

  function memberId() {
    try {
      if (window.RDC_MEMBER_ID) return String(window.RDC_MEMBER_ID);
      /* Backslash-free by design. Every escape here crosses two layers
         (this template literal, then BD's head-code field, which destroys
         backslashes outright), and a regex is not worth that risk. */
      var parts = String(document.cookie || '').split(';');
      for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].split('=');
        if (kv.length < 2) continue;
        if (kv[0].trim() === 'bd_user_id') {
          return decodeURIComponent(kv.slice(1).join('=').trim());
        }
      }
      return null;
    } catch (e) { return null; }
  }

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
    catch (e) { return {}; }
  }

  function writeLocal(s) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {}
  }

  function loadState() {
    var local = readLocal();
    if (!STATE_URL) return Promise.resolve(local);
    var id = memberId();
    if (!id) return Promise.resolve(local);
    return fetch(STATE_URL + '?member=' + encodeURIComponent(id), { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (server) {
        var merged = {
          promptCount: Math.max(local.promptCount || 0, server.promptCount || 0),
          dismissedAt: server.dismissedAt || local.dismissedAt || 0,
          installedAt: server.installedAt || local.installedAt || 0
        };
        writeLocal(merged);
        return merged;
      })
      .catch(function () { return local; });
  }

  function saveState(patch) {
    var next = readLocal();
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) next[k] = patch[k];
    writeLocal(next);
    if (!STATE_URL) return;
    var id = memberId();
    if (!id) return;
    try {
      fetch(STATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member: id, state: next })
      }).catch(function () {});
    } catch (e) {}
  }

  function track(event, detail) {
    try {
      if (window.dataLayer) window.dataLayer.push({ event: 'rdc_pwa_' + event, detail: detail || null });
      if (window.gtag) window.gtag('event', 'rdc_pwa_' + event, { detail: detail || null });
    } catch (e) {}
    console.log('[RDC PWA ' + V + '] ' + event + (detail ? ' :: ' + detail : ''));
  }

  function eligible(state) {
    if (isStandalone()) return false;
    if (state.installedAt) return false;
    if ((state.promptCount || 0) >= MAX_PROMPTS) return false;
    if (state.dismissedAt) {
      var days = (Date.now() - state.dismissedAt) / 86400000;
      if (days < COOLDOWN_DAYS) return false;
    }
    return true;
  }

  /* ------------------------------------------------- service worker */

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:') return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(function (reg) { track('sw_registered', reg.scope); })
      .catch(function (err) { track('sw_failed', String(err && err.message || err)); });
  }

  /* Emergency removal, callable from the console:
     RDC_PWA.unregister()  — kills the worker and purges its caches on this device. */
  function unregister() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(function (reg) {
      if (reg.active) reg.active.postMessage({ type: 'RDC_UNREGISTER' });
      return reg.unregister();
    }).then(function () { track('sw_unregistered'); });
  }

  /* ------------------------------------------------------- the sheet */

  var CSS = [
    '.rdc-pwa-scrim{position:fixed;inset:0;background:rgba(13,45,78,.55);z-index:2147483000;',
      'opacity:0;transition:opacity .22s ease}',
    '.rdc-pwa-scrim.on{opacity:1}',
    '.rdc-pwa-sheet{position:fixed;left:0;right:0;bottom:0;z-index:2147483001;background:#fff;',
      'border-radius:18px 18px 0 0;padding:26px 22px calc(26px + env(safe-area-inset-bottom));',
      'box-shadow:0 -8px 40px rgba(13,45,78,.22);transform:translateY(102%);',
      'transition:transform .28s cubic-bezier(.22,.9,.3,1);max-width:520px;margin:0 auto;',
      "font-family:'Open Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}",
    '.rdc-pwa-sheet.on{transform:translateY(0)}',
    '.rdc-pwa-sheet h3{margin:0 0 8px;font-size:19px;line-height:1.3;color:#0d2d4e;',
      "font-family:'Red Hat Display',sans-serif;font-weight:700}",
    '.rdc-pwa-sheet p{margin:0 0 18px;font-size:14.5px;line-height:1.55;color:#4a5b6d}',
    '.rdc-pwa-ico{width:52px;height:52px;border-radius:12px;display:block;margin:0 0 14px;',
      'box-shadow:0 2px 10px rgba(13,45,78,.18)}',
    '.rdc-pwa-go{width:100%;background:#3a9e8f;color:#fff;border:0;border-radius:10px;',
      'padding:14px;font-size:15.5px;font-weight:700;cursor:pointer}',
    '.rdc-pwa-no{width:100%;background:none;border:0;color:#7b8794;font-size:13.5px;',
      'padding:13px 0 0;cursor:pointer}',
    '.rdc-pwa-steps{list-style:none;margin:0 0 18px;padding:0}',
    '.rdc-pwa-steps li{display:flex;align-items:center;gap:11px;padding:9px 0;font-size:14.5px;',
      'color:#0d2d4e;border-bottom:1px solid #eef2f5}',
    '.rdc-pwa-steps li:last-child{border-bottom:0}',
    '.rdc-pwa-n{flex:0 0 24px;height:24px;border-radius:50%;background:#8dc63f;color:#fff;',
      'font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center}',
    '.rdc-pwa-share{display:inline-block;vertical-align:-3px;margin:0 2px}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('rdc-pwa-css')) return;
    var s = document.createElement('style');
    s.id = 'rdc-pwa-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  var SHARE_SVG =
    '<svg class="rdc-pwa-share" width="15" height="19" viewBox="0 0 15 19" fill="none" ' +
    'xmlns="http://www.w3.org/2000/svg"><path d="M7.5 1v11M7.5 1L4 4.5M7.5 1L11 4.5" ' +
    'stroke="#007aff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M2 8H1v9h13V8h-1" stroke="#007aff" stroke-width="1.6" stroke-linecap="round"/></svg>';

  var openEl = null;

  function close(reason) {
    if (!openEl) return;
    var scrim = openEl.scrim, sheet = openEl.sheet;
    openEl = null;
    sheet.classList.remove('on');
    scrim.classList.remove('on');
    setTimeout(function () {
      if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
      if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
    }, 300);
    if (reason === 'dismiss') {
      saveState({ dismissedAt: Date.now() });
      track('dismissed');
    }
  }

  function openSheet(inner, onGo) {
    injectCSS();
    var scrim = document.createElement('div');
    scrim.className = 'rdc-pwa-scrim';
    var sheet = document.createElement('div');
    sheet.className = 'rdc-pwa-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.innerHTML = inner;
    document.body.appendChild(scrim);
    document.body.appendChild(sheet);
    requestAnimationFrame(function () { scrim.classList.add('on'); sheet.classList.add('on'); });
    openEl = { scrim: scrim, sheet: sheet };

    scrim.addEventListener('click', function () { close('dismiss'); });
    var no = sheet.querySelector('.rdc-pwa-no');
    if (no) no.addEventListener('click', function () { close('dismiss'); });
    var go = sheet.querySelector('.rdc-pwa-go');
    if (go && onGo) go.addEventListener('click', onGo);
  }

  /* ------------------------------------------------------- the prompts */

  var deferred = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    track('bip_captured');
  });

  window.addEventListener('appinstalled', function () {
    deferred = null;
    saveState({ installedAt: Date.now() });
    track('installed');
  });

  /*
   * COPY NOTE: the ask is never "install our app". It is the upgrade to
   * Daily Listing Alerts, which the renter already opted into — notified the
   * moment a match posts rather than tomorrow morning.
   */
  var COPY = {
    saved_search: {
      h: 'Get new matches the moment they post',
      p: 'Add Renters.com to your home screen and we can alert you the second a place matching this search goes live, instead of waiting for tomorrow morning’s email.'
    },
    showing_booked: {
      h: 'Keep your showings in your pocket',
      p: 'Add Renters.com to your home screen for showing reminders and updates from the landlord, without digging through email.'
    },
    verified: {
      h: 'You’re verified. Keep it one tap away.',
      p: 'Add Renters.com to your home screen so your verified profile, documents and showings are always right there.'
    },
    "default": {
      h: 'Add Renters.com to your home screen',
      p: 'One tap to your dashboard, your saved searches and your showings — plus alerts the moment a match posts.'
    }
  };

  function androidSheet(copy) {
    return '<img class="rdc-pwa-ico" src="https://renters-story-writer.netlify.app/icon-192.png" alt="">' +
      '<h3>' + copy.h + '</h3><p>' + copy.p + '</p>' +
      '<button class="rdc-pwa-go">Add to home screen</button>' +
      '<button class="rdc-pwa-no">Not now</button>';
  }

  function iosSheet(copy) {
    return '<img class="rdc-pwa-ico" src="https://renters-story-writer.netlify.app/icon-192.png" alt="">' +
      '<h3>' + copy.h + '</h3><p>' + copy.p + '</p>' +
      '<ul class="rdc-pwa-steps">' +
        '<li><span class="rdc-pwa-n">1</span><span>Tap ' + SHARE_SVG +
          ' <strong>Share</strong> at the bottom of Safari</span></li>' +
        '<li><span class="rdc-pwa-n">2</span><span>Scroll and tap <strong>Add to Home Screen</strong></span></li>' +
        '<li><span class="rdc-pwa-n">3</span><span>Tap <strong>Add</strong></span></li>' +
      '</ul>' +
      '<button class="rdc-pwa-no">Got it</button>';
  }

  function prompt(trigger) {
    var copy = COPY[trigger] || COPY["default"];

    loadState().then(function (state) {
      if (!eligible(state)) { track('suppressed', trigger); return; }

      /* iOS has no install API. Safari only — an in-app browser or Chrome on
         iOS cannot add to the home screen and showing the sheet there is a lie. */
      if (isIOS()) {
        if (!isSafari()) { track('ios_not_safari', trigger); return; }
        saveState({ promptCount: (state.promptCount || 0) + 1 });
        track('shown_ios', trigger);
        openSheet(iosSheet(copy), null);
        return;
      }

      if (!deferred) { track('no_deferred_prompt', trigger); return; }

      saveState({ promptCount: (state.promptCount || 0) + 1 });
      track('shown_android', trigger);

      openSheet(androidSheet(copy), function () {
        close();
        var d = deferred;
        deferred = null;
        if (!d) return;
        d.prompt();
        d.userChoice.then(function (res) {
          track('choice', res && res.outcome);
          if (res && res.outcome === 'dismissed') saveState({ dismissedAt: Date.now() });
        });
      });
    });
  }

  /* ------------------------------------------------------------- boot */

  registerSW();

  if (isStandalone()) {
    document.documentElement.setAttribute('data-rdc-standalone', '1');
    saveState({ installedAt: readLocal().installedAt || Date.now() });
    track('running_standalone');
  }

  window.RDC_PWA = {
    version: V,
    prompt: prompt,
    isStandalone: isStandalone,
    unregister: unregister,
    close: close
  };

  console.log('[RDC PWA ' + V + '] ready. standalone=' + isStandalone() + ' ios=' + isIOS());
})();`;

export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.has('version')) {
    return new Response(JSON.stringify({ version: PI_VERSION }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return new Response(CLIENT, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*'
    }
  });
};
