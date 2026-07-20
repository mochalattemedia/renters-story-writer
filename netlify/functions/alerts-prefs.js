// alerts-prefs.js — ap-v1
// GET  ?version=1
// GET  ?status=1&memberId=ID   -> { enabled, criteria }
// POST { memberId, enabled, criteria } -> write + read-back verify

const FN_VERSION = "ap-v1";
const BD_BASE = "https://www.renters.com/api/v1";

const HARD_KEYS = ["rent_max", "beds_min", "baths_min", "move_in_by", "zones"];
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
    body: JSON.stringify(body)
  };
}

async function bdGet(memberId) {
  const r = await fetch(BD_BASE + "/user/get/" + encodeURIComponent(memberId), {
    headers: { "Authorization": "Bearer " + process.env.BD_API_KEY }
  });
  const j = await r.json().catch(() => ({}));
  return j && j.response ? j.response : j;
}

async function bdUpdate(memberId, fields) {
  const body = Object.assign({ user_id: String(memberId) }, fields);
  const r = await fetch(BD_BASE + "/user/update", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + process.env.BD_API_KEY,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return r.json().catch(() => ({}));
}

function sanitize(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const out = {};

  out.rent_max = Number(c.rent_max) > 0 ? Math.round(Number(c.rent_max)) : null;
  out.beds_min = Number(c.beds_min) >= 0 ? Number(c.beds_min) : null;
  out.baths_min = Number(c.baths_min) >= 0 ? Number(c.baths_min) : null;
  out.move_in_by = typeof c.move_in_by === "string" ? c.move_in_by.slice(0, 10) : null;

  const wants = Array.isArray(c.wants) ? c.wants : [];
  const breakers = Array.isArray(c.deal_breakers) ? c.deal_breakers : [];
  out.wants = wants.filter(k => CHIPS.indexOf(k) !== -1).slice(0, 11);
  out.deal_breakers = breakers.filter(k => CHIPS.indexOf(k) !== -1).slice(0, 11);

  out.notes = typeof c.notes === "string" ? c.notes.slice(0, 200) : "";
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});

  const q = event.queryStringParameters || {};

  if (q.version) {
    return json(200, {
      version: FN_VERSION,
      bdApiKeyConfigured: !!process.env.BD_API_KEY,
      chips: CHIPS,
      hardKeys: HARD_KEYS
    });
  }

  if (q.status) {
    const id = (q.memberId || "").replace(/[^0-9]/g, "");
    if (!id) return json(400, { error: "memberId required" });
    try {
      const u = await bdGet(id);
      let criteria = {};
      try { criteria = JSON.parse(u.alerts_criteria || "{}"); } catch (e) { criteria = {}; }
      return json(200, {
        version: FN_VERSION,
        enabled: String(u.alerts_enabled || "0") === "1",
        criteria: criteria
      });
    } catch (e) {
      console.error(FN_VERSION, "status read fail", e.message);
      return json(502, { error: "read failed" });
    }
  }

  if (event.httpMethod !== "POST") return json(405, { error: "method" });

  let payload = {};
  try { payload = JSON.parse(event.body || "{}"); }
  catch (e) { return json(400, { error: "bad json" }); }

  const id = String(payload.memberId || "").replace(/[^0-9]/g, "");
  if (!id) return json(400, { error: "memberId required" });

  const enabled = payload.enabled ? "1" : "0";
  const criteria = sanitize(payload.criteria);
  const criteriaStr = JSON.stringify(criteria);

  const fields = {
    alerts_enabled: enabled,
    alerts_criteria: criteriaStr
  };
  if (enabled === "1") fields.alerts_consent_at = new Date().toISOString();

  try {
    await bdUpdate(id, fields);

    // READ-BACK VERIFY — BD files unknown columns into users_meta and still returns success
    const after = await bdGet(id);
    const landedEnabled = String(after.alerts_enabled || "") === enabled;
    const landedCriteria = String(after.alerts_criteria || "") === criteriaStr;
    const landed = landedEnabled && landedCriteria;

    if (!landed) {
      console.error(FN_VERSION, "WRITE DID NOT LAND", {
        memberId: id, landedEnabled, landedCriteria,
        got: String(after.alerts_criteria || "").slice(0, 120)
      });
    }

    return json(200, {
      version: FN_VERSION,
      landed: landed,
      enabled: enabled === "1",
      criteria: criteria
    });
  } catch (e) {
    console.error(FN_VERSION, "write fail", e.message);
    return json(502, { error: "write failed" });
  }
};
