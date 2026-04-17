import type { ITheme } from '@xterm/xterm'

/**
 * Parse a Ghostty theme file (INI-style `key = value` pairs) into an xterm.js
 * ITheme. Ghostty's on-disk format:
 *
 *   palette = 0=#282a2e
 *   palette = 1=#a54242
 *   ...
 *   palette = 15=#ffffff
 *   background = 1d1f21
 *   foreground = c5c8c6
 *   cursor-color = c5c8c6
 *   selection-background = 373b41
 *   selection-foreground = c5c8c6
 *
 * Comments (`#` or `;`) and blank lines are skipped. Unknown keys are
 * ignored so future Ghostty additions don't break the parser. Malformed
 * palette indices or colors are collected in `warnings` and the containing
 * slot is left unset — xterm.js falls back to its built-in palette for
 * missing entries, which is better than rejecting the whole theme.
 */
export type ParsedGhosttyTheme = {
  theme: ITheme
  /** Non-fatal parse issues — malformed lines, out-of-range palette indices,
   *  etc. Surfaced so the UI can tell the user *which* themes had problems. */
  warnings: string[]
}

/** ITheme ANSI palette keys in Ghostty palette-index order. Typed narrowly so
 *  assignment stays type-safe (ITheme also includes `extendedAnsi: string[]`
 *  which these 16 keys are emphatically not). */
type AnsiColorKey =
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'brightBlack'
  | 'brightRed'
  | 'brightGreen'
  | 'brightYellow'
  | 'brightBlue'
  | 'brightMagenta'
  | 'brightCyan'
  | 'brightWhite'

const ANSI_KEY_BY_INDEX: readonly AnsiColorKey[] = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite'
]

function normalizeColor(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return null
  }
  // Ghostty accepts both `#rrggbb` and bare `rrggbb`. xterm wants `#rrggbb`.
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  // Tolerate #rgb shorthand by expanding to #rrggbb; reject anything else.
  if (/^#[0-9a-fA-F]{3}$/.test(withHash)) {
    const [, r, g, b] = withHash
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  if (/^#[0-9a-fA-F]{6}$/.test(withHash)) {
    return withHash.toLowerCase()
  }
  if (/^#[0-9a-fA-F]{8}$/.test(withHash)) {
    // Ghostty sometimes carries an alpha byte; xterm.js ignores it but tolerates
    // the extra two hex chars, so we pass it through rather than drop it.
    return withHash.toLowerCase()
  }
  return null
}

export function parseGhosttyTheme(source: string): ParsedGhosttyTheme {
  const theme: ITheme = {}
  const warnings: string[] = []

  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i]
    // Why: only treat `#` / `;` as a comment marker when the line starts with
    // it or it's separated from the code by whitespace. A bare `#` in the
    // middle of a value (e.g. `palette = 0=#000000`) is part of a hex color,
    // not a comment.
    const codePart = stripTrailingComment(rawLine)
    const line = codePart.trim()
    if (line.length === 0) {
      continue
    }
    const eq = line.indexOf('=')
    if (eq === -1) {
      warnings.push(`Line ${i + 1}: missing "="`)
      continue
    }
    const key = line.slice(0, eq).trim().toLowerCase()
    const value = line.slice(eq + 1).trim()

    if (key === 'palette') {
      // value is `N=#rrggbb`
      const inner = value.indexOf('=')
      if (inner === -1) {
        warnings.push(`Line ${i + 1}: palette entry missing inner "="`)
        continue
      }
      const indexStr = value.slice(0, inner).trim()
      const colorStr = value.slice(inner + 1).trim()
      const index = Number.parseInt(indexStr, 10)
      if (!Number.isInteger(index) || index < 0 || index >= ANSI_KEY_BY_INDEX.length) {
        warnings.push(`Line ${i + 1}: palette index "${indexStr}" out of range (expected 0-15)`)
        continue
      }
      const color = normalizeColor(colorStr)
      if (!color) {
        warnings.push(`Line ${i + 1}: palette ${index} has invalid color "${colorStr}"`)
        continue
      }
      theme[ANSI_KEY_BY_INDEX[index]] = color
      continue
    }

    const color = normalizeColor(value)
    if (!color) {
      // Not all keys are colors; only warn if we recognize the key.
      if (isColorKey(key)) {
        warnings.push(`Line ${i + 1}: ${key} has invalid color "${value}"`)
      }
      continue
    }

    switch (key) {
      case 'foreground':
        theme.foreground = color
        break
      case 'background':
        theme.background = color
        break
      case 'cursor-color':
        theme.cursor = color
        break
      case 'cursor-text':
        theme.cursorAccent = color
        break
      case 'selection-background':
        theme.selectionBackground = color
        break
      case 'selection-foreground':
        theme.selectionForeground = color
        break
      // Unknown keys: silently ignored. Ghostty has many settings beyond
      // colors (font options, padding, etc.) and they'll appear in theme
      // files occasionally — not an error worth surfacing.
      default:
        break
    }
  }

  return { theme, warnings }
}

function stripTrailingComment(line: string): string {
  const trimmedStart = line.trimStart()
  if (trimmedStart.startsWith('#') || trimmedStart.startsWith(';')) {
    return ''
  }
  // Why: only treat `#`/`;` as a comment marker when it's preceded by
  // whitespace AND followed by a non-hex, non-numeric character. This keeps
  // inline comments working ("foo = bar # note") while leaving hex colors
  // like `#aabbcc` intact (the char after `#` is a hex digit, not a letter).
  const match = line.match(/\s([#;])(?![0-9a-fA-F]).*$/)
  return match ? line.slice(0, match.index) : line
}

function isColorKey(key: string): boolean {
  return (
    key === 'foreground' ||
    key === 'background' ||
    key === 'cursor-color' ||
    key === 'cursor-text' ||
    key === 'selection-background' ||
    key === 'selection-foreground'
  )
}

/**
 * Derive a display name from a theme file path. Ghostty's bundled themes live
 * in files without extensions (`Dracula`, `Catppuccin Mocha`, etc.), so we
 * strip a trailing extension if present and otherwise use the basename as-is.
 */
export function themeNameFromFilename(filename: string): string {
  const basename = filename.split(/[/\\]/).pop() ?? filename
  const dot = basename.lastIndexOf('.')
  if (dot > 0) {
    const ext = basename.slice(dot + 1).toLowerCase()
    // Only strip recognizable theme-file extensions so a theme actually
    // called "Something v1.2" keeps its name.
    if (ext === 'ini' || ext === 'conf' || ext === 'theme' || ext === 'txt') {
      return basename.slice(0, dot)
    }
  }
  return basename
}
