import React from 'react'
import { FilePlus, FolderPlus } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

type FileExplorerBgMenuProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  point: { x: number; y: number }
  worktreePath: string
  startNew: (type: 'file' | 'folder', dir: string, depth: number) => void
}

export function FileExplorerBgMenu({
  open,
  onOpenChange,
  point,
  worktreePath,
  startNew
}: FileExplorerBgMenuProps): React.JSX.Element {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none fixed size-px opacity-0"
          style={{ left: point.x, top: point.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-48"
        sideOffset={0}
        align="start"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuItem onSelect={() => startNew('file', worktreePath, 0)}>
          <FilePlus />
          New File
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => startNew('folder', worktreePath, 0)}>
          <FolderPlus />
          New Folder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
