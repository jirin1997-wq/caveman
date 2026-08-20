// The standalone web build (web/index.html) carries its own copy of the
// normalization, classification and metadata logic, because a single static
// file cannot require() the server modules.
//
// A copy silently drifting from its original is the failure mode that matters
// here: both screens keep rendering, they just start disagreeing about what
// the same transponder said. These tests pin the copy to the server modules by
// running both over identical fixtures and demanding identical output.
//
// The web file is parsed, not imported: everything up to the first stateful
// line is pure logic with no DOM access, so it evaluates in Node as-is.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverAdsb = require('../server/adsb');
const serverMoves = require('../server/movements');
const serverMeta = require('../server/aircraft-meta');
const { AIRPORTS } = require('../server/airports');

// --- load the browser copy ---------------------------------------------

function loadWebLogic() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');

  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script, 'web/index.html must contain an inline <script>');

  // Cut at the first line that touches browser state; everything above it is
  // pure. If that marker ever moves, this throws rather than silently testing
  // a shrinking slice of the file.
  const marker = 'const state = {';
  const cut = script[1].indexOf(marker);
  assert.ok(cut > 0, `expected the pure-logic section to end at "${marker}"`);

  const pure = script[1].slice(0, cut);
  const factory = new Function(
    pure + `
    return { AIRPORTS, normalize, fromReadsb, buildBoard, classify,
             distanceKm, bearingDeg, compass, wakeClass,
             describeCategory, describeSquawk, colorForAltitude,
             describePositionSource, openSkyPositionSource, POSITION_SOURCES };`
  );
  return factory();
}

const web = loadWebLogic();

// --- fixtures, shaped like the real upstream ---------------------------

const READSB = [
  {
    hex: '49d0f5', flight: 'CSA1234 ', r: 'OK-NEP', t: 'A21N',
    desc: 'AIRBUS A-321neo', ownOp: 'Czech Airlines', year: '2019',
    category: 'A3', lat: 50.25, lon: 14.26, alt_baro: 3200,
    gs: 190, track: 200, baro_rate: -900, squawk: '4531',
    type: 'adsb_icao',
  },
  {
    hex: '3c6444', flight: 'DLH42   ', t: 'B77W', r: 'D-ABCD',
    lat: 50.1015, lon: 14.2605, alt_baro: 'ground', gs: 8,
    track: 120, category: 'A5', type: 'adsb_icao',
  },
  {
    hex: '4ca7b2', flight: 'RYR8GT  ', t: 'B738', lat: 50.02, lon: 14.18,
    alt_baro: 7000, gs: 260, track: 40, baro_rate: 2200, category: 'A3',
    type: 'mlat', // position computed on the ground, not broadcast
  },
  // no registration, no type, emergency squawk, unknown position source —
  // the "missing data" path
  { hex: '3f1a2b', flight: 'XXX1', lat: 49.9, lon: 14.0, alt_baro: 15000, gs: 300, track: 90, squawk: '7700' },
];

const LKPR = AIRPORTS.find((a) => a.icao === 'LKPR');

// --- the tests ---------------------------------------------------------

test('web/index.html lists the same airports as the server', () => {
  assert.deepEqual(
    web.AIRPORTS.map((a) => a.icao),
    AIRPORTS.map((a) => a.icao)
  );
  for (const a of AIRPORTS) {
    const w = web.AIRPORTS.find((x) => x.icao === a.icao);
    assert.equal(w.lat, a.lat, `${a.icao} latitude must match`);
    assert.equal(w.lon, a.lon, `${a.icao} longitude must match`);
  }
});

test('normalization of a readsb payload is byte-identical to the server', () => {
  const fromServer = serverAdsb.fromReadsb(READSB, 'adsb.lol');
  const fromWeb = web.fromReadsb(READSB, 'adsb.lol');

  assert.equal(fromWeb.length, fromServer.length);
  for (let i = 0; i < fromServer.length; i++) {
    // the server stamps a wall-clock timestamp; the browser copy has no use
    // for it, so compare everything else
    const { timestamp, ...s } = fromServer[i];
    assert.deepEqual(fromWeb[i], s, `aircraft ${i} (${s.callsign}) differs`);
  }
});

test('missing identity fields stay null in the web copy too', () => {
  const [, , , unknown] = web.fromReadsb(READSB, 'adsb.lol');
  assert.equal(unknown.registration, null);
  assert.equal(unknown.type, null);
  assert.equal(unknown.typeName, null);
  assert.equal(unknown.operator, null);
  assert.equal(unknown.wake, null, 'wake class is never guessed from an absent category');
});

test('emergency squawks decode the same on both sides', () => {
  for (const code of ['7500', '7600', '7700', '7000', '1200', '2000', '1234']) {
    assert.deepEqual(web.describeSquawk(code), serverMeta.describeSquawk(code), `squawk ${code}`);
  }
});

test('emitter categories decode the same on both sides', () => {
  for (const code of Object.keys(serverMeta.CATEGORIES).concat(['ZZ', '', null])) {
    assert.deepEqual(web.describeCategory(code), serverMeta.describeCategory(code), `category ${code}`);
    assert.deepEqual(web.wakeClass(code), serverMeta.wakeClass(code), `wake ${code}`);
  }
});

test('a computed (MLAT) position is flagged as an estimate, a broadcast one is not', () => {
  const [csa, , ryr, unknown] = web.fromReadsb(READSB, 'adsb.lol');

  assert.equal(csa.positionSource.label, 'ADS-B');
  assert.equal(csa.estimatedPosition, false, 'a broadcast position is a measurement');

  assert.equal(ryr.positionSource.label, 'MLAT (dopočet)');
  assert.equal(ryr.estimatedPosition, true, 'a computed position must be marked as one');
  assert.match(ryr.positionSource.note, /odhad/);

  // no `type` field at all: say nothing rather than assume ADS-B
  assert.equal(unknown.positionSource, null);
  assert.equal(unknown.estimatedPosition, false);
});

test('position sources decode the same on both sides', () => {
  const codes = Object.keys(serverMeta.POSITION_SOURCES).concat(['ADSB_ICAO', 'nonsense', '', null]);
  for (const code of codes) {
    assert.deepEqual(
      web.describePositionSource(code),
      serverMeta.describePositionSource(code),
      `position source ${code}`
    );
  }
  // OpenSky reports the same thing as an index into a small table
  for (const i of [0, 1, 2, 3, 4, -1, null, 'x']) {
    assert.deepEqual(
      web.openSkyPositionSource(i),
      serverMeta.openSkyPositionSource(i),
      `opensky position_source ${i}`
    );
  }
  assert.equal(serverMeta.openSkyPositionSource(2), 'mlat', 'OpenSky index 2 is MLAT');
});

test('the movement board classifies identically to the server', () => {
  const aircraft = serverAdsb.fromReadsb(READSB, 'adsb.lol');
  const serverBoard = serverMoves.buildBoard(aircraft, LKPR);
  const webBoard = web.buildBoard(aircraft, LKPR);

  for (const bucket of ['arriving', 'departing', 'ground', 'transit']) {
    assert.deepEqual(
      webBoard[bucket].map((a) => a.callsign),
      serverBoard[bucket].map((a) => a.callsign),
      `${bucket} must contain the same aircraft in the same order`
    );
  }
});

test('distance and bearing agree with the server to the metre', () => {
  const brno = AIRPORTS.find((a) => a.icao === 'LKTB');
  assert.equal(
    web.distanceKm(LKPR.lat, LKPR.lon, brno.lat, brno.lon),
    serverMoves.distanceKm(LKPR.lat, LKPR.lon, brno.lat, brno.lon)
  );
  assert.equal(
    web.bearingDeg(LKPR.lat, LKPR.lon, brno.lat, brno.lon),
    serverMoves.bearingDeg(LKPR.lat, LKPR.lon, brno.lat, brno.lon)
  );
  for (let deg = 0; deg < 360; deg += 17) {
    assert.equal(web.compass(deg), serverMoves.compass(deg), `compass ${deg}°`);
  }
});

test('an aircraft parked at Brno is not on Prague\'s ground list', () => {
  const atBrno = web.fromReadsb(
    [{ hex: 'abc123', flight: 'CSA9', lat: 49.1513, lon: 16.6944, alt_baro: 'ground', gs: 0, track: 0 }],
    'adsb.lol'
  );
  const board = web.buildBoard(atBrno, LKPR);
  assert.equal(board.ground.length, 0);
  assert.equal(board.transit.length, 1);
  assert.ok(board.transit[0].distanceKm > 200, 'Brno is far outside the Prague terminal area');
});

test('the web build never ships a fallback aircraft or a stand-in photo', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  assert.ok(!/placeholder\.(jpg|png)|via\.placeholder|dummyimage/i.test(html),
    'no stand-in image may be referenced');
  assert.ok(!/Math\.random/.test(html),
    'nothing on this page may be randomly generated — that is how fake traffic gets in');
});
