# Claude Usage Tracking Design

## Goal

Extend Orca's local stat tracking with a Claude-specific usage panel that answers:

- How many Claude tokens were used in Orca-managed worktrees?
- How much came from cache reads vs cache writes?
- Which models and worktrees consumed that usage?
- How has that usage changed over time?

This is intentionally **Claude-specific analytics**, not a generic agent stat. Claude Code already writes precise usage metadata to local transcript files, so Orca should ingest that source of truth instead of inferring token counts from terminal output.

## Why This Exists

The existing stats panel is good at "what Orca did for you" at a generic level:

- PRs created
- Agents spawned
- Time agents worked

Claude Code exposes a second class of value data that the current stat collector cannot infer:

- Input tokens
- Output tokens
- Cache reads
- Cache writes
- Per-model usage
- Per-session usage

Users who live in Claude Code care about both layers. Orca should show:

1. **Generic value stats** across all agents
2. **Deep Claude usage analytics** where the underlying data is precise

## User Experience

The Claude usage view lives in **Settings → Stats** directly below the existing lifetime stat cards.

### Primary entry state

The Stats page becomes two stacked sections:

1. **Orca Stats**
   - Existing lifetime cards
2. **Claude Usage**
   - Time-range filter
   - Scope filter
   - Claude token and cache analytics

The Claude Usage section is **collapsed behind an explicit enable/scan state** until the user opts in.

Why this is not shown eagerly: Orca is reading local Claude transcript files outside Orca's own data directory. Users should understand what is being read before the app scans those files.

### Scope filter

Users can switch between:

- **Orca worktrees only** (default)
- **All local Claude usage**

Why this split matters:

- Claude transcript logs include sessions that happen outside Orca.
- Orca should default to the usage it can legitimately attribute to Orca-managed worktrees.
- Advanced users still want the broader "all local Claude activity" view.

### Time-range filter

The Claude section supports:

- 7d
- 30d
- 90d
- All time

Why range filtering belongs here: Claude usage is time-series analytics, not a lifetime vanity count. Users need to answer "what happened this week?" without losing the long-term view.

### Empty states

If no Claude transcripts are found:

- Show: "No local Claude Code transcripts found"
- Add short help text that Orca reads local Claude usage logs from your Claude projects directory (for example `~/.claude/projects` on macOS/Linux)

If transcripts exist but none map to Orca worktrees:

- Show: "No Claude usage found in Orca worktrees yet"
- Keep the scope toggle visible so users can switch to "All local Claude usage"

### Loading and stale states

Before the first scan:

- Show a short explanation that Orca reads local Claude transcript metadata from your Claude projects directory (for example `~/.claude/projects` on macOS/Linux)
- Clarify that Orca stores usage metadata only, not prompt/response content
- Show a primary action: **Scan Claude usage**

While scanning:

- Show: "Scanning Claude transcripts..."
- Keep Orca's generic lifetime stats fully interactive
- Disable the Claude-specific controls until the scan completes

After a successful scan:

- Show "Updated X minutes ago"
- Show a manual **Refresh** action

Why this matters: the Claude section is analytics, not a core editor control. Slight staleness is acceptable, but the UI must make that staleness visible and intentional.

## Metrics (v1)

### Summary cards

The Claude section shows:

| Metric | Meaning |
| --- | --- |
| Input tokens | Prompt tokens sent to Claude |
| Output tokens | Generated tokens returned by Claude |
| Cache read | Input tokens served from Claude prompt cache |
| Cache write | Input tokens written into Claude prompt cache |
| Sessions | Distinct Claude transcript sessions in the selected scope/range |
| Turns | Assistant responses with non-zero usage data |

### Counting rules

To keep the UI consistent across summary cards, charts, and tables:

- Token and turn totals are computed from `dailyAggregates` after applying scope and range filters.
- `Turns` is the sum of `dailyAggregates.turnCount` in the selected scope/range.
- `Sessions` is the count of `ClaudeUsageSession` rows whose `lastTimestamp` falls within the selected range and that have at least one matching `locationBreakdown` entry for the selected scope.

Why lastTimestamp: the session table is "recent sessions" oriented, and counting by last activity matches user expectations better than counting by first-seen.

### Derived insights

Below the cards, show:

- **Cache reuse rate** = `cacheRead / (inputTokens + cacheRead)` when denominator > 0
- **Top model** by `input + output`
- **Top worktree/project** by `input + output`
- **Estimated API-equivalent cost** as a secondary metric, clearly labeled as an estimate

Why these are derived instead of primary cards:

- They are useful context, but token and cache totals are the actual raw signals users care about.
- Cost is directionally helpful but not the user's real bill for Pro/Max subscriptions.

### Visualizations

#### Daily stacked bars

One stacked daily chart for:

- Input
- Output
- Cache read
- Cache write

Why one chart instead of multiple: users care about the relationship between prompt volume, model output, and cache efficiency. A single stacked chart keeps those tradeoffs visible.

#### Breakdowns

Two compact breakdowns:

- **By model**
- **By worktree/project**

#### Recent sessions table

Columns:

- Last active
- Worktree/project
- Branch
- Model
- Turns
- Input
- Output
- Cache read
- Cache write

## Non-Goals

- No server-side telemetry
- No upload of transcript data
- No attempt to estimate non-Claude agents' token usage from terminal text
- No real-time tailing of transcript files in v1
- No per-message content display from transcripts
- No attempt to merge Claude usage into the existing generic `orca-stats.json` event log
- No long-lived persistence of every Claude assistant turn in v1

## Source of Truth

Claude usage comes from local JSONL transcript files under:

```txt
~/.claude/projects/**/*.jsonl
```

On Windows this is typically:

```txt
%USERPROFILE%\\.claude\\projects\\**\\*.jsonl
```

For assistant messages with usage metadata, the fields Orca cares about are:

```ts
type ClaudeTranscriptUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: {
    ephemeral_5m_input_tokens?: number
    ephemeral_1h_input_tokens?: number
  }
}
```

Related metadata used for grouping and filtering:

```ts
type ClaudeTranscriptRecord = {
  type: 'assistant' | 'user' | string
  sessionId?: string
  timestamp?: string
  cwd?: string
  gitBranch?: string
  entrypoint?: string
  isSidechain?: boolean
  message?: {
    model?: string
    usage?: ClaudeTranscriptUsage
    content?: Array<{ type?: string; name?: string }>
  }
}
```

V1 extraction intentionally reads only:

- `sessionId`, `timestamp`, `cwd`, `gitBranch`
- `message.model`
- `message.usage.*` token fields

It does not store or surface prompt/response content from transcripts.

Why: token and cache analytics do not require message contents, and minimizing what we read/store keeps the feature squarely in the "local analytics" lane.

### Why transcript parsing instead of PTY parsing

- PTY output does not expose trustworthy token counts
- Claude already writes exact usage counters locally
- Reusing Claude's own transcript format avoids heuristics and false attribution

## Architecture Overview

```txt
Claude JSONL transcripts (~/.claude/projects)
                │
                ▼
     ┌──────────────────────────┐
     │ ClaudeUsageScanner       │
     │ incremental file parser  │
     └─────────────┬────────────┘
                   │ session + daily aggregates
                   ▼
     ┌──────────────────────────┐
     │ ClaudeUsageStore         │
     │ local persisted index    │
     └─────────────┬────────────┘
                   │ IPC queries
                   ▼
     ┌──────────────────────────┐
     │ Settings Stats UI        │
     │ summary + charts + table │
     └──────────────────────────┘
```

Why a dedicated store instead of extending `StatsCollector`:

- The existing stats collector is an append-only Orca lifecycle event log.
- Claude usage is transcript-derived analytics with incremental file scanning and rich grouping queries.
- Mixing them would blur two different ownership models and make both systems harder to reason about.

## Ownership Boundary

### Main process owns

- Scanning transcript files
- Mapping transcript `cwd` values to Orca worktrees
- Persisting normalized Claude usage state
- Serving pre-aggregated queries over IPC

### Renderer owns

- Scope and time-range selection state
- Read-only presentation
- Empty/loading/error states

Why this split: transcript access is filesystem work and should stay in the main process. The renderer should not know about transcript paths or parsing rules.

## Data Model

Use a dedicated persisted file:

```txt
[userData]/orca-claude-usage.json
```

### Persisted shape

```ts
type ClaudeUsageSession = {
  sessionId: string
  firstTimestamp: string
  lastTimestamp: string
  model: string | null
  // Sessions can span multiple working directories (Claude logs record-level cwd).
  // For v1 we treat per-session location as a display hint, not the source of truth
  // for scoping. Scoping and totals come from per-record aggregation (see below).
  lastCwd: string | null
  lastGitBranch: string | null
  // If all usage in this session maps to exactly one Orca worktree, populate it.
  // Otherwise leave null and show "Multiple locations" in the UI.
  primaryWorktreeId: string | null
  primaryRepoId: string | null
  turnCount: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  totalCacheWrite5mTokens: number
  totalCacheWrite1hTokens: number
  // Aggregated token totals per attributed location for this session.
  // Why: real Claude sessions can span multiple cwd values. Without this breakdown,
  // "Orca worktrees only" would either misattribute tokens or show inconsistent
  // session rows. This remains bounded in practice (few locations per session).
  locationBreakdown: Array<{
    // Either an Orca worktree or "unscoped" when cwd cannot be mapped.
    locationKey: `worktree:${string}` | 'unscoped'
    repoId: string | null
    worktreeId: string | null
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    cacheWrite5mTokens: number
    cacheWrite1hTokens: number
    turnCount: number
  }>
}

type ClaudeUsageDailyAggregate = {
  // Day bucket is based on local time for the user's timezone.
  // Why: users expect "7d/30d" charts to line up with their local calendar day,
  // not UTC midnight.
  day: string // YYYY-MM-DD
  locationKey: `worktree:${string}` | 'unscoped'
  repoId: string | null
  worktreeId: string | null
  model: string | null // may be null if missing in the record
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cacheWrite5mTokens: number
  cacheWrite1hTokens: number
  turnCount: number
}

type ClaudeUsageProcessedFile = {
  path: string
  mtimeMs: number
  lineCount: number
}

type ClaudeUsageState = {
  schemaVersion: 1
  processedFiles: ClaudeUsageProcessedFile[]
  sessions: ClaudeUsageSession[]
  dailyAggregates: ClaudeUsageDailyAggregate[]
  scanState: {
    enabled: boolean
    lastScanStartedAt: number | null
    lastScanCompletedAt: number | null
    lastScanError: string | null
  }
}
```

### Why store sessions and daily aggregates instead of raw turns

- `sessions` make recent-session tables and duration calculations cheap
- `dailyAggregates` are enough for range-based charts and breakdowns
- `processedFiles` makes rescans incremental instead of reparsing the entire Claude history on every load

Why we do **not** persist raw turns in v1:

- Heavy Claude users can accumulate large transcript histories quickly
- A long-lived JSON array of turns would grow without bound and degrade load time
- The v1 UI does not need per-turn drill-down to be useful

### Bounded retention

V1 keeps:

- all session summaries
- all daily aggregates

This remains bounded enough for the intended UI while avoiding the unbounded growth of raw-turn persistence.

To keep the persisted file size predictable for heavy users, v1 also caps:

- Sessions retained: keep the most recent 5_000 sessions (for the recent-sessions table), but keep daily aggregates for all time.

Why this cap doesn't remove value: the UI only needs a small rolling window of recent sessions; charts and all-time totals can be computed from daily aggregates.

## Scan Lifecycle

### Trigger points

Run scans:

1. When the user explicitly enables Claude usage analytics from the Stats page
2. When the Claude section becomes visible and the previous scan is stale
3. Optionally on a low-frequency cadence while the Claude section remains open

V1 cadence:

- Mark a scan stale after 5 minutes
- Never run more than one scan concurrently

Why on-demand instead of startup scanning:

- Startup should not depend on parsing another app's transcript directory
- Users should not be surprised that Orca is reading `~/.claude/projects`
- The Stats page is an analytics surface, so explicit opt-in is acceptable

Why not per-file watchers in v1:

- Transcript directories can be large
- A stale-while-open refresh is good enough for a Settings analytics page
- Watchers are more stateful and fragile across platforms

### Incremental scanning algorithm

`processedFiles` is the scanner's correctness guardrail. For each JSONL file we track:

- `mtimeMs`
- `lineCount`

On scan:

1. If a file is new, parse all lines.
2. If `mtimeMs` is unchanged and `lineCount` is unchanged, skip.
3. If `mtimeMs` changed and `lineCount` increased, parse only the appended lines.
4. If `lineCount` decreased (file was truncated/rotated), rebuild the entire Claude usage state from scratch.

Why we handle truncation explicitly: JSONL logs can be rewritten or compacted. Treating "file shrank" as "skip" would silently drop real usage; treating it as "append-only" would double count.

### Timestamp bucketing

Claude transcript `timestamp` fields are ISO strings (typically with a `Z` suffix). For daily charts and range cutoffs:

- Parse timestamp to an absolute instant.
- Convert to the user's local timezone.
- Bucket by local calendar day as `YYYY-MM-DD`.

Why local-day bucketing: it matches how users think about "today", "this week", and "last 30 days" in a settings dashboard.

## Worktree Attribution

### Matching rule

When a transcript record has `cwd`, map it to an Orca worktree by canonicalized path equality.

If the `cwd` does not match a known Orca worktree path:

- `scope = all` includes it
- `scope = orca` excludes it

### Session location drift

Claude sessions can legitimately span multiple `cwd` values within a single `sessionId` (for example, jumping between packages in a monorepo). This means:

- Per-session `primaryWorktreeId` is only a display hint when the session stayed in one worktree.
- Scope correctness is driven by per-record attribution and aggregation into `dailyAggregates` and `session.locationBreakdown`.

Why: a "session belongs to a single worktree" assumption is false in real logs and would cause misattribution for the default "Orca worktrees only" scope.

### Project label fallback

Display label priority:

1. Orca worktree display name
2. Last path segment(s) from `cwd`
3. `"Unknown location"`

Canonicalization rules:

- Use `path.resolve()` to remove lexical `.` / `..`
- Use `fs.realpath()` when available so symlinked worktrees and transcript paths can still match
- On Windows, compare paths case-insensitively after normalization
- On macOS and Linux, preserve case but still normalize separators

Why explicit canonicalization matters: users often open worktrees through symlinks or different path spellings. Without a concrete normalization rule, "Orca worktrees only" would look randomly incomplete.

Why path equality instead of fuzzy matching:

- Token attribution must be conservative
- A false positive is worse than an unscoped session
- Orca already owns authoritative worktree paths

## IPC Surface

Expose a dedicated main-process API:

```ts
type ClaudeUsageScope = 'orca' | 'all'
type ClaudeUsageRange = '7d' | '30d' | '90d' | 'all'

type ClaudeUsageSummary = {
  scope: ClaudeUsageScope
  range: ClaudeUsageRange
  sessions: number
  turns: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cacheReuseRate: number | null
  estimatedCostUsd: number | null
  topModel: string | null
  // Display label for the highest-usage attributed location in the selected scope.
  // For `scope=orca`, this is an Orca worktree display name. For `scope=all`, it may
  // be a worktree name or "Unscoped" if most usage could not be mapped.
  topProject: string | null
  hasAnyClaudeData: boolean
}

type ClaudeUsageDailyPoint = {
  day: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

type ClaudeUsageBreakdownRow = {
  key: string
  label: string
  sessions: number
  turns: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  estimatedCostUsd: number | null
}

type ClaudeUsageSessionRow = {
  sessionId: string
  lastActiveAt: string
  durationMinutes: number
  projectLabel: string
  branch: string | null
  model: string | null
  turns: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}
```

Handlers:

- `claudeUsage:getSummary`
- `claudeUsage:getDaily`
- `claudeUsage:getBreakdown`
- `claudeUsage:getRecentSessions`
- `claudeUsage:refresh`
- `claudeUsage:getScanState`
- `claudeUsage:setEnabled`

Handler semantics:

- `claudeUsage:setEnabled({ enabled })` persists the flag and returns the new `scanState`.
- `claudeUsage:refresh()` starts a scan if `enabled` is true and no scan is currently running.
- Query handlers (`getSummary/getDaily/getBreakdown/getRecentSessions`) always return the most recently persisted data plus the current `scanState`.

Why explicit semantics: it prevents the renderer from accidentally triggering background scans outside the Claude usage view and makes scan state transitions predictable.

### Scope math

All scope and range queries are computed from persisted aggregates:

- Range is applied by filtering `dailyAggregates.day` (local day) against the chosen cutoff.
- `scope=orca` includes only rows where `locationKey` is `worktree:<id>`.
- `scope=all` includes both worktree-attributed rows and `'unscoped'` rows.

Why we do not require a worktree to still exist: usage history should remain stable even if a worktree is later removed. If a worktree ID cannot be resolved to a current display name, the UI shows a generic fallback label.

Why separate handlers instead of one giant payload:

- The summary should render quickly
- Large session tables should not block first paint
- It keeps the preload and renderer types easier to reason about

## Cost Calculation

V1 may show an optional API-equivalent cost estimate for known Claude models.

Rules:

- Only compute costs for models Orca explicitly recognizes
- Return `null` for unknown, local, or third-party models
- Label it as:
  - "Estimated API-equivalent cost"
  - "Not your actual Pro/Max bill"

Why keep this optional:

- It is useful context but not the user's literal spend
- Over-indexing on cost would make the panel feel like billing telemetry rather than helpful local analytics

Pricing source and staleness:

- Use a small hardcoded pricing table shipped with Orca, annotated with "pricing as of YYYY-MM-DD".
- Update it only as part of normal Orca releases; do not fetch pricing over the network.

Why: this feature is explicitly local-only. A network fetch would both violate expectations and add availability risk to a settings dashboard.

## Error Handling

### Missing transcript directory

If `~/.claude/projects` does not exist:

- Treat as a valid empty state
- Do not surface an alarming error banner

### Corrupt persisted Claude usage state

If `[userData]/orca-claude-usage.json` is missing or contains invalid JSON:

- Treat it as an empty state (do not crash on startup)
- Keep the corrupt file on disk for debugging (do not delete automatically)
- If Claude usage is enabled, allow the next manual refresh to rebuild state from a full rescan

Why "rebuild" is acceptable: this is a local analytics feature. Losing cached aggregates is unfortunate but not correctness-critical, and the source of truth (Claude transcripts) remains on disk.

### Safe persistence (avoid partial writes)

Writes to `[userData]/orca-claude-usage.json` must be atomic:

- write JSON to a uniquely named temp file in the same directory
- `rename` the temp file onto the final path

Why: scans can run while the app is in use, and large JSON writes are vulnerable to partial writes if the process crashes. Atomic rename prevents truncation/corruption from being the common failure mode.

### Consent and privacy expectations

Before the first scan, Orca must explicitly state:

- it reads local Claude transcript files from your Claude projects directory (for example `~/.claude/projects` on macOS/Linux)
- it extracts usage metadata only
- it does not upload transcript contents anywhere

Why this belongs in the design: reading another local tool's state is acceptable, but it should feel deliberate rather than sneaky.

### Corrupt JSON lines

Skip individual bad lines and continue scanning.

Why: Claude transcripts are append-only logs. One malformed line should not discard the rest of the session history.

### Partial scans

If a scan fails midway:

- Keep the previously persisted state
- Do not replace it with partial results
- Record scan metadata for debugging

Why: analytics should prefer slightly stale data over visibly broken or inconsistent data.

### Main-process performance

The scanner must parse transcript files asynchronously and yield between file batches so Electron's main process does not visibly hitch.

Implementation constraints:

- Do not perform one giant synchronous parse during startup
- Batch work by file and yield back to the event loop between batches
- If the scan is user-triggered from Settings, keep the renderer responsive while it runs

Why this is a hard requirement: a usage dashboard is optional; freezing the entire app to compute it would be an unacceptable regression.

## Cross-Platform Constraints

- Resolve transcript paths with Node path utilities only
- Do not assume `/` in persisted matching logic
- Normalize path comparisons before worktree attribution

Why: Claude transcript paths and Orca worktree paths need consistent equality semantics across macOS, Linux, and Windows.

## Deferred Work

- Model filter chips inside Orca
- Tool-use breakdown visualizations
- Branch-level breakdowns
- Cache 5m vs 1h breakdown cards
- Live file watching
- Export to CSV/JSON
- Merge Claude usage with other future agent-specific usage surfaces

Why these are deferred:

- The highest-value v1 is token/cache/session visibility scoped to Orca worktrees
- Additional filters and exports add UI and persistence complexity without changing the core utility

## Implementation Sketch

### Main process

- `src/main/claude-usage/scanner.ts`
- `src/main/claude-usage/store.ts`
- `src/main/ipc/claude-usage.ts`

### Shared types

- `src/shared/claude-usage-types.ts`

### Preload

- Add `window.api.claudeUsage.*`

### Renderer

- `src/renderer/src/store/slices/claude-usage.ts`
- `src/renderer/src/components/stats/ClaudeUsagePane.tsx`
- Reuse the Settings stats section instead of adding new sidebar chrome

## Final Direction Choices

This design intentionally chooses:

1. **On-demand, explicit-enable scanning**
   - first scan only happens after user action
   - later refreshes happen only while the Claude section is in active use

2. **Aggregates + sessions persistence**
   - keep session summaries and daily aggregates
   - do not persist raw turns in long-lived storage

3. **Claude section inside Stats**
   - generic Orca stats and Claude-specific analytics stay together
   - if the UI grows materially beyond the v1 scope, it can split into its own subsection later
