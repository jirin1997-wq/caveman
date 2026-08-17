import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatCzk, formatPerM2 } from '../lib/format';
import 'leaflet/dist/leaflet.css';

const CITY_CENTERS = {
  praha: [50.0755, 14.4378],
  brno: [49.1922, 16.6113]
};

/** Barva bodu podle cenového ratingu — stejná škála jako pruh na kartě. */
const RATING_COLORS = {
  green: '#10b981',
  blue: '#0ea5e9',
  gray: '#94a3b8',
  orange: '#f97316',
  red: '#ef4444'
};

/** Přesune mapu, když uživatel přepne město. */
function RecenterOnCity({ center }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center[0], center[1]]);
  return null;
}

export default function MapComponent({ city = 'praha', params = {} }) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    api
      .get(`/map/${city}`, { params })
      .then((res) => {
        if (cancelled) return;
        setListings(res.data);
        setError(null);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [city, JSON.stringify(params)]);

  const center = CITY_CENTERS[city] || CITY_CENTERS.praha;

  if (error) {
    return (
      <div className="h-[600px] rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center text-red-700">
        Mapu se nepodařilo načíst: {error}
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <MapContainer
          center={center}
          zoom={12}
          style={{ height: '600px', width: '100%' }}
          className="rounded-2xl border border-slate-200 z-0"
          scrollWheelZoom
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          <RecenterOnCity center={center} />

          {listings.map((listing) => (
            <CircleMarker
              key={listing.id}
              center={[Number(listing.latitude), Number(listing.longitude)]}
              radius={7}
              pathOptions={{
                color: '#fff',
                weight: 1.5,
                fillColor: RATING_COLORS[listing.rating?.color] || RATING_COLORS.gray,
                fillOpacity: 0.9
              }}
            >
              <Popup>
                <div className="min-w-[180px]">
                  <div className="flex gap-1.5 mb-1">
                    {listing.disposition && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-semibold">
                        {listing.disposition}
                      </span>
                    )}
                    {listing.size_m2 && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-semibold">
                        {Math.round(listing.size_m2)} m²
                      </span>
                    )}
                  </div>
                  <p className="text-slate-500 text-xs mb-1">{listing.address}</p>
                  <p className="font-bold text-base">{formatCzk(listing.price)}</p>
                  <p className="text-xs text-slate-600">{formatPerM2(listing.price_per_m2)}</p>
                  {listing.rating?.label && (
                    <p className="text-xs mt-1 font-medium">{listing.rating.label}</p>
                  )}
                  <Link to={`/listing/${listing.id}`} className="text-xs text-blue-600 hover:underline">
                    Detail →
                  </Link>
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>

        {loading && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-white rounded-full shadow text-sm z-[400]">
            Načítám…
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-600">
        <span className="font-medium text-slate-700">{listings.length} bodů na mapě</span>
        {[
          ['green', 'Výborná cena'],
          ['blue', 'Dobrá'],
          ['gray', 'Průměrná'],
          ['orange', 'Zvýšená'],
          ['red', 'Vysoká']
        ].map(([color, label]) => (
          <span key={color} className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: RATING_COLORS[color] }}
            />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
