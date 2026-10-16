// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { ClaudeDiffPanelNoticeBanner } from './ClaudeDiffPanelNoticeBanner'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const TAB_ID = 'tab-1'
const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const PANE_KEY = makePaneKey(TAB_ID, LEAF_ID)
const PTY_ID = 'pty-1'
const TITLE = "That panel is Claude's, not Orca's."
const FLOATING_TAB = {
  id: 'unified-floating',
  entityId: TAB_ID,
  groupId: 'group-1',
  worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
  contentType: 'terminal' as const,
  label: 'Terminal',
  customLabel: null,
  color: null,
  sortOrder: 0,
  createdAt: 0
}

let paneElement: HTMLDivElement
let root: Root
let mayAutoOpen: ReturnType<typeof vi.fn<(id: string, target: unknown) => Promise<boolean>>>
let uiSet: ReturnType<typeof vi.fn<(patch: unknown) => Promise<void>>>

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

function setState(agent: 'claude' | 'codex', seen = false): void {
  useAppStore.setState({
    claudeDiffPanelNoticeSeen: seen,
    paneForegroundAgentByPaneKey: { [PANE_KEY]: { agent, shellForeground: false } },
    // A floating terminal runs on the host.
    unifiedTabsByWorktree: { [FLOATING_TERMINAL_WORKTREE_ID]: [FLOATING_TAB] }
  })
}

async function renderBanner(): Promise<void> {
  await act(async () => {
    root.render(<ClaudeDiffPanelNoticeBanner ptyId={PTY_ID} tabId={TAB_ID} leafId={LEAF_ID} />)
  })
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  useAppStore.setState(useAppStore.getInitialState(), true)
  paneElement = document.createElement('div')
  document.body.appendChild(paneElement)
  root = createRoot(paneElement)
  mayAutoOpen = vi.fn(() => Promise.resolve(true))
  uiSet = vi.fn(() => Promise.resolve())
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { pty: { claudeDiffPanelMayAutoOpen: mayAutoOpen }, ui: { set: uiSet } }
  })
})

afterEach(() => {
  act(() => root.unmount())
  paneElement.remove()
  vi.unstubAllGlobals()
  useAppStore.setState(useAppStore.getInitialState(), true)
})

describe('ClaudeDiffPanelNoticeBanner', () => {
  it('explains the panel and how to hide it, then Got it keeps it away for good', async () => {
    setState('claude')
    await renderBanner()
    expect(mayAutoOpen).toHaveBeenCalledWith(PTY_ID, { runtime: 'host' })
    expect(paneElement.textContent).toContain(TITLE)
    expect(paneElement.textContent).toContain('type /diff in Claude Code')

    const gotIt = Array.from(paneElement.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Got it'
    )
    await act(async () => gotIt?.click())
    expect(paneElement.textContent).toBe('')
    expect(uiSet).toHaveBeenCalledWith({ claudeDiffPanelNoticeSeen: true })
  })

  it('stays hidden once seen, and never asks for a pane without Claude', async () => {
    setState('claude', true)
    await renderBanner()
    expect(mayAutoOpen).not.toHaveBeenCalled()
    expect(paneElement.textContent).toBe('')

    setState('codex')
    await renderBanner()
    expect(mayAutoOpen).not.toHaveBeenCalled()
  })

  it("stays hidden when Claude's saved config already keeps the panel closed", async () => {
    mayAutoOpen.mockResolvedValue(false)
    setState('claude')
    await renderBanner()
    expect(mayAutoOpen).toHaveBeenCalled()
    expect(paneElement.textContent).toBe('')
  })
})
