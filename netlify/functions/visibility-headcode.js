<!-- ===== RENTERS.COM — "WHO CAN FIND ME" VISIBILITY PANEL (sidebar card) =====
     Paste this whole block at the BOTTOM of BD HEAD CODE, below w43.
     Self-injects a compact card into the dashboard sidebar, directly under the
     Account accordion panel (left column, left of About Me). No mount div, no widget.
     Renders for RENTER accounts only. Version: vis2
     Save endpoint: visibility.js  (tags 6-10). -->
<script>
(function () {
  var VERSION = "vis2";
  var API = "https://www.renters.com/.netlify/functions/visibility";

  function memberId() {
    var lu = document.querySelector("input[name=logged_user]");
    if (lu && lu.value) return lu.value;
    var ma = document.querySelector(".member-account-id");
    if (ma) { var m = (ma.value || ma.textContent || "").match(/\d+/); if (m) return m[0]; }
    return "";
  }

  function isRenter() {
    var lvl = document.querySelector(".member-level-name");
    var t = lvl ? lvl.textContent : "";
    if (/renter/i.test(t)) return true;
    if (/landlord|property manager|realtor|agent/i.test(t)) return false;
    // fallback: Account Details block on the dashboard prints the plan
    return /\bRenter\b/.test(document.body ? document.body.textContent : "");
  }

  function findAccountPanel() {
    var acc = document.getElementById("accordion");
    if (!acc) return null;
    // primary: the Account toggle links to #collapseFour
    var link = acc.querySelector('a[href="#collapseFour"]');
    if (!link) {
      // fallback: any accordion toggle whose text says Account
      var links = acc.querySelectorAll("a[data-toggle=collapse], a[href^='#collapse']");
      for (var i = 0; i < links.length; i++) {
        if (/account/i.test(links[i].textContent)) { link = links[i]; break; }
      }
    }
    if (!link) return null;
    // walk up to the panel that sits directly inside #accordion
    var node = link;
    while (node && node.parentNode && node.parentNode !== acc) node = node.parentNode;
    return (node && node.parentNode === acc) ? node : null;
  }

  function injectStyles() {
    if (document.getElementById("rdc-vis-css")) return;
    var css = document.createElement("style");
    css.id = "rdc-vis-css";
    css.textContent = ''
      + '#rdc-vcard{background:#fff;border-radius:12px;box-shadow:0 2px 10px rgba(13,45,78,.08);border:1px solid #e8eef4;margin:18px 0;overflow:hidden;font-family:"Open Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0d2d4e;}'
      + '#rdc-vcard .h{padding:14px 16px 11px;border-bottom:1px solid #eef2f6;}'
      + '#rdc-vcard .ttl{font-size:16px;font-weight:800;display:flex;align-items:center;gap:8px;line-height:1.2;}'
      + '#rdc-vcard .sub{font-size:11.5px;color:#6b7a89;margin-top:4px;line-height:1.45;}'
      + '#rdc-vcard .st{font-size:12px;font-weight:700;padding:9px 16px;display:flex;gap:8px;align-items:center;border-bottom:1px solid #eef2f6;transition:background .25s,color .25s;}'
      + '#rdc-vcard .st .dot{width:9px;height:9px;border-radius:50%;background:#9aa7b4;flex:0 0 auto;}'
      + '#rdc-vcard .st.hidden{color:#5a6b7b;background:#f5f7f9;}'
      + '#rdc-vcard .st.live{color:#2e7d63;background:#edf7f2;}'
      + '#rdc-vcard .st.live .dot{background:#3a9e8f;}'
      + '#rdc-vcard .b{padding:4px 16px 14px;}'
      + '#rdc-vcard .lbl{font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#3a9e8f;margin:14px 0 2px;}'
      + '#rdc-vcard .r{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 0;border-bottom:1px solid #f1f4f7;}'
      + '#rdc-vcard .r.last{border-bottom:none;}'
      + '#rdc-vcard .r .t{font-size:13.5px;font-weight:700;}'
      + '#rdc-vcard .r .d{font-size:11px;color:#8695a4;margin-top:1px;line-height:1.35;}'
      + '#rdc-vcard .sw{position:relative;width:44px;height:26px;flex:0 0 auto;cursor:pointer;display:inline-block;}'
      + '#rdc-vcard .sw input{opacity:0;width:0;height:0;position:absolute;}'
      + '#rdc-vcard .sl{position:absolute;inset:0;background:#cfd8e0;border-radius:26px;transition:background .2s;}'
      + '#rdc-vcard .sl:before{content:"";position:absolute;width:20px;height:20px;left:3px;top:3px;background:#fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .2s;}'
      + '#rdc-vcard .sw input:checked + .sl{background:#3a9e8f;}'
      + '#rdc-vcard .sw input:checked + .sl:before{transform:translateX(18px);}'
      + '#rdc-vcard .subt{margin:2px 0 0;padding:10px 12px;background:#f7fbfa;border-left:3px solid #3a9e8f;border-radius:0 8px 8px 0;display:flex;align-items:center;justify-content:space-between;gap:10px;}'
      + '#rdc-vcard .subt .t{font-size:12.5px;}'
      + '#rdc-vcard .note{margin-top:14px;font-size:11px;color:#7a8896;background:#f5f7f9;border-radius:8px;padding:9px 11px;line-height:1.45;}'
      + '#rdc-vcard .note b{color:#0d2d4e;}'
      + '#rdc-vcard .save{margin-top:14px;width:100%;background:#8dc63f;color:#0d2d4e;font-family:inherit;font-size:14px;font-weight:800;border:none;border-radius:9px;padding:12px;cursor:pointer;transition:filter .15s;}'
      + '#rdc-vcard .save:hover{filter:brightness(.96);}'
      + '#rdc-vcard .save:disabled{opacity:.6;cursor:default;}'
      + '#rdc-vcard .flash{text-align:center;font-size:12px;font-weight:700;height:16px;margin-top:8px;opacity:0;transition:opacity .2s;}'
      + '#rdc-vcard .flash.show{opacity:1;}'
      + '#rdc-vcard .flash.ok{color:#2e7d63;}'
      + '#rdc-vcard .flash.err{color:#c0392b;}';
    document.head.appendChild(css);
  }

  function build(panel, mid) {
    if (document.getElementById("rdc-vcard")) return;
    injectStyles();

    var card = document.createElement("div");
    card.id = "rdc-vcard";
    card.innerHTML = ''
      + '<div class="h"><div class="ttl"><i class="fa fa-eye" style="color:#3a9e8f;"></i> Who can find me</div>'
      +   '<div class="sub">You choose who can see your verified profile. Everything is off by default.</div></div>'
      + '<div class="st hidden" id="rdc-st"><span class="dot"></span><span id="rdc-stx">You&#39;re currently hidden.</span></div>'
      + '<div class="b">'
      + '<div class="lbl" style="margin-top:6px;">People renting out homes</div>'
      + '<div class="r"><div class="txt"><div class="t">Landlords</div><div class="d">Owners renting their own units.</div></div>'
      +   '<label class="sw"><input type="checkbox" class="aud" data-k="landlords"><span class="sl"></span></label></div>'
      + '<div class="r"><div class="txt"><div class="t">Property managers</div><div class="d">Pros managing units for owners.</div></div>'
      +   '<label class="sw"><input type="checkbox" class="aud" data-k="propertyManagers"><span class="sl"></span></label></div>'
      + '<div class="r last"><div class="txt"><div class="t">Realtors</div><div class="d">Licensed rental agents.</div></div>'
      +   '<label class="sw"><input type="checkbox" class="aud" data-k="realtors" id="rdc-realtor"><span class="sl"></span></label></div>'
      + '<div class="subt"><div class="txt"><div class="t">Also open to buying</div><div class="d">Let realtors show you homes for sale.</div></div>'
      +   '<label class="sw"><input type="checkbox" class="aud" data-k="buying" id="rdc-buy"><span class="sl"></span></label></div>'
      + '<div class="lbl">Other renters</div>'
      + '<div class="r last"><div class="txt"><div class="t">Other renters</div><div class="d">Roommates, sublets, shared searches.</div></div>'
      +   '<label class="sw"><input type="checkbox" class="aud" data-k="renters"><span class="sl"></span></label></div>'
      + '<div class="note"><b>Your contact info stays private.</b> Anyone you allow reaches you through a Renters.com message first.</div>'
      + '<button class="save" id="rdc-save">Save my visibility</button>'
      + '<div class="flash" id="rdc-flash"></div>'
      + '</div>';

    panel.parentNode.insertBefore(card, panel.nextSibling);
    console.log("[Renters visibility] version: " + VERSION + " (sidebar card injected)");

    var auds = card.querySelectorAll(".aud");
    var st = document.getElementById("rdc-st");
    var stx = document.getElementById("rdc-stx");
    var realtor = document.getElementById("rdc-realtor");
    var buy = document.getElementById("rdc-buy");
    var saveBtn = document.getElementById("rdc-save");
    var flash = document.getElementById("rdc-flash");

    function refresh() {
      var on = 0;
      auds.forEach(function (a) { if (a.checked) on++; });
      if (on === 0) { st.className = "st hidden"; stx.innerHTML = "You&#39;re currently hidden."; }
      else { st.className = "st live"; stx.innerHTML = "Visible to " + on + " " + (on === 1 ? "audience" : "audiences") + "."; }
    }
    auds.forEach(function (a) { a.addEventListener("change", refresh); });
    buy.addEventListener("change", function () { if (buy.checked && !realtor.checked) realtor.checked = true; refresh(); });
    realtor.addEventListener("change", function () { if (!realtor.checked && buy.checked) buy.checked = false; refresh(); });

    function setFlash(msg, ok) {
      flash.textContent = msg;
      flash.className = "flash show " + (ok ? "ok" : "err");
      if (ok) setTimeout(function () { flash.className = "flash"; }, 2400);
    }

    if (mid) {
      fetch(API + "?status=1&memberId=" + encodeURIComponent(mid))
        .then(function (r) { return r.json(); })
        .then(function (s) { if (!s) return; auds.forEach(function (a) { if (s[a.getAttribute("data-k")]) a.checked = true; }); refresh(); })
        .catch(function () {});
    }

    saveBtn.addEventListener("click", function () {
      if (!mid) { setFlash("Could not read your account. Reload.", false); return; }
      var flags = {};
      auds.forEach(function (a) { flags[a.getAttribute("data-k")] = a.checked; });
      saveBtn.disabled = true; saveBtn.textContent = "Saving...";
      fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: mid, flags: flags }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          saveBtn.disabled = false; saveBtn.textContent = "Save my visibility";
          if (res.ok) setFlash("Saved. Your visibility is updated.", true);
          else setFlash((res.j && res.j.error) ? res.j.error : "Save failed. Try again.", false);
        })
        .catch(function () { saveBtn.disabled = false; saveBtn.textContent = "Save my visibility"; setFlash("Save failed. Check connection.", false); });
    });

    refresh();
  }

  function boot() {
    if (document.getElementById("rdc-vcard")) return;
    if (!isRenter()) return;
    var mid = memberId();
    if (!mid) return;

    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var panel = findAccountPanel();
      if (panel) { clearInterval(timer); build(panel, mid); }
      else if (tries >= 20) { clearInterval(timer); } // sidebar not present on this page
    }, 300);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
</script>
