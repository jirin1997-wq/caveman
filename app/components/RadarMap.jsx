'use client';

import { useEffect, useRef } from 'react';
import { useATCStore } from '../store';

const RANGE_KM = 90; // radius drawn from the airport to the edge of the scope

export default function RadarMap() {
  const canvasRef = useRef(null);
  const { aircraft, airport, trafficLive, trafficErrors, selectedAircraft, selectAircraft } =
    useATCStore();

  // Convert lat/lon to canvas pixels. Longitude degrees shrink with latitude.
  const project = (ac, airportRef, w, h) => {
    const kmPerDegLat = 111.32;
    const kmPerDegLon = 111.32 * Math.cos((airportRef.lat * Math.PI) / 180);
    const dx = (ac.position.lng - airportRef.lon) * kmPerDegLon;
    const dy = (airportRef.lat - ac.position.lat) * kmPerDegLat;
    const pxPerKm = (Math.min(w, h) * 0.46) / RANGE_KM;
    return { x: w / 2 + dx * pxPerKm, y: h / 2 + dy * pxPerKm };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !airport) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = rect.width;
    const h = rect.height;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(w, h) * 0.46;

    ctx.fillStyle = '#080c08';
    ctx.fillRect(0, 0, w, h);

    // range rings every 30 km
    ctx.strokeStyle = '#1e3a1e';
    ctx.fillStyle = '#2f5d2f';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    for (let km = 30; km <= RANGE_KM; km += 30) {
      const r = (km / RANGE_KM) * maxR;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(`${km}km`, cx, cy - r + 11);
    }

    // cardinals
    ctx.fillStyle = '#3f7f3f';
    ctx.font = 'bold 11px monospace';
    ctx.textBaseline = 'middle';
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([label, deg]) => {
      const rad = (deg * Math.PI) / 180;
      ctx.fillText(label, cx + Math.sin(rad) * (maxR + 12), cy - Math.cos(rad) * (maxR + 12));
    });

    // airport
    ctx.fillStyle = '#ff9900';
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(airport.icao, cx + 8, cy - 6);

    // traffic
    aircraft.forEach((ac) => {
      const { x, y } = project(ac, airport, w, h);
      if (x < -20 || x > w + 20 || y < -20 || y > h + 20) return;

      const selected = selectedAircraft?.id === ac.id;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((ac.heading * Math.PI) / 180);
      ctx.fillStyle = ac.color || '#4d96ff';
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(-4, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(4, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      if (selected) {
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.textAlign = 'center';
      ctx.fillStyle = selected ? '#ffff00' : '#d8d8d8';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(ac.callsign, x, y + 18);
      ctx.fillStyle = '#8a8a8a';
      ctx.font = '9px monospace';
      ctx.fillText(`${Math.round(ac.altitude / 100)} · ${Math.round(ac.velocity)}kt`, x, y + 28);
    });
  }, [aircraft, airport, selectedAircraft]);

  const onClick = (e) => {
    const canvas = canvasRef.current;
    if (!canvas || !airport) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let best = null;
    let bestDist = 18;
    aircraft.forEach((ac) => {
      const { x, y } = project(ac, airport, rect.width, rect.height);
      const d = Math.hypot(mx - x, my - y);
      if (d < bestDist) {
        bestDist = d;
        best = ac;
      }
    });
    selectAircraft(best);
  };

  return (
    <div className="w-full h-full flex flex-col relative">
      <canvas ref={canvasRef} onClick={onClick} className="flex-1 w-full cursor-crosshair" />

      {!trafficLive && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/80 border border-yellow-700 rounded-lg px-5 py-4 max-w-md text-center">
            <p className="text-yellow-300 font-bold mb-1">Žádná živá data o provozu</p>
            <p className="text-xs text-gray-300 mb-2">
              Nezobrazuju vymyšlená letadla — prázdný radar je pravdivější.
            </p>
            {trafficErrors?.length > 0 && (
              <ul className="text-[10px] text-gray-500 font-mono text-left">
                {trafficErrors.map((e) => (
                  <li key={e}>· {e}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="px-3 py-1.5 text-xs text-gray-400 border-t border-gray-700 flex justify-between">
        <span>
          {aircraft.length} letadel · dosah {RANGE_KM} km
        </span>
        <span>štítek: FL · rychlost</span>
      </div>
    </div>
  );
}
