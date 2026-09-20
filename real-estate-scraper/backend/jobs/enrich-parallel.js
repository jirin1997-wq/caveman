/**
 * Paralelní dohledávání detailů — finišuje za dny místo týdnů.
 *
 * Původní enrich.js běží sekvenčně s 1200ms delajem — 400 za noc, 14+ nocí.
 * Tenhle běží paralelně (3-5 concurrent) s exponenciálním backoff na chyby.
 * Za jednu noc zvládne 2000-4000 inzerátů podle délky detailů.
 *
 *   npm run enrich:parallel
 *   ENRICH_CONCURRENT=5 npm run enrich:parallel    # více workerů
 */

import { fetchHtml, SourceError, sleep } from '../scrapers/http.js';
import { parseDetail } from '../scrapers/detail.js';
import {
  jsonSinkEnabled,
  listingsNeedingDetail,
  applyDetail,
  persistJsonSink
} from '../scrapers/json-sink.js';
import PQueue from 'p-queue';

const SOURCES = ['idnes', 'bezrealitky'];
const BATCH = Number(process.env.ENRICH_BATCH) || 2000;
const CONCURRENT = Number(process.env.ENRICH_CONCURRENT) || 4;
const REQUEST_TIMEOUT_MS = 15000;

function filledFields(detail) {
  return Object.values(detail).filter(
    (v) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)
  ).length;
}

async function fetchDetailWithBackoff(listing, maxRetries = 2) {
  let lastErr;
  let delay = 500;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const html = await Promise.race([
        fetchHtml({
          source: listing.source,
          url: listing.url,
          hint: 'Ověř tvar detailu: `npm run discover -- <url inzerátu>`'
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), REQUEST_TIMEOUT_MS)
        )
      ]);
      return html;
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        await sleep(delay);
        delay = Math.min(delay * 2, 5000);  // Max 5s backoff
      }
    }
  }

  throw lastErr;
}

export async function enrichDetailsParallel({
  batch = BATCH,
  concurrent = CONCURRENT,
  sources = SOURCES
} = {}) {
  if (!jsonSinkEnabled()) {
    console.error('Dohledávání zatím umí jen JSON režim — spusť se SCRAPER_SINK=json.');
    return { ok: false, done: 0, failed: 0 };
  }

  const queue = listingsNeedingDetail({ sources, limit: batch });
  console.log(`🔎 Paralelní dohledávání: ${queue.length} inzerátů, ${concurrent} workerů`);
  if (queue.length === 0) return { ok: true, done: 0, failed: 0 };

  const pQueue = new PQueue({ concurrency: concurrent, interval: 60000, intervalCap: 60 });

  let done = 0;
  let failed = 0;
  let emptyDetails = 0;

  const startTime = Date.now();

  const promises = queue.map((listing) =>
    pQueue.add(async () => {
      let html;
      try {
        html = await fetchDetailWithBackoff(listing);
      } catch (err) {
        failed += 1;
        applyDetail(listing.url, {});
        if (failed <= 5) {
          const msg = err instanceof SourceError ? err.message : err.message;
          console.warn(`  ✗ ${listing.url}\n    ${msg}`);
        }
        return;
      }

      const detail = parseDetail(html);
      if (filledFields(detail) === 0) emptyDetails += 1;

      applyDetail(listing.url, detail);
      done += 1;

      if ((done + failed) % 100 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = ((done + failed) / elapsed).toFixed(1);
        console.log(`    ${done + failed}/${queue.length} (${rate}/s)`);
      }
    })
  );

  await Promise.all(promises);

  const count = persistJsonSink();
  const elapsed = (Date.now() - startTime) / 1000;

  console.log(
    `  dohledáno ${done}, nedostupných ${failed}`
      + (emptyDetails ? `, bez využitelných údajů ${emptyDetails}` : '')
  );
  console.log(`✓ Hotovo za ${Math.round(elapsed)}s (${(3600*done/elapsed).toFixed(0)}/h)`);
  console.log(`✓ Dataset má ${count} inzerátů`);

  const ok = done > 0;
  if (!ok) console.error('✗ Dohledávání nepřineslo ani jeden detail');
  return { ok, done, failed, emptyDetails };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  enrichDetailsParallel()
    .then((res) => process.exit(res.ok ? 0 : 1))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
