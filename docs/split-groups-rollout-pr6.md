# Split Groups PR 6: Enable Split Groups

This branch turns split groups on after the earlier model, lifecycle, restore,
and renderer-ownership branches are in place.

Scope:
- remove the temporary rollout gate from `Terminal.tsx`
- make the split-group ownership path the active renderer path
- keep only the small bootstrap fallback for cases where no layout exists yet

What Is Actually Hooked Up In This PR:
- split groups are live
- `Terminal.tsx` always resolves through the split-group path when layout/group state exists
- the temporary gate introduced in PR5 is removed instead of left behind as dead config
