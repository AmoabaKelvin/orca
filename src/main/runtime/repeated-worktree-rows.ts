import type { RuntimeWorktreeScanResult } from './repo-worktree-resolution-scan'

/**
 * Git lists a path once per registration, so a stale one naming a live checkout repeats it and two
 * rows share one worktree id (#23631). Only a row matching an earlier one in path, branch and head
 * is dropped: rows that disagree give no reliable sign of which is live. Exact match only: the
 * paths belong to the execution host, whose case and alias rules are not known here.
 */
export function dropRepeatedWorktreeRows(
  scan: RuntimeWorktreeScanResult
): RuntimeWorktreeScanResult {
  const seenRows = new Set<string>()
  const worktrees = scan.worktrees.filter((worktree) => {
    const row = `${worktree.path}\0${worktree.branch}\0${worktree.head}`
    if (seenRows.has(row)) {
      return false
    }
    seenRows.add(row)
    return true
  })
  return worktrees.length === scan.worktrees.length ? scan : { ...scan, worktrees }
}
