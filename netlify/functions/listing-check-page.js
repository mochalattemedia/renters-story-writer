// ============================================================
//  listing-check-page.js  ·  lcp-v5
//  Serves the Rental Listing Safety Check as a standalone page for
//  iframe embedding on BD (like Lisa). Posts its height to the parent
//  so the iframe can auto-resize.
//
//  v5 changelog:
//   - Screenshot only. Link field and paste box removed. One path,
//     one button, nothing to decide.
//   - Up to 4 screenshots, with the multi-screenshot hint stated up
//     front so renters know to grab the whole listing.
//   - Downscales to 1400px JPEG in the browser before upload.
//   - Paste an image anywhere on the page and it attaches itself.
//   - Height is posted immediately on every state change, and the
//     parent is asked to scroll to the top of the frame on results.
//
//  Pairs with: listing-check.js (lc-v5)
// ============================================================

const HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rental Listing Safety Check</title><style>
html,body{margin:0;padding:0;background:transparent;}
#rls-drop.drag{border-color:#8dc63f !important;background:#f2f9e8 !important;}
.rls-x{position:absolute;top:-7px;right:-7px;width:23px;height:23px;border-radius:50%;background:#0d2d4e;color:#fff;border:2px solid #fff;font-size:13px;line-height:19px;text-align:center;cursor:pointer;padding:0;font-family:inherit;font-weight:700;}
#rls-go:disabled{cursor:default;}
</style></head><body>
<!-- RENTERS.COM — RENTAL LISTING SAFETY CHECK · SCREENSHOT ONLY -->
<div style="max-width:1000px;margin:0 auto;padding:4px;font-family:'Open Sans',Arial,sans-serif;">

  <div style="background:#0d2d4e;border-radius:22px;padding:30px 34px 34px;">

    <p style="font-size:30px;font-weight:800;color:#ffffff;margin:0 0 4px;line-height:1;">Safety Check<span style="color:#8dc63f;">.</span></p>
    <p style="font-size:15px;color:rgba(255,255,255,0.72);margin:0 0 20px;font-weight:300;line-height:1.6;">Screenshot a rental listing or your messages with a &ldquo;landlord&rdquo; and we&#39;ll flag common scam warning signs. Works for listings from anywhere.</p>

    <div id="rls-input" style="background:#ffffff;border-radius:18px;padding:22px;">

      <div id="rls-drop" style="border:2px dashed #dfe6ea;border-radius:16px;padding:30px 18px;text-align:center;cursor:pointer;transition:border-color .15s,background .15s;">
        <div style="font-size:34px;line-height:1;margin-bottom:8px;">&#128247;</div>
        <p style="font-size:17px;font-weight:700;color:#0d2d4e;margin:0 0 4px;">Add a screenshot</p>
        <p style="font-size:13px;color:#8a97a3;margin:0;line-height:1.55;">Tap to choose from your photos.<br>Add up to 4 if the listing or conversation is long.</p>
      </div>
      <input id="rls-file" type="file" accept="image/*" multiple style="display:none;">

      <div id="rls-thumbs" style="display:none;flex-wrap:wrap;gap:10px;margin-top:14px;"></div>
      <p id="rls-count" style="display:none;font-size:12px;color:#8a97a3;margin:8px 0 0;"></p>

      <p id="rls-err" style="display:none;color:#c0392b;font-size:13px;margin:12px 0 0;line-height:1.5;"></p>

      <button id="rls-go" style="margin-top:18px;width:100%;background:#dfe6ea;color:#96a3ad;border:none;border-radius:12px;padding:15px;font-size:16px;font-weight:700;cursor:default;font-family:inherit;transition:background .15s,color .15s;">Check this listing</button>

    </div>

    <p style="font-size:13px;color:rgba(255,255,255,0.55);margin:16px 0 0;line-height:1.6;">This is a free automated aid, not a guarantee. It can miss things and can&#39;t confirm a listing is real &mdash; always verify independently and never send money before seeing a place in person.</p>

    <div id="rls-results" style="margin-top:20px;display:none;"></div>

  </div>
</div>

<script>
(function () {
  var FN = "https://renters-story-writer.netlify.app/.netlify/functions/listing-check";
  var TIMEOUT_MS = 40000;
  var MAX_IMAGES = 4;
  var MAX_DIM = 1400;
  var shots = [];
  var busy = false;

  function el(id) { return document.getElementById(id); }
  function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function post(msg) { try { parent.postMessage(msg, "*"); } catch (e) {} }
  function pushHeight() {
    var b = document.body, e = document.documentElement;
    var h = Math.max(b.scrollHeight, b.offsetHeight, e.scrollHeight, e.offsetHeight, e.clientHeight);
    post({ listingCheckHeight: h });
  }

  function showErr(msg) { var e = el("rls-err"); e.textContent = msg; e.style.display = "block"; pushHeight(); }
  function clearErr() { var e = el("rls-err"); e.textContent = ""; e.style.display = "none"; }

  // ---------- button state ----------
  function paintButton() {
    var b = el("rls-go");
    if (busy) return;
    if (shots.length) {
      b.style.background = "#8dc63f";
      b.style.color = "#0d2d4e";
      b.style.cursor = "pointer";
      b.textContent = shots.length > 1 ? "Check these screenshots" : "Check this screenshot";
    } else {
      b.style.background = "#dfe6ea";
      b.style.color = "#96a3ad";
      b.style.cursor = "default";
      b.textContent = "Check this listing";
    }
  }

  function setBusy(on, label) {
    busy = on;
    var b = el("rls-go");
    b.disabled = on;
    if (on) {
      b.textContent = label;
      b.style.background = "#b9dc8a";
      b.style.color = "#0d2d4e";
    } else {
      paintButton();
    }
  }

  // ---------- screenshots ----------
  function shrink(file, cb) {
    if (!file || file.type.indexOf("image/") !== 0) { cb(null); return; }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var w = img.width, h = img.height;
      if (!w || !h) { URL.revokeObjectURL(url); cb(null); return; }
      if (w > MAX_DIM || h > MAX_DIM) {
        var s = Math.min(MAX_DIM / w, MAX_DIM / h);
        w = Math.round(w * s); h = Math.round(h * s);
      }
      var c = document.createElement("canvas");
      c.width = w; c.height = h;
      var ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      var d = "";
      try { d = c.toDataURL("image/jpeg", 0.82); } catch (e) { d = ""; }
      URL.revokeObjectURL(url);
      if (!d) { cb(null); return; }
      cb({ media_type: "image/jpeg", data: d.slice(d.indexOf(",") + 1), preview: d });
    };
    img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
    img.src = url;
  }

  function drawThumbs() {
    var box = el("rls-thumbs");
    var count = el("rls-count");

    if (!shots.length) {
      box.style.display = "none"; box.innerHTML = "";
      count.style.display = "none";
      paintButton(); pushHeight();
      return;
    }

    var html = "";
    for (var i = 0; i < shots.length; i++) {
      html += "<div style='position:relative;width:84px;height:84px;'>"
        + "<img src='" + shots[i].preview + "' alt='' style='width:84px;height:84px;object-fit:cover;border-radius:12px;border:1px solid #e3e8ec;display:block;'>"
        + "<button class='rls-x' data-i='" + i + "'>&times;</button></div>";
    }
    if (shots.length < MAX_IMAGES) {
      html += "<button id='rls-more' style='width:84px;height:84px;border:2px dashed #dfe6ea;border-radius:12px;background:#fff;color:#8a97a3;font-size:26px;line-height:1;cursor:pointer;font-family:inherit;'>+</button>";
    }
    box.innerHTML = html;
    box.style.display = "flex";

    count.textContent = shots.length + " of " + MAX_IMAGES + " added";
    count.style.display = "block";

    var xs = box.querySelectorAll(".rls-x");
    for (var k = 0; k < xs.length; k++) {
      xs[k].addEventListener("click", function (ev) {
        ev.stopPropagation();
        shots.splice(parseInt(this.getAttribute("data-i"), 10), 1);
        drawThumbs();
      });
    }
    var more = el("rls-more");
    if (more) more.addEventListener("click", function (ev) { ev.stopPropagation(); el("rls-file").click(); });

    paintButton();
    pushHeight();
  }

  function addFiles(list) {
    if (!list || !list.length) return;
    clearErr();

    var arr = [];
    for (var i = 0; i < list.length; i++) arr.push(list[i]);

    var room = MAX_IMAGES - shots.length;
    if (room <= 0) { showErr("You can add up to " + MAX_IMAGES + " screenshots. Remove one to add another."); return; }
    if (arr.length > room) {
      showErr("Only the first " + room + " were added. " + MAX_IMAGES + " screenshots is the limit.");
      arr = arr.slice(0, room);
    }

    var pending = arr.length;
    var failed = 0;
    arr.forEach(function (f) {
      shrink(f, function (res) {
        if (res) shots.push(res); else failed += 1;
        pending -= 1;
        if (pending <= 0) {
          drawThumbs();
          if (failed) showErr("We couldn't read " + (failed === 1 ? "one of those files" : failed + " of those files") + ". Try a JPG or PNG screenshot.");
        }
      });
    });
  }

  // ---------- results ----------
  function levelBlock(level, summary) {
    var map = {
      low:     { bg:"#eafaf1", bd:"#d4efdf", cl:"#1e8449", ic:"&#9989;",   t:"Looks lower risk" },
      caution: { bg:"#fef9e7", bd:"#fcecc0", cl:"#b9770e", ic:"&#9888;",   t:"Use caution" },
      high:    { bg:"#fdecea", bd:"#f8ccc6", cl:"#c0392b", ic:"&#128681;", t:"High scam risk" }
    };
    var m = map[level] || map.caution;
    return "<div style='background:" + m.bg + ";border:1px solid " + m.bd + ";border-radius:14px;padding:16px 18px;margin-bottom:14px;display:flex;align-items:center;gap:14px;'>"
      + "<div style='font-size:30px;line-height:1;color:" + m.cl + ";'>" + m.ic + "</div>"
      + "<div><p style='font-size:17px;font-weight:700;margin:0 0 2px;color:" + m.cl + ";'>" + m.t + "</p>"
      + "<p style='font-size:14px;line-height:1.5;margin:0;color:#4a5a6a;'>" + esc(summary) + "</p></div></div>";
  }

  function flagBlock(f) {
    var color = f.severity === "high" ? "#c0392b" : (f.severity === "low" ? "#3a9e8f" : "#b9770e");
    return "<div style='background:#fff;border:1px solid #e8eceb;border-left:4px solid " + color + ";border-radius:10px;padding:11px 14px;margin-bottom:9px;'>"
      + "<p style='font-size:14px;font-weight:700;color:#0d2d4e;margin:0 0 3px;'>" + esc(f.title) + "</p>"
      + "<p style='font-size:13px;color:#4a5a6a;line-height:1.5;margin:0;'>" + esc(f.detail) + "</p></div>";
  }

  function render(data) {
    var html = "<div style='background:#ffffff;border-radius:18px;padding:22px;'>";
    html += levelBlock(data.riskLevel, data.summary);

    if (data.flags && data.flags.length) {
      html += "<p style='font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#8a97a3;margin:18px 0 10px;'>Warning signs we noticed</p>";
      data.flags.forEach(function (f) { html += flagBlock(f); });
    }

    if (data.tips && data.tips.length) {
      html += "<p style='font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#8a97a3;margin:18px 0 10px;'>Stay safe</p>";
      html += "<ul style='background:#f4f7f6;border-radius:12px;padding:14px 16px 14px 30px;margin:0;'>";
      data.tips.forEach(function (t) { html += "<li style='font-size:13px;color:#0d2d4e;line-height:1.7;margin-bottom:4px;'>" + esc(t) + "</li>"; });
      html += "</ul>";
    }

    html += "<button id='rls-again' style='margin-top:16px;width:100%;background:#0d2d4e;color:#fff;border:none;border-radius:12px;padding:13px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;'>Check another listing</button>";
    html += "</div>";

    var r = el("rls-results");
    r.innerHTML = html;
    r.style.display = "block";
    el("rls-input").style.display = "none";
    el("rls-again").addEventListener("click", reset);

    pushHeight();
    post({ listingCheckScrollTop: true });
    if (window.scrollTo) window.scrollTo(0, 0);
  }

  function reset() {
    el("rls-results").style.display = "none";
    el("rls-results").innerHTML = "";
    el("rls-input").style.display = "block";
    el("rls-file").value = "";
    shots = [];
    clearErr();
    drawThumbs();
    pushHeight();
    post({ listingCheckScrollTop: true });
    if (window.scrollTo) window.scrollTo(0, 0);
  }

  // ---------- submit ----------
  function run() {
    if (busy) return;
    if (!shots.length) {
      showErr("Add a screenshot of the listing first.");
      el("rls-file").click();
      return;
    }

    clearErr();
    setBusy(true, shots.length > 1 ? "Reading your screenshots..." : "Reading your screenshot...");

    var payload = {
      images: shots.map(function (s) { return { media_type: s.media_type, data: s.data }; })
    };

    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      setBusy(false);
      showErr("That took too long. Try again, or remove a screenshot and check fewer at once.");
    }, TIMEOUT_MS);

    fetch(FN, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (done) return;
        done = true; clearTimeout(timer);
        setBusy(false);
        if (data && data.error) { showErr(data.error); return; }
        render(data);
      })
      .catch(function () {
        if (done) return;
        done = true; clearTimeout(timer);
        setBusy(false);
        showErr("Something went wrong. Please try again.");
      });
  }

  // ---------- wiring ----------
  function init() {
    el("rls-go").addEventListener("click", run);

    var drop = el("rls-drop"), file = el("rls-file");
    drop.addEventListener("click", function () { file.click(); });
    file.addEventListener("change", function () { addFiles(file.files); file.value = ""; });

    ["dragenter", "dragover"].forEach(function (e) {
      drop.addEventListener(e, function (ev) { ev.preventDefault(); ev.stopPropagation(); drop.className = "drag"; });
    });
    ["dragleave", "drop"].forEach(function (e) {
      drop.addEventListener(e, function (ev) { ev.preventDefault(); ev.stopPropagation(); drop.className = ""; });
    });
    drop.addEventListener("drop", function (ev) {
      if (ev.dataTransfer && ev.dataTransfer.files) addFiles(ev.dataTransfer.files);
    });

    // Paste an image anywhere on the page.
    document.addEventListener("paste", function (ev) {
      var dt = ev.clipboardData;
      if (!dt) return;
      var files = [];
      if (dt.files && dt.files.length) {
        for (var i = 0; i < dt.files.length; i++) {
          if (dt.files[i].type.indexOf("image/") === 0) files.push(dt.files[i]);
        }
      }
      if (files.length) { ev.preventDefault(); addFiles(files); }
    });

    paintButton();
    pushHeight();
  }

  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", init); }
  else { init(); }
})();
</script>
<script>(function(){function ph(){var b=document.body,e=document.documentElement;var h=Math.max(b.scrollHeight,b.offsetHeight,e.scrollHeight,e.offsetHeight,e.clientHeight);try{parent.postMessage({listingCheckHeight:h},"*");}catch(err){}}window.addEventListener("load",ph);window.addEventListener("resize",ph);var mo=new MutationObserver(ph);mo.observe(document.body,{childList:true,subtree:true,attributes:true,characterData:true});setInterval(ph,400);})();</script>
</body></html>`;

exports.handler = async () => ({
  statusCode: 200,
  headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  body: HTML
});
