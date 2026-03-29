# Right Sidebar Conflict Resolution Status

## Goal

Show active conflict state during merge, rebase, and cherry-pick operations directly inside the existing `Staged Changes` and `Changes` lists in the right sidebar, similar to VS Code and GitHub Desktop.

All three operations produce the same porcelain v2 `u` records when conflicts arise. This design applies uniformly to all of them.

The panel should answer four questions without opening a diff:

1. Is this file in a merge conflict?
2. What kind of conflict is it?
3. Is this conflict still unresolved right now?
4. If it is no longer unresolved, what should I do next?

It should not claim more than Git can prove in the current refresh.

In v1, live unresolved conflict state must come from the current Git status output.
However, the UI may also carry a clearly-labeled local session state for already-open tabs and recently-resolved rows when that state is derived from a file the user opened from a live unresolved conflict in the current session.
That local state is UX scaffolding, not Git truth, and must never be labeled as if Git is still reporting an unmerged entry.

V1 does not attempt to detect conflict markers in working-tree file contents.
If the user resolves a conflict outside the app (e.g., runs `git add <file>` in a terminal), the `u` record disappears from `git status` and the app treats the file as no longer conflicted.
This means a file can leave the conflict state while still containing unresolved conflict markers.
This is a known limitation; v1 trusts Git's index state as the sole authority for whether a file is currently in an unresolved merge conflict.

## Current State

Today the right sidebar groups files only by:

- `staged`
- `unstaged`
- `untracked`

Each row only knows (via `GitUncommittedEntry`, aliased as `GitStatusEntry`):

- `path`
- `status`
- `area`
- `oldPath?`

That is enough for normal file changes, but not for merge conflict UX:

- unresolved conflicts are not represented explicitly
- the user cannot tell conflict type (`both modified`, `deleted by them`, etc.)
- the user cannot tell whether a file is currently unresolved
- conflict resolution progress becomes hard to follow once a file leaves the live `u` state
- the panel does not visually prioritize conflicted files

Relevant code:

- [src/main/git/status.ts](../src/main/git/status.ts)
- [src/shared/types.ts](../src/shared/types.ts)
- [src/renderer/src/components/right-sidebar/SourceControl.tsx](../src/renderer/src/components/right-sidebar/SourceControl.tsx)

## Design Principles

- Keep the current sidebar structure. Users already understand `Staged Changes` and `Changes`.
- Add conflict state to rows, but also provide a merge-resolution summary so users can scan progress quickly.
- Make unresolved conflicts impossible to miss.
- Show only conflict state that Git can prove in the current refresh.
- Use the same file in both sections when Git says both staged and unstaged states exist.
- When the UI shows session-local post-conflict state, label it explicitly as local UI state rather than current Git conflict truth.

## Proposed UX

### 0. Merge summary

When at least one unresolved conflict exists, show a compact merge summary above the normal sections.

Recommended presentation:

- `Merge conflicts: 3 unresolved` (count reflects only live `u`-record conflicts, not `Resolved locally` rows)
- the label should reflect the active operation when detectable:
  - `Merge conflicts: 3 unresolved` when `MERGE_HEAD` exists
  - `Rebase conflicts: 3 unresolved` when `REBASE_HEAD` exists
  - `Cherry-pick conflicts: 3 unresolved` when `CHERRY_PICK_HEAD` exists
  - `Conflicts: 3 unresolved` as a fallback when no ref file is found or multiple exist
- operation detection uses `fs.existsSync` on `.git/MERGE_HEAD`, `.git/REBASE_HEAD`, and `.git/CHERRY_PICK_HEAD` in the main process, performed alongside the existing status poll (note: there is a race between the `git status` call and the `fs.existsSync` call — the HEAD file may not yet exist or may already be cleaned up — in that case the operation falls back to `'unknown'` for one poll cycle, which is acceptable)
- secondary action: `Review conflicts`
- optional tertiary hint: `Resolved files move back to normal changes after they leave the live conflict state`

Why:

- users in a merge flow think first in terms of “how many conflicts are left”
- this preserves the existing section structure without forcing conflict work to compete visually with every other file change
- it gives the user a stable place to orient before scanning individual rows

V1 may keep `Changes` and `Staged Changes` as the main lists, but unresolved conflicts should also be discoverable through this merge summary entry point.

`Review conflicts` must have a concrete v1 behavior:

- it opens a lightweight conflict-review tab scoped to the current live unresolved conflict set
- the tab lists only unresolved conflict rows, not ordinary diffs
- each item opens the same conflict-safe single-file entry point described in section 5
- if the unresolved set changes later, the already-open review tab may keep showing the snapshot it was opened with, as long as the UI labels it as a snapshot and offers a refresh or reopen action
- if all conflicts in the snapshot are resolved and the list becomes empty, the tab must show an explicit "all conflicts resolved" state with a dismiss action, not a blank list
- the "all conflicts resolved" state should also offer a link back to `Source Control` to continue the merge workflow

V1 does not require a merge-aware three-way diff queue. A lightweight conflict list view is sufficient.

Information architecture decision for v1:

- `Review conflicts` belongs to `Source Control`, not `Checks`
- it is launched from `Source Control` into the editor area as a dedicated review tab, similar to `Open all diffs`
- do not create a new permanent right-sidebar top-level tab for conflicts in v1

Why:

- merge-conflict review is source-control work, not CI/PR status
- the app already uses editor tabs as the place where review workflows expand beyond the sidebar
- this improves the conflict workflow without fragmenting navigation

### 1. File row anatomy

Each file row keeps the current filename and directory, and may also show a normal status letter when one exists for the current row model.
Conflict rows add explicit conflict UI instead of pretending they are ordinary file states.

Row layout:

`[icon] filename dir [status letter?] [conflict badge]`

Conflict badge values for v1:

- `Unresolved`
- `Resolved locally`

Conflict subtype text:

- `Both modified`
- `Both added`
- `Deleted by us`
- `Deleted by them`
- `Added by us`
- `Added by them`
- `Both deleted`

Recommended presentation:

- badge is compact and high-contrast
- subtype appears as muted secondary text under or beside the filename
- unresolved uses destructive color
- `Resolved locally` uses a quieter success or accent treatment and must include tooltip/help text that it is derived from the current session, not from live Git conflict output
- if a conflict row does not have a meaningful ordinary status letter, omit the letter instead of inventing one
- conflict rows may replace ordinary status letters entirely when showing a normal status letter would create contradictory meaning

Action-oriented helper text:

- `Both modified` -> `Open and edit the final contents`
- `Both added` -> `Choose which version to keep, or combine them`
- `Deleted by us` -> `Decide whether to restore the file`
- `Deleted by them` -> `Decide whether to keep the file or accept deletion`
- `Added by us` -> `Review whether to keep the added file`
- `Added by them` -> `Review the added file before keeping it`
- `Both deleted` -> `Resolve in Git or restore one side before editing`

Non-goal for v1:

- carrying conflict history forward after the `u` record disappears

Clarification:

- v1 may show `Resolved locally` only when the app can tie that row or tab to a file that was opened from a live unresolved conflict during the current session
- v1 should not invent historical conflict state for files the user never interacted with in the current session

### 2. Section behavior

Keep the existing sections, but add a merge-resolution summary above them and order conflicted files first within `Changes` and `Staged Changes`.

#### `Changes`

This section should contain:

- normal unstaged files
- unresolved conflicts
- optionally, recently resolved files from the current session that still have unstaged changes and need review

Expected labels:

- unresolved conflict: `Unresolved`
- recently resolved in current session: `Resolved locally`

This matches the user expectation: the working tree still needs attention.

#### `Staged Changes`

This section should contain:

- normal staged files
- optionally, recently resolved files from the current session that were staged after conflict resolution

`Resolved locally` badge lifecycle is governed by the state machine defined in the Representing resolved conflicts section.
This state is tied to the file's presence in the current sidebar workflow, not to whether its tab happens to remain open.

### 3. Summary counts

Section headers should surface unresolved conflict counts when present.

Examples:

- `Changes 5 · 2 conflicts`
- merge summary: `Merge conflicts: 2 unresolved`

This should remain terse. The row badge carries the detailed meaning.

### 4. Row actions

Conflict-aware row actions:

- unresolved in `Changes`: open editor, no discard shortcut, no stage shortcut
- resolved locally in `Changes`: open editor, stage is allowed, discard is hidden in v1 (discarding a just-resolved conflict file can silently re-create the conflict or lose the resolution — v1 does not have the UX to explain this clearly, so hiding it is the safe default)
- resolved locally in `Staged Changes`: open editor, unstage is allowed

Reasoning:

- unresolved conflicts are higher risk than normal edits
- a one-click discard on an unresolved conflict is too easy to misfire
- a one-click stage on an unresolved conflict can immediately erase the sidebar conflict signal because Git stops reporting the `u` record after `git add`
- users should resolve conflicts in the editor first, then stage from a state that still preserves continuity that this file just came out of conflict resolution

### 5. Diff/editor entry point

Opening a conflicted file should preserve the current navigation flow, but v1 must not assume the existing two-way diff backend can render unresolved conflicts correctly.

For unresolved conflicts, the safe requirement is:

- clicking the row opens the existing file entry point for the file
- the header reflects the conflict badge and subtype when that metadata exists
- unresolved conflicts must not be routed into a misleading two-way diff view
- if the app cannot render a merge-aware view in v1, open the editable file view with conflict metadata instead of the normal diff view
- any fallback state must be explicit and explain that merge-aware diff rendering is not available yet
- the opened view should include action-oriented guidance for the current conflict subtype rather than only Git terminology

Do not claim VS Code style merge presentation in v1 unless the diff backend is updated to read conflict stages explicitly.
This applies to every entry point, including section-level `Open all diffs`.

Required routing rule for v1:

- if the `GitStatusEntry` for the row has `conflictStatus === 'unresolved'`, never call the normal uncommitted diff opener for that row
- instead, route to a conflict-safe entry point that opens either:
  - the editable working-tree file view, when a working-tree file exists
  - a conflict details panel or read-only placeholder view, when no working-tree file exists

Required bulk-review behavior for v1:

- the product must not present a bulk action that appears to review every file while silently excluding unresolved conflicts
- if a section-level `Open all diffs` action remains, its label or adjacent copy must make the scope explicit when unresolved conflicts are present
- preferred v1 behavior:
  - keep `Open all diffs` for normal change review
  - add `Review conflicts` from the merge summary when unresolved conflicts exist
  - if both actions are shown together, the UI must explain the split clearly
- acceptable fallback behavior:
  - `Open all diffs` opens normal diffs only
  - unresolved conflicts are excluded from the combined diff set
  - the trigger and resulting view both state that conflicted files are reviewed separately
- if rows are excluded, the combined-diff tab state must carry an explicit `skippedConflicts` payload so the notice is deterministic and does not depend on reconstructing the skipped set later from live status alone
- if every candidate row for a given combined-diff open is excluded, the tab must render a conflict-specific state rather than a generic `No changes to display`
- that excluded-only state must list the conflicted paths and provide a direct `Review conflicts` action

Definition of `Review conflicts` in this context:

- if invoked from the merge summary, open the unresolved-conflict review tab for the full live unresolved set
- if invoked from an excluded-only combined-diff state, open the unresolved-conflict review tab preloaded with that tab's stored skipped-conflict snapshot
- the action must never route unresolved conflicts into the ordinary two-way diff viewer

This requirement is intentionally strict because the current diff pipeline reads normal index and worktree content, not merge stages, and because bulk actions must not undermine user trust in the review queue.

Examples:

- `app.tsx · Unresolved conflict · Both modified`

This keeps the sidebar and editor consistent.

### 6. Conflict kinds without a working-tree file

Not every unresolved conflict can be opened as a normal editable file.

Examples:

- `both_deleted`
- some `deleted_by_us` / `deleted_by_them` states, depending on which side leaves a working-tree file behind

For these cases, v1 must not attempt to open the normal editable file view and then show a generic file-read error.

Instead, the entry point should show an explicit conflict state such as:

- `This file is in an unresolved merge conflict. No working-tree file is available to edit.`
- subtype text such as `Both deleted`
- guidance to resolve via Git or restore one side before editing
- action-oriented next step when possible, such as `Restore one side, then reopen this file`

This can be a lightweight placeholder screen in the editor area.
The important requirement is that the state is conflict-aware and not presented as a broken file open.

Required state shape for v1:

- opening a non-editable unresolved conflict must not reuse plain `mode: 'edit'`
- the opened tab state must distinguish `conflict-placeholder` from ordinary editable files and ordinary diffs
- the placeholder state must carry at least:
  - `path`
  - `conflictStatus`
  - `conflictKind`
  - `message`
  - optional `guidance`

## Proposed Data Model

Extend `GitUncommittedEntry` (the base type behind `GitStatusEntry`) with conflict metadata, and extend `OpenFile` (the editor tab state in `src/renderer/src/store/slices/editor.ts`) with conflict-aware metadata instead of relying on sidebar rows as the only source of truth.

```ts
export type GitConflictKind =
  | 'both_modified'
  | 'both_added'
  | 'both_deleted'
  | 'added_by_us'
  | 'added_by_them'
  | 'deleted_by_us'
  | 'deleted_by_them'

export type GitConflictResolutionStatus = 'unresolved' | 'resolved_locally'

export type GitConflictStatusSource = 'git' | 'session'

// Extend GitUncommittedEntry (src/shared/types.ts)
// Currently: { path, status, area, oldPath? }
// GitStatusEntry is an alias for GitUncommittedEntry; extending the base extends both.
// Note: conflictHint is NOT included here. The main process returns only
// Git-derived data. Hint text is derived in the renderer from conflictKind
// using a CONFLICT_HINT_MAP lookup (see Renderer hint derivation below).
//
// conflictStatusSource is NOT set by the main process. The main process
// returns only conflictKind and conflictStatus (always 'unresolved') for
// live u records. The renderer sets conflictStatusSource: 'git' when
// populating from IPC data, and 'session' when applying Resolved locally
// state from trackedConflictPaths. This keeps the main process free of
// session-awareness while letting the renderer distinguish the two sources.
export type GitUncommittedEntry = {
  path: string
  status: GitFileStatus
  area: GitStagingArea
  oldPath?: string
  conflictKind?: GitConflictKind
  conflictStatus?: GitConflictResolutionStatus
  conflictStatusSource?: GitConflictStatusSource
}

// Active operation detected by the main process alongside status polling.
// Used by the renderer to label the merge summary correctly.
export type GitConflictOperation = 'merge' | 'rebase' | 'cherry-pick' | 'unknown'

// Renderer hint derivation:
// The renderer maps conflictKind to a user-facing hint string using a
// CONFLICT_HINT_MAP constant (e.g., both_modified -> 'Open and edit the
// final contents'). This keeps UI copy out of the main process parser.

export type OpenConflictMetadata = {
  conflictKind: GitConflictKind
  conflictStatus: GitConflictResolutionStatus
  conflictStatusSource: GitConflictStatusSource
}

export type OpenConflictPlaceholder = OpenConflictMetadata & {
  kind: 'conflict-placeholder'
  message: string
  guidance?: string
}

export type OpenConflictEditable = OpenConflictMetadata & {
  kind: 'conflict-editable'
}

export type ConflictReviewState = {
  kind: 'conflict-review'
  source: 'live-summary' | 'combined-diff-exclusion'
  /** Timestamp (ms since epoch) when the snapshot was taken. The renderer
   *  derives the display label at render time (e.g., '3 unresolved conflicts
   *  at 2:34 PM') from snapshotTimestamp + entries.length, keeping UI copy
   *  out of stored state — consistent with the CONFLICT_HINT_MAP approach. */
  snapshotTimestamp: number
  entries: ConflictReviewEntry[]
}

export type CombinedDiffSkippedConflict = {
  path: string
  conflictKind: GitConflictKind
}

export type ConflictSummaryState = {
  unresolvedCount: number
  paths: string[]
}

export type ConflictReviewEntry = {
  path: string
  conflictKind: GitConflictKind
}

// Extend OpenFile (src/renderer/src/store/slices/editor.ts)
// Current shape:
//   { id, filePath, relativePath, worktreeId, language, isDirty,
//     mode: 'edit' | 'diff', diffSource?, branchCompare?,
//     branchOldPath?, combinedAlternate?, combinedAreaFilter?, isPreview? }
//
// OpenFile uses a discriminated union on `mode` so that conflict-review tabs
// do not require a filePath (they are list views, not file views).
// Normal file tabs ('edit' | 'diff') keep filePath required.
// Add:

type OpenFileBase = {
  id: string
  worktreeId: string
  isPreview?: boolean
}

type OpenFileTab = OpenFileBase & {
  mode: 'edit' | 'diff'
  filePath: string
  relativePath: string
  language: string
  isDirty: boolean
  diffSource?: DiffSource
  branchCompare?: BranchCompareSnapshot
  branchOldPath?: string
  combinedAlternate?: CombinedDiffAlternate
  combinedAreaFilter?: string
  // conflict fields for single-file tabs
  conflict?: OpenConflictEditable | OpenConflictPlaceholder
  skippedConflicts?: CombinedDiffSkippedConflict[]
}

type OpenConflictReviewTab = OpenFileBase & {
  mode: 'conflict-review'
  /** id for conflict-review tabs uses a deterministic scheme:
   *  `conflict-review-${worktreeId}` — at most one conflict-review tab
   *  per worktree. Opening a new review replaces the existing one. */
  conflictReview: ConflictReviewState
}

export type OpenFile = OpenFileTab | OpenConflictReviewTab
```

Notes:

- `conflictKind` describes the merge shape
- `conflictStatus` describes whether the UI is showing a live unresolved state or a session-local resolved state
- `conflictStatusSource` distinguishes live Git truth from session-local continuity state
- action-oriented hint text (e.g., `Open and edit the final contents` for `both_modified`) is derived at render time from `conflictKind` via the renderer-side `CONFLICT_HINT_MAP` constant — it is not a field on `GitUncommittedEntry` and is never returned by the main process
- treat a row as conflicted when `conflictStatus` is present
- the `status` value on unresolved conflicts is a rendering compatibility choice for existing icon/color plumbing, not a semantic claim — the conflict badge carries the real semantics
- opened editor tabs are a separate state domain from live git-status rows and need their own conflict metadata
- `Review conflicts` is also an editor-tab state, but it is not a diff tab and should not be forced into `mode: 'diff'`
- v1 therefore needs an explicit editor-tab representation for conflict review rather than overloading combined-diff state

Compatibility rule for non-upgraded consumers:

- any consumer of `GitStatusEntry` that has not been upgraded to read `conflictStatus` may still render `modified` styling, but must not offer file-existence-dependent affordances (diff loading, drag payloads, editable-file opening) for unresolved conflicts
- this affects file explorer decorations, tab badges, and any other surface outside `Source Control`
- any consumer of `OpenFile` that accesses `filePath` must narrow on `mode` first, because `OpenConflictReviewTab` does not carry `filePath` — code that assumes `openFile.filePath` exists without checking `mode` will break at compile time once the discriminated union is in place

Known limitation:

- passive file explorer and tab badge surfaces may show `modified` styling for unresolved conflicts in v1

Explicit v1 scope decision:

- required to upgrade in v1: `Source Control`, editor tab state, single-file conflict opening, section-level bulk actions, and any shared open-file helper they depend on
- allowed to defer in v1: passive decorations in file explorer and tab-strip visuals
- not allowed to defer in v1: any entry point that can directly open an unresolved-conflict file into the ordinary diff or ordinary editable path without the conflict-aware routing rules
- not allowed to defer in v1: the dedicated editor-tab state and open action for `Review conflicts`

## Git Parsing Plan

### Source of truth

Use `git status --porcelain=v2 --untracked-files=all` as the primary source, but start parsing `u` records in addition to `1`, `2`, and `?`.

Today [status.ts](../src/main/git/status.ts) ignores unmerged records entirely.

### Performance

Parsing `u` records adds no meaningful overhead — they use the same line-by-line parsing loop as `1`/`2`/`?` records, and the number of unmerged entries during a typical merge is small (usually single digits). The filesystem existence check for ambiguous conflict kinds (`deleted_by_us`, `deleted_by_them`, etc.) adds one `fs.existsSync` call per ambiguous entry, which is negligible within the 3-second polling interval.

If the filesystem existence check throws (permissions error, unmounted path, etc.), default to `status: 'modified'`. This is the safer fallback because it avoids suppressing the conflict row from the sidebar and avoids presenting a `deleted` status that could mislead the user into thinking the file is gone when the check simply failed. The conflict badge and subtype still carry the real semantics regardless of the `status` fallback.

### Mapping unmerged records

Porcelain v2 unmerged `XY` states should map like this:

- `UU` -> `both_modified`
- `AA` -> `both_added`
- `DD` -> `both_deleted`
- `AU` -> `added_by_us`
- `UA` -> `added_by_them`
- `DU` -> `deleted_by_us`
- `UD` -> `deleted_by_them`

V1 should also map every unresolved `u` record to:

- `area: 'unstaged'`
- `status`: determined by whether a working-tree file exists for the conflict kind:
  - `'modified'` for kinds that always leave a working-tree file: `both_modified`, `both_added`
  - `'deleted'` for kinds that never leave a working-tree file: `both_deleted`
  - for `deleted_by_us`, `deleted_by_them`, `added_by_us`, `added_by_them`: check whether the working-tree file exists at parse time and use `'modified'` if it does, `'deleted'` if it does not (for `added_by_us`/`added_by_them`, Git typically does leave a working-tree file, so the check is defensive — the primary ambiguity is in `deleted_by_*` variants where the merge strategy determines whether the surviving side's content is written to the worktree)

Why:

- the current sidebar, tab decorations, and file explorer already expect a `GitFileStatus`
- `modified` is the least misleading compatibility fallback for conflicts where a working-tree file exists
- `deleted` is a better fallback when no working-tree file exists because calling it `modified` would be contradictory
- `deleted_by_us` / `deleted_by_them` and the `added_by_*` variants do not have a guaranteed working-tree file — Git's behavior depends on the merge strategy and the specific conflict — so the parser must check the filesystem rather than hardcoding an assumption
- the conflict badge/subtype still carries the real semantics in all cases
- v1 should not invent new single-letter codes for unmerged rows without a broader status-system redesign

### Representing unresolved conflicts in the existing sections

Unresolved conflicts should be emitted as `area: 'unstaged'` entries with:

- `status`: determined by working-tree file existence (see Mapping unmerged records above)
- `conflictStatus: 'unresolved'`
- `conflictKind: ...`

Why:

- the user still needs to act in the working tree
- this keeps the existing panel layout intact
- it matches the mental model of “this is still pending”

Ordering requirement:

- conflicted entries sort before ordinary entries within `Changes`
- `Staged Changes` has no conflict rows in v1 because unresolved `u` records are emitted only into `unstaged`

### Representing resolved conflicts

In v1, live Git status must stop representing a file as conflicted after Git stops reporting a `u` record.
However, the UI may carry forward a temporary `Resolved locally` state for files the user opened from a live unresolved conflict in the current session.

Why:

- `git status --porcelain=v2` no longer marks the file as unmerged after resolution is staged
- users still need continuity that the file they were just resolving is now in the review-or-stage step of the same workflow
- limiting this to files the user explicitly opened in the current session keeps the scope auditable and avoids broad historical inference

Corollary:

- unresolved rows must not expose a `Stage` shortcut, because that shortcut can remove the only live conflict signal before the user has actually completed review of the file
- `Resolved locally` rows may expose normal safe actions again because the user is now in the post-resolution workflow stage

### `Resolved locally` state machine

#### Store location

`trackedConflictPaths` is a `Map<string, Set<string>>` keyed by `worktreeId`, stored in the renderer-side Zustand git store (the same store that holds `gitStatus`). It is not component-local state — it must survive across re-renders of `SourceControl` and be accessible to both the click handler that adds paths and the polling hook that checks for `u`-record disappearance. Keying by worktree ensures paths are scoped correctly when the app has multiple worktrees open.

The map is populated by the `Source Control` click handler and read by the status-polling reconciliation logic. It is never sent to the main process.

#### State transitions

A file enters `Resolved locally` through a precise sequence:

1. **Track**: when the user clicks an unresolved conflict row in `Source Control` to open or focus a tab, record that path in the `trackedConflictPaths` set. Opening the same file from the file explorer, terminal, or any non-conflict-row entry point does **not** add it to this set.
2. **Transition**: on the next `git status` poll, if a path in `trackedConflictPaths` no longer has a `u` record, mark that path as `Resolved locally` with `conflictStatusSource: 'session'`.
3. **Re-enter**: if a path currently in `Resolved locally` state reappears as a `u` record (e.g., the user ran `git checkout -m <file>` to re-create the conflict), replace the session-local resolved state with live Git conflict state (`conflictStatus: 'unresolved'`, `conflictStatusSource: 'git'`). The path remains in `trackedConflictPaths` so it can transition back to `Resolved locally` if the `u` record disappears again.
4. **Expire**: clear the `Resolved locally` state when any of these happens:
   - the file leaves the sidebar entirely (no staged or unstaged entry)
   - the app session resets (window reload, app restart)
   - the file re-enters a live unresolved `u` state, which replaces the local resolved state with live Git conflict state again
5. **Abort**: when the merge/rebase/cherry-pick operation is aborted (`git merge --abort`, `git rebase --abort`, `git cherry-pick --abort`), all `u` records disappear simultaneously and the operation HEAD file (`.git/MERGE_HEAD`, etc.) is cleaned up. On the next poll, if the detected operation changes to `'unknown'` (no HEAD file found) and the unresolved count drops to zero in the same poll cycle, clear the entire `trackedConflictPaths` set for that worktree rather than transitioning each path to `Resolved locally`. Abort is not resolution — showing `Resolved locally` on every previously-conflicted file after an abort would be misleading.

If a file's `u` record disappears but the path was never in `trackedConflictPaths`, the file simply reverts to its ordinary `GitFileStatus` with no `Resolved locally` badge.

Important consequence:

- closing a tab does not clear `Resolved locally` by itself
- if a file is still present in `Changes` or `Staged Changes`, the continuity badge should remain visible until the file leaves the sidebar, the session resets, or the file becomes live-unresolved again

Guardrails for `Resolved locally`:

- only show it when the path is in `trackedConflictPaths` and the `u` record has disappeared
- label it as local/session-derived, not as live Git conflict output
- never recreate it from polling history alone for files the user did not actively open from a conflict row

## IPC Boundary

Git status parsing runs in the main process (`src/main/git/status.ts`). The renderer receives status data via the `git:status` IPC channel (`src/main/ipc/filesystem.ts`), which returns `GitStatusEntry[]` directly. The polling hook (`src/renderer/src/components/right-sidebar/useGitStatusPolling.ts`) stores the result in the Zustand store without field filtering.

Electron's structured clone serialization preserves all enumerable properties on returned objects. Adding new optional fields to `GitUncommittedEntry` (and therefore `GitStatusEntry`) requires no IPC layer changes -- the new fields will serialize and deserialize automatically.

Session-local state (`Resolved locally` tracking) lives entirely in the renderer and does not cross the IPC boundary. The main process returns only what `git status` reports.

The main process should also return the detected `GitConflictOperation` alongside `GitStatusEntry[]` so the renderer can label the merge summary correctly. This can be added to the existing `git:status` IPC response shape as an optional field.

Required renderer-store change:

- `setGitStatus` must treat conflict metadata changes as meaningful updates
- equality checks that compare only `path`, `status`, and `area` are insufficient for this design
- at minimum, renderer cache invalidation must also react to `conflictStatus`, `conflictKind`, and `conflictStatusSource`
- otherwise a row can remain visually stale when conflict state changes without changing its base `GitFileStatus`

## Sorting

Within each section, sort by:

1. unresolved conflicts
2. resolved locally
3. normal file changes
4. path name

This mirrors the urgency ordering used by editor UIs.

## Visual Spec

### Icons

Keep the existing file-type/status icon, but add a conflict badge rather than replacing the file icon.

Reason:

- users still need file identity and normal file-type affordances
- unresolved conflict is more important than ordinary status letters when the two signals compete
- the UI should prefer the conflict badge over a potentially misleading ordinary status letter

### Badge styles

- `Unresolved`: red background, red text emphasis
- `Resolved locally`: success or accent styling with a tooltip that says the state came from this app session, not from current Git conflict output

### Secondary text

Show conflict subtype in a small muted label:

- `Both modified`
- `Deleted by them`

This is more useful than raw `UU` / `UD` codes.

When space allows, add helper text focused on the next decision rather than only the Git term.

## Interaction Details

### Hover

On hover, keep existing stage/unstage actions where they are safe, but do not hide conflict badges.

For unresolved conflicts in `Changes`:

- hide `Discard`
- hide `Stage`

For `Resolved locally` rows:

- restore safe actions appropriate to the row's current section
- keep the badge visible until the session-local continuity state expires

### Click

Clicking a conflicted row follows the routing rules defined in section 5 (Diff/editor entry point). Key constraints:

- do not reuse `openDiff(...)` unchanged for unresolved conflict rows — use the conflict-aware open path
- the opened tab must carry `conflictStatus` and `conflictKind` so the header can render them without re-querying sidebar state
- use the same tab identity as ordinary editable tabs; attach `conflict.kind: 'conflict-editable'` metadata rather than inventing a second tab namespace
- if no working-tree file exists, open a conflict-placeholder tab instead of an ordinary file tab
- `Review conflicts` uses a separate editor-tab mode and open action; it is launched from `Source Control`, not from `Checks`

Tab reconciliation on status refresh:

- editable tabs: downgrade conflict metadata in place (same tab id, no duplicate)
- placeholder tabs: close or convert deterministically when the path is no longer unresolved
- conflict-review tabs: preserve their stored snapshot unless the user explicitly refreshes or reopens from the current merge summary
- tab closure alone must not clear sidebar `Resolved locally` state while the file still appears in `Changes` or `Staged Changes`

### Section actions

Section-level actions follow the bulk-review rules defined in section 5 (Required bulk-review behavior for v1). The key invariant: do not leave a hidden unsafe path where single-row clicks are safe but bulk-open actions are not.

### Empty state

If all remaining files are conflicted, do not show `No changes detected`. The normal section rendering already covers this once conflicts are included in status parsing.

## Edge Cases

### Rename plus conflict

Do not solve this specially in v1. Prefer showing the destination path and conflict badge.

Important constraint:

- porcelain v2 `u` records do not provide rename-origin metadata like `2` records do
- assume `oldPath` is unavailable for unresolved conflicts unless a separate Git query is added later
- v1 should not promise rename ancestry in conflict rows

### Submodule conflicts

Porcelain v2 also emits `u` records for submodule conflicts. Submodule conflicts are out of scope for v1. The parser should skip `u` records where any of the `h1`/`h2`/`h3` mode fields indicates a submodule (mode `160000`) and leave them unhandled rather than presenting them with the same UX as normal file conflicts.

### Binary conflicts

Use the same row badge model even if the diff viewer cannot render a normal text diff.

## Implementation Plan

### Phase 1a: Parsing and types

- extend shared types with conflict metadata and `GitConflictOperation`
- parse porcelain v2 `u` entries in [status.ts](../src/main/git/status.ts), including filesystem existence checks for ambiguous conflict kinds (with `'modified'` fallback on fs errors)
- detect active operation via `.git/MERGE_HEAD`, `.git/REBASE_HEAD`, `.git/CHERRY_PICK_HEAD` and return `GitConflictOperation` alongside status entries
- add renderer-side `CONFLICT_HINT_MAP` constant that maps `GitConflictKind` to user-facing hint strings
- update store equality checks so conflict metadata changes trigger UI updates
- add tests for parsing each porcelain v2 unmerged `XY` variant (`UU`, `UD`, `DU`, `AA`, `AU`, `UA`, `DD`) into the expected `conflictKind`
- add tests for filesystem existence check fallback behavior on error

### Phase 1b: Sidebar UI

- render conflict badges and subtype text in [SourceControl.tsx](../src/renderer/src/components/right-sidebar/SourceControl.tsx)
- add merge-summary state derived from live unresolved entries, with operation-aware label and the concrete `Review conflicts` list-view entry point defined above
- add conflict helper text and action-oriented next-step messaging using renderer-side `CONFLICT_HINT_MAP`
- suppress `Discard` and `Stage` for unresolved conflicts; suppress `Discard` for `Resolved locally` rows
- add `trackedConflictPaths` set to the renderer Zustand git store
- add accessibility attributes: `role="status"` on badges, `aria-live="polite"` on merge summary count
- sort conflicted rows to the top of their section
- add UI tests for badge rendering, ordering, merge summary, and suppressed actions

### Phase 1c: Editor and tab integration

- extend opened editor tab state with optional conflict metadata
- add a dedicated `openConflictReview(...)` store action that opens the lightweight review tab from `Source Control`
- add a dedicated conflict-aware open action for unresolved rows instead of routing them through `openDiff(...)`
- add a dedicated conflict-placeholder tab for unresolved conflicts without a working-tree file
- add reconciliation logic that downgrades or clears conflict metadata on already-open tabs when live status changes
- render `Resolved locally` only for files tracked via the state machine (see `Resolved locally` state machine section)
- add session-local continuity cleanup so `Resolved locally` expires deterministically based on sidebar presence, not tab closure
- add the lightweight conflict-review tab used by the merge summary and excluded-only bulk-review states

### Phase 1d: Bulk actions and guardrails

- make section-level `Open all diffs` explicit about its scope, backed by stored `skippedConflicts` tab state
- add the dedicated conflict-review handoff state for bulk actions where every candidate row was excluded
- ensure any open-capable consumer that assumes file existence branches on `conflictStatus`
- leave passive explorer/tab decorations as plain `modified` in v1 unless separately upgraded, but do not allow unsafe open routing from those surfaces
- add tests that bulk-open paths do not route unresolved conflicts into the normal two-way diff viewer

### Phase 2

- decide whether to build a merge-aware diff view based on index stages
- decide whether to expand the v1 lightweight `Review conflicts` list into a fuller multi-file conflict queue or merge-aware review surface
- consider a dedicated conflict filter if repos with many changes become noisy

Explicitly out of scope until a stronger design exists:

- session-based reconstruction for files the user never opened from a live unresolved conflict
- broad resolved-state reconstruction for files the user never opened from a live unresolved conflict

## Test Cases

### Parsing

- each porcelain v2 unmerged `XY` variant (`UU`, `AA`, `DD`, `AU`, `UA`, `DU`, `UD`) maps to the expected `conflictKind`
- unresolved conflict rows are emitted as `area: 'unstaged'` with `conflictStatus: 'unresolved'`
- `status` is `'modified'` when a working-tree file exists, `'deleted'` when it does not (including `both_deleted` and ambiguous `deleted_by_*` / `added_by_*` cases)

### Sidebar rendering

- unresolved `both modified` file appears in `Changes` with `Unresolved` badge and subtype
- unresolved `deleted by them` file appears in `Changes` with correct subtype
- merge summary shows unresolved count and a `Review conflicts` action when conflicts are present
- unresolved conflicts do not show the `Stage` or `Discard` actions
- conflict rows sort above normal modified files; `Resolved locally` rows sort between unresolved and ordinary rows
- changing only conflict metadata still triggers a re-render of the affected row

### Editor / tab integration

- clicking an unresolved conflict row opens the conflict-aware editable-file path, not the normal unstaged diff path
- the editor header repeats the unresolved badge and subtype for a conflicted file tab
- opening a `both deleted` conflict (or any conflict without a working-tree file) creates a conflict-placeholder tab, not a generic file-load failure
- placeholder and editable conflict tabs show action-oriented next-step guidance
- clicking `Review conflicts` from `Source Control` opens a dedicated conflict-review editor tab, not a `Checks` surface and not a right-sidebar top-level tab
- the conflict-review tab renders from stored snapshot entries rather than reconstructing its contents from live status on every paint

### Tab reconciliation

- an already-open conflicted tab downgrades to `Resolved locally` after the `u` record disappears on the next status poll
- downgrading preserves the same tab identity — no duplicate tab is created
- a stale conflict-placeholder tab is closed or converted deterministically once the path is no longer unresolved
- closing a tab does not clear `Resolved locally` while the file still appears in the sidebar

### Bulk actions

- `Open all diffs` does not send unresolved conflicts through the normal two-way diff viewer
- the exclusion of unresolved conflicts is explicit in both the trigger label and the resulting view
- the skipped-conflicts notice is stable for the lifetime of the combined-diff tab (sourced from stored `skippedConflicts`, not live status)
- when every candidate row is skipped, the dedicated conflict-review handoff state is shown instead of a generic empty state

### Resolved locally lifecycle

- `Resolved locally` appears only for files the user opened from an unresolved conflict row in the current session
- `Resolved locally` clears when the file leaves the sidebar, the session resets, or the file becomes live-unresolved again
- a file in `Resolved locally` state that reappears as a `u` record reverts to `Unresolved` with `conflictStatusSource: 'git'`
- after re-entering unresolved state, the file can transition back to `Resolved locally` if the `u` record disappears again (path remains in `trackedConflictPaths`)
- files that were never opened from a conflict row do not get `Resolved locally` after their `u` record disappears
- a file resolved externally (e.g., `git add` in terminal) drops the `Unresolved` badge on the next poll and reverts to ordinary `GitFileStatus` without showing `Resolved locally`, because the file was never opened from a conflict row
- aborting the operation (`git merge --abort`) clears the entire `trackedConflictPaths` set — no files show `Resolved locally` after an abort

### Merge summary

- merge summary label reflects the active operation (`Merge conflicts`, `Rebase conflicts`, `Cherry-pick conflicts`, or `Conflicts` as fallback)
- conflict-review tab empty state shows "all conflicts resolved" with dismiss action when snapshot entries are all resolved

### Accessibility

- conflict badges use `role="status"` and include `aria-label` text (e.g., "Unresolved conflict, both modified") so screen readers announce conflict state without requiring visual inspection
- the merge summary unresolved count is a live region (`aria-live="polite"`) so count changes are announced
- focus management (stretch goal for Phase 1b — implement badge and live-region accessibility first): `Review conflicts` moves focus to the opened conflict-review tab; closing the review tab returns focus to the merge summary action

### Regression

- normal non-conflict rows keep current behavior

## Recommendation

Implement the v1 design by enriching the existing row model and adding a compact merge summary above the existing sections.

That gives the app the quick scan value users need for active merge conflicts while preserving the current right-sidebar layout, avoiding unsafe fake diff behavior, and keeping the workflow legible after a file leaves the live `u` state.
