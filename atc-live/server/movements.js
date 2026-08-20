// Airport movement board.
//
// IMPORTANT: this is derived from live ADS-B geometry — position, altitude and
// vertical rate — NOT from an airline schedule. It answers "what is physically
// happening around the field right now", not "what is the timetable".
//
// That distinction matters: a real schedule board needs a paid data feed. Rather
// than fake one, the app shows what the transponders actually say, and the UI
// labels it as such.

const EARTH_R_KM = 6371;

function toRad(d) {
  return (d * Math.PI) / 180;
}

function distanceKm(aLat, aLon, bLat, bLon) {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.sqrt(s));
}

function bearingDeg(aLat, aLon, bLat, bLon) {
  const y = Math.sin(toRad(bLon - aLon)) * Math.cos(toRad(bLat));
  const x =
    Math.cos(toRad(aLat)) * Math.sin(toRad(bLat)) -
    Math.sin(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.cos(toRad(bLon - aLon));
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

function compass(deg) {
  const points = ['S', 'SV', 'V', 'JV', 'J', 'JZ', 'Z', 'SZ'];
  return points[Math.round(deg / 45) % 8];
}

const GROUND_RADIUS_KM = 6; // inside this, "on ground" means at this field
const TERMINAL_RADIUS_KM = 45; // approach/departure working area
const CLIMB_FPM = 300;

/**
 * Classify one aircraft relative to an airport.
 * Returns { phase, distanceKm, bearing, ... } — phase is one of:
 *   'ground' | 'arriving' | 'departing' | 'transit'
 */
function classify(ac, airport) {
  const d = distanceKm(airport.lat, airport.lon, ac.position.lat, ac.position.lng);
  const brg = bearingDeg(airport.lat, airport.lon, ac.position.lat, ac.position.lng);
  const vs = ac.verticalRate || 0;

  let phase = 'transit';
  if (ac.onGround && d <= GROUND_RADIUS_KM) {
    phase = 'ground';
  } else if (d <= TERMINAL_RADIUS_KM && vs < -CLIMB_FPM && ac.altitude < 12000) {
    phase = 'arriving';
  } else if (d <= TERMINAL_RADIUS_KM && vs > CLIMB_FPM && ac.altitude < 18000) {
    phase = 'departing';
  }

  return {
    ...ac,
    phase,
    distanceKm: Math.round(d * 10) / 10,
    bearing: Math.round(brg),
    compass: compass(brg),
  };
}

/**
 * Build the movement board for an airport from a live traffic snapshot.
 * Each list is sorted by how immediate it is (closest / lowest first).
 */
function buildBoard(aircraft, airport) {
  const classified = (aircraft || []).map((ac) => classify(ac, airport));

  const byDistance = (a, b) => a.distanceKm - b.distanceKm;

  return {
    ground: classified.filter((a) => a.phase === 'ground').sort(byDistance),
    arriving: classified.filter((a) => a.phase === 'arriving').sort(byDistance),
    departing: classified.filter((a) => a.phase === 'departing').sort(byDistance),
    transit: classified.filter((a) => a.phase === 'transit').sort(byDistance),
    all: classified,
  };
}

module.exports = { buildBoard, classify, distanceKm, bearingDeg, compass };
