// netlify/functions/my-showings-page.js
// The dashboard tool: a member's showings with an adjoining live map.
// Iframed into the BD dashboard; head code sets ?memberId=<logged_user>.
exports.handler = async () => ({
  statusCode: 200,
  headers: { 'Content-Type': 'text/html; charset=utf-8' },
  body: PAGE
});

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>My showings</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Red+Hat+Display:wght@600;700;800&family=Open+Sans:wght@400;600;700&display=swap" rel="stylesheet" />
<style>
  :root{--navy:#0d2d4e;--teal:#3a9e8f;--lime:#8dc63f;--amber:#e0a41b;--blue:#1d9bf0;--muted:#5b7189;--line:rgba(13,45,78,.12)}
  *{box-sizing:border-box}
  body{margin:0;font-family:"Open Sans",system-ui,sans-serif;color:var(--navy);background:#fff}
  .head{display:flex;align-items:center;gap:12px;padding:16px 18px 12px}
  .head h1{font-family:"Red Hat Display";font-weight:800;font-size:19px;margin:0;letter-spacing:-.3px}
  .live{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  .live .p{width:8px;height:8px;border-radius:50%;background:#4ade80;animation:pulse 1.6s infinite}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(74,222,128,.6)}70%{box-shadow:0 0 0 7px rgba(74,222,128,0)}100%{box-shadow:0 0 0 0 rgba(74,222,128,0)}}
  .grid{display:grid;grid-template-columns:1.1fr 1fr;gap:0;min-height:520px}
  #map{min-height:520px;background:#e8edf1;border-right:1px solid var(--line)}
  .panel{display:flex;flex-direction:column;min-height:0}
  .tabs{display:flex;gap:4px;padding:10px 14px;border-bottom:1px solid var(--line)}
  .tab{border:0;background:none;font:inherit;font-weight:700;font-size:13px;color:var(--muted);padding:8px 12px;border-radius:8px;cursor:pointer}
  .tab.on{background:rgba(58,158,143,.12);color:#1f6b5e}
  .list{padding:8px 12px 16px;overflow:auto}
  .card{border:1px solid var(--line);border-radius:12px;padding:12px 13px;margin:9px 0;transition:.15s;cursor:pointer}
  .card:hover{border-color:rgba(13,45,78,.28);box-shadow:0 4px 14px rgba(13,45,78,.07)}
  .card.sel{border-color:var(--teal);box-shadow:0 0 0 2px rgba(58,158,143,.18)}
  .rowtop{display:flex;align-items:center;gap:7px;margin-bottom:2px}
  .who{font-weight:700;font-size:14.5px}
  .check{width:15px;height:15px;flex:0 0 auto}
  .addr{font-size:12.5px;color:var(--muted);margin-bottom:9px}
  .when{float:right;font-size:12px;color:var(--muted);font-weight:600}
  .role{font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
  .pill{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;padding:4px 9px;border-radius:20px}
  .pill .pd{width:7px;height:7px;border-radius:50%}
  .s-proposed{background:rgba(224,164,27,.13);color:#9a6f04}.s-proposed .pd{background:var(--amber)}
  .s-confirmed{background:rgba(58,158,143,.14);color:#1f6b5e}.s-confirmed .pd{background:var(--teal)}
  .s-completed{background:rgba(141,198,63,.18);color:#4d7c12}.s-completed .pd{background:var(--lime)}
  .s-cancelled{background:#eef1f4;color:#5b7189}.s-cancelled .pd{background:#9fb0c0}
  .act{display:flex;gap:7px;margin-top:11px}
  .btn{flex:1;border:0;border-radius:9px;padding:9px;font:inherit;font-weight:700;font-size:12.5px;cursor:pointer}
  .btn-go{background:var(--teal);color:#fff}.btn-done{background:var(--lime);color:#123}.btn-ghost{background:#eef1f4;color:var(--navy)}
  .doneflag{display:flex;align-items:center;gap:8px;background:rgba(141,198,63,.16);color:#4d7c12;font-weight:700;font-size:12.5px;padding:9px 11px;border-radius:9px;margin-top:11px}
  .empty{color:var(--muted);font-size:13.5px;text-align:center;padding:40px 20px;line-height:1.6}
  .mk{display:flex;align-items:center;justify-content:center;position:relative}
  .mk .ring{width:20px;height:20px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)}
  .mk .chk{position:absolute;color:#fff;font-size:11px;font-weight:900}
  .legend{position:absolute;left:10px;bottom:10px;background:#fff;border:1px solid var(--line);border-radius:9px;padding:8px 11px;font-size:11px;z-index:1000;box-shadow:0 3px 12px rgba(13,45,78,.08)}
  .legend div{display:flex;align-items:center;gap:6px;margin:2px 0;color:#33455a;font-weight:600}
  .legend .pd{width:8px;height:8px;border-radius:50%}
  @media(max-width:760px){.grid{grid-template-columns:1fr}#map{min-height:300px;border-right:0;border-bottom:1px solid var(--line)}}
</style>
</head>
<body>
  <div class="head">
    <h1>My showings</h1>
    <span class="live"><span class="p"></span>Live</span>
  </div>
  <div class="grid">
    <div id="map">
      <div class="legend">
        <div><span class="pd" style="background:#e0a41b"></span>Proposed</div>
        <div><span class="pd" style="background:#3a9e8f"></span>Confirmed</div>
        <div><span class="pd" style="background:#8dc63f"></span>Took place</div>
      </div>
    </div>
    <div class="panel">
      <div class="tabs">
        <button class="tab on" data-tab="upcoming">Upcoming</button>
        <button class="tab" data-tab="past">Past</button>
      </div>
      <div class="list" id="list"></div>
    </div>
  </div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>
  var API = '/.netlify/functions/showings';
  var SECRET = 'renters2026';
  var CHECK = '<svg class="check" viewBox="0 0 24 24"><path fill="#1d9bf0" d="M12 2l2.4 1.8 3 .1 1 2.8 2.4 1.7-.9 2.9.9 2.9-2.4 1.7-1 2.8-3 .1L12 22l-2.4-1.8-3-.1-1-2.8L3.2 15.5l.9-2.9-.9-2.9 2.4-1.7 1-2.8 3-.1z"/><path fill="#fff" d="M10.6 15.2l-2.5-2.5 1.2-1.2 1.3 1.3 3.3-3.3 1.2 1.2z"/></svg>';
  var COLOR = {proposed:'#e0a41b',confirmed:'#3a9e8f',completed:'#8dc63f',cancelled:'#9fb0c0'};
  var LABEL = {proposed:'Proposed',confirmed:'Confirmed',completed:'Took place',cancelled:'Cancelled'};

  var qs = new URLSearchParams(location.search);
  var memberId = qs.get('memberId') || '';
  var tab = 'upcoming', selected = null, data = [], markers = {}, map;

  function el(id){ return document.getElementById(id); }
  function postHeight(){ try{ parent.postMessage({rcShowHeight: document.body.scrollHeight}, '*'); }catch(e){} }

  function initMap(){
    map = L.map('map',{zoomControl:true,attributionControl:false}).setView([39.5,-98.35],4);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{maxZoom:19,subdomains:'abcd'}).addTo(map);
  }

  function icon(s){
    var chk = s.status==='completed' ? '<span class="chk">\\u2713</span>' : '';
    return L.divIcon({className:'',html:'<div class="mk"><div class="ring" style="background:'+COLOR[s.status]+'"></div>'+chk+'</div>',iconSize:[26,26],iconAnchor:[13,13]});
  }

  function drawMap(){
    Object.values(markers).forEach(function(m){ map.removeLayer(m); }); markers = {};
    var pts = data.filter(function(s){ return s.status!=='cancelled' && s.lat && s.lng; });
    var bounds = [];
    pts.forEach(function(s){
      var m = L.marker([s.lat,s.lng],{icon:icon(s)}).addTo(map);
      m.on('click',function(){ select(s.id); });
      markers[s.id]=m; bounds.push([s.lat,s.lng]);
    });
    if(bounds.length===1) map.setView(bounds[0],13);
    else if(bounds.length>1) map.fitBounds(bounds,{padding:[40,40],maxZoom:13});
  }

  function fmtWhen(start,status){
    var d = new Date(start);
    var t = d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
    var dd = Math.round((new Date(d).setHours(0,0,0,0) - new Date().setHours(0,0,0,0))/86400000);
    var day = dd===0?'today':dd===1?'tomorrow':dd===-1?'yesterday':(dd>0?'in '+dd+'d':Math.abs(dd)+'d ago');
    if(status==='completed') return '\\u2713 '+day+' '+t;
    return day+' '+t;
  }

  function other(s){ return s.role==='host' ? (s.guestName||'Renter') : (s.hostName||'Host'); }
  function otherVerified(s){ return s.role==='host' ? s.guestVerified : s.hostVerified; }

  function isPast(s){
    if(s.status==='completed'||s.status==='cancelled') return true;
    return new Date(s.start) < new Date();
  }

  function actionsFor(s){
    if(s.status==='completed') return '<div class="doneflag">\\u2713 Confirmed it took place</div>';
    if(s.status==='cancelled') return '';
    if(s.status==='proposed'){
      if(s.role==='host') return '<div class="act"><button class="btn btn-go" data-do="confirm" data-id="'+s.id+'">Confirm</button><button class="btn btn-ghost" data-do="decline" data-id="'+s.id+'">Decline</button></div>';
      return '<div class="act"><button class="btn btn-ghost" data-do="cancel" data-id="'+s.id+'">Cancel request</button></div>';
    }
    // confirmed
    return '<div class="act"><button class="btn btn-done" data-do="complete" data-id="'+s.id+'">Mark it took place</button><button class="btn btn-ghost" data-do="cancel" data-id="'+s.id+'">Cancel</button></div>';
  }

  function render(){
    var rows = data.filter(function(s){ return tab==='past' ? isPast(s) : !isPast(s); });
    var L2 = el('list'); L2.innerHTML='';
    if(!rows.length){
      L2.innerHTML = '<div class="empty">'+(tab==='past'?'No past showings yet.':'No upcoming showings yet. When someone books one of your open slots, or you book theirs, it shows up here and on the map.')+'</div>';
      postHeight(); return;
    }
    rows.forEach(function(s){
      var c = document.createElement('div');
      c.className='card'+(selected===s.id?' sel':'');
      var check = otherVerified(s) ? CHECK : '';
      c.innerHTML =
        '<span class="when">'+fmtWhen(s.start,s.status)+'</span>'+
        '<div class="role">'+(s.role==='host'?'You are hosting':'You booked')+'</div>'+
        '<div class="rowtop"><span class="who">'+other(s)+'</span>'+check+'</div>'+
        '<div class="addr">'+(s.propertyLabel||'Showing')+(s.city?' \\u00b7 '+s.city:'')+'</div>'+
        '<span class="pill s-'+s.status+'"><span class="pd"></span>'+LABEL[s.status]+'</span>'+
        actionsFor(s);
      c.addEventListener('click',function(ev){ if(!ev.target.closest('button')) select(s.id); });
      L2.appendChild(c);
    });
    L2.querySelectorAll('button[data-do]').forEach(function(btn){
      btn.addEventListener('click',function(){ doAction(btn.getAttribute('data-do'), btn.getAttribute('data-id')); });
    });
    postHeight();
  }

  function select(id){
    selected=id; render();
    var s = data.find(function(x){ return x.id===id; });
    if(s && s.lat && markers[id]) map.panTo([s.lat,s.lng]);
  }

  function doAction(action,id){
    fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:action,secret:SECRET,id:id,by:memberId})})
      .then(function(r){ return r.json(); })
      .then(function(){ load(); });
  }

  function load(){
    if(!memberId){ el('list').innerHTML='<div class="empty">Open this from your dashboard to see your showings.</div>'; return; }
    fetch(API+'?action=list&memberId='+encodeURIComponent(memberId))
      .then(function(r){ return r.json(); })
      .then(function(res){ data = res.showings||[]; drawMap(); render(); })
      .catch(function(){ el('list').innerHTML='<div class="empty">Could not load your showings. Try again.</div>'; });
  }

  document.querySelector('.tabs').addEventListener('click',function(e){
    var b=e.target.closest('.tab'); if(!b) return;
    tab=b.getAttribute('data-tab');
    [].forEach.call(this.children,function(x){ x.classList.toggle('on',x===b); });
    render();
  });

  initMap(); load(); postHeight();
  setInterval(load, 12000); // near-real-time refresh
  window.addEventListener('resize', postHeight);
</script>
</body>
</html>`;
