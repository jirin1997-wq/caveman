import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sink-'));
process.env.SCRAPER_SINK = 'json';
process.env.SCRAPER_DATA_DIR = TMP;

const { upsertJson, flushJsonSink, writeJsonSnapshot, jsonSinkEnabled, __resetJsonSink } =
  await import('../backend/scrapers/json-sink.js');

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const read = (name) => JSON.parse(fs.readFileSync(path.join(TMP, name), 'utf8'));

const listing = (over = {}) => ({
  url: 'https://example.cz/1',
  source: 'sreality',
  city: 'praha',
  district: 'Praha 10',
  listing_type: 'byt',
  price: 9_000_000,
  price_per_m2: 120_000,
  size_m2: 75,
  amenities: JSON.stringify(['balkon']),
  photos: JSON.stringify(['https://img/1.jpg']),
  ...over
});

describe('json sink', () => {
  beforeEach(() => {
    __resetJsonSink();
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
  });

  test('zapíná se jen přes SCRAPER_SINK=json', () => {
    assert.equal(jsonSinkEnabled(), true);
  });

  test('nový inzerát založí historii ceny', () => {
    assert.equal(upsertJson(listing()), 'created');
    flushJsonSink();

    const [row] = read('listings.json').listings;
    assert.equal(row.price_history.length, 1);
    assert.equal(row.is_discounted, false);
    assert.ok(row.first_seen_at);
  });

  test('amenities a photos se ukládají jako pole, ne jako řetězec', () => {
    upsertJson(listing());
    flushJsonSink();

    const [row] = read('listings.json').listings;
    assert.deepEqual(row.amenities, ['balkon']);
    assert.deepEqual(row.photos, ['https://img/1.jpg']);
  });

  test('nečitelný JSON v poli nezpůsobí pád, jen prázdné pole', () => {
    upsertJson(listing({ amenities: '{tohle není json' }));
    flushJsonSink();
    assert.deepEqual(read('listings.json').listings[0].amenities, []);
  });

  test('stejná cena podruhé je "unchanged" a historii nenafukuje', () => {
    upsertJson(listing());
    assert.equal(upsertJson(listing()), 'unchanged');
    flushJsonSink();
    assert.equal(read('listings.json').listings[0].price_history.length, 1);
  });

  test('zlevnění uschová původní cenu a přidá záznam do historie', () => {
    upsertJson(listing());
    assert.equal(upsertJson(listing({ price: 8_500_000 })), 'updated');
    flushJsonSink();

    const [row] = read('listings.json').listings;
    assert.equal(row.is_discounted, true);
    assert.equal(row.original_price, 9_000_000);
    assert.equal(row.price, 8_500_000);
    assert.equal(row.price_history.length, 2);
  });

  test('zdražení historii zapíše, ale za zlevnění se nevydává', () => {
    upsertJson(listing());
    upsertJson(listing({ price: 9_500_000 }));
    flushJsonSink();

    const [row] = read('listings.json').listings;
    assert.equal(row.is_discounted, false);
    assert.equal(row.original_price, null);
    assert.equal(row.price_history.length, 2);
  });

  test('first_seen_at drží stáří inzerátu i po přepsání', () => {
    upsertJson(listing(), new Date('2026-01-01T00:00:00Z'));
    upsertJson(listing({ price: 8_000_000 }), new Date('2026-06-01T00:00:00Z'));
    flushJsonSink();

    const [row] = read('listings.json').listings;
    assert.equal(row.first_seen_at, '2026-01-01T00:00:00.000Z');
    assert.equal(row.last_scraped, '2026-06-01T00:00:00.000Z');
  });

  test('data z minulého běhu se načtou ze souboru, ne z paměti', () => {
    upsertJson(listing());
    flushJsonSink();

    __resetJsonSink();
    assert.equal(upsertJson(listing({ price: 8_000_000 })), 'updated');
    flushJsonSink();

    assert.equal(read('listings.json').count, 1);
  });

  test('inzeráty řadí podle URL, ať je denní commit čitelný', () => {
    upsertJson(listing({ url: 'https://example.cz/9' }));
    upsertJson(listing({ url: 'https://example.cz/2' }));
    flushJsonSink();

    assert.deepEqual(
      read('listings.json').listings.map((l) => l.url),
      ['https://example.cz/2', 'https://example.cz/9']
    );
  });

  test('inzerát, který zmizel z nabídky, po čase vypadne ze souboru', () => {
    // Předchozí běh: obojí v nabídce, ale dávno.
    const davno = new Date(Date.now() - 40 * 86400000);
    upsertJson(listing({ url: 'https://example.cz/stazeny' }), davno);
    upsertJson(listing({ url: 'https://example.cz/trvajici' }), davno);
    flushJsonSink(davno);

    // Dnešní běh: zdroj nabízí už jen jeden z nich.
    __resetJsonSink();
    upsertJson(listing({ url: 'https://example.cz/trvajici' }));
    flushJsonSink();

    assert.deepEqual(
      read('listings.json').listings.map((l) => l.url),
      ['https://example.cz/trvajici']
    );
  });

  test('inzerát viděný v tomhle běhu zůstane, i když měl staré datum', () => {
    const davno = new Date(Date.now() - 40 * 86400000);
    upsertJson(listing({ url: 'https://example.cz/1' }), davno);
    flushJsonSink();

    assert.equal(read('listings.json').count, 1);
  });
});

describe('snímek trhu z JSONu', () => {
  beforeEach(() => {
    __resetJsonSink();
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
  });

  test('spočítá medián za město i za čtvrť', () => {
    upsertJson(listing({ url: 'https://a/1', price_per_m2: 100_000 }));
    upsertJson(listing({ url: 'https://a/2', price_per_m2: 140_000 }));
    flushJsonSink();
    writeJsonSnapshot(new Date('2026-08-20T02:00:00Z'));

    const rows = read('market-snapshots.json').snapshots;
    const city = rows.find((r) => r.district === null);
    assert.equal(city.median_price_per_m2, 120_000);
    assert.equal(city.sample_size, 2);
    assert.ok(rows.find((r) => r.district === 'Praha 10'));
  });

  test('opakovaný běh v jednom dni snímek přepíše, nezdvojí', () => {
    upsertJson(listing());
    flushJsonSink();
    writeJsonSnapshot(new Date('2026-08-20T02:00:00Z'));
    const first = read('market-snapshots.json').snapshots.length;

    writeJsonSnapshot(new Date('2026-08-20T14:00:00Z'));
    assert.equal(read('market-snapshots.json').snapshots.length, first);
  });

  test('snímky z různých dnů se hromadí', () => {
    upsertJson(listing());
    flushJsonSink();
    writeJsonSnapshot(new Date('2026-08-19T02:00:00Z'));
    writeJsonSnapshot(new Date('2026-08-20T02:00:00Z'));

    const dates = [...new Set(read('market-snapshots.json').snapshots.map((s) => s.snapshot_date))];
    assert.deepEqual(dates, ['2026-08-19', '2026-08-20']);
  });

  test('bez ceny za m² se snímek nezapíše a nepřepíše ten poslední dobrý', () => {
    upsertJson(listing({ price_per_m2: null }));
    flushJsonSink();
    assert.equal(writeJsonSnapshot(new Date('2026-08-20T02:00:00Z')), 0);
    assert.equal(fs.existsSync(path.join(TMP, 'market-snapshots.json')), false);
  });
});
