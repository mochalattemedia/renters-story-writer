(function () {
  var FN = "https://renters-story-writer.netlify.app/.netlify/functions/send-listing-draft-email";
  var KEY = "A5lnMxcTVBsZ1yuO6oJUEgkw";
  var PANEL = "rdc-trk-panel";
  var existing = document.getElementById(PANEL);
  if (existing) {
    existing.remove();
    if (window.__rdcObs) { try { window.__rdcObs.disconnect(); } catch (e) {} window.__rdcObs = null; }
    var olds = document.querySelectorAll(".rdc-badge");
    for (var q = 0; q < olds.length; q++) olds[q].remove();
    return;
  }
  if (window.__rdcObs) { try { window.__rdcObs.disconnect(); } catch (e) {} window.__rdcObs = null; }
  function esc(x) { return String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function d10(x) { return String(x || "").slice(0, 10); }
  var IDX = {};
  function collectRows() {
    var uls = document.querySelectorAll("ul.dates");
    var rows = [];
    for (var i = 0; i < uls.length; i++) {
      var ul = uls[i], txt = ul.textContent || "";
      var mm = txt.match(/ID:\s*(\d+)/);
      if (!mm) continue;
      var td = ul.closest ? (ul.closest("td") || ul.parentElement) : ul.parentElement;
      if (!td) continue;
      var le = txt.match(/Last Edit:\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
      rows.push({ id: mm[1], td: td, lastEdit: le ? le[1] : "" });
    }
    return rows;
  }
  function drawBadge(row, s) {
    var td = row.td;
    var prev = td.querySelector(".rdc-badge");
    if (prev) prev.remove();
    if (!s) return;
    var au = s.auto || {};
    var photo = au.photo || (au.items && !au.listing && !au.profile ? au.items : []) || [];
    var listing = au.listing || [];
    var profile = au.profile || [];
    var anyAuto = photo.length + listing.length + profile.length;
    var manual = (s.items && s.items.length) ? s.items : [];
    var scanned = !!au.date;
    var editedSince = false;
    if (row.lastEdit && s.date) {
      var p = row.lastEdit.split("/");
      var leDay = new Date(+p[2], +p[0] - 1, +p[1]).getTime();
      var rd = new Date(s.date);
      var rDay = new Date(rd.getFullYear(), rd.getMonth(), rd.getDate()).getTime();
      if (leDay > rDay) editedSince = true;
    }
    var label = s.to ? ("notified " + d10(s.date)) : (scanned ? ("scanned " + d10(au.date)) : ("noted " + d10(s.date)));
    var d = document.createElement("div");
    d.className = "rdc-badge";
    function grp(title, arr) {
      if (!arr || !arr.length) return "";
      return "<div style=\"margin-top:4px;\"><span style=\"font-weight:800;text-transform:uppercase;font-size:11px;letter-spacing:.03em;\">" + title + ":</span> " + arr.map(esc).join("; ") + "</div>";
    }
    if (editedSince) {
      d.style.cssText = "margin:8px 0;padding:8px 10px;background:#fee2e2;border:1px solid #fecaca;border-radius:8px;color:#7f1d1d;font-size:13px;line-height:1.45;";
      d.innerHTML = "<strong>&#9888; Edited " + esc(row.lastEdit) + " after your notice (" + esc(label) + ") &mdash; re-review.</strong>" + grp("Photos", photo) + grp("Listing", listing) + grp("Profile", profile) + (!anyAuto && manual.length ? "<div style=\"margin-top:4px;\">Was flagged: " + manual.map(esc).join("; ") + "</div>" : "");
    } else if (anyAuto) {
      d.style.cssText = "margin:8px 0;padding:8px 10px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;color:#7c2d12;font-size:13px;line-height:1.45;";
      d.innerHTML = "<strong>Needs</strong> <span style=\"color:#9a6a3a;\">(" + esc(label) + ")</span>" + grp("Photos", photo) + grp("Listing", listing) + grp("Profile", profile);
    } else if (manual.length) {
      d.style.cssText = "margin:8px 0;padding:8px 10px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;color:#7c2d12;font-size:13px;line-height:1.45;";
      d.innerHTML = "<strong>Needs:</strong> " + manual.map(esc).join("; ") + " <span style=\"color:#9a6a3a;\">(" + esc(label) + ")</span>";
    } else if (scanned) {
      d.style.cssText = "margin:8px 0;padding:8px 10px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;color:#065f46;font-size:13px;line-height:1.45;";
      d.innerHTML = "<strong>&#10003; Listing looks complete</strong> <span style=\"color:#4b8b73;\">(" + esc(label) + ")</span>";
    } else { return; }
    var hasGaps = anyAuto || manual.length;
    var isLive = au.group_status === "1";
    var land = s.landlord || {};
    var hasLand = !!(land.userId || land.email);
    var foot = document.createElement("div");
    foot.style.cssText = "margin-top:7px;padding-top:6px;border-top:1px solid rgba(0,0,0,.12);font-size:12px;display:flex;align-items:center;gap:8px;flex-wrap:nowrap;";
    foot.innerHTML = s.notifyCount ? ("<span>&#9993; Emailed " + s.notifyCount + "&times;, last " + esc(d10(s.lastNotified || s.date)) + "</span>") : "<span style=\"opacity:.75;\">Not emailed yet</span>";
    // ANY listing with a landlord, live or not. Publication is no longer the
    // goal - matching is - so a LIVE listing with weak photos is exactly one
    // worth writing about. The TONE changes rather than the availability.
    if (hasLand) {
      var sendListing = anyAuto ? photo.concat(listing) : manual;
      var sendProfile = anyAuto ? profile : [];
      var to = land.email || ("member " + land.userId);
      var b = document.createElement("button");
      // FIXED WIDTH AND A LABEL THAT NEVER CHANGES LENGTH.
      // The old version swapped in the full email address on arming, which made
      // the button far wider, wrapped it onto a new line inside a flex-wrap
      // footer, and moved it out from under the cursor - so the second click
      // landed on the footer div and nothing was ever sent.
      b.style.cssText = "margin-left:auto;background:#0d2d4e;color:#fff;border:0;border-radius:7px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;width:130px;min-width:130px;flex:0 0 130px;text-align:center;box-sizing:border-box;white-space:nowrap;overflow:hidden;";
      var IDLE = s.notifyCount ? "Email again" : "Email landlord";
      // Say which of the two emails this will send, so it is never a surprise.
      var tonePill = document.createElement("span");
      tonePill.textContent = isLive ? "suggestion" : "draft notice";
      tonePill.style.cssText = "font-size:11px;font-weight:700;padding:2px 7px;border-radius:999px;"
        + (isLive ? "background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;" : "background:#fff7ed;color:#7c2d12;border:1px solid #fed7aa;");
      foot.appendChild(tonePill);
      b.textContent = IDLE;
      b.title = "Send to " + to;
      var armed = false, timer = null;
      function disarm() {
        armed = false;
        if (timer) { clearTimeout(timer); timer = null; }
        b.textContent = IDLE;
        b.style.background = "#0d2d4e";
      }
      function send() {
        disarm();
        b.disabled = true;
        b.style.opacity = ".6";
        b.textContent = "Sending...";
        fetch(FN, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: KEY, postId: row.id,
            memberId: land.userId || "", email: land.email || "",
            listingReasons: sendListing, profileReasons: sendProfile,
            // A live listing gets the suggestion framing. The draft wording
            // asserts the listing has been set back to draft, which is untrue
            // for anything already published.
            tone: isLive ? "improve" : "draft"
          })
        })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (res) {
            if (res.ok && res.j && res.j.success) {
              s.notifyCount = res.j.notifyCount || ((s.notifyCount || 0) + 1);
              s.lastNotified = new Date().toISOString();
              s.to = res.j.email || land.email;
              IDX[row.id] = s;
              paint();
            } else {
              b.disabled = false; b.style.opacity = "1";
              b.textContent = "Failed - retry";
              // Surface the reason rather than hiding it behind a generic label.
              try { console.error("[tracker] send failed", res.j); } catch (e) {}
              b.title = (res.j && (res.j.error || res.j.detail)) || "unknown error";
            }
          })
          .catch(function (e) {
            b.disabled = false; b.style.opacity = "1";
            b.textContent = "Error - retry";
            b.title = String(e && e.message);
          });
      }
      b.onclick = function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (!armed) {
          armed = true;
          b.textContent = "Confirm send";
          b.style.background = "#b45309";
          timer = setTimeout(disarm, 6000);
          return;
        }
        send();
      };
      foot.appendChild(b);
    }
    d.appendChild(foot);
    td.insertBefore(d, td.firstChild);
  }
  function paint() {
    if (window.__rdcObs) { try { window.__rdcObs.disconnect(); } catch (e) {} }
    var rows = collectRows(), shown = 0;
    for (var i = 0; i < rows.length; i++) {
      if (IDX[rows[i].id]) { drawBadge(rows[i], IDX[rows[i].id]); shown++; }
    }
    if (window.__rdcObs) { try { window.__rdcObs.observe(document.body, { childList: true, subtree: true }); } catch (e) {} }
    return { rows: rows.length, shown: shown };
  }
  function loadStatuses() {
    return fetch(FN + "?statuses=1&cb=" + (window.performance ? Math.round(performance.now()) : "1"), { headers: { "x-admin-key": KEY } })
      .then(function (r) { return r.json(); })
      .then(function (idx) { IDX = idx || {}; return IDX; });
  }
  var w = document.createElement("div");
  w.id = PANEL;
  w.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;width:280px;background:#0d2d4e;color:#fff;padding:12px 14px;border-radius:10px;font-family:Arial,sans-serif;font-size:13px;box-shadow:0 8px 24px rgba(2,6,23,.35);";
  w.innerHTML = '<div style="font-weight:700;margin-bottom:8px;">Listing tracker'
    + '<span id="rdctx" style="float:right;cursor:pointer;font-weight:400;">[x]</span></div>'
    + '<div id="rdctinfo" style="margin-bottom:10px;line-height:1.4;color:#cbd8e6;">Loading&hellip;</div>'
    + '<button id="rdctscan" style="width:100%;background:#8dc63f;color:#0d2d4e;border:0;border-radius:8px;padding:9px;font-size:14px;font-weight:700;cursor:pointer;">Scan this page</button>'
    + '<div id="rdctprog" style="margin-top:9px;min-height:16px;color:#cbd8e6;line-height:1.4;"></div>';
  document.body.appendChild(w);
  document.getElementById("rdctx").onclick = function () {
    w.remove();
    if (window.__rdcObs) { try { window.__rdcObs.disconnect(); } catch (e) {} window.__rdcObs = null; }
    var b2 = document.querySelectorAll(".rdc-badge");
    for (var z = 0; z < b2.length; z++) b2[z].remove();
  };
  function info(m) { var e = document.getElementById("rdctinfo"); if (e) e.innerHTML = m; }
  function prog(m) { var e = document.getElementById("rdctprog"); if (e) e.innerHTML = m; }
  var repaintTimer = null;
  window.__rdcObs = new MutationObserver(function () {
    clearTimeout(repaintTimer);
    repaintTimer = setTimeout(function () {
      var r = paint();
      info(r.rows + " listings on this page, " + r.shown + " with saved info. Click <b>Scan this page</b> to (re)check.");
    }, 400);
  });
  window.__rdcObs.observe(document.body, { childList: true, subtree: true });
  loadStatuses()
    .then(function () {
      var r = paint();
      info(r.rows + " listings on this page, " + r.shown + " with saved info. Click <b>Scan this page</b> to (re)check.");
    })
    .catch(function (e) { info("Couldn't load saved statuses (" + esc(e && e.message) + ")."); });
  document.getElementById("rdctscan").onclick = function () {
    var btn = this;
    btn.disabled = true; btn.style.opacity = ".6";
    var allRows = collectRows(), total = allRows.length;
    var POOL = 2, MAX_ATTEMPTS = 3;
    var counted = {}, needs = 0, clean = 0, doneOk = 0;
    function tick(extra) {
      prog("Scanned " + (doneOk) + " / " + total + " &nbsp; (" + needs + " need work, " + clean + " ok)" + (extra ? (" " + extra) : ""));
    }
    function failBadge(row, msg) {
      var td = row.td;
      var prev = td.querySelector(".rdc-badge");
      if (prev) prev.remove();
      var d = document.createElement("div");
      d.className = "rdc-badge";
      d.style.cssText = "margin:8px 0;padding:8px 10px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;color:#475569;font-size:12px;line-height:1.4;";
      d.innerHTML = "Couldn't scan: " + esc(msg || "unknown error");
      td.insertBefore(d, td.firstChild);
    }
    function round(list) {
      var queue = list.slice(), roundFailed = [];
      function scanOne(row) {
        return fetch(FN, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: KEY, scanPost: row.id })
        })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }, function () { return { ok: false, j: null }; }); })
          .then(function (res) {
            var g = res.j && res.j.gaps;
            if (res.ok && g) {
              var s = {
                auto: { photo: g.photo || [], listing: g.listing || [], profile: g.profile || [], date: new Date().toISOString(), group_status: res.j.group_status },
                landlord: res.j.landlordEmail ? { email: res.j.landlordEmail } : null
              };
              // KEEP THE LANDLORD WE ALREADY HAD. A scan returns only the email,
              // so overwriting wholesale threw away a stored userId and could
              // leave a listing with no way to email its owner.
              var old = IDX[row.id];
              if (old && old.landlord) {
                s.landlord = {
                  userId: (old.landlord.userId || ""),
                  email: (res.j.landlordEmail || old.landlord.email || ""),
                  name: (old.landlord.name || "")
                };
                if (old.notifyCount) { s.notifyCount = old.notifyCount; s.lastNotified = old.lastNotified; s.to = old.to; }
              }
              IDX[row.id] = s;
              drawBadge(row, s);
              if (!counted[row.id]) {
                counted[row.id] = 1; doneOk++;
                if ((g.photo && g.photo.length) || (g.listing && g.listing.length) || (g.profile && g.profile.length)) needs++;
                else clean++;
              }
              tick();
            } else {
              roundFailed.push({ row: row, reason: (res.j && (res.j.error || res.j.detail)) || "timed out" });
            }
          })
          .catch(function (e) { roundFailed.push({ row: row, reason: (e && e.message) || "network error" }); });
      }
      function pump() { if (!queue.length) return Promise.resolve(); return scanOne(queue.shift()).then(pump); }
      var pumps = [];
      for (var k = 0; k < POOL; k++) pumps.push(pump());
      return Promise.all(pumps).then(function () { return roundFailed; });
    }
    var attempt = 0;
    function go(list) {
      attempt++;
      return round(list).then(function (failed) {
        if (failed.length && attempt < MAX_ATTEMPTS) {
          tick("- retrying " + failed.length + "...");
          return new Promise(function (r) { setTimeout(r, 900); }).then(function () { return go(failed.map(function (f) { return f.row; })); });
        }
        for (var i = 0; i < failed.length; i++) failBadge(failed[i].row, failed[i].reason);
        return failed;
      });
    }
    tick();
    go(allRows).then(function (failed) {
      var fc = failed.length;
      prog("Done: " + needs + " need work, " + clean + " look complete" + (fc ? (", " + fc + " couldn't scan") : "") + ". Syncing...");
      loadStatuses().then(function () {
        paint();
        prog("Done: " + needs + " need work, " + clean + " look complete" + (fc ? (", " + fc + " couldn't scan") : "") + ". Saved.");
        btn.disabled = false; btn.style.opacity = "1";
      })
        .catch(function () { btn.disabled = false; btn.style.opacity = "1"; });
    });
  };
})();
