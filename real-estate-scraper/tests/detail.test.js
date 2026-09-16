import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { parseDetail, paramMap, geoFromHtml, floorFromText } from '../backend/scrapers/detail.js';

// Parametry opsané z detailu na Bezrealitkách (běh „Průzkum zdrojů"
// 2026-09-16). Jména popisků jsou to jediné, na čem parser stojí.
const BEZREALITKY = `<html><body><main>
  <h1>Prodej bytu 2+kk • 40 m² bez realitky</h1>
  <h2>Parametry nemovitosti</h2>
  <dl>
    <dt>Konstrukce budovy</dt><dd>Panel</dd>
    <dt>Stav</dt><dd>Velmi dobrý</dd>
    <dt>Podlaží</dt><dd>11. podlaží z 12</dd>
    <dt>Vytápění</dt><dd>Ústřední</dd>
    <dt>Vlastnictví</dt><dd>Osobní</dd>
    <dt>PENB</dt><dd>C - Úsporná</dd>
    <dt>Vybaveno</dt><dd>Částečně</dd>
  </dl>
  <h2>Co tato nemovitost nabízí?</h2>
  <ul><li>Balkón</li><li>Výtah</li><li>Sklep</li></ul>
  <script>window.__DATA__ = {"gps":{"lat":50.0632765,"lng":14.3107686}};</script>
</main>
<section><h2>Podobné nabídky</h2><ul><li>Garáž</li><li>Terasa</li></ul></section>
</body></html>`;

describe('paramMap', () => {
  const map = paramMap(cheerio.load(BEZREALITKY));

  test('klíče jsou bez diakritiky a malými písmeny', () => {
    assert.equal(map.get('konstrukce budovy'), 'Panel');
    assert.equal(map.get('podlazi'), '11. podlaží z 12');
    assert.equal(map.get('vytapeni'), 'Ústřední');
  });

  test('přečte parametry i ze seznamu, ne jen z <dl>', () => {
    const map2 = paramMap(cheerio.load('<ul><li>Stav: Po rekonstrukci</li></ul>'));
    assert.equal(map2.get('stav'), 'Po rekonstrukci');
  });

  test('první výskyt vyhrává — pozdější sekce popisek nepřepíše', () => {
    const map2 = paramMap(cheerio.load(
      '<dl><dt>Stav</dt><dd>Novostavba</dd></dl><ul><li>Stav: Jiný</li></ul>'
    ));
    assert.equal(map2.get('stav'), 'Novostavba');
  });
});

describe('geoFromHtml', () => {
  test('najde souřadnice v JSONu', () => {
    assert.deepEqual(geoFromHtml(BEZREALITKY), { lat: 50.0632765, lng: 14.3107686 });
  });

  test('najde souřadnice v data- atributech', () => {
    assert.deepEqual(
      geoFromHtml('<div data-latitude="49.1951" data-longitude="16.6068"></div>'),
      { lat: 49.1951, lng: 16.6068 }
    );
  });

  test('celé číslo se za souřadnici nepovažuje', () => {
    assert.deepEqual(geoFromHtml('{"lat": 50, "lng": 14}'), { lat: null, lng: null });
  });

  test('souřadnice mimo Česko se zahodí — bývají z map v patičce', () => {
    assert.deepEqual(
      geoFromHtml('{"lat": 40.7128, "lng": -74.0060}'),
      { lat: null, lng: null }
    );
  });

  test('stránka bez souřadnic nespadne', () => {
    assert.deepEqual(geoFromHtml('<html></html>'), { lat: null, lng: null });
  });
});

describe('floorFromText', () => {
  test('přečte podlaží v obou zápisech', () => {
    assert.equal(floorFromText('11. podlaží z 12'), 11);
    assert.equal(floorFromText('3. NP'), 3);
  });

  test('suterén jako záporné podlaží', () => {
    assert.equal(floorFromText('-1. podlaží'), -1);
  });

  test('text bez podlaží vrátí null', () => {
    assert.equal(floorFromText('Přízemí'), null);
    assert.equal(floorFromText(''), null);
  });
});

describe('parseDetail', () => {
  const detail = parseDetail(BEZREALITKY);

  test('doplní souřadnice pro mapu', () => {
    assert.equal(detail.latitude, 50.0632765);
    assert.equal(detail.longitude, 14.3107686);
  });

  test('přeloží konstrukci a stav na hodnoty číselníku', () => {
    assert.equal(detail.building_type, 'panelova');
    assert.equal(detail.condition, 'dobry');
  });

  test('vybavenost bere z hlavního obsahu', () => {
    assert.deepEqual(detail.amenities.sort(), ['balkon', 'sklep', 'vytah']);
  });

  test('vybavenost z bloku „Podobné nabídky" se nepřitáhne', () => {
    // Garáž a terasa patří cizím inzerátům pod výpisem.
    assert.ok(!detail.amenities.includes('garaz'));
    assert.ok(!detail.amenities.includes('terasa'));
  });

  test('doplní podlaží, PENB, vlastnictví a vytápění', () => {
    assert.equal(detail.floor, 11);
    assert.equal(detail.energy_rating, 'C - Úsporná');
    assert.equal(detail.ownership, 'Osobní');
    assert.equal(detail.heating, 'Ústřední');
  });

  test('stránka bez parametrů nespadne, jen vrátí prázdno', () => {
    const empty = parseDetail('<html><body><p>nic</p></body></html>');
    assert.equal(empty.latitude, null);
    assert.equal(empty.building_type, null);
    assert.deepEqual(empty.amenities, []);
  });
});
