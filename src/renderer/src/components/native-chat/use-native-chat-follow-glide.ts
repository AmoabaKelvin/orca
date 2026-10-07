// Following the end without jumps. The scroll offset is still pinned at once, so
// nothing races the virtualizer or content that keeps growing; what a pin moved
// is drawn back where it was and glides to rest.
//
// The glide is a transform on the transcript column, held only while it runs.
// Its clip keeps the displaced content out of the scroll height, which would
// otherwise read as distance from the end.

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'

/** How quickly a line that pushed the transcript up comes to rest. */
const FOLLOW_GLIDE_MS = 100
/** A jump to the latest travels further, so it is given longer. */
const JUMP_GLIDE_MS = 110
/** A jump from far away slides in from this far at most: the rows between are not all mounted. */
const JUMP_GLIDE_MAX_PX = 320
/** Never displace more of the viewport than this. */
const MAX_GLIDE_VIEWPORT_SHARE = 0.75
const SETTLED_PX = 0.5
/** A frame that took longer (a hidden window) is not one long step. */
const MAX_FRAME_MS = 64

/** The glide after `elapsedMs`: a constant share of what remains leaves each moment. */
export function glideAfter(offset: number, elapsedMs: number, glideMs: number): number {
  const rest = offset * Math.exp(-Math.min(MAX_FRAME_MS, Math.max(0, elapsedMs)) / glideMs)
  return Math.abs(rest) < SETTLED_PX ? 0 : rest
}

type GlideState = {
  offset: number
  glideMs: number
  frame: number
  /** The last row and where its top was drawn, glide aside, at the previous write. */
  tail: { element: Element; top: number } | null
}

/** What ends the following: the reader's own scroll, or a move the transcript makes itself. */
export type NativeChatFollowRelease = 'reader-gesture' | 'transcript-move'

export type NativeChatFollowGlide = {
  /** After any application scroll: glide what it moved while following. */
  afterScrollWrite: () => void
  /** Slide in from `distance` px away, after a jump the reader asked for. */
  slideFrom: (distance: number) => void
  /** Stop gliding toward the end. Returns the px the caller must scroll back by to stay where
   *  the transcript is drawn. A glide the other way has no offset to stand in for it (the end
   *  is the last offset there is): a reader's gesture leaves it to come to rest, and a move the
   *  transcript is about to make itself ends it there. */
  release: (to: NativeChatFollowRelease) => number
}

export function useNativeChatFollowGlide({
  scrollRef,
  contentRef,
  followingRef,
  pinToEnd
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>
  contentRef: React.RefObject<HTMLDivElement | null>
  /** Whether the transcript is following its end; only a write made while it is glides. */
  followingRef: React.RefObject<boolean>
  /** The instant pin to the transcript's end. */
  pinToEnd: () => void
}): NativeChatFollowGlide {
  const reducedMotion = usePrefersReducedMotion()
  const reducedMotionRef = useRef(reducedMotion)
  // Read at rest, not captured: the pin changes with the transcript, and what is returned here
  // must not, or everything built on it would be rebuilt on every new row.
  const pinToEndRef = useRef(pinToEnd)
  useEffect(() => {
    pinToEndRef.current = pinToEnd
  }, [pinToEnd])
  const glide = useRef<GlideState>({ offset: 0, glideMs: FOLLOW_GLIDE_MS, frame: 0, tail: null })

  const draw = useCallback(() => {
    const content = contentRef.current
    if (content) {
      const { offset } = glide.current
      content.style.transform = offset === 0 ? '' : `translateY(${offset}px)`
    }
  }, [contentRef])

  const unclipFrame = useCallback(() => {
    const frame = contentRef.current?.parentElement
    if (frame) {
      frame.style.overflowY = ''
      frame.style.paddingBottom = ''
      frame.style.marginBottom = ''
    }
  }, [contentRef])

  /** Clips the column's frame for the glide without changing the scroll height. */
  const clipFrame = useCallback(() => {
    const frame = contentRef.current?.parentElement
    const scroller = scrollRef.current
    if (!frame || !scroller) {
      return
    }
    const unclipped = scroller.scrollHeight
    frame.style.overflowY = 'clip'
    // What already hung past the frame (a row's controls) was scroll height too: grow the
    // frame over it, and take the growth back out of the layout.
    const overhang = unclipped - scroller.scrollHeight
    if (overhang > 0) {
      frame.style.paddingBottom = `${Number.parseFloat(getComputedStyle(frame).paddingBottom) + overhang}px`
      frame.style.marginBottom = `${-overhang}px`
    }
  }, [contentRef, scrollRef])

  const stop = useCallback(() => {
    cancelAnimationFrame(glide.current.frame)
    glide.current.frame = 0
    glide.current.offset = 0
    glide.current.glideMs = FOLLOW_GLIDE_MS
    draw()
    unclipFrame()
  }, [draw, unclipFrame])

  const start = useCallback(
    (offset: number, glideMs: number) => {
      const state = glide.current
      const limit = (scrollRef.current?.clientHeight ?? 0) * MAX_GLIDE_VIEWPORT_SHARE
      if (state.frame === 0) {
        clipFrame()
      }
      state.offset = Math.max(-limit, Math.min(offset, limit))
      // A jump under way keeps its longer glide when a line lands during it.
      state.glideMs = Math.max(state.glideMs, glideMs)
      draw()
      if (state.frame !== 0) {
        return
      }
      let last = performance.now()
      state.frame = requestAnimationFrame(function tick(now) {
        state.offset = glideAfter(state.offset, now - last, state.glideMs)
        last = now
        if (state.offset === 0) {
          stop()
          // What hangs past the frame may have changed under the clip; a pin made meanwhile
          // stopped short of it.
          if (followingRef.current) {
            pinToEndRef.current()
          }
          return
        }
        draw()
        state.frame = requestAnimationFrame(tick)
      })
    },
    [clipFrame, draw, followingRef, scrollRef, stop]
  )

  const afterScrollWrite = useCallback(() => {
    const state = glide.current
    const tail =
      followingRef.current && !reducedMotionRef.current
        ? contentRef.current?.querySelector('[data-native-chat-window]')?.lastElementChild
        : null
    if (!tail) {
      state.tail = null
      return
    }
    const topOf = (element: Element): number => element.getBoundingClientRect().top - state.offset
    const previous = state.tail
    state.tail = { element: tail, top: topOf(tail) }
    if (!previous?.element.isConnected) {
      return
    }
    // A change at the end moves the row that was last: up as the reply grows, down when the
    // turn's own chrome leaves. A change above the viewport moves nothing the reader sees.
    const now = previous.element === tail ? state.tail.top : topOf(previous.element)
    const moved = previous.top - now
    if (Math.abs(moved) > SETTLED_PX) {
      start(state.offset + moved, FOLLOW_GLIDE_MS)
    }
  }, [contentRef, followingRef, start])

  const slideFrom = useCallback(
    (distance: number) => {
      if (!reducedMotionRef.current && distance > SETTLED_PX) {
        start(Math.max(glide.current.offset, Math.min(distance, JUMP_GLIDE_MAX_PX)), JUMP_GLIDE_MS)
      }
    },
    [start]
  )

  const release = useCallback(
    (to: NativeChatFollowRelease) => {
      const { offset } = glide.current
      glide.current.tail = null
      if (offset < 0 && to === 'reader-gesture') {
        return 0
      }
      stop()
      return Math.max(0, offset)
    },
    [stop]
  )

  useEffect(() => {
    reducedMotionRef.current = reducedMotion
    if (reducedMotion) {
      stop()
    }
  }, [reducedMotion, stop])
  useEffect(() => stop, [stop])

  return useMemo(
    () => ({ afterScrollWrite, slideFrom, release }),
    [afterScrollWrite, release, slideFrom]
  )
}
