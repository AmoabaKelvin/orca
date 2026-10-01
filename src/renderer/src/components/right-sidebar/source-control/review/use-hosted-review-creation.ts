import { useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { normalizeHostedReviewHeadRef } from '../../../../../../shared/hosted-review-refs'
import { resolveBlockedCreateReviewNoticeMessage } from '../../source-control-create-review-blocked-action'
import type { SourceControlAi } from '../ai/use-ai'
import { stripBaseRef } from '../../create-pull-request-base-ref-normalization'
import type { SourceControlStoreActions } from '../listing/use-store-actions'
import type { SourceControlWorktreeContext } from '../listing/use-worktree-context'
import type { SourceControlWorktreeOperationState } from '../panel/use-worktree-operation-state'
import type { SourceControlCreateReviewComposer } from './use-create-review-composer'
import type { SourceControlHostedReviewCreated } from './use-hosted-review-created'
import type { HostedReviewCreatedContext } from './hosted-review-creation-state'
import type { SourceControlHostedReviewState } from './use-hosted-review-state'
import type { SourceControlPullRequestGeneration } from './use-pull-request-generation'
import type { PullRequestGenerationFields } from '@/store/slices/pull-request-generation'
import { useGenerateBeforeCreatePullRequest } from '../../use-generate-before-create-pull-request'
import { createdReviewIsForeground } from '../../created-review-foreground'

/**
 * Submits the composer as a hosted review (optionally stacked) and reconciles the "already open" and
 * partially-created-stack outcomes, both of which still leave a real review to link.
 */
export function useSourceControlHostedReviewCreation({
  activePullRequestGenerationKey,
  activeRepo,
  activeWorktreeId,
  branchName,
  createHostedReview,
  createPrInFlightRef,
  createStackedHostedReview,
  handleGeneratePullRequestFields,
  handlePullRequestCreated,
  hostedReviewCreateCopy,
  hostedReviewCreateProvider,
  hostedReviewCreation,
  prAiGenerationEnabled,
  prBase,
  prBody,
  prDraft,
  prFieldsAreSeedPlaceholders,
  prGenerating,
  prTitle,
  resolvedPrCreationDefaults,
  setCreatePrInFlightByWorktree,
  setCreatePrIntentNoticeForWorktree,
  settings,
  worktreePath
}: {
  activePullRequestGenerationKey: SourceControlPullRequestGeneration['activePullRequestGenerationKey']
  activeRepo: SourceControlWorktreeContext['activeRepo']
  activeWorktreeId: string | null
  branchName: string
  createHostedReview: SourceControlStoreActions['createHostedReview']
  createPrInFlightRef: SourceControlWorktreeOperationState['createPrInFlightRef']
  createStackedHostedReview: SourceControlStoreActions['createStackedHostedReview']
  handleGeneratePullRequestFields: SourceControlCreateReviewComposer['handleGeneratePullRequestFields']
  handlePullRequestCreated: SourceControlHostedReviewCreated['handlePullRequestCreated']
  hostedReviewCreateCopy: SourceControlHostedReviewState['hostedReviewCreateCopy']
  hostedReviewCreateProvider: SourceControlHostedReviewState['hostedReviewCreateProvider']
  hostedReviewCreation: SourceControlHostedReviewState['hostedReviewCreation']
  prAiGenerationEnabled: SourceControlCreateReviewComposer['prAiGenerationEnabled']
  prBase: SourceControlCreateReviewComposer['prBase']
  prBody: SourceControlCreateReviewComposer['prBody']
  prDraft: SourceControlCreateReviewComposer['prDraft']
  prFieldsAreSeedPlaceholders: SourceControlCreateReviewComposer['prFieldsAreSeedPlaceholders']
  prGenerating: boolean
  prTitle: SourceControlCreateReviewComposer['prTitle']
  resolvedPrCreationDefaults: SourceControlAi['resolvedPrCreationDefaults']
  setCreatePrInFlightByWorktree: SourceControlWorktreeOperationState['setCreatePrInFlightByWorktree']
  setCreatePrIntentNoticeForWorktree: SourceControlWorktreeOperationState['setCreatePrIntentNoticeForWorktree']
  settings: SourceControlWorktreeContext['settings']
  worktreePath: string | null
}) {
  const createPullRequest = useCallback(
    async (stacked = false, generated?: PullRequestGenerationFields): Promise<void> => {
      if (
        !activeRepo ||
        !activeWorktreeId ||
        !worktreePath ||
        !hostedReviewCreation ||
        prGenerating ||
        createPrInFlightRef.current[activeWorktreeId]
      ) {
        return
      }

      if (!hostedReviewCreation.canCreate) {
        // Why: blocked Create Review clicks are intentional; the inline notice tells the user which prerequisite to clear.
        const message = resolveBlockedCreateReviewNoticeMessage(hostedReviewCreation)
        if (message) {
          setCreatePrIntentNoticeForWorktree(activeWorktreeId, {
            tone: 'destructive',
            message
          })
        }
        return
      }

      const fields = generated ?? { base: prBase, title: prTitle, body: prBody, draft: prDraft }
      const base = stripBaseRef(fields.base).trim()
      const title = fields.title.trim()

      if (!title) {
        setCreatePrIntentNoticeForWorktree(activeWorktreeId, {
          tone: 'destructive',
          message: translate(
            'auto.components.right.sidebar.SourceControl.f3a8b2c1d0e5',
            'Enter a {{value0}} title.',
            { value0: hostedReviewCreateCopy.reviewLabel }
          )
        })
        return
      }

      if (!base || stripBaseRef(base).toLowerCase() === stripBaseRef(branchName).toLowerCase()) {
        setCreatePrIntentNoticeForWorktree(activeWorktreeId, {
          tone: 'destructive',
          message: translate(
            'auto.components.right.sidebar.SourceControl.ae743199cd',
            'Choose a different base branch before creating a {{value0}}.',
            { value0: hostedReviewCreateCopy.reviewLabel }
          )
        })
        return
      }

      createPrInFlightRef.current[activeWorktreeId] = true
      setCreatePrInFlightByWorktree((prev) => ({ ...prev, [activeWorktreeId]: true }))
      setCreatePrIntentNoticeForWorktree(activeWorktreeId, null)
      const createdContext = (): HostedReviewCreatedContext => ({
        repoPath: activeRepo.path,
        repoId: activeRepo.id,
        branch: branchName,
        worktreeId: activeWorktreeId,
        openChecks: createdReviewIsForeground(activeWorktreeId)
      })
      try {
        const createInput = {
          repoId: activeRepo.id,
          provider: hostedReviewCreateProvider,
          base,
          head: normalizeHostedReviewHeadRef(branchName),
          title,
          body: fields.body,
          draft: fields.draft,
          worktreePath,
          useTemplate: resolvedPrCreationDefaults.useTemplate
        }
        const result = stacked
          ? await createStackedHostedReview(activeRepo.path, createInput)
          : await createHostedReview(activeRepo.path, createInput)

        if (result.ok) {
          setCreatePrIntentNoticeForWorktree(activeWorktreeId, null)
          const context = createdContext()
          await handlePullRequestCreated(
            {
              provider: hostedReviewCreateProvider,
              number: result.number,
              url: result.url
            },
            context
          )
          if (context.openChecks && resolvedPrCreationDefaults.openAfterCreate) {
            window.api.shell.openUrl(result.url)
          }
          return
        }

        if ('existingReview' in result && result.existingReview?.url) {
          const number = result.existingReview.number
          toast.success(
            number
              ? translate(
                  'auto.components.right.sidebar.SourceControl.eef5446523',
                  '{{value0}} #{{value1}} is already open',
                  { value0: hostedReviewCreateCopy.titleLabel, value1: number }
                )
              : translate(
                  'auto.components.right.sidebar.SourceControl.d6fb1df5fe',
                  '{{value0}} is already open',
                  { value0: hostedReviewCreateCopy.titleLabel }
                ),
            {
              action: {
                label: translate(
                  'auto.components.right.sidebar.SourceControl.812cb992ee',
                  'Open on {{value0}}',
                  { value0: hostedReviewCreateCopy.providerName }
                ),
                onClick: () => window.api.shell.openUrl(result.existingReview!.url)
              }
            }
          )
          if (number) {
            setCreatePrIntentNoticeForWorktree(activeWorktreeId, null)
            await handlePullRequestCreated(
              {
                provider: hostedReviewCreateProvider,
                number,
                url: result.existingReview.url
              },
              createdContext()
            )
            return
          }
        }

        // Why: stacked creation can create the pull request and still fail to register
        // the stack. Link the review that exists before surfacing the stack failure, or
        // the workspace stays unaware of a PR the user can already see on GitHub.
        if ('createdReview' in result && result.createdReview?.url) {
          const { number, url } = result.createdReview
          if (number) {
            await handlePullRequestCreated(
              {
                provider: hostedReviewCreateProvider,
                number,
                url
              },
              createdContext()
            )
          }
        }

        setCreatePrIntentNoticeForWorktree(activeWorktreeId, {
          tone: 'destructive',
          message: result.error
        })
      } catch (error) {
        setCreatePrIntentNoticeForWorktree(activeWorktreeId, {
          tone: 'destructive',
          message:
            error instanceof Error
              ? error.message
              : translate(
                  'auto.components.right.sidebar.SourceControl.e2b7a1c0d9f4',
                  'Failed to create {{value0}}',
                  { value0: hostedReviewCreateCopy.reviewLabel }
                )
        })
      } finally {
        createPrInFlightRef.current[activeWorktreeId] = false
        setCreatePrInFlightByWorktree((prev) => ({ ...prev, [activeWorktreeId]: false }))
      }
    },
    [
      activeRepo,
      activeWorktreeId,
      branchName,
      createHostedReview,
      createPrInFlightRef,
      createStackedHostedReview,
      handlePullRequestCreated,
      hostedReviewCreation,
      hostedReviewCreateCopy.providerName,
      hostedReviewCreateCopy.reviewLabel,
      hostedReviewCreateCopy.titleLabel,
      hostedReviewCreateProvider,
      prBase,
      prBody,
      prDraft,
      prGenerating,
      prTitle,
      resolvedPrCreationDefaults.openAfterCreate,
      resolvedPrCreationDefaults.useTemplate,
      setCreatePrInFlightByWorktree,
      setCreatePrIntentNoticeForWorktree,
      worktreePath
    ]
  )

  const { handleCreatePullRequest: generateThenCreatePullRequest } =
    useGenerateBeforeCreatePullRequest({
      aiGenerationEnabled: prAiGenerationEnabled,
      canCreate: hostedReviewCreation?.canCreate === true,
      createPullRequest,
      fieldsAreSeedPlaceholders: prFieldsAreSeedPlaceholders,
      generatePullRequestFields: handleGeneratePullRequestFields,
      generationKey: activePullRequestGenerationKey,
      repo: activeRepo,
      settings
    })

  const heldClicksRef = useRef<Record<string, number>>({})
  const handleCreatePullRequest = useCallback(
    async (stacked = false): Promise<void> => {
      const worktreeId = activeWorktreeId
      if (!worktreeId) {
        return
      }
      // Why: like the prepare-branch route, the click stays in flight through generation; otherwise the eligibility refresh that starts when generation ends clears the eligibility the create checks.
      heldClicksRef.current[worktreeId] = (heldClicksRef.current[worktreeId] ?? 0) + 1
      setCreatePrInFlightByWorktree((prev) => ({ ...prev, [worktreeId]: true }))
      try {
        await generateThenCreatePullRequest(stacked)
      } finally {
        const held = (heldClicksRef.current[worktreeId] ?? 1) - 1
        heldClicksRef.current[worktreeId] = held
        if (held === 0 && !createPrInFlightRef.current[worktreeId]) {
          setCreatePrInFlightByWorktree((prev) => ({ ...prev, [worktreeId]: false }))
        }
      }
    },
    [
      activeWorktreeId,
      createPrInFlightRef,
      generateThenCreatePullRequest,
      setCreatePrInFlightByWorktree
    ]
  )

  return { handleCreatePullRequest }
}

export type SourceControlHostedReviewCreation = ReturnType<
  typeof useSourceControlHostedReviewCreation
>
