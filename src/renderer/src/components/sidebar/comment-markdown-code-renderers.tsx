import React, { createContext, useContext } from 'react'
import { isMermaidFence, isMermaidPre, renderMermaidFence } from './comment-mermaid-fence'
import type { DocumentCodeBlockRenderer } from './comment-markdown-element-renderers'

export const CommentMarkdownMermaidContext = createContext(true)

export function CommentMarkdownDocumentCode({
  className,
  children
}: {
  className?: string
  children?: React.ReactNode
}): React.JSX.Element {
  const renderMermaid = useContext(CommentMarkdownMermaidContext)
  return renderMermaid && isMermaidFence(className) ? (
    renderMermaidFence(
      children,
      'my-3 min-w-0 max-w-full overflow-x-auto rounded-md border border-border/60 p-3 [&_.mermaid-block]:min-w-0 [&_.mermaid-block_pre]:my-0 [&_.mermaid-block_pre]:max-h-80 [&_.mermaid-block_pre]:max-w-full [&_.mermaid-block_pre]:overflow-x-auto [&_.mermaid-block_pre]:rounded-md [&_.mermaid-block_pre]:bg-accent [&_.mermaid-block_pre]:p-3 [&_.mermaid-block_pre]:font-mono [&_.mermaid-block_pre]:text-[12px]'
    )
  ) : (
    <code className="rounded bg-accent px-1.5 py-0.5 font-mono text-[0.92em] [overflow-wrap:anywhere]">
      {children}
    </code>
  )
}

export function CommentMarkdownDocumentPre({
  children,
  renderCodeBlock
}: {
  children?: React.ReactNode
  renderCodeBlock?: DocumentCodeBlockRenderer
}): React.JSX.Element {
  const renderMermaid = useContext(CommentMarkdownMermaidContext)
  if (renderMermaid && isMermaidPre(children)) {
    return <>{children}</>
  }
  const child = React.Children.toArray(children)[0]
  const language = React.isValidElement<{ className?: string }>(child)
    ? child.props.className?.match(/(?:^|\s)language-([^\s]+)/)?.[1]
    : undefined
  return renderCodeBlock ? (
    renderCodeBlock({ children, language })
  ) : (
    <pre className="my-3 max-h-80 max-w-full overflow-x-auto rounded-md bg-accent p-3 font-mono text-[12px]">
      {children}
    </pre>
  )
}
