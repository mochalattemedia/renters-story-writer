// ==================================================================
// alerts-card-js.js  —  ac-v10
// Serves the "Daily listing alerts" dashboard card as JavaScript.
// Head code (w99) carries only a 6-line loader; BD never stores this.
//
// Backend: alerts-prefs.js ap-v4. SHIP THEM TOGETHER. ac-v4 speaks the
// { searches: [...] } shape; ap-v3 speaks a single criteria object.
// Mixing versions loses the renter's saved search silently.
//
// ac-v10 CHANGE: STOP THE BLINK. One-word bug in ac-v9's keepOrder().
// It compared card.previousSibling to the zip card. previousSibling
// returns the WHITESPACE TEXT NODE sitting between the two elements, not
// the zip card, so the "am I in the right place?" test failed on every
// single tick and the card was torn out and re-inserted 2.5 times a
// second. Correct order, visible flicker, and both cards appeared to
// fight for the same slot.
//
// previousElementSibling skips text nodes and is what was meant.
// Also added a move cap: if the card somehow needs re-homing more than
// 20 times, something else is fighting us and we stop rather than
// flicker forever. And the enforcer now runs at 700ms, off-phase from
// zip3's 400ms placer, so the two are not interleaving on every tick.
//
// ac-v9 CHANGE: ENFORCE ORDER CONTINUOUSLY, NOT ONCE.
// ac-v8 picked its anchor at mount time and only re-homed when it
// happened to notice the anchor had changed. That held until head code
// w101 removed the Ezoic tags: five fewer script tags at the top of the
// file meant everything below executed a beat earlier, this card won the
// race against the zip gate's async status fetch, and the zip box ended
// up BELOW the alerts card.
//
// The fix is the pattern zip3 already uses: it does not place itself
// once, it re-asserts every 400ms because both wizards mount async.
// This card now does the same. keepOrder() runs on an interval and, if
// #rdc-zip exists and this card is not directly after it, moves the card
// back. Cheap, and immune to whatever order things happen to load in.
//
// Deliberately does NOT re-render, only re-parents, so a half-filled
// form is never yanked out from under someone mid-edit.
//
// ac-v8 CHANGE: SHOW BOTH, ZIP FIRST.
// ac-v7 hid this card completely while the zip gate was up. Correct on
// ordering, too blunt on visibility: a member can perfectly well read
// what alerts are while they are typing a zip, and hiding the card meant
// the dashboard visibly changed shape under them a second later.
//
// Now the card ALWAYS renders, but it mounts in priority order:
//   after #rdc-zip  (zip gate)   -> zip box stays on top
//   else after #rdc-wiz (wizard)
//   else appended to main
// One thing kept from ac-v7: the card re-homes itself if the zip gate
// appears or disappears after boot, so saving a zip does not leave the
// two in the wrong order until a reload.
//
// ac-v7 CHANGE: STOP FIGHTING THE ZIP GATE FOR THE TOP SLOT.
// The zip gate (head code zip3, element #rdc-zip) mounts with
// insertBefore(..., parent.firstChild). So did this card. Both grabbed
// the same slot and whichever rendered last sat on top, so a member
// without a zip saw the zip gate flash and then get buried under the
// alerts card. Reported as "the listing search overwrote zip capture" —
// nothing was overwritten, they were racing for firstChild.
//
// TWO FIXES:
//   1. If #rdc-zip is on the page, this card DOES NOT RENDER AT ALL and
//      keeps watching. The zip gate is a blocking gate: a member with no
//      zip cannot be matched to anything anyway, so an alerts card above
//      it is noise at best and a distraction from the one thing we need
//      from them at worst. When the gate goes away (zip saved), the card
//      appears on its own.
//   2. This card no longer takes firstChild. It mounts AFTER #rdc-wiz.
//      Nothing else on the dashboard has to move for it.
//
// ac-v6 CHANGE: SEARCH AREAS SHOWN, AND GATED.
// The card never asks for location: it reuses the zones the renter drew
// in Search Areas. But it never SHOWED them either, so a renter had no
// way to know where their alert was looking, and a renter with no zones
// had an alert that would silently match nationwide.
//
// HOW AREAS ARE READ, and why it is not the obvious way: head code za6
// reads areas by scraping `table tr` rows containing "Postal Code" off
// the /account/locations page. That table does not exist on
// /account/home, which is why za6 logs "0 area(s)" on the dashboard for
// EVERY member regardless of what they have saved. That number is not
// evidence of anything. So this card fetches /account/locations
// same-origin (the session cookie rides along) and parses the same rows.
//
// FAILS OPEN: if the fetch or the parse fails we show no gate and no
// zone line, and the card behaves exactly as ac-v5. An unreadable areas
// page must never block a renter from saving criteria.
//
// ac-v5 CHANGE: footer copy only. The old line carried two claims that
// could go stale: "we add new homes every week" (a volume promise that
// is not reliably true at current inventory) and "homes on Renters.com"
// (a scope lock that breaks the moment landlord-submitted external links
// ship). Both removed. No logic touched.
//
// ac-v4 CHANGE: MULTIPLE SAVED SEARCHES.
//   - Landing view is a LIST of saved searches, each showing what it
//     matches, when it was created, and whether it is running.
//   - Add another search (cap 5), edit any, delete any, pause any one
//     without turning the rest off.
//   - The complaint that started this: every visit looked like the
//     first. Now a returning renter sees their searches and the dates
//     they made them.
//
// STILL QUEUED (needs a matching ap change, do not ship alone):
//   Deal breaker chips reuse the positive vocabulary. "Parking" as a
//   deal breaker reads backwards. New keys need whitelisting in
//   sanitizeCriteria first or they are stripped on save.
// ==================================================================

const FN_VERSION = "ac-v10";
const PREFS = "https://renters-story-writer.netlify.app/.netlify/functions/alerts-prefs";

const CHIPS = [
  ["move_in_special", "Move-in special"],
  ["pets_dog", "Dog friendly"],
  ["pets_cat", "Cat friendly"],
  ["large_dog_ok", "Large dog ok"],
  ["washer_dryer_in_unit", "W/D in unit"],
  ["parking", "Parking"],
  ["yard", "Yard"],
  ["ground_floor", "Ground floor"],
  ["no_stairs", "No stairs"],
  ["furnished", "Furnished"],
  ["utilities_included", "Utilities included"]
];

const JS = `
(function () {
  var V = "${FN_VERSION}";
  var PREFS = "${PREFS}";
  var CHIPS = ${JSON.stringify(CHIPS)};
  var MAX = 5;
  console.log("[Renters alerts] version: " + V);

  var LABEL = {};
  CHIPS.forEach(function (c) { LABEL[c[0]] = c[1]; });

  function memberId() {
    var el = document.querySelector("input[name=logged_user]");
    if (el && el.value) return String(el.value).replace(/[^0-9]/g, "");
    var m = document.querySelector(".member-account-id");
    if (m && m.textContent) return String(m.textContent).replace(/[^0-9]/g, "");
    var c = document.cookie || "";
    var i = c.indexOf("userid=");
    if (i !== -1) return c.slice(i + 7).split(";")[0].replace(/[^0-9]/g, "");
    return "";
  }

  var id = memberId();
  if (!id) { console.log("[Renters alerts] no member id, standing down"); return; }

  var S = {
    card: "background:#fff;border:1px solid #e3e8ef;border-radius:14px;padding:20px 20px 76px;margin:16px 0;font-family:inherit;",
    h: "margin:0 0 4px;font-size:18px;font-weight:700;color:#0f2545;",
    sub: "margin:0 0 16px;font-size:14px;color:#5b6b82;line-height:1.45;",
    row: "display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;",
    lab: "display:block;font-size:13px;font-weight:600;color:#0f2545;margin:0 0 6px;",
    inp: "width:100%;padding:10px 12px;border:1px solid #d7dee8;border-radius:9px;font-size:15px;box-sizing:border-box;",
    chip: "border:1px solid #d7dee8;background:#fff;color:#33475f;border-radius:999px;padding:8px 14px;font-size:13px;cursor:pointer;",
    chipOn: "border:1px solid #0f2545;background:#0f2545;color:#fff;border-radius:999px;padding:8px 14px;font-size:13px;cursor:pointer;",
    chipNo: "border:1px solid #eceff3;background:#fff;color:#c0c8d2;border-radius:999px;padding:8px 14px;font-size:13px;cursor:not-allowed;",
    btn: "background:#0f2545;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-size:15px;font-weight:600;cursor:pointer;",
    ghost: "background:#fff;color:#0f2545;border:1px solid #d7dee8;border-radius:10px;padding:9px 16px;font-size:14px;font-weight:600;cursor:pointer;",
    link: "background:none;border:0;color:#5b6b82;font-size:13px;cursor:pointer;padding:6px 8px;text-decoration:underline;",
    note: "font-size:13px;margin-top:10px;min-height:18px;",
    pillOn: "display:inline-block;background:#e7f4ed;color:#1a7f52;border-radius:999px;padding:3px 10px;font-size:11px;font-weight:700;",
    pillOff: "display:inline-block;background:#eef1f5;color:#5b6b82;border-radius:999px;padding:3px 10px;font-size:11px;font-weight:700;",
    item: "border:1px solid #e3e8ef;border-radius:11px;padding:14px 16px;margin:0 0 10px;background:#fff;",
    itemOff: "border:1px solid #eceff3;border-radius:11px;padding:14px 16px;margin:0 0 10px;background:#fafbfc;",
    itemName: "font-size:15px;font-weight:700;color:#0f2545;margin:0;display:inline-block;",
    itemLine: "font-size:14px;color:#33475f;margin:6px 0 2px;",
    itemMuted: "font-size:12px;color:#7a8ba1;margin:0;",
    acts: "margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;"
  };

  // searches: [{id,name,created,updated,enabled,criteria}]
  var state = { searches: [], enabled: false, view: "list", editIdx: -1, draft: null, savedAt: null, busy: false, areas: null, areasRead: false, anchor: "" };

  function money(n) {
    return "$" + String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
  }

  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function summaryText(c) {
    var bits = [];
    if (c.rent_max) bits.push("Up to " + money(c.rent_max));
    if (c.beds_min !== null && c.beds_min !== undefined) bits.push(c.beds_min + "+ beds");
    if (c.baths_min !== null && c.baths_min !== undefined) bits.push(c.baths_min + "+ baths");
    if (c.move_in_by) bits.push("by " + fmtDate(c.move_in_by));
    return bits.join("  ·  ");
  }

  function chipNames(keys) {
    return (keys || []).map(function (k) { return LABEL[k] || k; }).join(", ");
  }

  function emptyCriteria() {
    return { rent_max: null, beds_min: null, baths_min: null, move_in_by: null, wants: [], deal_breakers: [], notes: "" };
  }

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ------------------------------------------------------------------
  function chipRow(mount, arr, other) {
    mount.innerHTML = "";
    CHIPS.forEach(function (c) {
      var on = arr.indexOf(c[0]) !== -1;
      var blocked = !on && other.indexOf(c[0]) !== -1;
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = c[1];
      b.title = blocked ? "Already chosen in the other list" : "";
      b.style.cssText = on ? S.chipOn : (blocked ? S.chipNo : S.chip);
      if (!blocked) {
        b.onclick = function () {
          var i = arr.indexOf(c[0]);
          if (i === -1) arr.push(c[0]); else arr.splice(i, 1);
          redrawChips();
        };
      }
      mount.appendChild(b);
    });
  }

  function redrawChips() {
    var w = document.getElementById("ra-wants");
    var d = document.getElementById("ra-breakers");
    if (w) chipRow(w, state.draft.criteria.wants, state.draft.criteria.deal_breakers);
    if (d) chipRow(d, state.draft.criteria.deal_breakers, state.draft.criteria.wants);
  }

  // ------------------------------------------------------------------
  // AREAS. Fetch the locations page and parse the same rows za6 parses.
  // Returns { zips: [], labels: [] } or null when it cannot be read.
  // ------------------------------------------------------------------
  function firstZip(txt) {
    var s = String(txt || ""), run = "", i, ch;
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      if (ch >= "0" && ch <= "9") {
        run += ch;
        if (run.length === 5) {
          var nxt = s.charAt(i + 1);
          if (!(nxt >= "0" && nxt <= "9")) return run;
        }
      } else {
        run = "";
      }
    }
    return "";
  }

  function parseAreas(html) {
    var doc;
    try {
      doc = new DOMParser().parseFromString(html, "text/html");
    } catch (e) {
      return null;
    }
    var rows = doc.querySelectorAll("table tr");
    var seen = {}, zips = [], labels = [], seenLabel = {};
    for (var i = 0; i < rows.length; i++) {
      var txt = rows[i].textContent || "";
      if (txt.indexOf("Postal Code") === -1) continue;
      var z = firstZip(txt);
      if (z && !seen[z]) { seen[z] = 1; zips.push(z); }

      // za6 writes the renter's own zone wording into BD's address field,
      // e.g. "Alberta Arts, Portland, OR 97211". Take the part before the
      // first comma as the human label.
      var cells = rows[i].querySelectorAll("td");
      for (var j = 0; j < cells.length; j++) {
        var ct = (cells[j].textContent || "").trim();
        if (ct.indexOf(",") !== -1 && firstZip(ct)) {
          var lab = ct.split(",")[0].trim();
          if (lab && lab.length < 40 && !seenLabel[lab] && !firstZip(lab)) {
            seenLabel[lab] = 1;
            labels.push(lab);
          }
          break;
        }
      }
    }
    return { zips: zips, labels: labels };
  }

  function loadAreas() {
    return fetch("/account/locations", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (html) {
        if (!html) return null;
        return parseAreas(html);
      })
      .catch(function (e) {
        console.log("[Renters alerts] areas read failed, gate suppressed", e);
        return null;
      });
  }

  function areaLine() {
    if (!state.areas) return "";
    if (state.areas.labels && state.areas.labels.length) {
      return state.areas.labels.slice(0, 6).join("  ·  ") +
        (state.areas.labels.length > 6 ? "  and " + (state.areas.labels.length - 6) + " more" : "");
    }
    if (state.areas.zips && state.areas.zips.length) {
      return state.areas.zips.slice(0, 8).join(", ") +
        (state.areas.zips.length > 8 ? " and " + (state.areas.zips.length - 8) + " more" : "");
    }
    return "";
  }

  // Gate only when we SUCCESSFULLY read the page and found nothing.
  // A failed read leaves areas null and shows no gate.
  function noAreas() {
    return state.areasRead && state.areas && state.areas.zips.length === 0;
  }

  // ------------------------------------------------------------------
  function render(mp) {
    removeCard();

    var wrap = document.createElement("div");
    wrap.id = "rdc-alerts";
    wrap.style.cssText = S.card;

    if (state.view === "form") renderForm(wrap, mp);
    else renderList(wrap, mp);

    // Mount after whichever anchor mount() picked. firstChild is never
    // ours: that slot belongs to the zip gate.
    state.anchor = mp.anchor;
    if (mp.before && mp.before.parentNode === mp.parent) {
      mp.parent.insertBefore(wrap, mp.before);
    } else {
      mp.parent.appendChild(wrap);
    }
    if (state.view === "form") wireForm(mp);
    else wireList(mp);
  }

  // ---------------- LIST ----------------
  function renderList(wrap, mp) {
    var n = state.searches.length;
    var html =
      '<h3 style="' + S.h + '">Daily listing alerts</h3>' +
      '<p style="' + S.sub + '">We email you when a newly posted home matches. No matches, no email.</p>';

    if (noAreas()) {
      html +=
        '<div style="background:#fff8e8;border:1px solid #f0e0bd;border-radius:11px;padding:14px 16px;margin:0 0 14px;">' +
          '<p style="font-size:14px;color:#7a5c14;margin:0 0 8px;font-weight:600;">Add your search areas first</p>' +
          '<p style="font-size:13px;color:#7a5c14;margin:0 0 10px;line-height:1.5;">Alerts match on the neighbourhoods you pick, so we need at least one before we can send you anything. You can still save what you are looking for below.</p>' +
          '<a href="/account/locations" style="' + S.ghost + 'display:inline-block;text-decoration:none;">Choose my areas</a>' +
        '</div>';
    }

    if (!n) {
      html +=
        '<p style="' + S.itemLine + '">You have not set up an alert yet.</p>' +
        '<div style="margin-top:14px;"><button id="ra-new" style="' + S.btn + '">Create my first alert</button></div>';
    } else {
      html += '<div id="ra-list">';
      state.searches.forEach(function (s, i) {
        var c = s.criteria || {};
        var wantsTxt = chipNames(c.wants);
        var breakTxt = chipNames(c.deal_breakers);
        html +=
          '<div style="' + (s.enabled ? S.item : S.itemOff) + '">' +
            '<p style="margin:0 0 2px;"><span style="' + S.itemName + '">' + esc(s.name) + '</span> ' +
              '<span style="' + (s.enabled ? S.pillOn : S.pillOff) + '">' + (s.enabled ? "Running" : "Paused") + '</span></p>' +
            (summaryText(c) ? '<p style="' + S.itemLine + '">' + esc(summaryText(c)) + '</p>' : "") +
            (areaLine() ? '<p style="' + S.itemMuted + '">Areas: ' + esc(areaLine()) + '</p>' : "") +
            (wantsTxt ? '<p style="' + S.itemMuted + '">Nice to have: ' + esc(wantsTxt) + '</p>' : "") +
            (breakTxt ? '<p style="' + S.itemMuted + '">Deal breakers: ' + esc(breakTxt) + '</p>' : "") +
            (c.notes ? '<p style="' + S.itemMuted + '">Notes: ' + esc(c.notes) + '</p>' : "") +
            '<p style="' + S.itemMuted + 'margin-top:6px;">Created ' + esc(fmtDate(s.created)) +
              (s.updated && s.updated.slice(0, 10) !== (s.created || "").slice(0, 10)
                ? '  ·  updated ' + esc(fmtDate(s.updated)) : "") + '</p>' +
            '<div style="' + S.acts + '">' +
              '<button data-act="edit" data-i="' + i + '" style="' + S.ghost + '">Edit</button>' +
              '<button data-act="toggle" data-i="' + i + '" style="' + S.ghost + '">' + (s.enabled ? "Pause" : "Resume") + '</button>' +
              '<button data-act="del" data-i="' + i + '" style="' + S.link + '">Delete</button>' +
            '</div>' +
          '</div>';
      });
      html += '</div>';

      html += '<div style="margin-top:6px;">';
      if (n < MAX) {
        html += '<button id="ra-new" style="' + S.btn + '">Add another alert</button>';
      } else {
        html += '<p style="' + S.itemMuted + '">You have reached the limit of ' + MAX + ' saved alerts. Delete one to add another.</p>';
      }
      html += '</div>';
    }

    html +=
      '<div id="ra-note" style="' + S.note + '"></div>' +
      '<p style="font-size:12px;color:#7a8ba1;margin:14px 0 0;">Tell us what you want and you will hear the moment it lands. Turn alerts off any time, here or from any email.</p>';

    wrap.innerHTML = html;
  }

  function wireList(mp) {
    var nb = document.getElementById("ra-new");
    if (nb) {
      nb.onclick = function () {
        state.draft = { id: "", name: "", created: "", enabled: true, criteria: emptyCriteria() };
        state.editIdx = -1;
        state.view = "form";
        render(mp);
      };
    }

    var list = document.getElementById("ra-list");
    if (!list) { showSaved(); return; }

    var btns = list.querySelectorAll("button[data-act]");
    for (var k = 0; k < btns.length; k++) {
      btns[k].onclick = function () {
        var act = this.getAttribute("data-act");
        var i = Number(this.getAttribute("data-i"));
        var s = state.searches[i];
        if (!s) return;

        if (act === "edit") {
          state.draft = {
            id: s.id, name: s.name, created: s.created, enabled: s.enabled,
            criteria: JSON.parse(JSON.stringify(s.criteria || emptyCriteria()))
          };
          state.editIdx = i;
          state.view = "form";
          render(mp);
          return;
        }

        if (act === "toggle") {
          s.enabled = !s.enabled;
          persist(mp, "Updated.");
          return;
        }

        if (act === "del") {
          if (!window.confirm("Delete the alert \\"" + s.name + "\\"?")) return;
          deleteSearch(mp, s.id);
        }
      };
    }
    showSaved();
  }

  function showSaved() {
    var note = document.getElementById("ra-note");
    if (note && state.savedAt) {
      note.style.color = "#1a7f52";
      note.textContent = "Saved " + state.savedAt + ". We have this on file.";
    }
  }

  // ---------------- FORM ----------------
  function renderForm(wrap, mp) {
    var d = state.draft;
    var c = d.criteria;
    var isNew = state.editIdx === -1;

    wrap.innerHTML =
      '<h3 style="' + S.h + '">' + (isNew ? "New alert" : "Edit alert") + '</h3>' +
      '<p style="' + S.sub + '">Hard limits narrow the search. The chips and the note below are read against each listing description, so things buried in the text still match.</p>' +
      (areaLine()
        ? '<p style="' + S.itemMuted + 'margin:-8px 0 14px;">Searching in: ' + esc(areaLine()) + '  ·  <a href="/account/locations" style="color:#5b6b82;">change</a></p>'
        : "") +
      '<div style="margin-bottom:14px;"><span style="' + S.lab + '">Name this alert</span>' +
        '<input id="ra-name" maxlength="40" placeholder="2BR near the light rail" value="' + esc(d.name) + '" style="' + S.inp + '"></div>' +
      '<div style="' + S.row + '">' +
        '<div style="flex:1;min-width:120px;"><span style="' + S.lab + '">Max rent</span>' +
          '<input id="ra-rent" type="number" inputmode="numeric" placeholder="2200" value="' + esc(c.rent_max) + '" style="' + S.inp + '"></div>' +
        '<div style="flex:1;min-width:90px;"><span style="' + S.lab + '">Beds</span>' +
          '<input id="ra-beds" type="number" inputmode="numeric" placeholder="2" value="' + esc(c.beds_min) + '" style="' + S.inp + '"></div>' +
        '<div style="flex:1;min-width:90px;"><span style="' + S.lab + '">Baths</span>' +
          '<input id="ra-baths" type="number" inputmode="numeric" placeholder="1" value="' + esc(c.baths_min) + '" style="' + S.inp + '"></div>' +
      '</div>' +
      '<div style="margin-bottom:14px;"><span style="' + S.lab + '">Move in by</span>' +
        '<input id="ra-move" type="date" value="' + esc(c.move_in_by) + '" style="' + S.inp + '"></div>' +
      '<div style="margin-bottom:6px;"><span style="' + S.lab + '">Nice to have</span>' +
        '<div id="ra-wants" style="' + S.row + '"></div></div>' +
      '<div style="margin-bottom:6px;"><span style="' + S.lab + '">Deal breakers</span>' +
        '<div id="ra-breakers" style="' + S.row + '"></div></div>' +
      '<div style="margin-bottom:16px;"><span style="' + S.lab + '">Anything else that matters?</span>' +
        '<input id="ra-notes" maxlength="200" placeholder="Quiet street, close to the light rail" value="' + esc(c.notes) + '" style="' + S.inp + '"></div>' +
      '<button id="ra-save" style="' + S.btn + '">' + (isNew ? "Save this alert" : "Save changes") + '</button> ' +
      '<button id="ra-cancel" style="' + S.ghost + '">Cancel</button>' +
      '<div id="ra-note" style="' + S.note + '"></div>';
  }

  function wireForm(mp) {
    redrawChips();

    document.getElementById("ra-cancel").onclick = function () {
      state.view = "list";
      state.draft = null;
      state.editIdx = -1;
      render(mp);
    };

    document.getElementById("ra-save").onclick = function () {
      var c = state.draft.criteria;
      c.rent_max = document.getElementById("ra-rent").value;
      c.beds_min = document.getElementById("ra-beds").value;
      c.baths_min = document.getElementById("ra-baths").value;
      c.move_in_by = document.getElementById("ra-move").value;
      c.notes = document.getElementById("ra-notes").value;
      state.draft.name = document.getElementById("ra-name").value;

      var empty = !c.rent_max && !c.beds_min && !c.baths_min && !c.move_in_by &&
                  !c.notes && !c.wants.length && !c.deal_breakers.length;
      if (empty) {
        var note = document.getElementById("ra-note");
        note.style.color = "#b3261e";
        note.textContent = "Add at least one thing to match on.";
        return;
      }

      var rec = {
        id: state.draft.id || "",
        name: state.draft.name,
        created: state.draft.created || "",
        enabled: state.draft.enabled !== false,
        criteria: c
      };

      if (state.editIdx === -1) state.searches.push(rec);
      else state.searches[state.editIdx] = rec;

      state.view = "list";
      state.draft = null;
      state.editIdx = -1;
      persist(mp, "Saved.");
    };
  }

  // ------------------------------------------------------------------
  function stamp() {
    var now = new Date();
    return now.toLocaleDateString() + " at " +
      now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function persist(mp, okMsg) {
    if (state.busy) return;
    state.busy = true;

    fetch(PREFS, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberId: id, searches: state.searches })
    }).then(function (r) { return r.json(); }).then(function (d) {
      state.busy = false;
      if (d && d.landed) {
        // Trust the server's sanitised copy, not the form. What comes back
        // is what is actually stored.
        state.searches = d.searches || [];
        state.enabled = !!d.enabled;
        state.savedAt = stamp();
        render(mp);
      } else {
        fail(d, okMsg);
      }
    }).catch(function (e) {
      state.busy = false;
      fail(e, okMsg);
    });
  }

  function deleteSearch(mp, searchId) {
    if (state.busy) return;
    state.busy = true;

    fetch(PREFS, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberId: id, action: "delete", searchId: searchId })
    }).then(function (r) { return r.json(); }).then(function (d) {
      state.busy = false;
      if (d && d.landed) {
        state.searches = d.searches || [];
        state.enabled = !!d.enabled;
        state.savedAt = stamp();
        render(mp);
      } else {
        fail(d, "delete");
      }
    }).catch(function (e) {
      state.busy = false;
      fail(e, "delete");
    });
  }

  function fail(d, ctx) {
    var note = document.getElementById("ra-note");
    if (note) {
      note.style.color = "#b3261e";
      note.textContent = "We could not save that. Try once more.";
    }
    console.error("[Renters alerts] write did not land (" + ctx + ")", d);
  }

  // ------------------------------------------------------------------
  // Returns { parent, before } so we can mount AFTER the wizard rather
  // than seizing firstChild, which is the zip gate's slot.
  // Priority order. The zip gate outranks everything: a member with no
  // zip cannot be matched to anything, so that box stays on top.
  function mount() {
    var zip = document.getElementById("rdc-zip");
    if (zip && zip.parentNode) return { parent: zip.parentNode, before: zip.nextSibling, anchor: "zip" };

    var wiz = document.getElementById("rdc-wiz");
    if (wiz && wiz.parentNode) return { parent: wiz.parentNode, before: wiz.nextSibling, anchor: "wiz" };

    var main = document.querySelector(".page-content, .main-content, main");
    if (main) return { parent: main, before: null, anchor: "main" };
    return null;
  }

  // The zip gate blocks the dashboard until a zip is saved.
  function zipGateUp() {
    return !!document.getElementById("rdc-zip");
  }

  // ---- ORDER ENFORCER ----------------------------------------------
  // Runs on an interval, same muscle as zip3's place(). If the zip gate
  // is on the page, this card belongs directly after it. Re-parents only;
  // never re-renders, so typing is never interrupted.
  var moves = 0;
  var MAX_MOVES = 20;

  function keepOrder() {
    if (moves > MAX_MOVES) return;

    var card = document.getElementById("rdc-alerts");
    if (!card) return;

    var zip = document.getElementById("rdc-zip");
    if (zip && zip.parentNode) {
      // previousElementSibling, NOT previousSibling: the latter returns the
      // whitespace text node between the two cards and never matches, which
      // is exactly what made ac-v9 re-insert on every tick and blink.
      var inPlace = card.parentNode === zip.parentNode &&
                    card.previousElementSibling === zip;
      if (!inPlace) {
        zip.parentNode.insertBefore(card, zip.nextSibling);
        moves++;
        if (state.anchor !== "zip") {
          console.log("[Renters alerts] re-homed below the zip gate");
          state.anchor = "zip";
        }
      }
      return;
    }

    // No zip gate. Sit after the wizard if there is one, but only if we
    // are currently ABOVE it. Anything lower is left alone.
    var wiz = document.getElementById("rdc-wiz");
    if (!wiz || !wiz.parentNode) return;
    if (card.previousElementSibling === wiz) return;

    var p = card.compareDocumentPosition(wiz);
    if (p & Node.DOCUMENT_POSITION_FOLLOWING) {
      wiz.parentNode.insertBefore(card, wiz.nextSibling);
      moves++;
      state.anchor = "wiz";
    }
  }

  function removeCard() {
    var el = document.getElementById("rdc-alerts");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  loadAreas().then(function (a) {
    state.areas = a;
    state.areasRead = a !== null;
    if (a) console.log("[Renters alerts] areas", { zips: a.zips.length, labels: a.labels });
    boot();
  });

  function boot() {
  fetch(PREFS + "?status=1&memberId=" + id)
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || d.error) {
        console.log("[Renters alerts] status error, standing down", d);
        return;
      }
      state.searches = Array.isArray(d.searches) ? d.searches : [];
      state.enabled = !!d.enabled;
      if (typeof d.maxSearches === "number") MAX = d.maxSearches;
      console.log("[Renters alerts] loaded", {
        searches: state.searches.length,
        enabled: state.enabled,
        migrated: !!d.migratedFromLegacy
      });
      var tries = 0;
      var t = setInterval(function () {
        tries++;
        var m = mount();
        if (!m) { if (tries > 300) clearInterval(t); return; }

        var here = document.getElementById("rdc-alerts");

        // Not mounted yet.
        if (!here) { render(m); return; }

        // Mounted. Keep it in the right place regardless of what loaded
        // when. Re-parents only, so an in-progress edit survives.
        keepOrder();

        if (tries > 300) clearInterval(t);
      }, 700);
    })
    .catch(function (e) {
      console.log("[Renters alerts] status read failed, standing down", e);
    });
  }
})();
`;

exports.handler = async () => ({
  statusCode: 200,
  headers: {
    "content-type": "application/javascript; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*"
  },
  body: JS
});
