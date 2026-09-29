// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_FEEDBACK_IMAGE_BYTES,
  MAX_FEEDBACK_IMAGE_COUNT,
  MAX_FEEDBACK_IMAGE_SOURCE_BYTES,
  MAX_FEEDBACK_IMAGE_TOTAL_BYTES,
  MIN_FEEDBACK_IMAGE_SHRINK_TARGET_BYTES,
  hasAttachableFeedbackImage,
  readFeedbackImageFiles
} from './feedback-image-attachments'

const { shrinkFeedbackImage } = vi.hoisted(() => ({ shrinkFeedbackImage: vi.fn() }))

// Why: happy-dom has no image decoder; the shrink steps are covered in their own test.
vi.mock('./feedback-image-shrink', () => ({ shrinkFeedbackImage }))

beforeEach(() => {
  shrinkFeedbackImage.mockReset()
  shrinkFeedbackImage.mockResolvedValue(null)
  let next = 0
  URL.createObjectURL = vi.fn(() => `blob:feedback-${(next += 1)}`)
  URL.revokeObjectURL = vi.fn()
})

function pngHeader(width = 1, height = 1): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(24))
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13)
  bytes.set([73, 72, 68, 82], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

function pngFile(name: string, size = 24, dimensions = { width: 1, height: 1 }): File {
  const file = new File([pngHeader(dimensions.width, dimensions.height)], name, {
    type: 'image/png'
  })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

function gifFile(name: string, size: number): File {
  // GIF89a, 1x1
  const file = new File([new Uint8Array([71, 73, 70, 56, 57, 97, 1, 0, 1, 0])], name, {
    type: 'image/gif'
  })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

function encoded(size: number, type: string): Blob {
  return new Blob([new Uint8Array(size)], { type })
}

describe('hasAttachableFeedbackImage', () => {
  it('is true when any file is an allow-listed type', () => {
    const svg = new File(['x'], 'a.svg', { type: 'image/svg+xml' })
    expect(hasAttachableFeedbackImage([svg, pngFile('a.png')])).toBe(true)
  })

  // Why: the paste handler only consumes the event when this is true. An
  // image/* type outside the allow-list must still fall through so co-pasted
  // text is not swallowed, while readFeedbackImageFiles raises its toast.
  it('is false when every file is an unsupported image type', () => {
    const svg = new File(['x'], 'a.svg', { type: 'image/svg+xml' })
    const bmp = new File(['x'], 'a.bmp', { type: 'image/bmp' })
    expect(hasAttachableFeedbackImage([svg, bmp])).toBe(false)
  })

  it('is false for an empty selection', () => {
    expect(hasAttachableFeedbackImage([])).toBe(false)
  })

  it('is false when supported files cannot pass validation', () => {
    expect(hasAttachableFeedbackImage([pngFile('empty.png', 0)])).toBe(false)
    expect(
      hasAttachableFeedbackImage([pngFile('huge.png', MAX_FEEDBACK_IMAGE_SOURCE_BYTES + 1)])
    ).toBe(false)
    expect(hasAttachableFeedbackImage([gifFile('anim.gif', MAX_FEEDBACK_IMAGE_BYTES + 1)])).toBe(
      false
    )
    expect(hasAttachableFeedbackImage([pngFile('a.png')], MAX_FEEDBACK_IMAGE_COUNT)).toBe(false)
    expect(hasAttachableFeedbackImage([pngFile('a.png')], 1, MAX_FEEDBACK_IMAGE_TOTAL_BYTES)).toBe(
      false
    )
  })

  // Why: the paste gate must mirror the shrink rule, or a pasted screenshot that
  // would have been compressed falls through to the textarea and is lost.
  // Why: consuming the paste would drop co-pasted text for an image that cannot fit anyway.
  it('is false when too little budget is left to shrink into', () => {
    const almostSpent = MAX_FEEDBACK_IMAGE_TOTAL_BYTES - MIN_FEEDBACK_IMAGE_SHRINK_TARGET_BYTES + 1
    expect(hasAttachableFeedbackImage([pngFile('retina.png', 6_400_000)], 1, almostSpent)).toBe(
      false
    )
  })

  it('is true for an oversized screenshot that can be shrunk into the space left', () => {
    expect(hasAttachableFeedbackImage([pngFile('retina.png', 6_400_000)])).toBe(true)
    expect(hasAttachableFeedbackImage([pngFile('second.png', 2_000_000)], 1, 3_000_000)).toBe(true)
  })
})

describe('readFeedbackImageFiles', () => {
  it('reads supported images into drafts with distinct ids', async () => {
    const { images, errors } = await readFeedbackImageFiles([pngFile('a.png'), pngFile('a.png')], 0)

    expect(errors).toEqual([])
    expect(images).toHaveLength(2)
    expect(new Set(images.map((image) => image.id)).size).toBe(2)
    expect(images[0].data.byteLength).toBe(24)
  })

  it('reports an unsupported type instead of skipping it', async () => {
    const { images, errors } = await readFeedbackImageFiles(
      [new File(['x'], 'notes.pdf', { type: 'application/pdf' })],
      0
    )

    expect(images).toEqual([])
    expect(errors).toEqual(['notes.pdf is not a supported image type.'])
  })

  it('caps rejection detail so a large drop cannot mount one toast per file', async () => {
    const files = Array.from(
      { length: 100 },
      (_, index) => new File(['x'], `image-${index}.svg`, { type: 'image/svg+xml' })
    )

    const { images, errors } = await readFeedbackImageFiles(files, 0)

    expect(images).toEqual([])
    expect(errors).toHaveLength(5)
    expect(errors.at(-1)).toBe('96 additional images could not be attached.')
  })

  it('shrinks an oversized screenshot to fit instead of refusing it', async () => {
    const file = pngFile('retina.png', 6_400_000)
    shrinkFeedbackImage.mockResolvedValue(encoded(3_000_000, 'image/png'))

    const { images, errors, notices } = await readFeedbackImageFiles([file], 0)

    expect(errors).toEqual([])
    expect(shrinkFeedbackImage).toHaveBeenCalledWith(file, MAX_FEEDBACK_IMAGE_BYTES)
    expect(images).toHaveLength(1)
    expect(images[0]).toMatchObject({ name: 'retina.png', contentType: 'image/png', bytes: 3e6 })
    expect(images[0].data.byteLength).toBe(3_000_000)
    expect(notices).toEqual([
      'retina.png was compressed from 6.1 MB to 2.9 MB to fit the attachment limit.'
    ])
  })

  it('shrinks a second screenshot into the budget the first one left', async () => {
    const first = pngFile('first.png', 3_000_000)
    const second = pngFile('second.png', 3_000_000)
    shrinkFeedbackImage.mockResolvedValue(encoded(900_000, 'image/jpeg'))

    const { images, errors } = await readFeedbackImageFiles([first, second], 0)

    expect(errors).toEqual([])
    expect(shrinkFeedbackImage).toHaveBeenCalledTimes(1)
    expect(shrinkFeedbackImage).toHaveBeenCalledWith(
      second,
      MAX_FEEDBACK_IMAGE_TOTAL_BYTES - 3_000_000
    )
    expect(images.map((image) => [image.name, image.contentType, image.bytes])).toEqual([
      ['first.png', 'image/png', 3_000_000],
      ['second.png', 'image/jpeg', 900_000]
    ])
  })

  it('refuses without shrinking when too little budget is left to shrink into', async () => {
    const almostSpent = MAX_FEEDBACK_IMAGE_TOTAL_BYTES - MIN_FEEDBACK_IMAGE_SHRINK_TARGET_BYTES + 1

    const { images, errors } = await readFeedbackImageFiles(
      [pngFile('second.png', 2_000_000)],
      1,
      almostSpent
    )

    expect(shrinkFeedbackImage).not.toHaveBeenCalled()
    expect(images).toEqual([])
    expect(errors).toEqual(['second.png would bring the attachments over 4.0 MB in total.'])
  })

  it('does not re-encode an image that already fits', async () => {
    const { images, notices } = await readFeedbackImageFiles([pngFile('small.png', 1024)], 0)

    expect(shrinkFeedbackImage).not.toHaveBeenCalled()
    expect(images[0].bytes).toBe(1024)
    expect(notices).toEqual([])
  })

  it('refuses an oversized GIF or WebP rather than flattening its animation', async () => {
    const webp = new File(['x'], 'anim.webp', { type: 'image/webp' })
    Object.defineProperty(webp, 'size', { value: MAX_FEEDBACK_IMAGE_BYTES + 1 })

    const { images, errors } = await readFeedbackImageFiles(
      [gifFile('anim.gif', MAX_FEEDBACK_IMAGE_BYTES + 1), webp],
      0
    )

    expect(shrinkFeedbackImage).not.toHaveBeenCalled()
    expect(images).toEqual([])
    expect(errors).toEqual(['anim.gif is larger than 4.0 MB.', 'anim.webp is larger than 4.0 MB.'])
  })

  it('refuses an oversized animated PNG rather than flattening it', async () => {
    const apng = new File([pngHeader(), new TextEncoder().encode('....acTL....IDAT')], 'anim.png', {
      type: 'image/png'
    })
    Object.defineProperty(apng, 'size', { value: MAX_FEEDBACK_IMAGE_BYTES + 1 })

    const { images, errors } = await readFeedbackImageFiles([apng], 0)

    expect(shrinkFeedbackImage).not.toHaveBeenCalled()
    expect(images).toEqual([])
    expect(errors).toEqual(['anim.png is larger than 4.0 MB.'])
  })

  it('refuses a file too large to read before shrinking', async () => {
    const file = pngFile('enormous.png', MAX_FEEDBACK_IMAGE_SOURCE_BYTES + 1)
    file.arrayBuffer = vi.fn()

    const { images, errors } = await readFeedbackImageFiles([file], 0)

    expect(file.arrayBuffer).not.toHaveBeenCalled()
    expect(images).toEqual([])
    expect(errors).toEqual(['enormous.png is larger than 4.0 MB.'])
  })

  it('reports an image the browser could not decode for shrinking', async () => {
    shrinkFeedbackImage.mockRejectedValue(new Error('decode failed'))

    const { images, errors } = await readFeedbackImageFiles([pngFile('retina.png', 6_400_000)], 0)

    expect(images).toEqual([])
    expect(errors).toEqual(['retina.png is larger than 4.0 MB.'])
  })

  it('reports an oversized image that could not be shrunk enough', async () => {
    const { images, errors } = await readFeedbackImageFiles(
      [pngFile('huge.png', MAX_FEEDBACK_IMAGE_BYTES + 1)],
      0
    )

    expect(images).toEqual([])
    expect(errors).toEqual(['huge.png is larger than 4.0 MB.'])
  })

  it('accepts a set that totals exactly the attachment budget', async () => {
    const quarter = MAX_FEEDBACK_IMAGE_TOTAL_BYTES / MAX_FEEDBACK_IMAGE_COUNT
    const files = Array.from({ length: MAX_FEEDBACK_IMAGE_COUNT }, (_, index) =>
      pngFile(`part-${index}.png`, quarter)
    )

    const { images, errors } = await readFeedbackImageFiles(files, 0)

    expect(errors).toEqual([])
    expect(images).toHaveLength(MAX_FEEDBACK_IMAGE_COUNT)
  })

  it('rejects an image that would take the set over the total budget', async () => {
    const half = MAX_FEEDBACK_IMAGE_TOTAL_BYTES / 2

    const { images, errors } = await readFeedbackImageFiles(
      [pngFile('a.png', half), pngFile('b.png', half), pngFile('c.png', 1)],
      0
    )

    expect(images.map((image) => image.name)).toEqual(['a.png', 'b.png'])
    expect(errors).toEqual(['c.png would bring the attachments over 4.0 MB in total.'])
  })

  it('counts already attached bytes and still fits a later smaller image', async () => {
    const { images, errors } = await readFeedbackImageFiles(
      [pngFile('big.png', 2048), pngFile('small.png', 1024)],
      1,
      MAX_FEEDBACK_IMAGE_TOTAL_BYTES - 1024
    )

    expect(images.map((image) => image.name)).toEqual(['small.png'])
    expect(errors).toEqual(['big.png would bring the attachments over 4.0 MB in total.'])
  })

  it('reports an empty image instead of deferring rejection until submit', async () => {
    const { images, errors } = await readFeedbackImageFiles([pngFile('empty.png', 0)], 0)

    expect(images).toEqual([])
    expect(errors).toEqual(['empty.png is empty.'])
  })

  it('rejects a raster that would exceed the decoded preview budget', async () => {
    const file = pngFile('huge-dimensions.png', 24, { width: 8192, height: 8192 })

    const { images, errors } = await readFeedbackImageFiles([file], 0)

    expect(images).toEqual([])
    expect(errors).toEqual([
      'huge-dimensions.png has dimensions that are too large to preview safely.'
    ])
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('rejects invalid raster bytes instead of mounting a broken preview', async () => {
    const file = new File(['not an image'], 'broken.png', { type: 'image/png' })

    const { images, errors } = await readFeedbackImageFiles([file], 0)

    expect(images).toEqual([])
    expect(errors).toEqual(['broken.png is not a valid supported image.'])
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('does not count a rejected preview against the attachment limit', async () => {
    const files = [
      new File(['not an image'], 'broken.png', { type: 'image/png' }),
      ...Array.from({ length: MAX_FEEDBACK_IMAGE_COUNT }, (_, index) =>
        pngFile(`valid-${index}.png`)
      )
    ]

    const { images, errors } = await readFeedbackImageFiles(files, 0)

    expect(images).toHaveLength(MAX_FEEDBACK_IMAGE_COUNT)
    expect(errors).toEqual(['broken.png is not a valid supported image.'])
  })

  it('reports the overflow once the running count is already at capacity', async () => {
    const { images, errors } = await readFeedbackImageFiles(
      [pngFile('a.png')],
      MAX_FEEDBACK_IMAGE_COUNT
    )

    expect(images).toEqual([])
    expect(errors).toEqual([`You can attach up to ${MAX_FEEDBACK_IMAGE_COUNT} images.`])
  })

  it('revokes previews already created when a later read in the batch fails', async () => {
    const good = pngFile('good.png')
    const broken = pngFile('broken.png')
    broken.arrayBuffer = () => Promise.reject(new Error('file went away'))

    await expect(readFeedbackImageFiles([good, broken], 0)).rejects.toThrow('file went away')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:feedback-1')
  })

  it('does not depend on crypto.randomUUID, which LAN web clients do not expose', async () => {
    const realCrypto = globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) }
    })
    try {
      const { images, errors } = await readFeedbackImageFiles([pngFile('a.png')], 0)
      expect(errors).toEqual([])
      expect(images).toHaveLength(1)
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: realCrypto })
    }
  })
})
