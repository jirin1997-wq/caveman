// Aircraft photos via the Planespotters public API.
//
// Photos are looked up by the aircraft's ICAO24 hex — the same identifier the
// transponder broadcasts — so the picture belongs to the exact airframe
// overhead, not to a generic image of the type.
//
// Attribution is mandatory under the Planespotters API terms: photographer name
// and the link back are returned with every photo and the UI renders both.
// If there is no photo for an airframe, that is the answer; no stand-in image.

const axios = require('axios');

const TTL_MS = 6 * 60 * 60 * 1000; // photos for an airframe rarely change
const NEGATIVE_TTL_MS = 30 * 60 * 1000; // re-check "no photo" occasionally
const MAX_ENTRIES = 500;

const cache = new Map(); // hex -> { at, photo }

function remember(hex, photo) {
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(hex, { at: Date.now(), photo });
}

/**
 * Look up a photo for an ICAO24 hex code.
 * Resolves to { thumbnail, large, link, photographer } or null.
 */
async function photoForHex(hex) {
  const key = String(hex || '').toLowerCase().trim();
  if (!/^[0-9a-f]{6}$/.test(key)) return null;

  const hit = cache.get(key);
  if (hit) {
    const ttl = hit.photo ? TTL_MS : NEGATIVE_TTL_MS;
    if (Date.now() - hit.at < ttl) return hit.photo;
  }

  const { data } = await axios.get(`https://api.planespotters.net/pub/photos/hex/${key}`, {
    timeout: 8000,
    headers: { 'User-Agent': 'atc-radio-app/2.0 (personal, non-commercial)' },
  });

  const first = data && Array.isArray(data.photos) ? data.photos[0] : null;
  const photo = first
    ? {
        thumbnail: first.thumbnail?.src || null,
        large: first.thumbnail_large?.src || first.thumbnail?.src || null,
        link: first.link || null,
        photographer: first.photographer || null,
        credit: 'Planespotters.net',
      }
    : null;

  remember(key, photo);
  return photo;
}

module.exports = { photoForHex };
