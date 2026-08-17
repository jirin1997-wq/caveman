import { buildListing } from './normalize.js';
import { saveBatch } from './store.js';
import { fetchJsonPage, SourceError, sleep } from './http.js';

/**
 * Bezrealitky.cz.
 *
 * ⚠️ NEOVĚŘENO, a nejspíš rovnou špatně. Tenhle REST endpoint je odhad;
 * Bezrealitky podle všeho jedou na GraphQL, takže `GET /v2/estates`
 * pravděpodobně vůbec neexistuje. Vývojové prostředí na bezrealitky.cz
 * nepustí (403 na CONNECT), takže se to nedalo ověřit ani opravit.
 * Počítej s tím, že tenhle soubor bude potřeba přepsat od nuly na GraphQL
 * dotaz, až si na stroji s přístupem k síti odchytíš, co web ve skutečnosti volá.
 */

const API = 'https://api.bezrealitky.cz/v2/estates';

const CITIES = {
  praha: 'praha',
  brno: 'brno'
};

const PER_PAGE = 50;
const MAX_PAGES = 30;
const DELAY_MS = 800;

const HINT = 'Tenhle zdroj nejspíš jede na GraphQL — otevři si síťovou kartu na bezrealitky.cz '
  + 'a odchyť skutečný dotaz. Pak přepiš fetchPage(). Rychlá diagnóza: npm run probe';

function fetchPage(city, page) {
  return fetchJsonPage({
    source: 'Bezrealitky',
    url: API,
    params: { city, type: 'flat', transaction: 'sale', page, limit: PER_PAGE },
    itemsPath: 'data',
    totalPath: 'pagination.total',
    hint: HINT
  });
}

function mapEstate(estate, city) {
  if (!estate.id) return null;

  const labels = [];
  if (estate.condition) labels.push(estate.condition);
  if (estate.buildingType) labels.push(estate.buildingType);
  if (estate.disposition) labels.push(estate.disposition);

  const amenities = [];
  if (estate.amenities) {
    const amens = Array.isArray(estate.amenities) ? estate.amenities : [estate.amenities];
    for (const a of amens) {
      const lower = String(a).toLowerCase();
      if (lower.includes('balkon') || lower.includes('balcony')) amenities.push('balkon');
      if (lower.includes('terasa') || lower.includes('terrace')) amenities.push('terasa');
      if (lower.includes('lodzie') || lower.includes('lodge')) amenities.push('lodzie');
      if (lower.includes('garaz') || lower.includes('garage')) amenities.push('garaz');
      if (lower.includes('parkovani') || lower.includes('parking')) amenities.push('parkovani');
      if (lower.includes('vytah') || lower.includes('elevator')) amenities.push('vytah');
      if (lower.includes('sklep') || lower.includes('cellar')) amenities.push('sklep');
    }
  }

  return buildListing({
    url: `https://www.bezrealitky.cz/nemovitosti-byty/${estate.id}`,
    source: 'bezrealitky',
    sourceName: 'Bezrealitky',
    listingType: 'byt',
    city,
    name: estate.title,
    price: estate.price,
    locality: estate.address,
    sizeM2: estate.usableArea || estate.totalArea,
    disposition: estate.disposition,
    lat: estate.latitude ?? null,
    lng: estate.longitude ?? null,
    labels,
    description: estate.description,
    photos: estate.images?.map?.((img) => img.url) || [],
    completionYear: estate.yearBuilt
  });
}

async function scrapeCity(city, cityName) {
  console.log(`📍 Bezrealitky — ${cityName}`);
  const collected = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let result;
    try {
      result = await fetchPage(city, page);
    } catch (err) {
      if (page === 1) throw err; // zdroj je rozbitý, ne jen krátký
      console.warn(`  ! strana ${page} selhala (${err.message}) — beru, co mám`);
      break;
    }

    if (result.items.length === 0) break;

    for (const estate of result.items) {
      const listing = mapEstate(estate, city);
      if (listing) collected.push(listing);
    }

    if (page * PER_PAGE >= result.total) break;
    await sleep(DELAY_MS);
  }

  if (collected.length === 0) {
    console.warn(`  ! ${cityName}: zdroj odpověděl, ale mapování nevyrobilo žádný inzerát`);
    console.warn(`    ${HINT}`);
  }

  console.log(`  staženo ${collected.length} inzerátů`);
  const stats = await saveBatch(collected, `${city}:`);
  return { city, ok: collected.length > 0, stats };
}

export async function scrapeBezrealitky() {
  console.log('🔍 Bezrealitky scraper start');
  const cities = (process.env.SCRAPER_CITIES || 'praha,brno')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => CITIES[c]);

  const results = [];
  const errors = [];

  for (const city of cities) {
    try {
      const cityName = city === 'praha' ? 'Praha' : 'Brno';
      results.push(await scrapeCity(CITIES[city], cityName));
    } catch (err) {
      const msg = err instanceof SourceError ? err.format() : `${city}: ${err.message}`;
      console.error(`✗ ${msg}`);
      errors.push(msg);
    }
  }

  const ok = results.some((r) => r.ok);
  console.log(ok ? '✓ Bezrealitky hotovo' : '✗ Bezrealitky nepřineslo žádná data');
  return { source: 'Bezrealitky', ok, cities: results, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { default: db } = await import('../db/index.js');
  scrapeBezrealitky()
    .then(() => db.destroy())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
