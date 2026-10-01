import {
  assertClipboardImageByteLengthWithinLimit,
  assertClipboardImageDimensionsWithinLimit
} from '../../../shared/clipboard-image'

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const commaIndex = result.indexOf(',')
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read clipboard image'))
    reader.readAsDataURL(blob)
  })
}

export async function convertImageBlobToPng(blob: Blob): Promise<Blob> {
  assertClipboardImageByteLengthWithinLimit(blob.size)
  const bitmap = await createImageBitmap(blob)
  try {
    assertClipboardImageDimensionsWithinLimit(bitmap)
    // Why: re-encoding a PNG costs time and can grow it past the clipboard size limit.
    if (blob.type === 'image/png') {
      return blob
    }
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context || canvas.width <= 0 || canvas.height <= 0) {
      throw new Error('Clipboard image could not be decoded')
    }
    context.drawImage(bitmap, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((png) => {
        if (!png) {
          reject(new Error('Clipboard image could not be encoded as PNG'))
          return
        }
        try {
          assertClipboardImageByteLengthWithinLimit(png.size)
        } catch (error) {
          reject(error)
          return
        }
        resolve(png)
      }, 'image/png')
    })
  } finally {
    bitmap.close()
  }
}
