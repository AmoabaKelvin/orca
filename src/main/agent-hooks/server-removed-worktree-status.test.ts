import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentHookServer, _internals } from './server'
import { makePaneKey } from '../../shared/stable-pane-id'
import { LEAF_1, LEAF_2, LEAF_3, LEAF_4, LEAF_5, recentTs } from './server.test-fixtures'

const REMOVED = 'repo-1::/workspace/removed'
const KEPT = 'repo-1::/workspace/kept'
const LOCAL_PANE = makePaneKey('tab-local', LEAF_1)
const WSL_PANE = makePaneKey('tab-wsl', LEAF_2)
const SSH_PANE = makePaneKey('tab-ssh', LEAF_3)
const SSH_COMMITMENT_PANE = makePaneKey('tab-ssh-idle', LEAF_4)
const OTHER_PANE = makePaneKey('tab-other', LEAF_5)

function row(paneKey: string, worktreeId: string, connectionId: string | null) {
  const receivedAt = recentTs()
  return {
    paneKey,
    tabId: paneKey.split(':')[0],
    worktreeId,
    connectionId,
    receivedAt,
    stateStartedAt: receivedAt,
    payload: { state: 'working', prompt: 'stranded', agentType: 'codex' }
  }
}

describe('AgentHookServer removed-worktree retirement', () => {
  let userDataPath: string
  const lastStatusPath = () => join(userDataPath, 'agent-hooks', 'last-status.json')

  beforeEach(() => {
    _internals.resetCachesForTests()
    userDataPath = mkdtempSync(join(tmpdir(), 'orca-removed-worktree-'))
    mkdirSync(join(userDataPath, 'agent-hooks'), { recursive: true })
    writeFileSync(
      lastStatusPath(),
      JSON.stringify({
        version: 2,
        entries: {
          [LOCAL_PANE]: row(LOCAL_PANE, REMOVED, null),
          [WSL_PANE]: row(WSL_PANE, REMOVED, 'wsl:Ubuntu'),
          [SSH_PANE]: row(SSH_PANE, REMOVED, 'user@box'),
          [OTHER_PANE]: row(OTHER_PANE, KEPT, null)
        }
      }),
      'utf8'
    )
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
  })

  it('retires only the removing host rows and commitments, then persists the pruned map', async () => {
    const server = new AgentHookServer()
    await server.start({ env: 'production', userDataPath })
    try {
      // An SSH commitment recorded this session outlives its row across a disconnect clear.
      server.ingestRemote(
        {
          paneKey: SSH_COMMITMENT_PANE,
          tabId: 'tab-ssh-idle',
          worktreeId: REMOVED,
          launchToken: 'idle-launch',
          payload: { state: 'working', prompt: 'idle', agentType: 'codex' }
        },
        'idle@box'
      )
      server.clearStatusEntriesForConnection('idle@box')
      const persisted = () => {
        server.flushStatusPersistSync()
        const file = JSON.parse(readFileSync(lastStatusPath(), 'utf8'))
        return {
          entries: Object.keys(file.entries).sort(),
          commitments: Object.keys(file.authorityCommitments ?? {})
        }
      }

      server.dropStatusEntriesForRemovedWorktree(REMOVED, 'runtime:env-1')
      expect(persisted().entries).toHaveLength(4)

      server.dropStatusEntriesForRemovedWorktree(REMOVED, 'local')
      expect(persisted()).toEqual({
        entries: [OTHER_PANE, SSH_PANE].sort(),
        commitments: [SSH_COMMITMENT_PANE]
      })

      server.dropStatusEntriesForRemovedWorktree(REMOVED, 'ssh:user%40box')
      expect(persisted()).toEqual({ entries: [OTHER_PANE], commitments: [SSH_COMMITMENT_PANE] })

      server.dropStatusEntriesForRemovedWorktree(REMOVED, 'ssh:idle%40box')
      expect(persisted().commitments).toEqual([])
    } finally {
      server.stop()
    }
  })

  it('fences only the retired pane, so its kept tab still reports a new agent', async () => {
    const server = new AgentHookServer()
    await server.start({ env: 'production', userDataPath })
    try {
      server.dropStatusEntriesForRemovedWorktree(REMOVED, 'local')
      const newPane = makePaneKey('tab-local', '66666666-6666-4666-8666-666666666666')
      const done = { state: 'done', prompt: 'late', agentType: 'codex' } as const
      server.ingestTerminalStatus({ paneKey: LOCAL_PANE, connectionId: null, payload: done })
      server.ingestTerminalStatus({ paneKey: newPane, connectionId: null, payload: done })

      const panes = server.getStatusSnapshot().map((entry) => entry.paneKey)
      expect(panes).toContain(newPane)
      expect(panes).not.toContain(LOCAL_PANE)
    } finally {
      server.stop()
    }
  })

  // The mixed-owner branch deletes the removed row without the pane fence the sole-owner path
  // gets, so the removed worktree's own late turn has to be blocked by its token instead — or the
  // row this PR exists to delete is written straight back to memory and to last-status.json.
  it('refuses a late turn from the removed owner after a mixed-owner cleanup', async () => {
    const server = new AgentHookServer()
    await server.start({ env: 'production', userDataPath })
    try {
      const pane = makePaneKey('tab-mixed', '77777777-7777-4777-8777-777777777777')
      const working = { state: 'working', prompt: 'live', agentType: 'codex' } as const
      // The surviving owner's token-bearing SSH claim outlives its row across a disconnect clear.
      server.ingestRemote(
        {
          paneKey: pane,
          tabId: 'tab-mixed',
          worktreeId: KEPT,
          launchToken: 'survivor',
          payload: working
        },
        'user@box'
      )
      server.clearStatusEntriesForConnection('user@box')
      server.ingestTerminalStatus({
        paneKey: pane,
        worktreeId: REMOVED,
        connectionId: null,
        payload: working
      })

      server.dropStatusEntriesForRemovedWorktree(REMOVED, 'local')
      server.ingestTerminalStatus({
        paneKey: pane,
        worktreeId: REMOVED,
        connectionId: null,
        payload: { state: 'done', prompt: 'late', agentType: 'codex' }
      })

      expect(server.getStatusSnapshot().map((entry) => entry.paneKey)).not.toContain(pane)
      server.flushStatusPersistSync()
      const file = JSON.parse(readFileSync(lastStatusPath(), 'utf8'))
      expect(file.entries[pane]).toBeUndefined()
      // The surviving owner is not collateral: its resume identity is still on disk, so a
      // reattach or a new agent can pick the pane back up.
      expect(file.authorityCommitments[pane]).toMatchObject({ connectionId: 'user@box' })
    } finally {
      server.stop()
    }
  })

  // `deleteStatusEntry` drops the pane's authority observation whatever `preserveAuthority` says,
  // and on a shared pane that observation can belong to the owner that is staying.
  it('keeps the surviving owner attestable after the removed owner row goes', async () => {
    const server = new AgentHookServer()
    await server.start({ env: 'production', userDataPath })
    try {
      const pane = makePaneKey('tab-attest', '88888888-8888-4888-8888-888888888888')
      const working = { state: 'working', prompt: 'live', agentType: 'codex' } as const
      const launchTokenHash = createHash('sha256').update('survivor').digest('hex')
      const attest = () =>
        server.attestCompatibilityAuthority({
          paneKey: pane,
          launchTokenHash,
          connectionId: 'user@box',
          terminalProvenance: 'current_runtime'
        })
      server.ingestRemote(
        {
          paneKey: pane,
          tabId: 'tab-attest',
          worktreeId: KEPT,
          launchToken: 'survivor',
          payload: working
        },
        'user@box'
      )
      expect(attest()).toMatchObject({ paneKey: pane, source: 'current_hook' })
      // A tokenless local report rebinds only the row, leaving the SSH owner's claims in place.
      server.ingestTerminalStatus({
        paneKey: pane,
        worktreeId: REMOVED,
        connectionId: null,
        payload: working
      })

      server.dropStatusEntriesForRemovedWorktree(REMOVED, 'local')

      expect(attest()).toMatchObject({ paneKey: pane, source: 'current_hook' })
    } finally {
      server.stop()
    }
  })

  // A pane keeps an SSH commitment across a disconnect clear, then reports locally with no token.
  it.each([
    {
      removedOwns: 'the SSH commitment',
      sshWorktree: REMOVED,
      localWorktree: KEPT,
      host: 'ssh:user%40box'
    },
    { removedOwns: 'the local row', sshWorktree: KEPT, localWorktree: REMOVED, host: 'local' }
  ] as const)(
    'clears only $removedOwns when a pane holds claims from two owners',
    async ({ sshWorktree, localWorktree, host }) => {
      const server = new AgentHookServer()
      await server.start({ env: 'production', userDataPath })
      try {
        const pane = makePaneKey('tab-reused', '77777777-7777-4777-8777-777777777777')
        const working = { state: 'working', prompt: 'live', agentType: 'codex' } as const
        server.ingestRemote(
          {
            paneKey: pane,
            tabId: 'tab-reused',
            worktreeId: sshWorktree,
            launchToken: 'ssh',
            payload: working
          },
          'user@box'
        )
        server.clearStatusEntriesForConnection('user@box')
        server.ingestTerminalStatus({
          paneKey: pane,
          worktreeId: localWorktree,
          connectionId: null,
          payload: working
        })

        server.dropStatusEntriesForRemovedWorktree(REMOVED, host)

        server.flushStatusPersistSync()
        const file = JSON.parse(readFileSync(lastStatusPath(), 'utf8'))
        if (localWorktree === KEPT) {
          // The surviving local row stays, without the removed owner's token hash stamped on it.
          expect(file.entries[pane]).toMatchObject({ worktreeId: KEPT })
          expect(file.entries[pane].launchTokenHash).toBeUndefined()
        } else {
          // The removed local row goes; the surviving SSH owner keeps its commitment.
          expect(file.entries[pane]).toBeUndefined()
          expect(file.authorityCommitments[pane]).toMatchObject({ connectionId: 'user@box' })
        }
      } finally {
        server.stop()
      }
    }
  )
})
