// netlify/functions/book-showing-page.js
// The booking view. A member opens a host's open calendar and books a slot.
// Reached at /book-showing?host=HOSTID ; head code sets ?hostId=HOST&guestId=<logged_user>.
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
<title>Book a showing</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Red+Hat+Display:wght@600;700;800&family=Open+Sans:wght@400;600;700&display=swap" rel="stylesheet" />
<style>
  :root{--navy:#0d2d4e;--teal:#3a9e8f;--lime:#8dc63f;--blue:#1d9bf0;--muted:#5b7189;--line:rgba(13,45,78,.12)}
  *{box-sizing:border-box}
  body{margin:0;font-family:"Open Sans",system-ui,sans-serif;color:var(--navy);background:#fff;padding:22px 20px 40px}
  .host{display:flex;align-items:center;gap:13px;border:1px solid var(--line);border-radius:14px;padding:14px 15px;margin-bottom:18px}
  .ph{width:52px;height:52px;border-radius:50%;background:#dfe6ee;object-fit:cover;flex:0 0 auto}
  .host h1{font-family:"Red Hat Display";font-weight:800;font-size:18px;margin:0 0 2px;display:flex;align-items:center;gap:7px}
  .check{width:16px;height:16px}
  .host .m{font-size:12.5px;color:var(--muted)}
  .lead{font-size:14px;color:var(--navy);margin:0 0 16px}
  .daygroup{margin:0 0 16px}
  .dayname{font-family:"Red Hat Display";font-weight:700;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin:0 0 9px}
  .slots{display:flex;flex-wrap:wrap;gap:8px}
  .slot{border:1px solid var(--line);background:#fff;border-radius:9px;padding:9px 14px;font:inherit;font-weight:700;font-size:13.5px;color:var(--navy);cursor:pointer;transition:.12s}
  .slot:hover{border-color:var(--teal);background:rgba(58,158,143,.06)}
  .slot.sel{background:var(--teal);color:#fff;border-color:var(--teal)}
  .bar{position:sticky;bottom:0;background:#fff;padding-top:14px;margin-top:8px;display:flex;align-items:center;gap:14px;border-top:1px solid var(--line)}
  .book{background:var(--teal);color:#fff;border:0;border-radius:10px;padding:13px 26px;font:inherit;font-weight:700;font-size:14.5px;cursor:pointer}
  .book:disabled{opacity:.4;cursor:default}
  .status{font-size:13px;font-weight:600;color:var(--muted)}
  .status.err{color:#b23b3b}
  .empty{color:var(--muted);font-size:14px;padding:30px 4px;line-height:1.6}
  .done{text-align:center;padding:26px 10px}
  .done .big{width:64px;height:64px;border-radius:50%;background:rgba(141,198,63,.18);display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:32px;color:#4d7c12}
  .done h2{font-family:"Red Hat Display";font-weight:800;font-size:20px;margin:0 0 6px}
  .done p{color:var(--muted);font-size:14px;margin:0 auto;max-width:340px;line-height:1.55}
</style>
</head>
<body>
  <div id="app"><div class="empty">Loading open times...</div></div>

<script>
  var API = '/.netlify/functions/showings';
  var MEMBER = '/.netlify/functions/verify-member';
  var SECRET = 'renters2026';
  var CHECK = '<svg class="check" viewBox="0 0 24 24"><path fill="#1d9bf0" d="M12 2l2.4 1.8 3 .1 1 2.8 2.4 1.7-.9 2.9.9 2.9-2.4 1.7-1 2.8-3 .1L12 22l-2.4-1.8-3-.1-1-2.8L3.2 15.5l.9-2.9-.9-2.9 2.4-1.7 1-2.8 3-.1z"/><path fill="#fff" d="M10.6 15.2l-2.5-2.5 1.2-1.2 1.3 1.3 3.3-3.3 1.2 1.2z"/></svg>';
  var qs = new URLSearchParams(location.search);
  var hostId = qs.get('hostId') || '';
  var guestId = qs.get('guestId') || '';
  var host = {}, guest = {}, slots = [], chosen = null;

  function postHeight(){ try{ parent.postMessage({rcBookHeight: document.body.scrollHeight}, '*'); }catch(e){} }
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }

  function member(id){
    return fetch(MEMBER+'?memberId='+encodeURIComponent(id)).then(function(r){ return r.json(); }).catch(function(){ return {}; });
  }

  function fmtDay(iso){
    var d = new Date(iso);
    var dd = Math.round((new Date(d).setHours(0,0,0,0) - new Date().setHours(0,0,0,0))/86400000);
    var lbl = dd===0?'Today':dd===1?'Tomorrow':d.toLocaleDateString([], {weekday:'long', month:'short', day:'numeric'});
    return lbl;
  }
  function fmtTime(iso){ return new Date(iso).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}); }

  function boot(){
    if(!hostId || !guestId){ document.getElementById('app').innerHTML='<div class="empty">Open this from a member profile to book a showing.</div>'; postHeight(); return; }
    Promise.all([member(hostId), member(guestId), fetch(API+'?action=slots&hostId='+encodeURIComponent(hostId)).then(function(r){return r.json();})])
      .then(function(res){ host=res[0]||{}; guest=res[1]||{}; slots=(res[2]&&res[2].slots)||[]; render(); });
  }

  function render(){
    var app = document.getElementById('app');
    var hName = host.name || 'This member';
    var hLoc = host.location || '';
    var hCheck = host.verified ? CHECK : '';
    var photo = host.profilePhotoUrl ? '<img class="ph" src="'+esc(host.profilePhotoUrl)+'" alt="" onerror="this.style.visibility=\\'hidden\\'"/>' : '<div class="ph"></div>';

    var head = '<div class="host">'+photo+'<div><h1>'+esc(hName)+' '+hCheck+'</h1><div class="m">'+(hLoc?esc(hLoc):'Showing host')+'</div></div></div>';

    if(!slots.length){
      app.innerHTML = head + '<div class="empty">'+esc(hName)+' has no open times right now. Check back soon, or reach out on-platform to ask about availability.</div>';
      postHeight(); return;
    }

    // group by day
    var groups = {}; var order = [];
    slots.forEach(function(s){
      var key = s.start.slice(0,10);
      if(!groups[key]){ groups[key]=[]; order.push(key); }
      groups[key].push(s);
    });
    var body = '<p class="lead">Pick an open time. '+(host.autoConfirm===false?'':'')+'Your showing appears on both dashboards the moment it is booked.</p>';
    order.forEach(function(key){
      body += '<div class="daygroup"><div class="dayname">'+fmtDay(groups[key][0].start)+'</div><div class="slots">';
      groups[key].forEach(function(s){
        body += '<button class="slot" data-start="'+s.start+'">'+fmtTime(s.start)+'</button>';
      });
      body += '</div></div>';
    });
    body += '<div class="bar"><button class="book" id="bookBtn" disabled>Book showing</button><span class="status" id="status"></span></div>';

    app.innerHTML = head + body;
    app.querySelectorAll('.slot').forEach(function(b){
      b.addEventListener('click',function(){
        app.querySelectorAll('.slot').forEach(function(x){ x.classList.remove('sel'); });
        b.classList.add('sel'); chosen=b.getAttribute('data-start');
        document.getElementById('bookBtn').disabled=false;
      });
    });
    document.getElementById('bookBtn').addEventListener('click', doBook);
    postHeight();
  }

  function doBook(){
    if(!chosen) return;
    var btn=document.getElementById('bookBtn'); btn.disabled=true;
    document.getElementById('status').textContent='Booking...';
    fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      action:'book', secret:SECRET,
      hostId:hostId, guestId:guestId,
      hostName:host.name||'', guestName:guest.name||'',
      hostVerified:!!host.verified, guestVerified:!!guest.verified,
      propertyLabel:(host.rentalInfo&&host.rentalInfo.title)||host.name||'Showing',
      city:host.location||'',
      start:chosen
    })}).then(function(r){ return r.json(); }).then(function(res){
      if(res.ok) success(res.showing);
      else { btn.disabled=false; var st=document.getElementById('status'); st.className='status err'; st.textContent=res.error||'Could not book. Try another time.'; if(res.error&&res.error.indexOf('available')>-1) boot(); }
    }).catch(function(){ btn.disabled=false; var st=document.getElementById('status'); st.className='status err'; st.textContent='Something went wrong. Try again.'; });
  }

  function success(s){
    var when = new Date(s.start).toLocaleString([], {weekday:'long', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
    var confirmed = s.status==='confirmed';
    document.getElementById('app').innerHTML =
      '<div class="done"><div class="big">'+(confirmed?'\\u2713':'\\u23f3')+'</div>'+
      '<h2>'+(confirmed?'Showing booked':'Request sent')+'</h2>'+
      '<p>'+esc(host.name||'The host')+' \\u00b7 '+when+'.<br/>'+
      (confirmed
        ? 'It is on both of your dashboards now. You can confirm it took place afterward.'
        : (esc(host.name||'The host')+' approves each booking. You will see it move to confirmed on your dashboard.'))+
      '</p></div>';
    postHeight();
  }

  boot();
  window.addEventListener('resize', postHeight);
</script>
</body>
</html>`;
