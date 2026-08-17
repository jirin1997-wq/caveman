import axios from 'axios';
import * as cheerio from 'cheerio';
import { buildListing } from './normalize.js';
import { saveBatch } from './store.js';

/**
 * Agregátor webů velkých vývojářů (developerů) v ČR.
 * Každý developer má jiný web s jiným formátem — HTML parsing.
 *
 * MVP: Trigema, Central Group, Ekospol — jen Praha.
 */

const DELAY_MS = 1500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DEVELOPERS = {
  trigema: {
    name: 'Trigema',
    listingsUrl: 'https://www.trigema.cz/nemovitosti/',
    parser: parseTrigema
  },
  centralGroup: {
    name: 'Central Group',
    listingsUrl: 'https://www.centralgroup.cz/nemovitosti/',
    parser: parseCentralGroup
  },
  ekospol: {
    name: 'Ekospol',
    listingsUrl: 'https://www.ekospol.cz/nemovitosti/praha/',
    parser: parseEkospol
  }
};

async function fetchPage(url) {
  const { data } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; RealityScout/0.1)'
    },
    timeout: Number(process.env.SCRAPER_TIMEOUT) || 30000
  });
  return data;
}

// Trigema parser
function parseTrigema(html) {
  const $ = cheerio.load(html);
  const listings = [];

  $('[data-project-item]').each((_, elem) => {
    const title = $(elem).find('[data-title]').text().trim();
    const price = $(elem).find('[data-price]').text().match(/[\d\s]+/)?.[0];
    const area = $(elem).find('[data-area]').text().match(/[\d,]+/)?.[0];
    const url = $(elem).find('a').attr('href');
    const img = $(elem).find('img').attr('src');

    if (!title || !price || !url) return;

    listings.push({
      url: new URL(url, DEVELOPERS.trigema.listingsUrl).href,
      title,
      price: parseInt(price.replace(/\s/g, ''), 10),
      area: area ? parseFloat(area.replace(',', '.')) : null,
      img
    });
  });

  return listings;
}

// Central Group parser
function parseCentralGroup(html) {
  const $ = cheerio.load(html);
  const listings = [];

  $('.property-card, [data-property]').each((_, elem) => {
    const title = $(elem).find('h3, [data-property-name]').text().trim();
    const priceText = $(elem).find('[data-price], .price').text();
    const price = priceText.match(/[\d\s]+/)?.[0];
    const areaText = $(elem).find('[data-area], .area').text();
    const area = areaText.match(/[\d,]+/)?.[0];
    const url = $(elem).find('a[href*="/nemovitosti/"]').attr('href') || $(elem).attr('href');
    const img = $(elem).find('img').attr('src') || $(elem).find('img').attr('data-src');

    if (!title || !price || !url) return;

    listings.push({
      url: new URL(url, DEVELOPERS.centralGroup.listingsUrl).href,
      title,
      price: parseInt(price.replace(/\s/g, ''), 10),
      area: area ? parseFloat(area.replace(',', '.')) : null,
      img
    });
  });

  return listings;
}

// Ekospol parser
function parseEkospol(html) {
  const $ = cheerio.load(html);
  const listings = [];

  $('.ekospolProperty, [data-property-listing]').each((_, elem) => {
    const link = $(elem).find('a[href*="nemovitosti"]').first();
    const url = link.attr('href');
    if (!url) return;

    const title = link.find('[data-title], .property-name').text().trim()
      || $(elem).find('h3, h4').text().trim();
    const priceText = $(elem).find('[data-price], .property-price').text();
    const price = priceText.match(/[\d\s]+/)?.[0];
    const areaText = $(elem).find('[data-area], .property-area').text();
    const area = areaText.match(/[\d,]+/)?.[0];
    const img = $(elem).find('img').attr('src') || $(elem).find('img').attr('data-src');

    if (!title || !price) return;

    listings.push({
      url: new URL(url, 'https://www.ekospol.cz/').href,
      title,
      price: parseInt(price.replace(/\s/g, ''), 10),
      area: area ? parseFloat(area.replace(',', '.')) : null,
      img
    });
  });

  return listings;
}

function toDBListing(item, source, sourceName, city) {
  return buildListing({
    url: item.url,
    source,
    sourceName,
    listingType: 'novostavba',
    city,
    name: item.title,
    price: item.price,
    sizeM2: item.area,
    photos: item.img ? [item.img] : [],
    description: item.title
  });
}

async function scrapeDeveloper(devKey, devConfig, city) {
  console.log(`  ${devConfig.name}…`);
  const collected = [];

  try {
    const html = await fetchPage(devConfig.listingsUrl);
    const items = devConfig.parser(html);

    for (const item of items) {
      const listing = toDBListing(item, devKey, devConfig.name, city);
      if (listing) collected.push(listing);
    }

    await sleep(DELAY_MS);
  } catch (err) {
    console.error(`    ✗ ${err.message}`);
  }

  return collected;
}

export async function scrapeDevelopers(city = 'praha') {
  console.log('🏗️  Developeři scraper start');
  const allListings = [];

  for (const [devKey, devConfig] of Object.entries(DEVELOPERS)) {
    try {
      const listings = await scrapeDeveloper(devKey, devConfig, city);
      allListings.push(...listings);
    } catch (err) {
      console.error(`✗ ${devConfig.name}: ${err.message}`);
    }
  }

  console.log(`  staženo ${allListings.length} inzerátů celkem`);
  return saveBatch(allListings, 'developers:');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { default: db } = await import('../db/index.js');
  const city = process.argv[2] || 'praha';
  scrapeDevelopers(city)
    .then(() => db.destroy())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
