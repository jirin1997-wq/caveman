import axios from 'axios';
import { buildListing } from './normalize.js';
import { saveBatch } from './store.js';

/**
 * Sreality má veřejné JSON API, které pohání jejich vlastní web.
 * Používáme ho místo parsování HTML — vrací rovnou GPS, plochu i štítky
 * a nerozbije se při každém redesignu stránky.
 *
 * Endpoint: /api/cs/v2/estates
 *   category_main_cb=1  byty
 *   category_type_cb=1  prodej
 *   locality_region_id  kraj
 */

const API = 'https://www.sreality.cz/api/cs/v2/estates';

const REGIONS = {
  praha: 10,
  brno: 14 // Jihomoravský kraj
};

const PER_PAGE = 60;
const MAX_PAGES = 20;          // strop, ať jeden běh netrvá hodiny
const DELAY_MS = 1200;         // šetrné tempo vůči serveru

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Jedna stránka výsledků. Vrací pole surových záznamů. */
async function fetchPage(regionId, page) {
  const { data } = await axios.get(API, {
    params: {
      category_main_cb: 1,
      category_type_cb: 1,
      locality_region_id: regionId,
      per_page: PER_PAGE,
      page
    },
    headers: {
      // Sreality odmítá požadavky bez běžné hlavičky prohlížeče.
      'User-Agent': 'Mozilla/5.0 (compatible; RealityScout/0.1)',
      Accept: 'application/json'
    },
    timeout: Number(process.env.SCRAPER_TIMEOUT) || 30000
  });

  return {
    estates: data?._embedded?.estates || [],
    total: data?.result_size ?? 0
  };
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
      console.error(`  ✗ strana ${page}: ${err.message}`);
      break; // dál nemá smysl pokračovat, zdroj je nedostupný
    }

    if (result.estates.length === 0) break;

    for (const estate of result.estates) {
      const listing = mapEstate(estate, city);
      if (listing) collected.push(listing);
    }

    if (page * PER_PAGE >= result.total) break;
    await sleep(DELAY_MS);
  }

  console.log(`  staženo ${collected.length} inzerátů`);
  return saveBatch(collected, `${city}:`);
}

export async function scrapeSreality() {
  console.log('🔍 Sreality scraper start');
  const cities = (process.env.SCRAPER_CITIES || 'praha,brno')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => REGIONS[c]);

  for (const city of cities) {
    try {
      await scrapeCity(city, REGIONS[city]);
    } catch (err) {
      console.error(`✗ ${city}: ${err.message}`);
    }
  }
  console.log('✓ Sreality scraper hotov');
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
