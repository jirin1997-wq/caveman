import * as cheerio from 'cheerio';
import { buildListing } from './normalize.js';
import { saveBatch } from './store.js';
import { fetchHtml, SourceError, sleep } from './http.js';
import {
  priceFromText,
  areaFromCard,
  dispositionFromCard,
  localityFromCard,
  unnbsp
} from './extract.js';

/**
 * Sreality — čtení z HTML výpisu.
 *
 * Původně tady bylo volání `/api/cs/v2/estates`. Ostrý běh ukázal, že
 * takový endpoint neexistuje (HTTP 404); veřejné API, o kterém se psalo,
 * dnes takhle dostupné není. Výpis se proto čte ze stránky, kterou vidí
 * návštěvník.
 *
 * Karta inzerátu je `<li id="estate-list-item-{id}">`. Třídy jsou emotion
 * hashe (`css-abbpa2`), které se mění při každém nasazení jejich webu —
 * na těch se stavět nedá, na `id` ano. Uvnitř karty stojí tři odstavce
 * v pořadí: název s dispozicí a plochou, adresa, cena.
 */

const BASE = 'https://www.sreality.cz/hledani/prodej/byty';

const CITY_PATHS = { praha: 'praha', brno: 'brno' };

const MAX_PAGES = 15;
const DELAY_MS = 1200;

const HINT = 'Ověř tvar stránky: `npm run discover` — vypíše, kde na výpisu '
  + 'reálně stojí cena, a podle toho se opraví parseListPage().';

/** Karta inzerátu; `region-tip-item` je tentýž tvar, jen propagovaná nabídka. */
const CARD = 'li[id^="estate-list-item"], li[id^="region-tip-item"]';

/**
 * Rozebere jednu stránku výpisu.
 * Čistá funkce nad HTML — testuje se bez sítě.
 */
export function parseListPage(html, city) {
  const $ = cheerio.load(html);
  const listings = [];

  $(CARD).each((_, el) => {
    const card = $(el);
    const href = card.find('a[href*="/detail/"]').first().attr('href');
    if (!href) return;

    const paragraphs = card
      .find('p')
      .map((__, p) => unnbsp($(p).text()).trim())
      .get()
      .filter(Boolean);

    const price = priceFromText(card.text());
    if (!price) return;

    listings.push({
      url: new URL(href, 'https://www.sreality.cz').href,
      name: paragraphs.find((t) => /m²|Prodej|Pronájem/i.test(t)) || paragraphs[0] || null,
      price,
      sizeM2: areaFromCard($, card),
      disposition: dispositionFromCard($, card),
      locality: localityFromCard($, card),
      photos: [card.find('img[src]').first().attr('src')].filter(Boolean),
      city
    });
  });

  return listings;
}

const pageUrl = (path, page) =>
  page === 1 ? `${BASE}/${path}` : `${BASE}/${path}?strana=${page}`;

async function scrapeCity(city) {
  console.log(`📍 Sreality — ${city}`);
  const byUrl = new Map();

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = pageUrl(CITY_PATHS[city], page);

    let html;
    try {
      html = await fetchHtml({ source: 'Sreality', url, hint: HINT });
    } catch (err) {
      // První stránka je ověření zdroje — když neprojde, je zdroj rozbitý.
      // Výpadek dál znamená jen kratší dávku, s tou se dá pracovat.
      if (page === 1) throw err;
      console.warn(`  ! strana ${page} selhala (${err.message}) — beru, co mám`);
      break;
    }

    const listings = parseListPage(html, city);

    if (page === 1 && listings.length === 0) {
      throw new SourceError(
        `stránka se načetla (${html.length} B), ale nenašel se ani jeden inzerát`,
        { source: 'Sreality', url, hint: HINT }
      );
    }

    // Stránkování se nedá ověřit dopředu; když další strana přinese jen
    // to, co už máme, znamená to, že parametr neplatí nebo výpis skončil.
    const before = byUrl.size;
    for (const listing of listings) byUrl.set(listing.url, listing);
    if (byUrl.size === before) break;

    await sleep(DELAY_MS);
  }

  const collected = [...byUrl.values()]
    .map((raw) => buildListing({ ...raw, source: 'sreality', sourceName: 'Sreality', listingType: 'byt' }))
    .filter(Boolean);

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
    .filter((c) => CITY_PATHS[c]);

  const results = [];
  const errors = [];

  for (const city of cities) {
    try {
      results.push(await scrapeCity(city));
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
  scrapeSreality()
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
