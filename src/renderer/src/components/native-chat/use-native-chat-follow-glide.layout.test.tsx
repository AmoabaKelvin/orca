// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useNativeChatFollowGlide } from './use-native-chat-follow-glide'

vi.mock('@/hooks/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => false }))

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function followingTranscript() {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
  const scroll = document.createElement('div')
  const frame = document.createElement('div')
  const column = document.createElement('div')
  const window = document.createElement('div')
  const tail = document.createElement('div')
  const prose = document.createElement('div')
  window.setAttribute('data-native-chat-window', '')
  prose.dataset.nativeChatRevealLength = '10'
  tail.append(prose)
  window.append(tail)
  column.append(window)
  frame.append(column)
  scroll.append(frame)
  document.body.append(scroll)
  let scrollHeight = 1500
  let proseHeight = 500
  Object.defineProperties(scroll, {
    clientHeight: { configurable: true, value: 600 },
    scrollHeight: { configurable: true, get: () => scrollHeight }
  })
  vi.spyOn(prose, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, 300, proseHeight)
  )
  vi.spyOn(tail, 'getBoundingClientRect').mockImplementation(() => {
    const offset = Number(column.style.transform.match(/translateY\((.+)px\)/)?.[1] ?? 0)
    return new DOMRect(0, 1000 - scroll.scrollTop + offset, 300, proseHeight)
  })
  const followingRef = { current: true }
  let afterWrite = (): void => {}
  const pin = vi.fn(() => {
    scroll.scrollTop = Math.max(0, scrollHeight - scroll.clientHeight)
    afterWrite()
  })
  const { result } = renderHook(() =>
    useNativeChatFollowGlide({
      scrollRef: { current: scroll },
      contentRef: { current: column },
      followingRef,
      pinToEnd: pin
    })
  )
  afterWrite = result.current.afterScrollWrite
  act(pin)
  return {
    scroll,
    column,
    prose,
    pin,
    resize: (delta: number, appended = false, proseDelta = delta) => {
      scrollHeight += delta
      proseHeight += proseDelta
      if (appended) {
        prose.dataset.nativeChatRevealLength = String(
          Number(prose.dataset.nativeChatRevealLength) + 100
        )
      }
      act(pin)
    },
    appendBeforeMeasurement: (delta: number) => {
      proseHeight += delta
      prose.dataset.nativeChatRevealLength = String(
        Number(prose.dataset.nativeChatRevealLength) + 100
      )
      act(pin)
      return () => {
        scrollHeight += delta
        act(pin)
      }
    }
  }
}

it('glides only the height added by newly revealed prose', () => {
  const rig = followingTranscript()
  rig.resize(100, true)
  expect(rig.column.style.transform).toBe('translateY(100px)')
  expect(rig.scroll.scrollTop).toBe(1000)
  act(() => vi.advanceTimersByTime(1200))
  expect(rig.column.style.transform).toBe('')
  expect(rig.scroll.scrollTop).toBe(1000)
})

it.each(['diagram SVG', 'code highlighting', 'image load', 'tool fold', 'final markdown'])(
  'pins a %s layout change without even one frame of offset or glide',
  (layout) => {
    const rig = followingTranscript()
    rig.resize(100, true)
    expect(rig.column.style.transform).toBe('translateY(100px)')
    if (layout !== 'image load') {
      delete rig.prose.dataset.nativeChatRevealLength
    }
    const delta = layout === 'tool fold' ? -250 : 250
    rig.resize(delta)
    expect(rig.scroll.scrollTop).toBe(1000 + delta)
    expect(rig.column.style.transform).toBe('')
    const pins = rig.pin.mock.calls.length
    act(() => vi.advanceTimersByTime(1000))
    expect(rig.pin).toHaveBeenCalledTimes(pins)
    expect(rig.column.style.transform).toBe('')
    expect(rig.scroll.scrollTop).toBe(1000 + delta)
  }
)

it('does not animate a reflow combined with a new line', () => {
  const rig = followingTranscript()
  rig.resize(350, true, 100)
  expect(rig.column.style.transform).toBe('')
})

it('waits for the virtual spacer measurement before gliding revealed line growth', () => {
  const rig = followingTranscript()
  const measure = rig.appendBeforeMeasurement(100)
  expect(rig.column.style.transform).toBe('')
  measure()
  expect(rig.column.style.transform).toBe('translateY(100px)')
})

it('does not keep an animation obligation for characters that added no height', () => {
  const rig = followingTranscript()
  rig.resize(0, true)
  rig.resize(100)
  expect(rig.column.style.transform).toBe('')
})
