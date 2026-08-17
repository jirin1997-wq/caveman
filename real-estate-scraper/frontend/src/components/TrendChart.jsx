import { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../lib/api';
import { formatPerM2 } from '../lib/format';

/**
 * Vývoj mediánu ceny za m² ve městě. Data pocházejí z měsíčních snapshotů
 * trhu, ne z jednoho inzerátu — ukazuje tedy pohyb celého trhu.
 */
export default function TrendChart({ city, listingType = 'byt' }) {
  const [trend, setTrend] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/stats/${city}/trend`, { params: { listingType } })
      .then((res) => !cancelled && setTrend(res.data))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [city, listingType]);

  if (error) return <p className="text-sm text-slate-400">Data o vývoji nedostupná</p>;
  if (!trend) return <div className="h-24 bg-slate-100 rounded-lg animate-pulse" />;
  if (!trend.series?.length) return <p className="text-sm text-slate-400">Zatím bez dat</p>;

  const positive = (trend.changePct ?? 0) >= 0;

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-xl font-bold text-slate-900">{formatPerM2(trend.current)}</span>
        {trend.changePct != null && (
          <span className={`text-sm font-semibold ${positive ? 'text-emerald-600' : 'text-red-600'}`}>
            {positive ? '+' : ''}
            {trend.changePct} %
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={90}>
        <AreaChart data={trend.series} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0f172a" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#0f172a" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" hide />
          <YAxis hide domain={['dataMin * 0.97', 'dataMax * 1.03']} />
          <Tooltip
            formatter={(value) => [formatPerM2(value), 'Medián']}
            labelFormatter={(date) =>
              new Date(date).toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' })
            }
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
          />
          <Area
            type="monotone"
            dataKey="median_price_per_m2"
            stroke="#0f172a"
            strokeWidth={2}
            fill="url(#trendFill)"
          />
        </AreaChart>
      </ResponsiveContainer>

      <p className="text-xs text-slate-400 mt-2">
        Medián nabídkových cen za posledních {trend.series.length} měsíců
      </p>
    </div>
  );
}
