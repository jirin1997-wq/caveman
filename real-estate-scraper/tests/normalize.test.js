import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDisposition,
  parseArea,
  parsePrice,
  parseLocality,
  parseBuildingType,
  parseCondition,
  parseAmenities,
  pricePerM2,
  buildListing
} from '../backend/scrapers/normalize.js';

describe('parseDisposition', () => {
  test('vytáhne dispozici z názvu inzerátu', () => {
    assert.equal(parseDisposition('Prodej bytu 3+kk 75 m²'), '3+kk');
    assert.equal(parseDisposition('Prodej bytu 2+1 58 m²'), '2+1');
    assert.equal(parseDisposition('Byt 1+kk'), '1+kk');
  });

  test('rozpozná atypickou dispozici', () => {
    assert.equal(parseDisposition('Prodej bytu atypický 120 m²'), 'atypicky');
  });

  test('zvládne mezery kolem plusu', () => {
    assert.equal(parseDisposition('Byt 4 + 1, Praha'), '4+1');
  });

  test('vrátí null, když dispozice chybí nebo je mimo číselník', () => {
    assert.equal(parseDisposition('Prodej garáže'), null);
    assert.equal(parseDisposition('Byt 9+kk'), null);
    assert.equal(parseDisposition(''), null);
    assert.equal(parseDisposition(null), null);
  });
});

describe('parseArea', () => {
  test('přečte plochu včetně oddělovačů tisíců', () => {
    assert.equal(parseArea('75 m²'), 75);
    assert.equal(parseArea('1 250 m²'), 1250);
    assert.equal(parseArea('Prodej bytu 3+kk 68,5 m2'), 68.5);
  });

  test('číselná dispozice se nespojí s plochou', () => {
    // „3+1 68 m²" dřív dávalo 168 m² — mezera se brala jako oddělovač
    // tisíců i tam, kde za ní nestojí trojice číslic.
    assert.equal(parseArea('Prodej bytu 3+1 68 m²'), 68);
    assert.equal(parseArea('Prodej bytu 2+1 105 m²'), 105);
    assert.equal(parseArea('Prodej bytu 4+1 1 250 m²'), 1250);
  });

  test('cena za metr se nezamění za plochu', () => {
    assert.equal(parseArea('112 281 Kč / m²'), null);
  });

  test('vrátí null pro text bez plochy', () => {
    assert.equal(parseArea('Prodej bytu'), null);
    assert.equal(parseArea(null), null);
  });
});

describe('parsePrice', () => {
  test('přečte cenu z textu i čísla', () => {
    assert.equal(parsePrice('11 700 000 Kč'), 11700000);
    assert.equal(parsePrice(5490000), 5490000);
  });

  test('odmítne nečíselné a nulové ceny', () => {
    assert.equal(parsePrice('Info o ceně u RK'), null);
    assert.equal(parsePrice(0), null);
    assert.equal(parsePrice(null), null);
  });
});

describe('parseLocality', () => {
  test('rozdělí pražskou lokalitu na obvod a čtvrť', () => {
    assert.deepEqual(parseLocality('Murmanská, Praha 10 - Vršovice'), {
      district: 'Praha 10',
      neighborhood: 'Vršovice'
    });
  });

  test('zvládne pražskou lokalitu bez čtvrti', () => {
    assert.deepEqual(parseLocality('Korunní, Praha 2'), {
      district: 'Praha 2',
      neighborhood: null
    });
  });

  test('rozpozná brněnskou městskou část', () => {
    const result = parseLocality('Veveří, Brno-střed');
    assert.equal(result.district, 'Brno-střed');
    assert.equal(result.neighborhood, 'Veveří');
  });

  test('u neznámého tvaru vrátí poslední část jako obvod', () => {
    assert.deepEqual(parseLocality('Nádražní, Kladno'), {
      district: 'Kladno',
      neighborhood: 'Nádražní'
    });
  });

  test('prázdný vstup nespadne', () => {
    assert.deepEqual(parseLocality(null), { district: null, neighborhood: null });
  });
});

describe('parseBuildingType / parseCondition', () => {
  test('rozpozná materiál stavby', () => {
    assert.equal(parseBuildingType(['Cihlová stavba']), 'cihlova');
    assert.equal(parseBuildingType(['Panelová']), 'panelova');
    assert.equal(parseBuildingType(['Balkón']), null);
  });

  test('rozpozná stav objektu', () => {
    assert.equal(parseCondition(['Novostavba']), 'novostavba');
    assert.equal(parseCondition(['K rekonstrukci']), 'k_rekonstrukci');
    assert.equal(parseCondition(['Velmi dobrý stav']), 'dobry');
  });
});

describe('parseAmenities', () => {
  test('najde vybavenost napříč štítky a popisem', () => {
    const found = parseAmenities(['Balkón', 'Výtah', 'Sklep']);
    assert.deepEqual(found.sort(), ['balkon', 'sklep', 'vytah']);
  });

  test('zvládne české skloňování v souvislém textu', () => {
    assert.deepEqual(parseAmenities('Byt s garáží a lodžií').sort(), ['garaz', 'lodzie']);
    assert.deepEqual(parseAmenities('Prostorný byt s terasou').sort(), ['terasa']);
    assert.deepEqual(parseAmenities('Dům s výtahem a sklepem').sort(), ['sklep', 'vytah']);
    assert.deepEqual(parseAmenities('K bytu náleží parkovací stání').sort(), ['parkovani']);
  });

  test('bez vybavenosti vrátí prázdné pole', () => {
    assert.deepEqual(parseAmenities('Byt v centru'), []);
    assert.deepEqual(parseAmenities(null), []);
  });
});

describe('pricePerM2', () => {
  test('spočítá cenu za metr', () => {
    assert.equal(pricePerM2(11600000, 65), 178462);
  });

  test('bez plochy nebo ceny vrátí null', () => {
    assert.equal(pricePerM2(11600000, null), null);
    assert.equal(pricePerM2(null, 65), null);
  });
});

describe('buildListing', () => {
  const raw = {
    url: 'https://www.sreality.cz/detail/prodej/byt/x/x/123',
    source: 'sreality',
    sourceName: 'Sreality',
    city: 'praha',
    name: 'Prodej bytu 3+kk 75 m²',
    price: 12500000,
    locality: 'Korunní, Praha 2 - Vinohrady',
    lat: 50.0755,
    lng: 14.4378,
    labels: ['Cihlová stavba', 'Balkón', 'Výtah']
  };

  test('poskládá kompletní záznam', () => {
    const listing = buildListing(raw);

    assert.equal(listing.disposition, '3+kk');
    assert.equal(listing.size_m2, 75);
    assert.equal(listing.price, 12500000);
    assert.equal(listing.price_per_m2, 166667);
    assert.equal(listing.district, 'Praha 2');
    assert.equal(listing.neighborhood, 'Vinohrady');
    assert.equal(listing.building_type, 'cihlova');
    assert.deepEqual(JSON.parse(listing.amenities).sort(), ['balkon', 'vytah']);
    assert.equal(listing.rooms, 3);
  });

  test('odmítne inzerát bez ceny', () => {
    assert.equal(buildListing({ ...raw, price: 'Info o ceně' }), null);
  });

  test('odmítne inzerát bez URL', () => {
    assert.equal(buildListing({ ...raw, url: null }), null);
  });

  test('přežije chybějící plochu — cena za m² zůstane null', () => {
    const listing = buildListing({ ...raw, name: 'Prodej bytu' });
    assert.equal(listing.size_m2, null);
    assert.equal(listing.price_per_m2, null);
    assert.equal(listing.price, 12500000);
  });
});
