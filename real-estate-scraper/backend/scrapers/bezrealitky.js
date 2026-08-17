import axios from 'axios';
import { buildListing } from './normalize.js';
import { saveBatch } from './store.js';

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPage(city, page) {
  const { data } = await axios.get(API, {
    params: {
      city,
      type: 'flat',
      transaction: 'sale',
      page,
      limit: PER_PAGE
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; RealityScout/0.1)',
      Accept: 'application/json'
    },
    timeout: Number(process.env.SCRAPER_TIMEOUT) || 30000
  });

  return {
    items: data?.data || [],
    total: data?.pagination?.total ?? 0
  };
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
      console.error(`  ✗ strana ${page}: ${err.message}`);
      break;
    }

    if (!result.items || result.items.length === 0) break;

    for (const estate of result.items) {
      const listing = mapEstate(estate, city);
      if (listing) collected.push(listing);
    }

    if (page * PER_PAGE >= result.total) break;
    await sleep(DELAY_MS);
  }

  console.log(`  staženo ${collected.length} inzerátů`);
  return saveBatch(collected, `${city}:`);
}

export async function scrapeBezrealitky() {
  console.log('🔍 Bezrealitky scraper start');
  const cities = (process.env.SCRAPER_CITIES || 'praha,brno')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => CITIES[c]);

  for (const city of cities) {
    try {
      const cityCode = CITIES[city];
      const cityName = city === 'praha' ? 'Praha' : 'Brno';
      await scrapeCity(cityCode, cityName);
    } catch (err) {
      console.error(`✗ ${city}: ${err.message}`);
    }
  }
  console.log('✓ Bezrealitky scraper hotov');
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
