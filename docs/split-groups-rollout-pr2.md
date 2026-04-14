# Split Groups PR 2: Terminal Lifecycle Hardening

This branch is reserved for the terminal ownership and remount safety work
required before split groups can be exposed.

Scope:
- preserve PTYs across remounts
- fix pending-spawn dedupe paths
- fix split-pane PTY ownership
- keep user-visible split-group UI disabled

Non-goals:
- no new split-group layout rendered to users
- no worktree activation fallback changes

