// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLIPBOARD_IMAGE_MAX_PIXELS,
  CLIPBOARD_IMAGE_TOO_LARGE_ERROR
} from '../../../shared/clipboard-image'
import { convertImageBlobToPng } from './image-blob-png'

function stubDecodedSize(width: number, height: number): ReturnType<typeof vi.fn> {
  const close = vi.fn()
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width, height, close }))
  )
  return close
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('convertImageBlobToPng', () => {
  it('returns a PNG unchanged instead of re-encoding it', async () => {
    const close = stubDecodedSize(800, 600)
    const png = new Blob(['png-bytes'], { type: 'image/png' })

    await expect(convertImageBlobToPng(png)).resolves.toBe(png)
    expect(close).toHaveBeenCalledOnce()
  })

  it('still rejects a PNG whose dimensions exceed the clipboard limit', async () => {
    stubDecodedSize(CLIPBOARD_IMAGE_MAX_PIXELS + 1, 1)

    await expect(
      convertImageBlobToPng(new Blob(['png-bytes'], { type: 'image/png' }))
    ).rejects.toThrow(CLIPBOARD_IMAGE_TOO_LARGE_ERROR)
  })
})
