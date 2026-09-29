import type { StoreApi } from 'zustand/vanilla'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store'
import { ORCA_EDITOR_SAVE_AND_CLOSE_EVENT } from './editor-autosave'
import { attachEditorAutosaveController } from './editor-autosave-controller'
import {
  createFakeEditorDisk,
  createUntitledNoteStore,
  stubEditorWindowWithDisk,
  type FakeEditorDisk
} from './editor-autosave-controller-test-fixture'
import { discardEditorFileChangesAndClose } from './discard-editor-file-changes'
import { __clearSelfWriteRegistryForTests } from './editor-self-write-registry'

const storeHolder = vi.hoisted((): { store: StoreApi<AppState> | null } => ({ store: null }))

function requireStore(): StoreApi<AppState> {
  if (!storeHolder.store) {
    throw new Error('test store not initialised')
  }
  return storeHolder.store
}

vi.mock('@/store', () => ({ useAppStore: { getState: () => requireStore().getState() } }))
vi.mock('@/lib/connection-context', () => ({ getConnectionIdForFile: vi.fn() }))

const FILE_ID = '/repo/untitled.md'

function typeInto(store: StoreApi<AppState>, content: string): void {
  store.getState().setEditorDraft(FILE_ID, content)
  store.getState().markFileDirty(FILE_ID, true)
}

function isReopenable(store: StoreApi<AppState>): boolean {
  return (store.getState().recentlyClosedEditorTabsByWorktree['wt-1'] ?? []).some(
    (tab) => tab.filePath === FILE_ID
  )
}

describe('untitled note save lifecycle', () => {
  let disk: FakeEditorDisk
  let store: StoreApi<AppState>

  beforeEach(() => {
    // Why: the window stub binds setTimeout, so fake timers must be installed first for autosave to be drivable.
    vi.useFakeTimers()
    disk = stubEditorWindowWithDisk(createFakeEditorDisk({ [FILE_ID]: '' }))
    store = createUntitledNoteStore('untitled.md')
    storeHolder.store = store
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    __clearSelfWriteRegistryForTests()
    storeHolder.store = null
  })

  it('still deletes an untouched untitled note on close', async () => {
    store.getState().closeFile(FILE_ID)

    await vi.waitFor(() => expect(disk.files.has(FILE_ID)).toBe(false))
    expect(isReopenable(store)).toBe(false)
  })

  it.each([
    [
      'Save in the unsaved-changes prompt',
      async (): Promise<void> => {
        window.dispatchEvent(
          new CustomEvent(ORCA_EDITOR_SAVE_AND_CLOSE_EVENT, { detail: { fileId: FILE_ID } })
        )
        await vi.waitFor(() => expect(store.getState().openFiles).toHaveLength(0))
      }
    ],
    [
      'autosave, then a plain close',
      async (): Promise<void> => {
        await vi.advanceTimersByTimeAsync(1500)
        store.getState().closeFile(FILE_ID)
      }
    ]
  ])('keeps the typed note after %s', async (_route, saveAndClose) => {
    const cleanup = attachEditorAutosaveController(store)
    try {
      typeInto(store, 'my note')

      await saveAndClose()

      expect(store.getState().openFiles).toHaveLength(0)
      expect(disk.files.get(FILE_ID)).toBe('my note')
      expect(disk.fs.deletePath).not.toHaveBeenCalled()
      expect(isReopenable(store)).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('deletes the note when its last save emptied it', async () => {
    const cleanup = attachEditorAutosaveController(store)
    try {
      typeInto(store, 'a')
      await vi.advanceTimersByTimeAsync(1500)
      typeInto(store, '')
      await vi.advanceTimersByTimeAsync(1500)
      expect(disk.files.get(FILE_ID)).toBe('')

      store.getState().closeFile(FILE_ID)

      await vi.waitFor(() => expect(disk.files.has(FILE_ID)).toBe(false))
    } finally {
      cleanup()
    }
  })

  it("keeps autosaved content when Don't Save interrupts the in-flight write", async () => {
    let finishWrite: () => void = () => {}
    disk.fs.writeFile.mockImplementationOnce(
      ({ filePath, content }: { filePath: string; content: string }) =>
        new Promise<void>((resolve) => {
          finishWrite = () => {
            disk.files.set(filePath, content)
            resolve()
          }
        })
    )
    const cleanup = attachEditorAutosaveController(store)
    try {
      typeInto(store, 'my note')
      await vi.advanceTimersByTimeAsync(1500)
      expect(disk.fs.writeFile).toHaveBeenCalledTimes(1)

      const discarded = discardEditorFileChangesAndClose(FILE_ID)
      finishWrite()
      await discarded

      expect(store.getState().openFiles).toHaveLength(0)
      expect(disk.files.get(FILE_ID)).toBe('my note')
      expect(disk.fs.deletePath).not.toHaveBeenCalled()
      // Only the saved-content flag decides this; the disk check alone would also keep the file.
      expect(isReopenable(store)).toBe(true)
    } finally {
      cleanup()
    }
  })

  it("removes a never-saved note's placeholder on Don't Save", async () => {
    typeInto(store, 'typed but never saved')

    await discardEditorFileChangesAndClose(FILE_ID)

    expect(store.getState().openFiles).toHaveLength(0)
    await vi.waitFor(() => expect(disk.files.has(FILE_ID)).toBe(false))
  })
})
