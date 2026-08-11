// ============================================================
// verify-grant.js   vg-v1
// Server-side BD verified flag, no admin session required.
// Proven Aug 10 2026 on member 23: PUT /user/update with
// user_id + verified lands the column and the badge renders.
//
// This function ONLY flips the flag. It does not email, does
// not write the verify-log timeline, does not judge. Callers
// decide, this executes.
//
// Endpoints (all except ?version=1 need key=ADMIN_PROBE_KEY):
//   ?version=1
//   ?status=1&memberId=NNNN&key=K
//   ?grant=1&memberId=NNNN&key=K
//   ?revoke=1&memberId=NNNN&key=K
// GET or POST both work. POST body may carry memberId + key.
// ============================================================

const FN_VERSION = "vg-v1";
const BD_API_BASE = "https://www.renters.com/api/v2";
const FIELD = "verified";
const READBACK_DELAY_MS = 900;

function reply(code, obj) {
  return {
    statusCode: code,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
    },
    body: JSON.stringify(Object.assign({ _v: FN_VERSION }, obj), null, 2)
  };
}

// BD stores "1" / "0" as strings. Normalise anything else it may hand back.
function norm(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "y") return "1";
  if (s === "0" || s === "false" || s === "no" || s === "n" || s === "") return "0";
  return s;
}

async function bdGetMember(id, key) {
  const url = BD_API_BASE + "/user/get/" + encodeURIComponent(id);
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { "X-Api-Key": key, Accept: "application/json" },
      redirect: "manual"
    });
  } catch (e) {
    return { ok: false, reason: "network", detail: String(e && e.message ? e.message : e) };
  }
  // BD redirects to the admin dashboard when auth is NOT accepted.
  // Never follow it. Following turns an auth failure into a confusing HTML 200.
  if (res.status >= 300 && res.status < 400) {
    return { ok: false, reason: "auth-redirect", status: res.status, location: res.headers.get("location") || null };
  }
  const text = await res.text();
  if (res.status !== 200) {
    return { ok: false, reason: "http", status: res.status, body: text.slice(0, 300) };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: "not-json", status: res.status, body: text.slice(0, 300) };
  }
  const rec = data && data.message && Array.isArray(data.message) ? data.message[0] : null;
  if (!rec) return { ok: false, reason: "no-record", status: res.status, body: text.slice(0, 300) };
  return { ok: true, record: rec };
}

async function bdSetVerified(id, want, key) {
  const body = new URLSearchParams();
  body.set("user_id", String(id));
  body.set(FIELD, String(want));

  const headers = {
    "X-Api-Key": key,
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json"
  };
  const url = BD_API_BASE + "/user/update";
  const attempts = [];

  let res, text;
  try {
    res = await fetch(url, { method: "PUT", headers, body: body.toString(), redirect: "manual" });
    text = await res.text();
  } catch (e) {
    return { accepted: false, methodUsed: null, attempts: [{ method: "PUT", error: String(e && e.message ? e.message : e) }] };
  }
  attempts.push({
    method: "PUT",
    status: res.status,
    redirected: res.status >= 300 && res.status < 400
  });

  // PUT is the proven method. POST retry kept only as a documented fallback.
  if (res.status === 405) {
    try {
      res = await fetch(url, { method: "POST", headers, body: body.toString(), redirect: "manual" });
      text = await res.text();
      attempts.push({
        method: "POST",
        status: res.status,
        redirected: res.status >= 300 && res.status < 400
      });
    } catch (e) {
      attempts.push({ method: "POST", error: String(e && e.message ? e.message : e) });
    }
  }

  const last = attempts[attempts.length - 1];
  const redirected = last && last.redirected === true;
  return {
    accepted: !!last && last.status === 200 && !redirected,
    methodUsed: last ? last.method : null,
    attempts: attempts
  };
}

async function applyFlag(memberId, want, bdKey) {
  const before = await bdGetMember(memberId, bdKey);
  if (!before.ok) {
    return reply(502, { error: "member read failed before write", memberId: memberId, detail: before });
  }
  const beforeVal = norm(before.record[FIELD]);

  // Idempotent. Already at target means no write at all.
  if (beforeVal === want) {
    return reply(200, {
      memberId: memberId,
      requested: want,
      before: beforeVal,
      after: beforeVal,
      landed: true,
      wrote: false,
      noop: true,
      verified: want === "1",
      message: want === "1" ? "already granted" : "already not verified"
    });
  }

  const wrote = await bdSetVerified(memberId, want, bdKey);

  await new Promise(function (r) { setTimeout(r, READBACK_DELAY_MS); });

  const after = await bdGetMember(memberId, bdKey);
  if (!after.ok) {
    return reply(502, {
      error: "member read failed after write, state unconfirmed",
      memberId: memberId,
      write: wrote,
      detail: after
    });
  }
  const afterVal = norm(after.record[FIELD]);
  const landed = afterVal === want;

  // BD accepts any column name and silently files unknown ones in
  // users_meta while returning success. A 200 is not proof. Read-back is.
  if (!landed) {
    return reply(502, {
      error: "write did not land",
      memberId: memberId,
      requested: want,
      before: beforeVal,
      after: afterVal,
      accepted: wrote.accepted,
      attempts: wrote.attempts,
      landed: false,
      wrote: true,
      hint: wrote.accepted
        ? "BD returned success but the column did not move. users_meta filing, or the flag is guarded."
        : "BD refused the write. Check the API key has PUT on Users users_data."
    });
  }

  return reply(200, {
    memberId: memberId,
    requested: want,
    before: beforeVal,
    after: afterVal,
    landed: true,
    wrote: true,
    noop: false,
    verified: want === "1",
    methodUsed: wrote.methodUsed,
    message: want === "1" ? "badge granted" : "badge removed"
  });
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return reply(200, { ok: true });

  const q = Object.assign({}, event.queryStringParameters || {});

  // Allow a POST body to carry the same params, so the approve page
  // never has to put the admin key in a URL a browser will keep.
  if (event.body) {
    try {
      const parsed = JSON.parse(event.body);
      Object.keys(parsed || {}).forEach(function (k) {
        if (q[k] === undefined) q[k] = parsed[k];
      });
    } catch (e) {
      // not JSON, ignore
    }
  }

  const bdKey = process.env.BD_API_KEY || "";
  const adminKey = process.env.ADMIN_PROBE_KEY || "";

  if (q.version === "1") {
    return reply(200, {
      ok: true,
      bdKeyConfigured: !!bdKey,
      adminKeyConfigured: !!adminKey,
      apiBase: BD_API_BASE,
      field: FIELD
    });
  }

  if (!adminKey) return reply(500, { error: "ADMIN_PROBE_KEY not set" });
  if (q.key !== adminKey) return reply(401, { error: "bad or missing key" });
  if (!bdKey) return reply(500, { error: "BD_API_KEY not set" });

  const memberId = String(q.memberId || "").replace(/[^0-9]/g, "");
  if (!memberId) return reply(400, { error: "memberId required" });

  if (q.status === "1") {
    const got = await bdGetMember(memberId, bdKey);
    if (!got.ok) return reply(502, { error: "member read failed", memberId: memberId, detail: got });
    const val = norm(got.record[FIELD]);
    return reply(200, {
      memberId: memberId,
      verified: val === "1",
      raw: got.record[FIELD] === undefined ? null : got.record[FIELD]
    });
  }

  if (q.grant === "1") return await applyFlag(memberId, "1", bdKey);
  if (q.revoke === "1") return await applyFlag(memberId, "0", bdKey);

  return reply(400, { error: "no action. use ?version=1, ?status=1, ?grant=1 or ?revoke=1" });
};
