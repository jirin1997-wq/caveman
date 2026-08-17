import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { formatCzk } from '../lib/format';

function Field({ label, value, onChange, suffix, step = 1, min = 0 }) {
  return (
    <label className="block">
      <span className="block text-sm text-slate-600 mb-1">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10"
        />
        {suffix && <span className="text-sm text-slate-500 shrink-0">{suffix}</span>}
      </div>
    </label>
  );
}

/**
 * Kalkulačka hypotéky a dostupnosti pro konkrétní nemovitost.
 * Počty dělá backend, aby stejná pravidla platila i pro případné API klienty.
 */
export default function MortgageCalculator({ propertyPrice }) {
  const [downPayment, setDownPayment] = useState(Math.round(propertyPrice * 0.2));
  const [interestRate, setInterestRate] = useState(4.9);
  const [loanTerm, setLoanTerm] = useState(30);
  const [monthlyIncome, setMonthlyIncome] = useState(60000);
  const [monthlyDebts, setMonthlyDebts] = useState(0);

  const [mortgage, setMortgage] = useState(null);
  const [affordability, setAffordability] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      Promise.all([
        api.post('/calculator/mortgage', { propertyPrice, downPayment, interestRate, loanTerm }),
        api.post('/calculator/affordability', {
          propertyPrice, downPayment, interestRate, loanTerm, monthlyIncome, monthlyDebts
        })
      ])
        .then(([m, a]) => {
          if (cancelled) return;
          setMortgage(m.data);
          setAffordability(a.data);
          setError(null);
        })
        .catch((err) => !cancelled && setError(err.response?.data?.error || err.message));
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [propertyPrice, downPayment, interestRate, loanTerm, monthlyIncome, monthlyDebts]);

  return (
    <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200">
      <h2 className="text-xl font-bold mb-4">Kalkulačka hypotéky</h2>

      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <Field
          label="Vlastní zdroje"
          value={downPayment}
          onChange={setDownPayment}
          step={50000}
          suffix="Kč"
        />
        <Field label="Úroková sazba" value={interestRate} onChange={setInterestRate} step={0.1} suffix="% p.a." />
        <Field label="Doba splácení" value={loanTerm} onChange={setLoanTerm} step={1} min={1} suffix="let" />
        <Field label="Čistý měsíční příjem" value={monthlyIncome} onChange={setMonthlyIncome} step={5000} suffix="Kč" />
        <Field label="Ostatní splátky" value={monthlyDebts} onChange={setMonthlyDebts} step={1000} suffix="Kč/měs." />
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {mortgage && (
        <div className="grid sm:grid-cols-3 gap-4 mb-4">
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <p className="text-sm text-slate-600">Měsíční splátka</p>
            <p className="text-2xl font-bold text-slate-900">{formatCzk(mortgage.monthlyPayment)}</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <p className="text-sm text-slate-600">Celkem zaplaceno na úrocích</p>
            <p className="text-2xl font-bold text-slate-900">{formatCzk(mortgage.totalInterest)}</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <p className="text-sm text-slate-600">LTV</p>
            <p className={`text-2xl font-bold ${mortgage.ltvWarning ? 'text-orange-600' : 'text-slate-900'}`}>
              {mortgage.ltv} %
            </p>
            {mortgage.ltvWarning && (
              <p className="text-xs text-orange-600 mt-1">Nad 80 % banky obvykle neschválí</p>
            )}
          </div>
        </div>
      )}

      {affordability && (
        <div
          className={`rounded-xl p-4 border ${
            affordability.affordable
              ? 'bg-emerald-50 border-emerald-200'
              : 'bg-orange-50 border-orange-200'
          }`}
        >
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 mb-1">
            <p className="font-semibold text-slate-900">
              DSTI {affordability.dsti} %
            </p>
            <p className="text-sm text-slate-600">
              Nemovitost stojí {affordability.yearsOfIncome} let tvého čistého příjmu
            </p>
          </div>
          <p className={`text-sm ${affordability.affordable ? 'text-emerald-800' : 'text-orange-800'}`}>
            {affordability.recommendation}
          </p>
        </div>
      )}
    </div>
  );
}
