// Git lists a path twice when a linked registration's gitdir names the main checkout (#23631).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => {
  const ipcMain = {
    on: vi.fn(() => ipcMain),
    removeListener: vi.fn(() => ipcMain),
    emit: vi.fn(() => true)
  }
  return {
    BrowserWindow: { fromId: vi.fn((): unknown => null) },
    webContents: { fromId: vi.fn((): unknown => null) },
    ipcMain,
    app: { getPath: vi.fn(() => '/tmp'), isPackaged: false }
  }
})
vi.mock('electron', () => electronMocks)

const listWorktreesStrictMock = vi.hoisted(() => vi.fn())
vi.mock('../git/worktree', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listWorktreesStrict: listWorktreesStrictMock
}))

vi.mock('./repo-worktree-admin-fingerprint', () => ({
  readRepoWorktreeAdminFingerprint: vi.fn(async () => null)
}))

const gitExecFileAsyncMock = vi.hoisted(() => vi.fn())
vi.mock('../git/runner', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  gitExecFileAsync: gitExecFileAsyncMock
}))

const getSshGitProviderMock = vi.hoisted(() => vi.fn())
const getSshGitProviderGenerationMock = vi.hoisted(() => vi.fn(() => 0))
vi.mock('../providers/ssh-git-dispatch', () => ({
  getSshGitProvider: getSshGitProviderMock,
  getSshGitProviderGeneration: getSshGitProviderGenerationMock,
  SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE: 'unavailable',
  requireSshGitProvider: (connectionId: string) => getSshGitProviderMock(connectionId)
}))

import { bumpLocalWorktreeScanGeneration } from '../local-worktree-scan-generation'
import { OrcaRuntimeService } from './orca-runtime'
import { RESOLVED_WORKTREE_REPO_TIMEOUT_MS } from './repo-worktree-row-resolution'

const REPO_ID = 'repo-local'
const REPO_PATH = '/home/me/fileLoc'
const MAIN_WORKTREE_ID = `${REPO_ID}::${REPO_PATH}`

const LINKED_PATH = '/home/me/fileLoc-feature'
const LINKED_WORKTREE_ID = `${REPO_ID}::${LINKED_PATH}`
const MAIN_ROW = {
  path: REPO_PATH,
  head: 'abc',
  branch: 'refs/heads/dev_ops',
  isBare: false,
  isMainWorktree: true
}
// Git orders repeats of a linked path by registration name, not by which one is live.
const STALE_LINKED_ROW = {
  path: LINKED_PATH,
  head: 'old',
  branch: 'refs/heads/stale',
  isBare: false,
  isMainWorktree: false
}
const LIVE_LINKED_ROW = { ...STALE_LINKED_ROW, head: 'new', branch: 'refs/heads/live' }

function makeRuntime(options: { connectionId?: string } = {}): OrcaRuntimeService {
  const metaById: Record<string, Record<string, unknown>> = {}
  const repos = [
    {
      id: REPO_ID,
      path: REPO_PATH,
      displayName: 'fileLoc',
      badgeColor: 'blue',
      addedAt: 1,
      ...options
    }
  ]
  const store = {
    getRepo: (id: string) => repos.find((repo) => repo.id === id),
    getRepos: () => repos,
    getAllWorktreeMeta: () => metaById,
    getWorktreeMeta: (id: string) => metaById[id],
    setWorktreeMeta: (id: string, meta: Record<string, unknown>) => {
      metaById[id] = { ...metaById[id], ...meta }
      return metaById[id]
    },
    getAllWorktreeLineage: () => ({}),
    getAllWorkspaceLineage: () => ({}),
    getSettings: () => ({
      workspaceDir: '/tmp/workspaces',
      nestWorkspaces: false,
      refreshLocalBaseRefOnWorktreeCreate: false,
      branchPrefix: 'none',
      branchPrefixCustom: ''
    }),
    getProjects: () => []
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stub carries the repo, meta, lineage and settings reads a worktree listing makes; the rest of Store is unreached.
  return new OrcaRuntimeService(store as never)
}

// What `git rev-parse HEAD --symbolic-full-name HEAD` prints in the folder; `HEAD` means detached.
async function folderAnswer(head: string, branch?: string) {
  return { stdout: `${head}\n${branch ? `refs/heads/${branch}` : 'HEAD'}\n`, stderr: '' }
}
const FOLDER_ON_LIVE = 'new\nrefs/heads/live\n'

async function listedRows(runtime: OrcaRuntimeService): Promise<string[]> {
  const listed = await runtime.listManagedWorktrees()
  return listed.worktrees.map((worktree) => `${worktree.id} ${worktree.branch}`)
}

describe('worktree scan with a repeated path', () => {
  beforeEach(() => {
    listWorktreesStrictMock.mockReset()
    gitExecFileAsyncMock.mockReset()
    getSshGitProviderMock.mockReset()
    getSshGitProviderGenerationMock.mockReset().mockReturnValue(0)
  })

  describe('rows that match', () => {
    beforeEach(() => {
      listWorktreesStrictMock.mockResolvedValue([
        MAIN_ROW,
        { ...MAIN_ROW, isMainWorktree: false },
        // Linux paths are case-sensitive: a different spelling is a different checkout.
        { ...LIVE_LINKED_ROW, path: '/home/me/FileLoc' }
      ])
    })

    it('resolves a branch selector to the main checkout without asking the folder', async () => {
      await expect(makeRuntime().showManagedWorktree('branch:dev_ops')).resolves.toMatchObject({
        id: MAIN_WORKTREE_ID,
        isMainWorktree: true
      })
      expect(gitExecFileAsyncMock).not.toHaveBeenCalled()
    })

    it('lists each path once for the CLI and for paired clients', async () => {
      const runtime = makeRuntime()
      const expectedIds = [MAIN_WORKTREE_ID, `${REPO_ID}::/home/me/FileLoc`]

      const listed = await runtime.listManagedWorktrees()
      expect(listed.worktrees.map((worktree) => worktree.id)).toEqual(expectedIds)

      const detected = await runtime.listDetectedManagedWorktrees(`id:${REPO_ID}`)
      expect(detected.worktrees.map((worktree) => worktree.id)).toEqual(expectedIds)
    })
  })

  describe('rows that disagree', () => {
    beforeEach(() => {
      listWorktreesStrictMock.mockResolvedValue([MAIN_ROW, STALE_LINKED_ROW, LIVE_LINKED_ROW])
    })

    it('keeps the row the folder has checked out', async () => {
      gitExecFileAsyncMock.mockResolvedValue({ stdout: FOLDER_ON_LIVE, stderr: '' })

      await expect(listedRows(makeRuntime())).resolves.toEqual([
        `${MAIN_WORKTREE_ID} refs/heads/dev_ops`,
        `${LINKED_WORKTREE_ID} refs/heads/live`
      ])
      expect(gitExecFileAsyncMock).toHaveBeenCalledTimes(1)
      expect(gitExecFileAsyncMock.mock.calls[0]?.[1]).toMatchObject({ cwd: LINKED_PATH })
    })

    it('keeps the linked checkout over a main row relabelled with its folder', async () => {
      // A separate-git-dir repo opened through a linked worktree: the scan gives the main row that folder's path.
      listWorktreesStrictMock.mockResolvedValue([
        { ...MAIN_ROW, path: LINKED_PATH, head: 'old', branch: 'refs/heads/main' },
        LIVE_LINKED_ROW
      ])
      gitExecFileAsyncMock.mockResolvedValue({ stdout: FOLDER_ON_LIVE, stderr: '' })

      await expect(listedRows(makeRuntime())).resolves.toEqual([
        `${LINKED_WORKTREE_ID} refs/heads/live`
      ])
    })

    it.each([
      ['the folder cannot be read', () => Promise.reject(new Error('not a git repository'))],
      ['the folder is on that branch at another commit', () => folderAnswer('other', 'live')],
      ['the folder is detached at that commit', () => folderAnswer('new')],
      ['no row matches what the folder has', () => folderAnswer('new', 'elsewhere')]
    ])('keeps every row when %s', async (_case, answer) => {
      gitExecFileAsyncMock.mockImplementation(answer)

      await expect(listedRows(makeRuntime())).resolves.toEqual([
        `${MAIN_WORKTREE_ID} refs/heads/dev_ops`,
        `${LINKED_WORKTREE_ID} refs/heads/stale`,
        `${LINKED_WORKTREE_ID} refs/heads/live`
      ])
    })

    describe('inside the caller budget', () => {
      const ALL_GIT_ROWS = [
        `${MAIN_WORKTREE_ID} refs/heads/dev_ops`,
        `${LINKED_WORKTREE_ID} refs/heads/stale`,
        `${LINKED_WORKTREE_ID} refs/heads/live`
      ]

      beforeEach(() => {
        vi.useFakeTimers()
      })

      afterEach(() => {
        vi.useRealTimers()
      })

      it('answers with every git row when the folder is slow to reply', async () => {
        // Past the budget the caller restores persisted rows, which would hide a listing git already gave.
        gitExecFileAsyncMock.mockReturnValue(new Promise(() => {}))

        const listed = listedRows(makeRuntime())
        await vi.advanceTimersByTimeAsync(RESOLVED_WORKTREE_REPO_TIMEOUT_MS)

        await expect(listed).resolves.toEqual(ALL_GIT_ROWS)
      })

      it('serves the folder verdict to later reads when it lands after the first caller left', async () => {
        const lateMs = RESOLVED_WORKTREE_REPO_TIMEOUT_MS - 500
        gitExecFileAsyncMock.mockReturnValue(
          new Promise((resolve) => {
            setTimeout(() => resolve({ stdout: FOLDER_ON_LIVE, stderr: '' }), lateMs)
          })
        )
        const runtime = makeRuntime()

        const first = listedRows(runtime)
        await vi.advanceTimersByTimeAsync(lateMs - 400)
        await expect(first).resolves.toEqual(ALL_GIT_ROWS)

        // A cached read never waits on a pending verdict: a folder that hangs must not slow every read.
        const cachedRead = await runtime.listDetectedManagedWorktrees(`id:${REPO_ID}`)
        expect(cachedRead.worktrees).toHaveLength(ALL_GIT_ROWS.length)

        await vi.advanceTimersByTimeAsync(1_400)
        await expect(listedRows(runtime)).resolves.toEqual([
          `${MAIN_WORKTREE_ID} refs/heads/dev_ops`,
          `${LINKED_WORKTREE_ID} refs/heads/live`
        ])
        expect(listWorktreesStrictMock).toHaveBeenCalledTimes(1)
        expect(gitExecFileAsyncMock).toHaveBeenCalledTimes(1)
      })

      it('re-lists at once when a change lands during a slow listing', async () => {
        // Waiting on the overtaken scan's verdict first would spend the budget the second listing needs.
        gitExecFileAsyncMock.mockReturnValue(new Promise(() => {}))
        const runtime = makeRuntime()
        const slowListing = (): Promise<unknown> =>
          new Promise((resolve) => {
            setTimeout(() => resolve([MAIN_ROW, STALE_LINKED_ROW, LIVE_LINKED_ROW]), 1_600)
          })
        listWorktreesStrictMock.mockImplementationOnce(() => {
          runtime.invalidateWorktreeCatalog(REPO_ID)
          return slowListing()
        })
        listWorktreesStrictMock.mockImplementation(slowListing)

        const listed = listedRows(runtime)
        await vi.advanceTimersByTimeAsync(RESOLVED_WORKTREE_REPO_TIMEOUT_MS)

        await expect(listed).resolves.toEqual(ALL_GIT_ROWS)
      })

      it('re-lists at once when a change lands while it waits on the folder', async () => {
        // Rows listed before the change would report the new worktree as gone.
        gitExecFileAsyncMock.mockReturnValue(new Promise(() => {}))
        const runtime = makeRuntime()
        const createdRow = {
          ...LIVE_LINKED_ROW,
          path: '/home/me/fileLoc-new',
          branch: 'refs/heads/new'
        }
        listWorktreesStrictMock.mockResolvedValueOnce([MAIN_ROW, STALE_LINKED_ROW, LIVE_LINKED_ROW])
        listWorktreesStrictMock.mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(
                () => resolve([MAIN_ROW, STALE_LINKED_ROW, LIVE_LINKED_ROW, createdRow]),
                1_600
              )
            })
        )

        const listed = listedRows(runtime)
        await vi.advanceTimersByTimeAsync(1_000)
        runtime.invalidateWorktreeCatalog(REPO_ID)
        await vi.advanceTimersByTimeAsync(RESOLVED_WORKTREE_REPO_TIMEOUT_MS - 1_000)

        await expect(listed).resolves.toEqual([
          ...ALL_GIT_ROWS,
          `${REPO_ID}::/home/me/fileLoc-new refs/heads/new`
        ])
      })

      it('re-lists at once for a caller whose scan was started, and finished, by someone else', async () => {
        gitExecFileAsyncMock.mockReturnValue(new Promise(() => {}))
        const runtime = makeRuntime()
        listWorktreesStrictMock.mockResolvedValueOnce([MAIN_ROW, STALE_LINKED_ROW, LIVE_LINKED_ROW])
        listWorktreesStrictMock.mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(() => resolve([MAIN_ROW, LIVE_LINKED_ROW]), 1_600)
            })
        )

        const starter = listedRows(runtime)
        await vi.advanceTimersByTimeAsync(3_000)
        const joiner = runtime.showManagedWorktree(`id:${LINKED_WORKTREE_ID}`)
        await vi.advanceTimersByTimeAsync(600)
        await expect(starter).resolves.toEqual(ALL_GIT_ROWS)
        // The starter has left; the joiner must still hear about the change instead of waiting out its budget.
        runtime.invalidateWorktreeCatalog(REPO_ID)
        await vi.advanceTimersByTimeAsync(RESOLVED_WORKTREE_REPO_TIMEOUT_MS)

        await expect(joiner).resolves.toMatchObject({ branch: 'refs/heads/live' })
      })

      it('gives overlapping callers each their own budget across a worktree change', async () => {
        gitExecFileAsyncMock.mockReturnValue(new Promise(() => {}))
        const runtime = makeRuntime()

        const first = listedRows(runtime)
        await vi.advanceTimersByTimeAsync(1_000)
        runtime.invalidateWorktreeCatalog(REPO_ID)
        await vi.advanceTimersByTimeAsync(1_000)
        const second = listedRows(runtime)
        await vi.advanceTimersByTimeAsync(RESOLVED_WORKTREE_REPO_TIMEOUT_MS - 2_000)

        await expect(first).resolves.toEqual(ALL_GIT_ROWS)
        await vi.advanceTimersByTimeAsync(RESOLVED_WORKTREE_REPO_TIMEOUT_MS)
        await expect(second).resolves.toEqual(ALL_GIT_ROWS)
      })

      it('keeps one budget when the paired-client listing re-runs an overtaken scan', async () => {
        // A replaced SSH provider changes the scan's cache key, so the re-run cannot answer from the cache.
        getSshGitProviderMock.mockReturnValue({
          listWorktrees: vi.fn(async () => [MAIN_ROW, STALE_LINKED_ROW, LIVE_LINKED_ROW]),
          exec: vi.fn(() => new Promise(() => {}))
        })
        const runtime = makeRuntime({ connectionId: 'builder' })
        let answered = false

        void runtime.listDetectedManagedWorktrees(`id:${REPO_ID}`).then(() => {
          answered = true
        })
        await vi.advanceTimersByTimeAsync(1_000)
        getSshGitProviderGenerationMock.mockReturnValue(1)
        bumpLocalWorktreeScanGeneration(REPO_ID)
        await vi.advanceTimersByTimeAsync(RESOLVED_WORKTREE_REPO_TIMEOUT_MS - 1_000)

        expect(answered).toBe(true)
      })

      it('answers with every git row once the listing has used the budget', async () => {
        gitExecFileAsyncMock.mockReturnValue(new Promise(() => {}))
        listWorktreesStrictMock.mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(
                () => resolve([MAIN_ROW, STALE_LINKED_ROW, LIVE_LINKED_ROW]),
                RESOLVED_WORKTREE_REPO_TIMEOUT_MS - 1_000
              )
            })
        )

        const listed = listedRows(makeRuntime())
        await vi.advanceTimersByTimeAsync(RESOLVED_WORKTREE_REPO_TIMEOUT_MS)

        await expect(listed).resolves.toEqual(ALL_GIT_ROWS)
      })
    })

    it('asks the SSH host for a remote repo', async () => {
      const exec = vi.fn(async (_args: string[], _cwd: string) => ({
        stdout: FOLDER_ON_LIVE,
        stderr: ''
      }))
      getSshGitProviderMock.mockReturnValue({
        listWorktrees: vi.fn(async () => [MAIN_ROW, STALE_LINKED_ROW, LIVE_LINKED_ROW]),
        exec
      })

      await expect(listedRows(makeRuntime({ connectionId: 'builder' }))).resolves.toEqual([
        `${MAIN_WORKTREE_ID} refs/heads/dev_ops`,
        `${LINKED_WORKTREE_ID} refs/heads/live`
      ])
      expect(exec.mock.calls.map(([args, cwd]) => [args[0], cwd])).toEqual([
        ['rev-parse', LINKED_PATH]
      ])
      expect(gitExecFileAsyncMock).not.toHaveBeenCalled()
    })
  })
})
