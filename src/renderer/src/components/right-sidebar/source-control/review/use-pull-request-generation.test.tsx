// @vitest-environment happy-dom

import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as RuntimeGitClient from '@/runtime/runtime-git-client'
import { useAppStore } from '@/store'
import { DEFAULT_SOURCE_CONTROL_AI_PR_CREATION_DEFAULTS } from '../../../../../../shared/source-control-ai-settings'

const runtime = vi.hoisted(() => ({ generate: vi.fn() }))

vi.mock('@/runtime/runtime-git-client', async (importOriginal) => {
  const original = await importOriginal<typeof RuntimeGitClient>()
  return { ...original, generateRuntimePullRequestFields: runtime.generate }
})

import { useSourceControlPullRequestGeneration } from './use-pull-request-generation'

afterEach(() => {
  cleanup()
  runtime.generate.mockReset()
  useAppStore.setState({ pullRequestGenerationRecords: {} })
})

describe('useSourceControlPullRequestGeneration outcome', () => {
  it.each([
    { name: 'keeps the base for a Create PR run', autoSubmit: true, base: 'main' },
    { name: 'keeps the agent base for a reviewed run', autoSubmit: false, base: 'develop' }
  ])('$name', async ({ autoSubmit, base }) => {
    const generated = { base: 'develop', title: 'Add feature flag', body: 'Details.', draft: false }
    runtime.generate.mockResolvedValue({ success: true, fields: generated })
    const { setPullRequestGenerationRecord, updatePullRequestGenerationRecord } =
      useAppStore.getState()
    const { result } = renderHook(() =>
      useSourceControlPullRequestGeneration({
        activeRepo: {
          id: 'repo-1',
          path: '/repo',
          displayName: 'repo',
          badgeColor: '#000',
          addedAt: 0
        },
        activeRepoSettings: null,
        activeWorktreeId: 'wt-1',
        allocatePullRequestGenerationRequestId: vi.fn(() => 5),
        branchName: 'feature',
        hostedReviewCreateProvider: 'github',
        prGenerationRecords: {},
        refreshGitStatusAfterPullRequestGeneration: vi.fn(),
        resolvedPrCreationDefaults: DEFAULT_SOURCE_CONTROL_AI_PR_CREATION_DEFAULTS,
        setPullRequestGenerationRecord,
        updatePullRequestGenerationRecord,
        worktreePath: '/repo'
      })
    )

    const outcome = await result.current.handleGeneratePullRequestFieldsForActive(
      { base: 'main', title: 'Feature', body: '', draft: false },
      { base: 0, title: 0, body: 0, draft: 0 },
      undefined,
      { autoSubmit }
    )

    expect(outcome).toEqual({ result: { ...generated, base } })
  })
})
