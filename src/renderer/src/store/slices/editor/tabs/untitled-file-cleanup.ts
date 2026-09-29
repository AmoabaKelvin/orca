import type { AppState } from '../../../types'
import type { OpenFile } from '../types/open-file'
import { findWorktreeById } from '../../worktree-helpers'
import { getEditorFileOperationContext } from '@/lib/editor-file-operation-owner'
import {
  deleteRuntimePath,
  deleteRuntimeRelativePath,
  statRuntimePath
} from '@/runtime/runtime-file-client'

export function deleteUntouchedUntitledFile(state: AppState, file: OpenFile): void {
  const worktree = findWorktreeById(state.worktreesByRepo, file.worktreeId)
  const owningRuntimeEnvironmentId = file.runtimeEnvironmentId?.trim()
  let context: ReturnType<typeof getEditorFileOperationContext>
  try {
    context = getEditorFileOperationContext(state, file, worktree?.path ?? null)
  } catch {
    return
  }
  // Why: agents, external editors, and paired clients can fill the file without this window's keep flag, so delete only a still-empty placeholder.
  void statRuntimePath(context, file.filePath)
    .then(async (stat) => {
      if (stat.size !== 0) {
        return
      }
      const deletedRemotely = await deleteRuntimeRelativePath(context, file.relativePath)
      if (!deletedRemotely && !owningRuntimeEnvironmentId) {
        await deleteRuntimePath(context, file.filePath)
      }
    })
    .catch(() => {})
}

export function shouldDeleteUntouchedUntitledFile(
  file: OpenFile | undefined,
  hasDraft: boolean
): boolean {
  return (
    file?.isUntitled === true && !file.isDirty && !hasDraft && file.deleteUntouchedOnClose !== false
  )
}
