import { fetchHtml, SourceError, sleep } from '../scrapers/http.js';
import { parseDetail } from '../scrapers/detail.js';
import {
  jsonSinkEnabled,
  listingsNeedingDetail,
  applyDetail,
  persistJsonSink
} from '../scrapers/json-sink.js';

/**
 * Dohledání údajů, které ve výpisu nejsou.
 *
 *   npm run enrich
 *
 * Výpis nese cenu, plochu, dispozici a adresu. Souřadnice, vybavenost,
 * konstrukce budovy a stav objektu jsou až na detailu inzerátu — bez nich
 * zůstane mapa prázdná a půlka filtrů nemá co filtrovat.
 *
 * Běží jako samostatný krok po nočním scrape a je záměrně omezený: jeden
 * dotaz na inzerát s odstupem, takže se za noc stihne jen dávka. Zbytek
 * se doplní další noc. U 14 tisíc inzerátů to znamená pár týdnů, než se
 * dataset naplní celý — proto se bere od nejnovějších.
 *
 * Sreality tu chybí schválně: jejich detail zacyklí přesměrování a dál
 * než na souhlas s cookies se scraper nedostane. Souřadnice od nich jdou
 * získat z výpisu, což je jiná cesta a řeší se jinde.
 */

const SOURCES = ['idnes', 'bezrealitky'];

const BATCH = Number(process.env.ENRICH_BATCH) || 400;
const DELAY_MS = Number(process.env.ENRICH_DELAY_MS) || 1200;

/** Kolik polí se z detailu skutečně podařilo přečíst. */
function filledFields(detail) {
  return Object.values(detail).filter(
    (v) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)
  ).length;
}

export async function enrichDetails({ batch = BATCH, sources = SOURCES } = {}) {
  if (!jsonSinkEnabled()) {
    console.error('Dohledávání zatím umí jen JSON režim — spusť se SCRAPER_SINK=json.');
    return { ok: false, done: 0, failed: 0 };
  }

  const queue = listingsNeedingDetail({ sources, limit: batch });
  console.log(`🔎 Dohledávání detailů: ${queue.length} inzerátů na řadě`);
  if (queue.length === 0) return { ok: true, done: 0, failed: 0 };

  let done = 0;
  let failed = 0;
  let emptyDetails = 0;

  for (const listing of queue) {
    let html;
    try {
      html = await fetchHtml({
        source: listing.source,
        url: listing.url,
        hint: 'Ověř tvar detailu: `npm run discover -- <url inzerátu>`'
      });
    } catch (err) {
      // Zmizelý nebo nedostupný inzerát není chyba běhu. Pokus se ale
      // zapíše, aby se ta samá mrtvá adresa nezkoušela každou noc znovu.
      failed += 1;
      applyDetail(listing.url, {});
      if (failed <= 5) {
        const msg = err instanceof SourceError ? err.message : err.message;
        console.warn(`  ! ${listing.url}\n    ${msg}`);
      }
      await sleep(DELAY_MS);
      continue;
    }

    const detail = parseDetail(html);
    if (filledFields(detail) === 0) emptyDetails += 1;

    applyDetail(listing.url, detail);
    done += 1;

    if (done % 50 === 0) console.log(`    ${done}/${queue.length}`);
    await sleep(DELAY_MS);
  }

  const count = persistJsonSink();

  console.log(
    `  dohledáno ${done}, nedostupných ${failed}`
      + (emptyDetails ? `, bez použitelných údajů ${emptyDetails}` : '')
  );
  console.log(`✓ Dohledávání hotovo (dataset má ${count} inzerátů)`);

  // Když se nepovede ani jeden, je rozbitý parser nebo zdroj — a to se
  // nemá ztratit mezi řádky jako „dohledáno 0".
  const ok = done > 0;
  if (!ok) console.error('✗ Dohledávání nepřineslo ani jeden detail');
  return { ok, done, failed, emptyDetails };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  enrichDetails()
    .then((res) => process.exit(res.ok ? 0 : 1))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
