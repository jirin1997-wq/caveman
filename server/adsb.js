// Real ADS-B traffic.
//
// Design rule: if no source answers, say so. Never substitute invented
// aircraft for missing data — a fake plane on a radar screen is worse than an
// empty screen, because you cannot tell it apart from a real one.

const axios = require('axios');

const UA = 'atc-radio-app/2.0 (personal, non-commercial)';
const NM_PER_KM = 0.539957;

function get(url, opts = {}) {
  return axios.get(url, { timeout: 8000, headers: { 'User-Agent': UA }, ...opts });
}

function colorForAltitude(ft) {
  if (ft < 2000) return '#ff6b6b';
  if (ft < 10000) return '#ffd93d';
  if (ft < 25000) return '#6bcf7f';
  return '#4d96ff';
}

function normalize(raw) {
  const out = {
    id: raw.id,
    callsign: (raw.callsign || '').trim() || raw.id,
    position: { lat: raw.lat, lng: raw.lon },
    altitude: Number(raw.alt) || 0, // feet
    velocity: Number(raw.gs) || 0, // knots
    heading: Number(raw.track) || 0, // degrees true
    verticalRate: Number(raw.vs) || 0, // feet/min
    onGround: !!raw.onGround,
    squawk: raw.squawk || null,
    source: raw.source,
    timestamp: Date.now(),
  };
  out.color = colorForAltitude(out.altitude);
  return out;
}

// --- sources -----------------------------------------------------------

async function fromAdsbLol(lat, lon, radiusKm) {
  const nm = Math.min(250, Math.round(radiusKm * NM_PER_KM));
  const { data } = await get(`https://api.adsb.lol/v2/point/${lat}/${lon}/${nm}`);
  return (data.ac || []).map((a) =>
    normalize({
      id: a.hex,
      callsign: a.flight,
      lat: a.lat,
      lon: a.lon,
      alt: a.alt_baro === 'ground' ? 0 : a.alt_baro,
      gs: a.gs,
      track: a.track,
      vs: a.baro_rate,
      onGround: a.alt_baro === 'ground',
      squawk: a.squawk,
      source: 'adsb.lol',
    })
  );
}

async function fromAirplanesLive(lat, lon, radiusKm) {
  const nm = Math.min(250, Math.round(radiusKm * NM_PER_KM));
  const { data } = await get(`https://api.airplanes.live/v2/point/${lat}/${lon}/${nm}`);
  return (data.ac || []).map((a) =>
    normalize({
      id: a.hex,
      callsign: a.flight,
      lat: a.lat,
      lon: a.lon,
      alt: a.alt_baro === 'ground' ? 0 : a.alt_baro,
      gs: a.gs,
      track: a.track,
      vs: a.baro_rate,
      onGround: a.alt_baro === 'ground',
      squawk: a.squawk,
      source: 'airplanes.live',
    })
  );
}

async function fromOpenSky(lat, lon, radiusKm) {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  const url =
    `https://opensky-network.org/api/states/all` +
    `?lamin=${lat - dLat}&lamax=${lat + dLat}&lomin=${lon - dLon}&lomax=${lon + dLon}`;
  const { data } = await get(url);
  // state vector layout is positional and documented by OpenSky
  return (data.states || [])
    .filter((s) => s[5] != null && s[6] != null)
    .map((s) =>
      normalize({
        id: s[0],
        callsign: s[1],
        lat: s[6],
        lon: s[5],
        alt: (s[13] ?? s[7] ?? 0) * 3.28084, // metres -> feet
        gs: (s[9] || 0) * 1.94384, // m/s -> knots
        track: s[10],
        vs: (s[11] || 0) * 196.85, // m/s -> ft/min
        onGround: s[8],
        squawk: s[14],
        source: 'opensky',
      })
    );
}

const SOURCES = [
  ['adsb.lol', fromAdsbLol],
  ['airplanes.live', fromAirplanesLive],
  ['opensky', fromOpenSky],
];

/**
 * Fetch live traffic around a point.
 * Resolves to { live: true, source, aircraft } or { live: false, errors }.
 */
async function fetchTraffic(lat, lon, radiusKm = 90) {
  const errors = [];
  for (const [name, fn] of SOURCES) {
    try {
      const aircraft = await fn(lat, lon, radiusKm);
      if (aircraft.length) return { live: true, source: name, aircraft };
      errors.push(`${name}: 0 aircraft`);
    } catch (err) {
      errors.push(`${name}: ${err.code || err.message}`);
    }
  }
  return { live: false, source: null, aircraft: [], errors };
}

module.exports = { fetchTraffic };
