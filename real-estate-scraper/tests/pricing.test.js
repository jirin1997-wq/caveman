import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ratePrice,
  grossRentalYield,
  rateYield,
  daysOnMarket,
  formatAge,
  enrichListing,
  MIN_COMPARABLE_SAMPLE
} from '../backend/lib/pricing.js';

describe('ratePrice', () => {
  const median = 150000;
  const sample = 20;

  test('cena hluboko pod mediánem je výborná', () => {
    const rating = ratePrice(120000, median, sample); // −20 %
    assert.equal(rating.key, 'excellent');
    assert.equal(rating.segments, 5);
    assert.equal(rating.deviation, -20);
  });

  test('cena mírně pod mediánem je dobrá', () => {
    assert.equal(ratePrice(135000, median, sample).key, 'good'); // −10 %
  });

  test('cena kolem mediánu je průměrná', () => {
    assert.equal(ratePrice(150000, median, sample).key, 'average');
    assert.equal(ratePrice(157000, median, sample).key, 'average'); // +4,7 %
  });

  test('cena nad mediánem je zvýšená', () => {
    assert.equal(ratePrice(165000, median, sample).key, 'elevated'); // +10 %
  });

  test('cena výrazně nad mediánem je vysoká', () => {
    const rating = ratePrice(180000, median, sample); // +20 %
    assert.equal(rating.key, 'high');
    assert.equal(rating.segments, 1);
  });

  test('hranice pásem jsou stabilní', () => {
    assert.equal(ratePrice(median * 0.85, median, sample).key, 'excellent'); // přesně −15 %
    assert.equal(ratePrice(median * 0.95, median, sample).key, 'good');      // přesně −5 %
    assert.equal(ratePrice(median * 1.05, median, sample).key, 'elevated');  // přesně +5 %
    assert.equal(ratePrice(median * 1.15, median, sample).key, 'high');      // přesně +15 %
  });

  test('malý vzorek nehodnotí — raději nic než nesmysl', () => {
    const rating = ratePrice(120000, median, MIN_COMPARABLE_SAMPLE - 1);
    assert.equal(rating.key, 'unknown');
    assert.equal(rating.deviation, null);
  });

  test('chybějící data nehodnotí', () => {
    assert.equal(ratePrice(null, median, sample).key, 'unknown');
    assert.equal(ratePrice(120000, null, sample).key, 'unknown');
  });

  test('nese s sebou popis srovnávací skupiny', () => {
    const rating = ratePrice(120000, median, sample, '3+kk v lokalitě Praha 2');
    assert.equal(rating.basis, '3+kk v lokalitě Praha 2');
    assert.equal(rating.medianPricePerM2, median);
  });
});

describe('grossRentalYield', () => {
  test('spočítá hrubý roční výnos', () => {
    // 65 m² × 380 Kč × 12 = 296 400 ročně z 10 000 000 → 2,96 %
    assert.equal(grossRentalYield(10000000, 65, 380), 3.0);
  });

  test('dražší nemovitost při stejném nájmu má nižší výnos', () => {
    const levna = grossRentalYield(8000000, 65, 380);
    const draha = grossRentalYield(12000000, 65, 380);
    assert.ok(levna > draha);
  });

  test('bez vstupů vrací null', () => {
    assert.equal(grossRentalYield(null, 65, 380), null);
    assert.equal(grossRentalYield(10000000, null, 380), null);
    assert.equal(grossRentalYield(10000000, 65, null), null);
  });
});

describe('rateYield', () => {
  test('vyšší výnos je lepší barva', () => {
    assert.equal(rateYield(6), 'green');
    assert.equal(rateYield(4), 'blue');
    assert.equal(rateYield(3), 'orange');
    assert.equal(rateYield(2), 'red');
    assert.equal(rateYield(null), 'gray');
  });
});

describe('daysOnMarket a formatAge', () => {
  test('spočítá dny od zveřejnění', () => {
    const desetDnu = new Date(Date.now() - 10 * 86400000);
    assert.equal(daysOnMarket(desetDnu), 10);
  });

  test('budoucí datum nedá záporný počet dní', () => {
    const zitra = new Date(Date.now() + 86400000);
    assert.equal(daysOnMarket(zitra), 0);
  });

  test('formátuje stáří kompaktně', () => {
    assert.equal(formatAge(3), '3d');
    assert.equal(formatAge(14), '2t');
    assert.equal(formatAge(65), '2m');
    assert.equal(formatAge(null), null);
  });
});

describe('enrichListing', () => {
  test('doplní rating, výnos i stáří najednou', () => {
    // 7 200 000 Kč za 60 m² = 120 000 Kč/m², tj. −20 % proti mediánu 150 000.
    const listing = {
      price: 7200000,
      price_per_m2: 120000,
      size_m2: 60,
      first_seen_at: new Date(Date.now() - 5 * 86400000)
    };

    const enriched = enrichListing(
      listing,
      { median_price_per_m2: 150000, sample_size: 30, basis: '3+kk v lokalitě Praha 5' },
      380
    );

    assert.equal(enriched.rating.key, 'excellent');
    assert.equal(enriched.rating.basis, '3+kk v lokalitě Praha 5');
    assert.ok(enriched.yieldPct > 0);
    assert.equal(enriched.daysOnMarket, 5);
    assert.equal(enriched.ageLabel, '5d');
    assert.equal(enriched.price, listing.price, 'původní pole zůstávají beze změny');
  });

  test('bez srovnání a bez nájmu nespadne', () => {
    const enriched = enrichListing({ price: 5000000, price_per_m2: 100000, size_m2: 50 });
    assert.equal(enriched.rating.key, 'unknown');
    assert.equal(enriched.yieldPct, null);
  });
});
