// Git lists a path twice when a linked registration's gitdir names the main checkout (#23631).
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { OrcaRuntimeService } from './orca-runtime'

const REPO_ID = 'repo-local'
const REPO_PATH = '/home/me/fileLoc'
const MAIN_WORKTREE_ID = `${REPO_ID}::${REPO_PATH}`

function makeRuntime(): OrcaRuntimeService {
  const metaById: Record<string, Record<string, unknown>> = {}
  const repos = [
    { id: REPO_ID, path: REPO_PATH, displayName: 'fileLoc', badgeColor: 'blue', addedAt: 1 }
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

describe('worktree scan with a repeated path', () => {
  beforeEach(() => {
    listWorktreesStrictMock.mockReset()
    listWorktreesStrictMock.mockResolvedValue([
      { path: REPO_PATH, head: 'abc', branch: 'dev_ops', isBare: false, isMainWorktree: true },
      { path: REPO_PATH, head: 'abc', branch: 'dev_ops', isBare: false, isMainWorktree: false },
      // Linux paths are case-sensitive: a different spelling is a different checkout.
      {
        path: '/home/me/FileLoc',
        head: 'def',
        branch: 'feat',
        isBare: false,
        isMainWorktree: false
      }
    ])
  })

  it('resolves a branch selector to the main checkout', async () => {
    await expect(makeRuntime().showManagedWorktree('branch:dev_ops')).resolves.toMatchObject({
      id: MAIN_WORKTREE_ID,
      isMainWorktree: true
    })
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
