// End-to-end test of the HTTP surface with the network stubbed out.
//
// This container has no outbound access, so the only way to prove the full
// path works — request in, upstream fetch, parse, response out — is to stand in
// for the upstream with realistic payloads. Everything except the socket itself
// is the real code.

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const axios = require('axios');

const realGet = axios.get;

// --- fixtures shaped like the real upstreams ---------------------------

const ADSB_LOL = {
  ac: [
    {
      hex: '49d0f5', flight: 'CSA1234 ', r: 'OK-NEP', t: 'A21N',
      desc: 'AIRBUS A-321neo', ownOp: 'Czech Airlines', year: '2019',
      category: 'A3', lat: 50.25, lon: 14.26, alt_baro: 3200,
      gs: 190, track: 200, baro_rate: -900, squawk: '4531',
    },
    {
      hex: '3c6444', flight: 'DLH42   ', t: 'B77W', r: 'D-ABCD',
      lat: 50.1015, lon: 14.2605, alt_baro: 'ground', gs: 8,
      track: 120, category: 'A5',
    },
    {
      hex: '4ca7b2', flight: 'RYR8GT  ', t: 'B738', lat: 50.02, lon: 14.18,
      alt_baro: 7000, gs: 260, track: 40, baro_rate: 2200, category: 'A3',
    },
  ],
};

const LIVEATC_SEARCH = `<html><body>
<tr><td><strong>Prague Ruzyne Tower</strong></td><td><a href="/play/lkpr_twr.pls">P</a></td></tr>
<tr><td><strong>Prague Ruzyne Ground</strong></td><td><a href="/play/lkpr_gnd.pls">P</a></td></tr>
<tr><td><strong>Prague Clearance Delivery</strong></td><td><a href="/play/lkpr_del.pls">P</a></td></tr>
</body></html>`;

const LIVEATC_PLS = `[playlist]
NumberOfEntries=1
File1=https://s1-fmt2.liveatc.net/lkpr_twr
`;

const PLANESPOTTERS = {
  photos: [
    {
      id: 'p1',
      thumbnail: { src: 'https://cdn.planespotters.net/thumb.jpg' },
      thumbnail_large: { src: 'https://cdn.planespotters.net/large.jpg' },
      link: 'https://www.planespotters.net/photo/p1',
      photographer: 'Jan Novák',
    },
  ],
};

const AUDIO_BYTES = Buffer.from('ID3fake-mp3-payload');

function stubNetwork() {
  axios.get = async (url, opts = {}) => {
    if (url.includes('api.adsb.lol')) return { data: ADSB_LOL, status: 200 };
    if (url.includes('airplanes.live') || url.includes('opensky')) {
      const e = new Error('stub: not reached');
      e.code = 'ESTUB';
      throw e;
    }
    if (url.includes('liveatc.net/search')) return { data: LIVEATC_SEARCH, status: 200 };
    if (url.includes('liveatc.net/play')) return { data: LIVEATC_PLS, status: 200 };
    if (url.includes('s1-fmt2.liveatc.net')) {
      return {
        data: Readable.from([AUDIO_BYTES]),
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      };
    }
    if (url.includes('planespotters.net')) return { data: PLANESPOTTERS, status: 200 };
    throw new Error(`unstubbed URL: ${url}`);
  };
}

// --- boot the real server on an ephemeral port -------------------------

stubNetwork();
const { server } = require('../server/index');

let base;
test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  axios.get = realGet;
  server.close();
});

// --- the tests ---------------------------------------------------------

// Serving the page from the API server is what removes the CORS question
// entirely, and it is what the desktop shell loads. An earlier build pointed
// its window at a port nothing served, so this is pinned.
test('GET / serves the web app from the same origin as the API', async () => {
  const r = await fetch(`${base}/`);
  const html = await r.text();

  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /text\/html/);
  assert.match(html, /<title>ATC Live/, 'the root must be the application page');
  assert.match(html, /id="scope"/, 'the radar canvas must be present');
});

test('GET /api/airports lists the airports', async () => {
  const r = await fetch(`${base}/api/airports`);
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.ok(body.some((a) => a.icao === 'LKPR'));
});

test('GET /api/traffic returns live aircraft with identity fields', async () => {
  const r = await fetch(`${base}/api/traffic/LKPR`);
  const body = await r.json();

  assert.equal(body.live, true);
  assert.equal(body.source, 'adsb.lol');
  assert.equal(body.aircraft.length, 3);

  const csa = body.aircraft.find((a) => a.callsign === 'CSA1234');
  assert.equal(csa.registration, 'OK-NEP');
  assert.equal(csa.typeName, 'AIRBUS A-321neo');
  assert.equal(csa.operator, 'Czech Airlines');
  assert.equal(csa.categoryName, 'Velké (34–136 t)');
});

test('GET /api/traffic classifies the movement board', async () => {
  const { board } = await (await fetch(`${base}/api/traffic/LKPR`)).json();

  assert.deepEqual(board.arriving.map((a) => a.callsign), ['CSA1234']);
  assert.deepEqual(board.departing.map((a) => a.callsign), ['RYR8GT']);
  assert.deepEqual(board.ground.map((a) => a.callsign), ['DLH42']);
  assert.ok(board.arriving[0].distanceKm > 0, 'distance is computed for the strip');
});

test('GET /api/traffic rejects an unknown airport', async () => {
  const r = await fetch(`${base}/api/traffic/ZZZZ`);
  assert.equal(r.status, 404);
});

test('GET /api/feeds discovers feeds and groups them into positions', async () => {
  const r = await fetch(`${base}/api/feeds/LKPR`);
  const body = await r.json();

  assert.equal(body.available, true);
  assert.equal(body.feeds.length, 3);
  assert.deepEqual(
    body.positions.map((p) => p.key),
    ['delivery', 'ground', 'tower'],
    'positions come back in operational order, only those that exist'
  );
  assert.equal(body.positions.find((p) => p.key === 'tower').feeds[0].id, 'lkpr_twr');
});

test('GET /api/stream pipes the upstream audio through', async () => {
  const r = await fetch(`${base}/api/stream/lkpr_twr`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'audio/mpeg');
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.toString(), AUDIO_BYTES.toString());
});

test('GET /api/photo returns the photo with its mandatory credit', async () => {
  const r = await fetch(`${base}/api/photo/49d0f5`);
  const body = await r.json();

  assert.equal(body.available, true);
  assert.equal(body.photo.photographer, 'Jan Novák');
  assert.equal(body.photo.credit, 'Planespotters.net');
  assert.ok(body.photo.large.startsWith('https://'));
});

test('GET /api/photo rejects a malformed hex without calling upstream', async () => {
  const r = await fetch(`${base}/api/photo/not-a-hex`);
  const body = await r.json();
  assert.equal(body.available, false);
  assert.equal(body.photo, null);
});

test('an upstream outage surfaces as live:false with reasons, never as fake traffic', async () => {
  const saved = axios.get;
  axios.get = async () => {
    const e = new Error('getaddrinfo ENOTFOUND');
    e.code = 'ENOTFOUND';
    throw e;
  };

  const body = await (await fetch(`${base}/api/traffic/EGLL`)).json();
  axios.get = saved;

  assert.equal(body.live, false);
  assert.deepEqual(body.aircraft, [], 'no invented aircraft on failure');
  assert.equal(body.errors.length, 3, 'every source that failed is named');
  assert.ok(body.errors.every((e) => e.includes('ENOTFOUND')));
});
