import { useMemo, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/types'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { SearchableSetting } from './SearchableSetting'
import { useAppStore } from '@/store'

type CustomThemesSectionProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

// Why: Finder's default open dialog on macOS does not allow navigating into
// `.app` bundles, so even though the Ghostty theme directory lives inside
// `/Applications/Ghostty.app`, the user can't reach it with a folder picker.
// Offering a one-click quick-fill bypasses that restriction, and the editable
// input lets anyone paste the path directly.
const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')

const QUICK_FILL_PATHS: { label: string; description: string; path: string }[] = isMac
  ? [
      {
        label: 'Ghostty app bundle',
        description: '/Applications/Ghostty.app/Contents/Resources/ghostty/themes',
        path: '/Applications/Ghostty.app/Contents/Resources/ghostty/themes'
      }
    ]
  : []

export function CustomThemesSection({
  settings,
  updateSettings
}: CustomThemesSectionProps): React.JSX.Element {
  const importedThemes = useAppStore((s) => s.importedTerminalThemes)
  const refreshImportedTerminalThemes = useAppStore((s) => s.refreshImportedTerminalThemes)

  const storedPath = settings.terminalCustomThemesDirectory
  const [draftPath, setDraftPath] = useState(storedPath)
  const [prevStoredPath, setPrevStoredPath] = useState(storedPath)

  // Why: keep the local draft in sync when the stored value changes out from
  // under us (e.g. settings sync from another window, or we just wrote it).
  // Using a prevX/setPrevX guard instead of useEffect avoids a stale-draft
  // flash when React reconciles, and sidesteps the "derived state" effect
  // antipattern.
  if (storedPath !== prevStoredPath) {
    setPrevStoredPath(storedPath)
    setDraftPath(storedPath)
  }

  const themeCount = useMemo(
    () => Object.keys(importedThemes.themes).length,
    [importedThemes.themes]
  )
  const warningCount = importedThemes.parseWarnings.length
  const readErrorCount = importedThemes.readErrors.length
  const draftDiffersFromStored = draftPath.trim() !== storedPath

  const commitDraft = (): void => {
    const trimmed = draftPath.trim()
    if (trimmed !== storedPath) {
      updateSettings({ terminalCustomThemesDirectory: trimmed })
    } else {
      // Trimmed matches what's stored; still refresh so the user can force a
      // re-read after dropping new theme files into the same directory.
      void refreshImportedTerminalThemes()
    }
  }

  const handlePickDirectory = async (): Promise<void> => {
    const picked = await window.api.shell.pickDirectory({
      defaultPath: storedPath || undefined
    })
    if (picked) {
      updateSettings({ terminalCustomThemesDirectory: picked })
    }
  }

  const handleClear = (): void => {
    updateSettings({ terminalCustomThemesDirectory: '' })
  }

  // Why: the refresh button on an unchanged path re-parses what's already
  // stored, which is useful after dropping new files into the same directory
  // without reopening the dialog.
  const handleReload = (): void => {
    void refreshImportedTerminalThemes()
  }

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Custom Terminal Themes</h3>
        <p className="text-xs text-muted-foreground">
          Point Orca at a directory of Ghostty-format theme files to merge those themes into the
          picker. Imported themes preview identically to bundled ones.
        </p>
        {isMac ? (
          <p className="text-[11px] text-muted-foreground">
            macOS Finder blocks navigation into <code>.app</code> bundles, so paste the path into
            the field below and hit Load, or use the quick-fill button.
          </p>
        ) : null}
      </div>

      <SearchableSetting
        title="Custom Themes Directory"
        description="Directory containing Ghostty-format theme files."
        keywords={['theme', 'custom', 'ghostty', 'import', 'directory']}
      >
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={draftPath}
              onChange={(e) => setDraftPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitDraft()
                }
              }}
              placeholder="Paste an absolute directory path, e.g. /Applications/Ghostty.app/Contents/Resources/ghostty/themes"
              className="flex-1 font-mono text-xs"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={commitDraft}
              disabled={!draftDiffersFromStored && !storedPath}
            >
              Load
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handlePickDirectory}>
              Choose…
            </Button>
            {storedPath ? (
              <>
                <Button type="button" variant="outline" size="sm" onClick={handleReload}>
                  Reload
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={handleClear}>
                  Clear
                </Button>
              </>
            ) : null}
          </div>

          {QUICK_FILL_PATHS.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Quick fill:</span>
              {QUICK_FILL_PATHS.map((entry) => (
                <Button
                  key={entry.path}
                  type="button"
                  variant="outline"
                  size="sm"
                  title={entry.description}
                  onClick={() => updateSettings({ terminalCustomThemesDirectory: entry.path })}
                >
                  {entry.label}
                </Button>
              ))}
            </div>
          ) : null}

          {storedPath ? (
            <div className="space-y-1 text-xs text-muted-foreground">
              {importedThemes.invalidDirectory ? (
                <p className="text-destructive">Directory is missing or is not a folder.</p>
              ) : (
                <p>
                  Imported {themeCount} theme{themeCount === 1 ? '' : 's'}
                  {warningCount > 0 ? ` (${warningCount} with parse warnings)` : ''}
                  {readErrorCount > 0
                    ? ` · ${readErrorCount} file${readErrorCount === 1 ? '' : 's'} failed to read`
                    : ''}
                  .
                </p>
              )}
            </div>
          ) : null}
        </div>
      </SearchableSetting>
    </section>
  )
}
