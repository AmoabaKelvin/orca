import { JIRA_ISSUE_KEY_PATTERN } from './jira-issue-url'

// Why: JQL's operator set is closed (plugins add functions, not operators), so input with
// none of these and no leading ORDER BY cannot parse as JQL. Hyphens excluded so `sign-in` stays text.
const JQL_OPERATOR_PATTERN = /[=~<>]|(?<![\w-])(?:in|is|was|changed)(?![\w-])|^order\s+by\b/i

// Lucene text-search syntax. Jira's index drops these characters, so spaces keep matches intact.
const TEXT_SEARCH_SYNTAX_PATTERN = /[+\-&|!(){}[\]^"~*?:\\/]/g

// Why: Jira skips word-splitting for a wildcard term, so `login,*` or `c#*` match nothing.
const WILDCARD_SAFE_WORD_PATTERN = /^[\p{L}\p{N}']+$/u

export function mayBeJql(input: string): boolean {
  return JQL_OPERATOR_PATTERN.test(input.trim())
}

/** Exact-issue-key JQL when the whole input is key-shaped; null otherwise. */
export function buildJiraIssueKeyJql(input: string): string | null {
  const trimmed = input.trim()
  return JIRA_ISSUE_KEY_PATTERN.test(trimmed) ? `key = "${trimmed.toUpperCase()}"` : null
}

/** Search issue text, ignoring key shape. Empty when no searchable words remain. */
export function buildJiraTextMatchJql(input: string): string {
  // Why: uppercase AND/OR/NOT are Lucene operators; text search ignores case anyway.
  const words = input
    .replace(TEXT_SEARCH_SYNTAX_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  if (!words) {
    return ''
  }
  const lastWord = words.slice(words.lastIndexOf(' ') + 1)
  return `text ~ "${words}${WILDCARD_SAFE_WORD_PATTERN.test(lastWord) ? '*' : ''}"`
}

/** Search issue text, or match an exact issue key. Empty when no searchable words remain. */
export function buildJiraTextSearchJql(input: string): string {
  return buildJiraIssueKeyJql(input) ?? buildJiraTextMatchJql(input)
}
