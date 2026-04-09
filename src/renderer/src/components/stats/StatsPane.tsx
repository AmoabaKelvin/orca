import { useEffect } from 'react'
import { Bot, Clock, GitPullRequest } from 'lucide-react'
import { useAppStore } from '../../store'
import { StatCard } from './StatCard'
import { ClaudeUsagePane } from './ClaudeUsagePane'
import type { SettingsSearchEntry } from '../settings/settings-search'

export const STATS_PANE_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  {
    title: 'Stats & Usage',
    description: 'Orca stats plus Claude usage analytics, tokens, cache, and sessions.',
    keywords: [
      'stats',
      'usage',
      'statistics',
      'agents',
      'prs',
      'time',
      'tracking',
      'claude',
      'tokens',
      'cache'
    ]
  }
]

function formatDuration(ms: number): string {
  if (ms <= 0) {
    return '0m'
  }

  const totalMinutes = Math.floor(ms / 60_000)
  const totalHours = Math.floor(totalMinutes / 60)
  const totalDays = Math.floor(totalHours / 24)
  const remainingHours = totalHours % 24
  const remainingMinutes = totalMinutes % 60

  if (totalDays > 0) {
    return `${totalDays}d ${remainingHours}h`
  }
  if (totalHours > 0) {
    return `${totalHours}h ${remainingMinutes}m`
  }
  return `${totalMinutes}m`
}

function formatTrackingSince(timestamp: number | null): string {
  if (!timestamp) {
    return ''
  }
  const date = new Date(timestamp)
  return `Tracking since ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

export function StatsPane(): React.JSX.Element {
  const summary = useAppStore((s) => s.statsSummary)
  const fetchStatsSummary = useAppStore((s) => s.fetchStatsSummary)

  useEffect(() => {
    void fetchStatsSummary()
  }, [fetchStatsSummary])

  if (!summary) {
    return <ClaudeUsagePane />
  }

  const trackingSince = formatTrackingSince(summary.firstEventAt)

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        {summary.totalAgentsSpawned === 0 && summary.totalPRsCreated === 0 ? (
          <div className="flex min-h-[8rem] items-center justify-center rounded-lg border border-dashed border-border/60 bg-card/30 text-sm text-muted-foreground">
            Start your first agent to begin tracking
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <StatCard
                label="Agents spawned"
                value={summary.totalAgentsSpawned.toLocaleString()}
                icon={<Bot className="size-4" />}
              />
              <StatCard
                label="Time agents worked"
                value={formatDuration(summary.totalAgentTimeMs)}
                icon={<Clock className="size-4" />}
              />
              <StatCard
                label="PRs created"
                value={summary.totalPRsCreated.toLocaleString()}
                icon={<GitPullRequest className="size-4" />}
              />
            </div>
            {trackingSince && <p className="px-1 text-xs text-muted-foreground">{trackingSince}</p>}
          </>
        )}
      </div>

      <ClaudeUsagePane />
    </div>
  )
}
