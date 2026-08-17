const COLOR_CLASSES = {
  green: { fill: 'bg-emerald-500', text: 'text-emerald-700' },
  blue: { fill: 'bg-sky-500', text: 'text-sky-700' },
  gray: { fill: 'bg-slate-400', text: 'text-slate-600' },
  orange: { fill: 'bg-orange-500', text: 'text-orange-600' },
  red: { fill: 'bg-red-500', text: 'text-red-600' }
};

/**
 * Pětidílný ukazatel ceny — čím víc vybarvených dílků, tím lepší cena
 * vůči srovnatelným nemovitostem ve stejné čtvrti a dispozici.
 */
export default function PriceRatingBar({ rating, showDeviation = false }) {
  if (!rating) return null;

  const colors = COLOR_CLASSES[rating.color] || COLOR_CLASSES.gray;

  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-[3px]" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={`block w-4 h-[5px] rounded-full ${
              i <= rating.segments ? colors.fill : 'bg-slate-200'
            }`}
          />
        ))}
      </div>
      <span className={`text-sm font-medium ${colors.text}`}>{rating.label}</span>
      {showDeviation && rating.deviation != null && (
        <span className="text-sm text-slate-500">
          ({rating.deviation > 0 ? '+' : ''}
          {rating.deviation} % vs. medián)
        </span>
      )}
    </div>
  );
}
