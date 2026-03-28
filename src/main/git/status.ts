/* eslint-disable max-lines */
import { execFile } from 'child_process'
import { readFile, rm } from 'fs/promises'
import { promisify } from 'util'
import * as path from 'path'
import type {
  GitBranchChangeEntry,
  GitBranchChangeStatus,
  GitBranchCompareResult,
  GitBranchCompareSummary,
  GitDiffResult,
  GitFileStatus,
  GitStatusEntry
} from '../../shared/types'

const execFileAsync = promisify(execFile)
const MAX_GIT_SHOW_BYTES = 10 * 1024 * 1024

/**
 * Parse `git status --porcelain=v2` output into structured entries.
 */
export async function getStatus(worktreePath: string): Promise<GitStatusEntry[]> {
  const entries: GitStatusEntry[] = []

  try {
    const { stdout } = await execFileAsync(
      'git',
      ['status', '--porcelain=v2', '--untracked-files=all'],
      { cwd: worktreePath, encoding: 'utf-8' }
    )

    for (const line of stdout.split('\n')) {
      if (!line) {
        continue
      }

      if (line.startsWith('1 ') || line.startsWith('2 ')) {
        // Changed entries: "1 XY sub mH mI mW hH path" or "2 XY sub mH mI mW hH X\tscore\tpath\torigPath"
        const parts = line.split(' ')
        const xy = parts[1]
        const indexStatus = xy[0]
        const worktreeStatus = xy[1]

        if (line.startsWith('2 ')) {
          // Rename entry - tab separated at the end
          const tabParts = line.split('\t')
          const path = tabParts[1]
          const oldPath = tabParts[2]
          if (indexStatus !== '.') {
            entries.push({ path, status: parseStatusChar(indexStatus), area: 'staged', oldPath })
          }
          if (worktreeStatus !== '.') {
            entries.push({
              path,
              status: parseStatusChar(worktreeStatus),
              area: 'unstaged',
              oldPath
            })
          }
        } else {
          // Regular change entry
          const path = parts.slice(8).join(' ')
          if (indexStatus !== '.') {
            entries.push({ path, status: parseStatusChar(indexStatus), area: 'staged' })
          }
          if (worktreeStatus !== '.') {
            entries.push({ path, status: parseStatusChar(worktreeStatus), area: 'unstaged' })
          }
        }
      } else if (line.startsWith('? ')) {
        // Untracked file
        const path = line.slice(2)
        entries.push({ path, status: 'untracked', area: 'untracked' })
      }
    }
  } catch {
    // Not a git repo or git not available
  }

  return entries
}

function parseStatusChar(char: string): GitFileStatus {
  switch (char) {
    case 'M':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    default:
      return 'modified'
  }
}

function parseBranchStatusChar(char: string): GitBranchChangeStatus {
  switch (char) {
    case 'M':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    default:
      return 'modified'
  }
}

/**
 * Get original and modified content for diffing a file.
 */
export async function getDiff(
  worktreePath: string,
  filePath: string,
  staged: boolean
): Promise<GitDiffResult> {
  let originalContent = ''
  let modifiedContent = ''
  let originalIsBinary = false
  let modifiedIsBinary = false

  try {
    const leftBlob = staged
      ? await readGitBlobAtOidPath(worktreePath, 'HEAD', filePath)
      : await readUnstagedLeftBlob(worktreePath, filePath)
    originalContent = leftBlob.content
    originalIsBinary = leftBlob.isBinary

    if (staged) {
      const rightBlob = await readGitBlobAtIndexPath(worktreePath, filePath)
      modifiedContent = rightBlob.content
      modifiedIsBinary = rightBlob.isBinary
    } else {
      const workingTreeBlob = await readWorkingTreeFile(path.join(worktreePath, filePath))
      modifiedContent = workingTreeBlob.content
      modifiedIsBinary = workingTreeBlob.isBinary
    }
  } catch {
    // Fallback
  }

  return buildDiffResult(originalContent, modifiedContent, originalIsBinary, modifiedIsBinary)
}

export async function getBranchCompare(
  worktreePath: string,
  baseRef: string
): Promise<GitBranchCompareResult> {
  const summary: GitBranchCompareSummary = {
    baseRef,
    baseOid: null,
    compareRef: 'HEAD',
    headOid: null,
    mergeBase: null,
    changedFiles: 0,
    status: 'loading'
  }

  const compareRef = await resolveCompareRef(worktreePath)
  summary.compareRef = compareRef

  let headOid = ''
  try {
    headOid = await resolveRefOid(worktreePath, 'HEAD')
    summary.headOid = headOid
  } catch {
    summary.status = 'unborn-head'
    summary.errorMessage =
      'This branch does not have a committed HEAD yet, so compare-to-base is unavailable.'
    return { summary, entries: [] }
  }

  let baseOid = ''
  try {
    baseOid = await resolveRefOid(worktreePath, baseRef)
    summary.baseOid = baseOid
  } catch {
    summary.status = 'invalid-base'
    summary.errorMessage = `Base ref ${baseRef} could not be resolved in this repository.`
    return { summary, entries: [] }
  }

  let mergeBase = ''
  try {
    mergeBase = await resolveMergeBase(worktreePath, baseOid, headOid)
    summary.mergeBase = mergeBase
  } catch {
    summary.status = 'no-merge-base'
    summary.errorMessage = `This branch and ${baseRef} do not share a merge base, so compare-to-base is unavailable.`
    return { summary, entries: [] }
  }

  try {
    const entries = await loadBranchChanges(worktreePath, mergeBase, headOid)
    const commitsAhead = await countAheadCommits(worktreePath, baseOid, headOid)
    summary.changedFiles = entries.length
    summary.commitsAhead = commitsAhead
    summary.status = 'ready'
    return { summary, entries }
  } catch (error) {
    summary.status = 'error'
    summary.errorMessage = error instanceof Error ? error.message : 'Failed to load branch compare'
    return { summary, entries: [] }
  }
}

export async function getBranchDiff(
  worktreePath: string,
  args: {
    headOid: string
    mergeBase: string
    filePath: string
    oldPath?: string
  }
): Promise<GitDiffResult> {
  try {
    const leftPath = args.oldPath ?? args.filePath
    const leftBlob = await readGitBlobAtOidPath(worktreePath, args.mergeBase, leftPath)
    const rightBlob = await readGitBlobAtOidPath(worktreePath, args.headOid, args.filePath)

    return buildDiffResult(
      leftBlob.content,
      rightBlob.content,
      leftBlob.isBinary,
      rightBlob.isBinary
    )
  } catch {
    return {
      kind: 'text',
      originalContent: '',
      modifiedContent: '',
      originalIsBinary: false,
      modifiedIsBinary: false
    }
  }
}

async function loadBranchChanges(
  worktreePath: string,
  mergeBase: string,
  headOid: string
): Promise<GitBranchChangeEntry[]> {
  const { stdout } = await execFileAsync(
    'git',
    ['diff', '--name-status', '-M', '-C', mergeBase, headOid],
    {
      cwd: worktreePath,
      encoding: 'utf-8',
      maxBuffer: MAX_GIT_SHOW_BYTES
    }
  )

  const entries: GitBranchChangeEntry[] = []
  for (const line of stdout.split('\n')) {
    if (!line) {
      continue
    }
    const entry = parseBranchChangeLine(line)
    if (entry) {
      entries.push(entry)
    }
  }
  return entries
}

function parseBranchChangeLine(line: string): GitBranchChangeEntry | null {
  const parts = line.split('\t')
  const rawStatus = parts[0] ?? ''
  const status = parseBranchStatusChar(rawStatus[0] ?? 'M')

  if (rawStatus.startsWith('R') || rawStatus.startsWith('C')) {
    const oldPath = parts[1]
    const path = parts[2]
    if (!path) {
      return null
    }
    return { path, oldPath, status }
  }

  const path = parts[1]
  if (!path) {
    return null
  }

  return { path, status }
}

async function resolveCompareRef(worktreePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['branch', '--show-current'], {
      cwd: worktreePath,
      encoding: 'utf-8'
    })
    const branch = stdout.trim()
    return branch || 'HEAD'
  } catch {
    return 'HEAD'
  }
}

async function resolveRefOid(worktreePath: string, ref: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--verify', ref], {
    cwd: worktreePath,
    encoding: 'utf-8'
  })
  return stdout.trim()
}

async function resolveMergeBase(
  worktreePath: string,
  baseOid: string,
  headOid: string
): Promise<string> {
  const { stdout } = await execFileAsync('git', ['merge-base', baseOid, headOid], {
    cwd: worktreePath,
    encoding: 'utf-8'
  })
  return stdout.trim()
}

async function countAheadCommits(
  worktreePath: string,
  baseOid: string,
  headOid: string
): Promise<number> {
  const { stdout } = await execFileAsync('git', ['rev-list', '--count', `${baseOid}..${headOid}`], {
    cwd: worktreePath,
    encoding: 'utf-8'
  })
  return Number.parseInt(stdout.trim(), 10) || 0
}

async function readUnstagedLeftBlob(
  worktreePath: string,
  filePath: string
): Promise<GitBlobReadResult> {
  const indexBlob = await readGitBlobAtIndexPath(worktreePath, filePath)
  if (indexBlob.exists) {
    return indexBlob
  }

  return readGitBlobAtOidPath(worktreePath, 'HEAD', filePath)
}

async function readGitBlobAtIndexPath(
  worktreePath: string,
  filePath: string
): Promise<GitBlobReadResult> {
  try {
    const { stdout } = (await execFileAsync('git', ['show', `:${filePath}`], {
      cwd: worktreePath,
      encoding: 'buffer',
      maxBuffer: MAX_GIT_SHOW_BYTES
    })) as { stdout: Buffer }

    return { ...bufferToBlob(stdout), exists: true }
  } catch {
    return { content: '', isBinary: false, exists: false }
  }
}

async function readGitBlobAtOidPath(
  worktreePath: string,
  oid: string,
  filePath: string
): Promise<GitBlobReadResult> {
  try {
    const { stdout } = (await execFileAsync('git', ['show', `${oid}:${filePath}`], {
      cwd: worktreePath,
      encoding: 'buffer',
      maxBuffer: MAX_GIT_SHOW_BYTES
    })) as { stdout: Buffer }

    return { ...bufferToBlob(stdout), exists: true }
  } catch {
    return { content: '', isBinary: false, exists: false }
  }
}

async function readWorkingTreeFile(filePath: string): Promise<GitBlobReadResult> {
  try {
    const buffer = await readFile(filePath)
    return bufferToBlob(buffer)
  } catch {
    return { content: '', isBinary: false, exists: false }
  }
}

function bufferToBlob(buffer: Buffer): GitBlobReadResult {
  const isBinary = isBinaryBuffer(buffer)
  return {
    content: isBinary ? '' : buffer.toString('utf-8'),
    isBinary,
    exists: true
  }
}

function isBinaryBuffer(buffer: Buffer): boolean {
  const len = Math.min(buffer.length, 8192)
  for (let i = 0; i < len; i += 1) {
    if (buffer[i] === 0) {
      return true
    }
  }
  return false
}

function buildDiffResult(
  originalContent: string,
  modifiedContent: string,
  originalIsBinary: boolean,
  modifiedIsBinary: boolean
): GitDiffResult {
  if (originalIsBinary || modifiedIsBinary) {
    return {
      kind: 'binary',
      originalContent,
      modifiedContent,
      originalIsBinary,
      modifiedIsBinary
    } as GitDiffResult
  }

  return {
    kind: 'text',
    originalContent,
    modifiedContent,
    originalIsBinary: false,
    modifiedIsBinary: false
  }
}

type GitBlobReadResult = {
  content: string
  isBinary: boolean
  exists: boolean
}

/**
 * Stage a file.
 */
export async function stageFile(worktreePath: string, filePath: string): Promise<void> {
  await execFileAsync('git', ['add', '--', filePath], {
    cwd: worktreePath,
    encoding: 'utf-8'
  })
}

/**
 * Unstage a file.
 */
export async function unstageFile(worktreePath: string, filePath: string): Promise<void> {
  await execFileAsync('git', ['restore', '--staged', '--', filePath], {
    cwd: worktreePath,
    encoding: 'utf-8'
  })
}

/**
 * Discard working tree changes for a file.
 */
export async function discardChanges(worktreePath: string, filePath: string): Promise<void> {
  const resolvedWorktree = path.resolve(worktreePath)
  const resolvedTarget = path.resolve(worktreePath, filePath)
  if (!isWithinWorktree(path, resolvedWorktree, resolvedTarget)) {
    throw new Error(`Path "${filePath}" resolves outside the worktree`)
  }

  let tracked = false
  try {
    await execFileAsync('git', ['ls-files', '--error-unmatch', '--', filePath], {
      cwd: worktreePath,
      encoding: 'utf-8'
    })
    tracked = true
  } catch {
    // File is not tracked by git
  }

  await (tracked
    ? execFileAsync('git', ['restore', '--worktree', '--source=HEAD', '--', filePath], {
        cwd: worktreePath,
        encoding: 'utf-8'
      })
    : rm(resolvedTarget, { force: true, recursive: true }))
}

export function isWithinWorktree(
  pathApi: Pick<typeof path, 'isAbsolute' | 'relative' | 'sep'>,
  resolvedWorktree: string,
  resolvedTarget: string
): boolean {
  const relativeTarget = pathApi.relative(resolvedWorktree, resolvedTarget)
  return !(
    relativeTarget === '' ||
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(relativeTarget)
  )
}
