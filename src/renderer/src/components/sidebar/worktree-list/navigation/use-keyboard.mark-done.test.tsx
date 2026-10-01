// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Virtualizer } from '@tanstack/react-virtual'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import type { KeybindingOverrides } from '../../../../../../shared/keybindings'
import { DEFAULT_WORKSPACE_STATUSES } from '../../../../../../shared/workspace-statuses'
import type { WorkspaceStatusDefinition, Worktree } from '../../../../../../shared/worktree/types'
import type { WorktreeDeleteState } from '../../../../store/slices/worktree-helpers'
import type { HostSectionRow } from '../../host-section-rows'
import { repo, worktree as worktreeFixture } from '../../worktree-list-groups-test-fixtures'

type FakeWorktree = Pick<Worktree, 'id' | 'repoId' | 'workspaceStatus' | 'hostId'>

type FakeState = {
  keybindings: KeybindingOverrides | undefined
  activeWorktreeId: string | null
  activeWorkspaceExecutionHostId: ExecutionHostId | null
  workspaceStatuses: WorkspaceStatusDefinition[]
  deleteStateByWorktreeId: Record<string, WorktreeDeleteState>
  getKnownWorktreeById: (id: string, hostId?: ExecutionHostId) => FakeWorktree | undefined
  updateWorktreeMeta: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => {
  const holder: { platform: NodeJS.Platform; state: FakeState | undefined } = {
    platform: 'linux',
    state: undefined
  }
  const currentState = (): FakeState => {
    if (!holder.state) {
      throw new Error('test state not set')
    }
    return holder.state
  }
  return { holder, currentState, activate: vi.fn() }
})

vi.mock('@/lib/shortcut-platform', () => ({ getShortcutPlatform: () => mocks.holder.platform }))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorktree: mocks.activate }))
vi.mock('@/store', () => {
  const useAppStore = (selector: (s: FakeState) => unknown) => selector(mocks.currentState())
  useAppStore.getState = mocks.currentState
  return { useAppStore }
})

const { useWorktreeListKeyboardNavigation } = await import('./use-keyboard')
const { useSidebarWorktreeSelection } = await import('./use-selection')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function worktree(id: string, workspaceStatus?: string, hostId?: ExecutionHostId): FakeWorktree {
  return { id, repoId: 'repo-1', workspaceStatus, hostId }
}

function setState(worktrees: FakeWorktree[]): FakeState {
  const state: FakeState = {
    keybindings: undefined,
    activeWorktreeId: null,
    activeWorkspaceExecutionHostId: null,
    workspaceStatuses: DEFAULT_WORKSPACE_STATUSES.map((status) => ({ ...status })),
    deleteStateByWorktreeId: {},
    getKnownWorktreeById: (id, hostId) =>
      worktrees.find((w) => w.id === id && (!hostId || (w.hostId ?? 'local') === hostId)),
    updateWorktreeMeta: vi.fn(async () => ({ ok: true }))
  }
  mocks.holder.state = state
  return state
}

function itemRows(ids: string[]): HostSectionRow[] {
  return ids.map((id) => ({
    type: 'item',
    rowKey: id,
    sectionKey: repo.id,
    worktree: { ...worktreeFixture, id, hostId: 'ssh:box' },
    repo,
    depth: 0,
    groupDepth: 0,
    lineageTrail: [],
    isLastLineageChild: false,
    lineageChildCount: 0
  }))
}

const virtualizer = new Virtualizer<HTMLDivElement, HTMLDivElement>({
  count: 0,
  getScrollElement: () => null,
  estimateSize: () => 0,
  scrollToFn: () => {},
  observeElementRect: () => {},
  observeElementOffset: () => {}
})

let container: HTMLDivElement
let root: Root

function renderList(args: {
  activeWorktreeId: string
  activeHostId?: ExecutionHostId | null
  activeModal?: string
  rows?: HostSectionRow[]
  selectedWorktrees?: FakeWorktree[]
}): { list: HTMLDivElement; child: HTMLButtonElement; input: HTMLInputElement } {
  const state = mocks.currentState()
  state.activeWorktreeId = args.activeWorktreeId
  state.activeWorkspaceExecutionHostId = args.activeHostId ?? null
  function Probe(): React.JSX.Element {
    const { handleContainerKeyDown } = useWorktreeListKeyboardNavigation({
      rows: args.rows ?? [],
      renderRows: [],
      activeWorktreeId: args.activeWorktreeId,
      activeWorkspaceExecutionHostId: args.activeHostId ?? null,
      pinnedDisplayPolicy: 'single-location',
      virtualizer,
      scrollRef: { current: null },
      activeModal: args.activeModal ?? 'none',
      markDirectScrollInput: () => {},
      selectedWorktrees: (args.selectedWorktrees ?? []).map((w) => ({ ...worktreeFixture, ...w })),
      onNavigate: () => {}
    })
    return (
      <div data-testid="list" tabIndex={0} onKeyDown={handleContainerKeyDown}>
        <button type="button">card action</button>
        <input aria-label="rename workspace" defaultValue="name" />
      </div>
    )
  }
  act(() => root.render(<Probe />))
  return {
    list: container.querySelector<HTMLDivElement>('[data-testid="list"]')!,
    child: container.querySelector<HTMLButtonElement>('button')!,
    input: container.querySelector<HTMLInputElement>('input')!
  }
}

function press(target: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
    ...init
  })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

beforeEach(() => {
  mocks.holder.platform = 'linux'
  mocks.activate.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ''
})

describe('Delete on the focused workspace list', () => {
  it('moves the active In progress workspace to Done without deleting it', () => {
    const state = setState([worktree('a', 'in-progress')])
    const { list } = renderList({ activeWorktreeId: 'a' })

    const event = press(list, 'Delete')

    expect(event.defaultPrevented).toBe(true)
    expect(state.updateWorktreeMeta).toHaveBeenCalledTimes(1)
    expect(state.updateWorktreeMeta).toHaveBeenCalledWith(
      'a',
      { workspaceStatus: 'completed' },
      expect.objectContaining({ executionHostId: 'local' })
    )
  })

  it('treats a workspace with no stored status as In progress', () => {
    const state = setState([worktree('a')])
    const { list } = renderList({ activeWorktreeId: 'a' })

    press(list, 'Delete')

    expect(state.updateWorktreeMeta).toHaveBeenCalledTimes(1)
  })

  it('writes to the active host when the same path exists on two hosts', () => {
    const state = setState([worktree('a', 'completed'), worktree('a', 'in-progress', 'ssh:box')])
    const { list } = renderList({ activeWorktreeId: 'a', activeHostId: 'ssh:box' })

    press(list, 'Delete')

    expect(state.updateWorktreeMeta).toHaveBeenCalledWith(
      'a',
      { workspaceStatus: 'completed' },
      expect.objectContaining({ executionHostId: 'ssh:box' })
    )
  })

  it('only lets the save apply to a workspace that is still In progress', () => {
    const state = setState([worktree('a', 'in-progress')])
    const { list } = renderList({ activeWorktreeId: 'a' })

    press(list, 'Delete')

    const options = state.updateWorktreeMeta.mock.calls[0]?.[2]
    expect(options.shouldApply(worktree('a', 'in-review'))).toBe(false)
    expect(options.shouldApply(worktree('a', 'in-progress'))).toBe(true)
  })

  it('uses the Mac delete key (Backspace) on macOS only', () => {
    const state = setState([worktree('a', 'in-progress')])
    const { list } = renderList({ activeWorktreeId: 'a' })

    press(list, 'Backspace')
    expect(state.updateWorktreeMeta).not.toHaveBeenCalled()

    mocks.holder.platform = 'darwin'
    const { list: macList } = renderList({ activeWorktreeId: 'a' })
    press(macList, 'Backspace')
    expect(state.updateWorktreeMeta).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['In review', 'in-review'],
    ['already Done', 'completed']
  ])('does nothing for a workspace that is %s', (_label, status) => {
    const state = setState([worktree('a', status)])
    const { list } = renderList({ activeWorktreeId: 'a' })

    const event = press(list, 'Delete')

    expect(event.defaultPrevented).toBe(false)
    expect(state.updateWorktreeMeta).not.toHaveBeenCalled()
  })

  it('leaves a workspace whose delete is already running alone', () => {
    const state = setState([worktree('a', 'in-progress')])
    state.deleteStateByWorktreeId = {
      a: { isDeleting: true, error: null, canForceDelete: false, forceDeleteReason: null }
    }
    const { list } = renderList({ activeWorktreeId: 'a' })

    const event = press(list, 'Delete')

    expect(event.defaultPrevented).toBe(false)
    expect(state.updateWorktreeMeta).not.toHaveBeenCalled()
  })

  it('does nothing when the custom statuses have no Done column', () => {
    const state = setState([worktree('a', 'in-progress')])
    state.workspaceStatuses = state.workspaceStatuses.filter((status) => status.id !== 'completed')
    const { list } = renderList({ activeWorktreeId: 'a' })

    press(list, 'Delete')

    expect(state.updateWorktreeMeta).not.toHaveBeenCalled()
  })

  it('ignores Delete from a control or text field inside the list, a modal, a held key, or a modifier', () => {
    const state = setState([worktree('a', 'in-progress')])
    const { list, child, input } = renderList({ activeWorktreeId: 'a' })
    press(child, 'Delete')
    // The inline rename field lives inside the list; Delete there must edit text, not a status.
    const typed = press(input, 'Delete')
    expect(typed.defaultPrevented).toBe(false)
    press(list, 'Delete', { repeat: true })
    press(list, 'Delete', { shiftKey: true })

    const { list: modalList } = renderList({ activeWorktreeId: 'a', activeModal: 'edit-meta' })
    press(modalList, 'Delete')

    expect(state.updateWorktreeMeta).not.toHaveBeenCalled()
  })

  it('leaves a rebound list key working when there is nothing to mark Done', () => {
    const state = setState([worktree('a', 'in-review')])
    state.keybindings = { 'workspace.markDone': ['Enter'] }
    const { list } = renderList({ activeWorktreeId: 'a' })

    const event = press(list, 'Enter')

    expect(state.updateWorktreeMeta).not.toHaveBeenCalled()
    // Enter's own handler (focus the terminal) ran and claimed the key.
    expect(event.defaultPrevented).toBe(true)
  })

  it('respects a user who unbinds the shortcut', () => {
    const state = setState([worktree('a', 'in-progress')])
    state.keybindings = { 'workspace.markDone': [] }
    const { list } = renderList({ activeWorktreeId: 'a' })

    press(list, 'Delete')

    expect(state.updateWorktreeMeta).not.toHaveBeenCalled()
  })

  it('moves a folder workspace to Done on its own host', () => {
    const state = setState([worktree('folder:one', 'in-progress', 'ssh:box')])
    const { list } = renderList({ activeWorktreeId: 'folder:one', activeHostId: 'ssh:box' })

    press(list, 'Delete')

    expect(state.updateWorktreeMeta).toHaveBeenCalledWith(
      'folder:one',
      { workspaceStatus: 'completed' },
      expect.objectContaining({ executionHostId: 'ssh:box' })
    )
  })

  it.each(['menu', 'dialog'])('does nothing while a %s is open', (role) => {
    const state = setState([worktree('a', 'in-progress')])
    const { list } = renderList({ activeWorktreeId: 'a' })
    const overlay = document.createElement('div')
    overlay.setAttribute('role', role)
    document.body.append(overlay)

    const event = press(list, 'Delete')

    expect(event.defaultPrevented).toBe(false)
    expect(state.updateWorktreeMeta).not.toHaveBeenCalled()
  })

  it('marks the workspace the arrow key moved to', () => {
    const state = setState([
      worktree('a', 'in-progress', 'ssh:box'),
      worktree('b', 'in-progress', 'ssh:box')
    ])
    mocks.activate.mockImplementation((id: string) => {
      state.activeWorktreeId = id
    })
    const { list } = renderList({
      activeWorktreeId: 'a',
      activeHostId: 'ssh:box',
      rows: itemRows(['a', 'b'])
    })

    press(list, 'ArrowDown')
    press(list, 'Delete')

    expect(mocks.activate).toHaveBeenCalledWith('b', { executionHostId: 'ssh:box' })
    expect(state.updateWorktreeMeta).toHaveBeenCalledTimes(1)
    expect(state.updateWorktreeMeta).toHaveBeenCalledWith(
      'b',
      { workspaceStatus: 'completed' },
      expect.objectContaining({ executionHostId: 'ssh:box' })
    )
  })

  it('marks every selected In progress row Done, like the right-click status menu', () => {
    const selected = [
      worktree('b', 'in-progress'),
      worktree('c', 'in-review'),
      worktree('d', undefined, 'ssh:box')
    ]
    const state = setState([worktree('a', 'in-progress'), ...selected])
    const { list } = renderList({ activeWorktreeId: 'a', selectedWorktrees: selected })

    const event = press(list, 'Delete')

    expect(event.defaultPrevented).toBe(true)
    expect(
      state.updateWorktreeMeta.mock.calls.map(([id, , options]) => [id, options.executionHostId])
    ).toEqual([
      ['b', 'local'],
      ['d', 'ssh:box']
    ])
  })

  it('ignores the one-row selection a plain click leaves behind', () => {
    const state = setState([worktree('a', 'in-progress'), worktree('b', 'in-progress')])
    // Clicking a selects it; switching to b another way (e.g. Cmd+J) leaves that selection behind.
    const { list } = renderList({
      activeWorktreeId: 'b',
      selectedWorktrees: [worktree('a', 'in-progress')]
    })

    press(list, 'Delete')

    expect(state.updateWorktreeMeta).toHaveBeenCalledTimes(1)
    expect(state.updateWorktreeMeta).toHaveBeenCalledWith(
      'b',
      { workspaceStatus: 'completed' },
      expect.anything()
    )
  })

  it('replaces a multi-row selection when the arrow keys move, like Finder', () => {
    const state = setState(['a', 'b', 'c'].map((id) => worktree(id, 'in-progress', 'ssh:box')))
    state.activeWorkspaceExecutionHostId = 'ssh:box'
    mocks.activate.mockImplementation((id: string) => {
      state.activeWorktreeId = id
    })
    const rows = itemRows(['a', 'b', 'c'])
    let selection: ReturnType<typeof useSidebarWorktreeSelection> | undefined
    function Probe(): React.JSX.Element {
      selection = useSidebarWorktreeSelection({
        sectionRows: rows,
        pinnedDisplayPolicy: 'single-location'
      })
      const { handleContainerKeyDown } = useWorktreeListKeyboardNavigation({
        rows,
        renderRows: [],
        activeWorktreeId: 'a',
        activeWorkspaceExecutionHostId: 'ssh:box',
        pinnedDisplayPolicy: 'single-location',
        virtualizer,
        scrollRef: { current: null },
        activeModal: 'none',
        markDirectScrollInput: () => {},
        selectedWorktrees: selection.selectedWorktrees,
        onNavigate: selection.selectOnly
      })
      return <div data-testid="list" tabIndex={0} onKeyDown={handleContainerKeyDown} />
    }
    state.activeWorktreeId = 'a'
    act(() => root.render(<Probe />))
    const list = container.querySelector<HTMLDivElement>('[data-testid="list"]')!
    const isMac = navigator.userAgent.includes('Mac')
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: selection only reads the modifier keys.
    const toggle = {
      metaKey: isMac,
      ctrlKey: !isMac,
      shiftKey: false
    } as React.MouseEvent<HTMLElement>
    act(() => {
      selection?.updateSelectionForGesture(toggle, {
        ...worktreeFixture,
        id: 'a',
        hostId: 'ssh:box'
      })
    })
    act(() => {
      selection?.updateSelectionForGesture(toggle, {
        ...worktreeFixture,
        id: 'c',
        hostId: 'ssh:box'
      })
    })
    expect(selection?.selectedWorktrees.map((w) => w.id)).toEqual(['a', 'c'])

    press(list, 'ArrowDown')
    press(list, 'Delete')

    expect(selection?.selectedWorktrees.map((w) => w.id)).toEqual(['b'])
    expect(state.updateWorktreeMeta).toHaveBeenCalledTimes(1)
    expect(state.updateWorktreeMeta).toHaveBeenCalledWith(
      'b',
      { workspaceStatus: 'completed' },
      expect.objectContaining({ executionHostId: 'ssh:box' })
    )
  })

  it('does nothing when no selected row is In progress', () => {
    const selected = [worktree('b', 'in-review'), worktree('c', 'completed')]
    const state = setState([worktree('a', 'in-progress'), ...selected])
    const { list } = renderList({ activeWorktreeId: 'a', selectedWorktrees: selected })

    const event = press(list, 'Delete')

    expect(event.defaultPrevented).toBe(false)
    expect(state.updateWorktreeMeta).not.toHaveBeenCalled()
  })
})
