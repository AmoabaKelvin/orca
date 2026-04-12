import { net } from 'electron'
import type { ChangelogData } from '../shared/types'

type ChangelogEntry = {
  version: string
  title: string
  description: string
  mediaUrl?: string
  releaseNotesUrl: string
}

/**
 * Fetches the remote changelog and extracts the entry for the incoming version,
 * plus a `releasesBehind` count relative to the local version.
 *
 * Why net.fetch instead of fetch: Electron's `net` module respects the app's
 * proxy/certificate settings and has no CORS restrictions.
 */
export async function fetchChangelog(
  incomingVersion: string,
  localVersion: string
): Promise<ChangelogData | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const res = await net.fetch('https://onorca.dev/whats-new/changelog.json', {
      signal: controller.signal
    })
    if (!res.ok) {
      return null
    }
    const json: unknown = await res.json()

    // Why: the JSON endpoint is external and could serve malformed data.
    // Validate the shape before indexing into it to avoid runtime errors
    // that would propagate up and delay the 'available' status broadcast.
    if (!Array.isArray(json)) {
      return null
    }
    const entries = json as ChangelogEntry[]

    const incomingIndex = entries.findIndex((e) => e.version === incomingVersion)
    if (incomingIndex === -1) {
      return null
    }

    const entry = entries[incomingIndex]
    if (
      typeof entry.title !== 'string' ||
      typeof entry.description !== 'string' ||
      typeof entry.releaseNotesUrl !== 'string'
    ) {
      return null
    }

    const localIndex = entries.findIndex((e) => e.version === localVersion)
    // Why: clamp to null when <= 0 — a zero or negative value means the JSON
    // ordering invariant is violated, and the badge number would be misleading.
    const releasesBehind =
      localIndex === -1 ? null : localIndex - incomingIndex > 0 ? localIndex - incomingIndex : null

    // Strip `version` before sending — it's redundant with UpdateStatus.version.
    const { version: _, ...release } = entry
    return { release, releasesBehind }
  } finally {
    clearTimeout(timeout)
  }
}
