// alerts-prefs.js — ap-v2
// GET  ?version=1
// GET  ?status=1&memberId=ID
// GET  ?diag=1&memberId=ID      -> full BD request/response dump, no write
// GET  ?probe=1&memberId=ID     -> writes a harmless test value, dumps everything
// POST { memberId, enabled, criteria }

const FN_VERSION = "ap-v2";
const BD_BASE = process.env.BD_API_BASE || "https://www.renters.com/api/v1";

const CHIPS = [
  "move_in_special", "pets_dog", "pets_cat", "large_dog_ok",
  "washer_dryer_in_unit", "parking", "yard", "ground_floor",
  "no_stairs", "furnished", "utilities_included"
];

function json(status, body) {
  return {
    statusCode: status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS"
    },
    body: JSON.stringify(body, null, 2)
  };
}

function authHeaders() {
  return {
    "Authorization": "Bearer " + (process.env.BD_API_KEY || ""),
    "content-type": "application/json"
  };
}

async function bdGetRaw(memberId) {
  const url = BD_BASE + "/user/get/" + encodeURIComponent(memberId);
  const r = await fetch(url, { headers: authHeaders() });
  const text = await r.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
  return { url: url, status: r.status, text: text.slice(0, 1500), parsed: parsed };
}

function unwrap(j) {
  if (!j) return {};
  if (j.response && typeof j.response === "object") return j.response;
  if (j.data && typeof j.data === "object") return j.data;
  return j;
}

async function bdUpdateRaw(memberId, fields) {
  const url = BD_BASE + "/user/update";
  const body = Object.assign({ user_id: String(memberId) }, fields);
  const r = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body)
  });
  const text = await r.text();
  return { url: url, status: r.status, sent: body, text: text.slice(0, 1500) };
}

function sanitize(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const wants = Array.isArray(c.wants) ? c.wants : [];
  const breakers = Array.isArray(c.deal_breakers) ? c.deal_breakers : [];
  return {
    rent_max: Number(c.rent_max) > 0 ? Math.round(Number(c.rent_max)) : null,
    beds_min: Number(c.beds_min) >= 0 && c.beds_min !== "" ? Number(c.beds_min) : null,
    baths_min: Number(c.baths_min) >= 0 && c.baths_min !== "" ? Number(c.baths_min) : null,
    move_in_by: typeof c.move_in_by === "string" ? c.move_in_by.slice(0, 10) : null,
    wants: wants.filter(k => CHIPS.indexOf(k) !== -1).slice(0, 11),
    deal_breakers: breakers.filter(k => CHIPS.indexOf(k) !== -1).slice(0, 11),
    notes: typeof c.notes === "string" ? c.notes.slice(0, 200) : ""
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  const q = event.queryStringParameters || {};

  if (q.version) {
    return json(200, {
      version: FN_VERSION,
      bdBase: BD_BASE,
      bdApiKeyConfigured: !!process.env.BD_API_KEY,
      bdApiKeyLength: (process.env.BD_API_KEY || "").length,
      chips: CHIPS
    });
  }

  const id = String(q.memberId || "").replace(/[^0-9]/g, "");

  // Full dump of what BD returns for this member, no write
  if (q.diag) {
    if (!id) return json(400, { error: "memberId required" });
    const raw = await bdGetRaw(id);
    const u = unwrap(raw.parsed);
    const keys = Object.keys(u || {});
    return json(200, {
      version: FN_VERSION,
      getUrl: raw.url,
      httpStatus: raw.status,
      topLevelKeys: Object.keys(raw.parsed || {}),
      unwrappedKeyCount: keys.length,
      alertsKeysPresent: keys.filter(k => k.indexOf("alert") !== -1),
      allKeys: keys,
      rawFirst1500: raw.text
    });
  }

  // Write a known test value, then read it back and show both sides
  if (q.probe) {
    if (!id) return json(400, { error: "memberId required" });
    const stamp = "probe-" + Date.now();
    const w = await bdUpdateRaw(id, { alerts_consent_at: stamp });
    const raw = await bdGetRaw(id);
    const u = unwrap(raw.parsed);
    return json(200, {
      version: FN_VERSION,
      wrote: stamp,
      updateUrl: w.url,
      updateHttpStatus: w.status,
      updateSent: w.sent,
      updateResponse: w.text,
      readBack: u.alerts_consent_at || null,
      landed: String(u.alerts_consent_at || "") === stamp,
      alertsKeysPresent: Object.keys(u || {}).filter(k => k.indexOf("alert") !== -1)
    });
  }

  if (q.status) {
    if (!id) return json(400, { error: "memberId required" });
    const raw = await bdGetRaw(id);
    const u = unwrap(raw.parsed);
    let criteria = {};
    try { criteria = JSON.parse(u.alerts_criteria || "{}"); } catch (e) { criteria = {}; }
    return json(200, {
      version: FN_VERSION,
      enabled: String(u.alerts_enabled || "0") === "1",
      criteria: criteria
    });
  }

  if (event.httpMethod !== "POST") return json(405, { error: "method" });

  let payload = {};
  try { payload = JSON.parse(event.body || "{}"); }
  catch (e) { return json(400, { error: "bad json" }); }

  const pid = String(payload.memberId || "").replace(/[^0-9]/g, "");
  if (!pid) return json(400, { error: "memberId required" });

  const enabled = payload.enabled ? "1" : "0";
  const criteria = sanitize(payload.criteria);
  const criteriaStr = JSON.stringify(criteria);

  const fields = { alerts_enabled: enabled, alerts_criteria: criteriaStr };
  if (enabled === "1") fields.alerts_consent_at = new Date().toISOString();

  const w = await bdUpdateRaw(pid, fields);
  const raw = await bdGetRaw(pid);
  const after = unwrap(raw.parsed);

  const landedEnabled = String(after.alerts_enabled || "") === enabled;
  const landedCriteria = String(after.alerts_criteria || "") === criteriaStr;
  const landed = landedEnabled && landedCriteria;

  if (!landed) {
    console.error(FN_VERSION, "WRITE DID NOT LAND", {
      memberId: pid,
      updateHttpStatus: w.status,
      updateResponse: w.text.slice(0, 300),
      landedEnabled: landedEnabled,
      landedCriteria: landedCriteria,
      readBackCriteria: String(after.alerts_criteria || "").slice(0, 200)
    });
  }

  return json(200, {
    version: FN_VERSION,
    landed: landed,
    enabled: enabled === "1",
    criteria: criteria,
    debug: landed ? undefined : {
      updateHttpStatus: w.status,
      updateResponse: w.text.slice(0, 400),
      landedEnabled: landedEnabled,
      landedCriteria: landedCriteria,
      readBackCriteria: String(after.alerts_criteria || "").slice(0, 200),
      alertsKeysPresent: Object.keys(after || {}).filter(k => k.indexOf("alert") !== -1)
    }
  });
};
