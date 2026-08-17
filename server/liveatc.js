// LiveATC feed discovery + stream resolution.
//
// Design rule: nothing about a feed is hardcoded. Feed IDs and stream URLs are
// discovered at runtime from liveatc.net, because CDN hostnames rotate and a
// guessed URL is indistinguishable from a broken one.
//
// Flow:
//   1. GET /search/?icao=LKPR   -> which feeds exist for this airport
//   2. GET /play/<feed>.pls     -> the actual (current) stream URL
//   3. server pipes that stream to the browser (see index.js /api/stream)
//
// NOTE ON TERMS OF USE: LiveATC's terms prohibit rebroadcasting/redistributing
// their audio. Proxying to your own browser on your own machine is personal
// listening. Do not deploy this on a public URL — that is redistribution.

const axios = require('axios');

const BASE = 'https://www.liveatc.net';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const FEED_TTL_MS = 10 * 60 * 1000; // feed list changes rarely
const URL_TTL_MS = 5 * 60 * 1000; // stream host rotates more often

const feedCache = new Map(); // icao -> { at, feeds }
const urlCache = new Map(); // feedId -> { at, urls }

function http(url, extra = {}) {
  return axios.get(url, {
    timeout: 10000,
    headers: { 'User-Agent': UA, Referer: BASE + '/', ...(extra.headers || {}) },
    ...extra,
  });
}

/**
 * Find the feeds LiveATC publishes for an airport.
 * Returns [{ id, label }] — empty array means "this airport has no feed",
 * which is a real and common answer, not an error to paper over.
 */
async function discoverFeeds(icao) {
  const key = String(icao).toLowerCase();
  const hit = feedCache.get(key);
  if (hit && Date.now() - hit.at < FEED_TTL_MS) return hit.feeds;

  const res = await http(`${BASE}/search/?icao=${encodeURIComponent(key)}`);
  const html = String(res.data);

  // Feed IDs appear both as .pls links and as hlisten mount params.
  const ids = new Set();
  for (const m of html.matchAll(/\/play\/([a-z0-9_+-]+)\.pls/gi)) ids.add(m[1].toLowerCase());
  for (const m of html.matchAll(/mount=([a-z0-9_+-]+)/gi)) ids.add(m[1].toLowerCase());

  // Best-effort human label: LiveATC renders a description near each feed in a
  // <strong>/<td> before the listen link. If we can't find one, the id is shown.
  const feeds = [...ids].map((id) => {
    let label = null;
    const near = html.indexOf(id);
    if (near > 0) {
      const window = html.slice(Math.max(0, near - 800), near);
      const labels = [...window.matchAll(/<strong>([^<]{3,80})<\/strong>/gi)];
      if (labels.length) label = labels[labels.length - 1][1].replace(/\s+/g, ' ').trim();
    }
    return { id, label: label || id.toUpperCase() };
  });

  feedCache.set(key, { at: Date.now(), feeds });
  return feeds;
}

/**
 * Resolve a feed id to its current stream URL(s) via the .pls playlist.
 * Returns [] if LiveATC has no live stream for it right now (feeds go offline).
 */
async function resolveStreamUrls(feedId) {
  const key = String(feedId).toLowerCase();
  const hit = urlCache.get(key);
  if (hit && Date.now() - hit.at < URL_TTL_MS) return hit.urls;

  const res = await http(`${BASE}/play/${encodeURIComponent(key)}.pls`, {
    responseType: 'text',
    validateStatus: (s) => s < 500,
  });

  const urls = [];
  if (res.status === 200) {
    for (const m of String(res.data).matchAll(/^\s*File\d+\s*=\s*(\S+)\s*$/gim)) urls.push(m[1]);
  }

  urlCache.set(key, { at: Date.now(), urls });
  return urls;
}

/**
 * Open the audio stream for a feed. Returns a Node stream + content-type, or
 * null when nothing is live. Caller pipes it to the browser.
 */
async function openStream(feedId) {
  const urls = await resolveStreamUrls(feedId);
  for (const url of urls) {
    try {
      const res = await http(url, { responseType: 'stream', timeout: 15000 });
      return {
        stream: res.data,
        contentType: res.headers['content-type'] || 'audio/mpeg',
        url,
      };
    } catch {
      // try the next mirror in the playlist
    }
  }
  return null;
}

module.exports = { discoverFeeds, resolveStreamUrls, openStream };
