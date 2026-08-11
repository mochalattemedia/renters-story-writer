// ============================================================
//  verify-approve.js   va-v2   (2026-08-11)
//  Mobile verification approval. No BD login, phone-first.
//
//  va-v2  BD's DEFAULT AVATAR IS NOT A PHOTO. verify-member returns a
//         profilePhotoUrl for every member, including those who never
//         uploaded anything, because BD serves a stock silhouette at
//         profile-profile-holder.png. va-v1 read "a URL exists" as "has a
//         photo" and printed a GREEN bar over a placeholder, which is the
//         one wrong thing this page can say: the whole decision is whether
//         the profile photo matches the selfie, and a silhouette matches
//         nothing. Now the placeholder is detected, the tile shows as
//         empty, and the bar points at the needs-photo button.
//         (The bookmarklet has the same flaw in its "Has photo" line.)
//
//  A Didit approval fires a minimal email carrying an HMAC-signed
//  link. The link opens a private page that shows the three photos
//  (profile / Didit selfie / ID portrait), the face-match score and
//  whether a profile photo exists. Two actions: APPROVE or SEND
//  NEEDS-PHOTO EMAIL.
//
//  SECURITY MODEL
//   - Token is base64url payload + HMAC-SHA256, timing-safe compared.
//   - Nothing renders until the PIN is entered. A leaked link alone
//     shows an empty page, never an ID portrait.
//   - PIN attempts are capped at 5 per token, then the token is dead.
//   - VIEWING is reusable until expiry (refresh must not break it).
//     ACTING burns the token. One decision per link.
//   - Images are proxied through this function. Didit signed URLs and
//     the BD photo URL never reach the browser.
//
//  Env:
//    APPROVE_SIGNING_SECRET  (new, required)  long random string
//    APPROVE_PIN             (new, required)  4-8 digits, Kenny types it
//    ADMIN_PROBE_KEY         (existing)       gates ?mint=1, calls verify-grant
//    NETLIFY_SITE_ID / NETLIFY_BLOBS_TOKEN    (existing)
//
//  Endpoints:
//    ?version=1                             env check
//    ?mint=1&memberId=&inquiryId=&key=K     returns the signed URL
//    ?t=TOKEN                               the page (HTML)
//    ?img=selfie|id|profile&t=&v=VIEW       image proxy
//    POST {action:"data"|"approve"|"needsphoto", t, pin}
// ============================================================

const FN_VERSION = "va-v2";

const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");

const FN_BASE = "https://renters-story-writer.netlify.app/.netlify/functions";
const SELF_URL = FN_BASE + "/verify-approve";
const GRANT_URL = FN_BASE + "/verify-grant";
const LOG_URL = FN_BASE + "/verify-log";
const MEMBER_URL = FN_BASE + "/verify-member";
const EMAIL_URL = FN_BASE + "/send-verification-email";
const SELFIE_URL = FN_BASE + "/didit-selfie";

const LOG_KEY = "renters2026";
const STORE_NAME = "approve-tokens";
const TTL_HOURS = 72;
const MAX_PIN_ATTEMPTS = 5;
const VIEW_WINDOW_MS = 15 * 60 * 1000;

// BD serves a stock silhouette to every member with no uploaded photo, so a
// non-empty profilePhotoUrl proves nothing on its own. Matched on the known
// filename only: a looser pattern risks the worse error, telling Kenny to chase
// a photo from someone who already supplied a real one.
const PLACEHOLDER_MARKERS = ["profile-profile-holder"];

function isPlaceholderPhoto(url) {
  if (!url) return false;
  const u = String(url).toLowerCase().split("?")[0];
  for (let i = 0; i < PLACEHOLDER_MARKERS.length; i++) {
    if (u.indexOf(PLACEHOLDER_MARKERS[i]) !== -1) return true;
  }
  return false;
}

// Returns "" when the member has no REAL photo, placeholder included.
function realPhotoUrl(member) {
  const u = (member && (member.profilePhotoUrl || member.profilePhoto)) || "";
  return isPlaceholderPhoto(u) ? "" : u;
}

// ---------- plumbing ----------

function json(code, obj) {
  return {
    statusCode: code,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
    },
    body: JSON.stringify(Object.assign({ _v: FN_VERSION }, obj))
  };
}

function html(code, markup) {
  return {
    statusCode: code,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow, noarchive"
    },
    body: markup
  };
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf8");
}

function sign(payloadStr, secret) {
  return crypto.createHmac("sha256", secret).update(payloadStr, "utf8").digest("hex").slice(0, 32);
}

function safeEqual(a, b) {
  try {
    const A = Buffer.from(String(a));
    const B = Buffer.from(String(b));
    if (A.length !== B.length) return false;
    return crypto.timingSafeEqual(A, B);
  } catch (e) {
    return false;
  }
}

function mintToken(memberId, inquiryId, secret) {
  const payload = {
    m: String(memberId),
    i: String(inquiryId || ""),
    e: Math.floor(Date.now() / 1000) + TTL_HOURS * 3600,
    n: crypto.randomBytes(8).toString("hex")
  };
  const enc = b64url(JSON.stringify(payload));
  return enc + "." + sign(enc, secret);
}

// Returns { ok, payload } or { ok:false, reason }
function readToken(token, secret) {
  if (!token || String(token).indexOf(".") === -1) return { ok: false, reason: "malformed" };
  const parts = String(token).split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  if (!safeEqual(sign(parts[0], secret), parts[1])) return { ok: false, reason: "bad signature" };
  let payload;
  try {
    payload = JSON.parse(unb64url(parts[0]));
  } catch (e) {
    return { ok: false, reason: "unreadable" };
  }
  if (!payload || !payload.m || !payload.e || !payload.n) return { ok: false, reason: "incomplete" };
  if (Math.floor(Date.now() / 1000) > Number(payload.e)) return { ok: false, reason: "expired" };
  return { ok: true, payload: payload };
}

function store() {
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
    return getStore({
      name: STORE_NAME,
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN
    });
  }
  return getStore(STORE_NAME);
}

async function readState(nonce) {
  try {
    const s = store();
    const v = await s.get("tok:" + nonce, { type: "json" });
    return v || { attempts: 0, used: false };
  } catch (e) {
    return { attempts: 0, used: false, _readError: String(e && e.message) };
  }
}

async function writeState(nonce, state) {
  try {
    await store().setJSON("tok:" + nonce, state);
    return true;
  } catch (e) {
    return false;
  }
}

// View tokens let <img src> work without carrying the PIN in a URL.
function mintView(nonce, secret) {
  const exp = Date.now() + VIEW_WINDOW_MS;
  return exp + "." + sign(nonce + "|view|" + exp, secret);
}
function checkView(nonce, view, secret) {
  if (!view || String(view).indexOf(".") === -1) return false;
  const parts = String(view).split(".");
  if (parts.length !== 2) return false;
  if (Date.now() > Number(parts[0])) return false;
  return safeEqual(sign(nonce + "|view|" + parts[0], secret), parts[1]);
}

async function postJson(url, payload) {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const t = await r.text();
    try {
      return JSON.parse(t);
    } catch (e) {
      return null;
    }
  } catch (e) {
    return null;
  }
}

async function getJson(url) {
  try {
    const r = await fetch(url);
    const t = await r.text();
    try {
      return JSON.parse(t);
    } catch (e) {
      return null;
    }
  } catch (e) {
    return null;
  }
}

// verify-member: use the ?ids= BATCH shape with a single id. That shape is
// proven by didit-review drv-v8. Do not re-derive the single-read wrapper.
async function loadMember(memberId) {
  const res = await getJson(MEMBER_URL + "?key=" + LOG_KEY + "&ids=" + encodeURIComponent(memberId));
  const list = (res && res.members) || [];
  for (let i = 0; i < list.length; i++) {
    if (list[i] && String(list[i].memberId) === String(memberId)) return list[i];
  }
  return list[0] || null;
}

async function loadSelfie(inquiryId) {
  if (!inquiryId) return null;
  return await postJson(SELFIE_URL, { session_id: inquiryId });
}

// ---------- actions ----------

async function doApprove(payload, member) {
  const memberId = payload.m;
  const adminKey = process.env.ADMIN_PROBE_KEY || "";

  // 1. Flip the BD flag. verify-grant owns this call and read-back verifies it.
  const g = await getJson(GRANT_URL + "?grant=1&memberId=" + encodeURIComponent(memberId) + "&key=" + encodeURIComponent(adminKey));
  if (!g || g.landed !== true) {
    return { ok: false, error: "The badge did not land in BD. Nothing else was sent.", detail: g || null };
  }

  // 2. Timeline. decidedBy marks this as a phone decision, not the bookmarklet.
  await postJson(LOG_URL, {
    action: "update",
    key: LOG_KEY,
    memberId: memberId,
    inquiryId: payload.i,
    status: "approved",
    note: "Badge granted from phone approval",
    decidedBy: "admin-mobile"
  });

  // 3. The welcome email. The bookmarklet's doGrant sends this, so the phone
  //    must too, or a phone-approved member never gets oriented.
  let emailed = false;
  if (member && member.email) {
    await postJson(EMAIL_URL, {
      type: "approved",
      email: member.email,
      name: member.name || "",
      accountType: member.accountType || ""
    });
    emailed = true;
  }

  return { ok: true, message: "Badge granted" + (emailed ? " and welcome email sent." : ". No email on file, nothing sent."), emailed: emailed };
}

async function doNeedsPhoto(payload, member) {
  const memberId = payload.m;
  const adminKey = process.env.ADMIN_PROBE_KEY || "";

  // Parity with the panel: if they are somehow verified already, drop the badge
  // so they leave the Granted queue.
  if (member && member.verified) {
    await getJson(GRANT_URL + "?revoke=1&memberId=" + encodeURIComponent(memberId) + "&key=" + encodeURIComponent(adminKey));
  }

  await postJson(LOG_URL, {
    action: "update",
    key: LOG_KEY,
    memberId: memberId,
    inquiryId: payload.i,
    status: "needs-photo",
    note: "Holding for a face photo (phone approval)",
    decidedBy: "admin-mobile"
  });

  if (!member || !member.email) {
    return { ok: false, error: "No email on file for this member. Status set to Needs photo, but nothing was sent." };
  }

  await postJson(EMAIL_URL, {
    type: "needs-photo",
    email: member.email,
    name: member.name || ""
  });

  return { ok: true, message: "Needs-photo email sent to " + member.email };
}

// ---------- the page ----------

function pageHtml(token) {
  const safeToken = String(token).replace(/[^A-Za-z0-9._-]/g, "");
  return [
    "<!DOCTYPE html><html lang='en'><head>",
    "<meta charset='utf-8'>",
    "<meta name='viewport' content='width=device-width, initial-scale=1, viewport-fit=cover'>",
    "<meta name='robots' content='noindex, nofollow'>",
    "<title>Review</title>",
    "<style>",
    "*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}",
    "body{margin:0;background:#0d2d4e;color:#0d2d4e;font-family:-apple-system,BlinkMacSystemFont,'Open Sans',Arial,sans-serif;padding:16px;min-height:100vh;}",
    ".wrap{max-width:520px;margin:0 auto;}",
    ".card{background:#fff;border-radius:16px;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.25);}",
    "h1{font-size:17px;margin:0 0 4px;font-weight:800;}",
    ".sub{font-size:13px;color:#4a5a6a;margin:0 0 16px;}",
    "input[type=tel]{width:100%;padding:16px;font-size:24px;text-align:center;letter-spacing:.4em;border:2px solid #e8eceb;border-radius:12px;outline:none;font-family:inherit;}",
    "input[type=tel]:focus{border-color:#3a9e8f;}",
    ".btn{display:block;width:100%;padding:16px;border:none;border-radius:12px;font-size:16px;font-weight:800;cursor:pointer;margin-top:12px;font-family:inherit;}",
    ".btn:disabled{opacity:.5;}",
    ".b-open{background:#0d2d4e;color:#fff;}",
    ".b-approve{background:#3a9e8f;color:#fff;}",
    ".b-photo{background:#fff;color:#b9770e;border:2px solid #f5d9a8;}",
    ".photos{display:flex;gap:10px;margin:16px 0 4px;}",
    ".ph{flex:1;text-align:center;}",
    ".ph img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px;display:block;background:#eef1f3;}",
    ".ph .none{width:100%;aspect-ratio:1;border-radius:12px;background:#fadbd8;color:#922b21;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;text-align:center;padding:8px;}",
    ".ph p{font-size:11px;color:#4a5a6a;margin:6px 0 0;font-weight:700;}",
    ".s-profile img{border:3px solid #0d2d4e;}",
    ".s-selfie img{border:3px solid #3a9e8f;}",
    ".s-id img{border:2px solid #cdd6db;}",
    ".score{font-size:14px;margin:14px 0 0;padding:12px;background:#f4f6f7;border-radius:10px;text-align:center;font-weight:700;}",
    ".flag{margin:14px 0 0;padding:12px;border-radius:10px;font-size:14px;font-weight:700;text-align:center;}",
    ".f-bad{background:#fadbd8;color:#922b21;}",
    ".f-good{background:#d4efdf;color:#1e8449;}",
    ".msg{margin-top:14px;padding:12px;border-radius:10px;font-size:14px;text-align:center;font-weight:700;}",
    ".m-err{background:#fadbd8;color:#922b21;}",
    ".m-ok{background:#d4efdf;color:#1e8449;}",
    ".hint{font-size:12px;color:#8a97a3;text-align:center;margin-top:14px;line-height:1.5;}",
    ".hide{display:none;}",
    "</style></head><body><div class='wrap'><div class='card'>",

    "<div id='gate'>",
    "<h1>Verification review</h1>",
    "<p class='sub'>Enter your PIN to open this request.</p>",
    "<input type='tel' id='pin' inputmode='numeric' autocomplete='off' maxlength='8' placeholder='••••'>",
    "<button class='btn b-open' id='open'>Open</button>",
    "<div id='gmsg'></div>",
    "</div>",

    "<div id='panel' class='hide'>",
    "<h1 id='who'>Member</h1>",
    "<p class='sub' id='sub'></p>",
    "<div class='photos' id='photos'></div>",
    "<div id='score'></div>",
    "<div id='flag'></div>",
    "<button class='btn b-approve' id='approve'>Approve, grant the badge</button>",
    "<button class='btn b-photo' id='needsphoto'>Send needs-photo email</button>",
    "<div id='amsg'></div>",
    "<p class='hint'>One decision per link. Approving grants the badge, which also unlocks listing.</p>",
    "</div>",

    "</div></div><script>",
    "(function(){",
    "var VA='" + FN_VERSION + "';",
    "try{console.log('[verify-approve] '+VA);}catch(e){}",
    "var T='" + safeToken + "';",
    "var PIN='';var VIEW='';var busy=false;",
    "var $=function(id){return document.getElementById(id);};",
    "function say(box,cls,txt){$(box).innerHTML=txt?\"<div class='msg \"+cls+\"'>\"+txt+\"</div>\":'';}",
    "function post(body){return fetch(location.pathname+location.search,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json();});}",
    "function esc(s){return String(s==null?'':s).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c];});}",

    "function draw(d){",
    "$('gate').className='hide';$('panel').className='';",
    "$('who').textContent=d.name||('Member #'+d.memberId);",
    "$('sub').textContent='Member #'+d.memberId+(d.accountType?(' · '+d.accountType):'');",
    "var base=location.pathname+'?t='+encodeURIComponent(T)+'&v='+encodeURIComponent(VIEW)+'&img=';",
    "var h='';",
    "h+=\"<div class='ph s-profile'>\"+(d.hasProfile?(\"<img src='\"+base+\"profile' alt=''>\"):(\"<div class='none'>\"+(d.placeholderPhoto?'Placeholder, not a photo':'No profile photo')+\"</div>\"))+\"<p>Profile</p></div>\";",
    "h+=\"<div class='ph s-selfie'>\"+(d.hasSelfie?(\"<img src='\"+base+\"selfie' alt=''>\"):\"<div class='none'>No selfie</div>\")+\"<p>Selfie</p></div>\";",
    "h+=\"<div class='ph s-id'>\"+(d.hasId?(\"<img src='\"+base+\"id' alt=''>\"):\"<div class='none'>No ID photo</div>\")+\"<p>ID photo</p></div>\";",
    "$('photos').innerHTML=h;",
    "if(typeof d.score==='number'){",
    "var c=d.score>=80?'#1e8449':(d.score>=60?'#b9770e':'#c0392b');",
    "$('score').innerHTML=\"<div class='score'>ID to selfie match: <span style='color:\"+c+\"'>\"+d.score.toFixed(1)+\"%</span></div>\";",
    "}",
    "var fmsg=d.hasProfile?\"<div class='flag f-good'>Photo on file. Check it is the same face.</div>\":(d.placeholderPhoto?\"<div class='flag f-bad'>Stock silhouette, not a real photo. Send the needs-photo email.</div>\":\"<div class='flag f-bad'>No profile photo. Send the needs-photo email.</div>\");",
    "$('flag').innerHTML=fmsg;",
    "}",

    "$('open').onclick=function(){",
    "if(busy)return;PIN=$('pin').value.replace(/[^0-9]/g,'');",
    "if(!PIN){say('gmsg','m-err','Enter your PIN.');return;}",
    "busy=true;this.disabled=true;this.textContent='Opening...';say('gmsg','','');",
    "var btn=this;",
    "post({action:'data',t:T,pin:PIN}).then(function(d){",
    "busy=false;btn.disabled=false;btn.textContent='Open';",
    "if(!d||!d.ok){say('gmsg','m-err',esc((d&&d.error)||'Could not open.'));return;}",
    "VIEW=d.view;draw(d);",
    "}).catch(function(){busy=false;btn.disabled=false;btn.textContent='Open';say('gmsg','m-err','Network error.');});",
    "};",

    "$('pin').addEventListener('keydown',function(e){if(e.key==='Enter')$('open').click();});",

    "function act(kind,label,confirmText){",
    "return function(){",
    "if(busy)return;",
    "if(!confirm(confirmText))return;",
    "busy=true;$('approve').disabled=true;$('needsphoto').disabled=true;",
    "var me=this;var old=me.textContent;me.textContent='Working...';",
    "post({action:kind,t:T,pin:PIN}).then(function(d){",
    "busy=false;me.textContent=old;",
    "if(d&&d.ok){",
    "say('amsg','m-ok',esc(d.message||'Done.'));",
    "$('approve').className='btn b-approve hide';$('needsphoto').className='btn b-photo hide';",
    "}else{",
    "$('approve').disabled=false;$('needsphoto').disabled=false;",
    "say('amsg','m-err',esc((d&&d.error)||'Failed.'));",
    "}",
    "}).catch(function(){busy=false;me.textContent=old;$('approve').disabled=false;$('needsphoto').disabled=false;say('amsg','m-err','Network error.');});",
    "};",
    "}",
    "$('approve').onclick=act('approve','Approve','Grant the verified badge? This also unlocks listing for them.');",
    "$('needsphoto').onclick=act('needsphoto','Needs photo','Send the needs-photo email? Their identity stays confirmed.');",
    "})();",
    "</script></body></html>"
  ].join("");
}

function plainPage(title, message) {
  return [
    "<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'>",
    "<meta name='viewport' content='width=device-width, initial-scale=1'>",
    "<meta name='robots' content='noindex, nofollow'><title>Review</title>",
    "<style>body{margin:0;background:#0d2d4e;font-family:-apple-system,BlinkMacSystemFont,'Open Sans',Arial,sans-serif;padding:16px;}",
    ".card{max-width:520px;margin:40px auto;background:#fff;border-radius:16px;padding:24px;text-align:center;color:#0d2d4e;}",
    "h1{font-size:17px;margin:0 0 8px;} p{font-size:14px;color:#4a5a6a;margin:0;line-height:1.6;}</style>",
    "</head><body><div class='card'><h1>", title, "</h1><p>", message, "</p></div></body></html>"
  ].join("");
}

// ---------- handler ----------

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });

  const q = event.queryStringParameters || {};
  const secret = process.env.APPROVE_SIGNING_SECRET || "";
  const pinSet = process.env.APPROVE_PIN || "";
  const adminKey = process.env.ADMIN_PROBE_KEY || "";

  if (q.version === "1") {
    return json(200, {
      ok: true,
      signingSecretConfigured: !!secret,
      pinConfigured: !!pinSet,
      adminKeyConfigured: !!adminKey,
      blobsConfigured: !!(process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN),
      ttlHours: TTL_HOURS
    });
  }

  if (!secret) return json(500, { error: "APPROVE_SIGNING_SECRET not set" });

  // ---- MINT (admin only) ----
  if (q.mint === "1") {
    if (!adminKey || q.key !== adminKey) return json(401, { error: "bad or missing key" });
    const memberId = String(q.memberId || "").replace(/[^0-9]/g, "");
    if (!memberId) return json(400, { error: "memberId required" });
    const tok = mintToken(memberId, q.inquiryId || "", secret);
    return json(200, {
      memberId: memberId,
      inquiryId: q.inquiryId || "",
      expiresInHours: TTL_HOURS,
      url: SELF_URL + "?t=" + encodeURIComponent(tok)
    });
  }

  // ---- IMAGE PROXY ----
  if (q.img) {
    const t = readToken(q.t, secret);
    if (!t.ok) return { statusCode: 403, body: "" };
    if (!checkView(t.payload.n, q.v, secret)) return { statusCode: 403, body: "" };

    const st = await readState(t.payload.n);
    if (st.used) return { statusCode: 410, body: "" };

    let url = "";
    if (q.img === "profile") {
      const mem = await loadMember(t.payload.m);
      url = realPhotoUrl(mem);
    } else {
      const sf = await loadSelfie(t.payload.i);
      url = q.img === "selfie" ? (sf && sf.selfie) || "" : (sf && sf.idPortrait) || "";
    }
    if (!url) return { statusCode: 404, body: "" };

    try {
      const r = await fetch(url);
      if (!r.ok) return { statusCode: 404, body: "" };
      const buf = Buffer.from(await r.arrayBuffer());
      return {
        statusCode: 200,
        headers: {
          "Content-Type": r.headers.get("content-type") || "image/jpeg",
          "Cache-Control": "private, max-age=300",
          "Referrer-Policy": "no-referrer"
        },
        body: buf.toString("base64"),
        isBase64Encoded: true
      };
    } catch (e) {
      return { statusCode: 502, body: "" };
    }
  }

  // ---- POST ACTIONS ----
  if (event.httpMethod === "POST") {
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch (e) {
      return json(400, { ok: false, error: "bad body" });
    }

    const t = readToken(body.t, secret);
    if (!t.ok) return json(403, { ok: false, error: "This link is " + t.reason + "." });
    if (!pinSet) return json(500, { ok: false, error: "APPROVE_PIN not set on the server." });

    const nonce = t.payload.n;
    const st = await readState(nonce);

    if (st.used) {
      return json(410, { ok: false, error: "This link was already used" + (st.usedFor ? " to " + st.usedFor + "." : ".") });
    }
    if ((st.attempts || 0) >= MAX_PIN_ATTEMPTS) {
      return json(429, { ok: false, error: "Too many PIN attempts. This link is dead." });
    }

    const givenPin = String(body.pin || "").replace(/[^0-9]/g, "");
    if (!safeEqual(givenPin, String(pinSet))) {
      st.attempts = (st.attempts || 0) + 1;
      await writeState(nonce, st);
      const left = MAX_PIN_ATTEMPTS - st.attempts;
      return json(401, {
        ok: false,
        error: left > 0 ? "Wrong PIN. " + left + " attempt" + (left === 1 ? "" : "s") + " left." : "Wrong PIN. This link is now dead."
      });
    }

    // PIN is right. Clear the attempt counter.
    if (st.attempts) {
      st.attempts = 0;
      await writeState(nonce, st);
    }

    const member = await loadMember(t.payload.m);

    // ---- DATA (viewing, does NOT burn the token) ----
    if (body.action === "data") {
      const sf = await loadSelfie(t.payload.i);
      return json(200, {
        ok: true,
        view: mintView(nonce, secret),
        memberId: t.payload.m,
        name: (member && member.name) || "",
        accountType: (member && member.accountType) || "",
        hasProfile: !!realPhotoUrl(member),
        placeholderPhoto: isPlaceholderPhoto((member && (member.profilePhotoUrl || member.profilePhoto)) || ""),
        hasSelfie: !!(sf && sf.selfie),
        hasId: !!(sf && sf.idPortrait),
        score: sf && typeof sf.faceMatchScore === "number" ? sf.faceMatchScore : null,
        alreadyVerified: !!(member && member.verified)
      });
    }

    // ---- APPROVE / NEEDS-PHOTO (burns the token on success) ----
    if (body.action === "approve" || body.action === "needsphoto") {
      if (!member || !member.found) {
        return json(502, { ok: false, error: "Could not read this member from BD. Nothing was changed." });
      }

      const res = body.action === "approve"
        ? await doApprove(t.payload, member)
        : await doNeedsPhoto(t.payload, member);

      if (res.ok) {
        st.used = true;
        st.usedFor = body.action === "approve" ? "grant the badge" : "send the needs-photo email";
        st.usedAt = new Date().toISOString();
        await writeState(nonce, st);
      }
      return json(res.ok ? 200 : 502, res);
    }

    return json(400, { ok: false, error: "unknown action" });
  }

  // ---- THE PAGE ----
  if (q.t) {
    const t = readToken(q.t, secret);
    if (!t.ok) {
      return html(403, plainPage("Link not valid", "This link is " + t.reason + ". Open the verification queue from a computer instead."));
    }
    const st = await readState(t.payload.n);
    if (st.used) {
      return html(410, plainPage("Already handled", "This request was already used to " + (st.usedFor || "act") + ". Nothing further to do here."));
    }
    if ((st.attempts || 0) >= MAX_PIN_ATTEMPTS) {
      return html(429, plainPage("Link locked", "Too many PIN attempts were made on this link, so it has been disabled."));
    }
    return html(200, pageHtml(q.t));
  }

  return json(400, { error: "no action. use ?version=1, ?mint=1 or ?t=TOKEN" });
};
