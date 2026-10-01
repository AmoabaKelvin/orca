import type { JiraIssue } from '../../../shared/jira-types'
import {
  buildJiraIssueKeyJql,
  buildJiraTextMatchJql,
  mayBeJql
} from '../../../shared/jira-search-input-jql'
import { getJiraBadRequestReason } from './task-page-jira-load-state'

export type TaskPageJiraSearchResult = {
  issues: JiraIssue[]
  /** Set when Jira rejected the input as JQL and text matches are shown instead. */
  jqlRejection: string | null
}

export async function searchTaskPageJiraIssues(
  query: string,
  search: (jql: string) => Promise<JiraIssue[]>
): Promise<TaskPageJiraSearchResult> {
  const trimmed = query.trim()
  const textJql = buildJiraTextMatchJql(trimmed)
  const keyJql = buildJiraIssueKeyJql(trimmed)
  if (keyJql) {
    const issues = await search(keyJql)
    // Why: `utf-8` and `sha-256` are key-shaped but meant as text, so an empty key lookup
    // is a wrong guess, not an answer.
    if (issues.length > 0 || !textJql) {
      return { issues, jqlRejection: null }
    }
    return { issues: await search(textJql), jqlRejection: null }
  }
  if (!mayBeJql(trimmed)) {
    // Why: the runtime RPC rejects empty JQL.
    return { issues: textJql ? await search(textJql) : [], jqlRejection: null }
  }
  try {
    return { issues: await search(trimmed), jqlRejection: null }
  } catch (jqlError) {
    // Why: only a 400 means Jira couldn't use the query; auth, rate-limit and outages must surface.
    const reason = getJiraBadRequestReason(jqlError)
    if (reason === null || !textJql) {
      throw jqlError
    }
    const issues = await search(textJql).catch((textError: unknown) => {
      // Why: if Jira rejects the text too, the JQL reason is the useful one.
      throw getJiraBadRequestReason(textError) === null ? textError : jqlError
    })
    return { issues, jqlRejection: reason }
  }
}
