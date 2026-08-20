import * as cheerio from 'cheerio';
import { buildListing } from './normalize.js';
import { saveBatch } from './store.js';
import { fetchHtml, SourceError, sleep } from './http.js';
import {
  priceFromText,
  areaFromCard,
  dispositionFromCard,
  localityFromCard,
  cityFromLocality,
  unnbsp
} from './extract.js';

/**
 * Bezrealitky — čtení z HTML výpisu.
 *
 * Původní `api.bezrealitky.cz/v2/estates` byl odhad a vrací 404. Web běží
 * na Next.js a data přicházejí přes GraphQL, ale vyrenderovaný výpis je
 * v HTML, takže GraphQL rozebírat není nutné.
 *
 * Karta je `<article>` s hashovanou třídou z CSS modulů
 * (`PropertyCard_propertyCard__moO_5`), vedle níž ale stojí i stabilní
 * `propertyCard`. Ta se drží napříč nasazeními, takže se míří na ni.
 *
 * Výpis je celostátní — filtr na město dělá scraper sám nad adresou,
 * protože dotaz na kraj vyžaduje interní OSM identifikátory.
 */

const BASE = 'https://www.bezrealitky.cz/vyhledat';

const MAX_PAGES = 15;
const DELAY_MS = 1200;

const HINT = 'Ověř tvar stránky: `npm run discover` — vypíše, kde na výpisu '
  + 'reálně stojí cena, a podle toho se opraví parseListPage().';

const CARD = 'article.propertyCard, article[class*="propertyCard"]';

/** Rozebere jednu stránku výpisu. Čistá funkce nad HTML — testuje se bez sítě. */
export function parseListPage(html, allowedCities = ['praha', 'brno']) {
  const $ = cheerio.load(html);
  const listings = [];

  $(CARD).each((_, el) => {
    const card = $(el);
    const href = card.find('a[href*="/nemovitosti-byty-domy/"]').first().attr('href');
    if (!href) return;

    const price = priceFromText(card.find('.propertyPrice').text() || card.text());
    if (!price) return;

    const locality = localityFromCard($, card);
    const city = cityFromLocality(locality, allowedCities);
    if (!city) return; // zbytek republiky nás nezajímá

    const label = unnbsp(card.find('h2').first().text()).trim();

    listings.push({
      url: new URL(href, 'https://www.bezrealitky.cz').href,
      name: label || null,
      price,
      sizeM2: areaFromCard($, card),
      disposition: dispositionFromCard($, card),
      locality,
      photos: [card.find('img[src]').first().attr('src')].filter(Boolean),
      city
    });
  });

  return listings;
}

const pageUrl = (page) => {
  const url = new URL(BASE);
  url.searchParams.set('offerType', 'PRODEJ');
  url.searchParams.set('estateType', 'BYT');
  if (page > 1) url.searchParams.set('page', String(page));
  return url.href;
};

export async function scrapeBezrealitky() {
  console.log('🔍 Bezrealitky scraper start');

  const cities = (process.env.SCRAPER_CITIES || 'praha,brno')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c === 'praha' || c === 'brno');

  const byUrl = new Map();
  const errors = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = pageUrl(page);

    let html;
    try {
      html = await fetchHtml({ source: 'Bezrealitky', url, hint: HINT });
    } catch (err) {
      const msg = err instanceof SourceError ? err.format() : err.message;
      if (page === 1) {
        console.error(`✗ ${msg}`);
        errors.push(msg);
        break;
      }
      console.warn(`  ! strana ${page} selhala (${err.message}) — beru, co mám`);
      break;
    }

    // Karty se počítají před filtrem na město: stránka plná nabídek odjinud
    // je něco jiného než stránka, na které scraper nenašel vůbec nic.
    const cardsOnPage = cheerio.load(html)(CARD).length;
    if (page === 1 && cardsOnPage === 0) {
      const msg = new SourceError(
        `stránka se načetla (${html.length} B), ale nenašla se ani jedna karta inzerátu`,
        { source: 'Bezrealitky', url, hint: HINT }
      ).format();
      console.error(`✗ ${msg}`);
      errors.push(msg);
      break;
    }

    const before = byUrl.size;
    for (const listing of parseListPage(html, cities)) byUrl.set(listing.url, listing);
    console.log(`  strana ${page}: ${cardsOnPage} karet, z toho ${byUrl.size - before} nových v Praze/Brně`);

    // Celostátní výpis může mít celou stránku bez Prahy a Brna, takže se
    // nesmí končit podle přírůstku — jen když stránka nemá karty vůbec.
    if (cardsOnPage === 0) break;

    await sleep(DELAY_MS);
  }

  const collected = [...byUrl.values()]
    .map((raw) =>
      buildListing({ ...raw, source: 'bezrealitky', sourceName: 'Bezrealitky', listingType: 'byt' })
    )
    .filter(Boolean);

  console.log(`  staženo ${collected.length} inzerátů`);
  const stats = await saveBatch(collected, 'bezrealitky:');
  const ok = collected.length > 0;
  console.log(ok ? '✓ Bezrealitky hotovo' : '✗ Bezrealitky nepřineslo žádná data');
  return { source: 'Bezrealitky', ok, stats, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeBezrealitky()
    .then(async () => {
      if (process.env.SCRAPER_SINK !== 'json') {
        const { default: db } = await import('../db/index.js');
        await db.destroy();
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
