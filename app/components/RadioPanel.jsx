'use client';

import { useState, useRef, useEffect } from 'react';
import { useATCStore } from '../store';

export default function RadioPanel({ onTransmit }) {
  const [message, setMessage] = useState('');
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [audioStream, setAudioStream] = useState(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const audioRef = useRef(null);

  const { activeFrequency, frequencies, radioMessages, setActiveFrequency, userCallsign, userRole } = useATCStore();

  // LiveATC stream URLs for Prague (multiple sources for redundancy)
  const liveATC = {
    118.1: {
      name: 'Tower',
      streams: [
        'https://prd-sto-liveatc.cdnstream1.com/lkpr_twr',
        'https://fra-ah.stream.liveradio.cz:8000/lkpr_twr.mp3'
      ]
    },
    121.85: {
      name: 'Delivery',
      streams: [
        'https://prd-sto-liveatc.cdnstream1.com/lkpr_del'
      ]
    },
    121.9: {
      name: 'Ground',
      streams: [
        'https://prd-sto-liveatc.cdnstream1.com/lkpr_gnd'
      ]
    },
    120.1: {
      name: 'Approach',
      streams: [
        'https://prd-sto-liveatc.cdnstream1.com/lkpr_app'
      ]
    }
  };

  useEffect(() => {
    // Try to load LiveATC stream
    if (liveATC[activeFrequency]) {
      loadAudioStream(activeFrequency);
    }
  }, [activeFrequency]);

  const loadAudioStream = (freq) => {
    const stream = liveATC[freq];
    if (!stream) return;

    if (audioRef.current) {
      // Try primary stream first
      audioRef.current.src = stream.streams[0];

      // Handle error by trying fallback streams
      audioRef.current.onerror = () => {
        console.log(`Primary stream failed for ${freq}, trying fallback...`);
        if (stream.streams.length > 1) {
          audioRef.current.src = stream.streams[1];
        }
      };
    }

    console.log(`Loaded stream for ${freq} MHz (${stream.name})`);
  };

  const toggleAudio = async () => {
    if (!audioRef.current) return;

    if (audioPlaying) {
      audioRef.current.pause();
      setAudioPlaying(false);
    } else {
      try {
        // Attempt to play - requires proper CORS setup
        await audioRef.current.play();
        setAudioPlaying(true);
      } catch (error) {
        console.error('Audio playback error:', error);
      }
    }
  };

  const handleTransmit = (e) => {
    e.preventDefault();
    if (!message.trim() || !userCallsign) return;

    setIsTransmitting(true);

    // Simulate speech duration
    const words = message.split(' ').length;
    const duration = Math.max(2, Math.ceil(words / 2.5)) * 1000;

    onTransmit(message);
    setMessage('');

    setTimeout(() => {
      setIsTransmitting(false);
    }, duration);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Frequency selector */}
      <div className="mb-4">
        <h3 className="text-sm font-semibold mb-2 text-gray-300">Active Frequency</h3>
        <select
          value={activeFrequency}
          onChange={(e) => setActiveFrequency(parseFloat(e.target.value))}
          className="w-full px-3 py-2 bg-gray-700 rounded text-white font-mono"
        >
          {Object.entries(frequencies).map(([name, freq]) => (
            <option key={freq} value={freq}>
              {freq} MHz - {name}
            </option>
          ))}
        </select>
      </div>

      {/* Audio player */}
      <div className="mb-4 p-3 bg-gray-700 rounded">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold">🎙️ Live ATC Audio</h4>
          <button
            onClick={toggleAudio}
            className={`px-3 py-1 rounded text-sm font-bold ${
              audioPlaying
                ? 'bg-red-600 hover:bg-red-700 animate-pulse'
                : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {audioPlaying ? '⏹ STOP' : '▶ LIVE'}
          </button>
        </div>
        <audio
          ref={audioRef}
          crossOrigin="anonymous"
          className="w-full text-xs"
        />
        <div className="text-xs mt-2 space-y-1">
          <p className={`font-semibold ${audioPlaying ? 'text-red-300 animate-pulse' : 'text-green-300'}`}>
            {audioPlaying ? '● LIVE - Recording ATC traffic' : '○ Ready to stream'}
          </p>
          <p className="text-gray-400">
            {liveATC[activeFrequency]?.name || 'Unknown Frequency'}
            {' - '}
            {activeFrequency} MHz
          </p>
        </div>
      </div>

      {/* Message input */}
      <form onSubmit={handleTransmit} className="mb-4">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={isTransmitting || !userCallsign}
          placeholder={userCallsign ? 'Type your transmission...' : 'Enter callsign first'}
          className="w-full px-3 py-2 bg-gray-700 rounded text-white text-sm resize-none placeholder-gray-500 disabled:opacity-50"
          rows="3"
        />
        <button
          type="submit"
          disabled={isTransmitting || !userCallsign || !message.trim()}
          className="w-full mt-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isTransmitting ? '📡 Transmitting...' : '📡 Transmit'}
        </button>
      </form>

      {/* Messages log */}
      <div className="flex-1 overflow-y-auto bg-gray-700 rounded p-2">
        <h4 className="text-sm font-semibold mb-2 sticky top-0 bg-gray-700">Radio Log</h4>
        <div className="space-y-1">
          {radioMessages.length === 0 ? (
            <p className="text-xs text-gray-400">Waiting for transmissions...</p>
          ) : (
            radioMessages.map((msg) => (
              <div
                key={msg.id}
                className={`text-xs p-1 rounded ${
                  msg.role === 'atc' ? 'bg-blue-900 text-blue-200' : 'bg-green-900 text-green-200'
                }`}
              >
                <strong>{msg.callsign}:</strong> {msg.text}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
