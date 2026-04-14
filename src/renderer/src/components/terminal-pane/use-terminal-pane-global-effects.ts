import { useEffect, useLayoutEffect, useRef } from 'react'
import {
  FOCUS_TERMINAL_PANE_EVENT,
  TOGGLE_TERMINAL_PANE_EXPAND_EVENT,
  type FocusTerminalPaneDetail
} from '@/constants/terminal'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import { shellEscapePath } from './pane-helpers'
import { fitAndFocusPanes, fitPanes, hasDimensionsChanged } from './pane-helpers'
import type { PtyTransport } from './pty-transport'

type UseTerminalPaneGlobalEffectsArgs = {
  tabId: string
  isActive: boolean
  managerRef: React.RefObject<PaneManager | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  paneTransportsRef: React.RefObject<Map<number, PtyTransport>>
  pendingWritesRef: React.RefObject<Map<number, string>>
  isActiveRef: React.RefObject<boolean>
  toggleExpandPane: (paneId: number) => void
}

export function useTerminalPaneGlobalEffects({
  tabId,
  isActive,
  managerRef,
  containerRef,
  paneTransportsRef,
  pendingWritesRef,
  isActiveRef,
  toggleExpandPane
}: UseTerminalPaneGlobalEffectsArgs): void {
  const wasActiveRef = useRef(false)

  // Why: tracks any in-progress chunked pending-write flush so the cleanup
  // function can cancel it if the pane deactivates mid-flush.
  const pendingFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Why: the deferred rAF (guardedResumeAndFit) must be cancellable when
  // the pane deactivates before the rAF fires — otherwise it would call
  // resumeRendering() on an already-suspended manager.
  const pendingRafRef = useRef<number | null>(null)

  // Why: two independent code paths schedule fitPanes() after a worktree
  // switch — the isActive effect (after pending-write drain) and the
  // ResizeObserver (after its 150 ms debounce).  On Windows, each redundant
  // fit() call adds non-trivial overhead (clear + refresh of 10 000
  // scrollback lines).  An epoch counter lets whichever path fires first
  // serve the activation, while the second path skips.  The staleness
  // check also rejects callbacks from a prior activation during rapid
  // worktree switches (A→B→C).
  const fitEpochRef = useRef(0)
  const fitRanForEpochRef = useRef(-1)

  // Why: when a worktree becomes active, useEffect flushes pending PTY data
  // and resumes WebGL rendering asynchronously.  Between the React DOM commit
  // (display: flex) and the useEffect callback, the browser paints one frame
  // showing stale xterm buffer content from the last visit.  useLayoutEffect
  // fires synchronously after the DOM commit but before paint, so setting
  // visibility: hidden here prevents the stale frame from ever appearing.
  // The visibility is restored in guardedResumeAndFit after the drain and
  // WebGL resume are complete.
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    if (isActive && !wasActiveRef.current) {
      container.style.visibility = 'hidden'
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive])

  useEffect(() => {
    const manager = managerRef.current
    if (!manager) {
      return
    }
    if (isActive) {
      // Why: resumeRendering() creates WebGL contexts for each pane, which
      // blocks the renderer for 100–500 ms per pane on Windows (ANGLE →
      // D3D11).  Deferring it into the rAF that runs after the pending-write
      // drain lets the browser paint one frame with the DOM renderer so the
      // terminal content appears immediately.  WebGL takes over seamlessly
      // in the next frame without a visible flash.

      fitEpochRef.current++
      const epoch = fitEpochRef.current

      // Why: while a worktree is in the background, PTY output accumulates
      // in pendingWritesRef with no size cap.  A Claude agent running for
      // minutes can produce hundreds of KB.  Writing it all in one
      // synchronous terminal.write() blocks the renderer for 2–5 s on
      // Windows, freezing the UI on every worktree switch.
      //
      // Fix: drain each pane's pending buffer in 32 KB chunks with a
      // setTimeout(0) yield between chunks.  This lets the browser paint
      // frames and process input events between chunks so the UI stays
      // responsive while the scrollback catches up.  The fit is deferred
      // until after the final chunk so xterm only reflows once.
      const CHUNK_SIZE = 32 * 1024
      const entries = Array.from(pendingWritesRef.current.entries()).filter(
        ([, buf]) => buf.length > 0
      )
      // Clear all pending buffers immediately so new PTY output arriving
      // during the flush goes into a fresh buffer instead of being lost.
      for (const [paneId] of entries) {
        pendingWritesRef.current.set(paneId, '')
      }

      const guardedResumeAndFit = (): void => {
        pendingRafRef.current = null
        // Why: read managerRef.current at rAF time instead of capturing
        // it at effect entry — the PaneManager instance can change if the
        // component unmounts and remounts during rapid tab switches.
        const mgr = managerRef.current
        if (!mgr) {
          return
        }
        mgr.resumeRendering()
        // Why: the useLayoutEffect above hid the container to prevent a
        // stale-buffer flash.  Now that pending data has been drained and
        // WebGL is active, reveal the terminal with its up-to-date content.
        // This must run before the fit dedup guards below — if the
        // ResizeObserver already ran fitPanes for this epoch, the early
        // return would leave the container permanently hidden.
        const container = containerRef.current
        if (container) {
          container.style.visibility = ''
        }
        // Why: three-layer guard prevents redundant and stale fits.
        // 1. Staleness — reject callbacks from a superseded activation
        //    (e.g. rapid A→B→C worktree switch).
        if (epoch !== fitEpochRef.current) {
          return
        }
        // 2. Dimension check — if a window resize changed the container
        //    size, the fit must run even if one already ran for this epoch.
        const dimensionsChanged = hasDimensionsChanged(mgr)
        // 3. Dedup — if dims are the same and a fit already ran, skip.
        if (!dimensionsChanged && fitRanForEpochRef.current >= epoch) {
          return
        }
        fitRanForEpochRef.current = epoch
        fitAndFocusPanes(mgr)
      }

      if (entries.length === 0) {
        pendingRafRef.current = requestAnimationFrame(guardedResumeAndFit)
      } else {
        let entryIdx = 0
        let offset = 0

        const drainNextChunk = (): void => {
          if (entryIdx >= entries.length) {
            pendingFlushRef.current = null
            pendingRafRef.current = requestAnimationFrame(guardedResumeAndFit)
            return
          }

          const [paneId, buffer] = entries[entryIdx]
          const pane = manager.getPanes().find((p) => p.id === paneId)
          if (!pane) {
            entryIdx++
            offset = 0
            pendingFlushRef.current = setTimeout(drainNextChunk, 0)
            return
          }

          const chunk = buffer.slice(offset, offset + CHUNK_SIZE)
          pane.terminal.write(chunk)
          offset += CHUNK_SIZE

          if (offset >= buffer.length) {
            entryIdx++
            offset = 0
          }

          // Yield to the browser between chunks so the UI stays responsive.
          pendingFlushRef.current = setTimeout(drainNextChunk, 0)
        }

        drainNextChunk()
      }
    } else if (wasActiveRef.current) {
      // Cancel any in-progress chunked flush before suspending.
      if (pendingFlushRef.current !== null) {
        clearTimeout(pendingFlushRef.current)
        pendingFlushRef.current = null
      }
      // Cancel any pending rAF so guardedResumeAndFit doesn't call
      // resumeRendering() on an already-suspended manager.
      if (pendingRafRef.current !== null) {
        cancelAnimationFrame(pendingRafRef.current)
        pendingRafRef.current = null
      }
      manager.suspendRendering()
      // Why: if the pane deactivates before guardedResumeAndFit ran (e.g.
      // rapid A→B→C worktree switching), the useLayoutEffect left the
      // container visibility: hidden.  Reset it so the next activation
      // starts from a clean state.
      const container = containerRef.current
      if (container) {
        container.style.visibility = ''
      }
    }
    wasActiveRef.current = isActive
    isActiveRef.current = isActive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive])

  useEffect(() => {
    const onToggleExpand = (event: Event): void => {
      const detail = (event as CustomEvent<{ tabId?: string }>).detail
      if (!detail?.tabId || detail.tabId !== tabId) {
        return
      }
      const manager = managerRef.current
      if (!manager) {
        return
      }
      const panes = manager.getPanes()
      if (panes.length < 2) {
        return
      }
      const pane = manager.getActivePane() ?? panes[0]
      if (!pane) {
        return
      }
      toggleExpandPane(pane.id)
    }
    window.addEventListener(TOGGLE_TERMINAL_PANE_EXPAND_EVENT, onToggleExpand)
    return () => window.removeEventListener(TOGGLE_TERMINAL_PANE_EXPAND_EVENT, onToggleExpand)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId])

  useEffect(() => {
    const onFocusPane = (event: Event): void => {
      const detail = (event as CustomEvent<FocusTerminalPaneDetail | undefined>).detail
      if (!detail?.tabId || detail.tabId !== tabId) {
        return
      }
      const manager = managerRef.current
      if (!manager) {
        return
      }
      const pane = manager.getPanes().find((candidate) => candidate.id === detail.paneId)
      if (!pane) {
        return
      }
      manager.setActivePane(pane.id, { focus: true })
    }
    window.addEventListener(FOCUS_TERMINAL_PANE_EVENT, onFocusPane)
    return () => window.removeEventListener(FOCUS_TERMINAL_PANE_EVENT, onFocusPane)
  }, [tabId, managerRef])

  useEffect(() => {
    if (!isActive) {
      return
    }
    const container = containerRef.current
    if (!container) {
      return
    }
    // Why: ResizeObserver fires on every incremental size change during
    // continuous window resizes or layout animations.  Each fitPanes() call
    // triggers fitAddon.fit() → terminal.resize() which, when the column
    // count changes, reflows the entire scrollback buffer and recalculates
    // the viewport scroll position.  On Windows, a single reflow of 10 000
    // scrollback lines can block the renderer for 500 ms–2 s, freezing the
    // UI while a sidebar opens or a window resizes.
    //
    // A trailing-edge debounce (150 ms) coalesces bursts into one reflow
    // after the layout settles.  This is longer than the previous RAF-only
    // batch (≈16 ms) but still short enough that the user never notices the
    // terminal running at a stale column count.
    const RESIZE_DEBOUNCE_MS = 150
    let timerId: ReturnType<typeof setTimeout> | null = null
    const resizeObserver = new ResizeObserver(() => {
      if (timerId !== null) {
        clearTimeout(timerId)
      }
      timerId = setTimeout(() => {
        timerId = null
        const manager = managerRef.current
        if (!manager) {
          return
        }
        // Why: apply the same epoch-based deduplication as the isActive
        // effect's rAF path.  Read the current epoch at fire time (not a
        // captured value) because the ResizeObserver persists across the
        // activation.  Dimension changes (e.g. window resize) bypass the
        // dedup so legitimate refits are never suppressed.
        const currentEpoch = fitEpochRef.current
        const dimensionsChanged = hasDimensionsChanged(manager)
        if (!dimensionsChanged && fitRanForEpochRef.current >= currentEpoch) {
          return
        }
        fitRanForEpochRef.current = currentEpoch
        fitPanes(manager)
      }, RESIZE_DEBOUNCE_MS)
    })
    resizeObserver.observe(container)
    return () => {
      resizeObserver.disconnect()
      if (timerId !== null) {
        clearTimeout(timerId)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive])

  useEffect(() => {
    return window.api.ui.onFileDrop((data) => {
      if (!isActiveRef.current || data.target !== 'terminal') {
        return
      }
      const manager = managerRef.current
      if (!manager) {
        return
      }
      const pane = manager.getActivePane() ?? manager.getPanes()[0]
      if (!pane) {
        return
      }
      const transport = paneTransportsRef.current.get(pane.id)
      if (!transport) {
        return
      }
      // Why: preload consumes native OS drops before React sees them, so the
      // terminal cannot rely on DOM `drop` events for external files. Reusing
      // the active PTY transport preserves the existing CLI behavior for drag-
      // and-drop path insertion instead of opening those files in the editor.
      // Why: appending a trailing space keeps multiple paths separated in the
      // terminal input, matching standard drag-and-drop UX conventions.
      for (const path of data.paths) {
        transport.sendInput(`${shellEscapePath(path)} `)
      }
    })
  }, [isActiveRef, managerRef, paneTransportsRef])
}
