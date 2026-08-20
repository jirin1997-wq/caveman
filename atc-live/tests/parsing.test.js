// Tests for everything that turns an outside payload into app data.
// These run offline against fixtures — which is the point: parsing bugs are
// where the real defects live, and they must be catchable without a network.

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseFeedPage, parsePls } = require('../server/liveatc');
const { groupFeeds, positionFor } = require('../server/positions');
const { fromReadsb, normalize } = require('../server/adsb');
const { buildBoard, distanceKm, compass } = require('../server/movements');
const { describeSquawk, describeCategory, wakeClass } = require('../server/aircraft-meta');
const { getAirport } = require('../server/airports');
const RadioSystem = require('../server/radio');

// --- LiveATC page parsing ----------------------------------------------

const FEED_PAGE = `
<html><body>
<table>
  <tr><td><strong>Prague Ruzyne Tower</strong></td>
      <td><a href="/play/lkpr_twr.pls">Play</a></td></tr>
  <tr><td><strong>Prague Ruzyne Ground</strong></td>
      <td><a href="hlisten.cgi?mount=lkpr_gnd&icao=lkpr">Listen</a></td></tr>
  <tr><td><strong>Prague Approach</strong></td>
      <td><a href="/play/lkpr_app.pls">Play</a></td></tr>
</table>
</body></html>`;

test('parseFeedPage finds feeds from both .pls links and mount params', () => {
  const feeds = parseFeedPage(FEED_PAGE);
  const ids = feeds.map((f) => f.id).sort();
  assert.deepEqual(ids, ['lkpr_app', 'lkpr_gnd', 'lkpr_twr']);
});

test('parseFeedPage picks up the human label next to each feed', () => {
  const feeds = parseFeedPage(FEED_PAGE);
  const twr = feeds.find((f) => f.id === 'lkpr_twr');
  assert.equal(twr.label, 'Prague Ruzyne Tower');
});

test('parseFeedPage returns empty for an airport with no feeds', () => {
  assert.deepEqual(parseFeedPage('<html><body>No feeds found.</body></html>'), []);
});

test('parsePls extracts every stream mirror in order', () => {
  const pls = `[playlist]
NumberOfEntries=2
File1=https://s1-fmt2.liveatc.net/lkpr_twr
Title1=LKPR Tower
File2=https://s1-bos.liveatc.net/lkpr_twr
Length1=-1`;
  assert.deepEqual(parsePls(pls), [
    'https://s1-fmt2.liveatc.net/lkpr_twr',
    'https://s1-bos.liveatc.net/lkpr_twr',
  ]);
});

test('parsePls returns empty on an error page rather than throwing', () => {
  assert.deepEqual(parsePls('<html>404 Not Found</html>'), []);
});

// --- position classification -------------------------------------------

test('feeds are classified into ATC positions by id suffix', () => {
  assert.equal(positionFor({ id: 'lkpr_twr', label: '' }), 'tower');
  assert.equal(positionFor({ id: 'lkpr_gnd', label: '' }), 'ground');
  assert.equal(positionFor({ id: 'kjfk_del', label: '' }), 'delivery');
  assert.equal(positionFor({ id: 'eham_app', label: '' }), 'approach');
  assert.equal(positionFor({ id: 'eddf_ctr', label: '' }), 'radar');
  assert.equal(positionFor({ id: 'lkpr_atis', label: '' }), 'atis');
});

test('classification falls back to the label when the id is opaque', () => {
  assert.equal(positionFor({ id: 'feed12345', label: 'Heathrow Director' }), 'approach');
  assert.equal(positionFor({ id: 'xyz', label: 'Clearance Delivery' }), 'delivery');
});

test('an unrecognisable feed lands in "other", not in a wrong position', () => {
  assert.equal(positionFor({ id: 'zzz999', label: 'Unnamed feed' }), 'other');
});

test('groupFeeds omits positions that have no feed', () => {
  const groups = groupFeeds([
    { id: 'lkpr_twr', label: 'Tower' },
    { id: 'lkpr_gnd', label: 'Ground' },
  ]);
  assert.deepEqual(
    groups.map((g) => g.key),
    ['ground', 'tower']
  );
  assert.equal(groups.find((g) => g.key === 'tower').feeds.length, 1);
});

// --- ADS-B normalisation -----------------------------------------------

const READSB_SAMPLE = [
  {
    hex: '49d0f5',
    flight: 'CSA1234 ',
    r: 'OK-NEP',
    t: 'A21N',
    desc: 'AIRBUS A-321neo',
    ownOp: 'Czech Airlines',
    year: '2019',
    category: 'A3',
    lat: 50.12,
    lon: 14.3,
    alt_baro: 4500,
    gs: 210.4,
    track: 63.2,
    baro_rate: -1024,
    squawk: '7700',
  },
  {
    hex: '3c6444',
    flight: 'DLH42   ',
    t: 'B77W',
    lat: 50.05,
    lon: 14.2,
    alt_baro: 'ground',
    gs: 12,
    track: 180,
    category: 'A5',
  },
  { hex: 'nopos', flight: 'GHOST1', lat: null, lon: null }, // must be dropped
];

test('readsb payloads are normalised with identity fields intact', () => {
  const list = fromReadsb(READSB_SAMPLE, 'adsb.lol');
  assert.equal(list.length, 2, 'aircraft without a position must be dropped');

  const a = list[0];
  assert.equal(a.callsign, 'CSA1234', 'callsign is trimmed');
  assert.equal(a.registration, 'OK-NEP');
  assert.equal(a.type, 'A21N');
  assert.equal(a.typeName, 'AIRBUS A-321neo');
  assert.equal(a.operator, 'Czech Airlines');
  assert.equal(a.altitude, 4500);
  assert.equal(a.source, 'adsb.lol');
});

test('"ground" altitude becomes 0 ft and sets the on-ground flag', () => {
  const [, onGround] = fromReadsb(READSB_SAMPLE, 'adsb.lol');
  assert.equal(onGround.onGround, true);
  assert.equal(onGround.altitude, 0);
});

test('missing identity fields stay null instead of being invented', () => {
  const [, second] = fromReadsb(READSB_SAMPLE, 'adsb.lol');
  assert.equal(second.registration, null);
  assert.equal(second.operator, null);
  assert.equal(second.year, null);
  assert.equal(second.typeName, null);
});

test('emergency squawks are decoded and flagged critical', () => {
  const [first] = fromReadsb(READSB_SAMPLE, 'adsb.lol');
  assert.equal(first.squawkMeaning.label, 'NOUZE');
  assert.equal(first.squawkMeaning.severity, 'critical');
});

test('squawk and category decoding is exact, not fuzzy', () => {
  assert.equal(describeSquawk('7600').label, 'ZTRÁTA SPOJENÍ');
  assert.equal(describeSquawk('1234'), null, 'ordinary codes have no meaning to show');
  assert.equal(describeCategory('A5'), 'Těžké (nad 136 t)');
  assert.equal(describeCategory('ZZ'), null);
  assert.equal(wakeClass('A5'), 'Heavy');
  assert.equal(wakeClass(null), null, 'unknown category must not imply a wake class');
});

test('OpenSky-style records normalise without type data rather than faking it', () => {
  const ac = normalize({
    id: 'abc123',
    callsign: 'RYR99',
    lat: 50.1,
    lon: 14.26,
    alt: 30000,
    gs: 450,
    track: 90,
    vs: 0,
    source: 'opensky',
  });
  assert.equal(ac.type, null);
  assert.equal(ac.registration, null);
  assert.equal(ac.source, 'opensky');
});

// --- movement board ----------------------------------------------------

const LKPR = getAirport('LKPR');

test('distanceKm matches known separations', () => {
  // LKPR->LKTB is ~205 km, NOT the ~185 km quoted for Praha->Brno city centres:
  // LKPR sits northwest of Prague and LKTB southeast of Brno, so the airports
  // are further apart than the cities. Cross-checked against an independent
  // equirectangular calculation.
  const brno = distanceKm(50.1008, 14.26, 49.1513, 16.6944);
  assert.ok(brno > 202 && brno < 207, `LKPR->LKTB expected ~205 km, got ${brno}`);

  const heathrow = distanceKm(50.1008, 14.26, 51.47, -0.4543);
  assert.ok(heathrow > 1035 && heathrow < 1050, `LKPR->EGLL expected ~1044 km, got ${heathrow}`);

  assert.equal(distanceKm(50.1008, 14.26, 50.1008, 14.26), 0);
});

test('compass points are derived from bearing correctly', () => {
  assert.equal(compass(0), 'S');
  assert.equal(compass(90), 'V');
  assert.equal(compass(180), 'J');
  assert.equal(compass(270), 'Z');
});

test('board separates ground, arriving, departing and transit', () => {
  const aircraft = [
    // on the field, on the ground
    normalize({ id: '1', callsign: 'GND1', lat: 50.101, lon: 14.261, alt: 0, onGround: true, source: 't' }),
    // close in, descending -> arriving
    normalize({ id: '2', callsign: 'ARR1', lat: 50.2, lon: 14.4, alt: 4000, vs: -1200, source: 't' }),
    // close in, climbing -> departing
    normalize({ id: '3', callsign: 'DEP1', lat: 50.0, lon: 14.1, alt: 6000, vs: 1800, source: 't' }),
    // high and level far away -> transit
    normalize({ id: '4', callsign: 'OVR1', lat: 50.6, lon: 14.9, alt: 36000, vs: 0, source: 't' }),
  ];

  const board = buildBoard(aircraft, LKPR);
  assert.deepEqual(board.ground.map((a) => a.callsign), ['GND1']);
  assert.deepEqual(board.arriving.map((a) => a.callsign), ['ARR1']);
  assert.deepEqual(board.departing.map((a) => a.callsign), ['DEP1']);
  assert.deepEqual(board.transit.map((a) => a.callsign), ['OVR1']);
});

test('an aircraft on the ground at another field is not counted as ours', () => {
  const faraway = normalize({
    id: '9', callsign: 'OTHER', lat: 49.1513, lon: 16.6944, alt: 0, onGround: true, source: 't',
  });
  const board = buildBoard([faraway], LKPR);
  assert.equal(board.ground.length, 0, 'Brno traffic must not appear on the Prague ground list');
  assert.equal(board.transit.length, 1);
});

test('board entries carry distance and bearing for the strip display', () => {
  const ac = normalize({ id: '1', callsign: 'X', lat: 50.3, lon: 14.26, alt: 5000, vs: -800, source: 't' });
  const [entry] = buildBoard([ac], LKPR).arriving;
  assert.ok(entry.distanceKm > 20 && entry.distanceKm < 25, `got ${entry.distanceKm}`);
  assert.equal(entry.compass, 'S', 'due north of the field');
});

test('an empty traffic snapshot produces an empty board, not filler', () => {
  const board = buildBoard([], LKPR);
  assert.deepEqual(board.ground, []);
  assert.deepEqual(board.arriving, []);
  assert.deepEqual(board.all, []);
});

// --- radio -------------------------------------------------------------

test('radio keeps channels separate', () => {
  const r = new RadioSystem();
  r.transmit({ callsign: 'A', role: 'pilot', channel: 'lkpr_twr', text: 'ahoj' });
  r.transmit({ callsign: 'B', role: 'atc', channel: 'lkpr_gnd', text: 'nazdar' });
  assert.equal(r.history('lkpr_twr').length, 1);
  assert.equal(r.history('lkpr_gnd')[0].callsign, 'B');
  assert.equal(r.history('lkpr_app').length, 0);
});

test('radio messages are marked as user chat, never as live ATC', () => {
  const r = new RadioSystem();
  const m = r.transmit({ callsign: 'X', role: 'atc', channel: 'c', text: 'hi' });
  assert.equal(m.kind, 'user');
});

test('radio clamps oversized input and unknown roles', () => {
  const r = new RadioSystem();
  const m = r.transmit({
    callsign: 'X'.repeat(50), role: 'hacker', channel: 'c', text: 'y'.repeat(900),
  });
  assert.equal(m.callsign.length, 16);
  assert.equal(m.text.length, 500);
  assert.equal(m.role, 'pilot', 'unrecognised roles fall back to pilot');
});

test('radio history is capped so a long session cannot grow without bound', () => {
  const r = new RadioSystem(10);
  for (let i = 0; i < 25; i++) r.transmit({ callsign: 'A', role: 'pilot', channel: 'c', text: `${i}` });
  const hist = r.history('c', 100);
  assert.equal(hist.length, 10);
  assert.equal(hist.at(-1).text, '24', 'the newest message survives');
});

// --- airports ----------------------------------------------------------

test('airport lookup is case-insensitive and rejects unknown codes', () => {
  assert.equal(getAirport('lkpr').icao, 'LKPR');
  assert.equal(getAirport('LKPR').city, 'Praha');
  assert.equal(getAirport('XXXX'), null);
  assert.equal(getAirport(undefined), null);
});
