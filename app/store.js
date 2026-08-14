import { create } from 'zustand';

export const useATCStore = create((set, get) => ({
  // Airport and aircraft data
  airport: null,
  aircraft: [],
  selectedAircraft: null,

  // Radio system
  activeFrequency: 118.1, // Tower frequency
  frequencies: {},
  radioMessages: [],
  channels: [],

  // UI state
  userCallsign: '',
  userRole: 'observer', // 'pilot', 'atc', 'observer'
  mapZoom: 12,

  // Actions
  setAirport: (airport) => set({ airport }),
  setAircraft: (aircraft) => set({ aircraft }),
  selectAircraft: (aircraft) => set({ selectedAircraft: aircraft }),
  setActiveFrequency: (freq) => set({ activeFrequency: freq }),
  setUserCallsign: (callsign) => set({ userCallsign: callsign }),
  setUserRole: (role) => set({ userRole: role }),
  addRadioMessage: (message) => set((state) => ({
    radioMessages: [...state.radioMessages, message].slice(-50)
  })),
  setChannels: (channels) => set({ channels }),
  setFrequencies: (frequencies) => set({ frequencies }),
  clearRadioMessages: () => set({ radioMessages: [] }),
}));
