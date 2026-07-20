// ============================================================
//  find-providers-js.js   ·   VERSION: fpjs1  (2026-07-20)
//  Serves the "Find housing providers" search UI as JAVASCRIPT.
//  Injected directly into the BD /find-providers page (no iframe),
//  so it can read the viewer's member level from the page and scope
//  the search itself - nothing has to be passed across documents.
//  Served from Netlify because BD strips backslashes and mangles
//  quoting in the head-code field (see Bible v35).
//  Head code carries only a 6-line loader.
//  Live at: /.netlify/functions/find-providers-js
// ============================================================

const JS = `(function () {
  var VERSION = "fp1";
  var API = "https://renters-story-writer.netlify.app/.netlify/functions/provider-search";
  var PATH = (window.location.pathname || "").toLowerCase();
  if (PATH.indexOf("/find-providers") === -1) return;
  if (document.getElementById("rdc-fp")) return;

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
  var lt = levelText();
  var VIEWER = classify(lt);
  if (!VIEWER) {
    var body = "";
    try { body = document.body.innerText || document.body.textContent || ""; } catch (e) {}
    VIEWER = classify(body) || "renters";
  }
  try { console.log("Find providers " + VERSION + " level text: " + JSON.stringify(lt) + " -> viewer: " + VIEWER); } catch (e) {}

  var css = document.createElement("style");
  css.textContent = ''
    + '#rdc-fp{max-width:960px;margin:22px auto;padding:0 16px 50px;font-family:"Open Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1a2b3c;}'
    + '#rdc-fp .bar{background:#0d2d4e;border-radius:16px;padding:22px;color:#fff;box-shadow:0 8px 26px rgba(13,45,78,.14);}'
    + '#rdc-fp .bar h2{font-size:22px;font-weight:800;margin:0 0 4px;color:#fff;letter-spacing:-.3px;}'
    + '#rdc-fp .bar .sub{font-size:13.5px;color:#b9cbe0;margin-bottom:16px;}'
    + '#rdc-fp .ctl{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;}'
    + '#rdc-fp .fld{flex:1 1 240px;min-width:0;}'
    + '#rdc-fp .fld label{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#92a8c2;margin-bottom:5px;}'
    + '#rdc-fp .fld input{width:100%;font-family:inherit;font-size:15px;color:#1a2b3c;background:#fff;border:none;border-radius:10px;padding:12px 14px;outline:none;}'
    + '#rdc-fp .go{background:#8dc63f;color:#0d2d4e;font-family:inherit;font-size:15px;font-weight:800;border:none;border-radius:10px;padding:12px 26px;cursor:pointer;}'
    + '#rdc-fp .go:disabled{opacity:.6;cursor:default;}'
    + '#rdc-fp .chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;}'
    + '#rdc-fp .chip{font-size:12px;font-weight:700;padding:7px 13px;border-radius:20px;cursor:pointer;background:rgba(255,255,255,.14);color:#d5e2f0;user-select:none;}'
    + '#rdc-fp .chip.on{background:#8dc63f;color:#0d2d4e;}'
    + '#rdc-fp .meta{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:22px 4px 12px;}'
    + '#rdc-fp .meta .cnt{font-size:14px;font-weight:700;color:#0d2d4e;}'
    + '#rdc-fp .meta .nt{font-size:12.5px;color:#6b7a89;}'
    + '#rdc-fp .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;}'
    + '#rdc-fp .card{background:#fff;border:1px solid #e6ecf2;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;}'
    + '#rdc-fp .top{display:flex;gap:13px;padding:16px 16px 12px;}'
    + '#rdc-fp .av{width:58px;height:58px;border-radius:50%;flex:0 0 auto;background:#e8eef4;display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:20px;font-weight:800;color:#9aabbd;}'
    + '#rdc-fp .av img{width:100%;height:100%;object-fit:cover;display:block;}'
    + '#rdc-fp .who{flex:1;min-width:0;}'
    + '#rdc-fp .nm{font-size:16px;font-weight:800;color:#0d2d4e;display:flex;align-items:center;gap:6px;}'
    + '#rdc-fp .nm img{width:16px;height:16px;flex:0 0 auto;}'
    + '#rdc-fp .ty{display:inline-block;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#3a9e8f;margin-top:3px;}'
    + '#rdc-fp .loc{font-size:12.5px;color:#6b7a89;margin-top:2px;}'
    + '#rdc-fp .story{padding:0 16px 12px;font-size:13px;color:#47586a;}'
    + '#rdc-fp .foot{margin-top:auto;border-top:1px solid #e6ecf2;padding:12px 16px;}'
    + '#rdc-fp .msg{width:100%;background:#0d2d4e;color:#fff;font-family:inherit;font-size:13.5px;font-weight:700;border:none;border-radius:9px;padding:11px;cursor:pointer;}'
    + '#rdc-fp .state{text-align:center;padding:50px 20px;color:#6b7a89;}'
    + '#rdc-fp .state .big{font-size:17px;font-weight:700;color:#0d2d4e;margin-bottom:6px;}'
    + '#rdc-fp .priv{margin-top:20px;font-size:12px;color:#6b7a89;background:#eef3f8;border-radius:10px;padding:11px 14px;}'
    + '#rdc-fp .priv b{color:#0d2d4e;}';
  document.head.appendChild(css);

  var LABEL = { landlords: "Landlords", propertyManagers: "Property managers", realtors: "Realtors" };
  var HEAD = {
    renters: "Find landlords, property managers and realtors who chose to be found by renters.",
    landlords: "Find property managers, realtors and other landlords who chose to be found by landlords.",
    propertyManagers: "Find landlords, realtors and other property managers who chose to be found by property managers.",
    realtors: "Find landlords, property managers and other realtors who chose to be found by realtors."
  };

  var wrap = document.createElement("div");
  wrap.id = "rdc-fp";
  var chipHtml = "";
  ["landlords", "propertyManagers", "realtors"].forEach(function (t) {
    chipHtml += '<span class="chip on" data-t="' + t + '">' + LABEL[t] + '</span>';
  });
  wrap.innerHTML = ''
    + '<div class="bar"><h2>Find housing providers</h2>'
    +   '<div class="sub">' + (HEAD[VIEWER] || HEAD.renters) + '</div>'
    +   '<div class="ctl"><div class="fld"><label for="rdc-fp-loc">Location</label>'
    +     '<input id="rdc-fp-loc" type="text" placeholder="Zip code or city" autocomplete="off"></div>'
    +     '<button class="go" id="rdc-fp-go">Search</button></div>'
    +   '<div class="chips" id="rdc-fp-chips">' + chipHtml
    +     '<span class="chip" data-v="1" id="rdc-fp-ver">Verified only</span></div>'
    + '</div>'
    + '<div class="meta" id="rdc-fp-meta" style="display:none;"><span class="cnt" id="rdc-fp-cnt"></span>'
    +   '<span class="nt">Verified members shown first.</span></div>'
    + '<div id="rdc-fp-res"></div>'
    + '<div class="priv"><b>Contact stays on-platform.</b> You reach a member through a Renters.com message. '
    +   'Contact details are never shown until they choose to share them.</div>';

  function mount() {
    var host = document.querySelector(".member_accounts") || document.querySelector("main") || document.body;
    host.insertBefore(wrap, host.firstChild);
  }
  mount();

  var locEl = document.getElementById("rdc-fp-loc");
  var goBtn = document.getElementById("rdc-fp-go");
  var res = document.getElementById("rdc-fp-res");
  var meta = document.getElementById("rdc-fp-meta");
  var cnt = document.getElementById("rdc-fp-cnt");
  var verChip = document.getElementById("rdc-fp-ver");
  var verifiedOnly = false;
  var types = { landlords: true, propertyManagers: true, realtors: true };

  document.getElementById("rdc-fp-chips").addEventListener("click", function (e) {
    var c = e.target;
    if (!c || c.className.indexOf("chip") === -1) return;
    if (c.getAttribute("data-v")) {
      verifiedOnly = !verifiedOnly;
      c.className = "chip" + (verifiedOnly ? " on" : "");
    } else {
      var t = c.getAttribute("data-t");
      if (!t) return;
      types[t] = !types[t];
      c.className = "chip" + (types[t] ? " on" : "");
    }
    search();
  });

  function esc(x) {
    return String(x == null ? "" : x).replace(/[&<>"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
    });
  }
  function initials(n) {
    var p = String(n || "").trim().split(" ");
    return ((p[0] || "").charAt(0) + (p.length > 1 ? (p[1] || "").charAt(0) : "")).toUpperCase();
  }

  function card(r) {
    var av = r.hasProfilePhoto && r.profilePhotoUrl
      ? '<img src="' + esc(r.profilePhotoUrl) + '" alt="">'
      : esc(initials(r.name) || "?");
    var badge = r.verified
      ? '<img src="https://www.renters.com/images/Twitter_Verified_Badge.svg.png" alt="Verified">' : "";
    return '<div class="card"><div class="top"><div class="av">' + av + '</div>'
      + '<div class="who"><div class="nm">' + esc(r.name) + badge + '</div>'
      + '<div class="ty">' + esc(r.typeLabel) + '</div>'
      + '<div class="loc">' + esc(r.location || "Location not listed") + '</div></div></div>'
      + (r.storySnippet ? '<div class="story">' + esc(r.storySnippet) + '</div>' : "")
      + '<div class="foot"><button class="msg" data-id="' + esc(r.memberId) + '">Send a message</button></div></div>';
  }

  function render(d) {
    var list = (d && d.results) || [];
    if (!list.length) {
      meta.style.display = "none";
      res.innerHTML = '<div class="state"><div class="big">No members found yet</div>'
        + '<div>As members choose to be findable, they appear here. Try a broader location.</div></div>';
      return;
    }
    meta.style.display = "flex";
    cnt.textContent = d.total + (d.total === 1 ? " member" : " members")
      + (d.location ? ' near "' + d.location + '"' : "");
    res.innerHTML = '<div class="grid">' + list.map(card).join("") + '</div>';
    var btns = res.querySelectorAll(".msg");
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", function () {
        window.location.href = "/account/messages/compose?to=" + encodeURIComponent(this.getAttribute("data-id"));
      });
    }
  }

  function search() {
    var sel = [];
    for (var k in types) { if (types[k]) sel.push(k); }
    if (!sel.length) {
      meta.style.display = "none";
      res.innerHTML = '<div class="state"><div class="big">Choose at least one type</div></div>';
      return;
    }
    goBtn.disabled = true; goBtn.textContent = "Searching...";
    res.innerHTML = '<div class="state">Searching...</div>';
    var url = API + "?viewer=" + encodeURIComponent(VIEWER)
      + "&location=" + encodeURIComponent(locEl.value.trim())
      + "&verifiedOnly=" + (verifiedOnly ? "1" : "0")
      + "&types=" + encodeURIComponent(sel.join(","))
      + "&limit=60";
    fetch(url).then(function (r) { return r.json(); })
      .then(function (d) { render(d); })
      .catch(function () {
        meta.style.display = "none";
        res.innerHTML = '<div class="state"><div class="big">Search is unavailable right now</div></div>';
      })
      .then(function () { goBtn.disabled = false; goBtn.textContent = "Search"; });
  }

  goBtn.addEventListener("click", search);
  locEl.addEventListener("keydown", function (e) { if (e.key === "Enter") search(); });
  search();
})();
`;

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
