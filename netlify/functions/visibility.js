// ============================================================
//  visibility.js   ·   VERSION: vis5  (2026-07-09)
//  vis5: Blob store init fixed. idxStore() now passes siteID + token explicitly
//        instead of a try/catch around getStore() that never caught (getStore
//        does not throw on creation). This is why opt-ins never populated the
//        visibility-index and Find Renters returned nothing. Re-save each opted-in
//        renter to backfill the index.
//  vis3: DEPLOY-FRESHNESS MARKER. Same logic as vis2 plus GET debug branches
//        (?debug=read&audience=landlords  and  ?debug=write&memberId=ID&audience=landlords)
//        and hardened Blob store init. If the debug URL still reports "vis2",
//        the paste did not take. Live/correct version reports "vis3".
//  "Who can find me" — renter self-serve audience visibility.
//  Clones landlord-optin.js BD auth + rel_tags write/read pattern.
//
//  POST { memberId, flags: { landlords, propertyManagers, realtors, buying, renters } }
//       -> for each audience: attach tag if true, remove tag if false. Emails Kenny a summary.
//  GET  ?status=1&memberId=ID
//       -> { landlords, propertyManagers, realtors, buying, renters }  (booleans, wizard reads on load)
//
//  Confirmed BD tag IDs (Members > Tags, Custom Tags group):
//    visible-to-landlords         = 6
//    visible-to-property-managers = 7
//    visible-to-realtors          = 8
//    visible-to-buying            = 9
//    visible-to-renters           = 10
//
//  Required Netlify env vars (same as landlord-optin.js):
//    BD_API_KEY, SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY, SES_REGION (default us-east-2)
//  Optional: BD_API_BASE (default https://www.renters.com/api/v2)
// ============================================================

const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const https = require("https");
const { URL } = require("url");
const { getStore } = require("@netlify/blobs");

const ses = new SESClient({
  region: process.env.SES_REGION || "us-east-2",
  credentials: {
    accessKeyId: process.env.SES_ACCESS_KEY_ID,
    secretAccessKey: process.env.SES_SECRET_ACCESS_KEY,
  },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v2";
const FUNCTION_VERSION = "vis5";

// The five audience tags. Keyed by the flag name the wizard sends/reads.
// tag_id values confirmed from BD Members > Tags. tag_type_id 1 = Custom Tags group.
const AUDIENCES = [
  { key: "landlords",        name: "visible-to-landlords",         tag_id: "6",  tag_type_id: "1" },
  { key: "propertyManagers", name: "visible-to-property-managers", tag_id: "7",  tag_type_id: "1" },
  { key: "realtors",         name: "visible-to-realtors",          tag_id: "8",  tag_type_id: "1" },
  { key: "buying",           name: "visible-to-buying",            tag_id: "9",  tag_type_id: "1" },
  { key: "renters",          name: "visible-to-renters",           tag_id: "10", tag_type_id: "1" },
];
const BY_KEY = {};
AUDIENCES.forEach((a) => { BY_KEY[a.key] = a; });


// Netlify Blob store holding the "findable" member-ID sets per audience.
// renter-search.js reads these to list who opted into being found by each type.
// Store name "visibility-index", one key per audience -> JSON array of member IDs.
const INDEX_STORE = "visibility-index";
function idxStore() {
  // getStore() does NOT throw on creation (only later on read/write), so a
  // try/catch fallback never fires. Pass siteID + token explicitly when present.
  var siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  var token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
  if (siteID && token) {
    return getStore({ name: INDEX_STORE, consistency: "strong", siteID: siteID, token: token });
  }
  return getStore({ name: INDEX_STORE, consistency: "strong" });
}
async function readIndex(store, key) {
  try {
    const v = await store.get(key, { type: "json" });
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}
async function writeAudienceIndex(userId, desired) {
  // For each audience, add or remove this member ID from its Blob set to mirror
  // the tag state. Best-effort: a Blob failure never blocks the tag write/UI.
  let store;
  try { store = idxStore(); } catch (e) { return { indexed: false, reason: "no-store", detail: (e && e.message) ? e.message : String(e) }; }
  const uid = String(userId);
  const summary = {};
  for (const a of AUDIENCES) {
    try {
      const key = "findable:" + a.key;
      const list = await readIndex(store, key);
      const has = list.indexOf(uid) !== -1;
      if (desired[a.key] && !has) { list.push(uid); await store.setJSON(key, list); summary[a.key] = "indexed"; }
      else if (!desired[a.key] && has) { const next = list.filter((x) => x !== uid); await store.setJSON(key, next); summary[a.key] = "de-indexed"; }
      else { summary[a.key] = "unchanged"; }
    } catch (e) { summary[a.key] = "index-error"; }
  }
  return { indexed: true, summary };
}

// Human labels for the summary email.
const LABELS = {
  landlords: "Landlords",
  propertyManagers: "Property managers",
  realtors: "Realtors",
  buying: "Home-buying opportunities",
  renters: "Other renters",
};

// --- Call the BD API with Node https (cloned verbatim from landlord-optin.js) ---
function bd(path, { method = "GET", body = null } = {}) {
  return new Promise((resolve) => {
    let urlStr = `${BD_BASE}${path}`;
    let payload = null;
    const headers = { "X-Api-Key": process.env.BD_API_KEY, "Accept": "application/json" };
    if (body) {
      payload = new URLSearchParams(body).toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }

    function doRequest(targetUrl) {
      let u;
      try { u = new URL(targetUrl); } catch (e) {
        return resolve({ ok: false, status: 0, data: null, raw: "", error: "bad url: " + targetUrl });
      }
      const options = { hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, headers };
      const req = https.request(options, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          const loc = res.headers.location;
          res.resume();
          console.log(`BD ${method} ${targetUrl} -> REDIRECT ${res.statusCode} to: ${loc}`);
          return resolve({ ok: false, status: res.statusCode, data: null, raw: "", error: `redirected to ${loc} (auth likely not accepted)` });
        }
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let data = null;
          try { data = raw ? JSON.parse(raw) : null; } catch (e) { /* non-JSON */ }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            console.log(`BD ${method} ${targetUrl} -> HTTP ${res.statusCode}; body(first 300): ${raw.slice(0, 300)}`);
          }
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data, raw });
        });
      });
      req.on("error", (e) => {
        console.log(`BD ${method} ${targetUrl} -> REQ ERROR: ${e.code || e.name}: ${e.message}`);
        resolve({ ok: false, status: 0, data: null, raw: "", error: (e.code || e.name) + ": " + e.message });
      });
      req.setTimeout(10000, () => {
        req.destroy();
        resolve({ ok: false, status: 0, data: null, raw: "", error: "timeout after 10s" });
      });
      if (payload) req.write(payload);
      req.end();
    }

    doRequest(urlStr);
  });
}

async function getMember(userId) {
  const { ok, data } = await bd(`/user/get/${encodeURIComponent(userId)}`);
  if (!ok || !data || data.status !== "success") return null;
  const arr = Array.isArray(data.message) ? data.message : [data.message];
  return arr[0] || null;
}

async function getRelationships(userId) {
  const { ok, data } = await bd(`/rel_tags/get?object_id=${encodeURIComponent(userId)}`);
  if (ok && data && Array.isArray(data.message)) return data.message;
  return [];
}

async function addTag(userId, tag, actorId) {
  const body = { tag_id: tag.tag_id, object_id: String(userId), tag_type_id: tag.tag_type_id };
  if (actorId) body.added_by = String(actorId);
  return bd(`/rel_tags/create`, { method: "POST", body });
}

async function removeRelationship(relId) {
  const attempts = [
    { method: "DELETE", path: `/rel_tags/delete`, body: { id: String(relId) } },
    { method: "DELETE", path: `/rel_tags/delete/${encodeURIComponent(relId)}`, body: null },
    { method: "DELETE", path: `/rel_tags/delete?id=${encodeURIComponent(relId)}`, body: null },
    { method: "POST",   path: `/rel_tags/delete/${encodeURIComponent(relId)}`, body: null },
  ];
  let last = null;
  for (const a of attempts) {
    const res = await bd(a.path, { method: a.method, body: a.body });
    last = { tried: a.method + " " + a.path, status: res.status, ok: res.ok };
    if (res.ok && res.data && (res.data.status === "success" || res.status === 200)) {
      return { ok: true, status: res.status, how: last.tried };
    }
  }
  return { ok: false, status: last ? last.status : 0, how: last ? last.tried : "none" };
}

function has(v) {
  return v && String(v).trim() !== "" && String(v).trim().toLowerCase() !== "unknown";
}

// Build the set of currently-attached audience keys, matching by tag ID (authoritative)
// AND by name, then falling back to the relationship table — the same asymmetry fix
// as landlord-optin v16 (some tags do not surface on the user record by name).
async function readVisibility(userId, member) {
  const on = {};
  AUDIENCES.forEach((a) => { on[a.key] = false; });

  const idToKey = {};
  const nameToKey = {};
  AUDIENCES.forEach((a) => { idToKey[String(a.tag_id)] = a.key; nameToKey[a.name] = a.key; });

  if (member && Array.isArray(member.tags)) {
    member.tags.forEach((t) => {
      if (!t) return;
      if (t.tag_name && nameToKey[t.tag_name]) on[nameToKey[t.tag_name]] = true;
      if (t.id != null && idToKey[String(t.id)]) on[idToKey[String(t.id)]] = true;
      if (t.tag_id != null && idToKey[String(t.tag_id)]) on[idToKey[String(t.tag_id)]] = true;
    });
  }

  // rel_tags fallback (authoritative for what is actually attached).
  const anyMissing = AUDIENCES.some((a) => !on[a.key]);
  if (anyMissing) {
    try {
      const rels = await getRelationships(userId);
      rels.forEach((r) => {
        if (!r || r.tag_id == null || !idToKey[String(r.tag_id)]) return;
        // vis4 GUARD: only count relationships that actually belong to THIS member.
        // BD's /rel_tags/get can return rows not scoped to object_id; without this
        // one member's tag (e.g. 3700's visible-to-landlords) bled into every read,
        // making every renter's card show landlord-on.
        if (r.object_id != null && String(r.object_id) !== String(userId)) return;
        on[idToKey[String(r.tag_id)]] = true;
      });
    } catch (e) { /* keep what we have */ }
  }
  return on;
}

// Read whether the member carries the "prequalified" income tag (id 16).
async function readIncomeConfirmed(userId, member) {
  try {
    if (member && Array.isArray(member.tags)) {
      for (var i = 0; i < member.tags.length; i++) {
        var t = member.tags[i];
        if (!t) continue;
        if (String(t.id) === "16" || String(t.tag_id) === "16" || t.tag_name === "prequalified") return true;
      }
    }
    const rels = await getRelationships(userId);
    for (var j = 0; j < rels.length; j++) {
      var r = rels[j];
      if (!r || String(r.tag_id) !== "16") continue;
      if (r.object_id != null && String(r.object_id) !== String(userId)) continue;
      return true;
    }
  } catch (e) {}
  return false;
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  // --- GET debug: forces a Blob index write + read-back so we can see the truth ---
  // /visibility?debug=write&memberId=3700&audience=landlords
  if (event.httpMethod === "GET") {
    const dq = event.queryStringParameters || {};
    if (dq.debug === "write" && dq.memberId) {
      const aud = ["landlords","propertyManagers","realtors","buying","renters"].indexOf(dq.audience) !== -1 ? dq.audience : "landlords";
      const desired = {};
      AUDIENCES.forEach((a) => { desired[a.key] = (a.key === aud); });
      let writeRes, readBack = [], storeOk = false, storeErr = "";
      try { writeRes = await writeAudienceIndex(dq.memberId, desired); }
      catch (e) { writeRes = { indexed: false, threw: (e && e.message) ? e.message : String(e) }; }
      try {
        const st = idxStore(); storeOk = true;
        const v = await st.get("findable:" + aud, { type: "json" });
        readBack = Array.isArray(v) ? v.map(String) : [];
      } catch (e) { storeErr = (e && e.message) ? e.message : String(e); }
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({
        version: FUNCTION_VERSION, debug: "write", memberId: dq.memberId, audience: aud,
        writeResult: writeRes, storeOk, storeErr, count_after: readBack.length, ids_after: readBack
      }) };
    }
    if (dq.debug === "read") {
      const aud = ["landlords","propertyManagers","realtors","buying","renters"].indexOf(dq.audience) !== -1 ? dq.audience : "landlords";
      let ids = [], storeErr = "";
      try { const st = idxStore(); const v = await st.get("findable:" + aud, { type: "json" }); ids = Array.isArray(v) ? v.map(String) : []; }
      catch (e) { storeErr = (e && e.message) ? e.message : String(e); }
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ version: FUNCTION_VERSION, debug: "read", audience: aud, count: ids.length, ids, storeErr }) };
    }
  }

  // --- GET status: wizard reads current visibility on load ---
  if (event.httpMethod === "GET") {
    const q = event.queryStringParameters || {};
    if (q.status === "1" && q.memberId) {
      const member = await getMember(q.memberId);
      const on = await readVisibility(q.memberId, member);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          version: FUNCTION_VERSION,
          memberId: q.memberId,
          landlords: on.landlords,
          propertyManagers: on.propertyManagers,
          realtors: on.realtors,
          buying: on.buying,
          renters: on.renters,
          incomeConfirmed: await readIncomeConfirmed(q.memberId, member),
        }),
      };
    }
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ version: FUNCTION_VERSION }) };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: "Method Not Allowed" };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const { memberId, flags, timestamp } = body;
  const userId = memberId;
  if (!has(userId)) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "memberId required" }) };
  }
  if (!flags || typeof flags !== "object") {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "flags object required" }) };
  }

  // Desired state per audience (coerce to bool; unknown keys ignored).
  const desired = {};
  AUDIENCES.forEach((a) => { desired[a.key] = flags[a.key] === true || flags[a.key] === "true" || flags[a.key] === 1; });

  // Read what is currently attached (one relationships read, reused for add/remove).
  let rels = [];
  try { rels = await getRelationships(userId); } catch (e) { /* proceed; add-only if read fails */ }
  const attachedIds = {};
  rels.forEach((r) => { if (r && r.tag_id != null) { (attachedIds[String(r.tag_id)] = attachedIds[String(r.tag_id)] || []).push(r); } });

  const results = {};
  for (const a of AUDIENCES) {
    const isOn = !!attachedIds[a.tag_id];
    if (desired[a.key] && !isOn) {
      const addRes = await addTag(userId, a, userId);
      results[a.key] = (addRes.ok && addRes.data && addRes.data.status === "success") ? "added" : ("add-failed:HTTP" + addRes.status);
    } else if (!desired[a.key] && isOn) {
      let removedAny = false;
      for (const r of attachedIds[a.tag_id]) {
        if (r.id) { const del = await removeRelationship(r.id); if (del.ok) removedAny = true; }
      }
      results[a.key] = removedAny ? "removed" : "remove-failed";
    } else {
      results[a.key] = "unchanged";
    }
  }

  // --- Maintain the Blob "findable" index so renter-search.js has a list to read ---
  let indexResult = { indexed: false };
  try { indexResult = await writeAudienceIndex(userId, desired); } catch (e) { /* best-effort */ }

  // --- Notify Kenny (one summary email per save; a renter becoming findable is the signal) ---
  let member = null;
  try { member = await getMember(userId); } catch (e) { /* continue */ }
  const memberName = member ? (member.full_name || `${member.first_name || ""} ${member.last_name || ""}`.trim()) : "";
  const email = member ? member.email : "";
  const location = member ? member.user_location : "";
  const verifiedFlag = member ? String(member.verified) : "";

  const onList = AUDIENCES.filter((a) => desired[a.key]).map((a) => LABELS[a.key]);
  const offList = AUDIENCES.filter((a) => !desired[a.key]).map((a) => LABELS[a.key]);

  const lines = ["A renter updated who can find them on Renters.com.", ""];
  if (has(memberName)) lines.push(`Name: ${memberName}`);
  if (has(userId))     lines.push(`Member ID: ${userId}`);
  if (has(email))      lines.push(`Email: ${email}`);
  if (has(location))   lines.push(`Location: ${location}`);
  if (verifiedFlag === "1") lines.push(`Verification: Yes (approved)`);
  lines.push("");
  lines.push(onList.length ? `Now visible to: ${onList.join(", ")}` : "Now hidden from everyone.");
  if (offList.length) lines.push(`Hidden from: ${offList.join(", ")}`);
  lines.push("");
  lines.push(`Write results: ${AUDIENCES.map((a) => a.key + "=" + results[a.key]).join(", ")}`);
  lines.push(`Time: ${timestamp || new Date().toISOString()}`);
  if (has(userId)) {
    lines.push("");
    lines.push("View in BD admin:");
    lines.push(`https://ww2.managemydirectory.com/admin/viewMembers.php?faction=view&userid=${userId}&newsite=38748`);
  }
  lines.push("");
  lines.push("---");
  lines.push("Renters.com Visibility Notification");
  const emailBody = lines.join("\n");

  const subjName = has(memberName) ? memberName : "A renter";
  const subj = onList.length ? `👁 ${subjName} is now findable (${onList.length})` : `👁 ${subjName} went hidden`;

  let emailOk = true;
  try {
    await ses.send(new SendEmailCommand({
      Source: "verify@renters.com",
      Destination: { ToAddresses: ["kenny@renters.com"] },
      Message: { Subject: { Data: subj }, Body: { Text: { Data: emailBody } } },
    }));
  } catch (err) {
    emailOk = false;
    console.log("Visibility email failed: " + err.message);
  }

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      success: true,
      version: FUNCTION_VERSION,
      memberId: userId,
      results,
      index: indexResult,
      emailSent: emailOk,
    }),
  };
};
