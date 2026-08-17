const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const { listAirports, getAirport, DEFAULT_ICAO } = require('./airports');
const { discoverFeeds, openStream } = require('./liveatc');
const { groupFeeds } = require('./positions');
const { fetchTraffic } = require('./adsb');
const { buildBoard } = require('./movements');
const { photoForHex } = require('./photos');
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
  if (!airport) return res.status(404).json({ error: 'neznámé letiště' });
  res.json(airport);
});

// LiveATC feeds for this airport, discovered live and grouped into positions
// (Clearance / Ground / Tower / Approach / Radar ...).
app.get('/api/feeds/:icao', async (req, res) => {
  const airport = getAirport(req.params.icao);
  if (!airport) return res.status(404).json({ error: 'neznámé letiště' });
  try {
    const feeds = await discoverFeeds(airport.icao);
    res.json({
      icao: airport.icao,
      feeds,
      positions: groupFeeds(feeds),
      available: feeds.length > 0,
    });
  } catch (err) {
    res.status(502).json({
      icao: airport.icao,
      feeds: [],
      positions: [],
      available: false,
      error: `LiveATC nedostupné: ${err.code || err.message}`,
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
    return res.status(502).json({ error: `stream selhal: ${err.code || err.message}` });
  }
  if (!upstream) return res.status(404).json({ error: 'feed je offline — v playlistu není stream' });

  res.setHeader('Content-Type', upstream.contentType);
  res.setHeader('Cache-Control', 'no-store');
  upstream.stream.pipe(res);

  req.on('close', () => upstream.stream.destroy());
  upstream.stream.on('error', () => res.destroy());
});

app.get('/api/traffic/:icao', async (req, res) => {
  const airport = getAirport(req.params.icao);
  if (!airport) return res.status(404).json({ error: 'neznámé letiště' });
  const result = await fetchTraffic(airport.lat, airport.lon);
  res.json({ icao: airport.icao, ...result, board: buildBoard(result.aircraft, airport) });
});

// Photo of one specific airframe, by the hex its transponder broadcasts.
app.get('/api/photo/:hex', async (req, res) => {
  try {
    const photo = await photoForHex(req.params.hex);
    res.json({ hex: req.params.hex, photo, available: !!photo });
  } catch (err) {
    res.status(502).json({
      hex: req.params.hex,
      photo: null,
      available: false,
      error: `Planespotters nedostupné: ${err.code || err.message}`,
    });
  }
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
    })
  );
  pushTraffic(ws, getAirport(DEFAULT_ICAO));

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
      broadcast({
        type: 'RADIO_MESSAGE',
        message: radio.transmit({
          callsign: msg.callsign,
          role: msg.role,
          channel: msg.channel,
          text: msg.text,
        }),
      });
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

function trafficPayload(icao, airport, result) {
  return JSON.stringify({
    type: 'TRAFFIC',
    icao,
    ...result,
    board: buildBoard(result.aircraft, airport),
  });
}

async function pushTraffic(ws, airport) {
  const result = await fetchTraffic(airport.lat, airport.lon);
  if (ws.readyState === 1) ws.send(trafficPayload(airport.icao, airport, result));
}

// Poll only the airports somebody is actually watching.
const POLL_MS = 8000;
const poll = setInterval(async () => {
  const watched = new Set([...clients.values()].map((c) => c.icao));
  for (const icao of watched) {
    const airport = getAirport(icao);
    if (!airport) continue;
    const result = await fetchTraffic(airport.lat, airport.lon);
    const payload = trafficPayload(icao, airport, result);
    for (const [ws, state] of clients) {
      if (state.icao === icao && ws.readyState === 1) ws.send(payload);
    }
  }
}, POLL_MS);

// Don't let the poll timer alone hold the process open — without this the
// server keeps an idle event loop alive forever and test runs never exit.
poll.unref();

process.on('SIGTERM', () => {
  clearInterval(poll);
  server.close(() => process.exit(0));
});

const PORT = process.env.PORT || 3001;
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`ATC Radio server na :${PORT}`);
    console.log(`Výchozí letiště: ${DEFAULT_ICAO}`);
    console.log('Živé zdroje se volají za běhu — když je síť blokuje,');
    console.log('UI to napíše místo toho, aby si provoz vymyslelo.');
  });
}

module.exports = { app, server };
