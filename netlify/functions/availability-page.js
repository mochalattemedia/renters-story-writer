// netlify/functions/availability-page.js
// Serves the "Your showing availability" widget. Iframed into the BD dashboard.
// The BD head code sets the src with ?memberId=<logged_user>.
exports.handler = async () => {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: PAGE
  };
};

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Your showing availability</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Red+Hat+Display:wght@600;700;800&family=Open+Sans:wght@400;600;700&display=swap" rel="stylesheet" />
<style>
  :root{--navy:#0d2d4e;--teal:#3a9e8f;--lime:#8dc63f;--paper:#f4f6f8;--muted:#5b7189;--line:rgba(13,45,78,.12)}
  *{box-sizing:border-box}
  body{margin:0;font-family:"Open Sans",system-ui,sans-serif;color:var(--navy);background:#fff;padding:22px 20px 96px}
  h1{font-family:"Red Hat Display";font-weight:800;font-size:21px;margin:0 0 3px;letter-spacing:-.3px}
  .sub{color:var(--muted);font-size:13.5px;margin:0 0 20px}
  .toprow{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
  .card{border:1px solid var(--line);border-radius:14px;padding:16px 17px;margin:14px 0;background:#fff}
  .card h2{font-family:"Red Hat Display";font-weight:700;font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 14px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  label.f{display:block;font-size:12.5px;font-weight:700;color:var(--navy);margin:0 0 6px}
  select,input[type=time]{width:100%;font:inherit;font-size:14px;padding:9px 10px;border:1px solid var(--line);border-radius:9px;background:#fbfcfd;color:var(--navy)}
  select:focus,input:focus{outline:2px solid rgba(58,158,143,.4);border-color:var(--teal)}
  /* toggle */
  .switch{position:relative;display:inline-flex;align-items:center;gap:10px;cursor:pointer;font-weight:700;font-size:13px}
  .track{width:44px;height:26px;border-radius:20px;background:#cdd6df;transition:.2s;position:relative;flex:0 0 auto}
  .track::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.25)}
  .switch input{position:absolute;opacity:0;width:0;height:0}
  .switch input:checked + .track{background:var(--teal)}
  .switch input:checked + .track::after{transform:translateX(18px)}
  .dim{opacity:.45;pointer-events:none;filter:grayscale(.3)}
  /* windows */
  .chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:14px}
  .chip{border:1px solid var(--line);background:#fff;border-radius:20px;padding:7px 13px;font-weight:700;font-size:12.5px;cursor:pointer;color:var(--navy);transition:.12s}
  .chip:hover{border-color:var(--teal);background:rgba(58,158,143,.06)}
  .win{display:grid;grid-template-columns:96px 1fr 1fr 34px;gap:9px;align-items:center;margin:8px 0}
  .win select{padding:8px}
  .rm{border:0;background:#f0e6e6;color:#b23b3b;border-radius:8px;height:38px;font-size:18px;font-weight:700;cursor:pointer;line-height:1}
  .rm:hover{background:#f4d9d9}
  .addbtn{margin-top:6px;border:1px dashed var(--line);background:#fbfcfd;color:var(--navy);border-radius:10px;padding:10px;width:100%;font:inherit;font-weight:700;font-size:13px;cursor:pointer}
  .addbtn:hover{border-color:var(--teal);color:var(--teal)}
  .empty{color:var(--muted);font-size:13px;padding:10px 2px}
  .note{font-size:12px;color:var(--muted);margin-top:10px;line-height:1.5}
  /* save bar */
  .savebar{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid var(--line);padding:12px 20px;display:flex;align-items:center;gap:14px;box-shadow:0 -3px 14px rgba(13,45,78,.06)}
  .save{background:var(--teal);color:#fff;border:0;border-radius:10px;padding:12px 22px;font:inherit;font-weight:700;font-size:14px;cursor:pointer}
  .save:hover{background:#33897b}
  .save:disabled{opacity:.5;cursor:default}
  .status{font-size:13px;font-weight:600;color:var(--muted)}
  .status.ok{color:#4d7c12}
  .status.err{color:#b23b3b}
  @media(max-width:560px){.grid{grid-template-columns:1fr}.win{grid-template-columns:84px 1fr 1fr 32px}}
</style>
</head>
<body>
  <div class="toprow">
    <div>
      <h1>Your showing availability</h1>
      <p class="sub">Set when you're open and how people can book. You stay in control of every rule.</p>
    </div>
    <label class="switch"><input type="checkbox" id="enabled" /><span class="track"></span><span id="enabledLbl">Off</span></label>
  </div>

  <div id="body">
    <div class="card">
      <h2>Booking rules</h2>
      <div class="grid">
        <div>
          <label class="f">Minimum notice</label>
          <select id="minNotice">
            <option value="2">2 hours</option>
            <option value="4">4 hours</option>
            <option value="12">12 hours</option>
            <option value="24" selected>1 day</option>
            <option value="48">2 days</option>
            <option value="72">3 days</option>
          </select>
        </div>
        <div>
          <label class="f">How far ahead people can book</label>
          <select id="horizon">
            <option value="7">1 week</option>
            <option value="14" selected>2 weeks</option>
            <option value="21">3 weeks</option>
            <option value="28">4 weeks</option>
          </select>
        </div>
        <div>
          <label class="f">Showing length</label>
          <select id="slot">
            <option value="30">30 minutes</option>
            <option value="45" selected>45 minutes</option>
            <option value="60">60 minutes</option>
          </select>
        </div>
        <div>
          <label class="f">Buffer between showings</label>
          <select id="buffer">
            <option value="0">None</option>
            <option value="15" selected>15 minutes</option>
            <option value="30">30 minutes</option>
          </select>
        </div>
      </div>
      <label class="switch" style="margin-top:16px"><input type="checkbox" id="autoConfirm" checked /><span class="track"></span><span>Auto-confirm bookings</span></label>
      <p class="note" id="autoNote">On: an open slot books instantly. Off: a booking arrives as a request you approve first.</p>
    </div>

    <div class="card">
      <h2>When you're available</h2>
      <div class="chips" id="chips"></div>
      <div id="windows"></div>
      <button class="addbtn" id="add">+ Add a window</button>
      <p class="note">Bookable slots are generated inside these windows, spaced by your showing length and buffer, and only for times that meet your minimum notice.</p>
    </div>
  </div>

  <div class="savebar">
    <button class="save" id="saveBtn">Save availability</button>
    <span class="status" id="status"></span>
  </div>

<script>
  var API = '/.netlify/functions/availability';
  var SECRET = 'renters2026';
  var DAYS = ['MO','TU','WE','TH','FR','SA','SU'];
  var DAYNAME = {SU:'Sunday',MO:'Monday',TU:'Tuesday',WE:'Wednesday',TH:'Thursday',FR:'Friday',SA:'Saturday'};
  var qs = new URLSearchParams(location.search);
  var memberId = qs.get('memberId') || '';

  function el(id){ return document.getElementById(id); }
  function postHeight(){ try{ parent.postMessage({rcHeight: document.body.scrollHeight}, '*'); }catch(e){} }

  function dayChips(){
    var c = el('chips'); c.innerHTML = '';
    DAYS.forEach(function(d){
      var b = document.createElement('button');
      b.className = 'chip'; b.textContent = '+ ' + DAYNAME[d].slice(0,3);
      b.onclick = function(){ addWindow(d, '17:00', '20:00'); };
      c.appendChild(b);
    });
  }

  function addWindow(day, start, end){
    var wrap = el('windows');
    var row = document.createElement('div');
    row.className = 'win';
    var daySel = document.createElement('select');
    DAYS.forEach(function(d){
      var o = document.createElement('option'); o.value = d; o.textContent = DAYNAME[d];
      if(d === day) o.selected = true; daySel.appendChild(o);
    });
    var s = document.createElement('input'); s.type = 'time'; s.value = start || '17:00';
    var e = document.createElement('input'); e.type = 'time'; e.value = end || '20:00';
    var rm = document.createElement('button'); rm.className = 'rm'; rm.textContent = '\u00d7';
    rm.onclick = function(){ row.remove(); refreshEmpty(); postHeight(); };
    row.appendChild(daySel); row.appendChild(s); row.appendChild(e); row.appendChild(rm);
    wrap.appendChild(row);
    refreshEmpty(); postHeight();
  }

  function refreshEmpty(){
    var wrap = el('windows');
    var has = wrap.querySelector('.win');
    var msg = wrap.querySelector('.empty');
    if(!has && !msg){
      var m = document.createElement('div'); m.className = 'empty';
      m.textContent = 'No windows yet. Tap a day above or Add a window.';
      wrap.appendChild(m);
    } else if(has && msg){ msg.remove(); }
  }

  function readWindows(){
    var rows = el('windows').querySelectorAll('.win');
    var out = [];
    rows.forEach(function(r){
      var sels = r.querySelectorAll('select');
      var ins = r.querySelectorAll('input');
      out.push({ day: sels[0].value, start: ins[0].value, end: ins[1].value });
    });
    return out;
  }

  function applyEnabled(){
    var on = el('enabled').checked;
    el('enabledLbl').textContent = on ? 'Open for showings' : 'Off';
    el('body').classList.toggle('dim', !on);
    postHeight();
  }

  function load(){
    if(!memberId){ setStatus('Open this from your dashboard to load your schedule.', 'err'); return; }
    fetch(API + '?memberId=' + encodeURIComponent(memberId))
      .then(function(r){ return r.json(); })
      .then(function(d){
        el('enabled').checked = !!d.enabled;
        el('autoConfirm').checked = d.autoConfirm !== false;
        setSel('minNotice', d.minNoticeHours, 24);
        setSel('horizon', d.horizonDays, 14);
        setSel('slot', d.slotMins, 45);
        setSel('buffer', d.bufferMins, 15);
        (d.windows || []).forEach(function(w){ addWindow(w.day, w.start, w.end); });
        refreshEmpty(); applyEnabled();
      })
      .catch(function(){ setStatus('Could not load your schedule. Try again.', 'err'); });
  }

  function setSel(id, val, fallback){
    var s = el(id); var v = String(val == null ? fallback : val);
    for(var i=0;i<s.options.length;i++){ if(s.options[i].value === v){ s.selectedIndex = i; return; } }
  }

  function setStatus(msg, kind){
    var s = el('status'); s.textContent = msg || '';
    s.className = 'status' + (kind ? ' ' + kind : '');
  }

  function save(){
    if(!memberId){ setStatus('No member id. Open from your dashboard.', 'err'); return; }
    var payload = {
      secret: SECRET,
      memberId: memberId,
      enabled: el('enabled').checked,
      autoConfirm: el('autoConfirm').checked,
      minNoticeHours: Number(el('minNotice').value),
      horizonDays: Number(el('horizon').value),
      slotMins: Number(el('slot').value),
      bufferMins: Number(el('buffer').value),
      windows: readWindows()
    };
    el('saveBtn').disabled = true; setStatus('Saving...', '');
    fetch(API, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) })
      .then(function(r){ return r.json(); })
      .then(function(res){
        el('saveBtn').disabled = false;
        if(res.ok){ setStatus('Saved. Your availability is live.', 'ok'); }
        else { setStatus(res.error || 'Save failed.', 'err'); }
      })
      .catch(function(){ el('saveBtn').disabled = false; setStatus('Save failed. Try again.', 'err'); });
  }

  el('enabled').addEventListener('change', applyEnabled);
  el('autoConfirm').addEventListener('change', function(){
    el('autoNote').textContent = el('autoConfirm').checked
      ? 'On: an open slot books instantly. Off: a booking arrives as a request you approve first.'
      : 'Off: each booking arrives as a request. Nothing is confirmed until you approve it.';
  });
  el('add').addEventListener('click', function(){ addWindow('MO','17:00','20:00'); });
  el('saveBtn').addEventListener('click', save);

  dayChips(); load(); postHeight();
  window.addEventListener('resize', postHeight);
</script>
</body>
</html>`;
