/**
 * Překlad query parametrů z frontendu na Knex where-clauses.
 * Sdílí ho /api/listings, /api/facets i /api/map, aby mapa a seznam
 * vždy ukazovaly stejnou množinu nemovitostí.
 */

export const AMENITIES = ['balkon', 'terasa', 'lodzie', 'sklep', 'vytah', 'garaz', 'parkovani'];
export const DISPOSITIONS = [
  '1+kk', '1+1', '2+kk', '2+1', '3+kk', '3+1',
  '4+kk', '4+1', '5+kk', '5+1', '6+kk', '6+1', 'atypicky'
];
export const BUILDING_TYPES = ['cihlova', 'panelova', 'smisena'];
export const CONDITIONS = ['dobry', 'k_rekonstrukci', 'novostavba'];

/** Rozdělí "3+kk,2+1" nebo ["3+kk"] na pole. Prázdné → null. */
function asList(value) {
  if (value == null || value === '') return null;
  const list = Array.isArray(value) ? value : String(value).split(',');
  const cleaned = list.map((v) => String(v).trim()).filter(Boolean);
  return cleaned.length ? cleaned : null;
}

function asBool(value) {
  return value === true || value === 'true' || value === '1';
}

/**
 * Aplikuje všechny filtry na Knex query builder.
 * @param {import('knex').Knex.QueryBuilder} query
 * @param {object} q  req.query
 */
export function applyFilters(query, q = {}) {
  const {
    city = 'praha',
    listingType,
    minPrice, maxPrice,
    minPricePerM2, maxPricePerM2,
    minSize, maxSize,
    dispositions,
    buildingTypes,
    conditions,
    amenities,
    completionYears,
    districts,
    sources,
    tenementOnly,
    discountedOnly
  } = q;

  query = query.where('city', city);

  if (listingType) query = query.where('listing_type', listingType);

  if (minPrice) query = query.where('price', '>=', Number(minPrice));
  if (maxPrice) query = query.where('price', '<=', Number(maxPrice));
  if (minPricePerM2) query = query.where('price_per_m2', '>=', Number(minPricePerM2));
  if (maxPricePerM2) query = query.where('price_per_m2', '<=', Number(maxPricePerM2));
  if (minSize) query = query.where('size_m2', '>=', Number(minSize));
  if (maxSize) query = query.where('size_m2', '<=', Number(maxSize));

  const disp = asList(dispositions);
  if (disp) query = query.whereIn('disposition', disp);

  const bt = asList(buildingTypes);
  if (bt) query = query.whereIn('building_type', bt);

  const cond = asList(conditions);
  if (cond) query = query.whereIn('condition', cond);

  const years = asList(completionYears);
  if (years) query = query.whereIn('completion_year', years.map(Number));

  const dist = asList(districts);
  if (dist) query = query.whereIn('district', dist);

  const src = asList(sources);
  if (src) query = query.whereIn('source_name', src);

  // Vybavenost: nemovitost musí mít VŠECHNY zaškrtnuté položky (AND).
  const am = asList(amenities);
  if (am) {
    for (const item of am) {
      if (!AMENITIES.includes(item)) continue;
      query = query.whereRaw('amenities @> ?::jsonb', [JSON.stringify([item])]);
    }
  }

  if (asBool(tenementOnly)) query = query.where('is_tenement', true);
  if (asBool(discountedOnly)) query = query.where('is_discounted', true);

  return query;
}

/** Povolené sloupce pro řazení — chrání před SQL injection přes ?sortBy=. */
const SORT_COLUMNS = {
  newest: ['first_seen_at', 'desc'],
  oldest: ['first_seen_at', 'asc'],
  price_asc: ['price', 'asc'],
  price_desc: ['price', 'desc'],
  price_m2_asc: ['price_per_m2', 'asc'],
  price_m2_desc: ['price_per_m2', 'desc'],
  size_asc: ['size_m2', 'asc'],
  size_desc: ['size_m2', 'desc']
};

export function applySort(query, sortBy = 'newest') {
  const [column, direction] = SORT_COLUMNS[sortBy] || SORT_COLUMNS.newest;
  return query.orderBy(column, direction).orderBy('id', 'desc');
}

export const SORT_OPTIONS = Object.keys(SORT_COLUMNS);
