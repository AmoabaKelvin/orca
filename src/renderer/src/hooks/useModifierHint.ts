import { useState, useEffect, useRef } from 'react'

const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')
const MOD_KEY = isMac ? 'Meta' : 'Control'
export const CLEAR_MODIFIER_HINTS_EVENT = 'orca:clear-modifier-hints'

type ModifierHintKeyboardEvent = Pick<
  KeyboardEvent,
  'key' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'repeat'
>

export function dispatchClearModifierHints(): void {
  window.dispatchEvent(new Event(CLEAR_MODIFIER_HINTS_EVENT))
}

export function shouldStartModifierHintTimer(e: ModifierHintKeyboardEvent): boolean {
  return e.key === MOD_KEY && !e.altKey && !e.shiftKey && (isMac ? !e.ctrlKey : !e.metaKey)
}

export function shouldClearModifierHintOnKeyUp(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey'>
): boolean {
  if (e.key === MOD_KEY) {
    return true
  }

  // Why: some app-level shortcuts are intercepted outside the renderer's
  // normal keydown path, so the combo key's keyup can be our first signal that
  // a completed Cmd/Ctrl chord is no longer a "show hints" gesture.
  return isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
}

/**
 * Tracks whether the user is holding the platform modifier key (Cmd on Mac,
 * Ctrl on Linux/Windows) long enough to show number-hint badges on worktree
 * cards.
 *
 * Rules:
 * - Timer starts on modifier keydown (alone, no other modifiers pressed).
 * - After 750 ms of uninterrupted hold, `showHints` becomes true.
 * - Any other key pressed while the modifier is held cancels the timer —
 *   the user is executing a shortcut, not looking for help.
 * - Hints vanish instantly on keyup (no fade-out delay).
 * - Window blur resets state to handle Cmd+Tab away without a keyup event.
 * - `e.repeat` events are ignored so the timer only starts once.
 */
export function useModifierHint(enabled: boolean = true): { showHints: boolean } {
  const [showHints, setShowHints] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const clear = (): void => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      setShowHints(false)
    }

    if (!enabled) {
      clear()
      return undefined
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.repeat) {
        return
      }

      // If the modifier key itself was pressed (not as part of a combo)
      // Why cross-modifier exclusion: on Mac, Ctrl+Cmd is often a system shortcut
      // (e.g. Ctrl+Cmd+Q to lock screen); on non-Mac, Meta+Ctrl is similarly not
      // an intentional hint request. Exclude the other platform modifier to avoid
      // false-positive hint activation during these combos.
      if (shouldStartModifierHintTimer(e)) {
        if (!timerRef.current) {
          timerRef.current = setTimeout(() => setShowHints(true), 750)
        }
        return
      }

      // Any other key while modifier is held → cancel hint timer.
      // Why: the user is executing a shortcut (e.g. Cmd+N), not requesting
      // the hint overlay.
      clear()
    }

    const onKeyUp = (e: KeyboardEvent): void => {
      if (shouldClearModifierHintOnKeyUp(e)) {
        clear()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener(CLEAR_MODIFIER_HINTS_EVENT, clear)
    // Why blur: if the user Cmd+Tabs away, the keyup event may never fire
    // inside this window, leaving hints stuck in the visible state.
    window.addEventListener('blur', clear)

    return () => {
      clear()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener(CLEAR_MODIFIER_HINTS_EVENT, clear)
      window.removeEventListener('blur', clear)
    }
  }, [enabled])

  return { showHints }
}
