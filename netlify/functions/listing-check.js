// ============================================================
//  listing-check.js  ·  Rental Listing Safety Check  ·  lc-v3
//  Accepts ANY combination of: a listing URL, screenshot images,
//  or pasted text. Asks Claude to flag scam signals and returns a
//  structured risk read. Server-side so the API key stays secret.
//
//  v3 changelog:
//   - Screenshot support: { images: [{ media_type, data }] } up to 4,
//     sent to Claude as vision blocks (client downscales before upload)
//   - Any one input is enough; extra inputs are combined
//   - A link that cannot be read no longer dead-ends when screenshots
//     or text were also supplied
//   - Prompt understands chat-thread screenshots, not just listings
//
//  v2 changelog:
//   - Accepts { url } and fetches the page server-side
//   - SSRF guard, login-wall short-circuit, bot-wall detection
//   - Domain signals fed to the model
//
//  Env: ANTHROPIC_API_KEY
//  POST { url?, text?, images?, source? }
//    -> { riskLevel, summary, flags[], tips[], fetched?, linkNote? }
//    -> or { needsPaste: true, message } when nothing readable arrived
// ============================================================

const { getStore } = require("@netlify/blobs");

const VERSION = "lc-v3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function ok(body) { return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(body) }; }
function bad(code, msg) { return { statusCode: code, headers: corsHeaders, body: JSON.stringify({ error: msg }) }; }

const SOURCE_LABELS = {
  craigslist: "Craigslist",
  facebook: "Facebook Marketplace or a Facebook group",
  zillow: "Zillow, Apartments.com, or a major listing site",
  "other-site": "another listing website",
  message: "a message someone sent them (text, email, DM)",
  unknown: "an unknown source",
};

// --- rate limit config ---
var RL_MAX = 10;            // max checks
var RL_WINDOW_MS = 3600000; // per hour, per IP

// --- input config ---
var FETCH_TIMEOUT_MS = 5000;   // keep the whole function inside Netlify's budget
var MAX_HTML_BYTES = 900000;
var MAX_TEXT_CHARS = 8000;
var MAX_IMAGES = 4;
var MAX_IMAGE_B64 = 1600000;   // ~1.2MB per image after client downscale
var MAX_TOTAL_B64 = 4200000;   // stay well under Netlify's payload ceiling
var OK_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// Domains that will never render for a server-side fetch.
var LOGIN_WALLED = [
  "facebook.com", "fb.com", "m.facebook.com", "messenger.com",
  "instagram.com", "nextdoor.com", "linkedin.com"
];

// Big managed platforms that frequently bot-block datacenter IPs.
var OFTEN_BLOCKED = [
  "zillow.com", "apartments.com", "realtor.com", "trulia.com",
  "hotpads.com", "rent.com", "apartmentlist.com", "redfin.com"
];

var SHORTENERS = [
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd",
  "buff.ly", "rebrand.ly", "cutt.ly", "shorturl.at", "rb.gy", "tiny.cc"
];

function clientIp(event) {
  var h = event.headers || {};
  var xf = h["x-nf-client-connection-ip"] || h["x-forwarded-for"] || "";
  if (xf) return String(xf).split(",")[0].trim();
  return "unknown";
}

function firstUrl(text) {
  var m = String(text || "").match(/https?:\/\/[^\s<>"']+/i);
  if (m) return m[0];
  var m2 = String(text || "").match(/\bwww\.[^\s<>"']+/i);
  if (m2) return "https://" + m2[0];
  return null;
}

function isBareUrl(text) {
  var t = String(text || "").trim();
  var withoutUrls = t.replace(/https?:\/\/[^\s]+/gi, "").replace(/www\.[^\s]+/gi, "").trim();
  var hadUrl = /https?:\/\/|www\./i.test(t);
  return hadUrl && withoutUrls.length < 15;
}

function normalizeUrl(raw) {
  var s = String(raw || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) {
    if (/^[a-z][a-z0-9.+-]*:/i.test(s)) return null;
    s = "https://" + s;
  }
  try { return new URL(s); } catch (e) { return null; }
}

function hostMatches(host, list) {
  host = String(host || "").toLowerCase();
  for (var i = 0; i < list.length; i++) {
    var d = list[i];
    if (host === d || host.endsWith("." + d)) return true;
  }
  return false;
}

// Block anything that could reach internal infrastructure.
function isUnsafeHost(host) {
  var h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan")) return true;
  if (h === "::1" || h.indexOf(":") > -1) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  if (h.indexOf(".") === -1) return true;
  return false;
}

function sourceFromHost(host) {
  var h = String(host || "").toLowerCase();
  if (hostMatches(h, ["craigslist.org"])) return "craigslist";
  if (hostMatches(h, ["facebook.com", "fb.com", "messenger.com", "instagram.com"])) return "facebook";
  if (hostMatches(h, OFTEN_BLOCKED)) return "zillow";
  return "other-site";
}

var NAMED_ENTITIES = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  ndash: "-", mdash: "-", minus: "-", hyphen: "-",
  lsquo: "'", rsquo: "'", sbquo: "'", ldquo: '"', rdquo: '"', bdquo: '"',
  hellip: "...", bull: "*", middot: "·", deg: "°", times: "x",
  cent: "c", pound: "£", euro: "€", yen: "¥", copy: "(c)", reg: "(r)", trade: "(tm)",
  frac12: "1/2", frac14: "1/4", frac34: "3/4", sup2: "2", sup3: "3",
  eacute: "e", egrave: "e", agrave: "a", ccedil: "c", ntilde: "n", uuml: "u", ouml: "o", auml: "a"
};

function decodeEntities(s) {
  return String(s)
    .replace(/&#[xX]([0-9a-fA-F]+);/g, function (_, h) {
      var c = parseInt(h, 16);
      return (c > 0 && c < 1114112) ? String.fromCodePoint(c) : " ";
    })
    .replace(/&#(\d+);/g, function (_, n) {
      var c = parseInt(n, 10);
      return (c > 0 && c < 1114112) ? String.fromCodePoint(c) : " ";
    })
    .replace(/&([a-zA-Z][a-zA-Z0-9]{1,9});/g, function (m, name) {
      var k = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, k) ? NAMED_ENTITIES[k] : " ";
    });
}

function metaContent(html, patterns) {
  for (var i = 0; i < patterns.length; i++) {
    var m = html.match(patterns[i]);
    if (m && m[1]) return decodeEntities(m[1]).trim();
  }
  return "";
}

function extractPage(html) {
  var title = "";
  var tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (tm) title = decodeEntities(tm[1]).replace(/\s+/g, " ").trim();

  var ogTitle = metaContent(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:title["']/i,
  ]);
  var ogDesc = metaContent(html, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i,
  ]);

  var h = html;
  h = h.replace(/<!--[\s\S]*?-->/g, " ");
  h = h.replace(/<script[\s\S]*?<\/script>/gi, " ");
  h = h.replace(/<style[\s\S]*?<\/style>/gi, " ");
  h = h.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  h = h.replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  h = h.replace(/<head[\s\S]*?<\/head>/gi, " ");
  h = h.replace(/<nav[\s\S]*?<\/nav>/gi, " ");
  h = h.replace(/<footer[\s\S]*?<\/footer>/gi, " ");
  h = h.replace(/<br\s*\/?>/gi, "\n");
  h = h.replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6|tr|section|article|dd|dt)>/gi, "\n");
  h = h.replace(/<[^>]+>/g, " ");
  h = decodeEntities(h);
  h = h.replace(/[ \t\u00a0]+/g, " ");
  h = h.replace(/ *\n */g, "\n");
  h = h.replace(/\n{3,}/g, "\n\n");
  h = h.trim();

  return { title: title, ogTitle: ogTitle, ogDesc: ogDesc, body: h };
}

// Detects captcha screens, login walls, and JS-only shells.
function looksBlocked(page, status) {
  var probe = ((page.title || "") + " " + (page.body || "")).slice(0, 3000).toLowerCase();
  var markers = [
    "verify you are human", "are you a robot", "press & hold", "press and hold",
    "captcha", "unusual traffic", "access denied", "access to this page has been denied",
    "enable javascript", "javascript is required", "please turn on javascript",
    "log in to continue", "sign in to continue", "you must log in", "create an account to continue",
    "checking your browser", "just a moment", "request blocked", "403 forbidden", "page not found"
  ];
  for (var i = 0; i < markers.length; i++) {
    if (probe.indexOf(markers[i]) > -1) return true;
  }
  if (status >= 400) return true;
  var total = ((page.title || "") + " " + (page.ogTitle || "") + " " + (page.ogDesc || "") + " " + (page.body || "")).trim().length;
  if (total < 200) return true;
  return false;
}

async function fetchListing(u) {
  var ctrl = new AbortController();
  var timer = setTimeout(function () { ctrl.abort(); }, FETCH_TIMEOUT_MS);
  try {
    var resp = await fetch(u.href, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    var finalHost = "";
    try { finalHost = new URL(resp.url || u.href).hostname; } catch (e) { finalHost = u.hostname; }
    if (isUnsafeHost(finalHost)) return { blocked: true, reason: "redirect" };

    var ctype = (resp.headers.get("content-type") || "").toLowerCase();
    if (ctype && ctype.indexOf("text/html") === -1 && ctype.indexOf("text/plain") === -1 && ctype.indexOf("xml") === -1) {
      return { blocked: true, reason: "not-html" };
    }

    var html = await resp.text();
    if (html.length > MAX_HTML_BYTES) html = html.slice(0, MAX_HTML_BYTES);

    var page = extractPage(html);
    page.finalHost = finalHost;
    page.status = resp.status;

    if (looksBlocked(page, resp.status)) return { blocked: true, reason: "wall", page: page };
    return { blocked: false, page: page };
  } catch (e) {
    var why = (e && e.name === "AbortError") ? "timeout" : "network";
    return { blocked: true, reason: why };
  } finally {
    clearTimeout(timer);
  }
}

// Accepts raw base64 or a data: URL. Returns null if unusable.
function cleanImage(img) {
  if (!img) return null;
  var media = (img.media_type || img.mediaType || "").toString().toLowerCase();
  var data = (img.data || "").toString();

  var dm = data.match(/^data:([a-z/+.-]+);base64,([\s\S]*)$/i);
  if (dm) {
    if (!media) media = dm[1].toLowerCase();
    data = dm[2];
  }
  data = data.replace(/\s/g, "");
  if (!data) return null;
  if (OK_IMAGE_TYPES.indexOf(media) === -1) return null;
  if (data.length > MAX_IMAGE_B64) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(data)) return null;
  return { media_type: media, data: data };
}

function collectImages(raw) {
  if (!Array.isArray(raw)) return [];
  var out = [];
  var total = 0;
  for (var i = 0; i < raw.length && out.length < MAX_IMAGES; i++) {
    var c = cleanImage(raw[i]);
    if (!c) continue;
    if (total + c.data.length > MAX_TOTAL_B64) break;
    total += c.data.length;
    out.push(c);
  }
  return out;
}

async function rateLimited(ip) {
  try {
    var store;
    if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
      store = getStore({ name: "listing-check-rl", siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
    } else {
      store = getStore("listing-check-rl");
    }
    var now = Date.now();
    var rec = null;
    try { rec = await store.get("ip:" + ip, { type: "json" }); } catch (e) { rec = null; }
    if (!rec || (now - rec.start) > RL_WINDOW_MS) {
      rec = { start: now, count: 1 };
      await store.setJSON("ip:" + ip, rec);
      return false;
    }
    if (rec.count >= RL_MAX) return true;
    rec.count += 1;
    await store.setJSON("ip:" + ip, rec);
    return false;
  } catch (e) {
    return false; // if the limiter itself fails, don't block the user
  }
}

function pasteFallback(message, host) {
  return ok({ needsPaste: true, host: host || "", message: message });
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };
  if (event.httpMethod !== "POST") return bad(405, "Method not allowed");

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return bad(500, "Not configured");

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return bad(400, "Bad JSON"); }

  let text = (body.text || "").toString().trim();
  let rawUrl = (body.url || "").toString().trim();
  let source = (body.source || "unknown").toString();
  const images = collectImages(body.images);

  // If they dropped a bare link into the paste box, treat it as a URL.
  if (!rawUrl && text && isBareUrl(text)) {
    var pulled = firstUrl(text);
    if (pulled) { rawUrl = pulled; text = ""; }
  }

  var hasSomething = !!rawUrl || images.length > 0 || text.length >= 20;
  if (!hasSomething) {
    return bad(400, "Add a listing link, a screenshot, or the listing text.");
  }

  // Rate limit (protects the API balance from abuse).
  var ip = clientIp(event);
  if (await rateLimited(ip)) {
    return bad(429, "You've run several checks in a short time. Please wait a little while and try again.");
  }

  // ---------- URL path ----------
  var urlNote = "";
  var pageHost = "";
  var linkNote = "";
  var isShortener = false;
  var pageText = "";
  var haveOtherInput = images.length > 0 || text.length >= 20;

  if (rawUrl) {
    var u = normalizeUrl(rawUrl);
    if (!u) {
      if (!haveOtherInput) return bad(400, "That does not look like a valid web address. Check the link and try again.");
      rawUrl = "";
    } else if (u.protocol !== "http:" && u.protocol !== "https:") {
      if (!haveOtherInput) return bad(400, "Only web links (http or https) can be checked.");
      rawUrl = "";
    } else if (u.username || u.password) {
      return bad(400, "That link contains login credentials and cannot be checked.");
    } else if (isUnsafeHost(u.hostname)) {
      return bad(400, "That link cannot be checked. Please use a normal website address.");
    } else {
      pageHost = u.hostname.toLowerCase().replace(/^www\./, "");
      isShortener = hostMatches(u.hostname, SHORTENERS);
      if (source === "unknown") source = sourceFromHost(u.hostname);

      if (hostMatches(u.hostname, LOGIN_WALLED)) {
        if (!haveOtherInput) {
          return pasteFallback(
            "That site requires a login, so we cannot open the page from here. Add a screenshot of the listing instead, or paste the text.",
            pageHost
          );
        }
        linkNote = "We could not open " + pageHost + " directly because it requires a login, so this check is based on what you provided.";
      } else {
        var got = await fetchListing(u);
        if (got.blocked) {
          var why = "We could not open that page.";
          if (got.reason === "timeout") why = "That page took too long to load.";
          else if (got.reason === "not-html") why = "That link does not point to a readable web page.";
          else if (got.reason === "wall") why = hostMatches(u.hostname, OFTEN_BLOCKED)
            ? "That site blocks automated readers."
            : "That page did not load any readable listing content.";

          if (!haveOtherInput) {
            return pasteFallback(why + " Add a screenshot of the listing instead, or paste the text.", pageHost);
          }
          linkNote = why + " This check is based on what you provided.";
        } else {
          var p = got.page;
          var parts = [];
          if (p.ogTitle && p.ogTitle !== p.title) parts.push("Page title: " + p.ogTitle);
          else if (p.title) parts.push("Page title: " + p.title);
          if (p.ogDesc) parts.push("Page description: " + p.ogDesc);
          parts.push("Page content:\n" + p.body);
          pageText = parts.join("\n\n");

          if (pageText.length < 120) {
            if (!haveOtherInput) {
              return pasteFallback(
                "We opened that page but could not find enough listing text on it. Add a screenshot instead, or paste the details.",
                pageHost
              );
            }
            pageText = "";
            linkNote = "We opened that page but found little readable content, so this check is based on what you provided.";
          }
        }
      }

      urlNote = [
        "",
        "LINK CONTEXT (the renter supplied a link):",
        "- Link submitted: " + u.href.slice(0, 400),
        "- Domain: " + pageHost,
        pageText ? "- We retrieved the page ourselves; its content is included below." : "- We could not read the page itself, so judge the domain plus whatever else the renter supplied.",
        isShortener ? "- NOTE: this is a link-shortening service, which hides the real destination. Treat that as a warning sign worth mentioning." : "",
        "- Judge the domain itself: an established rental site or a real property management company is a different risk picture than a generic free-page host, a lookalike domain, or a personal site nobody has heard of.",
        "- If the domain closely imitates a well-known brand, call that out.",
      ].filter(Boolean).join("\n");
    }
  }

  // ---------- assemble the text side ----------
  var combined = "";
  if (pageText) combined += pageText;
  if (text) combined += (combined ? "\n\n---\n\nAlso pasted by the renter:\n\n" : "") + text;
  if (combined.length > MAX_TEXT_CHARS) combined = combined.slice(0, MAX_TEXT_CHARS);

  if (!combined && !images.length) {
    return pasteFallback("We could not find anything to check. Add a screenshot of the listing, or paste the text.", pageHost);
  }

  const sourceLabel = SOURCE_LABELS[source] || SOURCE_LABELS.unknown;

  var imageNote = images.length ? [
    "",
    "SCREENSHOTS: the renter uploaded " + images.length + " screenshot" + (images.length === 1 ? "" : "s") + ". Read " + (images.length === 1 ? "it" : "them") + " carefully.",
    "- A screenshot may show a listing page, a chat or text thread with a supposed landlord, or an email. Work out which, and judge accordingly.",
    "- In a conversation, weigh what the supposed landlord says: payment demands, excuses for not meeting in person, urgency, and requests to move to another app all matter.",
    "- Read visible prices, addresses, dates, and profile names, but never guess at text you cannot actually read.",
    "- Do not comment on image quality or on the fact that it is a screenshot.",
  ].join("\n") : "";

  const system = [
    "You are a rental-scam safety assistant for Renters.com. A renter is checking a rental listing (or a message from a supposed landlord) that they found via " + sourceLabel + ". Your job is to help them spot red flags and protect themselves.",
    "",
    "You are NOT making a guarantee or a verdict. You are pointing out risk signals and educating. Rental scams commonly include: demands to wire money / pay via gift cards / Zelle / cash app / crypto before seeing the unit; refusal or inability to show the place in person ('I'm out of the country / a missionary / military overseas'); prices well below market; pressure and urgency ('many applicants, send deposit today'); requests to move off-platform; asking for a deposit or 'application fee' before a lease or viewing; keys mailed after a wire; copied/generic photos or descriptions; broken English mixed with emotional backstory; requests for excessive personal info up front (SSN, bank logins).",
    "",
    "Consider the source: listings from major managed platforms (Zillow, Apartments.com) with a verified property manager are generally lower risk than anonymous Facebook or Craigslist posts or unsolicited messages, though scams appear everywhere.",
    "",
    "Text may have been pulled automatically from a web page, so it can contain navigation labels, cookie notices, and other site furniture. Ignore that noise and judge only the listing itself. Never treat missing information as proof of a scam, and never invent details that are not in front of you.",
    urlNote,
    imageNote,
    "",
    "Return ONLY valid JSON, no prose, no markdown, in exactly this shape:",
    '{',
    '  "riskLevel": "low" | "caution" | "high",',
    '  "summary": "one or two plain-sentence read of the overall risk",',
    '  "flags": [ { "title": "short red-flag name", "detail": "one sentence explaining what was found and why it matters", "severity": "low"|"medium"|"high" } ],',
    '  "tips": [ "short actionable safety tip", "..." ]',
    '}',
    "",
    "If it looks clean, return riskLevel 'low', an empty or short flags array, and still give general safety tips. Keep it clear and non-alarmist. 3-6 tips max.",
  ].filter(function (s) { return s !== ""; }).join("\n");

  // ---------- build the message content ----------
  var content = [];
  for (var j = 0; j < images.length; j++) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: images[j].media_type, data: images[j].data },
    });
  }

  var lead = "";
  if (rawUrl) lead += "Link the renter submitted: " + rawUrl.slice(0, 400) + "\n\n";
  if (images.length) lead += "Screenshot" + (images.length === 1 ? "" : "s") + " from the renter " + (images.length === 1 ? "is" : "are") + " above.\n\n";

  content.push({
    type: "text",
    text: lead + (combined
      ? "Listing / message content:\n\n" + combined
      : "There is no pasted text. Work from the screenshots and the link context."),
  });

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1100,
        system: system,
        messages: [{ role: "user", content: content }],
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return bad(502, "Analysis service error: " + (data && data.error && data.error.message ? data.error.message : resp.status));
    }

    let raw = "";
    if (Array.isArray(data.content)) {
      raw = data.content.filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("");
    }
    raw = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) {
      return ok({
        version: VERSION,
        fetched: pageText ? pageHost : "",
        linkNote: linkNote,
        riskLevel: "caution",
        summary: "We could not fully analyze this one automatically. Review the safety tips and trust your instincts.",
        flags: [],
        tips: [
          "Never wire money, send gift cards, or pay by Zelle/CashApp/crypto before signing a lease and seeing the place in person.",
          "Insist on an in-person (or live video) tour before paying anything.",
          "Be wary of any landlord who is 'out of the country' or cannot meet.",
          "Search the listing photos and address online to check for duplicates.",
        ],
      });
    }

    var out = {
      version: VERSION,
      fetched: pageText ? pageHost : "",
      linkNote: linkNote,
      riskLevel: ["low", "caution", "high"].indexOf(parsed.riskLevel) > -1 ? parsed.riskLevel : "caution",
      summary: (parsed.summary || "").toString().slice(0, 400),
      flags: Array.isArray(parsed.flags) ? parsed.flags.slice(0, 10).map(function (f) {
        return {
          title: (f.title || "").toString().slice(0, 120),
          detail: (f.detail || "").toString().slice(0, 300),
          severity: ["low", "medium", "high"].indexOf(f.severity) > -1 ? f.severity : "medium",
        };
      }) : [],
      tips: Array.isArray(parsed.tips) ? parsed.tips.slice(0, 6).map(function (t) { return t.toString().slice(0, 240); }) : [],
    };

    return ok(out);
  } catch (e) {
    return bad(500, "check error: " + e.message);
  }
};
