import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileNativeChatScrollHold } from './MobileNativeChatScrollHold'

const platform = vi.hoisted(() => ({ OS: 'web' }))

vi.mock('react-native', () => ({ Platform: platform }))

/** A scroller 40 from its top whose content is 1,000 tall, then 3,000 once new rows are in. */
function scrollerThatGrows() {
  const heights = [1_000, 3_000]
  const node = {
    scrollTop: 40,
    get scrollHeight(): number {
      return heights.length > 1 ? (heights.shift() ?? 0) : heights[0]
    }
  }
  return { node, listRef: { current: { getScrollableNode: () => node } } }
}

describe('MobileNativeChatScrollHold', () => {
  let renderer: ReactTestRenderer | null = null

  async function show(headKey: string, listRef: ReturnType<typeof scrollerThatGrows>['listRef']) {
    const element = createElement(MobileNativeChatScrollHold, { headKey, listRef })
    await act(async () => {
      if (renderer) {
        renderer.update(element)
      } else {
        renderer = create(element)
      }
    })
  }

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    platform.OS = 'web'
  })

  it('keeps the view the same distance from the end when rows land above it', async () => {
    const { node, listRef } = scrollerThatGrows()
    await show('a', listRef)

    await show('older', listRef)

    expect(node.scrollTop).toBe(2_040)
  })

  it('leaves the view alone while the first row is the same', async () => {
    const { node, listRef } = scrollerThatGrows()
    await show('a', listRef)

    await show('a', listRef)

    expect(node.scrollTop).toBe(40)
  })

  it('does nothing in a native build, where the list holds its own place', async () => {
    platform.OS = 'ios'
    const { node, listRef } = scrollerThatGrows()
    await show('a', listRef)

    await show('older', listRef)

    expect(node.scrollTop).toBe(40)
  })
})
