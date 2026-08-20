'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useATCStore } from './store';
import RadarMap from './components/RadarMap';
import RadioPanel from './components/RadioPanel';
import InfoPanel from './components/InfoPanel';
import MovementBoard from './components/MovementBoard';

const API = process.env.NEXT_PUBLIC_API || 'http://localhost:3001';

export default function Home() {
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);

  const {
    airports,
    airport,
    trafficLive,
    trafficSource,
    setAirports,
    setAirport,
    setTraffic,
    setFeeds,
    addRadioMessage,
    userCallsign,
    setUserCallsign,
    userRole,
    setUserRole,
  } = useATCStore();

  // --- websocket ---
  useEffect(() => {
    const url = API.replace(/^http/, 'ws');
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.type === 'INIT') {
        setAirports(data.airports);
        setAirport(data.airport);
      } else if (data.type === 'AIRPORT_CHANGED') {
        setAirport(data.airport);
      } else if (data.type === 'TRAFFIC') {
        setTraffic(data);
      } else if (data.type === 'RADIO_MESSAGE') {
        addRadioMessage(data.message);
      }
    };

    return () => ws.close();
  }, [setAirports, setAirport, setTraffic, addRadioMessage]);

  // --- discover LiveATC feeds whenever the airport changes ---
  useEffect(() => {
    if (!airport) return;
    let cancelled = false;
    setFeeds({ feeds: [], available: false, error: null });

    fetch(`${API}/api/feeds/${airport.icao}`)
      .then((r) => r.json())
      .then((d) => !cancelled && setFeeds(d))
      .catch((e) => !cancelled && setFeeds({ feeds: [], available: false, error: String(e) }));

    return () => {
      cancelled = true;
    };
  }, [airport, setFeeds]);

  const changeAirport = useCallback((icao) => {
    wsRef.current?.send(JSON.stringify({ type: 'SET_AIRPORT', icao }));
  }, []);

  const transmit = useCallback(
    (text, channel) => {
      wsRef.current?.send(
        JSON.stringify({
          type: 'RADIO_TRANSMIT',
          callsign: userCallsign,
          role: userRole,
          channel,
          text,
        })
      );
    },
    [userCallsign, userRole]
  );

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-3">
        <div className="mx-auto max-w-[1600px] flex flex-wrap gap-3 items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold">🛩️ ATC Live</h1>
            <select
              value={airport?.icao || ''}
              onChange={(e) => changeAirport(e.target.value)}
              className="bg-gray-700 rounded px-3 py-1.5 text-sm"
            >
              {airports.map((a) => (
                <option key={a.icao} value={a.icao}>
                  {a.icao} — {a.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <span className={`px-2 py-1 rounded ${connected ? 'bg-green-700' : 'bg-red-700'}`}>
              {connected ? 'server ●' : 'server ○'}
            </span>
            <span
              className={`px-2 py-1 rounded ${trafficLive ? 'bg-green-700' : 'bg-yellow-800'}`}
              title={trafficLive ? `zdroj: ${trafficSource}` : 'žádný zdroj neodpověděl'}
            >
              {trafficLive ? `provoz ● ${trafficSource}` : 'provoz ○ bez dat'}
            </span>
            <input
              value={userCallsign}
              onChange={(e) => setUserCallsign(e.target.value.toUpperCase())}
              placeholder="tvůj callsign"
              className="bg-gray-700 rounded px-3 py-1.5 w-36 placeholder-gray-400"
            />
            <select
              value={userRole}
              onChange={(e) => setUserRole(e.target.value)}
              className="bg-gray-700 rounded px-3 py-1.5"
            >
              <option value="pilot">pilot</option>
              <option value="atc">ATC</option>
            </select>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto max-w-[1700px] w-full p-4 grid grid-cols-1 lg:grid-cols-4 gap-4 min-h-0">
        <section className="lg:col-span-2 bg-gray-800 rounded-lg border border-gray-700 overflow-hidden min-h-[420px]">
          <RadarMap />
        </section>

        <section className="flex flex-col gap-4 min-h-0">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-3 flex-1 min-h-0 flex flex-col">
            <MovementBoard />
          </div>
        </section>

        <section className="flex flex-col gap-4 min-h-0">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-3 flex-[3] min-h-0 flex flex-col">
            <RadioPanel api={API} onTransmit={transmit} />
          </div>
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-3 flex-[4] min-h-0 overflow-y-auto">
            <InfoPanel api={API} />
          </div>
        </section>
      </main>
    </div>
  );
}
