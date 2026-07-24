// ph-v1   <-- PASTE CHECK: this is the version. Must match ?version=1
// =====================================================================
// RENTERS.COM - PHOTO FINGERPRINTS  ·  photo-hash.js
// =====================================================================
// Stores a 64-bit perceptual fingerprint for every listing photo, and
// reports when a photo already appears on a DIFFERENT listing.
//
// WHY THIS AND NOT A VISION CALL ON EVERY LISTING.
//   A vision pass costs a few cents per listing, every listing, forever, and
//   spends most of that looking at listings that are fine. Hashing costs
//   nothing per photo, and unlike the vision pass it GETS STRONGER AS THE
//   PLATFORM GROWS: every photo stored is another photo a future fraudster
//   can collide with.
//
//   And it catches the exact pattern that worried Kenny: a real address with
//   borrowed interiors. Those interiors came from somewhere. If that
//   somewhere is on this platform, the same image lands on two listings at
//   two addresses, and that is close to conclusive.
//
// THE FINGERPRINT is a dHash, computed in the BROWSER before upload:
//   grayscale, resize to 9x8, compare each pixel with the one to its right,
//   64 bits, 16 hex characters. Resilient to resizing, recompression and
//   mild colour shifts, which is what a scraped photo goes through.
//
// DISTANCE is Hamming, i.e. how many of the 64 bits differ:
//   0-4   the same image, near certainly
//   5-10  the same image reprocessed, or the same scene
//   11-16 loosely similar, reported only as weak
//   17+   unrelated
//
// WHAT IT DOES NOT DO: judge anyone. Two listings sharing a photo can be a
// property manager relisting their own unit, a duplex photographed once, or
// a stock shot of a shared amenity. Output goes to a review queue, never to
// an automatic rejection.
//
// ENV: NETLIFY_SITE_ID and NETLIFY_BLOBS_TOKEN must both be set. Per the
//   Bible, getStore does not throw on creation, only on read or write, so
//   both are passed explicitly rather than relying on ambient context.
//
// CALL:
//   POST { "action":"check",  "hashes":[{name,hash}], "listing":{id,address} }
//   POST { "action":"store",  "hashes":[...], "listing":{...} }
//   POST { "action":"both",   ... }   check first, then store
//   GET  ?version=1
//
// CHANGELOG
//   ph-v1  2026-07-23  First build. dHash storage, Hamming comparison,
//                      sharded index, same-listing matches ignored.
//                      Findings are recorded server-side for review and are
//                      NOT returned to the browser without the admin key.
// =====================================================================

const { getStore } = require("@netlify/blobs");

const PH_VERSION = "ph-v1";
const SHARD_MAX = 4000;      // entries per shard, keeps each blob well under 5MB
const MAX_SHARDS = 40;       // 160k photos before this needs revisiting
const NEAR = 10;             // bits: at or below this counts as a match worth reporting
const STRONG = 4;            // bits: at or below this is effectively the same image

function store() {
  return getStore({
    name: "photo-hashes",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN
  });
}

// Popcount over two 16-char hex strings, four bits at a time.
const BITS = [0,1,1,2,1,2,2,3,1,2,2,3,2,3,3,4];
function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16), y = parseInt(b[i], 16);
    if (isNaN(x) || isNaN(y)) return 64;
    d += BITS[(x ^ y) & 15];
  }
  return d;
}

function validHash(h) {
  return typeof h === "string" && /^[0-9a-f]{16}$/i.test(h);
}

async function readShard(s, i) {
  try {
    const raw = await s.get("shard:" + i);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];   // a missing key throws rather than returning null
  }
}

async function readMeta(s) {
  try {
    const raw = await s.get("meta");
    return raw ? JSON.parse(raw) : { shards: 0, count: 0 };
  } catch (e) {
    return { shards: 0, count: 0 };
  }
}

exports.handler = async function (event) {
  const qs = (event && event.queryStringParameters) || {};
  const CORS = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  // Kenny's review surface: every listing where a photo already existed
  // somewhere else. Key-gated, same pattern as feed-probe.
  if (qs.flags === "1") {
    if (!process.env.PHOTO_HASH_ADMIN_KEY || qs.key !== process.env.PHOTO_HASH_ADMIN_KEY) {
      return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: "key required" }) };
    }
    let flags = [];
    try {
      const raw = await store().get("flags");
      flags = raw ? JSON.parse(raw) : [];
    } catch (e) {}
    return { statusCode: 200, headers: CORS,
             body: JSON.stringify({ count: flags.length, flags: flags.slice(0, 100), version: PH_VERSION }) };
  }

  if (qs.version === "1") {
    let meta = { shards: 0, count: 0 };
    let reachable = true;
    try { meta = await readMeta(store()); } catch (e) { reachable = false; }
    return {
      statusCode: 200, headers: CORS,
      body: JSON.stringify({
        version: PH_VERSION, stored: meta.count, shards: meta.shards,
        blobsReachable: reachable,
        envPresent: !!(process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN)
      })
    };
  }

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "POST only" }) };
  }
  if (!process.env.NETLIFY_SITE_ID || !process.env.NETLIFY_BLOBS_TOKEN) {
    return { statusCode: 500, headers: CORS,
             body: JSON.stringify({ error: "NETLIFY_SITE_ID and NETLIFY_BLOBS_TOKEN must both be set" }) };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "body must be JSON" }) }; }

  const action = body.action || "both";
  const listing = body.listing || {};
  const incoming = (Array.isArray(body.hashes) ? body.hashes : [])
    .filter(h => h && validHash(h.hash))
    .slice(0, 40);

  if (!incoming.length) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "no valid hashes supplied" }) };
  }

  const s = store();
  const meta = await readMeta(s);
  const matches = [];

  if (action === "check" || action === "both") {
    for (let i = 0; i < meta.shards; i++) {
      const shard = await readShard(s, i);
      for (const rec of shard) {
        // A listing matching itself is not a finding. This is what stops an
        // edit or a re-publish flagging its own photos.
        if (listing.id && rec.listing === String(listing.id)) continue;
        for (const inc of incoming) {
          const d = hamming(inc.hash, rec.hash);
          if (d <= NEAR) {
            matches.push({
              photo: inc.name || "",
              distance: d,
              strength: d <= STRONG ? "same image" : "likely same image",
              otherListing: rec.listing || "",
              otherAddress: rec.address || "",
              otherPhoto: rec.name || "",
              when: rec.when || ""
            });
          }
        }
      }
    }
    matches.sort((a, b) => a.distance - b.distance);
  }

  let stored = 0;
  if (action === "store" || action === "both") {
    if (meta.shards >= MAX_SHARDS) {
      return {
        statusCode: 200, headers: CORS,
        body: JSON.stringify({ matches: matches.slice(0, 25), stored: 0,
          warning: "fingerprint index is full, raise MAX_SHARDS", version: PH_VERSION })
      };
    }
    let idx = Math.max(0, meta.shards - 1);
    let shard = meta.shards ? await readShard(s, idx) : [];
    if (shard.length >= SHARD_MAX) { idx = meta.shards; shard = []; }

    const when = new Date().toISOString().slice(0, 10);
    for (const inc of incoming) {
      let dupe = false;
      for (const rec of shard) {
        if (rec.hash === inc.hash && rec.listing === String(listing.id || "")) { dupe = true; break; }
      }
      if (dupe) continue;
      shard.push({
        hash: inc.hash,
        name: inc.name || "",
        listing: String(listing.id || ""),
        address: String(listing.address || "").slice(0, 120),
        when: when
      });
      stored++;
    }

    try {
      await s.set("shard:" + idx, JSON.stringify(shard));
      await s.set("meta", JSON.stringify({
        shards: Math.max(meta.shards, idx + 1),
        count: (meta.count || 0) + stored
      }));
    } catch (e) {
      return { statusCode: 500, headers: CORS,
               body: JSON.stringify({ error: "could not write the index: " + String(e).slice(0, 160),
                                      matches: matches.slice(0, 25), version: PH_VERSION }) };
    }
  }

  // RECORD THE FLAG SERVER-SIDE, and do not hand it back to the browser.
  // The property manager must not see this. Telling someone reusing photos
  // deliberately that they were caught, and on which photo, teaches them
  // exactly what to change next time. It also puts an accusation in front of
  // the many people who share a photo for innocent reasons.
  // So: the finding is written to a review list for Kenny, and the caller is
  // told only that the fingerprints were stored.
  let flagged = 0;
  if (matches.length && (action === "store" || action === "both")) {
    try {
      const raw = await (async () => { try { return await s.get("flags"); } catch (e) { return null; } })();
      const flags = raw ? JSON.parse(raw) : [];
      flags.unshift({
        at: new Date().toISOString(),
        listing: String(listing.id || ""),
        address: String(listing.address || "").slice(0, 120),
        matches: matches.slice(0, 10)
      });
      await s.set("flags", JSON.stringify(flags.slice(0, 500)));
      flagged = matches.length;
    } catch (e) { /* a failed flag write must never break a publish */ }
  }

  // The review list, for Kenny only. Gated on the same admin key as the
  // other internal tools rather than being open on the internet.
  return {
    statusCode: 200, headers: CORS,
    body: JSON.stringify({
      stored: stored,
      flagged: flagged,
      matches: qs.admin && qs.admin === process.env.PHOTO_HASH_ADMIN_KEY ? matches.slice(0, 25) : undefined,
      version: PH_VERSION
    })
  };
};
