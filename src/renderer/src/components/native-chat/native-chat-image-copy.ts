import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { blobToBase64, convertImageBlobToPng } from '@/lib/image-blob-png'
import { isWebClientLocation } from '@/lib/web-client-location'
import { CLIPBOARD_IMAGE_TOO_LARGE_ERROR } from '../../../../shared/clipboard-image'

/** The chat context menu offers "Copy image" for elements carrying this attribute. */
const COPY_IMAGE_SRC_SELECTOR = '[data-native-chat-copy-image-src]'

/** Full-size source to copy for an image, or undefined when it has none. */
export function copyableNativeChatImageSrc(
  src: string | undefined,
  path: string | undefined
): string | undefined {
  // Why: SVG has no pixels to copy (Codex offers none either); the web client's image clipboard write is a no-op.
  return path?.toLowerCase().endsWith('.svg') || isWebClientLocation() ? undefined : src
}

/** Reads the right-clicked image, if any, before its blob URL can be revoked (e.g. scrolled away). */
export function readNativeChatCopyImage(target: EventTarget | null): Promise<Blob> | undefined {
  const src =
    target instanceof Element
      ? target.closest(COPY_IMAGE_SRC_SELECTOR)?.getAttribute('data-native-chat-copy-image-src')
      : undefined
  if (!src) {
    return undefined
  }
  const image = fetch(src).then((response) => response.blob())
  // Why: a read the user never copies must not surface as an unhandled rejection.
  image.catch(() => {})
  return image
}

/** Keeps an image preview open when a close comes from using the chat context menu. */
export function keepPreviewOpenForChatMenu(open: boolean): boolean {
  // Why: Radix dismisses the dialog after a click on the menu (rendered outside it), while the
  // menu's exit animation keeps the focused item mounted; a real close moves focus off the menu.
  return open || document.activeElement?.closest('[data-native-chat-context-menu]') != null
}

export async function copyNativeChatImage(image: Promise<Blob>): Promise<void> {
  try {
    const png = await convertImageBlobToPng(await image)
    await window.api.ui.writeClipboardImage(`data:image/png;base64,${await blobToBase64(png)}`)
  } catch (error) {
    toast.error(
      translate('components.native-chat.composer.copyImageFailed', "Couldn't copy image"),
      {
        description:
          error instanceof Error && error.message === CLIPBOARD_IMAGE_TOO_LARGE_ERROR
            ? translate(
                'components.native-chat.composer.copyImageTooLarge',
                'The image is too large to copy.'
              )
            : undefined
      }
    )
  }
}
