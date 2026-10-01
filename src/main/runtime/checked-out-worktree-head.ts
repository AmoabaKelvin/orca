import type { Repo } from '../../shared/repo-types'
import { getRepoSshConnectionId } from '../../shared/execution-host'
import { gitExecFileAsync } from '../git/runner'
import { WORKTREE_LIST_TIMEOUT_MS, gitExecOptions } from '../git/worktree-operation-options'
import type { LocalProjectWorktreeGitOptions } from '../project-runtime-git-options'
import { getSshGitProvider } from '../providers/ssh-git-dispatch'
import type { CheckedOutWorktreeHead } from './repeated-worktree-rows'

// One command, so a partial failure cannot pass for a detached HEAD: prints the commit, then the branch ref or `HEAD`.
const CHECKED_OUT_HEAD_ARGS = ['rev-parse', 'HEAD', '--symbolic-full-name', 'HEAD']

/** Ask the folder itself, on the host that owns it, what it has checked out; null when it cannot say. */
export async function readCheckedOutWorktreeHead(
  repo: Repo,
  localGitOptions: LocalProjectWorktreeGitOptions,
  worktreePath: string
): Promise<CheckedOutWorktreeHead | null> {
  try {
    const sshConnectionId = getRepoSshConnectionId(repo)
    const provider = sshConnectionId ? getSshGitProvider(sshConnectionId) : undefined
    if (sshConnectionId && !provider) {
      return null
    }
    const { stdout } = provider
      ? await provider.exec(CHECKED_OUT_HEAD_ARGS, worktreePath, {
          timeoutMs: WORKTREE_LIST_TIMEOUT_MS
        })
      : await gitExecFileAsync(
          CHECKED_OUT_HEAD_ARGS,
          gitExecOptions(worktreePath, { ...localGitOptions, timeout: WORKTREE_LIST_TIMEOUT_MS })
        )
    const [head, ref] = stdout.trim().split(/\r?\n/)
    return head && ref ? { head, branch: ref === 'HEAD' ? '' : ref } : null
  } catch {
    return null
  }
}
