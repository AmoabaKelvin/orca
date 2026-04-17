/**
 * Reconcile stored tab bar order with the current set of tab IDs.
 * Keeps items that still exist in their stored positions, appends new items
 * at the end in their natural order (not grouped by type).
 */
export function reconcileTabOrder(
  storedOrder: string[] | undefined,
  terminalIds: string[],
  editorIds: string[],
  browserIds: string[] = []
): string[] {
  const validIds = new Set([...terminalIds, ...editorIds, ...browserIds])
  // Why: storedOrder is persisted group tab order and is mutated by many
  // codepaths (drop/move/reorder/hydrate). A stale or racey write can leave
  // the same tab id twice in the list, which surfaces as React's "two
  // children with the same key" warning when TabBar maps items to
  // SortableTab/EditorFileTab/BrowserTab. Dedupe at the render boundary so
  // the UI never produces duplicate keys regardless of store-side bugs.
  const result: string[] = []
  const inResult = new Set<string>()
  for (const id of storedOrder ?? []) {
    if (validIds.has(id) && !inResult.has(id)) {
      result.push(id)
      inResult.add(id)
    }
  }
  for (const id of [...terminalIds, ...editorIds, ...browserIds]) {
    if (!inResult.has(id)) {
      result.push(id)
      inResult.add(id)
    }
  }
  return result
}

/**
 * Position `newId` immediately after `anchorId` in `order`, removing any prior
 * occurrence of `newId`. Falls back to appending at the end when `anchorId` is
 * null, undefined, or absent from `order`. Returns a new array — `order` is
 * not mutated.
 *
 * Why: all "new X tab" actions (terminal via Cmd+T, untitled file via
 * Cmd+Shift+N, browser tab via Cmd+Opt+T) must insert next to the currently
 * active tab instead of appending to the end. Centralizing the logic here
 * keeps every call site consistent.
 */
export function placeIdAfter(
  order: string[],
  newId: string,
  anchorId: string | null | undefined
): string[] {
  const filtered = order.filter((id) => id !== newId)
  if (!anchorId) {
    filtered.push(newId)
    return filtered
  }
  const anchorIdx = filtered.indexOf(anchorId)
  if (anchorIdx === -1) {
    filtered.push(newId)
    return filtered
  }
  filtered.splice(anchorIdx + 1, 0, newId)
  return filtered
}
