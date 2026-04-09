# Stat Tracking Design

## Goal

Give users a delightful, low-friction view of how Orca has helped them over time. The stat panel answers: "How much has Orca done for me?"

## Metrics (v1)

| #   | Metric                         | What it measures                                                      |
| --- | ------------------------------ | --------------------------------------------------------------------- |
| 1   | **PRs created**                | PRs opened from Orca worktrees (detected via branch → PR association) |
| 2   | **Total agents spawned**       | Lifetime count of agent sessions launched                             |
| 3   | **Time agents worked for you** | Cumulative agent active time (spawn → last meaningful output)         |

### Deferred metrics (v2+, event log supports replay)

- **Avg / max concurrency** — deferred because avg concurrency is hard for users to intuit ("2.3x" means what?) and max is a high-water mark that becomes stale. The event log captures all agent start/stop timestamps, so these can be derived later without schema changes.
- **Streak** — deferred because consecutive-day streaks work for daily-habit apps (Duolingo) but not dev tools with irregular usage. Multi-day gaps (weekends, planning phases) are normal and healthy; a resetting streak feels punishing.

## UI Entry Point

The stats panel lives in the **Settings page** as a dedicated section. This keeps it discoverable without adding new sidebar chrome.

**Empty state:** When no events have been recorded yet, display a brief message ("Start your first agent to begin tracking") instead of a grid of zeros.

**Data formatting:**

- PRs created: integer ("12 PRs")
- Agents spawned: integer ("847 agents")
- Time worked: human-readable duration ("3h 42m" for short, "12d 8h" for long)

## Non-Goals

- No server-side telemetry. All data stays local in the user's data directory.
- No real-time polling or timers for collection. All metrics derive from existing lifecycle events.
- No per-repo or per-worktree breakdown in v1 (can be added later since events carry repo/worktree context).

## Architecture Overview

```
Lifecycle events (PTY, GitHub, worktree)
        │
        ▼
┌─────────────────┐     append-only
│  StatsCollector  │ ──────────────▶  orca-stats.json
│  (main process)  │                  (~/.config/orca/)
└─────────────────┘
        │
        │  IPC: stats:summary
        ▼
┌─────────────────┐
│   Stats Panel    │  (renderer)
│   read-only UI   │
└─────────────────┘
```

All collection happens in the main process, piggy-backing on events that already fire. The renderer is a pure consumer — it fetches a pre-computed summary over IPC.

## Event Schema

Every trackable moment is recorded as a lightweight event appended to an in-memory log, then flushed to disk on the same debounced schedule as the main persistence store.

```ts
type StatsEventType =
  | 'agent_start' // agent PTY detected
  | 'agent_stop' // agent PTY exited or went idle
  | 'pr_created' // PR opened from an Orca worktree

type StatsEvent = {
  type: StatsEventType
  at: number // Date.now() timestamp
  // Optional context for future per-repo/per-worktree breakdowns.
  // Not used for v1 aggregation but captured now to avoid retrofitting.
  repoId?: string
  worktreeId?: string
  meta?: Record<string, string | number>
  // meta examples:
  //   agent_start:  { ptyId: '42' }
  //   agent_stop:   { ptyId: '42', durationMs: 185000 }
  //   pr_created:   { prNumber: 123 }
}
```

### Why an event log instead of pre-aggregated counters

Counters are simpler but lossy. An event log lets us:

- Compute new derived stats later without migration (e.g., "busiest hour" or per-repo breakdown).
- Replay and recompute aggregates if the formula changes.
- Debug surprising numbers by inspecting raw events.

The log is bounded (see Storage section) so it does not grow unboundedly.

## Data Collection

### 1. Agent detection (→ `agent_start`, `agent_stop`)

**Hook point:** `onPtyData()` in `orca-runtime.ts` (already called on every PTY data chunk) and `onPtyExit()`.

**How it works:**

The renderer already has a battle-tested agent detection system based on OSC terminal title sequences (`\x1b]0;...\x07`). Agent CLIs (Claude Code, Gemini, Codex, aider, opencode) deliberately set OSC titles to announce their identity and status. This is far more reliable than substring scanning raw output, which would produce false positives from shell startup noise (PATH contents, conda environments, prompt themes).

We port the existing `extractLastOscTitle` regex and `detectAgentStatusFromTitle` logic to a shared location importable by the main process.

```ts
// Ported from renderer — single regex scan on raw PTY data.
// Why OSC titles instead of substring scanning:
// 1. Zero false positives — OSC titles are set deliberately by CLIs, not
//    incidentally by shell initialization or command output.
// 2. Already proven — the renderer uses this for activity indicators,
//    unread badges, and notification triggers.
// 3. Provides status granularity (working/idle/permission) for free,
//    enabling more accurate "time worked" tracking in v2.
const OSC_TITLE_RE = /\x1b\]([012]);([^\x07\x1b]*?)(?:\x07|\x1b\\)/g

function extractLastOscTitle(data: string): string | null {
  let last: string | null = null
  let m: RegExpExecArray | null
  OSC_TITLE_RE.lastIndex = 0
  while ((m = OSC_TITLE_RE.exec(data)) !== null) {
    last = m[2]
  }
  return last
}

// Reuse the renderer's full detection function, not just agent name matching.
// Why: a simple `AGENT_NAMES.includes()` check would miss agent titles that
// don't contain the agent's name — e.g., Claude Code's working title is
// ". some task description" (no "claude"), and Gemini uses unicode symbols
// (✦, ⏲, ◇, ✋) without always including "gemini". The renderer's
// detectAgentStatusFromTitle handles all these cases and is the source of truth.
import { detectAgentStatusFromTitle } from '../shared/agent-detection'

function isAgentTitle(title: string): boolean {
  return detectAgentStatusFromTitle(title) !== null
}
```

**Detection state machine per PTY:**

```
┌───────────┐  OSC title detected  ┌─────────┐  PTY exit       ┌─────────┐
│  UNKNOWN  │  as an agent         │  AGENT  │ ──────────────▶ │ STOPPED │
│           │ ───────────────────▶ │         │                  │         │
└───────────┘                      └─────────┘                  └─────────┘
      │                                                              │
      │  PTY exit (no agent title seen)                              │
      └──────────────────────────────── (no events emitted) ─────────┘
```

- `UNKNOWN → AGENT`: When `extractLastOscTitle(rawData)` returns a title and `detectAgentStatusFromTitle(title) !== null`, emit `agent_start`. Record `ptyId` and start timestamp.
- `AGENT → STOPPED`: On PTY exit, emit `agent_stop` with `durationMs = lastMeaningfulOutputAt - startTimestamp`.

**Measuring "time worked" accurately:**

The `agent_stop` duration uses `lastMeaningfulOutputAt`, not the raw `lastOutputAt` from the runtime. The runtime's `lastOutputAt` advances on every PTY data chunk, including ANSI-only noise (cursor repositioning, prompt redraws) that normalizes to an empty string. An agent sitting at an idle prompt would appear to be "working" indefinitely under the raw timestamp.

The agent detector maintains its own `lastMeaningfulOutputAt` per PTY, updated only when the raw data chunk contains non-empty content after normalization (i.e., when `normalizeTerminalChunk(data).length > 0`). This prevents idle-at-prompt time from inflating the "time agents worked" metric.

**Why not substring scanning:**
The original design proposed scanning the first ~2KB of raw PTY output for agent name strings. This was rejected because:

- Shell `.zshrc`/`.bashrc` can print PATH contents, conda environments, or prompt themes containing words like "claude" or "cursor" — producing false positives.
- The word "cursor" in particular appears in normal terminal output (TUI cursor positioning, vim status bars).
- The 2KB window is fragile — heavily customized shells can produce more startup output than that before the agent banner appears.
- OSC titles are always emitted by agent CLIs regardless of shell startup noise.

**Performance notes:**

- `extractLastOscTitle` is a single regex scan on the raw `data` string — comparable cost to one of the existing `normalizeTerminalChunk` regex passes that already runs on every chunk.
- Once a PTY is classified (agent or non-agent), the OSC scan is removed for that PTY — zero per-chunk overhead for the rest of its lifetime.
- The detector receives the **raw** `data` string (before normalization), since `normalizeTerminalChunk` strips OSC sequences.
- No new timers, no polling.

**Implementation location:** New file `src/main/stats/agent-detector.ts`, called from `OrcaRuntimeService.onPtyData()` and `OrcaRuntimeService.onPtyExit()`. The `extractLastOscTitle` regex and `AGENT_NAMES` list should be moved to `src/shared/` so the renderer and main process share the same definitions.

### 2. Shutdown: closing orphaned agent sessions

**Problem:** `killAllPty()` in `src/main/ipc/pty.ts` is called during `before-quit`. It kills all PTY processes but does **not** call `runtime.onPtyExit()` for them. Without intervention, agents running at quit time would produce orphaned `agent_start` events with no matching `agent_stop`, losing their duration from `totalAgentTimeMs` and leaving the wall-clock accumulator unclosed.

**Solution:** `StatsCollector.flush()` is called during `before-quit`, **before** `killAllPty()`. It:

1. Emits a synthetic `agent_stop` for every PTY that is still in the `AGENT` state, using `Date.now()` as the stop timestamp, adding the duration to `totalAgentTimeMs`.
2. Writes the stats file synchronously (same pattern as `Store.flush()`).

**Re-entrancy safety:** Electron's `before-quit` can fire multiple times — the updater's handler (`updater-events.ts:67-87`) calls `event.preventDefault()` to defer macOS update installs, cancelling the quit. When `app.quit()` is called again later, `before-quit` fires a second time.

`flush()` must be **idempotent**: it closes out live agents and writes to disk, but does **not** permanently clear in-memory agent tracking state. If agents continue producing data between a prevented quit and the real quit, the second `flush()` must close those new sessions correctly.

```ts
// StatsCollector.flush() — idempotent shutdown
flush(): void {
  const now = Date.now()
  // Emit synthetic agent_stop for every live agent.
  // Why we iterate a snapshot: onAgentStop() mutates liveAgents, so we
  // snapshot the keys first to avoid iterator invalidation.
  for (const ptyId of [...this.liveAgents.keys()]) {
    this.onAgentStop(ptyId, now)
  }
  this.writeToDiskSync()
  // Why we do NOT clear liveAgents or aggregates here:
  // before-quit can fire multiple times (updater preventDefault).
  // If agents keep running between the cancelled quit and the real one,
  // onAgentStart/onAgentStop will re-populate liveAgents and the next
  // flush() will close them out correctly.
}
```

**Renderer reload:** `did-finish-load` in `pty.ts` (lines 33-48) kills orphaned PTYs from previous load generations via `proc.kill()` but does **not** call `runtime.onPtyExit()`. Without a fix, killed PTYs would remain in the agent detector's `liveAgents` map and accumulate inflated durations on the next `flush()`.

**Fix:** Add `runtime?.onPtyExit(id, -1)` to the `did-finish-load` cleanup loop, matching the pattern already used in the `pty:kill` handler (line 254) and the PTY controller's `kill` method (line 72). This is a one-line addition per killed PTY:

```ts
// In did-finish-load cleanup loop (pty.ts):
for (const [id, proc] of ptyProcesses) {
  const gen = ptyLoadGeneration.get(id) ?? -1
  if (gen < loadGeneration) {
    try {
      proc.kill()
    } catch {
      /* already dead */
    }
    ptyProcesses.delete(id)
    ptyShellName.delete(id)
    ptyLoadGeneration.delete(id)
    runtime?.onPtyExit(id, -1) // NEW — notify runtime so stats are closed out
  }
}
```

### 3. PR created (→ `pr_created`)

**Hook point:** `gh:prForBranch` IPC handler in `src/main/ipc/github.ts`.

**How it works:**

The renderer already polls `gh:prForBranch` to check for PR status per worktree. When a PR is first detected for a branch (transitions from null → PRInfo), emit a `pr_created` event. This captures PRs opened from any workflow — Orca's UI, the `gh` CLI, or github.com — as long as the branch was created through an Orca worktree.

**Why track creation instead of merges:**

- `gh:mergePR` only captures merges done through Orca's UI. Users who merge from github.com or auto-merge rules would see an unexpectedly low count.
- PR creation from an Orca worktree branch is a more reliable signal of "work done in Orca" regardless of how the PR was ultimately merged.

**Detection approach:**

The `StatsCollector` maintains a `Set<string>` of PR URLs already counted (keyed by `PRInfo.url`). When `gh:prForBranch` returns a non-null PRInfo and the URL is not in the set, emit `pr_created` and add the URL. The set is persisted in `StatsAggregates` to survive restarts.

```ts
// In gh:prForBranch handler, after successful fetch:
const pr = await getPRForBranch(repoPath, args.branch)
if (pr && !stats.hasCountedPR(pr.url)) {
  stats.record({
    type: 'pr_created',
    at: Date.now(),
    repoId: repo.id,
    worktreeId,
    meta: { prNumber: pr.number }
  })
}
return pr
```

**Required code changes to `github.ts`:**

1. `registerGitHubHandlers` signature changes from `(store: Store)` to `(store: Store, stats: StatsCollector)`.
2. `assertRegisteredRepoPath` returns the full `Repo` object (not just the path string) so the handler has access to `repo.id`.

```ts
function assertRegisteredRepo(repoPath: string, store: Store): Repo {
  const resolvedRepoPath = resolve(repoPath)
  const repo = store.getRepos().find((r) => resolve(r.path) === resolvedRepoPath)
  if (!repo) {
    throw new Error('Access denied: unknown repository path')
  }
  return repo
}
```

**Performance notes:**

- The `hasCountedPR` check is an O(1) set lookup. The set size equals the number of unique PRs ever created — bounded in practice (a few hundred at most).
- No additional GitHub API calls — piggy-backs on the existing `gh:prForBranch` polling.

### 4. Live agent tracking (for shutdown coordination)

The collector maintains an in-memory `Map<ptyId, startTimestamp>` for live agents. This is **not persisted** — it is runtime-only state used for:

1. Emitting synthetic `agent_stop` events during `flush()` (shutdown).
2. Computing `durationMs` for `agent_stop` events.

```ts
private liveAgents = new Map<string, number>()  // ptyId → startTimestamp

onAgentStart(ptyId: string, at: number): void {
  this.liveAgents.set(ptyId, at)
}

onAgentStop(ptyId: string, at: number): void {
  const startAt = this.liveAgents.get(ptyId)
  if (startAt !== undefined) {
    this.liveAgents.delete(ptyId)
    const durationMs = at - startAt
    this.aggregates.totalAgentTimeMs += durationMs
  }
}

// Live agent count is always this.liveAgents.size — no separate counter
// to avoid drift between the map and a redundant integer.
```

Concurrency-derived metrics (avg/max) are deferred to v2 but can be computed from the event log's `agent_start`/`agent_stop` timestamps when needed.

## Storage

### File: `orca-stats.json`

Located alongside `orca-data.json` in the user data directory (`~/.config/orca/` on macOS/Linux, `%APPDATA%/orca/` on Windows).

**Why a separate file from `orca-data.json`:**

- Stats grow over time (append-only events). Mixing them into the main state file would bloat every debounced write with the full event history.
- Independent read/write lifecycle — stats are written less frequently and read rarely (only when the stats panel opens).
- Avoids schema coupling — stats can evolve independently.

### Shape

```ts
type StatsFile = {
  schemaVersion: number // 1
  events: StatsEvent[] // bounded event log
  aggregates: StatsAggregates // pre-computed summary, updated on each write
}

type StatsAggregates = {
  totalAgentsSpawned: number
  totalPRsCreated: number
  totalAgentTimeMs: number
  // Set of PR URLs already counted, to deduplicate across restarts.
  // Keyed by PR URL string. Bounded in practice (a few hundred at most).
  countedPRs: string[]
  // Why persisted here instead of derived from events[0].at:
  // The event log is bounded to 10K entries. Once trimmed, events[0].at
  // would jump forward, making "tracking since..." inaccurate. This field
  // is set once on the very first event and never updated.
  firstEventAt: number | null
}
```

### Bounds

- **Event retention:** Keep the last 10,000 events. Older events are trimmed on write. At ~150 bytes/event, this caps the file at ~1.5 MB.
- **Write frequency:** Debounced at 5 seconds (slower than the 300ms main store, since stats are not latency-sensitive). Also flushed synchronously on `before-quit`.

### Recovery

On load, if `orca-stats.json` exists but contains invalid JSON (truncated write, disk error, manual editing), `JSON.parse` will throw. The `StatsCollector` constructor must handle this gracefully — an unhandled parse error would crash the app on startup.

```ts
// StatsCollector.load() — follows the same try/catch pattern as persistence.ts:62-93
try {
  const raw = readFileSync(statsFile, 'utf-8')
  const parsed = JSON.parse(raw) as StatsFile
  // Merge with defaults for forward compatibility
  return { ...getDefaultStatsFile(), ...parsed }
} catch (err) {
  console.error('[stats] Failed to load stats, starting fresh:', err)
  return getDefaultStatsFile()
}
```

**Why "start fresh" instead of crashing:** Lifetime aggregates (totalAgentsSpawned, totalAgentTimeMs) are lost on corruption, which is unfortunate but not critical — this is a "fun stats" feature, not billing data. The alternative (crashing the app) is far worse. The corrupt file is left on disk (not deleted) so it can be inspected for debugging.

### Migration

On load, if `schemaVersion` is missing or lower than current:

1. **Existing aggregate fields are preserved.** Lifetime counters (`totalAgentsSpawned`, `totalPRsCreated`, `totalAgentTimeMs`, `firstEventAt`) are the source of truth — they were maintained incrementally and cover all events, not just the retained 10K.
2. **New aggregate fields** added in the new schema version are computed from the event log. Since the log only covers the last 10K events, these new fields start with a partial history — this is acceptable because they did not exist before.
3. **Formula changes** to existing fields cannot be retroactively corrected beyond the event log window. If a formula changes, document the discontinuity rather than silently recomputing with incomplete data.

Bump `schemaVersion` and let the migration run once on next load.

## Aggregation

Aggregation is purely incremental — counter bumps on each event:

- `agent_start` → `totalAgentsSpawned++`
- `agent_stop` → `totalAgentTimeMs += durationMs`
- `pr_created` → `totalPRsCreated++`, add URL to `countedPRs`
- Any event → set `firstEventAt` if null

No derived metrics in v1. All values are read directly from `StatsAggregates`.

## IPC Interface

One new handler:

```ts
ipcMain.handle('stats:summary', (): StatsSummary => {
  return statsCollector.getSummary()
})
```

```ts
type StatsSummary = {
  totalAgentsSpawned: number
  totalPRsCreated: number
  totalAgentTimeMs: number
  // For display formatting — sourced from aggregates, not the event log,
  // so it survives event trimming.
  firstEventAt: number | null // timestamp of first-ever event, for "tracking since..."
}
```

The renderer calls this once when the stats panel mounts. No subscriptions, no polling.

## File Layout

```
src/shared/
  ├── agent-detection.ts   # extractLastOscTitle, detectAgentStatusFromTitle, AGENT_NAMES
  │                        # (shared between main process and renderer)
  └── types.ts             # Add StatsSummary to shared types

src/main/stats/
  ├── collector.ts         # StatsCollector class — event recording, aggregation, persistence
  ├── agent-detector.ts    # Per-PTY agent detection state machine (uses shared/agent-detection)
  └── types.ts             # StatsEvent, StatsAggregates (internal to main)

src/main/ipc/stats.ts      # IPC handler registration (stats:summary)

src/renderer/src/
  ├── lib/agent-status.ts          # Updated to import from shared/agent-detection
  ├── store/slices/stats.ts        # Zustand slice (fetches summary on mount)
  └── components/stats/
       ├── StatsPanel.tsx           # Main stats view (grid of stat cards)
       └── StatCard.tsx             # Individual metric card with label + value
```

## Integration Points

### main/index.ts

```ts
import { StatsCollector, initStatsPath } from './stats/collector'

// Why: must be called at the same point as initDataPath() — after
// configureDevUserDataPath() but before app.setName('Orca'). Same
// timing concern as persistence.ts (see comment in persistence.ts:21-28).
initStatsPath()

// After store initialization:
const stats = new StatsCollector()

// Pass to IPC registration and runtime:
registerStatsHandlers(stats)
// Pass to runtime for agent detection hooks:
runtime.setStatsCollector(stats)
```

Shutdown ordering in `before-quit`:

```ts
app.on('before-quit', () => {
  // Why: stats.flush() must run before killAllPty() so it can read the
  // live agent state and emit synthetic agent_stop events for agents that
  // are still running. killAllPty() does not call runtime.onPtyExit(),
  // so without this ordering, running agents would produce orphaned
  // agent_start events with no matching stops.
  stats.flush()
  killAllPty()
  runtimeRpc?.stop()
  store?.flush()
})
```

### main/runtime/orca-runtime.ts

In `onPtyData()`:

```ts
onPtyData(ptyId: string, data: string, at: number): void {
  // ... existing tail buffer logic ...
  this.agentDetector?.onData(ptyId, data, at)
}
```

In `onPtyExit()`:

```ts
onPtyExit(ptyId: string, exitCode: number): void {
  // ... existing exit logic ...
  this.agentDetector?.onExit(ptyId)
}
```

### main/ipc/github.ts

In `gh:prForBranch` handler — emit `pr_created` event when a PR is first detected for a branch (shown in Section 3).

## Performance Budget

| Operation            | Frequency                         | Cost                                                                                                                                            |
| -------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent OSC title scan | Until classified per PTY          | One regex scan (`OSC_TITLE_RE`) on raw data per chunk, comparable to one `normalizeTerminalChunk` pass. Amortized to zero after classification. |
| Event recording      | ~10-50/day typical                | In-memory array push. No I/O.                                                                                                                   |
| Stats file write     | Debounced 5s, plus shutdown flush | Single `JSON.stringify` + atomic rename via uniquely-named temp file (same race-safe pattern as `persistence.ts:120`). ~3-8ms for 10K events.   |
| Stats file read      | Once per app launch               | Single `JSON.parse`. ~2ms for 10K events.                                                                                                       |
| IPC summary query    | Once per stats panel open         | Read pre-aggregated fields + two arithmetic operations. <0.1ms.                                                                                 |

**Total overhead on hot path (PTY data):** One regex scan on raw data per chunk until the PTY is classified, then zero. The OSC regex is comparable in cost to the existing `normalizeTerminalChunk` regex passes. No measurable impact on terminal throughput.

## Future Extensions (not in v1)

- **Avg / max concurrency** — derivable from `agent_start`/`agent_stop` timestamps in the event log.
- **Streak** — derivable from event timestamps. Revisit if users request gamification.
- **Per-repo / per-worktree breakdown** — events already carry `repoId` and `worktreeId`.
- **Weekly recap / Wrapped-style card** — aggregate over 7-day window, render shareable image.
- **Badges / milestones** — derived from aggregate thresholds ("First 100 agents", "10-day streak").
- **CLI command** — `orca stats` to print summary from terminal.
- **Agent type tracking** — extend `agent_start` meta to include which agent tool was detected.
