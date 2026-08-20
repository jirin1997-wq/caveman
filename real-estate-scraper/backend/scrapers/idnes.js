import * as cheerio from 'cheerio';
import { buildListing } from './normalize.js';
import { saveBatch } from './store.js';
import { fetchHtml, SourceError, sleep } from './http.js';
import {
  priceFromText,
  areaFromCard,
  dispositionFromCard,
  localityFromCard,
  cardsFromLinks,
  unnbsp
} from './extract.js';

/**
 * iDNES Reality — čtení z HTML výpisu.
 *
 * Původní `/api/v1/estates` byl odhad a vrací 404. Výpis se čte ze stránky.
 * Značkování je ze všech tří portálů nejčistší: pojmenované BEM třídy
 * (`c-products__price`, `c-products__content`), které se nemění s každým
 * nasazením. Karty se přesto hledají podle odkazu na detail — tím je scraper
 * odolný i vůči přejmenování tříd.
 */

const BASE = 'https://reality.idnes.cz/s/prodej/byty';

const CITY_PATHS = { praha: 'praha', brno: 'brno' };

const MAX_PAGES = 15;
const DELAY_MS = 1200;

const DETAIL = /\/detail\/prodej\/byt\//;

const HINT = 'Ověř tvar stránky: `npm run discover` — vypíše, kde na výpisu '
  + 'reálně stojí cena, a podle toho se opraví parseListPage().';

/**
 * Adresa z adresy detailu, když ji karta neuvádí zvlášť.
 * `/detail/prodej/byt/praha-8-ouholicka/<id>/` → „Ouholicka, Praha 8".
 */
export function localityFromHref(href) {
  const match = String(href).match(/\/detail\/prodej\/byt\/([a-z0-9-]+)\//i);
  if (!match) return null;

  const parts = match[1].split('-');
  const cityIndex = parts.findIndex((p) => p === 'praha' || p === 'brno');
  if (cityIndex === -1) return null;

  const city = parts[cityIndex] === 'praha' ? 'Praha' : 'Brno';
  const next = parts[cityIndex + 1];
  const district = /^\d+$/.test(next || '') ? `${city} ${next}` : city;
  const street = parts.slice(/^\d+$/.test(next || '') ? cityIndex + 2 : cityIndex + 1).join(' ');

  return street ? `${street}, ${district}` : district;
}

/** Rozebere jednu stránku výpisu. Čistá funkce nad HTML — testuje se bez sítě. */
export function parseListPage(html, city) {
  const $ = cheerio.load(html);

  return cardsFromLinks($, DETAIL)
    .map(({ href, card }) => {
      const price = priceFromText(card.find('.c-products__price').text() || card.text());
      if (!price) return null;

      const title = unnbsp(card.find('h2, h3').first().text()).trim() || null;

      return {
        url: new URL(href, 'https://reality.idnes.cz').href,
        name: title,
        price,
        sizeM2: areaFromCard($, card),
        disposition: dispositionFromCard($, card),
        locality: localityFromCard($, card) || localityFromHref(href),
        photos: [card.find('img[src]').first().attr('src')].filter(Boolean),
        city
      };
    })
    .filter(Boolean);
}

const pageUrl = (path, page) =>
  page === 1 ? `${BASE}/${path}/` : `${BASE}/${path}/?page=${page}`;

async function scrapeCity(city) {
  console.log(`📍 iDNES Reality — ${city}`);
  const byUrl = new Map();

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = pageUrl(CITY_PATHS[city], page);

    let html;
    try {
      html = await fetchHtml({ source: 'iDNES Reality', url, hint: HINT });
    } catch (err) {
      if (page === 1) throw err;
      console.warn(`  ! strana ${page} selhala (${err.message}) — beru, co mám`);
      break;
    }

    const listings = parseListPage(html, city);

    if (page === 1 && listings.length === 0) {
      throw new SourceError(
        `stránka se načetla (${html.length} B), ale nenašel se ani jeden inzerát`,
        { source: 'iDNES Reality', url, hint: HINT }
      );
    }

    const before = byUrl.size;
    for (const listing of listings) byUrl.set(listing.url, listing);
    if (byUrl.size === before) break;

    await sleep(DELAY_MS);
  }

  const collected = [...byUrl.values()]
    .map((raw) =>
      buildListing({ ...raw, source: 'idnes', sourceName: 'iDNES Reality', listingType: 'byt' })
    )
    .filter(Boolean);

  console.log(`  staženo ${collected.length} inzerátů`);
  const stats = await saveBatch(collected, `${city}:`);
  return { city, ok: collected.length > 0, stats };
}

export async function scrapeIdnes() {
  console.log('🔍 iDNES Reality scraper start');
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
  console.log(ok ? '✓ iDNES Reality hotovo' : '✗ iDNES Reality nepřineslo žádná data');
  return { source: 'iDNES Reality', ok, cities: results, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeIdnes()
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
