// A path's first segment that is really a web host, so `example.com/docs/guide.html` in chat
// is a URL someone dropped the scheme from rather than a folder. Only the leading segment of
// a relative candidate is tested, so these names collide with directories, not with files.
// Why an allowlist and not "any dotted label": `conf.d/nginx.conf` and `v1.2/notes.md` are
// directories. Why no country codes: they double as extensions (`.pl`, `.pt`), and here they
// would have to name a directory to matter at all. Why no `app`: macOS bundles are folders.
const HOSTNAME_TLDS = new Set([
  'ai',
  'biz',
  'cc',
  'chat',
  'cloud',
  'co',
  'com',
  'dev',
  'edu',
  'gg',
  'gov',
  'info',
  'io',
  'link',
  'me',
  'mil',
  'net',
  'online',
  'org',
  'site',
  'store',
  'tech',
  'tv',
  'xyz'
])
const DOTTED_NUMERIC_PATTERN = /^\d+(?:\.\d+)+$/

export function looksLikeHostname(segment: string): boolean {
  if (segment.startsWith('.')) {
    return false
  }
  if (segment === 'localhost' || DOTTED_NUMERIC_PATTERN.test(segment)) {
    return true
  }
  const labels = segment.toLowerCase().split('.')
  return labels.length > 1 && HOSTNAME_TLDS.has(labels.at(-1) ?? '')
}
