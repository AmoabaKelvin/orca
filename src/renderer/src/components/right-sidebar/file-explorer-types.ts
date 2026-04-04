// Custom MIME type used by in-app file explorer drags so the preload layer
// can distinguish them from native OS file drops and let React handle them.
export const ORCA_PATH_MIME = 'text/x-orca-file-path'

export type TreeNode = {
  name: string
  path: string
  relativePath: string
  isDirectory: boolean
  depth: number
}

export type DirCache = {
  children: TreeNode[]
  loading: boolean
}

export type PendingDelete = {
  node: TreeNode
}
