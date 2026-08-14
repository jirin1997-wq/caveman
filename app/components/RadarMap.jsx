'use client';

import { useEffect, useRef } from 'react';
import { useATCStore } from '../store';

export default function RadarMap() {
  const canvasRef = useRef(null);
  const { aircraft, airport, selectedAircraft, selectAircraft } = useATCStore();

  useEffect(() => {
    if (!canvasRef.current || !airport) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const pixelRatio = window.devicePixelRatio || 1;

    canvas.width = rect.width * pixelRatio;
    canvas.height = rect.height * pixelRatio;
    ctx.scale(pixelRatio, pixelRatio);

    const width = rect.width;
    const height = rect.height;
    const centerX = width / 2;
    const centerY = height / 2;

    // Clear canvas
    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, 0, width, height);

    // Draw radar circles
    ctx.strokeStyle = '#2d5016';
    ctx.lineWidth = 1;
    for (let r = 10; r <= 100; r += 20) {
      const radius = (r / 100) * Math.min(width, height) * 0.4;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw cardinal directions
    ctx.fillStyle = '#4d7f2d';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const directions = [
      { text: 'N', angle: 0 },
      { text: 'E', angle: Math.PI / 2 },
      { text: 'S', angle: Math.PI },
      { text: 'W', angle: (3 * Math.PI) / 2 },
    ];

    directions.forEach(({ text, angle }) => {
      const x = centerX + Math.sin(angle) * 110;
      const y = centerY - Math.cos(angle) * 110;
      ctx.fillText(text, x, y);
    });

    // Draw airport
    ctx.fillStyle = '#ff9900';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffccaa';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(airport.code, centerX + 10, centerY - 5);

    // Draw aircraft
    const scale = (Math.min(width, height) * 0.4) / 100; // Scale degrees to pixels

    aircraft.forEach((ac) => {
      const dx = (ac.position.lng - airport.coordinates.lng) * scale * 111; // longitude to km
      const dy = (airport.coordinates.lat - ac.position.lat) * scale * 111; // latitude to km

      const x = centerX + dx;
      const y = centerY + dy;

      // Skip if out of bounds
      if (x < 0 || x > width || y < 0 || y > height) return;

      // Draw aircraft
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((ac.heading * Math.PI) / 180);

      const isSelected = selectedAircraft?.id === ac.id;

      // Aircraft symbol
      ctx.fillStyle = ac.color || '#4d96ff';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(-3, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(3, 6);
      ctx.closePath();
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 10, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();

      // Callsign label
      ctx.fillStyle = isSelected ? '#ffff00' : '#cccccc';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(ac.callsign, x, y + 15);

      // Altitude label
      ctx.fillStyle = '#999999';
      ctx.font = '9px monospace';
      ctx.fillText(`${(ac.altitude / 1000).toFixed(1)}k`, x, y + 25);
    });

    // Draw center crosshair
    ctx.strokeStyle = '#2d5016';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX - 10, centerY);
    ctx.lineTo(centerX + 10, centerY);
    ctx.moveTo(centerX, centerY - 10);
    ctx.lineTo(centerX, centerY + 10);
    ctx.stroke();
  }, [aircraft, airport, selectedAircraft]);

  const handleCanvasClick = (e) => {
    if (!canvasRef.current || !airport) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Find clicked aircraft
    for (const ac of aircraft) {
      const dx = (ac.position.lng - airport.coordinates.lng) * 111;
      const dy = (airport.coordinates.lat - ac.position.lat) * 111;

      const scale = (Math.min(rect.width, rect.height) * 0.4) / 100;
      const screenX = rect.width / 2 + dx * scale;
      const screenY = rect.height / 2 + dy * scale;

      const distance = Math.sqrt((x - screenX) ** 2 + (y - screenY) ** 2);
      if (distance < 15) {
        selectAircraft(ac);
        return;
      }
    }

    selectAircraft(null);
  };

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-1 bg-black rounded cursor-crosshair">
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          className="w-full h-full"
        />
      </div>
      <div className="p-2 text-xs text-gray-400 border-t border-gray-700">
        {aircraft.length} aircraft in range | Click to select | N=Up, S=Down
      </div>
    </div>
  );
}
