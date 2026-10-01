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
import { composeWorktreeHostIdentity } from '../../../../../../shared/worktree/host-qualified-identity'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../../shared/execution-host'
import { getDeleteStateForWorktreeHost } from '../../worktree-delete-state-host-match'

export type MarkDoneTarget = Pick<Worktree, 'id' | 'hostId'>

type MarkDoneState = Pick<
  AppState,
  | 'activeWorktreeId'
  | 'activeWorkspaceExecutionHostId'
  | 'deleteStateByWorktreeId'
  | 'getKnownWorktreeById'
  | 'workspaceStatuses'
>

// Why: a multi-row selection is what the right-click status menu acts on. Otherwise the
// target is the active row, which arrows move; hover (the delete shortcut's target) is a mouse signal.
function getMarkDoneTargets(
  state: MarkDoneState,
  selectedWorktrees: readonly MarkDoneTarget[]
): readonly MarkDoneTarget[] {
  if (selectedWorktrees.length > 1) {
    // Why: a host-less lookup can return a same-path row on another host; an unhosted row is local.
    return selectedWorktrees.map(({ id, hostId }) => ({
      id,
      hostId: hostId ?? LOCAL_EXECUTION_HOST_ID
    }))
  }
  return state.activeWorktreeId
    ? [{ id: state.activeWorktreeId, hostId: state.activeWorkspaceExecutionHostId ?? undefined }]
    : []
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

/** The rows the key would move; the only place its target and eligibility rules live. */
export function resolveMarkDoneTargets(
  state: MarkDoneState,
  selectedWorktrees: readonly MarkDoneTarget[]
): readonly Worktree[] {
  const statuses = state.workspaceStatuses
  // Why: statuses are user-editable; a board without Done has nothing to move to.
  if (!statuses.some((status) => status.id === DONE_WORKSPACE_STATUS_ID)) {
    return []
  }
  return getMarkDoneTargets(state, selectedWorktrees).flatMap((target) => {
    const worktree = state.getKnownWorktreeById(target.id, target.hostId)
    if (!worktree || !hasStatus(worktree, DEFAULT_WORKSPACE_STATUS_ID, statuses)) {
      return []
    }
    // Why: the right-click status submenu is disabled mid-delete; the keyboard path matches it.
    return getDeleteStateForWorktreeHost(worktree, state.deleteStateByWorktreeId)?.isDeleting
      ? []
      : [worktree]
  })
}

function hostQualifiedKey(worktree: MarkDoneTarget): string {
  return composeWorktreeHostIdentity(worktree.hostId ?? LOCAL_EXECUTION_HOST_ID, worktree.id)
}

/** Whether the key, with `rows` as the sidebar selection, would move exactly `rows`. */
export function markDoneKeyMovesExactly(
  state: MarkDoneState,
  rows: readonly MarkDoneTarget[]
): boolean {
  const moved = resolveMarkDoneTargets(state, rows)
  const movedKeys = new Set(moved.map(hostQualifiedKey))
  return (
    moved.length === rows.length &&
    movedKeys.size === rows.length &&
    rows.every((row) => movedKeys.has(hostQualifiedKey(row)))
  )
}

/** Requests moving the key's rows to Done; true means a write was requested, not persisted. */
export function markWorkspacesDone(
  state: MarkDoneState & Pick<AppState, 'updateWorktreeMeta'>,
  selectedWorktrees: readonly MarkDoneTarget[]
): boolean {
  const statuses = state.workspaceStatuses
  const doneStatus = statuses.find((status) => status.id === DONE_WORKSPACE_STATUS_ID)
  const worktrees = resolveMarkDoneTargets(state, selectedWorktrees)
  if (!doneStatus || worktrees.length === 0) {
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
