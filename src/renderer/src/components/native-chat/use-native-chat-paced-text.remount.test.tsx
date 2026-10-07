// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NativeChatReplyRevealsContext,
  type NativeChatReplyReveals
} from './native-chat-reply-reveals'
import { useNativeChatPacedText } from './use-native-chat-paced-text'

const motion = vi.hoisted(() => ({ reduced: false }))
vi.mock('@/hooks/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => motion.reduced
}))

const REPLY =
  'The quick brown fox jumps over the lazy dog and keeps running through the long field.'

function frames(count: number): Promise<void> {
  return act(async () => {
    for (let frame = 0; frame < count; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
  })
}

function transcript(...begun: string[]): NativeChatReplyReveals {
  return { begun: new Set(begun), drawn: new Map() }
}

function within(
  reveals: NativeChatReplyReveals
): ({ children }: { children: ReactNode }) => ReactNode {
  return function Transcript({ children }) {
    return (
      <NativeChatReplyRevealsContext.Provider value={reveals}>
        {children}
      </NativeChatReplyRevealsContext.Provider>
    )
  }
}

describe('useNativeChatPacedText', () => {
  beforeEach(() => {
    motion.reduced = false
  })

  it('draws a reply whole when it finished while its row was out of the window', async () => {
    const wrapper = within(transcript('left-mid-reply'))
    const live = renderHook(() => useNativeChatPacedText('left-mid-reply', REPLY, true), {
      wrapper
    })
    await frames(3)
    // Anti-vacuous: the row left with part of the reply still to draw.
    expect(live.result.current.text.length).toBeGreaterThan(0)
    expect(live.result.current.text.length).toBeLessThan(REPLY.length)
    live.unmount()

    const returned = renderHook(() => useNativeChatPacedText('left-mid-reply', REPLY, false), {
      wrapper
    })
    expect(returned.result.current.text).toBe(REPLY)
  })

  it('resumes a reply still being written from where the row left it', async () => {
    const wrapper = within(transcript('still-writing'))
    const live = renderHook(() => useNativeChatPacedText('still-writing', REPLY, true), {
      wrapper
    })
    await frames(3)
    const drawn = live.result.current.text
    live.unmount()

    const returned = renderHook(() => useNativeChatPacedText('still-writing', REPLY, true), {
      wrapper
    })
    expect(returned.result.current.text).toBe(drawn)
  })

  it('returns to a word drawn half-written, though the pace now holds that word back', async () => {
    const wrapper = within(transcript('half-word'))
    const live = renderHook(({ text }) => useNativeChatPacedText('half-word', text, true), {
      wrapper,
      initialProps: { text: 'hello super' }
    })
    // The stream stalls inside the word for longer than the pace holds it back.
    await act(() => new Promise((resolve) => setTimeout(resolve, 250)))
    await frames(2)
    expect(live.result.current.text).toBe('hello super')
    live.rerender({ text: 'hello supercalifragilistic' })
    await frames(2)
    expect(live.result.current.text).toBe('hello super')
    live.unmount()

    const returned = renderHook(
      () => useNativeChatPacedText('half-word', 'hello supercalifragilistic', true),
      { wrapper }
    )
    expect(returned.result.current.text).toBe('hello super')
  })

  it("does not carry one transcript's progress into another whose row has the same key", async () => {
    const live = renderHook(() => useNativeChatPacedText('streaming', REPLY, true), {
      wrapper: within(transcript('streaming'))
    })
    await frames(3)
    expect(live.result.current.text.length).toBeLessThan(REPLY.length)
    live.unmount()

    const other = 'Another conversation, already this far along when its pane opened.'
    const elsewhere = renderHook(() => useNativeChatPacedText('streaming', other, true), {
      wrapper: within(transcript())
    })
    expect(elsewhere.result.current.text).toBe(other)
  })

  it('does not replay what was drawn under reduced motion when the row returns', () => {
    motion.reduced = true
    const wrapper = within(transcript('read-under-reduced-motion'))
    const row = renderHook(() => useNativeChatPacedText('read-under-reduced-motion', REPLY, true), {
      wrapper
    })
    expect(row.result.current.text).toBe(REPLY)
    row.unmount()

    motion.reduced = false
    const returned = renderHook(
      () => useNativeChatPacedText('read-under-reduced-motion', REPLY, true),
      { wrapper }
    )
    expect(returned.result.current.text).toBe(REPLY)
  })

  it('keeps what was read when motion is turned back on mid-reply', () => {
    motion.reduced = true
    const half = REPLY.slice(0, 40)
    const row = renderHook(({ text }) => useNativeChatPacedText('motion-toggled', text, true), {
      initialProps: { text: half }
    })
    row.rerender({ text: REPLY })
    expect(row.result.current.text).toBe(REPLY)

    motion.reduced = false
    row.rerender({ text: REPLY })
    expect(row.result.current.text).toBe(REPLY)
  })
})
