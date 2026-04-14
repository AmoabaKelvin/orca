# Split Groups PR 5: Hook Group Surfaces Into Flagged Path

This branch wires terminal, editor, and browser surfaces into the split-group
ownership path inside `Terminal.tsx`, but holds that path behind a temporary
local gate.

Scope:
- remove duplicate legacy ownership under the flagged path
- route group-local surface creation and restore through the new model
- preserve existing default behavior while the flag stays off

What Is Actually Hooked Up In This PR:
- `Terminal.tsx` now contains the real split-group surface path
- the new path mounts `TabGroupSplitLayout` and avoids keeping duplicate legacy surfaces mounted underneath
- the old legacy surface path is still present as the active runtime path in this branch

What Is Not Hooked Up Yet:
- the split-group path is still disabled by the temporary local rollout gate in `Terminal.tsx`
- users should still get legacy behavior by default in this branch
