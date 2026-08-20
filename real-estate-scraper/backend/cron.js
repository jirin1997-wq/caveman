import schedule from 'node-schedule';
import { scrapeSreality } from './scrapers/sreality.js';
import { scrapeIdnes } from './scrapers/idnes.js';
import { scrapeBezrealitky } from './scrapers/bezrealitky.js';
import { scrapeDevelopers } from './scrapers/developers.js';
import { jsonSinkEnabled, flushJsonSink, writeJsonSnapshot } from './scrapers/json-sink.js';

/**
 * Denní běh: všechny scrapery, pak snímek trhu.
 * Pořadí je důležité — snímek musí vidět čerstvá data.
 * MVP: jen Praha zatím.
 */
/**
 * @returns {Promise<{ok:boolean, sources:object[]}>}
 *   `ok` je false, když nepřinesl data ani jeden zdroj — takový běh
 *   nesmí skončit jako úspěch, jinak si nikdo nevšimne, že se scrapery
 *   rozbily o změnu na cizím webu.
 */
export async function runDaily() {
  const started = Date.now();
  console.log(`[CRON] Start ${new Date().toISOString()}`);

  const scrapers = [
    { name: 'Sreality', fn: scrapeSreality },
    { name: 'iDNES Reality', fn: scrapeIdnes },
    { name: 'Bezrealitky', fn: scrapeBezrealitky }
  ];

  // Weby developerů si výpis dotahují JavaScriptem — ve staženém HTML
  // není ani jedna cena, takže z nich scraper nic vytáhnout nemůže
  // (ověřeno průzkumem: Trigema i Ekospol odpoví 200 bez cen, Central
  // Group vrací na výpisu 404). V denním běhu by jen plnily log chybami.
  // Zapnout jde, kdyby některý z nich přešel na serverové renderování.
  if (process.env.SCRAPER_DEVELOPERS === '1') {
    scrapers.push({ name: 'Developeři', fn: () => scrapeDevelopers('praha') });
  }

  const summary = [];
  for (const scraper of scrapers) {
    try {
      const res = await scraper.fn();
      summary.push({ name: scraper.name, ok: !!res?.ok, errors: res?.errors || [] });
    } catch (err) {
      console.error(`[CRON] ${scraper.name} spadl:`, err.message);
      summary.push({ name: scraper.name, ok: false, errors: [err.message] });
    }
  }

  // Snímek trhu má smysl jen nad čerstvými daty.
  const anyData = summary.some((s) => s.ok);
  if (anyData) {
    try {
      if (jsonSinkEnabled()) {
        flushJsonSink();
        writeJsonSnapshot();
      } else {
        const { writeSnapshot } = await import('./jobs/snapshot.js');
        await writeSnapshot();
      }
    } catch (err) {
      console.error('[CRON] Snímek selhal:', err.message);
    }
  } else {
    console.warn('[CRON] Přeskakuji snímek trhu — žádný zdroj nepřinesl data.');
  }

  const chyby = (n) => `${n} ${n === 1 ? 'chyba' : n < 5 ? 'chyby' : 'chyb'}`;

  console.log('\n[CRON] Souhrn:');
  for (const s of summary) {
    console.log(`  ${s.ok ? '✓' : '✗'} ${s.name}${s.errors.length ? ` — ${chyby(s.errors.length)}` : ''}`);
  }
  console.log(`[CRON] Hotovo za ${Math.round((Date.now() - started) / 1000)} s\n`);

  if (!anyData) {
    console.error('[CRON] ŽÁDNÝ ZDROJ NEPŘINESL DATA. Diagnostika: npm run probe');
  }
  return { ok: anyData, sources: summary };
}

// Každý den ve 2:00 místního času.
export const job = schedule.scheduleJob('0 2 * * *', runDaily);

/** V JSON režimu se žádné spojení neotevřelo, není co zavírat. */
async function closeDb() {
  if (jsonSinkEnabled()) return;
  const { default: db } = await import('./db/index.js');
  await db.destroy();
}

// Spuštění přímo z příkazové řádky: `node backend/cron.js --now`
if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes('--now')) {
  runDaily()
    .then(async (res) => {
      await closeDb();
      process.exit(res.ok ? 0 : 1); // nenulový kód, ať si toho všimne i cron/CI
    })
    .catch(async (err) => {
      console.error(err);
      await closeDb();
      process.exit(1);
    });
}
