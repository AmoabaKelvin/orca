import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  splitActiveTerminalPane,
  waitForActiveTerminalManager,
  waitForPaneIdentitySnapshot,
  waitForPaneCount
} from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

type RecordedNotification = {
  title?: string
  body?: string
  at: number
}

async function installNotificationShowRecorder(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Notification }) => {
    const g = globalThis as unknown as {
      __orcaNotificationShows?: RecordedNotification[]
      __orcaNotificationRecorderInstalled?: boolean
    }

    g.__orcaNotificationShows = []
    if (g.__orcaNotificationRecorderInstalled) {
      return
    }
    g.__orcaNotificationRecorderInstalled = true

    try {
      Object.defineProperty(Notification, 'isSupported', {
        configurable: true,
        value: () => true
      })
    } catch {
      Notification.isSupported = () => true
    }

    Notification.prototype.show = function patchedShow(): void {
      const notification = this as unknown as {
        title?: string
        body?: string
        emit?: (eventName: string) => boolean
      }
      g.__orcaNotificationShows!.push({
        title: notification.title,
        body: notification.body,
        at: Date.now()
      })

      // Why: the production handler holds Notification instances until close
      // so macOS click handlers survive GC. The recorder suppresses the native
      // OS notification, so emit close ourselves to release that reference.
      setImmediate(() => {
        notification.emit?.('close')
      })
    }
  })
}

async function getRecordedNotifications(app: ElectronApplication): Promise<RecordedNotification[]> {
  return app.evaluate(() => {
    const g = globalThis as unknown as { __orcaNotificationShows?: RecordedNotification[] }
    return g.__orcaNotificationShows ?? []
  })
}

async function enableAgentCompletionNotifications(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const store = window.__store
    if (!store) {
      throw new Error('enableAgentCompletionNotifications: window.__store is unavailable')
    }
    const state = store.getState()
    await state.updateSettings({
      notifications: {
        ...state.settings.notifications,
        enabled: true,
        agentTaskComplete: true,
        terminalBell: true,
        suppressWhenFocused: false,
        customSoundPath: null
      }
    })
  })
}

async function sendCodexDoneHook(app: ElectronApplication, paneKey: string): Promise<void> {
  const now = Date.now()
  await app.evaluate(
    ({ BrowserWindow }, args) => {
      const win = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())
      if (!win) {
        throw new Error('sendCodexDoneHook: no BrowserWindow')
      }
      win.webContents.send('agentStatus:set', {
        paneKey: args.paneKey,
        state: 'done',
        prompt: `e2e notification ${args.paneKey}`,
        agentType: 'codex',
        connectionId: null,
        receivedAt: args.now,
        stateStartedAt: args.now
      })
    },
    { paneKey, now }
  )
}

test.describe('Codex notifications', () => {
  test('two Codex panes in one worktree notify independently while duplicates collapse', async ({
    orcaPage,
    electronApp
  }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActiveTerminalManager(orcaPage, 30_000)
    await waitForPaneCount(orcaPage, 1, 30_000)
    await enableAgentCompletionNotifications(orcaPage)
    await installNotificationShowRecorder(electronApp)

    await splitActiveTerminalPane(orcaPage, 'vertical')
    const paneSnapshot = await waitForPaneIdentitySnapshot(orcaPage, 2)
    const [firstPane, secondPane] = paneSnapshot.panes
    if (!firstPane || !secondPane) {
      throw new Error('Expected two split panes for Codex notification test')
    }
    const firstPaneKey = `${paneSnapshot.tabId}:${firstPane.leafId}`
    const secondPaneKey = `${paneSnapshot.tabId}:${secondPane.leafId}`

    // Why: this reproduces the regression shape. The first two events are the
    // same pane and should collapse under cooldown; the third is a sibling pane
    // in the same worktree and must still surface.
    await sendCodexDoneHook(electronApp, firstPaneKey)
    await sendCodexDoneHook(electronApp, firstPaneKey)
    await sendCodexDoneHook(electronApp, secondPaneKey)

    await expect
      .poll(async () => getRecordedNotifications(electronApp), {
        timeout: 10_000,
        message:
          'Expected one notification per Codex pane, with duplicate same-pane events collapsed'
      })
      .toHaveLength(2)

    await orcaPage.waitForTimeout(750)
    expect(await getRecordedNotifications(electronApp)).toHaveLength(2)
  })
})
