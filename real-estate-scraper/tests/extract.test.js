import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import {
  priceFromText,
  areaFromText,
  dispositionFromText,
  localityFromCard,
  cardsFromLinks,
  areaFromCard,
  dispositionFromCard,
  cityFromLocality,
  unnbsp
} from '../backend/scrapers/extract.js';

// Značkování opsané z živých stránek (běh „Průzkum zdrojů"), ne vymyšlené.
// Kdyby portály svoje HTML změnily, tyhle fixtury přestanou odpovídat
// skutečnosti — proto je u každé napsáno, odkud pochází.

/** Sreality: karta je <li> se sémantickým id, třídy jsou emotion hashe. */
const SREALITY = `<ul>
  <li class="MuiGrid-root css-qec2v8" id="estate-list-item-363642956">
    <a class="MuiLink-root css-mjaqjc" href="/detail/prodej/byt/3+kk/praha-vinor-mlazovicka/363642956">
      <img src="https://d18-a.sdn.cz/x.jpg">
    </a>
    <div class="css-adf8sc">
      <p class="css-d7upve">Prodej bytu 3+kk 75&nbsp;m²</p>
      <p class="css-d7upve">Mlázovická, Praha - Vinoř</p>
      <p class="css-abbpa2">11&nbsp;900&nbsp;000&nbsp;Kč</p>
    </div>
  </li>
  <li class="MuiGrid-root css-1k66mq3" id="estate-list-item-3600597068">
    <a class="MuiLink-root css-mjaqjc" href="/detail/prodej/byt/2+kk/praha-hloubetin-chvalska/3600597068">
      <img src="https://d18-a.sdn.cz/y.jpg">
    </a>
    <div class="css-adf8sc">
      <p class="css-d7upve">Prodej bytu 2+kk 58&nbsp;m²</p>
      <p class="css-d7upve">Chvalská, Praha - Hloubětín</p>
      <p class="css-abbpa2">7&nbsp;450&nbsp;000&nbsp;Kč</p>
    </div>
  </li>
</ul>`;

/** iDNES: čisté BEM třídy, cena v <strong> uvnitř .c-products__price. */
const IDNES = `<div class="c-products">
  <div class="c-products__item">
    <a class="c-products__link" href="https://reality.idnes.cz/detail/prodej/byt/praha-8-ouholicka/6a8775a302c81b4cb202548a/">
      <h2 class="c-products__title">Prodej bytu 3+1 68 m²</h2>
    </a>
    <div class="c-products__content">
      <p class="c-products__info">Ouholická, Praha 8 - Čimice</p>
      <div class="c-products__footer">
        <p class="c-products__price"><strong>9 590 000 Kč</strong></p>
      </div>
    </div>
  </div>
</div>`;

/**
 * Bezrealitky: vedle hashovaných tříd nesou i stabilní `propertyCard`.
 * Seznam parametrů je schválně bez odsazení — živá stránka je minifikovaná
 * a právě proto se v ní „3+1" a „57 m²" slepí do jednoho textu.
 */
const BEZREALITKY = `<article class="PropertyCard_propertyCard__moO_5 propertyCard">
  <div class="PropertyCard_propertyCardContent__osPAM">
    <h2 class="PropertyCard_propertyCardHeadline___diKI">
      <a href="https://www.bezrealitky.cz/nemovitosti-byty-domy/1057849-nabidka-prodej-bytu-vsetinska-brno">
        <span class="PropertyCard_propertyCardLabel__HN3Jo"><span>Prodej bytu</span></span>
        <span class="PropertyCard_propertyCardAddress__hNqyR">Vsetínská, Brno - Štýřice, Jihomoravský kraj</span>
      </a>
    </h2>
    <ul class="featuresList"><li class="FeaturesList_featuresListItem__RYf_f"><span>3+1</span></li><li class="FeaturesList_featuresListItem__RYf_f">57&nbsp;m²</li></ul>
    <div class="PropertyPrice_propertyPrice__lthza propertyPrice">
      <span class="PropertyPrice_propertyPriceAmount__WdEE1">6&nbsp;400&nbsp;000&nbsp;Kč</span>
      <span class="PropertyPrice_propertyPricePerMeter__IfhGa">(112&nbsp;281&nbsp;Kč / m²)</span>
    </div>
  </div>
</article>`;

describe('priceFromText', () => {
  test('přečte cenu s nezlomitelnými mezerami', () => {
    assert.equal(priceFromText('11 900 000 Kč'), 11_900_000);
  });

  test('bere celkovou cenu, ne cenu za metr v závorce', () => {
    assert.equal(priceFromText('6 400 000 Kč(112 281 Kč / m²)'), 6_400_000);
  });

  test('samotná cena za metr se nebere jako cena nemovitosti', () => {
    assert.equal(priceFromText('112 281 Kč / m²'), null);
  });

  test('text bez ceny vrátí null', () => {
    assert.equal(priceFromText('Cena na vyžádání'), null);
    assert.equal(priceFromText(''), null);
    assert.equal(priceFromText(null), null);
  });

  test('krátké číslo není cena nemovitosti', () => {
    assert.equal(priceFromText('500 Kč'), null);
  });
});

describe('areaFromText / dispositionFromText', () => {
  test('plocha s nezlomitelnou mezerou', () => {
    assert.equal(areaFromText('Prodej bytu 3+kk 75 m²'), 75);
  });

  test('cena za m² se nezamění za plochu', () => {
    assert.equal(areaFromText('112 281 Kč / m²'), null);
  });

  test('dispozice z názvu', () => {
    assert.equal(dispositionFromText('Prodej bytu 3+kk 75 m²'), '3+kk');
    assert.equal(dispositionFromText('Prodej bytu 2+1'), '2+1');
  });
});

describe('unnbsp', () => {
  test('sjednotí nezlomitelné i úzké mezery', () => {
    assert.equal(unnbsp('1 000 000'), '1 000 000');
  });
});

describe('cardsFromLinks', () => {
  test('najde kartu iDNES podle odkazu na detail', () => {
    const $ = cheerio.load(IDNES);
    const cards = cardsFromLinks($, /\/detail\/prodej\/byt\//);
    assert.equal(cards.length, 1);
    assert.equal(priceFromText(cards[0].card.text()), 9_590_000);
  });

  test('každá karta dostane vlastní cenu, ne cenu první z nich', () => {
    const $ = cheerio.load(SREALITY);
    const cards = cardsFromLinks($, /\/detail\/prodej\/byt\//);
    assert.equal(cards.length, 2);
    assert.deepEqual(
      cards.map((c) => priceFromText(c.card.text())),
      [11_900_000, 7_450_000]
    );
  });

  test('stejný odkaz dvakrát se započte jednou', () => {
    const $ = cheerio.load(`<div>
      <div><a href="/detail/prodej/byt/a/1">obrázek</a><span>5 000 000 Kč</span></div>
      <div><a href="/detail/prodej/byt/a/1">nadpis</a><span>5 000 000 Kč</span></div>
    </div>`);
    assert.equal(cardsFromLinks($, /\/detail\//).length, 1);
  });

  test('odkaz bez ceny v okolí se přeskočí', () => {
    const $ = cheerio.load('<div><a href="/detail/prodej/byt/a/1">Bez ceny</a></div>');
    assert.deepEqual(cardsFromLinks($, /\/detail\//), []);
  });

  test('nesouvisející odkazy se ignorují', () => {
    const $ = cheerio.load(IDNES);
    assert.deepEqual(cardsFromLinks($, /\/pronajem\//), []);
  });
});

describe('localityFromCard', () => {
  test('vytáhne adresu ze Sreality karty', () => {
    const $ = cheerio.load(SREALITY);
    const card = $('#estate-list-item-363642956');
    assert.equal(localityFromCard($, card), 'Mlázovická, Praha - Vinoř');
  });

  test('vytáhne adresu z Bezrealitky karty', () => {
    const $ = cheerio.load(BEZREALITKY);
    assert.equal(
      localityFromCard($, $('article.propertyCard')),
      'Vsetínská, Brno - Štýřice, Jihomoravský kraj'
    );
  });

  test('řádek s cenou se za adresu nepovažuje', () => {
    const $ = cheerio.load('<div><p>Praha 5 — 8 000 000 Kč</p></div>');
    assert.equal(localityFromCard($, $('div')), null);
  });
});

describe('celá karta dohromady', () => {
  test('Bezrealitky: cena, plocha, dispozice i adresa', () => {
    const $ = cheerio.load(BEZREALITKY);
    const card = $('article.propertyCard');

    assert.equal(priceFromText(card.text()), 6_400_000);
    assert.equal(areaFromCard($, card), 57);
    assert.equal(dispositionFromCard($, card), '3+1');
    assert.equal(cityFromLocality(localityFromCard($, card)), 'brno');
  });

  test('sousední dispozice a plocha se neslepí do jednoho čísla', () => {
    // „3+1" a „57 m²" jsou dva sousední <li>; `card.text()` z nich udělá
    // „3+157 m²". Ze slepeného textu se plocha přečíst nedá (a je lepší
    // nevrátit nic než 157) — proto se čte po jednotlivých prvcích.
    const $ = cheerio.load(BEZREALITKY);
    assert.equal(areaFromText($('article.propertyCard').text()), null);
    assert.equal(areaFromCard($, $('article.propertyCard')), 57);
  });

  test('Sreality: cena, plocha, dispozice i adresa', () => {
    const $ = cheerio.load(SREALITY);
    const card = $('#estate-list-item-3600597068');

    assert.equal(priceFromText(card.text()), 7_450_000);
    assert.equal(areaFromCard($, card), 58);
    assert.equal(dispositionFromCard($, card), '2+kk');
    assert.equal(cityFromLocality(localityFromCard($, card)), 'praha');
  });
});

describe('cityFromLocality', () => {
  test('pozná sledovaná města', () => {
    assert.equal(cityFromLocality('Vsetínská, Brno - Štýřice'), 'brno');
    assert.equal(cityFromLocality('Odkolkova, Praha - Vysočany'), 'praha');
  });

  test('zbytek republiky zahodí — Bezrealitky vracejí celostátní výpis', () => {
    assert.equal(cityFromLocality('Chodská, Šumperk'), null);
    assert.equal(cityFromLocality(''), null);
  });
});
