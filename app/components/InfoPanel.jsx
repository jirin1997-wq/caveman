'use client';

import { useATCStore } from '../store';

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-gray-400">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

export default function InfoPanel() {
  const { selectedAircraft: ac, airport, trafficSource } = useATCStore();

  if (!ac) {
    return (
      <div className="text-sm">
        <h3 className="font-bold mb-2">{airport ? airport.name : 'Načítám…'}</h3>
        {airport && (
          <div className="space-y-1">
            <Row label="ICAO" value={airport.icao} />
            <Row label="Město" value={airport.city} />
            <Row label="Pozice" value={`${airport.lat.toFixed(4)}, ${airport.lon.toFixed(4)}`} />
            <Row label="Zdroj provozu" value={trafficSource || '—'} />
            <p className="text-xs text-gray-500 pt-2">Klikni na letadlo na radaru pro detail.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="text-sm">
      <h3 className="font-bold font-mono text-yellow-300 text-lg">{ac.callsign}</h3>
      <p className="text-xs text-gray-400 mb-2">
        {ac.id} · zdroj {ac.source}
      </p>
      <div className="space-y-1">
        <Row label="Výška" value={`${Math.round(ac.altitude).toLocaleString('cs')} ft`} />
        <Row label="Rychlost" value={`${Math.round(ac.velocity)} kt`} />
        <Row label="Kurz" value={`${Math.round(ac.heading)}°`} />
        <Row label="Stoupání" value={`${Math.round(ac.verticalRate)} ft/min`} />
        <Row label="Squawk" value={ac.squawk || '—'} />
        <Row label="Na zemi" value={ac.onGround ? 'ano' : 'ne'} />
        <Row
          label="Pozice"
          value={`${ac.position.lat.toFixed(4)}, ${ac.position.lng.toFixed(4)}`}
        />
      </div>
    </div>
  );
}
