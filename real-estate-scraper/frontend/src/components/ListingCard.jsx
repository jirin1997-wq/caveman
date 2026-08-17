import { Link } from 'react-router-dom';
import PriceRatingBar from './PriceRatingBar';
import { formatCzk, formatPerM2 } from '../lib/format';

const YIELD_COLORS = {
  green: 'text-emerald-600',
  blue: 'text-sky-600',
  orange: 'text-orange-600',
  red: 'text-red-600',
  gray: 'text-slate-500'
};

export default function ListingCard({ listing, view = 'grid' }) {
  const photo = listing.photos?.[0];
  const isList = view === 'list';

  return (
    <Link
      to={`/listing/${listing.id}`}
      className={`group block bg-white rounded-2xl overflow-hidden border border-slate-200 hover:border-slate-300 hover:shadow-lg transition ${
        isList ? 'sm:flex' : ''
      }`}
    >
      <div className={`relative bg-slate-100 ${isList ? 'sm:w-72 shrink-0 h-48' : 'h-56'}`}>
        {photo ? (
          <img src={photo} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
            Bez fotografie
          </div>
        )}

        {listing.completion_year && (
          <span className="absolute top-3 right-3 px-2 py-1 rounded-lg bg-slate-900/75 text-white text-xs font-medium">
            {listing.completion_year}
          </span>
        )}

        {listing.ageLabel && (
          <span className="absolute bottom-3 right-3 px-2 py-0.5 rounded-lg bg-white/90 text-slate-700 text-xs font-medium">
            {listing.ageLabel}
          </span>
        )}

        {listing.is_discounted && (
          <span className="absolute top-3 left-3 px-2 py-1 rounded-lg bg-emerald-600 text-white text-xs font-semibold">
            Zlevněno
          </span>
        )}
      </div>

      <div className="p-4 flex-1">
        <div className="flex items-center gap-2 mb-2">
          {listing.disposition && (
            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-xs font-semibold">
              {listing.disposition}
            </span>
          )}
          {listing.size_m2 && (
            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-xs font-semibold">
              {Math.round(listing.size_m2)} m²
            </span>
          )}
        </div>

        <p className="text-sm text-slate-500 mb-2 truncate">{listing.address}</p>

        <p className="text-2xl font-bold text-slate-900 tracking-tight">
          {formatCzk(listing.price)}
        </p>

        <div className="flex items-center gap-2 mt-1 mb-3 text-sm">
          <span className="text-slate-600">{formatPerM2(listing.price_per_m2)}</span>
          {listing.yieldPct != null && (
            <span
              className={`font-semibold ${YIELD_COLORS[listing.yieldColor]}`}
              title="Hrubý roční výnos z pronájmu"
            >
              ~{listing.yieldPct} % p.a.
            </span>
          )}
        </div>

        <div className="pt-3 border-t border-slate-100">
          <PriceRatingBar rating={listing.rating} />
        </div>
      </div>
    </Link>
  );
}
