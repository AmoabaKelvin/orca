// Pending operations belong to draft scopes and outlive their composers. They are not persisted.
// Completion, failure, explicit removal, draft/workspace deletion or renderer exit ends ownership.

import { useCallback, useSyncExternalStore } from 'react'
import type { NativeChatComposerImageAttachment } from './NativeChatComposerField'
import type { NativeChatComposerDraftOwner } from './native-chat-composer-draft-storage'
import {
  appendNativeChatAttachmentCache,
  appendNativeChatDraftCache
} from './native-chat-draft-cache'
import { formatNativeChatFileReference } from '../../../../shared/agent-image-paste'
import {
  appendToNativeChatComposerDraft,
  nativeChatDraftScopeTabId,
  resolveNativeChatComposerDraftOwner,
  structuredAgentSessionIdOfDraftScope
} from './native-chat-composer-draft-store'

const EMPTY: readonly NativeChatComposerImageAttachment[] = Object.freeze([])
const pendingCache = new Map<string, readonly NativeChatComposerImageAttachment[]>()
// Why: a chip can outlive its tab, which is what names the draft's owner, so it is named at once.
const pendingOwners = new Map<string, NativeChatComposerDraftOwner>()
const listeners = new Map<string, Set<() => void>>()

/** The scope's pending chips; the same array until they change, so a reader can subscribe to it. */
export function nativeChatPendingAttachmentSnapshot(
  scopeKey: string
): readonly NativeChatComposerImageAttachment[] {
  return pendingCache.get(scopeKey) ?? EMPTY
}

function writePending(scopeKey: string, next: readonly NativeChatComposerImageAttachment[]): void {
  if (next.length === 0) {
    pendingCache.delete(scopeKey)
    pendingOwners.delete(scopeKey)
  } else {
    pendingCache.set(scopeKey, next)
  }
  listeners.get(scopeKey)?.forEach((listener) => listener())
}

export function subscribeToNativeChatPendingAttachments(
  scopeKey: string,
  listener: () => void
): () => void {
  const scoped = listeners.get(scopeKey) ?? new Set()
  listeners.set(scopeKey, scoped)
  scoped.add(listener)
  return () => {
    scoped.delete(listener)
    if (scoped.size === 0 && listeners.get(scopeKey) === scoped) {
      listeners.delete(scopeKey)
    }
  }
}

/** The scope's pending chips, re-rendering when they change. */
export function useNativeChatPendingAttachments(
  scopeKey: string
): readonly NativeChatComposerImageAttachment[] {
  const subscribe = useCallback(
    (listener: () => void) => subscribeToNativeChatPendingAttachments(scopeKey, listener),
    [scopeKey]
  )
  return useSyncExternalStore(subscribe, () => nativeChatPendingAttachmentSnapshot(scopeKey))
}

/** Adds a chip still on its way. Preview URLs stay with the composer that minted them. */
export function addNativeChatPendingAttachment(
  scopeKey: string,
  chip: NativeChatComposerImageAttachment
): void {
  const { previewUrl: _previewUrl, ...pending } = chip
  const owner = resolveNativeChatComposerDraftOwner(scopeKey) ?? pendingOwners.get(scopeKey)
  if (owner) {
    pendingOwners.set(scopeKey, owner)
  }
  writePending(scopeKey, [...nativeChatPendingAttachmentSnapshot(scopeKey), pending])
}

/** Removes a pending chip and returns it; undefined when the user already removed it. */
export function takeNativeChatPendingAttachment(
  scopeKey: string,
  id: string
): NativeChatComposerImageAttachment | undefined {
  const current = nativeChatPendingAttachmentSnapshot(scopeKey)
  const taken = current.find((attachment) => attachment.id === id)
  if (taken) {
    writePending(
      scopeKey,
      current.filter((attachment) => attachment !== taken)
    )
    settleReadyNativeChatPendingAttachments(scopeKey)
  }
  return taken
}

/** Moves the finished chips ahead of the first unfinished one into the draft. Why: images join the
 *  draft in the order they were attached, so thumbnails and chip numbers don't jump as uploads end. */
function settleReadyNativeChatPendingAttachments(scopeKey: string): void {
  const current = nativeChatPendingAttachmentSnapshot(scopeKey)
  const waiting = current.findIndex((chip) => chip.pending)
  const ready = waiting === -1 ? current : current.slice(0, waiting)
  if (ready.length === 0) {
    return
  }
  const owner = pendingOwners.get(scopeKey)
  writePending(scopeKey, current.slice(ready.length))
  // A finished chip already holds only what the draft keeps.
  appendToNativeChatComposerDraft(scopeKey, { images: ready, fromUser: true }, owner)
}

/** Settles a pending chip into the scope's draft, as an image the user attached, once every chip
 *  attached before it has. False when the user already removed it. */
export function settleNativeChatPendingAttachment(
  scopeKey: string,
  id: string,
  path: string,
  connectionId?: string | null
): boolean {
  const current = nativeChatPendingAttachmentSnapshot(scopeKey)
  if (!current.some((chip) => chip.id === id)) {
    return false
  }
  writePending(
    scopeKey,
    current.map((chip) =>
      chip.id === id ? { id, path, ...(connectionId ? { connectionId } : {}) } : chip
    )
  )
  settleReadyNativeChatPendingAttachments(scopeKey)
  return true
}

/** Attaches images after any chip still on its way, so they keep the order they were attached in:
 *  pasted or dropped alike. */
export function appendNativeChatAttachmentsAfterPending(
  scopeKey: string,
  images: readonly NativeChatComposerImageAttachment[],
  options?: { fromUser?: boolean }
): void {
  if (images.length === 0) {
    return
  }
  if (nativeChatPendingAttachmentSnapshot(scopeKey).length === 0) {
    appendNativeChatAttachmentCache(scopeKey, images, options)
    return
  }
  writePending(scopeKey, [...nativeChatPendingAttachmentSnapshot(scopeKey), ...images])
}

/** File results settle only while their operation still belongs to this draft. */
export function settleNativeChatPendingAttachmentReferences(
  scopeKey: string,
  references: { id: string; path: string }[],
  insertAtCaret?: (paths: string[]) => void
): boolean {
  const owner = pendingOwners.get(scopeKey)
  const paths = references.flatMap(({ id, path }) =>
    takeNativeChatPendingAttachment(scopeKey, id) ? [path] : []
  )
  if (paths.length === 0) {
    return false
  }
  if (insertAtCaret) {
    insertAtCaret(paths)
  } else {
    appendNativeChatDraftCache(scopeKey, paths.map(formatNativeChatFileReference).join(' '), owner)
  }
  return true
}

export function clearNativeChatPendingAttachments(scopeKey: string): void {
  if (pendingCache.has(scopeKey)) {
    writePending(scopeKey, [])
  }
}

function dropPendingWhere(
  matches: (scopeKey: string, owner: NativeChatComposerDraftOwner | undefined) => boolean
): void {
  for (const scopeKey of pendingCache.keys()) {
    if (matches(scopeKey, pendingOwners.get(scopeKey))) {
      writePending(scopeKey, [])
    }
  }
}

/** The chips of every pane in a closed tab, matched as its drafts are; never a conversation's. */
export function dropNativeChatPendingAttachmentsForTab(tabId: string): void {
  dropPendingWhere(
    (scopeKey) =>
      structuredAgentSessionIdOfDraftScope(scopeKey) === null &&
      nativeChatDraftScopeTabId(scopeKey) === tabId
  )
}

/** The chips begun in a removed workspace, open and closed chats alike. */
export function dropNativeChatPendingAttachmentsOwnedBy(owner: NativeChatComposerDraftOwner): void {
  dropPendingWhere(
    (_scopeKey, pendingOwner) =>
      pendingOwner?.workspaceId === owner.workspaceId &&
      pendingOwner.executionHostId === owner.executionHostId
  )
}

export function clearNativeChatPendingAttachmentsForTests(): void {
  pendingCache.clear()
  pendingOwners.clear()
}
