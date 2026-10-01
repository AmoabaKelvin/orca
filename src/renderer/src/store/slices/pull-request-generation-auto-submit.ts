import type {
  PullRequestGenerationFields,
  PullRequestGenerationRecord
} from './pull-request-generation'

// Why: an auto-submitted run (Create PR) is sent without the user reviewing it in the form.
export type PullRequestGenerationOptions = { autoSubmit?: boolean }

/** Like the prepare-branch route: keep the base, and never uncheck Draft or override the user's choice. */
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
