/**
 * Demo data pro vývoj a prohlídku UI bez čekání na scraper.
 * Čísla jsou řádově realistická (Praha/Brno), ale VYMYŠLENÁ —
 * na produkci je nahradí scrapovaná data. Nikdy neprezentovat jako reálný trh.
 */

const PRAHA_DISTRICTS = [
  { district: 'Praha 1', neighborhoods: ['Staré Město', 'Malá Strana'], basePricePerM2: 240000, lat: 50.0875, lng: 14.4213 },
  { district: 'Praha 2', neighborhoods: ['Vinohrady', 'Nusle'], basePricePerM2: 195000, lat: 50.0755, lng: 14.4378 },
  { district: 'Praha 3', neighborhoods: ['Žižkov', 'Vinohrady'], basePricePerM2: 165000, lat: 50.0870, lng: 14.4600 },
  { district: 'Praha 5', neighborhoods: ['Smíchov', 'Košíře'], basePricePerM2: 158000, lat: 50.0700, lng: 14.4000 },
  { district: 'Praha 6', neighborhoods: ['Dejvice', 'Břevnov'], basePricePerM2: 172000, lat: 50.1000, lng: 14.3900 },
  { district: 'Praha 8', neighborhoods: ['Karlín', 'Libeň'], basePricePerM2: 152000, lat: 50.1050, lng: 14.4600 },
  { district: 'Praha 9', neighborhoods: ['Vysočany', 'Prosek'], basePricePerM2: 132000, lat: 50.1100, lng: 14.5000 },
  { district: 'Praha 10', neighborhoods: ['Vršovice', 'Strašnice', 'Malešice'], basePricePerM2: 145000, lat: 50.0700, lng: 14.4700 }
];

const BRNO_DISTRICTS = [
  { district: 'Brno-střed', neighborhoods: ['Veveří', 'Staré Brno'], basePricePerM2: 128000, lat: 49.1922, lng: 16.6113 },
  { district: 'Brno-Královo Pole', neighborhoods: ['Královo Pole'], basePricePerM2: 112000, lat: 49.2250, lng: 16.5900 },
  { district: 'Brno-Žabovřesky', neighborhoods: ['Žabovřesky'], basePricePerM2: 108000, lat: 49.2100, lng: 16.5700 },
  { district: 'Brno-sever', neighborhoods: ['Lesná', 'Husovice'], basePricePerM2: 98000, lat: 49.2200, lng: 16.6200 },
  { district: 'Brno-Líšeň', neighborhoods: ['Líšeň'], basePricePerM2: 89000, lat: 49.2050, lng: 16.6800 }
];

const DISPOSITIONS = [
  { code: '1+kk', minSize: 22, maxSize: 38 },
  { code: '1+1', minSize: 30, maxSize: 45 },
  { code: '2+kk', minSize: 38, maxSize: 60 },
  { code: '2+1', minSize: 45, maxSize: 70 },
  { code: '3+kk', minSize: 60, maxSize: 90 },
  { code: '3+1', minSize: 65, maxSize: 95 },
  { code: '4+kk', minSize: 85, maxSize: 130 },
  { code: '4+1', minSize: 90, maxSize: 140 },
  { code: '5+kk', minSize: 120, maxSize: 200 }
];

const SOURCES = {
  byt: ['Lexxus Norton', 'Sreality', 'iDNES Reality', 'Bezrealitky'],
  novostavba: ['NovéProjekty', 'Trigema', 'Central Group', 'Ekospol']
};

const PROJECT_NAMES = [
  'Rezidence Escape', 'ZigZag Haus', 'Rock House', 'NEAR living', 'Perla Limuzská',
  'Zelené Vršovice', 'Nová Harfa', 'Park Hloubětín', 'Vila Kavčí Hory', 'Byty Kaskády'
];

const STREETS = [
  'Varšavská', 'Vlašimská', 'Murmanská', 'Polabská', 'U tvrze', 'Bělohorská',
  'Korunní', 'Slezská', 'Sokolovská', 'Křižíkova', 'Veveří', 'Údolní', 'Cejl'
];

/** Deterministický pseudonáhodný generátor — seed dá pokaždé stejná data. */
function makeRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const rnd = makeRandom(42);

const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (min, max) => min + rnd() * (max - min);
const chance = (p) => rnd() < p;

function buildAmenities(listingType) {
  const all = ['balkon', 'terasa', 'lodzie', 'sklep', 'vytah', 'garaz', 'parkovani'];
  // Novostavby mají vybavenost častěji než starší byty.
  const probability = listingType === 'novostavba' ? 0.45 : 0.28;
  const chosen = all.filter(() => chance(probability));
  return chosen.length ? chosen : ['sklep'];
}

function generateListings(city, districts, count, listingType) {
  const rows = [];

  for (let i = 0; i < count; i += 1) {
    const loc = pick(districts);
    const disp = pick(DISPOSITIONS);
    const neighborhood = pick(loc.neighborhoods);
    const size = Math.round(between(disp.minSize, disp.maxSize));

    // Cena za m² kolísá ±22 % kolem základu čtvrti; novostavby s příplatkem.
    const newBuildPremium = listingType === 'novostavba' ? 1.12 : 1;
    const pricePerM2 = Math.round(loc.basePricePerM2 * between(0.78, 1.22) * newBuildPremium);
    const price = Math.round((pricePerM2 * size) / 10000) * 10000;

    const daysAgo = Math.floor(between(0, 180));
    const firstSeen = new Date(Date.now() - daysAgo * 86400000);

    const discounted = chance(0.18);
    const buildingType =
      listingType === 'novostavba' ? 'cihlova' : pick(['cihlova', 'panelova', 'smisena']);
    const condition =
      listingType === 'novostavba' ? 'novostavba' : (chance(0.22) ? 'k_rekonstrukci' : 'dobry');

    const title =
      listingType === 'novostavba'
        ? `${pick(PROJECT_NAMES)} — ${disp.code}`
        : `${disp.code}, ${size} m²`;

    const street = pick(STREETS);

    rows.push({
      url: `https://example.invalid/${city}/${listingType}/${i}-${Date.now()}`,
      source: listingType === 'novostavba' ? 'developer' : 'sreality',
      source_name: pick(SOURCES[listingType]),
      listing_type: listingType,
      title,
      price,
      price_per_m2: pricePerM2,
      size_m2: size,
      rooms: parseInt(disp.code, 10) || null,
      disposition: disp.code,
      address: `${street}, ${neighborhood}, ${loc.district}`,
      district: loc.district,
      neighborhood,
      city,
      latitude: Number((loc.lat + between(-0.012, 0.012)).toFixed(6)),
      longitude: Number((loc.lng + between(-0.018, 0.018)).toFixed(6)),
      building_type: buildingType,
      condition,
      is_tenement: listingType === 'byt' && chance(0.15),
      amenities: JSON.stringify(buildAmenities(listingType)),
      completion_year: listingType === 'novostavba' ? 2026 + Math.floor(between(0, 4)) : null,
      is_discounted: discounted,
      original_price: discounted ? Math.round(price * between(1.05, 1.18)) : null,
      description: `${disp.code} o ploše ${size} m² v lokalitě ${neighborhood}, ${loc.district}.`,
      photos: JSON.stringify([]),
      first_seen_at: firstSeen,
      created_at: firstSeen,
      updated_at: new Date(),
      last_scraped: new Date()
    });
  }

  return rows;
}

/** Snapshoty za posledních 24 měsíců — podklad pro graf vývoje cen. */
function generateSnapshots(city, districts) {
  const rows = [];
  const months = 24;

  for (const listingType of ['byt', 'novostavba']) {
    const cityBase =
      districts.reduce((sum, d) => sum + d.basePricePerM2, 0) / districts.length;

    for (let m = months; m >= 0; m -= 1) {
      const date = new Date();
      date.setMonth(date.getMonth() - m);
      date.setDate(1);

      // Zhruba +6 % ročně s drobným kolísáním.
      const growth = Math.pow(1.06, (months - m) / 12);
      const noise = between(0.985, 1.015);
      const premium = listingType === 'novostavba' ? 1.12 : 1;
      const medianPerM2 = Math.round(cityBase * growth * noise * premium);

      rows.push({
        city,
        district: null,
        listing_type: listingType,
        median_price_per_m2: medianPerM2,
        median_price: medianPerM2 * 68, // typická plocha ~68 m²
        sample_size: Math.floor(between(200, 600)),
        snapshot_date: date.toISOString().slice(0, 10)
      });
    }
  }

  return rows;
}

export async function seed(knex) {
  await knex('price_history').del();
  await knex('market_snapshots').del();
  await knex('rent_benchmarks').del();
  await knex('listings').del();

  const listings = [
    ...generateListings('praha', PRAHA_DISTRICTS, 220, 'byt'),
    ...generateListings('praha', PRAHA_DISTRICTS, 90, 'novostavba'),
    ...generateListings('brno', BRNO_DISTRICTS, 120, 'byt'),
    ...generateListings('brno', BRNO_DISTRICTS, 45, 'novostavba')
  ];

  const inserted = await knex('listings').insert(listings).returning(['id', 'price', 'price_per_m2', 'first_seen_at', 'is_discounted', 'original_price']);

  // Historie ceny: založení inzerátu + případné zlevnění.
  const history = [];
  for (const row of inserted) {
    if (row.is_discounted && row.original_price) {
      history.push({
        listing_id: row.id,
        price: row.original_price,
        price_per_m2: Math.round(Number(row.price_per_m2) * (Number(row.original_price) / Number(row.price))),
        recorded_at: row.first_seen_at
      });
    }
    history.push({
      listing_id: row.id,
      price: row.price,
      price_per_m2: row.price_per_m2,
      recorded_at: new Date()
    });
  }
  await knex('price_history').insert(history);

  // Referenční nájmy Kč/m²/měsíc.
  await knex('rent_benchmarks').insert([
    { city: 'praha', district: null, rent_per_m2_month: 380 },
    ...PRAHA_DISTRICTS.map((d) => ({
      city: 'praha',
      district: d.district,
      rent_per_m2_month: Math.round(d.basePricePerM2 / 430)
    })),
    { city: 'brno', district: null, rent_per_m2_month: 320 },
    ...BRNO_DISTRICTS.map((d) => ({
      city: 'brno',
      district: d.district,
      rent_per_m2_month: Math.round(d.basePricePerM2 / 400)
    }))
  ]);

  await knex('market_snapshots').insert([
    ...generateSnapshots('praha', PRAHA_DISTRICTS),
    ...generateSnapshots('brno', BRNO_DISTRICTS)
  ]);

  console.log(`✓ Seed: ${listings.length} nemovitostí, ${history.length} cenových záznamů`);
}
