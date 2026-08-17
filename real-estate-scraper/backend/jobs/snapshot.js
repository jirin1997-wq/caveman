import db from '../db/index.js';

/**
 * Uloží denní snímek trhu — mediány z aktuálně nabízených nemovitostí.
 * Z těchto snímků se skládá graf "Vývoj cen"; bez nich by aplikace
 * uměla ukázat jen historii jednotlivých inzerátů, ne pohyb trhu.
 */

const CITIES = ['praha', 'brno'];
const LISTING_TYPES = ['byt', 'novostavba'];

async function medianRows(city, listingType) {
  const base = () =>
    db('listings')
      .where({ city, listing_type: listingType })
      .whereNotNull('price_per_m2');

  const perM2 = db.raw(
    'PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_per_m2) as median_price_per_m2'
  );
  const perUnit = db.raw(
    'PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price) as median_price'
  );
  const sample = db.raw('COUNT(*)::int as sample_size');

  const [cityWide, byDistrict] = await Promise.all([
    base().select(perM2, perUnit, sample).first(),
    base().whereNotNull('district').groupBy('district').select('district', perM2, perUnit, sample)
  ]);

  const rows = [];

  if (cityWide?.sample_size > 0) {
    rows.push({ city, district: null, listing_type: listingType, ...cityWide });
  }

  for (const row of byDistrict) {
    rows.push({ city, listing_type: listingType, ...row });
  }

  return rows;
}

export async function writeSnapshot(date = new Date()) {
  const snapshotDate = date.toISOString().slice(0, 10);
  let written = 0;

  for (const city of CITIES) {
    for (const listingType of LISTING_TYPES) {
      const rows = await medianRows(city, listingType);
      if (rows.length === 0) continue;

      // Přepis dnešního snímku místo onConflict — unikátní index obsahuje
      // nullable `district` a Postgres pro NULL konflikt nevyhodnotí.
      await db('market_snapshots')
        .where({ city, listing_type: listingType, snapshot_date: snapshotDate })
        .del();

      await db('market_snapshots').insert(
        rows.map((row) => ({ ...row, snapshot_date: snapshotDate }))
      );
      written += rows.length;
    }
  }

  console.log(`✓ Snímek trhu ${snapshotDate}: ${written} záznamů`);
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeSnapshot()
    .then(() => db.destroy())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
