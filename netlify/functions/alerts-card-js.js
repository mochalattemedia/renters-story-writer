// alerts-card-js.js — ac-v1
// Serves the dashboard alerts card as JavaScript. Head code carries only a loader stub.

const FN_VERSION = "ac-v1";
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
  console.log("[Renters alerts] version: " + V);

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
    card: "background:#fff;border:1px solid #e3e8ef;border-radius:14px;padding:20px;margin:16px 0;font-family:inherit;",
    h: "margin:0 0 4px;font-size:18px;font-weight:700;color:#0f2545;",
    sub: "margin:0 0 16px;font-size:14px;color:#5b6b82;line-height:1.45;",
    row: "display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;",
    lab: "display:block;font-size:13px;font-weight:600;color:#0f2545;margin:0 0 6px;",
    inp: "width:100%;padding:10px 12px;border:1px solid #d7dee8;border-radius:9px;font-size:15px;box-sizing:border-box;",
    chip: "border:1px solid #d7dee8;background:#fff;color:#33475f;border-radius:999px;padding:8px 14px;font-size:13px;cursor:pointer;",
    chipOn: "border:1px solid #0f2545;background:#0f2545;color:#fff;border-radius:999px;padding:8px 14px;font-size:13px;cursor:pointer;",
    btn: "background:#0f2545;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-size:15px;font-weight:600;cursor:pointer;",
    note: "font-size:13px;margin-top:10px;min-height:18px;"
  };

  var state = { enabled: false, wants: [], breakers: [], criteria: {} };

  function toggle(arr, k) {
    var i = arr.indexOf(k);
    if (i === -1) arr.push(k); else arr.splice(i, 1);
  }

  function chipRow(mount, arr) {
    mount.innerHTML = "";
    CHIPS.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = c[1];
      b.style.cssText = arr.indexOf(c[0]) !== -1 ? S.chipOn : S.chip;
      b.onclick = function () {
        toggle(arr, c[0]);
        chipRow(mount, arr);
      };
      mount.appendChild(b);
    });
  }

  function render(mountPoint) {
    var c = state.criteria || {};
    var wrap = document.createElement("div");
    wrap.id = "rdc-alerts";
    wrap.style.cssText = S.card;

    wrap.innerHTML =
      '<h3 style="' + S.h + '">Daily listing alerts</h3>' +
      '<p style="' + S.sub + '">Tell us what matters and we will email you when a matching home is posted. No matches, no email.</p>' +
      '<label style="' + S.lab + '"><input type="checkbox" id="ra-on"> Email me when new homes match</label>' +
      '<div id="ra-body" style="margin-top:16px;">' +
        '<div style="' + S.row + '">' +
          '<div style="flex:1;min-width:120px;"><span style="' + S.lab + '">Max rent</span>' +
            '<input id="ra-rent" type="number" inputmode="numeric" placeholder="2200" style="' + S.inp + '"></div>' +
          '<div style="flex:1;min-width:90px;"><span style="' + S.lab + '">Beds</span>' +
            '<input id="ra-beds" type="number" inputmode="numeric" placeholder="2" style="' + S.inp + '"></div>' +
          '<div style="flex:1;min-width:90px;"><span style="' + S.lab + '">Baths</span>' +
            '<input id="ra-baths" type="number" inputmode="numeric" placeholder="1" style="' + S.inp + '"></div>' +
        '</div>' +
        '<div style="margin-bottom:14px;"><span style="' + S.lab + '">Move in by</span>' +
          '<input id="ra-move" type="date" style="' + S.inp + '"></div>' +
        '<div style="margin-bottom:6px;"><span style="' + S.lab + '">Nice to have</span>' +
          '<div id="ra-wants" style="' + S.row + '"></div></div>' +
        '<div style="margin-bottom:6px;"><span style="' + S.lab + '">Deal breakers</span>' +
          '<div id="ra-breakers" style="' + S.row + '"></div></div>' +
        '<div style="margin-bottom:16px;"><span style="' + S.lab + '">Anything else that matters?</span>' +
          '<input id="ra-notes" maxlength="200" placeholder="Quiet street, close to the light rail" style="' + S.inp + '"></div>' +
        '<button id="ra-save" style="' + S.btn + '">Save my alerts</button>' +
        '<div id="ra-note" style="' + S.note + '"></div>' +
      '</div>' +
      '<p style="font-size:12px;color:#7a8ba1;margin:14px 0 0;">We search homes listed on Renters.com. Turn this off any time here or from any alert email.</p>';

    mountPoint.insertBefore(wrap, mountPoint.firstChild);

    var on = document.getElementById("ra-on");
    var body = document.getElementById("ra-body");
    on.checked = !!state.enabled;
    body.style.opacity = on.checked ? "1" : "0.45";
    on.onchange = function () { body.style.opacity = on.checked ? "1" : "0.45"; };

    if (c.rent_max) document.getElementById("ra-rent").value = c.rent_max;
    if (c.beds_min != null) document.getElementById("ra-beds").value = c.beds_min;
    if (c.baths_min != null) document.getElementById("ra-baths").value = c.baths_min;
    if (c.move_in_by) document.getElementById("ra-move").value = c.move_in_by;
    if (c.notes) document.getElementById("ra-notes").value = c.notes;

    state.wants = Array.isArray(c.wants) ? c.wants.slice() : [];
    state.breakers = Array.isArray(c.deal_breakers) ? c.deal_breakers.slice() : [];
    chipRow(document.getElementById("ra-wants"), state.wants);
    chipRow(document.getElementById("ra-breakers"), state.breakers);

    document.getElementById("ra-save").onclick = function () {
      var note = document.getElementById("ra-note");
      var btn = document.getElementById("ra-save");
      btn.disabled = true;
      note.style.color = "#5b6b82";
      note.textContent = "Saving...";

      var payload = {
        memberId: id,
        enabled: document.getElementById("ra-on").checked,
        criteria: {
          rent_max: document.getElementById("ra-rent").value,
          beds_min: document.getElementById("ra-beds").value,
          baths_min: document.getElementById("ra-baths").value,
          move_in_by: document.getElementById("ra-move").value,
          wants: state.wants,
          deal_breakers: state.breakers,
          notes: document.getElementById("ra-notes").value
        }
      };

      fetch(PREFS, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      }).then(function (r) { return r.json(); }).then(function (d) {
        btn.disabled = false;
        if (d && d.landed) {
          note.style.color = "#1a7f52";
          note.textContent = "Saved.";
        } else {
          note.style.color = "#b3261e";
          note.textContent = "We could not save that. Try once more.";
          console.error("[Renters alerts] write did not land", d);
        }
      }).catch(function (e) {
        btn.disabled = false;
        note.style.color = "#b3261e";
        note.textContent = "We could not save that. Try once more.";
        console.error("[Renters alerts] save error", e);
      });
    };
  }

  function mount() {
    var wiz = document.getElementById("rdc-wiz");
    if (wiz && wiz.parentNode) return wiz.parentNode;
    var main = document.querySelector(".page-content, .main-content, main");
    return main || null;
  }

  fetch(PREFS + "?status=1&memberId=" + id)
    .then(function (r) { return r.json(); })
    .then(function (d) {
      state.enabled = !!d.enabled;
      state.criteria = d.criteria || {};
      var tries = 0;
      var t = setInterval(function () {
        tries++;
        var m = mount();
        if (m && !document.getElementById("rdc-alerts")) { render(m); clearInterval(t); }
        if (tries > 40) clearInterval(t);
      }, 400);
    })
    .catch(function (e) {
      console.log("[Renters alerts] status read failed, standing down", e);
    });
})();
`;

exports.handler = async () => ({
  statusCode: 200,
  headers: {
    "content-type": "application/javascript; charset=utf-8",
    "cache-control": "public, max-age=300",
    "access-control-allow-origin": "*"
  },
  body: JS
});
