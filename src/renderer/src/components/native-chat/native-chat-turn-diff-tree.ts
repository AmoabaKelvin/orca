import {
  buildSourceControlTree,
  compactSourceControlTree,
  type SourceControlTreeNode
} from '../right-sidebar/source-control-tree'
import type { NativeChatTurnDiffFile } from './native-chat-turn-diffs'

export type NativeChatTurnDiffTreeNode =
  | {
      type: 'directory'
      path: string
      name: string
      added: number
      removed: number
      children: NativeChatTurnDiffTreeNode[]
    }
  | { type: 'file'; path: string; name: string; file: NativeChatTurnDiffFile }

function turnDiffTreeNode(
  node: SourceControlTreeNode<NativeChatTurnDiffFile, 'turn'>
): NativeChatTurnDiffTreeNode {
  if (node.type === 'file') {
    return { type: 'file', path: node.path, name: node.name, file: node.entry }
  }
  const children = node.children.map(turnDiffTreeNode)
  const total = (count: 'added' | 'removed'): number =>
    children.reduce(
      (sum, child) => sum + (child.type === 'file' ? child.file[count] : child[count]),
      0
    )
  return {
    type: 'directory',
    path: node.path,
    name: node.name,
    added: total('added'),
    removed: total('removed'),
    children
  }
}

export function nativeChatTurnDiffFolderPaths(
  nodes: readonly NativeChatTurnDiffTreeNode[]
): string[] {
  return nodes.flatMap((node) =>
    node.type === 'directory' ? [node.path, ...nativeChatTurnDiffFolderPaths(node.children)] : []
  )
}

export function nativeChatTurnDiffTree(
  files: readonly NativeChatTurnDiffFile[]
): NativeChatTurnDiffTreeNode[] {
  return compactSourceControlTree(buildSourceControlTree('turn', [...files])).map(turnDiffTreeNode)
}
