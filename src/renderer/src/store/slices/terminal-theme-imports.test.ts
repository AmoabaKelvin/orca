import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createStore } from 'zustand/vanilla'
import type { AppState } from '../types'
import { createTerminalThemeImportsSlice } from './terminal-theme-imports'
import { getTheme, getThemeNames, setImportedTerminalThemes } from '@/lib/terminal-themes-data'

type LoadResult = {
  themes: { filename: string; contents: string }[]
  readErrors: { filename: string; message: string }[]
  invalid: boolean
}

const settingsState: { terminalCustomThemesDirectory: string } = {
  terminalCustomThemesDirectory: ''
}

function mockLoadDirectory(result: LoadResult): void {
  ;(globalThis as unknown as { window: { api: unknown } }).window = {
    api: {
      terminalThemes: {
        loadDirectory: vi.fn().mockResolvedValue(result)
      }
    }
  }
}

function createTestStore() {
  // Why: this slice only reads `settings.terminalCustomThemesDirectory` and
  // writes its own fields, so a narrow partial state keeps the test focused
  // without pulling in every other slice's dependency graph. Cast through
  // unknown because we intentionally do not satisfy AppState here.
  return createStore<AppState>()(
    (...a) =>
      ({
        ...createTerminalThemeImportsSlice(...a),
        settings: {
          terminalCustomThemesDirectory: settingsState.terminalCustomThemesDirectory
        }
      }) as unknown as AppState
  )
}

describe('createTerminalThemeImportsSlice', () => {
  beforeEach(() => {
    settingsState.terminalCustomThemesDirectory = ''
    setImportedTerminalThemes({})
  })

  afterEach(() => {
    setImportedTerminalThemes({})
  })

  it('clears imported themes when the configured directory is empty', async () => {
    const store = createTestStore()
    await store.getState().refreshImportedTerminalThemes()
    expect(store.getState().importedTerminalThemes.themes).toEqual({})
    expect(store.getState().importedTerminalThemes.sourcePath).toBe('')
  })

  it('parses files returned by the IPC and merges into the global lookup', async () => {
    mockLoadDirectory({
      invalid: false,
      readErrors: [],
      themes: [
        {
          filename: 'MyTheme',
          contents: ['palette = 0=#111111', 'foreground = abcdef', 'background = 123456'].join('\n')
        }
      ]
    })
    settingsState.terminalCustomThemesDirectory = '/tmp/themes'
    const store = createTestStore()
    await store.getState().refreshImportedTerminalThemes()

    const state = store.getState().importedTerminalThemes
    expect(Object.keys(state.themes)).toEqual(['MyTheme'])
    expect(state.themes['MyTheme'].foreground).toBe('#abcdef')
    expect(state.sourcePath).toBe('/tmp/themes')
    expect(state.invalidDirectory).toBe(false)

    // Verify the module-level overlay was populated so picker lookups see it.
    expect(getTheme('MyTheme')?.background).toBe('#123456')
    expect(getThemeNames()).toContain('MyTheme')
  })

  it('suffixes names that collide with bundled themes so both remain selectable', async () => {
    mockLoadDirectory({
      invalid: false,
      readErrors: [],
      themes: [
        {
          filename: 'Dracula',
          contents: 'foreground = 000001\nbackground = 000002'
        },
        {
          filename: 'Dracula',
          contents: 'foreground = 000003\nbackground = 000004'
        }
      ]
    })
    settingsState.terminalCustomThemesDirectory = '/tmp/themes'
    const store = createTestStore()
    await store.getState().refreshImportedTerminalThemes()

    const names = Object.keys(store.getState().importedTerminalThemes.themes)
    expect(names).toContain('Dracula')
    // Second "Dracula" is suffixed because the first one claimed the bare name.
    expect(names).toContain('Dracula (2)')
  })

  it('surfaces invalid directory flag when IPC says so', async () => {
    mockLoadDirectory({ invalid: true, readErrors: [], themes: [] })
    settingsState.terminalCustomThemesDirectory = '/does/not/exist'
    const store = createTestStore()
    await store.getState().refreshImportedTerminalThemes()

    const state = store.getState().importedTerminalThemes
    expect(state.invalidDirectory).toBe(true)
    expect(Object.keys(state.themes)).toEqual([])
  })

  it('skips files that parse to an empty theme', async () => {
    mockLoadDirectory({
      invalid: false,
      readErrors: [],
      themes: [
        { filename: 'OnlyUnknownKeys', contents: 'font-family = Example\nsome-other-key = foo' },
        { filename: 'Real', contents: 'foreground = #ffffff' }
      ]
    })
    settingsState.terminalCustomThemesDirectory = '/tmp/themes'
    const store = createTestStore()
    await store.getState().refreshImportedTerminalThemes()

    const names = Object.keys(store.getState().importedTerminalThemes.themes)
    expect(names).toEqual(['Real'])
  })
})
