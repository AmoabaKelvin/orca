import { useMemo } from 'react'
import type { GlobalSettings } from '../../../../shared/types'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { SearchableSetting } from './SearchableSetting'
import { useAppStore } from '@/store'

type CustomThemesSectionProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function CustomThemesSection({
  settings,
  updateSettings
}: CustomThemesSectionProps): React.JSX.Element {
  const importedThemes = useAppStore((s) => s.importedTerminalThemes)
  const refreshImportedTerminalThemes = useAppStore((s) => s.refreshImportedTerminalThemes)

  const path = settings.terminalCustomThemesDirectory
  const themeCount = useMemo(
    () => Object.keys(importedThemes.themes).length,
    [importedThemes.themes]
  )
  const warningCount = importedThemes.parseWarnings.length
  const readErrorCount = importedThemes.readErrors.length

  const handlePickDirectory = async (): Promise<void> => {
    const picked = await window.api.shell.pickDirectory({ defaultPath: path || undefined })
    if (picked) {
      updateSettings({ terminalCustomThemesDirectory: picked })
    }
  }

  const handleClear = (): void => {
    updateSettings({ terminalCustomThemesDirectory: '' })
  }

  const handleReload = (): void => {
    void refreshImportedTerminalThemes()
  }

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Custom Terminal Themes</h3>
        <p className="text-xs text-muted-foreground">
          Point Orca at a directory of Ghostty-format theme files (e.g.{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
            /Applications/Ghostty.app/Contents/Resources/ghostty/themes
          </code>
          ) to merge those themes into the picker. Imported themes preview identically to bundled
          ones.
        </p>
      </div>

      <SearchableSetting
        title="Custom Themes Directory"
        description="Directory containing Ghostty-format theme files."
        keywords={['theme', 'custom', 'ghostty', 'import', 'directory']}
      >
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={path}
              readOnly
              placeholder="No directory selected"
              className="flex-1 font-mono text-xs"
            />
            <Button type="button" variant="outline" size="sm" onClick={handlePickDirectory}>
              Choose
            </Button>
            {path ? (
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

          {path ? (
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
