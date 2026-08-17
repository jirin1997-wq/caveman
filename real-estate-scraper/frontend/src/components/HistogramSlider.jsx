import { useMemo } from 'react';

/**
 * Dvojitý posuvník s histogramem rozložení za sebou.
 * Sloupce mimo vybraný rozsah jsou ztlumené, takže je vidět,
 * jakou část trhu filtr odřezává.
 */
export default function HistogramSlider({
  min,
  max,
  value,          // [low, high]
  onChange,
  bins = [],
  format = (n) => n.toLocaleString('cs-CZ'),
  step = 1
}) {
  const [low, high] = value;
  const range = max - min || 1;
  const maxBin = useMemo(() => Math.max(1, ...bins), [bins]);

  const toPercent = (n) => ((n - min) / range) * 100;

  // Který sloupec spadá do vybraného rozsahu.
  const binInRange = (index) => {
    const binStart = min + (index / bins.length) * range;
    const binEnd = min + ((index + 1) / bins.length) * range;
    return binEnd >= low && binStart <= high;
  };

  const handleLow = (e) => {
    const next = Math.min(Number(e.target.value), high - step);
    onChange([next, high]);
  };

  const handleHigh = (e) => {
    const next = Math.max(Number(e.target.value), low + step);
    onChange([low, next]);
  };

  return (
    <div className="hist-slider">
      <div className="flex justify-between text-sm text-slate-600 mb-2">
        <span>{format(low)}</span>
        <span>{format(high)}</span>
      </div>

      {bins.length > 0 && (
        <div className="flex items-end gap-[1px] h-10 mb-1" aria-hidden="true">
          {bins.map((count, i) => (
            <div
              key={i}
              className={`flex-1 rounded-sm transition-colors ${
                binInRange(i) ? 'bg-slate-700' : 'bg-slate-200'
              }`}
              style={{ height: `${Math.max(4, (count / maxBin) * 100)}%` }}
            />
          ))}
        </div>
      )}

      <div className="relative h-5">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[3px] bg-slate-200 rounded-full" />
        <div
          className="absolute top-1/2 -translate-y-1/2 h-[3px] bg-slate-800 rounded-full"
          style={{ left: `${toPercent(low)}%`, right: `${100 - toPercent(high)}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={low}
          onChange={handleLow}
          aria-label="Dolní hranice"
          className="range-thumb"
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={high}
          onChange={handleHigh}
          aria-label="Horní hranice"
          className="range-thumb"
        />
      </div>
    </div>
  );
}
