// ============================================================
// verified-probe.js   vp-v1
// DISCOVERY ONLY. Answers one question: can the BD verified
// flag be set server-side with BD_API_KEY via /user/update?
// Delete this function once the answer is recorded.
//
// Endpoints (all except ?version=1 need &key=ADMIN_PROBE_KEY):
//   ?version=1
//   ?read=1&memberId=NNNN&key=K
//   ?keys=1&memberId=NNNN&key=K
//   ?set=1&memberId=NNNN&value=1&confirm=1&key=K[&field=verified]
// ============================================================

const FN_VERSION = "vp-v1";
const BD_API_BASE = "https://www.renters.com/api/v2";

function reply(code, obj) {
  return {
    statusCode: code,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(Object.assign({ _v: FN_VERSION }, obj), null, 2)
  };
}

function norm(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "y") return "1";
  if (s === "0" || s === "false" || s === "no" || s === "n" || s === "") return "0";
  return s;
}

async function bdGetMember(id, key) {
  const url = BD_API_BASE + "/user/get/" + encodeURIComponent(id);
  const res = await fetch(url, {
    method: "GET",
    headers: { "X-Api-Key": key, Accept: "application/json" },
    redirect: "manual"
  });
  if (res.status >= 300 && res.status < 400) {
    return { ok: false, reason: "redirect", status: res.status, location: res.headers.get("location") || null };
  }
  const text = await res.text();
  if (res.status !== 200) {
    return { ok: false, reason: "http", status: res.status, body: text.slice(0, 400) };
  }
  let data;
  try { data = JSON.parse(text); }
  catch (e) { return { ok: false, reason: "not-json", status: res.status, body: text.slice(0, 400) }; }
  const rec = data && data.message && Array.isArray(data.message) ? data.message[0] : null;
  if (!rec) return { ok: false, reason: "no-record", status: res.status, body: text.slice(0, 400) };
  return { ok: true, record: rec };
}

async function bdUpdate(id, field, value, key) {
  const body = new URLSearchParams();
  body.set("user_id", String(id));
  body.set(field, String(value));
  const url = BD_API_BASE + "/user/update";
  const headers = {
    "X-Api-Key": key,
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json"
  };
  const attempts = [];

  let res = await fetch(url, { method: "PUT", headers, body: body.toString(), redirect: "manual" });
  let text = await res.text();
  attempts.push({ method: "PUT", status: res.status, redirected: res.status >= 300 && res.status < 400, body: text.slice(0, 300) });

  if (res.status === 405) {
    res = await fetch(url, { method: "POST", headers, body: body.toString(), redirect: "manual" });
    text = await res.text();
    attempts.push({ method: "POST", status: res.status, redirected: res.status >= 300 && res.status < 400, body: text.slice(0, 300) });
  }

  const last = attempts[attempts.length - 1];
  return { accepted: last.status === 200, methodUsed: last.method, attempts: attempts };
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const bdKey = process.env.BD_API_KEY || "";
  const adminKey = process.env.ADMIN_PROBE_KEY || "";

  if (q.version === "1") {
    return reply(200, {
      ok: true,
      bdKeyConfigured: !!bdKey,
      adminKeyConfigured: !!adminKey,
      apiBase: BD_API_BASE
    });
  }

  if (!adminKey) return reply(500, { error: "ADMIN_PROBE_KEY not set" });
  if (q.key !== adminKey) return reply(401, { error: "bad or missing key" });
  if (!bdKey) return reply(500, { error: "BD_API_KEY not set" });

  const memberId = (q.memberId || "").replace(/[^0-9]/g, "");
  if (!memberId) return reply(400, { error: "memberId required" });

  // ---------- READ ----------
  if (q.read === "1" || q.keys === "1") {
    const got = await bdGetMember(memberId, bdKey);
    if (!got.ok) return reply(502, { error: "bd read failed", detail: got });

    const rec = got.record;
    const verifyish = {};
    Object.keys(rec).forEach(function (k) {
      if (k.toLowerCase().indexOf("verif") !== -1) verifyish[k] = rec[k];
    });

    if (q.keys === "1") {
      // key NAMES only, so this never dumps PII into a log
      return reply(200, {
        memberId: memberId,
        keyCount: Object.keys(rec).length,
        keyNames: Object.keys(rec).sort(),
        verifyishFields: verifyish
      });
    }

    return reply(200, {
      memberId: memberId,
      verifiedRaw: rec.verified === undefined ? "(key absent)" : rec.verified,
      verifiedType: typeof rec.verified,
      verifiedNormalized: norm(rec.verified),
      verifyishFields: verifyish,
      note: "BD omits empty custom fields entirely, so an absent key means empty OR nonexistent."
    });
  }

  // ---------- SET ----------
  if (q.set === "1") {
    if (q.confirm !== "1") return reply(400, { error: "add &confirm=1 to write" });

    const field = (q.field || "verified").replace(/[^a-z0-9_]/gi, "");
    const want = norm(q.value);
    if (want !== "1" && want !== "0") return reply(400, { error: "value must be 1 or 0" });

    const before = await bdGetMember(memberId, bdKey);
    if (!before.ok) return reply(502, { error: "bd read failed before write", detail: before });
    const beforeVal = before.record[field];

    const wrote = await bdUpdate(memberId, field, want, bdKey);

    await new Promise(function (r) { setTimeout(r, 900); });

    const after = await bdGetMember(memberId, bdKey);
    if (!after.ok) return reply(502, { error: "bd read failed after write", write: wrote, detail: after });
    const afterVal = after.record[field];

    const landed = norm(afterVal) === want;
    const moved = norm(beforeVal) !== norm(afterVal);

    return reply(200, {
      memberId: memberId,
      field: field,
      requested: want,
      before: beforeVal === undefined ? "(key absent)" : beforeVal,
      after: afterVal === undefined ? "(key absent)" : afterVal,
      accepted: wrote.accepted,
      methodUsed: wrote.methodUsed,
      attempts: wrote.attempts,
      landed: landed,
      valueMoved: moved,
      verdict: landed
        ? "COLUMN LANDED. Now confirm the badge visually in BD before trusting it."
        : (wrote.accepted
            ? "ACCEPTED BUT DID NOT LAND. Classic users_meta filing, the column name is wrong or guarded."
            : "REJECTED. Check the BD key has PUT on Users users_data."),
      restore: "?set=1&memberId=" + memberId + "&value=" + (want === "1" ? "0" : "1") + "&confirm=1&key=..."
    });
  }

  return reply(400, { error: "no action. use ?version=1, ?read=1, ?keys=1 or ?set=1" });
};
