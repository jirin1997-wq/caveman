/**
 * Vyhodnocení ceny nemovitosti.
 *
 * Dvě nezávislé metriky, obě viditelné na kartě inzerátu:
 *
 * 1) RATING — jak je cena za m² daleko od mediánu srovnatelných nemovitostí
 *    (stejné město + čtvrť + dispozice). Pět stupňů, od "Výborná" po "Vysoká".
 *
 * 2) HRUBÝ VÝNOS (% p.a.) — kolik ročně vydělá pronájem vůči kupní ceně.
 *    Počítá se z referenčního nájmu v dané lokalitě (tabulka rent_benchmarks).
 *    Nízký výnos = drahá nemovitost vůči nájemnímu trhu.
 */

/** Stupně ratingu. `segments` = kolik dílků z 5 se na kartě vybarví. */
export const PRICE_RATINGS = {
  excellent: { key: 'excellent', label: 'Výborná cena', color: 'green', segments: 5 },
  good: { key: 'good', label: 'Dobrá cena', color: 'blue', segments: 4 },
  average: { key: 'average', label: 'Průměrná cena', color: 'gray', segments: 3 },
  elevated: { key: 'elevated', label: 'Zvýšená cena', color: 'orange', segments: 2 },
  high: { key: 'high', label: 'Vysoká cena', color: 'red', segments: 1 },
  unknown: { key: 'unknown', label: 'Bez srovnání', color: 'gray', segments: 0 }
};

/** Minimální počet srovnatelných nemovitostí, aby mělo srovnání smysl. */
export const MIN_COMPARABLE_SAMPLE = 5;

/**
 * Zařadí cenu za m² proti mediánu srovnatelných.
 * @param {number} pricePerM2
 * @param {number} medianPricePerM2
 * @param {number} sampleSize  počet srovnatelných nemovitostí za mediánem
 * @param {string} basis       popis srovnávací skupiny pro uživatele
 */
export function ratePrice(pricePerM2, medianPricePerM2, sampleSize = 0, basis = null) {
  if (!pricePerM2 || !medianPricePerM2 || sampleSize < MIN_COMPARABLE_SAMPLE) {
    return { ...PRICE_RATINGS.unknown, deviation: null, sampleSize, basis: null };
  }

  const deviation = ((pricePerM2 - medianPricePerM2) / medianPricePerM2) * 100;

  let rating;
  if (deviation <= -15) rating = PRICE_RATINGS.excellent;
  else if (deviation <= -5) rating = PRICE_RATINGS.good;
  else if (deviation < 5) rating = PRICE_RATINGS.average;
  else if (deviation < 15) rating = PRICE_RATINGS.elevated;
  else rating = PRICE_RATINGS.high;

  return {
    ...rating,
    deviation: Number(deviation.toFixed(1)),
    medianPricePerM2: Math.round(medianPricePerM2),
    sampleSize,
    basis
  };
}

/**
 * Hrubý roční výnos z pronájmu.
 * @param {number} price          kupní cena
 * @param {number} sizeM2         plocha
 * @param {number} rentPerM2Month referenční nájem Kč/m²/měsíc
 * @returns {number|null} procento p.a. zaokrouhlené na desetinu
 */
export function grossRentalYield(price, sizeM2, rentPerM2Month) {
  if (!price || !sizeM2 || !rentPerM2Month) return null;
  const annualRent = rentPerM2Month * sizeM2 * 12;
  return Number(((annualRent / price) * 100).toFixed(1));
}

/**
 * Hodnocení výnosu — pod 3 % p.a. je pražský standard "drahé",
 * nad 5 % už zajímavé. Slouží k obarvení čísla na kartě.
 */
export function rateYield(yieldPct) {
  if (yieldPct == null) return 'gray';
  if (yieldPct >= 5) return 'green';
  if (yieldPct >= 3.5) return 'blue';
  if (yieldPct >= 2.5) return 'orange';
  return 'red';
}

/** Počet dní na trhu z data prvního výskytu. */
export function daysOnMarket(firstSeenAt) {
  if (!firstSeenAt) return null;
  const ms = Date.now() - new Date(firstSeenAt).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** "2d" / "3t" / "5m" — kompaktní štítek stáří inzerátu jako na kartě. */
export function formatAge(days) {
  if (days == null) return null;
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}t`;
  return `${Math.floor(days / 30)}m`;
}

/**
 * Obohatí surový řádek z DB o vypočtené metriky.
 * @param {object} listing        řádek z tabulky listings
 * @param {object} comparable     { median_price_per_m2, sample_size, basis }
 * @param {number} rentPerM2Month referenční nájem pro lokalitu
 */
export function enrichListing(listing, comparable = {}, rentPerM2Month = null) {
  const pricePerM2 = Number(listing.price_per_m2) || null;
  const rating = ratePrice(
    pricePerM2,
    Number(comparable.median_price_per_m2) || null,
    Number(comparable.sample_size) || 0,
    comparable.basis || null
  );
  const yieldPct = grossRentalYield(
    Number(listing.price),
    Number(listing.size_m2),
    rentPerM2Month
  );
  const days = daysOnMarket(listing.first_seen_at);

  return {
    ...listing,
    rating,
    yieldPct,
    yieldColor: rateYield(yieldPct),
    daysOnMarket: days,
    ageLabel: formatAge(days)
  };
}
