export type FeedbackImageShrinkStep = {
  scale: number
  contentType: 'image/png' | 'image/jpeg'
}

// Why: screenshots are mostly text, which JPEG smears, so every PNG size is
// tried before the first lossy one. Retina captures stay readable at 0.5.
const FEEDBACK_IMAGE_SHRINK_STEPS: readonly FeedbackImageShrinkStep[] = [
  { scale: 0.75, contentType: 'image/png' },
  { scale: 0.5, contentType: 'image/png' },
  { scale: 1, contentType: 'image/jpeg' },
  { scale: 0.75, contentType: 'image/jpeg' },
  { scale: 0.5, contentType: 'image/jpeg' },
  { scale: 0.25, contentType: 'image/jpeg' }
]

const FEEDBACK_IMAGE_JPEG_QUALITY = 0.85

/** Returns the first step's encoding that fits, or null when none does. */
export async function shrinkFeedbackImageWithin(
  // Encodes the decoded image at one step; null when the browser cannot encode it.
  encode: (step: FeedbackImageShrinkStep) => Promise<Blob | null>,
  maxBytes: number
): Promise<Blob | null> {
  for (const step of FEEDBACK_IMAGE_SHRINK_STEPS) {
    const blob = await encode(step)
    if (blob && blob.size <= maxBytes) {
      return blob
    }
  }
  return null
}

function encodeBitmap(bitmap: ImageBitmap, step: FeedbackImageShrinkStep): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(bitmap.width * step.scale))
  canvas.height = Math.max(1, Math.floor(bitmap.height * step.scale))
  const context = canvas.getContext('2d')
  if (!context) {
    return Promise.resolve(null)
  }
  if (step.contentType === 'image/jpeg') {
    // Why: JPEG has no alpha, and transparent pixels would otherwise encode black.
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  // Why: toBlob encodes off the renderer thread; toDataURL would freeze the dialog.
  return new Promise((resolve) =>
    canvas.toBlob(resolve, step.contentType, FEEDBACK_IMAGE_JPEG_QUALITY)
  )
}

/** Decodes once and re-encodes smaller until it fits; null when nothing fits. */
export async function shrinkFeedbackImage(image: Blob, maxBytes: number): Promise<Blob | null> {
  const bitmap = await createImageBitmap(image)
  try {
    return await shrinkFeedbackImageWithin((step) => encodeBitmap(bitmap, step), maxBytes)
  } finally {
    bitmap.close()
  }
}
