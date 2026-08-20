import fs from 'node:fs';
import path from 'node:path';

/**
 * Druhý cíl zápisu pro scrapery — místo Postgresu píše do JSON souborů
 * v `data/`. Existuje kvůli běhu v CI, kde žádná databáze není: denní
 * GitHub Action stáhne data a výsledek commitne do repozitáře, takže
 * historie commitů je zároveň historií trhu.
 *
 * Zapíná se přes `SCRAPER_SINK=json`. Bez té proměnné se nic nemění
 * a scrapery jedou do databáze jako dřív.
 *
 * Sémantika upsertu je záměrně stejná jako v `store.js`:
 *   - `first_seen_at` se nikdy nepřepisuje (drží stáří inzerátu)
 *   - změna ceny se zapíše do `price_history`
 *   - zlevnění nastaví `is_discounted` a uschová `original_price`
 * Kdyby se rozešly, měl by graf vývoje cen jiný tvar podle toho,
 * kde zrovna scraper běžel.
 */

const KEEP_DAYS = Number(process.env.SCRAPER_KEEP_DAYS) || 30;

export function jsonSinkEnabled() {
  return process.env.SCRAPER_SINK === 'json';
}

const dataDir = () => path.resolve(process.env.SCRAPER_DATA_DIR || 'data');
const listingsFile = () => path.join(dataDir(), 'listings.json');
const snapshotsFile = () => path.join(dataDir(), 'market-snapshots.json');

let cache = null;
const seenThisRun = new Set();

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function load() {
  if (!cache) {
    const doc = readJson(listingsFile(), null);
    cache = Array.isArray(doc?.listings) ? doc : { updated_at: null, listings: [] };
  }
  return cache;
}

/**
 * `buildListing()` posílá amenities a photos jako JSON řetězce, protože
 * to tak chce Postgres. V souboru by z toho bylo dvojité kódování, které
 * nejde přečíst ani okem, ani frontendem — tady se to rozbalí zpátky.
 */
function decodeFields(listing) {
  const out = { ...listing };
  for (const key of ['amenities', 'photos']) {
    if (typeof out[key] === 'string') {
      try {
        out[key] = JSON.parse(out[key]);
      } catch {
        out[key] = [];
      }
    }
    if (!Array.isArray(out[key])) out[key] = [];
  }
  return out;
}

/** @returns {'created'|'updated'|'unchanged'} */
export function upsertJson(listing, now = new Date()) {
  const store = load();
  const stamp = now.toISOString();
  const incoming = decodeFields(listing);
  seenThisRun.add(incoming.url);

  const index = store.listings.findIndex((l) => l.url === incoming.url);

  if (index === -1) {
    store.listings.push({
      ...incoming,
      first_seen_at: stamp,
      last_scraped: stamp,
      updated_at: stamp,
      is_discounted: false,
      original_price: null,
      price_history: [{ date: stamp, price: incoming.price, price_per_m2: incoming.price_per_m2 }]
    });
    return 'created';
  }

  const existing = store.listings[index];
  const priceChanged = Number(existing.price) !== Number(incoming.price);
  const cheaper = priceChanged && Number(incoming.price) < Number(existing.price);

  const merged = {
    ...existing,
    ...incoming,
    first_seen_at: existing.first_seen_at,
    last_scraped: stamp,
    updated_at: priceChanged ? stamp : existing.updated_at,
    is_discounted: cheaper ? true : Boolean(existing.is_discounted),
    original_price: cheaper && !existing.original_price ? existing.price : existing.original_price,
    price_history: existing.price_history || []
  };

  if (priceChanged) {
    merged.price_history = [
      ...merged.price_history,
      { date: stamp, price: incoming.price, price_per_m2: incoming.price_per_m2 }
    ];
  }

  store.listings[index] = merged;
  return priceChanged ? 'updated' : 'unchanged';
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function medianRow(rows, extra) {
  const perM2 = rows.map((r) => Number(r.price_per_m2)).filter(Number.isFinite);
  if (perM2.length === 0) return null;
  return {
    ...extra,
    median_price_per_m2: median(perM2),
    median_price: median(rows.map((r) => Number(r.price)).filter(Number.isFinite)),
    sample_size: perM2.length
  };
}

/**
 * Denní snímek mediánů — stejná data, jaká v databázové větvi počítá
 * `jobs/snapshot.js`. Dnešní datum se přepisuje, aby opakovaný běh
 * v jednom dni nezaložil dva záznamy.
 */
export function writeJsonSnapshot(date = new Date()) {
  const store = load();
  const snapshotDate = date.toISOString().slice(0, 10);
  const doc = readJson(snapshotsFile(), null);
  const previous = Array.isArray(doc?.snapshots) ? doc.snapshots : [];

  const rows = [];
  for (const city of ['praha', 'brno']) {
    for (const listingType of ['byt', 'novostavba']) {
      const subset = store.listings.filter(
        (l) => l.city === city && l.listing_type === listingType && l.price_per_m2
      );
      if (subset.length === 0) continue;

      const cityWide = medianRow(subset, { city, district: null, listing_type: listingType });
      if (cityWide) rows.push({ ...cityWide, snapshot_date: snapshotDate });

      const districts = [...new Set(subset.map((l) => l.district).filter(Boolean))];
      for (const district of districts) {
        const row = medianRow(
          subset.filter((l) => l.district === district),
          { city, district, listing_type: listingType }
        );
        if (row) rows.push({ ...row, snapshot_date: snapshotDate });
      }
    }
  }

  if (rows.length === 0) {
    console.warn('  přeskakuji snímek trhu — žádná data s cenou za m²');
    return 0;
  }

  const kept = previous.filter((s) => s.snapshot_date !== snapshotDate);
  writeJson(snapshotsFile(), {
    updated_at: date.toISOString(),
    snapshots: [...kept, ...rows].sort(
      (a, b) =>
        a.snapshot_date.localeCompare(b.snapshot_date) ||
        a.city.localeCompare(b.city) ||
        String(a.district).localeCompare(String(b.district))
    )
  });

  console.log(`✓ Snímek trhu ${snapshotDate}: ${rows.length} záznamů`);
  return rows.length;
}

/**
 * Zapíše dataset na disk. Inzeráty se řadí podle URL, aby byl denní
 * commit čitelný diff — bez toho by se pořadí míchalo podle toho,
 * v jakém pořadí zrovna zdroj odpověděl.
 */
export function flushJsonSink(now = new Date()) {
  const store = load();

  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString();
  const before = store.listings.length;
  const alive = store.listings.filter(
    (l) => seenThisRun.has(l.url) || !l.last_scraped || l.last_scraped >= cutoff
  );
  const dropped = before - alive.length;

  alive.sort((a, b) => a.url.localeCompare(b.url));

  writeJson(listingsFile(), {
    updated_at: now.toISOString(),
    count: alive.length,
    listings: alive
  });

  cache = { updated_at: now.toISOString(), count: alive.length, listings: alive };

  console.log(
    `✓ ${listingsFile()}: ${alive.length} inzerátů` +
      (dropped ? ` (${dropped} vypadlo, nevidět déle než ${KEEP_DAYS} dní)` : '')
  );
  return alive.length;
}

/** Jen pro testy — vyčistí stav mezi případy. */
export function __resetJsonSink() {
  cache = null;
  seenThisRun.clear();
}
