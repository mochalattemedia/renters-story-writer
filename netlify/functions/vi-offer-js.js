/* ============================================================
   netlify/functions/vi-offer-js.js — v1
   Serves rdc-vi-offer.js v4 to the browser.
   Head code carries only the config block and a loader, per the
   standing rule that BD's head-code field destroys backslashes and
   mangles quoting — this module is regex-heavy and cannot survive
   being pasted there.
   Same shape as pwa-install-js. Check deployment with ?version=1.
   ============================================================ */

const VERSION = 'rdc-vi-offer v4';

const MODULE = String.raw`/* ============================================================
   rdc-vi-offer.js — v4
   Renters.com x Vertical Insure — embedded renters insurance
   Placements: home page | member dashboard | email landing page
   v4: served from Netlify by vi-offer-js instead of pasted into head
       code — BD's head-code field mangles the regex this module needs.
   v3: added the enabled master switch, so divs can be placed on
       live pages before the offer is switched on. Client id baked in.
   v2: UTC-safe date math; coverage_end_date is start + 365 days
       exactly (VI requires 355-375).
   ============================================================ */
(function () {
  'use strict';

  var FILE = 'rdc-vi-offer.js v4';
  var U = window.RDC_VI_CONFIG || {};

  var C = {
    enabled:         U.enabled === true,
    clientId:        U.clientId        || '',
    cdn:             U.cdn             || 'https://cdn.jsdelivr.net/npm/@vertical-insure/embedded-offer',
    prefillEndpoint: U.prefillEndpoint || '/.netlify/functions/vi-prefill',
    eventEndpoint:   U.eventEndpoint   || '/.netlify/functions/vi-offer-log',
    logEvents:       U.logEvents === true,
    showDecline:     U.showDecline === true,
    selectionMode:   U.selectionMode   || 'required',
    payments:        U.payments        || { enabled: true, button: true },
    termDays:        Math.min(375, Math.max(355, U.termDays || 365)),
    debug:           U.debug === true,
    // TODO VERIFY against the partner console. SINGLE_FAMILY_HOME is the
    // only value confirmed from VI docs; a wrong enum fails the quote.
    rentalTypes: U.rentalTypes || [
      ['SINGLE_FAMILY_HOME', 'House'],
      ['APARTMENT',          'Apartment'],
      ['CONDO',              'Condo'],
      ['TOWNHOME',           'Townhome'],
      ['DUPLEX',             'Duplex']
    ],
    brand: { navy: '#0d2d4e', teal: '#3a9e8f', lime: '#8dc63f' }
  };

  var COPY = {
    home:      { h: 'Protect your new place', p: 'Most leases require renters insurance. Get a quote in about 30 seconds - coverage starts the day you move in.', cta: 'Get my quote' },
    dashboard: { h: 'Renters insurance for your move', p: 'Add coverage now and we will send proof straight to your landlord.', cta: 'See my price' },
    email:     { h: 'Your renters insurance quote', p: 'We pre-filled what we already know. Review and you are covered.', cta: 'See my price' }
  };

  function log() { if (C.debug) console.log('[' + FILE + ']', Array.prototype.slice.call(arguments).join(' ')); }

  /* ---------- dates: UTC only ---------- */
  function todayISO() {
    var d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  function addDaysISO(s, n) {
    var p = String(s).split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /* ---------- styles ---------- */
  function styles() {
    if (document.getElementById('rdcvi-css')) return;
    var s = document.createElement('style');
    s.id = 'rdcvi-css';
    s.textContent = [
      '.rdcvi{max-width:640px;margin:24px auto;font-family:inherit;color:' + C.brand.navy + '}',
      '.rdcvi-card{border:1px solid #e3e8ee;border-radius:14px;padding:20px;background:#fff;box-shadow:0 1px 3px rgba(13,45,78,.06)}',
      '.rdcvi-h{margin:0 0 6px;font-size:20px;font-weight:700;color:' + C.brand.navy + '}',
      '.rdcvi-p{margin:0 0 16px;font-size:14px;line-height:1.5;color:#4a5b6d}',
      '.rdcvi-row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px}',
      '.rdcvi-f{flex:1 1 160px;display:flex;flex-direction:column}',
      '.rdcvi-f label{font-size:12px;font-weight:600;margin-bottom:4px;color:' + C.brand.navy + '}',
      '.rdcvi-f input,.rdcvi-f select{padding:10px 12px;border:1px solid #cfd8e3;border-radius:8px;font-size:16px;background:#fff;color:' + C.brand.navy + '}',
      '.rdcvi-f input:focus,.rdcvi-f select:focus{outline:2px solid ' + C.brand.teal + ';outline-offset:1px;border-color:' + C.brand.teal + '}',
      '.rdcvi-btn{width:100%;padding:14px 18px;border:0;border-radius:10px;background:' + C.brand.teal + ';color:#fff;font-size:16px;font-weight:700;cursor:pointer}',
      '.rdcvi-btn:hover{background:#33897c}',
      '.rdcvi-btn[disabled]{opacity:.55;cursor:default}',
      '.rdcvi-err{margin:8px 0 0;font-size:13px;color:#b3261e}',
      '.rdcvi-mount{min-height:60px}',
      '.rdcvi-note{margin:12px 0 0;font-size:11px;line-height:1.5;color:#7b8794}'
    ].join('');
    document.head.appendChild(s);
  }

  /* ---------- SDK loader ---------- */
  var sdkState = 0, sdkQueue = [];
  function loadSdk(cb) {
    if (window.VerticalInsure) return cb();
    sdkQueue.push(cb);
    if (sdkState) return;
    sdkState = 1;
    var s = document.createElement('script');
    s.src = C.cdn;
    s.async = true;
    s.onload = function () { log('sdk ready'); sdkQueue.splice(0).forEach(function (f) { f(); }); };
    s.onerror = function () { console.error('[' + FILE + '] SDK failed to load'); sdkQueue.length = 0; };
    document.head.appendChild(s);
  }

  /* ---------- prefill ---------- */
  function fromAttrs(el) {
    var d = el.dataset, o = {};
    ['email','first','last','street','unit','city','state','zip','start','rental','llName','llEmail','llStreet','llCity','llState','llZip']
      .forEach(function (k) {
        var key = 'vi' + k.charAt(0).toUpperCase() + k.slice(1);
        if (d[key]) o[k] = d[key];
      });
    return o;
  }

  function fromMember() {
    // window.RDC_VI_MEMBER is set from BD Form Manager fields on the dashboard.
    // Field names come from Form Manager, never from the on-screen labels.
    var m = window.RDC_VI_MEMBER || {};
    var clean = function (v) {
      // An unresolved BD smarty tag arrives as literal [[tag]] — treat as empty.
      if (!v) return '';
      var s = String(v);
      return /^\[\[.*\]\]$/.test(s) ? '' : s;
    };
    return {
      email: clean(m.email), first: clean(m.first_name), last: clean(m.last_name),
      street: clean(m.street), unit: clean(m.unit), city: clean(m.city),
      state: clean(m.state), zip: clean(m.postal_code),
      start: clean(m.move_in_date), rental: clean(m.rental_type),
      llName: clean(m.landlord_name), llEmail: clean(m.landlord_email),
      llStreet: clean(m.landlord_street), llCity: clean(m.landlord_city),
      llState: clean(m.landlord_state), llZip: clean(m.landlord_postal_code)
    };
  }

  function fromToken(cb) {
    var t = new URLSearchParams(location.search).get('vi');
    if (!t) return cb({});
    var url = C.prefillEndpoint + (C.prefillEndpoint.indexOf('?') < 0 ? '?' : '&') + 't=' + encodeURIComponent(t);
    fetch(url, { credentials: 'omit', mode: 'cors' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) { cb(j && j.prefill ? j.prefill : {}); })
      .catch(function (e) { log('prefill fetch failed', String(e)); cb({}); });
  }

  function merge() {
    var out = {};
    Array.prototype.forEach.call(arguments, function (src) {
      if (!src) return;
      Object.keys(src).forEach(function (k) {
        if (src[k] !== undefined && src[k] !== null && src[k] !== '') out[k] = src[k];
      });
    });
    return out;
  }

  var REQUIRED = ['email','first','last','street','city','state','zip','start','rental'];
  function complete(d) { return REQUIRED.every(function (k) { return d[k]; }); }

  /* ---------- VI config builder ---------- */
  function buildConfig(d) {
    var start = d.start || todayISO();
    var end   = addDaysISO(start, C.termDays);

    var parties = [];
    if (d.llName) {
      parties.push({
        name: d.llName,
        email_address: d.llEmail  || undefined,
        street:        d.llStreet || undefined,
        city:          d.llCity   || undefined,
        state:         d.llState  || undefined,
        postal_code:   d.llZip    || undefined,
        country: 'US'
      });
    }

    return {
      client_id: C.clientId,
      component_type: 'renters',
      selection_mode: C.selectionMode,
      component_config: { renters: { show_decline: C.showDecline } },
      payments: C.payments,
      tracking_offer_id: d.trackingId || undefined,
      product_config: {
        renters: [{
          customer: {
            email_address: d.email,
            first_name: d.first,
            last_name: d.last,
            state: d.state,
            postal_code: d.zip
          },
          metadata: { source: 'renters.com', placement: d.placement || 'unknown' },
          attributes: {
            coverage_start_date: start,
            coverage_end_date: end,
            rental_type: d.rental,
            property_address: {
              street: d.street,
              suite_or_unit: d.unit || undefined,
              city: d.city,
              state: d.state,
              postal_code: d.zip,
              country: 'US'
            },
            interested_parties: parties.length ? parties : undefined,
            // null = VI quotes with the eligible default (false), then asks in the UI
            additional_questions: {
              felony_conviction: null,
              mobile_home_or_similar: null,
              property_safety_exclusions: null,
              dwelling_safety_exclusions: null
            }
          }
        }]
      }
    };
  }

  /* ---------- events ---------- */
  var bound = false;
  function bindEvents() {
    if (bound) return;
    bound = true;
    ['offer-ready', 'offer-state-change', 'purchase-completed', 'third-party-policy-upload']
      .forEach(function (name) {
        window.addEventListener(name, function (e) {
          log(name, JSON.stringify(e.detail || {}));
          if (window.dataLayer) window.dataLayer.push({ event: 'vi_' + name.replace(/-/g, '_'), vi: e.detail });
          if (!C.logEvents) return;
          try {
            navigator.sendBeacon(
              C.eventEndpoint,
              new Blob([JSON.stringify({ type: name, detail: e.detail, url: location.href, ts: Date.now() })], { type: 'application/json' })
            );
          } catch (err) { /* non-fatal */ }
        });
      });
  }

  /* ---------- mount ---------- */
  function mount(host, d) {
    styles();
    bindEvents();
    var slot = host.querySelector('.rdcvi-mount');
    if (!slot) { slot = document.createElement('div'); slot.className = 'rdcvi-mount'; host.appendChild(slot); }
    slot.id = slot.id || 'rdcvi-' + Math.random().toString(36).slice(2, 8);
    slot.innerHTML = '';
    loadSdk(function () {
      try {
        new window.VerticalInsure('#' + slot.id, buildConfig(d), function (state) { log('state', JSON.stringify(state)); });
      } catch (err) {
        console.error('[' + FILE + '] mount failed', err);
        slot.innerHTML = '<p class="rdcvi-err">We could not load quotes just now. Please try again shortly.</p>';
      }
    });
  }

  /* ---------- quick form ---------- */
  function shell(c) {
    return '<div class="rdcvi"><div class="rdcvi-card">' +
      '<h3 class="rdcvi-h">' + c.h + '</h3>' +
      '<div class="rdcvi-mount"></div>' +
      '<p class="rdcvi-note">Coverage is offered by Vertical Insure. Renters.com earns a commission on policies purchased here.</p>' +
      '</div></div>';
  }

  function form(host, d) {
    styles();
    var c = COPY[d.placement] || COPY.home;
    var opts = C.rentalTypes.map(function (r) {
      return '<option value="' + r[0] + '"' + (d.rental === r[0] ? ' selected' : '') + '>' + r[1] + '</option>';
    }).join('');
    var v = function (k) { return d[k] ? String(d[k]).replace(/"/g, '&quot;') : ''; };

    host.innerHTML =
      '<div class="rdcvi"><div class="rdcvi-card">' +
        '<h3 class="rdcvi-h">' + c.h + '</h3>' +
        '<p class="rdcvi-p">' + c.p + '</p>' +
        '<form novalidate>' +
          '<div class="rdcvi-row">' +
            '<div class="rdcvi-f"><label>First name</label><input name="first" autocomplete="given-name" value="' + v('first') + '"></div>' +
            '<div class="rdcvi-f"><label>Last name</label><input name="last" autocomplete="family-name" value="' + v('last') + '"></div>' +
          '</div>' +
          '<div class="rdcvi-row">' +
            '<div class="rdcvi-f"><label>Email</label><input name="email" type="email" inputmode="email" autocomplete="email" value="' + v('email') + '"></div>' +
          '</div>' +
          '<div class="rdcvi-row">' +
            '<div class="rdcvi-f" style="flex:2 1 220px"><label>Street address</label><input name="street" autocomplete="address-line1" value="' + v('street') + '"></div>' +
            '<div class="rdcvi-f" style="flex:0 1 110px"><label>Unit</label><input name="unit" autocomplete="address-line2" value="' + v('unit') + '"></div>' +
          '</div>' +
          '<div class="rdcvi-row">' +
            '<div class="rdcvi-f"><label>City</label><input name="city" autocomplete="address-level2" value="' + v('city') + '"></div>' +
            '<div class="rdcvi-f" style="flex:0 1 90px"><label>State</label><input name="state" maxlength="2" autocomplete="address-level1" value="' + v('state') + '"></div>' +
            '<div class="rdcvi-f" style="flex:0 1 120px"><label>ZIP</label><input name="zip" inputmode="numeric" maxlength="5" autocomplete="postal-code" value="' + v('zip') + '"></div>' +
          '</div>' +
          '<div class="rdcvi-row">' +
            '<div class="rdcvi-f"><label>Move-in date</label><input name="start" type="date" value="' + (v('start') || todayISO()) + '"></div>' +
            '<div class="rdcvi-f"><label>Home type</label><select name="rental">' + opts + '</select></div>' +
          '</div>' +
          '<button type="submit" class="rdcvi-btn">' + c.cta + '</button>' +
          '<p class="rdcvi-err" hidden></p>' +
        '</form>' +
        '<p class="rdcvi-note">Coverage is offered by Vertical Insure. Renters.com earns a commission on policies purchased here.</p>' +
      '</div></div>';

    var f = host.querySelector('form');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = merge(d, {
        first: f.first.value.trim(), last: f.last.value.trim(), email: f.email.value.trim(),
        street: f.street.value.trim(), unit: f.unit.value.trim(), city: f.city.value.trim(),
        state: f.state.value.trim().toUpperCase(), zip: f.zip.value.trim(),
        start: f.start.value, rental: f.rental.value
      });
      var err = host.querySelector('.rdcvi-err');
      if (!complete(data)) { err.textContent = 'Please complete every field above.'; err.hidden = false; return; }
      if (!/^\S+@\S+\.\S+$/.test(data.email)) { err.textContent = 'That email address does not look right.'; err.hidden = false; return; }
      err.hidden = true;
      f.querySelector('button').disabled = true;
      host.innerHTML = shell(c);
      mount(host, data);
    });
  }

  /* ---------- init ---------- */
  function start(el, token) {
    if (el.getAttribute('data-vi-init')) return;
    el.setAttribute('data-vi-init', '1');
    var d = merge(fromAttrs(el), fromMember(), token);
    d.placement  = el.getAttribute('data-vi-placement') || 'home';
    d.trackingId = el.getAttribute('data-vi-tracking')  || undefined;
    if (complete(d)) {
      styles();
      el.innerHTML = shell(COPY[d.placement] || COPY.home);
      mount(el, d);
    } else {
      form(el, d);
    }
  }

  function init() {
    if (!C.enabled) { log('disabled — RDC_VI_CONFIG.enabled is false'); return; }
    if (!C.clientId) { console.error('[' + FILE + '] no clientId set'); return; }
    var nodes = document.querySelectorAll('[data-vi-offer]');
    if (!nodes.length) return;
    fromToken(function (token) {
      Array.prototype.forEach.call(nodes, function (el) { start(el, token); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.RDC_VI_REFRESH = init;   // call after any AJAX page swap in BD
  log('loaded, enabled=' + C.enabled);
})();`;

export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.has('version')) {
    return new Response(VERSION, {
      status: 200,
      headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' }
    });
  }
  return new Response(MODULE, {
    status: 200,
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      // Short cache so a version bump reaches renters quickly, but repeat
      // page views inside a session do not refetch.
      'cache-control': 'public, max-age=300',
      'x-vi-offer-version': VERSION,
      'access-control-allow-origin': '*'
    }
  });
};
