// ============================================================
//  supply-visibility-js.js   ·   VERSION: svjs1  (2026-07-20)
//  Serves the supply-side "Who can find me" panel as JAVASCRIPT.
//
//  WHY THIS LIVES HERE AND NOT IN HEAD CODE:
//  BD strips EVERY backslash from the head code field (the live w94 file
//  contains zero) and mangles quoting badly enough to throw SyntaxErrors
//  on console.log strings. Head code is not a safe place for non-trivial
//  JavaScript. This function serves the real code from Netlify, where it
//  is stored byte-for-byte, and head code carries only a 6-line loader.
//  Bonus: updating the panel no longer requires touching head code at all,
//  which removes it from the head-code version-collision risk entirely.
//
//  Loaded by head code via:
//    <script src=".../.netlify/functions/supply-visibility-js"></script>
//  Live at: /.netlify/functions/supply-visibility-js
// ============================================================

const JS = `(function () {
  var VERSION = "svis3-remote";
  var API = "https://renters-story-writer.netlify.app/.netlify/functions/visibility";
  var PATH = (window.location.pathname || "").toLowerCase();
  if (PATH.indexOf("/account/home") === -1) return;

  // Level text, tried from several places. BD does not always render
  // .member-level-name, so we fall back to the Account Details panel copy.
  function levelText() {
    var out = "";
    try {
      var el = document.querySelector(".member-level-name");
      if (el && el.textContent && el.textContent.trim()) out = el.textContent.trim();
    } catch (e) {}
    if (!out) {
      try {
        var t = document.body ? (document.body.innerText || document.body.textContent || "") : "";
        var i = t.indexOf("Plan:");
        if (i !== -1) out = t.substr(i + 5, 40).split(String.fromCharCode(10))[0].trim();
      } catch (e) {}
    }
    return out;
  }
  function classify(t) {
    t = (t || "").toLowerCase();
    if (t.indexOf("property manager") !== -1 || t.indexOf("property-manager") !== -1) return "propertyManagers";
    if (t.indexOf("realtor") !== -1 || t.indexOf("agent") !== -1) return "realtors";
    if (t.indexOf("landlord") !== -1) return "landlords";
    if (t.indexOf("renter") !== -1) return "renters";
    return "";
  }
  function typeSlug() {
    var lt = levelText();
    var slug = classify(lt);
    if (!slug) {
      // Last resort: the dashboard prints the plan name somewhere on the page.
      var body = "";
      try { body = (document.body.innerText || document.body.textContent || ""); } catch (e) {}
      slug = classify(body);
    }
    try { console.log("[Supply visibility] " + VERSION + " level text: " + JSON.stringify(lt) + " -> type: " + (slug || "UNKNOWN")); } catch (e) {}
    return slug;
  }
  function memberId() {
    var lu = document.querySelector("input[name=logged_user]");
    if (lu && lu.value) return lu.value;
    var ma = document.querySelector(".member-account-id");
    if (ma) { var d = (ma.value || ma.textContent || "").replace(/[^0-9]/g, ""); if (d) return d; }
    return "";
  }
  function findAccountPanel() {
    var acc = document.getElementById("accordion");
    if (!acc) return null;
    var link = acc.querySelector('a[href="#collapseFour"]');
    if (!link) {
      var links = acc.querySelectorAll("a[data-toggle=collapse], a[href^='#collapse']");
      for (var i = 0; i < links.length; i++) { if (/account/i.test(links[i].textContent)) { link = links[i]; break; } }
    }
    if (!link) return null;
    var node = link;
    while (node && node.parentNode && node.parentNode !== acc) node = node.parentNode;
    return (node && node.parentNode === acc) ? node : null;
  }

  var SELF = typeSlug();
  var SUPPLY = { landlords: 1, propertyManagers: 1, realtors: 1 };
  if (!SUPPLY[SELF]) {
    try { console.log("[Supply visibility] " + VERSION + " skipped (type: " + (SELF || "UNKNOWN") + ")"); } catch (e) {}
    return; // renters use the renter card; unknown types are left alone
  }

  var LABEL = { landlords: "landlords", propertyManagers: "property managers", realtors: "realtors" };

  function css() {
    if (document.getElementById("rdc-svis-css")) return;
    var st = document.createElement("style");
    st.id = "rdc-svis-css";
    st.textContent = ''
      + '#rdc-svis{background:#fff;border-radius:12px;box-shadow:0 2px 10px rgba(13,45,78,.08);border:1px solid #e8eef4;margin:18px 0;overflow:hidden;font-family:"Open Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0d2d4e;}'
      + '#rdc-svis .h{padding:14px 16px 11px;border-bottom:1px solid #eef2f6;}'
      + '#rdc-svis .ttl{font-size:16px;font-weight:800;display:flex;align-items:center;gap:8px;line-height:1.2;}'
      + '#rdc-svis .sub{font-size:11.5px;color:#6b7a89;margin-top:4px;line-height:1.45;}'
      + '#rdc-svis .st{font-size:12px;font-weight:700;padding:9px 16px;display:flex;gap:8px;align-items:center;border-bottom:1px solid #eef2f6;transition:background .25s,color .25s;}'
      + '#rdc-svis .st .dot{width:9px;height:9px;border-radius:50%;background:#9aa7b4;flex:0 0 auto;}'
      + '#rdc-svis .st.hidden{color:#5a6b7b;background:#f5f7f9;}'
      + '#rdc-svis .st.live{color:#2e7d63;background:#edf7f2;}'
      + '#rdc-svis .st.live .dot{background:#3a9e8f;}'
      + '#rdc-svis .b{padding:4px 16px 14px;}'
      + '#rdc-svis .lbl{font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#3a9e8f;margin:14px 0 2px;}'
      + '#rdc-svis .r{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 0;border-bottom:1px solid #f1f4f7;}'
      + '#rdc-svis .r.last{border-bottom:none;}'
      + '#rdc-svis .r .t{font-size:13.5px;font-weight:700;}'
      + '#rdc-svis .r .d{font-size:11px;color:#8695a4;margin-top:1px;line-height:1.35;}'
      + '#rdc-svis .sw{position:relative;width:44px;height:26px;flex:0 0 auto;cursor:pointer;display:inline-block;}'
      + '#rdc-svis .sw input{opacity:0;width:0;height:0;position:absolute;}'
      + '#rdc-svis .sl{position:absolute;inset:0;background:#cfd8e0;border-radius:26px;transition:background .2s;}'
      + '#rdc-svis .sl:before{content:"";position:absolute;width:20px;height:20px;left:3px;top:3px;background:#fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .2s;}'
      + '#rdc-svis .sw input:checked + .sl{background:#3a9e8f;}'
      + '#rdc-svis .sw input:checked + .sl:before{transform:translateX(18px);}'
      + '#rdc-svis .warn{display:none;margin:10px 0 0;padding:11px 12px;background:#fef9e7;border-left:3px solid #f39c12;border-radius:0 8px 8px 0;font-size:11.5px;color:#7d6608;line-height:1.5;}'
      + '#rdc-svis .warn.show{display:block;}'
      + '#rdc-svis .note{margin-top:14px;font-size:11px;color:#7a8896;background:#f5f7f9;border-radius:8px;padding:9px 11px;line-height:1.45;}'
      + '#rdc-svis .note b{color:#0d2d4e;}'
      + '#rdc-svis .save{margin-top:14px;width:100%;background:#8dc63f;color:#0d2d4e;font-family:inherit;font-size:14px;font-weight:800;border:none;border-radius:9px;padding:12px;cursor:pointer;transition:filter .15s;}'
      + '#rdc-svis .save:hover{filter:brightness(.96);}'
      + '#rdc-svis .save:disabled{opacity:.6;cursor:default;}'
      + '#rdc-svis .flash{text-align:center;font-size:12px;font-weight:700;height:16px;margin-top:8px;opacity:0;transition:opacity .2s;}'
      + '#rdc-svis .flash.show{opacity:1;}'
      + '#rdc-svis .flash.ok{color:#2e7d63;}'
      + '#rdc-svis .flash.err{color:#c0392b;}';
    document.head.appendChild(st);
  }

  function row(key, title, desc, last) {
    return '<div class="r' + (last ? ' last' : '') + '"><div class="txt"><div class="t">' + title + '</div>'
      + '<div class="d">' + desc + '</div></div>'
      + '<label class="sw"><input type="checkbox" class="aud" data-k="' + key + '"><span class="sl"></span></label></div>';
  }

  function build(panel, mid) {
    if (document.getElementById("rdc-svis")) return;
    css();

    // peers = the two supply-side types that are not me
    var peers = [];
    if (SELF !== "landlords") peers.push(["landlords", "Landlords", "Owners renting out their own units."]);
    if (SELF !== "propertyManagers") peers.push(["propertyManagers", "Property managers", "Pros managing units for owners."]);
    if (SELF !== "realtors") peers.push(["realtors", "Realtors", "Licensed agents."]);
    // and my own type, so peers of the same kind can find me
    var mine = SELF === "landlords" ? ["landlords", "Other landlords", "Other owners on Renters.com."]
             : SELF === "propertyManagers" ? ["propertyManagers", "Other property managers", "Other managers on Renters.com."]
             : ["realtors", "Other realtors", "Other agents on Renters.com."];

    var peerRows = "";
    var all = peers.concat([mine]);
    for (var i = 0; i < all.length; i++) {
      peerRows += row(all[i][0], all[i][1], all[i][2], i === all.length - 1);
    }

    var card = document.createElement("div");
    card.id = "rdc-svis";
    card.innerHTML = ''
      + '<div class="h"><div class="ttl"><i class="fa fa-eye" style="color:#3a9e8f;"></i> Who can find me</div>'
      +   '<div class="sub">Choose who can see your profile on Renters.com. You can change this anytime.</div></div>'
      + '<div class="st live" id="rdc-sst"><span class="dot"></span><span id="rdc-sstx">Visible.</span></div>'
      + '<div class="b">'
      + '<div class="lbl" style="margin-top:6px;">People looking for a home</div>'
      + row("renters", "Renters", "Let renters find you and reach out about your listings.", true)
      + '<div class="warn" id="rdc-swarn"><b>Heads up:</b> with this off, renters cannot find your profile or contact you about your properties. Your listings stay published, but far fewer people will reach you.</div>'
      + '<div class="lbl">Other housing professionals</div>'
      + peerRows
      + '<div class="note"><b>Your contact details stay private.</b> Anyone you allow reaches you through a Renters.com message first.</div>'
      + '<button class="save" id="rdc-ssave">Save my visibility</button>'
      + '<div class="flash" id="rdc-sflash"></div>'
      + '</div>';

    panel.parentNode.insertBefore(card, panel.nextSibling);
    console.log("[Supply visibility] " + VERSION + " injected (" + SELF + ")");

    var auds = card.querySelectorAll(".aud");
    var st = document.getElementById("rdc-sst");
    var stx = document.getElementById("rdc-sstx");
    var warn = document.getElementById("rdc-swarn");
    var saveBtn = document.getElementById("rdc-ssave");
    var flash = document.getElementById("rdc-sflash");
    var rentersBox = card.querySelector('.aud[data-k="renters"]');

    function refresh() {
      var on = 0;
      auds.forEach(function (a) { if (a.checked) on++; });
      if (on === 0) { st.className = "st hidden"; stx.textContent = "Hidden from everyone."; }
      else { st.className = "st live"; stx.textContent = "Visible to " + on + " " + (on === 1 ? "audience" : "audiences") + "."; }
      warn.className = "warn" + (rentersBox && !rentersBox.checked ? " show" : "");
    }
    auds.forEach(function (a) { a.addEventListener("change", refresh); });

    function setFlash(msg, ok) {
      flash.textContent = msg;
      flash.className = "flash show " + (ok ? "ok" : "err");
      if (ok) setTimeout(function () { flash.className = "flash"; }, 2400);
    }

    function postFlags(silent) {
      var flags = {};
      auds.forEach(function (a) { flags[a.getAttribute("data-k")] = a.checked; });
      if (!silent) { saveBtn.disabled = true; saveBtn.textContent = "Saving..."; }
      return fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: mid, flags: flags })
      })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!silent) {
            saveBtn.disabled = false; saveBtn.textContent = "Save my visibility";
            if (res.ok) setFlash("Saved. Your visibility is updated.", true);
            else setFlash((res.j && res.j.error) ? res.j.error : "Save failed. Try again.", false);
          }
          return res;
        })
        .catch(function () {
          if (!silent) { saveBtn.disabled = false; saveBtn.textContent = "Save my visibility"; setFlash("Save failed. Check connection.", false); }
        });
    }

    // Load state. Never configured -> grandfathered visible: default all ON and
    // record it silently so this member stays findable without doing anything.
    fetch(API + "?status=1&memberId=" + encodeURIComponent(mid))
      .then(function (r) { return r.json(); })
      .then(function (s) {
        if (!s) return;
        if (s.configured) {
          auds.forEach(function (a) { a.checked = !!s[a.getAttribute("data-k")]; });
          refresh();
        } else {
          auds.forEach(function (a) { a.checked = true; });
          refresh();
          postFlags(true); // silent backfill: records existing member as visible
        }
      })
      .catch(function () { auds.forEach(function (a) { a.checked = true; }); refresh(); });

    saveBtn.addEventListener("click", function () {
      if (!mid) { setFlash("Could not read your account. Reload.", false); return; }
      postFlags(false);
    });

    refresh();
  }

  function run() {
    var mid = memberId();
    if (!mid) return;
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var panel = findAccountPanel();
      if (panel) { clearInterval(timer); build(panel, mid); }
      else if (tries >= 20) { clearInterval(timer); }
    }, 300);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();`;

exports.handler = async function () {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
    body: JS,
  };
};
