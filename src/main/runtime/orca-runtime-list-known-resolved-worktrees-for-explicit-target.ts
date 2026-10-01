// @ts-nocheck -- mechanically split from OrcaRuntimeService; behavior is covered by AST equivalence and characterization tests.
import { OrcaRuntimeWithResolveWorktreeSelector } from './orca-runtime-resolve-worktree-selector'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'
import { splitWorktreeIdForFilesystem } from '../../shared/worktree/id'
import { isPathInsideOrEqual } from '../../shared/cross-platform-path'
import type { ResolvedWorktreeSnapshot } from './runtime-resolved-worktree-cache'
import {
  RESOLVED_WORKTREE_CACHE_TTL_MS,
  WORKTREE_SCAN_REPEATED_ROWS_WAIT_MS
} from './orca-runtime-postlude'
import { awaitRepeatedRowsWithinBudget, type RepeatedWorktreeRows } from './repeated-worktree-rows'
import { getWorktreeScanMutationRevision } from '../local-worktree-scan-generation'
import {
  resolveLocalProjectRuntimeForRepo,
  resolveLocalProjectRuntimesForRepos
} from '../project-runtime-git-options'
import { getAgentLaunchPlatformForRepo } from './runtime-agent-launch-resolution'
import { resolveRepoWorktreeRows, resolveScopedWorktreeIdRow } from './repo-worktree-row-resolution'
import { projectResolvedWorktreeLineage } from '../../shared/resolved-worktree-lineage'
import type { RepoWorktreeRowDeps } from './repo-worktree-row-resolution'
import { listRuntimeFolderWorkspaces } from './runtime-worktree-filesystem'
import type { ExecutionHostId } from '../../shared/execution-host'
import type { Repo } from '../../shared/repo-types'
import type { ProjectExecutionRuntimeResolution } from '../../shared/project-execution-runtime'
import type { RuntimeWorktreeScanResult } from './repo-worktree-resolution-scan'
import { getSshGitProviderGeneration } from '../providers/ssh-git-dispatch'
import { getRepoExecutionHostId, getRepoSshConnectionId } from '../../shared/execution-host'
import type { RuntimeWorktreeScanCache } from './orca-runtime-core'
import { resolveWorktreeScanCacheTtlMs } from './runtime-worktree-scan-cache'

export class OrcaRuntimeWithListKnownResolvedWorktreesForExplicitTarget extends OrcaRuntimeWithResolveWorktreeSelector {
  protected listKnownResolvedWorktreesForExplicitTarget(
    targetWorktreeId: string,
    targetWorktree: ResolvedWorktree | null
  ): ResolvedWorktree[] {
    if (!this.store || !targetWorktree) {
      return []
    }
    const target = splitWorktreeIdForFilesystem(targetWorktreeId)
    if (!target?.repoId || !target.worktreePath) {
      // Folder workspace keys have no repo/path tuple, but the converted row
      // is already authoritative for this explicit target.
      return [targetWorktree]
    }
    const worktreeIds = new Set(
      Object.keys(this.store.getAllWorktreeMeta()).filter((worktreeId) => {
        const parsed = splitWorktreeIdForFilesystem(worktreeId)
        return (
          parsed?.repoId === target.repoId &&
          Boolean(parsed.worktreePath) &&
          (isPathInsideOrEqual(target.worktreePath, parsed.worktreePath) ||
            isPathInsideOrEqual(parsed.worktreePath, target.worktreePath))
        )
      })
    )
    worktreeIds.add(targetWorktreeId)

    const resolved: ResolvedWorktree[] = []
    for (const worktreeId of worktreeIds) {
      const worktree =
        worktreeId === targetWorktreeId
          ? targetWorktree
          : this.buildResolvedWorktreeFromId(worktreeId)
      if (worktree) {
        resolved.push(worktree)
      }
    }
    return resolved
  }

  /** A warm fleet snapshot already answers any selector for free, so scoped scanning must yield to it. */
  protected hasFreshResolvedWorktreeCache(): boolean {
    return this.resolvedWorktrees.isFresh(getWorktreeScanMutationRevision())
  }

  protected async listResolvedWorktrees(): Promise<ResolvedWorktree[]> {
    return (await this.listResolvedWorktreeSnapshot()).worktrees
  }

  protected async listResolvedWorktreeSnapshot(): Promise<ResolvedWorktreeSnapshot> {
    if (!this.store) {
      return { worktrees: [], platformByRepoId: new Map() }
    }
    return this.resolvedWorktrees.getSnapshot(
      () => this.computeResolvedWorktrees(),
      RESOLVED_WORKTREE_CACHE_TTL_MS,
      getWorktreeScanMutationRevision()
    )
  }

  protected async computeResolvedWorktrees(): Promise<ResolvedWorktreeSnapshot> {
    if (!this.store) {
      return { worktrees: [], platformByRepoId: new Map() }
    }
    const metaById = this.store.getAllWorktreeMeta() ?? {}
    const repos = this.store.getRepos()
    const projectRuntimeByRepoId = resolveLocalProjectRuntimesForRepos(this.requireStore(), repos)
    const platformByRepoId = new Map(
      repos.map((repo) => [
        repo.id,
        getAgentLaunchPlatformForRepo(repo, projectRuntimeByRepoId.get(repo.id))
      ])
    )
    const deps = this.repoWorktreeRowDeps()
    const perRepoWorktrees = await Promise.all(
      repos.map(
        async (repo) => await resolveRepoWorktreeRows(deps, repo, metaById, projectRuntimeByRepoId)
      )
    )
    const lineageById = this.store?.getAllWorktreeLineage?.() ?? {}
    const worktrees = perRepoWorktrees.flatMap((rows) =>
      projectResolvedWorktreeLineage(rows, lineageById)
    )
    return { worktrees, platformByRepoId }
  }

  /** Bind the runtime-owned scan cache and folder-workspace stamping into the row resolver. */
  protected repoWorktreeRowDeps(): RepoWorktreeRowDeps {
    const store = this.requireStore()
    return {
      store,
      scanRepo: (repo, projectRuntimeByRepoId) =>
        this.listRepoWorktreesForResolution(repo, projectRuntimeByRepoId),
      listFolderWorkspaces: (repo, repoOwnerCount) =>
        listRuntimeFolderWorkspaces(store, repo, repoOwnerCount)
    }
  }

  protected async resolveExplicitWorktreeIdScoped(
    worktreeId: string,
    requiredHostId?: ExecutionHostId
  ): Promise<ResolvedWorktree | null> {
    if (!this.store) {
      return null
    }
    return await resolveScopedWorktreeIdRow(this.repoWorktreeRowDeps(), worktreeId, requiredHostId)
  }

  protected async listRepoWorktreesForResolution(
    repo: Repo,
    projectRuntimeByRepoId?: ReadonlyMap<string, ProjectExecutionRuntimeResolution>,
    // Why carried through re-runs: an overtaken scan lists again, but the caller's budget does not restart.
    askedAt = Date.now()
  ): Promise<RuntimeWorktreeScanResult> {
    // Resolve the execution host, not the raw field: an `executionHostId: 'ssh:*'` row with no
    // `connectionId` would otherwise get a local project runtime and a `local:default` cache key,
    // so its scan neither routes remotely nor re-runs when the SSH provider is replaced.
    const sshConnectionId = getRepoSshConnectionId(repo)
    const projectRuntime = projectRuntimeByRepoId
      ? projectRuntimeByRepoId.get(repo.id)
      : !sshConnectionId
        ? resolveLocalProjectRuntimeForRepo(this.requireStore(), repo)
        : undefined
    const runtimeKey = projectRuntime
      ? projectRuntime.status === 'resolved'
        ? projectRuntime.runtime.cacheKey
        : projectRuntime.repair.cacheKey
      : sshConnectionId
        ? `ssh:${sshConnectionId}:${getSshGitProviderGeneration(sshConnectionId)}`
        : 'local:default'
    const now = Date.now()
    const scanScopeKey = `${repo.id}\0${getRepoExecutionHostId(repo)}`
    const generation = this.worktreeScanGenerations.get(scanScopeKey) ?? 0
    const cached = this.worktreeScanCache.get(scanScopeKey)
    if (
      cached?.generation === generation &&
      cached.runtimeKey === runtimeKey &&
      cached.expiresAt > now
    ) {
      // Why no wait on a pending verdict here: a folder that hangs must not slow every cached read.
      return cached.result
    }
    const isOvertaken = (): boolean =>
      generation !== (this.worktreeScanGenerations.get(scanScopeKey) ?? 0)
    // Why per scope, not per scan: a joiner can outlive the in-flight entry of the scan it joined.
    const overtakenSignal = (): AbortSignal => {
      const controller = this.worktreeScanOvertaken.get(scanScopeKey) ?? new AbortController()
      this.worktreeScanOvertaken.set(scanScopeKey, controller)
      return controller.signal
    }
    const relist = (): Promise<RuntimeWorktreeScanResult> =>
      this.listRepoWorktreesForResolution(repo, projectRuntimeByRepoId, askedAt)
    const awaitVerdict = (refresh: RepeatedWorktreeRows): Promise<RuntimeWorktreeScanResult> =>
      awaitRepeatedRowsWithinBudget(
        refresh,
        askedAt,
        WORKTREE_SCAN_REPEATED_ROWS_WAIT_MS,
        overtakenSignal()
      )
    const inFlight = this.worktreeScanInFlight.get(scanScopeKey)
    if (inFlight?.generation === generation && inFlight.runtimeKey === runtimeKey) {
      const refresh = await inFlight.promise
      if (isOvertaken()) {
        return relist()
      }
      const result = await awaitVerdict(refresh)
      // Why again: rows listed before a change that landed during the wait would report a new worktree as gone.
      return isOvertaken() ? relist() : result
    }
    const reusableCached =
      cached?.generation === generation && cached.runtimeKey === runtimeKey ? cached : null
    const promise = this.refreshRepoWorktreeScan(repo, projectRuntime, reusableCached)
    this.worktreeScanInFlight.set(scanScopeKey, { generation, runtimeKey, promise })
    try {
      const refresh = await promise
      const listedAt = Date.now()
      // Why before the verdict wait: an overtaken scan's verdict is discarded, and waiting on it
      // spends the budget the re-run's listing needs.
      if (isOvertaken()) {
        return relist()
      }
      const result = await awaitVerdict(refresh)
      // Why again: as for a joiner above.
      if (isOvertaken()) {
        return relist()
      }
      if (
        (refresh.result.ok || !sshConnectionId) &&
        this.worktreeScanInFlight.get(scanScopeKey)?.promise === promise
      ) {
        const entry: RuntimeWorktreeScanCache = {
          generation,
          runtimeKey,
          result,
          repeatedRowsSettled: refresh.repeatedRowsSettled,
          // Why from the listing: the verdict wait must not lengthen how long these rows are served.
          expiresAt: listedAt + resolveWorktreeScanCacheTtlMs(repo),
          adminFingerprint: refresh.adminFingerprint,
          scannedAt: refresh.scannedAt
        }
        this.worktreeScanCache.set(scanScopeKey, entry)
        // Why in place: a verdict that lands after this caller's budget still fixes the next read.
        void refresh.repeatedRowsSettled?.then((settled) => {
          entry.result = settled
          entry.repeatedRowsSettled = null
        })
        void refresh.adminFingerprintProbe?.then((fingerprint) => {
          if (this.worktreeScanCache.get(scanScopeKey) === entry) {
            entry.adminFingerprint = fingerprint
          }
        })
      }
      return result
    } finally {
      if (this.worktreeScanInFlight.get(scanScopeKey)?.promise === promise) {
        this.worktreeScanInFlight.delete(scanScopeKey)
      }
    }
  }
}
