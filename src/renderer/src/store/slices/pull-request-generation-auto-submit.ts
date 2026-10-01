import type {
  PullRequestGenerationFields,
  PullRequestGenerationRecord
} from './pull-request-generation'

// Why: an auto-submitted run (Create PR) is sent without the user reviewing it in the form.
export type PullRequestGenerationOptions = { autoSubmit?: boolean }

/** Keep the base the user sees, as the prepare-branch route does, and never uncheck Draft. */
export function resolveAutoSubmittedFields(
  { seed, seedFieldRevisions }: Pick<PullRequestGenerationRecord, 'seed' | 'seedFieldRevisions'>,
  result: PullRequestGenerationFields
): PullRequestGenerationFields {
  return {
    ...result,
    base: seed.base,
    draft: seed.draft || (seedFieldRevisions.draft === 0 && result.draft)
  }
}
