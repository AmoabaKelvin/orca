import { useCallback } from 'react'
import { detectLanguage } from '@/lib/language-detect'
import { joinPath } from '@/lib/path'
import { isFolderRepo } from '../../../../shared/repo-kind'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { useAppStore } from '../../store'
import { selectRepoByIdForActiveWorkspace } from '../../store/selectors'
import type { NativeChatFileLinkContext } from './native-chat-file-link'

/** Opens the workspace's current diff of one file (path from the workspace root), or of every
 *  uncommitted change when given none. Current, so it may not match what an older turn did. */
export type NativeChatTurnDiffViewer = (relativePath?: string) => void

/** Undefined where there is no git diff to open: no workspace, or a folder one. */
export function useNativeChatTurnDiffViewer(
  context: NativeChatFileLinkContext | null
): NativeChatTurnDiffViewer | undefined {
  const worktreeId = context?.worktreeId
  const hasGit = useAppStore((state) => {
    if (!worktreeId || parseWorkspaceKey(worktreeId)?.type === 'folder') {
      return false
    }
    const repoId = state.getKnownWorktreeById(worktreeId)?.repoId ?? null
    const repo = selectRepoByIdForActiveWorkspace(state, repoId)
    return repo !== null && !isFolderRepo(repo)
  })
  const open = useCallback<NativeChatTurnDiffViewer>(
    (relativePath) => {
      if (!context) {
        return
      }
      const state = useAppStore.getState()
      if (relativePath === undefined) {
        state.openAllDiffs(context.worktreeId, context.worktreePath)
        return
      }
      state.openDiff(
        context.worktreeId,
        joinPath(context.worktreePath, relativePath),
        relativePath,
        detectLanguage(relativePath),
        false,
        { runtimeEnvironmentId: context.runtimeEnvironmentId }
      )
    },
    [context]
  )
  return context && hasGit ? open : undefined
}
