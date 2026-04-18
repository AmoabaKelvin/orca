import * as pty from 'node-pty'
import type { SubprocessHandle } from './session'
import { getShellReadyLaunchConfig, resolvePtyShellPath } from './shell-ready'

export type PtySubprocessOptions = {
  sessionId: string
  cols: number
  rows: number
  cwd?: string
  env?: Record<string, string>
  command?: string
}

function getDefaultCwd(): string {
  if (process.platform !== 'win32') {
    return process.env.HOME || '/'
  }

  // Why: HOMEPATH alone is drive-relative (`\\Users\\name`). Pair it with
  // HOMEDRIVE when USERPROFILE is unavailable so daemon-spawned Windows PTYs
  // still start in a valid absolute home directory.
  if (process.env.USERPROFILE) {
    return process.env.USERPROFILE
  }
  if (process.env.HOMEDRIVE && process.env.HOMEPATH) {
    return `${process.env.HOMEDRIVE}${process.env.HOMEPATH}`
  }
  return 'C:\\'
}

export function createPtySubprocess(opts: PtySubprocessOptions): SubprocessHandle {
  const env: Record<string, string> = {
    ...process.env,
    ...opts.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'Orca'
  } as Record<string, string>

  env.LANG ??= 'en_US.UTF-8'

  const shellPath = resolvePtyShellPath(env)
  let shellArgs: string[]

  if (process.platform === 'win32') {
    shellArgs = []
  } else {
    const shellReadyLaunch = opts.command ? getShellReadyLaunchConfig(shellPath) : null
    if (shellReadyLaunch) {
      Object.assign(env, shellReadyLaunch.env)
    }
    shellArgs = shellReadyLaunch?.args ?? ['-l']
  }

  const resolvedCwd = opts.cwd || getDefaultCwd()
  let proc: pty.IPty
  try {
    proc = pty.spawn(shellPath, shellArgs, {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: resolvedCwd,
      env
    })
  } catch (err) {
    // Why: node-pty's posix_spawnp error messages don't include the errno,
    // so log the full spawn context to the daemon log before rethrowing.
    // This surfaces bad shell paths, missing cwd, and env-shape issues that
    // Finder-launched packaged builds can easily hit.
    console.error('[daemon] pty.spawn failed', {
      shellPath,
      shellArgs,
      cwd: resolvedCwd,
      hasShellEnv: Boolean(env.SHELL),
      hasHomeEnv: Boolean(env.HOME),
      pathEnv: env.PATH ?? null,
      errMessage: err instanceof Error ? err.message : String(err)
    })
    throw err
  }

  let onDataCb: ((data: string) => void) | null = null
  let onExitCb: ((code: number) => void) | null = null

  proc.onData((data) => onDataCb?.(data))
  proc.onExit(({ exitCode }) => onExitCb?.(exitCode))

  return {
    pid: proc.pid,
    write: (data) => proc.write(data),
    resize: (cols, rows) => proc.resize(cols, rows),
    kill: () => proc.kill(),
    forceKill: () => {
      try {
        process.kill(proc.pid, 'SIGKILL')
      } catch {
        try {
          proc.kill()
        } catch {
          // Process may already be dead
        }
      }
    },
    signal: (sig) => {
      try {
        process.kill(proc.pid, sig)
      } catch {
        // Process may already be dead
      }
    },
    onData: (cb) => {
      onDataCb = cb
    },
    onExit: (cb) => {
      onExitCb = cb
    }
  }
}
