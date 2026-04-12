import { BrowserWindow, dialog, ipcMain } from 'electron'
import { browserManager } from '../browser/browser-manager'
import type {
  BrowserSetGrabModeArgs,
  BrowserSetGrabModeResult,
  BrowserAwaitGrabSelectionArgs,
  BrowserGrabResult,
  BrowserCancelGrabArgs,
  BrowserCaptureSelectionScreenshotArgs,
  BrowserCaptureSelectionScreenshotResult,
  BrowserExtractHoverArgs,
  BrowserExtractHoverResult
} from '../../shared/browser-grab-types'

let trustedBrowserRendererWebContentsId: number | null = null

export function setTrustedBrowserRendererWebContentsId(webContentsId: number | null): void {
  trustedBrowserRendererWebContentsId = webContentsId
}

function isTrustedBrowserRenderer(sender: Electron.WebContents): boolean {
  if (sender.isDestroyed() || sender.getType() !== 'window') {
    return false
  }
  if (trustedBrowserRendererWebContentsId != null) {
    return sender.id === trustedBrowserRendererWebContentsId
  }

  const senderUrl = sender.getURL()
  if (process.env.ELECTRON_RENDERER_URL) {
    try {
      return new URL(senderUrl).origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
    } catch {
      return false
    }
  }

  return senderUrl.startsWith('file://')
}

export function registerBrowserHandlers(): void {
  ipcMain.removeHandler('browser:registerGuest')
  ipcMain.removeHandler('browser:unregisterGuest')
  ipcMain.removeHandler('browser:openDevTools')
  ipcMain.removeHandler('browser:acceptDownload')
  ipcMain.removeHandler('browser:cancelDownload')
  ipcMain.removeHandler('browser:setGrabMode')
  ipcMain.removeHandler('browser:awaitGrabSelection')
  ipcMain.removeHandler('browser:cancelGrab')
  ipcMain.removeHandler('browser:captureSelectionScreenshot')
  ipcMain.removeHandler('browser:extractHoverPayload')

  ipcMain.handle(
    'browser:registerGuest',
    (event, args: { browserPageId: string; workspaceId: string; webContentsId: number }) => {
      if (!isTrustedBrowserRenderer(event.sender)) {
        return false
      }
      browserManager.registerGuest({
        ...args,
        rendererWebContentsId: event.sender.id
      })
      return true
    }
  )

  ipcMain.handle('browser:unregisterGuest', (event, args: { browserPageId: string }) => {
    if (!isTrustedBrowserRenderer(event.sender)) {
      return false
    }
    browserManager.unregisterGuest(args.browserPageId)
    return true
  })

  ipcMain.handle('browser:openDevTools', (event, args: { browserPageId: string }) => {
    if (!isTrustedBrowserRenderer(event.sender)) {
      return false
    }
    return browserManager.openDevTools(args.browserPageId)
  })

  ipcMain.handle('browser:acceptDownload', async (event, args: { downloadId: string }) => {
    if (!isTrustedBrowserRenderer(event.sender)) {
      return { ok: false, reason: 'not-authorized' as const }
    }
    const prompt = browserManager.getDownloadPrompt(args.downloadId, event.sender.id)
    if (!prompt) {
      return { ok: false, reason: 'not-ready' as const }
    }

    const parent = BrowserWindow.fromWebContents(event.sender)
    const result = parent
      ? await dialog.showSaveDialog(parent, { defaultPath: prompt.filename })
      : await dialog.showSaveDialog({ defaultPath: prompt.filename })
    if (result.canceled || !result.filePath) {
      browserManager.cancelDownload({
        downloadId: args.downloadId,
        senderWebContentsId: event.sender.id
      })
      return { ok: false, reason: 'canceled' as const }
    }

    return browserManager.acceptDownload({
      downloadId: args.downloadId,
      senderWebContentsId: event.sender.id,
      savePath: result.filePath
    })
  })

  ipcMain.handle('browser:cancelDownload', (event, args: { downloadId: string }) => {
    if (!isTrustedBrowserRenderer(event.sender)) {
      return false
    }
    return browserManager.cancelDownload({
      downloadId: args.downloadId,
      senderWebContentsId: event.sender.id
    })
  })

  // --- Browser Context Grab IPC ---

  ipcMain.handle(
    'browser:setGrabMode',
    async (event, args: BrowserSetGrabModeArgs): Promise<BrowserSetGrabModeResult> => {
      if (!isTrustedBrowserRenderer(event.sender)) {
        return { ok: false, reason: 'not-authorized' }
      }
      const guest = browserManager.getAuthorizedGuest(args.browserPageId, event.sender.id)
      if (!guest) {
        return { ok: false, reason: 'not-ready' }
      }
      const success = await browserManager.setGrabMode(args.browserPageId, args.enabled, guest)
      return success ? { ok: true } : { ok: false, reason: 'not-ready' }
    }
  )

  ipcMain.handle(
    'browser:awaitGrabSelection',
    async (event, args: BrowserAwaitGrabSelectionArgs): Promise<BrowserGrabResult> => {
      if (!isTrustedBrowserRenderer(event.sender)) {
        return { opId: args.opId, kind: 'error', reason: 'Not authorized' }
      }
      const guest = browserManager.getAuthorizedGuest(args.browserPageId, event.sender.id)
      if (!guest) {
        return { opId: args.opId, kind: 'error', reason: 'Guest not ready' }
      }
      // Why: no hasActiveGrabOp guard here — awaitGrabSelection already handles
      // the conflict by cancelling the previous op. Blocking at the IPC layer
      // would create a race window where rearm() fails if the previous IPC call
      // hasn't fully resolved yet.
      return browserManager.awaitGrabSelection(args.browserPageId, args.opId, guest)
    }
  )

  ipcMain.handle('browser:cancelGrab', (event, args: BrowserCancelGrabArgs): boolean => {
    if (!isTrustedBrowserRenderer(event.sender)) {
      return false
    }
    // Why: verify the sender actually owns this tab, consistent with the
    // authorization check in setGrabMode/awaitGrabSelection/captureScreenshot.
    const guest = browserManager.getAuthorizedGuest(args.browserPageId, event.sender.id)
    if (!guest) {
      return false
    }
    browserManager.cancelGrabOp(args.browserPageId, 'user')
    return true
  })

  ipcMain.handle(
    'browser:captureSelectionScreenshot',
    async (
      event,
      args: BrowserCaptureSelectionScreenshotArgs
    ): Promise<BrowserCaptureSelectionScreenshotResult> => {
      if (!isTrustedBrowserRenderer(event.sender)) {
        return { ok: false, reason: 'Not authorized' }
      }
      const guest = browserManager.getAuthorizedGuest(args.browserPageId, event.sender.id)
      if (!guest) {
        return { ok: false, reason: 'Guest not ready' }
      }
      const screenshot = await browserManager.captureSelectionScreenshot(
        args.browserPageId,
        args.rect,
        guest
      )
      if (!screenshot) {
        return { ok: false, reason: 'Screenshot capture failed' }
      }
      return { ok: true, screenshot }
    }
  )

  ipcMain.handle(
    'browser:extractHoverPayload',
    async (event, args: BrowserExtractHoverArgs): Promise<BrowserExtractHoverResult> => {
      if (!isTrustedBrowserRenderer(event.sender)) {
        return { ok: false, reason: 'Not authorized' }
      }
      const guest = browserManager.getAuthorizedGuest(args.browserPageId, event.sender.id)
      if (!guest) {
        return { ok: false, reason: 'Guest not ready' }
      }
      const payload = await browserManager.extractHoverPayload(args.browserPageId, guest)
      if (!payload) {
        return { ok: false, reason: 'No element hovered' }
      }
      return { ok: true, payload }
    }
  )
}
