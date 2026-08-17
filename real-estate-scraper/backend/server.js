import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import db from './db/index.js';
import { applyFilters, applySort, AMENITIES } from './lib/filters.js';
import { enrichListing, MIN_COMPARABLE_SAMPLE } from './lib/pricing.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

/* ------------------------------------------------------------------ */
/* Pomocné dotazy                                                      */
/* ------------------------------------------------------------------ */

/**
 * Mediány ceny za m² ve třech úrovních podrobnosti.
 *
 * Nejpřesnější srovnání je "stejná čtvrť, stejná dispozice", takových
 * nemovitostí je ale často jen pár. Proto se počítají i hrubší úrovně
 * a pro každý inzerát se vybere nejpodrobnější, která má dost vzorků.
 */
async function comparableMedians(city, listingType) {
  const base = () => {
    let q = db('listings').where('city', city).whereNotNull('price_per_m2');
    if (listingType) q = q.where('listing_type', listingType);
    return q;
  };

  const median = db.raw(
    'PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_per_m2) as median_price_per_m2'
  );
  const sample = db.raw('COUNT(*)::int as sample_size');

  const [byDistrictDisposition, byDistrict, byDisposition, cityWide] = await Promise.all([
    base().groupBy('district', 'disposition').select('district', 'disposition', median, sample),
    base().groupBy('district').select('district', median, sample),
    base().groupBy('disposition').select('disposition', median, sample),
    base().select(median, sample).first()
  ]);

  const index = (rows, keyFn) => {
    const map = new Map();
    for (const row of rows) map.set(keyFn(row), row);
    return map;
  };

  return {
    districtDisposition: index(byDistrictDisposition, (r) => `${r.district}|${r.disposition}`),
    district: index(byDistrict, (r) => r.district),
    disposition: index(byDisposition, (r) => r.disposition),
    cityWide
  };
}

const CITY_LABELS = { praha: 'Praha', brno: 'Brno' };

/**
 * Vybere nejpodrobnější srovnávací skupinu, která má aspoň
 * MIN_COMPARABLE_SAMPLE nemovitostí. Vrácený `basis` se ukazuje
 * uživateli, aby věděl, vůči čemu se cena poměřuje.
 */
function pickComparable(medians, listing, city) {
  const cityLabel = CITY_LABELS[city] || city;
  const candidates = [
    {
      row: medians.districtDisposition.get(`${listing.district}|${listing.disposition}`),
      basis: `${listing.disposition} v lokalitě ${listing.district}`
    },
    {
      row: medians.district.get(listing.district),
      basis: `nemovitosti v lokalitě ${listing.district}`
    },
    {
      row: medians.disposition.get(listing.disposition),
      basis: `${listing.disposition} — ${cityLabel}`
    },
    { row: medians.cityWide, basis: `celý trh — ${cityLabel}` }
  ];

  for (const candidate of candidates) {
    if (candidate.row && Number(candidate.row.sample_size) >= MIN_COMPARABLE_SAMPLE) {
      return { ...candidate.row, basis: candidate.basis };
    }
  }
  return {};
}

/** Referenční nájmy Kč/m²/měsíc podle čtvrti, s fallbackem na město. */
async function rentBenchmarks(city) {
  const rows = await db('rent_benchmarks').where('city', city);
  const byDistrict = new Map();
  let cityWide = null;
  for (const row of rows) {
    if (row.district) byDistrict.set(row.district, Number(row.rent_per_m2_month));
    else cityWide = Number(row.rent_per_m2_month);
  }
  return { byDistrict, cityWide };
}

/** Obohatí seznam inzerátů o rating, výnos a stáří. */
async function enrichAll(listings, city, listingType) {
  const [medians, rents] = await Promise.all([
    comparableMedians(city, listingType),
    rentBenchmarks(city)
  ]);

  return listings.map((listing) => {
    const comparable = pickComparable(medians, listing, city);
    const rent = rents.byDistrict.get(listing.district) ?? rents.cityWide ?? null;
    return enrichListing(listing, comparable, rent);
  });
}

/** Histogram pro slider — počty v `buckets` stejně širokých intervalech. */
function histogram(values, buckets = 40) {
  const nums = values.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length === 0) return { min: 0, max: 0, bins: [] };

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (min === max) return { min, max, bins: [nums.length] };

  const width = (max - min) / buckets;
  const bins = new Array(buckets).fill(0);
  for (const n of nums) {
    const idx = Math.min(buckets - 1, Math.floor((n - min) / width));
    bins[idx] += 1;
  }
  return { min, max, bins };
}

function handleError(res, err) {
  console.error(err);
  res.status(500).json({ error: err.message });
}

/* ------------------------------------------------------------------ */
/* Endpointy                                                           */
/* ------------------------------------------------------------------ */

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

/** Seznam nemovitostí — všechny filtry, řazení, stránkování. */
app.get('/api/listings', async (req, res) => {
  try {
    const city = req.query.city || 'praha';
    const listingType = req.query.listingType || null;
    const limit = Math.min(Number(req.query.limit) || 48, 200);
    const offset = Number(req.query.offset) || 0;

    const [{ count }] = await applyFilters(db('listings'), req.query).count('* as count');

    const rows = await applySort(
      applyFilters(db('listings'), req.query),
      req.query.sortBy
    )
      .limit(limit)
      .offset(offset);

    const listings = await enrichAll(rows, city, listingType);

    res.json({ total: Number(count), limit, offset, listings });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * Facety pro sidebar — počty u každé volby filtru a histogramy pro slidery.
 * Počty se počítají nad aktuálně zafiltrovanou množinou (bez vlastní facety),
 * aby uživatel viděl kolik výsledků každá volba přinese.
 */
app.get('/api/facets', async (req, res) => {
  try {
    const city = req.query.city || 'praha';
    const listingType = req.query.listingType || null;

    const base = () => {
      let q = db('listings').where('city', city);
      if (listingType) q = q.where('listing_type', listingType);
      return q;
    };

    const countBy = async (column) => {
      const rows = await base()
        .whereNotNull(column)
        .groupBy(column)
        .select(column, db.raw('COUNT(*)::int as count'))
        .orderBy('count', 'desc');
      return rows.map((r) => ({ value: r[column], count: r.count }));
    };

    const amenityCounts = async () => {
      const out = {};
      await Promise.all(
        AMENITIES.map(async (item) => {
          const [{ count }] = await base()
            .whereRaw('amenities @> ?::jsonb', [JSON.stringify([item])])
            .count('* as count');
          out[item] = Number(count);
        })
      );
      return out;
    };

    const [
      dispositions,
      buildingTypes,
      conditions,
      districts,
      sources,
      completionYears,
      amenities,
      ranges,
      flags
    ] = await Promise.all([
      countBy('disposition'),
      countBy('building_type'),
      countBy('condition'),
      countBy('district'),
      countBy('source_name'),
      countBy('completion_year'),
      amenityCounts(),
      base().select('price', 'size_m2', 'price_per_m2'),
      base()
        .select(
          db.raw('COUNT(*) FILTER (WHERE is_tenement)::int as tenement'),
          db.raw('COUNT(*) FILTER (WHERE is_discounted)::int as discounted'),
          db.raw('COUNT(*)::int as total')
        )
        .first()
    ]);

    res.json({
      dispositions,
      buildingTypes,
      conditions,
      districts,
      sources,
      completionYears: completionYears.sort((a, b) => a.value - b.value),
      amenities,
      priceHistogram: histogram(ranges.map((r) => r.price)),
      sizeHistogram: histogram(ranges.map((r) => r.size_m2)),
      pricePerM2Histogram: histogram(ranges.map((r) => r.price_per_m2)),
      tenementCount: flags?.tenement ?? 0,
      discountedCount: flags?.discounted ?? 0,
      total: flags?.total ?? 0
    });
  } catch (err) {
    handleError(res, err);
  }
});

/** Souhrn nad městem — mediány, které se ukazují v hlavičce vyhledávání. */
app.get('/api/stats/:city/medians', async (req, res) => {
  try {
    const { city } = req.params;
    let q = db('listings').where('city', city).whereNotNull('price_per_m2');
    if (req.query.listingType) q = q.where('listing_type', req.query.listingType);

    const stats = await q
      .select(
        db.raw('PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price) as median_price'),
        db.raw('PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_per_m2) as median_price_per_m2'),
        db.raw('MIN(price) as min_price'),
        db.raw('MIN(price_per_m2) as min_price_per_m2'),
        db.raw('AVG(size_m2) as avg_size_m2'),
        db.raw('COUNT(*)::int as total_listings')
      )
      .first();

    res.json(stats || {});
  } catch (err) {
    handleError(res, err);
  }
});

/** Vývoj cen v čase — časová řada ze snapshotů (sidebar "Vývoj cen"). */
app.get('/api/stats/:city/trend', async (req, res) => {
  try {
    const { city } = req.params;
    const { district, listingType = 'byt' } = req.query;

    let q = db('market_snapshots')
      .where('city', city)
      .where('listing_type', listingType)
      .orderBy('snapshot_date', 'asc')
      .select('snapshot_date as date', 'median_price_per_m2', 'median_price', 'sample_size');

    q = district ? q.where('district', district) : q.whereNull('district');

    const series = await q;

    // Celková změna od prvního po poslední bod řady.
    let changePct = null;
    if (series.length > 1) {
      const first = Number(series[0].median_price_per_m2);
      const last = Number(series[series.length - 1].median_price_per_m2);
      if (first > 0) changePct = Number((((last - first) / first) * 100).toFixed(1));
    }

    res.json({
      city,
      district: district || null,
      current: series.length ? Number(series[series.length - 1].median_price_per_m2) : null,
      changePct,
      series
    });
  } catch (err) {
    handleError(res, err);
  }
});

/** Body pro mapu — stejné filtry jako seznam, jen s omezenými sloupci. */
app.get('/api/map/:city', async (req, res) => {
  try {
    const city = req.params.city;
    const query = { ...req.query, city };

    const rows = await applyFilters(db('listings'), query)
      .whereNotNull('latitude')
      .whereNotNull('longitude')
      .select(
        'id', 'title', 'price', 'price_per_m2', 'size_m2', 'disposition',
        'latitude', 'longitude', 'address', 'district', 'first_seen_at'
      )
      .limit(500);

    res.json(await enrichAll(rows, city, req.query.listingType || null));
  } catch (err) {
    handleError(res, err);
  }
});

/** Detail nemovitosti — včetně historie ceny a srovnání s trhem. */
app.get('/api/listings/:id', async (req, res) => {
  try {
    const listing = await db('listings').where('id', req.params.id).first();
    if (!listing) return res.status(404).json({ error: 'Not found' });

    const priceHistory = await db('price_history')
      .where('listing_id', listing.id)
      .orderBy('recorded_at', 'asc')
      .select('recorded_at as date', 'price', 'price_per_m2');

    const [enriched] = await enrichAll([listing], listing.city, listing.listing_type);

    res.json({ ...enriched, priceHistory });
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/api/listings/:id/price-trend', async (req, res) => {
  try {
    const history = await db('price_history')
      .where('listing_id', req.params.id)
      .orderBy('recorded_at', 'asc')
      .select('recorded_at as date', 'price', 'price_per_m2');
    res.json(history);
  } catch (err) {
    handleError(res, err);
  }
});

/* ------------------------------------------------------------------ */
/* Kalkulačka                                                          */
/* ------------------------------------------------------------------ */

/** Anuitní splátka hypotéky: M = P·r(1+r)^n / ((1+r)^n − 1) */
function monthlyPayment(principal, annualRatePct, years) {
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return (principal * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1);
}

app.post('/api/calculator/mortgage', (req, res) => {
  const { propertyPrice, downPayment = 0, interestRate = 4.9, loanTerm = 30 } = req.body;

  if (!propertyPrice || propertyPrice <= 0) {
    return res.status(400).json({ error: 'propertyPrice je povinná a musí být kladná' });
  }
  if (downPayment < 0 || downPayment >= propertyPrice) {
    return res.status(400).json({ error: 'downPayment musí být mezi 0 a cenou nemovitosti' });
  }

  const principal = propertyPrice - downPayment;
  const payment = monthlyPayment(principal, interestRate, loanTerm);
  const totalPaid = payment * loanTerm * 12;

  res.json({
    principal: Math.round(principal),
    monthlyPayment: Math.round(payment),
    totalPayment: Math.round(totalPaid),
    totalInterest: Math.round(totalPaid - principal),
    downPaymentPercent: Number(((downPayment / propertyPrice) * 100).toFixed(1)),
    // ČNB limit: LTV nad 80 % banky běžně neschválí
    ltv: Number(((principal / propertyPrice) * 100).toFixed(1)),
    ltvWarning: principal / propertyPrice > 0.8
  });
});

app.post('/api/calculator/affordability', (req, res) => {
  const {
    monthlyIncome,
    propertyPrice,
    downPayment = 0,
    interestRate = 4.9,
    loanTerm = 30,
    monthlyDebts = 0
  } = req.body;

  if (!monthlyIncome || monthlyIncome <= 0) {
    return res.status(400).json({ error: 'monthlyIncome je povinný a musí být kladný' });
  }
  if (!propertyPrice || propertyPrice <= 0) {
    return res.status(400).json({ error: 'propertyPrice je povinná a musí být kladná' });
  }

  const principal = Math.max(0, propertyPrice - downPayment);
  const payment = monthlyPayment(principal, interestRate, loanTerm);

  // DSTI = podíl všech splátek na čistém měsíčním příjmu.
  const dsti = ((payment + monthlyDebts) / monthlyIncome) * 100;
  const affordable = dsti <= 45; // orientační hranice bank

  // Kolik let čistého příjmu stojí nemovitost.
  const yearsOfIncome = Number((propertyPrice / (monthlyIncome * 12)).toFixed(1));

  res.json({
    monthlyPayment: Math.round(payment),
    dsti: Number(dsti.toFixed(1)),
    affordable,
    yearsOfIncome,
    recommendation: affordable
      ? 'Splátka se vejde do běžného limitu bank (DSTI do 45 %).'
      : 'Splátka překračuje běžný limit bank (DSTI nad 45 %). Zvyš vlastní zdroje nebo hledej levnější nemovitost.'
  });
});

/* ------------------------------------------------------------------ */

const server = app.listen(PORT, async () => {
  try {
    await db.raw('SELECT 1');
    console.log(`✓ API na http://localhost:${PORT}`);
    console.log('✓ Databáze připojena');
  } catch (err) {
    console.error('✗ Databáze nedostupná:', err.message);
    process.exit(1);
  }
});

export { app, server };
