import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import {
  priceContainers,
  apiHints,
  listingLinks,
  pageOutline,
  paramPairs,
  geoHints,
  jsonLdBlocks
} from '../backend/scrapers/discover.js';

const page = `<!doctype html><html><head><title>Výpis</title></head><body>
  <script>fetch("/api/v3/estates?page=1"); var g = "https://api.example.cz/graphql";</script>
  <a href="/nemovitosti/praha/">Byty Praha</a>
  <a href="/o-nas">O nás</a>
  <a href="#nahoru">Nahoru</a>
  <article class="property-card" data-id="1">
    <h3 class="property-card__title">Byt 2+kk</h3>
    <span class="property-card__price">4 500 000 Kč</span>
  </article>
  <article class="property-card" data-id="2">
    <h3 class="property-card__title">Byt 3+kk</h3>
    <span class="property-card__price">6 900 000 Kč</span>
  </article>
</body></html>`;

describe('priceContainers', () => {
  test('najde prvek, ve kterém cena stojí', () => {
    const sigs = priceContainers(cheerio.load(page)).map(([s]) => s);
    assert.ok(sigs.some((s) => s.includes('property-card__price')));
  });

  test('vyleze i na kartu nad cenou — to je hledaný selektor', () => {
    const sigs = priceContainers(cheerio.load(page)).map(([s]) => s);
    const card = sigs.find((s) => s.startsWith('article.property-card'));
    assert.ok(card, `karta nenalezena, otisky: ${sigs.join(' | ')}`);
    assert.match(card, /data-id/);
  });

  test('karta se počítá jednou za nemovitost, ne za každý text', () => {
    const card = priceContainers(cheerio.load(page)).find(([s]) =>
      s.startsWith('article.property-card')
    );
    assert.equal(card[1], 2);
  });

  test('stránka bez ceny nevrátí nic — poznávací znamení JS výpisu', () => {
    const $ = cheerio.load('<div class="card"><span>Cena na vyžádání</span></div>');
    assert.deepEqual(priceContainers($), []);
  });

  test('cena bez oddělovačů tisíců projde taky', () => {
    const $ = cheerio.load('<div class="p"><b>4500000 Kč</b></div>');
    assert.ok(priceContainers($).length > 0);
  });
});

describe('apiHints', () => {
  test('vytáhne relativní API cestu i absolutní GraphQL adresu', () => {
    const hints = apiHints(page);
    assert.ok(hints.includes('/api/v3/estates?page=1'));
    assert.ok(hints.some((h) => h.includes('graphql')));
  });

  test('stránka bez API nevrátí nic', () => {
    assert.deepEqual(apiHints('<html><body>nic</body></html>'), []);
  });
});

describe('listingLinks', () => {
  const links = listingLinks(cheerio.load(page), 'https://example.cz/');

  test('vezme odkaz na výpis a složí ho na absolutní', () => {
    assert.ok(links.includes('https://example.cz/nemovitosti/praha/'));
  });

  test('nesouvisející odkazy a kotvy vynechá', () => {
    assert.ok(!links.some((l) => l.includes('o-nas')));
    assert.ok(!links.some((l) => l.includes('#')));
  });
});

describe('pageOutline', () => {
  const site = `<html><head><title>Kalkulačka</title></head><body>
    <nav><a href="/hypoteka">Hypotéka</a><a href="/refinancovani">Refinancování</a></nav>
    <h1>Spočítej si splátku</h1>
    <h2>Parametry úvěru</h2>
    <form>
      <input type="number" name="kupniCena" placeholder="Kupní cena">
      <input type="number" name="vlastniZdroje">
      <select name="fixace"><option>3 roky</option></select>
      <textarea id="poznamka"></textarea>
    </form>
    <button>Spočítat</button><button>Spočítat</button>
  </body></html>`;

  const parts = pageOutline(cheerio.load(site));

  test('vypíše nadpisy i s úrovní', () => {
    assert.deepEqual(parts.headings, ['h1 Spočítej si splátku', 'h2 Parametry úvěru']);
  });

  test('vypíše navigaci i s cílem odkazu', () => {
    assert.ok(parts.nav.some((n) => n.includes('Hypotéka → /hypoteka')));
  });

  test('vypíše vstupní pole — z nich je poznat, s čím kalkulačka počítá', () => {
    assert.ok(parts.fields.includes('number: kupniCena'));
    assert.ok(parts.fields.includes('select: fixace'));
    assert.ok(parts.fields.includes('textarea: poznamka'));
  });

  test('stejné tlačítko dvakrát se vypíše jednou', () => {
    assert.deepEqual(parts.buttons, ['Spočítat']);
  });

  test('prázdná stránka nespadne', () => {
    const empty = pageOutline(cheerio.load('<html></html>'));
    assert.deepEqual(empty.headings, []);
    assert.deepEqual(empty.fields, []);
  });
});

describe('čtení detailní stránky', () => {
  const detail = `<html><body>
    <script type="application/ld+json">
      {"@type":"Residence","name":"Byt 2+kk","geo":{"latitude":50.06,"longitude":14.46},"offers":{"price":6400000}}
    </script>
    <script>var map = {"latitude": 50.0755, "longitude": 14.4378};</script>
    <dl>
      <dt>Stavba</dt><dd>Cihlová</dd>
      <dt>Stav objektu</dt><dd>Velmi dobrý</dd>
      <dt>Prázdná</dt><dd></dd>
    </dl>
    <table>
      <tr><th>Podlaží</th><td>3. podlaží z 5</td></tr>
      <tr><th>Výtah</th><td>Ano</td></tr>
      <tr><td>tři</td><td>sloupce</td><td>navíc</td></tr>
    </table>
    <div data-lat="49.1951" data-lng="16.6068"></div>
  </body></html>`;

  const $ = cheerio.load(detail);

  test('vytáhne parametry z <dl> i z tabulky', () => {
    const pairs = paramPairs($);
    assert.ok(pairs.includes('Stavba: Cihlová'));
    assert.ok(pairs.includes('Stav objektu: Velmi dobrý'));
    assert.ok(pairs.includes('Podlaží: 3. podlaží z 5'));
    assert.ok(pairs.includes('Výtah: Ano'));
  });

  test('dvojice bez hodnoty a řádky s jiným počtem sloupců se vynechají', () => {
    const pairs = paramPairs($);
    assert.ok(!pairs.some((p) => p.startsWith('Prázdná')));
    assert.ok(!pairs.some((p) => p.includes('sloupce')));
  });

  test('najde souřadnice v JSONu i v data- atributech', () => {
    const geo = geoHints(detail);
    assert.ok(geo.includes('latitude=50.0755'));
    assert.ok(geo.includes('lat=49.1951'));
  });

  test('celé číslo se za souřadnici nepovažuje', () => {
    assert.deepEqual(geoHints('{"latitude": 50}'), []);
  });

  test('vypíše typy a klíče strukturovaných dat', () => {
    const blocks = jsonLdBlocks($);
    assert.equal(blocks.length, 1);
    assert.match(blocks[0], /^Residence → /);
    assert.match(blocks[0], /geo/);
  });

  test('rozbitý JSON-LD nespadne, jen se ohlásí', () => {
    const broken = cheerio.load('<script type="application/ld+json">{tohle není json</script>');
    assert.match(jsonLdBlocks(broken)[0], /nepodařilo/);
  });
});
