/* eslint-disable max-lines */
import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { Tab, TabGroup, TabContentType, WorkspaceSessionState } from '../../../../shared/types'

export type TabsSlice = {
  // ─── State ──────────────────────────────────────────────────────────
  unifiedTabsByWorktree: Record<string, Tab[]>
  groupsByWorktree: Record<string, TabGroup[]>
  activeGroupIdByWorktree: Record<string, string>

  // ─── Actions ────────────────────────────────────────────────────────
  createUnifiedTab: (
    worktreeId: string,
    contentType: TabContentType,
    init?: Partial<Pick<Tab, 'id' | 'label' | 'customLabel' | 'color' | 'isPreview' | 'isPinned'>>
  ) => Tab
  closeUnifiedTab: (
    tabId: string
  ) => { closedTabId: string; wasLastTab: boolean; worktreeId: string } | null
  activateTab: (tabId: string) => void
  reorderUnifiedTabs: (groupId: string, tabIds: string[]) => void
  setTabLabel: (tabId: string, label: string) => void
  setTabCustomLabel: (tabId: string, label: string | null) => void
  setUnifiedTabColor: (tabId: string, color: string | null) => void
  pinTab: (tabId: string) => void
  unpinTab: (tabId: string) => void
  closeOtherTabs: (tabId: string) => string[]
  closeTabsToRight: (tabId: string) => string[]
  getActiveTab: (worktreeId: string) => Tab | null
  getTab: (tabId: string) => Tab | null
  hydrateTabsSession: (session: WorkspaceSessionState) => void
}

// ─── Helpers ────────────────────────────────────────────────────────

function findTabAndWorktree(
  tabsByWorktree: Record<string, Tab[]>,
  tabId: string
): { tab: Tab; worktreeId: string } | null {
  for (const [worktreeId, tabs] of Object.entries(tabsByWorktree)) {
    const tab = tabs.find((t) => t.id === tabId)
    if (tab) {
      return { tab, worktreeId }
    }
  }
  return null
}

function findGroupForTab(
  groupsByWorktree: Record<string, TabGroup[]>,
  worktreeId: string,
  groupId: string
): TabGroup | null {
  const groups = groupsByWorktree[worktreeId] ?? []
  return groups.find((g) => g.id === groupId) ?? null
}

function ensureGroup(
  groupsByWorktree: Record<string, TabGroup[]>,
  activeGroupIdByWorktree: Record<string, string>,
  worktreeId: string
): {
  group: TabGroup
  groupsByWorktree: Record<string, TabGroup[]>
  activeGroupIdByWorktree: Record<string, string>
} {
  const existing = groupsByWorktree[worktreeId]?.[0]
  if (existing) {
    return { group: existing, groupsByWorktree, activeGroupIdByWorktree }
  }
  const groupId = globalThis.crypto.randomUUID()
  const group: TabGroup = { id: groupId, worktreeId, activeTabId: null, tabOrder: [] }
  return {
    group,
    groupsByWorktree: { ...groupsByWorktree, [worktreeId]: [group] },
    activeGroupIdByWorktree: { ...activeGroupIdByWorktree, [worktreeId]: groupId }
  }
}

/** Pick the nearest neighbor in visual order (right first, then left). */
function pickNeighbor(tabOrder: string[], closingTabId: string): string | null {
  const idx = tabOrder.indexOf(closingTabId)
  if (idx === -1) {
    return null
  }
  if (idx + 1 < tabOrder.length) {
    return tabOrder[idx + 1]
  }
  if (idx - 1 >= 0) {
    return tabOrder[idx - 1]
  }
  return null
}

function updateGroup(groups: TabGroup[], updated: TabGroup): TabGroup[] {
  return groups.map((g) => (g.id === updated.id ? updated : g))
}

// ─── Slice ──────────────────────────────────────────────────────────

export const createTabsSlice: StateCreator<AppState, [], [], TabsSlice> = (set, get) => ({
  unifiedTabsByWorktree: {},
  groupsByWorktree: {},
  activeGroupIdByWorktree: {},

  createUnifiedTab: (worktreeId, contentType, init) => {
    const id = init?.id ?? globalThis.crypto.randomUUID()
    let tab!: Tab

    set((s) => {
      const {
        group,
        groupsByWorktree: nextGroups,
        activeGroupIdByWorktree: nextActiveGroups
      } = ensureGroup(s.groupsByWorktree, s.activeGroupIdByWorktree, worktreeId)

      const existing = s.unifiedTabsByWorktree[worktreeId] ?? []

      // If opening a preview tab, replace any existing preview in the same group
      let filtered = existing
      let removedPreviewId: string | null = null
      if (init?.isPreview) {
        const existingPreview = existing.find((t) => t.isPreview && t.groupId === group.id)
        if (existingPreview) {
          filtered = existing.filter((t) => t.id !== existingPreview.id)
          removedPreviewId = existingPreview.id
        }
      }

      tab = {
        id,
        groupId: group.id,
        worktreeId,
        contentType,
        label: init?.label ?? (contentType === 'terminal' ? `Terminal ${existing.length + 1}` : id),
        customLabel: init?.customLabel ?? null,
        color: init?.color ?? null,
        sortOrder: filtered.length,
        createdAt: Date.now(),
        isPreview: init?.isPreview,
        isPinned: init?.isPinned
      }

      // Update group's tabOrder: remove replaced preview, append new tab
      const newTabOrder = removedPreviewId
        ? group.tabOrder.filter((tid) => tid !== removedPreviewId)
        : [...group.tabOrder]
      newTabOrder.push(tab.id)

      const updatedGroupObj: TabGroup = { ...group, activeTabId: tab.id, tabOrder: newTabOrder }

      return {
        unifiedTabsByWorktree: { ...s.unifiedTabsByWorktree, [worktreeId]: [...filtered, tab] },
        groupsByWorktree: {
          ...nextGroups,
          [worktreeId]: updateGroup(nextGroups[worktreeId] ?? [], updatedGroupObj)
        },
        activeGroupIdByWorktree: nextActiveGroups
      }
    })

    return tab
  },

  closeUnifiedTab: (tabId) => {
    const state = get()
    const found = findTabAndWorktree(state.unifiedTabsByWorktree, tabId)
    if (!found) {
      return null
    }

    const { tab, worktreeId } = found
    const group = findGroupForTab(state.groupsByWorktree, worktreeId, tab.groupId)
    if (!group) {
      return null
    }

    const remainingOrder = group.tabOrder.filter((tid) => tid !== tabId)
    const wasLastTab = remainingOrder.length === 0

    let newActiveTabId = group.activeTabId
    if (group.activeTabId === tabId) {
      newActiveTabId = wasLastTab ? null : pickNeighbor(group.tabOrder, tabId)
    }

    set((s) => {
      const tabs = s.unifiedTabsByWorktree[worktreeId] ?? []
      const nextTabs = tabs.filter((t) => t.id !== tabId)
      const updatedGroupObj: TabGroup = {
        ...group,
        activeTabId: newActiveTabId,
        tabOrder: remainingOrder
      }

      return {
        unifiedTabsByWorktree: { ...s.unifiedTabsByWorktree, [worktreeId]: nextTabs },
        groupsByWorktree: {
          ...s.groupsByWorktree,
          [worktreeId]: updateGroup(s.groupsByWorktree[worktreeId] ?? [], updatedGroupObj)
        }
      }
    })

    return { closedTabId: tabId, wasLastTab, worktreeId }
  },

  activateTab: (tabId) => {
    set((s) => {
      const found = findTabAndWorktree(s.unifiedTabsByWorktree, tabId)
      if (!found) {
        return {}
      }

      const { tab, worktreeId } = found
      const groups = s.groupsByWorktree[worktreeId] ?? []
      const updatedGroups = groups.map((g) =>
        g.id === tab.groupId ? { ...g, activeTabId: tabId } : g
      )

      let updatedTabs = s.unifiedTabsByWorktree[worktreeId]
      if (tab.isPreview) {
        updatedTabs = updatedTabs.map((t) => (t.id === tabId ? { ...t, isPreview: false } : t))
      }

      return {
        unifiedTabsByWorktree: { ...s.unifiedTabsByWorktree, [worktreeId]: updatedTabs },
        groupsByWorktree: { ...s.groupsByWorktree, [worktreeId]: updatedGroups }
      }
    })
  },

  reorderUnifiedTabs: (groupId, tabIds) => {
    set((s) => {
      for (const [worktreeId, groups] of Object.entries(s.groupsByWorktree)) {
        const group = groups.find((g) => g.id === groupId)
        if (!group) {
          continue
        }

        const updatedGroupObj: TabGroup = { ...group, tabOrder: tabIds }
        const tabs = s.unifiedTabsByWorktree[worktreeId] ?? []
        const orderMap = new Map(tabIds.map((id, i) => [id, i]))
        const updatedTabs = tabs.map((t) => {
          const newOrder = orderMap.get(t.id)
          return newOrder !== undefined ? { ...t, sortOrder: newOrder } : t
        })

        return {
          groupsByWorktree: {
            ...s.groupsByWorktree,
            [worktreeId]: updateGroup(groups, updatedGroupObj)
          },
          unifiedTabsByWorktree: { ...s.unifiedTabsByWorktree, [worktreeId]: updatedTabs }
        }
      }
      return {}
    })
  },

  setTabLabel: (tabId, label) => {
    set((s) => {
      const found = findTabAndWorktree(s.unifiedTabsByWorktree, tabId)
      if (!found) {
        return {}
      }
      const { worktreeId } = found
      const tabs = s.unifiedTabsByWorktree[worktreeId] ?? []
      return {
        unifiedTabsByWorktree: {
          ...s.unifiedTabsByWorktree,
          [worktreeId]: tabs.map((t) => (t.id === tabId ? { ...t, label } : t))
        }
      }
    })
  },

  setTabCustomLabel: (tabId, label) => {
    set((s) => {
      const found = findTabAndWorktree(s.unifiedTabsByWorktree, tabId)
      if (!found) {
        return {}
      }
      const { worktreeId } = found
      const tabs = s.unifiedTabsByWorktree[worktreeId] ?? []
      return {
        unifiedTabsByWorktree: {
          ...s.unifiedTabsByWorktree,
          [worktreeId]: tabs.map((t) => (t.id === tabId ? { ...t, customLabel: label } : t))
        }
      }
    })
  },

  setUnifiedTabColor: (tabId, color) => {
    set((s) => {
      const found = findTabAndWorktree(s.unifiedTabsByWorktree, tabId)
      if (!found) {
        return {}
      }
      const { worktreeId } = found
      const tabs = s.unifiedTabsByWorktree[worktreeId] ?? []
      return {
        unifiedTabsByWorktree: {
          ...s.unifiedTabsByWorktree,
          [worktreeId]: tabs.map((t) => (t.id === tabId ? { ...t, color } : t))
        }
      }
    })
  },

  pinTab: (tabId) => {
    set((s) => {
      const found = findTabAndWorktree(s.unifiedTabsByWorktree, tabId)
      if (!found) {
        return {}
      }
      const { worktreeId } = found
      const tabs = s.unifiedTabsByWorktree[worktreeId] ?? []
      return {
        unifiedTabsByWorktree: {
          ...s.unifiedTabsByWorktree,
          [worktreeId]: tabs.map((t) =>
            t.id === tabId ? { ...t, isPinned: true, isPreview: false } : t
          )
        }
      }
    })
  },

  unpinTab: (tabId) => {
    set((s) => {
      const found = findTabAndWorktree(s.unifiedTabsByWorktree, tabId)
      if (!found) {
        return {}
      }
      const { worktreeId } = found
      const tabs = s.unifiedTabsByWorktree[worktreeId] ?? []
      return {
        unifiedTabsByWorktree: {
          ...s.unifiedTabsByWorktree,
          [worktreeId]: tabs.map((t) => (t.id === tabId ? { ...t, isPinned: false } : t))
        }
      }
    })
  },

  closeOtherTabs: (tabId) => {
    const state = get()
    const found = findTabAndWorktree(state.unifiedTabsByWorktree, tabId)
    if (!found) {
      return []
    }

    const { tab, worktreeId } = found
    const group = findGroupForTab(state.groupsByWorktree, worktreeId, tab.groupId)
    if (!group) {
      return []
    }

    const tabs = state.unifiedTabsByWorktree[worktreeId] ?? []
    const closedIds = tabs
      .filter((t) => t.id !== tabId && !t.isPinned && t.groupId === group.id)
      .map((t) => t.id)

    if (closedIds.length === 0) {
      return []
    }

    const closedSet = new Set(closedIds)

    set((s) => {
      const currentTabs = s.unifiedTabsByWorktree[worktreeId] ?? []
      const remainingTabs = currentTabs.filter((t) => !closedSet.has(t.id))
      const remainingOrder = group.tabOrder.filter((tid) => !closedSet.has(tid))
      const updatedGroupObj: TabGroup = { ...group, activeTabId: tabId, tabOrder: remainingOrder }

      return {
        unifiedTabsByWorktree: { ...s.unifiedTabsByWorktree, [worktreeId]: remainingTabs },
        groupsByWorktree: {
          ...s.groupsByWorktree,
          [worktreeId]: updateGroup(s.groupsByWorktree[worktreeId] ?? [], updatedGroupObj)
        }
      }
    })

    return closedIds
  },

  closeTabsToRight: (tabId) => {
    const state = get()
    const found = findTabAndWorktree(state.unifiedTabsByWorktree, tabId)
    if (!found) {
      return []
    }

    const { tab, worktreeId } = found
    const group = findGroupForTab(state.groupsByWorktree, worktreeId, tab.groupId)
    if (!group) {
      return []
    }

    const idx = group.tabOrder.indexOf(tabId)
    if (idx === -1) {
      return []
    }

    const idsToRight = group.tabOrder.slice(idx + 1)
    const tabs = state.unifiedTabsByWorktree[worktreeId] ?? []
    const tabMap = new Map(tabs.map((t) => [t.id, t]))

    const closedIds = idsToRight.filter((tid) => {
      const t = tabMap.get(tid)
      return t && !t.isPinned
    })

    if (closedIds.length === 0) {
      return []
    }

    const closedSet = new Set(closedIds)

    set((s) => {
      const currentTabs = s.unifiedTabsByWorktree[worktreeId] ?? []
      const remainingTabs = currentTabs.filter((t) => !closedSet.has(t.id))
      const remainingOrder = group.tabOrder.filter((tid) => !closedSet.has(tid))

      const newActiveTabId = closedSet.has(group.activeTabId ?? '') ? tabId : group.activeTabId
      const updatedGroupObj: TabGroup = {
        ...group,
        activeTabId: newActiveTabId,
        tabOrder: remainingOrder
      }

      return {
        unifiedTabsByWorktree: { ...s.unifiedTabsByWorktree, [worktreeId]: remainingTabs },
        groupsByWorktree: {
          ...s.groupsByWorktree,
          [worktreeId]: updateGroup(s.groupsByWorktree[worktreeId] ?? [], updatedGroupObj)
        }
      }
    })

    return closedIds
  },

  getActiveTab: (worktreeId) => {
    const state = get()
    const activeGroupId = state.activeGroupIdByWorktree[worktreeId]
    if (!activeGroupId) {
      return null
    }

    const groups = state.groupsByWorktree[worktreeId] ?? []
    const group = groups.find((g) => g.id === activeGroupId)
    if (!group?.activeTabId) {
      return null
    }

    const tabs = state.unifiedTabsByWorktree[worktreeId] ?? []
    return tabs.find((t) => t.id === group.activeTabId) ?? null
  },

  getTab: (tabId) => {
    const state = get()
    const found = findTabAndWorktree(state.unifiedTabsByWorktree, tabId)
    return found?.tab ?? null
  },

  hydrateTabsSession: (session) => {
    const state = get()
    const validWorktreeIds = new Set(
      Object.values(state.worktreesByRepo)
        .flat()
        .map((w) => w.id)
    )

    // Check for new unified format first
    if (session.unifiedTabs && session.tabGroups) {
      const tabsByWorktree: Record<string, Tab[]> = {}
      const groupsByWorktree: Record<string, TabGroup[]> = {}
      const activeGroupIdByWorktree: Record<string, string> = {}

      for (const [worktreeId, tabs] of Object.entries(session.unifiedTabs)) {
        if (!validWorktreeIds.has(worktreeId)) {
          continue
        }
        if (tabs.length === 0) {
          continue
        }
        tabsByWorktree[worktreeId] = [...tabs].sort(
          (a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt
        )
      }

      for (const [worktreeId, groups] of Object.entries(session.tabGroups)) {
        if (!validWorktreeIds.has(worktreeId)) {
          continue
        }
        if (groups.length === 0) {
          continue
        }

        const validTabIds = new Set((tabsByWorktree[worktreeId] ?? []).map((t) => t.id))
        const validatedGroups = groups.map((g) => ({
          ...g,
          tabOrder: g.tabOrder.filter((tid) => validTabIds.has(tid)),
          activeTabId: g.activeTabId && validTabIds.has(g.activeTabId) ? g.activeTabId : null
        }))

        groupsByWorktree[worktreeId] = validatedGroups
        activeGroupIdByWorktree[worktreeId] = validatedGroups[0].id
      }

      set({ unifiedTabsByWorktree: tabsByWorktree, groupsByWorktree, activeGroupIdByWorktree })
      return
    }

    // Fall back to legacy format: convert TerminalTab[] + PersistedOpenFile[] → Tab[]
    const tabsByWorktree: Record<string, Tab[]> = {}
    const groupsByWorktree: Record<string, TabGroup[]> = {}
    const activeGroupIdByWorktree: Record<string, string> = {}

    for (const worktreeId of validWorktreeIds) {
      const terminalTabs = session.tabsByWorktree[worktreeId] ?? []
      const editorFiles = session.openFilesByWorktree?.[worktreeId] ?? []

      if (terminalTabs.length === 0 && editorFiles.length === 0) {
        continue
      }

      const groupId = globalThis.crypto.randomUUID()
      const tabs: Tab[] = []
      const tabOrder: string[] = []

      for (const tt of terminalTabs) {
        tabs.push({
          id: tt.id,
          groupId,
          worktreeId,
          contentType: 'terminal',
          label: tt.title,
          customLabel: tt.customTitle,
          color: tt.color,
          sortOrder: tt.sortOrder,
          createdAt: tt.createdAt,
          isPreview: false,
          isPinned: false
        })
        tabOrder.push(tt.id)
      }

      for (const ef of editorFiles) {
        tabs.push({
          id: ef.filePath,
          groupId,
          worktreeId,
          contentType: 'editor',
          label: ef.relativePath,
          customLabel: null,
          color: null,
          sortOrder: tabs.length,
          createdAt: Date.now(),
          isPreview: ef.isPreview,
          isPinned: false
        })
        tabOrder.push(ef.filePath)
      }

      const activeTabType = session.activeTabTypeByWorktree?.[worktreeId] ?? 'terminal'
      let activeTabId: string | null = null
      if (activeTabType === 'editor') {
        activeTabId = session.activeFileIdByWorktree?.[worktreeId] ?? null
      } else if (session.activeTabId && terminalTabs.some((t) => t.id === session.activeTabId)) {
        activeTabId = session.activeTabId
      }
      if (activeTabId && !tabs.some((t) => t.id === activeTabId)) {
        activeTabId = tabs[0]?.id ?? null
      }

      tabsByWorktree[worktreeId] = tabs
      groupsByWorktree[worktreeId] = [{ id: groupId, worktreeId, activeTabId, tabOrder }]
      activeGroupIdByWorktree[worktreeId] = groupId
    }

    set({ unifiedTabsByWorktree: tabsByWorktree, groupsByWorktree, activeGroupIdByWorktree })
  }
})
