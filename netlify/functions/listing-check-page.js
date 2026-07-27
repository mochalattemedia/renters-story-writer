// ============================================================
//  listing-check-page.js  ·  lcp-v3
//  Serves the Rental Listing Safety Check as a standalone page for
//  iframe embedding on BD (like Lisa). Posts its height to the parent
//  so the iframe can auto-resize.
//
//  v3 changelog:
//   - One card, three optional inputs, one button: link, screenshot,
//     or pasted text. Any one is enough.
//   - Screenshots: tap to choose, drag and drop, or paste an image.
//     Downscaled to 1400px JPEG in the browser before upload.
//   - Paste anywhere on the page: an image attaches itself, a long
//     block of text drops into the text box and opens it.
//   - "Tap to paste" clipboard button for mobile.
//   - Server can report it could not read a link; the card stays put
//     and just shows the note.
//
//  Pairs with: listing-check.js (lc-v3)
// ============================================================

const HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rental Listing Safety Check</title><style>
html,body{margin:0;padding:0;background:transparent;}
#rls-drop.drag{border-color:#8dc63f !important;background:#f2f9e8 !important;}
#rls-drop:hover{border-color:#3a9e8f;}
.rls-x{position:absolute;top:-7px;right:-7px;width:22px;height:22px;border-radius:50%;background:#0d2d4e;color:#fff;border:2px solid #fff;font-size:13px;line-height:18px;text-align:center;cursor:pointer;padding:0;font-family:inherit;font-weight:700;}
</style></head><body>
<!-- RENTERS.COM — RENTAL LISTING SAFETY CHECK · LINK + SCREENSHOT + PASTE -->
<div style="max-width:1000px;margin:0 auto;padding:4px;font-family:'Open Sans',Arial,sans-serif;">

  <div style="background:#0d2d4e;border-radius:22px;padding:30px 34px 34px;">

    <p style="font-size:30px;font-weight:800;color:#ffffff;margin:0 0 4px;line-height:1;">Safety Check<span style="color:#8dc63f;">.</span></p>
    <p style="font-size:15px;color:rgba(255,255,255,0.72);margin:0 0 20px;font-weight:300;line-height:1.6;">Send us a link, a screenshot, or the text of any rental listing and we&#39;ll flag common scam warning signs. Works for listings from anywhere.</p>

    <div id="rls-input" style="background:#ffffff;border-radius:18px;padding:22px;">

      <!-- LINK -->
      <input id="rls-url" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste the listing link..." style="width:100%;border:1px solid #e3e8ec;border-radius:14px;padding:14px 16px;font-size:15px;font-family:inherit;color:#0d2d4e;box-sizing:border-box;outline:none;">

      <!-- OR -->
      <div style="display:flex;align-items:center;gap:12px;margin:14px 0;">
        <div style="flex:1;height:1px;background:#eef2f4;"></div>
        <span style="font-size:12px;font-weight:700;letter-spacing:.06em;color:#b3bdc6;">OR</span>
        <div style="flex:1;height:1px;background:#eef2f4;"></div>
      </div>

      <!-- SCREENSHOT -->
      <div id="rls-drop" style="border:2px dashed #dfe6ea;border-radius:14px;padding:20px 16px;text-align:center;cursor:pointer;transition:border-color .15s,background .15s;">
        <div style="font-size:26px;line-height:1;margin-bottom:6px;">&#128247;</div>
        <p style="font-size:15px;font-weight:700;color:#0d2d4e;margin:0 0 3px;">Add a screenshot</p>
        <p style="font-size:13px;color:#8a97a3;margin:0;line-height:1.5;">Tap to choose a photo, or drop one here. Screenshots of the listing or of your chat with the landlord both work.</p>
      </div>
      <input id="rls-file" type="file" accept="image/*" multiple style="display:none;">
      <div id="rls-thumbs" style="display:none;flex-wrap:wrap;gap:10px;margin-top:12px;"></div>

      <!-- TEXT -->
      <p style="font-size:13px;color:#8a97a3;margin:14px 0 0;line-height:1.5;">Or <a id="rls-toggle" href="#" style="color:#3a9e8f;font-weight:700;text-decoration:none;">paste the listing text instead</a></p>

      <div id="rls-textwrap" style="display:none;margin-top:12px;">
        <textarea id="rls-text" placeholder="Paste the listing text, or the message someone sent you..." style="width:100%;min-height:130px;border:1px solid #e3e8ec;border-radius:14px;padding:14px 16px;font-size:15px;font-family:inherit;resize:vertical;color:#0d2d4e;box-sizing:border-box;outline:none;"></textarea>
        <div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <button id="rls-clip" style="background:#f4f7f6;color:#0d2d4e;border:1px solid #e3e8ec;border-radius:10px;padding:10px 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;">Tap to paste</button>
          <select id="rls-source" style="flex:1 1 220px;min-width:200px;border:1px solid #e3e8ec;border-radius:10px;padding:10px 12px;font-size:13px;font-family:inherit;color:#0d2d4e;background:#fff;box-sizing:border-box;outline:none;text-overflow:ellipsis;">
            <option value="unknown">Where did you find it?</option>
            <option value="craigslist">Craigslist</option>
            <option value="facebook">Facebook Marketplace or group</option>
            <option value="zillow">Zillow / Apartments.com / major site</option>
            <option value="other-site">Another listing website</option>
            <option value="message">A message someone sent me</option>
          </select>
        </div>
      </div>

      <!-- NOTE + ERROR -->
      <p id="rls-note" style="display:none;background:#fef9e7;border:1px solid #fcecc0;border-radius:12px;padding:12px 14px;font-size:13px;color:#7d5a10;line-height:1.55;margin:14px 0 0;"></p>
      <p id="rls-err" style="display:none;color:#c0392b;font-size:13px;margin:12px 0 0;"></p>

      <!-- GO -->
      <button id="rls-go" style="margin-top:16px;width:100%;background:#8dc63f;color:#0d2d4e;border:none;border-radius:12px;padding:15px;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit;">Check this listing</button>

    </div>

    <p style="font-size:13px;color:rgba(255,255,255,0.55);margin:16px 0 0;line-height:1.6;">This is a free automated aid, not a guarantee. It can miss things and can&#39;t confirm a listing is real &mdash; always verify independently and never send money before seeing a place in person.</p>

    <div id="rls-results" style="margin-top:20px;display:none;"></div>

  </div>
</div>

<script>
(function () {
  var FN = "https://renters-story-writer.netlify.app/.netlify/functions/listing-check";
  var TIMEOUT_MS = 30000;
  var MAX_IMAGES = 4;
  var MAX_DIM = 1400;
  var shots = [];

  function el(id) { return document.getElementById(id); }
  function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function showErr(msg) { var e = el("rls-err"); e.textContent = msg; e.style.display = "block"; }
  function clearErr() { var e = el("rls-err"); e.textContent = ""; e.style.display = "none"; }
  function showNote(msg) { var n = el("rls-note"); n.textContent = msg; n.style.display = "block"; }
  function clearNote() { var n = el("rls-note"); n.textContent = ""; n.style.display = "none"; }

  function openText() {
    el("rls-textwrap").style.display = "block";
    el("rls-toggle").parentNode.style.display = "none";
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
    if (!shots.length) { box.style.display = "none"; box.innerHTML = ""; return; }
    var html = "";
    for (var i = 0; i < shots.length; i++) {
      html += "<div style='position:relative;width:84px;height:84px;'>"
        + "<img src='" + shots[i].preview + "' alt='' style='width:84px;height:84px;object-fit:cover;border-radius:12px;border:1px solid #e3e8ec;display:block;'>"
        + "<button class='rls-x' data-i='" + i + "'>&times;</button></div>";
    }
    box.innerHTML = html;
    box.style.display = "flex";
    var xs = box.querySelectorAll(".rls-x");
    for (var k = 0; k < xs.length; k++) {
      xs[k].addEventListener("click", function (ev) {
        ev.stopPropagation();
        shots.splice(parseInt(this.getAttribute("data-i"), 10), 1);
        drawThumbs();
      });
    }
  }

  function addFiles(list) {
    if (!list || !list.length) return;
    clearErr();
    var arr = [];
    for (var i = 0; i < list.length; i++) arr.push(list[i]);
    var room = MAX_IMAGES - shots.length;
    if (room <= 0) { showErr("You can add up to " + MAX_IMAGES + " screenshots."); return; }
    arr = arr.slice(0, room);
    var pending = arr.length;
    arr.forEach(function (f) {
      shrink(f, function (res) {
        if (res) shots.push(res);
        pending -= 1;
        if (pending <= 0) drawThumbs();
      });
    });
  }

  // ---------- results ----------
  function levelBlock(level, summary, fetched) {
    var map = {
      low:     { bg:"#eafaf1", bd:"#d4efdf", cl:"#1e8449", ic:"&#9989;",   t:"Looks lower risk" },
      caution: { bg:"#fef9e7", bd:"#fcecc0", cl:"#b9770e", ic:"&#9888;",   t:"Use caution" },
      high:    { bg:"#fdecea", bd:"#f8ccc6", cl:"#c0392b", ic:"&#128681;", t:"High scam risk" }
    };
    var m = map[level] || map.caution;
    var src = fetched ? "<p style='font-size:12px;color:#8a97a3;margin:6px 0 0;'>Read from " + esc(fetched) + "</p>" : "";
    return "<div style='background:" + m.bg + ";border:1px solid " + m.bd + ";border-radius:14px;padding:16px 18px;margin-bottom:14px;display:flex;align-items:center;gap:14px;'>"
      + "<div style='font-size:30px;line-height:1;color:" + m.cl + ";'>" + m.ic + "</div>"
      + "<div><p style='font-size:17px;font-weight:700;margin:0 0 2px;color:" + m.cl + ";'>" + m.t + "</p>"
      + "<p style='font-size:14px;line-height:1.5;margin:0;color:#4a5a6a;'>" + esc(summary) + "</p>" + src + "</div></div>";
  }

  function flagBlock(f) {
    var color = f.severity === "high" ? "#c0392b" : (f.severity === "low" ? "#3a9e8f" : "#b9770e");
    return "<div style='background:#fff;border:1px solid #e8eceb;border-left:4px solid " + color + ";border-radius:10px;padding:11px 14px;margin-bottom:9px;'>"
      + "<p style='font-size:14px;font-weight:700;color:#0d2d4e;margin:0 0 3px;'>" + esc(f.title) + "</p>"
      + "<p style='font-size:13px;color:#4a5a6a;line-height:1.5;margin:0;'>" + esc(f.detail) + "</p></div>";
  }

  function render(data) {
    var html = "<div style='background:#ffffff;border-radius:18px;padding:22px;'>";
    html += levelBlock(data.riskLevel, data.summary, data.fetched);

    if (data.linkNote) {
      html += "<p style='background:#f4f7f6;border-radius:10px;padding:10px 13px;font-size:12px;color:#6b7a88;line-height:1.5;margin:0 0 14px;'>" + esc(data.linkNote) + "</p>";
    }

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
    if (r.scrollIntoView) r.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function reset() {
    el("rls-results").style.display = "none";
    el("rls-results").innerHTML = "";
    el("rls-input").style.display = "block";
    el("rls-url").value = "";
    el("rls-text").value = "";
    el("rls-source").value = "unknown";
    el("rls-file").value = "";
    shots = [];
    drawThumbs();
    clearErr();
    clearNote();
  }

  // ---------- submit ----------
  function setBusy(on, label) {
    var b = el("rls-go");
    b.disabled = on;
    b.textContent = on ? label : "Check this listing";
    b.style.opacity = on ? "0.65" : "1";
  }

  function run() {
    var url = el("rls-url").value.trim();
    var text = el("rls-text").value.trim();

    if (!url && !text && !shots.length) {
      showErr("Add a link, a screenshot, or the listing text to get started.");
      return;
    }
    if (url && url.indexOf(".") === -1) {
      showErr("That link does not look complete. Check the web address.");
      return;
    }

    clearErr(); clearNote();
    setBusy(true, shots.length ? "Reading your screenshots..." : (url ? "Reading the listing..." : "Checking..."));

    var payload = { source: el("rls-source").value };
    if (url) payload.url = url;
    if (text) payload.text = text;
    if (shots.length) {
      payload.images = shots.map(function (s) { return { media_type: s.media_type, data: s.data }; });
    }

    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      setBusy(false);
      showNote("That took too long. Try again, or add a screenshot of the listing instead.");
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
        if (data && data.needsPaste) { showNote(data.message || "Add a screenshot of the listing, or paste the text."); openText(); return; }
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

    el("rls-url").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); run(); }
    });

    el("rls-toggle").addEventListener("click", function (ev) { ev.preventDefault(); openText(); el("rls-text").focus(); });

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

    // Clipboard button (mobile-friendly).
    el("rls-clip").addEventListener("click", function () {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        showErr("Your browser will not let us read the clipboard. Long-press the box above and choose Paste.");
        return;
      }
      navigator.clipboard.readText().then(function (t) {
        if (!t) { showErr("Nothing to paste. Copy the listing first."); return; }
        clearErr();
        el("rls-text").value = t;
      }).catch(function () {
        showErr("Your browser will not let us read the clipboard. Long-press the box above and choose Paste.");
      });
    });

    // Paste anywhere: an image attaches, a long block of text opens the text box.
    document.addEventListener("paste", function (ev) {
      var dt = ev.clipboardData;
      if (!dt) return;

      var files = [];
      if (dt.files && dt.files.length) {
        for (var i = 0; i < dt.files.length; i++) {
          if (dt.files[i].type.indexOf("image/") === 0) files.push(dt.files[i]);
        }
      }
      if (files.length) { ev.preventDefault(); addFiles(files); return; }

      var t = "";
      try { t = dt.getData("text/plain") || ""; } catch (e) { t = ""; }
      if (!t) return;

      var tag = (ev.target && ev.target.tagName) ? ev.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea") return; // let the field handle it

      if (t.trim().length > 60) {
        ev.preventDefault();
        openText();
        el("rls-text").value = t.trim();
        clearErr();
      }
    });
  }

  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", init); }
  else { init(); }
})();
</script>
<script>(function(){function ph(){var b=document.body,e=document.documentElement;var h=Math.max(b.scrollHeight,b.offsetHeight,e.scrollHeight,e.offsetHeight,e.clientHeight);try{parent.postMessage({listingCheckHeight:h},"*");}catch(err){}}window.addEventListener("load",ph);window.addEventListener("resize",ph);var mo=new MutationObserver(ph);mo.observe(document.body,{childList:true,subtree:true,attributes:true,characterData:true});setInterval(ph,500);})();</script>
</body></html>`;

exports.handler = async () => ({
  statusCode: 200,
  headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  body: HTML
});
