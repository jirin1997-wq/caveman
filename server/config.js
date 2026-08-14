// LKPR - Václava Havla Airport, Prague
const AIRPORT_CONFIG = {
  code: 'LKPR',
  name: 'Václava Havla Airport',
  city: 'Prague',
  country: 'Czech Republic',
  elevation: 1247, // feet
  coordinates: {
    lat: 50.1008,
    lng: 14.2600
  },
  runways: [
    { name: '06L/24R', heading: 60, length: 3711 },
    { name: '06R/24L', heading: 60, length: 3711 }
  ],
  frequencies: {
    ATIS: 118.7,
    Delivery: 121.85,
    Ground: 121.9,
    Tower: 118.1,
    Approach: 120.1,
    Departure: 120.5
  },
  sectorBoundaries: {
    north: 50.25,
    south: 49.95,
    east: 14.45,
    west: 14.05
  }
};

const SIMULATION_CONFIG = {
  updateInterval: 1000, // ms - update positions every second
  maxAircraft: 20,
  maxAltitude: 45000, // feet
  minAltitude: 0 // feet
};

module.exports = {
  AIRPORT_CONFIG,
  SIMULATION_CONFIG
};
