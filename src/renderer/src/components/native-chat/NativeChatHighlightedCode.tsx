import { memo } from 'react'
import { useHighlightedSyntax } from '@/hooks/use-highlighted-syntax'
import type { SyntaxLine } from '@/lib/incremental-syntax-tokenizer'
import type { SyntaxToken } from '@/lib/syntax-tokenizer'

type TokenStyle = React.CSSProperties & {
  '--syntax-light'?: string
  '--syntax-dark'?: string
}

function tokenStyle(token: SyntaxToken): TokenStyle {
  return {
    '--syntax-light': token.light,
    '--syntax-dark': token.dark,
    fontStyle: token.italic ? 'italic' : undefined
  }
}

const HighlightedLine = memo(function HighlightedLine({ line }: { line: SyntaxLine }) {
  return (
    <>
      {line.tokens.map((token) =>
        token.content.trim() ? (
          <span
            key={token.offset}
            // Both theme colors ride on the token so a scheme change needs no re-tokenizing.
            className="text-(color:--syntax-light) dark:text-(color:--syntax-dark)"
            style={tokenStyle(token)}
          >
            {token.content}
          </span>
        ) : (
          token.content
        )
      )}
      {line.ending}
    </>
  )
})

/** Colors `code` in place; its text is unchanged, so layout and copy match the plain fallback. */
export const NativeChatHighlightedCode = memo(function NativeChatHighlightedCode({
  code,
  language
}: {
  code: string
  language: string
}): React.ReactNode {
  const progress = useHighlightedSyntax(code, language)
  if (!progress) {
    return code
  }
  return (
    <>
      {progress.lines.map((line) => (
        <HighlightedLine key={line.start} line={line} />
      ))}
      {code.slice(progress.highlightedLength)}
    </>
  )
})
