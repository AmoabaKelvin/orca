import { ipcMain } from 'electron'
import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, normalize } from 'node:path'

/** Cap per-directory read to avoid pathological cases (e.g. a user pointing at
 *  `/` or their home folder). Ghostty ships ~500 themes, so 2000 is plenty of
 *  headroom while still bounding I/O. */
const MAX_THEMES_PER_DIRECTORY = 2000

/** Skip files larger than this — a theme file is tiny (< 2KB). Anything much
 *  bigger is almost certainly not a theme and reading it wastes memory. */
const MAX_THEME_FILE_SIZE_BYTES = 64 * 1024

export type ThemeFileEntry = {
  /** Basename of the file (used as the display name before extension stripping). */
  filename: string
  /** Raw file contents — parsed in the renderer so the IPC contract stays
   *  small and format-agnostic. */
  contents: string
}

export type LoadThemeDirectoryResult = {
  themes: ThemeFileEntry[]
  /** Per-file read errors. Parse errors live in the renderer. */
  readErrors: { filename: string; message: string }[]
  /** True when the input directory did not exist or was not a directory. */
  invalid: boolean
}

export function registerTerminalThemeHandlers(): void {
  ipcMain.handle(
    'terminalThemes:loadDirectory',
    async (_event, rawPath: string): Promise<LoadThemeDirectoryResult> => {
      if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
        return { themes: [], readErrors: [], invalid: true }
      }
      // Why: reject relative paths. Relative paths in the main process
      // resolve against the main-process cwd, which is not a place the user
      // can reason about. Force absolute paths to make the feature predictable.
      if (!isAbsolute(rawPath)) {
        return { themes: [], readErrors: [], invalid: true }
      }
      const dir = normalize(rawPath)

      let entries: string[]
      try {
        const dirStat = await stat(dir)
        if (!dirStat.isDirectory()) {
          return { themes: [], readErrors: [], invalid: true }
        }
        entries = await readdir(dir)
      } catch {
        return { themes: [], readErrors: [], invalid: true }
      }

      const themes: ThemeFileEntry[] = []
      const readErrors: { filename: string; message: string }[] = []

      for (const entry of entries) {
        if (themes.length >= MAX_THEMES_PER_DIRECTORY) {
          break
        }
        // Skip hidden files — themes shouldn't start with a dot, and this
        // avoids accidentally reading things like .DS_Store.
        if (entry.startsWith('.')) {
          continue
        }
        const filePath = join(dir, entry)
        try {
          const entryStat = await stat(filePath)
          if (!entryStat.isFile()) {
            continue
          }
          if (entryStat.size > MAX_THEME_FILE_SIZE_BYTES) {
            continue
          }
          const contents = await readFile(filePath, 'utf8')
          themes.push({ filename: entry, contents })
        } catch (err) {
          readErrors.push({
            filename: entry,
            message: err instanceof Error ? err.message : String(err)
          })
        }
      }

      // Sort by filename so UI order is stable across reloads.
      themes.sort((a, b) => a.filename.localeCompare(b.filename))
      return { themes, readErrors, invalid: false }
    }
  )
}
