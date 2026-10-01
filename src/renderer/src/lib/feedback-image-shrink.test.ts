import { describe, expect, it } from 'vitest'
import {
  feedbackImageShrinkSteps,
  shrinkFeedbackImageWithin,
  type FeedbackImageShrinkStep
} from './feedback-image-shrink'

function encoderBySize(sizeFor: (step: FeedbackImageShrinkStep) => number | null): {
  encode: (step: FeedbackImageShrinkStep) => Promise<Blob | null>
  tried: FeedbackImageShrinkStep[]
} {
  const tried: FeedbackImageShrinkStep[] = []
  return {
    tried,
    encode: async (step) => {
      tried.push(step)
      const size = sizeFor(step)
      return size === null ? null : new Blob([new Uint8Array(size)], { type: step.contentType })
    }
  }
}

const pngSteps = feedbackImageShrinkSteps('image/png')

describe('feedbackImageShrinkSteps', () => {
  it('tries every PNG size before the first lossy one for a PNG source', () => {
    expect(pngSteps.map((step) => step.contentType)).toEqual([
      'image/png',
      'image/png',
      'image/jpeg',
      'image/jpeg',
      'image/jpeg',
      'image/jpeg'
    ])
  })

  // Why: a PNG of decoded JPEG noise is larger than the source it must undercut,
  // so those two full-size encodes could only ever waste time and memory.
  it('skips the PNG sizes for an already-lossy JPEG source', () => {
    expect(
      feedbackImageShrinkSteps('image/jpeg').every((step) => step.contentType === 'image/jpeg')
    ).toBe(true)
  })

  it('keeps every step a downscale or a same-size re-encode', () => {
    expect(pngSteps.every((step) => step.scale > 0 && step.scale <= 1)).toBe(true)
  })
})

describe('shrinkFeedbackImageWithin', () => {
  it('stops at the first encoding that fits', async () => {
    const { encode, tried } = encoderBySize((step) =>
      step.contentType === 'image/png' && step.scale === 0.5 ? 900 : 5000
    )

    const blob = await shrinkFeedbackImageWithin(pngSteps, encode, 1000)

    expect(blob?.size).toBe(900)
    expect(blob?.type).toBe('image/png')
    expect(tried.at(-1)).toEqual({ scale: 0.5, contentType: 'image/png' })
  })

  // Why: screenshots are mostly text, so every PNG size is tried before any JPEG.
  it('falls back to JPEG only after every PNG size is too big', async () => {
    const { encode, tried } = encoderBySize((step) =>
      step.contentType === 'image/jpeg' ? 800 : 5000
    )

    const blob = await shrinkFeedbackImageWithin(pngSteps, encode, 1000)

    expect(blob?.type).toBe('image/jpeg')
    expect(tried.map((step) => step.contentType)).toEqual(['image/png', 'image/png', 'image/jpeg'])
  })

  it('returns null when nothing fits or the browser cannot encode', async () => {
    expect(
      await shrinkFeedbackImageWithin(pngSteps, encoderBySize(() => 5000).encode, 1000)
    ).toBeNull()
    expect(
      await shrinkFeedbackImageWithin(pngSteps, encoderBySize(() => null).encode, 1000)
    ).toBeNull()
  })
})
