// didit-review.js — serves the Didit Identity Review panel as executable JS.
// Bookmarklet loads it:
//   javascript:(function(){var s=document.createElement('script');s.src='https://renters-story-writer.netlify.app/.netlify/functions/didit-review?t='+Date.now();document.body.appendChild(s);})();
// Run on any BD admin page (needs your logged-in admin session for the grant).

const PANEL = `
(function () {
  var FN_BASE = "https://renters-story-writer.netlify.app/.netlify/functions";
  var LOG = FN_BASE + "/verify-log";
  var MEMBER = FN_BASE + "/verify-member";
  var KEY = "renters2026";
  var NEWSITE = "38748";

  if (document.getElementById("dr-overlay")) document.getElementById("dr-overlay").remove();
  if (document.getElementById("dr-style")) document.getElementById("dr-style").remove();

  var css = ""
    + "#dr-overlay{position:fixed;inset:0;background:rgba(8,20,35,.7);z-index:99999;display:flex;align-items:flex-start;justify-content:center;padding:18px;overflow-y:auto;font-family:Arial,Helvetica,sans-serif;}"
    + "#dr-panel{background:#fff;border-radius:14px;width:100%;max-width:1080px;color:#0d2d4e;padding:22px;margin:auto;position:relative;box-shadow:0 20px 60px rgba(0,0,0,.3);}"
    + "#dr-close{position:absolute;top:14px;right:16px;background:none;border:none;font-size:22px;cursor:pointer;color:#4a5a6a;}"
    + "#dr-h{font-size:20px;font-weight:700;margin:0 0 2px;}"
    + "#dr-sub{font-size:13px;color:#4a5a6a;margin:0 0 14px;}"
    + ".dr-tabs{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;}"
    + ".dr-tab{padding:7px 13px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;border:1px solid #e8eceb;background:#f4f7f6;color:#4a5a6a;}"
    + ".dr-tab.on{background:#0d2d4e;color:#fff;border-color:#0d2d4e;}"
    + ".dr-card{border:1px solid #e8eceb;border-radius:11px;padding:14px;margin-bottom:11px;display:grid;grid-template-columns:1fr 200px;gap:14px;align-items:center;}"
    + ".dr-card.confirmed{border-left:4px solid #27ae60;}"
    + ".dr-card.denied{border-left:4px solid #c0392b;}"
    + ".dr-card.pending{border-left:4px solid #f1c40f;}"
    + ".dr-card.granted{border-left:4px solid #2c3e50;opacity:.75;}"
    + ".dr-name{font-size:15px;font-weight:700;margin:0 0 4px;}"
    + ".dr-row{font-size:12px;color:#4a5a6a;margin:0 0 2px;line-height:1.5;}"
    + ".dr-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;margin-right:5px;}"
    + ".b-conf{background:#d4efdf;color:#1e8449;}"
    + ".b-den{background:#fadbd8;color:#922b21;}"
    + ".b-pend{background:#fef5e7;color:#b9770e;}"
    + ".b-grant{background:#d6eaf8;color:#1a5276;}"
    + ".dr-acts{display:flex;flex-direction:column;gap:7px;}"
    + ".dr-btn{padding:9px 10px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;border:none;width:100%;text-align:center;text-decoration:none;display:block;box-sizing:border-box;}"
    + ".dr-grant{background:#3a9e8f;color:#fff;}"
    + ".dr-unverify{background:#fff;color:#c0392b;border:1px solid #f5c6cb;}"
    + ".dr-vw{background:#f4f7f6;color:#0d2d4e;border:1px solid #e8eceb;font-size:11px;}"
    + ".dr-btn:disabled{opacity:.5;cursor:not-allowed;}"
    + ".dr-stat{font-size:12px;font-weight:700;padding:7px;border-radius:6px;text-align:center;}"
    + ".s-granted{background:#eaf2f8;color:#1a5276;}"
    + ".dr-load{text-align:center;padding:40px;color:#4a5a6a;font-size:14px;}"
    + ".dr-vchk{font-size:11px;font-weight:700;color:#1e8449;}";

  var st = document.createElement("style");
  st.id = "dr-style"; st.textContent = css;
  document.head.appendChild(st);

  var overlay = document.createElement("div");
  overlay.id = "dr-overlay";
  overlay.innerHTML = ""
    + "<div id='dr-panel'>"
    + "<button id='dr-close'>&#10005;</button>"
    + "<p id='dr-h'>Didit Identity Review</p>"
    + "<p id='dr-sub'>Loading verifications&hellip;</p>"
    + "<div class='dr-tabs' id='dr-tabs' style='display:none;'>"
    + "<div class='dr-tab on' data-f='confirmed'>Ready to grant</div>"
    + "<div class='dr-tab' data-f='granted'>Granted</div>"
    + "<div class='dr-tab' data-f='denied'>Declined</div>"
    + "<div class='dr-tab' data-f='all'>All</div>"
    + "</div>"
    + "<div id='dr-list'><div class='dr-load'>Loading&hellip;</div></div>"
    + "</div>";
  document.body.appendChild(overlay);

  document.getElementById("dr-close").onclick = function () { overlay.remove(); st.remove(); };

  var rows = [];
  var filter = "confirmed";

  function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fmtDate(d) { if (!d) return ""; try { return new Date(d).toLocaleString(); } catch (e) { return d; } }
  function api(url, opts) { return fetch(url, opts).then(function (r) { return r.json(); }); }

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

  function matchesFilter(r) {
    if (filter === "all") return true;
    if (filter === "confirmed") return r.status === "identity-confirmed" && !r.bdVerified;
    if (filter === "granted") return !!r.bdVerified;
    if (filter === "denied") return r.status === "denied";
    return true;
  }

  function render() {
    var list = document.getElementById("dr-list");
    var vis = rows.filter(matchesFilter).sort(function (a, b) {
      return new Date(b.decidedAt || b.submitted || 0) - new Date(a.decidedAt || a.submitted || 0);
    });
    document.getElementById("dr-sub").textContent = rows.length + " Didit verification(s) across " + uniqueMembers() + " member(s)";
    if (!vis.length) { list.innerHTML = "<div class='dr-load'>Nothing in this view.</div>"; return; }

    list.innerHTML = vis.map(function (r) {
      var cls = r.bdVerified ? "granted" : (r.status === "identity-confirmed" ? "confirmed" : (r.status === "denied" ? "denied" : "pending"));
      var badge = r.bdVerified
        ? "<span class='dr-badge b-grant'>&#10003; Verified in BD</span>"
        : (r.status === "identity-confirmed" ? "<span class='dr-badge b-conf'>Didit confirmed</span>"
          : (r.status === "denied" ? "<span class='dr-badge b-den'>Didit declined</span>"
            : "<span class='dr-badge b-pend'>Pending</span>"));

      var m = r.member || {};
      var contact = "";
      if (m.email) contact += "<p class='dr-row'>&#9993; " + esc(m.email) + "</p>";
      if (m.location) contact += "<p class='dr-row'>&#128205; " + esc(m.location) + "</p>";
      if (m.accountType) contact += "<p class='dr-row'>" + esc(m.accountType) + "</p>";

      var acts;
      if (r.bdVerified) {
        acts = "<div class='dr-stat s-granted'>&#10003; Verified in BD</div>"
          + "<button class='dr-btn dr-unverify' onclick=\"drUnverify('" + r.memberId + "','" + r.inquiryId + "')\">Remove badge</button>";
      } else if (r.status === "identity-confirmed") {
        acts = "<button class='dr-btn dr-grant' id='g-" + r.memberId + "' onclick=\"drGrant('" + r.memberId + "','" + r.inquiryId + "')\">&#10003; Grant verified badge</button>";
      } else if (r.status === "denied") {
        acts = "<div class='dr-stat' style='background:#fadbd8;color:#922b21;'>Declined by Didit</div>";
      } else {
        acts = "<div class='dr-stat' style='background:#fef5e7;color:#b9770e;'>Awaiting Didit result</div>";
      }
      acts += "<a class='dr-btn dr-vw' href='https://ww2.managemydirectory.com/admin/viewMembers.php?newsite=" + NEWSITE + "' target='_blank'>BD Admin</a>";

      return "<div class='dr-card " + cls + "'>"
        + "<div><p class='dr-name'>" + esc(m.name || r.name || ("Member #" + r.memberId)) + " " + (m.verified ? "<span class='dr-vchk'>&#10003; currently verified</span>" : "") + "</p>"
        + "<p class='dr-row'>" + badge + "Member #" + esc(r.memberId) + "</p>"
        + contact
        + "<p class='dr-row'>Didit session " + esc(String(r.inquiryId).slice(0, 12)) + "&hellip; &middot; " + fmtDate(r.decidedAt || r.submitted) + "</p>"
        + (r.note ? "<p class='dr-row' style='color:#8a97a3;'>" + esc(r.note) + "</p>" : "")
        + "</div>"
        + "<div class='dr-acts'>" + acts + "</div>"
        + "</div>";
    }).join("");
  }

  function uniqueMembers() {
    var s = {};
    rows.forEach(function (r) { s[r.memberId] = 1; });
    return Object.keys(s).length;
  }

  window.drGrant = function (memberId, inquiryId) {
    var r = rows.find(function (x) { return x.memberId === memberId && x.inquiryId === inquiryId; });
    if (!r) return;
    if (!confirm("Grant the verified badge to " + (r.member && r.member.name || r.name || ("Member #" + memberId)) + "?")) return;
    var btn = document.getElementById("g-" + memberId);
    if (btn) { btn.disabled = true; btn.textContent = "Granting..."; }
    setBDVerified(memberId, "1")
      .then(function () {
        return api(LOG, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "update", key: KEY, memberId: memberId, inquiryId: inquiryId, status: "approved", note: "Badge granted from Didit review", decidedBy: "admin" })
        }).catch(function () {});
      })
      .then(function () { r.bdVerified = true; r.status = "approved"; if (r.member) r.member.verified = true; render(); })
      .catch(function (e) { alert("Grant error. Make sure you are logged into BD admin.\n" + e); if (btn) { btn.disabled = false; btn.textContent = "Grant verified badge"; } });
  };

  window.drUnverify = function (memberId, inquiryId) {
    var r = rows.find(function (x) { return x.memberId === memberId && x.inquiryId === inquiryId; });
    if (!r) return;
    if (!confirm("Remove the verified badge from Member #" + memberId + "?")) return;
    setBDVerified(memberId, "0")
      .then(function () {
        return api(LOG, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "update", key: KEY, memberId: memberId, inquiryId: inquiryId, status: "denied", reasons: ["Badge removed"], note: "Badge removed from Didit review", decidedBy: "admin" })
        }).catch(function () {});
      })
      .then(function () { r.bdVerified = false; r.status = "denied"; if (r.member) r.member.verified = false; render(); })
      .catch(function (e) { alert("Remove error.\n" + e); });
  };

  document.getElementById("dr-tabs").addEventListener("click", function (e) {
    var t = e.target.closest(".dr-tab");
    if (!t) return;
    filter = t.getAttribute("data-f");
    Array.prototype.forEach.call(document.querySelectorAll(".dr-tab"), function (x) { x.classList.remove("on"); });
    t.classList.add("on");
    render();
  });

  api(LOG, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "list", key: KEY })
  }).then(function (res) {
    var entries = (res && res.entries) || [];
    entries.forEach(function (mem) {
      var hist = mem.history || [];
      hist.forEach(function (h) {
        if (h.decidedBy !== "didit" && !(h.note && h.note.indexOf("Didit") > -1)) return;
        rows.push({
          memberId: String(mem.memberId),
          inquiryId: String(h.inquiryId || ""),
          name: mem.name || "",
          status: h.status || "pending",
          note: h.note || "",
          submitted: h.submitted || mem.firstLogged || "",
          decidedAt: h.decidedAt || "",
          bdVerified: false,
          member: null
        });
      });
    });

    document.getElementById("dr-tabs").style.display = "flex";
    if (!rows.length) {
      document.getElementById("dr-sub").textContent = "No Didit verifications logged yet.";
      document.getElementById("dr-list").innerHTML = "<div class='dr-load'>Once renters complete Didit, their results appear here.</div>";
      return;
    }
    render();

    var seen = {};
    rows.forEach(function (r) {
      if (seen[r.memberId]) return; seen[r.memberId] = 1;
      api(MEMBER + "?memberId=" + encodeURIComponent(r.memberId) + "&key=" + KEY)
        .then(function (mem) {
          if (mem && mem.found) {
            rows.forEach(function (x) {
              if (x.memberId === r.memberId) { x.member = mem; x.bdVerified = !!mem.verified; }
            });
            render();
          }
        }).catch(function () {});
    });
  }).catch(function (e) {
    document.getElementById("dr-sub").textContent = "Could not load verify-log.";
    document.getElementById("dr-list").innerHTML = "<div class='dr-load'>Error: " + esc(e.message) + "</div>";
  });
})();
`;

exports.handler = async () => {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    },
    body: PANEL
  };
};
