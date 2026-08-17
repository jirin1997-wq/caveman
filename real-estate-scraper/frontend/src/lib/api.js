import axios from 'axios';

/**
 * Vite v devu proxuje /api na backend (vite.config.js), v produkci
 * se použije VITE_API_URL. Díky tomu nikde v kódu není hardcoded localhost.
 */
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 15000
});

/**
 * Převede stav filtrů na query parametry pro backend.
 * Pole se posílají jako čárkou oddělený seznam, rozsahy jako min/max.
 */
export function filtersToParams(filters, extra = {}) {
  const params = { ...extra };

  const lists = [
    'dispositions', 'buildingTypes', 'conditions',
    'amenities', 'completionYears', 'districts', 'sources'
  ];
  for (const key of lists) {
    const value = filters[key];
    if (value?.length) params[key] = value.join(',');
  }

  // Rozsah se posílá jen když ho uživatel skutečně zúžil — jinak by
  // zaokrouhlené hranice histogramu odřízly krajní nemovitosti.
  const addRange = (rangeKey, boundsKey, minParam, maxParam) => {
    const range = filters[rangeKey];
    const bounds = filters[boundsKey];
    if (!range || !bounds) return;
    if (range[0] > bounds[0]) params[minParam] = range[0];
    if (range[1] < bounds[1]) params[maxParam] = range[1];
  };

  addRange('priceRange', 'priceBounds', 'minPrice', 'maxPrice');
  addRange('pricePerM2Range', 'pricePerM2Bounds', 'minPricePerM2', 'maxPricePerM2');
  addRange('sizeRange', 'sizeBounds', 'minSize', 'maxSize');

  if (filters.tenementOnly) params.tenementOnly = 'true';
  if (filters.discountedOnly) params.discountedOnly = 'true';

  return params;
}
