import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'enrich-'));
process.env.SCRAPER_SINK = 'json';
process.env.SCRAPER_DATA_DIR = TMP;

const {
  upsertJson,
  flushJsonSink,
  persistJsonSink,
  listingsNeedingDetail,
  applyDetail,
  __resetJsonSink
} = await import('../backend/scrapers/json-sink.js');

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const read = () => JSON.parse(fs.readFileSync(path.join(TMP, 'listings.json'), 'utf8'));

const listing = (over = {}) => ({
  url: 'https://example.cz/1',
  source: 'idnes',
  city: 'praha',
  district: 'Praha 8',
  listing_type: 'byt',
  price: 9_000_000,
  price_per_m2: 150_000,
  size_m2: 60,
  amenities: '[]',
  photos: '[]',
  ...over
});

describe('výběr inzerátů k dohledání', () => {
  beforeEach(() => {
    __resetJsonSink();
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
  });

  test('bere jen ty, u kterých se to ještě nezkoušelo', () => {
    upsertJson(listing({ url: 'https://a/1' }));
    upsertJson(listing({ url: 'https://a/2' }));
    persistJsonSink();

    applyDetail('https://a/1', { latitude: 50.1, longitude: 14.4 });

    assert.deepEqual(
      listingsNeedingDetail().map((l) => l.url),
      ['https://a/2']
    );
  });

  test('začíná od nejnovějších — dávka se za noc nestihne celá', () => {
    upsertJson(listing({ url: 'https://a/stary' }), new Date('2026-01-01T00:00:00Z'));
    upsertJson(listing({ url: 'https://a/novy' }), new Date('2026-09-01T00:00:00Z'));

    assert.deepEqual(
      listingsNeedingDetail().map((l) => l.url),
      ['https://a/novy', 'https://a/stary']
    );
  });

  test('omezí se na zadané zdroje — Sreality detail nedávají', () => {
    upsertJson(listing({ url: 'https://a/1', source: 'sreality' }));
    upsertJson(listing({ url: 'https://a/2', source: 'idnes' }));

    assert.deepEqual(
      listingsNeedingDetail({ sources: ['idnes', 'bezrealitky'] }).map((l) => l.url),
      ['https://a/2']
    );
  });

  test('respektuje velikost dávky', () => {
    for (let i = 0; i < 5; i += 1) upsertJson(listing({ url: `https://a/${i}` }));
    assert.equal(listingsNeedingDetail({ limit: 3 }).length, 3);
  });
});

describe('zápis dohledaných údajů', () => {
  beforeEach(() => {
    __resetJsonSink();
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
    upsertJson(listing());
  });

  test('doplní souřadnice a vybavenost', () => {
    applyDetail('https://example.cz/1', {
      latitude: 50.0632,
      longitude: 14.3107,
      amenities: ['balkon', 'vytah'],
      building_type: 'panelova'
    });
    persistJsonSink();

    const [row] = read().listings;
    assert.equal(row.latitude, 50.0632);
    assert.deepEqual(row.amenities, ['balkon', 'vytah']);
    assert.equal(row.building_type, 'panelova');
  });

  test('prázdná hodnota nepřepíše to, co už víme z výpisu', () => {
    applyDetail('https://example.cz/1', {
      size_m2: null,
      price: undefined,
      amenities: [],
      latitude: 50.1
    });
    persistJsonSink();

    const [row] = read().listings;
    assert.equal(row.size_m2, 60);
    assert.equal(row.price, 9_000_000);
    assert.deepEqual(row.amenities, []);
    assert.equal(row.latitude, 50.1);
  });

  test('označí i neúspěšný pokus, ať se mrtvá adresa nezkouší dokola', () => {
    applyDetail('https://example.cz/1', {});
    assert.deepEqual(listingsNeedingDetail(), []);
  });

  test('neznámá adresa nic nerozbije', () => {
    assert.equal(applyDetail('https://nikde/1', { latitude: 50 }), false);
  });
});

describe('zápis bez prořezávání', () => {
  beforeEach(() => {
    __resetJsonSink();
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
  });

  test('dohledávání nesmí vyházet inzeráty, které samo nestahovalo', () => {
    // Dohledávání běží jako samostatný krok a z výpisu nic nestahuje.
    // Kdyby zapisovalo přes flushJsonSink, přišlo by mu, že celá stará
    // nabídka zmizela z trhu.
    const davno = new Date(Date.now() - 40 * 86400000);
    upsertJson(listing({ url: 'https://a/1' }), davno);
    upsertJson(listing({ url: 'https://a/2' }), davno);
    persistJsonSink();

    __resetJsonSink();
    applyDetail('https://a/1', { latitude: 50.1 });
    assert.equal(persistJsonSink(), 2);

    __resetJsonSink();
    assert.equal(flushJsonSink(), 0); // pro srovnání: scrape běh by je vyřadil
  });

  test('řadí podle URL, ať je commit čitelný diff', () => {
    upsertJson(listing({ url: 'https://a/9' }));
    upsertJson(listing({ url: 'https://a/2' }));
    persistJsonSink();

    assert.deepEqual(read().listings.map((l) => l.url), ['https://a/2', 'https://a/9']);
  });
});
