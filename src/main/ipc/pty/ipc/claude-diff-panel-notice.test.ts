import { beforeEach, expect, it, vi } from 'vitest'

type Handler = (event: unknown, args: { id: unknown; target?: unknown }) => Promise<boolean>

type Mocks = {
  handlers: Map<string, Handler>
  ownership: Map<string, string>
  startup: ReturnType<typeof vi.fn<() => Promise<void> | undefined>>
  version: string | null
  size: { cols: number; rows: number } | null
  routedHome: string | null
  mayAutoOpen: ReturnType<typeof vi.fn<(input: unknown) => Promise<boolean>>>
}

const mocks = vi.hoisted((): Mocks => ({
  handlers: new Map(),
  ownership: new Map(),
  startup: vi.fn<() => Promise<void> | undefined>(),
  version: 'unprobed',
  size: { cols: 180, rows: 40 },
  routedHome: '/accounts/a/home',
  mayAutoOpen: vi.fn<(input: unknown) => Promise<boolean>>()
}))
vi.mock('../../pty-host-bindings', () => ({
  getPtyIpc: () => ({
    handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler)
  })
}))
vi.mock('../provider/ownership-state', () => ({ ptyOwnership: mocks.ownership }))
vi.mock('../provider/registry', () => ({
  tryGetProviderForPty: () => ({ getAppliedSize: async () => mocks.size })
}))
vi.mock('../../../claude/claude-hook-event-versions', () => ({
  probeRecentClaudeCliVersion: async () => mocks.version
}))
vi.mock('../../../codex-cli/command', () => ({ resolveClaudeCommand: () => '/bin/claude' }))
vi.mock('../../../claude-accounts/claude-profile-installed-router', () => ({
  getClaudeProfileRouter: () => ({
    routedHome: () => mocks.routedHome,
    systemDefaultHome: () => '/home/me/.claude'
  })
}))
vi.mock('../../../claude/claude-diff-panel-auto-open', () => ({
  claudeDiffPanelMayAutoOpen: mocks.mayAutoOpen
}))

import { toAppSshPtyId } from '../../../providers/ssh-pty-id'
import { installPtyClaudeDiffPanelNoticeIpcHandler } from './claude-diff-panel-notice'

const HOST = { runtime: 'host' }

beforeEach(() => {
  mocks.handlers.clear()
  mocks.ownership.clear()
  mocks.version = '2.1.301'
  mocks.size = { cols: 180, rows: 40 }
  mocks.routedHome = '/accounts/a/home'
  mocks.mayAutoOpen.mockReset().mockResolvedValue(true)
  installPtyClaudeDiffPanelNoticeIpcHandler({ getLocalPtyProviderStartupPromise: mocks.startup })
})

function ask(id: unknown, target: unknown = HOST): Promise<boolean> {
  return mocks.handlers.get('pty:claudeDiffPanelMayAutoOpen')!({}, { id, target })
}

it("judges a host pane by the selected account's home, its Claude version and its width", async () => {
  expect(await ask('pty-1')).toBe(true)
  expect(mocks.startup).toHaveBeenCalled()
  expect(mocks.mayAutoOpen).toHaveBeenCalledWith({
    configDir: '/accounts/a/home',
    version: '2.1.301',
    cols: 180
  })

  mocks.routedHome = null
  mocks.size = null
  await ask('pty-1')
  expect(mocks.mayAutoOpen).toHaveBeenLastCalledWith({
    configDir: '/home/me/.claude',
    version: '2.1.301',
    cols: null
  })
})

it('answers false for WSL, SSH and remotely owned panes without reading any config', async () => {
  expect(await ask('pty-1', { runtime: 'wsl', wslDistro: 'Ubuntu' })).toBe(false)
  expect(await ask(toAppSshPtyId('conn-1', 'pty-1'))).toBe(false)
  expect(await ask('remote:env-1@@pty-1')).toBe(false)
  mocks.ownership.set('pty-2', 'host-b')
  expect(await ask('pty-2')).toBe(false)
  expect(await ask(42)).toBe(false)
  expect(mocks.mayAutoOpen).not.toHaveBeenCalled()
})

it('answers false when the check itself fails', async () => {
  mocks.mayAutoOpen.mockRejectedValue(new Error('unreadable'))
  expect(await ask('pty-1')).toBe(false)
})
