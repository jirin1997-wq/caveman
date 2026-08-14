'use client';

import { useEffect, useState } from 'react';
import { useATCStore } from './store';
import RadarMap from './components/RadarMap';
import RadioPanel from './components/RadioPanel';
import InfoPanel from './components/InfoPanel';

export default function Home() {
  const [ws, setWs] = useState(null);
  const [connected, setConnected] = useState(false);
  const { setAircraft, setAirport, setFrequencies, addRadioMessage, userCallsign, setUserCallsign, setUserRole } = useATCStore();

  useEffect(() => {
    // Connect to WebSocket server
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.hostname}:3001`;

    try {
      const websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
        console.log('Connected to ATC server');
        setConnected(true);
      };

      websocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnected(false);
      };

      websocket.onclose = () => {
        console.log('Disconnected from server');
        setConnected(false);
      };

      setWs(websocket);

      return () => {
        websocket.close();
      };
    } catch (error) {
      console.error('Failed to connect:', error);
    }
  }, []);

  const handleServerMessage = (data) => {
    switch (data.type) {
      case 'INIT':
        setAirport(data.airport);
        setFrequencies(data.airport.frequencies);
        setAircraft(data.aircraft);
        break;

      case 'UPDATE_AIRCRAFT':
        setAircraft(data.aircraft);
        break;

      case 'RADIO_MESSAGE':
        addRadioMessage(data.message);
        break;

      case 'CHANNELS_INFO':
        // Handle channels update
        break;
    }
  };

  const handleRadioTransmit = (text) => {
    if (!ws || !connected) return;

    const activeFrequency = useATCStore.getState().activeFrequency;
    const callsign = userCallsign || 'UNKNOWN';

    ws.send(JSON.stringify({
      type: 'RADIO_TRANSMIT',
      callsign: `${callsign}:${useATCStore.getState().userRole}`,
      frequency: activeFrequency,
      text
    }));
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 p-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <h1 className="text-2xl font-bold">🛩️ ATC Radio - LKPR (Prague)</h1>
          <div className="flex gap-4 items-center">
            <div className={`px-3 py-1 rounded ${connected ? 'bg-green-500' : 'bg-red-500'}`}>
              {connected ? '● Live' : '● Offline'}
            </div>
            <input
              type="text"
              placeholder="Your Callsign"
              value={userCallsign}
              onChange={(e) => setUserCallsign(e.target.value)}
              className="px-3 py-2 bg-gray-700 rounded text-white placeholder-gray-400"
            />
            <select onChange={(e) => setUserRole(e.target.value)} className="px-3 py-2 bg-gray-700 rounded text-white">
              <option value="observer">Observer</option>
              <option value="pilot">Pilot</option>
              <option value="atc">ATC</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-7xl mx-auto p-4 grid grid-cols-3 gap-4 h-[calc(100vh-80px)]">
        {/* Radar map */}
        <div className="col-span-2 bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <RadarMap />
        </div>

        {/* Right panel */}
        <div className="flex flex-col gap-4">
          {/* Radio panel */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 flex-1 flex flex-col">
            <RadioPanel onTransmit={handleRadioTransmit} />
          </div>

          {/* Info panel */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 flex-1 overflow-y-auto">
            <InfoPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
