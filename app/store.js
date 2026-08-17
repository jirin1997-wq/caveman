import { create } from 'zustand';

export const useATCStore = create((set) => ({
  // airports
  airports: [],
  airport: null,

  // live traffic — `live` false means no source answered, NOT "nothing flying"
  aircraft: [],
  trafficLive: false,
  trafficSource: null,
  trafficErrors: [],
  selectedAircraft: null,

  // LiveATC feeds discovered for the current airport
  feeds: [],
  feedsAvailable: false,
  feedsError: null,
  activeFeed: null,

  // user-to-user radio (not ATC)
  radioMessages: [],
  userCallsign: '',
  userRole: 'pilot',

  setAirports: (airports) => set({ airports }),
  setAirport: (airport) => set({ airport, selectedAircraft: null }),
  setTraffic: ({ aircraft, live, source, errors }) =>
    set({
      aircraft: aircraft || [],
      trafficLive: !!live,
      trafficSource: source || null,
      trafficErrors: errors || [],
    }),
  selectAircraft: (a) => set({ selectedAircraft: a }),
  setFeeds: ({ feeds, available, error }) =>
    set({
      feeds: feeds || [],
      feedsAvailable: !!available,
      feedsError: error || null,
      activeFeed: (feeds && feeds[0]) || null,
    }),
  setActiveFeed: (feed) => set({ activeFeed: feed }),
  addRadioMessage: (m) => set((s) => ({ radioMessages: [...s.radioMessages, m].slice(-80) })),
  setRadioMessages: (radioMessages) => set({ radioMessages }),
  setUserCallsign: (userCallsign) => set({ userCallsign }),
  setUserRole: (userRole) => set({ userRole }),
}));
