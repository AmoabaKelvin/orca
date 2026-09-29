import type { ExecutionHostId } from '../../shared/execution-host'
import { normalizeGitRemoteUrl } from '../../shared/git-remote-identity'
import { isFolderRepo } from '../../shared/repo-kind'
import type { Repo } from '../../shared/repo-types'
import { runGitProbeOnHost } from '../repo-git-remote-identity'

/** True only when git on `hostId` shows `repoPath` is its own checkout, with a resolvable HEAD,
 *  whose single origin URL names the same repo as `url` — what a finished `git clone url` leaves. */
async function isFinishedCloneOf(
  repoPath: string,
  url: string,
  hostId: ExecutionHostId,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    // Why: a killed clone leaves HEAD unresolvable; --show-cdup prints an empty first line only at
    // the checkout's own top level (a subfolder prints ../, a bare repo prints the hash).
    const head = await runGitProbeOnHost(
      ['rev-parse', '--show-cdup', '--verify', 'HEAD'],
      repoPath,
      hostId,
      { signal }
    )
    if (!head || head.stdout.split(/\r?\n/)[0] !== '') {
      return false
    }
    const origin = await runGitProbeOnHost(
      ['config', '--get-all', 'remote.origin.url'],
      repoPath,
      hostId,
      { signal }
    )
    const originUrl = origin?.stdout.trim() ?? ''
    // Why: an origin with several URLs (fetch uses the first) prints one per line; never a match.
    if (!originUrl || originUrl.includes('\n')) {
      return false
    }
    // Why: `.git`, scheme and user spell one repo several ways; local paths don't normalize.
    const requestedKey = normalizeGitRemoteUrl(url)
    return requestedKey ? normalizeGitRemoteUrl(originUrl) === requestedKey : originUrl === url
  } catch {
    return false
  }
}

/**
 * Decides what a clone does about a saved project already at its path. Returns the project when its
 * folder is already a clone of `url`, null when git should clone (nothing saved, or the saved
 * project was this repo and lost its folder), and throws when the saved project is something else.
 * `findSaved` must match path and host, so re-reading it after the probe also checks the host.
 */
export async function reuseSavedCloneTarget(
  findSaved: () => Repo | undefined,
  url: string,
  hostId: ExecutionHostId,
  signal?: AbortSignal
): Promise<Repo | null> {
  const saved = findSaved()
  if (!saved || isFolderRepo(saved)) {
    return null
  }
  const isClone = await isFinishedCloneOf(saved.path, url, hostId, signal)
  if (signal?.aborted) {
    throw new Error('Clone aborted')
  }
  if (isClone) {
    const current = findSaved()
    // Why: removed or replaced while git answered; git clone then refuses the non-empty folder.
    return current?.id === saved.id ? current : null
  }
  const requestedKey = normalizeGitRemoteUrl(url)
  const stored = saved.gitRemoteIdentity
  // Why: the project was this repo, so its settings still belong once git re-creates the folder.
  // A stored identity read from `upstream` names the repo a fork came from, not the fork.
  if (requestedKey && stored?.remoteName === 'origin' && stored.canonicalKey === requestedKey) {
    return null
  }
  throw new Error(
    `"${saved.displayName}" is already an Orca project at ${saved.path}, and Orca couldn't confirm that folder is a clone of this URL: it may hold a different repository, or have been moved or deleted. Remove the project from Orca or choose another folder.`
  )
}
