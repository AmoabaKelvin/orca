// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../../shared/constants'
import type { CreateHostedReviewResult } from '../../../../../shared/hosted-review'
import { getDefaultSourceControlAiSettings } from '../../../../../shared/source-control-ai-settings'
import { useChecksPanelCreateReview } from './use-checks-panel-create-review'

type CreateInput = Parameters<typeof useChecksPanelCreateReview>[0]

afterEach(cleanup)

function makeInput(overrides: Partial<CreateInput> = {}): CreateInput {
  const createdReview: CreateHostedReviewResult = {
    ok: true,
    number: 42,
    url: 'https://github.com/orca/app/pull/42'
  }
  return {
    activePullRequestGenerationKey: null,
    activeWorktreeId: null,
    activeWorktreePath: '/workspace/repo',
    branch: 'refs/heads/feature/create',
    createComposerOpen: true,
    createHostedReview: vi.fn(async () => createdReview),
    createPrInFlightRef: { current: null },
    createPrPushFirst: false,
    createStackedHostedReview: vi.fn(),
    fallbackGitHubPRNumber: null,
    fetchGitLabDetails: vi.fn(),
    fetchHostedReviewForBranch: vi.fn(),
    handleGeneratePullRequestFields: vi.fn(async () => {}),
    hostedReviewCreateCopy: {
      providerName: 'GitHub',
      reviewLabel: 'pull request',
      shortLabel: 'PR',
      titleLabel: 'Pull request'
    } as CreateInput['hostedReviewCreateCopy'],
    hostedReviewCreateProvider: 'github',
    hostedReviewCreation: null,
    linkedAzureDevOpsPR: null,
    linkedBitbucketPR: null,
    linkedGiteaPR: null,
    linkedGitLabMR: null,
    linkedPR: null,
    ownerSettings: null,
    panelContextKey: 'repo-1::worktree-1::feature/create',
    panelContextKeyRef: { current: 'repo-1::worktree-1::feature/create' },
    prAiGenerationEnabled: false,
    prBase: 'refs/remotes/origin/main',
    prBody: 'Create body',
    prCreationDefaults: {
      draft: false,
      generateDetailsOnOpen: false,
      openAfterCreate: false,
      useTemplate: true
    },
    prDraft: true,
    prFieldsAreSeedPlaceholders: false,
    prGenerating: false,
    prTitle: '  Create title  ',
    pushBeforeCreatePullRequest: vi.fn(async () => true),
    refreshLinkedGitHubPullRequest: vi.fn(),
    repo: { id: 'repo-1', path: '/workspace/repo' } as NonNullable<CreateInput['repo']>,
    setCreatePrError: vi.fn(),
    setGitStatusRefreshNonce: vi.fn(),
    setIsCreatingPr: vi.fn(),
    setRightSidebarOpen: vi.fn(),
    setRightSidebarTab: vi.fn(),
    updatePullRequestGenerationRecord: vi.fn(),
    updateWorktreeMeta: vi.fn(),
    ...overrides
  }
}

describe('useChecksPanelCreateReview provider flow', () => {
  it('sends normalized GitHub create input and releases the in-flight gate after success', async () => {
    const input = makeInput()
    const {
      createHostedReview,
      createPrInFlightRef,
      refreshLinkedGitHubPullRequest,
      setIsCreatingPr
    } = input
    const { result } = renderHook(() => useChecksPanelCreateReview(input))

    await act(async () => result.current.handleCreatePullRequest(false))

    expect(createHostedReview).toHaveBeenCalledWith('/workspace/repo', {
      repoId: 'repo-1',
      provider: 'github',
      base: 'main',
      head: 'feature/create',
      title: 'Create title',
      body: 'Create body',
      draft: true,
      worktreePath: '/workspace/repo',
      useTemplate: true
    })
    expect(refreshLinkedGitHubPullRequest).toHaveBeenCalledWith(42)
    expect(setIsCreatingPr).toHaveBeenNthCalledWith(1, true)
    expect(setIsCreatingPr).toHaveBeenLastCalledWith(false)
    expect(createPrInFlightRef.current).toBeNull()
  })

  it('generates details, then creates with them, when the composer still holds placeholders', async () => {
    const input = makeInput({
      activePullRequestGenerationKey: 'worktree-1::repo-1::feature/create',
      handleGeneratePullRequestFields: vi.fn(async () => ({
        result: { base: 'main', title: 'Add create flow', body: 'Details.', draft: false }
      })),
      ownerSettings: {
        ...getDefaultSettings('/home/test'),
        sourceControlAi: { ...getDefaultSourceControlAiSettings(), agentId: 'cursor' }
      },
      prAiGenerationEnabled: true,
      prFieldsAreSeedPlaceholders: true
    })
    const { result } = renderHook(() => useChecksPanelCreateReview(input))

    await act(async () => result.current.handleCreatePullRequest(false))

    expect(input.handleGeneratePullRequestFields).toHaveBeenCalledTimes(1)
    expect(input.createHostedReview).toHaveBeenCalledWith(
      '/workspace/repo',
      expect.objectContaining({
        base: 'main',
        title: 'Add create flow',
        body: 'Details.',
        draft: false
      })
    )
  })

  it('creates with the finished run even while the panel still shows it generating', async () => {
    const generated = { base: 'main', title: 'Add create flow', body: 'Details.', draft: false }
    let finish: () => void = () => {}
    const input = makeInput({
      activePullRequestGenerationKey: 'worktree-1::repo-1::feature/create',
      handleGeneratePullRequestFields: vi.fn(
        () =>
          new Promise<{ result: typeof generated }>((resolve) => {
            finish = () => resolve({ result: generated })
          })
      ),
      ownerSettings: {
        ...getDefaultSettings('/home/test'),
        sourceControlAi: { ...getDefaultSourceControlAiSettings(), agentId: 'cursor' }
      },
      prAiGenerationEnabled: true,
      prFieldsAreSeedPlaceholders: true
    })
    const { result, rerender } = renderHook(
      (props: CreateInput) => useChecksPanelCreateReview(props),
      { initialProps: input }
    )

    let click: Promise<void> = Promise.resolve()
    act(() => {
      click = result.current.handleCreatePullRequest(false)
    })
    rerender({ ...input, prGenerating: true })
    await act(async () => {
      finish()
      await click
    })

    expect(input.createHostedReview).toHaveBeenCalledWith(
      '/workspace/repo',
      expect.objectContaining({ title: 'Add create flow', body: 'Details.' })
    )
  })
})
