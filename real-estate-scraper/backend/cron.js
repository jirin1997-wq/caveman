import schedule from 'node-schedule';
import db from './db/index.js';
import { scrapeSreality } from './scrapers/sreality.js';
import { writeSnapshot } from './jobs/snapshot.js';

/**
 * Denní běh: nejdřív stáhnout inzeráty, pak z nich udělat snímek trhu.
 * Pořadí je důležité — snímek musí vidět čerstvá data.
 */
export async function runDaily() {
  const started = Date.now();
  console.log(`[CRON] Start ${new Date().toISOString()}`);

  try {
    await scrapeSreality();
  } catch (err) {
    console.error('[CRON] Scraper selhal:', err.message);
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
