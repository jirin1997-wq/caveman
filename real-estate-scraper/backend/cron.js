import schedule from 'node-schedule';
import db from './db/index.js';
import { scrapeSreality } from './scrapers/sreality.js';
import { scrapeIdnes } from './scrapers/idnes.js';
import { scrapeBezrealitky } from './scrapers/bezrealitky.js';
import { scrapeDevelopers } from './scrapers/developers.js';
import { writeSnapshot } from './jobs/snapshot.js';

/**
 * Denní běh: všechny scrapery, pak snímek trhu.
 * Pořadí je důležité — snímek musí vidět čerstvá data.
 * MVP: jen Praha zatím.
 */
export async function runDaily() {
  const started = Date.now();
  console.log(`[CRON] Start ${new Date().toISOString()}`);

  const scrapers = [
    { name: 'Sreality', fn: scrapeSreality },
    { name: 'iDNES Reality', fn: scrapeIdnes },
    { name: 'Bezrealitky', fn: scrapeBezrealitky },
    { name: 'Developeři', fn: () => scrapeDevelopers('praha') }
  ];

  for (const scraper of scrapers) {
    try {
      await scraper.fn();
    } catch (err) {
      console.error(`[CRON] ${scraper.name} selhal:`, err.message);
    }
  }

  try {
    await writeSnapshot();
  } catch (err) {
    console.error('[CRON] Snímek selhal:', err.message);
  }

  console.log(`[CRON] Hotovo za ${Math.round((Date.now() - started) / 1000)} s`);
}

// Každý den ve 2:00 místního času.
export const job = schedule.scheduleJob('0 2 * * *', runDaily);

// Spuštění přímo z příkazové řádky: `node backend/cron.js --now`
if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes('--now')) {
  runDaily()
    .then(() => db.destroy())
    .then(() => process.exit(0));
}
