import { useAppStore } from '@/store'
import { getRepoMapFromState, getWorktreeMapFromState } from '@/store/selectors'
import { playDesktopNotificationSound } from '@/lib/desktop-notification-sound'

export type TerminalNotificationEvent = {
  source: 'terminal-bell' | 'agent-task-complete'
  terminalTitle?: string
}

export function dispatchTerminalNotification(
  worktreeId: string,
  event: TerminalNotificationEvent
): void {
  const state = useAppStore.getState()

  // Why: shutdownWorktreeTerminals clears ptyIdsByTabId synchronously before
  // killing PTYs asynchronously. Any notification arriving after that point is
  // stale — e.g. a staleTitleTimer that fires after shutdown, an agent tracker
  // transition from accumulated closure state, or a hook event for a dead pane.
  // Checking for live PTYs at dispatch time catches all phantom notification
  // sources rather than trying to cancel each timer or callback individually.
  const tabs = state.tabsByWorktree[worktreeId] ?? []
  const hasLivePtys = tabs.some((tab) => (state.ptyIdsByTabId[tab.id] ?? []).length > 0)
  if (!hasLivePtys) {
    return
  }

  // Why: prefer worktree.repoId over string-parsing the worktreeId. The
  // `${repoId}::${path}` format is an implementation detail of id construction;
  // coupling the notification dispatcher to it would silently drop the repo
  // label if that format ever changes. The worktree object is the source of
  // truth for its owning repo.
  const worktree = getWorktreeMapFromState(state).get(worktreeId)
  const repo = worktree ? getRepoMapFromState(state).get(worktree.repoId) : null
  const customSoundPath = state.settings?.notifications?.customSoundPath ?? null

  void window.api.notifications
    .dispatch({
      source: event.source,
      worktreeId,
      repoLabel: repo?.displayName,
      worktreeLabel: worktree?.displayName || worktree?.branch || worktreeId,
      terminalTitle: event.terminalTitle,
      isActiveWorktree: state.activeWorktreeId === worktreeId
    })
    .then((result) => {
      if (result.delivered) {
        void playDesktopNotificationSound(customSoundPath)
      }
    })
    .catch((err) => {
      console.warn('Failed to dispatch notification:', err)
    })
}
