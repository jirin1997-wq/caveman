import axios from 'axios';
import { buildListing } from './normalize.js';
import { saveBatch } from './store.js';

/**
 * iDNES Reality má JSON API pro výpis nemovitostí.
 * Endpoint: https://reality.idnes.cz/api/v1/estates
 * Query params: regionId, page, limit
 */

const API = 'https://reality.idnes.cz/api/v1/estates';

const CITIES = {
  praha: { name: 'Praha', regionId: 1 },
  brno: { name: 'Brno', regionId: 7 }
};

const PER_PAGE = 30;
const MAX_PAGES = 50;
const DELAY_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPage(regionId, page) {
  const { data } = await axios.get(API, {
    params: {
      regionId,
      page,
      limit: PER_PAGE,
      type: 'byt',
      transaction: 'prodej',
      maxPrice: null
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; RealityScout/0.1)',
      Accept: 'application/json'
    },
    timeout: Number(process.env.SCRAPER_TIMEOUT) || 30000
  });

  return {
    items: data?.result?.items || [],
    total: data?.result?.total ?? 0
  };
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
      console.error(`  ✗ strana ${page}: ${err.message}`);
      break;
    }

    if (!result.items || result.items.length === 0) break;

    for (const estate of result.items) {
      const listing = mapEstate(estate, city, cityName);
      if (listing) collected.push(listing);
    }

    if (page * PER_PAGE >= result.total) break;
    await sleep(DELAY_MS);
  }

  console.log(`  staženo ${collected.length} inzerátů`);
  return saveBatch(collected, `${city}:`);
}

export async function scrapeIdnes() {
  console.log('🔍 iDNES Reality scraper start');
  const cities = (process.env.SCRAPER_CITIES || 'praha,brno')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => CITIES[c]);

  for (const city of cities) {
    try {
      const config = CITIES[city];
      await scrapeCity(city, config.name, config.regionId);
    } catch (err) {
      console.error(`✗ ${city}: ${err.message}`);
    }
  }
  console.log('✓ iDNES Reality scraper hotov');
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
