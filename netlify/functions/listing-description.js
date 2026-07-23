// ld-v2   <-- PASTE CHECK: this is the version. Must match ?version=1
// =====================================================================
// RENTERS.COM - LISTING DESCRIPTION WRITER  ·  listing-description.js
// =====================================================================
// Takes the facts the wizard has already collected plus a few rough notes
// from the landlord, and returns a listing description.
//
// WHY THIS IS NOT A THIN WRAPPER AROUND A PROMPT:
//   Rental listing copy carries legal constraints that most copy does not.
//   The Fair Housing Act prohibits stating a preference, limitation or
//   discrimination based on race, colour, religion, sex, familial status,
//   national origin, or disability. In practice a naive description writer
//   produces exactly the wrong thing, because the phrasing sounds friendly:
//     "perfect for a young professional"        (age, familial status)
//     "great for a small family"                (familial status)
//     "ideal for a mature, quiet tenant"        (age, disability)
//     "walking distance to St Mary's"           (religion)
//     "safe neighbourhood", "good schools"      (long-recognised proxies)
//     "must be able to climb stairs"            (disability)
//   These would publish under a property manager's name, on this platform.
//   So the rule is absolute: DESCRIBE THE PROPERTY, NEVER THE OCCUPANT.
//
//   It also REPORTS what it dropped and why, rather than silently sanitising.
//   A property manager who wrote "great for young families" should learn that
//   it is a problem, not have it quietly removed and write it again next time.
//
// SECOND RULE: NEVER INVENT A FACT. The model gets the collected fields and
//   the landlord's notes and nothing else. No assumed granite counters, no
//   imagined natural light, no invented walk score. An invented amenity is a
//   misrepresentation the landlord carries, and renters arrive to find it
//   missing.
//
// THIRD RULE: NOT A BROKER. No transaction language, no "we will show you",
//   no implication that Renters.com represents either side.
//
// ENV: ANTHROPIC_API_KEY must be set in Netlify.
//      Optional LD_MODEL to override the model string.
//
// CALL:
//   POST /.netlify/functions/listing-description
//   { "facts": { ...collected fields... }, "notes": "rough text", "length": "short|standard" }
//   -> { "description": "...", "dropped": ["..."], "version": "ld-v1" }
//
//   GET ?version=1  -> { "version": "ld-v1", "model": "..." }
//
// CHANGELOG
//   ld-v2  2026-07-23  THE STYLE RULES WERE STRANGLING THE PROSE. ld-v1 said
//                      adjectives do less work than facts and preferred
//                      "two bedrooms, both with closets" over "spacious and
//                      charming". Next to a hard ban on inventing anything,
//                      the model read that as STRIP ALL DESCRIPTION and
//                      produced flat inventories. Reported live: descriptions
//                      "read a bit odd", and the dropped list showed it
//                      rewording "good parking" as a subjectivity problem.
//                      THE LINE IS INVENTION, NOT SUBJECTIVITY. If the notes
//                      say good parking, that is the landlord characterising
//                      their own property and it stays. Adjectives are fine
//                      when the notes or fields support them.
//                      ALSO: the dropped list was reporting STYLE edits. It
//                      is for substance only now, meaning fair housing
//                      removals and unsupported claims. Nobody needs telling
//                      their sentence was tightened; they need telling when
//                      something cannot legally or honestly be published.
//   ld-v1  2026-07-23  First build. Fair-housing constrained, fact-bound,
//                      reports what it removed and why.
// =====================================================================

const LD_VERSION = "ld-v2";
const MODEL = process.env.LD_MODEL || "claude-sonnet-5";

const SYSTEM = [
  "You write rental listing descriptions for Renters.com.",
  "",
  "ABSOLUTE RULE 1 - FAIR HOUSING.",
  "Describe the PROPERTY. Never describe who should live there.",
  "Never state or imply a preference, limitation or discrimination based on",
  "race, colour, religion, sex, familial status, national origin, disability,",
  "age, or any related proxy. That includes friendly-sounding phrasing:",
  "no 'perfect for a young professional', no 'great for families', no",
  "'ideal for a quiet mature tenant', no 'no kids', no 'bachelor pad'.",
  "Do not mention proximity to religious buildings. Do not characterise a",
  "neighbourhood as safe, good, bad, up-and-coming, or by its people.",
  "Do not mention school quality or ratings. Naming a nearby park, station,",
  "shop or landmark as a plain fact of location is fine.",
  "Do not describe physical requirements of occupants, such as being able to",
  "climb stairs. Stating that the unit is on the third floor with no lift is",
  "a property fact and is fine.",
  "",
  "ABSOLUTE RULE 2 - NEVER INVENT ANYTHING.",
  "Use only the supplied fields and the landlord's notes. If something is not",
  "given, it does not exist. No assumed appliances, finishes, light, views,",
  "parking, storage, pet policy, or commute times. A renter who arrives to",
  "find an invented feature missing is the landlord's problem, caused by you.",
  "",
  "ABSOLUTE RULE 3 - RENTERS.COM IS NOT A BROKER OR AGENT.",
  "Never imply the platform represents either side, shows the property,",
  "or handles the transaction. Write as the property's own listing.",
  "",
  "STYLE.",
  "Write something a person would want to read. Plain American English,",
  "warm but not salesy, and it should flow as prose rather than read as an",
  "inventory list. Lead with the specifics renters search for: layout,",
  "parking, laundry, pets, outdoor space, what is nearby.",
  "",
  "ADJECTIVES ARE FINE when they describe the PROPERTY truthfully and the",
  "landlord's notes support them. If the notes say good parking, then good",
  "parking is the landlord's own characterisation of their property and you",
  "may keep it. Words like bright, quiet, updated, spacious are allowed IF",
  "the notes or fields support them. What you may not do is make them up.",
  "The line is invention, not subjectivity.",
  "",
  "Do not turn every phrase into a bare fact. 'Off-street parking for one",
  "car and laundry in the basement' is better than 'Parking: 1. Laundry:",
  "basement.' Connect the sentences.",
  "",
  "No exclamation marks. No ALL CAPS. No emoji. No markdown. No headings.",
  "No hype words like stunning, luxurious, must see, rare opportunity.",
  "Two short paragraphs at most. Do not restate the rent, deposit, or",
  "screening requirements; they are shown separately on the listing.",
  "",
  "OUTPUT.",
  "Return ONLY a JSON object, no preamble, no code fences:",
  '{"description": "the text", "dropped": ["short note"]}',
  "",
  "THE dropped LIST IS FOR SUBSTANCE, NOT STYLE. Put an entry there ONLY",
  "when you removed something for one of two reasons:",
  "  1. it was a fair housing problem, or",
  "  2. it was a claim nothing supports and you could not verify it.",
  "NEVER list ordinary rewording, tightening, or word choice. The member does",
  "not need to be told you rephrased their sentence; they need to be told",
  "when something they wrote cannot legally or honestly be published.",
  "Each entry names the phrase and the reason in one plain sentence, e.g.",
  "\'Left out \"great for young families\" because describing who should live",
  "there is a fair housing issue.\'",
  "If nothing was removed for those two reasons, return an empty array."
].join("\n");

function factLines(f) {
  if (!f || typeof f !== "object") return "(no fields supplied)";
  const label = {
    title: "Listing title", location: "Address", ptype: "Property type",
    subtype: "Sub type", beds: "Bedrooms", baths: "Bathrooms",
    sqft: "Square feet", year: "Year built", furnished: "Furnished",
    duration: "Lease term"
  };
  const order = ["title", "location", "ptype", "subtype", "beds", "baths", "sqft", "year", "furnished", "duration"];
  const out = [];
  for (const k of order) {
    const v = f[k];
    if (v === undefined || v === null || String(v).trim() === "") continue;
    out.push("- " + (label[k] || k) + ": " + String(v).trim());
  }
  return out.length ? out.join("\n") : "(no fields supplied)";
}

function clean(s) {
  return String(s == null ? "" : s).replace(/```json/g, "").replace(/```/g, "").trim();
}

exports.handler = async function (event) {
  const qs = (event && event.queryStringParameters) || {};

  if (qs.version === "1") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ version: LD_VERSION, model: MODEL, keyPresent: !!process.env.ANTHROPIC_API_KEY })
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

  const facts = body.facts || {};
  const notes = String(body.notes || "").slice(0, 4000);
  const wantShort = String(body.length || "standard") === "short";

  if (!notes.trim() && !Object.keys(facts).length) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "nothing to write from" }) };
  }

  const user = [
    "Write the listing description.",
    "",
    "FIELDS ALREADY COLLECTED:",
    factLines(facts),
    "",
    "LANDLORD'S ROUGH NOTES:",
    notes.trim() ? notes.trim() : "(none given - work from the fields alone and keep it brief)",
    "",
    wantShort ? "Keep it to one short paragraph, about 40 words."
              : "Two short paragraphs, about 90 words total."
  ].join("\n");

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
        max_tokens: 1000,
        system: SYSTEM,
        messages: [{ role: "user", content: user }]
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
    const text = clean((data.content || [])
      .filter(b => b && b.type === "text")
      .map(b => b.text)
      .join("\n"));

    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) {}
    if (!parsed || typeof parsed.description !== "string") {
      // The model returned prose instead of JSON. Use it rather than failing,
      // but say so, because a silent shape change is how this rots later.
      return {
        statusCode: 200, headers: CORS,
        body: JSON.stringify({ description: text, dropped: [], shape: "unparsed", version: LD_VERSION })
      };
    }

    return {
      statusCode: 200, headers: CORS,
      body: JSON.stringify({
        description: String(parsed.description).trim(),
        dropped: Array.isArray(parsed.dropped) ? parsed.dropped.slice(0, 6) : [],
        version: LD_VERSION
      })
    };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: String(e).slice(0, 300) }) };
  }
};
