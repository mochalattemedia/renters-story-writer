// ============================================================
//  prequalify-verify-page.js  ·  The income-verification step.
//  A BD page at /prequalify-verify embeds this via <iframe>, with
//  head code appending ?memberId=..&session_id=.. to the iframe src.
//  Served from Netlify so scripts/styles run (BD would strip them).
//  Calls (same-origin): plaid-link-token.js, then income-verify.js.
// ============================================================

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const memberId = (q.memberId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const sessionId = (q.session_id || q.sessionId || '').replace(/[^a-zA-Z0-9_-]/g, '');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verify your income</title>
<script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
<style>
  body{margin:0;font-family:'Open Sans',Arial,sans-serif;color:#0d2d4e;background:#ffffff;}
  .wrap{max-width:520px;margin:0 auto;padding:28px 20px;}
  .card{border:1px solid #dbe6ef;border-radius:16px;padding:28px 24px;background:#f4f8fb;text-align:center;}
  h1{font-size:22px;font-weight:800;margin:0 0 10px;}
  p{font-size:15px;line-height:1.6;color:#465562;margin:0 0 16px;}
  .btn{display:inline-block;background:#3a9e8f;color:#fff;font-weight:800;font-size:16px;border:none;border-radius:999px;padding:14px 30px;cursor:pointer;}
  .btn:disabled{opacity:.5;cursor:default;}
  .muted{font-size:13px;color:#6a7885;margin-top:14px;}
  .ok{color:#1e6b52;font-weight:800;}
  .err{color:#b4402f;font-weight:700;}
  .spin{display:inline-block;width:18px;height:18px;border:3px solid #cfe0ea;border-top-color:#3a9e8f;border-radius:50%;animation:s .8s linear infinite;vertical-align:middle;}
  @keyframes s{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1 id="title">Verify your income</h1>
    <p id="msg">Connect your bank securely to confirm your income and earn your Prequalified mark. Read-only, we never see your login.</p>
    <button id="go" class="btn" disabled>Preparing<span class="spin" style="margin-left:8px"></span></button>
    <div class="muted" id="foot">Your $5 is already paid. This step is safe to retry.</div>
  </div>
</div>
<script>
  var MEMBER_ID = ${JSON.stringify(memberId)};
  var SESSION_ID = ${JSON.stringify(sessionId)};
  var FN = '/.netlify/functions/';
  var btn = document.getElementById('go');
  var msg = document.getElementById('msg');
  var title = document.getElementById('title');
  var foot = document.getElementById('foot');
  var linkToken = null, handler = null;

  function setBtn(text, enabled){ btn.innerHTML = text; btn.disabled = !enabled; }

  function fail(text){ msg.innerHTML = '<span class="err">' + text + '</span>'; }

  if (!MEMBER_ID) {
    setBtn('Cannot continue', false);
    fail('We could not read your account. Please return to your dashboard and try again.');
  } else {
    getLinkToken(0);
  }

  function getLinkToken(attempt){
    fetch(FN + 'plaid-link-token', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ memberId: MEMBER_ID, sessionId: SESSION_ID })
    }).then(function(r){ return r.json().then(function(d){ return {status:r.status, d:d}; }); })
      .then(function(res){
        if (res.status === 402 && attempt < 5) { // payment not landed yet, brief retry
          setTimeout(function(){ getLinkToken(attempt+1); }, 1500);
          return;
        }
        if (res.status !== 200 || !res.d.link_token) {
          setBtn('Try again', true);
          fail('We could not start verification. Tap try again.');
          btn.onclick = function(){ setBtn('Preparing <span class="spin"></span>', false); getLinkToken(0); };
          return;
        }
        linkToken = res.d.link_token;
        initPlaid();
      })
      .catch(function(){
        setBtn('Try again', true);
        fail('Network hiccup. Tap try again.');
        btn.onclick = function(){ setBtn('Preparing <span class="spin"></span>', false); getLinkToken(0); };
      });
  }

  function initPlaid(){
    handler = Plaid.create({
      token: linkToken,
      onSuccess: function(public_token, metadata){
        setBtn('Verifying your income <span class="spin"></span>', false);
        msg.textContent = 'Bank connected. Confirming your income now.';
        fetch(FN + 'income-verify', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ memberId: MEMBER_ID, sessionId: SESSION_ID })
        }).then(function(r){ return r.json(); })
          .then(function(){
            title.textContent = 'You are prequalified';
            msg.innerHTML = '<span class="ok">Income verified. Your Prequalified mark is on the way.</span>';
            btn.style.display = 'none';
            foot.textContent = 'You can close this window.';
          })
          .catch(function(){
            // Income may still be processing; the webhook will finish it.
            title.textContent = 'Almost done';
            msg.textContent = 'We are finishing your income check. You will get an email when your Prequalified mark is live.';
            btn.style.display = 'none';
          });
      },
      onExit: function(err, metadata){
        if (err) { fail('That did not complete. Your $5 is safe, tap to retry.'); }
        else { msg.textContent = 'Ready when you are. Your $5 is already paid.'; }
        setBtn('Connect your bank', true);
        btn.onclick = function(){ handler.open(); };
      }
    });
    setBtn('Connect your bank', true);
    btn.onclick = function(){ handler.open(); };
  }
</script>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    body: html,
  };
};
