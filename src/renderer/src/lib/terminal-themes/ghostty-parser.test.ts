import { describe, it, expect } from 'vitest'
import { parseGhosttyTheme, themeNameFromFilename } from './ghostty-parser'

describe('parseGhosttyTheme', () => {
  it('maps palette 0-15 to xterm color keys', () => {
    const src = [
      'palette = 0=#000000',
      'palette = 1=#800000',
      'palette = 7=#c0c0c0',
      'palette = 8=#808080',
      'palette = 15=#ffffff'
    ].join('\n')
    const { theme, warnings } = parseGhosttyTheme(src)
    expect(warnings).toEqual([])
    expect(theme.black).toBe('#000000')
    expect(theme.red).toBe('#800000')
    expect(theme.white).toBe('#c0c0c0')
    expect(theme.brightBlack).toBe('#808080')
    expect(theme.brightWhite).toBe('#ffffff')
  })

  it('maps foreground, background, cursor-color, and selection-* keys', () => {
    const src = [
      'background = 1d1f21',
      'foreground = c5c8c6',
      'cursor-color = c5c8c6',
      'selection-background = 373b41',
      'selection-foreground = c5c8c6'
    ].join('\n')
    const { theme } = parseGhosttyTheme(src)
    expect(theme.background).toBe('#1d1f21')
    expect(theme.foreground).toBe('#c5c8c6')
    expect(theme.cursor).toBe('#c5c8c6')
    expect(theme.selectionBackground).toBe('#373b41')
    expect(theme.selectionForeground).toBe('#c5c8c6')
  })

  it('accepts colors with and without leading #', () => {
    const { theme } = parseGhosttyTheme('foreground = abcdef\nbackground = #123456')
    expect(theme.foreground).toBe('#abcdef')
    expect(theme.background).toBe('#123456')
  })

  it('expands #rgb shorthand to #rrggbb', () => {
    const { theme } = parseGhosttyTheme('foreground = #abc')
    expect(theme.foreground).toBe('#aabbcc')
  })

  it('tolerates 8-digit hex (alpha) by passing through', () => {
    const { theme } = parseGhosttyTheme('foreground = #aabbccdd')
    expect(theme.foreground).toBe('#aabbccdd')
  })

  it('ignores comments (# and ;) and blank lines', () => {
    const src = [
      '# This is a comment',
      '; semicolon comment',
      '',
      'palette = 0=#000000 # trailing comment',
      'foreground = c5c8c6'
    ].join('\n')
    const { theme, warnings } = parseGhosttyTheme(src)
    expect(warnings).toEqual([])
    expect(theme.black).toBe('#000000')
    expect(theme.foreground).toBe('#c5c8c6')
  })

  it('warns about invalid palette index', () => {
    const { warnings, theme } = parseGhosttyTheme('palette = 99=#ff0000')
    expect(theme.red).toBeUndefined()
    expect(warnings[0]).toMatch(/palette index/i)
  })

  it('warns about malformed colors on known color keys', () => {
    const { warnings, theme } = parseGhosttyTheme('foreground = not-a-color')
    expect(theme.foreground).toBeUndefined()
    expect(warnings[0]).toMatch(/invalid color/i)
  })

  it('silently ignores unknown keys (forward compatibility)', () => {
    const { warnings } = parseGhosttyTheme('font-family = some font\nfont-size = 14')
    expect(warnings).toEqual([])
  })

  it('produces an empty theme for an empty file without crashing', () => {
    const { theme, warnings } = parseGhosttyTheme('')
    expect(theme).toEqual({})
    expect(warnings).toEqual([])
  })

  it('lowercases color strings for consistency', () => {
    const { theme } = parseGhosttyTheme('foreground = #AABBCC')
    expect(theme.foreground).toBe('#aabbcc')
  })

  it('parses a realistic Ghostty theme file end-to-end', () => {
    const src = `
# Catppuccin Mocha
palette = 0=#45475a
palette = 1=#f38ba8
palette = 2=#a6e3a1
palette = 3=#f9e2af
palette = 4=#89b4fa
palette = 5=#f5c2e7
palette = 6=#94e2d5
palette = 7=#bac2de
palette = 8=#585b70
palette = 9=#f38ba8
palette = 10=#a6e3a1
palette = 11=#f9e2af
palette = 12=#89b4fa
palette = 13=#f5c2e7
palette = 14=#94e2d5
palette = 15=#a6adc8
background = 1e1e2e
foreground = cdd6f4
cursor-color = f5e0dc
cursor-text = 1e1e2e
selection-background = 353749
selection-foreground = cdd6f4
`
    const { theme, warnings } = parseGhosttyTheme(src)
    expect(warnings).toEqual([])
    expect(theme.black).toBe('#45475a')
    expect(theme.brightWhite).toBe('#a6adc8')
    expect(theme.background).toBe('#1e1e2e')
    expect(theme.foreground).toBe('#cdd6f4')
    expect(theme.cursor).toBe('#f5e0dc')
    expect(theme.cursorAccent).toBe('#1e1e2e')
    expect(theme.selectionBackground).toBe('#353749')
    expect(theme.selectionForeground).toBe('#cdd6f4')
  })
})

describe('themeNameFromFilename', () => {
  it('returns the basename unchanged when there is no recognized extension', () => {
    expect(themeNameFromFilename('Dracula')).toBe('Dracula')
    expect(themeNameFromFilename('/some/path/Catppuccin Mocha')).toBe('Catppuccin Mocha')
  })

  it('strips recognized theme extensions', () => {
    expect(themeNameFromFilename('solarized.ini')).toBe('solarized')
    expect(themeNameFromFilename('nord.conf')).toBe('nord')
    expect(themeNameFromFilename('retro.theme')).toBe('retro')
    expect(themeNameFromFilename('notes.txt')).toBe('notes')
  })

  it('leaves names with dots but non-theme extensions intact', () => {
    expect(themeNameFromFilename('Something v1.2')).toBe('Something v1.2')
  })
})
