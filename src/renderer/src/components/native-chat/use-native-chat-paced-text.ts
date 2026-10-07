// A reply arrives in bursts: the host and the client each fold tokens into
// snapshots, so text lands a clause at a time. This paces what is drawn behind
// what has arrived, so it reads as flowing rather than landing.
//
// The pace follows the backlog, so the reader stays a fixed moment behind the
// agent however fast it writes. Its speed is eased rather than set: a snapshot
// landing would otherwise jump the speed, and that jump is what reads as a jolt.

import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isSpacelessScriptChar } from '@/components/sidebar/comment-markdown-word-fade'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import {
  NativeChatReplyRevealsContext,
  type NativeChatReplyReveals
} from './native-chat-reply-reveals'

/** How far the reader trails the agent: long enough to bridge the gaps between snapshots. */
const CATCH_UP_SECONDS = 0.35
/** How quickly the speed follows the backlog. Shorter tracks bursts; longer smooths them. */
const SPEED_EASE_SECONDS = 0.25
/** The last few characters of a backlog are not left to crawl in. */
const MIN_CHARS_PER_SECOND = 40
/** A word still being written waits this long for its end before it is drawn as it stands. */
const PARTIAL_WORD_HOLD_MS = 150
/** A frame that took longer (a hidden window) does not draw its whole wait at once. */
const MAX_FRAME_SECONDS = 0.05
/** The word fade in native-chat-markdown.css, so the last words are not cut short of theirs. */
const WORD_FADE_MS = 300

function endsWord(char: string): boolean {
  return /\s/.test(char) || isSpacelessScriptChar(char)
}

/** Where drawing stops for a pace that has reached `position`: at the end of the
 *  word it is in, so no word is drawn half-written. A word the text ends inside
 *  may still be growing, so it is held back whole while `holdPartialWord`. */
export function pacedTextEnd(text: string, position: number, holdPartialWord: boolean): number {
  const from = Math.floor(position)
  if (from >= text.length) {
    return text.length
  }
  let end = from
  while (end < text.length && !endsWord(text[end])) {
    end += 1
  }
  if (end < text.length || !holdPartialWord) {
    return end
  }
  let start = from
  while (start > 0 && !endsWord(text[start - 1])) {
    start -= 1
  }
  return start
}

export type PacedTextMotion = { position: number; charsPerSecond: number }

/** One frame of the pace toward the end of the text. */
export function advancePacedText(
  motion: PacedTextMotion,
  textLength: number,
  elapsedSeconds: number
): PacedTextMotion {
  const elapsed = Math.min(MAX_FRAME_SECONDS, Math.max(0, elapsedSeconds))
  const backlog = Math.max(0, textLength - motion.position)
  const wanted = backlog / CATCH_UP_SECONDS
  const eased =
    motion.charsPerSecond +
    (wanted - motion.charsPerSecond) * (1 - Math.exp(-elapsed / SPEED_EASE_SECONDS))
  const charsPerSecond = backlog > 0 ? Math.max(eased, MIN_CHARS_PER_SECOND) : 0
  return {
    position: Math.min(textLength, motion.position + charsPerSecond * elapsed),
    charsPerSecond
  }
}

function drawnAtMount(
  reveals: NativeChatReplyReveals | null,
  rowKey: string,
  text: string,
  streaming: boolean
): number {
  // A reply that finished while its row was out of the window has nothing left to draw.
  if (!streaming) {
    return text.length
  }
  const remembered = reveals?.drawn.get(rowKey)
  if (remembered !== undefined) {
    return Math.min(remembered, text.length)
  }
  return reveals?.begun.has(rowKey) ? 0 : text.length
}

export type NativeChatPacedText = {
  text: string
  /** Text is arriving or still being drawn, so what is drawn may end mid-markup. */
  revealing: boolean
  /** Newly drawn words fade in; outlasts the reveal so the last ones finish. */
  fading: boolean
}

/** `text` as it should be drawn now. A reply that begins while the reader watches is drawn
 *  from its first word; a row that mounts already written is drawn at once. */
export function useNativeChatPacedText(
  rowKey: string,
  text: string,
  streaming: boolean
): NativeChatPacedText {
  const reducedMotion = usePrefersReducedMotion()
  const reveals = useContext(NativeChatReplyRevealsContext)
  const [shown, setShown] = useState(() => drawnAtMount(reveals, rowKey, text, streaming))
  const [grew, setGrew] = useState(false)
  const pace = useRef({
    text,
    streaming,
    position: shown,
    /** What is on screen: never taken back, though a word still growing is held back. */
    drawn: shown,
    charsPerSecond: 0,
    changedAt: 0
  })

  useLayoutEffect(() => {
    const current = pace.current
    if (current.text !== text) {
      current.changedAt = performance.now()
    }
    if (streaming && text.length > current.text.length) {
      setGrew(true)
    }
    // Text that changes outside a stream (an edit, a rewrite) is not a reply being written. With
    // motion reduced everything is drawn, so the pace keeps up: turning motion back on must not
    // take back what was already read.
    const caughtUp = current.position >= current.text.length
    if (reducedMotion || (!streaming && !current.streaming && caughtUp)) {
      current.position = text.length
      current.drawn = text.length
      setShown(text.length)
      // Drawn without the pace, so the pace's own record would send a returning row back.
      if (streaming) {
        reveals?.drawn.set(rowKey, text.length)
      }
    }
    current.text = text
    current.streaming = streaming
    // Replaced by shorter text: there is nothing behind the pace to draw.
    current.position = Math.min(current.position, text.length)
  }, [text, streaming, reducedMotion, reveals, rowKey])

  const drawn = Math.min(shown, text.length)
  const behind = !reducedMotion && drawn < text.length

  useEffect(() => {
    if (!behind) {
      // Fully drawn and finished: a later mount draws it at once without being told.
      if (!streaming) {
        reveals?.drawn.delete(rowKey)
      }
      return
    }
    let last = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      const current = pace.current
      Object.assign(current, advancePacedText(current, current.text.length, (now - last) / 1000))
      last = now
      const stalled = now - current.changedAt >= PARTIAL_WORD_HOLD_MS
      const end = pacedTextEnd(current.text, current.position, current.streaming && !stalled)
      current.drawn = Math.max(Math.min(current.drawn, current.text.length), end)
      reveals?.drawn.set(rowKey, current.drawn)
      setShown(current.drawn)
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [behind, reveals, rowKey, streaming])

  const revealing = (!reducedMotion && streaming && grew) || behind
  const [lingering, setLingering] = useState(false)
  useEffect(() => {
    if (revealing) {
      setLingering(true)
      return
    }
    const timer = setTimeout(() => setLingering(false), WORD_FADE_MS)
    return () => clearTimeout(timer)
  }, [revealing])

  return {
    text: reducedMotion ? text : text.slice(0, drawn),
    revealing,
    fading: revealing || lingering
  }
}
