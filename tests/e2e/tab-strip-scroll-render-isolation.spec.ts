/**
 * E2E test for scrolling an overflowing tab strip: the scroll must not re-render the tabs, and the
 * scroll thumb must still track the strip.
 *
 * Why E2E: only real Chromium delivers the wheel, scroll and ResizeObserver callbacks the thumb now
 * follows on its own, and only the whole app shows every React commit a scroll step causes.
 */

import type { Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady, waitForActiveWorktree, ensureTerminalVisible } from './helpers/store'

const STRIP = '.terminal-tab-strip'
const MIN_SCROLL_RANGE_PX = 2_500
const WHEEL_STEPS = 30
const WHEEL_DELTA_PX = 50

async function nextFrames(page: Page, count: number): Promise<void> {
  await page.evaluate(async (frames) => {
    for (let i = 0; i < frames; i++) {
      await new Promise(requestAnimationFrame)
    }
  }, count)
}

async function addBackgroundTerminalTabs(
  page: Page,
  worktreeId: string,
  count: number
): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    ids.push(
      await page.evaluate(
        (wId) =>
          window.__store!.getState().createTab(wId, undefined, undefined, { activate: false }).id,
        worktreeId
      )
    )
  }
  return ids
}

/**
 * Records how many tabs each React commit re-renders, the way React DevTools highlights updates:
 * through the commit hook the renderer always installs. Commits that render no tab (the sidebar,
 * terminals starting up) are left out.
 */
async function startRecordingTabRenders(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Fiber = {
      tag: number
      flags: number
      child: Fiber | null
      sibling: Fiber | null
      stateNode: unknown
    }
    // Function, class, forwardRef and memo components; bit 1 is React's PerformedWork flag.
    const componentTags = new Set([0, 1, 11, 14, 15])
    const performedWork = 1
    const hook = Reflect.get(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__')
    const original = hook.onCommitFiberRoot
    // A subtree React skipped keeps last commit's fiber objects, whose flags are stale.
    let previousFibers = new Set<Fiber>()
    Reflect.set(window, '__tabsRenderedPerCommit', [])
    hook.onCommitFiberRoot = function (
      rendererId: unknown,
      root: { current: Fiber },
      ...rest: unknown[]
    ) {
      const fibers = new Set<Fiber>()
      const renderedTabIds = new Set<string>()
      const stack: Fiber[] = [root.current]
      while (stack.length > 0) {
        const fiber = stack.pop()!
        fibers.add(fiber)
        if (
          componentTags.has(fiber.tag) &&
          (fiber.flags & performedWork) === performedWork &&
          !previousFibers.has(fiber)
        ) {
          let host: Fiber | null = fiber
          while (host && host.tag !== 5) {
            host = host.child
          }
          const element = host?.stateNode
          const tabId =
            element instanceof Element
              ? element.closest('[data-tab-strip-slot]')?.getAttribute('data-tab-strip-slot')
              : undefined
          if (tabId) {
            renderedTabIds.add(tabId)
          }
        }
        if (fiber.sibling) {
          stack.push(fiber.sibling)
        }
        if (fiber.child) {
          stack.push(fiber.child)
        }
      }
      previousFibers = fibers
      if (renderedTabIds.size > 0) {
        Reflect.get(window, '__tabsRenderedPerCommit').push(renderedTabIds.size)
      }
      return original?.call(this, rendererId, root, ...rest)
    }
  })
}

async function takeTabRenders(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const recorded = Reflect.get(window, '__tabsRenderedPerCommit')
    Reflect.set(window, '__tabsRenderedPerCommit', [])
    return recorded
  })
}

/** Thumb geometry next to where the strip's scroll position and size say it should be. */
async function readThumb(strip: Locator) {
  return strip.evaluate((el) => {
    const track = el.parentElement!.querySelector<HTMLElement>(
      '[data-testid="tab-strip-scroll-indicator"]'
    )!
    const trackRect = track.getBoundingClientRect()
    const thumbRect = track
      .querySelector<HTMLElement>('[data-testid="tab-strip-scroll-thumb"]')!
      .getBoundingClientRect()
    const maxScrollLeft = el.scrollWidth - el.clientWidth
    const expectedWidth = Math.max(18, (el.clientWidth / el.scrollWidth) * trackRect.width)
    return {
      width: thumbRect.width,
      expectedWidth,
      left: thumbRect.left - trackRect.left,
      expectedLeft: (el.scrollLeft / maxScrollLeft) * (trackRect.width - expectedWidth)
    }
  })
}

async function expectThumbToTrackStrip(strip: Locator): Promise<void> {
  const thumb = await readThumb(strip)
  expect(Math.abs(thumb.width - thumb.expectedWidth)).toBeLessThanOrEqual(1)
  expect(Math.abs(thumb.left - thumb.expectedLeft)).toBeLessThanOrEqual(1)
}

test.describe('Tab strip scroll render isolation', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
  })

  test('scrolls a long strip without re-rendering its tabs, and the thumb keeps up', async ({
    orcaPage
  }) => {
    const worktreeId = await waitForActiveWorktree(orcaPage)
    const strip = orcaPage.locator(STRIP).first()
    await expect(strip).toBeVisible()
    const tabIds: string[] = []
    for (let i = 0; i < 12; i++) {
      const range = await strip.evaluate((el) => el.scrollWidth - el.clientWidth)
      if (range >= MIN_SCROLL_RANGE_PX) {
        break
      }
      tabIds.push(...(await addBackgroundTerminalTabs(orcaPage, worktreeId, 10)))
      await nextFrames(orcaPage, 1)
    }
    await expect
      .poll(() => strip.evaluate((el) => el.scrollWidth - el.clientWidth))
      .toBeGreaterThanOrEqual(MIN_SCROLL_RANGE_PX)

    // Start and end mid-strip so neither scroll edge flips the arrows, fades or dock.
    await strip.evaluate((el) => {
      el.scrollLeft = 500
    })
    const box = (await strip.boundingBox())!
    await orcaPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await nextFrames(orcaPage, 5)

    await startRecordingTabRenders(orcaPage)
    // New terminals retitle their tabs for a few seconds after opening; wait for the strip to settle.
    await expect
      .poll(
        async () => {
          await takeTabRenders(orcaPage)
          await orcaPage.waitForTimeout(500)
          return (await takeTabRenders(orcaPage)).length
        },
        { timeout: 15_000 }
      )
      .toBe(0)
    for (let i = 0; i < WHEEL_STEPS; i++) {
      await orcaPage.mouse.wheel(0, WHEEL_DELTA_PX)
      await nextFrames(orcaPage, 1)
    }
    await nextFrames(orcaPage, 3)
    expect(await strip.evaluate((el) => el.scrollLeft)).toBe(500 + WHEEL_STEPS * WHEEL_DELTA_PX)
    // Why "many tabs": before the fix every scroll step re-rendered all of them in one commit;
    // a single tab can still update itself (a late retitle, the hover moving to its neighbour).
    expect((await takeTabRenders(orcaPage)).filter((tabs) => tabs >= 3)).toEqual([])
    await expectThumbToTrackStrip(strip)

    // Control: switching tabs re-renders at least the tab it activates, so the recorder sees tabs.
    await orcaPage.evaluate((tabId) => window.__store!.getState().setActiveTab(tabId), tabIds[0])
    await expect.poll(async () => (await takeTabRenders(orcaPage)).length).toBeGreaterThan(0)

    // Tabs opening grow the strip without a scroll event.
    await addBackgroundTerminalTabs(orcaPage, worktreeId, 10)
    await nextFrames(orcaPage, 3)
    await expectThumbToTrackStrip(strip)

    // A narrower pane shrinks the strip and the track without a scroll event.
    await strip.evaluate((el) => {
      el.closest<HTMLElement>('[data-native-file-drop-target]')!.style.maxWidth = '700px'
    })
    await nextFrames(orcaPage, 3)
    await expectThumbToTrackStrip(strip)
  })
})
