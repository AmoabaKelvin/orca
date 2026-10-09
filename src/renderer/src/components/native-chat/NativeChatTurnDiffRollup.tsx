import { createElement, memo, useContext, useMemo } from 'react'
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FileDiff,
  Folder,
  FolderOpen
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { getFileTypeIcon } from '@/lib/file-type-icons'
import { cn } from '@/lib/utils'
import { DiffLineCounts } from '../right-sidebar/source-control/listing/diff-line-counts'
import {
  NativeChatDisclosureContext,
  useNativeChatDisclosure
} from './native-chat-disclosure-store'
import { NativeChatExpandable } from './NativeChatExpandable'
import {
  nativeChatTurnDiffFolderPaths,
  nativeChatTurnDiffTree,
  type NativeChatTurnDiffTreeNode
} from './native-chat-turn-diff-tree'
import type { NativeChatDiffTarget, NativeChatTurnDiff } from './native-chat-turn-diffs'
import type { NativeChatTurnDiffViewer } from './use-native-chat-turn-diff-viewer'

const TREE_INDENT_PX = 14
const TREE_ROW_PADDING_PX = 8
const TREE_ROW_CLASS =
  'flex w-full min-w-0 items-center gap-2 rounded-sm py-1 pr-2 text-left text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none'

/** Keyed by the header's state, so toggling it starts every folder from that state. */
function folderDisclosureKey(cardKey: string, foldersOpen: boolean, path: string): string {
  return `${cardKey}:${foldersOpen}:${path}`
}

type TreeRowProps = {
  depth: number
  foldersOpen: boolean
  disclosureKey: string
  alignWithFolders: boolean
  onReveal: (target: NativeChatDiffTarget) => void
  onOpenDiffViewer: NativeChatTurnDiffViewer | undefined
}

function TreeRows({
  nodes,
  ...row
}: TreeRowProps & { nodes: readonly NativeChatTurnDiffTreeNode[] }): React.JSX.Element {
  return (
    <>
      {nodes.map((node) =>
        node.type === 'directory' ? (
          <DirectoryRows key={`dir:${node.path}`} node={node} {...row} />
        ) : (
          <FileRow key={`file:${node.file.path}`} node={node} {...row} />
        )
      )}
    </>
  )
}

function DirectoryRows({
  node,
  ...row
}: TreeRowProps & {
  node: Extract<NativeChatTurnDiffTreeNode, { type: 'directory' }>
}): React.JSX.Element {
  const { open, setOpen } = useNativeChatDisclosure(
    folderDisclosureKey(row.disclosureKey, row.foldersOpen, node.path),
    row.foldersOpen
  )
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        className={cn(TREE_ROW_CLASS, 'text-muted-foreground hover:text-foreground')}
        style={{ paddingLeft: TREE_ROW_PADDING_PX + row.depth * TREE_INDENT_PX }}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 transition-transform motion-reduce:transition-none',
            open && 'rotate-90'
          )}
        />
        {open ? (
          <FolderOpen aria-hidden className="size-3.5 shrink-0" />
        ) : (
          <Folder aria-hidden className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono" title={node.path}>
          {node.name}
        </span>
        <DiffLineCounts added={node.added} removed={node.removed} />
      </button>
      <NativeChatExpandable open={open}>
        <TreeRows {...row} nodes={node.children} depth={row.depth + 1} />
      </NativeChatExpandable>
    </>
  )
}

function FileRow({
  node,
  depth,
  alignWithFolders,
  onReveal,
  onOpenDiffViewer
}: TreeRowProps & {
  node: Extract<NativeChatTurnDiffTreeNode, { type: 'file' }>
}): React.JSX.Element {
  const openCurrentDiff = node.file.inWorkspace ? onOpenDiffViewer : undefined
  const currentDiffLabel = translate(
    'components.native-chat.turnDiff.openCurrentDiff',
    "Open this file's current diff"
  )
  return (
    <div className="group/file flex min-w-0 items-center gap-1">
      <button
        type="button"
        className={cn(TREE_ROW_CLASS, 'flex-1 text-foreground')}
        style={{ paddingLeft: TREE_ROW_PADDING_PX + depth * TREE_INDENT_PX }}
        onClick={() => onReveal(node.file.target)}
      >
        {alignWithFolders ? <span aria-hidden className="size-3.5 shrink-0" /> : null}
        {createElement(getFileTypeIcon(node.path), {
          'aria-hidden': true,
          className: 'size-3.5 shrink-0 text-muted-foreground'
        })}
        <span className="min-w-0 flex-1 truncate font-mono" title={node.file.path}>
          {node.name}
        </span>
        <DiffLineCounts added={node.file.added} removed={node.file.removed} />
      </button>
      {openCurrentDiff ? (
        <span className="opacity-0 transition-opacity group-focus-within/file:opacity-100 group-hover/file:opacity-100 motion-reduce:transition-none">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={currentDiffLabel}
            title={currentDiffLabel}
            onClick={() => openCurrentDiff(node.file.path)}
          >
            <FileDiff />
          </Button>
        </span>
      ) : null}
    </div>
  )
}

export const NativeChatTurnDiffRollup = memo(
  function NativeChatTurnDiffRollup({
    diff,
    disclosureKey,
    onReveal,
    onOpenDiffViewer
  }: {
    diff: NativeChatTurnDiff
    disclosureKey: string
    onReveal: (target: NativeChatDiffTarget) => void
    onOpenDiffViewer?: NativeChatTurnDiffViewer
  }): React.JSX.Element {
    const nodes = useMemo(() => nativeChatTurnDiffTree(diff.files), [diff.files])
    const folderPaths = useMemo(() => nativeChatTurnDiffFolderPaths(nodes), [nodes])
    const hasFolders = folderPaths.length > 0
    const disclosures = useContext(NativeChatDisclosureContext)
    const { open: foldersOpen, setOpen: setFoldersOpen } = useNativeChatDisclosure(
      disclosureKey,
      true
    )
    const foldersLabel = foldersOpen
      ? translate('components.native-chat.turnDiff.collapseFolders', 'Collapse all folders')
      : translate('components.native-chat.turnDiff.expandFolders', 'Expand all folders')
    return (
      <div className="rounded-md border border-border bg-muted/30 text-xs">
        <div className="flex min-h-9 items-center justify-between gap-2 py-1 pr-1.5 pl-3">
          <div
            className="flex min-w-0 flex-wrap items-center gap-x-3 font-medium text-foreground"
            title={translate(
              'components.native-chat.turnDiff.recorded',
              'Totals from recorded edits in this turn.'
            )}
          >
            <span>
              {diff.files.length === 1
                ? translate('components.native-chat.turnDiff.one', '1 changed file')
                : translate('components.native-chat.turnDiff.many', '{{count}} changed files', {
                    count: diff.files.length
                  })}
            </span>
            <DiffLineCounts added={diff.added} removed={diff.removed} size="sm" />
            {diff.truncated ? (
              <span className="font-normal text-muted-foreground">
                {translate('components.native-chat.turnDiff.partial', 'Partial diff')}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onOpenDiffViewer ? (
              <Button
                variant="ghost"
                size="xs"
                title={translate(
                  'components.native-chat.turnDiff.openAllChanges',
                  "Open all of the workspace's changes, which may differ from this turn"
                )}
                onClick={() => onOpenDiffViewer()}
              >
                <FileDiff />
                {translate('components.native-chat.turnDiff.allChanges', 'All changes')}
              </Button>
            ) : null}
            {hasFolders ? (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={foldersLabel}
                title={foldersLabel}
                onClick={() => {
                  const next = !foldersOpen
                  // A folder toggled by hand earlier would otherwise keep that choice.
                  for (const path of folderPaths) {
                    disclosures?.write(folderDisclosureKey(disclosureKey, next, path), next)
                  }
                  setFoldersOpen(next)
                }}
              >
                {foldersOpen ? <ChevronsDownUp /> : <ChevronsUpDown />}
              </Button>
            ) : null}
          </div>
        </div>
        <div className="px-1 pb-1">
          <TreeRows
            nodes={nodes}
            depth={0}
            foldersOpen={foldersOpen}
            disclosureKey={disclosureKey}
            alignWithFolders={hasFolders}
            onReveal={onReveal}
            onOpenDiffViewer={onOpenDiffViewer}
          />
        </div>
      </div>
    )
  },
  // A streamed update re-derives every turn's files, so a settled card skips by their content.
  (previous, next) =>
    previous.disclosureKey === next.disclosureKey &&
    previous.onReveal === next.onReveal &&
    previous.onOpenDiffViewer === next.onOpenDiffViewer &&
    JSON.stringify(previous.diff.files) === JSON.stringify(next.diff.files)
)
