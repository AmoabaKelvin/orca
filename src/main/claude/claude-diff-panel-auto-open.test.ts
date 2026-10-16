import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  claudeDiffPanelMayAutoOpen,
  claudeDiffPanelStorePath,
  claudeGlobalConfigPath
} from './claude-diff-panel-auto-open'

let home: string
let configDir: string

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value))
}

function mayAutoOpen(cols: number | null, version: string | null = '2.1.301'): Promise<boolean> {
  return claudeDiffPanelMayAutoOpen({ configDir, version, cols, home })
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'orca-claude-diff-panel-'))
  configDir = join(home, '.claude')
  await mkdir(configDir)
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('claudeDiffPanelMayAutoOpen', () => {
  it('names the store file the way Claude 2.1.301 does', () => {
    // Observed on a real machine: ~/.claude/plugins/store/cc-plugin-diff_builtin-3903e77c01b1.json
    expect(claudeDiffPanelStorePath('/home/me/.claude')).toBe(
      '/home/me/.claude/plugins/store/cc-plugin-diff_builtin-3903e77c01b1.json'
    )
  })

  it('keeps the global config beside the default dir and inside any other one', () => {
    expect(claudeGlobalConfigPath(configDir, home)).toBe(join(home, '.claude.json'))
    expect(claudeGlobalConfigPath(join(home, 'work'), home)).toBe(
      join(home, 'work', '.claude.json')
    )
  })

  it('answers false for a Claude older than the panel, or an unknown version', async () => {
    expect(await mayAutoOpen(200, '2.1.259')).toBe(false)
    expect(await mayAutoOpen(200, null)).toBe(false)
    expect(await mayAutoOpen(200, '2.1.260')).toBe(true)
  })

  it('opens unasked only from 144 columns when the user never chose', async () => {
    expect(await mayAutoOpen(143)).toBe(false)
    expect(await mayAutoOpen(144)).toBe(true)
    // An unknown width cannot rule the panel out.
    expect(await mayAutoOpen(null)).toBe(true)
  })

  it('opens from 110 columns once the user has opened the panel before', async () => {
    await writeJson(claudeDiffPanelStorePath(configDir), { open: true })
    expect(await mayAutoOpen(109)).toBe(false)
    expect(await mayAutoOpen(110)).toBe(true)
  })

  it('never opens once the user closed it, in the store or the older global config', async () => {
    await writeJson(claudeDiffPanelStorePath(configDir), { open: false })
    expect(await mayAutoOpen(200)).toBe(false)

    await rm(claudeDiffPanelStorePath(configDir))
    await writeJson(join(home, '.claude.json'), { diffSidebarOpen: false })
    expect(await mayAutoOpen(200)).toBe(false)
  })

  it('lets the store win over the global config, and ignores malformed files', async () => {
    await writeJson(join(home, '.claude.json'), { diffSidebarOpen: false })
    await writeJson(claudeDiffPanelStorePath(configDir), { open: true })
    expect(await mayAutoOpen(120)).toBe(true)

    await writeFile(claudeDiffPanelStorePath(configDir), '{not json')
    expect(await mayAutoOpen(200)).toBe(false)
  })

  it('answers false when the user opted out of the fullscreen renderer', async () => {
    await writeJson(join(configDir, 'settings.json'), { tui: 'default' })
    expect(await mayAutoOpen(200)).toBe(false)
    await writeJson(join(configDir, 'settings.json'), { tui: 'fullscreen' })
    expect(await mayAutoOpen(200)).toBe(true)
  })
})
