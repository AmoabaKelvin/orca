import type { GitWorktreeInfo } from '../../shared/worktree/types'
import type { RuntimeWorktreeScanResult } from './repo-worktree-resolution-scan'
import { withTimeout } from './runtime-async-boundaries'

/** What a folder has checked out; `branch` is empty when HEAD is detached. */
export type CheckedOutWorktreeHead = Pick<GitWorktreeInfo, 'branch' | 'head'>

export type RepeatedWorktreeRows = {
  /** The scan with repeats that agree collapsed; rows that disagree are all still in it. */
  result: RuntimeWorktreeScanResult
  /** Settles to the scan once the folders have decided their disagreeing rows; null when none disagree. */
  repeatedRowsSettled: Promise<RuntimeWorktreeScanResult> | null
}

/**
 * Git lists a path once per registration, so a stale one naming a live checkout repeats it and two
 * rows share one worktree id (#23631). Rows that agree collapse to one. Git lists rows that disagree
 * in no order that marks the live one, so the folder is asked; without a matching answer they all stay.
 * Paths match exactly: they belong to the execution host, whose case and alias rules are not known here.
 */
export function resolveRepeatedWorktreeRows(
  scan: RuntimeWorktreeScanResult,
  readCheckedOutHead: (worktreePath: string) => Promise<CheckedOutWorktreeHead | null>
): RepeatedWorktreeRows {
  const rowsByPath = new Map<string, GitWorktreeInfo[]>()
  for (const worktree of scan.worktrees) {
    const rows = rowsByPath.get(worktree.path) ?? []
    if (!rows.some((row) => row.branch === worktree.branch && row.head === worktree.head)) {
      rows.push(worktree)
    }
    rowsByPath.set(worktree.path, rows)
  }
  const withRows = (): RuntimeWorktreeScanResult => {
    const worktrees = [...rowsByPath.values()].flat()
    return worktrees.length === scan.worktrees.length ? scan : { ...scan, worktrees }
  }
  const result = withRows()
  const disagreeing = [...rowsByPath].filter(([, rows]) => rows.length > 1)
  if (disagreeing.length === 0) {
    return { result, repeatedRowsSettled: null }
  }
  const repeatedRowsSettled = Promise.all(
    disagreeing.map(async ([worktreePath, rows]) => {
      const checkedOut = await readCheckedOutHead(worktreePath).catch(() => null)
      const live = rows.find(
        (row) => row.branch === checkedOut?.branch && row.head === checkedOut.head
      )
      if (live) {
        rowsByPath.set(worktreePath, [live])
      }
    })
  ).then(withRows)
  return { result, repeatedRowsSettled }
}

/**
 * The folders' verdict if it arrives inside what is left of `waitMs` since the caller asked, else
 * git's rows as listed. Why per caller: the probe runs on its own clock, and a caller that outwaits
 * its budget loses a listing git already answered to the persisted-row fallback. Why `overtaken`
 * ends the wait: the caller re-lists then, and waiting first spends the budget that listing needs.
 */
export async function awaitRepeatedRowsWithinBudget(
  { result, repeatedRowsSettled }: RepeatedWorktreeRows,
  askedAt: number,
  waitMs: number,
  overtaken: AbortSignal
): Promise<RuntimeWorktreeScanResult> {
  // Why clamped: a backward clock step must not extend the wait past the whole window.
  const remainingMs = Math.min(askedAt + waitMs - Date.now(), waitMs)
  if (!repeatedRowsSettled || remainingMs <= 0 || overtaken.aborted) {
    return result
  }
  let stopWaiting = (): void => {}
  const whenOvertaken = new Promise<null>((resolve) => {
    stopWaiting = () => resolve(null)
  })
  overtaken.addEventListener('abort', stopWaiting)
  try {
    return (
      (await withTimeout(Promise.race([repeatedRowsSettled, whenOvertaken]), remainingMs, null)) ??
      result
    )
  } finally {
    // Why removed: the signal outlives this wait, and a kept listener pins these rows until the next worktree change.
    overtaken.removeEventListener('abort', stopWaiting)
  }
}
