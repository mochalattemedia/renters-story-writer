// members-map-page.js
// Renters.com — Live Members Map (Element T) — the public page.
//
// FN_VERSION: mmp-v2
//
// Serves the whole Leaflet page as a Netlify function (same pattern as
// find-renters-page.js / listing-check-page.js). Reads the nightly snapshot Blob
// written by members-map-build.js and inlines it. No live BD read, ever.
//
// TWO MODES, ONE SURFACE (same trick frp3 uses with ?audience=)
//   /.netlify/functions/members-map-page              -> full page  (/members-map)
//   /.netlify/functions/members-map-page?compact=1    -> homepage band
//
// The payload it inlines contains no member IDs, no join dates, and no per-member
// rows. Pins with fewer than 3 members carry newCount 0, enforced in the builder.

const { getStore } = require("@netlify/blobs");

const FN_VERSION = "mmp-v2";
const BLOB_STORE = "members-map";
const KEY_SNAPSHOT = "snapshot";

const NAVY = "#0d2d4e";
const TEAL = "#3a9e8f";
const LIME = "#8dc63f";
const GOLD = "#d9a441";

function rdcStore(name) {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) return getStore({ name, siteID, token });
  return getStore(name);
}

async function loadSnapshot() {
  try {
    const raw = await rdcStore(BLOB_STORE).get(KEY_SNAPSHOT);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error("[mmp] snapshot unreadable:", e.message);
    return null;
  }
}

function page(snapshot, compact) {
  const data = snapshot || {
    v: "none",
    builtAt: null,
    totals: { members: 0, renters: 0, landlords: 0, propertyManagers: 0, realtors: 0, new7: 0, placed: 0, unplaced: 0 },
    pins: []
  };

  const payload = JSON.stringify({
    builtAt: data.builtAt,
    totals: data.totals,
    pins: data.pins || []
  }).replace(/</g, "\\u003c");

  const height = compact ? "360px" : "620px";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Renters.com — where members are</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css">
<style>
  html,body{margin:0;padding:0;font-family:"Open Sans","Helvetica Neue",Arial,sans-serif;color:${NAVY};background:#fff}
  .wrap{max-width:1200px;margin:0 auto;padding:${compact ? "0" : "18px 16px 24px"}}
  .head{text-align:center;margin:0 0 14px}
  .eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:${TEAL};font-weight:700;margin:0 0 6px}
  h1{font-size:28px;margin:0 0 6px;font-weight:700}
  .sub{font-size:15px;color:#5a6b7c;margin:0}

  .strip{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:${compact ? "0 0 8px" : "16px 0 14px"}}
  .stat{background:#f4f7fa;border:1px solid #e2e9f0;border-radius:8px;padding:${compact ? "7px 12px" : "10px 16px"};text-align:center;min-width:${compact ? "84px" : "110px"}}
  .stat b{display:block;font-size:${compact ? "17px" : "22px"};line-height:1.15;color:${NAVY}}
  .stat span{display:block;font-size:11px;color:#6b7c8d;letter-spacing:.03em;margin-top:2px}
  .stat.new b{color:${LIME === "#8dc63f" ? "#6ba32b" : LIME}}

  #map{height:${height};width:100%;border-radius:${compact ? "0" : "12px"};border:1px solid #e2e9f0;background:#eef2f5}

  .legend{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;margin:12px 0 0;font-size:13px;color:#5a6b7c}
  .legend i{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:6px;vertical-align:-1px}
  .foot{text-align:center;font-size:12px;color:#8b9aa8;margin:12px 0 0;line-height:1.55}

  .leaflet-popup-content{margin:12px 14px;font-size:14px;line-height:1.55}
  .pop-h{font-weight:700;color:${NAVY};margin:0 0 6px;font-size:15px}
  .pop-row{display:flex;justify-content:space-between;gap:18px;color:#4a5b6c}
  .pop-new{margin-top:7px;padding-top:7px;border-top:1px solid #e6ecf1;color:#6ba32b;font-weight:700}
  .rdc-tip{background:#fff;border:1px solid #dbe4ec;border-radius:8px;box-shadow:0 4px 14px rgba(13,45,78,.13);padding:9px 11px;font-size:13px;color:${NAVY}}
  .rdc-tip .t{font-weight:700;margin-bottom:4px}
  .rdc-tip .l{color:#5a6b7c}
  .rdc-tip .n{color:#6ba32b;font-weight:700;margin-top:4px}

  .rdc-cluster{background:rgba(13,45,78,.86);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;box-shadow:0 2px 8px rgba(13,45,78,.3)}
  .rdc-cluster.has-new{box-shadow:0 0 0 4px rgba(141,198,63,.55),0 2px 8px rgba(13,45,78,.3)}

  .empty{padding:40px 20px;text-align:center;color:#8b9aa8;font-size:14px}
</style>
</head>
<body>
<div class="wrap">
  ${compact ? "" : `<div class="head">
    <p class="eyebrow">Verification you can see</p>
    <h1>Where our members are</h1>
    <p class="sub">Real people, verified profiles, across the country. No names, no addresses, just activity.</p>
  </div>`}

  <div class="strip" id="strip"></div>
  <div id="map"></div>

  ${compact ? "" : `<div class="legend">
    <span><i style="background:${NAVY}"></i>Renters</span>
    <span><i style="background:${TEAL}"></i>Landlords</span>
    <span><i style="background:${LIME}"></i>Property managers</span>
    <span><i style="background:${GOLD}"></i>Realtors</span>
    <span><i style="background:#fff;box-shadow:0 0 0 3px rgba(141,198,63,.6)"></i>New this week</span>
  </div>
  <p class="foot" id="foot"></p>`}
</div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
<script>
(function(){
  var COMPACT = ${compact ? "true" : "false"};
  var VER = "${FN_VERSION}";
  var DATA = ${payload};
  console.log("[Renters members map] " + VER + " | pins: " + DATA.pins.length + " | built: " + DATA.builtAt);

  var NAVY="${NAVY}", TEAL="${TEAL}", LIME="${LIME}", GOLD="${GOLD}";

  function n(x){ return (x||0).toLocaleString(); }

  // counts strip — national aggregates. Identify nobody, and this is the growth
  // signal people actually read.
  var t = DATA.totals || {};
  var stats = [
    ["Members", t.members],
    ["Renters", t.renters],
    ["Landlords", t.landlords],
    ["Property mgrs", t.propertyManagers],
    ["Realtors", t.realtors]
  ];
  // mmp-v2: the compact band used to stop after 3 boxes (Members / Renters /
  // Landlords), which silently hid Property Managers and Realtors even though both
  // were fully counted in the snapshot and shown in pin tooltips. All five member
  // types now render in both compact and full views.
  var html = "";
  for (var i=0;i<stats.length;i++){
    html += '<div class="stat"><b>'+n(stats[i][1])+'</b><span>'+stats[i][0]+'</span></div>';
  }
  html += '<div class="stat new"><b>'+n(t.new7)+'</b><span>New this week</span></div>';
  document.getElementById("strip").innerHTML = html;

  if (!DATA.pins.length){
    document.getElementById("map").innerHTML = '<div class="empty">The map is warming up. Check back shortly.</div>';
    return;
  }

  var map = L.map("map", {
    scrollWheelZoom: !COMPACT,
    zoomControl: !COMPACT,
    attributionControl: true
  }).setView([39.5, -98.0], COMPACT ? 3 : 4);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: "abcd",
    maxZoom: 16
  }).addTo(map);

  function total(p){ return p[4]+p[5]+p[6]+p[7]; }

  function radiusFor(c){
    if (c >= 20) return 15;
    if (c >= 10) return 12;
    if (c >= 5)  return 10;
    if (c >= 3)  return 8;
    return 6;
  }

  function rows(r,l,pm,re){
    var out = "";
    if (r)  out += '<div class="pop-row"><span>Renters</span><b>'+r+'</b></div>';
    if (l)  out += '<div class="pop-row"><span>Landlords</span><b>'+l+'</b></div>';
    if (pm) out += '<div class="pop-row"><span>Property managers</span><b>'+pm+'</b></div>';
    if (re) out += '<div class="pop-row"><span>Realtors</span><b>'+re+'</b></div>';
    return out;
  }

  var cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: false,
    disableClusteringAtZoom: 10,
    maxClusterRadius: 55,
    iconCreateFunction: function(c){
      var kids = c.getAllChildMarkers();
      var m=0, nw=0;
      for (var i=0;i<kids.length;i++){
        var d = kids[i].options.rdc;
        m += d.total;
        nw += d.newCount;
      }
      var size = m >= 250 ? 56 : m >= 80 ? 48 : m >= 25 ? 42 : 36;
      var fs   = m >= 250 ? 15 : m >= 80 ? 14 : 13;
      return L.divIcon({
        html: '<div class="rdc-cluster'+(nw>0?" has-new":"")+'" style="width:'+size+'px;height:'+size+'px;font-size:'+fs+'px">'+m+'</div>',
        className: "",
        iconSize: L.point(size,size)
      });
    }
  });

  DATA.pins.forEach(function(p){
    var zip=p[0], label=p[1], lat=p[2], lon=p[3];
    var r=p[4], l=p[5], pm=p[6], re=p[7], nw=p[8];
    var tot = total(p);

    var mk = L.circleMarker([lat,lon], {
      radius: radiusFor(tot),
      color: nw>0 ? LIME : "#ffffff",
      weight: nw>0 ? 3 : 1.5,
      fillColor: NAVY,
      fillOpacity: 0.82,
      rdc: { total: tot, newCount: nw }
    });

    var head = label ? label + " &middot; " + zip : zip;
    var tip = '<div class="rdc-tip"><div class="t">'+head+'</div>'
            + '<div class="l">'+tot+' member'+(tot===1?"":"s")+'</div>'
            + (nw>0 ? '<div class="n">'+nw+' new this week</div>' : '')
            + '</div>';
    mk.bindTooltip(tip, { direction:"top", opacity:1, className:"rdc-tip-wrap", sticky:true });

    var pop = '<div class="pop-h">'+head+'</div>'
            + rows(r,l,pm,re)
            + (nw>0 ? '<div class="pop-new">'+nw+' new this week</div>' : '');
    mk.bindPopup(pop);

    cluster.addLayer(mk);
  });

  // Cluster hover: the aggregate breakdown, with real numbers in it.
  cluster.on("clustermouseover", function(e){
    var kids = e.layer.getAllChildMarkers();
    var m=0, nw=0;
    for (var i=0;i<kids.length;i++){ m += kids[i].options.rdc.total; nw += kids[i].options.rdc.newCount; }
    var tip = '<div class="rdc-tip"><div class="t">'+m+' members</div>'
            + '<div class="l">'+kids.length+' zip'+(kids.length===1?"":"s")+'</div>'
            + (nw>0 ? '<div class="n">'+nw+' new this week</div>' : '')
            + '</div>';
    e.layer.bindTooltip(tip, { direction:"top", opacity:1, sticky:true }).openTooltip();
  });

  map.addLayer(cluster);

  try {
    map.fitBounds(cluster.getBounds().pad(0.12), { maxZoom: COMPACT ? 4 : 5 });
  } catch(err){}

  var foot = document.getElementById("foot");
  if (foot){
    var when = DATA.builtAt ? new Date(DATA.builtAt).toLocaleDateString(undefined,{month:"short",day:"numeric"}) : "";
    foot.innerHTML = "One pin per zip code. No names, no addresses, no profile links."
      + (when ? "<br>Updated " + when + "." : "");
  }
})();
</script>
</body>
</html>`;
}

exports.handler = async (event) => {
  const q = (event && event.queryStringParameters) || {};

  if (q.version) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ _v: FN_VERSION })
    };
  }

  const snapshot = await loadSnapshot();
  const compact = q.compact === "1" || q.compact === "true";

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // snapshot is nightly, so a 30-minute edge cache costs nothing and the page
      // stops hitting Blobs on every view
      "Cache-Control": "public, max-age=1800",
      "X-Frame-Options": "ALLOWALL"
    },
    body: page(snapshot, compact)
  };
};
