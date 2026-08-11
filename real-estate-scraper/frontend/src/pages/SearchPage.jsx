import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import MapComponent from '../components/MapComponent';

const API_URL = 'http://localhost:5000/api';

export default function SearchPage() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [city, setCity] = useState('praha');
  const [filters, setFilters] = useState({
    minPrice: '',
    maxPrice: '',
    minSize: '',
    maxSize: '',
    rooms: ''
  });

  useEffect(() => {
    fetchListings();
  }, [city]);

  async function fetchListings() {
    setLoading(true);
    try {
      const params = { city };
      if (filters.minPrice) params.minPrice = filters.minPrice;
      if (filters.maxPrice) params.maxPrice = filters.maxPrice;
      if (filters.minSize) params.minSize = filters.minSize;
      if (filters.maxSize) params.maxSize = filters.maxSize;
      if (filters.rooms) params.rooms = filters.rooms;

      const res = await axios.get(`${API_URL}/listings`, { params });
      setListings(res.data);
    } catch (err) {
      console.error('Error fetching listings:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleFilterChange(e) {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
  }

  function handleSearch() {
    fetchListings();
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Filters */}
      <div className="bg-white p-6 rounded-lg shadow-md mb-8">
        <h2 className="text-xl font-bold mb-4">Filtry</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium">Město</label>
            <select value={city} onChange={(e) => setCity(e.target.value)} className="w-full border px-3 py-2 rounded">
              <option value="praha">Praha</option>
              <option value="brno">Brno</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium">Min cena (Kč)</label>
            <input
              type="number"
              name="minPrice"
              value={filters.minPrice}
              onChange={handleFilterChange}
              placeholder="0"
              className="w-full border px-3 py-2 rounded"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Max cena (Kč)</label>
            <input
              type="number"
              name="maxPrice"
              value={filters.maxPrice}
              onChange={handleFilterChange}
              placeholder="10000000"
              className="w-full border px-3 py-2 rounded"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Min velikost (m²)</label>
            <input
              type="number"
              name="minSize"
              value={filters.minSize}
              onChange={handleFilterChange}
              placeholder="0"
              className="w-full border px-3 py-2 rounded"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Max velikost (m²)</label>
            <input
              type="number"
              name="maxSize"
              value={filters.maxSize}
              onChange={handleFilterChange}
              placeholder="500"
              className="w-full border px-3 py-2 rounded"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Počet pokojů</label>
            <input
              type="number"
              name="rooms"
              value={filters.rooms}
              onChange={handleFilterChange}
              placeholder="Libovolné"
              className="w-full border px-3 py-2 rounded"
            />
          </div>
        </div>

        <button
          onClick={handleSearch}
          className="bg-blue-600 text-white px-6 py-2 rounded font-medium hover:bg-blue-700"
        >
          Hledat
        </button>
      </div>

      {/* Map */}
      <div className="mb-8">
        <h2 className="text-xl font-bold mb-4">Mapa nemovitostí</h2>
        <MapComponent city={city} />
      </div>

      {/* Listings */}
      <div>
        <h2 className="text-xl font-bold mb-4">
          Výsledky ({listings.length})
        </h2>

        {loading && <p className="text-center py-8">Načítání...</p>}

        {!loading && listings.length === 0 && (
          <p className="text-center py-8 text-gray-500">Žádné inzeráty nenalezeny</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {listings.map(listing => (
            <Link key={listing.id} to={`/listing/${listing.id}`}>
              <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition">
                <div className="bg-gray-200 h-48 flex items-center justify-center">
                  {listing.photos?.[0] ? (
                    <img src={listing.photos[0]} alt={listing.title} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-gray-400">Bez fotografie</span>
                  )}
                </div>
                <div className="p-4">
                  <h3 className="font-bold text-lg truncate">{listing.title}</h3>
                  <p className="text-gray-600 text-sm mb-3">{listing.address}</p>

                  <div className="grid grid-cols-2 gap-2 mb-3 text-sm">
                    <div>
                      <span className="text-gray-600">Cena:</span>
                      <p className="font-bold text-lg">{listing.price.toLocaleString()} Kč</p>
                    </div>
                    <div>
                      <span className="text-gray-600">Cena/m²:</span>
                      <p className="font-bold text-lg">{listing.price_per_m2?.toLocaleString() || '-'}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm text-gray-600">
                    {listing.size_m2 && <p>Velikost: <strong>{listing.size_m2} m²</strong></p>}
                    {listing.rooms && <p>Pokoje: <strong>{listing.rooms}</strong></p>}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
