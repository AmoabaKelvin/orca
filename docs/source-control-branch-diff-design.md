# Source Control Branch Diff Design

## Problem

The current Source Control view only reflects `git status` data:

- staged changes
- unstaged changes
- untracked files

When a branch has committed changes relative to its base branch, but no uncommitted changes, the UI incorrectly appears empty and shows "No changes detected."

This is misleading. Users need to understand both:

1. what is currently uncommitted in the worktree
2. what has changed on this branch relative to the repo base ref

## Goals

- Show all files changed on the current branch, not just uncommitted files.
- Preserve fast local-edit workflows for staging, unstaging, and discarding.
- Make the active compare target explicit.
- Keep File Explorer decorations legible and low-noise.
- Avoid conflating "working tree state" with "branch compare state."
- Ship in one implementation pass without requiring a follow-up architecture rewrite.

## Non-Goals

- Reproducing the full GitHub compare page inside the sidebar
- Replacing the existing PR or Checks surfaces
- Adding dense per-commit browsing in the initial version
- Changing File Explorer to decorate every branch-diff file

## Core Model

The UI should treat these as separate data sources.

### 1. Uncommitted Changes

Derived from local SCM state, equivalent to `git status`.

Includes:

- staged
- unstaged
- untracked
- conflicts if later added

This answers: "What have I changed locally that is not fully committed yet?"

### 2. Branch Changes

Derived from branch-vs-base comparison, equivalent to `git diff <baseRef>...HEAD`.

Includes all files changed on the current branch relative to the configured base ref, even when the worktree is clean.

This answers: "What is different on this branch compared with the configured base ref?"

These two models must remain distinct in state, UI labels, badge semantics, and diff behavior.

## Base Ref

Branch compare should use the repo's configured base ref:

- `repo.worktreeBaseRef` when set
- otherwise the detected default base ref, typically `origin/main` or `origin/master`

The active base ref must be visible in the Source Control UI so the compare scope is never ambiguous.

### Base Ref Validation

Before running any branch compare query, the app must verify that `<baseRef>` resolves in the current repo.

If the configured or detected base ref does not resolve:

- do not treat that as "no branch changes"
- keep uncommitted changes fully functional
- show the branch compare surface in an unavailable state
- surface a clear recovery action to change the base ref

Recommended copy:

- heading: `Branch compare unavailable`
- supporting text: `Base ref <baseRef> could not be resolved in this repository.`
- actions: `Change Base Ref`, `Retry`

This is required because default-base fallback may produce a syntactically valid ref name that does not actually exist locally.

## Source Control Layout

This design applies inside the existing right sidebar tab named `Source Control`.

It does not introduce new top-level sidebar tabs.

The existing top-level app navigation remains:

- `Explorer`
- `Search`
- `Source Control`
- `Checks`

Within the `Source Control` panel, add a scope selector:

- `All`
- `Uncommitted`
- `Branch`

Default selection: `All`

Rationale:

- `All` best matches user intent when opening Source Control on a branch
- it prevents the false-empty case when committed branch changes exist
- it preserves the current Source Control entry point instead of inventing a parallel navigation model

## Compare Summary Bar

At the top of the `Source Control` panel, show a compact compare summary when branch compare data is available:

- `base: origin/main`
- `compare: <current branch>`
- `<n> files changed`
- `<m> commits ahead` when available
- PR pill if PR metadata is already available for the branch

This should be visible in `All` and `Branch` modes.

When branch compare is unavailable because the base ref is invalid, replace the normal summary with the unavailable state described above.

### Ahead / Behind Semantics

Phase 1 branch compare is primarily an "ahead of base" view derived from `git diff <baseRef>...HEAD`.

That means:

- changed-file results represent changes reachable from `HEAD` since the merge base
- `commits ahead` is the required branch-topology metric in v1
- `behind` or `diverged` indicators are optional in v1 and must not block landing

Because of this, the UI must not claim the branch "matches `<baseRef>`" unless the implementation has explicitly computed that stronger condition.

## Changes View Behavior

### All

Show two top-level sections:

- `Uncommitted`
- `Committed on Branch`

`Uncommitted` contains:

- `Staged Changes`
- `Changes`
- `Untracked Files`

`Committed on Branch` contains:

- all files changed in `baseRef...HEAD`

Ordering:

1. Uncommitted section first
2. Committed on Branch second

Rationale:

- local in-progress work is usually more actionable
- branch-level history remains visible even when local state is clean

### Uncommitted

Show only working tree/index state.

Keep existing actions:

- stage
- unstage
- discard

### Branch

Show only `baseRef...HEAD` changed files.

Actions are compare-oriented, not working-tree-oriented:

- open file diff against base
- open combined branch diff
- change base ref
- retry branch compare when unavailable

Do not show stage, unstage, or discard actions in `Branch`.

## Empty State Rules

Do not show "No changes detected" unless both conditions are true:

- there are no uncommitted changes
- branch compare is available and there are no branch changes relative to base

### Empty State Copy

If no uncommitted changes exist but branch changes do exist:

- heading: `No uncommitted changes`
- supporting text: `<n> files changed on this branch since <baseRef>`

If neither kind of change exists:

- heading: `No changes on this branch`
- supporting text: `This worktree is clean and this branch has no changes ahead of <baseRef>`

If branch compare is unavailable:

- keep the uncommitted section visible if it has entries
- do not collapse the whole panel to a generic empty state

## Diff Semantics

The doc must define exact left and right sides so the same path can appear in multiple sections without ambiguity.

### Unstaged Diff

Used when opening an entry from `Changes`.

- left: index if present, otherwise `HEAD`
- right: working tree

Required v1 behavior:

- do not reuse a `HEAD -> working tree` diff for unstaged entries when an index version exists
- if a file has staged and unstaged changes, the `Changes` entry must show only the unstaged delta
- implement this with an explicit `index -> working tree` loader path in main-process git code

### Staged Diff

Used when opening an entry from `Staged Changes`.

- left: `HEAD`
- right: index

### Branch Diff

Used when opening an entry from `Committed on Branch` or `Branch`.

- left: merge-base of `<baseRef>` and `HEAD`
- right: `HEAD`

This is the per-file interpretation of `git diff <baseRef>...HEAD`.

Branch diff must load content from the resolved compare snapshot, not from symbolic refs at render time.

Required v1 behavior:

- branch diff content queries use the resolved `mergeBase` oid and `headOid` captured in `GitBranchCompareSummary`
- do not re-resolve `HEAD` while loading a branch diff tab
- if `HEAD` moves later, an existing branch diff tab may remain open, but its identity and content must continue to reflect the snapshot it was opened from until the user refreshes or reopens against the newer snapshot

#### Branch Diff File Resolution

Branch diff cannot reuse the working-tree diff loader as-is.

For branch compare entries:

- `modified` / `added`: read left content from the merge-base tree and right content from the resolved `headOid` tree
- `deleted`: read left content from the merge-base tree and use empty content on the right
- `renamed`: read left content from `oldPath` in the merge-base tree and right content from `path` in the resolved `headOid` tree
- `copied`: read left content from `oldPath` in the merge-base tree and right content from `path` in the resolved `headOid` tree

If a file also has local uncommitted edits, branch diff must still render the committed branch comparison only. It must not silently substitute working-tree content on the right side.

### Combined Uncommitted Diff

Used by `View All Changes` in `Uncommitted`.

- includes staged and unstaged entries
- may continue to omit untracked files in v1 if the existing combined diff viewer does so

### Combined Branch Diff

Used by `View All Changes` in `Branch`.

- includes files from `git diff --name-status <baseRef>...HEAD`
- each section uses branch diff semantics
- is read-only in v1

### Combined All Diff

Used by `View All Changes` in `All`.

v1 behavior:

- if uncommitted entries exist, open the combined uncommitted diff by default
- if no uncommitted entries exist and branch compare is available, open the combined branch diff by default
- provide a visible secondary action to switch to the other combined diff when both data sets are available

This is intentionally the v1 contract. A true mixed combined view is deferred.

## File Status Semantics

The same status letters should not mean different things in different parts of the app without a label.

### Uncommitted Statuses

These keep the existing meanings:

- `M` modified
- `A` added
- `D` deleted
- `R` renamed
- `?` untracked

These are working tree or index states.

### Branch Statuses

These represent compare-to-base states, not local edit state.

They may reuse the same letters in the Source Control branch section if clearly labeled under `Committed on Branch` or `Branch`, because the section title provides the necessary context.

They must not silently replace Explorer decorations.

## Precedence Rules

When a file appears in both uncommitted and branch-compare results:

- in Source Control `All`, show it in both relevant sections
- in Explorer, show only uncommitted decoration by default
- when opened from an uncommitted section, open uncommitted diff semantics
- when opened from a branch section, open branch diff semantics
- when opened from generic file navigation, prefer working tree edit or uncommitted diff over branch diff

Branch and uncommitted diff tabs must have distinct tab identities. Do not key both off only `filePath + staged/unstaged`.

### Tab Identity Requirement

This must be explicit in the implementation contract because the current editor model keys diffs too loosely for this feature.

Minimum tab identity dimensions:

- diff source: `unstaged` | `staged` | `branch` | `combined-uncommitted` | `combined-branch`
- worktree id
- file path
- base ref for branch compare tabs
- compare version for branch compare tabs, derived from the resolved compare snapshot

Examples:

- uncommitted file diff: `<worktreeId>::diff::unstaged::<path>`
- staged file diff: `<worktreeId>::diff::staged::<path>`
- branch file diff: `<worktreeId>::diff::branch::<baseRef>::<compareVersion>::<path>`
- combined uncommitted diff: `<worktreeId>::all-diffs::uncommitted`
- combined branch diff: `<worktreeId>::all-diffs::branch::<baseRef>::<compareVersion>`

Without this, opening the same file from different sections will collide and produce incorrect editor reuse.

`compareVersion` must change whenever the branch compare snapshot changes in a way that affects diff content.

Minimum required inputs:

- `baseRef`
- resolved base oid
- resolved `HEAD` oid
- resolved `mergeBase` oid

This may be implemented either by:

- including `HEAD` and/or `mergeBase` in the tab id directly, or
- invalidating and regenerating all open branch compare tabs whenever a refreshed compare snapshot changes either value

Phase 1 must choose one of these approaches explicitly. Reusing a branch diff tab keyed only by `baseRef` is not correct.

## File Explorer Rules

### Principle

File Explorer should remain conservative and readable.

Per-file Explorer badges should represent local SCM state by default, not all files changed on the branch.

This matches the useful part of VS Code's behavior: Explorer decorations come from SCM resource groups for current working state, not generic branch compare.

### Default Explorer Behavior

Show per-file decorations only for:

- staged
- unstaged
- untracked
- conflicts

Do not show branch-diff-only files with normal `M/A/D/R` Explorer badges when the worktree is clean.

Reason:

- users read Explorer badges as "this file is currently dirty"
- branch compare files are a different concept
- reusing the same badges for both creates ambiguity and noise

### Explorer Branch Awareness

Branch compare may still influence the Explorer only at higher-level summary surfaces:

- Source Control tab header badge
- worktree header pill
- compare summary row inside Source Control

Examples:

- `12 changed`
- `3 commits ahead`
- `Diff vs origin/main`

### Explorer Interaction Design

When the selected file has uncommitted changes:

- primary action should open working tree diff

When the selected file has no uncommitted changes but is changed on the branch:

- primary file-open behavior should remain normal edit open
- context menu may offer `Open Branch Diff`

When the file has both:

- primary action should open working tree diff from Source Control
- secondary action should allow compare vs base

Priority rule:

1. working tree diff
2. staged diff if explicitly selected from staged section
3. branch compare diff when explicitly requested

### Optional Future Setting

If branch compare decorations are added to Explorer later, they should be:

- off by default
- visually distinct from uncommitted badges
- clearly labeled as branch compare state

Do not reuse the exact same badge style as local SCM state.

## Folder Aggregation Rules

Folder styling in Explorer should aggregate uncommitted state only in v1.

Do not turn entire directory trees into "changed" folders just because files differ from base.

If desired, branch-level aggregation can appear in a separate summary surface:

- Source Control section counts
- worktree header pill
- branch compare summary row

## Data Model Recommendation

Keep the state separate.

Recommended types:

```ts
type GitUncommittedEntry = {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'copied'
  area: 'staged' | 'unstaged' | 'untracked'
  oldPath?: string
}

type GitBranchChangeEntry = {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied'
  oldPath?: string
}

type GitBranchCompareSummary = {
  baseRef: string
  baseOid: string
  compareRef: string
  headOid: string
  mergeBase: string
  changedFiles: number
  commitsAhead?: number
  status: 'ready' | 'invalid-base' | 'unborn-head' | 'no-merge-base' | 'loading' | 'error'
  errorMessage?: string
}
```

Recommended store shape:

```ts
gitStatusByWorktree: Record<string, GitUncommittedEntry[]>
gitBranchChangesByWorktree: Record<string, GitBranchChangeEntry[]>
gitBranchCompareSummaryByWorktree: Record<string, GitBranchCompareSummary>
```

Do not overload a single `GitStatusEntry[]` to represent both concepts.

### Async Consistency Requirement

Branch compare refresh is asynchronous and may be triggered repeatedly while the user changes worktrees, changes base refs, or moves `HEAD`.

Phase 1 must prevent stale compare results from overwriting newer ones.

Required implementation contract:

- each branch-compare request carries a request token or snapshot key
- reducer/store writes only apply if the response still matches the latest in-flight request for that worktree
- the snapshot key must include at least `worktreeId` and requested `baseRef`
- if the implementation already knows the triggering `baseOid` and/or `HEAD` oid, include them as well

This is required so a slower response for an old base ref or old branch state cannot replace a newer compare result.

## Git Queries

### Uncommitted

Keep the current status query:

```sh
git status --porcelain=v2 --untracked-files=all
```

### Branch Compare

Recommended query sequence:

1. Resolve `HEAD`

```sh
git rev-parse HEAD
```

2. Resolve and validate base ref

```sh
git rev-parse --verify <baseRef>
```

3. Resolve merge base from the pinned oids

```sh
git merge-base <baseOid> <headOid>
```

4. Load changed files from the pinned snapshot

```sh
git diff --name-status -M -C <mergeBase> <headOid>
```

5. Load ahead count from the pinned snapshot

```sh
git rev-list --count <baseOid>..<headOid>
```

Notes:

- `...` is important because it compares from merge base
- use repo-configured base ref, not a hardcoded branch name
- use `-M -C` so the query can actually produce the rename/copy statuses promised by the data model
- execute git with argv via `execFile` or equivalent, not shell-interpolated strings, because `<baseRef>` is user-configurable input
- store the resolved `baseOid`, `HEAD` oid, and `mergeBase` in the compare summary so UI identity and invalidation can key off the actual compare snapshot
- if step 1 fails because `HEAD` is unborn, branch compare enters the unavailable `unborn-head` state instead of generic error
- if step 2 fails, branch compare enters the unavailable `invalid-base` state instead of pretending there are zero changes
- if step 3 fails because the refs have no merge base, branch compare enters the unavailable `no-merge-base` state instead of generic error
- the changed-files query, per-file branch diff, and combined branch diff must all use the same resolved snapshot inputs: `baseRef`, `baseOid`, `headOid`, and `mergeBase`
- do not mix a file list produced from symbolic refs with per-file content produced from pinned oids; the summary, list, and file content must describe the same snapshot

### Snapshot Contract

Branch compare v1 must be snapshot-based, not "latest ref at render time."

Required contract:

- first resolve `headOid`
- then resolve `baseOid`
- then resolve `mergeBase` against those exact pinned oids
- derive the changed-file list, ahead count, per-file branch diff content, and combined branch diff content from those pinned values
- persist `baseRef`, `baseOid`, `headOid`, and `mergeBase` together as the compare snapshot

If `HEAD` or `<baseRef>` moves while the query is in flight:

- the in-flight result may be discarded as stale
- the UI must not combine old file-list data with new per-file content or vice versa

### Unborn HEAD Handling

Branch compare depends on a resolvable `HEAD`.

If the repository or worktree has no commits yet, or `HEAD` otherwise cannot be resolved:

- do not treat that as "no branch changes"
- keep uncommitted changes fully functional
- show the branch compare surface in an unavailable state distinct from invalid-base
- preserve the same recovery affordances as other unavailable states where applicable

Recommended copy:

- heading: `Branch compare unavailable`
- supporting text: `This branch does not have a committed HEAD yet, so compare-to-base is unavailable.`
- actions: `Retry`

### No Merge Base Handling

Branch compare also depends on `HEAD` and `<baseRef>` sharing a merge base.

If both refs resolve but `git merge-base <baseOid> <headOid>` fails because the histories are unrelated:

- do not treat that as "no branch changes"
- keep uncommitted changes fully functional
- show the branch compare surface in an unavailable state distinct from invalid-base and unborn-head
- preserve the same recovery affordances as other unavailable states where applicable

Recommended copy:

- heading: `Branch compare unavailable`
- supporting text: `This branch and <baseRef> do not share a merge base, so compare-to-base is unavailable.`
- actions: `Change Base Ref`, `Retry`

### Branch Diff Content Query

Per-file branch diff content needs a dedicated path-aware query path in main-process git code.

Recommended primitives:

```sh
git show <mergeBase>:<path>
git show <headOid>:<path>
```

Use `oldPath` on the merge-base side for renames and copies. Missing blobs should resolve to empty content rather than hard failure so added/deleted files render correctly.

### Unstaged Diff Content Query

Per-file unstaged diff content should also use dedicated git primitives rather than assuming `HEAD` on the left side.

Recommended primitives:

```sh
git show :<path>
git show HEAD:<path>
```

Rules:

- for unstaged entries, prefer index content on the left side
- if the path is not present in the index, fall back to `HEAD`
- read working-tree content from disk for the right side
- if the file is deleted in the working tree, the right side is empty
- for renamed unstaged entries, use `oldPath` for the left-side lookup when required by the parsed status entry

## Refresh Rules

Branch compare data should not be recomputed on the same fixed loop as `git status`.

Instead, branch compare should refresh on explicit invalidation events:

- active worktree changes
- Source Control tab becomes visible for the active worktree
- app startup hydration for the active worktree
- repo base ref changes
- explicit user action: `Retry`
- after fetch or any other operation that updates the resolved compare base ref, even if `HEAD` does not move
- after operations that may change `HEAD` or branch topology:
  - commit
  - amend
  - checkout / switch
  - merge
  - rebase
  - cherry-pick
  - pull
  - reset that changes `HEAD`

Refresh does not need to run after pure working-tree mutations such as:

- stage
- unstage
- discard
- editing files without creating a commit

because those operations do not change `baseRef...HEAD`.

Refreshing after fetch is required because `baseRef...HEAD` changes when the base ref moves, even if `HEAD` stays on the same commit.

### Runtime Freshness Requirement

The app cannot rely only on app-owned git operations for freshness because users may commit, rebase, fetch, or switch branches from the embedded terminal or other external tools.

Required v1 contract:

- branch compare refresh remains primarily event-driven
- when the `Source Control` panel is visible for the active worktree, the app must also run a lightweight compare-snapshot freshness check on an interval
- that check may be cheaper than a full branch compare refresh; it only needs to detect whether `headOid` or `baseOid` has changed
- if the freshness check detects a change, trigger a full branch compare refresh
- polling may stop when `Source Control` is not the visible right-sidebar tab

This keeps the visible branch compare state from going stale during terminal-driven git activity without paying the full compare cost continuously in the background.

The implementation may debounce or coalesce refresh triggers fired in quick succession. The important contract is: visible branch compare state must converge automatically after external git activity, not only after explicit user actions.

## Base Ref Recovery Path

`Change Base Ref` should reuse the existing repo base-ref management surface instead of inventing a second editor for the same setting.

Required v1 behavior:

- activating `Change Base Ref` opens a modal or sheet that reuses the existing repository base-ref search-and-select UI logic
- the control logic should be shared with the repository settings implementation rather than duplicated
- it must not navigate the user away from `Source Control` into the full Settings screen just to recover from an invalid base ref
- after the user picks a new base ref, branch compare refreshes immediately for the active worktree
- if the user cancels, keep the current unavailable state visible

This keeps base-ref editing in one canonical implementation while still making the recovery path direct from Source Control.

## Binary File Handling

Branch compare and combined diff must define non-text behavior explicitly.

This requires a diff payload contract richer than the current text-only `{ originalContent, modifiedContent }` shape.

Recommended payload shape:

```ts
type GitDiffTextResult = {
  kind: 'text'
  originalContent: string
  modifiedContent: string
}

type GitDiffBinaryResult = {
  kind: 'binary'
  originalIsBinary: boolean
  modifiedIsBinary: boolean
}

type GitDiffResult = GitDiffTextResult | GitDiffBinaryResult
```

The same union may be reused for uncommitted and branch diff loaders. Branch diff metadata such as file status and compare context should travel separately in the branch entry / compare summary models rather than being embedded in the diff payload.

For per-file branch diff and combined branch diff:

- if either side resolves to binary content, do not attempt to render a text diff in Monaco
- show a binary-file placeholder row instead
- include:
  - file path
  - branch compare status (`added`, `modified`, `deleted`, `renamed`, or `copied`)
  - compare context (`<baseRef>...HEAD`)

Recommended copy:

- title: `Binary file changed`
- supporting text: `Text diff is unavailable for this file in branch compare.`

For mixed repositories, binary files should still count toward changed-file totals and remain visible in section lists.

v1 refresh behavior:

- refresh uncommitted status on the existing poll loop
- refresh branch compare on worktree switch
- refresh branch compare when the Source Control panel first mounts for that worktree
- refresh branch compare after any operation that may move `HEAD`
- refresh branch compare after base-ref change
- while the Source Control panel is visible, run the lightweight freshness check described above so terminal-driven git activity is detected automatically
- provide a manual `Retry` or refresh action in the compare summary area

This keeps branch compare reasonably fresh without forcing a costly `git diff <baseRef>...HEAD` loop every few seconds.

## Loading And Error States

The panel must distinguish these states explicitly:

- `loading`: branch compare summary shows loading treatment; `All` still shows uncommitted sections if present
- `invalid-base`: use the unavailable state defined above
- `unborn-head`: use the unavailable state defined above for missing committed `HEAD`
- `no-merge-base`: use the unavailable state defined above for unrelated histories
- `error`: show `Branch compare failed` with retry action and preserve uncommitted sections

Do not reuse the generic empty state for `loading` or `error`.

## Visual Design Guidance

### Source Control

- Keep section headers compact and count-based
- Make the compare summary always visible in `All` and `Branch`
- Use explicit labels like `Committed on Branch` instead of vague labels like `Other Changes`
- Keep unavailable and loading states distinct from empty states

### Explorer

- Keep badges sparse
- Favor summary pills over duplicative per-file branch markers
- Avoid a second noisy alphabet of overlapping status badges

## Implementation Plan

Ship this in two phases, but make Phase 1 complete and shippable on its own.

### Phase 1

- Add branch compare data model and IPC surface
- Add base-ref validation and unavailable-state UI
- Update Source Control to show `All`, `Uncommitted`, `Branch`
- Add compare summary bar
- Add per-file branch diff open behavior
- Add read-only combined branch diff viewer
- Make `View All Changes` scope-aware
- Fix empty state logic
- Keep Explorer decorations uncommitted-only
- Pin branch compare to resolved snapshot oids and use the same snapshot for summary, list, and diff content
- Add visible-tab freshness detection so external terminal git activity refreshes branch compare automatically
- Reuse the repo base-ref picker logic in a Source Control recovery modal/sheet
- Upgrade diff IPC/result types so binary branch diffs are representable without ad hoc UI guesses
- Treat PR pill as optional enrichment only when branch PR data is already available; do not make GitHub lookup a phase-1 blocker
- Include explicit compare-snapshot invalidation/versioning so branch diff tabs cannot go stale across base-ref or `HEAD` changes

Phase 1 is the required landing scope.

### Phase 2

- Add a true mixed combined diff that renders both branch and uncommitted sections in one viewer
- Add commit summary or commit dropdown
- Optionally add a distinct Explorer branch-compare mode behind a setting

## Decisions

- Source Control should show both uncommitted and branch-level changes.
- The feature lives inside the existing `Source Control` sidebar tab.
- File Explorer should continue to show local SCM state only by default.
- Branch compare should be visible in summary surfaces, not normal per-file Explorer badges.
- Invalid base refs must produce an explicit unavailable state, not an empty state.
- Phase 1 includes minimal but complete branch diff viewing so the feature can land in one go.
