// @vitest-environment happy-dom
import { useRef } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNativeChatTranscriptScroll } from './use-native-chat-transcript-scroll'

function Transcript({
  afterWrite,
  restore,
  itemCount = 1
}: {
  afterWrite: { current: (() => void) | null }
  restore: (offset: number) => void
  itemCount?: number
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  useNativeChatTranscriptScroll({
    scrollRef,
    contentRef,
    itemCount,
    isWorking: true,
    showsTailRow: false,
    isVisible: true,
    alignToViewportTop: vi.fn(),
    isAlignPending: () => false,
    scrollToEnd: vi.fn(),
    restoreScrollOffset: restore,
    consumeProgrammaticScroll: () => true,
    reconcileReaderScroll: vi.fn(),
    afterScrollWriteRef: afterWrite
  })
  return (
    <div data-testid="scroll" ref={scrollRef}>
      <div>
        <div data-testid="column" ref={contentRef}>
          <div data-native-chat-window>
            <p data-testid="tail" data-native-chat-reveal-length="5">
              Reply <button>Copy</button>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('glide interaction takeover', () => {
  it.each(['pointer', 'menu', 'hover', 'selection'])(
    'ends the transform before %s positioning and keeps the drawn offset',
    (interaction) => {
      vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
      const afterWrite: { current: (() => void) | null } = { current: null }
      const restore = vi.fn()
      const view = render(<Transcript afterWrite={afterWrite} restore={restore} />)
      const scroll = view.getByTestId('scroll')
      const column = view.getByTestId('column')
      const tail = view.getByTestId('tail')
      Object.defineProperties(scroll, {
        clientHeight: { configurable: true, value: 600 },
        scrollHeight: { configurable: true, value: 1500 }
      })
      scroll.scrollTop = 900
      let top = 200
      let height = 40
      vi.spyOn(tail, 'getBoundingClientRect').mockImplementation(
        () => new DOMRect(0, top, 300, height)
      )
      act(() => afterWrite.current?.())
      top = 100
      height = 140
      tail.dataset.nativeChatRevealLength = '100'
      act(() => afterWrite.current?.())
      expect(column.style.transform).toBe('translateY(100px)')
      if (interaction === 'pointer') {
        fireEvent.pointerDown(tail)
      }
      if (interaction === 'menu') {
        fireEvent.contextMenu(tail)
      }
      if (interaction === 'hover') {
        fireEvent.pointerOver(view.getByRole('button'))
        expect(column.style.transform).toBe('translateY(100px)')
        expect(restore).not.toHaveBeenCalled()
        fireEvent.pointerMove(view.getByRole('button'))
      }
      if (interaction === 'selection') {
        const range = document.createRange()
        range.selectNodeContents(tail)
        document.getSelection()?.addRange(range)
        fireEvent(document, new Event('selectionchange'))
      }
      expect(column.style.transform).toBe('')
      expect(restore).toHaveBeenCalledWith(800)
      top = 50
      act(() => afterWrite.current?.())
      act(() => vi.advanceTimersByTime(100))
      expect(column.style.transform).toBe('')
      document.getSelection()?.removeAllRanges()
    }
  )
})
