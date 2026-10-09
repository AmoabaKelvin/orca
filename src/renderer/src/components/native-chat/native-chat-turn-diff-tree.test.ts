import { describe, expect, it } from 'vitest'
import {
  nativeChatTurnDiffTree,
  type NativeChatTurnDiffTreeNode
} from './native-chat-turn-diff-tree'
import type { NativeChatTurnDiffFile } from './native-chat-turn-diffs'

function file(path: string, added: number, removed: number): NativeChatTurnDiffFile {
  return {
    path,
    inWorkspace: true,
    added,
    removed,
    truncated: false,
    target: { messageId: path, editKey: 'Edit:0', fileIndex: 0 }
  }
}

function outline(nodes: readonly NativeChatTurnDiffTreeNode[], depth = 0): string[] {
  return nodes.flatMap((node) =>
    node.type === 'file'
      ? [`${'  '.repeat(depth)}${node.name} +${node.file.added} -${node.file.removed}`]
      : [
          `${'  '.repeat(depth)}${node.name}/ +${node.added} -${node.removed}`,
          ...outline(node.children, depth + 1)
        ]
  )
}

describe('turn diff tree', () => {
  it('totals each folder and joins a chain of single folders into one row', () => {
    const tree = nativeChatTurnDiffTree([
      file('src/renderer/chat/a.ts', 3, 1),
      file('src/renderer/chat/b.ts', 2, 0),
      file('README.md', 1, 1)
    ])
    expect(outline(tree)).toEqual([
      'src/renderer/chat/ +5 -1',
      '  a.ts +3 -1',
      '  b.ts +2 -0',
      'README.md +1 -1'
    ])
  })
})
