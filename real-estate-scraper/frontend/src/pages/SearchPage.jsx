import { useState, useEffect, useCallback, useMemo } from 'react';
import FilterSidebar from '../components/FilterSidebar';
import ListingCard from '../components/ListingCard';
import MapComponent from '../components/MapComponent';
import { api, filtersToParams } from '../lib/api';
import { formatCzk, formatPerM2 } from '../lib/format';

const SORT_OPTIONS = [
  { value: 'newest', label: 'Nejnovější' },
  { value: 'price_asc', label: 'Nejlevnější' },
  { value: 'price_desc', label: 'Nejdražší' },
  { value: 'price_m2_asc', label: 'Nejnižší cena za m²' },
  { value: 'size_desc', label: 'Největší plocha' }
];

const PAGE_SIZE = 24;

const VIEWS = [
  { key: 'grid', label: 'Dlaždice' },
  { key: 'list', label: 'Seznam' },
  { key: 'map', label: 'Mapa' }
];

/** Ikony přepínače zobrazení — inline SVG, aby vypadaly stejně všude. */
function ViewIcon({ name }) {
  const props = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true
  };

  if (name === 'grid') {
    return (
      <svg {...props}>
        <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
        <rect x="9.5" y="1.5" width="5" height="5" rx="1" />
        <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
        <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      </svg>
    );
  }

  if (name === 'list') {
    return (
      <svg {...props}>
        <path d="M2 4h12M2 8h12M2 12h12" />
      </svg>
    );
  }

  return (
    <svg {...props}>
      <path d="M1.5 3.5 5.5 2l5 2 4-1.5v10L10.5 14l-5-2-4 1.5z" />
      <path d="M5.5 2v10M10.5 4v10" />
    </svg>
  );
}

const EMPTY_FILTERS = {
  dispositions: [],
  buildingTypes: [],
  conditions: [],
  amenities: [],
  completionYears: [],
  districts: [],
  sources: [],
  tenementOnly: false,
  discountedOnly: false
};

export default function SearchPage() {
  const [city, setCity] = useState('praha');
  const [listingType, setListingType] = useState('byt');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [facets, setFacets] = useState(null);
  const [medians, setMedians] = useState(null);

  const [listings, setListings] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [view, setView] = useState('grid'); // grid | list | map
  const [sortBy, setSortBy] = useState('newest');

  /* Facety a mediány se načítají při změně města nebo typu nabídky.
     Rozsahy sliderů se přitom resetují na plný rozsah trhu. */
  useEffect(() => {
    let cancelled = false;
    setFacets(null);

    Promise.all([
      api.get('/facets', { params: { city, listingType } }),
      api.get(`/stats/${city}/medians`, { params: { listingType } })
    ])
      .then(([facetsRes, mediansRes]) => {
        if (cancelled) return;
        const data = facetsRes.data;
        setFacets(data);
        setMedians(mediansRes.data);

        const priceBounds = [Math.floor(data.priceHistogram.min), Math.ceil(data.priceHistogram.max)];
        const sizeBounds = [Math.floor(data.sizeHistogram.min), Math.ceil(data.sizeHistogram.max)];
        const m2Bounds = [
          Math.floor(data.pricePerM2Histogram.min),
          Math.ceil(data.pricePerM2Histogram.max)
        ];

        setFilters({
          ...EMPTY_FILTERS,
          priceRange: priceBounds,
          priceBounds,
          sizeRange: sizeBounds,
          sizeBounds,
          pricePerM2Range: m2Bounds,
          pricePerM2Bounds: m2Bounds
        });
        setPage(0);
      })
      .catch((err) => !cancelled && setError(err.message));

    return () => {
      cancelled = true;
    };
  }, [city, listingType]);

  const params = useMemo(
    () => filtersToParams(filters, { city, listingType, sortBy }),
    [filters, city, listingType, sortBy]
  );

  const fetchListings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/listings', {
        params: { ...params, limit: PAGE_SIZE, offset: page * PAGE_SIZE }
      });
      setListings(res.data.listings);
      setTotal(res.data.total);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [params, page]);

  // Filtry se aplikují se zpožděním, aby tažení sliderem nespamovalo API.
  useEffect(() => {
    const timer = setTimeout(fetchListings, 250);
    return () => clearTimeout(timer);
  }, [fetchListings]);

  const handleFilterChange = (next) => {
    setFilters(next);
    setPage(0);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      {/* Horní lišta s přehledem trhu */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 rounded-xl">
            <span aria-hidden="true">📍</span>
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="bg-transparent font-semibold text-slate-900 focus:outline-none cursor-pointer"
            >
              <option value="praha">Celá Praha</option>
              <option value="brno">Celé Brno</option>
            </select>
          </div>

          {medians?.median_price_per_m2 && (
            <p className="text-sm text-slate-600">
              medián <strong className="text-slate-900">{formatPerM2(medians.median_price_per_m2)}</strong>
              {' · '}
              <strong className="text-slate-900">{formatCzk(medians.median_price)}</strong>
            </p>
          )}
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 py-6 flex flex-col lg:flex-row gap-8">
        <FilterSidebar
          filters={filters}
          onChange={handleFilterChange}
          facets={facets}
          city={city}
          listingType={listingType}
          onListingTypeChange={setListingType}
        />

        <main className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <p className="text-slate-600">
              <strong className="text-xl text-slate-900">{total}</strong>{' '}
              {total === 1 ? 'nemovitost' : total < 5 ? 'nemovitosti' : 'nemovitostí'}
            </p>

            <div className="flex items-center gap-2">
              <select
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value);
                  setPage(0);
                }}
                className="px-3 py-2 border border-slate-200 rounded-xl text-sm font-medium bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>

              <div className="flex gap-0.5 p-0.5 bg-slate-100 rounded-xl">
                {VIEWS.map((v) => (
                  <button
                    key={v.key}
                    onClick={() => setView(v.key)}
                    title={v.label}
                    aria-label={v.label}
                    aria-pressed={view === v.key}
                    className={`px-2.5 py-1.5 rounded-lg transition ${
                      view === v.key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'
                    }`}
                  >
                    <ViewIcon name={v.key} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && (
            <div className="p-4 mb-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
              Chyba načítání: {error}
            </div>
          )}

          {view === 'map' ? (
            <MapComponent city={city} params={params} />
          ) : loading ? (
            <div className={view === 'grid' ? 'grid sm:grid-cols-2 xl:grid-cols-3 gap-5' : 'space-y-4'}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-80 bg-slate-100 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : listings.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-lg font-medium text-slate-900 mb-1">Žádná nemovitost neodpovídá filtrům</p>
              <p className="text-slate-500">Zkus rozšířit cenové rozmezí nebo odebrat některé filtry.</p>
            </div>
          ) : (
            <>
              <div className={view === 'grid' ? 'grid sm:grid-cols-2 xl:grid-cols-3 gap-5' : 'space-y-4'}>
                {listings.map((listing) => (
                  <ListingCard key={listing.id} listing={listing} view={view} />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-8">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-slate-50"
                  >
                    Předchozí
                  </button>
                  <span className="text-sm text-slate-600">
                    {page + 1} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-slate-50"
                  >
                    Další
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
