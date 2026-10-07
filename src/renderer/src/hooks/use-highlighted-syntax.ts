import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  createIncrementalSyntaxTokenizer,
  type SyntaxProgress
} from '@/lib/incremental-syntax-tokenizer'
import { loadedSyntaxTokenizer, loadSyntaxTokenizer } from '@/lib/syntax-tokenizer'
import { BoundedMap } from '../../../shared/bounded-map'
import { yieldToEventLoop } from '../../../shared/event-loop-yield'

// Each token is a DOM node, so only the start of a very long block is colored.
const MAX_HIGHLIGHTED_CODE_LENGTH = 50_000
// Tokenizing runs on the renderer thread, so it is spent in slices shorter than a frame.
const RENDER_BUDGET_MS = 4
const SLICE_BUDGET_MS = 6
// The cache is weighed in tokens, roughly 200 bytes each.
const MAX_FINISHED_TOKENS = 30_000
const MAX_FINISHED_ENTRIES = 256

let renderDeadline: number | null = null

/** One budget for every block that renders in the same task, however many mount at once. */
function remainingRenderBudgetMs(): number {
  if (renderDeadline === null) {
    renderDeadline = performance.now() + RENDER_BUDGET_MS
    setTimeout(() => {
      renderDeadline = null
    }, 0)
  }
  return Math.max(0, renderDeadline - performance.now())
}

// Finished blocks, so a row scrolled back into view paints in color without tokenizing again.
const finished = new BoundedMap<string, SyntaxProgress>({
  maxEntries: MAX_FINISHED_ENTRIES,
  maxBytes: MAX_FINISHED_TOKENS,
  sizeOf: (progress) => progress.lines.reduce((count, line) => count + line.tokens.length, 0)
})

function finishedKey(language: string, source: string): string {
  return `${language}\n${source}`
}

/**
 * Tokens for as much of `code` as has been colored so far, or null while there
 * is nothing to color it with. The rest, `code.slice(highlightedLength)`, is
 * still plain and arrives over later renders.
 */
export function useHighlightedSyntax(code: string, language: string): SyntaxProgress | null {
  const source =
    code.length > MAX_HIGHLIGHTED_CODE_LENGTH ? code.slice(0, MAX_HIGHLIGHTED_CODE_LENGTH) : code
  const tokenizer = loadedSyntaxTokenizer(language)
  const [, rerender] = useReducer((count: number) => count + 1, 0)

  useEffect(() => {
    if (tokenizer) {
      return
    }
    void loadSyntaxTokenizer(language).then((loaded) => {
      if (loaded) {
        rerender()
      }
    })
  }, [language, tokenizer])

  const tokenize = useMemo(
    () => (tokenizer ? createIncrementalSyntaxTokenizer(tokenizer) : null),
    [tokenizer]
  )
  // Short blocks finish here and paint in color at once; longer ones continue below.
  const started = useMemo(() => {
    try {
      return (
        finished.get(finishedKey(language, source)) ??
        (tokenize ? tokenize(source, remainingRenderBudgetMs()) : null)
      )
    } catch {
      return null
    }
  }, [language, source, tokenize])
  const [continued, setContinued] = useState<{
    after: SyntaxProgress
    progress: SyntaxProgress
  } | null>(null)
  const progress = continued?.after === started ? continued.progress : started

  useEffect(() => {
    if (!tokenize || !started || started.highlightedLength >= source.length) {
      return
    }
    let cancelled = false
    void (async () => {
      let progress = started
      while (progress.highlightedLength < source.length) {
        await yieldToEventLoop()
        if (cancelled) {
          return
        }
        try {
          progress = tokenize(source, SLICE_BUDGET_MS)
        } catch {
          // The lines colored so far stay; the rest keeps its plain text.
          return
        }
        setContinued({ after: started, progress })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [source, started, tokenize])

  const latest = useRef({ language, source, progress })
  useEffect(() => {
    latest.current = { language, source, progress }
  })
  // Why: remembered on unmount, not on every streamed chunk, which would fill the cache with prefixes.
  useEffect(
    () => () => {
      const last = latest.current
      if (last.progress && last.progress.highlightedLength >= last.source.length) {
        finished.set(finishedKey(last.language, last.source), last.progress)
      }
    },
    []
  )

  return progress
}
