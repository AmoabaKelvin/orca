import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { ITheme } from '@xterm/xterm'
import { parseGhosttyTheme, themeNameFromFilename } from '@/lib/terminal-themes/ghostty-parser'
import { setImportedTerminalThemes } from '@/lib/terminal-themes-data'

export type ImportedTerminalThemeLoadResult = {
  /** Map of display name -> ITheme, in the order the files were read. */
  themes: Record<string, ITheme>
  /** Files that failed to read at the OS level. */
  readErrors: { filename: string; message: string }[]
  /** Files that read fine but produced parser warnings (non-fatal). */
  parseWarnings: { filename: string; messages: string[] }[]
  /** True if the configured directory did not exist or was not a directory. */
  invalidDirectory: boolean
  /** Empty string when import is disabled. */
  sourcePath: string
}

const EMPTY_RESULT: ImportedTerminalThemeLoadResult = {
  themes: {},
  readErrors: [],
  parseWarnings: [],
  invalidDirectory: false,
  sourcePath: ''
}

export type TerminalThemeImportsSlice = {
  importedTerminalThemes: ImportedTerminalThemeLoadResult
  /** Load themes from the current `settings.terminalCustomThemesDirectory`.
   *  Called on boot (once settings are hydrated) and whenever the path
   *  changes. Clears results when the path is empty. */
  refreshImportedTerminalThemes: () => Promise<void>
}

export const createTerminalThemeImportsSlice: StateCreator<
  AppState,
  [],
  [],
  TerminalThemeImportsSlice
> = (set, get) => ({
  importedTerminalThemes: EMPTY_RESULT,

  refreshImportedTerminalThemes: async () => {
    const path = get().settings?.terminalCustomThemesDirectory?.trim() ?? ''
    if (path.length === 0) {
      setImportedTerminalThemes({})
      // Preserve referential equality when nothing changed to avoid rerenders.
      if (get().importedTerminalThemes === EMPTY_RESULT) {
        return
      }
      set({ importedTerminalThemes: EMPTY_RESULT })
      return
    }

    let result: Awaited<ReturnType<typeof window.api.terminalThemes.loadDirectory>>
    try {
      result = await window.api.terminalThemes.loadDirectory(path)
    } catch (err) {
      console.error('Failed to load custom terminal themes:', err)
      setImportedTerminalThemes({})
      set({
        importedTerminalThemes: {
          themes: {},
          readErrors: [{ filename: '', message: err instanceof Error ? err.message : String(err) }],
          parseWarnings: [],
          invalidDirectory: false,
          sourcePath: path
        }
      })
      return
    }

    if (result.invalid) {
      setImportedTerminalThemes({})
      set({
        importedTerminalThemes: {
          themes: {},
          readErrors: [],
          parseWarnings: [],
          invalidDirectory: true,
          sourcePath: path
        }
      })
      return
    }

    const themes: Record<string, ITheme> = {}
    const parseWarnings: { filename: string; messages: string[] }[] = []
    const seenNames = new Set<string>()
    for (const entry of result.themes) {
      const parsed = parseGhosttyTheme(entry.contents)
      if (Object.keys(parsed.theme).length === 0) {
        // Skip files that produced no usable colors — likely not themes.
        continue
      }
      let name = themeNameFromFilename(entry.filename)
      // Why: collisions are possible when the import dir and the bundled
      // catalog share a theme name (e.g. "Dracula"). Suffix on collision so
      // both remain selectable, and record the resolved name for the UI.
      if (seenNames.has(name)) {
        let suffix = 2
        let candidate = `${name} (${suffix})`
        while (seenNames.has(candidate)) {
          suffix += 1
          candidate = `${name} (${suffix})`
        }
        name = candidate
      }
      seenNames.add(name)
      themes[name] = parsed.theme
      if (parsed.warnings.length > 0) {
        parseWarnings.push({ filename: entry.filename, messages: parsed.warnings })
      }
    }

    setImportedTerminalThemes(themes)
    set({
      importedTerminalThemes: {
        themes,
        readErrors: result.readErrors,
        parseWarnings,
        invalidDirectory: false,
        sourcePath: path
      }
    })
  }
})
