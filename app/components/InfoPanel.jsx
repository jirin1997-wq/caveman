'use client';

import { useATCStore } from '../store';

export default function InfoPanel() {
  const { selectedAircraft, airport, activeFrequency } = useATCStore();

  if (!selectedAircraft) {
    return (
      <div className="text-gray-400 text-sm">
        <h3 className="font-bold mb-3">Airport Info</h3>
        {airport ? (
          <div className="space-y-2 text-xs">
            <p>
              <strong>Airport:</strong> {airport.code} - {airport.name}
            </p>
            <p>
              <strong>Elevation:</strong> {airport.elevation} ft
            </p>
            <p>
              <strong>Position:</strong> {airport.coordinates.lat.toFixed(4)}°N,{' '}
              {airport.coordinates.lng.toFixed(4)}°E
            </p>
            <hr className="border-gray-600 my-2" />
            <div>
              <strong className="block mb-2">Runways:</strong>
              {airport.runways.map((rwy) => (
                <p key={rwy.name} className="text-gray-400">
                  {rwy.name} - {rwy.length} ft
                </p>
              ))}
            </div>
            <hr className="border-gray-600 my-2" />
            <div>
              <strong className="block mb-2">Frequencies:</strong>
              {Object.entries(airport.frequencies).map(([name, freq]) => (
                <p key={freq} className="text-gray-400">
                  {name}: {freq} MHz
                </p>
              ))}
            </div>
          </div>
        ) : (
          <p>Loading airport info...</p>
        )}
      </div>
    );
  }

  return (
    <div className="text-white text-sm">
      <h3 className="font-bold mb-3 text-lg">Aircraft Details</h3>
      <div className="space-y-2 text-xs">
        <div className="bg-gray-700 p-2 rounded">
          <p className="text-lg font-mono font-bold text-yellow-300">{selectedAircraft.callsign}</p>
          <p className="text-gray-400">{selectedAircraft.origin}</p>
        </div>

        <hr className="border-gray-600" />

        <div>
          <strong>Position:</strong>
          <p className="text-gray-300 font-mono">
            {selectedAircraft.position.lat.toFixed(4)}°N
          </p>
          <p className="text-gray-300 font-mono">
            {selectedAircraft.position.lng.toFixed(4)}°E
          </p>
        </div>

        <hr className="border-gray-600" />

        <div className="grid grid-cols-2 gap-2">
          <div>
            <strong>Altitude:</strong>
            <p className="text-lg font-mono text-blue-300">
              {(selectedAircraft.altitude / 1000).toFixed(1)}k ft
            </p>
          </div>
          <div>
            <strong>Heading:</strong>
            <p className="text-lg font-mono text-green-300">{selectedAircraft.heading.toFixed(0)}°</p>
          </div>
          <div>
            <strong>Speed:</strong>
            <p className="text-lg font-mono text-cyan-300">
              {(selectedAircraft.velocity * 1.944).toFixed(0)} kts
            </p>
          </div>
          <div>
            <strong>V/S:</strong>
            <p className="text-lg font-mono text-orange-300">
              {(selectedAircraft.verticalRate * 196.85).toFixed(0)} fpm
            </p>
          </div>
        </div>

        <hr className="border-gray-600" />

        <div>
          <strong>Status:</strong>
          <p className={`text-sm ${selectedAircraft.onGround ? 'text-red-400' : 'text-green-400'}`}>
            {selectedAircraft.onGround ? '🛬 On Ground' : '✈️ Airborne'}
          </p>
        </div>

        <hr className="border-gray-600" />

        <button className="w-full bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded text-xs mt-2">
          Contact {selectedAircraft.callsign}
        </button>
      </div>
    </div>
  );
}
