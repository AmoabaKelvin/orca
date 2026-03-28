import { describe, expect, it } from 'vitest'
import { getEditorHeaderCopyState } from './editor-header'
import type { OpenFile } from '@/store/slices/editor'

function makeOpenFile(overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    id: '/repo/file.ts',
    filePath: '/repo/file.ts',
    relativePath: 'file.ts',
    worktreeId: 'wt-1',
    language: 'typescript',
    isDirty: false,
    mode: 'edit',
    ...overrides
  }
}

describe('getEditorHeaderCopyState', () => {
  it('shows the absolute file path for normal file tabs', () => {
    expect(getEditorHeaderCopyState(makeOpenFile())).toEqual({
      copyText: '/repo/file.ts',
      copyToastLabel: 'File path copied',
      pathLabel: '/repo/file.ts',
      pathTitle: '/repo/file.ts'
    })
  })

  it('adds a diff suffix to single-file diff headers', () => {
    expect(
      getEditorHeaderCopyState(
        makeOpenFile({
          id: '/repo/file.ts::unstaged',
          mode: 'diff',
          diffSource: 'unstaged'
        })
      )
    ).toEqual({
      copyText: '/repo/file.ts',
      copyToastLabel: 'File path copied',
      pathLabel: '/repo/file.ts (diff)',
      pathTitle: '/repo/file.ts (diff)'
    })
  })

  it('adds a staged diff suffix to staged diff headers', () => {
    expect(
      getEditorHeaderCopyState(
        makeOpenFile({
          id: '/repo/file.ts::staged',
          mode: 'diff',
          diffSource: 'staged'
        })
      )
    ).toEqual({
      copyText: '/repo/file.ts',
      copyToastLabel: 'File path copied',
      pathLabel: '/repo/file.ts (staged diff)',
      pathTitle: '/repo/file.ts (staged diff)'
    })
  })

  it('shows All Changes while still copying the worktree path', () => {
    expect(
      getEditorHeaderCopyState(
        makeOpenFile({
          id: 'wt-1::all-diffs::uncommitted',
          filePath: '/repo/worktree',
          relativePath: 'All Changes',
          mode: 'diff',
          diffSource: 'combined-uncommitted'
        })
      )
    ).toEqual({
      copyText: '/repo/worktree',
      copyToastLabel: 'Worktree path copied',
      pathLabel: 'All Changes',
      pathTitle: '/repo/worktree'
    })
  })
})
