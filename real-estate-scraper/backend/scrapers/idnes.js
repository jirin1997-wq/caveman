import { buildListing } from './normalize.js';
import { saveBatch } from './store.js';
import { fetchJsonPage, SourceError, sleep } from './http.js';

/**
 * iDNES Reality.
 *
 * ⚠️ NEOVĚŘENO. Endpoint i tvar odpovědi níže jsou odhad — vývojové prostředí
 * nepustí odchozí spojení na reality.idnes.cz, takže se to nedalo vyzkoušet.
 * Než na tohle navěsíš cron, pusť `npm run scrape:idnes` na stroji s přístupem
 * na internet, vypiš si skutečnou odpověď a srovnej ji s `mapEstate()`.
 * Čekej, že `regionId`, cesta i klíče v JSONu budou jiné.
 */

const API = 'https://reality.idnes.cz/api/v1/estates';

const CITIES = {
  praha: { name: 'Praha', regionId: 1 },
  brno: { name: 'Brno', regionId: 7 }
};

const PER_PAGE = 30;
const MAX_PAGES = 50;
const DELAY_MS = 1000;

const HINT = 'Ověř tvar odpovědi: npm run probe — surová data pak najdeš v probe-output/idnes.json';

function fetchPage(regionId, page) {
  return fetchJsonPage({
    source: 'iDNES Reality',
    url: API,
    params: { regionId, page, limit: PER_PAGE, type: 'byt', transaction: 'prodej' },
    itemsPath: 'result.items',
    totalPath: 'result.total',
    hint: HINT
  });
}

function mapEstate(estate, city, cityName) {
  const id = estate.id || estate.hashId;
  if (!id) return null;

  const labels = [];
  if (estate.condition) labels.push(estate.condition);
  if (estate.materialType) labels.push(estate.materialType);
  if (estate.disposition) labels.push(estate.disposition);

  const amenities = [];
  if (estate.flags) {
    if (estate.flags.hasBalcony) amenities.push('balkon');
    if (estate.flags.hasTerrace) amenities.push('terasa');
    if (estate.flags.hasLodge) amenities.push('lodzie');
    if (estate.flags.hasGarage) amenities.push('garaz');
    if (estate.flags.hasParking) amenities.push('parkovani');
    if (estate.flags.hasElevator) amenities.push('vytah');
    if (estate.flags.hasCellar) amenities.push('sklep');
  }

  return buildListing({
    url: `https://reality.idnes.cz/s/prodej/byty/${id}`,
    source: 'idnes',
    sourceName: 'iDNES Reality',
    listingType: 'byt',
    city,
    name: estate.title,
    price: estate.price,
    locality: estate.locality,
    sizeM2: estate.usableArea || estate.totalArea,
    disposition: estate.disposition,
    lat: estate.gps?.lat ?? null,
    lng: estate.gps?.lng ?? null,
    labels,
    description: estate.description,
    photos: estate.photos?.map?.((p) => p.url) || [],
    completionYear: estate.completionYear
  });
}

async function scrapeCity(city, cityName, regionId) {
  console.log(`📍 iDNES Reality — ${cityName}`);
  const collected = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let result;
    try {
      result = await fetchPage(regionId, page);
    } catch (err) {
      if (page === 1) throw err; // zdroj je rozbitý, ne jen krátký
      console.warn(`  ! strana ${page} selhala (${err.message}) — beru, co mám`);
      break;
    }

    if (result.items.length === 0) break;

    for (const estate of result.items) {
      const listing = mapEstate(estate, city, cityName);
      if (listing) collected.push(listing);
    }

    if (page * PER_PAGE >= result.total) break;
    await sleep(DELAY_MS);
  }

  if (collected.length === 0) {
    console.warn(`  ! ${city}: zdroj odpověděl, ale mapování nevyrobilo žádný inzerát`);
    console.warn(`    ${HINT}`);
  }

  console.log(`  staženo ${collected.length} inzerátů`);
  const stats = await saveBatch(collected, `${city}:`);
  return { city, ok: collected.length > 0, stats };
}

export async function scrapeIdnes() {
  console.log('🔍 iDNES Reality scraper start');
  const cities = (process.env.SCRAPER_CITIES || 'praha,brno')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => CITIES[c]);

  const results = [];
  const errors = [];

  for (const city of cities) {
    try {
      const config = CITIES[city];
      results.push(await scrapeCity(city, config.name, config.regionId));
    } catch (err) {
      const msg = err instanceof SourceError ? err.format() : `${city}: ${err.message}`;
      console.error(`✗ ${msg}`);
      errors.push(msg);
    }
  }

  const ok = results.some((r) => r.ok);
  console.log(ok ? '✓ iDNES Reality hotovo' : '✗ iDNES Reality nepřineslo žádná data');
  return { source: 'iDNES Reality', ok, cities: results, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { default: db } = await import('../db/index.js');
  scrapeIdnes()
    .then(() => db.destroy())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
