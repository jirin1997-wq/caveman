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

/**
 * Kolik stran výpisu projít. Sreality mají pro Prahu přes 270 stran, takže
 * dřívějších 15 bralo jen pár procent nabídky. Strop je tu jen jako pojistka
 * proti nekonečnu — běh stejně skončí dřív, jakmile strana nepřinese nic
 * nového.
 */
const MAX_PAGES = Number(process.env.SCRAPER_MAX_PAGES) || 300;
const DELAY_MS = 1200;

const HINT = 'Ověř tvar stránky: `npm run discover` — vypíše, kde na výpisu '
  + 'reálně stojí cena, a podle toho se opraví parseListPage().';

/** Karta inzerátu; `region-tip-item` je tentýž tvar, jen propagovaná nabídka. */
const CARD = 'li[id^="estate-list-item"], li[id^="region-tip-item"]';

/**
 * Vyřízne z textu vyvážený objekt `{…}` začínající na dané pozici.
 *
 * Řetězce se přeskakují i s escapováním — bez toho by závorka uvnitř
 * textové hodnoty ukončila objekt na špatném místě.
 */
export function balancedObject(text, start) {
  if (text[start] !== '{') return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

/**
 * Poloha jednotlivých inzerátů z JSONu vloženého do výpisu.
 *
 * Sreality renderují stránku z dat, která do ní zároveň vloží — a je v nich
 * víc, než co stojí na kartě: souřadnice, ulice s číslem popisným i městská
 * část zvlášť. Souřadnice jinak nemáme odkud vzít, protože jejich detail
 * zacyklí přesměrování.
 *
 * Objekt polohy stojí v záznamu až za `id`, takže se hledá nejbližší
 * předcházející identifikátor. Kdyby Sreality pořadí klíčů změnily,
 * mapa vyjde prázdná a scraper poběží dál bez souřadnic — proto se
 * pokrytí hlásí do logu.
 */
export function localitiesFromState(html) {
  const text = String(html || '');
  const byId = new Map();

  for (const match of text.matchAll(/"locality"\s*:\s*\{/g)) {
    const json = balancedObject(text, match.index + match[0].length - 1);
    if (!json) continue;

    let locality;
    try {
      locality = JSON.parse(json);
    } catch {
      continue;
    }
    if (!Number.isFinite(locality?.latitude)) continue;

    const before = text.slice(Math.max(0, match.index - 8000), match.index);
    const ids = [...before.matchAll(/"id"\s*:\s*(\d{6,})/g)];
    if (ids.length === 0) continue;

    byId.set(ids[ids.length - 1][1], locality);
  }

  return byId;
}

/** Adresa z objektu polohy: „Schoellerova 28, Praha 9 - Čakovice". */
export function addressFromLocality(locality) {
  if (!locality) return null;

  const street = [locality.street, locality.streetNumber].filter(Boolean).join(' ');
  const area = [locality.district, locality.cityPart]
    .filter((part, i, all) => part && all.indexOf(part) === i)
    .join(' - ');

  return [street, area || locality.city].filter(Boolean).join(', ') || null;
}

/** Identifikátor inzerátu z `id` karty nebo z adresy detailu. */
const idFromCard = (cardId, href) =>
  cardId?.match(/(\d{6,})$/)?.[1] || String(href).match(/(\d{6,})\/?$/)?.[1] || null;

/**
 * Rozebere jednu stránku výpisu.
 * Čistá funkce nad HTML — testuje se bez sítě.
 */
export function parseListPage(html, city) {
  const $ = cheerio.load(html);
  const localities = localitiesFromState(html);
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

    // Adresa z vloženého JSONu je přesnější než ta na kartě — nese ulici
    // s číslem popisným. Když chybí, zbývá text karty.
    const locality = localities.get(idFromCard(card.attr('id'), href));

    listings.push({
      url: new URL(href, 'https://www.sreality.cz').href,
      name: paragraphs.find((t) => /m²|Prodej|Pronájem/i.test(t)) || paragraphs[0] || null,
      price,
      sizeM2: areaFromCard($, card),
      disposition: dispositionFromCard($, card),
      locality: addressFromLocality(locality) || localityFromCard($, card),
      lat: locality?.latitude ?? null,
      lng: locality?.longitude ?? null,
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
  let emptyStreak = 0;

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
    const added = byUrl.size - before;

    // Po stránkách, ať je z logu poznat, kde se výpis vyčerpal — a jestli
    // stránkování vůbec funguje. Dvě prázdné strany za sebou znamenají, že
    // se parametr ignoruje a pořád dostáváme tu první.
    console.log(`    strana ${page}: ${listings.length} inzerátů, ${added} nových`);

    // Jedna strana beze změny konec výpisu neznamená: zdroj mezi dotazy
    // přeskládá pořadí nebo stranu zopakuje a scraper by skončil v půlce.
    // Přesně tím jsme u iDNES přicházeli o dvě třetiny pražské nabídky.
    emptyStreak = added === 0 ? emptyStreak + 1 : 0;
    if (emptyStreak >= 2) {
      console.log('    dvě strany bez nového inzerátu — konec výpisu');
      break;
    }

    await sleep(DELAY_MS);
  }

  const collected = [...byUrl.values()]
    .map((raw) => buildListing({ ...raw, source: 'sreality', sourceName: 'Sreality', listingType: 'byt' }))
    .filter(Boolean);

  // Souřadnice se čtou z JSONu vloženého do výpisu. Kdyby Sreality změnily
  // pořadí klíčů nebo tvar dat, přestaly by chodit — a bez téhle řádky by
  // to vypadalo jen jako prázdná mapa, ne jako rozbitý scraper.
  const withGps = collected.filter((l) => l.latitude != null).length;
  console.log(
    `  staženo ${collected.length} inzerátů`
      + `, se souřadnicemi ${withGps} (${Math.round((100 * withGps) / (collected.length || 1))} %)`
  );
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
