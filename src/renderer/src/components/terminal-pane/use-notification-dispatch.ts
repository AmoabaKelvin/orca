import { useCallback } from 'react'
import { useAppStore } from '@/store'

/**
 * Returns a stable dispatch function for terminal notifications.
 * Reads repo/worktree labels from the store at dispatch time rather
 * than via selectors — avoids the allWorktrees() anti-pattern which
 * creates a new array reference on every store update and triggers
 * excessive re-renders of TerminalPane.
 */
export function useNotificationDispatch(
  worktreeId: string
): (event: { source: 'agent-task-complete' | 'terminal-bell'; terminalTitle?: string }) => void {
  return useCallback(
    (event: { source: 'agent-task-complete' | 'terminal-bell'; terminalTitle?: string }) => {
      const state = useAppStore.getState()
      const repoId = worktreeId.includes('::') ? worktreeId.slice(0, worktreeId.indexOf('::')) : ''
      const repo = state.repos.find((c) => c.id === repoId)
      const worktree = state.allWorktrees().find((c) => c.id === worktreeId)

      void window.api.notifications.dispatch({
        source: event.source,
        worktreeId,
        repoLabel: repo?.displayName,
        worktreeLabel: worktree?.displayName || worktree?.branch || worktreeId,
        terminalTitle: event.terminalTitle,
        isActiveWorktree: state.activeWorktreeId === worktreeId
      })
    },
    [worktreeId]
  )
}
