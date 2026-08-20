'use client';

import { useEffect, useState } from 'react';
import { useATCStore } from '../store';

function Row({ label, value, mono = true, accent }) {
  return (
    <div className="flex justify-between gap-3 text-xs py-0.5">
      <span className="text-gray-400 shrink-0">{label}</span>
      <span className={`${mono ? 'font-mono' : ''} text-right ${accent || ''}`}>
        {value ?? <span className="text-gray-600">—</span>}
      </span>
    </div>
  );
}

/**
 * Photo of the exact airframe, looked up by the hex its transponder sends.
 * Three honest states: loading, a real photo with credit, or "no photo".
 */
function AircraftPhoto({ api, hex }) {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    fetch(`${api}/api/photo/${hex}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setState(d.photo ? { status: 'ok', photo: d.photo } : { status: 'none', error: d.error });
      })
      .catch((e) => !cancelled && setState({ status: 'none', error: String(e) }));

    return () => {
      cancelled = true;
    };
  }, [api, hex]);

  if (state.status === 'loading') {
    return <div className="h-28 bg-gray-700/40 rounded animate-pulse mb-2" />;
  }

  if (state.status === 'none') {
    return (
      <div className="h-16 bg-gray-700/30 rounded mb-2 flex items-center justify-center px-3">
        <p className="text-[11px] text-gray-500 text-center">
          {state.error ? state.error : 'Pro tenhle trup fotka není.'}
        </p>
      </div>
    );
  }

  const { photo } = state;
  return (
    <a href={photo.link || '#'} target="_blank" rel="noreferrer" className="block mb-2 group">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.large || photo.thumbnail}
        alt="fotografie letadla"
        className="w-full rounded object-cover max-h-40 group-hover:opacity-90"
      />
      <p className="text-[10px] text-gray-500 mt-1">
        © {photo.photographer || 'neznámý autor'} · {photo.credit}
      </p>
    </a>
  );
}

export default function InfoPanel({ api }) {
  const { selectedAircraft: ac, airport, trafficSource } = useATCStore();

  if (!ac) {
    return (
      <div className="text-sm">
        <h3 className="font-bold mb-2">{airport ? airport.name : 'Načítám…'}</h3>
        {airport && (
          <div className="space-y-0.5">
            <Row label="ICAO" value={airport.icao} />
            <Row label="Město" value={airport.city} />
            <Row label="Pozice" value={`${airport.lat.toFixed(3)}, ${airport.lon.toFixed(3)}`} />
            <Row label="Zdroj provozu" value={trafficSource} />
            <p className="text-xs text-gray-500 pt-3">
              Klikni na letadlo na radaru nebo v tabuli vpravo.
            </p>
          </div>
        )}
      </div>
    );
  }

  const emergency = ac.squawkMeaning?.severity === 'critical';

  return (
    <div className="text-sm">
      <AircraftPhoto api={api} hex={ac.id} />

      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-bold font-mono text-yellow-300 text-lg">{ac.callsign}</h3>
        <span className="text-xs font-mono text-gray-400">{ac.registration || ac.id}</span>
      </div>

      {ac.typeName || ac.type ? (
        <p className="text-xs text-gray-300 mb-1">
          {ac.typeName || ac.type}
          {ac.type && ac.typeName ? <span className="text-gray-500"> · {ac.type}</span> : null}
        </p>
      ) : (
        <p className="text-xs text-gray-600 mb-1">Typ letadla tenhle zdroj neposílá.</p>
      )}

      {emergency && (
        <div className="bg-red-800 text-red-100 text-xs font-bold rounded px-2 py-1 my-2">
          ⚠ {ac.squawkMeaning.label} — squawk {ac.squawk}
        </div>
      )}

      <div className="mt-2 space-y-0.5 border-t border-gray-700 pt-2">
        <Row label="Provozovatel" value={ac.operator} mono={false} />
        <Row label="Rok výroby" value={ac.year} />
        <Row label="Kategorie" value={ac.categoryName} mono={false} />
        <Row label="Turbulence" value={ac.wake} />
      </div>

      <div className="mt-2 space-y-0.5 border-t border-gray-700 pt-2">
        <Row label="Výška" value={`${Math.round(ac.altitude).toLocaleString('cs')} ft`} />
        <Row label="Rychlost" value={`${Math.round(ac.velocity)} kt`} />
        <Row label="Kurz" value={`${Math.round(ac.heading)}°`} />
        <Row
          label="Stoupání"
          value={`${ac.verticalRate > 0 ? '+' : ''}${Math.round(ac.verticalRate)} ft/min`}
          accent={ac.verticalRate > 300 ? 'text-green-400' : ac.verticalRate < -300 ? 'text-orange-400' : ''}
        />
        <Row label="Squawk" value={ac.squawk} accent={emergency ? 'text-red-400 font-bold' : ''} />
        {ac.distanceKm != null && (
          <Row label="Od letiště" value={`${ac.distanceKm} km ${ac.compass}`} />
        )}
      </div>

      <p className="text-[10px] text-gray-600 mt-2">
        hex {ac.id} · zdroj {ac.source}
      </p>
    </div>
  );
}
