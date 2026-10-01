import type { GitWorktreeInfo } from '../../shared/worktree/types'
import type { RuntimeWorktreeScanResult } from './repo-worktree-resolution-scan'

/** What a folder has checked out; `branch` is empty when HEAD is detached. */
export type CheckedOutWorktreeHead = Pick<GitWorktreeInfo, 'branch' | 'head'>

/**
 * Git lists a path once per registration, so a stale one naming a live checkout repeats it and two
 * rows share one worktree id (#23631). Rows that agree collapse to one. Git lists rows that disagree
 * in no order that marks the live one, so the folder is asked; without a matching answer they all stay.
 * Paths match exactly: they belong to the execution host, whose case and alias rules are not known here.
 */
export async function resolveRepeatedWorktreeRows(
  scan: RuntimeWorktreeScanResult,
  readCheckedOutHead: (worktreePath: string) => Promise<CheckedOutWorktreeHead | null>
): Promise<RuntimeWorktreeScanResult> {
  const rowsByPath = new Map<string, GitWorktreeInfo[]>()
  for (const worktree of scan.worktrees) {
    const rows = rowsByPath.get(worktree.path) ?? []
    if (!rows.some((row) => row.branch === worktree.branch && row.head === worktree.head)) {
      rows.push(worktree)
    }
    rowsByPath.set(worktree.path, rows)
  }
  await Promise.all(
    [...rowsByPath].map(async ([worktreePath, rows]) => {
      if (rows.length === 1) {
        return
      }
      const checkedOut = await readCheckedOutHead(worktreePath)
      const live = rows.find(
        (row) => row.branch === checkedOut?.branch && row.head === checkedOut.head
      )
      if (live) {
        rowsByPath.set(worktreePath, [live])
      }
    })
  )
  const worktrees = [...rowsByPath.values()].flat()
  return worktrees.length === scan.worktrees.length ? scan : { ...scan, worktrees }
}
