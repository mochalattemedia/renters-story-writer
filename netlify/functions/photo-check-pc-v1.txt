// pc-v1   <-- PASTE CHECK: this is the version. Must match ?version=1
// =====================================================================
// RENTERS.COM - PHOTO CHECK  ·  photo-check.js
// =====================================================================
// Looks at a listing's photos and reports what a reviewer would notice:
// what each photo shows, whether it is usable, whether the set covers the
// property, and whether the photos plausibly come from the SAME home.
//
// WHY SET CONSISTENCY IS THE INTERESTING CHECK.
//   The obvious idea is to compare the exterior photo against Street View at
//   the listing's coordinates. That catches someone who lifted an entire
//   listing, address included. It does NOT catch the pattern that actually
//   matters: a real address with borrowed interior photos. The exterior
//   matches perfectly, because it IS the building.
//   What does catch it is asking whether the photos agree with EACH OTHER.
//   Flooring, trim, door hardware, window style, switch plates, ceiling
//   height and light temperature are consistent within one home and rarely
//   consistent across three scraped listings. No reference image needed.
//
// WHAT THIS IS NOT.
//   It is not a verdict and must never be wired to auto-reject. A renovation,
//   a seasonal change, a genuinely mixed-age house, or a duplex with two
//   finished styles will all read as inconsistent. Output is for a human
//   review queue. "Our AI rejected your photo" on a legitimate listing loses
//   a property manager permanently; a flag that a person looks at does not.
//
// ENV: ANTHROPIC_API_KEY. Optional PC_MODEL to override the model.
//
// CALL:
//   POST /.netlify/functions/photo-check
//   { "photos": [ { "name": "...", "media_type": "image/jpeg", "data": "<base64>" } ],
//     "facts": { "location": "...", "beds": "2", "baths": "1", "ptype": "House" } }
//   -> { "photos":[{name,shows,issues,note}], "coverage":{...},
//        "consistency":{"consistent":bool,"confidence":"low|medium|high","note":"..."},
//        "summary":"...", "version":"pc-v1" }
//
// Send DOWNSCALED images. The caller resizes to roughly 800px before
// encoding; full-size photos are slow, expensive, and add nothing here.
//
// CHANGELOG
//   pc-v1  2026-07-23  First build. Per-photo quality and subject, set
//                      coverage, and same-property consistency.
// =====================================================================

const PC_VERSION = "pc-v1";
const MODEL = process.env.PC_MODEL || "claude-sonnet-5";
const MAX_PHOTOS = 10;

const SYSTEM = [
  "You review photographs submitted for a rental listing.",
  "",
  "FOR EACH PHOTO, report:",
  "  shows  - one of: exterior, street, kitchen, bathroom, bedroom, living,",
  "           dining, laundry, garage, yard, hallway, basement, amenity,",
  "           floorplan, other, not-a-property",
  "  issues - any of: blurry, dark, overexposed, low-resolution, watermark,",
  "           text-overlay, screenshot, heavily-edited, obstructed, clutter,",
  "           person-visible, duplicate-of-another",
  "           Use an empty array when the photo is fine. Do not invent issues",
  "           to seem thorough. A plain, slightly imperfect photo of a room is",
  "           a usable photo.",
  "  note   - one short plain sentence, only when something needs saying.",
  "",
  "FLAG watermark or text-overlay when another company's branding, a phone",
  "number, an agent name or a site logo appears. That usually means the photo",
  "came from somewhere else.",
  "FLAG person-visible when a face or a full person is identifiable. Rental",
  "photos should not include people.",
  "",
  "SET CONSISTENCY - THE IMPORTANT ONE.",
  "Judge whether these photos plausibly come from the SAME property. Look at",
  "flooring continuity, trim and door style, hardware, switch and outlet",
  "plates, window style, ceiling height, wall colour, and light temperature.",
  "Interiors from one home agree with each other in these details. A set",
  "assembled from several different listings usually does not.",
  "BE CAREFUL AND SAY SO WHEN UNSURE. Renovations, a room finished later, a",
  "duplex, a basement apartment, or photos taken years apart can all look",
  "inconsistent and be perfectly honest. Report confidence as low unless the",
  "disagreement is obvious and structural.",
  "Never accuse anyone. Describe what does not match and let a person judge.",
  "",
  "COVERAGE. Report which of these the set includes: exterior, kitchen,",
  "bathroom, bedroom, living. Note anything a renter would expect and is",
  "missing.",
  "",
  "OUTPUT. Return ONLY a JSON object, no preamble, no code fences:",
  '{"photos":[{"name":"...","shows":"...","issues":[],"note":""}],',
  ' "coverage":{"exterior":true,"kitchen":false,"bathroom":true,"bedroom":true,',
  '             "living":false,"missing":["kitchen","living"]},',
  ' "consistency":{"consistent":true,"confidence":"low","note":"..."},',
  ' "summary":"one or two plain sentences for the person who uploaded these"}',
  "The summary is read by a property manager, not an engineer. Say what to fix."
].join("\n");

exports.handler = async function (event) {
  const qs = (event && event.queryStringParameters) || {};

  if (qs.version === "1") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ version: PC_VERSION, model: MODEL, maxPhotos: MAX_PHOTOS,
                             keyPresent: !!process.env.ANTHROPIC_API_KEY })
    };
  }

  const CORS = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "POST only" }) };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "ANTHROPIC_API_KEY is not set on this site" }) };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "body must be JSON" }) }; }

  const photos = Array.isArray(body.photos) ? body.photos.slice(0, MAX_PHOTOS) : [];
  if (!photos.length) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "no photos supplied" }) };
  }

  const facts = body.facts || {};
  const content = [];
  const names = [];

  photos.forEach((p, i) => {
    if (!p || !p.data) return;
    names.push(p.name || ("photo " + (i + 1)));
    content.push({ type: "text", text: "Photo " + (i + 1) + ": " + (p.name || "(unnamed)") });
    content.push({
      type: "image",
      source: { type: "base64", media_type: p.media_type || "image/jpeg", data: p.data }
    });
  });

  if (!content.length) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "no usable image data" }) };
  }

  const ctx = [];
  if (facts.location) ctx.push("Address: " + facts.location);
  if (facts.ptype) ctx.push("Property type: " + facts.ptype);
  if (facts.beds) ctx.push("Bedrooms: " + facts.beds);
  if (facts.baths) ctx.push("Bathrooms: " + facts.baths);

  content.push({
    type: "text",
    text: [
      "",
      "THE LISTING THESE BELONG TO:",
      ctx.length ? ctx.join("\n") : "(no details supplied)",
      "",
      "Review all " + names.length + " photos. Return the JSON object described in your instructions,",
      "using these exact names in order: " + names.join(" | ")
    ].join("\n")
  });

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: SYSTEM,
        messages: [{ role: "user", content: content }]
      })
    });

    if (!res.ok) {
      const t = await res.text();
      return {
        statusCode: 502, headers: CORS,
        body: JSON.stringify({ error: "model call failed", status: res.status, detail: t.slice(0, 300) })
      };
    }

    const data = await res.json();
    const text = (data.content || [])
      .filter(b => b && b.type === "text")
      .map(b => b.text)
      .join("\n")
      .replace(/```json/g, "").replace(/```/g, "").trim();

    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) {}
    if (!parsed) {
      return {
        statusCode: 200, headers: CORS,
        body: JSON.stringify({ shape: "unparsed", summary: text.slice(0, 600), photos: [], version: PC_VERSION })
      };
    }

    parsed.version = PC_VERSION;
    return { statusCode: 200, headers: CORS, body: JSON.stringify(parsed) };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: String(e).slice(0, 300) }) };
  }
};
