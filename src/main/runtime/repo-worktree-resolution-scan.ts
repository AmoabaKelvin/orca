import type { GitWorktreeInfo } from '../../shared/worktree/types'
import { listWorktreesStrict } from '../git/worktree'
import type { LocalProjectWorktreeGitOptions } from '../project-runtime-git-options'

export type RuntimeWorktreeScanResult =
  | { ok: true; worktrees: GitWorktreeInfo[] }
  | { ok: false; worktrees: GitWorktreeInfo[] }

export async function scanLocalRepoWorktreesForResolution(
  repoPath: string,
  options: LocalProjectWorktreeGitOptions
): Promise<RuntimeWorktreeScanResult> {
  try {
    const worktrees = options.wslDistro
      ? await listWorktreesStrict(repoPath, options)
      : await listWorktreesStrict(repoPath)
    return { ok: true, worktrees }
  } catch {
    return { ok: false, worktrees: [] }
  }
}

/**
 * Git lists a path once per registration, so a stale one naming a live checkout repeats it and two
 * rows share one worktree id (#23631). Git lists the main checkout first, so its real row is kept;
 * git gives repeats of a linked path no reliable order. Exact match only: the paths belong to the
 * execution host, whose case and alias rules this process cannot assume.
 */
export function dropRepeatedWorktreePaths(
  scan: RuntimeWorktreeScanResult
): RuntimeWorktreeScanResult {
  const seenPaths = new Set<string>()
  const worktrees = scan.worktrees.filter((worktree) => {
    if (seenPaths.has(worktree.path)) {
      return false
    }
    seenPaths.add(worktree.path)
    return true
  })
  return worktrees.length === scan.worktrees.length ? scan : { ...scan, worktrees }
}
