/* ============================================================
   Renters.com Verification Panel  ·  v4 (CRM)
   Replaces verify-queue.js. Loaded automatically in BD admin.

   Data flow:
     1) Parse verify_business submissions from the Forms Inbox page
     2) Record each into the Netlify Blobs log  (verify-log)
     3) Fetch rich member data for each          (verify-member)
     4) Render a sortable/filterable CRM table with status
   Actions:
     - Approve: native BD verify (viewMembers.php, both checkmarks)
                + log update (approved) + approval email + photo delete
     - Deny:    notice email + log update (denied) + photo delete
   Status comes from the LOG (persistent), so it remembers across
   sessions and flags duplicates.
   ============================================================ */
(function () {
  var FN_BASE = "https://renters-story-writer.netlify.app/.netlify/functions";
  var LOG = FN_BASE + "/verify-log";
  var MEMBER = FN_BASE + "/verify-member";
  var EMAIL = FN_BASE + "/send-verification-email";
  var KEY = "renters2026";

  if (document.getElementById("rp-overlay")) document.getElementById("rp-overlay").remove();
  if (document.getElementById("rp-style")) document.getElementById("rp-style").remove();

  /* ---------- styles ---------- */
  var css = ""
    + "#rp-overlay{position:fixed;inset:0;background:rgba(8,20,35,.7);z-index:99999;display:flex;align-items:flex-start;justify-content:center;padding:18px;overflow-y:auto;font-family:Arial,Helvetica,sans-serif;}"
    + "#rp-panel{background:#fff;border-radius:14px;width:100%;max-width:1180px;color:#0d2d4e;padding:22px;margin:auto;position:relative;box-shadow:0 20px 60px rgba(0,0,0,.3);}"
    + "#rp-close{position:absolute;top:14px;right:16px;background:none;border:none;font-size:22px;cursor:pointer;color:#4a5a6a;}"
    + "#rp-h{font-size:20px;font-weight:700;margin:0 0 2px;}"
    + "#rp-sub{font-size:13px;color:#4a5a6a;margin:0 0 16px;}"
    + ".rp-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;}"
    + ".rp-fbtn{padding:6px 13px;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid #e3e8e7;background:#fff;color:#0d2d4e;}"
    + ".rp-fbtn.on{background:#0d2d4e;color:#fff;border-color:#0d2d4e;}"
    + ".rp-spacer{flex:1;}"
    + "#rp-count{font-size:12px;color:#4a5a6a;}"
    + ".rp-card{border:1px solid #e8eceb;border-radius:11px;padding:14px;margin-bottom:11px;display:grid;grid-template-columns:88px 1fr 230px 150px;gap:14px;align-items:start;}"
    + ".rp-card.dup{border-left:4px solid #e67e22;}"
    + ".rp-card.pending{border-left:4px solid #f1c40f;}"
    + ".rp-card.approved{border-left:4px solid #27ae60;}"
    + ".rp-card.denied{border-left:4px solid #c0392b;}"
    + ".rp-photo{width:88px;height:88px;border-radius:9px;object-fit:cover;border:1px solid #e8eceb;display:block;}"
    + ".rp-photo-x{width:88px;height:88px;border-radius:9px;border:2px dashed #f1c40f;display:flex;align-items:center;justify-content:center;font-size:10px;color:#9a7d0a;text-align:center;background:#fefcf3;padding:6px;box-sizing:border-box;}"
    + ".rp-name{font-size:15px;font-weight:700;margin:0 0 4px;}"
    + ".rp-row{font-size:12px;color:#4a5a6a;margin:0 0 2px;line-height:1.5;}"
    + ".rp-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;margin-right:5px;}"
    + ".b-renter{background:#d4efdf;color:#1e8449;}"
    + ".b-landlord{background:#d6eaf8;color:#1a5276;}"
    + ".b-pm{background:#e8daef;color:#6c3483;}"
    + ".b-realtor{background:#fdebd0;color:#9c640c;}"
    + ".b-other{background:#f2f4f4;color:#566573;}"
    + ".rp-ctx{font-size:11px;color:#566573;background:#f8fafa;border-radius:8px;padding:8px 10px;line-height:1.6;}"
    + ".rp-ctx b{color:#0d2d4e;}"
    + ".rp-meter{height:5px;border-radius:3px;background:#eef2f1;margin:4px 0 2px;overflow:hidden;}"
    + ".rp-meter span{display:block;height:100%;background:#3a9e8f;}"
    + ".rp-acts{display:flex;flex-direction:column;gap:7px;}"
    + ".rp-btn{padding:8px 10px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;border:none;width:100%;text-align:center;text-decoration:none;display:block;box-sizing:border-box;}"
    + ".rp-ap{background:#3a9e8f;color:#fff;}"
    + ".rp-dn{background:#c0392b;color:#fff;}"
    + ".rp-vw{background:#f4f7f6;color:#0d2d4e;border:1px solid #e8eceb;font-size:11px;}"
    + ".rp-btn:disabled{opacity:.5;cursor:not-allowed;}"
    + ".rp-stat{font-size:12px;font-weight:700;padding:6px;border-radius:6px;text-align:center;}"
    + ".s-approved{background:#d4efdf;color:#1e8449;}"
    + ".s-denied{background:#fadbd8;color:#922b21;}"
    + ".rp-stat small{display:block;font-weight:400;font-size:10px;margin-top:2px;}"
    + ".rp-dupflag{font-size:10px;font-weight:700;color:#b9770e;background:#fef5e7;border-radius:4px;padding:2px 6px;display:inline-block;margin-bottom:4px;}"
    + ".rp-load{text-align:center;padding:40px;color:#4a5a6a;font-size:14px;}"
    + ".rp-vbadge{font-size:11px;font-weight:700;color:#1e8449;}";

  var st = document.createElement("style");
  st.id = "rp-style"; st.textContent = css;
  document.head.appendChild(st);

  var overlay = document.createElement("div");
  overlay.id = "rp-overlay";
  overlay.innerHTML = ""
    + "<div id='rp-panel'>"
    + "<button id='rp-close'>&#10005;</button>"
    + "<p id='rp-h'>Verification Center</p>"
    + "<p id='rp-sub'>Parsing submissions&hellip;</p>"
    + "<div class='rp-bar' id='rp-bar' style='display:none;'>"
    + "<button class='rp-fbtn on' data-f='status' data-v='all'>All</button>"
    + "<button class='rp-fbtn' data-f='status' data-v='pending'>Pending</button>"
    + "<button class='rp-fbtn' data-f='status' data-v='approved'>Approved</button>"
    + "<button class='rp-fbtn' data-f='status' data-v='denied'>Denied</button>"
    + "<span style='width:10px;'></span>"
    + "<button class='rp-fbtn on' data-f='type' data-v='all'>All types</button>"
    + "<button class='rp-fbtn' data-f='type' data-v='renter'>Renters</button>"
    + "<button class='rp-fbtn' data-f='type' data-v='landlord'>Landlords</button>"
    + "<button class='rp-fbtn' data-f='type' data-v='property manager'>PM</button>"
    + "<button class='rp-fbtn' data-f='type' data-v='realtor'>Realtors</button>"
    + "<span class='rp-spacer'></span>"
    + "<button class='rp-fbtn' id='rp-sort'>Newest first</button>"
    + "<span id='rp-count'></span>"
    + "</div>"
    + "<div id='rp-list'><div class='rp-load'>Loading&hellip;</div></div>"
    + "</div>";
  document.body.appendChild(overlay);

  document.getElementById("rp-close").onclick = function () {
    overlay.remove(); st.remove();
  };

  /* ---------- state ---------- */
  var cards = [];           // merged: submission + log + member
  var fStatus = "all", fType = "all", sortNewest = true;

  /* ---------- helpers ---------- */
  function badgeClass(t) {
    t = (t || "").toLowerCase();
    if (t.indexOf("renter") > -1) return "b-renter";
    if (t.indexOf("landlord") > -1) return "b-landlord";
    if (t.indexOf("property") > -1) return "b-pm";
    if (t.indexOf("realtor") > -1) return "b-realtor";
    return "b-other";
  }
  function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fmtDate(d) { if (!d) return ""; try { return new Date(d).toLocaleDateString(); } catch (e) { return d; } }

  function api(url, opts) {
    return fetch(url, opts).then(function (r) { return r.json(); });
  }

  /* ---------- parse submissions from BD Forms Inbox ---------- */
  function parseRows() {
    var out = [], seen = {};
    var rows = document.querySelectorAll("table.form-inquiries-table tbody tr.odd, table.form-inquiries-table tbody tr.even");
    rows.forEach(function (row, idx) {
      if (row.textContent.indexOf("verify_business") === -1) return;
      var inner = row.querySelector("table.insider-table");
      if (!inner) return;
      var im = row.textContent.match(/Inquiry ID[:\s#]*(\d+)/i);
      var inquiryId = im ? im[1] : "r" + idx;
      if (seen[inquiryId]) return; seen[inquiryId] = 1;
      var dm = row.textContent.match(/Submitted[:\s]*(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
      var submitted = dm ? dm[1] : "";
      var link = inner.querySelector("small a[href*='viewMembers']");
      var name = "Unknown", memberId = "", profileUrl = "";
      if (link) {
        var lt = link.textContent.trim();
        var nm = lt.match(/Member ID #(\d+)\s*[-\u2013]\s*(.+)/i);
        if (nm) { memberId = nm[1]; name = nm[2].trim(); }
        else { var idm = lt.match(/#(\d+)/); memberId = idm ? idm[1] : ""; name = lt.replace(/Member ID #\d+/i, "").replace(/[-\u2013]/g, "").trim() || "Unknown"; }
        profileUrl = "https://ww2.managemydirectory.com" + link.getAttribute("href");
      }
      out.push({ inquiryId: inquiryId, memberId: memberId, name: name, submitted: submitted, profileUrl: profileUrl });
    });
    return out;
  }

  /* ---------- render ---------- */
  function visible() {
    return cards.filter(function (c) {
      if (fStatus !== "all" && c.status !== fStatus) return false;
      if (fType !== "all") {
        var t = (c.member && c.member.accountType ? c.member.accountType : "").toLowerCase();
        if (t.indexOf(fType) === -1) return false;
      }
      return true;
    }).sort(function (a, b) {
      var x = new Date(a.submitted || 0).getTime(), y = new Date(b.submitted || 0).getTime();
      return sortNewest ? y - x : x - y;
    });
  }

  function render() {
    var list = document.getElementById("rp-list");
    var vis = visible();
    document.getElementById("rp-count").textContent = vis.length + " of " + cards.length;
    if (!vis.length) { list.innerHTML = "<div class='rp-load'>No matching submissions.</div>"; return; }
    list.innerHTML = vis.map(function (c) {
      var m = c.member || {};
      var photo = c.photoUrl
        ? "<img class='rp-photo' src='" + c.photoUrl + "' onerror=\"this.outerHTML='<div class=rp-photo-x>photo gone</div>'\">"
        : (m.profilePhoto ? "<img class='rp-photo' src='" + esc(m.profilePhoto) + "'>" : "<div class='rp-photo-x'>no photo</div>");

      var typeBadge = "<span class='rp-badge " + badgeClass(m.accountType) + "'>" + esc(m.accountType || "?") + "</span>";
      var vbadge = m.verified ? "<span class='rp-vbadge'>&#10003; verified</span>" : "";

      // rich context (renter shows rental info; everyone shows completeness)
      var ctx = "";
      if (m.accountType && m.accountType.toLowerCase().indexOf("renter") > -1) {
        var ri = m.rentalInfo || {};
        ctx += (c.seeking || m.seeking ? "<div><b>Seeking:</b> " + esc(m.seeking || "") + "</div>" : "");
        if (ri.budget) ctx += "<div><b>Budget:</b> " + esc(ri.budget) + "</div>";
        if (ri.timeline) ctx += "<div><b>Move:</b> " + esc(ri.timeline) + "</div>";
        if (ri.household) ctx += "<div><b>Household:</b> " + esc(ri.household) + "</div>";
        if (ri.income) ctx += "<div><b>Income:</b> " + esc(ri.income) + "</div>";
        if (ri.pets) ctx += "<div><b>Pets:</b> " + esc(ri.pets) + "</div>";
        if (ri.idealRental) ctx += "<div><b>Ideal:</b> " + esc(ri.idealRental) + "</div>";
      }
      var pct = (m.profileCompletePct != null ? m.profileCompletePct : 0);
      ctx += "<div style='margin-top:6px;'><b>Profile:</b> " + pct + "%</div><div class='rp-meter'><span style='width:" + pct + "%;'></span></div>";
      if (m.optStatus && m.optStatus !== "none") ctx += "<div><b>Matching:</b> " + esc(m.optStatus) + "</div>";

      var dupFlag = c.duplicate ? "<span class='rp-dupflag'>DUPLICATE - already " + esc(c.status) + "</span>" : "";

      var acts;
      if (c.status === "pending") {
        acts = "<button class='rp-btn rp-ap' id='ap-" + c.inquiryId + "' onclick=\"rpApprove('" + c.inquiryId + "')\">&#10003; Approve</button>"
          + "<button class='rp-btn rp-dn' id='dn-" + c.inquiryId + "' onclick=\"rpDeny('" + c.inquiryId + "')\">&#10005; Deny</button>"
          + (c.profileUrl ? "<a class='rp-btn rp-vw' href='" + c.profileUrl + "' target='_blank'>BD Profile</a>" : "");
      } else {
        var sc = c.status === "approved" ? "s-approved" : "s-denied";
        var lbl = c.status === "approved" ? "&#10003; Approved" : "&#10005; Denied";
        acts = "<div class='rp-stat " + sc + "'>" + lbl + (c.decidedAt ? "<small>" + fmtDate(c.decidedAt) + "</small>" : "") + "</div>"
          + (c.profileUrl ? "<a class='rp-btn rp-vw' href='" + c.profileUrl + "' target='_blank' style='margin-top:6px;'>BD Profile</a>" : "");
      }

      return "<div class='rp-card " + c.status + (c.duplicate ? " dup" : "") + "' id='card-" + c.inquiryId + "'>"
        + "<div>" + photo + "</div>"
        + "<div>" + dupFlag + "<p class='rp-name'>" + esc(m.name || c.name) + " " + vbadge + "</p>"
        + "<p class='rp-row'>" + typeBadge + "Member #" + esc(c.memberId) + "</p>"
        + (m.email ? "<p class='rp-row'>&#9993; " + esc(m.email) + "</p>" : "")
        + (m.phone ? "<p class='rp-row'>&#9742; " + esc(m.phone) + "</p>" : "")
        + (m.location ? "<p class='rp-row'>&#128205; " + esc(m.location) + "</p>" : "")
        + "<p class='rp-row'>&#128197; submitted " + esc(c.submitted) + "</p></div>"
        + "<div class='rp-ctx'>" + ctx + "</div>"
        + "<div class='rp-acts'>" + acts + "</div>"
        + "</div>";
    }).join("");
  }

  /* ---------- actions ---------- */
  function deletePhoto(p) {
    if (!p) return Promise.resolve();
    return fetch("https://ww2.managemydirectory.com/admin/fileaddon/delete", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "file=" + encodeURIComponent(p)
    }).catch(function () {});
  }
  function sendEmail(type, email, name) {
    if (!email) return Promise.resolve();
    return fetch(EMAIL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: type, email: email, name: name })
    }).catch(function () {});
  }
  function logUpdate(memberId, status) {
    return api(LOG, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", key: KEY, memberId: memberId, status: status, decidedBy: "admin" })
    }).catch(function () {});
  }

  window.rpApprove = function (id) {
    var c = cards.find(function (x) { return x.inquiryId === id; });
    if (!c) return;
    if (!confirm("Approve " + (c.member && c.member.name || c.name) + " (Member #" + c.memberId + ")?\nThis verifies their account (both checkmarks) and deletes their verification photo.")) return;
    var ap = document.getElementById("ap-" + id), dn = document.getElementById("dn-" + id);
    if (ap) { ap.disabled = true; ap.textContent = "Processing..."; } if (dn) dn.disabled = true;

    var fd = new URLSearchParams();
    fd.append("faction", "bulkmemberactions");
    fd.append("newsite", "38748");
    fd.append("total_records", "1");
    fd.append("bulk_action_type", "selected_rows");
    fd.append("selected_rows", c.memberId);
    fd.append("bulk_action", "update-verified-status");
    fd.append("new_value", "1");
    fd.append("apply_subaccounts", "");

    fetch("https://ww2.managemydirectory.com/admin/viewMembers.php", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: fd.toString()
    }).then(function () { return deletePhoto(c.photoPath); })
      .then(function () { return logUpdate(c.memberId, "approved"); })
      .then(function () {
        c.status = "approved"; c.decidedAt = new Date().toISOString(); c.duplicate = false;
        render();
        sendEmail("approved", c.member && c.member.email, c.member && c.member.name || c.name);
      })
      .catch(function (e) { alert("Approve error. Try in BD admin.\n" + e); });
  };

  window.rpDeny = function (id) {
    var c = cards.find(function (x) { return x.inquiryId === id; });
    if (!c) return;
    if (!confirm("Deny " + (c.member && c.member.name || c.name) + "'s verification?\nA rejection email will be sent and their photo deleted.")) return;
    var ap = document.getElementById("ap-" + id), dn = document.getElementById("dn-" + id);
    if (ap) ap.disabled = true; if (dn) { dn.disabled = true; dn.textContent = "Processing..."; }

    deletePhoto(c.photoPath)
      .then(function () { return logUpdate(c.memberId, "denied"); })
      .then(function () {
        c.status = "denied"; c.decidedAt = new Date().toISOString(); c.duplicate = false;
        render();
        sendEmail("rejected", c.member && c.member.email, c.member && c.member.name || c.name);
      })
      .catch(function (e) { alert("Deny error.\n" + e); });
  };

  /* ---------- filters ---------- */
  overlay.addEventListener("click", function (e) {
    var b = e.target.closest(".rp-fbtn"); if (!b) return;
    if (b.id === "rp-sort") { sortNewest = !sortNewest; b.textContent = sortNewest ? "Newest first" : "Oldest first"; render(); return; }
    var f = b.getAttribute("data-f"), v = b.getAttribute("data-v");
    if (!f) return;
    if (f === "status") fStatus = v; else if (f === "type") fType = v;
    overlay.querySelectorAll(".rp-fbtn[data-f='" + f + "']").forEach(function (x) { x.classList.toggle("on", x === b); });
    render();
  });

  /* ---------- boot ---------- */
  var subs = parseRows();
  if (!subs.length) {
    document.getElementById("rp-sub").textContent = "No verify_business submissions found on this page.";
    document.getElementById("rp-list").innerHTML = "<div class='rp-load'>Open the BD Forms Inbox filtered to verify_business submissions.</div>";
    return;
  }

  document.getElementById("rp-sub").textContent = subs.length + " submission(s) - loading member data & history...";
  document.getElementById("rp-bar").style.display = "flex";

  // Build initial cards (pending until log/member data arrives)
  cards = subs.map(function (s) {
    return { inquiryId: s.inquiryId, memberId: s.memberId, name: s.name, submitted: s.submitted, profileUrl: s.profileUrl, status: "pending", duplicate: false, member: null, photoPath: "", photoUrl: "" };
  });
  render();

  // For each: record to log, read log status, fetch member data, fetch photo
  cards.forEach(function (c, i) {
    if (!c.memberId) return;
    setTimeout(function () {
      // 1) record to log (idempotent) + get current log state
      api(LOG, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "record", key: KEY, memberId: c.memberId, name: c.name, submitted: c.submitted, inquiryId: c.inquiryId })
      }).then(function (res) {
        if (res && res.entry) {
          c.status = res.entry.status || "pending";
          c.decidedAt = res.entry.decidedAt || "";
          // duplicate: already decided but submitted again
          if (res.duplicate && res.entry.status && res.entry.status !== "pending") c.duplicate = true;
        }
        // 2) member data
        return api(MEMBER + "?memberId=" + encodeURIComponent(c.memberId) + "&key=" + KEY);
      }).then(function (mem) {
        if (mem && mem.found) { c.member = mem; c.seeking = mem.seeking; }
        render();
      }).catch(function () { render(); });

      // 3) photo from inquiry detail (parallel)
      fetch("https://ww2.managemydirectory.com/admin/go.php?widget=Admin-Module-Form-Inquiries&noheader=1&external_action=previewInquiry&inquiry_id=" + c.inquiryId, { credentials: "include" })
        .then(function (r) { return r.text(); })
        .then(function (html) {
          var fm = html.match(/\/uploads\/forms\/comments\/[^"'\s]+\.(jpg|jpeg|png|gif)/i);
          if (fm) { c.photoPath = fm[0]; c.photoUrl = "https://www.renters.com" + fm[0]; render(); }
        }).catch(function () {});
    }, i * 350);
  });

  // settle message
  setTimeout(function () {
    document.getElementById("rp-sub").textContent = cards.length + " submission(s) - history loaded";
  }, subs.length * 350 + 1500);

})();
