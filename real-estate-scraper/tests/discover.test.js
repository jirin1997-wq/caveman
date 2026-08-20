import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { priceContainers, apiHints, listingLinks } from '../backend/scrapers/discover.js';

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
