// ============================================================
//  photo-watch.js   pw-v1   (2026-08-13)
//
//  THE NEEDS-PHOTO QUEUE HAD NO COMPLETION SIGNAL. Every other
//  notification in this system fires off a Didit webhook or off
//  Kenny's own decision. A member uploading a profile photo in BD
//  triggers NEITHER, so people sat in the queue having already
//  done what was asked, invisible until someone opened the panel
//  and scrolled. This closes that.
//
//  BD has no webhook for profile updates, so this POLLS: reads
//  everyone currently at needs-photo out of verify-log, checks each
//  through verify-member, and reports the ones whose photo went
//  from absent/placeholder to REAL since the last run. Each name
//  arrives with an approval link already minted, so the digest is
//  actionable rather than a to-do list.
//
//  ONCE REPORTED, NEVER REPORTED AGAIN. State lives in Blobs. A
//  member who adds a photo appears in exactly one digest. Without
//  that, every morning would re-list the same people forever and
//  the email would be ignored inside a week.
//
//  FIRST RUN IS DELIBERATELY NOISY: the reported list starts empty,
//  so everyone already sitting in Needs photo WITH a real photo is
//  reported at once. That is backlog, not noise. Some of them were
//  emailed weeks ago and complied the same day.
//
//  Endpoints (all except ?version=1 need key=ADMIN_PROBE_KEY):
//    ?version=1              env check
//    ?status=1&key=K         current state, sends nothing
//    ?dry=1&key=K            full scan, reports findings, NO email,
//                            NO state write. Safe to run repeatedly.
//    ?run=1&key=K            the real thing. Emails and saves state.
//    ?reset=1&confirm=1&key=K   clears reported state (next run is
//                               noisy again)
//
//  Paired with photo-watch-cron.js, which is the scheduled trigger.
//  Split on purpose: Netlify blocks HTTP invocation of scheduled
//  functions, and a digest nobody can test by hand is a digest
//  nobody can debug.
// ============================================================

const FN_VERSION = "pw-v1";

const { getStore } = require("@netlify/blobs");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");

const ses = new SESClient({
  region: process.env.SES_REGION || "us-east-2",
  credentials: {
    accessKeyId: process.env.SES_ACCESS_KEY_ID,
    secretAccessKey: process.env.SES_SECRET_ACCESS_KEY
  }
});

const FN_BASE = "https://renters-story-writer.netlify.app/.netlify/functions";
const LOG_URL = FN_BASE + "/verify-log";
const MEMBER_URL = FN_BASE + "/verify-member";
const APPROVE_URL = FN_BASE + "/verify-approve";
const LOG_KEY = "renters2026";

const NOTIFY_TO = "kenny@renters.com";
const NOTIFY_FROM = "verify@renters.com";

const STORE_NAME = "photo-watch";
const STATE_KEY = "state";
const CHUNK = 10;

// Same placeholder rule as verify-approve va-v2. BD serves a stock silhouette
// to every member with no upload, so a non-empty profilePhotoUrl proves nothing.
// If this drifts from the copy in verify-approve, the digest and the review page
// will disagree about who has a photo, which is worse than either being wrong.
const PLACEHOLDER_MARKERS = ["profile-profile-holder"];

function isPlaceholderPhoto(url) {
  if (!url) return false;
  const u = String(url).toLowerCase().split("?")[0];
  for (let i = 0; i < PLACEHOLDER_MARKERS.length; i++) {
    if (u.indexOf(PLACEHOLDER_MARKERS[i]) !== -1) return true;
  }
  return false;
}

function realPhotoUrl(member) {
  const u = (member && (member.profilePhotoUrl || member.profilePhoto)) || "";
  return isPlaceholderPhoto(u) ? "" : u;
}

function json(code, obj) {
  return {
    statusCode: code,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(Object.assign({ _v: FN_VERSION }, obj), null, 2)
  };
}

function store() {
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
    return getStore({
      name: STORE_NAME,
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN
    });
  }
  return getStore(STORE_NAME);
}

async function readState() {
  try {
    const v = await store().get(STATE_KEY, { type: "json" });
    if (v && typeof v === "object") {
      return { lastRun: v.lastRun || "", reported: v.reported || {}, runs: v.runs || 0 };
    }
  } catch (e) {
    // A missing key throws rather than returning null. First run lands here.
  }
  return { lastRun: "", reported: {}, runs: 0 };
}

async function writeState(state) {
  try {
    await store().setJSON(STATE_KEY, state);
    return true;
  } catch (e) {
    return false;
  }
}

async function postJson(url, payload) {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const t = await r.text();
    try { return JSON.parse(t); } catch (e) { return null; }
  } catch (e) {
    return null;
  }
}

async function getJson(url) {
  try {
    const r = await fetch(url);
    const t = await r.text();
    try { return JSON.parse(t); } catch (e) { return null; }
  } catch (e) {
    return null;
  }
}

// Everyone whose LATEST Didit-era submission sits at needs-photo.
// Latest matters: a member emailed in July who re-verified in August is not
// waiting on a photo any more, and listing them would send Kenny to a stale row.
async function loadQueue() {
  const res = await postJson(LOG_URL, { action: "list", key: LOG_KEY });
  const entries = (res && res.entries) || [];
  const out = [];

  entries.forEach(function (mem) {
    const hist = (mem.history || []).filter(function (h) {
      // Didit-era only. Legacy records have short numeric inquiryIds.
      return String(h.inquiryId || "").indexOf("-") !== -1;
    });
    if (!hist.length) return;

    hist.sort(function (a, b) {
      const A = a.decidedAt || a.submitted || "";
      const B = b.decidedAt || b.submitted || "";
      return String(A).localeCompare(String(B));
    });
    const latest = hist[hist.length - 1];
    if (!latest || latest.status !== "needs-photo") return;

    out.push({
      memberId: String(mem.memberId),
      inquiryId: String(latest.inquiryId || ""),
      name: mem.name || "",
      notifiedAt: latest.decidedAt || "",
      notifiedBy: latest.decidedBy || ""
    });
  });

  return out;
}

async function loadMembers(ids) {
  const found = {};
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const res = await getJson(MEMBER_URL + "?key=" + LOG_KEY + "&ids=" + encodeURIComponent(slice.join(",")));
    const list = (res && res.members) || [];
    list.forEach(function (m) {
      if (m && m.found) found[String(m.memberId)] = m;
    });
  }
  return found;
}

async function mintLink(memberId, inquiryId) {
  const adminKey = process.env.ADMIN_PROBE_KEY || "";
  if (!adminKey) return "";
  const res = await getJson(
    APPROVE_URL + "?mint=1&memberId=" + encodeURIComponent(memberId) +
    "&inquiryId=" + encodeURIComponent(inquiryId || "") +
    "&key=" + encodeURIComponent(adminKey)
  );
  return (res && res.url) || "";
}

function daysSince(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

function digestText(ready, stats) {
  const lines = [];
  lines.push(ready.length === 1
    ? "1 member added a profile photo after being asked."
    : ready.length + " members added a profile photo after being asked.");
  lines.push("");
  lines.push("Each link opens the review page. PIN required. Works once, expires in 72 hours.");
  lines.push("");

  ready.forEach(function (r, i) {
    const d = daysSince(r.notifiedAt);
    lines.push((i + 1) + ". " + (r.name || ("Member #" + r.memberId)));
    lines.push("   ID:      #" + r.memberId);
    if (r.email) lines.push("   Email:   " + r.email);
    if (r.accountType) lines.push("   Type:    " + r.accountType);
    if (d !== null) {
      lines.push("   Waiting: " + (d === 0 ? "asked today" : d === 1 ? "1 day" : d + " days"));
    }
    lines.push("   Review:  " + (r.link || "(link could not be minted, use the bookmarklet)"));
    lines.push("");
  });

  lines.push("---");
  lines.push("Still waiting on a photo: " + stats.stillWaiting);
  lines.push("Checked " + stats.checked + " member(s) in the needs-photo queue.");
  lines.push("");
  lines.push("Nobody appears in this digest twice. Renters.com photo watch.");
  return lines.join("\n");
}

async function sendDigest(ready, stats) {
  const subject = "📸 Photos added — " + ready.length + " ready to review";
  await ses.send(new SendEmailCommand({
    Source: NOTIFY_FROM,
    Destination: { ToAddresses: [NOTIFY_TO] },
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: { Text: { Data: digestText(ready, stats), Charset: "UTF-8" } }
    }
  }));
  return subject;
}

// The scan itself. `commit` decides whether it emails and saves.
async function scan(commit) {
  const state = await readState();
  const queue = await loadQueue();

  // Return the SAME shape as a full scan even when there is nothing to do.
  // A caller that has to branch on which shape came back will eventually read
  // undefined and treat it as zero for the wrong reason.
  if (!queue.length) {
    if (commit) {
      state.lastRun = new Date().toISOString();
      state.runs = (state.runs || 0) + 1;
      await writeState(state);
    }
    return {
      committed: !!commit,
      emailed: false,
      subject: "",
      readyCount: 0,
      ready: [],
      stats: { checked: 0, stillWaiting: 0, alreadyReported: 0, missingFromBD: 0 },
      lastRun: state.lastRun,
      runs: state.runs
    };
  }

  const members = await loadMembers(queue.map(function (q) { return q.memberId; }));

  const ready = [];
  let stillWaiting = 0;
  let alreadyReported = 0;
  let missing = 0;

  for (let i = 0; i < queue.length; i++) {
    const q = queue[i];
    const m = members[q.memberId];

    if (!m) { missing++; continue; }

    // Already granted by some other route. Not this digest's business.
    if (m.verified) continue;

    if (!realPhotoUrl(m)) { stillWaiting++; continue; }

    // Has a real photo now. New only if this is the first time we have said so.
    if (state.reported[q.memberId]) { alreadyReported++; continue; }

    ready.push({
      memberId: q.memberId,
      inquiryId: q.inquiryId,
      name: m.name || q.name || "",
      email: m.email || "",
      accountType: m.accountType || "",
      notifiedAt: q.notifiedAt,
      notifiedBy: q.notifiedBy,
      link: ""
    });
  }

  // Mint links only for what is actually going out.
  if (commit || ready.length) {
    for (let i = 0; i < ready.length; i++) {
      ready[i].link = await mintLink(ready[i].memberId, ready[i].inquiryId);
    }
  }

  const stats = {
    checked: queue.length,
    stillWaiting: stillWaiting,
    alreadyReported: alreadyReported,
    missingFromBD: missing
  };

  let emailed = false;
  let subject = "";

  if (commit) {
    if (ready.length) {
      try {
        subject = await sendDigest(ready, stats);
        emailed = true;
      } catch (e) {
        // A failed send must NOT mark these people reported, or they vanish
        // silently and are never mentioned again.
        return {
          error: "digest send failed, state NOT saved: " + e.message,
          ready: ready.map(function (r) { return r.memberId; }),
          stats: stats
        };
      }
    }

    const now = new Date().toISOString();
    ready.forEach(function (r) { state.reported[r.memberId] = now; });
    state.lastRun = now;
    state.runs = (state.runs || 0) + 1;
    await writeState(state);
  }

  return {
    committed: !!commit,
    emailed: emailed,
    subject: subject,
    readyCount: ready.length,
    ready: ready.map(function (r) {
      return {
        memberId: r.memberId,
        name: r.name,
        email: r.email,
        daysWaiting: daysSince(r.notifiedAt),
        notifiedBy: r.notifiedBy,
        linkMinted: !!r.link
      };
    }),
    stats: stats,
    lastRun: state.lastRun,
    runs: state.runs
  };
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const adminKey = process.env.ADMIN_PROBE_KEY || "";

  if (q.version === "1") {
    return json(200, {
      ok: true,
      adminKeyConfigured: !!adminKey,
      blobsConfigured: !!(process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN),
      sesRegion: process.env.SES_REGION || "us-east-2",
      notifyTo: NOTIFY_TO
    });
  }

  if (!adminKey) return json(500, { error: "ADMIN_PROBE_KEY not set" });
  if (q.key !== adminKey) return json(401, { error: "bad or missing key" });

  if (q.status === "1") {
    const state = await readState();
    return json(200, {
      lastRun: state.lastRun || "(never)",
      runs: state.runs || 0,
      reportedCount: Object.keys(state.reported || {}).length,
      reported: state.reported || {}
    });
  }

  if (q.reset === "1") {
    if (q.confirm !== "1") return json(400, { error: "add &confirm=1 to clear reported state" });
    await writeState({ lastRun: "", reported: {}, runs: 0 });
    return json(200, { reset: true, note: "Next run reports everyone with a photo again." });
  }

  if (q.dry === "1") return json(200, await scan(false));
  if (q.run === "1") return json(200, await scan(true));

  return json(400, { error: "no action. use ?version=1, ?status=1, ?dry=1, ?run=1 or ?reset=1" });
};
