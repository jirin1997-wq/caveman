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
 * Výpis se bere po městech (`/vypis/nabidka-prodej/byt/praha`). Celostátní
 * hledání zbylo jako záloha pro případ, že by ten tvar adresy přestal
 * platit — prochází nabídku celé republiky a scraper z ní pak většinu
 * zahodí podle adresy, protože dotaz na kraj chce interní OSM identifikátory.
 */

const BASE = 'https://www.bezrealitky.cz/vyhledat';

/**
 * Strop je jen pojistka proti nekonečnu — běh skončí dřív, jakmile strana
 * nepřinese nic nového.
 */
const MAX_PAGES = Number(process.env.SCRAPER_MAX_PAGES) || 300;
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

/**
 * Adresa výpisu pro jedno město. Celostátní hledání se používá jen jako
 * záloha: prochází nabídku celé republiky a my z ní 90 % zahodíme, což
 * je při stovkách stran zbytečná zátěž pro obě strany.
 */
const cityUrl = (city, page) => {
  const base = `https://www.bezrealitky.cz/vypis/nabidka-prodej/byt/${city}`;
  return page > 1 ? `${base}?page=${page}` : base;
};

const nationwideUrl = (page) => {
  const url = new URL(BASE);
  url.searchParams.set('offerType', 'PRODEJ');
  url.searchParams.set('estateType', 'BYT');
  if (page > 1) url.searchParams.set('page', String(page));
  return url.href;
};

const countCards = (html) => cheerio.load(html)(CARD).length;

/**
 * Projde výpis stránku po stránce a vrátí, co z něj vypadlo.
 * `cityScoped` říká, jestli je výpis už omezený na město — u celostátního
 * se nesmí končit podle přírůstku, protože celá strana může být odjinud.
 */
async function walkPages({ urlFor, cities, cityScoped, label, byUrl }) {
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = urlFor(page);

    let html;
    try {
      html = await fetchHtml({ source: 'Bezrealitky', url, hint: HINT });
    } catch (err) {
      if (page === 1) throw err;
      console.warn(`    ! strana ${page} selhala (${err.message}) — beru, co mám`);
      return;
    }

    // Karty se počítají před filtrem na město: stránka plná nabídek odjinud
    // je něco jiného než stránka, na které scraper nenašel vůbec nic.
    const cardsOnPage = countCards(html);
    if (page === 1 && cardsOnPage === 0) {
      throw new SourceError(
        `stránka se načetla (${html.length} B), ale nenašla se ani jedna karta inzerátu`,
        { source: 'Bezrealitky', url, hint: HINT }
      );
    }
    if (cardsOnPage === 0) return;

    const before = byUrl.size;
    for (const listing of parseListPage(html, cities)) byUrl.set(listing.url, listing);
    const added = byUrl.size - before;
    console.log(`    ${label} strana ${page}: ${cardsOnPage} karet, ${added} nových`);

    if (cityScoped && added === 0) return;

    await sleep(DELAY_MS);
  }
}

export async function scrapeBezrealitky() {
  console.log('🔍 Bezrealitky scraper start');

  const cities = (process.env.SCRAPER_CITIES || 'praha,brno')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c === 'praha' || c === 'brno');

  const byUrl = new Map();
  const errors = [];

  for (const city of cities) {
    console.log(`📍 Bezrealitky — ${city}`);
    try {
      await walkPages({
        urlFor: (page) => cityUrl(city, page),
        cities: [city],
        cityScoped: true,
        label: city,
        byUrl
      });
    } catch (err) {
      // Výpis po městech je odhad podle tvaru jejich adres. Když neplatí,
      // pořád zbývá celostátní hledání, jen se z něj většina zahodí.
      const msg = err instanceof SourceError ? err.format() : err.message;
      console.warn(`  ! výpis pro ${city} nevyšel — zkouším celostátní hledání\n    ${msg}`);
      try {
        await walkPages({
          urlFor: nationwideUrl,
          cities,
          cityScoped: false,
          label: 'celostátně',
          byUrl
        });
      } catch (fallbackErr) {
        const text = fallbackErr instanceof SourceError
          ? fallbackErr.format()
          : fallbackErr.message;
        console.error(`✗ ${text}`);
        errors.push(text);
      }
      break; // celostátní výpis pokrývá obě města naráz
    }
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
