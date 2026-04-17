import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { GlobalSettings } from '../../../../shared/types'

export type SettingsSlice = {
  settings: GlobalSettings | null
  settingsSearchQuery: string
  setSettingsSearchQuery: (q: string) => void
  fetchSettings: () => Promise<void>
  updateSettings: (updates: Partial<GlobalSettings>) => Promise<void>
}

export const createSettingsSlice: StateCreator<AppState, [], [], SettingsSlice> = (set, get) => ({
  settings: null,
  settingsSearchQuery: '',
  setSettingsSearchQuery: (q) => set({ settingsSearchQuery: q }),

  fetchSettings: async () => {
    try {
      const settings = await window.api.settings.get()
      set({ settings })
      // Why: custom themes are loaded from a path stored in settings, so the
      // picker only knows the full catalog after settings are hydrated. Fire
      // the import refresh here so the first render already has the combined
      // list available.
      void get().refreshImportedTerminalThemes?.()
    } catch (err) {
      console.error('Failed to fetch settings:', err)
    }
  },

  updateSettings: async (updates) => {
    try {
      await window.api.settings.set(updates)
      set((s) => ({
        settings: s.settings
          ? {
              ...s.settings,
              ...updates,
              notifications: {
                ...s.settings.notifications,
                ...updates.notifications
              }
            }
          : null
      }))
      // Why: re-run the import when the custom-themes path changes so added
      // or removed directories reflect in the picker immediately.
      if (Object.prototype.hasOwnProperty.call(updates, 'terminalCustomThemesDirectory')) {
        void get().refreshImportedTerminalThemes?.()
      }
    } catch (err) {
      console.error('Failed to update settings:', err)
    }
  }
})
