import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import PriceRatingBar from '../components/PriceRatingBar';
import MortgageCalculator from '../components/MortgageCalculator';
import { api } from '../lib/api';
import { formatCzk, formatPerM2, formatArea, formatDate, LABELS } from '../lib/format';

function Stat({ label, value, hint, tone = 'default' }) {
  const toneClass = {
    default: 'text-slate-900',
    green: 'text-emerald-600',
    red: 'text-red-600',
    orange: 'text-orange-600',
    blue: 'text-sky-600',
    gray: 'text-slate-500'
  }[tone];

  return (
    <div>
      <p className="text-sm text-slate-600">{label}</p>
      <p className={`text-2xl font-bold ${toneClass}`}>{value}</p>
      {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
    </div>
  );
}

export default function DetailPage() {
  const { id } = useParams();
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    api
      .get(`/listings/${id}`)
      .then((res) => !cancelled && setListing(res.data))
      .catch((err) => !cancelled && setError(err.response?.data?.error || err.message))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="h-96 bg-slate-100 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-20 text-center">
        <p className="text-lg font-medium text-slate-900 mb-2">Nemovitost se nepodařilo načíst</p>
        <p className="text-slate-500 mb-6">{error || 'Inzerát neexistuje.'}</p>
        <Link to="/" className="text-blue-600 hover:underline">
          ← Zpět na hledání
        </Link>
      </div>
    );
  }

  const history = listing.priceHistory || [];
  const priceChange =
    history.length > 1 ? Number(history[history.length - 1].price) - Number(history[0].price) : 0;
  const priceChangePct =
    history.length > 1 && Number(history[0].price) > 0
      ? ((priceChange / Number(history[0].price)) * 100).toFixed(1)
      : null;

  const amenities = Array.isArray(listing.amenities) ? listing.amenities : [];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <Link to="/" className="text-sm text-blue-600 hover:underline mb-5 inline-block">
        ← Zpět na hledání
      </Link>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 mb-6">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {listing.disposition && (
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 text-sm font-semibold">
              {listing.disposition}
            </span>
          )}
          {listing.size_m2 && (
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 text-sm font-semibold">
              {formatArea(listing.size_m2)}
            </span>
          )}
          {listing.is_discounted && (
            <span className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-sm font-semibold">
              Zlevněno
            </span>
          )}
        </div>

        <h1 className="text-3xl font-bold text-slate-900 mb-1">{listing.title}</h1>
        <p className="text-slate-600 mb-6">📍 {listing.address}</p>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 pb-6 border-b border-slate-200">
          <Stat label="Cena" value={formatCzk(listing.price)} />
          <Stat label="Cena za m²" value={formatPerM2(listing.price_per_m2)} />
          <Stat
            label="Hrubý výnos z pronájmu"
            value={listing.yieldPct != null ? `${listing.yieldPct} % p.a.` : '—'}
            tone={listing.yieldColor}
            hint="Roční nájem / kupní cena"
          />
          <Stat
            label="Na trhu"
            value={listing.daysOnMarket != null ? `${listing.daysOnMarket} dní` : '—'}
            hint={`Od ${formatDate(listing.first_seen_at)}`}
          />
        </div>

        <div className="py-6 border-b border-slate-200">
          <h2 className="text-sm font-bold tracking-wider text-slate-500 uppercase mb-3">
            Srovnání s trhem
          </h2>
          <PriceRatingBar rating={listing.rating} showDeviation />
          {listing.rating?.basis ? (
            <p className="text-sm text-slate-500 mt-2">
              Srovnávací skupina: {listing.rating.basis} ({listing.rating.sampleSize} nemovitostí,
              medián {formatPerM2(listing.rating.medianPricePerM2)}).
            </p>
          ) : (
            <p className="text-sm text-slate-500 mt-2">
              Zatím není dost srovnatelných nemovitostí pro spolehlivé hodnocení ceny.
            </p>
          )}
        </div>

        <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-3 py-6 text-sm">
          {listing.building_type && (
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <dt className="text-slate-600">Stavba</dt>
              <dd className="font-medium">{LABELS.buildingType[listing.building_type]}</dd>
            </div>
          )}
          {listing.condition && (
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <dt className="text-slate-600">Stav objektu</dt>
              <dd className="font-medium">{LABELS.condition[listing.condition]}</dd>
            </div>
          )}
          {listing.district && (
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <dt className="text-slate-600">Lokalita</dt>
              <dd className="font-medium">{listing.neighborhood}, {listing.district}</dd>
            </div>
          )}
          {listing.completion_year && (
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <dt className="text-slate-600">Dokončení</dt>
              <dd className="font-medium">{listing.completion_year}</dd>
            </div>
          )}
          {amenities.length > 0 && (
            <div className="flex justify-between border-b border-slate-100 pb-2 sm:col-span-2">
              <dt className="text-slate-600">Vybavenost</dt>
              <dd className="font-medium text-right">
                {amenities.map((a) => LABELS.amenity[a] || a).join(', ')}
              </dd>
            </div>
          )}
        </dl>

        {history.length > 1 && (
          <div className="pt-2">
            <h2 className="text-xl font-bold mb-1">Vývoj ceny inzerátu</h2>
            <p className={`text-sm mb-4 font-medium ${priceChange > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
              {priceChange > 0 ? '+' : ''}
              {formatCzk(priceChange)} ({priceChangePct} %) od zveřejnění
            </p>

            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  tickFormatter={formatDate}
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v) => `${Math.round(v / 1_000_000)}M`}
                  domain={['dataMin * 0.95', 'dataMax * 1.05']}
                />
                <Tooltip formatter={(v) => formatCzk(v)} labelFormatter={formatDate} />
                <Line type="monotone" dataKey="price" stroke="#0f172a" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="mb-6">
        <MortgageCalculator propertyPrice={Number(listing.price)} />
      </div>

      {listing.description && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 mb-6">
          <h2 className="text-xl font-bold mb-3">Popis</h2>
          <p className="text-slate-700 whitespace-pre-wrap">{listing.description}</p>
        </div>
      )}

      <div className="bg-slate-50 rounded-2xl p-5 text-sm text-slate-600 border border-slate-200">
        <p>
          Zdroj: <strong className="text-slate-900">{listing.source_name || listing.source}</strong>
        </p>
        <p>Aktualizováno: {formatDate(listing.updated_at)}</p>
        <a
          href={listing.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          Otevřít původní inzerát →
        </a>
      </div>
    </div>
  );
}
