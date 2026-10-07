import type { GrammarState, HighlighterCore, LanguageInput, ThemedToken } from 'shiki/core'

export type SyntaxToken = {
  content: string
  /** Position in the tokenized text; unique within a line. */
  offset: number
  light: string | undefined
  dark: string | undefined
  italic: boolean
}

export type SyntaxGrammarState = GrammarState

export type SyntaxTokenizer = {
  /** Tokens per line; pass the returned `grammarState` back to resume mid-document. */
  tokenize: (
    code: string,
    grammarState?: SyntaxGrammarState
  ) => { lines: SyntaxToken[][]; grammarState: SyntaxGrammarState | undefined }
}

// A longer line stays plain and leaves the grammar state where it was, so a comment or
// string it opens is not carried onto the next line.
const MAX_TOKENIZED_LINE_LENGTH = 500
const SYNTAX_THEMES = { light: 'one-light', dark: 'one-dark-pro' } as const

let highlighterPromise: Promise<HighlighterCore> | undefined
let loadFailureLogged = false
const tokenizerPromises = new Map<string, Promise<SyntaxTokenizer | null>>()
const loadedTokenizers = new Map<string, SyntaxTokenizer>()

function loadHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= (async () => {
    const [{ createHighlighterCore }, { createOnigurumaEngine }, dark, light] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/oniguruma'),
      import('shiki/themes/one-dark-pro.mjs'),
      import('shiki/themes/one-light.mjs')
    ])
    return createHighlighterCore({
      themes: [dark.default, light.default],
      langs: [],
      // Why: the JS regex engine can backtrack catastrophically on TextMate grammars.
      engine: createOnigurumaEngine(import('shiki/wasm'))
    })
  })().catch((error: unknown) => {
    highlighterPromise = undefined
    throw error
  })
  return highlighterPromise
}

// Shiki names each style after the keys of SYNTAX_THEMES.
function toSyntaxToken({ content, offset, htmlStyle = {} }: ThemedToken): SyntaxToken {
  return {
    content,
    offset,
    light: htmlStyle['--shiki-light'],
    dark: htmlStyle['--shiki-dark'],
    italic:
      htmlStyle['--shiki-light-font-style'] === 'italic' ||
      htmlStyle['--shiki-dark-font-style'] === 'italic'
  }
}

async function createSyntaxTokenizer(language: string): Promise<SyntaxTokenizer | null> {
  const { bundledLanguages } = await import('shiki/langs')
  const grammars: Record<string, LanguageInput | undefined> = bundledLanguages
  const grammar = Object.hasOwn(grammars, language) ? grammars[language] : undefined
  if (!grammar) {
    return null
  }
  const highlighter = await loadHighlighter()
  await highlighter.loadLanguage(grammar)
  return {
    tokenize: (code, grammarState) => {
      const result = highlighter.codeToTokens(code, {
        lang: language,
        themes: SYNTAX_THEMES,
        defaultColor: false,
        grammarState,
        // Why: tokenizing one dense line cannot be interrupted, and its cost grows faster than its length.
        tokenizeMaxLineLength: MAX_TOKENIZED_LINE_LENGTH
      })
      return {
        lines: result.tokens.map((line) => line.map(toSyntaxToken)),
        grammarState: result.grammarState
      }
    }
  }
}

/** The tokenizer for a language that has already loaded, so a remount paints in color at once. */
export function loadedSyntaxTokenizer(language: string): SyntaxTokenizer | null {
  return loadedTokenizers.get(language.toLowerCase()) ?? null
}

/** Resolves to null when the language has no grammar or the load failed; a failure is retried. */
export function loadSyntaxTokenizer(language: string): Promise<SyntaxTokenizer | null> {
  const key = language.toLowerCase()
  let promise = tokenizerPromises.get(key)
  if (!promise) {
    promise = createSyntaxTokenizer(key).then(
      (tokenizer) => {
        if (tokenizer) {
          loadedTokenizers.set(key, tokenizer)
        }
        return tokenizer
      },
      (error: unknown) => {
        // Why: a remembered failure would leave the language plain until restart.
        tokenizerPromises.delete(key)
        if (!loadFailureLogged) {
          loadFailureLogged = true
          console.warn('[syntax-highlight] failed to load a grammar; code stays plain', error)
        }
        return null
      }
    )
    tokenizerPromises.set(key, promise)
  }
  return promise
}
