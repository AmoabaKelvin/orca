import { useAppStore } from '@/store'

// Why: a create that outlives its panel (e.g. after generation) must not reveal the review over a worktree the user has since switched to.
// A mounted panel already shows the review's worktree, which can differ from the selected one (Checks follows the terminal cwd).
export function createdReviewIsForeground(
  worktreeId: string | null,
  panelMounted = false
): boolean {
  return panelMounted || useAppStore.getState().activeWorktreeId === worktreeId
}
