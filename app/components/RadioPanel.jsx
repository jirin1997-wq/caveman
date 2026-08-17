'use client';

import { useEffect, useRef, useState } from 'react';
import { useATCStore } from '../store';

export default function RadioPanel({ api, onTransmit }) {
  const audioRef = useRef(null);
  const logRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [audioError, setAudioError] = useState(null);
  const [text, setText] = useState('');

  const {
    airport,
    positions,
    feedsAvailable,
    feedsError,
    activeFeed,
    setActiveFeed,
    radioMessages,
    userCallsign,
  } = useATCStore();

  const activePosition = positions.find((p) =>
    p.feeds.some((f) => f.id === activeFeed?.id)
  );

  // stop audio when the feed or airport changes
  useEffect(() => {
    setPlaying(false);
    setAudioError(null);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }
  }, [activeFeed, airport]);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [radioMessages]);

  const toggleAudio = async () => {
    const el = audioRef.current;
    if (!el || !activeFeed) return;

    if (playing) {
      el.pause();
      el.removeAttribute('src');
      el.load();
      setPlaying(false);
      return;
    }

    setAudioError(null);
    // The server proxies LiveATC — the browser only ever talks to localhost.
    el.src = `${api}/api/stream/${encodeURIComponent(activeFeed.id)}`;
    try {
      await el.play();
      setPlaying(true);
    } catch (err) {
      setAudioError(err.message || 'přehrávání selhalo');
      setPlaying(false);
    }
  };

  const send = (e) => {
    e.preventDefault();
    if (!text.trim() || !userCallsign) return;
    onTransmit(text.trim(), activeFeed?.id || airport?.icao || 'general');
    setText('');
  };

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      {/* --- live ATC audio --- */}
      <div className="bg-gray-700/60 rounded p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">🎧 Živé ATC (LiveATC.net)</h3>
          <button
            onClick={toggleAudio}
            disabled={!activeFeed}
            className={`px-3 py-1 rounded text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed ${
              playing ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {playing ? '⏹ stop' : '▶ poslouchat'}
          </button>
        </div>

        {feedsAvailable ? (
          <>
            {/* One button per ATC position that this airport actually has a
                feed for. Positions with no feed are not shown at all. */}
            <div className="flex flex-wrap gap-1 mb-2">
              {positions.map((pos) => {
                const active = activePosition?.key === pos.key;
                return (
                  <button
                    key={pos.key}
                    onClick={() => setActiveFeed(pos.feeds[0])}
                    title={pos.hint}
                    className={`px-2 py-1 rounded text-[11px] font-semibold transition ${
                      active ? 'bg-blue-600' : 'bg-gray-800 hover:bg-gray-600'
                    }`}
                  >
                    {pos.label}
                    {pos.feeds.length > 1 && (
                      <span className="opacity-60"> ×{pos.feeds.length}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {activePosition?.hint && (
              <p className="text-[10px] text-gray-400 mb-1.5">{activePosition.hint}</p>
            )}

            {/* If a position has several feeds (e.g. Tower North / South) */}
            {activePosition && activePosition.feeds.length > 1 && (
              <select
                value={activeFeed?.id || ''}
                onChange={(e) =>
                  setActiveFeed(activePosition.feeds.find((f) => f.id === e.target.value))
                }
                className="w-full bg-gray-800 rounded px-2 py-1.5 text-xs mb-1"
              >
                {activePosition.feeds.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            )}

            <p className="text-[10px] text-gray-500 font-mono">{activeFeed?.id}</p>
          </>
        ) : (
          <p className="text-xs text-yellow-300">
            {feedsError
              ? `LiveATC nedostupné: ${feedsError}`
              : `Pro ${airport?.icao || 'toto letiště'} LiveATC nenabízí žádný feed.`}
          </p>
        )}

        <audio ref={audioRef} onError={() => setAudioError('stream se nepodařilo otevřít')} />

        <p className="text-xs mt-2 text-gray-300">
          {playing ? '● vysílá se živý zvuk' : audioError ? `⚠ ${audioError}` : '○ zastaveno'}
        </p>
      </div>

      {/* --- user-to-user radio --- */}
      <div className="flex-1 min-h-0 flex flex-col">
        <h3 className="text-sm font-semibold mb-1">
          💬 Rádio mezi uživateli
          <span className="ml-2 text-[10px] font-normal text-gray-400 uppercase tracking-wide">
            není ATC — píší sem lidé připojení k tomuhle serveru
          </span>
        </h3>

        <div ref={logRef} className="flex-1 min-h-0 overflow-y-auto bg-gray-700/40 rounded p-2 space-y-1">
          {radioMessages.length === 0 ? (
            <p className="text-xs text-gray-400">Zatím nikdo nic neposlal.</p>
          ) : (
            radioMessages.map((m) => (
              <div
                key={m.id}
                className={`text-xs px-2 py-1 rounded ${
                  m.role === 'atc' ? 'bg-blue-900/70 text-blue-100' : 'bg-green-900/70 text-green-100'
                }`}
              >
                <span className="font-bold font-mono">{m.callsign}</span>{' '}
                <span className="opacity-60">[{m.role}]</span> {m.text}
              </div>
            ))
          )}
        </div>

        <form onSubmit={send} className="mt-2 flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!userCallsign}
            placeholder={userCallsign ? 'zpráva…' : 'nejdřív zadej callsign'}
            className="flex-1 bg-gray-700 rounded px-3 py-2 text-sm placeholder-gray-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!userCallsign || !text.trim()}
            className="px-4 bg-blue-600 hover:bg-blue-700 rounded text-sm font-semibold disabled:opacity-40"
          >
            📡
          </button>
        </form>
      </div>
    </div>
  );
}
