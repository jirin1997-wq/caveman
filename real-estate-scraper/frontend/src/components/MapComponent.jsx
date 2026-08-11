import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { Icon } from 'leaflet';
import axios from 'axios';
import 'leaflet/dist/leaflet.css';

const API_URL = 'http://localhost:5000/api';

// City centers (latitude, longitude)
const CITY_CENTERS = {
  praha: [50.0755, 14.4378],
  brno: [49.1922, 16.6113]
};

// Create color-coded icons based on price deviation
function getPriceIcon(pricePerM2, medianPricePerM2) {
  let color = 'gray';

  if (medianPricePerM2) {
    const deviation = ((pricePerM2 - medianPricePerM2) / medianPricePerM2) * 100;
    if (deviation < -10) color = 'green';      // 10% cheaper
    else if (deviation > 10) color = 'red';    // 10% expensive
    else color = 'blue';                       // At market
  }

  return new Icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-${color}.png`,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    shadowSize: [41, 41]
  });
}

export default function MapComponent({ city = 'praha' }) {
  const [listings, setListings] = useState([]);
  const [medians, setMedians] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMapData();
  }, [city]);

  async function fetchMapData() {
    try {
      const [mapRes, statsRes] = await Promise.all([
        axios.get(`${API_URL}/map/${city}`),
        axios.get(`${API_URL}/stats/${city}/medians`)
      ]);

      setListings(mapRes.data);
      setMedians(statsRes.data);
    } catch (err) {
      console.error('Error fetching map data:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="h-96 bg-gray-200 rounded flex items-center justify-center">Načítání mapy...</div>;

  const center = CITY_CENTERS[city] || [50.0755, 14.4378];

  return (
    <div>
      <MapContainer center={center} zoom={12} style={{ height: '500px', width: '100%' }} className="rounded-lg shadow-md">
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; OpenStreetMap contributors'
        />

        {listings.map(listing => (
          <Marker
            key={listing.id}
            position={[listing.latitude, listing.longitude]}
            icon={getPriceIcon(listing.price_per_m2, medians?.median_price_per_m2)}
          >
            <Popup>
              <div className="text-sm">
                <p className="font-bold">{listing.title}</p>
                <p className="text-gray-600">{listing.address}</p>
                <p className="font-semibold text-lg">{listing.price.toLocaleString()} Kč</p>
                <p className="text-sm text-gray-500">{listing.price_per_m2?.toLocaleString()} Kč/m²</p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {/* Legend + Stats */}
      <div className="mt-4 p-4 bg-gray-50 rounded-lg">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <div>
            <p className="text-gray-600 text-sm">Medián ceny</p>
            <p className="text-2xl font-bold">{medians?.median_price?.toLocaleString() || '-'} Kč</p>
          </div>
          <div>
            <p className="text-gray-600 text-sm">Medián ceny/m²</p>
            <p className="text-2xl font-bold">{medians?.median_price_per_m2?.toLocaleString() || '-'}</p>
          </div>
          <div>
            <p className="text-gray-600 text-sm">Průměrná velikost</p>
            <p className="text-2xl font-bold">{medians?.avg_size_m2?.toFixed(0) || '-'} m²</p>
          </div>
          <div>
            <p className="text-gray-600 text-sm">Inzeráty v mapě</p>
            <p className="text-2xl font-bold">{listings.length}</p>
          </div>
        </div>

        <div className="flex gap-4 text-xs">
          <div className="flex items-center gap-1">
            <span className="w-4 h-4 bg-green-400 rounded-full"></span>
            <span>10%+ levnější</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-4 h-4 bg-blue-400 rounded-full"></span>
            <span>Na tržní ceně</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-4 h-4 bg-red-400 rounded-full"></span>
            <span>10%+ dražší</span>
          </div>
        </div>
      </div>
    </div>
  );
}
