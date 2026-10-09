import { getRelativePathInsideRoot } from '@/lib/path'
import { resolveRuntimePath } from '../../../../shared/cross-platform-path'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import { buildDiffSummaries } from './native-chat-edit-cards'

export type NativeChatDiffTarget = {
  messageId: string
  editKey: string
  fileIndex: number
  /** The subagent sections the row sits in, outermost first, which a reveal opens. */
  subagentSections?: readonly string[]
}

export type NativeChatDiffReveal = NativeChatDiffTarget & { requestId: number }

export type NativeChatTurnDiffFile = {
  /** From the workspace root when inside it, so one file has one name however a provider wrote it. */
  path: string
  inWorkspace: boolean
  added: number
  removed: number
  truncated: boolean
  target: NativeChatDiffTarget
}

export type NativeChatTurnDiff = {
  files: NativeChatTurnDiffFile[]
  /** Roughly how many rows the card's tree draws: its files and the folders holding them. */
  treeRows: number
  added: number
  removed: number
  truncated: boolean
}

/** Recorded edit totals, grouped by the transcript's already-resolved turn boundaries. */
export function nativeChatTurnDiffs(
  messages: readonly NativeChatMessage[],
  turnKeys: readonly (string | undefined)[],
  {
    subagentSectionsOf,
    partialTurnKey,
    worktreePath
  }: {
    subagentSectionsOf?: ReadonlyMap<string, readonly string[]>
    /** A turn only partly loaded, whose totals would read as the whole turn's. */
    partialTurnKey?: string
    worktreePath?: string | null
  } = {}
): Map<string, NativeChatTurnDiff> {
  const located = (path: string): Pick<NativeChatTurnDiffFile, 'path' | 'inWorkspace'> => {
    const relative = worktreePath
      ? getRelativePathInsideRoot(resolveRuntimePath(worktreePath, path), worktreePath)
      : null
    return relative === null ? { path, inWorkspace: false } : { path: relative, inWorkspace: true }
  }
  const turns = new Map<string, Map<string, NativeChatTurnDiffFile>>()
  for (const [index, message] of messages.entries()) {
    const turnKey = turnKeys[index]
    if (!turnKey || turnKey === partialTurnKey) {
      continue
    }
    const sections = subagentSectionsOf?.get(message.id)
    for (const edit of buildDiffSummaries(message.blocks).values()) {
      let files = turns.get(turnKey)
      if (!files) {
        files = new Map()
        turns.set(turnKey, files)
      }
      for (const [fileIndex, file] of edit.files.entries()) {
        const place = located(file.path)
        const oldPath = file.oldPath ? located(file.oldPath).path : null
        const previous = files.get(place.path)
        const renamed = oldPath && oldPath !== place.path ? files.get(oldPath) : undefined
        if (renamed) {
          files.delete(renamed.path)
        }
        files.set(place.path, {
          ...place,
          added: file.added + (previous?.added ?? 0) + (renamed?.added ?? 0),
          removed: file.removed + (previous?.removed ?? 0) + (renamed?.removed ?? 0),
          truncated:
            file.truncated || (previous?.truncated ?? false) || (renamed?.truncated ?? false),
          target: {
            messageId: message.id,
            editKey: edit.key,
            fileIndex,
            ...(sections === undefined ? {} : { subagentSections: sections })
          }
        })
      }
    }
  }
  return new Map(
    Array.from(turns, ([key, byPath]) => {
      const files = Array.from(byPath.values())
      return [
        key,
        {
          files,
          treeRows:
            files.length +
            new Set(files.map((file) => file.path.replace(/[\\/]?[^\\/]*$/, '')).filter(Boolean))
              .size,
          added: files.reduce((sum, file) => sum + file.added, 0),
          removed: files.reduce((sum, file) => sum + file.removed, 0),
          truncated: files.some((file) => file.truncated)
        }
      ]
    })
  )
}
