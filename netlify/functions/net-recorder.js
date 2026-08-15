// ============================================================
//  net-recorder.js   ·   VERSION: nr-v1  (2026-08-15)
//
//  A READ-ONLY REQUEST RECORDER, SERVED AS JAVASCRIPT.
//
//  WHY THIS EXISTS. BD's PROFILE photo upload call has never been
//  captured. The LISTING one has - POST /wapi/widget?...mfaction=
//  upload_image carrying album_images[], group_id, user_id, data_id and
//  data_type=4 - but that is data_type 4, listings, and a profile photo
//  is a different target with its own ids. Guessing the difference is how
//  lw-v1 through lw-v13 were built, all four field-map traps invisible
//  from that vantage. Every version after the recorder landed first or
//  second try.
//
//  🔴 IT IS GATED ON ?rdcrec=1 AND MOUNTS NOWHERE ELSE. A recorder that
//  runs for members is a recorder that reads their requests, and this one
//  is loaded by head code, which runs on every page for everyone. The
//  param is the whole of the safety: no param, no wrapping, no panel,
//  nothing installed at all.
//
//  ⚠️ IT NEVER MODIFIES A REQUEST. It wraps XHR and fetch, reads what is
//  going past, and calls through untouched. If this file throws, the
//  original call still happens - every hook is individually try/caught
//  for that reason, because a diagnostic that breaks the thing it is
//  watching is worse than no diagnostic.
//
//  🔑 FILE CONTENT IS NEVER READ. For a File it records name, size and
//  type only. The bytes are the one thing nobody needs and the one thing
//  that would make this dangerous to leave lying around.
//
//  Values are truncated and anything that looks like a credential is
//  masked before it reaches the panel, because the panel gets copied and
//  pasted into a chat.
//
//  USE
//    1. Head code loads this (see the stub at the bottom of this file).
//    2. Open BD's profile photo page with ?rdcrec=1 on the end.
//    3. Upload one photo.
//    4. Press Copy on the panel and paste the result.
//
//  ENDPOINTS
//    GET             -> the recorder javascript
//    GET ?version=1  -> deploy confirmation as JSON
// ============================================================

const FN_VERSION = "nr-v1";

const JS = `(function () {
  'use strict';
  var V = '${FN_VERSION}';

  /* No param, no recorder. Checked before anything is wrapped. */
  try {
    if (location.search.indexOf('rdcrec=1') === -1) return;
  } catch (e) { return; }

  if (window.__rdcRec) return;
  window.__rdcRec = true;

  var LOG = [];
  var MAXV = 300;

  /* Masked rather than dropped, so the shape of the request still reads
     correctly while the value never leaves the page. */
  function safeVal(k, v) {
    var key = String(k || '').toLowerCase();
    if (key.indexOf('pass') !== -1 || key.indexOf('token') !== -1 ||
        key.indexOf('secret') !== -1 || key.indexOf('csrf') !== -1 ||
        key.indexOf('card') !== -1 || key.indexOf('cvv') !== -1) {
      return '[masked ' + String(v == null ? '' : v).length + ' chars]';
    }
    var s = String(v == null ? '' : v);
    return s.length > MAXV ? s.slice(0, MAXV) + '…[+' + (s.length - MAXV) + ']' : s;
  }

  /* Noise. Recording analytics buries the one call this exists to find. */
  function boring(url) {
    var u = String(url || '').toLowerCase();
    return u.indexOf('google-analytics') !== -1 || u.indexOf('googletagmanager') !== -1 ||
           u.indexOf('doubleclick') !== -1 || u.indexOf('facebook.') !== -1 ||
           u.indexOf('hotjar') !== -1 || u.indexOf('/collect') !== -1 ||
           u.indexOf('.png') !== -1 || u.indexOf('.jpg') !== -1 ||
           u.indexOf('.css') !== -1 || u.indexOf('fonts.') !== -1;
  }

  /* 🔑 FIELD NAMES AND SHAPES, NOT FILE BYTES. A File records its name,
     size and type. Reading the content would put an image in a panel that
     gets copied into a chat, and nothing about the call needs it. */
  function describeBody(b) {
    try {
      if (!b) return '(no body)';
      if (typeof FormData !== 'undefined' && b instanceof FormData) {
        var rows = [];
        b.forEach(function (v, k) {
          if (typeof File !== 'undefined' && v instanceof File) {
            rows.push('  ' + k + ' = [FILE name=' + v.name + ' size=' + v.size +
                      ' type=' + v.type + ']');
          } else {
            rows.push('  ' + k + ' = ' + safeVal(k, v));
          }
        });
        return 'FormData:\\n' + (rows.length ? rows.join('\\n') : '  (empty)');
      }
      if (typeof b === 'string') {
        if (b.indexOf('=') !== -1 && b.indexOf('&') !== -1) {
          var out = [];
          b.split('&').forEach(function (pair) {
            var i = pair.indexOf('=');
            var k = i === -1 ? pair : pair.slice(0, i);
            var v = i === -1 ? '' : pair.slice(i + 1);
            try { k = decodeURIComponent(k); v = decodeURIComponent(v.replace(/\\+/g, ' ')); }
            catch (e) {}
            out.push('  ' + k + ' = ' + safeVal(k, v));
          });
          return 'urlencoded:\\n' + out.join('\\n');
        }
        return 'raw string:\\n  ' + safeVal('', b);
      }
      if (typeof Blob !== 'undefined' && b instanceof Blob) {
        return '(Blob size=' + b.size + ' type=' + b.type + ')';
      }
      return '(' + Object.prototype.toString.call(b) + ')';
    } catch (e) {
      return '(body unreadable: ' + e.message + ')';
    }
  }

  function record(kind, method, url, body, headers) {
    try {
      if (boring(url)) return;
      var abs = url;
      try { abs = new URL(url, location.href).href; } catch (e) {}
      LOG.push(
        '── ' + kind + ' ' + (method || 'GET') + '\\n' +
        'URL: ' + abs + '\\n' +
        (headers && headers.length ? 'Headers:\\n' + headers.join('\\n') + '\\n' : '') +
        'Body: ' + describeBody(body)
      );
      paint();
    } catch (e) {}
  }

  /* ---- XHR ------------------------------------------------------- */
  try {
    var XO = XMLHttpRequest.prototype.open;
    var XS = XMLHttpRequest.prototype.send;
    var XH = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function (m, u) {
      try { this.__m = m; this.__u = u; this.__h = []; } catch (e) {}
      return XO.apply(this, arguments);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
      try { if (this.__h) this.__h.push('  ' + k + ': ' + safeVal(k, v)); } catch (e) {}
      return XH.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (b) {
      try { record('XHR', this.__m, this.__u, b, this.__h); } catch (e) {}
      return XS.apply(this, arguments);
    };
  } catch (e) {}

  /* ---- fetch ----------------------------------------------------- */
  try {
    var F = window.fetch;
    if (F) {
      window.fetch = function (input, init) {
        try {
          var u = (typeof input === 'string') ? input : (input && input.url) || '';
          var m = (init && init.method) || (input && input.method) || 'GET';
          record('fetch', m, u, init && init.body, null);
        } catch (e) {}
        return F.apply(this, arguments);
      };
    }
  } catch (e) {}

  /* ---- panel ------------------------------------------------------ */
  var box, pre;

  function paint() {
    if (!LOG.length) return;
    if (!box) build();
    if (pre) pre.textContent = LOG.join('\\n\\n');
  }

  function build() {
    box = document.createElement('div');
    box.setAttribute('style',
      'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;max-height:52%;' +
      'background:#0d2d4e;color:#fff;font:12px/1.45 ui-monospace,Menlo,monospace;' +
      'display:flex;flex-direction:column;box-shadow:0 -8px 30px rgba(0,0,0,.4)');

    var bar = document.createElement('div');
    bar.setAttribute('style',
      'flex:0 0 auto;display:flex;gap:8px;align-items:center;padding:8px 10px;' +
      'background:#081f38;font-weight:700');
    bar.appendChild(document.createTextNode('RDC recorder ' + V));

    var spacer = document.createElement('span');
    spacer.setAttribute('style', 'flex:1 1 auto');
    bar.appendChild(spacer);

    bar.appendChild(btn('Copy', function () {
      var t = LOG.join('\\n\\n');
      try {
        navigator.clipboard.writeText(t).then(function () { flash('Copied'); },
          function () { fallbackCopy(t); });
      } catch (e) { fallbackCopy(t); }
    }));
    bar.appendChild(btn('Clear', function () { LOG.length = 0; if (pre) pre.textContent = ''; }));
    bar.appendChild(btn('Hide', function () { box.style.display = 'none'; }));

    pre = document.createElement('pre');
    pre.setAttribute('style',
      'margin:0;padding:10px;overflow:auto;white-space:pre-wrap;word-break:break-all;flex:1 1 auto');

    box.appendChild(bar);
    box.appendChild(pre);
    document.documentElement.appendChild(box);
  }

  function btn(label, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('style',
      'background:#8dc63f;color:#0d2d4e;border:0;border-radius:6px;padding:5px 11px;' +
      'font:700 12px ui-monospace,Menlo,monospace;cursor:pointer');
    b.addEventListener('click', fn);
    return b;
  }

  /* A phone with no clipboard permission still needs to get the text out,
     so it falls back to selecting it for a manual copy. */
  function fallbackCopy(t) {
    try {
      var ta = document.createElement('textarea');
      ta.value = t;
      ta.setAttribute('style', 'position:fixed;left:0;top:0;opacity:0');
      document.documentElement.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.parentNode.removeChild(ta);
      flash('Copied');
    } catch (e) {
      flash('Select the text and copy it');
    }
  }

  function flash(msg) {
    try {
      var f = document.createElement('div');
      f.textContent = msg;
      f.setAttribute('style',
        'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;' +
        'background:#3a9e8f;color:#fff;padding:8px 14px;border-radius:8px;' +
        'font:700 13px sans-serif');
      document.documentElement.appendChild(f);
      setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 1600);
    } catch (e) {}
  }

  try { console.log('[RDC recorder ' + V + '] armed'); } catch (e) {}
})();`;

exports.handler = async (event) => {
  const q = (event && event.queryStringParameters) || {};

  if (q.version) {
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ version: FN_VERSION, bytes: JS.length })
    };
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      // Never cached. A diagnostic that a browser is holding a stale copy
      // of is worse than none, and this ships rarely enough that a fresh
      // fetch every time costs nothing.
      "Cache-Control": "no-store, max-age=0"
    },
    body: JS
  };
};

// ============================================================
//  HEAD CODE STUB - belongs to the WEB CHAT's file, not this one.
//  Bump head code by its four markers when this goes in.
//
//  It checks the param BEFORE injecting anything, so on every normal
//  page load for every member this is one string comparison and nothing
//  else. No script tag, no request.
//
//    (function(){
//      if (location.search.indexOf('rdcrec=1') === -1) return;
//      var s = document.createElement('script');
//      s.src = 'https://renters-story-writer.netlify.app/.netlify/functions/net-recorder';
//      document.head.appendChild(s);
//    })();
//
//  ⚠️ REMOVE THE STUB once the profile photo call is captured. A loader
//  for a request recorder is not something to leave in production head
//  code indefinitely, however well gated.
// ============================================================
