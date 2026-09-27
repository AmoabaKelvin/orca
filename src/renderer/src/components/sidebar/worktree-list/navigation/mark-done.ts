import type { AppState } from '@/store/types'
import {
  DEFAULT_WORKSPACE_STATUS_ID,
  getWorkspaceStatus,
  isWorkspaceStatusId
} from '../../../../../../shared/workspace-statuses'
import type { WorkspaceStatusDefinition, Worktree } from '../../../../../../shared/worktree/types'

const IN_PROGRESS_STATUS_ID = DEFAULT_WORKSPACE_STATUS_ID
const DONE_STATUS_ID = 'completed'

export type MarkDoneTarget = Pick<Worktree, 'id' | 'hostId'>

function isInProgress(
  worktree: Pick<Worktree, 'workspaceStatus'> | undefined,
  statuses: readonly WorkspaceStatusDefinition[]
): boolean {
  return (
    worktree !== undefined &&
    isWorkspaceStatusId(IN_PROGRESS_STATUS_ID, statuses) &&
    getWorkspaceStatus(worktree, statuses) === IN_PROGRESS_STATUS_ID
  )
}

/** Requests moving each In progress target to Done; true means a write was requested, not persisted. */
export function markWorkspacesDone(
  state: Pick<AppState, 'getKnownWorktreeById' | 'updateWorktreeMeta' | 'workspaceStatuses'>,
  targets: readonly MarkDoneTarget[]
): boolean {
  const statuses = state.workspaceStatuses
  // Why: statuses are user-editable; a board without Done has nothing to move to.
  if (!isWorkspaceStatusId(DONE_STATUS_ID, statuses)) {
    return false
  }
  const worktrees = targets.flatMap((target) => {
    const worktree = state.getKnownWorktreeById(target.id, target.hostId)
    return worktree && isInProgress(worktree, statuses) ? [worktree] : []
  })
  for (const worktree of worktrees) {
    // Why: same write as the right-click status menu, so a failed save reverts silently there too.
    void state.updateWorktreeMeta(
      worktree.id,
      { workspaceStatus: DONE_STATUS_ID },
      {
        executionHostId: worktree.hostId ?? 'local',
        shouldApply: (current) => isInProgress(current, statuses)
      }
    )
  }
  return worktrees.length > 0
}
