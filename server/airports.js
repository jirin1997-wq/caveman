// Airport registry.
//
// Deliberately minimal: only data that is stable and verifiable (ICAO code,
// name, coordinates). Radio frequencies and stream URLs are NOT hardcoded —
// they are discovered at runtime from LiveATC (see liveatc.js), because a
// wrong hardcoded frequency is worse than no frequency at all.

const AIRPORTS = [
  { icao: 'LKPR', name: 'Praha / Ruzyně — Václav Havel', city: 'Praha',     lat: 50.1008, lon: 14.2600 },
  { icao: 'LKTB', name: 'Brno / Tuřany',                 city: 'Brno',      lat: 49.1513, lon: 16.6944 },
  { icao: 'LKMT', name: 'Ostrava / Mošnov',              city: 'Ostrava',   lat: 49.6963, lon: 18.1111 },
  { icao: 'EDDF', name: 'Frankfurt am Main',             city: 'Frankfurt', lat: 50.0379, lon:  8.5622 },
  { icao: 'EHAM', name: 'Amsterdam Schiphol',            city: 'Amsterdam', lat: 52.3105, lon:  4.7683 },
  { icao: 'EGLL', name: 'London Heathrow',               city: 'London',    lat: 51.4700, lon: -0.4543 },
  { icao: 'LOWW', name: 'Wien Schwechat',                city: 'Wien',      lat: 48.1103, lon: 16.5697 },
  { icao: 'KJFK', name: 'New York JFK',                  city: 'New York',  lat: 40.6413, lon: -73.7781 },
];

const DEFAULT_ICAO = 'LKPR';

function getAirport(icao) {
  return AIRPORTS.find((a) => a.icao === String(icao || '').toUpperCase()) || null;
}

function listAirports() {
  return AIRPORTS;
}

module.exports = { AIRPORTS, DEFAULT_ICAO, getAirport, listAirports };
