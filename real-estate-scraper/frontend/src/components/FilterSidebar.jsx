import { useState } from 'react';
import HistogramSlider from './HistogramSlider';
import TrendChart from './TrendChart';
import { formatMillions, formatArea, LABELS } from '../lib/format';

function Section({ title, children, action }) {
  return (
    <section className="py-5 border-b border-slate-200 last:border-b-0">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold tracking-wider text-slate-500 uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Checkbox({ label, checked, count, onChange }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none py-1 group">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
      />
      <span className="text-sm text-slate-700 group-hover:text-slate-900">{label}</span>
      {count != null && <span className="ml-auto text-xs text-slate-400">{count}</span>}
    </label>
  );
}

/**
 * Levý panel s filtry. Stav drží rodič (SearchPage), sidebar jen renderuje
 * a hlásí změny — díky tomu jdou filtry sdílet mezi seznamem a mapou.
 */
export default function FilterSidebar({
  filters,
  onChange,
  facets,
  city,
  listingType,
  onListingTypeChange
}) {
  const [priceUnit, setPriceUnit] = useState('czk'); // 'czk' | 'm2'

  const toggleInList = (key, value) => {
    const current = filters[key] || [];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onChange({ ...filters, [key]: next });
  };

  const set = (key, value) => onChange({ ...filters, [key]: value });

  const priceHist = priceUnit === 'czk' ? facets?.priceHistogram : facets?.pricePerM2Histogram;
  const priceKey = priceUnit === 'czk' ? 'price' : 'pricePerM2';
  const priceRange = filters[`${priceKey}Range`];

  return (
    <aside className="w-full lg:w-72 shrink-0">
      {/* Přepínač typu nabídky */}
      <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl mb-2">
        {[
          { key: 'novostavba', label: 'Novostavby' },
          { key: 'byt', label: 'Byty' }
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => onListingTypeChange(tab.key)}
            className={`py-2 rounded-lg text-sm font-semibold transition ${
              listingType === tab.key
                ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="divide-y divide-slate-200">
        {/* Rychlé přepínače */}
        <div className="py-4 space-y-1">
          <Checkbox
            label="Pouze činžovní domy"
            checked={!!filters.tenementOnly}
            count={facets?.tenementCount}
            onChange={(e) => set('tenementOnly', e.target.checked)}
          />
          <Checkbox
            label="Pouze zlevněné"
            checked={!!filters.discountedOnly}
            count={facets?.discountedCount}
            onChange={(e) => set('discountedOnly', e.target.checked)}
          />
        </div>

        {facets?.dispositions?.length > 0 && (
          <Section title="Dispozice">
            <div className="grid grid-cols-2 gap-x-3">
              {facets.dispositions.map((d) => (
                <Checkbox
                  key={d.value}
                  label={d.value}
                  count={d.count}
                  checked={(filters.dispositions || []).includes(d.value)}
                  onChange={() => toggleInList('dispositions', d.value)}
                />
              ))}
            </div>
          </Section>
        )}

        {priceHist?.max > 0 && priceRange && (
          <Section
            title="Cenové rozmezí"
            action={
              <div className="flex gap-0.5 p-0.5 bg-slate-100 rounded-lg">
                {[
                  { key: 'czk', label: 'Kč' },
                  { key: 'm2', label: 'Kč/m²' }
                ].map((unit) => (
                  <button
                    key={unit.key}
                    onClick={() => setPriceUnit(unit.key)}
                    className={`px-2 py-0.5 rounded-md text-xs font-medium transition ${
                      priceUnit === unit.key
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500'
                    }`}
                  >
                    {unit.label}
                  </button>
                ))}
              </div>
            }
          >
            <HistogramSlider
              min={Math.floor(priceHist.min)}
              max={Math.ceil(priceHist.max)}
              value={priceRange}
              bins={priceHist.bins}
              step={priceUnit === 'czk' ? 100000 : 1000}
              format={priceUnit === 'czk' ? formatMillions : (n) => `${Math.round(n / 1000)} tis./m²`}
              onChange={(range) => set(`${priceKey}Range`, range)}
            />
          </Section>
        )}

        {facets?.sizeHistogram?.max > 0 && filters.sizeRange && (
          <Section title="Plocha">
            <HistogramSlider
              min={Math.floor(facets.sizeHistogram.min)}
              max={Math.ceil(facets.sizeHistogram.max)}
              value={filters.sizeRange}
              bins={facets.sizeHistogram.bins}
              step={1}
              format={formatArea}
              onChange={(range) => set('sizeRange', range)}
            />
          </Section>
        )}

        {facets?.buildingTypes?.length > 0 && (
          <Section title="Stavba">
            <div className="flex flex-wrap gap-x-4">
              {facets.buildingTypes.map((b) => (
                <Checkbox
                  key={b.value}
                  label={LABELS.buildingType[b.value] || b.value}
                  checked={(filters.buildingTypes || []).includes(b.value)}
                  onChange={() => toggleInList('buildingTypes', b.value)}
                />
              ))}
            </div>
          </Section>
        )}

        {facets?.conditions?.length > 0 && (
          <Section title="Stav objektu">
            <div className="flex flex-wrap gap-x-4">
              {facets.conditions.map((c) => (
                <Checkbox
                  key={c.value}
                  label={LABELS.condition[c.value] || c.value}
                  checked={(filters.conditions || []).includes(c.value)}
                  onChange={() => toggleInList('conditions', c.value)}
                />
              ))}
            </div>
          </Section>
        )}

        {facets?.amenities && (
          <Section title="Vybavenost">
            <div className="grid grid-cols-2 gap-x-3">
              {Object.entries(facets.amenities).map(([key, count]) => (
                <Checkbox
                  key={key}
                  label={LABELS.amenity[key] || key}
                  count={count}
                  checked={(filters.amenities || []).includes(key)}
                  onChange={() => toggleInList('amenities', key)}
                />
              ))}
            </div>
          </Section>
        )}

        {listingType === 'novostavba' && facets?.completionYears?.length > 0 && (
          <Section title="Dokončení">
            <div className="grid grid-cols-3 gap-x-3">
              {facets.completionYears.map((y) => (
                <Checkbox
                  key={y.value}
                  label={y.value}
                  checked={(filters.completionYears || []).includes(String(y.value))}
                  onChange={() => toggleInList('completionYears', String(y.value))}
                />
              ))}
            </div>
          </Section>
        )}

        {facets?.districts?.length > 0 && (
          <Section title="Lokalita">
            <div className="max-h-52 overflow-y-auto pr-1">
              {facets.districts.map((d) => (
                <Checkbox
                  key={d.value}
                  label={d.value}
                  count={d.count}
                  checked={(filters.districts || []).includes(d.value)}
                  onChange={() => toggleInList('districts', d.value)}
                />
              ))}
            </div>
          </Section>
        )}

        {facets?.sources?.length > 0 && (
          <Section title={`Zdroje`}>
            {facets.sources.map((s) => (
              <Checkbox
                key={s.value}
                label={s.value}
                count={s.count}
                checked={(filters.sources || []).includes(s.value)}
                onChange={() => toggleInList('sources', s.value)}
              />
            ))}
          </Section>
        )}

        <Section title={`Vývoj cen ${city === 'praha' ? 'Praha' : 'Brno'}`}>
          <TrendChart city={city} listingType={listingType} />
        </Section>
      </div>
    </aside>
  );
}
