/* ============================================================
   Renters.com Verification Panel  ·  v5 (CRM)
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

   v5: A re-submission after a prior decision now stays PENDING
       (so Approve/Deny show again) and surfaces the prior result
       as history ("RESUBMITTED - previously denied on <date>").
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
    + ".rp-card{border:1px solid #e8eceb;border-radius:11px;padding:14px;margin-bottom:11px;display:grid;grid-template-columns:200px 1fr 230px 150px;gap:14px;align-items:start;}"
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
    + ".rp-del{background:#fff;color:#c0392b;border:1px solid #f5c6cb;font-size:11px;}"
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
