import { buildListing } from './normalize.js';
import { saveBatch } from './store.js';
import { fetchJsonPage, SourceError, sleep } from './http.js';
import { SREALITY_REGIONS } from './shape.js';

/**
 * Sreality má veřejné JSON API, které pohání jejich vlastní web.
 * Používáme ho místo parsování HTML — vrací rovnou GPS, plochu i štítky
 * a nerozbije se při každém redesignu stránky.
 *
 * Endpoint: /api/cs/v2/estates
 *   category_main_cb=1  byty
 *   category_type_cb=1  prodej
 *   locality_region_id  kraj
 *
 * Pozn.: netestováno proti živému serveru — vývojové prostředí nepustí
 * odchozí spojení na sreality.cz. Jde ale o veřejné API, které pohání
 * jejich vlastní web, takže tvar odpovědi je pravděpodobně správný.
 * Ze všech čtyř zdrojů má tenhle nejvyšší šanci projít na první pokus.
 */

const API = 'https://www.sreality.cz/api/cs/v2/estates';

const REGIONS = SREALITY_REGIONS;

const PER_PAGE = 60;
const MAX_PAGES = 20;          // strop, ať jeden běh netrvá hodiny
const DELAY_MS = 1200;         // šetrné tempo vůči serveru

const HINT = 'Ověř tvar odpovědi: npm run probe — surová data pak najdeš v probe-output/sreality.json';

/** Jedna stránka výsledků. Vyhodí SourceError, když zdroj neodpoví v očekávaném tvaru. */
function fetchPage(regionId, page) {
  return fetchJsonPage({
    source: 'Sreality',
    url: API,
    params: {
      category_main_cb: 1,
      category_type_cb: 1,
      locality_region_id: regionId,
      per_page: PER_PAGE,
      page
    },
    itemsPath: '_embedded.estates',
    totalPath: 'result_size',
    hint: HINT
  });
}

/** Převede záznam z API na normalizovaný tvar. */
function mapEstate(estate, city) {
  const hashId = estate.hash_id;
  if (!hashId) return null;

  const gps = estate.gps || {};
  const labels = [
    ...(estate.labels || []),
    ...(estate.labelsAll?.flat?.() || [])
  ].filter((l) => typeof l === 'string');

  const photos = (estate._links?.images || [])
    .map((img) => img.href)
    .filter(Boolean)
    .slice(0, 8);

  return buildListing({
    url: `https://www.sreality.cz/detail/prodej/byt/x/x/${hashId}`,
    source: 'sreality',
    sourceName: 'Sreality',
    listingType: 'byt',
    city,
    name: estate.name,
    price: estate.price_czk?.value_raw ?? estate.price,
    locality: estate.locality || estate.seo?.locality,
    lat: gps.lat ?? null,
    lng: gps.lon ?? gps.lng ?? null,
    labels,
    photos
  });
}

async function scrapeCity(city, regionId) {
  console.log(`📍 Sreality — ${city}`);
  const collected = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let result;
    try {
      result = await fetchPage(regionId, page);
    } catch (err) {
      // První stránka je ověření zdroje — když neprojde, je zdroj rozbitý
      // a musí se to dozvědět volající. Výpadek na dalších stránkách
      // znamená jen kratší dávku, s tím se dá pracovat.
      if (page === 1) throw err;
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

  // Zdroj odpověděl, ale nic použitelného z něj nevypadlo — to je taky nález.
  if (collected.length === 0) {
    console.warn(`  ! ${city}: zdroj odpověděl, ale mapování nevyrobilo žádný inzerát`);
    console.warn(`    ${HINT}`);
  }

  console.log(`  staženo ${collected.length} inzerátů`);
  const stats = await saveBatch(collected, `${city}:`);
  return { city, ok: collected.length > 0, stats };
}

/**
 * @returns {Promise<{source:string, ok:boolean, cities:object[], errors:string[]}>}
 *   `ok` je true, jen když aspoň jedno město něco přineslo.
 */
export async function scrapeSreality() {
  console.log('🔍 Sreality scraper start');
  const cities = (process.env.SCRAPER_CITIES || 'praha,brno')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => REGIONS[c]);

  const results = [];
  const errors = [];

  for (const city of cities) {
    try {
      results.push(await scrapeCity(city, REGIONS[city]));
    } catch (err) {
      const msg = err instanceof SourceError ? err.format() : `${city}: ${err.message}`;
      console.error(`✗ ${msg}`);
      errors.push(msg);
    }
  }

  const ok = results.some((r) => r.ok);
  console.log(ok ? '✓ Sreality hotovo' : '✗ Sreality nepřineslo žádná data');
  return { source: 'Sreality', ok, cities: results, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { default: db } = await import('../db/index.js');
  scrapeSreality()
    .then(() => db.destroy())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
