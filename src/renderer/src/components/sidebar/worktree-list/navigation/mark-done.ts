import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import {
  DEFAULT_WORKSPACE_STATUS_ID,
  DONE_WORKSPACE_STATUS_ID,
  getWorkspaceStatus,
  isWorkspaceStatusId
} from '../../../../../../shared/workspace-statuses'
import type { WorkspaceStatusDefinition, Worktree } from '../../../../../../shared/worktree/types'
import { getWorktreeHostIdentity } from '../../../../../../shared/worktree/host-qualified-identity'
import { getDeleteStateForWorktreeHost } from '../../worktree-delete-state-host-match'

export type MarkDoneTarget = Pick<Worktree, 'id' | 'hostId'>

type ActiveWorkspaceState = Pick<AppState, 'activeWorktreeId' | 'activeWorkspaceExecutionHostId'>

// Why: a multi-row selection is what the right-click status menu acts on. Otherwise the
// target is the active row, which arrows move; hover (the delete shortcut's target) is a mouse signal.
export function getMarkDoneTargets(
  state: ActiveWorkspaceState,
  selectedWorktrees: readonly MarkDoneTarget[]
): readonly MarkDoneTarget[] {
  if (selectedWorktrees.length > 1) {
    return selectedWorktrees
  }
  return state.activeWorktreeId
    ? [{ id: state.activeWorktreeId, hostId: state.activeWorkspaceExecutionHostId ?? undefined }]
    : []
}

/** Whether the key, pressed without a multi-row selection, acts on this row. */
export function isActiveMarkDoneTarget(
  state: ActiveWorkspaceState & Pick<AppState, 'getKnownWorktreeById'>,
  worktree: MarkDoneTarget
): boolean {
  const [target] = getMarkDoneTargets(state, [])
  const active = target ? state.getKnownWorktreeById(target.id, target.hostId) : undefined
  return (
    active !== undefined && getWorktreeHostIdentity(active) === getWorktreeHostIdentity(worktree)
  )
}

function hasStatus(
  worktree: Pick<Worktree, 'workspaceStatus'> | undefined,
  status: string,
  statuses: readonly WorkspaceStatusDefinition[]
): boolean {
  return (
    worktree !== undefined &&
    isWorkspaceStatusId(status, statuses) &&
    getWorkspaceStatus(worktree, statuses) === status
  )
}

/** Requests moving each In progress target to Done; true means a write was requested, not persisted. */
export function markWorkspacesDone(
  state: Pick<
    AppState,
    'deleteStateByWorktreeId' | 'getKnownWorktreeById' | 'updateWorktreeMeta' | 'workspaceStatuses'
  >,
  targets: readonly MarkDoneTarget[]
): boolean {
  const statuses = state.workspaceStatuses
  // Why: statuses are user-editable; a board without Done has nothing to move to.
  const doneStatus = statuses.find((status) => status.id === DONE_WORKSPACE_STATUS_ID)
  if (!doneStatus) {
    return false
  }
  const worktrees = targets.flatMap((target) => {
    const worktree = state.getKnownWorktreeById(target.id, target.hostId)
    if (!worktree || !hasStatus(worktree, DEFAULT_WORKSPACE_STATUS_ID, statuses)) {
      return []
    }
    // Why: the right-click status submenu is disabled mid-delete; the keyboard path matches it.
    return getDeleteStateForWorktreeHost(worktree, state.deleteStateByWorktreeId)?.isDeleting
      ? []
      : [worktree]
  })
  if (worktrees.length === 0) {
    return false
  }
  for (const worktree of worktrees) {
    // Why: same write as the right-click status menu, so a failed save reverts silently there too.
    void state.updateWorktreeMeta(
      worktree.id,
      { workspaceStatus: DONE_WORKSPACE_STATUS_ID },
      {
        executionHostId: worktree.hostId ?? 'local',
        shouldApply: (current) => hasStatus(current, DEFAULT_WORKSPACE_STATUS_ID, statuses)
      }
    )
  }
  showMarkedDoneToast(worktrees, doneStatus.label)
  return true
}

// Why: a key press has no visible confirmation, and the row can move into a collapsed Done section.
function showMarkedDoneToast(worktrees: readonly Worktree[], statusLabel: string): void {
  const [first] = worktrees
  toast(
    worktrees.length === 1 && first
      ? translate('auto.components.sidebar.markDone.movedOne', 'Moved {{name}} to {{status}}', {
          name: first.displayName,
          status: statusLabel
        })
      : translate(
          'auto.components.sidebar.markDone.movedMany',
          'Moved {{count}} workspaces to {{status}}',
          {
            count: worktrees.length,
            status: statusLabel
          }
        ),
    {
      action: {
        label: translate('auto.components.sidebar.markDone.undo', 'Undo'),
        onClick: () => undoMarkedDone(worktrees)
      }
    }
  )
}

function undoMarkedDone(worktrees: readonly Worktree[]): void {
  const { updateWorktreeMeta, workspaceStatuses } = useAppStore.getState()
  if (!isWorkspaceStatusId(DEFAULT_WORKSPACE_STATUS_ID, workspaceStatuses)) {
    return
  }
  for (const worktree of worktrees) {
    void updateWorktreeMeta(
      worktree.id,
      { workspaceStatus: DEFAULT_WORKSPACE_STATUS_ID },
      {
        executionHostId: worktree.hostId ?? 'local',
        // Why: a status set after the key press wins over the undo.
        shouldApply: (current) => hasStatus(current, DONE_WORKSPACE_STATUS_ID, workspaceStatuses)
      }
    )
  }
}
