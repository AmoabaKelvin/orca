// Wraps each word of rendered markdown in its own element, so a word can fade in
// as it is appended. Words already rendered keep their element, so appending
// text mounts only the new ones.

import type { Element, ElementContent, Root } from 'hast'

/** Elements whose renderers read their text, or that are faded in as a whole. */
const UNSPLIT_TAGS = new Set(['a', 'code', 'pre', 'kbd', 'svg', 'math'])

/** Scripts written without spaces, where each character is its own word. */
const SPACELESS_SCRIPT_RANGES = String.raw`\u2e80-\ud7ff\uf900-\uffef`
const SPACELESS_SCRIPT_CHAR = new RegExp(`[${SPACELESS_SCRIPT_RANGES}]`, 'u')

/** Shared with whatever paces the text these words are drawn from, so both end words alike. */
export function isSpacelessScriptChar(char: string): boolean {
  return SPACELESS_SCRIPT_CHAR.test(char)
}

/** Whitespace, one character of such a script, or a run of anything else. */
const WORD_PATTERN = new RegExp(
  `\\s+|[${SPACELESS_SCRIPT_RANGES}]|[^\\s${SPACELESS_SCRIPT_RANGES}]+`,
  'gu'
)

function wordElements(value: string): ElementContent[] {
  return Array.from(value.matchAll(WORD_PATTERN), ([token]): ElementContent =>
    token.trim() === ''
      ? { type: 'text', value: token }
      : {
          type: 'element',
          tagName: 'span',
          properties: { dataWord: '' },
          children: [{ type: 'text', value: token }]
        }
  )
}

function splitWords(node: Root | Element): void {
  // Only text is replaced, so an element's children stay element content.
  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const child = node.children[index]
    if (child.type === 'text') {
      node.children.splice(index, 1, ...wordElements(child.value))
    } else if (child.type === 'element' && !UNSPLIT_TAGS.has(child.tagName)) {
      splitWords(child)
    }
  }
}

export function rehypeWordFade(): (tree: Root) => void {
  return splitWords
}
