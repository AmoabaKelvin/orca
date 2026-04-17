import type { ITheme } from '@xterm/xterm'

import { TERMINAL_THEME_CATALOG } from './terminal-themes'

export const TERMINAL_THEMES: Record<string, ITheme> = TERMINAL_THEME_CATALOG

/** Module-scoped overlay of user-imported themes. Populated by the
 *  terminal-theme-imports store slice on boot and whenever the custom-themes
 *  directory changes. Lookups prefer the overlay so imported themes can shadow
 *  bundled ones after the name-collision suffixing in the slice — in practice
 *  suffixing ensures distinct keys, but fall-through preserves that guarantee
 *  even if a future path introduces collisions. */
let importedThemeOverlay: Record<string, ITheme> = {}
let overlayVersion = 0

export function setImportedTerminalThemes(next: Record<string, ITheme>): void {
  importedThemeOverlay = { ...next }
  overlayVersion += 1
}

/** Monotonically increasing counter that bumps whenever imported themes
 *  change. React components can subscribe to this via the store's
 *  `importedTerminalThemes` field to re-render when the catalog changes. */
export function getImportedThemeOverlayVersion(): number {
  return overlayVersion
}

export function getImportedThemeNames(): string[] {
  return Object.keys(importedThemeOverlay)
}

export function getThemeNames(): string[] {
  return [
    ...new Set([...Object.keys(TERMINAL_THEMES), ...Object.keys(importedThemeOverlay)])
  ].sort()
}

export function getTheme(name: string): ITheme | null {
  return importedThemeOverlay[name] ?? TERMINAL_THEMES[name] ?? null
}
