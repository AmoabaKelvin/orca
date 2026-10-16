import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { claudeVersionReaches } from './claude-hook-event-versions'

/** The Claude Code release whose `/diff` panel opens by itself beside the transcript. */
export const CLAUDE_DIFF_PANEL_FIRST_VERSION = '2.1.260'

// Why two widths: the panel opens unasked from 144 columns, or from 110 once the user opened it.
const AUTO_OPEN_MIN_COLUMNS = 144
const REOPEN_MIN_COLUMNS = 110

// Why the hash: Claude names a built-in plugin's store file after the first 12 hex of sha256(id).
const DIFF_PANEL_PLUGIN_ID = 'cc-plugin-diff@builtin'

export function claudeDiffPanelStorePath(configDir: string): string {
  const hash = createHash('sha256').update(DIFF_PANEL_PLUGIN_ID).digest('hex').slice(0, 12)
  return join(configDir, 'plugins', 'store', `cc-plugin-diff_builtin-${hash}.json`)
}

/** Claude's global config: beside `~/.claude` by default, inside any other config dir. */
export function claudeGlobalConfigPath(configDir: string, home = homedir()): string {
  const colocated = join(configDir, '.claude.json')
  return resolve(configDir) !== resolve(join(home, '.claude')) || existsSync(colocated)
    ? colocated
    : join(home, '.claude.json')
}

async function readJsonObject(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a parsed non-array object is a string-keyed record.
        (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** The user's saved panel choice; undefined when Claude has never recorded one. */
export async function readClaudeDiffPanelPreference(
  configDir: string,
  home = homedir()
): Promise<boolean | undefined> {
  const store = await readJsonObject(claudeDiffPanelStorePath(configDir))
  // Why the fallback: releases before the plugin pane kept the choice in the global config,
  // and the pane copies that value into its store only when it has none of its own.
  return (
    asBoolean(store?.open) ??
    asBoolean((await readJsonObject(claudeGlobalConfigPath(configDir, home)))?.diffSidebarOpen)
  )
}

export type ClaudeDiffPanelAutoOpenInput = {
  configDir: string
  /** The pane's Claude CLI version; null when unknown, which answers false. */
  version: string | null
  /** The pane's columns; null when unknown, which skips the width gate. */
  cols: number | null
  home?: string
}

/** Whether Claude in this pane may open its diff panel unasked, judged from its saved config. */
export async function claudeDiffPanelMayAutoOpen(
  input: ClaudeDiffPanelAutoOpenInput
): Promise<boolean> {
  if (!claudeVersionReaches(input.version, CLAUDE_DIFF_PANEL_FIRST_VERSION)) {
    return false
  }
  const settings = await readJsonObject(join(input.configDir, 'settings.json'))
  // Why: the panel exists only in the fullscreen renderer, which this setting opts out of.
  if (settings?.tui === 'default') {
    return false
  }
  const preference = await readClaudeDiffPanelPreference(input.configDir, input.home)
  if (preference === false) {
    return false
  }
  const minColumns = preference === true ? REOPEN_MIN_COLUMNS : AUTO_OPEN_MIN_COLUMNS
  return input.cols === null || input.cols >= minColumns
}
