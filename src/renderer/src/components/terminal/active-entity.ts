import type { AppState } from '@/store/types'

/**
 * Resolve the entity id (terminal tab id, editor file id, or browser tab id)
 * that corresponds to the currently active tab in the given worktree, based
 * on the store's activeTabType. Returns null when no active entity can be
 * resolved — callers should fall back to append-at-end behavior.
 *
 * Why: tabBarOrderByWorktree is a flat list keyed by entity id across all
 * three tab surface types. Inserting a new tab "after the active one" means
 * looking up which id in that flat list represents whatever tab is currently
 * focused, regardless of which surface it belongs to.
 */
export function resolveActiveEntityId(state: AppState, worktreeId: string): string | null {
  const type = state.activeTabTypeByWorktree?.[worktreeId] ?? state.activeTabType
  if (type === 'editor') {
    return state.activeFileIdByWorktree?.[worktreeId] ?? state.activeFileId ?? null
  }
  if (type === 'browser') {
    return state.activeBrowserTabIdByWorktree?.[worktreeId] ?? state.activeBrowserTabId ?? null
  }
  return state.activeTabIdByWorktree?.[worktreeId] ?? state.activeTabId ?? null
}
