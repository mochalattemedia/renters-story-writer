// ============================================================
//  landlord-optin.js   ·   VERSION: v8  (2026-06-26, member read CONFIRMED working)
//  Browser tests:
//    <function-url>?diag=1         -> probe BD API auth
//    <function-url>?testtag=out    -> write opted-out tag to member 3650 + show tags
//  If output shows "version":"v8", you have THIS file deployed.
// ============================================================
// landlord-optin.js
// Receives a landlord's opt-in/opt-out matching choice from the dashboard wizard.
// 1. Reads the member's full record from the Brilliant Directories (BD) API.
// 2. Resolves the matching-opted-in / matching-opted-out tag IDs by name.
// 3. Writes the chosen tag to the member (and removes the opposite tag if present — handles "change").
// 4. Emails Kenny a notification (enriched with real member data), marked initial vs. change.
//
// Required Netlify env vars:
//   BD_API_KEY            - Brilliant Directories API key (X-Api-Key header)
//   SES_ACCESS_KEY_ID     - AWS SES access key (already set)
//   SES_SECRET_ACCESS_KEY - AWS SES secret (already set)
//   SES_REGION            - defaults to us-east-2
// Optional:
//   BD_API_BASE           - defaults to https://ww2.managemydirectory.com/api/v2

const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");

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

const BD_BASE = process.env.BD_API_BASE || "https://ww2.managemydirectory.com/api/v2";
const FUNCTION_VERSION = "v8";

// Tag names we manage. IDs are resolved at runtime by name, but we keep
// confirmed known IDs as a fallback so a write can never fail on resolution.
//   matching-opted-in  = tag id 1  (confirmed via API user record)
//   matching-opted-out = tag id 2  (confirmed via admin form capture)
//   both live in tag group/type 1
const TAG_IN = "matching-opted-in";
const TAG_OUT = "matching-opted-out";
const KNOWN_TAGS = {
  "matching-opted-in":  { tag_id: "1", tag_type_id: "1" },
  "matching-opted-out": { tag_id: "2", tag_type_id: "1" },
};

const https = require("https");
const { URL } = require("url");

// --- Small helper: call the BD API using Node's built-in https (no fetch dependency) ---
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

    function doRequest(targetUrl, redirectsLeft) {
      let u;
      try { u = new URL(targetUrl); } catch (e) {
        return resolve({ ok: false, status: 0, data: null, raw: "", error: "bad url: " + targetUrl });
      }
      const options = {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method,
        headers,
      };
      const req = https.request(options, (res) => {
        // If the API redirects, DON'T blindly follow into the admin dashboard.
        // A redirect here usually means auth was not accepted. Report it clearly.
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          const loc = res.headers.location;
          res.resume();
          console.log(`BD ${method} ${targetUrl} -> REDIRECT ${res.statusCode} to: ${loc}`);
          return resolve({
            ok: false,
            status: res.statusCode,
            data: null,
            raw: "",
            error: `redirected to ${loc} (auth likely not accepted)`,
          });
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

    doRequest(urlStr, 5);
  });
}

// --- Read a member's full record ---
async function getMember(userId) {
  const { ok, data } = await bd(`/user/get/${encodeURIComponent(userId)}`);
  if (!ok || !data || data.status !== "success") return null;
  // The API returns message as an array with one member object.
  const arr = Array.isArray(data.message) ? data.message : [data.message];
  return arr[0] || null;
}

// --- Resolve a tag's numeric id + group/type id by its name ---
// We read the full tag list and match on tag_name.
async function resolveTags() {
  // Start from confirmed known IDs so resolution can never come back empty.
  const map = { ...KNOWN_TAGS };
  // Try the live list endpoint to pick up the true IDs (in case they ever change).
  try {
    const { ok, data } = await bd(`/tags/get`);
    if (ok && data && Array.isArray(data.message)) {
      for (const t of data.message) {
        if (t && t.tag_name) {
          map[t.tag_name] = {
            tag_id: String(t.id),
            tag_type_id: String(t.group_tag_id || t.tag_type_id || "1"),
          };
        }
      }
    }
  } catch (e) { /* fall back to KNOWN_TAGS */ }
  return map;
}

// --- Find an existing tag relationship on the member for a given tag_id ---
// member.tags is an array of { id, tag_name, group_tag_id, ... } where `id` is the TAG id,
// not the relationship id. To delete a relationship we need the rel_tags row id, which the
// member payload may not expose. We therefore look it up via rel_tags filtered by object_id.
async function getRelationships(userId) {
  // Best effort: read tag relationships for this object. If the endpoint shape differs,
  // we degrade gracefully (no delete, just add).
  const { ok, data } = await bd(`/rel_tags/get?object_id=${encodeURIComponent(userId)}`);
  if (ok && data && Array.isArray(data.message)) return data.message;
  return [];
}

// --- Create a tag relationship (attach tag to member) ---
async function addTag(userId, tag, actorId) {
  const body = {
    tag_id: tag.tag_id,
    object_id: String(userId),
    tag_type_id: tag.tag_type_id,
  };
  if (actorId) body.added_by = String(actorId);
  return bd(`/rel_tags/create`, { method: "POST", body });
}

// --- Delete a tag relationship by its relationship row id ---
async function removeRelationship(relId) {
  return bd(`/rel_tags/delete`, { method: "POST", body: { id: String(relId) } });
}

// --- Has the member submitted the verify_business form? ---
async function hasSubmittedVerification(userId) {
  const { ok, data } = await bd(
    `/user_submitted_forms/get?user_id=${encodeURIComponent(userId)}`
  );
  if (!ok || !data || !Array.isArray(data.message)) return null; // unknown
  return data.message.some((f) => {
    const name = (f.form_name || f.formname || f.form || "").toLowerCase();
    return name.includes("verify");
  });
}

function has(v) {
  return v && String(v).trim() !== "" && String(v).trim().toLowerCase() !== "unknown";
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  // --- GET diagnostic: visit ...?diag=1 in a browser to probe BD API auth ---
  if (event.httpMethod === "GET") {
    const q = event.queryStringParameters || {};
    if (q.diag === "1") {
      const verify = await bd(`/token/verify`);
      const userRead = await bd(`/user/get/3650`);
      return {
        statusCode: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          version: FUNCTION_VERSION,
          keyPresent: !!process.env.BD_API_KEY,
          keyLength: (process.env.BD_API_KEY || "").length,
          base: BD_BASE,
          tokenVerify: { ok: verify.ok, status: verify.status, error: verify.error || null, rawHead: (verify.raw || "").slice(0, 300) },
          userGet: { ok: userRead.ok, status: userRead.status, error: userRead.error || null, rawHead: (userRead.raw || "").slice(0, 300) },
        }, null, 2),
      };
    }
    // ...?testtag=out  or  ?testtag=in  -> writes that tag to member 3650 and reports result
    if (q.testtag === "out" || q.testtag === "in") {
      const testUser = q.user || "3650";
      const tagName = q.testtag === "in" ? TAG_IN : TAG_OUT;
      const tag = KNOWN_TAGS[tagName];
      const addRes = await addTag(testUser, tag, testUser);
      const after = await bd(`/user/get/${encodeURIComponent(testUser)}`);
      let currentTags = [];
      try {
        const m = Array.isArray(after.data && after.data.message) ? after.data.message[0] : null;
        if (m && Array.isArray(m.tags)) currentTags = m.tags.map((t) => `${t.id}:${t.tag_name}`);
      } catch (e) { /* ignore */ }
      return {
        statusCode: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          version: FUNCTION_VERSION,
          testUser,
          wrote: tagName,
          writeStatus: addRes.status,
          writeOk: addRes.ok && addRes.data && addRes.data.status === "success",
          writeResponse: (addRes.raw || "").slice(0, 300),
          tagsNow: currentTags,
        }, null, 2),
      };
    }
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ version: FUNCTION_VERSION, hint: "add ?diag=1 to probe auth, or ?testtag=out to test a tag write" }) };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: "Method Not Allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  // --- DIAGNOSTIC MODE: send { "diag": true } to probe the BD API directly ---
  if (body && body.diag) {
    const verify = await bd(`/token/verify`);
    const userRead = await bd(`/user/get/3650`);
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        version: FUNCTION_VERSION,
        keyPresent: !!process.env.BD_API_KEY,
        keyLength: (process.env.BD_API_KEY || "").length,
        base: BD_BASE,
        tokenVerify: { ok: verify.ok, status: verify.status, error: verify.error || null, rawHead: (verify.raw || "").slice(0, 200) },
        userGet: { ok: userRead.ok, status: userRead.status, error: userRead.error || null, rawHead: (userRead.raw || "").slice(0, 200) },
      }),
    };
  }

  // opt: "match" / "in"  => opted IN ; anything else => opted OUT
  const { opt, memberId, isChange, timestamp } = body;
  const userId = memberId;
  if (!has(userId)) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "memberId required" }) };
  }

  const optedIn = opt === "match" || opt === "in" || opt === "opted-in";
  const wantTagName = optedIn ? TAG_IN : TAG_OUT;
  const dropTagName = optedIn ? TAG_OUT : TAG_IN;

  // Read member (for email enrichment + verified status).
  let member = null;
  try { member = await getMember(userId); } catch (e) { /* continue */ }

  // Resolve tag IDs by name.
  let tagWriteResult = { ok: false, status: 0, note: "" };
  try {
    const tags = await resolveTags();
    const wantTag = tags[wantTagName];

    if (wantTag && wantTag.tag_id) {
      // If this is a change, remove the opposite relationship first.
      if (isChange) {
        try {
          const rels = await getRelationships(userId);
          const dropTag = tags[dropTagName];
          if (dropTag) {
            const toDrop = rels.filter(
              (r) => String(r.tag_id) === String(dropTag.tag_id)
            );
            for (const r of toDrop) {
              if (r.id) await removeRelationship(r.id);
            }
          }
        } catch (e) { /* non-fatal: still add the new tag */ }
      }

      const addRes = await addTag(userId, wantTag, userId);
      tagWriteResult = {
        ok: addRes.ok && addRes.data && addRes.data.status === "success",
        status: addRes.status,
        note: addRes.ok ? "tag written" : "tag write failed: HTTP " + addRes.status + (addRes.error ? " " + addRes.error : "") + (addRes.raw ? " | " + String(addRes.raw).slice(0, 200) : ""),
      };
    } else {
      tagWriteResult = { ok: false, status: 0, note: `tag "${wantTagName}" not found in library` };
    }
  } catch (e) {
    tagWriteResult = { ok: false, status: 0, note: "tag write error: " + e.name + ": " + e.message + (e.cause ? " | cause: " + (e.cause.code || e.cause.message || e.cause) : "") };
  }

  // Verification status: prefer live "verified" flag; note submission too.
  let submitted = null;
  try { submitted = await hasSubmittedVerification(userId); } catch (e) { /* unknown */ }

  // --- Build enriched values from the member record ---
  const memberName = member ? (member.full_name || `${member.first_name || ""} ${member.last_name || ""}`.trim()) : "";
  const email = member ? member.email : "";
  const phone = member ? member.phone_number : "";
  const location = member ? member.user_location : "";
  const plan = member && member.subscription_schema ? member.subscription_schema.subscription_name
    : (member ? member.subscription_name : "");
  const verifiedFlag = member ? String(member.verified) : "";
  let verifiedText = "";
  if (verifiedFlag === "1") verifiedText = "Yes (approved)";
  else if (submitted === true) verifiedText = "Submitted, pending review";
  else if (verifiedFlag === "0") verifiedText = "Not verified";

  const optLabel = optedIn
    ? "Opted INTO matching — placement fee applies on success"
    : "Opted OUT of matching — listing freely, no placement fee";

  // --- Compose email (skip empty fields) ---
  const verb = isChange ? "CHANGED their matching preference" : "completed onboarding";
  const lines = [`Landlord ${verb} on Renters.com.`, ""];
  if (has(memberName)) lines.push(`Name: ${memberName}`);
  if (has(userId))     lines.push(`Member ID: ${userId}`);
  if (has(plan))       lines.push(`Plan: ${plan}`);
  if (has(email))      lines.push(`Email: ${email}`);
  if (has(phone))      lines.push(`Phone: ${phone}`);
  if (has(location))   lines.push(`Location: ${location}`);
  if (has(verifiedText)) lines.push(`Verification: ${verifiedText}`);
  lines.push(`Choice: ${optLabel}`);
  lines.push(`Tag write: ${tagWriteResult.ok ? "OK" : "FAILED — " + tagWriteResult.note}`);
  lines.push(`Time: ${timestamp || new Date().toISOString()}`);
  if (has(userId)) {
    lines.push("");
    lines.push("View in BD admin:");
    lines.push(`https://ww2.managemydirectory.com/admin/viewMembers.php?faction=view&userid=${userId}&newsite=38748`);
  }
  lines.push("");
  lines.push("---");
  lines.push("Renters.com Landlord Matching Notification");
  const emailBody = lines.join("\n");

  const subjectName = has(memberName) ? memberName : "New landlord";
  const subjectVerb = isChange
    ? (optedIn ? "CHANGED → opted INTO matching" : "CHANGED → opted OUT")
    : (optedIn ? "opted INTO matching" : "listed freely");

  try {
    await ses.send(new SendEmailCommand({
      Source: "verify@renters.com",
      Destination: { ToAddresses: ["kenny@renters.com"] },
      Message: {
        Subject: { Data: `🏠 ${subjectName} ${subjectVerb}` },
        Body: { Text: { Data: emailBody } },
      },
    }));
  } catch (err) {
    // Email failed, but the tag may have been written. Report both states.
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Email failed",
        details: err.message,
        tagWritten: tagWriteResult.ok,
      }),
    };
  }

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      success: true,
      version: FUNCTION_VERSION,
      tagWritten: tagWriteResult.ok,
      tagNote: tagWriteResult.note,
      verified: verifiedText || "unknown",
    }),
  };
};
