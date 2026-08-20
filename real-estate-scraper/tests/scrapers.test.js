import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseListPage as parseSreality } from '../backend/scrapers/sreality.js';
import { parseListPage as parseIdnes, localityFromHref } from '../backend/scrapers/idnes.js';
import { parseListPage as parseBezrealitky } from '../backend/scrapers/bezrealitky.js';

// Fixtury opsané ze skutečných odpovědí (běh „Průzkum zdrojů" 2026-08-20).
// Parsery se testují nad HTML, ne přes síť — proto jsou `parseListPage`
// čisté funkce a scrapery kolem nich jen obalují stahování a stránkování.

const SREALITY = `<ul>
  <li class="MuiGrid-root css-qec2v8" id="estate-list-item-363642956">
    <a class="css-mjaqjc" href="/detail/prodej/byt/3+kk/praha-vinor-mlazovicka/363642956">
      <img src="https://d18-a.sdn.cz/x.jpg"></a>
    <div class="css-adf8sc">
      <p class="css-d7upve">Prodej bytu 3+kk 75&nbsp;m²</p>
      <p class="css-d7upve">Mlázovická, Praha - Vinoř</p>
      <p class="css-abbpa2">11&nbsp;900&nbsp;000&nbsp;Kč</p>
    </div>
  </li>
  <li class="MuiGrid-root css-o1kxrf" id="region-tip-item-1-3173163084">
    <a class="css-mjaqjc" href="/detail/prodej/byt/2+kk/praha-vysocany-odkolkova/3173163084">
      <img src="https://d18-a.sdn.cz/y.jpg"></a>
    <div class="css-adf8sc">
      <p class="css-d7upve">Prodej bytu 2+kk 58&nbsp;m²</p>
      <p class="css-d7upve">Odkolkova, Praha - Vysočany</p>
      <p class="css-abbpa2">7&nbsp;450&nbsp;000&nbsp;Kč</p>
    </div>
  </li>
  <li class="MuiGrid-root" id="estate-list-item-999">
    <a href="/detail/prodej/byt/1+kk/praha-x/999"><img src="z.jpg"></a>
    <div><p>Prodej bytu 1+kk 30 m²</p><p>Praha 3</p><p>Informace o ceně u makléře</p></div>
  </li>
</ul>`;

const IDNES = `<div class="c-products">
  <div class="c-products__item">
    <a class="c-products__link" href="https://reality.idnes.cz/detail/prodej/byt/praha-8-ouholicka/6a8775a302c81b4cb202548a/">
      <h2 class="c-products__title">Prodej bytu 3+1 68 m²</h2></a>
    <div class="c-products__content">
      <div class="c-products__footer">
        <p class="c-products__price"><strong>9 590 000 Kč</strong></p>
      </div>
    </div>
  </div>
</div>`;

const BEZREALITKY = `<div>
  <article class="PropertyCard_propertyCard__moO_5 propertyCard">
    <div class="PropertyCard_propertyCardContent__osPAM">
      <h2><a href="https://www.bezrealitky.cz/nemovitosti-byty-domy/1057849-nabidka-prodej-bytu-vsetinska-brno">
        <span><span>Prodej bytu</span></span>
        <span class="PropertyCard_propertyCardAddress__hNqyR">Vsetínská, Brno - Štýřice, Jihomoravský kraj</span>
      </a></h2>
      <ul class="featuresList"><li><span>3+1</span></li><li>57&nbsp;m²</li></ul>
      <div class="PropertyPrice_propertyPrice__lthza propertyPrice">
        <span>6&nbsp;400&nbsp;000&nbsp;Kč</span><span>(112&nbsp;281&nbsp;Kč / m²)</span>
      </div>
    </div>
  </article>
  <article class="PropertyCard_propertyCard__moO_5 propertyCard">
    <div>
      <h2><a href="https://www.bezrealitky.cz/nemovitosti-byty-domy/1057825-nabidka-prodej-bytu-chodska-sumperk">
        <span><span>Prodej bytu</span></span>
        <span>Chodská, Šumperk, Olomoucký kraj</span>
      </a></h2>
      <ul><li><span>2+1</span></li><li>60&nbsp;m²</li></ul>
      <div class="propertyPrice"><span>2&nbsp;900&nbsp;000&nbsp;Kč</span></div>
    </div>
  </article>
</div>`;

describe('Sreality — parseListPage', () => {
  const listings = parseSreality(SREALITY, 'praha');

  test('přečte inzeráty včetně propagované nabídky', () => {
    assert.equal(listings.length, 2);
  });

  test('poskládá absolutní adresu detailu', () => {
    assert.equal(
      listings[0].url,
      'https://www.sreality.cz/detail/prodej/byt/3+kk/praha-vinor-mlazovicka/363642956'
    );
  });

  test('vytáhne cenu, plochu, dispozici a adresu', () => {
    assert.equal(listings[0].price, 11_900_000);
    assert.equal(listings[0].sizeM2, 75);
    assert.equal(listings[0].disposition, '3+kk');
    assert.equal(listings[0].locality, 'Mlázovická, Praha - Vinoř');
  });

  test('inzerát bez uvedené ceny se přeskočí, ať nekazí medián', () => {
    assert.ok(!listings.some((l) => l.url.endsWith('/999')));
  });

  test('prázdná stránka nespadne', () => {
    assert.deepEqual(parseSreality('<html><body></body></html>', 'praha'), []);
  });
});

describe('iDNES — parseListPage', () => {
  const listings = parseIdnes(IDNES, 'praha');

  test('najde inzerát podle odkazu na detail', () => {
    assert.equal(listings.length, 1);
    assert.equal(listings[0].price, 9_590_000);
  });

  test('název bere z nadpisu karty', () => {
    assert.equal(listings[0].name, 'Prodej bytu 3+1 68 m²');
    assert.equal(listings[0].sizeM2, 68);
    assert.equal(listings[0].disposition, '3+1');
  });

  test('adresu doplní z adresy detailu, když ji karta neuvádí', () => {
    assert.equal(listings[0].locality, 'ouholicka, Praha 8');
  });
});

describe('iDNES — localityFromHref', () => {
  test('rozliší číslo obvodu od názvu ulice', () => {
    assert.equal(
      localityFromHref('/detail/prodej/byt/praha-15-kozmikova/abc/'),
      'kozmikova, Praha 15'
    );
  });

  test('Brno nemá číslované obvody', () => {
    assert.equal(localityFromHref('/detail/prodej/byt/brno-styrice/abc/'), 'styrice, Brno');
  });

  test('cizí tvar adresy vrátí null místo nesmyslu', () => {
    assert.equal(localityFromHref('/o-nas/'), null);
  });
});

describe('Bezrealitky — parseListPage', () => {
  const listings = parseBezrealitky(BEZREALITKY);

  test('vezme jen sledovaná města — výpis je celostátní', () => {
    assert.equal(listings.length, 1);
    assert.equal(listings[0].city, 'brno');
  });

  test('cena za metr v závorce se nezamění za cenu nemovitosti', () => {
    assert.equal(listings[0].price, 6_400_000);
  });

  test('plocha se nesetře s dispozicí ze sousedního prvku', () => {
    assert.equal(listings[0].sizeM2, 57);
    assert.equal(listings[0].disposition, '3+1');
  });

  test('omezení na jedno město funguje', () => {
    assert.deepEqual(parseBezrealitky(BEZREALITKY, ['praha']), []);
  });
});
