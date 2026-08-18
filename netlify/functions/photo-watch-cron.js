// ============================================================
//  photo-watch-cron.js   pwc-v1   (2026-08-13)
//
//  The scheduled trigger for photo-watch.js. Nothing else.
//
//  WHY TWO FILES. Netlify blocks HTTP invocation of scheduled
//  functions in production, so a digest built directly on a
//  schedule could never be tested by hand, and a digest nobody
//  can run on demand is a digest nobody can debug. The logic
//  lives in photo-watch.js where ?dry=1 and ?run=1 reach it;
//  this file only wakes it up.
//
//  Runs 08:00 America/Los_Angeles. Netlify cron is UTC ONLY and
//  does not observe daylight saving, so 15:00 UTC is 08:00 PDT
//  in summer and 07:00 PST in winter. An hour of drift twice a
//  year on a daily digest is not worth a workaround.
//
//  Schedule set below via the `schedule` export. If the Netlify
//  build does not pick it up, set it in netlify.toml instead:
//
//    [functions."photo-watch-cron"]
//      schedule = "0 15 * * *"
// ============================================================

const FN_VERSION = "pwc-v1";

const TARGET = "https://renters-story-writer.netlify.app/.netlify/functions/photo-watch";

exports.handler = async function () {
  const key = process.env.ADMIN_PROBE_KEY || "";
  if (!key) {
    console.log("[photo-watch-cron] " + FN_VERSION + " ADMIN_PROBE_KEY not set, nothing run");
    return { statusCode: 500, body: "not configured" };
  }

  try {
    const res = await fetch(TARGET + "?run=1&key=" + encodeURIComponent(key));
    const text = await res.text();
    // Log the whole payload. When a morning digest does not arrive, this log is
    // the only place that says whether the scan ran and found nobody, or never
    // ran at all. Those look identical from an empty inbox.
    console.log("[photo-watch-cron] " + FN_VERSION + " status=" + res.status + " body=" + text.slice(0, 900));
    return { statusCode: 200, body: "ok" };
  } catch (e) {
    console.log("[photo-watch-cron] " + FN_VERSION + " error: " + e.message);
    return { statusCode: 500, body: "error" };
  }
};

// Netlify reads this to register the cron. UTC.
exports.config = {
  schedule: "0 15 * * *"
};
