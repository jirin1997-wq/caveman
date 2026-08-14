# ✈️ ATC Radio - Prague Airport (LKPR)

Live Air Traffic Control Radio Simulator for Prague Václava Havla Airport.

## Features

- **Live Aircraft Tracking**: Real-time aircraft positions from OpenSky Network API
- **Interactive Radar Map**: Canvas-based radar display with clickable aircraft
- **Radio Communication**: Real-time ATC radio transmission system
- **Live Audio Streaming**: Integration with LiveATC.net for live audio feeds
- **Multiple Frequencies**: Support for Tower, Ground, Delivery, Approach, and Departure
- **Aircraft Details**: Real-time altitude, speed, heading, and vertical rate data

## Project Structure

```
atc-radio-app/
├── app/                      # Next.js frontend
│   ├── components/          # React components
│   ├── page.jsx            # Main page
│   ├── store.js            # Zustand store
│   └── globals.css         # Tailwind styles
├── server/                  # Express backend
│   ├── index.js           # Main server
│   ├── simulator.js       # Aircraft simulator (OpenSky API)
│   ├── radio.js           # Radio system
│   └── config.js          # Airport configuration
├── package.json
└── README.md
```

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

This starts:
- **Frontend**: Next.js on `http://localhost:3000`
- **Backend**: Express/WebSocket server on `ws://localhost:3001`

## API Integration

### OpenSky Network
- Free API for real-time ADS-B data
- URL: `https://opensky-network.org/api/states/all`
- Polls every 10 seconds for aircraft in Prague sector

### LiveATC.net
- Live audio streaming from actual ATC frequencies
- Streams embedded in radio panel

## Airport Data

**LKPR - Václava Havla Airport, Prague**
- Elevation: 1,247 ft
- Coordinates: 50.1008°N, 14.2600°E

### Frequencies
- **ATIS**: 118.7 MHz
- **Delivery**: 121.85 MHz
- **Ground**: 121.9 MHz
- **Tower**: 118.1 MHz
- **Approach**: 120.1 MHz
- **Departure**: 120.5 MHz

### Runways
- **06L/24R**: 3,711 ft
- **06R/24L**: 3,711 ft

## Technology Stack

- **Frontend**: Next.js, React, Zustand, Tailwind CSS
- **Backend**: Express, WebSocket (ws)
- **Real-time**: WebSocket for live aircraft & radio updates
- **Visualization**: Canvas API for radar map

## Features & Usage

### 1. Radar Map
- Shows real aircraft around Prague Airport
- Click aircraft to view details
- Color-coded by altitude (red=low, blue=high)
- Real-time position updates

### 2. Radio Communication
- Select frequency to listen
- Transmit messages to shared frequency
- Live audio stream from actual ATC (when available)
- Radio log with callsign and role indicators

### 3. Aircraft Details
- Altitude, heading, speed, vertical rate
- Ground status
- Origin information
- Real-time position coordinates

## WebSocket Messages

### Client → Server

```json
{
  "type": "RADIO_TRANSMIT",
  "callsign": "CSA100:pilot",
  "frequency": 118.1,
  "text": "Prague Tower, CSA100 on approach"
}
```

### Server → Client

```json
{
  "type": "UPDATE_AIRCRAFT",
  "aircraft": [...],
  "timestamp": 1234567890
}
```

## Notes

- **LiveATC Audio**: Requires proper CORS configuration (may need proxy)
- **Real Data**: Uses free OpenSky Network API (rate limited)
- **Simulation Fallback**: If API unavailable, uses simulated aircraft
- **Browser Compatible**: Tested on Chrome, Firefox, Safari

## Future Enhancements

- [ ] Audio streaming with proper CORS proxy
- [ ] Departure/arrival board
- [ ] Weather integration (METAR/TAF)
- [ ] Flight plan management
- [ ] Voice communication (WebRTC)
- [ ] More detailed aircraft models
- [ ] Historical flight data
- [ ] User authentication

## License

MIT
