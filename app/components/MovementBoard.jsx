'use client';

import { useState } from 'react';
import { useATCStore } from '../store';

const TABS = [
  { key: 'arriving', label: 'Přílety', icon: '🛬' },
  { key: 'departing', label: 'Odlety', icon: '🛫' },
  { key: 'ground', label: 'Na zemi', icon: '🅿' },
  { key: 'transit', label: 'Přelety', icon: '✈' },
];

export default function MovementBoard() {
  const { board, trafficLive, selectedAircraft, selectAircraft } = useATCStore();
  const [tab, setTab] = useState('arriving');

  const list = board?.[tab] || [];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex gap-1 mb-2">
        {TABS.map((t) => {
          const count = board?.[t.key]?.length || 0;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 px-1 py-1.5 rounded text-xs transition ${
                active ? 'bg-blue-600 font-semibold' : 'bg-gray-700/60 hover:bg-gray-700'
              }`}
              title={t.label}
            >
              <span className="mr-1">{t.icon}</span>
              {count}
            </button>
          );
        })}
      </div>

      <p className="text-[10px] text-gray-500 mb-1 leading-tight">
        Odvozeno z živých ADS-B dat — co se opravdu děje kolem letiště. Není to
        letový řád.
      </p>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {!trafficLive ? (
          <p className="text-xs text-yellow-300 p-2">Bez živých dat není co zobrazit.</p>
        ) : list.length === 0 ? (
          <p className="text-xs text-gray-500 p-2">
            V kategorii „{TABS.find((t) => t.key === tab).label}" teď nic není.
          </p>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {list.map((ac) => (
                <tr
                  key={ac.id}
                  onClick={() => selectAircraft(ac)}
                  className={`cursor-pointer border-b border-gray-700/50 hover:bg-gray-700/50 ${
                    selectedAircraft?.id === ac.id ? 'bg-blue-900/50' : ''
                  }`}
                >
                  <td className="py-1 font-mono font-bold text-yellow-200">{ac.callsign}</td>
                  <td className="py-1 text-gray-400">{ac.type || '—'}</td>
                  <td className="py-1 text-right font-mono">
                    {ac.onGround ? 'GND' : Math.round(ac.altitude / 100)}
                  </td>
                  <td className="py-1 text-right font-mono text-gray-400 w-16">
                    {ac.distanceKm}km
                  </td>
                  <td className="py-1 text-right text-gray-500 w-6">{ac.compass}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
