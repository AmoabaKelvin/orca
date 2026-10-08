// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeChatPacedMarkdown } from './NativeChatPacedMarkdown'
import {
  NativeChatReplyRevealsContext,
  type NativeChatReplyReveals
} from './native-chat-reply-reveals'
import { NATIVE_CHAT_TEXT_REVEAL_DELAY_MS } from './native-chat-text-reveal'

const reveals: NativeChatReplyReveals = { begun: new Set(['reply']), drawn: new Map() }

const mermaid = vi.hoisted(() => ({ rendered: vi.fn() }))
vi.mock('@/components/sidebar/CommentMermaidBlock', () => ({
  default: ({ content: code }: { content: string }) => {
    mermaid.rendered(code)
    return <div data-testid="diagram">{code}</div>
  }
}))
vi.mock('@/hooks/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => false }))
vi.mock('./native-chat-visual-markdown-extension', () => ({
  useNativeChatVisualMarkdownExtension: () => undefined
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  mermaid.rendered.mockClear()
})

it('keeps Mermaid as source until the complete received reply has been revealed', () => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'performance'
    ]
  })
  const content = '```mermaid\ngraph TD\nA --> B\n```\n\nComplete.'
  const reply = (streaming: boolean) => (
    <NativeChatReplyRevealsContext.Provider value={reveals}>
      <NativeChatPacedMarkdown
        rowKey="reply"
        content={content}
        streaming={streaming}
        variant="document"
      />
    </NativeChatReplyRevealsContext.Provider>
  )
  const view = render(reply(true))
  act(() => vi.advanceTimersByTime(100))
  expect(mermaid.rendered).not.toHaveBeenCalled()
  view.rerender(reply(false))
  expect(mermaid.rendered).not.toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(NATIVE_CHAT_TEXT_REVEAL_DELAY_MS - 100))
  expect(view.getByTestId('diagram').textContent).toBe('graph TD\nA --> B')
  expect(mermaid.rendered).toHaveBeenCalledWith('graph TD\nA --> B')
})
