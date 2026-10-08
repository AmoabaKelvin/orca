import {
  createNativeChatFileHref,
  routeNativeChatHref
} from '../../../../shared/native-chat-href-routing'
import {
  formatFileLinkLocation,
  parseFileLinkLocation
} from '../../../../shared/file-link-location'
import { extractTerminalFileLinks, type ParsedTerminalFileLink } from '@/lib/terminal-links'
import { EXTENSIONLESS_FILENAMES } from '@/lib/extensionless-filenames'
import { looksLikeHostname } from '@/lib/hostname-segment'

type MarkdownNode = {
  type: string
  value?: string
  url?: string
  children?: MarkdownNode[]
}

const ROOTED_PATH_PREFIX_PATTERN = /^(?:~[\\/]|\.{1,2}[\\/]|[\\/]|[A-Za-z]:[\\/])/

// Why: `.7z` is an extension, but a dot between two digits marks a version or model id, so
// `HTTP/1.1` and `1.5/2.0` are prose while `ls.1` and `libfoo.so.1` stay files.
const VERSION_SUFFIX_PATTERN = /\d\.\d[^.]*$/
// Why: a lone root segment is a slash command (`/code-review`) or a bare root, never a file.
const POSIX_ROOT_SEGMENT_ONLY_PATTERN = /^\/[^/\s]*$/
const FILE_URI_PATTERN = /^file:\/\//i
const FILE_EXTENSION_PATTERN = /\.[\p{L}\p{N}][\p{L}\p{N}\p{M}_+-]*$/u
// Why: a leading `/` is as often an app route (`/api/v1`) as a path. Container and remote
// roots are listed because a workspace can live on SSH or WSL.
const POSIX_FILE_ROOT_PREFIXES = [
  '/Users/',
  '/home/',
  '/root/',
  '/tmp/',
  '/var/',
  '/etc/',
  '/opt/',
  '/mnt/',
  '/media/',
  '/Volumes/',
  '/Applications/',
  '/private/',
  '/usr/',
  '/bin/',
  '/sbin/',
  '/lib/',
  '/lib64/',
  '/srv/',
  '/dev/',
  '/proc/',
  '/sys/',
  '/run/',
  '/boot/',
  '/workspace/',
  '/workspaces/'
] as const

// Why: `Makefile` and `CODEOWNERS` name a file as plainly as an extension does.
function namesFileBasename(pathText: string): boolean {
  const basename =
    pathText
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .at(-1) ?? ''
  return (
    EXTENSIONLESS_FILENAMES.has(basename) ||
    (FILE_EXTENSION_PATTERN.test(basename) && !VERSION_SUFFIX_PATTERN.test(basename))
  )
}

// Why: read the evidence from the first word. `/code-review src/foo.ts` borrows its only file
// shape from the command's argument, and `/clear and /compact` from prose after the command.
function namesPosixFilesystemPath(pathText: string, hasLineSuffix: boolean): boolean {
  const [head = ''] = pathText.split(/\s/, 1)
  if (POSIX_FILE_ROOT_PREFIXES.some((prefix) => head.startsWith(prefix))) {
    return true
  }
  if (POSIX_ROOT_SEGMENT_ONLY_PATTERN.test(head)) {
    return false
  }
  return hasLineSuffix || namesFileBasename(pathText)
}

// Why: a link is underlined only when it names a path; a bare `name.md` resolves nowhere
// reliable, so underlining it promises a click that cannot open anything.
function isLinkifiableFile(link: ParsedTerminalFileLink): boolean {
  // Why: `file://` is the author naming a file outright, so it needs no shape evidence.
  if (FILE_URI_PATTERN.test(link.displayText)) {
    return routeNativeChatHref(link.displayText).kind === 'file'
  }
  const isRooted = ROOTED_PATH_PREFIX_PATTERN.test(link.pathText)
  const [firstSegment = ''] = link.pathText.split(/[\\/]/, 1)
  // Why: unrooted, a space reads as a command (`git log origin/main`) and a leading host as a
  // URL missing its scheme. Rooted keeps both: `C:\Program Files\...` is a real path.
  if (!isRooted && (/\s/.test(link.pathText) || looksLikeHostname(firstSegment))) {
    return false
  }
  const hasLineSuffix = link.line !== null || link.column !== null
  const namesFile = link.pathText.startsWith('/')
    ? namesPosixFilesystemPath(link.pathText, hasLineSuffix)
    : isRooted || hasLineSuffix || namesFileBasename(link.pathText)
  return (
    /[\\/]/.test(link.pathText) &&
    namesFile &&
    routeNativeChatHref(link.displayText).kind === 'file'
  )
}

const SAFE_LEADING_BOUNDARY_PATTERN = /[\s([{'",;=]/
const SAFE_TRAILING_BOUNDARY_PATTERN = /[\s)\]}>'",;.:。！？，、；：]/
const SENTENCE_PATH_PUNCTUATION_PATTERN =
  /\.[\p{L}\p{N}][\p{L}\p{N}\p{M}_+-]*([!?—。！？，、；：])/gu
const QUOTED_TEXT_PATTERN = /"([^"\r\n]+)"|'([^"'\r\n]+)'/gu
const MAX_DASHED_PROSE_WORD_LENGTH = 32

function hasBoundedProseAfterDash(value: string, startIndex: number): boolean {
  const endIndex = Math.min(value.length, startIndex + MAX_DASHED_PROSE_WORD_LENGTH)
  for (let index = startIndex; index < endIndex; index += 1) {
    const char = value[index]
    if (!char || SAFE_TRAILING_BOUNDARY_PATTERN.test(char)) {
      return true
    }
    if (char === '/' || char === '\\') {
      return false
    }
  }
  return endIndex === value.length
}

function isSafeTrailingBoundary(value: string, endIndex: number): boolean {
  const boundary = value[endIndex]
  if (boundary === undefined || SAFE_TRAILING_BOUNDARY_PATTERN.test(boundary)) {
    return true
  }
  if (boundary === '!' || boundary === '?') {
    const next = value[endIndex + 1]
    return next === undefined || SAFE_TRAILING_BOUNDARY_PATTERN.test(next)
  }
  if (boundary === '—') {
    return hasBoundedProseAfterDash(value, endIndex + 1)
  }
  return false
}

function hasPartialPathBoundary(value: string, link: ParsedTerminalFileLink): boolean {
  const before = value[link.startIndex - 1]
  return (
    (before !== undefined && !SAFE_LEADING_BOUNDARY_PATTERN.test(before)) ||
    !isSafeTrailingBoundary(value, link.endIndex)
  )
}

// Why: wrap the parsed location, not the display text; a `file://` URI must not reach the literal href.
function createFileLinkNode(link: ParsedTerminalFileLink, child: MarkdownNode): MarkdownNode {
  return {
    type: 'link',
    url: createNativeChatFileHref(formatFileLinkLocation(link)),
    children: [child]
  }
}

// Why: the terminal extractor spans "src/a.ts and src/b.ts" as one spaced path.
// An unrooted span holding a bare word or several linkable tokens is prose
// joining paths, so link the tokens on their own; a spaced folder name keeps
// every token path-shaped and stays one link.
function splitProseJoinedLinks(link: ParsedTerminalFileLink): ParsedTerminalFileLink[] {
  if (ROOTED_PATH_PREFIX_PATTERN.test(link.pathText)) {
    return [link]
  }
  const tokens = Array.from(link.displayText.matchAll(/\S+/g))
  const tokenLinks: ParsedTerminalFileLink[] = []
  for (const match of tokens) {
    const token = match[0]
    const exactLink = extractTerminalFileLinks(token).find(
      (candidate) => candidate.startIndex === 0 && candidate.endIndex === token.length
    )
    if (exactLink && isLinkifiableFile(exactLink)) {
      const startIndex = link.startIndex + (match.index ?? 0)
      tokenLinks.push({ ...exactLink, startIndex, endIndex: startIndex + token.length })
    }
  }
  const hasBareWord = tokens.some((match) => !/[\\/.]/.test(match[0]))
  return hasBareWord || tokenLinks.length > 1 ? tokenLinks : [link]
}

function splitTextSegment(value: string): MarkdownNode[] {
  const links = extractTerminalFileLinks(value)
    .filter((link) => !hasPartialPathBoundary(value, link))
    .flatMap(splitProseJoinedLinks)
    .filter((link) => isLinkifiableFile(link))
  if (links.length === 0) {
    return [{ type: 'text', value }]
  }

  const children: MarkdownNode[] = []
  let cursor = 0
  for (const link of links) {
    if (link.startIndex < cursor) {
      continue
    }
    if (link.startIndex > cursor) {
      children.push({ type: 'text', value: value.slice(cursor, link.startIndex) })
    }
    children.push(createFileLinkNode(link, { type: 'text', value: link.displayText }))
    cursor = link.endIndex
  }
  if (cursor < value.length) {
    children.push({ type: 'text', value: value.slice(cursor) })
  }
  return children
}

function splitUnquotedText(value: string): MarkdownNode[] {
  const children: MarkdownNode[] = []
  let cursor = 0
  for (const match of value.matchAll(SENTENCE_PATH_PUNCTUATION_PATTERN)) {
    const punctuationIndex = (match.index ?? 0) + match[0].length - 1
    if (!isSafeTrailingBoundary(value, punctuationIndex)) {
      continue
    }
    children.push(...splitTextSegment(value.slice(cursor, punctuationIndex)))
    children.push({ type: 'text', value: value[punctuationIndex] })
    cursor = punctuationIndex + 1
  }
  if (cursor === 0) {
    return splitTextSegment(value)
  }
  children.push(...splitTextSegment(value.slice(cursor)))
  return children
}

function exactFileLink(value: string, allowSpacedRelative: boolean): ParsedTerminalFileLink | null {
  const exactLink = extractTerminalFileLinks(value).find(
    (link) => link.startIndex === 0 && link.endIndex === value.length
  )
  if (exactLink && isLinkifiableFile(exactLink)) {
    return exactLink
  }
  if (!allowSpacedRelative || !/\s/.test(value)) {
    return null
  }
  const parsed = parseFileLinkLocation(value)
  if (!parsed) {
    return null
  }
  const explicitLink = {
    ...parsed,
    startIndex: 0,
    endIndex: value.length,
    displayText: value
  }
  return isLinkifiableFile(explicitLink) ? explicitLink : null
}

function splitTextNode(value: string): MarkdownNode[] {
  const children: MarkdownNode[] = []
  let cursor = 0
  for (const match of value.matchAll(QUOTED_TEXT_PATTERN)) {
    const content = match[1] ?? match[2]
    if (!content) {
      continue
    }
    const link = exactFileLink(content, true)
    // Why: quoting a spaced string claims the whole of it. Rescanning a rejected one
    // underlines `Folder/notes.md` out of "Brennan's Folder/notes.md" — half a path.
    if (!link && !/\s/.test(content)) {
      continue
    }
    const matchIndex = match.index ?? 0
    const quote = match[0][0]
    children.push(...splitUnquotedText(value.slice(cursor, matchIndex)))
    children.push({ type: 'text', value: quote })
    children.push(
      link
        ? createFileLinkNode(link, { type: 'text', value: content })
        : { type: 'text', value: content }
    )
    children.push({ type: 'text', value: quote })
    cursor = matchIndex + match[0].length
  }
  if (cursor === 0) {
    return splitUnquotedText(value)
  }
  children.push(...splitUnquotedText(value.slice(cursor)))
  return children
}

function inlineCodeFileLink(node: MarkdownNode): MarkdownNode | null {
  const value = node.value?.trim()
  if (!value) {
    return null
  }
  const link = exactFileLink(value, true)
  return link ? createFileLinkNode(link, node) : null
}

function transformFileLinks(node: MarkdownNode): void {
  if (node.type === 'link') {
    const route = routeNativeChatHref(node.url)
    if (route.kind === 'file') {
      // Why: the wrapped href carries literal location text, so URL syntax is resolved here, once.
      node.url = createNativeChatFileHref(formatFileLinkLocation(route))
    }
    return
  }
  if (!node.children || node.type === 'image') {
    return
  }

  const children: MarkdownNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && child.value !== undefined) {
      children.push(...splitTextNode(child.value))
      continue
    }
    if (child.type === 'inlineCode') {
      children.push(inlineCodeFileLink(child) ?? child)
      continue
    }
    transformFileLinks(child)
    children.push(child)
  }
  node.children = children
}

export function remarkNativeChatFileLinks(): (tree: MarkdownNode) => void {
  return (tree) => transformFileLinks(tree)
}
