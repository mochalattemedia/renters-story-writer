// ============================================================
//  didit-selfie.js  ·  Retrieve the captured selfie (and ID portrait)
//  from a Didit session, so the admin review panel can compare the
//  verified face against the member's Renters.com profile photo.
//
//  Closes the gap: Didit confirms "real person + ID matches selfie,"
//  but does NOT confirm that person owns the Renters.com profile.
//  The admin eyeballs selfie vs. profile photo before granting.
//
//  GET/POST  { session_id }   (also accepts ?session_id= )
//  Returns   { selfie, idPortrait, status }
//    selfie     = signed URL to the live selfie (expires ~1hr)
//    idPortrait = signed URL to the ID document portrait (expires ~1hr)
//
//  Auth: server-side x-api-key (DIDIT_API_KEY). Never exposed to browser.
// ============================================================

const DIDIT_BASE = "https://verification.didit.me/v3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

function ok(body) {
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(body) };
}
function bad(code, msg) {
  return { statusCode: code, headers: corsHeaders, body: JSON.stringify({ error: msg }) };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };

  // Accept session_id from query or JSON body
  const q = event.queryStringParameters || {};
  let body = {};
  if (event.body) {
    try { body = JSON.parse(event.body); } catch (e) { /* ignore, may be query */ }
  }
  const sessionId = (body.session_id || q.session_id || "").trim();
  if (!sessionId) return bad(400, "session_id required");

  const apiKey = process.env.DIDIT_API_KEY;
  if (!apiKey) return bad(500, "DIDIT_API_KEY not configured");

  try {
    const resp = await fetch(DIDIT_BASE + "/session/" + encodeURIComponent(sessionId) + "/decision/", {
      method: "GET",
      headers: { "x-api-key": apiKey, "accept": "application/json" },
    });

    if (!resp.ok) {
      const t = await resp.text().catch(function () { return ""; });
      return bad(resp.status, "Didit session lookup failed: " + resp.status + " " + t.slice(0, 200));
    }

    const data = await resp.json();

    // DEBUG: dump the full raw response so we can locate the selfie/image fields.
    var dbg = (q && q.debug) || (body && body.debug);
    if (dbg) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ raw: data }, null, 2)
      };
    }

        const fm = data.face_match || {};
    const lv = data.liveness || {};
    const idv = data.id_verification || {};

    const selfie =
      fm.source_image ||
      lv.reference_image ||
      fm.user_image ||
      "";

    const idPortrait =
      idv.portrait_image ||
      fm.target_image ||
      "";

    return ok({
      status: data.status || "",
      selfie: selfie || "",
      idPortrait: idPortrait || "",
      faceMatchScore: (typeof fm.score === "number" ? fm.score : (typeof fm.confidence === "number" ? fm.confidence : null)),
      sessionId: sessionId,
    });
  } catch (e) {
    return bad(500, "selfie lookup error: " + e.message);
  }
};
