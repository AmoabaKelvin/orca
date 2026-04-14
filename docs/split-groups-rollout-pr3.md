# Split Groups PR 3: Worktree Restore Ownership

This branch moves worktree activation and restore logic onto the reconciled
tab-group model.

Scope:
- reconcile stale unified tabs before restore
- restore active surfaces from the group model first
- fall back to terminal when a grouped worktree has no renderable surface
- create a root group before initial terminal fallback attaches a new tab

What Is Actually Hooked Up In This PR:
- opening an existing worktree restores from the reconciled group/tab model
- reopening an empty grouped worktree falls back to a terminal instead of a blank pane
- initial terminal creation is now driven by renderable grouped content instead of one-time init guards

What Is Not Hooked Up Yet:
- no split-group layout is rendered
- the visible workspace host is still the legacy terminal/browser/editor surface path
- tab-group UI components still are not mounted here

Non-goals:
- no split-group UI enablement yet
