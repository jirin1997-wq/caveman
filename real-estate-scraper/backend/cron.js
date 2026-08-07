import schedule from 'node-schedule';
import { scrapeSreality } from './scrapers/sreality.js';

// Run daily at 2:00 AM
const job = schedule.scheduleJob('0 2 * * *', async () => {
  console.log('[CRON] Running daily scrape at 2:00 AM');
  try {
    await scrapeSreality();
  } catch (err) {
    console.error('[CRON] Error:', err.message);
  }
});

export { job };
