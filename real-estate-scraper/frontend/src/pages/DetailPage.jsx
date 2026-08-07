import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import axios from 'axios';

const API_URL = 'http://localhost:5000/api';

export default function DetailPage() {
  const { id } = useParams();
  const [listing, setListing] = useState(null);
  const [priceHistory, setPriceHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchListing();
  }, [id]);

  async function fetchListing() {
    try {
      const res = await axios.get(`${API_URL}/listings/${id}`);
      setListing(res.data);

      const historyRes = await axios.get(`${API_URL}/listings/${id}/price-trend`);
      setPriceHistory(historyRes.data);
    } catch (err) {
      console.error('Error fetching listing:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="text-center py-8">Načítání...</div>;
  if (!listing) return <div className="text-center py-8">Inzerát nenalezen</div>;

  const priceChange = priceHistory.length > 1
    ? priceHistory[priceHistory.length - 1].price - priceHistory[0].price
    : 0;

  const pricePercent = priceHistory.length > 1
    ? ((priceChange / priceHistory[0].price) * 100).toFixed(1)
    : 0;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <Link to="/" className="text-blue-600 hover:underline mb-6 inline-block">
        ← Zpět na hledání
      </Link>

      <div className="bg-white rounded-lg shadow-md p-8">
        <h1 className="text-3xl font-bold mb-4">{listing.title}</h1>
        <p className="text-gray-600 text-lg mb-6">📍 {listing.address}</p>

        {listing.photos?.[0] && (
          <div className="mb-8">
            <img src={listing.photos[0]} alt={listing.title} className="w-full max-h-96 object-cover rounded-lg" />
          </div>
        )}

        {/* Price Info */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8 pb-8 border-b">
          <div>
            <p className="text-gray-600 text-sm">Cena</p>
            <p className="text-3xl font-bold">{listing.price.toLocaleString()} Kč</p>
          </div>
          <div>
            <p className="text-gray-600 text-sm">Cena/m²</p>
            <p className="text-3xl font-bold">{listing.price_per_m2?.toLocaleString() || '-'}</p>
          </div>
          <div>
            <p className="text-gray-600 text-sm">Velikost</p>
            <p className="text-3xl font-bold">{listing.size_m2 || '-'} m²</p>
          </div>
          <div>
            <p className="text-gray-600 text-sm">Pokoje</p>
            <p className="text-3xl font-bold">{listing.rooms || '-'}</p>
          </div>
        </div>

        {/* Price History */}
        {priceHistory.length > 1 && (
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-4">Vývoj ceny</h2>

            <div className="mb-4">
              <p className="text-gray-600">
                Změna ceny:{' '}
                <span className={priceChange > 0 ? 'text-red-600 font-bold' : 'text-green-600 font-bold'}>
                  {priceChange > 0 ? '+' : ''}{priceChange.toLocaleString()} Kč ({pricePercent}%)
                </span>
              </p>
            </div>

            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={priceHistory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(date) => new Date(date).toLocaleDateString('cs-CZ')}
                />
                <YAxis />
                <Tooltip
                  formatter={(value) => value.toLocaleString()}
                  labelFormatter={(date) => new Date(date).toLocaleDateString('cs-CZ')}
                />
                <Line type="monotone" dataKey="price" stroke="#2563eb" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Description */}
        {listing.description && (
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-4">Popis</h2>
            <p className="text-gray-700 whitespace-pre-wrap">{listing.description}</p>
          </div>
        )}

        {/* Metadata */}
        <div className="bg-gray-50 p-4 rounded text-sm text-gray-600">
          <p>Zdroj: <strong>{listing.source}</strong></p>
          <p>Aktualizováno: <strong>{new Date(listing.updated_at).toLocaleString('cs-CZ')}</strong></p>
          <p>
            <a href={listing.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
              Otevřít na původní stránce →
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
