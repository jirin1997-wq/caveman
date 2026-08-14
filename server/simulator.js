const axios = require('axios');
const { AIRPORT_CONFIG } = require('./config');

class AircraftSimulator {
  constructor(airportConfig, simConfig) {
    this.airport = airportConfig;
    this.config = simConfig;
    this.aircraft = new Map();
    this.radioLog = [];
    this.fetchRealAircraft();
  }

  async fetchRealAircraft() {
    // Try multiple sources for real aircraft data
    let success = false;

    // Try OpenSky Network API first
    try {
      const bounds = this.airport.sectorBoundaries;
      // OpenSky API format: lamin,lamax,lomin,lomax
      const url = `https://opensky-network.org/api/states/all?lamin=${bounds.south}&lamax=${bounds.north}&lomin=${bounds.west}&lomax=${bounds.east}`;

      const response = await axios.get(url, {
        timeout: 5000,
        headers: {
          'User-Agent': 'ATC-Radio-App/1.0'
        }
      });

      if (response.data && response.data.states && response.data.states.length > 0) {
        this.parseOpenSkyData(response.data.states);
        success = true;
        console.log(`✓ Loaded ${response.data.states.length} real aircraft from OpenSky`);
      }
    } catch (error) {
      console.log('⚠ OpenSky API error:', error.message);
    }

    // Try ADSBexchange API as fallback
    if (!success) {
      try {
        const bounds = this.airport.sectorBoundaries;
        const centerLat = (bounds.north + bounds.south) / 2;
        const centerLng = (bounds.east + bounds.west) / 2;
        const url = `https://public-api.adsbexchange.com/v2/lat/${centerLat}/lon/${centerLng}/dist/50/`;

        const response = await axios.get(url, { timeout: 5000 });
        if (response.data && response.data.ac && response.data.ac.length > 0) {
          this.parseADSBData(response.data.ac);
          success = true;
          console.log(`✓ Loaded ${response.data.ac.length} real aircraft from ADSBexchange`);
        }
      } catch (error) {
        console.log('⚠ ADSBexchange API error:', error.message);
      }
    }

    // Fallback to simulation if no real data available
    if (!success) {
      console.log('→ Using simulated aircraft (no live API available)');
      this.generateSimulatedAircraft();
    }

    // Refresh data every 10 seconds
    setTimeout(() => this.fetchRealAircraft(), 10000);
  }

  parseADSBData(states) {
    // ADSBexchange format: {icao, call, lat, lon, alt_baro, gs, track, ...}
    this.aircraft.clear();

    states.forEach((state) => {
      if (!state.lat || !state.lon) return;

      const aircraft = {
        id: state.icao || `UNKNOWN_${Math.random()}`,
        callsign: (state.call || 'UNKNOWN').trim(),
        origin: 'Live ADS-B',
        position: {
          lat: state.lat,
          lng: state.lon
        },
        altitude: state.alt_baro || 0, // feet
        velocity: (state.gs || 0) / 1.944, // knots to m/s
        heading: state.track || 0, // degrees
        verticalRate: (state.baro_rate || 0) / 60, // feet/min to m/s
        onGround: (state.alt_baro || 0) === 0,
        timestamp: Date.now()
      };

      aircraft.icon = aircraft.onGround ? '✈️' : '🛩️';
      aircraft.color = this.getAircraftColor(aircraft.altitude);

      this.aircraft.set(aircraft.id, aircraft);
    });
  }

  parseOpenSkyData(states) {
    // OpenSky format: [icao24, callsign, origin_country, time_position, last_contact,
    //                   lon, lat, altitude, on_ground, velocity, true_track, vertical_rate, sensors, geo_altitude, ...]
    this.aircraft.clear();

    states.forEach((state, index) => {
      if (!state[5] || !state[6] || !state[7]) return; // Skip if missing position/altitude

      const aircraft = {
        id: state[0] || `UNKNOWN_${index}`,
        callsign: (state[1] || 'UNKNOWN').trim(),
        origin: state[2],
        position: {
          lat: state[6],
          lng: state[5]
        },
        altitude: state[7] || 0, // feet
        velocity: state[9] || 0, // m/s
        heading: state[10] || 0, // degrees
        verticalRate: state[11] || 0, // m/s
        onGround: state[8] || false,
        timestamp: Date.now()
      };

      // Add visual properties
      aircraft.icon = aircraft.onGround ? '✈️' : '🛩️';
      aircraft.color = this.getAircraftColor(aircraft.altitude);

      this.aircraft.set(aircraft.id, aircraft);
    });

    console.log(`Updated ${this.aircraft.size} aircraft from OpenSky API`);
  }

  generateSimulatedAircraft() {
    // Fallback: generate simulated aircraft for demo
    const airlines = ['CSA', 'KLM', 'LH', 'BA', 'AF', 'SQ', 'AA', 'DL'];
    const numAircraft = Math.min(5 + Math.random() * 10, this.config.maxAircraft);

    for (let i = 0; i < numAircraft; i++) {
      const airline = airlines[Math.floor(Math.random() * airlines.length)];
      const number = Math.floor(100 + Math.random() * 9900);
      const callsign = `${airline}${number}`;

      const aircraft = {
        id: callsign,
        callsign,
        origin: 'Simulated',
        position: {
          lat: this.airport.coordinates.lat + (Math.random() - 0.5) * 0.3,
          lng: this.airport.coordinates.lng + (Math.random() - 0.5) * 0.3
        },
        altitude: Math.random() * this.config.maxAltitude,
        velocity: 400 + Math.random() * 200,
        heading: Math.random() * 360,
        verticalRate: (Math.random() - 0.5) * 2000,
        onGround: Math.random() > 0.8,
        timestamp: Date.now(),
        icon: '🛩️',
        color: '#ff6b6b'
      };

      this.aircraft.set(aircraft.id, aircraft);
    }
  }

  updateAircraft() {
    // Update positions based on velocity and heading
    this.aircraft.forEach((aircraft) => {
      if (!aircraft.onGround) {
        // Calculate new position (simplified)
        const latChange = (aircraft.velocity / 1000) * Math.sin((aircraft.heading * Math.PI) / 180) * 0.00001;
        const lngChange = (aircraft.velocity / 1000) * Math.cos((aircraft.heading * Math.PI) / 180) * 0.00001;

        aircraft.position.lat += latChange;
        aircraft.position.lng += lngChange;
        aircraft.altitude += (aircraft.verticalRate / 1000) * 10;

        // Keep altitude within bounds
        aircraft.altitude = Math.max(0, Math.min(aircraft.altitude, this.config.maxAltitude));
      }

      aircraft.color = this.getAircraftColor(aircraft.altitude);
      aircraft.timestamp = Date.now();
    });
  }

  getAircraftColor(altitude) {
    if (altitude < 2000) return '#ff6b6b'; // Red - low
    if (altitude < 5000) return '#ffd93d'; // Yellow - medium
    if (altitude < 10000) return '#6bcf7f'; // Green - normal
    return '#4d96ff'; // Blue - high
  }

  createAircraft(callsign, type = 'A320') {
    const aircraft = {
      id: callsign,
      callsign,
      origin: 'Manual Entry',
      position: {
        lat: this.airport.coordinates.lat,
        lng: this.airport.coordinates.lng
      },
      altitude: 0,
      velocity: 0,
      heading: 0,
      verticalRate: 0,
      onGround: true,
      timestamp: Date.now(),
      type,
      icon: '✈️',
      color: '#ff6b6b'
    };

    this.aircraft.set(aircraft.id, aircraft);
    return aircraft;
  }

  getAircraft() {
    return Array.from(this.aircraft.values());
  }

  addRadioMessage(message) {
    this.radioLog.push({
      ...message,
      timestamp: Date.now()
    });

    // Keep only last 100 messages
    if (this.radioLog.length > 100) {
      this.radioLog.shift();
    }
  }

  getRadioLog() {
    return this.radioLog;
  }
}

module.exports = AircraftSimulator;
