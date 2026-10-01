// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import {
  createRunningPullRequestGenerationRecord,
  resolvePullRequestGenerationFailure,
  resolvePullRequestGenerationSuccess,
  type PullRequestGenerationFields
} from '@/store/slices/pull-request-generation'
import type { PullRequestGenerationOptions } from '@/store/slices/pull-request-generation-auto-submit'
import type { PullRequestGenerationOutcome } from '../../create-pull-request-dialog-field-model'
import { localizedHostedReviewCopy } from '@/i18n/hosted-review-localized-copy'
import { getDefaultSettings } from '../../../../../../shared/constants'
import type {
  CreateHostedReviewResult,
  HostedReviewCreationEligibility
} from '../../../../../../shared/hosted-review'
import {
  DEFAULT_SOURCE_CONTROL_AI_PR_CREATION_DEFAULTS,
  getDefaultSourceControlAiSettings
} from '../../../../../../shared/source-control-ai-settings'
import { useSourceControlHostedReviewCreation } from './use-hosted-review-creation'

type Input = Parameters<typeof useSourceControlHostedReviewCreation>[0]

const generatedFields = {
  base: 'develop',
  title: 'Correct README install steps',
  body: 'Fixes the typo.',
  draft: true
}

const GENERATION_KEY = 'wt-1::repo-1::fix-readme-typo'
const runningRecordFor = (options: PullRequestGenerationOptions = {}) =>
  createRunningPullRequestGenerationRecord(
    {
      worktreeId: 'wt-1',
      worktreePath: '/repo',
      requestId: 7,
      repoId: 'repo-1',
      branch: 'fix-readme-typo'
    },
    { base: 'main', title: 'Fix readme typo', body: '', draft: false },
    { base: 0, title: 0, body: 0, draft: 0 },
    options.autoSubmit
  )
const runningRecord = runningRecordFor()

const readyEligibility: HostedReviewCreationEligibility = {
  provider: 'github',
  review: null,
  canCreate: true,
  blockedReason: null,
  nextAction: null,
  reviewLookupOutcome: 'not_found'
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useAppStore.setState({ pullRequestGenerationRecords: {}, activeWorktreeId: null })
})

function makeInput(overrides: Partial<Input> = {}): Input {
  const createdReview: CreateHostedReviewResult = {
    ok: true,
    number: 42,
    url: 'https://github.com/o/r/pull/42'
  }
  return {
    activePullRequestGenerationKey: GENERATION_KEY,
    activeRepo: {
      id: 'repo-1',
      path: '/repo',
      displayName: 'repo',
      badgeColor: '#000',
      addedAt: 0
    },
    activeWorktreeId: 'wt-1',
    branchName: 'fix-readme-typo',
    createHostedReview: vi.fn(async () => createdReview),
    createPrInFlightRef: { current: {} },
    createStackedHostedReview: vi.fn(),
    handleGeneratePullRequestFields: generationReturning(generatedFields),
    handlePullRequestCreated: vi.fn(async () => {}),
    hostedReviewCreateCopy: localizedHostedReviewCopy('github'),
    hostedReviewCreateProvider: 'github',
    hostedReviewCreation: readyEligibility,
    prAiGenerationEnabled: true,
    prBase: 'main',
    prBody: '',
    prDraft: false,
    prFieldsAreSeedPlaceholders: true,
    prGenerating: false,
    prTitle: 'Fix readme typo',
    resolvedPrCreationDefaults: DEFAULT_SOURCE_CONTROL_AI_PR_CREATION_DEFAULTS,
    setCreatePrInFlightByWorktree: vi.fn(),
    setCreatePrIntentNoticeForWorktree: vi.fn(),
    settings: {
      ...getDefaultSettings('/home/test'),
      sourceControlAi: { ...getDefaultSourceControlAiSettings(), agentId: 'cursor' }
    },
    worktreePath: '/repo',
    ...overrides
  }
}

// Like the store-routed generation: the record runs before the first await and settles to the outcome.
function startGeneration(options?: PullRequestGenerationOptions): void {
  useAppStore.getState().setPullRequestGenerationRecord(GENERATION_KEY, runningRecordFor(options))
}
function settleGeneration(
  result: PullRequestGenerationFields | null
): PullRequestGenerationOutcome {
  useAppStore
    .getState()
    .updatePullRequestGenerationRecord(GENERATION_KEY, (record) =>
      result
        ? resolvePullRequestGenerationSuccess({ record, requestId: 7, result })
        : resolvePullRequestGenerationFailure({ record, requestId: 7, error: 'Agent failed' })
    )
  return {
    result: useAppStore.getState().pullRequestGenerationRecords[GENERATION_KEY]?.result ?? null
  }
}
function generationReturning(result: PullRequestGenerationFields | null) {
  return vi.fn(async (_overrides?: unknown, options?: PullRequestGenerationOptions) => {
    startGeneration(options)
    return settleGeneration(result)
  })
}
function deferredGeneration() {
  let finish: (result: PullRequestGenerationFields | null) => void = () => {}
  const generate = vi.fn((_overrides?: unknown, options?: PullRequestGenerationOptions) => {
    startGeneration(options)
    return new Promise<PullRequestGenerationOutcome>((resolve) => {
      finish = (result) => resolve(settleGeneration(result))
    })
  })
  return { generate, finish: (result: PullRequestGenerationFields | null) => finish(result) }
}

describe('useSourceControlHostedReviewCreation', () => {
  it('generates details for untouched placeholders, then creates with them', async () => {
    const input = makeInput()
    const { result } = renderHook(() => useSourceControlHostedReviewCreation(input))

    await act(async () => result.current.handleCreatePullRequest())

    expect(input.handleGeneratePullRequestFields).toHaveBeenCalledTimes(1)
    expect(input.createHostedReview).toHaveBeenCalledTimes(1)
    expect(input.createHostedReview).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({
        base: 'main',
        title: 'Correct README install steps',
        body: 'Fixes the typo.',
        draft: true
      })
    )
  })

  it('does not create when generation fails, and the next click submits as shown, even after the panel reopens', async () => {
    const input = makeInput({ handleGeneratePullRequestFields: generationReturning(null) })
    const first = renderHook(() => useSourceControlHostedReviewCreation(input))

    await act(async () => first.result.current.handleCreatePullRequest())
    expect(input.createHostedReview).not.toHaveBeenCalled()
    first.unmount()

    const reopened = renderHook(() => useSourceControlHostedReviewCreation(input))
    await act(async () => reopened.result.current.handleCreatePullRequest())
    expect(input.handleGeneratePullRequestFields).toHaveBeenCalledTimes(1)
    expect(input.createHostedReview).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({ title: 'Fix readme typo', body: '' })
    )
  })

  it('starts one run for repeated clicks and creates once', async () => {
    const { generate, finish } = deferredGeneration()
    const input = makeInput({ handleGeneratePullRequestFields: generate })
    const { result } = renderHook(() => useSourceControlHostedReviewCreation(input))

    let firstClick: Promise<void> = Promise.resolve()
    await act(async () => {
      firstClick = result.current.handleCreatePullRequest()
      await result.current.handleCreatePullRequest()
    })
    await act(async () => {
      finish(generatedFields)
      await firstClick
    })

    expect(generate).toHaveBeenCalledTimes(1)
    expect(input.createHostedReview).toHaveBeenCalledTimes(1)
  })

  it('generates for another branch while the first branch is still generating', async () => {
    const { generate: generateA, finish: finishA } = deferredGeneration()
    const input = makeInput({ handleGeneratePullRequestFields: generateA })
    const { result, rerender } = renderHook(
      (props: Input) => useSourceControlHostedReviewCreation(props),
      { initialProps: input }
    )

    let clickA: Promise<void> = Promise.resolve()
    act(() => {
      clickA = result.current.handleCreatePullRequest()
    })
    const generateB = vi.fn(async () => ({ result: generatedFields }))
    rerender({
      ...input,
      activePullRequestGenerationKey: 'wt-1::repo-1::add-usage',
      branchName: 'add-usage',
      handleGeneratePullRequestFields: generateB
    })
    await act(async () => result.current.handleCreatePullRequest())
    await act(async () => {
      finishA(null)
      await clickA
    })

    expect(generateB).toHaveBeenCalledTimes(1)
    expect(input.createHostedReview).toHaveBeenCalledTimes(1)
    expect(input.createHostedReview).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({ title: 'Correct README install steps', head: 'add-usage' })
    )
  })

  it('submits as shown when clicked again after Stop, before the stopped run winds down', async () => {
    const { generate, finish } = deferredGeneration()
    const input = makeInput({ handleGeneratePullRequestFields: generate })
    const { result } = renderHook(() => useSourceControlHostedReviewCreation(input))

    let firstClick: Promise<void> = Promise.resolve()
    act(() => {
      firstClick = result.current.handleCreatePullRequest()
    })
    useAppStore
      .getState()
      .setPullRequestGenerationRecord(GENERATION_KEY, { ...runningRecord, status: 'canceled' })
    await act(async () => result.current.handleCreatePullRequest())
    await act(async () => {
      finish(generatedFields)
      await firstClick
    })

    expect(generate).toHaveBeenCalledTimes(1)
    expect(input.createHostedReview).toHaveBeenCalledTimes(1)
    expect(input.createHostedReview).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({ title: 'Fix readme typo', body: '' })
    )
  })

  it('still creates the clicked branch PR when the panel closes mid-run', async () => {
    const { generate, finish } = deferredGeneration()
    const input = makeInput({ handleGeneratePullRequestFields: generate })
    const { result, rerender, unmount } = renderHook(
      (props: Input) => useSourceControlHostedReviewCreation(props),
      { initialProps: input }
    )

    let click: Promise<void> = Promise.resolve()
    act(() => {
      click = result.current.handleCreatePullRequest()
    })
    rerender({ ...input, prGenerating: true })
    unmount()
    await act(async () => {
      finish(generatedFields)
      await click
    })

    expect(input.createHostedReview).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({ head: 'fix-readme-typo', title: 'Correct README install steps' })
    )
  })

  it.each([
    { name: 'still selected', selectedAtFinish: 'wt-1', reveals: true },
    { name: 'no longer selected', selectedAtFinish: 'wt-2', reveals: false }
  ])(
    'reveals the created PR only when its worktree is $name after the panel closed mid-run',
    async ({ selectedAtFinish, reveals }) => {
      const openUrl = vi.fn()
      vi.stubGlobal('api', { shell: { openUrl } })
      useAppStore.setState({ activeWorktreeId: 'wt-1' })
      const { generate, finish } = deferredGeneration()
      const input = makeInput({
        handleGeneratePullRequestFields: generate,
        resolvedPrCreationDefaults: {
          ...DEFAULT_SOURCE_CONTROL_AI_PR_CREATION_DEFAULTS,
          openAfterCreate: true
        }
      })
      const { result, unmount } = renderHook(() => useSourceControlHostedReviewCreation(input))

      let click: Promise<void> = Promise.resolve()
      act(() => {
        click = result.current.handleCreatePullRequest()
      })
      unmount()
      useAppStore.setState({ activeWorktreeId: selectedAtFinish })
      await act(async () => {
        finish(generatedFields)
        await click
      })

      expect(input.createHostedReview).toHaveBeenCalledTimes(1)
      expect(input.handlePullRequestCreated).toHaveBeenCalledWith(
        expect.objectContaining({ number: 42 }),
        expect.objectContaining({ worktreeId: 'wt-1', openChecks: reveals })
      )
      expect(openUrl).toHaveBeenCalledTimes(reveals ? 1 : 0)
    }
  )

  it('leaves the details in the form instead of creating when the panel shows another branch', async () => {
    const { generate, finish } = deferredGeneration()
    const input = makeInput({ handleGeneratePullRequestFields: generate })
    const { result, rerender } = renderHook(
      (props: Input) => useSourceControlHostedReviewCreation(props),
      { initialProps: input }
    )

    let click: Promise<void> = Promise.resolve()
    act(() => {
      click = result.current.handleCreatePullRequest()
    })
    rerender({
      ...input,
      activePullRequestGenerationKey: 'wt-2::repo-1::other-branch',
      branchName: 'other-branch'
    })
    await act(async () => {
      finish(generatedFields)
      await click
    })

    expect(input.createHostedReview).not.toHaveBeenCalled()
  })

  it('shows the blocked notice instead of creating when the branch is blocked mid-run', async () => {
    const { generate, finish } = deferredGeneration()
    const input = makeInput({ handleGeneratePullRequestFields: generate })
    const { result, rerender } = renderHook(
      (props: Input) => useSourceControlHostedReviewCreation(props),
      { initialProps: input }
    )

    let click: Promise<void> = Promise.resolve()
    act(() => {
      click = result.current.handleCreatePullRequest()
    })
    rerender({
      ...input,
      hostedReviewCreation: { ...readyEligibility, canCreate: false, blockedReason: 'dirty' }
    })
    await act(async () => {
      finish(generatedFields)
      await click
    })

    expect(input.createHostedReview).not.toHaveBeenCalled()
    expect(input.setCreatePrIntentNoticeForWorktree).toHaveBeenCalledWith(
      'wt-1',
      expect.objectContaining({ tone: 'destructive' })
    )
  })

  it.each([
    { name: 'the fields were edited', overrides: { prFieldsAreSeedPlaceholders: false } },
    { name: 'AI actions are off', overrides: { prAiGenerationEnabled: false } },
    {
      name: 'no PR agent is configured',
      overrides: { settings: getDefaultSettings('/home/test') }
    },
    {
      name: 'generation cannot start',
      overrides: { handleGeneratePullRequestFields: vi.fn(async () => undefined) }
    }
  ])('submits as shown when $name', async ({ overrides }) => {
    const input = makeInput(overrides)
    const { result } = renderHook(() => useSourceControlHostedReviewCreation(input))

    await act(async () => result.current.handleCreatePullRequest())

    expect(input.createHostedReview).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({ title: input.prTitle, body: '' })
    )
  })

  it('shows the blocked notice instead of generating when the branch is not ready', async () => {
    const input = makeInput({
      hostedReviewCreation: { ...readyEligibility, canCreate: false, blockedReason: 'needs_push' }
    })
    const { result } = renderHook(() => useSourceControlHostedReviewCreation(input))

    await act(async () => result.current.handleCreatePullRequest())

    expect(input.handleGeneratePullRequestFields).not.toHaveBeenCalled()
    expect(input.createHostedReview).not.toHaveBeenCalled()
    expect(input.setCreatePrIntentNoticeForWorktree).toHaveBeenCalledWith(
      'wt-1',
      expect.objectContaining({ tone: 'destructive' })
    )
  })
})
