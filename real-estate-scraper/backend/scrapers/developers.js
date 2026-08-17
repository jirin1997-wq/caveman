import * as cheerio from 'cheerio';
import { buildListing } from './normalize.js';
import { saveBatch } from './store.js';
import { fetchHtml, SourceError, sleep } from './http.js';

/**
 * Agregátor webů velkých developerů v ČR (Trigema, Central Group, Ekospol).
 *
 * ⚠️ NEOVĚŘENO. CSS selektory níže (`[data-project-item]`, `.ekospolProperty`,
 * `[data-price]` …) jsou vymyšlené — nejsou odečtené ze skutečného HTML,
 * protože vývojové prostředí na tyhle weby nepustí. Skoro jistě nebudou
 * sedět a každý parser bude potřeba přepsat podle reálné struktury stránky.
 *
 * Postup až budeš mít přístup k síti: stáhni si stránku
 * (`curl -A Mozilla https://www.trigema.cz/nemovitosti/ > /tmp/t.html`),
 * najdi skutečné třídy a přepiš příslušný `parse*()`.
 *
 * Pozn.: HTML scraping je ze své podstaty křehký — rozbije se při každém
 * redesignu. Kde to jde, hledej radši JSON, kterým si web plní výpis sám.
 */

const DELAY_MS = 1500;
const HINT = 'Selektory nejspíš nesedí. Spusť `npm run probe` — uloží HTML do '
  + 'probe-output/, v něm najdi skutečné třídy a přepiš příslušný parse*().';

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

const fetchPage = (url, source) => fetchHtml({ source, url, hint: HINT });

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

  const html = await fetchPage(devConfig.listingsUrl, devConfig.name);
  const items = devConfig.parser(html);

  // Stránka se načetla, ale selektory nic nenašly — to je chyba parseru,
  // ne prázdná nabídka. Kdysi to prošlo tiše jako „0 inzerátů".
  if (items.length === 0) {
    throw new SourceError(
      `stránka se načetla (${html.length} B), ale selektory nenašly ani jednu nemovitost`,
      { source: devConfig.name, url: devConfig.listingsUrl, hint: HINT }
    );
  }

  const collected = [];
  for (const item of items) {
    const listing = toDBListing(item, devKey, devConfig.name, city);
    if (listing) collected.push(listing);
  }

  await sleep(DELAY_MS);
  console.log(`    ${collected.length} nemovitostí`);
  return collected;
}

export async function scrapeDevelopers(city = 'praha') {
  console.log('🏗️  Developeři scraper start');
  const allListings = [];
  const errors = [];

  for (const [devKey, devConfig] of Object.entries(DEVELOPERS)) {
    try {
      allListings.push(...(await scrapeDeveloper(devKey, devConfig, city)));
    } catch (err) {
      const msg = err instanceof SourceError ? err.format() : `${devConfig.name}: ${err.message}`;
      console.error(`  ✗ ${msg}`);
      errors.push(msg);
    }
  }

  console.log(`  staženo ${allListings.length} inzerátů celkem`);
  const stats = await saveBatch(allListings, 'developers:');
  const ok = allListings.length > 0;
  console.log(ok ? '✓ Developeři hotovo' : '✗ Developeři nepřinesli žádná data');
  return { source: 'Developeři', ok, stats, errors };
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
