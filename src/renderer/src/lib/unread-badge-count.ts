import {
  filterFolderWorkspacesForVisibleHosts,
  filterProjectGroupsForVisibleHosts
} from '@/components/sidebar/worktree-list/listing/host-filtering'
import { getRenderableFolderWorkspaces } from '@/components/sidebar/worktree-list/grouping/folder-workspace-lanes'
import { worktreeMatchesVisibleHost } from '@/components/sidebar/visible-worktree-host-scope'
import { filterFolderWorkspacesFromOtherDevices } from '@/components/sidebar/workspace-creator-visibility'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { FolderWorkspace } from '../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../shared/project-group-types'
import type { Repo } from '../../../shared/repo-types'
import { getWorktreeHostIdentity } from '../../../shared/worktree/host-qualified-identity'
import type { Worktree } from '../../../shared/worktree/types'

export type UnreadBadgeCountSources = {
  worktreesByRepo: Readonly<Record<string, readonly Worktree[]>>
  folderWorkspaces: readonly FolderWorkspace[]
  projectGroups: readonly ProjectGroup[]
  repoMap: Map<string, Repo>
  /** null when the sidebar shows every host. */
  visibleHostIds: ReadonlySet<ExecutionHostId> | null
  defaultHostId: ExecutionHostId
  /** null unless the sidebar hides workspaces created from other devices. */
  hiddenOtherDevicePairings: ReadonlyMap<string, string> | null
}

/**
 * Why workspace flags only: the flag is what the sidebar draws and what visiting a workspace
 * clears. Tab markers outlive both, so counting them left a number with nothing to find (#23363).
 */
export function getUnreadBadgeCount(sources: UnreadBadgeCountSources): number {
  const { visibleHostIds, defaultHostId } = sources
  // Why host identity: a repo on two hosts publishes one id for two sidebar rows.
  const unreadWorktrees = new Set<string>()
  for (const worktrees of Object.values(sources.worktreesByRepo)) {
    for (const worktree of worktrees) {
      // Why: the sidebar never renders an archived worktree, nor one on a host it is not showing.
      if (
        worktree.isUnread &&
        !worktree.isArchived &&
        worktreeMatchesVisibleHost(worktree, visibleHostIds, sources.repoMap, defaultHostId)
      ) {
        unreadWorktrees.add(getWorktreeHostIdentity(worktree))
      }
    }
  }
  return unreadWorktrees.size + countUnreadFolderRows(sources)
}

/** Folder workspaces through the same membership steps the sidebar runs before building rows. */
function countUnreadFolderRows(sources: UnreadBadgeCountSources): number {
  const { projectGroups, visibleHostIds, defaultHostId, hiddenOtherDevicePairings } = sources
  const unread = sources.folderWorkspaces.filter((folderWorkspace) => folderWorkspace.isUnread)
  if (unread.length === 0) {
    return 0
  }
  const onVisibleHosts = filterFolderWorkspacesForVisibleHosts(
    unread,
    projectGroups,
    visibleHostIds,
    defaultHostId
  )
  return getRenderableFolderWorkspaces(
    hiddenOtherDevicePairings
      ? filterFolderWorkspacesFromOtherDevices(onVisibleHosts, hiddenOtherDevicePairings)
      : onVisibleHosts,
    filterProjectGroupsForVisibleHosts(projectGroups, visibleHostIds, defaultHostId)
  ).length
}
