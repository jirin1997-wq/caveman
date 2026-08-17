const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const { listAirports, getAirport, DEFAULT_ICAO } = require('./airports');
const { discoverFeeds, openStream } = require('./liveatc');
const { fetchTraffic } = require('./adsb');
const RadioSystem = require('./radio');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const radio = new RadioSystem();

app.use(express.json());

// --- REST ---------------------------------------------------------------

app.get('/api/airports', (_req, res) => res.json(listAirports()));

app.get('/api/airport/:icao', (req, res) => {
  const airport = getAirport(req.params.icao);
  if (!airport) return res.status(404).json({ error: 'unknown airport' });
  res.json(airport);
});

// Which LiveATC feeds exist for this airport, discovered live.
app.get('/api/feeds/:icao', async (req, res) => {
  const airport = getAirport(req.params.icao);
  if (!airport) return res.status(404).json({ error: 'unknown airport' });
  try {
    const feeds = await discoverFeeds(airport.icao);
    res.json({ icao: airport.icao, feeds, available: feeds.length > 0 });
  } catch (err) {
    res.status(502).json({
      icao: airport.icao,
      feeds: [],
      available: false,
      error: `LiveATC unreachable: ${err.code || err.message}`,
    });
  }
});

// Audio proxy: the browser cannot fetch LiveATC directly (CORS + hotlink
// checks), so the server fetches and pipes it through. Personal listening only.
app.get('/api/stream/:feedId', async (req, res) => {
  let upstream;
  try {
    upstream = await openStream(req.params.feedId);
  } catch (err) {
    return res.status(502).json({ error: `stream failed: ${err.code || err.message}` });
  }
  if (!upstream) return res.status(404).json({ error: 'feed offline — no stream in playlist' });

  res.setHeader('Content-Type', upstream.contentType);
  res.setHeader('Cache-Control', 'no-store');
  upstream.stream.pipe(res);

  const stop = () => upstream.stream.destroy();
  req.on('close', stop);
  upstream.stream.on('error', () => res.destroy());
});

app.get('/api/traffic/:icao', async (req, res) => {
  const airport = getAirport(req.params.icao);
  if (!airport) return res.status(404).json({ error: 'unknown airport' });
  const result = await fetchTraffic(airport.lat, airport.lon);
  res.json({ icao: airport.icao, ...result });
});

// --- WebSocket ----------------------------------------------------------

const clients = new Map(); // ws -> { icao }

wss.on('connection', (ws) => {
  clients.set(ws, { icao: DEFAULT_ICAO });

  ws.send(
    JSON.stringify({
      type: 'INIT',
      airports: listAirports(),
      airport: getAirport(DEFAULT_ICAO),
      connected: wss.clients.size,
    })
  );

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'SET_AIRPORT') {
      const airport = getAirport(msg.icao);
      if (!airport) return;
      clients.set(ws, { icao: airport.icao });
      ws.send(JSON.stringify({ type: 'AIRPORT_CHANGED', airport }));
      pushTraffic(ws, airport);
      return;
    }

    if (msg.type === 'RADIO_TRANSMIT') {
      if (!msg.text || !msg.callsign) return;
      const out = radio.transmit({
        callsign: msg.callsign,
        role: msg.role,
        channel: msg.channel,
        text: msg.text,
      });
      broadcast({ type: 'RADIO_MESSAGE', message: out });
      return;
    }

    if (msg.type === 'RADIO_HISTORY') {
      ws.send(
        JSON.stringify({
          type: 'RADIO_HISTORY',
          channel: msg.channel,
          messages: radio.history(msg.channel),
        })
      );
    }
  });

  ws.on('close', () => clients.delete(ws));
});

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) if (client.readyState === 1) client.send(data);
}

async function pushTraffic(ws, airport) {
  const result = await fetchTraffic(airport.lat, airport.lon);
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'TRAFFIC', icao: airport.icao, ...result }));
}

// Poll each airport that somebody is actually watching.
const POLL_MS = 8000;
const poll = setInterval(async () => {
  const watched = new Set([...clients.values()].map((c) => c.icao));
  for (const icao of watched) {
    const airport = getAirport(icao);
    if (!airport) continue;
    const result = await fetchTraffic(airport.lat, airport.lon);
    const payload = JSON.stringify({ type: 'TRAFFIC', icao, ...result });
    for (const [ws, state] of clients) {
      if (state.icao === icao && ws.readyState === 1) ws.send(payload);
    }
  }
}, POLL_MS);

process.on('SIGTERM', () => {
  clearInterval(poll);
  server.close(() => process.exit(0));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`ATC Radio server on :${PORT}`);
  console.log(`Default airport: ${DEFAULT_ICAO}`);
  console.log('Live sources are contacted on demand — if your network blocks');
  console.log('them, the UI will say so rather than invent traffic.');
});
