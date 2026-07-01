/* ============================================================
   Renters.com Identity Confirmation Center  ·  v9 (CRM)
   v5: resubmission stays PENDING + shows prior result as history.
   v6: delete now includes newsite=38748 so BD actually deletes.
   v7: "Expired ID" action (sends type:"expired" email).
   v8: renamed heading; removed filter/sort bar (low volume).
   v9: SUBMISSION HISTORY + DECISION INTEGRITY.
       - Reads the new verify-log history array: shows a real
         timeline (submitted+denied on X, then approved on Y) and
         only flags a GENUINE resubmission (new inquiryId after a
         prior decided one) - kills the false "RESUBMITTED".
       - Shows the Inquiry ID on every card.
       - Deny opens a REASON panel: 5 checkboxes + a free-text note
         (stored in the log, no ID image retained - the reason is
         how we compare a later resubmission, securely).
       - Deny now ALSO un-verifies in BD (sets verified=0) so a
         post-approval deny truly removes the blue check.
       - Decided cards show status + a deliberate "Change decision"
         link instead of raw re-clickable Approve/Deny buttons.
       - Approve/Deny/Expired all delete the ID image immediately.
   ============================================================ */
(function () {
  var FN_BASE = "https://renters-story-writer.netlify.app/.netlify/functions";
  var LOG = FN_BASE + "/verify-log";
  var MEMBER = FN_BASE + "/verify-member";
  var EMAIL = FN_BASE + "/send-verification-email";
  var KEY = "renters2026";
  var NEWSITE = "38748";

  // Denial reasons (checkboxes). Label is what shows in history.
  var REASONS = [
    "No ID submitted",
    "ID unreadable / not an ID",
    "Expired ID",
    "No profile photo to match",
    "Photo does not match ID"
  ];

  if (document.getElementById("rp-overlay")) document.getElementById("rp-overlay").remove();
  if (document.getElementById("rp-style")) document.getElementById("rp-style").remove();

  var css = ""
    + "#rp-overlay{position:fixed;inset:0;background:rgba(8,20,35,.7);z-index:99999;display:flex;align-items:flex-start;justify-content:center;padding:18px;overflow-y:auto;font-family:Arial,Helvetica,sans-serif;}"
    + "#rp-panel{background:#fff;border-radius:14px;width:100%;max-width:1180px;color:#0d2d4e;padding:22px;margin:auto;position:relative;box-shadow:0 20px 60px rgba(0,0,0,.3);}"
    + "#rp-close{position:absolute;top:14px;right:16px;background:none;border:none;font-size:22px;cursor:pointer;color:#4a5a6a;}"
    + "#rp-h{font-size:20px;font-weight:700;margin:0 0 2px;}"
    + "#rp-sub{font-size:13px;color:#4a5a6a;margin:0 0 16px;}"
    + ".rp-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;}"
    + ".rp-spacer{flex:1;}"
    + "#rp-count{font-size:12px;color:#4a5a6a;}"
    + ".rp-card{border:1px solid #e8eceb;border-radius:11px;padding:14px;margin-bottom:11px;display:grid;grid-template-columns:200px 1fr 230px 165px;gap:14px;align-items:start;}"
    + ".rp-card.dup{border-left:4px solid #e67e22;}"
    + ".rp-card.pending{border-left:4px solid #f1c40f;}"
    + ".rp-card.approved{border-left:4px solid #27ae60;}"
    + ".rp-card.denied{border-left:4px solid #c0392b;}"
    + ".rp-photos{display:flex;gap:8px;}"
    + ".rp-pcol{display:flex;flex-direction:column;align-items:center;gap:3px;}"
    + ".rp-photo{width:92px;height:120px;border-radius:8px;object-fit:cover;border:1px solid #e8eceb;display:block;cursor:zoom-in;transition:transform .1s;}"
    + ".rp-photo:hover{transform:scale(1.03);border-color:#3a9e8f;}"
    + ".rp-plabel{font-size:10px;font-weight:700;color:#566573;text-transform:uppercase;letter-spacing:.3px;}"
    + ".rp-photo-x{width:92px;height:120px;border-radius:8px;border:2px dashed #f1c40f;display:flex;align-items:center;justify-content:center;font-size:10px;color:#9a7d0a;text-align:center;background:#fefcf3;padding:6px;box-sizing:border-box;line-height:1.4;}"
    + "#rp-zoom{position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:100000;display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:30px;}"
    + "#rp-zoom img{max-width:95%;max-height:95%;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.5);}"
    + "#rp-zoom .rp-zclose{position:absolute;top:18px;right:24px;color:#fff;font-size:34px;cursor:pointer;font-weight:300;}"
    + ".rp-name{font-size:15px;font-weight:700;margin:0 0 4px;}"
    + ".rp-row{font-size:12px;color:#4a5a6a;margin:0 0 2px;line-height:1.5;}"
    + ".rp-iq{font-size:11px;color:#8a97a3;font-weight:700;}"
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
    + ".rp-hist{margin-top:7px;border-top:1px dashed #e3e8e7;padding-top:6px;}"
    + ".rp-hline{font-size:11px;color:#4a5a6a;margin:2px 0;line-height:1.5;}"
    + ".rp-hline .hi{font-weight:700;}"
    + ".rp-hline.h-approved .hi{color:#1e8449;}"
    + ".rp-hline.h-denied .hi{color:#c0392b;}"
    + ".rp-hline.h-pending .hi{color:#b9770e;}"
    + ".rp-hline .hr{color:#7d6608;}"
    + ".rp-acts{display:flex;flex-direction:column;gap:7px;}"
    + ".rp-btn{padding:8px 10px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;border:none;width:100%;text-align:center;text-decoration:none;display:block;box-sizing:border-box;}"
    + ".rp-ap{background:#3a9e8f;color:#fff;}"
    + ".rp-dn{background:#c0392b;color:#fff;}"
    + ".rp-ex{background:#e67e22;color:#fff;}"
    + ".rp-vw{background:#f4f7f6;color:#0d2d4e;border:1px solid #e8eceb;font-size:11px;}"
    + ".rp-del{background:#fff;color:#c0392b;border:1px solid #f5c6cb;font-size:11px;}"
    + ".rp-change{background:none;color:#3a9e8f;border:none;font-size:11px;font-weight:700;text-decoration:underline;cursor:pointer;padding:2px;}"
    + ".rp-btn:disabled{opacity:.5;cursor:not-allowed;}"
    + ".rp-stat{font-size:12px;font-weight:700;padding:6px;border-radius:6px;text-align:center;}"
    + ".s-approved{background:#d4efdf;color:#1e8449;}"
    + ".s-denied{background:#fadbd8;color:#922b21;}"
    + ".rp-stat small{display:block;font-weight:400;font-size:10px;margin-top:2px;}"
    + ".rp-dupflag{font-size:10px;font-weight:700;color:#b9770e;background:#fef5e7;border-radius:4px;padding:2px 6px;display:inline-block;margin-bottom:4px;}"
    + ".rp-load{text-align:center;padding:40px;color:#4a5a6a;font-size:14px;}"
    + ".rp-vbadge{font-size:11px;font-weight:700;color:#1e8449;}"
    // deny-reason modal
    + "#rp-deny{position:fixed;inset:0;background:rgba(8,20,35,.6);z-index:100001;display:flex;align-items:center;justify-content:center;padding:20px;}"
    + "#rp-deny .box{background:#fff;border-radius:12px;max-width:440px;width:100%;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.35);}"
    + "#rp-deny h3{margin:0 0 4px;font-size:17px;color:#0d2d4e;}"
    + "#rp-deny .who{font-size:12px;color:#4a5a6a;margin:0 0 14px;}"
    + "#rp-deny label{display:flex;align-items:flex-start;gap:8px;font-size:13px;color:#0d2d4e;padding:7px 0;cursor:pointer;line-height:1.4;}"
    + "#rp-deny label input{margin-top:2px;}"
    + "#rp-deny textarea{width:100%;box-sizing:border-box;margin-top:8px;border:1px solid #e3e8e7;border-radius:8px;padding:9px;font-size:13px;font-family:inherit;resize:vertical;min-height:56px;}"
    + "#rp-deny .drow{display:flex;gap:9px;margin-top:16px;}"
    + "#rp-deny .drow button{flex:1;padding:10px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;border:none;}"
    + "#rp-deny .dcancel{background:#f4f7f6;color:#0d2d4e;border:1px solid #e8eceb;}"
    + "#rp-deny .dconfirm{background:#c0392b;color:#fff;}"
    + "#rp-deny .note{font-size:11px;color:#8a97a3;margin-top:10px;line-height:1.5;}";

  var st = document.createElement("style");
  st.id = "rp-style"; st.textContent = css;
  document.head.appendChild(st);

  var overlay = document.createElement("div");
  overlay.id = "rp-overlay";
  overlay.innerHTML = ""
    + "<div id='rp-panel'>"
    + "<button id='rp-close'>&#10005;</button>"
    + "<p id='rp-h'>Identity Confirmation Center</p>"
    + "<p id='rp-sub'>Parsing submissions&hellip;</p>"
    + "<div class='rp-bar' id='rp-bar' style='display:none;'>"
    + "<span class='rp-spacer'></span>"
    + "<span id='rp-count'></span>"
    + "</div>"
    + "<div id='rp-list'><div class='rp-load'>Loading&hellip;</div></div>"
    + "</div>";
  document.body.appendChild(overlay);

  document.getElementById("rp-close").onclick = function () {
    overlay.remove(); st.remove();
  };

  var cards = [];

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

  function visible() {
    return cards.slice().sort(function (a, b) {
      var x = new Date(a.submitted || 0).getTime(), y = new Date(b.submitted || 0).getTime();
      return y - x;
    });
  }

  // Build the history timeline lines for a card (excludes the current
  // pending submission; shows prior decided submissions).
  function historyHTML(c) {
    if (!c.history || c.history.length < 1) return "";
    var lines = [];
    c.history.forEach(function (h) {
      // Skip the current submission row if it is the pending one we are acting on.
      if (String(h.inquiryId) === String(c.inquiryId) && h.status === "pending" && c.status === "pending") return;
      var cls = h.status === "approved" ? "h-approved" : (h.status === "denied" ? "h-denied" : "h-pending");
      var when = h.decidedAt ? fmtDate(h.decidedAt) : (h.submitted ? fmtDate(h.submitted) : "");
      var verb = h.status === "approved" ? "Approved" : (h.status === "denied" ? "Denied" : "Submitted");
      var reasons = (h.reasons && h.reasons.length) ? " &mdash; <span class='hr'>" + esc(h.reasons.join(", ")) + "</span>" : "";
      var note = h.note ? " <span class='hr'>(" + esc(h.note) + ")</span>" : "";
      var iq = h.inquiryId ? " <span class='rp-iq'>#" + esc(h.inquiryId) + "</span>" : "";
      lines.push("<div class='rp-hline " + cls + "'><span class='hi'>" + verb + "</span>" + (when ? " on " + when : "") + iq + reasons + note + "</div>");
    });
    if (!lines.length) return "";
    return "<div class='rp-hist'>" + lines.join("") + "</div>";
  }

  function render() {
    var list = document.getElementById("rp-list");
    var vis = visible();
    document.getElementById("rp-count").textContent = vis.length + " submission(s)";
    if (!vis.length) { list.innerHTML = "<div class='rp-load'>No submissions.</div>"; return; }
    list.innerHTML = vis.map(function (c) {
      var m = c.member || {};
      var vp = c.photoUrl || (m.verifyPhotoUrl || "");
      var sp = m.profilePhoto || "";
      function photoBox(url, label) {
        if (!url) return "<div class='rp-photo-x'>" + label + "<br>none</div>";
        return "<div class='rp-pcol'>"
          + "<img class='rp-photo' src='" + esc(url) + "' onclick=\"rpZoom('" + esc(url).replace(/'/g, "%27") + "')\" onerror=\"this.outerHTML='<div class=rp-photo-x>" + label + "<br>gone</div>'\">"
          + "<span class='rp-plabel'>" + label + "</span></div>";
      }
      var photo = "<div class='rp-photos'>" + photoBox(vp, "ID") + photoBox(sp, "Profile") + "</div>";

      var typeBadge = "<span class='rp-badge " + badgeClass(m.accountType) + "'>" + esc(m.accountType || "?") + "</span>";
      var vbadge = m.verified ? "<span class='rp-vbadge'>&#10003; confirmed</span>" : "";

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
      ctx += historyHTML(c);

      var dupFlag = c.resubmission ? "<span class='rp-dupflag'>RESUBMISSION &middot; see history below</span>" : "";

      var acts;
      if (c.status === "pending") {
        acts = "<button class='rp-btn rp-ap' id='ap-" + c.inquiryId + "' onclick=\"rpApprove('" + c.inquiryId + "')\">&#10003; Approve</button>"
          + "<button class='rp-btn rp-dn' id='dn-" + c.inquiryId + "' onclick=\"rpDeny('" + c.inquiryId + "')\">&#10005; Deny</button>"
          + "<button class='rp-btn rp-ex' id='ex-" + c.inquiryId + "' onclick=\"rpExpired('" + c.inquiryId + "')\">&#9203; Expired ID</button>"
          + (c.profileUrl ? "<a class='rp-btn rp-vw' href='" + c.profileUrl + "' target='_blank'>BD Profile</a>" : "")
          + "<button class='rp-btn rp-del' onclick=\"rpDelete('" + c.inquiryId + "')\">&#128465; Delete</button>";
      } else {
        var sc = c.status === "approved" ? "s-approved" : "s-denied";
        var lbl = c.status === "approved" ? "&#10003; Approved" : "&#10005; Denied";
        acts = "<div class='rp-stat " + sc + "'>" + lbl + (c.decidedAt ? "<small>" + fmtDate(c.decidedAt) + "</small>" : "") + "</div>"
          + "<button class='rp-change' onclick=\"rpChange('" + c.inquiryId + "')\">Change decision</button>"
          + (c.profileUrl ? "<a class='rp-btn rp-vw' href='" + c.profileUrl + "' target='_blank' style='margin-top:2px;'>BD Profile</a>" : "")
          + "<button class='rp-btn rp-del' onclick=\"rpDelete('" + c.inquiryId + "')\">&#128465; Delete</button>";
      }

      return "<div class='rp-card " + c.status + (c.resubmission ? " dup" : "") + "' id='card-" + c.inquiryId + "'>"
        + "<div>" + photo + "</div>"
        + "<div>" + dupFlag + "<p class='rp-name'>" + esc(m.name || c.name) + " " + vbadge + "</p>"
        + "<p class='rp-row'>" + typeBadge + "Member #" + esc(c.memberId) + "</p>"
        + "<p class='rp-row rp-iq'>Inquiry #" + esc(c.inquiryId) + "</p>"
        + (m.email ? "<p class='rp-row'>&#9993; " + esc(m.email) + "</p>" : "")
        + (m.phone ? "<p class='rp-row'>&#9742; " + esc(m.phone) + "</p>" : "")
        + (m.location ? "<p class='rp-row'>&#128205; " + esc(m.location) + "</p>" : "")
        + "<p class='rp-row'>&#128197; submitted " + esc(c.submitted) + "</p></div>"
        + "<div class='rp-ctx'>" + ctx + "</div>"
        + "<div class='rp-acts'>" + acts + "</div>"
        + "</div>";
    }).join("");
  }

  window.rpZoom = function (url) {
    var u = decodeURIComponent(url);
    var z = document.createElement("div");
    z.id = "rp-zoom";
    z.innerHTML = "<span class='rp-zclose'>&#10005;</span><img src='" + u + "'>";
    z.onclick = function () { z.remove(); };
    document.body.appendChild(z);
  };

  window.rpDelete = function (id) {
    var c = cards.find(function (x) { return x.inquiryId === id; });
    if (!c) return;
    if (!confirm("Delete this submission?\n\n" + (c.member && c.member.name || c.name) + " (Inquiry #" + c.inquiryId + ")\n\nRemoves it from your Forms Inbox (same as BD delete). Does NOT change their confirmation status or account.")) return;
    var card = document.getElementById("card-" + id);
    if (card) card.style.opacity = "0.5";
    var url = "https://ww2.managemydirectory.com/admin/go.php?widget=Admin-Module-Form-Inquiries&apitype=json&noheader=1&newsite=" + NEWSITE + "&external_action=inquiryAction&inquiry_action=mark_delete&inquiry_id=" + encodeURIComponent(c.inquiryId);
    fetch(url, { credentials: "include" })
      .then(function () {
        cards = cards.filter(function (x) { return x.inquiryId !== id; });
        render();
      })
      .catch(function (e) {
        if (card) card.style.opacity = "1";
        alert("Delete error. Try in BD admin.\n" + e);
      });
  };

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
  function logUpdate(memberId, inquiryId, status, reasons, note) {
    return api(LOG, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", key: KEY, memberId: memberId, inquiryId: inquiryId, status: status, reasons: reasons || [], note: note || "", decidedBy: "admin" })
    }).catch(function () {});
  }

  // Set BD verified flag (1 = confirmed, 0 = not). Used by approve and by deny/reset.
  function setBDVerified(memberId, value) {
    var fd = new URLSearchParams();
    fd.append("faction", "bulkmemberactions");
    fd.append("newsite", NEWSITE);
    fd.append("total_records", "1");
    fd.append("bulk_action_type", "selected_rows");
    fd.append("selected_rows", memberId);
    fd.append("bulk_action", "update-verified-status");
    fd.append("new_value", value);
    fd.append("apply_subaccounts", "");
    return fetch("https://ww2.managemydirectory.com/admin/viewMembers.php", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: fd.toString()
    });
  }

  function disableActions(id) {
    ["ap-", "dn-", "ex-"].forEach(function (p) { var el = document.getElementById(p + id); if (el) el.disabled = true; });
  }

  window.rpApprove = function (id) {
    var c = cards.find(function (x) { return x.inquiryId === id; });
    if (!c) return;
    if (!confirm("Approve " + (c.member && c.member.name || c.name) + " (Member #" + c.memberId + ")?\nConfirms their account (blue check) and deletes the ID image.")) return;
    disableActions(id);
    var ap = document.getElementById("ap-" + id); if (ap) ap.textContent = "Processing...";
    setBDVerified(c.memberId, "1")
      .then(function () { return deletePhoto(c.photoPath); })
      .then(function () { return logUpdate(c.memberId, c.inquiryId, "approved", [], ""); })
      .then(function (res) {
        c.status = "approved"; c.decidedAt = new Date().toISOString(); c.resubmission = false;
        if (res && res.history) c.history = res.history;
        render();
        sendEmail("approved", c.member && c.member.email, c.member && c.member.name || c.name);
      })
      .catch(function (e) { alert("Approve error. Try in BD admin.\n" + e); });
  };

  // Deny opens the reason modal; confirmation happens there.
  window.rpDeny = function (id) {
    var c = cards.find(function (x) { return x.inquiryId === id; });
    if (!c) return;
    openDenyModal(c, "deny");
  };

  // Expired = a one-click deny with the single "Expired ID" reason + expired email.
  window.rpExpired = function (id) {
    var c = cards.find(function (x) { return x.inquiryId === id; });
    if (!c) return;
    if (!confirm("Mark " + (c.member && c.member.name || c.name) + "'s ID as EXPIRED?\n\nUse only when everything else looks good and the ONLY issue is an expired ID. Sends the encouraging \"just need a current ID\" email, logs the reason, and deletes the image.")) return;
    disableActions(id);
    var ex = document.getElementById("ex-" + id); if (ex) ex.textContent = "Processing...";
    finalizeDeny(c, ["Expired ID"], "", "expired");
  };

  window.rpChange = function (id) {
    var c = cards.find(function (x) { return x.inquiryId === id; });
    if (!c) return;
    if (!confirm("Change the decision for " + (c.member && c.member.name || c.name) + "?\n\nThis reopens the submission so you can approve or deny it again. If they were confirmed, denying will remove their blue check.")) return;
    c.status = "pending";
    render();
  };

  function openDenyModal(c, mode) {
    var wrap = document.createElement("div");
    wrap.id = "rp-deny";
    var boxes = REASONS.map(function (r, i) {
      return "<label><input type='checkbox' value='" + esc(r) + "' id='rr-" + i + "'> " + esc(r) + "</label>";
    }).join("");
    wrap.innerHTML = "<div class='box'>"
      + "<h3>Deny &mdash; reason</h3>"
      + "<p class='who'>" + esc(c.member && c.member.name || c.name) + " &middot; Member #" + esc(c.memberId) + " &middot; Inquiry #" + esc(c.inquiryId) + "</p>"
      + boxes
      + "<textarea id='rr-note' placeholder='Optional note (e.g. submitted a utility bill, license expired 2021)'></textarea>"
      + "<p class='note'>The reason is stored so a later resubmission can be compared. The ID image is deleted &mdash; no sensitive image is retained.</p>"
      + "<div class='drow'><button class='dcancel' id='rr-cancel'>Cancel</button><button class='dconfirm' id='rr-confirm'>Deny &amp; send email</button></div>"
      + "</div>";
    document.body.appendChild(wrap);
    document.getElementById("rr-cancel").onclick = function () { wrap.remove(); };
    wrap.addEventListener("click", function (e) { if (e.target === wrap) wrap.remove(); });
    document.getElementById("rr-confirm").onclick = function () {
      var chosen = [];
      REASONS.forEach(function (r, i) { var cb = document.getElementById("rr-" + i); if (cb && cb.checked) chosen.push(r); });
      var note = (document.getElementById("rr-note").value || "").trim();
      if (!chosen.length && !note) { alert("Pick at least one reason or add a note."); return; }
      wrap.remove();
      disableActions(c.inquiryId);
      var dn = document.getElementById("dn-" + c.inquiryId); if (dn) dn.textContent = "Processing...";
      // If the ONLY reason is Expired ID, send the expired email; else the catch-all.
      var emailType = (chosen.length === 1 && chosen[0] === "Expired ID") ? "expired" : "rejected";
      finalizeDeny(c, chosen, note, emailType);
    };
  }

  // Shared deny finalizer: un-verify in BD, delete image, log w/ reasons, email.
  function finalizeDeny(c, reasons, note, emailType) {
    setBDVerified(c.memberId, "0")
      .then(function () { return deletePhoto(c.photoPath); })
      .then(function () { return logUpdate(c.memberId, c.inquiryId, "denied", reasons, note); })
      .then(function (res) {
        c.status = "denied"; c.decidedAt = new Date().toISOString(); c.resubmission = false;
        if (res && res.history) c.history = res.history;
        render();
        sendEmail(emailType, c.member && c.member.email, c.member && c.member.name || c.name);
      })
      .catch(function (e) { alert("Deny error.\n" + e); });
  }

  var subs = parseRows();
  if (!subs.length) {
    document.getElementById("rp-sub").textContent = "No verify_business submissions found on this page.";
    document.getElementById("rp-list").innerHTML = "<div class='rp-load'>Open the BD Forms Inbox filtered to verify_business submissions.</div>";
    return;
  }

  document.getElementById("rp-sub").textContent = subs.length + " submission(s) - loading member data & history...";
  document.getElementById("rp-bar").style.display = "flex";

  cards = subs.map(function (s) {
    return { inquiryId: s.inquiryId, memberId: s.memberId, name: s.name, submitted: s.submitted, profileUrl: s.profileUrl, status: "pending", resubmission: false, history: [], member: null, photoPath: "", photoUrl: "" };
  });
  render();

  cards.forEach(function (c, i) {
    if (!c.memberId) return;
    setTimeout(function () {
      api(LOG, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "record", key: KEY, memberId: c.memberId, name: c.name, submitted: c.submitted, inquiryId: c.inquiryId })
      }).then(function (res) {
        if (res) {
          if (res.history) c.history = res.history;
          if (res.current && res.current.status) {
            c.status = res.current.status;
            c.decidedAt = res.current.decidedAt || "";
          }
          c.resubmission = !!res.resubmission;
        }
        return api(MEMBER + "?memberId=" + encodeURIComponent(c.memberId) + "&key=" + KEY);
      }).then(function (mem) {
        if (mem && mem.found) { c.member = mem; c.seeking = mem.seeking; }
        render();
      }).catch(function () { render(); });

      fetch("https://ww2.managemydirectory.com/admin/go.php?widget=Admin-Module-Form-Inquiries&noheader=1&external_action=previewInquiry&inquiry_id=" + c.inquiryId, { credentials: "include" })
        .then(function (r) { return r.text(); })
        .then(function (html) {
          var fm = html.match(/\/uploads\/forms\/comments\/[^"'\s]+\.(jpg|jpeg|png|gif)/i);
          if (fm) { c.photoPath = fm[0]; c.photoUrl = "https://www.renters.com" + fm[0]; render(); }
        }).catch(function () {});
    }, i * 350);
  });

  setTimeout(function () {
    document.getElementById("rp-sub").textContent = cards.length + " submission(s) - history loaded";
  }, subs.length * 350 + 1500);

})();
