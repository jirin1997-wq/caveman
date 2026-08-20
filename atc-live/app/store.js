import { create } from 'zustand';

export const useATCStore = create((set) => ({
  // airports
  airports: [],
  airport: null,

  // live traffic — `live` false means no source answered, NOT "nothing flying"
  aircraft: [],
  board: null, // { arriving, departing, ground, transit }
  trafficLive: false,
  trafficSource: null,
  trafficErrors: [],
  selectedAircraft: null,

  // LiveATC feeds discovered for the current airport, grouped into positions
  feeds: [],
  positions: [], // [{ key, label, hint, feeds }]
  feedsAvailable: false,
  feedsError: null,
  activeFeed: null,

  // user-to-user radio (not ATC)
  radioMessages: [],
  userCallsign: '',
  userRole: 'pilot',

  setAirports: (airports) => set({ airports }),
  setAirport: (airport) => set({ airport, selectedAircraft: null }),
  setTraffic: ({ aircraft, board, live, source, errors }) =>
    set((s) => {
      const list = aircraft || [];
      // keep the open detail panel in sync with the newest position report
      const stillThere = s.selectedAircraft
        ? board?.all?.find((a) => a.id === s.selectedAircraft.id) ||
          list.find((a) => a.id === s.selectedAircraft.id) ||
          null
        : null;
      return {
        aircraft: list,
        board: board || null,
        trafficLive: !!live,
        trafficSource: source || null,
        trafficErrors: errors || [],
        selectedAircraft: stillThere,
      };
    }),
  selectAircraft: (a) => set({ selectedAircraft: a }),
  setFeeds: ({ feeds, positions, available, error }) =>
    set({
      feeds: feeds || [],
      positions: positions || [],
      feedsAvailable: !!available,
      feedsError: error || null,
      activeFeed: (positions && positions[0]?.feeds?.[0]) || (feeds && feeds[0]) || null,
    }),
  setActiveFeed: (feed) => set({ activeFeed: feed }),
  addRadioMessage: (m) => set((s) => ({ radioMessages: [...s.radioMessages, m].slice(-80) })),
  setRadioMessages: (radioMessages) => set({ radioMessages }),
  setUserCallsign: (userCallsign) => set({ userCallsign }),
  setUserRole: (userRole) => set({ userRole }),
}));
