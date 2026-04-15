#!/usr/bin/env node

// Why: end-to-end smoke test that opens a browser tab in a seeded Orca profile
// and verifies the window does not unexpectedly change size. Guards against
// regressions in the duplicate ready-to-show fix (#591).

import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const DEFAULT_PORT = 9444
const DEFAULT_ITERATIONS = 1
const CDP_READY_TIMEOUT_MS = 60_000
const POST_TRIGGER_SETTLE_MS = 3_000
const POST_READY_SETTLE_MS = 2_000

function parseArgs(argv) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv
  const args = {
    iterations: DEFAULT_ITERATIONS,
    cdpPort: DEFAULT_PORT,
    keepProfile: false,
    expect: 'no-maximize'
  }

  for (let index = 0; index < normalizedArgv.length; index += 1) {
    const arg = normalizedArgv[index]
    if (arg === '--iterations') {
      args.iterations = Number(normalizedArgv[index + 1] ?? DEFAULT_ITERATIONS)
      index += 1
      continue
    }
    if (arg === '--cdp-port') {
      args.cdpPort = Number(normalizedArgv[index + 1] ?? DEFAULT_PORT)
      index += 1
      continue
    }
    if (arg === '--keep-profile') {
      args.keepProfile = true
      continue
    }
    if (arg === '--expect') {
      const value = normalizedArgv[index + 1]
      if (value !== 'no-maximize' && value !== 'maximize') {
        throw new Error(`--expect must be "no-maximize" or "maximize", got "${value}"`)
      }
      args.expect = value
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!Number.isInteger(args.iterations) || args.iterations < 1) {
    throw new Error(`--iterations must be a positive integer, got ${args.iterations}`)
  }
  if (!Number.isInteger(args.cdpPort) || args.cdpPort < 1024) {
    throw new Error(`--cdp-port must be an integer >= 1024, got ${args.cdpPort}`)
  }

  return args
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function seedUserData(userDataPath, repoPath) {
  mkdirSync(userDataPath, { recursive: true })

  const repoId = 'repo-repro'
  const worktreeId = `${repoId}::${repoPath}`
  const now = Date.now()
  const state = {
    schemaVersion: 1,
    repos: [
      {
        id: repoId,
        path: repoPath,
        displayName: 'orca-repro',
        badgeColor: '#737373',
        addedAt: now,
        kind: 'git',
        worktreeBaseRef: 'main'
      }
    ],
    worktreeMeta: {
      [worktreeId]: {
        displayName: 'orca-repro',
        comment: '',
        linkedIssue: null,
        linkedPR: null,
        isArchived: false,
        isUnread: false,
        sortOrder: 0,
        lastActivityAt: now
      }
    },
    settings: {
      workspaceDir: join(repoPath, '..'),
      nestWorkspaces: true,
      refreshLocalBaseRefOnWorktreeCreate: false,
      branchPrefix: 'git-username',
      branchPrefixCustom: '',
      theme: 'system',
      editorAutoSave: false,
      editorAutoSaveDelayMs: 1000,
      terminalFontSize: 14,
      terminalFontFamily: 'SF Mono',
      terminalFontWeight: 400,
      terminalCursorStyle: 'bar',
      terminalCursorBlink: true,
      terminalThemeDark: 'Ghostty Default Style Dark',
      terminalDividerColorDark: '#3f3f46',
      terminalUseSeparateLightTheme: false,
      terminalThemeLight: 'Builtin Tango Light',
      terminalDividerColorLight: '#d4d4d8',
      terminalInactivePaneOpacity: 0.8,
      terminalActivePaneOpacity: 1,
      terminalPaneOpacityTransitionMs: 140,
      terminalDividerThicknessPx: 3,
      terminalRightClickToPaste: true,
      terminalFocusFollowsMouse: false,
      terminalScrollbackBytes: 10_000_000,
      openLinksInApp: true,
      rightSidebarOpenByDefault: true,
      showTitlebarAgentActivity: true,
      notifications: {
        enabled: true,
        agentTaskComplete: true,
        terminalBell: false,
        suppressWhenFocused: true
      },
      diffDefaultView: 'inline',
      promptCacheTimerEnabled: false,
      promptCacheTtlMs: 300_000,
      codexManagedAccounts: [],
      activeCodexManagedAccountId: null,
      terminalScopeHistoryByWorktree: true
    },
    ui: {
      lastActiveRepoId: repoId,
      lastActiveWorktreeId: worktreeId,
      sidebarWidth: 280,
      rightSidebarWidth: 350,
      groupBy: 'none',
      sortBy: 'name',
      showActiveOnly: false,
      filterRepoIds: [],
      uiZoomLevel: 0,
      editorFontZoomLevel: 0,
      worktreeCardProperties: ['status', 'unread', 'ci', 'issue', 'pr', 'comment'],
      statusBarItems: ['claude', 'codex', 'ssh'],
      statusBarVisible: true,
      dismissedUpdateVersion: null,
      lastUpdateCheckAt: null,
      browserDefaultUrl: 'https://google.com/',
      windowBounds: { x: 294, y: 68, width: 1060, height: 930 },
      windowMaximized: true
    },
    githubCache: {
      pr: {},
      issue: {}
    },
    workspaceSession: {
      activeRepoId: repoId,
      activeWorktreeId: worktreeId,
      activeTabId: null,
      tabsByWorktree: {},
      terminalLayoutsByTabId: {},
      activeWorktreeIdsOnShutdown: [],
      openFilesByWorktree: {},
      browserTabsByWorktree: {},
      browserPagesByWorkspace: {},
      activeBrowserTabIdByWorktree: {},
      activeFileIdByWorktree: {},
      activeTabTypeByWorktree: {}
    },
    sshTargets: []
  }

  writeFileSync(join(userDataPath, 'orca-data.json'), JSON.stringify(state, null, 2))
}

function runAgentBrowser(cdpPort, args) {
  return execFileSync('agent-browser', ['--cdp', String(cdpPort), ...args], {
    encoding: 'utf-8',
    timeout: 20_000
  }).trim()
}

async function waitForCdp(cdpPort) {
  const deadline = Date.now() + CDP_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      runAgentBrowser(cdpPort, ['snapshot', '-i'])
      return
    } catch {
      await sleep(500)
    }
  }
  throw new Error(`Timed out waiting for CDP on port ${cdpPort}`)
}

function getWindowMetrics(cdpPort) {
  const raw = runAgentBrowser(cdpPort, [
    'eval',
    'JSON.stringify({ outerWidth: window.outerWidth, outerHeight: window.outerHeight })'
  ])
  return JSON.parse(raw)
}

function triggerNewBrowserTab(cdpPort) {
  runAgentBrowser(cdpPort, ['press', 'Meta+Shift+B'])
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  child.kill('SIGINT')
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
      }
      resolve()
    }, 7_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function runIteration(iteration, options) {
  const profileRoot = mkdtempSync(join(tmpdir(), 'orca-browser-snap-'))
  const userDataPath = join(profileRoot, 'userData')
  seedUserData(userDataPath, process.cwd())

  const env = {
    ...process.env,
    REMOTE_DEBUGGING_PORT: String(options.cdpPort),
    ORCA_DEV_USER_DATA_PATH: userDataPath
  }

  const child = spawn('pnpm', ['dev'], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  child.stdout.on('data', (chunk) => process.stdout.write(chunk))
  child.stderr.on('data', (chunk) => process.stderr.write(chunk))

  try {
    await waitForCdp(options.cdpPort)
    await sleep(POST_READY_SETTLE_MS)

    const preTrigger = getWindowMetrics(options.cdpPort)
    console.log(`[repro] iteration ${iteration} pre-trigger: ${JSON.stringify(preTrigger)}`)

    triggerNewBrowserTab(options.cdpPort)
    await sleep(POST_TRIGGER_SETTLE_MS)

    const postTrigger = getWindowMetrics(options.cdpPort)
    console.log(`[repro] iteration ${iteration} post-trigger: ${JSON.stringify(postTrigger)}`)

    const sizeChanged =
      preTrigger.outerWidth !== postTrigger.outerWidth ||
      preTrigger.outerHeight !== postTrigger.outerHeight

    return {
      iteration,
      userDataPath,
      preTrigger,
      postTrigger,
      sizeChanged
    }
  } finally {
    await stopChild(child)
    if (!options.keepProfile) {
      rmSync(profileRoot, { recursive: true, force: true })
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const results = []

  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    console.log(
      `[repro] starting iteration ${iteration}/${options.iterations} ` +
        `(expect=${options.expect}, cdpPort=${options.cdpPort})`
    )
    const result = await runIteration(iteration, options)
    results.push(result)
    console.log(
      `[repro] iteration ${iteration} summary: sizeChanged=${result.sizeChanged}`
    )
  }

  const changedCount = results.filter((r) => r.sizeChanged).length
  console.log(
    `[repro] completed ${results.length} iteration(s): ` +
      `${changedCount} with window size change`
  )

  if (options.expect === 'no-maximize') {
    process.exitCode = changedCount === 0 ? 0 : 1
  } else {
    process.exitCode = changedCount > 0 ? 0 : 1
  }
}

main().catch((error) => {
  console.error('[repro] failed:', error)
  process.exit(1)
})
