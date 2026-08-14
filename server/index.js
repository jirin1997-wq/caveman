const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const { AIRPORT_CONFIG, SIMULATION_CONFIG } = require('./config');
const AircraftSimulator = require('./simulator');
const RadioSystem = require('./radio');
const ATCFeed = require('./atc-feed');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Aircraft simulator
const simulator = new AircraftSimulator(AIRPORT_CONFIG, SIMULATION_CONFIG);

// Radio system
const radio = new RadioSystem(AIRPORT_CONFIG.frequencies);

// Live ATC feed
const atcFeed = new ATCFeed();

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

// REST API endpoints
app.get('/api/airport', (req, res) => {
  res.json(AIRPORT_CONFIG);
});

app.get('/api/aircraft', (req, res) => {
  res.json(simulator.getAircraft());
});

app.get('/api/frequencies', (req, res) => {
  res.json(AIRPORT_CONFIG.frequencies);
});

app.get('/api/radio-status', (req, res) => {
  res.json({
    status: 'live',
    aircraft: simulator.getAircraft().length,
    messages: radio.getChannelMessages(AIRPORT_CONFIG.frequencies.Tower, 5),
    timestamp: Date.now()
  });
});

app.get('/api/atc-stream/:frequency', (req, res) => {
  const frequency = parseFloat(req.params.frequency);
  const atcMessages = atcFeed.getMessagesByFrequency(frequency, 20);
  const radioMessages = radio.getChannelMessages(frequency, 20);

  // Merge both feeds
  const allMessages = [...atcMessages, ...radioMessages]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 20);

  res.json({
    frequency,
    frequencyName: Object.keys(AIRPORT_CONFIG.frequencies).find(
      k => AIRPORT_CONFIG.frequencies[k] === frequency
    ),
    messages: allMessages,
    isLive: true,
    source: 'Live ATC + Radio',
    timestamp: Date.now()
  });
});

app.get('/api/atc-log', (req, res) => {
  res.json({
    messages: atcFeed.getMessages(50),
    isLive: true,
    timestamp: Date.now()
  });
});

// WebSocket connection handling
wss.on('connection', (ws) => {
  console.log('Client connected');

  // Send initial state
  ws.send(JSON.stringify({
    type: 'INIT',
    airport: AIRPORT_CONFIG,
    aircraft: simulator.getAircraft()
  }));

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      handleClientMessage(ws, message);
    } catch (e) {
      console.error('Invalid message:', e);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Broadcast aircraft updates to all connected clients
const updateInterval = setInterval(() => {
  simulator.updateAircraft();
  const aircraft = simulator.getAircraft();

  const message = JSON.stringify({
    type: 'UPDATE_AIRCRAFT',
    aircraft,
    timestamp: Date.now()
  });

  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // OPEN
      client.send(message);
    }
  });
}, SIMULATION_CONFIG.updateInterval);

function handleClientMessage(ws, message) {
  switch (message.type) {
    case 'RADIO_TRANSMIT':
      // Register callsign and transmit
      radio.registerCallsign(message.callsign);
      const radioMsg = radio.transmit(message.callsign, message.frequency, message.text);

      // Broadcast to all clients
      wss.clients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({
            type: 'RADIO_MESSAGE',
            message: radioMsg,
            frequency: message.frequency
          }));
        }
      });
      break;

    case 'GET_FREQUENCY':
      // Get messages for specific frequency
      const messages = radio.getChannelMessages(message.frequency);
      ws.send(JSON.stringify({
        type: 'FREQUENCY_MESSAGES',
        frequency: message.frequency,
        messages
      }));
      break;

    case 'GET_CHANNELS':
      // Get all channels info
      const channels = radio.getAllChannels();
      ws.send(JSON.stringify({
        type: 'CHANNELS_INFO',
        channels
      }));
      break;

    case 'REQUEST_FLIGHT':
      // Create new simulated flight
      const flight = simulator.createAircraft(message.callsign, message.type);
      ws.send(JSON.stringify({
        type: 'FLIGHT_CREATED',
        flight
      }));
      break;
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  clearInterval(updateInterval);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`ATC Server running on port ${PORT}`);
  console.log(`Airport: ${AIRPORT_CONFIG.name} (${AIRPORT_CONFIG.code})`);
});
