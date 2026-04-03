import { ArrowUpRight, Download, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import type { UpdateStatus } from '../../../shared/types'

function getReleaseUrl(status: Extract<UpdateStatus, { state: 'available' | 'downloaded' }>): string {
  return status.releaseUrl ?? `https://github.com/stablyai/orca/releases/tag/v${status.version}`
}

export default function UpdateReminder(): React.JSX.Element | null {
  const updateStatus = useAppStore((s) => s.updateStatus)
  const dismissedUpdateVersion = useAppStore((s) => s.dismissedUpdateVersion)
  const dismissUpdate = useAppStore((s) => s.dismissUpdate)

  if (updateStatus.state !== 'available' && updateStatus.state !== 'downloaded') {
    return null
  }

  if (updateStatus.state === 'available' && updateStatus.version === dismissedUpdateVersion) {
    return null
  }

  const isDownloaded = updateStatus.state === 'downloaded'
  const title = isDownloaded ? `Version ${updateStatus.version} is ready` : 'New Orca update available'
  const detail = isDownloaded
    ? 'Restart when convenient to finish installing the new release.'
    : updateStatus.manualDownloadUrl
      ? `Version ${updateStatus.version} is available to download.`
      : `Version ${updateStatus.version} is available. Download it now or dismiss this reminder until a newer release ships.`
  const primaryLabel = isDownloaded
    ? 'Restart to Update'
    : updateStatus.manualDownloadUrl
      ? 'Download Update'
      : 'Install Update'

  return (
    <section className="border-b border-border/80 bg-gradient-to-r from-emerald-500/12 via-background to-cyan-500/10 px-4 py-3">
      <div className="mx-auto flex max-w-6xl items-start gap-3 rounded-xl border border-border/70 bg-background/88 px-4 py-3 shadow-sm backdrop-blur">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/14 text-emerald-700 dark:text-emerald-300">
          {isDownloaded ? <RefreshCw className="size-4" /> : <Download className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
              v{updateStatus.version}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            asChild
          >
            <a
              href={getReleaseUrl(updateStatus)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Release Notes
              <ArrowUpRight className="size-3.5" />
            </a>
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              if (isDownloaded) {
                void window.api.updater.quitAndInstall()
              } else {
                void window.api.updater.download()
              }
            }}
          >
            {primaryLabel}
          </Button>
          {!isDownloaded ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => dismissUpdate()}
              aria-label="Dismiss update reminder"
              title="Dismiss update reminder"
              className="text-muted-foreground"
            >
              <X className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  )
}
